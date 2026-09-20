import { analyzePose, METRICS, VIEWS, PROTOCOL, CAPTURE_SECONDS, SAMPLE_HZ, metricsForView, summarizeSession, comparisonKey, compareSessions, referenceError, round } from "./rom-math.js";
import { escapeHtml } from "../utils/text.js";
import { renderSetViews, renderIntegratedReport } from "./set-view.js";
import { exportSetJson, csvForSet, buildSetReport } from "./rom-sets.js";
import { resolveJointSelection, renderJointOptions, jointGuide, renderJointGuide, renderLiveJointMetrics } from './rom-joints.js';

const MODEL_VERSION = "tasks-vision-1.0.1/pose-lite-f16-v1";
const CONNECTIONS = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[27,31],[24,26],[26,28],[28,30],[30,32],[28,32]];
export function cameraErrorMessage(error) {
  if (["NotAllowedError", "PermissionDeniedError"].includes(error?.name)) return "카메라 권한이 거부됐습니다. 주소창의 사이트 권한에서 카메라를 허용한 뒤 다시 켜 주세요.";
  if (["NotFoundError", "DevicesNotFoundError"].includes(error?.name)) return "사용 가능한 웹캠이 없습니다. 연결 상태를 확인하세요.";
  if (["NotReadableError", "TrackStartError"].includes(error?.name)) return "웹캠을 열 수 없습니다. 다른 화상회의 앱의 카메라 사용을 종료하세요.";
  if (error?.name === "OverconstrainedError") return "웹캠 해상도를 설정하지 못했습니다. 다른 카메라나 브라우저에서 시도하세요.";
  return error?.message || "카메라 분석을 시작하지 못했습니다. localhost 주소와 브라우저 지원을 확인하세요.";
}
export function csvForSession(record) {
  const cell = (value) => {
    let text = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const ids = metricsForView(record.config.view).map(([id]) => id);
  const headers = ["participant", "view", "posture", "setup", "captured_at", "time_ms", "valid", ...ids.map((id) => `${id}_deg`)];
  return "\uFEFF" + [headers, ...record.samples.map((s) => [record.config.participant, record.config.view, record.config.posture, record.config.setup, record.capturedAt, s.t, s.valid, ...ids.map((id) => s.values[id] ?? "")])].map((row) => row.map(cell).join(",")).join("\r\n");
}
export function mountRomWorkspace(root) {
  if (!root) return { destroy() {}, canLeave: () => true };
  const $ = (selector) => root.querySelector(selector);
  const button = (action) => $(`[data-rom-action="${action}"]`);
  const video = $("[data-rom-video]");
  const overlay = $("[data-rom-overlay]");
  const ctx = overlay.getContext("2d");
  const graph = $("[data-rom-chart]").getContext("2d");
  const abortEvents = new AbortController();
  let alive = true, starting = false, running = false, generation = 0;
  let stream = null, worker = null, animation = 0, busyFrame = false, lastVideoTime = -1, lastSentAt = 0;
  let resultAt = 0, resultSerial = 0, lastSampleSerial = -1, lastAnalysis = null, lastPoses = [], trace = [];
  let recording = null, draft = null, frozen = null, selectedId = null, pendingSave = false, storageReady = false;
  let data = { sessions: [], references: [], baselineIds: [], sets: [] };
  let activeSetId = null;
  let workerTimeout = 0, permissionTimeout = 0, startupReject = null;
  let fpsSamples = [];

  const notice = (message, error = false) => {
    if (!alive) return;
    const el = $("[data-rom-notice]"); el.textContent = message; el.classList.toggle("is-error", error);
  };
  const config = () => ({
    participant: $("[data-rom-config=participant]").value.trim(), setup: $("[data-rom-config=setup]").value.trim(),
    view: $("input[name=rom-view]:checked").value, metric: $("[data-rom-config=metric]").value,
    posture: $("[data-rom-config=posture]").value, confidence: Number($("[data-rom-config=confidence]").value),
    width: video.videoWidth || 640, height: video.videoHeight || 480, protocol: PROTOCOL, modelVersion: MODEL_VERSION,
  });
  const selectedRecord = () => draft || data.sessions.find((s) => s.id === selectedId);
  const isFresh = () => running && performance.now() - resultAt < 400 && lastAnalysis?.valid;
  const sameConfig = (a, b) => comparisonKey({ config: a }) === comparisonKey({ config: b });
  const activeSet = () => data.sets?.find((s) => s.id === activeSetId && s.participant === config().participant);
  function setButtons() {
    button("start").disabled = starting || running || !$("[data-rom-consent]").checked;
    button("stop").disabled = !starting && !running;
    button("record").disabled = !isFresh() || Boolean(recording) || pendingSave || !config().participant || !config().setup;
    button("abort").disabled = !recording;
    button("save").disabled = !draft || pendingSave || !storageReady || Boolean(recording);
    button("baseline").disabled = !selectedRecord()?.id || !selectedRecord()?.summary?.eligible || Boolean(recording) || pendingSave || !storageReady;
    button("freeze").disabled = !isFresh() || Boolean(recording);
    button("reference").disabled = !frozen || pendingSave || !storageReady || !$("[data-rom-same-pose]").checked || Boolean(recording);
    button("export-csv").disabled = !selectedRecord();
    for (const el of root.querySelectorAll("[data-rom-config], input[name=rom-view], [data-rom-direction-confirmed]")) el.disabled = Boolean(recording);
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
  }
  function drawTrace() {
    if (!graph) return;
    const { width, height } = graph.canvas;
    graph.clearRect(0, 0, width, height);
    graph.strokeStyle = "#d7e2e8"; graph.lineWidth = 1;
    graph.font = "14px sans-serif"; graph.fillStyle = "#697a89";
    for (const a of [0, 90, 180]) { const y = height - 15 - a / 180 * (height - 30); graph.beginPath(); graph.moveTo(35, y); graph.lineTo(width - 10, y); graph.stroke(); graph.fillText(String(a), 4, y + 4); }
    graph.strokeStyle = "#168477"; graph.lineWidth = 3; graph.beginPath();
    let connected = false;
    trace.forEach((v, i) => {
      if (!Number.isFinite(v)) { connected = false; return; }
      const x = 35 + i / Math.max(1, trace.length - 1) * (width - 50), y = height - 15 - v / 180 * (height - 30);
      if (connected) graph.lineTo(x, y); else graph.moveTo(x, y);
      connected = true;
    });
    graph.stroke();
  }
  function drawOverlay(poses, ready) {
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (poses?.length !== 1) return;
    const points = poses[0], threshold = config().confidence;
    const visible = (i) => points[i]?.visibility >= threshold;
    ctx.strokeStyle = ready ? "#73efd3" : "#ffda82"; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 3;
    for (const [a, b] of CONNECTIONS) if (visible(a) && visible(b)) {
      ctx.beginPath(); ctx.moveTo(points[a].x * overlay.width, points[a].y * overlay.height); ctx.lineTo(points[b].x * overlay.width, points[b].y * overlay.height); ctx.stroke();
    }
    for (let i = 11; i < Math.min(points.length, 33); i++) if (visible(i)) {
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
  function resetFrozen() {
    frozen = null; $("[data-rom-frozen]").textContent = "고정값 없음";
    $("[data-rom-reference]").value = ""; $("[data-rom-same-pose]").checked = false;
  }
  function setupView(changed = 'view') {
    const metricSelect = $("[data-rom-config=metric]");
    const selection = resolveJointSelection(metricSelect.value, $("input[name=rom-view]:checked").value, changed);
    const { view, metric } = selection;
    $(`input[name=rom-view][value="${view}"]`).checked = true;
    metricSelect.innerHTML = renderJointOptions(metric);
    metricSelect.value = metric;
    $("[data-rom-view-label]").textContent = `${VIEWS[view]} · 좌우는 본인 기준`;
    $("[data-rom-guide]").textContent = jointGuide(metric).framing;
    $("[data-rom-joint-guide]").innerHTML = renderJointGuide(metric);
    $("[data-rom-metrics]").innerHTML = renderLiveJointMetrics(view, metric);
    lastAnalysis = null; resultAt = 0; trace = []; resetFrozen(); updateAngles(null); drawTrace(); drawOverlay([], false); renderHistory(); setButtons();
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
  function baselineFor(record) {
    return data.sessions.find((s) => data.baselineIds.includes(s.id) && comparisonKey(s) === comparisonKey(record));
  }
  function renderResult() {
    const record = selectedRecord();
    if (!record) { $("[data-rom-result]").textContent = "아직 선택한 기록이 없습니다."; $("[data-rom-comparison]").textContent = "품질 기준을 통과한 저장 기록을 개인 기준으로 지정할 수 있습니다."; return; }
    const stats = record.summary.byMetric[record.config.metric];
    $("[data-rom-result]").innerHTML = `<b>${escapeHtml(METRICS[record.config.metric].label)} · ${VIEWS[record.config.view]}</b><br><strong>${stats ? `${stats.observedRange}°` : "—"}</strong> 관찰 범위 (P05–P95)<small>${stats ? `관찰 각도 ${stats.p05}~${stats.p95}° · 중앙값 ${stats.median}°<br>` : ""}유효 ${record.summary.validCount}/${record.summary.totalCount}개 (${Math.round(record.summary.validRatio * 100)}%) · ${escapeHtml(record.summary.reason)}${draft ? " · 아직 저장하지 않음" : ""}</small>`;
    const baseline = baselineFor(record), compared = compareSessions(record, baseline);
    $("[data-rom-comparison]").textContent = baseline?.id === record.id ? "이 기록이 해당 촬영 조건의 개인 기준입니다."
      : compared ? `개인 기준 ${compared.baselineRange}° → 이번 관찰 범위 ${compared.currentRange}° (${compared.delta >= 0 ? "+" : ""}${compared.delta}°). 범위 차이이며 치료 효과 판정이 아닙니다.`
      : record.summary.eligible ? "동일한 측정 코드·방향·관절·자세·촬영 환경·신뢰도·모델·화면 비율의 개인 기준이 없습니다." : "이 기록은 품질 조건을 충족하지 않아 개인 기준 비교에서 제외합니다.";
  }
  function renderHistory() {
    const current = config();
    const records = data.sessions.filter((s) => s.config.participant === current.participant);
    $("[data-rom-view-summary]").innerHTML = Object.entries(VIEWS).map(([view, label]) => `<div>${label}<strong>${records.filter((s) => s.config.view === view && s.summary.eligible).length}개</strong><small>품질 통과 기록</small></div>`).join("");
    $("[data-rom-history]").innerHTML = records.length ? `<table><thead><tr><th>측정 시각</th><th>방향 / 관절</th><th>자세 / 환경</th><th>범위</th><th>품질</th><th>관리</th></tr></thead><tbody>${records.map((s) => `<tr><td>${escapeHtml(new Date(s.capturedAt).toLocaleString("ko-KR"))}${data.baselineIds.includes(s.id) ? '<br><span class="rom-baseline-tag">개인 기준</span>' : ""}</td><td>${VIEWS[s.config.view]}<br>${escapeHtml(METRICS[s.config.metric].label)}</td><td>${s.config.posture === "seated" ? "앉아서" : "서서"}<br>${escapeHtml(s.config.setup)}</td><td>${s.summary.byMetric[s.config.metric]?.observedRange ?? "—"}°</td><td>${s.summary.eligible ? "기록 가능" : "비교 제외"}<br>${Math.round(s.summary.validRatio * 100)}%</td><td><button type="button" data-rom-action="select" data-rom-id="${escapeHtml(s.id)}">보기</button> <button type="button" class="rom-danger" data-rom-action="delete-session" data-rom-id="${escapeHtml(s.id)}">삭제</button></td></tr>`).join("")}</tbody></table>` : "현재 측정 코드의 저장 기록이 없습니다. 정면·좌측면·우측면을 각각 기록해 주세요.";
    const refs = data.references.filter((r) => sameConfig(r.config, current));
    const errors = referenceError(refs);
    $("[data-rom-validation-summary]").textContent = errors ? `현재 촬영 조건의 참조값 ${errors.count}개 · 평균 절대 오차 ${errors.mae}° · 평균 편향 ${errors.bias >= 0 ? "+" : ""}${errors.bias}° · 최대 절대 오차 ${errors.maxError}°. 직접 입력한 참조값 기준이며 임상 인증·치료 효과 검증은 아닙니다.` : "현재 촬영 조건의 각도계 비교 자료가 없습니다. 카메라와 같은 각도 정의로 측정한 참조값을 입력하세요.";
    $("[data-rom-reference-history]").innerHTML = refs.length ? `<details class="rom-details"><summary>현재 조건의 각도계 비교값 ${refs.length}개</summary><table><thead><tr><th>추정</th><th>외부 각도계</th><th>절대 차이</th><th>관리</th></tr></thead><tbody>${refs.map((r) => `<tr><td>${r.estimated}°</td><td>${r.reference}°</td><td>${round(Math.abs(r.estimated - r.reference))}°</td><td><button type="button" data-rom-action="delete-reference" data-rom-id="${escapeHtml(r.id)}">삭제</button></td></tr>`).join("")}</tbody></table></details>` : "";
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
    $("[data-rom-set-views]").innerHTML = renderSetViews(set, data.sessions);
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
    selectedId = null;
    $("[data-rom-record-title]").textContent = interrupted ? "기록 중단 · 비교 제외" : "기록 완료 · 저장 전 확인";
    notice(interrupted ? "기록을 중단했습니다. 불편감이 있으면 운동을 멈추세요. 중단 기록은 기준 비교에서 제외합니다." : draft.summary.reason, !draft.summary.eligible);
    renderResult(); setButtons();
  }
  function stopCamera({ quiet = false } = {}) {
    generation++; starting = false; running = false;
    if (recording) finishRecording(true);
    clearTimeout(workerTimeout); clearTimeout(permissionTimeout);
    if (startupReject) { startupReject(new Error("카메라 시작을 취소했습니다.")); startupReject = null; }
    cancelAnimationFrame(animation); worker?.terminate(); worker = null;
    stream?.getTracks().forEach((track) => track.stop()); stream = null;
    video.pause(); video.srcObject = null;
    busyFrame = false; lastVideoTime = -1; resultAt = 0; lastAnalysis = null; lastPoses = [];
    $("[data-rom-empty]").hidden = false; $("[data-rom-camera-status]").textContent = "카메라 꺼짐";
    $("[data-rom-fps]").textContent = "분석 대기"; updateAngles(null); drawOverlay([], false); resetFrozen(); setButtons();
    if (!quiet) notice("카메라를 껐습니다. 영상은 저장하지 않았습니다.");
  }
  async function startCamera() {
    if (starting || running || !$("[data-rom-consent]").checked) return;
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
            trace.push(lastAnalysis.valid ? lastAnalysis.primary : null); trace = trace.slice(-100); drawTrace();
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
      const permission = navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 960 }, height: { ideal: 720 }, frameRate: { ideal: 15, max: 20 }, facingMode: "user" } });
      permission.then((lateStream) => { if (!alive || token !== generation) lateStream.getTracks().forEach((track) => track.stop()); }, () => {});
      const acquired = await Promise.race([permission, new Promise((_, reject) => { permissionTimeout = setTimeout(() => reject(new Error("카메라 권한 대기 시간이 초과됐습니다. 허용 여부를 확인하고 다시 켜 주세요.")), 30000); })]);
      clearTimeout(permissionTimeout);
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
    if (recording) {
      const elapsed = Math.round(performance.now() - recording.started);
      const fresh = isFresh() && resultSerial !== lastSampleSerial;
      lastSampleSerial = resultSerial;
      // A throttled/background timer must not create a sample beyond the saved duration.
      if (elapsed <= 20000) recording.samples.push({ t: elapsed, valid: Boolean(fresh), values: fresh ? { ...lastAnalysis.values } : {} });
      $("[data-rom-progress]").value = Math.min(CAPTURE_SECONDS, elapsed / 1000);
      $("[data-rom-progress-text]").textContent = `${Math.min(CAPTURE_SECONDS, elapsed / 1000).toFixed(1)} / 15초`;
      if (elapsed >= CAPTURE_SECONDS * 1000) finishRecording(false);
    }
    setButtons();
  }, 1000 / SAMPLE_HZ);

  function download(contents, mime, suffix) {
    const blob = new Blob([contents], { type: mime }), url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `stepon-rom-${new Date().toISOString().slice(0, 10)}.${suffix}`;
    document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  root.addEventListener("change", (event) => {
    const el = event.target;
    if (el.matches("[data-rom-set-select]")) { activeSetId = el.value || null; renderHistory(); setButtons(); return; }
    if (el.matches("[data-rom-mirror]")) { $("[data-rom-stage]").classList.toggle("is-mirrored", el.checked); return; }
    if (el.matches("input[name=rom-view], [data-rom-config]")) {
      $("[data-rom-direction-confirmed]").checked = false;
      setupView(el.matches('[data-rom-config=metric]') ? 'metric' : 'view');
    }
    if (el.matches("[data-rom-direction-confirmed]")) { lastAnalysis = null; resultAt = 0; resetFrozen(); updateAngles(null); }
    setButtons();
  }, { signal: abortEvents.signal });
  root.addEventListener("input", (event) => { if (event.target.matches("[data-rom-config], [data-rom-set-label]")) setButtons(); }, { signal: abortEvents.signal });
  root.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-rom-action]");
    if (!target || target.disabled || !alive) return;
    const action = target.dataset.romAction, id = target.dataset.romId;
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
    if (action === "record") {
      if (!isFresh() || recording) return;
      if (draft && !window.confirm("저장하지 않은 기록을 버리고 새로 측정할까요?")) return;
      resetFrozen(); draft = null; selectedId = null;
      recording = { started: performance.now(), capturedAt: new Date().toISOString(), config: config(), setId: activeSet()?.id ?? null, samples: [] };
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
        draft = null; renderResult(); setButtons();
      }
      return;
    }
    if (action === "baseline") { await mutate("POST", { action: "set_baseline", id: selectedRecord()?.id }, "동일 촬영 조건의 개인 기준으로 지정했습니다."); return; }
    if (action === "freeze" && isFresh()) { frozen = { config: config(), capturedAt: new Date().toISOString(), estimated: lastAnalysis.primary }; $("[data-rom-frozen]").textContent = `${METRICS[frozen.config.metric].label}: ${frozen.estimated}°`; $("[data-rom-same-pose]").checked = false; setButtons(); return; }
    if (action === "reference" && frozen) {
      const raw = $("[data-rom-reference]").value;
      const value = Number(raw);
      if (raw.trim() === "" || !Number.isFinite(value) || value < 0 || value > 180) { notice("외부 각도계로 측정한 0~180° 값을 입력하세요.", true); return; }
      if (await mutate("POST", { action: "save_reference", record: { ...frozen, reference: value } }, "같은 자세의 각도 비교값을 저장했습니다.")) resetFrozen();
      setButtons(); return;
    }
    if (action === "refresh") { await refreshStorage(); return; }
    if (action === "select") {
      if (recording || (draft && !window.confirm("저장하지 않은 기록을 버리고 이전 기록을 볼까요?"))) return;
      draft = null; selectedId = id; renderResult(); setButtons(); return;
    }
    if (action.startsWith("delete-")) {
      if (!window.confirm("선택한 각도 기록을 이 PC에서 삭제할까요? 연결된 세트에서는 원본 누락으로 표시됩니다. 내보낸 파일은 삭제되지 않습니다.")) return;
      if (await mutate("DELETE", { kind: action === "delete-session" ? "session" : "reference", id }, "선택한 기록을 삭제했습니다.")) { if (selectedId === id) selectedId = null; renderResult(); setButtons(); }
      return;
    }
    if (action === "clear") {
      if (!window.confirm("이 PC에 저장된 모든 측정 코드의 관절 기록·측정 세트·각도계 비교값을 삭제할까요? 복구할 수 없습니다.")) return;
      if (await mutate("DELETE", { kind: "all", confirm: "DELETE_ROM" }, "이 PC의 관절 기록을 삭제했습니다. 내보낸 파일은 별도 관리하세요.")) { selectedId = null; renderResult(); setButtons(); }
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
  setupView(); void refreshStorage();
  return {
    canLeave: () => (!recording && !draft && !pendingSave) || window.confirm("이동하면 카메라를 끄고 저장하지 않은 기록을 버립니다. 이동할까요?"),
    destroy() { if (!alive) return; stopCamera({ quiet: true }); alive = false; clearInterval(tick); abortEvents.abort(); },
  };
}
