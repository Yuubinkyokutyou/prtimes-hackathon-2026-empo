/*
 * prod_subset_import のCSVデータをpublicへ反映する前に検証する。
 * エラーが1件でもあれば例外を発生させ、後続処理を停止する。
 */
BEGIN;

DROP TABLE IF EXISTS _production_subset_validation;
CREATE TEMP TABLE _production_subset_validation
(
    check_name text NOT NULL,
    errors bigint NOT NULL
) ON COMMIT DROP;

INSERT INTO _production_subset_validation (check_name, errors)
SELECT 'release_is_empty', CASE WHEN EXISTS (SELECT 1 FROM prod_subset_import.release) THEN 0 ELSE 1 END
UNION ALL SELECT 'company_is_empty', CASE WHEN EXISTS (SELECT 1 FROM prod_subset_import.company) THEN 0 ELSE 1 END
UNION ALL SELECT 'prefecture_duplicate_pk', COUNT(*) - COUNT(DISTINCT prefecture_id) FROM prod_subset_import.prefecture
UNION ALL SELECT 'city_duplicate_pk', COUNT(*) - COUNT(DISTINCT city_id) FROM prod_subset_import.city
UNION ALL SELECT 'industry_duplicate_pk', COUNT(*) - COUNT(DISTINCT industry_id) FROM prod_subset_import.industry
UNION ALL SELECT 'ipo_type_duplicate_pk', COUNT(*) - COUNT(DISTINCT ipo_type_id) FROM prod_subset_import.ipo_type
UNION ALL SELECT 'release_type_duplicate_pk', COUNT(*) - COUNT(DISTINCT release_type_id) FROM prod_subset_import.release_type
UNION ALL SELECT 'business_category_duplicate_pk', COUNT(*) - COUNT(DISTINCT business_category_id) FROM prod_subset_import.business_category
UNION ALL SELECT 'keyword_duplicate_pk', COUNT(*) - COUNT(DISTINCT keyword_id) FROM prod_subset_import.keyword
UNION ALL SELECT 'location_category_duplicate_pk', COUNT(*) - COUNT(DISTINCT location_category_id) FROM prod_subset_import.location_category
UNION ALL SELECT 'company_duplicate_pk', COUNT(*) - COUNT(DISTINCT company_id) FROM prod_subset_import.company
UNION ALL SELECT 'release_duplicate_pk', COUNT(*) - COUNT(DISTINCT (company_id, release_id)) FROM prod_subset_import.release
UNION ALL SELECT 'release_business_category_duplicate_pk', COUNT(*) - COUNT(DISTINCT (company_id, release_id, business_category_id, main_flg)) FROM prod_subset_import.release_business_category
UNION ALL SELECT 'release_keyword_duplicate_pk', COUNT(*) - COUNT(DISTINCT (company_id, release_id, keyword_id)) FROM prod_subset_import.release_keyword
UNION ALL SELECT 'release_location_duplicate_pk', COUNT(*) - COUNT(DISTINCT id) FROM prod_subset_import.release_location
UNION ALL SELECT 'release_statistic_duplicate_pk', COUNT(*) - COUNT(DISTINCT (company_id, release_id)) FROM prod_subset_import.release_statistic
UNION ALL SELECT 'webclipping_list_duplicate_pk', COUNT(*) - COUNT(DISTINCT id) FROM prod_subset_import.webclipping_list
UNION ALL
SELECT 'city_missing_prefecture', COUNT(*)
FROM prod_subset_import.city AS x
LEFT JOIN prod_subset_import.prefecture AS p USING (prefecture_id)
WHERE p.prefecture_id IS NULL
UNION ALL
SELECT 'company_missing_industry', COUNT(*)
FROM prod_subset_import.company AS x
LEFT JOIN prod_subset_import.industry AS p USING (industry_id)
WHERE p.industry_id IS NULL
UNION ALL
SELECT 'company_missing_ipo_type', COUNT(*)
FROM prod_subset_import.company AS x
LEFT JOIN prod_subset_import.ipo_type AS p USING (ipo_type_id)
WHERE p.ipo_type_id IS NULL
UNION ALL
SELECT 'release_missing_company', COUNT(*)
FROM prod_subset_import.release AS x
LEFT JOIN prod_subset_import.company AS p USING (company_id)
WHERE p.company_id IS NULL
UNION ALL
SELECT 'release_missing_release_type', COUNT(*)
FROM prod_subset_import.release AS x
LEFT JOIN prod_subset_import.release_type AS p USING (release_type_id)
WHERE x.release_type_id IS NOT NULL AND p.release_type_id IS NULL
UNION ALL
SELECT 'release_business_category_missing_release', COUNT(*)
FROM prod_subset_import.release_business_category AS x
LEFT JOIN prod_subset_import.release AS p USING (company_id, release_id)
WHERE p.release_id IS NULL
UNION ALL
SELECT 'release_business_category_missing_category', COUNT(*)
FROM prod_subset_import.release_business_category AS x
LEFT JOIN prod_subset_import.business_category AS p USING (business_category_id)
WHERE p.business_category_id IS NULL
UNION ALL
SELECT 'release_keyword_missing_release', COUNT(*)
FROM prod_subset_import.release_keyword AS x
LEFT JOIN prod_subset_import.release AS p USING (company_id, release_id)
WHERE p.release_id IS NULL
UNION ALL
SELECT 'release_keyword_missing_keyword', COUNT(*)
FROM prod_subset_import.release_keyword AS x
LEFT JOIN prod_subset_import.keyword AS p USING (keyword_id)
WHERE p.keyword_id IS NULL
UNION ALL
SELECT 'release_location_missing_release', COUNT(*)
FROM prod_subset_import.release_location AS x
LEFT JOIN prod_subset_import.release AS p USING (company_id, release_id)
WHERE p.release_id IS NULL
UNION ALL
SELECT 'release_location_missing_prefecture', COUNT(*)
FROM prod_subset_import.release_location AS x
LEFT JOIN prod_subset_import.prefecture AS p USING (prefecture_id)
WHERE x.prefecture_id IS NOT NULL AND p.prefecture_id IS NULL
UNION ALL
SELECT 'release_location_missing_city', COUNT(*)
FROM prod_subset_import.release_location AS x
LEFT JOIN prod_subset_import.city AS p USING (city_id)
WHERE x.city_id IS NOT NULL AND p.city_id IS NULL
UNION ALL
SELECT 'release_location_missing_category', COUNT(*)
FROM prod_subset_import.release_location AS x
LEFT JOIN prod_subset_import.location_category AS p USING (location_category_id)
WHERE x.location_category_id IS NOT NULL AND p.location_category_id IS NULL
UNION ALL
SELECT 'release_statistic_missing_release', COUNT(*)
FROM prod_subset_import.release_statistic AS x
LEFT JOIN prod_subset_import.release AS p USING (company_id, release_id)
WHERE p.release_id IS NULL
UNION ALL
SELECT 'webclipping_list_missing_release', COUNT(*)
FROM prod_subset_import.webclipping_list AS x
LEFT JOIN prod_subset_import.release AS p USING (company_id, release_id)
WHERE p.release_id IS NULL;

SELECT check_name, errors
FROM _production_subset_validation
WHERE errors <> 0
ORDER BY check_name;

DO $$
DECLARE
    error_count bigint;
BEGIN
    SELECT COALESCE(SUM(errors), 0)
    INTO error_count
    FROM _production_subset_validation;

    IF error_count <> 0 THEN
        RAISE EXCEPTION 'production subset validation failed: % error(s)', error_count;
    END IF;
END
$$;

SELECT 'production subset validation passed' AS result;

COMMIT;
