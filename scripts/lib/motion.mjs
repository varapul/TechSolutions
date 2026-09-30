// Optional authoring helpers: turn a timeline into @keyframes you paste into a diagram's <style>.
// Times are percentages of the 20s loop (1s = 5%; steps start at 0, 25, 50 and 75%).
//
//   import { track, windows, keys } from './scripts/lib/motion.mjs';
//   console.log(track('cb-req', [[1.5, 6.5, [222, 180], [738, 180]]]));  // a dot travels A -> B
//   console.log(windows('cb-open', [[47, 75]]));                          // visible from 47% to 75%
//
// The SVG stays the source of truth; these only save you from hand-computing keyframes.
const r = (n) => +(+n).toFixed(3);
const P = (n) => `${r(n)}%`;

function emit(name, pts) {
  const rows = [...pts.entries()].sort((a, b) => a[0] - b[0]).map(([p, decl]) => `  ${P(p)} { ${decl} }`);
  return `@keyframes ${name} {\n${rows.join('\n')}\n}`;
}

function add(pts, p, decl) {
  p = r(Math.min(100, Math.max(0, p)));
  pts.set(p, pts.has(p) ? `${pts.get(p)} ${decl}` : decl);
}

// Opacity windows: visible on [a, b], fading in over [a, a+fade] and out over [b, b+fadeOut].
// A window starting at 0 or ending at 100 is joined seamlessly across the loop boundary.
export function windows(name, wins, fade = 0.5, fadeOut = fade) {
  const pts = new Map();
  for (const [a, b] of wins) {
    if (a <= 0) add(pts, 0, 'opacity: 1;');
    else { add(pts, a, 'opacity: 0;'); add(pts, a + fade, 'opacity: 1;'); }
    if (b >= 100) add(pts, 100, 'opacity: 1;');
    else { add(pts, b, 'opacity: 1;'); add(pts, b + fadeOut, 'opacity: 0;'); }
  }
  if (!pts.has(0)) add(pts, 0, 'opacity: 0;');
  if (!pts.has(100)) add(pts, 100, 'opacity: 0;');
  return emit(name, pts);
}

// A moving token. Draw it at (0,0) and give it these keyframes: each segment is
// [start%, end%, [x0, y0], [x1, y1]] in absolute user units. Consecutive segments that
// touch (same time, same point) are joined without fading, so multi-leg paths and
// "hold" segments (from === to) work. Outside its segments the token is invisible.
export function track(name, segs, fade = 0.25) {
  const pts = new Map();
  const tr = ([x, y]) => `transform: translate(${r(x)}px, ${r(y)}px);`;
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  segs.forEach(([s, e, from, to], i) => {
    const prev = segs[i - 1];
    const next = segs[i + 1];
    const joinPrev = prev && r(prev[1]) === r(s) && same(prev[3], from);
    const joinNext = next && r(next[0]) === r(e) && same(next[2], to);
    if (!joinPrev) { add(pts, s, `${tr(from)} opacity: 0;`); add(pts, s + fade, 'opacity: 1;'); }
    add(pts, e, `${tr(to)}${joinNext ? '' : ' opacity: 1;'}`);
    if (!joinNext) add(pts, e + fade, `${tr(to)} opacity: 0;`); // hold position while fading out
  });
  const first = segs[0];
  const last = segs[segs.length - 1];
  if (!pts.has(0)) add(pts, 0, `${tr(first[2])} opacity: 0;`);
  if (!pts.has(100)) add(pts, 100, `${tr(last[3])} opacity: 0;`);
  return emit(name, pts);
}

// Seconds on the 20s loop → keyframe percent (steps start at 0, 5, 10 and 15 s).
export const sec = (s) => r(s * 5);

// Constant-speed segments for track() along a polyline: route([[x,y], ...], startPct, pxPerSec).
// Returns { segs, end } so trips can be chained: route(b, route(a, 10, 400).end + 1, 400).
export function route(points, start, pxPerSec = 400) {
  const segs = [];
  let t = start;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const d = Math.hypot(x1 - x0, y1 - y0) / pxPerSec * 5; // seconds → percent
    segs.push([r(t), r(t + d), points[i - 1], points[i]]);
    t += d;
  }
  return { segs, end: r(t) };
}

// Anything else: [[pct, 'decl;'], ...], e.g. a rotation or a scaleX countdown.
export function keys(name, list) {
  const pts = new Map();
  for (const [p, d] of list) add(pts, p, d);
  return emit(name, pts);
}

// The `.diagram .name { animation: ... }` rules for a set of keyframes.
export function rules(names, { hidden = true } = {}) {
  return names.map((n) => `.diagram .${n} { ${hidden ? 'opacity: 0; ' : ''}animation: ${n} var(--T) linear infinite; }`).join('\n');
}
