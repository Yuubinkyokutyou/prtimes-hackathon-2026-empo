import { type QueryResultRow } from 'pg';
import { pool } from './db.js';
import { buildReleaseEvidence } from './recommendationEvidence.js';
import type {
  CompanyProfile,
  CompanySummary,
  PastRelease,
  RecommendationContext,
  RecommendationContextProvider,
  SimilarRelease,
} from './recommendationTypes.js';

type Queryable = {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
};

type CompanyRow = QueryResultRow & {
  company_id: number;
  company_name: string;
  address: string;
  description: string;
  capital: number | string;
  foundation_date: string;
  url: string;
  industry_name: string;
};

type ReleaseRow = QueryResultRow & {
  company_id: number;
  company_name: string;
  release_id: number;
  title: string;
  subtitle: string;
  lead_paragraph: string;
  body: string;
  genre: string;
  created_at: Date;
  page_view: number | null;
  like_count: number | null;
  keywords: string[] | null;
  source_url: string | null;
};

type CompanySummaryRow = QueryResultRow & {
  company_id: number;
  company_name: string;
  industry_name: string;
  release_count: string;
};

export class CompanyNotFoundError extends Error {
  constructor(companyId: string) {
    super(`Company ${companyId} was not found`);
    this.name = 'CompanyNotFoundError';
  }
}

function initialsFor(name: string): string {
  const normalized = name
    .replace(/^株式会社\s*/u, '')
    .replace(/^合同会社\s*/u, '')
    .replace(/^一般社団法人\s*/u, '')
    .trim();
  return Array.from(normalized)[0] ?? '企';
}

function formatCapital(value: number | string): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return '—';
  return `${new Intl.NumberFormat('ja-JP').format(numericValue)}円`;
}

function formatFounded(value: string): string {
  const year = value.match(/^\d{4}/u)?.[0];
  return year ? `${year}年` : value || '—';
}

function toCompany(row: CompanyRow): CompanyProfile {
  return {
    id: String(row.company_id),
    name: row.company_name,
    initials: initialsFor(row.company_name),
    industry: row.industry_name,
    location: row.address,
    founded: formatFounded(row.foundation_date),
    capital: formatCapital(row.capital),
    website: row.url,
    description: row.description,
  };
}

function toPastRelease(row: ReleaseRow): PastRelease {
  return {
    id: String(row.release_id),
    title: row.title,
    genre: row.genre,
    summary: buildReleaseEvidence({
      title: row.title,
      subtitle: row.subtitle,
      leadParagraph: row.lead_paragraph,
      body: row.body,
    }),
    body: row.body.slice(0, 4_000),
    publishedAt: row.created_at.toISOString(),
    pageView: row.page_view ?? 0,
    likeCount: row.like_count ?? 0,
    keywords: row.keywords ?? [],
    sourceUrl: row.source_url ?? '',
  };
}

const releaseSelect = `
  SELECT
    r.company_id,
    c.company_name,
    r.release_id,
    r.title,
    r.subtitle,
    r.lead_paragraph,
    r.body,
    COALESCE(rt.release_type_name, 'その他') AS genre,
    r.created_at,
    rs.page_view,
    rs.like_count,
    MAX(w.release_url) AS source_url,
    COALESCE(
      array_agg(DISTINCT k.keyword_name) FILTER (WHERE k.keyword_name IS NOT NULL),
      ARRAY[]::varchar[]
    ) AS keywords
  FROM release AS r
  INNER JOIN company AS c ON c.company_id = r.company_id
  LEFT JOIN release_type AS rt ON rt.release_type_id = r.release_type_id
  LEFT JOIN release_statistic AS rs
    ON rs.company_id = r.company_id AND rs.release_id = r.release_id
  LEFT JOIN release_keyword AS rk
    ON rk.company_id = r.company_id AND rk.release_id = r.release_id
  LEFT JOIN keyword AS k ON k.keyword_id = rk.keyword_id
  LEFT JOIN webclipping_list AS w
    ON w.company_id = r.company_id AND w.release_id = r.release_id
`;

export class PostgresRecommendationContextProvider implements RecommendationContextProvider {
  constructor(private readonly database: Queryable = pool) {}

  async get(companyId: string): Promise<RecommendationContext> {
    const numericCompanyId = Number(companyId);
    if (!Number.isSafeInteger(numericCompanyId) || numericCompanyId <= 0) {
      throw new CompanyNotFoundError(companyId);
    }

    const [companyResult, ownReleaseResult, candidateResult] = await Promise.all([
      this.database.query<CompanyRow>(
        `SELECT
          c.company_id,
          c.company_name,
          c.address,
          c.description,
          c.capital,
          c.foundation_date,
          c.url,
          i.industry_name
        FROM company AS c
        INNER JOIN industry AS i ON i.industry_id = c.industry_id
        WHERE c.company_id = $1`,
        [numericCompanyId],
      ),
      this.database.query<ReleaseRow>(
        `${releaseSelect}
        WHERE r.company_id = $1
          AND r.created_at IS NOT NULL
          AND r.created_at <= CURRENT_TIMESTAMP
        GROUP BY
          r.company_id, c.company_name, r.release_id, r.title, r.subtitle,
          r.lead_paragraph, r.body, rt.release_type_name, r.created_at,
          rs.page_view, rs.like_count
        ORDER BY r.created_at DESC
        LIMIT 50`,
        [numericCompanyId],
      ),
      this.database.query<ReleaseRow>(
        `${releaseSelect}
        WHERE r.company_id <> $1
          AND r.created_at IS NOT NULL
          AND r.created_at <= CURRENT_TIMESTAMP
        GROUP BY
          r.company_id, c.company_name, r.release_id, r.title, r.subtitle,
          r.lead_paragraph, r.body, rt.release_type_name, r.created_at,
          rs.page_view, rs.like_count
        ORDER BY COALESCE(rs.page_view, 0) DESC, r.created_at DESC
        LIMIT 120`,
        [numericCompanyId],
      ),
    ]);

    const companyRow = companyResult.rows[0];
    if (!companyRow) throw new CompanyNotFoundError(companyId);

    return {
      company: toCompany(companyRow),
      pastReleases: ownReleaseResult.rows.map(toPastRelease),
      candidateReleases: candidateResult.rows.map(
        (row): SimilarRelease => ({ ...toPastRelease(row), companyName: row.company_name }),
      ),
    };
  }

  async listCompanies(): Promise<CompanySummary[]> {
    const result = await this.database.query<CompanySummaryRow>(
      `SELECT
        c.company_id,
        c.company_name,
        i.industry_name,
        COUNT(r.release_id) FILTER (
          WHERE r.created_at IS NOT NULL AND r.created_at <= CURRENT_TIMESTAMP
        )::text AS release_count
      FROM company AS c
      INNER JOIN industry AS i ON i.industry_id = c.industry_id
      LEFT JOIN release AS r ON r.company_id = c.company_id
      GROUP BY c.company_id, c.company_name, i.industry_name
      HAVING COUNT(r.release_id) FILTER (
        WHERE r.created_at IS NOT NULL AND r.created_at <= CURRENT_TIMESTAMP
      ) > 0
      ORDER BY
        COUNT(r.release_id) FILTER (
          WHERE r.created_at IS NOT NULL AND r.created_at <= CURRENT_TIMESTAMP
        ) DESC,
        MAX(r.created_at) DESC,
        c.company_id`,
    );

    return result.rows.map((row) => ({
      id: String(row.company_id),
      name: row.company_name,
      initials: initialsFor(row.company_name),
      industry: row.industry_name,
      releaseCount: Number(row.release_count),
    }));
  }
}
