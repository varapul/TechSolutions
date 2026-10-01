// Builds the static site into dist/ (works from GitHub Pages and straight from file://).
//   dist/index.html            categorized catalog with search
//   dist/<slug>.html           one page per animated pattern, with the step player
//   dist/diagrams/<slug>.svg   the diagram exactly as in the repo (README version)
//   dist/diagrams/<slug>.stage.svg  stage only (no title/captions), used for card thumbnails
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { marked } from 'marked';
import { CANVAS, abs, esc, loadCatalog, readJSON, readText, readmeBody, stripBlock } from './lib/core.mjs';

const pkg = readJSON('package.json');
const repo = String(pkg.repository?.url ?? pkg.repository ?? '').replace(/^git\+/, '').replace(/\.git$/, '') || null;
const SITE = {
  name: 'Animated Architecture Patterns',
  description: 'Self-explaining, looping diagrams of architecture styles, cloud design patterns and auth flows, for solutions architects.',
};

const catalog = loadCatalog();
const animated = catalog.patterns.filter((p) => p.animated && !p.metaError);
const OUT = abs('dist');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/assets`, { recursive: true });
mkdirSync(`${OUT}/diagrams`, { recursive: true });
for (const f of ['site.css', 'player.js', 'index.js', 'favicon.svg']) copyFileSync(abs('src/site', f), `${OUT}/assets/${f}`);
writeFileSync(`${OUT}/.nojekyll`, '');

// ---------------------------------------------------------------------------
// SVG variants

function stageSvg(svg, { inline, label }) {
  let out = stripBlock(svg, 'svg', 'chrome').replace(/<!--[\s\S]*?-->\n?/g, '');
  const [, , w, h] = CANVAS.stage.split(' ');
  out = out.replace(/<svg\b[^>]*>/, (tag) => {
    let t = tag.replace(/viewBox="[^"]*"/, `viewBox="${CANVAS.stage}"`);
    t = inline
      ? t.replace(/\s(width|height)="[^"]*"/g, '').replace(/\saria-labelledby="[^"]*"/, ` aria-label="${esc(label)}"`).replace('class="diagram"', 'class="diagram live"')
      : t.replace(/width="[^"]*"/, `width="${w}"`).replace(/height="[^"]*"/, `height="${h}"`);
    return t;
  });
  if (inline) out = out.replace(/<title[^>]*>[\s\S]*?<\/title>\n?/, '').replace(/<desc[^>]*>[\s\S]*?<\/desc>\n?/, '');
  return out;
}

// ---------------------------------------------------------------------------
// Page chrome

const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 16L24 8M8 16L24 24" stroke="currentColor" stroke-opacity=".45" stroke-width="2.5" stroke-linecap="round" fill="none"/><rect x="2" y="10" width="12" height="12" rx="3.5" fill="var(--accent)"/><rect x="19" y="2" width="11" height="11" rx="3.5" fill="var(--accent)" opacity=".6"/><rect x="19" y="19" width="11" height="11" rx="3.5" fill="var(--accent)" opacity=".85"/></svg>`;
const ICON = {
  play: '<svg class="icon-play" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>',
  pause: '<svg class="icon-pause" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor"/></svg>',
  prev: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 3L5.5 8l5 5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3l5 5-5 5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  replay: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.4h-2.4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  search: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

const layout = ({ title, description, body, scripts = [] }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="assets/site.css">
</head>
<body>
<header class="topbar"><div class="wrap">
  <a class="brand" href="index.html">${LOGO}<span>${esc(SITE.name)}</span></a>
  <nav><a href="index.html#catalog">Catalog</a>${repo ? `<a href="${esc(repo)}">GitHub</a>` : ''}</nav>
</div></header>
${body}
<footer class="foot"><div class="wrap"><p>Every diagram is a single SVG animated with CSS. It works as a plain &lt;img&gt; in any README, and the pages here drive the same file step by step.</p></div></footer>
${scripts.map((s) => `<script src="assets/${s}" defer></script>`).join('\n')}
</body>
</html>
`;

// README prose links to sibling patterns as ../<slug>/ (right on GitHub); on the site that page is <slug>.html.
const siteLinks = (html) => html.replace(/href="\.\.\/([a-z0-9-]+)\/?(#[^"]*)?"/g, (m, slug, hash = '') =>
  catalog.bySlug.get(slug)?.animated ? `href="${slug}.html${hash}"` : m);

// Same diagram with every animation switched off: the resting state reads as step 1.
const still = (svg) => svg.replace(/<\/svg>\s*$/, '<style>.diagram,.diagram *{animation:none!important}</style>\n</svg>\n');

const searchText = (p) => [p.title, p.summary, p.category.title, ...(p.meta?.aka ?? [])].join(' ').toLowerCase();

// ---------------------------------------------------------------------------
// Index

function indexPage() {
  const total = catalog.patterns.length;
  const featured = animated.find((p) => p.slug === 'circuit-breaker') ?? animated[0];
  const toc = catalog.categories.map((c) => {
    const n = c.items.filter((p) => p.animated).length;
    return `<li><a href="#${c.id}"><span class="icon" aria-hidden="true">${c.icon}</span><span class="name">${esc(c.title)}</span><span class="n" title="${n} of ${c.items.length} animated">${n}/${c.items.length}</span></a></li>`;
  }).join('\n');

  const sections = catalog.categories.map((c) => {
    const cards = c.items.filter((p) => p.animated).map((p) => `
      <a class="card" href="${p.slug}.html" data-search="${esc(searchText(p))}">
        <div class="thumb"><img src="diagrams/${p.slug}.stage.svg" data-still="diagrams/${p.slug}.stage.still.svg" alt="" loading="lazy" width="960" height="400"></div>
        <div class="body"><h3>${esc(p.title)}</h3><p>${esc(p.summary)}</p></div>
      </a>`).join('');
    const planned = c.items.filter((p) => !p.animated).map((p) =>
      `<li data-search="${esc(searchText(p))}"><strong>${esc(p.title)}</strong> <span>— ${esc(p.summary)}</span></li>`).join('\n');
    return `
  <section class="category" id="${c.id}">
    <header><h2><span class="icon" aria-hidden="true">${c.icon}</span>${esc(c.title)}</h2><p>${esc(c.blurb)}</p></header>
    ${cards ? `<div class="grid">${cards}\n    </div>` : ''}
    ${planned ? `<div class="planned"><h3>Planned</h3><ul>\n${planned}\n</ul></div>` : ''}
  </section>`;
  }).join('\n');

  const body = `
<main>
  <section class="hero wrap">
    <div>
      <h1>Architecture patterns, <span>animated</span>.</h1>
      <p class="lede">${esc(SITE.description)} Pick a pattern, press play, or step through it one frame of the story at a time.</p>
      <ul class="stats">
        <li><strong>${animated.length}</strong> animated</li>
        <li><strong>${total - animated.length}</strong> planned</li>
        <li><strong>${catalog.categories.length}</strong> categories</li>
        <li><button type="button" class="motion-toggle" aria-pressed="false">⏸ Pause animations</button></li>
      </ul>
      <label class="search">${ICON.search}<span class="sr-only">Filter patterns</span><input type="search" placeholder="Filter patterns, e.g. oauth, queue, failover  ( / )" autocomplete="off"></label>
    </div>
    <figure class="featured">
      <a href="${featured.slug}.html"><img src="diagrams/${featured.slug}.svg" data-still="diagrams/${featured.slug}.still.svg" alt="Animated diagram: ${esc(featured.title)}" width="960" height="576"></a>
      <figcaption>${esc(featured.title)}: ${esc(featured.summary)}</figcaption>
    </figure>
  </section>
  <div class="catalog wrap" id="catalog">
    <nav class="side-toc" aria-label="Categories">
      <button type="button" class="side-toc-toggle" aria-expanded="false" aria-controls="side-toc-list">Categories<span class="current"></span><span aria-hidden="true">▾</span></button>
      <p class="side-toc-title">Categories</p>
      <ul id="side-toc-list">
${toc}
      </ul>
    </nav>
    <div class="sections">
${sections}
      <p class="empty" hidden>No patterns match that filter.</p>
    </div>
  </div>
</main>`;
  return layout({ title: `${SITE.name}: architecture styles, cloud patterns and auth flows`, description: SITE.description, body, scripts: ['index.js'] });
}

// ---------------------------------------------------------------------------
// Pattern pages

function patternPage(p, i) {
  const svg = stageSvg(readText(`${p.dir}/diagram.svg`), { inline: true, label: `Animated diagram: ${p.title}` });
  const steps = p.meta.steps.map((s, k) => `
        <li><button type="button"><span class="n">${k + 1}</span><span class="t">${esc(s.title)}</span></button></li>`).join('');
  const details = p.meta.steps.map((s, k) => `
        <p class="detail${k ? '' : ' on'}"><strong>Step ${k + 1} · ${esc(s.title)}.</strong> ${siteLinks(marked.parseInline(s.body))}</p>`).join('');
  const related = (p.meta.related ?? []).map((slug) => catalog.bySlug.get(slug)).filter(Boolean).map((r) => r.animated
    ? `<li><a href="${r.slug}.html">${esc(r.title)}</a></li>`
    : `<li class="planned-item">${esc(r.title)}<span class="tag">planned</span></li>`).join('\n');
  const refs = (p.meta.references ?? []).map((r) => `<li><a href="${esc(r.url)}" rel="noopener">${esc(r.title)}</a></li>`).join('\n');
  const prev = animated[i - 1];
  const next = animated[i + 1];
  const aka = p.meta.aka?.length ? `<p class="aka">Also known as ${p.meta.aka.map(esc).join(', ')}</p>` : '';

  const body = `
<main>
  <header class="page-head wrap">
    <nav class="crumbs"><a href="index.html">All patterns</a> / <a href="index.html#${p.category.id}">${p.category.icon} ${esc(p.category.title)}</a></nav>
    <h1>${esc(p.title)}</h1>
    <p class="lede">${esc(p.summary)}</p>
    ${aka}
  </header>
  <div class="wrap">
    <section class="player" aria-label="Animated diagram with step controls">
      <div class="stage" title="Click to play, pause or continue">${svg}</div>
      <div class="controls" title="Keyboard: ← → play the previous / next step · Space play, pause or continue · R replay · 1–${p.meta.steps.length} jump to a step">
        <button type="button" data-action="play" aria-label="Pause">${ICON.pause}${ICON.play}</button>
        <button type="button" data-action="prev" aria-label="Previous step" title="Previous step (←)">${ICON.prev}</button>
        <button type="button" data-action="next" aria-label="Next step" title="Next step (→)">${ICON.next}</button>
        <button type="button" data-action="replay" aria-label="Replay this step" title="Replay this step (R)">${ICON.replay}</button>
        <button type="button" data-action="rate" aria-label="Slow down">1×</button>
        <span class="status" aria-live="polite"></span>
      </div>
      <ol class="steps">${steps}
      </ol>
      <div class="details">${details}
      </div>
    </section>
  </div>
  <div class="content wrap">
    <article class="prose">
${siteLinks(marked.parse(readmeBody(readText(`${p.dir}/README.md`))))}
    </article>
    <aside class="side">
      ${related ? `<section><h2>Related patterns</h2><ul>${related}</ul></section>` : ''}
      ${refs ? `<section><h2>References</h2><ul>${refs}</ul></section>` : ''}
      <section><h2>Use it in your docs</h2><ul><li><a href="diagrams/${p.slug}.svg">Download the SVG</a>: it animates on its own in any &lt;img&gt;, README or wiki.</li></ul></section>
    </aside>
  </div>
  <nav class="pager wrap">
    ${prev ? `<a class="prev" href="${prev.slug}.html"><small>← Previous</small>${esc(prev.title)}</a>` : '<span></span>'}
    ${next ? `<a class="next" href="${next.slug}.html"><small>Next →</small>${esc(next.title)}</a>` : ''}
  </nav>
</main>`;
  return layout({ title: `${p.title} · ${SITE.name}`, description: p.summary, body, scripts: ['player.js'] });
}

// ---------------------------------------------------------------------------

animated.forEach((p, i) => {
  const svg = readText(`${p.dir}/diagram.svg`);
  writeFileSync(`${OUT}/diagrams/${p.slug}.svg`, svg);
  writeFileSync(`${OUT}/diagrams/${p.slug}.stage.svg`, stageSvg(svg, { inline: false }));
  writeFileSync(`${OUT}/diagrams/${p.slug}.still.svg`, still(svg));
  writeFileSync(`${OUT}/diagrams/${p.slug}.stage.still.svg`, still(stageSvg(svg, { inline: false })));
  writeFileSync(`${OUT}/${p.slug}.html`, patternPage(p, i));
});
writeFileSync(`${OUT}/index.html`, indexPage());
console.log(`build: dist/ — index + ${animated.length} pattern page(s), ${catalog.patterns.length - animated.length} planned`);
