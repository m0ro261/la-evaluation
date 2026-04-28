import { firstCustomerMessage } from './la-client.js';
import { enrichTicket } from './enricher.js';

// LA status codes (per /docs/api/v3/):
//   I=init, N=new, T=chatting, P=calling, R=resolved, X=deleted, B=spam,
//   A=answered, C=open, W=postponed, L=closed
// Defaults skip X (deleted) and B (spam) — these are not real customer
// support tickets and otherwise drown the analysis.
const SKIPPED_STATUSES_DEFAULT = new Set(['X', 'B']);

function shouldSkip(ticket, { skippedStatuses, skipDeleted }) {
  if (skipDeleted && ticket.date_deleted && ticket.date_deleted.trim() !== '') return 'deleted';
  if (skippedStatuses.has(ticket.status)) return `status:${ticket.status}`;
  return null;
}

async function processInPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function downloadAll({
  client, from, to, maxTickets = 5000, knownIds = new Set(), signal, onProgress = () => {},
  skippedStatuses = SKIPPED_STATUSES_DEFAULT, skipDeleted = true,
  concurrency = 5,
} = {}) {
  onProgress({ phase: 'meta', step: 'agents+tags' });
  const [agents, tags] = await Promise.all([client.listAgents(), client.listTags()]);
  const agentIds = new Set(agents.map(a => a.id));
  const tagIdToName = Object.fromEntries(tags.map(t => [t.id, t.name]));

  const collected = [];
  const skips = { deleted: 0, by_status: {}, dedup: 0 };
  let cancelled = false;
  let raw = 0;
  for await (const t of client.listTickets({ from, to, signal })) {
    if (signal?.aborted) { cancelled = true; break; }
    raw += 1;
    if (knownIds.has(t.id)) { skips.dedup += 1; continue; }
    const reason = shouldSkip(t, { skippedStatuses, skipDeleted });
    if (reason === 'deleted') { skips.deleted += 1; continue; }
    if (reason && reason.startsWith('status:')) {
      const s = reason.slice('status:'.length);
      skips.by_status[s] = (skips.by_status[s] ?? 0) + 1;
      continue;
    }
    if (collected.length >= maxTickets) break;
    collected.push(t);
    onProgress({ phase: 'tickets', count: collected.length, skips });
  }

  let done = 0;
  const enrichedSparse = await processInPool(collected, concurrency, async (t) => {
    if (signal?.aborted) { cancelled = true; return null; }
    let msg = null;
    try {
      const groups = await client.getTicketMessages(t.id);
      msg = firstCustomerMessage(groups, agentIds);
    } catch { msg = null; }
    if (signal?.aborted) { cancelled = true; return null; }
    const out = enrichTicket(t, msg, tagIdToName);
    done += 1;
    onProgress({ phase: 'messages', done, total: collected.length });
    return out;
  });
  const enriched = enrichedSparse.filter(Boolean);

  return {
    tickets: enriched,
    meta: {
      range: { from, to: to ?? null },
      count: enriched.length,
      raw_count: raw,
      skips,
      tag_id_to_name: tagIdToName,
      agent_ids: [...agentIds],
    },
    cancelled,
  };
}
