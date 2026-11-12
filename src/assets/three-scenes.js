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
async function globe(box) {
  const renderer = makeRenderer(box);
  if (!renderer) return;
  const places = json(box.dataset.src);
  const dots = await fetch(box.dataset.dots).then((r) => r.json()).catch(() => []);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, box.clientWidth / box.clientHeight, 0.1, 100);
  camera.position.set(0, 0.35, 4.4);
  onResize(box, renderer, camera);

  const world = new THREE.Group();
  scene.add(world);

  // body of the planet: hides the dots on the far side
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.995, 64, 64), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.92 }));
  world.add(body);

  // land as dots
  const pos = new Float32Array((dots.length / 2) * 3);
  for (let i = 0; i < dots.length; i += 2) toVec(dots[i], dots[i + 1], 1.0).toArray(pos, (i / 2) * 3);
  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dotMat = new THREE.PointsMaterial({ size: 0.018, sizeAttenuation: true, transparent: true, opacity: 0.9 });
  world.add(new THREE.Points(dotGeo, dotMat));

  // atmosphere: a fresnel glow just outside the surface
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 color; varying vec3 vN; void main(){ float i = pow(0.75 - dot(vN, vec3(0.0,0.0,1.0)), 3.0); gl_FragColor = vec4(color, 1.0) * i * 0.55; }',
    blending: THREE.AdditiveBlending, side: THREE.BackSide, transparent: true, depthWrite: false,
  });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(1.18, 64, 64), glowMat);
  scene.add(glow);

  // beams + pulsing rings on the countries in today's headlines
  const max = Math.max(1, ...places.map((p) => p.count));
  const beams = [], rings = [], labels = [];
  const beamMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9 });
  places.forEach((p, i) => {
    const h = 0.12 + 0.55 * Math.sqrt(p.count / max);
    const g = new THREE.CylinderGeometry(0.008, 0.016, h, 8);
    g.translate(0, h / 2, 0);
    const beam = new THREE.Mesh(g, beamMat);
    const at = toVec(p.lat, p.lon, 1.0);
    beam.position.copy(at);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), at.clone().normalize());
    beam.userData = { h };
    world.add(beam);
    beams.push(beam);

    const ring = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.032, 32), new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }));
    ring.position.copy(toVec(p.lat, p.lon, 1.002));
    ring.lookAt(at.clone().multiplyScalar(2));
    ring.userData.phase = i * 0.37;
    world.add(ring);
    rings.push(ring);

    if (i < 6) { // label the busiest few
      const el = document.createElement('div');
      el.className = 'globe-label';
      const b = document.createElement('b'); b.textContent = p.name;
      const s = document.createElement('span'); s.textContent = ` ${p.count} ${p.count === 1 ? 'story' : 'stories'}`;
      el.append(b, s);
      box.appendChild(el);
      labels.push({ el, tip: toVec(p.lat, p.lon, 1.0 + h + 0.04) });
    }
  });

  const paint = () => {
    body.material.color.set(css('--surface'));
    dotMat.color.set(css('--c1'));
    glowMat.uniforms.color.value.set(css('--c2'));
    beamMat.color.set(css('--c4'));
    rings.forEach((r) => r.material.color.set(css('--c4')));
  };
  paint();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paint);

  // start facing Europe/Africa, tilted like the real Earth
  world.rotation.set(0.35, -Math.PI / 2 + 0.25, 0);

  // drag to spin (with inertia); auto-rotate otherwise
  let dragging = false, lastX = 0, lastY = 0, vx = still ? 0 : 0.0016, vy = 0;
  const canvas = renderer.domElement;
  canvas.style.touchAction = 'pan-y';
  canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); box.classList.add('grabbing'); });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    vx = (e.clientX - lastX) * 0.005; vy = (e.clientY - lastY) * 0.003;
    world.rotation.y += vx; world.rotation.x = Math.max(-0.6, Math.min(0.9, world.rotation.x + vy));
    lastX = e.clientX; lastY = e.clientY;
  });
  const end = () => { dragging = false; box.classList.remove('grabbing'); };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  const v = new THREE.Vector3(), camDir = new THREE.Vector3();
  loop(box, (t) => {
    if (!dragging) {
      vx += ((still ? 0 : 0.0016) - vx) * 0.03; // ease back to a slow spin after a flick
      vy *= 0.9;
      world.rotation.y += vx;
    }
    // scroll: tilt back and shrink a touch as the hero leaves the screen
    const s = Math.min(1, Math.max(0, scrollY / (box.offsetTop + box.offsetHeight)));
    world.position.y = s * 0.4;
    world.scale.setScalar(1 - s * 0.15);

    if (!still) {
      const k = t / 1000;
      rings.forEach((r) => { const p = (k * 0.6 + r.userData.phase) % 1; r.scale.setScalar(1 + p * 2.2); r.material.opacity = 0.8 * (1 - p); });
      beams.forEach((b, i) => { b.scale.y = 0.85 + 0.15 * Math.sin(k * 2 + i); });
    }
    camDir.copy(camera.position).normalize();
    beams.forEach((b, i) => {
      const facing = v.copy(b.position).applyMatrix4(world.matrixWorld).normalize().dot(camDir);
      b.visible = rings[i].visible = facing > -0.05;
    });
    renderer.render(scene, camera);

    // HTML labels follow their beam tips; hide them on the far side
    camDir.copy(camera.position).normalize();
    for (const l of labels) {
      v.copy(l.tip).applyMatrix4(world.matrixWorld);
      const front = v.clone().normalize().dot(camDir) > 0.15;
      v.project(camera);
      const half = l.el.offsetWidth / 2, W = box.clientWidth;
      const lx = Math.min(W - half - 4, Math.max(half + 4, (v.x * 0.5 + 0.5) * W));
      l.el.style.transform = `translate(${lx}px, ${(-v.y * 0.5 + 0.5) * box.clientHeight}px) translate(-50%, -100%)`;
      l.el.style.opacity = front ? '1' : '0';
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
  camera.position.set(W * 0.5 - 1, 11, (D - 1) * GAP + 13);
  onResize(box, renderer, camera);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-6, 14, 10);
  scene.add(sun);

  const center = new THREE.Vector3((W - 1) / 2, 0, ((D - 1) * GAP) / 2);
  const floor = new THREE.GridHelper(W + 3, W + 3);
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
