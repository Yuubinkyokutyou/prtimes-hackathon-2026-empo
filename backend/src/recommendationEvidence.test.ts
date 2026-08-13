import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildReleaseEvidence,
  evidenceFromSourceTitle,
  plainText,
  withEvidenceFallback,
} from './recommendationEvidence.js';
import type { RecommendationDashboard } from './recommendationTypes.js';

test('plainText removes HTML and decodes common entities', () => {
  assert.equal(
    plainText('<p>&nbsp;　新商品 &amp; 新サービス</p><script>ignore()</script>'),
    '新商品 & 新サービス',
  );
});

test('buildReleaseEvidence falls back from lead paragraph to subtitle, body, and title', () => {
  assert.equal(buildReleaseEvidence({
    title: '新商品発表',
    leadParagraph: '<p>&nbsp;</p>',
    subtitle: '新しい挑戦を開始します。',
    body: '<p>本文です。</p>',
  }), '新しい挑戦を開始します。');

  assert.equal(buildReleaseEvidence({
    title: '新商品発表',
    leadParagraph: '',
    subtitle: '',
    body: '<p>開発チームが顧客の課題を受けて改善しました。</p>',
  }), '開発チームが顧客の課題を受けて改善しました。');

  assert.equal(buildReleaseEvidence({
    title: '新商品発表',
    leadParagraph: '',
    subtitle: '',
    body: '',
  }), evidenceFromSourceTitle('新商品発表'));
});

test('withEvidenceFallback repairs blank evidence from saved history', () => {
  const dashboard = {
    existingSuggestions: [{ sourceEvidence: '   ', sourceTitle: '新商品発表' }],
  } as RecommendationDashboard;
  const repaired = withEvidenceFallback(dashboard);
  assert.equal(
    repaired.existingSuggestions[0]?.sourceEvidence,
    evidenceFromSourceTitle('新商品発表'),
  );
});
