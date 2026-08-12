from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(frozen=True, slots=True)
class Company:
    company_id: int
    name: str
    description: str
    industry: str
    ipo_type: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "company_id": self.company_id,
            "name": self.name,
            "description": self.description,
            "industry": self.industry,
            "ipo_type": self.ipo_type,
        }


@dataclass(frozen=True, slots=True)
class Release:
    company_id: int
    release_id: int
    company_name: str
    industry: str
    title: str
    subtitle: str
    lead: str
    body: str
    release_type: str
    created_at: datetime | None
    categories: tuple[str, ...] = ()
    keywords: tuple[str, ...] = ()
    page_view: int | None = None
    unique_user: int | None = None
    like_count: int | None = None
    clipping_count: int = 0
    url: str = ""
    pattern: str = "その他"

    @property
    def key(self) -> str:
        return f"{self.company_id}:{self.release_id}"

    @property
    def search_text(self) -> str:
        parts = (
            f"タイトル: {self.title}",
            f"サブタイトル: {self.subtitle}",
            f"リード: {self.lead}",
            f"本文: {self.body[:1800]}",
            f"業種: {self.industry}",
            f"種別: {self.release_type}",
            f"企画パターン: {self.pattern}",
            f"カテゴリ: {' '.join(self.categories)}",
            f"キーワード: {' '.join(self.keywords)}",
        )
        return "\n".join(part for part in parts if not part.endswith(": "))

    def to_dict(self) -> dict[str, Any]:
        return {
            "company_id": self.company_id,
            "release_id": self.release_id,
            "key": self.key,
            "company_name": self.company_name,
            "industry": self.industry,
            "title": self.title,
            "subtitle": self.subtitle,
            "lead": self.lead,
            "body": self.body,
            "release_type": self.release_type,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "categories": list(self.categories),
            "keywords": list(self.keywords),
            "page_view": self.page_view,
            "unique_user": self.unique_user,
            "like_count": self.like_count,
            "clipping_count": self.clipping_count,
            "url": self.url,
            "pattern": self.pattern,
        }


@dataclass(frozen=True, slots=True)
class SearchContext:
    target_company_id: int
    company_name: str
    company_description: str
    industry: str
    goal: str
    facts: tuple[str, ...]
    desired_month: int
    mode: str = "balanced"

    @property
    def query_text(self) -> str:
        return "\n".join(
            (
                f"対象企業: {self.company_name}",
                f"会社説明: {self.company_description}",
                f"業種: {self.industry}",
                f"広報目的: {self.goal}",
                f"発表できる事実: {' / '.join(self.facts)}",
                f"希望月: {self.desired_month}月",
            )
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "target_company_id": self.target_company_id,
            "company_name": self.company_name,
            "company_description": self.company_description,
            "industry": self.industry,
            "goal": self.goal,
            "facts": list(self.facts),
            "desired_month": self.desired_month,
            "mode": self.mode,
        }


@dataclass(frozen=True, slots=True)
class ScoredRelease:
    release: Release
    semantic_similarity: float
    final_score: float
    reasons: tuple[str, ...]
    bucket: str
    outcome_percentile: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            **self.release.to_dict(),
            "semantic_similarity": round(self.semantic_similarity, 4),
            "final_score": round(self.final_score, 4),
            "reasons": list(self.reasons),
            "bucket": self.bucket,
            "outcome_percentile": (
                round(self.outcome_percentile, 4)
                if self.outcome_percentile is not None
                else None
            ),
        }


@dataclass(frozen=True, slots=True)
class FactRequirement:
    name: str
    status: str
    owner_hint: str
    due_hint: str

    def to_dict(self) -> dict[str, str]:
        return {
            "name": self.name,
            "status": self.status,
            "owner_hint": self.owner_hint,
            "due_hint": self.due_hint,
        }


@dataclass(frozen=True, slots=True)
class Idea:
    title_draft: str
    pattern: str
    angle: str
    why_now: str
    target_audiences: tuple[str, ...]
    required_facts: tuple[FactRequirement, ...]
    reference_release_keys: tuple[str, ...]
    assumptions: tuple[str, ...] = ()
    confidence: str = "medium"
    status: str = "Needs facts"

    def to_dict(self) -> dict[str, Any]:
        return {
            "title_draft": self.title_draft,
            "pattern": self.pattern,
            "angle": self.angle,
            "why_now": self.why_now,
            "target_audiences": list(self.target_audiences),
            "required_facts": [fact.to_dict() for fact in self.required_facts],
            "reference_release_keys": list(self.reference_release_keys),
            "assumptions": list(self.assumptions),
            "confidence": self.confidence,
            "status": self.status,
        }


@dataclass(frozen=True, slots=True)
class PlanItem:
    month: int
    idea_title: str
    pattern: str
    objective: str
    required_evidence: tuple[str, ...]
    owner_hint: str
    status: str
    reference_release_keys: tuple[str, ...] = field(default_factory=tuple)
    year: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "month": self.month,
            "year": self.year,
            "idea_title": self.idea_title,
            "pattern": self.pattern,
            "objective": self.objective,
            "required_evidence": list(self.required_evidence),
            "owner_hint": self.owner_hint,
            "status": self.status,
            "reference_release_keys": list(self.reference_release_keys),
        }
