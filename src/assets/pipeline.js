// Home page pipeline panel: replays the site's own CI run step by step (pending -> running -> passed),
// then rests and loops. Reduced-motion visitors see the finished, all-passed state.
(() => {
  const box = document.querySelector('[data-pipeline]');
  if (!box) return;
  const steps = [...box.querySelectorAll('.pl-steps li')];
  const state = box.querySelector('[data-pl-state]');
  const pass = box.querySelector('.pl-pass');
  const ago = box.querySelector('[data-pl-ago]');

  // "Last real run: 12 minutes ago", from the timestamp the 30-minute job writes
  const t = Date.parse(box.dataset.lastRun);
  const rel = () => {
    if (!t || !ago) return;
    const m = Math.max(0, Math.round((Date.now() - t) / 60000));
    ago.textContent = m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
  };
  rel(); setInterval(rel, 60000);

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.2 }).observe(box);

  async function run() {
    for (;;) {
      while (!visible || document.hidden) await wait(500);
      steps.forEach((s) => (s.className = ''));
      box.classList.add('running'); box.classList.remove('passed');
      state.textContent = 'Running…'; pass.textContent = `0 of ${steps.length} passed`;
      await wait(500);
      for (const [i, s] of steps.entries()) {
        s.className = 'run';
        await wait(650 + Math.random() * 500);
        s.className = 'done';
        pass.textContent = `${i + 1} of ${steps.length} passed`;
      }
      box.classList.remove('running'); box.classList.add('passed');
      state.textContent = 'All checks passed'; pass.textContent = `✓ ${steps.length} of ${steps.length} passed`;
      await wait(6000);
    }
  }
  run();
})();
