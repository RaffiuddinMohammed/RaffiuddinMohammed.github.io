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

async function globe(box) {
  const renderer = makeRenderer(box);
  if (!renderer) return;
  const today = json(box.dataset.src);
  const dots = await fetch(box.dataset.dots).then((r) => r.json()).catch(() => []);

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
  const dotMat = new THREE.PointsMaterial({ size: 0.018, sizeAttenuation: true, transparent: true, opacity: 0.9 });
  world.add(new THREE.Points(dotGeo, dotMat));

  const glowMat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 color; varying vec3 vN; void main(){ float i = pow(0.75 - dot(vN, vec3(0.0,0.0,1.0)), 3.0); gl_FragColor = vec4(color, 1.0) * i * 0.55; }',
    blending: THREE.AdditiveBlending, side: THREE.BackSide, transparent: true, depthWrite: false,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.18, 64, 64), glowMat));

  const beamMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9 });
  const beamHot = new THREE.MeshBasicMaterial();
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
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });

  // ---- hotspots: rebuilt whenever the day changes
  let spots = new THREE.Group();
  world.add(spots);
  let beams = [], rings = [], hits = [], labels = [];
  function setPlaces(day) {
    current = day;
    world.remove(spots);
    spots.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    labels.forEach((l) => l.el.remove());
    spots = new THREE.Group(); world.add(spots);
    beams = []; rings = []; hits = []; labels = [];
    closePanel();
    const places = day.places ?? [];
    const max = Math.max(1, ...places.map((p) => p.count));
    places.forEach((p, i) => {
      const h = 0.12 + 0.55 * Math.sqrt(p.count / max);
      const at = toVec(p.lat, p.lon, 1.0);
      const up = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), at.clone().normalize());
      const g = new THREE.CylinderGeometry(0.008, 0.016, h, 8); g.translate(0, h / 2, 0);
      const beam = new THREE.Mesh(g, beamMat);
      beam.position.copy(at); beam.quaternion.copy(up);
      // a fatter invisible cylinder makes the beam easy to click
      const hg = new THREE.CylinderGeometry(0.06, 0.06, h + 0.06, 8); hg.translate(0, h / 2, 0);
      const hit = new THREE.Mesh(hg, hitMat);
      hit.position.copy(at); hit.quaternion.copy(up); hit.userData.place = p; hit.userData.beam = beam;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.032, 32), new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }));
      ring.material.color.set(css('--c4'));
      ring.position.copy(toVec(p.lat, p.lon, 1.002)); ring.lookAt(at.clone().multiplyScalar(2)); ring.userData.phase = i * 0.37;
      spots.add(beam, hit, ring);
      beams.push(beam); rings.push(ring); hits.push(hit);
      if (i < 6) {
        const b = el('button', 'globe-label clickable');
        b.type = 'button';
        b.append(el('b', null, p.name), el('span', null, ` ${p.count} ${p.count === 1 ? 'story' : 'stories'}`));
        b.setAttribute('aria-label', `${p.name}: ${p.count} stories. Show them`);
        b.addEventListener('click', () => openPanel(p));
        box.appendChild(b);
        labels.push({ el: b, tip: toVec(p.lat, p.lon, 1.0 + h + 0.04) });
      }
    });
  }
  setPlaces({ date: null, places: today });

  const paint = () => {
    body.material.color.set(css('--surface'));
    dotMat.color.set(css('--c1'));
    glowMat.uniforms.color.value.set(css('--c2'));
    beamMat.color.set(css('--c4'));
    beamHot.color.set(css('--c2'));
    rings.forEach((r) => r.material.color.set(css('--c4')));
  };
  paint();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paint);

  world.rotation.set(0.35, -Math.PI / 2 + 0.25, 0);

  // ---- pointer: drag to spin, click a beam to open its stories, hover to see its name
  const canvas = renderer.domElement;
  canvas.style.touchAction = 'pan-y';
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  const pick = (e) => {
    const r = canvas.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects([body, ...hits])[0];
    return hit && hit.object !== body ? hit.object : null; // the planet blocks beams behind it
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
    if (hovered && hovered !== h) hovered.userData.beam.material = beamMat;
    hovered = h;
    canvas.style.cursor = h ? 'pointer' : '';
    if (h) {
      h.userData.beam.material = beamHot;
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
  canvas.addEventListener('pointerleave', () => { hoverTip.style.opacity = '0'; if (hovered) hovered.userData.beam.material = beamMat; hovered = null; });

  // ---- time travel: a slider over the daily archive (loaded on first use)
  const timeBox = box.parentElement.querySelector('[data-globe-time]');
  if (timeBox) {
    fetch(timeBox.dataset.history).then((r) => r.json()).then((days) => {
      const label = timeBox.querySelector('.gt-date');
      const note = timeBox.querySelector('.gt-note');
      if (!Array.isArray(days) || days.length < 2) {
        note.textContent = `History started ${days?.[0] ? fmtDay(days[0].date) : 'today'}: a new day is saved every morning, then you can travel back in time here.`;
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
      };
      range.addEventListener('input', show);
      note.textContent = `${days.length} days archived, since ${fmtDay(days[0].date)}`;
      timeBox.classList.add('ready', 'has-history');
    }).catch(() => {});
  }

  const v = new THREE.Vector3(), w = new THREE.Vector3(), camDir = new THREE.Vector3();
  loop(box, (t) => {
    if (!dragging) {
      // pause the spin while a country's stories are open, so its beam stays put
      const target = still || selected || hovered ? 0 : 0.0016; // hold still while pointing at a country
      vx += (target - vx) * 0.03; vy *= 0.9;
      world.rotation.y += vx;
    }
    const s = Math.min(1, Math.max(0, scrollY / (box.offsetTop + box.offsetHeight)));
    world.position.y = s * 0.4;
    world.scale.setScalar(1 - s * 0.15);
    if (!still) {
      const k = t / 1000;
      rings.forEach((r) => { const p = (k * 0.6 + r.userData.phase) % 1; r.scale.setScalar(1 + p * 2.2); r.material.opacity = 0.8 * (1 - p); });
      beams.forEach((b, i) => { b.scale.y = 0.85 + 0.15 * Math.sin(k * 2 + i); });
    }
    camDir.copy(camera.position).normalize();
    world.updateMatrixWorld();
    beams.forEach((b, i) => {
      const facing = w.copy(b.position).applyMatrix4(world.matrixWorld).normalize().dot(camDir);
      b.visible = rings[i].visible = facing > -0.05;
    });
    renderer.render(scene, camera);
    for (const l of labels) {
      v.copy(l.tip).applyMatrix4(world.matrixWorld);
      const front = w.copy(v).normalize().dot(camDir) > 0.15;
      v.project(camera);
      const half = l.el.offsetWidth / 2, W = box.clientWidth;
      const lx = Math.min(W - half - 4, Math.max(half + 4, (v.x * 0.5 + 0.5) * W));
      l.el.style.transform = `translate(${lx}px, ${(-v.y * 0.5 + 0.5) * box.clientHeight}px) translate(-50%, -100%)`;
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
