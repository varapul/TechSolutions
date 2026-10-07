
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧭 DevOps & SRE Principles](../../README.md#devops--sre-principles)

# Continuous Delivery

> Keep every change releasable: a deployment pipeline builds once, tests in stages and promotes the same artifact to production.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Continuous Delivery" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/continuous-delivery.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · A release everyone fears** | Before: the checkout team cuts a release branch every four weeks and ships about 140 commits in one go. Test, staging and production each get their own build, so staging never tested the binary that production runs, and a 40-step runbook is worked through by hand on a Saturday night. Hotfixes skip the tests and go straight to production. |
| **2 · The deployment pipeline** | Every commit to `main` starts the **deployment pipeline**. The commit stage compiles, runs the unit tests and static analysis and builds the image `checkout:1.42.0` once, so the developer has feedback after 6 minutes; the registry stores the image by its digest. The acceptance stage (14 min) and staging (5 min) deploy that same image with the same script, and 25 minutes after the commit any green build can go to production with one click, followed by a canary. |
| **3 · Stop the line, ship small** | Commit `8d41e0` fails an acceptance test, so `1.43.0` is never promoted, and the team reverts it before starting anything else: the revert is pushed 4 minutes after the red. Deploys become small and routine, about six a day with one to three commits each (Acme's numbers), and unfinished features ship dark behind a feature flag. With **continuous delivery** a person clicks Deploy; with **continuous deployment** every green build goes to production automatically. |
| **4 · Pitfalls and limits** | A pipeline that takes an hour or more, and flaky tests that teach people to ignore red, push teams back to big batches. A staging environment patched by hand drifts from production, and a schema change needs expand and contract so that the old and new versions can run side by side. Regulated teams keep their approvals, as recorded steps in the pipeline rather than a meeting. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's checkout team used to ship the way many teams still do. Work piled up on a release branch for four weeks, about 140 commits, and went out as one release. The build server made a fresh build for each environment, so the binary that passed QA in the test environment, the one checked in staging and the one that reached production were three different builds: "it worked in staging" said little about production. The release itself was a 40-step runbook worked through by hand on a Saturday night, and urgent fixes skipped all of it.

Each habit makes the next release riskier. A big batch changes many things at once, so when something breaks nobody knows which of the 140 commits caused it. Rebuilding for each environment means the tests never ran on the thing that ships. A manual runbook fails in a new way every time. And because releasing hurts, the team does it less often, so every release grows bigger and hurts more. (Acme's numbers on this page are the example's own, not research findings.)

## How it works

**Continuous delivery** keeps the software releasable at all times, so that putting a version into production is a routine business decision rather than a project. Jez Humble and David Farley set out the approach in *Continuous Delivery: Reliable Software Releases through Build, Test, and Deployment Automation* (Addison-Wesley, 2010). Humble's site, continuousdelivery.com, describes it as being able to move changes of every kind, from new features and configuration to bug fixes and experiments, into production safely, quickly and sustainably. Martin Fowler offers a quick test (bliki, 2013): a business sponsor could ask for the current version to go live at short notice, and nobody would panic.

The central mechanism is the **deployment pipeline**, which Humble traces back to ThoughtWorks projects and first wrote up with Dan North and Chris Read for the Agile 2006 conference. Every commit to the mainline enters it, and it is the only route to production:

1. The **commit stage** compiles the code, runs the unit tests and static analysis, and builds the deployable artifact, here the container image `checkout:1.42.0`. It is tuned to take minutes (6 at Acme), and when it fails, fixing it comes before any new work.
2. The **acceptance stage** deploys that artifact to a production-like environment and runs the automated acceptance tests (14 minutes).
3. **Later stages** add the confidence that is slower or more expensive to get: performance tests, exploratory testing, a staging environment (5 minutes at Acme). A stage can run automatically or wait for a person to approve it.
4. **Production** is the last stage. Any version that passed everything can be deployed with one action, usually through a deployment strategy such as a canary.

Fowler's entry on the deployment pipeline (bliki, 2013) explains the order: the early stages are fast and catch most problems, the later ones are slower and more thorough, so feedback arrives quickly without giving up depth. The pipeline also leaves an audit trail of which change ran where.

Four practices that continuousdelivery.com recommends make the stages worth trusting:

- **Only build packages once.** Promote the same artifact from stage to stage, so production runs exactly what was tested. With containers, deploy the image by its digest (`checkout@sha256:5d0c9e…`): a tag can be moved to another image, a digest can't (Kubernetes documentation, *Images*).
- **Deploy the same way to every environment**, with the same scripts, so the deployment itself has been rehearsed many times before it reaches production.
- **Smoke-test every deployment**, so a stage fails fast when a dependency or a setting is missing.
- **Keep environments similar**: the same operating system and middleware versions, configured the same way, from configuration kept in version control.

Behind them sit the site's five principles: build quality in, work in small batches, let computers do the repetitive work so people can solve problems, pursue continuous improvement relentlessly, and make everyone responsible for delivery as a whole.

**Delivery or deployment?** With continuous delivery every green build *can* go to production, and a person decides when. With **continuous deployment** every change that passes the pipeline goes to production automatically, often many times a day, and you need continuous delivery before you can do it (Fowler, 2013). DORA's capability guide adds that continuous deployment suits web services but not firmware or mobile apps, while continuous delivery works for every kind of software, firmware and mainframes included, and in regulated industries too.

**Continuous integration** comes first: everyone merges into the mainline at least daily, and an automated build checks every merge. Fowler's article on it, last revised in January 2024, calls the Extreme Programming guideline of a ten-minute build reasonable for most projects. Continuous delivery carries this through to the production deployment, but DORA warns that CI is only one ingredient: continuous delivery also takes test and deployment automation, trunk-based development, version control for everything, database change management, monitoring and loosely coupled teams.

**What the research says.** DORA's State of DevOps research, summarised in its continuous delivery guide, found that teams who do well at it show higher software delivery performance and availability, spend less time on rework and unplanned work (2016 and 2018 reports), and report less deployment pain and less burnout. These findings come from survey-based research: read them as strong, repeated associations, not guarantees.

## Putting it into practice

1. **Version everything that defines a release:** the application code and tests, the Dockerfile, the deployment manifests or Helm charts, the infrastructure code (Terraform or OpenTofu, for example) and the pipeline definition itself (a GitHub Actions workflow, a `.gitlab-ci.yml`, a `Jenkinsfile`).
2. **Model the current process as a pipeline first**, as Fowler suggests, then automate its slowest and most error-prone steps one at a time. Acme started with the build and the 40-step runbook.
3. **Build once and promote by digest.** The commit stage pushes one image to the registry, tagged with the version and the commit, and every later stage deploys `checkout@sha256:…`. Keep environment-specific settings out of the image, in configuration that each environment supplies.
4. **Order the stages for fast feedback:** cheap, fast checks first, slow suites later and in parallel. Keep the commit stage within about ten minutes.
5. **Make a red pipeline the team's first priority.** Fix it within minutes or revert the change, and nobody stacks new commits on a broken build. At Acme the revert of `8d41e0` went in 4 minutes after the red.
6. **Separate deployment from release.** Ship unfinished work dark behind a feature flag, and make the production stage a canary or blue-green deployment, so every deployment is small and easy to undo.
7. **Make production one action**, a button that deploys a chosen green build, and decide per service whether a person presses it or every green build goes out by itself.
8. **Measure the flow** with DORA's software delivery metrics: change lead time, deployment frequency, change fail rate, failed deployment recovery time and, since 2024, deployment rework rate. Acme's checkout service went from one release every four weeks to about six deployments a day, with one to three commits each.

## Where it fits

- [Trunk-based development](../trunk-based-development/) and continuous integration feed the pipeline: small changes merged every day keep every pipeline run small.
- The production stage is a deployment strategy: [canary release](../canary-release/), [blue-green deployment](../blue-green-deployment/) or [rolling update](../rolling-update/). [GitOps](../gitops/) is another way to perform that step: the pipeline writes the new digest to Git, and an agent in the cluster applies it.
- [Feature flags](../feature-flags/) separate deploying code from releasing a feature.
- [Expand and contract](../expand-and-contract/) lets schema changes go out with ordinary deployments while the old and new versions run side by side.
- [Immutable infrastructure](../immutable-infrastructure/) applies "build once" to machine images, and [infrastructure as code](../infrastructure-as-code/) keeps the environments themselves in version control.
- [DORA metrics](../dora-metrics/) show whether the pipeline is making delivery faster and safer.
- The artifact is usually a container image ([Docker](../docker/)), deployed to a platform such as [Kubernetes](../kubernetes/).

## When to use it

Continuous delivery pays off for software a team changes often and runs itself: web services, APIs, data pipelines, internal tools. The investment is real: automated tests the team trusts, production-like environments, a pipeline that someone maintains, and often architectural changes so that one service can be deployed without coordinating with others. DORA's guide describes a J curve: a transformation often gets harder before it gets better.

Some settings need adapting:

- **Mobile apps, firmware and installed software.** The pipeline still builds once and keeps every build releasable, but the last stage is a store submission or a staged rollout to devices, so continuous deployment rarely fits.
- **Regulated environments.** Keep the controls and implement them in the pipeline: peer review of every change for segregation of duties, and approval steps that record who approved what and when (GitHub environments with required reviewers or GitLab deployment approvals, for example). DORA's 2019 research found that approval by external change boards went with lower delivery performance, and found no evidence that it lowered the change fail rate.
- **Legacy systems with few tests.** Start by automating the build and the deployment, add tests where the code changes, and grow the pipeline one stage at a time.
- **Small teams.** A commit stage and a production deployment behind a canary may be all the pipeline needs; the principle is releasability, not a number of stages.

It returns less for software that rarely changes and for short-lived prototypes, where a reliable, scripted release may be enough.

## Common pitfalls

- **Automating the deploy step and keeping big batches.** A script that deploys a 140-commit release still deploys a big batch. DORA warns that deploying more often without changing the process and the architecture tends to raise failure rates and burn teams out. Shrink the batch instead: merge daily and deploy small changes.
- **A slow pipeline.** When a run takes an hour or more, people stop waiting for it and pile several commits into each run, and when it fails nobody knows which commit to blame. Keep the commit stage within about ten minutes, move slow suites later and run them in parallel, and watch the pipeline's duration like any other metric.
- **Flaky tests.** A test that fails at random teaches the team to re-run and ignore red, and soon real failures are ignored too (Fowler, *Eradicating Non-Determinism in Tests*, 2011). Quarantine a flaky test at once, then fix or delete it.
- **Rebuilding for each environment.** A rebuild can pick up a different dependency or setting. Build once and promote the digest.
- **Environments built by hand.** Hand patches make staging drift from production until "it worked in staging" means nothing. Build every environment from code, and replace rather than patch.
- **A side door for hotfixes.** If emergencies skip the pipeline, the riskiest changes get the least testing. DORA sets the goal of using the regular process for emergency changes too; make the pipeline fast enough for that.
- **Schema changes tied to code changes.** If the code and the schema must change together, the old and new versions can't run side by side, and canaries and rollbacks break. Use expand and contract.
- **Approvals as meetings.** A weekly change board turns every change into part of a batch. Record approvals as steps in the pipeline instead.
- **Tools without practices.** Installing a CI/CD product doesn't deliver continuously by itself: DORA notes that modern tooling without the technical practices and process changes doesn't bring the expected benefits.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Trunk-Based Development](../trunk-based-development/) — Everyone merges small changes into one main branch at least daily; feature flags hide unfinished work instead of long branches.
- [DORA Metrics](../dora-metrics/) — Measure software delivery by throughput and stability: how often and how fast changes reach production, and how often they fail.
- [Feature Flags](../feature-flags/) — Deploy code dark, then turn features on per user or percentage at runtime.
- [Canary Release](../canary-release/) — Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back.
- [Blue-Green Deployment](../blue-green-deployment/) — Run the new version beside the old one and switch all traffic in one step.
- [Rolling Update](../rolling-update/) — Replace instances batch by batch while the service stays up.
- [Immutable Infrastructure](../immutable-infrastructure/) — Never patch servers in place: bake a new image and replace them.
- [GitOps](../gitops/) — Git holds the desired state; an agent continuously reconciles the cluster to match it.
- [Expand and Contract](../expand-and-contract/) — Change a schema or API in backward-compatible steps: expand, migrate, then contract.
- [Infrastructure as Code](../infrastructure-as-code/) — Define infrastructure in version-controlled code: review a plan, apply it the same way in every environment and catch drift.

## References

- [Jez Humble and David Farley — Continuous Delivery (Addison-Wesley, 2010)](https://www.informit.com/store/continuous-delivery-reliable-software-releases-through-9780321601919)
- [Jez Humble — What is Continuous Delivery? (continuousdelivery.com)](https://continuousdelivery.com/)
- [Jez Humble — Principles of continuous delivery](https://continuousdelivery.com/principles/)
- [Jez Humble — Patterns: the deployment pipeline and low-risk releases](https://continuousdelivery.com/implementing/patterns/)
- [Jez Humble — Configuration management](https://continuousdelivery.com/foundations/configuration-management/)
- [Martin Fowler — ContinuousDelivery (2013)](https://martinfowler.com/bliki/ContinuousDelivery.html)
- [Martin Fowler — DeploymentPipeline (2013)](https://martinfowler.com/bliki/DeploymentPipeline.html)
- [Martin Fowler — Continuous Integration (revised January 2024)](https://martinfowler.com/articles/continuousIntegration.html)
- [DORA — Capabilities: Continuous delivery](https://dora.dev/capabilities/continuous-delivery/)
- [DORA — Capabilities: Streamlining change approval](https://dora.dev/capabilities/streamlining-change-approval/)
- [DORA — Software delivery performance metrics](https://dora.dev/guides/dora-metrics/)
- [Martin Fowler — Eradicating Non-Determinism in Tests (2011)](https://martinfowler.com/articles/nonDeterminism.html)
- [Kubernetes documentation — Images (tags and digests)](https://kubernetes.io/docs/concepts/containers/images/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
