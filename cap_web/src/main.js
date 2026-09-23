import { renderSidebar } from "./components/sidebar.js";
import { initialState, evolveState } from "./data/dashboard-data.js";
import { analyzeRehabFrame, captureRehabCalibration, createDefaultRehabState } from "./data/gait-algorithms.js";
import { renderOverview } from "./views/overview-view.js";
import { renderLiveView } from "./views/live-view.js";
import { renderSafetyView } from "./views/safety-view.js";
import { renderReportsView } from "./views/reports-view.js";
import { renderDevicesView } from "./views/devices-view.js";
import { renderMediaPipeView } from "./views/mediapipe-view.js";
import { renderOnboarding } from "./views/onboarding-view.js";
import { cueMessages, speakCue, runOutputTest, outputTestError } from "./services/cue-controller.js";
import { observationGoals } from "./data/dashboard-data.js";
import { escapeHtml } from "./utils/text.js";
import { applyDirectTextOverrides, mountEditor } from "./editor/editor-view.js";
import { saveMediaPipeSetting } from "./views/mediapipe-view.js";
import { loadSensorLayout, normalizeSensorLayout } from "./data/sensor-layout.js";
import { loadFootLayout, normalizeFootLayout } from "./data/foot-layout.js";
import { renderMobileApp, renderMobileOnboarding } from "./mobile/mobile-app.js";
import { fetchEsp32State, markEsp32Disconnected, normalizeEsp32State } from "./services/esp32-api.js";
import { setLaser, vibrate, usesBilateralSta, hubRequest } from "./services/esp32-api.js";
import { fetchAiState, markAiUnavailable, normalizeAiState, calibrateAi, setFogCue } from "./services/ai-api.js";
import { mountRomWorkspace } from "./mediapipe/rom-controller.js";
import { renderTrendsView } from "./views/trends-view.js";
import { renderRecordsView } from './views/records-view.js';
import { mountTrendWorkspace } from "./trends/trend-controller.js";
import { emptyPressure } from "./data/sensor-config.js";
import { captureViewContinuity, restoreViewContinuity } from "./utils/view-continuity.js";
import { captureInsoleControls, restoreInsoleControls, isEditingInsole } from "./utils/insole-ui.js";
import { updateInsoleReadings } from "./components/insole-connection.js";
import { createInteractionGuard } from './utils/interaction-guard.js';
import { updateAppShell } from './utils/app-shell.js';

const app = document.querySelector("#app");
const profileStorageKey = "stepon-cap-web-profile";
const rehabLogStorageKey = "stepon-rehab-daily-log";
const query = new URLSearchParams(window.location.search);
const isEditorMode = window.location.port === "8001" || query.get("mode") === "editor";
const isMobilePath = window.location.pathname === "/mobile" || window.location.pathname.startsWith("/mobile/");
const isMobileUi = !isEditorMode && (isMobilePath || query.get("mobile") === "1" || (query.get("mobile") !== "0" && window.matchMedia?.("(max-width: 800px)").matches));
const esp32Enabled = !isEditorMode && !["0", "false"].includes(query.get("esp32")) && (["1", "true"].includes(query.get("esp32")) || (() => {
  try { return window.localStorage.getItem("stepon-esp32-enabled") === "true"; } catch { return false; }
})());
const aiEnabled = !isEditorMode && esp32Enabled && !['0', 'false'].includes(query.get('ai'));
const viewRenderers = { overview: renderOverview, live: renderLiveView, safety: renderSafetyView, reports: renderReportsView, devices: renderDevicesView, mediapipe: renderMediaPipeView, trends: renderTrendsView, records: renderRecordsView };
const validViews = new Set(Object.keys(viewRenderers));

function loadProfile() {
  try {
    return JSON.parse(window.localStorage.getItem(profileStorageKey) ?? "null");
  } catch {
    return null;
  }
}

const storedProfile = loadProfile();
let state = {
  ...initialState,
  dataSource: esp32Enabled ? "esp32" : initialState.dataSource,
  rehab: createDefaultRehabState(esp32Enabled),
  rehabLog: loadRehabLog(),
  connected: esp32Enabled ? false : initialState.connected,
  device: esp32Enabled ? { ...initialState.device, battery: null, lastSync: "연결 중", signal: "ESP32 연결 중" } : initialState.device,
  pressure: esp32Enabled ? emptyPressure() : initialState.pressure,
  bilateralPressure: esp32Enabled ? { left: emptyPressure(), right: emptyPressure() } : initialState.bilateralPressure,
  thermal: esp32Enabled ? { left: initialState.thermal.left.map((item) => ({ ...item, temp: null, humidity: null, available: false })), right: initialState.thermal.right.map((item) => ({ ...item, temp: null, humidity: null, available: false })) } : initialState.thermal,
  metrics: esp32Enabled ? { risk: null, steps: 0, cadence: null, stride: null, balance: null, temperature: null, humidity: null } : initialState.metrics,
  events: esp32Enabled ? [] : initialState.events,
  hardware: esp32Enabled && usesBilateralSta() ? { transport: 'sta', feet: {}, sensors: {} } : undefined,
  profile: { ...initialState.profile, ...(storedProfile ?? {}) },
  outputs: { ...initialState.outputs, ...(storedProfile?.outputs ?? {}) },
};
let esp32LastError = null;
let rehabHistory = {};
const requestedView = new URLSearchParams(window.location.search).get("view");
let activeView = validViews.has(requestedView) ? requestedView : "overview";
const previewDashboard = new URLSearchParams(window.location.search).get("preview") === "1";
// Real-sensor mode should open the dashboard immediately so the ESP32 stream
// can be verified before optional profile setup is completed.
let showOnboarding = !storedProfile?.configured && !previewDashboard && !esp32Enabled;
let sharedDirectTextOverrides = {};
let sharedSensorLayout = loadSensorLayout();
let sharedFootLayout = loadFootLayout();
let romWorkspace = null;
let trendWorkspace = null;
let romContext = null;
let trendContext = null;
let esp32RequestInFlight = false;
let aiRequestInFlight = false;
let outputTestInFlight = false;
let renderedView = null;
let toastMessage = '';
let toastTimer;
const toastMarkup = () => `<div class="toast-region" aria-live="polite">${toastMessage ? `<div class="toast">${escapeHtml(toastMessage)}</div>` : ''}</div>`;
const interactionGuard = createInteractionGuard(app, () => renderView());

function renderView(force = false) {
  if (isEditorMode) {
    return;
  }
  // Native dropdowns and both address forms must survive background polling.
  if (!force && renderedView === activeView && interactionGuard.defer()) return;
  if (!force && renderedView === activeView && !showOnboarding && isEditingInsole(app)) {
    updateInsoleReadings(app, state);
    return;
  }
  // Never replace a running video element when sensor/editor polling refreshes the app.
  if (romWorkspace && renderedView === activeView && ['mediapipe', 'records'].includes(activeView) && !showOnboarding) return;
  if (trendWorkspace && renderedView === activeView && ['trends', 'records'].includes(activeView) && !showOnboarding) return;
  if (romWorkspace) { romContext = romWorkspace.getContext(); romWorkspace.destroy(); romWorkspace = null; }
  if (trendWorkspace) { trendContext = trendWorkspace.getContext(); trendWorkspace.destroy(); trendWorkspace = null; }
  if (showOnboarding) {
    app.innerHTML = `${isMobileUi ? renderMobileOnboarding(state) : renderOnboarding(state)}${toastMarkup()}`;
    return;
  }
  const viewState = { ...state, aiEnabled, sensorLayout: sharedSensorLayout, footLayout: sharedFootLayout };
  const continuity = renderedView === activeView ? captureViewContinuity(app) : null;
  const insoleControls = renderedView === activeView ? captureInsoleControls(app) : null;
  updateAppShell(app, `${isMobileUi ? renderMobileApp(viewState, activeView) : `<div class="app-frame">${renderSidebar(activeView, viewState)}${viewRenderers[activeView](viewState)}</div>`}${toastMarkup()}`, isMobileUi, renderedView === activeView);
  applySafeTextOverrides();
  restoreViewContinuity(app, continuity);
  restoreInsoleControls(app, insoleControls);
  renderedView = activeView;
  if (['mediapipe', 'records'].includes(activeView)) romWorkspace = mountRomWorkspace(app.querySelector("[data-rom-root]"), romContext);
  if (['trends', 'records'].includes(activeView)) trendWorkspace = mountTrendWorkspace(app.querySelector("[data-trends-root]"), () => state, trendContext);
}

function applySafeTextOverrides() {
  // Real connection/measurement status must not be replaced by a saved static
  // editor caption (e.g. "stream normal" while both feet are disconnected).
  const dynamicSelector = '.clarity-live-hero h2, .clarity-live-hero p, .clarity-status-main h2, .clarity-status-main p, [data-live-copy]';
  const dynamicText = esp32Enabled ? [...app.querySelectorAll(dynamicSelector)].map((el) => [el, el.textContent]) : [];
  applyDirectTextOverrides(app, activeView, sharedDirectTextOverrides);
  for (const [el, text] of dynamicText) el.textContent = text;
}

function showToast(message) {
  toastMessage = message;
  window.clearTimeout(toastTimer);
  const region = document.querySelector(".toast-region");
  if (region) region.innerHTML = `<div class="toast">${escapeHtml(message)}</div>`;
  toastTimer = window.setTimeout(() => {
    toastMessage = '';
    const currentRegion = document.querySelector('.toast-region');
    if (currentRegion) currentRegion.innerHTML = '';
  }, 2600);
}

async function refreshSharedEditorState() {
  try {
    const response = await fetch(`/api/editor-state?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const sharedState = await response.json();
    const nextOverrides = sharedState?.directText && typeof sharedState.directText === "object"
      ? sharedState.directText
      : sharedState?.sensorLayout ? {}
        : sharedState;
    const nextSensorLayout = sharedState?.sensorLayout ? normalizeSensorLayout(sharedState.sensorLayout) : sharedSensorLayout;
    const nextFootLayout = sharedState?.footLayout ? normalizeFootLayout(sharedState.footLayout) : sharedFootLayout;
    const textChanged = JSON.stringify(nextOverrides ?? {}) !== JSON.stringify(sharedDirectTextOverrides);
    const sensorChanged = JSON.stringify(nextSensorLayout) !== JSON.stringify(sharedSensorLayout);
    const footChanged = JSON.stringify(nextFootLayout) !== JSON.stringify(sharedFootLayout);
    if (!textChanged && !sensorChanged && !footChanged) return;
    sharedDirectTextOverrides = nextOverrides && typeof nextOverrides === "object" ? nextOverrides : {};
    sharedSensorLayout = nextSensorLayout;
    sharedFootLayout = nextFootLayout;
    if (!isEditorMode && !showOnboarding) {
      if (sensorChanged || footChanged) renderView();
      else applySafeTextOverrides();
    }
  } catch {
    // The dashboard remains usable when the optional local sync endpoint is unavailable.
  }
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function loadRehabLog() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(rehabLogStorageKey) ?? "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

function saveRehabLog(log) {
  try { window.localStorage.setItem(rehabLogStorageKey, JSON.stringify(log)); } catch { /* local storage is optional */ }
}

function emptyDailyRehabLog() {
  return { steps: 0, loadLimitExceeded: 0, asymmetry: 0, footDrag: 0, heelLanding: 0, propulsion: 0, lateralBias: 0, copInstability: 0, fatigue: 0, feedbackCount: 0, lastFeedback: null };
}

const rehabLogKeys = { overload: "loadLimitExceeded", asymmetry: "asymmetry", foot_drag: "footDrag", heel_landing: "heelLanding", propulsion: "propulsion", lateral_bias: "lateralBias", cop_instability: "copInstability", fatigue: "fatigue" };

function updateRehabLog(log, result) {
  const key = localDateKey();
  const current = { ...emptyDailyRehabLog(), ...(log?.[key] ?? {}) };
  current.steps = result.rehab.metrics.stepCount ?? current.steps;
  if (result.triggeredAlert && result.feedback?.code) {
    const countKey = rehabLogKeys[result.feedback.code];
    if (countKey) current[countKey] += 1;
    current.feedbackCount += 1;
    current.lastFeedback = result.feedback.title;
  }
  const next = { ...(log ?? {}), [key]: current };
  saveRehabLog(next);
  return next;
}

function syncEsp32Output(key, enabled) {
  if (!esp32Enabled) return;
  const side = state.rehab?.config?.activeFoot ?? 'left';
  const request = key === "laser" ? setLaser(enabled, side) : key === "vibration" && enabled ? vibrate(47, side) : key === "auto" ? setFogCue(enabled) : null;
  if (request) void request.catch(() => showToast("선택한 발의 연결과 출력 설정을 확인하세요."));
}

function applyRehabAnalysis(nextState) {
  const result = analyzeRehabFrame({ state: nextState, history: rehabHistory, now: Date.now() });
  rehabHistory = result.history;
  const liveMetrics = nextState.dataSource === "esp32"
    ? { ...nextState.metrics, steps: result.rehab.metrics.stepCount }
    : nextState.metrics;
  const stateWithRehab = { ...nextState, metrics: liveMetrics, rehab: result.rehab, rehabLog: updateRehabLog(nextState.rehabLog, result) };
  if (result.triggeredAlert && esp32Enabled && !aiEnabled && !usesBilateralSta() && stateWithRehab.outputs?.vibration && result.feedback?.vibrationCount) {
    void vibrate(47, result.feedback?.side ?? stateWithRehab.rehab?.config?.activeFoot ?? 'left').catch(() => showToast("진동 출력 연결을 확인하세요."));
  }
  return stateWithRehab;
}

async function handleAction(action, actionTarget) {
  if (action === 'fog-cue-stop' || action === 'fog-cue-enable') {
    try {
      state = { ...state, ai: normalizeAiState(await setFogCue(action === 'fog-cue-enable'), state.ai) };
      showToast(action === 'fog-cue-stop' ? '자동 출력을 중지했어요. 연결이 끊겨도 마지막 명령 후 최대 1.5초 안에 꺼져요.' : 'FoG 감지 중에는 진동과 레이저를 유지하고, 감지가 해제되면 꺼요.');
    } catch (error) { showToast(error.message); }
    renderView(); return;
  }
  if (action === 'connect-sta') { window.location.href = '/?view=devices&esp32=1&transport=sta&ai=1&mobile=0'; return; }
  if (action === 'ai-calibrate' || action === 'ai-calibration-cancel') {
    const side = actionTarget?.dataset.aiSide;
    try {
      const payload = await calibrateAi(side, action === 'ai-calibrate' ? 'start' : 'cancel');
      state = { ...state, ai: { ...normalizeAiState(payload, state.ai), actionError: null } };
    } catch (error) { state = { ...state, ai: { ...state.ai, actionError: error.message } }; }
    renderView();
    return;
  }
  if (action === 'forget-left' || action === 'forget-right') {
    void hubRequest('forget', { side: action.slice(7) }).then(() => refreshEsp32State(true)).catch((e) => showToast(e.message)); return;
  }
  if (romWorkspace && ["profile", "open-editor"].includes(action) && !romWorkspace.canLeave()) return;
  if (trendWorkspace && ["profile", "open-editor"].includes(action) && !trendWorkspace.canLeave()) return;
  const messages = {
    notifications: "새로운 보행 인사이트가 도착했어요.",
    profile: "프로필 설정은 다음 단계에서 연결할 예정이에요.",
    "learn-more": "StepOn의 센서와 큐잉 동작을 준비 중이에요.",
    "save-note": "오늘의 인사이트를 기록했어요.",
    download: "리포트 파일을 준비하고 있어요.",
    scan: "주변의 StepOn 기기를 찾고 있어요.",
    settings: "기기 설정 패널을 준비 중이에요.",
    refresh: esp32Enabled ? "ESP32 센서 상태를 새로 요청했어요." : "센서 상태가 최신 정보로 갱신됐어요.",
    calibrate: "개인 기준선을 다시 잡을 준비가 됐어요.",
  };
  if (action === "open-editor") {
    window.location.href = `${window.location.protocol}//${window.location.host.replace(/:\d+$/, ":8001")}/?mode=editor&screen=${encodeURIComponent(activeView)}`;
    return;
  }
  if (action === "preview-dashboard") {
    showOnboarding = false;
    activeView = "overview";
    renderView();
    showToast("프로필 입력 전 미리보기 화면을 열었어요.");
    return;
  }
  if (action === "toggle-pause") state = { ...state, paused: !state.paused };
  if (action === "refresh" && esp32Enabled) void refreshEsp32State(true);
  if (action === "rehab-calibrate") {
    const calibration = captureRehabCalibration(state);
    rehabHistory = {};
    state = applyRehabAnalysis({ ...state, rehab: { ...state.rehab, calibration, status: calibration.status } });
    showToast(calibration.status === "ready" ? "현재 센서값을 개인 기준선으로 저장했어요." : "센서값이 없어 기준선을 저장하지 못했어요.");
  }
  if (action === "rehab-reset") {
    rehabHistory = {};
    state = applyRehabAnalysis({ ...state, rehab: createDefaultRehabState(state.dataSource === "esp32") });
    showToast("재활 기준선을 초기화했어요.");
  }
  if (action === "profile") {
    showOnboarding = true;
    renderView();
    return;
  }
  if (action === "test-laser" || action === "test-vibration" || action === "test-voice") {
    const key = action.replace("test-", "");
    const message = cueMessages[key];
    if (key === "voice") {
      showToast(speakCue(message) ? "음성 안내를 재생했어요." : "이 브라우저는 음성 안내를 지원하지 않아요.");
    } else {
      if (outputTestInFlight) { showToast('현재 출력 테스트가 끝난 뒤 다시 눌러 주세요.'); return; }
      const side = state.rehab?.config?.activeFoot ?? 'left';
      outputTestInFlight = true;
      try {
        await runOutputTest({ kind: key, side, enabled: esp32Enabled, laser: setLaser, vibration: vibrate, notify: showToast });
      } catch (error) { showToast(outputTestError(error, side)); }
      finally { outputTestInFlight = false; }
    }
  }
  if (action === "test-all") {
    showToast("레이저·진동·음성 안내 테스트를 실행했어요.");
    if (state.outputs.voice) speakCue("안내 테스트입니다. 레이저 기준점을 따라 천천히 발을 내딛어 주세요.");
  }
  if (messages[action]) showToast(messages[action]);
  renderView();
}

function bindAppEvents() {
app.addEventListener("click", (event) => {
  const heatmapTarget = event.target.closest("[data-heatmap-mode]");
  if (heatmapTarget) {
    state = { ...state, heatmapMode: heatmapTarget.dataset.heatmapMode };
    renderView();
    return;
  }
  const viewTarget = event.target.closest("[data-view]");
  if (viewTarget) {
    if (!validViews.has(viewTarget.dataset.view)) return;
    if (viewTarget.dataset.view !== activeView && romWorkspace && !romWorkspace.canLeave()) return;
    if (viewTarget.dataset.view !== activeView && trendWorkspace && !trendWorkspace.canLeave()) return;
    activeView = viewTarget.dataset.view;
    {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("view", activeView);
      if (isMobilePath) nextUrl.pathname = "/mobile";
      else if (isMobileUi) nextUrl.searchParams.set("mobile", "1");
      window.history.replaceState({}, "", nextUrl);
    }
    renderView();
    const section = viewTarget.dataset.recordSection;
    if (activeView === 'records' && ['walking', 'joint'].includes(section)) app.querySelector(`#${section}-records`)?.scrollIntoView({ block: 'start' });
    return;
  }
  const actionTarget = event.target.closest("[data-action]");
  if (actionTarget) void handleAction(actionTarget.dataset.action, actionTarget);
  const outputTarget = event.target.closest("[data-output]");
  if (outputTarget && outputTarget.tagName === "BUTTON") {
    const key = outputTarget.dataset.output;
    state = { ...state, outputs: { ...state.outputs, [key]: !state.outputs[key] } };
    syncEsp32Output(key, state.outputs[key]);
    renderView();
  }
});

app.addEventListener("submit", (event) => {
  if (event.target.matches('[data-insole-form]')) {
    event.preventDefault();
    const form = event.target, input = form.elements.namedItem('url');
    const side = form.dataset.insoleForm, url = input.value.trim();
    void hubRequest('config', { side, url })
      .then(() => {
        // A completed submission must not erase another address typed meanwhile.
        const currentForm = app.querySelector(`[data-insole-form="${side}"]`);
        const currentInput = currentForm?.elements.namedItem('url');
        if (currentInput?.value.trim() === url) {
          currentInput.defaultValue = currentInput.value;
          if (currentForm.contains(document.activeElement)) document.activeElement.blur();
        }
        showToast('주소를 등록했어요. 펌웨어의 좌우 구분을 확인 중입니다.');
        return refreshEsp32State(true);
      })
      .catch((error) => showToast(`등록 실패: ${error.message}`));
    return;
  }
  if (event.target.id !== "profile-form") return;
  event.preventDefault();
  const formData = new FormData(event.target);
  const goals = formData.getAll("goals");
  const preferredCues = formData.getAll("cues");
  const safeGoals = goals.length ? goals : ["daily"];
  const mode = observationGoals.find((goal) => goal.id === safeGoals[0])?.label ?? "일상 보행 기록";
  const profile = {
    ...state.profile,
    name: String(formData.get("name") ?? "사용자").trim() || "사용자",
    age: Number(formData.get("age") ?? 0),
    gender: String(formData.get("gender") ?? "none"),
    goals: safeGoals,
    preferredCues,
    mode,
    configured: true,
    outputs: { auto: true, laser: preferredCues.includes("laser"), vibration: preferredCues.includes("vibration"), voice: preferredCues.includes("voice") },
  };
  state = { ...state, profile, outputs: { ...state.outputs, ...profile.outputs } };
  try { window.localStorage.setItem(profileStorageKey, JSON.stringify({ ...profile, outputs: state.outputs })); } catch { /* local storage is optional */ }
  showOnboarding = false;
  activeView = "overview";
  renderView();
  showToast(`${profile.name}님에게 맞춘 화면을 준비했어요.`);
});

app.addEventListener("change", (event) => {
  const rehabTarget = event.target.closest("[data-rehab-setting]");
  if (rehabTarget) {
    const key = rehabTarget.dataset.rehabSetting;
    const value = rehabTarget.type === "number" || rehabTarget.type === "range" ? Number(rehabTarget.value) : rehabTarget.value;
    state = { ...state, rehab: { ...state.rehab, config: { ...state.rehab.config, [key]: value } } };
    renderView(true);
    showToast("재활 설정을 저장했어요.");
    return;
  }
  const personalTarget = event.target.closest("[data-personal-setting]");
  if (personalTarget) {
    const key = personalTarget.dataset.personalSetting;
    const value = personalTarget.type === "checkbox" ? personalTarget.checked : personalTarget.value;
    saveMediaPipeSetting(key, value);
    if (activeView === "mediapipe") renderView();
    showToast("개인화 설정을 저장했어요.");
    return;
  }
  const outputTarget = event.target.closest("[data-output]");
  if (outputTarget) {
    const key = outputTarget.dataset.output;
    state = { ...state, outputs: { ...state.outputs, [key]: event.target.checked } };
    syncEsp32Output(key, state.outputs[key]);
    renderView();
  }
});
}

async function refreshEsp32State(force = false) {
  if (!esp32Enabled || showOnboarding || esp32RequestInFlight || (state.paused && !force)) return;
  esp32RequestInFlight = true;
  try {
    const payload = await fetchEsp32State();
    const sensorFrameChanged = payload.frame !== undefined && payload.frame !== state.hardware?.raw?.frame;
    const nextState = normalizeEsp32State(payload, state);
    if (payload.service === 'stepon-bilateral-v1') {
      const topology = (feet) => ['left', 'right'].map((s) => `${feet?.[s]?.connected}:${feet?.[s]?.state?.boot_id ?? ''}:${feet?.[s]?.device_id ?? ''}`).join('|');
      const topologyChanged = topology(state.hardware?.feet) !== topology(payload.feet);
      if (topologyChanged) rehabHistory = {};
      const side = nextState.rehab?.config?.activeFoot ?? 'left';
      const prior = state.hardware?.feet?.[side]?.state, incoming = payload.feet?.[side]?.state;
      const changed = topologyChanged || !nextState.connected || !incoming || incoming.frame !== prior?.frame || incoming.boot_id !== prior?.boot_id;
      state = changed ? applyRehabAnalysis(nextState) : nextState;
    } else state = applyRehabAnalysis(nextState);
    state.sensorReceivedAt = state.connected ? Date.now() : null;
    if (payload.service === 'stepon-bilateral-v1') {
      const foot = payload.feet?.[state.rehab?.config?.activeFoot ?? 'left'];
      state.sensorAdvancedAt = foot?.connected ? Date.now() - (foot.age_ms ?? 999999) : null;
    } else if (sensorFrameChanged) state.sensorAdvancedAt = state.sensorReceivedAt;
    esp32LastError = null;
    if (activeView === "overview" || activeView === "live" || activeView === "safety" || activeView === "devices") renderView();
  } catch (error) {
    esp32LastError = error;
    if (state.dataSource === "esp32") {
      state = markEsp32Disconnected(state, error);
      if (activeView === "overview" || activeView === "live" || activeView === "safety" || activeView === "devices") renderView();
    }
  } finally {
    esp32RequestInFlight = false;
  }
}

async function refreshAiState(force = false) {
  if (!aiEnabled || showOnboarding || aiRequestInFlight || (state.paused && !force)) return;
  aiRequestInFlight = true;
  try {
    const payload = await fetchAiState();
    const nextAi = normalizeAiState(payload, state.ai);
    const decisionChanged = nextAi.ready && nextAi.state && nextAi.state !== state.ai?.state;
    // Automatic physical outputs are owned by the PC live AI cue worker.
    const nextEvents = decisionChanged
      ? [{
        time: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
        title: nextAi.state === "confirmed" ? "AI가 보행동결 신호를 감지했어요" : nextAi.state === "warning" ? "AI가 보행 변화를 관찰하고 있어요" : "AI 보행 상태가 안정됐어요",
        detail: nextAi.score === null ? "앙상블 모델 상태 변화" : `FOG SCORE ${Math.round(nextAi.score * 100)} · ${nextAi.model}`,
        tone: nextAi.state === "normal" ? "mint" : "coral",
        icon: nextAi.state === "normal" ? "check" : "cue",
      }, ...(state.events ?? [])].slice(0, 3)
      : state.events;
    state = { ...state, ai: nextAi, events: nextEvents };
    if (activeView === "overview" || activeView === "live" || activeView === "safety" || activeView === "devices") renderView();
  } catch (error) {
    const nextAi = markAiUnavailable(state.ai, error);
    if (JSON.stringify(nextAi) !== JSON.stringify(state.ai)) {
      state = { ...state, ai: nextAi };
      if (activeView === "overview" || activeView === "live" || activeView === "safety" || activeView === "devices") renderView();
    }
  } finally { aiRequestInFlight = false; }
}

if (isEditorMode) {
  mountEditor(app, state);
} else {
  bindAppEvents();
  void refreshSharedEditorState();
  window.setInterval(refreshSharedEditorState, 1200);
  void refreshEsp32State();
  window.setInterval(refreshEsp32State, usesBilateralSta() ? 250 : 750);
  void refreshAiState();
  window.setInterval(refreshAiState, 750);
  window.setInterval(() => {
    if (!esp32Enabled && !showOnboarding && !state.paused) {
      state = applyRehabAnalysis(evolveState(state));
      if (activeView === "overview" || activeView === "live") renderView();
    }
  }, 5000);
  if (!esp32Enabled) state = applyRehabAnalysis(state);
  renderView();
}
