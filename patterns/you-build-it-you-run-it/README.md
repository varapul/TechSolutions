
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧭 DevOps & SRE Principles](../../README.md#devops--sre-principles)

# You Build It, You Run It

> The team that builds a service runs it in production, on call, so the people who can fix a problem hear about it first.

<p align="center"><img src="diagram.svg" alt="Animated diagram: You Build It, You Run It" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/you-build-it-you-run-it.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Thrown over the wall** | Acme's payments developers hand each release to a central **operations team**. Release 2.8.0 leaks memory, so every night the pods are OOMKilled and payments fail; operations restart the pods by hand at 02:10 and file ticket OPS-4127, which the developers first see four days later and which then bounces back and forth for three weeks. The people who could fix the leak are never paged, and the people paged every night can't change the code. |
| **2 · The team takes the pager** | The **payments team** (7 engineers) now owns the service in production: its pipeline, dashboard, alert rules, runbook and on-call rotation, built on the platform team's shared tooling. At 02:10 the alert pages Mia, the payments on-call engineer; the team's own dashboard shows memory climbing since deploy 2.8.0, so she rolls back to 2.7.4 at 02:21. The next morning the team fixes the leak and ships 2.8.1, because the next page would wake one of them. |
| **3 · Make on-call sustainable** | The 7 payments engineers take the weekly primary shift and share the secondary with the 7 engineers of checkout, so each is on call about 21% of weeks, under the 25% cap in Google's *SRE book*, which puts a one-site primary-and-secondary rotation at eight engineers or more. The team keeps pages under the book's ceiling of two incidents per 12-hour shift, passes a **production readiness review** before go-live, pages on its SLO and keeps 20% of every sprint (Acme's own figure) to fix what the pages reveal. The platform team keeps the pipeline, observability, runbook template and on-call tooling easy to use. |
| **4 · Limits and pitfalls** | A team of 3 would be on call every third week, so small teams pool a rotation. Where regulation asks for separation of duties, a second approver and an audit log in the pipeline can meet it instead of a handoff, and shared infrastructure and deep specialisms such as the cluster and the database keep their own specialist teams. On-call with noisy alerts and no time to fix things burns people out: here, 5 pages a shift, far over the limit. |
<!-- END GENERATED: header -->

## The problem

At Acme Shop the payments developers finish a release and hand it to a central operations team, which deploys and runs the services of every product team. Release 2.8.0 has a memory leak. Every night, memory in the payments pods climbs until the containers hit their limit and are killed (`OOMKilled`). Payments fail, the operations engineer on call is paged, restarts the pods by hand at 02:10 to get a clean start, and files ticket OPS-4127. The developers who could find the leak see the ticket four days later, can't reproduce the problem on staging, and ask for logs and a heap dump that operations can't easily get. Three weeks and 21 restarts later, the leak is still in production.

Nobody here is careless. The structure splits the work in the wrong place: the team that changes the code never sees how it behaves in production, and the team that sees it can't change the code. Feedback travels through a ticket queue, so it arrives days late and loses detail, and the two teams pull in different directions. Google's *Site Reliability Engineering* book (2016) describes the same tension in its introduction: developers want to launch features, operations want nothing to break while they hold the pager, and since most outages follow a change, the two goals are at odds.

## How it works

The phrase comes from a 2006 interview that Jim Gray did with Amazon CTO Werner Vogels for ACM Queue: **"you build it, you run it."** Vogels contrasted it with the traditional model, in which software is thrown over the wall from development to operations. In his account, giving developers operational responsibility had improved the quality of Amazon's services, because it put them in daily contact with how their software behaved in production and with its customers, a feedback loop he called essential.

The team that builds a service owns it in production, end to end:

- **The change path:** the code and the deployment pipeline. Deploying, rolling back and pausing releases are the team's own decisions.
- **The view:** dashboards, alert rules and runbooks, kept next to the code and changed with it.
- **The pager:** an on-call rotation of the team's own engineers. When the service pages, it pages someone who can change it.
- **The authority:** the access to fix production, and the right to put the fix at the top of the next sprint.

It works because it shortens the feedback loop. Gene Kim's *The Three Ways* (IT Revolution, 2012) names amplifying feedback loops, from operations and customers back to the people doing the work, as the Second Way of DevOps. When the engineers who made a change get the page, the cost of a fragile change lands on them, and fixing the cause becomes the cheapest way to get a quiet night. That is what the second step shows: the on-call engineer recognises deploy 2.8.0 on the team's own dashboard, rolls back in eleven minutes, and the team fixes the leak the next morning.

**Compared with SRE as Google describes it.** Google's SRE book (2016) describes a different split, with the same principle underneath. A dedicated SRE team takes over the pager for a service only after a production readiness review, which the book calls a prerequisite for SRE to accept a service (chapter 32). The developers stay on the hook: SRE caps its operational work at 50% and sends the excess back to the product team, including putting developers back into the pager rotation (chapter 1), the developer teams of SRE-supported services usually keep a 24/7 rotation for escalations (chapter 11), and SRE can hand a service back to its developers when that makes more sense (*The Site Reliability Workbook*, chapter 18). Where no SRE team takes a service on, the people who build it run it.

**In team terms.** *[Team Topologies](../team-topologies/)* by Matthew Skelton and Manuel Pais (2019; second edition 2025) calls the teams that own a slice of the business end to end *stream-aligned* teams, and the authors' summary of its key concepts describes them as you-build-it-you-run-it teams with no hand-offs to other teams. Platform teams give them internal services to consume self-service, the *X-as-a-Service* interaction mode, and complicated-subsystem teams hold the deep specialist knowledge. AWS describes the same operating model: the operational excellence pillar of the [Well-Architected Framework](../well-architected-framework/) (November 2024) calls it *decentralized DevOps*, a variation of you build it, you run it, and AWS's DevOps Guidance recommends giving teams ownership of their whole value stream (OA.STD.6).

## Putting it into practice

1. **Name one owner per service.** Record the owning team in a service catalog (for example the `spec.owner` field in Backstage) and route the service's alerts to that team's rotation, for example with an [Alertmanager](../prometheus/) route to PagerDuty or a similar tool. If a page for the service can reach someone outside the team, the ownership isn't real yet.
2. **Hand over the keys with the pager.** The team gets the pipeline, the right to deploy and roll back, read access to production logs and metrics, and an audited path for emergencies: just-in-time elevated access that is requested, approved, time-limited and logged (AWS DevOps Guidance AG.SAD.4 describes this pattern). Paging a team that can't change production only moves the pain.
3. **Pass a readiness review before taking the pager.** Before go-live, check that the service has an SLO, a dashboard for it, alerts on the symptoms users feel with a runbook for each, a tested rollback, and known capacity and dependencies. Google's SRE teams run this review before they accept a service; the same checklist works when the builders will run it.
4. **Size the rotation.** The SRE book keeps on-call to at most 25% of an engineer's time and works out that a 24/7 rotation with a primary and a secondary on one site needs at least eight engineers, each on call one week a month, or six per site when two sites share it (chapter 11). It also gives typical response times: 5 minutes for user-facing services, 30 for less urgent ones. Acme's payments team has 7 engineers, so it takes the weekly primary shift (one week in seven) and shares the secondary with the checkout team's 7 engineers (one week in 14): each engineer is on call about 21% of weeks.
5. **Measure the load and act on it.** Count pages per shift and review them every week. The SRE book estimates about six hours of work per incident, follow-up included, and so puts the ceiling at two incidents per 12-hour shift; the Workbook targets at most two per shift (chapter 8). Every paging alert should be actionable and tied to a symptom that threatens the [SLO](../slo-error-budgets/); turn the rest into tickets or delete them. The [golden signals](../golden-signals/) are a good starting point for what to alert on.
6. **Pay for it, in time and in money.** Compensate out-of-hours work (the SRE book mentions time off in lieu or cash, capped as a share of salary), and keep time in every sprint for the fixes the pages reveal. Acme reserves 20% of each sprint, its own number, so the same page doesn't come back.
7. **Learn without blame.** Write a blameless postmortem for every significant incident and track its action items to done. Train new people with shadow shifts and practice incidents (Google's SRE teams call theirs Wheel of Misfortune).
8. **Let the platform team pave the road.** Six product teams shouldn't build six pipelines and six monitoring stacks. Acme's platform team runs the shared [Kubernetes](../kubernetes/) clusters, CI/CD and observability stack, and offers a deploy pipeline, dashboards, a runbook template and on-call tooling as self-service products that keep running a service cheap for every team.

## Where it fits

- **[SLOs and Error Budgets](../slo-error-budgets/)** decide what pages the team and how fast it may ship; the error budget turns reliability into a trade-off the owning team makes for itself.
- **[Golden Signals, RED & USE](../golden-signals/)** say what to measure and alert on, and **[Prometheus](../prometheus/)** with Alertmanager is a common way to route those alerts to the owning team's rotation.
- **[Canary Release](../canary-release/)** and **[Health Endpoint Monitoring](../health-endpoint-monitoring/)** make the team's own deploys safer and its rollbacks fast, which is what keeps a 02:10 page short.
- **[Incident Management](../incident-management/)** covers how a live incident is run once the page arrives; this page is about who owns the service day to day. **[Blameless Postmortems](../blameless-postmortems/)** and **[Eliminating Toil](../eliminating-toil/)** are what the team does with what the pages teach it.
- **[The Three Ways](../three-ways/)** explains why the feedback matters, and **Team Topologies** and **Platform as a Product** describe the team structure around it: stream-aligned teams that own services, and a platform team that makes owning them cheap.

## When to use it

It pays off for services that change often and are owned by long-lived product teams: microservices with a clear owner, customer-facing services where the time from symptom to fix matters, and any service where problems keep bouncing between teams. It costs more, or needs adapting, in these cases:

- **Small teams.** Fewer than about eight engineers on one site can't staff a 24/7 primary-and-secondary rotation within the SRE book's limits. Pool a rotation with a sibling team, as Acme does, or page out of hours only for the services that need it.
- **Shared infrastructure and deep specialisms.** Kubernetes clusters, networks and databases belong to the platform and specialist teams that build them, and those teams run what they build too. Product teams consume them as a service.
- **Legacy systems.** A service with no telemetry, no tests and no rollback gives its new owners pages they can't act on. Make it operable first: metrics, a runbook, a deployment pipeline.
- **Regulated environments.** Separation-of-duties rules ask that no one person can change production unchecked. A reviewed and approved change in an audited pipeline, with access controls on production, can meet them without a handoff to another team; agree the controls with your auditors early.
- **Very large, critical services.** A dedicated SRE team, as at Google, can be worth it once a service is big enough to justify one, with the developers still in the escalation path.

## Common pitfalls

- **On-call without support.** Paging people who have no time to fix the causes and no backup turns ownership into burnout. Cap the load (two incidents per 12-hour shift at most), compensate it, keep a secondary, and reserve sprint time for fixes.
- **Noisy alerts.** Alerting on every CPU spike teaches people to ignore the pager. Page only on symptoms that threaten the SLO, send everything else to a ticket or a dashboard, and delete alerts that never led to an action.
- **A pager without the keys.** Ownership without production access or the authority to fix is the old split with a new name. Give the team deploy and rollback rights through the pipeline, read access to production telemetry, an audited emergency path, and the say over its own backlog.
- **Too small to rotate.** A team of 3 is on call every third week, and every holiday leaves two people to share the pager. Pool the rotation with a related team, or limit out-of-hours paging to what really can't wait.
- **Too quiet to stay sharp.** A team that is almost never paged forgets how production behaves. The SRE book suggests that everyone be on call at least once or twice a quarter, plus practice incidents.
- **Everything is the product team's job.** Making every team run its own clusters, networks and databases overloads it. Shared infrastructure and deep specialisms stay with platform and specialist teams that offer them as a service.
- **Handoffs dressed up as compliance.** Meeting separation of duties by handing every release to another team brings the wall back. Put the control in the pipeline instead: a second approver, an audit log and least-privilege access.
- **A wall with a new name.** A separate "DevOps team" that deploys and gets paged for everyone else's services is the operations team of the first step under a new label. Move the pager to the teams that change the code.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [SLOs & Error Budgets](../slo-error-budgets/) — Measure SLIs against an objective and alert on error-budget burn rate, not on every blip.
- [Golden Signals, RED & USE](../golden-signals/) — What to measure and alert on: latency, traffic, errors and saturation, RED for request-driven services and USE for resources.
- [Incident Management](../incident-management/) — A practised response when production breaks: declare early, assign roles, mitigate first and keep everyone informed.
- [Blameless Postmortems](../blameless-postmortems/) — Learn from every incident without blame: a timeline, the contributing factors and tracked action items, shared widely.
- [Eliminating Toil](../eliminating-toil/) — Find the manual, repetitive operations work that grows with the system, measure it, cap it and automate it away.
- [The Three Ways](../three-ways/) — DevOps in three principles: speed the flow of work to customers, amplify feedback back to the team, and keep learning.
- [Team Topologies](../team-topologies/) — Four team types and three interaction modes that organise teams around the flow of change and keep cognitive load in check.
- [Platform as a Product](../platform-as-a-product/) — An internal developer platform run like a product: developers are its customers, self-service is its interface, adoption is earned.
- [Canary Release](../canary-release/) — Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back.
- [Health Endpoint Monitoring](../health-endpoint-monitoring/) — Expose liveness and readiness checks that load balancers and monitors probe.
- [Prometheus & Grafana](../prometheus/) — Pull-based monitoring: scrape metrics into a time-series database, query them with PromQL, alert, and chart them in Grafana.

## References

- [Jim Gray — A Conversation with Werner Vogels (ACM Queue 4(4), 2006)](https://doi.org/10.1145/1142055.1142065)
- [Google SRE book — Introduction (chapter 1)](https://sre.google/sre-book/introduction/)
- [Google SRE book — Being On-Call (chapter 11)](https://sre.google/sre-book/being-on-call/)
- [Google SRE book — The Evolving SRE Engagement Model (chapter 32)](https://sre.google/sre-book/evolving-sre-engagement-model/)
- [Google SRE Workbook — On-Call (chapter 8)](https://sre.google/workbook/on-call/)
- [Google SRE Workbook — SRE Engagement Model (chapter 18)](https://sre.google/workbook/engagement-model/)
- [Gene Kim — The Three Ways: The Principles Underpinning DevOps (IT Revolution, 2012)](https://itrevolution.com/articles/the-three-ways-principles-underpinning-devops/)
- [Team Topologies — Key concepts](https://teamtopologies.com/key-concepts)
- [Matthew Skelton and Manuel Pais — Team Topologies, 2nd edition (IT Revolution, 2025)](https://teamtopologies.com/book)
- [AWS Well-Architected, Operational Excellence pillar — Decentralized DevOps](https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/decentralized-devops.html)
- [AWS DevOps Guidance — OA.STD.6 Provide teams ownership of the entire value stream for their product](https://docs.aws.amazon.com/wellarchitected/latest/devops-guidance/oa.std.6-provide-teams-ownership-of-the-entire-value-stream-for-their-product.html)
- [AWS DevOps Guidance — AG.SAD.4 Limit human access with just-in-time access](https://docs.aws.amazon.com/wellarchitected/latest/devops-guidance/ag.sad.4-limit-human-access-with-just-in-time-access.html)
- [Prometheus — Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
