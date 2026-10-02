<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🛡️ Resilience & Reliability](../../README.md#resilience--reliability)

# Retry with Backoff & Jitter

> Retry transient failures with growing, randomised delays so clients don't stampede.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Retry with Backoff &amp; Jitter" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/retry-with-backoff.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Retry what can succeed** | During a brief blip a call fails with **503**; the client waits 100 ms and the second attempt succeeds. Retry only errors that can go away: timeouts, 503, and 429 once its `Retry-After` delay has passed. A 400 or 401 is returned at once, because sending the same request again can't succeed. |
| **2 · Immediate retries** | Six calls arrive together, more than the service can handle at once, and all of them time out. Every client retries the moment its call fails, so six calls stay in flight nonstop: 120 attempts in two seconds, none succeed, and the retries keep the service overloaded instead of letting it recover. |
| **3 · Exponential backoff** | Each client waits longer after every failure: 100, 200, 400, then 800 ms, which is the cap (`min(cap, base × 2ⁿ)`). Attempts drop from 120 to 30 and the service is idle between rounds, but the clients failed together and follow the same schedule, so each round arrives as one wave and overloads it again. |
| **4 · Add jitter** | With **full jitter** each wait is drawn at random between zero and the backoff (`random(0, min(cap, base × 2ⁿ))`). The first retries still collide, then they spread out, the load stays under capacity, and all six succeed within 0.75 s using 19 attempts. A limit of five attempts stops a client from retrying forever when a failure isn't transient. |
<!-- END GENERATED: header -->

## The problem

Remote calls fail for reasons that fix themselves: a connection drops, a node restarts, a service is briefly overloaded or throttles a busy client. Retrying turns most of these blips into successes nobody notices. But every retry is one more request, sent just when the service is least able to take it. If it is failing *because* it is overloaded, clients that retry at once keep the load above capacity, so the failures continue and the attempts multiply: a **retry storm**. Amazon's Builders' Library warns that retries "can even delay recovery by keeping the load high long after the original issue is resolved." Waiting a fixed or doubling time helps less than it seems: clients that failed together wait the same time and come back together, in waves.

## How it works

A retry policy answers three questions.

- **Is this failure worth retrying?** Retry what may succeed next time: connection failures and timeouts, `503 Service Unavailable` and `429 Too Many Requests`, and usually `502`, `504` and `408` too (in gRPC, `UNAVAILABLE`). Don't resend a `400`, `401`, `403`, `404` or `422` unchanged: the same request fails the same way, and a 401 needs fresh credentials rather than a wait. (Eventual consistency can blur the line: a 404 just after a create may turn into a success once the new state has propagated.) Google's SRE book puts it plainly: don't retry permanent errors or malformed requests, "because neither will ever succeed."
- **How long should it wait?** Use **capped exponential backoff with jitter**. The backoff grows with every retry, `min(cap, base × 2ⁿ)`, and with **full jitter** the client sleeps a random time between zero and that backoff. Backoff makes each client retry less often; jitter breaks up the waves, so retries reach the service at a fairly steady rate instead of all at once. In the simulations in Marc Brooker's 2015 article, exponential backoff without jitter was "the clear loser". Full jitter and *decorrelated jitter* (each wait drawn between the base and three times the previous wait, then capped) did best, and with 100 contending clients jitter cut the number of calls by more than half. If the response carries `Retry-After`, a number of seconds or an HTTP date (RFC 9110), wait at least that long.
- **When should it stop?** After a fixed number of attempts (three in total by default in the AWS SDKs' standard retry mode, four in Polly), when the next attempt could not finish before the caller's deadline, or when a retry budget runs out. Then return the error.

The numbers in the animation come from a small model: six clients send 100 ms calls to a service that can work on four at once, and while more than four are in flight every one of them times out. Step 4 is one seeded random run with the median number of attempts (19) out of 20,000 simulated runs.

## When to use it

- Any call across a network: service-to-service APIs, databases, message brokers and cloud APIs. Most cloud SDKs already retry, and so does a service mesh such as Istio (twice for an HTTP request, by default), so find out what yours does before adding another layer.
- Background and batch work, which can afford more attempts and longer waits than a request a user is waiting for.
- Not for permanent errors, and not to wait out a dependency that is down for minutes: stop calling it and fail fast with a [Circuit Breaker](../circuit-breaker/).
- Not for operations with side effects, unless they are idempotent (see below).

## Trade-offs

- **Retries are extra load.** Each one asks a struggling service for more work, and the Builders' Library calls them "selfish" for that reason. Attempt limits and budgets keep the extra load bounded during a real outage.
- **Latency or success.** Every wait adds to the caller's latency. Azure's guidance is to fail after fewer, shorter retries in an interactive app and show a "try again later" message, and to save longer exponential schedules for batch jobs.
- **Duplicates.** A timeout doesn't tell you whether the server did the work. Retrying a payment that went through charges the customer twice unless the operation is idempotent.
- **Amplification.** Retries at several layers of a call chain multiply (see below).
- **Backoff alone isn't enough.** Without jitter, clients that failed together stay in step, and once their waits reach the cap they all retry at the capped rate together. Limit the number of attempts as well.

## Implementation notes

- **Make retried operations idempotent.** RFC 9110 defines GET, HEAD, OPTIONS, TRACE, PUT and DELETE as idempotent and says a client "SHOULD NOT automatically retry a request with a non-idempotent method" unless it knows the request is idempotent or was never applied. For POST and other unsafe operations, send an **idempotency key**: a unique ID per logical operation that stays the same across retries. The server stores the first result for that key and returns it for every retry. Stripe's `Idempotency-Key` header works this way, saving the status code and body of the first request. Message consumers need the same protection against redelivery (Idempotent Consumer).
- **Retry at one layer only.** Retries multiply down a call chain. In the Google SRE book's example, the JavaScript, frontend and backend layers each make 4 attempts, so one user action can send 64 attempts (4³) to an overloaded database. The Builders' Library describes a five-deep stack that retries at every layer and multiplies the load on the database 243 times (3⁵). Hidden layers count too: an application that makes three attempts behind an Istio sidecar that retries twice can already send nine. Retry at a single point, where the whole operation is understood, and let the layers below fail fast and report why.
- **Budget retries, not just attempts.** An attempt limit caps one request. A budget caps a whole client or process, so a widespread outage doesn't turn every request into several. The SRE book describes a per-request limit of three attempts plus a per-client budget that allows retries only while they stay below 10% of requests, which cuts the worst-case growth in traffic from almost 3× to about 1.1×. It also suggests a server-wide limit such as 60 retries per minute. Token buckets are a common way to build a budget. The AWS SDKs' standard retry mode spends tokens on each retry, returns them when requests succeed and stops retrying when the bucket is empty. gRPC's `retryThrottling` takes one token per failure, adds `tokenRatio` per success and pauses retries while fewer than half the tokens are left. Envoy's `retry_budget` caps concurrent retries at a percentage of active and pending requests (20% by default).
- **Set timeouts and a deadline.** Give every attempt a timeout and the whole operation a deadline that includes the waits. Don't start an attempt that can't finish before the deadline, and pass the remaining time to downstream calls (*deadline propagation* in the SRE book) so no layer keeps working on a request its caller has abandoned. For the per-attempt timeout, the Builders' Library starts from the dependency's latency: pick an acceptable rate of false timeouts, such as 0.1%, and use the matching percentile (p99.9).
- **Honour `Retry-After`, and send it.** With a 503, `Retry-After` says how long the service expects to be unavailable, and a 429 (RFC 6585) may carry it too. On the server side, return a clear overload status instead of letting calls hang, so clients back off; the SRE book recommends exactly that. Vary the delay you hand out, or every throttled client comes back in the same second.
- **Pair it with a circuit breaker.** Retries ride out blips; a [Circuit Breaker](../circuit-breaker/) handles failures that outlast a few attempts. Treat "breaker open" as non-retryable, so retries don't keep knocking on a dependency the breaker has already stopped calling. Azure's Retry pattern makes the same point: after repeated failures, stop sending requests and fail immediately. A bulkhead caps how many threads and connections calls to one dependency, retries included, can hold (Bulkhead).
- **Libraries.** Polly (.NET), Resilience4j (Java, `IntervalFunction.ofExponentialRandomBackoff`), tenacity (Python, `wait_random_exponential`) and the AWS SDKs all support exponential backoff with randomised waits, but check the defaults: Polly's retry strategy waits a constant 2 seconds with jitter off unless you set `BackoffType = DelayBackoffType.Exponential` and `UseJitter = true`.
- **Observe it.** Count first attempts, retries and give-ups separately and graph the retry rate: the SRE book notes that it can reveal bad retry behaviour during an incident. Azure suggests logging failed attempts that were later retried as informational, and only the final failure as an error.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Circuit Breaker](../circuit-breaker/) — Stop calling a failing dependency, fail fast with a fallback, and probe until it recovers.
- [Timeout & Fallback](../timeout-and-fallback/) — Bound every remote call and degrade gracefully when the time runs out.
- [Rate Limiting & Throttling](../rate-limiting/) — Cap how fast each client may call (token bucket) and shed the excess with 429s.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.
- [Bulkhead](../bulkhead/) — Give each dependency its own pool of resources so one failure can't sink the whole ship.
- [Queue-Based Load Leveling](../queue-based-load-leveling/) — A queue absorbs traffic spikes so the backend can work at a steady pace.

## References

- [AWS Architecture Blog — Exponential Backoff And Jitter (Marc Brooker)](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
- [Amazon Builders' Library — Timeouts, retries, and backoff with jitter](https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter)
- [Google SRE book — Addressing Cascading Failures](https://sre.google/sre-book/addressing-cascading-failures/)
- [Google SRE book — Handling Overload (retry budgets)](https://sre.google/sre-book/handling-overload/)
- [RFC 9110 — HTTP Semantics: Retry-After](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3)
- [RFC 6585 — Additional HTTP Status Codes: 429 Too Many Requests](https://www.rfc-editor.org/rfc/rfc6585.html#section-4)
- [Azure Architecture Center — Retry pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/retry)
- [AWS SDKs and Tools — Retry behavior (retry quota token bucket)](https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html)
- [gRPC — Retry (retry policy and retry throttling)](https://grpc.io/docs/guides/retry/)
- [Stripe API reference — Idempotent requests](https://docs.stripe.com/api/idempotent_requests)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
