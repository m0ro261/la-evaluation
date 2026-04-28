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

import { stripSubjectPrefix, tokenize, stripSignature } from './text-utils.js';

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
  const bodyCounts = buildCounts(tickets, t => stripSignature(t.first_customer_message?.plain_text || ''), sw);
  const out = {};
  for (const cls of CLASSES_FOR_KW) {
    out[cls] = {
      subject: topDifferential(subjectCounts.perClass, subjectCounts.totalsPerClass, cls, topN),
      body: topDifferential(bodyCounts.perClass, bodyCounts.totalsPerClass, cls, topN),
    };
  }
  return out;
}
