<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🚀 Deployment & Release](../../README.md#deployment--release)

# Feature Flags

> Deploy code dark, then turn features on per user or percentage at runtime.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Feature Flags" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/feature-flags.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Deploy dark** | Build 41 contains both checkout paths and one decision point, `if (flags.enabled("new-checkout", user))`. The flag is **off**, so every user still gets the old path on every instance. Deploying the code and releasing the feature are now two separate decisions. |
| **2 · Target, then roll out** | A targeting rule turns the flag on for staff first; a percentage rollout then adds 10% and later 50% of customers. The flag service pushes every change to the SDK inside each instance (streaming, or the SDK polls), and the SDK evaluates in memory: no network call per check and no redeploy. Bucketing is deterministic: a hash of the flag key and the user ID gives a bucket from 0 to 99, and a user is in when the bucket is below the percentage, so the same user always gets the same answer and raising the percentage only adds users. |
| **3 · Kill switch** | The new path's error rate climbs past the alert threshold, so the flag is switched **off**. Within seconds (one polling interval at worst) every instance serves the old path again, with no rollback deployment: the build has not changed. If the flag service is unreachable, each SDK keeps serving the last rules it received, and falls back to the default coded in the app (off) if it never received any. |
| **4 · Finish and clean up** | Build 42 fixes the bug and the flag goes to **100%**. The next release, build 43, deletes the flag check and the old code path, and the flag is archived in the flag service. A release flag is temporary: left in place it is dead code, a branch nobody tests and a switch somebody can flip by mistake. |
<!-- END GENERATED: header -->

## The problem

Without flags, deploying code and exposing a feature are the same event. Unfinished work either waits on a long-lived branch that drifts away from the mainline, or reaches every user the moment it is deployed. When the feature misbehaves in production the only way back is another deployment, which takes minutes at best and takes every unrelated change in that build with it. And there is no way to show the feature to staff, to one customer or to 10% of users first.

## How it works

A feature flag (or feature toggle) is a decision point in the code whose answer comes from configuration that can change while the program runs: `if (flags.enabled("new-checkout", user))` runs the new checkout, `else` the old one.

- **One build, both paths.** The new code ships to every instance behind a flag that is **off**: it is *deployed dark*. Deploying becomes a technical event, and releasing becomes a separate decision that can be made later, per user.
- **Rules live in a flag service; decisions are made locally.** The control plane holds each flag's state, its targeting rules (staff, one tenant, a country) and its percentage rollout. A server-side SDK in every instance keeps a copy of those rules in memory and evaluates them in-process, so a flag check costs no network call. Changes reach the SDKs over a streaming connection or by polling.
- **Percentages are deterministic.** The SDK hashes the flag key together with the user ID into a bucket and compares it with the rollout percentage. The same user gets the same answer on every instance and on every request, each flag splits the users differently, and raising the percentage only adds users. The diagram uses 100 buckets; products differ in the hash and in the granularity.
- **Off is one switch away.** Turning the flag off reaches every instance within seconds (one polling interval at worst), with no deployment. If the flag service is unreachable, the SDKs keep evaluating the last rules they received. An SDK that never received any returns the default passed in the code, so that default must be the safe path.
- **The flag is removed at the end.** At 100% the flag check and the old path are deleted from the code and the flag is archived.

In a [canary release](../canary-release/) or a [blue-green deployment](../blue-green-deployment/) a router shifts traffic between two deployed versions. Here there is one version, and the choice is made in code, per user, at runtime. They combine well: roll the *build* out with a canary, then release the *feature* with a flag.

### Four kinds of flag

Pete Hodgson sorts flags (he calls them toggles) along two axes, how long a flag lives and how dynamic its decision is, and argues that the categories need different handling even when one tool serves them all.

| Kind | What it is for | Lives for | Decision |
|---|---|---|---|
| **Release** | Hiding unfinished or unannounced code that is already on the mainline | Days to a few weeks | Mostly static: the same for everyone until the rollout starts |
| **Experiment** | A/B and multivariate tests | As long as the test needs: hours to weeks | Per request, by cohort, and unchanged while the test runs |
| **Ops** | Kill switches and load shedding | Mostly short; a few kill switches stay for years | Must change within seconds, with no deployment |
| **Permission** | Features for some users only: plans, beta programmes, internal users | Years | Per request, by user |

The handling follows from the table: a release flag gets an expiry date and can be a plain `if`, a permission flag lives for years and deserves a proper abstraction in the code, and an ops flag must be changeable in seconds by whoever is on call.

The flag in the diagram is a release flag whose rollout borrows from the others. "Staff first" is a permission-style rule, the percentage is a canary cohort, and the off switch serves as a kill switch for as long as the rollout lasts.

## When to use it

- **Trunk-based development and continuous delivery.** Unfinished work merges to the mainline every day behind a flag instead of waiting on a long-lived branch, and the mainline stays releasable.
- **Progressive delivery of a risky change:** staff first, then a few percent of users, with a metric watched at every step.
- **A launch date that is not the deployment date:** marketing campaigns, early-access customers, one region at a time.
- **Operational switches:** turning off an expensive or non-critical feature under load, as a manual [circuit breaker](../circuit-breaker/).
- **Experiments**, together with the measurement they need (see the implementation notes).

**When not to.** Martin Fowler's advice is that a release flag should be the last choice. First try to split the feature into small pieces that can be released as they are, or build everything except the user-facing entry point and add that last. A flag is also the wrong tool as a substitute for design: a permanent `if` per customer is a configuration or entitlement model that nobody designed. And don't let a flag hide a migration that nobody finishes, because the old path, the old schema and the old tests stay alive for as long as the flag does.

## Trade-offs

- **Every flag doubles a code path.** Both sides must work, so both must be tested. Testing every combination is impossible (20 on/off flags give about a million combinations) and unnecessary: Hodgson's convention is to test the configuration that is about to go live, the fallback with those flags off, and often everything on.
- **Stale flags are debt and risk.** A flag left behind is dead code, a branch nobody tests and a switch somebody can flip by mistake. In 2012 Knight Capital repurposed a flag that had once activated a function it stopped using in 2003. The new code reached seven of its eight servers; on the eighth, the flag started the old function. In about 45 minutes the firm made more than 4 million unintended executions and lost over $460 million.
- **Consistency across services.** A request that passes through several services must not see the feature on in one and off in the next. Either evaluate once at the edge and pass the decision along with the request, or have every service evaluate the same flag with the same key, so the hash gives the same bucket everywhere. Rules also reach different SDKs at slightly different moments, so for a few seconds after a change two instances can disagree.
- **A new way to change production.** The flag service changes behaviour faster than any deployment, and usually with fewer checks. It needs access control, an audit trail and, for risky flags, a review step. Treat a flag change like a release: make it gradually and watch the metrics.
- **Flags don't undo data.** Turning the flag off stops the new code, not the rows it has already written. Pair the flag with **expand and contract** ([parallel change](https://martinfowler.com/bliki/ParallelChange.html)) so that each path can read what the other has written.

## Implementation notes

- **Server-side or client-side evaluation.** A server-side SDK receives the complete rule set and evaluates it locally. A browser or mobile SDK must not: rules can contain other users' IDs, segment definitions and the names of unreleased features, and anything shipped to a client can be read. A client-side SDK therefore sends one user's context and receives only the results evaluated for that context, and it uses a client-side key, never the server-side SDK key. Enforce the decision on the server as well: a hidden button is not access control.
- **Flags, configuration and entitlements.** A release flag is temporary and belongs to the team shipping the change. Configuration (timeouts, endpoints, limits) is permanent and belongs in an external configuration store. What a customer has paid for is an entitlement: product data with its own source of truth, even when a permission flag reads it. When a flag never has to change at runtime, Hodgson prefers keeping its configuration in source control, where it gets review, history and the same pipeline as the code.
- **Hygiene.** Give every flag an owner, a kind and an expiry date when it is created, and make removing it part of "done". Some teams add the removal task when they add the flag, cap the number of live flags, or make a test fail when a flag outlives its date. Tools help: Unleash marks a flag *potentially stale* once it passes its expected lifetime (40 days for a release flag by default). Never reuse a flag key for a new purpose.
- **Keep the toggle points few.** Check the flag at the entry point of the feature, not on every line that differs, and wrap it in one function (`features.useNewCheckout(user)`) so the key appears once and the cleanup is a small change. For a change deep in the code, let the flag choose between two implementations of one interface (branch by abstraction).
- **Experiments need more than a flag.** An A/B test also needs an exposure event each time a user is given a variant, an outcome metric, and a sample size and statistical test decided in advance. Its allocation must stay fixed while it runs. OpenFeature's tracking API and the vendors' experimentation features provide the plumbing; they don't replace the statistics.
- **OpenFeature** is a CNCF incubating project that defines a vendor-neutral evaluation API, so application code doesn't depend on one vendor's SDK. The application asks a client for a flag key with a default value and an *evaluation context* (its *targeting key* identifies the user), a *provider* connects the client to the flag management system, and the default comes back whenever evaluation fails.
- **Products, as examples.** LaunchDarkly's server-side SDKs hold a streaming connection and evaluate from the cached rule set. Unleash's backend SDKs evaluate locally and poll every 15 seconds by default. The AWS AppConfig Agent polls and caches flag data next to the application, and AppConfig can deploy a change gradually and roll it back on a CloudWatch alarm. Azure App Configuration offers targeting and time-window filters and percentage rollouts.
- **Observe and automate.** Put the flag key and the variant served on traces, logs and error reports, or a regression can't be tied to the flag that caused it. OpenTelemetry defines a `feature_flag.evaluation` event for this, not yet stable. For flags that guard critical paths, let an alert on error rate or latency turn the flag off, the way a canary analysis rolls back.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Canary Release](../canary-release/) — Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back.
- [Blue-Green Deployment](../blue-green-deployment/) — Run the new version beside the old one and switch all traffic in one step.
- [Rolling Update](../rolling-update/) — Replace instances batch by batch while the service stays up.
- Shadow Traffic *(planned)* — Mirror live requests to the new version and compare results without affecting users.
- External Configuration Store *(planned)* — Keep configuration out of the deployment package, in a central store read at runtime.
- [Expand and Contract](../expand-and-contract/) — Change a schema or API in backward-compatible steps: expand, migrate, then contract.
- [Branch by Abstraction](../branch-by-abstraction/) — Introduce an abstraction, build the new implementation behind it, then switch over.
- [SLOs & Error Budgets](../slo-error-budgets/) — Measure SLIs against an objective and alert on error-budget burn rate, not on every blip.

## References

- [Pete Hodgson — Feature Toggles (aka Feature Flags)](https://martinfowler.com/articles/feature-toggles.html)
- [Martin Fowler — Feature Flag](https://martinfowler.com/bliki/FeatureFlag.html)
- [OpenFeature — Specification](https://openfeature.dev/specification/)
- [Trunk Based Development — Feature flags](https://trunkbaseddevelopment.com/feature-flags/)
- [LaunchDarkly Docs — Choosing an SDK type](https://launchdarkly.com/docs/sdk/concepts/client-side-server-side)
- [Unleash Docs — Stickiness](https://docs.getunleash.io/concepts/stickiness)
- [AWS AppConfig — What is AWS AppConfig Agent?](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-agent.html)
- [Azure App Configuration — Understand feature management](https://learn.microsoft.com/en-us/azure/azure-app-configuration/concept-feature-management)
- [SEC — In the Matter of Knight Capital Americas LLC (Exchange Act Release No. 70694, 2013)](https://www.sec.gov/files/litigation/admin/2013/34-70694.pdf)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
