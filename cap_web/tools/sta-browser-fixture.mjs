// Browser-only integration fixture. Never used by run.bat. All sensor fetches
// below are intercepted before networking; no ESP32 or actuator is contacted.
import http from 'node:http';
const realFetch = globalThis.fetch;
const state = { left: { mode: 'on', frame: 0, boot: 1 }, right: { mode: 'on', frame: 0, boot: 1 } };
const sensor = (side) => {
  const d = state[side]; if (d.mode === 'off') throw new Error('SIMULATED_disconnect');
  if (d.mode !== 'frozen') d.frame++;
  return { firmware: '04_sta_bilateral', wifi_mode: 'STA', device_id: `SIMULATED-${side}`, boot_id: `boot-${d.boot}`, foot_side: side, frame: d.frame, millis: d.frame * 16,
    pressure_ready: true, pressure_count: 4, pressure_layout: 'stepon-pressure-4-v1', pressure_channels: [0, 2, 4, 6], pressure: side === 'left' ? [12, 25, 70, 85] : [90, 60, 30, 15],
    temperature: side === 'left' ? [30, 31, 32, 33] : [34, 35, 36, 37], humidity: [40, 50, 60, 70], shtc3_ready: [true, true, true, true], shtc3_channels: [3, 4, 5, 6],
    imu_ready: true, tca_ready: true, drv2605_ready: false, actual_sample_hz: 64, accel: { x: side === 'left' ? 1 : 2, y: 0, z: 1 }, gyro: { x: 0, y: 0, z: 3 } };
};
globalThis.fetch = async (url, options) => {
  const u = new URL(typeof url === 'string' ? url : url.url);
  if (u.hostname === '10.255.255.1' || u.hostname === '10.255.255.2') return new Response(JSON.stringify(sensor(u.hostname.endsWith('.1') ? 'left' : 'right')));
  return realFetch(url, options);
};
process.argv[2] = '8120'; process.argv[3] = '127.0.0.1';
await import('../dev-server.mjs');
for (const [side, last] of [['left', 1], ['right', 2]]) {
  await realFetch('http://127.0.0.1:8120/api/insoles/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ side, url: `http://10.255.255.${last}` }) });
}
http.createServer((req, res) => {
  const q = new URL(req.url, 'http://localhost').searchParams;
  for (const side of ['left', 'right']) if (q.has(side)) { const mode = q.get(side); if (mode === 'restart') { state[side].boot++; state[side].frame = 0; state[side].mode = 'on'; } else if (['on', 'off', 'frozen'].includes(mode)) state[side].mode = mode; }
  res.end(JSON.stringify(state));
}).listen(8121, '127.0.0.1');
console.log('SIMULATED DEVICES ONLY: browser 8120, test control 8121. Ctrl+C stops this fixture.');
