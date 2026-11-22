// Delivery flow: toggle between one and two QA stages. The step-by-step animation is pure CSS.
(() => {
  const flow = document.querySelector('[data-flow]');
  if (!flow) return;
  const btns = document.querySelectorAll('[data-qa]');
  const steps = [...flow.querySelectorAll('.fs')];
  const set = (n) => {
    flow.classList.toggle('one-qa', n === '1');
    let i = 0;
    steps.forEach((s) => { if (n === '1' && s.classList.contains('fs-opt')) return; s.style.setProperty('--i', i++); });
    flow.style.setProperty('--n', i);
    // restart the animation so the highlight starts from Plan again
    flow.classList.remove('run'); void flow.offsetWidth; flow.classList.add('run');
    btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.qa === n)));
  };
  btns.forEach((b) => b.addEventListener('click', () => set(b.dataset.qa)));
  set('2');
})();
