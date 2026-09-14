import { METRICS, VIEWS, round } from "./rom-math.js";

export const SET_PROTOCOL = "stepon-multiview-record-v1";
export const SET_CAUTION = "서로 다른 시점의 2D 관절 관찰 기록 묶음. 3D 복원·동기화·치료 효과 판정이 아님. 영상·음성·원본 랜드마크 없음.";
export function setSessions(set, sessions) {
  const ids = new Set(set.sessionIds);
  return sessions.filter((s) => ids.has(s.id) && s.config.participant === set.participant)
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id));
}
export function buildSetReport(set, sessions) {
  const records = setSessions(set, sessions);
  const missingIds = set.sessionIds.filter((id) => !records.some((s) => s.id === id));
  const views = Object.fromEntries(Object.keys(VIEWS).map((view) => {
    const selected = records.filter((s) => s.config.view === view);
    return [view, { count: selected.length, eligibleCount: selected.filter((s) => s.summary.eligible).length }];
  }));
  const coveredViews = Object.keys(views).filter((v) => views[v].eligibleCount > 0);
  const conditionCount = new Set(records.map(({ config: c }) => JSON.stringify([c.posture, c.setup, c.confidence, c.protocol, c.modelVersion, round(c.width / c.height, 2)]))).size;
  const spanMinutes = records.length > 1 ? Math.round((Date.parse(records.at(-1).capturedAt) - Date.parse(records[0].capturedAt)) / 60000) : 0;
  return { protocol: SET_PROTOCOL, views, coveredViews, missingIds, conditionCount, spanMinutes,
    complete: coveredViews.length === 3 && missingIds.length === 0,
    rows: records.map((s) => ({ sessionId: s.id, view: s.config.view, metric: s.config.metric, capturedAt: s.capturedAt,
      posture: s.config.posture, setup: s.config.setup, eligible: s.summary.eligible, validRatio: s.summary.validRatio,
      stats: s.summary.byMetric[s.config.metric] ?? null })),
    caution: SET_CAUTION };
}
export function exportSetJson(set, sessions) {
  return { schemaVersion: 1, protocol: SET_PROTOCOL, exportedAt: new Date().toISOString(), angleBasis: "image-plane-2D-degrees",
    measurementSet: set, report: buildSetReport(set, sessions), sessions: setSessions(set, sessions), caution: SET_CAUTION };
}
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}
export function csvForSet(set, sessions) {
  const metrics = Object.keys(METRICS), report = buildSetReport(set, sessions);
  const header = ["set_id", "set_name", "participant", "session_id", "view", "primary_metric", "posture", "setup", "captured_at", "time_ms_within_record", "valid", "record_quality_eligible", "confidence", "model_version", "protocol", "video_width", "video_height", "set_complete", "missing_records", ...metrics.map((id) => `${id}_deg`)];
  const rows = setSessions(set, sessions).flatMap((s) => s.samples.map((sample) => [set.id, set.label, set.participant, s.id, s.config.view, s.config.metric, s.config.posture, s.config.setup, s.capturedAt, sample.t, sample.valid, s.summary.eligible, s.config.confidence, s.config.modelVersion, s.config.protocol, s.config.width, s.config.height, report.complete, report.missingIds.length, ...metrics.map((id) => sample.values[id] ?? "")]));
  return "\uFEFF" + [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
