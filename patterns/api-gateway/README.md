<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🚪 API & Edge](../../README.md#api--edge)

# API Gateway

> One entry point that authenticates, rate-limits and routes calls to backend services.

<p align="center"><img src="diagram.svg" alt="Animated diagram: API Gateway" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/api-gateway.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One front door** | Web, mobile and partner clients all call **one public endpoint**. Every request runs through the same policy pipeline (authenticate, rate limit, route) and is forwarded by path to the service that owns it: `/orders` to Orders, `/users` to Users, `/catalog` to Catalog. Responses come back the same way, and the services stay on a private network, so clients never learn where they live or how they are split. |
| **2 · Authenticate at the edge** | The gateway checks credentials before rate limiting or routing. A request with a missing or invalid token is rejected with **401 Unauthorized** and never reaches a backend. For a valid token the gateway verifies the signature and claims once, then forwards the caller's identity (here as an `X-User-Id` header) so services don't each re-implement token validation. |
| **3 · Rate limit per client** | Each client (API key or client ID) has its own **token bucket**: every call spends a token and tokens refill at a steady rate (4 max, 1 per second here). The partner's burst drains its bucket, so the extra calls get **429 Too Many Requests**, ideally with a `Retry-After` header, while Web's calls pass untouched. The bucket then refills and the partner can call again. |
| **4 · Serve from cache** | The first `GET /catalog` is a cache **miss**: it goes to Catalog, and the gateway keeps the response for its time-to-live. The repeat is a **hit**, answered by the gateway in a fraction of the time without touching the service. Caching is one of several cross-cutting concerns a gateway offloads from services, alongside TLS termination, request and response transformation, logging and metrics. |
<!-- END GENERATED: header -->

## The problem

Once a system is split into services, letting every client call every service directly pushes the internals outward. Each web, mobile and partner client has to track a list of endpoints, and every refactoring (splitting Orders, moving Catalog) becomes a breaking change in someone else's app. A single screen may need several round trips. Every public service must also re-implement the same edge concerns (TLS certificates, token validation, per-client quotas, access logs), and each one is an internet-facing attack surface to harden on its own.

## How it works

An API gateway is a layer-7 reverse proxy that becomes the only public entry point. Every request passes the same pipeline of policies, in order:

1. **Terminate TLS.** The public certificate lives at the gateway, which opens a new, ideally mutual, TLS connection to the backend.
2. **Authenticate.** Validate the bearer token (signature against the identity provider's published keys, expiry, issuer, audience) or the API key. Missing or invalid credentials get `401` before any backend is touched; the verified identity is passed downstream.
3. **Rate limit.** Look up the caller's token bucket: each call spends a token and tokens refill at a fixed rate, so a burst up to the bucket size is allowed but a sustained flood is not. The excess gets `429 Too Many Requests`.
4. **Route.** Match the path, host or a header to a backend and balance across its instances, or answer a cacheable request from the gateway's cache.
5. **On the way back,** transform the response if needed, then log, meter and trace the call.

Authenticating first lets quotas and cache keys depend on a *verified* identity; a coarse per-IP limit or a web application firewall in front can still absorb anonymous floods. Other common offloads are CORS, compression and IP allow lists. Answer CORS preflight (`OPTIONS`) requests before the authentication step: browsers never send credentials on a preflight, and a `401` there blocks the real call.

**Variants and neighbours:**

- **Backends for Frontends (BFF).** Instead of one general-purpose gateway, run one per client type (web, mobile, partners), each exposing exactly the API its client needs and owned by the team that builds that client. A shared edge gateway can still handle TLS, authentication and quotas in front of them.
- **Gateway aggregation.** The gateway (or a BFF) fans one request out to several services and merges the answers, so a chatty client makes one round trip instead of several.
- **Gateway vs service mesh.** A gateway governs **north-south** traffic, from clients into the system: public TLS, API keys, quotas, versioning. A service mesh governs **east-west** traffic between services: mutual TLS, retries, timeouts and traffic shifting through sidecar or node-level proxies. They complement each other, and many meshes ship an ingress gateway that can serve as a simple edge.

## When to use it

- Several services are exposed to external clients and you want one stable endpoint, so the backend can be split, merged or migrated behind it without breaking anyone (the facade in a [Strangler Fig](../strangler-fig/) migration is often a gateway).
- Different kinds of clients need different credentials, quotas or payloads.
- Edge security and traffic policy should be applied consistently, in one place, by a team that owns them.
- You publish APIs to partners or customers and need API keys, usage plans and per-consumer analytics.
- Not for a single service or a small app, where a load balancer or ingress with TLS is enough, and usually not in the path of service-to-service calls, which a service mesh or client libraries handle better.

## Trade-offs

- **Single point of failure.** Every call goes through it, so its availability caps the whole system's. Run several stateless instances across zones behind a load balancer, drain connections on deploys, and roll out configuration changes as carefully as code.
- **Bottleneck and an extra hop.** Each request pays for another network hop plus every policy it runs. Scale it horizontally, keep policies cheap, and load-test it with production-like bursts.
- **Business logic creep.** Orchestration, data mapping and feature rules are tempting to add, but they turn the gateway into a shared monolith that every team must change and redeploy. Keep it to cross-cutting concerns; client-specific shaping belongs in a BFF or a service.
- **A high-value target.** It holds the public certificates and enforces authentication for everyone. Harden it, lock down its admin API, and make services unreachable except through it (private networking, mutual TLS or both), or its policies can simply be bypassed.
- **Forwarded identity must be trustworthy.** Services may trust an identity header only because the gateway set it, so strip any client-supplied copy at the edge. Zero-trust designs forward the original token, or exchange it for a narrower one, and let each service validate it again.
- **Cache with care.** Cache only safe, public responses, keyed on everything that changes them (path, query, relevant headers). Never serve one user's response to another from a shared cache, and keep TTLs short or invalidate on change.

## Implementation notes

- **Products:** managed services such as Amazon API Gateway, Azure API Management and Apigee, or self-hosted gateways such as Kong, Tyk, KrakenD, NGINX, Traefik and Envoy-based gateways. On Kubernetes, the Gateway API (`Gateway`, `HTTPRoute`) is the standard way to declare routes.
- **Tokens:** for JWTs, cache the identity provider's signing keys (JWKS) and check signature, algorithm, `iss`, `aud` and `exp` locally, with no call to the IdP per request; opaque tokens need an introspection call (RFC 7662), so cache its result briefly. Answer a missing or bad token with `401` plus a `WWW-Authenticate` header, and a valid token that lacks the required scope with `403`.
- **Rate limits:** key them on the authenticated client rather than only the IP address, since NAT and mobile networks share addresses, and send `Retry-After` with each `429`. With several gateway instances, share the counters (for example in Redis, or through a global rate-limit service) or split each quota across instances and accept some drift.
- **Observability:** the gateway sees every call, so have it start or propagate the trace context (W3C `traceparent`) and emit per-route, per-client rate, error and latency metrics.
- **Configuration as code:** keep routes and policies in version control and let service teams own their routes through review, not through tickets to a central team.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Backends for Frontends (BFF)](../backends-for-frontends/) — A dedicated backend per client type, shaped for exactly what that UI needs.
- Gateway Aggregation *(planned)* — Fan one client request out to several services and merge the answers into one response.
- Gateway Offloading *(planned)* — Move TLS termination, authentication and compression out of every service into the gateway.
- [Rate Limiting & Throttling](../rate-limiting/) — Cap how fast each client may call (token bucket) and shed the excess with 429s.
- [JWT Validation](../jwt-validation/) — APIs verify token signatures and claims locally, using the issuer's cached public keys (JWKS).
- Service Mesh *(planned)* — Sidecar proxies plus a control plane: mTLS, retries and traffic shifting without touching app code.
- [Strangler Fig](../strangler-fig/) — Put a facade in front of the legacy system and move routes to new services one at a time.
- [Microservices](../microservices/) — Small, independently deployable services, each owning one business capability and its data.

## References

- [Azure Architecture Center — API gateways (microservices design)](https://learn.microsoft.com/en-us/azure/architecture/microservices/design/gateway)
- [Chris Richardson (microservices.io) — Pattern: API Gateway / Backends for Frontends](https://microservices.io/patterns/apigateway.html)
- [Azure Architecture Center — Gateway Routing pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/gateway-routing)
- [Azure Architecture Center — Gateway Offloading pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/gateway-offloading)
- [Sam Newman — Pattern: Backends For Frontends](https://samnewman.io/patterns/architectural/bff/)
- [Amazon API Gateway Developer Guide — Throttle requests to your REST APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-request-throttling.html)
- [RFC 6585 — Additional HTTP Status Codes (429 Too Many Requests)](https://www.rfc-editor.org/rfc/rfc6585)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
