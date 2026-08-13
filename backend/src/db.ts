import { Pool, type PoolConfig } from 'pg';
import { config } from './config.js';

const poolConfig: PoolConfig = {
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
};

if (config.DATABASE_SSL) {
  poolConfig.ssl = {
    rejectUnauthorized: config.DATABASE_SSL_REJECT_UNAUTHORIZED,
  };
}

export const pool = new Pool(poolConfig);

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error', error);
});

export async function closePool(): Promise<void> {
  await pool.end();
}
