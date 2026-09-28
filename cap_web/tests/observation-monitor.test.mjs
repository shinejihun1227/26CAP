import test from 'node:test';
import assert from 'node:assert/strict';
import { createObservationMonitor, readObservationFeet, pairedDifference, summarizeFog, OBSERVATION_WINDOW_MS } from '../src/data/observation-monitor.js';
import { renderObservationChart, renderObservationPanel } from '../src/components/observation-panel.js';
import { initialState } from '../src/data/dashboard-data.js';
import { renderLiveView } from '../src/views/live-view.js';

const epoch = Date.parse('2026-09-24T03:00:00Z');
function live(at = epoch, decision = 'normal') {
  const raw = side => ({ foot_side: side, frame: at, boot_id: 'boot', pressure_ready: true, pressure: [10, 20, 30, 40] });
  return { ...structuredClone(initialState), dataSource: 'esp32', connected: true, paused: false, sensorReceivedAt: at, sensorAdvancedAt: at,
    ai: { available: true, ready: true, windowReady: true, deviceConnected: true, lastWindowAtMs: at, state: decision, selectedFoot: 'left', model: 'test' },
    hardware: { transport: 'sta', feet: Object.fromEntries(['left', 'right'].map(side => [side, { connected: true, age_ms: 0, state: raw(side) }])) },
    thermal: { left: [{ site: 'heel', temp: 30, humidity: 50, available: true }], right: [{ site: 'heel', temp: 32, humidity: 55, available: true }] } };
}

test('one continuous confirmed interval counts once; repeated API polls do not extend it', () => {
  const monitor = createObservationMonitor();
  for (const [seconds, state] of [[0, 'normal'], [1, 'confirmed'], [2, 'confirmed'], [3, 'confirmed'], [4, 'normal']]) {
    const at = epoch + seconds * 1000;
    monitor.observeAi(live(at, state), at);
    monitor.observeAi(live(at, state), at + 100);
  }
  const summary = summarizeFog(monitor.snapshot(), epoch, epoch + 5000);
  assert.equal(summary.count, 1); assert.equal(summary.total, 3); assert.equal(summary.longest, 3);
  assert.equal(summary.observedSeconds, 4); assert.equal(summary.events[0].interrupted, false); assert.equal(summary.events[0].partialStart, false);
});

test('stale, paused, offline and unavailable AI close partial events without counting missing time', () => {
  for (const override of [{ paused: true }, { connected: false }, { aiEnabled: false }, { dataSource: 'mock' }, { ai: { available: false } }]) {
    const monitor = createObservationMonitor();
    monitor.observeAi(live(epoch, 'confirmed'), epoch);
    monitor.observeAi(live(epoch + 1000, 'confirmed'), epoch + 1000);
    monitor.observeAi({ ...live(epoch + 2000), ...override }, epoch + 2000);
    monitor.observeAi(live(epoch + 10000, 'confirmed'), epoch + 10000);
    const summary = summarizeFog(monitor.snapshot(), epoch, epoch + 10000);
    assert.equal(summary.count, 2); assert.equal(summary.total, 1); assert.equal(summary.events[0].interrupted, true);
    assert.equal(summary.events[1].partialStart, true);
  }
  const monitor = createObservationMonitor();
  monitor.observeAi(live(epoch, 'confirmed'), epoch);
  monitor.observeAi(live(epoch, 'confirmed'), epoch + 3000);
  assert.equal(monitor.snapshot().events[0].open, false);
});

test('restarts split intervals and selected time range clips duration', () => {
  const monitor = createObservationMonitor();
  monitor.observeAi(live(epoch, 'confirmed'), epoch);
  monitor.observeAi(live(epoch + 1000, 'confirmed'), epoch + 1000);
  const changed = live(epoch + 2000, 'confirmed'); changed.ai.artifactId = 'new-model';
  monitor.observeAi(changed, epoch + 2000);
  assert.equal(monitor.snapshot().events.length, 2);
  const summary = summarizeFog(monitor.snapshot(), epoch + 500, epoch + 1000);
  assert.equal(summary.total, .5); assert.equal(summary.events[0].clipped, true);
  assert.equal(summarizeFog({ events: [], windows: [] }, epoch, epoch + 5000).count, null);
});

test('real valid per-foot signals only; missing data never turns into zero', () => {
  const state = live(), feet = readObservationFeet(state, epoch);
  assert.equal(feet.left.pressure, 25); assert.equal(feet.right.temperature, 32);
  assert.equal(readObservationFeet(state, epoch + 3000).left.temperature, null);
  state.hardware.feet.right.age_ms = 3000;
  assert.equal(readObservationFeet(state, epoch).right.pressure, null);
  state.hardware.feet.left.state.pressure = [0, 0, 0, 0];
  assert.equal(readObservationFeet(state, epoch).left.pressure, 0);
  state.hardware.feet.left.state.pressure = [1000, null, 0, 0];
  assert.equal(readObservationFeet(state, epoch).left.pressure, null);
  assert.equal(readObservationFeet({ ...state, dataSource: 'mock' }, epoch).left.temperature, null);
});

test('bilateral temperature/humidity differences require corresponding sites', () => {
  const state = live();
  state.thermal.right.push({ site: 'toe', temp: 40, humidity: 90, available: true });
  const feet = readObservationFeet(state, epoch);
  assert.deepEqual(pairedDifference(feet, 'temperature'), { value: 2, count: 1 });
  assert.deepEqual(pairedDifference(feet, 'humidity'), { value: 5, count: 1 });
  state.thermal.right = state.thermal.right.slice(1);
  assert.equal(pairedDifference(readObservationFeet(state, epoch), 'temperature').value, null);
});

test('repeated sensor frames make graph gaps; history retains at most 30 minutes', () => {
  const monitor = createObservationMonitor();
  monitor.observeSensors(live(), epoch);
  monitor.observeSensors(live(), epoch + 1000);
  assert.equal(monitor.snapshot().points[1].left.temperature, null);
  monitor.observeSensors(live(epoch + OBSERVATION_WINDOW_MS + 2000), epoch + OBSERVATION_WINDOW_MS + 2000);
  assert.equal(monitor.snapshot().points.length, 1);
});

test('chart separates missing intervals and changed thermal channel sets', () => {
  const make = (offset, value, key = 'heel') => ({ at: epoch + offset, left: { temperature: value, temperatureKey: key, frame: `device:boot:${offset}` } });
  const html = renderObservationChart([make(0, 30), make(1000, 31), make(2000, null), make(3000, 33), make(4000, 34, 'toe')], 'temperature', epoch, epoch + 5000);
  const path = html.match(/<path d="([^"]+)"/)[1];
  assert.equal((path.match(/M/g) ?? []).length, 3); assert.equal((path.match(/L/g) ?? []).length, 1);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test('both observation views expose honest scope and preserve existing controls', () => {
  const state = live();
  for (const metric of ['temperature', 'humidity', 'pressure']) {
    const html = renderObservationPanel({ ...state, observationUi: { mode: 'health', metric, minutes: 15 } }, epoch);
    assert.match(html, /발 건강 모니터링/); assert.match(html, /새로고침 시 초기화/);
    assert.match(html, /최근 관찰 요약/); assert.doesNotMatch(html, /NaN|undefined|정상 범위|염증 위험|당뇨발 점수/);
  }
  const html = renderLiveView(state);
  assert.match(html, /FoG 모니터링/); assert.match(html, /data-action="fog-cue-stop"/);
  assert.match(html, /data-ui-disclosure="live-sensors"/); assert.match(html, /data-view="records"/);
});
