// 3D scenes (Three.js, loaded from a CDN via the import map in base.njk):
//   [data-globe]  a dotted Earth with beams on the countries in today's BBC headlines
//   [data-grid3d] a 3D bar grid of weekly news coverage per topic
// If WebGL is unavailable the containers get .no-3d and the page shows its normal content.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
const json = (id) => JSON.parse(document.getElementById(id).textContent);

function makeRenderer(box) {
  try {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.setSize(box.clientWidth, box.clientHeight);
    r.domElement.setAttribute('aria-hidden', 'true');
    box.prepend(r.domElement);
    return r;
  } catch {
    box.classList.add('no-3d');
    return null;
  }
}

// Render only while visible on screen and the tab is in front
function loop(box, frame) {
  let on = false, raf = 0;
  const tick = (t) => { frame(t); raf = requestAnimationFrame(tick); };
  const set = (v) => { if (v === on) return; on = v; v ? (raf = requestAnimationFrame(tick)) : cancelAnimationFrame(raf); };
  let visible = false;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; set(visible && !document.hidden); }).observe(box);
  document.addEventListener('visibilitychange', () => set(visible && !document.hidden));
}

function onResize(box, renderer, camera) {
  new ResizeObserver(() => {
    const w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }).observe(box);
}

const toVec = (lat, lon, r) => {
  const phi = ((90 - lat) * Math.PI) / 180, theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
};

// ------------------------------------------------------------------ globe
const fmtDay = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

// A soft round glow, drawn once and reused by every sprite
let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}
const glowSprite = (color, size, opacity = 1) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(size);
  return s;
};

// ---- the four ways of drawing "this country is in the news"; each returns { anchors, update, hot, paint }
// anchors[i] is a point on the surface for place i (used to hide markers on the far side and to place labels)
const STYLES = {
  // soft pulsing orbs of light
  hotspots(group, places, max, ctx) {
    const items = places.map((p, i) => {
      const w = Math.sqrt(p.count / max);
      const at = toVec(p.lat, p.lon, 1.015);
      const core = glowSprite(css('--c1'), 0.07 + 0.16 * w);
      const halo = glowSprite(css('--c2'), 0.2 + 0.4 * w, 0.45);
      core.position.copy(at); halo.position.copy(at);
      group.add(halo, core);
      return { core, halo, w, base: core.scale.x, hb: halo.scale.x, phase: i * 0.7, parts: [core, halo] };
    });
    return {
      tip: (i) => 1.0 + 0.06 + 0.1 * items[i].w,
      parts: (i) => items[i].parts,
      update(k) { items.forEach((it) => { const s = 1 + 0.12 * Math.sin(k * 2.2 + it.phase); it.core.scale.setScalar(it.base * s); it.halo.scale.setScalar(it.hb * (1.1 - 0.1 * s)); }); },
      hot(i, on) { items[i].core.material.color.set(on ? '#ffffff' : css('--c1')); },
      paint() { items.forEach((it) => { it.core.material.color.set(css('--c1')); it.halo.material.color.set(css('--c2')); }); },
    };
  },

  // the country's own land dots light up, like city lights at night
  litup(group, places, max, ctx) {
    const { dots } = ctx;
    const items = places.map((p, i) => {
      const w = Math.sqrt(p.count / max);
      const centre = toVec(p.lat, p.lon, 1).normalize();
      const reach = Math.cos(((3 + 6 * w) * Math.PI) / 180); // busier countries light a wider patch
      const pts = [];
      for (let j = 0; j < dots.length; j += 2) {
        const v = toVec(dots[j], dots[j + 1], 1.003);
        if (v.clone().normalize().dot(centre) > reach) pts.push(v.x, v.y, v.z);
      }
      if (!pts.length) pts.push(...toVec(p.lat, p.lon, 1.003).toArray()); // tiny islands: at least one light
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const mat = new THREE.PointsMaterial({ size: 0.03, transparent: true, opacity: 0.5 + 0.5 * w, blending: THREE.AdditiveBlending, depthWrite: false });
      const lights = new THREE.Points(geo, mat);
      const glow = glowSprite(css('--c2'), 0.12 + 0.3 * w, 0.35);
      glow.position.copy(centre.clone().multiplyScalar(1.01));
      group.add(lights, glow);
      return { mat, w, glow, phase: i * 1.3, parts: [lights, glow] };
    });
    const warm = () => (matchMedia('(prefers-color-scheme: dark)').matches ? '#bfe3ff' : css('--c2')); // icy city lights; violet on light pages
    const paint = () => items.forEach((it) => { it.mat.color.set(warm()); it.glow.material.color.set(css('--c2')); });
    paint();
    return {
      tip: () => 1.06,
      parts: (i) => items[i].parts,
      update(k) { items.forEach((it) => { it.mat.opacity = (0.5 + 0.5 * it.w) * (0.8 + 0.2 * Math.sin(k * 1.6 + it.phase)); }); },
      hot(i, on) { items[i].mat.size = on ? 0.045 : 0.03; },
      paint,
    };
  },

  // curved lines from the BBC in London to each country, with light travelling along them
  arcs(group, places, max, ctx) {
    const LONDON = [51.5, -0.1];
    const from = toVec(...LONDON, 1.0);
    const home = glowSprite(css('--c1'), 0.16);
    home.position.copy(toVec(...LONDON, 1.015));
    group.add(home);
    const items = places.map((p, i) => {
      const w = Math.sqrt(p.count / max);
      const to = toVec(p.lat, p.lon, 1.0);
      const end = glowSprite(css('--c2'), 0.06 + 0.12 * w);
      end.position.copy(toVec(p.lat, p.lon, 1.015));
      group.add(end);
      const dist = from.distanceTo(to);
      if (dist < 0.05) return { w, end, parts: [end] }; // the UK itself: just a glow on London
      const mid = from.clone().add(to).multiplyScalar(0.5).normalize().multiplyScalar(1 + 0.18 + dist * 0.35);
      const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.0025 + 0.004 * w, 6, false),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      const comet = glowSprite('#ffffff', 0.05 + 0.04 * w);
      group.add(tube, comet);
      return { w, end, tube, comet, curve, phase: (i * 0.137) % 1, parts: [end] };
    });
    const paint = () => { home.material.color.set(css('--c1')); items.forEach((it) => { it.end.material.color.set(css('--c2')); it.tube?.material.color.set(css('--c1')); }); };
    paint();
    return {
      tip: (i) => 1.06,
      parts: (i) => items[i].parts,
      update(k) { items.forEach((it) => { if (it.curve) it.comet.position.copy(it.curve.getPoint((k * 0.25 + it.phase) % 1)); }); },
      hot(i, on) { if (items[i].tube) items[i].tube.material.opacity = on ? 1 : 0.55; items[i].end.material.color.set(on ? '#ffffff' : css('--c2')); },
      paint,
    };
  },

  // thin glowing columns that fade out at the top
  pillars(group, places, max, ctx) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { a: { value: new THREE.Color() }, b: { value: new THREE.Color() }, boost: { value: 1 } },
      vertexShader: 'varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 a; uniform vec3 b; uniform float boost; varying float vY; void main(){ gl_FragColor = vec4(mix(a, b, vY), (1.0 - vY) * 0.9 * boost); }',
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const items = places.map((p, i) => {
      const w = Math.sqrt(p.count / max), h = 0.15 + 0.55 * w;
      const at = toVec(p.lat, p.lon, 1.0);
      const g = new THREE.CylinderGeometry(0.012, 0.022, h, 12, 1, true); g.translate(0, h / 2, 0);
      const m = mat.clone();
      const col = new THREE.Mesh(g, m);
      col.position.copy(at);
      col.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), at.clone().normalize());
      const foot = glowSprite(css('--c1'), 0.08 + 0.1 * w, 0.8);
      foot.position.copy(toVec(p.lat, p.lon, 1.01));
      group.add(col, foot);
      return { col, m, foot, h, phase: i * 0.9, parts: [col, foot] };
    });
    const paint = () => items.forEach((it) => { it.m.uniforms.a.value.set(css('--c1')); it.m.uniforms.b.value.set(css('--c2')); it.foot.material.color.set(css('--c1')); });
    paint();
    return {
      tip: (i) => 1.0 + items[i].h + 0.04,
      parts: (i) => items[i].parts,
      update(k) { items.forEach((it) => { it.col.scale.y = 0.9 + 0.1 * Math.sin(k * 1.8 + it.phase); }); },
      hot(i, on) { items[i].m.uniforms.boost.value = on ? 1.8 : 1; },
      paint,
    };
  },
};
const STYLE_NAMES = Object.keys(STYLES);

// Pick a different style from last time (?globe=arcs forces one, for testing)
function pickStyle() {
  const forced = new URLSearchParams(location.search).get('globe');
  if (STYLE_NAMES.includes(forced)) return forced;
  let last = null;
  try { last = localStorage.getItem('globe-style'); } catch {}
  const options = STYLE_NAMES.filter((s) => s !== last);
  const chosen = options[Math.floor(Math.random() * options.length)];
  try { localStorage.setItem('globe-style', chosen); } catch {}
  return chosen;
}

async function globe(box) {
  const renderer = makeRenderer(box);
  if (!renderer) return;
  const today = json(box.dataset.src);
  const dots = await fetch(box.dataset.dots).then((r) => r.json()).catch(() => []);
  const styleName = pickStyle();
  box.dataset.style = styleName;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, box.clientWidth / box.clientHeight, 0.1, 100);
  camera.position.set(0, 0.35, 4.4);
  onResize(box, renderer, camera);

  const world = new THREE.Group();
  scene.add(world);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.995, 64, 64), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.92 }));
  world.add(body);

  const pos = new Float32Array((dots.length / 2) * 3);
  for (let i = 0; i < dots.length; i += 2) toVec(dots[i], dots[i + 1], 1.0).toArray(pos, (i / 2) * 3);
  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dotMat = new THREE.PointsMaterial({ size: 0.018, sizeAttenuation: true, transparent: true, opacity: styleName === 'litup' ? 0.45 : 0.9 });
  world.add(new THREE.Points(dotGeo, dotMat));

  const glowMat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 color; varying vec3 vN; void main(){ float i = pow(0.75 - dot(vN, vec3(0.0,0.0,1.0)), 3.0); gl_FragColor = vec4(color, 1.0) * i * 0.55; }',
    blending: THREE.AdditiveBlending, side: THREE.BackSide, transparent: true, depthWrite: false,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.18, 64, 64), glowMat));
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });

  // ---- story panel (opens when a country is clicked)
  const panel = el('div', 'globe-panel');
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Stories for the selected country');
  box.appendChild(panel);
  const hoverTip = el('div', 'globe-label hover-tip');
  hoverTip.style.opacity = '0';
  box.appendChild(hoverTip);
  let current = { date: null, places: [] };
  let selected = null;

  function openPanel(p) {
    selected = p;
    panel.replaceChildren();
    const head = el('div', 'gp-head');
    const h = el('h3', null, p.name);
    const sub = el('span', 'gp-sub', `${p.count} ${p.count === 1 ? 'story' : 'stories'} · ${current.date ? fmtDay(current.date) : 'today'}`);
    const x = el('button', 'gp-x', '×');
    x.type = 'button'; x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', closePanel);
    const titles = el('div'); titles.append(h, sub);
    head.append(titles, x);
    const list = el('ul', 'gp-list');
    for (const s of p.stories ?? []) {
      const li = el('li');
      const a = el('a', null, s.title);
      a.href = s.link; a.target = '_blank'; a.rel = 'noopener';
      li.append(a, el('span', 'gp-meta', s.section ?? ''));
      list.appendChild(li);
    }
    if (!(p.stories ?? []).length) list.appendChild(el('li', 'gp-meta', 'Headlines were not saved for this day.'));
    if (p.count > (p.stories ?? []).length && (p.stories ?? []).length) list.appendChild(el('li', 'gp-meta', `+ ${p.count - p.stories.length} more on BBC News`));
    panel.append(head, list);
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add('open'));
    x.focus({ preventScroll: true });
  }
  function closePanel() { selected = null; panel.classList.remove('open'); panel.hidden = true; }
  // close: the ×, Esc anywhere, or a click/tap anywhere outside the panel
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && selected) closePanel(); });
  document.addEventListener('pointerdown', (e) => {
    if (!selected || panel.contains(e.target)) return;
    if (e.target.closest?.('.globe-label.clickable')) return; // a label click switches country instead
    closePanel();
  }, true);

  // ---- markers: rebuilt whenever the day changes, drawn in this visit's style
  let spots = new THREE.Group();
  world.add(spots);
  let style = null, hits = [], labels = [], anchors = [];
  function setPlaces(day) {
    current = day;
    world.remove(spots);
    spots.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    labels.forEach((l) => l.el.remove());
    spots = new THREE.Group(); world.add(spots);
    hits = []; labels = []; anchors = [];
    closePanel();
    const places = day.places ?? [];
    const max = Math.max(1, ...places.map((p) => p.count));
    style = STYLES[styleName](spots, places, max, { dots });
    places.forEach((p, i) => {
      const at = toVec(p.lat, p.lon, 1.0);
      anchors.push(at);
      // an invisible column over each country makes it easy to point at and click, whatever the style
      const hg = new THREE.CylinderGeometry(0.07, 0.07, 0.3, 8); hg.translate(0, 0.12, 0);
      const hit = new THREE.Mesh(hg, hitMat);
      hit.position.copy(at); hit.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), at.clone().normalize());
      hit.userData = { place: p, i };
      spots.add(hit); hits.push(hit);
      if (i < 6) {
        const b = el('button', 'globe-label clickable');
        b.type = 'button';
        b.append(el('b', null, p.name), el('span', null, ` ${p.count} ${p.count === 1 ? 'story' : 'stories'}`));
        b.setAttribute('aria-label', `${p.name}: ${p.count} stories. Show them`);
        b.addEventListener('click', () => openPanel(p));
        box.appendChild(b);
        labels.push({ el: b, tip: toVec(p.lat, p.lon, style.tip(i)) });
      }
    });
  }
  setPlaces({ date: null, places: today });

  const paint = () => {
    body.material.color.set(css('--surface'));
    dotMat.color.set(css('--c1'));
    glowMat.uniforms.color.value.set(css('--c2'));
    style?.paint();
  };
  paint();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paint);

  world.rotation.set(0.35, -Math.PI / 2 + 0.25, 0);

  // ---- pointer: drag to spin, click a country to open its stories, hover to see its name
  const canvas = renderer.domElement;
  canvas.style.touchAction = 'pan-y';
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  const pick = (e) => {
    const r = canvas.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects([body, ...hits])[0];
    return hit && hit.object !== body ? hit.object : null; // the planet blocks markers behind it
  };
  let dragging = false, moved = 0, lastX = 0, lastY = 0, vx = still ? 0 : 0.0016, vy = 0, hovered = null;
  canvas.addEventListener('pointerdown', (e) => { dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 4) box.classList.add('grabbing');
      vx = dx * 0.005; vy = dy * 0.003;
      world.rotation.y += vx; world.rotation.x = Math.max(-0.6, Math.min(0.9, world.rotation.x + vy));
      lastX = e.clientX; lastY = e.clientY;
      return;
    }
    const h = pick(e);
    if (hovered && hovered !== h) style.hot(hovered.userData.i, false);
    hovered = h;
    canvas.style.cursor = h ? 'pointer' : '';
    if (h) {
      style.hot(h.userData.i, true);
      const p = h.userData.place, r = canvas.getBoundingClientRect();
      hoverTip.replaceChildren(el('b', null, p.name), el('span', null, ` ${p.count} · click for stories`));
      hoverTip.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top - 14}px) translate(-50%, -100%)`;
      hoverTip.style.opacity = '1';
    } else hoverTip.style.opacity = '0';
  });
  const end = (e) => {
    if (dragging && moved < 6 && e.type === 'pointerup') { const h = pick(e) ?? hovered; if (h) openPanel(h.userData.place); }
    dragging = false; box.classList.remove('grabbing');
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { hoverTip.style.opacity = '0'; if (hovered) style.hot(hovered.userData.i, false); hovered = null; });

  // ---- time travel: a slider over the daily archive (loaded on first use)
  const timeBox = box.parentElement.querySelector('[data-globe-time]');
  if (timeBox) {
    fetch(timeBox.dataset.history).then((r) => r.json()).then((days) => {
      const label = timeBox.querySelector('.gt-date');
      const note = timeBox.querySelector('.gt-note');
      if (!Array.isArray(days) || days.length < 2) {
        note.textContent = '🕐 Time travel unlocks tomorrow: a new day is saved every morning.';
        timeBox.classList.add('ready');
        return;
      }
      const range = timeBox.querySelector('input');
      range.min = 0; range.max = days.length - 1; range.value = days.length - 1;
      range.disabled = false;
      const show = () => {
        const i = +range.value, d = days[i], latest = i === days.length - 1;
        label.textContent = latest ? 'Today' : fmtDay(d.date);
        setPlaces(latest ? { date: null, places: today } : d);
        const cap = box.querySelector('.globe-cap-text');
        if (cap) cap.textContent = latest ? "Countries in today's BBC headlines · drag to spin" : `Countries in BBC headlines on ${fmtDay(d.date)}`;
      };
      range.addEventListener('input', show);
      note.textContent = `🕐 Drag the slider to see past days · ${days.length} days saved since ${fmtDay(days[0].date)}`;
      timeBox.classList.add('ready', 'has-history');
    }).catch(() => {});
  }

  const v = new THREE.Vector3(), w = new THREE.Vector3(), camDir = new THREE.Vector3();
  loop(box, (t) => {
    if (!dragging) {
      const target = still || selected || hovered ? 0 : 0.0016; // hold still while pointing at a country
      vx += (target - vx) * 0.03; vy *= 0.9;
      world.rotation.y += vx;
    }
    const s = Math.min(1, Math.max(0, scrollY / (box.offsetTop + box.offsetHeight)));
    world.position.y = s * 0.4;
    world.scale.setScalar(1 - s * 0.15);
    if (!still) style.update(t / 1000);
    camDir.copy(camera.position).normalize();
    world.updateMatrixWorld();
    // markers on the far side of the planet are hidden (arcs are left to the depth buffer)
    anchors.forEach((a, i) => {
      const facing = w.copy(a).applyMatrix4(world.matrixWorld).normalize().dot(camDir) > -0.05;
      style.parts(i).forEach((o) => { o.visible = facing; });
    });
    renderer.render(scene, camera);
    for (const l of labels) {
      v.copy(l.tip).applyMatrix4(world.matrixWorld);
      const front = w.copy(v).normalize().dot(camDir) > 0.15;
      v.project(camera);
      const half = l.el.offsetWidth / 2, W = box.clientWidth;
      const lx = Math.min(W - half - 4, Math.max(half + 4, (v.x * 0.5 + 0.5) * W));
      const ly = Math.min(box.clientHeight - 44, Math.max(l.el.offsetHeight + 4, (-v.y * 0.5 + 0.5) * box.clientHeight)); // stay clear of the caption
      l.el.style.transform = `translate(${lx}px, ${ly}px) translate(-50%, -100%)`;
      l.el.style.opacity = front ? '1' : '0';
      l.el.style.pointerEvents = front ? 'auto' : 'none';
      l.el.tabIndex = front ? 0 : -1;
    }
  });
  box.classList.add('ready');
}

// ------------------------------------------------------------------ 3D bar grid
function grid3d(box) {
  const renderer = makeRenderer(box);
  if (!renderer) return;
  const data = json(box.dataset.src);
  const rows = data.topics, cols = data.weeks;
  const all = rows.flatMap((r) => r.values).filter((v) => v != null);
  const vmax = Math.max(...all);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, box.clientWidth / box.clientHeight, 0.1, 200);
  const W = cols.length, D = rows.length, GAP = 1.7;
  // order rows so the topic with the tallest bars sits at the back and never hides the others
  const order = rows.map((r, i) => [i, Math.max(...r.values.filter((x) => x != null))]).sort((a, b) => b[1] - a[1]).map(([i]) => i);
  const zOf = (i) => order.indexOf(i) * GAP;
  camera.position.set(W * 0.5 - 1, 8 + W * 0.22, (D - 1) * GAP + 7 + W * 0.45);
  onResize(box, renderer, camera);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-6, 14, 10);
  scene.add(sun);

  const center = new THREE.Vector3((W - 1) / 2, 0, ((D - 1) * GAP) / 2);
  const floor = new THREE.GridHelper(W + 3, W + 3);
  floor.scale.z = ((D - 1) * GAP + 3) / (W + 3); // a long, shallow floor under the rows
  floor.position.set(center.x, 0, center.z);
  scene.add(floor);

  const bars = [];
  const geo = new THREE.BoxGeometry(0.72, 1, 0.72);
  geo.translate(0, 0.5, 0);
  rows.forEach((r, z) => {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1 });
    mat.userData.slot = r.slot;
    r.values.forEach((val, x) => {
      if (val == null) return;
      const bar = new THREE.Mesh(geo, mat);
      bar.position.set(x, 0, zOf(z));
      bar.userData = { h: Math.max(0.05, (val / vmax) * 6), label: r.label, val, week: cols[x], mat };
      bar.scale.y = 0.001;
      scene.add(bar);
      bars.push(bar);
    });
  });

  // row labels (topics) and column labels (months) as HTML, projected each frame
  const tags = [];
  const tag = (text, at, cls) => {
    const el = document.createElement('div');
    el.className = `grid-label ${cls}`;
    el.textContent = text;
    box.appendChild(el);
    tags.push({ el, at });
  };
  rows.forEach((r, z) => tag(r.label, new THREE.Vector3(W + 0.9, 0, zOf(z)), 'row'));
  cols.forEach((w, x) => { if (x === 0 || w.slice(5, 7) !== cols[x - 1].slice(5, 7)) tag(new Date(w + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }), new THREE.Vector3(x, 0, (D - 1) * GAP + 1.1), 'col'); });

  const paint = () => {
    bars.forEach((b) => b.userData.mat.color.set(css(`--series-${b.userData.mat.userData.slot}`)));
    floor.material.color?.set?.(css('--border'));
    floor.material.opacity = 0.6; floor.material.transparent = true;
  };
  paint();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paint);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(center).setY(1.2);
  const baseOffset = camera.position.clone().sub(controls.target);
  const fit = () => {
    const aspect = box.clientWidth / box.clientHeight;
    camera.position.copy(controls.target).add(baseOffset.clone().multiplyScalar(Math.max(1, 2.1 / aspect)));
  };
  fit();
  new ResizeObserver(fit).observe(box);
  controls.enableZoom = false; // never hijack page scrolling
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = 1.35;
  controls.autoRotate = !still;
  controls.autoRotateSpeed = 0.6;
  controls.addEventListener('start', () => { controls.autoRotate = false; });
  renderer.domElement.style.touchAction = 'pan-y';

  // hover: highlight a bar and show its value
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  box.appendChild(tip);
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let hovered = null;
  renderer.domElement.addEventListener('pointermove', (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(bars)[0]?.object ?? null;
    if (hovered && hovered !== hit) hovered.material = hovered.userData.mat;
    hovered = hit;
    if (!hit) { tip.classList.remove('on'); return; }
    if (!hit.userData.hl) { hit.userData.hl = hit.userData.mat.clone(); hit.userData.hl.emissive = new THREE.Color(0x333333); }
    hit.material = hit.userData.hl;
    tip.replaceChildren();
    const t = document.createElement('div'); t.className = 't';
    t.textContent = `Week of ${new Date(hit.userData.week + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`;
    const row = document.createElement('div'); row.className = 'row';
    const b = document.createElement('b'); b.textContent = `${hit.userData.val.toFixed(2)}%`;
    const s = document.createElement('span'); s.textContent = hit.userData.label;
    row.append(b, s); tip.append(t, row);
    tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 170) + 'px';
    tip.style.top = e.clientY - r.top - 20 + 'px';
    tip.classList.add('on');
  });
  renderer.domElement.addEventListener('pointerleave', () => { tip.classList.remove('on'); if (hovered) hovered.material = hovered.userData.mat; hovered = null; });

  // bars rise in when the chart first comes into view
  let start = null;
  const v = new THREE.Vector3();
  loop(box, (t) => {
    start ??= t;
    const p = still ? 1 : Math.min(1, (t - start) / 1400);
    bars.forEach((b, i) => {
      const q = Math.min(1, Math.max(0, p * 1.6 - (i % W) * 0.04));
      b.scale.y = Math.max(0.001, b.userData.h * (1 - (1 - q) ** 3));
    });
    controls.update();
    renderer.render(scene, camera);
    for (const g of tags) {
      v.copy(g.at).project(camera);
      g.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * box.clientWidth}px, ${(-v.y * 0.5 + 0.5) * box.clientHeight}px) translate(-50%, -50%)`;
    }
  });
  box.classList.add('ready');
}

document.querySelectorAll('[data-globe]').forEach(globe);
document.querySelectorAll('[data-grid3d]').forEach(grid3d);
