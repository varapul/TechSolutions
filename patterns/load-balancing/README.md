<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [☁️ Cloud Infrastructure](../../README.md#cloud-infrastructure)

# Load Balancing

> Spread requests across healthy instances and stop sending to unhealthy ones.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Load Balancing" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/load-balancing.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Spread the requests** | Clients send every request to **one address**, and the load balancer picks an instance for each one. **Round robin** hands them to A, B and C in turn, so each of the three identical, stateless instances gets a third. Instances can be added, replaced or removed behind that address without clients noticing. |
| **2 · Pick the least busy** | Requests are not equal. A few slow ones land on B, and round robin keeps giving B every third request, so its in-flight count climbs. **Least connections** (for HTTP, *least outstanding requests*) sends each new request to the instance with the fewest in flight, and the counts even out. **The power of two choices** gets most of that benefit by comparing just two randomly picked instances. |
| **3 · Skip unhealthy instances** | The load balancer probes `/healthz` on every instance all the time. C stops answering; after **3 failed probes in a row** it is marked **unhealthy** and gets no new requests, while A and B take its share. The requests C was holding time out, and detection takes about *interval × threshold*. The numbers here are illustrative; each product has its own defaults. |
| **4 · Recover and rejoin** | C is fixed or replaced and passes **2 probes in a row**, so it rejoins. A **slow start** ramps its share up, so a cold instance isn't flooded the moment it returns. Taking an instance out on purpose (a deployment, a scale-in) works the other way round: it is **drained** first, which means no new requests while the in-flight ones finish. |
<!-- END GENERATED: header -->

## The problem

A single instance of a service is both a ceiling and a single point of failure. It can only take so much traffic, and when it crashes, hangs or is redeployed, everything that depends on it is down. Running several identical instances fixes both problems, but only if something decides where each request goes, notices when an instance stops working, and hides all of that from clients. If clients knew the instances by address, every scale-out, replacement and failure would become the clients' problem.

## How it works

A load balancer puts **one stable address** (a DNS name or a virtual IP) in front of a pool of interchangeable instances, variously called targets, backends or upstreams. For every request or connection it does three jobs:

- **Pick a target** with a balancing algorithm.
- **Skip targets that aren't healthy.** It finds them by probing (active health checks) or by watching real traffic (passive checks, outlier detection).
- **Add and remove targets gracefully.** New ones are ramped up (*slow start*); departing ones stop getting new work and finish what they hold (*connection draining*).

### Layer 4 or layer 7

| | Layer 4 (transport) | Layer 7 (application) |
|---|---|---|
| Balances | TCP connections and UDP flows | individual HTTP requests and gRPC calls |
| Sees | addresses, ports, protocol | method, host, path, headers, cookies, status codes |
| Can | forward any protocol very cheaply; as a proxy, also terminate TLS | route by host or path, retry, pin a session with a cookie, balance each request |
| Examples | AWS Network Load Balancer, Azure Load Balancer, Google Cloud Network Load Balancers | AWS Application Load Balancer, Azure Application Gateway, Google Cloud Application Load Balancers, NGINX, HAProxy and Envoy in HTTP mode |

A layer-4 balancer chooses **once per connection**: an AWS Network Load Balancer, for example, hashes the flow and keeps a TCP connection on the same target for as long as it lasts. That works when connections are many and short. It breaks down with **HTTP/2 and gRPC**, which multiplex many requests over one connection that stays open: every request from a client lands on whichever instance the connection reached first, a busy client overloads one instance, and an instance added later gets nothing until clients reconnect. A Kubernetes Service balances this way too: kube-proxy picks a backend Pod for each new connection. Long-lived, multiplexed connections need **request-level balancing**: a layer-7 proxy, a service mesh sidecar, or a client that balances for itself.

### Algorithms

- **Round robin:** the next target in the list. It is even and predictable when requests and instances are alike, and it is the default in NGINX and on AWS Application Load Balancers.
- **Weighted** variants give a larger share to larger instances. Shifting weights is also how slow start and canary releases move traffic gradually.
- **Least connections**, which HTTP balancers call *least outstanding requests* or *least request*: the target with the fewest in flight. It adapts when requests vary in cost or one instance slows down. It has two traps. An instance that **fails fast** has almost nothing in flight, so it looks idle and attracts more traffic (a *black hole*); and a brand-new instance starts at zero and is flooded unless it gets a slow start.
- **Power of two choices:** pick two targets at random and use the less loaded one. Mitzenmacher showed that two choices improve exponentially on one random choice, while a third adds only a constant factor. It needs no shared view of the pool, so it suits many balancers that act independently. Envoy's least-request balancer works this way when weights are equal, NGINX offers `random two least_conn`, and HAProxy's `random` draws two servers by default.
- **Hashing:** hash a key (the client address, a header, a cookie, the URL) so the same key always reaches the same target. That keeps caches warm and gives affinity without storing a session for every client. **Consistent hashing** (a ketama-style ring, or Maglev's lookup table) moves only a small share of the keys when a target joins or leaves.

### Health checks

- **Active** checks probe every target on a timer, whether or not it has traffic, and count consecutive results: so many failures in a row to take a target out, so many passes to put it back. **Passive** checks watch real responses instead. NGINX marks a server unavailable after `max_fails` failed attempts within `fail_timeout`, and Envoy's *outlier detection* ejects hosts that return consecutive errors or fall behind their peers on success rate. Passive checks react to exactly what users see, but only on targets that are receiving traffic, so the two complement each other; Envoy, for example, lets you enable both together.
- **Shallow or deep.** A shallow (liveness) check proves that the process is up and answering. A deep check also exercises the things the instance needs, such as its database or a downstream service. Deep checks catch more, but when a shared dependency blips, **every instance fails together** and the balancer has nowhere left to send traffic.
- **Fail open.** To survive that, many balancers ignore health once too few targets pass. An Application Load Balancer routes to all targets in a group when every one of them is unhealthy, and Envoy enters *panic mode* when the healthy share of a cluster falls below its panic threshold (50% by default) and then balances across all hosts regardless of health. Decide deliberately which you want: some answers from possibly broken instances, or none.
- **Thresholds and intervals** trade detection time against **flapping**. Detection takes roughly *interval × unhealthy threshold*, and every request sent in that window is at risk, so short intervals and low thresholds find failures fast, while requiring several passes before a target returns keeps a struggling instance from bouncing in and out.

### Where the balancer sits

- **Zones.** Spread targets across availability zones so that losing a zone costs a share of capacity, not the service. With *cross-zone* balancing each balancer node spreads over the targets in every zone; without it a node uses only its own zone's targets, which keeps traffic local but overloads a zone that has fewer of them.
- **The balancer's own availability.** A load balancer in front of everything is a single point of failure unless it is redundant itself. Managed balancers run redundant nodes across zones behind a DNS name or an anycast address. Self-managed ones use an active-standby pair that shares a virtual IP (VRRP), or several equal nodes behind anycast or ECMP routing. Google's Maglev is built the second way, and uses consistent hashing and connection tracking so that established connections survive failures.
- **Client-side balancing and service meshes.** The balancing logic can live in the caller instead of in a box in the middle: a gRPC client with the `round_robin` policy or an xDS control plane, or a sidecar proxy from a service mesh, which balances each request and adds retries and outlier detection. That removes a hop and a bottleneck between services, and puts the logic into every client or sidecar.
- **Regional or global.** A regional balancer spreads requests over instances and zones in one region. A global one, built on anycast or DNS, first chooses the region, as in [Multi-Region Active-Active](../multi-region-active-active/).

## When to use it

- In front of any service that runs more than one instance, which is every service that has to stay up through a failure or a deployment.
- To scale stateless tiers horizontally. With [Autoscaling](../autoscaling/) the pool changes size on its own: the balancer's health checks decide when a new instance starts to receive traffic, draining lets a departing one finish, and requests per target make a good scaling signal.
- To deploy without downtime: rolling updates, [Blue-Green Deployment](../blue-green-deployment/) and [Canary Release](../canary-release/) all work by changing which targets the balancer sends to, and how much.
- It needs more thought for stateful systems. A database primary, a leader or a shard owner is not interchangeable with its peers, so use role-aware routing or consistent hashing there, not plain round robin.

## Trade-offs

- **One more hop, and one more thing that can fail.** A proxying balancer adds a little latency and has to be at least as available as the service behind it.
- **Even requests are not even load.** Round robin counts requests and ignores how expensive they are. Least-loaded policies adapt, but they have the black-hole and cold-start traps above, and the balancer only sees its own traffic, not what other balancers are sending.
- **Stateless or sticky.** *Session affinity* (sticky sessions, by cookie or by client address) keeps a user on one instance so that in-memory state works. It also skews the load, strands sessions when an instance dies and gets in the way of scaling in. Prefer stateless instances with the session in a shared store or a token, and keep affinity for what can't be moved.
- **Health checks cut both ways.** Too shallow and a broken instance stays in rotation; too deep and one dependency takes every instance out at once. Too slow and users feel a failure for a long time; too twitchy and healthy instances flap.
- **Failure still costs something.** Requests in flight on a failed instance are lost unless something retries them, and retries are only safe for idempotent requests (see [Retry with Backoff & Jitter](../retry-with-backoff/)). The survivors must absorb the load, so size the pool to lose an instance, or a zone, and still cope.
- **Connection-level balancing fits badly with long-lived connections.** HTTP/2, gRPC, WebSockets and database connections stay where they first landed. Balance per request where the protocol allows it, or have servers close connections after a while (gRPC's `MAX_CONNECTION_AGE`) so that clients reconnect and spread out.

## Implementation notes

Vendor behaviour and defaults change, so treat these as examples and check the current documentation.

- **AWS Application Load Balancer:** routing is round robin by default, with *least outstanding requests* and *weighted random* as alternatives. An instance or IP target is checked every 30 seconds with a 5-second timeout, is taken out after 2 consecutive failures and returns after 5 consecutive successes, so with the defaults a dead target is noticed after about a minute. A target group with no healthy targets fails open. Deregistration (draining) waits up to 300 seconds by default. Slow start is off by default, lasts 30 to 900 seconds when enabled, and isn't available with the two alternative algorithms. Cross-zone balancing is always on for the load balancer and can be turned off per target group; on Network and Gateway Load Balancers it is off by default.
- **NGINX:** round robin by default, plus `least_conn`, `ip_hash`, `hash` (with `consistent`), `random` (with `two`) and `least_time`. The passive defaults are `max_fails=1` and `fail_timeout=10s`. Active `health_check` probes and `slow_start` belong to the commercial subscription.
- **HAProxy:** `balance roundrobin`, `leastconn`, `random`, `source`, `uri`, `hdr` and more. Version 3.4 uses `random` when nothing is set (in 3.2 it was `roundrobin`). Health checks (`check`) default to one every 2 seconds (`inter`), 3 failures to mark a server down (`fall`) and 2 passes to bring it back (`rise`), and `slowstart` ramps a returning server's weight up linearly.
- **Envoy and service meshes:** weighted round robin, weighted least request, ring hash, Maglev and random; active health checking, outlier detection, a panic threshold and a slow-start mode for round robin and least request. Linkerd balances each HTTP, HTTP/2 and gRPC request and favours the endpoints that have been answering fastest (an exponentially weighted moving average).
- **gRPC:** the default client policy, `pick_first`, sends every call to one address. Use `round_robin`, an xDS control plane or a layer-7 proxy to spread calls.
- **The health endpoint:** probe a readiness signal, meaning *this instance can serve now*, and keep it cheap, fast and free of side effects. In Kubernetes a Pod that fails its readiness probe is removed from the Service's endpoints. Let a busy instance still answer its health check, or an overloaded pool will eject itself. Leave checks on shared dependencies to monitoring, or make sure the balancer fails open.
- **Draining:** on shutdown an instance should fail its readiness check or be deregistered, finish the requests in flight and only then exit. Google's SRE book calls that state *lame duck*. Make the drain time longer than your slowest request.
- **Know who the client is:** behind a layer-7 proxy the instance sees the balancer's address. The original client arrives in `X-Forwarded-For` (or the PROXY protocol at layer 4).
- **Watch it:** healthy-target count, requests and errors per target, latency per target, and connections rejected by the balancer itself. A pool that sits at its minimum healthy count has no margin left.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Autoscaling](../autoscaling/) — Add and remove instances automatically as load rises and falls.
- [Health Endpoint Monitoring](../health-endpoint-monitoring/) — Expose liveness and readiness checks that load balancers and monitors probe.
- [Multi-Region Active-Active](../multi-region-active-active/) — Serve users from several regions at once and shift traffic away from a region that fails.
- Active-Passive Failover *(planned)* — A warm standby region is promoted when the primary region goes down.
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- [Service Mesh](../service-mesh/) — Sidecar proxies plus a control plane: mTLS, retries and traffic shifting without touching app code.
- [Rolling Update](../rolling-update/) — Replace instances batch by batch while the service stays up.
- [Circuit Breaker](../circuit-breaker/) — Stop calling a failing dependency, fail fast with a fallback, and probe until it recovers.

## References

- [Google SRE Book — Load Balancing at the Frontend (chapter 19)](https://sre.google/sre-book/load-balancing-frontend/)
- [Google SRE Book — Load Balancing in the Datacenter (chapter 20)](https://sre.google/sre-book/load-balancing-datacenter/)
- [AWS — How Elastic Load Balancing works](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/how-elastic-load-balancing-works.html)
- [AWS — Health checks for Application Load Balancer target groups](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html)
- [AWS — Edit target group attributes for your Application Load Balancer (routing algorithm, slow start, deregistration delay)](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-target-group-attributes.html)
- [nginx — Module ngx_http_upstream_module](https://nginx.org/en/docs/http/ngx_http_upstream_module.html)
- [HAProxy 3.4 — Configuration Manual (balance, health checks, slowstart)](https://docs.haproxy.org/3.4/configuration.html)
- [Envoy — Load balancing (supported load balancers, panic threshold, slow start)](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/load_balancing/load_balancing)
- [Envoy — Outlier detection](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/outlier)
- [Michael Mitzenmacher — The Power of Two Choices in Randomized Load Balancing (IEEE TPDS, 2001)](https://www.eecs.harvard.edu/~michaelm/postscripts/tpds2001.pdf)
- [Eisenbud et al. — Maglev: A Fast and Reliable Software Network Load Balancer (NSDI 2016)](https://www.usenix.org/conference/nsdi16/technical-sessions/presentation/eisenbud)
- [AWS Builder Center — Implementing health checks (first published in the Amazon Builders' Library)](https://builder.aws.com/content/3Ev53O39izHCtWLzp4XU6t8PC1O/implementing-health-checks)
- [gRPC — gRPC Load Balancing](https://grpc.io/blog/grpc-load-balancing/)
- [Azure Architecture Center — Load balancing options](https://learn.microsoft.com/en-us/azure/architecture/guide/technology-choices/load-balancing-overview)
- [Google Cloud — Cloud Load Balancing overview](https://docs.cloud.google.com/load-balancing/docs/load-balancing-overview)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
