import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { createClient } from './la-client.js';
import { createStorage } from './storage.js';
import { downloadAll } from './download.js';
import { distributionStats, weeklyTrend, topCustomers, topDomains, keywordStats, phraseExplorer } from './analyzer.js';
import { generateAllRules } from './rule-generator.js';
import { loadStopwords } from './text-utils.js';
import { rulesToMarkdown, ticketsToCsv } from './exporter.js';
import { createAiClient, classifyTicket } from './ai-classifier.js';
import { evaluateTickets, computeConfusionMatrix, estimateCost } from './ai-evaluator.js';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ROOT = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');
const STARTED_AT = new Date().toISOString();

export function createApp({ clientFactory, storageFactory } = {}) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(PUBLIC_DIR));
  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.get('/api/version', (_req, res) => {
    // Best-effort git SHA + start time so the user can verify the running build.
    let sha = 'unknown';
    try {
      sha = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
    } catch {}
    res.json({ sha, started_at: STARTED_AT });
  });

  const makeClient = clientFactory ?? (({ baseUrl, apiKey }) => createClient({ baseUrl, apiKey }));

  app.post('/api/test-connection', async (req, res) => {
    const { baseUrl, apiKey } = req.body ?? {};
    if (!baseUrl || !apiKey) return res.status(400).json({ ok: false, message: 'baseUrl a apiKey sú povinné' });
    try {
      const client = makeClient({ baseUrl, apiKey });
      const agents = await client.listAgents();
      res.json({ ok: true, agent_count: Array.isArray(agents) ? agents.length : 0 });
    } catch (e) {
      const status = (e.status >= 400 && e.status < 600) ? e.status : 502;
      res.status(status).json({ ok: false, status: e.status, message: e.message });
    }
  });

  app.post('/api/save-config', async (req, res) => {
    const { baseUrl, apiKey, periodDays } = req.body ?? {};
    if (!baseUrl || !apiKey) return res.status(400).json({ ok: false, message: 'baseUrl a apiKey sú povinné' });
    if (/[\r\n]/.test(baseUrl) || /[\r\n]/.test(apiKey)) {
      return res.status(400).json({ ok: false, message: 'baseUrl a apiKey nemôžu obsahovať nové riadky' });
    }
    if (!/^https?:\/\/[A-Za-z0-9._:\/\-]+$/.test(baseUrl)) {
      return res.status(400).json({ ok: false, message: 'baseUrl musí byť platná HTTP(S) URL' });
    }
    const env = `LA_API_URL=${baseUrl}\nLA_API_KEY=${apiKey}\nPORT=${process.env.PORT || 3001}\nDEFAULT_PERIOD_DAYS=${periodDays || process.env.DEFAULT_PERIOD_DAYS || 180}\n`;
    await fs.writeFile(ENV_FILE, env, 'utf8');
    process.env.LA_API_URL = baseUrl;
    process.env.LA_API_KEY = apiKey;
    if (periodDays) process.env.DEFAULT_PERIOD_DAYS = String(periodDays);
    res.json({ ok: true });
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      baseUrl: process.env.LA_API_URL || '',
      hasKey: Boolean(process.env.LA_API_KEY),
      periodDays: Number(process.env.DEFAULT_PERIOD_DAYS) || 180,
    });
  });

  const dataDir = path.join(ROOT, 'data');
  const makeStorage = storageFactory ?? (() => createStorage(dataDir));

  app.post('/api/download', async (req, res) => {
    const { from, to, maxTickets, skipDeleted, skippedStatuses } = req.body ?? {};
    const baseUrl = process.env.LA_API_URL;
    const apiKey = process.env.LA_API_KEY;
    if (!baseUrl || !apiKey) return res.status(400).json({ ok: false, message: 'API config missing — uložte ho cez /api/save-config' });
    if (!from) return res.status(400).json({ ok: false, message: 'from je povinné' });
    const statusFilter = Array.isArray(skippedStatuses)
      ? new Set(skippedStatuses.map(s => String(s).trim()).filter(Boolean))
      : undefined;
    const skipDeletedFlag = skipDeleted === undefined ? undefined : Boolean(skipDeleted);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    const send = (event, data) => {
      if (!res.writableEnded && !res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const ac = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ac.abort(); });

    try {
      const client = makeClient({ baseUrl, apiKey });
      const storage = makeStorage(dataDir);

      const existing = await storage.loadLatest();
      const knownIds = new Set((existing?.tickets ?? []).map(t => t.id));

      const result = await downloadAll({
        client, from, to, maxTickets: maxTickets || 5000, knownIds,
        signal: ac.signal,
        onProgress: ev => send('progress', ev),
        ...(statusFilter ? { skippedStatuses: statusFilter } : {}),
        ...(skipDeletedFlag !== undefined ? { skipDeleted: skipDeletedFlag } : {}),
      });

      // merge with existing tickets if dedup was active
      const merged = existing ? [...existing.tickets.filter(t => !result.tickets.find(x => x.id === t.id)), ...result.tickets] : result.tickets;
      const meta = { ...result.meta, count: merged.length, saved_at: new Date().toISOString() };
      await storage.saveCache({ tickets: merged, meta });

      send('done', { count: merged.length, cancelled: result.cancelled, skips: result.meta.skips, raw_count: result.meta.raw_count, meta });
      res.end();
    } catch (e) {
      send('error', { message: e.message, status: e.status });
      res.end();
    }
  });

  const stopwordsPath = path.join(dataDir, 'stopwords-sk.json');

  app.get('/api/cache', async (_req, res) => {
    const storage = makeStorage(dataDir);
    const data = await storage.loadLatest();
    if (!data) return res.status(404).json({ ok: false, message: 'no cache' });
    res.json({ ok: true, count: data.tickets.length, meta: data.meta, saved_at: data.saved_at });
  });

  app.get('/api/tickets', async (_req, res) => {
    const storage = makeStorage(dataDir);
    const data = await storage.loadLatest();
    if (!data) return res.status(404).json({ ok: false, message: 'no cache' });
    res.json({ ok: true, tickets: data.tickets });
  });

  app.get('/api/tag-categories', async (_req, res) => {
    const storage = makeStorage(dataDir);
    const cats = await storage.readJson('tag-categories.json');
    res.json(cats ?? { version: 1, categories: {} });
  });

  app.post('/api/tag-categories', async (req, res) => {
    const storage = makeStorage(dataDir);
    const payload = { version: 1, updated_at: new Date().toISOString(), categories: req.body?.categories ?? {} };
    await storage.writeJson('tag-categories.json', payload);
    res.json({ ok: true });
  });

  app.get('/api/phrases', async (req, res) => {
    const storage = makeStorage(dataDir);
    const data = await storage.loadLatest();
    if (!data) return res.status(404).json({ ok: false, message: 'no cache' });
    let stopwords = new Set();
    try { stopwords = await loadStopwords(stopwordsPath); } catch (e) { console.warn(`[phrases] loadStopwords failed: ${e.message}`); }
    const cats = (await storage.readJson('tag-categories.json'))?.categories ?? {};
    const ignoredTagIds = new Set(Object.entries(cats).filter(([, v]) => v === 'ignored').map(([k]) => k));
    const tickets = data.tickets.filter(t => !(t.tag_ids ?? []).some(id => ignoredTagIds.has(id)));
    const minCount = Math.max(1, Number(req.query.minCount) || 5);
    const topN = Math.min(1000, Math.max(10, Number(req.query.topN) || 300));
    const phrases = phraseExplorer(tickets, { stopwords, minCount, topN });
    res.json({ ok: true, phrases, total_tickets: tickets.length });
  });

  app.get('/api/manual-rules', async (_req, res) => {
    const storage = makeStorage(dataDir);
    const data = await storage.readJson('manual-rules.json');
    res.json(data ?? { version: 1, rules: [] });
  });

  app.post('/api/manual-rules', async (req, res) => {
    const { field, value, classification, label } = req.body ?? {};
    if (!['subject', 'body'].includes(field)) return res.status(400).json({ ok: false, message: 'field musí byť subject alebo body' });
    if (!value || typeof value !== 'string') return res.status(400).json({ ok: false, message: 'value je povinné' });
    if (!['ZP', 'TP', 'BUG', 'URGENT_BUG'].includes(classification)) return res.status(400).json({ ok: false, message: 'neplatná classification' });
    const storage = makeStorage(dataDir);
    const existing = (await storage.readJson('manual-rules.json')) ?? { version: 1, rules: [] };
    const id = `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const dup = existing.rules.find(r => r.field === field && r.value === value && r.classification === classification);
    if (dup) return res.status(409).json({ ok: false, message: 'pravidlo už existuje', id: dup.id });
    existing.rules.push({ id, field, value: value.trim(), classification, label: label ?? '', added_at: new Date().toISOString() });
    await storage.writeJson('manual-rules.json', existing);
    res.json({ ok: true, id });
  });

  app.patch('/api/manual-rules/:id', async (req, res) => {
    const { classification, value, label } = req.body ?? {};
    const storage = makeStorage(dataDir);
    const existing = (await storage.readJson('manual-rules.json')) ?? { version: 1, rules: [] };
    const r = existing.rules.find(x => x.id === req.params.id);
    if (!r) return res.status(404).json({ ok: false, message: 'pravidlo neexistuje' });
    if (classification !== undefined) {
      if (!['ZP', 'TP', 'BUG', 'URGENT_BUG'].includes(classification)) return res.status(400).json({ ok: false, message: 'neplatná classification' });
      r.classification = classification;
    }
    if (value !== undefined) {
      if (typeof value !== 'string' || !value.trim()) return res.status(400).json({ ok: false, message: 'value je povinné' });
      r.value = value.trim();
    }
    if (label !== undefined) r.label = String(label);
    r.updated_at = new Date().toISOString();
    await storage.writeJson('manual-rules.json', existing);
    res.json({ ok: true, rule: r });
  });

  app.delete('/api/manual-rules/:id', async (req, res) => {
    const storage = makeStorage(dataDir);
    const existing = (await storage.readJson('manual-rules.json')) ?? { version: 1, rules: [] };
    const before = existing.rules.length;
    existing.rules = existing.rules.filter(r => r.id !== req.params.id);
    if (existing.rules.length === before) return res.status(404).json({ ok: false, message: 'pravidlo neexistuje' });
    await storage.writeJson('manual-rules.json', existing);
    res.json({ ok: true });
  });

  app.get('/api/analysis', async (_req, res) => {
    const storage = makeStorage(dataDir);
    const data = await storage.loadLatest();
    if (!data) return res.status(404).json({ ok: false, message: 'no cache' });
    let stopwords = new Set();
    try { stopwords = await loadStopwords(stopwordsPath); } catch (e) { console.warn(`[analysis] loadStopwords failed: ${e.message}`); }
    const cats = (await storage.readJson('tag-categories.json'))?.categories ?? {};
    const ignoredTagIds = new Set(Object.entries(cats).filter(([, v]) => v === 'ignored').map(([k]) => k));
    const tickets = data.tickets.filter(t => !(t.tag_ids ?? []).some(id => ignoredTagIds.has(id)));
    const manualPicks = ((await storage.readJson('manual-rules.json'))?.rules ?? []).map(r => ({ ...r }));
    const { rules, edge_cases } = generateAllRules(tickets, { stopwords, manualPicks });
    res.json({
      distribution: distributionStats(tickets),
      weekly_trend: weeklyTrend(tickets),
      top_customers: topCustomers(tickets, 20),
      top_domains: topDomains(tickets, 20),
      keyword_stats: keywordStats(tickets, { stopwords, topN: 30 }),
      rules,
      edge_cases,
      filtered_out: data.tickets.length - tickets.length,
    });
  });

  async function getAnalysisOrStatus(res) {
    const storage = makeStorage(dataDir);
    const data = await storage.loadLatest();
    if (!data) { res.status(404).json({ ok: false, message: 'no cache' }); return null; }
    let stopwords = new Set();
    try { stopwords = await loadStopwords(stopwordsPath); } catch (e) { console.warn(`[export] loadStopwords failed: ${e.message}`); }
    const cats = (await storage.readJson('tag-categories.json'))?.categories ?? {};
    const ignoredTagIds = new Set(Object.entries(cats).filter(([, v]) => v === 'ignored').map(([k]) => k));
    const tickets = data.tickets.filter(t => !(t.tag_ids ?? []).some(id => ignoredTagIds.has(id)));
    const manualPicks = ((await storage.readJson('manual-rules.json'))?.rules ?? []).map(r => ({ ...r }));
    return { tickets, ...generateAllRules(tickets, { stopwords, manualPicks }) };
  }

  // ─── AI classifier endpoints ─────────────────────────────────────
  app.post('/api/ai-test', async (req, res) => {
    const apiKey = req.body?.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(400).json({ ok: false, message: 'ANTHROPIC_API_KEY chýba' });
    try {
      const client = createAiClient(apiKey);
      // Tiny test call — single ticket fixture
      const out = await classifyTicket(client, {
        subject: 'Otázka na funkčnosť admin panelu',
        first_customer_message: { plain_text: 'Dobrý deň, ako môžem pridať novú kategóriu?' },
      });
      res.json({ ok: true, sample: out });
    } catch (e) {
      const status = e?.status >= 400 && e?.status < 600 ? e.status : 502;
      res.status(status).json({ ok: false, status: e?.status, message: e.message });
    }
  });

  app.post('/api/save-ai-config', async (req, res) => {
    const { apiKey, model } = req.body ?? {};
    if (!apiKey) return res.status(400).json({ ok: false, message: 'apiKey je povinné' });
    if (/[\r\n]/.test(apiKey)) return res.status(400).json({ ok: false, message: 'apiKey nemôže obsahovať nové riadky' });
    // Read existing .env, update only ANTHROPIC_* lines, preserve everything else.
    let env = '';
    try { env = await fs.readFile(ENV_FILE, 'utf8'); } catch {}
    const lines = env.split('\n').filter(l => !/^ANTHROPIC_(?:API_KEY|MODEL)=/.test(l));
    lines.push(`ANTHROPIC_API_KEY=${apiKey}`);
    lines.push(`ANTHROPIC_MODEL=${model || 'claude-haiku-4-5'}`);
    await fs.writeFile(ENV_FILE, lines.filter(Boolean).join('\n') + '\n', 'utf8');
    process.env.ANTHROPIC_API_KEY = apiKey;
    process.env.ANTHROPIC_MODEL = model || 'claude-haiku-4-5';
    res.json({ ok: true });
  });

  app.post('/api/ai-results-reset', async (_req, res) => {
    const storage = makeStorage(dataDir);
    await storage.writeJson('ai-classifications.json', { results: [], usage: { input_tokens: 0, output_tokens: 0 }, reset_at: new Date().toISOString() });
    res.json({ ok: true });
  });

  app.get('/api/ai-results', async (_req, res) => {
    const storage = makeStorage(dataDir);
    const data = await storage.readJson('ai-classifications.json');
    if (!data) return res.json({ ok: true, results: [], confusion: null, usage: null });
    const confusion = computeConfusionMatrix(data.results || []);
    const cost = estimateCost(data.usage || {});
    res.json({ ok: true, ...data, confusion, cost });
  });

  app.post('/api/ai-evaluate', async (req, res) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const model = req.body?.model || process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
    if (!apiKey) return res.status(400).json({ ok: false, message: 'ANTHROPIC_API_KEY chýba — uložte ho cez /api/save-ai-config' });

    const storage = makeStorage(dataDir);
    const cache = await storage.loadLatest();
    if (!cache) return res.status(404).json({ ok: false, message: 'no ticket cache — najprv stiahnite tickety' });

    // Filter: only labeled tickets (so we have ground truth to compare against)
    const onlyClassified = req.body?.onlyClassified !== false; // default true
    const targetTickets = onlyClassified
      ? cache.tickets.filter(t => !!t.classification)
      : cache.tickets;
    const limit = Number(req.body?.limit);
    const tickets = Number.isFinite(limit) && limit > 0 ? targetTickets.slice(0, limit) : targetTickets;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    const send = (event, data) => {
      if (!res.writableEnded && !res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ac.abort(); });

    try {
      const client = createAiClient(apiKey);

      // Resume support: if results file exists, skip already-evaluated tickets
      const existing = await storage.readJson('ai-classifications.json');
      const existingResults = new Map();
      if (existing?.results && req.body?.resume !== false) {
        for (const r of existing.results) if (!r.error) existingResults.set(r.ticket_id, r);
      }

      send('start', {
        total: tickets.length,
        already_evaluated: existingResults.size,
        to_process: tickets.length - existingResults.size,
        model,
      });

      const { results, usage, errors, processed } = await evaluateTickets({
        client, tickets, model,
        signal: ac.signal,
        existingResults,
        onProgress: (ev) => send('progress', ev),
      });

      const confusion = computeConfusionMatrix(results);
      const cost = estimateCost(usage);
      const payload = {
        results,
        usage,
        cost,
        model,
        evaluated_at: new Date().toISOString(),
      };
      await storage.writeJson('ai-classifications.json', payload);

      send('done', { ...payload, confusion, errors, processed });
      res.end();
    } catch (e) {
      send('error', { message: e.message, status: e.status });
      res.end();
    }
  });

  app.get('/api/export/rules.json', async (_req, res) => {
    const a = await getAnalysisOrStatus(res); if (!a) return;
    res.setHeader('Content-Disposition', 'attachment; filename="rules.json"');
    res.json({ rules: a.rules, edge_cases: a.edge_cases });
  });

  app.get('/api/export/rules.md', async (_req, res) => {
    const a = await getAnalysisOrStatus(res); if (!a) return;
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="rules.md"');
    res.send(rulesToMarkdown(a.rules));
  });

  app.get('/api/export/tickets.csv', async (_req, res) => {
    const storage = makeStorage(dataDir);
    const data = await storage.loadLatest();
    if (!data) return res.status(404).json({ ok: false, message: 'no cache' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tickets.csv"');
    res.send(ticketsToCsv(data.tickets));
  });

  return app;
}

import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 3001;
  let sha = 'unknown';
  try { sha = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch {}
  createApp().listen(port, () => console.log(`LA Analyzer on http://localhost:${port} (build ${sha}, started ${STARTED_AT})`));
}
