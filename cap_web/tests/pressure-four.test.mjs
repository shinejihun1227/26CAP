import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initialState } from '../src/data/dashboard-data.js';
import { PRESSURE_CHANNELS, PRESSURE_LAYOUT_ID, PRESSURE_POINTS, THERMAL_CHANNELS, REHAB_ALGORITHM_ID } from '../src/data/sensor-config.js';
import { normalizeSensorLayout } from '../src/data/sensor-layout.js';
import { normalizeEsp32State } from '../src/services/esp32-api.js';
import { calculateFootMetrics, analyzeFog, analyzeRehabFrame, captureRehabCalibration } from '../src/data/gait-algorithms.js';
import { renderBilateralHeatmap } from '../src/components/bilateral-heatmap.js';
import { renderPressureMap } from '../src/components/pressure-map.js';
import { buildSensorSample } from '../src/trends/trend-math.js';
import { sanitizeSensorSample } from '../server/trend-store.mjs';

function payload(extra = {}) {
  return { device: 'StepOn-C3', frame: 1, pressure: [10, 20, 30, 40], pressure_count: 4,
    pressure_layout: PRESSURE_LAYOUT_ID, pressure_channels: [...PRESSURE_CHANNELS], foot_side: 'left',
    temperature: [30, 31, 32, 33], humidity: [50, 51, 52, 53], shtc3_ready: [true, true, true, true], shtc3_channels: [...THERMAL_CHANNELS],
    imu_ready: true, accel: { x: 0, y: 0, z: 1 }, gyro: { x: 0, y: 0, z: 0 }, ...extra };
}
const stateFor = (extra) => normalizeEsp32State(payload(extra), structuredClone(initialState));

test('ESP32 four channels retain order, temperature slots, and missing opposite foot', () => {
  const s = stateFor();
  assert.deepEqual(s.pressure, [10, 20, 30, 40]);
  assert.deepEqual(s.bilateralPressure.right, [null, null, null, null]);
  assert.equal(s.hardware.sensors.pressure.count, 4); assert.equal(s.hardware.sensors.pressure.total, 4);
  assert.equal(s.metrics.balance, null); assert.equal(s.hardware.layoutWarning, null);
  assert.deepEqual(s.thermal.left.map((p) => [p.site, p.temp]), [['heel', 30], ['arch', 31], ['forefoot', 32], ['toe', 33]]);
  assert.deepEqual(s.hardware.thermalChannels, [3, 4, 5, 6]);
});

test('old eight-channel arrays and mismatched metadata do not reuse stale pressure', () => {
  for (const extra of [{ pressure: Array(8).fill(20) }, { pressure_count: 8 }, { pressure_layout: 'old-layout' }, { pressure_channels: [0, 1, 2, 3] }, { pressure: [1, 2, null, 4] }, { pressure: [1, 2, NaN, 4] }]) {
    const s = stateFor(extra);
    assert.deepEqual(s.pressure, [null, null, null, null]);
    assert.equal(s.hardware.sensors.pressure.ready, false); assert.ok(s.hardware.layoutWarning);
  }
});

test('four-channel compatibility payloads and real zero values remain usable', () => {
  const s = stateFor({ pressure_count: undefined, pressure_layout: undefined, pressure_channels: undefined, pressure: [0, 0, 0, 0] });
  assert.deepEqual(s.pressure, [0, 0, 0, 0]); assert.equal(s.hardware.sensors.pressure.ready, true);
  assert.equal(calculateFootMetrics(s.pressure, s.imu).loaded, false);
});

test('four-point regions and relative CoP use front, medial, lateral, heel', () => {
  const s = stateFor(), m = calculateFootMetrics(s.pressure, s.imu);
  assert.equal(m.total, 100); assert.equal(m.front, 10); assert.equal(m.midfoot, 50); assert.equal(m.heel, 40);
  assert.equal(m.medial, 20); assert.equal(m.lateral, 30); assert.equal(m.heelLandingScore, 40); assert.equal(m.propulsionScore, 10);
  assert.deepEqual(m.cop, { x: .065, y: -.255 });
  const result = analyzeRehabFrame({ state: s, history: {}, now: 1000 });
  assert.equal(result.rehab.metrics.activeRelativePressure, 25); assert.equal(result.rehab.metrics.bilateralAvailable, false);
  assert.equal(calculateFootMetrics(Array(8).fill(20), s.imu).available, false);
  assert.equal(calculateFootMetrics([1, 2, null, 4], s.imu).total, null);
});

test('demo FoG helper has no out-of-bounds arithmetic on four pressures', () => {
  for (const p of [[0, 0, 0, 0], [100, 100, 100, 100], [0, 30, 50, 90]]) {
    const result = analyzeFog({ pressure: p, imu: initialState.imu, cadence: 90 });
    assert.ok(Number.isFinite(result.score)); assert.ok(Object.values(result.features).every(Number.isFinite));
  }
});

test('old eight-point editor coordinates reset without losing thermal coordinates', () => {
  const thermal = { left: [[10, 20], [20, 30], [30, 40], [40, 50]], right: [[11, 21], [21, 31], [31, 41], [41, 51]] };
  const result = normalizeSensorLayout({ pressure: { left: Array(8).fill([20, 20]), right: Array(8).fill([30, 30]) }, thermal });
  assert.deepEqual(result.pressure, PRESSURE_POINTS); assert.deepEqual(result.thermal, thermal);
  assert.equal(result.pressureSchema, PRESSURE_LAYOUT_ID);
  assert.ok(result.pressure.left[1][0] > result.pressure.left[2][0]);
  assert.ok(result.pressure.right[1][0] < result.pressure.right[2][0]);
  result.pressure.left[0] = [45, 15]; assert.deepEqual(normalizeSensorLayout(result).pressure.left[0], [45, 15]);
});

test('new baselines are stamped and old baselines cannot drive four-channel rules', () => {
  const s = stateFor(); const c = captureRehabCalibration(s, 1000);
  assert.equal(c.pressureLayout, PRESSURE_LAYOUT_ID); assert.equal(c.status, 'ready'); assert.equal(c.baseline.left.total, 100);
  s.rehab.calibration = { status: 'ready', baseline: { left: { total: 800 } } };
  const result = analyzeRehabFrame({ state: s, history: { observations: [{ at: 1, activeLateral: 99 }] }, now: 2000 });
  assert.equal(result.rehab.calibration.status, 'needed'); assert.equal(result.rehab.calibration.baseline, null);
  assert.equal(result.rehab.calibration.pressureLayout, PRESSURE_LAYOUT_ID); assert.equal(result.history.observations.length, 1);
});

test('heatmap shows four dots per foot, binary threshold, and physical channel labels', () => {
  const html = renderBilateralHeatmap(stateFor({ pressure: [49, 50, 0, 100] }));
  assert.equal((html.match(/data-sensor-kind="pressure"/g) ?? []).length, 8);
  assert.equal((html.match(/data-pressure-state="active"/g) ?? []).length, 2);
  assert.equal((html.match(/data-pressure-state="inactive"/g) ?? []).length, 2);
  assert.equal((html.match(/data-pressure-state="unavailable"/g) ?? []).length, 4);
  assert.doesNotMatch(html, /<em>P[5-8]<\/em>/); assert.match(html, /가운데 안쪽/); assert.match(html, /가운데 바깥쪽/);
  for (const channel of PRESSURE_CHANNELS) assert.match(html, new RegExp(`MUX CH${channel}`));
  assert.equal((renderPressureMap([49, 50, 0, 100]).match(/pressure-node /g) ?? []).length, 4);
  assert.doesNotMatch(renderPressureMap([null, null, null, null]), /NaN|균형적/);
});

test('right-only insole marks left unavailable; bilateral comparison requires both data', () => {
  const s = stateFor({ foot_side: 'right' }); assert.equal(s.rehab.config.activeFoot, 'right');
  const html = renderBilateralHeatmap(s); assert.match(html, /왼발 · 연결 대기/); assert.doesNotMatch(html, /오른발 · 연결 대기/);
  const both = stateFor({ bilateral_available: true, bilateral_pressure: { left: [20, 20, 20, 20], right: [20, 20, 20, 20] } });
  assert.equal(both.hardware.bilateralAvailable, true); assert.equal(both.metrics.balance, 100);
  assert.doesNotMatch(renderBilateralHeatmap(both), /왼발 · 연결 대기|오른발 · 연결 대기/);
});

test('temperature and humidity views retain all four mux slots including missing sensors', () => {
  const s = stateFor({ shtc3_ready: [true, false, true, true] });
  for (const mode of ['temperature', 'humidity']) {
    const html = renderBilateralHeatmap({ ...s, heatmapMode: mode });
    assert.equal((html.match(/data-sensor-kind="thermal"/g) ?? []).length, 8);
    for (const channel of THERMAL_CHANNELS) assert.match(html, new RegExp(`MUX CH${channel}`));
    assert.equal(s.thermal.left[1].temp, null); assert.equal(s.hardware.sensors.thermal.count, 3);
  }
});

test('trend conditions distinguish old layout and refuse mixed identities', () => {
  const now = Date.now(); let s = stateFor(); s.sensorReceivedAt = s.sensorAdvancedAt = now;
  s.rehab.calibration = captureRehabCalibration(s, now); s.rehab = analyzeRehabFrame({ state: s, history: {}, now }).rehab;
  const sample = buildSensorSample(s, 'P01', 'flat', now), current = sanitizeSensorSample(sample, now);
  assert.equal(current.values.pressure, 25); assert.equal(current.condition.algorithm, REHAB_ALGORITHM_ID);
  assert.deepEqual(current.condition.pressureChannels, [0, 2, 4, 6]);
  const old = structuredClone(sample); old.condition.algorithm = 'web-rehab-rules-v1';
  assert.throws(() => sanitizeSensorSample(old, now));
  delete old.condition.pressureLayout; delete old.condition.pressureChannels;
  assert.notEqual(sanitizeSensorSample(old, now).conditionKey, current.conditionKey);
  const bad = structuredClone(sample); bad.condition.pressureChannels = [0, 1, 2, 3]; assert.throws(() => sanitizeSensorSample(bad, now));
  s.hardware.raw.pressure_count = 8;
  assert.equal(buildSensorSample(s, 'P01', 'flat', now).values.pressure, undefined);
});

test('packaged WROOM firmware shares the web four-channel pressure and thermal mapping', () => {
  const root = new URL('../../firmware/stepon_c3/04_2_sta_bilateral_wroom/', import.meta.url);
  const config = fs.readFileSync(new URL('config.h', root), 'utf8');
  const sensor = fs.readFileSync(new URL('sensor_core.h', root), 'utf8');
  const sketch = fs.readFileSync(new URL('04_2_sta_bilateral_wroom.ino', root), 'utf8');
  assert.match(config, /PRESSURE_CHANNELS\[4\] = \{0, 2, 4, 6\}/);
  assert.match(config, /THERMAL_CHANNELS\[4\] = \{3, 4, 5, 6\}/);
  assert.match(sensor, /pressureRaw\[4\]/);
  assert.match(sensor, /THERMAL_CHANNELS\[index\]/);
  const wireSource = sketch.replaceAll('\\"', '"');
  assert.ok(wireSource.includes('"pressure_count":4'));
  assert.ok(wireSource.includes('"pressure_channels":[0,2,4,6]'));
  assert.ok(wireSource.includes('"shtc3_channels":[3,4,5,6]'));
});
