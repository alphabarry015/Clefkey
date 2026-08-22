/**
 * Export local de TOUTES les clés du coffre (TXT et PDF multi-pages).
 *
 * Les entrées reçues sont déjà déchiffrées côté client : rien n'est envoyé au
 * serveur, aucune librairie externe n'est utilisée (PDF écrit à la main).
 */
import { folderNameById, entryFolderId } from './folders.js';

const TYPE_LABELS = {
  login: 'Connexion',
  oauth: 'OAuth / SSO',
  api_key: 'Clé API',
  ssh_key: 'SSH / stockage',
};

const SECRET_LABELS = {
  login: 'Mot de passe',
  oauth: 'Mot de passe',
  api_key: 'Clé API',
  ssh_key: 'Clé privée',
};

/* ── Géométrie ─────────────────────────────────────────── */
const PDF_PAGE_W = 595.28; // A4 portrait (points)
const PDF_PAGE_H = 841.89;
const PDF_MARGIN = 28;
const CANVAS_W = 900;
const PAD = 40;

const MONO_FONT = '600 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const LABEL_FONT = '600 12px "Segoe UI", system-ui, sans-serif';
const TITLE_FONT = '700 15px "Segoe UI", system-ui, sans-serif';
const SMALL_FONT = '400 12px "Segoe UI", system-ui, sans-serif';

const LINE_H = 20;
const TITLE_H = 24;
const META_H = 18;
const BOX_PAD = 14;
const FIELD_GAP = 4;
const BOX_GAP = 12;
const FIRST_HEADER_H = 172;
const CONT_HEADER_H = 58;
const FOOTER_H = 26;

/** Hauteur de canvas correspondant à une page A4 une fois mise à l'échelle. */
const PAGE_SCALE = (PDF_PAGE_W - PDF_MARGIN * 2) / CANVAS_W;
const PAGE_SRC_H = Math.floor((PDF_PAGE_H - PDF_MARGIN * 2) / PAGE_SCALE);

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function localStamp(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function localDateTime(date) {
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()} `
    + `à ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function entryTypeKey(entry) {
  const t = entry?.type;
  return TYPE_LABELS[t] ? t : 'login';
}

function entryProjectName(entry, folders) {
  return folderNameById(folders || [], entryFolderId(entry) || '') || 'Sans projet';
}

/** Champs exportés d'une clé, dans l'ordre d'affichage. */
function entryFields(entry) {
  const type = entryTypeKey(entry);
  const fields = [
    { label: type === 'oauth' ? 'Email du compte' : 'Identifiant', value: (entry?.username || '').trim() || '—' },
  ];
  if (type === 'oauth') {
    fields.push({ label: 'Mot de passe', value: 'Aucun (connexion via le fournisseur)' });
  } else {
    fields.push({ label: SECRET_LABELS[type], value: entry?.password || '—' });
  }
  const url = (entry?.url || '').trim();
  if (url) fields.push({ label: 'URL', value: url });
  const notes = (entry?.notes || '').trim();
  if (notes) fields.push({ label: 'Notes', value: notes });
  return fields;
}

/* ── Export TXT ────────────────────────────────────────── */

export function entriesAsText(entries, { email = '', folders = [] } = {}) {
  const now = new Date();
  const list = entries || [];
  const header = [
    'Clefkey. — Export complet du coffre',
    email ? `Compte : ${email}` : '',
    `Date : ${localDateTime(now)}`,
    `Nombre de clés : ${list.length}`,
    '',
    '/!\\ Ce fichier contient TOUS vos secrets en clair.',
    'Conservez-le hors ligne et supprimez-le après usage.',
  ].filter((line, i, arr) => line !== '' || arr[i - 1] !== '');

  const blocks = list.map((entry, i) => {
    const lines = [
      '='.repeat(60),
      `${i + 1}. ${entry?.title || 'Sans titre'}`,
      `Type : ${TYPE_LABELS[entryTypeKey(entry)]}`,
      `Projet : ${entryProjectName(entry, folders)}`,
    ];
    entryFields(entry).forEach((f) => {
      const value = String(f.value);
      if (value.includes('\n')) lines.push(`${f.label} :`, value);
      else lines.push(`${f.label} : ${value}`);
    });
    return lines.join('\n');
  });

  return [...header, '', ...blocks, '='.repeat(60), ''].join('\n');
}

export function downloadEntriesTxt(entries, meta = {}) {
  const blob = new Blob([entriesAsText(entries, meta)], { type: 'text/plain;charset=utf-8' });
  downloadBlob(`clefkey-export-${localStamp(new Date())}.txt`, blob);
}

/* ── Mise en page PDF ──────────────────────────────────── */

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let current = '';
  for (const ch of String(text)) {
    const next = current + ch;
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = ch;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

/** Découpe un champ en lignes rendues (label sur la 1re ligne). */
function layoutField(measure, field, maxWidth) {
  measure.font = LABEL_FONT;
  const label = `${field.label} : `;
  const labelW = measure.measureText(label).width;
  measure.font = MONO_FONT;
  const lines = [];
  String(field.value).split('\n').forEach((physical) => {
    const width = lines.length === 0 ? maxWidth - labelW : maxWidth;
    wrapText(measure, physical === '' ? ' ' : physical, width).forEach((l) => lines.push(l));
  });
  return { label, labelW, lines };
}

function fieldHeight(field) {
  return field.lines.length * LINE_H + FIELD_GAP;
}

/** Bloc = une clé complète, prêt à être peint. */
function buildBlock(measure, entry, index, folders, maxWidth) {
  const fields = entryFields(entry).map((f) => layoutField(measure, f, maxWidth));
  const head = BOX_PAD + TITLE_H + META_H;
  const body = fields.reduce((sum, f) => sum + fieldHeight(f), 0);
  return {
    title: `${index + 1}. ${entry?.title || 'Sans titre'}`,
    meta: `${TYPE_LABELS[entryTypeKey(entry)]} · ${entryProjectName(entry, folders)}`,
    fields,
    height: head + body + BOX_PAD,
  };
}

function blockPartHeight(part) {
  const head = BOX_PAD + (part.continuation ? TITLE_H : TITLE_H + META_H);
  return head + part.fields.reduce((sum, f) => sum + fieldHeight(f), 0) + BOX_PAD;
}

/**
 * Découpe un bloc trop grand pour une page en plusieurs parties.
 * Aucune donnée n'est perdue : les lignes restantes passent à la page suivante.
 */
function splitBlock(block, firstCapacity, capacity) {
  const parts = [];
  let queue = block.fields.map((f) => ({ ...f, lines: [...f.lines] }));
  let continuation = false;
  let available = firstCapacity;

  while (queue.length) {
    const head = BOX_PAD + (continuation ? TITLE_H : TITLE_H + META_H) + BOX_PAD;
    let room = Math.max(LINE_H, available - head);
    const taken = [];
    const rest = [];
    for (const field of queue) {
      if (rest.length) {
        rest.push(field);
        continue;
      }
      const maxLines = Math.floor((room - FIELD_GAP) / LINE_H);
      if (maxLines <= 0) {
        rest.push(field);
        continue;
      }
      if (field.lines.length <= maxLines) {
        taken.push(field);
        room -= fieldHeight(field);
      } else {
        taken.push({ ...field, lines: field.lines.slice(0, maxLines) });
        rest.push({ ...field, label: `${field.label.replace(' : ', '')} (suite) : `, lines: field.lines.slice(maxLines) });
        room = 0;
      }
    }
    if (!taken.length) taken.push(queue[0]);
    const part = {
      title: continuation ? `${block.title} (suite)` : block.title,
      meta: block.meta,
      fields: taken,
      continuation,
    };
    part.height = blockPartHeight(part);
    parts.push(part);
    queue = rest;
    continuation = true;
    available = capacity;
  }
  return parts;
}

/** Répartit les blocs en pages (sans jamais couper inutilement une clé). */
function paginateBlocks(blocks) {
  const pages = [];
  let current = { items: [], used: FIRST_HEADER_H, first: true };
  const capacityOf = (page) => PAGE_SRC_H - FOOTER_H - (page.first ? FIRST_HEADER_H : CONT_HEADER_H);

  const pushPage = () => {
    pages.push(current);
    current = { items: [], used: CONT_HEADER_H, first: false };
  };

  for (const block of blocks) {
    const remaining = PAGE_SRC_H - FOOTER_H - current.used;
    const fullCapacity = capacityOf({ first: false });

    if (block.height <= remaining) {
      current.items.push(block);
      current.used += block.height + BOX_GAP;
      continue;
    }
    if (block.height <= fullCapacity) {
      if (current.items.length) pushPage();
      current.items.push(block);
      current.used += block.height + BOX_GAP;
      continue;
    }
    const parts = splitBlock(block, remaining, fullCapacity);
    parts.forEach((part, i) => {
      if (i > 0 || (part.height > remaining && current.items.length)) pushPage();
      current.items.push(part);
      current.used += part.height + BOX_GAP;
    });
  }
  if (current.items.length || !pages.length) pages.push(current);
  return pages;
}

/* ── Peinture ──────────────────────────────────────────── */

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function paintHeader(ctx, page, meta, pageIndex) {
  let y = PAD + 8;
  if (page.first) {
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 28px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Clefkey.', PAD, y);
    y += 32;

    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 14px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(`Export complet du coffre — ${meta.count} clé(s)`, PAD, y);
    y += 26;

    if (meta.email) {
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '400 13px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(`Compte : ${meta.email}`, PAD, y);
      y += 22;
    }

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '400 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(`Généré le ${meta.date}`, PAD, y);
    y += 26;

    ctx.fillStyle = '#fca5a5';
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(
      'Ce document contient tous vos secrets en clair — conservez-le hors ligne.',
      PAD,
      y,
    );
    return FIRST_HEADER_H;
  }

  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 18px "Segoe UI", system-ui, sans-serif';
  ctx.fillText('Clefkey.', PAD, y);
  ctx.fillStyle = '#64748b';
  ctx.font = SMALL_FONT;
  ctx.fillText(`Export du coffre (suite) — page ${pageIndex + 1}`, PAD + 100, y);
  return CONT_HEADER_H;
}

function paintBlock(ctx, item, y, width) {
  const height = item.height;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.35)';
  ctx.lineWidth = 1;
  roundRect(ctx, PAD, y, width, height, 8);
  ctx.fill();
  ctx.stroke();

  let ty = y + BOX_PAD + 16;
  ctx.fillStyle = '#e2e8f0';
  ctx.font = TITLE_FONT;
  ctx.fillText(item.title, PAD + 14, ty);
  ty += TITLE_H - 8;

  if (!item.continuation) {
    ctx.fillStyle = '#60a5fa';
    ctx.font = SMALL_FONT;
    ctx.fillText(item.meta, PAD + 14, ty);
    ty += META_H;
  }

  item.fields.forEach((field) => {
    field.lines.forEach((line, i) => {
      let x = PAD + 14;
      if (i === 0) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = LABEL_FONT;
        ctx.fillText(field.label, x, ty + 14);
        x += field.labelW;
      }
      ctx.fillStyle = '#e2e8f0';
      ctx.font = MONO_FONT;
      ctx.fillText(line, x, ty + 14);
      ty += LINE_H;
    });
    ty += FIELD_GAP;
  });

  return y + height + BOX_GAP;
}

function paintPage(page, meta, pageIndex, pageCount) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(CANVAS_W * dpr);
  canvas.height = Math.round(PAGE_SRC_H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const grad = ctx.createLinearGradient(0, 0, CANVAS_W, PAGE_SRC_H);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(1, '#1e293b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, PAGE_SRC_H);

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(20, 20, CANVAS_W - 40, PAGE_SRC_H - 40);

  const headerH = paintHeader(ctx, page, meta, pageIndex);
  let y = headerH;
  const width = CANVAS_W - PAD * 2;
  page.items.forEach((item) => {
    y = paintBlock(ctx, item, y, width);
  });

  ctx.fillStyle = '#64748b';
  ctx.font = '400 11px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(`Page ${pageIndex + 1} / ${pageCount}`, PAD, PAGE_SRC_H - PAD + 6);
  ctx.fillText(
    'Généré localement par Clefkey. — ne partagez ce document avec personne.',
    PAD + 90,
    PAGE_SRC_H - PAD + 6,
  );

  return canvas;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('Export image impossible'));
      else resolve(blob);
    }, type, quality);
  });
}

/* ── Assemblage PDF multi-pages ────────────────────────── */

function buildPagedJpegPdf(pages) {
  const encoder = new TextEncoder();
  const out = [];
  let offset = 0;
  const write = (chunk) => {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
    out.push(bytes);
    offset += bytes.length;
  };

  const maxW = PDF_PAGE_W - PDF_MARGIN * 2;
  const maxH = PDF_PAGE_H - PDF_MARGIN * 2;
  const placements = pages.map(({ imgW, imgH }) => {
    const scale = Math.min(maxW / imgW, maxH / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    return {
      drawW,
      drawH,
      x: (PDF_PAGE_W - drawW) / 2,
      y: PDF_PAGE_H - PDF_MARGIN - drawH,
    };
  });

  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  const objects = [
    null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
  ];

  const xref = [0];
  write('%PDF-1.4\n');
  for (let i = 1; i <= 2; i += 1) {
    xref.push(offset);
    write(`${i} 0 obj\n${objects[i]}\nendobj\n`);
  }

  pages.forEach((page, i) => {
    const pageNum = 3 + i * 3;
    const contentNum = pageNum + 1;
    const imageNum = pageNum + 2;
    const place = placements[i];
    const stream = `q\n${place.drawW.toFixed(2)} 0 0 ${place.drawH.toFixed(2)} `
      + `${place.x.toFixed(2)} ${place.y.toFixed(2)} cm\n/Im${i + 1} Do\nQ\n`;
    const streamLen = encoder.encode(stream).length;

    xref.push(offset);
    write(
      `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R `
      + `/MediaBox [0 0 ${PDF_PAGE_W.toFixed(2)} ${PDF_PAGE_H.toFixed(2)}] `
      + `/Resources << /XObject << /Im${i + 1} ${imageNum} 0 R >> >> `
      + `/Contents ${contentNum} 0 R >>\nendobj\n`,
    );

    xref.push(offset);
    write(`${contentNum} 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}endstream\nendobj\n`);

    xref.push(offset);
    write(
      `${imageNum} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.imgW} `
      + `/Height ${page.imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 `
      + `/Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`,
    );
    write(page.bytes);
    write('\nendstream\nendobj\n');
  });

  const xrefStart = offset;
  write(`xref\n0 ${xref.length}\n`);
  write('0000000000 65535 f \n');
  for (let i = 1; i < xref.length; i += 1) {
    write(`${String(xref[i]).padStart(10, '0')} 00000 n \n`);
  }
  write(`trailer\n<< /Size ${xref.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  const total = out.reduce((n, b) => n + b.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (const chunk of out) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}

/** Canvas (un par page) prêts pour l'export PDF — exposé pour les tests. */
export function buildEntriesPageCanvases(entries, { email = '', folders = [] } = {}) {
  const measure = document.createElement('canvas').getContext('2d');
  const maxWidth = CANVAS_W - PAD * 2 - 28;
  const blocks = (entries || []).map((entry, i) => buildBlock(measure, entry, i, folders, maxWidth));
  const pages = paginateBlocks(blocks);
  const meta = {
    email,
    count: (entries || []).length,
    date: localDateTime(new Date()),
  };
  return pages.map((page, i) => paintPage(page, meta, i, pages.length));
}

export async function downloadEntriesPdf(entries, meta = {}) {
  const canvases = buildEntriesPageCanvases(entries, meta);
  const pages = [];
  for (const canvas of canvases) {
    // eslint-disable-next-line no-await-in-loop
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
    pages.push({
      // eslint-disable-next-line no-await-in-loop
      bytes: new Uint8Array(await blob.arrayBuffer()),
      imgW: canvas.width,
      imgH: canvas.height,
    });
  }
  const pdf = buildPagedJpegPdf(pages);
  downloadBlob(
    `clefkey-export-${localStamp(new Date())}.pdf`,
    new Blob([pdf], { type: 'application/pdf' }),
  );
}
