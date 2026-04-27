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
      if (wait > 0) await defaultSleep(wait);
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
      page += 1;
    }
  }
  return { laFetch, listAgents, listTags, listTickets };
}
