export const meta = {
  name: 'author-batch',
  description: 'Author a batch of animated pattern diagrams in parallel, then fact-check and fix them in small review groups',
  whenToUse: 'Animating the next batch of planned patterns in the diagram catalog',
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

// An author that dies on an API error (in batch 3: the output filter, twice on one pattern) gets one retry.
const RETRY_NOTE = `

RETRY: an earlier agent on this pattern was cut off by an API error before it finished. Its pattern folder and scratch folder may hold partial work: inspect them, keep what is sound and continue from there (skip npm run new if the folder exists). The usual cause is the API's output filter, which fires when a response starts to write out a source's text, so follow the own-words rule below strictly.`

// Patterns with algorithm: true (the Algorithms & Data Structures category) draw data instead of components.
const ALGORITHM_RULES = `

ALGORITHM PATTERN (CONTRIBUTING.md's Algorithm diagrams section defines how these look. The algorithm diagrams are new and the other authors in this batch follow the same section, so keep to it: the set should read as one family.)
- Animate a real run. In your scratch folder, implement the algorithm in Python 3 (python3 is 3.11 here), run it on the exact input the diagram uses, record the trace (every comparison, swap, pointer move, call, return, queue or table change you show) and drive your keyframe generator from it. Every value, index, count and result in the diagram and the text must match that run.
- The README template has two extra sections. Code: your own short implementation (standard library only, about 10 to 30 lines, readable over clever) with an example call and its output as a comment; run it in scratch with assert-based tests first, edge cases included (empty input, one item, duplicates, already sorted or reversed, not found, as they apply). Complexity: a small table of the time in the best, average and worst case and the extra space, plus stable and in place where they apply, each with a short reason.
- Be precise about bounds: worst versus average versus amortized, comparisons versus swaps, time versus space. Check claims about real libraries and systems (which algorithm a language's built-in sort uses today, what a standard module provides, defaults such as load factors) against current official documentation or source.
- Code in books and library sources is someone else's text too: write your own implementation and never paste library source.
- The readers are developers and solutions architects. In Implementation notes, show where the algorithm runs in real systems (language libraries, databases, networks, build tools), and link related architecture patterns where they genuinely connect.`

// Patterns with kind: 'design-pattern' (the Design Patterns (GoF) category) show object structure and collaboration.
const DESIGN_PATTERN_RULES = `

DESIGN PATTERN (GoF) (CONTRIBUTING.md's Design pattern diagrams section defines how these look. They are new and the other authors in this batch follow the same section, so keep to it: the set should read as one family.)
- Tell the story with the brief's concrete scenario and real names, and tag each box with its GoF participant (Context, Strategy, ConcreteStrategy …) so a reader can map the scenario onto the pattern.
- The README template has an extra Code section: TypeScript that runs as is with node (Node 22 strips the types itself, so use only erasable syntax: no enum, namespace, parameter properties or decorators; abstract classes, interfaces, private constructors and readonly fields are fine). Write your own example, about 25 to 60 lines, that mirrors the diagram's scenario and names, with a short usage at the end and its output as comments. Run it with node in scratch, with node:assert checks of the behaviour the diagram shows, before you paste it.
- Paraphrase: never quote the GoF book's intent statements or any other book's prose. State the intent and the participants in your own words and cite the book.
- Be precise about what the pattern is and is not: name its closest relatives and how they differ (Decorator, Proxy and Adapter all wrap an object; Strategy and State share a structure), and say where modern language features replace or simplify it (first-class functions, generators, modules).
- Check claims about real libraries and frameworks (which standard-library classes or framework APIs use the pattern, deprecations, defaults) against current official documentation or source.
- The readers are developers and solutions architects: where the pattern has an architecture-scale cousin in this catalog (Observer and publish-subscribe, Proxy and ambassador, Command and CQRS, Adapter and anti-corruption layer), link it and say what changes at that scale.`

// Patterns with kind: 'component' (the System Components and AWS Services categories) explain one real product.
const COMPONENT_RULES = `

SYSTEM COMPONENT (CONTRIBUTING.md's Component diagrams section defines how these look. These categories are new and the other authors in this batch follow the same section, so keep to it: the set should read as one family.)
- The page explains one real product. Use its own vocabulary and its real setting names, API calls and values. Versions, defaults, limits, quotas, pricing models and licences change often: check each against the current official documentation and release notes, say which version or date a number holds for, and cite the page.
- The diagram: step 1 shows where the component sits in the brief's solution, with its neighbours and the job it does there; steps 2 and 3 show its internals working (one operation flowing through, then scaling and failure handling, with the numbers); step 4 shows its limit or the trade-off that decides when to choose something else. Draw the product as one large labelled frame with its internals inside and its neighbours outside.
- The README template has an extra section, Where it fits: the solutions it appears in, the patterns of this catalog it implements or supports (link the animated ones), its usual neighbours, and its managed offerings (name the AWS service where one exists). In When to use it, compare it with its closest alternatives in a small table.
- A short snippet (a CLI call, a client call, a config fragment) is welcome where it makes a mechanism concrete; check its syntax and every flag against the documentation. Do not call real cloud services: there are no credentials here and none are needed.
- Keep it factual: no marketing language and no unsourced performance numbers; when you give a number, say what it depends on or where it comes from. Licences and forks matter to readers choosing a component (for example Redis and Valkey, Elasticsearch and OpenSearch): state them as they are today, with sources.`

// Patterns with kind: 'principle' (the DevOps & SRE Principles and Platform Engineering categories) teach a way of working or a framework.
const PRINCIPLE_RULES = `

PRINCIPLE OR FRAMEWORK (CONTRIBUTING.md's Principle diagrams section defines how these look. These categories are new and the other authors in this batch follow the same section, so keep to it: the set should read as one family.)
- The page teaches a way of working or a framework, not one mechanism. Tell it through the brief's concrete Acme Shop team story with real artefacts (a pipeline, a pull request, a deploy log, a dashboard, an alert, an incident timeline, a team map, a bill), so the reader watches the principle happen. Avoid slides of bullet words: when the framework is a list, apply a few items at a time to the story's system.
- The diagram: step 1 shows the problem without the principle (the pain, in red); step 2 the principle at work in the story; step 3 how a team puts it into practice or measures it, with numbers; step 4 the common pitfalls, misreadings or limits. Follow the brief where it spreads a multi-part framework over steps 2 to 4 instead.
- Sources: these ideas come from books, reports, papers and framework documents. Name the source of each idea and its authors, paraphrase (never quote book or report prose; a short attributed phrase at most, such as a principle's well-known name), and give definitions, thresholds and research findings with the edition or year they come from. Check terms that have changed (renamed metrics, new editions, reorganised frameworks, renamed products) against the current official source. Don't invent statistics or present a research correlation as a law; label Acme Shop's numbers as the example's own.
- The README template has the sections The problem, How it works, Putting it into practice (concrete steps, with tools as examples, not requirements), Where it fits (the patterns, components and other principles of this catalog it connects to; link the animated ones), When to use it (where it pays off, and where it doesn't fit or costs more than it returns) and Common pitfalls (each misreading or anti-pattern with what to do instead).
- Keep it practical and balanced for engineers and architects: no evangelism or marketing language, and say plainly where a principle needs adapting (team size, regulation, legacy systems).`

const KIND_RULES = { algorithm: ALGORITHM_RULES, 'design-pattern': DESIGN_PATTERN_RULES, component: COMPONENT_RULES, principle: PRINCIPLE_RULES }
const kindOf = (p) => p.kind ?? (p.algorithm ? 'algorithm' : null)

function authorPrompt(p, note = '') {
  return `You are authoring ONE animated diagram in ${REPO} (today is ${TODAY}): a public catalog of self-explaining, looping SVG diagrams of architecture patterns, the classic GoF design patterns, the algorithms underneath them, the system components and AWS services that solutions are built from, and the DevOps, SRE and platform engineering principles teams work by, for solutions architects and developers (https://github.com/varapul/TechSolutions). The finished diagrams in patterns/ set the quality bar; match them.${note}

Read first: CONTRIBUTING.md (canvas, 20 s / 4-step timeline, phase classes, motion, hold frames, colour language, writing rules); patterns/circuit-breaker/ and patterns/event-driven-architecture/ (diagram.svg, meta.json, README.md) as reference implementations (in each SVG skip the generated block between "<!-- @generated:base" and "<!-- @end:chrome -->"); scripts/lib/motion.mjs (track, windows, keys, route, sec, rules); src/diagram/base.css (classes and colour tokens).

YOUR PATTERN: slug \`${p.slug}\`, title "${p.title}", category ${p.category}. Catalog summary: "${p.summary}"

DESIGN BRIEF:
${p.brief}

PROCESS
- cd ${REPO} && npm run new -- ${p.slug}   (the slug is already in catalog.json)
- Every tool call re-reads your whole context, so work in few, larger steps: send independent tool calls together in one turn, read only the parts of files you need, pull facts out of web pages with grep or a narrow fetch prompt instead of loading whole pages, and don't re-view a snapshot that hasn't changed.
- Never run code that is meant to crash or exhaust the machine (recursion past the C stack, fork bombs, memory exhaustion): on this Mac a crashing process opens a crash-report dialog in front of the user. Support such claims with documentation instead.
- Write your keyframe generator in ${SCRATCH}/${p.slug}/ (import ${REPO}/scripts/lib/motion.mjs by absolute path) and paste its output into the diagram's <style>. Keep scratch files out of the repo.
- Only create or modify files inside patterns/${p.slug}/. Other agents work in the same repo in parallel: do not edit anything else, and do not run npm run build or a full npm run sync / npm run check. If a shared file needs a change, say so in compromises.
- After edits: node scripts/sync.mjs ${p.slug} && node scripts/check.mjs ${p.slug} (0 errors required).
- Verify visually with npm run snap -- ${p.slug}, then with --dark and --static. View each with the Read tool, and inspect single frames with --times=<s> --cols=1. Iterate until nothing overlaps or is clipped, every caption matches its step, motion is readable, the static render reads as step 1, the loop restarts cleanly, and each step's story is finished 0.4 s before the step ends (0.6 s before the loop ends), which is where the site player holds.

CONTENT RULES (the last batch's review found about two real errors per pattern; avoid them)
- Verify every technical claim against primary sources on the web, current as of today (ToolSearch "select:WebFetch,WebSearch", or curl): standards and RFCs, official vendor documentation, original papers or articles. Watch for drafts that have become RFCs, renamed or retired products, changed defaults, and deprecated APIs.
- Check every reference URL with curl -sIL and confirm the title matches the page. Cite only URLs you have loaded.
- Own words only. Never transcribe passages from books, papers or articles, not in files, notes, tool inputs or your own reasoning, and don't ask a fetch tool to quote: the API's output filter ends the response when you do. Take facts from sources and write your own sentences; a README may carry at most a short attributed phrase.
- In README prose, link other patterns as ../<slug>/ only when that pattern is already animated (patterns/<slug>/ exists); otherwise name it without a link. meta.json "related" may list planned slugs from catalog.json.
- Keep captions, step bodies, README and diagram labels consistent with each other and with what the animation shows.${KIND_RULES[kindOf(p)] ?? ''}

Return slug, one line per step, whether the check passed, and any compromises.`
}

function reviewPrompt(group) {
  const list = group.map((p) => `- ${p.slug} ("${p.title}", ${p.category})`).join('\n')
  const kinds = new Set(group.map(kindOf))
  const algorithmCheck = (kinds.has('algorithm')
    ? `\n5. For algorithm patterns: run the README's Code block with python3, adding edge cases of your own, and re-run the algorithm on the diagram's input to confirm every value, comparison, swap, pointer position, count and result that the diagram, captions and step bodies show. Check the Complexity table, and that the diagram follows CONTRIBUTING.md's Algorithm diagrams section.`
    : '') + (kinds.has('design-pattern')
    ? `\n5. For design patterns: run the README's TypeScript with node, adding a few assertions of your own, and confirm that the diagram's objects, call order and values match the code and the captions. Check that the GoF intent and participants are paraphrased correctly (no quoted book text), that the relatives named really differ as stated, that claims about real libraries hold today, and that the diagram follows CONTRIBUTING.md's Design pattern diagrams section.`
    : '') + (kinds.has('component')
    ? `\n5. For system components and AWS services: check every version, default, limit, quota, pricing model and licence statement against the current official documentation; check that the setting names, API calls and commands in the diagram, captions and snippets exist and are spelled as documented; check the comparison with alternatives for fairness and accuracy; and check that the diagram follows CONTRIBUTING.md's Component diagrams section.`
    : '') + (kinds.has('principle')
    ? `\n5. For principles and frameworks: check every definition, list (factors, pillars, phases, team types, metric names), threshold and research finding against the original source in its current edition or latest report; check that each idea is attributed to the right source and authors and is paraphrased, not quoted; check that Acme Shop's example numbers are not presented as research; check that the pitfalls and the limits are fair; and check that the diagram follows CONTRIBUTING.md's Principle diagrams section.`
    : '')
  return `You are the independent fact-checker for newly authored patterns in ${REPO} (today is ${TODAY}), a public catalog of animated SVG diagrams of architecture patterns, GoF design patterns, algorithms, system components, AWS services and DevOps and platform principles. Their authors have finished. Review exactly these patterns, and fix what you confirm:
${list}

For each pattern, read patterns/<slug>/meta.json, README.md and diagram.svg (hand-authored part after "<!-- @end:chrome -->"), plus the contact sheets .snapshots/<slug>.png and -dark.png (re-render with npm run snap -- <slug> if they look stale). Check:
1. Every technical claim against primary sources on the web, current as of today (ToolSearch "select:WebFetch,WebSearch", or curl). Proportionate effort: one or two authoritative sources per claim you doubt.
2. Every reference: curl -sIL, the page matches its title, and the title is current.
3. Consistency between the catalog summary (catalog.json), captions, step bodies, README and the diagram's labels and visuals. List labels with: grep -o '<text[^>]*>[^<]*' patterns/<slug>/diagram.svg | sed 's/<text[^>]*>//' | sort -u
4. Each step's story finishes 0.4 s before the step ends (0.6 s before the loop ends), where the site player holds. Spot-check with npm run snap -- <slug> --times=4.6,9.6,14.6,19.4.${algorithmCheck}
Work in your own words: never transcribe passages from books, papers or articles, in fixes, notes or reasoning (the API's output filter ends the response when you do), and don't ask a fetch tool to quote.
Never run code that is meant to crash or exhaust the machine (a crashing process opens a crash-report dialog in front of the user); check such claims against documentation.
Only report and fix substantive problems: wrong, outdated, misleading, inconsistent, broken. No style rewrites. Keep fixes minimal and in house style (captions at most 100 characters, step titles at most 26, no "|" in step titles or bodies).
Only edit files inside those patterns' folders. Another reviewer works on other folders in parallel, so touch nothing else, do not run git, and do not run npm run build or a full sync/check. After edits: node scripts/sync.mjs <slug> && node scripts/check.mjs <slug> (0 errors). Re-snapshot and view any diagram you changed.
Return, per pattern, the fixes you applied (with the source you checked), suspicions you rejected, whether the SVG changed and whether the check passed.`
}

async function author(p) {
  const first = await agent(authorPrompt(p), { label: `author:${p.slug}`, phase: 'Author', schema: AUTHORED })
  if (first) return first
  log(`author:${p.slug} failed; retrying once`)
  return agent(authorPrompt(p, RETRY_NOTE), { label: `author:${p.slug}:retry`, phase: 'Author', schema: AUTHORED })
}

phase('Author')
const results = await pipeline(
  args.groups,
  (group) => parallel(group.map((p) => () => author(p))),
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
