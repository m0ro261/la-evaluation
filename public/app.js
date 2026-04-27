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

// placeholder hooks; later tasks fill them
async function loadTags() { /* Task 10 */ }
async function loadDashboard() { /* Tasks 11-12 */ }

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
