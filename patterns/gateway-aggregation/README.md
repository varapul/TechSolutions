<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🚪 API & Edge](../../README.md#api--edge)

# Gateway Aggregation

> Fan one client request out to several services and merge the answers into one response.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Gateway Aggregation" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/gateway-aggregation.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · A chatty client** | To draw one product page, the app calls Product, then Reviews, then Inventory, over a mobile network where every round trip costs about 150 ms. The page is complete after (150 + 40) + (150 + 80) + (150 + 30) = **600 ms**. The app has to know three endpoints, and every service has to be reachable from the internet. |
| **2 · One request, fanned out** | The app sends one request, `GET /product-page/42`, to an aggregation endpoint on the gateway. The gateway calls the three services **in parallel** over the data centre network, waits for all three and merges their answers into one response: 150 + 5 + 80 = about **235 ms**, set by the slowest service. The services no longer need public endpoints. |
| **3 · Partial failure** | Reviews stops answering. Each internal call has its own timeout inside a 200 ms deadline, so after 100 ms the gateway gives up on Reviews and returns **200 OK** with the product and the stock level and the reviews section marked *unavailable*, in about 250 ms. Product is **required**: if it fails, the whole request fails. See [Timeout & Fallback](../timeout-and-fallback/). |
| **4 · Know the limits** | The aggregator only calls, merges and reshapes: prices, rules and decisions stay in the services. Every page now depends on it and on every service it calls, so run several instances and watch each call. Calls that need another call's result run one after the other and their times add up (150 + 45 + 85 = 280 ms), and stable parts such as product details can be [cached](../cache-aside/). |
<!-- END GENERATED: header -->

## The problem

A product page in a [microservices](../microservices/) system needs data that several services own: the product from Product, the rating from Reviews, the stock level from Inventory. If the app fetches every part itself, it pays for each call over the slowest link it has, the mobile network.

The diagram uses illustrative numbers: a round trip between the phone and the data centre costs about 150 ms, a hop inside the data centre about 5 ms, and Product, Reviews and Inventory take 40, 80 and 30 ms. Three calls made one after another keep the user waiting (150 + 40) + (150 + 80) + (150 + 30) = 600 ms, and only 150 ms of that is work. The other 450 ms is the network.

Sending the three calls at once would shorten the wait, but the other costs remain. The app still sends, authenticates and waits for three requests, and each of them can fail on a weak signal; the Azure guidance makes the same point about separate requests over cellular networks. Some calls can't go out at once anyway, because one needs another's result.

A chatty client is also tied to the way the services are split:

- **The app knows every endpoint.** Splitting, merging or moving a service becomes an app release, and older versions of the app stay in use long after it ships.
- **Every service faces the internet.** Each one needs its own TLS, authentication, rate limits and security review.
- **Every new feature adds calls.** A new section on the page means one more request from every client.

## How it works

Put an **aggregation endpoint** in front of the services, here `GET /product-page/42` on the gateway. For each request it:

1. **Accepts one request** and does the edge work once: TLS, authentication, rate limits.
2. **Fans out**: it calls Product, Reviews and Inventory **in parallel** over the data centre network, where a hop costs a few milliseconds.
3. **Waits** for all the answers it needs, or until its deadline runs out.
4. **Merges and shapes** them into one response with a section for each part, and sends it back.

The client pays for one round trip plus the slowest call: 150 + 5 + 80 = about **235 ms** in the example. Three ways to load the same page compare like this:

| | Requests over the mobile network | Waiting time in the example |
|---|---|---|
| Three calls, one after another | 3 | (150 + 40) + (150 + 80) + (150 + 30) = 600 ms |
| Three calls from the app at the same moment | 3 | the slowest round trip, 150 + 80 = 230 ms |
| One aggregated call | 1 | 150 + 5 + 80 = 235 ms |

Compared with calls the app already sends at once, aggregation saves requests rather than milliseconds: one request to send, authenticate and retry over a weak signal instead of three, one endpoint for the app to know, and no service that has to face the internet. Compared with calls that have to run in sequence, it also saves whole round trips, because the sequence now runs inside the data centre (see *Parallel and dependent calls* below).

Chris Richardson describes the same idea as **API composition**: a composer queries each service that owns part of the data and joins the results in memory, and an API gateway is a common place to do it.

## When to use it

- **High-latency clients:** phones on cellular networks, users far from the region that hosts the services, any link where a round trip costs more than the work behind it.
- **Screens built from many small calls:** a page that needs data from several services, where the client would otherwise make one call per section.
- **Calls that depend on each other:** moving a chain into the data centre turns slow round trips into fast hops.
- **Services that shouldn't be public:** with one aggregation endpoint at the edge, the services stay on the internal network.

It is a poor fit when:

- **The caller sits next to the services.** Another service in the same data centre pays a few milliseconds per call, so an extra layer adds a hop and a component for little gain. The Azure guidance says the same.
- **All the calls go to one service.** Give that service a batch or composite operation, as the Azure guidance suggests, instead of a layer that only loops over it.
- **The parts are wanted at different times.** The merged response is as slow as its slowest part. If the screen should show the product at once and the reviews when they come, load the slow, optional part with its own request.

## Trade-offs

- **The slowest call sets the pace, and fanning out makes slow calls more likely.** If each service is slow on 1 request in 100, a page that needs all three is slow about 3% of the time (1 − 0.99³). Dean and Barroso show how fast this grows: a request that needs answers from 100 servers with those odds is slow 63% of the time.
- **One more component on every page's path.** The aggregator can become a single point of failure and a bottleneck, so it needs several instances, load tests and the same monitoring as the services. A page can't be more available than the services it requires.
- **Logic creep.** Merging, renaming and dropping fields belong here; prices, eligibility rules and authorization decisions don't. Once business rules move into the aggregator it becomes a second, hidden owner of the domain, and a service team can no longer change its rules on its own. The Azure guidance also warns against letting the gateway couple the services to each other.
- **More internal traffic.** Every page view becomes three internal calls, and every retry or duplicate request adds more.
- **Partial results are part of the contract.** Every aggregation endpoint has to say which parts are required, and every client has to handle a response with a section missing.
- **Ownership.** If a platform team owns the gateway, each new screen waits in its queue. When the aggregation serves one client experience, a [Backend for Frontend](../backends-for-frontends/) owned by that client's team is often the better home.

## Implementation notes

### Where to build it

- **In the gateway, from configuration.** Some gateways merge several services' responses without code. In KrakenD, an endpoint with more than one backend calls them in parallel and merges the results; a `group` setting puts each backend's answer under its own key. When some backends fail or miss the endpoint's timeout, KrakenD still answers 200 with what it has and marks the response `X-KrakenD-Completed: false`; when none succeeds, the client gets a 500. In Azure API Management, a `send-request` policy calls a service and keeps its response in a variable, and `return-response` can build the combined body. Wrap the `send-request` policies in a `wait` policy to run them in parallel (`for="all"` waits for every one, `for="any"` for the first); on their own they run one after another, as Microsoft's dashboard sample points out.
- **In a small aggregation service behind the gateway,** when the composition needs code: conditional calls, reshaping, a fallback per section. The Azure guidance suggests this split, because aggregation needs different resources from the gateway's routing and offloading work and could affect them. Use asynchronous I/O so that waiting on three services doesn't hold three threads; Chris Richardson recommends non-blocking, reactive frameworks for gateways for the same reason.
- **In a [Backend for Frontend](../backends-for-frontends/),** when one client experience needs its own shape of the page. Sam Newman's article recommends making as many downstream calls in parallel as possible, and degrading the response when an optional service is down.
- **As a GraphQL server,** when different clients need different subsets of the same data (see below).

### Parallel and dependent calls

Independent calls should start together, so the wait is the slowest of them. A call that needs another call's result can only start when that result arrives, and their times add up. If Reviews needed an ID that only Product's answer contains, the page would take 150 + 45 + 85 = **280 ms**: slower than 235 ms, but well ahead of the app making the same two calls in turn, (150 + 40) + (150 + 80) = 420 ms.

- Write the calls down as a small dependency graph, start each one as soon as its inputs are ready, and run everything else in parallel with the chain.
- Shorten chains where you can: let a service accept the key the client already has, rather than one that only another service knows.
- KrakenD supports chains with its sequential proxy strategy, where a later backend's URL can use fields from an earlier response, but its documentation calls chained calls an anti-pattern: every link adds latency and another chance to fail.

### Designing partial responses

Decide for each section whether the page is useless without it.

- **A required part fails the request.** Without the product there is no page, so return an error: RFC 9110 defines **502 Bad Gateway** for a gateway that got an invalid response from the server behind it, and **504 Gateway Timeout** for one that got no answer in time.
- **An optional part degrades.** Return **200** with a status for every section, so the client can render the rest and show a placeholder:

  ```json
  {
    "product":   { "status": "ok", "data": { "id": 42, "name": "Sneaker", "price": 89 } },
    "reviews":   { "status": "unavailable", "error": { "title": "Reviews did not answer in time" } },
    "inventory": { "status": "ok", "data": { "inStock": 12 } }
  }
  ```

- **Not 206.** RFC 9110 defines 206 Partial Content as the successful answer to a *range request*, where the client asked for some byte ranges of one representation. A page with a missing section is something else.
- **Give each failed section its own error.** The members of RFC 9457 problem details (`type`, `title`, `status`, `detail`) work inside a section too; the RFC describes embedding problem details in other formats.
- **Flag an incomplete response at the top as well,** for clients and caches that don't read every section. KrakenD sets `X-KrakenD-Completed: false` and leaves out its cache headers, so an incomplete page isn't cached as if it were whole.
- **Test the client against every missing part,** not only the happy path.

GraphQL builds this into the protocol. In the September 2025 specification, a field that fails resolves to null and its error goes into the response's `errors` list next to the partial `data`; if the field is Non-Null, the null travels up to the nearest field that may be null. The schema's nullability is the required-or-optional decision.

### Timeouts, one deadline, circuit breakers and fallbacks

- **Give every call its own timeout inside one deadline** for the whole request, and send each call with the smaller of its timeout and the time left (see [Timeout & Fallback](../timeout-and-fallback/)). In the diagram the deadline is 200 ms: required Product may take up to 150 ms, optional Reviews and Inventory 100 ms each.
- **Stop abandoned work.** When the gateway gives up on Reviews, cancel the call, so that Reviews stops working on an answer nobody will read.
- **Put a [circuit breaker](../circuit-breaker/) in front of each service.** While Reviews keeps failing, the breaker answers at once and the section is marked unavailable without a 100 ms wait on every page. Azure API Management can attach one to a backend entity: once it trips, the gateway stops sending requests to that backend for a set time and answers 503 instead (not in the Consumption tier).
- **Choose a fallback per section:** a cached copy (the Azure guidance suggests cached data as a failover), a default, or nothing but a clear status.
- **Retry with care.** A retry is only worth it for an idempotent read with enough of the deadline left, and every retry adds internal load.

### Caching

- **Cache per part.** A merged page is only as fresh as its most volatile part, so caching the whole response gives everything the shortest lifetime. Keep stable parts such as product details for minutes in the aggregator, with a [cache-aside](../cache-aside/) lookup before the call, and fetch volatile parts such as stock on every request.
- **Don't store an incomplete response as a complete one,** and keep personalised sections out of shared caches.
- In Azure API Management, `cache-lookup-value` may sit in the same `wait` block as the `send-request` calls, so cache lookups and service calls run in parallel.

### Tracing a fan-out

One page is now one request at the edge and several behind it, and a trace is how you find the slow part. Propagate the W3C `traceparent` header on every downstream call, so that each call becomes a child span of the gateway's span in the same trace (see [Distributed Tracing](../distributed-tracing/)). In the trace view parallel calls overlap, and a staircase of calls that start one after another shows sequencing that nobody intended. Record latency and errors for each downstream call, and count partial responses: a rising share of pages without reviews is an incident even when every request returns 200. The Azure guidance also recommends watching request metrics and response sizes.

### Calling services with the user's identity

The services still decide who may see what, so they need to know who is asking: don't call them with one powerful gateway credential. Send the user's identity in a token each service accepts, either the user's own access token when its audience includes that service, or a new token for each service from OAuth 2.0 Token Exchange (RFC 8693), whose `audience` parameter names the target service (see [Token Exchange](../token-exchange/)). A single token that all three services accept can be replayed against all three by any of them. An exchange is one more call, to the authorization server, so reuse each exchanged token until it expires.

### The extra internal load a fan-out creates

- One request at the edge becomes three inside: 1,000 page views per second turn into 3,000 internal calls per second before any retry. Size the services, connection pools and internal rate limits for the fan-out, not for the edge traffic.
- **Duplicate requests multiply it again.** Hedging, sending a second copy when the first is slow, cuts tail latency at a price. Dean and Barroso keep the extra load to about 5% by sending the backup only after the first request has been outstanding longer than the 95th-percentile latency. KrakenD's `concurrent_calls` sends up to N copies of each backend request and keeps the first good answer, so that backend can see up to N times the load.
- **Caching keeps the multiplier down,** especially for popular pages and stable parts.

### GraphQL: aggregation driven by the query

A GraphQL server is an aggregator whose response shape the client chooses: the query names the fields, and resolvers fetch them from the services that own them. Different screens get different subsets from one endpoint instead of one hand-built aggregation endpoint each, and partial results come with the protocol (see above). The costs move to the server: client-written queries need cost limits, and a resolver that calls a service once per item needs batching. GraphQL Federation goes further: a router composes one graph from many services' subgraphs and plans each query across them.

### Routing, offloading and aggregation in one gateway

An [API gateway](../api-gateway/) routes each request to one service and applies the edge policies once, and [gateway offloading](../gateway-offloading/) moves shared work such as TLS and token validation into it. Aggregation is a different kind of job: one request becomes several, the gateway holds the request open while it waits, and its memory use grows with the size of the answers. That is why the Azure guidance suggests considering an aggregation service behind the gateway. A common split: the gateway authenticates, rate-limits and routes `/product-page/*` to an aggregation service or a BFF, and that service does the fan-out.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- [Backends for Frontends (BFF)](../backends-for-frontends/) — A dedicated backend per client type, shaped for exactly what that UI needs.
- [GraphQL Federation](../graphql-federation/) — Subgraphs from many services compose into one graph; a router plans each query across them.
- [Gateway Offloading](../gateway-offloading/) — Move TLS termination, authentication and compression out of every service into the gateway.
- [Timeout & Fallback](../timeout-and-fallback/) — Bound every remote call and degrade gracefully when the time runs out.
- [Circuit Breaker](../circuit-breaker/) — Stop calling a failing dependency, fail fast with a fallback, and probe until it recovers.
- [Microservices](../microservices/) — Small, independently deployable services, each owning one business capability and its data.
- [Cache-Aside](../cache-aside/) — Read from the cache first; on a miss load from the database and populate the cache.

## Related database topics

- [N+1 Queries](../n-plus-one-queries/) — One query for a list, then one more for every row: how ORMs fall into it, how to spot it, and how batching or a join fixes it.

## References

- [Azure Architecture Center — Gateway Aggregation pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/gateway-aggregation)
- [Chris Richardson (microservices.io) — Pattern: API Composition](https://microservices.io/patterns/data/api-composition.html)
- [Chris Richardson (microservices.io) — Pattern: API Gateway / Backends for Frontends](https://microservices.io/patterns/apigateway.html)
- [Sam Newman — Pattern: Backends For Frontends](https://samnewman.io/patterns/architectural/bff/)
- [Jeffrey Dean, Luiz André Barroso — The Tail at Scale (Communications of the ACM, 2013)](https://research.google/pubs/the-tail-at-scale/)
- [RFC 9110 — HTTP Semantics: 206 Partial Content](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.7)
- [RFC 9110 — HTTP Semantics: 502 Bad Gateway and 504 Gateway Timeout](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.6)
- [RFC 9457 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)
- [GraphQL Specification (September 2025) — Handling Execution Errors](https://spec.graphql.org/September2025/#sec-Handling-Execution-Errors)
- [KrakenD — API Composition and aggregation](https://www.krakend.io/docs/endpoints/response-manipulation/)
- [KrakenD — Data Manipulation (group)](https://www.krakend.io/docs/backends/data-manipulation/)
- [KrakenD — Sequential Proxying](https://www.krakend.io/docs/endpoints/sequential-proxy/)
- [KrakenD — API Throttling and Timeout Management](https://www.krakend.io/docs/throttling/timeouts/)
- [KrakenD — Handling Concurrent Requests](https://www.krakend.io/docs/endpoints/concurrent-requests/)
- [Azure API Management — wait policy](https://learn.microsoft.com/en-us/azure/api-management/wait-policy)
- [Azure API Management — send-request policy](https://learn.microsoft.com/en-us/azure/api-management/send-request-policy)
- [Azure API Management — Using API Management service to generate HTTP requests (response composition)](https://learn.microsoft.com/en-us/azure/api-management/api-management-sample-send-request)
- [Azure API Management — Backends: circuit breaker](https://learn.microsoft.com/en-us/azure/api-management/backends#circuit-breaker)
- [W3C — Trace Context](https://www.w3.org/TR/trace-context/)
- [RFC 8693 — OAuth 2.0 Token Exchange](https://www.rfc-editor.org/rfc/rfc8693.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
