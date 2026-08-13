import { pool } from './db.js';
import { parseRecommendationDashboard } from './recommendationValidation.js';
import type {
  RecommendationDashboard,
  RecommendationGenerationOptions,
  RecommendationHistoryItem,
} from './recommendationTypes.js';

type RecommendationRow = {
  id: string;
  company_id: string;
  dashboard: RecommendationDashboard;
  conditions: RecommendationGenerationOptions;
  saved: boolean;
  created_at: Date;
  updated_at: Date;
};

let schemaPromise: Promise<void> | undefined;

export function ensureRecommendationStorage(): Promise<void> {
  schemaPromise ??= (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS recommendation_generation (
        id uuid PRIMARY KEY,
        cache_key text NOT NULL,
        company_id text NOT NULL,
        dashboard jsonb NOT NULL,
        conditions jsonb NOT NULL,
        saved boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at timestamptz NOT NULL
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS recommendation_generation_cache_idx
      ON recommendation_generation (cache_key, expires_at DESC)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS recommendation_generation_company_idx
      ON recommendation_generation (company_id, created_at DESC)
    `);
  })();
  return schemaPromise;
}

export async function findCachedRecommendation(
  cacheKey: string,
): Promise<RecommendationDashboard | undefined> {
  await ensureRecommendationStorage();
  const result = await pool.query<{ dashboard: RecommendationDashboard }>(
    `SELECT dashboard
     FROM recommendation_generation
     WHERE cache_key = $1 AND expires_at > CURRENT_TIMESTAMP
     ORDER BY created_at DESC
     LIMIT 1`,
    [cacheKey],
  );
  const dashboard = result.rows[0]?.dashboard;
  return dashboard ? parseRecommendationDashboard(dashboard) : undefined;
}

export async function insertRecommendationGeneration(
  cacheKey: string,
  companyId: string,
  dashboard: RecommendationDashboard,
  conditions: RecommendationGenerationOptions,
  ttlMs: number,
): Promise<void> {
  await ensureRecommendationStorage();
  await pool.query(
    `INSERT INTO recommendation_generation
      (id, cache_key, company_id, dashboard, conditions, saved, expires_at)
     VALUES ($1::uuid, $2, $3, $4::jsonb, $5::jsonb, $6, CURRENT_TIMESTAMP + ($7 * INTERVAL '1 millisecond'))`,
    [
      dashboard.meta.generationId,
      cacheKey,
      companyId,
      JSON.stringify(dashboard),
      JSON.stringify(conditions),
      dashboard.meta.saved,
      ttlMs,
    ],
  );
}

export async function listRecommendationHistory(
  companyId: string,
  limit: number,
): Promise<RecommendationHistoryItem[]> {
  await ensureRecommendationStorage();
  const result = await pool.query<RecommendationRow>(
    `SELECT id, company_id, dashboard, conditions, saved, created_at, updated_at
     FROM recommendation_generation
     WHERE company_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [companyId, limit],
  );
  return result.rows.map((row) => {
    const dashboard = parseRecommendationDashboard(row.dashboard);
    const focus = dashboard.meta.conditions.focus === 'auto'
      ? dashboard.meta.recommendedFocus
      : dashboard.meta.conditions.focus;
    return {
      id: row.id,
      companyId: row.company_id,
      companyName: dashboard.company.name,
      title: focus === 'existing'
        ? (dashboard.existingSuggestions[0]?.title ?? dashboard.newOpportunities[0]!.title)
        : dashboard.newOpportunities[0]!.title,
      mode: dashboard.meta.mode,
      conditions: row.conditions,
      saved: row.saved,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  });
}

export async function getRecommendationHistoryItem(
  id: string,
): Promise<RecommendationDashboard | undefined> {
  await ensureRecommendationStorage();
  const result = await pool.query<{ dashboard: RecommendationDashboard }>(
    'SELECT dashboard FROM recommendation_generation WHERE id = $1::uuid',
    [id],
  );
  const dashboard = result.rows[0]?.dashboard;
  return dashboard ? parseRecommendationDashboard(dashboard) : undefined;
}

export async function updateRecommendationHistoryItem(
  id: string,
  dashboard: RecommendationDashboard,
): Promise<RecommendationDashboard | undefined> {
  await ensureRecommendationStorage();
  const savedDashboard: RecommendationDashboard = {
    ...dashboard,
    meta: { ...dashboard.meta, generationId: id, saved: true },
  };
  const result = await pool.query<{ dashboard: RecommendationDashboard }>(
    `UPDATE recommendation_generation
     SET dashboard = $2::jsonb, saved = true, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1::uuid
     RETURNING dashboard`,
    [id, JSON.stringify(savedDashboard)],
  );
  return result.rows[0]?.dashboard;
}
