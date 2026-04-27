import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichTicket, classificationOf, CLASSIFICATION_TAG_NAMES } from './enricher.js';

const TAG_MAP = {
  '6vy2': '0 - Zákaznícka podpora',
  'hp5o': '0 - Technická podpora',
  '24g7': '0 - BUG/Incident',
  'v0bm': '0 - URGENT BUG',
  '8byf': '- BEZPLATNÁ -',
};

test('classificationOf maps tag IDs to ZP/TP/BUG/URGENT_BUG', () => {
  assert.equal(classificationOf(['6vy2'], TAG_MAP), 'ZP');
  assert.equal(classificationOf(['hp5o'], TAG_MAP), 'TP');
  assert.equal(classificationOf(['24g7'], TAG_MAP), 'BUG');
  assert.equal(classificationOf(['v0bm'], TAG_MAP), 'URGENT_BUG');
  assert.equal(classificationOf(['8byf'], TAG_MAP), null);
  assert.equal(classificationOf([], TAG_MAP), null);
});

test('classificationOf prefers URGENT_BUG over BUG when both present', () => {
  assert.equal(classificationOf(['24g7', 'v0bm'], TAG_MAP), 'URGENT_BUG');
});

test('enrichTicket flattens listing entry with first message and classification', () => {
  const listing = {
    id: 't1', code: 'A-B-1', subject: 'Re: chyba v admin',
    date_created: '2026-04-20 10:00:00', status: 'N', channel_type: 'E',
    owner_email: 'k@example.sk', owner_name: 'Klient', agentid: 'a1',
    tags: ['6vy2'], custom_fields: [],
  };
  const msg = { raw_html: '<p>Hello</p>', plain_text: 'Hello' };
  const enriched = enrichTicket(listing, msg, TAG_MAP);
  assert.equal(enriched.id, 't1');
  assert.equal(enriched.subject, 'Re: chyba v admin');
  assert.equal(enriched.classification, 'ZP');
  assert.deepEqual(enriched.tag_names, ['0 - Zákaznícka podpora']);
  assert.equal(enriched.owner.domain, 'example.sk');
  assert.equal(enriched.first_customer_message.plain_text, 'Hello');
});

test('enrichTicket handles missing email and missing message', () => {
  const e = enrichTicket({ id: 't', subject: 's', date_created: 'd', tags: [], owner_email: '', owner_name: '' }, null, {});
  assert.equal(e.owner.domain, '');
  assert.equal(e.first_customer_message, null);
  assert.equal(e.classification, null);
});
