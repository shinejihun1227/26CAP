import { PRESSURE_POINTS, PRESSURE_LAYOUT_ID } from './sensor-config.js';
export const SENSOR_LAYOUT_STORAGE_KEY = "stepon-cap-web-sensor-layout-v3";
export const SENSOR_SIDES = ["left", "right"];

const DEFAULT_PRESSURE_POINTS = PRESSURE_POINTS;
const DEFAULT_THERMAL_POINTS = [
  [50, 85], [50, 62], [50, 38], [50, 16],
];

export const DEFAULT_SENSOR_LAYOUT = {
  pressure: {
    left: DEFAULT_PRESSURE_POINTS.left.map((point) => [...point]),
    right: DEFAULT_PRESSURE_POINTS.right.map((point) => [...point]),
  },
  thermal: {
    left: DEFAULT_THERMAL_POINTS.map((point) => [...point]),
    right: DEFAULT_THERMAL_POINTS.map((point) => [...point]),
  },
};

function clampCoordinate(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : fallback;
}

function normalizePoints(points, defaults) {
  // Eight-point saved layouts have different anatomical meanings: do not truncate them.
  if (!Array.isArray(points) || points.length !== defaults.length) points = defaults;
  return defaults.map((fallback, index) => {
    const point = Array.isArray(points?.[index]) ? points[index] : fallback;
    return [clampCoordinate(point[0], fallback[0]), clampCoordinate(point[1], fallback[1])];
  });
}

function normalizeSidePoints(source, defaults) {
  const legacyPoints = Array.isArray(source) ? source : null;
  const sideSource = legacyPoints ? { left: legacyPoints, right: legacyPoints } : (source ?? {});
  return Object.fromEntries(SENSOR_SIDES.map((side) => [side, normalizePoints(sideSource[side], Array.isArray(defaults) ? defaults : defaults[side])]));
}

export function normalizeSensorLayout(layout) {
  return {
    pressureSchema: PRESSURE_LAYOUT_ID,
    pressure: normalizeSidePoints(layout?.pressure, DEFAULT_PRESSURE_POINTS),
    thermal: normalizeSidePoints(layout?.thermal, DEFAULT_THERMAL_POINTS),
  };
}

export function loadSensorLayout() {
  try {
    const savedRaw = window.localStorage.getItem(SENSOR_LAYOUT_STORAGE_KEY)
      ?? window.localStorage.getItem("stepon-cap-web-sensor-layout-v2")
      ?? window.localStorage.getItem("stepon-cap-web-sensor-layout-v1");
    const saved = JSON.parse(savedRaw ?? "null");
    return normalizeSensorLayout(saved);
  } catch {
    return normalizeSensorLayout(DEFAULT_SENSOR_LAYOUT);
  }
}

export function persistSensorLayout(layout) {
  const normalized = normalizeSensorLayout(layout);
  try {
    window.localStorage.setItem(SENSOR_LAYOUT_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // The editor remains usable when browser storage is unavailable.
  }
  return normalized;
}

export function pointsForSensorMode(mode, side, layout) {
  const normalized = normalizeSensorLayout(layout);
  const sensorSide = side === "right" ? "right" : "left";
  return mode === "pressure" ? normalized.pressure[sensorSide] : normalized.thermal[sensorSide];
}
