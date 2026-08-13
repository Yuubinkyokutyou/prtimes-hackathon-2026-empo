import 'dotenv/config';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SSL: booleanString,
  DATABASE_SSL_REJECT_UNAUTHORIZED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_TEXT_MODEL: z.string().default('gpt-5-mini'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  RECOMMENDATION_DATA_SOURCE: z
    .enum(['auto', 'production_subset', 'database', 'mock'])
    .default('auto'),
  PRODUCTION_SUBSET_DIRECTORY: z.string().optional(),
  RECOMMENDATION_CACHE_TTL_MS: z.coerce.number().int().positive().default(900_000),
  RECOMMENDATION_STALE_AFTER_DAYS: z.coerce.number().int().positive().default(60),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
