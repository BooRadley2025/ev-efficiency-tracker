// Trips and settings are saved in this browser's localStorage.
// Use Export in Settings to back up or move them to another device.

import { DEFAULT_SETTINGS } from './calc.js';

const TRIPS_KEY = 'evtracker.trips.v1';
const SETTINGS_KEY = 'evtracker.settings.v1';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadTrips = () => read(TRIPS_KEY, []);
export const saveTrips = (trips) => write(TRIPS_KEY, trips);
export const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...read(SETTINGS_KEY, {}) });
export const saveSettings = (s) => write(SETTINGS_KEY, s);

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const CSV_COLUMNS = [
  ['date', 'Date'],
  ['name', 'Trip'],
  ['miles', 'Miles'],
  ['startPct', 'Start %'],
  ['endPct', 'End %'],
  ['energyKwh', 'Energy entered (kWh)'],
];

export function toCsv(trips, computeTrip) {
  const metricCols = [
    ['batteryKwh', 'Battery kWh'],
    ['whPerMi', 'Wh/mi'],
    ['miPerKwh', 'mi/kWh'],
    ['wallKwh', 'Wall kWh'],
    ['lossKwh', 'Charging loss kWh'],
    ['cost', 'EV cost $'],
    ['costPerMile', 'EV $/mi'],
    ['lossCost', 'Charging loss $'],
    ['gasCost', 'Gas cost $'],
    ['savings', 'Savings $'],
    ['mpge', 'MPGe'],
  ];
  const rateCols = [
    ['electricityRate', '$/kWh'],
    ['chargingEfficiency', 'Charging eff %'],
    ['gasMpg', 'Gas MPG'],
    ['gasPrice', 'Gas $/gal'],
    ['batteryKwh', 'Battery size kWh'],
  ];
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? String(Math.round(v * 10000) / 10000) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [...CSV_COLUMNS, ...metricCols, ...rateCols].map(([, label]) => label);
  const rows = trips.map((t) => {
    const r = computeTrip(t, t.rates);
    return [
      ...CSV_COLUMNS.map(([k]) => t[k]),
      ...metricCols.map(([k]) => (r.valid ? r[k] : '')),
      ...rateCols.map(([k]) => t.rates?.[k]),
    ].map(esc);
  });
  return [header.map(esc), ...rows].map((r) => r.join(',')).join('\n');
}

export function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
