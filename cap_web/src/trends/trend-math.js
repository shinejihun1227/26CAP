import { comparisonKey, METRICS, VIEWS, quantile, round } from '../mediapipe/rom-math.js';
import { PRESSURE_LAYOUT_ID, PRESSURE_CHANNELS, REHAB_ALGORITHM_ID, validPressure, pressureContractMatches } from '../data/sensor-config.js';

export const TREND_PROTOCOL = 'stepon-daily-observations-v1';
export const SENSOR_METRICS = {
  fog: { label: 'AI FoG 판정 표본 비율', unit: '%', min: 0, max: 100, note: 'AI confirmed 판정 비율 · 발병 확률/발생 횟수가 아님' },
  loadDifference: { label: '좌우 하중 비율 차이', unit: '%p', min: 0, max: 100, note: '양발 압력 데이터가 있을 때만 계산' },
  pressure: { label: '활성 발 상대 압력', unit: '/100', min: 0, max: 100, note: '센서 상대값 · kg 또는 실제 하중이 아님' },
  heel: { label: '뒤꿈치 압력 비중', unit: '%', min: 0, max: 100, note: '압력 분포 관찰값 · 착지 성공률이 아님' },
  forefoot: { label: '앞꿈치 압력 비중', unit: '%', min: 0, max: 100, note: '압력 분포 관찰값 · 추진력 자체가 아님' },
  lateral: { label: '외측 압력 비중', unit: '%', min: 0, max: 100, note: '압력 분포 관찰값' },
  feedback: { label: '재활 규칙 경고 표본 비율', unit: '%', min: 0, max: 100, note: '하중·발 끌림·착지·추진 등 규칙 경고가 있는 표본 비율' },
  temperature: { label: '활성 발 평균 온도', unit: '℃', min: -40, max: 100, note: '같은 센서 채널 구성끼리 비교 · 체온이 아님' },
  humidity: { label: '활성 발 평균 습도', unit: '%', min: 0, max: 100, note: '신발 내부 환경 · 질환 판정이 아님' },
};
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
export function koreaDay(value = Date.now()) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10) : null;
}
export function shiftDay(day, offset) {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}
export function stableJson(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => JSON.parse(stableJson(item))));
  if (value && typeof value === 'object') return JSON.stringify(Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, JSON.parse(stableJson(value[key]))])));
  return JSON.stringify(value ?? null);
}
export function romGroups(sessions, participant) {
  const groups = new Map();
  for (const s of sessions.filter((s) => s.config?.participant === participant)) {
    const key = comparisonKey(s);
    if (!groups.has(key)) groups.set(key, { key, config: s.config, records: [], label: `${VIEWS[s.config.view]} · ${METRICS[s.config.metric]?.label} · ${s.config.setup} · ${s.config.posture === 'seated' ? '앉아서' : '서서'} · 신뢰도 ${s.config.confidence * 100}%` });
    groups.get(key).records.push(s);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}
export function romDays(group) {
  const days = new Map();
  for (const s of group?.records ?? []) {
    const day = koreaDay(s.capturedAt); if (!day) continue;
    if (!days.has(day)) days.set(day, { day, total: 0, count: 0, excluded: 0, ranges: [], ids: [] });
    const d = days.get(day), value = s.summary?.byMetric?.[s.config.metric]?.observedRange;
    d.total++;
    if (s.summary?.eligible && finite(value)) { d.ranges.push(value); d.ids.push(s.id); d.count++; }
    else d.excluded++;
  }
  return [...days.values()].map((d) => ({ ...d, value: round(quantile(d.ranges, .5)) })).sort((a, b) => a.day.localeCompare(b.day));
}
export function sensorDays(rows, participant, conditionKey, metric) {
  return rows.filter((r) => r.participant === participant && r.conditionKey === conditionKey).map((r) => {
    const stats = r.stats[metric];
    return { day: r.day, value: stats?.count >= 10 ? round(stats.sum / stats.count) : null, count: stats?.count ?? 0, total: r.sampleCount, excluded: r.sampleCount - (stats?.count ?? 0), firstAt: r.firstAt, lastAt: r.lastAt };
  }).sort((a, b) => a.day.localeCompare(b.day));
}
export function compareDays(days, targetDay, mode = 'yesterday') {
  const today = days.find((d) => d.day === targetDay);
  const prior = days.filter((d) => d.day < targetDay && finite(d.value));
  let baseline = [];
  if (mode === 'previous') baseline = prior.slice(-1);
  else if (mode === 'week') baseline = prior.filter((d) => d.day >= shiftDay(targetDay, -7));
  else baseline = prior.filter((d) => d.day === shiftDay(targetDay, -1));
  // Equal weighting by day: more recordings on one day must not dominate a week.
  const reference = baseline.length ? round(baseline.reduce((sum, d) => sum + d.value, 0) / baseline.length) : null;
  const delta = finite(today?.value) && finite(reference) ? round(today.value - reference) : null;
  return { today: today ?? null, baseline, reference, delta, direction: delta === null ? 'missing' : delta > 0 ? 'increase' : delta < 0 ? 'decrease' : 'same' };
}
export function buildSensorSample(state, participant, setup, now = Date.now()) {
  if (state?.dataSource !== 'esp32' || !state.connected || state.paused || !finite(state.sensorReceivedAt) || now - state.sensorReceivedAt > 2500 || now < state.sensorReceivedAt || !finite(state.sensorAdvancedAt) || now - state.sensorAdvancedAt > 2500) return null;
  const hw = state.hardware ?? {}, raw = hw.raw ?? {}, m = state.rehab?.metrics ?? {};
  const side = hw.footSide === 'right' ? 'right' : 'left';
  const thermal = (state.thermal?.[side] ?? []).filter((p) => p.available && finite(p.temp) && p.temp > -40 && p.temp <= 100 && finite(p.humidity) && p.humidity >= 0 && p.humidity <= 100);
  const channels = thermal.map((p) => p.site).sort();
  const values = {};
  const put = (key, value) => { const spec = SENSOR_METRICS[key]; if (finite(value) && value >= spec.min && value <= spec.max) values[key] = round(value, 3); };
  // Never persist illustrative risk/balance/stride scores from the dashboard.
  const pressure = state.bilateralPressure?.[state.rehab?.config?.activeFoot ?? side];
  const validRaw = validPressure;
  const activeFoot = state.rehab?.config?.activeFoot ?? side;
  const rawPressure = raw.bilateral_pressure?.[activeFoot] ?? (activeFoot === side ? raw.pressure : null);
  if (hw.sensors?.pressure?.ready && pressureContractMatches(raw) && validRaw(rawPressure) && validPressure(pressure)) {
    put('pressure', m.activeRelativePressure);
    if (m.contact?.[state.rehab?.config?.activeFoot ?? side]) { put('heel', m.heelLanding?.active); put('forefoot', m.propulsion?.active); put('lateral', m.lateralLoad?.active); }
    if (hw.bilateralAvailable && m.bilateralAvailable && validRaw(raw.bilateral_pressure?.left) && validRaw(raw.bilateral_pressure?.right)) put('loadDifference', m.loadDifferencePct);
    if (state.rehab?.calibration?.status === 'ready' && state.rehab.calibration.pressureLayout === PRESSURE_LAYOUT_ID && hw.sensors?.imu?.ready) put('feedback', (state.rehab.alerts ?? []).some((a) => a.code !== 'fog_priority') ? 100 : 0);
  }
  if (thermal.length) { put('temperature', thermal.reduce((s, p) => s + p.temp, 0) / thermal.length); put('humidity', thermal.reduce((s, p) => s + p.humidity, 0) / thermal.length); }
  const ai = state.ai ?? {};
  if (ai.available && ai.ready && ai.windowReady && ai.deviceConnected && finite(ai.lastWindowAtMs) && now - ai.lastWindowAtMs >= 0 && now - ai.lastWindowAtMs <= 3000 && ['normal', 'warning', 'confirmed'].includes(ai.state)) put('fog', ai.state === 'confirmed' ? 100 : 0);
  if (!Object.keys(values).length) return null;
  const condition = { protocol: TREND_PROTOCOL, setup, side, activeFoot: state.rehab?.config?.activeFoot ?? side, device: String(state.device?.name ?? 'ESP32'), bilateral: Boolean(hw.bilateralAvailable), thermalChannels: channels,
    algorithm: REHAB_ALGORITHM_ID, pressureLayout: PRESSURE_LAYOUT_ID, pressureChannels: [...PRESSURE_CHANNELS], rehabConfig: state.rehab?.config ?? {}, baseline: state.rehab?.calibration?.pressureLayout === PRESSURE_LAYOUT_ID ? state.rehab.calibration.baseline ?? null : null,
    aiFoot: ai.selectedFoot ?? null, aiSession: ai.calibration?.id ?? null, aiArtifact: ai.artifactId ?? null,
    aiModel: ai.model ?? null, aiRate: ai.sampleRateHz ?? null, aiWindow: ai.windowSec ?? null, aiHop: ai.hopSec ?? null,
    aiCalibration: Object.fromEntries(['vertical_confidence', 'forward_confidence', 'yaw_enabled', 'yaw_confidence'].filter((key) => finite(ai.calibration?.[key]) || typeof ai.calibration?.[key] === 'boolean').map((key) => [key, ai.calibration[key]])) };
  return { participant, source: 'esp32', condition, at: new Date(now).toISOString(), frame: String(raw.frame ?? state.tick ?? ''), values };
}
