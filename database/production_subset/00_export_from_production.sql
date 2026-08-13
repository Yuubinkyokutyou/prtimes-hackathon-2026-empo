/*
 * 本番 DB から開発用の小さなデータセットを抽出するための SQL。
 *
 * pgAdmin Query Tool での使い方:
 *   1. このファイルの「抽出対象を固定する」までを同じ Query Tool セッションで実行する。
 *   2. 下部の SELECT を1つずつ選択して実行する。
 *   3. Data Output の Download as CSV で、コメントに記載した名前で保存する。
 *
 * TEMP TABLE を使うため、途中で Query Tool の接続を切らないこと。
 * すべての SELECT は明示的な列順を持ち、CSV の Header は有効にすること。
 */

-- 必要ならここだけ変更する。
-- max_rows は release と各子テーブルそれぞれの上限。
DROP TABLE IF EXISTS _export_config;
CREATE TEMP TABLE _export_config
(
    lookback_years integer NOT NULL,
    max_rows integer NOT NULL
) ON COMMIT PRESERVE ROWS;

INSERT INTO _export_config (lookback_years, max_rows)
VALUES (1, 1000);

/*
 * 抽出対象を固定する。
 * 同じ都市の最新データだけに偏らないよう、都市ごとの1件目、2件目…の順で
 * 最大1,000リリースを選ぶ。複数都市を持つリリースのグループ分けには最小city_idを使う。
 * 都市を持たないリリースも1グループとして候補に含める。
 */
DROP TABLE IF EXISTS _selected_release;
CREATE TEMP TABLE _selected_release ON COMMIT PRESERVE ROWS AS
WITH recent_release AS
(
    SELECT
        r.company_id,
        r.release_id,
        r.created_at,
        MIN(rl.city_id) FILTER (WHERE rl.city_id IS NOT NULL) AS sample_city_id
    FROM public.release AS r
    LEFT JOIN public.release_location AS rl
      ON rl.company_id = r.company_id
     AND rl.release_id = r.release_id
    CROSS JOIN _export_config AS cfg
    WHERE r.created_at >= CURRENT_DATE - make_interval(years => cfg.lookback_years)
    GROUP BY r.company_id, r.release_id, r.created_at
), ranked AS
(
    SELECT
        rr.*,
        ROW_NUMBER() OVER
        (
            PARTITION BY COALESCE(rr.sample_city_id, -1)
            ORDER BY rr.created_at DESC, rr.company_id, rr.release_id
        ) AS city_row_number
    FROM recent_release AS rr
)
SELECT r.company_id, r.release_id
FROM ranked AS r
CROSS JOIN _export_config AS cfg
ORDER BY
    r.city_row_number,
    r.created_at DESC,
    r.company_id,
    r.release_id
LIMIT (SELECT max_rows FROM _export_config);

CREATE UNIQUE INDEX ON _selected_release (company_id, release_id);

/*
 * 1対多の子テーブルも各テーブル最大1,000件にする。
 * child_row_number を先に並べることで、一部のreleaseだけで上限を使い切らないようにする。
 */
DROP TABLE IF EXISTS _selected_release_business_category;
CREATE TEMP TABLE _selected_release_business_category ON COMMIT PRESERVE ROWS AS
SELECT company_id, release_id, business_category_id, main_flg
FROM
(
    SELECT
        rbc.*,
        ROW_NUMBER() OVER
        (
            PARTITION BY rbc.company_id, rbc.release_id
            ORDER BY rbc.main_flg DESC, rbc.business_category_id
        ) AS child_row_number
    FROM public.release_business_category AS rbc
    INNER JOIN _selected_release AS sr USING (company_id, release_id)
) AS ranked
ORDER BY child_row_number, company_id, release_id, business_category_id, main_flg
LIMIT (SELECT max_rows FROM _export_config);

DROP TABLE IF EXISTS _selected_release_keyword;
CREATE TEMP TABLE _selected_release_keyword ON COMMIT PRESERVE ROWS AS
SELECT company_id, release_id, keyword_id, sort_priority
FROM
(
    SELECT
        rk.*,
        ROW_NUMBER() OVER
        (
            PARTITION BY rk.company_id, rk.release_id
            ORDER BY rk.sort_priority, rk.keyword_id
        ) AS child_row_number
    FROM public.release_keyword AS rk
    INNER JOIN _selected_release AS sr USING (company_id, release_id)
) AS ranked
ORDER BY child_row_number, company_id, release_id, sort_priority, keyword_id
LIMIT (SELECT max_rows FROM _export_config);

DROP TABLE IF EXISTS _selected_release_location;
CREATE TEMP TABLE _selected_release_location ON COMMIT PRESERVE ROWS AS
SELECT id, company_id, release_id, prefecture_id, city_id, location_category_id
FROM
(
    SELECT
        rl.*,
        ROW_NUMBER() OVER
        (
            PARTITION BY rl.company_id, rl.release_id
            ORDER BY rl.id
        ) AS child_row_number
    FROM public.release_location AS rl
    INNER JOIN _selected_release AS sr USING (company_id, release_id)
) AS ranked
ORDER BY child_row_number, company_id, release_id, id
LIMIT (SELECT max_rows FROM _export_config);

DROP TABLE IF EXISTS _selected_release_statistic;
CREATE TEMP TABLE _selected_release_statistic ON COMMIT PRESERVE ROWS AS
SELECT rs.company_id, rs.release_id, rs.page_view, rs.unique_user, rs.like_count
FROM public.release_statistic AS rs
INNER JOIN _selected_release AS sr USING (company_id, release_id)
ORDER BY rs.company_id, rs.release_id
LIMIT (SELECT max_rows FROM _export_config);

DROP TABLE IF EXISTS _selected_webclipping_list;
CREATE TEMP TABLE _selected_webclipping_list ON COMMIT PRESERVE ROWS AS
SELECT id, company_id, release_id, release_url, clipping_url, new_site_name, site_name, insert_date
FROM
(
    SELECT
        w.*,
        ROW_NUMBER() OVER
        (
            PARTITION BY w.company_id, w.release_id
            ORDER BY w.insert_date DESC, w.id
        ) AS child_row_number
    FROM public.webclipping_list AS w
    INNER JOIN _selected_release AS sr USING (company_id, release_id)
) AS ranked
ORDER BY child_row_number, company_id, release_id, insert_date DESC, id
LIMIT (SELECT max_rows FROM _export_config);

-- 件数の事前確認。想定より少ない場合は、期間内の元データ自体が1,000件未満。
SELECT 'release' AS table_name, COUNT(*) AS export_rows FROM _selected_release
UNION ALL SELECT 'release_business_category', COUNT(*) FROM _selected_release_business_category
UNION ALL SELECT 'release_keyword', COUNT(*) FROM _selected_release_keyword
UNION ALL SELECT 'release_location', COUNT(*) FROM _selected_release_location
UNION ALL SELECT 'release_statistic', COUNT(*) FROM _selected_release_statistic
UNION ALL SELECT 'webclipping_list', COUNT(*) FROM _selected_webclipping_list
ORDER BY table_name;

/* -------------------------------------------------------------------------
 * CSV出力用SELECT
 * 必ず1つずつ選択実行し、Data OutputをCSVで保存する。
 * ---------------------------------------------------------------------- */

-- 01_prefecture.csv
SELECT p.prefecture_id, p.prefecture_name
FROM public.prefecture AS p
WHERE p.prefecture_id IN
(
    SELECT c.prefecture_id
    FROM public.city AS c
    WHERE c.city_id IN
    (
        SELECT city_id FROM _selected_release_location WHERE city_id IS NOT NULL
    )
    UNION
    SELECT prefecture_id
    FROM _selected_release_location
    WHERE prefecture_id IS NOT NULL
)
ORDER BY p.prefecture_id;

-- 02_city.csv
SELECT c.city_id, c.city_name, c.prefecture_id
FROM public.city AS c
WHERE c.city_id IN
(
    SELECT city_id FROM _selected_release_location WHERE city_id IS NOT NULL
)
ORDER BY c.city_id;

-- 03_industry.csv
SELECT i.industry_id, i.industry_name
FROM public.industry AS i
WHERE i.industry_id IN
(
    SELECT c.industry_id
    FROM public.company AS c
    WHERE c.company_id IN (SELECT company_id FROM _selected_release)
)
ORDER BY i.industry_id;

-- 04_ipo_type.csv
SELECT i.ipo_type_id, i.ipo_type_name
FROM public.ipo_type AS i
WHERE i.ipo_type_id IN
(
    SELECT c.ipo_type_id
    FROM public.company AS c
    WHERE c.company_id IN (SELECT company_id FROM _selected_release)
)
ORDER BY i.ipo_type_id;

-- 05_release_type.csv
SELECT rt.release_type_id, rt.release_type_name
FROM public.release_type AS rt
WHERE rt.release_type_id IN
(
    SELECT r.release_type_id
    FROM public.release AS r
    INNER JOIN _selected_release AS sr USING (company_id, release_id)
    WHERE r.release_type_id IS NOT NULL
)
ORDER BY rt.release_type_id;

-- 06_business_category.csv
SELECT bc.business_category_id, bc.business_category_name
FROM public.business_category AS bc
WHERE bc.business_category_id IN
(
    SELECT business_category_id FROM _selected_release_business_category
)
ORDER BY bc.business_category_id;

-- 07_keyword.csv
SELECT k.keyword_id, k.keyword_name
FROM public.keyword AS k
WHERE k.keyword_id IN (SELECT keyword_id FROM _selected_release_keyword)
ORDER BY k.keyword_id;

-- 08_location_category.csv
SELECT lc.location_category_id, lc.location_category_name
FROM public.location_category AS lc
WHERE lc.location_category_id IN
(
    SELECT location_category_id
    FROM _selected_release_location
    WHERE location_category_id IS NOT NULL
)
ORDER BY lc.location_category_id;

-- 09_company.csv
SELECT
    c.company_id,
    c.company_name,
    c.president_name,
    c.address,
    c.phone,
    c.description,
    c.industry_id,
    c.ipo_type_id,
    c.capital,
    c.foundation_date,
    c.url,
    c.twitter_screen_name
FROM public.company AS c
WHERE c.company_id IN (SELECT company_id FROM _selected_release)
ORDER BY c.company_id;

-- 10_release.csv
SELECT
    r.company_id,
    r.release_id,
    r.title,
    r.subtitle,
    r.lead_paragraph,
    r.body,
    r.main_image,
    r.main_image_fastly,
    r.youtube_url,
    r.release_type_id,
    r.created_at
FROM public.release AS r
INNER JOIN _selected_release AS sr USING (company_id, release_id)
ORDER BY r.company_id, r.release_id;

-- 11_release_business_category.csv
SELECT company_id, release_id, business_category_id, main_flg
FROM _selected_release_business_category
ORDER BY company_id, release_id, business_category_id, main_flg;

-- 12_release_keyword.csv
SELECT company_id, release_id, keyword_id, sort_priority
FROM _selected_release_keyword
ORDER BY company_id, release_id, keyword_id;

-- 13_release_location.csv
SELECT id, company_id, release_id, prefecture_id, city_id, location_category_id
FROM _selected_release_location
ORDER BY id;

-- 14_release_statistic.csv
SELECT company_id, release_id, page_view, unique_user, like_count
FROM _selected_release_statistic
ORDER BY company_id, release_id;

-- 15_webclipping_list.csv
SELECT id, company_id, release_id, release_url, clipping_url, new_site_name, site_name, insert_date
FROM _selected_webclipping_list
ORDER BY id;
