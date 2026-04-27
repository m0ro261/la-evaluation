import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadAll } from './download.js';

function fakeClient({ tickets, agents, tags, messagesByTicket }) {
  return {
    listAgents: async () => agents,
    listTags: async () => tags,
    listTickets: async function* () { for (const t of tickets) yield t; },
    getTicketMessages: async (id) => messagesByTicket[id] ?? [],
  };
}

test('downloadAll fetches agents+tags first, then tickets, then per-ticket messages', async () => {
  const client = fakeClient({
    tickets: [
      { id: 't1', subject: 'Re: hi', date_created: '2026-04-20 10:00:00', tags: ['6vy2'], owner_email: 'a@x.sk', tag_ids: ['6vy2'] },
      { id: 't2', subject: 'crash', date_created: '2026-04-20 11:00:00', tags: ['24g7'], owner_email: 'b@y.sk' },
    ],
    agents: [{ id: 'agent1' }],
    tags: [{ id: '6vy2', name: '0 - Zákaznícka podpora' }, { id: '24g7', name: '0 - BUG/Incident' }],
    messagesByTicket: {
      t1: [{ userid: 'cust1', messages: [{ type: 'M', message: 'help' }] }],
      t2: [{ userid: 'agent1', messages: [{ type: 'M', message: 'we did' }] }, { userid: 'cust2', messages: [{ type: 'M', message: 'broken' }] }],
    },
  });
  const events = [];
  const result = await downloadAll({ client, from: '2026-04-01 00:00:00', maxTickets: 5000, knownIds: new Set(),
    onProgress: ev => events.push(ev) });
  assert.equal(result.tickets.length, 2);
  assert.equal(result.tickets[0].classification, 'ZP');
  assert.equal(result.tickets[0].first_customer_message.plain_text, 'help');
  assert.equal(result.tickets[1].classification, 'BUG');
  assert.equal(result.tickets[1].first_customer_message.plain_text, 'broken');
  assert.deepEqual(result.meta.tag_id_to_name['6vy2'], '0 - Zákaznícka podpora');
  assert.ok(events.some(e => e.phase === 'tickets'));
  assert.ok(events.some(e => e.phase === 'messages'));
});

test('downloadAll skips ticket IDs that are in knownIds (dedup on resume)', async () => {
  const client = fakeClient({
    tickets: [{ id: 't1', subject: 's', date_created: 'd', tags: [], owner_email: 'a@x' }, { id: 't2', subject: 's', date_created: 'd', tags: [], owner_email: 'b@x' }],
    agents: [], tags: [], messagesByTicket: {},
  });
  const result = await downloadAll({ client, from: 'X', maxTickets: 5000, knownIds: new Set(['t1']) });
  assert.deepEqual(result.tickets.map(t => t.id), ['t2']);
});

test('downloadAll respects maxTickets safeguard', async () => {
  const tickets = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, subject: '', date_created: '', tags: [], owner_email: 'x@y' }));
  const client = fakeClient({ tickets, agents: [], tags: [], messagesByTicket: {} });
  const result = await downloadAll({ client, from: 'X', maxTickets: 3, knownIds: new Set() });
  assert.equal(result.tickets.length, 3);
});

test('downloadAll skips deleted tickets and tickets with status X', async () => {
  const client = fakeClient({
    tickets: [
      { id: 't1', subject: 'normal', date_created: 'd', tags: [], owner_email: 'a@x', status: 'R', date_deleted: '' },
      { id: 't2', subject: 'archived', date_created: 'd', tags: [], owner_email: 'b@x', status: 'X', date_deleted: '' },
      { id: 't3', subject: 'deleted',  date_created: 'd', tags: [], owner_email: 'c@x', status: 'R', date_deleted: '2026-04-20 10:00:00' },
      { id: 't4', subject: 'kept',     date_created: 'd', tags: [], owner_email: 'd@x', status: 'N', date_deleted: '' },
    ],
    agents: [], tags: [], messagesByTicket: {},
  });
  const result = await downloadAll({ client, from: 'X', maxTickets: 5000, knownIds: new Set() });
  assert.deepEqual(result.tickets.map(t => t.id), ['t1', 't4']);
  assert.equal(result.meta.skips.deleted, 1);
  assert.equal(result.meta.skips.by_status.X, 1);
  assert.equal(result.meta.raw_count, 4);
});

test('downloadAll filter is configurable via skippedStatuses option', async () => {
  const client = fakeClient({
    tickets: [
      { id: 't1', subject: 's', date_created: 'd', tags: [], owner_email: 'a@x', status: 'R', date_deleted: '' },
      { id: 't2', subject: 's', date_created: 'd', tags: [], owner_email: 'b@x', status: 'D', date_deleted: '' },
    ],
    agents: [], tags: [], messagesByTicket: {},
  });
  const result = await downloadAll({ client, from: 'X', maxTickets: 5000, knownIds: new Set(), skippedStatuses: new Set(['D']), skipDeleted: false });
  assert.deepEqual(result.tickets.map(t => t.id), ['t1']);
  assert.equal(result.meta.skips.by_status.D, 1);
});

test('downloadAll honors abort signal mid-download', async () => {
  const ac = new AbortController();
  const tickets = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, subject: '', date_created: '', tags: [], owner_email: 'x@y' }));
  let count = 0;
  const client = {
    listAgents: async () => [],
    listTags: async () => [],
    listTickets: async function* () {
      for (const t of tickets) {
        count++;
        if (count === 3) ac.abort();
        yield t;
      }
    },
    getTicketMessages: async () => [],
  };
  const result = await downloadAll({ client, from: 'X', maxTickets: 5000, knownIds: new Set(), signal: ac.signal });
  assert.ok(result.tickets.length <= 3);
  assert.equal(result.cancelled, true);
});
