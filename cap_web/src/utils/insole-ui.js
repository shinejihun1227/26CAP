// Keep native selects and both IP forms mounted while the user interacts.
export function isEditingInsole(root) {
  const active = root.ownerDocument.activeElement;
  return Boolean(root.contains(active) && active?.closest('[data-insole-controls]'));
}

export function captureInsoleControls(root) {
  const active = root.ownerDocument.activeElement;
  const forms = [...root.querySelectorAll('[data-insole-form]')].map((form) => {
    const input = form.elements.namedItem('url');
    return { side: form.dataset.insoleForm, draft: input.value !== input.defaultValue ? input.value : null };
  });
  const open = [...root.querySelectorAll('[data-insole-card] details[open]')]
    .map((el) => el.closest('[data-insole-card]').dataset.insoleCard);
  let focus = null;
  if (root.contains(active)) {
    if (active.matches('[data-rehab-setting="activeFoot"]')) focus = { kind: 'foot' };
    else {
      const side = active.closest('[data-insole-card]')?.dataset.insoleCard;
      if (side && active.matches('input[name="url"]')) focus = { side, kind: 'url' };
      else if (side && active.matches('summary')) focus = { side, kind: 'summary' };
    }
  }
  return { forms, open, focus };
}

export function restoreInsoleControls(root, saved) {
  if (!saved) return;
  for (const { side, draft } of saved.forms) {
    const input = root.querySelector(`[data-insole-form="${side}"] input[name="url"]`);
    if (input && draft !== null) input.value = draft;
  }
  for (const details of root.querySelectorAll('[data-insole-card] details')) {
    details.open = saved.open.includes(details.closest('[data-insole-card]').dataset.insoleCard);
  }
  const focus = saved.focus;
  if (!focus) return;
  const selector = focus.kind === 'foot' ? '[data-rehab-setting="activeFoot"]'
    : `[data-insole-card="${focus.side}"] ${focus.kind === 'url' ? 'input[name="url"]' : 'summary'}`;
  root.querySelector(selector)?.focus({ preventScroll: true });
}
