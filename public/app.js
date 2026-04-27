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

bootstrap();
