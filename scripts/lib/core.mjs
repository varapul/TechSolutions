// Shared helpers for sync / check / build / new.
// Everything that is *generated* into committed files (SVG chrome, README blocks)
// is produced here, so `check` can recompute it and fail when files are stale.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const STEPS = 4;
export const CANVAS = { width: 960, height: 576, stage: '0 80 960 400' };
export const CAPTION_MAX = 100; // characters; SVG text does not wrap

export const abs = (...p) => join(ROOT, ...p);
export const readText = (p) => readFileSync(abs(p), 'utf8').replace(/\r\n/g, '\n'); // tolerate CRLF checkouts
export const readJSON = (p) => JSON.parse(readText(p));

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Same algorithm GitHub uses for heading anchors (github-slugger).
export const ghSlug = (s) => s.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');

// ---------------------------------------------------------------------------
// Catalog

// Categories whose pages teach a real product (System Components, AWS Services) rather than a pattern.
export const COMPONENT_CATEGORIES = new Set(['system-components', 'aws-services']);

export function loadCatalog() {
  const { categories } = readJSON('catalog.json');
  const patterns = [];
  for (const category of categories) {
    category.items = category.patterns.map((item) => {
      const dir = `patterns/${item.slug}`;
      const animated = existsSync(abs(dir, 'meta.json'));
      const p = { ...item, category, dir, animated };
      if (animated) {
        try {
          p.meta = readJSON(`${dir}/meta.json`);
        } catch (e) {
          p.metaError = e.message; // reported by `check`; skipped by sync/build
        }
      }
      patterns.push(p);
      return p;
    });
  }
  const bySlug = new Map(patterns.map((p) => [p.slug, p]));
  // Each pattern links back to the component pages whose related list names it.
  const isComponent = (p) => COMPONENT_CATEGORIES.has(p.category.id);
  for (const p of patterns) if (!isComponent(p)) p.components = [];
  for (const c of patterns.filter((p) => isComponent(p) && p.meta)) {
    for (const slug of c.meta.related ?? []) {
      const p = bySlug.get(slug);
      if (p?.components && !p.meta?.related?.includes(c.slug)) p.components.push(c.slug);
    }
  }
  return { categories, patterns, bySlug };
}

// ---------------------------------------------------------------------------
// Generated blocks inside committed files

const BLOCK = {
  svg: (name) => [`<!-- @generated:${name} (npm run sync; do not edit by hand) -->`, `<!-- @end:${name} -->`],
  md: (name) => [`<!-- BEGIN GENERATED: ${name} (npm run sync; do not edit by hand) -->`, `<!-- END GENERATED: ${name} -->`],
};

function blockRegex(open, close) {
  const o = open.replace(/\s*\(.*$/, ''); // match on the stable prefix, e.g. "<!-- @generated:base"
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escRe(o)}[^\\n]*\\n[\\s\\S]*?${escRe(close)}`);
}

export function hasBlock(text, kind, name) {
  const [open, close] = BLOCK[kind](name);
  return blockRegex(open, close).test(text);
}

export function replaceBlock(text, kind, name, body) {
  const [open, close] = BLOCK[kind](name);
  const re = blockRegex(open, close);
  if (!re.test(text)) throw new Error(`missing generated block "${name}"`);
  return text.replace(re, () => `${open}\n${body}\n${close}`);
}

export const wrapBlock = (kind, name, body) => {
  const [open, close] = BLOCK[kind](name);
  return `${open}\n${body}\n${close}`;
};

export function stripBlock(text, kind, name) {
  const [open, close] = BLOCK[kind](name);
  return text.replace(blockRegex(open, close), '');
}

// ---------------------------------------------------------------------------
// Diagram base CSS: hand-written tokens/primitives + generated phase keyframes

const pct = (n) => `${+n.toFixed(3)}%`;
const FADE = 1.5; // % of the loop spent fading a phase in or out (0.3s at 20s)

// .p1 … .p234: visible only during the listed steps (every non-empty, non-full subset).
// Consecutive steps stay visible across the boundary; step 4 → step 1 wraps seamlessly.
export function phaseCss() {
  const out = [];
  const size = 100 / STEPS;
  for (let mask = 1; mask < (1 << STEPS) - 1; mask++) {
    const on = (k) => Boolean(mask & (1 << (((k - 1 + STEPS) % STEPS))));
    const name = 'p' + [1, 2, 3, 4].filter(on).join('');
    const pts = new Map();
    for (let k = 1; k <= STEPS; k++) {
      const a = (k - 1) * size;
      const b = k * size;
      if (!on(k)) { pts.set(a, 0); pts.set(b, 0); continue; }
      if (on(k - 1)) pts.set(a, 1); else { pts.set(a, 0); pts.set(a + FADE, 1); }
      if (on(k + 1)) pts.set(b, 1); else { pts.set(b - FADE, 1); pts.set(b, 0); }
    }
    const frames = [...pts.entries()].sort((x, y) => x[0] - y[0]).map(([p, o]) => `${pct(p)}{opacity:${o}}`).join('');
    const rest = on(1) ? 1 : 0; // static renders (no animation support) show step 1
    out.push(`.diagram .${name}{opacity:${rest};animation:${name} var(--T) linear infinite}`);
    out.push(`@keyframes ${name}{${frames}}`);
  }
  for (let k = 1; k <= STEPS; k++) {
    const a = (k - 1) * size;
    const b = k * size;
    const start = a === 0 ? '0%' : `0%,${pct(a)}`;
    out.push(`.diagram .bar${k}{transform:scaleX(${k === 1 ? 1 : 0});animation:bar${k} var(--T) linear infinite}`);
    out.push(`@keyframes bar${k}{${start}{transform:scaleX(0)}${pct(b)},100%{transform:scaleX(1)}}`);
  }
  return out.join('\n');
}

export function compactCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,>])\s*/g, '$1')
    .replace(/([{;])\s*([\w-]+)\s*:\s*/g, '$1$2:')
    .replace(/;}/g, '}')
    .replace(/}/g, '}\n')
    .trim();
}

export function baseCss() {
  return `${compactCss(readText('src/diagram/base.css'))}\n${phaseCss()}`;
}

const MARKER_COLORS = ['wire', 'ink', 'muted', 'blue', 'green', 'red', 'amber', 'purple', 'teal', 'orange'];

function markers() {
  return MARKER_COLORS.map((c) => {
    const id = c === 'wire' ? 'ah' : `ah-${c}`;
    return `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path class="f-${c}" d="M0 0L10 5L0 10z"/></marker>`;
  }).join('\n');
}

export function describe(p) {
  const steps = p.meta.steps.map((s, i) => `Step ${i + 1}, ${s.title}: ${s.caption}`).join(' ');
  return `${p.title}. ${p.summary} ${steps}`;
}

// Title/desc, base CSS and arrow markers.
export function svgBaseBlock(p) {
  return [
    `<title id="dg-title">${esc(p.title)}</title>`,
    `<desc id="dg-desc">${esc(describe(p))}</desc>`,
    `<style>`,
    baseCss(),
    `</style>`,
    `<defs>`,
    markers(),
    `</defs>`,
  ].join('\n');
}

// Background + README-only chrome (eyebrow, title, progress, step labels, captions).
// The site strips this block and renders the same information in HTML.
export function svgChromeBlock(p) {
  const gap = 8;
  const segW = (880 - gap * (STEPS - 1)) / STEPS;
  const all = [1, 2, 3, 4];
  const lines = [
    `<rect class="bg" width="${CANVAS.width}" height="${CANVAS.height}"/>`,
    `<g class="meta">`,
    `  <text class="eyebrow" x="40" y="34">${esc(p.category.title.toUpperCase())}</text>`,
    `  <text class="title" x="40" y="64">${esc(p.title)}</text>`,
  ];
  p.meta.steps.forEach((s, i) => {
    const n = i + 1;
    const x = 40 + i * (segW + gap);
    const others = all.filter((k) => k !== n).join('');
    const label = `${n} · ${esc(s.title)}`;
    lines.push(
      `  <rect class="track" x="${x}" y="494" width="${segW}" height="4" rx="2"/>`,
      `  <rect class="bar bar${n}" x="${x}" y="494" width="${segW}" height="4" rx="2"/>`,
      `  <text class="step p${others}" x="${x}" y="518">${label}</text>`,
      `  <text class="step on p${n}" x="${x}" y="518">${label}</text>`,
    );
  });
  p.meta.steps.forEach((s, i) => lines.push(`  <text class="caption p${i + 1}" x="40" y="552">${esc(s.caption)}</text>`));
  lines.push(`</g>`);
  return lines.join('\n');
}

export function syncSvg(svg, p) {
  return replaceBlock(replaceBlock(svg, 'svg', 'base', svgBaseBlock(p)), 'svg', 'chrome', svgChromeBlock(p));
}

// ---------------------------------------------------------------------------
// README blocks

const catAnchor = (c) => ghSlug(c.title);

function relatedLine(slug, bySlug, prefix) {
  const r = bySlug.get(slug);
  if (!r) return `- ${slug}`;
  return r.animated
    ? `- [${r.title}](${prefix}${r.slug}/) — ${r.summary}`
    : `- ${r.title} *(planned)* — ${r.summary}`;
}

export function patternHeader(p) {
  const rows = p.meta.steps.map((s, i) => `| **${i + 1} · ${s.title}** | ${s.body} |`).join('\n');
  const site = readJSON('package.json').homepage;
  return [
    `[Catalog](../../README.md#contents) › [${p.category.icon} ${p.category.title}](../../README.md#${catAnchor(p.category)})`,
    ``,
    `# ${p.title}`,
    ``,
    `> ${p.summary}`,
    ``,
    `<p align="center"><img src="diagram.svg" alt="Animated diagram: ${esc(p.title)}" width="100%"></p>`,
    ...(site ? [`<p align="center"><a href="${site}${p.slug}.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>`] : []),
    ``,
    `| Step | What happens |`,
    `|---|---|`,
    rows,
  ].join('\n');
}

export function patternFooter(p, bySlug) {
  const out = [];
  if (p.meta.related?.length) {
    out.push(`## Related patterns`, ``, ...p.meta.related.map((s) => relatedLine(s, bySlug, '../')), ``);
  }
  if (p.components?.length) {
    out.push(`## Related components and services`, ``, ...p.components.map((s) => relatedLine(s, bySlug, '../')), ``);
  }
  if (p.meta.references?.length) {
    out.push(`## References`, ``, ...p.meta.references.map((r) => `- [${r.title}](${r.url})`), ``);
  }
  out.push(`---`, ``, `[← Back to the catalog](../../README.md#contents)`);
  return out.join('\n');
}

export function syncPatternReadme(md, p, bySlug) {
  return replaceBlock(replaceBlock(md, 'md', 'header', patternHeader(p)), 'md', 'footer', patternFooter(p, bySlug));
}

// Hand-written part of a pattern README (between the generated header and footer).
export function readmeBody(md) {
  return stripBlock(stripBlock(md, 'md', 'header'), 'md', 'footer').trim();
}

export function catalogBlock({ categories, patterns }) {
  const total = patterns.length;
  const done = patterns.filter((p) => p.animated).length;
  const out = [
    `## Contents`,
    ``,
    `**${done} animated** · ${total - done} planned · ${categories.length} categories`,
    ``,
    `| | Category | Animated | What's inside |`,
    `|:-:|---|:-:|---|`,
  ];
  for (const c of categories) {
    const n = c.items.filter((p) => p.animated).length;
    out.push(`| ${c.icon} | [${c.title}](#${catAnchor(c)}) | ${n} / ${c.items.length} | ${c.blurb} |`);
  }
  for (const c of categories) {
    out.push(``, `## ${c.title}`, ``, `${c.icon} ${c.blurb}`, ``, `| Pattern | In one line | Status |`, `|---|---|:-:|`);
    for (const p of c.items) {
      const name = p.animated ? `[**${p.title}**](patterns/${p.slug}/)` : p.title;
      out.push(`| ${name} | ${p.summary} | ${p.animated ? '✅ animated' : '⏳ planned'} |`);
    }
    out.push(``, `<sub>[↑ Back to contents](#contents)</sub>`);
  }
  return out.join('\n');
}
