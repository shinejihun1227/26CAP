// Display-only split for physical two-sensor profiles. Never feed this into
// inference, calibration, storage, comparisons, or health/rehab algorithms.
const filters = new Map();
const TAU_MS = [280, 720, 430, 920];

export function sharedSensorDisplayValue(value, mode, side, siteIndex, now = Date.now()) {
  const key = `${mode}:${side}:${siteIndex}`;
  if (!Number.isFinite(value)) { filters.delete(key); return null; }
  const previous = filters.get(key);
  const dt = previous ? Math.max(0, Math.min(5000, now - previous.at)) : 0;
  const alpha = previous ? 1 - Math.exp(-dt / TAU_MS[siteIndex % TAU_MS.length]) : 1;
  const filtered = previous ? previous.value + (value - previous.value) * alpha : value;
  filters.set(key, { value: filtered, at: now });

  if (mode === 'pressure') {
    const scale = siteIndex % 2 === 0 ? 1.025 : 0.975;
    return Math.max(0, Math.min(100, filtered * scale));
  }
  const offset = siteIndex % 2 === 0 ? -0.049 : 0.049;
  const differenceLimit = mode === 'temperature' ? 0.05 : 0.05;
  const delayed = Math.max(value - differenceLimit, Math.min(value + differenceLimit, filtered));
  return Math.max(value - differenceLimit, Math.min(value + differenceLimit, delayed + offset));
}

export function resetSharedSensorDisplayForTests() { filters.clear(); }
