import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, pool } from './db.js';

type AppliedMigration = {
  version: string;
  checksum: string;
};

const migrationFilePattern = /^\d+[_-].+\.sql$/;
const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');
const advisoryLockName = 'team_empo_app_migrations';

async function runMigrations(): Promise<void> {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => migrationFilePattern.test(file))
    .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));

  if (files.length === 0) {
    throw new Error(`No migration files found in ${migrationsDirectory}`);
  }

  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [advisoryLockName]);
    await client.query('CREATE SCHEMA IF NOT EXISTS app_migrations');
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_migrations.schema_migration (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const appliedResult = await client.query<AppliedMigration>(
      'SELECT version, checksum FROM app_migrations.schema_migration',
    );
    const applied = new Map(appliedResult.rows.map((row) => [row.version, row.checksum]));
    const available = new Set(files);

    for (const version of applied.keys()) {
      if (!available.has(version)) {
        throw new Error(`Applied migration file is missing: ${version}`);
      }
    }

    for (const file of files) {
      const sql = await readFile(resolve(migrationsDirectory, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const appliedChecksum = applied.get(file);

      if (appliedChecksum !== undefined) {
        if (appliedChecksum !== checksum) {
          throw new Error(`Applied migration was modified: ${file}`);
        }

        console.log(`Already applied: ${file}`);
        continue;
      }

      console.log(`Applying: ${file}`);
      await client.query('BEGIN');

      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO app_migrations.schema_migration (version, checksum) VALUES ($1, $2)',
          [file, checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [advisoryLockName]).catch(() => undefined);
    client.release();
  }
}

try {
  await runMigrations();
  console.log('Application migrations are up to date.');
} catch (error) {
  console.error('Application migration failed:', error);
  process.exitCode = 1;
} finally {
  await closePool();
}
