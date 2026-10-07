
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🏗️ Platform Engineering](../../README.md#platform-engineering)

# Golden Paths

> A paved, supported route for common tasks: one template creates a service with its pipeline, infrastructure and monitoring.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Golden Paths" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/golden-paths.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · 40 services, 40 ways** | Before Launchpad, each of Acme's 40 services was built its own way, on 12 different base images, and 7 had no known owner. The delivery team (8 engineers) starts its new **returns** service by copying `carrier-sync`, so it inherits a deprecated `openjdk:11` base image with 3 critical CVEs in its scan and a Jenkinsfile edited by hand, and gets no dashboard, no alerts and no catalog entry. Tickets for the namespace, the database and the queue with its Vault secret wait in other teams' queues, so the first deploy reaches staging after 9 working days, and when `gift-cards` pages at 02:14 nobody can tell who owns it. |
| **2 · The golden path at work** | The delivery team opens **Launchpad**, Acme's developer portal built on Backstage, picks the HTTP service template and fills in four fields: name `returns`, owner `delivery-team`, a PostgreSQL database and an SQS queue. One run creates the repository (code skeleton, tests, a Dockerfile on the maintained `java-base` image), the shared CI/CD pipeline, the Kubernetes deployment, the database and queue through the platform's Terraform modules with credentials from Vault, a Grafana dashboard and alerts on the golden signals routed to the team's on-call, and a catalog entry that names the owner. The form is sent at 10:02, the first build is green at 10:11, the database is ready at 10:17 and the first deploy reaches staging at 10:22: 20 minutes. |
| **3 · Kept current, optional** | A template is copied once, so services on the path refer to the base image, the pipeline, the Helm chart and the Terraform modules by version, which is what lets them be upgraded. When the platform team (6 engineers) releases template v4, with a new base image (`java-base:21-2026.10`) and OpenTelemetry tracing (chart `acme-service` 4.0), Renovate opens an upgrade pull request in each of the 32 repositories on the path (PR #31 for returns), and the owning teams merge them once the checks pass: 27 within 7 days. The catalog shows every service's owner, docs and template version; 8 of the 40 services stay off the path, such as `payments-ledger` with its PCI rules, and their teams own their pipelines and upgrades. |
| **4 · Pitfalls and limits** | A **golden cage** makes the path mandatory, so teams with a real need work around it, with `kubectl apply` by hand, say; keep it optional and let a team that leaves own the extra work. Templates that **scaffold once and then rot** leave every service on the version it started from, and **too many paths** (14 templates for the same few journeys, 3 kept current) leave teams guessing which one is supported. A path that ends at the first deploy leaves **day two** (upgrades, deprecation, decommissioning) to every team, and **counting template runs** (120 this quarter) measures activity, not results: track the time to a first deploy, incidents and upgrade lag. |
<!-- END GENERATED: header -->

## The problem

Acme Shop grew to 40 services, and every one of them was set up by hand. A new service usually began as a copy of an older repository: whatever the original had came along (its base image, its Jenkinsfile, its Helm values), and whatever it lacked stayed missing. Nobody chose the result. By the time anyone counted, the 40 services ran on 12 different base images, 7 of them had no owner anyone could name, and every team had solved the same plumbing (a pipeline, a namespace, database credentials, a dashboard) in its own way, then kept maintaining its own version.

The delivery team's new **returns** service shows what that costs. The team (8 engineers) cloned `carrier-sync` and renamed it. With the copy came the `openjdk:11` base image, which [Docker](../docker/) Hub marks as officially deprecated and whose scan showed 3 critical CVEs, and a Jenkinsfile that had been edited by hand and skipped the image scan. Nothing gave returns a dashboard or alerts, and nothing registered it anywhere. The rest took tickets: a namespace from the platform team (OPS-1412), a database from the DBAs (DBA-318), a queue and a Vault secret from the platform team again (OPS-1419). Each waited in another team's queue, and with two days for the copy and its fix-ups, the first deploy reached staging after 9 working days. The same week `gift-cards` paged the on-call engineer at 02:14, and nobody could find out which team owned it.

Spotify described the same drift in 2020. With many autonomous teams, its developer tooling had fragmented until the only way to learn how to do something was to ask a colleague, a habit its engineers called "rumour-driven development". Every team that works out the plumbing for itself spends time that the next team will spend again, and each copy then ages on its own.

## How it works

### Golden paths and paved roads

A **golden path** is a supported, opinionated route for a common task, such as building a backend service: the tools, defaults and steps that a platform team recommends and keeps working. The name comes from Spotify. Gary Niemen's post *How We Use Golden Paths to Solve Fragmentation in Our Software Ecosystem* (Spotify Engineering, August 2020) traces it to a tutorial for backend engineers that started as a Hack Week project about six years earlier. Paths for client development, data engineering, data science, machine learning, web and audio processing followed. The recommended tools are listed in Spotify's developer portal, Backstage, and new engineers work through the tutorial for their discipline in their first two weeks. Spotify's aim was less fragmentation: fewer variants to maintain, and a better chance of upgrading many teams automatically. An engineer can still leave the path, but loses the support that comes with it.

Netflix uses the name **paved road**. Its 2018 post on full-cycle developers (Philip Fisher-Ogden, Greg Burrell and Dianne Marsh) describes a set of tools and practices that central teams formally support. Netflix doesn't make teams use them; it tries instead to make building and operating on the paved road clearly better than doing it any other way.

The CNCF's *Platforms White Paper* (TAG App Delivery, version 1 completed in March 2023) lists golden paths among the capabilities of an internal platform: a starting template for a project together with its documentation, so that a team begins with the platform's capabilities already wired in.

### What goes into a path

Acme's HTTP service path bundles:

- **A template** that generates the repository: a code skeleton with tests, a Dockerfile on the platform's maintained `java-base` image, and the service's `catalog-info.yaml`.
- **Documentation**: a TechDocs site inside the new repository, and a guide to the path itself.
- **The pipeline**: Launchpad's shared CI/CD pipeline, referenced by version, which builds, tests, scans the image and deploys.
- **The deployment**: a namespace and the platform's `acme-service` Helm chart, with health probes, resource limits and two replicas in staging.
- **Infrastructure modules**: Terraform modules that create an [Amazon RDS](../amazon-rds-aurora/) for [PostgreSQL](../postgresql/) database and an [Amazon SQS](../amazon-sqs/) queue, with database credentials issued by Vault.
- **Observability**: a Grafana dashboard on the four golden signals, and Prometheus alert rules that page the owning team's on-call.
- **Security defaults**: the maintained base image, the image scan in the pipeline, and secrets that come from Vault instead of sitting in the repository.
- **Support**: an owner for the path (the platform team, 6 engineers), a channel for questions, and a changelog for every template version.

The template does in one run what the tickets did in 9 days, and the same way every time. In the diagram the form is sent at 10:02, the repository and its catalog entry exist a minute later, the first build is green at 10:11, the database and queue are ready at 10:17, and the first deploy of `returns` 0.1.0 reaches staging at 10:22, 20 minutes after the form. Creating the database takes longest; everything else is ready within minutes.

### Developer portals and Backstage

A path needs a front door. Acme's is **Launchpad**, a developer portal built on **Backstage**, the open-source framework for developer portals that Spotify released in March 2020. Backstage was accepted into the CNCF in September 2020 and has been an incubating project since March 2022. Three of its core features carry a golden path:

- **Software Templates.** A template is a YAML file (`apiVersion: scaffolder.backstage.io/v1beta3`, `kind: Template`). Its `parameters` are JSON Schema, which the portal renders as a form, and its `steps` run actions such as `fetch:template` (render a skeleton with the values from the form), `publish:github` (create the repository) and `catalog:register`. Software created through a template is registered in the catalog automatically.
- **Software Catalog.** Every component is described by a metadata file kept with its code, usually named `catalog-info.yaml`, with fields such as `spec.type`, `spec.lifecycle` and `spec.owner`. The catalog collects these files and shows who owns what, which is the question the on-call engineer couldn't answer for `gift-cards`.
- **TechDocs.** Documentation is written in Markdown next to the code and published in the portal, the docs-like-code approach, built with MkDocs.

Backstage is a framework rather than a finished product: you run it, choose or write its plugins and keep it upgraded. Organisations that don't want to run one buy a portal instead, such as Port, Cortex or OpsLevel, or a supported Backstage distribution such as Red Hat Developer Hub. Whichever you pick, the portal is only the front door. The path is the automation behind the form.

### Keeping a path current

A template runs once. The scaffolder renders the skeleton, publishes the repository and registers it, and after that nothing ties the repository to later versions of the template. Backstage does record which template created an entity, in the `backstage.io/source-template` annotation (added automatically when the template writes `catalog-info.yaml` with the `catalog:write` action). That tells you where a template was used, but not which version, and it changes nothing in the repository. Keeping Acme's 32 path services current takes other tools, in three layers:

1. **Refer, don't copy.** Whatever changes often lives outside the generated repository and is referenced by version: the base image, the shared pipeline, the Helm chart, the Terraform modules, the dashboards and alert rules. A template release then becomes mostly a set of version bumps.
2. **Let a bot raise the bumps.** Renovate (Dependabot covers part of the same ground) opens a pull request when a new base image, chart, module or pipeline version is published. Renovate can group related updates into one pull request (`groupName`) and update a version string in any file with a custom regex manager; Acme uses that to bump its own template-version annotation in `catalog-info.yaml` in the same pull request, so the catalog shows which services are behind. Each service's pipeline tests its pull request, and the owning team merges it. For template v4, with a new base image (`java-base:21-2026.10`) and chart `acme-service` 4.0, which adds the OpenTelemetry Operator's injection annotation so the Java agent is injected into each pod, Renovate opened 32 pull requests (PR #31 for returns); 27 were merged within 7 days.
3. **Re-apply the template for the rest.** Changes to the generated files themselves need a template tool that can update projects. Copier's `copier update` re-applies a newer, tagged template version to a project it generated (Renovate has a manager that raises these updates), and cruft does the same for Cookiecutter templates. A Backstage template can also open a pull request against an existing repository with `publish:github:pull-request`, one repository per run. Larger organisations build fleet-wide change tools: Spotify's in-house Fleetshift runs a code transformation, packaged as a container image, as a Kubernetes job against every targeted repository. Spotify reported in 2023 that, after investing in fleet management, updates to its internal service framework reach 70% of backend services in about 7 days instead of about 200.

### Optional, and owned when you leave

A path is a default, not a rule. A team with a real need may leave it, as the payments team does with `payments-ledger` because of its PCI rules, but it then owns what the path would have done for it: its pipeline, base image patching, upgrades and alerts. The catalog entry and a named owner stay mandatory for every service, on the path or off it. Of Acme's 40 services, 32 are on the path.

## Putting it into practice

1. **Start with the most common journey.** Look at what teams build most often and where they wait longest. DORA's guidance on platform engineering is to begin with a minimum viable platform: find the golden path for the most common workflow and build just enough to prove it before adding more. At Acme that was an HTTP service with a database and a queue.
2. **Write the path down, then automate it.** Spotify's first golden paths were tutorials. A written walkthrough forces the decisions (which base image, which pipeline, which alert thresholds) before you encode them, and it stays useful as the path's documentation.
3. **Keep the template thin.** Generate only what the team will own and change: the code skeleton, tests, configuration and `catalog-info.yaml`. Everything else is a versioned reference.
4. **Build in the defaults.** Security: a maintained base image, an image scan in the pipeline, secrets from Vault and least-privilege access. Operations: a dashboard on the golden signals, alerts routed to the owner's on-call, an owner in the catalog and docs in TechDocs.
5. **Version the path and plan its upgrades.** Release template versions with a changelog, record the version on every service, and let Renovate or a template-update tool raise the pull requests. Try each release on a few services before the whole fleet gets it.
6. **Give the path an owner.** The platform team owns it like a product: a channel for questions, a response time, a deprecation policy for old versions, and a way for developers to ask for changes.
7. **Pave day two.** Cover what happens after the first deploy: upgrades, marking a service or template version `deprecated` in the catalog, and a decommission path that removes the database, queue, dashboards, alerts and catalog entry when a service is retired.
8. **Measure outcomes.** Time to a first deploy in staging (9 working days down to 20 minutes at Acme), how far services lag the current template, incidents and change failure rate on and off the path, and what developers say in surveys. DORA's 2024 research associated developer independence, being able to do a task without waiting for another team, with about 5% higher productivity for individuals and teams, and its 2025 research found that the platform capability most associated with a good developer experience was clear feedback on the outcome of a task. When a template run or a pipeline fails, say why.
9. **Add a path when a journey keeps repeating.** When a third team builds a data pipeline by hand, a data-pipeline path is worth its upkeep; one team's preference isn't. Every new path needs an owner willing to keep it current.

## Where it fits

- [Platform as a Product](../platform-as-a-product/): the platform team runs Launchpad like a product, with developers as its customers and adoption that has to be earned. This page follows one route through that platform from end to end.
- [Team Topologies](../team-topologies/): Skelton and Pais (second edition, 2025) treat cognitive load as a design principle; a platform team exists to take load off stream-aligned teams such as delivery, and a golden path is one of the most visible ways it does so.
- [Kubernetes](../kubernetes/) runs every path service; the template creates the namespace and deploys through the shared Helm chart.
- [GitOps](../gitops/) can carry the deploy step: the pipeline changes the desired state in Git, and an agent in the cluster applies it.
- [Continuous Delivery](../continuous-delivery/): the shared pipeline builds each image once and promotes it through the same stages for every service on the path.
- [Infrastructure as Code](../infrastructure-as-code/): the database and queue come from reviewed, versioned Terraform modules, the same for every service.
- [HashiCorp Vault](../vault/) issues the database credentials at run time, so no secret is copied into a repository.
- [Prometheus & Grafana](../prometheus/) and [Golden Signals, RED & USE](../golden-signals/) give every new service the same dashboard and symptom-based alerts from its first deploy.
- [Eliminating Toil](../eliminating-toil/): tickets for namespaces, databases and secrets are toil, and a path is one way to remove them.
- [The Twelve-Factor App](../twelve-factor-app/): a template is a good place to build in its rules, such as configuration in the environment and logs written to standard output.
- [You Build It, You Run It](../you-build-it-you-run-it/): the owner the catalog names is the team that gets paged.
- [Policy as Code](../policy-as-code/) checks the guardrails in CI and at deploy time, for services on the path and off it.

## When to use it

- **Many teams building similar services.** With Acme's 60 engineers and 40 services, the same plumbing was being built and maintained over and over; a path pays for its upkeep when new services are frequent or when many existing services need the same upgrades.
- **When security and operations need to be consistent.** Base images, scanning, secrets handling and alert routing are easier to keep right in one maintained place than in 40 copies.
- **Onboarding.** A new engineer, or a team new to a kind of service, gets a working service and its documentation on the first day.

Where it doesn't fit, or needs adapting:

- **A few teams and a few services.** A path needs an owner, upgrades and support. For one or two teams a documented checklist and a well-kept example repository may be enough.
- **Legacy systems** that can't be rebuilt from the template. Register them in the catalog with an owner anyway, and bring them onto the path when they are next rebuilt.
- **Regulated workloads.** A path can produce the evidence auditors ask for (scan results, recorded approvals in the pipeline), but some services, like `payments-ledger`, need stricter variants or their own route.
- **Different kinds of work.** Data pipelines, machine-learning jobs and mobile apps need paths of their own; stretching one service template over all of them produces a template nobody can follow.
- **Expect a dip.** DORA notes that platform engineering often follows a J-curve: early gains, a dip as complexity grows, then a higher level of performance as the platform matures.

## Common pitfalls

- **A golden cage.** Making the path mandatory, with no way to leave it, pushes teams with a real need into workarounds out of sight, such as `kubectl apply` run by hand. Keep the path optional and make it the easiest way to work; let a team leave when it has a reason, and make clear that it then owns the extra work, while the catalog entry and a named owner stay mandatory for everyone.
- **Templates that scaffold once, then rot.** A copied template never changes again, so every service keeps the base image, pipeline and alert rules of the version it started from. Keep the moving parts as versioned references, raise upgrade pull requests, record the template version on each service and watch the services that lag.
- **Too many paths.** Fourteen templates for the same few journeys, three of them kept current, leave teams guessing which one the platform team supports, and spread a small team thin. Offer a few paths for the common journeys, give each an owner, and retire the rest.
- **Day one only.** A path that ends at the first deploy leaves upgrades, deprecation and decommissioning to every team, and retired services leave databases, queues and alerts behind. Pave day two as well.
- **Counting template runs.** 120 runs a quarter shows that the template gets used, not that services are better. Measure outcomes: time to a first deploy, upgrade lag, incidents and change failure rate, and developer satisfaction.
- **A portal without a platform.** Installing Backstage and listing services in it doesn't pave anything. The value is in the automation behind the form, and in the people who keep it working.
- **Hiding too much.** A template that hides what it created leaves teams unable to debug it at 02:14. Generate readable configuration, link each service to the documentation of the pieces it uses, and make failures explain themselves.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Platform as a Product](../platform-as-a-product/) — An internal developer platform run like a product: developers are its customers, self-service is its interface, adoption is earned.
- [Team Topologies](../team-topologies/) — Four team types and three interaction modes that organise teams around the flow of change and keep cognitive load in check.
- [Infrastructure as Code](../infrastructure-as-code/) — Define infrastructure in version-controlled code: review a plan, apply it the same way in every environment and catch drift.
- [Continuous Delivery](../continuous-delivery/) — Keep every change releasable: a deployment pipeline builds once, tests in stages and promotes the same artifact to production.
- [Golden Signals, RED & USE](../golden-signals/) — What to measure and alert on: latency, traffic, errors and saturation, RED for request-driven services and USE for resources.
- [The Twelve-Factor App](../twelve-factor-app/) — Twelve rules for apps that deploy cleanly anywhere: config in the environment, stateless processes, separate build, release and run.
- [Kubernetes](../kubernetes/) — A container orchestrator: you declare the desired state, and controllers keep pods scheduled, healthy and reachable.
- [Policy as Code](../policy-as-code/) — Write rules as code and check them automatically in CI and at deploy time, so guardrails replace manual approval gates.

## References

- [Gary Niemen — How We Use Golden Paths to Solve Fragmentation in Our Software Ecosystem (Spotify Engineering, August 2020)](https://engineering.atspotify.com/2020/08/how-we-use-golden-paths-to-solve-fragmentation-in-our-software-ecosystem)
- [Philip Fisher-Ogden, Greg Burrell and Dianne Marsh — Full Cycle Developers at Netflix: Operate What You Build (Netflix Technology Blog, May 2018; archived copy)](https://web.archive.org/web/20260930213015/https://netflixtechblog.com/full-cycle-developers-at-netflix-a08c31f83249)
- [CNCF TAG App Delivery — Platforms White Paper (v1, March 2023)](https://tag-app-delivery.cncf.io/whitepapers/platforms/)
- [DORA — Capabilities: Platform engineering](https://dora.dev/capabilities/platform-engineering/)
- [Matthew Skelton and Manuel Pais — Team Topologies, second edition (IT Revolution, 2025)](https://teamtopologies.com/book)
- [CNCF — Backstage (project page: incubating since March 2022)](https://www.cncf.io/projects/backstage/)
- [Backstage blog — Announcing Backstage (March 2020)](https://backstage.io/blog/2020/03/16/announcing-backstage/)
- [Backstage documentation — What is Backstage?](https://backstage.io/docs/overview/what-is-backstage)
- [Backstage documentation — Software Catalog](https://backstage.io/docs/features/software-catalog/)
- [Backstage documentation — Software Templates](https://backstage.io/docs/features/software-templates/)
- [Backstage documentation — Writing Templates](https://backstage.io/docs/features/software-templates/writing-templates)
- [Backstage documentation — TechDocs](https://backstage.io/docs/features/techdocs/)
- [Backstage documentation — Well-known annotations (backstage.io/source-template)](https://backstage.io/docs/features/software-catalog/well-known-annotations)
- [Niklas Gustavsson — Fleet Management at Spotify (Part 1): Spotify's Shift to a Fleet-First Mindset (April 2023)](https://engineering.atspotify.com/2023/04/spotifys-shift-to-a-fleet-first-mindset-part-1)
- [Matt Brown — Fleet Management at Spotify (Part 3): Fleet-wide Refactoring (May 2023)](https://engineering.atspotify.com/2023/05/fleet-management-at-spotify-part-3-fleet-wide-refactoring)
- [Renovate documentation — Docker (base image updates)](https://docs.renovatebot.com/docker/)
- [Renovate documentation — Custom manager support using regex](https://docs.renovatebot.com/modules/manager/regex/)
- [Renovate documentation — Automated dependency updates for Copier](https://docs.renovatebot.com/modules/manager/copier/)
- [Copier documentation — Updating a project](https://copier.readthedocs.io/en/stable/updating/)
- [cruft — keep projects made from Cookiecutter templates up to date](https://cruft.github.io/cruft/)
- [OpenTelemetry — Injecting auto-instrumentation with the Operator](https://opentelemetry.io/docs/platforms/kubernetes/operator/automatic/)
- [Docker Hub — openjdk official image (deprecation notice)](https://hub.docker.com/_/openjdk)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
