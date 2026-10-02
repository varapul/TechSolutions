<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🛡️ Resilience & Reliability](../../README.md#resilience--reliability)

# Timeout & Fallback

> Bound every remote call and degrade gracefully when the time runs out.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Timeout &amp; Fallback" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/timeout-and-fallback.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · No timeout** | The Product page service calls Catalog, then Reviews and Recommendations, and none of the calls has a timeout. Recommendations hangs, so the service waits on it for as long as it hangs: the user's request stays open, and the thread and connection it holds are not available to anyone else. The user gives up after 8 seconds; after a minute the call is still waiting. |
| **2 · Bound the call** | Every call gets a **timeout** chosen from the dependency's measured latency: Recommendations normally answers in about 100 ms with a p99 of 120 ms, so 300 ms leaves plenty of room. When the timer runs out the caller stops waiting and frees its thread and connection, so the request fails after 380 ms (80 ms for Catalog plus the 300 ms timeout) instead of hanging. It still fails, though: a timeout on its own turns slow into broken. |
| **3 · Fall back** | When an *optional* call times out or fails, return something useful instead: Recommendations falls back to a cached list of popular items, marked as a fallback, and Reviews would simply be left out. Catalog is *required*: there is no honest substitute for the product itself, so if Catalog fails the page fails. The page arrives after 380 ms with one degraded section. |
| **4 · One deadline per request** | The per-call timeouts live inside one **deadline** for the whole request, here 1,000 ms, and every call is sent with the time it may take. Catalog is slow and uses 400 ms, so at most 600 ms remain: Reviews is capped at 600 ms instead of its usual 750 ms, and a call that could not finish in what remains would not be started at all. When a limit passes or the client disconnects, the **cancellation** travels down, so no service keeps working for a caller that has gone; here Recommendations is cut off after 300 ms and the page still arrives after 700 ms. |
<!-- END GENERATED: header -->

## The problem

A remote call does not always fail when something is wrong. Often it simply does not answer: the dependency is overloaded, a lock is held, a packet was dropped, or the machine at the other end went away without closing the connection. A caller that has set no time limit then waits as long as the dependency does, and the operating system is in no hurry to end the wait. With Linux defaults, unacknowledged data is retransmitted for roughly 13 to 30 minutes before the connection is given up, and an idle connection to a vanished peer is probed only after two hours, and only if keep-alive was switched on.

While it waits, the caller holds everything the request needs: a thread or task, a pooled connection, memory, and the user's own open request. All of these are limited. When slow calls hold them all, new requests queue behind them, the callers of *this* service start to wait in turn, and one slow dependency becomes a **cascading failure**. The user gave up long before.

Waiting forever, or nearly, is a common default:

| Client | Out of the box |
|---|---|
| Python `requests` | No timeout unless one is passed |
| Go `net/http` | `http.Client.Timeout` is zero, which means none. The default transport bounds dialling (30 s) and the TLS handshake (10 s), but not the wait for a response |
| Java `java.net.http.HttpClient` | A request without `timeout()` blocks forever |
| axios | `timeout` is `0`, which means none |
| gRPC | No deadline unless the client sets one |
| .NET `HttpClient` | 100 seconds |
| Node.js `fetch` (built on undici) | 300 seconds for the response headers, then 300 seconds between body chunks |

A timeout fixes the hang but not the outcome: the request now fails quickly instead of slowly. Turning that failure into something useful is the second half of the pattern.

## How it works

1. **Bound every call.** Each remote call gets a time limit taken from the dependency's measured latency. In the diagram Recommendations normally answers in about 100 ms with a p99 of 120 ms, so its timeout is 300 ms; Catalog (p99 200 ms) gets 500 ms and Reviews (p99 300 ms) gets 750 ms.
2. **Stop waiting when it expires.** The caller abandons the call and gives back its thread and connection. With a timeout alone, the page fails after 380 ms (80 ms for Catalog plus the 300 ms limit) instead of hanging.
3. **Decide what each call is worth.** Catalog is *required*: without the product there is no page, so its failure is the page's failure. Reviews and Recommendations are *optional*: when one of them times out or fails, the page uses a **fallback** instead. For Recommendations that is a cached list of popular items, marked as a fallback; for Reviews it is no section at all.
4. **Give the whole request one deadline.** The request may take 1,000 ms in total, and each call is sent with the smaller of its own timeout and the time that is left. A call that could not finish in the time left is not started. When a limit passes or the client disconnects, the caller **cancels** the calls it is still waiting on, and the cancellation travels down the chain.

Step 4 of the diagram spends the 1,000 ms like this:

| Call | Usual latency | Own timeout | What happens |
|---|---|---|---|
| Catalog (required) | p99 200 ms | 500 ms | Slow today: answers after 400 ms, so 600 ms are left |
| Reviews (optional) | p99 300 ms | 750 ms | Capped at the 600 ms that are left; answers after 150 ms |
| Recommendations (optional) | about 100 ms, p99 120 ms | 300 ms | Hangs: cut off after 300 ms, cancelled, replaced by the cached list |

The page goes out 700 ms after the request arrived (400 ms plus 300 ms), with 300 ms to spare.

"A timeout" is really several different limits, and a client that sets one of them can still hang on another:

| Limit | What it bounds | Examples |
|---|---|---|
| Connect | Opening the TCP connection | 30 s in Go's default transport; Envoy's cluster `connect_timeout` (5 s by default); nginx `proxy_connect_timeout` (60 s) |
| TLS handshake | Negotiating TLS on the new connection | 10 s in Go's default transport; part of the connect timeout for Envoy's upstream TLS connections |
| Response or read | The wait for the response headers, or for the next bytes | Go `ResponseHeaderTimeout`; the read timeout of `requests`; nginx `proxy_read_timeout` (60 s between two reads) |
| Idle | A connection or stream on which nothing happens | Go's default transport closes idle connections after 90 s; Envoy's stream idle timeout is 5 minutes and its connection idle timeout one hour |
| Overall deadline | The whole call, or the whole request, from start to last byte | Go `Client.Timeout` or a context deadline; Envoy's route timeout (15 s by default); a gRPC deadline |

A read timeout is not an overall limit. It restarts whenever bytes arrive, so a server that keeps trickling data never trips it; the `requests` documentation says that its timeout is not a limit on the whole download. Only an overall deadline bounds how long the caller really waits.

## When to use it

- **Timeouts: on every remote call, always.** HTTP and RPC calls, database queries, cache lookups, queue operations, lock acquisition, DNS, and calls to another process on the same host.
- **A deadline: whenever one request makes more than one call** or passes through more than one service.
- **A fallback: only where a degraded answer is honest and still useful.** Optional page sections, recommendations, personalisation, counters and badges, enrichment the user can do without.
- **Do not fall back where the data must be right.** An account balance, the price at checkout, stock at the moment of purchase, an authorisation decision: a stale, default or guessed value there is worse than an error, because someone will act on it. Fail clearly instead, and deny access when the authorisation check cannot be made.

## Trade-offs

- **Too short or too long.** A timeout that is too short cuts off calls that would have succeeded. The work is thrown away, and if the caller retries, the dependency gets more load exactly when it is slow, so a small rise in latency can turn into an outage. A timeout that is too long protects nothing, because the resources stay held while the caller waits.
- **A timeout does not say whether the work happened.** The request may never have arrived, may still be running, or may have finished with only the reply lost. A read can simply be repeated. For a write the outcome is unknown, so repeat it only if the operation is idempotent, or send an idempotency key so the server recognises the repeat (see [Idempotent Consumer](../idempotent-consumer/) and [Retry with Backoff & Jitter](../retry-with-backoff/)).
- **The dependency keeps working unless it is told to stop.** Giving up on a call frees the caller, not the callee, which may spend seconds finishing an answer nobody will read. Deadline propagation and cancellation exist for this.
- **A fallback is a second code path that almost never runs.** The Amazon Builders' Library article *Avoiding fallback in distributed systems* explains why Amazon almost never uses fallback to handle critical failures: such paths are hard to test, can fail themselves, hide bugs for months, and tend to make an outage wider instead of smaller. Its example is a feature of the Amazon retail site from around 2001. A cache on each web server fell back to querying the database directly; when the caches failed together, every web server hit the database, and a missing detail on a page became an outage of the whole site and of the fulfilment centres. The alternatives the article prefers are to make the main path more reliable, to let the caller handle the error, to push data ahead of time to where it is needed, and to turn the fallback into a failover that runs all the time; a fallback that cannot be avoided should be exercised in production as often as possible.
- **Degrading is milder, but not exempt.** That article is about fallbacks that try to deliver the same result by a different route; leaving out an optional section asks for less. The warning still applies to any code that runs only during an outage, and the Google SRE book says the same of graceful degradation: a path that is never used tends not to work, so keep it simple and run it regularly.
- **A fallback can hide the outage.** If the page still looks fine, nobody notices that Recommendations has been down for days unless degraded responses are counted and someone is alerted.

## Implementation notes

- **Choose the value from latency percentiles.** Measure the dependency's latency from the caller's side, decide what rate of false timeouts is acceptable, and take the matching percentile: the Builders' Library example accepts 0.1% and therefore uses p99.9. Add padding when the distribution is tight (p99.9 close to the median), because a small slowdown would then time out a large share of calls, and add network time for callers that are far away. The diagram's 300 ms against a p99 of 120 ms shows generous headroom, not a formula.
- **Check what the timer covers.** Prefer the timeout support of a well-tested client to one built on raw socket options, and find out whether it includes DNS, connecting and the TLS handshake. The Builders' Library describes a 20 ms timeout that fired after deployments because the timer included setting up a new secure connection; the lasting fix was to open connections before taking traffic.
- **Propagate the deadline instead of inventing a new timeout.** Set the deadline once, where the request enters, and hand every downstream call the time that is left, less a small allowance for the network and for your own remaining work. In the SRE book's example a server that picks 30 seconds and spends 7 before calling the next one passes on 23. Check the remaining time before each stage and do not start work that cannot finish.
- **gRPC has this built in; plain HTTP does not.** A gRPC deadline travels as the `grpc-timeout` header, converted to the time remaining so that clock differences between machines do not matter. Java and Go pass an incoming deadline on to outgoing calls automatically, C++ only when told to, and a server cancels a call whose deadline has passed. HTTP has no standard header that carries a deadline from hop to hop. What exists: `Prefer: wait=N` (RFC 7240), the client's upper bound in seconds on processing time, which a server may ignore; Envoy's `x-envoy-expected-rq-timeout-ms`, which tells the upstream service how many milliseconds the proxy expects the request to take so that it can exit early; and `Connect-Timeout-Ms` in the Connect RPC protocol. Otherwise define a header of your own and honour it in every service.
- **Cancel what nobody is waiting for.** On HTTP/1.1 a client can only abandon a request by closing the connection; HTTP/2 resets the single stream with `RST_STREAM` and the `CANCEL` code. gRPC passes a cancellation on to a handler's outgoing calls automatically in Java, Go and C++. None of it helps unless the code listens: pass the `CancellationToken` along in .NET (ASP.NET Core's `HttpContext.RequestAborted` is signalled when the client's connection is aborted) and an `AbortSignal` in JavaScript, where `fetch` has no timeout option of its own and takes `AbortSignal.timeout(ms)` as its `signal`. Python 3.11 added `asyncio.timeout()`. Long computations should check for cancellation between steps.
- **In Go, the context does both jobs.** A context derived with `WithTimeout` can never outlive its parent's deadline, so a per-call timeout is capped by the request's deadline automatically, and a server request's context is cancelled when the client's connection closes:

  ```go
  // One deadline for the whole request; r.Context() ends if the client disconnects.
  ctx, cancel := context.WithTimeout(r.Context(), 1000*time.Millisecond)
  defer cancel()

  product, err := catalog.Get(ctx, id) // required: on error the page fails
  if err != nil {
      http.Error(w, "product unavailable", http.StatusServiceUnavailable)
      return
  }

  // Optional: at most 300 ms, and never past the request's deadline.
  rctx, rcancel := context.WithTimeout(ctx, 300*time.Millisecond)
  defer rcancel()
  recs, err := recommendations.For(rctx, product)
  if err != nil {
      recs = popular.Cached() // fallback: mark it in the response and count it
  }
  ```

- **Nest limits deliberately.** For every attempt to get its full time, the outer limit must exceed the per-attempt timeout times the number of attempts, plus the waits between them; otherwise the outer limit cuts the last attempts short, or they never start. In the diagram a second attempt at Recommendations would need up to another 300 ms, which is all that is left of the deadline, so it is not started and the fallback is used at once. Libraries show the nesting: Resilience4j's Spring annotations apply `TimeLimiter` inside `Retry`, so each attempt is timed separately, and .NET's standard resilience handler wraps a 10-second attempt timeout and up to three retries in a 30-second total timeout, so the total ends the request before four full attempts could run. Across layers, give each caller a slightly longer limit than the service it calls, so that the layer that knows what went wrong reports it first.
- **Prefer fallbacks that do less work.** Roughly from safest to riskiest: leave the feature out; return a default such as an empty list or a generic ranking; serve a cached or stale copy (see [Cache-Aside](../cache-aside/); `stale-if-error` from RFC 5861 lets an HTTP cache do this); accept a write and queue it for later when it can wait (see [Queue-Based Load Leveling](../queue-based-load-leveling/)); switch to another provider; or return a clear error. The first ones need nothing that might also be down. A second provider or data store is really a failover: it works only if it carries real traffic all the time and has the capacity to take all of it. Be wary of any fallback that costs more than the path that failed. The cached list in the diagram is safe because it is refreshed in the background and already in memory, so using it adds no remote call at the moment things are going wrong.
- **Mark and count degraded responses.** Say in the response which parts are substitutes, in a field or a header, so that clients can label or hide them and caches do not keep them as the real thing. Count timeouts and fallbacks per dependency, alert on the rates, and keep degraded responses apart from good ones when you measure the service. Test with injected latency, not only injected errors.
- **Combine it with the other limits.** A timeout bounds how long one call waits; a [Bulkhead](../bulkhead/) bounds how many calls may wait at once. A [Circuit Breaker](../circuit-breaker/) counts timeouts as failures and, once open, skips the wait and goes straight to the fallback. Retries need a timeout per attempt and one deadline over all of them. Load shedding on the server (see [Rate Limiting & Throttling](../rate-limiting/)) rejects early what could not be finished in time, and [Health Endpoint Monitoring](../health-endpoint-monitoring/) takes an instance that keeps timing out away from the load balancer, which no per-call limit can do.
- **Bound the server side too.** A server should not work for longer than its callers wait. Go's `http.Server` has no read or write timeouts unless you set them (`ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`, `IdleTimeout`), and `http.TimeoutHandler` answers 503 when a handler overruns. Node.js's HTTP server allows 300 seconds to receive a request by default, and PostgreSQL's `statement_timeout` is off by default. Drop requests whose deadline passed while they sat in a queue (the SRE book's example is a 10-second deadline and 11 seconds spent queueing), and when a gateway gives up on an upstream, say so with 504 (Gateway Timeout).
- **Libraries and proxies.** Resilience4j has `TimeLimiter` (1 second by default) and a `fallbackMethod` on its annotations; Polly has a timeout strategy (30 seconds by default, raising `TimeoutRejectedException`, and cancelling through a token that the callback must honour) and a fallback strategy. Proxies such as Envoy apply route and per-try timeouts without code changes, but only the application can produce a fallback.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Circuit Breaker](../circuit-breaker/) — Stop calling a failing dependency, fail fast with a fallback, and probe until it recovers.
- [Retry with Backoff & Jitter](../retry-with-backoff/) — Retry transient failures with growing, randomised delays so clients don't stampede.
- [Bulkhead](../bulkhead/) — Give each dependency its own pool of resources so one failure can't sink the whole ship.
- [Rate Limiting & Throttling](../rate-limiting/) — Cap how fast each client may call (token bucket) and shed the excess with 429s.
- [Cache-Aside](../cache-aside/) — Read from the cache first; on a miss load from the database and populate the cache.
- [Health Endpoint Monitoring](../health-endpoint-monitoring/) — Expose liveness and readiness checks that load balancers and monitors probe.
- [Queue-Based Load Leveling](../queue-based-load-leveling/) — A queue absorbs traffic spikes so the backend can work at a steady pace.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.

## References

- [Amazon Builders' Library — Timeouts, retries, and backoff with jitter](https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter)
- [Amazon Builders' Library — Avoiding fallback in distributed systems](https://builder.aws.com/content/3EuS9Sakq7L3VLQIF3qzfMfke1Y/avoiding-fallback-in-distributed-systems)
- [Google SRE Book — Addressing Cascading Failures (deadlines, deadline propagation, cancellation, graceful degradation)](https://sre.google/sre-book/addressing-cascading-failures/)
- [Michael Nygard — Release It! (2nd edition)](https://pragprog.com/titles/mnee2/release-it-second-edition/)
- [gRPC — Deadlines](https://grpc.io/docs/guides/deadlines/)
- [gRPC — Cancellation](https://grpc.io/docs/guides/cancellation/)
- [gRPC over HTTP/2 — protocol specification (grpc-timeout)](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md)
- [RFC 7240 — Prefer Header for HTTP: the wait preference](https://www.rfc-editor.org/rfc/rfc7240.html#section-4.3)
- [RFC 5861 — HTTP Cache-Control Extensions for Stale Content (stale-if-error)](https://www.rfc-editor.org/rfc/rfc5861.html)
- [RFC 9110 — HTTP Semantics: 504 Gateway Timeout](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.6.5)
- [RFC 9113 — HTTP/2: error codes (CANCEL)](https://www.rfc-editor.org/rfc/rfc9113.html#section-7)
- [Envoy — How do I configure timeouts?](https://www.envoyproxy.io/docs/envoy/latest/faq/configuration/timeouts)
- [Envoy — Router filter: x-envoy-expected-rq-timeout-ms](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/router_filter#x-envoy-expected-rq-timeout-ms)
- [Connect — Protocol reference (Connect-Timeout-Ms)](https://connectrpc.com/docs/protocol/)
- [Requests — Advanced Usage: Timeouts](https://requests.readthedocs.io/en/latest/user/advanced/#timeouts)
- [Go — net/http package (Client.Timeout, DefaultTransport, Server timeouts)](https://pkg.go.dev/net/http)
- [Go — context package (WithDeadline, WithTimeout)](https://pkg.go.dev/context)
- [Java SE 25 — HttpRequest.Builder (timeout)](https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpRequest.Builder.html)
- [Microsoft Learn — HttpClient.Timeout property](https://learn.microsoft.com/en-us/dotnet/api/system.net.http.httpclient.timeout)
- [axios — Request config (timeout)](https://github.com/axios/axios#request-config)
- [undici — Client options (headersTimeout, bodyTimeout)](https://github.com/nodejs/undici/blob/main/docs/docs/api/Client.md)
- [Node.js — Global objects: fetch (based on undici)](https://nodejs.org/docs/latest/api/globals.html)
- [Node.js — HTTP (server.requestTimeout)](https://nodejs.org/docs/latest/api/http.html)
- [MDN — AbortSignal: timeout() static method](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static)
- [Microsoft Learn — HttpContext.RequestAborted property](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.http.httpcontext.requestaborted)
- [Python — asyncio: Timeouts](https://docs.python.org/3/library/asyncio-task.html#timeouts)
- [Linux manual pages — tcp(7) (tcp_retries2, tcp_keepalive_time)](https://man7.org/linux/man-pages/man7/tcp.7.html)
- [nginx — ngx_http_proxy_module (proxy_connect_timeout, proxy_read_timeout)](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_read_timeout)
- [PostgreSQL — Client Connection Defaults (statement_timeout)](https://www.postgresql.org/docs/current/runtime-config-client.html)
- [Resilience4j — TimeLimiter](https://resilience4j.readme.io/docs/timeout)
- [Resilience4j — Getting Started with Spring Boot (fallback methods and aspect order)](https://resilience4j.readme.io/docs/getting-started-3)
- [Polly — Timeout resilience strategy](https://www.pollydocs.org/strategies/timeout.html)
- [Polly — Fallback resilience strategy](https://www.pollydocs.org/strategies/fallback.html)
- [Microsoft Learn — Build resilient HTTP apps (standard resilience handler defaults)](https://learn.microsoft.com/en-us/dotnet/core/resilience/http-resilience)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
