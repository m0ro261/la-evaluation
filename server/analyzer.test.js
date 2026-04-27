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
