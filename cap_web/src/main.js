import { renderSidebar } from "./components/sidebar.js";
import { renderTopbar } from './components/topbar.js';
import { initialState, evolveState } from "./data/dashboard-data.js";
import { analyzeRehabFrame, captureRehabCalibration, createDefaultRehabState } from "./data/gait-algorithms.js";
import { renderLiveView } from "./views/live-view.js";
import { renderSafetyView } from "./views/safety-view.js";
import { renderReportsView } from "./views/reports-view.js";
import { renderDevicesView } from "./views/devices-view.js";
import { renderOnboarding } from "./views/onboarding-view.js";
import { cueMessages, speakCue, runOutputTest, outputTestError } from "./services/cue-controller.js";
import { profileFromForm } from './data/profile.js';
import { escapeHtml } from "./utils/text.js";
import { applyDirectTextOverrides, mountEditor } from "./editor/editor-view.js";
import { saveMediaPipeSetting } from "./views/mediapipe-view.js";
import { loadSensorLayout, normalizeSensorLayout } from "./data/sensor-layout.js";
import { loadFootLayout, normalizeFootLayout } from "./data/foot-layout.js";
import { renderMobileApp, renderMobileOnboarding } from "./mobile/mobile-app.js";
import { fetchEsp32State, markEsp32Disconnected, normalizeEsp32State } from "./services/esp32-api.js";
import { setLaser, vibrate, usesBilateralSta, hubRequest } from "./services/esp32-api.js";
import { fetchAiState, markAiUnavailable, normalizeAiState, calibrateAi, setFogCue, setFogDetection } from "./services/ai-api.js";
import { createFogNotifications } from './services/fog-notifications.js';
import { renderFogPopup } from './components/fog-control.js';
import { mountRomWorkspace } from "./mediapipe/rom-controller.js";
import { renderTrendsView } from "./views/trends-view.js";
import { renderRecordsView } from './views/records-view.js';
import { mountTrendWorkspace } from "./trends/trend-controller.js";
import { emptyPressure } from "./data/sensor-config.js";
import { captureViewContinuity, restoreViewContinuity } from "./utils/view-continuity.js";
import { captureInsoleControls, restoreInsoleControls, isEditingInsole } from "./utils/insole-ui.js";
import { updateInsoleReadings } from "./components/insole-connection.js";
import { createInteractionGuard } from './utils/interaction-guard.js';
import { updateAppShell, syncLiveNode } from './utils/app-shell.js';
import { createObservationMonitor } from './data/observation-monitor.js';
import { createAnkleMonitor } from './mediapipe/ankle-monitor.js';
import { renderPurposeView } from './views/purpose-view.js';
import { renderFrontView } from './views/front-view.js';
import { renderAnkleDailyView } from './views/ankle-daily-view.js';
import { mountFrontCamera } from './mediapipe/front-controller.js';
import { mountDailyAnkle } from './mediapipe/daily-controller.js';

const app = document.querySelector("#app");
const profileStorageKey = "stepon-cap-web-profile";
const easyModeStorageKey = 'stepon-easy-mode';
const rehabLogStorageKey = "stepon-rehab-daily-log";
const query = new URLSearchParams(window.location.search);
const isEditorMode = window.location.port === "8001" || query.get("mode") === "editor";
const isMobilePath = window.location.pathname === "/mobile" || window.location.pathname.startsWith("/mobile/");
const isMobileUi = !isEditorMode && (isMobilePath || query.get("mobile") === "1" || (query.get("mobile") !== "0" && window.matchMedia?.("(max-width: 800px)").matches));
const esp32Enabled = !isEditorMode && !["0", "false"].includes(query.get("esp32")) && (["1", "true"].includes(query.get("esp32")) || (() => {
  try { return window.localStorage.getItem("stepon-esp32-enabled") === "true"; } catch { return false; }
})());
const aiEnabled = !isEditorMode && esp32Enabled && !['0', 'false'].includes(query.get('ai'));
const viewRenderers = { overview: renderPurposeView, easy: renderPurposeView, live: renderLiveView, ankle: renderAnkleDailyView, safety: renderSafetyView, reports: renderReportsView, devices: renderDevicesView, mediapipe: renderFrontView, trends: renderTrendsView, records: renderRecordsView };
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
let easyMode = query.get('easy') === '1' || activeView === 'easy' || (() => { try { return window.localStorage.getItem(easyModeStorageKey) === 'true'; } catch { return false; } })();
const previewDashboard = new URLSearchParams(window.location.search).get("preview") === "1";
// First use asks for basic information only; all three features stay available.
let showOnboarding = !storedProfile?.configured && !previewDashboard;
let sharedDirectTextOverrides = {};
let sharedSensorLayout = loadSensorLayout();
let sharedFootLayout = loadFootLayout();
let romWorkspace = null;
let trendWorkspace = null;
let frontWorkspace = null;
let dailyWorkspace = null;
let romContext = null;
let trendContext = null;
let esp32RequestInFlight = false;
let aiRequestInFlight = false;
let outputTestInFlight = false;
let renderedView = null;
let toastMessage = '';
let toastTimer;
let fogPopup = null;
let fogReturnFocus = null;
let detectionRevision = 0;
const fogNotifications = createFogNotifications({onAlert: () => openFogPopup()});
const toastMarkup = () => `<div class="toast-region" aria-live="polite">${toastMessage ? `<div class="toast">${escapeHtml(toastMessage)}</div>` : ''}</div>`;
const fogPopupMarkup = () => fogPopup ? renderFogPopup(fogPopup) : '';
function openFogPopup({ preview = false } = {}) {
  if (!preview && (state.fogLocalStop || state.ai?.detectionEnabled === false)) return;
  if (fogPopup && (!fogPopup.preview || preview)) return;
  if (!fogPopup) fogReturnFocus = document.activeElement;
  fogPopup = { openedAt: Date.now(), preview };
  app.querySelector('.fog-alert-overlay')?.remove();
  app.insertAdjacentHTML('beforeend', fogPopupMarkup());
  app.querySelector('[data-action=dismiss-fog-popup]')?.focus();
}
function closeFogPopup() { fogPopup=null;app.querySelector('.fog-alert-overlay')?.remove();if(fogReturnFocus?.isConnected)fogReturnFocus.focus();fogReturnFocus=null; }
function showNavigationLoading() { if (!app.querySelector('.navigation-loading')) app.insertAdjacentHTML('beforeend', '<div class="navigation-loading" role="status" aria-live="polite"><span></span><b>화면을 준비하고 있어요</b></div>'); }
const interactionGuard = createInteractionGuard(app, () => renderView());
const observationMonitor = createObservationMonitor();
const ankleMonitor = createAnkleMonitor({ storage: (() => { try { return window.sessionStorage; } catch { return null; } })() });
let observationUi = { mode: 'fog', metric: 'temperature', minutes: 5 };

function refreshObservationChrome() {
  const template = document.createElement('template');
  const viewState = { ...state, easyMode };
  template.innerHTML = isMobileUi ? renderMobileApp(viewState, activeView) : renderTopbar(viewState) + renderSidebar(activeView, viewState);
  // Keep connection/sound controls current without touching video, recording or inputs.
  const selectors = isMobileUi ? ['.simple-mobile-header', '.mobile-fog-audio', '[data-fog-control]'] : ['.topbar', '.sidebar-footer'];
  for (const selector of selectors) {
    const current = app.querySelector(selector), next = template.content.querySelector(selector);
    if (current && next) syncLiveNode(current, next);
  }
}

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
  if ((frontWorkspace || dailyWorkspace) && renderedView === activeView && !showOnboarding) { refreshObservationChrome(); return; }
  if (frontWorkspace) { frontWorkspace.destroy(); frontWorkspace = null; }
  if (dailyWorkspace) { dailyWorkspace.destroy(); dailyWorkspace = null; }
  if (romWorkspace && renderedView === activeView && ['mediapipe', 'records'].includes(activeView) && !showOnboarding) return;
  if (trendWorkspace && renderedView === activeView && ['trends', 'records'].includes(activeView) && !showOnboarding) return;
  if (romWorkspace) { romContext = romWorkspace.getContext(); romWorkspace.destroy(); romWorkspace = null; }
  if (trendWorkspace) { trendContext = trendWorkspace.getContext(); trendWorkspace.destroy(); trendWorkspace = null; }
  if (showOnboarding) {
    app.innerHTML = `${isMobileUi ? renderMobileOnboarding(state) : renderOnboarding(state)}${toastMarkup()}`;
    return;
  }
  const viewState = { ...state, aiEnabled, easyMode, ankle: ankleMonitor.snapshot(state), observation: observationMonitor.snapshot(), observationUi, sensorLayout: sharedSensorLayout, footLayout: sharedFootLayout };
  const continuity = renderedView === activeView ? captureViewContinuity(app) : null;
  const insoleControls = renderedView === activeView ? captureInsoleControls(app) : null;
  updateAppShell(app, `${isMobileUi ? renderMobileApp(viewState, activeView) : `<div class="app-frame ${easyMode ? 'is-easy-mode' : ''}">${renderSidebar(activeView, viewState)}${viewRenderers[activeView](viewState)}</div>`}${fogPopupMarkup()}${toastMarkup()}`, isMobileUi, renderedView === activeView);
  applySafeTextOverrides();
  restoreViewContinuity(app, continuity);
  restoreInsoleControls(app, insoleControls);
  renderedView = activeView;
  if (activeView === 'records') romWorkspace = mountRomWorkspace(app.querySelector("[data-rom-root]"), romContext, { getState: () => state, monitor: ankleMonitor });
  if (activeView === 'mediapipe') frontWorkspace = mountFrontCamera(app.querySelector('[data-front-root]'));
  if (activeView === 'ankle') dailyWorkspace = mountDailyAnkle(app.querySelector('[data-daily-root]'));
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
  // Only fresh confirmed AI decisions produce the FoG popup and voice.
  if (result.triggeredAlert && !state.fogLocalStop && state.ai?.detectionEnabled !== false && esp32Enabled && !aiEnabled && !usesBilateralSta() && stateWithRehab.outputs?.vibration && result.feedback?.vibrationCount) {
    void vibrate(47, result.feedback?.side ?? stateWithRehab.rehab?.config?.activeFoot ?? 'left').catch(() => showToast("진동 출력 연결을 확인하세요."));
  }
  return stateWithRehab;
}

async function handleAction(action, actionTarget) {
  if (action === 'dismiss-fog-popup') { closeFogPopup(); return; }
  if (action === 'mobile-fog-sound') {
    if (fogNotifications.soundEnabled) { await fogNotifications.deactivate(); state={...state,fogSoundEnabled:false};showToast('소리·음성 알림을 껐어요.'); }
    else { const result=await fogNotifications.activate();state={...state,fogSoundEnabled:result.ok};openFogPopup({preview:true});showToast(result.ok ? result.voice ? '테스트 음성을 확인하세요. 들리지 않으면 기기 미디어 음량을 높여 주세요.' : '알림음만 사용할 수 있어요. 한국어 음성 지원을 확인하세요.' : '브라우저의 소리 재생 권한과 미디어 음량을 확인하세요.'); }
    renderView();refreshObservationChrome();return;
  }
  if (action === 'fog-detection-toggle') {
    if(state.fogControlPending)return;
    const enabled=Boolean(!state.fogControlError && state.ai?.available && (state.fogLocalStop || state.ai?.detectionEnabled===false));
    detectionRevision++;
    state={...state,fogControlPending:true,fogLocalStop:true,fogControlError:null};
    fogNotifications.silence();closeFogPopup();observationMonitor.interrupt();
    refreshObservationChrome();
    try {
      const payload=await setFogDetection(Boolean(enabled));
      if(payload.detection?.enabled!==Boolean(enabled))throw Error('AI 서버를 최신 버전으로 재시작해 주세요.');
      state={...state,ai:normalizeAiState(payload,state.ai),fogLocalStop:false,fogControlError:null};
      showToast(enabled?'FoG 감지를 재개했어요. 새 분석 창을 수집합니다.':'FoG 감지와 알림을 중지했어요. 자동 출력은 마지막 명령 후 최대 1.5초 안에 꺼져요.');
    } catch(error) {state={...state,fogLocalStop:true,fogControlError:'PC 상태를 확인하고 중지를 다시 요청하세요.'};showToast(`이 화면의 알림은 중지했지만 PC 상태를 확인하지 못했어요. ${error.message}`);}
    finally{state={...state,fogControlPending:false};renderView();refreshObservationChrome();}
    return;
  }
  if (action === 'exit-easy-mode') {
    easyMode = false;
    try { window.localStorage.removeItem(easyModeStorageKey); } catch { /* optional preference */ }
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete('easy');
    if (activeView === 'easy') { activeView = 'overview'; nextUrl.searchParams.set('view', activeView); }
    window.history.replaceState({}, '', nextUrl);
    renderView(true);
    return;
  }
  if (action === 'fog-cue-stop' || action === 'fog-cue-enable') {
    try {
      state = { ...state, ai: normalizeAiState(await setFogCue(action === 'fog-cue-enable'), state.ai) };
      showToast(action === 'fog-cue-stop' ? '자동 출력을 중지했어요. 연결이 끊겨도 마지막 명령 후 최대 1.5초 안에 꺼져요.' : 'FoG 감지 중에는 진동과 레이저를 유지하고, 감지가 해제되면 꺼요.');
    } catch (error) { showToast(error.message); }
    renderView(); return;
  }
  if (action === 'connect-sta') { window.location.href = '/?view=devices&esp32=1&transport=sta&ai=1&mobile=0'; return; }
  if (action === 'connect-live-mode') { const url = new URL(window.location.href); url.searchParams.set('esp32','1'); url.searchParams.set('transport','sta'); url.searchParams.set('ai','1'); try { localStorage.setItem('stepon-esp32-enabled','true'); } catch {} window.location.href=url.href; return; }
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
  if (frontWorkspace && ["profile", "open-editor"].includes(action) && !frontWorkspace.canLeave()) return;
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
    const url = new URL(window.location.href); url.searchParams.set('view', 'overview');
    window.history.replaceState({}, '', url);
    renderView();
    window.scrollTo({top:0,behavior:'instant'});
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
  const observationTarget = event.target.closest('[data-observation-control]');
  if (observationTarget) {
    const key = observationTarget.dataset.observationControl, value = observationTarget.dataset.value;
    const allowed = { mode: ['fog', 'health'], metric: ['temperature', 'humidity', 'pressure'], minutes: ['5', '15', '30'] };
    if (allowed[key]?.includes(value)) { observationUi = { ...observationUi, [key]: value }; renderView(); }
    return;
  }
  const heatmapTarget = event.target.closest("[data-heatmap-mode]");
  if (heatmapTarget) {
    state = { ...state, heatmapMode: heatmapTarget.dataset.heatmapMode };
    renderView();
    return;
  }
  const viewTarget = event.target.closest("[data-view]");
  if (viewTarget) {
    if (!validViews.has(viewTarget.dataset.view)) return;
    const changingView = viewTarget.dataset.view !== activeView;
    if (changingView && frontWorkspace && !frontWorkspace.canLeave()) return;
    if (viewTarget.dataset.view !== activeView && romWorkspace && !romWorkspace.canLeave()) return;
    if (viewTarget.dataset.view !== activeView && trendWorkspace && !trendWorkspace.canLeave()) return;
    const navigate = () => {
      if (viewTarget.dataset.easyExit === 'true') {
        easyMode = false;
        try { window.localStorage.removeItem(easyModeStorageKey); } catch { /* optional preference */ }
      }
      activeView = viewTarget.dataset.view;
      if (activeView === 'easy') { easyMode = true; try { window.localStorage.setItem(easyModeStorageKey, 'true'); } catch { /* optional preference */ } }
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("view", activeView);
      if (easyMode) nextUrl.searchParams.set('easy', '1'); else nextUrl.searchParams.delete('easy');
      if (isMobilePath) nextUrl.pathname = "/mobile"; else if (isMobileUi) nextUrl.searchParams.set("mobile", "1");
      window.history.replaceState({}, "", nextUrl);
      renderView();
      app.querySelector('.navigation-loading')?.remove();
      const section = viewTarget.dataset.recordSection;
      if (activeView === 'records' && ['walking', 'joint'].includes(section)) app.querySelector(`#${section}-records`)?.scrollIntoView({ block: 'start' });
      else if (changingView) { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); const heading = app.querySelector('main h1'); heading?.setAttribute('tabindex', '-1'); heading?.focus({ preventScroll: true }); }
    };
    if (changingView) {
      // Fast screen changes should feel instant. Only show feedback if a future
      // transition actually takes longer than a brief moment.
      const loadingDelay = window.setTimeout(showNavigationLoading, 450);
      navigate();
      window.clearTimeout(loadingDelay);
    } else navigate();
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
  let profile;
  try { profile = profileFromForm(formData, state.profile, state.outputs); }
  catch (error) { const notice=event.target.querySelector('[data-profile-error]'); if(notice)notice.textContent=error.message; return; }
  state = { ...state, profile };
  try { window.localStorage.setItem(profileStorageKey, JSON.stringify({ ...profile, outputs: state.outputs })); } catch { /* local storage is optional */ }
  showOnboarding = false;
  activeView = "overview";
  const url = new URL(window.location.href); url.searchParams.set('view', 'overview'); url.searchParams.delete('preview');
  window.history.replaceState({}, '', url);
  renderView();
  window.scrollTo({top:0,behavior:'instant'});
  showToast(`${profile.name}님, 세 가지 기능을 모두 사용할 수 있어요.`);
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
    if (activeView === "easy" || activeView === "overview" || activeView === "live" || activeView === "safety" || activeView === "devices") renderView();
  } catch (error) {
    esp32LastError = error;
    if (state.dataSource === "esp32") {
      state = markEsp32Disconnected(state, error);
      if (activeView === "easy" || activeView === "overview" || activeView === "live" || activeView === "safety" || activeView === "devices") renderView();
    }
  } finally {
    esp32RequestInFlight = false;
  }
}

async function refreshAiState(force = false) {
  if (showOnboarding || aiRequestInFlight || state.fogControlPending) return;
  aiRequestInFlight = true;
  const revision = detectionRevision;
  try {
    const payload = await fetchAiState();
    if(revision!==detectionRevision)return;
    const nextAi = normalizeAiState(payload, state.ai);
    const stoppedNow = nextAi.detectionEnabled === false && state.ai?.detectionEnabled !== false;
    const decisionChanged = aiEnabled && !state.fogLocalStop && nextAi.ready && nextAi.state && nextAi.state !== state.ai?.state;
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
    if(nextAi.detectionEnabled===false) {
      state={...state,fogLocalStop:false,fogControlError:null};
      if(stoppedNow) { fogNotifications.silence(); if(!fogPopup?.preview)closeFogPopup(); }
    }
    fogNotifications.observe({...state,aiEnabled},{foreground:!document.hidden});
    refreshObservationChrome();
    if (!document.hidden) observationMonitor.observeAi({ ...state, aiEnabled });
    if (activeView === "easy" || activeView === "overview" || activeView === "live" || activeView === "safety" || activeView === "devices") renderView();
  } catch (error) {
    if(revision!==detectionRevision)return;
    const nextAi = markAiUnavailable(state.ai, error);
    observationMonitor.interrupt();
    if (JSON.stringify(nextAi) !== JSON.stringify(state.ai)) {
      state = { ...state, ai: nextAi };
      fogNotifications.silence();
      refreshObservationChrome();
      if (activeView === "easy" || activeView === "overview" || activeView === "live" || activeView === "safety" || activeView === "devices") renderView();
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
  // Short, in-memory observation only. Background time, pauses and stale data
  // must never be counted as symptom-free time or a continuing FoG episode.
  document.addEventListener('visibilitychange', () => {observationMonitor.interrupt();if(document.hidden)fogNotifications.silence();});
  document.addEventListener('keydown',event=>{
    if(!fogPopup)return;
    if(event.key==='Escape'){event.preventDefault();closeFogPopup();return;}
    if(event.key==='Tab'){const buttons=[...app.querySelectorAll('.fog-alert-overlay button:not(:disabled)')];if(!buttons.length)return;const i=buttons.indexOf(document.activeElement);event.preventDefault();buttons[(i+(event.shiftKey?-1:1)+buttons.length)%buttons.length].focus();}
  });
  window.setInterval(() => {
    if (document.hidden || showOnboarding) { observationMonitor.interrupt(); return; }
    observationMonitor.observeAi({ ...state, aiEnabled });
    observationMonitor.observeSensors(state);
    if (activeView === 'live') renderView();
  }, 1000);
  window.setInterval(() => {
    if (!esp32Enabled && !showOnboarding && !state.paused) {
      state = applyRehabAnalysis(evolveState(state));
      if (activeView === "easy" || activeView === "overview" || activeView === "live") renderView();
    }
  }, 5000);
  if (!esp32Enabled) state = applyRehabAnalysis(state);
  renderView();
}
