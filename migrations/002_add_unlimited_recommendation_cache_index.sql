CREATE INDEX IF NOT EXISTS recommendation_generation_cache_latest_idx
  ON recommendation_generation (cache_key, created_at DESC);
