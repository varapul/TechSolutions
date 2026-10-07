
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧭 DevOps & SRE Principles](../../README.md#devops--sre-principles)

# The Three Ways

> DevOps in three principles: speed the flow of work to customers, amplify feedback back to the team, and keep learning.

<p align="center"><img src="diagram.svg" alt="Animated diagram: The Three Ways" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/three-ways.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Handoffs and big batches** | Before: Acme Shop's gift-wrapping feature needs about 6 days of work (3 to build, 2 for the QA team's manual tests, 1 for the release), yet it waits 14 days in the backlog, 9 for the test cycle, 12 for the monthly change advisory board (CAB) and 6 for the operations team's release weekend: **47 days** from idea to customers. Two weeks after the release, customer complaints lead operations to a slow query; they fix it themselves and nobody tells the checkout team, so the same failure ships again. (Acme's numbers are the example's own.) |
| **2 · First Way: flow** | The **First Way** speeds up the flow through the whole value stream rather than through one department. The team makes its work visible on a board with a WIP limit, maps the value stream (6 days of work inside 47 days of lead time), splits gift wrapping into four small slices and automates the handoffs: tests run in the pipeline in 12 minutes, and the team deploys with one button in 8. A slice that fails its tests goes no further, because a known defect is never passed downstream; the lead time falls to about 4 days, 3 of them work. |
| **3 · Second Way: feedback** | The **Second Way** shortens and amplifies the feedback that flows back from right to left. When a test fails, the line stops (the andon cord of the Toyota Production System) and the team swarms the problem, fixing it in 20 minutes before it starts new work; instead of a monthly change board, a teammate reviews each pull request within the hour. In production, telemetry with a deploy marker shows checkout's p95 latency climbing after the 14:02 deploy: the alert reaches the checkout team at 14:05, and they roll back at 14:08. |
| **4 · Third Way: learning** | The **Third Way** is a culture of continual experimentation and learning. The blameless postmortem for INC-3 looks for contributing factors rather than culprits (the gift-wrap lookup had no timeout), and a game day adds 3 s of delay on purpose to prove that the new 1 s timeout and fallback hold. The fix becomes the default in the shared HTTP client library for every team, 20% of each sprint stays reserved for improving daily work, the fixed slice ships, and the lead time keeps falling. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's checkout team can build gift wrapping in three days, yet customers wait 47 days for it. The change passes through four groups, each with its own queue: the product backlog, the QA team's test cycle, a monthly change advisory board (CAB) and the operations team's release weekend. Every group batches work so that its own step runs efficiently, and every batch means waiting: in the example, 41 of the 47 days are spent in queues that nobody owns. (Acme's numbers are the example's own, not research findings.)

Problems travel back even more slowly. The first to notice the slow query are the customers, then operations, and neither wrote it. Operations patch it, nobody tells the checkout team, and the next release ships the same mistake. Gene Kim's point is that defects tend to recur when the people who create them never see their effects. Adding process to stop the failures (another approval, another test phase, a longer freeze) makes the batches bigger and the feedback slower still.

## How it works

Gene Kim described the Three Ways in a 2012 essay on IT Revolution as the principles from which all DevOps patterns can be derived. They frame *The Phoenix Project* (Gene Kim, Kevin Behr and George Spafford, 2013), a novel about an IT department in crisis, and *The DevOps Handbook* (Gene Kim, Jez Humble, Patrick Debois and John Willis, 2016; the second edition of 2021 adds Nicole Forsgren). The Handbook's first edition gives each Way its own part of technical practices. The ideas come from manufacturing: Lean and the Toyota Production System, Eliyahu Goldratt's Theory of Constraints, and W. Edwards Deming's systems thinking.

### The First Way: flow and systems thinking

Work flows from left to right, from the business to the customer, and the First Way improves that whole flow rather than one department's or one person's part of it. The outcomes Kim lists: never pass a known defect on to the next step, never let a local optimisation make the whole worse, keep increasing flow, and understand the system as a whole.

- **Map the value stream.** Value stream mapping, popularised by Mike Rother and John Shook's workbook *Learning to See* (Lean Enterprise Institute), draws every step from request to delivery as a current-state map and then a future-state map to aim for. For each step, note the time someone actually works on the item (process time) and the time it waits; lead time is the whole journey from start to finish. In the diagram, 6 days of process time sit inside 47 days of lead time.
- **Make work visible and limit work in progress.** A board that shows all of the team's work (features, defects, operations work) with a WIP limit exposes the queues and stops the team from starting more than it finishes.
- **Shrink batches.** Kim's essay on the First Way lists the tools that Lean, the Toyota Production System and the Theory of Constraints bring: elevate bottlenecks, reduce work in process and batch sizes, release work at the pace of demand, remove waste and smooth out variation. Gift wrapping ships as four slices instead of riding a monthly release.
- **Improve the constraint.** In *The Goal* (1984), Goldratt argues that a system moves only as fast as its constraint. His five focusing steps: identify the constraint, exploit it, subordinate everything else to it, elevate it, then start again so that inertia doesn't become the next constraint. An hour saved anywhere else is not an hour saved for the customer.
- **Automate the handoffs.** A deployment pipeline that tests every change and deploys it with one button replaces the queues in front of QA and operations.

### The Second Way: feedback

Create fast feedback from right to left at every stage, so that problems are seen where and when they happen, and amplify it so that it reaches the people who can act on it. Kim's outcomes: understand and respond to every customer, internal and external; shorten and amplify every feedback loop; put knowledge where it is needed.

- **Stop the line.** One of the two pillars of the Toyota Production System is *jidoka*: stop as soon as something is abnormal. On a production line, pulling the andon cord lights a signal board and calls for help. The software equivalent: when a test fails or the pipeline goes red, the team stops starting new work and swarms the problem until it is fixed.
- **Telemetry for the people who made the change.** Metrics, logs and traces, deploy markers on the dashboards, and alerts routed to the team that owns the service, so that a regression shows up minutes after the deploy that caused it.
- **Review close to the work.** In DORA's 2019 research, approval by an external body such as a CAB hurt software delivery performance, and no evidence linked it to fewer failed changes. DORA recommends peer review during development, backed by automated checks. The DevOps Handbook files review and coordination under the Second Way.

### The Third Way: continual learning and experimentation

Build a culture that experiments, takes risks and learns from failure, and that treats repetition and practice as the way to mastery. Kim's outcomes: time set aside to improve daily work, rituals that reward the team for taking risks, and faults injected into the system to make it more resilient. The Handbook's first edition covers it in three chapters: inject learning into daily work, turn local discoveries into global improvements, and reserve time for organisational learning and improvement.

- **Learn from failure without blame.** A blameless postmortem looks for the contributing causes of an incident without blaming a person or a team (Google's SRE book, chapter 15). John Allspaw's 2012 post on Etsy's blameless postmortems ties the practice to a just culture.
- **Practise failure on purpose.** Game days and chaos experiments inject faults (here, 3 s of delay in the gift-wrap lookup) to check that the defences work before a real incident tests them.
- **Spread local discoveries.** A fix in one team's code protects one team. Moving it into a shared library, a service template or a platform default (here, a 1 s timeout in the shared HTTP client) protects every team.
- **Reserve time.** Improvement work competes with feature work and loses unless capacity is set aside for it. Acme keeps 20% of each sprint; the right share is the team's call.

### Related framings

- **CALMS.** In 2010 John Willis summed up DevOps as CAMS: culture, automation, measurement and sharing. CALMS, which Atlassian credits to Jez Humble, adds Lean. It is a list of what to look at; the Three Ways describe the direction of improvement.
- **DORA and *Accelerate*.** DORA, a research program now run by Google Cloud, has published reports since 2014, and *Accelerate* (Nicole Forsgren, Jez Humble and Gene Kim, 2018) summarises four years of that research. DORA measures software delivery with five metrics: change lead time, deployment frequency, failed deployment recovery time, change fail rate and deployment rework rate (see [DORA Metrics](../dora-metrics/)). Its change lead time runs from commit to production, only the right-hand end of the value stream in the diagram; the 47 and 4 days here run from idea to customers. DORA finds that speed and stability go together for most teams rather than trading off, and names smaller batches as a common way to improve both.

## Putting it into practice

1. **Map one value stream.** Pick one product and follow real work items from idea to customers, with the people who do the work. Record the process time and the waiting time of each step and the total lead time. A whiteboard and a spreadsheet are enough to start.
2. **Make the work visible.** One board per team, including unplanned and operations work, with a WIP limit on the columns where work piles up.
3. **Attack the biggest queue first.** It is usually an approval, a test phase or a release window, not anyone's working speed. Map again after each change, because the constraint moves.
4. **Shrink batches.** Split features into slices that can ship on their own, merge into the main branch at least daily ([Trunk-Based Development](../trunk-based-development/)) and hide unfinished work behind [Feature Flags](../feature-flags/).
5. **Automate the path to production.** One pipeline builds, tests and deploys every change the same way ([Continuous Delivery](../continuous-delivery/)), and a [Canary Release](../canary-release/) limits how many users a bad change reaches.
6. **Agree to stop the line.** When the main branch or the pipeline is red, fixing it comes before starting new work.
7. **Wire feedback to the team.** Telemetry through a [Telemetry Pipeline](../telemetry-pipeline/), deploy markers on the dashboards, alerts on what users feel ([SLOs & Error Budgets](../slo-error-budgets/)), and on-call duty in the team that owns the service ([You Build It, You Run It](../you-build-it-you-run-it/)).
8. **Replace external approval with peer review and automated checks,** and keep their records as audit evidence where regulation requires segregation of duties.
9. **Learn on a schedule.** [Blameless Postmortems](../blameless-postmortems/) with owned, dated action items; regular game days and [Chaos Engineering](../chaos-engineering/) experiments; a fixed share of capacity for improvement; shared libraries and templates for what one team learns.
10. **Measure the outcome, not the activity:** lead time, deployment frequency, change fail rate and recovery time, tracked over months.

## Where it fits

The Three Ways are the reasoning behind many pages in this catalog:

| Way | Related pages |
|---|---|
| First Way: flow | [Continuous Delivery](../continuous-delivery/), [Trunk-Based Development](../trunk-based-development/), [Feature Flags](../feature-flags/), [Canary Release](../canary-release/), [Blue-Green Deployment](../blue-green-deployment/), [Rolling Update](../rolling-update/), [Immutable Infrastructure](../immutable-infrastructure/), [GitOps](../gitops/) |
| Second Way: feedback | [Telemetry Pipeline](../telemetry-pipeline/), [Distributed Tracing](../distributed-tracing/), [Centralized Logging](../centralized-logging/), [Health Endpoint Monitoring](../health-endpoint-monitoring/), [SLOs & Error Budgets](../slo-error-budgets/), [You Build It, You Run It](../you-build-it-you-run-it/) |
| Third Way: learning | [Blameless Postmortems](../blameless-postmortems/), [Chaos Engineering](../chaos-engineering/), [Timeout & Fallback](../timeout-and-fallback/) (the kind of safe default worth sharing) |
| Measuring the result | [DORA Metrics](../dora-metrics/) |

Team Topologies applies the same thinking to the organisation: stream-aligned teams follow one flow of work, and platform teams offer internal products, such as a shared library with safe defaults, that speed those teams up.

## When to use it

The Three Ways pay off wherever software changes often and several groups take part in getting a change to production: long lead times made mostly of waiting, the same incidents coming back, teams that hear about production only through tickets. They describe a direction rather than a maturity model, so they suit small steps: one value stream, one pipeline, one postmortem at a time.

Adapt them where the context differs:

- **Regulated environments** still need segregation of duties and an audit trail. Peer review, automated checks and the pipeline's own records can provide both, as DORA's guidance on change approval describes; involve the auditors early.
- **Legacy systems** with manual deploys and slow tests can't move to small batches overnight. Start with the value stream map and the biggest queue, and carve pieces out with the [Strangler Fig](../strangler-fig/) pattern.
- **Small teams** have few handoffs to remove; for them the Second and Third Ways (telemetry, postmortems, reserved time) matter more than the flow work.
- **Hardware, firmware and mobile apps** ship on external cycles (manufacturing runs, app store review). Shrink the batches inside the cycle, and move the feedback earlier with simulators, staged rollouts and telemetry.

It costs more than it returns for a system that rarely changes and rarely fails: an internal tool released twice a year doesn't need a pipeline with canary analysis, although a postmortem after its next outage is still worth writing.

## Common pitfalls

- **A "DevOps team" as a new silo.** A third team between development and operations adds a handoff instead of removing one, as Jez Humble argued in 2012. Give the team that builds a service the tools and the responsibility to run it, and let a platform team offer self-service rather than tickets.
- **Buying tools without changing the flow.** A CI server in front of a monthly change board still ships monthly. Map the value stream first and let the biggest queue decide what changes.
- **Automating a broken process.** A scripted five-approval release runs faster but still waits for five approvals. Remove the steps that add no value, then automate what is left.
- **Optimising a step that isn't the constraint.** Halving the build time saves minutes when the change then waits 12 days for a board meeting. Measure waiting time, not only working time.
- **Alerts nobody acts on.** Alerts on every CPU spike train people to ignore them. Alert on symptoms users feel, route each alert to the team that owns the service, and delete the ones nobody acts on.
- **Postmortems with no follow-up.** A well-written postmortem whose action items never get done sets up the next incident. Give every action an owner and a date, track it like any other work, and share the lesson beyond the team.
- **Treating the Ways as stages.** The diagram tells them one after another, but they depend on each other: flow without feedback ships problems faster, and feedback without time to learn finds the same problems faster. Work on all three in small steps.
- **Turning outcome numbers into targets.** A team told to deploy more often can split deploys without improving anything. Use lead time and the other measures to find the next constraint, not to rank teams.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Continuous Delivery](../continuous-delivery/) — Keep every change releasable: a deployment pipeline builds once, tests in stages and promotes the same artifact to production.
- [DORA Metrics](../dora-metrics/) — Measure software delivery by throughput and stability: how often and how fast changes reach production, and how often they fail.
- [Blameless Postmortems](../blameless-postmortems/) — Learn from every incident without blame: a timeline, the contributing factors and tracked action items, shared widely.
- [Trunk-Based Development](../trunk-based-development/) — Everyone merges small changes into one main branch at least daily; feature flags hide unfinished work instead of long branches.
- [You Build It, You Run It](../you-build-it-you-run-it/) — The team that builds a service runs it in production, on call, so the people who can fix a problem hear about it first.
- [Chaos Engineering](../chaos-engineering/) — Inject failures on purpose to prove the system degrades the way you expect.
- [SLOs & Error Budgets](../slo-error-budgets/) — Measure SLIs against an objective and alert on error-budget burn rate, not on every blip.
- Team Topologies *(planned)* — Four team types and three interaction modes that organise teams around the flow of change and keep cognitive load in check.

## References

- [Gene Kim — The Three Ways: The Principles Underpinning DevOps (IT Revolution, 2012)](https://itrevolution.com/articles/the-three-ways-principles-underpinning-devops/)
- [Gene Kim — Elements of the First Way: And the DevOps Implications (IT Revolution, 2012)](https://itrevolution.com/articles/elements-of-the-first-way-and-the-devops-implications/)
- [The DevOps Handbook, Second Edition — Gene Kim, Jez Humble, Patrick Debois, John Willis and Nicole Forsgren (IT Revolution, 2021)](https://itrevolution.com/product/the-devops-handbook-second-edition/)
- [The Phoenix Project — Gene Kim, Kevin Behr and George Spafford (IT Revolution, 2013)](https://itrevolution.com/product/the-phoenix-project/)
- [Accelerate — Nicole Forsgren, Jez Humble and Gene Kim (IT Revolution, 2018)](https://itrevolution.com/product/accelerate/)
- [DORA — Software delivery performance metrics](https://dora.dev/guides/dora-metrics/)
- [DORA — Capabilities: Streamlining change approval](https://dora.dev/capabilities/streamlining-change-approval/)
- [Lean Enterprise Institute — Value Stream Mapping](https://www.lean.org/lexicon-terms/value-stream-mapping/)
- [Lean Enterprise Institute — Andon](https://www.lean.org/lexicon-terms/andon/)
- [Toyota — Toyota Production System](https://global.toyota/en/company/vision-and-philosophy/production-system/)
- [Theory of Constraints Institute — Five Focusing Steps](https://www.tocinstitute.org/five-focusing-steps.html)
- [Google SRE Book — Postmortem Culture: Learning from Failure (chapter 15)](https://sre.google/sre-book/postmortem-culture/)
- [Jez Humble — There's No Such Thing as a "Devops Team" (2012)](https://continuousdelivery.com/2012/10/theres-no-such-thing-as-a-devops-team/)
- [John Willis — What Devops Means to Me (Chef blog, 2010)](https://www.chef.io/blog/what-devops-means-to-me)
- [Atlassian — CALMS Framework](https://www.atlassian.com/devops/frameworks/calms-framework)
- [Team Topologies — Key concepts](https://teamtopologies.com/key-concepts)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
