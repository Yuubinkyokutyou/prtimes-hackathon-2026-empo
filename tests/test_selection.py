from __future__ import annotations

import io
import json
import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from pr_recommender.selection import (
    OpenAIPatternSelector,
    PatternSelectionError,
    SelectionCandidate,
    SelectionContext,
)


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


CONTEXT = SelectionContext(
    company_name="株式会社デモ",
    industry="情報通信業",
    company_description="広報支援サービス",
    own_release_titles=("新サービスを開始",),
)
CANDIDATES = (
    SelectionCandidate(
        candidate_id="milestone",
        pattern="利用者数の節目",
        family="実績・節目",
        description="利用者数を節目として発信する",
        source_release_title="新サービスを開始",
        reference_company_name="参考社A",
        reference_release_title="利用者1万人を突破",
        semantic_similarity=0.8,
        local_score=0.7,
    ),
    SelectionCandidate(
        candidate_id="survey",
        pattern="独自調査",
        family="調査・データ",
        description="顧客接点を調査として発信する",
        source_release_title="新サービスを開始",
        reference_company_name="参考社B",
        reference_release_title="業界調査を公開",
        semantic_similarity=0.7,
        local_score=0.6,
    ),
)


class OpenAIPatternSelectorTests(unittest.TestCase):
    def test_uses_strict_schema_and_returns_only_known_candidates(self) -> None:
        captured = {}

        def opener(request, *, timeout):
            captured["payload"] = json.loads(request.data.decode("utf-8"))
            captured["timeout"] = timeout
            response = {
                "output": [
                    {
                        "type": "message",
                        "content": [
                            {
                                "type": "output_text",
                                "text": json.dumps(
                                    {
                                        "selections": [
                                            {
                                                "candidate_id": "survey",
                                                "rationale": "顧客接点を調査へ展開できます。",
                                            }
                                        ]
                                    },
                                    ensure_ascii=False,
                                ),
                            }
                        ],
                    }
                ]
            }
            return FakeResponse(json.dumps(response).encode("utf-8"))

        selector = OpenAIPatternSelector(api_key="test-key", opener=opener)
        decisions = selector.select(CANDIDATES, CONTEXT, limit=1)

        self.assertEqual(decisions[0].candidate_id, "survey")
        self.assertFalse(captured["payload"]["store"])
        output_format = captured["payload"]["text"]["format"]
        self.assertTrue(output_format["strict"])
        self.assertEqual(
            output_format["schema"]["properties"]["selections"]["minItems"],
            1,
        )

    def test_rejects_duplicate_candidate_ids(self) -> None:
        response = {
            "output_text": json.dumps(
                {
                    "selections": [
                        {"candidate_id": "survey", "rationale": "理由1"},
                        {"candidate_id": "survey", "rationale": "理由2"},
                    ]
                },
                ensure_ascii=False,
            )
        }
        selector = OpenAIPatternSelector(
            api_key="test-key",
            opener=lambda *_args, **_kwargs: FakeResponse(json.dumps(response).encode()),
        )
        with self.assertRaises(PatternSelectionError):
            selector.select(CANDIDATES, CONTEXT, limit=2)


if __name__ == "__main__":
    unittest.main()
