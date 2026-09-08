export const FOOT_LAYOUT_STORAGE_KEY = "stepon-cap-web-foot-layout-v2";
export const FOOT_LAYOUT_MODES = ["pressure", "temperature", "humidity"];

const DEFAULT_SIDE_LAYOUT = {
  left: { x: -4, y: 0, rotation: 0, scale: 0.92 },
  right: { x: 4, y: 0, rotation: 0, scale: 0.92 },
};

export const DEFAULT_FOOT_LAYOUT = {
  pressure: { left: { ...DEFAULT_SIDE_LAYOUT.left }, right: { ...DEFAULT_SIDE_LAYOUT.right } },
  temperature: { left: { ...DEFAULT_SIDE_LAYOUT.left }, right: { ...DEFAULT_SIDE_LAYOUT.right } },
  humidity: { left: { ...DEFAULT_SIDE_LAYOUT.left }, right: { ...DEFAULT_SIDE_LAYOUT.right } },
};

function numberInRange(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function normalizeFoot(value, fallback) {
  return {
    x: numberInRange(value?.x, fallback.x, -35, 35),
    y: numberInRange(value?.y, fallback.y, -35, 35),
    rotation: numberInRange(value?.rotation, fallback.rotation, -30, 30),
    scale: numberInRange(value?.scale, fallback.scale, 0.55, 1.35),
  };
}

export function normalizeFootLayout(layout) {
  const legacyLayout = layout?.left && layout?.right ? layout : null;
  return Object.fromEntries(FOOT_LAYOUT_MODES.map((mode) => {
    const source = layout?.[mode] ?? legacyLayout ?? {};
    const fallback = DEFAULT_FOOT_LAYOUT[mode];
    return [mode, {
      left: normalizeFoot(source.left, fallback.left),
      right: normalizeFoot(source.right, fallback.right),
    }];
  }));
}

export function loadFootLayout() {
  try {
    const savedRaw = window.localStorage.getItem(FOOT_LAYOUT_STORAGE_KEY)
      ?? window.localStorage.getItem("stepon-cap-web-foot-layout-v1");
    const saved = JSON.parse(savedRaw ?? "null");
    return normalizeFootLayout(saved);
  } catch {
    return normalizeFootLayout(DEFAULT_FOOT_LAYOUT);
  }
}

export function persistFootLayout(layout) {
  const normalized = normalizeFootLayout(layout);
  try {
    window.localStorage.setItem(FOOT_LAYOUT_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // The editor remains usable when browser storage is unavailable.
  }
  return normalized;
}

export function footLayoutStyle(mode, side, layout) {
  const normalized = normalizeFootLayout(layout);
  const foot = normalized[mode]?.[side] ?? DEFAULT_FOOT_LAYOUT[mode]?.[side] ?? DEFAULT_SIDE_LAYOUT[side];
  return `--foot-x:${foot.x}%;--foot-y:${foot.y}%;--foot-rotation:${foot.rotation}deg;--foot-scale:${foot.scale};`;
}
