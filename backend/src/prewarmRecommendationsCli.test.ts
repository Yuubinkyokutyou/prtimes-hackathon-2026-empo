import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePrewarmArguments } from './prewarmRecommendationsCli.js';

test('prewarm arguments accept repeated PostgreSQL company IDs', () => {
  assert.deepEqual(
    parsePrewarmArguments([
      '--company-id', '101',
      '--company-id=202',
      '--company-id', '101',
      '--refresh',
    ]),
    { companyIds: ['101', '202'], refresh: true, help: false },
  );
});

test('prewarm arguments require at least one positive company ID', () => {
  assert.throws(() => parsePrewarmArguments([]), /At least one --company-id is required/);
  assert.throws(
    () => parsePrewarmArguments(['--company-id', 'not-a-number']),
    /--company-id must be a positive integer/,
  );
});
