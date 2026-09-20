// Screen-plane observations, NOT anatomical 3D ROM or clinical thresholds.
export const PROTOCOL = "stepon-rom-2d-v1";
export const VIEWS = { front: "정면", left: "좌측면", right: "우측면" };
export const CAPTURE_SECONDS = 15;
export const SAMPLE_HZ = 5;
export const METRICS = {
  left_shoulder: { label: "왼쪽 어깨 벌림", views: ["front"], points: [13, 11, 23], kind: "angle" },
  right_shoulder: { label: "오른쪽 어깨 벌림", views: ["front"], points: [14, 12, 24], kind: "angle" },
  // Distinct metric IDs keep sagittal elevation separate from frontal abduction records.
  left_shoulder_flexion: { label: "왼쪽 어깨 앞쪽 들기", views: ["left"], points: [13, 11, 23], kind: "angle" },
  right_shoulder_flexion: { label: "오른쪽 어깨 앞쪽 들기", views: ["right"], points: [14, 12, 24], kind: "angle" },
  left_knee: { label: "왼쪽 무릎 굽힘", views: ["left"], points: [23, 25, 27], kind: "flexion" },
  right_knee: { label: "오른쪽 무릎 굽힘", views: ["right"], points: [24, 26, 28], kind: "flexion" },
  left_ankle: { label: "왼쪽 정강이–발 각도", views: ["left"], points: [25, 27, 29, 31], kind: "segments" },
  right_ankle: { label: "오른쪽 정강이–발 각도", views: ["right"], points: [26, 28, 30, 32], kind: "segments" },
  left_hip: { label: "왼쪽 몸통–허벅지 굽힘", views: ["left"], points: [11, 23, 25], kind: "flexion" },
  right_hip: { label: "오른쪽 몸통–허벅지 굽힘", views: ["right"], points: [12, 24, 26], kind: "flexion" },
  left_elbow: { label: "왼쪽 팔꿈치 굽힘", views: ["left"], points: [11, 13, 15], kind: "flexion" },
  right_elbow: { label: "오른쪽 팔꿈치 굽힘", views: ["right"], points: [12, 14, 16], kind: "flexion" },
};
export const metricsForView = (view) => Object.entries(METRICS).filter(([, m]) => m.views.includes(view));
export const round = (n, digits = 1) => Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
export function vectorAngle(a, b) {
  if (![...a, ...b].every(Number.isFinite)) return null;
  const length = Math.hypot(...a) * Math.hypot(...b);
  if (length < 1e-8) return null;
  return Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / length))) * 180 / Math.PI;
}
export function jointAngle(a, b, c) {
  return vectorAngle([a.x - b.x, a.y - b.y], [c.x - b.x, c.y - b.y]);
}
function visible(p, confidence) {
  return p && [p.x, p.y, p.visibility].every(Number.isFinite)
    && p.visibility >= confidence && (!Number.isFinite(p.presence) || p.presence >= confidence)
    && p.x > 0.015 && p.x < 0.985 && p.y > 0.015 && p.y < 0.985;
}
export function analyzePose(poses, { view, metric, width, height, confidence = 0.75, directionConfirmed = false }) {
  const blocked = (reason, values = {}) => ({ valid: false, reason, values, primary: null });
  if (!METRICS[metric]?.views.includes(view)) return blocked("촬영 방향에 맞는 관절을 선택하세요.");
  if (!(width > 0 && height > 0)) return blocked("카메라 영상을 기다리는 중입니다.");
  if (!Array.isArray(poses) || poses.length !== 1) return blocked(poses?.length > 1 ? "한 사람만 화면에 들어오세요." : "몸이 화면에 보이도록 위치를 조정하세요.");
  if (!directionConfirmed) return blocked("촬영 방향과 화면 속 한 사람을 확인해 주세요.");
  const points = poses[0];
  if (!Array.isArray(points) || points.length < 33) return blocked("관절 좌표가 충분하지 않습니다.");
  const pixel = (i) => ({ x: points[i].x * width, y: points[i].y * height });
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  // This is only a coarse camera-plane check; left/right must be confirmed by the wearer.
  const torsoIds = view === "front" ? [11, 12, 23, 24] : view === "left" ? [11, 23] : [12, 24];
  if (!torsoIds.every((i) => visible(points[i], confidence))) return blocked("어깨와 골반이 가려지지 않게 촬영하세요.");
  const side = view === "right" ? [12, 24] : [11, 23];
  const torsoLength = distance(pixel(side[0]), pixel(side[1]));
  if (torsoLength < height * 0.12) return blocked("몸이 너무 작게 보입니다. 필요한 관절이 잘 보이도록 카메라를 조정하세요.");
  if ([11, 12, 23, 24].every((i) => visible(points[i], Math.min(confidence, 0.55)))) {
    const widthRatio = (distance(pixel(11), pixel(12)) + distance(pixel(23), pixel(24))) / (2 * torsoLength);
    if (view === "front" && widthRatio < 0.38) return blocked("정면을 향하고 어깨와 골반이 모두 보이게 해 주세요.");
    if (view !== "front" && widthRatio > 0.60) return blocked("측면 촬영입니다. 선택한 몸의 옆면을 카메라로 향해 주세요.");
  }
  const values = {};
  for (const [id, definition] of metricsForView(view)) {
    if (!definition.points.every((i) => visible(points[i], confidence))) { values[id] = null; continue; }
    const p = definition.points.map(pixel);
    const pairs = definition.kind === "segments" ? [[0, 1], [2, 3]] : [[0, 1], [1, 2]];
    if (pairs.some(([a, b]) => distance(p[a], p[b]) < Math.max(10, height * 0.025))) { values[id] = null; continue; }
    const angle = definition.kind === "segments"
      ? vectorAngle([p[0].x - p[1].x, p[0].y - p[1].y], [p[3].x - p[2].x, p[3].y - p[2].y])
      : jointAngle(p[0], p[1], p[2]);
    values[id] = angle === null ? null : round(definition.kind === "flexion" ? 180 - angle : angle);
  }
  if (!Number.isFinite(values[metric])) return blocked("선택한 관절이 가려졌거나 너무 작게 보입니다. 해당 부위를 화면 안에 넣으세요.", values);
  return { valid: true, reason: "측정 가능 · 영상 평면의 추정 각도", values, primary: values[metric] };
}
export function quantile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const offset = (sorted.length - 1) * p;
  const i = Math.floor(offset);
  return sorted[i] + (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * (offset - i);
}
export function summarizeSession(samples, metric, durationMs, interrupted = false) {
  const good = samples.filter((s) => s.valid && Number.isFinite(s.values?.[metric]));
  const expected = Math.max(samples.length, Math.floor(durationMs / (1000 / SAMPLE_HZ)));
  const ratio = expected ? good.length / expected : 0;
  const durationOk = durationMs >= (CAPTURE_SECONDS - 0.5) * 1000 && durationMs <= (CAPTURE_SECONDS + 2) * 1000;
  const eligible = !interrupted && durationOk && good.length >= 40 && ratio >= 0.7;
  const byMetric = {};
  for (const id of Object.keys(METRICS)) {
    const values = good.map((s) => s.values?.[id]).filter(Number.isFinite);
    if (!values.length) continue;
    const low = quantile(values, 0.05), high = quantile(values, 0.95);
    byMetric[id] = { count: values.length, min: round(Math.min(...values)), max: round(Math.max(...values)), median: round(quantile(values, 0.5)), p05: round(low), p95: round(high), observedRange: round(high - low) };
  }
  return { eligible, validCount: good.length, totalCount: expected, validRatio: round(ratio, 3), byMetric,
    reason: interrupted ? "중단된 기록 · 비교 제외" : !durationOk ? "15초 기록을 완료해야 합니다." : good.length < 40 ? "유효 표본 부족 · 다시 측정" : ratio < 0.7 ? "유효 표본 70% 미만 · 다시 측정" : "기록 품질 기준 통과 · 임상 정확도 검증을 뜻하지 않음" };
}
export function comparisonKey(record) {
  const c = record.config;
  return JSON.stringify([c.participant, c.view, c.metric, c.posture, c.setup, c.confidence, c.protocol, c.modelVersion, round(c.width / c.height, 2)]);
}
export function compareSessions(current, baseline) {
  if (!current?.summary?.eligible || !baseline?.summary?.eligible || comparisonKey(current) !== comparisonKey(baseline)) return null;
  const id = current.config.metric;
  const a = current.summary.byMetric[id], b = baseline.summary.byMetric[id];
  if (!a || !b) return null;
  return { currentRange: a.observedRange, baselineRange: b.observedRange, delta: round(a.observedRange - b.observedRange) };
}
export function referenceError(pairs) {
  if (!pairs.length) return null;
  const differences = pairs.map((p) => p.estimated - p.reference);
  return { count: pairs.length, mae: round(differences.reduce((s, v) => s + Math.abs(v), 0) / pairs.length), bias: round(differences.reduce((s, v) => s + v, 0) / pairs.length), maxError: round(Math.max(...differences.map(Math.abs))) };
}
