// Tiny dependency-free SVG charts. Each <div data-chart="line|bar" data-src="id"> reads its data
// from a <script type="application/json" id="id"> block rendered at build time.
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };
  const text = (parent, str, attrs) => { const t = el('text', attrs, parent); t.textContent = str; return t; };
  const color = (i, s) => `var(--series-${s?.slot ?? i + 1})`;
  const fmtDate = (d, opts = { day: 'numeric', month: 'short' }) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });

  function niceTicks(max, count = 4) {
    const raw = max / count, mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const ticks = [];
    for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(+v.toFixed(10));
    if (ticks.at(-1) < max) ticks.push(+(ticks.at(-1) + step).toFixed(10));
    return ticks;
  }

  function tooltip(box) {
    const tip = document.createElement('div');
    tip.className = 'tooltip';
    tip.setAttribute('role', 'status');
    box.appendChild(tip);
    return {
      show(title, rows, x, y) {
        tip.replaceChildren();
        const t = document.createElement('div'); t.className = 't'; t.textContent = title; tip.appendChild(t);
        for (const r of rows) {
          const row = document.createElement('div'); row.className = 'row';
          if (r.color) { const i = document.createElement('i'); i.style.background = r.color; row.appendChild(i); }
          const b = document.createElement('b'); b.textContent = r.value; row.appendChild(b);
          if (r.label) { const s = document.createElement('span'); s.textContent = r.label; row.appendChild(s); }
          tip.appendChild(row);
        }
        tip.classList.add('on');
        const w = tip.offsetWidth, bw = box.clientWidth;
        let left = x + 14;
        if (left + w > bw) left = x - w - 14;
        tip.style.left = Math.max(0, left) + 'px';
        tip.style.top = Math.max(0, y - tip.offsetHeight / 2) + 'px';
      },
      hide() { tip.classList.remove('on'); },
    };
  }

  // ---------- line chart: change over time, up to 4 series, crosshair + tooltip ----------
  function line(box, data) {
    const W = box.clientWidth, narrow = W < 520;
    const H = narrow ? 240 : 300;
    const m = { t: 12, r: narrow ? 74 : 92, b: 28, l: 40 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const dates = [...new Set(data.series.flatMap((s) => s.points.map((p) => p.date)))].sort();
    const t0 = Date.parse(dates[0]), t1 = Date.parse(dates.at(-1));
    const x = (d) => m.l + ((Date.parse(d) - t0) / (t1 - t0)) * iw;
    const ticks = niceTicks(Math.max(...data.series.flatMap((s) => s.points.map((p) => p.value))));
    const yMax = ticks.at(-1);
    const y = (v) => m.t + ih - (v / yMax) * ih;
    const fmt = (v) => v.toFixed(yMax < 2 ? 2 : 1) + (data.unit ?? '');

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': data.label ?? 'Line chart' });
    const g = el('g', { class: 'axis' }, svg);
    for (const v of ticks) {
      el('line', { class: v === 0 ? 'baseline' : 'gridline', x1: m.l, x2: m.l + iw, y1: y(v), y2: y(v) }, g);
      text(g, v + (data.unit ?? ''), { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' });
    }
    const start = new Date(t0);
    for (let mo = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)); mo.getTime() <= t1; mo.setUTCMonth(mo.getUTCMonth() + 1)) {
      const d = mo.toISOString().slice(0, 10);
      el('line', { class: 'baseline', x1: x(d), x2: x(d), y1: m.t + ih, y2: m.t + ih + 4 }, g);
      text(g, fmtDate(d, { month: 'short' }), { x: x(d), y: H - 8, 'text-anchor': 'middle' });
    }

    data.series.forEach((s, i) => {
      const dAttr = s.points.map((p, j) => `${j ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
      el('path', { d: dAttr, fill: 'none', stroke: color(i, s), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    });

    // direct end labels, nudged apart so they never overlap
    const ends = data.series.map((s, i) => ({ s, i, y: y(s.points.at(-1).value) })).sort((a, b) => a.y - b.y);
    for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 15) ends[k].y = ends[k - 1].y + 15;
    for (const e of ends) {
      const last = e.s.points.at(-1);
      el('circle', { cx: x(last.date), cy: y(last.value), r: 4, fill: color(e.i, e.s), stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
      text(svg, e.s.label, { class: 'end-label', x: m.l + iw + 10, y: e.y + 4 });
    }

    const hair = el('line', { class: 'hair', y1: m.t, y2: m.t + ih, visibility: 'hidden' }, svg);
    const dots = data.series.map((s, i) => el('circle', { r: 4, fill: color(i, s), stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }, svg));
    const hit = el('rect', { class: 'hit', x: m.l, y: m.t, width: iw, height: ih, tabindex: 0, 'aria-label': 'Explore values; use arrow keys' }, svg);
    box.replaceChildren(svg);
    const tip = tooltip(box);
    let idx = dates.length - 1;

    const showAt = (i) => {
      idx = Math.max(0, Math.min(dates.length - 1, i));
      const d = dates[idx], px = x(d);
      hair.setAttribute('x1', px); hair.setAttribute('x2', px); hair.setAttribute('visibility', 'visible');
      const rows = [];
      data.series.forEach((s, k) => {
        const p = s.points.find((q) => q.date === d);
        dots[k].setAttribute('visibility', p ? 'visible' : 'hidden');
        if (!p) return;
        dots[k].setAttribute('cx', px); dots[k].setAttribute('cy', y(p.value));
        rows.push({ value: fmt(p.value), label: s.label, color: color(k, s), v: p.value });
      });
      rows.sort((a, b) => b.v - a.v);
      const scale = box.clientWidth / W;
      tip.show(fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' }), rows, px * scale, (m.t + ih / 3) * scale);
    };
    const hide = () => { hair.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); tip.hide(); };
    hit.addEventListener('pointermove', (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const t = t0 + ((px - m.l) / iw) * (t1 - t0);
      let best = 0;
      dates.forEach((d, i) => { if (Math.abs(Date.parse(d) - t) < Math.abs(Date.parse(dates[best]) - t)) best = i; });
      showAt(best);
    });
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('focus', () => showAt(idx));
    hit.addEventListener('blur', hide);
    hit.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowLeft') { showAt(idx - 1); ev.preventDefault(); }
      if (ev.key === 'ArrowRight') { showAt(idx + 1); ev.preventDefault(); }
    });
  }

  // ---------- horizontal bar chart: ranked magnitude, one series ----------
  function bar(box, data) {
    const W = box.clientWidth, narrow = W < 520;
    const rowH = 30, barH = 18;
    const labelW = Math.min(narrow ? 120 : 200, W * 0.42);
    const m = { t: 4, r: 52, l: labelW + 12 };
    const iw = W - m.l - m.r, H = m.t + data.rows.length * rowH + 4;
    const max = Math.max(...data.rows.map((r) => r.value));
    const maxChars = Math.floor(labelW / 7.2);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': data.label ?? 'Bar chart' });
    el('line', { class: 'baseline', x1: m.l, x2: m.l, y1: m.t, y2: H - 4 }, svg);
    const tipRef = {};
    data.rows.forEach((r, i) => {
      const top = m.t + i * rowH, w = Math.max(2, (r.value / max) * iw), cy = top + (rowH - barH) / 2;
      const label = r.label.length > maxChars ? r.label.slice(0, maxChars - 1) + '…' : r.label;
      text(svg, label, { class: 'cat', x: m.l - 10, y: top + rowH / 2 + 4, 'text-anchor': 'end' });
      const hit = el('rect', { class: 'hit', x: 0, y: top, width: W, height: rowH, tabindex: 0, 'aria-label': `${r.label}: ${r.value}` }, svg);
      // square at the baseline, 4px rounded at the data end
      const rad = Math.min(4, w / 2);
      el('path', { class: 'bar', fill: 'var(--series-1)', d: `M${m.l},${cy}h${w - rad}a${rad},${rad} 0 0 1 ${rad},${rad}v${barH - 2 * rad}a${rad},${rad} 0 0 1 ${-rad},${rad}h${-(w - rad)}z` }, svg);
      text(svg, Number(r.value).toLocaleString('en-GB'), { class: 'val', x: m.l + w + 8, y: top + rowH / 2 + 4 });
      const show = () => {
        const s = box.clientWidth / W;
        tipRef.t.show(r.label, [{ value: Number(r.value).toLocaleString('en-GB'), label: data.unit ?? '' }], (m.l + w) * s, (top + rowH / 2) * s);
      };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('focus', show);
      hit.addEventListener('pointerleave', () => tipRef.t.hide());
      hit.addEventListener('blur', () => tipRef.t.hide());
      if (r.href) hit.addEventListener('click', () => window.open(r.href, '_blank', 'noopener'));
      if (r.href) hit.style.cursor = 'pointer';
    });
    box.replaceChildren(svg);
    tipRef.t = tooltip(box);
  }

  const kinds = { line, bar };
  const charts = [...document.querySelectorAll('[data-chart]')].map((box) => {
    const data = JSON.parse(document.getElementById(box.dataset.src).textContent);
    const draw = () => kinds[box.dataset.chart](box, data);
    draw();
    return { box, draw, w: box.clientWidth };
  });
  let raf;
  addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => charts.forEach((c) => { if (c.box.clientWidth !== c.w) { c.w = c.box.clientWidth; c.draw(); } }));
  });
})();
