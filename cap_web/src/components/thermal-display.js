// Presentation only: never mutate state.thermal or pass estimates to recording,
// calibration, comparisons, model inference, or alarms.
import { sensorProfileFor, SHARED_SENSOR_MAP } from '../data/sensor-config.js';

export const THERMAL_DISPLAY_OFFSETS = [-1 / 3, -1, 1 / 3, 1];
export const THERMAL_DISPLAY_LIMITS = { temperature: 0.15, humidity: 0.6 };
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const validReading = reading => reading && reading.available !== false
  && numeric(reading.temp) && reading.temp > -40 && reading.temp <= 100
  && numeric(reading.humidity) && reading.humidity >= 0 && reading.humidity <= 100;

export function profileForFoot(state, side) {
  const hw = state.hardware ?? {};
  return hw.transport === 'sta' ? sensorProfileFor(hw.feet?.[side]?.state ?? {})
    : hw.sensorProfile ?? sensorProfileFor(hw.raw ?? {});
}

export function footDisplayConnected(state, side, now = Date.now()) {
  if (state.dataSource !== 'esp32') return true;
  const hw = state.hardware ?? {};
  if (!state.connected) return false;
  const elapsed = numeric(state.sensorReceivedAt) ? now - state.sensorReceivedAt : 0;
  if (elapsed < 0 || elapsed > 2500) return false;
  if (hw.transport === 'sta') {
    const foot = hw.feet?.[side];
    return Boolean(foot?.connected && foot.state?.foot_side === side
      && numeric(foot.age_ms) && foot.age_ms >= 0 && foot.age_ms + elapsed <= 2500);
  }
  if (numeric(state.sensorAdvancedAt) && (now < state.sensorAdvancedAt || now - state.sensorAdvancedAt > 2500)) return false;
  return Boolean(hw.footSide === side || hw.bilateralAvailable);
}

export function thermalDisplayForFoot(state, side, mode, now = Date.now()) {
  const shared = profileForFoot(state, side) === 'two-shared';
  const rows = footDisplayConnected(state, side, now) ? state.thermal?.[side] ?? [] : [];
  const field = mode === 'humidity' ? 'humidity' : 'temp';
  const physical = new Map();
  for (let index = 0; index < 4; index++) {
    const sensor = shared ? SHARED_SENSOR_MAP[index] : index;
    if (validReading(rows[index]) && !physical.has(sensor)) physical.set(sensor, rows[index][field]);
  }
  const mean = physical.size ? [...physical.values()].reduce((sum, value) => sum + value, 0) / physical.size : null;
  const samples = Array.from({ length: 4 }, (_, index) => {
    const sensor = shared ? SHARED_SENSOR_MAP[index] : index;
    // T1 and T3 represent the physical sensors. T2/T4, and any missing
    // physical slot, use the current same-foot physical mean only.
    if ((!shared || SHARED_SENSOR_MAP.indexOf(sensor) === index) && physical.has(sensor)) {
      return { value: physical.get(sensor), estimated: false, sources: [sensor] };
    }
    if (!shared || mean === null) return { value: null, estimated: false, sources: [] };
    const offset = THERMAL_DISPLAY_OFFSETS[index] * THERMAL_DISPLAY_LIMITS[mode === 'humidity' ? 'humidity' : 'temperature'];
    const value = Math.max(mode === 'humidity' ? 0 : -39.99, Math.min(100, mean + offset));
    return { value: Number(value.toFixed(2)), estimated: true, sources: [...physical.keys()] };
  });
  return { samples, mean, physicalCount: physical.size, total: shared ? 2 : 4,
    estimatedCount: samples.filter(sample => sample.estimated).length, shared };
}
