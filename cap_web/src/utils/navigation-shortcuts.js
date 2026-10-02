// Navigation never starts a capture. It only reveals the requested setup controls.
export function openNavigationShortcut(root, view, data) {
  let target = null;
  if (view === 'devices' && data.openDisclosure === 'device-baselines') {
    target = root.querySelector('[data-ui-disclosure="device-baselines"]');
    if (target) target.open = true;
  }
  if (view === 'ankle' && ['left','right'].includes(data.dailyFocus)) {
    target = root.querySelector(`[data-daily-side="${data.dailyFocus}"]`);
  }
  if (!target) return false;
  target.scrollIntoView({ block: 'start', behavior: 'instant' });
  const focusTarget = target.querySelector('summary, button');
  focusTarget?.focus({ preventScroll: true });
  return true;
}
