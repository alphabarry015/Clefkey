/**
 * Vue Audit — vérification de compromission (mot de passe ou e-mail).
 *
 * La logique réseau est partagée avec la landing page via `breach-check.js`.
 */

import { bindBreachWidget } from './breach-check.js';

export function createAudit(deps) {
  const { $, refreshIcons } = deps;

  let bound = false;

  function bindAudit() {
    if (bound) return;

    const view = $('#audit-view');
    if (!view) return;

    const widget = bindBreachWidget(view, {
      form: '#audit-form',
      input: '#audit-input',
      result: '#audit-result',
      tabs: '[data-breach-mode]',
      toggle: '#audit-toggle',
      privacy: '#audit-info-popover',
    });
    if (!widget) return;

    const infoBtn = $('#audit-info-btn');
    const infoPopover = $('#audit-info-popover');
    if (infoBtn && infoPopover) {
      infoBtn.addEventListener('click', () => {
        const isOpen = !infoPopover.hidden;
        infoPopover.hidden = isOpen;
        infoBtn.setAttribute('aria-expanded', String(!isOpen));
      });
      document.addEventListener('click', (event) => {
        if (infoPopover.hidden) return;
        if (infoBtn.contains(event.target) || infoPopover.contains(event.target)) return;
        infoPopover.hidden = true;
        infoBtn.setAttribute('aria-expanded', 'false');
      });
    }

    bound = true;
  }

  function renderAudit() {
    bindAudit();
    const view = $('#audit-view');
    if (view) refreshIcons(view);
  }

  return { renderAudit };
}
