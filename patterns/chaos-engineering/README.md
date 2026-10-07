<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🛡️ Resilience & Reliability](../../README.md#resilience--reliability)

# Chaos Engineering

> Inject failures on purpose to prove the system degrades the way you expect.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Chaos Engineering" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/chaos-engineering.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Steady state, hypothesis** | First describe *working* from the outside: checkout success is **99.9%** at about **1,200 orders a minute**, measured at the load balancer. Then write a **hypothesis** that predicts it stays that way: if one of the three Checkout instances is terminated, success stays above 99.5%. The card also records the fault, the **blast radius** (one instance) and the **stop condition** (success below 99%), and the run is set for working hours with the on-call team told. |
| **2 · Inject a small failure** | During normal traffic one instance is terminated. A request in flight fails, the load balancer's health check takes the instance out, the other two take 600 orders a minute each, and auto scaling starts a replacement. Success dips to 99.8% and recovers: the **hypothesis holds**, and the confidence that losing an instance is harmless now rests on evidence. |
| **3 · Find a weakness, stop** | The next experiment adds **2 s of latency** to 5% of Payments calls. Checkout has no timeout on that call, so its workers wait, requests pile up and success falls; when it drops below 99% the **stop condition** fires, the fault is removed automatically and the metric recovers. The finding: the Payments call needs a [timeout and a fallback](../timeout-and-fallback/). |
| **4 · Fix, rerun, make routine** | With a 1 s timeout and a fallback (the order is accepted as *payment pending* and charged moments later), the same experiment passes. It is then **automated** to run every week, the blast radius grows in steps (next: a whole zone instead of one instance), and **game days** rehearse the people and runbooks as well as the software. |
<!-- END GENERATED: header -->

## The problem

Every production system rests on beliefs about failure that nobody has checked lately. *We run three instances, so losing one is fine. The load balancer will notice. Payments has a timeout. We can fail over to the other region.* Each of those is a mechanism someone designed, and most of them only get exercised by a real outage, which is the worst moment to find out that one never worked.

Distributed systems make this worse. Every service can be correct on its own while the way they interact is not: a slow dependency holds threads in all of its callers, retries pile more load onto whatever is already struggling, a health check reports healthy while every real request fails. Configuration drifts, dependencies change owners, and traffic outgrows what the failover plan was sized for. A staging environment rarely has the traffic, data or configuration that would expose these problems, and a design review cannot show how the design behaves when something underneath it breaks.

The [Principles of Chaos Engineering](https://principlesofchaos.org/) list the weaknesses this tends to hide: fallbacks configured wrongly, retry storms caused by badly tuned timeouts, a downstream service flattened by more traffic than it can take, and failures that cascade from a single point. All of them stay invisible until the day they matter.

## How it works

Chaos engineering looks for those weaknesses on purpose, under control, before they find you. The principles define it as experimenting on a system to build confidence that it can withstand "turbulent conditions in production". The word that matters is *experiment*: a stated expectation, a small and deliberate fault, a measurement and a conclusion. It is not breaking things to see what happens.

### Where it comes from

- **Chaos Monkey (2010).** In a [December 2010 post](https://netflixtechblog.com/5-lessons-weve-learned-using-aws-1f2a28588e4c) on lessons from running on AWS, Netflix described Chaos Monkey, a service that randomly kills instances and services in its architecture so that engineers have to design for failure. It ran only during working hours, so that people were at hand when a termination exposed a problem.
- **The Simian Army (2011).** [The Netflix Simian Army](https://netflixtechblog.com/the-netflix-simian-army-16e57fbab116) added more kinds of failure. Latency Monkey injected artificial delays between clients and services, Chaos Gorilla simulated the loss of a whole AWS Availability Zone, and other monkeys hunted for misconfigured, unhealthy, unused or insecure resources. Later, Chaos Kong exercises simulated the failure of an entire AWS region.
- **From tools to a discipline (2014–2017).** Netflix's failure injection testing (FIT) could fail requests for chosen users only. In 2016 Basiri and colleagues described the practice and its principles in [*Chaos Engineering*](https://arxiv.org/abs/1702.05843) (IEEE Software), including Netflix's main steady-state signal, SPS: video stream starts per second. The same year [Chaos Monkey 2.0](https://netflixtechblog.com/netflix-chaos-monkey-upgraded-1d679429be5d) moved onto Spinnaker and kept only instance termination, and in 2017 [ChAP](https://netflixtechblog.com/chap-chaos-automation-platform-53e6d528371f) automated experiments against a control group.
- **Today.** The [Simian Army](https://github.com/Netflix/SimianArmy) project is retired, and [Chaos Monkey](https://github.com/Netflix/chaosmonkey) lives on as a standalone tool that works through Spinnaker. The principles site was last updated in March 2019, and AWS and Azure now offer managed fault injection services.

### The experiment loop

The principles describe four steps. The diagram runs them twice:

1. **Define the steady state.** Pick a measurable output that shows the system doing its job, seen from the outside: requests that succeed, orders per minute, streams started per second. Internal signals such as CPU usage tell you how the system is coping, not whether customers are being served. In the diagram the steady state is checkout success of 99.9% at about 1,200 orders a minute, measured at the load balancer.
2. **Form a hypothesis** that the steady state will continue in both a control group and an experimental group, the one that gets the fault.
3. **Introduce a fault that happens in real life**: an instance that dies, a dependency that slows down, a zone that goes dark.
4. **Try to disprove the hypothesis** by comparing the steady state with the fault and without it. The principles frame this as a control group and an experimental group. ChAP did it literally: it started a control cluster and an experiment cluster, routed a small slice of traffic to each, and injected the fault into one of them only.

If the steady state barely moves, confidence in the system grows. If it moves, the experiment has done its job: it found a weakness while the damage was small. Fix it, run the same experiment again, and then keep running it.

### Writing a hypothesis

A useful hypothesis names the fault, the metric, the limit and the mechanism you expect to protect you:

> If **one of three Checkout instances is terminated** during normal traffic, **checkout success stays above 99.5%**, because **the load balancer's health checks route around it and auto scaling replaces it**.

- **Make it falsifiable.** "The system stays up" cannot fail. "Success stays above 99.5% and p99 latency below 800 ms" can.
- **Name the mechanism.** Then a failed experiment tells you which mechanism let you down, and a passed one tells you which one you can rely on.
- **Set the limit before the run**, with the [SLO](../slo-error-budgets/) in mind. A dip that customers would not notice and that fits in the error budget is a pass.
- **Write down what you expect to see** in logs, traces and alerts. An alert that should have fired and did not is a finding too.

The AWS Well-Architected Reliability Pillar offers a similar template in [REL12-BP04 Test resiliency using chaos engineering](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_testing_resiliency_failure_injection_resiliency.html), and suggests choosing faults by how often they happen and how much they would hurt, with past post-incident analyses as a source.

### The advanced principles

The principles add five practices that describe the ideal:

| Principle | In practice |
|---|---|
| Build a hypothesis around steady state behavior | Measure outputs such as throughput, error rates and latency percentiles, not the internals |
| Vary real-world events | Use faults that really happen, hardware and software failures as well as non-failures such as a traffic spike, ranked by impact or frequency |
| Run experiments in production | Only real traffic exercises the real request paths |
| Automate experiments to run continuously | Experiments run by hand cannot keep up with a system that changes every day |
| Minimize blast radius | Keep the harm an experiment does to customers small and short |

Production is where the practice aims to end up, not where it starts: see *Safety* below.

### Kinds of fault

| Fault | Injected with, for example | What it usually tests |
|---|---|---|
| A terminated instance, container or process | AWS FIS `aws:ec2:terminate-instances` or `aws:eks:pod-delete`; Chaos Monkey | Health checks, auto scaling, state kept outside the instance |
| Latency | `aws:ecs:task-network-latency`; `aws:lambda:invocation-add-delay` on a percentage of invocations | Timeouts, deadlines, thread and connection pools |
| Errors | `aws:lambda:invocation-error`; `aws:fis:inject-api-internal-error` | Retries, idempotency, circuit breakers |
| A lost dependency | `aws:network:disrupt-connectivity`; blackholing a port | Fallbacks, degraded modes, caches |
| A zone or a region | The FIS scenario *AZ Availability: Power Interruption*; Azure Chaos Studio's *Compute Zone Down*; Netflix's Chaos Gorilla and Chaos Kong | Multi-zone claims, failover, the capacity that is left |
| Exhausted resources | CPU, memory and I/O stress; filling a disk (`AWSFIS-Run-Disk-Fill`) | Limits, autoscaling, back-pressure, alerting |
| Clock and DNS problems | Chaos Mesh time and DNS faults; Azure Chaos Studio's *DNS Outage* | Certificate and token expiry, caches, resolver fallbacks |

### Safety

- **Blast radius.** Start with the smallest fault that could disprove the hypothesis: one instance, a few percent of requests, one cell. Grow only after a pass, from an instance to a zone to a region. The diagram shows why that is not enough on its own: the fault touched 5% of Payments calls, but because Checkout had no timeout, the waiting spread to every request. A blast radius limits the fault, not its consequences.
- **Stop conditions.** Decide before the run what ends it, tie it to the steady-state metric and automate it. In AWS Fault Injection Service a [stop condition](https://docs.aws.amazon.com/fis/latest/userguide/stop-conditions.html) is a CloudWatch alarm: when the alarm fires, the experiment stops, and a stopped experiment cannot be resumed. ChAP ended an experiment automatically once it exceeded a predefined error budget. Keep a manual abort as well.
- **Timing.** Run when the people who own the system are at work and watching, and not during a peak, a launch or a change freeze. This is why Chaos Monkey was only active in working hours.
- **Telling people.** On-call engineers, support and dependent teams should know that an experiment is running, and its start and end should be marked on the dashboards, so that nobody debugs it as an incident. A real incident always comes first, and the experiment stops.
- **Starting outside production.** The AWS FIS documentation strongly recommends a planning phase and a first run in a pre-production environment. Pre-production finds the crude problems cheaply; production tests real traffic and configuration once the experiment is known to be safe.
- **Spending error budget on purpose.** Experiments in production cost some failed requests. Pay for them from the [error budget](../slo-error-budgets/): plan the bigger experiments while budget is left, and skip them once it is spent.

### Prerequisites

- **Observability first.** You need the steady-state metric in near real time, both to judge the experiment and to trip the stop condition, and enough detail to explain a deviation: per-dependency latency, [distributed traces](../distributed-tracing/) and [centralized logs](../centralized-logging/). An experiment you cannot observe is just an outage.
- **Fix the weaknesses you already know.** If the system has a single database with no replica, an experiment that kills it only confirms what you knew, at your customers' expense. Chaos engineering is for finding what you do not know.
- **The basics in place:** redundancy, health checks, timeouts, runbooks, and an on-call rotation that can respond.

### Game days and disaster recovery tests

A game day is a planned, larger exercise. A team simulates a failure scenario, such as losing a zone or a critical dependency, and rehearses the whole response: detection and alerts, runbooks, communication and recovery. Automated experiments test the software continuously; game days test the people and the procedures as well. The Reliability Pillar recommends [conducting game days regularly](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_testing_resiliency_game_days_resiliency.html).

Google's DiRT (Disaster Recovery Testing) is the same idea at company scale: coordinated real and fictitious outages, run under published rules (real emergencies take precedence, the expected impact is agreed in advance), that test processes and people as well as systems, for example by making someone with undocumented knowledge unavailable. Google describes it in [Using SRE and disaster recovery testing principles in production](https://cloud.google.com/blog/products/management-tools/shrinking-the-time-to-mitigate-production-incidents).

Disaster recovery plans need the same treatment. A [disaster recovery strategy](../disaster-recovery-strategies/) that has never been exercised is a hope: restore the backups, promote the standby, fail over to the other region as in [active-passive failover](../active-passive-failover/), and measure the recovery time and the data lost against the RTO and RPO you promised.

### What experiments typically uncover

- **Missing or generous timeouts**, as in the diagram: one slow dependency holds the caller's threads and connections until everything waits. The fix is a [timeout and a fallback](../timeout-and-fallback/).
- **Retry storms**: every layer retries, multiplying the load on a dependency that is already struggling. The fix is [retries with backoff and jitter](../retry-with-backoff/) and a cap on retries.
- **Shared pools**: one dependency's slowness uses up a pool that every call shares. The fixes are a [bulkhead](../bulkhead/) per dependency and a [circuit breaker](../circuit-breaker/) that stops calling it.
- **Health checks that check the wrong thing**: an instance reports healthy while its requests fail, or a deep check takes every instance out at once. See [health endpoint monitoring](../health-endpoint-monitoring/).
- **Fallbacks that do not work**, because they only ever run during failures. ChAP caught a broken fallback path at Netflix this way.
- **Capacity that is not there**: after losing a zone the remaining instances cannot carry the load, or [auto scaling](../autoscaling/) reacts too slowly to help.
- **Alerts, dashboards and runbooks** that are missing, noisy or out of date, and owners who cannot be reached.

### What it is not

- **Not breaking things at random.** Chaos Monkey chose its victims at random, but inside a planned, monitored and limited programme. Randomness can pick the target; it does not replace the method. Every experiment has a hypothesis, a limit and a stop condition.
- **Not load testing.** A load test asks how much traffic the system can handle; a chaos experiment asks what happens when part of it fails. The two combine well (a zone failure at peak load), but they answer different questions.
- **Not a replacement for other testing.** Unit, integration, performance and security tests still matter. Chaos experiments test the running system as a whole.

## When to use it

- You rely on resilience mechanisms (redundancy, failover, timeouts, retries, circuit breakers, auto scaling) and have not seen them work recently.
- The system is distributed enough that its behaviour under failure does not follow obviously from its design.
- After an incident, to prove that the fix works and that the same fault no longer hurts.
- Before a peak, a migration or a launch that would make an outage expensive.
- When you must show evidence of resilience. Azure Chaos Studio's documentation mentions using scenario reports as evidence for operational resilience frameworks such as DORA.

**When not to start yet:**

- There is no steady-state metric, or you cannot see it in near real time.
- You cannot stop an experiment quickly or remove its fault.
- You already know about a weakness and have not fixed it.
- There is nothing redundant to test: with a single instance, terminating it is an outage, not an experiment.
- Nobody is on call to respond, management does not support failing on purpose, or the error budget is spent.

In those cases start with observability, the known fixes and a game day in a pre-production environment.

## Trade-offs

- **Real risk.** Even a small, well-guarded experiment can hurt customers. That cost is deliberate, and it should come out of the error budget.
- **Effort.** Experiments, automation, safe targeting and analysis take engineering time, and fixing the findings takes more.
- **A pass proves less than it seems.** It shows that this fault, at this size, at this moment, was tolerated. The system keeps changing, which is why experiments should run continuously.
- **A small blast radius gives a small signal.** A fault that touches 1% of traffic has a small effect that normal daily variation can hide. Control groups and sensitive metrics help.
- **People and culture.** Teams must be willing to break things on purpose and to treat findings without blame. Without that, experiments are called off at the first sign of trouble, or never started.

## Implementation notes

- **Managed services:** AWS Fault Injection Service builds experiments from templates of actions, targets and stop conditions, has a scenario library (including an AZ power interruption), and can [schedule experiments](https://docs.aws.amazon.com/fis/latest/userguide/experiment-scheduler.html) through EventBridge Scheduler. [Azure Chaos Studio](https://learn.microsoft.com/en-us/azure/chaos-studio/chaos-studio-overview) is moving from Experiments (classic), with service-direct and agent-based faults, to Workspaces and Scenarios, which are in public preview as of October 2026.
- **Open source:** [Chaos Mesh](https://chaos-mesh.org/) and [LitmusChaos](https://litmuschaos.io/) are CNCF incubating projects with native Kubernetes support. Netflix's Chaos Monkey terminates instances through Spinnaker.
- **Commercial:** [Gremlin](https://www.gremlin.com/) offers fault injection and reliability testing as a service.
- **Treat experiments as code.** Keep them in version control next to the service, review them, and run them both in the delivery pipeline and on a schedule.
- **Mark experiments where people look.** Annotate dashboards with each start and end, tag affected requests where you can, and publish a calendar of planned experiments.
- **Record every run:** the hypothesis, the result, the findings and the tickets they produced. The list of findings is the real output.
- **Grow in steps.** One instance, then a zone, then a region; a few percent of requests, then more. Move up only after a pass.
- **Further reading:** Casey Rosenthal and Nora Jones, *Chaos Engineering: System Resiliency in Practice* (O'Reilly, 2020).

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [SLOs & Error Budgets](../slo-error-budgets/) — Measure SLIs against an objective and alert on error-budget burn rate, not on every blip.
- [Health Endpoint Monitoring](../health-endpoint-monitoring/) — Expose liveness and readiness checks that load balancers and monitors probe.
- [Circuit Breaker](../circuit-breaker/) — Stop calling a failing dependency, fail fast with a fallback, and probe until it recovers.
- [Timeout & Fallback](../timeout-and-fallback/) — Bound every remote call and degrade gracefully when the time runs out.
- [Bulkhead](../bulkhead/) — Give each dependency its own pool of resources so one failure can't sink the whole ship.
- [Disaster Recovery Strategies](../disaster-recovery-strategies/) — Backup & restore, pilot light, warm standby, active-active: trading cost against RTO and RPO.
- [Active-Passive Failover](../active-passive-failover/) — A warm standby region is promoted when the primary region goes down.
- [Load Balancing](../load-balancing/) — Spread requests across healthy instances and stop sending to unhealthy ones.

## Related principles and frameworks

- [The Three Ways](../three-ways/) — DevOps in three principles: speed the flow of work to customers, amplify feedback back to the team, and keep learning.
- [Incident Management](../incident-management/) — A practised response when production breaks: declare early, assign roles, mitigate first and keep everyone informed.
- [Blameless Postmortems](../blameless-postmortems/) — Learn from every incident without blame: a timeline, the contributing factors and tracked action items, shared widely.

## References

- [Principles of Chaos Engineering](https://principlesofchaos.org/)
- [Netflix Technology Blog — The Netflix Simian Army (2011)](https://netflixtechblog.com/the-netflix-simian-army-16e57fbab116)
- [Netflix Technology Blog — Netflix Chaos Monkey Upgraded (2016)](https://netflixtechblog.com/netflix-chaos-monkey-upgraded-1d679429be5d)
- [Netflix Technology Blog — ChAP: Chaos Automation Platform (2017)](https://netflixtechblog.com/chap-chaos-automation-platform-53e6d528371f)
- [Basiri et al. — Chaos Engineering (IEEE Software, 2016; arXiv copy)](https://arxiv.org/abs/1702.05843)
- [AWS Fault Injection Service — Stop conditions](https://docs.aws.amazon.com/fis/latest/userguide/stop-conditions.html)
- [Azure Chaos Studio — What is Azure Chaos Studio?](https://learn.microsoft.com/en-us/azure/chaos-studio/chaos-studio-overview)
- [AWS Well-Architected Reliability Pillar — REL12-BP04 Test resiliency using chaos engineering](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_testing_resiliency_failure_injection_resiliency.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
