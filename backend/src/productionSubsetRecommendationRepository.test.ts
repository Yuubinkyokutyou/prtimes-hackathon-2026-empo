import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';
process.env.NODE_ENV = 'test';
process.env.OPENAI_API_KEY = '';

const { ProductionSubsetRecommendationContextProvider } = await import(
  './productionSubsetRecommendationRepository.js'
);

test('production_subset provider loads companies, releases, and candidates from CSV', async () => {
  const fixtureDirectory = fileURLToPath(
    new URL('./testFixtures/production-subset/', import.meta.url),
  );
  const provider = new ProductionSubsetRecommendationContextProvider(fixtureDirectory);
  const companies = await provider.listCompanies();

  assert(companies.length > 0);
  assert(companies[0]!.releaseCount > 0);
  assert(Number.isFinite(Date.parse(companies[0]!.lastPublishedAt)));

  const context = await provider.get(companies[0]!.id);
  assert.equal(context.company.id, companies[0]!.id);
  assert(context.pastReleases.length > 0);
  assert(context.candidateReleases.length > 0);
  assert(Number.isFinite(Date.parse(context.pastReleases[0]!.publishedAt)));
});
