// A polling render must not remove a control between pointerdown and click,
// or between keydown and the browser's keyboard-generated click.
export function createInteractionGuard(root, onIdle, host = window) {
  let held = false, pending = false, releaseTimer;
  const interactive = target => target?.closest?.('button, a, input, select, textarea, summary, [role="button"], [contenteditable="true"]');
  const begin = event => {
    if (!root.contains(event.target) || !interactive(event.target)) return;
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    host.clearTimeout(releaseTimer);
    held = true;
  };
  const release = () => {
    // Click/default actions finish before the queued polling render.
    host.clearTimeout(releaseTimer);
    releaseTimer = host.setTimeout(() => {
      held = false;
      if (pending) { pending = false; onIdle(); }
    }, 0);
  };
  root.addEventListener('pointerdown', begin, true);
  root.addEventListener('keydown', begin, true);
  for (const event of ['pointerup', 'pointercancel', 'keyup', 'click', 'blur']) host.addEventListener(event, release, true);
  return {
    defer() { if (held) pending = true; return held; },
    destroy() {
      host.clearTimeout(releaseTimer);
      root.removeEventListener('pointerdown', begin, true);
      root.removeEventListener('keydown', begin, true);
      for (const event of ['pointerup', 'pointercancel', 'keyup', 'click', 'blur']) host.removeEventListener(event, release, true);
    },
  };
}
