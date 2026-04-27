import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createStorage } from './storage.js';

async function tmpDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'la-store-'));
}

test('saveCache writes a timestamped file and updates latest pointer', async () => {
  const dir = await tmpDir();
  const s = createStorage(dir);
  const meta = { range: { from: '2026-01-01', to: '2026-04-27' }, count: 2 };
  const file = await s.saveCache({ tickets: [{ id: 'a' }, { id: 'b' }], meta });
  assert.match(path.basename(file), /^tickets-\d{8}T\d{6}Z\.json$/);
  const latest = JSON.parse(await fs.readFile(path.join(dir, 'latest.json'), 'utf8'));
  assert.equal(latest.file, path.basename(file));
  assert.equal(latest.meta.count, 2);
});

test('loadLatest returns null when no cache exists', async () => {
  const s = createStorage(await tmpDir());
  assert.equal(await s.loadLatest(), null);
});

test('loadLatest returns the cached payload', async () => {
  const dir = await tmpDir();
  const s = createStorage(dir);
  await s.saveCache({ tickets: [{ id: 'a' }], meta: { count: 1 } });
  const loaded = await s.loadLatest();
  assert.deepEqual(loaded.tickets, [{ id: 'a' }]);
});

test('isFresh true within 24h, false otherwise', async () => {
  const dir = await tmpDir();
  const s = createStorage(dir);
  await s.saveCache({ tickets: [], meta: { count: 0 } });
  assert.equal(await s.isFresh(), true);
  // simulate stale by rewriting latest.json with older timestamp
  const latest = JSON.parse(await fs.readFile(path.join(dir, 'latest.json'), 'utf8'));
  latest.saved_at = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  await fs.writeFile(path.join(dir, 'latest.json'), JSON.stringify(latest));
  assert.equal(await s.isFresh(), false);
});

test('readJson/writeJson round-trip arbitrary file', async () => {
  const dir = await tmpDir();
  const s = createStorage(dir);
  await s.writeJson('foo.json', { a: 1 });
  assert.deepEqual(await s.readJson('foo.json'), { a: 1 });
  assert.equal(await s.readJson('missing.json'), null);
});
