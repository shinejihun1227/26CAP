import { getAiStatusMeta, aiReasonText } from '../components/ai-status-card.js';
import { pressureContractMatches, validPressure } from './sensor-config.js';
import { pressureCenter } from './pressure-center.js';
import { RANGE_SECONDS } from '../mediapipe/foot-direction.js';

const finite = n => typeof n === 'number' && Number.isFinite(n);
export const freshAt = (at, now, limit) => finite(at) && at <= now && now - at <= limit;
const score = n => finite(n) && n >= 0 && n <= 1 ? Math.round(n * 100) : null;

export function summaryFog(state, now = Date.now()) {
  const ai = state.ai ?? {};
  const blocked = state.dataSource !== 'esp32' ? '실제 센서 연결 필요' : state.paused ? '화면 갱신 정지'
    : state.fogLocalStop || ai.detectionEnabled === false ? 'FoG 감지 중지'
    : ai.suppression?.active ? '알림 잠시 쉬는 중'
    : state.aiEnabled === false ? 'AI 분석 꺼짐' : !ai.available ? 'AI 연결 대기' : null;
  const feet = ['left', 'right'].map(side => {
    const f = ai.feet?.[side] ?? {};
    const valid = !blocked && f.device_connected && f.ready && freshAt(f.last_window_at_ms, now, 2500)
      && ['normal', 'warning', 'confirmed'].includes(f.status);
    const meta = getAiStatusMeta(f.status);
    const label = blocked || (!f.device_connected ? '신발 연결 필요' : f.ready && !freshAt(f.last_window_at_ms, now, 2500) ? '새 분석 대기' : meta.label);
    return { side, value: valid ? score(f.decision_score) : null, rf: valid ? score(f.diagnostics?.rf_score) : null,
      cnn: valid ? score(f.diagnostics?.cnn_score) : null, label, tone: valid ? meta.tone : 'sky' };
  });
  const selected = feet.find(f => f.side === ai.selectedFoot);
  const current = !blocked && ai.ready && ['normal','warning','confirmed'].includes(ai.status)
    && freshAt(ai.lastWindowAtMs, now, 2500);
  const valid = current && selected?.value !== null && selected !== undefined;
  const pressureOnly = current && ai.decisionSource === 'pressure';
  return { feet, value: valid ? score(ai.score) : null, label: blocked || (valid || pressureOnly ? getAiStatusMeta(ai.status).label : '유효한 분석 대기'),
    tone: valid || pressureOnly ? getAiStatusMeta(ai.status).tone : 'sky', selected: valid ? ai.selectedFoot : null,
    reason: current && ai.reasons?.length ? aiReasonText(ai) : null, pressureOnly };
}

export function summaryAnkle(state, side, now = Date.now()) {
  const source = state.dailyAnkle;
  const f = source?.data?.feet?.[side];
  const blocked = state.dataSource !== 'esp32' ? '기준 기록 필요' : state.paused ? '화면 갱신 정지'
    : source?.error ? '서버 연결 확인' : !freshAt(source?.receivedAt, now, 2000) ? '최신 값 대기' : null;
  const plan = f?.plan && finite(f.plan.max) && f.plan.max > 0 && f.plan.max <= 180 && finite(f.plan.margin) && f.plan.margin >= 0 ? f.plan : null;
  const labels = { offline: '신발 연결 필요', moving: '움직이는 중 · 비교 대기', unavailable: 'BMI 데이터 대기', quiet: '기준 기록 필요' };
  const phase = { neutral: '3초 기준 보정 중', 'neutral-ready': '움직임 기록 필요', range: `${RANGE_SECONDS}초 범위 기록 중`, failed: '기준 다시 기록' };
  const tilt = f?.current?.tilt;
  const measurable = !blocked && plan && ['within','checking','outside'].includes(f.state) && finite(tilt) && tilt >= 0 && tilt <= 180;
  // Blue/red describes the recorded range, not medical safety or event confirmation.
  const outside = measurable && tilt > plan.max;
  const direction=measurable && plan.directionReady && f.current.direction?.source==='toe-up'
    && [f.current.direction.forward,f.current.direction.left].every(finite) ? f.current.direction : null;
  return { side, plan, tilt: measurable ? tilt : null, vector: measurable ? f.current.vector : null,direction,
    label: blocked || phase[f?.phase] || (measurable ? outside ? '기록 범위 밖' : '기록 범위 안' : labels[f?.state] || '기준 기록 필요'),
    outside: Boolean(outside), eventConfirmed: measurable && f.state === 'outside',
    events: source?.data?.events?.filter(event => event.side === side).length ?? 0,
    comparedSeconds: finite(f?.comparedSeconds) ? f.comparedSeconds : 0 };
}

export function summaryCop(state, side, now = Date.now()) {
  const foot = state.hardware?.feet?.[side];
  const raw = foot?.state;
  const age = finite(foot?.age_ms) && foot.age_ms >= 0 && freshAt(state.sensorReceivedAt, now, 2000) ? foot.age_ms + now - state.sensorReceivedAt : Infinity;
  const unavailable = label => ({ side, front: null, rear: null, position: null, label });
  if (state.dataSource !== 'esp32') return unavailable('실제 센서 연결 필요');
  if (state.paused) return unavailable('화면 갱신 정지');
  if (!foot?.connected || age > 2000 || raw?.foot_side !== side) return unavailable('신발 연결 필요');
  if (raw.pressure_ready === false || !pressureContractMatches(raw) || !validPressure(raw.pressure)) return unavailable('압력값 확인 필요');
  const center = pressureCenter(raw);
  if (!center) return unavailable('발을 디디면 표시');
  const { position, shared } = center;
  return { side, position, front: Math.round(position * 100), rear: 100 - Math.round(position * 100),
    label: position > .55 ? '앞쪽 중심' : position < .45 ? '뒤쪽 중심' : '가운데 중심', shared };
}

// A radial range gauge projected over a sphere. Radius always encodes tilt,
// so an out-of-range sample cannot appear inside due to 3D depth projection.
export function sphereMarker(tilt, max, vector) {
  if (!finite(tilt) || !finite(max) || max <= 0) return null;
  const v = Array.isArray(vector) && vector.length === 3 && vector.every(finite) ? vector : null;
  if (!v) return null;
  const u = .83 * v[0] + .56 * v[2], w = -.22 * v[0] + .92 * v[1] + .33 * v[2];
  const bearing = Math.hypot(u, w) > .001 ? Math.atan2(-w, u) : -Math.PI / 4;
  const ratio = tilt / max;
  const distance = ratio <= 1 ? ratio * 76 : 87 + 23 * Math.min(1, ratio - 1);
  return { x: 140 + distance * Math.cos(bearing), y: 120 + distance * Math.sin(bearing), outside: ratio > 1,
    distance, ratio, clipped: ratio > 2 };
}

// Front = toes raised, rear = heel raised; left/right are the wearer's sides.
// A compass over the 3D range globe preserves the full radial magnitude.
export function directionMarker(tilt,max,direction) {
  if(!finite(tilt)||tilt<0||!finite(max)||max<=0||direction?.source!=='toe-up'
    || ![direction.forward,direction.left].every(finite))return null;
  if(tilt>=2 && Math.hypot(direction.forward,direction.left)<.01)return null;
  const bearing=Math.atan2(-direction.forward,-direction.left),ratio=tilt/max;
  const distance=ratio<=1?ratio*76:87+23*Math.min(1,ratio-1);
  return {x:140+distance*Math.cos(bearing),y:120+distance*Math.sin(bearing),outside:ratio>1,distance,ratio};
}
