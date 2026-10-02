// Foot-mounted accelerometers measure foot inclination, not the ankle joint angle.
// Only quiet, fresh measurements are compared. These tolerances are engineering
// quality/display filters, never clinical safety limits or an injury classifier.
export const ANKLE_MARGIN_DEG = 5;
export const ANKLE_STORAGE_KEY = 'stepon-ankle-preparation-v1';
const finite = Number.isFinite;
const vector = v => v && ['x', 'y', 'z'].every(k => typeof v[k] === 'number' && finite(v[k])) ? [v.x, v.y, v.z] : null;
const norm = v => Math.hypot(...v);
export const localDay = time => new Date(time).toLocaleDateString('en-CA');
export function inclination(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 3 || b.length !== 3 || ![...a, ...b].every(finite) || !norm(a) || !norm(b)) return null;
  return Math.acos(Math.max(-1, Math.min(1, a.reduce((s, x, i) => s + x * b[i], 0) / norm(a) / norm(b)))) * 180 / Math.PI;
}
// Shortest gravity-vector rotation in sensor coordinates. This does not measure
// yaw about gravity or a shank-to-foot anatomical joint angle.
export function tiltRotationVector(a, b) {
  const angle = inclination(a, b);
  if (angle === null) return null;
  if (angle < .000001) return [0, 0, 0];
  const cross = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const size = norm(cross);
  if (size < .000001) return null;
  return cross.map(value => value / size * angle);
}
export function readAnkleSensor(state, side, now = Date.now()) {
  if (state?.dataSource !== 'esp32' || state.connected !== true || state.paused) return { ok: false, code: 'offline', label: '센서 연결 필요' };
  const foot = state.hardware?.feet?.[side], raw = foot?.state;
  const received = state.sensorReceivedAt;
  const age = typeof received === 'number' && finite(received) && received <= now && typeof foot?.age_ms === 'number' && finite(foot.age_ms) && foot.age_ms >= 0 ? now - received + foot.age_ms : Infinity;
  if (!foot?.connected || age > 1000 || raw?.foot_side !== side) return { ok: false, code: 'offline', label: '센서 연결 확인' };
  const accel = vector(raw.accel), gyro = vector(raw.gyro);
  if (!raw.imu_ready || !accel || !gyro || !raw.device_id || !raw.boot_id || !Number.isInteger(raw.frame)) return { ok: false, code: 'unavailable', label: 'BMI270 데이터 대기' };
  const base = { side, accel, deviceId: raw.device_id, bootId: raw.boot_id, key: `${raw.boot_id}:${raw.frame}`, at: now };
  if (Math.abs(norm(accel) - 1) > .12 || norm(gyro) > 12) return { ...base, ok: false, code: 'moving', label: '움직이는 중 · 비교 대기' };
  return { ...base, ok: true, code: 'ready', label: '센서 준비됨' };
}
export function neutralFromSamples(samples) {
  if (samples.length < 10 || samples.at(-1).at - samples[0].at < 2600) return null;
  if (new Set(samples.map(s => s.key)).size !== samples.length || samples.some(s => !s.ok || s.deviceId !== samples[0].deviceId || s.bootId !== samples[0].bootId)) return null;
  const mean = [0, 1, 2].map(i => samples.reduce((sum, s) => sum + s.accel[i], 0) / samples.length);
  if (samples.some(s => inclination(mean, s.accel) > 3)) return null;
  return { vector: mean, deviceId: samples[0].deviceId, bootId: samples[0].bootId, at: samples.at(-1).at };
}
export function matchingNeutral(neutral, sample, now = Date.now()) {
  return Boolean(neutral && sample?.ok && neutral.deviceId === sample.deviceId && neutral.bootId === sample.bootId && now >= neutral.at && now - neutral.at <= 10 * 60 * 1000);
}
export function preparationFromRecord(record, neutral, samples, now = Date.now()) {
  if (!record?.summary?.eligible || record.interrupted || !record.config.metric?.endsWith('_ankle')) return null;
  const good = samples.filter(s => matchingNeutral(neutral, s, now));
  if (good.length < 15 || new Set(good.map(s => s.key)).size !== good.length || good.at(-1).at - good[0].at < 6000) return null;
  const values = good.map(s => inclination(neutral.vector, s.accel)).sort((a,b) => a-b);
  const peak = values[Math.floor((values.length - 1) * .95)];
  if (peak < 5 || peak - values[0] < 3) return null;
  const stats = record.summary.byMetric[record.config.metric];
  if (!stats || !finite(stats.min) || !finite(stats.max)) return null;
  return { version: 1, side: record.config.metric.startsWith('left') ? 'left' : 'right', participant: record.config.participant,
    recordId: record.id, createdAt: now, day: localDay(now), neutral: neutral.vector, deviceId: neutral.deviceId, bootId: neutral.bootId,
    cameraMin: stats.min, cameraMax: stats.max, sensorMax: peak, sampleCount: good.length };
}
function validPlan(plan, side, now) {
  return plan?.version === 1 && plan.side === side && plan.day === localDay(now) && typeof plan.participant === 'string'
    && finite(plan.createdAt) && plan.createdAt <= now && now - plan.createdAt < 24 * 3600000
    && Array.isArray(plan.neutral) && plan.neutral.length === 3 && plan.neutral.every(finite) && norm(plan.neutral) > .5
    && finite(plan.sensorMax) && plan.sensorMax >= 5 && plan.sensorMax <= 180
    && finite(plan.cameraMin) && finite(plan.cameraMax) && plan.cameraMin >= 0 && plan.cameraMax <= 180 && plan.cameraMin <= plan.cameraMax
    && typeof plan.deviceId === 'string' && typeof plan.bootId === 'string';
}
export function createAnkleMonitor({ storage = null, now = Date.now } = {}) {
  let plans = {}, participant = 'P01';
  const dwell = {};
  try { const saved = JSON.parse(storage?.getItem(ANKLE_STORAGE_KEY) || '{}'); plans = saved.plans || {}; participant = saved.participant || 'P01'; } catch { /* unavailable storage */ }
  const persist = () => { try { storage?.setItem(ANKLE_STORAGE_KEY, JSON.stringify({ plans, participant })); } catch { /* session remains usable in memory */ } };
  function snapshot(state) {
    const time = now();
    return Object.fromEntries(['left', 'right'].map(side => {
      const sample = readAnkleSensor(state, side, time), plan = plans[`${participant}:${side}`];
      let result = { ...sample, plan: validPlan(plan, side, time) ? plan : null };
      if (!result.plan) result = { ...result, code: 'unprepared', label: '오늘 기준 기록 필요' };
      else if (sample.deviceId && (sample.deviceId !== plan.deviceId || sample.bootId !== plan.bootId)) result = { ...result, code: 'changed', label: '다시 기준을 맞추세요' };
      else if (sample.ok) {
        const tilt = inclination(plan.neutral, sample.accel), outside = tilt > plan.sensorMax + ANKLE_MARGIN_DEG;
        const previous = dwell[side];
        if (outside && (!previous || time - previous.seenAt > 1000)) dwell[side] = { key: sample.key, since: time, seenAt: time, count: 1 };
        else if (outside && previous.key !== sample.key) { previous.key = sample.key; previous.count++; previous.seenAt = time; }
        if (!outside) delete dwell[side];
        const confirmed = outside && dwell[side].count >= 3 && time - dwell[side].since >= 1000;
        result = { ...result, tilt, code: confirmed ? 'outside' : outside ? 'checking' : 'within', label: confirmed ? '기준보다 많이 기울었어요' : outside ? '기울기 확인 중' : '기록한 기울기 안이에요' };
      }
      if (!sample.ok || !['outside', 'checking'].includes(result.code)) delete dwell[side];
      return [side, result];
    }));
  }
  return { snapshot, getParticipant: () => participant,
    setParticipant(value) { if (participant !== value) { participant = value; delete dwell.left; delete dwell.right; persist(); } },
    save(plan) { if (!validPlan(plan, plan?.side, now())) return false; plans[`${plan.participant}:${plan.side}`] = plan; delete dwell[plan.side]; persist(); return true; },
    clearSide(side) { delete plans[`${participant}:${side}`]; delete dwell[side]; persist(); },
    clear(recordId = null) { plans = recordId ? Object.fromEntries(Object.entries(plans).filter(([, p]) => p.recordId !== recordId)) : {}; delete dwell.left; delete dwell.right; persist(); },
  };
}
