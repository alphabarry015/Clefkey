import { createIcons, icons } from 'https://esm.sh/lucide@0.468.0';

const defaultAttrs = {
  'stroke-width': 1.75,
  'aria-hidden': 'true',
};

export function refreshIcons(root = document.body) {
  createIcons({
    icons,
    nameAttr: 'data-lucide',
    attrs: defaultAttrs,
    root,
  });
}

export function setLucideIcon(el, name) {
  if (!el) return null;

  if (el.classList?.contains('lucide')) {
    const newIcon = document.createElement('i');
    newIcon.setAttribute('data-lucide', name);
    el.replaceWith(newIcon);
    refreshIcons(newIcon.parentElement || document.body);
    return newIcon;
  }

  el.setAttribute('data-lucide', name);
  refreshIcons(el.parentElement || document.body);
  return el;
}

export function initIcons() {
  refreshIcons();

  document.querySelectorAll('.btn-eye').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      const icon = btn.querySelector('[data-lucide], .lucide');
      setLucideIcon(icon, isPassword ? 'eye-off' : 'eye');
    });
  });
}
