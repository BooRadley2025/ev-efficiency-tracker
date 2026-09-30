import { computeTrip, summarize, RATE_KEYS, toNumber } from './calc.js';
import { parseTeslaText } from './parse.js';
import { loadTrips, saveTrips, loadSettings, saveSettings, newId, toCsv, download } from './storage.js';

// Approximate usable capacity. Varies by year and pack, and drops as the battery ages.
const PRESETS = [
  ['Custom', null],
  ['Model 3 RWD (LFP)', 57.5],
  ['Model 3 Long Range / Performance', 75],
  ['Model 3 Long Range (2024+)', 78],
  ['Model Y RWD (LFP)', 60],
  ['Model Y Long Range / Performance', 75],
  ['Model Y Long Range (2025+)', 78],
  ['Model S', 95],
  ['Model X', 95],
  ['Cybertruck', 123],
];

const TRIP_FIELDS = ['date', 'name', 'miles', 'startPct', 'endPct', 'energyKwh', 'notes'];

let trips = loadTrips();
let settings = loadSettings();
let editingId = null;

const $ = (sel, root = document) => root.querySelector(sel);
const form = $('#trip-form');
const settingsForm = $('#settings-form');

// ---------- formatting ----------
const fmt = {
  n: (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })),
  usd: (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : (v < 0 ? '−$' : '$') + Math.abs(v).toFixed(d)),
  cents: (v) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : `${(v * 100).toFixed(1)}¢`),
  date: (s) => (s ? new Date(s + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''),
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 2600);
}

const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const currentRates = () => Object.fromEntries(RATE_KEYS.map((k) => [k, settings[k]]));

// ---------- result rendering (shared by the live preview and trip details) ----------
function tilesHtml(r) {
  const savingsClass = r.savings === null ? '' : r.savings >= 0 ? 'good' : 'bad';
  return `
    <div class="tiles">
      <div class="tile"><div class="v">${fmt.n(r.whPerMi, 0)}</div><div class="k">Wh/mi</div></div>
      <div class="tile"><div class="v">${fmt.n(r.miPerKwh, 2)}</div><div class="k">mi/kWh</div></div>
      <div class="tile"><div class="v">${fmt.cents(r.costPerMile)}</div><div class="k">Cost / mi</div></div>
      <div class="tile"><div class="v">${fmt.usd(r.cost)}</div><div class="k">Trip cost</div></div>
      <div class="tile"><div class="v">${fmt.usd(r.gasCost)}</div><div class="k">Gas cost</div></div>
      <div class="tile ${savingsClass}"><div class="v">${fmt.usd(r.savings)}</div><div class="k">Saved</div></div>
    </div>`;
}

function detailHtml(r, rates) {
  const eff = toNumber(rates.chargingEfficiency);
  return `
    <table class="detail">
      <tr class="section"><td colspan="2">Energy</td></tr>
      <tr><td>Battery energy used<span class="sub">${r.energySource === 'entered' ? 'as entered' : `${fmt.n(r.pctUsed, 0)}% of ${fmt.n(toNumber(rates.batteryKwh), 1)} kWh`}</span></td><td>${fmt.n(r.batteryKwh, 2)} kWh</td></tr>
      ${r.energySource === 'entered' && r.kwhFromPct !== null ? `<tr><td>From battery % instead<span class="sub">for comparison</span></td><td>${fmt.n(r.kwhFromPct, 2)} kWh</td></tr>` : ''}
      <tr><td>Energy from the wall<span class="sub">at ${fmt.n(eff, 0)}% charging efficiency</span></td><td>${fmt.n(r.wallKwh, 2)} kWh</td></tr>
      ${r.miPerPct !== null ? `<tr><td>Miles per 1% of battery</td><td>${fmt.n(r.miPerPct, 2)} mi</td></tr>` : ''}
      <tr><td>MPGe<span class="sub">counting charging losses</span></td><td>${fmt.n(r.mpge, 0)}</td></tr>

      <tr class="section"><td colspan="2">Charging losses</td></tr>
      <tr><td>Extra energy lost while charging</td><td>${fmt.n(r.lossKwh, 2)} kWh</td></tr>
      <tr><td>Cost of that extra energy</td><td>${fmt.usd(r.lossCost)}</td></tr>

      <tr class="section"><td colspan="2">Cost</td></tr>
      <tr><td>EV cost<span class="sub">${fmt.n(r.wallKwh, 2)} kWh × ${fmt.usd(toNumber(rates.electricityRate), 3)}</span></td><td>${fmt.usd(r.cost)}</td></tr>
      <tr><td>Gas car cost<span class="sub">${fmt.n(r.gasGallons, 2)} gal at ${fmt.n(toNumber(rates.gasMpg), 0)} MPG × ${fmt.usd(toNumber(rates.gasPrice))}</span></td><td>${fmt.usd(r.gasCost)}</td></tr>
      <tr><td>Gas cost / mi</td><td>${fmt.cents(r.gasCostPerMile)}</td></tr>
      <tr><td>You saved</td><td>${fmt.usd(r.savings)}${r.savingsPct !== null ? ` (${fmt.n(r.savingsPct * 100, 0)}%)` : ''}</td></tr>
    </table>
    ${r.warnings.map((w) => `<div class="warning">${esc(w)}</div>`).join('')}`;
}

// ---------- log form ----------
function readForm() {
  const fd = new FormData(form);
  return Object.fromEntries(TRIP_FIELDS.map((k) => [k, (fd.get(k) ?? '').toString().trim()]));
}

function editingRates() {
  if (!editingId) return currentRates();
  return trips.find((t) => t.id === editingId)?.rates ?? currentRates();
}

function renderLive() {
  const data = readForm();
  const box = $('#live-results');
  const anyInput = data.miles || data.startPct || data.endPct || data.energyKwh;
  if (!anyInput) {
    box.innerHTML = '';
    return;
  }
  const rates = editingRates();
  const r = computeTrip(data, rates);
  box.innerHTML = r.valid
    ? tilesHtml(r) + detailHtml(r, rates)
    : `<div class="empty-msg">${esc(r.reason)}</div>${r.warnings.map((w) => `<div class="warning">${esc(w)}</div>`).join('')}`;
}

function resetForm() {
  form.reset();
  form.elements.date.value = today();
  editingId = null;
  $('#form-title').textContent = 'Log a trip';
  $('#save-btn').textContent = 'Save trip';
  $('#cancel-edit').hidden = true;
  form.querySelectorAll('.from-scan').forEach((el) => el.classList.remove('from-scan'));
  renderLive();
}

form.addEventListener('input', (e) => {
  e.target.classList?.remove('from-scan');
  renderLive();
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = readForm();
  const r = computeTrip(data, editingRates());
  if (!r.valid) {
    toast(r.reason);
    return;
  }
  if (editingId) {
    const t = trips.find((x) => x.id === editingId);
    Object.assign(t, data, { updatedAt: new Date().toISOString() });
    toast('Trip updated');
  } else {
    trips.push({ id: newId(), ...data, rates: currentRates(), createdAt: new Date().toISOString() });
    toast(`Saved: ${fmt.n(r.whPerMi, 0)} Wh/mi, ${fmt.usd(r.cost)}`);
  }
  persistTrips();
  resetForm();
  $('#scan-status').hidden = true;
  renderAll();
});

$('#cancel-edit').addEventListener('click', resetForm);

// ---------- screenshot scan ----------
$('#scan-input').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;

  const status = $('#scan-status');
  const bar = $('#scan-bar');
  const label = $('#scan-label');
  const notes = $('#scan-notes');
  status.hidden = false;
  notes.innerHTML = '';
  $('#scan-raw-wrap').hidden = true;
  $('#scan-preview').src = URL.createObjectURL(file);
  bar.style.width = '2%';
  label.textContent = 'Preparing image…';

  try {
    const { readScreenshot } = await import('./ocr.js');
    const { text } = await readScreenshot(file, (p, l) => {
      bar.style.width = `${Math.round(p * 100)}%`;
      label.textContent = l;
    });
    $('#scan-raw').textContent = text.trim() || '(no text found)';
    $('#scan-raw-wrap').hidden = false;

    const parsed = parseTeslaText(text);
    form.querySelectorAll('.from-scan').forEach((el) => el.classList.remove('from-scan'));
    for (const k of parsed.fields) {
      form.elements[k].value = parsed[k];
      form.elements[k].classList.add('from-scan');
    }
    if (!form.elements.date.value) form.elements.date.value = today();

    const found = parsed.fields.length;
    label.textContent = found
      ? `Filled in ${found} field${found > 1 ? 's' : ''}. Check the green fields before saving.`
      : "Couldn't find any trip values. Try a sharper screenshot or crop it to the trip card.";
    const items = [...parsed.notes];
    if (parsed.whPerMi) items.unshift(`The screenshot shows ${parsed.whPerMi} Wh/mi.`);
    notes.innerHTML = items.map((n) => `<li class="${/disagree|one battery/i.test(n) ? 'warn' : ''}">${esc(n)}</li>`).join('');
    renderLive();
  } catch (err) {
    label.textContent = err.message || 'Scanning failed.';
    bar.style.width = '0';
  }
});

// ---------- trip list ----------
function sortedTrips() {
  return [...trips].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function renderTrips() {
  const list = $('#trip-list');
  if (!trips.length) {
    list.innerHTML = `<div class="empty">No trips yet.<br />Log one on the <strong>Log</strong> tab.</div>`;
    return;
  }
  list.innerHTML = sortedTrips()
    .map((t) => {
      const r = computeTrip(t, t.rates);
      const title = t.name || `${fmt.n(toNumber(t.miles), 1)} mi trip`;
      return `
      <details class="trip" data-id="${t.id}">
        <summary>
          <div>
            <div class="trip-title">${esc(title)}</div>
            <div class="trip-sub">${fmt.date(t.date)} · ${fmt.n(toNumber(t.miles), 1)} mi${t.notes ? ' · ' + esc(t.notes) : ''}</div>
          </div>
          <div class="trip-right">
            <div class="big">${r.valid ? fmt.n(r.whPerMi, 0) + ' Wh/mi' : '–'}</div>
            <div class="trip-sub">${r.valid ? fmt.usd(r.cost) + ' · saved ' + fmt.usd(r.savings) : ''}</div>
          </div>
        </summary>
        <div class="trip-body">
          ${r.valid ? tilesHtml(r) + detailHtml(r, t.rates) : `<div class="warning">${esc(r.reason)}</div>`}
          <div class="trip-actions">
            <button type="button" class="secondary edit" data-id="${t.id}">Edit</button>
            <button type="button" class="secondary del" data-id="${t.id}">Delete</button>
          </div>
        </div>
      </details>`;
    })
    .join('');
}

$('#trip-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const t = trips.find((x) => x.id === btn.dataset.id);
  if (!t) return;
  if (btn.classList.contains('del')) {
    if (!confirm(`Delete "${t.name || fmt.date(t.date) + ' trip'}"?`)) return;
    trips = trips.filter((x) => x.id !== t.id);
    persistTrips();
    renderAll();
    toast('Trip deleted');
  } else if (btn.classList.contains('edit')) {
    resetForm();
    editingId = t.id;
    for (const k of TRIP_FIELDS) form.elements[k].value = t[k] ?? '';
    $('#form-title').textContent = 'Edit trip';
    $('#save-btn').textContent = 'Update trip';
    $('#cancel-edit').hidden = false;
    renderLive();
    showView('log');
  }
});

// ---------- summary ----------
function renderSummary() {
  const el = $('#summary');
  const s = summarize(trips);
  if (!s.count) {
    el.innerHTML = `<div class="empty">Your totals will show up here once you've logged a trip.</div>`;
    return;
  }
  const valid = trips.map((t) => ({ t, r: computeTrip(t, t.rates) })).filter((x) => x.r.valid);
  const best = valid.reduce((a, b) => (b.r.whPerMi < a.r.whPerMi ? b : a));
  const worst = valid.reduce((a, b) => (b.r.whPerMi > a.r.whPerMi ? b : a));
  const label = ({ t }) => esc(t.name || fmt.date(t.date));

  el.innerHTML = `
    <div class="card">
      <h2>All trips (${s.count})</h2>
      <div class="tiles">
        <div class="tile"><div class="v">${fmt.n(s.whPerMi, 0)}</div><div class="k">Avg Wh/mi</div></div>
        <div class="tile"><div class="v">${fmt.n(s.miPerKwh, 2)}</div><div class="k">Avg mi/kWh</div></div>
        <div class="tile"><div class="v">${fmt.cents(s.costPerMile)}</div><div class="k">Cost / mi</div></div>
        <div class="tile"><div class="v">${fmt.n(s.miles, 0)}</div><div class="k">Miles</div></div>
        <div class="tile"><div class="v">${fmt.usd(s.cost)}</div><div class="k">EV cost</div></div>
        <div class="tile ${s.savings >= 0 ? 'good' : 'bad'}"><div class="v">${fmt.usd(s.savings)}</div><div class="k">Saved</div></div>
      </div>
      <table class="detail">
        <tr class="section"><td colspan="2">Energy</td></tr>
        <tr><td>Battery energy used</td><td>${fmt.n(s.batteryKwh, 1)} kWh</td></tr>
        <tr><td>Energy from the wall</td><td>${fmt.n(s.wallKwh, 1)} kWh</td></tr>
        <tr><td>MPGe</td><td>${fmt.n(s.mpge, 0)}</td></tr>
        <tr class="section"><td colspan="2">Charging losses</td></tr>
        <tr><td>Extra energy lost while charging</td><td>${fmt.n(s.lossKwh, 1)} kWh</td></tr>
        <tr><td>Cost of that extra energy</td><td>${fmt.usd(s.lossCost)}</td></tr>
        <tr class="section"><td colspan="2">Gas car comparison</td></tr>
        <tr><td>Gas the comparison car would use</td><td>${fmt.n(s.gasGallons, 1)} gal</td></tr>
        <tr><td>Gas cost</td><td>${fmt.usd(s.gasCost)}</td></tr>
        <tr><td>Gas cost / mi</td><td>${fmt.cents(s.gasCostPerMile)}</td></tr>
        <tr class="section"><td colspan="2">Records</td></tr>
        <tr><td>Most efficient<span class="sub">${label(best)}</span></td><td>${fmt.n(best.r.whPerMi, 0)} Wh/mi</td></tr>
        <tr><td>Least efficient<span class="sub">${label(worst)}</span></td><td>${fmt.n(worst.r.whPerMi, 0)} Wh/mi</td></tr>
      </table>
    </div>`;
}

// ---------- settings ----------
function fillSettingsForm() {
  const sel = $('#preset');
  sel.innerHTML = PRESETS.map(([name, kwh], i) => `<option value="${i}">${esc(name)}${kwh ? ` (~${kwh} kWh)` : ''}</option>`).join('');
  const match = PRESETS.findIndex(([, kwh]) => kwh === toNumber(settings.batteryKwh));
  sel.value = String(match > 0 ? match : 0);
  for (const k of RATE_KEYS) settingsForm.elements[k].value = settings[k];
}

$('#preset').addEventListener('change', (e) => {
  const kwh = PRESETS[+e.target.value][1];
  if (kwh) settingsForm.elements.batteryKwh.value = kwh;
});
settingsForm.elements.batteryKwh.addEventListener('input', () => {
  const match = PRESETS.findIndex(([, kwh]) => kwh === toNumber(settingsForm.elements.batteryKwh.value));
  $('#preset').value = String(match > 0 ? match : 0);
});

function readSettingsForm() {
  const next = { ...settings };
  for (const k of RATE_KEYS) {
    const v = toNumber(settingsForm.elements[k].value);
    if (v !== null && v >= 0) next[k] = v;
  }
  next.chargingEfficiency = Math.min(100, Math.max(50, next.chargingEfficiency));
  return next;
}

settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  settings = readSettingsForm();
  saveSettings(settings);
  fillSettingsForm();
  renderLive();
  toast('Settings saved. New trips will use these rates.');
});

$('#apply-all').addEventListener('click', () => {
  settings = readSettingsForm();
  saveSettings(settings);
  if (!trips.length) return toast('No trips to update');
  if (!confirm(`Recalculate all ${trips.length} trips with the current rates?`)) return;
  trips.forEach((t) => (t.rates = currentRates()));
  persistTrips();
  renderAll();
  toast('All trips recalculated');
});

// ---------- data ----------
function persistTrips() {
  if (!saveTrips(trips)) toast("Couldn't save. Is browser storage turned off?");
}

$('#export-csv').addEventListener('click', () => {
  if (!trips.length) return toast('No trips to export');
  download(`ev-trips-${today()}.csv`, toCsv(sortedTrips(), computeTrip), 'text/csv');
});
$('#export-json').addEventListener('click', () => {
  download(`ev-tracker-backup-${today()}.json`, JSON.stringify({ version: 1, settings, trips }, null, 2), 'application/json');
});
$('#import-json').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.trips)) throw new Error('bad file');
    const existing = new Set(trips.map((t) => t.id));
    const incoming = data.trips.filter((t) => t && t.id && !existing.has(t.id));
    trips.push(...incoming);
    persistTrips();
    if (data.settings && confirm('Also restore the settings from this backup?')) {
      settings = { ...settings, ...data.settings };
      saveSettings(settings);
      fillSettingsForm();
    }
    renderAll();
    toast(`Restored ${incoming.length} trip${incoming.length === 1 ? '' : 's'}`);
  } catch {
    toast("That doesn't look like an EV Tracker backup file");
  }
});
$('#clear-all').addEventListener('click', () => {
  if (!trips.length) return;
  if (!confirm(`Permanently delete all ${trips.length} trips? Export a backup first if you want to keep them.`)) return;
  trips = [];
  persistTrips();
  renderAll();
  toast('All trips deleted');
});

// ---------- navigation ----------
function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.tabbar button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === name)));
  window.scrollTo({ top: 0 });
}
document.querySelector('.tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b) showView(b.dataset.view);
});

function renderAll() {
  renderTrips();
  renderSummary();
}

// ---------- boot ----------
fillSettingsForm();
resetForm();
renderAll();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
