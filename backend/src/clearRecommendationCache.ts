import { closePool } from './db.js';
import { invalidateRecommendationCache } from './recommendationCacheRepository.js';

async function main(): Promise<void> {
  if (!process.argv.includes('--yes')) {
    console.error('Refusing to clear the recommendation cache without --yes.');
    process.exitCode = 1;
    return;
  }

  const invalidatedAt = await invalidateRecommendationCache();
  console.log(`Recommendation cache invalidated at ${invalidatedAt.toISOString()}.`);
  console.log('Generation history was preserved. Restart the backend to clear its memory cache.');
}

main()
  .catch((error) => {
    console.error('Failed to invalidate the recommendation cache:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
