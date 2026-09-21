// Shared contract with firmware/stepon_c3/*/sensor_core*.h.
export const PRESSURE_LAYOUT_ID = 'stepon-pressure-4-v1';
export const REHAB_ALGORITHM_ID = 'web-rehab-rules-pressure4-v2';
export const PRESSURE_CHANNELS = [0, 1, 2, 3];
export const LEGACY_PRESSURE_CHANNELS = [0, 2, 4, 6];
// Both wirings use the same logical site order; retain older boards and records.
export const validPressureChannels = (channels) => [PRESSURE_CHANNELS, LEGACY_PRESSURE_CHANNELS]
  .some((mapping) => Array.isArray(channels) && channels.length === mapping.length && mapping.every((c, i) => channels[i] === c));
export const pressureChannelsFor = (payload) => payload?.pressure_channels === undefined
  ? LEGACY_PRESSURE_CHANNELS : validPressureChannels(payload.pressure_channels) ? payload.pressure_channels : null;
export const THERMAL_CHANNELS = [3, 4, 5, 6];
export const PRESSURE_COUNT = PRESSURE_CHANNELS.length;
export const PRESSURE_SITES = ['앞쪽', '가운데 안쪽', '가운데 바깥쪽', '뒤꿈치'];
export const THERMAL_SITES = ['뒤꿈치', '발바닥 중앙', '앞꿈치', '발가락'];
// Logical order: front, middle medial, middle lateral, heel.
export const PRESSURE_POINTS = {
  left: [[50, 18], [61, 50], [39, 50], [50, 83]],
  right: [[50, 18], [39, 50], [61, 50], [50, 83]],
};
export const PRESSURE_POSITIONS = [[0, .85], [-.65, 0], [.65, 0], [0, -.85]];
export const PRESSURE_ZONES = { toe: [0], forefoot: [0], midfoot: [1, 2], heel: [3], medial: [1], lateral: [2] };
export const emptyPressure = () => Array(PRESSURE_COUNT).fill(null);
export const validPressure = (values) => Array.isArray(values) && values.length === PRESSURE_COUNT && values.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100);
export function pressureContractMatches(payload) {
  return (payload?.pressure_count === undefined || payload.pressure_count === PRESSURE_COUNT)
    && (payload?.pressure_layout === undefined || payload.pressure_layout === PRESSURE_LAYOUT_ID)
    && pressureChannelsFor(payload) !== null;
}
