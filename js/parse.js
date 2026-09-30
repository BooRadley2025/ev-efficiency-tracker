// Turns raw OCR text from a Tesla energy/trip screenshot into trip fields.
// Pure string handling so it can be unit-tested without an image.

import { MI_PER_KM } from './calc.js';

const NUM = String.raw`(\d{1,5}(?:[.,]\d{1,2})?)`;
// Tesseract often reads the "/" in Wh/mi as |, l, I, 1 or drops it, and "mi" as "rni".
const PER = String.raw`\s*[\/|lI1\\]?\s*`;
const MI = String.raw`(?:mi|rni|ml)`;

const IGNORE_DISTANCE_LINE = /range|rated|remaining|projected|estimated|\best\b|typical|ideal/i;
const DISTANCE_LABEL = /distance|driven|trip|since|odometer|drive|traveled|travelled/i;

function toFloat(s) {
  // "1,234" is a thousands separator; "12,5" is a decimal comma.
  const t = /^\d{1,3},\d{3}$/.test(s) ? s.replace(',', '') : s.replace(',', '.');
  return parseFloat(t);
}

function normalize(raw) {
  return raw
    .replace(/\r/g, '')
    .replace(/[“”"']/g, '')
    .replace(/(\d)\s+\.\s*(\d)/g, '$1.$2') // "12 .5" -> "12.5"
    .replace(/(\d)\s*[oO](?=\s*(?:mi|km|kwh|%))/gi, '$10') // trailing O read for 0
    .replace(/[→⟶➔➜>»]+|-+>/g, ' → ');
}

/**
 * @returns {{ miles?, energyKwh?, whPerMi?, startPct?, endPct?, fields: string[], notes: string[] }}
 */
export function parseTeslaText(raw) {
  const text = normalize(raw || '');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = { fields: [], notes: [] };

  // --- Efficiency (Wh/mi or Wh/km) -------------------------------------
  const effRe = new RegExp(`${NUM}\\s*wh${PER}(${MI}|km)\\b`, 'i');
  const eff = text.match(effRe);
  if (eff) {
    let v = toFloat(eff[1]);
    if (/km/i.test(eff[2])) v = v / MI_PER_KM;
    if (v >= 80 && v <= 1500) out.whPerMi = round(v, 0);
  }

  // --- Energy (kWh), skipping "kWh/100 km" style rates ------------------
  const kwhRe = new RegExp(`${NUM}\\s*k\\s*wh\\b(?!\\s*\\/)`, 'gi');
  for (const m of text.matchAll(kwhRe)) {
    const v = toFloat(m[1]);
    if (v > 0 && v < 250) {
      out.energyKwh = v;
      break;
    }
  }

  // --- Distance --------------------------------------------------------
  const distRe = new RegExp(`${NUM}\\s*(${MI}|miles|km)\\b`, 'gi');
  const candidates = [];
  // Remove efficiency tokens first so the "mi" in "Wh/mi" or "mi/kWh" isn't read as a distance.
  const effTokens = new RegExp(`${NUM}\\s*(?:wh${PER}(?:${MI}|km)|(?:${MI}|km)${PER}k\\s*wh)`, 'gi');
  lines.forEach((rawLine, i) => {
    const line = rawLine.replace(effTokens, ' ');
    if (IGNORE_DISTANCE_LINE.test(line)) return;
    const prev = lines[i - 1] || '';
    for (const m of line.matchAll(distRe)) {
      let v = toFloat(m[1]);
      if (/km/i.test(m[2])) v = v * MI_PER_KM;
      if (!(v > 0 && v < 2000)) continue;
      const labelled = DISTANCE_LABEL.test(line) || (DISTANCE_LABEL.test(prev) && !IGNORE_DISTANCE_LINE.test(prev));
      // "Last 15 mi / 30 mi / 100 mi" chart window tabs are not trip distances.
      const isWindowTab = /\blast\b/i.test(line) || (line.match(distRe) || []).length >= 3;
      candidates.push({ v, score: (labelled ? 2 : 0) - (isWindowTab ? 3 : 0) });
    }
  });
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length && candidates[0].score > -3) out.miles = round(candidates[0].v, 1);

  // --- Battery % -------------------------------------------------------
  const arrow = text.match(/(\d{1,3})\s*%\s*(?:→|to|-|–)\s*(\d{1,3})\s*%/i);
  let pcts;
  if (arrow) {
    pcts = [parseInt(arrow[1], 10), parseInt(arrow[2], 10)];
  } else {
    pcts = [...text.matchAll(/(\d{1,3})\s*%/g)].map((m) => parseInt(m[1], 10)).filter((v) => v <= 100);
  }
  if (pcts.length >= 2) {
    let [a, b] = pcts;
    if (a < b) {
      [a, b] = [b, a];
      out.notes.push('Swapped battery % so starting is the higher value.');
    }
    if (a !== b) {
      out.startPct = a;
      out.endPct = b;
    }
  } else if (pcts.length === 1) {
    out.notes.push(`Found one battery value (${pcts[0]}%). Enter the other one yourself.`);
  }

  // --- Fill gaps from the other two values ------------------------------
  if (out.miles && out.whPerMi && !out.energyKwh) {
    out.energyKwh = round((out.miles * out.whPerMi) / 1000, 2);
    out.notes.push('Energy was calculated from distance × Wh/mi.');
  } else if (!out.miles && out.whPerMi && out.energyKwh) {
    out.miles = round((out.energyKwh * 1000) / out.whPerMi, 1);
    out.notes.push('Distance was calculated from energy ÷ Wh/mi.');
  } else if (out.miles && out.whPerMi && out.energyKwh) {
    const implied = (out.miles * out.whPerMi) / 1000;
    if (Math.abs(implied - out.energyKwh) / out.energyKwh > 0.15) {
      out.notes.push(
        `Scanned values disagree: ${out.miles} mi × ${out.whPerMi} Wh/mi = ${implied.toFixed(1)} kWh, ` +
          `but the scan read ${out.energyKwh} kWh. A decimal point may have been missed.`
      );
    }
  }

  for (const k of ['miles', 'energyKwh', 'startPct', 'endPct']) if (out[k] !== undefined) out.fields.push(k);
  return out;
}

function round(v, digits) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
