import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { pool } from './db.js';

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

app.use((_request, response) => {
  response.status(404).json({ error: 'Not found' });
});

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: 'Internal server error' });
};

app.use(errorHandler);
