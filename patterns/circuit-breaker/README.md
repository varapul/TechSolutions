<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🛡️ Resilience & Reliability](../../README.md#resilience--reliability)

# Circuit Breaker

> Stop calling a failing dependency, fail fast with a fallback, and probe until it recovers.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Circuit Breaker" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/circuit-breaker.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Closed** | In the normal **closed** state every call goes through to Service B. The breaker sits on the wire and records the outcome of each call. |
| **2 · Failures pile up** | Service B starts returning errors. Each failure bumps the breaker's counter; when it crosses the threshold (3 here, in practice usually a failure *rate* over a sliding window) the breaker **trips open**. |
| **3 · Open: fail fast** | While **open**, calls are rejected immediately instead of waiting for a timeout. Service A serves a fallback (cached data, a default, a friendly error) and Service B gets breathing room to recover. |
| **4 · Half-open trial** | When the cooldown ends the breaker goes **half-open** and lets a single trial call through. It succeeds, so the breaker closes and resets its counter. Had it failed, the breaker would have gone straight back to open for another cooldown. |
<!-- END GENERATED: header -->

## The problem

When a downstream service is slow or down, its callers keep sending requests and waiting for timeouts. Threads and connections pile up behind the slow calls, latency climbs, and the failure spreads upstream as a **cascading failure**. Meanwhile the struggling service gets hammered with traffic (and retries) at exactly the moment it needs relief.

## How it works

A circuit breaker wraps calls to a dependency and watches their outcomes. It is a small state machine:

- **Closed**: calls pass through. Failures are counted, or a failure rate is computed over a sliding window.
- **Open**: once the threshold is crossed, calls are rejected immediately, without touching the network, and the caller falls back.
- **Half-open**: after a cooldown, a limited number of trial calls go through. Success closes the breaker; a failure opens it again for another cooldown.

## When to use it

- Calls to remote services or shared resources that can fail or slow down: HTTP APIs, databases, third-party SaaS.
- When a fast, degraded answer beats a slow failure: cached data, defaults, "try again later".
- Not for purely in-process calls, and not as a substitute for fixing an unreliable dependency.

## Trade-offs

- **Tuning matters.** Too sensitive and it trips on noise; too lax and it trips too late. Prefer a failure *rate* with a minimum call volume and a slow-call threshold over a raw count.
- **You need a real fallback.** Without one, an open breaker only makes you fail faster.
- **Each instance learns on its own.** Per-instance breakers only see their own traffic, so every replica trips separately.
- **Pair it with timeouts and careful retries.** A hung call never counts as a failure without a timeout, and retries should treat "breaker open" as non-retryable so they don't hammer the circuit.

## Implementation notes

- **Libraries:** Resilience4j (Java), Polly (.NET), opossum (Node.js), pybreaker (Python), gobreaker (Go).
- **Infrastructure:** service meshes and proxies offer the same idea without code changes. Examples are Envoy's outlier detection and circuit-breaking thresholds, and Istio `DestinationRule` `outlierDetection`.
- **Observe it:** emit a metric or event on every state change. A breaker that opens is one of the clearest alerts you can get.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Retry with Backoff & Jitter](../retry-with-backoff/) — Retry transient failures with growing, randomised delays so clients don't stampede.
- [Timeout & Fallback](../timeout-and-fallback/) — Bound every remote call and degrade gracefully when the time runs out.
- [Bulkhead](../bulkhead/) — Give each dependency its own pool of resources so one failure can't sink the whole ship.
- [Health Endpoint Monitoring](../health-endpoint-monitoring/) — Expose liveness and readiness checks that load balancers and monitors probe.
- [Service Mesh](../service-mesh/) — Sidecar proxies plus a control plane: mTLS, retries and traffic shifting without touching app code.

## References

- [Martin Fowler — CircuitBreaker](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Azure Architecture Center — Circuit Breaker pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker)
- [Michael Nygard — Release It! (2nd edition)](https://pragprog.com/titles/mnee2/release-it-second-edition/)
- [Resilience4j — CircuitBreaker](https://resilience4j.readme.io/docs/circuitbreaker)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
