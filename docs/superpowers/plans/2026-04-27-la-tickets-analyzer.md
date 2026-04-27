# LA Tickets Analyzer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local web app that pulls historical LiveAgent tickets from `creativesites.ladesk.com`, analyzes the manual classifications (ZP/TP/BUG/URGENT_BUG), and proposes deterministic LA Rules with confidence/coverage stats.

**Architecture:** Express server + vanilla JS frontend, both served by the same Node process on `localhost:3001`. JSON files on disk for cache. No build step. Every backend module is unit-tested with the built-in `node:test` runner.

**Tech Stack:** Node 20+, Express 4, Chart.js (CDN), `dotenv`, `node:test` for tests.

**Spec reference:** `docs/superpowers/specs/2026-04-27-la-tickets-analyzer-design.md` — read it once before starting; this plan implements that spec verbatim.

**Conventions:**
- All file paths in this plan are relative to repo root `la-evaluation/`.
- Every "Step: Commit" runs `git add` then `git commit -m "..."`. Squash within a task is fine; do not skip the commit step.
- The LA API key lives only in `.env`. Tests must not require it — they use a fake fetch.

---

## Phase 0 — Project bootstrap

### Task 0.1: package.json + ignores + env example

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `data/.gitkeep`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "la-tickets-analyzer",
  "version": "0.1.0",
  "description": "Local analyzer for LiveAgent tickets that proposes LA Rules from historical patterns",
  "main": "server/app.js",
  "scripts": {
    "start": "node server/app.js",
    "dev": "node --watch server/app.js",
    "test": "node --test server/**/*.test.js"
  },
  "type": "module",
  "engines": { "node": ">=20" },
  "dependencies": {
    "express": "^4.19.2",
    "dotenv": "^16.4.5"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
.env
data/*.json
data/*.partial.json
!data/.gitkeep
.DS_Store
*.log
```

- [ ] **Step 3: Create `.env.example`**

```
LA_API_URL=https://creativesites.ladesk.com/api/v3
LA_API_KEY=
PORT=3001
DEFAULT_PERIOD_DAYS=180
```

- [ ] **Step 4: Create `data/.gitkeep`** (empty file so the dir is tracked)

- [ ] **Step 5: Install deps**

Run: `npm install`
Expected: creates `node_modules/`, `package-lock.json`. No errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example data/.gitkeep
git commit -m "chore: bootstrap package.json, env example, gitignore"
```

### Task 0.2: Hello-world Express server

**Files:**
- Create: `server/app.js`
- Create: `server/app.test.js`

- [ ] **Step 1: Write the failing test**

`server/app.test.js`:
```js
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
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './app.js'`.

- [ ] **Step 3: Implement minimal `server/app.js`**

```js
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(PUBLIC_DIR));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  return app;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  const port = Number(process.env.PORT) || 3001;
  createApp().listen(port, () => console.log(`LA Analyzer on http://localhost:${port}`));
}
```

- [ ] **Step 4: Create placeholder `public/index.html`**

```html
<!doctype html>
<html lang="sk">
  <head><meta charset="utf-8"><title>LA Tickets Analyzer</title></head>
  <body><h1>LA Tickets Analyzer</h1><p>Bootstrap OK.</p></body>
</html>
```

- [ ] **Step 5: Run test, verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Smoke-test manually**

Run: `npm start`
Open: `http://localhost:3001/`
Expected: page shows "LA Tickets Analyzer" heading. `Ctrl-C` to stop.

- [ ] **Step 7: Commit**

```bash
git add server/app.js server/app.test.js public/index.html
git commit -m "feat(server): bootstrap express app with static frontend"
```

---

## Phase 1 — Text utilities (pure functions, easiest TDD)

### Task 1.1: HTML strip + entity decode

**Files:**
- Create: `server/text-utils.js`
- Create: `server/text-utils.test.js`

- [ ] **Step 1: Write failing tests**

`server/text-utils.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { stripHtml } from './text-utils.js';

test('stripHtml removes tags and collapses whitespace', () => {
  const input = '<div>Dobrý  <b>deň</b><br>chcem  sa<br/>pýtať</div>';
  assert.equal(stripHtml(input), 'Dobrý deň chcem sa pýtať');
});

test('stripHtml decodes common entities', () => {
  assert.equal(stripHtml('a&nbsp;b&amp;c &lt;x&gt; &#39;y&#39; &quot;z&quot;'), 'a b&c <x> \'y\' "z"');
});

test('stripHtml handles empty/null gracefully', () => {
  assert.equal(stripHtml(''), '');
  assert.equal(stripHtml(null), '');
  assert.equal(stripHtml(undefined), '');
});

test('stripHtml strips style and script blocks', () => {
  assert.equal(stripHtml('a<style>.x{}</style>b<script>alert(1)</script>c'), 'a b c');
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `stripHtml`**

`server/text-utils.js`:
```js
const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
  '&quot;': '"', '&apos;': "'", '&#39;': "'",
};

export function stripHtml(input) {
  if (!input) return '';
  let s = String(input);
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&[a-z#0-9]+;/gi, m => ENTITIES[m] ?? (m.startsWith('&#') ? String.fromCodePoint(Number(m.slice(2, -1))) : m));
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/text-utils.js server/text-utils.test.js
git commit -m "feat(text-utils): stripHtml with entity decode"
```

### Task 1.2: Subject prefix strip + tokenize + stopwords

**Files:**
- Modify: `server/text-utils.js`
- Modify: `server/text-utils.test.js`
- Create: `data/stopwords-sk.json`

- [ ] **Step 1: Seed the stop-words file**

`data/stopwords-sk.json`:
```json
[
  "a","ako","ale","ani","asi","áno","aspoň","až","ba","bez","by","byť","či","do","dva","ešte",
  "hneď","hoci","i","iba","ich","im","ináč","iný","ja","je","jeho","jej","jemu","ju","k",
  "každý","keď","ktorá","ktoré","ktorí","ktorý","ku","kus","len","ma","mať","mi","mne",
  "mnohý","mu","my","na","nad","nám","naopak","naozaj","nás","náš","nasledujúci","naši",
  "nech","neho","nej","nemu","ne","ni","nich","nie","niekto","niečo","no","nový","o","od",
  "on","ona","oni","ono","ony","po","pod","podľa","pokiaľ","pozri","pre","pred","preto",
  "pretože","prečo","pri","prvý","sa","sám","sama","samé","seba","sebe","sem","si",
  "sme","so","som","ste","sú","ta","tak","takmer","tam","te","teba","tebe","ten","tenže",
  "tí","tie","tieto","tomu","ton","tu","tú","tvoj","ty","u","už","v","vám","váš","vy",
  "z","za","zaiste","zatiaľ",
  "re","fwd","fw","odp","subject","from","to","cc","bcc",
  "the","and","or","of","in","is","it","this","that","with","for","on","at","be","as"
]
```

> **Note:** edit the file later if certain words still pollute keywords; the analyzer re-reads on every analysis.

- [ ] **Step 2: Add failing tests**

Append to `server/text-utils.test.js`:
```js
import { stripSubjectPrefix, tokenize, loadStopwords } from './text-utils.js';
import path from 'node:path';

test('stripSubjectPrefix removes Re:/Fwd:/Fw:/Odp: chains', () => {
  assert.equal(stripSubjectPrefix('Re: Re: Fwd: Hello'), 'Hello');
  assert.equal(stripSubjectPrefix('FW:    Production down'), 'Production down');
  assert.equal(stripSubjectPrefix('Odp: Odp.: re: chyba'), 'chyba');
  assert.equal(stripSubjectPrefix('Bez prefixu'), 'Bez prefixu');
});

test('tokenize lowercases, splits, drops short and numeric', () => {
  const tokens = tokenize('Dobrý deň, problém s eshopom 12345 ABC.');
  assert.deepEqual(tokens, ['dobrý', 'deň', 'problém', 'eshopom', 'abc']);
});

test('tokenize keeps slovak diacritics intact', () => {
  assert.deepEqual(tokenize('žltý kôň ľúbi'), ['žltý', 'kôň', 'ľúbi']);
});

test('loadStopwords reads JSON list and returns a Set', async () => {
  const set = await loadStopwords(path.resolve('data/stopwords-sk.json'));
  assert.ok(set instanceof Set);
  assert.ok(set.has('a'));
  assert.ok(set.has('re'));
  assert.ok(!set.has('eshop'));
});
```

- [ ] **Step 3: Run, verify fail**

Run: `npm test`
Expected: FAIL — exports not found.

- [ ] **Step 4: Extend `server/text-utils.js`**

Append:
```js
import fs from 'node:fs/promises';

const PREFIX_RE = /^(?:\s*(?:re|fwd?|odp\.?|fw)[:\s.]+)+/i;

export function stripSubjectPrefix(subject) {
  if (!subject) return '';
  let prev;
  let s = String(subject);
  do {
    prev = s;
    s = s.replace(PREFIX_RE, '').trim();
  } while (s !== prev);
  return s;
}

export function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && t.length <= 30 && !/^\d+$/.test(t));
}

export async function loadStopwords(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return new Set(JSON.parse(raw).map(s => s.toLowerCase()));
}
```

- [ ] **Step 5: Run, verify pass**

Run: `npm test`
Expected: PASS (8 tests total).

- [ ] **Step 6: Commit**

```bash
git add server/text-utils.js server/text-utils.test.js data/stopwords-sk.json
git commit -m "feat(text-utils): subject prefix strip, tokenize, stopwords loader"
```

---

## Phase 2 — LiveAgent API client

The client owns: auth header, retry/backoff, paging. **Do not** import this module from tests directly — tests should inject a fake `fetch`.

### Task 2.1: laFetch with retry and backoff

**Files:**
- Create: `server/la-client.js`
- Create: `server/la-client.test.js`

- [ ] **Step 1: Write failing tests**

`server/la-client.test.js`:
```js
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
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/la-client.js` (skeleton)**

```js
export class ApiError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

const defaultSleep = (ms) => new Promise(r => setTimeout(r, ms));

export function createClient({ baseUrl, apiKey, fetch = globalThis.fetch, sleep = defaultSleep, throttleMs = 200 }) {
  if (!baseUrl) throw new Error('baseUrl required');
  if (!apiKey) throw new Error('apiKey required');

  let lastCall = 0;

  async function laFetch(pathOrUrl, { query, method = 'GET' } = {}) {
    const url = pathOrUrl.startsWith('http') ? new URL(pathOrUrl) : new URL(baseUrl.replace(/\/$/, '') + pathOrUrl);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.append(k, v);

    const delays = [1000, 2000, 4000, 8000];
    let attempt = 0;
    while (true) {
      const wait = throttleMs - (Date.now() - lastCall);
      if (wait > 0) await sleep(wait);
      lastCall = Date.now();
      const res = await fetch(url.toString(), { method, headers: { apikey: apiKey, accept: 'application/json' } });
      if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
        if (attempt >= delays.length) {
          const body = await safeJson(res);
          throw new ApiError(`HTTP ${res.status} after retries: ${body?.message ?? ''}`.trim(), res.status, body);
        }
        await sleep(delays[attempt++]);
        continue;
      }
      const body = await safeJson(res);
      if (!res.ok) throw new ApiError(`HTTP ${res.status}: ${body?.message ?? res.statusText}`.trim(), res.status, body);
      return body;
    }
  }

  async function safeJson(res) {
    try { return await res.json(); } catch { return null; }
  }

  return { laFetch };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS (12 tests total).

- [ ] **Step 5: Commit**

```bash
git add server/la-client.js server/la-client.test.js
git commit -m "feat(la-client): laFetch with apikey auth, throttle, retry on 429/5xx"
```

### Task 2.2: Paginated listings — listTickets, listAgents, listTags

**Files:**
- Modify: `server/la-client.js`
- Modify: `server/la-client.test.js`

- [ ] **Step 1: Add failing tests**

Append to `server/la-client.test.js`:
```js
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
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: FAIL — listTickets/listAgents/listTags undefined.

- [ ] **Step 3: Extend `server/la-client.js`**

Inside the returned object from `createClient`, add these methods:
```js
async function listAgents() {
  return laFetch('/agents', { query: { _perPage: 100 } });
}
async function listTags() {
  return laFetch('/tags');
}
async function* listTickets({ from, to, signal }) {
  let page = 1;
  while (true) {
    if (signal?.aborted) return;
    const filters = [['date_created', 'D>=', from]];
    if (to) filters.push(['date_created', 'D<=', to]);
    const items = await laFetch('/tickets', {
      query: {
        _perPage: 100,
        _page: page,
        _sortField: 'date_created',
        _sortDir: 'ASC',
        _filters: JSON.stringify(filters),
      }
    });
    if (!Array.isArray(items) || items.length === 0) return;
    for (const t of items) yield t;
    if (items.length < 100) return;
    page += 1;
  }
}
return { laFetch, listAgents, listTags, listTickets };
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS (17 tests total).

- [ ] **Step 5: Commit**

```bash
git add server/la-client.js server/la-client.test.js
git commit -m "feat(la-client): paginated listTickets, listAgents, listTags"
```

### Task 2.3: getTicketMessages + first customer message extraction

**Files:**
- Modify: `server/la-client.js`
- Modify: `server/la-client.test.js`

- [ ] **Step 1: Add failing tests**

Append:
```js
import { firstCustomerMessage } from './la-client.js';

test('firstCustomerMessage skips system00 and agent groups', () => {
  const groups = [
    { userid: 'system00', messages: [{ type: 'M', message: 'auto reply' }] },
    { userid: 'agent_a', messages: [{ type: 'M', message: 'hi from agent' }] },
    { userid: 'cust_x',  messages: [{ type: 'H', format: 'T', message: 'Subject: foo' }, { type: 'M', format: 'H', message: '<p>Hello</p>' }] },
  ];
  const msg = firstCustomerMessage(groups, new Set(['agent_a']));
  assert.equal(msg.raw_html, '<p>Hello</p>');
  assert.equal(msg.plain_text, 'Hello');
});

test('firstCustomerMessage returns null when no customer group exists', () => {
  const groups = [{ userid: 'system00', messages: [{ type: 'M', message: 'x' }] }];
  assert.equal(firstCustomerMessage(groups, new Set()), null);
});

test('firstCustomerMessage returns null when group has no body message', () => {
  const groups = [{ userid: 'cust', messages: [{ type: 'H', message: 'Subject: x' }] }];
  assert.equal(firstCustomerMessage(groups, new Set()), null);
});

test('getTicketMessages calls /tickets/{id}/messages', async () => {
  let captured;
  const client = createClient({ baseUrl: 'https://x/api/v3', apiKey: 'K',
    fetch: async (url) => { captured = url; return jsonRes([]); }, sleep: async () => {} });
  await client.getTicketMessages('abc123');
  assert.match(captured, /\/tickets\/abc123\/messages$/);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: FAIL — `firstCustomerMessage` undefined.

- [ ] **Step 3: Extend `server/la-client.js`**

Add at top, alongside other exports:
```js
import { stripHtml } from './text-utils.js';

export function firstCustomerMessage(groups, agentIds) {
  if (!Array.isArray(groups)) return null;
  for (const g of groups) {
    if (!g?.userid) continue;
    if (g.userid === 'system00') continue;
    if (agentIds.has(g.userid)) continue;
    const body = (g.messages ?? []).find(m => m.type === 'M');
    if (!body) continue;
    return { raw_html: body.message ?? '', plain_text: stripHtml(body.message ?? '') };
  }
  return null;
}
```

Inside `createClient` add a method:
```js
async function getTicketMessages(ticketId) {
  return laFetch(`/tickets/${encodeURIComponent(ticketId)}/messages`);
}
return { laFetch, listAgents, listTags, listTickets, getTicketMessages };
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS (21 tests total).

- [ ] **Step 5: Commit**

```bash
git add server/la-client.js server/la-client.test.js
git commit -m "feat(la-client): getTicketMessages and firstCustomerMessage extractor"
```

---

## Phase 3 — Storage layer

### Task 3.1: JSON cache with latest pointer

**Files:**
- Create: `server/storage.js`
- Create: `server/storage.test.js`

- [ ] **Step 1: Write failing tests**

`server/storage.test.js`:
```js
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
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: FAIL — `createStorage` not found.

- [ ] **Step 3: Implement `server/storage.js`**

```js
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
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS (26 tests total).

- [ ] **Step 5: Commit**

```bash
git add server/storage.js server/storage.test.js
git commit -m "feat(storage): JSON cache with latest pointer and freshness check"
```

---

## Phase 4 — Download orchestration

### Task 4.1: enrichTicket — combine listing data + classification + first message

**Files:**
- Create: `server/enricher.js`
- Create: `server/enricher.test.js`

- [ ] **Step 1: Write failing tests**

`server/enricher.test.js`:
```js
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
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/enricher.js`**

```js
export const CLASSIFICATION_TAG_NAMES = {
  '0 - Zákaznícka podpora': 'ZP',
  '0 - Technická podpora': 'TP',
  '0 - BUG/Incident': 'BUG',
  '0 - URGENT BUG': 'URGENT_BUG',
};

const PRIORITY = ['URGENT_BUG', 'BUG', 'TP', 'ZP'];

export function classificationOf(tagIds, tagIdToName) {
  let best = null;
  let bestRank = Infinity;
  for (const tid of tagIds ?? []) {
    const name = tagIdToName[tid];
    const cls = name ? CLASSIFICATION_TAG_NAMES[name] : null;
    if (!cls) continue;
    const rank = PRIORITY.indexOf(cls);
    if (rank < bestRank) { best = cls; bestRank = rank; }
  }
  return best;
}

function domainOf(email) {
  if (!email || typeof email !== 'string') return '';
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
}

export function enrichTicket(listing, firstMessage, tagIdToName) {
  const tagIds = listing.tags ?? [];
  const tagNames = tagIds.map(t => tagIdToName[t]).filter(Boolean);
  return {
    id: listing.id,
    code: listing.code ?? '',
    subject: listing.subject ?? '',
    date_created: listing.date_created ?? '',
    status: listing.status ?? '',
    channel_type: listing.channel_type ?? '',
    owner: {
      email: listing.owner_email ?? '',
      name: listing.owner_name ?? '',
      domain: domainOf(listing.owner_email),
    },
    agentid: listing.agentid ?? '',
    tag_ids: tagIds,
    tag_names: tagNames,
    classification: classificationOf(tagIds, tagIdToName),
    first_customer_message: firstMessage ?? null,
  };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS (30 tests total).

- [ ] **Step 5: Commit**

```bash
git add server/enricher.js server/enricher.test.js
git commit -m "feat(enricher): map ticket listing + first message into enriched form"
```

### Task 4.2: downloadAll orchestration

**Files:**
- Create: `server/download.js`
- Create: `server/download.test.js`

- [ ] **Step 1: Write failing tests**

`server/download.test.js`:
```js
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
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: FAIL — `downloadAll` not found.

- [ ] **Step 3: Implement `server/download.js`**

```js
import { firstCustomerMessage } from './la-client.js';
import { enrichTicket } from './enricher.js';

export async function downloadAll({ client, from, to, maxTickets = 5000, knownIds = new Set(), signal, onProgress = () => {} }) {
  onProgress({ phase: 'meta', step: 'agents+tags' });
  const [agents, tags] = await Promise.all([client.listAgents(), client.listTags()]);
  const agentIds = new Set(agents.map(a => a.id));
  const tagIdToName = Object.fromEntries(tags.map(t => [t.id, t.name]));

  const collected = [];
  let cancelled = false;
  for await (const t of client.listTickets({ from, to, signal })) {
    if (signal?.aborted) { cancelled = true; break; }
    if (knownIds.has(t.id)) continue;
    if (collected.length >= maxTickets) break;
    collected.push(t);
    onProgress({ phase: 'tickets', count: collected.length });
  }

  const enriched = [];
  for (let i = 0; i < collected.length; i++) {
    if (signal?.aborted) { cancelled = true; break; }
    const t = collected[i];
    let msg = null;
    try {
      const groups = await client.getTicketMessages(t.id);
      msg = firstCustomerMessage(groups, agentIds);
    } catch { msg = null; }
    enriched.push(enrichTicket(t, msg, tagIdToName));
    onProgress({ phase: 'messages', done: i + 1, total: collected.length });
  }

  return {
    tickets: enriched,
    meta: {
      range: { from, to: to ?? null },
      count: enriched.length,
      tag_id_to_name: tagIdToName,
      agent_ids: [...agentIds],
    },
    cancelled,
  };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS (34 tests total).

- [ ] **Step 5: Commit**

```bash
git add server/download.js server/download.test.js
git commit -m "feat(download): orchestrated ticket+messages download with dedup, cancel, progress"
```

---

## Phase 5 — Analyzer

### Task 5.1: Distribution stats — overview + customers + domains

**Files:**
- Create: `server/analyzer.js`
- Create: `server/analyzer.test.js`

- [ ] **Step 1: Write failing tests**

`server/analyzer.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { distributionStats, weeklyTrend, topCustomers, topDomains } from './analyzer.js';

const TICKETS = [
  { id: '1', classification: 'ZP', date_created: '2026-04-01 10:00:00', owner: { email: 'a@x.sk', name: 'A', domain: 'x.sk' } },
  { id: '2', classification: 'ZP', date_created: '2026-04-08 10:00:00', owner: { email: 'b@x.sk', name: 'B', domain: 'x.sk' } },
  { id: '3', classification: 'BUG', date_created: '2026-04-08 10:00:00', owner: { email: 'a@x.sk', name: 'A', domain: 'x.sk' } },
  { id: '4', classification: null,  date_created: '2026-04-10 10:00:00', owner: { email: 'c@y.sk', name: 'C', domain: 'y.sk' } },
];

test('distributionStats counts per class and unclassified', () => {
  const d = distributionStats(TICKETS);
  assert.equal(d.total, 4);
  assert.equal(d.unclassified, 1);
  assert.equal(d.by_class.ZP, 2);
  assert.equal(d.by_class.BUG, 1);
  assert.equal(d.by_class.TP, 0);
});

test('weeklyTrend buckets by ISO week', () => {
  const t = weeklyTrend(TICKETS);
  assert.ok(t.length >= 1);
  const total = t.reduce((s, w) => s + w.total, 0);
  assert.equal(total, 4);
});

test('topCustomers groups by email and computes class shares', () => {
  const c = topCustomers(TICKETS, 5);
  const a = c.find(x => x.email === 'a@x.sk');
  assert.equal(a.total, 2);
  assert.equal(a.by_class.ZP, 1);
  assert.equal(a.by_class.BUG, 1);
});

test('topDomains groups by domain', () => {
  const d = topDomains(TICKETS, 5);
  const x = d.find(x => x.domain === 'x.sk');
  assert.equal(x.total, 3);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement skeleton in `server/analyzer.js`**

```js
const CLASSES = ['ZP', 'TP', 'BUG', 'URGENT_BUG'];

function emptyByClass() {
  return Object.fromEntries(CLASSES.map(c => [c, 0]));
}

export function distributionStats(tickets) {
  const by_class = emptyByClass();
  let unclassified = 0;
  for (const t of tickets) {
    if (t.classification && by_class[t.classification] !== undefined) by_class[t.classification]++;
    else unclassified++;
  }
  return { total: tickets.length, unclassified, by_class };
}

function isoWeekKey(date) {
  const d = new Date(date.getTime());
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function weeklyTrend(tickets) {
  const buckets = new Map();
  for (const t of tickets) {
    const dt = new Date(t.date_created.replace(' ', 'T') + 'Z');
    if (Number.isNaN(dt.getTime())) continue;
    const key = isoWeekKey(dt);
    if (!buckets.has(key)) buckets.set(key, { week: key, total: 0, by_class: emptyByClass(), unclassified: 0 });
    const b = buckets.get(key);
    b.total++;
    if (t.classification && b.by_class[t.classification] !== undefined) b.by_class[t.classification]++;
    else b.unclassified++;
  }
  return [...buckets.values()].sort((a, b) => a.week.localeCompare(b.week));
}

function topByGroup(tickets, keyFn, n) {
  const groups = new Map();
  for (const t of tickets) {
    const k = keyFn(t);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, { total: 0, by_class: emptyByClass(), unclassified: 0, sample_name: '' });
    const g = groups.get(k);
    g.total++;
    g.sample_name = t.owner?.name || g.sample_name;
    if (t.classification && g.by_class[t.classification] !== undefined) g.by_class[t.classification]++;
    else g.unclassified++;
  }
  return [...groups.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, n);
}

export function topCustomers(tickets, n = 20) {
  return topByGroup(tickets, t => t.owner?.email, n).map(g => ({ email: g.key, name: g.sample_name, total: g.total, by_class: g.by_class, unclassified: g.unclassified }));
}

export function topDomains(tickets, n = 20) {
  return topByGroup(tickets, t => t.owner?.domain, n).map(g => ({ domain: g.key, total: g.total, by_class: g.by_class, unclassified: g.unclassified }));
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS (38 tests total).

- [ ] **Step 5: Commit**

```bash
git add server/analyzer.js server/analyzer.test.js
git commit -m "feat(analyzer): distribution, weekly trend, top customers and domains"
```

### Task 5.2: Keyword extraction with G² differential score

**Files:**
- Modify: `server/analyzer.js`
- Modify: `server/analyzer.test.js`

- [ ] **Step 1: Add failing tests**

Append to `server/analyzer.test.js`:
```js
import { keywordStats, gSquared } from './analyzer.js';
import { stripSubjectPrefix, tokenize } from './text-utils.js';

test('gSquared higher when word strongly associated with one class', () => {
  // word appears 9/10 in class, 1/100 in rest
  const score = gSquared(9, 10, 1, 100);
  // score should be substantially positive
  assert.ok(score > 10, `expected high G2, got ${score}`);
});

test('gSquared near zero when word is uniform across classes', () => {
  const score = gSquared(5, 100, 5, 100);
  assert.ok(Math.abs(score) < 0.5, `expected ~0, got ${score}`);
});

test('keywordStats returns top differential words per class', () => {
  const tickets = [
    { classification: 'BUG', subject: 'nefunguje admin nefunguje', first_customer_message: { plain_text: 'nefunguje admin' } },
    { classification: 'BUG', subject: 'chyba nefunguje', first_customer_message: { plain_text: 'chyba' } },
    { classification: 'ZP',  subject: 'ako nastavit',   first_customer_message: { plain_text: 'ako nastavit' } },
    { classification: 'ZP',  subject: 'ako pouzivat',   first_customer_message: { plain_text: 'ako pouzivat' } },
    { classification: 'TP',  subject: 'uprava designu', first_customer_message: { plain_text: 'uprava designu' } },
  ];
  const stopwords = new Set();
  const out = keywordStats(tickets, { stopwords, topN: 5 });
  assert.ok(out.BUG.subject.length >= 1);
  assert.equal(out.BUG.subject[0].word, 'nefunguje');
  // ZP top should not be 'nefunguje'
  assert.ok(!out.ZP.subject.find(w => w.word === 'nefunguje'));
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: FAIL — exports not found.

- [ ] **Step 3: Extend `server/analyzer.js`**

```js
import { stripSubjectPrefix, tokenize } from './text-utils.js';

// G² (Dunning's log-likelihood) for 2x2 contingency table
// a = word in class, b = words in class total, c = word in rest, d = words in rest total
export function gSquared(a, b, c, d) {
  const total = b + d;
  if (total === 0 || (a + c) === 0) return 0;
  const eA = b * (a + c) / total;
  const eC = d * (a + c) / total;
  const term = (n, e) => (n === 0 || e === 0) ? 0 : 2 * n * Math.log(n / e);
  // include not-word counts too for proper G² on 2x2
  const notA = b - a, notC = d - c;
  const eNotA = b * (notA + notC) / total;
  const eNotC = d * (notA + notC) / total;
  return term(a, eA) + term(c, eC) + term(notA, eNotA) + term(notC, eNotC);
}

const CLASSES_FOR_KW = ['ZP', 'TP', 'BUG', 'URGENT_BUG'];

function buildCounts(tickets, fieldFn, stopwords) {
  // returns: { perClass: { cls: Map(word -> count) }, totalsPerClass: { cls: number }, allCounts: Map(word->count), grandTotal: number }
  const perClass = Object.fromEntries(CLASSES_FOR_KW.map(c => [c, new Map()]));
  const totalsPerClass = Object.fromEntries(CLASSES_FOR_KW.map(c => [c, 0]));
  for (const t of tickets) {
    if (!t.classification || !perClass[t.classification]) continue;
    const tokens = tokenize(fieldFn(t)).filter(w => !stopwords.has(w));
    totalsPerClass[t.classification] += tokens.length;
    const m = perClass[t.classification];
    for (const w of tokens) m.set(w, (m.get(w) ?? 0) + 1);
  }
  return { perClass, totalsPerClass };
}

function topDifferential(perClass, totalsPerClass, cls, topN) {
  const m = perClass[cls];
  const inClass = totalsPerClass[cls];
  let inRest = 0;
  const restCounts = new Map();
  for (const c of CLASSES_FOR_KW) if (c !== cls) {
    inRest += totalsPerClass[c];
    for (const [w, n] of perClass[c]) restCounts.set(w, (restCounts.get(w) ?? 0) + n);
  }
  const out = [];
  for (const [word, a] of m) {
    if (a < 2) continue; // floor: ignore one-offs
    const c = restCounts.get(word) ?? 0;
    const g2 = gSquared(a, inClass, c, inRest);
    if (g2 < 3.84) continue; // ~95% chi-square 1-DOF
    out.push({ word, count_in_class: a, count_in_rest: c, g2 });
  }
  return out.sort((x, y) => y.g2 - x.g2).slice(0, topN);
}

export function keywordStats(tickets, { stopwords, topN = 30 } = {}) {
  const sw = stopwords ?? new Set();
  const subjectCounts = buildCounts(tickets, t => stripSubjectPrefix(t.subject || ''), sw);
  const bodyCounts = buildCounts(tickets, t => t.first_customer_message?.plain_text || '', sw);
  const out = {};
  for (const cls of CLASSES_FOR_KW) {
    out[cls] = {
      subject: topDifferential(subjectCounts.perClass, subjectCounts.totalsPerClass, cls, topN),
      body: topDifferential(bodyCounts.perClass, bodyCounts.totalsPerClass, cls, topN),
    };
  }
  return out;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS (40 tests total).

- [ ] **Step 5: Commit**

```bash
git add server/analyzer.js server/analyzer.test.js
git commit -m "feat(analyzer): G² differential keyword extraction per class"
```

---

## Phase 6 — Rule generator

### Task 6.1: Keyword rules with confidence + coverage

**Files:**
- Create: `server/rule-generator.js`
- Create: `server/rule-generator.test.js`

- [ ] **Step 1: Write failing tests**

`server/rule-generator.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeywordRules, scoreRule } from './rule-generator.js';

const TICKETS = [
  { id: 't1', classification: 'BUG', subject: 'nefunguje admin', first_customer_message: { plain_text: 'nefunguje' } },
  { id: 't2', classification: 'BUG', subject: 'admin nefunguje', first_customer_message: { plain_text: '' } },
  { id: 't3', classification: 'BUG', subject: 'chyba',           first_customer_message: { plain_text: '' } },
  { id: 't4', classification: 'TP',  subject: 'nefunguje export', first_customer_message: { plain_text: '' } },
  { id: 't5', classification: 'ZP',  subject: 'ako nastavit',     first_customer_message: { plain_text: '' } },
  { id: 't6', classification: 'ZP',  subject: 'ako pouzivat',     first_customer_message: { plain_text: '' } },
  { id: 't7', classification: 'ZP',  subject: 'cena licencie',    first_customer_message: { plain_text: '' } },
  { id: 't8', classification: 'TP',  subject: 'uprava designu',   first_customer_message: { plain_text: '' } },
  { id: 't9', classification: 'TP',  subject: 'novy modul',       first_customer_message: { plain_text: '' } },
  { id: 't10', classification: null, subject: 'spam',             first_customer_message: { plain_text: '' } },
];

test('scoreRule returns matches, confidence, coverage on subject contains', () => {
  const rule = { type: 'keyword_subject', condition: { field: 'subject', operator: 'contains', value: 'nefunguje' }, action: { classification: 'BUG' } };
  const s = scoreRule(rule, TICKETS);
  assert.equal(s.matches_total, 3);
  assert.equal(s.true_positives, 2);
  assert.equal(s.false_positives, 1);
  // confidence = 2/3
  assert.ok(Math.abs(s.confidence_percent - 66.67) < 0.5);
  // coverage = 3/10
  assert.equal(s.coverage_percent, 30);
});

test('generateKeywordRules emits rules above thresholds, sorted by coverage', () => {
  const stopwords = new Set();
  const rules = generateKeywordRules(TICKETS, { stopwords, minConfidence: 60, minSubjectCoverage: 10 });
  // expect a rule about 'ako' for ZP (matches t5, t6)
  const ako = rules.find(r => r.condition.value === 'ako' && r.action.classification === 'ZP');
  assert.ok(ako, 'expected ZP rule for "ako"');
  assert.ok(ako.stats.confidence_percent >= 60);
  // result is sorted by coverage desc
  for (let i = 1; i < rules.length; i++) {
    assert.ok(rules[i - 1].stats.coverage_percent >= rules[i].stats.coverage_percent);
  }
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/rule-generator.js`**

```js
import { stripSubjectPrefix, tokenize } from './text-utils.js';
import { keywordStats } from './analyzer.js';

const CLASSES = ['ZP', 'TP', 'BUG', 'URGENT_BUG'];

const TAG_FOR_CLASS = {
  ZP: '0 - Zákaznícka podpora',
  TP: '0 - Technická podpora',
  BUG: '0 - BUG/Incident',
  URGENT_BUG: '0 - URGENT BUG',
};

function fieldText(ticket, field) {
  if (field === 'subject') return stripSubjectPrefix(ticket.subject || '').toLowerCase();
  if (field === 'body') return (ticket.first_customer_message?.plain_text || '').toLowerCase();
  if (field === 'sender_email') return (ticket.owner?.email || '').toLowerCase();
  if (field === 'sender_domain') return (ticket.owner?.domain || '').toLowerCase();
  return '';
}

function ruleMatches(rule, ticket) {
  const text = fieldText(ticket, rule.condition.field);
  const v = String(rule.condition.value).toLowerCase();
  switch (rule.condition.operator) {
    case 'contains':
      // word-boundary-ish for subject/body, substring for emails/domains
      if (rule.condition.field === 'subject' || rule.condition.field === 'body') {
        return new RegExp(`(?:^|\\W)${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\W)`, 'u').test(text);
      }
      return text.includes(v);
    case 'equals':
      return text === v;
    default: return false;
  }
}

export function scoreRule(rule, tickets) {
  let matches_total = 0, true_positives = 0;
  const matched_examples = [];
  const false_positive_examples = [];
  for (const t of tickets) {
    if (!ruleMatches(rule, t)) continue;
    matches_total++;
    if (t.classification === rule.action.classification) {
      true_positives++;
      if (matched_examples.length < 5) matched_examples.push({ ticket_id: t.id, subject: t.subject, actual_classification: t.classification });
    } else if (t.classification) {
      if (false_positive_examples.length < 5) false_positive_examples.push({ ticket_id: t.id, subject: t.subject, actual_classification: t.classification });
    }
  }
  const false_positives = matches_total - true_positives;
  const confidence_percent = matches_total === 0 ? 0 : Math.round((true_positives / matches_total) * 10000) / 100;
  const coverage_percent = tickets.length === 0 ? 0 : Math.round((matches_total / tickets.length) * 10000) / 100;
  return { matches_total, true_positives, false_positives, confidence_percent, coverage_percent, examples: matched_examples, false_positive_examples };
}

let _rid = 0;
function nextId() { _rid += 1; return `rule_${String(_rid).padStart(3, '0')}`; }

function makeRule(type, field, value, cls) {
  return {
    id: nextId(),
    type,
    human_readable: `Ak ${field === 'subject' ? 'subject' : field === 'body' ? 'obsah' : field === 'sender_domain' ? 'doména odosielateľa' : 'email odosielateľa'} ${field === 'sender_email' || field === 'sender_domain' ? 'je' : 'obsahuje'} '${value}', klasifikuj ako ${cls}`,
    condition: { field, operator: field.startsWith('sender_') ? 'equals' : 'contains', value },
    action: { classification: cls, tag_to_add: TAG_FOR_CLASS[cls] },
  };
}

function dedupBySupersetCoverage(rules) {
  // drop a rule if another rule with same class has same-or-larger match set with comparable confidence
  // implementation: O(n²) because n is small (<<1000)
  const keep = new Array(rules.length).fill(true);
  for (let i = 0; i < rules.length; i++) {
    if (!keep[i]) continue;
    for (let j = 0; j < rules.length; j++) {
      if (i === j || !keep[j]) continue;
      if (rules[i].action.classification !== rules[j].action.classification) continue;
      if (rules[j].stats.matches_total > rules[i].stats.matches_total
          && rules[j].stats.confidence_percent >= rules[i].stats.confidence_percent - 2) {
        // j is more general AND not significantly worse → keep j, drop i
        keep[i] = false;
        break;
      }
    }
  }
  return rules.filter((_, i) => keep[i]);
}

export function generateKeywordRules(tickets, { stopwords, minConfidence = 70, minSubjectCoverage = 1, minBodyCoverage = 0.5, topN = 30 } = {}) {
  const stats = keywordStats(tickets, { stopwords: stopwords ?? new Set(), topN });
  const rules = [];
  for (const cls of CLASSES) {
    for (const { word } of stats[cls].subject) {
      const r = makeRule('keyword_subject', 'subject', word, cls);
      r.stats = scoreRule(r, tickets);
      if (r.stats.confidence_percent >= minConfidence && r.stats.coverage_percent >= minSubjectCoverage) rules.push(r);
    }
    for (const { word } of stats[cls].body) {
      const r = makeRule('keyword_body', 'body', word, cls);
      r.stats = scoreRule(r, tickets);
      if (r.stats.confidence_percent >= minConfidence && r.stats.coverage_percent >= minBodyCoverage) rules.push(r);
    }
  }
  return dedupBySupersetCoverage(rules).sort((a, b) => b.stats.coverage_percent - a.stats.coverage_percent || b.stats.confidence_percent - a.stats.confidence_percent);
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS (42 tests total).

- [ ] **Step 5: Commit**

```bash
git add server/rule-generator.js server/rule-generator.test.js
git commit -m "feat(rules): keyword rules generator with G² selection and dedup"
```

### Task 6.2: Sender domain & email rules + edge cases

**Files:**
- Modify: `server/rule-generator.js`
- Modify: `server/rule-generator.test.js`

- [ ] **Step 1: Add failing tests**

Append:
```js
import { generateDomainRules, generateEmailRules, edgeCases } from './rule-generator.js';

const TICKETS_DOM = [
  ...Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, classification: 'TP', subject: '', first_customer_message: null, owner: { email: `u${i}@klient.sk`, domain: 'klient.sk' } })),
  { id: 'c10', classification: 'BUG', subject: '', first_customer_message: null, owner: { email: 'u10@klient.sk', domain: 'klient.sk' } },
  ...Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, classification: 'ZP', subject: '', first_customer_message: null, owner: { email: `r${i}@gmail.com`, domain: 'gmail.com' } })),
];

test('generateDomainRules emits domain rules above 80% in dominant class with >=10 tickets', () => {
  const rules = generateDomainRules(TICKETS_DOM, { minTickets: 10, minConfidence: 80 });
  const klient = rules.find(r => r.condition.value === 'klient.sk');
  assert.ok(klient);
  assert.equal(klient.action.classification, 'TP');
  // gmail group has only 5 tickets — should NOT produce a rule
  assert.equal(rules.find(r => r.condition.value === 'gmail.com'), undefined);
});

test('generateEmailRules emits per-email rules with >=5 tickets and >=90%', () => {
  const TICKETS_E = Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, classification: i < 6 ? 'BUG' : 'ZP', subject: '', first_customer_message: null, owner: { email: 'specific@x.sk', domain: 'x.sk' } }));
  const rules = generateEmailRules(TICKETS_E, { minTickets: 5, minConfidence: 90 });
  const r = rules.find(x => x.condition.value === 'specific@x.sk');
  assert.ok(r);
  assert.equal(r.action.classification, 'BUG');
});

test('edgeCases returns tickets that no rule matches AND tickets where rules disagree with actual class', () => {
  const tickets = [
    { id: 'a', classification: 'BUG', subject: 'nefunguje', first_customer_message: null, owner: { email: 'a@x', domain: 'x' } },
    { id: 'b', classification: 'ZP',  subject: 'rozporné',  first_customer_message: null, owner: { email: 'b@x', domain: 'x' } },
    { id: 'c', classification: 'TP',  subject: 'nic-nepasuje', first_customer_message: null, owner: { email: 'c@x', domain: 'x' } },
  ];
  const rules = [
    { id: 'r1', condition: { field: 'subject', operator: 'contains', value: 'nefunguje' }, action: { classification: 'BUG' } },
  ];
  const ec = edgeCases(tickets, rules, { sampleSize: 10 });
  assert.ok(ec.uncovered.find(t => t.id === 'b' || t.id === 'c'));
  assert.equal(ec.disagreements.length, 0); // r1 only matches 'a', which agrees
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: FAIL — exports not found.

- [ ] **Step 3: Extend `server/rule-generator.js`**

Append:
```js
function dominantClass(byClassCounts) {
  let bestCls = null, bestCount = 0;
  for (const [cls, n] of Object.entries(byClassCounts)) {
    if (n > bestCount) { bestCount = n; bestCls = cls; }
  }
  return { cls: bestCls, count: bestCount };
}

function groupBy(tickets, keyFn) {
  const map = new Map();
  for (const t of tickets) {
    const k = keyFn(t);
    if (!k || !t.classification) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  return map;
}

function classCounts(tickets) {
  const c = { ZP: 0, TP: 0, BUG: 0, URGENT_BUG: 0 };
  for (const t of tickets) if (c[t.classification] !== undefined) c[t.classification]++;
  return c;
}

export function generateDomainRules(tickets, { minTickets = 10, minConfidence = 80 } = {}) {
  const groups = groupBy(tickets, t => t.owner?.domain);
  const rules = [];
  for (const [domain, items] of groups) {
    if (items.length < minTickets) continue;
    const counts = classCounts(items);
    const { cls, count } = dominantClass(counts);
    if (!cls) continue;
    const confidence = (count / items.length) * 100;
    if (confidence < minConfidence) continue;
    const r = makeRule('sender_domain', 'sender_domain', domain, cls);
    r.stats = scoreRule(r, tickets);
    rules.push(r);
  }
  return rules;
}

export function generateEmailRules(tickets, { minTickets = 5, minConfidence = 90 } = {}) {
  const groups = groupBy(tickets, t => t.owner?.email);
  const rules = [];
  for (const [email, items] of groups) {
    if (items.length < minTickets) continue;
    const counts = classCounts(items);
    const { cls, count } = dominantClass(counts);
    if (!cls) continue;
    const confidence = (count / items.length) * 100;
    if (confidence < minConfidence) continue;
    const r = makeRule('sender_email', 'sender_email', email, cls);
    r.stats = scoreRule(r, tickets);
    rules.push(r);
  }
  return rules;
}

export function edgeCases(tickets, rules, { sampleSize = 10 } = {}) {
  const uncovered = [];
  const disagreements = [];
  for (const t of tickets) {
    let matchedRule = null;
    for (const r of rules) if (ruleMatches(r, t)) { matchedRule = r; break; }
    if (!matchedRule) {
      uncovered.push(t);
    } else if (t.classification && t.classification !== matchedRule.action.classification) {
      disagreements.push({ ticket: t, rule: matchedRule });
    }
  }
  // sample
  const sample = (arr) => arr.slice(0, sampleSize);
  return { uncovered: sample(uncovered), disagreements: sample(disagreements), uncovered_total: uncovered.length, disagreements_total: disagreements.length };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS (45 tests total).

- [ ] **Step 5: Commit**

```bash
git add server/rule-generator.js server/rule-generator.test.js
git commit -m "feat(rules): domain/email rules and edge cases extractor"
```

### Task 6.3: generateAllRules entrypoint

**Files:**
- Modify: `server/rule-generator.js`
- Modify: `server/rule-generator.test.js`

- [ ] **Step 1: Add failing test**

Append:
```js
import { generateAllRules } from './rule-generator.js';

test('generateAllRules merges keyword + domain + email rules with stable ids', () => {
  const stopwords = new Set();
  const out = generateAllRules(TICKETS, { stopwords });
  assert.ok(Array.isArray(out.rules));
  assert.ok(Array.isArray(out.edge_cases.uncovered));
  // stable ids (rule_001, rule_002, ...)
  for (let i = 0; i < out.rules.length; i++) {
    assert.match(out.rules[i].id, /^rule_\d{3}$/);
  }
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: FAIL — `generateAllRules` undefined.

- [ ] **Step 3: Add `generateAllRules`**

Append to `server/rule-generator.js`:
```js
export function generateAllRules(tickets, { stopwords = new Set() } = {}) {
  // reset id counter for deterministic ids per analysis
  _rid = 0;
  const kw = generateKeywordRules(tickets, { stopwords });
  const dom = generateDomainRules(tickets);
  const em = generateEmailRules(tickets);
  const merged = [...kw, ...dom, ...em].sort((a, b) => b.stats.coverage_percent - a.stats.coverage_percent || b.stats.confidence_percent - a.stats.confidence_percent);
  // re-id stably after sort
  merged.forEach((r, i) => { r.id = `rule_${String(i + 1).padStart(3, '0')}`; });
  const ec = edgeCases(tickets, merged);
  return { rules: merged, edge_cases: ec };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS (46 tests).

- [ ] **Step 5: Commit**

```bash
git add server/rule-generator.js server/rule-generator.test.js
git commit -m "feat(rules): generateAllRules entrypoint with stable post-sort ids"
```

---

## Phase 7 — Express routes

The HTTP API the frontend talks to. Routes are thin: parse → call module → JSON.

### Task 7.1: Setup endpoints — config save + connection test

**Files:**
- Modify: `server/app.js`
- Create: `server/app.routes.test.js`

- [ ] **Step 1: Write failing test**

`server/app.routes.test.js`:
```js
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
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: FAIL — route not found / clientFactory not supported.

- [ ] **Step 3: Modify `server/app.js` to accept `clientFactory` + add route**

Update the file:
```js
import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { createClient } from './la-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ROOT = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');

export function createApp({ clientFactory } = {}) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(PUBLIC_DIR));
  app.get('/health', (_req, res) => res.json({ ok: true }));

  const makeClient = clientFactory ?? (({ baseUrl, apiKey }) => createClient({ baseUrl, apiKey }));

  app.post('/api/test-connection', async (req, res) => {
    const { baseUrl, apiKey } = req.body ?? {};
    if (!baseUrl || !apiKey) return res.status(400).json({ ok: false, message: 'baseUrl a apiKey sú povinné' });
    try {
      const client = makeClient({ baseUrl, apiKey });
      const agents = await client.listAgents();
      res.json({ ok: true, agent_count: Array.isArray(agents) ? agents.length : 0 });
    } catch (e) {
      res.status(400).json({ ok: false, status: e.status, message: e.message });
    }
  });

  app.post('/api/save-config', async (req, res) => {
    const { baseUrl, apiKey, periodDays } = req.body ?? {};
    if (!baseUrl || !apiKey) return res.status(400).json({ ok: false, message: 'baseUrl a apiKey sú povinné' });
    const env = `LA_API_URL=${baseUrl}\nLA_API_KEY=${apiKey}\nPORT=${process.env.PORT || 3001}\nDEFAULT_PERIOD_DAYS=${periodDays || process.env.DEFAULT_PERIOD_DAYS || 180}\n`;
    await fs.writeFile(ENV_FILE, env, 'utf8');
    process.env.LA_API_URL = baseUrl;
    process.env.LA_API_KEY = apiKey;
    if (periodDays) process.env.DEFAULT_PERIOD_DAYS = String(periodDays);
    res.json({ ok: true });
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      baseUrl: process.env.LA_API_URL || '',
      hasKey: Boolean(process.env.LA_API_KEY),
      periodDays: Number(process.env.DEFAULT_PERIOD_DAYS) || 180,
    });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  const port = Number(process.env.PORT) || 3001;
  createApp().listen(port, () => console.log(`LA Analyzer on http://localhost:${port}`));
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS (48 tests).

- [ ] **Step 5: Commit**

```bash
git add server/app.js server/app.routes.test.js
git commit -m "feat(routes): /api/test-connection and /api/save-config"
```

### Task 7.2: Download endpoint with Server-Sent Events progress

**Files:**
- Modify: `server/app.js`
- Modify: `server/app.routes.test.js`

- [ ] **Step 1: Write failing test**

Append to `server/app.routes.test.js`:
```js
test('POST /api/download streams SSE events and persists cache', async () => {
  let storage;
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

function createStorageInMemory() {
  const m = { saved: null, latest: null };
  m.saveCache = async ({ tickets, meta }) => { m.saved = { tickets, meta }; return 'mem://x'; };
  m.loadLatest = async () => m.saved ? { ...m.saved, saved_at: new Date().toISOString() } : null;
  m.isFresh = async () => Boolean(m.saved);
  m.readJson = async () => null;
  m.writeJson = async () => {};
  return m;
}
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: FAIL — route not found / storageFactory not supported.

- [ ] **Step 3: Extend `server/app.js`**

Add at top:
```js
import { createStorage } from './storage.js';
import { downloadAll } from './download.js';
```

Replace `createApp` signature and add inside before `return app`:
```js
export function createApp({ clientFactory, storageFactory } = {}) {
  // ... existing code ...
  const dataDir = path.join(ROOT, 'data');
  const makeStorage = storageFactory ?? (() => createStorage(dataDir));

  app.post('/api/download', async (req, res) => {
    const { from, to, maxTickets } = req.body ?? {};
    const baseUrl = process.env.LA_API_URL;
    const apiKey = process.env.LA_API_KEY;
    if (!baseUrl || !apiKey) return res.status(400).json({ ok: false, message: 'API config missing — uložte ho cez /api/save-config' });
    if (!from) return res.status(400).json({ ok: false, message: 'from je povinné' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    const ac = new AbortController();
    req.on('close', () => ac.abort());

    try {
      const client = makeClient({ baseUrl, apiKey });
      const storage = makeStorage(dataDir);

      const existing = await storage.loadLatest();
      const knownIds = new Set((existing?.tickets ?? []).map(t => t.id));

      const result = await downloadAll({
        client, from, to, maxTickets: maxTickets || 5000, knownIds,
        signal: ac.signal,
        onProgress: ev => send('progress', ev),
      });

      // merge with existing tickets if dedup was active
      const merged = existing ? [...existing.tickets.filter(t => !result.tickets.find(x => x.id === t.id)), ...result.tickets] : result.tickets;
      const meta = { ...result.meta, count: merged.length, saved_at: new Date().toISOString() };
      await storage.saveCache({ tickets: merged, meta });

      send('done', { count: merged.length, cancelled: result.cancelled, meta });
      res.end();
    } catch (e) {
      send('error', { message: e.message, status: e.status });
      res.end();
    }
  });

  // ... return app ...
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS (49 tests).

- [ ] **Step 5: Commit**

```bash
git add server/app.js server/app.routes.test.js
git commit -m "feat(routes): /api/download with SSE progress + dedup merge"
```

### Task 7.3: Cache + tags + categorization + analysis routes

**Files:**
- Modify: `server/app.js`
- Modify: `server/app.routes.test.js`

- [ ] **Step 1: Write failing tests**

Append:
```js
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
```

(Update `createStorageInMemory` to also store `latest`:)
```js
function createStorageInMemory() {
  const m = { saved: null, files: {} };
  m.saveCache = async ({ tickets, meta }) => { m.saved = { tickets, meta }; return 'mem://x'; };
  m.loadLatest = async () => m.saved ? { ...m.saved, saved_at: new Date().toISOString() } : null;
  m.isFresh = async () => Boolean(m.saved);
  m.readJson = async (name) => m.files[name] ?? null;
  m.writeJson = async (name, data) => { m.files[name] = data; };
  return m;
}
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Add routes to `server/app.js`**

Add imports:
```js
import { distributionStats, weeklyTrend, topCustomers, topDomains, keywordStats } from './analyzer.js';
import { generateAllRules } from './rule-generator.js';
import { loadStopwords } from './text-utils.js';
```

Inside `createApp`, before `return app`:
```js
const stopwordsPath = path.join(dataDir, 'stopwords-sk.json');

app.get('/api/cache', async (_req, res) => {
  const storage = makeStorage(dataDir);
  const data = await storage.loadLatest();
  if (!data) return res.status(404).json({ ok: false, message: 'no cache' });
  res.json({ ok: true, count: data.tickets.length, meta: data.meta, saved_at: data.saved_at });
});

app.get('/api/tickets', async (_req, res) => {
  const storage = makeStorage(dataDir);
  const data = await storage.loadLatest();
  if (!data) return res.status(404).json({ ok: false, message: 'no cache' });
  res.json({ ok: true, tickets: data.tickets });
});

app.get('/api/tag-categories', async (_req, res) => {
  const storage = makeStorage(dataDir);
  const cats = await storage.readJson('tag-categories.json');
  res.json(cats ?? { version: 1, categories: {} });
});

app.post('/api/tag-categories', async (req, res) => {
  const storage = makeStorage(dataDir);
  const payload = { version: 1, updated_at: new Date().toISOString(), categories: req.body?.categories ?? {} };
  await storage.writeJson('tag-categories.json', payload);
  res.json({ ok: true });
});

app.get('/api/analysis', async (_req, res) => {
  const storage = makeStorage(dataDir);
  const data = await storage.loadLatest();
  if (!data) return res.status(404).json({ ok: false, message: 'no cache' });
  let stopwords = new Set();
  try { stopwords = await loadStopwords(stopwordsPath); } catch {}
  const tickets = data.tickets;
  const { rules, edge_cases } = generateAllRules(tickets, { stopwords });
  res.json({
    distribution: distributionStats(tickets),
    weekly_trend: weeklyTrend(tickets),
    top_customers: topCustomers(tickets, 20),
    top_domains: topDomains(tickets, 20),
    keyword_stats: keywordStats(tickets, { stopwords, topN: 30 }),
    rules,
    edge_cases,
  });
});
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS (52 tests).

- [ ] **Step 5: Commit**

```bash
git add server/app.js server/app.routes.test.js
git commit -m "feat(routes): /api/cache, /api/tickets, /api/tag-categories, /api/analysis"
```

### Task 7.4: Export endpoints (markdown / json / csv)

**Files:**
- Create: `server/exporter.js`
- Create: `server/exporter.test.js`
- Modify: `server/app.js`

- [ ] **Step 1: Write failing tests**

`server/exporter.test.js`:
```js
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
  assert.match(lines[1], /^1,C,"a, b\n""c""",/);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Implement `server/exporter.js`**

```js
function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function ticketsToCsv(tickets) {
  const header = 'id,code,subject,date_created,classification,owner_email,owner_domain,agentid';
  const rows = tickets.map(t => [
    t.id, t.code ?? '', t.subject ?? '', t.date_created ?? '', t.classification ?? '',
    t.owner?.email ?? '', t.owner?.domain ?? '', t.agentid ?? '',
  ].map(csvEscape).join(','));
  return [header, ...rows].join('\n');
}

export function rulesToMarkdown(rules) {
  const lines = [`# Navrhované LA pravidlá`, ``, `Celkom: **${rules.length}** pravidiel`, ``];
  for (const r of rules) {
    lines.push(`## ${r.id} — ${r.human_readable}`, '');
    lines.push(`- **Pole:** \`${r.condition.field}\``);
    lines.push(`- **Operátor:** \`${r.condition.operator}\``);
    lines.push(`- **Hodnota:** \`${r.condition.value}\``);
    lines.push(`- **Klasifikácia:** **${r.action.classification}**`);
    lines.push('');
    lines.push(`**Štatistiky:**`);
    lines.push(`- matches: ${r.stats.matches_total}`);
    lines.push(`- true positives: ${r.stats.true_positives}`);
    lines.push(`- false positives: ${r.stats.false_positives}`);
    lines.push(`- **confidence: ${r.stats.confidence_percent}%**`);
    lines.push(`- **coverage: ${r.stats.coverage_percent}%**`);
    if (r.examples?.length) {
      lines.push('', '**Príklady:**');
      for (const ex of r.examples.slice(0, 3)) {
        lines.push(`- \`${ex.ticket_id}\` — ${ex.subject}`);
      }
    }
    if (r.false_positive_examples?.length) {
      lines.push('', '**False positives:**');
      for (const ex of r.false_positive_examples.slice(0, 3)) {
        lines.push(`- \`${ex.ticket_id}\` — ${ex.subject} (skutočne: ${ex.actual_classification})`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run unit tests, verify pass**

Run: `npm test`
Expected: PASS (54 tests).

- [ ] **Step 5: Add export routes to `server/app.js`**

Add import:
```js
import { rulesToMarkdown, ticketsToCsv } from './exporter.js';
```

Add inside `createApp`:
```js
async function getAnalysisOrStatus(res) {
  const storage = makeStorage(dataDir);
  const data = await storage.loadLatest();
  if (!data) { res.status(404).json({ ok: false, message: 'no cache' }); return null; }
  let stopwords = new Set();
  try { stopwords = await loadStopwords(stopwordsPath); } catch {}
  return { tickets: data.tickets, ...generateAllRules(data.tickets, { stopwords }) };
}

app.get('/api/export/rules.json', async (_req, res) => {
  const a = await getAnalysisOrStatus(res); if (!a) return;
  res.setHeader('Content-Disposition', 'attachment; filename="rules.json"');
  res.json({ rules: a.rules, edge_cases: a.edge_cases });
});

app.get('/api/export/rules.md', async (_req, res) => {
  const a = await getAnalysisOrStatus(res); if (!a) return;
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="rules.md"');
  res.send(rulesToMarkdown(a.rules));
});

app.get('/api/export/tickets.csv', async (_req, res) => {
  const storage = makeStorage(dataDir);
  const data = await storage.loadLatest();
  if (!data) return res.status(404).json({ ok: false, message: 'no cache' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="tickets.csv"');
  res.send(ticketsToCsv(data.tickets));
});
```

- [ ] **Step 6: Commit**

```bash
git add server/exporter.js server/exporter.test.js server/app.js
git commit -m "feat(routes): export rules.json/rules.md/tickets.csv"
```

---

## Phase 8 — Frontend: setup screen

The frontend is one HTML file with section panels swapped via simple class toggles. No router. No framework. CSS is hand-rolled, calm and presentable for a meeting.

### Task 8.1: Page skeleton + nav + style

**Files:**
- Modify: `public/index.html`
- Create: `public/style.css`
- Create: `public/app.js`

- [ ] **Step 1: Write `public/index.html`**

```html
<!doctype html>
<html lang="sk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=1200">
  <title>LA Tickets Analyzer</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="topbar">
    <h1>LA Tickets Analyzer</h1>
    <nav>
      <button data-target="setup">Setup</button>
      <button data-target="download">Stiahnuť</button>
      <button data-target="tags">Tagy</button>
      <button data-target="dashboard">Dashboard</button>
      <button data-target="export">Export</button>
    </nav>
  </header>
  <main>
    <section id="setup" class="panel active">
      <h2>1 · Nastavenie pripojenia</h2>
      <form id="setup-form">
        <label>LA endpoint URL <input name="baseUrl" type="url" placeholder="https://creativesites.ladesk.com/api/v3" required></label>
        <label>API kľúč <input name="apiKey" type="password" autocomplete="off" required></label>
        <label>Default obdobie (dni) <input name="periodDays" type="number" min="1" max="730" value="180"></label>
        <div class="row">
          <button type="button" id="test-conn">Otestovať pripojenie</button>
          <button type="submit">Uložiť</button>
        </div>
        <p class="status" id="setup-status"></p>
      </form>
    </section>

    <section id="download" class="panel">
      <h2>2 · Sťahovanie ticketov</h2>
      <form id="download-form">
        <label>Od <input name="from" type="date" required></label>
        <label>Do <input name="to" type="date"></label>
        <label>Max ticketov <input name="maxTickets" type="number" value="5000"></label>
        <div class="row">
          <button type="submit" id="dl-start">Spustiť sťahovanie</button>
          <button type="button" id="dl-cancel" disabled>Zrušiť</button>
        </div>
      </form>
      <pre id="dl-log" class="log"></pre>
      <progress id="dl-progress" value="0" max="100" hidden></progress>
    </section>

    <section id="tags" class="panel">
      <h2>3 · Kategorizácia tagov</h2>
      <p class="hint">Označte, do akej kategórie patrí každý tag. Klasifikačné tagy (ZP/TP/BUG/URGENT BUG) sú pre-vyplnené.</p>
      <table id="tags-table"><thead><tr><th>Tag</th><th>Počet</th><th>Kategória</th></tr></thead><tbody></tbody></table>
      <button id="tags-save">Uložiť a re-analyzovať</button>
    </section>

    <section id="dashboard" class="panel">
      <h2>4 · Dashboard</h2>
      <div class="grid">
        <div id="overview" class="card"></div>
        <div id="trend" class="card"><canvas></canvas></div>
        <div id="dist" class="card"><canvas></canvas></div>
        <div id="customers" class="card"></div>
        <div id="domains" class="card"></div>
        <div id="keywords" class="card wide"></div>
        <div id="rules" class="card wide"></div>
        <div id="edges" class="card wide"></div>
      </div>
    </section>

    <section id="export" class="panel">
      <h2>5 · Export</h2>
      <p>Stiahnutia sú generované zo súčasného obsahu cache + tag categorization.</p>
      <ul class="export-links">
        <li><a href="/api/export/rules.md" download>rules.md</a> — pre meeting/Notion</li>
        <li><a href="/api/export/rules.json" download>rules.json</a> — strojovo čitateľné</li>
        <li><a href="/api/export/tickets.csv" download>tickets.csv</a> — surové dáta</li>
      </ul>
    </section>
  </main>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <script src="/app.js" type="module"></script>
</body>
</html>
```

- [ ] **Step 2: Write `public/style.css`**

```css
:root {
  --fg: #1a1a1a; --muted: #666; --bg: #fafaf7; --card: #fff;
  --line: #e3e3df; --accent: #b75200; --good: #287b3a; --warn: #af2600; --info: #1b4f8c;
  font-size: 16px;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.topbar { display: flex; align-items: center; justify-content: space-between; padding: 14px 24px; background: var(--card); border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 10; }
.topbar h1 { font-size: 18px; margin: 0; }
.topbar nav button { background: none; border: 1px solid transparent; padding: 8px 12px; cursor: pointer; border-radius: 6px; font: inherit; color: var(--muted); }
.topbar nav button.active, .topbar nav button:hover { background: var(--bg); color: var(--fg); border-color: var(--line); }
main { padding: 24px; max-width: 1280px; margin: 0 auto; }
.panel { display: none; }
.panel.active { display: block; }
h2 { font-size: 22px; margin-top: 0; }
.hint { color: var(--muted); }
form label { display: block; margin: 12px 0; }
form input { width: 100%; max-width: 480px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; font: inherit; }
.row { display: flex; gap: 12px; margin-top: 16px; }
button { padding: 10px 16px; border: 1px solid var(--line); background: var(--card); border-radius: 6px; cursor: pointer; font: inherit; }
button[type="submit"], #dl-start, #tags-save { background: var(--accent); color: #fff; border-color: var(--accent); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
.status.ok { color: var(--good); }
.status.err { color: var(--warn); }
.log { background: #1f1f1c; color: #ddd; padding: 12px; border-radius: 6px; max-height: 300px; overflow: auto; font-size: 13px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 16px; }
.card.wide { grid-column: 1 / -1; }
.card canvas { max-width: 100%; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 8px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
th { color: var(--muted); font-weight: 500; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; }
.rule { border: 1px solid var(--line); border-radius: 8px; padding: 12px; margin-bottom: 12px; background: #fff; }
.rule h4 { margin: 0 0 8px; font-size: 16px; }
.rule .stats { display: flex; gap: 16px; color: var(--muted); font-size: 14px; flex-wrap: wrap; }
.rule .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; color: #fff; }
.rule .badge.ZP { background: #811e00; } .rule .badge.TP { background: #c05500; } .rule .badge.BUG { background: #8e002d; } .rule .badge.URGENT_BUG { background: #00be90; color: #000; }
.rule details { margin-top: 8px; }
.rule details summary { cursor: pointer; color: var(--info); }
.export-links a { color: var(--accent); }
```

- [ ] **Step 3: Write `public/app.js` skeleton with nav switching**

```js
const panels = document.querySelectorAll('.panel');
const navButtons = document.querySelectorAll('.topbar nav button');
function show(id) {
  panels.forEach(p => p.classList.toggle('active', p.id === id));
  navButtons.forEach(b => b.classList.toggle('active', b.dataset.target === id));
  if (id === 'tags') loadTags();
  if (id === 'dashboard') loadDashboard();
}
navButtons.forEach(b => b.addEventListener('click', () => show(b.dataset.target)));

async function bootstrap() {
  const cfg = await fetch('/api/config').then(r => r.json()).catch(() => null);
  if (cfg?.baseUrl) document.querySelector('[name=baseUrl]').value = cfg.baseUrl;
  if (cfg?.periodDays) document.querySelector('[name=periodDays]').value = cfg.periodDays;
  show(cfg?.hasKey ? 'download' : 'setup');
}

// placeholder hooks; later tasks fill them
async function loadTags() { /* Task 10 */ }
async function loadDashboard() { /* Tasks 11-12 */ }

bootstrap();
```

- [ ] **Step 4: Smoke test in browser**

Run: `npm start`
Open: `http://localhost:3001/`
Expected: page renders with topbar nav, clicking buttons switches panels. No console errors.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/style.css public/app.js
git commit -m "feat(frontend): page skeleton with nav, panels, and stylesheet"
```

### Task 8.2: Setup form wiring (test connection + save)

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add the form handlers**

Add to `public/app.js`:
```js
const setupForm = document.getElementById('setup-form');
const setupStatus = document.getElementById('setup-status');

document.getElementById('test-conn').addEventListener('click', async () => {
  const fd = new FormData(setupForm);
  setupStatus.textContent = 'Testujem…';
  setupStatus.className = 'status';
  try {
    const res = await fetch('/api/test-connection', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseUrl: fd.get('baseUrl'), apiKey: fd.get('apiKey') }),
    });
    const body = await res.json();
    if (body.ok) {
      setupStatus.className = 'status ok';
      setupStatus.textContent = `OK — pripojenie funguje, dostupných ${body.agent_count} agentov.`;
    } else {
      setupStatus.className = 'status err';
      setupStatus.textContent = `Chyba: ${body.message}`;
    }
  } catch (e) {
    setupStatus.className = 'status err';
    setupStatus.textContent = `Sieťová chyba: ${e.message}`;
  }
});

setupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(setupForm);
  setupStatus.className = 'status';
  setupStatus.textContent = 'Ukladám…';
  const res = await fetch('/api/save-config', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseUrl: fd.get('baseUrl'), apiKey: fd.get('apiKey'), periodDays: Number(fd.get('periodDays')) }),
  });
  const body = await res.json();
  if (body.ok) { setupStatus.className = 'status ok'; setupStatus.textContent = 'Uložené. Pokračujte na "Stiahnuť".'; }
  else { setupStatus.className = 'status err'; setupStatus.textContent = `Chyba: ${body.message}`; }
});
```

- [ ] **Step 2: Smoke test in browser**

Run: `npm start` (with valid `.env`).
Open: setup tab. Click "Otestovať pripojenie" with bad key → red error from server. With good key → green message.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat(frontend): setup form — test connection and save config"
```

---

## Phase 9 — Frontend: download UI

### Task 9.1: SSE-driven download with progress + cancel

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add download wiring**

Append:
```js
const dlForm = document.getElementById('download-form');
const dlLog = document.getElementById('dl-log');
const dlStart = document.getElementById('dl-start');
const dlCancel = document.getElementById('dl-cancel');
const dlProgress = document.getElementById('dl-progress');
let dlAbort = null;

function pad(n) { return String(n).padStart(2, '0'); }
function defaultFromDate(days) {
  const d = new Date(Date.now() - days * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
}

async function setDefaultDates() {
  const cfg = await fetch('/api/config').then(r => r.json());
  document.querySelector('[name=from]').value = defaultFromDate(cfg.periodDays || 180);
}
setDefaultDates();

function logLine(msg) { dlLog.textContent += msg + '\n'; dlLog.scrollTop = dlLog.scrollHeight; }

async function streamDownload(payload) {
  dlAbort = new AbortController();
  const res = await fetch('/api/download', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload), signal: dlAbort.signal,
  });
  if (!res.ok && res.headers.get('content-type')?.includes('json')) {
    const err = await res.json(); logLine(`Chyba: ${err.message}`); return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop();
    for (const chunk of chunks) {
      const lines = chunk.split('\n');
      const event = lines.find(l => l.startsWith('event: '))?.slice(7) ?? 'message';
      const data = JSON.parse(lines.find(l => l.startsWith('data: '))?.slice(6) || '{}');
      if (event === 'progress') {
        if (data.phase === 'tickets') logLine(`tickety: ${data.count}`);
        if (data.phase === 'messages') {
          logLine(`správy: ${data.done} / ${data.total}`);
          dlProgress.hidden = false; dlProgress.max = data.total; dlProgress.value = data.done;
        }
      } else if (event === 'done') {
        logLine(`HOTOVO — celkom ${data.count} ticketov${data.cancelled ? ' (zrušené)' : ''}`);
      } else if (event === 'error') {
        logLine(`Chyba: ${data.message}`);
      }
    }
  }
}

dlForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(dlForm);
  dlLog.textContent = '';
  dlStart.disabled = true; dlCancel.disabled = false;
  try {
    await streamDownload({
      from: `${fd.get('from')} 00:00:00`,
      to: fd.get('to') ? `${fd.get('to')} 23:59:59` : null,
      maxTickets: Number(fd.get('maxTickets')) || 5000,
    });
  } catch (e) {
    if (e.name !== 'AbortError') logLine(`Chyba: ${e.message}`);
  } finally {
    dlStart.disabled = false; dlCancel.disabled = true; dlAbort = null;
  }
});
dlCancel.addEventListener('click', () => { if (dlAbort) { dlAbort.abort(); logLine('Cancelling…'); } });
```

- [ ] **Step 2: Smoke test in browser**

Run: `npm start`. Open `/`. Setup → Download → Spustiť. Watch the log fill. Click Cancel mid-flight. Verify cache file appears in `data/`.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat(frontend): SSE download with progress, log, cancel"
```

---

## Phase 10 — Frontend: tag categorization

### Task 10.1: Render tag table with classification pre-fill + save

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Implement `loadTags`**

Replace the placeholder `loadTags` with:
```js
const KNOWN_CLASSIFICATION_NAMES = new Set([
  '0 - Zákaznícka podpora', '0 - Technická podpora', '0 - BUG/Incident', '0 - URGENT BUG',
]);
const CATEGORIES = ['classification', 'client', 'topic', 'status', 'internal', 'ignored'];

async function loadTags() {
  const tbody = document.querySelector('#tags-table tbody');
  tbody.innerHTML = '<tr><td colspan="3">Načítavam…</td></tr>';
  const [cacheRes, catsRes] = await Promise.all([
    fetch('/api/cache'), fetch('/api/tag-categories'),
  ]);
  if (!cacheRes.ok) { tbody.innerHTML = '<tr><td colspan="3">Najprv stiahnite tickety.</td></tr>'; return; }
  const cache = await cacheRes.json();
  const cats = await catsRes.json();
  const ticketsRes = await fetch('/api/tickets').then(r => r.json());
  const counts = new Map();
  for (const t of ticketsRes.tickets) for (const id of t.tag_ids ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  const tagIdToName = cache.meta?.tag_id_to_name ?? {};
  const rows = [...counts.entries()]
    .map(([id, count]) => ({ id, count, name: tagIdToName[id] ?? id }))
    .sort((a, b) => b.count - a.count);
  tbody.innerHTML = rows.map(r => {
    const current = cats.categories?.[r.id] ?? (KNOWN_CLASSIFICATION_NAMES.has(r.name) ? 'classification' : 'topic');
    const opts = CATEGORIES.map(c => `<option value="${c}"${c === current ? ' selected' : ''}>${c}</option>`).join('');
    return `<tr><td>${escapeHtml(r.name)}</td><td>${r.count}</td><td><select data-id="${r.id}">${opts}</select></td></tr>`;
  }).join('');
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

document.getElementById('tags-save').addEventListener('click', async () => {
  const selects = document.querySelectorAll('#tags-table select');
  const categories = {};
  selects.forEach(s => { categories[s.dataset.id] = s.value; });
  await fetch('/api/tag-categories', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ categories }) });
  show('dashboard');
});
```

- [ ] **Step 2: Smoke test**

Open browser → Tags tab. Verify rows render with counts and dropdowns. Save → switches to Dashboard.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat(frontend): tag categorization table with persisted selections"
```

---

## Phase 11 — Frontend: dashboard (sections A–D)

### Task 11.1: Overview, distribution pie, weekly trend

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Implement `loadDashboard` first half**

Replace placeholder `loadDashboard` with:
```js
let charts = {}; // keep handles to destroy on reload

function destroyCharts() { for (const k of Object.keys(charts)) { try { charts[k].destroy(); } catch {} } charts = {}; }

const CLASS_COLORS = { ZP: '#811e00', TP: '#c05500', BUG: '#8e002d', URGENT_BUG: '#00be90' };

async function loadDashboard() {
  destroyCharts();
  const res = await fetch('/api/analysis');
  if (!res.ok) {
    document.getElementById('overview').textContent = 'Najprv stiahnite tickety.';
    return;
  }
  const a = await res.json();
  renderOverview(a);
  renderTrend(a);
  renderDistribution(a);
  renderCustomers(a);
  renderDomains(a);
  renderKeywords(a);
  renderRules(a);
  renderEdges(a);
}

function renderOverview(a) {
  const el = document.getElementById('overview');
  const d = a.distribution;
  el.innerHTML = `
    <h3>Prehľad</h3>
    <p><strong>${d.total}</strong> ticketov; <strong>${d.unclassified}</strong> bez klasifikácie (${pct(d.unclassified, d.total)}%).</p>
    <ul>
      ${['ZP','TP','BUG','URGENT_BUG'].map(c => `<li><span class="badge ${c}">${c}</span> ${d.by_class[c]} (${pct(d.by_class[c], d.total)}%)</li>`).join('')}
    </ul>`;
}
function pct(n, total) { return total === 0 ? 0 : Math.round((n / total) * 1000) / 10; }

function renderTrend(a) {
  const ctx = document.querySelector('#trend canvas');
  const labels = a.weekly_trend.map(w => w.week);
  charts.trend = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: ['ZP','TP','BUG','URGENT_BUG'].map(c => ({
        label: c, data: a.weekly_trend.map(w => w.by_class[c]), borderColor: CLASS_COLORS[c], tension: 0.3, fill: false,
      })),
    },
    options: { plugins: { title: { display: true, text: 'Tickety / týždeň' } } },
  });
}

function renderDistribution(a) {
  const ctx = document.querySelector('#dist canvas');
  const d = a.distribution;
  charts.dist = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['ZP','TP','BUG','URGENT_BUG','bez klasifikácie'],
      datasets: [{ data: ['ZP','TP','BUG','URGENT_BUG'].map(c => d.by_class[c]).concat([d.unclassified]),
        backgroundColor: ['#811e00','#c05500','#8e002d','#00be90','#cccccc'] }],
    },
    options: { plugins: { title: { display: true, text: 'Distribúcia klasifikácie' } } },
  });
}
```

- [ ] **Step 2: Smoke test**

Open dashboard. Verify overview text, doughnut chart, trend chart render with real data.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat(dashboard): overview, distribution doughnut, weekly trend line"
```

### Task 11.2: Top customers + top domains tables

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add render functions**

Append:
```js
function renderCustomers(a) {
  const el = document.getElementById('customers');
  el.innerHTML = `<h3>Top klienti (email)</h3>` + ladderTable(a.top_customers, c => c.email);
}
function renderDomains(a) {
  const el = document.getElementById('domains');
  el.innerHTML = `<h3>Top domény</h3>` + ladderTable(a.top_domains, c => c.domain);
}

function ladderTable(rows, labelFn) {
  if (!rows.length) return '<p class="hint">žiadne dáta</p>';
  const head = `<thead><tr><th>identifikátor</th><th>spolu</th><th>ZP</th><th>TP</th><th>BUG</th><th>URGENT</th><th>bez kl.</th></tr></thead>`;
  const body = rows.map(r => `<tr>
    <td>${escapeHtml(labelFn(r))}</td>
    <td>${r.total}</td>
    <td>${r.by_class.ZP}</td>
    <td>${r.by_class.TP}</td>
    <td>${r.by_class.BUG}</td>
    <td>${r.by_class.URGENT_BUG}</td>
    <td>${r.unclassified}</td></tr>`).join('');
  return `<table>${head}<tbody>${body}</tbody></table>`;
}
```

- [ ] **Step 2: Smoke test**

Verify both tables render with real data.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat(dashboard): customer and domain ladder tables"
```

### Task 11.3: Top differential keywords

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add `renderKeywords`**

Append:
```js
function renderKeywords(a) {
  const el = document.getElementById('keywords');
  const classes = ['ZP','TP','BUG','URGENT_BUG'];
  const renderList = (arr) => arr.length === 0
    ? '<p class="hint">—</p>'
    : `<ol>${arr.slice(0, 15).map(w => `<li><code>${escapeHtml(w.word)}</code> <span class="hint">G²=${w.g2.toFixed(1)}, in-class=${w.count_in_class}, rest=${w.count_in_rest}</span></li>`).join('')}</ol>`;
  el.innerHTML = `<h3>Top diferenciálne slová (G² log-likelihood)</h3>` +
    `<div class="grid">${classes.map(c => `
      <div>
        <h4><span class="badge ${c}">${c}</span></h4>
        <h5>v subjekte</h5>${renderList(a.keyword_stats[c].subject)}
        <h5>v správe</h5>${renderList(a.keyword_stats[c].body)}
      </div>`).join('')}</div>`;
}
```

- [ ] **Step 2: Smoke test**

Open dashboard. Verify keyword section renders 4 sub-blocks (one per class).

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat(dashboard): top differential keywords per class"
```

---

## Phase 12 — Frontend: rules and edge cases

### Task 12.1: Render candidate rules with stats and false positives

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add `renderRules`**

Append:
```js
function renderRules(a) {
  const el = document.getElementById('rules');
  if (!a.rules.length) { el.innerHTML = '<h3>Navrhované pravidlá</h3><p class="hint">Žiadne pravidlá nedosiahli prahy.</p>'; return; }
  const cards = a.rules.map(r => `
    <article class="rule">
      <h4>${escapeHtml(r.id)} · <span class="badge ${r.action.classification}">${r.action.classification}</span> ${escapeHtml(r.human_readable)}</h4>
      <div class="stats">
        <span><strong>coverage:</strong> ${r.stats.coverage_percent}%</span>
        <span><strong>confidence:</strong> ${r.stats.confidence_percent}%</span>
        <span>matches: ${r.stats.matches_total}</span>
        <span>TP: ${r.stats.true_positives}</span>
        <span>FP: ${r.stats.false_positives}</span>
      </div>
      ${r.examples?.length ? `<details><summary>Príklady (${r.examples.length})</summary><ul>${r.examples.map(ex => `<li><code>${escapeHtml(ex.ticket_id)}</code> — ${escapeHtml(ex.subject)}</li>`).join('')}</ul></details>` : ''}
      ${r.false_positive_examples?.length ? `<details><summary>False positives (${r.false_positive_examples.length})</summary><ul>${r.false_positive_examples.map(ex => `<li><code>${escapeHtml(ex.ticket_id)}</code> — ${escapeHtml(ex.subject)} <em>(${ex.actual_classification})</em></li>`).join('')}</ul></details>` : ''}
    </article>`).join('');
  el.innerHTML = `<h3>Navrhované pravidlá (${a.rules.length})</h3>${cards}`;
}
```

- [ ] **Step 2: Smoke test**

Verify rules section renders with cards showing stats and expandable examples / FPs.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat(dashboard): rule cards with confidence/coverage and FP samples"
```

### Task 12.2: Edge cases section

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add `renderEdges`**

Append:
```js
function renderEdges(a) {
  const el = document.getElementById('edges');
  const ec = a.edge_cases;
  el.innerHTML = `
    <h3>Edge cases</h3>
    <p class="hint">Tickety, ktoré nepokrylo žiadne high-confidence pravidlo, alebo kde pravidlo nesúhlasí so skutočnou klasifikáciou.</p>
    <h4>Bez pravidla (vzorka ${ec.uncovered.length} z ${ec.uncovered_total})</h4>
    <ul>${ec.uncovered.map(t => `<li><code>${escapeHtml(t.id)}</code> — ${escapeHtml(t.subject || '(bez subjectu)')} <em>(skut.: ${t.classification ?? 'bez kl.'})</em></li>`).join('')}</ul>
    <h4>Rozpor (vzorka ${ec.disagreements.length} z ${ec.disagreements_total})</h4>
    <ul>${ec.disagreements.map(d => `<li><code>${escapeHtml(d.ticket.id)}</code> — ${escapeHtml(d.ticket.subject || '')} — pravidlo: <code>${escapeHtml(d.rule.id)}</code> hovorí <strong>${d.rule.action.classification}</strong>, skutočne: <strong>${d.ticket.classification}</strong></li>`).join('')}</ul>`;
}
```

- [ ] **Step 2: Smoke test**

Verify edge cases section renders.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat(dashboard): edge cases (uncovered + disagreements)"
```

---

## Phase 13 — Final polish & docs

### Task 13.1: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# LA Tickets Analyzer

Lokálna webová aplikácia na analýzu LiveAgent ticketov. Stiahne historické tickety, identifikuje patterny v klasifikácii (ZP / TP / BUG / URGENT BUG) a navrhne deterministické pravidlá pre LA Rules engine.

## Setup

1. `npm install`
2. Skopíruj `.env.example` na `.env` a doplň `LA_API_KEY` (Configuration → API → API keys v LA admine).
3. `npm start`
4. Otvor `http://localhost:3001/`.

## Použitie

1. **Setup** — overí pripojenie cez `GET /agents`.
2. **Stiahnuť** — vyber dátum od/do a kliknite Spustiť. Sťahovanie ide cez SSE s progresom.
3. **Tagy** — kategorizuj všetky tagy, ktoré sa v dátach objavili. Klasifikačné tagy ZP/TP/BUG/URGENT BUG sú pre-vyplnené.
4. **Dashboard** — sekcie A–F: overview, trend, top kľúčové slová s G² skóre, distribúcie podľa klientov a domén, navrhované pravidlá, edge cases.
5. **Export** — `rules.md`, `rules.json`, `tickets.csv`.

## Použité LA endpointy

| Endpoint | Účel |
|---|---|
| `GET /agents` | overenie pripojenia + zoznam agentov pre detekciu first customer message |
| `GET /tags` | mapovanie tag IDs na názvy |
| `GET /tickets` (paginovane, `_filters`) | listing ticketov v období |
| `GET /tickets/{id}/messages` | extrakcia prvej správy od klienta |

### LA API kvirky

- Endpoint je `/tickets`, **nie** `/conversations`.
- `_filters` syntax je **array of arrays**: `_filters=[["date_created","D>=","YYYY-MM-DD HH:MM:SS"]]`.
- Date operátory majú prefix `D` (`D>=`, `D<=`, atď.), nie `>=`.
- API nevrátia total count — paging končí pri prázdnej odpovedi.
- Tagy v ticketu sú **IDs**, nie názvy.
- System auto-replies majú `userid: "system00"`.

## Troubleshooting

- **HTTP 404 na `/agents/me`** — niektoré LA inštalácie tento endpoint nemajú; používame `/agents`.
- **HTTP 401** — neplatný `LA_API_KEY`.
- **HTTP 403 na `/tags`** — neudať `_perPage`, raz sa to stalo. Bez query parametra to ide.
- **HTTP 429** — klient implementuje retry (1s, 2s, 4s, 8s) a 200 ms throttling.
- **Diakritika je nečitateľná v UI** — skontroluj, že `index.html` má `<meta charset="utf-8">` a server odpovedá `application/json; charset=utf-8`.

## Stack

- Node 20+ (ESM, žiadny build step)
- Express 4
- Chart.js (CDN, frontend-only)
- `node:test` runner pre unit testy

## Tests

```
npm test
```

Spúšťa unit testy pre všetky moduly v `server/`. Tests neberú API kľúč — používajú fake fetch.

## Mimo rozsah

- AI/ML klasifikácia, real-time integrácia, auto-deploy do LA, autentifikácia samotnej aplikácie. Viď `docs/superpowers/specs/2026-04-27-la-tickets-analyzer-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with setup, troubleshooting, endpoint catalogue"
```

### Task 13.2: End-to-end smoke walk-through

**Files:** none (manual)

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Start server**

Run: `npm start`

- [ ] **Step 3: Walk the UI**

In browser at `http://localhost:3001/`:
1. Setup → fill in real endpoint + key (or pre-set in `.env`) → "Otestovať pripojenie" → green.
2. Save → switch to Download.
3. Download last 30 days (smaller test) → watch SSE log → wait for HOTOVO line.
4. Tags → all unique tags listed with counts → check the 4 classification tags are pre-selected as `classification` → Save & re-analyze.
5. Dashboard → all sections render → no console errors.
6. Export → click rules.md, verify file downloads with content.

- [ ] **Step 4: Confirm acceptance criteria**

Tick each item in §12 of the spec doc:
- [ ] `npm install && npm start` works on Windows; app at `http://localhost:3001`
- [ ] Setup screen tests connection and shows green/red with the actual error message
- [ ] Download of 1000–3000 tickets over 6 months completes (run a real one if you trust the data — keep a smaller window otherwise)
- [ ] Cache reused for 24h; cancel + re-run dedups by id
- [ ] Tag categorization screen shows unknown tags with counts
- [ ] Dashboard sections A–F render with real data and charts
- [ ] Candidate rules show coverage + confidence and FP expand
- [ ] Markdown + JSON + CSV export each produces a downloadable file
- [ ] Changing tag categorization triggers re-analysis without re-download
- [ ] README has setup, troubleshooting, list of LA endpoints and corrected filter syntax

- [ ] **Step 5: Commit any final polish**

If smoke test surfaces tiny issues (typo, broken link), fix and commit:
```bash
git add -A
git commit -m "fix: smoke-test follow-ups"
```

---

## Self-review notes (for the author)

- Spec coverage:
  - F1 (setup) → Phase 7.1, 8.1, 8.2 ✓
  - F2 (download) → Phase 4 + Phase 7.2 + Phase 9.1 ✓
  - F3 (tag categorization) → Phase 7.3 + Phase 10.1 ✓
  - F4 sections A–F (dashboard) → Phases 11 + 12 ✓
  - F5 (export) → Phase 7.4 + export links in HTML ✓
  - F6 (re-analysis) → re-call `/api/analysis`, no new download (covered by reload after Save in Tags) ✓
- All algorithm thresholds from spec §8.5 are encoded as defaults in `rule-generator.js`.
- All API quirks from spec §4 are encoded in `la-client.js`.
- All file paths and signatures are consistent across tasks (verified by reading task-to-task).
