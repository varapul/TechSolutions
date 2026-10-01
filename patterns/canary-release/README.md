<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🚀 Deployment & Release](../../README.md#deployment--release)

# Canary Release

> Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Canary Release" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/canary-release.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Deploy the canary** | Deploy **v2** as a small canary next to the stable **v1** fleet, without touching v1. The router (a load balancer, ingress or service mesh) sends it a fixed share of requests, 5% here, so a bad release can only reach a small slice of users. |
| **2 · Compare metrics** | An automated analysis compares the canary with the **v1 baseline** over the same time window. Error rate and p95 latency must stay within limits set relative to v1, and the verdict waits until enough requests have arrived to tell a real regression from noise. Here it **passes**. |
| **3 · Ramp up** | Each passing analysis moves the canary to the next weight (25%, then 50%), and v2 scales out ahead of the extra load. The analysis runs again at every step, so a problem that only shows up under more traffic is still caught before everyone is exposed. |
| **4 · Promote** | After the last check, 100% of traffic goes to v2, the v1 instances are scaled down and retired, and v2 becomes the stable baseline that the next release is canaried against. Had any analysis failed, the controller would have shifted all traffic back to v1 automatically and scaled the canary away. |
<!-- END GENERATED: header -->

## The problem

Production is where a release first meets real traffic, real data and real dependencies. Switch every instance to a new version at once (in place, or with a single blue-green cut-over) and a bad build reaches every user at the same moment: every mistake has a blast radius of 100%.

## How it works

Run the new version next to the old one, give it a small slice of traffic, and let production metrics decide whether it gets more. The name comes from the canaries miners carried as an early warning.

- A **router** splits traffic by weight: a load balancer with weighted targets, an ingress controller, an API gateway or a service mesh. The weight follows a schedule agreed in advance, such as 5% → 25% → 50% → 100%.
- At every step an **automated analysis** compares v2 with v1 on a few user-facing metrics (error rate, latency percentiles, saturation, one or two business signals) and returns pass or fail.
- **Pass** moves on to the next weight. After the last step v2 becomes the stable version and v1 is scaled down. **Fail** sets v2's weight back to 0%, and v1, which never stopped running, serves everyone again.

**Who gets the canary.** A random share of requests is the simplest and most representative choice. Sending internal users first ("dogfooding") catches obvious breakage before customers see it. One region, zone or cell keeps the canary inside a single fault domain, which is how large platforms roll out in waves. Make the assignment **sticky** by hashing a stable key (user ID, session cookie, tenant) into buckets 0–99 and sending the buckets below the weight to v2. A user then stays on one version for a whole session, and raising the weight from 5% to 25% keeps the first 5% on v2 instead of reshuffling everyone.

**Enough signal.** A 1% canary on a service handling 10 requests per second sees about 6 requests a minute. At a 0.5% error rate that is roughly one error every half hour, far too few to separate a regression from noise. Size each step's weight and duration so every metric collects enough samples (Spinnaker suggests at least 50 data points per metric) and the window covers peak hours, cache warm-up and scheduled jobs.

**A baseline, not just thresholds.** Fixed limits such as "error rate below 1%" catch outages, but they miss regressions that stay under the limit and they fire when v1 suffers too. Compare canary and baseline over the *same* window instead: a before/after comparison is skewed by the time of day. The diagram uses the running v1 fleet as the baseline; ideally the baseline is a fresh copy of v1 with the canary's size and start time, so the old fleet's warm caches and long uptime don't flatter v1. Kayenta, Spinnaker's canary analysis service, uses a Mann-Whitney U test to decide whether a difference is real. Keep a few absolute SLO checks as guardrails.

**Automated rollback.** The analysis and the rollback rule are fixed before the release and applied by a controller, not by someone watching a dashboard. That only stays fast and safe while v1 can take 100% of the traffic again, so keep v1 at full size until promotion, or scale it back up before shifting traffic back to it.

## When to use it

- Services with enough traffic to produce a signal within minutes or hours.
- Releases whose old and new versions can run side by side.
- Risks that only show up at runtime: performance, resource use, dependencies, configuration. Roll out config and feature-flag changes the same way.
- It fits less well for low-traffic services (bake longer, or add synthetic traffic) and for work that isn't request-driven, such as queue consumers and batch jobs. Canary those by partition or with a single v2 consumer.

## Trade-offs

- **Two versions are live at once.** Shared state must suit both: the database schema, caches, event formats and APIs. Keep schema changes backward-compatible with **expand and contract** ([parallel change](https://martinfowler.com/bliki/ParallelChange.html)): add new structures in a form v1 tolerates, ship the code that uses them, and drop the old ones only when no running version needs them. Rolling back the code doesn't roll back data the canary has written.
- **Slower releases.** A full ramp takes from tens of minutes to hours, and the SRE Workbook advises running one canary at a time.
- **Some users still hit the bug.** Keep the first step small, and let severe failures (a crash loop, a burst of 5xx errors) abort at once instead of waiting for the end of the window.
- **Per-version telemetry is required.** Every metric, log and trace must carry the version, or there is nothing to compare.

**Canary, blue-green or feature flags?**

| | Canary release | Blue-green deployment | Feature flags |
|---|---|---|---|
| What changes | a new build gets a growing share of traffic | all traffic moves to a second environment in one step | code paths inside one build, per user or segment |
| Rollback | set the canary weight to 0% | switch back to the old environment | turn the flag off |
| Extra capacity | the canary instances | a full second environment during the switch | none |
| Best at | runtime risk in the build: performance, leaks, dependencies | a fast, clean cut-over with an instant way back | product risk: dark launches, per-customer rollout, experiments |

They combine well: a canary build usually ships new features dark behind flags, and blue-green infrastructure that shifts traffic in steps is a canary. A rolling update also runs two versions at once, but it advances by instance, usually with no analysis gate between batches.

## Implementation notes

- **Kubernetes:** Argo Rollouts (`setWeight`, `pause` and `analysis` steps, with `AnalysisTemplate`s that query Prometheus, Datadog and others) and Flagger (`stepWeight`, `maxWeight`, `threshold`) run the whole loop. They shift traffic through a service mesh such as Istio or Linkerd, an ingress controller, or weighted `backendRefs` on Gateway API routes.
- **Managed services, as examples:** ALB weighted target groups, API Gateway canary deployments and CodeDeploy traffic shifting for Lambda (rolled back automatically on CloudWatch alarms) on AWS. Cloud Run revision traffic splitting and Cloud Deploy canaries on Google Cloud. Container Apps revision splitting and App Service deployment-slot routing on Azure.
- **Scale v2 before raising its weight** (Argo Rollouts' `setCanaryScale`, or autoscaling with headroom), so it is judged on its code, not on overload.
- **Let testers in first** with a header or cookie that forces v2. Flagger and most meshes support header and cookie matching.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Blue-Green Deployment](../blue-green-deployment/) — Run the new version beside the old one and switch all traffic in one step.
- [Feature Flags](../feature-flags/) — Deploy code dark, then turn features on per user or percentage at runtime.
- Rolling Update *(planned)* — Replace instances batch by batch while the service stays up.
- Shadow Traffic *(planned)* — Mirror live requests to the new version and compare results without affecting users.
- [SLOs & Error Budgets](../slo-error-budgets/) — Measure SLIs against an objective and alert on error-budget burn rate, not on every blip.
- Expand and Contract *(planned)* — Change a schema or API in backward-compatible steps: expand, migrate, then contract.
- Service Mesh *(planned)* — Sidecar proxies plus a control plane: mTLS, retries and traffic shifting without touching app code.
- Cell-Based Architecture *(planned)* — Many isolated, identical cells behind a thin router contain the blast radius of any failure.

## References

- [Google SRE Workbook — Canarying Releases](https://sre.google/workbook/canarying-releases/)
- [Danilo Sato — CanaryRelease (martinfowler.com)](https://martinfowler.com/bliki/CanaryRelease.html)
- [Spinnaker — Best practices for configuring canary (Kayenta)](https://spinnaker.io/docs/guides/user/canary/best-practices/)
- [Argo Rollouts — Canary deployment strategy](https://argo-rollouts.readthedocs.io/en/stable/features/canary/)
- [Argo Rollouts — Analysis & Progressive Delivery](https://argo-rollouts.readthedocs.io/en/stable/features/analysis/)
- [Flagger — Deployment strategies](https://docs.flagger.app/usage/deployment-strategies)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
