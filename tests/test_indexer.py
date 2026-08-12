from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = PROJECT_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from pr_recommender import indexer  # noqa: E402


class _Result:
    def __init__(self, rows: list[tuple[object, ...]] | None = None) -> None:
        self.rows = rows or []

    def fetchone(self) -> tuple[object, ...] | None:
        return self.rows[0] if self.rows else None

    def fetchall(self) -> list[tuple[object, ...]]:
        return list(self.rows)


class _Transaction:
    def __init__(self, connection: "_Connection") -> None:
        self.connection = connection

    def __enter__(self) -> "_Transaction":
        self.connection.transaction_depth += 1
        self.connection.transaction_entries += 1
        return self

    def __exit__(self, *args: object) -> None:
        self.connection.transaction_depth -= 1


class _Connection:
    def __init__(
        self,
        *,
        feature_rows: list[tuple[object, ...]],
        existing_rows: list[tuple[object, ...]],
        lock_available: bool = True,
    ) -> None:
        self.feature_rows = feature_rows
        self.existing_rows = existing_rows
        self.lock_available = lock_available
        self.transaction_depth = 0
        self.transaction_entries = 0
        self.calls: list[tuple[str, tuple[object, ...], bool]] = []
        self.inserted: list[tuple[object, ...]] = []
        self.refreshed = False
        self.unlocked = False

    @property
    def in_transaction(self) -> bool:
        return self.transaction_depth > 0

    def __enter__(self) -> "_Connection":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def transaction(self) -> _Transaction:
        return _Transaction(self)

    def execute(
        self,
        sql: str,
        params: tuple[object, ...] = (),
    ) -> _Result:
        normalised = " ".join(sql.split())
        self.calls.append((normalised, params, self.in_transaction))
        if "pg_try_advisory_lock" in normalised:
            return _Result([(self.lock_available,)])
        if normalised.startswith("REFRESH MATERIALIZED VIEW CONCURRENTLY"):
            self.refreshed = True
            self.assert_outside_transaction("REFRESH")
            return _Result()
        if normalised.startswith("SELECT company_id, release_id, search_text"):
            self.assert_outside_transaction("feature SELECT")
            return _Result(self.feature_rows)
        if normalised.startswith("SELECT company_id, release_id, source_hash"):
            self.assert_outside_transaction("hash SELECT")
            return _Result(self.existing_rows)
        if normalised.startswith("INSERT INTO pr_ai.release_embedding"):
            if not self.in_transaction:
                raise AssertionError("upsert must run in a short transaction")
            self.inserted.append(params)
            return _Result([(1,)])
        if "pg_advisory_unlock" in normalised:
            self.unlocked = True
            return _Result([(True,)])
        raise AssertionError(f"unexpected SQL: {normalised}")

    def assert_outside_transaction(self, operation: str) -> None:
        if self.in_transaction:
            raise AssertionError(f"{operation} unexpectedly ran in a transaction")


class _Driver:
    def __init__(self, connection: _Connection) -> None:
        self.connection = connection
        self.connect_calls: list[tuple[str, dict[str, object]]] = []

    def connect(self, database_url: str, **kwargs: object) -> _Connection:
        self.connect_calls.append((database_url, kwargs))
        if kwargs.get("autocommit") is not True:
            raise AssertionError("indexer connection must use autocommit")
        return self.connection


class _Embedder:
    model_id = "fake:1536"

    def __init__(self, connection: _Connection, *, wrong_dimensions: bool = False) -> None:
        self.connection = connection
        self.wrong_dimensions = wrong_dimensions
        self.calls: list[list[str]] = []

    def embed_documents(self, texts: list[str]) -> list[tuple[float, ...]]:
        if self.connection.in_transaction:
            raise AssertionError("embedding must run outside a DB transaction")
        self.calls.append(list(texts))
        dimensions = 10 if self.wrong_dimensions else indexer.EMBEDDING_DIMENSIONS
        return [tuple([1.0] + [0.0] * (dimensions - 1)) for _ in texts]


class _NeverEmbedder(_Embedder):
    def embed_documents(self, texts: list[str]) -> list[tuple[float, ...]]:
        raise AssertionError("unchanged rows must not be embedded")


class IndexerTests(unittest.TestCase):
    cutoff = datetime(2026, 8, 12, 21, 0, 0)

    def _run(
        self,
        connection: _Connection,
        embedder: _Embedder,
        *,
        batch_size: int = 32,
    ) -> dict[str, int | str]:
        driver = _Driver(connection)
        with (
            patch.object(
                indexer.PostgresRepository,
                "_load_driver",
                return_value=driver,
            ),
            patch.object(indexer, "_build_embedder", return_value=embedder),
        ):
            result = indexer.index_embeddings(
                "postgresql://test.invalid/prtimes",
                provider="local",
                batch_size=batch_size,
                as_of=self.cutoff,
            )
        self.assertEqual(
            driver.connect_calls,
            [("postgresql://test.invalid/prtimes", {"autocommit": True})],
        )
        return result

    def test_only_missing_or_changed_published_rows_are_embedded(self) -> None:
        same_text = "変更なし"
        changed_text = "変更後の本文"
        missing_text = "新規本文"
        connection = _Connection(
            feature_rows=[
                (1, 1, same_text, datetime(2026, 8, 1)),
                (1, 2, changed_text, datetime(2026, 8, 2)),
                (2, 1, missing_text, datetime(2026, 8, 3)),
                # SQLが将来変更されてもPython側の防御で外部送信しない。
                (2, 2, "未来の予約稿", datetime(2026, 9, 1)),
                (2, 3, "日時未設定の下書き", None),
            ],
            existing_rows=[
                (1, 1, indexer._source_hash(same_text)),
                (1, 2, indexer._source_hash("変更前の本文")),
            ],
        )
        embedder = _Embedder(connection)

        result = self._run(connection, embedder, batch_size=10)

        self.assertEqual(embedder.calls, [[changed_text, missing_text]])
        self.assertEqual(result["releases"], 3)
        self.assertEqual(result["inserted_or_updated"], 2)
        self.assertEqual(result["unchanged"], 1)
        self.assertEqual(len(connection.inserted), 2)
        indexed_keys = {(row[0], row[1]) for row in connection.inserted}
        self.assertEqual(indexed_keys, {(1, 2), (2, 1)})
        self.assertTrue(connection.refreshed)
        self.assertTrue(connection.unlocked)
        self.assertEqual(connection.transaction_entries, 1)

    def test_unchanged_run_makes_no_embedding_call_or_write(self) -> None:
        text = "既に埋め込み済み"
        connection = _Connection(
            feature_rows=[(10, 20, text, datetime(2026, 8, 1))],
            existing_rows=[(10, 20, indexer._source_hash(text))],
        )
        embedder = _NeverEmbedder(connection)

        result = self._run(connection, embedder)

        self.assertEqual(result["inserted_or_updated"], 0)
        self.assertEqual(result["unchanged"], 1)
        self.assertEqual(connection.inserted, [])
        self.assertEqual(connection.transaction_entries, 0)

    def test_each_batch_uses_a_short_transaction_after_embedding(self) -> None:
        connection = _Connection(
            feature_rows=[
                (1, 1, "一件目", datetime(2026, 8, 1)),
                (1, 2, "二件目", datetime(2026, 8, 2)),
            ],
            existing_rows=[],
        )
        embedder = _Embedder(connection)

        result = self._run(connection, embedder, batch_size=1)

        self.assertEqual(embedder.calls, [["一件目"], ["二件目"]])
        self.assertEqual(connection.transaction_entries, 2)
        self.assertEqual(result["inserted_or_updated"], 2)

    def test_lock_contention_fails_before_refresh_or_embedding(self) -> None:
        connection = _Connection(
            feature_rows=[],
            existing_rows=[],
            lock_available=False,
        )
        embedder = _NeverEmbedder(connection)

        with self.assertRaisesRegex(RuntimeError, "indexerが実行中"):
            self._run(connection, embedder)

        self.assertFalse(connection.refreshed)
        self.assertFalse(connection.unlocked)

    def test_dimension_mismatch_rolls_back_before_any_upsert(self) -> None:
        connection = _Connection(
            feature_rows=[(1, 1, "本文", datetime(2026, 8, 1))],
            existing_rows=[],
        )
        embedder = _Embedder(connection, wrong_dimensions=True)

        with self.assertRaisesRegex(ValueError, "1536次元"):
            self._run(connection, embedder)

        self.assertEqual(connection.inserted, [])
        self.assertEqual(connection.transaction_entries, 0)
        self.assertTrue(connection.unlocked)

    def test_aware_cutoff_is_converted_to_jst_wall_clock(self) -> None:
        utc_cutoff = datetime(2026, 8, 12, 12, 0, tzinfo=timezone.utc)
        self.assertEqual(
            indexer._as_jst_wall_clock(utc_cutoff),
            datetime(2026, 8, 12, 21, 0),
        )


class SqlAndComposeAssetTests(unittest.TestCase):
    def test_search_sql_is_persistent_and_filters_unpublished_rows(self) -> None:
        feature_sql = (PROJECT_ROOT / "sql" / "01_search_features.sql").read_text(
            encoding="utf-8"
        )
        vector_sql = (PROJECT_ROOT / "sql" / "02_pgvector.sql").read_text(
            encoding="utf-8"
        )
        self.assertIn("r.created_at IS NOT NULL", feature_sql)
        self.assertIn("AT TIME ZONE 'Asia/Tokyo'", feature_sql)
        self.assertIn("'本文: ' || left(r.body, 1800)", feature_sql)
        self.assertIn("CREATE OR REPLACE FUNCTION pr_ai.find_similar_exact", vector_sql)
        self.assertNotIn("PREPARE pr_ai_find_similar_exact", vector_sql)
        self.assertIn("f.created_at IS NOT NULL", vector_sql)
        self.assertIn("WITH distances AS MATERIALIZED", vector_sql)

    def test_compose_ports_are_loopback_only_and_pgadmin_is_pinned(self) -> None:
        compose = (PROJECT_ROOT / "compose.yaml").read_text(encoding="utf-8")
        self.assertIn('"127.0.0.1:55432:5432"', compose)
        self.assertIn('"127.0.0.1:5050:80"', compose)
        self.assertIn(
            "./seed.sql:/docker-entrypoint-initdb.d/05_seed.sql:ro",
            compose,
        )
        self.assertIn("./sql:/workspace/sql:ro", compose)
        self.assertIn("image: dpage/pgadmin4:9.16", compose)
        self.assertNotIn("dpage/pgadmin4:latest", compose)

    def test_existing_database_migration_preserves_embedding_table(self) -> None:
        migration = (
            PROJECT_ROOT
            / "sql"
            / "migrations"
            / "20260812_rebuild_search_features.sql"
        ).read_text(encoding="utf-8")
        self.assertIn("BEGIN;", migration)
        self.assertIn("CREATE EXTENSION IF NOT EXISTS vector", migration)
        self.assertIn("DROP FUNCTION IF EXISTS pr_ai.find_similar_exact", migration)
        self.assertIn(
            "DROP MATERIALIZED VIEW IF EXISTS pr_ai.release_search_features",
            migration,
        )
        self.assertIn("\\ir ../01_search_features.sql", migration)
        self.assertIn("\\ir ../02_pgvector.sql", migration)
        self.assertNotIn("DROP TABLE", migration)
        self.assertNotIn("CASCADE", migration.replace("Do not use CASCADE", ""))


if __name__ == "__main__":
    unittest.main()
