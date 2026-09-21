import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { TREND_PROTOCOL, SENSOR_METRICS, koreaDay, shiftDay, stableJson } from '../src/trends/trend-math.js';
import { REHAB_ALGORITHM_ID, PRESSURE_LAYOUT_ID, validPressureChannels } from '../src/data/sensor-config.js';
export const TREND_RETENTION_DAYS = 30;
const FILE = /^daily-([a-f0-9]{64})\.json$/;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
export function sanitizeSensorSample(input, now = Date.now()) {
  if (!text(input?.participant, 30) || input.source !== 'esp32') fail('실제 ESP32 데이터와 측정 코드가 필요합니다.');
  const c = input.condition;
  if (!c || c.protocol !== TREND_PROTOCOL || !text(c.setup, 60) || !['left', 'right'].includes(c.side) || !['left', 'right'].includes(c.activeFoot) || !text(c.device, 80) || !['web-rehab-rules-v1', REHAB_ALGORITHM_ID].includes(c.algorithm) || typeof c.bilateral !== 'boolean'
    || !Array.isArray(c.thermalChannels) || c.thermalChannels.length > 4 || new Set(c.thermalChannels).size !== c.thermalChannels.length || c.thermalChannels.some((s) => !['heel', 'arch', 'forefoot', 'toe'].includes(s))) fail('센서 비교 조건이 올바르지 않습니다.');
  const config = {};
  for (const key of ['activeFoot', 'weightKg', 'allowedLoadPct', 'targetLoadRatio', 'asymmetryTolerancePct', 'supportTimeTolerancePct', 'vibrationStrength', 'contactThreshold', 'repeatRequired', 'windowSize', 'clearRequired', 'cooldownMs']) {
    const v = c.rehabConfig?.[key];
    if (v !== undefined && !(typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6) && !['left', 'right'].includes(v)) fail('재활 설정이 올바르지 않습니다.');
    if (v !== undefined) config[key] = v;
  }
  // Calibration objects are numeric/boolean technical settings, never arbitrary personal text.
  function numericTree(value, depth = 0) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e15 || typeof value === 'boolean') return value;
    if (depth > 4 || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 40) fail('보정 설정이 올바르지 않습니다.');
    return Object.fromEntries(Object.entries(value).map(([k, v]) => { if (!/^[a-zA-Z0-9_]{1,50}$/.test(k)) fail('보정 필드가 올바르지 않습니다.'); return [k, numericTree(v, depth + 1)]; }));
  }
  const condition = { protocol: TREND_PROTOCOL, setup: c.setup.trim(), side: c.side, activeFoot: c.activeFoot, device: c.device, bilateral: c.bilateral, thermalChannels: [...c.thermalChannels].sort(), algorithm: c.algorithm,
    rehabConfig: config, baseline: numericTree(c.baseline), aiModel: c.aiModel === null || c.aiModel === undefined ? null : text(c.aiModel, 80) ? c.aiModel : fail('모델 이름이 올바르지 않습니다.'),
    aiRate: numericTree(c.aiRate), aiWindow: numericTree(c.aiWindow), aiHop: numericTree(c.aiHop), aiCalibration: numericTree(c.aiCalibration) };
  for (const key of ['aiSession', 'aiArtifact']) {
    if (c[key] != null && !/^[a-f0-9]{64}$/.test(c[key])) fail('AI 판정 기준 식별자가 올바르지 않습니다.');
    condition[key] = c[key] ?? null;
  }
  if (c.aiFoot != null && !['left', 'right'].includes(c.aiFoot)) fail('AI 분석 발이 올바르지 않습니다.');
  condition.aiFoot = c.aiFoot ?? null;
  if (c.algorithm === REHAB_ALGORITHM_ID) {
    if (c.pressureLayout !== PRESSURE_LAYOUT_ID || !validPressureChannels(c.pressureChannels)) fail('4개 압력센서 배치와 채널을 확인하세요.');
    condition.pressureLayout = PRESSURE_LAYOUT_ID;
    condition.pressureChannels = [...c.pressureChannels];
  } else if (c.pressureLayout !== undefined || c.pressureChannels !== undefined) fail('이전 알고리즘과 새 센서 배치를 혼용할 수 없습니다.');
  if (stableJson(condition).length > 8000) fail('설정이 너무 큽니다.');
  if (typeof input.at !== 'string' || !Number.isFinite(Date.parse(input.at)) || Math.abs(now - Date.parse(input.at)) > 60000) fail('새로운 실시간 표본만 저장할 수 있습니다. PC 시계를 확인하세요.');
  const values = {};
  for (const [key, value] of Object.entries(input.values ?? {})) {
    const spec = SENSOR_METRICS[key];
    if (!spec || typeof value !== 'number' || !Number.isFinite(value) || value < spec.min || value > spec.max || (['fog', 'feedback'].includes(key) && ![0, 100].includes(value))) fail('관찰값이 올바르지 않습니다.');
    values[key] = value;
  }
  if (!Object.keys(values).length) fail('저장할 유효 관찰값이 없습니다.');
  if ('loadDifference' in values && !condition.bilateral) fail('양발 데이터 없이 좌우 차이를 저장할 수 없습니다.');
  if (('temperature' in values || 'humidity' in values) && !condition.thermalChannels.length) fail('온습도 채널이 필요합니다.');
  return { participant: input.participant.trim(), condition, conditionKey: hash(stableJson(condition)), at: new Date(input.at).toISOString(), values };
}
export function createTrendStore(directory, clock = Date.now) {
  fs.mkdirSync(directory, { recursive: true });
  const publicRow = ({ seconds, ...row }) => row;
  const forId = (id) => { if (!/^[a-f0-9]{64}$/.test(id ?? '')) fail('기록 ID가 올바르지 않습니다.'); return path.join(directory, `daily-${id}.json`); };
  function list() {
    const rows = [], cutoff = shiftDay(koreaDay(clock()), -(TREND_RETENTION_DAYS - 1));
    for (const name of fs.readdirSync(directory).filter((n) => FILE.test(n))) {
      const file = path.join(directory, name), row = JSON.parse(fs.readFileSync(file, 'utf8'));
      // Expired files are omitted, pruned under the mutation lock on the next save/delete.
      if (row.day >= cutoff) rows.push(publicRow(row));
    }
    return { schemaVersion: 1, protocol: TREND_PROTOCOL, timeZone: 'Asia/Seoul', retentionDays: TREND_RETENTION_DAYS, rows: rows.sort((a, b) => b.day.localeCompare(a.day)) };
  }
  function locked(action) {
    const lock = path.join(directory, '.trend-write.lock');
    try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code === 'EEXIST') fail('다른 창에서 기록 저장 중입니다. 잠시 후 다시 시도하세요.', 409); throw error; }
    try {
      const cutoff = shiftDay(koreaDay(clock()), -(TREND_RETENTION_DAYS - 1));
      for (const name of fs.readdirSync(directory).filter((n) => FILE.test(n))) {
        const file = path.join(directory, name), row = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (row.day < cutoff) fs.rmSync(file);
      }
      return action();
    } finally { fs.rmSync(lock, { force: true }); }
  }
  return {
    list: () => locked(list),
    append(input) { return locked(() => {
      const sample = sanitizeSensorSample(input, clock()), day = koreaDay(sample.at);
      const id = hash(stableJson([sample.participant, sample.conditionKey, day])), file = forId(id);
      const existing = fs.existsSync(file);
      if (!existing && fs.readdirSync(directory).filter((n) => FILE.test(n)).length >= 3000) fail('일별 기록 한도에 도달했습니다. 내보내기 후 필요한 날짜 기록을 정리하세요.', 409);
      const row = existing ? JSON.parse(fs.readFileSync(file, 'utf8')) : { id, schemaVersion: 1, source: 'esp32', day, participant: sample.participant, conditionKey: sample.conditionKey, condition: sample.condition, firstAt: sample.at, lastAt: sample.at, stats: {}, sampleCount: 0, seconds: [] };
      const second = Math.floor(Date.parse(sample.at) / 1000);
      // Exact same person/condition/second across multiple tabs contributes once.
      if (row.seconds.includes(second)) return { id, duplicate: true, sampleCount: row.sampleCount };
      row.seconds.push(second); row.sampleCount++;
      if (sample.at < row.firstAt) row.firstAt = sample.at;
      if (sample.at > row.lastAt) row.lastAt = sample.at;
      for (const [key, value] of Object.entries(sample.values)) {
        const s = row.stats[key] ?? { count: 0, sum: 0, min: value, max: value };
        s.count++; s.sum += value; s.min = Math.min(s.min, value); s.max = Math.max(s.max, value); row.stats[key] = s;
      }
      const temp = path.join(directory, `${id}-${randomUUID()}.tmp`);
      try { fs.writeFileSync(temp, JSON.stringify(row), { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, file); }
      finally { fs.rmSync(temp, { force: true }); }
      return { id, duplicate: false, sampleCount: row.sampleCount };
    }); },
    remove(id) { return locked(() => { const file = forId(id); if (!fs.existsSync(file)) fail('기록을 찾을 수 없습니다.', 404); fs.rmSync(file); }); },
  };
}
export function createTrendHandler(directory) {
  let store;
  const reply = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)); };
  return async (req, res) => {
    try {
      const host = new URL(`http://${req.headers.host || 'invalid'}`);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname) || req.headers.origin && req.headers.origin !== host.origin || req.headers['sec-fetch-site'] === 'cross-site') fail('개인 기록은 이 PC의 localhost에서만 사용할 수 있습니다.', 403);
      store ??= createTrendStore(directory);
      if (req.method === 'GET') { reply(res, 200, store.list()); return; }
      if (!['POST', 'DELETE'].includes(req.method)) fail('지원하지 않는 요청입니다.', 405);
      if (!req.headers['content-type']?.startsWith('application/json')) fail('JSON 요청이 필요합니다.', 415);
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size <= 24000) chunks.push(chunk); }
      if (size > 24000) fail('요청이 너무 큽니다.', 413);
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('올바른 JSON이 아닙니다.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('JSON 객체가 필요합니다.');
      if (req.method === 'POST') { reply(res, 200, store.append(body)); return; }
      if (body.confirm !== 'DELETE_SENSOR_DAY') fail('날짜별 센서 기록 삭제 확인이 필요합니다.');
      store.remove(body.id); reply(res, 200, { deleted: true });
    } catch (error) { reply(res, error.status || 500, { error: error.status ? error.message : '개인 기록 저장소를 읽거나 저장하지 못했습니다. 기존 파일은 유지했습니다.' }); }
  };
}
