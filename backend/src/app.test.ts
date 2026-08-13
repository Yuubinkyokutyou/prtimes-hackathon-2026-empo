import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';
process.env.NODE_ENV = 'test';

const { app } = await import('./app.js');
const { closePool } = await import('./db.js');

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

test('GET /api/recommendations returns the demo dashboard', async () => {
  const response = await fetch(`${baseUrl}/api/recommendations`);
  assert.equal(response.status, 200);
  const data = (await response.json()) as {
    company: { name: string };
    existingSuggestions: unknown[];
    newOpportunity: { genre: string };
    meta: { dataSource: string };
  };
  assert.equal(data.company.name, '株式会社デモ青空');
  assert.equal(data.existingSuggestions.length, 4);
  assert.equal(data.newOpportunity.genre, '導入企業・伴走支援');
  assert.equal(data.meta.dataSource, 'mock');
});

test('GET /api/recommendation-companies returns selectable companies', async () => {
  const response = await fetch(`${baseUrl}/api/recommendation-companies`);
  assert.equal(response.status, 200);
  const data = (await response.json()) as {
    items: Array<{ id: string; name: string; releaseCount: number }>;
  };
  assert.deepEqual(data.items, [
    { id: '900001', name: '株式会社デモ青空', initials: '青', industry: '情報通信業', releaseCount: 5 },
  ]);
});

test('GET /api/recommendations returns 404 for an unknown company', async () => {
  const response = await fetch(`${baseUrl}/api/recommendations?companyId=999999`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Company not found' });
});

test('POST /api/recommendations/generate falls back safely without an API key', async () => {
  const response = await fetch(`${baseUrl}/api/recommendations/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId: '900001' }),
  });
  assert.equal(response.status, 200);
  const data = (await response.json()) as { meta: { mode: string } };
  assert.equal(data.meta.mode, 'demo');
});
