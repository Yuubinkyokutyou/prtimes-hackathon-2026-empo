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

  const context = await provider.get(companies[0]!.id);
  assert.equal(context.company.id, companies[0]!.id);
  assert(context.pastReleases.length > 0);
  assert.equal(context.candidateReleases.length, 1);
  assert.equal(context.candidateReleases[0]?.companyName, '株式会社テスト森');
  assert.equal(context.candidateReleases[0]?.sourceUrl, 'https://example.org/releases/20');
  assert(Number.isFinite(Date.parse(context.pastReleases[0]!.publishedAt)));
});
