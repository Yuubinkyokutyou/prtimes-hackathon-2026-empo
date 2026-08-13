import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const files = [
  ['prefecture', '01_prefecture.csv', 'prefecture_id,prefecture_name'],
  ['city', '02_city.csv', 'city_id,city_name,prefecture_id'],
  ['industry', '03_industry.csv', 'industry_id,industry_name'],
  ['ipo_type', '04_ipo_type.csv', 'ipo_type_id,ipo_type_name'],
  ['release_type', '05_release_type.csv', 'release_type_id,release_type_name'],
  ['business_category', '06_business_category.csv', 'business_category_id,business_category_name'],
  ['keyword', '07_keyword.csv', 'keyword_id,keyword_name'],
  ['location_category', '08_location_category.csv', 'location_category_id,location_category_name'],
  [
    'company',
    '09_company.csv',
    'company_id,company_name,president_name,address,phone,description,industry_id,ipo_type_id,capital,foundation_date,url,twitter_screen_name',
  ],
  [
    'release',
    '10_release.csv',
    'company_id,release_id,title,subtitle,lead_paragraph,body,main_image,main_image_fastly,youtube_url,release_type_id,created_at',
  ],
  [
    'release_business_category',
    '11_release_business_category.csv',
    'company_id,release_id,business_category_id,main_flg',
  ],
  ['release_keyword', '12_release_keyword.csv', 'company_id,release_id,keyword_id,sort_priority'],
  [
    'release_location',
    '13_release_location.csv',
    'id,company_id,release_id,prefecture_id,city_id,location_category_id',
  ],
  [
    'release_statistic',
    '14_release_statistic.csv',
    'company_id,release_id,page_view,unique_user,like_count',
  ],
  [
    'webclipping_list',
    '15_webclipping_list.csv',
    'id,company_id,release_id,release_url,clipping_url,new_site_name,site_name,insert_date',
  ],
];

const args = process.argv.slice(2);
const confirmed = args.includes('--yes');
const directoryArgument = args.find((argument) => argument !== '--yes');
const csvDirectory = path.resolve(directoryArgument ?? 'database/production_subset/csv');

if (!confirmed) {
  console.error('This command deletes all existing application data in the development DB.');
  console.error('Run again with --yes after confirming the target:');
  console.error('  npm run db:replace-production-subset -- <csv-directory> --yes');
  process.exit(2);
}

function runDocker(arguments_, options = {}) {
  const result = spawnSync('docker', arguments_, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : ['pipe', 'inherit', 'inherit'],
    input: options.input,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`docker ${arguments_.join(' ')} failed with exit code ${result.status}`);
  }
  return options.capture ? result.stdout.trim() : '';
}

function readSql(fileName) {
  return readFileSync(path.resolve('database/production_subset', fileName), 'utf8');
}

function normalizeHeader(filePath) {
  const firstLine = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0];
  return firstLine
    .split(',')
    .map((column) => column.trim().replace(/^"|"$/g, '').replace(/""/g, '"'))
    .join(',');
}

for (const [, fileName, expectedHeader] of files) {
  const filePath = path.join(csvDirectory, fileName);
  if (!existsSync(filePath)) {
    throw new Error(`Missing CSV: ${filePath}`);
  }
  const actualHeader = normalizeHeader(filePath);
  if (actualHeader !== expectedHeader) {
    throw new Error(`Unexpected header in ${fileName}\nexpected: ${expectedHeader}\nactual:   ${actualHeader}`);
  }
}

const containerId = runDocker(['compose', 'ps', '-q', 'db'], { capture: true });
if (!containerId) {
  throw new Error('The Docker Compose db service is not running. Run `docker compose up -d db` first.');
}

const dbUser = runDocker(['compose', 'exec', '-T', 'db', 'printenv', 'POSTGRES_USER'], { capture: true });
const dbName = runDocker(['compose', 'exec', '-T', 'db', 'printenv', 'POSTGRES_DB'], { capture: true });
const tempDirectory = `/tmp/production-subset-${Date.now()}-${process.pid}`;
const tempFiles = files.map(([, fileName]) => `${tempDirectory}/${fileName}`);

function runPsql(sql) {
  runDocker(
    ['compose', 'exec', '-T', 'db', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', dbUser, '-d', dbName],
    { input: sql },
  );
}

try {
  console.log(`CSV directory: ${csvDirectory}`);
  runDocker(['compose', 'exec', '-T', 'db', 'mkdir', '-p', tempDirectory]);

  for (const [, fileName] of files) {
    runDocker(['cp', path.join(csvDirectory, fileName), `${containerId}:${tempDirectory}/${fileName}`]);
  }

  runPsql(readSql('10_create_staging_in_development.sql'));

  for (const [tableName, fileName] of files) {
    const copy = `\\copy prod_subset_import.${tableName} FROM '${tempDirectory}/${fileName}' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8', NULL 'NULL')\n`;
    runPsql(copy);
  }

  runPsql(readSql('25_validate_staging.sql'));
  runPsql(readSql('30_replace_development_data.sql'));
  console.log('Development data was replaced successfully.');
} finally {
  if (containerId) {
    try {
      runDocker(['compose', 'exec', '-T', 'db', 'rm', '-f', ...tempFiles]);
      runDocker(['compose', 'exec', '-T', 'db', 'rmdir', tempDirectory]);
    } catch (error) {
      console.warn(`Temporary CSV cleanup failed: ${error.message}`);
    }
  }
}
