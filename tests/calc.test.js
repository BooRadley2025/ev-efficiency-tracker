import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTrip, summarize } from '../js/calc.js';

const rates = { batteryKwh: 75, electricityRate: 0.15, chargingEfficiency: 90, gasMpg: 30, gasPrice: 3.5 };
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('entered energy drives efficiency and cost', () => {
  const r = computeTrip({ miles: 40, energyKwh: 10 }, rates);
  assert.equal(r.valid, true);
  assert.equal(r.energySource, 'entered');
  close(r.whPerMi, 250);
  close(r.miPerKwh, 4);
  close(r.wallKwh, 10 / 0.9);
  close(r.lossKwh, 10 / 0.9 - 10);
  close(r.cost, (10 / 0.9) * 0.15);
  close(r.costPerMile, (10 / 0.9) * 0.15 / 40);
  close(r.lossCost, (10 / 0.9 - 10) * 0.15);
  close(r.gasCost, (40 / 30) * 3.5);
  close(r.savings, (40 / 30) * 3.5 - (10 / 0.9) * 0.15);
  close(r.mpge, 40 / ((10 / 0.9) / 33.7));
});

test('falls back to battery % × capacity', () => {
  const r = computeTrip({ miles: 60, startPct: 80, endPct: 60 }, rates);
  assert.equal(r.energySource, 'battery %');
  close(r.batteryKwh, 15);
  close(r.whPerMi, 250);
  close(r.miPerPct, 3);
});

test('warns when entered kWh and battery % disagree a lot', () => {
  const r = computeTrip({ miles: 60, startPct: 80, endPct: 60, energyKwh: 8 }, rates);
  assert.equal(r.batteryKwh, 8);
  assert.equal(r.warnings.length, 1);
});

test('rising battery % is ignored with a warning', () => {
  const r = computeTrip({ miles: 20, startPct: 50, endPct: 70 }, rates);
  assert.equal(r.valid, false);
  assert.ok(r.warnings[0].includes('higher'));
});

test('invalid without miles', () => {
  assert.equal(computeTrip({ energyKwh: 5 }, rates).valid, false);
});

test('summary averages are weighted by miles', () => {
  const s = summarize([
    { miles: 10, energyKwh: 4, rates }, // 400 Wh/mi
    { miles: 90, energyKwh: 18, rates }, // 200 Wh/mi
    { miles: 0, energyKwh: 1, rates }, // invalid, skipped
  ]);
  assert.equal(s.count, 2);
  close(s.whPerMi, 220);
  close(s.miles, 100);
});
