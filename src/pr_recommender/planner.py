"""Constraint-aware twelve-month PR planning."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date

from .models import Idea, PlanItem, SearchContext


PREPARATION_STATUS = "Preparation"
_PREPARATION_PHASES = (
    "社内ネタ収集",
    "一次資料確認",
    "取材・コメント準備",
    "承認・公開条件確認",
)


def _normalise_confirmed_months(months: Sequence[int]) -> frozenset[int]:
    normalised: set[int] = set()
    for month in months:
        if isinstance(month, bool) or not isinstance(month, int) or not 1 <= month <= 12:
            raise ValueError(f"confirmed_months must contain integers from 1 to 12: {month!r}")
        normalised.add(month)
    return frozenset(normalised)


def _idea_evidence(idea: Idea) -> tuple[str, ...]:
    evidence = tuple(fact.name for fact in idea.required_facts if fact.name.strip())
    return evidence or ("公開内容を裏付ける一次資料",)


def _owner_hint(idea: Idea) -> str:
    for fact in idea.required_facts:
        if fact.owner_hint.strip():
            return fact.owner_hint
    return "広報・事業担当"


def _pick_idea(
    ideas: tuple[Idea, ...],
    start: int,
    *,
    avoid_pattern: str | None = None,
) -> tuple[Idea | None, int]:
    if not ideas:
        return None, start
    for offset in range(len(ideas)):
        index = (start + offset) % len(ideas)
        if avoid_pattern is None or ideas[index].pattern != avoid_pattern:
            return ideas[index], (index + 1) % len(ideas)
    return None, start


class AnnualPlanner:
    """Place grounded ideas in a twelve-month plan without inventing dates.

    Only ``confirmed_months`` become publication candidates. If the argument is
    omitted, a valid ``SearchContext.desired_month`` is the sole candidate month.
    Every other month is explicitly a preparation task. Adjacent candidate months
    are assigned different PR patterns where possible; if no alternative exists,
    the latter month remains a preparation task instead of forcing repetition.
    """

    def plan(
        self,
        ideas: Sequence[Idea],
        context: SearchContext | None = None,
        *,
        confirmed_months: Sequence[int] | None = None,
        start_year: int | None = None,
        start_month: int | None = None,
    ) -> tuple[PlanItem, ...]:
        idea_items = tuple(ideas)
        if confirmed_months is None:
            if context is not None and 1 <= context.desired_month <= 12:
                confirmed = frozenset((context.desired_month,))
            else:
                confirmed = frozenset()
        else:
            confirmed = _normalise_confirmed_months(confirmed_months)

        today = date.today()
        first_year = start_year if start_year is not None else today.year
        first_month = start_month if start_month is not None else today.month
        if not 2000 <= first_year <= 2100:
            raise ValueError("start_year must be between 2000 and 2100")
        if not 1 <= first_month <= 12:
            raise ValueError("start_month must be between 1 and 12")

        result: list[PlanItem] = []
        cursor = 0
        last_candidate_offset: int | None = None
        last_candidate_pattern: str | None = None

        for offset in range(12):
            month_index = first_month - 1 + offset
            year = first_year + month_index // 12
            month = month_index % 12 + 1
            is_candidate = month in confirmed and bool(idea_items)
            avoid_pattern = (
                last_candidate_pattern
                if is_candidate and last_candidate_offset == offset - 1
                else None
            )
            idea, next_cursor = _pick_idea(
                idea_items,
                cursor,
                avoid_pattern=avoid_pattern if is_candidate else None,
            )

            # An adjacent confirmed month with no alternative pattern is safer as
            # preparation than as a fabricated repetitive publication schedule.
            if is_candidate and idea is None:
                is_candidate = False
                idea, next_cursor = _pick_idea(idea_items, cursor)

            cursor = next_cursor
            if is_candidate and idea is not None:
                objective = (
                    context.goal.strip()
                    if context is not None and context.goal.strip()
                    else idea.angle
                )
                result.append(
                    PlanItem(
                        month=month,
                        year=year,
                        idea_title=idea.title_draft,
                        pattern=idea.pattern,
                        objective=objective,
                        required_evidence=_idea_evidence(idea),
                        owner_hint=_owner_hint(idea),
                        status=idea.status,
                        reference_release_keys=idea.reference_release_keys,
                    )
                )
                last_candidate_offset = offset
                last_candidate_pattern = idea.pattern
                continue

            phase = _PREPARATION_PHASES[(month - 1) % len(_PREPARATION_PHASES)]
            if idea is None:
                result.append(
                    PlanItem(
                        month=month,
                        year=year,
                        idea_title="PR企画の準備",
                        pattern=f"準備・{phase}",
                        objective=(
                            "公開月は未確認。年間の事業予定と発表可能な一次情報を整理する。"
                        ),
                        required_evidence=("年間の事業予定", "発表可能な一次情報"),
                        owner_hint="広報・事業担当",
                        status=PREPARATION_STATUS,
                    )
                )
                continue

            objective = (
                f"公開月は未確認。『{idea.title_draft}』に向けて{phase}を進め、"
                "日付を確定事項として扱わない。"
            )
            result.append(
                PlanItem(
                    month=month,
                    year=year,
                    idea_title=f"準備: {idea.title_draft}",
                    pattern=f"準備・{phase}",
                    objective=objective,
                    required_evidence=_idea_evidence(idea),
                    owner_hint=_owner_hint(idea),
                    status=PREPARATION_STATUS,
                    reference_release_keys=idea.reference_release_keys,
                )
            )

        return tuple(result)


def build_annual_plan(
    ideas: Sequence[Idea],
    context: SearchContext | None = None,
    *,
    confirmed_months: Sequence[int] | None = None,
    start_year: int | None = None,
    start_month: int | None = None,
) -> tuple[PlanItem, ...]:
    """Convenience wrapper around :class:`AnnualPlanner`."""

    return AnnualPlanner().plan(
        ideas,
        context,
        confirmed_months=confirmed_months,
        start_year=start_year,
        start_month=start_month,
    )


# Short alias for service layers that prefer a verb-first name.
plan_annual = build_annual_plan


__all__ = [
    "AnnualPlanner",
    "PREPARATION_STATUS",
    "build_annual_plan",
    "plan_annual",
]
