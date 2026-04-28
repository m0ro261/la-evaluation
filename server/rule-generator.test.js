import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeywordRules, scoreRule } from './rule-generator.js';

const TICKETS = [
  { id: 't1', classification: 'BUG', subject: 'nefunguje admin', first_customer_message: { plain_text: 'nefunguje' } },
  { id: 't2', classification: 'BUG', subject: 'admin nefunguje', first_customer_message: { plain_text: '' } },
  { id: 't3', classification: 'BUG', subject: 'chyba',           first_customer_message: { plain_text: '' } },
  { id: 't4', classification: 'TP',  subject: 'nefunguje export', first_customer_message: { plain_text: '' } },
  { id: 't5', classification: 'ZP',  subject: 'ako nastavit',     first_customer_message: { plain_text: '' } },
  { id: 't6', classification: 'ZP',  subject: 'ako pouzivat',     first_customer_message: { plain_text: '' } },
  { id: 't7', classification: 'ZP',  subject: 'cena licencie',    first_customer_message: { plain_text: '' } },
  { id: 't8', classification: 'TP',  subject: 'uprava designu',   first_customer_message: { plain_text: '' } },
  { id: 't9', classification: 'TP',  subject: 'novy modul',       first_customer_message: { plain_text: '' } },
  { id: 't10', classification: null, subject: 'spam',             first_customer_message: { plain_text: '' } },
];

test('scoreRule returns matches, confidence, coverage on subject contains', () => {
  const rule = { type: 'keyword_subject', condition: { field: 'subject', operator: 'contains', value: 'nefunguje' }, action: { classification: 'BUG' } };
  const s = scoreRule(rule, TICKETS);
  assert.equal(s.matches_total, 3);
  assert.equal(s.true_positives, 2);
  assert.equal(s.false_positives, 1);
  // confidence = 2/3
  assert.ok(Math.abs(s.confidence_percent - 66.67) < 0.5);
  // coverage = 3/10
  assert.equal(s.coverage_percent, 30);
});

test('scoreRule confidence ignores unclassified matches (uses LABELED only)', () => {
  // 2 BUG matches, 0 classified disagreements, 5 unclassified matches.
  // OLD wrong behavior: confidence = 2/7 = 28.6%
  // NEW correct behavior: confidence = 2/2 = 100% (unclassified don't have ground truth)
  const tickets = [
    { id: 'b1', classification: 'BUG', subject: 'nefunguje admin' },
    { id: 'b2', classification: 'BUG', subject: 'nefunguje export' },
    { id: 'u1', classification: null,  subject: 'nefunguje neviem' },
    { id: 'u2', classification: null,  subject: 'nefunguje produkt' },
    { id: 'u3', classification: null,  subject: 'nefunguje koncovka' },
    { id: 'u4', classification: null,  subject: 'nefunguje api' },
    { id: 'u5', classification: null,  subject: 'nefunguje import' },
    { id: 'z1', classification: 'ZP',  subject: 'ako nastavit' },
  ];
  const rule = { condition: { field: 'subject', operator: 'contains', value: 'nefunguje' }, action: { classification: 'BUG' } };
  const s = scoreRule(rule, tickets);
  assert.equal(s.matches_total, 7);
  assert.equal(s.true_positives, 2);
  assert.equal(s.false_positives, 0);
  assert.equal(s.unclassified_matches, 5);
  assert.equal(s.confidence_percent, 100);
  // coverage still uses total (= matches / all tickets)
  assert.ok(Math.abs(s.coverage_percent - 87.5) < 0.5);
});

test('generateKeywordRules emits rules above thresholds, sorted by coverage', () => {
  const stopwords = new Set();
  const rules = generateKeywordRules(TICKETS, { stopwords, minConfidence: 60, minSubjectCoverage: 10, minTruePositives: 1 });
  // expect a rule about 'ako' for ZP (matches t5, t6)
  const ako = rules.find(r => r.condition.value === 'ako' && r.action.classification === 'ZP');
  assert.ok(ako, 'expected ZP rule for "ako"');
  assert.ok(ako.stats.confidence_percent >= 60);
  // result is sorted by coverage desc
  for (let i = 1; i < rules.length; i++) {
    assert.ok(rules[i - 1].stats.coverage_percent >= rules[i].stats.coverage_percent);
  }
});

import { generateDomainRules, generateEmailRules, edgeCases, generateAllRules } from './rule-generator.js';

const TICKETS_DOM = [
  ...Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, classification: 'TP', subject: '', first_customer_message: null, owner: { email: `u${i}@klient.sk`, domain: 'klient.sk' } })),
  { id: 'c10', classification: 'BUG', subject: '', first_customer_message: null, owner: { email: 'u10@klient.sk', domain: 'klient.sk' } },
  ...Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, classification: 'ZP', subject: '', first_customer_message: null, owner: { email: `r${i}@gmail.com`, domain: 'gmail.com' } })),
];

test('generateDomainRules emits domain rules above 80% in dominant class with >=10 tickets', () => {
  const rules = generateDomainRules(TICKETS_DOM, { minTickets: 10, minConfidence: 80 });
  const klient = rules.find(r => r.condition.value === 'klient.sk');
  assert.ok(klient);
  assert.equal(klient.action.classification, 'TP');
  // gmail group has only 5 tickets — should NOT produce a rule
  assert.equal(rules.find(r => r.condition.value === 'gmail.com'), undefined);
});

test('generateEmailRules emits per-email rules with >=5 tickets and >=90%', () => {
  const TICKETS_E = Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, classification: i < 6 ? 'BUG' : 'ZP', subject: '', first_customer_message: null, owner: { email: 'specific@x.sk', domain: 'x.sk' } }));
  const rules = generateEmailRules(TICKETS_E, { minTickets: 5, minConfidence: 90 });
  const r = rules.find(x => x.condition.value === 'specific@x.sk');
  assert.ok(r);
  assert.equal(r.action.classification, 'BUG');
});

test('edgeCases returns tickets that no rule matches AND tickets where rules disagree with actual class', () => {
  const tickets = [
    { id: 'a', classification: 'BUG', subject: 'nefunguje', first_customer_message: null, owner: { email: 'a@x', domain: 'x' } },
    { id: 'b', classification: 'ZP',  subject: 'rozporné',  first_customer_message: null, owner: { email: 'b@x', domain: 'x' } },
    { id: 'c', classification: 'TP',  subject: 'nic-nepasuje', first_customer_message: null, owner: { email: 'c@x', domain: 'x' } },
  ];
  const rules = [
    { id: 'r1', condition: { field: 'subject', operator: 'contains', value: 'nefunguje' }, action: { classification: 'BUG' } },
  ];
  const ec = edgeCases(tickets, rules, { sampleSize: 10 });
  assert.ok(ec.uncovered.find(t => t.id === 'b' || t.id === 'c'));
  assert.equal(ec.disagreements.length, 0); // r1 only matches 'a', which agrees
});

test('generateAllRules merges keyword + domain + email rules with stable ids', () => {
  const stopwords = new Set();
  const out = generateAllRules(TICKETS, { stopwords });
  assert.ok(Array.isArray(out.rules));
  assert.ok(Array.isArray(out.edge_cases.uncovered));
  // stable ids (rule_001, rule_002, ...)
  for (let i = 0; i < out.rules.length; i++) {
    assert.match(out.rules[i].id, /^rule_\d{3}$/);
  }
});
