import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';

function start() {
  const app = createApp({ clientFactory: () => ({
    listAgents: async () => [{ id: 'a1', name: 'A', role: 'agent' }],
  }) });
  const server = app.listen(0);
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

test('POST /api/test-connection returns ok when client.listAgents resolves', async () => {
  const { server, base } = start();
  const res = await fetch(`${base}/api/test-connection`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseUrl: 'https://x/api/v3', apiKey: 'K' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.agent_count, 1);
  server.close();
});

test('POST /api/test-connection returns 400 with the API error on auth failure', async () => {
  const app = createApp({ clientFactory: () => ({
    listAgents: async () => { const e = new Error('Auth failed'); e.status = 401; throw e; },
  }) });
  const server = app.listen(0);
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/test-connection`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseUrl: 'https://x/api/v3', apiKey: 'BAD' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.message, /Auth failed/);
  server.close();
});

test('POST /api/download streams SSE events and persists cache', async () => {
  let storage;
  process.env.LA_API_URL = 'https://x/api/v3';
  process.env.LA_API_KEY = 'TEST';
  const app = createApp({
    clientFactory: () => ({
      listAgents: async () => [{ id: 'agent1' }],
      listTags: async () => [{ id: '6vy2', name: '0 - Zákaznícka podpora' }],
      listTickets: async function* () { yield { id: 't1', subject: 's', date_created: '2026-04-20 00:00:00', tags: ['6vy2'], owner_email: 'a@x.sk' }; },
      getTicketMessages: async () => [{ userid: 'cust', messages: [{ type: 'M', message: 'hi' }] }],
    }),
    storageFactory: (dir) => (storage = createStorageInMemory()),
  });
  const server = app.listen(0); const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/download`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from: '2026-04-01 00:00:00' }),
  });
  assert.equal(res.headers.get('content-type').startsWith('text/event-stream'), true);
  const text = await res.text();
  assert.match(text, /event: progress/);
  assert.match(text, /event: done/);
  assert.ok(storage.saved.tickets.length === 1);
  server.close();
});

test('GET /api/cache returns 404 when no cache, 200 with summary otherwise', async () => {
  const stub = createStorageInMemory();
  const app = createApp({ storageFactory: () => stub });
  const server = app.listen(0); const { port } = server.address();
  let res = await fetch(`http://127.0.0.1:${port}/api/cache`);
  assert.equal(res.status, 404);
  await stub.saveCache({ tickets: [{ id: 'a', classification: 'ZP', date_created: '2026-04-20 00:00:00' }], meta: { range: { from: 'X' }, count: 1, tag_id_to_name: {} } });
  res = await fetch(`http://127.0.0.1:${port}/api/cache`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.count, 1);
  server.close();
});

test('GET /api/analysis runs analyzer + rule-generator on cached tickets', async () => {
  const stub = createStorageInMemory();
  await stub.saveCache({
    tickets: [
      { id: 'a', classification: 'ZP', subject: 'ako nastavit', date_created: '2026-04-20 00:00:00', owner: { email: 'x@y.sk', domain: 'y.sk' }, first_customer_message: { plain_text: '' } },
      { id: 'b', classification: 'BUG', subject: 'nefunguje admin', date_created: '2026-04-20 00:00:00', owner: { email: 'x@y.sk', domain: 'y.sk' }, first_customer_message: { plain_text: '' } },
    ],
    meta: { count: 2, tag_id_to_name: {} },
  });
  const app = createApp({ storageFactory: () => stub });
  const server = app.listen(0); const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/analysis`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.distribution);
  assert.ok(body.weekly_trend);
  assert.ok(Array.isArray(body.top_customers));
  assert.ok(Array.isArray(body.top_domains));
  assert.ok(body.keyword_stats);
  assert.ok(Array.isArray(body.rules));
  assert.ok(body.edge_cases);
  server.close();
});

test('POST /api/tag-categories persists categorization', async () => {
  const stub = createStorageInMemory();
  const app = createApp({ storageFactory: () => stub });
  const server = app.listen(0); const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/tag-categories`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ categories: { '6vy2': 'classification', '8byf': 'internal' } }),
  });
  assert.equal(res.status, 200);
  const saved = await stub.readJson('tag-categories.json');
  assert.equal(saved.categories['6vy2'], 'classification');
  server.close();
});

function createStorageInMemory() {
  const m = { saved: null, files: {} };
  m.saveCache = async ({ tickets, meta }) => { m.saved = { tickets, meta }; return 'mem://x'; };
  m.loadLatest = async () => m.saved ? { ...m.saved, saved_at: new Date().toISOString() } : null;
  m.isFresh = async () => Boolean(m.saved);
  m.readJson = async (name) => m.files[name] ?? null;
  m.writeJson = async (name, data) => { m.files[name] = data; };
  return m;
}
