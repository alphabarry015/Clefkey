/**
 * Thème Clefkey. — interrupteur clair / sombre.
 * Le mode système est détecté en arrière-plan (défaut + suivi OS).
 */

export const THEME_STORAGE_KEY = 'clefkey_theme';
export const THEME_CHOICES = ['light', 'system', 'dark'];
export const THEME_UI_CHOICES = ['light', 'dark'];

const LABELS = {
  light: 'Clair',
  dark: 'Sombre',
};

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function getThemePreference() {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (THEME_CHOICES.includes(raw)) return raw;
  } catch {
    /* ignore */
  }
  return 'system';
}

export function resolveTheme(pref = getThemePreference()) {
  if (pref === 'light' || pref === 'dark') return pref;
  return systemPrefersDark() ? 'dark' : 'light';
}

function updateThemeColorMeta(resolved) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#000000' : '#f0f2f7');
}

export function applyTheme(pref = getThemePreference()) {
  const resolved = resolveTheme(pref);
  document.documentElement.setAttribute('data-theme-pref', pref);
  document.documentElement.setAttribute('data-theme', resolved);
  updateThemeColorMeta(resolved);

  // L’UI n’affiche que clair/sombre : on positionne sur le thème résolu.
  document.querySelectorAll('.theme-switch').forEach((el) => {
    el.dataset.active = resolved;
    el.querySelectorAll('[data-theme-choice]').forEach((btn) => {
      const on = btn.getAttribute('data-theme-choice') === resolved;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  });

  return resolved;
}

export function setThemePreference(pref) {
  const next = THEME_UI_CHOICES.includes(pref) || pref === 'system' ? pref : 'system';
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  return applyTheme(next);
}

/** Marquage HTML : uniquement clair / sombre (système en arrière-plan). */
export function themeSwitchMarkup(extraClass = '') {
  const cls = extraClass ? `theme-switch ${extraClass}` : 'theme-switch';
  return `
    <div class="${cls}" role="group" aria-label="Apparence clair ou sombre" data-active="dark">
      <span class="theme-switch-thumb" aria-hidden="true"></span>
      <button type="button" class="theme-switch-btn" data-theme-choice="light" aria-pressed="false" title="Clair" aria-label="Mode clair">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
        </svg>
        <span class="theme-switch-label">${LABELS.light}</span>
      </button>
      <button type="button" class="theme-switch-btn" data-theme-choice="dark" aria-pressed="false" title="Sombre" aria-label="Mode sombre">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3a7 7 0 0 0 11.5 11.5z"/>
        </svg>
        <span class="theme-switch-label">${LABELS.dark}</span>
      </button>
    </div>
  `;
}

function setHtml(el, html) {
  el.replaceChildren();
  const source = String(html ?? '');
  if (!source) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  el.appendChild(range.createContextualFragment(source));
}

export function mountThemeSwitches(selector = '[data-theme-switch]') {
  document.querySelectorAll(selector).forEach((host) => {
    if (host.dataset.mounted === '1') return;
    setHtml(host, themeSwitchMarkup(host.dataset.themeSwitchClass || ''));
    host.dataset.mounted = '1';
  });
}

export function initTheme() {
  applyTheme(getThemePreference());
  mountThemeSwitches();
  applyTheme(getThemePreference());

  document.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-theme-choice]');
    if (!btn) return;
    const choice = btn.getAttribute('data-theme-choice');
    if (!THEME_UI_CHOICES.includes(choice)) return;
    setThemePreference(choice);
  });

  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    // Tant que l’utilisateur n’a pas forcé clair/sombre, on suit l’OS.
    if (getThemePreference() === 'system') applyTheme('system');
  };
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
  else if (typeof mq.addListener === 'function') mq.addListener(onChange);
}
