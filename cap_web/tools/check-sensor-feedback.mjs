// Explicit opt-in smoke check. Synthetic examples stay in this process and are
// never sent to the running insole hub or stored as the user's observations.
import fs from 'node:fs/promises';
import { createSensorFeedback } from '../server/sensor-feedback.mjs';
import { todayState } from '../tests/fixtures/today-state.mjs';
const at = Date.now();
let time = at - 3100;
const event = { id: 'example-rom-right', side: 'right', at: at - 2000, endedAt: at, peak: 34.2, threshold: 30, sensorX: -24.2, sensorY: 24.2 };
const service = createSensorFeedback({ ankleDaily: { snapshot: () => ({ events: [event] }) }, now: () => time });
const raw = todayState().hardware.feet.left.state;
for (let frame = 0; frame <= 31; frame++) {
  service.observe('left', { ...raw, pressure: [90,90,10,10], device_id: 'example-left', boot_id: 'example-boot', frame,
    imu_ready: true, accel: { x: 0, y: 0, z: 1 }, gyro: { x: 0, y: 0, z: 0 } });
  time += 100;
}
const data = service.snapshot(), requests = {};
for (const { kind, side, evidence } of data.entries.filter(e => e.evidence)) {
  const result = await service.generate({ kind, side, eventId: evidence.id });
  if (result.status !== 200) throw Error(JSON.stringify(result));
  requests[`${kind}-${side}`] = { eventId: evidence.id, result };
  console.log(`${kind}/${side}: ${result.model} -> ${result.actionIds.join(', ')}`);
}
await fs.writeFile(new URL('../tests/fixtures/sensor-feedback-result.json', import.meta.url), JSON.stringify({ exampleOnly: true, data, requests }, null, 2));
console.log('Example-only preview saved; real sensor observations were not changed.');
