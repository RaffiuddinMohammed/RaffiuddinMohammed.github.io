// A replay of a real Appium + WebdriverIO run against a small sample app ("Bloom").
// The phone, the test script and the terminal are driven from one timeline so they stay in step.
//   [data-demo="full"]  split screen with code + terminal + controls (automation page)
//   [data-demo="mini"]  phone + short terminal, loops while on screen (home page panel)
(() => {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const CODE = [
    "import { expect } from '@wdio/globals';",
    '',
    "describe('Bloom · checkout', () => {",
    "  it('signs in with a valid account', async () => {",
    "    await $('~email').setValue('demo@bloom.app');",
    "    await $('~password').setValue('s3cret-pass');",
    "    await $('~sign-in').click();",
    "    await expect($('~home-title')).toBeDisplayed();",
    '  });',
    '',
    "  it('adds a plant to the basket', async () => {",
    "    await $('~product-monstera').click();",
    "    await $('~add-to-basket').click();",
    "    await expect($('~basket-badge')).toHaveText('1');",
    '  });',
    '',
    "  it('checks out and confirms the order', async () => {",
    "    await $('~basket').click();",
    "    await $('~checkout').click();",
    "    await expect($('~order-confirmed')).toBeDisplayed();",
    '  });',
    '});',
  ];

  const sid = '9f3c1e2a';
  const find = (id) => `[appium] POST /session/${sid}/element {"using":"accessibility id","value":"${id}"} → 200`;
  // Each step: the code line it runs, what the phone does, and what the terminal prints
  const STEPS = [
    { log: [['$ npx wdio run ./wdio.conf.js --spec ./test/checkout.e2e.js', 'cmd']], wait: 700 },
    { log: [['Execution of 1 workers started', 'dim'], ['[appium] Welcome to Appium v2.11.0 · listening on 0.0.0.0:4723', 'dim']], wait: 600 },
    { log: [['[0-0] RUNNING in Android - Pixel 6 (UiAutomator2) - checkout.e2e.js', 'info'], [`[appium] POST /session → ${sid} (2.1s)`, 'dim'], ['[0-0] app launched: com.bloom.shop', 'dim']], wait: 900 },
    { line: 3, test: 0, wait: 300 },
    { line: 4, log: [[find('email'), 'dim'], [`[appium] POST /element/6b1/value "demo@bloom.app"`, 'dim']], act: ['type', 'email', 'demo@bloom.app'] },
    { line: 5, log: [[find('password'), 'dim'], [`[appium] POST /element/6b2/value "***"`, 'dim']], act: ['type', 'password', 's3cret-pass', true] },
    { line: 6, log: [[find('sign-in'), 'dim'], ['[appium] POST /element/6b3/click → 200', 'dim']], act: ['tap', 'sign-in', 'home'] },
    { line: 7, log: [['[appium] GET /element/7c0/displayed → true', 'dim'], ['  ✓ signs in with a valid account (2.4s)', 'pass']], act: ['assert', 'home-title'], pass: 0 },
    { line: 10, test: 1, wait: 300 },
    { line: 11, log: [[find('product-monstera'), 'dim'], ['[appium] POST /element/8d1/click → 200', 'dim']], act: ['tap', 'product-monstera', 'product'] },
    { line: 12, log: [[find('add-to-basket'), 'dim'], ['[appium] POST /element/8d2/click → 200', 'dim']], act: ['tap', 'add-to-basket', null, 'badge'] },
    { line: 13, log: [['[appium] GET /element/8d3/text → "1"', 'dim'], ['  ✓ adds a plant to the basket (1.6s)', 'pass']], act: ['assert', 'basket-badge'], pass: 1 },
    { line: 16, test: 2, wait: 300 },
    { line: 17, log: [[find('basket'), 'dim'], ['[appium] POST /element/9e1/click → 200', 'dim']], act: ['tap', 'basket', 'basket'] },
    { line: 18, log: [[find('checkout'), 'dim'], ['[appium] POST /element/9e2/click → 200', 'dim']], act: ['tap', 'checkout', 'done'] },
    { line: 19, log: [['[appium] GET /element/9e3/displayed → true', 'dim'], ['  ✓ checks out and confirms the order (1.9s)', 'pass']], act: ['assert', 'order-confirmed'], pass: 2 },
    { log: [['', ''], ['Spec Files:  1 passed, 1 total (100% completed) in 00:00:07', 'info'], ['3 passing (6.9s)', 'pass big']], wait: 800 },
    { log: [['→ Allure report generated · results posted to Slack #qa-alerts ✓', 'info']], wait: 400, done: true },
  ];
  const TESTS = ['signs in with a valid account', 'adds a plant to the basket', 'checks out and confirms the order'];

  // tiny syntax highlighter (DOM only, never innerHTML)
  function highlight(line) {
    const frag = document.createDocumentFragment();
    const re = /('[^']*')|\b(await|async|import|from|describe|it|expect)\b|(\$\()|(\.\w+)(?=\()/g;
    let last = 0, m;
    const push = (text, cls) => { if (!text) return; const s = document.createElement('span'); if (cls) s.className = cls; s.textContent = text; frag.appendChild(s); };
    while ((m = re.exec(line))) {
      push(line.slice(last, m.index));
      push(m[0], m[1] ? 'tk-str' : m[2] ? 'tk-kw' : m[3] ? 'tk-sel' : 'tk-fn');
      last = m.index + m[0].length;
    }
    push(line.slice(last));
    return frag;
  }

  class Demo {
    constructor(root) {
      this.root = root;
      this.mini = root.dataset.demo === 'mini';
      this.screen = root.querySelector('.phone-screen');
      this.touch = root.querySelector('.touch');
      this.term = root.querySelector('.term-body');
      this.status = root.querySelector('[data-status]');
      this.codeBox = root.querySelector('.code-body');
      this.speed = 1;
      this.paused = false;
      this.run = 0;
      if (this.codeBox) {
        const ol = document.createElement('ol');
        CODE.forEach((l) => { const li = document.createElement('li'); li.appendChild(highlight(l || ' ')); ol.appendChild(li); });
        this.codeBox.appendChild(ol);
        this.lines = [...ol.children];
      }
      this.tests = [...root.querySelectorAll('[data-test]')];
      root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => this[b.dataset.act]()));
      root.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
        this.speed = +b.dataset.speed;
        root.querySelectorAll('[data-speed]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      }));
    }

    // ---- timeline helpers
    async sleep(ms) {
      const id = this.run;
      let left = ms / this.speed;
      while (left > 0) {
        if (id !== this.run) throw new Error('restarted');
        const step = Math.min(50, left);
        await new Promise((r) => setTimeout(r, step));
        if (!this.paused) left -= step;
      }
      if (id !== this.run) throw new Error('restarted');
    }
    el(id) { return this.screen.querySelector(`.app-screen.active [data-id="${id}"]`) || this.screen.querySelector(`[data-id="${id}"]`); }
    log(text, cls) {
      if (!this.term) return;
      const d = document.createElement('div');
      d.className = `tl ${cls || ''}`;
      d.textContent = text || ' ';
      this.term.appendChild(d);
      while (this.term.children.length > (this.mini ? 7 : 200)) this.term.firstChild.remove();
      this.term.scrollTop = this.term.scrollHeight;
    }
    setLine(i) {
      if (!this.lines) return;
      this.lines.forEach((li, k) => li.classList.toggle('current', k === i));
      const li = this.lines[i];
      if (li) this.codeBox.scrollTo({ top: li.offsetTop - this.codeBox.clientHeight / 2 + li.offsetHeight, behavior: still ? 'auto' : 'smooth' });
    }
    setStatus(text, cls) { if (this.status) { this.status.textContent = text; this.status.className = `status ${cls || ''}`; } }
    go(name) {
      const screens = [...this.screen.querySelectorAll('.app-screen')];
      const next = screens.find((s) => s.dataset.screen === name);
      screens.forEach((s) => { s.classList.remove('left'); if (s.classList.contains('active') && s !== next) { s.classList.remove('active'); s.classList.add('left'); } });
      next.classList.add('active');
    }
    async pointAt(target) {
      const r = target.getBoundingClientRect(), p = this.screen.getBoundingClientRect();
      const sx = p.width / this.screen.offsetWidth || 1; // the phone may be scaled down
      this.touch.style.transform = `translate(${(r.left - p.left + r.width / 2) / sx}px, ${(r.top - p.top + r.height / 2) / sx}px)`;
      this.touch.classList.add('on');
      await this.sleep(420);
    }
    async tap(id, screen, extra) {
      const t = this.el(id);
      await this.pointAt(t);
      this.touch.classList.remove('press'); void this.touch.offsetWidth; this.touch.classList.add('press');
      t.classList.add('pressed');
      await this.sleep(260);
      t.classList.remove('pressed');
      if (extra === 'badge') this.screen.querySelectorAll('[data-id="basket-badge"]').forEach((b) => { b.textContent = '1'; b.classList.add('bump'); });
      if (screen) { await this.sleep(150); this.go(screen); await this.sleep(450); }
    }
    async type(id, text, mask) {
      const t = this.el(id);
      await this.pointAt(t);
      t.classList.add('focus');
      this.touch.classList.remove('on');
      for (let i = 1; i <= text.length; i++) { t.value = mask ? '•'.repeat(i) : text.slice(0, i); await this.sleep(45); }
      t.classList.remove('focus');
    }
    async assert(id) {
      const t = this.el(id);
      this.touch.classList.remove('on');
      t.classList.add('asserted');
      await this.sleep(500);
    }

    reset() {
      this.screen.querySelectorAll('input').forEach((i) => { i.value = ''; });
      this.screen.querySelectorAll('.asserted,.pressed,.focus,.bump').forEach((e) => e.classList.remove('asserted', 'pressed', 'focus', 'bump'));
      this.screen.querySelectorAll('[data-id="basket-badge"]').forEach((b) => { b.textContent = '0'; });
      this.screen.querySelectorAll('.app-screen').forEach((s) => s.classList.remove('active', 'left'));
      this.screen.querySelector('[data-screen="login"]').classList.add('active');
      this.touch.classList.remove('on', 'press');
      if (this.term) this.term.replaceChildren();
      this.tests.forEach((t) => { t.className = 'test'; });
      this.setLine(-1);
    }

    async play() {
      const id = ++this.run;
      this.paused = false;
      this.root.classList.add('running');
      this.root.querySelector('[data-act="toggle"]')?.replaceChildren(document.createTextNode('❚❚ Pause'));
      this.reset();
      this.setStatus('Running…', 'run');
      try {
        for (const s of STEPS) {
          if (s.test != null) this.tests[s.test]?.classList.add('running');
          if (s.line != null) this.setLine(s.line);
          for (const [t, c] of s.log ?? []) { this.log(t, c); await this.sleep(110); }
          if (s.act) { const [kind, ...args] = s.act; await this[kind](...args); }
          if (s.pass != null) { const t = this.tests[s.pass]; if (t) t.className = 'test passed'; }
          await this.sleep(s.wait ?? 350);
          if (s.done) { this.setLine(-1); this.setStatus('3 passed', 'ok'); }
        }
        this.root.classList.remove('running');
        this.root.querySelector('[data-act="toggle"]')?.replaceChildren(document.createTextNode('▶ Run again'));
        if (this.mini && id === this.run) { await this.sleep(2600); if (id === this.run && this.visible) this.play(); }
      } catch { /* restarted or paused away */ }
    }
    toggle() {
      if (!this.root.classList.contains('running')) return this.play();
      this.paused = !this.paused;
      this.setStatus(this.paused ? 'Paused' : 'Running…', this.paused ? 'pause' : 'run');
      this.root.querySelector('[data-act="toggle"]')?.replaceChildren(document.createTextNode(this.paused ? '▶ Resume' : '❚❚ Pause'));
    }
    restart() {
      this.root.querySelector('[data-act="toggle"]')?.replaceChildren(document.createTextNode('❚❚ Pause'));
      this.play();
    }
  }

  document.querySelectorAll('[data-demo]').forEach((root) => {
    const d = new Demo(root);
    d.reset();
    d.setStatus('Ready', '');
    // start when scrolled into view (not for reduced-motion users: they press play)
    new IntersectionObserver(([e]) => {
      d.visible = e.isIntersecting;
      if (e.isIntersecting && !still && !d.started) { d.started = true; d.play(); }
      if (d.mini) d.paused = !e.isIntersecting; // the home loop rests while off screen
    }, { threshold: 0.35 }).observe(root);
  });
})();
