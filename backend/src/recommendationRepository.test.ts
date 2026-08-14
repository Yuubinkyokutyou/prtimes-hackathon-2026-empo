import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QueryResultRow } from 'pg';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';
process.env.NODE_ENV = 'test';
process.env.OPENAI_API_KEY = '';

const { PostgresRecommendationContextProvider } = await import('./recommendationRepository.js');

test('Postgres company profile uses one query without loading recommendation candidates', async () => {
  const queries: string[] = [];
  const database = {
    async query<T extends QueryResultRow>(text: string): Promise<{ rows: T[] }> {
      queries.push(text);
      return {
        rows: [{
          company_id: 1,
          company_name: '株式会社テスト',
          address: '東京都',
          description: '企業概要',
          capital: 5_000_000,
          foundation_date: '2020-01-01',
          url: 'https://example.com',
          industry_name: '情報通信業',
          release_count: '12',
          last_published_at: new Date('2026-08-01T00:00:00.000Z'),
        } as unknown as T],
      };
    },
  };
  const provider = new PostgresRecommendationContextProvider(database);

  const profile = await provider.getCompanyProfile('1');

  assert.equal(queries.length, 1);
  assert.match(queries[0]!, /COUNT\(r\.release_id\)/u);
  assert.doesNotMatch(queries[0]!, /LIMIT 120/u);
  assert.equal(profile.company.name, '株式会社テスト');
  assert.deepEqual(profile.stats, {
    releaseCount: 12,
    lastPublishedAt: '2026-08-01T00:00:00.000Z',
  });
});

test('Postgres company list exposes the capital-based SME estimate', async () => {
  const database = {
    async query<T extends QueryResultRow>(): Promise<{ rows: T[] }> {
      return { rows: [{
        company_id: 1,
        company_name: '株式会社テスト',
        industry_name: 'サービス業',
        capital: 5_000,
        release_count: '1',
        last_published_at: new Date('2026-08-01T00:00:00.000Z'),
      } as unknown as T] };
    },
  };

  const [company] = await new PostgresRecommendationContextProvider(database).listCompanies();
  assert.equal(company?.isSmeByCapital, true);
});
