import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from './la-client.js';

function fakeFetch(responses) {
  let i = 0;
  return async (url, opts) => {
    const r = responses[i++] ?? responses.at(-1);
    if (typeof r === 'function') return r(url, opts);
    return r;
  };
}
function jsonRes(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

test('laFetch sends apikey header', async () => {
  let captured;
  const client = createClient({ baseUrl: 'https://x/api/v3', apiKey: 'KEY', fetch: async (u, o) => { captured = o; return jsonRes({ ok: true }); }, sleep: async () => {} });
  await client.laFetch('/agents');
  assert.equal(captured.headers.apikey, 'KEY');
});

test('laFetch retries on 429 with backoff and succeeds', async () => {
  const sleeps = [];
  const client = createClient({ baseUrl: 'https://x/api/v3', apiKey: 'K',
    fetch: fakeFetch([jsonRes({ message: 'rate' }, 429), jsonRes({ message: 'rate' }, 429), jsonRes([{ id: 'a' }])]),
    sleep: async (ms) => { sleeps.push(ms); }
  });
  const res = await client.laFetch('/tickets');
  assert.deepEqual(res, [{ id: 'a' }]);
  assert.deepEqual(sleeps, [1000, 2000]);
});

test('laFetch throws ApiError on 401 with server message', async () => {
  const client = createClient({ baseUrl: 'https://x/api/v3', apiKey: 'K',
    fetch: fakeFetch([jsonRes({ message: 'Auth failed' }, 401)]), sleep: async () => {} });
  await assert.rejects(() => client.laFetch('/agents'), e => e.status === 401 && /Auth failed/.test(e.message));
});

test('laFetch gives up after 4 retries on 429', async () => {
  const client = createClient({ baseUrl: 'https://x/api/v3', apiKey: 'K',
    fetch: fakeFetch([jsonRes({}, 429), jsonRes({}, 429), jsonRes({}, 429), jsonRes({}, 429), jsonRes({}, 429)]),
    sleep: async () => {} });
  await assert.rejects(() => client.laFetch('/tickets'), e => e.status === 429);
});

test('listTickets pages until empty array', async () => {
  const pages = [
    [{ id: 'a' }, { id: 'b' }],
    [{ id: 'c' }],
    [],
  ];
  let i = 0;
  const client = createClient({ baseUrl: 'https://x/api/v3', apiKey: 'K',
    fetch: async () => jsonRes(pages[i++]), sleep: async () => {} });
  const all = [];
  for await (const t of client.listTickets({ from: '2026-01-01 00:00:00' })) all.push(t);
  assert.equal(all.length, 3);
  assert.deepEqual(all.map(x => x.id), ['a', 'b', 'c']);
});

test('listTickets sends correct date filter', async () => {
  const captured = [];
  const client = createClient({ baseUrl: 'https://x/api/v3', apiKey: 'K',
    fetch: async (url) => { captured.push(url); return jsonRes([]); }, sleep: async () => {} });
  for await (const _ of client.listTickets({ from: '2026-01-01 00:00:00' })) {}
  const url = new URL(captured[0]);
  const filters = JSON.parse(url.searchParams.get('_filters'));
  assert.deepEqual(filters, [['date_created', 'D>=', '2026-01-01 00:00:00']]);
  assert.equal(url.searchParams.get('_perPage'), '100');
  assert.equal(url.searchParams.get('_page'), '1');
});

test('listTickets supports cancel signal', async () => {
  const ac = new AbortController();
  let calls = 0;
  const client = createClient({ baseUrl: 'https://x/api/v3', apiKey: 'K',
    fetch: async () => { calls++; if (calls === 2) ac.abort(); return jsonRes([{ id: String(calls) }]); }, sleep: async () => {} });
  const ids = [];
  for await (const t of client.listTickets({ from: '2026-01-01 00:00:00', signal: ac.signal })) ids.push(t.id);
  assert.deepEqual(ids, ['1', '2']);
});

test('listAgents fetches one page and returns array', async () => {
  const client = createClient({ baseUrl: 'https://x/api/v3', apiKey: 'K',
    fetch: async () => jsonRes([{ id: 'a1', name: 'Alice', role: 'agent' }]), sleep: async () => {} });
  const agents = await client.listAgents();
  assert.equal(agents[0].name, 'Alice');
});

test('listTags fetches one page and returns array', async () => {
  const client = createClient({ baseUrl: 'https://x/api/v3', apiKey: 'K',
    fetch: async () => jsonRes([{ id: '6vy2', name: '0 - Zákaznícka podpora' }]), sleep: async () => {} });
  const tags = await client.listTags();
  assert.equal(tags[0].id, '6vy2');
});
