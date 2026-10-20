/**
 * Page Télécharger — CTA plateforme + pixels hero (perf / a11y).
 * URLs centralisées pour maintenance.
 */
(function () {
  const DOWNLOADS = {
    windows:
      'https://github.com/alphabarry015/clefkey-app-desktop/releases/latest/download/Clefkey-Setup.exe',
    macos:
      'https://github.com/alphabarry015/clefkey-app-desktop/releases/latest/download/Clefkey-macOS.dmg',
  };

  const winBtn = document.getElementById('btn-dl-windows');
  const macBtn = document.getElementById('btn-dl-macos');
  if (winBtn) winBtn.href = DOWNLOADS.windows;
  if (macBtn) macBtn.href = DOWNLOADS.macos;

  const ua = navigator.userAgent || '';
  const platform = (navigator.platform || '').toLowerCase();
  let os = 'other';
  if (/windows|win32|win64/i.test(ua) || platform.includes('win')) os = 'windows';
  else if (/mac os x|macintosh|macintel/i.test(ua) || platform.includes('mac')) os = 'macos';

  const btn = document.querySelector(`.dl-hero-actions [data-platform="${os}"]`);
  if (btn) btn.classList.add('is-suggested');

  const hero = document.querySelector('.dl-hero');
  const canvas = document.querySelector('.dl-hero-pixels');
  if (!hero || !canvas) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  const COUNT = window.matchMedia('(max-width: 720px)').matches ? 36 : 64;
  const particles = [];
  let w = 0;
  let h = 0;
  let mouseX = -9999;
  let mouseY = -9999;
  let hasMouse = false;
  let raf = 0;

  function resize() {
    const rect = hero.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = rect.width;
    h = rect.height;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function scatterHomes() {
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      p.homeX = Math.random() * Math.max(w, 1);
      p.homeY = Math.random() * Math.max(h, 1);
      const angle = Math.random() * Math.PI * 2;
      const force = 2.5 + Math.random() * 5.5;
      p.vx = Math.cos(angle) * force;
      p.vy = Math.sin(angle) * force;
    }
  }

  function spawn() {
    particles.length = 0;
    for (let i = 0; i < COUNT; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 12 + Math.random() * 90;
      particles.push({
        x: Math.random() * Math.max(w, 1),
        y: Math.random() * Math.max(h, 1),
        homeX: 0,
        homeY: 0,
        ox: Math.cos(angle) * dist,
        oy: Math.sin(angle) * dist,
        vx: 0,
        vy: 0,
        lag: 0.04 + Math.random() * 0.1,
        size: 1.6 + Math.random() * 2.4,
        alpha: 0.3 + Math.random() * 0.5,
        drift: Math.random() * Math.PI * 2,
        driftSpeed: 0.01 + Math.random() * 0.02,
      });
    }
    scatterHomes();
  }

  function frame() {
    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      p.drift += p.driftSpeed;

      if (hasMouse) {
        const wobble = 4 + Math.sin(p.drift) * 3;
        const tx = mouseX + p.ox + Math.cos(p.drift) * wobble;
        const ty = mouseY + p.oy + Math.sin(p.drift) * wobble;
        p.vx *= 0.85;
        p.vy *= 0.85;
        p.x += (tx - p.x) * p.lag + p.vx;
        p.y += (ty - p.y) * p.lag + p.vy;
      } else {
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.x += p.vx + (p.homeX - p.x) * 0.018;
        p.y += p.vy + (p.homeY - p.y) * 0.018;
        p.homeX += Math.cos(p.drift) * 0.15;
        p.homeY += Math.sin(p.drift * 0.7) * 0.15;
      }

      ctx.fillStyle = `rgba(47, 95, 240, ${p.alpha})`;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }

    raf = requestAnimationFrame(frame);
  }

  function onMove(event) {
    const rect = hero.getBoundingClientRect();
    mouseX = event.clientX - rect.left;
    mouseY = event.clientY - rect.top;
    hasMouse = true;
  }

  function onLeave() {
    hasMouse = false;
    scatterHomes();
  }

  let resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
    }, 120);
  }

  resize();
  spawn();
  hero.addEventListener('pointermove', onMove, { passive: true });
  hero.addEventListener('pointerleave', onLeave);
  window.addEventListener('resize', onResize, { passive: true });
  raf = requestAnimationFrame(frame);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf) {
      raf = requestAnimationFrame(frame);
    }
  });
})();
