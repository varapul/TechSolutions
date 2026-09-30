// Renders a contact sheet of a diagram frozen at several points of its loop, so a
// change can be reviewed without watching the animation. Uses your installed Chrome.
//   npm run snap -- circuit-breaker                 # 12 frames: 3 per step, light theme
//   npm run snap -- circuit-breaker --dark          # dark theme
//   npm run snap -- circuit-breaker --times=7.5 --cols=1   # one frame, full size
//   npm run snap -- circuit-breaker --static        # the no-animation fallback (should look like step 1)
//   npm run snap -- --all
// Output: .snapshots/<slug>[-dark][-static|-t…].png
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { abs, loadCatalog, readText } from './lib/core.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}`))?.split('=')[1] ?? (args.includes(`--${name}`) ? true : undefined);
const dark = Boolean(flag('dark'));
const still = Boolean(flag('static'));
const cols = Number(flag('cols') ?? (still ? 1 : 3));
const times = still ? [0] : flag('times') ? String(flag('times')).split(',').map(Number) : [0, 5, 10, 15].flatMap((s) => [s + 1, s + 2.5, s + 4]);
const { patterns } = loadCatalog();
const slugs = flag('all') ? patterns.filter((p) => p.animated).map((p) => p.slug) : args.filter((a) => !a.startsWith('--'));
if (!slugs.length) {
  console.error('usage: npm run snap -- <slug...> [--dark] [--times=1,2.5] [--cols=3] | --all');
  process.exit(1);
}

mkdirSync(abs('.snapshots'), { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: cols === 1 ? 1000 : 1640, height: 800 } });
await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light', reducedMotion: 'no-preference' });
const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
page.on('pageerror', (e) => problems.push(e.message));

for (const slug of slugs) {
  const svg = readText(`patterns/${slug}/diagram.svg`);
  const figures = times
    .map((t) => `<figure data-t="${t}">${svg}<figcaption>${still ? 'static (no animation)' : `t = ${t}s · step ${Math.min(4, Math.floor(t / 5) + 1)}`}</figcaption></figure>`)
    .join('');
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:12px;display:grid;grid-template-columns:repeat(${cols},1fr);gap:12px;background:${dark ? '#010409' : '#d8dee4'};font:13px system-ui}
    figure{margin:0}figcaption{padding:4px 2px 0;color:${dark ? '#9198a1' : '#59636e'}}
    svg{display:block;width:100%;height:auto;border-radius:6px}
    ${still ? '.diagram, .diagram *{animation:none!important}' : ''}
  </style>${figures}`);
  const count = await page.evaluate(() => {
    let n = 0;
    for (const fig of document.querySelectorAll('figure')) {
      const t = Number(fig.dataset.t) * 1000;
      for (const a of fig.querySelector('svg').getAnimations({ subtree: true })) {
        a.pause();
        a.currentTime = t;
        n++;
      }
    }
    return n / document.querySelectorAll('figure').length;
  });
  const suffix = still ? '-static' : flag('times') ? `-t${String(flag('times')).replace(/,/g, '_')}` : '';
  const out = `.snapshots/${slug}${dark ? '-dark' : ''}${suffix}.png`;
  await page.screenshot({ path: abs(out), fullPage: true });
  console.log(`${out}  (${count} animations per frame)`);
}
await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
