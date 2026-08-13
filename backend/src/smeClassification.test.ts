import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSmeByCapital } from './smeClassification.js';

test('capital-based SME estimate applies industry-specific thresholds', () => {
  assert.equal(isSmeByCapital('製造業', 30_000), true);
  assert.equal(isSmeByCapital('製造業', 30_001), false);
  assert.equal(isSmeByCapital('サービス業', 5_000), true);
  assert.equal(isSmeByCapital('サービス業', 5_001), false);
});

test('combined wholesale/retail industry uses the stricter retail threshold', () => {
  assert.equal(isSmeByCapital('商業（卸売業、小売業）', 5_000), true);
  assert.equal(isSmeByCapital('商業（卸売業、小売業）', 5_001), false);
});

test('unknown capital and non-company sectors are not included', () => {
  assert.equal(isSmeByCapital('情報通信', 0), false);
  assert.equal(isSmeByCapital('官公庁・地方自治体', 1), false);
  assert.equal(isSmeByCapital('財団法人・社団法人・宗教法人', 1), false);
});
