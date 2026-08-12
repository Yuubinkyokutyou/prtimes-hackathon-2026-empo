from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from pr_recommender.service import build_service


PAYLOAD = {
    "company_id": 900001,
    "goal": "新サービスの認知獲得",
    "facts": ["9月に新機能のβ版を公開できる", "利用企業のコメントを取得予定"],
    "desired_month": 9,
    "mode": "balanced",
}


class ApplicationServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.environment = patch.dict(
            os.environ,
            {
                "PR_DATA_MODE": "auto",
                "PR_DATABASE_URL": "",
                "PR_EMBEDDING_PROVIDER": "local",
                "PR_GENERATION_PROVIDER": "local",
                "OPENAI_API_KEY": "",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.service = build_service()

    def test_bootstrap_exposes_demo_companies(self) -> None:
        payload = self.service.bootstrap()
        self.assertEqual(payload["mode"], "demo")
        self.assertTrue(payload["demo_mode"])
        self.assertGreaterEqual(len(payload["companies"]), 6)

    def test_search_returns_grounded_other_company_results(self) -> None:
        payload = self.service.search(PAYLOAD)
        self.assertEqual(len(payload["results"]), 6)
        self.assertTrue(
            all(item["company_id"] != PAYLOAD["company_id"] for item in payload["results"])
        )
        self.assertTrue(all(item["reasons"] for item in payload["results"]))
        self.assertTrue(all("body" not in item for item in payload["results"]))

    def test_one_click_recommendations_use_unseen_grounded_patterns(self) -> None:
        payload = self.service.recommendations({"company_id": 900001, "limit": 3})
        self.assertEqual(payload["company"]["company_id"], 900001)
        self.assertEqual(payload["analysis"]["release_count"], 3)
        self.assertEqual(payload["analysis"]["catalog_size"], 12)
        self.assertEqual(payload["analysis"]["selection_provider"], "local")
        self.assertEqual(len(payload["recommendations"]), 3)
        used = set(payload["analysis"]["used_patterns"])
        families = set()
        for proposal in payload["recommendations"]:
            self.assertEqual(proposal["source_release"]["company_id"], 900001)
            self.assertNotEqual(proposal["reference_release"]["company_id"], 900001)
            self.assertTrue(proposal["required_facts"])
            self.assertNotIn(proposal["family"], used)
            families.add(proposal["family"])
        self.assertEqual(len(families), 3)

    def test_ideas_have_reference_keys_and_required_facts(self) -> None:
        payload = self.service.ideas(PAYLOAD)
        self.assertEqual(len(payload["ideas"]), 3)
        for idea in payload["ideas"]:
            self.assertTrue(idea["reference_release_keys"])
            self.assertTrue(idea["required_facts"])

    def test_plan_has_twelve_items_and_only_confirmed_publication_month(self) -> None:
        ideas = self.service.ideas(PAYLOAD)
        payload = self.service.plan(
            {
                **PAYLOAD,
                "idea_set_id": ideas["idea_set_id"],
                "selected_release_keys": [
                    item["key"] for item in ideas["results"]
                ],
                "confirmed_months": [9],
                "start_year_month": "2026-08",
            }
        )
        self.assertEqual(len(payload["items"]), 12)
        candidate_months = [
            item["month"]
            for item in payload["items"]
            if item["status"] != "Preparation"
        ]
        self.assertEqual(candidate_months, [9])
        self.assertEqual(payload["items"][0]["year"], 2026)
        self.assertEqual(payload["items"][0]["month"], 8)

    def test_plan_requires_the_exact_idea_snapshot(self) -> None:
        ideas = self.service.ideas(PAYLOAD)
        with self.assertRaisesRegex(ValueError, "参考事例が変更"):
            self.service.plan(
                {
                    **PAYLOAD,
                    "idea_set_id": ideas["idea_set_id"],
                    "selected_release_keys": [ideas["results"][0]["key"]],
                }
            )

    def test_mixed_valid_and_forged_reference_keys_are_rejected(self) -> None:
        results = self.service.search(PAYLOAD)["results"]
        with self.assertRaisesRegex(ValueError, "検索結果にない"):
            self.service.ideas(
                {
                    **PAYLOAD,
                    "selected_release_keys": [results[0]["key"], "999999:1"],
                }
            )

    def test_missing_facts_is_rejected(self) -> None:
        invalid = {**PAYLOAD, "facts": []}
        with self.assertRaisesRegex(ValueError, "発表可能な事実"):
            self.service.search(invalid)

    def test_demo_mode_can_be_forced_even_when_database_url_exists(self) -> None:
        with patch.dict(
            os.environ,
            {
                "PR_DATA_MODE": "demo",
                "PR_DATABASE_URL": "postgresql://unused.example/prtimes",
            },
        ):
            service = build_service()
        self.assertEqual(service.bootstrap()["mode"], "demo")


if __name__ == "__main__":
    unittest.main()
