import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { ZodError, z } from 'zod';
import { config } from './config.js';
import { pool } from './db.js';
import {
  getRecommendationHistoryItem,
  listRecommendationHistory,
  updateRecommendationHistoryItem,
} from './recommendationCacheRepository.js';
import {
  getRecommendationDashboard,
  getRecommendationCompanyProfile,
  listRecommendationCompanies,
  refreshEditedDashboardCache,
  regenerateRecommendationDashboard,
  regenerateRecommendationItem,
} from './recommendations.js';
import { CompanyNotFoundError } from './recommendationRepository.js';
import { parseRecommendationDashboard } from './recommendationValidation.js';

type ReleaseRow = {
  company_id: number;
  release_id: number;
  title: string;
  subtitle: string;
  lead_paragraph: string;
  main_image: string;
  created_at: Date | null;
  company_name: string;
  page_view: number | null;
  like_count: number | null;
};

const allowedOrigins = config.CORS_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(
  cors({
    origin: allowedOrigins,
  }),
);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.get('/api/health/db', async (_request, response, next) => {
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/releases', async (request, response, next) => {
  try {
    const requestedLimit = Number(request.query.limit ?? 20);
    const requestedOffset = Number(request.query.offset ?? 0);
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 20;
    const offset = Number.isInteger(requestedOffset) ? Math.max(requestedOffset, 0) : 0;

    const result = await pool.query<ReleaseRow>(
      `SELECT
        r.company_id,
        r.release_id,
        r.title,
        r.subtitle,
        r.lead_paragraph,
        r.main_image,
        r.created_at,
        c.company_name,
        rs.page_view,
        rs.like_count
      FROM release AS r
      INNER JOIN company AS c ON c.company_id = r.company_id
      LEFT JOIN release_statistic AS rs
        ON rs.company_id = r.company_id AND rs.release_id = r.release_id
      ORDER BY r.created_at DESC NULLS LAST, r.company_id, r.release_id
      LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    response.json({ items: result.rows, limit, offset });
  } catch (error) {
    next(error);
  }
});

app.get('/api/recommendations', async (request, response, next) => {
  try {
    const companyId = typeof request.query.companyId === 'string' ? request.query.companyId : undefined;
    response.json(await getRecommendationDashboard(companyId));
  } catch (error) {
    next(error);
  }
});

app.get('/api/recommendation-companies', async (_request, response, next) => {
  try {
    response.json({ items: await listRecommendationCompanies() });
  } catch (error) {
    next(error);
  }
});

app.get('/api/recommendation-companies/:companyId', async (request, response, next) => {
  try {
    const companyId = z.string().min(1).parse(request.params.companyId);
    response.json(await getRecommendationCompanyProfile(companyId));
  } catch (error) {
    next(error);
  }
});

app.post('/api/recommendations/generate', async (request, response, next) => {
  try {
    const companyId =
      typeof request.body?.companyId === 'string' && request.body.companyId.trim()
        ? request.body.companyId.trim()
        : undefined;
    response.json(await regenerateRecommendationDashboard(companyId, request.body?.conditions));
  } catch (error) {
    next(error);
  }
});

app.post('/api/recommendations/regenerate-item', async (request, response, next) => {
  try {
    const companyId = z.string().min(1).parse(request.body?.companyId);
    response.json(await regenerateRecommendationItem(companyId, request.body));
  } catch (error) {
    next(error);
  }
});

app.get('/api/recommendations/history', async (request, response, next) => {
  try {
    if (!config.RECOMMENDATION_STORAGE_ENABLED) {
      response.status(503).json({ error: 'Recommendation storage is disabled' });
      return;
    }
    const companyId = z.string().min(1).parse(request.query.companyId);
    const requestedLimit = Number(request.query.limit ?? 20);
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 20;
    response.json({ items: await listRecommendationHistory(companyId, limit) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/recommendations/history/:id', async (request, response, next) => {
  try {
    const id = z.string().uuid().parse(request.params.id);
    const dashboard = await getRecommendationHistoryItem(id);
    if (!dashboard) {
      response.status(404).json({ error: 'Recommendation history item not found' });
      return;
    }
    response.json(dashboard);
  } catch (error) {
    next(error);
  }
});

app.put('/api/recommendations/history/:id', async (request, response, next) => {
  try {
    const id = z.string().uuid().parse(request.params.id);
    const dashboard = parseRecommendationDashboard(request.body?.dashboard);
    const saved = await updateRecommendationHistoryItem(id, dashboard);
    if (!saved) {
      response.status(404).json({ error: 'Recommendation history item not found' });
      return;
    }
    refreshEditedDashboardCache(saved);
    response.json(saved);
  } catch (error) {
    next(error);
  }
});

app.use((_request, response) => {
  response.status(404).json({ error: 'Not found' });
});

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof ZodError) {
    response.status(400).json({ error: 'Invalid request', details: error.flatten().fieldErrors });
    return;
  }
  if (error instanceof CompanyNotFoundError) {
    response.status(404).json({ error: 'Company not found' });
    return;
  }
  console.error(error);
  response.status(500).json({ error: 'Internal server error' });
};

app.use(errorHandler);
