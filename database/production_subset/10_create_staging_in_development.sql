/*
 * 開発DBで実行する。
 * CSVを安全に受け取るため、制約なしの一時取込用スキーマを作成する。
 *
 * 注意: prod_subset_import スキーマに前回取り込んだデータがある場合は削除される。
 *       public のアプリデータは変更しない。
 */
BEGIN;

DROP SCHEMA IF EXISTS prod_subset_import CASCADE;
CREATE SCHEMA prod_subset_import;

CREATE TABLE prod_subset_import.prefecture
    (LIKE public.prefecture INCLUDING DEFAULTS);
CREATE TABLE prod_subset_import.city
    (LIKE public.city INCLUDING DEFAULTS);
CREATE TABLE prod_subset_import.industry
    (LIKE public.industry INCLUDING DEFAULTS);
CREATE TABLE prod_subset_import.ipo_type
    (LIKE public.ipo_type INCLUDING DEFAULTS);
CREATE TABLE prod_subset_import.release_type
    (LIKE public.release_type INCLUDING DEFAULTS);
CREATE TABLE prod_subset_import.business_category
    (LIKE public.business_category INCLUDING DEFAULTS);
CREATE TABLE prod_subset_import.keyword
    (LIKE public.keyword INCLUDING DEFAULTS);
CREATE TABLE prod_subset_import.location_category
    (LIKE public.location_category INCLUDING DEFAULTS);
CREATE TABLE prod_subset_import.company
    (LIKE public.company INCLUDING DEFAULTS);
CREATE TABLE prod_subset_import.release
    (LIKE public.release INCLUDING DEFAULTS);
CREATE TABLE prod_subset_import.release_business_category
    (LIKE public.release_business_category INCLUDING DEFAULTS);
CREATE TABLE prod_subset_import.release_keyword
    (LIKE public.release_keyword INCLUDING DEFAULTS);
CREATE TABLE prod_subset_import.release_location
    (LIKE public.release_location INCLUDING DEFAULTS);
CREATE TABLE prod_subset_import.release_statistic
    (LIKE public.release_statistic INCLUDING DEFAULTS);
CREATE TABLE prod_subset_import.webclipping_list
    (LIKE public.webclipping_list INCLUDING DEFAULTS);

COMMIT;

-- 作成確認
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'prod_subset_import'
ORDER BY table_name;
