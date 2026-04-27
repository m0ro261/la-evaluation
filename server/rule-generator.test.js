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

test('generateKeywordRules emits rules above thresholds, sorted by coverage', () => {
  const stopwords = new Set();
  const rules = generateKeywordRules(TICKETS, { stopwords, minConfidence: 60, minSubjectCoverage: 10 });
  // expect a rule about 'ako' for ZP (matches t5, t6)
  const ako = rules.find(r => r.condition.value === 'ako' && r.action.classification === 'ZP');
  assert.ok(ako, 'expected ZP rule for "ako"');
  assert.ok(ako.stats.confidence_percent >= 60);
  // result is sorted by coverage desc
  for (let i = 1; i < rules.length; i++) {
    assert.ok(rules[i - 1].stats.coverage_percent >= rules[i].stats.coverage_percent);
  }
});
