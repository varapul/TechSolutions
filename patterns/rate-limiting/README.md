<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🛡️ Resilience & Reliability](../../README.md#resilience--reliability)

# Rate Limiting & Throttling

> Cap how fast each client may call (token bucket) and shed the excess with 429s.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Rate Limiting &amp; Throttling" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/rate-limiting.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Token bucket** | The limiter keeps a **token bucket** for each client, looked up by API key. A bucket holds at most 5 tokens, which is the largest burst it will allow, and is refilled at a steady 2 tokens per second, which is the rate a client can sustain. Every request takes one token, so traffic that stays under the rate always finds one and passes straight through. |
| **2 · Burst, then 429** | Partner A sends 8 requests at once. The first 5 spend the stored tokens, because a burst is allowed up to the bucket size. The other 3 find the bucket empty and are rejected at once with **429 Too Many Requests** and a `Retry-After` header: a cheap answer that never reaches the service. Partner B's bucket is untouched and its call passes. Tokens drip back in, and A's retry a second later passes. |
| **3 · One limit, many instances** | The limiter now runs on three gateway instances. With local counters each instance would grant the full limit, three times too much in total, so the buckets live in a **shared store** (for example Redis) and each check-and-take is one atomic operation. A's 6 calls land on three different gateways, yet only 5 pass. The price is a network hop per request, and you must decide whether to fail open or fail closed when the store is down. |
| **4 · Shed load by priority** | Quotas keep clients fair, but they don't protect the backend when every client is within its quota at the same moment. So the service (or the gateway on its behalf) also watches its own capacity, here the number of requests in flight, and **sheds the lowest-priority traffic first**: a reporting call gets `503` with `Retry-After`, while a checkout call still gets in on capacity held back for critical work. Well-behaved clients back off with jitter. |
<!-- END GENERATED: header -->

## The problem

Every API has finite capacity and no control over its callers. One client stuck in a retry loop, a partner's nightly batch, a scraper or a credential-stuffing bot can take far more than a fair share, and every other client slows down with it: the **noisy neighbour** problem. More servers don't fix it. Scaling out takes minutes and costs money, the database or third-party API behind the service doesn't scale along, and the extra capacity goes to whoever sends the most. There are also reasons to count requests that have nothing to do with overload: pricing plans, fair shares between tenants, and expensive operations (login, search, exports) that need a tighter budget than cheap reads.

## How it works

A rate limiter sits in front of the work and asks one question per request: *does this caller still have budget?* It needs a **key** that identifies the caller, an **algorithm** that keeps the count, and a **response** that tells a rejected client what to do next.

**The token bucket** is the algorithm in the diagram. Each key has a bucket that holds at most *b* tokens and is refilled at *r* tokens per second. A request takes one token (or several, for an expensive operation) and is rejected if the bucket is empty. Those two numbers are the whole policy: *b* is the largest burst a client can send at once, and *r* is the rate it can sustain. A full bucket discards new tokens, so an idle client can't save up more than one burst. Nothing really drips: implementations store the token count and the time of the last update, and on each request add `elapsed × r` tokens, capped at *b*.

**Other algorithms** trade accuracy, memory and burst behaviour differently:

| Algorithm | How it counts | Trade-off |
|---|---|---|
| Token bucket | Tokens refill at a fixed rate up to a capacity; each request spends one | Allows a burst up to the capacity, then the refill rate. Two values per key |
| Leaky bucket | As a *meter* it mirrors the token bucket: a level that rises with each request and drains at a fixed rate. As a *queue*, requests wait and leave at a fixed rate | The queue form smooths traffic to a constant outflow, at the price of added latency and a queue that can fill up |
| Fixed window | One counter per key and window (per minute, say), reset at the boundary | Simplest and cheapest. A client can spend one quota at the end of a window and another at the start of the next: up to twice the limit in a short span |
| Sliding window log | Stores a timestamp per request and counts those inside the last window | Exact, but memory and work grow with the limit |
| Sliding window counter | Adds the current window's count to the previous window's count, weighted by how much of that window still overlaps | Two numbers per key and close to exact, although it assumes the previous window's requests were evenly spread. Cloudflare measured 0.003% of 400 million requests wrongly allowed or limited |
| GCRA | Stores one timestamp per key: the *theoretical arrival time* of the next request that fits the rate | Behaves like a token bucket with a single stored value and no refill step, but is harder to explain. It comes from ATM networks (the generic cell rate algorithm) |

**What to key on.** Prefer an authenticated identity: API key, OAuth client, user or tenant. An IP address is often the only key you have for anonymous traffic (sign-up, login, public pages), and it is a blunt one. A whole office, campus or mobile carrier can sit behind one NAT address, so a strict per-IP limit punishes them together, while an attacker spreads across many addresses. Behind a CDN or load balancer, take the client address only from a forwarding header that your own infrastructure sets.

**Layered limits.** Real policies stack several limits, and a request must pass all of them: for each key a short limit for bursts (per second) and a long one for volume (a quota per day or month); tighter limits, or a higher token cost, for expensive endpoints; a cap on concurrent requests for slow ones; and a global limit that protects the service whatever the per-client numbers add up to (step 4).

**The response contract.** Tell a rejected client what happened and when to come back, and know which parts are standard:

- **`429 Too Many Requests` is a standard.** RFC 6585 defines it for a user who "has sent too many requests in a given amount of time". The response may carry `Retry-After` and must not be stored by a cache.
- **`Retry-After` is a standard** (RFC 9110): a number of seconds or an HTTP date. Send it with every 429, and with the `503 Service Unavailable` you return when shedding load.
- **`RateLimit-Policy` and `RateLimit` are not a standard yet.** They let a server publish its quota policy and how much of it is left, so a client can slow down *before* it is rejected. As of October 2026 the IETF HTTPAPI working group's document (draft-ietf-httpapi-ratelimit-headers, revision 11, May 2026) is still an Internet-Draft, and its syntax has changed along the way. The current form is `RateLimit-Policy: "default";q=100;w=60` (a quota of 100 per 60-second window) and `RateLimit: "default";r=50;t=30` (50 left, to last the next 30 seconds). Revisions up to -06 used separate `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` fields, which some libraries still emit. If a response carries both, the draft says `Retry-After` takes precedence.
- **`X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` are a convention**, widespread but never standardised, and their meaning varies: the reset value is seconds-to-go on some APIs and a Unix timestamp on others (GitHub's is UTC epoch seconds). Document whichever you send.

**One limit across many instances** (step 3). A limiter that counts in memory is only correct on a single instance: behind a load balancer every instance would grant the full limit. The options:

- *A central store with atomic operations.* Every instance asks the same store, typically Redis. A fixed window is one `INCR` with an expiry. A token bucket has to read, decide and write, so it runs as a Lua script (or an equivalent single operation) to keep two concurrent requests from both spending the last token. The price is a network round trip per request and a new dependency, so give the call a short timeout and decide what happens when it fails: **fail open** (let traffic through unprotected, which is what Stripe does) or **fail closed** (reject, the safer answer for login or anything that costs money per call).
- *Local approximations.* Divide each limit by the number of instances and count locally, which assumes the load balancer spreads every client evenly, or count locally and exchange totals periodically, accepting some overshoot. Envoy can run both stages: a local token bucket absorbs large bursts before a global rate limit service makes the precise decision.
- *Accept that it is approximate.* Counters that are updated asynchronously or replicated between regions lag by a few requests. Amazon API Gateway documents its throttles and quotas as best-effort targets, not guaranteed ceilings.

**Rate limiting, throttling, load shedding, backpressure.** The words overlap, and vendors use them differently:

- *Rate limiting* enforces a budget **per caller**. It answers 429 when that caller is over its quota, even if the service is idle.
- *Throttling* is often a synonym: Amazon's Builders' Library treats "throttling" and "admission control" as other names for API rate limiting. Others use it for slowing requests down, by delaying or queueing them, as opposed to rejecting them.
- *Load shedding* protects **the service**. When it runs out of capacity it rejects work cheaply, typically with 503 and ideally the least important work first, whoever is within quota (step 4).
- *Backpressure* makes the **sender slow down** instead of dropping its work: a bounded queue that blocks producers, a flow-control window, or a client that obeys `Retry-After`.
- The Azure Architecture Center splits the two sides. Its *Throttling* pattern is the service protecting itself by limiting what each consumer may use, which is what this page shows. Its *Rate Limiting* pattern is the client's side: pacing your own calls, often through a queue, to stay under someone else's limit.

The numbers in the animation are small so they can be counted: 5 tokens, one back every half second. The 429s say `Retry-After: 1` because the header counts whole seconds and an empty bucket has a token again within half a second. The service counts 8 requests in flight as full and holds the last 2 slots back for critical calls.

## When to use it

- Any API whose callers you don't control: public, partner, or an internal platform shared by many teams.
- To enforce plans and quotas, to protect expensive or abuse-prone endpoints (login, search, export), and to contain a runaway client before it hurts the others.
- On your own outgoing calls, to stay under a dependency's limit instead of collecting its 429s.
- Add load shedding when the service can be overloaded even though every client is within its quota. That is the normal case: quotas are often oversubscribed, on the bet that not everyone uses theirs at once, and traffic is correlated during a sale or an incident.
- Not as a substitute for capacity: if normal traffic hits the limits, raise the capacity or the limits. And not as DDoS protection: a volumetric attack has to be absorbed at the network edge, before it reaches your limiter.

## Trade-offs

- **Limits are guesses.** Too low and you reject legitimate bursts, such as a page that fans out into ten calls or a job that starts on the hour. Too high and they protect nothing. Run a new limit in shadow mode first, logging what it would have rejected (Stripe calls this a dark launch; NGINX has `limit_req_dry_run`), and tune it against real traffic.
- **Retry amplification.** A rejected request tends to come back. Clients that ignore `Retry-After` and retry at once turn every 429 into more traffic, and Google's SRE book notes that a backend can be overloaded even while most of its CPU goes into rejecting requests. Rejecting has to cost much less than serving, and it has to happen early.
- **Shared identities.** Per-IP limits hit everyone behind a NAT, and one API key shared by a customer's whole fleet lets its batch job starve its own checkout.
- **A new dependency.** The shared store adds latency to every request and a failure mode of its own.
- **Approximate by nature.** Races between instances and replication lag let slightly more than the limit through. Size limits with that margin in mind instead of chasing exactness.
- **Fairness against utilisation.** Hard per-client limits leave capacity idle while others are quiet. Letting clients burst into unused capacity puts it to work, but then you need priorities to decide who is cut first when it runs out.
- **Priorities must be trustworthy.** If callers can label their own requests critical, everything becomes critical. Classify on the server, by endpoint or by the authenticated plan.

## Implementation notes

- **Enforce in layers, cheapest first.** At the edge, a CDN or WAF (Cloudflare rate limiting rules, AWS WAF rate-based rules) drops floods by IP address or fingerprint before they reach you. At the [API Gateway](../api-gateway/), apply per-key limits and plans: Amazon API Gateway usage plans are token buckets (the *rate* is the refill, the *burst* is the bucket size) plus a quota per day, week or month, and NGINX `limit_req` is a leaky bucket per key with a `burst` allowance. In a service mesh, Envoy offers a local filter and a global mode backed by an external rate limit service. In process, a library limits one instance or paces outgoing calls: Resilience4j `RateLimiter` (Java), `golang.org/x/time/rate` (Go), the ASP.NET Core rate limiting middleware (.NET).
- **Check the default status code.** NGINX and ASP.NET Core both answer rejected requests with `503` unless you set `limit_req_status 429` or `RejectionStatusCode`. Use 429 for "you are over your quota", keep 503 for "the service is out of capacity", and send `Retry-After` with both.
- **With Redis,** `INCR` plus an expiry gives a fixed window. For a token bucket, keep the token count and the last refill time in a hash and update both in one `EVAL` script. Give every key a TTL so idle clients don't pile up.
- **Client behaviour.** A well-behaved client waits at least as long as `Retry-After` says, otherwise backs off exponentially with jitter ([Retry with Backoff & Jitter](../retry-with-backoff/)), and caps its retries with a budget. Google's SRE book describes clients that throttle themselves once too many of their recent requests have been rejected. Batch clients should pace themselves just under the limit instead of discovering it through errors.
- **Shed load on what actually saturates:** concurrent requests in flight, queue time or CPU, not requests per second. Decide the priority order ahead of time. Stripe reserves a share of its capacity for critical methods and answers 503 to non-critical requests beyond the rest; Google gives every request one of four criticality levels and rejects the lowest first. Load shedding buys time for [Autoscaling](../autoscaling/) to add capacity; it does not replace it.
- **Neighbours.** A [Circuit Breaker](../circuit-breaker/) is the caller's counterpart: it stops calling a dependency that keeps failing. A bulkhead caps the concurrency each dependency or tenant may hold (Bulkhead), a queue absorbs bursts that can wait (Queue-Based Load Leveling), and a priority queue serves the important work first (Priority Queue).
- **Operate it.** Count allowed and rejected requests per key and per rule, alert when a normally quiet client starts being limited, show customers their usage and remaining quota, and keep limits changeable at runtime, with per-key overrides, so an incident doesn't need a deployment.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- [Retry with Backoff & Jitter](../retry-with-backoff/) — Retry transient failures with growing, randomised delays so clients don't stampede.
- [Circuit Breaker](../circuit-breaker/) — Stop calling a failing dependency, fail fast with a fallback, and probe until it recovers.
- Bulkhead *(planned)* — Give each dependency its own pool of resources so one failure can't sink the whole ship.
- [Queue-Based Load Leveling](../queue-based-load-leveling/) — A queue absorbs traffic spikes so the backend can work at a steady pace.
- Timeout & Fallback *(planned)* — Bound every remote call and degrade gracefully when the time runs out.
- Priority Queue *(planned)* — Urgent messages are processed ahead of routine ones.
- [Autoscaling](../autoscaling/) — Add and remove instances automatically as load rises and falls.

## References

- [RFC 6585 — Additional HTTP Status Codes: 429 Too Many Requests](https://www.rfc-editor.org/rfc/rfc6585.html#section-4)
- [RFC 9110 — HTTP Semantics: Retry-After](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3)
- [IETF HTTPAPI WG — RateLimit header fields for HTTP (draft-ietf-httpapi-ratelimit-headers, an Internet-Draft)](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/)
- [Stripe — Scaling your API with rate limiters](https://stripe.com/blog/rate-limiters)
- [Cloudflare — How we built rate limiting capable of scaling to millions of domains](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/)
- [Amazon Builders' Library — Fairness in multi-tenant systems](https://builder.aws.com/content/3Eupj3d2bo4fEvlzYbICMZNhQ3B/fairness-in-multi-tenant-systems)
- [Amazon Builders' Library — Using load shedding to avoid overload](https://builder.aws.com/content/3Eun1EEyX6p2e3VYNyRLSJzLuMV/using-load-shedding-to-avoid-overload)
- [Google SRE Book — Handling Overload](https://sre.google/sre-book/handling-overload/)
- [Azure Architecture Center — Throttling pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/throttling)
- [Azure Architecture Center — Rate Limiting pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/rate-limiting-pattern)
- [Amazon API Gateway Developer Guide — Throttle requests to your REST APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-request-throttling.html)
- [Envoy — Global rate limiting](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/other_features/global_rate_limiting)
- [Envoy — Local rate limiting](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/other_features/local_rate_limiting)
- [NGINX — Module ngx_http_limit_req_module](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html)
- [Redis Docs — Redis rate limiter](https://redis.io/docs/latest/develop/use-cases/rate-limiter/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
