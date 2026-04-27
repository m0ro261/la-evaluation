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
