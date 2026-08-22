/**
 * Rendu Markdown (sous-ensemble GFM) pour la documentation Clefkey.
 * Pas de dépendance externe : titres, listes, tableaux, code, liens, gras.
 */

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Autorise https?, mailto:, ancres #, chemins relatifs ; bloque javascript:/data: etc. */
function sanitizeHref(href) {
  const value = String(href ?? '').trim();
  if (!value) return '#';
  if (value.startsWith('#')) return value;
  if (/^(https?:|mailto:)/i.test(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return '#';
  if (value.startsWith('//')) return '#';
  return value;
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'section';
}

function inlineMarkdown(text, linkResolver) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const resolved = sanitizeHref(linkResolver ? linkResolver(href) : href);
    const external = /^https?:\/\//i.test(resolved);
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${escapeHtml(resolved)}"${attrs}>${label}</a>`;
  });
  return out;
}

function isTableSeparator(line) {
  return /^\|?[\s:|-]+\|[\s:|-]+\|?$/.test(line.trim()) && /---/.test(line);
}

function parseTable(lines, start, linkResolver) {
  const header = lines[start].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  let i = start + 1;
  if (!lines[i] || !isTableSeparator(lines[i])) return null;
  i += 1;
  const rows = [];
  while (i < lines.length && lines[i].includes('|')) {
    rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
    i += 1;
  }
  let html = '<div class="md-table-wrap"><table><thead><tr>';
  header.forEach((cell) => {
    html += `<th>${inlineMarkdown(cell, linkResolver)}</th>`;
  });
  html += '</tr></thead><tbody>';
  rows.forEach((row) => {
    html += '<tr>';
    header.forEach((_, idx) => {
      html += `<td>${inlineMarkdown(row[idx] || '', linkResolver)}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  return { html, next: i };
}

/**
 * @param {string} source
 * @param {{ linkResolver?: (href: string) => string }} [options]
 * @returns {{ html: string, headings: Array<{ id: string, text: string, level: number }> }}
 */
export function renderMarkdown(source, options = {}) {
  const linkResolver = options.linkResolver;
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  const headings = [];
  const slugCounts = new Map();
  const parts = [];
  let i = 0;
  let paragraph = [];

  function uniqueSlug(text) {
    const base = slugify(text);
    const n = slugCounts.get(base) || 0;
    slugCounts.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  }

  function flushParagraph() {
    if (!paragraph.length) return;
    const text = paragraph.join(' ').trim();
    paragraph = [];
    if (text) parts.push(`<p>${inlineMarkdown(text, linkResolver)}</p>`);
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      flushParagraph();
      const lang = trimmed.slice(3).trim();
      i += 1;
      const code = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      const langClass = escapeHtml(lang || 'text');
      const codeHtml = escapeHtml(code.join('\n'));
      parts.push(`<pre class="md-pre"><code class="language-${langClass}">${codeHtml}</code></pre>`);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      i += 1;
      continue;
    }

    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushParagraph();
      const table = parseTable(lines, i, linkResolver);
      if (table) {
        parts.push(table.html);
        i = table.next;
        continue;
      }
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const text = heading[2].replace(/\s+#*\s*$/, '').trim();
      const id = uniqueSlug(text);
      headings.push({ id, text, level });
      parts.push(`<h${level} id="${escapeHtml(id)}">${inlineMarkdown(text, linkResolver)}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      const ordered = /^\d+\.\s+/.test(trimmed);
      const items = [];
      while (i < lines.length) {
        const item = lines[i].trim();
        const match = ordered ? /^(\d+)\.\s+(.+)$/.exec(item) : /^[-*]\s+(.+)$/.exec(item);
        if (!match) break;
        items.push(inlineMarkdown(ordered ? match[2] : match[1], linkResolver));
        i += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      parts.push(`<${tag}>${items.map((item) => `<li>${item}</li>`).join('')}</${tag}>`);
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      parts.push('<hr>');
      i += 1;
      continue;
    }

    if (trimmed.startsWith('> ')) {
      flushParagraph();
      const quote = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quote.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      parts.push(`<blockquote><p>${inlineMarkdown(quote.join(' '), linkResolver)}</p></blockquote>`);
      continue;
    }

    paragraph.push(trimmed);
    i += 1;
  }

  flushParagraph();
  return { html: parts.join('\n'), headings };
}
