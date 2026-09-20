import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { session } from './rom-fixtures.mjs';
import { koreaDay, shiftDay, romGroups, romDays, sensorDays, compareDays, buildSensorSample, stableJson } from '../src/trends/trend-math.js';
import { createTrendStore, createTrendHandler, sanitizeSensorSample } from '../server/trend-store.mjs';
import { renderTrendsContent } from '../src/views/trends-view.js';
import { renderComparison, renderDailyChart } from '../src/trends/trend-render.js';
import { renderReportsContent } from '../src/views/reports-view.js';
import { initialState } from '../src/data/dashboard-data.js';
const now = Date.parse('2026-09-09T03:00:00Z');
function live(at = now) {
  return { dataSource: 'esp32', connected: true, sensorReceivedAt: at, sensorAdvancedAt: at, device: { name: 'StepOn-C3' }, tick: 1,
    bilateralPressure: { left: Array(4).fill(20), right: Array(4).fill(30) },
    hardware: { footSide: 'left', bilateralAvailable: true, raw: { frame: 1, pressure: Array(4).fill(20), bilateral_pressure: { left: Array(4).fill(20), right: Array(4).fill(30) } }, sensors: { pressure: { ready: true }, imu: { ready: true } } },
    thermal: { left: [{ site: 'heel', available: true, temp: 31, humidity: 55 }], right: [] },
    rehab: { config: { activeFoot: 'left', contactThreshold: 8 }, calibration: { pressureLayout: 'stepon-pressure-4-v1', status: 'ready', baseline: { left: { total: 200, cop: { x: .1, y: .2 } } } }, alerts: [], metrics: { activeRelativePressure: 25, bilateralAvailable: true, loadDifferencePct: 20, contact: { left: true }, heelLanding: { active: 30 }, propulsion: { active: 55 }, lateralLoad: { active: 40 } } },
    ai: { available: true, ready: true, windowReady: true, deviceConnected: true, state: 'confirmed', lastWindowAtMs: at, model: 'ensemble', sampleRateHz: 64, windowSec: 4, hopSec: .5, calibration: { file: 'C:/private/file.json', vertical_confidence: .9, yaw_enabled: true } },
  };
}
function sample(at = now, participant = 'P01') { return buildSensorSample(live(at), participant, '평지-기본', at); }
function temp(t) { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stepon-trend-test-')); t.after(() => { assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); assert.match(path.basename(directory), /^stepon-trend-test-/); fs.rmSync(directory, { recursive: true, force: true }); }); return directory; }

test('Korean midnight, month rollover and day shifting are deterministic', () => {
  assert.equal(koreaDay('2026-09-08T15:00:00Z'), '2026-09-09');
  assert.equal(koreaDay('2026-09-08T14:59:59Z'), '2026-09-08');
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28'); assert.equal(koreaDay('bad'), null);
});
test('yesterday is not silently replaced by previous day; week weights days equally', () => {
  const days = [{ day: '2026-09-06', value: 10, count: 100 }, { day: '2026-09-07', value: 30, count: 1 }, { day: '2026-09-09', value: 25, count: 3 }];
  assert.equal(compareDays(days, '2026-09-09').delta, null);
  assert.equal(compareDays(days, '2026-09-09', 'previous').delta, -5);
  assert.equal(compareDays(days, '2026-09-09', 'week').reference, 20);
  assert.equal(compareDays(days, '2026-09-09', 'week').delta, 5);
});
test('missing and zero are distinct; future records do not enter baseline', () => {
  const days = [{ day: '2026-09-08', value: 0 }, { day: '2026-09-09', value: 0 }, { day: '2026-09-10', value: 100 }];
  assert.equal(compareDays(days, '2026-09-09').delta, 0);
  assert.equal(compareDays(days, '2026-09-11').delta, null);
});
test('ROM separates participant, setup, posture, confidence, direction and model', () => {
  const records = [session(), ...[{ participant: 'P02' }, { setup: '다른 곳' }, { posture: 'standing' }, { confidence: .85 }, { modelVersion: 'different' }, { view: 'right', metric: 'right_ankle' }].map((config) => session({ config }))];
  assert.equal(romGroups(records, 'P01').length, 6); assert.equal(romGroups(records, 'P02').length, 1);
});
test('ROM daily median uses only eligible records and counts exclusions', () => {
  const records = [10, 20, 90].map((value) => { const s = session({ capturedAt: new Date(now).toISOString() }); s.summary.byMetric.left_ankle.observedRange = value; return s; });
  records[2].summary.eligible = false;
  const day = romDays(romGroups(records, 'P01')[0])[0];
  assert.equal(day.value, 15); assert.equal(day.count, 2); assert.equal(day.excluded, 1);
});
test('sensor extraction rejects demo, disconnected, paused and stale frames', () => {
  assert.equal(buildSensorSample(initialState, 'P01', 'x', now), null);
  for (const overrides of [{ connected: false }, { paused: true }, { sensorReceivedAt: now - 3000 }, { sensorAdvancedAt: now - 3000 }]) assert.equal(buildSensorSample({ ...live(), ...overrides }, 'P01', 'x', now), null);
});
test('unavailable AI, uncalibrated rules and unilateral pressure are not recorded as zero', () => {
  const s = live(); s.ai.windowReady = false; s.hardware.bilateralAvailable = false; s.rehab.calibration.status = 'needed';
  const result = buildSensorSample(s, 'P01', 'x', now);
  assert.equal(result.values.fog, undefined); assert.equal(result.values.loadDifference, undefined); assert.equal(result.values.feedback, undefined); assert.equal(result.values.temperature, 31);
  s.ai.windowReady = true; s.ai.lastWindowAtMs = now - 5000;
  assert.equal(buildSensorSample(s, 'P01', 'x', now).values.fog, undefined);
});
test('calibration file paths/raw media/mock scores are not persisted; config key order stable', () => {
  const result = sample(); assert.doesNotMatch(JSON.stringify(result), /private|file\.json|risk|stride|video|landmark/);
  const valid = sanitizeSensorSample(result, now); assert.equal(valid.values.fog, 100);
  assert.equal(stableJson({ b: 2, a: 1 }), stableJson({ a: 1, b: 2 }));
});
test('malformed raw pressure cannot become saved zero pressure through normalization', () => {
  const s = live(); s.hardware.raw.pressure = Array(4).fill(null); s.hardware.raw.bilateral_pressure.left = Array(4).fill(null);
  const result = buildSensorSample(s, 'P01', 'x', now);
  assert.equal(result.values.pressure, undefined); assert.equal(result.values.loadDifference, undefined); assert.equal(result.values.temperature, 31);
});
test('daily storage survives reopening, aggregates and deduplicates across clients', (t) => {
  const dir = temp(t), first = createTrendStore(dir, () => now), second = createTrendStore(dir, () => now + 1000);
  const a = first.append(sample()); assert.equal(second.append(sample()).duplicate, true);
  const next = sample(now + 1000); next.values.temperature = 33; second.append(next);
  const row = first.list().rows[0]; assert.equal(row.id, a.id); assert.equal(row.sampleCount, 2); assert.equal(row.stats.temperature.sum, 64); assert.equal(row.stats.temperature.count, 2); assert.equal(row.seconds, undefined);
});
test('people, sensor channels and setup changes form separate daily records', (t) => {
  const store = createTrendStore(temp(t), () => now); store.append(sample()); store.append(sample(now, 'P02'));
  const changed = sample(); changed.condition.setup = '다른 보행 환경'; store.append(changed);
  const channels = sample(); channels.condition.thermalChannels = ['heel', 'toe']; store.append(channels);
  assert.equal(store.list().rows.length, 4);
});
test('inadequate sensor samples stay unknown and denominators are metric-specific', () => {
  const rows = [{ participant: 'P01', conditionKey: 'a', day: '2026-09-09', sampleCount: 20, stats: { temperature: { sum: 310, count: 10 }, fog: { sum: 0, count: 9 } } }];
  assert.equal(sensorDays(rows, 'P01', 'a', 'fog')[0].value, null);
  assert.equal(sensorDays(rows, 'P01', 'a', 'temperature')[0].value, 31);
  assert.equal(sensorDays(rows, 'P02', 'a', 'temperature').length, 0);
});
test('invalid payloads, values, unilateral differences and old/future samples rejected', () => {
  for (const mutate of [(s) => s.source = 'mock', (s) => s.values.fog = 50, (s) => s.values.temperature = NaN, (s) => s.values.unknown = 2, (s) => s.condition.bilateral = false, (s) => s.at = new Date(now - 61000).toISOString(), (s) => s.at = new Date(now + 61000).toISOString(), (s) => s.condition.baseline = { private: 'text' }, (s) => s.participant = '']) { const s = sample(); mutate(s); assert.throws(() => sanitizeSensorSample(s, now)); }
});
test('30-day retention and bounded delete preserve unrelated files', (t) => {
  const dir = temp(t); let clock = now; const store = createTrendStore(dir, () => clock); const old = store.append(sample());
  fs.writeFileSync(path.join(dir, 'keep.txt'), 'keep');
  clock += 29 * 86400000; assert.equal(store.list().rows.length, 1);
  clock += 86400000; assert.equal(store.list().rows.length, 0); assert.equal(fs.existsSync(path.join(dir, `daily-${old.id}.json`)), false);
  const saved = store.append(sample(clock)); assert.throws(() => store.remove('../keep.txt')); store.remove(saved.id);
  assert.equal(fs.readFileSync(path.join(dir, 'keep.txt'), 'utf8'), 'keep');
});
test('lock conflicts never steal locks and atomic-write failure preserves saved data', (t) => {
  const dir = temp(t), store = createTrendStore(dir, () => now); store.append(sample());
  const lock = path.join(dir, '.trend-write.lock'); fs.writeFileSync(lock, 'test'); assert.throws(() => store.append(sample()), (e) => e.status === 409); assert.equal(fs.readFileSync(lock, 'utf8'), 'test'); fs.rmSync(lock);
  const original = fs.renameSync;
  try { fs.renameSync = () => { throw new Error('simulated rename failure'); }; assert.throws(() => store.append(sample(now + 1000)), /simulated/); }
  finally { fs.renameSync = original; }
  assert.equal(store.list().rows[0].sampleCount, 1); assert.equal(fs.existsSync(lock), false); assert.equal(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')).length, 0);
});
test('empty UI, conditional comparisons, escaping and non-fake report content', () => {
  const html = renderTrendsContent(); for (const key of ['data-trend-date', 'data-trend-comparison', 'data-trend-consent', 'data-trend-rom', 'data-trend-sensor', 'data-trend-metric']) assert.match(html, new RegExp(key));
  assert.match(html, /30일/); assert.match(html, /0으로 채우지/);
  assert.doesNotMatch(renderReportsContent(initialState), /82%|\+6\.8/);
  const comparison = renderComparison([{ day: '2026-09-09', count: 1, total: 1, excluded: 0, value: 0 }], '2026-09-09', 'yesterday', { label: '<img onerror=bad>' });
  assert.match(comparison, /비교 대기/); assert.doesNotMatch(comparison, /<img/);
  assert.match(renderDailyChart([], '2026-09-09', '°'), /유효 기록이 없습니다/);
});
test('real HTTP local API saves, denies cross-origin and malformed bodies, and deletes', async (t) => {
  const server = http.createServer(createTrendHandler(temp(t))); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/trends`;
  const send = (body, method = 'POST', headers = {}) => fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const result = await send(sample(Date.now())); assert.equal(result.status, 200); const id = (await result.json()).id;
  assert.equal((await (await fetch(url)).json()).rows.length, 1);
  assert.equal((await fetch(url, { headers: { Origin: 'https://bad.example' } })).status, 403);
  const remoteHostStatus = await new Promise((resolve, reject) => { const req = http.get(url, { headers: { Host: '192.168.4.1' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); req.on('error', reject); });
  assert.equal(remoteHostStatus, 403);
  assert.equal((await send(null)).status, 400); assert.equal((await send({ big: 'x'.repeat(25000) })).status, 413);
  assert.equal((await send({ id }, 'DELETE')).status, 400);
  assert.equal((await send({ id, confirm: 'DELETE_SENSOR_DAY' }, 'DELETE')).status, 200);
  assert.equal((await (await fetch(url)).json()).rows.length, 0);
});
