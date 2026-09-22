import test from 'node:test';
import assert from 'node:assert/strict';
import { recordingReadiness } from '../src/mediapipe/rom-controller.js';
import { analyzePose } from '../src/mediapipe/rom-math.js';
import { renderMediaPipeContent } from '../src/views/mediapipe-view.js';
import { config, pose } from './rom-fixtures.mjs';

const settings = config({ view: 'front', metric: 'left_shoulder', directionConfirmed: true });
const readyState = { ...settings, consent: true, running: true, fresh: true, analysis: analyzePose([pose('front')], settings) };

test('recording is enabled only with a fresh valid pose and completed setup', () => {
  assert.equal(recordingReadiness(readyState).ready, true);
  const cases = [
    [{ consent: false }, /동의/],
    [{ starting: true, running: false }, /준비 중/],
    [{ running: false }, /웹캠 켜기/],
    [{ participant: '  ' }, /사용자 코드/],
    [{ setup: '' }, /촬영 환경 코드/],
    [{ directionConfirmed: false }, /체크/],
    [{ analysis: null }, /관절 인식/],
    [{ fresh: false }, /최신 관절/],
    [{ recording: {} }, /기록 중/],
    [{ pendingSave: true }, /저장/],
  ];
  for (const [overrides, expected] of cases) {
    const result = recordingReadiness({ ...readyState, ...overrides });
    assert.equal(result.ready, false, JSON.stringify(overrides));
    assert.match(result.reason, expected);
  }
});

test('record button explains the actual pose rejection without weakening quality checks', () => {
  const hiddenHip = pose('front'); hiddenHip[23].visibility = .1;
  for (const poses of [[], [pose('front'), pose('front')], [hiddenHip]]) {
    const analysis = analyzePose(poses, settings);
    const result = recordingReadiness({ ...readyState, analysis });
    assert.equal(result.ready, false);
    assert.equal(result.reason, analysis.reason);
  }
});

test('recording help is visible beside the button and linked for accessibility', () => {
  const html = renderMediaPipeContent();
  assert.match(html, /id="rom-record-help" data-rom-record-help role="status"/);
  assert.match(html, /data-rom-action="record" aria-describedby="rom-record-help"/);
});
