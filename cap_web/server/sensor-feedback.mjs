import { randomUUID } from 'node:crypto';
import { pressureCenter } from '../src/data/pressure-center.js';
import { localDay } from '../src/mediapipe/ankle-monitor.js';
import { actionGroups, validFeedbackActions, FEEDBACK_ACTIONS, sensorDirection, recordedFootDirection, evidenceText } from '../src/data/sensor-feedback.js';

const SIDES = ['left', 'right'];
const vector = value => ['x', 'y', 'z'].every(k => Number.isFinite(value?.[k])) ? [value.x, value.y, value.z] : null;
const round = n => Math.round(n * 10) / 10;
const reply = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)); };

export function createSensorFeedback({ ankleDaily, now = Date.now, fetchImpl = fetch, model = process.env.STEPON_LOCAL_LLM_MODEL || 'qwen2.5:3b', timeoutMs = 60_000 } = {}) {
  const feet = { left: {}, right: {} }, cache = new Map();
  let events = [], pending = null, retryAt = 0;
  function prune() { events = events.filter(e => localDay(e.at) === localDay(now())).slice(-200); }
  function observe(side, raw) {
    if (!SIDES.includes(side) || raw?.foot_side !== side) return;
    const f = feet[side], t = now();
    const key = `${raw.device_id}:${raw.boot_id}:${raw.frame}`;
    if (key === f.key) return; // A frozen packet cannot accumulate duration.
    const continuous = f.lastAt != null && t > f.lastAt && t - f.lastAt <= 500
      && f.device === raw.device_id && f.boot === raw.boot_id && f.day === localDay(t)
      && f.pressureCalibrationId === (raw.pressure_calibration?.id ?? null);
    Object.assign(f, { key, lastAt: t, device: raw.device_id, boot: raw.boot_id, day: localDay(t), pressureCalibrationId: raw.pressure_calibration?.id ?? null });
    const a = vector(raw.accel), g = vector(raw.gyro), center = pressureCenter(raw);
    const quiet = raw.imu_ready && a && g && Math.abs(Math.hypot(...a) - 1) <= .12 && Math.hypot(...g) <= 12;
    const direction = center?.position >= .8 ? 'front' : center?.position <= .2 ? 'rear' : null;
    f.state = !center ? 'pressure_missing' : !quiet ? 'moving' : direction ? 'collecting' : 'balanced';
    if (!quiet || !direction || !Number.isInteger(raw.frame) || !raw.device_id || !raw.boot_id) { f.run = null; return; }
    const percent = 100 * (direction === 'front' ? center.position : 1 - center.position);
    if (!continuous || f.run?.direction !== direction) f.run = { direction, at: t, samples: 0, peak: percent, event: null };
    const run = f.run; run.samples++; run.peak = Math.max(run.peak, percent);
    if (t - run.at < 3000 || run.samples < 8) return;
    f.state = 'observed';
    if (!run.event) {
      prune();
      run.event = { id: randomUUID(), kind: 'cop', side, at: run.at, direction,
        pressureBasis: raw.pressure_calibration?.status === 'ready' ? raw.pressure_calibration.method : 'adc-percent', pressureCalibrationId: f.pressureCalibrationId };
      events.push(run.event);
    }
    Object.assign(run.event, { endedAt: t, seconds: round((t - run.at) / 1000), peakPercent: Math.round(run.peak) });
  }
  function romEvents() {
    return (ankleDaily.snapshot().events || []).filter(e => SIDES.includes(e.side) && typeof e.id === 'string'
      && ['at', 'endedAt', 'peak', 'threshold', 'sensorX', 'sensorY'].every(k => Number.isFinite(e[k]))
      && localDay(e.at) === localDay(now()) && e.at <= now() && e.endedAt >= e.at && e.peak > e.threshold && e.threshold > 5)
      .map(e => ({ id: e.id, kind: 'rom', side: e.side, at: e.at, endedAt: e.endedAt, peak: e.peak,
        rangeMax: round(e.threshold - 5), threshold: e.threshold, sensorX: e.sensorX, sensorY: e.sensorY,
        direction: sensorDirection(e.sensorX, e.sensorY), footDirection:recordedFootDirection(e), seconds: round((e.endedAt - e.at) / 1000) }));
  }
  function snapshot() {
    prune();
    const all = [...romEvents(), ...events];
    return { version: 1, model, observedAt: now(), entries: ['rom', 'cop'].flatMap(kind => SIDES.map(side => {
      const evidence = all.filter(e => e.kind === kind && e.side === side).sort((a, b) => b.at - a.at)[0] || null;
      return { kind, side, evidence: evidence ? { ...evidence } : null };
    })), pressureState: Object.fromEntries(SIDES.map(side => [side, feet[side].lastAt != null && now() - feet[side].lastAt <= 1000 ? feet[side].state : 'offline'])) };
  }
  async function generate({ kind, side, eventId } = {}) {
    if (!['rom', 'cop'].includes(kind) || !SIDES.includes(side) || typeof eventId !== 'string' || eventId.length > 80) return { status: 400, error: 'invalid_selection', message: '관찰 기록을 다시 선택하세요.' };
    const evidence = snapshot().entries.find(e => e.kind === kind && e.side === side)?.evidence;
    if (!evidence || evidence.id !== eventId) return { status: 409, error: 'record_changed', message: '새 관찰 기록이 있어요. 화면을 갱신한 뒤 다시 요청하세요.' };
    const key = `${kind}:${side}:${eventId}`;
    if (cache.has(key)) return { status: 200, ...cache.get(key) };
    if (pending) return { status: 429, error: 'busy', message: '다른 기록의 AI 안내를 만드는 중이에요. 잠시 후 다시 눌러 주세요.' };
    if (now() < retryAt) return { status: 429, error: 'cooldown', message: '잠시 후 다시 눌러 주세요.' };
    pending = key;
    // Snapshot once. Later samples cannot silently change the LLM's evidence.
    const input = { ...evidence, ...(evidence.footDirection?{footDirection:{...evidence.footDirection}}:{}) }, groups = actionGroups(input);
    const schema = { type: 'object', properties: {
      walkingAction: { type: 'string', enum: groups.walking },
      checkAction: { type: 'string', enum: groups.check },
    }, required: ['walkingAction','checkAction'], additionalProperties: false };
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl('http://127.0.0.1:11434/api/chat', {
        method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, stream: false, format: schema, options: { temperature: 0, num_predict: 180 }, messages: [
          { role: 'system', content: '너는 센서 관찰 기록에 맞는 일반 보행 안내와 다음 확인 행동을 고르는 비의료적 도우미다. walking 후보에서 walkingAction 하나, check 후보에서 checkAction 하나를 고른다. 새로운 문장을 만들지 않는다. 기록은 정지에 가까운 구간의 관찰값이며 걸음 전체를 분석한 결과가 아니다. ROM은 실제 발목 관절각이 아닌 발 장착 센서의 중력 대비 기울기다. X/Y 부호를 해부학적 안쪽·바깥쪽이나 발등·발바닥 방향으로 추정하지 않는다. footDirectionKnown이 true일 때만 저장된 footDirection의 들린 쪽에 맞는 주의 문구를 고른다. 이 방향은 발끝 들기 보정에 따른 발의 들린 쪽이며 관절 손상 방향이 아니다. 방향 미확인은 일반 보행 안내와 장착/기준 확인을 고른다. 압력은 앞뒤 상대 비중이며 체중 비율이나 임상 CoP가 아니다. 앞/뒤 쏠림에 맞는 안내와 해당 센서/바닥/재측정 확인을 고른다. 반대 방향 체중 이동, 50:50 강제, 질환·부상 위험·치료·맞춤 스트레칭을 판단하거나 지시하지 않는다. JSON 스키마를 따른다: ' + JSON.stringify(schema) },
          { role: 'user', content: JSON.stringify({ kind: input.kind, side: input.side, direction: input.direction,
            observationScope: 'quiet-foot-only; not a walking posture or injury-risk assessment',
            ...(kind === 'rom' ? { peakDeg: input.peak, rangeMaxDeg: input.rangeMax, sensorXDeg: input.sensorX, sensorYDeg: input.sensorY,
              seconds: input.seconds, thresholdDeg: input.threshold, anatomicalDirectionKnown: false,
              footDirectionKnown:Boolean(input.footDirection),footDirection:input.footDirection,
              directionMeaning:'raised edge at peak, from recorded toe-up reference',caution:evidenceText(input) }
              : { peakPercent: input.peakPercent, seconds: input.seconds, pressureBasis: input.pressureBasis,
                rule: 'quiet foot, >=80% for >=3 seconds; relative sensor shares, not body-weight; observation rule only' }),
            choices: Object.fromEntries(Object.entries(groups).map(([group,ids])=>[group,Object.fromEntries(ids.map(id => [id, FEEDBACK_ACTIONS[id]]))])) }) },
        ] }),
      });
      if (!response.ok) throw Error('model_error');
      const payload = await response.json(), result = JSON.parse(payload?.message?.content || '{}');
      const actionIds=[result.walkingAction,result.checkAction];
      if (!validFeedbackActions(input,actionIds) || Object.keys(result).some(k=>!['walkingAction','checkAction'].includes(k))) throw Error('invalid_output');
      const output = { eventId, kind, side, evidence: input, model, generatedAt: now(), actionIds };
      cache.set(key, output);
      if (cache.size > 40) cache.delete(cache.keys().next().value);
      return { status: 200, ...output };
    } catch (error) {
      retryAt = now() + 10000;
      return { status: 503, error: error.name === 'AbortError' ? 'model_timeout' : 'model_unavailable',
        message: error.name === 'AbortError' ? 'AI 응답이 늦어졌어요. 잠시 후 다시 시도하세요.' : 'Ollama 응답을 확인하지 못했어요. 이 PC의 Ollama 실행과 모델을 확인하세요.' };
    } finally { clearTimeout(timer); pending = null; }
  }
  return { observe, snapshot, generate };
}

export function createSensorFeedbackHandler(service) {
  return async (req, res) => {
    try {
      // The same local web origin works for both PC and hotspot phones. Ollama
      // remains bound to loopback, and neither its URL nor prompts are accepted.
      if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) return reply(res, 403, { error: 'same_origin_only' });
      if (req.method === 'GET') return reply(res, 200, service.snapshot());
      if (req.method !== 'POST') return reply(res, 405, { error: 'method_not_allowed' });
      if (!String(req.headers['content-type']).toLowerCase().startsWith('application/json')) return reply(res, 415, { error: 'json_required' });
      let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 1024) return reply(res, 413, { error: 'request_too_large' }); }
      const input = JSON.parse(body);
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['kind', 'side', 'eventId'].includes(k))) return reply(res, 400, { error: 'invalid_selection' });
      const { status, ...result } = await service.generate(input);
      reply(res, status, result);
    } catch { reply(res, 400, { error: 'invalid_request' }); }
  };
}
