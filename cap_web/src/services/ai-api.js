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
    if (saved) return trimBaseUrl(saved);
  } catch {
    // Local storage is optional.
  }
  const host = window.location.hostname || "127.0.0.1";
  return `${window.location.protocol}//${host}:8787`;
}

export function saveAiBridgeUrl(value) {
  const url = trimBaseUrl(value);
  try { window.localStorage.setItem(STORAGE_KEY, url); } catch { /* optional */ }
  return url;
}

async function request(path, { timeoutMs = 1200, signal } = {}) {
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

export function markAiUnavailable(previous, error) {
  return {
    ...previous,
    available: false,
    ready: false,
    status: "unavailable",
    lastError: error?.message ?? "AI 브리지 연결 실패",
  };
}

export function normalizeAiState(payload, previous = {}) {
  const score = payload?.fog_score === null || payload?.fog_score === undefined
    ? null
    : Number(payload.fog_score);
  return {
    ...previous,
    available: true,
    ready: Boolean(payload?.detector_loaded && payload?.device_connected),
    status: String(payload?.status ?? "unavailable"),
    state: payload?.state ?? null,
    score: Number.isFinite(score) ? score : null,
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
