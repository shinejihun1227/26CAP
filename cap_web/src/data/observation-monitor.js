import { pressureContractMatches, validPressure, PRESSURE_SITES } from './sensor-config.js';

export const OBSERVATION_WINDOW_MS = 30 * 60 * 1000;
const MAX_GAP_MS = 2500;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const fresh = (at, now) => finite(at) && now >= at && now - at <= MAX_GAP_MS;
const mean = values => values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
const sides = ['left', 'right'];
const sites = ['heel', 'arch', 'forefoot', 'toe'];

export function readObservationFeet(state, now = Date.now()) {
  const usable = state.dataSource === 'esp32' && state.connected && !state.paused && fresh(state.sensorReceivedAt, now);
  return Object.fromEntries(sides.map(side => {
    const hw = state.hardware ?? {}, foot = hw.feet?.[side];
    const connected = usable && (hw.transport === 'sta'
      ? foot?.connected && foot.state?.foot_side === side && finite(foot.age_ms) && foot.age_ms >= 0 && foot.age_ms + now - state.sensorReceivedAt <= MAX_GAP_MS
      : fresh(state.sensorAdvancedAt, now) && (hw.footSide === side || hw.bilateralAvailable));
    const raw = hw.transport === 'sta' ? foot?.state : hw.raw;
    const pressureRaw = hw.transport === 'sta' ? raw?.pressure : raw?.bilateral_pressure?.[side] ?? (hw.footSide === side ? raw?.pressure : null);
    const pressure = connected && raw?.pressure_ready !== false && pressureContractMatches(raw) && validPressure(pressureRaw) ? [...pressureRaw] : null;
    const readings = connected ? (state.thermal?.[side] ?? []).filter(p => p.available && sites.includes(p.site)) : [];
    const temperatures = readings.filter(p => finite(p.temp) && p.temp > -40 && p.temp <= 100);
    const humidities = readings.filter(p => finite(p.humidity) && p.humidity >= 0 && p.humidity <= 100);
    const total = pressure?.reduce((sum, n) => sum + n, 0) ?? 0;
    const maximum = pressure ? Math.max(...pressure) : null;
    const peakIndex = pressure?.indexOf(maximum) ?? -1;
    return [side, { connected: Boolean(connected), temperature: mean(temperatures.map(p => p.temp)), humidity: mean(humidities.map(p => p.humidity)),
      pressure: pressure ? mean(pressure) : null, channels: pressure, temperatures, humidities,
      temperatureKey: temperatures.map(p => p.site).sort().join(','), humidityKey: humidities.map(p => p.site).sort().join(','),
      pressureKey: JSON.stringify([raw?.pressure_layout, raw?.pressure_channels]),
      peak: total > 0 ? { site: PRESSURE_SITES[peakIndex], share: maximum / total * 100 } : null,
      frame: connected ? `${raw?.device_id ?? ''}:${raw?.boot_id ?? ''}:${raw?.frame ?? ''}` : null }];
  }));
}

export function pairedDifference(feet, metric) {
  const property = metric === 'humidity' ? 'humidities' : 'temperatures', field = metric === 'humidity' ? 'humidity' : 'temp';
  const right = new Map((feet.right?.[property] ?? []).map(p => [p.site, p[field]]));
  const differences = (feet.left?.[property] ?? []).filter(p => right.has(p.site)).map(p => right.get(p.site) - p[field]);
  return { value: mean(differences), count: differences.length };
}

export function readFogObservation(state, now = Date.now()) {
  const ai = state.ai ?? {};
  const valid = state.dataSource === 'esp32' && state.connected && !state.paused && state.aiEnabled !== false
    && ai.available && ai.ready && ai.windowReady && ai.deviceConnected && fresh(ai.lastWindowAtMs, now)
    && ['normal', 'warning', 'confirmed'].includes(ai.state);
  if (!valid) return null;
  // A model, calibration or device restart separates observations. Selecting another
  // foot as the most severe result alone must not duplicate a bilateral episode.
  const key = JSON.stringify([ai.artifactId, ai.model, Object.keys(ai.feet ?? {}).length
    ? sides.map(side => ai.feet?.[side]?.calibration?.id ?? null) : ai.calibration?.id,
  sides.map(side => [state.hardware?.feet?.[side]?.device_id, state.hardware?.feet?.[side]?.state?.boot_id])]);
  return { at: ai.lastWindowAtMs, state: ai.state, side: ai.selectedFoot, key };
}

export function createObservationMonitor() {
  let points = [], events = [], windows = [], previous = null, active = null, lastSensorAt = -Infinity;
  const lastFrames = {};
  const close = interrupted => { if (active) { active.open = false; active.interrupted = interrupted; active = null; } };
  return {
    observeAi(state, now = Date.now()) {
      const current = readFogObservation(state, now);
      if (!current) { close(true); previous = null; return; }
      if (previous && current.at === previous.at && current.key === previous.key && current.state === previous.state) return;
      const continuous = previous && current.key === previous.key && current.at > previous.at && current.at - previous.at <= MAX_GAP_MS;
      if (!continuous) close(true);
      if (current.state === 'confirmed') {
        if (!active) { active = { start: current.at, end: current.at, open: true, partialStart: !continuous, interrupted: false, sides: [] }; events.push(active); }
        active.end = current.at;
        if (current.side && !active.sides.includes(current.side)) active.sides.push(current.side);
      } else if (active) { active.end = current.at; close(false); }
      windows.push({ at: current.at, from: continuous ? previous.at : current.at });
      previous = current;
      events = events.filter(event => event.end >= now - OBSERVATION_WINDOW_MS);
      windows = windows.filter(window => window.at >= now - OBSERVATION_WINDOW_MS);
    },
    observeSensors(state, now = Date.now()) {
      if (now - lastSensorAt < 900) return;
      const feet = readObservationFeet(state, now);
      for (const side of sides) {
        if (feet[side].frame === null || lastFrames[side] === feet[side].frame) {
          feet[side] = { ...feet[side], temperature: null, humidity: null, pressure: null };
        } else lastFrames[side] = feet[side].frame;
      }
      points.push({ at: now, ...feet }); lastSensorAt = now;
      points = points.filter(point => point.at >= now - OBSERVATION_WINDOW_MS);
    },
    interrupt() { close(true); previous = null; },
    snapshot() { return { points, events, windows }; },
  };
}

export function summarizeFog(observation, from, to) {
  const events = (observation.events ?? []).filter(event => event.end >= from && event.start <= to).map(event => ({ ...event,
    duration: Math.max(0, Math.min(event.end, to) - Math.max(event.start, from)) / 1000,
    clipped: event.start < from,
  }));
  const windows = (observation.windows ?? []).filter(window => window.at >= from && window.at <= to);
  const observedSeconds = windows.reduce((sum, window) => sum + Math.max(0, Math.min(window.at, to) - Math.max(window.from, from)) / 1000, 0);
  return { events, hasData: windows.length > 0, observedSeconds, count: windows.length ? events.length : null,
    total: windows.length ? events.reduce((sum, event) => sum + event.duration, 0) : null,
    longest: windows.length ? Math.max(0, ...events.map(event => event.duration)) : null };
}
