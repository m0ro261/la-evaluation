import { stripSubjectPrefix, tokenize, stripSignature } from './text-utils.js';
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
  if (field === 'body') return stripSignature(ticket.first_customer_message?.plain_text || '').toLowerCase();
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
  let matches_total = 0, true_positives = 0, false_positives = 0, unclassified_matches = 0;
  const matched_examples = [];
  const false_positive_examples = [];
  for (const t of tickets) {
    if (!ruleMatches(rule, t)) continue;
    matches_total++;
    if (t.classification === rule.action.classification) {
      true_positives++;
      if (matched_examples.length < 5) matched_examples.push({ ticket_id: t.id, code: t.code ?? '', subject: t.subject, actual_classification: t.classification });
    } else if (t.classification) {
      false_positives++;
      if (false_positive_examples.length < 5) false_positive_examples.push({ ticket_id: t.id, code: t.code ?? '', subject: t.subject, actual_classification: t.classification });
    } else {
      unclassified_matches++;
    }
  }
  // Confidence is computed over LABELED matches only (TP + FP).
  // Unclassified matches don't have ground truth and would unfairly drag confidence down.
  const labeled_matches = true_positives + false_positives;
  const confidence_percent = labeled_matches === 0 ? 0 : Math.round((true_positives / labeled_matches) * 10000) / 100;
  const coverage_percent = tickets.length === 0 ? 0 : Math.round((matches_total / tickets.length) * 10000) / 100;
  return { matches_total, true_positives, false_positives, unclassified_matches, confidence_percent, coverage_percent, examples: matched_examples, false_positive_examples };
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

export function generateKeywordRules(tickets, { stopwords, minConfidence = 65, minSubjectCoverage = 0.5, minBodyCoverage = 0.3, topN = 50 } = {}) {
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
  let classifiedTotal = 0;
  let classifiedCovered = 0;
  let classifiedAgreed = 0;
  for (const t of tickets) {
    const isClassified = !!t.classification;
    if (isClassified) classifiedTotal += 1;
    let matchedRule = null;
    for (const r of rules) if (ruleMatches(r, t)) { matchedRule = r; break; }
    if (!matchedRule) {
      uncovered.push(t);
    } else if (t.classification && t.classification !== matchedRule.action.classification) {
      disagreements.push({ ticket: t, rule: matchedRule });
    }
    if (isClassified && matchedRule) {
      classifiedCovered += 1;
      if (t.classification === matchedRule.action.classification) classifiedAgreed += 1;
    }
  }
  // sample
  const sample = (arr) => arr.slice(0, sampleSize);
  const pct = (n, total) => total === 0 ? 0 : Math.round((n / total) * 1000) / 10;
  return {
    uncovered: sample(uncovered),
    disagreements: sample(disagreements),
    uncovered_total: uncovered.length,
    disagreements_total: disagreements.length,
    classified_total: classifiedTotal,
    classified_covered: classifiedCovered,
    classified_agreed: classifiedAgreed,
    coverage_of_classified_pct: pct(classifiedCovered, classifiedTotal),
    automation_potential_pct: pct(classifiedAgreed, classifiedTotal),
  };
}

export function generateAllRules(tickets, { stopwords = new Set() } = {}) {
  // reset id counter for deterministic ids per analysis
  _rid = 0;
  // Only subject + body keyword rules — sender-based rules (domain, email)
  // are excluded by design: LA Rules engine cannot pivot on sender attributes
  // in a way that meaningfully automates classification, and the user
  // explicitly does not want them as proposed automations.
  const kw = generateKeywordRules(tickets, { stopwords });
  const merged = [...kw].sort((a, b) => b.stats.coverage_percent - a.stats.coverage_percent || b.stats.confidence_percent - a.stats.confidence_percent);
  // re-id stably after sort
  merged.forEach((r, i) => { r.id = `rule_${String(i + 1).padStart(3, '0')}`; });
  const ec = edgeCases(tickets, merged);
  return { rules: merged, edge_cases: ec };
}
