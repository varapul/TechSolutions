<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🚪 API & Edge](../../README.md#api--edge)

# Gateway Offloading

> Move TLS termination, authentication and compression out of every service into the gateway.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Gateway Offloading" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/gateway-offloading.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Plumbing in every service** | Without a gateway every service is its own edge. Orders (Java), Catalog (Go) and Search (Python) each carry a TLS certificate and its configuration, token validation, response compression and access logging: the same four jobs, built three times with three libraries and three configurations. The certificates expire in three days and each team has to renew its own. Two have, one has not. |
| **2 · Move it to the gateway** | The shared work moves out of the services into a gateway in front of them: the chips slide across, and each set of three becomes one. The services keep only their business logic. There is now one certificate to renew, one authentication configuration, one compression setting and one log format, and one place to patch when a vulnerability is found. |
| **3 · One request at the edge** | A client connects over HTTPS and the gateway does the edge work once. It terminates TLS, validates the token and answers a bad one with **401 Unauthorized** before any service sees the request. A good request goes on to Orders with the verified identity attached (here an `X-User-Id` header) on a connection of the gateway's own, which is still plain HTTP at this point. The gateway writes one access-log line per request and compresses the response on its way back to the client. |
| **4 · Know the limits** | Three things do not move. **Business rules and fine-grained authorisation** stay in the service: the gateway knows *who* is calling, but only Orders can decide whether this caller may cancel this order. **The hop behind the gateway needs its own protection**: the services accept connections only from the gateway, so a call that goes around it is refused, and the gateway opens a new TLS (or mutual TLS) connection to each service instead of forwarding plain HTTP. And because every request now passes through it, **the gateway runs as several redundant instances** (three here). |
<!-- END GENERATED: header -->

## The problem

Split a system into services, expose each one to its clients, and every service becomes its own edge. Before it runs a line of business logic it has to do the same jobs as its neighbours:

- hold a **TLS certificate** and its private key, choose protocol versions and cipher suites, and renew the certificate before it expires;
- **validate the caller's token**: fetch the issuer's keys, then check the signature, the issuer, the audience and the expiry;
- **compress** responses, answer CORS preflights, limit request rates;
- write an **access log** and count requests, errors and latency.

None of this differs from one service to the next, yet each team builds it again with whatever its language offers. Three languages mean three TLS stacks, three token libraries and three sets of configuration that are supposed to behave the same and never quite do: one service still accepts an old protocol version, another forgets to check the token's audience, the third logs in a format nobody else can parse.

The copies also have to be *kept* the same, and that is where it hurts:

- **Certificates expire.** Every copy of a certificate is a renewal someone can miss, and an expired certificate is an outage, because clients refuse the connection. The pressure is growing. Under the CA/Browser Forum's Baseline Requirements a publicly trusted TLS certificate issued since 15 March 2026 may be valid for at most 200 days; the limit drops to 100 days on 15 March 2027 and to 47 days on 15 March 2029. Renewal by hand, service by service, does not survive that schedule.
- **Vulnerabilities need patching everywhere.** A flaw in a TLS or token library has to be fixed in every service that embeds it, each on its own release cycle, and nobody can say which services are done.
- **The skills are specialised.** Cipher suites, key rotation and token validation are easy to get subtly wrong, and every product team has to get them right on its own.

## How it works

**Gateway offloading** moves the work that is the same for every service out of the services and into the gateway that stands between them and their clients: a reverse proxy, a load balancer or an API gateway. The gateway does the work once, for everyone. The services keep what only they can do.

The animation shows the move. In step 1 Orders (Java), Catalog (Go) and Search (Python) each carry the same four chips. In step 2 the chips slide into the gateway and each set of three becomes one: one certificate to renew, one authentication configuration, one compression setting, one log format, and one place to patch. Step 3 follows a request through the result and step 4 marks what the gateway cannot take over. The names, sizes and header in the animation are examples.

What the move buys:

- **Consistency.** One TLS policy, one set of token rules and one log format apply to every service, whether or not its team got round to it.
- **One place to patch.** A fix to the TLS stack or to token validation is one rollout, not one per service.
- **Simpler services.** They carry business logic, not certificates and key sets, and a new service has the whole edge on its first day.
- **A specialised team.** The people who understand cipher suites and token validation own them, and the product teams no longer have to.

### What moves and what stays

| Commonly offloaded | What the gateway does |
|---|---|
| **TLS termination and the certificate lifecycle** | holds the public certificate and key, negotiates protocol versions and ciphers, renews and rotates in one place |
| **Authentication** | validates bearer tokens (signature, issuer, audience, expiry), runs the login redirect for browser applications ([OpenID Connect](../openid-connect/)) or verifies client certificates, and answers everything else with `401` |
| **Coarse authorisation** | decisions that need only the request and the token: this route requires this scope or role, this API key may call this product |
| **Rate limiting and quotas** | counts per client and answers the excess with `429` ([Rate Limiting & Throttling](../rate-limiting/)) |
| **IP filtering and a web application firewall** | allow and deny lists, managed rule sets against common attacks |
| **Compression** | negotiates `Accept-Encoding` and compresses responses with gzip, Brotli or Zstandard |
| **Caching** | answers repeatable `GET`s without calling the service ([API Gateway](../api-gateway/) shows this, [CDN & Edge Caching](../cdn-edge-caching/) takes it further out) |
| **Logging, metrics and trace headers** | one access log format, request, error and latency metrics per route, a request ID and trace context on every call |
| **CORS** | answers preflight requests and adds the response headers |
| **Protocol translation** | HTTP/2 or HTTP/3 towards clients and whatever the service speaks behind, JSON over HTTP to gRPC |

| Not offloaded | Why it stays in the service |
|---|---|
| **Business logic** | it is what the service is for; in the gateway it ties every release of the service to a release of the gateway |
| **Domain-specific transformation** | mapping, enriching or validating a payload needs the service's data model |
| **Fine-grained authorisation** | "may this caller cancel *this* order?" depends on who owns the order, and only the service's data can answer that |

The test is whether the work needs to know anything about the domain. Terminating TLS, checking a signature and compressing bytes are identical for Orders and Search, so they can move. Deciding who may cancel an order is not, so it cannot. OWASP's API Security Top 10 puts the missing object-level check first (API1:2023, broken object level authorization) and asks for the check in every function that reaches a record through an ID supplied by the client. A gateway in front of the service cannot see that.

### One request at the edge

1. **Terminate TLS.** The client's TLS connection ends at the gateway, which holds the certificate for the public name. From here on the gateway can read the request.
2. **Authenticate.** The gateway validates the token. A missing, expired or forged one is answered with `401 Unauthorized` and a `WWW-Authenticate` header, and no service is called. A valid token that lacks a required scope gets `403`.
3. **Forward with the identity attached.** The gateway opens (or reuses) its own connection to the service and passes on who the caller is, in the animation as an `X-User-Id` header.
4. **Log.** One line per request in one format, whichever service handled it, including the requests that never reached a service.
5. **Compress the response.** If the client's `Accept-Encoding` allows it, the gateway compresses the body, sets `Content-Encoding` and adds `Vary: Accept-Encoding`.

In step 3 of the animation the connection behind the gateway is still plain HTTP (the dot without a ring). Step 4 is about why that is not where to stop.

### The hop behind the gateway

Offloading moves the checks into the gateway, so everything now depends on requests actually passing through it, and on what happens on the connection behind it.

**TLS at the gateway, three ways:**

| | Terminate | Terminate and re-encrypt | Passthrough |
|---|---|---|---|
| The client's TLS session ends at | the gateway | the gateway | the service |
| Gateway to service | plain HTTP | a new TLS connection | the client's own TLS session |
| The gateway can read the request | yes | yes | no: only the server name (SNI) and the addresses |
| Certificates to manage | the public one | the public one, plus an internal one per service | a public one per service |
| What can be offloaded | everything | everything | connection limits, IP filtering, routing by server name |

Terminating and forwarding plain HTTP is the classic *TLS offloading*, and it is still common inside a network that is trusted as a whole. Current guidance does not make that assumption: the Azure Architecture Center's description of this pattern now says to re-establish TLS to the backend after terminating it and not to forward over unencrypted HTTP. That gives each service a certificate again, which sounds like the problem coming back, but it is a different certificate: internal, issued by a private CA or the platform, short-lived and renewed by automation, often by a sidecar or a mesh rather than by application code. The public certificate, the one that clients see and that takes an outage with it when it lapses, stays in one place. Re-encryption only helps if the gateway *verifies* the service's certificate; encrypting to whoever answers is not enough.

**Close the side door.** A client that can reach a service directly skips authentication, rate limiting, the firewall rules and the access log all at once. Put the services on a private network, allow inbound connections only from the gateway (security groups, firewall rules, network policies), and where the network alone is not enough let each service require the gateway's client certificate ([Mutual TLS](../mutual-tls/)).

**Pass the identity in a form the service can trust.** The options, roughly from weakest to strongest:

- **A plain header** such as `X-User-Id`. Simple, and safe only if nothing but the gateway can reach the service *and* the gateway removes any copy of that header arriving from outside. Otherwise anyone can claim to be anyone.
- **A token signed by the gateway.** An AWS Application Load Balancer puts the user's claims into `x-amzn-oidc-data`, a JWT it signs with ES256, and Google's Identity-Aware Proxy sends `x-goog-iap-jwt-assertion`. Both tell the application to verify the signature, because a signed header survives a misconfigured firewall and an unsigned one does not.
- **The caller's own access token,** forwarded so that the service validates it itself ([JWT Validation](../jwt-validation/)). The service then has to be an audience of that token.
- **A new token for the downstream service,** obtained by [Token Exchange](../token-exchange/), when the original should not travel further.

**Pass the connection facts too.** After termination the service sees the gateway's address and the gateway's connection, not the client's. The gateway forwards what it knows: the client address, scheme and host in `Forwarded` (RFC 7239) or the older `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host`, and a client certificate in `Client-Cert` (RFC 9440). The same rule applies as for identity. The service may believe these headers only when they come from its gateway, and the gateway has to overwrite or remove whatever the client sent under the same names; RFC 9440 makes that a requirement for `Client-Cert`.

### When the service should check again

A service that trusts the gateway completely has one layer of defence. Repeat the token validation in the service ([JWT Validation](../jwt-validation/)) when:

- other things inside the network can reach it: other services, batch jobs, a compromised neighbour;
- the design is zero trust, so no caller is trusted for where it sits in the network;
- the service needs the claims anyway for its own authorisation decisions.

The second check is cheap: signature, issuer, audience and expiry against cached keys. Check what the gateway really validates, too, because it confirms only what it is configured to confirm. JWT verification on an Application Load Balancer, for example, requires the `iss` and `exp` claims, checks `nbf` and `iat` when they are present, and validates any other claim only if it is configured as an additional claim. The audience is not among the defaults.

### End-to-end encryption and TLS passthrough

Some requirements do not allow any intermediary to see the plaintext. Re-encryption does not meet them, because the gateway still decrypts every request. (Vendors call the terminate-and-re-encrypt mode "end-to-end TLS" all the same; Azure Application Gateway's documentation does.) Only **passthrough** keeps the gateway out: it forwards the encrypted bytes and routes by the server name in the TLS handshake.

The price is the pattern itself. A gateway that cannot read the request cannot authenticate it, compress it, cache it, inspect it or log its path, so the service is back to doing all of that, and the client's address has to travel outside HTTP, in the PROXY protocol for example, because no header can be added. A common compromise is passthrough for the few routes that need it and termination for the rest.

### Observability at the edge

The gateway sees every request from outside, so it gives every service the same baseline without any code in the service: an access log in one format, request rate, error rate and latency per route and per client, and a request ID. It is also the place to start a trace: generate the request ID, and create or forward the W3C `traceparent` header so that the spans of the services join one trace ([Distributed Tracing](../distributed-tracing/)).

Two limits. The gateway's view stops at its own connections: it knows that Orders took 300 ms, not why. And calls between services never pass the edge, so the edge log is not the whole story.

### Edge offloading and per-instance offloading

A gateway is not the only way to get plumbing out of application code. What differs is where the shared implementation runs:

| | Gateway (this pattern) | [Sidecar](../sidecar/) | [Service Mesh](../service-mesh/) |
|---|---|---|---|
| Runs | once, at the edge | next to every instance | a proxy per instance or per node, plus a control plane |
| Traffic | from clients into the system (north-south) | whatever one instance sends and receives | between services (east-west) |
| Typical work | public certificates, user authentication, firewall rules, quotas, compression | a helper for one application: proxy, log shipper, config agent | mutual TLS between services, retries, timeouts, traffic shifting |
| Cost grows with | the traffic at the edge | the number of instances | the number of instances or nodes |

They combine rather than compete. A gateway handles what belongs to the public edge, a mesh secures and observes the calls behind it (and the hop from the gateway to the first service, once the gateway is part of the mesh), and a mesh's own ingress gateway can be the edge when its features are enough.

### With routing and aggregation

Offloading is one of three jobs a gateway can do. The others are routing (one front door that sends each path to its service, see [API Gateway](../api-gateway/)) and gateway aggregation (one client request fanned out to several services and merged). One product often does all three, but they differ in how much the gateway has to know. Offloading needs to know nothing about the API. Routing needs the list of services. Aggregation needs to know what the responses mean, which is why it is the first to drift into business logic and often lives in a [Backend for Frontend](../backends-for-frontends/) owned by the client's team.

A layered edge is normal: a load balancer or CDN that terminates TLS and filters traffic, an API gateway behind it that authenticates and applies quotas, and BFFs behind that.

## When to use it

- Several services are exposed to clients and repeat the same edge work: certificates, token validation, compression, logging.
- One team with the right expertise should own public TLS, authentication policy and the security of the network boundary.
- You need a baseline (TLS versions, token rules, log format) that does not depend on every team's diligence or on every service being instrumented.
- The services are written in several languages, so a shared library would have to exist several times.
- A platform feature can replace your own code outright: managed certificates, managed authentication, a managed firewall.

### When not to use it

- **One service, one team, one language.** A library and the platform's load balancer are less to operate than a gateway tier.
- **Requirements that forbid an intermediary from reading the traffic.** Use passthrough on those routes and accept that nothing is offloaded on them.
- **A concern that is not really shared.** Service-specific rules in the gateway couple the two, and every change to the service then needs a change to the gateway.
- **Calls between services.** They do not pass the edge, and sending them out through the gateway and back adds a hop and a dependency. That is the job of a mesh or a library.
- **A latency budget the extra hop breaks,** when the offloaded work is trivial.
- **A gateway team slower than the service teams.** If a certificate or a policy change waits in someone's queue, centralising it has made things worse.

## Trade-offs

- **A single point of failure.** Every request passes through the gateway, so its availability caps everyone's. Run several instances across zones behind a load balancer, with health checks, and drain connections before an instance is removed ([Load Balancing](../load-balancing/), [Health Endpoint Monitoring](../health-endpoint-monitoring/)).
- **A bottleneck.** TLS handshakes, token checks and compression are CPU work that used to be spread over all the services. Size the gateway for peak traffic, not for the average, and scale it out ([Autoscaling](../autoscaling/)).
- **One change reaches everything.** A wrong cipher list, a lapsed certificate or a bad rule now breaks every service at once. Keep the configuration in version control, review it, and roll it out in stages ([Canary Release](../canary-release/)).
- **A gateway that collects logic becomes a monolith in front of the services.** Every "small" rule added for one service makes the gateway something all teams have to change together, which is the enterprise service bus again. James Lewis and Martin Fowler's advice for microservices was "smart endpoints and dumb pipes"; an offloading gateway should stay a pipe.
- **A high-value target.** It holds the private keys of the public certificates and makes the authentication decision for everyone. Harden it, restrict its admin interface and patch it first.
- **One more hop.** Each request crosses one more proxy. Keep-alive connections to the services and TLS session reuse recover part of the cost.
- **False confidence.** "The gateway authenticates" tempts services to check nothing. Without the protections of the hop behind it, the gateway's guarantees end at its own back door.
- **Compression has side effects.** It costs CPU, and a compressed response that contains both a secret and input an attacker can influence is open to the BREACH attack (2013), whatever the TLS version. Compress static and public content freely, and think before compressing pages that reflect input next to a session secret.

## Implementation notes

- **Automate certificates.** Issue and renew with ACME (RFC 8555) or the platform's managed certificates, and alert on days to expiry anyway. Let's Encrypt's default certificates last 90 days today, 64 days from 10 February 2027 and 45 days from 16 February 2028, so a renewal job on a fixed 60-day interval will no longer do.
- **Verify the backend when you re-encrypt.** In NGINX, `proxy_pass https://…` encrypts the hop, but `proxy_ssl_verify` and `proxy_ssl_server_name` are both off by default. Turn them on and set `proxy_ssl_trusted_certificate`, or the gateway accepts any certificate.
- **Answer bad tokens properly.** `401` with `WWW-Authenticate: Bearer` for a missing or invalid token, `403` for a valid one that lacks the scope (RFC 6750). Answer CORS preflights before authentication: browsers send them without credentials.
- **Sanitise at the edge.** Remove or overwrite identity and forwarding headers that arrive from outside before adding your own. Envoy stops taking such headers from outside once `use_remote_address` is set, and its guide for edge deployments adds more: reject header names with underscores, normalise paths, limit streams and buffers, enable the overload manager.
- **Compress selectively.** Text-like content types above a minimum size, never what is already compressed, and always with `Vary: Accept-Encoding`. NGINX's defaults are narrower than most people expect: `gzip` is off, only `text/html` is compressed until `gzip_types` says otherwise, `gzip_vary` is off, and requests that arrive through another proxy (they carry a `Via` header) get no compression (`gzip_proxied off`).
- **Give every request an ID** at the edge, log it, and forward it, so that a line in the gateway's log can be matched to a line in a service's log.
- **Keep the gateway stateless** so that instances are interchangeable, and keep its configuration declarative so that service teams can change their own routes through review rather than through a ticket.

**Examples, verified in October 2026:**

- **A cloud load balancer that authenticates users.** An AWS Application Load Balancer terminates TLS on an HTTPS listener with a certificate from AWS Certificate Manager, which renews the DNS-validated certificates it issued (not imported ones) while they are in use. A listener rule with an `authenticate-oidc` or `authenticate-cognito` action runs the login and forwards the claims in `x-amzn-oidc-data`; the application has to verify the signature and that the `signer` field names its load balancer, since the two older headers (`x-amzn-oidc-identity`, `x-amzn-oidc-accesstoken`) are unsigned. A `jwt-validation` action verifies bearer tokens from machine clients (RS256 only). The documentation recommends that the targets' security group admits only the load balancer's. For passthrough AWS points to a Network Load Balancer with a TCP listener. Google Cloud's Identity-Aware Proxy plays the same role on Google Cloud: it strips `x-goog-*` headers sent by clients and adds its signed `x-goog-iap-jwt-assertion`.
- **A managed API gateway.** A JWT authorizer on an Amazon API Gateway HTTP API checks the signature against the issuer's `jwks_uri` (RSA algorithms only, keys cached for up to two hours), then `iss`, `aud` or `client_id`, `exp`, `nbf`, `iat` and the route's scopes, and hands the claims to the integration. Azure API Management's `validate-jwt` policy does the same from an OpenID configuration URL, answers `401` by default and refreshes the keys hourly.
- **NGINX** (1.30 stable, 1.31 mainline). TLS termination with `ssl_certificate`, only TLS 1.2 and 1.3 by default since 1.27.3. For authentication the open-source server delegates the decision to a subrequest with `auth_request` (a module outside the default build: `2xx` allows, `401` and `403` deny); validating JWTs natively (`auth_jwt`) is part of the commercial NGINX Plus. `ngx_http_acme_module`, a separately packaged module, issues and renews certificates over ACME.
- **Envoy** (1.39). TLS termination on listeners and TLS origination to upstream clusters. The `jwt_authn` filter verifies signature, issuer, audiences and time limits, removes the token unless `forward` is set and can pass the payload upstream in a header of your choice. `ext_authz` asks an external service and answers `403` on refusal. The compressor filter supports gzip, Brotli and Zstandard. `x-forwarded-client-cert` is not passed on unless you configure it.
- **The Kubernetes Gateway API** (v1.6). A listener terminates TLS (`tls.mode: Terminate`, the default for HTTPS) with `certificateRefs` to a Secret; `BackendTLSPolicy` (standard channel since v1.4) re-encrypts to a Service and verifies its certificate; `TLSRoute` with `Passthrough` (standard since v1.5) leaves the session alone; client certificates can be validated on the Gateway (standard since v1.5). HTTP authentication is still an experimental filter (GEP-1494), so implementations offer it through their own policy resources. If you offload at an Ingress today, note that the community ingress-nginx controller was retired in March 2026: its repository is archived and it gets no further releases or security fixes.
- **Automated certificate issuance.** cert-manager issues and renews the certificates of a `Gateway` from annotations on the resource. Azure's own example of this pattern is Application Gateway with a listener certificate from Key Vault and HTTPS backend settings, which is the terminate-and-re-encrypt mode above.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- [Gateway Aggregation](../gateway-aggregation/) — Fan one client request out to several services and merge the answers into one response.
- [Backends for Frontends (BFF)](../backends-for-frontends/) — A dedicated backend per client type, shaped for exactly what that UI needs.
- [Service Mesh](../service-mesh/) — Sidecar proxies plus a control plane: mTLS, retries and traffic shifting without touching app code.
- [Sidecar](../sidecar/) — Run helper capabilities (proxy, logging, config) in a separate process next to the app.
- [Mutual TLS (mTLS)](../mutual-tls/) — Client and server both present certificates, so every connection is authenticated both ways.
- [JWT Validation](../jwt-validation/) — APIs verify token signatures and claims locally, using the issuer's cached public keys (JWKS).
- [Rate Limiting & Throttling](../rate-limiting/) — Cap how fast each client may call (token bucket) and shed the excess with 429s.

## Related components and services

- [NGINX](../nginx/) — A reverse proxy and web server: TLS termination, load balancing, caching and rate limiting in front of applications.

## References

- [Azure Architecture Center — Gateway Offloading pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/gateway-offloading)
- [Azure Architecture Center — API gateways (microservices design)](https://learn.microsoft.com/en-us/azure/architecture/microservices/design/gateway)
- [Chris Richardson (microservices.io) — Pattern: API Gateway / Backends for Frontends](https://microservices.io/patterns/apigateway.html)
- [James Lewis, Martin Fowler — Microservices (smart endpoints and dumb pipes)](https://martinfowler.com/articles/microservices.html)
- [OWASP API Security Top 10 — API1:2023 Broken Object Level Authorization](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/)
- [CA/Browser Forum — Latest Baseline Requirements (section 6.3.2, maximum validity periods)](https://cabforum.org/working-groups/server/baseline-requirements/requirements/)
- [CA/Browser Forum — Ballot SC081v3: Introduce Schedule of Reducing Validity and Data Reuse Periods](https://cabforum.org/2025/04/11/ballot-sc081v3-introduce-schedule-of-reducing-validity-and-data-reuse-periods/)
- [Let's Encrypt — Decreasing Certificate Lifetimes to 45 Days](https://letsencrypt.org/2025/12/02/from-90-to-45)
- [RFC 8555 — Automatic Certificate Management Environment (ACME)](https://www.rfc-editor.org/rfc/rfc8555)
- [RFC 7239 — Forwarded HTTP Extension](https://www.rfc-editor.org/rfc/rfc7239)
- [RFC 9440 — Client-Cert HTTP Header Field](https://www.rfc-editor.org/rfc/rfc9440)
- [RFC 9110 — HTTP Semantics (content codings, Vary, 401 and WWW-Authenticate)](https://www.rfc-editor.org/rfc/rfc9110)
- [RFC 6750 — The OAuth 2.0 Authorization Framework: Bearer Token Usage](https://www.rfc-editor.org/rfc/rfc6750)
- [RFC 7457 — Summarizing Known Attacks on TLS and DTLS (§2.6 Compression Attacks: CRIME, TIME, and BREACH)](https://www.rfc-editor.org/rfc/rfc7457#section-2.6)
- [HAProxy — The PROXY protocol](https://www.haproxy.org/download/1.8/doc/proxy-protocol.txt)
- [Elastic Load Balancing — Create an HTTPS listener for your Application Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/create-https-listener.html)
- [Elastic Load Balancing — Authenticate users using an Application Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/listener-authenticate-users.html)
- [Elastic Load Balancing — Verify JWTs using an Application Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/listener-verify-jwt.html)
- [AWS Certificate Manager — Managed certificate renewal](https://docs.aws.amazon.com/acm/latest/userguide/managed-renewal.html)
- [Amazon API Gateway — Control access to HTTP APIs with JWT authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)
- [Google Cloud Identity-Aware Proxy — Securing your app with signed headers](https://docs.cloud.google.com/iap/docs/signed-headers-howto)
- [Azure API Management — validate-jwt policy](https://learn.microsoft.com/en-us/azure/api-management/validate-jwt-policy)
- [Azure Application Gateway — TLS termination and end to end TLS](https://learn.microsoft.com/en-us/azure/application-gateway/ssl-overview)
- [NGINX — NGINX SSL Termination](https://docs.nginx.com/nginx/admin-guide/security-controls/terminating-ssl-http/)
- [NGINX — Securing HTTP Traffic to Upstream Servers](https://docs.nginx.com/nginx/admin-guide/security-controls/securing-http-traffic-upstream/)
- [nginx.org — Module ngx_http_proxy_module (proxy_ssl_verify, proxy_ssl_server_name)](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [nginx.org — Module ngx_http_gzip_module](https://nginx.org/en/docs/http/ngx_http_gzip_module.html)
- [nginx.org — Module ngx_http_auth_request_module](https://nginx.org/en/docs/http/ngx_http_auth_request_module.html)
- [nginx.org — Module ngx_http_auth_jwt_module](https://nginx.org/en/docs/http/ngx_http_auth_jwt_module.html)
- [nginx.org — Module ngx_http_acme_module](https://nginx.org/en/docs/http/ngx_http_acme_module.html)
- [Envoy — TLS (architecture overview)](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/security/ssl)
- [Envoy — JWT Authentication filter](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/jwt_authn_filter)
- [Envoy — External Authorization filter](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/ext_authz_filter)
- [Envoy — Compressor filter](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/compressor_filter)
- [Envoy — Configuring Envoy as an edge proxy](https://www.envoyproxy.io/docs/envoy/latest/configuration/best_practices/edge)
- [Envoy — HTTP header manipulation (x-forwarded-for, x-forwarded-client-cert)](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_conn_man/headers)
- [Kubernetes Gateway API — TLS Configuration](https://gateway-api.sigs.k8s.io/guides/user-guides/tls/)
- [Kubernetes Gateway API — GEP-1494: HTTP Auth in Gateway API](https://gateway-api.sigs.k8s.io/geps/gep-1494/)
- [Kubernetes blog — Ingress NGINX Retirement: What You Need to Know](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/)
- [cert-manager — Annotated Gateway resource](https://cert-manager.io/docs/usage/gateway/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
