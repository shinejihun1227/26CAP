import { icon } from "./icons.js";
import { loadSensorLayout, pointsForSensorMode } from "../data/sensor-layout.js";
import { footLayoutStyle, loadFootLayout } from "../data/foot-layout.js";
import { PRESSURE_COUNT, PRESSURE_CHANNELS, PRESSURE_SITES, THERMAL_CHANNELS, THERMAL_SITES } from '../data/sensor-config.js';

// Pressure values are normalized to 0–100 in esp32-api.js.
// A sensor is visually considered to be carrying pressure at or above this value.
export const PRESSURE_ACTIVE_THRESHOLD = 50;

const MODES = [
  { id: "pressure", label: "압력", unit: "%", description: "FSR406 상대 압력" },
  { id: "temperature", label: "온도", unit: "°C", description: "SHTC3 부위별 온도" },
  { id: "humidity", label: "습도", unit: "%", description: "SHTC3 부위별 습도" },
];

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values) {
  const valid = values.map(number).filter((value) => value !== null);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function formatValue(value, mode) {
  const parsed = number(value);
  if (parsed === null) return "--";
  return mode === "temperature" ? parsed.toFixed(1) : Math.round(parsed).toString();
}

function dataForMode(state, mode, side) {
  if (mode === "pressure") {
    const values = state.bilateralPressure?.[side] ?? (side === "left" ? state.pressure : []);
    return Array.from({ length: PRESSURE_COUNT }, (_, i) => number(values[i]));
  }
  return (state.thermal?.[side] ?? []).map((item) => {
    if (item?.available === false) return null;
    return number(item?.[mode === "temperature" ? "temp" : "humidity"]);
  });
}

function pointsForMode(mode, side, sensorLayout) {
  return pointsForSensorMode(mode, side, sensorLayout);
}

function renderSpots(values, mode, side, sensorLayout) {
  const points = pointsForMode(mode, side, sensorLayout);
  const sensorKind = mode === "pressure" ? "pressure" : "thermal";
  return points.map((point, index) => {
    const value = values[index] ?? null;
    const [left, top] = points[index] ?? [50, 50];
    const parsed = number(value);
    const normalized = parsed === null ? 0 : mode === "temperature" ? (parsed - 28) / 8 : parsed / 100;
    const unavailable = parsed === null;
    const pressureActive = mode === "pressure" && !unavailable && parsed >= PRESSURE_ACTIVE_THRESHOLD;
    const intensity = mode === "pressure"
      ? pressureActive ? 100 : 15
      : Math.round(Math.min(100, Math.max(12, normalized * 100)));
    const stateClass = mode === "pressure"
      ? unavailable ? "is-unavailable" : pressureActive ? "is-pressed" : "is-below-threshold"
      : unavailable ? "is-unavailable" : "";
    const pressureState = unavailable ? "unavailable" : pressureActive ? "active" : "inactive";
    const siteLabel = mode === 'pressure' ? PRESSURE_SITES[index] : THERMAL_SITES[index];
    const channel = mode === 'pressure' ? PRESSURE_CHANNELS[index] : THERMAL_CHANNELS[index];
    const label = unavailable
      ? "측정 대기"
      : `${formatValue(value, mode)}${MODES.find((item) => item.id === mode)?.unit ?? ""}`;
    const statusLabel = mode === "pressure"
      ? unavailable ? "측정 대기" : pressureActive ? "압력 있음" : "압력 없음"
      : label;
    return `<span class="heat-spot heat-${mode} ${stateClass}" data-sensor-kind="${sensorKind}" data-sensor-side="${side}" data-sensor-index="${index}" data-pressure-state="${mode === "pressure" ? pressureState : "not-applicable"}" style="left:${left}%;top:${top}%;--heat:${intensity}%" title="${side === "left" ? "왼발" : "오른발"} ${sensorKind === "pressure" ? "압력" : "온습도"} 센서 ${index + 1} · ${siteLabel} · MUX CH${channel} · ${label} · ${statusLabel}"><i>${index + 1}</i><b><em>${sensorKind === "pressure" ? "P" : "T"}${index + 1}</em><span>${formatValue(value, mode)}</span></b></span>`;
  }).join("");
}

function renderModeTabs(activeMode) {
  return MODES.map((mode) => `<button type="button" class="heatmap-tab ${activeMode === mode.id ? "is-active" : ""}" data-heatmap-mode="${mode.id}">${mode.label}</button>`).join("");
}

export function renderBilateralHeatmap(state) {
  const mode = MODES.some((item) => item.id === state.heatmapMode) ? state.heatmapMode : "pressure";
  const sensorLayout = state.sensorLayout ?? loadSensorLayout();
  const footLayout = state.footLayout ?? loadFootLayout();
  const selectedMode = MODES.find((item) => item.id === mode) ?? MODES[0];
  const leftValues = dataForMode(state, mode, "left");
  const rightValues = dataForMode(state, mode, "right");
  const leftAverage = average(leftValues);
  const rightAverage = average(rightValues);
  const difference = leftAverage !== null && rightAverage !== null ? rightAverage - leftAverage : null;
  const differenceLabel = difference === null
    ? "--"
    : `${difference >= 0 ? "+" : ""}${formatValue(difference, mode)}${selectedMode.unit}`;
  const isEsp32 = state.dataSource === "esp32";
  const leftAvailable = !isEsp32 || (state.hardware?.transport === 'sta' ? Boolean(state.hardware.feet?.left?.connected) : Boolean(state.hardware?.bilateralAvailable) || state.hardware?.footSide === 'left');
  const rightAvailable = !isEsp32 || (state.hardware?.transport === 'sta' ? Boolean(state.hardware.feet?.right?.connected) : Boolean(state.hardware?.bilateralAvailable) || state.hardware?.footSide === 'right');
  const description = (mode === 'pressure' ? state.hardware?.layoutWarning : null) || (mode !== 'pressure' ? '온습도 센서 4개는 TCA9548A의 CH3·4·5·6에 연결합니다. 미연결 값은 측정 대기로 표시합니다.' : leftAvailable && rightAvailable
    ? '압력 P1 앞쪽 · P2 가운데 안쪽 · P3 가운데 바깥쪽 · P4 뒤꿈치. MUX 0·2·4·6을 사용합니다.'
    : leftAvailable || rightAvailable ? '한쪽 깔창이 연결되어 있습니다. 압력은 앞쪽 1개·가운데 2개·뒤꿈치 1개이며, 반대쪽 발은 연결 대기로 표시합니다.' : '양발 연결 대기 중입니다. ESP32와 노트북을 같은 핫스팟 또는 Wi-Fi에 연결하세요.');
  const comparisonPoints = mode === "pressure" ? "한 발당 4개" : "한 발당 4개 부위";

  return `<article class="panel bilateral-heatmap-panel">
    <div class="panel-heading heatmap-heading"><div><span class="panel-kicker">BILATERAL HEATMAP</span><h2>양발 ${selectedMode.label} 히트맵</h2></div><div class="heatmap-heading-actions"><div class="heatmap-mode-switch" role="tablist" aria-label="히트맵 표시 종류">${renderModeTabs(mode)}</div><button type="button" class="heatmap-edit-button" data-action="open-editor">이 화면 직접 편집</button></div></div>
    <p class="panel-description">${description}</p>
    <div class="sensor-channel-map" aria-label="센서 위치와 MUX 채널">${(mode === "pressure" ? PRESSURE_SITES : THERMAL_SITES).map((site, i) => `<span><b>${mode === "pressure" ? "P" : "T"}${i + 1}</b> ${site} <small>${mode === "pressure" ? "C" : "CH"}${(mode === "pressure" ? PRESSURE_CHANNELS : THERMAL_CHANNELS)[i]}</small></span>`).join("")}</div>
    <div class="foot-pair-map" aria-label="양발 ${selectedMode.label} 히트맵">
      <div class="foot-map-figure foot-map-left ${leftAvailable ? "" : "is-unavailable"}" data-foot-side="left" role="img" aria-label="왼발 발바닥 형상과 센서 위치"><div class="foot-map-layer" data-foot-mode="${mode}" data-foot-layer-side="left" style="${footLayoutStyle(mode, "left", footLayout)}"><div class="foot-shape-surface"><img src="/assets/foot-left-silhouette.png" alt="" draggable="false" /></div><div class="foot-hotspots">${renderSpots(leftValues, mode, "left", sensorLayout)}</div></div><span class="foot-side-label">왼발${leftAvailable ? "" : " · 연결 대기"}</span></div>
      <div class="foot-map-figure foot-map-right ${rightAvailable ? "" : "is-unavailable"}" data-foot-side="right" role="img" aria-label="오른발 발바닥 형상과 센서 위치"><div class="foot-map-layer" data-foot-mode="${mode}" data-foot-layer-side="right" style="${footLayoutStyle(mode, "right", footLayout)}"><div class="foot-shape-surface"><img src="/assets/foot-right-silhouette.png" alt="" draggable="false" /></div><div class="foot-hotspots">${renderSpots(rightValues, mode, "right", sensorLayout)}</div></div><span class="foot-side-label">오른발${rightAvailable ? "" : " · 연결 대기"}</span></div>
    </div>
    <div class="heatmap-legend ${mode === "pressure" ? "is-pressure-threshold" : ""}">${mode === "pressure" ? `<span><i class="legend-high"></i>압력 있음 ≥ ${PRESSURE_ACTIVE_THRESHOLD}%</span><span><i class="legend-low"></i>압력 없음 &lt; ${PRESSURE_ACTIVE_THRESHOLD}%</span>` : `<span><i class="legend-low"></i>낮음</span><span><i class="legend-mid"></i>중간</span><span><i class="legend-high"></i>높음</span>`}<small>오른발 - 왼발 <b>${differenceLabel}</b></small></div>
    <div class="heatmap-summary"><div><span>왼발 평균</span><b>${formatValue(leftAverage, mode)}${leftAverage === null ? "" : selectedMode.unit}</b></div><div><span>오른발 평균</span><b>${formatValue(rightAverage, mode)}${rightAverage === null ? "" : selectedMode.unit}</b></div><div><span>비교 포인트</span><b>${leftAvailable && rightAvailable ? comparisonPoints : leftAvailable ? "오른발 대기" : "왼발 대기"}</b></div><button class="text-button" type="button" data-view="safety">알고리즘 보기 ${icon("arrow")}</button></div>
  </article>`;
}
