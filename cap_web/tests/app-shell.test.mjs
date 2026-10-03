import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMobileApp } from '../src/mobile/mobile-app.js';
import { initialState } from '../src/data/dashboard-data.js';
import { renderSidebar } from '../src/components/sidebar.js';

test('easy mode can be turned off from mobile navigation', () => {
  const html = renderMobileApp({ ...structuredClone(initialState), easyMode: true }, 'mediapipe');
  assert.match(html, /data-view="overview" data-easy-exit="true"[^>]*>일반 화면으로/);
});

test('navigation labels, destinations and active state agree across summary, range and setup screens', () => {
  for(const [view,label] of [['overview','오늘 요약'],['ankle','발 움직임'],['devices','기기 설정']]) {
    const html=renderSidebar(view,{...structuredClone(initialState),easyMode:true});
    const active=[...html.matchAll(/<button[^>]*data-view="([^"]+)"[^>]*aria-current="page"[^>]*>([\s\S]*?)<\/button>/g)];
    assert.equal(active.length,1);assert.equal(active[0][1],view);assert.ok(active[0][2].includes(label));
  }
});

test('frontal camera observes alignment without weekly medical target angles', () => {
  const html = renderMobileApp({ ...structuredClone(initialState), easyMode: true }, 'mediapipe');
  assert.doesNotMatch(html, /rom-weekly-targets|data-rom-week=/);
  assert.match(html, /2초 기준 맞추기/);
  assert.match(html, /10초 관찰 시작/);
  assert.match(html, /data-front-metric="pelvis"[\s\S]*?처음 골반 높이와 비교/);
});
