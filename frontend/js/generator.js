/**
 * Générateur — mots de passe forts (combinés à des textes) et usernames.
 * 100 % local ; vérification anti-fuite zéro-connaissance via HIBP (k-anonymity).
 */

import { checkPassword } from './breach-check.js';
import { api } from './api.js';

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*-_=+?';
const SEPARATORS = ['-', '_', '.'];
const USER_PREFIXES = ['', '', '', 'the', 'x', 'mr', 'my', 'super', 'neo', 'pro', 'cool', 'tech'];
const LEET_MAP = { a: '4', e: '3', i: '1', o: '0', s: '5' };
const PASSPHRASE_WORDS = [
  'abeille', 'abricot', 'accord', 'acier', 'action', 'aigle', 'aiguille', 'alarme', 'alchimie', 'algue',
  'alliance', 'amande', 'amour', 'ancre', 'ange', 'animal', 'annonce', 'antenne', 'appareil',
  'arcade', 'arche', 'argile', 'argent', 'armure', 'arome', 'artisan', 'atelier', 'atlas', 'aurore',
  'avalanche', 'aventure', 'avenir', 'balade', 'baleine', 'ballon', 'bambou', 'banque', 'barque', 'bataille',
  'bateau', 'batterie', 'bec', 'berceau', 'bibliotheque', 'bijou', 'biscuit', 'blason', 'bleuet', 'blizzard',
  'bloc', 'bois', 'bonbon', 'bougie', 'boussole', 'boutique', 'brindille', 'broche', 'bronze',
  'brouillard', 'bureau', 'cactus', 'cadence', 'cadran', 'cage', 'cahier', 'calice', 'calme', 'camion',
  'campagne', 'canal', 'canape', 'canard', 'canyon', 'cap', 'capitaine', 'capuche', 'carnet',
  'carotte', 'carreau', 'cascade', 'casque', 'casserole', 'cavale', 'cavalier', 'ceinture', 'cellule', 'cerf',
  'cerisier', 'cerveau', 'chaine', 'chaleur', 'chandelier', 'chapeau', 'chapitre', 'charbon', 'charge', 'charme',
  'chasse', 'chateau', 'chaudron', 'chaussure', 'chemin', 'chemise', 'chene', 'cheval', 'chevre', 'chiffre',
  'chocolat', 'chouette', 'ciel', 'cigale', 'cinema', 'cirque', 'citron', 'citrouille', 'clairiere', 'clavier',
  'clef', 'clic', 'climat', 'cloche', 'clou', 'cobra', 'coccinelle', 'coffre', 'colombe', 'colonne',
  'comete', 'conte', 'coquelicot', 'coquille', 'corail', 'corbeau', 'corde', 'couronne', 'couteau', 'crabe',
  'craie', 'crayon', 'cristal', 'croissant', 'crocodile', 'cygne', 'cypres', 'dahlia', 'dame', 'dauphin',
  'delta', 'dent', 'dentelle', 'desert', 'diamant', 'dicton', 'digue', 'dinde', 'diplome', 'dix',
  'domino', 'donjon', 'dragon', 'drapeau', 'eclair', 'ecole', 'ecorce', 'ecran', 'ecu', 'effet',
  'elephant', 'ellipse', 'embarcadere', 'emeraude', 'empire', 'encre', 'energie', 'engrenage', 'enquete', 'enveloppe',
  'epaule', 'epice', 'epine', 'escadre', 'espace', 'esprit', 'esquive', 'etoile', 'eveil', 'eventail',
  'fabrique', 'falaise', 'famille', 'fantome', 'farine', 'faucon', 'fauvette', 'fenetre', 'fer', 'ferme',
  'feuillage', 'feuille', 'fiamme', 'ficelle', 'figurine', 'filon', 'fleur', 'fleuve', 'flocon', 'flot',
  'flute', 'fonte', 'forage', 'foret', 'forme', 'fort', 'fossile', 'four',
  'fourmi', 'fraise', 'frayeur', 'frelon', 'frisson', 'fronde', 'fumee', 'fusee', 'gabarit', 'galaxie',
  'galerie', 'galet', 'gant', 'garde', 'gazelle', 'gazon', 'gelee', 'genie', 'gibier', 'girouette',
  'glace', 'glaive', 'globe', 'gobelins', 'gondole', 'gourde', 'goutte', 'graine', 'grand', 'grenier',
  'griffe', 'grillon', 'grimoire', 'grotte', 'grue', 'guerrier', 'guirlande', 'habit', 'hameau', 'harpe',
  'haut', 'herbe', 'hermine', 'hibou', 'hiver', 'horizon', 'horloge', 'houle', 'huile', 'huit',
  'humus', 'iceberg', 'idole', 'if', 'igloo', 'illustration', 'imaginaire', 'imperial', 'incendie', 'indice',
  'insecte', 'instant', 'interieur', 'invention', 'iris', 'ile', 'ivoire', 'jardin', 'jasmin', 'jet',
  'jeu', 'joaillier', 'jongleur', 'jubile', 'juge', 'jument', 'jungle', 'jupe', 'juron', 'kayak',
  'kiwi', 'lac', 'lagon', 'lame', 'lampe', 'lancelot', 'lande', 'lanterne', 'lapin', 'laurier',
  'lave', 'legende', 'lentille', 'lettre', 'lievre', 'ligne', 'lilas', 'limier', 'lion', 'livre',
  'locomotive', 'lointain', 'loup', 'loutre', 'lueur', 'lune', 'luth', 'lyre', 'machine', 'madone',
  'magie', 'magma', 'maison', 'malle', 'mammouth', 'mandragore', 'manche', 'mangeoire', 'manoir', 'manteau',
  'maquis', 'marche', 'mare', 'marguerite', 'marin', 'marron', 'marteau', 'mascotte', 'mastodonte', 'mecanisme',
  'mecene', 'medaille', 'melon', 'menhir', 'menthe', 'mepris', 'mer', 'merise', 'mesange', 'message',
  'mestre', 'metal', 'meteore', 'meule', 'miel', 'migraine', 'minaret', 'mine', 'minute', 'miroir',
  'molecule', 'monde', 'monstre', 'montagne', 'montre', 'morceau', 'mousse', 'mouton', 'muguet', 'murmure',
  'musique', 'mystere', 'nacre', 'nageoire', 'nappe', 'neige', 'nektar', 'nid', 'ninja', 'niveau',
  'noix', 'nuage', 'nuit', 'oasis', 'obelisque', 'occulte', 'ocean', 'oeuf', 'oignon',
  'oiseau', 'olive', 'ombre', 'ondine', 'oncle', 'opera', 'orange', 'orchestre', 'orchidee', 'ordinateur',
  'oreille', 'orge', 'origine', 'orion', 'orpailleur', 'ours', 'outil', 'outremer', 'ouvrage', 'ovale',
  'paille', 'palais', 'palmier', 'pampa', 'panier', 'panthere', 'paon', 'papillon', 'parade', 'parchemin',
  'parfum', 'paroi', 'passage', 'pastille', 'pate', 'pavot', 'peche', 'pelle', 'pendule', 'pensee',
  'perche', 'perle', 'perroquet', 'personnage', 'phare', 'phoenix', 'phoque', 'photo', 'piano', 'pieuvre',
  'pigeon', 'pinceau', 'pionnier', 'piste', 'pivoine', 'planete', 'plante', 'plastron', 'plat', 'pluie',
  'plume', 'poire', 'poison', 'poisson', 'pomme', 'pont', 'populaire', 'portail', 'porte', 'pot',
  'poulain', 'poulpe', 'poussiere', 'prairie', 'praline', 'pre', 'presse', 'prince', 'prisme', 'profil',
  'promesse', 'prunelle', 'puce', 'puits', 'pulse', 'pyramide', 'quai', 'quartz', 'quatre', 'question',
  'quete', 'queue', 'radar', 'radeau', 'rage', 'rail', 'raisin', 'rameau', 'rapace', 'rat',
  'raven', 'rayon', 'recif', 'refuge', 'regle', 'remous', 'renard', 'rencontre', 'riviere', 'robinet',
  'roc', 'roche', 'roi', 'roman', 'ronde', 'rosace', 'rose', 'roue', 'ruban', 'ruche',
  'ruse', 'sable', 'sabre', 'safran', 'saga', 'sagesse', 'saison', 'salamandre', 'salle', 'sapin',
  'sardine', 'satellite', 'saut', 'saule', 'scarabee', 'scintillement', 'secret', 'sel', 'serpent', 'serval',
  'signal', 'silence', 'sirius', 'socle', 'soleil', 'sommet', 'sonate', 'songe', 'sorciere',
  'souffle', 'source', 'souris', 'souterrain', 'spectre', 'sphinx', 'spiral', 'statue', 'steppe', 'strophe',
  'sultan', 'sucre', 'sumac', 'sursis', 'talisman', 'tambour', 'taureau', 'tempete', 'temps', 'tente',
  'terrasse', 'terre', 'theatre', 'theiere', 'tigre', 'timbre', 'titan', 'tonneau', 'toit', 'tomate',
  'tonnerre', 'torche', 'tour', 'tourbillon', 'tramway', 'trebuchet', 'tremplin', 'treve', 'triangle', 'tricorne',
  'trolle', 'trompette', 'tronc', 'troupe', 'truffe', 'tsunami', 'tulipe', 'tunnel', 'turban', 'truite',
  'unicorne', 'univers', 'urne', 'usine', 'vague', 'vallee', 'vampire', 'vanille', 'vapeur', 'vase',
  'veau', 'velours', 'vent', 'veranda', 'verdure', 'verre', 'verseau', 'vestige', 'viaduc', 'vigne',
  'village', 'violon', 'violette', 'virgule', 'vision', 'vitrail', 'voile', 'voisin', 'volcan', 'voltige',
  'vortex', 'voute', 'voyage', 'wagon', 'yaourt', 'zebre', 'zelote', 'zenith', 'zephyr', 'zone',
  'zoo', 'zorille',
];

function clampWordCount(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(3, Math.min(10, n)) : 5;
}

function pickWords(count) {
  const picked = new Set();
  const list = [];
  while (list.length < count) {
    const w = PASSPHRASE_WORDS[randomInt(PASSPHRASE_WORDS.length)];
    if (!picked.has(w)) {
      picked.add(w);
      list.push(w);
    }
  }
  return list.join('-');
}

function clampLength(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(8, Math.min(64, n)) : 20;
}

function randomInt(max) {
  const buf = new Uint8Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

function randomChars(count, chars) {
  const maxUnbiased = 256 - (256 % chars.length);
  const buf = new Uint8Array(count + 8);
  crypto.getRandomValues(buf);
  let out = '';
  for (const b of buf) {
    if (out.length >= count) break;
    if (b >= maxUnbiased) continue;
    out += chars[b % chars.length];
  }
  while (out.length < count) out += chars[out.length % chars.length];
  return out;
}

/**
 * Construit un mot de passe combinant les textes fournis avec de l'aléa.
 * La longueur finale est toujours `length`, avec au moins 1 chiffre et 1 symbole
 * si les options correspondantes sont actives.
 */
export function buildPassword({
  base = '',
  bg = '',
  length = 20,
  upper = true,
  digits = true,
  symbols = true,
} = {}) {
  const n = clampLength(length);
  const letters = LOWER + (upper ? UPPER : '');
  const pool = letters + (digits ? DIGITS : '') + (symbols ? SYMBOLS : '');
  if (!pool) return null;

  let core = '';
  const seed = [base, bg].filter((s) => s && s.trim()).join(' ');
  if (seed.trim()) {
    const words = seed.trim().split(/\s+/).filter(Boolean);
    for (const [i, word] of words.entries()) {
      let w = word.replace(/[^A-Za-zÀ-ÿ0-9]/g, '');
      if (!w) continue;
      if (upper) w = w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      if (i > 0 && core) core += SEPARATORS[randomInt(SEPARATORS.length)];
      core += w;
    }
  }

  let guaranteed = '';
  if (digits) guaranteed += DIGITS[randomInt(DIGITS.length)];
  if (symbols) guaranteed += SYMBOLS[randomInt(SYMBOLS.length)];

  let fill = n - core.length - guaranteed.length;
  if (fill < 0) {
    core = core.slice(0, Math.max(0, n - guaranteed.length));
    fill = n - core.length - guaranteed.length;
  }

  return core + randomChars(fill, pool) + guaranteed;
}

/**
 * Génère une passphrase : N mots courants séparés par des tirets. 100 % local.
 */
export function generatePassphrase(count = 5) {
  return pickWords(clampWordCount(count));
}

/**
 * Génère des variantes d'username à partir d'un mot de base. 100 % local.
 */
export function generateUsernames(base, count = 8) {
  const clean = String(base || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!clean) return [];
  const words = clean.split(' ').filter(Boolean);
  const stem = words.join('');
  const dotted = words.join('.');
  const underscored = words.join('_');
  const dashed = words.join('-');

  function leetify(s) {
    return s.split('').map((c) => LEET_MAP[c] || c).join('');
  }

  const variants = [dotted, underscored, dashed, leetify(stem)];
  const out = new Set();
  out.add(dotted);
  out.add(underscored);
  out.add(dashed);

  while (out.size < count) {
    const prefix = USER_PREFIXES[randomInt(USER_PREFIXES.length)];
    const sep = ['', '', '_', '.', '-'][randomInt(5)];
    const digits = randomChars(2 + randomInt(3), DIGITS);
    out.add(`${prefix ? prefix + sep : ''}${variants[randomInt(variants.length)]}${digits}`);
  }

  return Array.from(out).slice(0, count);
}

export function createGenerator(deps) {
  const { $, refreshIcons, toast, copyText, state } = deps;

  let bound = false;

  function bindGenerator() {
    if (bound) return;
    const view = $('#generator-view');
    if (!view) return;
    bound = true;

    const tabs = Array.from(view.querySelectorAll('[data-gen-mode]'));
    const panels = Array.from(view.querySelectorAll('[data-gen-panel]'));

    function setGenMode(mode) {
      tabs.forEach((tab) => {
        const isActive = tab.dataset.genMode === mode;
        tab.classList.toggle('is-active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
      });
      panels.forEach((panel) => {
        panel.hidden = panel.dataset.genPanel !== mode;
      });
    }

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => setGenMode(tab.dataset.genMode));
    });

    const lengthInput = $('#gen-length');
    const lengthMinus = $('#gen-length-minus');
    const lengthPlus = $('#gen-length-plus');
    const genBtn = $('#gen-password-btn');

    function clampLength(value) {
      const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(8, Math.min(64, n)) : 20;
    }

    if (lengthMinus) {
      lengthMinus.addEventListener('click', () => {
        lengthInput.value = String(clampLength(lengthInput.value) - 1);
      });
    }
    if (lengthPlus) {
      lengthPlus.addEventListener('click', () => {
        lengthInput.value = String(clampLength(lengthInput.value) + 1);
      });
    }
    lengthInput.addEventListener('change', () => {
      lengthInput.value = String(clampLength(lengthInput.value));
    });
    const valueInput = $('#gen-password-value');
    const copyBtn = $('#gen-password-copy');
    const status = $('#gen-password-status');
    const ppCount = $('#gen-pp-count');
    const ppMinus = $('#gen-pp-count-minus');
    const ppPlus = $('#gen-pp-count-plus');
    const ppBtn = $('#gen-passphrase-btn');
    const ppValue = $('#gen-passphrase-value');
    const ppCopy = $('#gen-passphrase-copy');
    const ppStatus = $('#gen-passphrase-status');
    const userBase = $('#gen-user-base');
    const userBtn = $('#gen-username-btn');
    const userList = $('#gen-username-list');

    async function generateAndCheck() {
      genBtn.disabled = true;
      valueInput.value = '';
      valueInput.classList.remove('is-safe');
      copyBtn.hidden = true;
      copyBtn.classList.remove('copied');
      status.hidden = false;
      status.textContent = 'Vérification anti-fuite en cours…';
      status.className = 'generator-status';
      try {
        for (let attempt = 0; attempt < 25; attempt += 1) {
          const pw = buildPassword({
            length: lengthInput.value,
            upper: true,
            digits: true,
            symbols: true,
          });
          if (!pw) {
            toast('Génération impossible', 'error');
            return;
          }
          const count = await checkPassword(pw);
          if (count === 0) {
            valueInput.value = pw;
            valueInput.classList.add('is-safe');
            copyBtn.hidden = false;
            status.textContent = 'Mot de passe sûr — non présent dans les fuites connues.';
            status.className = 'generator-status is-safe';
            refreshIcons(copyBtn.parentElement);
            return;
          }
        }
        status.textContent = 'Aucun mot de passe sûr trouvé — réessayez.';
        status.className = 'generator-status is-pwned';
      } catch (err) {
        status.textContent = err.message || 'Vérification indisponible.';
        status.className = 'generator-status is-pwned';
      } finally {
        genBtn.disabled = false;
      }
    }

    genBtn.addEventListener('click', generateAndCheck);
    copyBtn.addEventListener('click', async () => {
      const v = valueInput.value;
      if (!v) return;
      if (await copyText(v, copyBtn)) toast('Mot de passe copié', 'success');
    });

    if (ppMinus) {
      ppMinus.addEventListener('click', () => {
        ppCount.value = String(clampWordCount(ppCount.value) - 1);
      });
    }
    if (ppPlus) {
      ppPlus.addEventListener('click', () => {
        ppCount.value = String(clampWordCount(ppCount.value) + 1);
      });
    }
    ppCount.addEventListener('change', () => {
      ppCount.value = String(clampWordCount(ppCount.value));
    });

    function generatePassphraseNow() {
      ppBtn.disabled = true;
      ppValue.value = '';
      ppValue.classList.remove('is-safe');
      ppCopy.hidden = true;
      ppCopy.classList.remove('copied');
      ppStatus.hidden = false;
      ppStatus.textContent = 'Génération…';
      ppStatus.className = 'generator-status';
      try {
        const phrase = generatePassphrase(ppCount.value);
        ppValue.value = phrase;
        ppValue.classList.add('is-safe');
        ppCopy.hidden = false;
        ppStatus.textContent = 'Passphrase générée — 100 % local.';
        ppStatus.className = 'generator-status is-safe';
      } finally {
        ppBtn.disabled = false;
      }
    }

    ppBtn.addEventListener('click', generatePassphraseNow);
    ppCopy.addEventListener('click', async () => {
      const v = ppValue.value;
      if (!v) return;
      if (await copyText(v, ppCopy)) toast('Passphrase copiée', 'success');
    });

    const USER_STATUS = {
      checking: { text: 'Vérification…', cls: 'is-checking' },
      free: { text: 'Disponible', cls: 'is-free' },
      taken: { text: 'Utilisé', cls: 'is-taken' },
      unknown: { text: 'Indéterminé', cls: 'is-unknown' },
    };

    function createUserRow(name) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'generator-user-item is-checking';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'generator-user-name';
      nameSpan.textContent = name;
      const badge = document.createElement('span');
      badge.className = 'generator-user-badge';
      row.append(nameSpan, badge);
      setUserStatus(row, 'checking');
      row.addEventListener('click', async () => {
        if (await copyText(name, row)) toast('Username copié', 'success');
      });
      return { row, name };
    }

    function setUserStatus(row, status) {
      const cfg = USER_STATUS[status] || USER_STATUS.unknown;
      row.classList.remove('is-checking', 'is-free', 'is-taken', 'is-unknown');
      row.classList.add(cfg.cls);
      const badge = row.querySelector('.generator-user-badge');
      if (badge) badge.textContent = cfg.text;
    }

    function renderUsernames() {
      const base = userBase.value;
      if (!base.trim()) {
        toast('Entrez un mot de base', 'error');
        return;
      }
      const names = generateUsernames(base, 8);
      // Le nom de base est vérifié en premier (« avant de générer »).
      const clean = base.trim().replace(/\s+/g, ' ').toLowerCase();
      const candidates = names.slice();
      if (/^[A-Za-z0-9][A-Za-z0-9_.-]{1,29}$/.test(clean)) candidates.unshift(clean);

      const rows = candidates.map((name) => createUserRow(name));
      userList.replaceChildren(...rows.map(({ row }) => row));
      refreshIcons(userList);

      (async () => {
        try {
          const payload = await api.checkUsernames(state.token, candidates);
          const byUser = new Map(payload.usernames.map((u) => [u.username, u]));
          rows.forEach(({ row, name }) => {
            const data = byUser.get(name);
            if (!data) {
              setUserStatus(row, 'unknown');
            } else if (data.found_count > 0) {
              setUserStatus(row, 'taken');
            } else if (data.not_found_count > 0) {
              setUserStatus(row, 'free');
            } else {
              setUserStatus(row, 'unknown');
            }
          });
        } catch (err) {
          rows.forEach(({ row }) => setUserStatus(row, 'unknown'));
          toast(err.message || 'Vérification indisponible.', 'error');
        }
      })();
    }

    userBtn.addEventListener('click', renderUsernames);
  }

  function renderGenerator() {
    bindGenerator();
    const view = $('#generator-view');
    if (view) refreshIcons(view);
  }

  return { renderGenerator };
}
