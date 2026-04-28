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

function extractTerms(rawTokens, stopwords) {
  // Unigrams: drop stopwords entirely.
  // Bigrams: keep if at least ONE token is non-stopword.
  // Trigrams: keep if at least ONE token is non-stopword.
  const unigrams = [];
  for (const t of rawTokens) if (!stopwords.has(t)) unigrams.push(t);
  const bigrams = [];
  for (let i = 0; i < rawTokens.length - 1; i++) {
    const a = rawTokens[i], b = rawTokens[i + 1];
    if (stopwords.has(a) && stopwords.has(b)) continue;
    bigrams.push(`${a} ${b}`);
  }
  const trigrams = [];
  for (let i = 0; i < rawTokens.length - 2; i++) {
    const a = rawTokens[i], b = rawTokens[i + 1], c = rawTokens[i + 2];
    if (stopwords.has(a) && stopwords.has(b) && stopwords.has(c)) continue;
    trigrams.push(`${a} ${b} ${c}`);
  }
  return { unigrams, bigrams, trigrams };
}

function buildCounts(tickets, fieldFn, stopwords) {
  const mkPerClass = () => Object.fromEntries(CLASSES_FOR_KW.map(c => [c, new Map()]));
  const mkTotals = () => Object.fromEntries(CLASSES_FOR_KW.map(c => [c, 0]));
  const perClassUni = mkPerClass(), totalsUni = mkTotals();
  const perClassBi = mkPerClass(), totalsBi = mkTotals();
  const perClassTri = mkPerClass(), totalsTri = mkTotals();
  for (const t of tickets) {
    if (!t.classification || !perClassUni[t.classification]) continue;
    const raw = tokenize(fieldFn(t));
    const { unigrams, bigrams, trigrams } = extractTerms(raw, stopwords);
    totalsUni[t.classification] += unigrams.length;
    const mu = perClassUni[t.classification];
    for (const w of unigrams) mu.set(w, (mu.get(w) ?? 0) + 1);
    totalsBi[t.classification] += bigrams.length;
    const mb = perClassBi[t.classification];
    for (const w of bigrams) mb.set(w, (mb.get(w) ?? 0) + 1);
    totalsTri[t.classification] += trigrams.length;
    const mt = perClassTri[t.classification];
    for (const w of trigrams) mt.set(w, (mt.get(w) ?? 0) + 1);
  }
  return { perClassUni, totalsUni, perClassBi, totalsBi, perClassTri, totalsTri };
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

function topMixed(counts, cls, topN) {
  // Compute G² separately for unigrams, bigrams, trigrams. Each n-gram size
  // has inherently different count magnitudes (and thus G² ranges), so a
  // pure G² merge is biased towards unigrams. Reserve ~1/3 of slots for
  // each gram size so phrasal candidates reach the rule generator.
  const slots = Math.ceil(topN / 3);
  const uni = topDifferential(counts.perClassUni, counts.totalsUni, cls, slots).map(x => ({ ...x, n: 1 }));
  const bi  = topDifferential(counts.perClassBi,  counts.totalsBi,  cls, slots).map(x => ({ ...x, n: 2 }));
  const tri = topDifferential(counts.perClassTri, counts.totalsTri, cls, slots).map(x => ({ ...x, n: 3 }));
  return [...uni, ...bi, ...tri].sort((a, b) => b.g2 - a.g2);
}

// Phrase explorer: rank phrases (uni / bi / tri) by RAW total frequency
// across ALL tickets (classified + unclassified), with class distribution.
// This is the discovery counterpart to keywordStats — it surfaces patterns
// that humans recognize but G² may filter out (low-count phrases, evenly
// split classes, generic question patterns, etc.).
export function phraseExplorer(tickets, { stopwords = new Set(), minCount = 5, topN = 200, includeUnclassified = true } = {}) {
  // counts[term] = { total, byClass: {ZP, TP, BUG, URGENT_BUG}, unclassified, n }
  const counts = new Map();
  const ensure = (term, n) => {
    let c = counts.get(term);
    if (!c) { c = { total: 0, byClass: { ZP: 0, TP: 0, BUG: 0, URGENT_BUG: 0 }, unclassified: 0, n }; counts.set(term, c); }
    return c;
  };
  const inc = (term, ticket, n) => {
    const c = ensure(term, n);
    c.total += 1;
    if (ticket.classification && c.byClass[ticket.classification] !== undefined) c.byClass[ticket.classification] += 1;
    else c.unclassified += 1;
  };
  for (const t of tickets) {
    if (!includeUnclassified && !t.classification) continue;
    const subj = stripSubjectPrefix(t.subject || '');
    const body = stripSignature(t.first_customer_message?.plain_text || '');
    for (const field of [subj, body]) {
      const tokens = tokenize(field);
      const { unigrams, bigrams, trigrams } = extractTerms(tokens, stopwords);
      // De-dup within the same ticket so a word repeated 5x in the same ticket
      // counts once toward "X tickets contain this phrase". That matches the
      // semantics of LA Rules ('subject contains X' fires once per ticket).
      const seen = new Set();
      for (const u of unigrams) { if (!seen.has(u)) { seen.add(u); inc(u, t, 1); } }
      for (const b of bigrams)  { if (!seen.has(b)) { seen.add(b); inc(b, t, 2); } }
      for (const tri of trigrams) { if (!seen.has(tri)) { seen.add(tri); inc(tri, t, 3); } }
    }
  }
  const rows = [];
  for (const [term, c] of counts) {
    if (c.total < minCount) continue;
    const labeled = c.byClass.ZP + c.byClass.TP + c.byClass.BUG + c.byClass.URGENT_BUG;
    let dominant = null, dominantCount = 0;
    for (const cls of ['ZP', 'TP', 'BUG', 'URGENT_BUG']) {
      if (c.byClass[cls] > dominantCount) { dominantCount = c.byClass[cls]; dominant = cls; }
    }
    const dominantPct = labeled === 0 ? 0 : Math.round((dominantCount / labeled) * 1000) / 10;
    rows.push({
      phrase: term,
      n: c.n,
      total: c.total,
      labeled,
      unclassified: c.unclassified,
      by_class: c.byClass,
      dominant,
      dominant_pct: dominantPct,
    });
  }
  rows.sort((a, b) => b.total - a.total);
  return rows.slice(0, topN);
}

export function keywordStats(tickets, { stopwords, topN = 30, bodyTopN } = {}) {
  const sw = stopwords ?? new Set();
  const subjectCounts = buildCounts(tickets, t => stripSubjectPrefix(t.subject || ''), sw);
  const bodyCounts = buildCounts(tickets, t => stripSignature(t.first_customer_message?.plain_text || ''), sw);
  // Body has 10–100x more unique tokens per ticket than subject, so candidates
  // dilute fast. Default body to a higher topN unless caller overrides.
  const effectiveBodyTopN = bodyTopN ?? topN * 2;
  const out = {};
  for (const cls of CLASSES_FOR_KW) {
    out[cls] = {
      subject: topMixed(subjectCounts, cls, topN),
      body: topMixed(bodyCounts, cls, effectiveBodyTopN),
    };
  }
  return out;
}
