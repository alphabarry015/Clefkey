/**
 * Vérification de compromission — logique partagée landing + coffre.
 *
 * Mot de passe : k-anonymity Have I Been Pwned (SHA-1 local, 5 caractères transmis).
 * E-mail       : API publique XposedOrNot (sans clé API).
 */

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const XON_CHECK_URL = 'https://api.xposedornot.com/v1/check-email/';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const SVG_ATTRS = 'xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

export const RESULT_ICONS = {
  safe: `<svg class="breach-result-icon" ${SVG_ATTRS}><path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/></svg>`,
  pwned: `<svg class="breach-result-icon" ${SVG_ATTRS}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
  error: `<svg class="breach-result-icon" ${SVG_ATTRS}><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`,
  pending: `<svg class="breach-result-icon breach-result-icon-spin" ${SVG_ATTRS}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
};

export function isValidEmail(value) {
  return EMAIL_RE.test(String(value || '').trim());
}

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex.toUpperCase();
}

export async function sha1(value) {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error('Web Crypto non disponible. Utilisez HTTPS ou un navigateur récent.');
  }
  const digest = await window.crypto.subtle.digest('SHA-1', new TextEncoder().encode(value));
  return toHex(digest);
}

/**
 * @returns {Promise<number>} nombre d'occurrences dans les fuites (0 = non compromis).
 */
export async function checkPassword(password) {
  const hash = await sha1(password);
  const prefix = hash.substring(0, 5);
  const suffix = hash.substring(5);
  const response = await fetch(`${HIBP_RANGE_URL}${prefix}`);
  if (!response.ok) throw new Error('Service de vérification indisponible.');
  const text = await response.text();
  for (const line of text.split(/\r?\n/)) {
    const [hashSuffix, count] = line.split(':');
    if (hashSuffix === suffix) return parseInt(count, 10) || 0;
  }
  return 0;
}

/**
 * @returns {Promise<{safe: boolean, breaches: string[]}>}
 */
export async function checkEmail(email) {
  const address = String(email || '').trim();
  if (!isValidEmail(address)) throw new Error('Adresse e-mail invalide.');

  let response;
  try {
    response = await fetch(`${XON_CHECK_URL}${encodeURIComponent(address)}`);
  } catch (err) {
    throw new Error('Service de vérification injoignable.');
  }

  if (response.status === 404) return { safe: true, breaches: [] };
  if (!response.ok) throw new Error('Service de vérification indisponible.');

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error('Réponse inattendue du service de vérification.');
  }

  if (data && data.Error) return { safe: true, breaches: [] };

  const raw = data && (data.breaches || data.Breaches);
  const breaches = Array.isArray(raw) ? raw.flat().filter(Boolean) : [];
  return { safe: breaches.length === 0, breaches };
}

export function formatPasswordResult(count) {
  return count === 0
    ? { safe: true, text: 'Mot de passe non compromis.' }
    : { safe: false, text: `Compromis ${count.toLocaleString('fr-FR')} fois. Changez-le.` };
}

export function formatEmailResult(result) {
  if (result.safe) {
    return { safe: true, text: 'Aucune fuite connue pour cette adresse.' };
  }
  const list = result.breaches.slice(0, 4).join(', ');
  const extra = result.breaches.length > 4 ? `, +${result.breaches.length - 4} autres` : '';
  return {
    safe: false,
    text: `Présente dans ${result.breaches.length} fuite(s) : ${list}${extra}.`,
  };
}

export const PRIVACY_TEXT = {
  password: 'Le mot de passe est hashé localement. Seuls 5 caractères du hash SHA-1 sont transmis.',
  email: "L'adresse est interrogée auprès de XposedOrNot. Elle n'est ni stockée ni associée à votre compte.",
};

/**
 * Câble un widget de vérification (landing ou coffre).
 *
 * Éléments attendus dans `root` (sélecteurs CSS passés dans `sel`) :
 *   form, input, result, tabs (boutons [data-mode]), toggle (optionnel), privacy (optionnel).
 */
export function bindBreachWidget(root, sel) {
  if (!root || root.dataset.breachBound === 'true') return null;

  const form = root.querySelector(sel.form);
  const input = root.querySelector(sel.input);
  const result = root.querySelector(sel.result);
  if (!form || !input || !result) return null;

  const tabs = Array.from(root.querySelectorAll(sel.tabs || '[data-breach-mode]'));
  const toggle = sel.toggle ? root.querySelector(sel.toggle) : null;
  const privacy = sel.privacy ? root.querySelector(sel.privacy) : null;
  const classes = sel.classes || {};
  const visibleClass = classes.visible || 'is-visible';
  const safeClass = classes.safe || 'is-safe';
  const pwnedClass = classes.pwned || 'is-pwned';
  const activeClass = classes.activeTab || 'is-active';

  let mode = 'password';
  let revealed = false;

  function clearResult() {
    result.textContent = '';
    result.classList.remove(visibleClass, safeClass, pwnedClass);
  }

  function render(icon, text, tone) {
    const label = document.createElement('span');
    label.className = 'breach-result-text';
    label.textContent = text;

    result.innerHTML = RESULT_ICONS[icon] || '';
    result.appendChild(label);
    result.classList.add(visibleClass);
    result.classList.toggle(safeClass, tone === 'safe');
    result.classList.toggle(pwnedClass, tone === 'pwned');
  }

  function showMessage(safe, text) {
    render(safe ? 'safe' : 'pwned', text, safe ? 'safe' : 'pwned');
  }

  function applyReveal() {
    if (!toggle) return;
    input.type = mode === 'email' ? 'email' : (revealed ? 'text' : 'password');
    toggle.setAttribute('aria-pressed', String(revealed));
    root.dataset.reveal = String(revealed);
  }

  function setMode(next) {
    mode = next === 'email' ? 'email' : 'password';
    root.dataset.breachActiveMode = mode;
    revealed = false;

    input.value = '';
    input.type = mode === 'email' ? 'email' : 'password';
    input.placeholder = mode === 'email' ? 'Entrez une adresse e-mail…' : 'Entrez un mot de passe…';
    input.setAttribute('aria-label', mode === 'email' ? 'Adresse e-mail à vérifier' : 'Mot de passe à vérifier');
    input.autocomplete = 'off';
    input.inputMode = mode === 'email' ? 'email' : 'text';

    if (toggle) toggle.hidden = mode === 'email';
    if (privacy) privacy.textContent = PRIVACY_TEXT[mode];

    tabs.forEach((tab) => {
      const isActive = tab.dataset.breachMode === mode;
      tab.classList.toggle(activeClass, isActive);
      tab.setAttribute('aria-selected', String(isActive));
    });

    applyReveal();
    clearResult();
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => setMode(tab.dataset.breachMode));
  });

  if (toggle) {
    toggle.addEventListener('click', () => {
      revealed = !revealed;
      applyReveal();
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = input.value;
    if (!value) return;

    render('pending', 'Vérification en cours…', 'pending');

    try {
      if (mode === 'email') {
        const outcome = formatEmailResult(await checkEmail(value));
        showMessage(outcome.safe, outcome.text);
      } else {
        const outcome = formatPasswordResult(await checkPassword(value));
        showMessage(outcome.safe, outcome.text);
      }
    } catch (err) {
      render('error', err.message || 'Erreur.', 'pwned');
    }
  });

  setMode('password');
  root.dataset.breachBound = 'true';
  return { setMode };
}
