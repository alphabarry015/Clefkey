/**
 * Application documentation Clefkey. — sidebar + contenu Markdown.
 */

import { renderMarkdown } from './markdown.js';
import { initTheme } from './theme.js';

initTheme();

const PAGES = [
  {
    slug: 'introduction',
    file: 'README.md',
    title: 'Introduction',
    group: 'Démarrer',
  },
  {
    slug: 'guide-utilisateur',
    file: 'GUIDE-UTILISATEUR.md',
    title: 'Guide utilisateur',
    group: 'Démarrer',
  },
  {
    slug: 'cartographie-coffre',
    file: 'CARTOGRAPHIE-COFFRE.md',
    title: 'Cartographie du coffre',
    group: 'Comprendre',
  },
  {
    slug: 'architecture',
    file: 'ARCHITECTURE.md',
    title: 'Architecture',
    group: 'Comprendre',
  },
  {
    slug: 'securite',
    file: 'SECURITE.md',
    title: 'Sécurité',
    group: 'Comprendre',
  },
  {
    slug: 'api',
    file: 'API.md',
    title: 'API HTTP',
    group: 'Référence',
  },
  {
    slug: 'deploiement',
    file: 'DEPLOIEMENT.md',
    title: 'Déploiement',
    group: 'Référence',
  },
  {
    slug: 'audit',
    file: 'AUDIT.md',
    title: 'Audit',
    group: 'Référence',
  },
];

const FILE_TO_SLUG = Object.fromEntries(
  PAGES.map((page) => [page.file.toLowerCase(), page.slug]),
);

const $ = (sel) => document.querySelector(sel);

function currentSlug() {
  const parts = location.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts[0] !== 'docs') return 'introduction';
  return parts[1] || 'introduction';
}

function pageBySlug(slug) {
  return PAGES.find((page) => page.slug === slug) || PAGES[0];
}

function docsPath(slug) {
  return slug === 'introduction' ? '/docs/' : `/docs/${slug}/`;
}

function resolveDocLink(href) {
  if (!href) return href;
  if (/^(https?:|mailto:|#)/i.test(href)) return href;

  const clean = href.split('#')[0].replace(/^\.\//, '').replace(/^\//, '');
  const file = clean.split('/').pop()?.toLowerCase() || '';
  const slug = FILE_TO_SLUG[file];
  if (slug) {
    const hash = href.includes('#') ? `#${href.split('#')[1]}` : '';
    return `${docsPath(slug)}${hash}`;
  }
  if (href.endsWith('.md')) {
    return `https://github.com/alphabarry015/Gardefort/blob/main/docs/${clean}`;
  }
  return href;
}

function renderSidebar(activeSlug) {
  const nav = $('#docs-nav');
  if (!nav) return;

  const groups = [];
  for (const page of PAGES) {
    let group = groups.find((g) => g.name === page.group);
    if (!group) {
      group = { name: page.group, pages: [] };
      groups.push(group);
    }
    group.pages.push(page);
  }

  nav.innerHTML = groups.map((group) => `
    <div class="docs-nav-group">
      <p class="docs-nav-group-title">${group.name}</p>
      <ul>
        ${group.pages.map((page) => `
          <li>
            <a
              href="${docsPath(page.slug)}"
              class="docs-nav-link${page.slug === activeSlug ? ' active' : ''}"
              data-slug="${page.slug}"
            >${page.title}</a>
          </li>
        `).join('')}
      </ul>
    </div>
  `).join('');
}

function renderToc(headings) {
  const toc = $('#docs-toc');
  const tocNav = $('#docs-toc-nav');
  if (!toc || !tocNav) return;

  const items = headings.filter((h) => h.level >= 2 && h.level <= 3);
  if (!items.length) {
    toc.hidden = true;
    tocNav.innerHTML = '';
    return;
  }

  toc.hidden = false;
  tocNav.innerHTML = items.map((item) => `
    <a href="#${item.id}" class="docs-toc-link level-${item.level}">${item.text}</a>
  `).join('');
}

function setSidebarOpen(open) {
  document.body.classList.toggle('docs-sidebar-open', open);
  const backdrop = $('#docs-backdrop');
  if (backdrop) backdrop.hidden = !open;
}

async function loadPage(slug, { push = false } = {}) {
  const page = pageBySlug(slug);
  const loading = $('#docs-loading');
  const content = $('#docs-content');
  const error = $('#docs-error');
  const titleEl = $('#docs-topbar-title');

  if (push) {
    history.pushState({ slug: page.slug }, '', docsPath(page.slug));
  }

  document.title = `${page.title} — Clefkey. Docs`;
  if (titleEl) titleEl.textContent = page.title;
  renderSidebar(page.slug);
  setSidebarOpen(false);

  if (loading) loading.hidden = false;
  if (content) {
    content.hidden = true;
    content.innerHTML = '';
  }
  if (error) error.hidden = true;

  try {
    const response = await fetch(`/docs-content/${page.file}`, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Impossible de charger ${page.file}`);
    const markdown = await response.text();
    const { html, headings } = renderMarkdown(markdown, { linkResolver: resolveDocLink });
    if (content) {
      content.innerHTML = html;
      content.hidden = false;
    }
    renderToc(headings);
    if (location.hash) {
      const target = document.getElementById(location.hash.slice(1));
      target?.scrollIntoView({ block: 'start' });
    } else {
      $('.docs-main')?.scrollTo({ top: 0 });
      window.scrollTo({ top: 0 });
    }
  } catch (err) {
    if (error) {
      error.hidden = false;
      error.textContent = err.message || 'Erreur de chargement de la documentation.';
    }
    renderToc([]);
  } finally {
    if (loading) loading.hidden = true;
  }
}

function bindUi() {
  $('#docs-menu-btn')?.addEventListener('click', () => setSidebarOpen(true));
  $('#docs-sidebar-close')?.addEventListener('click', () => setSidebarOpen(false));
  $('#docs-backdrop')?.addEventListener('click', () => setSidebarOpen(false));

  $('#docs-nav')?.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-slug]');
    if (!link) return;
    event.preventDefault();
    loadPage(link.dataset.slug, { push: true });
  });

  $('#docs-content')?.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    const url = new URL(link.href, location.origin);
    if (url.origin !== location.origin) return;
    if (!url.pathname.startsWith('/docs')) return;
    event.preventDefault();
    const slug = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean)[1] || 'introduction';
    loadPage(slug, { push: true }).then(() => {
      if (url.hash) {
        document.getElementById(url.hash.slice(1))?.scrollIntoView({ block: 'start' });
      }
    });
  });

  window.addEventListener('popstate', () => {
    loadPage(currentSlug());
  });
}

bindUi();
loadPage(currentSlug());
