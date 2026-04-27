import fs from 'node:fs/promises';
import path from 'node:path';

export function createStorage(dir) {
  async function ensureDir() { await fs.mkdir(dir, { recursive: true }); }

  async function readJson(name) {
    try { return JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')); }
    catch (e) {
      if (e.code === 'ENOENT') return null;
      if (e instanceof SyntaxError) { console.warn(`[storage] corrupted JSON ${name}, treating as empty`); return null; }
      throw e;
    }
  }

  async function writeJson(name, data) {
    await ensureDir();
    const tmp = path.join(dir, `${name}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmp, path.join(dir, name));
  }

  async function saveCache({ tickets, meta }) {
    await ensureDir();
    const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const file = `tickets-${ts}.json`;
    await writeJson(file, { tickets, meta });
    await writeJson('latest.json', { file, meta, saved_at: new Date().toISOString() });
    return path.join(dir, file);
  }

  async function loadLatest() {
    const ptr = await readJson('latest.json');
    if (!ptr) return null;
    const payload = await readJson(ptr.file);
    if (!payload) return null;
    return { ...payload, saved_at: ptr.saved_at };
  }

  async function isFresh(maxAgeMs = 24 * 3600 * 1000) {
    const ptr = await readJson('latest.json');
    if (!ptr?.saved_at) return false;
    return Date.now() - new Date(ptr.saved_at).getTime() < maxAgeMs;
  }

  return { readJson, writeJson, saveCache, loadLatest, isFresh, dir };
}
