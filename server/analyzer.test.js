import test from 'node:test';
import assert from 'node:assert/strict';
import { distributionStats, weeklyTrend, topCustomers, topDomains } from './analyzer.js';

const TICKETS = [
  { id: '1', classification: 'ZP', date_created: '2026-04-01 10:00:00', owner: { email: 'a@x.sk', name: 'A', domain: 'x.sk' } },
  { id: '2', classification: 'ZP', date_created: '2026-04-08 10:00:00', owner: { email: 'b@x.sk', name: 'B', domain: 'x.sk' } },
  { id: '3', classification: 'BUG', date_created: '2026-04-08 10:00:00', owner: { email: 'a@x.sk', name: 'A', domain: 'x.sk' } },
  { id: '4', classification: null,  date_created: '2026-04-10 10:00:00', owner: { email: 'c@y.sk', name: 'C', domain: 'y.sk' } },
];

test('distributionStats counts per class and unclassified', () => {
  const d = distributionStats(TICKETS);
  assert.equal(d.total, 4);
  assert.equal(d.unclassified, 1);
  assert.equal(d.by_class.ZP, 2);
  assert.equal(d.by_class.BUG, 1);
  assert.equal(d.by_class.TP, 0);
});

test('weeklyTrend buckets by ISO week', () => {
  const t = weeklyTrend(TICKETS);
  assert.ok(t.length >= 1);
  const total = t.reduce((s, w) => s + w.total, 0);
  assert.equal(total, 4);
});

test('topCustomers groups by email and computes class shares', () => {
  const c = topCustomers(TICKETS, 5);
  const a = c.find(x => x.email === 'a@x.sk');
  assert.equal(a.total, 2);
  assert.equal(a.by_class.ZP, 1);
  assert.equal(a.by_class.BUG, 1);
});

test('topDomains groups by domain', () => {
  const d = topDomains(TICKETS, 5);
  const x = d.find(x => x.domain === 'x.sk');
  assert.equal(x.total, 3);
});

import { keywordStats, gSquared } from './analyzer.js';
import { stripSubjectPrefix, tokenize } from './text-utils.js';

test('gSquared higher when word strongly associated with one class', () => {
  // word appears 9/10 in class, 1/100 in rest
  const score = gSquared(9, 10, 1, 100);
  // score should be substantially positive
  assert.ok(score > 10, `expected high G2, got ${score}`);
});

test('gSquared near zero when word is uniform across classes', () => {
  const score = gSquared(5, 100, 5, 100);
  assert.ok(Math.abs(score) < 0.5, `expected ~0, got ${score}`);
});

test('keywordStats returns top differential words per class', () => {
  const tickets = [
    { classification: 'BUG', subject: 'nefunguje admin nefunguje', first_customer_message: { plain_text: 'nefunguje admin' } },
    { classification: 'BUG', subject: 'chyba nefunguje', first_customer_message: { plain_text: 'chyba' } },
    { classification: 'ZP',  subject: 'ako nastavit',   first_customer_message: { plain_text: 'ako nastavit' } },
    { classification: 'ZP',  subject: 'ako pouzivat',   first_customer_message: { plain_text: 'ako pouzivat' } },
    { classification: 'TP',  subject: 'uprava designu', first_customer_message: { plain_text: 'uprava designu' } },
  ];
  const stopwords = new Set();
  const out = keywordStats(tickets, { stopwords, topN: 5 });
  assert.ok(out.BUG.subject.length >= 1);
  assert.equal(out.BUG.subject[0].word, 'nefunguje');
  // ZP top should not be 'nefunguje'
  assert.ok(!out.ZP.subject.find(w => w.word === 'nefunguje'));
});
