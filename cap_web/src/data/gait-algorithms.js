import { PRESSURE_COUNT, PRESSURE_LAYOUT_ID, PRESSURE_ZONES, PRESSURE_POSITIONS as SENSOR_POSITIONS, validPressure } from './sensor-config.js';
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export const thermalSites = [
  { id: "heel", label: "뒤꿈치", short: "Heel" },
  { id: "arch", label: "발바닥 중앙", short: "Arch" },
  { id: "forefoot", label: "앞꿈치", short: "Forefoot" },
  { id: "toe", label: "발가락", short: "Toe" },
];

export const thermalThresholds = {
  stableMean: 1.0,
  observeMean: 2.0,
  stableMax: 2.0,
  observeMax: 3.0,
  humidityDifference: 15,
};

export const rehabDefaults = {
  activeFoot: "right",
  weightKg: 68,
  allowedLoadPct: 50,
  targetLoadRatio: 50,
  asymmetryTolerancePct: 15,
  supportTimeTolerancePct: 10,
  vibrationStrength: 60,
  contactThreshold: 8, // Four-channel summed relative units; not force.
  repeatRequired: 3,
  windowSize: 5,
  clearRequired: 3,
  cooldownMs: 5000,
};

// Four sparse pressure coordinates/regions are defined in sensor-config.js.
// CoP is a relative estimate, not a calibrated plantar-pressure map.

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validArray(values) {
  return validPressure(values);
}

function numericPressure(values) {
  return Array.from({ length: PRESSURE_COUNT }, (_, index) => Math.max(0, finite(values?.[index]) ?? 0));
}

function zoneSum(values, zone) {
  return PRESSURE_ZONES[zone].reduce((sum, index) => sum + values[index], 0);
}

function percentDifference(a, b) {
  const left = finite(a);
  const right = finite(b);
  if (left === null || right === null || Math.max(Math.abs(left), Math.abs(right)) < 0.01) return null;
  return Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right)) * 100;
}

function mean(values) {
  const valid = values.map(finite).filter((value) => value !== null);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function vectorMagnitude(vector = {}) {
  const x = finite(vector.x) ?? 0;
  const y = finite(vector.y) ?? 0;
  const z = finite(vector.z) ?? 0;
  return Math.sqrt(x ** 2 + y ** 2 + z ** 2);
}

function calculateCop(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  const weighted = values.reduce((result, value, index) => ({
    x: result.x + SENSOR_POSITIONS[index][0] * value,
    y: result.y + SENSOR_POSITIONS[index][1] * value,
  }), { x: 0, y: 0 });
  return { x: Number((weighted.x / total).toFixed(3)), y: Number((weighted.y / total).toFixed(3)) };
}

export function calculateFootMetrics(pressure, imu, config = rehabDefaults) {
  if (!validArray(pressure)) {
    return {
      available: false,
      total: null,
      front: null,
      midfoot: null,
      heel: null,
      medial: null,
      lateral: null,
      heelLandingScore: null,
      propulsionScore: null,
      lateralLoadPct: null,
      cop: null,
      loaded: false,
      moving: false,
      movementScore: null,
      footLiftScore: null,
      landingImpact: null,
    };
  }

  const values = numericPressure(pressure);
  const total = values.reduce((sum, value) => sum + value, 0);
  const front = zoneSum(values, "forefoot");
  const midfoot = zoneSum(values, "midfoot");
  const heel = zoneSum(values, "heel");
  const medial = zoneSum(values, "medial");
  const lateral = zoneSum(values, "lateral");
  const gyro = vectorMagnitude(imu?.gyro);
  const accel = imu?.accel ?? {};
  const verticalAcceleration = Math.abs((finite(accel.z) ?? 1) - 1);
  const movementScore = Math.round(clamp((gyro / 8) + verticalAcceleration * 70, 0, 1) * 100);
  const liftScore = Math.round(clamp(verticalAcceleration * 55 + gyro * 1.8, 0, 1) * 100);

  return {
    available: true,
    total: Number(total.toFixed(1)),
    front: Number(front.toFixed(1)),
    midfoot: Number(midfoot.toFixed(1)),
    heel: Number(heel.toFixed(1)),
    medial: Number(medial.toFixed(1)),
    lateral: Number(lateral.toFixed(1)),
    heelLandingScore: total > 0 ? Math.round(heel / total * 100) : 0,
    propulsionScore: total > 0 ? Math.round(front / total * 100) : 0,
    lateralLoadPct: total > 0 ? Number((lateral / total * 100).toFixed(1)) : 0,
    cop: calculateCop(values),
    loaded: total >= config.contactThreshold,
    moving: movementScore >= 15,
    movementScore,
    footLiftScore: liftScore,
    landingImpact: Math.round(clamp(verticalAcceleration / 0.6, 0, 1) * 100),
  };
}

export function createDefaultRehabState(realSensor = false) {
  return {
    mode: "rehabilitation",
    config: { ...rehabDefaults },
    calibration: {
      pressureLayout: PRESSURE_LAYOUT_ID,
      status: realSensor ? "needed" : "ready",
      capturedAt: null,
      baseline: null,
    },
    metrics: {
      walking: false,
      standing: true,
      bilateralAvailable: false,
      activeFoot: rehabDefaults.activeFoot,
      leftLoadPct: null,
      rightLoadPct: null,
      loadDifferencePct: null,
      supportTimeLeftMs: null,
      supportTimeRightMs: null,
      supportTimeDifferencePct: null,
      heelLanding: { left: null, right: null, active: null },
      propulsion: { left: null, right: null, active: null },
      footLift: { left: null, right: null, active: null },
      lateralLoad: { left: null, right: null, active: null },
      cop: { left: null, right: null, active: null },
      activeTotal: null,
      activeRelativePressure: null,
      activeLoadPct: null,
      loadScaleReady: false,
      stepCount: 0,
      observationCount: 0,
      fatigueScore: 0,
    },
    alerts: [],
    feedback: null,
    status: realSensor ? "calibration_needed" : "ready",
    lastUpdatedAt: null,
  };
}

function emptyThermal() {
  return thermalSites.map((site) => ({ site: site.id, temp: null, humidity: null, available: false }));
}

export function analyzeThermalDifference(thermal) {
  const leftBySite = new Map((thermal?.left ?? []).map((reading) => [reading.site, reading]));
  const rightBySite = new Map((thermal?.right ?? []).map((reading) => [reading.site, reading]));
  const readings = thermalSites.map((site) => {
    const left = leftBySite.get(site.id) ?? { temp: null, humidity: null, available: false };
    const right = rightBySite.get(site.id) ?? { temp: null, humidity: null, available: false };
    const hasPair = left.available !== false && right.available !== false
      && finite(left.temp) !== null && finite(right.temp) !== null;
    const hasHumidityPair = hasPair && finite(left.humidity) !== null && finite(right.humidity) !== null;
    const temperatureDelta = hasPair ? Number(Math.abs(left.temp - right.temp).toFixed(1)) : null;
    const humidityDelta = hasHumidityPair ? Math.abs(left.humidity - right.humidity) : null;
    return { ...site, leftTemp: left.temp, rightTemp: right.temp, leftHumidity: left.humidity, rightHumidity: right.humidity, temperatureDelta, humidityDelta, available: hasPair };
  });
  const comparableReadings = readings.filter((item) => item.available);
  const meanTemperatureDelta = comparableReadings.length ? Number((mean(comparableReadings.map((item) => item.temperatureDelta))).toFixed(1)) : null;
  const maxTemperatureDelta = comparableReadings.length ? Math.max(...comparableReadings.map((item) => item.temperatureDelta)) : null;
  const humidityReadings = comparableReadings.filter((item) => item.humidityDelta !== null);
  const maxHumidityDelta = humidityReadings.length ? Math.max(...humidityReadings.map((item) => item.humidityDelta)) : null;
  const concerningSites = comparableReadings.filter((item) => item.temperatureDelta >= thermalThresholds.observeMean || (item.humidityDelta ?? 0) >= thermalThresholds.humidityDifference);
  const stage = !comparableReadings.length ? "unavailable"
    : meanTemperatureDelta < thermalThresholds.stableMean && maxTemperatureDelta < thermalThresholds.stableMax ? "stable"
      : meanTemperatureDelta < thermalThresholds.observeMean && maxTemperatureDelta < thermalThresholds.observeMax ? "observe" : "priority";

  return {
    readings,
    meanTemperatureDelta,
    maxTemperatureDelta,
    maxHumidityDelta,
    concerningSites,
    stage,
    stageLabel: { stable: "안정", observe: "관찰", priority: "우선 확인", unavailable: "비교 대기" }[stage],
    stageTone: { stable: "mint", observe: "orange", priority: "coral", unavailable: "orange" }[stage],
    disclaimer: stage === "unavailable" ? "양발 센서가 모두 연결되면 좌우 비교를 시작합니다. 현재 값은 진단 결과가 아닙니다." : "온도·습도 차이는 발 상태 관찰용 참고 지표이며 당뇨병을 진단하지 않습니다.",
  };
}

export function analyzeFog({ imu, pressure, cadence }) {
  const freezeBandEnergy = finite(imu?.freezeBandEnergy) ?? 0.34;
  const locomotorBandEnergy = Math.max(finite(imu?.locomotorBandEnergy) ?? 1.72, 0.01);
  const freezeIndex = freezeBandEnergy / locomotorBandEnergy;
  const freezeBandScore = clamp(freezeIndex / 1.6);
  const cadenceDropScore = clamp((100 - (finite(cadence) ?? 96)) / 35);
  const safePressure = numericPressure(pressure);
  const totalPressure = safePressure.reduce((sum, value) => sum + value, 0);
  const frontHeelPressureDelta = Math.abs(safePressure[0] - safePressure[3]);
  const pressureStallScore = clamp(frontHeelPressureDelta / Math.max(totalPressure * 0.32, 1));
  const gyroBurstScore = clamp(vectorMagnitude(imu?.gyro) / 16);
  const score = Number((freezeBandScore * 0.5 + cadenceDropScore * 0.2 + pressureStallScore * 0.2 + gyroBurstScore * 0.1).toFixed(2));
  const state = score >= 0.62 ? "freeze" : score >= 0.36 ? "caution" : "walking";
  return {
    score,
    state,
    stateLabel: { walking: "보행 중", caution: "주의 관찰", freeze: "동결 가능성" }[state],
    stateTone: { walking: "mint", caution: "orange", freeze: "coral" }[state],
    features: { freezeIndex: Number(freezeIndex.toFixed(2)), freezeBandScore: Math.round(freezeBandScore * 100), cadenceDrop: Math.round(cadenceDropScore * 100), pressureStall: Math.round(pressureStallScore * 100), gyroBurst: Math.round(gyroBurstScore * 100) },
    method: "FI proxy = 3–8 Hz 동결 대역 / 0.5–3 Hz 보행 대역",
    disclaimer: "현재 점수는 시연용 휴리스틱입니다. 실제 적용 전 센서 보정·임상 검증이 필요합니다.",
  };
}

function sidePressure(state, side) {
  const direct = state.bilateralPressure?.[side];
  if (validArray(direct)) return direct;
  const footSide = state.hardware?.footSide ?? "left";
  return footSide === side && validArray(state.pressure) ? state.pressure : null;
}

function sideImu(state, side) {
  return state.imuBySide?.[side] ?? (state.hardware?.footSide === side || !state.hardware?.footSide ? state.imu : null);
}

function sideAvailable(state, side) {
  return validArray(sidePressure(state, side));
}

function makeAlert(code, side, level, title, message, correction, vibrationCount) {
  return { code, side, level, title, message, correction, vibrationCount };
}

function recentCount(observations, predicate, windowSize, required) {
  const recent = observations.slice(-windowSize);
  return { count: recent.filter(predicate).length, total: recent.length, confirmed: recent.length >= required && recent.filter(predicate).length >= required };
}

function baselineFor(calibration, side) {
  return calibration?.pressureLayout === PRESSURE_LAYOUT_ID ? calibration?.baseline?.[side] ?? null : null;
}

function updateTracker(tracker, metrics, now) {
  const next = { ...tracker };
  let completed = null;
  if (metrics.available && metrics.loaded && !tracker.loaded) {
    next.startedAt = now;
    next.peakTotal = metrics.total;
    next.heelLandingScore = metrics.heelLandingScore;
    next.landingImpact = metrics.landingImpact;
  }
  if (metrics.available && metrics.loaded) {
    next.peakTotal = Math.max(next.peakTotal ?? 0, metrics.total ?? 0);
    next.propulsionScore = metrics.propulsionScore;
    next.footLiftScore = Math.max(next.footLiftScore ?? 0, metrics.footLiftScore ?? 0);
  }
  if (tracker.loaded && metrics.available && !metrics.loaded && next.startedAt !== null) {
    completed = { supportTimeMs: Math.max(0, now - next.startedAt), maxTotal: next.peakTotal, heelLandingScore: next.heelLandingScore, propulsionScore: next.propulsionScore ?? metrics.propulsionScore, footLiftScore: next.footLiftScore ?? metrics.footLiftScore, landingImpact: next.landingImpact };
    next.startedAt = null;
    next.peakTotal = 0;
    next.heelLandingScore = null;
    next.propulsionScore = null;
    next.footLiftScore = null;
    next.landingImpact = null;
  }
  next.loaded = Boolean(metrics.available && metrics.loaded);
  next.lastSeenAt = now;
  return { tracker: next, completed };
}

export function captureRehabCalibration(state, now = Date.now()) {
  const left = calculateFootMetrics(sidePressure(state, "left"), sideImu(state, "left"));
  const right = calculateFootMetrics(sidePressure(state, "right"), sideImu(state, "right"));
  const baseline = {};
  if (left.available) baseline.left = { total: left.total, heelLandingScore: left.heelLandingScore, propulsionScore: left.propulsionScore, footLiftScore: left.footLiftScore, lateralLoadPct: left.lateralLoadPct, cop: left.cop };
  if (right.available) baseline.right = { total: right.total, heelLandingScore: right.heelLandingScore, propulsionScore: right.propulsionScore, footLiftScore: right.footLiftScore, lateralLoadPct: right.lateralLoadPct, cop: right.cop };
  return { pressureLayout: PRESSURE_LAYOUT_ID, status: Object.keys(baseline).length ? "ready" : "needed", capturedAt: now, baseline: Object.keys(baseline).length ? baseline : null };
}

function makeHistory(previous = {}) {
  return {
    trackers: {
      left: previous.trackers?.left ?? { loaded: false, startedAt: null, peakTotal: 0 },
      right: previous.trackers?.right ?? { loaded: false, startedAt: null, peakTotal: 0 },
    },
    observations: previous.observations ?? [],
    steps: previous.steps ?? { left: [], right: [] },
    alertAt: previous.alertAt ?? {},
    lastFeedbackCode: previous.lastFeedbackCode ?? null,
    clearStreak: previous.clearStreak ?? 0,
    lastObservationAt: previous.lastObservationAt ?? 0,
  };
}

function buildRehabMetrics(left, right, activeFoot, history, now, config) {
  const bilateralAvailable = left.available && right.available;
  const combinedTotal = bilateralAvailable ? left.total + right.total : null;
  const leftLoadPct = combinedTotal ? Number((left.total / combinedTotal * 100).toFixed(1)) : null;
  const rightLoadPct = combinedTotal ? Number((right.total / combinedTotal * 100).toFixed(1)) : null;
  const active = activeFoot === "left" ? left : right;
  const other = activeFoot === "left" ? right : left;
  const activeTracker = history.trackers[activeFoot];
  const supportTime = activeTracker.loaded && activeTracker.startedAt !== null ? now - activeTracker.startedAt : history.steps[activeFoot].at(-1)?.supportTimeMs ?? null;
  const otherSupportTime = history.trackers[activeFoot === "left" ? "right" : "left"].loaded ? null : history.steps[activeFoot === "left" ? "right" : "left"].at(-1)?.supportTimeMs ?? null;
  return {
    walking: (left.moving || right.moving) && (left.loaded || right.loaded),
    standing: !(left.moving || right.moving) && (left.loaded || right.loaded),
    bilateralAvailable,
    activeFoot,
    leftLoadPct,
    rightLoadPct,
    loadDifferencePct: leftLoadPct !== null && rightLoadPct !== null ? Number(Math.abs(leftLoadPct - rightLoadPct).toFixed(1)) : null,
    supportTimeLeftMs: activeFoot === "left" ? supportTime : otherSupportTime,
    supportTimeRightMs: activeFoot === "right" ? supportTime : otherSupportTime,
    supportTimeDifferencePct: bilateralAvailable && supportTime !== null && otherSupportTime !== null ? percentDifference(supportTime, otherSupportTime) : null,
    heelLanding: { left: left.heelLandingScore, right: right.heelLandingScore, active: active.heelLandingScore },
    propulsion: { left: left.propulsionScore, right: right.propulsionScore, active: active.propulsionScore },
    footLift: { left: left.footLiftScore, right: right.footLiftScore, active: active.footLiftScore },
    lateralLoad: { left: left.lateralLoadPct, right: right.lateralLoadPct, active: active.lateralLoadPct },
    cop: { left: left.cop, right: right.cop, active: active.cop },
    activeTotal: active.total,
    activeRelativePressure: active.total !== null ? Number((active.total / PRESSURE_COUNT).toFixed(1)) : null,
    activeLoadPct: null,
    loadScaleReady: false,
    stepCount: history.steps.left.length + history.steps.right.length,
    observationCount: history.observations.length,
    fatigueScore: 0,
    contact: { left: left.loaded, right: right.loaded },
    reference: { left: left, right: right },
    config,
  };
}

function makeAlerts(metrics, state, history, config, fog) {
  if (!metrics.walking || metrics.standing) return [];
  if (fog.state === "freeze") {
    return [makeAlert("fog_priority", config.activeFoot, "priority", "FoG 가능성 우선", "보행동결 가능성이 감지되어 재활 피드백을 잠시 중지합니다.", "잠시 멈추고 호흡을 고른 뒤 안전하게 다시 시작하세요.", 2)];
  }

  const observations = history.observations;
  const active = metrics.reference[config.activeFoot];
  const activeBaseline = baselineFor(state.rehab?.calibration, config.activeFoot);
  const alerts = [];
  const confirmed = (predicate) => recentCount(observations, predicate, config.windowSize, config.repeatRequired).confirmed;

  // A body-weight percentage needs bilateral calibration or a clinician-supplied load reference.
  if (metrics.bilateralAvailable && confirmed((item) => item.activeLoadPct !== null && item.activeLoadPct > config.allowedLoadPct)) {
    alerts.push(makeAlert("overload", config.activeFoot, "priority", "보호하중 초과", `${config.activeFoot === "left" ? "왼발" : "오른발"} 허용 하중은 체중의 ${config.allowedLoadPct}%입니다. 현재 최대 하중은 ${Math.round(Math.max(...observations.slice(-config.windowSize).map((item) => item.activeLoadPct ?? 0)))}%입니다.`, "하중을 줄여 의료진이 정한 범위 안에서 디뎌주세요.", 1));
  }
  if (metrics.bilateralAvailable && confirmed((item) => (item.loadDifferencePct ?? 0) > config.asymmetryTolerancePct || (item.supportTimeDifferencePct ?? 0) > config.supportTimeTolerancePct)) {
    const left = Math.round(metrics.leftLoadPct ?? 0);
    const right = Math.round(metrics.rightLoadPct ?? 0);
    const heavySide = left >= right ? "왼발" : "오른발";
    alerts.push(makeAlert("asymmetry", heavySide === "왼발" ? "left" : "right", "warning", "좌우 하중 불균형", `${heavySide}에 하중이 많이 실리고 있습니다. 왼발 ${left}%, 오른발 ${right}%입니다.`, "양발에 체중을 조금 더 고르게 나눠주세요.", 1));
  }
  if (activeBaseline && confirmed((item) => item.activeFootLift !== null && item.activeFootLift < activeBaseline.footLiftScore * 0.7)) {
    alerts.push(makeAlert("foot_drag", config.activeFoot, "warning", "발 들림 감소", `${config.activeFoot === "left" ? "왼발" : "오른발"} 들림이 평소보다 낮습니다.`, "발을 조금 더 들어 발끝이 바닥에 끌리지 않게 해주세요.", 2));
  }
  if (activeBaseline && confirmed((item) => item.activeHeel !== null && item.activeHeel < activeBaseline.heelLandingScore * 0.7)) {
    alerts.push(makeAlert("heel_landing", config.activeFoot, "warning", "뒤꿈치 착지 부족", `${config.activeFoot === "left" ? "왼발" : "오른발"} 뒤꿈치 초기 압력이 기준보다 낮습니다.`, "뒤꿈치부터 부드럽게 디뎌주세요.", 1));
  }
  if (activeBaseline && confirmed((item) => item.activePropulsion !== null && item.activePropulsion < activeBaseline.propulsionScore * 0.75)) {
    alerts.push(makeAlert("propulsion", config.activeFoot, "warning", "앞꿈치 밀어내기 부족", `${config.activeFoot === "left" ? "왼발" : "오른발"} 앞꿈치 밀어내기가 평소보다 약합니다.`, "발끝으로 지면을 부드럽게 밀어주세요.", 2));
  }
  if (activeBaseline && confirmed((item) => item.activeLateral !== null && item.activeLateral > activeBaseline.lateralLoadPct * 1.15)) {
    alerts.push(makeAlert("lateral_bias", config.activeFoot, "warning", "외측 하중 쏠림", `${config.activeFoot === "left" ? "왼발" : "오른발"} 바깥쪽 하중이 반복적으로 증가했습니다.`, "발바닥 전체를 고르게 사용해주세요.", 2));
  }
  if (confirmed((item) => item.activeCopX !== null && Math.abs(item.activeCopX) > 0.55)) {
    alerts.push(makeAlert("cop_instability", config.activeFoot, "warning", "CoP 불안정", "압력중심이 발 바깥 또는 안쪽으로 크게 흔들리고 있습니다.", "표시된 목표 위치를 향해 천천히 체중을 이동해주세요.", 1));
  }
  if (metrics.fatigueScore >= 2) {
    alerts.push(makeAlert("fatigue", "both", "warning", "피로 누적", "발 들림이 감소하고 좌우 하중 또는 CoP 흔들림이 증가했습니다.", "보행 안정성이 감소하고 있으므로 잠시 휴식하세요.", 2));
  }
  return alerts.sort((a, b) => ({ priority: 0, warning: 1 }[a.level] ?? 9) - ({ priority: 0, warning: 1 }[b.level] ?? 9));
}

function calculateFatigueScore(observations) {
  if (observations.length < 10) return { score: 0, criteria: [] };
  const initial = observations.slice(0, Math.min(10, observations.length));
  const recent = observations.slice(-10);
  const initialLift = mean(initial.map((item) => item.activeFootLift));
  const recentLift = mean(recent.map((item) => item.activeFootLift));
  const initialAsymmetry = mean(initial.map((item) => item.loadDifferencePct));
  const recentAsymmetry = mean(recent.map((item) => item.loadDifferencePct));
  const initialLateral = mean(initial.map((item) => item.activeLateral));
  const recentLateral = mean(recent.map((item) => item.activeLateral));
  const initialCopSway = mean(initial.map((item) => Math.abs(item.activeCopX ?? 0)));
  const recentCopSway = mean(recent.map((item) => Math.abs(item.activeCopX ?? 0)));
  const criteria = [];
  if (initialLift !== null && recentLift !== null && recentLift <= initialLift * 0.7) criteria.push("foot_lift");
  if (initialAsymmetry !== null && recentAsymmetry !== null && recentAsymmetry >= initialAsymmetry + 15) criteria.push("asymmetry");
  if (initialLateral !== null && recentLateral !== null && recentLateral >= initialLateral * 1.15) criteria.push("lateral_bias");
  if (initialCopSway !== null && recentCopSway !== null && recentCopSway >= Math.max(initialCopSway * 1.2, 0.08)) criteria.push("cop_sway");
  return { score: criteria.length, criteria };
}

export function analyzeRehabFrame({ state, history: previousHistory, now = Date.now() }) {
  if (state.rehab?.calibration?.baseline && state.rehab.calibration.pressureLayout !== PRESSURE_LAYOUT_ID) {
    state = { ...state, rehab: { ...state.rehab, calibration: { pressureLayout: PRESSURE_LAYOUT_ID, status: 'needed', baseline: null, capturedAt: null }, feedback: null } };
    previousHistory = {};
  }
  const config = { ...rehabDefaults, ...(state.rehab?.config ?? {}) };
  const history = makeHistory(previousHistory);
  const left = calculateFootMetrics(sidePressure(state, "left"), sideImu(state, "left"), config);
  const right = calculateFootMetrics(sidePressure(state, "right"), sideImu(state, "right"), config);
  const leftUpdate = updateTracker(history.trackers.left, left, now);
  const rightUpdate = updateTracker(history.trackers.right, right, now);
  history.trackers.left = leftUpdate.tracker;
  history.trackers.right = rightUpdate.tracker;
  if (leftUpdate.completed) history.steps.left = [...history.steps.left.slice(-19), leftUpdate.completed];
  if (rightUpdate.completed) history.steps.right = [...history.steps.right.slice(-19), rightUpdate.completed];

  const metrics = buildRehabMetrics(left, right, config.activeFoot, history, now, config);
  const latestLeftStep = history.steps.left.at(-1);
  const latestRightStep = history.steps.right.at(-1);
  const activeStep = config.activeFoot === "left" ? latestLeftStep : latestRightStep;
  const active = metrics.reference[config.activeFoot];
  const leftBaseline = baselineFor(state.rehab?.calibration, "left");
  const rightBaseline = baselineFor(state.rehab?.calibration, "right");
  const calibratedCombinedTotal = leftBaseline?.total !== null && leftBaseline?.total !== undefined
    && rightBaseline?.total !== null && rightBaseline?.total !== undefined
    ? leftBaseline.total + rightBaseline.total
    : null;
  const activeLoadPct = metrics.bilateralAvailable && calibratedCombinedTotal > 0
    ? Number((active.total / calibratedCombinedTotal * 100).toFixed(1))
    : null;
  metrics.activeLoadPct = activeLoadPct;
  metrics.loadScaleReady = activeLoadPct !== null;
  const observation = {
    at: now,
    activeLoadPct,
    loadDifferencePct: metrics.loadDifferencePct,
    supportTimeDifferencePct: metrics.supportTimeDifferencePct,
    activeHeel: activeStep?.heelLandingScore ?? active.heelLandingScore,
    activePropulsion: activeStep?.propulsionScore ?? active.propulsionScore,
    activeFootLift: activeStep?.footLiftScore ?? active.footLiftScore,
    activeLateral: active.lateralLoadPct,
    activeCopX: active.cop?.x ?? null,
    moving: metrics.walking,
  };
  if (!history.lastObservationAt || now - history.lastObservationAt >= 1000) {
    history.observations = [...history.observations.slice(-119), observation];
    history.lastObservationAt = now;
  }

  const thermal = analyzeThermalDifference(state.thermal);
  const fog = analyzeFog({ imu: state.imu, pressure: state.pressure, cadence: state.metrics.cadence });
  const fatigue = calculateFatigueScore(history.observations);
  metrics.fatigueScore = fatigue.score;
  metrics.fatigue = { criteria: fatigue.criteria, active: fatigue.score >= 2 };
  const alerts = makeAlerts(metrics, state, history, config, fog);
  const primary = alerts[0] ?? null;
  const previousFeedback = state.rehab?.feedback ?? null;
  let feedback = previousFeedback;
  let triggeredAlert = false;
  if (primary) {
    history.clearStreak = 0;
    const lastAt = history.alertAt[primary.code] ?? 0;
    if (history.lastFeedbackCode !== primary.code || now - lastAt >= config.cooldownMs) {
      history.alertAt[primary.code] = now;
      history.lastFeedbackCode = primary.code;
      feedback = { ...primary, createdAt: now };
      triggeredAlert = true;
    }
  } else {
    history.clearStreak += 1;
    if (history.clearStreak >= config.clearRequired) {
      feedback = null;
      history.lastFeedbackCode = null;
    }
  }

  const status = state.rehab?.calibration?.status === "ready" ? "ready" : "calibration_needed";
  return {
    history,
    triggeredAlert,
    feedback,
    rehab: {
      ...(state.rehab ?? createDefaultRehabState(state.dataSource === "esp32")),
      mode: "rehabilitation",
      config,
      calibration: state.rehab?.calibration ?? createDefaultRehabState(state.dataSource === "esp32").calibration,
      metrics: { ...metrics, observationCount: history.observations.length },
      alerts,
      feedback,
      status,
      fog,
      thermal,
      lastUpdatedAt: now,
    },
  };
}

export function buildCuePlan({ fog, thermal, outputs }) {
  if (!outputs.auto) return { laser: false, vibration: false, voice: false, reason: "자동 큐가 꺼져 있습니다." };
  if (fog.state === "freeze") return { laser: outputs.laser, vibration: outputs.vibration, voice: outputs.voice, reason: "FoG 가능성이 높아 다음 발 디딤 기준점과 촉각 안내를 권장합니다.", message: "잠시 멈추고, 레이저 점을 따라 천천히 발을 내딛어 주세요." };
  if (fog.state === "caution") return { laser: outputs.laser, vibration: false, voice: outputs.voice, reason: "보행 리듬이 흔들려 시각 안내를 우선 권장합니다.", message: "천천히 호흡하고, 앞의 기준점을 따라가세요." };
  if (thermal.stage === "priority") return { laser: false, vibration: outputs.vibration, voice: outputs.voice, reason: "온도 차이가 커 발 상태 기록과 확인을 권장합니다.", message: "발 상태를 확인하고 필요하면 전문가와 상담하세요." };
  return { laser: false, vibration: false, voice: false, reason: "현재 자동 안내가 필요한 신호는 없습니다." };
}
