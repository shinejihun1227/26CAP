const DEFAULT_ESP32_URL = "http://192.168.4.1";
const STORAGE_KEY = "stepon-esp32-base-url";
const THERMAL_SITES = ["heel", "arch", "forefoot", "toe"];

function trimBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function getEsp32BaseUrl() {
  const query = new URLSearchParams(window.location.search);
  const fromQuery = query.get("esp32Url");
  if (fromQuery) return trimBaseUrl(fromQuery);
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) return trimBaseUrl(saved);
  } catch {
    // Local storage is optional.
  }
  return DEFAULT_ESP32_URL;
}

export function saveEsp32BaseUrl(value) {
  const url = trimBaseUrl(value);
  try {
    window.localStorage.setItem(STORAGE_KEY, url);
  } catch {
    // Local storage is optional.
  }
  return url;
}

async function request(path, { timeoutMs = 1500, signal } = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const response = await fetch(`${getEsp32BaseUrl()}${path}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`ESP32 HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("ESP32 연결 시간 초과");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function pingEsp32(options) { return request("/api/ping", options); }
export function fetchEsp32State(options) { return request("/api/state", options); }
export function setLaser(enabled) { return request(`/api/laser?on=${enabled ? 1 : 0}`); }
export function vibrate(effect = 47) { return request(`/api/vibrate?effect=${encodeURIComponent(effect)}`); }
export function setAutoCue(enabled) { return request(`/api/auto-cue?enabled=${enabled ? 1 : 0}`); }

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validTemperature(value) {
  const parsed = finite(value);
  return parsed !== null && parsed > -40;
}

function average(values, fallback = null) {
  const valid = (Array.isArray(values) ? values : [])
    .map(finite)
    .filter((value) => value !== null && value > -40);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : fallback;
}

function emptyThermal() {
  return THERMAL_SITES.map((site) => ({ site, temp: null, humidity: null, available: false }));
}

function normalizeThermal(values, humidityValues, readyFlags) {
  return THERMAL_SITES.map((site, index) => {
    const temp = finite(values?.[index]);
    const humidity = finite(humidityValues?.[index]);
    const ready = Array.isArray(readyFlags)
      ? Boolean(readyFlags[index])
      : validTemperature(temp) && humidity !== null && humidity >= 0;
    const available = ready && validTemperature(temp) && humidity !== null && humidity >= 0;
    return {
      site,
      temp: available ? temp : null,
      humidity: available ? humidity : null,
      available,
    };
  });
}

function normalizePressure(values) {
  if (!Array.isArray(values) || values.length !== 8) return null;
  return values.map((value) => {
    const parsed = finite(value);
    return parsed === null ? 0 : Math.max(0, Math.min(100, Math.round(parsed)));
  });
}

function emptyPressure() {
  return Array.from({ length: 8 }, () => null);
}

function normalizeVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: finite(vector?.x) ?? fallback.x,
    y: finite(vector?.y) ?? fallback.y,
    z: finite(vector?.z) ?? fallback.z,
  };
}

export function normalizeEsp32State(payload, previous) {
  const measuredPressure = normalizePressure(payload?.pressure);
  const side = payload?.foot_side === "right" ? "right" : "left";
  const payloadLeftPressure = normalizePressure(payload?.bilateral_pressure?.left);
  const payloadRightPressure = normalizePressure(payload?.bilateral_pressure?.right);
  const hasBilateralPressure = payloadLeftPressure !== null && payloadRightPressure !== null;
  const bilateralAvailable = Boolean(payload?.bilateral_available) && hasBilateralPressure;
  const pressure = measuredPressure ?? (side === "left" ? payloadLeftPressure : payloadRightPressure) ?? previous.pressure;
  const temperature = Array.isArray(payload?.temperature) ? payload.temperature : [];
  const humidity = Array.isArray(payload?.humidity) ? payload.humidity : [];
  const readyFlags = Array.isArray(payload?.shtc3_ready) ? payload.shtc3_ready : undefined;
  const measuredThermal = normalizeThermal(temperature, humidity, readyFlags);
  const leftThermal = side === "left" ? measuredThermal : emptyThermal();
  const rightThermal = side === "right" ? measuredThermal : emptyThermal();
  const accel = normalizeVector(payload?.accel, previous.imu.accel);
  const gyro = normalizeVector(payload?.gyro, previous.imu.gyro);
  const imuBySide = {
    left: payload?.imu_left
      ? { accel: normalizeVector(payload.imu_left.accel, accel), gyro: normalizeVector(payload.imu_left.gyro, gyro) }
      : side === "left" ? { accel, gyro } : previous.imuBySide?.left ?? null,
    right: payload?.imu_right
      ? { accel: normalizeVector(payload.imu_right.accel, accel), gyro: normalizeVector(payload.imu_right.gyro, gyro) }
      : side === "right" ? { accel, gyro } : previous.imuBySide?.right ?? null,
  };
  const total = pressure.reduce((sum, value) => sum + (finite(value) ?? 0), 0);
  const loaded = total > 18;
  const fallbackRisk = payload?.derived?.fog_candidate ? 62 : loaded ? 24 : 8;
  const parsedRisk = finite(payload?.risk);
  const risk = parsedRisk ?? fallbackRisk;
  const output = payload?.output ?? {};
  // With one physical insole, analyze the side that is actually streaming.
  // When both insoles are present, preserve the user's selected rehab foot.
  const nextRehabConfig = {
    ...(previous.rehab?.config ?? {}),
    ...(bilateralAvailable ? {} : { activeFoot: side }),
  };
  // Count channels with a valid measurement, not only successful library
  // initialization. This keeps the web health indicator honest when a sensor
  // responds during init but later returns an invalid reading.
  const thermalReadyCount = measuredThermal.filter((reading) => reading.available).length;
  const calculatedBalance = bilateralAvailable
    ? Math.round(50 + Math.abs((pressure[0] ?? 0) - (pressure[7] ?? 0)) / 2)
    : null;

  return {
    ...previous,
    connected: true,
    dataSource: "esp32",
    tick: Number(payload?.frame ?? previous.tick ?? 0),
    pressure,
    bilateralPressure: {
      left: payloadLeftPressure ?? (side === "left" ? pressure : emptyPressure()),
      right: payloadRightPressure ?? (side === "right" ? pressure : emptyPressure()),
    },
    thermal: { left: leftThermal, right: rightThermal },
    imu: { ...previous.imu, accel, gyro },
    imuBySide,
    rehab: {
      ...previous.rehab,
      config: nextRehabConfig,
    },
    metrics: {
      ...previous.metrics,
      risk: Math.max(0, Math.min(100, Math.round(risk))),
      temperature: average(temperature),
      humidity: average(humidity),
      balance: calculatedBalance,
    },
    outputs: {
      ...previous.outputs,
      laser: Boolean(output.laser),
      // `output.vibration` is a short-lived activity pulse from the ESP32,
      // not the user's vibration-enable preference. Preserve the preference
      // so confirmed web-side rehab alerts can trigger the motor.
      vibration: previous.outputs?.vibration ?? true,
      vibrationActive: Boolean(output.vibration),
      auto: output.auto_cue === undefined ? previous.outputs.auto : Boolean(output.auto_cue),
    },
    device: {
      ...previous.device,
      name: payload?.device ?? "StepOn-C3",
      lastSync: "방금 전",
      signal: "ESP32 실센서",
    },
    hardware: {
      source: "esp32",
      footSide: side,
      bilateralAvailable,
      sampleHz: 64,
      auxSampleHz: 20,
      raw: payload,
      sensors: {
        pressure: { ready: measuredPressure !== null, count: measuredPressure?.length ?? 0, total: 8 },
        thermal: { ready: thermalReadyCount > 0, count: thermalReadyCount, total: 4, readyFlags: readyFlags ?? measuredThermal.map((reading) => reading.available) },
        imu: { ready: Boolean(payload?.imu_ready) },
        tca9548a: { ready: Boolean(payload?.tca_ready) },
        drv2605: { ready: Boolean(payload?.drv2605_ready) },
      },
    },
  };
}

export function markEsp32Disconnected(previous, error) {
  return {
    ...previous,
    connected: false,
    dataSource: "esp32",
    device: { ...previous.device, lastSync: "연결 끊김", signal: "ESP32 연결 끊김" },
    hardware: {
      ...previous.hardware,
      source: "esp32",
      lastError: error?.message ?? "ESP32 연결 실패",
    },
  };
}
