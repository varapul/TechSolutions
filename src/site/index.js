// Filters the catalog as you type. Matches title, summary, aliases and category.
(() => {
  const input = document.querySelector('.search input');
  if (!input) return;
  const entries = [...document.querySelectorAll('[data-search]')];
  const sections = [...document.querySelectorAll('.category')];
  const empty = document.querySelector('.empty');
  const tocLinks = [...document.querySelectorAll('.toc a')];

  function apply() {
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    for (const el of entries) el.hidden = !words.every((w) => el.dataset.search.includes(w));
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
