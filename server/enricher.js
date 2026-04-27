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
