export const meta = {
  name: 'author-batch',
  description: 'Author a batch of animated pattern diagrams in parallel, then fact-check and fix them in small review groups',
  whenToUse: 'Animating the next batch of planned patterns in the architecture diagram catalog',
  phases: [
    { title: 'Author', detail: 'one agent per pattern draws, writes and self-verifies it' },
    { title: 'Review', detail: 'one independent fact-checker per group fixes what it confirms' },
  ],
}

const REPO = args.repo
const TODAY = args.today
const SCRATCH = args.scratch

const AUTHORED = {
  type: 'object',
  properties: {
    slug: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' }, description: 'one line per step: what it shows' },
    checkPassed: { type: 'boolean' },
    compromises: { type: 'string' },
  },
  required: ['slug', 'steps', 'checkPassed'],
}

const REVIEWED = {
  type: 'object',
  properties: {
    patterns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          slug: { type: 'string' },
          fixes: { type: 'array', items: { type: 'string' }, description: 'each confirmed problem and how it was fixed, with the source checked' },
          rejected: { type: 'array', items: { type: 'string' }, description: 'suspicions checked and found fine' },
          svgChanged: { type: 'boolean' },
          checkPassed: { type: 'boolean' },
        },
        required: ['slug', 'fixes', 'checkPassed'],
      },
    },
  },
  required: ['patterns'],
}

function authorPrompt(p) {
  return `You are authoring ONE animated architecture diagram in ${REPO} (today is ${TODAY}): a public catalog of self-explaining, looping SVG diagrams for solutions architects (https://github.com/varapul/TechSolutions). Ten finished diagrams set the quality bar; match them.

Read first: CONTRIBUTING.md (canvas, 20 s / 4-step timeline, phase classes, motion, hold frames, colour language, writing rules); patterns/circuit-breaker/ and patterns/event-driven-architecture/ (diagram.svg, meta.json, README.md) as reference implementations (in each SVG skip the generated block between "<!-- @generated:base" and "<!-- @end:chrome -->"); scripts/lib/motion.mjs (track, windows, keys, route, sec, rules); src/diagram/base.css (classes and colour tokens).

YOUR PATTERN: slug \`${p.slug}\`, title "${p.title}", category ${p.category}. Catalog summary: "${p.summary}"

DESIGN BRIEF:
${p.brief}

PROCESS
- cd ${REPO} && npm run new -- ${p.slug}   (the slug is already in catalog.json)
- Write your keyframe generator in ${SCRATCH}/${p.slug}/ (import ${REPO}/scripts/lib/motion.mjs by absolute path) and paste its output into the diagram's <style>. Keep scratch files out of the repo.
- Only create or modify files inside patterns/${p.slug}/. Other agents work in the same repo in parallel: do not edit anything else, and do not run npm run build or a full npm run sync / npm run check. If a shared file needs a change, say so in compromises.
- After edits: node scripts/sync.mjs ${p.slug} && node scripts/check.mjs ${p.slug} (0 errors required).
- Verify visually with npm run snap -- ${p.slug}, then with --dark and --static. View each with the Read tool, and inspect single frames with --times=<s> --cols=1. Iterate until nothing overlaps or is clipped, every caption matches its step, motion is readable, the static render reads as step 1, the loop restarts cleanly, and each step's story is finished 0.4 s before the step ends (0.6 s before the loop ends), which is where the site player holds.

CONTENT RULES (the last batch's review found about two real errors per pattern; avoid them)
- Verify every technical claim against primary sources on the web, current as of today (ToolSearch "select:WebFetch,WebSearch", or curl): standards and RFCs, official vendor documentation, original papers or articles. Watch for drafts that have become RFCs, renamed or retired products, changed defaults, and deprecated APIs.
- Check every reference URL with curl -sIL and confirm the title matches the page. Cite only URLs you have loaded.
- In README prose, link other patterns as ../<slug>/ only when that pattern is already animated (patterns/<slug>/ exists); otherwise name it without a link. meta.json "related" may list planned slugs from catalog.json.
- Keep captions, step bodies, README and diagram labels consistent with each other and with what the animation shows.

Return slug, one line per step, whether the check passed, and any compromises.`
}

function reviewPrompt(group) {
  const list = group.map((p) => `- ${p.slug} ("${p.title}", ${p.category})`).join('\n')
  return `You are the independent fact-checker for newly authored patterns in ${REPO} (today is ${TODAY}), a public catalog of animated SVG architecture diagrams. Their authors have finished. Review exactly these patterns, and fix what you confirm:
${list}

For each pattern, read patterns/<slug>/meta.json, README.md and diagram.svg (hand-authored part after "<!-- @end:chrome -->"), plus the contact sheets .snapshots/<slug>.png and -dark.png (re-render with npm run snap -- <slug> if they look stale). Check:
1. Every technical claim against primary sources on the web, current as of today (ToolSearch "select:WebFetch,WebSearch", or curl). Proportionate effort: one or two authoritative sources per claim you doubt.
2. Every reference: curl -sIL, the page matches its title, and the title is current.
3. Consistency between the catalog summary (catalog.json), captions, step bodies, README and the diagram's labels and visuals. List labels with: grep -o '<text[^>]*>[^<]*' patterns/<slug>/diagram.svg | sed 's/<text[^>]*>//' | sort -u
4. Each step's story finishes 0.4 s before the step ends (0.6 s before the loop ends), where the site player holds. Spot-check with npm run snap -- <slug> --times=4.6,9.6,14.6,19.4.
Only report and fix substantive problems: wrong, outdated, misleading, inconsistent, broken. No style rewrites. Keep fixes minimal and in house style (captions at most 100 characters, step titles at most 26, no "|" in step titles or bodies).
Only edit files inside those patterns' folders. Another reviewer works on other folders in parallel, so touch nothing else, do not run git, and do not run npm run build or a full sync/check. After edits: node scripts/sync.mjs <slug> && node scripts/check.mjs <slug> (0 errors). Re-snapshot and view any diagram you changed.
Return, per pattern, the fixes you applied (with the source you checked), suspicions you rejected, whether the SVG changed and whether the check passed.`
}

phase('Author')
const results = await pipeline(
  args.groups,
  (group) => parallel(group.map((p) => () => agent(authorPrompt(p), { label: `author:${p.slug}`, phase: 'Author', schema: AUTHORED }))),
  async (authored, group, gi) => {
    const done = group.filter((p, i) => authored[i])
    const missing = group.filter((p, i) => !authored[i]).map((p) => p.slug)
    if (missing.length) log(`group ${gi + 1}: authoring failed for ${missing.join(', ')}; not reviewed`)
    log(`group ${gi + 1}: authored ${done.map((p) => p.slug).join(', ')}, reviewing`)
    const review = done.length ? await agent(reviewPrompt(done), { label: `review:group-${gi + 1}`, phase: 'Review', schema: REVIEWED }) : null
    return { group: gi + 1, authored: authored.filter(Boolean), missing, review }
  },
)
return results
