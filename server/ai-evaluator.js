import { classifyTicket } from './ai-classifier.js';

const CLASSES = ['ZP', 'TP', 'BUG', 'URGENT_BUG'];

async function processInPool(items, concurrency, fn, { throttleMs = 0 } = {}) {
  const results = new Array(items.length);
  let next = 0;
  let lastStart = 0;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (next < items.length) {
      const i = next++;
      if (throttleMs > 0) {
        const wait = throttleMs - (Date.now() - lastStart);
        if (wait > 0) await sleep(wait);
        lastStart = Date.now();
      }
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function evaluateTickets({
  client,
  tickets,
  model = 'claude-haiku-4-5',
  // Anthropic's default tier rate limit is ~50 req/min; concurrency of 2 with
  // a small throttle between calls keeps us under it. Higher concurrency just
  // burns budget on retries.
  concurrency = 2,
  throttleMs = 250,
  signal,
  onProgress = () => {},
  onPartial = null, // ({results, usage}) — invoked every checkpointEvery to allow mid-run save
  checkpointEvery = 50,
  existingResults = new Map(),
}) {
  const todo = tickets.filter(t => !existingResults.has(t.id));
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const errorKinds = { no_json: 0, parse_error: 0, bad_class: 0, api: 0, other: 0 };
  let done = 0;
  let errors = 0;
  const freshSparse = new Array(todo.length);

  const fresh = await processInPool(todo, concurrency, async (ticket, idx) => {
    // throttleMs handled inside processInPool
    if (signal?.aborted) return null;
    let entry;
    try {
      const ai = await classifyTicket(client, ticket, { model });
      usage.input_tokens += ai.usage.input_tokens;
      usage.output_tokens += ai.usage.output_tokens;
      usage.cache_read_input_tokens += ai.usage.cache_read_input_tokens;
      usage.cache_creation_input_tokens += ai.usage.cache_creation_input_tokens;
      entry = {
        ticket_id: ticket.id,
        code: ticket.code ?? '',
        subject: ticket.subject ?? '',
        actual: ticket.classification ?? null,
        ai: { classification: ai.classification, confidence: ai.confidence, reasoning: ai.reasoning },
        evaluated_at: new Date().toISOString(),
      };
    } catch (e) {
      errors += 1;
      const kind = e.kind || (e.status ? 'api' : 'other');
      errorKinds[kind] = (errorKinds[kind] ?? 0) + 1;
      entry = {
        ticket_id: ticket.id,
        code: ticket.code ?? '',
        subject: ticket.subject ?? '',
        actual: ticket.classification ?? null,
        error: e.message,
        error_kind: kind,
        error_raw: e.raw ? String(e.raw).slice(0, 500) : undefined,
        evaluated_at: new Date().toISOString(),
      };
    }
    freshSparse[idx] = entry;
    done += 1;
    onProgress({ done, total: todo.length, errors, error_kinds: { ...errorKinds }, usage });

    // Periodic checkpoint — save partial results so a crash/cancel doesn't lose them
    if (onPartial && done % checkpointEvery === 0) {
      const partial = [...existingResults.values(), ...freshSparse.filter(Boolean)];
      try { await onPartial({ results: partial, usage, errors, error_kinds: { ...errorKinds } }); } catch {}
    }
    return entry;
  }, { throttleMs });

  const all = [...existingResults.values(), ...fresh.filter(Boolean)];
  return { results: all, usage, errors, error_kinds: errorKinds, processed: done, skipped_existing: existingResults.size };
}

export function computeConfusionMatrix(results) {
  // matrix[actualClass][predictedClass] = count
  const matrix = Object.fromEntries(CLASSES.map(c => [c, Object.fromEntries(CLASSES.map(p => [p, 0]))]));
  let total = 0, agreed = 0, withActual = 0;
  let lowConfidence = 0; // confidence < 70 still a signal of model uncertainty
  for (const r of results) {
    if (r.error || !r.ai) continue;
    if (!CLASSES.includes(r.ai.classification)) continue;
    if (!r.actual) continue;
    if (!CLASSES.includes(r.actual)) continue;
    matrix[r.actual][r.ai.classification] += 1;
    total += 1;
    withActual += 1;
    if (r.actual === r.ai.classification) agreed += 1;
    if ((r.ai.confidence ?? 0) < 70) lowConfidence += 1;
  }

  // per-class precision (TP / predicted), recall (TP / actual), F1
  const perClass = Object.fromEntries(CLASSES.map(c => [c, { tp: 0, fp: 0, fn: 0, precision: 0, recall: 0, f1: 0 }]));
  for (const actual of CLASSES) {
    for (const predicted of CLASSES) {
      const n = matrix[actual][predicted];
      if (actual === predicted) perClass[actual].tp += n;
      else {
        perClass[predicted].fp += n;
        perClass[actual].fn += n;
      }
    }
  }
  for (const c of CLASSES) {
    const m = perClass[c];
    m.precision = (m.tp + m.fp) === 0 ? 0 : m.tp / (m.tp + m.fp);
    m.recall = (m.tp + m.fn) === 0 ? 0 : m.tp / (m.tp + m.fn);
    m.f1 = (m.precision + m.recall) === 0 ? 0 : 2 * m.precision * m.recall / (m.precision + m.recall);
  }

  return {
    matrix,
    total,
    agreed,
    accuracy: total === 0 ? 0 : agreed / total,
    per_class: perClass,
    low_confidence_count: lowConfidence,
  };
}

// Approximate cost for Claude Haiku 4.5 ($1/1M input, $5/1M output, $0.10/1M cache reads, $1.25/1M cache writes)
export function estimateCost(usage) {
  const inputBase = (usage.input_tokens || 0) - (usage.cache_read_input_tokens || 0) - (usage.cache_creation_input_tokens || 0);
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheCreate = usage.cache_creation_input_tokens || 0;
  const output = usage.output_tokens || 0;
  return {
    input_usd: (Math.max(0, inputBase) / 1e6) * 1.0,
    cache_read_usd: (cacheRead / 1e6) * 0.10,
    cache_create_usd: (cacheCreate / 1e6) * 1.25,
    output_usd: (output / 1e6) * 5.0,
    total_usd: (Math.max(0, inputBase) / 1e6) * 1.0
              + (cacheRead / 1e6) * 0.10
              + (cacheCreate / 1e6) * 1.25
              + (output / 1e6) * 5.0,
  };
}
