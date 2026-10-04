<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🚪 API & Edge](../../README.md#api--edge)

# Ambassador

> An out-of-process proxy that handles outbound connectivity (retries, TLS, routing) for a client.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Ambassador" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/ambassador.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · A client you can't change** | The billing application is a vendor binary: nobody can change its code. It calls the tax API directly, at a fixed address from its configuration, over plain HTTP, with no timeout, no retries and no metrics. When the tax team moves the API to a new address that demands TLS with a client certificate and an access token, every call fails, and had the API only slowed down, billing would have hung. |
| **2 · A proxy beside the client** | An **ambassador**, a small proxy process on the same host (or a sidecar container in the same pod), listens on `localhost:9000`, and pointing billing's configured endpoint at it is the only change to billing. The ambassador finds the API's current instances through service discovery (and keeps that list fresh), opens a TLS connection with the client certificate, adds the access token and forwards the call. To billing, the remote API now looks like a local service. |
| **3 · Resilience and visibility** | The tax API starts timing out. The ambassador gives each try 2 s, waits a jittered backoff and retries the idempotent `GET /rates` lookup on the other instance, which answers; once timeouts pass 50 % its **circuit breaker** opens, and the next call fails in about a millisecond. Billing gets one answer or one clean error instead of hanging, and every call leaves metrics and a trace span. |
| **4 · Know the costs** | Every call pays one more hop (small on localhost), and every client brings one more process to deploy, patch and watch. Retries are safe only for idempotent calls, which a proxy cannot always recognise, so the client may have to pass a hint such as an idempotency key; and you choose between one ambassador per client and one shared by several. A client library is simpler when every client uses one language, and a service mesh is the generalisation when every service needs the same thing. |
<!-- END GENERATED: header -->

## The problem

Most estates have a client like the billing application in the animation: a vendor product, or code whose authors left years ago, that does its job and that nobody is able, or allowed, to change. It calls a remote service in the simplest way possible: one fixed address, plain HTTP, no timeout, no retries, no metrics.

That works until the remote side changes, and remote services change all the time:

- **They move.** New hosts, new addresses, more instances behind a name in DNS or a service registry. A client that knows one fixed address keeps calling the old one.
- **They raise the bar on security.** HTTPS only, mutual TLS with a client certificate, an OAuth 2.0 access token on every request. A client that can't be rebuilt can't learn any of it.
- **They slow down or fail.** Without a timeout, every slow call holds a thread or a connection until the client runs out of them and hangs. Without retries, every blip becomes an error. Without a circuit breaker, the client keeps hammering a service that is already struggling.
- **Nobody can see what happens.** Without metrics or traces, when billing is slow nobody can tell whether billing or the tax API is to blame.

The usual cure is a client library: an HTTP client with timeouts, retries, TLS and telemetry, built into the code. That is exactly what can't be done here. Even where it can, an estate written in five languages needs five libraries that behave the same, each upgraded in every service on every release train.

## How it works

Put a small proxy, the **ambassador**, next to the client and send the client's outbound calls through it. The Azure Architecture Center describes it as an out-of-process proxy colocated with the client: it runs on the same host or, in Kubernetes, in the same pod, so the client reaches it over `localhost`.

1. **The client calls localhost.** The only change to billing is one setting: its tax endpoint becomes `http://localhost:9000`. Billing still speaks plain HTTP, but now only over the loopback interface.
2. **The ambassador finds the service.** It resolves `tax-api.internal` through DNS or a service registry and keeps the list of instances current, so the API can move or scale without billing noticing.
3. **It secures the call.** It opens a TLS connection to an instance, presents the client certificate (mutual TLS), adds the access token the API expects and forwards the request.
4. **It bounds the call.** Each try gets a timeout, failed idempotent calls are retried after a jittered backoff, and a circuit breaker stops calling an API that keeps failing and answers at once with an error instead.
5. **It records the call.** Every request leaves metrics (latency, errors, timeouts, retries, the breaker's state) and a trace span.
6. **The response comes back the same way.** To billing, the tax API now looks like a service running on its own machine.

The client can't tell the ambassador from the remote service, and that is the point. The connectivity features live in a separate process with its own release cycle, often owned by a platform, network or security team rather than by the application's.

### Where the name comes from

Brendan Burns described three ways of combining containers on one machine in a 2015 Kubernetes blog post and again, with David Oppenheimer, in a 2016 HotCloud paper. An **ambassador** container proxies the main container's communication with the outside world. The blog's example is a Redis ambassador that sends writes to the primary and reads to the replicas. The paper's example is twemproxy in front of a sharded memcache: the application believes it talks to one memcache server on `localhost`, while the ambassador spreads the keys over many servers elsewhere in the cluster. The paper names three benefits: the developer programs against a single local server, the application can be tested against a real local server instead of the ambassador, and the same ambassador can be reused by applications written in other languages. It works because containers grouped together, like the containers of a pod, share one network namespace and so one `localhost`.

The Azure Architecture Center made it one of its cloud design patterns and widened it beyond containers: a helper service that sends network requests on behalf of a client and runs on the same host, useful above all for legacy applications and others that are hard to modify.

[Sidecar](../sidecar/) names the deployment mechanism, a helper process deployed and run next to the application. An ambassador is a sidecar with one particular job: the client's outbound connections.

Not to be confused with Emissary-ingress, which used to be called the *Ambassador API Gateway*. Despite the old name, that is an Envoy-based API gateway for traffic coming into a Kubernetes cluster: the inbound edge, not this pattern.

### What an ambassador does

| Job | What the ambassador does | See also |
|---|---|---|
| Discovery and routing | Resolves a logical name to the current instances, balances the load over them, routes by path or header, and follows the service when it moves | |
| Sharding a cache or database client | Hashes each key to the right shard, so the client sees one server; twemproxy does this for memcached and Redis | [Sharding](../sharding/) |
| TLS and mutual TLS | Originates TLS to the service, verifies the service's certificate and presents the client's own | [Mutual TLS (mTLS)](../mutual-tls/) |
| Credentials | Gets an access token (for example with the client credentials grant), caches it, renews it before it expires and adds it to every request | [OAuth 2.0 Client Credentials](../oauth2-client-credentials/) |
| Timeouts | Bounds each try and the call as a whole | [Timeout & Fallback](../timeout-and-fallback/) |
| Retries | Retries transient failures of idempotent calls with exponential backoff and jitter, within a retry budget | [Retry with Backoff & Jitter](../retry-with-backoff/) |
| Circuit breaking | Stops calling a failing service and fails fast until it recovers | [Circuit Breaker](../circuit-breaker/) |
| Telemetry | Emits metrics, access logs and a trace span for every call | [Distributed Tracing](../distributed-tracing/) |
| Protocol bridging | Lets the client keep a simple protocol (HTTP/1.1, plain TCP) while the ambassador speaks HTTP/2 or TLS to the service | |

### How it is deployed

- **As a sidecar container** in the client's pod or task. The containers of a pod share its network namespace, so `localhost` reaches the ambassador from the client and from nowhere else. In Kubernetes, declare it as a native sidecar container (an init container with `restartPolicy: Always`, stable since v1.33): it is started before the application's containers, and on shutdown the kubelet waits for the application to stop before stopping it. See [Sidecar](../sidecar/).
- **As a process on the same virtual machine**, a daemon or a Windows service, for clients that don't run in containers, which includes most vendor binaries.
- **One per client, or shared.** An ambassador per client keeps configuration, credentials, failures and upgrades separate. One shared by several processes on a host means fewer copies to run, but also one configuration and one identity for all of them, and one failure that cuts them all off. The Azure pattern describes both: a sidecar that follows the life cycle of its client, or a daemon shared by the processes on a host.

**What it costs to run.** Every call now crosses one more process. On the loopback interface there is no physical network in the way, but the request is still parsed, perhaps re-encrypted, and logged, so every call gets a little slower, and chatty paths feel it most. Every ambassador also needs CPU and memory of its own, multiplied by the number of clients, or hosts, that run one.

### Proxies that make good ambassadors

There is rarely a reason to write one from scratch. General-purpose proxies do the job when they are configured for one client's outbound traffic. These examples were checked against each project's documentation in October 2026:

- **Envoy** was designed as an out-of-process proxy that runs next to every application and works with any language. Its documentation describes this exact deployment: the application sends its service-to-service calls to an egress listener on `localhost` (`http://localhost:9001` in the docs), and each external service gets a local port of its own (`localhost:9250` for DynamoDB in their example). Envoy handles discovery (DNS names it keeps re-resolving, or endpoints from a control plane), load balancing, TLS origination with a client certificate, retries with fully jittered exponential backoff (a 25 ms base interval and a 250 ms cap by default), per-try timeouts, circuit breaking and outlier detection. Its circuit breaking caps connections, pending requests and retries per cluster, and outlier detection takes failing hosts out of the pool for a while; the breaker that opens and closes in the animation is the classic form of the pattern, which libraries implement. Its documented setup also lets the application speak HTTP/1.1 to its local Envoy while Envoys use HTTP/2 between them.
- **HAProxy** encrypts the connection to a server with `ssl` on the `server` line and presents a client certificate with `crt` when the server asks for one. `timeout connect` and `timeout server` bound the waiting, and `retries` retries failed connection attempts by default, with `retry-on` for other failures.
- **NGINX** presents a client certificate to the upstream with `proxy_ssl_certificate`, hands a failed request to the next server with `proxy_next_upstream`, and, in the open-source build since 1.27.3, keeps re-resolving an upstream server's name with the `resolve` parameter.
- **twemproxy** (nutcracker), the paper's example, is a lightweight proxy for the memcached and Redis protocols. It shards keys over a pool of servers and keeps persistent connections to them, which also cuts the number of connections each cache server has to hold.
- **A service mesh's proxy.** In a sidecar-mode mesh, the proxy next to each workload already plays ambassador for all of that workload's outbound calls. Istio, for example, can accept plain HTTP from the application and originate TLS to an external HTTPS service. See [Service Mesh](../service-mesh/).

## When to use it

- **The client can't be changed**: a vendor binary, an old application nobody maintains, or code whose release cycle is far slower than the network's needs. The ambassador adds what it lacks from the outside.
- **Clients in many languages need the same connectivity features.** One proxy behaves the same next to Java, Go, Python or COBOL, where a library would need one implementation per language.
- **A specialised team owns the connectivity concerns.** Security, network or platform engineers can change TLS settings, credentials and retry policies without waiting for application releases.
- **The connectivity needs don't fit the platform's tools**: a protocol or a legacy authentication scheme that the gateway or the mesh doesn't handle, or a dependency outside the mesh.
- **Legacy modernisation.** An ambassador keeps an old client working, and observable, while its replacement is built, often as part of a [Strangler Fig](../strangler-fig/) migration. When the new client goes live, the ambassador retires with the old one.

### When not to use it

- **Latency-critical paths**, where even a local hop on every call costs too much.
- **A single-language estate with a good library.** If every client is written in one language, a well-maintained client library is simpler than one more process per client.
- **Features that need deep integration with the client**: retries that depend on business rules, fallbacks that need application data, decisions that depend on the user. A proxy only sees requests and responses, not the client's intent.
- **When the platform already provides it.** If your services run in a service mesh that gives them mutual TLS, retries and telemetry, configure the mesh instead of building a custom ambassador.

### Ambassador, client library, service mesh or API gateway?

| | Client library | Ambassador | Service mesh | API gateway, gateway offloading |
|---|---|---|---|---|
| Where it runs | inside the client | next to one client | next to every service, plus a control plane | at the edge |
| Which traffic | outbound, one client | outbound, one client (or a few on one host) | inbound and outbound, every service | inbound, from many clients |
| Change to the client | code and a rebuild | one endpoint setting | usually none | none |
| Languages | one library per language | any | any | any |
| Main cost | every fix means rebuilding every client | a hop and a process per client | a proxy per workload in sidecar mode, and the control plane | a hop at the edge |

[API Gateway](../api-gateway/) and [Gateway Offloading](../gateway-offloading/) move the inbound concerns of many services to one shared edge that every client goes through. An ambassador moves the outbound concerns of one client into a process beside it. A [Service Mesh](../service-mesh/) is the generalisation: a proxy beside every service, configured from one control plane, for both directions.

## Trade-offs

- **One more hop on every call.** Small on loopback, but paid on every request; it adds up on chatty, latency-sensitive paths.
- **One more moving part per client.** Another process to deploy, configure, patch, secure and monitor, and it sits on the critical path: if it crashes or is misconfigured, the client loses all its outbound connectivity. Supervise it, check its health and alert on it as you would on the application.
- **Retries are only safe for idempotent calls.** HTTP defines `GET`, `HEAD`, `OPTIONS`, `TRACE`, `PUT` and `DELETE` as idempotent, and RFC 9110 advises clients not to repeat other requests automatically unless they know the request is idempotent anyway or that the first attempt never took effect. A proxy sees methods and paths, not side effects: it can't know what a `POST` does. NGINX, for one, by default won't hand a `POST`, `LOCK` or `PATCH` request that has already been sent to the next server. So decide per route what may be retried, and let the client pass context where it can. The Azure pattern suggests request headers that opt out of retries or cap them; Envoy reads hints such as `x-envoy-retry-on`, `x-envoy-max-retries` and `x-envoy-upstream-rq-timeout-ms` from the request; and an `Idempotency-Key` header (used by APIs such as Stripe's; the IETF draft that would have standardised it expired) lets the server recognise a repeated request. A legacy client sends no hints, so its ambassador retries only the routes known to be safe: the `GET /rates` lookup, never `POST /transactions`.
- **Timeouts have to line up with the client's.** The ambassador's whole budget, every try plus every backoff, must end before the client gives up. Otherwise the client times out, and perhaps retries on its own, while the ambassador is still retrying, and the load multiplies. Billing has no timeout of its own, so the ambassador's limits are the only ones it has.
- **The client still has to cope with the error.** An open breaker turns a hang into a fast `503`, but the client decides what happens next. For some calls the ambassador can serve a cached or default answer instead; for the rest, the client has to survive an error.
- **It sees calls, not context.** The ambassador can measure every call and emit a span, but it can't join that span to the client's own trace unless the client forwards the trace context it received; Envoy's documentation leaves that propagation to the services. A legacy client doesn't, so its traces start at the ambassador.
- **Plain text on localhost, secrets in the proxy.** The hop between client and ambassador is unencrypted, so bind the ambassador to the loopback address, never to every interface. In a pod, all containers share that loopback, so any of them can use the ambassador and the credentials it adds. The client certificate and tokens now live in the ambassador: protect, rotate and audit them there, which still beats having them scattered through application configuration.

## Implementation notes

- **Pointing the client at it.** Changing a configured endpoint is the easy case. If the address is compiled in, a hosts-file or DNS entry can point the name at the loopback address, or network rules can redirect the traffic. Service meshes capture a pod's traffic that way: Istio sets up the redirection with an init container or with a CNI node agent.
- **Configure per route, not per service.** Timeouts, retry policies and idempotency differ between `GET /rates` and `POST /transactions`, and so does the right answer when the breaker is open. Cap retries with a budget (retries as a share of the requests in flight) rather than a fixed count per request, so they can't multiply the load during an outage; Envoy's documentation recommends retry budgets for this reason.
- **Keep the slow work off the request path.** Resolve names in the background and cache the result, pool and reuse TLS connections, and renew certificates and tokens before they expire. The animation shows the discovery lookup and the handshake on the first call; later calls reuse both.
- **Start first, stop last.** The client can't call out before its ambassador listens, and calls in flight fail if it stops first. Use the platform's ordering (Kubernetes native sidecars, service dependencies on a VM) and a readiness check.
- **Version and upgrade it on its own.** The ambassador has its own image or package, configuration and release cycle, so a flaw in its TLS library can be patched without touching the client. Roll new versions out gradually, a few hosts first, keep the configuration in version control, and watch the ambassador's own metrics while you do.
- **Test against the real thing.** As the HotCloud paper points out, the client can be tested against a real local server instead of the ambassador: the contract between them is only the protocol on `localhost`.
- **Plan its retirement.** In a modernisation the ambassador buys time. When the client is replaced, build timeouts, retries and telemetry into the new client or hand them to the platform, and retire the ambassador together with the old client.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Sidecar](../sidecar/) — Run helper capabilities (proxy, logging, config) in a separate process next to the app.
- [Service Mesh](../service-mesh/) — Sidecar proxies plus a control plane: mTLS, retries and traffic shifting without touching app code.
- [Gateway Offloading](../gateway-offloading/) — Move TLS termination, authentication and compression out of every service into the gateway.
- [Retry with Backoff & Jitter](../retry-with-backoff/) — Retry transient failures with growing, randomised delays so clients don't stampede.
- [Circuit Breaker](../circuit-breaker/) — Stop calling a failing dependency, fail fast with a fallback, and probe until it recovers.
- [Mutual TLS (mTLS)](../mutual-tls/) — Client and server both present certificates, so every connection is authenticated both ways.
- [Timeout & Fallback](../timeout-and-fallback/) — Bound every remote call and degrade gracefully when the time runs out.
- [Distributed Tracing](../distributed-tracing/) — Propagate a trace context across services and assemble the spans into one timeline.

## References

- [Azure Architecture Center — Ambassador pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/ambassador)
- [Brendan Burns, David Oppenheimer — Design Patterns for Container-based Distributed Systems (HotCloud '16)](https://www.usenix.org/conference/hotcloud16/workshop-program/presentation/burns)
- [Brendan Burns — The Distributed System ToolKit: Patterns for Composite Containers (Kubernetes blog, 2015)](https://kubernetes.io/blog/2015/06/the-distributed-system-toolkit-patterns/)
- [Kubernetes — Sidecar Containers](https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/)
- [Envoy — What is Envoy](https://www.envoyproxy.io/docs/envoy/latest/intro/what_is_envoy)
- [Envoy — Service to service only (egress listeners on localhost)](https://www.envoyproxy.io/docs/envoy/latest/intro/deployment_types/service_to_service)
- [Envoy — Router filter (retries, back-off, per-try timeouts, request headers)](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/router_filter)
- [Envoy — TLS (origination to upstream clusters, client certificates)](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/security/ssl)
- [Envoy — Service discovery (strict DNS, EDS)](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/service_discovery)
- [Envoy — Circuit breaking](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/circuit_breaking)
- [Envoy — Outlier detection](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/outlier)
- [Envoy — Tracing (trace context propagation)](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/observability/tracing)
- [twemproxy (nutcracker) — a fast, light-weight proxy for memcached and Redis](https://github.com/twitter/twemproxy)
- [NGINX — Module ngx_http_proxy_module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [NGINX — Module ngx_http_upstream_module](https://nginx.org/en/docs/http/ngx_http_upstream_module.html)
- [HAProxy 3.4 — Configuration Manual](https://docs.haproxy.org/3.4/configuration.html)
- [Istio — Egress TLS Origination](https://istio.io/latest/docs/tasks/traffic-management/egress/egress-tls-origination/)
- [Istio — Install the Istio CNI node agent (sidecar traffic redirection)](https://istio.io/latest/docs/setup/additional-setup/cni/)
- [RFC 9110 — HTTP Semantics, section 9.2.2: Idempotent Methods](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2)
- [IETF — The Idempotency-Key HTTP Header Field (expired Internet-Draft)](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
- [Stripe API reference — Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [Emissary-ingress (formerly Ambassador API Gateway) — GitHub](https://github.com/emissary-ingress/emissary)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
