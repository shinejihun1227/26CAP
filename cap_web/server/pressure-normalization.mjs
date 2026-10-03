import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pressureContractMatches, sensorProfileFor } from '../src/data/sensor-config.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const validRaw = p => Array.isArray(p) && p.length === 4 && p.every(v => Number.isFinite(v) && v >= 0 && v <= 4095);
const STANDING_SCORE = 50;
export function normalizeStandingPressure(raw, calibration) {
  if (!raw) return raw;
  let status = calibration?.status === 'incomplete' ? 'incomplete' : 'needed';
  if (calibration?.method === 'walk-max-v1') status = 'recalibration_required';
  if (calibration?.status === 'ready' && calibration.version === 2 && calibration.method === 'standing-50-v1') {
    const matches = calibration.device_id === raw.device_id && calibration.foot_side === raw.foot_side
      && calibration.sensor_profile === sensorProfileFor(raw) && pressureContractMatches(raw)
      && same(calibration.pressure_channels, raw.pressure_channels)
      && same(calibration.sensor_map, raw.pressure_sensor_map ?? [0, 1, 2, 3])
      && same(calibration.pressure_transport ?? null, raw.pressure_transport ?? null)
      && same(calibration.pressure_input_gpio ?? null, raw.pressure_input_gpio ?? null);
    status = !matches ? 'mismatch' : !validRaw(calibration.reference_raw) || calibration.reference_raw.some(v => v < 32)
      || !/^[a-f0-9]{32}$/.test(calibration.id ?? '') ? 'incomplete'
      : raw.pressure_ready === false || !validRaw(raw.pressure_raw) ? 'unavailable' : 'ready';
  }
  // Keep standing-relative records separate from the former walking-peak scale.
  const displayId = status === 'ready'
    ? createHash('sha256').update(`${calibration.id}:standing-50-v1`).digest('hex').slice(0, 32) : null;
  const metadata = { status, method: 'standing-50-v1', id: displayId, reference_score: STANDING_SCORE };
  if (status !== 'ready') return { ...raw, pressure_calibration: metadata };
  const ratio = raw.pressure_raw.map((v, i) => v / calibration.reference_raw[i]);
  return { ...raw, pressure_adc_percent: [...raw.pressure],
    pressure: ratio.map(v => Math.round(Math.min(100, v * STANDING_SCORE) * 10) / 10),
    pressure_calibration: { ...metadata, source_id: calibration.id, reference_raw: [...calibration.reference_raw],
      over_reference: ratio.map(v => v > 1), unclipped_score: ratio.map(v => v * STANDING_SCORE) } };
}

// Reload atomic calibration files once a second, never block the 64 Hz collector.
export function createPressureNormalization(directory) {
  let records = {}, loading = false;
  async function refresh() {
    if (loading) return;
    loading = true;
    try {
      records = Object.fromEntries(await Promise.all(['left', 'right'].map(async side => {
        try { return [side, JSON.parse(await fs.readFile(path.join(directory, `${side}.calibration.json`), 'utf8')).pressure_normalization ?? null]; }
        catch { return [side, null]; }
      })));
    } finally { loading = false; }
  }
  return { refresh, apply: (side, raw) => normalizeStandingPressure(raw, records[side]) };
}
