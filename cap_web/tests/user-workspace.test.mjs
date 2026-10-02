import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { navItems, initialState } from '../src/data/dashboard-data.js';
import { renderMediaPipeContent } from '../src/views/mediapipe-view.js';
import { renderRecordsContent } from '../src/views/records-view.js';
import { renderTrendsContent } from '../src/views/trends-view.js';
import { renderMobileApp } from '../src/mobile/mobile-app.js';
import { renderSetViews } from '../src/mediapipe/set-view.js';

test('the compact everyday navigation separates tasks from settings and data management', () => {
  assert.deepEqual(navItems.filter(i => i.group !== 'manage').map(i => i.id), ['overview', 'live', 'ankle', 'mediapipe', 'safety']);
  assert.equal(navItems.find(i => i.id === 'mediapipe').korean, '정면 보행');
  assert.deepEqual(navItems.filter(i => i.group === 'manage').map(i => i.id), ['devices', 'records']);
  const jointHtml = renderMediaPipeContent();
  assert.match(jointHtml, /내 발목 기준 만들기/);
  assert.match(jointHtml, /센서 기준 맞추기/);
  assert.match(jointHtml, /data-rom-step="camera"[\s\S]*data-rom-step="pose"[\s\S]*data-rom-step="record"/);
  assert.match(jointHtml, /data-rom-chart-mode="live"[\s\S]*data-rom-chart-mode="daily"/);
  assert.match(jointHtml, /내 관찰 계획/);
});

test('measurement preserves save and recording controls while moving sets and history out of sight', () => {
  const html = renderMediaPipeContent();
  assert.match(html, /data-rom-mode="measure"/);
  assert.match(html, /<div hidden><section class="rom-set-panel"/);
  assert.match(html, /class="rom-history-panel" hidden/);
  for (const id of ['record', 'save', 'abort']) assert.match(html, new RegExp(`data-rom-action="${id}"(?! hidden)`));
  assert.match(html, /data-view="records"/);
});

test('records separates current data types and keeps old joints in an archive without camera controls', () => {
  const html = renderRecordsContent();
  assert.equal((html.match(/data-records-root/g) ?? []).length, 1);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 4);
  for (const id of ['fog','ankle','front','sensors']) assert.match(html, new RegExp(`data-record-tab="${id}"`));
  assert.doesNotMatch(html, /data-rom-root|data-rom-action|<video|data-trends-root/);
  assert.match(html, /<details class="records-archive" data-record-archive>/);
  assert.match(renderTrendsContent({ manage: true }), /압력·온습도 센서 기록/);
  assert.doesNotMatch(renderSetViews(null, [], { capture: false }), /set-capture/);
});

test('comparison has no visible recorder or export, management retains them', () => {
  assert.match(renderTrendsContent(), /<div hidden><div class="trends-recorder"/);
  assert.match(renderTrendsContent(), /data-trend-action="export" hidden/);
  assert.doesNotMatch(renderTrendsContent({ manage: true }), /<div hidden><div class="trends-recorder"/);
});

test('mobile makes the five current destinations reachable', () => {
  for (const view of navItems.map(i => i.id)) {
    const html = renderMobileApp(structuredClone(initialState), view);
    assert.match(html, /data-action="mobile-fog-sound"/);
    assert.match(html, /휴대폰 소리 알림/);
    const tabs = html.match(/<nav class="mobile-tabbar"[\s\S]*?<\/nav>/)?.[0];
    assert.equal((tabs.match(/data-view=/g) ?? []).length, 5);
    assert.equal((html.match(/<main[ >]/g) ?? []).length, 1);
    assert.doesNotMatch(html, /undefined|NaN/);
  }
});

test('iPhone-width responsive shell reserves safe areas and keeps all six destinations reachable', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../src/styles/iphone-responsive.css', import.meta.url), 'utf8');
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /iphone-responsive\.css/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(styles, /word-break: keep-all/);
  assert.match(styles, /overflow-wrap: anywhere/);
});
