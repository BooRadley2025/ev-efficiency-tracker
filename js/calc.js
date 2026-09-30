// Pure trip math. No DOM access, so it can be unit-tested in Node.

// EPA's energy equivalent of one gallon of gasoline, used for MPGe.
export const KWH_PER_GALLON_EQUIV = 33.7;
export const MI_PER_KM = 0.621371;

export const DEFAULT_SETTINGS = {
  batteryKwh: 75, // usable pack capacity, used to turn battery % into kWh
  electricityRate: 0.15, // $/kWh at the wall
  chargingEfficiency: 90, // % of wall energy that reaches the battery
  gasMpg: 30,
  gasPrice: 3.5, // $/gal
};

// The settings that affect a trip's cost; each trip keeps its own copy.
export const RATE_KEYS = Object.keys(DEFAULT_SETTINGS);

export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Compute every metric for one trip.
 * trip: { miles, startPct, endPct, energyKwh } (energyKwh optional if both % are present)
 * rates: settings-shaped object (see DEFAULT_SETTINGS)
 */
export function computeTrip(trip, rates = DEFAULT_SETTINGS) {
  const r = { ...DEFAULT_SETTINGS, ...rates };
  const miles = toNumber(trip.miles);
  const startPct = toNumber(trip.startPct);
  const endPct = toNumber(trip.endPct);
  const enteredKwh = toNumber(trip.energyKwh);
  const capacity = toNumber(r.batteryKwh);

  const warnings = [];
  const pctUsed = startPct !== null && endPct !== null ? startPct - endPct : null;
  if (pctUsed !== null && pctUsed < 0) {
    warnings.push('Ending % is higher than starting % (charged mid-trip?). Battery % was not used for energy.');
  }
  const kwhFromPct = pctUsed !== null && pctUsed > 0 && capacity ? (pctUsed / 100) * capacity : null;

  let batteryKwh = null;
  let energySource = null;
  if (enteredKwh !== null && enteredKwh > 0) {
    batteryKwh = enteredKwh;
    energySource = 'entered';
  } else if (kwhFromPct !== null) {
    batteryKwh = kwhFromPct;
    energySource = 'battery %';
  }

  if (!miles || miles <= 0 || !batteryKwh) {
    return {
      valid: false,
      reason: !miles || miles <= 0 ? 'Enter miles driven.' : 'Enter energy used, or both starting and ending battery %.',
      warnings,
    };
  }

  // Cross-check the entered kWh against what the battery % implies.
  if (energySource === 'entered' && kwhFromPct !== null) {
    const diff = Math.abs(kwhFromPct - enteredKwh) / enteredKwh;
    if (diff > 0.25) {
      warnings.push(
        `Battery % implies ${kwhFromPct.toFixed(1)} kWh, but ${enteredKwh.toFixed(1)} kWh was entered. ` +
          'Check the battery size in Settings. Small % changes are imprecise on short trips.'
      );
    }
  }

  const efficiency = Math.min(Math.max(toNumber(r.chargingEfficiency) || 100, 1), 100) / 100;
  const wallKwh = batteryKwh / efficiency;
  const lossKwh = wallKwh - batteryKwh;
  const rate = toNumber(r.electricityRate) || 0;
  const cost = wallKwh * rate;

  const mpg = toNumber(r.gasMpg);
  const gasPrice = toNumber(r.gasPrice) || 0;
  const gasGallons = mpg ? miles / mpg : null;
  const gasCost = gasGallons !== null ? gasGallons * gasPrice : null;
  const savings = gasCost !== null ? gasCost - cost : null;

  return {
    valid: true,
    warnings,
    miles,
    pctUsed: pctUsed !== null && pctUsed > 0 ? pctUsed : null,
    batteryKwh,
    energySource,
    kwhFromPct,
    whPerMi: (batteryKwh * 1000) / miles,
    miPerKwh: miles / batteryKwh,
    miPerPct: pctUsed > 0 ? miles / pctUsed : null,
    wallKwh,
    lossKwh,
    cost,
    costPerMile: cost / miles,
    lossCost: lossKwh * rate,
    mpge: miles / (wallKwh / KWH_PER_GALLON_EQUIV),
    gasGallons,
    gasCost,
    gasCostPerMile: gasCost !== null ? gasCost / miles : null,
    savings,
    savingsPct: gasCost ? savings / gasCost : null,
  };
}

/** Totals across trips. Averages are weighted by miles, not per-trip means. */
export function summarize(trips) {
  const results = trips.map((t) => computeTrip(t, t.rates)).filter((r) => r.valid);
  const sum = (key) => results.reduce((acc, r) => acc + (r[key] ?? 0), 0);
  const miles = sum('miles');
  const batteryKwh = sum('batteryKwh');
  const wallKwh = sum('wallKwh');
  const cost = sum('cost');
  const gasCost = sum('gasCost');
  return {
    count: results.length,
    miles,
    batteryKwh,
    wallKwh,
    lossKwh: sum('lossKwh'),
    lossCost: sum('lossCost'),
    cost,
    gasCost,
    gasGallons: sum('gasGallons'),
    savings: gasCost - cost,
    whPerMi: miles ? (batteryKwh * 1000) / miles : null,
    miPerKwh: batteryKwh ? miles / batteryKwh : null,
    costPerMile: miles ? cost / miles : null,
    gasCostPerMile: miles ? gasCost / miles : null,
    mpge: wallKwh ? miles / (wallKwh / KWH_PER_GALLON_EQUIV) : null,
  };
}
