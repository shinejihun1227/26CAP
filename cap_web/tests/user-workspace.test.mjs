import test from 'node:test';
import assert from 'node:assert/strict';
import { navItems, initialState } from '../src/data/dashboard-data.js';
import { renderMediaPipeContent } from '../src/views/mediapipe-view.js';
import { renderRecordsContent } from '../src/views/records-view.js';
import { renderTrendsContent } from '../src/views/trends-view.js';
import { renderMobileApp } from '../src/mobile/mobile-app.js';
import { renderSetViews } from '../src/mediapipe/set-view.js';

test('four everyday tasks are separate from settings and data management', () => {
  assert.deepEqual(navItems.filter(i => i.group !== 'manage').map(i => i.id), ['overview', 'live', 'mediapipe', 'trends']);
  assert.deepEqual(navItems.filter(i => i.group === 'manage').map(i => i.id), ['devices', 'records']);
});

test('measurement preserves save and recording controls while moving sets and history out of sight', () => {
  const html = renderMediaPipeContent();
  assert.match(html, /data-rom-mode="measure"/);
  assert.match(html, /<div hidden><section class="rom-set-panel"/);
  assert.match(html, /class="rom-history-panel" hidden/);
  for (const id of ['record', 'save', 'abort']) assert.match(html, new RegExp(`data-rom-action="${id}"(?! hidden)`));
  assert.match(html, /data-view="records"/);
});

test('records has one controller of each kind, grouping tools, and no camera start surface', () => {
  const html = renderRecordsContent();
  assert.equal((html.match(/data-rom-root/g) ?? []).length, 1);
  assert.equal((html.match(/data-trends-root/g) ?? []).length, 1);
  assert.match(html, /data-rom-mode="manage"/);
  assert.match(html, /data-trends-mode="manage"/);
  assert.match(html, /aria-label="웹캠 관절 분석" hidden/);
  for (const action of ['set-create', 'set-json', 'set-csv', 'clear']) assert.equal(html.split(`data-rom-action="${action}"`).length, 2);
  assert.doesNotMatch(renderSetViews(null, [], { capture: false }), /set-capture/);
});

test('comparison has no visible recorder or export, management retains them', () => {
  assert.match(renderTrendsContent(), /<div hidden><div class="trends-recorder"/);
  assert.match(renderTrendsContent(), /data-trend-action="export" hidden/);
  assert.doesNotMatch(renderTrendsContent({ manage: true }), /<div hidden><div class="trends-recorder"/);
});

test('mobile shares all measurement pages and has only four bottom tabs', () => {
  for (const view of navItems.map(i => i.id)) {
    const html = renderMobileApp(structuredClone(initialState), view);
    const tabs = html.match(/<nav class="mobile-tabbar"[\s\S]*?<\/nav>/)?.[0];
    assert.equal((tabs.match(/data-view=/g) ?? []).length, 4);
    assert.equal((html.match(/<main[ >]/g) ?? []).length, 1);
    assert.doesNotMatch(html, /undefined|NaN/);
  }
});
