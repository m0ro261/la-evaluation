import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';

test('GET / returns 200 with html', async () => {
  const app = createApp();
  const server = app.listen(0);
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /LA Tickets Analyzer/i);
  server.close();
});
