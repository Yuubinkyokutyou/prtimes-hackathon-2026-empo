CREATE TABLE IF NOT EXISTS recommendation_cache_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  invalidated_at timestamptz NOT NULL DEFAULT '-infinity'::timestamptz
);
