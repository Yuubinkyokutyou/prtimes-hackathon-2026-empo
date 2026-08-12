"""PostgreSQL/pgvectorへリリース埋め込みを差分投入するCLI。"""

from __future__ import annotations

import argparse
import hashlib
import os
from collections.abc import Sequence
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from .embeddings import HashingEmbedder, OpenAIEmbedder
from .repository import PostgresRepository


EMBEDDING_DIMENSIONS = 1536
JST = ZoneInfo("Asia/Tokyo")
# ASCII "PR_AI_IN"。同じDBでindexerを二重起動しないためのsession lock ID。
INDEXER_ADVISORY_LOCK_ID = 0x50525F41495F494E


def _vector_literal(values: Sequence[float]) -> str:
    return "[" + ",".join(format(float(value), ".9g") for value in values) + "]"


def _as_jst_wall_clock(value: datetime | None = None) -> datetime:
    """timestamp without time zone と比較するJSTの壁時計を返す。"""

    moment = value or datetime.now(JST)
    if moment.tzinfo is not None:
        moment = moment.astimezone(JST).replace(tzinfo=None)
    return moment


def _source_hash(search_text: str) -> str:
    return hashlib.sha256(search_text.encode("utf-8")).hexdigest()


def _build_embedder(provider: str, batch_size: int) -> Any:
    provider = provider.strip().casefold()
    if provider == "openai":
        return OpenAIEmbedder(
            model=os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"),
            batch_size=batch_size,
        )
    if provider == "local":
        # SQLのvector(1536)と同じ次元・model_idに統一する。
        return HashingEmbedder(dimensions=EMBEDDING_DIMENSIONS)
    raise ValueError("providerはlocalまたはopenaiを指定してください")


def index_embeddings(
    database_url: str,
    *,
    provider: str = "local",
    batch_size: int = 32,
    as_of: datetime | None = None,
) -> dict[str, int | str]:
    if batch_size < 1:
        raise ValueError("batch_sizeは1以上にしてください")

    cutoff = _as_jst_wall_clock(as_of)
    embedder = _build_embedder(provider, batch_size)
    psycopg = PostgresRepository._load_driver()
    inserted_or_updated = 0
    lock_acquired = False

    # autocommitによりREFRESHと読み取りはtransactionを外し、外部API待ちの間も
    # idle in transactionを作らない。advisory lockはsession単位なので保持される。
    with psycopg.connect(database_url, autocommit=True) as connection:
        try:
            lock_row = connection.execute(
                "SELECT pg_try_advisory_lock(%s)",
                (INDEXER_ADVISORY_LOCK_ID,),
            ).fetchone()
            lock_acquired = bool(lock_row and lock_row[0])
            if not lock_acquired:
                raise RuntimeError("別の埋め込みindexerが実行中です")

            # 検索表示と埋め込み入力を同じcanonical search_textへ揃える。
            connection.execute(
                "REFRESH MATERIALIZED VIEW CONCURRENTLY "
                "pr_ai.release_search_features"
            )
            feature_rows = connection.execute(
                """
                SELECT company_id, release_id, search_text, created_at
                FROM pr_ai.release_search_features
                WHERE created_at IS NOT NULL
                  AND created_at <= %s::timestamp without time zone
                ORDER BY company_id, release_id
                """,
                (cutoff,),
            ).fetchall()
            existing_rows = connection.execute(
                """
                SELECT company_id, release_id, source_hash
                FROM pr_ai.release_embedding
                WHERE embedding_model = %s
                """,
                (embedder.model_id,),
            ).fetchall()
            existing_hashes = {
                (company_id, release_id): source_hash
                for company_id, release_id, source_hash in existing_rows
            }

            # SQL条件に加えPython側でもNULL/未来を除外し、fake/testや将来の
            # view定義変更でも未公開稿を外部providerへ送らない。
            eligible: list[tuple[int, int, str, str]] = []
            for company_id, release_id, search_text, created_at in feature_rows:
                if created_at is None or _as_jst_wall_clock(created_at) > cutoff:
                    continue
                digest = _source_hash(search_text)
                eligible.append((company_id, release_id, search_text, digest))

            changed = [
                item
                for item in eligible
                if existing_hashes.get((item[0], item[1])) != item[3]
            ]
            unchanged = len(eligible) - len(changed)

            for offset in range(0, len(changed), batch_size):
                batch = changed[offset : offset + batch_size]
                texts = [item[2] for item in batch]

                # 外部通信/重いローカル計算はtransaction開始前に完了させる。
                vectors = embedder.embed_documents(texts)
                if len(vectors) != len(batch):
                    raise ValueError("埋め込みの返却件数が入力件数と一致しません")
                for vector in vectors:
                    if len(vector) != EMBEDDING_DIMENSIONS:
                        raise ValueError(
                            f"{embedder.model_id}の次元は{len(vector)}です。"
                            f"DB列の{EMBEDDING_DIMENSIONS}次元と一致しません。"
                        )

                # 1バッチだけの短いtransaction。後続API失敗でも完了分を残す。
                with connection.transaction():
                    for item, vector in zip(batch, vectors, strict=True):
                        company_id, release_id, _text, digest = item
                        result = connection.execute(
                            """
                            INSERT INTO pr_ai.release_embedding
                                (company_id, release_id, embedding_model,
                                 embedding, source_hash)
                            VALUES (%s, %s, %s, %s::vector, %s)
                            ON CONFLICT (company_id, release_id, embedding_model)
                            DO UPDATE SET
                                embedding = excluded.embedding,
                                source_hash = excluded.source_hash,
                                embedded_at = current_timestamp
                            WHERE pr_ai.release_embedding.source_hash
                                  <> excluded.source_hash
                            RETURNING 1
                            """,
                            (
                                company_id,
                                release_id,
                                embedder.model_id,
                                _vector_literal(vector),
                                digest,
                            ),
                        ).fetchone()
                        if result is None:
                            unchanged += 1
                        else:
                            inserted_or_updated += 1
        finally:
            if lock_acquired:
                connection.execute(
                    "SELECT pg_advisory_unlock(%s)",
                    (INDEXER_ADVISORY_LOCK_ID,),
                ).fetchone()

    return {
        "releases": len(eligible),
        "inserted_or_updated": inserted_or_updated,
        "unchanged": unchanged,
        "model": embedder.model_id,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="リリースをpgvectorへ差分投入します。")
    parser.add_argument(
        "--database-url",
        default=os.getenv("PR_DATABASE_URL", ""),
        help="PostgreSQL DSN（既定: PR_DATABASE_URL）",
    )
    parser.add_argument(
        "--provider",
        choices=("local", "openai"),
        default=os.getenv("PR_EMBEDDING_PROVIDER", "local"),
    )
    parser.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args(argv)
    if not args.database_url:
        parser.error("--database-urlまたはPR_DATABASE_URLが必要です")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    result = index_embeddings(
        args.database_url,
        provider=args.provider,
        batch_size=args.batch_size,
    )
    print(
        "indexed={inserted_or_updated} unchanged={unchanged} total={releases} "
        "model={model}".format(**result),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
