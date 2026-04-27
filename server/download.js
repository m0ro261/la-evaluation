import { firstCustomerMessage } from './la-client.js';
import { enrichTicket } from './enricher.js';

const SKIPPED_STATUSES_DEFAULT = new Set(['X']); // X = archived/deleted in LA

function shouldSkip(ticket, { skippedStatuses, skipDeleted }) {
  if (skipDeleted && ticket.date_deleted && ticket.date_deleted.trim() !== '') return 'deleted';
  if (skippedStatuses.has(ticket.status)) return `status:${ticket.status}`;
  return null;
}

export async function downloadAll({
  client, from, to, maxTickets = 5000, knownIds = new Set(), signal, onProgress = () => {},
  skippedStatuses = SKIPPED_STATUSES_DEFAULT, skipDeleted = true,
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
      raw_count: raw,
      skips,
      tag_id_to_name: tagIdToName,
      agent_ids: [...agentIds],
    },
    cancelled,
  };
}
