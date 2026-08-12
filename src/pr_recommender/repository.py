"""リリース取得をデモデータとPostgreSQLで差し替えるリポジトリ。"""

from __future__ import annotations

import os
import threading
import time
from collections.abc import Iterable
from datetime import datetime
from typing import Any, Protocol, runtime_checkable

from .demo_data import DEMO_COMPANIES, DEMO_RELEASES
from .models import Company, Release


class DatabaseConfigurationError(RuntimeError):
    """PostgreSQL接続設定が不足している。"""


class DatabaseDriverError(RuntimeError):
    """任意依存のPostgreSQLドライバを読み込めない。"""


@runtime_checkable
class ReleaseRepository(Protocol):
    """検索エンジンが必要とする最小の読み取り契約。"""

    def list_companies(self) -> tuple[Company, ...]: ...

    def get_company(self, company_id: int) -> Company | None: ...

    def list_releases(self, company_id: int | None = None) -> tuple[Release, ...]: ...

    def get_release(self, company_id: int, release_id: int) -> Release | None: ...


class DemoRepository:
    """``init.sql`` 相当の架空データをメモリから返すリポジトリ。"""

    def __init__(
        self,
        companies: Iterable[Company] | None = None,
        releases: Iterable[Release] | None = None,
    ) -> None:
        self._companies = tuple(companies if companies is not None else DEMO_COMPANIES)
        self._releases = tuple(releases if releases is not None else DEMO_RELEASES)
        self._company_by_id = {company.company_id: company for company in self._companies}
        self._release_by_key = {
            (release.company_id, release.release_id): release for release in self._releases
        }

        if len(self._company_by_id) != len(self._companies):
            raise ValueError("company_id が重複しています")
        if len(self._release_by_key) != len(self._releases):
            raise ValueError("(company_id, release_id) が重複しています")

        unknown_company_ids = {
            release.company_id for release in self._releases
        } - self._company_by_id.keys()
        if unknown_company_ids:
            raise ValueError(
                "企業マスタに存在しないリリースがあります: "
                + ", ".join(map(str, sorted(unknown_company_ids)))
            )

    def list_companies(self) -> tuple[Company, ...]:
        return self._companies

    def get_company(self, company_id: int) -> Company | None:
        return self._company_by_id.get(company_id)

    def list_releases(self, company_id: int | None = None) -> tuple[Release, ...]:
        if company_id is None:
            return self._releases
        return tuple(
            release for release in self._releases if release.company_id == company_id
        )

    def get_release(self, company_id: int, release_id: int) -> Release | None:
        return self._release_by_key.get((company_id, release_id))


_RELEASE_SQL = """
WITH category_agg AS (
    SELECT
        rbc.company_id,
        rbc.release_id,
        array_agg(
            bc.business_category_name
            ORDER BY rbc.main_flg DESC, bc.business_category_name
        ) AS categories
    FROM release_business_category AS rbc
    JOIN business_category AS bc
      ON bc.business_category_id = rbc.business_category_id
    GROUP BY rbc.company_id, rbc.release_id
),
keyword_agg AS (
    SELECT
        rk.company_id,
        rk.release_id,
        array_agg(
            k.keyword_name
            ORDER BY rk.sort_priority DESC, k.keyword_name
        ) AS keywords
    FROM release_keyword AS rk
    JOIN keyword AS k
      ON k.keyword_id = rk.keyword_id
    GROUP BY rk.company_id, rk.release_id
),
clipping_agg AS (
    SELECT
        w.company_id,
        w.release_id,
        count(DISTINCT NULLIF(btrim(w.clipping_url), ''))::integer AS clipping_count,
        max(NULLIF(btrim(w.release_url), '')) AS release_url
    FROM webclipping_list AS w
    GROUP BY w.company_id, w.release_id
)
SELECT
    r.company_id,
    r.release_id,
    c.company_name,
    i.industry_name,
    r.title,
    r.subtitle,
    r.lead_paragraph,
    r.body,
    COALESCE(rt.release_type_name, '未分類') AS release_type_name,
    r.created_at,
    COALESCE(ca.categories, ARRAY[]::varchar[]) AS categories,
    COALESCE(ka.keywords, ARRAY[]::varchar[]) AS keywords,
    rs.page_view,
    rs.unique_user,
    rs.like_count,
    COALESCE(wa.clipping_count, 0) AS clipping_count,
    COALESCE(wa.release_url, '') AS release_url
FROM release AS r
JOIN company AS c
  ON c.company_id = r.company_id
JOIN industry AS i
  ON i.industry_id = c.industry_id
LEFT JOIN release_type AS rt
  ON rt.release_type_id = r.release_type_id
LEFT JOIN category_agg AS ca
  ON ca.company_id = r.company_id
 AND ca.release_id = r.release_id
LEFT JOIN keyword_agg AS ka
  ON ka.company_id = r.company_id
 AND ka.release_id = r.release_id
LEFT JOIN release_statistic AS rs
  ON rs.company_id = r.company_id
 AND rs.release_id = r.release_id
LEFT JOIN clipping_agg AS wa
  ON wa.company_id = r.company_id
 AND wa.release_id = r.release_id
WHERE (%s::integer IS NULL OR r.company_id = %s::integer)
  AND (%s::integer IS NULL OR r.release_id = %s::integer)
ORDER BY r.created_at DESC NULLS LAST, r.company_id, r.release_id
"""


def _pattern_for_release_type(release_type: str) -> str:
    return {
        "商品サービス": "新商品・新サービス",
        "イベント": "イベント",
        "キャンペーン": "キャンペーン",
        "経営情報": "経営・提携",
        "調査レポート": "調査・データ",
        "人物": "人物・組織",
        "その他": "コンテンツ公開",
        "上場企業決算発表": "決算",
    }.get(release_type, "その他")


class PostgresRepository:
    """既存のPostgreSQLスキーマを読み取るリポジトリ。

    ``psycopg`` はモジュールimport時には要求せず、最初のDBアクセス時だけ
    読み込む。MVPをデモモードで動かす場合、PostgreSQL依存は不要である。
    """

    def __init__(self, database_url: str | None = None) -> None:
        self._database_url = database_url or os.getenv("PR_DATABASE_URL", "")
        if not self._database_url.strip():
            raise DatabaseConfigurationError(
                "PostgreSQLを使うには PR_DATABASE_URL を設定してください。"
            )
        try:
            self._cache_seconds = max(
                0.0,
                float(os.getenv("PR_DB_CACHE_SECONDS", "30")),
            )
        except ValueError as exc:
            raise DatabaseConfigurationError(
                "PR_DB_CACHE_SECONDSは0以上の数値で指定してください。"
            ) from exc
        self._cache_lock = threading.RLock()
        self._release_cache: tuple[float, tuple[Release, ...]] | None = None

    @classmethod
    def from_env(cls) -> "PostgresRepository":
        return cls(os.getenv("PR_DATABASE_URL"))

    @staticmethod
    def _load_driver() -> Any:
        try:
            import psycopg  # type: ignore[import-not-found]
        except ModuleNotFoundError as exc:
            raise DatabaseDriverError(
                "PostgreSQLドライバ psycopg が未導入です。"
                " `pip install -e '.[postgres]'` を実行してください。"
            ) from exc
        return psycopg

    def _connect(self) -> Any:
        psycopg = self._load_driver()
        connection = psycopg.connect(
            self._database_url,
            connect_timeout=10,
            application_name="pr-planning-recommender",
        )
        connection.execute("SET statement_timeout = '30s'")
        return connection

    def list_companies(self) -> tuple[Company, ...]:
        sql = """
            SELECT
                c.company_id,
                c.company_name,
                c.description,
                i.industry_name,
                ip.ipo_type_name
            FROM company AS c
            JOIN industry AS i ON i.industry_id = c.industry_id
            JOIN ipo_type AS ip ON ip.ipo_type_id = c.ipo_type_id
            ORDER BY c.company_id
        """
        with self._connect() as connection:
            rows = connection.execute(sql).fetchall()
        return tuple(Company(*row) for row in rows)

    def get_company(self, company_id: int) -> Company | None:
        sql = """
            SELECT
                c.company_id,
                c.company_name,
                c.description,
                i.industry_name,
                ip.ipo_type_name
            FROM company AS c
            JOIN industry AS i ON i.industry_id = c.industry_id
            JOIN ipo_type AS ip ON ip.ipo_type_id = c.ipo_type_id
            WHERE c.company_id = %s
        """
        with self._connect() as connection:
            row = connection.execute(sql, (company_id,)).fetchone()
        return Company(*row) if row is not None else None

    def list_releases(self, company_id: int | None = None) -> tuple[Release, ...]:
        now = time.monotonic()
        with self._cache_lock:
            cached = self._release_cache
            if cached is not None and cached[0] >= now:
                releases = cached[1]
                if company_id is None:
                    return releases
                return tuple(
                    release for release in releases if release.company_id == company_id
                )

        if company_id is not None:
            return self._fetch_releases(company_id=company_id, release_id=None)

        releases = self._fetch_releases(company_id=None, release_id=None)
        with self._cache_lock:
            self._release_cache = (now + self._cache_seconds, releases)
        return releases

    def get_release(self, company_id: int, release_id: int) -> Release | None:
        with self._cache_lock:
            cached = self._release_cache
            if cached is not None and cached[0] >= time.monotonic():
                return next(
                    (
                        release
                        for release in cached[1]
                        if release.company_id == company_id
                        and release.release_id == release_id
                    ),
                    None,
                )
        releases = self._fetch_releases(
            company_id=company_id,
            release_id=release_id,
        )
        return releases[0] if releases else None

    def find_vector_candidates(
        self,
        *,
        query_vector: tuple[float, ...],
        embedding_model: str,
        target_company_id: int,
        target_industry: str,
        bucket: str,
        limit: int,
        as_of: datetime,
    ) -> tuple[tuple[int, int, tuple[float, ...], float], ...]:
        """pgvectorで意味候補を取得する。成果値は順位付けに利用しない。"""

        if bucket not in {"same_industry", "cross_industry"}:
            raise ValueError("bucketが不正です")
        if not query_vector:
            raise ValueError("query_vectorが空です")
        vector_literal = "[" + ",".join(
            format(float(value), ".9g") for value in query_vector
        ) + "]"
        same_industry = bucket == "same_industry"
        sql = """
            SELECT
                e.company_id,
                e.release_id,
                e.embedding::text,
                (1.0 - (e.embedding <=> %s::vector))::double precision
                    AS cosine_similarity
            FROM pr_ai.release_embedding AS e
            JOIN pr_ai.release_search_features AS f
              ON f.company_id = e.company_id
             AND f.release_id = e.release_id
            WHERE e.embedding_model = %s
              AND e.company_id <> %s
              AND f.created_at IS NOT NULL
              AND f.created_at <= %s::timestamp
              AND ((%s AND f.industry_name = %s)
                   OR (NOT %s AND f.industry_name IS DISTINCT FROM %s))
            ORDER BY e.embedding <=> %s::vector,
                     e.company_id,
                     e.release_id
            LIMIT %s
        """
        params = (
            vector_literal,
            embedding_model,
            target_company_id,
            as_of,
            same_industry,
            target_industry,
            same_industry,
            target_industry,
            vector_literal,
            min(max(int(limit), 1), 100),
        )
        with self._connect() as connection:
            # この経路は評価可能なexact検索。任意HNSW索引が存在しても使わない。
            connection.execute("SET LOCAL enable_indexscan = off")
            connection.execute("SET LOCAL enable_bitmapscan = off")
            rows = connection.execute(sql, params).fetchall()
        return tuple(
            (
                int(row[0]),
                int(row[1]),
                _parse_vector_text(str(row[2])),
                max(0.0, min(1.0, float(row[3]))),
            )
            for row in rows
        )

    def stored_vectors(
        self,
        releases: Iterable[Release],
        embedding_model: str,
    ) -> dict[tuple[int, int], tuple[float, ...]]:
        """検索プロファイル用に、保存済みベクトルだけを取得する。"""

        requested = {
            (release.company_id, release.release_id) for release in releases
        }
        if not requested:
            return {}
        company_ids = sorted({key[0] for key in requested})
        sql = """
            SELECT company_id, release_id, embedding::text
            FROM pr_ai.release_embedding
            WHERE embedding_model = %s
              AND company_id = ANY(%s)
        """
        with self._connect() as connection:
            rows = connection.execute(sql, (embedding_model, company_ids)).fetchall()
        return {
            (int(row[0]), int(row[1])): _parse_vector_text(str(row[2]))
            for row in rows
            if (int(row[0]), int(row[1])) in requested
        }

    def _fetch_releases(
        self,
        *,
        company_id: int | None,
        release_id: int | None,
    ) -> tuple[Release, ...]:
        params = (company_id, company_id, release_id, release_id)
        with self._connect() as connection:
            rows = connection.execute(_RELEASE_SQL, params).fetchall()
        return tuple(self._release_from_row(row) for row in rows)

    @staticmethod
    def _release_from_row(row: tuple[Any, ...]) -> Release:
        release_type = str(row[8])
        return Release(
            company_id=row[0],
            release_id=row[1],
            company_name=row[2],
            industry=row[3],
            title=row[4],
            subtitle=row[5],
            lead=row[6],
            body=row[7],
            release_type=release_type,
            created_at=row[9],
            categories=tuple(row[10] or ()),
            keywords=tuple(row[11] or ()),
            page_view=row[12],
            unique_user=row[13],
            like_count=row[14],
            clipping_count=row[15],
            url=row[16],
            pattern=_pattern_for_release_type(release_type),
        )


def repository_from_env() -> ReleaseRepository:
    """DB URLがあればPostgreSQL、なければデモデータを選ぶ。"""

    if os.getenv("PR_DATABASE_URL", "").strip():
        return PostgresRepository.from_env()
    return DemoRepository()


def _parse_vector_text(value: str) -> tuple[float, ...]:
    cleaned = value.strip()
    if not cleaned.startswith("[") or not cleaned.endswith("]"):
        raise ValueError("PostgreSQLのvector値を解釈できません")
    payload = cleaned[1:-1].strip()
    if not payload:
        return ()
    return tuple(float(item) for item in payload.split(","))
