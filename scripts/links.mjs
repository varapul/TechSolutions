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
async function status(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,*/*' }, signal: AbortSignal.timeout(20000) });
    await res.body?.cancel();
    return { code: res.status, final: res.url };
  } catch (e) {
    return { code: 0, final: e.cause?.code ?? e.name };
  }
}

const list = [...urls.keys()];
const results = [];
for (let i = 0; i < list.length; i += 8) {
  results.push(...await Promise.all(list.slice(i, i + 8).map(async (u) => ({ url: u, ...(await status(u)) }))));
}
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
