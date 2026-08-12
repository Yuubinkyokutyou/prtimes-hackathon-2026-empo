\set ON_ERROR_STOP on

-- Existing databases only: keep release_embedding rows while replacing the
-- derived feature view and its dependent exact-search function atomically.
-- Run with psql -X; \ir paths are relative to this migration file.
BEGIN;
SELECT pg_advisory_xact_lock(5787793205133003086::bigint);

CREATE SCHEMA IF NOT EXISTS pr_ai;
CREATE EXTENSION IF NOT EXISTS vector;
SET LOCAL search_path = pg_catalog, public, pr_ai;

DROP FUNCTION IF EXISTS pr_ai.find_similar_exact(
    integer,
    vector,
    text,
    integer,
    timestamp without time zone
);

-- Do not use CASCADE: an unknown dependency must stop and roll back migration.
DROP MATERIALIZED VIEW IF EXISTS pr_ai.release_search_features;

\ir ../01_search_features.sql
\ir ../02_pgvector.sql

COMMIT;

-- Production note: DROP/CREATE does not preserve custom OWNER/GRANT values.
-- Reapply environment-specific ownership and least-privilege grants after this
-- migration; function EXECUTE is granted to PUBLIC by PostgreSQL by default.
