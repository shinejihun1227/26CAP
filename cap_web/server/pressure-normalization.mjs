import fs from 'node:fs/promises';
import path from 'node:path';
import { pressureContractMatches, sensorProfileFor } from '../src/data/sensor-config.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const validRaw = p => Array.isArray(p) && p.length === 4 && p.every(v => Number.isFinite(v) && v >= 0 && v <= 4095);
export function normalizeWalkingPressure(raw, calibration) {
  if (!raw) return raw;
  let status = calibration?.status === 'incomplete' ? 'incomplete' : 'needed';
  if (calibration?.status === 'ready' && calibration.version === 1 && calibration.method === 'walk-max-v1') {
    const matches = calibration.device_id === raw.device_id && calibration.foot_side === raw.foot_side
      && calibration.sensor_profile === sensorProfileFor(raw) && pressureContractMatches(raw)
      && same(calibration.pressure_channels, raw.pressure_channels)
      && same(calibration.sensor_map, raw.pressure_sensor_map ?? [0, 1, 2, 3]);
    status = !matches ? 'mismatch' : !validRaw(calibration.max_raw) || calibration.max_raw.some(v => v < 32)
      || !/^[a-f0-9]{32}$/.test(calibration.id ?? '') ? 'incomplete'
      : raw.pressure_ready === false || !validRaw(raw.pressure_raw) ? 'unavailable' : 'ready';
  }
  const metadata = { status, method: 'walk-max-v1', id: status === 'ready' ? calibration.id : null };
  if (status !== 'ready') return { ...raw, pressure_calibration: metadata };
  const ratio = raw.pressure_raw.map((v, i) => v / calibration.max_raw[i] * 100);
  return { ...raw, pressure_adc_percent: [...raw.pressure],
    pressure: ratio.map(v => Math.round(Math.min(100, v) * 10) / 10),
    pressure_calibration: { ...metadata, max_raw: [...calibration.max_raw], over_max: ratio.map(v => v > 100) } };
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
  return { refresh, apply: (side, raw) => normalizeWalkingPressure(raw, records[side]) };
}
