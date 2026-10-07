<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🛡️ Resilience & Reliability](../../README.md#resilience--reliability)

# Health Endpoint Monitoring

> Expose liveness and readiness checks that load balancers and monitors probe.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Health Endpoint Monitoring" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/health-endpoint-monitoring.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Three questions** | An instance exposes three small endpoints, and each answers one question for one consumer. While it boots (loading configuration, warming its cache) the **startup** check says *not yet* and holds the other two off, so a slow start is not mistaken for a hang. Once it passes, **liveness** (`/livez`) asks only whether the process can still make progress and **readiness** (`/readyz`) asks whether this instance can serve requests right now. The load balancer sends traffic only after readiness passes. |
| **2 · Not ready: no traffic** | Instance A loses its database connections (it could just as well be saturated). `/readyz` answers **503**, the load balancer takes A **out of rotation**, and B and C carry the traffic. `/livez` still answers 200, so the orchestrator leaves the process alone. When the pool reconnects, readiness passes and traffic returns, with no restart and no cold cache. |
| **3 · Not alive: restart** | The process deadlocks: it is still running but can no longer make progress, so `/livez` stops answering. After **three unanswered probes in a row** (an illustrative threshold) the orchestrator **restarts** the instance, which boots, passes its startup check and rejoins. Liveness must not look at dependencies: restarting an instance does not repair a database, and a liveness check that tests one would restart every healthy instance together. |
| **4 · Don't fail all at once** | The database that every instance shares has a **brownout**. If each `/readyz` also tests that database, A, B and C fail in the same second and the load balancer has nowhere to send traffic: a partial problem becomes a total outage. Keep checks **shallow** for shared dependencies (or use a balancer that **fails open** when every target looks unhealthy) and let the instances keep serving what they can. The **external monitor**, which probes the public endpoint from outside, is what raises the alert. |
<!-- END GENERATED: header -->

## The problem

A platform that runs several instances of a service has to keep deciding three things about each one: has it finished starting, is it still working, and should it receive traffic right now. Left to itself it can only guess from the outside: the process exists, the port accepts connections. That guess is often wrong. A process can be up and useless: still warming its cache, out of database connections, deadlocked, or already shutting down.

Each wrong guess costs something different. Traffic sent to an instance that isn't ready becomes errors for users. Restarting an instance that was only busy throws away its warm state and pushes its load onto the others. And when every instance reports that it is fine, nobody may notice that users can't reach the service at all, because what broke is the DNS record, the certificate or the load balancer in front.

## How it works

The service reports its own state through small, cheap endpoints, one per question, and a different consumer acts on each answer.

| Check | The question | Who asks | A failure means | It should look at |
|---|---|---|---|---|
| **Startup** | Has boot finished? | the orchestrator | keep waiting; restart if the time budget runs out | initialisation: configuration loaded, cache warmed, migrations applied |
| **Liveness** | Can the process still make progress? | the orchestrator, which can restart it | restart the instance | the process itself and nothing else |
| **Readiness** | Can this instance serve requests right now? | the load balancer, which routes | no new traffic, and no restart | the instance's own resources |
| **Outside-in** | Can users use the service? | an external monitor | alert a human; fail over to another region | the public endpoint, end to end |

The split matters because the remedies differ. Taking an instance out of rotation is cheap and reversible, so readiness can react quickly. A restart is drastic and repairs nothing outside the process, so liveness should be slow to act and blind to everything but the process. In the diagram the endpoints are `/startupz`, `/livez` and `/readyz`. The last two follow a common convention; the first name is this diagram's own.

*Who asks* depends on the platform. In Kubernetes the kubelet runs all three probes on the node. It holds the liveness and readiness probes back until the startup probe has passed, and a failed readiness probe takes the Pod out of the endpoints of the Services that select it. A load balancer that probes on its own schedule knows nothing about the startup check: it simply keeps getting *not ready* until the instance has started.

### Shallow and deep checks, and the dependency trap

A **shallow** check answers from what the process already knows: it is running, its workers are turning over, its pool holds connections. A **deep** check goes out and exercises a dependency, for example by running a query or calling a downstream API.

Deep checks find more, and they fail in a dangerous way. When the dependency is **shared**, every instance's check fails at the same moment:

- In a **liveness** check, the orchestrator restarts every instance at once. No restart repairs the database, and the service comes back cold into the same outage.
- In a **readiness** check, the load balancer loses every target and has nowhere to send traffic. Requests that never needed the database (cached reads, static content, other endpoints) fail too, so a partial problem becomes a total one.

So decide check by check:

- **Readiness may include the instance's own resources:** its connection pool is established, its cache is warm, the configuration and secrets it needs are loaded, its request queue or thread pool is not saturated, and it has not begun shutting down. If one of these is wrong, another instance really can do better, and that is exactly what taking this one out of rotation assumes.
- **Leave out dependencies that every instance shares,** such as the main database or a message broker. Removing instances helps only when the remaining ones are better off. Fail the individual requests that need the dependency, keep serving what still works, and let the dependency's own alarms report it.
- **Leave out downstream services** that have their own health checks and alarms. Guard those calls with timeouts and a [Circuit Breaker](../circuit-breaker/), and degrade the feature, not the instance.
- **Liveness includes none of these.**

This is a judgement call, and good sources draw the line in slightly different places. The Kubernetes documentation allows a readiness probe to check the back-end services an application strictly depends on, so that traffic doesn't go to Pods that could only answer with errors. Spring Boot's documentation says the choice has to be made carefully and names the dependency shared by all instances as the hard case. If you do include a shared dependency, make sure something limits the damage: a balancer that **fails open** when every target is unhealthy, or a cap on the share of targets it may take out.

Steps 2 and 4 of the diagram are the two sides of that line. In step 2 instance A has lost *its own* connections while the database and the other instances are fine, so taking A out of rotation helps. In step 4 the database is slow for everyone, and removing instances helps nobody. The line is not always that clean: when a shared database is down completely, every instance's pool empties, and even a shallow pool check fails everywhere. That case is what failing open is for.

### The answer

- **Status code first:** `200` for healthy and `503 Service Unavailable` for not healthy. Machines should read nothing else. Kubernetes counts any status from 200 to 399 as a pass.
- **A small body for humans:** an overall status and, at most, the name and state of each check. Mark the response as not cacheable, so that no proxy answers on the instance's behalf. There is no standard body format; an Internet-Draft that proposed one expired in 2022 without becoming an RFC.
- **No secrets.** Connection strings, internal host names, version numbers and stack traces help an attacker more than an operator. Serve details only to authenticated callers or on an internal port, and keep the endpoint that the balancer probes minimal. A path that is hard to guess is not access control.
- **gRPC** services use the standard health service instead of a path: `grpc.health.v1.Health`. Its `Check` call returns `SERVING` or `NOT_SERVING` for a named service (the empty name stands for the whole server), and its `Watch` call streams the changes.

### Intervals, timeouts and thresholds

- Detection takes about *interval × failure threshold*, plus the timeout of the last probe. With the Kubernetes defaults (a probe every 10 seconds, a 1-second timeout, 3 failures in a row) that is roughly half a minute.
- One failed probe should rarely decide anything. Requiring several failures in a row, and several passes before an instance returns, keeps a struggling instance from **flapping** in and out of rotation.
- Give liveness more patience than readiness, so that an instance is out of rotation for a while before anything kills it. The Kubernetes documentation describes using one cheap endpoint for both, with a higher failure threshold on the liveness probe.
- A slow boot is not a hang. A startup check with its own generous budget (failure threshold × period) covers initialisation, so the liveness check can stay tight afterwards.
- The numbers in the diagram are illustrative: one answer moves an instance in or out of rotation, and three missed probes restart it.

### Keep the checks cheap

- Answer from state the process already holds and keeps fresh in the background, not by doing work for every probe. Probes arrive from every balancer node, the orchestrator and every monitor, all the time. A check that runs a query per probe sends a steady stream of queries at a database that may already be struggling.
- If a check has to call something, give the call a short timeout and consider caching the result for a few seconds. The cache trades load for staleness, so size it against how fast you need to detect a failure.
- Under overload the health endpoint must still answer. If busy instances time out on their probes, the balancer ejects them, their load lands on the rest, and those fail next: the health checking itself spreads the failure. Reserve capacity for the health endpoint, and shed real requests before the probes start to time out.
- Where you can, serve the check on the same port and through the same server stack as real traffic. A check on a separate management port can pass while the main listener refuses connections.

### Shutting down

An instance that is about to stop should **fail readiness first**, keep serving the requests it already has and the few that still arrive, wait until the balancer has noticed, and only then exit. Liveness keeps passing the whole time, because the process is doing exactly what it should. Google's SRE book calls this the *lame duck* state. The wait has to cover the balancer's detection time or its deregistration delay: see [Load Balancing](../load-balancing/) for draining and [Rolling Update](../rolling-update/) for how a rollout depends on it. On Kubernetes, deleting a Pod already marks its endpoint as not ready, so the readiness endpoint does not have to flip for that case, but the process still has to keep serving for a moment after `SIGTERM`.

### From the outside in

Every instance can be healthy while users see errors: an expired certificate, a wrong DNS record, a misconfigured balancer, or a network path that internal probes never take. An **external monitor** calls the public endpoint the way a user would, from **several locations**, so that one bad network path is not mistaken for an outage. It checks the content and the response time, not just the status code. Its results feed alerts, regional failover in a [Multi-Region Active-Active](../multi-region-active-active/) setup, and the availability figures behind [SLOs & Error Budgets](../slo-error-budgets/). Probes are only a sample, though. Where there is enough traffic, measure the SLI on real requests at the load balancer, and use synthetic probes for quiet hours and for paths that users rarely take.

### In an autoscaling group

An autoscaling group **replaces** the instances it considers unhealthy. If it takes the load balancer's health check as that signal, a failed readiness check stops meaning *no traffic for now* and starts meaning *terminate*: readiness with the consequences of liveness. A deep check that fails everywhere then makes the group replace the whole fleet. Use a separate, more conservative signal for replacement than for routing, and give new instances a grace period in which to start. [Autoscaling](../autoscaling/) covers the rest of that loop.

### When a health check lies

A health check is a model of the service, and the model can be wrong in both directions.

- **It passes while users fail.** The check takes a different path from real requests: another port, no authentication, no database. Or a bad release returns errors on every real endpoint and `200` on `/readyz`. An instance that fails fast can even look like the least loaded one and attract more traffic.
- **It fails while users are fine.** The check tests something that most requests don't need, or it times out because the instance is busy doing useful work.

Catch both with signals from **real traffic**: each instance's error rate and latency compared with its peers, passive health checks (outlier detection) in the load balancer or the [Service Mesh](../service-mesh/), alerts on the SLO's burn rate, and the external monitor. When those signals take out an instance that was passing its checks, treat the gap as a bug in the check.

## When to use it

- For every service that runs behind a load balancer or under an orchestrator: at least a liveness and a readiness endpoint, kept separate even if they start out identical.
- Add a startup check when booting takes longer than the liveness check would tolerate: large caches, JIT warm-up, migrations.
- Add outside-in monitoring for anything that users or other teams depend on, and for anything that has an SLO.
- Queue consumers and batch workers have no load balancer to tell, so readiness matters little for them. Liveness still does: expose it as a tiny HTTP endpoint, or let the orchestrator run a command that checks a heartbeat.
- A health endpoint is a yes-or-no signal for automation. It does not replace metrics, logs and traces, which tell you *why*.

## Trade-offs

- **Shallow or deep.** Shallow checks miss failures in dependencies; deep checks turn a dependency's failure into your own. Whatever depth you choose, know what happens when every instance fails the check at once.
- **Fast or stable.** Short intervals and low thresholds find failures sooner and flap more, and every probe costs something on every instance.
- **Fail open or fail closed.** A balancer that fails open keeps serving through a bad check, and may send traffic to instances that really are broken. One that fails closed protects users from broken instances, and turns a bad check into an outage.
- **Restarts hide problems.** A liveness check that restarts a leaking or deadlocking process keeps the service up and the bug alive. Count restarts and alert on them.
- **One more surface.** A detailed health endpoint leaks information, and one that does real work per request is a cheap target for a denial-of-service attack.

## Implementation notes

Products change their defaults, so treat these as examples that were checked in October 2026, and read the current documentation.

- **Kubernetes probes:** `startupProbe`, `livenessProbe` and `readinessProbe`, run by the kubelet as an HTTP GET, a TCP connect, a command or a gRPC health call. The defaults are `periodSeconds: 10`, `timeoutSeconds: 1`, `failureThreshold: 3`, `successThreshold: 1` and `initialDelaySeconds: 0`. Liveness and readiness probes do not run until the startup probe has succeeded. A failed liveness or startup probe gets the container killed and restarted under the Pod's restart policy; a failed readiness probe takes the Pod's address out of the EndpointSlices of the Services that select it. A deleted Pod gets a 30-second grace period by default.
- **The Kubernetes API server** follows the pattern itself with `/livez` and `/readyz` (the older `/healthz` has been deprecated since v1.16). Machines are meant to read only the status code; `?verbose` lists the individual checks for a human, and `exclude=` leaves one out. With `--shutdown-delay-duration` set, `/readyz` fails as soon as shutdown begins while `/livez` keeps passing, which is the lame-duck sequence above.
- **gRPC:** the health checking protocol ships with the gRPC libraries, the kubelet's gRPC probe speaks it, and a gRPC client can be configured to watch it and stop sending calls to a backend that reports `NOT_SERVING`.
- **Spring Boot Actuator:** the health groups `/actuator/health/liveness` and `/actuator/health/readiness` report the application's availability state, and `management.endpoint.health.probes.add-additional-paths=true` also serves them as `/livez` and `/readyz` on the main port. `DOWN` and `OUT_OF_SERVICE` map to 503, and details are hidden by default (`show-details` is `never`).
- **ASP.NET Core:** `MapHealthChecks` exposes an endpoint. By default `Healthy` and `Degraded` return 200 and `Unhealthy` returns 503, the body is the status as plain text, and caching is suppressed. Tag the checks and filter on the tags to get separate liveness and readiness endpoints; `RequireHost` and `RequireAuthorization` restrict who can call them.
- **When every target is unhealthy:** AWS Application and Network Load Balancers fail open and route to all targets. Envoy ignores health once the healthy share of a cluster drops below its *panic threshold* (50% by default), or can be configured to fail the traffic instead. HAProxy answers 503 when no server is available, and Azure Load Balancer sends no new flows to a pool whose instances are all probed down.
- **Replacement in a group:** Amazon EC2 Auto Scaling replaces instances that fail the built-in EC2 status checks and, once a grace period has passed, any optional checks you enabled, such as the load balancer's. Google Cloud recommends a separate, more conservative health check for autohealing a managed instance group than for load balancing.
- **Outside-in services:** Google Cloud Monitoring uptime checks (at least three checkers) and Azure Application Insights availability tests (five or more locations recommended) both probe from several places. Alert when several locations agree, not on a single failed probe.
- **Watch the health system itself:** the number of ready instances against the number expected, restarts per instance, how often instances change state, and the time from a failure to its removal. An alert on *fewer than N ready* catches step 4 before the last instance goes.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Load Balancing](../load-balancing/) — Spread requests across healthy instances and stop sending to unhealthy ones.
- [Rolling Update](../rolling-update/) — Replace instances batch by batch while the service stays up.
- [Autoscaling](../autoscaling/) — Add and remove instances automatically as load rises and falls.
- [Circuit Breaker](../circuit-breaker/) — Stop calling a failing dependency, fail fast with a fallback, and probe until it recovers.
- [SLOs & Error Budgets](../slo-error-budgets/) — Measure SLIs against an objective and alert on error-budget burn rate, not on every blip.
- [Multi-Region Active-Active](../multi-region-active-active/) — Serve users from several regions at once and shift traffic away from a region that fails.
- [Service Mesh](../service-mesh/) — Sidecar proxies plus a control plane: mTLS, retries and traffic shifting without touching app code.

## Related components and services

- [NGINX](../nginx/) — A reverse proxy and web server: TLS termination, load balancing, caching and rate limiting in front of applications.
- [Kubernetes](../kubernetes/) — A container orchestrator: you declare the desired state, and controllers keep pods scheduled, healthy and reachable.
- [Prometheus & Grafana](../prometheus/) — Pull-based monitoring: scrape metrics into a time-series database, query them with PromQL, alert, and chart them in Grafana.
- [Amazon Route 53](../amazon-route-53/) — Managed DNS: hosted zones, routing policies (weighted, latency, failover, geolocation) and health checks.
- [Amazon CloudWatch](../amazon-cloudwatch/) — Metrics, logs, alarms and dashboards for AWS resources and your applications, in one monitoring service.

## Related principles and frameworks

- [You Build It, You Run It](../you-build-it-you-run-it/) — The team that builds a service runs it in production, on call, so the people who can fix a problem hear about it first.
- [Golden Signals, RED & USE](../golden-signals/) — What to measure and alert on: latency, traffic, errors and saturation, RED for request-driven services and USE for resources.
- [Eliminating Toil](../eliminating-toil/) — Find the manual, repetitive operations work that grows with the system, measure it, cap it and automate it away.
- [The Twelve-Factor App](../twelve-factor-app/) — Twelve rules for apps that deploy cleanly anywhere: config in the environment, stateless processes, separate build, release and run.

## References

- [Azure Architecture Center — Health Endpoint Monitoring pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/health-endpoint-monitoring)
- [microservices.io — Pattern: Health Check API](https://microservices.io/patterns/observability/health-check-api.html)
- [Kubernetes — Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/)
- [Kubernetes — Kubernetes API health endpoints (/livez, /readyz)](https://kubernetes.io/docs/reference/using-api/health-checks/)
- [Kubernetes — Pod Lifecycle (termination of Pods)](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
- [AWS Builder Center — Implementing health checks (first published in the Amazon Builders' Library)](https://builder.aws.com/content/3Ev53O39izHCtWLzp4XU6t8PC1O/implementing-health-checks)
- [Google SRE Book — Load Balancing in the Datacenter (chapter 20, lame duck state)](https://sre.google/sre-book/load-balancing-datacenter/)
- [Google SRE Book — Addressing Cascading Failures (chapter 22)](https://sre.google/sre-book/addressing-cascading-failures/)
- [Google SRE Workbook — Implementing SLOs (chapter 2)](https://sre.google/workbook/implementing-slos/)
- [gRPC — Health Checking](https://grpc.io/docs/guides/health-checking/)
- [Spring Boot — Actuator endpoints (health groups, Kubernetes probes)](https://docs.spring.io/spring-boot/reference/actuator/endpoints.html)
- [Microsoft Learn — Health checks in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/health-checks)
- [RFC 9110 — HTTP Semantics, section 15.6.4 (503 Service Unavailable)](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.6.4)
- [IETF Datatracker — Health Check Response Format for HTTP APIs (expired Internet-Draft)](https://datatracker.ietf.org/doc/draft-inadarei-api-health-check/)
- [AWS — Health checks for Application Load Balancer target groups](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html)
- [Envoy — Panic threshold](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/load_balancing/panic_threshold)
- [HAProxy 3.4 — Configuration Manual (HTTP status codes generated by HAProxy)](https://docs.haproxy.org/3.4/configuration.html)
- [Azure — Azure Load Balancer health probes](https://learn.microsoft.com/en-us/azure/load-balancer/load-balancer-custom-probe-overview)
- [Amazon EC2 Auto Scaling — Health checks for instances in an Auto Scaling group](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-health-checks.html)
- [Google Cloud — Set up an application-based health check and autohealing](https://docs.cloud.google.com/compute/docs/instance-groups/autohealing-instances-in-migs)
- [Google Cloud — Create public uptime checks](https://docs.cloud.google.com/monitoring/uptime-checks)
- [Azure Monitor — Application Insights availability tests](https://learn.microsoft.com/en-us/azure/azure-monitor/app/availability)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
