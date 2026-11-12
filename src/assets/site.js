// Small touches of motion: numbers count up and cards fade in as they scroll into view.
// Everything is visible without JS, and both are skipped for reduced-motion users.
(() => {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reveals = [...document.querySelectorAll('.reveal')];
  const counters = [...document.querySelectorAll('[data-count]')];
  const showAll = () => reveals.forEach((el) => el.classList.add('in'));
  // email pop-up: address is stored split in a JSON block and joined here, to keep it from scrapers
  const dlg = document.getElementById('mail-dialog');
  const parts = document.getElementById('mail-data');
  if (dlg && parts && dlg.showModal) {
    const address = JSON.parse(parts.textContent).join('@');
    const to = dlg.querySelector('#mail-to');
    to.value = address;
    document.querySelectorAll('[data-email-open]').forEach((b) => b.addEventListener('click', () => dlg.showModal()));
    dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // click the backdrop to close
    dlg.querySelector('[data-send]').addEventListener('click', () => {
      const subject = encodeURIComponent(dlg.querySelector('#mail-subject').value);
      const body = encodeURIComponent(dlg.querySelector('#mail-body').value);
      location.href = `mailto:${address}?subject=${subject}&body=${body}`;
      dlg.close();
    });
    const copy = dlg.querySelector('[data-copy]');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(address); } catch { to.select(); document.execCommand('copy'); }
      copy.textContent = 'Copied ✓'; copy.classList.add('done');
      setTimeout(() => { copy.textContent = 'Copy'; copy.classList.remove('done'); }, 1800);
    });
  } else if (parts) {
    // very old browsers without <dialog>: fall back to a plain mailto link
    const address = JSON.parse(parts.textContent).join('@');
    document.querySelectorAll('[data-email-open]').forEach((b) => b.addEventListener('click', () => { location.href = `mailto:${address}`; }));
  }

  // 3D tilt: cards lean towards the pointer (mouse/trackpad only)
  if (!still && matchMedia('(hover: hover)').matches) {
    document.querySelectorAll('.card[class*="tint-"]').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = `perspective(700px) rotateX(${(-y * 7).toFixed(2)}deg) rotateY(${(x * 9).toFixed(2)}deg) translateY(-4px)`;
      });
      card.addEventListener('pointerleave', () => { card.style.transform = ''; });
    });
  }

  // ripple on nav buttons, starting where the pointer pressed
  document.querySelectorAll('.links .pill').forEach((btn) => btn.addEventListener('pointerdown', (ev) => {
    const r = btn.getBoundingClientRect(), d = Math.max(r.width, r.height);
    const dot = document.createElement('span');
    dot.className = 'ripple';
    Object.assign(dot.style, { width: d + 'px', height: d + 'px', left: ev.clientX - r.left - d / 2 + 'px', top: ev.clientY - r.top - d / 2 + 'px' });
    btn.appendChild(dot);
    dot.addEventListener('animationend', () => dot.remove());
  }));

  if (still || !('IntersectionObserver' in window)) { showAll(); return; }

  function countUp(el) {
    const text = el.textContent.trim();
    const m = text.match(/[\d.,]+/);
    if (!m) return;
    const target = parseFloat(m[0].replace(/,/g, ''));
    const decimals = (m[0].split('.')[1] || '').length;
    const [pre, post] = [text.slice(0, m.index), text.slice(m.index + m[0].length)];
    const fmt = (v) => pre + v.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + post;
    const t0 = performance.now(), dur = 1100;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur), eased = 1 - (1 - p) ** 3;
      el.textContent = fmt(target * eased);
      if (p < 1) requestAnimationFrame(step); else el.textContent = text;
    };
    requestAnimationFrame(step);
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const i = reveals.indexOf(e.target);
      e.target.style.transitionDelay = `${(i % 3) * 90}ms`;
      e.target.classList.add('in');
      e.target.addEventListener('transitionend', () => { e.target.style.transitionDelay = ''; }, { once: true });
      e.target.querySelectorAll('[data-count]').forEach(countUp);
      io.unobserve(e.target);
    });
  }, { threshold: 0.15 });
  reveals.forEach((el) => io.observe(el));
  counters.filter((c) => !c.closest('.reveal')).forEach(countUp);
  setTimeout(showAll, 2500); // safety net: never leave anything hidden
})();
