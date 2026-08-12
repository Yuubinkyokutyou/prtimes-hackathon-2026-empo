"""HTTP/CLIから利用するアプリケーションサービス。"""

from __future__ import annotations

import os
import hashlib
import json
import threading
from collections.abc import Mapping
from datetime import datetime
from typing import Any

from .embeddings import HashingEmbedder, OpenAIEmbedder
from .generation import generate_ideas
from .models import Idea, SearchContext
from .planner import AnnualPlanner
from .repository import (
    DemoRepository,
    PostgresRepository,
    ReleaseRepository,
    repository_from_env,
)
from .recommendations import RecommendationEngine
from .search import SearchEngine


def _as_company_id(value: object) -> int:
    if isinstance(value, bool):
        raise ValueError("company_idが不正です")
    try:
        company_id = int(str(value))
    except (TypeError, ValueError) as exc:
        raise ValueError("company_idを選択してください") from exc
    if company_id < 1:
        raise ValueError("company_idが不正です")
    return company_id


def _as_month(value: object) -> int:
    if isinstance(value, bool):
        raise ValueError("希望月が不正です")
    try:
        month = int(str(value))
    except (TypeError, ValueError) as exc:
        raise ValueError("希望月を1〜12で指定してください") from exc
    if not 1 <= month <= 12:
        raise ValueError("希望月を1〜12で指定してください")
    return month


def _as_facts(value: object) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        values = value.replace("、", "\n").splitlines()
    elif isinstance(value, (list, tuple)):
        values = value
    else:
        raise ValueError("factsは文字列または配列で指定してください")
    cleaned = tuple(
        dict.fromkeys(str(item).strip()[:300] for item in values if str(item).strip())
    )
    return cleaned[:12]


class ApplicationService:
    def __init__(
        self,
        repository: ReleaseRepository,
        search_engine: SearchEngine,
        *,
        data_mode: str,
    ) -> None:
        self.repository = repository
        self.search_engine = search_engine
        self.data_mode = data_mode
        self.planner = AnnualPlanner()
        self.recommendation_engine = RecommendationEngine(
            repository,
            search_engine,
            data_mode=data_mode,
        )
        self._idea_cache: dict[tuple[Any, ...], tuple[Idea, ...]] = {}
        self._idea_sets: dict[str, tuple[SearchContext, tuple[Idea, ...], tuple[str, ...]]] = {}
        self._cache_lock = threading.Lock()

    def bootstrap(self) -> dict[str, Any]:
        companies = [company.to_dict() for company in self.repository.list_companies()]
        demo_accounts = []
        for company in self.repository.list_companies():
            releases = self.repository.list_releases(company.company_id)
            if not releases or len(releases) > 10:
                continue
            account = company.to_dict()
            account["release_count"] = len(releases)
            account["latest_release_title"] = max(
                releases,
                key=lambda item: item.created_at or datetime.min,
            ).title
            demo_accounts.append(account)
            if len(demo_accounts) >= 6:
                break
        return {
            "mode": self.data_mode,
            "demo_mode": self.data_mode == "demo",
            "demo_message": (
                "同梱の架空データで動作中" if self.data_mode == "demo" else ""
            ),
            "database_enabled": self.data_mode == "postgres",
            "openai_enabled": (
                os.getenv("PR_GENERATION_PROVIDER", "local").strip().casefold()
                == "openai"
                and bool(os.getenv("OPENAI_API_KEY", "").strip())
            ),
            "generation_provider": os.getenv(
                "PR_GENERATION_PROVIDER", "local"
            ).strip().casefold(),
            "embedding_provider": self.search_engine.embedder.model_id,
            "companies": companies,
            "demo_accounts": demo_accounts,
        }

    def recommendations(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        """企業選択だけで、投稿履歴から未活用の切り口を返す。"""

        company_id = _as_company_id(payload.get("company_id"))
        raw_limit = payload.get("limit", 3)
        if isinstance(raw_limit, bool):
            raise ValueError("提案件数が不正です")
        try:
            limit = int(str(raw_limit))
        except (TypeError, ValueError) as exc:
            raise ValueError("提案件数が不正です") from exc
        return self.recommendation_engine.recommend(company_id, limit=limit)

    def search(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        context = self._context(payload)
        results = self.search_engine.search(context)
        return {
            "context": context.to_dict(),
            "results": [self._result_payload(result) for result in results],
        }

    def ideas(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        context = self._context(payload)
        results = self._selected_results(payload, context)
        ideas = self._ideas_for(context, results)
        idea_set_id = self._store_idea_set(context, results, ideas)
        return {
            "context": context.to_dict(),
            "results": [self._result_payload(result) for result in results],
            "ideas": [idea.to_dict() for idea in ideas],
            "idea_set_id": idea_set_id,
        }

    def plan(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        context = self._context(payload)
        idea_set_id = str(payload.get("idea_set_id", "")).strip()
        if not idea_set_id:
            raise ValueError("先に企画案を生成してください")
        with self._cache_lock:
            idea_set = self._idea_sets.get(idea_set_id)
        if idea_set is None:
            raise ValueError("企画案の有効期限が切れました。企画案を再生成してください")
        stored_context, ideas, stored_keys = idea_set
        if stored_context != context:
            raise ValueError("企画案の生成後に条件が変更されています。再生成してください")
        requested_keys = tuple(str(key) for key in payload.get("selected_release_keys", ()))
        if set(requested_keys) != set(stored_keys):
            raise ValueError("参考事例が変更されています。企画案を再生成してください")
        confirmed_months = self._confirmed_months(payload, context)
        start_year, start_month = self._plan_start(payload)
        items = self.planner.plan(
            ideas,
            context,
            confirmed_months=confirmed_months,
            start_year=start_year,
            start_month=start_month,
        )
        return {
            "context": context.to_dict(),
            "ideas": [idea.to_dict() for idea in ideas],
            "items": [item.to_dict() for item in items],
            "idea_set_id": idea_set_id,
        }

    def _selected_results(self, payload: Mapping[str, Any], context: SearchContext):
        results = self.search_engine.search(context)
        raw_keys = payload.get("selected_release_keys")
        if raw_keys is None:
            return results
        if not isinstance(raw_keys, (list, tuple)):
            raise ValueError("selected_release_keysは配列で指定してください")
        requested = {str(key).strip() for key in raw_keys if str(key).strip()}
        selected = tuple(result for result in results if result.release.key in requested)
        matched = {result.release.key for result in selected}
        if matched != requested:
            missing = ", ".join(sorted(requested - matched))
            raise ValueError(f"現在の検索結果にない参考事例が含まれています: {missing}")
        if not selected:
            raise ValueError("参考にする事例を1件以上選択してください")
        return selected

    def _ideas_for(self, context: SearchContext, results) -> tuple[Idea, ...]:
        result_keys = tuple(result.release.key for result in results)
        cache_key = (
            context.target_company_id,
            context.company_name,
            context.company_description,
            context.industry,
            context.goal,
            context.facts,
            context.desired_month,
            context.mode,
            result_keys,
            tuple(result.release.search_text for result in results),
            os.getenv("PR_GENERATION_PROVIDER", "local"),
            os.getenv("OPENAI_GENERATION_MODEL", ""),
        )
        with self._cache_lock:
            cached = self._idea_cache.get(cache_key)
        if cached is not None:
            return cached
        ideas = generate_ideas(results, context)
        with self._cache_lock:
            if len(self._idea_cache) >= 128:
                self._idea_cache.pop(next(iter(self._idea_cache)))
            self._idea_cache[cache_key] = ideas
        return ideas

    def _store_idea_set(self, context, results, ideas) -> str:
        keys = tuple(result.release.key for result in results)
        snapshot = {
            "context": context.to_dict(),
            "release_keys": keys,
            "release_texts": [result.release.search_text for result in results],
            "ideas": [idea.to_dict() for idea in ideas],
            "provider": os.getenv("PR_GENERATION_PROVIDER", "local"),
            "model": os.getenv("OPENAI_GENERATION_MODEL", ""),
            "version": 1,
        }
        idea_set_id = hashlib.sha256(
            json.dumps(snapshot, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()[:32]
        with self._cache_lock:
            if len(self._idea_sets) >= 128:
                self._idea_sets.pop(next(iter(self._idea_sets)))
            self._idea_sets[idea_set_id] = (context, ideas, keys)
        return idea_set_id

    @staticmethod
    def _result_payload(result) -> dict[str, Any]:
        """一覧APIでは全文を返さず、生成時はサーバー側の原本を利用する。"""

        payload = result.to_dict()
        payload.pop("body", None)
        if payload.get("lead"):
            payload["lead"] = str(payload["lead"])[:500]
        return payload

    @staticmethod
    def _plan_start(payload: Mapping[str, Any]) -> tuple[int, int]:
        from datetime import date

        today = date.today()
        raw = str(payload.get("start_year_month", "")).strip()
        if not raw:
            return today.year, today.month
        try:
            year_text, month_text = raw.split("-", 1)
            year = int(year_text)
            month = int(month_text)
        except (ValueError, TypeError) as exc:
            raise ValueError("start_year_monthはYYYY-MM形式で指定してください") from exc
        if not 2000 <= year <= 2100 or not 1 <= month <= 12:
            raise ValueError("start_year_monthが不正です")
        return year, month

    def _context(self, payload: Mapping[str, Any]) -> SearchContext:
        if not isinstance(payload, Mapping):
            raise ValueError("JSONオブジェクトを送信してください")
        company_id = _as_company_id(payload.get("company_id"))
        company = self.repository.get_company(company_id)
        if company is None:
            raise ValueError("対象企業が見つかりません")

        goal = str(payload.get("goal", "")).strip()[:300]
        if not goal:
            raise ValueError("広報目的を入力してください")
        facts = _as_facts(payload.get("facts"))
        if not facts:
            raise ValueError("発表可能な事実を1件以上入力してください")
        mode = str(payload.get("mode", "balanced")).strip().casefold()
        if mode not in {"balanced", "same_industry", "cross_industry"}:
            raise ValueError("検索モードが不正です")

        return SearchContext(
            target_company_id=company.company_id,
            company_name=company.name,
            company_description=company.description or "",
            industry=company.industry,
            goal=goal,
            facts=facts,
            desired_month=_as_month(payload.get("desired_month")),
            mode=mode,
        )

    @staticmethod
    def _confirmed_months(
        payload: Mapping[str, Any],
        context: SearchContext,
    ) -> tuple[int, ...]:
        raw = payload.get("confirmed_months")
        if raw is None:
            return ()
        if not isinstance(raw, (list, tuple)):
            raise ValueError("confirmed_monthsは月の配列で指定してください")
        months = tuple(_as_month(value) for value in raw)
        return tuple(dict.fromkeys(months))


def build_service() -> ApplicationService:
    requested_mode = os.getenv("PR_DATA_MODE", "auto").strip().casefold()
    if requested_mode == "demo":
        repository: ReleaseRepository = DemoRepository()
    elif requested_mode == "postgres":
        repository = PostgresRepository.from_env()
    elif requested_mode == "auto":
        repository = repository_from_env()
    else:
        raise ValueError("PR_DATA_MODEはauto、demo、postgresのいずれかを指定してください")

    data_mode = "postgres" if isinstance(repository, PostgresRepository) else "demo"
    embedding_provider = os.getenv("PR_EMBEDDING_PROVIDER", "local").strip().casefold()
    if embedding_provider == "openai":
        embedder = OpenAIEmbedder(
            model=os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
        )
    elif embedding_provider == "local":
        embedder = HashingEmbedder()
    else:
        raise ValueError("PR_EMBEDDING_PROVIDERはlocalまたはopenaiを指定してください")
    return ApplicationService(
        repository,
        SearchEngine(repository, embedder),
        data_mode=data_mode,
    )


__all__ = ["ApplicationService", "build_service"]
