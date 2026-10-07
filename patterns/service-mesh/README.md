<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🚪 API & Edge](../../README.md#api--edge)

# Service Mesh

> Sidecar proxies plus a control plane: mTLS, retries and traffic shifting without touching app code.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Service Mesh" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/service-mesh.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Calls go through proxies** | Every pod runs a **sidecar proxy** next to the app container. When Orders calls Payments, the request leaves the app as plain HTTP or gRPC, is intercepted by Orders' own sidecar, travels proxy to proxy, and is handed to the Payments app by its sidecar. Neither app contains any mesh code. |
| **2 · Control plane configures** | The **control plane** sends every proxy the endpoints of each service, the routing rules, the policies and a short-lived certificate that carries its service's identity. It is not on the request path: if it goes down, the proxies keep working with the last configuration they received. |
| **3 · Mutual TLS and policy** | The two proxies do a **mutual TLS** handshake with their certificates, so the traffic on the wire is encrypted and each side knows which service it is talking to. An authorization policy at Payments' proxies allows Orders and denies everyone else: Web's direct call gets a `403` from the proxy and never reaches the app. |
| **4 · Split traffic and retry** | A routing rule in Orders' sidecar sends 90% of the calls to Payments v1 and 10% to v2. When a call that is safe to repeat fails, the sidecar retries it within the timeout, so the app sees only the success. Every proxy also reports the same metrics and trace spans. None of this needs a code change, though the app must pass trace headers on for the spans to join into one trace. |
<!-- END GENERATED: header -->

## The problem

Every service that calls another one over the network needs the same plumbing: find the healthy instances, spread calls across them, encrypt the connection and prove who is calling, give up after a timeout, retry what is worth retrying, stop sending to an instance that keeps failing, and record what happened. Written into each application, that plumbing exists once per language and framework, drifts from team to team, and changes only when every service is rebuilt and redeployed.

A shared library solves this for as long as everyone uses one language and upgrades on time, and the first large microservice systems worked that way (Twitter's Finagle is the usual example). With several languages and dozens of teams, nobody can say which services encrypt their calls, which ones retry, or which still lack last month's fix. Meanwhile calls inside the network are often plaintext and unauthenticated: anything that gets onto the network can call anything.

## How it works

A service mesh takes that plumbing out of the process and puts it into a **proxy next to every instance**, then adds a **control plane** that configures all the proxies from one place. It is the Sidecar pattern applied to networking and repeated for every workload; the outbound half of each proxy is what the Ambassador pattern describes.

### Data plane: the proxies

In the classic design every pod gets a **sidecar proxy**: Envoy in Istio and most other meshes, a purpose-built Rust proxy in Linkerd. It is injected when the pod is created, and redirect rules in the pod's network namespace (iptables rules written by an init container or a CNI plugin) send everything that enters or leaves the app through it. The app keeps calling `http://payments` in plain HTTP or gRPC and contains no mesh code. One call now takes three hops: from the app to its own sidecar inside the pod, from sidecar to sidecar across the network, and from the far sidecar to the destination app.

Because the proxies see every request, they can do the same things for each one:

- **Encrypt and identify.** The two proxies set up mutual TLS with their workload certificates, so each side knows which *service* is at the other end, whatever its IP address.
- **Authorize.** The receiving proxy checks the caller's identity (and, for HTTP, the method and path) against policy before the app sees the request. Envoy's RBAC filter and Linkerd's proxy both answer a denied HTTP request with `403`; a denied TCP connection is closed or refused.
- **Route and balance every request.** The calling proxy picks an endpoint per request, not once per connection, which is what long-lived HTTP/2 and gRPC connections need (see [Load Balancing](../load-balancing/)). Routes can split traffic by weight, match on headers or mirror requests to a new version.
- **Protect.** Timeouts, retries, connection limits and taking instances that keep failing out of rotation: a [Circuit Breaker](../circuit-breaker/) without code.
- **Observe.** The same request rate, error rate and latency figures for every pair of services, plus access logs and trace spans, all in one format.

### Control plane: configuration, never traffic

The control plane has three jobs, and forwarding requests is not one of them:

- **Service discovery.** It watches the platform's registry (Kubernetes Services and their endpoints) and tells every proxy which instances exist right now.
- **Configuration and policy.** It turns the routing rules and policies you declare into proxy configuration and streams it out. Envoy-based meshes use the xDS APIs for this, which deliver listeners, routes, clusters, endpoints and secrets over gRPC.
- **Certificate authority.** It signs a short-lived certificate for every workload.

If the control plane goes down, the proxies carry on with what they have: Envoy keeps the last configuration it received, and Linkerd's proxies keep using the endpoints they last learned. What stops is change. New rules don't arrive, a proxy that starts during the outage has nothing to work with, and certificates can't be renewed, so an outage that outlasts the certificates' remaining lifetime starts to break mutual TLS. Run several replicas of the control plane and alert on it like any other critical service.

### Identity

Every workload gets its own identity, normally derived from its Kubernetes service account and carried in an X.509 certificate. SPIFFE standardises both the name and the document: a SPIFFE ID is a URI of the form `spiffe://<trust domain>/<path>` (Istio uses `spiffe://<trust-domain>/ns/<namespace>/sa/<service-account>`), and the certificate that carries it is called an X.509-SVID. The proxy, or an agent beside it, creates the private key and a signing request; the CA checks the workload's platform credentials and returns the certificate, so the key is never sent anywhere. Workload certificates expire after 24 hours by default in both Istio and Linkerd and are renewed automatically, which keeps a stolen one useful only briefly.

A **trust domain** is the set of workloads that share a root of trust. Clusters that should talk to each other either share that root or exchange (federate) their trust bundles. The root and issuer certificates are the part that does *not* rotate by itself: the trust anchor that Linkerd's install command generates, for example, expires after one year.

### What stays in the application

- **Whether a call is safe to repeat.** A proxy sees a `POST`, not a payment. Idempotency keys, compensation and business-level retries belong to the service.
- **Fallbacks.** When the retries are used up, the proxy returns an error. Degrading gracefully is application logic.
- **Trace context.** Each proxy can emit a span, but it cannot tell which outgoing call belongs to which incoming request. The app has to copy the trace headers (W3C `traceparent` and `tracestate`, or B3) from the request it received to the calls it makes, or the trace falls apart into unconnected spans (see [Distributed Tracing](../distributed-tracing/)).
- **End-user authorization.** The mesh proves which workload is calling. Whether this user may see that order is still the service's decision.

### A mesh, an API gateway or a library?

| | Library in each service | API gateway | Service mesh |
|---|---|---|---|
| Runs | inside the process | as one tier at the edge | next to every instance, or on every node |
| Traffic | whatever the code calls | north-south: clients into the system | east-west: service to service |
| Languages | one implementation per language | any | any |
| Knows | the business operation, so it can judge what is safe to retry | the external client: API keys, user tokens, quotas | the workload at each end |
| Changed by | rebuilding and redeploying every service | gateway configuration | mesh configuration |

They work together: an [API Gateway](../api-gateway/) for clients at the edge, a mesh between the services, and a little library code where the business meaning matters.

### Without sidecars

A proxy in every pod is the expensive part, so newer data planes move it somewhere else:

- **A proxy per node.** In Istio's ambient mode a `ztunnel` on every node gives all the pods there mutual TLS, identity and layer-4 policy. Optional *waypoint* proxies (Envoy, typically one per namespace) add layer-7 features only where they are wanted.
- **eBPF.** Cilium handles the connection level in the kernel with eBPF and passes layer-7 traffic to an Envoy on each node.
- **Proxyless gRPC.** gRPC clients and servers can take their configuration straight from an xDS control plane (routing, load balancing, retries, mutual TLS) with no proxy at all. It is a library again, but one that is configured centrally.

The node-level designs cost less, and workloads can join them without a restart. The price is coarser isolation: a node-level proxy holds the keys of every workload on its node, and a shared layer-7 proxy is shared by everything behind it.

## When to use it

- Many services in several languages, owned by several teams, that should all get the same encryption, identity, timeouts and telemetry.
- A requirement to encrypt traffic in transit everywhere and to control which service may call which (a zero-trust network), without changing every codebase.
- Progressive delivery: shifting a percentage of the traffic, or the requests that carry a certain header, to a new version (see [Canary Release](../canary-release/)).
- gRPC or HTTP/2 between services, where balancing per connection leaves some instances idle and others overloaded.
- A platform team that can run it. Adopt it in stages: mutual TLS and metrics first, layer-7 routing only where a service needs it.

**When not to use it:**

- **A handful of services.** An ingress or gateway, TLS and a few lines of timeout and retry configuration cost far less than a mesh.
- **One language with a good library.** gRPC's own deadlines, retries and load balancing, or a resilience library, cover most of the need and understand the business operation better than a proxy can.
- **Nobody to operate it yet.** A mesh sits in the path of every call. If no one can upgrade it, rotate its root certificates and debug it during an incident, it adds more risk than it removes. A managed mesh reduces that work but doesn't remove it.
- **Very tight latency budgets**, where two more proxies on every call are two too many.

## Trade-offs

- **A proxy per pod costs CPU and memory.** In Istio's own benchmark (version 1.24, 1,000 requests per second with 1 KB payloads) one sidecar with two worker threads used about 0.20 vCPU and 60 MB. Multiply that by every pod. The per-node `ztunnel` of ambient mode used about 0.06 vCPU and 12 MB in the same test. A proxy's memory also grows with the configuration it holds, so in a large mesh limit what each proxy needs to know about.
- **Latency on every hop.** Each call now passes two proxies. Istio's documentation puts the added latency at 0.63 to 0.88 ms (p90 to p99) in sidecar mode and 0.16 to 0.20 ms for ambient mode at layer 4. Measure your own tail latency instead of trusting anyone's benchmark.
- **Upgrades touch everything.** An upgrade means the control plane first and then every proxy, which for sidecars is a rolling restart of every workload, with mixed versions in between.
- **Debugging gets a new layer.** A `503` can now come from the app, from either proxy or from a policy. Learn the mesh's tools for showing what a proxy was told and what it did before you need them in an incident.
- **Sidecar lifecycle.** A sidecar that starts after the app, or outlives a finished Job, used to cause startup races and pods that never completed. Kubernetes native sidecar containers (init containers with `restartPolicy: Always`, stable since v1.33) start before the app and stop after it. Istio (since 1.27) and Linkerd (since 2.20) use them by default.
- **Retries at two layers multiply.** If the app or its SDK retries and the proxy retries as well, three attempts at each layer turn one call into nine, aimed at a dependency that is already struggling: a retry storm. Retry at one layer, cap the total with a retry budget, and read [Retry with Backoff & Jitter](../retry-with-backoff/) first. A proxy also cannot know whether a request is safe to repeat, so allow retries route by route and only for idempotent requests (the rule in the animation retries `GET` calls only). Istio stopped retrying `503` responses by default in version 1.24 for exactly that reason.
- **"Permissive" is not protected.** To make migration possible, meshes accept plaintext next to mutual TLS at first: Istio's mesh-wide default mode is `PERMISSIVE`, and Linkerd's default policy admits unauthenticated clients. Encryption and authorization are enforced only after you switch to strict mode and default-deny policies.
- **The pod is the trust boundary.** Traffic between the app and its sidecar is plaintext inside the pod, and an attacker who takes over the app can call out with the pod's identity. The mesh limits where they can go next; it doesn't make the app safe.

## Implementation notes

- **Products, as of October 2026.** *Istio* (CNCF graduated) offers sidecar mode and ambient mode. Ambient has been generally available since Istio 1.24 (November 2024), although its multi-cluster support is still beta in Istio 1.31. *Linkerd* (CNCF graduated) uses sidecars only, with mutual TLS on by default; since February 2024 the open-source project itself publishes only edge releases, and stable release artifacts come from vendors such as Buoyant. *Cilium* offers a mesh without sidecars; its SPIFFE-based mutual authentication and its ztunnel-based encryption are both still marked beta in Cilium 1.20. Managed options include Google Cloud Service Mesh (the merger of Anthos Service Mesh and Traffic Director) and the Istio-based add-on for AKS.
- **Retired: don't build on these.** *AWS App Mesh* reached its end of support on 30 September 2026; AWS points its users to Amazon ECS Service Connect and Amazon VPC Lattice. *Open Service Mesh* was archived by the CNCF in 2023, and its AKS add-on is supported only until 30 September 2027. The *Service Mesh Interface* (SMI) specification was archived in October 2023.
- **Prefer the Gateway API where it is enough.** The Kubernetes Gateway API covers mesh traffic too, through the GAMMA initiative: attach a route such as an `HTTPRoute` to a `Service` instead of a `Gateway`, and it governs calls to that service. This has been part of the Standard channel since v1.1. The project lists Istio and Cilium as conformant mesh implementations, and Linkerd configures routing, policy and timeouts with `HTTPRoute` and `GRPCRoute`. Mesh-specific APIs still reach further, and retries in `HTTPRoute` are still experimental.
- **Roll out mutual TLS in stages.** Start permissive, use the mesh's telemetry to find what still talks plaintext, switch to strict one namespace at a time, then add authorization: deny by default and allow named service identities.
- **Know the defaults for timeouts and retries.** Istio sets no request timeout by default and retries an HTTP request twice; Linkerd retries nothing until you configure it. Set an overall timeout per route that covers all attempts, limit the attempts, and check what the app's own client already does.
- **Know where a traffic split is applied.** In sidecar mode the calling service's sidecar applies the weights; in Istio's ambient mode the destination's waypoint does. Either way, calls from outside the mesh are not split. Let a rollout controller such as Argo Rollouts or Flagger move the weights and judge the metrics.
- **Certificates.** Workload certificates rotate themselves; the root and the issuer do not. Monitor their expiry, rehearse the rotation, and consider issuing from an external CA (cert-manager, a cloud private CA or SPIRE).
- **Propagate trace headers** in every service, or the mesh's spans won't join up.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Sidecar](../sidecar/) — Run helper capabilities (proxy, logging, config) in a separate process next to the app.
- [Ambassador](../ambassador/) — An out-of-process proxy that handles outbound connectivity (retries, TLS, routing) for a client.
- [Mutual TLS (mTLS)](../mutual-tls/) — Client and server both present certificates, so every connection is authenticated both ways.
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- [Canary Release](../canary-release/) — Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back.
- [Circuit Breaker](../circuit-breaker/) — Stop calling a failing dependency, fail fast with a fallback, and probe until it recovers.
- [Retry with Backoff & Jitter](../retry-with-backoff/) — Retry transient failures with growing, randomised delays so clients don't stampede.
- [Distributed Tracing](../distributed-tracing/) — Propagate a trace context across services and assemble the spans into one timeline.

## Related components and services

- [Kubernetes](../kubernetes/) — A container orchestrator: you declare the desired state, and controllers keep pods scheduled, healthy and reachable.

## References

- [Istio — Architecture](https://istio.io/latest/docs/ops/deployment/architecture/)
- [Istio — Sidecar or ambient?](https://istio.io/latest/docs/overview/dataplane-modes/)
- [Istio — Ambient mode: Overview](https://istio.io/latest/docs/ambient/overview/)
- [Istio — Security (identity, mutual TLS, authorization)](https://istio.io/latest/docs/concepts/security/)
- [Istio — Performance and Scalability](https://istio.io/latest/docs/ops/deployment/performance-and-scalability/)
- [Linkerd — Architecture](https://linkerd.io/docs/reference/architecture/)
- [Linkerd — Automatic mTLS](https://linkerd.io/docs/features/automatic-mtls/)
- [Envoy — xDS REST and gRPC protocol](https://www.envoyproxy.io/docs/envoy/latest/api-docs/xds_protocol)
- [SPIFFE — SPIFFE Concepts](https://spiffe.io/docs/latest/spiffe-about/spiffe-concepts/)
- [Kubernetes Gateway API — Gateway API for Service Mesh (GAMMA)](https://gateway-api.sigs.k8s.io/docs/mesh/mesh-overview/)
- [Kubernetes — Sidecar Containers](https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/)
- [Cilium — Service Mesh](https://docs.cilium.io/en/stable/network/servicemesh/)
- [gRPC — xDS Features in gRPC](https://grpc.github.io/grpc/core/md_doc_grpc_xds_features.html)
- [William Morgan — Service mesh: A critical component of the cloud native stack (CNCF blog, 2017)](https://www.cncf.io/blog/2017/04/26/service-mesh-critical-component-cloud-native-stack/)
- [Phil Calçado — Pattern: Service Mesh](https://philcalcado.com/2017/08/03/pattern_service_mesh.html)
- [Microsoft Learn — About service meshes (Azure Kubernetes Service)](https://learn.microsoft.com/en-us/azure/aks/servicemesh-about)
- [Google Cloud — Cloud Service Mesh overview](https://docs.cloud.google.com/service-mesh/docs/overview)
- [AWS — Migrating from AWS App Mesh to Amazon ECS Service Connect (App Mesh end of support)](https://aws.amazon.com/blogs/containers/migrating-from-aws-app-mesh-to-amazon-ecs-service-connect/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
