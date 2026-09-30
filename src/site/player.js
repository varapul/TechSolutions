// Drives an inlined diagram step by step. Every animation in a diagram runs on
// the same looping timeline (var(--T), split into equal steps), so the player can
// pause, scrub and loop a single step by setting currentTime on all of them.
(() => {
  const player = document.querySelector('.player');
  if (!player) return;
  const svg = player.querySelector('.stage svg');
  const items = [...player.querySelectorAll('.steps li')];
  const details = [...player.querySelectorAll('.detail')];
  const playBtn = player.querySelector('[data-action="play"]');
  const rateBtn = player.querySelector('[data-action="rate"]');
  const status = player.querySelector('.status');
  const N = items.length;
  const T = (parseFloat(getComputedStyle(svg).getPropertyValue('--T')) || 20) * 1000;
  const D = T / N;

  let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let loopStep = null; // index of the step being looped, or null for the whole loop
  let rate = 1;
  let shown = ''; // last rendered step/mode, so the DOM and live region only change when it does

  const anims = () => svg.getAnimations({ subtree: true });
  const now = () => {
    const a = anims()[0];
    return a && a.currentTime != null ? a.currentTime % T : 0;
  };
  const seek = (t) => anims().forEach((a) => { a.currentTime = t; });

  function setPlaying(on) {
    playing = on;
    anims().forEach((a) => (on ? a.play() : a.pause()));
    player.classList.toggle('paused', !on);
    playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
    playBtn.setAttribute('aria-pressed', String(!on));
  }

  function goTo(k, { loop = true, play = true } = {}) {
    k = (k + N) % N;
    loopStep = loop ? k : null;
    // land a little way into the step, after its fade-in
    seek(k * D + (play ? 1 : D * 0.6));
    setPlaying(play);
    render();
  }

  function render() {
    const t = now();
    const k = loopStep ?? Math.min(N - 1, Math.floor(t / D));
    const frac = Math.min(1, Math.max(0, (t - k * D) / D));
    items.forEach((li, i) => li.style.setProperty('--p', i < k && loopStep == null ? 1 : i === k ? frac.toFixed(3) : 0));
    const key = `${k}:${loopStep}`;
    if (key === shown) return;
    shown = key;
    items.forEach((li, i) => {
      li.classList.toggle('active', i === k);
      li.querySelector('button').setAttribute('aria-current', i === k ? 'step' : 'false');
    });
    details.forEach((d, i) => d.classList.toggle('on', i === k));
    status.innerHTML = loopStep == null
      ? `Step <b>${k + 1}</b> of ${N} · playing all steps`
      : `Looping step <b>${k + 1}</b> of ${N} · <a href="#" data-action="all">play all</a>`;
  }

  function tick() {
    if (loopStep != null) {
      const t = now();
      const start = loopStep * D;
      if (t < start || t >= start + D - 20) seek(start + 1);
    }
    render();
    requestAnimationFrame(tick);
  }

  items.forEach((li, i) => li.querySelector('button').addEventListener('click', () => goTo(i)));
  playBtn.addEventListener('click', () => setPlaying(!playing));
  player.querySelector('.stage').addEventListener('click', () => setPlaying(!playing));
  player.querySelector('[data-action="prev"]').addEventListener('click', () => goTo((loopStep ?? Math.floor(now() / D)) - 1));
  player.querySelector('[data-action="next"]').addEventListener('click', () => goTo((loopStep ?? Math.floor(now() / D)) + 1));
  rateBtn.addEventListener('click', () => {
    rate = rate === 1 ? 0.5 : 1;
    anims().forEach((a) => { a.playbackRate = rate; });
    rateBtn.textContent = rate === 1 ? '1×' : '½×';
    rateBtn.setAttribute('aria-label', rate === 1 ? 'Slow down' : 'Normal speed');
  });
  status.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="all"]')) {
      e.preventDefault();
      loopStep = null;
      setPlaying(true);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight') goTo((loopStep ?? Math.floor(now() / D)) + 1);
    else if (e.key === 'ArrowLeft') goTo((loopStep ?? Math.floor(now() / D)) - 1);
    else if (e.key === ' ' && !e.target.closest('button, a')) { e.preventDefault(); setPlaying(!playing); }
    else if (/^[1-9]$/.test(e.key) && +e.key <= N) goTo(+e.key - 1);
    else return;
  });

  if (playing) setPlaying(true);
  else goTo(0, { loop: false, play: false });
  requestAnimationFrame(tick);
})();
