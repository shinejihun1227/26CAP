import { analyzePose, METRICS, VIEWS, PROTOCOL, CAPTURE_SECONDS, SAMPLE_HZ, metricsForView, summarizeSession, comparisonKey, compareSessions, round } from "./rom-math.js";
import { escapeHtml } from "../utils/text.js";
import { renderSetViews, renderIntegratedReport } from "./set-view.js";
import { exportSetJson, csvForSet, buildSetReport } from "./rom-sets.js";
import { resolveJointSelection, renderJointOptions, jointGuide, renderJointGuide, renderLandmarkGuide, renderLiveJointMetrics } from './rom-joints.js';

import { comparableRecords, renderMotionCards, renderMotionInsights, renderAngleChart, renderDailyAngleChart, dailyAnglePoints, observationPlanFromRecord, renderRecordComparison } from './motion-report.js';
import { readAnkleSensor, neutralFromSamples, matchingNeutral, preparationFromRecord } from './ankle-monitor.js';
import { renderAnkleStatus } from '../components/ankle-status.js';

const MODEL_VERSION = "tasks-vision-1.0.1/pose-full-f16-v1";
const CONNECTIONS = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[27,31],[24,26],[26,28],[28,30],[30,32],[28,32]];
export function recordingReadiness({ consent, starting, running, participant, setup, metric, directionConfirmed, analysis, fresh, recording, pendingSave }) {
  if (recording) return { ready: false, reason: "15초 기록 중입니다. 불편하면 ‘중단’을 누르세요." };
  if (pendingSave) return { ready: false, reason: "기록 저장이 끝날 때까지 기다려 주세요." };
  if (!consent) return { ready: false, reason: "카메라 아래 ‘카메라 사용 동의’를 체크하세요." };
  if (starting) return { ready: false, reason: "모델과 웹캠을 준비 중입니다. 카메라 권한 요청이 뜨면 허용해 주세요." };
  if (!running) return { ready: false, reason: "‘카메라 켜기’를 누르세요." };
  if (!participant?.trim()) return { ready: false, reason: "사용자 코드(예: P01)를 입력하세요." };
  if (!setup?.trim()) return { ready: false, reason: "촬영 환경 코드를 입력하세요." };
  if (!directionConfirmed) return { ready: false, reason: "1번의 ‘선택한 발의 옆면 · 화면에는 나만’을 체크하세요." };
  if (!analysis) return { ready: false, reason: metric?.endsWith('_ankle') ? "발목 인식을 기다리고 있습니다. 정강이부터 발끝까지 화면에 크게 담아 주세요." : "관절 인식을 기다리고 있습니다. 선택한 관절과 주변이 화면에 보이게 해 주세요." };
  if (!fresh) return { ready: false, reason: "최신 관절 인식을 기다리고 있습니다. 분석이 계속 멈춰 있으면 카메라를 껐다가 다시 켜 주세요." };
  if (!analysis.valid) return { ready: false, reason: analysis.reason || "선택한 관절이 잘 보이도록 위치를 조정하세요." };
  return { ready: true, reason: "준비 완료 · ‘15초 기록 시작’을 누르세요." };
}
export function cameraMediaConstraints(deviceId = '') {
  const video = { width: { ideal: 960 }, height: { ideal: 720 }, frameRate: { ideal: 15, max: 20 } };
  if (deviceId) video.deviceId = { exact: deviceId };
  else video.facingMode = 'user';
  return { audio: false, video };
}
export function cameraErrorMessage(error) {
  if (["NotAllowedError", "PermissionDeniedError"].includes(error?.name)) return "카메라 권한이 거부됐습니다. 주소창의 사이트 권한에서 카메라를 허용한 뒤 다시 켜 주세요.";
  if (["NotFoundError", "DevicesNotFoundError"].includes(error?.name)) return "사용 가능한 웹캠이 없습니다. 연결 상태를 확인하세요.";
  if (["NotReadableError", "TrackStartError"].includes(error?.name)) return "웹캠을 열 수 없습니다. 다른 화상회의 앱의 카메라 사용을 종료하세요.";
  if (error?.name === "OverconstrainedError") return "선택한 카메라를 사용할 수 없습니다. 카메라 선택에서 기본 카메라나 다른 장치를 고르세요.";
  return error?.message || "카메라 분석을 시작하지 못했습니다. localhost 주소와 브라우저 지원을 확인하세요.";
}
export function csvForSession(record) {
  const cell = (value) => {
    let text = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const ids = record.config.metric?.endsWith('_ankle') ? [record.config.metric] : metricsForView(record.config.view).map(([id]) => id);
  const headers = ["participant", "view", "posture", "setup", "captured_at", "time_ms", "valid", ...ids.map((id) => `${id}_deg`)];
  return "\uFEFF" + [headers, ...record.samples.map((s) => [record.config.participant, record.config.view, record.config.posture, record.config.setup, record.capturedAt, s.t, s.valid, ...ids.map((id) => s.values[id] ?? "")])].map((row) => row.map(cell).join(",")).join("\r\n");
}
export function mountRomWorkspace(root, context = null, { getState = () => ({}), monitor = null } = {}) {
  if (!root) return { destroy() {}, canLeave: () => true };
  const $ = (selector) => root.querySelector(selector);
  const managing = root.dataset.romMode === "manage";
  const button = (action) => $(`[data-rom-action="${action}"]`);
  const video = $("[data-rom-video]");
  const overlay = $("[data-rom-overlay]");
  const ctx = overlay.getContext("2d");
  const graph = $("[data-rom-chart]");
  if (!managing) {
    $('[data-motion-save]').after($('.ankle-today'));
    $('[data-ankle-details]').after($('.motion-settings'));
  }
  const abortEvents = new AbortController();
  let alive = true, starting = false, running = false, generation = 0;
  let stream = null, worker = null, animation = 0, busyFrame = false, lastVideoTime = -1, lastSentAt = 0;
  let resultAt = 0, resultSerial = 0, lastSampleSerial = -1, lastAnalysis = null, lastPoses = [], trace = [];
  let recording = null, draft = null, frozen = null, selectedId = null, pendingSave = false, storageReady = false;
  let data = { sessions: [], references: [], baselineIds: [], sets: [] };
  let activeSetId = null, comparisonChoice = null, chartMode = 'live';
  let localMotionAi = { busy: false, text: '', error: '' };
  let workerTimeout = 0, permissionTimeout = 0, startupReject = null;
  let selectedCameraId = '', cameraPermissionGranted = false;
  let fpsSamples = [];
  let neutral = null, neutralCapture = null, cameraOnly = false, ankleMessage = '';
  const ankleSide = () => config().metric.startsWith('right') ? 'right' : 'left';
  const ankleSample = () => readAnkleSensor(getState(), ankleSide());

  const notice = (message, error = false) => {
    if (!alive) return;
    const el = $("[data-rom-notice]"); el.textContent = message; el.classList.toggle("is-error", error);
  };
  async function refreshCameraList(activeDeviceId = '') {
    const select = $('[data-rom-camera-select]'), help = $('[data-rom-camera-help]');
    if (!select || !navigator.mediaDevices?.enumerateDevices) return;
    const preferredId = activeDeviceId || selectedCameraId || select.value;
    try {
      const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
      select.replaceChildren(new Option('기본 카메라', ''));
      cameras.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `카메라 ${index + 1}`;
        select.append(option);
      });
      select.value = cameras.some(device => device.deviceId === preferredId) ? preferredId : '';
      selectedCameraId = select.value;
      help.textContent = cameras.length > 1
        ? '카메라를 끈 뒤 목록에서 다른 장치를 고르고 다시 켜세요.'
        : cameras.length === 1 ? '연결된 카메라가 1개입니다. 다른 장치를 연결하면 목록을 갱신할 수 있어요.'
          : '사용 가능한 카메라를 찾지 못했습니다. 연결 상태와 브라우저 권한을 확인하세요.';
    } catch {
      help.textContent = '카메라 목록을 읽지 못했습니다. 브라우저 권한과 장치 연결을 확인하세요.';
    }
  }
  const config = () => ({
    participant: $("[data-rom-config=participant]").value.trim(), setup: $("[data-rom-config=setup]").value.trim(),
    view: $("input[name=rom-view]:checked").value, metric: $("[data-rom-config=metric]").value,
    posture: $("[data-rom-config=posture]").value, confidence: Number($("[data-rom-config=confidence]").value),
    width: video.videoWidth || 640, height: video.videoHeight || 480, protocol: PROTOCOL, modelVersion: MODEL_VERSION,
  });
  const selectedRecord = () => draft || data.sessions.find((s) => s.id === selectedId && s.config.participant === config().participant);
  const hasFreshResult = () => running && performance.now() - resultAt < 400;
  const isFresh = () => hasFreshResult() && lastAnalysis?.valid;
  const cameraReadiness = () => recordingReadiness({
    consent: $("[data-rom-consent]").checked, starting, running, ...config(),
    directionConfirmed: $("[data-rom-direction-confirmed]").checked,
    analysis: lastAnalysis, fresh: hasFreshResult(), recording, pendingSave,
  });
  const recordReadiness = () => {
    const base = cameraReadiness();
    if (!base.ready || managing || cameraOnly) return base;
    if (neutralCapture) return { ready: false, reason: '3초 기준 자세를 맞추는 중이에요.' };
    if (!matchingNeutral(neutral, ankleSample())) return { ready: false, reason: '2번에서 센서 기준을 먼저 맞춰 주세요.' };
    return base;
  };
  function updateAnkleUi() {
    if (managing) return;
    monitor?.setParticipant(config().participant);
    const feet = monitor?.snapshot(getState()) || {};
    replaceHtml($('[data-ankle-status]'), renderAnkleStatus(feet));
    const busy = Boolean(recording || draft || pendingSave || neutralCapture);
    for (const side of ['left', 'right']) {
      const el = button(`ankle-${side}`);
      el.disabled = busy;
      el.setAttribute('aria-pressed', String(ankleSide() === side));
      $(`[data-ankle-side-state="${side}"]`).textContent = feet[side]?.plan && feet[side]?.code !== 'changed' ? '오늘 기록됨' : '기록 전';
    }
    const sample = ankleSample();
    button('ankle-neutral').disabled = busy || !cameraReadiness().ready || !sample.ok;
    button('ankle-neutral').textContent = neutralCapture ? '기준 맞추는 중…' : neutral ? '센서 기준 다시 맞추기' : '센서 기준 맞추기';
    button('ankle-camera-only').disabled = busy;
    button('ankle-camera-only').setAttribute('aria-pressed', String(cameraOnly));
    button('ankle-camera-only').textContent = cameraOnly ? '카메라만 기록 중 · 센서도 연결하기' : '센서 없이 카메라만 기록';
    const text = neutralCapture ? `움직이지 마세요 · ${Math.min(3, (performance.now() - neutralCapture.started) / 1000).toFixed(1)} / 3초`
      : cameraOnly ? '카메라만 기록해요. 센서 범위 비교는 준비되지 않습니다.'
      : neutral && !matchingNeutral(neutral, sample) ? `${sample.label} · 기준 자세를 다시 확인하세요.`
      : ankleMessage || (neutral ? '센서 기준 완료 · 15초 기록을 시작하세요.' : !sample.ok ? sample.label : '발을 편히 놓고 기준 맞추기를 누르세요.');
    $('[data-ankle-calibration]').textContent = text;
  }
  const sameConfig = (a, b) => comparisonKey({ config: a }) === comparisonKey({ config: b });
  const activeSet = () => data.sets?.find((s) => s.id === activeSetId && s.participant === config().participant);
  function setButtons() {
    button("start").disabled = starting || running || !$("[data-rom-consent]").checked;
    button("stop").disabled = !starting && !running;
    $("[data-rom-identity]").textContent = `${managing ? "내 기록" : "추가 설정 · 내 기록"} ${config().participant || "코드 입력 필요"}`;
    const readiness = recordReadiness(), help = $("[data-rom-record-help]");
    for (const step of root.querySelectorAll('[data-rom-step]')) {
      const id = step.dataset.romStep;
      const positioned = running && isFresh() && $('[data-rom-direction-confirmed]').checked;
      const complete = id === 'camera' ? positioned : id === 'pose' ? Boolean(neutral || cameraOnly) : Boolean(draft);
      const current = id === 'camera' ? !positioned : id === 'pose' ? positioned && !neutral && !cameraOnly : Boolean(recording || readiness.ready);
      step.classList.toggle('is-complete', complete);
      step.classList.toggle('is-current', current && !complete);
      step.querySelector('[data-rom-step-state]').textContent = complete ? '완료' : id === 'record' && recording ? '기록 중' : current ? '지금 할 일' : '대기';
    }
    button("record").disabled = !readiness.ready;
    button("record").title = readiness.reason;
    if (help.textContent !== readiness.reason) help.textContent = readiness.reason;
    help.classList.toggle("is-ready", readiness.ready);
    button("abort").disabled = !recording;
    button("save").disabled = !draft || pendingSave || !storageReady || Boolean(recording);
    if (!managing) button('save').textContent = draft?.anklePreparation ? '오늘 기준 저장' : '카메라 기록 저장';
    button("baseline").disabled = !selectedRecord()?.id || !selectedRecord()?.summary?.eligible || Boolean(recording) || pendingSave || !storageReady;
    if (button("freeze")) button("freeze").disabled = !isFresh() || Boolean(recording);
    if (button("reference")) button("reference").disabled = !frozen || pendingSave || !storageReady || !$("[data-rom-same-pose]")?.checked || Boolean(recording);
    button("export-csv").disabled = !selectedRecord();
    for (const el of root.querySelectorAll("[data-rom-config], input[name=rom-view], [data-rom-direction-confirmed]")) el.disabled = Boolean(recording);
    const cameraSelect = $('[data-rom-camera-select]');
    if (cameraSelect) cameraSelect.disabled = starting || running || Boolean(recording);
    $("[data-rom-consent]").disabled = starting || running;
    $("[data-rom-config=participant]").disabled = Boolean(recording || draft || pendingSave);
    const set = activeSet(), busy = Boolean(recording || draft || pendingSave);
    const supportsSets = storageReady && data.setSchemaVersion === 1;
    $("[data-rom-set-select]").disabled = busy || !supportsSets;
    $("[data-rom-set-label]").disabled = busy;
    button("set-create").disabled = busy || !supportsSets || !config().participant || !$("[data-rom-set-label]").value.trim();
    for (const el of root.querySelectorAll('[data-rom-action^="set-"]:not([data-rom-action="set-create"])')) el.disabled = busy || !supportsSets || !set;
    button("discard").disabled = !draft || pendingSave || Boolean(recording);
    button("save-alone").hidden = !draft?.setId || Boolean(data.sets?.some((s) => s.id === draft.setId));
    button("save-alone").disabled = !draft || pendingSave || !storageReady;
    if (!managing) {
      updateAnkleUi();
      button('review').disabled = Boolean(recording || pendingSave) || !storageReady || !$("[data-motion-review]").value;
      $("[data-motion-review]").disabled = Boolean(recording || pendingSave);
      $("[data-motion-baseline]").disabled = Boolean(recording || pendingSave) || !comparableRecords(selectedRecord(), data.sessions).length;
      renderDashboard();
    }
  }
  const renderedMarkup = new WeakMap();
  const replaceHtml = (element, html) => {
    if (element && renderedMarkup.get(element) !== html) { element.innerHTML = html; renderedMarkup.set(element, html); }
  };
  function reportBaseline(record) {
    const candidates = comparableRecords(record, data.sessions);
    if (comparisonChoice !== null) return candidates.find(s => s.id === comparisonChoice) || null;
    return candidates.find(s => data.baselineIds.includes(s.id)) || candidates[0] || null;
  }
  function liveRecord() {
    if (!recording) return selectedRecord();
    const durationMs = Math.round(performance.now() - recording.started);
    return { ...recording, durationMs, summary: summarizeSession(recording.samples, recording.config.metric, durationMs) };
  }
  function goalStorageKey(condition = config()) {
    return `stepon-rom-goal:${condition.participant}:${condition.metric}`;
  }
  function drawTrace() {
    if (managing) return;
    const record = liveRecord(), metric = record?.config.metric || config().metric;
    const baseline = !recording && reportBaseline(record);
    const samples = record ? record.samples : trace.map(s => ({ ...s, t: s.t - (trace[0]?.t || 0) }));
    if (chartMode === 'daily' && !recording) {
      const condition = record?.config ?? config();
      const selectedPlanId = (() => { try { return localStorage.getItem(goalStorageKey(condition)); } catch { return null; } })();
      const plan = observationPlanFromRecord(data.sessions.find(s => s.id === selectedPlanId));
      replaceHtml(graph, renderDailyAngleChart(dailyAnglePoints(data.sessions, condition), metric, plan?.target));
    } else {
      replaceHtml(graph, renderAngleChart(samples, metric, baseline, record ? record.durationMs / 1000 : samples.length ? samples.at(-1).t / 1000 : 15));
    }
    $('[data-motion-chart-label]').textContent = chartMode === 'daily' ? '날짜별 중앙값' : recording ? '기록 중' : record ? '선택 기록' : '실시간';
    $('[data-motion-chart-caption]').textContent = chartMode === 'daily' ? '같은 촬영 조건의 유효 기록 중앙 각도를 날짜별로 표시합니다.' : baseline ? '각도(°) · 각 기록의 시작점을 0초로 맞췄어요. 인식 누락 구간은 비워 둡니다.' : '각도(°) · 인식되지 않은 구간은 선을 연결하지 않아요.';
    $('[data-motion-chart-label]').parentElement.classList.toggle('has-baseline', Boolean(baseline));
    root.querySelectorAll('[data-rom-chart-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.romChartMode === chartMode)));
  }
  function updateObservationPlan() {
    const select = $('[data-goal-baseline-record]'), output = $('[data-observation-plan]');
    if (!select || !output) return;
    const participant = config().participant;
    const metric = config().metric;
    const eligible = data.sessions.filter(s => s.config.participant === participant && s.config.metric === metric && s.summary?.eligible)
      .sort((a,b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
    const options = `<option value="">${eligible.length ? '기준으로 삼을 기록을 선택하세요' : '선택한 관절의 유효한 기록이 없습니다'}</option>` + eligible.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(new Date(s.capturedAt).toLocaleDateString('ko-KR'))} · ${escapeHtml(METRICS[s.config.metric]?.label ?? '관절 기록')}</option>`).join('');
    replaceHtml(select, options);
    let selectedId = null;
    try { selectedId = localStorage.getItem(goalStorageKey({ participant, metric })); } catch { /* optional preference */ }
    select.value = eligible.some(s => s.id === selectedId) ? selectedId : '';
    const plan = observationPlanFromRecord(eligible.find(s => s.id === select.value));
    output.textContent = plan ? `${METRICS[plan.config.metric]?.label ?? '선택 관절'} · 시작값 ${round(plan.start)}° · ${plan.startDate}부터 ${plan.endDate}까지 같은 조건으로 관찰` : eligible.length ? '기록을 선택하면 같은 조건으로 4주 관찰 계획을 만들어요.' : '선택한 관절을 먼저 유효하게 기록하면 여기서 기준으로 정할 수 있어요.';
  }
  function renderDashboard() {
    const record = liveRecord(), baseline = !recording && reportBaseline(record);
    replaceHtml($('[data-motion-cards]'), renderMotionCards({ record, baseline, metric: config().metric, analysis: lastAnalysis, fresh: isFresh(), recording: Boolean(recording) }));
    const saved = data.sessions.find(session => session.id === selectedId && session.config.participant === config().participant);
    replaceHtml($('[data-motion-insights]'), recording ? '<p class="motion-empty">기록 중이에요. 15초가 끝나면 관찰 요약을 확인할 수 있어요.</p>' : renderMotionInsights(record, baseline, { ...localMotionAi, record: saved }));
    const aiButton = $('[data-rom-action="local-ai"]');
    if (aiButton) aiButton.disabled = localMotionAi.busy || !saved?.summary?.eligible || !saved.config.metric.endsWith('_ankle');
    const status = $('[data-motion-state]');
    status.textContent = recording ? '15초 기록 중' : record ? draft ? '기록 완료 · 저장 전' : '저장 기록 보기' : recordReadiness().ready ? '측정 준비 완료' : running ? '몸 위치 확인' : '측정 대기';
    status.classList.toggle('is-ready', Boolean(recording || recordReadiness().ready || record?.summary.eligible));
    $('[data-motion-context]').textContent = record ? `${METRICS[record.config.metric].label} · ${new Date(record.capturedAt).toLocaleString('ko-KR')}` : `${METRICS[config().metric].label} · 실시간 2D 추정값`;
    updateObservationPlan();
  }
  function updateComparisonControls(record) {
    if (managing) return;
    const review = $('[data-motion-review]'), previousValue = review.value;
    const mine = data.sessions.filter(s => s.config.participant === config().participant && s.config.metric.endsWith('_ankle')).sort((a,b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
    const title = s => `${new Date(s.capturedAt).toLocaleString('ko-KR')} · ${METRICS[s.config.metric].label}`;
    replaceHtml(review, mine.length ? '<option value="">불러올 기록을 선택하세요</option>' + mine.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(title(s))}</option>`).join('') : '<option value="">저장된 기록 없음</option>');
    review.value = mine.some(s => s.id === (selectedId || previousValue)) ? (selectedId || previousValue) : '';
    const candidates = comparableRecords(record, data.sessions), select = $('[data-motion-baseline]');
    replaceHtml(select, `<option value="">${candidates.length ? '비교 없이 보기' : '같은 조건의 이전 기록 없음'}</option>` + candidates.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(title(s))}${data.baselineIds.includes(s.id) ? ' · 개인 기준' : ''}</option>`).join(''));
    select.value = reportBaseline(record)?.id || '';
    replaceHtml($('[data-motion-comparison]'), candidates.length && comparisonChoice === '' ? '<p class="motion-empty">비교할 이전 기록을 선택하면 범위와 각도를 나란히 볼 수 있어요.</p>' : renderRecordComparison(record, reportBaseline(record)));
  }
  function drawOverlay(poses, ready) {
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (poses?.length !== 1) return;
    const points = poses[0], threshold = config().confidence;
    const visible = (i) => points[i]?.visibility >= threshold;
    ctx.strokeStyle = ready ? "#73efd3" : "#ffda82"; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 3;
    const selectedPoints = config().metric.endsWith('_ankle') ? METRICS[config().metric].points : Array.from({length: 22}, (_,i) => i+11);
    const connections = config().metric.endsWith('_ankle') ? [[selectedPoints[0], selectedPoints[1]], [selectedPoints[2], selectedPoints[3]]] : CONNECTIONS;
    for (const [a, b] of connections) if (visible(a) && visible(b)) {
      ctx.beginPath(); ctx.moveTo(points[a].x * overlay.width, points[a].y * overlay.height); ctx.lineTo(points[b].x * overlay.width, points[b].y * overlay.height); ctx.stroke();
    }
    for (const i of selectedPoints) if (visible(i)) {
      ctx.beginPath(); ctx.arc(points[i].x * overlay.width, points[i].y * overlay.height, 4, 0, Math.PI * 2); ctx.fill();
    }
  }
  function updateAngles(analysis) {
    const quality = $("[data-rom-quality]");
    quality.textContent = analysis?.reason || "카메라를 켜고 촬영 방향을 확인하세요.";
    quality.classList.toggle("is-ready", Boolean(analysis?.valid));
    for (const [id] of metricsForView(config().view)) {
      const field = $(`[data-rom-angle="${id}"]`);
      const value = analysis?.values?.[id];
      if (field) field.textContent = analysis?.valid && Number.isFinite(value) ? `${round(value)}°` : "—";
    }
  }
  function resetFrozen() { frozen = null; }
  function setupView(changed = 'view') {
    const metricSelect = $("[data-rom-config=metric]");
    const selection = resolveJointSelection(metricSelect.value, $("input[name=rom-view]:checked").value, changed);
    const { view, metric } = selection;
    $(`input[name=rom-view][value="${view}"]`).checked = true;
    metricSelect.innerHTML = renderJointOptions(metric, { historical: managing });
    metricSelect.value = metric;
    $("[data-rom-view-label]").textContent = `${VIEWS[view]} · 좌우는 본인 기준`;
    $("[data-rom-guide]").textContent = jointGuide(metric).framing;
    $("[data-rom-joint-guide]").innerHTML = renderJointGuide(metric);
    $("[data-rom-landmark-guide]").innerHTML = managing ? renderLandmarkGuide(metric) : '';
    if (!managing) {
      $('[data-ankle-empty-guide]').innerHTML = renderLandmarkGuide(metric);
      $('[data-ankle-framing]').textContent = `${metric.startsWith('left') ? '왼발' : '오른발'}의 무릎부터 발끝까지 보여 주세요.`;
    }
    $("[data-rom-metrics]").innerHTML = renderLiveJointMetrics(view, metric);
    lastAnalysis = null; resultAt = 0; trace = []; resetFrozen(); updateAngles(null); drawTrace(); drawOverlay([], false); renderHistory(); renderResult(); setButtons();
  }
  async function requestStore(method = "GET", body) {
    const response = await fetch("/api/rom", { method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(6000) });
    if (response.status === 404 && !response.headers.get("content-type")?.includes("application/json")) throw new Error("기록 API가 아직 없습니다. 웹 서버를 새 코드로 재시작하세요.");
    const payload = await response.json();
    if (!response.ok) throw Object.assign(new Error(payload.error || `기록 서버 오류 (${response.status})`), { status: response.status });
    if (!Array.isArray(payload.sessions) || !Array.isArray(payload.references) || !Array.isArray(payload.baselineIds)) throw new Error("기록 서버 응답 형식이 올바르지 않습니다.");
    return payload;
  }
  async function refreshStorage() {
    try { const payload = await requestStore(); if (!alive) return; data = payload; storageReady = true; renderHistory(); renderResult(); }
    catch (error) { storageReady = false; notice(error.message, true); }
    if (alive) setButtons();
  }
  async function mutate(method, body, message) {
    if (pendingSave) return false;
    pendingSave = true; setButtons();
    try {
      const payload = await requestStore(method, body);
      if (!alive) return false;
      data = payload; storageReady = true; notice(message); return true;
    } catch (error) { if ([404, 409].includes(error.status)) await refreshStorage(); notice(error.message, true); return false; }
    finally { pendingSave = false; if (alive) { renderHistory(); renderResult(); setButtons(); } }
  }
  function renderResult() {
    const record = selectedRecord();
    $('[data-motion-save]').hidden = !record;
    updateComparisonControls(record);
    if (!managing) { renderDashboard(); drawTrace(); }
    if (!record) { $("[data-rom-result]").textContent = "아직 선택한 기록이 없습니다."; $("[data-rom-comparison]").textContent = ""; return; }
    const stats = record.summary.byMetric[record.config.metric];
    $("[data-rom-result]").innerHTML = `<b>${draft ? '기록 완료 · 저장해 주세요' : '저장된 기록'} · ${escapeHtml(METRICS[record.config.metric].label)}</b>${stats ? `<div class="ankle-record-extrema"><span>최소 <strong>${stats.min}°</strong></span><span>최대 <strong>${stats.max}°</strong></span></div>` : ''}<small>카메라 추정 · 유효 표본 ${Math.round(record.summary.validRatio * 100)}% · ${record.summary.eligible ? '비교 가능' : '품질 부족 · 비교 제외'}</small>${draft && !managing ? `<p>${draft.anklePreparation ? '카메라·센서 기준을 함께 저장할 수 있어요.' : '센서 기준 없음 · 이 기록으로 센서 범위 비교를 시작할 수 없어요.'}</p>` : ''}`;
    $("[data-rom-comparison]").textContent = data.baselineIds.includes(record.id) ? "이 기록은 해당 촬영 조건의 개인 기준입니다." : "저장하면 다음 측정과 비교할 수 있어요. 영상은 저장하지 않아요.";
  }
  function renderHistory() {
    const current = config();
    const records = data.sessions.filter((s) => s.config.participant === current.participant);
    $("[data-rom-view-summary]").innerHTML = Object.entries(VIEWS).map(([view, label]) => `<div>${label}<strong>${records.filter((s) => s.config.view === view && s.summary.eligible).length}개</strong><small>품질 통과 기록</small></div>`).join("");
    $("[data-rom-history]").innerHTML = records.length ? `<table><thead><tr><th>측정 시각</th><th>방향 / 관절</th><th>자세 / 환경</th><th>범위</th><th>품질</th><th>관리</th></tr></thead><tbody>${records.map((s) => `<tr><td>${escapeHtml(new Date(s.capturedAt).toLocaleString("ko-KR"))}${data.baselineIds.includes(s.id) ? '<br><span class="rom-baseline-tag">개인 기준</span>' : ""}</td><td>${VIEWS[s.config.view]}<br>${escapeHtml(METRICS[s.config.metric].label)}</td><td>${s.config.posture === "seated" ? "앉아서" : "서서"}<br>${escapeHtml(s.config.setup)}</td><td>${s.summary.byMetric[s.config.metric]?.observedRange ?? "—"}°</td><td>${s.summary.eligible ? "기록 가능" : "비교 제외"}<br>${Math.round(s.summary.validRatio * 100)}%</td><td><button type="button" data-rom-action="select" data-rom-id="${escapeHtml(s.id)}">보기</button> <button type="button" class="rom-danger" data-rom-action="delete-session" data-rom-id="${escapeHtml(s.id)}">삭제</button></td></tr>`).join("")}</tbody></table>` : "현재 측정 코드의 저장 기록이 없습니다. 정면·좌측면·우측면을 각각 기록해 주세요.";
    renderSets();
  }
  function renderSets() {
    const participant = config().participant;
    if (!activeSet()) activeSetId = null;
    const set = activeSet();
    $("[data-rom-set-owner]").textContent = `현재 측정 코드: ${participant || "입력 필요"}`;
    $("[data-rom-set-select]").innerHTML = '<option value="">개별 기록 모드</option>' + (data.sets ?? []).filter((s) => s.participant === participant).map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.label)} · ${s.sessionIds.length}개 연결</option>`).join("");
    $("[data-rom-set-select]").value = activeSetId || "";
    $("[data-rom-set-notice]").textContent = storageReady && data.setSchemaVersion !== 1 ? "세트 기능을 적용하려면 웹 서버를 새 코드로 재시작하세요. 기존 개별 기록은 유지됩니다."
      : set ? `이후 저장하는 기록은 ‘${set.label}’에 함께 연결됩니다. 방향을 바꿀 때마다 촬영 확인란을 다시 체크하세요. 세트는 생성 후 30일 보관됩니다.` : "아래 측정 코드를 확인한 뒤 세트를 만드세요. 이미 저장한 기록은 방향별 기록에서 추가할 수 있습니다.";
    $("[data-rom-set-views]").innerHTML = renderSetViews(set, data.sessions, { capture: !managing });
    $("[data-rom-set-report]").innerHTML = renderIntegratedReport(set, data.sessions);
    if (set) {
      for (const el of $("[data-rom-history]").querySelectorAll('[data-rom-action="select"]')) {
        const id = el.dataset.romId;
        el.parentElement.insertAdjacentHTML("beforeend", ` <button type="button" data-rom-action="${set.sessionIds.includes(id) ? "set-remove" : "set-add"}" data-rom-id="${escapeHtml(id)}">${set.sessionIds.includes(id) ? "세트에서 빼기" : "세트에 추가"}</button>`);
      }
    }
  }
  function finishRecording(interrupted = false) {
    if (!recording) return;
    const active = recording; recording = null;
    const durationMs = Math.min(20000, Math.round(performance.now() - active.started));
    draft = { config: active.config, setId: active.setId, capturedAt: active.capturedAt, samples: active.samples, durationMs, interrupted,
      summary: summarizeSession(active.samples, active.config.metric, durationMs, interrupted) };
    draft.anklePreparation = active.neutral ? preparationFromRecord(draft, active.neutral, active.sensorSamples) : null;
    if (!managing && !cameraOnly && !draft.anklePreparation) ankleMessage = '센서 기준 기록 부족 · 천천히 움직이고 양끝에서 잠깐 멈춘 뒤 다시 기록하세요.';
    selectedId = null;
    $("[data-rom-record-title]").textContent = interrupted ? "기록 중단 · 비교 제외" : "기록 완료 · 저장 전 확인";
    notice(interrupted ? "기록을 중단했습니다. 불편감이 있으면 운동을 멈추세요. 중단 기록은 기준 비교에서 제외합니다." : draft.summary.reason, !draft.summary.eligible);
    renderResult(); setButtons();
  }
  function stopCamera({ quiet = false } = {}) {
    generation++; starting = false; running = false;
    if (recording) finishRecording(true);
    neutralCapture = null; neutral = null;
    clearTimeout(workerTimeout); clearTimeout(permissionTimeout);
    if (startupReject) { startupReject(new Error("카메라 시작을 취소했습니다.")); startupReject = null; }
    cancelAnimationFrame(animation); worker?.terminate(); worker = null;
    stream?.getTracks().forEach((track) => track.stop()); stream = null;
    video.pause(); video.srcObject = null;
    busyFrame = false; lastVideoTime = -1; resultAt = 0; lastAnalysis = null; lastPoses = []; trace = [];
    $("[data-rom-empty]").hidden = false; $("[data-rom-camera-status]").textContent = "카메라 꺼짐";
    $("[data-rom-fps]").textContent = "분석 대기"; updateAngles(null); drawOverlay([], false); resetFrozen(); setButtons(); drawTrace();
    if (!quiet) notice("카메라를 껐습니다. 영상은 저장하지 않았습니다.");
  }
  async function startCamera() {
    if (managing || starting || running || !$("[data-rom-consent]").checked) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { notice("웹캠은 http://127.0.0.1 또는 localhost, HTTPS에서 사용할 수 있습니다.", true); return; }
    if (!window.Worker || !window.createImageBitmap || !window.OffscreenCanvas) { notice("이 브라우저는 필요한 카메라 분석 기능을 지원하지 않습니다. 최신 데스크톱 브라우저에서 localhost로 열어 주세요.", true); return; }
    const token = ++generation; starting = true; setButtons();
    notice("로컬 MediaPipe 모델을 준비 중입니다. 처음에는 잠시 걸릴 수 있습니다.");
    $("[data-rom-camera-status]").textContent = "모델 준비 중";
    try {
      const modelCheck = await fetch("/vendor/mediapipe/manifest.json", { cache: "no-cache", signal: AbortSignal.timeout(5000) });
      if (!modelCheck.ok) throw new Error("모델 파일이 없습니다. 인터넷 연결 상태에서 node cap_web/tools/setup-mediapipe.mjs를 먼저 실행하세요.");
      if (!alive || token !== generation) return;
      worker = new Worker(new URL("./pose-worker.js", import.meta.url));
      await new Promise((resolve, reject) => {
        startupReject = reject;
        workerTimeout = setTimeout(() => reject(new Error("MediaPipe 초기화 시간이 초과됐습니다. 브라우저의 WebAssembly 지원과 모델 파일을 확인하세요.")), 25000);
        worker.onerror = () => {
          const error = new Error("MediaPipe 분석 작업을 시작하지 못했습니다. 로컬 모델 파일 또는 브라우저 지원을 확인하세요.");
          if (starting) reject(error); else { stopCamera({ quiet: true }); notice(error.message, true); }
        };
        worker.onmessage = ({ data: result }) => {
          if (!alive || token !== generation) return;
          if (result.type === "ready") { clearTimeout(workerTimeout); startupReject = null; resolve(); }
          else if (result.type === "error") {
            const error = new Error(`MediaPipe 오류: ${result.message}`);
            if (starting) reject(error); else { stopCamera({ quiet: true }); notice(error.message, true); }
          } else if (result.type === "result" && running) {
            busyFrame = false; resultAt = performance.now(); resultSerial++; lastPoses = result.poses;
            lastAnalysis = analyzePose(result.poses, { ...config(), directionConfirmed: $("[data-rom-direction-confirmed]").checked });
            if (resultAt - result.timestamp > 800) lastAnalysis = { valid: false, values: {}, reason: "분석 지연이 큽니다. 다른 앱을 닫거나 웹캠 해상도를 줄이세요." };
            updateAngles(lastAnalysis); drawOverlay(result.poses, lastAnalysis.valid);
            trace.push({ t: resultAt, valid: lastAnalysis.valid, values: { ...lastAnalysis.values } }); trace = trace.slice(-100); drawTrace();
            fpsSamples = [...fpsSamples.filter((t) => resultAt - t < 2000), resultAt];
            $("[data-rom-fps]").textContent = `${round(fpsSamples.length / 2)} 분석/초 · 기록 5 Hz`;
            setButtons();
          }
        };
        worker.postMessage({ type: "init" });
      });
      if (!alive || token !== generation) return;
      notice("브라우저의 카메라 권한을 허용해 주세요. 마이크는 요청하지 않습니다.");
      $("[data-rom-camera-status]").textContent = "웹캠 연결 중";
      // If the permission prompt is ignored/cancelled by navigation, close a late stream immediately.
      const permission = navigator.mediaDevices.getUserMedia(cameraMediaConstraints(selectedCameraId));
      permission.then((lateStream) => { if (!alive || token !== generation) lateStream.getTracks().forEach((track) => track.stop()); }, () => {});
      const acquired = await Promise.race([permission, new Promise((_, reject) => { permissionTimeout = setTimeout(() => reject(new Error("카메라 권한 대기 시간이 초과됐습니다. 허용 여부를 확인하고 다시 켜 주세요.")), 30000); })]);
      clearTimeout(permissionTimeout);
      if (!alive || token !== generation) { acquired.getTracks().forEach((track) => track.stop()); return; }
      cameraPermissionGranted = true;
      const activeDeviceId = acquired.getVideoTracks()[0]?.getSettings?.().deviceId || selectedCameraId;
      await refreshCameraList(activeDeviceId);
      if (!alive || token !== generation) { acquired.getTracks().forEach((track) => track.stop()); return; }
      stream = acquired;
      video.srcObject = stream; await video.play();
      if (!alive || token !== generation) return;
      for (const track of stream.getVideoTracks()) track.addEventListener("ended", () => { if (running) { stopCamera({ quiet: true }); notice("카메라 연결이 끊겨 기록을 중단했습니다.", true); } }, { once: true });
      overlay.width = video.videoWidth; overlay.height = video.videoHeight;
      $("[data-rom-stage]").style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
      $("[data-rom-empty]").hidden = true; $("[data-rom-camera-status]").textContent = "웹캠 연결됨 · 로컬 분석";
      running = true; starting = false; lastSentAt = 0; fpsSamples = [];
      notice("촬영 방향을 확인하고 관절이 모두 보이면 15초 기록을 시작하세요. 영상은 서버로 전송하지 않습니다.");
      renderHistory(); setButtons();
      const loop = async (now) => {
        if (!alive || !running || token !== generation) return;
        animation = requestAnimationFrame(loop);
        if (busyFrame || now - lastSentAt < 1000 / 15 || video.readyState < 2 || video.currentTime === lastVideoTime) return;
        busyFrame = true; lastSentAt = now; lastVideoTime = video.currentTime;
        try {
          const bitmap = await createImageBitmap(video);
          if (!alive || !running || token !== generation) { bitmap.close(); return; }
          worker.postMessage({ type: "frame", bitmap, timestamp: now }, [bitmap]);
        } catch (error) { stopCamera({ quiet: true }); notice(cameraErrorMessage(error), true); }
      };
      animation = requestAnimationFrame(loop);
    } catch (error) {
      if (alive && token === generation) { stopCamera({ quiet: true }); notice(cameraErrorMessage(error), true); }
    }
  }
  const tick = setInterval(() => {
    if (!alive) return;
    if (running && resultAt && performance.now() - resultAt > 1200) { lastAnalysis = null; updateAngles({ valid: false, values: {}, reason: "관절 추정이 지연되거나 중단됐습니다. 해당 표본은 기록에서 제외합니다." }); drawOverlay([], false); }
    if (running && busyFrame && performance.now() - lastSentAt > 8000) { stopCamera({ quiet: true }); notice("분석 응답이 없어 카메라를 중단했습니다. 다시 켜 주세요.", true); }
    if (neutralCapture) {
      const sample = ankleSample(), capture = neutralCapture;
      if (!isFresh() || !sample.ok) capture.samples = [];
      else if (capture.samples.at(-1)?.key !== sample.key) capture.samples.push(sample);
      if (performance.now() - capture.started >= 3000) {
        neutral = neutralFromSamples(capture.samples);
        neutralCapture = null;
        ankleMessage = neutral ? '센서 기준 완료 · 15초 기록을 시작하세요.' : '기준을 맞추지 못했어요. 발을 가만히 놓고 다시 눌러 주세요.';
      }
    }
    if (recording) {
      const elapsed = Math.round(performance.now() - recording.started);
      const fresh = isFresh() && resultSerial !== lastSampleSerial;
      lastSampleSerial = resultSerial;
      // A throttled/background timer must not create a sample beyond the saved duration.
      if (elapsed <= 20000) recording.samples.push({ t: elapsed, valid: Boolean(fresh), values: fresh ? { ...lastAnalysis.values } : {}, compensation: fresh ? lastAnalysis.compensation : null });
      if (fresh && recording.neutral) {
        const sample = ankleSample();
        if (matchingNeutral(recording.neutral, sample) && recording.sensorSamples.at(-1)?.key !== sample.key) recording.sensorSamples.push(sample);
      }
      $("[data-rom-progress]").value = Math.min(CAPTURE_SECONDS, elapsed / 1000);
      $("[data-rom-progress-text]").textContent = `${Math.min(CAPTURE_SECONDS, elapsed / 1000).toFixed(1)} / 15초`;
      if (elapsed >= CAPTURE_SECONDS * 1000) finishRecording(false);
    }
    setButtons();
    if (recording) drawTrace();
  }, 1000 / SAMPLE_HZ);

  function download(contents, mime, suffix) {
    const blob = new Blob([contents], { type: mime }), url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `stepon-rom-${new Date().toISOString().slice(0, 10)}.${suffix}`;
    document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  root.addEventListener("change", (event) => {
    const el = event.target;
    if (el.matches('[data-goal-baseline-record]')) {
      try { el.value ? localStorage.setItem(goalStorageKey(), el.value) : localStorage.removeItem(goalStorageKey()); } catch { /* optional preference */ }
      renderDashboard(); drawTrace(); return;
    }
    if (el.matches('[data-rom-camera-select]')) {
      selectedCameraId = el.value;
      $('[data-rom-camera-help]').textContent = selectedCameraId
        ? '선택한 카메라를 사용하려면 웹캠을 켜세요.'
        : '기본 카메라를 사용합니다. 웹캠을 켜서 확인하세요.';
      return;
    }
    if (el.matches('[data-motion-baseline]')) { comparisonChoice = el.value; renderResult(); setButtons(); return; }
    if (el.matches('[data-motion-review]')) { setButtons(); return; }
    if (el.matches("[data-rom-set-select]")) { activeSetId = el.value || null; renderHistory(); setButtons(); return; }
    if (el.matches("[data-rom-mirror]")) { $("[data-rom-stage]").classList.toggle("is-mirrored", el.checked); return; }
    if (el.matches("input[name=rom-view], [data-rom-config]")) {
      neutral = null; neutralCapture = null; ankleMessage = '';
      if (!draft) { selectedId = null; comparisonChoice = null; }
      localMotionAi = { busy: false, text: '', error: '' };
      // Naming a record or changing confidence does not change the wearer's orientation.
      if (el.matches('input[name=rom-view], [data-rom-config=metric], [data-rom-config=posture]')) $("[data-rom-direction-confirmed]").checked = false;
      setupView(el.matches('[data-rom-config=metric]') ? 'metric' : 'view');
    }
    if (el.matches("[data-rom-direction-confirmed]")) { lastAnalysis = null; resultAt = 0; resetFrozen(); updateAngles(null); }
    setButtons();
  }, { signal: abortEvents.signal });
  navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    if (cameraPermissionGranted && !managing) void refreshCameraList();
  }, { signal: abortEvents.signal });
  root.addEventListener("input", (event) => { if (event.target.matches("[data-rom-config], [data-rom-set-label]")) setButtons(); }, { signal: abortEvents.signal });
  root.addEventListener("click", async (event) => {
    const chartModeButton = event.target.closest('[data-rom-chart-mode]');
    if (chartModeButton) { chartMode = chartModeButton.dataset.romChartMode === 'daily' ? 'daily' : 'live'; drawTrace(); return; }
    const target = event.target.closest("[data-rom-action]");
    if (!target || target.disabled || !alive) return;
    const action = target.dataset.romAction, id = action === 'review' ? $('[data-motion-review]')?.value : target.dataset.romId;
    if (action === 'ankle-left' || action === 'ankle-right') {
      if (recording || draft || pendingSave || neutralCapture) return;
      const side = action === 'ankle-left' ? 'left' : 'right';
      $('[data-rom-config=metric]').value = `${side}_ankle`;
      $('[data-rom-direction-confirmed]').checked = false;
      neutral = null; neutralCapture = null; ankleMessage = ''; selectedId = null;
      setupView('metric'); return;
    }
    if (action === 'ankle-camera-only') {
      cameraOnly = !cameraOnly; neutral = null; ankleMessage = ''; setButtons(); return;
    }
    if (action === 'ankle-neutral') {
      if (!cameraReadiness().ready || !ankleSample().ok) return;
      cameraOnly = false; neutral = null; ankleMessage = '';
      monitor?.clearSide(ankleSide());
      neutralCapture = { started: performance.now(), samples: [ankleSample()] }; setButtons(); return;
    }
    if (action === 'show-comparison') { $('#rom-record-comparison')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    if (action === 'local-ai') {
      const record = data.sessions.find(session => session.id === selectedId && session.config.participant === config().participant);
      if (!record?.summary?.eligible || !record.config.metric.endsWith('_ankle')) { notice('먼저 품질 기준을 통과한 발목 기록을 불러와 주세요.'); return; }
      const stats = record.summary.byMetric[record.config.metric];
      const compared = compareSessions(record, reportBaseline(record));
      localMotionAi = { busy: true, text: '', error: '' }; renderDashboard();
      try {
        const response = await fetch('/api/rom/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          metric: record.config.metric,
          medianDeg: stats.median,
          observedRangeDeg: stats.observedRange,
          validRatio: record.summary.validRatio,
          previousRangeDeltaDeg: compared?.delta ?? null,
        }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(response.status === 503 ? 'Ollama를 실행하고 qwen2.5:3b 모델을 준비한 뒤 다시 시도하세요.' : `로컬 AI 요청 실패 (${response.status})`);
        localMotionAi = { busy: false, text: String(result.text || ''), error: '' };
        if (!localMotionAi.text) throw new Error('Ollama가 빈 답변을 반환했습니다. 다시 시도하세요.');
      } catch (error) {
        localMotionAi = { busy: false, text: '', error: error?.message || '로컬 AI에 연결할 수 없습니다. Ollama 실행 상태를 확인하세요.' };
      }
      renderDashboard(); return;
    }
    if (pendingSave && !["stop", "abort"].includes(action)) return;
    if (action.startsWith("set-")) {
      if (recording || draft) return;
      if (action === "set-create") {
        const participant = config().participant, label = $("[data-rom-set-label]").value.trim();
        if (await mutate("POST", { action: "create_set", record: { participant, label } }, "측정 세트를 만들었습니다. 정면·좌측면·우측면을 차례로 기록하세요.")) {
          activeSetId = data.createdSetId;
          renderHistory(); setButtons();
        }
        return;
      }
      const set = activeSet(); if (!set) return;
      if (action === "set-capture") {
        const view = target.dataset.romView;
        const radio = $(`input[name=rom-view][value="${view}"]`); if (!radio) return;
        radio.checked = true; $("[data-rom-direction-confirmed]").checked = false;
        setupView('view');
        $("[data-rom-direction-confirmed]").focus();
        notice(`${VIEWS[view]} 촬영 준비입니다. 방향과 관절을 확인한 뒤 15초 기록을 시작하세요.`);
      } else if (["set-add", "set-remove", "set-prune"].includes(action)) {
        const sessionIds = action === "set-add" ? [...new Set([...set.sessionIds, id])] : action === "set-remove" ? set.sessionIds.filter((item) => item !== id) : set.sessionIds.filter((item) => !buildSetReport(set, data.sessions).missingIds.includes(item));
        await mutate("POST", { action: "update_set", record: { id: set.id, revision: set.revision, sessionIds } }, action === "set-add" ? "원본 기록을 세트에 연결했습니다." : "세트 연결을 정리했습니다. 원본 기록은 삭제하지 않았습니다.");
      } else if (action === "set-delete") {
        if (!window.confirm(`‘${set.label}’ 세트만 삭제할까요? 연결된 각도 원본 기록은 남습니다.`)) return;
        if (await mutate("DELETE", { kind: "set", id: set.id, revision: set.revision }, "세트만 삭제했습니다. 원본 각도 기록은 유지했습니다.")) { activeSetId = null; renderHistory(); setButtons(); }
      } else if (action === "set-json" || action === "set-csv") {
        if (!set.sessionIds.length) { notice("세트에 기록을 먼저 추가하세요."); return; }
        // Refresh before export so deletion/expiry in another tab is not silently resurrected.
        await refreshStorage(); const freshSet = activeSet();
        if (!storageReady || !freshSet || freshSet.id !== set.id) { notice("세트가 바뀌었거나 최신 자료를 확인하지 못해 내보내지 않았습니다. 세트를 확인하고 다시 눌러 주세요.", true); return; }
        if (action === "set-json") download(JSON.stringify(exportSetJson(freshSet, data.sessions), null, 2), "application/json", "set.json");
        else {
          const csv = csvForSet(freshSet, data.sessions);
          if (!csv.includes("\r\n")) { notice("내보낼 원본 각도 표본이 없습니다. 연결·누락 정보는 통합 JSON으로 내보낼 수 있습니다."); return; }
          download(csv, "text/csv;charset=utf-8", "set.csv");
        }
      }
      return;
    }
    if (action === "discard") {
      if (!draft || !window.confirm("아직 저장하지 않은 각도 기록을 버릴까요?")) return;
      draft = null; selectedId = null;
      $("[data-rom-record-title]").textContent = "15초 움직임 기록";
      $("[data-rom-progress]").value = 0; $("[data-rom-progress-text]").textContent = "0 / 15초";
      renderResult(); setButtons(); return;
    }
    if (action === "start") { void startCamera(); return; }
    if (action === "stop") { stopCamera(); return; }
    if (action === "record" && !managing) {
      const readiness = recordReadiness();
      if (!readiness.ready) { notice(readiness.reason); setButtons(); return; }
      if (draft && !window.confirm("저장하지 않은 기록을 버리고 새로 측정할까요?")) return;
      resetFrozen(); draft = null; selectedId = null; comparisonChoice = null;
      monitor?.clearSide(ankleSide());
      recording = { started: performance.now(), capturedAt: new Date().toISOString(), config: config(), setId: activeSet()?.id ?? null, samples: [], neutral: cameraOnly ? null : neutral, sensorSamples: [] };
      lastSampleSerial = resultSerial;
      $("[data-rom-record-title]").textContent = "15초 기록 중 · 편안한 범위에서";
      $("[data-rom-progress]").value = 0; $("[data-rom-progress-text]").textContent = "0 / 15초";
      notice("기록 중입니다. 아프거나 어지러우면 즉시 중단하세요."); renderResult(); setButtons(); return;
    }
    if (action === "abort") { finishRecording(true); stopCamera({ quiet: true }); return; }
    if (["save", "save-alone"].includes(action) && draft) {
      const toSave = draft;
      const setId = action === "save-alone" ? null : toSave.setId;
      const set = data.sets?.find((s) => s.id === setId);
      if (setId && !set) { notice("기록 대상 세트가 없습니다. 개별 기록으로 저장하거나 미저장 기록을 버릴 수 있습니다.", true); return; }
      if (await mutate("POST", { action: "save_session", record: toSave, setId, setRevision: set?.revision }, set ? "각도 기록을 저장하고 현재 측정 세트에 연결했습니다." : "이 PC에 각도 기록을 저장했습니다. 영상은 저장하지 않았습니다.")) {
        selectedId = data.savedSessionId || data.sessions.find((s) => s.capturedAt === toSave.capturedAt && sameConfig(s.config, toSave.config))?.id;
        if (toSave.anklePreparation && selectedId && monitor?.save({ ...toSave.anklePreparation, recordId: selectedId })) {
          ankleMessage = '오늘의 카메라·센서 기준 저장 완료';
          notice(`${ankleSide() === 'left' ? '왼발' : '오른발'} 기준을 저장했어요. 반대 발도 선택해서 기록해 주세요.`);
        } else if (!managing) notice('카메라 기록은 저장했어요. 센서 비교 기준은 아직 준비되지 않았습니다.');
        draft = null; renderResult(); setButtons();
      }
      return;
    }
    if (action === "baseline") { comparisonChoice = null; await mutate("POST", { action: "set_baseline", id: selectedRecord()?.id }, "동일 촬영 조건의 개인 기준으로 지정했습니다."); return; }
    if (action === "freeze" && isFresh()) { frozen = { config: config(), capturedAt: new Date().toISOString(), estimated: lastAnalysis.primary }; $("[data-rom-frozen]").textContent = `${METRICS[frozen.config.metric].label}: ${frozen.estimated}°`; $("[data-rom-same-pose]").checked = false; setButtons(); return; }
    if (action === "reference" && frozen) {
      const raw = $("[data-rom-reference]").value;
      const value = Number(raw);
      if (raw.trim() === "" || !Number.isFinite(value) || value < 0 || value > 180) { notice("외부 각도계로 측정한 0~180° 값을 입력하세요.", true); return; }
      if (await mutate("POST", { action: "save_reference", record: { ...frozen, reference: value } }, "같은 자세의 각도 비교값을 저장했습니다.")) resetFrozen();
      setButtons(); return;
    }
    if (action === "refresh") { await refreshStorage(); return; }
    if (action === "select" || action === "review") {
      if (recording || (draft && !window.confirm("저장하지 않은 기록을 버리고 이전 기록을 볼까요?"))) return;
      const record = data.sessions.find(s => s.id === id && s.config.participant === config().participant);
      if (!record) return;
      if (!managing && !record.config.metric.endsWith('_ankle')) { notice('다른 부위의 이전 기록은 데이터 관리에서 확인하세요.'); return; }
      stopCamera({ quiet: true }); draft = null; selectedId = id; comparisonChoice = null;
      localMotionAi = { busy: false, text: '', error: '' };
      $('[data-rom-config=metric]').innerHTML = renderJointOptions(record.config.metric, { historical: managing });
      for (const key of ['setup', 'metric', 'posture', 'confidence']) $(`[data-rom-config=${key}]`).value = record.config[key];
      if (!managing) $('[data-rom-config=posture]').value = 'seated';
      $(`input[name=rom-view][value="${record.config.view}"]`).checked = true;
      $('[data-rom-direction-confirmed]').checked = false;
      setupView('metric'); renderResult(); setButtons();
      notice('저장된 기록을 불러왔어요. 새 측정은 웹캠을 켜고 몸 위치를 다시 확인해 주세요.');
      if (!managing) $('[data-motion-analysis]').scrollIntoView({ block: 'start' });
      return;
    }
    if (action.startsWith("delete-")) {
      if (!window.confirm("선택한 각도 기록을 이 PC에서 삭제할까요? 연결된 세트에서는 원본 누락으로 표시됩니다. 내보낸 파일은 삭제되지 않습니다.")) return;
      if (await mutate("DELETE", { kind: action === "delete-session" ? "session" : "reference", id }, "선택한 기록을 삭제했습니다.")) { if (selectedId === id) selectedId = null; monitor?.clear(id); renderResult(); setButtons(); }
      return;
    }
    if (action === "clear") {
      if (!window.confirm("이 PC에 저장된 모든 측정 코드의 관절 기록·측정 세트·각도계 비교값을 삭제할까요? 복구할 수 없습니다.")) return;
      if (await mutate("DELETE", { kind: "all", confirm: "DELETE_ROM" }, "이 PC의 관절 기록을 삭제했습니다. 내보낸 파일은 별도 관리하세요.")) { selectedId = null; monitor?.clear(); renderResult(); setButtons(); }
      return;
    }
    if (action === "export-json") {
      const participant = config().participant;
      const records = data.sessions.filter((s) => s.config.participant === participant);
      const references = data.references.filter((r) => r.config.participant === participant);
      if (!records.length && !references.length && !draft && !(data.sets ?? []).some((s) => s.participant === participant)) { notice("내보낼 기록이 없습니다."); return; }
      download(JSON.stringify({ schemaVersion: 1, protocol: PROTOCOL, exportedAt: new Date().toISOString(), angleBasis: "image-plane-2D-degrees", sessions: records, references, measurementSets: (data.sets ?? []).filter((s) => s.participant === participant), baselineIds: data.baselineIds.filter((id) => records.some((s) => s.id === id)), unsavedDraft: draft?.config.participant === participant ? draft : null, caution: "관찰/연구용. 임상 ROM/치료 효과 검증 자료가 아님. 영상/음성/원본 랜드마크 없음." }, null, 2), "application/json", "json"); return;
    }
    if (action === "export-csv" && selectedRecord()) download(csvForSession(selectedRecord()), "text/csv;charset=utf-8", "csv");
  }, { signal: abortEvents.signal });
  const onVisibility = () => { if (document.hidden && (running || starting)) { stopCamera({ quiet: true }); notice("화면을 벗어나 카메라를 껐습니다. 진행 중 기록은 중단 처리했습니다."); } };
  document.addEventListener("visibilitychange", onVisibility, { signal: abortEvents.signal });
  window.addEventListener("pagehide", () => stopCamera({ quiet: true }), { signal: abortEvents.signal });
  window.addEventListener("beforeunload", (event) => { if (recording || draft || pendingSave) { event.preventDefault(); event.returnValue = ""; } }, { signal: abortEvents.signal });
  if (context) {
    for (const key of ['participant', 'setup', 'metric', 'posture', 'confidence']) {
      if (context[key] !== undefined) $(`[data-rom-config=${key}]`).value = context[key];
    }
    if (VIEWS[context.view]) $(`input[name=rom-view][value="${context.view}"]`).checked = true;
  }
  if (!managing) {
    if (!['left_ankle', 'right_ankle'].includes($('[data-rom-config=metric]').value)) $('[data-rom-config=metric]').value = 'left_ankle';
    $('[data-rom-config=posture]').value = 'seated';
    if (!context?.participant && monitor) $('[data-rom-config=participant]').value = monitor.getParticipant();
  }
  setupView('metric'); void refreshStorage();
  if (managing) notice("기록을 저장한 사용자 코드를 선택하세요. 세트는 이미 저장한 기록을 묶어 관리합니다.");
  return {
    getContext: config,
    canLeave: () => (!recording && !draft && !pendingSave) || window.confirm("이동하면 카메라를 끄고 저장하지 않은 기록을 버립니다. 이동할까요?"),
    destroy() { if (!alive) return; stopCamera({ quiet: true }); alive = false; clearInterval(tick); abortEvents.abort(); },
  };
}
