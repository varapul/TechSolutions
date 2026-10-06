// Filters the catalog as you type. Matches title, summary, aliases and category.
(() => {
  const input = document.querySelector('.search input');
  if (!input) return;
  const entries = [...document.querySelectorAll('[data-search]')];
  const sections = [...document.querySelectorAll('.category')];
  const empty = document.querySelector('.empty');
  const tocLinks = [...document.querySelectorAll('.side-toc a')];

  function apply() {
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    // Thai pages glue some words with a word joiner (U+2060); ignore it when matching.
    for (const el of entries) {
      const text = el.dataset.search.replace(/\u2060/g, '');
      el.hidden = !words.every((w) => text.includes(w));
    }
    let any = false;
    for (const s of sections) {
      const cards = s.querySelectorAll('.card:not([hidden])').length;
      const planned = s.querySelectorAll('.planned li:not([hidden])').length;
      s.querySelector('.planned')?.toggleAttribute('hidden', planned === 0);
      s.hidden = cards + planned === 0;
      any ||= !s.hidden;
      const link = tocLinks.find((a) => a.hash === `#${s.id}`);
      if (link) link.parentElement.hidden = s.hidden;
    }
    empty.hidden = any;
    window.dispatchEvent(new Event('scroll')); // refresh the highlighted category
  }

  input.addEventListener('input', apply);
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== input) {
      e.preventDefault();
      input.focus();
    } else if (e.key === 'Escape' && document.activeElement === input) {
      input.value = '';
      apply();
    }
  });
  if (input.value) apply();
})();

// Category menu: highlight the section being read, keep it in view in the sidebar, and
// work as a dropdown on narrow screens.
(() => {
  const nav = document.querySelector('.side-toc');
  if (!nav) return;
  const links = [...nav.querySelectorAll('a[href^="#"]')];
  const toggle = nav.querySelector('.side-toc-toggle');
  const current = nav.querySelector('.current');
  const sections = links.map((a) => document.getElementById(a.hash.slice(1))).filter(Boolean);
  let active = null;

  function setActive(id) {
    if (id === active) return;
    active = id;
    let on = null;
    for (const a of links) {
      const is = a.hash === `#${id}`;
      a.classList.toggle('active', is);
      if (is) { a.setAttribute('aria-current', 'location'); on = a; } else a.removeAttribute('aria-current');
    }
    current.textContent = on ? on.querySelector('.name').textContent : '';
    if (on && nav.scrollHeight > nav.clientHeight) { // sidebar taller than the window
      const r = on.getBoundingClientRect();
      const n = nav.getBoundingClientRect();
      if (r.top < n.top) nav.scrollTop -= n.top - r.top + 8;
      else if (r.bottom > n.bottom) nav.scrollTop += r.bottom - n.bottom + 8;
    }
  }

  // The current section is the last one whose top has passed 30% of the window
  // (or the last one, once the page can't scroll any further).
  function update() {
    const visible = sections.filter((s) => !s.hidden);
    if (!visible.length) return setActive(null);
    const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    let id = visible[0].id;
    for (const s of visible) if (s.getBoundingClientRect().top <= window.innerHeight * 0.3) id = s.id;
    setActive(atEnd && window.scrollY > 0 ? visible[visible.length - 1].id : id);
  }
  let queued = false;
  window.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; update(); });
  }, { passive: true });
  window.addEventListener('resize', update);
  update();

  const close = () => { nav.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); };
  toggle.addEventListener('click', () => toggle.setAttribute('aria-expanded', String(nav.classList.toggle('open'))));
  links.forEach((a) => a.addEventListener('click', () => { close(); setActive(a.hash.slice(1)); }));
  document.addEventListener('click', (e) => { if (!nav.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('open')) { close(); toggle.focus(); }
  });
})();

// Pause or play every animated preview on the index (WCAG 2.2.2). Starts paused when the
// visitor prefers reduced motion, and remembers an explicit choice.
(() => {
  const toggle = document.querySelector('.motion-toggle');
  const imgs = [...document.querySelectorAll('img[data-still]')];
  // Button text in the page's language (the build writes it into #i18n).
  const S = { playAnimations: '▶ Play animations', pauseAnimations: '⏸ Pause animations' };
  try { Object.assign(S, JSON.parse(document.getElementById('i18n').textContent)); } catch { /* keep English */ }
  if (!toggle || !imgs.length) return;
  imgs.forEach((img) => { img.dataset.anim = img.getAttribute('src'); });
  let saved = null;
  try { saved = localStorage.getItem('motion'); } catch { /* storage blocked */ }
  let still = saved ? saved === 'off' : matchMedia('(prefers-reduced-motion: reduce)').matches;

  function apply() {
    imgs.forEach((img) => { img.src = still ? img.dataset.still : img.dataset.anim; });
    toggle.setAttribute('aria-pressed', String(still));
    toggle.textContent = still ? S.playAnimations : S.pauseAnimations;
  }
  toggle.addEventListener('click', () => {
    still = !still;
    try { localStorage.setItem('motion', still ? 'off' : 'on'); } catch { /* storage blocked */ }
    apply();
  });
  if (still) apply();
})();
