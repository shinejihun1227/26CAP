import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initialState } from '../src/data/dashboard-data.js';
import { createDefaultRehabState } from '../src/data/gait-algorithms.js';
import { renderOverview, overviewPresentation } from '../src/views/overview-view.js';
import { aiPresentation, renderAiStatusCard } from '../src/components/ai-status-card.js';
import { connectionSummary } from '../src/components/connection-summary.js';
import { renderSidebar } from '../src/components/sidebar.js';
import { captureViewContinuity, restoreViewContinuity } from '../src/utils/view-continuity.js';

function hardwareState() {
  return { ...structuredClone(initialState), dataSource: 'esp32', aiEnabled: false,
    connected: false, paused: false, events: [], rehab: createDefaultRehabState(true),
    hardware: { transport: 'sta', feet: {}, sensors: {} },
    metrics: { risk: null, steps: 0, balance: null, temperature: null, humidity: null },
    thermal: { left: [], right: [] } };
}

function connect(state, sides = ['left', 'right']) {
  state.connected = sides.length > 0;
  state.rehab.config.activeFoot = 'left';
  state.hardware.feet = Object.fromEntries(['left', 'right'].map((side) => [side, { connected: sides.includes(side) }]));
  return state;
}

const metricValues = (html) => [...html.matchAll(/class="metric-value"><span data-live-copy>(.*?)<\/span>/g)].map((match) => match[1]);

test('offline overview is explicit and never presents absent readings as zero or normal', () => {
  const state = hardwareState(), html = renderOverview(state);
  assert.match(html, /깔창 0\/2 연결/);
  assert.match(html, /깔창 연결을 기다리고 있어요/);
  assert.match(html, /기기 연결 확인/);
  assert.match(html, /아직 기록된 변화가 없어요/);
  assert.match(html, /AI 분석은 꺼져 있어요/);
  assert.deepEqual(metricValues(html), ['—', '—', '—', '—']);
  assert.doesNotMatch(html, /김서준|어제보다|새 알림 없음|현재 센서 규칙에서 큰 변화/);
  assert.equal(overviewPresentation(state).risk, null);
});

test('one connected foot does not imply the selected foot is receiving data', () => {
  const state = connect(hardwareState(), ['right']);
  // Deliberately stale selected-foot metric must stay hidden.
  state.metrics.risk = 22; state.metrics.steps = 156;
  const before = JSON.stringify(state);
  const presentation = overviewPresentation(state), html = renderOverview(state);
  assert.equal(presentation.connection.count, 1);
  assert.equal(presentation.usable, false);
  assert.equal(presentation.risk, null);
  assert.equal(presentation.view, 'devices');
  assert.match(html, /왼발 연결을 기다리고 있어요/);
  assert.match(html, /깔창 1\/2 연결/);
  assert.equal(metricValues(html)[0], '—');
  assert.equal(JSON.stringify(state), before, 'rendering must not change foot selection or hardware state');
});

test('connected readings keep legitimate zero, explicit units and actual measured values', () => {
  const state = connect(hardwareState());
  state.metrics = { risk: 0, steps: 0, balance: 86, temperature: 31.8, humidity: 48 };
  const html = renderOverview(state);
  assert.deepEqual(metricValues(html), ['0', '86', '31.8', '48']);
  assert.match(html, /좌우 하중 균형/);
  assert.match(html, />86<\/span><small>점<\/small>/);
  assert.match(html, /이번 측정 걸음 수/);
  assert.equal(overviewPresentation(state).risk, 0);
});

test('connected but incomplete measurement does not masquerade as a valid observation', () => {
  const state = connect(hardwareState());
  const html = renderOverview(state);
  assert.match(html, /센서 측정을 준비하고 있어요/);
  assert.match(html, /개인 기준 필요/);
  state.rehab.calibration.status = 'ready';
  assert.match(renderOverview(state), /센서값 대기/);
  state.hardware.sensors = { pressure: { ready: true }, imu: { ready: true } };
  assert.match(renderOverview(state), /새 알림 없음/);
});

test('AI disabled, offline, unavailable, warming-up and paused states suppress stale scores', () => {
  const state = connect(hardwareState());
  state.ai = { available: true, ready: true, deviceConnected: true, status: 'confirmed', score: .94 };
  assert.equal(aiPresentation(state).status, 'disabled');
  assert.equal(aiPresentation(state).score, null);
  assert.doesNotMatch(renderAiStatusCard(state, { compact: true }), /94점/);
  state.aiEnabled = true; state.connected = false;
  assert.equal(aiPresentation(state).status, 'device_offline');
  assert.equal(aiPresentation(state).score, null);
  state.connected = true; state.ai.available = false;
  assert.equal(aiPresentation(state).status, 'unavailable');
  assert.equal(aiPresentation(state).score, null);
  state.ai.available = true; state.ai.ready = false;
  assert.equal(aiPresentation(state).status, 'warming_up');
  assert.equal(aiPresentation(state).score, null);
  state.ai.ready = true; state.paused = true;
  assert.equal(aiPresentation(state).status, 'paused');
  assert.equal(aiPresentation(state).score, null);
});

test('only a ready AI with a finite numeric output has a score, not a disease probability', () => {
  const state = connect(hardwareState()); state.aiEnabled = true;
  state.ai = { available: true, ready: true, deviceConnected: true, status: 'normal', score: .27 };
  assert.equal(aiPresentation(state).score, .27);
  assert.match(renderAiStatusCard(state, { compact: true }), /27점/);
  assert.match(renderAiStatusCard(state), /모델 점수/);
  assert.doesNotMatch(renderAiStatusCard(state).replace(/<[^>]*>/g, ''), /정상|27%/);
  for (const invalid of [null, undefined, NaN, Infinity, '', false, 'NaN']) {
    state.ai.score = invalid;
    assert.equal(aiPresentation(state).score, null);
  }
});

test('pausing keeps a clear resume action and does not mislabel temperature as a missing sensor', () => {
  const state = connect(hardwareState());
  state.metrics = { risk: 24, steps: 324, balance: 86, temperature: 32, humidity: 51 };
  state.thermal = structuredClone(initialState.thermal); state.paused = true;
  const html = renderOverview(state);
  assert.match(html, /data-action="toggle-pause"/);
  assert.match(html, /화면 갱신 재개/);
  assert.match(html, /화면 갱신 정지/);
  assert.deepEqual(metricValues(html), ['—', '—', '—', '—']);
  assert.doesNotMatch(html, /°C 차이|양발 센서 필요/);
});

test('demo data is visibly identified and main measurements precede optional technical detail', () => {
  const html = renderOverview(structuredClone(initialState));
  assert.match(html, /시연 모드 · 예시 수치/);
  assert.match(html, /실제 측정값이 아닙니다/);
  assert.ok(html.indexOf('data-insight="ai"') < html.indexOf('핵심 측정값'));
  assert.ok(html.indexOf('data-insight="ai"') < html.indexOf('data-ui-disclosure="overview-guide"'));
  assert.match(html, /<details class="overview-details" data-ui-disclosure="overview-guide">/);
  assert.match(html, /카메라는 직접 시작할 때만 켜집니다/);
  assert.doesNotMatch(html, /<video|autoplay|getUserMedia/);
});

test('profile and recorded event text is escaped', () => {
  const state = hardwareState();
  state.profile = { configured: true, name: '<img src=x onerror=alert(1)>', mode: '<script>x</script>' };
  state.events = [{ title: '<script>alert(1)</script>', detail: '<img src=x>', time: '<b>now</b>', tone: '\" onclick=evil()' }];
  const html = renderOverview(state);
  assert.doesNotMatch(html, /<script>|<img|class="clarity-event-icon[^>]+onclick=/);
  assert.match(html, /&lt;script&gt;/);
});

test('Korean navigation names, active-page semantics and connection tones agree', () => {
  const state = hardwareState();
  assert.equal(connectionSummary(state).tone, 'waiting');
  let html = renderSidebar('overview', state);
  assert.match(html, /data-view="overview" aria-current="page"/);
  assert.match(html, /<b>오늘 요약<\/b>/);
  assert.match(html, /<b>관절 움직임<\/b>/);
  assert.match(html, /sidebar-footer connection-waiting/);
  connect(state, ['left']); assert.equal(connectionSummary(state).tone, 'partial');
  connect(state); assert.equal(connectionSummary(state).tone, 'connected');
  state.paused = true; assert.equal(connectionSummary(state).tone, 'paused');
});

// Minimal DOM doubles exercise refresh continuity without opening a browser or camera.
function fakeRoot({ open = false, focus = 'summary' } = {}) {
  const document = {};
  const summary = { focus: (options) => { document.activeElement = summary; document.focusOptions = options; } };
  const details = { dataset: { uiDisclosure: 'overview-guide' }, open, querySelector: () => summary };
  const buttons = [0, 1].map(() => ({
    hasAttribute: (attribute) => attribute === 'data-view',
    getAttribute: (attribute) => attribute === 'data-view' ? 'devices' : null,
    matches: () => true,
    focus(options) { document.activeElement = this; document.focusOptions = options; },
  }));
  document.activeElement = focus === 'summary' ? summary : focus === 'second-button' ? buttons[1] : null;
  const root = {
    ownerDocument: document,
    contains: (node) => node === summary || buttons.includes(node),
    querySelectorAll: (selector) => selector.startsWith('details') ? [details] : buttons,
  };
  return { root, document, summary, details, buttons };
}

test('open glossary and summary focus survive repeated refreshes without scrolling', () => {
  const old = fakeRoot({ open: true });
  const saved = captureViewContinuity(old.root);
  const next = fakeRoot({ focus: null });
  restoreViewContinuity(next.root, saved);
  assert.equal(next.details.open, true);
  assert.equal(next.document.activeElement, next.summary);
  assert.deepEqual(next.document.focusOptions, { preventScroll: true });
  next.details.open = false;
  const final = fakeRoot({ focus: null });
  restoreViewContinuity(final.root, captureViewContinuity(next.root));
  assert.equal(final.details.open, false);
});

test('same-destination buttons keep their own focus; navigation can skip restoration', () => {
  const old = fakeRoot({ focus: 'second-button' });
  const next = fakeRoot({ focus: null });
  restoreViewContinuity(next.root, captureViewContinuity(old.root));
  assert.equal(next.document.activeElement, next.buttons[1]);
  const newScreen = fakeRoot({ focus: null });
  restoreViewContinuity(newScreen.root, null);
  assert.equal(newScreen.document.activeElement, null);
});

test('shared editor uses humidity identity and the refresh hook is same-screen only', () => {
  const editor = fs.readFileSync(new URL('../src/editor/editor-view.js', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(editor, /id: "metric-humidity", selector: "\.metrics-grid/);
  assert.match(editor, /selector: "\.overview-start-card"/);
  assert.match(editor, /selector: "\.overview-details"/);
  assert.match(main, /renderedView === activeView \? captureViewContinuity\(app\) : null/);
  assert.match(main, /restoreViewContinuity\(app, continuity\)/);
  assert.ok(index.indexOf('compact-readability.css') > index.indexOf('readability-v2.css'));
});

test('compact style keeps desktop navigation vertical and gives narrow menus readable space', () => {
  const css = fs.readFileSync(new URL('../src/styles/compact-readability.css', import.meta.url), 'utf8');
  assert.match(css, /\.primary-nav \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*?\.primary-nav \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}/);
  assert.match(css, /\.overview-insight p \{[^}]*font-size: 1rem/);
  assert.match(css, /focus-visible \{ outline: 3px/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
