from __future__ import annotations

import builtins
import json
import os
import sys
import unittest
from dataclasses import replace
from datetime import datetime
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = PROJECT_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from pr_recommender.embeddings import HashingEmbedder, OpenAIEmbedder  # noqa: E402
from pr_recommender.models import SearchContext  # noqa: E402
from pr_recommender.repository import (  # noqa: E402
    DatabaseConfigurationError,
    DatabaseDriverError,
    DemoRepository,
    PostgresRepository,
)
from pr_recommender.search import (  # noqa: E402
    CROSS_INDUSTRY_BUCKET,
    RERANK_WEIGHTS,
    SAME_INDUSTRY_BUCKET,
    SearchEngine,
    cosine_similarity,
)


class DemoRepositoryTests(unittest.TestCase):
    def test_demo_has_rich_composite_key_data(self) -> None:
        repository = DemoRepository()
        companies = repository.list_companies()
        releases = repository.list_releases()

        self.assertGreaterEqual(len(companies), 6)
        self.assertGreaterEqual(len(releases), 18)
        self.assertEqual(
            len(releases),
            len({(release.company_id, release.release_id) for release in releases}),
        )
        self.assertLess(
            len({release.release_id for release in releases}),
            len(releases),
            "release_id単独が一意になっていると複合キーを検証できない",
        )
        for release in releases:
            self.assertTrue(release.categories)
            self.assertTrue(release.keywords)
            self.assertIsNotNone(release.page_view)
            self.assertIsNotNone(release.unique_user)
            self.assertIsNotNone(release.like_count)

    def test_lookup_uses_company_and_release_id(self) -> None:
        repository = DemoRepository()
        first = repository.get_release(900001, 1)
        another_company = repository.get_release(900002, 1)
        self.assertIsNotNone(first)
        self.assertIsNotNone(another_company)
        self.assertNotEqual(first.key, another_company.key)  # type: ignore[union-attr]

    def test_postgres_configuration_and_driver_errors_are_clear(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(DatabaseConfigurationError):
                PostgresRepository()

        repository = PostgresRepository("postgresql://example.invalid/demo")
        real_import = builtins.__import__

        def missing_psycopg(name: str, *args: object, **kwargs: object) -> object:
            if name == "psycopg":
                raise ModuleNotFoundError("No module named 'psycopg'")
            return real_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=missing_psycopg):
            with self.assertRaisesRegex(DatabaseDriverError, "psycopg"):
                repository._load_driver()


class EmbeddingTests(unittest.TestCase):
    def test_hashing_embedder_is_deterministic_and_japanese_aware(self) -> None:
        embedder = HashingEmbedder(dimensions=256)
        query = embedder.embed_query("広報DXでプレスリリース作成を支援")
        same = embedder.embed_query("プレスリリース作成を支援する広報DXサービス")
        unrelated = embedder.embed_query("国産豆を使った植物由来のお菓子")

        self.assertEqual(query, embedder.embed_query("広報DXでプレスリリース作成を支援"))
        self.assertEqual(len(query), 256)
        self.assertGreater(
            cosine_similarity(query, same),
            cosine_similarity(query, unrelated),
        )

    def test_openai_embedder_can_be_tested_without_network(self) -> None:
        calls: list[tuple[str, float]] = []

        class FakeResponse:
            def __enter__(self) -> "FakeResponse":
                return self

            def __exit__(self, *args: object) -> None:
                return None

            def read(self) -> bytes:
                # API順序が逆でもindexで入力順に戻ることを確認する。
                return json.dumps(
                    {
                        "data": [
                            {"index": 1, "embedding": [0.0, 1.0]},
                            {"index": 0, "embedding": [1.0, 0.0]},
                        ]
                    }
                ).encode()

        def fake_urlopen(request: object, timeout: float) -> FakeResponse:
            calls.append((request.full_url, timeout))  # type: ignore[attr-defined]
            payload = json.loads(request.data)  # type: ignore[attr-defined]
            self.assertEqual(payload["input"], ["一", "二"])
            return FakeResponse()

        embedder = OpenAIEmbedder(
            "test-key",
            base_url="https://api.example/v1",
            urlopen=fake_urlopen,
        )
        vectors = embedder.embed_documents(["一", "二"])
        self.assertEqual(vectors, [(1.0, 0.0), (0.0, 1.0)])
        self.assertEqual(calls, [("https://api.example/v1/embeddings", 30.0)])


class SearchEngineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repository = DemoRepository()
        self.engine = SearchEngine(
            self.repository,
            HashingEmbedder(dimensions=512),
        )
        self.context = SearchContext(
            target_company_id=900001,
            company_name="株式会社デモ青空",
            company_description="AIとデータで広報業務を支援する情報通信企業",
            industry="情報通信業",
            goal="既存プレスリリースから類似の他社事例を紹介し、次の広報ネタを提案する",
            facts=("広報DX", "プレスリリース作成", "広報効果測定", "AI"),
            desired_month=8,
        )
        self.as_of = datetime(2026, 8, 12, 23, 59, 59)

    def test_weights_are_the_requested_formula(self) -> None:
        self.assertEqual(
            dict(RERANK_WEIGHTS),
            {
                "semantic": 0.55,
                "industry": 0.15,
                "category": 0.10,
                "keyword": 0.08,
                "release_type": 0.07,
                "seasonality": 0.05,
            },
        )
        self.assertAlmostEqual(sum(RERANK_WEIGHTS.values()), 1.0)

    def test_search_excludes_self_and_returns_two_buckets(self) -> None:
        results = self.engine.search(
            self.context,
            per_bucket=3,
            as_of=self.as_of,
        )

        self.assertEqual(len(results), 6)
        self.assertTrue(all(item.release.company_id != 900001 for item in results))
        buckets = {item.bucket for item in results}
        self.assertEqual(buckets, {SAME_INDUSTRY_BUCKET, CROSS_INDUSTRY_BUCKET})
        self.assertTrue(
            all(
                item.release.industry == "情報通信業"
                for item in results
                if item.bucket == SAME_INDUSTRY_BUCKET
            )
        )
        self.assertTrue(
            all(
                item.release.industry != "情報通信業"
                for item in results
                if item.bucket == CROSS_INDUSTRY_BUCKET
            )
        )

    def test_reasons_percentile_and_scores_are_explainable(self) -> None:
        results = self.engine.search(self.context, as_of=self.as_of)
        self.assertTrue(results)
        for item in results:
            self.assertGreaterEqual(item.semantic_similarity, 0.0)
            self.assertLessEqual(item.semantic_similarity, 1.0)
            self.assertGreaterEqual(item.final_score, 0.0)
            self.assertLessEqual(item.final_score, 1.0)
            self.assertGreaterEqual(len(item.reasons), 2)
            self.assertTrue(
                any("同業種" in reason or "異業種" in reason for reason in item.reasons)
            )
            self.assertIsNotNone(item.outcome_percentile)
            self.assertGreaterEqual(item.outcome_percentile, 0.0)  # type: ignore[operator]
            self.assertLessEqual(item.outcome_percentile, 1.0)  # type: ignore[operator]

    def test_mmr_keeps_same_industry_results_company_diverse(self) -> None:
        results = self.engine.search(self.context, as_of=self.as_of)
        same_industry = [
            item for item in results if item.bucket == SAME_INDUSTRY_BUCKET
        ]
        self.assertEqual(len(same_industry), 3)
        self.assertGreaterEqual(
            len({item.release.company_id for item in same_industry}),
            2,
        )

    def test_mode_can_select_only_one_bucket(self) -> None:
        context = replace(self.context, mode="creative")
        results = self.engine.search(context, as_of=self.as_of)
        self.assertTrue(results)
        self.assertTrue(
            all(item.bucket == CROSS_INDUSTRY_BUCKET for item in results)
        )

    def test_unpublished_and_future_releases_are_filtered(self) -> None:
        companies = self.repository.list_companies()
        base = self.repository.get_release(900101, 1)
        assert base is not None
        future = replace(
            base,
            release_id=98,
            created_at=datetime(2026, 9, 1),
            title="未来の広報DXリリース",
        )
        undated = replace(
            base,
            release_id=99,
            created_at=None,
            title="公開日未定の広報DXリリース",
        )
        repository = DemoRepository(
            companies=companies,
            releases=self.repository.list_releases() + (future, undated),
        )
        results = SearchEngine(repository, HashingEmbedder(dimensions=256)).search(
            self.context,
            candidate_limit=100,
            per_bucket=20,
            as_of=self.as_of,
        )
        result_keys = {item.release.key for item in results}
        self.assertNotIn(future.key, result_keys)
        self.assertNotIn(undated.key, result_keys)


if __name__ == "__main__":
    unittest.main()
