/*
 * 開発DBの既存データをすべて削除し、
 * 検証済みのprod_subset_importへ完全に置き換える。
 *
 * 25_validate_staging.sqlが成功した後に実行すること。
 * TRUNCATEから再投入までは同一トランザクションなので、失敗時は元に戻る。
 */
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM prod_subset_import.company)
       OR NOT EXISTS (SELECT 1 FROM prod_subset_import.release) THEN
        RAISE EXCEPTION 'staging company/release is empty; refusing to truncate public data';
    END IF;
END
$$;

TRUNCATE TABLE
    public.release_business_category,
    public.release_keyword,
    public.release_location,
    public.release_statistic,
    public.webclipping_list,
    public.release,
    public.company,
    public.city,
    public.business_category,
    public.industry,
    public.ipo_type,
    public.keyword,
    public.location_category,
    public.prefecture,
    public.release_type;

INSERT INTO public.business_category SELECT * FROM prod_subset_import.business_category;
INSERT INTO public.industry SELECT * FROM prod_subset_import.industry;
INSERT INTO public.ipo_type SELECT * FROM prod_subset_import.ipo_type;
INSERT INTO public.keyword SELECT * FROM prod_subset_import.keyword;
INSERT INTO public.location_category SELECT * FROM prod_subset_import.location_category;
INSERT INTO public.prefecture SELECT * FROM prod_subset_import.prefecture;
INSERT INTO public.release_type SELECT * FROM prod_subset_import.release_type;
INSERT INTO public.city SELECT * FROM prod_subset_import.city;
INSERT INTO public.company SELECT * FROM prod_subset_import.company;
INSERT INTO public.release SELECT * FROM prod_subset_import.release;
INSERT INTO public.release_business_category SELECT * FROM prod_subset_import.release_business_category;
INSERT INTO public.release_keyword SELECT * FROM prod_subset_import.release_keyword;
INSERT INTO public.release_location SELECT * FROM prod_subset_import.release_location;
INSERT INTO public.release_statistic SELECT * FROM prod_subset_import.release_statistic;
INSERT INTO public.webclipping_list SELECT * FROM prod_subset_import.webclipping_list;

COMMIT;

SELECT table_name, row_count
FROM
(
    SELECT 1 AS sort_order, 'prefecture' AS table_name, COUNT(*) AS row_count FROM public.prefecture
    UNION ALL SELECT 2, 'city', COUNT(*) FROM public.city
    UNION ALL SELECT 3, 'industry', COUNT(*) FROM public.industry
    UNION ALL SELECT 4, 'ipo_type', COUNT(*) FROM public.ipo_type
    UNION ALL SELECT 5, 'release_type', COUNT(*) FROM public.release_type
    UNION ALL SELECT 6, 'business_category', COUNT(*) FROM public.business_category
    UNION ALL SELECT 7, 'keyword', COUNT(*) FROM public.keyword
    UNION ALL SELECT 8, 'location_category', COUNT(*) FROM public.location_category
    UNION ALL SELECT 9, 'company', COUNT(*) FROM public.company
    UNION ALL SELECT 10, 'release', COUNT(*) FROM public.release
    UNION ALL SELECT 11, 'release_business_category', COUNT(*) FROM public.release_business_category
    UNION ALL SELECT 12, 'release_keyword', COUNT(*) FROM public.release_keyword
    UNION ALL SELECT 13, 'release_location', COUNT(*) FROM public.release_location
    UNION ALL SELECT 14, 'release_statistic', COUNT(*) FROM public.release_statistic
    UNION ALL SELECT 15, 'webclipping_list', COUNT(*) FROM public.webclipping_list
) AS counts
ORDER BY sort_order;
