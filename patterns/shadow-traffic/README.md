<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🚀 Deployment & Release](../../README.md#deployment--release)

# Shadow Traffic

> Mirror live requests to the new version and compare results without affecting users.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Shadow Traffic" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/shadow-traffic.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Mirror live traffic** | The proxy sends every request to **v1**, and v1's response goes back to the user. It also sends a **copy** to v2 without waiting for it (*fire and forget*) and throws v2's response away. Users never see v2, and v2's slowness or failure does not hold up their answers. |
| **2 · Watch v2 under real load** | v2 now receives the real mix of production requests at production volume, including inputs no test suite thought of. Its own metrics show what to watch: errors (here a 500 for a search with an empty query, while the user still gets v1's 200), p99 latency under the real mix, and resource use over hours, such as memory that keeps climbing. |
| **3 · Compare the responses** | Mirroring alone shows that v2 copes, not that it is right, because nobody looks at its answers. A comparator such as Diffy sends each copy to v2 and to two copies of v1 and diffs the answers. Fields that differ even between the two v1 copies, such as timestamps and generated IDs, are noise; only the rest is reported, here a `price` that changed from a string to a number. |
| **4 · Keep the shadow harmless** | A copy that writes would write twice: a second charge, a second email, shared data changed twice. So copy only reads, or give v2 stubs and a store of its own; mark the copies (Envoy and Istio append `-shadow` to the Host header); sample a percentage to limit the extra load; and remove the rule when you are done. Once the fixes are in and v2 has behaved for long enough, release it the usual way, with a canary. |
<!-- END GENERATED: header -->

## The problem

A new version can pass every test and still fail in production, because production is where the inputs, the volume and the time scales are real. A test suite covers the cases somebody thought of. Real traffic also carries the ones nobody did: an empty search box, a locale nobody tried, a page number far past the end, a client that sends a header in an unexpected shape. A load test replays an idealised mix, and a staging run lasts minutes, not the hours a slow memory leak needs to show.

The usual way to meet real traffic is to let real users meet the new version. A [canary release](../canary-release/) sends it a small share of the requests and watches its metrics, which works, but the users in that share get whatever the new version answers, errors included. For a rewrite, a new runtime or framework, a new data access layer or a performance change, it is worth seeing the new version under the full production load before a single user depends on it.

## How it works

A proxy in front of the service sends every request to the live version, **v1**, and returns v1's response to the caller exactly as before. For each request it also sends a copy to the new version, **v2**, which runs beside v1 as a *shadow*. The proxy does not wait for v2 and throws its response away. Istio calls this "fire and forget": the copy travels outside the critical path of the original request.

1. **Mirror a copy of live traffic.** The rule in the proxy reads: route to v1, mirror to v2, 100%. The user's request reaches v1, which answers in 90 ms. The copy reaches v2, which takes 1.2 s, and its answer is dropped at the proxy. Nobody waited for v2 and nobody saw what it said.
2. **Watch v2 under real load.** v2 now sees the real mix of requests at production volume, and its own metrics, next to v1's for the same traffic, are what you watch. A search with an empty query (`GET /search?q=`) makes v2 return a 500, while the user got v1's 200 and noticed nothing. v2's p99 latency is higher under the real mix than it was in the load test, and its memory climbs steadily over six hours: a leak that a ten-minute test would never show.
3. **Compare the responses.** Mirroring by itself shows that v2 copes, not that it gives the right answers, because the proxy discards them. To check correctness, the copies go to a comparator instead, which sends each one to v2 and to two instances of v1 and diffs the three answers. Fields that differ even between the two v1 instances (`served_at`, `request_id`) are noise and are left out. The field that differs only for v2 is reported: `price` changed from the string `"12.50"` to the number `12.5`, which would break clients that parse it as a string.
4. **Keep the shadow harmless.** A copied request that writes would write twice, so the rule now copies only `GET` and `HEAD` requests, samples 10% of them and carries a reminder to remove it; a `POST` goes to v1 alone. Envoy and Istio mark each copy by appending `-shadow` to its Host header, so v2 sees `catalog-shadow`. Whatever v2 still calls or writes goes to stubs and to a store of its own. Once the fixes for what the shadow found are in and v2 has been steady for long enough, the mirror rule comes out and v2 is released the usual way, with a canary.

### Where the mirror lives

Mirroring is a feature of the layer-7 proxy that already sits in front of most services, so it usually takes configuration rather than code.

- **Istio.** A route in a `VirtualService` takes a `mirror` destination next to its normal `route`, and `mirrorPercentage` sets the share of requests to copy (all of them when it is absent, at most 100). A newer `mirrors` list allows several mirror destinations, each with its own `percentage`. The reference states that the sidecar or gateway returns the original response without waiting for the mirror and that statistics are generated for the mirrored destination. Istio accepts the Gateway API form below as well.
- **Envoy.** Routes and virtual hosts carry `request_mirror_policies`. Each policy names a `cluster` (or takes it from a request header), can sample with `runtime_fraction`, and can add or change headers on the copy with `request_headers_mutations`. Envoy does not wait for the shadow cluster and collects the usual statistics for it. It does not shadow `CONNECT` requests or upgraded connections such as WebSocket.
- **NGINX.** The `mirror` directive of `ngx_http_mirror_module` (available since 1.13.4) creates a background subrequest for every original request and ignores its response. `mirror_request_body` decides whether the request body is copied too. The module has no sampling setting.
- **Kubernetes Gateway API.** A rule in an `HTTPRoute` takes a `RequestMirror` filter that points at a `backendRef`. The specification requires the gateway to ignore the mirror's responses and to send each copy to a single endpoint of that backend. Mirroring is an *Extended* feature, so check that your implementation supports it. The `percent` and `fraction` fields for sampling ([GEP-3171](https://gateway-api.sigs.k8s.io/geps/gep-3171/)) became Standard in v1.3.
- **Packet-level mirroring is a different layer.** AWS VPC Traffic Mirroring copies the network traffic of an elastic network interface to a target, such as another interface or a load balancer in front of a fleet of appliances, encapsulated in VXLAN. It is built for content inspection, threat monitoring and troubleshooting. It copies packets, not requests: to drive a second version with them, something on the receiving side has to rebuild the HTTP requests and send them on, and traffic that was encrypted on the wire arrives encrypted. [GoReplay](https://github.com/probelabs/goreplay) takes a related approach on the host itself: instead of sitting in the request path as a proxy, it listens on the network interface and forwards the HTTP requests it rebuilds to another environment.

### How a copy is marked

v2, and everything v2 calls, should be able to tell a copy from a real request: to keep it away from real side effects, to label its logs and metrics, and to stop it at any boundary that must never see copies.

- **Envoy** appends `-shadow` to the Host (`:authority`) header of every copy, so `cluster1` becomes `cluster1-shadow`. `disable_shadow_host_suffix_append` turns this off, `host_rewrite_literal` sets a host of your choice instead, and `request_headers_mutations` can add a header of your own, for example `x-shadow: true`.
- **Istio's** mirroring task describes the same `-shadow` suffix for its own API and for the Gateway API, since Istio's proxies are Envoy.
- **NGINX** adds no mark. Set a header yourself in the mirror location with `proxy_set_header`, as the module's own example does with `X-Original-URI`.
- **The Gateway API's** mirror filter has no setting for marking copies, so check what your implementation sends.

Treat the mark as a hint, not as protection. A check that somebody forgets is a second charge on a card; the isolation described under side effects below is what keeps a copy harmless.

### Fire and forget, timeouts and the cost to the proxy

Not waiting for the shadow is what keeps users safe from it, but the proxy still does all the work of a second request.

- **Envoy** gives each copy the route's timeout and discards the body of the shadow's response ([router source](https://github.com/envoyproxy/envoy/blob/main/source/common/router/router.cc)). Since [Envoy 1.33](https://www.envoyproxy.io/docs/envoy/latest/version_history/v1.33/v1.33.0) the copy is streamed alongside the original request instead of being sent once the original has fully arrived. Requests larger than the buffer limit can now be mirrored, and a copy can go out for a request that the client cancels halfway.
- **A slow or hanging v2 ties up the proxy**: connections, streams and buffers stay in use until the shadow answers or the timeout fires. Bound it with a route timeout, with connection and request limits on the shadow's upstream (Envoy's [circuit-breaking](../circuit-breaker/) thresholds per cluster), and with alerts on the proxy's own CPU and memory.
- **NGINX is an exception to fire and forget.** An NGINX developer [explained on the mailing list](https://mailman.nginx.org/pipermail/nginx/2018-August/056751.html) that the next request on the same client connection is not processed until all mirror subrequests of the previous one have finished, so with keep-alive connections a slow mirror delays real users. Later in the same thread this was called a known side effect of how mirroring is implemented, unlikely to change, and the NGINX changelog lists no change to the module since it arrived in 1.13.4. With `mirror_request_body` on, which is the default, NGINX also reads the whole request body before it creates the mirror subrequests, and unbuffered request-body proxying is switched off.
- **Every copy costs something:** a second upstream stream, encryption for a second hop, copied headers and bodies, and the network traffic of a second request. Measure the proxy's latency and CPU before and after you switch mirroring on.

### Sampling

Copying every request doubles the load behind the proxy. A share is often enough to find the errors and to measure latency, and it can be raised as confidence grows.

- **Istio:** `mirrorPercentage` on the route, or `percentage` on each entry of `mirrors`.
- **Envoy:** `runtime_fraction` on the mirror policy, which can be changed at run time.
- **Gateway API:** `percent` or `fraction` on the `RequestMirror` filter.
- **NGINX:** nothing built in. A variable from `split_clients`, which hashes a key such as the client address or a session cookie into buckets, can serve as the sample, for example by returning early from the mirror location for requests outside it.

A random sample copies single requests, not whole journeys. If v2 needs the earlier requests of a flow (a login, a cart filled a minute ago), most of its sampled requests refer to state it never saw, and the errors that follow come from the sampling rather than from the code. Where that matters, sample by user or session instead: mirror only on a route that matches a header or cookie, or hash a session key.

### What to measure

Compare v2 with v1 on the same traffic, endpoint by endpoint.

- **Errors:** 5xx responses, exceptions and timeouts in v2's logs. A rare input that fails every time is lost in an overall error rate, so look per endpoint and read the failing requests.
- **Latency:** p99 and above, per endpoint, against v1 on the same mix. Treat it as an estimate: stubs often answer faster than the real dependencies, and v2's caches and pools hold different data.
- **Saturation over time:** CPU, memory, threads, connection pools, garbage collection, disk. Leaks and slow growth take hours or days to show, so let the shadow run across at least one daily peak.
- **The proxy itself:** its latency, CPU and memory, since it now does extra work for every copy.

Keep the shadow's telemetry apart from the real service: its own labels, dashboards and alert routes, and none of its errors in v1's [SLOs and error budget](../slo-error-budgets/). Envoy can record a trace span for each copy; `trace_sampled` on the mirror policy decides whether it is sampled and by default follows the original request's decision.

### Comparing responses

The proxy discards v2's answers, so mirroring finds crashes, errors and slowness but not wrong answers. A v2 that returns a price as a number instead of a string, drops a field or rounds differently looks perfectly healthy. Checking correctness takes a diffing step on top of the mirror, and that step is the proxy form of a [parallel run](../parallel-run/).

**Diffy** is the best-known tool for it, and it is a proxy itself. Each request it receives, for example a mirrored copy, goes to three instances: a *candidate* running the new code, a *primary* running the last known-good code and a *secondary* running that same known-good code. Differences between primary and secondary come from the service's own non-determinism, such as timestamps, generated IDs and ordering, so Diffy compares how often primary and secondary disagree with how often primary and candidate disagree, treats a difference that is no more frequent than that background as noise, and reports the rest. Twitter, where Diffy began, has [archived](https://github.com/twitter-archive/diffy) its Apache-licensed repository. An actively maintained version is published as [Opendiffy](https://github.com/opendiffy/diffy) under a Creative Commons licence (BY-NC-ND 4.0) that permits sharing it only unmodified and for non-commercial purposes, so read the terms before you build on it.

Two alternatives need no comparing proxy:

- **Log both answers and diff them offline.** v1 and v2 log their responses under a correlation ID that both copies carry, and a job joins and compares the logs. There is no extra hop, but the same noise has to be handled, and both logs now hold production data.
- **Record and replay instead of mirroring live.** Capture production traffic, then replay it against v1 and v2 in a test environment. GoReplay can save captured requests to a file and replay them later with the original timing between them, faster or slower, or in a loop. A recording can be replayed as often as needed without touching the production proxy. It also ages, it lacks state that changed since, and it is a stored copy of production data that has to be protected like one.

Whatever does the comparing, normalise before you diff (sort lists that are really sets, drop timestamps and generated IDs, compare money as exact decimals) and keep the list of ignored fields short and reviewed. The [parallel run](../parallel-run/) pattern goes through the noise in detail.

### Privacy

A copy of a production request is production data: names, addresses, payment details, and the user's cookies and access tokens. Sending it to a shadow does not turn it into test data.

- **Hold v2 to the same rules as v1:** the same access controls, log retention, region and encryption. If the shadow runs somewhere less trusted, copies must not reach it unmasked.
- **Strip what v2 does not need before the copy leaves the proxy**, with header mutations on the mirror policy in Envoy or header rewrites in the NGINX mirror location. A copied `Authorization` header or session cookie is a working credential, and a v2 that calls other services with it acts as the user.
- **Follow the copies:** v2's logs, error reports, traces and request dumps all keep what they receive. A recording kept for replay is a stored copy of personal data, with the obligations that come with that.
- **Some data may not be copied at all**, for legal or contractual reasons. Then those routes cannot be mirrored.

### Side effects and drifting data

Mirroring is easy for requests that only read and dangerous for everything else. A copied write runs twice: a card is charged twice, an email goes out twice, shared data changes twice.

- **Copy only safe methods,** `GET` and `HEAD`, by putting the mirror on a route that matches them. Then check that your reads really are read-only: view counters, "recently viewed" lists, session refreshes, caches filled on a miss and audit logs all write.
- **Isolate whatever v2 still does.** Point its outbound calls (payment providers, email and SMS gateways, partner APIs) at stubs that record what they were asked, and its writes at a store of its own. Block its egress to the real third parties at the network level too, so a stub that somebody forgot becomes a failed call instead of a real one.
- **Watch the shared middle layers.** v2 can fill a shared cache with entries in a new format that v1 then reads. Events that v2 publishes to the real broker are consumed by real consumers. A third party's rate limits and quotas count v2's calls as well. Give v2 its own cache and topics, or switch those paths off in the shadow.
- **Expect the data to drift.** A store that only v2 writes to stops matching the live one: it misses every write that was not mirrored, by the method filter or by sampling, and it contains whatever v2 did differently. Reads served from it drift too, and their differences then say something about the data, not about the code. Seed it from a snapshot and keep it in step with [change data capture](../change-data-capture/) from the live store, or let v2 read from a replica of the live data and write only to its own store.

### Cost

Mirroring all traffic needs a second fleet that can carry the production load, plus its stubs and its store, plus the proxy's extra work and the network traffic of every copy. Sample, run the shadow only as long as it is teaching you something, and delete the mirror rule when you are done: a forgotten mirror keeps costing money and keeps copying user data.

### Shadow, then canary, then everyone

Mirroring shows that v2 copes with real traffic. It cannot show how users react to v2's answers or how the system behaves once those answers matter: a client that retries on v2's errors, a cache that stores v2's responses. It is a step before a release, not a release.

1. **Shadow** v2 until its errors, latency and resource use match v1's, and until the comparator, if you use one, has no unexplained differences left.
2. **Canary:** give v2 a small share of real users and widen it while its metrics stay healthy ([canary release](../canary-release/)). For a change inside one deployment a [feature flag](../feature-flags/) does the same job, and a [blue-green](../blue-green-deployment/) switch moves everybody at once with the old environment kept as the way back.
3. **Full rollout,** then remove v1.

In a [service mesh](../service-mesh/), the `VirtualService` or `HTTPRoute` that mirrors to v2 in the first stage can split traffic by weight in the second, so moving from shadow to canary is a change of configuration.

### Not the same as a parallel run

Both run the new version beside the old one without letting users depend on it. The comparing step is where they meet.

| | Shadow traffic | [Parallel run](../parallel-run/) |
|---|---|---|
| Where the second call happens | in the proxy, as a copy of the HTTP request | in the application, or in a comparing proxy, for every input |
| What happens to the new version's answer | discarded, unless a comparator is added | always compared with the old one |
| The question it answers | does v2 cope with real traffic: errors, latency, resource use? | does v2 give the same answers, input by input? |
| Done when | v2 has behaved for long enough | every mismatch has been explained |
| What follows | a canary release of v2 | the roles swap and the new code becomes the source of truth |

## When to use it

- **A change that callers should not notice, but that could break under real load:** a rewrite of a read-heavy service, a new framework, runtime or language version, a new database driver or query layer, a new cache, a performance change.
- **Doubts about the input, not the logic:** the real mix of requests, clients and data shapes is what no test environment reproduces.
- **Capacity questions:** how many instances does v2 need for the real mix? A mirror at 100% answers that before users depend on it.
- **Before a canary** of anything that takes real load, to catch the obvious failures without exposing a single user.

Martin Fowler's [dark launching](https://martinfowler.com/bliki/DarkLaunching.html) is the wider practice of calling new back-end behaviour from existing user requests without showing users the result, typically to measure its load before a feature is announced; mirroring in the proxy is one way to do it. He recommends a canary release instead when what is being tested depends on choices users make.

**When not to use it.**

- **Write-heavy flows whose side effects cannot be isolated:** payments without a sandbox, messages to partners, a ledger. If a copy cannot run without consequences, do not copy it.
- **Data that may not be copied:** personal or regulated data that may not leave its system or reach a less trusted environment.
- **Behaviour that depends on users seeing the answer:** a new screen, a recommendation that has to be clicked. Nothing in the shadow's answers tells you how users react; that is what a canary or an A/B test is for.
- **Long-lived and streaming connections:** Envoy cannot mirror `CONNECT` requests or upgraded connections such as WebSocket, and a stateful conversation rarely makes sense copied request by request.
- **Very little traffic:** a few requests an hour exercise less than a good test suite.

## Trade-offs

- **A second fleet** (or a sampled share of one) and extra work in the proxy, for as long as the shadow runs.
- **It shows that v2 copes, not that it is right,** unless you add a comparator, and then the noise handling is yours to build and maintain.
- **The shadow is not quite production:** stubs answer faster than real dependencies, caches hold different data and the isolated store drifts. Its latency and error rates are estimates.
- **Isolation is never complete by default.** Every side effect has to be found and blocked, and the one that was missed happens twice.
- **It copies personal data** into another system, with the obligations that come with it.
- **Fire and forget is not free:** the proxy carries every copy, and in NGINX a slow mirror can hold up the next request on a keep-alive connection.
- **A forgotten mirror** keeps costing money and copying data long after anybody looks at the shadow.

## Implementation notes

- **The rule from the diagram in Istio** (copy only reads, 10% of them). Match blocks in a list are alternatives, so the first route catches `GET` or `HEAD`; everything else, writes included, falls through to the second route and goes to v1 alone. The `v1` and `v2` subsets come from a `DestinationRule` that selects pods by their version label, as in Istio's mirroring task.

  ```yaml
  apiVersion: networking.istio.io/v1
  kind: VirtualService
  metadata:
    name: catalog
  spec:
    hosts:
    - catalog
    http:
    - match:
      - method:
          exact: GET
      - method:
          exact: HEAD
      route:
      - destination:
          host: catalog
          subset: v1
      mirror:
        host: catalog
        subset: v2
      mirrorPercentage:
        value: 10.0
    - route:
      - destination:
          host: catalog
          subset: v1
  ```

- **With the Gateway API** the same shape is an `HTTPRoute` with one rule that matches the method and carries a `RequestMirror` filter with `percent: 10`, and a second rule for the rest.
- **Bound the shadow's share of the proxy:** a route timeout, connection and request limits on the shadow's upstream, and alerts on the proxy's own resources.
- **Run v2 like production:** the same instance types, configuration and replica count for the mirrored share, or its latency and capacity numbers mean little.
- **Decide the exit first:** what "behaved for long enough" means (no new error types across several daily peaks, p99 and memory within stated limits, a clean comparator), and the date by which the mirror rule, the stubs and the isolated store are deleted.
- **For routes that cannot be mirrored,** replay recorded and masked requests into an isolated environment instead.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Canary Release](../canary-release/) — Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back.
- [Parallel Run](../parallel-run/) — Run old and new side by side on the same inputs and compare results before cutting over.
- [Blue-Green Deployment](../blue-green-deployment/) — Run the new version beside the old one and switch all traffic in one step.
- [Service Mesh](../service-mesh/) — Sidecar proxies plus a control plane: mTLS, retries and traffic shifting without touching app code.
- [Feature Flags](../feature-flags/) — Deploy code dark, then turn features on per user or percentage at runtime.
- [Load Balancing](../load-balancing/) — Spread requests across healthy instances and stop sending to unhealthy ones.
- [Rolling Update](../rolling-update/) — Replace instances batch by batch while the service stays up.
- [SLOs & Error Budgets](../slo-error-budgets/) — Measure SLIs against an objective and alert on error-budget burn rate, not on every blip.

## References

- [Istio — Mirroring (task)](https://istio.io/latest/docs/tasks/traffic-management/mirroring/)
- [Istio — Virtual Service reference (mirror, mirrors, mirrorPercentage)](https://istio.io/latest/docs/reference/config/networking/virtual-service/)
- [Envoy — HTTP route components: RequestMirrorPolicy](https://www.envoyproxy.io/docs/envoy/latest/api-v3/config/route/v3/route_components.proto#config-route-v3-routeaction-requestmirrorpolicy)
- [NGINX — Module ngx_http_mirror_module](https://nginx.org/en/docs/http/ngx_http_mirror_module.html)
- [Kubernetes Gateway API — HTTP request mirroring](https://gateway-api.sigs.k8s.io/guides/user-guides/http-request-mirroring/)
- [Kubernetes Gateway API — GEP-3171: Percentage-based Request Mirroring](https://gateway-api.sigs.k8s.io/geps/gep-3171/)
- [Martin Fowler — Dark Launching](https://martinfowler.com/bliki/DarkLaunching.html)
- [Opendiffy — Diffy: what it is and how it works (README)](https://github.com/opendiffy/diffy)
- [Twitter — Diffy (the original repository, archived)](https://github.com/twitter-archive/diffy)
- [GoReplay — capture and replay live HTTP traffic](https://github.com/probelabs/goreplay)
- [AWS — What is Traffic Mirroring? (Amazon VPC)](https://docs.aws.amazon.com/vpc/latest/mirroring/what-is-traffic-mirroring.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
