import { escapeHtml } from "../utils/text.js";

const STATUS_META = {
  normal: { label: "지속 신호 미확인", tone: "mint", detail: "현재 연속 판정 조건을 충족한 보행동결 신호가 없어요." },
  warning: { label: "주의", tone: "orange", detail: "보행동결 가능성을 관찰하고 있어요." },
  confirmed: { label: "신호 감지", tone: "coral", detail: "최근 분석에서 보행동결 관련 신호가 이어졌어요." },
  warming_up: { label: "AI 준비 중", tone: "sky", detail: "첫 4초 분석 창을 채우고 있어요." },
  calibration_missing: { label: '개인 보정 필요', tone: 'orange', detail: '기기 설정의 ‘개인 기준 설정’에서 착용자의 기준을 준비해 주세요.' },
  calibration_failed: { label: '보정 다시 필요', tone: 'orange', detail: '보정에 실패해 판단을 멈췄어요. 수신 상태와 안내된 동작을 확인한 뒤 다시 보정해 주세요.' },
  calibrating: { label: '개인 보정 중', tone: 'sky', detail: '3초 준비 후 5초 정지, 이어서 20초 동안 평소처럼 걸어 주세요.' },
  invalid_data: { label: '입력 확인 필요', tone: 'orange', detail: '센서 수신 간격과 IMU 상태를 확인하고 유효한 분석 창을 다시 수집합니다.' },
  device_offline: { label: "센서 연결 끊김", tone: "coral", detail: "ESP32와 AI 브리지 연결을 확인하세요." },
  unavailable: { label: "AI 연결 대기", tone: "lavender", detail: "AI 브리지 또는 캘리브레이션 파일이 필요해요." },
  disabled: { label: "사용 안 함", tone: "lavender", detail: "현재 AI 분석은 꺼져 있어요. 센서 측정은 별도로 사용할 수 있습니다." },
  paused: { label: "일시정지", tone: "lavender", detail: "화면 갱신을 다시 시작하면 최신 결과를 확인할 수 있어요." },
};

export function getAiStatusMeta(status) {
  return STATUS_META[status] ?? STATUS_META.unavailable;
}

export function renderFogCue(state) {
  if (state.dataSource !== 'esp32') return '';
  const cue = state.ai?.available ? state.ai.cue : null;
  const active = Object.entries(cue?.feet ?? {}).filter(([, v]) => v.requested && v.acknowledged).map(([s]) => s === 'left' ? '왼발' : '오른발');
  const error = Object.values(cue?.feet ?? {}).find(v => v.error)?.error;
  const label = !cue ? 'AI 연결 후 확인할 수 있어요' : !cue.enabled ? '자동 출력 중지됨' : active.length ? `${active.join(' · ')} 진동·레이저 유지 명령 전달 중` : 'FoG 감지 시 자동 출력 대기';
  return `<div class="fog-cue-panel"><h3>FoG 감지 안내</h3><p data-live-copy><b>${escapeHtml(label)}</b></p><p>각 발의 AI가 신호 감지 상태일 때 진동과 레이저를 유지하고, 감지가 해제되면 자동으로 꺼요. 연결이 끊기면 마지막 명령 후 최대 1.5초 안에 꺼져요.</p><div class="device-actions"><button class="outline-button" data-action="fog-cue-stop" ${!cue ? 'disabled' : ''}>진동·레이저 자동 출력 중지</button><button class="outline-button" data-action="fog-cue-enable" ${!cue || cue.enabled ? 'disabled' : ''}>자동 출력 다시 켜기</button></div>${error ? `<p role="status">${escapeHtml(error)}</p>` : ''}<small>PC AI가 제어해요. 웹을 닫아도 동작하며, CSV 수집 중에는 자동 출력을 쉬어요. CSV 분석은 실제 출력을 켜지 않아요.</small></div>`;
}

function displayScore(score) {
  return score !== null && score !== undefined && Number.isFinite(Number(score))
    ? `${Math.round(Number(score) * 100)}`
    : "--";
}

export function aiPresentation(state) {
  const ai = state.ai ?? {};
  const disabled = state.aiEnabled === false;
  const offline = state.dataSource === 'esp32' && (!state.connected || ai.deviceConnected === false);
  const expired = Number.isFinite(ai.lastWindowAtMs) && Date.now() - ai.lastWindowAtMs > 2500;
  const status = disabled ? 'disabled' : state.paused ? 'paused' : !ai.available ? 'unavailable'
    : ['calibration_missing', 'calibration_failed', 'calibrating', 'invalid_data', 'unavailable'].includes(ai.status) ? ai.status
    : offline || expired ? 'device_offline' : !ai.ready ? 'warming_up' : ai.status;
  const meta = getAiStatusMeta(status);
  const hasScore = ['normal', 'warning', 'confirmed'].includes(status) && ai.available && ai.ready
    && typeof ai.score === 'number' && Number.isFinite(ai.score);
  const score = hasScore ? Math.max(0, Math.min(1, Number(ai.score))) : null;
  return { ai, disabled, status, meta, score };
}

const REASONS = {
  sustained_model_and_motion: '연속 모델 신호와 보행 움직임 조건 충족',
  below_entry_or_debouncing: '진입 기준 미달 또는 연속 신호 확인 중',
  yaw_suppressed: '큰 회전 움직임으로 해당 창의 판정 점수 억제',
  prolonged_stillness: '장시간 무동작 관찰로 주의 단계',
  low_motion: '모델 신호 감지 · 낮은 움직임으로 주의 단계',
  motion_grade: '모델 신호 감지 · 보행 움직임 추가 확인 필요',
  pressure_transition: '압력 전환 조건에 따라 주의 단계',
  no_footlift: '발 들림 조건 추가 확인 필요',
};

export function renderAiDetails(state) {
  const { ai, disabled, score } = aiPresentation(state);
  if (disabled || state.dataSource !== 'esp32') return '';
  const rows = ['left', 'right'].map((side) => {
    const foot = ai.feet?.[side] ?? {};
    const capture = foot.capture ?? {};
    const running = ['countdown', 'recording'].includes(capture.status);
    const label = side === 'left' ? '왼발' : '오른발';
    const status = getAiStatusMeta(foot.status);
    const progress = capture.status === 'countdown' ? `${Math.ceil(capture.countdown_sec ?? 3)}초 뒤 시작 · 가만히 서 주세요`
      : capture.status === 'recording' ? `${capture.elapsed_sec ?? 0} / 25초 · ${(capture.elapsed_sec ?? 0) < 5 ? '가만히 서 주세요' : '평소처럼 걸어 주세요'}`
      : capture.status === 'complete' ? '보정 저장 완료 · 새 분석 창 수집'
      : capture.status === 'failed' ? `보정 실패 · ${capture.error ?? '수신 상태 확인'}` : status.label;
    return `<div class="ai-foot-result"><b>${label} · ${escapeHtml(progress)}</b><span>${foot.ready && !state.paused && state.connected && ai.available && (!Number.isFinite(foot.last_window_at_ms) || Date.now() - foot.last_window_at_ms <= 2500) ? `${displayScore(foot.decision_score)}점` : '—'} · 실제 수신 ${Number.isFinite(foot.received_hz) ? foot.received_hz : 0} Hz</span><small>${escapeHtml(foot.last_error ?? (foot.ready ? REASONS[foot.diagnostics?.reason] ?? '' : '센서 연결과 개인 보정이 필요합니다.'))}</small><button type="button" class="outline-button" data-action="${running ? 'ai-calibration-cancel' : 'ai-calibrate'}" data-ai-side="${side}" ${!ai.available || !foot.device_connected || state.paused ? 'disabled' : ''}>${running ? '보정 취소' : `${label} 개인 IMU 보정`}</button></div>`;
  }).join('');
  const diagnostics = score === null ? {} : ai.diagnostics ?? {};
  return `<div class="ai-decision-details"><p><b>최종 판단: ${escapeHtml(REASONS[diagnostics.reason] ?? '유효한 모델 결과 대기')}</b></p><p>RF ${displayScore(diagnostics.rf_score)} · CNN ${displayScore(diagnostics.cnn_score)} · 원래 모델 점수 ${displayScore(score === null ? null : ai.rawScore)} · 판정 점수 ${displayScore(score)}</p><p>분석 가능한 발 ${Number(ai.coverage ?? 0)} / 2${ai.selectedFoot ? ` · 최종 판단 기준 ${ai.selectedFoot === 'left' ? '왼발' : '오른발'}` : ''}. 양발 각각 분석 후 더 높은 상태를 표시합니다.</p><div class="ai-foot-results">${rows}</div><p>보정: 3초 준비 → 5초 정지 → 20초 일반 보행. 원시 CSV와 보정값은 이 PC에 저장됩니다. 센서를 다시 부착하거나 착용자가 바뀌면 다시 보정하세요.</p>${ai.actionError ? `<p role="alert">${escapeHtml(ai.actionError)}</p>` : ''}<small>압력·온습도·카메라 값은 각각의 관찰 지표입니다. 현재 모델 점수에 임의로 합산하지 않습니다.</small></div>`;
}

export function renderAiStatusCard(state, { compact = false } = {}) {
  const { ai, disabled, status, meta, score } = aiPresentation(state);
  const model = escapeHtml(ai.model ?? "ensemble");
  const detail = status === 'unavailable' ? 'PC의 AI 분석 프로그램과 개인 보정 파일이 필요해요.' : meta.detail;
  const connection = ai.available ? (ai.ready ? "실시간 추론 연결됨" : "브리지 연결됨 · 준비 필요") : "브리지 연결 안 됨";
  const nextView = ['calibration_missing', 'calibration_failed', 'device_offline', 'unavailable', 'invalid_data'].includes(status) ? 'devices' : 'live';

  if (compact) return `<article class="overview-insight" data-insight="ai"><div class="overview-insight-heading"><h3>AI 보행동결</h3><span class="overview-badge tone-${meta.tone}" data-live-copy>${disabled ? '선택 기능' : meta.label}</span></div><div class="overview-insight-value" data-live-copy>${score === null ? meta.label : `${displayScore(score)}점`}</div><p data-live-copy>${detail}</p><button class="text-button" data-view="${nextView}">${nextView === 'devices' ? '연결 · 개인 기준 확인' : '보행 측정에서 확인'} <span aria-hidden="true">→</span></button></article>`;

  return `<article class="panel ai-status-panel">
    <div class="panel-heading"><div><span class="panel-kicker">현재 보행 신호</span><h2>AI 보행 관찰</h2></div><span class="algorithm-pill pill-${meta.tone}"><i></i><span data-live-copy>${meta.label}</span></span></div>
    <div class="ai-status-body">
      <div class="ai-score-block"><strong data-live-copy>${displayScore(score)}</strong><span>/ 100 · 판정 점수</span></div>
      <div class="ai-status-copy"><b data-live-copy>${detail}</b><p data-live-copy>${disabled ? 'AI 분석 꺼짐' : `${connection} · 최근 ${ai.windowSec ?? 4}초 분석`}</p><div class="ai-score-track"><i style="width:${score === null ? 0 : Math.round(score * 100)}%"></i></div></div>
    </div>
    <p><button class="outline-button" data-view="devices">연결 · 개인 기준 설정</button></p>
    ${renderFogCue(state)}
    <details class="simple-details" data-ui-disclosure="ai-details"><summary>분석 근거 자세히 보기</summary>${renderAiDetails(state)}</details>
    <small class="algorithm-disclaimer">연구용 모델 결과이며 의료적 진단이 아닙니다. 센서 연결 전에는 기존 시연 데이터와 별도로 표시됩니다.</small>
  </article>`;
}
