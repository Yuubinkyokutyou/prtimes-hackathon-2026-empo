-- 完全検索のp95が要件を超えた場合だけ、トランザクション外で実行します。
CREATE INDEX CONCURRENTLY IF NOT EXISTS release_embedding_hnsw_cosine_idx
    ON pr_ai.release_embedding
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

ANALYZE pr_ai.release_embedding;

