/**
 * Page /extension/ — thème + carte navigateur recommandé.
 */
import { initTheme } from './theme.js';

initTheme();

const ua = navigator.userAgent || '';
const isFirefox = /Firefox\//i.test(ua);
const isChromium = /Chrome|Chromium|Edg|Brave/i.test(ua) && !isFirefox;

if (isFirefox) {
  document.getElementById('card-firefox')?.classList.add('is-recommended');
} else if (isChromium) {
  document.getElementById('card-chromium')?.classList.add('is-recommended');
}
