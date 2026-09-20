// Preserve reading and keyboard position across same-screen sensor refreshes.
const disclosureSelector = 'details[data-ui-disclosure]';
const buttonSelector = 'button[data-view], button[data-action]';

export function captureViewContinuity(root) {
  const disclosures = [...root.querySelectorAll(disclosureSelector)];
  const open = disclosures.filter((el) => el.open).map((el) => el.dataset.uiDisclosure);
  const active = root.ownerDocument.activeElement;
  let focus = null;
  if (root.contains(active)) {
    const detail = disclosures.find((el) => el.querySelector('summary') === active);
    if (detail) focus = { disclosure: detail.dataset.uiDisclosure };
    else if (active.matches(buttonSelector)) {
      const attribute = active.hasAttribute('data-view') ? 'data-view' : 'data-action';
      const value = active.getAttribute(attribute);
      const peers = [...root.querySelectorAll(buttonSelector)].filter((el) => el.getAttribute(attribute) === value);
      focus = { attribute, value, index: peers.indexOf(active) };
    }
  }
  return { open, focus };
}

export function restoreViewContinuity(root, saved) {
  if (!saved) return;
  const disclosures = [...root.querySelectorAll(disclosureSelector)];
  for (const el of disclosures) el.open = saved.open.includes(el.dataset.uiDisclosure);
  const focus = saved.focus;
  if (!focus) return;
  const target = focus.disclosure
    ? disclosures.find((el) => el.dataset.uiDisclosure === focus.disclosure)?.querySelector('summary')
    : [...root.querySelectorAll(buttonSelector)].filter((el) => el.getAttribute(focus.attribute) === focus.value)[focus.index];
  target?.focus({ preventScroll: true });
}
