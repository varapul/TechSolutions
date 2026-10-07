<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🏗️ Platform Engineering](../../README.md#platform-engineering)

# Team Topologies

> Four team types and three interaction modes that organise teams around the flow of change and keep cognitive load in check.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Team Topologies" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/team-topologies.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Handoffs and overload** | Acme Shop is organised by technical layer: a front-end, a back-end, a database and an operations team. The wishlist feature needs all four, so it passes three handoff queues and reaches customers after 28 days, 19 of them spent waiting, and the system has the same shape as the teams: a layered monolith with one shared database (**Conway's law**). The checkout team, split out in an earlier reorganisation, builds and runs seven services from two domains plus their Kubernetes manifests, Terraform, 46 alert rules and the PCI audit, which is more than eight people can keep in their heads. |
| **2 · Four team types** | Acme redraws its team map with the four team types of *Team Topologies* (Matthew Skelton and Manuel Pais, 2019; second edition 2025). Six **stream-aligned** teams (checkout, payments, catalog, search, delivery and mobile app) each own a slice of the shop end to end, so catalog's next wishlist change is live in 2 days with no handoff. The **platform** team runs Launchpad as a product the other teams serve themselves from, the SRE group is an **enabling** team that coaches a team and then moves on, and the recommendations team is a **complicated-subsystem** team for the ML ranking engine that catalog and search call. |
| **3 · Three interaction modes** | Teams that work together do so in one of three modes, and the mode changes over time. Delivery uses Launchpad **as a service**: it creates the returns service from a template in the portal and has it in staging in 20 minutes instead of 9 working days. The SRE group **facilitates** for 6 weeks while delivery sets up SLOs, alerts and on-call, then steps away, and catalog and recommendations **collaborate** for three months on a new ranking API before switching to X-as-a-Service once API v2 is stable, which search uses too. |
| **4 · Load, Conway, pitfalls** | Cognitive load decides the boundaries: Launchpad's templates and clusters take the manifests, Terraform and alert plumbing off the checkout team, and the payments domain with its PCI audit goes to a new six-person payments team, which leaves checkout three services and its flow. Forming the payments team first so that the service boundary and its own database follow is the **reverse Conway manoeuvre**. The common failures: renaming teams without changing how work flows, a platform that works through tickets, collaboration that never ends, and teams beyond the book's five to nine people. |
<!-- END GENERATED: header -->

## The problem

About 60 engineers build Acme Shop, and for years they were organised by technical layer: a front-end team owns the web UI, a back-end team the business logic, a database team the shared schema, and an operations team the servers and the weekly release. Every customer-facing feature crosses all four. When the front-end team starts on the wishlist it needs a new API, so it files a ticket with the back-end team; the back-end team needs a new table and files a ticket with the database team; and the finished change waits for the operations team's next release. Nine days of work take 28 days, 19 of them spent waiting in other teams' queues. (These are the example's own numbers, not research findings.)

The software has the same shape as the organisation: a layered monolith in which every feature touches the web UI, the business layer and one shared database. Melvin Conway described this effect in 1968: an organisation that designs a system ends up with a design that copies its own communication structure. Teams that mostly talk within their layer build a system split by layer, and the layers then make the handoffs permanent.

An earlier reorganisation tried to fix this for one part of the shop by creating a checkout team that builds and runs its own services. It overshot in the other direction. Eight people now own seven services from two domains, the checkout flow and payments, and with them each service's Kubernetes manifests, the Terraform for its AWS resources, 46 alert rules and the PCI DSS audit. Nobody decided that the team should carry that much: responsibilities were added one at a time and none were taken away, until most of the team's attention went to plumbing and audit evidence instead of the checkout flow.

## How it works

*Team Topologies* by Matthew Skelton and Manuel Pais (IT Revolution, 2019; second edition September 2025) treats the team as the unit of delivery and designs the organisation for a fast flow of change. It grew out of the authors' DevOps Topologies patterns, which Skelton first drew in 2013 and which describe static team shapes; the book adds how teams interact and how those interactions change. Its core is deliberately small: four team types and three interaction modes.

**Four team types**

| Type | What it does | At Acme |
|---|---|---|
| Stream-aligned | Owns the flow of work for one slice of the business end to end, from idea to production, without handing work to other teams. It is the main type; the other three exist to lighten its load. | checkout, payments, catalog, search, delivery and mobile app |
| Platform | Offers internal services that stream-aligned teams use on their own, run as a product they want to use, so those teams don't have to build the plumbing themselves. | the platform team (6 engineers) and Launchpad |
| Enabling | Specialists who help another team gain a missing skill or capability, then move on. An enabling team doesn't own software. | the SRE group (5 engineers) |
| Complicated subsystem | Owns a part of the system that needs deep specialist knowledge that most teams couldn't be expected to hold. | recommendations (5 engineers), the ML ranking engine |

**Three interaction modes**

- **Collaboration:** two teams work closely together for a defined time to discover something new, such as an API, a practice or a technology. It is fast for discovery and avoids handoffs, but both teams carry more context and deliver less while it lasts, so the book allows a team to collaborate with at most one other team at a time.
- **X-as-a-Service:** one team provides something (a library, an API, a whole platform) and others consume it with little interaction. Ownership is clear and the consumers' cognitive load stays low; the price is that the boundary changes more slowly. A team can provide or consume many services at once.
- **Facilitating:** one team helps another learn, or clears an obstacle out of its way. It is the main mode of enabling teams, and it should end when the other team can manage on its own.

The book expects the modes to change over time. At Acme, the catalog and recommendations teams collaborate while they shape a new ranking API and switch to X-as-a-Service once it is stable, and the SRE group facilitates the delivery team for six weeks and then leaves. The Team Topologies team calls an open-ended "collaboration" with no goal or end an *undefined interaction*, a sign that a boundary is in the wrong place.

**Team-first thinking and cognitive load.** In the book, a team means a small, long-lived group of five to nine people who share one goal, a size it bases on Dunbar's research into how many people we can know and trust well. It borrows *cognitive load* from the psychologist John Sweller, who described it in 1988 and distinguished three kinds: **intrinsic** load comes from the fundamentals of the task (the language, the framework), **extraneous** load from the environment the task is done in (the deployment steps, each environment's configuration), and **germane** load from the parts of the work that need real thought and learning to do well (here, the shop's business domain). The advice is to reduce intrinsic load through training, good technology choices and pairing, to remove extraneous load altogether, often by automating it into a platform, and to leave room for germane load. A team's boundaries and responsibilities should match what it can hold; one of the book's heuristics is to give a team no more than one complicated or complex domain. Acme's checkout team had two such domains, and a pile of extraneous plumbing on top.

**Conway's law and the reverse Conway manoeuvre.** Conway's paper *How Do Committees Invent?* was published in Datamation in April 1968, and Fred Brooks later named its thesis Conway's law in *The Mythical Man-Month*. Because the team structure will shape the architecture anyway, you can use it on purpose: decide which architecture you want, then shape the teams and their communication so that they tend to produce it. Jonny LeRoy and Matt Simons called this the inverse Conway maneuver (Cutter IT Journal, December 2010), and the book calls it the reverse Conway maneuver. Acme wants payments as its own services with their own database, so it forms the payments team first and lets the service boundary follow.

**Fracture planes.** To decide where to split a monolith or an overloaded team, the book looks for *fracture planes*: natural seams along which a part of the system can be separated with little coupling left across the cut. They are usually domain boundaries (bounded contexts, in domain-driven design terms), and the book also considers differences such as how often each part changes. Payments, with its own rules, its own data and its own audit, is such a seam at Acme.

**The Thinnest Viable Platform.** A platform should be the smallest thing that speeds the stream-aligned teams up. The authors point out that it can be as small as one wiki page naming the cloud services the teams use and how to use them, and that it should grow only as the teams' needs grow. A platform built ahead of demand adds cognitive load instead of removing it.

**Team APIs.** Each team describes how others work with it: what it owns, the services it provides and what can be expected of them, how it versions them, where its documentation and chat channels are, how it works, and which teams it currently interacts with, in which mode and for how long. The authors publish a Team API template on GitHub.

**Evolving the map.** A team map is a snapshot. As goals change and teams learn, collaborations turn into services, facilitation ends, teams split or merge, and the authors recommend adjusting team boundaries in small, frequent steps rather than in large reorganisations. The second edition (2025) adds case studies from many industries and clarifies that a platform is usually a *grouping* of teams rather than a single team: once an organisation has more than about 40 to 50 people, one platform team of around eight is rarely enough. Acme, with about 60 engineers and one platform team of six, is at the size where Launchpad may need to become a grouping of two teams.

## Putting it into practice

1. **Map the teams you have and how work moves between them.** List every team, what it owns and whom it waits for. Trace a few recent changes from idea to production and count the handoffs and the waiting time, as Acme did for the wishlist. Leave a team without a type when it doesn't fit one yet, instead of forcing a label on it.
2. **Ask the teams about their cognitive load.** How much of their time goes to their domain and how much to plumbing? How many services, domains and tools do they have to know, and where do they feel lost? Team Topologies publishes a team cognitive load assessment template on GitHub; repeating a short survey every quarter shows the trend.
3. **Choose streams and fracture planes.** Align stream-aligned teams to slices of the business that customers see, such as a product, a journey or a group of users, and split overloaded teams along fracture planes, as Acme split payments off checkout. Keep teams at five to nine people, stable over time, with at most one complicated domain each.
4. **Build the thinnest platform that removes the repeated plumbing.** Acme's Launchpad bundles a developer portal built on Backstage (its Software Catalog, Software Templates and TechDocs), service templates, the CI/CD pipeline, the shared [Kubernetes](../kubernetes/) clusters, [Prometheus and Grafana](../prometheus/), and secrets in [HashiCorp Vault](../vault/). From the portal the delivery team gets its new returns service with a repository, pipeline, deployment and dashboards in about 20 minutes instead of 9 working days of tickets. Run the platform as a product and judge it by adoption and its users' satisfaction, not by the number of features.
5. **Name the interaction mode for every pair of teams that works together**, with its purpose and, where it is temporary, an exit criterion and a date. Acme's SRE group facilitates the delivery team for six weeks with a clear goal (SLOs, alerts and an on-call rotation for the returns service); catalog and recommendations collaborate for three months until API v2 is stable.
6. **Publish team APIs** where people already look, such as the team pages in the developer portal, so other teams know what each team offers and how to reach it.
7. **Review the map every quarter.** Look at handoffs, lead times and the cognitive load survey, and change interactions and boundaries in small steps.

## Where it fits

- **[Microservices](../microservices/)** and **[Database per Service](../database-per-service/)** only stay independent when the teams that own them are: the reverse Conway manoeuvre is how Acme gets payments its own services and database. A **[Modular Monolith](../modular-monolith/)** can give each stream-aligned team its own module when separate deployments aren't worth it yet, and a **[Layered Architecture](../layered-architecture/)** is what layer teams tend to produce.
- **[You Build It, You Run It](../you-build-it-you-run-it/)** is how a stream-aligned team works day to day: it runs what it builds, with no handoff to an operations team.
- **[Platform as a Product](../platform-as-a-product/)** describes how the platform team runs Launchpad, and **[Golden Paths](../golden-paths/)** the templates that make X-as-a-Service with the platform take minutes instead of days.
- **[The Three Ways](../three-ways/)** explains why flow matters: teams aligned to the flow of change, with few handoffs, are the First Way applied to the organisation.
- **[SLOs and Error Budgets](../slo-error-budgets/)** are what Acme's SRE group teaches the delivery team while facilitating, and **[Eliminating Toil](../eliminating-toil/)** helps platform and enabling teams find the repeated work worth automating away.

## When to use it

It pays off once several teams build one product and changes wait on handoffs, or when teams carry more than they can hold. The usual signs are lead times made mostly of waiting, teams split by technology layer, and a platform or operations group that works through a queue of tickets. It also helps at the start of a microservices or platform engineering effort, so that the team boundaries and the service boundaries are designed together.

It needs adapting, or costs more than it returns, in these cases:

- **Small organisations.** With one or two teams there is little to design: a stream-aligned team and a thin platform, perhaps a wiki page and a managed cloud service, are enough. The types start to matter when teams begin to wait for each other.
- **Tightly coupled legacy systems.** A stream-aligned team can't own a flow end to end while every change still goes through one shared codebase and database. Split along fracture planes step by step (the [Strangler Fig](../strangler-fig/) helps here), and expect collaboration and some handoffs in the meantime.
- **Regulated work.** Separation of duties and audits can look like a reason to keep handoffs. Often an approval step and an audit trail in the pipeline, provided by the platform, meet the rule without a separate team, and a regulated domain can be its own stream with its own compliance work, as payments is at Acme. Agree the controls with your auditors.
- **Scarce specialists.** With a single ML engineer or security expert, a complicated-subsystem or enabling team isn't viable; share the knowledge through facilitation and documentation, and accept some dependency.
- **Not an org chart method.** The authors say plainly that the approach doesn't produce a reporting structure, and that using one part alone, such as relabelling teams with the four types, achieves little.

## Common pitfalls

- **Renaming instead of redesigning.** Calling the front-end and back-end teams "stream-aligned" changes nothing while a feature still crosses three handoffs. Change what each team owns until it can ship a change on its own, and watch handoffs and lead time.
- **A platform behind a ticket queue.** When teams have to file a ticket and wait, X-as-a-Service has become a handoff again, and a new service takes 9 days instead of 20 minutes. Make the common tasks self-service and keep tickets for the rare exceptions.
- **Collaboration forever.** Two teams that "work closely together" with no goal and no end build hidden dependencies and carry each other's cognitive load. Give every collaboration a purpose, an exit criterion and a date, and turn its result into a service.
- **Enabling teams that never leave.** An SRE group that ends up running the delivery team's on-call has become an operations team again. Agree the goal at the start and step away once the team can manage on its own.
- **Teams that are too big.** A team of 15 behaves like two teams sharing a backlog, with more coordination and less trust. Keep teams at five to nine people and split a larger one along a fracture plane.
- **Specialist teams for everything.** Treating every component as a complicated subsystem brings the layer teams back under a new name. Keep that type for knowledge a stream-aligned team really can't hold.
- **A thick platform built ahead of demand.** A large platform that nobody asked for adds to the teams' cognitive load instead of reducing it. Start thin and grow it with what the stream-aligned teams use.
- **Reorganising once and stopping.** The map is a snapshot. Review the interactions and the teams' load regularly and change them in small steps.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Platform as a Product](../platform-as-a-product/) — An internal developer platform run like a product: developers are its customers, self-service is its interface, adoption is earned.
- [Golden Paths](../golden-paths/) — A paved, supported route for common tasks: one template creates a service with its pipeline, infrastructure and monitoring.
- [You Build It, You Run It](../you-build-it-you-run-it/) — The team that builds a service runs it in production, on call, so the people who can fix a problem hear about it first.
- [Microservices](../microservices/) — Small, independently deployable services, each owning one business capability and its data.
- [Modular Monolith](../modular-monolith/) — One deployable unit built from strongly bounded modules that talk through explicit interfaces.
- [Database per Service](../database-per-service/) — Each service owns its data; others go through its API or events, never its tables.
- [Layered (N-Tier)](../layered-architecture/) — Presentation, business and data layers; each layer only calls the one directly below it.
- [The Three Ways](../three-ways/) — DevOps in three principles: speed the flow of work to customers, amplify feedback back to the team, and keep learning.
- [SLOs & Error Budgets](../slo-error-budgets/) — Measure SLIs against an objective and alert on error-budget burn rate, not on every blip.
- [Eliminating Toil](../eliminating-toil/) — Find the manual, repetitive operations work that grows with the system, measure it, cap it and automate it away.

## References

- [Team Topologies — Key concepts](https://teamtopologies.com/key-concepts)
- [Matthew Skelton and Manuel Pais — Team Topologies, 2nd edition (IT Revolution, 2025)](https://itrevolution.com/product/team-topologies-second-edition/)
- [Matthew Skelton and Manuel Pais — Conway's Law: Critical for Efficient Team Design in Tech (IT Revolution, 2020, adapted from the book)](https://itrevolution.com/articles/conways-law-critical-for-efficient-team-design-in-tech/)
- [Matthew Skelton and Manuel Pais — Team Cognitive Load (IT Revolution, 2021, adapted from the book)](https://itrevolution.com/articles/cognitive-load/)
- [Matthew Skelton and Manuel Pais — Minimize Team Cognitive Load to Increase Flow (IT Revolution, 2021, adapted from the book)](https://itrevolution.com/articles/minimize-cognitive-load-of-teams/)
- [IT Revolution — The Three Team Interaction Modes (2023)](https://itrevolution.com/articles/the-three-team-interaction-modes/)
- [Team Topologies — Interaction modes: breaking through common misconceptions (2025)](https://teamtopologies.com/news-blogs-newsletters/2025/2/21/team-topologies-interaction-modes-breaking-through-common-misconceptions)
- [Team Topologies — Team Interaction Modeling](https://teamtopologies.com/key-concepts-content/team-interaction-modeling-with-team-topologies)
- [Team Topologies — What is a Thinnest Viable Platform (TVP)?](https://teamtopologies.com/key-concepts-content/what-is-a-thinnest-viable-platform-tvp)
- [Team Topologies — Groupings (second edition)](https://teamtopologies.com/key-concepts-content/groupings)
- [Team Topologies — Team API template (GitHub)](https://github.com/TeamTopologies/Team-API-template)
- [Team Topologies — Team Cognitive Load Assessment template (GitHub)](https://github.com/TeamTopologies/Team-Cognitive-Load-Assessment)
- [Melvin E. Conway — How Do Committees Invent? (Datamation, April 1968)](https://www.melconway.com/Home/Committees_Paper.html)
- [Martin Fowler — Conway's Law (2022)](https://martinfowler.com/bliki/ConwaysLaw.html)
- [Martin Fowler — Team Topologies (2023)](https://martinfowler.com/bliki/TeamTopologies.html)
- [Matthew Skelton and Manuel Pais — DevOps Topologies](https://web.devopstopologies.com/)
- [Backstage — What is Backstage?](https://backstage.io/docs/overview/what-is-backstage/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
