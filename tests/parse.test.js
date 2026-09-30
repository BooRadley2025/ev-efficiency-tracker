import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTeslaText } from '../js/parse.js';

test('in-car Trips card (Since Last Charge)', () => {
  const r = parseTeslaText(`Trips
Since Last Charge
Distance 45.2 mi
Energy 11.1 kWh
Avg. Energy 246 Wh/mi`);
  assert.equal(r.miles, 45.2);
  assert.equal(r.energyKwh, 11.1);
  assert.equal(r.whPerMi, 246);
});

test('labels on one line and values on the next', () => {
  const r = parseTeslaText(`Distance   Energy   Avg. Energy
23.4 mi   6.1 kWh   261 Wh/mi`);
  assert.equal(r.miles, 23.4);
  assert.equal(r.energyKwh, 6.1);
  assert.equal(r.whPerMi, 261);
});

test('ignores projected range and chart window tabs', () => {
  const r = parseTeslaText(`Energy
Last 5 mi   15 mi   30 mi
Average 254 Wh/mi
Projected Range 243 mi
Trip distance 30.0 mi`);
  assert.equal(r.miles, 30);
  assert.equal(r.whPerMi, 254);
  assert.equal(r.energyKwh, 7.62); // derived: 30 * 254 / 1000
});

test('battery % with an arrow', () => {
  const r = parseTeslaText('Battery 80% → 62%\nDistance 41 mi\nEnergy used 10.5 kWh');
  assert.equal(r.startPct, 80);
  assert.equal(r.endPct, 62);
  assert.equal(r.miles, 41);
});

test('OCR noise: Wh|mi, rni, lowercase kwh', () => {
  const r = parseTeslaText('Distance 12.8 rni\nEnergy 3.4 kwh\n266 Wh|mi');
  assert.equal(r.miles, 12.8);
  assert.equal(r.energyKwh, 3.4);
  assert.equal(r.whPerMi, 266);
});

test('metric screenshot converts to miles', () => {
  const r = parseTeslaText('Distance 50.0 km\nEnergy 7.5 kWh\n150 Wh/km');
  assert.equal(r.miles, 31.1);
  assert.equal(r.whPerMi, 241);
});

test('flags disagreeing values (missed decimal point)', () => {
  const r = parseTeslaText('Distance 452 mi\nEnergy 11.1 kWh\n246 Wh/mi');
  assert.ok(r.notes.some((n) => n.includes('disagree')));
});

test('swaps percentages when listed low-to-high', () => {
  const r = parseTeslaText('55%\n78%');
  assert.equal(r.startPct, 78);
  assert.equal(r.endPct, 55);
});

test('empty text yields no fields', () => {
  assert.deepEqual(parseTeslaText('').fields, []);
});
