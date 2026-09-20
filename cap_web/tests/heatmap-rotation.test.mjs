import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { footLayoutStyle, normalizeFootLayout } from '../src/data/foot-layout.js';
import { initialState } from '../src/data/dashboard-data.js';
import { renderBilateralHeatmap } from '../src/components/bilateral-heatmap.js';

const style = (name) => fs.readFileSync(new URL(`../src/styles/${name}`, import.meta.url), 'utf8');
const base = style('app-overhaul.css'), polish = style('design-polish.css');

test('sensor marker counter-rotation preserves its centering and includes number/value children', () => {
  const rule = base.match(/\.heat-spot \{([^}]+)\}/)[1];
  assert.match(rule, /transform: translate\(-50%, -50%\) rotate\(calc\(0deg - var\(--foot-rotation, 0deg\)\)\) scale\(var\(--heat-spot-scale\)\)/);
  assert.match(rule, /transform-origin: center/);
  assert.match(rule, /--heat-spot-scale: 1/);
  const html = renderBilateralHeatmap(initialState);
  assert.match(html, /data-sensor-index="0"[^>]*><i>1<\/i><b><em>P1<\/em><span>/);
  // Only the marker cancels rotation; rotating the full hotspot container would move sensors off the foot.
  assert.match(base, /\.foot-map-left \.foot-hotspots, \.foot-map-right \.foot-hotspots \{ transform: none; \}/);
});

test('responsive scales do not override the marker counter-rotation', () => {
  assert.match(base, /\.heat-spot \{ --heat-spot-scale: \.86; \}/);
  assert.match(polish, /\.heat-spot \{\s*--heat-spot-scale: \.9;\s*\}/);
  assert.match(polish, /\.heat-spot \{\s*--heat-spot-scale: \.78;\s*\}/);
  const rules = [...base.matchAll(/\.heat-spot\s*\{([^}]+)\}/g), ...polish.matchAll(/\.heat-spot\s*\{([^}]+)\}/g)].map((m) => m[1]);
  assert.equal(rules.filter((rule) => /\btransform:/.test(rule)).length, 1);
});

test('opposite rotations stay side- and mode-specific without changing readings or positions', () => {
  const layout = normalizeFootLayout({ pressure: { left: { rotation: 25 }, right: { rotation: -20 } }, temperature: { left: { rotation: -12 }, right: { rotation: 16 } }, humidity: { left: { rotation: 30 }, right: { rotation: -30 } } });
  const before = JSON.stringify(layout);
  for (const mode of ['pressure', 'temperature', 'humidity']) {
    const html = renderBilateralHeatmap({ ...initialState, heatmapMode: mode, footLayout: layout });
    for (const side of ['left', 'right']) assert.ok(html.includes(footLayoutStyle(mode, side, layout)));
    assert.equal((html.match(/data-sensor-index=/g) ?? []).length, 8);
  }
  assert.equal(JSON.stringify(layout), before);
  assert.match(renderBilateralHeatmap({ ...initialState, footLayout: layout }), /<span>72<\/span>/);
});

test('rotation cancellation keeps horizontal and vertical text axes upright at all supported scales', () => {
  const rotate = ([x, y], degrees) => { const a = degrees * Math.PI / 180; return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]; };
  for (const angle of [-30, -20, -7, 0, 12, 25, 30]) for (const footScale of [.55, .92, 1.35]) for (const markerScale of [1, .9, .86, .78]) {
    const horizontal = rotate(rotate([markerScale, 0], -angle).map((n) => n * footScale), angle);
    const vertical = rotate(rotate([0, markerScale], -angle).map((n) => n * footScale), angle);
    assert.ok(Math.abs(horizontal[1]) < 1e-10); assert.ok(Math.abs(vertical[0]) < 1e-10);
    assert.ok(Math.abs(horizontal[0] - footScale * markerScale) < 1e-10);
    assert.ok(Math.abs(vertical[1] - footScale * markerScale) < 1e-10);
  }
});
