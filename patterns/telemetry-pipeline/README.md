<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔭 Observability & Operations](../../README.md#observability--operations)

# Telemetry Pipeline (OpenTelemetry)

> Receive, process and export traces, metrics and logs through one vendor-neutral collector.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Telemetry Pipeline (OpenTelemetry)" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/telemetry-pipeline.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One protocol in** | Each service is instrumented with the OpenTelemetry API and SDK and exports its **traces, metrics and logs** over **OTLP** (gRPC on port 4317, HTTP on 4318). Application code never imports a backend's agent or client library. In the Collector, one `otlp` receiver accepts all three signals and hands each to its own **pipeline**. |
| **2 · Process in the middle** | Each pipeline runs its processors in order, with the **memory limiter** first. Here they add resource attributes (`k8s.pod.name`, `deployment.environment.name`) next to the `service.name` set by the SDK, **tail-sample** the traces (every trace that contains an error, plus 25% of the rest), delete a sensitive attribute (`user.email`) and **batch** what is left. Tail sampling judges whole traces, so every span of a trace must reach the same Collector instance. |
| **3 · Fan out** | Exporters send each signal to its backend, and a pipeline may list several: during a migration the traces pipeline feeds the current tracing backend and the **new vendor** at the same time, each through its own exporter and queue. Adding, replacing or removing a backend is an edit to the Collector's configuration, so no service is rebuilt or redeployed. |
| **4 · Stay up under pressure** | The log store stops answering, so its exporter holds batches in a **sending queue** and **retries with exponential backoff**. When memory reaches its limit, the **memory limiter** refuses new data in every pipeline rather than let the process die: the receiver answers with a retryable error (gRPC `UNAVAILABLE`, HTTP 503), so the refused data stays with the sender, which retries and loses it only if its own buffer overflows or its retries run out. At scale the same pipeline is split into two tiers: **agents** beside the workloads forward to a load-balanced pool of **gateway** Collectors. |
<!-- END GENERATED: header -->

## The problem

Each observability backend used to arrive with its own collection stack: a tracing library and agent from one vendor, a metrics client and scraper from another, a log shipper from a third. Instrumentation was written against a vendor's API, so replacing the vendor meant editing and redeploying every service, and running two vendors side by side during a migration meant instrumenting twice. Policy lived wherever the SDK settings lived. Which attributes count as personal data, how much to sample and where telemetry may leave the network were decided separately in dozens of repositories.

Telemetry also has to survive bad days. A system in trouble produces more telemetry than usual, at the moment its backends are most likely to be slow or unreachable. If nothing between the application and the backend can buffer, retry and shed load, you either lose the data that explains the incident or let exporters back up inside the applications.

## How it works

A telemetry pipeline puts one vendor-neutral process, the **OpenTelemetry Collector**, between the applications and the backends. Applications are instrumented once, with the OpenTelemetry API and SDK, and speak one protocol. Everything that is specific to a backend moves into the Collector's configuration.

### Signals and OTLP

OpenTelemetry calls each kind of telemetry a **signal**.

| Signal | What travels | Status on 2 October 2026 |
|---|---|---|
| Traces | spans | API, SDK and protocol stable |
| Metrics | metric data points | API and protocol stable; the SDK specification is listed as *mixed* |
| Logs | log records | Bridge API, SDK and protocol stable |
| Profiles | profiling samples | public alpha since 26 March 2026; its part of OTLP is still marked *Development* |

Baggage is specified and stable too, but it is request context that applications read, not telemetry that a pipeline carries.

The signals share one wire format, the **OpenTelemetry Protocol (OTLP)**: Protobuf messages sent as gRPC calls (default port **4317**) or as HTTP `POST` requests (default port **4318**, paths `/v1/traces`, `/v1/metrics` and `/v1/logs`, with a binary Protobuf or JSON body). OTLP is stable for traces, metrics and logs, and many backends ingest it directly.

Every OTLP request is answered. The answer is a success, a *partial success* that says how many items were rejected, or an error, and the specification lists the errors a client should retry with exponential backoff: gRPC `UNAVAILABLE` and HTTP 429, 502, 503 and 504 among them. That contract is what lets a receiver push back on a sender in step 4. SDKs export to `http://localhost:4318` by default (`:4317` for gRPC), so an application with no exporter settings finds a Collector that runs next to it.

### Inside the Collector

The Collector is a single binary driven by a YAML file. The file declares components and wires them into **pipelines**, each of which carries one signal.

- **Receivers** bring data in. The diagram uses `otlp`; others accept older formats (Zipkin, Jaeger), read from Kafka, or fetch data themselves (see *Collecting what already exists*). One receiver instance can feed several pipelines.
- **Processors** run in the order the pipeline lists them, and each pipeline gets its own instance. They enrich, filter, sample, redact and batch.
- **Exporters** send data out. A pipeline may list several and each receives a copy, which is how step 3 feeds two tracing backends at once.
- **Connectors** join two pipelines: they are the exporter of one and the receiver of the next. `span_metrics` turns spans into request, error and duration metrics, and `routing` sends data to different pipelines by attribute.
- **Extensions** sit beside the data path: health checks, `pprof` and zPages for debugging, authenticators, and `file_storage` for queues that survive a restart.

The traces pipeline in the diagram is declared like this:

```yaml
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, k8s_attributes, tail_sampling, redaction, batch]
      exporters: [otlp_grpc/current, otlp_grpc/new]
```

**Processor order matters.** The project's guidance is `memory_limiter` first, then anything that drops data (sampling, filtering) so that later stages do less work, then processors that need the request's context such as `k8s_attributes`, then transformation and enrichment, and batching last. Tail sampling is the documented exception to *drop early*: it regroups spans into new batches and loses that context, so it has to come after `k8s_attributes`, as it does here.

### Enrichment

Telemetry is only useful if it says where it came from. The SDK sets `service.name`. The pipeline adds what the application cannot know or should not have to. The `k8s_attributes` processor finds the pod that sent the data (by the source IP of the connection unless told otherwise) and adds resource attributes such as `k8s.namespace.name`, `k8s.pod.name`, `k8s.pod.uid`, `k8s.deployment.name` and `k8s.node.name`. It can also copy pod labels and annotations, which is one way to set `deployment.environment.name`; the `resource` processor sets fixed values, and `resource_detection` reads host and cloud metadata. Use the attribute names from the semantic conventions, and their well-known values where they exist (`production`, `staging`, `test` and `development` for the environment), so that every backend, dashboard and alert can rely on the same keys.

### Head or tail sampling

**Head sampling** decides when a trace starts, in the SDK: keep 10% by trace ID and tell the services downstream through the sampled flag. It is cheap and stateless, but it decides before anyone knows whether the request will fail.

**Tail sampling** decides in the Collector after the spans have arrived. The `tail_sampling` processor holds every trace in memory for a decision window (`decision_wait`, 30 seconds by default) and then applies policies. The two in the diagram keep every trace that contains an error and a quarter of the others:

```yaml
tail_sampling:
  policies:
    - { name: errors, type: status_code, status_code: { status_codes: [ERROR] } }
    - { name: the-rest, type: probabilistic, probabilistic: { sampling_percentage: 25 } }
```

The price is that a decision needs the whole trace, so every span of a trace must reach the same Collector instance. With one Collector that happens by itself. With several, an ordinary [load balancer](../load-balancing/) is not enough, because it spreads the spans of one trace across instances. A first layer of Collectors then uses the `load_balancing` exporter, which hashes the trace ID to pick one of the sampling Collectors, and it finds those from a static list, DNS, the Kubernetes API or AWS Cloud Map.

### Redaction and the transform language

Three processors take data out. `redaction` works from an allow-list of attribute keys (a key that is not listed is deleted, so it fails closed) and masks values that match patterns such as card numbers. `attributes` deletes, hashes or rewrites individual keys. `transform` runs statements in the **OpenTelemetry Transformation Language (OTTL)**, a small language for conditional edits to spans, metrics and logs:

```yaml
transform:
  trace_statements:
    - delete_key(span.attributes, "user.email")
    - replace_pattern(span.attributes["url.query"], "token=[^&]*", "token=***")
```

The `filter` processor uses OTTL conditions to drop whole spans, data points or log records.

### Reliability under back-pressure

Four mechanisms decide what happens when a backend is slow or down. They do different jobs, and it helps to keep them apart.

| Mechanism | Where | Under back-pressure |
|---|---|---|
| **Sending queue** | in the exporter; on by default in the OTLP exporters | Holds batches in memory (1,000 requests by default) while the backend is unavailable. Once full, it rejects new batches for that exporter and they are dropped, unless `block_on_overflow` makes the pipeline wait. |
| **Retry on failure** | in the exporter; on by default in the OTLP exporters | Sends a failed batch again after about 5 s, then waits 1.5 times longer each time up to 30 s, each wait randomised by half. It gives up after 5 minutes (`max_elapsed_time`; 0 means never) and drops the batch. |
| **Persistent queue** | opt-in, needs a storage extension | Keeps the queue on disk through `file_storage`, so queued batches survive a crash or restart of the Collector. It is still bounded, by the queue size and by the disk. |
| **Memory limiter** | first processor of every pipeline | Above its soft limit it refuses incoming data; above its hard limit it also forces garbage collection. It protects the process, not the data. |

Data refused by the memory limiter is neither accepted nor dropped by the Collector: the error travels back to the receiver, which reports it to the sender. The `otlp` receiver answers gRPC `UNAVAILABLE` or HTTP 503, both retryable, so the sender keeps the batch and tries again later. That sender is an SDK or an agent Collector with a queue of its own. The data is lost only if the sender's buffer overflows or its retries run out; an SDK's batch span processor, for example, queues 2,048 spans by default and drops spans once that is full. A receiver that pulls has no sender to push back on and has to hold or re-read the data itself: `file_log`, for example, pauses and retries only if its `retry_on_failure` option is switched on.

Each exporter has its own queue, so in the diagram the tracing backends and the metrics store keep receiving while the log store is down. That lasts until the limiter trips: it watches the memory of the whole process, so when it refuses data, it refuses every signal.

### Collecting what already exists

Not everything speaks OTLP. The `prometheus` receiver scrapes existing metrics endpoints with ordinary Prometheus scrape configuration. The `file_log` receiver tails and parses log files, such as container logs on a node. `host_metrics` and `kubelet_stats` read the machine and the kubelet. These *pull* receivers differ from OTLP in one important way: two replicas with the same configuration collect everything twice. Run one instance per node, or let something assign the targets (see the Kubernetes note below).

### Agent, gateway or both

- **No Collector.** SDKs export OTLP straight to the backend.
- **Agent.** A Collector next to the workload, as a sidecar in the pod or one per node. The application hands its data to a neighbour, and the agent can tag it with local metadata and pick up host metrics and log files.
- **Gateway.** A pool of identical Collectors behind a load balancer, one endpoint per cluster or region. Policy, backend credentials and egress live in one place.
- **Agent to gateway.** Both tiers, as in the strip under step 4.

Add the second tier when something has to be done centrally: tail sampling over complete traces, redaction rules that must hold for every team, backend credentials that should not be on every node, or a network that allows only a few egress points. It costs another hop and another fleet to run, so a deployment that needs none of these is better served by agents alone or by a gateway alone.

## When to use it

- You send telemetry to more than one backend, or expect to change vendors. A migration becomes a period in which the Collector exports to both.
- Policy has to hold across teams: redaction, sampling rates, required resource attributes.
- You have to collect host metrics, container logs and Prometheus endpoints anyway, and would rather run one agent than three.
- Applications should hand telemetry off quickly and leave batching, retries, compression and credentials to something else.
- Only a few points of the network may talk to the outside.

**When not to add one.** A small system whose SDKs export OTLP to a single backend that accepts it does not need a Collector yet. The SDK already batches and retries, and exporting directly is a documented deployment pattern. Add the Collector when the first cross-cutting need appears: a second backend, redaction, tail sampling or host telemetry. Because the applications speak OTLP either way, adding it later means changing an endpoint, not the instrumentation.

## Trade-offs

- **It is another production system.** The Collector needs capacity planning, upgrades (there is a release every two weeks), configuration management and monitoring of its own. If it is unhealthy, you are blind exactly when you want to see.
- **Not durable by default.** The sending queue lives in memory, so a crash loses whatever was queued, and a long outage overflows it. A persistent queue or a broker between the tiers (a Kafka topic with the `kafka` exporter and receiver, the idea behind [queue-based load leveling](../queue-based-load-leveling/)) narrows the gap but does not close it. Telemetry pipelines are built to lose data before they hurt the workload; decide which data may be lost.
- **Tail sampling is stateful and costly.** Memory grows with the number of traces in flight and the decision window. Scaling needs routing by trace ID, changing the number of sampling instances remaps traces that are in flight, and spans that arrive after the decision can miss it.
- **Sampling distorts anything computed afterwards.** Request rates and latency percentiles derived from sampled spans are wrong. Compute such metrics before the sampler, for example with `span_metrics` in a pipeline that still sees every span, or take them from real metrics.
- **A central pipeline has a central blast radius.** One bad filter or redaction rule drops or corrupts telemetry for everyone at once. Keep the configuration in version control, check it with `otelcol validate`, and roll it out in stages.
- **Enrichment depends on where it runs.** A gateway sees the agent's IP address, not the pod's, so `k8s_attributes` belongs in the agent, or the agent has to pass the pod's IP along (its `passthrough` mode does that).
- **Maturity is uneven.** The OTLP components are stable, much of the rest is beta or alpha, and names and defaults still change between releases.

## Implementation notes

- **Where the project stands (checked on 2 October 2026).** OpenTelemetry graduated in the CNCF on 11 May 2026, after joining in 2019 and reaching incubation in 2021. The Collector is still on 0.x releases (v0.162.0 of 28 September 2026), and its documentation calls its stability *mixed*, because every component declares a level per signal. In v0.162.0 the `otlp` receiver and the `otlp_grpc` and `otlp_http` exporters are stable for traces, metrics and logs and alpha for profiles; `k8s_attributes` is stable; `memory_limiter`, `batch`, `tail_sampling`, `transform`, `resource` and `file_storage` are beta, as is `load_balancing` for traces and logs; `redaction` is beta for traces and alpha for metrics and logs; `filter` and the `span_metrics` and `routing` connectors are alpha.
- **Component names changed recently.** Components are being renamed to snake_case, and the old names remain as deprecated aliases: the exporters `otlp` and `otlphttp` became `otlp_grpc` and `otlp_http` (v0.144.0), `k8sattributes` became `k8s_attributes` (v0.146.0), `filelog` became `file_log` (v0.149.0) and `hostmetrics` became `host_metrics` (v0.151.0); `load_balancing`, `span_metrics` and `resource_detection` were renamed the same way. Most examples you will find still use the old names.
- **Batching is moving into the exporter.** `batch` is still the last item in the recommended order, but the guidance now prefers the exporter's own batching where it exists (`sending_queue::batch`, off by default). A `queue_batch` processor meant to replace `batch` arrived in v0.158.0 at *development* stability and is not in any distribution yet.
- **Distributions.** The project publishes `otelcol` (core, a small set of components), `otelcol-contrib` (everything, about 240 components), `otelcol-k8s`, `otelcol-otlp` (OTLP in and out, nothing else), `otelcol-ebpf-profiler` and, new in v0.162.0 and still experimental, `otelcol-prometheus` (a few Prometheus exporters embedded as metrics receivers). The pipeline in the diagram needs contrib or k8s, since `tail_sampling`, `k8s_attributes` and `redaction` are not in core. For production, build your own with the OpenTelemetry Collector Builder (`ocb`): a manifest lists the components and the result is a smaller binary with a smaller attack surface. Many vendors ship distributions of their own.
- **Memory limiter settings.** Check every second (`check_interval: 1s`), give it a hard limit below the container's limit, in MiB or as a percentage, and leave the spike allowance near its default of 20%. The limiter's documentation also recommends setting `GOMEMLIMIT` to 80% of the Collector's hard memory limit, so that the Go runtime collects garbage more aggressively before the process gets there.
- **Kubernetes, as an example.** The OpenTelemetry Operator manages Collectors through an `OpenTelemetryCollector` resource whose `mode` is `deployment` (the default), `daemonset`, `statefulset` or `sidecar`. A common shape is a DaemonSet of agents for node logs, kubelet and host metrics and local OTLP; a Deployment of gateways behind a Service; and a StatefulSet for Prometheus scraping, with the operator's Target Allocator spreading scrape targets over the replicas. Sidecar mode injects a Collector into pods that carry the `sidecar.opentelemetry.io/inject` annotation, which suits platforms where you cannot run a per-node agent. The operator can also inject auto-instrumentation, and Helm charts exist for both the Collector and the operator.
- **Security.** Since v0.110.0 the Collector's servers bind to `localhost` by default; in a pod, bind receivers to the pod's IP rather than `0.0.0.0`. Turn on TLS for receivers and exporters (a `client_ca_file` on the receiver makes it mutual), and authenticate with the authenticator extensions: bearer token and basic auth for either side, OIDC for receivers, OAuth2 client credentials for exporters. Keep backend API keys out of the file with `${env:NAME}` and out of the agents by holding them in the gateway. Run as a non-root user with the narrowest RBAC that the processors need.
- **Keep secrets out of telemetry.** The first line of defence is not to record them: no tokens, passwords or full request bodies in span attributes and log lines. The pipeline is the second line. An allow-list catches what a developer adds next month; a block-list only catches what you thought of.
- **Cost control.** Volume is the bill. Sample traces (head sampling for volume, tail sampling for the traces worth keeping), drop logs and spans nobody reads with `filter`, and remove high-cardinality attributes from metrics, where every distinct combination of attribute values is a separate time series. A user ID as a metric attribute multiplies every series by the number of users.
- **Watch the Collector itself.** It serves its own metrics in Prometheus format on port 8888 and can push them over OTLP. Alert when `otelcol_exporter_queue_size` approaches `otelcol_exporter_queue_capacity`, and on `otelcol_exporter_send_failed_*`, `otelcol_exporter_enqueue_failed_*` and `otelcol_receiver_refused_*`. Scale stateless gateways out on those signals with an [autoscaler](../autoscaling/), but not when the backend is the bottleneck: more Collectors only push harder on a backend that is already slow.
- **Alternatives, as examples.** A vendor's own agent collects for one backend and is the simplest choice if you will stay with that vendor; several vendors also publish their own distribution of the Collector. General-purpose pipeline tools such as Fluent Bit and Vector have OpenTelemetry inputs and outputs as well. The Collector is the natural choice when the applications already speak OTLP and you want the three signals in one process that no backend vendor owns.
- **Related patterns.** [Distributed tracing](../distributed-tracing/) explains the spans this pipeline carries, and [SLOs and error budgets](../slo-error-budgets/) what to do with the metrics. A [service mesh](../service-mesh/) is another source: its proxies emit traces, metrics and access logs that a Collector can receive.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Distributed Tracing](../distributed-tracing/) — Propagate a trace context across services and assemble the spans into one timeline.
- [Centralized Logging](../centralized-logging/) — Ship structured logs from every service to one searchable store, correlated by request ID.
- [SLOs & Error Budgets](../slo-error-budgets/) — Measure SLIs against an objective and alert on error-budget burn rate, not on every blip.
- [Service Mesh](../service-mesh/) — Sidecar proxies plus a control plane: mTLS, retries and traffic shifting without touching app code.
- [Sidecar](../sidecar/) — Run helper capabilities (proxy, logging, config) in a separate process next to the app.
- [Queue-Based Load Leveling](../queue-based-load-leveling/) — A queue absorbs traffic spikes so the backend can work at a steady pace.
- [Microservices](../microservices/) — Small, independently deployable services, each owning one business capability and its data.

## References

- [OpenTelemetry — Collector](https://opentelemetry.io/docs/collector/)
- [OpenTelemetry — Collector architecture](https://opentelemetry.io/docs/collector/architecture/)
- [OpenTelemetry — Collector configuration](https://opentelemetry.io/docs/collector/configuration/)
- [OpenTelemetry — Deploy the Collector (no Collector, agent and gateway patterns)](https://opentelemetry.io/docs/collector/deploy/)
- [OpenTelemetry — Agent-to-gateway deployment pattern](https://opentelemetry.io/docs/collector/deploy/other/agent-to-gateway/)
- [OpenTelemetry — Scaling the Collector](https://opentelemetry.io/docs/collector/scaling/)
- [OpenTelemetry — Collector resiliency](https://opentelemetry.io/docs/collector/resiliency/)
- [OpenTelemetry — Collector distributions](https://opentelemetry.io/docs/collector/distributions/)
- [OpenTelemetry — Collector internal telemetry](https://opentelemetry.io/docs/collector/internal-telemetry/)
- [OpenTelemetry — OTLP Specification](https://opentelemetry.io/docs/specs/otlp/)
- [OpenTelemetry — Specification Status Summary](https://opentelemetry.io/docs/specs/status/)
- [OpenTelemetry — OpenTelemetry Profiles Enters Public Alpha (blog, March 2026)](https://opentelemetry.io/blog/2026/profiles-alpha/)
- [OpenTelemetry Collector — Processors: recommended processors and their order](https://github.com/open-telemetry/opentelemetry-collector/blob/main/processor/README.md)
- [OpenTelemetry Collector — Memory Limiter Processor](https://github.com/open-telemetry/opentelemetry-collector/blob/main/processor/memorylimiterprocessor/README.md)
- [OpenTelemetry Collector — Batch Processor](https://github.com/open-telemetry/opentelemetry-collector/blob/main/processor/batchprocessor/README.md)
- [OpenTelemetry Collector — Exporter Helper (sending queue, retry, persistent queue)](https://github.com/open-telemetry/opentelemetry-collector/blob/main/exporter/exporterhelper/README.md)
- [OpenTelemetry Collector Contrib — Tail Sampling Processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/tailsamplingprocessor/README.md)
- [OpenTelemetry Collector Contrib — Load Balancing Exporter](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/exporter/loadbalancingexporter/README.md)
- [OpenTelemetry Collector Contrib — Kubernetes Attributes Processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/k8sattributesprocessor/README.md)
- [OpenTelemetry Collector Contrib — Redaction Processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/redactionprocessor/README.md)
- [OpenTelemetry — Transforming telemetry](https://opentelemetry.io/docs/collector/transforming-telemetry/)
- [OpenTelemetry — Sampling](https://opentelemetry.io/docs/concepts/sampling/)
- [OpenTelemetry — Resource semantic conventions](https://opentelemetry.io/docs/specs/semconv/resource/)
- [OpenTelemetry — Handling sensitive data](https://opentelemetry.io/docs/security/handling-sensitive-data/)
- [OpenTelemetry — Collector configuration best practices](https://opentelemetry.io/docs/security/config-best-practices/)
- [OpenTelemetry — OpenTelemetry Operator for Kubernetes](https://opentelemetry.io/docs/platforms/kubernetes/operator/)
- [CNCF — OpenTelemetry project page](https://www.cncf.io/projects/opentelemetry/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
