/*
 * 15個のCSVを prod_subset_import の同名テーブルへImportした後、開発DBで実行する。
 * 既存行と主キーが重なった場合は、本番から抽出した値で更新する。
 * 対象外の既存開発データは削除しない。
 * 途中で1件でも外部キー違反等が発生すれば、トランザクション全体がロールバックされる。
 */
BEGIN;

INSERT INTO public.prefecture (prefecture_id, prefecture_name)
SELECT prefecture_id, prefecture_name FROM prod_subset_import.prefecture
ON CONFLICT (prefecture_id) DO UPDATE
SET prefecture_name = EXCLUDED.prefecture_name;

INSERT INTO public.city (city_id, city_name, prefecture_id)
SELECT city_id, city_name, prefecture_id FROM prod_subset_import.city
ON CONFLICT (city_id) DO UPDATE
SET city_name = EXCLUDED.city_name,
    prefecture_id = EXCLUDED.prefecture_id;

INSERT INTO public.industry (industry_id, industry_name)
SELECT industry_id, industry_name FROM prod_subset_import.industry
ON CONFLICT (industry_id) DO UPDATE
SET industry_name = EXCLUDED.industry_name;

INSERT INTO public.ipo_type (ipo_type_id, ipo_type_name)
SELECT ipo_type_id, ipo_type_name FROM prod_subset_import.ipo_type
ON CONFLICT (ipo_type_id) DO UPDATE
SET ipo_type_name = EXCLUDED.ipo_type_name;

INSERT INTO public.release_type (release_type_id, release_type_name)
SELECT release_type_id, release_type_name FROM prod_subset_import.release_type
ON CONFLICT (release_type_id) DO UPDATE
SET release_type_name = EXCLUDED.release_type_name;

INSERT INTO public.business_category (business_category_id, business_category_name)
SELECT business_category_id, business_category_name
FROM prod_subset_import.business_category
ON CONFLICT (business_category_id) DO UPDATE
SET business_category_name = EXCLUDED.business_category_name;

INSERT INTO public.keyword (keyword_id, keyword_name)
SELECT keyword_id, keyword_name FROM prod_subset_import.keyword
ON CONFLICT (keyword_id) DO UPDATE
SET keyword_name = EXCLUDED.keyword_name;

INSERT INTO public.location_category (location_category_id, location_category_name)
SELECT location_category_id, location_category_name
FROM prod_subset_import.location_category
ON CONFLICT (location_category_id) DO UPDATE
SET location_category_name = EXCLUDED.location_category_name;

INSERT INTO public.company
(
    company_id,
    company_name,
    president_name,
    address,
    phone,
    description,
    industry_id,
    ipo_type_id,
    capital,
    foundation_date,
    url,
    twitter_screen_name
)
SELECT
    company_id,
    company_name,
    president_name,
    address,
    phone,
    description,
    industry_id,
    ipo_type_id,
    capital,
    foundation_date,
    url,
    twitter_screen_name
FROM prod_subset_import.company
ON CONFLICT (company_id) DO UPDATE
SET company_name = EXCLUDED.company_name,
    president_name = EXCLUDED.president_name,
    address = EXCLUDED.address,
    phone = EXCLUDED.phone,
    description = EXCLUDED.description,
    industry_id = EXCLUDED.industry_id,
    ipo_type_id = EXCLUDED.ipo_type_id,
    capital = EXCLUDED.capital,
    foundation_date = EXCLUDED.foundation_date,
    url = EXCLUDED.url,
    twitter_screen_name = EXCLUDED.twitter_screen_name;

INSERT INTO public.release
(
    company_id,
    release_id,
    title,
    subtitle,
    lead_paragraph,
    body,
    main_image,
    main_image_fastly,
    youtube_url,
    release_type_id,
    created_at
)
SELECT
    company_id,
    release_id,
    title,
    subtitle,
    lead_paragraph,
    body,
    main_image,
    main_image_fastly,
    youtube_url,
    release_type_id,
    created_at
FROM prod_subset_import.release
ON CONFLICT (company_id, release_id) DO UPDATE
SET title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    lead_paragraph = EXCLUDED.lead_paragraph,
    body = EXCLUDED.body,
    main_image = EXCLUDED.main_image,
    main_image_fastly = EXCLUDED.main_image_fastly,
    youtube_url = EXCLUDED.youtube_url,
    release_type_id = EXCLUDED.release_type_id,
    created_at = EXCLUDED.created_at;

INSERT INTO public.release_business_category
    (company_id, release_id, business_category_id, main_flg)
SELECT company_id, release_id, business_category_id, main_flg
FROM prod_subset_import.release_business_category
ON CONFLICT (company_id, release_id, business_category_id, main_flg) DO NOTHING;

INSERT INTO public.release_keyword
    (company_id, release_id, keyword_id, sort_priority)
SELECT company_id, release_id, keyword_id, sort_priority
FROM prod_subset_import.release_keyword
ON CONFLICT (company_id, release_id, keyword_id) DO UPDATE
SET sort_priority = EXCLUDED.sort_priority;

INSERT INTO public.release_location
    (id, company_id, release_id, prefecture_id, city_id, location_category_id)
SELECT id, company_id, release_id, prefecture_id, city_id, location_category_id
FROM prod_subset_import.release_location
ON CONFLICT (id) DO UPDATE
SET company_id = EXCLUDED.company_id,
    release_id = EXCLUDED.release_id,
    prefecture_id = EXCLUDED.prefecture_id,
    city_id = EXCLUDED.city_id,
    location_category_id = EXCLUDED.location_category_id;

INSERT INTO public.release_statistic
    (company_id, release_id, page_view, unique_user, like_count)
SELECT company_id, release_id, page_view, unique_user, like_count
FROM prod_subset_import.release_statistic
ON CONFLICT (company_id, release_id) DO UPDATE
SET page_view = EXCLUDED.page_view,
    unique_user = EXCLUDED.unique_user,
    like_count = EXCLUDED.like_count;

INSERT INTO public.webclipping_list
    (id, company_id, release_id, release_url, clipping_url, new_site_name, site_name, insert_date)
SELECT id, company_id, release_id, release_url, clipping_url, new_site_name, site_name, insert_date
FROM prod_subset_import.webclipping_list
ON CONFLICT (id) DO UPDATE
SET company_id = EXCLUDED.company_id,
    release_id = EXCLUDED.release_id,
    release_url = EXCLUDED.release_url,
    clipping_url = EXCLUDED.clipping_url,
    new_site_name = EXCLUDED.new_site_name,
    site_name = EXCLUDED.site_name,
    insert_date = EXCLUDED.insert_date;

COMMIT;

-- ステージング件数と、publicへ反映済みの件数を照合する。
SELECT
    'release' AS table_name,
    (SELECT COUNT(*) FROM prod_subset_import.release) AS csv_rows,
    COUNT(*) AS matched_in_public
FROM prod_subset_import.release AS s
INNER JOIN public.release AS p USING (company_id, release_id)
UNION ALL
SELECT
    'release_business_category',
    (SELECT COUNT(*) FROM prod_subset_import.release_business_category),
    COUNT(*)
FROM prod_subset_import.release_business_category AS s
INNER JOIN public.release_business_category AS p
    USING (company_id, release_id, business_category_id, main_flg)
UNION ALL
SELECT
    'release_keyword',
    (SELECT COUNT(*) FROM prod_subset_import.release_keyword),
    COUNT(*)
FROM prod_subset_import.release_keyword AS s
INNER JOIN public.release_keyword AS p USING (company_id, release_id, keyword_id)
UNION ALL
SELECT
    'release_location',
    (SELECT COUNT(*) FROM prod_subset_import.release_location),
    COUNT(*)
FROM prod_subset_import.release_location AS s
INNER JOIN public.release_location AS p USING (id)
UNION ALL
SELECT
    'release_statistic',
    (SELECT COUNT(*) FROM prod_subset_import.release_statistic),
    COUNT(*)
FROM prod_subset_import.release_statistic AS s
INNER JOIN public.release_statistic AS p USING (company_id, release_id)
UNION ALL
SELECT
    'webclipping_list',
    (SELECT COUNT(*) FROM prod_subset_import.webclipping_list),
    COUNT(*)
FROM prod_subset_import.webclipping_list AS s
INNER JOIN public.webclipping_list AS p USING (id)
ORDER BY table_name;
