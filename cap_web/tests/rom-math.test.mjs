import test from "node:test";
import assert from "node:assert/strict";
import { analyzePose, jointAngle, vectorAngle, quantile, summarizeSession, comparisonKey, compareSessions, referenceError, metricsForView } from "../src/mediapipe/rom-math.js";
import { cameraErrorMessage, csvForSession } from "../src/mediapipe/rom-controller.js";
import { config, session, pose } from "./rom-fixtures.mjs";
const analyze = (p, overrides = {}) => analyzePose([p], { ...config(), directionConfirmed: true, ...overrides });
test("known angles and degenerate vectors", () => {
  assert.equal(vectorAngle([1, 0], [0, 1]), 90);
  assert.equal(vectorAngle([1, 0], [-1, 0]), 180);
  assert.equal(vectorAngle([0, 0], [1, 0]), null);
  assert.equal(vectorAngle([NaN, 0], [1, 0]), null);
  assert.equal(jointAngle({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }), 90);
});
test("front and side protocols expose only appropriate joints", () => {
  assert.deepEqual(metricsForView("front").map(([id]) => id), ["left_shoulder", "right_shoulder"]);
  assert.equal(metricsForView("left").length, 5); assert.equal(metricsForView("right").length, 5);
});
test("ankle raw angle, knee flexion and elbow flexion", () => {
  const result = analyze(pose());
  assert.equal(result.valid, true); assert.equal(result.primary, 90);
  assert.equal(result.values.left_knee, 0); assert.equal(result.values.left_elbow, 90);
  assert.equal(result.values.left_hip, 0);
  assert.equal(analyze(pose("front"), { view: "front", metric: "left_shoulder" }).primary, 90);
  assert.equal(analyze(pose("right"), { view: "right", metric: "right_ankle" }).valid, true);
});
test("angles use pixel coordinates, not distorted normalized coordinates", () => {
  const p = pose(); p[25] = { ...p[25], x: .55, y: .74 };
  assert.equal(analyze(p).primary, 36.9); // atan2(.1*720, .1*960)
  assert.equal(analyze(p, { width: 1920, height: 1440 }).primary, 36.9);
  const mirrored = p.map((point) => ({ ...point, x: 1 - point.x }));
  assert.equal(analyze(mirrored).primary, 36.9);
});
test("missing or multiple people and unconfirmed direction block measurement", () => {
  for (const poses of [[], [pose(), pose()], [[{}]]]) assert.equal(analyzePose(poses, { ...config(), directionConfirmed: true }).valid, false);
  assert.equal(analyze(pose(), { directionConfirmed: false }).valid, false);
  assert.equal(analyze(pose(), { metric: "right_knee" }).valid, false);
  assert.equal(analyze(pose(), { width: 0 }).valid, false);
});
test("occlusion, missing confidence, edge clipping and tiny foot suppress angles", () => {
  for (const change of [{ visibility: .5 }, { presence: .2 }, { visibility: undefined }, { x: 0 }, { x: NaN }]) {
    const p = pose(); Object.assign(p[31], change);
    const result = analyze(p); assert.equal(result.valid, false); assert.equal(result.primary, null);
  }
  const p = pose(); p[31] = { ...p[29] }; assert.equal(analyze(p).valid, false);
});
test("coarse camera-plane and subject-size guards", () => {
  assert.equal(analyze(pose("front")).valid, false);
  assert.equal(analyze(pose(), { view: "front", metric: "left_shoulder" }).valid, false);
  const p = pose(); p[23].y = .22; assert.equal(analyze(p).valid, false);
});
test("completed observations are eligible; interruption and missing samples are not", () => {
  const s = session(); assert.equal(s.summary.eligible, true); assert.equal(s.summary.validRatio, 1);
  assert.equal(summarizeSession(s.samples, s.config.metric, 15000, true).eligible, false);
  assert.equal(summarizeSession(s.samples.slice(0, 20), s.config.metric, 15000).eligible, false);
  assert.equal(summarizeSession(s.samples, s.config.metric, 21000).eligible, false);
  assert.equal(summarizeSession([], s.config.metric, 0).validRatio, 0);
  const lost = s.samples.map((v, i) => ({ ...v, valid: i < 50 }));
  assert.equal(summarizeSession(lost, s.config.metric, 15000).eligible, false);
});
test("robust observed range limits single-frame spikes; not full clinical ROM", () => {
  const s = session(); s.samples[0].values.left_ankle = 180;
  const stats = summarizeSession(s.samples, "left_ankle", 15000).byMetric.left_ankle;
  assert.equal(stats.max, 180); assert.ok(stats.observedRange < 20);
  assert.equal(quantile([0, 10, 20], .5), 10); assert.equal(quantile([], .5), null);
});
test("baseline comparisons isolate person, side, posture, protocol and camera conditions", () => {
  const baseline = session(), current = session();
  current.summary.byMetric.left_ankle.observedRange += 5;
  assert.equal(compareSessions(current, baseline).delta, 5);
  for (const [key, value] of Object.entries({ participant: "P02", view: "right", metric: "left_knee", posture: "standing", setup: "다른 위치", confidence: .85, protocol: "v2", modelVersion: "v2", width: 1280 })) {
    const changed = { ...current, config: { ...current.config, [key]: value } };
    assert.notEqual(comparisonKey(changed), comparisonKey(baseline)); assert.equal(compareSessions(changed, baseline), null);
  }
  assert.equal(compareSessions(session({ interrupted: true }), baseline), null);
});
test("manual reference reports absolute error, signed bias, and sample count", () => {
  assert.equal(referenceError([]), null);
  assert.deepEqual(referenceError([{ estimated: 95, reference: 90 }, { estimated: 87, reference: 90 }]), { count: 2, mae: 4, bias: 1, maxError: 5 });
});
test("CSV protects spreadsheet formulas and preserves missing values", () => {
  const s = session({ config: { participant: "=P01", setup: '쉼표,따옴표"' } });
  s.samples[0].values = {}; const csv = csvForSession(s);
  assert.ok(csv.startsWith("\uFEFF")); assert.ok(csv.includes('"\'=P01"')); assert.ok(csv.includes('"쉼표,따옴표"""'));
  assert.ok(csv.split("\r\n")[1].endsWith('"","","",""')); assert.equal(csv.split("\r\n").length, 76);
});
test("camera errors have actionable permission/device guidance", () => {
  assert.match(cameraErrorMessage({ name: "NotAllowedError" }), /권한/);
  assert.match(cameraErrorMessage({ name: "NotFoundError" }), /웹캠/);
  assert.match(cameraErrorMessage({ name: "NotReadableError" }), /다른/);
  assert.match(cameraErrorMessage({ name: "OverconstrainedError" }), /해상도/);
});
