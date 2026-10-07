// Builds the static site into dist/ (works from GitHub Pages and straight from file://).
//   dist/index.html            categorized catalog with search
//   dist/<slug>.html           one page per animated pattern, with the step player
//   dist/th/…                  the same pages in Thai (patterns/<slug>/th.json, i18n/th.json)
//   dist/diagrams/<slug>.svg   the diagram exactly as in the repo (README version)
//   dist/diagrams/<slug>.stage.svg  stage only (no title/captions), used for card thumbnails
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { marked } from 'marked';
import { CANVAS, abs, esc, loadCatalog, readJSON, readText, readmeBody, stripBlock } from './lib/core.mjs';

const pkg = readJSON('package.json');
const repo = String(pkg.repository?.url ?? pkg.repository ?? '').replace(/^git\+/, '').replace(/\.git$/, '') || null;
const SITE = {
  name: 'Animated Architecture Patterns',
  description: 'Self-explaining, looping diagrams of architecture styles, cloud design patterns, auth flows, the classic GoF design patterns and the algorithms underneath them, for solutions architects and developers.',
  url: pkg.homepage ?? null,
};

const catalog = loadCatalog();
const animated = catalog.patterns.filter((p) => p.animated && !p.metaError);
const OUT = abs('dist');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/assets`, { recursive: true });
mkdirSync(`${OUT}/diagrams`, { recursive: true });
mkdirSync(`${OUT}/th`, { recursive: true });
for (const f of ['site.css', 'player.js', 'index.js', 'favicon.svg']) copyFileSync(abs('src/site', f), `${OUT}/assets/${f}`);
mkdirSync(`${OUT}/assets/fonts`, { recursive: true });
for (const f of ['anuphan-thai.woff2', 'anuphan-latin.woff2', 'OFL.txt']) copyFileSync(abs('src/site/fonts', f), `${OUT}/assets/fonts/${f}`);
writeFileSync(`${OUT}/.nojekyll`, '');

// ---------------------------------------------------------------------------
// Languages. English is the source; Thai falls back to it wherever a translation is missing.

const EN = {
  siteDescription: SITE.description,
  indexTitle: 'architecture styles, cloud patterns, auth flows, design patterns and algorithms',
  heroTitle: 'Architecture patterns, <span>animated</span>.',
  heroTail: 'Pick a pattern, press play, or step through it one frame of the story at a time.',
  statAnimated: 'animated', statPlanned: 'planned', statCategories: 'categories',
  pauseAnimations: '⏸ Pause animations', playAnimations: '▶ Play animations',
  filterLabel: 'Filter patterns', filterPlaceholder: 'Filter patterns, e.g. oauth, queue, failover  ( / )',
  categories: 'Categories', categoryCount: '{n} of {total} animated', planned: 'Planned', plannedTag: 'planned',
  noMatch: 'No patterns match that filter.',
  catalog: 'Catalog', allPatterns: 'All patterns', alsoKnownAs: 'Also known as',
  diagramAlt: 'Animated diagram: {title}', playerLabel: 'Animated diagram with step controls',
  stageTitle: 'Click to play, pause or continue',
  controlsTitle: 'Keyboard: ← → play the previous / next step · Space play, pause or continue · R replay · 1–{n} jump to a step',
  play: 'Play', pause: 'Pause', prevStep: 'Previous step', nextStep: 'Next step', replayStep: 'Replay this step',
  slowDown: 'Slow down', normalSpeed: 'Normal speed',
  stepHeading: 'Step {k} · {title}.', stepOf: 'Step <b>{k}</b> of {n}', playAll: 'play all', replay: '↻ replay',
  startOver: 'start over', next: 'next step', playingAll: 'playing all steps', playingStep: 'playing this step', paused: 'paused',
  relatedPatterns: 'Related patterns', relatedComponents: 'Related components and services', relatedPrinciples: 'Related principles and frameworks', references: 'References', useInDocs: 'Use it in your docs',
  downloadSvg: '<a href="{href}">Download the SVG</a>: it animates on its own in any &lt;img&gt;, README or wiki.',
  previous: '← Previous', nextPage: 'Next →',
  footer: 'Every diagram is a single SVG animated with CSS. It works as a plain &lt;img&gt; in any README, and the pages here drive the same file step by step.',
  articleInEnglish: '', diagramNote: '',
};
// The strings the browser scripts (player.js, index.js) need.
const JS_KEYS = ['play', 'pause', 'nextStep', 'stepOf', 'playAll', 'replay', 'startOver', 'next', 'playingAll', 'playingStep', 'paused', 'slowDown', 'normalSpeed', 'pauseAnimations', 'playAnimations'];

const TH = readJSON('i18n/th.json');
const LANGS = {
  en: { code: 'en', name: 'English', dir: '', root: '', ui: EN, cats: {} },
  th: { code: 'th', name: TH.name, dir: 'th/', root: '../', ui: { ...EN, ...TH.ui }, cats: TH.categories },
};
const fill = (s, v = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
const t = (L, key, v) => fill(L.ui[key], v);
const otherLang = (L) => (L.code === 'en' ? LANGS.th : LANGS.en);
// Relative link from a page in L to the same page in the other language.
const switchHref = (L, page) => (L.code === 'en' ? `th/${page}` : `../${page}`);

const thText = new Map(catalog.patterns.map((p) => {
  const f = `patterns/${p.slug}/th.json`;
  return [p.slug, existsSync(abs(f)) ? readJSON(f) : null];
}));
// A pattern's text in language L.
function text(p, L) {
  const th = L.code === 'th' ? thText.get(p.slug) : null;
  return {
    summary: th?.summary ?? p.summary,
    steps: (p.meta?.steps ?? []).map((s, k) => ({ title: th?.steps?.[k]?.title ?? s.title, body: th?.steps?.[k]?.body ?? s.body })),
  };
}
const catTitle = (c, L) => L.cats[c.id]?.title ?? c.title;
const catBlurb = (c, L) => L.cats[c.id]?.blurb ?? c.blurb;

// ---------------------------------------------------------------------------
// SVG variants

function stageSvg(svg, { inline, label }) {
  let out = stripBlock(svg, 'svg', 'chrome').replace(/<!--[\s\S]*?-->\n?/g, '');
  const [, , w, h] = CANVAS.stage.split(' ');
  out = out.replace(/<svg\b[^>]*>/, (tag) => {
    let tg = tag.replace(/viewBox="[^"]*"/, `viewBox="${CANVAS.stage}"`);
    tg = inline
      ? tg.replace(/\s(width|height)="[^"]*"/g, '').replace(/\saria-labelledby="[^"]*"/, ` aria-label="${esc(label)}"`).replace('class="diagram"', 'class="diagram live"')
      : tg.replace(/width="[^"]*"/, `width="${w}"`).replace(/height="[^"]*"/, `height="${h}"`);
    return tg;
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

// `page` is the file name inside the language folder (index.html, circuit-breaker.html).
function layout({ L, page, title, description, body, scripts = [] }) {
  const O = otherLang(L);
  const abs_ = (lang, p) => (SITE.url ? `${SITE.url}${lang.dir}${p}` : null);
  const alternates = SITE.url
    ? Object.values(LANGS).map((lang) => `<link rel="alternate" hreflang="${lang.code}" href="${esc(abs_(lang, page))}">`).join('\n')
    : '';
  const strings = Object.fromEntries(JS_KEYS.map((k) => [k, L.ui[k]]));
  const page_ = `<!doctype html>
<html lang="${L.code}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
${alternates}
<link rel="icon" href="${L.root}assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${L.root}assets/site.css">
</head>
<body>
<header class="topbar"><div class="wrap">
  <a class="brand" href="index.html">${LOGO}<span>${esc(SITE.name)}</span></a>
  <nav><a href="index.html#catalog">${esc(L.ui.catalog)}</a>${repo ? `<a href="${esc(repo)}">GitHub</a>` : ''}<a class="lang-switch" href="${switchHref(L, page)}" hreflang="${O.code}" lang="${O.code}" title="${O.code === 'th' ? 'อ่านหน้านี้เป็นภาษาไทย' : 'Read this page in English'}">${esc(O.name)}</a></nav>
</div></header>
${body}
<footer class="foot"><div class="wrap"><p>${L.ui.footer}</p></div></footer>
<script id="i18n" type="application/json">${JSON.stringify(strings).replace(/</g, '\\u003c')}</script>
${scripts.map((s) => `<script src="${L.root}assets/${s}" defer></script>`).join('\n')}
</body>
</html>
`;
  // Browsers' Thai dictionaries split the casual ยังไง into ยัง / ไง at a line end; a word joiner keeps it whole.
  return L.code === 'th' ? page_.replaceAll('ยังไง', 'ยัง\u2060ไง') : page_;
}

// README prose links to sibling patterns as ../<slug>/ (right on GitHub); on the site that page is <slug>.html.
const siteLinks = (html) => html.replace(/href="\.\.\/([a-z0-9-]+)\/?(#[^"]*)?"/g, (m, slug, hash = '') =>
  catalog.bySlug.get(slug)?.animated ? `href="${slug}.html${hash}"` : m);

// Same diagram with every animation switched off: the resting state reads as step 1.
const still = (svg) => svg.replace(/<\/svg>\s*$/, '<style>.diagram,.diagram *{animation:none!important}</style>\n</svg>\n');

// Search matches either language, so English terms keep working on the Thai pages.
const searchText = (p, L) => [...new Set([p.title, p.summary, text(p, L).summary, p.category.title, catTitle(p.category, L), ...(p.meta?.aka ?? [])])].join(' ').toLowerCase();

// ---------------------------------------------------------------------------
// Index

function indexPage(L) {
  const R = L.root;
  const total = catalog.patterns.length;
  const featured = animated.find((p) => p.slug === 'circuit-breaker') ?? animated[0];
  const toc = catalog.categories.map((c) => {
    const n = c.items.filter((p) => p.animated).length;
    return `<li><a href="#${c.id}"><span class="icon" aria-hidden="true">${c.icon}</span><span class="name">${esc(catTitle(c, L))}</span><span class="n" title="${esc(t(L, 'categoryCount', { n, total: c.items.length }))}">${n}/${c.items.length}</span></a></li>`;
  }).join('\n');

  const sections = catalog.categories.map((c) => {
    const cards = c.items.filter((p) => p.animated).map((p) => `
      <a class="card" href="${p.slug}.html" data-search="${esc(searchText(p, L))}">
        <div class="thumb"><img src="${R}diagrams/${p.slug}.stage.svg" data-still="${R}diagrams/${p.slug}.stage.still.svg" alt="" loading="lazy" width="960" height="400"></div>
        <div class="body"><h3>${esc(p.title)}</h3><p>${esc(text(p, L).summary)}</p></div>
      </a>`).join('');
    const planned = c.items.filter((p) => !p.animated).map((p) =>
      `<li data-search="${esc(searchText(p, L))}"><strong>${esc(p.title)}</strong> <span>— ${esc(text(p, L).summary)}</span></li>`).join('\n');
    return `
  <section class="category" id="${c.id}">
    <header><h2><span class="icon" aria-hidden="true">${c.icon}</span>${esc(catTitle(c, L))}</h2><p>${esc(catBlurb(c, L))}</p></header>
    ${cards ? `<div class="grid">${cards}\n    </div>` : ''}
    ${planned ? `<div class="planned"><h3>${esc(L.ui.planned)}</h3><ul>\n${planned}\n</ul></div>` : ''}
  </section>`;
  }).join('\n');

  // The English index shows the full README diagram; the Thai one shows the stage only, without the English captions.
  const fig = L.code === 'en'
    ? `<img src="${R}diagrams/${featured.slug}.svg" data-still="${R}diagrams/${featured.slug}.still.svg" alt="${esc(t(L, 'diagramAlt', { title: featured.title }))}" width="960" height="576">`
    : `<img src="${R}diagrams/${featured.slug}.stage.svg" data-still="${R}diagrams/${featured.slug}.stage.still.svg" alt="${esc(t(L, 'diagramAlt', { title: featured.title }))}" width="960" height="400">`;
  const body = `
<main>
  <section class="hero wrap">
    <div>
      <h1>${L.ui.heroTitle}</h1>
      <p class="lede">${esc(L.ui.siteDescription)} ${esc(L.ui.heroTail)}</p>
      ${L.ui.diagramNote ? `<p class="lang-note">${esc(L.ui.diagramNote)}</p>` : ''}
      <ul class="stats">
        <li><strong>${animated.length}</strong> ${esc(L.ui.statAnimated)}</li>
        <li><strong>${total - animated.length}</strong> ${esc(L.ui.statPlanned)}</li>
        <li><strong>${catalog.categories.length}</strong> ${esc(L.ui.statCategories)}</li>
        <li><button type="button" class="motion-toggle" aria-pressed="false">${esc(L.ui.pauseAnimations)}</button></li>
      </ul>
      <label class="search">${ICON.search}<span class="sr-only">${esc(L.ui.filterLabel)}</span><input type="search" placeholder="${esc(L.ui.filterPlaceholder)}" autocomplete="off"></label>
    </div>
    <figure class="featured">
      <a href="${featured.slug}.html">${fig}</a>
      <figcaption>${esc(featured.title)}: ${esc(text(featured, L).summary)}</figcaption>
    </figure>
  </section>
  <div class="catalog wrap" id="catalog">
    <nav class="side-toc" aria-label="${esc(L.ui.categories)}">
      <button type="button" class="side-toc-toggle" aria-expanded="false" aria-controls="side-toc-list">${esc(L.ui.categories)}<span class="current"></span><span aria-hidden="true">▾</span></button>
      <p class="side-toc-title">${esc(L.ui.categories)}</p>
      <ul id="side-toc-list">
${toc}
      </ul>
    </nav>
    <div class="sections">
${sections}
      <p class="empty" hidden>${esc(L.ui.noMatch)}</p>
    </div>
  </div>
</main>`;
  return layout({ L, page: 'index.html', title: `${SITE.name}: ${L.ui.indexTitle}`, description: L.ui.siteDescription, body, scripts: ['index.js'] });
}

// ---------------------------------------------------------------------------
// Pattern pages

function patternPage(p, i, L) {
  const R = L.root;
  const tx = text(p, L);
  const svg = stageSvg(readText(`${p.dir}/diagram.svg`), { inline: true, label: t(L, 'diagramAlt', { title: p.title }) });
  const steps = tx.steps.map((s, k) => `
        <li><button type="button"><span class="n">${k + 1}</span><span class="t">${esc(s.title)}</span></button></li>`).join('');
  const details = tx.steps.map((s, k) => `
        <p class="detail${k ? '' : ' on'}"><strong>${esc(t(L, 'stepHeading', { k: k + 1, title: s.title }))}</strong> ${siteLinks(marked.parseInline(s.body))}</p>`).join('');
  const items = (slugs) => (slugs ?? []).map((slug) => catalog.bySlug.get(slug)).filter(Boolean).map((r) => r.animated
    ? `<li><a href="${r.slug}.html">${esc(r.title)}</a></li>`
    : `<li class="planned-item">${esc(r.title)}<span class="tag">${esc(L.ui.plannedTag)}</span></li>`).join('\n');
  const related = items(p.meta.related);
  const components = items(p.components);
  const principles = items(p.principles);
  const refs = (p.meta.references ?? []).map((r) => `<li><a href="${esc(r.url)}" rel="noopener">${esc(r.title)}</a></li>`).join('\n');
  const prev = animated[i - 1];
  const next = animated[i + 1];
  const aka = p.meta.aka?.length ? `<p class="aka">${esc(L.ui.alsoKnownAs)} ${p.meta.aka.map(esc).join(', ')}</p>` : '';
  // A Thai article (README.th.md) when there is one; otherwise the English article with a note.
  const thReadme = `${p.dir}/README.th.md`;
  const useThai = L.code === 'th' && existsSync(abs(thReadme));
  const article = siteLinks(marked.parse(readmeBody(readText(useThai ? thReadme : `${p.dir}/README.md`))));
  const note = L.code !== 'en' && !useThai && L.ui.articleInEnglish ? `<p class="lang-note">${esc(L.ui.articleInEnglish)}</p>\n` : '';

  const body = `
<main>
  <header class="page-head wrap">
    <nav class="crumbs"><a href="index.html">${esc(L.ui.allPatterns)}</a> / <a href="index.html#${p.category.id}">${p.category.icon} ${esc(catTitle(p.category, L))}</a></nav>
    <h1>${esc(p.title)}</h1>
    <p class="lede">${esc(tx.summary)}</p>
    ${aka}
  </header>
  <div class="wrap">
    <section class="player" aria-label="${esc(L.ui.playerLabel)}">
      <div class="stage" title="${esc(L.ui.stageTitle)}">${svg}</div>
      <div class="controls" title="${esc(t(L, 'controlsTitle', { n: tx.steps.length }))}">
        <button type="button" data-action="play" aria-label="${esc(L.ui.pause)}">${ICON.pause}${ICON.play}</button>
        <button type="button" data-action="prev" aria-label="${esc(L.ui.prevStep)}" title="${esc(L.ui.prevStep)} (←)">${ICON.prev}</button>
        <button type="button" data-action="next" aria-label="${esc(L.ui.nextStep)}" title="${esc(L.ui.nextStep)} (→)">${ICON.next}</button>
        <button type="button" data-action="replay" aria-label="${esc(L.ui.replayStep)}" title="${esc(L.ui.replayStep)} (R)">${ICON.replay}</button>
        <button type="button" data-action="rate" aria-label="${esc(L.ui.slowDown)}">1×</button>
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
${note}${article}
    </article>
    <aside class="side">
      ${related ? `<section><h2>${esc(L.ui.relatedPatterns)}</h2><ul>${related}</ul></section>` : ''}
      ${components ? `<section><h2>${esc(L.ui.relatedComponents)}</h2><ul>${components}</ul></section>` : ''}
      ${principles ? `<section><h2>${esc(L.ui.relatedPrinciples)}</h2><ul>${principles}</ul></section>` : ''}
      ${refs ? `<section><h2>${esc(L.ui.references)}</h2><ul>${refs}</ul></section>` : ''}
      <section><h2>${esc(L.ui.useInDocs)}</h2><ul><li>${t(L, 'downloadSvg', { href: `${R}diagrams/${p.slug}.svg` })}</li></ul></section>
    </aside>
  </div>
  <nav class="pager wrap">
    ${prev ? `<a class="prev" href="${prev.slug}.html"><small>${esc(L.ui.previous)}</small>${esc(prev.title)}</a>` : '<span></span>'}
    ${next ? `<a class="next" href="${next.slug}.html"><small>${esc(L.ui.nextPage)}</small>${esc(next.title)}</a>` : ''}
  </nav>
</main>`;
  return layout({ L, page: `${p.slug}.html`, title: `${p.title} · ${SITE.name}`, description: tx.summary, body, scripts: ['player.js'] });
}

// ---------------------------------------------------------------------------

animated.forEach((p) => {
  const svg = readText(`${p.dir}/diagram.svg`);
  writeFileSync(`${OUT}/diagrams/${p.slug}.svg`, svg);
  writeFileSync(`${OUT}/diagrams/${p.slug}.stage.svg`, stageSvg(svg, { inline: false }));
  writeFileSync(`${OUT}/diagrams/${p.slug}.still.svg`, still(svg));
  writeFileSync(`${OUT}/diagrams/${p.slug}.stage.still.svg`, still(stageSvg(svg, { inline: false })));
});
for (const L of Object.values(LANGS)) {
  animated.forEach((p, i) => writeFileSync(`${OUT}/${L.dir}${p.slug}.html`, patternPage(p, i, L)));
  writeFileSync(`${OUT}/${L.dir}index.html`, indexPage(L));
}
const translated = animated.filter((p) => thText.get(p.slug)).length;
const articles = animated.filter((p) => existsSync(abs(`${p.dir}/README.th.md`))).length;
console.log(`build: dist/ — index + ${animated.length} pattern page(s), ${catalog.patterns.length - animated.length} planned; Thai: ${translated} of ${animated.length} translated, ${articles} with the article`);
