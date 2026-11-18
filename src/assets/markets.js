// Mounts TradingView's free embeddable widgets (https://www.tradingview.com/widget-docs/).
// Each <div class="tv-widget" data-widget="<name>" data-config-src="<json id>"> becomes one widget,
// loaded only when it scrolls near the viewport. TradingView's own credit link is kept, as their terms require.
(() => {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light'
    || document.documentElement.dataset.theme === 'dark';

  function mount(box) {
    const config = JSON.parse(document.getElementById(box.dataset.configSrc).textContent);
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

  const boxes = document.querySelectorAll('.tv-widget[data-widget]');
  if (!('IntersectionObserver' in window)) return boxes.forEach(mount);
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); mount(e.target); }
  }, { rootMargin: '400px 0px' });
  boxes.forEach((b) => io.observe(b));
})();
