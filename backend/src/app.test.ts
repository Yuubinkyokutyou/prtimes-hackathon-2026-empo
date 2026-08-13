import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';
process.env.NODE_ENV = 'test';
process.env.OPENAI_API_KEY = '';
process.env.RECOMMENDATION_DATA_SOURCE = 'production_subset';
process.env.RECOMMENDATION_STORAGE_ENABLED = 'false';
process.env.PRODUCTION_SUBSET_DIRECTORY = fileURLToPath(
  new URL('./testFixtures/production-subset/', import.meta.url),
);

const { app } = await import('./app.js');
const { closePool } = await import('./db.js');
const { classifyPostingCadence } = await import('./recommendations.js');

let server: ReturnType<typeof app.listen>;
let baseUrl: string;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert(address && typeof address !== 'string');
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await closePool();
});

test('GET /api/health returns ok', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('unknown routes return JSON 404', async () => {
  const response = await fetch(`${baseUrl}/not-found`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Not found' });
});

test('GET /api/recommendations uses the configured CSV data source', async () => {
  const response = await fetch(`${baseUrl}/api/recommendations`);
  assert.equal(response.status, 200);
  const data = (await response.json()) as {
    company: { name: string };
    existingSuggestions: Array<{ title: string; summary: string }>;
    newOpportunity: { genre: string; title: string; summary: string; pitch: string };
    meta: { dataSource: string; mode: string; generationId: string; saved: boolean };
  };
  assert.equal(data.company.name, '株式会社テスト空');
  assert.equal(data.existingSuggestions.length, 4);
  assert.equal(data.newOpportunity.genre, '人・カルチャー');
  const recommendationCopy = [
    ...data.existingSuggestions.flatMap((item) => [item.title, item.summary]),
    data.newOpportunity.title,
    data.newOpportunity.summary,
    data.newOpportunity.pitch,
  ].join('\n');
  assert.doesNotMatch(
    recommendationCopy,
    /物語|舞台裏|ひもとく|新たな可能性|未来への一歩|価値を届ける|会社らしさ/u,
  );
  assert.match(data.newOpportunity.title, /担当者/u);
  assert.equal(data.meta.dataSource, 'production_subset');
  assert.equal(data.meta.mode, 'template');
  assert.match(data.meta.generationId, /^[0-9a-f-]{36}$/u);
  assert.equal(data.meta.saved, false);
});

test('GET /api/recommendation-companies returns selectable companies', async () => {
  const response = await fetch(`${baseUrl}/api/recommendation-companies`);
  assert.equal(response.status, 200);
  const data = (await response.json()) as {
    items: Array<{ id: string; name: string; releaseCount: number }>;
  };
  assert.deepEqual(data.items, [
    { id: '1', name: '株式会社テスト空', initials: 'テ', industry: '情報通信業', releaseCount: 1 },
    { id: '2', name: '株式会社テスト森', initials: 'テ', industry: '情報通信業', releaseCount: 1 },
  ]);
});

test('GET /api/recommendations returns 404 for an unknown company', async () => {
  const response = await fetch(`${baseUrl}/api/recommendations?companyId=999999`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Company not found' });
});

test('POST /api/recommendations/generate applies generation conditions without an API key', async () => {
  const response = await fetch(`${baseUrl}/api/recommendations/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId: '1', conditions: { focus: 'new', tone: 'formal', audience: '採用候補者' } }),
  });
  assert.equal(response.status, 200);
  const data = (await response.json()) as { meta: { mode: string; recommendedFocus: string; conditions: { tone: string; audience: string } } };
  assert.equal(data.meta.mode, 'template');
  assert.equal(data.meta.recommendedFocus, 'new');
  assert.deepEqual(data.meta.conditions, {
    focus: 'new', tone: 'formal', audience: '採用候補者', objective: '', additionalContext: '',
  });
});

test('POST /api/recommendations/export/docx is no longer available', async () => {
  const response = await fetch(`${baseUrl}/api/recommendations/export/docx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 404);
});

test('POST /api/recommendations/drafts is no longer available', async () => {
  const response = await fetch(`${baseUrl}/api/recommendations/drafts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 404);
});

test('posting cadence prioritizes the left panel after 60 days and a new angle for recent posts', () => {
  const now = Date.parse('2026-08-13T00:00:00.000Z');

  assert.deepEqual(
    classifyPostingCadence([{ publishedAt: '2026-06-14T00:00:00.000Z' }], 60, now),
    { daysSinceLastPublished: 60, recommendedFocus: 'existing' },
  );
  assert.deepEqual(
    classifyPostingCadence([{ publishedAt: '2026-08-08T00:00:00.000Z' }], 60, now),
    { daysSinceLastPublished: 5, recommendedFocus: 'new' },
  );
});
