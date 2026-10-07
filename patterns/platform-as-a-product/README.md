<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🏗️ Platform Engineering](../../README.md#platform-engineering)

# Platform as a Product

> An internal developer platform run like a product: developers are its customers, self-service is its interface, adoption is earned.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Platform as a Product" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/platform-as-a-product.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Ticket queue, ivory tower** | Acme's platform team (6 engineers) runs the shared Kubernetes clusters, CI/CD and observability, but the only way in is a ticket: **140** are open for namespaces, databases, DNS records, pipelines and secrets. A new service needs four of them, one after another, so it waits **9 working days** for its first deploy in staging; teams write shadow scripts around the queue, and the service mesh the platform team spent a quarter on, which no team asked for, has no users. Nobody has asked the developers what they need, and to them the platform is a gate. (Acme's numbers are the example's own.) |
| **2 · Developers are customers** | The platform team starts treating developers as its **customers**. A new platform product manager interviews all six product teams and runs a survey (44 answers, satisfaction 2.4 out of 5), and the top pains are clear: a new environment takes 9 days, secrets come only by ticket and every team's pipeline is different. The roadmap now follows those pains, the mesh is paused, and the team starts with a **thinnest viable platform** in the Team Topologies sense: documentation and three self-service APIs, with a portal only later. |
| **3 · Self-service, measured** | Launchpad is run like a product: teams serve themselves in minutes through the portal (built on Backstage), the API or the CLI, with documentation, office hours and a support channel, and the platform has its own **SLOs** (Acme's targets: 99.5% pipeline availability, and provisioning within 15 minutes at the 95th percentile). A year later **5 of 6 teams** use it by choice, a new service reaches staging in **20 minutes** instead of 9 working days, open tickets are down from 140 to 20 and the survey score is up from 2.4 to 4.1. The mobile app team stays on its own pipeline because iOS builds need macOS, so macOS build runners are next on the roadmap. |
| **4 · Pitfalls and limits** | A **mandate** makes the number look better (6 of 6) while the teams it doesn't fit suffer, and building for imagined needs, like the mesh, wastes quarters. Without a product manager and a feedback loop the roadmap turns back into a wishlist; a **golden cage** that hides everything leaves no way out for unusual needs, while a platform that is too thin leaves teams to glue the pieces together. Counting features shipped says nothing about outcomes, and an operations team renamed *platform team* that still works through tickets is the old queue with a new name. |
<!-- END GENERATED: header -->

## The problem

Acme Shop has about 60 engineers. Six product teams each own a part of the shop (checkout, catalog, search, payments, delivery and the mobile app), a small SRE group looks after production, and a platform team of six engineers runs what everyone shares: the Kubernetes clusters on AWS, the CI/CD pipeline and the observability stack. On paper the product teams are autonomous. In practice everything they need from the platform starts with a ticket. A namespace, a database, a DNS record, a pipeline or a secret each waits in the platform team's queue, where 140 tickets are open. The median wait is two working days for a namespace, three for a database, one for a DNS record, three for a pipeline and two for a secret, and a new service needs the first four of them, one after another: 9 working days before its first deploy in staging. (Acme's numbers are the example's own, not research findings.)

The teams adapt the way people always adapt to a slow gate. Checkout deploys with its own script, the mobile app team keeps scripts of its own around the platform, and every team's pipeline drifts a little further from the others. Meanwhile the platform team, buried in tickets, still found a quarter for a project of its own choosing: a service mesh that no product team asked for and none uses, with cluster federation and a custom autoscaler next on its roadmap. The platform has no service level objectives of its own, nobody has asked the developers what they think of it, and the team reports tickets closed and features shipped. To the product teams the platform is a gate, not a help.

None of this is unusual. DORA's guide to platform engineering lists the same failures among its common pitfalls: a platform built on assumptions without user research ("build it and they will come"), a central team that dictates standards and pushes developers into workarounds (the "ivory tower"), and a team that works as a vending machine for infrastructure tickets ("ticket-ops").

## How it works

**A platform is an internal product.** In *What I Talk About When I Talk About Platforms* (martinfowler.com, 2018), Evan Bottcher describes a digital platform as self-service APIs, tools and services, together with the knowledge and support around them, offered to delivery teams as an internal product, so that autonomous teams can ship features faster and coordinate less. Two ideas carry most of the weight. The first is self-service: Bottcher calls the delay of waiting on another team's backlog *backlog coupling*, and a platform that still needs a ticket for routine work hasn't removed it. The second is that teams must want to use it. A mandate alone won't make it succeed; teams should find it less work to use than to build and run something of their own; and the people side belongs to the product as much as the code: documentation, advice and support, templates and guidelines, and someone who promotes it. He also cautions against renaming the existing virtual-machine hosting and centrally controlled tools "the platform".

**What a platform offers.** The *CNCF Platforms White Paper*, written by the Platforms Working Group of the CNCF's TAG App Delivery (version 1 completed in March 2023, with later revisions published online), defines a platform for cloud-native computing as capabilities that are integrated with each other and shaped around what their users need: a layer across many applications that gives them one consistent way to get and combine common services. It names seven attributes of a successful platform: platform as a product, user experience, documentation and onboarding, self-service, reduced cognitive load for its users, optional and composable (teams can use parts of it and run their own capabilities when they need to), and secure by default. Its list of typical capabilities has thirteen entries: web portals; APIs and CLIs; golden-path templates and documentation; build and test automation; delivery and verification automation; development environments; observability; infrastructure services; data services; messaging and event services; identity and secret management; security services; and artifact storage. The paper expects a platform team to own the interfaces and the experience while relying on managed services and other internal teams for the implementations wherever it can. (TAG App Delivery was retired in the CNCF's 2025 reorganisation of its technical advisory groups; its papers are still published on its site.)

**Internal developer platform and developer portal.** The platform is everything a product team gets from it: the capabilities (clusters, pipelines, databases, secrets, observability) and the ways of using them. A developer portal is one of those ways in. Backstage, the open-source framework for building developer portals that Spotify created (a CNCF incubating project since March 2022), is a common choice: its **Software Catalog** records who owns which service, its **Software Templates** create a new component with the organisation's standards built in, and **TechDocs** publishes documentation written next to the code. The white paper asks a platform to meet its users where they are, which may be a portal for one task and an API, a CLI or the IDE for another. A portal in front of manual tickets is still a ticket queue, so build the self-service capability first and put the portal in front of it.

**Product management for an internal product.** Running the platform as a product means doing what a product team does:

- **Users and personas.** Developers are not one group: a backend team, a data team and a mobile team need different things, and SREs and security engineers use the platform too.
- **Discovery.** The white paper suggests user interviews, hackathons, issue trackers, surveys and watching how the platform is actually used.
- **A roadmap** ordered by user problems and published, so that teams can plan around it.
- **Documentation, onboarding and support** as part of the product: getting-started guides, examples, office hours and a support channel.
- **Internal marketing.** The white paper counts advocacy among the platform team's jobs: demos, announcements and regular feedback sessions.
- **Deprecation.** In *Mind the platform execution gap* (martinfowler.com, 2021), Cristóbal García García and Chris Ford treat retiring a capability as a normal part of the platform's product lifecycle, and the CNCF maturity model counts feature removal as part of running the platform as a product.

The white paper advises bringing product managers in from the start, and expects a platform built without feedback, or pushed on its users by a top-down mandate, to meet resentment and to deliver far less than it promised. García García and Ford also advise against mandates as a way to win users.

**The thinnest viable platform.** In *Team Topologies* (IT Revolution; first edition 2019, second edition September 2025), Matthew Skelton and Manuel Pais treat the platform as a group of teams whose internal product speeds up delivery for the stream-aligned teams that build the business's products, mostly through the *X-as-a-Service* interaction mode, so that those teams carry less cognitive load. They argue for a **thinnest viable platform** (TVP): no thicker than it needs to be. For some organisations that is a wiki page saying which cloud services to use and how; more is added only when it makes the teams faster. Acme's first version was documentation and three self-service APIs. [Team Topologies](../team-topologies/) covers the team design around the platform; this page is about running the platform team itself like a product team.

**Maturity.** The CNCF *Platform Engineering Maturity Model* (TAG App Delivery, version 1 completed in October 2023) describes five aspects, each at four levels:

| Aspect | Provisional | Operational | Scalable | Optimizing |
|---|---|---|---|---|
| Investment | Voluntary or temporary | Dedicated team | As product | Enabled ecosystem |
| Adoption | Erratic | Extrinsic push | Intrinsic pull | Participatory |
| Interfaces | Custom processes | Standard tooling | Self-service solutions | Integrated services |
| Operations | By request | Centrally tracked | Centrally enabled | Managed services |
| Measurement | Ad hoc | Consistent collection | Insights | Quantitative and qualitative |

Acme started in the first two columns: a dedicated team, operations by request, scripts and custom processes, and adoption only because there was no other way in. A year later its investment, adoption and interfaces look like the third column. The model is explicit that each level costs more money and time and that reaching the top level is not a goal in itself; each aspect is assessed on its own, and the useful result is the list of things to improve next.

**Measuring a platform.** The white paper groups the metrics into three families: user satisfaction and productivity (active users and retention, satisfaction surveys such as NPS, developer-productivity measures such as SPACE), organisational efficiency (the time from a request to a working capability, the time to put a brand-new service into production, the time until a new developer's first change) and the delivery of the products built on the platform (DORA's metrics). DORA's own guide to platform engineering suggests a balanced scorecard: the five software delivery metrics (change lead time, deployment frequency, failed deployment recovery time, change fail rate and deployment rework rate; see [DORA Metrics](../dora-metrics/)), developer satisfaction surveys (CSAT or NPS), adoption and retention measured with Google's HEART framework, and task success, how well developers complete the key workflows on the platform. SPACE (Forsgren, Storey and colleagues, 2021) and DevEx (Noda, Storey, Forsgren and Greiler, 2023) cover the developer-experience side; DORA's 2025 article on measurement frameworks advises picking whichever fits the decision the numbers must support. The platform's own reliability gets [SLOs](../slo-error-budgets/), like any other service.

**What the research says.** DORA's 2024 report found that respondents who used an internal developer platform reported higher individual productivity, team performance and organisational performance, but also lower throughput and change stability; being able to do tasks without waiting on an enabling team went with a 5% improvement in productivity, for teams and for individuals. In DORA's 2025 research, 90% of organisations reported using an internal developer platform and 76% had dedicated platform teams. Where platform quality was high, adopting AI went with clearly better organisational performance; where it was low, the effect was negligible. The platform capability most associated with a good user experience was clear feedback on the outcome of a task. DORA also notes that platform programmes often follow a J-curve: early gains, a dip as complexity grows, then a higher plateau. These are correlations from surveys, not promises for any one organisation.

**Funding and staffing.** The maturity model's investment aspect runs from volunteers building shared tools on the side, through a dedicated team funded as a cost centre whose effect on the product teams nobody measures, to funding the platform the way the company funds its external products: by the value it is expected to deliver, with product management and user-experience roles, a published roadmap and sometimes a chargeback system. The white paper warns that leaders who see the platform as an IT expense tend to underfund it, so a platform team has to show its effect on the product teams' work to keep its support; it also asks that platform teams be staffed for their domain and their number of users. Acme added one product manager to its six platform engineers.

## Putting it into practice

Acme's platform team changed the way it works over a year:

1. **Find out who the customers are and what hurts.** The new product manager interviewed all six product teams, sat with the delivery team while it set up a service, sent a short survey to every developer (44 answers, 2.4 out of 5 for satisfaction) and sorted the 140 open tickets by type and wait. Three pains came out on top: a new environment takes 9 days (all six teams), secrets come only by ticket (five teams) and every team's pipeline is different (four teams).
2. **Give the roadmap an owner and publish it.** The product manager owns the problems and the order of the work; the engineers own the solutions. One pain per quarter: documentation and three self-service APIs for namespaces, databases and DNS records; then self-service secrets in Vault; then one pipeline template; then a portal on Backstage. The service mesh was paused, then deprecated with notice and removed, since nobody used it.
3. **Start thin, with a partner team.** Launchpad v0 was documentation and the three APIs, built with the delivery team for its next service. The portal came last, in front of capabilities that already worked. Behind an API there can be a Kubernetes operator or a pipeline that applies reviewed infrastructure code; what matters to the user is that the request is self-service and fast.
4. **Make support part of the product.** TechDocs pages next to the code, weekly office hours, a `#launchpad-help` channel, and release notes and deprecation notices for every change.
5. **Run the platform like production.** Acme chose two SLOs: the CI/CD pipeline is available 99.5% of the time over 30 days, and 95% of provisioning requests finish within 15 minutes. The platform team is on call for them like any service team, and the product teams can see them.
6. **Measure outcomes every quarter** and act on what they show:

| Measure | Before | Baseline (discovery) | A year later |
|---|---|---|---|
| Adoption | no choice: tickets only | 0 of 6 teams | 5 of 6 teams, by choice |
| Time to first deploy in staging | 9 working days | 9 working days | 20 minutes |
| Developer satisfaction (survey, 1 to 5) | never asked | 2.4 | 4.1 |
| Open platform tickets | 140 | 140 | 20, for unusual needs |
| Pipeline availability over 30 days (target 99.5%) | no SLO | drafted | 99.8% |
| Provisioning time, 95th percentile (target 15 min) | no SLO | drafted | 6 minutes |

7. **Keep it optional, and earn the last team.** The mobile app team stayed on its own pipeline: iOS apps are built with Xcode, which runs on macOS, and Launchpad's build runners are Linux containers on Kubernetes. The team asked for macOS build runners, and they are next on the roadmap. A team that needs something the platform doesn't offer can run it itself, with documentation that says what it then owns.

## Where it fits

- [Team Topologies](../team-topologies/) is the team design around the platform: stream-aligned teams, the platform grouping, the X-as-a-Service interaction mode and the thinnest viable platform. This page is about how the platform team works.
- [Golden Paths](../golden-paths/) are paved routes through the platform, such as the template that takes the returns service to its first deploy in staging in 20 minutes.
- [You Build It, You Run It](../you-build-it-you-run-it/): product teams that run their own services need a platform that makes pipelines, dashboards and on-call cheap. A platform team that runs everyone's services for them turns back into an operations team.
- [Eliminating Toil](../eliminating-toil/): a ticket for a routine request is toil for the platform team and waiting time for everyone else; self-service removes both.
- [Infrastructure as Code](../infrastructure-as-code/) and [GitOps](../gitops/): self-service APIs and templates are usually backed by reviewed infrastructure code and by an agent that reconciles the clusters.
- [Kubernetes](../kubernetes/), [HashiCorp Vault](../vault/) and [Prometheus & Grafana](../prometheus/) are capabilities underneath Launchpad, offered through its interfaces instead of through tickets.
- [DORA Metrics](../dora-metrics/) and [SLOs & Error Budgets](../slo-error-budgets/) measure the outcomes for the product teams and the platform's own reliability.
- [Service Mesh](../service-mesh/) is a useful component when teams need what it offers, such as mutual TLS and traffic policy across many services. The pitfall in the story is building it before anyone asked.

## When to use it

- **It pays off** when several product teams repeat the same infrastructure work, when routine requests wait in a queue, when every team's pipeline is different, or when developers spend much of their week on infrastructure instead of their product. Acme had six product teams and 140 open tickets.
- **Small organisations.** With one or two product teams, a dedicated platform team and a product manager cost more than they save. The thinnest viable platform may be a wiki page, a shared pipeline template and managed cloud services, looked after by the teams themselves.
- **Product management is a role before it is a hire.** A small platform team can give one engineer the role part-time; what matters is that someone owns the discovery, the roadmap and the feedback loop.
- **Regulated environments.** Some controls aren't optional: audit trails, approvals, separation of duties. Build them into the platform's paths so that the compliant way is also the easiest one, and require the control rather than the tool, so a team that leaves the paved road still has to meet it.
- **Legacy systems** that don't fit the platform, such as a mainframe or a vendor appliance, can stay outside it; forcing them in costs more than it returns.
- **It costs** a team, a product manager and sustained funding, and the maturity model points out that each level costs more. DORA's J-curve is a reason to expect a dip before the gains settle.

## Common pitfalls

- **Mandating adoption instead of earning it.** A mandate gets the adoption number to 6 of 6, but the teams the platform doesn't fit suffer and keep their workarounds, and the platform team loses the signal that tells it what to fix. Keep the platform optional and composable, measure voluntary adoption, and ask the teams that stay away what would bring them in. The maturity model calls adoption by mandate or incentive *extrinsic push*, and places *intrinsic pull*, where teams choose the platform for its value, a level above it.
- **Building for imagined needs.** A quarter on a service mesh nobody asked for was a quarter not spent on the 9-day wait. Start from discovery and the ticket data, build the thinnest version with a partner team, and retire what isn't used.
- **No product manager and no feedback loop.** Without someone who owns discovery and the roadmap, the roadmap drifts back to the platform team's own interests. Give someone the role, publish the roadmap, and keep a steady rhythm of interviews, surveys and usage data.
- **A golden cage, or a platform too thin to help.** A platform that hides everything leaves no way out when a team needs something unusual; DORA calls this one-size-fits-all approach a "golden cage". A platform that is only a wiki and a few scripts leaves every team gluing the pieces together. Offer composable parts, document how to leave the paved road and what a team then owns, and add capabilities when the demand shows up in the tickets and the feedback.
- **Counting features shipped.** "34 features this year" says nothing about whether anyone uses them or whether delivery got faster. Track adoption and retention, time to first deploy, satisfaction, task success and the DORA metrics of the teams on the platform.
- **Operations renamed platform team.** If the same people still work through the same ticket queue, only the name on the door has changed. Bottcher and the Thoughtworks Technology Radar both warn against relabelling existing hosting and operations as a platform. Make routine requests self-service, and treat each remaining ticket as a sign of a missing feature.
- **A big-bang portal.** A portal launched before the capabilities behind it are self-service is the same queue in a nicer frame, and DORA warns that by the time a platform built in full is released, the needs have changed. Build the self-service capability first, then the interface.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Golden Paths](../golden-paths/) — A paved, supported route for common tasks: one template creates a service with its pipeline, infrastructure and monitoring.
- [Team Topologies](../team-topologies/) — Four team types and three interaction modes that organise teams around the flow of change and keep cognitive load in check.
- [You Build It, You Run It](../you-build-it-you-run-it/) — The team that builds a service runs it in production, on call, so the people who can fix a problem hear about it first.
- [Eliminating Toil](../eliminating-toil/) — Find the manual, repetitive operations work that grows with the system, measure it, cap it and automate it away.
- [Infrastructure as Code](../infrastructure-as-code/) — Define infrastructure in version-controlled code: review a plan, apply it the same way in every environment and catch drift.
- [DORA Metrics](../dora-metrics/) — Measure software delivery by throughput and stability: how often and how fast changes reach production, and how often they fail.
- [Kubernetes](../kubernetes/) — A container orchestrator: you declare the desired state, and controllers keep pods scheduled, healthy and reachable.
- [GitOps](../gitops/) — Git holds the desired state; an agent continuously reconciles the cluster to match it.

## References

- [Evan Bottcher — What I Talk About When I Talk About Platforms (martinfowler.com, 2018)](https://martinfowler.com/articles/talk-about-platforms.html)
- [CNCF TAG App Delivery — CNCF Platforms White Paper](https://tag-app-delivery.cncf.io/whitepapers/platforms/)
- [CNCF TAG App Delivery — Platform Engineering Maturity Model (v1, 2023)](https://tag-app-delivery.cncf.io/whitepapers/platform-eng-maturity-model/)
- [Team Topologies — Key concepts](https://teamtopologies.com/key-concepts)
- [Matthew Skelton and Manuel Pais — What is a Thinnest Viable Platform (TVP)?](https://teamtopologies.com/key-concepts-content/what-is-a-thinnest-viable-platform-tvp)
- [Matthew Skelton and Manuel Pais — Team Topologies, 2nd edition (IT Revolution, 2025)](https://itrevolution.com/product/team-topologies-second-edition/)
- [DORA — Capabilities: Platform engineering](https://dora.dev/capabilities/platform-engineering/)
- [DORA — Accelerate State of DevOps Report 2024](https://dora.dev/research/2024/dora-report/)
- [DORA — State of AI-assisted Software Development 2025 (the 2025 DORA report)](https://dora.dev/research/2025/dora-report/)
- [DORA — Choosing measurement frameworks to fit your organizational goals (2025)](https://dora.dev/insights/measurement-frameworks/)
- [Cristóbal García García and Chris Ford — Mind the platform execution gap (martinfowler.com, 2021)](https://martinfowler.com/articles/platform-prerequisites.html)
- [Thoughtworks Technology Radar — Platform engineering product teams](https://www.thoughtworks.com/radar/techniques/platform-engineering-product-teams)
- [Backstage — What is Backstage?](https://backstage.io/docs/overview/what-is-backstage)
- [CNCF — Backstage project page](https://www.cncf.io/projects/backstage/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
