// End-to-end smoke test of the built site (run npm run build first), in your installed Chrome.
// Every pattern page: loads without console errors or failed requests, a #step-2 link plays
// step 2 and holds on it, and links in the prose point at site pages. The index: every card
// and preview image loads, the category menu lists every category.
//   npm run build && npm run test:site          (SITE_TEST_PROGRESS=1 prints each page as it goes)
import { readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { abs, loadCatalog } from './lib/core.mjs';

const dist = abs('dist');
const { categories, patterns } = loadCatalog();
const animated = patterns.filter((p) => p.animated && !p.metaError);
const progress = process.env.SITE_TEST_PROGRESS ? (msg) => console.error(msg) : () => {};
const browser = await chromium.launch({ channel: 'chrome' });
// A browser that dies mid-run (for example while Chrome updates itself), or an error that leaves
// Chrome running, would otherwise keep the script (and whatever waits for it) hanging.
let finished = false;
browser.on('disconnected', () => {
  if (finished) return;
  console.error('site: the browser closed unexpectedly; run the test again');
  process.exit(2);
});
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, async (e) => {
    console.error(e);
    finished = true;
    await browser.close().catch(() => {});
    process.exit(1);
  });
}
const problems = [];
const watch = (page, name) => {
  page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`${name}: ${m.text()}`));
  page.on('requestfailed', (r) => problems.push(`${name}: failed to load ${r.url()}`));
  page.on('crash', () => problems.push(`${name}: the page crashed`));
};

// Each page gets its own tab and a time limit, so one page that never settles is reported, not waited on forever.
async function inPage(name, url, check, limitMs = 60000) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  watch(page, name);
  let timer;
  try {
    await Promise.race([
      (async () => { await page.goto(url); await check(page); })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no result after ${limitMs / 1000} s`)), limitMs); }),
    ]);
  } catch (e) {
    problems.push(`${name}: ${e.message.split('\n')[0]}`);
  } finally {
    clearTimeout(timer);
    await page.close().catch(() => {});
  }
}

const pages = readdirSync(dist).filter((f) => f.endsWith('.html') && f !== 'index.html');
if (pages.length !== animated.length) problems.push(`dist has ${pages.length} pattern pages, catalog has ${animated.length} animated patterns`);
for (const [i, f] of pages.entries()) {
  progress(`${i + 1}/${pages.length} ${f}`);
  await inPage(f, `file://${dist}/${f}#step-2`, async (page) => {
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
  });
}

async function checkIndex(name) {
  progress(name);
  await inPage(name, `file://${dist}/${name}`, async (index) => {
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
  }, 180000);
}
await checkIndex('index.html');

// Thai pages: same structure, so a lighter pass: each loads cleanly, plays, links resolve, and switches back to English.
const thPages = readdirSync(`${dist}/th`).filter((f) => f.endsWith('.html') && f !== 'index.html');
if (thPages.length !== pages.length) problems.push(`dist/th has ${thPages.length} pattern pages, expected ${pages.length}`);
for (const [i, f] of thPages.entries()) {
  progress(`th ${i + 1}/${thPages.length} ${f}`);
  await inPage(`th/${f}`, `file://${dist}/th/${f}`, async (page) => {
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
  });
}
await checkIndex('th/index.html');
finished = true;
await browser.close();

for (const p of problems) console.error(`error ${p}`);
console.log(`site: ${pages.length} pattern pages + index, and ${thPages.length} Thai pages + index checked — ${problems.length} problem(s)`);
process.exit(problems.length ? 1 : 0);
