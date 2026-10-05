// Validates the catalog, every animated pattern, and that generated blocks are current.
// Read-only; exits non-zero on any error. Run in CI before building the site.
import { existsSync, readdirSync, statSync } from 'node:fs';
import {
  CANVAS, CAPTION_MAX, STEPS, abs, catalogBlock, hasBlock, loadCatalog, readText,
  readmeBody, replaceBlock, syncPatternReadme, syncSvg,
} from './lib/core.mjs';
import { xmlErrors } from './lib/xml.mjs';

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

let catalog;
try {
  catalog = loadCatalog();
} catch (e) {
  console.error(`catalog.json / meta.json could not be loaded: ${e.message}`);
  process.exit(1);
}
const { categories, patterns, bySlug } = catalog;
// `node scripts/check.mjs <slug...>` checks only those patterns (skips repo-wide checks).
const only = process.argv.slice(2);
const inScope = (slug) => !only.length || only.includes(slug);

// ---- catalog ---------------------------------------------------------------
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const catIds = new Set();
for (const c of categories) {
  if (catIds.has(c.id)) err('catalog.json', `duplicate category id "${c.id}"`);
  catIds.add(c.id);
  for (const k of ['id', 'icon', 'title', 'blurb']) if (!c[k]) err('catalog.json', `category "${c.id}" is missing ${k}`);
}
const slugs = new Set();
for (const p of patterns) {
  const where = `catalog.json › ${p.slug}`;
  if (slugs.has(p.slug)) err(where, 'duplicate slug');
  slugs.add(p.slug);
  if (!SLUG.test(p.slug)) err(where, 'slug must be kebab-case');
  if (!p.title || !p.summary) err(where, 'needs title and summary');
  if (/[|]/.test(p.title + p.summary)) err(where, '"|" breaks the Markdown tables');
  if (p.summary?.length > 140) warn(where, `summary is ${p.summary.length} chars (keep it to one line, ≤ 140)`);
}

// ---- pattern folders ---------------------------------------------------------
for (const dir of readdirSync(abs('patterns'))) {
  if (!statSync(abs('patterns', dir)).isDirectory() || !inScope(dir)) continue;
  if (!bySlug.has(dir)) err(`patterns/${dir}`, 'folder is not listed in catalog.json');
  for (const f of ['diagram.svg', 'meta.json', 'README.md']) {
    if (!existsSync(abs('patterns', dir, f))) err(`patterns/${dir}`, `missing ${f}`);
  }
}

// ---- animated patterns -------------------------------------------------------
const LOOP_S = 20;
for (const p of patterns.filter((x) => x.animated && inScope(x.slug))) {
  const where = p.dir;
  const m = p.meta;
  if (p.metaError) {
    err(`${where}/meta.json`, `invalid JSON: ${p.metaError}`);
    continue;
  }

  // meta.json
  if (!Array.isArray(m.steps) || m.steps.length !== STEPS) {
    err(`${where}/meta.json`, `needs exactly ${STEPS} steps`);
    continue;
  }
  m.steps.forEach((s, i) => {
    const w = `${where}/meta.json › steps[${i}]`;
    if (!s.title || !s.caption || !s.body) err(w, 'needs title, caption and body');
    if (s.title?.length > 26) err(w, `title is ${s.title.length} chars (max 26, it sits under a progress segment)`);
    if (s.caption?.length > CAPTION_MAX) err(w, `caption is ${s.caption.length} chars (max ${CAPTION_MAX}, SVG text does not wrap)`);
    if (/[|]/.test(`${s.title}${s.body}`)) err(w, '"|" breaks the Markdown steps table');
  });
  for (const r of m.related ?? []) if (!bySlug.has(r)) err(`${where}/meta.json`, `related "${r}" is not in catalog.json`);
  for (const r of m.references ?? []) {
    if (!r.title || !/^https:\/\//.test(r.url ?? '')) err(`${where}/meta.json`, `reference needs a title and an https url`);
  }

  // diagram.svg
  const svgPath = `${where}/diagram.svg`;
  if (!existsSync(abs(svgPath))) continue;
  const svg = readText(svgPath);
  for (const e of xmlErrors(svg)) err(svgPath, e);
  const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
  const need = {
    xmlns: 'http://www.w3.org/2000/svg',
    class: 'diagram',
    viewBox: `0 0 ${CANVAS.width} ${CANVAS.height}`,
    width: String(CANVAS.width),
    height: String(CANVAS.height),
    'data-stage': CANVAS.stage,
  };
  for (const [k, v] of Object.entries(need)) {
    if (!root.includes(`${k}="${v}"`)) err(svgPath, `root <svg> needs ${k}="${v}"`);
  }
  if (/<script|\son[a-z]+\s*=|<foreignObject|<image\b/i.test(svg)) err(svgPath, 'no scripts, event handlers, foreignObject or images (must render as a plain <img>)');
  // Text content may show code such as url('https://…'); only markup can load anything.
  const markup = svg.replace(/<text\b[\s\S]*?<\/text>/g, '');
  if (/(?:href|src)\s*=\s*"(?:https?:)?\/\//i.test(markup) || /url\(\s*['"]?(?:https?:)?\/\//i.test(markup)) err(svgPath, 'no external references');
  if (!/<g class="stage"/.test(svg)) err(svgPath, 'hand-authored content goes in <g class="stage">');
  const kb = Buffer.byteLength(svg) / 1024;
  if (kb > 90) warn(svgPath, `${kb.toFixed(0)} KB — consider simplifying`);

  // Every animation must stay on the shared 20s timeline: each duration is var(--T) or divides 20s,
  // and each delay is zero or negative. In the shorthand the first time is the duration, the second the delay.
  const TIME = /var\(--T\)|(?<![\w.-])(-?\d*\.?\d+)(m?s)\b/g;
  const secs = (m) => (m[1] === undefined ? LOOP_S : parseFloat(m[1]) / (m[2] === 'ms' ? 1000 : 1));
  for (const a of svg.matchAll(/animation(-duration|-delay)?\s*:\s*([^;}]+)/g)) {
    const kind = a[1] ?? '';
    for (const layer of a[2].split(/,(?![^(]*\))/)) {
      const times = [...layer.matchAll(TIME)].map(secs);
      const durations = kind === '-delay' ? [] : kind === '-duration' ? times : times.slice(0, 1);
      const delays = kind === '-duration' ? [] : kind === '-delay' ? times : times.slice(1, 2);
      for (const s of durations) {
        const ratio = LOOP_S / s;
        if (!(s > 0) || Math.abs(ratio - Math.round(ratio)) > 1e-6) {
          err(svgPath, `animation duration ${s}s does not divide the ${LOOP_S}s loop ("${layer.trim()}")`);
        }
      }
      for (const s of delays) {
        if (s > 0) err(svgPath, `animation delay ${s}s must be zero or negative so the site can scrub the timeline ("${layer.trim()}")`);
      }
    }
  }

  const hasBlocks = hasBlock(svg, 'svg', 'base') && hasBlock(svg, 'svg', 'chrome');
  if (!hasBlocks) err(svgPath, 'missing @generated:base / @generated:chrome blocks (copy them from templates/diagram.svg)');
  else if (syncSvg(svg, p) !== svg) err(svgPath, 'generated blocks are stale — run `npm run sync`');

  // README.md
  const mdPath = `${where}/README.md`;
  if (!existsSync(abs(mdPath))) continue;
  const md = readText(mdPath);
  if (!hasBlock(md, 'md', 'header') || !hasBlock(md, 'md', 'footer')) err(mdPath, 'missing generated header/footer blocks');
  else {
    if (syncPatternReadme(md, p, bySlug) !== md) err(mdPath, 'generated blocks are stale — run `npm run sync`');
    for (const l of readmeBody(md).matchAll(/\]\(\.\.\/([a-z0-9-]+)\/?(?:#[^)]*)?\)/g)) {
      if (!bySlug.get(l[1])?.animated) err(mdPath, `links to ../${l[1]}/, which has no page yet (link only animated patterns)`);
    }
  }
}

// ---- templates -------------------------------------------------------------
if (!only.length) {
  for (const e of xmlErrors(readText('templates/diagram.svg'))) err('templates/diagram.svg', e);
}

// ---- root README -----------------------------------------------------------
if (!only.length) {
  const readme = readText('README.md');
  if (!hasBlock(readme, 'md', 'catalog')) err('README.md', 'missing generated catalog block');
  else if (replaceBlock(readme, 'md', 'catalog', catalogBlock(catalog)) !== readme) err('README.md', 'catalog is stale — run `npm run sync`');
}

// ---- report ----------------------------------------------------------------
for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);
const done = patterns.filter((p) => p.animated).length;
console.log(`check: ${patterns.length} patterns in ${categories.length} categories, ${done} animated — ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
