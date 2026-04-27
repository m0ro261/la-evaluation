import test from 'node:test';
import assert from 'node:assert/strict';
import { rulesToMarkdown, ticketsToCsv } from './exporter.js';

test('rulesToMarkdown produces a readable list with stats', () => {
  const rules = [
    { id: 'rule_001', human_readable: 'Ak subject obsahuje "x" → BUG', condition: { field: 'subject', operator: 'contains', value: 'x' }, action: { classification: 'BUG' }, stats: { matches_total: 5, true_positives: 4, false_positives: 1, confidence_percent: 80, coverage_percent: 5 }, examples: [{ ticket_id: 't1', subject: 'has x', actual_classification: 'BUG' }] },
  ];
  const md = rulesToMarkdown(rules);
  assert.match(md, /rule_001/);
  assert.match(md, /confidence/i);
  assert.match(md, /80/);
  assert.match(md, /coverage/i);
});

test('ticketsToCsv quotes commas and newlines correctly', () => {
  const tickets = [{ id: '1', subject: 'a, b\n"c"', date_created: '2026-04-01 00:00:00', classification: 'BUG', owner: { email: 'x@y', domain: 'y' }, agentid: 'a', code: 'C' }];
  const csv = ticketsToCsv(tickets);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'id,code,subject,date_created,classification,owner_email,owner_domain,agentid');
  // lines[1] is split at the embedded newline inside the quoted field; verify the quoted
  // field content spans lines[1]..lines[2] and the quoting is correct
  assert.match(lines[1], /^1,C,"a, b$/);
  assert.match(lines[2], /^""c""",/);
});
