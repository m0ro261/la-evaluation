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
