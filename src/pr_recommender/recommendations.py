"""投稿済みPRから、まだ使っていない発信パターンを提案するMVP機能。"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from .models import Release, SearchContext
from .pattern_catalog import PATTERN_CATALOG, PRPattern
from .repository import ReleaseRepository
from .search import SearchEngine
from .selection import (
    LocalPatternSelector,
    PatternSelector,
    SelectionCandidate,
    SelectionContext,
)


JST = ZoneInfo("Asia/Tokyo")

_USED_FAMILY_BY_RELEASE_PATTERN = {
    "イベント": "イベント",
    "キャンペーン": "キャンペーン",
    "経営・提携": "経営・提携",
    "調査・データ": "調査・データ",
    "人物・組織": "人物・組織",
    "コンテンツ公開": "コンテンツ公開",
}


def _normalise(value: str) -> str:
    return "".join(str(value).casefold().split())


def _release_text(release: Release) -> str:
    return _normalise(
        " ".join(
            (
                release.title,
                release.subtitle,
                release.lead,
                " ".join(release.categories),
                " ".join(release.keywords),
            )
        )
    )


def _term_overlap(text: str, terms: tuple[str, ...]) -> float:
    if not terms:
        return 0.0
    return sum(_normalise(term) in text for term in terms) / len(terms)


def _release_summary(release: Release) -> dict[str, Any]:
    return {
        "key": release.key,
        "company_id": release.company_id,
        "company_name": release.company_name,
        "title": release.title,
        "pattern": release.pattern,
        "created_at": release.created_at.isoformat() if release.created_at else None,
        "url": release.url,
    }


class RecommendationEngine:
    """pgvector候補検索と事前定義パターンを組み合わせる。

    APIキー未設定のMVPではランキングが常に再現できる。PostgreSQLRepository
    利用時の候補検索は ``SearchEngine`` を通してpgvectorのcosine検索になる。
    """

    def __init__(
        self,
        repository: ReleaseRepository,
        search_engine: SearchEngine,
        *,
        data_mode: str,
        selector: PatternSelector | None = None,
    ) -> None:
        self.repository = repository
        self.search_engine = search_engine
        self.data_mode = data_mode
        self.selector = selector or LocalPatternSelector()

    def recommend(self, company_id: int, *, limit: int = 3) -> dict[str, Any]:
        company = self.repository.get_company(company_id)
        if company is None:
            raise ValueError("ログイン対象の企業が見つかりません")
        if limit < 1 or limit > 6:
            raise ValueError("提案件数は1〜6で指定してください")

        own_releases = tuple(
            sorted(
                self.repository.list_releases(company_id),
                key=lambda item: item.created_at or datetime.min,
                reverse=True,
            )[:10]
        )
        if not own_releases:
            raise ValueError("投稿済みプレスリリースがないため分析できません")

        now = datetime.now(JST)
        desired_month = now.month % 12 + 1
        context = SearchContext(
            target_company_id=company.company_id,
            company_name=company.name,
            company_description=company.description,
            industry=company.industry,
            goal="投稿済みプレスリリースを別の切り口で継続発信する",
            facts=tuple(release.title[:300] for release in own_releases),
            desired_month=desired_month,
            mode="balanced",
        )
        # PostgreSQLモードでは、この呼び出しがpgvectorのcosine候補検索になる。
        similar = self.search_engine.search(
            context,
            per_bucket=8,
            candidate_limit=30,
            as_of=now,
        )
        scored_by_key = {item.release.key: item for item in similar}
        used_families = {
            family
            for release in own_releases
            if (family := _USED_FAMILY_BY_RELEASE_PATTERN.get(release.pattern))
        }
        own_history_text = " ".join(_release_text(release) for release in own_releases)

        ranked: list[tuple[float, PRPattern, Any, Release]] = []
        for pattern in PATTERN_CATALOG:
            if pattern.family in used_families:
                continue
            references = [
                scored_by_key[key]
                for key in pattern.reference_release_keys
                if key in scored_by_key
                and scored_by_key[key].release.company_id != company.company_id
            ]
            if not references:
                continue
            reference = max(
                references,
                key=lambda item: (item.final_score, item.semantic_similarity),
            )
            applicability = _term_overlap(own_history_text, pattern.applicability_terms)
            novelty = 1.0
            cross_industry_bonus = 1.0 if reference.bucket == "cross_industry" else 0.0
            total = (
                reference.final_score * 0.55
                + applicability * 0.25
                + novelty * 0.15
                + cross_industry_bonus * 0.05
            )
            anchor = max(
                own_releases,
                key=lambda release: (
                    _term_overlap(_release_text(release), pattern.applicability_terms),
                    release.created_at or datetime.min,
                ),
            )
            ranked.append((total, pattern, reference, anchor))

        ranked.sort(key=lambda item: (-item[0], item[1].pattern_id))
        family_candidates: list[tuple[float, PRPattern, Any, Release]] = []
        candidate_families: set[str] = set()
        for item in ranked:
            if item[1].family in candidate_families:
                continue
            family_candidates.append(item)
            candidate_families.add(item[1].family)
        if len(family_candidates) < limit:
            raise ValueError("未活用パターンに紐づく参考事例を見つけられませんでした")

        selection_candidates = tuple(
            SelectionCandidate(
                candidate_id=pattern.pattern_id,
                pattern=pattern.name,
                family=pattern.family,
                description=pattern.description,
                source_release_title=anchor.title,
                reference_company_name=reference.release.company_name,
                reference_release_title=reference.release.title,
                semantic_similarity=round(reference.semantic_similarity, 4),
                local_score=round(total, 4),
            )
            for total, pattern, reference, anchor in family_candidates
        )
        decisions = self.selector.select(
            selection_candidates,
            SelectionContext(
                company_name=company.name,
                industry=company.industry,
                company_description=company.description,
                own_release_titles=tuple(release.title for release in own_releases),
            ),
            limit=limit,
        )
        ranked_by_id = {item[1].pattern_id: item for item in family_candidates}
        selected = [
            (*ranked_by_id[decision.candidate_id], decision.rationale)
            for decision in decisions
        ]

        proposals = [
            self._proposal(total, pattern, reference, anchor, index, rationale)
            for index, (total, pattern, reference, anchor, rationale) in enumerate(selected, start=1)
        ]
        return {
            "company": company.to_dict(),
            "analysis": {
                "release_count": len(own_releases),
                "release_limit": 10,
                "used_patterns": sorted({release.pattern for release in own_releases}),
                "catalog_size": len(PATTERN_CATALOG),
                "candidate_count": len(similar),
                "vector_search": "pgvector cosine" if self.data_mode == "postgres" else "local vector demo",
                "selection_provider": self.selector.provider,
            },
            "own_releases": [_release_summary(release) for release in own_releases],
            "recommendations": proposals,
        }

    @staticmethod
    def _proposal(
        total: float,
        pattern: PRPattern,
        reference: Any,
        anchor: Release,
        rank: int,
        rationale: str,
    ):
        reference_release = reference.release
        compact_title = re.sub(r"^[【\[].+?[】\]]", "", anchor.title).strip()
        if len(compact_title) > 42:
            compact_title = compact_title[:41] + "…"
        return {
            "rank": rank,
            "pattern_id": pattern.pattern_id,
            "pattern": pattern.name,
            "family": pattern.family,
            "proposal_title": f"「{compact_title}」を起点に、{pattern.name}で再発信",
            "angle": pattern.description,
            "why_applicable": rationale,
            "required_facts": list(pattern.required_facts),
            "source_release": _release_summary(anchor),
            "reference_release": {
                **_release_summary(reference_release),
                "similarity": round(reference.semantic_similarity, 4),
                "final_score": round(reference.final_score, 4),
                "reasons": list(reference.reasons),
                "bucket": reference.bucket,
            },
            "confidence": round(min(0.99, max(0.0, total)), 4),
            "notice": "企画の切り口までの提案です。本文や未確認の実績は生成していません。",
        }


__all__ = ["RecommendationEngine"]
