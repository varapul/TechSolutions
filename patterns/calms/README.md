
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧭 DevOps & SRE Principles](../../README.md#devops--sre-principles)

# CALMS

> A lens for assessing a DevOps adoption: culture, automation, lean, measurement and sharing, and the dimension that holds the others back.

<p align="center"><img src="diagram.svg" alt="Animated diagram: CALMS" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/calms.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Tools without change** | Acme's back-office IT department (40 people who run the ERP and warehouse systems in the company's own data centre) wants what DevOps did for the shop: in January it bought a pipeline tool, and it renamed its release group, six engineers from operations, the **DevOps team**. Nine months later every change still waits for the monthly release (Release 2026.09 carried 41 changes) and passes one more queue on the way, and incident INC-0917, warehouse picking down for 3 h 20 min, ended with development and operations blaming each other. (Acme's numbers are the example's own.) |
| **2 · Five dimensions, scored** | On Thu 8 Oct developers, the DevOps team and operations spend a day on a **CALMS** assessment, facilitated by someone from the shop's SRE group. Every score on Acme's 1–5 scale (the example's own) needs evidence that both sides accept: **culture 2**, as incident reviews look for a culprit; **automation 4**, as every commit is built and tested in 12 minutes; **lean 2**, with 41 changes in one release and 38 items in progress without a WIP limit; **measurement 3**, with uptime and ticket counts but no delivery numbers; and **sharing 1**, with no shared postmortems and three separate chat channels. |
| **3 · Start with the weakest** | The lowest scores, sharing and culture, hold the others back: a 12-minute pipeline changes little while every incident ends in blame and neither side reads the other's notes. So the actions start there: blameless postmortems shared with all 40 people (October), one on-call rota for development and operations (November), WIP limits on every team board (December) and DORA's delivery metrics on a dashboard everyone sees (January). On Thu 8 Apr 2027 the same people reassess on the same scale: culture 3, automation still 4, lean 3, measurement 4 and sharing 3. |
| **4 · Pitfalls and misuse** | The scores are a team's own judgement on a home-made scale, so a league table that ranks teams by them only teaches teams to argue their numbers up. Buying more tools lifts automation to 5 and leaves the weakest dimensions where they were; a DevOps team between development and operations adds a handoff instead of removing one; a dashboard that only managers see changes nothing; and an assessment done once and filed away can't show a trend. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's back-office IT department has 40 people: 22 developers who write the ERP and warehouse code, 12 operations engineers who run the servers in the company's own data centre, and a release group of six engineers who came from operations. After the shop's product teams moved to small, frequent deploys, the department wanted the same results. In January it bought a pipeline tool, and it renamed the release group the DevOps team. (Acme's numbers are the example's own, not research findings.)

Nine months later, every commit is built and tested in 12 minutes, and then it waits. A change still travels from development to the DevOps team to operations as a ticket, and everything ships in one monthly release: Release 2026.09 went out on Saturday 26 September with 41 changes. Two days later warehouse picking failed for 3 hours 20 minutes (INC-0917). The review began by asking who had deployed the change. Developers blamed a configuration change by operations, operations blamed a bad build from development, and the notes stayed in the operations wiki. The monthly IT report shows server uptime and tickets closed, so nobody can say whether delivery is getting better.

The department adopted the parts of DevOps that can be bought or renamed and left the rest alone. Nobody has looked at all of it together, so nobody can say which part is holding the others back.

## How it works

### Where CALMS comes from

In a July 2010 post, *What Devops Means to Me*, John Willis described DevOps as CAMS: culture, automation, measurement and sharing. He put people and process first and argued that automation fails without the culture to support it; he asked for measurement of performance, process and people; and he called sharing the feedback loop that closes the cycle. Writing on IT Revolution in 2012, Willis said that he and Damon Edwards had coined CAMS after the first DevOpsDays in the United States, held in Mountain View in 2010, and that Jez Humble later added an L for Lean. Atlassian's CALMS page also credits Humble with the acronym. In their August 2011 *Cutter IT Journal* article on why enterprises need DevOps to deliver continuously, Humble and Joanne Molesky still worked through the four CAMS dimensions, citing Willis.

CALMS is a mnemonic, not a standard. Neither Willis's posts nor Atlassian's page define levels, a questionnaire or a scoring scale, so every organisation that scores CALMS makes up its own. Acme's 1-to-5 scale in the diagram is the example's own.

### The five dimensions

| Dimension | What it covers | Evidence to look for | Acme, October 2026 |
|---|---|---|---|
| **Culture** | Shared responsibility between the people who build a system and the people who run it; trust; how the organisation reacts to failure | Incident reviews (do they look for causes or for a culprit?), who is on call, who decides about a release | **2**: the INC-0917 review looked for whoever deployed the change |
| **Automation** | Build, test, deployment, infrastructure and configuration as repeatable automated steps | Pipeline runs, the manual steps that are left, how a server or an environment gets created | **4**: every commit built and tested in 12 minutes; deploys are scripted, but only the DevOps team runs them |
| **Lean** | Flow: small batches, limited work in progress, visible work, less waiting and rework | Changes per release, items in progress, how long work waits between steps | **2**: 41 changes in one release, 38 items in progress, no WIP limit |
| **Measurement** | Measuring the flow of work and its outcome, not only the servers | What the reports show and who reads them; whether lead time, deployment frequency, change fail rate and recovery time are known | **3**: uptime and tickets closed, no delivery numbers |
| **Sharing** | Knowledge, tools, results and responsibility shared across team boundaries | Shared channels, published postmortems, shared dashboards, shared on-call, internal talks and documentation | **1**: three separate chat channels, no shared postmortems |

The dimensions depend on each other. Automation built by teams that blame each other becomes one more wall, measurements nobody shares change nothing, and small batches need the trust to release them. That's why the useful output of an assessment is the shape, and above all its lowest point, rather than an average.

### A lens, not a model

CALMS tells you where to look. It is not a research instrument, and its scores are a group's own judgement. Two neighbours in this catalog are often used alongside it:

| | CALMS | The Three Ways | DORA capabilities |
|---|---|---|---|
| What it is | Five areas to examine in a DevOps adoption | Three principles that set the direction of improvement: flow, feedback, continual learning | A catalog of practices, each with guidance on how to implement and measure it |
| Origin | Willis and Edwards (CAMS, 2010), with Lean added by Humble | Gene Kim's 2012 essay, then *The Phoenix Project* and *The DevOps Handbook* | DORA's research program, now run by Google Cloud |
| Evidence base | Practitioners' experience | Lean manufacturing and practitioners' experience | Survey research reported since 2014, which links capabilities with better delivery and organisational performance (correlations, not laws) |
| Best used for | Starting the conversation and finding the weakest area | Deciding which way to push | Choosing and measuring the next practice |

For example, DORA's *generative organizational culture* capability builds on the sociologist Ron Westrum's typology of organisational cultures, and DORA reports that a high-trust culture with good information flow predicts software delivery and organisational performance. Its catalog also covers work in process limits, visibility of work in the value stream, visual management and streamlining change approval, which map onto lean, measurement and sharing. The [Three Ways](../three-ways/) and [DORA Metrics](../dora-metrics/) pages cover those two in depth.

## Putting it into practice

1. **Put both sides in the room.** Developers, operations and, where one exists, the DevOps or platform team, plus someone who owns the business process the systems support. Pick a facilitator who isn't being scored; Acme borrowed one from the shop's SRE group.
2. **Agree the scale before scoring.** Write down what each level means for each dimension. Acme's runs from 1 (nobody does it) to 5 (everyone does it and keeps improving).
3. **Bring evidence, not opinions.** The last few incident reviews, a week of pipeline runs, the release log, the team boards, the monthly report, the chat channels. A score without evidence isn't recorded.
4. **Score one dimension at a time.** Where development and operations disagree, write down both views and the evidence behind them: the disagreement is itself a finding.
5. **Find what holds the rest back,** usually the lowest dimension. At Acme, sharing (1) and culture (2) explain why a good pipeline (4) still feeds a monthly release.
6. **Pick a few actions there, each with an owner and a date.** Acme's: blameless postmortems shared with all 40 people (October), one on-call rota for developers and operations (November), WIP limits on every team board (December) and DORA's delivery metrics on a dashboard everyone sees (January).
7. **Reassess on a schedule, with the same people and the same scale,** and compare the department with its own past. Acme's second assessment, on 8 April 2027, gave culture 3, automation 4, lean 3, measurement 4 and sharing 3: reviews now ask what failed rather than who, items in progress fell from 38 to 15, the delivery metrics are read every week, and seven postmortems have been shared in one incident channel.
8. **Go deeper where the score is low.** CALMS points at an area; other tools examine it. A [value stream map](../value-stream-mapping/) shows where work waits, DORA's Quick Check and its [five delivery metrics](../dora-metrics/) give measurement a baseline, and DORA's *How to transform* guide describes the loop that follows: understand the current condition, set a measurable target, experiment, and check again, based on Mike Rother's improvement kata.

## Where it fits

| Dimension | Related pages |
|---|---|
| Culture | [Blameless Postmortems](../blameless-postmortems/), [Incident Management](../incident-management/), [You Build It, You Run It](../you-build-it-you-run-it/) |
| Automation | [Continuous Delivery](../continuous-delivery/), [Trunk-Based Development](../trunk-based-development/), [Infrastructure as Code](../infrastructure-as-code/), [GitOps](../gitops/) |
| Lean | [Value Stream Mapping](../value-stream-mapping/), [The Three Ways](../three-ways/) (the First Way, flow), [Feature Flags](../feature-flags/) |
| Measurement | [DORA Metrics](../dora-metrics/), [SPACE & DevEx](../space-devex/), [SLOs & Error Budgets](../slo-error-budgets/), [Golden Signals](../golden-signals/) |
| Sharing | [Blameless Postmortems](../blameless-postmortems/), [Platform as a Product](../platform-as-a-product/), [Golden Paths](../golden-paths/) |

[Team Topologies](../team-topologies/) offers a way out of Acme's org chart: stream-aligned teams that build and run their own systems, and a platform team that offers the pipeline as a self-service product rather than a ticket queue. Where IT service management follows ITIL, the [ITIL 4](../itil-4/) page shows how change enablement can work with DevOps rather than against it.

## When to use it

CALMS pays off where an organisation has started a DevOps adoption and can't say why it isn't working, typically after a tool purchase or a reorganisation, when the parts that were easy to buy are done. It gives development and operations one vocabulary, takes a day or less and needs no tools. It suits large and traditional IT departments, where the conversation between the two sides is often the main result.

Adapt it where the context differs:

- **Regulated environments** need segregation of duties and an audit trail. Score how the controls are met (automated checks, peer review, the pipeline's records) rather than whether a manual approval exists.
- **Legacy and vendor systems** such as an ERP limit how far automation can go and how small a release can be. Score against what the platform allows and look for the next step, not against a cloud-native team.
- **Small teams** don't need a day: an hour around the five letters and the last few incidents is enough.

It costs more than it returns as a benchmark between teams or companies (home-made scales aren't comparable), as a certification, or as a substitute for measuring delivery. Once a team tracks DORA's metrics and runs postmortems, a value stream map or DORA's capability catalog will tell it more than another round of scores.

## Common pitfalls

- **CALMS as a maturity score to rank teams.** A league table of self-assessed scores teaches teams to argue their numbers up and hide problems. Keep the scores inside the group that produced them and compare it with its own past.
- **Automation first, and only.** Tools are the easiest part to buy, and they speed up whatever culture is already there: Acme's pipeline was its strongest dimension and changed little on its own. Start with the weakest dimension; Willis put culture first because, without it, automation achieves little.
- **The DevOps team as a new silo.** Jez Humble argued in 2012 that a separate DevOps team between development and operations is a poor way to fix the problems that silos cause, and Matthew Skelton and Manuel Pais's DevOps Topologies list it as an anti-type (DevOps Team Silo), next to an operations team that just hires or renames people as "DevOps engineers" (Rebranded SysAdmin). Let development and operations share the work and the on-call, and let a platform team offer self-service instead of a ticket queue ([Platform as a Product](../platform-as-a-product/)).
- **Measuring without sharing the results.** A dashboard that only managers see changes no one's work. Put the numbers where the teams look, review them together, and use them to find the next problem rather than someone to blame.
- **Averaging the five scores.** Acme's average rose from 2.4 to 3.4, which hides that sharing went from 1 to 3 while automation didn't move. Read the shape and its lowest point.
- **Scoring opinions.** Without evidence the scores reflect the loudest voice in the room. No evidence, no score.
- **A one-off assessment with no follow-up.** One assessment is a snapshot: the slides get filed, and nothing shows whether the actions worked. Give every action an owner and a date, and book the reassessment before the day ends.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [The Three Ways](../three-ways/) — DevOps in three principles: speed the flow of work to customers, amplify feedback back to the team, and keep learning.
- [DORA Metrics](../dora-metrics/) — Measure software delivery by throughput and stability: how often and how fast changes reach production, and how often they fail.
- [Blameless Postmortems](../blameless-postmortems/) — Learn from every incident without blame: a timeline, the contributing factors and tracked action items, shared widely.
- [Team Topologies](../team-topologies/) — Four team types and three interaction modes that organise teams around the flow of change and keep cognitive load in check.
- [Value Stream Mapping](../value-stream-mapping/) — Draw how a change travels from idea to customer, compare the time spent working with the time spent waiting, and remove the biggest wait.
- [SPACE & DevEx](../space-devex/) — Measure developer productivity without counting code: surveys and system data on satisfaction, flow, feedback loops and cognitive load.
- [Continuous Delivery](../continuous-delivery/) — Keep every change releasable: a deployment pipeline builds once, tests in stages and promotes the same artifact to production.
- [You Build It, You Run It](../you-build-it-you-run-it/) — The team that builds a service runs it in production, on call, so the people who can fix a problem hear about it first.

## References

- [John Willis — What Devops Means to Me (Chef blog, 16 July 2010)](https://www.chef.io/blog/what-devops-means-to-me)
- [John Willis — DevOps Culture (Part 1) (IT Revolution, 2012)](https://itrevolution.com/articles/devops-culture-part-1/)
- [Jez Humble and Joanne Molesky — Why Enterprises Must Adopt Devops to Enable Continuous Delivery (Cutter IT Journal, Vol. 24, No. 8, August 2011; PDF of the issue)](https://www.cutter.com/sites/default/files/itjournal/fulltext/2011/08/itj1108.pdf)
- [Atlassian — CALMS Framework](https://www.atlassian.com/devops/frameworks/calms-framework)
- [DORA — Capabilities catalog](https://dora.dev/capabilities/)
- [DORA — Capabilities: Generative organizational culture](https://dora.dev/capabilities/generative-organizational-culture/)
- [DORA — Capabilities: Work in process limits](https://dora.dev/capabilities/wip-limits/)
- [DORA — Software delivery performance metrics](https://dora.dev/guides/dora-metrics/)
- [DORA — How to transform your organization](https://dora.dev/guides/how-to-transform/)
- [DORA — Quick Check](https://dora.dev/quickcheck/)
- [Gene Kim — The Three Ways: The Principles Underpinning DevOps (IT Revolution, 2012)](https://itrevolution.com/articles/the-three-ways-principles-underpinning-devops/)
- [Jez Humble — There's No Such Thing as a "Devops Team" (2012)](https://continuousdelivery.com/2012/10/theres-no-such-thing-as-a-devops-team/)
- [Matthew Skelton and Manuel Pais — DevOps Topologies](https://web.devopstopologies.com/)
- [Google SRE Book — Postmortem Culture: Learning from Failure (chapter 15)](https://sre.google/sre-book/postmortem-culture/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
