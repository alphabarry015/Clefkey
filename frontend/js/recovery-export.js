/**
 * Export local des clés de récupération (texte, PNG, PDF).
 * Rien n'est envoyé au serveur.
 */

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

export function recoveryCodesAsText(codes, email = '') {
  const header = [
    'Gardefort — Clés de récupération',
    email ? `Compte : ${email}` : '',
    `Nombre : ${codes.length}`,
    'Une seule clé suffit pour réinitialiser le mot de passe maître.',
    'Conservez ce fichier hors ligne. Ne le partagez avec personne.',
    '',
  ].filter((line, i, arr) => line !== '' || arr[i - 1] !== '');
  const body = codes.map((code, i) => `${i + 1}. ${code}`);
  return [...header, ...body, ''].join('\n');
}

function wrapMonospace(ctx, text, maxWidth) {
  const chars = String(text);
  const lines = [];
  let current = '';
  for (const ch of chars) {
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

/** Canvas prêt à l'export PNG / PDF. */
export function buildRecoveryKeysCanvas(codes, email = '') {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = 900;
  const pad = 40;
  const codeLineH = 20;
  const monoFont = '600 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  const measure = document.createElement('canvas').getContext('2d');
  measure.font = monoFont;
  const maxText = width - pad * 2 - 36;

  let contentH = 36 + 28 + (email ? 24 : 0) + 18;
  for (const code of codes) {
    const wrapped = wrapMonospace(measure, code, maxText);
    contentH += 10 + Math.max(28, wrapped.length * codeLineH + 16);
  }
  contentH += 48;
  const height = Math.max(640, pad * 2 + contentH);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(1, '#1e293b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(20, 20, width - 40, height - 40);

  let y = pad + 8;
  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 28px "Segoe UI", system-ui, sans-serif';
  ctx.fillText('Gardefort', pad, y);
  y += 32;

  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 14px "Segoe UI", system-ui, sans-serif';
  ctx.fillText('Clés de récupération', pad, y);
  y += 26;

  if (email) {
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '400 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(`Compte : ${email}`, pad, y);
    y += 24;
  }

  ctx.fillStyle = '#64748b';
  ctx.font = '400 12px "Segoe UI", system-ui, sans-serif';
  ctx.fillText('Une seule clé suffit. Conservez ce document hors ligne.', pad, y);
  y += 22;

  codes.forEach((code, i) => {
    measure.font = monoFont;
    const wrapped = wrapMonospace(measure, code, maxText);
    const boxH = Math.max(36, wrapped.length * codeLineH + 16);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
    ctx.strokeStyle = 'rgba(96, 165, 250, 0.35)';
    ctx.lineWidth = 1;
    roundRect(ctx, pad, y, width - pad * 2, boxH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#60a5fa';
    ctx.font = '700 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(String(i + 1), pad + 12, y + 22);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = monoFont;
    let ty = y + 22;
    for (const line of wrapped) {
      ctx.fillText(line, pad + 36, ty);
      ty += codeLineH;
    }
    y += boxH + 10;
  });

  ctx.fillStyle = '#64748b';
  ctx.font = '400 11px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(
    'Ne partagez ces clés avec personne. Gardefort ne peut pas les récupérer.',
    pad,
    height - pad,
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

export async function downloadRecoveryKeysPng(codes, email = '') {
  const canvas = buildRecoveryKeysCanvas(codes, email);
  const blob = await canvasToBlob(canvas, 'image/png');
  downloadBlob('gardefort-recovery-keys.png', blob);
}

/** PDF une page contenant l'image JPEG du canvas (sans lib externe). */
export async function downloadRecoveryKeysPdf(codes, email = '') {
  const canvas = buildRecoveryKeysCanvas(codes, email);
  const jpegBlob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
  const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
  const imgW = canvas.width;
  const imgH = canvas.height;
  const pageW = 595.28;
  const pageH = 841.89;
  const margin = 28;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;
  const scale = Math.min(maxW / imgW, maxH / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const x = (pageW - drawW) / 2;
  const y = (pageH - drawH) / 2;

  const pdf = buildJpegPdf({
    jpegBytes,
    imgW,
    imgH,
    pageW,
    pageH,
    x,
    y,
    drawW,
    drawH,
  });
  downloadBlob('gardefort-recovery-keys.pdf', new Blob([pdf], { type: 'application/pdf' }));
}

function buildJpegPdf({ jpegBytes, imgW, imgH, pageW, pageH, x, y, drawW, drawH }) {
  const encoder = new TextEncoder();
  const contentStream =
    `q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im1 Do\nQ\n`;
  const contentLen = encoder.encode(contentStream).length;

  const objects = [
    null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] `
      + `/Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${contentLen} >>\nstream\n${contentStream}endstream`,
  ];

  const out = [];
  let offset = 0;
  const write = (chunk) => {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
    out.push(bytes);
    offset += bytes.length;
  };

  write('%PDF-1.4\n');
  const xref = [0];
  for (let i = 1; i <= 4; i += 1) {
    xref.push(offset);
    write(`${i} 0 obj\n${objects[i]}\nendobj\n`);
  }

  xref.push(offset);
  write(
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} `
      + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
  );
  write(jpegBytes);
  write('\nendstream\nendobj\n');

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

export function downloadRecoveryKeysTxt(codes, email = '') {
  const blob = new Blob([recoveryCodesAsText(codes, email)], { type: 'text/plain;charset=utf-8' });
  downloadBlob('gardefort-recovery-keys.txt', blob);
}
