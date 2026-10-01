import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderMobileApp } from '../src/mobile/mobile-app.js';
import { initialState } from '../src/data/dashboard-data.js';

test('easy mode can be turned off from mobile navigation', () => {
  const html = renderMobileApp({ ...structuredClone(initialState), easyMode: true }, 'mediapipe');
  assert.match(html, /data-view="overview" data-easy-exit="true"[^>]*>일반 화면으로/);
});

test('navigation shells are replaced on route changes so button meaning, label and active state stay together', () => {
  const shell = readFileSync(new URL('../src/utils/app-shell.js', import.meta.url), 'utf8');
  assert.match(shell, /nav\.replaceWith\(newNavs\[navIndex\]\)/);
  assert.match(shell, /current\.className = next\.className/);
});

test('frontal camera observes alignment without weekly medical target angles', () => {
  const html = renderMobileApp({ ...structuredClone(initialState), easyMode: true }, 'mediapipe');
  assert.doesNotMatch(html, /rom-weekly-targets|data-rom-week=/);
  assert.match(html, /3초 기준 자세/);
  assert.match(html, /골반선 변화/);
});
