-- pgAdmin Query Toolで最初に実行する読み取り専用監査です。
SELECT current_database(), current_user, version();

SELECT name, default_version, installed_version
FROM pg_available_extensions
WHERE name IN ('vector', 'pg_bigm')
ORDER BY name;

SELECT 'company' AS object_name, count(*) AS row_count FROM company
UNION ALL
SELECT 'release', count(*) FROM release
UNION ALL
SELECT 'release_statistic', count(*) FROM release_statistic
UNION ALL
SELECT 'webclipping_list', count(*) FROM webclipping_list
ORDER BY object_name;

SELECT
    count(*) AS release_count,
    count(*) FILTER (WHERE btrim(title) = '') AS blank_title_count,
    count(*) FILTER (WHERE btrim(body) = '') AS blank_body_count,
    count(*) FILTER (WHERE created_at IS NULL) AS missing_created_at_count,
    min(created_at) AS oldest_created_at,
    max(created_at) AS newest_created_at
FROM release;

