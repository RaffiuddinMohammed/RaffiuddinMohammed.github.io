// Small touches of motion: numbers count up and cards fade in as they scroll into view.
// Everything is visible without JS, and both are skipped for reduced-motion users.
(() => {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reveals = [...document.querySelectorAll('.reveal')];
  const counters = [...document.querySelectorAll('[data-count]')];
  const showAll = () => reveals.forEach((el) => el.classList.add('in'));
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
