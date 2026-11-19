// Keeps the ticker bar live. The build bakes in whatever the news was when the site was last built;
// this asks the news relay (worker/news-relay) every minute and redraws the bar when stories change.
// Without JS, or if the relay is down, the built-in stories simply stay.
(() => {
  const bar = document.querySelector('.flash[data-live]');
  if (!bar || !window.fetch) return;
  const run = bar.querySelector('.flash-run');
  const kind = bar.dataset.kind; // "markets" or "news"
  const SECONDS_PER_ITEM = 7; // same pace as the build (base.njk)
  let last = '';

  const item = (cls, label, title, href, hidden, tip) => {
    const a = document.createElement('a');
    a.className = `flash-item ${cls}`;
    a.href = href; a.rel = 'noopener'; a.target = '_blank';
    if (tip) a.title = tip;
    if (hidden) a.tabIndex = -1;
    const b = document.createElement('b');
    b.textContent = label;
    a.append(b, title);
    return a;
  };

  // mirrors the Nunjucks markup in base.njk, item for item
  const itemsFor = (d, hidden) => {
    if (kind === 'markets') {
      return d.business.map((h) => item(h.breaking ? 'k-breaking' : 'k-latest', h.breaking ? 'Breaking' : h.source, h.title, h.link, hidden, h.source));
    }
    const latest = (h) => item('k-latest', 'Latest', h.title, h.link, hidden);
    const out = d.breaking.map((h) => item('k-breaking', 'Breaking', h.title, h.link, hidden));
    d.trending.forEach((t, i) => {
      out.push(item('k-trending', 'Trending', t.term, t.link, hidden, `${t.traffic} searches in the UK · ${t.source}`));
      if (i === 1) out.push(...d.latest.slice(0, 3).map(latest)); // a few stories between the trends
    });
    out.push(...d.latest.slice(d.trending.length >= 2 ? 3 : 0).map(latest));
    return out;
  };

  async function refresh() {
    if (document.hidden) return;
    try {
      const r = await fetch(bar.dataset.live, { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      // a source that failed comes back as null: keep what is on screen for it
      if (kind === 'markets' ? !d.business?.length : !(d.breaking && d.latest && d.trending)) return;
      const sig = JSON.stringify(kind === 'markets' ? d.business : [d.breaking, d.latest, d.trending]);
      if (sig === last) return;
      const first = !last;
      last = sig;
      const shown = kind === 'markets' ? d.business.length : d.breaking.length + d.latest.length + d.trending.length;
      const sets = run.querySelectorAll('.flash-set');
      // skip the first redraw if it matches the built page, so the scroll doesn't jump on load
      if (first && sets[0] && sets[0].textContent.replace(/\s+/g, '') === itemsFor(d, false).map((a) => a.textContent).join('').replace(/\s+/g, '')) return;
      sets.forEach((set, i) => set.replaceChildren(...itemsFor(d, i === 1)));
      run.style.animationDuration = `${shown * SECONDS_PER_ITEM}s`;
      const breaking = kind === 'markets' ? d.business.some((h) => h.breaking) : d.breaking.length > 0;
      bar.classList.toggle('has-breaking', breaking);
    } catch { /* offline or relay down: keep the built-in stories */ }
  }

  refresh();
  setInterval(refresh, 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
