const DEFAULT_ESP32_URL = "http://192.168.4.1";
import { PRESSURE_COUNT, PRESSURE_LAYOUT_ID, THERMAL_CHANNELS, emptyPressure, pressureContractMatches, pressureChannelsFor } from '../data/sensor-config.js';
const STORAGE_KEY = "stepon-esp32-base-url";
const THERMAL_SITES = ["heel", "arch", "forefoot", "toe"];

export function usesBilateralSta() {
  const q = new URLSearchParams(window.location.search);
  return q.get('transport') === 'sta' || (q.get('transport') !== 'direct' && !q.has('esp32Url'));
}
export async function hubRequest(path, body) {
  const response = await fetch(`/api/insoles/${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(2000) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `PC hub HTTP ${response.status}`);
  return payload;
}

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
export function fetchEsp32State(options) { return usesBilateralSta() ? hubRequest('state') : request("/api/state", options); }
export function setLaser(enabled, side = 'left') { return usesBilateralSta() ? hubRequest('command', { side, action: 'laser', value: enabled }) : request(`/api/laser?on=${enabled ? 1 : 0}`); }
export function vibrate(effect = 47, side = 'left') { return usesBilateralSta() ? hubRequest('command', { side, action: 'vibrate' }) : request(`/api/vibrate?effect=${encodeURIComponent(effect)}`); }
export function setAutoCue(enabled, side = 'left') { return usesBilateralSta() ? hubRequest('command', { side, action: 'auto-cue', value: enabled }) : request(`/api/auto-cue?enabled=${enabled ? 1 : 0}`); }

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
  if (!Array.isArray(values) || values.length !== PRESSURE_COUNT || values.some((v) => finite(v) === null)) return null;
  return values.map((value) => {
    const parsed = finite(value);
    return Math.max(0, Math.min(100, Math.round(parsed)));
  });
}

function normalizeVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: finite(vector?.x) ?? fallback.x,
    y: finite(vector?.y) ?? fallback.y,
    z: finite(vector?.z) ?? fallback.z,
  };
}

export function normalizeEsp32State(payload, previous) {
  if (payload?.service === 'stepon-bilateral-v1') return normalizeBilateralState(payload, previous);
  const contractMatches = pressureContractMatches(payload);
  const measuredPressure = contractMatches ? normalizePressure(payload?.pressure) : null;
  const side = payload?.foot_side === "right" ? "right" : "left";
  const payloadLeftPressure = contractMatches ? normalizePressure(payload?.bilateral_pressure?.left) : null;
  const payloadRightPressure = contractMatches ? normalizePressure(payload?.bilateral_pressure?.right) : null;
  const hasBilateralPressure = payloadLeftPressure !== null && payloadRightPressure !== null;
  const bilateralAvailable = Boolean(payload?.bilateral_available) && hasBilateralPressure;
  const pressure = measuredPressure ?? (side === "left" ? payloadLeftPressure : payloadRightPressure) ?? emptyPressure();
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
  const loaded = total / PRESSURE_COUNT > 2.25;
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
    ? (() => { const left = payloadLeftPressure.reduce((s, v) => s + v, 0), right = payloadRightPressure.reduce((s, v) => s + v, 0); return left + right > 0 ? Math.round((1 - Math.abs(left - right) / (left + right)) * 100) : null; })()
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
      pressureLayout: measuredPressure || hasBilateralPressure ? PRESSURE_LAYOUT_ID : null,
      pressureChannels: pressureChannelsFor(payload),
      thermalChannels: THERMAL_CHANNELS,
      layoutWarning: !contractMatches || (!measuredPressure && !hasBilateralPressure) ? '압력 데이터가 4개 배치와 다릅니다. 실제 MUX 배선과 펌웨어 채널 설정을 확인해 주세요.' : null,
      sampleHz: 64,
      auxSampleHz: 20,
      raw: payload,
      sensors: {
        pressure: { ready: measuredPressure !== null || hasBilateralPressure, count: measuredPressure?.length ?? (hasBilateralPressure ? PRESSURE_COUNT : 0), total: PRESSURE_COUNT },
        thermal: { ready: thermalReadyCount > 0, count: thermalReadyCount, total: 4, readyFlags: readyFlags ?? measuredThermal.map((reading) => reading.available) },
        imu: { ready: Boolean(payload?.imu_ready) },
        tca9548a: { ready: Boolean(payload?.tca_ready) },
        drv2605: { ready: Boolean(payload?.drv2605_ready) },
      },
    },
  };
}

export function markEsp32Disconnected(previous, error) {
  if (previous.hardware?.transport === 'sta') {
    const state = normalizeBilateralState({ service: 'stepon-bilateral-v1', feet: {} }, previous);
    state.hardware.lastError = error?.message ?? 'PC 수집 서버 연결 실패';
    return state;
  }
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

export function normalizeBilateralState(payload, previous) {
  const sides = ['left', 'right'];
  const active = previous.rehab?.config?.activeFoot === 'right' ? 'right' : 'left';
  const blankVector = () => ({ x: null, y: null, z: null });
  const feet = {}, normalized = {};
  for (const side of sides) {
    const foot = payload.feet?.[side] ?? { connected: false, status: 'unregistered' };
    const valid = Boolean(foot.connected && foot.state?.foot_side === side && foot.age_ms !== null && foot.age_ms <= 2000);
    feet[side] = { ...foot, connected: valid };
    if (valid) {
      normalized[side] = normalizeEsp32State(foot.state, { ...previous, imu: { accel: blankVector(), gyro: blankVector() }, imuBySide: {} });
      if (foot.state.pressure_ready === false) normalized[side].pressure = emptyPressure();
    }
  }
  const pressure = Object.fromEntries(sides.map((s) => [s, normalized[s]?.pressure ?? emptyPressure()]));
  const thermal = Object.fromEntries(sides.map((s) => [s, normalized[s]?.thermal[s] ?? emptyThermal()]));
  const imuBySide = Object.fromEntries(sides.map((s) => [s, feet[s].state?.imu_ready && feet[s].connected ? normalized[s]?.imu ?? null : null]));
  const available = sides.filter((s) => feet[s].connected);
  const bothPressure = sides.every((s) => pressure[s].every((v) => typeof v === 'number' && Number.isFinite(v)));
  const total = (values) => values.reduce((a, b) => a + b, 0);
  const left = bothPressure ? total(pressure.left) : 0, right = bothPressure ? total(pressure.right) : 0;
  const rawActive = feet[active].connected ? feet[active].state : {};
  const raw = { ...rawActive, frame: payload.frame ?? previous.tick ?? 0, foot_side: active, pressure_count: 4, pressure_layout: PRESSURE_LAYOUT_ID,
    pressure_channels: pressureChannelsFor(rawActive), bilateral_pressure: pressure, bilateral_available: bothPressure, feet: payload.feet };
  const allThermal = [...thermal.left, ...thermal.right];
  const thermalCount = allThermal.filter((x) => x.available).length;
  const thermalTotal = 8;
  const missingImu = { accel: blankVector(), gyro: blankVector(), freezeBandEnergy: null, locomotorBandEnergy: null };
  return { ...previous, connected: available.length > 0, dataSource: 'esp32', tick: payload.frame ?? previous.tick ?? 0,
    pressure: pressure[active], bilateralPressure: pressure, thermal, imuBySide,
    imu: imuBySide[active] ?? missingImu,
    metrics: { ...previous.metrics, risk: normalized[active]?.metrics.risk ?? null,
      balance: bothPressure && left + right > 0 ? Math.round((1 - Math.abs(left - right) / (left + right)) * 100) : null,
      temperature: average(allThermal.filter((x) => x.available).map((x) => x.temp)), humidity: average(allThermal.filter((x) => x.available).map((x) => x.humidity)),
      cadence: null, stride: null },
    outputs: { ...previous.outputs, laser: Boolean(rawActive.output?.laser), auto: Boolean(rawActive.output?.auto_cue), vibrationActive: Boolean(rawActive.output?.vibration) },
    device: { ...previous.device, name: 'StepOn 양발 · STA', battery: null, lastSync: available.length ? '방금 전' : '연결 대기', signal: `양발 ${available.length}/2 연결` },
    hardware: { source: 'esp32', transport: 'sta', footSide: active, feet, bilateralAvailable: bothPressure,
      sampleHz: 64, auxSampleHz: 20, pressureLayout: PRESSURE_LAYOUT_ID, pressureChannels: pressureChannelsFor(rawActive), thermalChannels: THERMAL_CHANNELS,
      lastError: payload.error ?? null, layoutWarning: null, raw,
      clockNote: 'PC 수신 시각 기준 · 두 보드의 millis는 정밀 동기화되지 않음',
      sensors: { pressure: { ready: pressure[active].every((v) => v !== null), count: sides.reduce((n, s) => n + pressure[s].filter((v) => v !== null).length, 0), total: 8 },
        thermal: { ready: thermalCount > 0, count: thermalCount, total: thermalTotal },
        imu: { ready: Boolean(imuBySide[active]), count: sides.filter((s) => imuBySide[s]).length, total: 2 },
        tca9548a: { ready: Boolean(rawActive.tca_ready) }, drv2605: { ready: Boolean(rawActive.drv2605_ready) } } },
  };
}
