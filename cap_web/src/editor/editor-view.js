import { icon } from "../components/icons.js";
import { PRESSURE_POINTS, PRESSURE_SITES, PRESSURE_CHANNELS, THERMAL_SITES, THERMAL_CHANNELS } from '../data/sensor-config.js';
import { renderSidebar } from "../components/sidebar.js";
import { escapeHtml } from "../utils/text.js";
import { renderOverview } from "../views/overview-view.js";
import { renderLiveView } from "../views/live-view.js";
import { renderSafetyView } from "../views/safety-view.js";
import { renderReportsView } from "../views/reports-view.js";
import { renderDevicesView } from "../views/devices-view.js";
import { renderMediaPipeView } from "../views/mediapipe-view.js";
import { renderTrendsView } from "../views/trends-view.js";
import { loadSensorLayout, normalizeSensorLayout, persistSensorLayout } from "../data/sensor-layout.js";
import { FOOT_LAYOUT_MODES, loadFootLayout, normalizeFootLayout, persistFootLayout } from "../data/foot-layout.js";

const STORAGE_KEY = "stepon-cap-web-editor-layout";
const LAYOUTS_STORAGE_KEY = "stepon-cap-web-editor-layouts-v2";
const DIRECT_TEXT_STORAGE_KEY = "stepon-cap-web-editor-direct-text-v1";
const GRID_COLUMNS = 12;
const DEFAULT_KICKERS = { hero: "TODAY'S GAIT STATUS", pressure: "PRESSURE INSIGHT", chart: "WEEKLY RHYTHM", sensor: "SENSOR HEALTH", notice: "TODAY'S INSIGHT", text: "CUSTOM BLOCK" };

const SCREEN_DEFS = [
  { id: "overview", label: "오늘 요약", short: "Today", description: "처음 들어왔을 때 보는 핵심 상태" },
  { id: "live", label: "실시간 측정", short: "Live", description: "센서 흐름과 현재 신호" },
  { id: "safety", label: "분석 센터", short: "Analysis", description: "FoG·압력·온습도 판단 근거" },
  { id: "reports", label: "보행 리포트", short: "Reports", description: "일간·주간 보행 기록" },
  { id: "trends", label: "변화 추이", short: "Trends", description: "같은 조건의 개인 기록과 날짜별 비교" },
  { id: "devices", label: "기기 관리", short: "Devices", description: "ESP32와 센서 연결 상태" },
  { id: "mediapipe", label: "관절 움직임", short: "MediaPipe", description: "웹캠 각도 기록과 개인 기준 비교" },
];

const COMPONENT_CATALOG = [
  { type: "hero", label: "상태 히어로", description: "오늘 보행 상태", icon: "activity", width: 8, height: 4, tone: "ink" },
  { type: "metric", label: "측정 카드", description: "걸음·균형·온도", icon: "activity", width: 3, height: 2, tone: "mint" },
  { type: "pressure", label: "압력 맵", description: "FSR406 4채널", icon: "shoe", width: 6, height: 5, tone: "mint" },
  { type: "chart", label: "활동 차트", description: "보행 리듬 추이", icon: "chart", width: 6, height: 4, tone: "coral" },
  { type: "sensor", label: "센서 상태", description: "연결·배터리 상태", icon: "check", width: 5, height: 4, tone: "sky" },
  { type: "notice", label: "알림 배너", description: "사용자 안내 문구", icon: "cue", width: 8, height: 2, tone: "coral" },
  { type: "text", label: "텍스트 블록", description: "자유 안내 문구", icon: "arrow", width: 4, height: 2, tone: "plain" },
  { type: "image", label: "참고 이미지", description: "내 이미지 등록", icon: "image", width: 6, height: 5, tone: "plain" },
];

const PREVIEW_RENDERERS = { overview: renderOverview, live: renderLiveView, safety: renderSafetyView, reports: renderReportsView, devices: renderDevicesView, mediapipe: renderMediaPipeView, trends: renderTrendsView };

// The editor preview deliberately points at the real 8000 DOM instead of a second
// design-only canvas. Each entry connects one persisted editor block to the
// corresponding block in the actual screen renderer.
const DIRECT_PREVIEW_BLOCKS = {
  trends: [
    { id: "trends-heading", selector: ".trends-heading", fields: { title: "h1", description: "p" } },
    { id: "trends-rom", selector: ".trends-rom", fields: { title: "h2" } },
    { id: "trends-sensors", selector: ".trends-sensors", fields: { title: "h2" } },
    { id: "trends-history", selector: ".trends-history", fields: { title: "h2" } },
  ],
  overview: [
    { id: "hero-1", selector: ".clarity-status-card", fields: { title: ".clarity-status-main h2", description: ".clarity-status-main p" } },
    { id: "focus-1", selector: ".overview-start-card", fields: { title: "h2" } },
    { id: "metric-steps", selector: ".metrics-grid .metric-card:nth-child(1)", fields: { title: ".metric-label", description: ".metric-foot > span:last-child" } },
    { id: "metric-balance", selector: ".metrics-grid .metric-card:nth-child(2)", fields: { title: ".metric-label", description: ".metric-foot > span:last-child" } },
    { id: "metric-temp", selector: ".metrics-grid .metric-card:nth-child(3)", fields: { title: ".metric-label", description: ".metric-foot > span:last-child" } },
    { id: "metric-humidity", selector: ".metrics-grid .metric-card:nth-child(4)", fields: { title: ".metric-label", description: ".metric-foot > span:last-child" } },
    { id: "notice-1", selector: ".clarity-events-card", fields: { kicker: ".panel-kicker", title: ".panel-heading h2" } },
    { id: "sensor-1", selector: ".overview-details", fields: { title: "summary b", description: "summary small" } },
  ],
  live: [
    { id: "hero-1", selector: ".clarity-live-hero", fields: { title: "h2", description: "p" } },
    { id: "focus-1", selector: ".clarity-live-values", fields: {} },
    { id: "pressure-1", selector: ".clarity-heatmap-card .bilateral-heatmap-panel", fields: { kicker: ".panel-kicker", title: ".heatmap-heading h2", description: ".panel-description" } },
    { id: "sensor-1", selector: ".clarity-health-card", fields: { kicker: ".panel-kicker", title: ".panel-heading h2" } },
    { id: "chart-1", selector: ".clarity-signal-note", fields: { title: "b", description: "p" } },
    { id: "notice-1", selector: ".clarity-live-hero", fields: {} },
  ],
  safety: [
    { id: "hero-1", selector: ".safety-notice", fields: { title: "b" } },
    { id: "pressure-1", selector: ".thermal-algorithm", fields: { kicker: ".panel-kicker", title: ".panel-heading h2", description: ".panel-description" } },
    { id: "chart-1", selector: ".fog-algorithm", fields: { kicker: ".panel-kicker", title: ".panel-heading h2", description: ".panel-description" } },
    { id: "notice-1", selector: ".cue-panel", fields: { kicker: ".panel-kicker", title: ".panel-heading h2" } },
    { id: "sensor-1", selector: ".algorithm-footer", fields: {} },
  ],
  reports: [
    { id: "hero-1", selector: ".report-summary", fields: { title: ".report-summary-main h2", description: ".report-summary-main p" } },
    { id: "pressure-1", selector: ".report-grid .report-card:nth-child(1)", fields: { kicker: ".panel-kicker", title: ".panel-heading h2" } },
    { id: "chart-1", selector: ".report-grid .report-card:nth-child(2)", fields: { kicker: ".panel-kicker", title: ".panel-heading h2" } },
    { id: "notice-1", selector: ".report-score", fields: {} },
  ],
  devices: [
    { id: "hero-1", selector: ".device-hero", fields: { title: ".device-hero h2", description: ".device-hero > div:nth-child(2) > p" } },
    { id: "pressure-1", selector: ".device-grid > .panel:nth-child(1)", fields: { kicker: ".panel-kicker", title: ".panel-heading h2" } },
    { id: "notice-1", selector: ".setup-panel", fields: { kicker: ".panel-kicker", title: ".panel-heading h2" } },
  ],
  mediapipe: [
    { id: "rom-heading", selector: ".rom-heading", fields: { kicker: ".rom-eyebrow", title: "h1", description: "p" } },
    { id: "rom-camera", selector: ".rom-camera-panel", fields: { title: ".rom-panel-head h2" } },
    { id: "rom-setup", selector: ".rom-setup-panel", fields: { title: ".rom-panel-head h2" } },
    { id: "rom-validation", selector: ".rom-validation-panel", fields: { kicker: ".rom-eyebrow", title: "h2" } },
    { id: "rom-history", selector: ".rom-history-panel", fields: { kicker: ".rom-eyebrow", title: ".rom-panel-head h2" } },
  ],
};

// The phone surface has its own markup, but it still consumes the same text
// overrides saved by 8001. Keep this mapping separate from the editor preview
// selectors so a mobile layout can evolve without changing the desktop DOM.
const MOBILE_DIRECT_TEXT_BLOCKS = {
  overview: [
    { id: "hero-1", selector: ".mobile-status-card", fields: { title: "h2", description: "p" } },
    { id: "focus-1", selector: ".mobile-overview-next", fields: { kicker: ".mobile-card-kicker", title: ".mobile-panel-heading h2", description: "p" } },
    { id: "metric-steps", selector: ".mobile-metrics-grid .mobile-metric-card:nth-child(1)", fields: { title: ".mobile-metric-top > span", description: "p" } },
    { id: "metric-balance", selector: ".mobile-metrics-grid .mobile-metric-card:nth-child(2)", fields: { title: ".mobile-metric-top > span", description: "p" } },
    { id: "metric-temp", selector: ".mobile-metrics-grid .mobile-metric-card:nth-child(3)", fields: { title: ".mobile-metric-top > span", description: "p" } },
    { id: "metric-cadence", selector: ".mobile-metrics-grid .mobile-metric-card:nth-child(4)", fields: { title: ".mobile-metric-top > span", description: "p" } },
    { id: "pressure-1", selector: ".mobile-heatmap-card .bilateral-heatmap-panel", fields: { kicker: ".panel-kicker", title: ".heatmap-heading h2", description: ".panel-description" } },
    { id: "chart-1", selector: ".mobile-activity-card", fields: { kicker: ".mobile-card-kicker", title: ".mobile-panel-heading h2" } },
    { id: "sensor-1", selector: ".mobile-events-card", fields: { kicker: ".mobile-card-kicker", title: ".mobile-panel-heading h2" } },
  ],
  live: [
    { id: "hero-1", selector: ".mobile-stream-card", fields: { title: "h2", description: "p" } },
    { id: "pressure-1", selector: ".mobile-heatmap-card .bilateral-heatmap-panel", fields: { kicker: ".panel-kicker", title: ".heatmap-heading h2", description: ".panel-description" } },
    { id: "sensor-1", selector: ".mobile-health-list", fields: {} },
    { id: "chart-1", selector: ".mobile-pipeline", fields: { kicker: ".mobile-card-kicker", title: ".mobile-panel-heading h2" } },
  ],
  safety: [
    { id: "hero-1", selector: ".mobile-notice", fields: { title: "p" } },
    { id: "pressure-1", selector: ".mobile-thermal-card", fields: { kicker: ".mobile-card-kicker", title: ".mobile-panel-heading h2", description: "p" } },
    { id: "chart-1", selector: ".mobile-fog-card", fields: { kicker: ".mobile-card-kicker", title: ".mobile-panel-heading h2", description: "p" } },
    { id: "notice-1", selector: ".mobile-cue-card", fields: { kicker: ".mobile-card-kicker", title: ".mobile-panel-heading h2" } },
  ],
  reports: [
    { id: "hero-1", selector: ".mobile-report-summary", fields: { title: "h2", description: "p" } },
    { id: "pressure-1", selector: ".mobile-indicator-card", fields: { kicker: ".mobile-card-kicker", title: ".mobile-panel-heading h2" } },
    { id: "chart-1", selector: ".mobile-note-card", fields: { kicker: ".mobile-card-kicker", title: ".mobile-panel-heading h2" } },
  ],
  devices: [
    { id: "hero-1", selector: ".mobile-device-card", fields: { title: "h2", description: "p" } },
    { id: "pressure-1", selector: ".mobile-hardware-card", fields: { kicker: ".mobile-card-kicker", title: ".mobile-panel-heading h2" } },
    { id: "notice-1", selector: ".mobile-output-card", fields: { kicker: ".mobile-card-kicker", title: ".mobile-panel-heading h2" } },
  ],
  mediapipe: [
    { id: "rom-heading", selector: ".rom-heading", fields: { kicker: ".rom-eyebrow", title: "h1", description: "p" } },
    { id: "rom-camera", selector: ".rom-camera-panel", fields: { title: ".rom-panel-head h2" } },
    { id: "rom-setup", selector: ".rom-setup-panel", fields: { title: ".rom-panel-head h2" } },
    { id: "rom-validation", selector: ".rom-validation-panel", fields: { kicker: ".rom-eyebrow", title: "h2" } },
    { id: "rom-history", selector: ".rom-history-panel", fields: { kicker: ".rom-eyebrow", title: ".rom-panel-head h2" } },
  ],
};

const DEFAULT_LAYOUT = {
  version: 1,
  elements: [
    { id: "hero-1", type: "hero", label: "보행 상태 히어로", title: "오늘 보행 상태는 안정적입니다", description: "센서 신호와 보행 리듬을 바탕으로 안전한 걸음을 살펴보고 있어요.", value: "82", unit: "READY", x: 1, y: 1, width: 8, height: 4, tone: "ink" },
    { id: "focus-1", type: "text", label: "오늘의 관찰 목적", title: "맞춤 관찰", description: "보행 균형과 발바닥 압력을 집중해서 확인해요.", x: 9, y: 1, width: 4, height: 4, tone: "plain" },
    { id: "metric-steps", type: "metric", label: "오늘 걸음 수", title: "오늘 걸음 수", value: "3,842", unit: "steps", description: "어제보다 활발해요", x: 1, y: 6, width: 3, height: 2, tone: "coral" },
    { id: "metric-balance", type: "metric", label: "좌우 균형", title: "좌우 균형", value: "86", unit: "%", description: "좋은 균형이에요", x: 4, y: 6, width: 3, height: 2, tone: "mint" },
    { id: "metric-temp", type: "metric", label: "발바닥 온도", title: "발바닥 온도", value: "31.8", unit: "°C", description: "현재 측정값", x: 7, y: 6, width: 3, height: 2, tone: "lavender" },
    { id: "metric-cadence", type: "metric", label: "보행 리듬", title: "보행 리듬", value: "94", unit: "spm", description: "안정적인 리듬", x: 10, y: 6, width: 3, height: 2, tone: "sky" },
    { id: "pressure-1", type: "pressure", label: "양발 압력 히트맵", title: "양발 압력 히트맵", description: "같은 부위의 왼발·오른발 FSR406 입력을 비교해요.", x: 1, y: 9, width: 6, height: 5, tone: "mint" },
    { id: "chart-1", type: "chart", label: "오늘의 활동 리듬", title: "오늘의 활동 리듬", description: "시간대별 걸음 변화를 확인해요.", x: 7, y: 9, width: 6, height: 4, tone: "coral" },
    { id: "notice-1", type: "notice", label: "오늘의 작은 인사이트", title: "좌우 균형이 좋아졌어요", description: "같은 속도로 천천히 걸어보세요.", x: 1, y: 15, width: 8, height: 2, tone: "coral" },
    { id: "sensor-1", type: "sensor", label: "센서 연결 상태", title: "센서 연결 상태", description: "현재 연결된 하드웨어를 확인해요.", x: 9, y: 15, width: 4, height: 3, tone: "sky" },
  ],
};

const OVERVIEW_LAYOUT_IDS = new Set(["hero-1", "focus-1", "metric-steps", "metric-balance", "metric-temp", "metric-cadence", "notice-1", "sensor-1"]);
const OVERVIEW_LAYOUT = {
  version: 1,
  elements: DEFAULT_LAYOUT.elements.filter((element) => OVERVIEW_LAYOUT_IDS.has(element.id)).map((element) => ({
    ...element,
    ...(element.id === "hero-1" ? { label: "오늘의 보행 상태", title: "오늘 보행 상태", description: "현재 상태와 주의 점수를 간단히 보여줍니다." } : {}),
    ...(element.id === "focus-1" ? { label: "시작 안내", title: "이 순서로 시작하세요", description: "깔창 연결, 실시간 측정, 기록 비교로 안내합니다." } : {}),
    ...(element.id === "metric-cadence" ? { id: "metric-humidity", label: "깔창 평균 습도", title: "깔창 평균 습도", value: "48", unit: "%", description: "신발 안의 습한 정도" } : {}),
    ...(element.id === "notice-1" ? { label: "최근 알림", title: "최근 알림", description: "최근에 감지된 주요 신호를 보여줍니다." } : {}),
    ...(element.id === "sensor-1" ? { label: "이 화면 읽는 법", title: "이 화면 읽는 법", description: "요약·AI·핵심 수치를 순서대로 확인합니다." } : {}),
  })),
};

function defaultLayoutFor(screenId) {
  return screenId === "overview" ? OVERVIEW_LAYOUT : DEFAULT_LAYOUT;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function normalizeElement(element, index) {
  const width = clamp(Number(element.width) || 3, 2, GRID_COLUMNS);
  const height = clamp(Number(element.height) || 2, 1, 8);
  return {
    ...element,
    id: String(element.id || `element-${index + 1}`),
    type: COMPONENT_CATALOG.some((item) => item.type === element.type) ? element.type : "text",
    label: String(element.label || "새 블록"),
    kicker: String(element.kicker || DEFAULT_KICKERS[element.type] || "CUSTOM BLOCK"),
    title: String(element.title || element.label || "새 블록"),
    description: String(element.description || "원하는 설명을 입력하세요."),
    value: String(element.value || "--"),
    unit: String(element.unit || ""),
    tone: String(element.tone || "plain"),
    labelSize: clamp(Number(element.labelSize) || 8, 7, 22),
    titleSize: clamp(Number(element.titleSize) || 18, 12, 48),
    bodySize: clamp(Number(element.bodySize) || 9, 8, 22),
    valueSize: clamp(Number(element.valueSize) || 27, 16, 48),
    imageSrc: typeof element.imageSrc === "string" ? element.imageSrc : "",
    imageName: String(element.imageName || ""),
    imageFit: ["cover", "contain", "fill"].includes(element.imageFit) ? element.imageFit : "cover",
    imageRadius: clamp(Number(element.imageRadius) || 13, 0, 40),
    imageOpacity: clamp(Number(element.imageOpacity) || 0.48, 0.1, 1),
    imageLayer: element.imageLayer === "background" ? "background" : "overlay",
    showFoot: element.showFoot !== false,
    x: clamp(Number(element.x) || 1, 1, GRID_COLUMNS - width + 1),
    y: Math.max(Number(element.y) || 1, 1),
    width,
    height,
  };
}

function normalizeLayout(layout) {
  const source = layout && Array.isArray(layout.elements) ? layout : DEFAULT_LAYOUT;
  return { version: 1, elements: source.elements.map(normalizeElement) };
}

function normalizeScreenLayout(layout, screenId) {
  const normalized = normalizeLayout(layout ?? defaultLayoutFor(screenId));
  if (screenId !== 'overview') return normalized;
  // Retain saved positions and other edits; the new humidity metric must not
  // inherit a cadence caption (or its spm unit) from an older overview.
  const humidity = OVERVIEW_LAYOUT.elements.find((element) => element.id === 'metric-humidity');
  const hasHumidity = normalized.elements.some((element) => element.id === 'metric-humidity');
  if (!hasHumidity) normalized.elements = normalized.elements.map((element) => element.id === 'metric-cadence'
    ? { ...element, id: humidity.id, label: humidity.label, title: humidity.title, value: humidity.value, unit: humidity.unit, description: humidity.description }
    : element);
  return normalized;
}

function loadLayouts() {
  try {
    const savedLayouts = JSON.parse(window.localStorage.getItem(LAYOUTS_STORAGE_KEY) ?? "null");
    if (savedLayouts?.screens && typeof savedLayouts.screens === "object") {
      return { version: 2, screens: Object.fromEntries(SCREEN_DEFS.map((screen) => [screen.id, normalizeScreenLayout(savedLayouts.screens[screen.id], screen.id)])) };
    }
    const legacy = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    return { version: 2, screens: Object.fromEntries(SCREEN_DEFS.map((screen) => [screen.id, normalizeScreenLayout(screen.id === "overview" ? legacy : defaultLayoutFor(screen.id), screen.id)])) };
  } catch {
    return { version: 2, screens: Object.fromEntries(SCREEN_DEFS.map((screen) => [screen.id, clone(defaultLayoutFor(screen.id))])) };
  }
}

function persistLayouts(layouts) {
  try {
    window.localStorage.setItem(LAYOUTS_STORAGE_KEY, JSON.stringify(layouts));
  } catch {
    // The editor remains usable when browser storage is unavailable.
  }
}

function loadDirectTextOverrides() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(DIRECT_TEXT_STORAGE_KEY) ?? "null");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

let directTextSyncQueue = Promise.resolve();

function persistDirectTextOverrides(overrides, sensorLayout = loadSensorLayout(), footLayout = loadFootLayout()) {
  try {
    window.localStorage.setItem(DIRECT_TEXT_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // The editor remains usable when browser storage is unavailable.
  }
  directTextSyncQueue = directTextSyncQueue
    .catch(() => undefined)
    .then(() => fetch("/api/editor-state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ directText: overrides, sensorLayout: normalizeSensorLayout(sensorLayout), footLayout: normalizeFootLayout(footLayout) }),
    }))
    .catch(() => {
      // The editor still works per-port when the local state endpoint is unavailable.
    });
  return directTextSyncQueue;
}

function findPreviewTarget(block, selector) {
  if (!block || !selector) return null;
  return block.matches(selector) ? block : block.querySelector(selector);
}

export function applyDirectTextOverrides(root, screenId, overrides = loadDirectTextOverrides()) {
  const screenOverrides = overrides?.[screenId] ?? {};
  const definitions = root.querySelector(".mobile-app") ? MOBILE_DIRECT_TEXT_BLOCKS[screenId] : DIRECT_PREVIEW_BLOCKS[screenId];
  (definitions ?? []).forEach((definition) => {
    const block = root.querySelector(definition.selector);
    const elementOverrides = screenOverrides[definition.id] ?? {};
    Object.entries(definition.fields ?? {}).forEach(([field, selector]) => {
      if (!Object.prototype.hasOwnProperty.call(elementOverrides, field)) return;
      const target = findPreviewTarget(block, selector);
      if (target) target.textContent = String(elementOverrides[field]);
    });
  });
}

function decorateDirectPreview(root, layout, screenId, selectedId, overrides, sensorEditKind = "pressure", selectedSensorIndex = null, selectedSensorSide = null, selectedFootSide = null) {
  const preview = root.querySelector(".editor-preview-app");
  if (!preview) return;
  const labels = new Map(layout.elements.map((element) => [element.id, element.label]));
  (DIRECT_PREVIEW_BLOCKS[screenId] ?? []).forEach((definition) => {
    const block = preview.querySelector(definition.selector);
    if (!block) return;
    block.dataset.editorId = definition.id;
    block.dataset.selectElement = definition.id;
    block.tabIndex = 0;
    block.setAttribute("aria-label", `${labels.get(definition.id) ?? definition.id} 선택`);
    block.classList.add("editor-direct-target");
    block.classList.toggle("is-selected", definition.id === selectedId && selectedSensorSide === null && selectedFootSide === null);
    Object.entries(definition.fields ?? {}).forEach(([field, selector]) => {
      const target = findPreviewTarget(block, selector);
      if (!target) return;
      target.dataset.directField = field;
      target.dataset.directElementId = definition.id;
      target.contentEditable = "true";
      target.spellcheck = false;
      target.classList.add("editor-direct-text");
    });
  });
  preview.querySelectorAll("[data-sensor-kind][data-sensor-index]").forEach((sensor) => {
    sensor.classList.add("editor-sensor-target");
    sensor.classList.toggle("is-selected", sensor.dataset.sensorKind === sensorEditKind && sensor.dataset.sensorSide === selectedSensorSide && Number(sensor.dataset.sensorIndex) === selectedSensorIndex);
    sensor.setAttribute("aria-label", `${sensor.dataset.sensorSide === "left" ? "왼발" : "오른발"} ${sensor.dataset.sensorKind === "pressure" ? "압력" : "온습도"} 센서 ${Number(sensor.dataset.sensorIndex) + 1} 선택`);
  });
  preview.querySelectorAll("[data-foot-layer-side]").forEach((foot) => {
    foot.classList.toggle("is-selected", foot.dataset.footLayerSide === selectedFootSide);
    foot.setAttribute("aria-label", `${foot.dataset.footLayerSide === "left" ? "왼발" : "오른발"} 발 이미지 선택 및 이동`);
  });
  applyDirectTextOverrides(preview, screenId, overrides);
}

function getScreenDefinition(screenId) {
  return SCREEN_DEFS.find((screen) => screen.id === screenId) ?? SCREEN_DEFS[0];
}

function renderScreenNavigation(screenId) {
  return `<nav class="editor-screen-nav" aria-label="8000 메뉴별 편집 화면">${SCREEN_DEFS.map((screen) => `<button type="button" class="editor-screen-tab ${screen.id === screenId ? "is-active" : ""}" data-editor-screen="${screen.id}"><span>${escapeHtml(screen.short)}</span><small>${escapeHtml(screen.label)}</small></button>`).join("")}</nav>`;
}

function getCatalogItem(type) {
  return COMPONENT_CATALOG.find((item) => item.type === type) ?? COMPONENT_CATALOG[COMPONENT_CATALOG.length - 1];
}

function createElement(type, elements) {
  const catalogItem = getCatalogItem(type);
  const sameTypeCount = elements.filter((element) => element.type === type).length + 1;
  const lowestRow = elements.reduce((row, element) => Math.max(row, element.y + element.height), 1);
  const width = Math.min(catalogItem.width, GRID_COLUMNS);
  const isReferenceImage = type === "image";
  return normalizeElement({
    id: `${type}-${Date.now()}-${sameTypeCount}`,
    type,
    label: `${catalogItem.label} ${sameTypeCount}`,
    title: type === "metric" ? "새 측정값" : catalogItem.label,
    description: catalogItem.description,
    value: type === "metric" ? "--" : type === "hero" ? "82" : "",
    unit: type === "metric" ? "unit" : "",
    x: 1,
    y: isReferenceImage ? 9 : lowestRow + 1,
    width,
    height: catalogItem.height,
    tone: catalogItem.tone,
    imageOpacity: isReferenceImage ? 0.48 : undefined,
    imageLayer: isReferenceImage ? "overlay" : undefined,
  }, elements.length);
}

function renderEditorMiniFoot(side) {
  const dots = PRESSURE_POINTS[side].map(([left, top], index) => `<i class="editor-pressure-dot editor-pressure-${side} editor-pressure-dot-${index + 1}" style="left:${left}%;top:${top}%" aria-hidden="true"></i>`).join("");
  return `<span class="editor-mini-foot editor-mini-foot-${side}"><img src="/assets/foot-${side}-silhouette.png" alt="" draggable="false" /><span class="editor-pressure-dots">${dots}</span></span>`;
}

function renderWidget(element, selectedPart = null) {
  const label = escapeHtml(element.label);
  const kicker = escapeHtml(element.kicker);
  const title = escapeHtml(element.title);
  const description = escapeHtml(element.description);
  const value = escapeHtml(element.value);
  const unit = escapeHtml(element.unit);
  const tone = escapeHtml(element.tone);

  if (element.type === "hero") {
    return `<div class="editor-widget editor-hero-widget"><div class="editor-hero-copy"><span class="editor-widget-kicker"><span class="editor-inline-text" data-inline-field="kicker" contenteditable="true" spellcheck="false">${kicker}</span> <i>LIVE</i></span><h2 class="editor-inline-text" data-inline-field="title" contenteditable="true" spellcheck="false">${title}</h2><p class="editor-inline-text" data-inline-field="description" contenteditable="true" spellcheck="false">${description}</p></div><div class="editor-hero-orbit"><strong class="editor-inline-text" data-inline-field="value" contenteditable="true" spellcheck="false">${value}</strong><small class="editor-inline-text" data-inline-field="unit" contenteditable="true" spellcheck="false">${unit || "READY"}</small></div></div>`;
  }
  if (element.type === "metric") {
    return `<div class="editor-widget editor-metric-widget tone-${tone}"><div class="editor-widget-row"><span class="editor-widget-kicker editor-inline-text" data-inline-field="label" contenteditable="true" spellcheck="false">${label}</span><span class="editor-mini-icon">${icon("activity")}</span></div><strong><span class="editor-inline-text" data-inline-field="value" contenteditable="true" spellcheck="false">${value}</span><small class="editor-inline-text" data-inline-field="unit" contenteditable="true" spellcheck="false">${unit}</small></strong><p class="editor-inline-text" data-inline-field="description" contenteditable="true" spellcheck="false">${description}</p></div>`;
  }
  if (element.type === "pressure") {
    const footGraphic = element.showFoot ? `<span class="editor-foot ${selectedPart === "foot" ? "is-subselected" : ""}" data-sub-element="foot" data-parent-element="${escapeHtml(element.id)}" role="button" tabindex="0" aria-label="발바닥 그래픽 선택"><span class="editor-foot-pair">${renderEditorMiniFoot("left")}${renderEditorMiniFoot("right")}</span></span>` : `<div class="editor-foot-placeholder">발바닥 그래픽 숨김</div>`;
    return `<div class="editor-widget editor-pressure-widget"><div class="editor-widget-row"><div><span class="editor-widget-kicker editor-inline-text" data-inline-field="kicker" contenteditable="true" spellcheck="false">${kicker}</span><h3 class="editor-inline-text" data-inline-field="title" contenteditable="true" spellcheck="false">${title}</h3></div><span class="editor-mini-icon">${icon("shoe")}</span></div><p class="editor-inline-text" data-inline-field="description" contenteditable="true" spellcheck="false">${description}</p>${footGraphic}</div>`;
  }
  if (element.type === "chart") {
    return `<div class="editor-widget editor-chart-widget"><div class="editor-widget-row"><div><span class="editor-widget-kicker editor-inline-text" data-inline-field="kicker" contenteditable="true" spellcheck="false">${kicker}</span><h3 class="editor-inline-text" data-inline-field="title" contenteditable="true" spellcheck="false">${title}</h3></div><span class="editor-mini-icon">${icon("chart")}</span></div><p class="editor-inline-text" data-inline-field="description" contenteditable="true" spellcheck="false">${description}</p><div class="editor-bars"><i style="height:34%"></i><i style="height:54%"></i><i style="height:42%"></i><i style="height:76%"></i><i style="height:62%"></i><i style="height:88%"></i><i style="height:70%"></i><i style="height:96%"></i></div><div class="editor-axis"><span>06:00</span><span>10:00</span><span>14:00</span><span>18:00</span></div></div>`;
  }
  if (element.type === "sensor") {
    return `<div class="editor-widget editor-sensor-widget"><div class="editor-widget-row"><div><span class="editor-widget-kicker editor-inline-text" data-inline-field="kicker" contenteditable="true" spellcheck="false">${kicker}</span><h3 class="editor-inline-text" data-inline-field="title" contenteditable="true" spellcheck="false">${title}</h3></div><span class="editor-mini-icon">${icon("check")}</span></div><p class="editor-inline-text" data-inline-field="description" contenteditable="true" spellcheck="false">${description}</p><ul><li><i></i><span>FSR406 × 4</span><b>정상</b></li><li><i></i><span>SHTC3 × 4</span><b>정상</b></li><li><i></i><span>BMI270 × 1</span><b>정상</b></li></ul></div>`;
  }
  if (element.type === "notice") {
    return `<div class="editor-widget editor-notice-widget tone-${tone}"><span class="editor-notice-symbol">✦</span><div><span class="editor-widget-kicker editor-inline-text" data-inline-field="kicker" contenteditable="true" spellcheck="false">${kicker}</span><h3 class="editor-inline-text" data-inline-field="title" contenteditable="true" spellcheck="false">${title}</h3><p class="editor-inline-text" data-inline-field="description" contenteditable="true" spellcheck="false">${description}</p></div><span class="editor-notice-arrow">${icon("arrow")}</span></div>`;
  }
  if (element.type === "image") {
    const imageName = escapeHtml(element.imageName || "아직 등록된 이미지가 없습니다");
    const imageFit = escapeHtml(element.imageFit);
    const imageRadius = Number(element.imageRadius) || 13;
    const imageOpacity = Number(element.imageOpacity) || 0.48;
    return element.imageSrc
      ? `<div class="editor-widget editor-image-widget"><img src="${escapeHtml(element.imageSrc)}" alt="${escapeHtml(element.title)}" draggable="false" style="object-fit:${imageFit};border-radius:${imageRadius}px;opacity:${imageOpacity}" /><div class="editor-image-badge">참고 레이어</div><div class="editor-image-caption">${imageName}</div></div>`
      : `<div class="editor-widget editor-image-widget is-empty"><div class="editor-image-placeholder"><span>${icon("image")}</span><strong>참고 이미지를 등록하세요</strong><small>오른쪽에서 파일을 선택하면<br />이 캔버스에 바로 표시됩니다.</small></div></div>`;
  }
  return `<div class="editor-widget editor-text-widget"><span class="editor-widget-kicker editor-inline-text" data-inline-field="kicker" contenteditable="true" spellcheck="false">${kicker}</span><h3 class="editor-inline-text" data-inline-field="title" contenteditable="true" spellcheck="false">${title}</h3><p class="editor-inline-text" data-inline-field="description" contenteditable="true" spellcheck="false">${description}</p></div>`;
}

function renderElement(element, selectedId, selectedPart) {
  const selected = element.id === selectedId;
  const layer = element.type === "image" && element.imageLayer === "background" ? 0 : element.type === "image" ? 5 : 1;
  return `<article class="editor-element ${element.type === "image" ? "is-reference-image" : ""} ${selected ? "is-selected" : ""}" data-select-element="${escapeHtml(element.id)}" data-editor-id="${escapeHtml(element.id)}" style="--editor-x:${element.x};--editor-y:${element.y};--editor-w:${element.width};--editor-h:${element.height};--editor-label-size:${element.labelSize}px;--editor-title-size:${element.titleSize}px;--editor-body-size:${element.bodySize}px;--editor-value-size:${element.valueSize}px;z-index:${layer};" tabindex="0" aria-label="${escapeHtml(element.label)} 선택"><div class="editor-element-chip">${escapeHtml(element.label)} <span>${element.x},${element.y} · ${element.width}×${element.height}</span></div>${renderWidget(element, selected ? selectedPart : null)}<span class="editor-resize-hint">↘</span><span class="editor-resize-handle" data-resize="${escapeHtml(element.id)}" aria-label="${escapeHtml(element.label)} 크기 조절"></span></article>`;
}

function renderPalette() {
  return COMPONENT_CATALOG.map((item) => `<button class="palette-item" type="button" data-add-component="${item.type}"><span class="palette-icon">${icon(item.icon)}</span><span><b>${item.label}</b><small>${item.description}</small></span><em>＋</em></button>`).join("");
}

function renderInspector(selected, historyLength, futureLength, selectedPart, directMode = false, sensorLayout = null, sensorEditKind = "pressure", selectedSensorIndex = null, footLayout = null, selectedFootSide = null, footMode = "pressure", sensorEditSide = "left", selectedSensorSide = null) {
  if (!selected) {
    return `<div class="inspector-empty"><div class="inspector-empty-icon">↖</div><strong>실제 화면에서 블록을 선택하세요</strong><p>위 미리보기의 카드나 제목을 클릭하면<br />오른쪽에서 문구를 편집할 수 있어요.</p></div>`;
  }
  return `<div class="inspector-selection"><span class="editor-widget-kicker">SELECTED BLOCK</span><h2>${escapeHtml(selected.label)}</h2><span class="inspector-type">${escapeHtml(getCatalogItem(selected.type).label)}</span></div>
    <div class="inspector-form">
      <label>블록 이름<input type="text" data-editor-field="label" value="${escapeHtml(selected.label)}" /></label>
      <label>표시 제목<input type="text" data-editor-field="title" value="${escapeHtml(selected.title)}" /></label>
      <label>설명 문구<textarea data-editor-field="description" rows="3">${escapeHtml(selected.description)}</textarea></label>
      ${directMode ? `<div class="editor-direct-note"><b>실제 8000 화면에 연결됨</b><span>위치와 카드 크기는 8000의 실제 레이아웃을 그대로 사용합니다. 글씨를 화면에서 바로 눌러 수정할 수도 있어요.</span></div>` : `<div class="inspector-field-grid"><label>X<input type="number" min="1" max="12" data-editor-field="x" value="${selected.x}" /></label><label>Y<input type="number" min="1" data-editor-field="y" value="${selected.y}" /></label><label>너비<input type="number" min="2" max="12" data-editor-field="width" value="${selected.width}" /></label><label>높이<input type="number" min="1" max="8" data-editor-field="height" value="${selected.height}" /></label></div>`}
      <label>색상 톤<select data-editor-field="tone"><option value="plain" ${selected.tone === "plain" ? "selected" : ""}>기본</option><option value="ink" ${selected.tone === "ink" ? "selected" : ""}>네이비</option><option value="coral" ${selected.tone === "coral" ? "selected" : ""}>코랄</option><option value="mint" ${selected.tone === "mint" ? "selected" : ""}>민트</option><option value="lavender" ${selected.tone === "lavender" ? "selected" : ""}>라벤더</option><option value="sky" ${selected.tone === "sky" ? "selected" : ""}>스카이</option></select></label>
      ${selected.type === "image" ? `<label class="image-upload-field">참고 이미지<input type="file" accept="image/*" data-editor-image /><small>${escapeHtml(selected.imageName || "JPG, PNG, WEBP · 4MB 이하 권장")}</small></label><label>이미지 맞춤<select data-editor-field="imageFit"><option value="cover" ${selected.imageFit === "cover" ? "selected" : ""}>영역 채우기</option><option value="contain" ${selected.imageFit === "contain" ? "selected" : ""}>전체 보이기</option><option value="fill" ${selected.imageFit === "fill" ? "selected" : ""}>영역에 맞추기</option></select></label><label class="image-opacity-field">참고 투명도<div class="image-opacity-control"><input type="range" min="0.1" max="1" step="0.05" data-editor-field="imageOpacity" value="${selected.imageOpacity}" /><output>${Math.round(selected.imageOpacity * 100)}%</output></div></label><label>레이어 위치<select data-editor-field="imageLayer"><option value="overlay" ${selected.imageLayer === "overlay" ? "selected" : ""}>디자인 위에</option><option value="background" ${selected.imageLayer === "background" ? "selected" : ""}>디자인 아래</option></select></label><label>모서리<input type="number" min="0" max="40" data-editor-field="imageRadius" value="${selected.imageRadius}" /><small>px</small></label>${selected.imageSrc ? `<button class="image-remove-button" type="button" data-editor-action="remove-image">등록 이미지 제거</button>` : ""}` : ""}
      <div class="inspector-section-label">글씨 크기</div><div class="inspector-size-grid"><label>라벨<input type="number" min="7" max="22" data-editor-field="labelSize" value="${selected.labelSize}" /><small>px</small></label><label>제목<input type="number" min="12" max="48" data-editor-field="titleSize" value="${selected.titleSize}" /><small>px</small></label><label>설명<input type="number" min="8" max="22" data-editor-field="bodySize" value="${selected.bodySize}" /><small>px</small></label><label>수치<input type="number" min="16" max="48" data-editor-field="valueSize" value="${selected.valueSize}" /><small>px</small></label></div>
      ${selected.type === "pressure" && !directMode ? `<div class="sub-element-control ${selectedPart === "foot" ? "is-active" : ""}"><span class="editor-widget-kicker">PRESSURE CARD DETAIL</span><b>발바닥 그래픽</b><small>발바닥 모양을 따로 선택해 숨길 수 있습니다.</small><label class="sub-element-toggle"><input type="checkbox" data-editor-field="showFoot" ${selected.showFoot ? "checked" : ""} /> 그래픽 표시</label></div>` : ""}
      ${directMode && selected.type === "pressure" ? renderSensorPositionEditor(sensorLayout, sensorEditKind, selectedSensorIndex, sensorEditSide, selectedSensorSide) : ""}
      ${directMode && selected.type === "pressure" ? renderFootPositionEditor(footLayout, selectedFootSide, footMode) : ""}
      ${directMode ? "" : `<div class="inspector-actions"><button class="danger-button" type="button" data-editor-action="${selectedPart === "foot" ? "hide-foot" : "delete"}">${selectedPart === "foot" ? "발바닥 그래픽 숨기기" : "선택 삭제"}</button></div>`}
    </div>
    <div class="inspector-history"><button type="button" data-editor-action="undo" ${historyLength ? "" : "disabled"}>실행 취소</button><button type="button" data-editor-action="redo" ${futureLength ? "" : "disabled"}>다시 실행</button></div>`;
}

function renderLayoutSummary(layout) {
  return layout.elements.map((element) => `<li data-select-element="${escapeHtml(element.id)}" role="button" tabindex="0"><span class="summary-dot tone-${escapeHtml(element.tone)}"></span><span>${escapeHtml(element.label)}</span><small>${element.x},${element.y} · ${element.width}×${element.height}</small></li>`).join("");
}

const SENSOR_POSITION_LABELS = {
  pressure: PRESSURE_SITES.map((site, i) => `${site} · C${PRESSURE_CHANNELS[i]}`),
  thermal: THERMAL_SITES.map((site, i) => `${site} · CH${THERMAL_CHANNELS[i]}`),
};

function renderSensorPositionEditor(sensorLayout, sensorEditKind, selectedSensorIndex, sensorEditSide = "left", selectedSensorSide = null) {
  const side = sensorEditSide === "right" ? "right" : "left";
  const sideLabel = side === "left" ? "왼발" : "오른발";
  const points = sensorLayout[sensorEditKind]?.[side] ?? [];
  const labels = SENSOR_POSITION_LABELS[sensorEditKind] ?? [];
  const isPressure = sensorEditKind === "pressure";
  return `<section class="sensor-position-editor"><div class="sensor-position-heading"><div><span class="editor-widget-kicker">SENSOR POSITION EDITOR</span><b>${isPressure ? "압력센서 위치" : "온·습도센서 위치"}</b></div><span>${sideLabel} · ${isPressure ? "FSR406 × 4" : "SHTC3 × 4"}</span></div><p class="sensor-position-help">현재 ${sideLabel} 센서만 편집합니다. 미리보기의 센서 점을 직접 드래그하거나 아래 X·Y 값을 입력하세요. 왼발과 오른발 좌표는 각각 따로 저장됩니다.</p><div class="sensor-side-tabs"><button type="button" class="${side === "left" ? "is-active" : ""}" data-sensor-editor-side="left">왼발 센서</button><button type="button" class="${side === "right" ? "is-active" : ""}" data-sensor-editor-side="right">오른발 센서</button></div><div class="sensor-position-tabs"><button type="button" class="${isPressure ? "is-active" : ""}" data-sensor-editor-kind="pressure">압력 4개</button><button type="button" class="${!isPressure ? "is-active" : ""}" data-sensor-editor-kind="thermal">온·습도 4개</button></div><div class="sensor-position-list">${points.map(([x, y], index) => `<div class="sensor-position-row ${selectedSensorSide === side && selectedSensorIndex === index ? "is-selected" : ""}"><button type="button" data-sensor-select="${side}:${sensorEditKind}:${index}" aria-label="${sideLabel} ${labels[index] ?? `센서 ${index + 1}`} 선택">${index + 1}</button><span>${labels[index] ?? `센서 ${index + 1}`}</span><label>X<input type="number" min="0" max="100" step="0.5" data-sensor-field="${side}:${sensorEditKind}:${index}:x" value="${x}" /></label><label>Y<input type="number" min="0" max="100" step="0.5" data-sensor-field="${side}:${sensorEditKind}:${index}:y" value="${y}" /></label></div>`).join("")}</div></section>`;
}

function renderFootPositionEditor(footLayout, selectedFootSide, footMode = "pressure") {
  const normalized = normalizeFootLayout(footLayout);
  const mode = FOOT_LAYOUT_MODES.includes(footMode) ? footMode : "pressure";
  const modeLabel = { pressure: "압력", temperature: "온도", humidity: "습도" }[mode];
  const side = selectedFootSide === "right" ? "right" : "left";
  const foot = normalized[mode][side];
  return `<section class="foot-position-editor"><div class="sensor-position-heading"><div><span class="editor-widget-kicker">FOOT IMAGE EDITOR</span><b>발 이미지 편집</b></div><span>${modeLabel} · ${side === "left" ? "왼발" : "오른발"}만 편집</span></div><p class="sensor-position-help">현재 히트맵: ${modeLabel} · 선택한 발 이미지만 드래그·이동·회전·크기 변경됩니다. 다른 발과 다른 히트맵에는 적용되지 않습니다.</p><div class="foot-position-tabs"><button type="button" class="${side === "left" ? "is-active" : ""}" data-foot-select="left">왼발</button><button type="button" class="${side === "right" ? "is-active" : ""}" data-foot-select="right">오른발</button></div><div class="foot-position-fields"><label>X<input type="number" min="-35" max="35" step="0.5" data-foot-field="${mode}:${side}:x" value="${foot.x}" /><small>%</small></label><label>Y<input type="number" min="-35" max="35" step="0.5" data-foot-field="${mode}:${side}:y" value="${foot.y}" /><small>%</small></label><label>회전<input type="number" min="-30" max="30" step="1" data-foot-field="${mode}:${side}:rotation" value="${foot.rotation}" /><small>deg</small></label><label>크기<input type="number" min="0.55" max="1.35" step="0.01" data-foot-field="${mode}:${side}:scale" value="${foot.scale}" /><small>배율</small></label></div></section>`;
}

function renderLivePreview(screenId, state) {
  const renderer = PREVIEW_RENDERERS[screenId] ?? renderOverview;
  return `<section class="editor-live-preview-shell"><div class="editor-live-preview-heading"><div><span class="editor-widget-kicker">8000 LIVE PREVIEW</span><h2>8000과 동일한 실제 화면</h2><p>8000에서 보이는 실제 화면입니다. 카드나 제목을 클릭하고, 글씨를 바로 눌러 수정하세요.</p></div><span class="editor-preview-status"><i></i> ${escapeHtml(getScreenDefinition(screenId).short)}</span></div><div class="editor-live-preview-frame" aria-label="8000 실제 화면 미리보기"><div class="app-frame editor-preview-app">${renderSidebar(screenId)}${renderer(state)}</div></div></section>`;
}

function renderEditor(layout, selectedId, historyLength, futureLength, selectedPart, screenId, state, sensorLayout, sensorEditKind, selectedSensorIndex, footLayout, selectedFootSide, footMode = "pressure", sensorEditSide = "left", selectedSensorSide = null) {
  const selected = layout.elements.find((element) => element.id === selectedId);
  const screen = getScreenDefinition(screenId);
  return `<div class="editor-shell">
    <header class="editor-topbar"><div class="editor-brand"><div class="brand-mark">S</div><div><strong>STEPON DESIGN LAB</strong><span>8001 · VISUAL COMPOSER</span></div></div><div class="editor-topbar-center"><span class="editor-mode-dot"></span><b>편집 모드</b><small>${escapeHtml(screen.label)} 화면</small></div><div class="editor-topbar-actions"><button class="editor-ghost-button" type="button" data-editor-action="open-app">8000에서 확인</button><button class="editor-ghost-button" type="button" data-editor-action="reset">초기화</button><button class="editor-primary-button" type="button" data-editor-action="save">저장</button></div></header>
    <main class="editor-workspace">${renderScreenNavigation(screenId)}<div class="editor-workspace-heading"><div><span class="editor-widget-kicker">8000 MENU CONNECTION</span><h1>${escapeHtml(screen.label)} 구성</h1><p>${escapeHtml(screen.description)} · 이 화면은 8000의 <strong>${escapeHtml(screen.short)}</strong> 메뉴와 연결됩니다. 카드나 제목을 직접 선택하고 글씨를 바로 수정할 수 있어요.</p><div class="editor-workspace-context"><i class="editor-link-dot"></i><span>현재 편집 중: <strong>${escapeHtml(screen.label)}</strong> · 실제 화면 연결됨</span></div></div><div class="editor-workspace-actions"><button type="button" data-editor-action="copy">설계 요약 복사</button><button type="button" data-editor-action="export">JSON 내보내기</button></div></div>${renderLivePreview(screenId, state)}</main>
    <aside class="editor-inspector"><div class="editor-inspector-heading"><span class="editor-widget-kicker">INSPECTOR</span><h1>속성 편집</h1><p>실제 화면에서 선택한 요소의 문구와 글씨 크기를 바꿔보세요.</p></div>${renderInspector(selected, historyLength, futureLength, selectedPart, true, sensorLayout, sensorEditKind, selectedSensorIndex, footLayout, selectedFootSide, footMode, sensorEditSide, selectedSensorSide)}</aside>
    <div class="editor-toast" aria-live="polite"></div>
  </div>`;
}

export function mountEditor(root, state) {
  let screenLayouts = loadLayouts();
  const requestedScreen = new URLSearchParams(window.location.search).get("screen");
  let screenId = SCREEN_DEFS.some((screen) => screen.id === requestedScreen) ? requestedScreen : "overview";
  let layout = normalizeLayout(screenLayouts.screens[screenId]);
  let selectedId = layout.elements[0]?.id ?? null;
  let selectedPart = null;
  let history = [];
  let future = [];
  let drag = null;
  let toastTimer;
  let directTextOverrides = loadDirectTextOverrides();
  let sensorLayout = loadSensorLayout();
  let footLayout = loadFootLayout();
  let sensorEditKind = "pressure";
  let selectedSensorIndex = null;
  let selectedSensorSide = null;
  let sensorEditSide = "left";
  let selectedFootSide = null;
  let sensorFieldBefore = null;
  let footFieldBefore = null;
  let previewHeatmapMode = state.heatmapMode ?? "pressure";

  function captureEditorScroll() {
    const workspace = root.querySelector(".editor-workspace");
    const previewFrame = root.querySelector(".editor-live-preview-frame");
    const inspector = root.querySelector(".editor-inspector");
    return {
      pageX: window.scrollX,
      pageY: window.scrollY,
      rootTop: root.scrollTop,
      workspaceTop: workspace?.scrollTop ?? 0,
      previewTop: previewFrame?.scrollTop ?? 0,
      inspectorTop: inspector?.scrollTop ?? 0,
    };
  }

  function restoreEditorScroll(scroll) {
    if (!scroll) return;
    window.scrollTo(scroll.pageX, scroll.pageY);
    root.scrollTop = scroll.rootTop;
    const workspace = root.querySelector(".editor-workspace");
    const previewFrame = root.querySelector(".editor-live-preview-frame");
    const inspector = root.querySelector(".editor-inspector");
    if (workspace) workspace.scrollTop = scroll.workspaceTop;
    if (previewFrame) previewFrame.scrollTop = scroll.previewTop;
    if (inspector) inspector.scrollTop = scroll.inspectorTop;
  }

  function render() {
    const scroll = root.firstElementChild ? captureEditorScroll() : null;
    const previewState = { ...state, heatmapMode: previewHeatmapMode, sensorLayout, footLayout };
    root.innerHTML = renderEditor(layout, selectedId, history.length, future.length, selectedPart, screenId, previewState, sensorLayout, sensorEditKind, selectedSensorIndex, footLayout, selectedFootSide, previewHeatmapMode, sensorEditSide, selectedSensorSide);
    decorateDirectPreview(root, layout, screenId, selectedId, directTextOverrides, sensorEditKind, selectedSensorIndex, selectedSensorSide, selectedFootSide);
    if (scroll) {
      window.requestAnimationFrame(() => restoreEditorScroll(scroll));
    }
  }

  function persistCurrentLayout() {
    screenLayouts = { ...screenLayouts, version: 2, screens: { ...screenLayouts.screens, [screenId]: normalizeLayout(layout) } };
    persistLayouts(screenLayouts);
  }

  function snapshot() {
    return { layout: clone(layout), directTextOverrides: clone(directTextOverrides), sensorLayout: clone(sensorLayout), footLayout: clone(footLayout) };
  }

  function refreshInspector() {
    const inspector = root.querySelector(".editor-inspector");
    if (!inspector) return;
    const inspectorTop = inspector.scrollTop;
    const selected = layout.elements.find((element) => element.id === selectedId);
    inspector.innerHTML = `<div class="editor-inspector-heading"><span class="editor-widget-kicker">INSPECTOR</span><h1>속성 편집</h1><p>실제 화면에서 선택한 요소의 문구와 글씨 크기를 바꿔보세요.</p></div>${renderInspector(selected, history.length, future.length, selectedPart, true, sensorLayout, sensorEditKind, selectedSensorIndex, footLayout, selectedFootSide, previewHeatmapMode, sensorEditSide, selectedSensorSide)}`;
    inspector.scrollTop = inspectorTop;
  }

  function notify(message) {
    const toast = root.querySelector(".editor-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2300);
  }

  function commit(nextLayout, message, nextDirectTextOverrides = directTextOverrides, nextSensorLayout = sensorLayout, nextFootLayout = footLayout) {
    history.push(snapshot());
    if (history.length > 40) history.shift();
    layout = normalizeLayout(nextLayout);
    directTextOverrides = clone(nextDirectTextOverrides);
    sensorLayout = normalizeSensorLayout(nextSensorLayout);
    footLayout = normalizeFootLayout(nextFootLayout);
    future = [];
    persistCurrentLayout();
    persistSensorLayout(sensorLayout);
    persistFootLayout(footLayout);
    persistDirectTextOverrides(directTextOverrides, sensorLayout, footLayout);
    render();
    if (message) notify(message);
  }

  function updateSelected(patch, message = "변경사항을 저장했어요.") {
    if (!selectedId) return;
    const next = { ...layout, elements: layout.elements.map((element) => element.id === selectedId ? normalizeElement({ ...element, ...patch }) : element) };
    const editableFields = ["title", "description", "label", "kicker"];
    const nextScreenOverrides = { ...(directTextOverrides[screenId] ?? {}) };
    const nextElementOverrides = { ...(nextScreenOverrides[selectedId] ?? {}) };
    editableFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(patch, field)) nextElementOverrides[field] = String(patch[field]);
    });
    const nextOverrides = Object.keys(nextElementOverrides).length
      ? { ...directTextOverrides, [screenId]: { ...nextScreenOverrides, [selectedId]: nextElementOverrides } }
      : directTextOverrides;
    commit(next, message, nextOverrides, sensorLayout, footLayout);
  }

  function markSelectedElement(id) {
    selectedId = id;
    selectedPart = null;
    selectedSensorIndex = null;
    selectedSensorSide = null;
    root.querySelectorAll("[data-editor-id]").forEach((element) => element.classList.toggle("is-selected", element.dataset.editorId === id));
    root.querySelectorAll("[data-sensor-kind][data-sensor-index]").forEach((sensor) => sensor.classList.remove("is-selected"));
  }

  function saveInlineText(target) {
    const elementTarget = target.closest("[data-editor-id]");
    const field = target.dataset.inlineField;
    const current = layout.elements.find((element) => element.id === elementTarget?.dataset.editorId);
    if (!current || !field) return;
    const rawValue = target.textContent.replace(/\s+/g, " ").trim();
    const nextValue = rawValue || (field === "unit" ? "" : current[field]);
    if (String(current[field] ?? "") === nextValue) return;
    history.push(snapshot());
    if (history.length > 40) history.shift();
    layout = normalizeLayout({ ...layout, elements: layout.elements.map((element) => element.id === current.id ? { ...element, [field]: nextValue } : element) });
    future = [];
    persistCurrentLayout();
    persistDirectTextOverrides(directTextOverrides, sensorLayout, footLayout);
    notify("화면에서 직접 수정한 문구를 저장했어요.");
  }

  function saveDirectText(target) {
    const elementId = target.dataset.directElementId;
    const field = target.dataset.directField;
    const current = layout.elements.find((element) => element.id === elementId);
    if (!current || !field) return;
    const rawValue = target.textContent.replace(/\s+/g, " ").trim();
    const nextValue = rawValue || current[field] || "";
    if (String(current[field] ?? "") !== nextValue) {
      history.push(snapshot());
      if (history.length > 40) history.shift();
      layout = normalizeLayout({ ...layout, elements: layout.elements.map((element) => element.id === elementId ? { ...element, [field]: nextValue } : element) });
      future = [];
      persistCurrentLayout();
    }
    const screenOverrides = { ...(directTextOverrides[screenId] ?? {}) };
    directTextOverrides = { ...directTextOverrides, [screenId]: { ...screenOverrides, [elementId]: { ...(screenOverrides[elementId] ?? {}), [field]: nextValue } } };
    persistDirectTextOverrides(directTextOverrides, sensorLayout, footLayout);
    notify("실제 화면의 문구를 저장했어요.");
  }

  function applySensorPositionToPreview(kind, side, index, [x, y]) {
    root.querySelectorAll(`.editor-preview-app [data-sensor-kind="${kind}"][data-sensor-side="${side}"][data-sensor-index="${index}"]`).forEach((target) => {
      target.style.left = `${x}%`;
      target.style.top = `${y}%`;
    });
  }

  function applyFootPositionToPreview(mode, side, foot) {
    root.querySelectorAll(`.editor-preview-app [data-foot-mode="${mode}"][data-foot-layer-side="${side}"]`).forEach((target) => {
      target.style.setProperty("--foot-x", `${foot.x}%`);
      target.style.setProperty("--foot-y", `${foot.y}%`);
      target.style.setProperty("--foot-rotation", `${foot.rotation}deg`);
      target.style.setProperty("--foot-scale", foot.scale);
    });
  }

  function selectSensorTarget(target) {
    const kind = target.dataset.sensorKind === "thermal" ? "thermal" : "pressure";
    const side = target.dataset.sensorSide === "right" ? "right" : "left";
    const index = Number(target.dataset.sensorIndex);
    if (!sensorLayout[kind]?.[side]?.[index]) return false;
    sensorEditKind = kind;
    sensorEditSide = side;
    selectedSensorIndex = index;
    selectedSensorSide = side;
    selectedFootSide = null;
    selectedId = "pressure-1";
    selectedPart = null;
    root.querySelectorAll(".editor-direct-target").forEach((element) => element.classList.toggle("is-selected", selectedSensorSide === null && element.dataset.editorId === selectedId));
    root.querySelectorAll("[data-foot-layer-side]").forEach((foot) => foot.classList.remove("is-selected"));
    root.querySelectorAll("[data-sensor-kind][data-sensor-index]").forEach((sensor) => sensor.classList.toggle("is-selected", sensor === target));
    refreshInspector();
    return true;
  }

  function selectFootTarget(side) {
    const mode = FOOT_LAYOUT_MODES.includes(previewHeatmapMode) ? previewHeatmapMode : "pressure";
    if (!footLayout[mode]?.[side]) return false;
    selectedFootSide = side === "right" ? "right" : "left";
    selectedSensorIndex = null;
    selectedSensorSide = null;
    selectedId = "pressure-1";
    selectedPart = null;
    root.querySelectorAll(".editor-direct-target").forEach((element) => element.classList.remove("is-selected"));
    root.querySelectorAll("[data-sensor-kind][data-sensor-index]").forEach((sensor) => sensor.classList.remove("is-selected"));
    root.querySelectorAll(`[data-foot-mode="${mode}"][data-foot-layer-side]`).forEach((foot) => foot.classList.toggle("is-selected", foot.dataset.footLayerSide === selectedFootSide));
    refreshInspector();
    return true;
  }

  function updateSensorPosition(kind, side, index, axis, value, recordHistory = true) {
    if (!sensorLayout[kind]?.[side]?.[index]) return;
    const nextPoints = sensorLayout[kind][side].map((point) => [...point]);
    nextPoints[index][axis === "x" ? 0 : 1] = Number(value);
    const nextLayout = normalizeSensorLayout({ ...sensorLayout, [kind]: { ...sensorLayout[kind], [side]: nextPoints } });
    const nextPoint = nextLayout[kind][side][index];
    if (nextPoint[0] === sensorLayout[kind][side][index][0] && nextPoint[1] === sensorLayout[kind][side][index][1]) return;
    if (recordHistory) {
      history.push(snapshot());
      if (history.length > 40) history.shift();
      future = [];
    }
    sensorLayout = nextLayout;
    persistSensorLayout(sensorLayout);
    persistDirectTextOverrides(directTextOverrides, sensorLayout, footLayout);
    applySensorPositionToPreview(kind, side, index, nextPoint);
    if (recordHistory) {
      refreshInspector();
      notify(`${kind === "pressure" ? "압력" : "온습도"} 센서 ${index + 1} 위치를 저장했어요.`);
    }
  }

  function finishSensorFieldEdit() {
    if (!sensorFieldBefore) return;
    const { key, snapshot: beforeSnapshot } = sensorFieldBefore;
    const [kind, side, rawIndex] = key.split(":");
    const index = Number(rawIndex);
    const beforePoint = beforeSnapshot.sensorLayout[kind]?.[side]?.[index];
    const currentPoint = sensorLayout[kind]?.[side]?.[index];
    if (beforePoint && currentPoint && (beforePoint[0] !== currentPoint[0] || beforePoint[1] !== currentPoint[1])) {
      history.push(beforeSnapshot);
      if (history.length > 40) history.shift();
      future = [];
      persistSensorLayout(sensorLayout);
      persistDirectTextOverrides(directTextOverrides, sensorLayout, footLayout);
      refreshInspector();
      notify(`${kind === "pressure" ? "압력" : "온습도"} 센서 ${index + 1} 위치를 저장했어요.`);
    }
    sensorFieldBefore = null;
  }

  function updateFootPosition(mode, side, field, value, recordHistory = true) {
    if (!FOOT_LAYOUT_MODES.includes(mode) || !footLayout[mode]?.[side] || !["x", "y", "rotation", "scale"].includes(field)) return;
    const nextLayout = normalizeFootLayout({ ...footLayout, [mode]: { ...footLayout[mode], [side]: { ...footLayout[mode][side], [field]: Number(value) } } });
    const nextFoot = nextLayout[mode][side];
    if (nextFoot[field] === footLayout[mode][side][field]) return;
    if (recordHistory) {
      history.push(snapshot());
      if (history.length > 40) history.shift();
      future = [];
    }
    footLayout = nextLayout;
    persistFootLayout(footLayout);
    persistDirectTextOverrides(directTextOverrides, sensorLayout, footLayout);
    applyFootPositionToPreview(mode, side, nextFoot);
    if (recordHistory) {
      refreshInspector();
      notify(`${side === "left" ? "왼발" : "오른발"} 이미지 ${field === "rotation" ? "회전" : field === "scale" ? "크기" : "위치"}를 저장했어요.`);
    }
  }

  function finishFootFieldEdit() {
    if (!footFieldBefore) return;
    const { key, snapshot: beforeSnapshot } = footFieldBefore;
    const [mode, side, field] = key.split(":");
    const beforeFoot = beforeSnapshot.footLayout[mode]?.[side];
    const currentFoot = footLayout[mode]?.[side];
    if (beforeFoot && currentFoot && beforeFoot[field] !== currentFoot[field]) {
      history.push(beforeSnapshot);
      if (history.length > 40) history.shift();
      future = [];
      persistFootLayout(footLayout);
      persistDirectTextOverrides(directTextOverrides, sensorLayout, footLayout);
      refreshInspector();
      notify(`${side === "left" ? "왼발" : "오른발"} 이미지 설정을 저장했어요.`);
    }
    footFieldBefore = null;
  }

  function undo() {
    if (!history.length) return;
    future.unshift(snapshot());
    const previous = history.pop();
    layout = clone(previous.layout ?? previous);
    directTextOverrides = clone(previous.directTextOverrides ?? directTextOverrides);
    sensorLayout = normalizeSensorLayout(previous.sensorLayout ?? sensorLayout);
    footLayout = normalizeFootLayout(previous.footLayout ?? footLayout);
    selectedId = layout.elements.find((element) => element.id === selectedId)?.id ?? layout.elements[0]?.id ?? null;
    persistCurrentLayout();
    persistSensorLayout(sensorLayout);
    persistFootLayout(footLayout);
    persistDirectTextOverrides(directTextOverrides, sensorLayout, footLayout);
    render();
    notify("이전 배치로 되돌렸어요.");
  }

  function redo() {
    if (!future.length) return;
    history.push(snapshot());
    const next = future.shift();
    layout = clone(next.layout ?? next);
    directTextOverrides = clone(next.directTextOverrides ?? directTextOverrides);
    sensorLayout = normalizeSensorLayout(next.sensorLayout ?? sensorLayout);
    footLayout = normalizeFootLayout(next.footLayout ?? footLayout);
    selectedId = layout.elements.find((element) => element.id === selectedId)?.id ?? layout.elements[0]?.id ?? null;
    persistCurrentLayout();
    persistSensorLayout(sensorLayout);
    persistFootLayout(footLayout);
    persistDirectTextOverrides(directTextOverrides, sensorLayout, footLayout);
    render();
    notify("변경사항을 다시 적용했어요.");
  }

  function getGridDelta(event, current) {
    const canvas = root.querySelector(".editor-canvas");
    if (!canvas) return { x: current.x, y: current.y };
    const styles = window.getComputedStyle(canvas);
    const padding = Number.parseFloat(styles.paddingLeft) || 18;
    const gap = Number.parseFloat(styles.columnGap) || 12;
    const rowHeight = Number.parseFloat(styles.gridAutoRows) || 52;
    const usableWidth = canvas.clientWidth - padding * 2;
    const columnWidth = (usableWidth - gap * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
    if (drag.mode === "resize") {
      return {
        width: clamp(current.width + Math.round((event.clientX - drag.startX) / (columnWidth + gap)), 2, GRID_COLUMNS - current.x + 1),
        height: clamp(current.height + Math.round((event.clientY - drag.startY) / (rowHeight + gap)), 1, 8),
      };
    }
    return {
      x: clamp(current.x + Math.round((event.clientX - drag.startX) / (columnWidth + gap)), 1, GRID_COLUMNS - current.width + 1),
      y: Math.max(1, current.y + Math.round((event.clientY - drag.startY) / (rowHeight + gap))),
    };
  }

  root.addEventListener("click", async (event) => {
    if (sensorFieldBefore && !event.target.closest("[data-sensor-field]")) finishSensorFieldEdit();
    if (footFieldBefore && !event.target.closest("[data-foot-field]")) finishFootFieldEdit();
    const sensorTarget = event.target.closest("[data-sensor-kind][data-sensor-index]");
    const preview = root.querySelector(".editor-preview-app");
    if (sensorTarget && preview?.contains(sensorTarget)) {
      selectSensorTarget(sensorTarget);
      return;
    }
    const footSelectTarget = event.target.closest("[data-foot-select]");
    if (footSelectTarget) {
      selectFootTarget(footSelectTarget.dataset.footSelect);
      render();
      return;
    }
    const footTarget = event.target.closest("[data-foot-side]");
    if (footTarget && preview?.contains(footTarget)) {
      selectFootTarget(footTarget.dataset.footSide);
      return;
    }
    const heatmapModeTarget = event.target.closest("[data-heatmap-mode]");
    if (heatmapModeTarget) {
      previewHeatmapMode = heatmapModeTarget.dataset.heatmapMode;
      sensorEditKind = previewHeatmapMode === "pressure" ? "pressure" : "thermal";
      selectedId = "pressure-1";
      selectedPart = null;
      selectedSensorIndex = null;
      selectedSensorSide = null;
      selectedFootSide = null;
      render();
      return;
    }
    const sensorEditorKindTarget = event.target.closest("[data-sensor-editor-kind]");
    if (sensorEditorKindTarget) {
      sensorEditKind = sensorEditorKindTarget.dataset.sensorEditorKind === "thermal" ? "thermal" : "pressure";
      selectedSensorIndex = null;
      selectedSensorSide = null;
      selectedFootSide = null;
      render();
      return;
    }
    const sensorEditorSideTarget = event.target.closest("[data-sensor-editor-side]");
    if (sensorEditorSideTarget) {
      sensorEditSide = sensorEditorSideTarget.dataset.sensorEditorSide === "right" ? "right" : "left";
      selectedSensorIndex = null;
      selectedSensorSide = null;
      selectedFootSide = null;
      render();
      return;
    }
    const sensorSelectTarget = event.target.closest("[data-sensor-select]");
    if (sensorSelectTarget) {
      const [side, kind, rawIndex] = sensorSelectTarget.dataset.sensorSelect.split(":");
      sensorEditKind = kind === "thermal" ? "thermal" : "pressure";
      sensorEditSide = side === "right" ? "right" : "left";
      selectedSensorIndex = Number(rawIndex);
      selectedSensorSide = sensorEditSide;
      selectedFootSide = null;
      selectedId = "pressure-1";
      selectedPart = null;
      render();
      return;
    }
    const screenTarget = event.target.closest("[data-editor-screen]");
    if (screenTarget) {
      const nextScreenId = screenTarget.dataset.editorScreen;
      if (!SCREEN_DEFS.some((screen) => screen.id === nextScreenId) || nextScreenId === screenId) return;
      screenId = nextScreenId;
      layout = normalizeLayout(screenLayouts.screens[screenId] ?? DEFAULT_LAYOUT);
      selectedId = layout.elements[0]?.id ?? null;
      selectedPart = null;
      selectedSensorIndex = null;
      selectedSensorSide = null;
      selectedFootSide = null;
      history = [];
      future = [];
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("mode", "editor");
      nextUrl.searchParams.set("screen", nextScreenId);
      window.history.replaceState({}, "", nextUrl);
      render();
      notify(`${getScreenDefinition(screenId).label} 편집 화면으로 전환했어요.`);
      return;
    }
    const subTarget = event.target.closest("[data-sub-element]");
    if (subTarget) {
      selectedId = subTarget.dataset.parentElement;
      selectedPart = subTarget.dataset.subElement;
      selectedFootSide = null;
      render();
      return;
    }
    const selectTarget = event.target.closest("[data-select-element]");
    if (selectTarget && !event.target.closest("button, input, select, textarea, [contenteditable=\"true\"]")) {
      markSelectedElement(selectTarget.dataset.selectElement);
      render();
      return;
    }

    const addTarget = event.target.closest("[data-add-component]");
    if (addTarget) {
      const newElement = createElement(addTarget.dataset.addComponent, layout.elements);
      selectedId = newElement.id;
      selectedPart = null;
      commit({ ...layout, elements: [...layout.elements, newElement] }, `${getCatalogItem(newElement.type).label}을 추가했어요.`);
      return;
    }

    const actionTarget = event.target.closest("[data-editor-action]");
    if (!actionTarget) return;
    const action = actionTarget.dataset.editorAction;
    if (action === "undo") return undo();
    if (action === "redo") return redo();
    if (action === "save") {
      persistCurrentLayout();
      void persistDirectTextOverrides(directTextOverrides, sensorLayout, footLayout)
        .then(() => notify(`${getScreenDefinition(screenId).label} 화면 구성을 저장했고 8000에 동기화했어요.`))
        .catch(() => notify("로컬 저장은 됐지만 8000 동기화에 실패했어요."));
      return;
    }
    if (action === "reset") { selectedId = defaultLayoutFor(screenId).elements[0].id; selectedPart = null; commit(clone(defaultLayoutFor(screenId)), "기본 화면 구성으로 초기화했어요."); return; }
    if (action === "delete" && selectedId) {
      const removed = layout.elements.find((element) => element.id === selectedId);
      const remaining = layout.elements.filter((element) => element.id !== selectedId);
      selectedId = remaining[0]?.id ?? null;
      selectedPart = null;
      commit({ ...layout, elements: remaining }, `${removed?.label ?? "블록"}을 삭제했어요.`);
      return;
    }
    if (action === "hide-foot" && selectedId) {
      selectedPart = null;
      updateSelected({ showFoot: false }, "발바닥 그래픽을 숨겼어요. 실행 취소로 복구할 수 있어요.");
      return;
    }
    if (action === "remove-image" && selectedId) {
      updateSelected({ imageSrc: "", imageName: "" }, "등록한 이미지를 제거했어요.");
      return;
    }
    if (action === "open-app") {
      window.location.href = `${window.location.protocol}//${window.location.host.replace(/:\d+$/, ":8000")}/?view=${encodeURIComponent(screenId)}&preview=1`;
      return;
    }
    if (action === "copy") {
      const summary = JSON.stringify({ screen: screenId, screenName: getScreenDefinition(screenId).label, layout }, null, 2);
      try {
        await navigator.clipboard.writeText(summary);
        notify("설계 요약을 클립보드에 복사했어요.");
      } catch {
        notify("복사할 수 없어요. JSON 내보내기를 사용해 주세요.");
      }
      return;
    }
    if (action === "export") {
      const blob = new Blob([JSON.stringify({ screen: screenId, screenName: getScreenDefinition(screenId).label, layout }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "stepon-layout.json";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("설계 JSON 파일을 내보냈어요.");
    }
  });

  root.addEventListener("change", (event) => {
    const sensorField = event.target.closest("[data-sensor-field]");
    if (sensorField) {
      const [side, kind, rawIndex, axis] = sensorField.dataset.sensorField.split(":");
      sensorEditSide = side === "right" ? "right" : "left";
      updateSensorPosition(kind, sensorEditSide, Number(rawIndex), axis, sensorField.value, false);
      finishSensorFieldEdit();
      return;
    }
    const footField = event.target.closest("[data-foot-field]");
    if (footField) {
      const [mode, side, field] = footField.dataset.footField.split(":");
      updateFootPosition(mode, side, field, footField.value, false);
      finishFootFieldEdit();
      return;
    }
    const imageTarget = event.target.closest("[data-editor-image]");
    if (imageTarget) {
      const file = imageTarget.files?.[0];
      const imageElementId = selectedId;
      if (!file || !imageElementId) return;
      if (!file.type.startsWith("image/")) {
        notify("이미지 파일만 등록할 수 있어요.");
        return;
      }
      if (file.size > 4 * 1024 * 1024) {
        notify("이미지는 4MB 이하로 등록해 주세요.");
        return;
      }
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        if (!layout.elements.some((element) => element.id === imageElementId)) return;
        selectedId = imageElementId;
        updateSelected({ imageSrc: String(reader.result || ""), imageName: file.name }, `${file.name} 이미지를 등록했어요.`);
      });
      reader.addEventListener("error", () => notify("이미지를 읽지 못했어요."));
      reader.readAsDataURL(file);
      return;
    }
    const fieldTarget = event.target.closest("[data-editor-field]");
    if (!fieldTarget) return;
    const field = fieldTarget.dataset.editorField;
    const rawValue = fieldTarget.value;
    const numericFields = ["x", "y", "width", "height"];
    updateSelected({ [field]: numericFields.includes(field) ? Number(rawValue) : rawValue });
  });

  root.addEventListener("input", (event) => {
    const sensorField = event.target.closest("[data-sensor-field]");
    if (sensorField) {
      const [side, kind, rawIndex, axis] = sensorField.dataset.sensorField.split(":");
      sensorEditSide = side === "right" ? "right" : "left";
      const key = `${kind}:${sensorEditSide}:${Number(rawIndex)}`;
      if (!sensorFieldBefore || sensorFieldBefore.key !== key) sensorFieldBefore = { key, snapshot: snapshot() };
      updateSensorPosition(kind, sensorEditSide, Number(rawIndex), axis, sensorField.value, false);
      return;
    }
    const footField = event.target.closest("[data-foot-field]");
    if (!footField) return;
    const [mode, side, field] = footField.dataset.footField.split(":");
    const key = `${mode}:${side}:${field}`;
    if (!footFieldBefore || footFieldBefore.key !== key) footFieldBefore = { key, snapshot: snapshot() };
    updateFootPosition(mode, side, field, footField.value, false);
  });

  root.addEventListener("focusin", (event) => {
    const sensorField = event.target.closest("[data-sensor-field]");
    if (sensorField) {
      const [side, kind, rawIndex] = sensorField.dataset.sensorField.split(":");
      sensorEditSide = side === "right" ? "right" : "left";
      sensorFieldBefore = { key: `${kind}:${sensorEditSide}:${Number(rawIndex)}`, snapshot: snapshot() };
      return;
    }
    const footField = event.target.closest("[data-foot-field]");
    if (footField) {
      const [mode, side, field] = footField.dataset.footField.split(":");
      previewHeatmapMode = FOOT_LAYOUT_MODES.includes(mode) ? mode : previewHeatmapMode;
      selectedFootSide = side === "right" ? "right" : "left";
      footFieldBefore = { key: `${mode}:${selectedFootSide}:${field}`, snapshot: snapshot() };
      return;
    }
    const directTarget = event.target.closest("[data-direct-field]");
    const directElement = event.target.closest("[data-editor-id]");
    if (directTarget && directElement?.classList.contains("editor-direct-target")) {
      markSelectedElement(directElement.dataset.editorId);
      refreshInspector();
      return;
    }
    const inlineTarget = event.target.closest("[data-inline-field]");
    const elementTarget = event.target.closest("[data-editor-id]");
    if (inlineTarget && elementTarget) {
      markSelectedElement(elementTarget.dataset.editorId);
      refreshInspector();
    }
  });

  root.addEventListener("focusout", (event) => {
    const sensorField = event.target.closest("[data-sensor-field]");
    if (sensorField) {
      finishSensorFieldEdit();
      return;
    }
    const footField = event.target.closest("[data-foot-field]");
    if (footField) {
      finishFootFieldEdit();
      return;
    }
    const directTarget = event.target.closest("[data-direct-field]");
    if (directTarget) {
      saveDirectText(directTarget);
      refreshInspector();
      return;
    }
    const inlineTarget = event.target.closest("[data-inline-field]");
    if (inlineTarget) {
      saveInlineText(inlineTarget);
      refreshInspector();
    }
  });

  root.addEventListener("pointerdown", (event) => {
    if (sensorFieldBefore && !event.target.closest("[data-sensor-field]")) finishSensorFieldEdit();
    if (footFieldBefore && !event.target.closest("[data-foot-field]")) finishFootFieldEdit();
    const sensorTarget = event.target.closest("[data-sensor-kind][data-sensor-index]");
    const preview = root.querySelector(".editor-preview-app");
    if (sensorTarget && preview?.contains(sensorTarget)) {
      const kind = sensorTarget.dataset.sensorKind === "thermal" ? "thermal" : "pressure";
      const side = sensorTarget.dataset.sensorSide === "right" ? "right" : "left";
      const index = Number(sensorTarget.dataset.sensorIndex);
      const figure = sensorTarget.closest(".foot-map-figure");
      if (!figure || !sensorLayout[kind]?.[side]?.[index]) return;
      event.preventDefault();
      selectSensorTarget(sensorTarget);
      drag = { mode: "sensor", kind, side, index, figure, before: snapshot(), moved: false };
      root.classList.add("is-dragging");
      return;
    }
    const footTarget = event.target.closest("[data-foot-side]");
    if (footTarget && preview?.contains(footTarget)) {
      const mode = FOOT_LAYOUT_MODES.includes(previewHeatmapMode) ? previewHeatmapMode : "pressure";
      const side = footTarget.dataset.footSide === "right" ? "right" : "left";
      const figure = footTarget.closest(".foot-map-figure");
      if (!figure || !footLayout[mode]?.[side]) return;
      event.preventDefault();
      selectFootTarget(side);
      drag = { mode: "foot", heatmapMode: mode, side, figure, startX: event.clientX, startY: event.clientY, origin: clone(footLayout[mode][side]), before: snapshot(), moved: false };
      root.classList.add("is-dragging");
      return;
    }
    const elementTarget = event.target.closest("[data-editor-id]");
    if (!elementTarget || event.target.closest("button, input, select, textarea, [contenteditable=\"true\"]")) return;
    if (elementTarget.classList.contains("editor-direct-target")) return;
    const current = layout.elements.find((element) => element.id === elementTarget.dataset.editorId);
    if (!current) return;
    if (event.target.closest("[data-resize]")) event.preventDefault();
    markSelectedElement(current.id);
    drag = { id: current.id, mode: event.target.closest("[data-resize]") ? "resize" : "move", startX: event.clientX, startY: event.clientY, origin: clone(current), moved: false };
    root.classList.add("is-dragging");
  });

  window.addEventListener("pointermove", (event) => {
    if (!drag) return;
    if (drag.mode === "foot") {
      const rect = drag.figure.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const nextLayout = normalizeFootLayout({ ...footLayout, [drag.heatmapMode]: { ...footLayout[drag.heatmapMode], [drag.side]: {
        ...drag.origin,
        x: drag.origin.x + ((event.clientX - drag.startX) / rect.width) * 100,
        y: drag.origin.y + ((event.clientY - drag.startY) / rect.height) * 100,
      } } });
      const nextFoot = nextLayout[drag.heatmapMode][drag.side];
      if (JSON.stringify(nextFoot) === JSON.stringify(footLayout[drag.heatmapMode][drag.side])) return;
      drag.moved = true;
      footLayout = nextLayout;
      applyFootPositionToPreview(drag.heatmapMode, drag.side, nextFoot);
      return;
    }
    if (drag.mode === "sensor") {
      const rect = drag.figure.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
      const y = Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100));
      const previousPoint = sensorLayout[drag.kind][drag.side][drag.index];
      const nextPoints = sensorLayout[drag.kind][drag.side].map((point) => [...point]);
      nextPoints[drag.index] = [x, y];
      sensorLayout = normalizeSensorLayout({ ...sensorLayout, [drag.kind]: { ...sensorLayout[drag.kind], [drag.side]: nextPoints } });
      if (x !== previousPoint[0] || y !== previousPoint[1]) {
        drag.moved = true;
        applySensorPositionToPreview(drag.kind, drag.side, drag.index, sensorLayout[drag.kind][drag.side][drag.index]);
      }
      return;
    }
    const distance = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY);
    if (distance < 4) return;
    drag.moved = true;
    const position = getGridDelta(event, drag.origin);
    const elementTarget = root.querySelector(`[data-editor-id="${drag.id}"]`);
    if (elementTarget) {
      if (position.x) elementTarget.style.setProperty("--editor-x", position.x);
      if (position.y) elementTarget.style.setProperty("--editor-y", position.y);
      if (position.width) elementTarget.style.setProperty("--editor-w", position.width);
      if (position.height) elementTarget.style.setProperty("--editor-h", position.height);
      const chip = elementTarget.querySelector(".editor-element-chip");
      if (chip) chip.innerHTML = `${escapeHtml(drag.origin.label)} <span>${position.x ?? drag.origin.x},${position.y ?? drag.origin.y} · ${position.width ?? drag.origin.width}×${position.height ?? drag.origin.height}</span>`;
    }
    drag.position = position;
  });

  window.addEventListener("pointerup", () => {
    if (!drag) return;
    const finishedDrag = drag;
    drag = null;
    root.classList.remove("is-dragging");
    if (finishedDrag.mode === "sensor") {
      if (!finishedDrag.moved) return;
      history.push(finishedDrag.before);
      if (history.length > 40) history.shift();
      future = [];
      persistSensorLayout(sensorLayout);
      persistDirectTextOverrides(directTextOverrides, sensorLayout, footLayout);
      render();
      notify(`${finishedDrag.kind === "pressure" ? "압력" : "온습도"} 센서 ${finishedDrag.index + 1} 위치를 저장했어요.`);
      return;
    }
    if (finishedDrag.mode === "foot") {
      if (!finishedDrag.moved) return;
      history.push(finishedDrag.before);
      if (history.length > 40) history.shift();
      future = [];
      persistFootLayout(footLayout);
      persistDirectTextOverrides(directTextOverrides, sensorLayout, footLayout);
      render();
      notify(`${finishedDrag.side === "left" ? "왼발" : "오른발"} 이미지를 이동했어요.`);
      return;
    }
    if (!finishedDrag.moved || !finishedDrag.position) return;
    updateSelected(finishedDrag.position, finishedDrag.mode === "resize" ? `“${finishedDrag.origin.label}” 크기를 조절했어요.` : `“${finishedDrag.origin.label}” 위치를 옮겼어요.`);
  });

  window.addEventListener("keydown", (event) => {
    if (!root.querySelector(".editor-shell")) return;
    const inlineTarget = event.target.closest?.("[data-inline-field]");
    const directTarget = event.target.closest?.("[data-direct-field]");
    if (inlineTarget && event.key === "Enter") {
      event.preventDefault();
      inlineTarget.blur();
      return;
    }
    const editing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) || Boolean(inlineTarget) || Boolean(directTarget);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      if (directTarget) saveDirectText(directTarget);
      if (!editing || directTarget) { event.preventDefault(); undo(); }
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      if (directTarget) saveDirectText(directTarget);
      if (!editing || directTarget) { event.preventDefault(); redo(); }
    }
    if ((event.key === "Delete" || event.key === "Backspace") && !editing && selectedId) {
      event.preventDefault();
      if (selectedPart === "foot") {
        selectedPart = null;
        updateSelected({ showFoot: false }, "발바닥 그래픽을 숨겼어요. 실행 취소로 복구할 수 있어요.");
        return;
      }
      const remaining = layout.elements.filter((element) => element.id !== selectedId);
      selectedId = remaining[0]?.id ?? null;
      commit({ ...layout, elements: remaining }, "선택한 블록을 삭제했어요.");
    }
  });

  render();
  fetch(`/api/editor-state?ts=${Date.now()}`, { cache: "no-store" })
    .then((response) => response.ok ? response.json() : {})
    .then((sharedState) => {
      const remoteText = sharedState?.directText && typeof sharedState.directText === "object"
        ? sharedState.directText
        : sharedState?.sensorLayout ? {}
          : sharedState;
      if (remoteText && Object.keys(remoteText).length) {
        directTextOverrides = remoteText;
        try { window.localStorage.setItem(DIRECT_TEXT_STORAGE_KEY, JSON.stringify(directTextOverrides)); } catch { /* local storage is optional */ }
      }
      if (sharedState?.sensorLayout) {
        sensorLayout = normalizeSensorLayout(sharedState.sensorLayout);
        persistSensorLayout(sensorLayout);
      }
      if (sharedState?.footLayout) {
        footLayout = normalizeFootLayout(sharedState.footLayout);
        persistFootLayout(footLayout);
      }
      if ((remoteText && Object.keys(remoteText).length) || sharedState?.sensorLayout || sharedState?.footLayout) {
        render();
      } else if (Object.keys(directTextOverrides).length) {
        persistDirectTextOverrides(directTextOverrides, sensorLayout, footLayout);
      }
    })
    .catch(() => {
      // The editor remains usable with its per-port local state.
    });
}
