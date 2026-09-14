import { PROTOCOL, summarizeSession } from "../src/mediapipe/rom-math.js";
export function config(overrides = {}) {
  return { participant: "P01", setup: "책상-기본", view: "left", metric: "left_ankle", posture: "seated",
    protocol: PROTOCOL, modelVersion: "tasks-vision-1.0.1/pose-lite-f16-v1", width: 960, height: 720, confidence: .75, ...overrides };
}
export function session(overrides = {}) {
  const c = config(overrides.config);
  const samples = Array.from({ length: 75 }, (_, i) => ({ t: (i + 1) * 200, valid: true, values: { [c.metric]: 80 + (i % 20) } }));
  const record = { capturedAt: new Date().toISOString(), durationMs: 15000, interrupted: false, samples, ...overrides, config: c };
  return { ...record, summary: summarizeSession(record.samples, c.metric, record.durationMs, record.interrupted) };
}
export function pose(view = "left") {
  const p = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: .99, presence: .99 }));
  const put = (i, x, y) => Object.assign(p[i], { x, y });
  put(11, .45, .2); put(23, .45, .5); put(25, .45, .67); put(27, .45, .84);
  put(29, .42, .87); put(31, .60, .87); put(13, .45, .33); put(15, .6, .33);
  const rightX = view === "front" ? .68 : .48;
  put(12, rightX, .2); put(24, rightX, .5); put(26, rightX, .67); put(28, rightX, .84);
  put(30, .45, .88); put(32, .65, .88); put(14, rightX + .12, .2); put(16, rightX + .18, .33);
  if (view === "front") put(13, .25, .2);
  return p;
}
