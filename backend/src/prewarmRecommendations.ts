import {
  formatRecommendation,
  parsePrewarmArguments,
  prewarmUsage,
} from './prewarmRecommendationsCli.js';

let closeDatabase: (() => Promise<void>) | undefined;

async function main(): Promise<void> {
  const options = parsePrewarmArguments(process.argv.slice(2));
  if (options.help) {
    console.log(prewarmUsage);
    return;
  }

  const [{ config }, { closePool }, { listPostgresRecommendationCompanies, prewarmRecommendationDashboard }] =
    await Promise.all([
      import('./config.js'),
      import('./db.js'),
      import('./recommendations.js'),
    ]);
  closeDatabase = closePool;
  if (!config.RECOMMENDATION_STORAGE_ENABLED) {
    throw new Error('RECOMMENDATION_STORAGE_ENABLED must be true to prewarm PostgreSQL');
  }
  if (config.RECOMMENDATION_DATA_SOURCE !== 'database') {
    throw new Error('RECOMMENDATION_DATA_SOURCE must be database to prewarm PostgreSQL companies');
  }

  const availableCompanies = new Map(
    (await listPostgresRecommendationCompanies()).map((company) => [company.id, company]),
  );
  console.log(`Prewarming ${options.companyIds.length} requested companies...`);
  let failed = 0;
  let skipped = 0;
  let succeeded = 0;
  for (const [index, companyId] of options.companyIds.entries()) {
    const company = availableCompanies.get(companyId);
    if (!company) {
      skipped += 1;
      console.log(`\n[${index + 1}/${options.companyIds.length}] ${companyId} - SKIP (not found in PostgreSQL or has no published releases)`);
      continue;
    }
    const action = options.refresh
      ? 'refreshing'
      : company.hasCachedRecommendation ? 'cached' : 'generating';
    console.log(`\n[${index + 1}/${options.companyIds.length}] ${company.name} (${action})`);
    try {
      const dashboard = await prewarmRecommendationDashboard(company.id, undefined, options.refresh);
      console.log(formatRecommendation(dashboard));
      succeeded += 1;
    } catch (error) {
      failed += 1;
      console.error(error instanceof Error ? error.message : error);
    }
  }

  console.log(`\nPrewarm complete: ${succeeded} succeeded, ${skipped} skipped, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    console.error(prewarmUsage);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase?.();
  });
