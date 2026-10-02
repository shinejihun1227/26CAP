import { pressureContractMatches, sensorProfileFor, validPressure } from './sensor-config.js';

// Physical channels (walking-peak normalized when available), never duplicated display sites.
export function pressureCenter(raw) {
  if (!raw || raw.pressure_ready === false || !pressureContractMatches(raw) || !validPressure(raw.pressure)) return null;
  const p = raw.pressure, shared = sensorProfileFor(raw) === 'two-shared';
  const total = shared ? p[0] + p[2] : p.reduce((sum, n) => sum + n, 0);
  if (total < (shared ? 4 : 8)) return null;
  const position = shared ? p[0] / total : (p[0] + (p[1] + p[2]) / 2) / total;
  return { position, shared };
}
