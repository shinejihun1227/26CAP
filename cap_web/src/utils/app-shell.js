// Preserve navigation nodes while sensor polling updates the page content.
export function syncLiveNode(current, next) {
  if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) { current.replaceWith(next); return; }
  if (current.nodeType === 3 || current.nodeType === 8) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }
  for (const attribute of [...current.attributes]) if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  for (const attribute of [...next.attributes]) if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
  const oldChildren = [...current.childNodes], newChildren = [...next.childNodes];
  for (let index = 0; index < newChildren.length; index++) {
    if (oldChildren[index]) syncLiveNode(oldChildren[index], newChildren[index]);
    else current.appendChild(newChildren[index]);
  }
  for (let index = newChildren.length; index < oldChildren.length; index++) oldChildren[index].remove();
}

export function updateAppShell(root, markup, mobile, sameView = false) {
  const template = root.ownerDocument.createElement('template');
  template.innerHTML = markup;
  const shell = mobile ? '.mobile-app' : '.app-frame';
  const content = mobile ? '.mobile-main' : '.page-shell';
  const current = root.querySelector(shell), next = template.content.querySelector(shell);
  if (!current || !next || !current.querySelector(content) || !next.querySelector(content)) {
    root.innerHTML = markup;
    return;
  }
  if (sameView) syncLiveNode(current.querySelector(content), next.querySelector(content));
  else current.querySelector(content).replaceWith(next.querySelector(content));
  const navs = mobile ? ['.mobile-management', '.mobile-tabbar'] : ['.sidebar'];
  for (const selector of navs) {
    const nav = current.querySelector(selector), newNav = next.querySelector(selector);
    for (const [index, button] of [...(nav?.querySelectorAll('[data-view]') ?? [])].entries()) {
      const peer = newNav?.querySelectorAll('[data-view]')[index];
      if (!peer) continue;
      button.className = peer.className;
      if (peer.hasAttribute('aria-current')) button.setAttribute('aria-current', peer.getAttribute('aria-current'));
      else button.removeAttribute('aria-current');
    }
  }
  const status = mobile ? '.simple-mobile-header > span' : '.sidebar-footer';
  const oldStatus = current.querySelector(status), newStatus = next.querySelector(status);
  if (oldStatus && newStatus && oldStatus.outerHTML !== newStatus.outerHTML) oldStatus.replaceWith(newStatus);
}
