// One collector on 8000; browsers and 8001 only read its cache.
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { PRESSURE_LAYOUT_ID, validPressureChannels, THERMAL_CHANNELS } from '../src/data/sensor-config.js';
export const SIDES = ['left', 'right'];
export const HUB_SERVICE = 'stepon-bilateral-v1';
const STA_FIRMWARES = new Set(['04_sta_bilateral', '04_2_sta_bilateral_wroom']);
const cleanIp = (value = '') => value.replace(/^::ffff:/, '');
const localIp = (ip, loopback = false) => {
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (loopback && a === 127);
};
export function validateDeviceUrl(value, loopback = false) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !localIp(url.hostname, loopback) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('private_ipv4_http_url_required');
  return url.origin;
}
const identity = (v) => typeof v === 'string' && /^[a-zA-Z0-9:_-]{1,64}$/.test(v);
const vector = (v) => ['x', 'y', 'z'].every((k) => typeof v?.[k] === 'number' && Number.isFinite(v[k]));
export function validateFrame(p, side, deviceId) {
  if (!p || p.foot_side !== side) throw new Error('foot_side_mismatch');
  if (!identity(p.device_id) || (deviceId && p.device_id !== deviceId)) throw new Error('device_id_mismatch');
  if (!STA_FIRMWARES.has(p.firmware) || p.wifi_mode !== 'STA' || !identity(p.boot_id)) throw new Error('sta_firmware_required');
  if (!Number.isInteger(p.frame) || p.frame < 0 || !Number.isFinite(p.millis)) throw new Error('invalid_frame_clock');
  if (p.pressure_count !== 4 || p.pressure_layout !== PRESSURE_LAYOUT_ID || !validPressureChannels(p.pressure_channels)) throw new Error('pressure_layout_mismatch');
  if (!Array.isArray(p.pressure) || p.pressure.length !== 4 || !p.pressure.every((v) => Number.isFinite(v) && v >= 0 && v <= 100)) throw new Error('invalid_pressure');
  if (JSON.stringify(p.shtc3_channels) !== JSON.stringify(THERMAL_CHANNELS) || !['temperature', 'humidity', 'shtc3_ready'].every((k) => Array.isArray(p[k]) && p[k].length === 4)) throw new Error('thermal_layout_mismatch');
  if (p.imu_ready && (!vector(p.accel) || !vector(p.gyro))) throw new Error('invalid_imu');
  return p;
}
export function createInsoleHub({ pollIntervalMs = 1000 / 64, timeoutMs = 600, staleMs = 2000, now = Date.now, fetchImpl = fetch, allowLoopback = false } = {}) {
  const devices = new Map();
  const streamId = randomUUID();
  const sampleHistory = [];
  let sampleCursor = 0;
  let revision = 0, stopped = false;
  const fresh = (d) => Boolean(d?.payload && !d.error && d.advancedAt !== null && now() - d.advancedAt <= staleMs);
  async function readJson(url, options = {}) {
    const response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    if (!response.ok) throw new Error(`device_http_${response.status}`);
    if (Number(response.headers?.get('content-length')) > 65536) throw new Error('device_response_too_large');
    let body = '';
    for await (const chunk of response.body) {
      body += Buffer.from(chunk).toString('utf8');
      if (body.length > 65536) throw new Error('device_response_too_large');
    }
    return JSON.parse(body);
  }
  async function poll(d) {
    if (stopped || devices.get(d.side) !== d || d.inFlight) return;
    d.inFlight = true;
    const started = now();
    try {
      const p = validateFrame(await readJson(`${d.url}/api/state`), d.side, d.deviceId);
      if (devices.get(d.side) !== d || stopped) return;
      const bootChanged = d.payload && p.boot_id !== d.payload.boot_id;
      if (bootChanged) { d.restarts++; d.rateFrames = 0; d.rateAt = now(); d.missed = 0; }
      if (!d.payload || bootChanged || p.frame !== d.payload.frame) {
        if (d.payload && !bootChanged) {
          const delta = (p.frame - d.payload.frame) >>> 0;
          if (delta > 0x7fffffff) throw new Error('frame_clock_regressed');
          d.missed += Math.max(0, delta - 1);
        }
        d.advancedAt = now(); d.rateFrames++; revision++;
        sampleHistory.push({ cursor: ++sampleCursor, received_at_ms: now(), side: d.side, state: p });
        // Keep every distinct collected frame so inference does not depend on UI polling.
        if (sampleHistory.length > 4096) sampleHistory.splice(0, sampleHistory.length - 4096);
      }
      d.deviceId = p.device_id; d.payload = p; d.receivedAt = now(); d.error = null;
      if (now() - d.rateAt >= 1000) {
        d.receivedHz = Number((d.rateFrames * 1000 / (now() - d.rateAt)).toFixed(1));
        d.rateAt = now(); d.rateFrames = 0;
      }
    } catch (error) {
      if (devices.get(d.side) === d && !stopped) { d.error = error.name === 'TimeoutError' ? 'device_timeout' : error.message; revision++; }
    } finally {
      d.inFlight = false;
      if (!stopped && devices.get(d.side) === d) {
        d.timer = setTimeout(() => void poll(d), d.error ? 1000 : Math.max(1, pollIntervalMs - (now() - started)));
        d.timer.unref?.();
      }
    }
  }
  function register({ side, deviceId = null, url, automatic = false }) {
    if (!SIDES.includes(side) || (deviceId !== null && !identity(deviceId))) throw new Error('invalid_device_identity');
    if (automatic && !identity(deviceId)) throw new Error('invalid_device_identity');
    const checkedUrl = validateDeviceUrl(url, allowLoopback), old = devices.get(side);
    if (automatic && old && old.deviceId && old.deviceId !== deviceId) throw new Error('side_already_assigned');
    if (automatic && old && old.url !== checkedUrl && fresh(old)) throw new Error('side_address_conflict');
    if (SIDES.some((s) => s !== side && (devices.get(s)?.url === checkedUrl || (deviceId && devices.get(s)?.deviceId === deviceId)))) throw new Error('duplicate_device');
    if (old?.url === checkedUrl && (!deviceId || !old.deviceId || old.deviceId === deviceId)) return;
    if (old) clearTimeout(old.timer);
    const d = { side, deviceId, url: checkedUrl, payload: null, receivedAt: null, advancedAt: null, error: null, missed: 0, restarts: 0, receivedHz: 0, rateFrames: 0, rateAt: now() };
    devices.set(side, d); revision++; void poll(d);
  }
  function forget(side) {
    if (!SIDES.includes(side)) throw new Error('invalid_side');
    clearTimeout(devices.get(side)?.timer); devices.delete(side); revision++;
  }
  function snapshot() {
    const feet = Object.fromEntries(SIDES.map((side) => {
      const d = devices.get(side), connected = fresh(d);
      return [side, { side, connected, status: !d ? 'unregistered' : d.error ? 'error' : !d.payload ? 'connecting' : connected ? 'online' : 'stale',
        base_url: d?.url ?? '', device_id: d?.deviceId ?? null, received_at_ms: d?.receivedAt ?? null, advanced_at_ms: d?.advancedAt ?? null,
        age_ms: d?.advancedAt === null || !d ? null : Math.max(0, now() - d.advancedAt),
        received_hz: connected ? d.receivedHz : 0, missed_frames: d?.missed ?? 0, restarts: d?.restarts ?? 0,
        last_error: d?.error ?? null, state: connected ? d.payload : null }];
    }));
    return { service: HUB_SERVICE, frame: revision, server_time_ms: now(), poll_target_hz: 1000 / pollIntervalMs, connected: SIDES.some((s) => feet[s].connected), bilateral_available: SIDES.every((s) => feet[s].connected), clock_basis: 'pc_receive_time_not_hardware_synchronized', feet };
  }
  async function command(side, action, value) {
    const d = devices.get(side);
    if (!SIDES.includes(side) || !fresh(d)) throw new Error('selected_foot_offline');
    const paths = { laser: `/api/laser?on=${value === true ? 1 : 0}`, vibrate: '/api/vibrate?effect=47', 'auto-cue': `/api/auto-cue?enabled=${value === true ? 1 : 0}` };
    if (!Object.hasOwn(paths, action)) throw new Error('invalid_action');
    return readJson(d.url + paths[action]);
  }
  function samples(after = 0, limit = 512) {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1024) throw new Error('invalid_sample_cursor');
    const oldest = sampleHistory[0]?.cursor ?? sampleCursor + 1;
    const lost = after < oldest - 1 || after > sampleCursor;
    const rows = sampleHistory.filter((s) => s.cursor > (after > sampleCursor ? 0 : after)).slice(0, limit);
    return { ...snapshot(), stream_id: streamId, samples: rows, dropped: lost,
      next_cursor: rows.at(-1)?.cursor ?? sampleCursor, latest_cursor: sampleCursor };
  }
  return { register, forget, snapshot, samples, command, stop() { stopped = true; for (const d of devices.values()) clearTimeout(d.timer); } };
}
function reply(res, code, body) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
async function jsonBody(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 4096) throw new Error('body_too_large'); }
  return JSON.parse(text || '{}');
}
export function createInsoleHandler(hub) {
  return async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && pathname === '/api/insoles/samples') {
        const query = new URL(req.url, 'http://localhost').searchParams;
        return reply(res, 200, hub.samples(Number(query.get('after') ?? 0), Number(query.get('limit') ?? 512)));
      }
      if (req.method === 'GET' && pathname === '/api/insoles/state') return reply(res, 200, hub.snapshot());
      if (req.method === 'GET' && /^\/api\/insoles\/(left|right)\/api\/state$/.test(pathname)) {
        const foot = hub.snapshot().feet[pathname.split('/')[3]];
        return reply(res, foot.connected ? 200 : 503, foot.state ?? { error: 'foot_offline' });
      }
      if (req.method !== 'POST') return reply(res, 405, { error: 'method_not_allowed' });
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return reply(res, 403, { error: 'cross_origin_write_denied' });
      if (!String(req.headers['content-type']).startsWith('application/json')) return reply(res, 415, { error: 'json_required' });
      const body = await jsonBody(req);
      if (pathname === '/api/insoles/register') {
        if (!STA_FIRMWARES.has(body.firmware)) throw new Error('sta_firmware_required');
        hub.register({ side: body.foot_side, deviceId: body.device_id, url: `http://${cleanIp(req.socket.remoteAddress)}`, automatic: true });
        return reply(res, 200, { ok: true });
      }
      if (pathname === '/api/insoles/config') hub.register({ side: body.side, url: body.url });
      else if (pathname === '/api/insoles/forget') hub.forget(body.side);
      else if (pathname === '/api/insoles/command') return reply(res, 200, await hub.command(body.side, body.action, body.value));
      else return reply(res, 404, { error: 'not_found' });
      reply(res, 200, hub.snapshot());
    } catch (error) { reply(res, 400, { error: error.message }); }
  };
}
export async function forwardInsoleRequest(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname + url.search;
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return reply(res, 403, { error: 'cross_origin_write_denied' });
    const body = req.method === 'POST' ? JSON.stringify(await jsonBody(req)) : undefined;
    const response = await fetch(`http://127.0.0.1:8000${pathname}`, { method: req.method, headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(1800) });
    reply(res, response.status, await response.json());
  } catch { reply(res, 503, { error: 'start_port_8000_first' }); }
}
