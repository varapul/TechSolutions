// Drives an inlined diagram. Every animation in a diagram runs on the same looping
// timeline (var(--T), split into N equal steps), so the player can pause and scrub
// all of them together by setting currentTime.
//
// Two modes:
//   play all  – the loop autoplays; the active step follows the time.
//   step      – one step plays once and holds on its final frame, like a slide.
//               Next / → / Space continue to the following step; R replays.
// A URL hash #step-3 opens the page on step 3 in step mode.
(() => {
  const player = document.querySelector('.player');
  if (!player) return;
  const svg = player.querySelector('.stage svg');
  const items = [...player.querySelectorAll('.steps li')];
  const details = [...player.querySelectorAll('.detail')];
  const playBtn = player.querySelector('[data-action="play"]');
  const rateBtn = player.querySelector('[data-action="rate"]');
  const status = player.querySelector('.status');
  const hint = player.querySelector('.hint');
  const N = items.length;
  const T = (parseFloat(getComputedStyle(svg).getPropertyValue('--T')) || 20) * 1000;
  const D = T / N;
  const HOLD = 400; // hold this many ms before the step boundary, before its fade-out starts
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let step = null; // index of the step being played in step mode, or null for "play all"
  let playing = false;
  let held = false; // step mode, paused on the step's final frame
  let rate = 1;
  let shown = ''; // last rendered state, so the DOM and the live region only change when it does

  const anims = () => svg.getAnimations({ subtree: true });
  const now = () => {
    const a = anims()[0];
    return a && a.currentTime != null ? a.currentTime % T : 0;
  };
  const seek = (t) => anims().forEach((a) => { a.currentTime = t; });
  const current = () => step ?? Math.min(N - 1, Math.floor(now() / D));

  function setPlaying(on) {
    playing = on;
    if (on) held = false;
    anims().forEach((a) => (on ? a.play() : a.pause()));
  }

  function setHash(k) {
    try {
      const url = k == null ? location.pathname + location.search : `#step-${k + 1}`;
      history.replaceState(null, '', url);
    } catch { /* file:// in some browsers */ }
  }

  // Play step k once from its start, then hold (or show its final frame at once).
  function playStep(k, { animate = true, hash = true } = {}) {
    step = ((k % N) + N) % N;
    if (hash) setHash(step);
    if (animate) {
      seek(step * D + 1);
      setPlaying(true);
    } else {
      seek(step * D + D - HOLD);
      setPlaying(false);
      held = true;
    }
    render();
  }

  function playAll() {
    step = null;
    setHash(null);
    setPlaying(true);
    render();
  }

  // Play button, Space and a click on the diagram.
  function toggle() {
    if (playing) setPlaying(false);
    else if (step != null && held) playStep(step + 1); // continue the story one step
    else setPlaying(true);
    render();
  }

  function render() {
    const t = now();
    const k = current();
    const frac = step == null
      ? Math.min(1, Math.max(0, (t - k * D) / D))
      : held ? 1 : Math.min(1, Math.max(0, (t - k * D) / (D - HOLD)));
    items.forEach((li, i) => li.style.setProperty('--p', i === k ? frac.toFixed(3) : i < k && step == null ? 1 : 0));

    const key = `${k}|${step}|${playing}|${held}`;
    if (key === shown) return;
    shown = key;
    items.forEach((li, i) => {
      li.classList.toggle('active', i === k);
      li.querySelector('button').setAttribute('aria-current', i === k ? 'step' : 'false');
    });
    details.forEach((d, i) => d.classList.toggle('on', i === k));
    player.classList.toggle('paused', !playing);
    player.classList.toggle('held', held);

    const label = held ? 'Next step' : playing ? 'Pause' : 'Play';
    playBtn.setAttribute('aria-label', label);
    playBtn.title = `${label} (Space)`;
    hint.textContent = held ? (k === N - 1 ? 'Space or → to start over' : 'Space or → for the next step') : 'Paused';

    const n = `Step <b>${k + 1}</b> of ${N}`;
    const all = '<a href="#" data-action="all">play all</a>';
    const replay = '<a href="#" data-action="replay">↻ replay</a>';
    status.innerHTML = step == null
      ? `${n} · ${playing ? 'playing all steps' : 'paused'}`
      : held ? `${n} · ${replay} · ${all}` : `${n} · ${playing ? 'playing this step' : 'paused'} · ${all}`;
  }

  function tick() {
    if (step != null && playing) {
      const start = step * D;
      const end = start + D - HOLD;
      const t = now();
      // Reached the end of the step (or wrapped while the tab was hidden): hold on its final frame.
      if (t < start || t >= end) {
        seek(end);
        setPlaying(false);
        held = true;
      }
    }
    render();
    requestAnimationFrame(tick);
  }

  items.forEach((li, i) => li.querySelector('button').addEventListener('click', () => playStep(i)));
  playBtn.addEventListener('click', toggle);
  player.querySelector('.stage').addEventListener('click', toggle);
  player.querySelector('[data-action="prev"]').addEventListener('click', () => playStep(current() - 1));
  player.querySelector('[data-action="next"]').addEventListener('click', () => playStep(current() + 1));
  player.querySelector('[data-action="replay"]').addEventListener('click', () => playStep(current()));
  rateBtn.addEventListener('click', () => {
    rate = rate === 1 ? 0.5 : 1;
    anims().forEach((a) => { a.playbackRate = rate; });
    rateBtn.textContent = rate === 1 ? '1×' : '½×';
    rateBtn.setAttribute('aria-label', rate === 1 ? 'Slow down' : 'Normal speed');
  });
  status.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    e.preventDefault();
    if (a.dataset.action === 'all') playAll();
    else if (a.dataset.action === 'replay') playStep(current());
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight') playStep(current() + 1);
    else if (e.key === 'ArrowLeft') playStep(current() - 1);
    else if (e.key === ' ' && !e.target.closest('button, a')) toggle();
    else if (e.key === 'r' || e.key === 'R') playStep(current());
    else if (/^[1-9]$/.test(e.key) && +e.key <= N) playStep(+e.key - 1);
    else return;
    e.preventDefault();
  });

  const linked = /^#step-(\d+)$/.exec(location.hash);
  if (linked && +linked[1] >= 1 && +linked[1] <= N) playStep(+linked[1] - 1, { animate: !reduced });
  else if (reduced) playStep(0, { animate: false, hash: false }); // no autoplay; the viewer steps through
  else playAll();
  requestAnimationFrame(tick);
})();
