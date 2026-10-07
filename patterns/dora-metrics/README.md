
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧭 DevOps & SRE Principles](../../README.md#devops--sre-principles)

# DORA Metrics

> Measure software delivery by throughput and stability: how often and how fast changes reach production, and how often they fail.

<p align="center"><img src="diagram.svg" alt="Animated diagram: DORA Metrics" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/dora-metrics.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · No shared numbers** | In January the checkout team ships one release a month. Release 2026.01 carried 46 changes and needed a hotfix, like 4 of the last 10 releases, and fixing it took about 6 hours. The status report counts story points and lines of code, both rising, so the team argues about whether it is getting faster and nobody can show it either way. |
| **2 · Five delivery metrics** | By September the team reads DORA's five metrics from its own records. Change a91f was committed on Monday at 09:10 and running in production on Tuesday at 11:20, a **change lead time** of 26 hours, the month's median. The deploy log and the incident tracker give the rest: 20 production deployments (**deployment frequency**), 3 that needed immediate intervention (**change fail rate** 15%), a median **failed deployment recovery time** of 45 minutes, and 2 unplanned deployments to fix a user-facing bug (**deployment rework rate** 10%). |
| **3 · Track and improve** | DORA groups the metrics into **throughput** (lead time, deployment frequency, recovery time) and **instability** (change fail rate, rework rate), and its surveys keep finding that, for most teams, speed and stability go together rather than trading off. The checkout team collects the numbers automatically from CI/CD and the incident tool and compares each quarter with its own past: as trunk-based development, CI with test automation and more loosely coupled services shrank each deployment from about 40 changes to about 2, deployments rose from 1 to 20 a month and the fail rate fell from 40% to 15%. |
| **4 · Gamed and misread** | In October management sets a target of 40 deploys a month and a fail rate under 5%, and both are met without shipping anything sooner: each change goes out in two deployments and two failures are filed as planned maintenance (Goodhart's law at work). Ranking teams against each other (the mobile app ships through app store review), scoring individual engineers, or reading the numbers without the work behind them and the team's well-being misleads in the same way. |
<!-- END GENERATED: header -->

## The problem

Ask whether a team is getting faster and you usually get opinions. The numbers at hand count activity: story points, tickets closed, lines of code. They rise when people are busy, they are easy to inflate, and they say nothing about whether changes reach users or what happens when they do. Meanwhile the delivery process hides its own costs. A monthly release train gathers weeks of work into one big batch, so a change waits days or weeks for the next release, every release is risky, and a failure means searching dozens of changes while customers wait. Without shared numbers about outcomes, a team can't tell whether a new practice helped, and the conversation with management stays a matter of belief.

## How it works

**DORA** is a long-running research program on software delivery. It grew out of the State of DevOps reports, published with Puppet until 2018; Nicole Forsgren, Jez Humble and Gene Kim founded it as a company, DevOps Research and Assessment, and set out the research behind it in *Accelerate: The Science of Lean Software and DevOps* (IT Revolution, 2018). Google acquired DORA in 2018, and the program now runs at Google Cloud. In 2025 it stopped spelling out the acronym and renamed its yearly report from *Accelerate State of DevOps* to *State of AI-assisted Software Development*.

DORA's metrics measure the outcome of the delivery process for one application or service. The current set has five metrics in two groups (definitions from dora.dev, paraphrased):

| Group | Metric | What it measures | Acme checkout, September |
|---|---|---|---|
| Throughput | **Change lead time** | Time from a change being committed to version control until it runs in production | 26 h (median) |
| Throughput | **Deployment frequency** | Number of production deployments in a period, or the time between them | 20 |
| Throughput | **Failed deployment recovery time** | Time to recover from a deployment that failed and needed immediate intervention | 45 min (median) |
| Instability | **Change fail rate** | Share of deployments that need immediate intervention afterwards, such as a rollback or a hotfix | 15% (3 of 20) |
| Instability | **Deployment rework rate** | Share of deployments that were unplanned and made because of an incident in production | 10% (2 of 20) |

The set has changed over the years (DORA published its own history of the metrics in January 2026). The 2014 study started from four measures, and by 2015 they had settled into the throughput and stability pair later called the four keys. In 2023 *mean time to recover* (or *time to restore service*) became **failed deployment recovery time**, which counts only failures caused by a change, not outages from outside such as a data centre going down. In 2024 DORA added **rework rate** and regrouped the five into two factors, throughput and stability (today's materials call the second one instability), with recovery time moving to the throughput side. Many tools and articles still use the older names.

The best-known finding is about how the two groups relate. Year after year DORA has found that speed and stability are not a trade-off: for most teams the metrics move together, and the strongest performers do well on all of them. That is a correlation across thousands of survey answers, not a law for any one team. The 2024 report's medium cluster had a lower change fail rate than its high cluster, and the 2025 report found that AI adoption now goes with higher throughput but still with more instability, which is why the two groups are read together.

The benchmarks have changed too. Up to 2024 each report sorted respondents into performance clusters. In the 2024 report the elite cluster (19% of respondents) deployed on demand, with a lead time under a day, a 5% change fail rate and recovery in under an hour, while the low cluster (25%) deployed between once a month and once every six months, with a 40% change fail rate. The 2025 report dropped the tiers. It shows how the answers for each metric are spread instead (16.2% of respondents deploy on demand; the most common lead time, given by 31.9%, is between a day and a week) and describes seven team profiles from a cluster analysis that also takes in burnout, friction and product performance, from *harmonious high-achievers* to the *legacy bottleneck*. The DORA Quick Check, updated in April 2026 to include rework rate, scores a service against the 2025 data, but DORA itself says the most useful comparison is the same service over time.

The metrics are outcomes: they show what is happening, not why. For the why, DORA keeps a **capability catalog** on dora.dev, the technical, process and cultural capabilities its research links to better delivery and organizational performance. Examples are continuous integration, trunk-based development, test automation, deployment automation, loosely coupled teams (an architecture that lets a team test and deploy without waiting for others), working in small batches and streamlined change approval. Culture is one of them. DORA uses Ron Westrum's typology of organisational cultures (2004), which sorts organisations by how information flows through them: *pathological* (power-oriented, messengers are punished), *bureaucratic* (rule-oriented, messengers are neglected) and *generative* (performance-oriented, messengers are trained and failure leads to inquiry). In DORA's research a generative, high-trust culture predicts better software delivery and organizational performance.

## Putting it into practice

1. **Pick one service and the team that owns it.** DORA's metrics are meant for one application or service at a time. Acme starts with checkout, measured for the checkout team.
2. **Write the rules down before collecting anything.** Decide what a deployment is (for Acme, a successful production rollout of the checkout service: hotfixes count, rollbacks are part of a recovery rather than deployments), what a failure is (a deployment that needed immediate intervention: a rollback, a hotfix, a fix forward or a patch), when the recovery clock starts and stops (from the failed deployment until the service is healthy again), and what rework is (an unplanned deployment made to fix a user-facing bug). Tools disagree on these details: GitLab measures time to restore as the time an incident stays open, Apache DevLake from the end of the deployment to the incident's resolution. Choose one rule and keep it.
3. **Collect from the systems of record, not from people.** Each deployment event from CI/CD carries the Git SHA it shipped, Git gives the commit time of every change in it, and the incident tool records which deployment caused an incident and when service came back. Google's open-source Four Keys project (2020, now archived) showed the shape: three tables, *changes*, *deployments* and *incidents*, joined by commit. GitLab (Ultimate tier) and Apache DevLake compute four of the five metrics, all but rework rate, from their own data; a few SQL queries over exported events work too.
4. **Report medians and look at the spread.** Lead and recovery times are skewed, so one stuck change shouldn't hide that most go out within a day. Use a month or a quarter as the period, and remember that with few deployments a percentage jumps: one failure in four deployments is 25%.
5. **Compare with your own past, quarter by quarter.** The table below is the checkout team's trend.
6. **Improve capabilities, not numbers.** Find the biggest constraint (for checkout in January, the release train), change how the team works, and check whether the numbers follow. DORA's guide describes the same loop: a baseline, a conversation about the friction, one improvement the whole team commits to, then a check. Leading indicators help in between, such as review time, flaky tests, or how long a change waits for a deploy: change a91f spent 20 of its 26 hours waiting for Tuesday's 11:00 deploy, which makes deploying on merge the next experiment.
7. **Review them with the team.** Put the five numbers in the retrospective, next to what the quarter held (a migration, a month heavy with on-call) and how the team is doing.

The checkout team's quarters, with the example's own numbers (not research findings):

| | Before (last 10 releases) | Q1 2026 | Q2 2026 | Q3 2026 |
|---|---|---|---|---|
| Deployments a month | 1, plus hotfixes | 3 | 8 | 20 |
| Changes per deployment | about 40 | 15 | 6 | 2 |
| Change lead time (median) | 18 days | 9 days | 4 days | 26 hours |
| Change fail rate | 40% | 33% | 21% | 15% |
| Failed deployment recovery time (median) | 6 hours | 4 hours | 2 hours | 45 minutes |
| What the team changed | a monthly release train | trunk-based development and CI | test automation | loosely coupled services, a daily deploy |

## Where it fits

- **[Continuous delivery](../continuous-delivery/)** and **[trunk-based development](../trunk-based-development/)** are the capabilities that move these numbers most directly: small changes merged every day and a pipeline that can deploy any of them. The DORA metrics are how you see whether they work.
- **Release patterns make failures smaller and recovery faster.** A [canary release](../canary-release/) or a [blue-green deployment](../blue-green-deployment/) turns many failures into a quick rollback, which shortens recovery, and [feature flags](../feature-flags/) separate deploying from releasing, so unfinished work can ship in small batches.
- **[SLOs and error budgets](../slo-error-budgets/)** measure something else: how reliable the service is for its users. DORA's metrics measure the team's delivery process. A team can deploy daily with a low change fail rate and still miss its SLO because of capacity or a dependency, so most teams watch both; DORA itself treats reliability as operational performance, separate from delivery performance.
- **[Incident management](../incident-management/)** and **[blameless postmortems](../blameless-postmortems/)** produce the data that change fail rate and recovery time need (each incident linked to the deployment that caused it, with the time service was restored), and the postmortems explain what the numbers can't.
- **[The Three Ways](../three-ways/)** describe DevOps as flow, feedback and continual learning. The throughput metrics measure the flow, and the instability metrics measure what comes back.
- With **[GitOps](../gitops/)** the deploy log already exists: the history of the environment repository and the controller's sync events.
- Other frameworks cover what these metrics leave out. SPACE (Forsgren, Storey and colleagues, ACM Queue, 2021) looks at developer productivity across satisfaction and well-being, performance, activity, communication and collaboration, and efficiency and flow, and argues that no single number can capture it. DevEx (Noda, Storey, Forsgren and Greiler, ACM Queue, 2023) centres on how developers experience their work, through feedback loops, cognitive load and flow state. DORA's own advice is to choose the framework that fits the decision you need to make, and to combine frameworks when one of them can't answer the question on its own.

## When to use it

- **A team that owns a service and deploys it through a pipeline it controls.** The data already sits in Git, CI/CD and the incident tool, so once the rules are set the numbers cost little, and they turn arguments about speed into a shared baseline.
- **Before and after a change in how you work.** Leaving a release train, adopting trunk-based development or splitting a monolith: the metrics show whether delivery really improved and whether stability paid for it.
- **Less useful with very few deployments.** A service that changes a few times a year gives percentages that jump with every failure; look at lead time and at each failure instead.
- **Adapt it where the release isn't yours to control.** Mobile apps go through store review and staged rollouts, on-premises and embedded software ships on the customer's schedule, and regulated changes may need an approval. Measure up to the release to users, keep the approval wait inside the lead time where everyone can see it (streamlining change approval is a DORA capability of its own), and compare such a service only with its own past.
- **Not worth an early integration project.** DORA's guide warns against spending more on precise measurement than on improvement: a team conversation or the Quick Check gives a first baseline, and the automation can follow.

## Common pitfalls

- **Turning the metrics into targets.** A target on a number invites people to move the number rather than the work (Goodhart's law): changes split into extra deployments, failures filed as maintenance, fixes rushed out to lift a count. DORA's guide gives a blanket mandate, every application deploying several times a day by the end of the year, as an example of a goal that invites gaming. Use the metrics to find the next constraint, set goals on capabilities, and read all five together: deployment frequency doubling while lead time stays put, as in step 4, is the tell.
- **Ranking teams against each other.** The metrics describe one service's delivery, and services differ: Acme's mobile app ships through app store review, so its 2 deployments a month say nothing bad about the mobile team. Compare each service with its own past, and share what worked instead of publishing a leaderboard.
- **Measuring individuals.** Deployments and incidents belong to a team's system, not to one engineer. Per-person counts reward splitting work and avoiding risky fixes, and they erode the trust a generative culture depends on. Keep the metrics at team and service level.
- **One metric to rule them all.** Deployment frequency alone rewards splitting, and change fail rate alone rewards deploying less. DORA's guide recommends several measures with some tension between them, and the five provide it.
- **Measuring without acting.** A dashboard nobody discusses changes nothing. Review the numbers in retrospectives, commit to one improvement, and check again next quarter.
- **Reading the numbers without context.** A quarter spent on a database migration, a hiring freeze or a run of night pages will show in the numbers. Read them next to what the work was and how the team is doing (DORA's own surveys measure burnout alongside delivery); a good-looking dashboard with an exhausted team is not a success.
- **Changing the rules halfway.** If what counts as a deployment or a failure changes between quarters, the trend means nothing. Keep the definitions in version control with the queries that use them.
- **Hiding behind the industry.** Regulated and legacy environments make some numbers harder to move, but DORA's guide says the metrics fit any kind of system, mainframes included. Start with the slowest step the team controls.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Continuous Delivery](../continuous-delivery/) — Keep every change releasable: a deployment pipeline builds once, tests in stages and promotes the same artifact to production.
- [Trunk-Based Development](../trunk-based-development/) — Everyone merges small changes into one main branch at least daily; feature flags hide unfinished work instead of long branches.
- [The Three Ways](../three-ways/) — DevOps in three principles: speed the flow of work to customers, amplify feedback back to the team, and keep learning.
- [SLOs & Error Budgets](../slo-error-budgets/) — Measure SLIs against an objective and alert on error-budget burn rate, not on every blip.
- [Incident Management](../incident-management/) — A practised response when production breaks: declare early, assign roles, mitigate first and keep everyone informed.
- [Blameless Postmortems](../blameless-postmortems/) — Learn from every incident without blame: a timeline, the contributing factors and tracked action items, shared widely.
- [Canary Release](../canary-release/) — Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back.
- [Feature Flags](../feature-flags/) — Deploy code dark, then turn features on per user or percentage at runtime.
- [Blue-Green Deployment](../blue-green-deployment/) — Run the new version beside the old one and switch all traffic in one step.

## References

- [DORA — DORA’s software delivery performance metrics](https://dora.dev/guides/dora-metrics/)
- [DORA — A history of DORA’s software delivery metrics (Nathen Harvey, 2026)](https://dora.dev/insights/dora-metrics-history/)
- [DORA — State of AI-assisted Software Development 2025 (the 2025 DORA report)](https://dora.dev/research/2025/dora-report/)
- [DORA — Accelerate State of DevOps Report 2024](https://dora.dev/research/2024/dora-report/)
- [DORA — 2025: Year in review](https://dora.dev/insights/dora-2025-year-in-review/)
- [DORA — Capability catalog](https://dora.dev/capabilities/)
- [DORA — Capabilities: Generative organizational culture](https://dora.dev/capabilities/generative-organizational-culture/)
- [DORA — Quick Check updates (2026)](https://dora.dev/insights/quickcheck-updates/)
- [DORA — Choosing measurement frameworks to fit your organizational goals](https://dora.dev/insights/measurement-frameworks/)
- [Nicole Forsgren, Jez Humble and Gene Kim — Accelerate (IT Revolution, 2018)](https://itrevolution.com/product/accelerate/)
- [Ron Westrum — A typology of organisational cultures (Quality and Safety in Health Care, 2004)](https://pmc.ncbi.nlm.nih.gov/articles/PMC1765804/)
- [Google Cloud Blog — Use Four Keys metrics like change failure rate to measure your DevOps performance (2020)](https://cloud.google.com/blog/products/devops-sre/using-the-four-keys-to-measure-your-devops-performance)
- [GitLab Docs — DevOps Research and Assessment (DORA) metrics](https://docs.gitlab.com/user/analytics/dora_metrics/)
- [Apache DevLake — DORA](https://devlake.apache.org/docs/DORA/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
