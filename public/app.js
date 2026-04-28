const panels = document.querySelectorAll('.panel');
const navButtons = document.querySelectorAll('.topbar nav button');
function show(id) {
  panels.forEach(p => p.classList.toggle('active', p.id === id));
  navButtons.forEach(b => b.classList.toggle('active', b.dataset.target === id));
  if (id === 'tags') loadTags();
  if (id === 'dashboard') loadDashboard();
}
navButtons.forEach(b => b.addEventListener('click', () => show(b.dataset.target)));

async function bootstrap() {
  const cfg = await fetch('/api/config').then(r => r.json()).catch(() => null);
  if (cfg?.baseUrl) document.querySelector('[name=baseUrl]').value = cfg.baseUrl;
  if (cfg?.periodDays) document.querySelector('[name=periodDays]').value = cfg.periodDays;
  show(cfg?.hasKey ? 'download' : 'setup');
}

// === Phase 10: Tag categorization ===
const KNOWN_CLASSIFICATION_NAMES = new Set([
  '0 - Zákaznícka podpora', '0 - Technická podpora', '0 - BUG/Incident', '0 - URGENT BUG',
]);
const CATEGORIES = ['classification', 'client', 'topic', 'status', 'internal', 'ignored'];

async function loadTags() {
  const tbody = document.querySelector('#tags-table tbody');
  tbody.innerHTML = '<tr><td colspan="3">Načítavam…</td></tr>';
  const [cacheRes, catsRes] = await Promise.all([
    fetch('/api/cache'), fetch('/api/tag-categories'),
  ]);
  if (!cacheRes.ok) { tbody.innerHTML = '<tr><td colspan="3">Najprv stiahnite tickety.</td></tr>'; return; }
  const cache = await cacheRes.json();
  const cats = await catsRes.json();
  const ticketsRes = await fetch('/api/tickets').then(r => r.json());
  const counts = new Map();
  for (const t of ticketsRes.tickets) for (const id of t.tag_ids ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  const tagIdToName = cache.meta?.tag_id_to_name ?? {};
  const rows = [...counts.entries()]
    .map(([id, count]) => ({ id, count, name: tagIdToName[id] ?? id }))
    .sort((a, b) => b.count - a.count);
  tbody.innerHTML = rows.map(r => {
    const current = cats.categories?.[r.id] ?? (KNOWN_CLASSIFICATION_NAMES.has(r.name) ? 'classification' : 'topic');
    const opts = CATEGORIES.map(c => `<option value="${c}"${c === current ? ' selected' : ''}>${c}</option>`).join('');
    return `<tr><td>${escapeHtml(r.name)}</td><td>${r.count}</td><td><select data-id="${r.id}">${opts}</select></td></tr>`;
  }).join('');
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

document.getElementById('tags-save').addEventListener('click', async () => {
  const selects = document.querySelectorAll('#tags-table select');
  const categories = {};
  selects.forEach(s => { categories[s.dataset.id] = s.value; });
  await fetch('/api/tag-categories', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ categories }) });
  show('dashboard');
});

// === Phase 11: Dashboard sections A–D ===
let charts = {}; // keep handles to destroy on reload

function destroyCharts() { for (const k of Object.keys(charts)) { try { charts[k].destroy(); } catch {} } charts = {}; }

const CLASS_COLORS = { ZP: '#811e00', TP: '#c05500', BUG: '#8e002d', URGENT_BUG: '#00be90' };

async function loadDashboard() {
  destroyCharts();
  const res = await fetch('/api/analysis');
  if (!res.ok) {
    document.getElementById('overview').textContent = 'Najprv stiahnite tickety.';
    return;
  }
  const a = await res.json();
  renderOverview(a);
  renderTrend(a);
  renderDistribution(a);
  renderCustomers(a);
  renderDomains(a);
  renderKeywords(a);
  renderRules(a);
  renderEdges(a);
}

function pct(n, total) { return total === 0 ? 0 : Math.round((n / total) * 1000) / 10; }

function renderOverview(a) {
  const el = document.getElementById('overview');
  const d = a.distribution;
  const ec = a.edge_cases;
  const auto = ec.automation_potential_pct ?? 0;
  const cov = ec.coverage_of_classified_pct ?? 0;
  el.innerHTML = `
    <h3>A · Prehľad</h3>
    <p><strong>${d.total}</strong> ticketov; <strong>${d.unclassified}</strong> bez klasifikácie (${pct(d.unclassified, d.total)}%).</p>
    <ul>
      ${['ZP','TP','BUG','URGENT_BUG'].map(c => `<li><span class="badge ${c}">${c}</span> ${d.by_class[c]} (${pct(d.by_class[c], d.total)}%)</li>`).join('')}
    </ul>
    <h4 style="margin-top: 16px;">Automatizačný potenciál</h4>
    <p>Z <strong>${ec.classified_total ?? 0}</strong> klasifikovaných ticketov:</p>
    <ul>
      <li>aspoň 1 pravidlo by zasiahlo: <strong>${ec.classified_covered ?? 0}</strong> (${cov}%)</li>
      <li>... a klasifikácia by súhlasila: <strong>${ec.classified_agreed ?? 0}</strong> (<strong>${auto}%</strong>)</li>
    </ul>
    <p class="hint">Automatizačný potenciál ${auto}% znamená že ${auto}% manuálnej TL klasifikácie by sa dalo nahradiť pravidlami pri zachovaní zhody s históriou.</p>`;
}

function renderTrend(a) {
  const ctx = document.querySelector('#trend canvas');
  const labels = a.weekly_trend.map(w => w.week);
  charts.trend = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: ['ZP','TP','BUG','URGENT_BUG'].map(c => ({
        label: c, data: a.weekly_trend.map(w => w.by_class[c]), borderColor: CLASS_COLORS[c], tension: 0.3, fill: false,
      })),
    },
    options: { plugins: { title: { display: true, text: 'B · Tickety / týždeň' } } },
  });
}

function renderDistribution(a) {
  const ctx = document.querySelector('#dist canvas');
  const d = a.distribution;
  charts.dist = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['ZP','TP','BUG','URGENT_BUG','bez klasifikácie'],
      datasets: [{ data: ['ZP','TP','BUG','URGENT_BUG'].map(c => d.by_class[c]).concat([d.unclassified]),
        backgroundColor: ['#811e00','#c05500','#8e002d','#00be90','#cccccc'] }],
    },
    options: { plugins: { title: { display: true, text: 'B · Distribúcia klasifikácie' } } },
  });
}

function renderCustomers(a) {
  const el = document.getElementById('customers');
  el.innerHTML = `<h3>C · Top klienti (email)</h3>` + ladderTable(a.top_customers, c => c.email);
}
function renderDomains(a) {
  const el = document.getElementById('domains');
  el.innerHTML = `<h3>D · Top domény</h3>` + ladderTable(a.top_domains, c => c.domain);
}

function ladderTable(rows, labelFn) {
  if (!rows.length) return '<p class="hint">žiadne dáta</p>';
  const head = `<thead><tr><th>identifikátor</th><th>spolu</th><th>ZP</th><th>TP</th><th>BUG</th><th>URGENT</th><th>bez kl.</th></tr></thead>`;
  const body = rows.map(r => `<tr>
    <td>${escapeHtml(labelFn(r))}</td>
    <td>${r.total}</td>
    <td>${r.by_class.ZP}</td>
    <td>${r.by_class.TP}</td>
    <td>${r.by_class.BUG}</td>
    <td>${r.by_class.URGENT_BUG}</td>
    <td>${r.unclassified}</td></tr>`).join('');
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

function renderKeywords(a) {
  const el = document.getElementById('keywords');
  const classes = ['ZP','TP','BUG','URGENT_BUG'];
  const renderList = (arr) => arr.length === 0
    ? '<p class="hint">—</p>'
    : `<ol>${arr.slice(0, 15).map(w => `<li><code>${escapeHtml(w.word)}</code> <span class="hint">G²=${w.g2.toFixed(1)}, in-class=${w.count_in_class}, rest=${w.count_in_rest}</span></li>`).join('')}</ol>`;
  el.innerHTML = `<h3>E · Top diferenciálne slová (G² log-likelihood)</h3>` +
    `<div class="grid">${classes.map(c => `
      <div>
        <h4><span class="badge ${c}">${c}</span></h4>
        <h5>v subjekte</h5>${renderList(a.keyword_stats[c].subject)}
        <h5>v správe</h5>${renderList(a.keyword_stats[c].body)}
      </div>`).join('')}</div>`;
}

// === Phase 12: Dashboard sections E (rules) + F (edge cases) ===
function renderRules(a) {
  const el = document.getElementById('rules');
  if (!a.rules.length) { el.innerHTML = '<h3>F · Navrhované pravidlá</h3><p class="hint">Žiadne pravidlá nedosiahli prahy.</p>'; return; }
  const cards = a.rules.map(r => `
    <article class="rule">
      <h4>${escapeHtml(r.id)} · <span class="badge ${r.action.classification}">${r.action.classification}</span> ${escapeHtml(r.human_readable)}</h4>
      <div class="stats">
        <span><strong>coverage:</strong> ${r.stats.coverage_percent}%</span>
        <span><strong>confidence:</strong> ${r.stats.confidence_percent}%</span>
        <span>matches: ${r.stats.matches_total}</span>
        <span>TP: ${r.stats.true_positives}</span>
        <span>FP: ${r.stats.false_positives}</span>
      </div>
      ${r.examples?.length ? `<details><summary>Príklady (${r.examples.length})</summary><ul>${r.examples.map(ex => `<li><code>${escapeHtml(ex.ticket_id)}</code> — ${escapeHtml(ex.subject)}</li>`).join('')}</ul></details>` : ''}
      ${r.false_positive_examples?.length ? `<details><summary>False positives (${r.false_positive_examples.length})</summary><ul>${r.false_positive_examples.map(ex => `<li><code>${escapeHtml(ex.ticket_id)}</code> — ${escapeHtml(ex.subject)} <em>(${ex.actual_classification})</em></li>`).join('')}</ul></details>` : ''}
    </article>`).join('');
  el.innerHTML = `<h3>F · Navrhované pravidlá (${a.rules.length})</h3>${cards}`;
}

function renderEdges(a) {
  const el = document.getElementById('edges');
  const ec = a.edge_cases;
  const idLabel = (t) => t.code ? `<code title="${escapeHtml(t.id)}">${escapeHtml(t.code)}</code>` : `<code>${escapeHtml(t.id)}</code>`;
  el.innerHTML = `
    <h3>G · Edge cases</h3>
    <p class="hint">Tickety, ktoré nepokrylo žiadne high-confidence pravidlo, alebo kde pravidlo nesúhlasí so skutočnou klasifikáciou.</p>
    <h4>Bez pravidla (vzorka ${ec.uncovered.length} z ${ec.uncovered_total})</h4>
    <ul>${ec.uncovered.map(t => `<li>${idLabel(t)} — ${escapeHtml(t.subject || '(bez subjectu)')} <em>(skut.: ${t.classification ?? 'bez kl.'})</em></li>`).join('')}</ul>
    <h4>Rozpor (vzorka ${ec.disagreements.length} z ${ec.disagreements_total})</h4>
    <ul>${ec.disagreements.map(d => `<li>${idLabel(d.ticket)} — ${escapeHtml(d.ticket.subject || '')} — pravidlo: <code>${escapeHtml(d.rule.id)}</code> hovorí <strong>${d.rule.action.classification}</strong>, skutočne: <strong>${d.ticket.classification}</strong></li>`).join('')}</ul>`;
}

// Setup form (Task 8.2)
const setupForm = document.getElementById('setup-form');
const setupStatus = document.getElementById('setup-status');

document.getElementById('test-conn').addEventListener('click', async () => {
  const fd = new FormData(setupForm);
  setupStatus.textContent = 'Testujem…';
  setupStatus.className = 'status';
  try {
    const res = await fetch('/api/test-connection', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseUrl: fd.get('baseUrl'), apiKey: fd.get('apiKey') }),
    });
    const body = await res.json();
    if (body.ok) {
      setupStatus.className = 'status ok';
      setupStatus.textContent = `OK — pripojenie funguje, dostupných ${body.agent_count} agentov.`;
    } else {
      setupStatus.className = 'status err';
      setupStatus.textContent = `Chyba: ${body.message}`;
    }
  } catch (e) {
    setupStatus.className = 'status err';
    setupStatus.textContent = `Sieťová chyba: ${e.message}`;
  }
});

setupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(setupForm);
  setupStatus.className = 'status';
  setupStatus.textContent = 'Ukladám…';
  const res = await fetch('/api/save-config', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseUrl: fd.get('baseUrl'), apiKey: fd.get('apiKey'), periodDays: Number(fd.get('periodDays')) }),
  });
  const body = await res.json();
  if (body.ok) { setupStatus.className = 'status ok'; setupStatus.textContent = 'Uložené. Pokračujte na "Stiahnuť".'; }
  else { setupStatus.className = 'status err'; setupStatus.textContent = `Chyba: ${body.message}`; }
});

// === Phase 9: Download UI ===
const dlForm = document.getElementById('download-form');
const dlLog = document.getElementById('dl-log');
const dlStart = document.getElementById('dl-start');
const dlCancel = document.getElementById('dl-cancel');
const dlProgress = document.getElementById('dl-progress');
let dlAbort = null;

function pad(n) { return String(n).padStart(2, '0'); }
function defaultFromDate(days) {
  const d = new Date(Date.now() - days * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
}

async function setDefaultDates() {
  const cfg = await fetch('/api/config').then(r => r.json());
  document.querySelector('[name=from]').value = defaultFromDate(cfg.periodDays || 180);
}
setDefaultDates();

function logLine(msg) { dlLog.textContent += msg + '\n'; dlLog.scrollTop = dlLog.scrollHeight; }

async function streamDownload(payload) {
  dlAbort = new AbortController();
  const res = await fetch('/api/download', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload), signal: dlAbort.signal,
  });
  if (!res.ok && res.headers.get('content-type')?.includes('json')) {
    const err = await res.json(); logLine(`Chyba: ${err.message}`); return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop();
    for (const chunk of chunks) {
      const lines = chunk.split('\n');
      const event = lines.find(l => l.startsWith('event: '))?.slice(7) ?? 'message';
      const data = JSON.parse(lines.find(l => l.startsWith('data: '))?.slice(6) || '{}');
      if (event === 'progress') {
        if (data.phase === 'tickets') logLine(`tickety: ${data.count}`);
        if (data.phase === 'messages') {
          logLine(`správy: ${data.done} / ${data.total}`);
          dlProgress.hidden = false; dlProgress.max = data.total; dlProgress.value = data.done;
        }
      } else if (event === 'done') {
        logLine(`HOTOVO — celkom ${data.count} ticketov${data.cancelled ? ' (zrušené)' : ''}`);
        if (data.skips || data.raw_count != null) {
          const s = data.skips ?? {};
          const byStatus = Object.entries(s.by_status ?? {}).map(([k, v]) => `status=${k}: ${v}`).join(', ');
          const parts = [
            data.raw_count != null ? `surových z API: ${data.raw_count}` : null,
            (s.deleted ?? 0) > 0 ? `deleted: ${s.deleted}` : null,
            byStatus || null,
            (s.dedup ?? 0) > 0 ? `už v cache: ${s.dedup}` : null,
          ].filter(Boolean);
          if (parts.length) logLine(`  └─ ${parts.join(' · ')}`);
        }
      } else if (event === 'error') {
        logLine(`Chyba: ${data.message}`);
      }
    }
  }
}

dlForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(dlForm);
  dlLog.textContent = '';
  dlStart.disabled = true; dlCancel.disabled = false;
  try {
    await streamDownload({
      from: `${fd.get('from')} 00:00:00`,
      to: fd.get('to') ? `${fd.get('to')} 23:59:59` : null,
      maxTickets: Number(fd.get('maxTickets')) || 5000,
    });
  } catch (e) {
    if (e.name !== 'AbortError') logLine(`Chyba: ${e.message}`);
  } finally {
    dlStart.disabled = false; dlCancel.disabled = true; dlAbort = null;
  }
});
dlCancel.addEventListener('click', () => { if (dlAbort) { dlAbort.abort(); logLine('Cancelling…'); } });

bootstrap();
