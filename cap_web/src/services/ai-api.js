const STORAGE_KEY = "stepon-ai-bridge-url";

function trimBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function getAiBridgeUrl() {
  const query = new URLSearchParams(window.location.search);
  const fromQuery = query.get("aiUrl");
  if (fromQuery) return trimBaseUrl(fromQuery);
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const old = new URL(saved);
      const local = ['127.0.0.1', 'localhost', window.location.hostname].includes(old.hostname);
      if (!(local && old.port === '8787')) return trimBaseUrl(saved);
    }
  } catch {
    // Local storage is optional.
  }
  return window.location.origin;
}

export function saveAiBridgeUrl(value) {
  const url = trimBaseUrl(value);
  try { window.localStorage.setItem(STORAGE_KEY, url); } catch { /* optional */ }
  return url;
}

async function request(path, { timeoutMs = 1800, signal, method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const response = await fetch(`${getAiBridgeUrl()}${path}`, {
      cache: "no-store",
      signal: controller.signal,
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error(`AI bridge HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("AI 브리지 연결 시간 초과");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function fetchAiState(options) {
  return request("/api/ai/state", options);
}

export function fetchAiEvents(options) {
  return request("/api/ai/events", options);
}

export function calibrateAi(side, action = 'start') {
  return request(`/api/ai/calibration/${action}`, { method: 'POST', body: { side }, timeoutMs: 9000 });
}
export function setFogCue(enabled) { return request('/api/ai/cue', { method: 'POST', body: { enabled } }); }

export function markAiUnavailable(previous, error) {
  return {
    ...previous,
    available: false,
    ready: false,
    score: null,
    rawScore: null,
    state: null,
    windowReady: false,
    deviceConnected: false,
    feet: {},
    cue: null,
    status: "unavailable",
    lastError: error?.message ?? "AI 브리지 연결 실패",
  };
}

export function normalizeAiState(payload, previous = {}) {
  if (payload?.service !== 'stepon-ai-bridge') throw new Error('AI 응답 형식이 올바르지 않습니다.');
  const ready = Boolean(payload.detector_loaded && payload.device_connected && payload.window_ready && ['normal', 'warning', 'confirmed'].includes(payload.state));
  const numeric = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
  const rawScore = numeric(payload.fog_score);
  const score = numeric(payload.api_version >= 2 ? payload.decision_score : payload.fog_score);
  return {
    ...previous,
    available: true,
    ready,
    status: String(payload?.status ?? "unavailable"),
    state: ready ? payload.state : null,
    score: ready ? score : null,
    rawScore: ready ? rawScore : null,
    selectedFoot: payload.selected_foot ?? null,
    coverage: payload.coverage ?? 0,
    artifactId: payload.artifact_id ?? null,
    diagnostics: ready ? payload.diagnostics ?? {} : {},
    feet: payload.feet ?? {},
    cue: payload.cue ?? null,
    model: String(payload?.model ?? "ensemble"),
    deviceConnected: Boolean(payload?.device_connected),
    detectorLoaded: Boolean(payload?.detector_loaded),
    windowReady: Boolean(payload?.window_ready),
    windowCount: Number(payload?.window_count ?? 0),
    sampleRateHz: Number(payload?.sample_rate_hz ?? 64),
    windowSec: Number(payload?.window_sec ?? 4),
    hopSec: Number(payload?.hop_sec ?? 0.5),
    calibration: payload?.calibration ?? {},
    lastWindowAtMs: payload?.last_window_at_ms ?? null,
    lastError: payload?.last_error ?? null,
    bridgeUrl: getAiBridgeUrl(),
  };
}
