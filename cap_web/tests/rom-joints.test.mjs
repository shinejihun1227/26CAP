import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { METRICS, VIEWS, analyzePose, compareSessions } from '../src/mediapipe/rom-math.js';
import { JOINT_GROUPS, resolveJointSelection, renderJointOptions, jointGuide, renderJointGuide, renderLandmarkGuide, renderLiveJointMetrics } from '../src/mediapipe/rom-joints.js';
import { renderMediaPipeContent } from '../src/views/mediapipe-view.js';
import { createRomStore, createRomHandler, sanitizeConfig } from '../server/rom-store.mjs';
import { config, session, pose } from './rom-fixtures.mjs';
import { romGroups } from '../src/trends/trend-math.js';
import { csvForSession } from '../src/mediapipe/rom-controller.js';

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stepon-joints-test-'));
  t.after(() => { assert.equal(path.dirname(dir), path.resolve(os.tmpdir())); assert.ok(path.basename(dir).startsWith('stepon-joints-test-')); fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

test('new measurement selector offers only left and right ankle, historical joints remain readable', () => {
  assert.equal(JOINT_GROUPS.length, 1);
  const ids = JOINT_GROUPS.flatMap((g) => g.metrics);
  assert.equal(ids.length, 2); assert.equal(new Set(ids).size, 2);
  assert.deepEqual([...ids].sort(), ['left_ankle','right_ankle'].sort());
  const html = renderJointOptions('right_ankle');
  assert.equal((html.match(/<option /g) ?? []).length, 2);
  assert.equal((html.match(/ selected/g) ?? []).length, 1);
  assert.match(html, /value="right_ankle" selected/);
  assert.doesNotMatch(html, /몸통–허벅지|무릎/); assert.match(html, /발목/);
  for (const id of ids) { assert.match(html, new RegExp(`value="${id}"`)); assert.ok(jointGuide(id)); }
});

test('choosing any joint from any view moves to its permitted measurement plane', () => {
  for (const view of Object.keys(VIEWS)) for (const metric of Object.keys(METRICS)) {
    const result = resolveJointSelection(metric, view, 'metric');
    assert.equal(result.metric, metric); assert.ok(METRICS[metric].views.includes(result.view));
    assert.doesNotThrow(() => sanitizeConfig(config(result)));
  }
});

test('changing camera side keeps the same joint when possible, and never mixes planes', () => {
  for (const joint of ['elbow', 'knee', 'ankle', 'hip', 'shoulder_flexion']) {
    assert.deepEqual(resolveJointSelection(`left_${joint}`, 'right'), { view: 'right', metric: `right_${joint}` });
    assert.deepEqual(resolveJointSelection(`right_${joint}`, 'left'), { view: 'left', metric: `left_${joint}` });
  }
  assert.deepEqual(resolveJointSelection('left_knee', 'front'), { view: 'left', metric: 'left_ankle' });
  assert.deepEqual(resolveJointSelection('wrong', 'left'), { view: 'left', metric: 'left_ankle' });
  assert.deepEqual(resolveJointSelection(null, 'wrong'), { view: 'left', metric: 'left_ankle' });
  assert.throws(() => sanitizeConfig(config({ metric: 'left_shoulder_flexion', view: 'front' })));
});

test('new sagittal shoulder elevation measures synthetic 0, 90 and 180 degrees bilaterally', () => {
  for (const side of ['left', 'right']) {
    const shoulder = side === 'left' ? 11 : 12, elbow = side === 'left' ? 13 : 14;
    for (const expected of [0, 90, 180]) {
      const p = pose(side), anchor = p[shoulder];
      p[elbow] = { ...p[elbow], x: expected === 90 ? anchor.x + .15 : anchor.x, y: expected === 0 ? anchor.y + .13 : expected === 90 ? anchor.y : anchor.y - .15 };
      const opts = { ...config({ metric: `${side}_shoulder_flexion`, view: side }), directionConfirmed: true };
      const result = analyzePose([p], opts); assert.equal(result.valid, true); assert.equal(result.primary, expected);
      assert.equal(analyzePose([p.map((point) => ({ ...point, x: 1 - point.x }))], opts).primary, expected);
      p[elbow].visibility = .1; assert.equal(analyzePose([p], opts).valid, false);
    }
  }
});

test('guidance states required visibility, projected definitions and limitations without prescriptions', () => {
  for (const id of Object.keys(METRICS)) {
    const g = jointGuide(id); assert.ok(g.framing && g.setup && g.meaning && g.caution);
    assert.match(renderJointGuide(id), /최대 가동범위 검사·치료 처방이 아닙니다/);
    assert.doesNotMatch(renderJointGuide(id), /완치|치료 효과가|정상 범위는/);
  }
  assert.match(jointGuide('left_ankle').caution, /배굴\/저굴/);
  assert.match(jointGuide('right_hip').caution, /독립 고관절/);
  assert.match(jointGuide('left_shoulder_flexion').caution, /앞\/뒤 방향을 자동 구분하지/);
  assert.equal(jointGuide('left_wrist'), null);
});

test('ankle guide clearly separates the four measured points from framing guidance', () => {
  const ankle = jointGuide('left_ankle');
  assert.deepEqual(ankle.calculationPoints, ['왼쪽 무릎', '왼쪽 발목', '왼쪽 뒤꿈치', '왼쪽 발끝']);
  assert.deepEqual(ankle.orientationPoints, []);
  assert.match(ankle.framing, /정강이부터 발끝까지/);
  assert.match(ankle.orientationWhy, /각도 계산에는 쓰지 않습니다/);
  const image = renderLandmarkGuide('left_ankle');
  assert.match(image, /role="img"/);
  assert.match(image, /뒤꿈치/);
  assert.match(image, /정강이부터 발끝까지 선명하게 보이게 하세요/);
  assert.match(image, /ankle-measure-segment/);
  assert.match(image, /정강이 선의 위쪽/);
  assert.match(image, /각도는 초록 네 점으로 계산해요/);
  const liveAnkle = renderLiveJointMetrics('right', 'right_ankle');
  assert.match(liveAnkle, /data-rom-angle="right_ankle"/);
  assert.doesNotMatch(liveAnkle, /data-rom-angle="right_(knee|hip|elbow)"/);
  assert.match(renderLandmarkGuide('right_knee'), /오른쪽 무릎/);
  assert.notEqual(renderLandmarkGuide('left_shoulder'), image);
});

test('compact measurement view shows camera consent, simple controls and the selected joint points', () => {
  const html = renderMediaPipeContent();
  assert.match(html, /사용자 코드 \(측정 코드\)/); assert.match(html, /P01 = 한 사람의 기록 이름표/);
  assert.match(html, /data-rom-consent/); assert.match(html, /data-rom-action="start"/);
  assert.match(html, /data-rom-step="camera"/); assert.match(html, /data-rom-step="pose"/);
  assert.match(html, /data-rom-landmark-guide/); assert.match(html, /무릎, 발목, 뒤꿈치, 발끝/);
  assert.match(html, /data-rom-step="record"[\s\S]*data-rom-action="record"/);
  assert.equal((html.match(/data-rom-config="metric"/g) ?? []).length, 1);
  assert.equal((html.match(/<optgroup /g) ?? []).length, 1);
  assert.match(html, /data-rom-joint-guide/); assert.match(html, /data-rom-consent/);
  assert.match(html, /부상 위험 판정이나 의료적 안전 한계가 아닙니다/);
  const cards = renderLiveJointMetrics('right', 'right_elbow');
  assert.equal((cards.match(/is-selected/g) ?? []).length, 1);
  assert.match(cards, /right_shoulder_flexion/); assert.doesNotMatch(cards, /left_knee/);
});

test('all joints save and reopen; previous shoulder abduction baseline remains separate', (t) => {
  const dir = temporary(t), store = createRomStore(dir);
  const saved = Object.entries(METRICS).map(([id, m]) => store.saveSession(session({ config: { metric: id, view: m.views[0] } })));
  const previous = saved.find((r) => r.config.metric === 'left_shoulder'), added = saved.find((r) => r.config.metric === 'left_shoulder_flexion');
  store.setBaseline(previous.id); store.setBaseline(added.id);
  const reopened = createRomStore(dir).list(); assert.equal(reopened.sessions.length, 12);
  assert.deepEqual(new Set(reopened.baselineIds), new Set([previous.id, added.id]));
  assert.equal(compareSessions(added, previous), null);
  assert.equal(romGroups(reopened.sessions, 'P01').length, 12);
  assert.equal(reopened.metricIds.length, 12);
  assert.match(csvForSession(added), /left_shoulder_flexion_deg/);
});

test('new joints work through HTTP store; wrong-plane records fail without altering data', async (t) => {
  const server = http.createServer(createRomHandler(temporary(t)));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/rom`;
  for (const side of ['left', 'right']) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save_session', record: session({ config: { metric: `${side}_shoulder_flexion`, view: side } }) }) });
    assert.equal(response.status, 200);
  }
  const bad = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save_session', record: session({ config: { metric: 'left_shoulder_flexion', view: 'front' } }) }) });
  assert.equal(bad.status, 400);
  const result = await (await fetch(url)).json(); assert.equal(result.sessions.length, 2); assert.equal(result.metricIds.length, 12);
});
