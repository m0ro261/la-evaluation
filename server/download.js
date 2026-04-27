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
