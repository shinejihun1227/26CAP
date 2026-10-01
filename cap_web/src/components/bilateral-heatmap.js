import { icon } from "./icons.js";
import { loadSensorLayout, pointsForSensorMode } from "../data/sensor-layout.js";
import { footLayoutStyle, loadFootLayout } from "../data/foot-layout.js";
import { PRESSURE_COUNT, PRESSURE_CHANNELS, PRESSURE_SITES, THERMAL_CHANNELS, THERMAL_SITES, pressureChannelsFor } from '../data/sensor-config.js';
import { sharedSensorDisplayValue } from './shared-sensor-display.js';

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

function formatValue(value, mode, derived = false) {
  const parsed = number(value);
  if (parsed === null) return "--";
  if (derived && (mode === 'temperature' || mode === 'humidity')) return parsed.toFixed(2);
  return mode === "temperature" ? parsed.toFixed(1) : mode === "humidity" ? Math.round(parsed).toString() : Math.round(parsed).toString();
}

function dataForMode(state, mode, side) {
  if (mode === "pressure") {
    const values = state.bilateralPressure?.[side] ?? (side === "left" ? state.pressure : []);
    return Array.from({ length: PRESSURE_COUNT }, (_, i) => {
      const value = number(values[i]);
      return state.hardware?.sensorProfile === 'two-shared' ? sharedSensorDisplayValue(value, mode, side, i) : value;
    });
  }
  return (state.thermal?.[side] ?? []).map((item, index) => {
    if (item?.available === false) return null;
    const value = number(item?.[mode === "temperature" ? "temp" : "humidity"]);
    return state.hardware?.sensorProfile === 'two-shared' ? sharedSensorDisplayValue(value, mode, side, index) : value;
  });
}

function pointsForMode(mode, side, sensorLayout) {
  return pointsForSensorMode(mode, side, sensorLayout);
}

function renderSpots(values, mode, side, sensorLayout, pressureChannels, sensorProfile, sensorMap = [0, 1, 2, 3]) {
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
    const physicalIndex = sensorMap[index] ?? index;
    const channel = mode === 'pressure' ? pressureChannels[index] : THERMAL_CHANNELS[index];
    const sourceLabel = sensorProfile === 'two-shared'
      ? `${mode === 'pressure' ? '압력' : '온습도'} 센서 ${physicalIndex + 1} 원본 기반 파생 표시`
      : mode === 'pressure' ? `MUX CH${channel}` : `TCA CH${channel}`;
    const label = unavailable
      ? "측정 대기"
      : `${formatValue(value, mode, sensorProfile === 'two-shared')}${MODES.find((item) => item.id === mode)?.unit ?? ""}`;
    const statusLabel = mode === "pressure"
      ? unavailable ? "측정 대기" : pressureActive ? "압력 있음" : "압력 없음"
      : label;
    // Separate the two middle badges only when the saved points share a row.
    const labelAbove = mode === 'pressure' && index === 1 && Math.abs(points[1][1] - points[2][1]) < 12;
    return `<span class="heat-spot heat-${mode} ${stateClass}${labelAbove ? ' heat-label-above' : ''}" data-sensor-kind="${sensorKind}" data-sensor-side="${side}" data-sensor-index="${index}" data-pressure-state="${mode === "pressure" ? pressureState : "not-applicable"}" style="left:${left}%;top:${top}%;--heat:${intensity}%" title="${side === "left" ? "왼발" : "오른발"} ${sensorKind === "pressure" ? "압력" : "온습도"} 센서 ${index + 1} · ${siteLabel} · ${sourceLabel} · ${label} · ${statusLabel}"><i>${index + 1}</i><b><em>${sensorKind === "pressure" ? "P" : "T"}${index + 1}</em><span>${formatValue(value, mode, sensorProfile === 'two-shared')}</span></b></span>`;
  }).join("");
}

function renderModeTabs(activeMode) {
  return MODES.map((mode) => `<button type="button" class="heatmap-tab ${activeMode === mode.id ? "is-active" : ""}" data-heatmap-mode="${mode.id}" aria-pressed="${activeMode === mode.id}">${mode.label}</button>`).join("");
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
  const channelsForSide = (side) => state.hardware?.transport === 'sta'
    ? pressureChannelsFor(state.hardware.feet?.[side]?.state) ?? PRESSURE_CHANNELS
    : state.hardware?.pressureChannels ?? PRESSURE_CHANNELS;
  const leftChannels = channelsForSide('left'), rightChannels = channelsForSide('right');
  const profileForSide = (side) => state.hardware?.transport === 'sta'
    ? state.hardware.feet?.[side]?.state?.sensor_profile ?? 'four-independent'
    : state.hardware?.sensorProfile ?? 'four-independent';
  const mapForSide = (side, kind) => {
    const raw = state.hardware?.transport === 'sta' ? state.hardware.feet?.[side]?.state : state.hardware?.raw;
    return kind === 'pressure' ? raw?.pressure_sensor_map ?? [0, 1, 2, 3] : raw?.thermal_sensor_map ?? [0, 1, 2, 3];
  };
  const channelLabel = (i) => mode !== 'pressure' ? `CH${THERMAL_CHANNELS[i]}`
    : leftAvailable && rightAvailable && leftChannels[i] !== rightChannels[i] ? `왼발 C${leftChannels[i]} / 오른발 C${rightChannels[i]}`
    : `C${(leftAvailable ? leftChannels : rightAvailable ? rightChannels : PRESSURE_CHANNELS)[i]}`;
  const sharedProfile = ['left', 'right'].some(side => (side === 'left' ? leftAvailable : rightAvailable) && profileForSide(side) === 'two-shared');
  const description = sharedProfile ? (mode === 'pressure'
    ? '물리 압력센서는 발당 2개입니다. 짝 지점은 센서값을 비례 조정하고 짧게 평활화한 화면용 표시이며, 실제 4곳 측정값이나 CoP가 아닙니다. AI·저장 분석은 원본 센서값을 사용합니다.'
    : '물리 온습도센서는 발당 2개입니다. 짝 지점은 원본값에서 최대 0.1°C 또는 0.1%p 이내로 나눈 화면용 표시이며, 독립 측정값이 아닙니다. 차이 분석은 원본 센서별 값을 사용합니다.')
    : (mode === 'pressure' ? state.hardware?.layoutWarning : null) || (mode !== 'pressure' ? '온습도 센서 4개는 TCA9548A의 CH3·4·5·6에 연결합니다. 미연결 값은 측정 대기로 표시합니다.' : leftAvailable && rightAvailable
    ? '압력 P1 앞쪽 · P2 가운데 안쪽 · P3 가운데 바깥쪽 · P4 뒤꿈치. 연결된 보드의 MUX 채널을 표시합니다.'
    : leftAvailable || rightAvailable ? '한쪽 깔창이 연결되어 있습니다. 압력은 앞쪽 1개·가운데 2개·뒤꿈치 1개이며, 반대쪽 발은 연결 대기로 표시합니다.' : '양발 연결 대기 중입니다. ESP32와 노트북을 같은 핫스팟 또는 Wi-Fi에 연결하세요.');
  const comparisonPoints = sharedProfile ? '물리 센서 2개 · 파생 표시 4곳' : mode === "pressure" ? "한 발당 4개" : "한 발당 4개 부위";
  const connectionLabel = leftAvailable && rightAvailable ? '양발 연결됨' : leftAvailable ? '오른발 연결 대기' : rightAvailable ? '왼발 연결 대기' : '양발 연결 대기';

  return `<article class="panel bilateral-heatmap-panel compact-heatmap">
    <div class="panel-heading heatmap-heading"><div><span class="panel-kicker">양발 한눈에 보기</span><h2>양발 ${selectedMode.label} 히트맵 <small>단위 ${selectedMode.unit}</small></h2></div><div class="heatmap-heading-actions"><div class="heatmap-mode-switch" role="group" aria-label="히트맵 표시 종류">${renderModeTabs(mode)}</div></div></div>
    <p class="heatmap-status">${connectionLabel}${sharedProfile ? ' · 센서 2개 기반, 4곳은 파생 표시' : ''} <span>숫자는 센서 위치예요.</span></p>
    <div class="heatmap-workspace">
    <div class="foot-pair-map" aria-label="양발 ${selectedMode.label} 히트맵">
      <div class="foot-map-figure foot-map-left ${leftAvailable ? "" : "is-unavailable"}" data-foot-side="left" role="img" aria-label="왼발 발바닥 형상과 센서 위치"><div class="foot-map-layer" data-foot-mode="${mode}" data-foot-layer-side="left" style="${footLayoutStyle(mode, "left", footLayout)}"><div class="foot-shape-surface"><img src="/assets/foot-left-silhouette.png" alt="" draggable="false" /></div><div class="foot-hotspots">${renderSpots(leftValues, mode, "left", sensorLayout, leftChannels, profileForSide('left'), mapForSide('left', mode === 'pressure' ? 'pressure' : 'thermal'))}</div></div><span class="foot-side-label">왼발${leftAvailable ? "" : " · 연결 대기"}</span></div>
      <div class="foot-map-figure foot-map-right ${rightAvailable ? "" : "is-unavailable"}" data-foot-side="right" role="img" aria-label="오른발 발바닥 형상과 센서 위치"><div class="foot-map-layer" data-foot-mode="${mode}" data-foot-layer-side="right" style="${footLayoutStyle(mode, "right", footLayout)}"><div class="foot-shape-surface"><img src="/assets/foot-right-silhouette.png" alt="" draggable="false" /></div><div class="foot-hotspots">${renderSpots(rightValues, mode, "right", sensorLayout, rightChannels, profileForSide('right'), mapForSide('right', mode === 'pressure' ? 'pressure' : 'thermal'))}</div></div><span class="foot-side-label">오른발${rightAvailable ? "" : " · 연결 대기"}</span></div>
    </div>
    <div class="heatmap-summary" aria-label="양발 측정 요약"><div><span>왼발 평균</span><b>${formatValue(leftAverage, mode)}${leftAverage === null ? "" : selectedMode.unit}</b></div><div><span>오른발 평균</span><b>${formatValue(rightAverage, mode)}${rightAverage === null ? "" : selectedMode.unit}</b></div><div class="heatmap-difference"><span>좌우 차이 <small>오른발 − 왼발</small></span><b>${differenceLabel}</b></div><p class="heatmap-reading-note">${sharedProfile ? '원본 센서에서 만든 화면용 표시값의 평균이에요.' : '표시된 센서값의 평균이에요.'}<br>값이 없으면 <b>--</b>로 표시해요.</p></div>
    </div>
    <div class="heatmap-legend ${mode === "pressure" ? "is-pressure-threshold" : ""}">${mode === "pressure" ? `<span><i class="legend-high"></i>압력 있음 ≥ ${PRESSURE_ACTIVE_THRESHOLD}%</span><span><i class="legend-low"></i>압력 없음 &lt; ${PRESSURE_ACTIVE_THRESHOLD}%</span>` : `<span><i class="legend-low"></i>낮음</span><span><i class="legend-mid"></i>중간</span><span><i class="legend-high"></i>높음</span>`}</div>
    <details class="heatmap-details" data-ui-disclosure="heatmap-sensor-details"><summary>센서 위치 · 표시 안내</summary>
      <p class="panel-description">${description}</p>
      <div class="sensor-channel-map" aria-label="센서 위치와 연결 정보">${(mode === "pressure" ? PRESSURE_SITES : THERMAL_SITES).map((site, i) => `<span><b>${mode === "pressure" ? "P" : "T"}${i + 1}</b> ${site} <small>${sharedProfile ? `센서 ${(mapForSide(leftAvailable ? 'left' : 'right', mode === 'pressure' ? 'pressure' : 'thermal')[i] ?? i) + 1} 공유` : channelLabel(i)}</small></span>`).join("")}</div>
      <div class="heatmap-detail-actions"><span>${comparisonPoints}</span><button type="button" class="heatmap-edit-button" data-action="open-editor">이 화면 직접 편집</button><button class="text-button" type="button" data-view="safety">알고리즘 보기 ${icon("arrow")}</button></div>
    </details>
  </article>`;
}
