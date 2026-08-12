-- 既存テーブルは変更せず、AI検索用の派生オブジェクトだけを作ります。
CREATE SCHEMA IF NOT EXISTS pr_ai;

CREATE MATERIALIZED VIEW IF NOT EXISTS pr_ai.release_search_features AS
WITH category_agg AS (
    SELECT
        rbc.company_id,
        rbc.release_id,
        array_agg(rbc.business_category_id
                  ORDER BY rbc.main_flg DESC,
                           bc.business_category_name,
                           rbc.business_category_id) AS category_ids,
        string_agg(bc.business_category_name, ' '
                   ORDER BY rbc.main_flg DESC,
                            bc.business_category_name) AS category_names
    FROM release_business_category AS rbc
    JOIN business_category AS bc USING (business_category_id)
    GROUP BY rbc.company_id, rbc.release_id
),
keyword_agg AS (
    SELECT
        rk.company_id,
        rk.release_id,
        array_agg(rk.keyword_id
                  ORDER BY rk.sort_priority DESC, rk.keyword_id) AS keyword_ids,
        string_agg(k.keyword_name, ' '
                   ORDER BY rk.sort_priority DESC, k.keyword_name) AS keyword_names
    FROM release_keyword AS rk
    JOIN keyword AS k USING (keyword_id)
    GROUP BY rk.company_id, rk.release_id
),
clipping_agg AS (
    SELECT
        company_id,
        release_id,
        count(DISTINCT NULLIF(btrim(clipping_url), '')) AS clipping_url_count,
        max(NULLIF(btrim(release_url), '')) AS sample_release_url
    FROM webclipping_list
    GROUP BY company_id, release_id
)
SELECT
    r.company_id,
    r.release_id,
    c.company_name,
    c.description AS company_description,
    c.industry_id,
    i.industry_name,
    r.release_type_id,
    COALESCE(rt.release_type_name, '未分類') AS release_type_name,
    CASE COALESCE(rt.release_type_name, '未分類')
        WHEN '商品サービス' THEN '新商品・新サービス'
        WHEN 'イベント' THEN 'イベント'
        WHEN 'キャンペーン' THEN 'キャンペーン'
        WHEN '経営情報' THEN '経営・提携'
        WHEN '調査レポート' THEN '調査・データ'
        WHEN '人物' THEN '人物・組織'
        WHEN 'その他' THEN 'コンテンツ公開'
        WHEN '上場企業決算発表' THEN '決算'
        ELSE 'その他'
    END AS pattern,
    r.title,
    r.subtitle,
    r.lead_paragraph,
    r.body,
    r.created_at,
    COALESCE(ca.category_ids, ARRAY[]::integer[]) AS category_ids,
    COALESCE(ca.category_names, '') AS category_names,
    COALESCE(ka.keyword_ids, ARRAY[]::integer[]) AS keyword_ids,
    COALESCE(ka.keyword_names, '') AS keyword_names,
    rs.page_view,
    rs.unique_user,
    rs.like_count,
    COALESCE(cla.clipping_url_count, 0) AS clipping_url_count,
    cla.sample_release_url,
    -- models.Release.search_text と同じ順序・ラベル・本文上限をcanonicalとする。
    concat_ws(
        E'\n',
        'タイトル: ' || r.title,
        'サブタイトル: ' || NULLIF(r.subtitle, ''),
        'リード: ' || NULLIF(r.lead_paragraph, ''),
        '本文: ' || left(r.body, 1800),
        '業種: ' || NULLIF(i.industry_name, ''),
        '種別: ' || COALESCE(NULLIF(rt.release_type_name, ''), '未分類'),
        '企画パターン: ' || CASE COALESCE(rt.release_type_name, '未分類')
            WHEN '商品サービス' THEN '新商品・新サービス'
            WHEN 'イベント' THEN 'イベント'
            WHEN 'キャンペーン' THEN 'キャンペーン'
            WHEN '経営情報' THEN '経営・提携'
            WHEN '調査レポート' THEN '調査・データ'
            WHEN '人物' THEN '人物・組織'
            WHEN 'その他' THEN 'コンテンツ公開'
            WHEN '上場企業決算発表' THEN '決算'
            ELSE 'その他'
        END,
        'カテゴリ: ' || NULLIF(ca.category_names, ''),
        'キーワード: ' || NULLIF(ka.keyword_names, '')
    ) AS search_text
FROM release AS r
JOIN company AS c ON c.company_id = r.company_id
LEFT JOIN industry AS i ON i.industry_id = c.industry_id
LEFT JOIN release_type AS rt ON rt.release_type_id = r.release_type_id
LEFT JOIN category_agg AS ca
  ON ca.company_id = r.company_id AND ca.release_id = r.release_id
LEFT JOIN keyword_agg AS ka
  ON ka.company_id = r.company_id AND ka.release_id = r.release_id
LEFT JOIN release_statistic AS rs
  ON rs.company_id = r.company_id AND rs.release_id = r.release_id
LEFT JOIN clipping_agg AS cla
  ON cla.company_id = r.company_id AND cla.release_id = r.release_id
WHERE btrim(r.title) <> ''
  AND btrim(r.body) <> ''
  AND r.created_at IS NOT NULL
  AND r.created_at <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS release_search_features_pk
    ON pr_ai.release_search_features (company_id, release_id);

-- 元データ更新後はトランザクション外で実行します。
-- REFRESH MATERIALIZED VIEW CONCURRENTLY pr_ai.release_search_features;
