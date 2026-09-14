import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { createInsoleHub, createInsoleHandler, validateDeviceUrl, validateFrame } from '../server/insole-hub.mjs';
import { normalizeBilateralState, markEsp32Disconnected } from '../src/services/esp32-api.js';
import { initialState } from '../src/data/dashboard-data.js';
import { renderInsoleConnections } from '../src/components/insole-connection.js';
import { renderBilateralHeatmap } from '../src/components/bilateral-heatmap.js';
import { analyzeRehabFrame } from '../src/data/gait-algorithms.js';
import { buildSensorSample } from '../src/trends/trend-math.js';

export function frame(side, sequence = 1, extra = {}) {
  const right = side === 'right';
  return { firmware: '04_sta_bilateral', wifi_mode: 'STA', device_id: `c3-${side}`, boot_id: 'boot-1', foot_side: side, frame: sequence, millis: sequence * 16,
    pressure_count: 4, pressure_layout: 'stepon-pressure-4-v1', pressure_channels: [0, 2, 4, 6], pressure_ready: true,
    pressure: right ? [80, 60, 40, 20] : [10, 20, 30, 40], pressure_raw: [400, 800, 1200, 1600],
    shtc3_channels: [3, 4, 5, 6], temperature: right ? [34, 35, 36, 37] : [30, 31, 32, 33], humidity: [40, 50, 60, 70], shtc3_ready: [true, true, true, true],
    imu_ready: true, accel: { x: right ? 2 : 1, y: 0, z: 1 }, gyro: { x: 0, y: 0, z: right ? 4 : 3 }, tca_ready: true, drv2605_ready: true,
    actual_sample_hz: 63.8, sample_hz: 64, ...extra };
}
const foot = (side, extra = {}) => ({ connected: true, status: 'online', age_ms: 10, state: frame(side), received_hz: 60, ...extra });
const both = () => ({ service: 'stepon-bilateral-v1', frame: 20, feet: { left: foot('left'), right: foot('right') } });
const until = async (predicate) => { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise((r) => setTimeout(r, 10)); } throw new Error('test condition timeout'); };

test('bilateral normalizer keeps two independent pressure, thermal and IMU values', () => {
  const s = normalizeBilateralState(both(), structuredClone(initialState));
  assert.deepEqual(s.bilateralPressure.left, [10, 20, 30, 40]); assert.deepEqual(s.bilateralPressure.right, [80, 60, 40, 20]);
  assert.equal(s.thermal.left[0].temp, 30); assert.equal(s.thermal.right[0].temp, 34);
  assert.equal(s.imuBySide.left.accel.x, 1); assert.equal(s.imuBySide.right.accel.x, 2);
  assert.equal(s.hardware.sensors.thermal.count, 8); assert.equal(s.hardware.sensors.thermal.total, 8);
  assert.equal(s.hardware.bilateralAvailable, true); assert.equal(s.device.battery, null);
  assert.equal(s.metrics.cadence, null); assert.equal(s.metrics.stride, null);
});
test('one foot disconnect clears its values and comparison without clearing the other', () => {
  const p = both(); const previous = normalizeBilateralState(p, structuredClone(initialState));
  p.feet.right.connected = false;
  const s = normalizeBilateralState(p, previous);
  assert.equal(s.connected, true); assert.equal(s.hardware.bilateralAvailable, false); assert.equal(s.metrics.balance, null);
  assert.deepEqual(s.bilateralPressure.right, [null, null, null, null]); assert.equal(s.imuBySide.right, null);
  assert.ok(s.thermal.right.every((v) => !v.available && v.temp === null));
  assert.equal(s.hardware.sensors.thermal.count, 4);
  assert.match(renderBilateralHeatmap(s), /오른발 · 연결 대기/);
  assert.equal(analyzeRehabFrame({ state: s, now: 1000 }).rehab.metrics.bilateralAvailable, false);
});
test('server outage and frozen selected foot never keep old readings in trends', () => {
  const s = normalizeBilateralState(both(), structuredClone(initialState));
  const offline = markEsp32Disconnected(s, new Error('hub offline'));
  assert.equal(offline.connected, false); assert.ok(offline.pressure.every((x) => x === null));
  assert.equal(offline.hardware.sensors.imu.ready, false); assert.equal(offline.imu.accel.x, null);
  assert.equal(buildSensorSample(offline, 'P01', 'flat'), null);
  const p = both(); p.feet[s.rehab.config.activeFoot].age_ms = 2001;
  assert.deepEqual(normalizeBilateralState(p, s).pressure, [null, null, null, null]);
});
test('right-side selection drives primary metrics; no zero substitution for missing sensors', () => {
  const p = both(), initial = structuredClone(initialState); initial.rehab.config.activeFoot = 'right';
  p.feet.right.state.imu_ready = false; p.feet.right.state.pressure_ready = false; p.feet.right.state.shtc3_ready = [true, false, true, false];
  const s = normalizeBilateralState(p, initial);
  assert.equal(s.hardware.footSide, 'right'); assert.equal(s.imuBySide.right, null); assert.equal(s.hardware.sensors.pressure.ready, false);
  assert.equal(s.thermal.right[1].temp, null); assert.equal(s.hardware.sensors.thermal.count, 6);
});
test('private IPv4 targets only, strict firmware identity and four-channel contract', () => {
  assert.equal(validateDeviceUrl('http://192.168.137.2'), 'http://192.168.137.2');
  for (const url of ['http://example.com', 'http://127.0.0.1', 'http://169.254.169.254', 'https://192.168.1.2', 'http://x:y@192.168.1.2', 'http://192.168.1.2/private', 'file:///tmp']) assert.throws(() => validateDeviceUrl(url));
  assert.throws(() => validateFrame(frame('right'), 'left'), /foot_side/);
  assert.throws(() => validateFrame(frame('left', 1, { pressure_channels: [0, 1, 2, 3] }), 'left'), /layout/);
  assert.throws(() => validateFrame(frame('left'), 'left', 'another'), /device_id/);
});
test('C3 and WROOM STA frames share the sensor contract without accepting other firmware', () => {
  for (const firmware of ['04_sta_bilateral', '04_2_sta_bilateral_wroom']) {
    const payload = frame('right', 2, { firmware, device_id: 'wroom-right' });
    assert.equal(validateFrame(payload, 'right', 'wroom-right'), payload);
    assert.throws(() => validateFrame({ ...payload, wifi_mode: 'AP' }, 'right'), /sta_firmware/);
    assert.throws(() => validateFrame({ ...payload, pressure_channels: [0, 1, 2, 3] }, 'right'), /layout/);
    assert.throws(() => validateFrame({ ...payload, accel: { x: NaN, y: 0, z: 1 } }, 'right'), /invalid_imu/);
  }
  for (const firmware of ['03_final', '06_bmi270_csv_wroom', '04_2_unknown', null]) {
    assert.throws(() => validateFrame(frame('left', 1, { firmware }), 'left'), /sta_firmware/);
  }
});
test('independent collectors detect frozen frames, loss, reboot and reconnection; commands target one foot', async (t) => {
  const source = { left: { n: 0 }, right: { n: 0 } }, calls = [];
  const hub = createInsoleHub({ pollIntervalMs: 5, staleMs: 100, fetchImpl: async (url) => {
    calls.push(url); const side = url.includes('.2/') ? 'left' : 'right', d = source[side];
    if (d.offline) throw new Error('offline');
    if (!d.frozen) d.n += d.skip ? 3 : 1;
    return new Response(JSON.stringify(frame(side, d.n, { boot_id: d.boot ?? 'boot-1' })));
  } }); t.after(() => hub.stop());
  hub.register({ side: 'left', url: 'http://192.168.137.2' }); hub.register({ side: 'right', url: 'http://192.168.137.3' });
  await until(() => hub.snapshot().bilateral_available);
  assert.throws(() => hub.register({ side: 'right', url: 'http://192.168.137.2' }), /duplicate/);
  assert.throws(() => hub.register({ side: 'left', deviceId: 'different', automatic: true, url: 'http://192.168.137.4' }), /assigned/);
  const start = calls.length; await hub.command('right', 'vibrate');
  assert.ok(calls.slice(start).some((u) => u === 'http://192.168.137.3/api/vibrate?effect=47'));
  source.right.frozen = true;
  await until(() => hub.snapshot().feet.right.status === 'stale');
  assert.equal(hub.snapshot().feet.left.connected, true); assert.equal(hub.snapshot().feet.right.state, null);
  await assert.rejects(() => hub.command('right', 'vibrate'), /offline/);
  source.right.frozen = false; source.right.skip = true;
  await until(() => hub.snapshot().feet.right.missed_frames > 0);
  source.right.skip = false; source.right.boot = 'boot-2'; source.right.n = 0;
  await until(() => hub.snapshot().feet.right.restarts === 1);
  assert.equal(hub.snapshot().feet.right.missed_frames, 0);
  source.left.offline = true; await until(() => hub.snapshot().feet.left.status === 'error');
  assert.equal(hub.snapshot().feet.right.connected, true);
  source.left.offline = false; await until(() => hub.snapshot().bilateral_available);
});
test('HTTP config, per-foot AI passthrough, wrong-side payload and cross-origin writes', async (t) => {
  const hub = createInsoleHub({ pollIntervalMs: 20, fetchImpl: async () => new Response(JSON.stringify(frame('left'))) });
  const server = http.createServer(createInsoleHandler(hub)); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { hub.stop(); server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body, extra = {}) => fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
  assert.equal((await post('/api/insoles/config', { side: 'left', url: 'http://192.168.137.2' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('/api/insoles/config', { side: 'left', url: 'http://192.168.137.2' })).status, 200);
  await until(() => hub.snapshot().feet.left.connected);
  assert.equal((await (await fetch(base + '/api/insoles/left/api/state')).json()).foot_side, 'left');
  assert.equal((await fetch(base + '/api/insoles/right/api/state')).status, 503);
  await post('/api/insoles/config', { side: 'right', url: 'http://192.168.137.3' });
  await until(() => hub.snapshot().feet.right.status === 'error');
  assert.equal(hub.snapshot().feet.right.last_error, 'foot_side_mismatch');
});
test('automatic registration uses the requesting board address, not a supplied URL', async (t) => {
  const registrations = [];
  const server = http.createServer(createInsoleHandler({ register: (args) => registrations.push(args) }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const register = (firmware) => fetch(`http://127.0.0.1:${server.address().port}/api/insoles/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ firmware, foot_side: 'left', device_id: 'TEST-left', url: 'http://example.com' }),
  });
  for (const firmware of ['04_sta_bilateral', '04_2_sta_bilateral_wroom']) {
    assert.equal((await register(firmware)).status, 200);
    assert.deepEqual(registrations.at(-1), { side: 'left', deviceId: 'TEST-left', url: 'http://127.0.0.1', automatic: true });
  }
  assert.equal((await register('06_bmi270_csv_wroom')).status, 400);
  assert.equal(registrations.length, 2);
});
test('connection cards escape untrusted values and never print hotspot credentials', () => {
  const p = both(); p.feet.left.base_url = '<img src=x>'; p.feet.left.last_error = '<script>alert(1)</script>';
  const html = renderInsoleConnections(normalizeBilateralState(p, structuredClone(initialState)), { configure: true });
  assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<script>|WIFI_PASSWORD|wifi_secrets\.h/);
  assert.match(html, /data-insole-form="left"/); assert.match(html, /data-insole-form="right"/);
});
test('04 sketch is self-contained STA only, credentials ignored, old sketches untouched structurally', () => {
  const root = new URL('../../firmware/stepon_c3/04_sta_bilateral/', import.meta.url);
  const code = fs.readFileSync(new URL('04_sta_bilateral.ino', root), 'utf8');
  assert.match(code, /WiFi.mode\(WIFI_STA\)/); assert.doesNotMatch(code, /softAP|WIFI_AP|AP_SSID/);
  assert.match(code, /gatewayIP/); assert.match(code, /foot_side/); assert.match(code, /boot_id/);
  assert.doesNotMatch(fs.readFileSync(new URL('sensor_core.h', root), 'utf8'), /\.\.\/|getEvent\(/);
  assert.match(fs.readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8'), /04_sta_bilateral\/wifi_secrets.h/);
});
