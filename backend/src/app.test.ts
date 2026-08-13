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
const { parseRecommendationDashboard } = await import('./recommendationValidation.js');

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
    sourceReleases: Array<{ id: string; title: string; publishedAt: string }>;
    existingSuggestions: Array<{ title: string; summary: string; sourceEvidence?: string }>;
    newOpportunities: Array<{ genre: string; title: string; summary: string; pitch: string; interviewQuestions?: string[] }>;
    meta: { dataSource: string; mode: string; generationId: string; saved: boolean };
  };
  assert.equal(data.company.name, '株式会社テスト空');
  assert.equal(data.existingSuggestions.length, 4);
  assert.equal(data.sourceReleases.length, 1);
  assert.equal(data.newOpportunities.length, 3);
  assert.equal(data.newOpportunities[0]?.genre, '人・カルチャー');
  const recommendationCopy = [
    ...data.existingSuggestions.flatMap((item) => [item.title, item.summary]),
    ...data.newOpportunities.flatMap((item) => [item.title, item.summary, item.pitch]),
  ].join('\n');
  assert.doesNotMatch(
    recommendationCopy,
    /物語|舞台裏|ひもとく|新たな可能性|未来への一歩|価値を届ける|会社らしさ/u,
  );
  assert.match(data.newOpportunities[0]!.title, /担当者/u);
  assert.equal(data.existingSuggestions.some((item) => 'sourceEvidence' in item), false);
  assert.equal(data.newOpportunities.some((item) => 'interviewQuestions' in item), false);
  assert.equal(data.meta.dataSource, 'production_subset');
  assert.equal(data.meta.mode, 'template');
  assert.match(data.meta.generationId, /^[0-9a-f-]{36}$/u);
  assert.equal(data.meta.saved, false);
});

test('GET /api/recommendation-companies returns selectable companies', async () => {
  const response = await fetch(`${baseUrl}/api/recommendation-companies`);
  assert.equal(response.status, 200);
  const data = (await response.json()) as {
    items: Array<{ id: string; name: string; releaseCount: number; lastPublishedAt: string }>;
  };
  assert.deepEqual(data.items.map(({ lastPublishedAt: _lastPublishedAt, ...company }) => company), [
    { id: '1', name: '株式会社テスト空', initials: 'テ', industry: '情報通信業', releaseCount: 1 },
    { id: '2', name: '株式会社テスト森', initials: 'テ', industry: '情報通信業', releaseCount: 1 },
  ]);
  assert(data.items.every((company) => Number.isFinite(Date.parse(company.lastPublishedAt))));
});

test('GET /api/recommendation-companies/:companyId returns a lightweight company profile', async () => {
  const response = await fetch(`${baseUrl}/api/recommendation-companies/1`);
  assert.equal(response.status, 200);
  const data = (await response.json()) as {
    company: { id: string; name: string; industry: string };
    stats: { releaseCount: number; lastPublishedAt: string | null };
    meta: { dataSource: string };
  };
  assert.deepEqual(data.company, {
    id: '1',
    name: '株式会社テスト空',
    initials: 'テ',
    industry: '情報通信業',
    location: '東京都千代田区',
    founded: '2020年',
    capital: '5,000,000円',
    website: 'https://example.com',
    description: '地域企業の情報発信を支援する架空企業です。',
  });
  assert.equal(data.stats.releaseCount, 1);
  assert(data.stats.lastPublishedAt && Number.isFinite(Date.parse(data.stats.lastPublishedAt)));
  assert.equal(data.meta.dataSource, 'production_subset');
  assert.equal('existingSuggestions' in data, false);
  assert.equal('newOpportunities' in data, false);
});

test('GET /api/recommendation-companies/:companyId returns 404 for an unknown company', async () => {
  const response = await fetch(`${baseUrl}/api/recommendation-companies/999999`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Company not found' });
});

test('saved history from the former singular opportunity shape remains readable', async () => {
  const response = await fetch(`${baseUrl}/api/recommendations`);
  const current = (await response.json()) as Record<string, unknown> & { newOpportunities: unknown[] };
  const { newOpportunities, ...rest } = current;
  const parsed = parseRecommendationDashboard({ ...rest, newOpportunity: newOpportunities[0] });
  assert.equal(parsed.newOpportunities.length, 1);
  assert.equal(parsed.stats.dataUpdatedAt.length > 0, true);
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

test('POST /api/recommendations/regenerate-item replaces only the requested layer item', async () => {
  const dashboardResponse = await fetch(`${baseUrl}/api/recommendations`);
  const dashboard = (await dashboardResponse.json()) as {
    sourceReleases: Array<{ id: string }>;
    existingSuggestions: Array<{ title: string }>;
    newOpportunities: Array<{ title: string }>;
  };

  const existingResponse = await fetch(`${baseUrl}/api/recommendations/regenerate-item`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      companyId: '1',
      layer: 'existing',
      sourceReleaseId: dashboard.sourceReleases[0]?.id,
      currentTitle: dashboard.existingSuggestions[0]?.title,
    }),
  });
  assert.equal(existingResponse.status, 200);
  const existing = (await existingResponse.json()) as { layer: string; mode: string; item: { sourceReleaseId: string } };
  assert.equal(existing.layer, 'existing');
  assert.equal(existing.mode, 'template');
  assert.equal(existing.item.sourceReleaseId, dashboard.sourceReleases[0]?.id);

  const newResponse = await fetch(`${baseUrl}/api/recommendations/regenerate-item`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      companyId: '1',
      layer: 'new',
      currentTitle: dashboard.newOpportunities[0]?.title,
      excludedTitles: dashboard.newOpportunities.map((item) => item.title),
    }),
  });
  assert.equal(newResponse.status, 200);
  const regenerated = (await newResponse.json()) as { layer: string; mode: string; item: { title: string } };
  assert.equal(regenerated.layer, 'new');
  assert.equal(regenerated.mode, 'template');
  assert(!dashboard.newOpportunities.some((item) => item.title === regenerated.item.title));
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
