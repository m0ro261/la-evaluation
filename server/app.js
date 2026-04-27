import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { createClient } from './la-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ROOT = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');

export function createApp({ clientFactory } = {}) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(PUBLIC_DIR));
  app.get('/health', (_req, res) => res.json({ ok: true }));

  const makeClient = clientFactory ?? (({ baseUrl, apiKey }) => createClient({ baseUrl, apiKey }));

  app.post('/api/test-connection', async (req, res) => {
    const { baseUrl, apiKey } = req.body ?? {};
    if (!baseUrl || !apiKey) return res.status(400).json({ ok: false, message: 'baseUrl a apiKey sú povinné' });
    try {
      const client = makeClient({ baseUrl, apiKey });
      const agents = await client.listAgents();
      res.json({ ok: true, agent_count: Array.isArray(agents) ? agents.length : 0 });
    } catch (e) {
      res.status(400).json({ ok: false, status: e.status, message: e.message });
    }
  });

  app.post('/api/save-config', async (req, res) => {
    const { baseUrl, apiKey, periodDays } = req.body ?? {};
    if (!baseUrl || !apiKey) return res.status(400).json({ ok: false, message: 'baseUrl a apiKey sú povinné' });
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

  return app;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  const port = Number(process.env.PORT) || 3001;
  createApp().listen(port, () => console.log(`LA Analyzer on http://localhost:${port}`));
}
