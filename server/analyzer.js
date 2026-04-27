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
  return topByGroup(tickets, t => t.owner?.email, n).map(g => ({
    email: g.key,
    name: g.sample_name,
    total: g.total,
    by_class: g.by_class,
    unclassified: g.unclassified,
  }));
}

export function topDomains(tickets, n = 20) {
  return topByGroup(tickets, t => t.owner?.domain, n).map(g => ({
    domain: g.key,
    total: g.total,
    by_class: g.by_class,
    unclassified: g.unclassified,
  }));
}
