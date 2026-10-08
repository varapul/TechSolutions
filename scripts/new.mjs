// Scaffolds patterns/<slug>/ from templates/ for a pattern that is planned in catalog.json.
//   npm run new -- retry-with-backoff
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { abs, loadCatalog } from './lib/core.mjs';

const slug = process.argv[2];
const { bySlug } = loadCatalog();
if (!slug) {
  console.error('usage: npm run new -- <slug>   (the slug must already be listed in catalog.json)');
  process.exit(1);
}
if (!bySlug.has(slug)) {
  console.error(`"${slug}" is not in catalog.json — add it to a category first.`);
  process.exit(1);
}
if (existsSync(abs('patterns', slug))) {
  console.error(`patterns/${slug} already exists.`);
  process.exit(1);
}
mkdirSync(abs('patterns', slug), { recursive: true });
// Algorithm patterns get a README with Code and Complexity sections; design patterns get a Code section.
const READMES = { algorithms: 'README.algorithm.md', 'design-patterns': 'README.design-pattern.md', 'system-components': 'README.component.md', 'aws-services': 'README.component.md', 'devops-sre': 'README.principle.md', 'platform-engineering': 'README.principle.md', 'database-internals': 'README.database.md' };
const readme = READMES[bySlug.get(slug).category.id] ?? 'README.md';
for (const f of ['diagram.svg', 'meta.json', 'README.md']) copyFileSync(abs('templates', f === 'README.md' ? readme : f), abs('patterns', slug, f));
console.log(`created patterns/${slug}/ — fill in meta.json, draw the stage in diagram.svg, write README.md, then:
  npm run sync          # injects chrome + README blocks, updates the catalog
  npm run snap -- ${slug}   # renders a contact sheet of every step to .snapshots/`);
