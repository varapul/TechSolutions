// Regenerates every generated block in committed files:
//   patterns/<slug>/diagram.svg  → base CSS, arrow markers, chrome (title, steps, captions)
//   patterns/<slug>/README.md    → header (title, diagram, steps table) and footer (related, references)
//   README.md                    → the categorized catalog (table of contents)
import { existsSync, writeFileSync } from 'node:fs';
import { abs, catalogBlock, loadCatalog, readText, replaceBlock, syncPatternReadme, syncSvg } from './lib/core.mjs';

//   npm run sync                 everything
//   node scripts/sync.mjs <slug>  just that pattern's diagram and README (leaves README.md alone)
const only = process.argv.slice(2);
const catalog = loadCatalog();
let changed = 0;

function update(path, render) {
  if (!existsSync(abs(path))) {
    console.warn(`  skipped ${path} (missing)`);
    return;
  }
  const prev = readText(path);
  const next = render(prev);
  if (prev === next) return;
  writeFileSync(abs(path), next);
  changed++;
  console.log(`  updated ${path}`);
}

for (const p of catalog.patterns.filter((x) => x.animated && (!only.length || only.includes(x.slug)))) {
  if (p.metaError) {
    console.warn(`  skipped ${p.dir} (meta.json: ${p.metaError})`);
    continue;
  }
  update(`${p.dir}/diagram.svg`, (svg) => syncSvg(svg, p));
  update(`${p.dir}/README.md`, (md) => syncPatternReadme(md, p, catalog.bySlug));
}
if (!only.length) update('README.md', (md) => replaceBlock(md, 'md', 'catalog', catalogBlock(catalog)));

console.log(changed ? `sync: ${changed} file(s) updated` : 'sync: everything up to date');
