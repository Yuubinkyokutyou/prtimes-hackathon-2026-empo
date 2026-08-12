"""類似事例検索、構造化rerank、成果proxy、MMR多様化。"""

from __future__ import annotations

import math
import threading
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo
from types import MappingProxyType
from collections.abc import Iterable

from .embeddings import Embedder, HashingEmbedder, Vector
from .models import Release, ScoredRelease, SearchContext
from .repository import DemoRepository, PostgresRepository, ReleaseRepository


SAME_INDUSTRY_BUCKET = "same_industry"
CROSS_INDUSTRY_BUCKET = "cross_industry"
JST = ZoneInfo("Asia/Tokyo")

# 仕様として固定した初期重み。成果proxyは類似度へ加算しない。
RERANK_WEIGHTS = MappingProxyType(
    {
        "semantic": 0.55,
        "industry": 0.15,
        "category": 0.10,
        "keyword": 0.08,
        "release_type": 0.07,
        "seasonality": 0.05,
    }
)


def cosine_similarity(left: Vector, right: Vector) -> float:
    """次元を検証したexact cosine。ゼロベクトル同士は0とする。"""

    if len(left) != len(right):
        raise ValueError(
            f"ベクトル次元が一致しません: {len(left)} != {len(right)}"
        )
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if left_norm == 0.0 or right_norm == 0.0:
        return 0.0
    return sum(a * b for a, b in zip(left, right, strict=True)) / (
        left_norm * right_norm
    )


def _normalise_label(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold()
    return "".join(character for character in value if character.isalnum())


def _normalised_set(values: Iterable[str]) -> frozenset[str]:
    return frozenset(filter(None, (_normalise_label(value) for value in values)))


def _jaccard(left: Iterable[str], right: Iterable[str]) -> float:
    left_set = _normalised_set(left)
    right_set = _normalised_set(right)
    union = left_set | right_set
    if not union:
        return 0.0
    return len(left_set & right_set) / len(union)


def _month_similarity(candidate_month: int, desired_month: int) -> float:
    if not 1 <= desired_month <= 12:
        return 0.0
    distance = abs(candidate_month - desired_month)
    circular_distance = min(distance, 12 - distance)
    return 1.0 - circular_distance / 6.0


def _published_by(release: Release, as_of: datetime) -> bool:
    if release.created_at is None:
        return False
    # init.sql は timestamp without time zone。値は運用上JSTの壁時計として扱う。
    release_time = release.created_at.replace(tzinfo=None)
    if as_of.tzinfo is not None:
        comparable_as_of = as_of.astimezone(JST).replace(tzinfo=None)
    else:
        comparable_as_of = as_of
    return release_time <= comparable_as_of


@dataclass(frozen=True, slots=True)
class _QueryProfile:
    categories: tuple[str, ...]
    keywords: tuple[str, ...]
    release_type: str


@dataclass(frozen=True, slots=True)
class _Candidate:
    release: Release
    vector: Vector
    semantic_similarity: float
    final_score: float
    reasons: tuple[str, ...]
    bucket: str
    outcome_percentile: float | None

    def to_scored_release(self) -> ScoredRelease:
        return ScoredRelease(
            release=self.release,
            semantic_similarity=self.semantic_similarity,
            final_score=self.final_score,
            reasons=self.reasons,
            bucket=self.bucket,
            outcome_percentile=self.outcome_percentile,
        )


class SearchEngine:
    """全件cosine候補検索と説明可能な構造化rerankを行う。"""

    def __init__(
        self,
        repository: ReleaseRepository,
        embedder: Embedder | None = None,
        *,
        mmr_lambda: float = 0.82,
    ) -> None:
        if not 0.0 <= mmr_lambda <= 1.0:
            raise ValueError("mmr_lambda は0から1の範囲で指定してください")
        self.repository = repository
        self.embedder = embedder or HashingEmbedder()
        self.mmr_lambda = mmr_lambda
        # 同じ複合キーでも本文更新を検知できるよう、search_textもキャッシュキーに含める。
        self._embedding_cache: dict[tuple[str, str], Vector] = {}
        self._embedding_lock = threading.RLock()

    def search(
        self,
        context: SearchContext,
        *,
        per_bucket: int = 3,
        candidate_limit: int = 50,
        as_of: datetime | None = None,
    ) -> tuple[ScoredRelease, ...]:
        """同業と異業種の事例を、各 ``per_bucket`` 件まで返す。

        ``created_at`` がNULLまたは ``as_of`` より未来のリリースは、投稿済み
        事例ではないため候補にもクエリプロファイルにも利用しない。
        """

        if per_bucket < 1:
            raise ValueError("per_bucket は1以上にしてください")
        if candidate_limit < 1:
            raise ValueError("candidate_limit は1以上にしてください")
        if not 1 <= context.desired_month <= 12:
            raise ValueError("desired_month は1から12で指定してください")

        cutoff = as_of or datetime.now(JST)
        all_releases = tuple(
            release
            for release in self.repository.list_releases()
            if _published_by(release, cutoff)
        )
        candidates = tuple(
            release
            for release in all_releases
            if release.company_id != context.target_company_id
        )
        if not candidates:
            return ()

        query_vector = self.embedder.embed_query(context.query_text)
        if isinstance(self.repository, PostgresRepository):
            semantic_candidates = self._postgres_semantic_candidates(
                context=context,
                query_vector=query_vector,
                candidates=candidates,
                per_bucket=per_bucket,
                candidate_limit=candidate_limit,
                cutoff=cutoff,
            )
            if not semantic_candidates:
                raise ValueError(
                    "現在の埋め込みモデルに対応する検索索引がありません。"
                    " pr_recommender.indexer を実行してください。"
                )
        else:
            candidate_vectors = self._vectors_for(candidates)
            same_pool: list[tuple[Release, Vector, float]] = []
            cross_pool: list[tuple[Release, Vector, float]] = []
            for release, vector in zip(candidates, candidate_vectors, strict=True):
                item = (
                    release,
                    vector,
                    max(0.0, min(1.0, cosine_similarity(query_vector, vector))),
                )
                if _normalise_label(release.industry) == _normalise_label(
                    context.industry
                ):
                    same_pool.append(item)
                else:
                    cross_pool.append(item)
            order = lambda item: (
                -item[2],
                item[0].company_id,
                item[0].release_id,
            )
            # bucketごとに候補を確保し、全体top-Kの偏りで片方が空になるのを防ぐ。
            semantic_candidates = (
                sorted(same_pool, key=order)[:candidate_limit]
                + sorted(cross_pool, key=order)[:candidate_limit]
            )

        profile = self._build_query_profile(
            context,
            query_vector,
            all_releases,
        )
        outcome_percentiles = _calculate_outcome_percentiles(all_releases)

        ranked = [
            self._rerank_candidate(
                context=context,
                release=release,
                vector=vector,
                semantic_similarity=semantic,
                profile=profile,
                outcome_percentile=outcome_percentiles.get(
                    (release.company_id, release.release_id)
                ),
            )
            for release, vector, semantic in semantic_candidates
        ]

        same_industry = [
            candidate
            for candidate in ranked
            if candidate.bucket == SAME_INDUSTRY_BUCKET
        ]
        cross_industry = [
            candidate
            for candidate in ranked
            if candidate.bucket == CROSS_INDUSTRY_BUCKET
        ]

        selected_same = self._mmr_select(same_industry, per_bucket)
        selected_cross = self._mmr_select(cross_industry, per_bucket)

        mode = context.mode.casefold().replace("-", "_")
        if mode in {"same", "same_industry", "focused"}:
            selected = selected_same
        elif mode in {"cross", "cross_industry", "creative"}:
            selected = selected_cross
        else:
            selected = selected_same + selected_cross
        return tuple(candidate.to_scored_release() for candidate in selected)

    def recommend(
        self,
        context: SearchContext,
        *,
        per_bucket: int = 3,
        candidate_limit: int = 50,
        as_of: datetime | None = None,
    ) -> tuple[ScoredRelease, ...]:
        """``search`` のサービス層向け別名。"""

        return self.search(
            context,
            per_bucket=per_bucket,
            candidate_limit=candidate_limit,
            as_of=as_of,
        )

    def _vectors_for(self, releases: tuple[Release, ...]) -> list[Vector]:
        keys = [(release.key, release.search_text) for release in releases]
        with self._embedding_lock:
            missing = tuple(
                release
                for key, release in zip(keys, releases, strict=True)
                if key not in self._embedding_cache
            )
            if missing and isinstance(self.repository, PostgresRepository):
                stored = self.repository.stored_vectors(missing, self.embedder.model_id)
                for release in missing:
                    vector = stored.get((release.company_id, release.release_id))
                    if vector is None:
                        raise ValueError(
                            f"{release.key} の埋め込みがありません。"
                            " indexerを再実行してください。"
                        )
                    self._embedding_cache[(release.key, release.search_text)] = vector
            elif missing:
                missing_keys = [
                    (release.key, release.search_text) for release in missing
                ]
                embedded = self.embedder.embed_documents(
                    [release.search_text for release in missing]
                )
                if len(embedded) != len(missing_keys):
                    raise ValueError("埋め込みの返却件数が入力件数と一致しません")
                self._embedding_cache.update(
                    zip(missing_keys, embedded, strict=True)
                )
            return [self._embedding_cache[key] for key in keys]

    def _postgres_semantic_candidates(
        self,
        *,
        context: SearchContext,
        query_vector: Vector,
        candidates: tuple[Release, ...],
        per_bucket: int,
        candidate_limit: int,
        cutoff: datetime,
    ) -> list[tuple[Release, Vector, float]]:
        repository = self.repository
        if not isinstance(repository, PostgresRepository):
            return []
        comparable_cutoff = (
            cutoff.astimezone(JST).replace(tzinfo=None)
            if cutoff.tzinfo is not None
            else cutoff
        )
        by_key = {
            (release.company_id, release.release_id): release
            for release in candidates
        }
        mode = context.mode.casefold().replace("-", "_")
        buckets = (
            (SAME_INDUSTRY_BUCKET,)
            if mode in {"same", "same_industry", "focused"}
            else (CROSS_INDUSTRY_BUCKET,)
            if mode in {"cross", "cross_industry", "creative"}
            else (SAME_INDUSTRY_BUCKET, CROSS_INDUSTRY_BUCKET)
        )
        result: list[tuple[Release, Vector, float]] = []
        for bucket in buckets:
            rows = repository.find_vector_candidates(
                query_vector=query_vector,
                embedding_model=self.embedder.model_id,
                target_company_id=context.target_company_id,
                target_industry=context.industry,
                bucket=bucket,
                limit=max(per_bucket, candidate_limit),
                as_of=comparable_cutoff,
            )
            for company_id, release_id, vector, similarity in rows:
                release = by_key.get((company_id, release_id))
                if release is None:
                    continue
                result.append((release, vector, similarity))
                with self._embedding_lock:
                    self._embedding_cache[(release.key, release.search_text)] = vector
        return result

    def _build_query_profile(
        self,
        context: SearchContext,
        query_vector: Vector,
        all_releases: tuple[Release, ...],
    ) -> _QueryProfile:
        target_releases = tuple(
            release
            for release in all_releases
            if release.company_id == context.target_company_id
        )
        inferred_type = _infer_release_type(context.query_text)

        anchor: Release | None = None
        if target_releases:
            vectors = self._vectors_for(target_releases)
            anchor = max(
                zip(target_releases, vectors, strict=True),
                key=lambda pair: cosine_similarity(query_vector, pair[1]),
            )[0]

        query_normalised = _normalise_label(context.query_text)
        known_categories = {
            category
            for release in all_releases
            for category in release.categories
            if _normalise_label(category) in query_normalised
        }
        known_keywords = {
            keyword
            for release in all_releases
            for keyword in release.keywords
            if _normalise_label(keyword) in query_normalised
        }
        if anchor is not None:
            known_categories.update(anchor.categories)
            known_keywords.update(anchor.keywords)

        return _QueryProfile(
            categories=tuple(sorted(known_categories)),
            keywords=tuple(sorted(known_keywords)),
            release_type=inferred_type or (anchor.release_type if anchor else ""),
        )

    def _rerank_candidate(
        self,
        *,
        context: SearchContext,
        release: Release,
        vector: Vector,
        semantic_similarity: float,
        profile: _QueryProfile,
        outcome_percentile: float | None,
    ) -> _Candidate:
        same_industry = _normalise_label(release.industry) == _normalise_label(
            context.industry
        )
        industry_score = 1.0 if same_industry else 0.0
        category_score = _jaccard(release.categories, profile.categories)
        keyword_score = _jaccard(release.keywords, profile.keywords)
        release_type_score = (
            1.0
            if profile.release_type
            and _normalise_label(release.release_type)
            == _normalise_label(profile.release_type)
            else 0.0
        )
        seasonality_score = _month_similarity(
            release.created_at.month,
            context.desired_month,
        )

        final_score = (
            RERANK_WEIGHTS["semantic"] * semantic_similarity
            + RERANK_WEIGHTS["industry"] * industry_score
            + RERANK_WEIGHTS["category"] * category_score
            + RERANK_WEIGHTS["keyword"] * keyword_score
            + RERANK_WEIGHTS["release_type"] * release_type_score
            + RERANK_WEIGHTS["seasonality"] * seasonality_score
        )
        bucket = SAME_INDUSTRY_BUCKET if same_industry else CROSS_INDUSTRY_BUCKET
        reasons = _reason_badges(
            context=context,
            release=release,
            profile=profile,
            semantic_similarity=semantic_similarity,
            same_industry=same_industry,
            release_type_score=release_type_score,
            seasonality_score=seasonality_score,
            outcome_percentile=outcome_percentile,
        )
        return _Candidate(
            release=release,
            vector=vector,
            semantic_similarity=semantic_similarity,
            final_score=final_score,
            reasons=reasons,
            bucket=bucket,
            outcome_percentile=outcome_percentile,
        )

    def _mmr_select(
        self,
        candidates: list[_Candidate],
        limit: int,
    ) -> list[_Candidate]:
        remaining = list(candidates)
        selected: list[_Candidate] = []
        while remaining and len(selected) < limit:
            def mmr_score(candidate: _Candidate) -> tuple[float, float, int, int]:
                redundancy = max(
                    (
                        max(0.0, cosine_similarity(candidate.vector, item.vector))
                        for item in selected
                    ),
                    default=0.0,
                )
                repeated_company_penalty = (
                    0.06
                    if any(
                        item.release.company_id == candidate.release.company_id
                        for item in selected
                    )
                    else 0.0
                )
                mmr = (
                    self.mmr_lambda * candidate.final_score
                    - (1.0 - self.mmr_lambda) * redundancy
                    - repeated_company_penalty
                )
                # max()の決定的なtie-break。小さいIDを優先するため符号を反転。
                return (
                    mmr,
                    candidate.final_score,
                    -candidate.release.company_id,
                    -candidate.release.release_id,
                )

            choice = max(remaining, key=mmr_score)
            selected.append(choice)
            remaining.remove(choice)
        return selected


def _infer_release_type(query_text: str) -> str:
    normalised = _normalise_label(query_text)
    mappings = (
        (("調査", "アンケート", "実態", "データ分析"), "調査レポート"),
        (("イベント", "開催", "セミナー", "アイデアソン"), "イベント"),
        (("キャンペーン", "プレゼント", "投票"), "キャンペーン"),
        (("就任", "人事", "採用"), "人物"),
        (("提携", "資金調達", "経営", "実証"), "経営情報"),
        (("新商品", "新サービス", "提供開始", "発売", "アプリ"), "商品サービス"),
        (("無料公開", "ハンドブック", "教材"), "その他"),
    )
    for terms, release_type in mappings:
        if any(_normalise_label(term) in normalised for term in terms):
            return release_type
    return ""


def _display_intersection(
    candidate_values: tuple[str, ...],
    profile_values: tuple[str, ...],
) -> tuple[str, ...]:
    profile_normalised = _normalised_set(profile_values)
    return tuple(
        value
        for value in candidate_values
        if _normalise_label(value) in profile_normalised
    )


def _reason_badges(
    *,
    context: SearchContext,
    release: Release,
    profile: _QueryProfile,
    semantic_similarity: float,
    same_industry: bool,
    release_type_score: float,
    seasonality_score: float,
    outcome_percentile: float | None,
) -> tuple[str, ...]:
    reasons: list[str] = []
    reasons.append(
        "意味類似度が高い" if semantic_similarity >= 0.38 else "関連テーマを含む"
    )
    reasons.append(
        f"同業種: {release.industry}"
        if same_industry
        else f"異業種から転用: {release.industry}"
    )

    common_categories = _display_intersection(
        release.categories,
        profile.categories,
    )
    if common_categories:
        reasons.append("共通カテゴリ: " + "・".join(common_categories[:2]))

    common_keywords = _display_intersection(release.keywords, profile.keywords)
    if common_keywords:
        reasons.append("共通キーワード: " + "・".join(common_keywords[:3]))

    if release_type_score:
        reasons.append(f"発表タイプ一致: {release.release_type}")
    if seasonality_score >= 5.0 / 6.0:
        reasons.append(f"公開時期が近い: {release.created_at.month}月")
    if outcome_percentile is not None and outcome_percentile >= 0.75:
        reasons.append("同条件内で反響上位")

    # UIを過密にしない。意味・bucketは必ず先頭2件として残す。
    return tuple(reasons[:6])


def _outcome_value(release: Release) -> float | None:
    metrics = (release.page_view, release.unique_user, release.like_count)
    if any(metric is None or metric < 0 for metric in metrics):
        return None
    page_view, unique_user, like_count = metrics
    return (
        0.40 * math.log1p(page_view)
        + 0.25 * math.log1p(unique_user)
        + 0.20 * math.log1p(like_count)
        + 0.15 * math.log1p(max(0, release.clipping_count))
    )


def _percent_rank(value: float, population: list[float]) -> float:
    if len(population) <= 1:
        return 0.5
    lower = sum(item < value for item in population)
    equal = sum(math.isclose(item, value, rel_tol=1e-12) for item in population)
    # tieは同順位の中央へ置く。
    return (lower + (equal - 1) / 2.0) / (len(population) - 1)


def _calculate_outcome_percentiles(
    releases: tuple[Release, ...],
) -> dict[tuple[int, int], float]:
    values = {
        (release.company_id, release.release_id): _outcome_value(release)
        for release in releases
    }
    result: dict[tuple[int, int], float] = {}
    for release in releases:
        value = values[(release.company_id, release.release_id)]
        if value is None or release.created_at is None:
            continue

        # 小さいデモコホートでは段階的に条件を緩め、最低3件を目安にする。
        cohort_predicates = (
            lambda item: (
                item.industry == release.industry
                and item.release_type == release.release_type
                and item.created_at is not None
                and item.created_at.year == release.created_at.year
            ),
            lambda item: (
                item.industry == release.industry
                and item.release_type == release.release_type
            ),
            lambda item: item.industry == release.industry,
            lambda item: True,
        )
        population: list[float] = []
        for predicate in cohort_predicates:
            population = [
                candidate_value
                for candidate in releases
                if predicate(candidate)
                and (
                    candidate_value := values[
                        (candidate.company_id, candidate.release_id)
                    ]
                )
                is not None
            ]
            if len(population) >= 3:
                break
        result[(release.company_id, release.release_id)] = _percent_rank(
            value,
            population,
        )
    return result


def search_similar(
    context: SearchContext,
    repository: ReleaseRepository | None = None,
    embedder: Embedder | None = None,
    *,
    per_bucket: int = 3,
    candidate_limit: int = 50,
    as_of: datetime | None = None,
) -> tuple[ScoredRelease, ...]:
    """1回だけ検索する場合の便利関数。未指定時は通信不要のデモを使う。"""

    engine = SearchEngine(repository or DemoRepository(), embedder)
    return engine.search(
        context,
        per_bucket=per_bucket,
        candidate_limit=candidate_limit,
        as_of=as_of,
    )
