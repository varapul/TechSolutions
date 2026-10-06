// End-to-end smoke test of the built site (run npm run build first), in your installed Chrome.
// Every pattern page: loads without console errors or failed requests, a #step-2 link plays
// step 2 and holds on it, and links in the prose point at site pages. The index: every card
// and preview image loads, the category menu lists every category.
//   npm run build && npm run test:site
import { readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { abs, loadCatalog } from './lib/core.mjs';

const dist = abs('dist');
const { categories, patterns } = loadCatalog();
const animated = patterns.filter((p) => p.animated && !p.metaError);
const browser = await chromium.launch({ channel: 'chrome' });
const problems = [];
const watch = (page, name) => {
  page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`${name}: ${m.text()}`));
  page.on('requestfailed', (r) => problems.push(`${name}: failed to load ${r.url()}`));
};

const pages = readdirSync(dist).filter((f) => f.endsWith('.html') && f !== 'index.html');
if (pages.length !== animated.length) problems.push(`dist has ${pages.length} pattern pages, catalog has ${animated.length} animated patterns`);
for (const f of pages) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  watch(page, f);
  await page.goto(`file://${dist}/${f}#step-2`);
  await page.waitForTimeout(5700); // step 2 plays for 5 s, then holds 0.4 s before its end
  const s = await page.evaluate(() => {
    const anims = document.querySelector('.stage svg').getAnimations({ subtree: true });
    return {
      anims: anims.length,
      t: anims.length ? Math.round((anims[0].currentTime % 20000) / 100) / 10 : null,
      held: document.querySelector('.player').classList.contains('held'),
      badLinks: [...document.querySelectorAll('.prose a[href]')].map((a) => a.getAttribute('href'))
        .filter((h) => !/^(https?:|#|mailto:)/.test(h) && !/^[a-z0-9-]+\.html(#.*)?$/.test(h)),
    };
  });
  if (!s.anims) problems.push(`${f}: no animations found in the player`);
  if (!s.held || s.t !== 9.6) problems.push(`${f}: #step-2 should hold at 9.6 s, got t=${s.t} held=${s.held}`);
  if (s.badLinks.length) problems.push(`${f}: prose links that won't resolve on the site: ${s.badLinks.join(', ')}`);
  await page.close();
}

async function checkIndex(name) {
  const index = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  watch(index, name);
  await index.goto(`file://${dist}/${name}`);
  // Scroll the whole page so every lazy preview loads (the index grows with the catalog).
  for (let y = 0; y < (await index.evaluate(() => document.documentElement.scrollHeight)); y += 800) {
    await index.evaluate((v) => window.scrollTo(0, v), y);
    await index.waitForTimeout(40);
  }
  await index.waitForTimeout(500);
  const ix = await index.evaluate(() => ({
    cards: document.querySelectorAll('.card').length,
    images: document.images.length,
    loaded: [...document.images].filter((i) => i.complete && i.naturalWidth > 0).length,
    menu: document.querySelectorAll('.side-toc a').length,
  }));
  if (ix.cards !== animated.length) problems.push(`${name}: ${ix.cards} cards, expected ${animated.length}`);
  if (ix.loaded !== ix.images) problems.push(`${name}: ${ix.images - ix.loaded} preview image(s) failed to load`);
  if (ix.menu !== categories.length) problems.push(`${name}: category menu has ${ix.menu} entries, expected ${categories.length}`);
  await index.close();
}
await checkIndex('index.html');

// Thai pages: same structure, so a lighter pass: each loads cleanly, plays, links resolve, and switches back to English.
const thPages = readdirSync(`${dist}/th`).filter((f) => f.endsWith('.html') && f !== 'index.html');
if (thPages.length !== pages.length) problems.push(`dist/th has ${thPages.length} pattern pages, expected ${pages.length}`);
for (const f of thPages) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  watch(page, `th/${f}`);
  await page.goto(`file://${dist}/th/${f}`);
  await page.waitForTimeout(300);
  const s = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    anims: document.querySelector('.stage svg')?.getAnimations({ subtree: true }).length ?? 0,
    status: document.querySelector('.status')?.textContent ?? '',
    back: document.querySelector('.lang-switch')?.getAttribute('href'),
    badLinks: [...document.querySelectorAll('.prose a[href], .detail a[href]')].map((a) => a.getAttribute('href'))
      .filter((h) => !/^(https?:|#|mailto:)/.test(h) && !/^[a-z0-9-]+\.html(#.*)?$/.test(h)),
  }));
  if (s.lang !== 'th') problems.push(`th/${f}: html lang is ${s.lang}`);
  if (!s.anims) problems.push(`th/${f}: no animations found in the player`);
  if (!/ขั้นที่/.test(s.status)) problems.push(`th/${f}: player status is not in Thai (${s.status})`);
  if (s.back !== `../${f}`) problems.push(`th/${f}: language switch points to ${s.back}`);
  if (s.badLinks.length) problems.push(`th/${f}: links that won't resolve on the site: ${s.badLinks.join(', ')}`);
  await page.close();
}
await checkIndex('th/index.html');
await browser.close();

for (const p of problems) console.error(`error ${p}`);
console.log(`site: ${pages.length} pattern pages + index, and ${thPages.length} Thai pages + index checked — ${problems.length} problem(s)`);
process.exit(problems.length ? 1 : 0);
