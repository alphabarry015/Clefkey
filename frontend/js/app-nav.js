/**
 * Navigation coffre : titres, sélecteur sidebar, pages.
 */

import { saveSession, startIdleWatch } from './session.js';
import { isVaultMetaEntry, entryFolderId } from './folders.js';
import { $, $$, toast } from './ui.js';

const PAGE_TITLES = {
  dashboard: { title: 'Accueil', subtitle: 'Vos connexions en un coup d\'œil' },
  vault: { title: 'Toutes les clés', subtitle: 'Votre coffre complet' },
  projects: { title: 'Projets', subtitle: 'Organisez vos clés par dossier' },
  'project-detail': { title: 'Projet', subtitle: 'Clés de ce projet' },
  'shares-received': { title: 'Partage · Reçu', subtitle: 'Clés partagées avec vous' },
  'shares-sent': { title: 'Partage · Envoyé', subtitle: 'Clés que vous avez partagées' },
  contacts: { title: 'Contacts', subtitle: 'Destinataires de vos partages' },
  profile: { title: 'Mon profil', subtitle: 'Informations de votre compte' },
  password: { title: 'Mot de passe maître', subtitle: 'Changez-le sans clés de récupération' },
  audit: { title: 'Audit', subtitle: 'Vérifiez si un mot de passe a fuité' },
  generator: { title: 'Générateur', subtitle: 'Mots de passe et passphrases sécurisés' },
};

const MOBILE_BREAKPOINT = 900;

export function installVaultNav(deps) {
  const { state } = deps;
  let navSelectorWatch = 0;
  let navSelectorReady = false;

  function updatePageTitle() {
    if (state.page === 'project-detail') {
      const folder = state.folders.find((f) => f.id === state.activeProjectId);
      $('#page-title').textContent = folder?.name || 'Projet';
      const n = folder
        ? state.entries.filter((e) => (
          !e.isShare && !isVaultMetaEntry(e) && entryFolderId(e) === folder.id
        )).length
        : 0;
      const label = n <= 1
        ? `${n} clé dans ce projet`
        : `${n} clés dans ce projet`;
      $('#page-subtitle').textContent = label;
      $('#fab-add').classList.remove('hidden');
      return;
    }
    const page = PAGE_TITLES[state.page] || PAGE_TITLES.dashboard;
    $('#page-title').textContent = page.title;
    $('#page-subtitle').textContent = page.subtitle;
    const onProfile = state.page === 'profile' || state.page === 'password';
    const onAudit = state.page === 'audit';
    const onGenerator = state.page === 'generator';
    const onShares = state.page === 'shares-received'
      || state.page === 'shares-sent'
      || state.page === 'contacts';
    const onProjects = state.page === 'projects';
    $('#fab-add').classList.toggle(
      'hidden',
      onProfile || onShares || onProjects || onAudit || onGenerator,
    );
  }

  function paintNavSelectorOverlap() {
    const sel = $('.nav-selector');
    const nav = $('.sidebar-nav');
    if (!sel || !nav || sel.classList.contains('is-hidden')) {
      $$('.nav-item').forEach((item) => item.classList.remove('nav-on-selector'));
      return;
    }
    const sr = sel.getBoundingClientRect();
    nav.querySelectorAll('.nav-item').forEach((item) => {
      const r = item.getBoundingClientRect();
      const overlap = r.bottom > sr.top + 8 && r.top < sr.bottom - 8;
      item.classList.toggle('nav-on-selector', overlap);
    });
  }

  function watchNavSelector(ms) {
    cancelAnimationFrame(navSelectorWatch);
    const end = performance.now() + ms + 40;
    const tick = (now) => {
      paintNavSelectorOverlap();
      if (now < end) navSelectorWatch = requestAnimationFrame(tick);
    };
    navSelectorWatch = requestAnimationFrame(tick);
  }

  function syncNavSelector({ instant = false } = {}) {
    const nav = $('.sidebar-nav');
    const sel = $('.nav-selector');
    const active = nav?.querySelector('.nav-item.active');
    if (!nav || !sel) return;

    if (!active) {
      sel.classList.add('is-hidden');
      paintNavSelectorOverlap();
      return;
    }

    sel.classList.remove('is-hidden');
    const navRect = nav.getBoundingClientRect();
    const itemRect = active.getBoundingClientRect();
    const y = itemRect.top - navRect.top + nav.scrollTop;
    const x = itemRect.left - navRect.left;
    const h = itemRect.height;
    const w = navRect.right - itemRect.left;
    const prevY = Number(sel.dataset.y || y);
    const dist = Math.abs(y - prevY);
    const hops = Math.max(1, Math.round(dist / Math.max(h, 1)));
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const skipAnim = instant || !navSelectorReady || reduce;
    const ms = skipAnim ? 0 : Math.min(860, 260 + hops * 170);

    sel.style.transition = skipAnim
      ? 'none'
      : `transform ${ms}ms cubic-bezier(0.22, 1, 0.36, 1), `
        + `height ${ms}ms cubic-bezier(0.22, 1, 0.36, 1), `
        + `width ${ms}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    sel.style.width = `${w}px`;
    sel.style.height = `${h}px`;
    sel.style.transform = `translate(${x}px, ${y}px)`;
    sel.dataset.y = String(y);
    navSelectorReady = true;

    if (skipAnim) {
      paintNavSelectorOverlap();
      return;
    }
    watchNavSelector(ms);
  }

  function applyVaultPage(page) {
    if (page !== 'profile') deps.closeAllProfileFieldEdits();
    if (page !== 'password') deps.resetPasswordChangeForm();
    if (page !== 'project-detail') {
      state.activeProjectId = null;
      state.projectDetailSelectedIds = [];
    }
    if (page !== 'contacts') state.contactsSelectedEmail = null;
    state.page = page;
    $$('.nav-item').forEach((b) => {
      const active = b.dataset.page === page
        || (page === 'project-detail' && b.dataset.page === 'projects');
      b.classList.toggle('active', active);
    });
    $('#dashboard-view').classList.toggle('hidden', page !== 'dashboard');
    $('#vault-view').classList.toggle('hidden', page !== 'vault');
    $('#projects-view')?.classList.toggle('hidden', page !== 'projects');
    $('#project-detail-view')?.classList.toggle('hidden', page !== 'project-detail');
    $('#shares-received-view')?.classList.toggle('hidden', page !== 'shares-received');
    $('#shares-sent-view')?.classList.toggle('hidden', page !== 'shares-sent');
    $('#contacts-view')?.classList.toggle('hidden', page !== 'contacts');
    $('#profile-view').classList.toggle('hidden', page !== 'profile');
    $('#password-view')?.classList.toggle('hidden', page !== 'password');
    $('#audit-view')?.classList.toggle('hidden', page !== 'audit');
    $('#generator-view')?.classList.toggle('hidden', page !== 'generator');
    updatePageTitle();
    deps.updateEntryCounts();
    $('.vault-main')?.scrollTo(0, 0);
    try {
      if (page === 'dashboard') deps.renderDashboard();
      else if (page === 'vault') deps.renderEntries();
      else if (page === 'projects') deps.renderProjectsPage();
      else if (page === 'project-detail') deps.renderProjectDetailPage();
      else if (page === 'shares-received') deps.renderSharesReceived();
      else if (page === 'shares-sent') deps.renderSharesSent();
      else if (page === 'contacts') deps.renderContactsPage();
      else if (page === 'profile') deps.renderProfile();
      else if (page === 'password') deps.refreshIcons($('#password-view'));
      else if (page === 'audit') deps.renderAudit();
      else if (page === 'generator') deps.renderGenerator();
    } catch (err) {
      console.error('Erreur affichage page:', err);
      toast('Impossible d\'afficher cette page', 'error');
    }
  }

  function switchPage(page) {
    if (!PAGE_TITLES[page]) page = 'dashboard';
    applyVaultPage(page);
    syncNavSelector();
  }

  function isMobileLayout() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  function setSidebarExpanded(expanded) {
    $('#screen-vault').classList.toggle('sidebar-expanded', expanded);
    requestAnimationFrame(() => syncNavSelector({ instant: true }));
  }

  function applySidebarState() {
    setSidebarExpanded(!isMobileLayout());
  }

  function collapseSidebar() {
    setSidebarExpanded(false);
  }

  function toggleSidebar() {
    const expanded = !$('#screen-vault').classList.contains('sidebar-expanded');
    setSidebarExpanded(expanded);
  }

  function showVault() {
    deps.showScreen('vault');
    if (!state.user) return;
    const user = deps.normalizeUser(state.user);
    state.user = user;
    deps.applyUserToUI(user);
    applySidebarState();
    state.page = 'dashboard';
    switchPage('dashboard');
    if (!state.devMode) {
      saveSession(state);
      startIdleWatch(() => state, (reason) => deps.lockVault(reason || 'idle'));
      deps.loadShares().catch((err) => console.warn('Partages:', err));
    }
  }

  deps.switchPage = switchPage;
  deps.updatePageTitle = updatePageTitle;
  deps.isMobileLayout = isMobileLayout;
  deps.collapseSidebar = collapseSidebar;
  deps.showVault = showVault;

  $('#btn-menu').addEventListener('click', toggleSidebar);
  $('#sidebar-overlay').addEventListener('click', collapseSidebar);

  window.addEventListener('resize', () => {
    if (!$('#screen-vault').classList.contains('active')) return;
    applySidebarState();
    syncNavSelector({ instant: true });
  });
}
