/** Mode développement — accès direct au design sans connexion réelle */

import { normalizeEntryUrl } from './favicon.js';

const urlParams = new URLSearchParams(window.location.search);
const devParam = urlParams.get('dev');
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

export const DEV_MODE = devParam === '0' ? false : (devParam === '1' || isLocal);

export const MOCK_ENTRIES = [
  {
    id: 'dev-1',
    type: 'login',
    title: 'Netflix',
    username: 'couple@email.com',
    password: 'Kx9#mP2$vLq8@nR4wT',
    url: 'https://netflix.com',
    notes: 'Compte familial',
  },
  {
    id: 'dev-2',
    type: 'login',
    title: 'Gmail',
    username: 'pierre@email.com',
    password: 'MonSuperMdp2024!',
    url: 'https://mail.google.com',
    notes: '',
  },
  {
    id: 'dev-3',
    type: 'login',
    title: 'Banque Populaire',
    username: '12345678901',
    password: 'Secur3B@nque#99',
    url: 'https://www.banquepopulaire.fr',
    notes: 'Code carte : 4521',
  },
  {
    id: 'dev-4',
    type: 'api_key',
    title: 'OpenAI',
    username: 'org-demo',
    password: 'demo-openai-key-not-real',
    url: 'https://platform.openai.com',
    notes: 'Factice — ne jamais committer de vraie clé',
  },
  {
    id: 'dev-5',
    type: 'api_key',
    title: 'Stripe',
    username: '',
    password: 'demo-stripe-key-not-real',
    url: 'https://dashboard.stripe.com',
    notes: 'Factice — environnement test',
  },
];

export function enterDevMode(state) {
  state.devMode = true;
  state.token = 'dev-token';
  state.user = {
    id: 'dev-user',
    email: 'pierre@dev.local',
    first_name: 'Pierre',
    middle_name: 'Jean',
    last_name: 'Dupont',
    display_name: 'Pierre Jean Dupont',
  };
  state.vaultKey = null;
  state.privateKey = null;
  state.publicKey = null;
  state.entries = MOCK_ENTRIES.map(e => ({
    ...e,
    url: normalizeEntryUrl(e.url),
  }));
}

export function createDevEntry(entries, data) {
  const entry = {
    id: `dev-${Date.now()}`,
    ...data,
    url: (data.url || '').trim() ? normalizeEntryUrl(data.url) : '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  entries.unshift(entry);
  return entry;
}

export function deleteDevEntry(entries, id) {
  const index = entries.findIndex((e) => e.id === id);
  if (index === -1) return null;
  const [removed] = entries.splice(index, 1);
  return removed;
}

export function shouldUseDevBypass(email, master) {
  return DEV_MODE && !email && !master;
}
