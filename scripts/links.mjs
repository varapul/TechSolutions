// Checks that every reference URL still loads: meta.json references and links in README prose.
// Needs network access, so it is not part of CI (external sites rate-limit and block bots).
//   npm run links               all animated patterns
//   npm run links -- cqrs saga-orchestration
import { loadCatalog, readText, readmeBody } from './lib/core.mjs';

const only = process.argv.slice(2);
const urls = new Map(); // url -> patterns that cite it
for (const p of loadCatalog().patterns.filter((x) => x.animated && !x.metaError && (!only.length || only.includes(x.slug)))) {
  const add = (u) => urls.set(u, [...(urls.get(u) ?? []), p.slug]);
  for (const r of p.meta.references ?? []) add(r.url);
  for (const m of readmeBody(readText(`${p.dir}/README.md`)).matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) add(m[1]);
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36';
const pause = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));
async function get(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,*/*' }, signal: AbortSignal.timeout(20000) });
  await res.body?.cancel();
  return res;
}
// github.com throttles page fetches for minutes at a time; the raw host serves the same file.
function rawFile(url) {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^?#]+)/.exec(url);
  return m && `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
}
// A 429 or 503 is a rate limit or a passing outage, not a broken link: wait and ask again
// before reporting it. A timeout or reset gets one more try.
const RETRIES = 3;
async function status(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await get(url);
      const throttled = res.status === 429 || res.status === 503;
      if (throttled && rawFile(url) && (await get(rawFile(url))).ok) return { code: 200, final: url };
      if (throttled && attempt < RETRIES) {
        await pause(Math.min(Number(res.headers.get('retry-after')) || 15 * (attempt + 1), 60));
        continue;
      }
      return { code: res.status, final: res.url };
    } catch (e) {
      if (attempt < 1) {
        await pause(5);
        continue;
      }
      return { code: 0, final: e.cause?.code ?? e.name };
    }
  }
}

// One request at a time per host, eight hosts at once.
const byHost = new Map();
for (const u of urls.keys()) {
  const host = new URL(u).host;
  byHost.set(host, [...(byHost.get(host) ?? []), u]);
}
const queue = [...byHost.values()];
const results = [];
async function worker() {
  for (let group; (group = queue.pop()); ) {
    for (const u of group) {
      results.push({ url: u, ...(await status(u)) });
      await pause(0.25);
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
// Some publishers answer automated requests with 403 (e.g. dl.acm.org); check those by hand.
const BOT_BLOCKERS = /^https:\/\/(dl\.acm\.org|www\.oreilly\.com)\//;
let failed = 0;
for (const r of results) {
  if (r.code >= 200 && r.code < 300) continue;
  const soft = r.code === 403 && BOT_BLOCKERS.test(r.url);
  if (!soft) failed++;
  console.log(`${soft ? 'warn ' : 'error'} ${r.code || 'ERR'} ${r.url}  [${urls.get(r.url).join(', ')}]${r.final && r.final !== r.url ? `  → ${r.final}` : ''}`);
}
console.log(`links: ${results.length} URLs checked, ${failed} failing`);
process.exit(failed ? 1 : 0);
