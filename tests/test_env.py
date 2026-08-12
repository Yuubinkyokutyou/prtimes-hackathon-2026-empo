from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from pr_recommender.env import load_env_file


class EnvFileTests(unittest.TestCase):
    def test_loads_literals_without_overriding_process_environment(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text(
                "OPENAI_API_KEY='secret-from-file'\n"
                "PR_GENERATION_PROVIDER=openai\n"
                "# ignored\n",
                encoding="utf-8",
            )
            with patch.dict(
                os.environ,
                {"OPENAI_API_KEY": "process-secret"},
                clear=False,
            ):
                loaded = load_env_file(path)
                self.assertEqual(os.environ["OPENAI_API_KEY"], "process-secret")
                self.assertEqual(os.environ["PR_GENERATION_PROVIDER"], "openai")
                self.assertEqual(loaded, ("PR_GENERATION_PROVIDER",))


if __name__ == "__main__":
    unittest.main()
