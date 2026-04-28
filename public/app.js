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
  // Build indicator in topbar — lets the user see at a glance whether the
  // server is running the latest code or a stale process.
  fetch('/api/version').then(r => r.json()).then(v => {
    const span = document.createElement('span');
    span.className = 'build-info';
    span.title = `started ${v.started_at}`;
    span.textContent = `build ${v.sha}`;
    document.querySelector('.topbar').appendChild(span);
  }).catch(() => {});
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
  renderAiValidation();
  renderPhrases(a);
  renderEdges(a);
}

const AI_CLASSES = ['ZP', 'TP', 'BUG', 'URGENT_BUG'];

// Cached for review browser — fetched once when AI Validation panel renders
let _aiState = { results: [], tickets: [], reviews: {}, baseUrl: '' };
let _reviewFilter = { tl: 'all', ai: 'all', minConf: 0, mode: 'disagreements' };
let _reviewLimit = 50;

async function renderAiValidation() {
  const el = document.getElementById('ai-validation');
  el.innerHTML = `<h3>I · AI · Validácia</h3><p class="hint">Načítavam predošlé výsledky…</p>`;

  const [aiRes, ticketsRes, reviewsRes, cfgRes] = await Promise.all([
    fetch('/api/ai-results').then(r => r.json()).catch(() => null),
    fetch('/api/tickets').then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('/api/disagreement-reviews').then(r => r.json()).catch(() => null),
    fetch('/api/config').then(r => r.json()).catch(() => null),
  ]);

  _aiState.results = aiRes?.results ?? [];
  _aiState.tickets = ticketsRes?.tickets ?? [];
  _aiState.reviews = reviewsRes?.reviews ?? {};
  _aiState.baseUrl = (cfgRes?.baseUrl ?? '').replace(/\/api\/v3\/?$/, '');

  const res = aiRes;
  const has = res?.results?.length > 0;
  const cm = has ? res.confusion : null;
  const cost = has ? res.cost : null;
  const usage = has ? res.usage : null;
  const accPct = cm ? Math.round(cm.accuracy * 1000) / 10 : null;

  el.innerHTML = `
    <h3>I · AI · Validácia <span class="hint" style="font-size: 12px; font-weight: normal;">(${res?.model ?? 'claude-haiku-4-5'})</span></h3>
    <p class="hint">Klasifikuj všetky tickety pomocou AI a porovnaj s manuálnou klasifikáciou TL — získaš konkrétne číslo akú časť práce by AI auto-zaklasifikovala správne.</p>
    <div class="row" style="margin-bottom: 12px;">
      <button id="ai-run" class="primary">${has ? 'Pokračovať / dorobiť chýbajúce' : 'Spustiť AI evaluáciu'}</button>
      <button id="ai-cancel" disabled>Zrušiť</button>
      <button id="ai-rerun" type="button" style="background:#fff;color:var(--warn);border:1px solid var(--warn);">Vyčistiť výsledky a začať odznova</button>
    </div>
    <pre id="ai-log" class="log" style="max-height: 200px;">${has ? `Predošlý beh: ${res.results.length} ticketov, accuracy ${accPct}%, ${cost ? '$' + cost.total_usd.toFixed(3) : ''}` : ''}</pre>
    <div id="ai-results-area">${has ? renderConfusionAndStats(cm, cost, usage, res.results) : ''}</div>
  `;

  if (has) renderReviewBrowser();

  document.getElementById('ai-run').addEventListener('click', startAiEvaluation);
  document.getElementById('ai-rerun').addEventListener('click', async () => {
    if (!confirm('Toto zmaže všetky existujúce AI výsledky a spustí beh nanovo. Pokračovať?')) return;
    await fetch('/api/ai-results-reset', { method: 'POST' }).catch(() => {});
    // Trigger fresh run by setting resume:false
    startAiEvaluation({ resume: false });
  });
}

let _aiAbort = null;

async function startAiEvaluation(opts = {}) {
  const log = document.getElementById('ai-log');
  const runBtn = document.getElementById('ai-run');
  const cancelBtn = document.getElementById('ai-cancel');
  log.textContent = '';
  runBtn.disabled = true; cancelBtn.disabled = false;
  _aiAbort = new AbortController();

  function logLine(msg) { log.textContent += msg + '\n'; log.scrollTop = log.scrollHeight; }

  try {
    const res = await fetch('/api/ai-evaluate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resume: opts.resume !== false }),
      signal: _aiAbort.signal,
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
        if (event === 'start') {
          logLine(`Štart — model: ${data.model}, total: ${data.total}, už hotových: ${data.already_evaluated}, k spracovaniu: ${data.to_process}`);
        } else if (event === 'progress') {
          if (data.done % 10 === 0 || data.done === data.total) {
            const pct = Math.round((data.done / data.total) * 100);
            const ek = data.error_kinds || {};
            const errBreak = Object.entries(ek).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(', ');
            const cost = (data.usage.input_tokens / 1e6 + data.usage.output_tokens / 1e6 * 5).toFixed(3);
            logLine(`progress: ${data.done} / ${data.total} (${pct}%) — chyby: ${data.errors}${errBreak ? ' (' + errBreak + ')' : ''}, $$~${cost}`);
          }
        } else if (event === 'done') {
          logLine(`HOTOVO — accuracy: ${(data.confusion.accuracy * 100).toFixed(1)}%, agreed: ${data.confusion.agreed}/${data.confusion.total}, errors: ${data.errors}, cost: $${data.cost.total_usd.toFixed(3)}`);
          document.getElementById('ai-results-area').innerHTML = renderConfusionAndStats(data.confusion, data.cost, data.usage, data.results);
          // Refresh state with new results, then re-render browser
          _aiState.results = data.results;
          renderReviewBrowser();
        } else if (event === 'error') {
          logLine(`ERROR: ${data.message}`);
        }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') logLine(`Chyba: ${e.message}`);
  } finally {
    runBtn.disabled = false; cancelBtn.disabled = true; _aiAbort = null;
  }
}

document.addEventListener('click', (e) => {
  if (e.target?.id === 'ai-cancel' && _aiAbort) { _aiAbort.abort(); }
});

function renderConfusionAndStats(cm, cost, usage, results) {
  if (!cm || cm.total === 0) return '<p class="hint">Žiadne výsledky.</p>';
  const accPct = (cm.accuracy * 100).toFixed(1);
  const headerCells = ['<th>actual ↓ / predicted →</th>', ...AI_CLASSES.map(c => `<th><span class="badge ${c}">${c}</span></th>`), '<th>recall</th>'].join('');
  const rows = AI_CLASSES.map(actual => {
    const cells = AI_CLASSES.map(predicted => {
      const n = cm.matrix[actual][predicted];
      const isDiag = actual === predicted;
      const bg = isDiag && n > 0 ? 'background:#e6f4e6;font-weight:600;' : (n > 0 ? 'background:#fde8e8;' : '');
      return `<td style="text-align:center;${bg}">${n}</td>`;
    }).join('');
    const r = cm.per_class[actual];
    return `<tr><th><span class="badge ${actual}">${actual}</span></th>${cells}<td>${(r.recall * 100).toFixed(1)}%</td></tr>`;
  }).join('');
  const precRow = `<tr><th>precision</th>${AI_CLASSES.map(c => `<td style="text-align:center;">${(cm.per_class[c].precision * 100).toFixed(1)}%</td>`).join('')}<td>F1 priemer: ${(AI_CLASSES.reduce((s, c) => s + cm.per_class[c].f1, 0) / 4 * 100).toFixed(1)}%</td></tr>`;

  // Sample disagreements
  const disagreements = results.filter(r => !r.error && r.actual && r.ai && r.actual !== r.ai.classification).slice(0, 8);
  const lowConf = results.filter(r => !r.error && r.ai && r.ai.confidence < 70).slice(0, 5);

  return `
    <div style="display:flex; gap:24px; align-items: flex-start; flex-wrap: wrap;">
      <div>
        <h4 style="margin: 0 0 8px;">Confusion matrix (${cm.total} klasifikovaných)</h4>
        <table style="font-size:13px;">
          <thead><tr>${headerCells}</tr></thead>
          <tbody>${rows}${precRow}</tbody>
        </table>
      </div>
      <div style="min-width:240px;">
        <h4 style="margin: 0 0 8px;">Súhrn</h4>
        <ul style="margin: 0; padding-left: 18px;">
          <li><strong>Accuracy:</strong> ${accPct}% (${cm.agreed}/${cm.total})</li>
          <li>Low-confidence (&lt; 70%): ${cm.low_confidence_count}</li>
          ${cost ? `<li><strong>Total cost:</strong> ~$${cost.total_usd.toFixed(3)}</li>` : ''}
          ${usage ? `<li>tokens in: ${usage.input_tokens.toLocaleString()}, out: ${usage.output_tokens.toLocaleString()}</li>` : ''}
          ${usage?.cache_read_input_tokens ? `<li>cache read: ${usage.cache_read_input_tokens.toLocaleString()} (~${((usage.cache_read_input_tokens || 0) / (usage.input_tokens || 1) * 100).toFixed(1)}%)</li>` : ''}
        </ul>
      </div>
    </div>

    <h4 style="margin-top: 16px;">Argumentácia pre meeting</h4>
    <p class="hint">Z ${cm.total} historicky klasifikovaných ticketov AI dosiahla zhodu <strong>${accPct}%</strong> s tvojou manuálnou klasifikáciou. Rule-based prístup pokrýval len ~5% — AI je teda <strong>~${Math.round(cm.accuracy / 0.05)}× efektívnejšia</strong> pri tej istej veľkosti datasetu.</p>

    <div id="ai-review-browser" style="margin-top: 16px; border-top: 1px solid var(--line); padding-top: 12px;"></div>`;
}

function renderReviewBrowser() {
  const el = document.getElementById('ai-review-browser');
  if (!el) return;

  const ticketById = new Map(_aiState.tickets.map(t => [t.id, t]));
  const all = _aiState.results.filter(r => !r.error && r.ai && r.actual);
  const total = all.length;

  const filtered = all.filter(r => {
    if (_reviewFilter.tl !== 'all' && r.actual !== _reviewFilter.tl) return false;
    if (_reviewFilter.ai !== 'all' && r.ai.classification !== _reviewFilter.ai) return false;
    if ((r.ai.confidence ?? 0) < _reviewFilter.minConf) return false;
    if (_reviewFilter.mode === 'disagreements' && r.actual === r.ai.classification) return false;
    if (_reviewFilter.mode === 'agreements' && r.actual !== r.ai.classification) return false;
    return true;
  });

  // Vote summary
  const votes = { tl_right: 0, ai_right: 0, ambiguous: 0 };
  for (const v of Object.values(_aiState.reviews)) if (votes[v.verdict] !== undefined) votes[v.verdict] += 1;
  const totalVoted = votes.tl_right + votes.ai_right + votes.ambiguous;

  const opt = (sel, val, label) => `<option value="${val}"${sel === val ? ' selected' : ''}>${label}</option>`;
  const classOpts = (sel) => ['all', 'ZP', 'TP', 'BUG', 'URGENT_BUG'].map(c => opt(sel, c, c)).join('');

  const slice = filtered.slice(0, _reviewLimit);

  const rows = slice.map(r => {
    const t = ticketById.get(r.ticket_id);
    const code = r.code || r.ticket_id;
    const bodySnippet = (t?.first_customer_message?.plain_text || '').slice(0, 350);
    const myVerdict = _aiState.reviews[r.ticket_id]?.verdict ?? null;
    const laUrl = _aiState.baseUrl ? `${_aiState.baseUrl}/agent/tickets/${encodeURIComponent(r.ticket_id)}` : null;
    const cls = (c) => `<span class="badge ${c}">${c}</span>`;
    const voteBtn = (verdict, label, color) => `
      <button class="vote-btn ${myVerdict === verdict ? 'active' : ''}" data-id="${escapeHtml(r.ticket_id)}" data-verdict="${verdict}"
        style="padding:2px 8px;font-size:11px;border:1px solid ${color};background:${myVerdict === verdict ? color : '#fff'};color:${myVerdict === verdict ? '#fff' : color};border-radius:3px;cursor:pointer;">
        ${label}
      </button>`;
    return `<tr>
      <td style="vertical-align:top;width:160px;">
        <div><code>${escapeHtml(code)}</code></div>
        ${laUrl ? `<a href="${laUrl}" target="_blank" rel="noopener" style="font-size:11px;">otvoriť v LA →</a>` : ''}
      </td>
      <td style="vertical-align:top;">
        <div><strong>${escapeHtml(t?.subject || r.subject || '')}</strong></div>
        ${bodySnippet ? `<div class="hint" style="font-size:12px;margin-top:4px;max-height:60px;overflow:hidden;">${escapeHtml(bodySnippet)}…</div>` : ''}
      </td>
      <td style="vertical-align:top;width:80px;">${cls(r.actual)}</td>
      <td style="vertical-align:top;width:120px;">
        ${cls(r.ai.classification)}
        <div class="hint" style="font-size:11px;">${r.ai.confidence}%</div>
      </td>
      <td style="vertical-align:top;font-size:12px;font-style:italic;">${escapeHtml(r.ai.reasoning || '')}</td>
      <td style="vertical-align:top;width:160px;">
        <div style="display:flex;flex-direction:column;gap:3px;">
          ${voteBtn('tl_right', 'TL ✓', '#287b3a')}
          ${voteBtn('ai_right', 'AI ✓', '#1b4f8c')}
          ${voteBtn('ambiguous', 'sporné', '#666')}
          ${myVerdict ? `<button class="vote-btn vote-clear" data-id="${escapeHtml(r.ticket_id)}" style="padding:2px 8px;font-size:10px;color:var(--muted);background:#fff;border:1px solid var(--line);border-radius:3px;cursor:pointer;">vymazať</button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <h4>Review browser — porovnaj a hodnoť rozpory</h4>
    <p class="hint">Filtruj rozpory, prečítaj si subject + body výňatok, pozri si AI reasoning, klikni na "TL/AI ✓" alebo "sporné" — agregát ti povie či AI naozaj robí horšie alebo či TL bol nekonzistentný.</p>

    <div class="row" style="gap:8px;margin-bottom:12px;flex-wrap:wrap;">
      <label style="font-size:12px;">TL bol:
        <select id="rv-tl">${classOpts(_reviewFilter.tl)}</select>
      </label>
      <label style="font-size:12px;">AI klasifikuje:
        <select id="rv-ai">${classOpts(_reviewFilter.ai)}</select>
      </label>
      <label style="font-size:12px;">Min confidence:
        <select id="rv-conf">
          ${[0, 50, 70, 80, 90, 95].map(v => opt(_reviewFilter.minConf, v, v + '%')).join('')}
        </select>
      </label>
      <label style="font-size:12px;">Zobraziť:
        <select id="rv-mode">
          ${opt(_reviewFilter.mode, 'disagreements', 'iba rozpory')}
          ${opt(_reviewFilter.mode, 'agreements', 'iba zhody')}
          ${opt(_reviewFilter.mode, 'all', 'všetko')}
        </select>
      </label>
      <span style="margin-left:auto;align-self:center;font-size:12px;color:var(--muted);">
        ${filtered.length} z ${total} (zobr. prvých ${slice.length})
      </span>
    </div>

    ${totalVoted > 0 ? `
    <div style="background:var(--bg);padding:8px 12px;border-radius:6px;margin-bottom:12px;font-size:13px;">
      <strong>Tvoje hodnotenie (${totalVoted} ticketov):</strong>
      &nbsp; AI ✓ <strong>${votes.ai_right}</strong> (${pct(votes.ai_right, totalVoted)}%)
      &nbsp; TL ✓ <strong>${votes.tl_right}</strong> (${pct(votes.tl_right, totalVoted)}%)
      &nbsp; sporné <strong>${votes.ambiguous}</strong> (${pct(votes.ambiguous, totalVoted)}%)
      ${votes.ai_right > votes.tl_right * 1.5 ? '<br><em style="color:var(--good);">→ AI má pravdu častejšie ako TL — silný argument že AI by automatizovala správnejšie.</em>' :
        votes.tl_right > votes.ai_right * 1.5 ? '<br><em style="color:var(--warn);">→ TL má pravdu častejšie — system prompt potrebuje doladiť firemnú konvenciu.</em>' :
        '<br><em>→ Pomer vyrovnaný — niektoré tickety sú genuinely ambiguózne, AI je solídna alternatíva.</em>'}
    </div>` : ''}

    <div style="overflow-x:auto;">
      <table style="font-size:13px;width:100%;">
        <thead><tr>
          <th style="width:160px;">ticket</th>
          <th>subject + body výňatok</th>
          <th style="width:80px;">TL</th>
          <th style="width:120px;">AI</th>
          <th>AI reasoning</th>
          <th style="width:160px;">tvoj verdikt</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="hint" style="padding:24px;text-align:center;">Žiadne tickety pri tomto filtri.</td></tr>'}</tbody>
      </table>
    </div>
    ${filtered.length > _reviewLimit ? `<div style="margin-top:12px;text-align:center;"><button id="rv-more" type="button">Zobraziť ďalších 50</button></div>` : ''}
  `;

  document.getElementById('rv-tl').addEventListener('change', (e) => { _reviewFilter.tl = e.target.value; _reviewLimit = 50; renderReviewBrowser(); });
  document.getElementById('rv-ai').addEventListener('change', (e) => { _reviewFilter.ai = e.target.value; _reviewLimit = 50; renderReviewBrowser(); });
  document.getElementById('rv-conf').addEventListener('change', (e) => { _reviewFilter.minConf = Number(e.target.value); _reviewLimit = 50; renderReviewBrowser(); });
  document.getElementById('rv-mode').addEventListener('change', (e) => { _reviewFilter.mode = e.target.value; _reviewLimit = 50; renderReviewBrowser(); });
  document.getElementById('rv-more')?.addEventListener('click', () => { _reviewLimit += 50; renderReviewBrowser(); });

  el.querySelectorAll('button.vote-btn:not(.vote-clear)').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const verdict = btn.dataset.verdict;
      _aiState.reviews[id] = { verdict, updated_at: new Date().toISOString() };
      await fetch(`/api/disagreement-reviews/${encodeURIComponent(id)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ verdict }),
      }).catch(() => {});
      renderReviewBrowser();
    });
  });
  el.querySelectorAll('button.vote-clear').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      delete _aiState.reviews[id];
      await fetch(`/api/disagreement-reviews/${encodeURIComponent(id)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ verdict: null }),
      }).catch(() => {});
      renderReviewBrowser();
    });
  });
}


let _phraseState = { search: '', filterN: 'all', minCount: 5 };

async function renderPhrases() {
  const el = document.getElementById('phrases');
  el.innerHTML = `<h3>H · Frekventné frázy (Phrase Explorer)</h3><p class="hint">Načítavam…</p>`;
  const res = await fetch(`/api/phrases?minCount=${_phraseState.minCount}&topN=300`);
  if (!res.ok) { el.innerHTML = `<h3>H · Frekventné frázy</h3><p class="hint">Najprv stiahnite tickety.</p>`; return; }
  const { phrases } = await res.json();
  const filtered = phrases.filter(p => {
    if (_phraseState.filterN !== 'all' && p.n !== Number(_phraseState.filterN)) return false;
    if (_phraseState.search && !p.phrase.includes(_phraseState.search.toLowerCase())) return false;
    return true;
  });
  const head = `<thead><tr><th>fráza</th><th>n</th><th>spolu</th><th>ZP</th><th>TP</th><th>BUG</th><th>URGENT</th><th>bez kl.</th><th>dominant</th><th>pridať ako pravidlo</th></tr></thead>`;
  const body = filtered.map(p => {
    const phr = escapeHtml(p.phrase);
    const fld = p.n === 1 ? 'subject' : 'body';
    const addBtns = ['ZP','TP','BUG','URGENT_BUG'].map(cls =>
      `<button class="phr-add" data-phrase="${phr}" data-field="subject" data-cls="${cls}" title="ako subject contains '${phr}' → ${cls}">S→${cls}</button>
       <button class="phr-add" data-phrase="${phr}" data-field="body" data-cls="${cls}" title="ako body contains '${phr}' → ${cls}">B→${cls}</button>`
    ).join(' ');
    return `<tr>
      <td><code>${phr}</code></td>
      <td>${p.n}</td>
      <td><strong>${p.total}</strong></td>
      <td>${p.by_class.ZP}</td>
      <td>${p.by_class.TP}</td>
      <td>${p.by_class.BUG}</td>
      <td>${p.by_class.URGENT_BUG}</td>
      <td>${p.unclassified}</td>
      <td>${p.dominant ? `<span class="badge ${p.dominant}">${p.dominant}</span> ${p.dominant_pct}%` : '<span class="hint">—</span>'}</td>
      <td class="phr-actions">${p.dominant ? `<button class="phr-add primary" data-phrase="${phr}" data-field="body" data-cls="${p.dominant}" title="quick add: body contains '${p.phrase}' → ${p.dominant}">+ ${p.dominant}</button>` : ''}<details><summary class="hint">viac…</summary><div class="phr-add-grid">${addBtns}</div></details></td>
    </tr>`;
  }).join('');
  el.innerHTML = `
    <h3>H · Frekventné frázy (Phrase Explorer)</h3>
    <p class="hint">Top fráz zoradené podľa raw frekvencie (uni / bi / trigramy). Zobrazené ${filtered.length} z ${phrases.length} (po filtri). Použi na prieskum patternov, ktoré algoritmus nezachytil.</p>
    <div class="row" style="margin-bottom: 12px; gap: 8px;">
      <input type="search" id="phr-search" placeholder="hľadať frázu..." value="${escapeHtml(_phraseState.search)}" style="flex: 1; max-width: 280px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px;">
      <select id="phr-n" style="padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px;">
        <option value="all"${_phraseState.filterN==='all'?' selected':''}>všetky</option>
        <option value="1"${_phraseState.filterN==='1'?' selected':''}>unigramy (1 slovo)</option>
        <option value="2"${_phraseState.filterN==='2'?' selected':''}>bigramy (2 slová)</option>
        <option value="3"${_phraseState.filterN==='3'?' selected':''}>trigramy (3 slová)</option>
      </select>
      <label style="display: flex; align-items: center; gap: 6px;">min. výskyt
        <input type="number" id="phr-min" min="1" max="100" value="${_phraseState.minCount}" style="width: 60px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px;">
      </label>
    </div>
    <div style="max-height: 600px; overflow: auto;">
      <table>${head}<tbody>${body}</tbody></table>
    </div>`;
  document.getElementById('phr-search').addEventListener('input', (e) => { _phraseState.search = e.target.value; renderPhrases(); });
  document.getElementById('phr-n').addEventListener('change', (e) => { _phraseState.filterN = e.target.value; renderPhrases(); });
  document.getElementById('phr-min').addEventListener('change', (e) => { _phraseState.minCount = Math.max(1, Number(e.target.value) || 5); renderPhrases(); });
  el.querySelectorAll('button.phr-add').forEach(btn => {
    btn.addEventListener('click', async () => {
      const phrase = btn.dataset.phrase;
      const field = btn.dataset.field;
      const cls = btn.dataset.cls;
      btn.disabled = true; btn.textContent = '…';
      const r = await fetch('/api/manual-rules', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field, value: phrase, classification: cls }),
      });
      const body = await r.json();
      if (body.ok) {
        btn.textContent = '✓';
        // Re-load entire dashboard to surface the new rule + updated metrics
        loadDashboard();
      } else {
        btn.disabled = false;
        btn.textContent = `chyba: ${body.message}`;
      }
    });
  });
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
function confidenceTier(pct) {
  if (pct >= 90) return { tier: 'high', label: '🟢 deploy', hint: 'spoľahlivé na nasadenie' };
  if (pct >= 80) return { tier: 'mid', label: '🟡 caution', hint: 'nasadiť s pozorovaním FP' };
  return { tier: 'low', label: '🔴 review', hint: 'pred nasadením prejsť s TL' };
}

function ruleCardHtml(r) {
  const idCode = (ex) => ex.code ? `<code title="${escapeHtml(ex.ticket_id)}">${escapeHtml(ex.code)}</code>` : `<code>${escapeHtml(ex.ticket_id)}</code>`;
  const sourceBadge = r.source === 'manual' ? '<span class="source-badge manual">manual</span>' : '<span class="source-badge">auto</span>';
  const tier = confidenceTier(r.stats.confidence_percent);
  const tierBadge = `<span class="conf-tier conf-${tier.tier}" title="${tier.hint}">${tier.label}</span>`;
  // For manual rules: dropdown to change classification + delete button
  const manualControls = r.manual_id ? `
    <div class="manual-controls" style="float:right;display:flex;gap:6px;align-items:center;">
      <select class="rule-class-edit" data-id="${escapeHtml(r.manual_id)}" data-current="${r.action.classification}" title="zmeniť klasifikáciu">
        ${['ZP','TP','BUG','URGENT_BUG'].map(c => `<option value="${c}"${c === r.action.classification ? ' selected' : ''}>${c}</option>`).join('')}
      </select>
      <button class="rule-delete" data-id="${escapeHtml(r.manual_id)}" style="background:#fff;color:#af2600;border:1px solid #af2600;font-size:11px;padding:2px 8px;">odstrániť</button>
    </div>` : '';
  return `
    <article class="rule conf-${tier.tier}">
      <h4>${escapeHtml(r.id)} · <span class="badge ${r.action.classification}">${r.action.classification}</span> ${escapeHtml(r.human_readable)} ${tierBadge}${sourceBadge}${manualControls}</h4>
      <div class="stats">
        <span><strong>coverage:</strong> ${r.stats.coverage_percent}%</span>
        <span><strong>confidence:</strong> ${r.stats.confidence_percent}%</span>
        <span>matches: ${r.stats.matches_total}</span>
        <span>TP: ${r.stats.true_positives}</span>
        <span>FP: ${r.stats.false_positives}</span>
        ${r.stats.unclassified_matches != null ? `<span>bez kl.: ${r.stats.unclassified_matches}</span>` : ''}
      </div>
      ${r.examples?.length ? `<details><summary>Príklady (${r.examples.length})</summary><ul>${r.examples.map(ex => `<li>${idCode(ex)} — ${escapeHtml(ex.subject)}</li>`).join('')}</ul></details>` : ''}
      ${r.false_positive_examples?.length ? `<details><summary>False positives (${r.false_positive_examples.length})</summary><ul>${r.false_positive_examples.map(ex => `<li>${idCode(ex)} — ${escapeHtml(ex.subject)} <em>(${ex.actual_classification})</em></li>`).join('')}</ul></details>` : ''}
    </article>`;
}

function renderRules(a) {
  const el = document.getElementById('rules');
  const manual = a.rules.filter(r => r.source === 'manual');
  const auto = a.rules.filter(r => r.source !== 'manual');
  if (!a.rules.length) {
    el.innerHTML = '<h3>F · Navrhované pravidlá</h3><p class="hint">Žiadne pravidlá. Pozri sekciu H · Frekventné frázy a pridaj manuálne pravidlá kliknutím na "+".</p>';
    return;
  }
  let html = `<h3>F · Navrhované pravidlá (${a.rules.length})</h3>`;
  if (manual.length) {
    html += `<h4 style="margin: 16px 0 8px; color: var(--accent);">Vaše manuálne pravidlá (${manual.length})</h4>`;
    html += manual.map(ruleCardHtml).join('');
  }
  if (auto.length) {
    html += `<h4 style="margin: 16px 0 8px;">Auto-generované (${auto.length})</h4>`;
    html += auto.map(ruleCardHtml).join('');
  }
  el.innerHTML = html;
  el.querySelectorAll('button.rule-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Odstrániť toto manuálne pravidlo?')) return;
      btn.disabled = true;
      const r = await fetch(`/api/manual-rules/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
      if (r.ok) loadDashboard();
      else { btn.disabled = false; alert('Mazanie zlyhalo.'); }
    });
  });
  el.querySelectorAll('select.rule-class-edit').forEach(sel => {
    sel.addEventListener('change', async () => {
      const newCls = sel.value;
      const id = sel.dataset.id;
      sel.disabled = true;
      const r = await fetch(`/api/manual-rules/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ classification: newCls }),
      });
      if (r.ok) loadDashboard();
      else { sel.disabled = false; sel.value = sel.dataset.current; alert('Zmena zlyhala.'); }
    });
  });
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

// === AI config form ===
const aiForm = document.getElementById('ai-config-form');
const aiStatus = document.getElementById('ai-status');

document.getElementById('ai-test').addEventListener('click', async () => {
  const fd = new FormData(aiForm);
  const apiKey = fd.get('aiApiKey');
  if (!apiKey) { aiStatus.className = 'status err'; aiStatus.textContent = 'Najprv vyplň API key.'; return; }
  aiStatus.className = 'status'; aiStatus.textContent = 'Testujem AI…';
  try {
    const res = await fetch('/api/ai-test', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
    const body = await res.json();
    if (body.ok) {
      aiStatus.className = 'status ok';
      aiStatus.textContent = `OK — testovacia odpoveď: "${body.sample.classification}" (confidence ${body.sample.confidence}%, ${body.sample.usage.input_tokens}/${body.sample.usage.output_tokens} tokens)`;
    } else {
      aiStatus.className = 'status err';
      aiStatus.textContent = `Chyba: ${body.message}`;
    }
  } catch (e) {
    aiStatus.className = 'status err';
    aiStatus.textContent = `Sieťová chyba: ${e.message}`;
  }
});

aiForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(aiForm);
  aiStatus.className = 'status'; aiStatus.textContent = 'Ukladám…';
  const res = await fetch('/api/save-ai-config', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey: fd.get('aiApiKey'), model: fd.get('aiModel') }),
  });
  const body = await res.json();
  if (body.ok) { aiStatus.className = 'status ok'; aiStatus.textContent = 'AI config uložený.'; }
  else { aiStatus.className = 'status err'; aiStatus.textContent = `Chyba: ${body.message}`; }
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
    const statusList = String(fd.get('skippedStatuses') || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    await streamDownload({
      from: `${fd.get('from')} 00:00:00`,
      to: fd.get('to') ? `${fd.get('to')} 23:59:59` : null,
      maxTickets: Number(fd.get('maxTickets')) || 5000,
      skipDeleted: fd.get('skipDeleted') === 'on',
      skippedStatuses: statusList,
    });
  } catch (e) {
    if (e.name !== 'AbortError') logLine(`Chyba: ${e.message}`);
  } finally {
    dlStart.disabled = false; dlCancel.disabled = true; dlAbort = null;
  }
});
dlCancel.addEventListener('click', () => { if (dlAbort) { dlAbort.abort(); logLine('Cancelling…'); } });

bootstrap();
