
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧭 DevOps & SRE Principles](../../README.md#devops--sre-principles)

# SPACE & DevEx

> Measure developer productivity without counting code: surveys and system data on satisfaction, flow, feedback loops and cognitive load.

<p align="center"><img src="diagram.svg" alt="Animated diagram: SPACE &amp; DevEx" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/space-devex.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Activity as productivity** | Acme hired 15 engineers in a year (45 to 60), yet production deploys went only from 40 to 41 a week, so the CTO asks for productivity numbers and a manager proposes a leaderboard of commits, pull requests and lines of code per engineer. It rewards activity that is easy to inflate (Tom splits one fix into 14 commits, Ana's 11,800 lines include a generated client) and counts Ben's 58 reviews, Mai's two weeks of pairing with new hires and Priya's on-call week as nothing. It sees one of SPACE's five dimensions, and nobody has asked the engineers what slows them down. (Acme's numbers are the example's own.) |
| **2 · SPACE: what to measure** | The platform team drops the leaderboard and uses **SPACE** (Forsgren, Storey, Maddila, Zimmermann, Houck and Butler, 2021) to choose what to measure across its five dimensions: **satisfaction and well-being**, **performance**, **activity**, **communication and collaboration**, and **efficiency and flow**. The paper recommends measures from at least three dimensions, at least one of them a perception from a survey, reported as anonymous team results, so Acme takes one survey and one system measure for each of the five and never reports per person. In Q2, 52 of the 60 engineers answer the survey (satisfaction 3.1 of 5, 1.8 hours of focus a day), and the systems give a 15% change fail rate, 42 deploys a week, 22 hours to a first review and a 38-minute CI run. |
| **3 · DevEx: fix the friction** | The same survey asks about the three dimensions of **DevEx** (Noda, Storey, Forsgren and Greiler, 2023). **Feedback loops**: waiting for CI, 38 minutes a run, is the top pain for 31 of 52; **cognitive load**: a new service needs five tools, and 27 of 52 find that hard; **flow state**: meetings break up the day, leaving 1.8 hours of focus. Test sharding and a build cache cut CI to 12 minutes, the golden path in Launchpad replaces the five tools with one template, and mornings become meeting-free. In the Q3 survey (55 of 60 answers) satisfaction is 3.6 and focus 3.1 hours a day, and deploys rise from 42 to 49 a week while the change fail rate holds (15% to 14%). |
| **4 · Pitfalls and limits** | In October a director asks for each engineer's survey scores, but the answers are anonymous and results are shown only for teams with at least five answers. The board deck folds the five dimensions into one productivity score of 72, which hides what moved and why. The search team never heard back about its Q2 results, so only 2 of its 6 engineers answered in Q3; a slide ranks payments last on satisfaction although its changes wait for PCI approval; and the CI chart says 12 minutes while the answers say flaky tests force re-runs, which only shows when survey and system data are read together. |
<!-- END GENERATED: header -->

## The problem

When a company grows and delivery doesn't speed up with it, someone asks for productivity numbers, and the numbers that are easiest to get count activity: commits, pull requests, lines of code, tickets closed. The tools already record them, which is their appeal, but they measure motion rather than progress. They climb when work is chopped into small pieces, when code is generated or copied, or when people put in long hours to get around a slow system, and they drop for the work that keeps a team going: reviewing, pairing with new hires, writing design documents, being on call. Ranked per person on a leaderboard, they also teach people quickly what moves their rank. The questions that matter stay unanswered: what slows the engineers down, how they are doing, and whether customers get better software sooner. Delivery metrics such as DORA's help with the last question, but they describe a team's pipeline, not the daily friction behind it.

## How it works

Two frameworks, written by overlapping groups of researchers and published in ACM Queue two years apart, answer the question in complementary ways. SPACE describes what developer productivity is made of, so that a team can choose a balanced set of measures. DevEx looks at productivity from the developer's side and points to the friction worth removing.

### SPACE (2021)

*The SPACE of Developer Productivity* by Nicole Forsgren (then at GitHub), Margaret-Anne Storey (University of Victoria), and Chandra Maddila, Thomas Zimmermann, Brian Houck and Jenna Butler (Microsoft) appeared in ACM Queue, vol. 19, no. 1, in 2021. It opens by taking apart five common beliefs: that productivity is all about developer activity, that it is only about individual performance, that one metric can capture it, that productivity measures are only for managers, and that it is only about engineering systems and tools. It then names five dimensions (descriptions paraphrased):

| Dimension | What it covers | Examples the paper gives |
|---|---|---|
| **S**atisfaction and well-being | Whether developers find their work, team, tools and culture fulfilling, and how their health and happiness hold up | Satisfaction, having the tools and resources to do the work, burnout |
| **P**erformance | What the work achieves, judged by its results rather than by how much was produced | Quality (reliability, absence of bugs, service health) and impact (customer satisfaction, adoption, feature usage, cost reduction) |
| **A**ctivity | Things people do or produce that can be counted | Design documents, pull requests, commits and reviews; builds, tests and deployments; incidents and on-call participation |
| **C**ommunication and collaboration | How well people and teams talk, coordinate and help each other | How easily documentation and experts can be found, how quickly work is integrated, review quality, onboarding time |
| **E**fficiency and flow | Whether work keeps moving without stops and waits, for one person and across the system | Handoffs, the perceived ability to stay in flow, interruptions, and the total, value-added and waiting time through a system |

The paper's advice on using the dimensions, paraphrased:

- **Several dimensions at once.** Pick metrics from at least three dimensions, and don't pad the set with more of the same kind: commits, pull requests and coding time are all activity. Metrics shape behaviour, so a set with some tension in it (more speed against fewer bugs reaching customers) keeps any one of them from being optimised alone. Keep it to a handful; a long list of targets confuses people and wears them down.
- **Perception next to system data.** Include at least one perceptual measure, such as survey answers; what people experience often shows what instrumentation can't. Ask people about their own experience (did you feel productive, could you focus) rather than asking them to rate their team.
- **Levels and privacy.** A metric can describe one person, a team or group, or the whole system. Report anonymous aggregates at the team or group level (the paper notes that reporting individual productivity isn't legal in some countries); individual data is useful to the developer it describes, not to a ranking.
- **Biases.** Check what could skew the numbers: normalising over a long period penalises people who took parental leave, and some cultures answer surveys systematically higher or lower than others, so their scores have different baselines and shouldn't be compared directly.

The paper links efficiency and flow at the team and system level to value-stream mapping, and it cites DORA's deployment frequency and lead time as examples of flow measures.

### DevEx (2023)

*DevEx: What Actually Drives Productivity* by Abi Noda (DX), Margaret-Anne Storey (University of Victoria), Nicole Forsgren (Microsoft Research) and Michaela Greiler (DX) appeared in ACM Queue, vol. 21, no. 2, in 2023. It treats developer experience as what developers live through at work, from their feelings about it to the friction they hit every day, and it builds on the authors' earlier research, which found more than 25 sociotechnical factors behind it. The paper condenses them into three dimensions:

- **Feedback loops**: how fast and how well tools and people respond to what a developer does, from builds and tests to code review and deployment. Slow loops make people wait or switch tasks.
- **Cognitive load**: the mental effort a task demands. Poorly documented code and systems and a growing pile of tools push it up.
- **Flow state**: being fully absorbed in focused work. Interruptions, unplanned work and scattered meetings break it.

Tools are only part of the story: the paper reports that human factors, such as clear project goals and feeling psychologically safe in the team, have a large effect too.

For measurement, the paper pairs two kinds of data for each dimension: developers' **perceptions** (their attitudes and opinions, mostly from surveys) and their **workflows** (data from systems and processes), because each kind misses what the other sees. Code review can look fast in the data and still feel disruptive if it keeps interrupting focused work. Above these sit a few **KPIs**, the north-star outcomes that improvements are meant to move, such as productivity, satisfaction, engagement and retention. They keep a local fix honest: cutting meetings can add focus time and still hurt collaboration and overall satisfaction. On surveys, the paper recommends questions built on well-defined concepts and tested in interviews, results broken down by team and by persona (role, tenure, seniority) rather than read as company-wide averages, comparison with benchmarks for context, short transactional surveys at specific moments in the workflow, and follow-up after every survey, because participation drops when people see nothing happen. For most organisations it suggests running the survey every quarter or every six months.

### How they relate to each other and to DORA

- **SPACE chooses the measures; DevEx finds the friction.** Acme uses SPACE to pick a balanced scorecard across five dimensions and reads the same survey through DevEx's three dimensions to decide what to fix. Both papers ask for perception and system data side by side.
- **DORA measures delivery outcomes.** [DORA's metrics](../dora-metrics/) describe a service's delivery process: throughput (change lead time, deployment frequency, failed deployment recovery time) and instability (change fail rate, deployment rework rate). They show whether delivery got better, not how the work feels or where developers lose time, so many organisations read them next to a SPACE or DevEx survey. DORA's 2025 guide to measurement frameworks (Sarah D'Angelo, Ambar Murillo, Sarah Inman and Kevin M. Storer) suggests starting from the decision the numbers should inform, weighing self-reported against log-based data (self-reports capture experience but are hard to standardise and compare across teams; logs scale but need instrumentation and are less objective than they look), and combining frameworks when one alone can't answer the question.
- **Combined frameworks.** DX, the company Abi Noda founded, publishes the **DX Core 4** (by Abi Noda, Laura Tacho, Margaret-Anne Storey and Michaela Greiler), which folds DORA, SPACE and DevEx into four dimensions: speed, effectiveness, quality and business impact. Its own guidance warns that its throughput metric, diffs per engineer, has to be balanced by experience measures and never tied to targets or rewards.
- **Goodhart's law** applies to all of them: once a measure becomes a target, it stops being a good measure. The idea is named after the economist Charles Goodhart, who described it for monetary policy in 1975; the wording most people quote appeared in a 1997 paper by the anthropologist Marilyn Strathern.

## Putting it into practice

1. **Start from the question and the decision.** Acme's CTO wanted to know why 15 more engineers brought no speed-up; the decision behind it was where to invest the next quarter. Write both down before choosing a metric.
2. **Choose a handful of measures across at least three SPACE dimensions, with at least one from a survey, reported per team.** Acme took one survey measure and one system measure for each of the five (below) and agreed in advance that nothing would be reported per person.
3. **Run a short, anonymous survey on a fixed rhythm.** Acme runs it every quarter and keeps it to about ten minutes. The questions ask about each person's own last few weeks (how long did you wait for CI, how many hours could you focus) and were tried out on a few engineers first. Results are shown per team and per role only where at least five people answered, and smaller groups are merged (Acme's rule). Track the response rate: 52 of 60 answered in Q2.
4. **Pull the system data you already have.** CI run times from the CI system (GitHub Actions, GitLab CI or Jenkins, say), review waits from the Git host, deploys from the deploy log, night pages from the paging tool, and meeting load from calendar data aggregated per team. Write down how each number is computed, and keep it the same from quarter to quarter.
5. **Read the answers through DevEx.** For each dimension, find the biggest friction and check it against the system data. Acme's survey named slow CI (the top pain for 31 of 52), the five tools a new service needs (hard for 27 of 52) and scattered meetings (1.8 hours of focus a day), and the CI data agreed: 38 minutes a run.
6. **Fix a few things, with owners.** The platform team cut CI to 12 minutes with test sharding and a build cache and made the [golden path](../golden-paths/) in Launchpad the way to start a service, and the engineering managers agreed on meeting-free mornings.
7. **Close the loop and measure again.** Acme shared each team's results within three weeks, said what would change and when, and compared the next quarter with this one (below).
8. **Watch the counterweights.** When a change helps one measure, check the ones it could hurt. Meeting-free mornings could make help harder to get, so Acme watched *ease of getting help* and the wait for a first review; faster CI could let more failures through, so it watched the change fail rate.

Acme's measures, with the Q2 2026 baseline (the example's own numbers, not research findings):

| SPACE dimension | Survey measure | System measure |
|---|---|---|
| Satisfaction and well-being | Satisfaction with work: 3.1 of 5 | Pages at night: 14 a month |
| Performance | Rated quality of the code the team ships: 3.2 of 5 | Change fail rate: 15% |
| Activity | Self-reported coding time: 14 h a week | Production deploys: 42 a week |
| Communication and collaboration | Ease of getting help: 2.8 of 5 | Wait for a first review: 22 h (median) |
| Efficiency and flow | Uninterrupted focus time: 1.8 h a day (median) | CI run: 38 min (median) |

Quarter by quarter (the example's own numbers):

| | Q1 2026 | Q2 2026 | Q3 2026 |
|---|---|---|---|
| Survey answers | no survey | 52 of 60 | 55 of 60 |
| Satisfaction (1 to 5) | not asked | 3.1 | 3.6 |
| CI run (median) | not tracked | 38 min | 12 min |
| Setting up a new service | not tracked | 5 tools | 1 template |
| Focus time a day (median) | not asked | 1.8 h | 3.1 h |
| Ease of getting help (1 to 5) | not asked | 2.8 | 2.9 |
| Wait for a first review (median) | not tracked | 22 h | 20 h |
| Production deploys a week | 41 | 42 | 49 |
| Change fail rate | not tracked | 15% | 14% |
| What changed | a per-engineer leaderboard, proposed and dropped | the first survey, results shared with every team | test sharding and a build cache, the golden path, meeting-free mornings |

## Where it fits

- **[DORA metrics](../dora-metrics/)** measure what comes out of the delivery pipeline; SPACE and DevEx measure the experience and productivity behind it. Read them together: Acme's deploys went from 42 to 49 a week after CI got faster, and the change fail rate showed that stability held.
- **[Platform as a product](../platform-as-a-product/)** needs exactly this kind of data. The developer survey is how a platform team learns what hurts, and DevEx measures such as CI wait, setup effort and focus time show whether the platform helped.
- **[Golden paths](../golden-paths/)** are a direct answer to cognitive load: Acme's five tools for a new service became one template.
- **[Team Topologies](../team-topologies/)** uses a team's cognitive load as a limit when drawing team boundaries; DevEx asks about the same load from each developer's side.
- **[Eliminating toil](../eliminating-toil/)** frees time and attention: repetitive manual work and night pages show up as lost flow and poorer well-being.
- **[Continuous delivery](../continuous-delivery/)** and **[trunk-based development](../trunk-based-development/)** shorten feedback loops with fast CI and small changes that are quick to review.
- **[The Three Ways](../three-ways/)** describe flow, feedback and continual learning; SPACE's efficiency and flow and DevEx's feedback loops are ways to measure the first two.
- **[Value stream mapping](../value-stream-mapping/)** is where SPACE itself points for efficiency and flow at the team and system level: it shows where work waits.
- **[CALMS](../calms/)** counts measurement among the things to assess in a DevOps adoption; SPACE and DevEx fill in that measurement for the developer side.

## When to use it

- **When leadership asks for productivity numbers.** A SPACE scorecard gives an answer that doesn't rank people, and a DevEx reading of the same survey turns it into a list of things to fix.
- **Before and after an investment in tooling, a platform or a way of working.** Faster CI, a golden path or a new review practice should show up in both the answers and the system data; if only one of them moves, look closer.
- **From a few teams up.** In a single team of five or six, a retrospective gives the same signal for less effort, and answers can't stay anonymous when a result covers only a handful of people.
- **Not for performance reviews or pay.** Once survey answers or activity counts feed individual evaluations, people stop answering honestly and start working the numbers.
- **Agree on the rules first where privacy law or employee representatives have a say.** SPACE notes that reporting individual productivity isn't legal in some countries. Settle what is collected, how it is aggregated and who sees it before the first survey goes out.
- **Only when someone will act on the results.** A survey costs every engineer's time each quarter (about ten minutes times 60 people at Acme), and the follow-up needs an owner. If nobody will act, the survey teaches people that answering is pointless.

## Common pitfalls

- **Ranking individuals.** Per-person leaderboards and survey scores punish the people who review, pair, mentor and carry the pager, invite gaming and end honest answers. Keep answers anonymous, report per team with a minimum group size (Acme's is five), and leave individual data to the person it describes.
- **One number for productivity.** An index that averages everything into one score, like the 72 in Acme's board deck, hides which dimension moved and why, and invites optimising the index. Show the dimensions side by side and talk about what changed.
- **Surveys with no action.** When results disappear, participation falls (the search team went from 6 answers to 2), and below the minimum group size a team gets no result at all. Share results within weeks, commit to one or two fixes, and say in the next survey what changed.
- **Comparing teams that do different work.** Payments waits for PCI approvals and the mobile app for app store review, so their scores reflect the work as much as the team. Compare each team with its own past, and use benchmarks for context only.
- **Only survey data, or only system data.** Acme's CI chart said 12 minutes while the answers said flaky tests forced re-runs; a survey alone, on the other hand, can't say how long CI takes or where the wait sits. Read each kind against the other and dig in where they disagree.
- **Turning measures into targets.** A target on commits, deploys or a satisfaction score invites moving the number instead of the work (Goodhart's law). Set goals on the friction to remove, and use the measures to check whether it went away.
- **Measuring too much.** Long surveys and dashboards with dozens of charts tire people and bury the signal. Keep a handful of measures and a survey people can finish in about ten minutes.
- **Ignoring bias and context.** A quarter heavy with incidents or a reorganisation, long leave, or a group that answers surveys more modestly will move the numbers. Read them with their context, and keep the questions and definitions stable so the trend means something.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [DORA Metrics](../dora-metrics/) — Measure software delivery by throughput and stability: how often and how fast changes reach production, and how often they fail.
- [Platform as a Product](../platform-as-a-product/) — An internal developer platform run like a product: developers are its customers, self-service is its interface, adoption is earned.
- [Golden Paths](../golden-paths/) — A paved, supported route for common tasks: one template creates a service with its pipeline, infrastructure and monitoring.
- [Team Topologies](../team-topologies/) — Four team types and three interaction modes that organise teams around the flow of change and keep cognitive load in check.
- [Eliminating Toil](../eliminating-toil/) — Find the manual, repetitive operations work that grows with the system, measure it, cap it and automate it away.
- [Value Stream Mapping](../value-stream-mapping/) — Draw how a change travels from idea to customer, compare the time spent working with the time spent waiting, and remove the biggest wait.
- [The Three Ways](../three-ways/) — DevOps in three principles: speed the flow of work to customers, amplify feedback back to the team, and keep learning.
- [Trunk-Based Development](../trunk-based-development/) — Everyone merges small changes into one main branch at least daily; feature flags hide unfinished work instead of long branches.
- [Continuous Delivery](../continuous-delivery/) — Keep every change releasable: a deployment pipeline builds once, tests in stages and promotes the same artifact to production.
- [CALMS](../calms/) — A lens for assessing a DevOps adoption: culture, automation, lean, measurement and sharing, and the dimension that holds the others back.

## References

- [Nicole Forsgren, Margaret-Anne Storey, Chandra Maddila, Thomas Zimmermann, Brian Houck and Jenna Butler — The SPACE of Developer Productivity (ACM Queue, vol. 19, no. 1, 2021)](https://dl.acm.org/doi/10.1145/3454122.3454124)
- [Microsoft Research — The SPACE of Developer Productivity: There's more to it than you think](https://www.microsoft.com/en-us/research/publication/the-space-of-developer-productivity-theres-more-to-it-than-you-think/)
- [Abi Noda, Margaret-Anne Storey, Nicole Forsgren and Michaela Greiler — DevEx: What Actually Drives Productivity (ACM Queue, vol. 21, no. 2, 2023)](https://dl.acm.org/doi/10.1145/3595878)
- [DX — DevEx: What Actually Drives Productivity (paper page)](https://getdx.com/research/devex-what-actually-drives-productivity/)
- [DX — Measuring developer productivity with the DX Core 4](https://getdx.com/research/measuring-developer-productivity-with-the-dx-core-4/)
- [DORA — Choosing measurement frameworks to fit your organizational goals (2025)](https://dora.dev/insights/measurement-frameworks/)
- [DORA — DORA’s software delivery performance metrics](https://dora.dev/guides/dora-metrics/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
