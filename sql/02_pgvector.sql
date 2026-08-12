-- 00_preflight.sqlでvectorの提供・作成権限を確認してから実行します。
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS pr_ai;

CREATE TABLE IF NOT EXISTS pr_ai.release_embedding (
    company_id integer NOT NULL,
    release_id integer NOT NULL,
    embedding_model text NOT NULL,
    embedding vector(1536) NOT NULL,
    source_hash varchar(64) NOT NULL,
    embedded_at timestamptz NOT NULL DEFAULT current_timestamp,
    PRIMARY KEY (company_id, release_id, embedding_model),
    FOREIGN KEY (company_id, release_id)
        REFERENCES release (company_id, release_id)
        ON DELETE CASCADE,
    CHECK (btrim(embedding_model) <> ''),
    CHECK (source_hash ~ '^[0-9a-f]{64}$')
);

-- PREPAREはsession終了時に消えるため、接続をまたいで利用できる恒久関数にする。
-- HNSW作成後もexactであることを保証するため、距離をMATERIALIZED CTEで
-- 全候補について計算してからsortする。成果proxyや構造化rerankはアプリ側で行う。
CREATE OR REPLACE FUNCTION pr_ai.find_similar_exact(
    p_target_company_id integer,
    p_query_embedding vector,
    p_embedding_model text,
    p_limit integer DEFAULT 50,
    p_as_of timestamp without time zone DEFAULT NULL
)
RETURNS TABLE
(
    company_id integer,
    release_id integer,
    cosine_similarity double precision
)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public, pr_ai
AS $function$
DECLARE
    cutoff timestamp without time zone;
    safe_limit integer;
BEGIN
    IF p_target_company_id IS NULL THEN
        RAISE EXCEPTION 'target_company_id must not be null'
            USING ERRCODE = '22023';
    END IF;
    IF p_query_embedding IS NULL
       OR vector_dims(p_query_embedding) <> 1536 THEN
        RAISE EXCEPTION 'query embedding must have 1536 dimensions'
            USING ERRCODE = '22023';
    END IF;
    IF p_embedding_model IS NULL OR btrim(p_embedding_model) = '' THEN
        RAISE EXCEPTION 'embedding_model must not be blank'
            USING ERRCODE = '22023';
    END IF;

    cutoff := COALESCE(
        p_as_of,
        CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo'
    );
    safe_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);

    RETURN QUERY
    WITH distances AS MATERIALIZED (
        SELECT
            e.company_id AS candidate_company_id,
            e.release_id AS candidate_release_id,
            e.embedding <=> p_query_embedding AS cosine_distance
        FROM pr_ai.release_embedding AS e
        JOIN pr_ai.release_search_features AS f
          ON f.company_id = e.company_id
         AND f.release_id = e.release_id
        WHERE e.embedding_model = p_embedding_model
          AND e.company_id <> p_target_company_id
          -- 未公開・予約公開・日時不明の本文を候補へ出さない防御条件。
          AND f.created_at IS NOT NULL
          AND f.created_at <= cutoff
    )
    SELECT
        d.candidate_company_id,
        d.candidate_release_id,
        1.0 - d.cosine_distance
    FROM distances AS d
    ORDER BY d.cosine_distance,
             d.candidate_company_id,
             d.candidate_release_id
    LIMIT safe_limit;
END
$function$;

COMMENT ON FUNCTION pr_ai.find_similar_exact(
    integer, vector, text, integer, timestamp without time zone
) IS '公開済みの他社リリースからexact cosine上位候補を返す';

-- 呼び出し例（query vectorはアプリからparameter bindingする）:
-- SELECT *
-- FROM pr_ai.find_similar_exact(
--     :target_company_id, :query_vector::vector, :model_id, 50
-- );
