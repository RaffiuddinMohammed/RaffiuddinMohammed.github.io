// Mounts TradingView's free embeddable widgets (https://www.tradingview.com/widget-docs/).
// Each <div class="tv-widget" data-widget="<name>" data-config-src="<json id>"> becomes one widget,
// loaded only when it scrolls near the viewport. TradingView's own credit link is kept, as their terms require.
(() => {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light'
    || document.documentElement.dataset.theme === 'dark';

  function mount(box) {
    const config = JSON.parse(document.getElementById(box.dataset.configSrc).textContent);
    if (box.dataset.override) Object.assign(config, JSON.parse(box.dataset.override)); // set by a region tab
    Object.assign(config, { colorTheme: dark ? 'dark' : 'light', isTransparent: true, locale: 'en', width: '100%' });
    if (box.dataset.height) config.height = Number(box.dataset.height);

    const wrap = document.createElement('div');
    wrap.className = 'tradingview-widget-container';
    const inner = document.createElement('div');
    inner.className = 'tradingview-widget-container__widget';
    const credit = document.createElement('div');
    credit.className = 'tradingview-widget-copyright';
    credit.innerHTML = '<a href="https://www.tradingview.com/" rel="noopener nofollow" target="_blank">Market data by TradingView</a>';
    const script = document.createElement('script');
    script.src = `https://s3.tradingview.com/external-embedding/embed-widget-${box.dataset.widget}.js`;
    script.async = true;
    script.textContent = JSON.stringify(config);
    wrap.append(inner, credit, script);
    box.replaceChildren(wrap);
  }

  // Region tabs: each button carries the settings that differ (an exchange or an index); picking one
  // re-mounts its widget. Before the widget has scrolled into view, the choice is just remembered.
  document.querySelectorAll('.tv-tabs[data-for]').forEach((bar) => {
    const box = document.getElementById(bar.dataset.for);
    const tabs = [...bar.querySelectorAll('[role="tab"]')];
    const pick = (btn) => {
      tabs.forEach((t) => { t.setAttribute('aria-selected', String(t === btn)); t.tabIndex = t === btn ? 0 : -1; });
      box.dataset.override = btn.dataset.config;
      if (box.querySelector('.tradingview-widget-container')) mount(box);
    };
    tabs.forEach((t, i) => {
      t.tabIndex = t.getAttribute('aria-selected') === 'true' ? 0 : -1;
      t.addEventListener('click', () => pick(t));
      t.addEventListener('keydown', (e) => { // arrow keys move between tabs, as screen-reader users expect
        const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (!step) return;
        const next = tabs[(i + step + tabs.length) % tabs.length];
        next.focus(); pick(next);
      });
    });
  });

  const boxes = document.querySelectorAll('.tv-widget[data-widget]');
  if (!('IntersectionObserver' in window)) return boxes.forEach(mount);
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); mount(e.target); }
  }, { rootMargin: '150px 0px' }); // load each widget just before it scrolls into view (TradingView is the heaviest thing on the site)
  boxes.forEach((b) => io.observe(b));
})();

// Company logos: some are white-on-transparent and vanish on the white tile. Once each loads, sample it:
// mostly-light artwork gets a dark tile; an empty image falls back to the company's initial.
(() => {
  const check = (img) => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 16;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 16, 16);
      const d = g.getImageData(0, 0, 16, 16).data;
      let n = 0, lum = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40) { n++; lum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; }
      if (n < 6) return img.remove();
      if (lum / n > 0.86) img.closest('.logo-tile')?.classList.add('dark');
    } catch { /* canvas blocked: leave the logo as it is */ }
  };
  document.querySelectorAll('.logo-tile img').forEach((img) => (img.complete && img.naturalWidth ? check(img) : img.addEventListener('load', () => check(img), { once: true })));
})();
