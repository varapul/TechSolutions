<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🛡️ Resilience & Reliability](../../README.md#resilience--reliability)

# Bulkhead

> Give each dependency its own pool of resources so one failure can't sink the whole ship.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Bulkhead" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/bulkhead.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One shared pool** | The Storefront service has one pool of 12 workers, drawn as slots. A request holds a slot for as long as its call to a dependency is in flight (Catalog for browsing, Payments for checkout, Recommendations for the "you may also like" panel) and gives it back when the answer arrives. All three dependencies answer quickly, so slots turn over and only a few are busy at any moment. |
| **2 · A slow dependency sinks it** | Recommendations starts to **hang**. It does not fail, it just takes 30 seconds to answer. Every call to it now keeps its slot, new ones keep arriving, and one by one all 12 slots end up waiting on the same dependency. Browse and checkout requests never needed Recommendations, yet they find no free slot and time out. A non-critical feature has taken the whole service down while Catalog and Payments sit idle and healthy. |
| **3 · Partition the pool** | Divide the pool so that each dependency gets its own bounded compartment: 5 slots for Catalog, 5 for Payments and 2 for Recommendations. When Recommendations hangs again, its 2 slots fill and every further call to it is **rejected at once**, so the page renders without recommendations instead of waiting for them. The other two compartments are untouched and keep serving. The failure is contained, like water behind a ship's bulkhead. |
| **4 · Size it and pair it** | A bulkhead limits how many calls can be stuck at once. It does not make the dependency faster. Pair it with a **timeout**, which here frees the two stuck slots after a second, and export **usage per compartment** and a **rejected-calls counter** so that a full compartment shows up on a dashboard. Size each compartment from its load: slots ≈ peak calls per second × latency, plus headroom (Catalog: 40 × 0.1 s = 4, so 5). The same idea works at other levels: separate instances or pods per tenant or per consumer, separate connection pools, separate queues. |
<!-- END GENERATED: header -->

## The problem

A service that calls several dependencies usually pays for all of those calls out of one shared budget: a pool of request threads, a connection pool, a cap on open sockets, or simply memory. While every dependency answers quickly nobody notices the sharing, because each call borrows a little of the budget for a very short time.

The trouble starts when one dependency becomes **slow instead of failing**. A call that fails hands its thread back at once. A call that hangs keeps it. The number of calls in flight is the arrival rate multiplied by the time each call takes (Little's law), so a dependency that receives 10 calls per second and answers in 0.1 s occupies about one worker, and the same traffic wants 300 workers once an answer takes 30 s. Long before that, the shared pool is full of requests waiting on that one dependency. Every other request queues behind them and times out, including the ones that never touch it. In the animation a recommendations panel, which the page could do without, stops browsing and checkout. Catalog and Payments are healthy the whole time, and nothing is left to call them with.

Google's SRE book describes the same chain as a classic route into a cascading failure: slower responses mean more requests in flight, threads run out, health checks stop being answered, and the load of the server that gave up lands on the ones that remain.

The animation uses 12 slots so that they can be counted. A real pool is larger (a Tomcat connector allows up to 200 request threads by default), which only postpones the moment it is full.

## How it works

A bulkhead puts a limit on **how much of a shared resource one kind of work may hold at the same time**. The name comes from the watertight walls that divide a ship's hull: a breach floods one compartment and the ship stays afloat. Michael Nygard described it as a stability pattern for software in *Release It!*, next to timeouts and circuit breakers. A slot in the animation stands for whatever is scarce: a worker thread, a pooled connection or a semaphore permit.

In its most common form every dependency gets its own bounded compartment. In the animation the 12 workers become 5 for Catalog, 5 for Payments and 2 for Recommendations. When Recommendations hangs, its two slots fill and stay full. The third call does not wait: it is turned away immediately, the page renders without the panel, and the other ten slots never notice. The failure still happens, but it stays the size of the feature that failed.

**Two ways to build a compartment.**

| | Thread-pool isolation | Semaphore (concurrency limit) isolation |
|---|---|---|
| Mechanism | The call is handed to a small pool of threads reserved for that dependency, with a short queue or none in front | The call runs on the caller's own thread after taking one of *n* permits |
| A hung call holds | A thread of the dependency's pool. The caller can stop waiting and move on | The caller's thread, until the client's own timeout fires |
| Cost | Extra threads, a hand-off and a context switch per call. Whatever lives in thread-locals (trace and log context, security context, transactions) has to be carried across | A counter. Nothing is handed off and nothing is reserved |
| Fits | Blocking clients whose timeouts you don't trust | Fast calls, non-blocking and reactive code, virtual threads |

Hystrix made the thread pool its default and published what that costs: for one command called 60 times per second, nothing measurable at the median, 3 ms at the 90th percentile and 9 ms at the 99th. It kept semaphores for calls so frequent, or so fast, that this overhead matters. Newer libraries turn the default around: in Resilience4j and in MicroProfile Fault Tolerance a bulkhead is a semaphore unless you ask for a thread pool.

One difference is easy to miss. A thread pool **reserves**: its threads exist for that dependency and nothing else can use them. A semaphore only **caps**: its permits are counted against threads that all callers share. Semaphore limits isolate only while they add up to less than the shared pool. If the sum is larger, several slow dependencies together can still fill it.

**Sizing.** A compartment has to hold the calls that are in flight at peak, plus some headroom:

> slots ≈ peak calls per second × latency in seconds + headroom

| Compartment | Peak rate | Latency | Calls in flight | Slots |
|---|---|---|---|---|
| Catalog | 40 per second | 0.1 s | 4 | 5 |
| Payments | 8 per second | 0.5 s | 4 | 5 |
| Recommendations | 10 per second | 0.1 s | 1 | 2 |

These are the numbers of the animation, chosen so that the three compartments add up to the original 12. For the latency, take a high percentile of the healthy dependency and not the average. The Hystrix documentation states the rule the same way (the peak request rate of a healthy dependency × its 99th-percentile latency, plus some slack) and gives the reason to stay small: the limit is the thing that sheds load once latency climbs. AWS Lambda's guide estimates the concurrency a function needs with the same product, there with averages.

Then check the result against measurements, because calls arrive in bursts. The 4 in the Catalog row is a pessimistic figure: most calls are much faster than the percentile used, so the average number in flight is well below it. That margin is needed. If calls arrive at random and four are in flight *on average*, a compartment of five turns away roughly one call in five although nothing is wrong. The compartment's peak usage and its rejection counter under real traffic show whether the margin is enough.

**What to do with the excess.** A full compartment has three possible answers:

- **Reject at once.** The caller gets an error immediately (`BulkheadFullException` in Resilience4j) and decides what to do. This keeps latency bounded and is the right default for interactive traffic.
- **Queue briefly.** A short maximum wait or a small bounded queue absorbs a burst at the price of some latency. Keep it short: every waiter holds something as well (in a semaphore bulkhead, its own thread), so a long queue rebuilds the original problem one level up. For steady traffic, the SRE book's rule of thumb for the queue in front of a thread pool is half the pool size or less.
- **Fall back.** This is what the user gets after a rejection: cached or default data, or the page without that panel. Without a fallback, a bulkhead only turns a slow failure into a fast one.

**What to partition by.** The diagram partitions by dependency, which protects a caller from one slow downstream. The same limit can be keyed differently:

- **By tenant or client,** so that one customer's burst cannot occupy every worker. The SRE book suggests capping the share of a server's threads that any single client may hold, with a quarter as its example.
- **By priority,** so that batch or reporting work cannot crowd out checkout. Azure's description of the pattern separates critical consumers from standard ones in this way.
- **By endpoint or operation,** so that a slow export or search has a small limit of its own and cannot starve the cheap calls.

Pick the key along which failures actually arrive, and keep the number of compartments low enough that each one is still large enough to absorb an ordinary burst.

**The same idea at other levels.** Slots in a pool are the smallest bulkhead. Larger ones follow the same reasoning:

- **Connection pools:** one pool per dependency or per workload instead of one for everything.
- **Queues:** separate queues with their own consumers, so that a backlog of one kind of message doesn't delay the others.
- **Processes and containers:** each service in its own container with CPU and memory limits. Kubernetes enforces a CPU limit by throttling and a memory limit with out-of-memory kills.
- **Node pools:** dedicated nodes for one workload or tenant, set apart with taints and tolerations.
- **Instances per consumer:** separate deployments of the same service for different groups of callers.
- **Cells:** complete copies of the stack, each serving a fixed subset of customers behind a thin router, so that a bad deployment or a poisonous request stays inside one cell. The AWS Well-Architected Framework lists this as a reliability best practice under the name bulkhead architecture. Shuffle sharding, as described in the Amazon Builders' Library, refines it. With eight workers in four fixed pairs, one bad tenant takes down a quarter of the customers. Give every customer its own pair out of the 28 possible ones, and that tenant fully overlaps with only one customer in 28.
- **Zones and regions:** the largest compartments a cloud provider offers.

**How it differs from its neighbours.** A rate limit counts requests per unit of time, and a slow dependency does not change the request rate, so a rate limiter sees nothing wrong. A circuit breaker reacts to outcomes: failures or slow calls have to accumulate before it opens. A bulkhead counts calls in flight, which is exactly the number that grows when latency grows, and it acts on the first call over the limit.

## When to use it

- A service calls several dependencies of different importance through shared threads or connections. Give at least the optional ones (recommendations, ratings, ads, analytics) a compartment of their own.
- Several tenants or clients share the same workers, and one of them must not be able to starve the rest.
- Interactive and batch work, or cheap and expensive endpoints, run in the same process.
- A client library blocks and its timeouts are missing or untrusted. Thread-pool isolation is the form that still lets the caller walk away.

Not when:

- **There is nothing to separate.** If every request needs the same single dependency, a compartment for it protects nobody. Use a timeout and shed load instead.
- **The pool is too small to split.** Twelve slots in three compartments is an illustration. Dividing a small pool into many compartments leaves each too small for an ordinary burst, and healthy traffic gets rejected.
- **The work can wait.** If the caller does not need the answer now, put the work on a queue ([Queue-Based Load Leveling](../queue-based-load-leveling/)) and do it later instead of rejecting it.
- **Idle capacity is unaffordable,** or the extra configuration is not worth it for the risk. Azure's guidance names both as reasons to leave the pattern out.

## Trade-offs

- **Reserved capacity sits idle.** Catalog's five slots cannot help while Payments has a burst. Partitioned capacity has to add up to more than a shared pool would need, and part of it is always unused. Some platforms soften this by lending: the Kubernetes API server lets a busy priority level borrow concurrency that another level is not using.
- **More settings, and they age.** Every limit is a guess that drifts as traffic and latency change. Too small and healthy calls are rejected, too large and the compartment protects nothing. This is why Netflix moved on from Hystrix's fixed pool sizes to concurrency limits that adapt to measured latency, and why Envoy has an adaptive concurrency filter next to its static limits.
- **It limits concurrency, not latency.** The two stuck calls are still stuck. Without a timeout the compartment stays full for as long as the dependency is slow, and a queue in front of it adds waiting time of its own.
- **Rejections are errors that someone has to handle.** Every protected call needs a fallback or an honest error, and callers must not answer a rejection with an immediate retry.
- **Limits are per instance.** A limit of 2 on 20 instances still allows 40 concurrent calls to the dependency, and scaling the caller out raises that number. A bulkhead protects the caller. Protecting the dependency takes a limit that is enforced where all callers meet: in the dependency itself or in a proxy in front of it.
- **Thread pools cost threads and context.** More pools mean more threads, more context switches and more places where a trace ID or a security context can get lost.

## Implementation notes

- **Timeouts come first.** Every call inside a compartment needs a timeout that is shorter than its caller's patience (Timeout & Fallback). The timeout decides how quickly a slot comes back, and the bulkhead decides how many slots can be lost in the meantime. Hystrix shipped with a 1-second timeout and pools of 10 threads as its defaults.
- **Mind the order of the wrappers.** Resilience4j's Spring integration nests them by default as Retry ( CircuitBreaker ( RateLimiter ( TimeLimiter ( Bulkhead ( call ) ) ) ) ). The bulkhead is innermost, so every retry attempt needs a permit again, and a rejection passes through the circuit breaker on its way out. Decide deliberately whether a full compartment counts as a failure there. A [Circuit Breaker](../circuit-breaker/) that opens after repeated timeouts keeps even the two slots from being wasted and probes for recovery. A retry of a rejected call should back off or not happen at all ([Retry with Backoff & Jitter](../retry-with-backoff/)). A [rate limit](../rate-limiting/) on the way in keeps one client from filling a compartment by sheer volume.
- **Resilience4j (Java),** version 2.4.0 as of October 2026. The semaphore `Bulkhead` has `maxConcurrentCalls` (25 by default) and `maxWaitDuration` (0 by default, which means reject at once). `ThreadPoolBulkhead` puts a bounded queue (`queueCapacity`, 100 by default) in front of a fixed pool sized from the number of processors, and can carry thread-local context across with a `ContextPropagator`. With the annotations the semaphore is the default, and `@Bulkhead(type = Bulkhead.Type.THREADPOOL)` selects the pool for methods that return a `CompletableFuture`. Micrometer receives gauges for the available and the maximum number of concurrent calls, and every rejection is published as an event.
- **Other libraries.** Polly v8 (.NET) replaced its Bulkhead policy with a concurrency limiter, `AddConcurrencyLimiter(permitLimit, queueLimit)`, built on `System.Threading.RateLimiting`. MicroProfile Fault Tolerance has `@Bulkhead`: a semaphore on its own, a thread pool with a waiting queue when combined with `@Asynchronous`. cockatiel offers `bulkhead(limit, queue)` for Node.js.
- **Hystrix** is where many teams first met the pattern, and its wiki is still the clearest account of thread pools against semaphores. The library itself has been in maintenance mode since its final release, 1.5.18, in November 2018, and its README says Netflix uses Resilience4j for new projects. Don't start with it.
- **In a service proxy.** What Envoy calls circuit breaking is a set of bulkheads: caps on connections, pending requests and active requests towards an upstream cluster, kept per cluster and per priority. The defaults are 1,024 each, far more than a small service can afford to have stuck, so set them. Excess requests fail fast with an `x-envoy-overloaded` header and are counted in `upstream_rq_pending_overflow` (the pending cap) and, since Envoy 1.38, `upstream_rq_active_overflow` (the active-request cap, which older versions also counted in the first). The limits are shared between worker threads only approximately. Istio exposes the same settings as `connectionPool` in a `DestinationRule` (`tcp.maxConnections`, `http.http1MaxPendingRequests`, `http.http2MaxRequests`), all of them effectively unlimited until you set them. See [Service Mesh](../service-mesh/).
- **Event loops and asynchronous runtimes.** In Node.js, asyncio, Go or reactive Java a slow dependency blocks no thread, so no pool visibly fills up. The pending calls still hold memory, sockets and a share of the dependency's capacity, and the failure arrives as growing memory, exhausted sockets or timeouts everywhere. The bulkhead becomes a counter: a semaphore (`asyncio.Semaphore` in Python, `golang.org/x/sync/semaphore` or a buffered channel in Go) or a connection limit per host (Node's `http.Agent` allows unlimited sockets per origin until `maxSockets` is set). The same holds for Java's virtual threads: JEP 444 says not to pool them and to guard a scarce resource with a semaphore instead.
- **On the platform.** AWS Lambda's reserved concurrency is a bulkhead in both directions: it guarantees a function its share of the account's concurrency and caps it there, at no extra charge. Kubernetes resource limits, dedicated node pools and the API server's own API Priority and Fairness (stable since v1.29) apply the pattern to CPU, memory, nodes and API requests.
- **Measure every compartment.** Export the slots in use against the limit as gauges, and rejections and timeouts as counters, per compartment. Alert on a compartment that stays full and on any rejection in a critical one. A compartment that never gets near its limit can be made smaller.
- **Keep health checks outside.** A readiness probe that waits for a slot in a full compartment, or that reports the instance unhealthy because an optional dependency is slow, turns a contained failure back into an outage ([Health Endpoint Monitoring](../health-endpoint-monitoring/)).
- **Test the failure, not the happy path.** Inject latency into one dependency under load and check that the others keep their response times. A bulkhead that has never been full has never been tested.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Circuit Breaker](../circuit-breaker/) — Stop calling a failing dependency, fail fast with a fallback, and probe until it recovers.
- [Timeout & Fallback](../timeout-and-fallback/) — Bound every remote call and degrade gracefully when the time runs out.
- [Retry with Backoff & Jitter](../retry-with-backoff/) — Retry transient failures with growing, randomised delays so clients don't stampede.
- [Rate Limiting & Throttling](../rate-limiting/) — Cap how fast each client may call (token bucket) and shed the excess with 429s.
- [Queue-Based Load Leveling](../queue-based-load-leveling/) — A queue absorbs traffic spikes so the backend can work at a steady pace.
- Cell-Based Architecture *(planned)* — Many isolated, identical cells behind a thin router contain the blast radius of any failure.
- [Service Mesh](../service-mesh/) — Sidecar proxies plus a control plane: mTLS, retries and traffic shifting without touching app code.
- [Health Endpoint Monitoring](../health-endpoint-monitoring/) — Expose liveness and readiness checks that load balancers and monitors probe.

## References

- [Azure Architecture Center — Bulkhead pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/bulkhead)
- [Michael Nygard — Release It! (2nd edition)](https://pragprog.com/titles/mnee2/release-it-second-edition/)
- [Netflix Hystrix wiki — How it Works: isolation with thread pools and semaphores](https://github.com/Netflix/Hystrix/wiki/How-it-Works#isolation)
- [Netflix Hystrix wiki — Configuration: thread-pool properties and sizing](https://github.com/Netflix/Hystrix/wiki/Configuration#threadpool-properties)
- [Netflix Hystrix — README: Hystrix Status (in maintenance mode)](https://github.com/Netflix/Hystrix#hystrix-status)
- [Resilience4j — Bulkhead](https://resilience4j.readme.io/docs/bulkhead)
- [Resilience4j — Getting Started with Spring Boot (annotations and aspect order)](https://resilience4j.readme.io/docs/getting-started-3)
- [Envoy — Circuit breaking (limits on connections, pending requests and requests)](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/circuit_breaking)
- [Envoy — Adaptive Concurrency filter](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/adaptive_concurrency_filter)
- [Istio — Destination Rule (connection pool settings)](https://istio.io/latest/docs/reference/config/networking/destination-rule/)
- [Google SRE Book — Addressing Cascading Failures](https://sre.google/sre-book/addressing-cascading-failures/)
- [AWS Well-Architected Reliability Pillar — REL10-BP03 Use bulkhead architectures to limit scope of impact](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_fault_isolation_use_bulkhead.html)
- [AWS Builder Center — Workload isolation using shuffle-sharding (first published in the Amazon Builders' Library)](https://builder.aws.com/content/3F06NpJ8YeoIGP8VHTw4n81pFn8/workload-isolation-using-shuffle-sharding)
- [AWS Lambda — Configuring reserved concurrency for a function](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html)
- [Kubernetes — API Priority and Fairness](https://kubernetes.io/docs/concepts/cluster-administration/flow-control/)
- [Kubernetes — Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
- [Kubernetes — Taints and Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/)
- [OpenJDK — JEP 444: Virtual Threads](https://openjdk.org/jeps/444)
- [Polly — Migration guide from v7 to v8: migrating bulkhead policies](https://www.pollydocs.org/migration-v8.html#migrating-bulkhead-policies)
- [MicroProfile Fault Tolerance 4.1 — specification (Bulkhead)](https://download.eclipse.org/microprofile/microprofile-fault-tolerance-4.1/microprofile-fault-tolerance-spec-4.1.html)
- [Node.js — HTTP: agent.maxSockets](https://nodejs.org/api/http.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
