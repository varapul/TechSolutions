<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔭 Observability & Operations](../../README.md#observability--operations)

# Distributed Tracing

> Propagate a trace context across services and assemble the spans into one timeline.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Distributed Tracing" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/distributed-tracing.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Start a trace** | The request reaches the **API Gateway** with no trace context, so the gateway starts a trace: it generates a random 16-byte **trace ID** (`4bf92f…`) and opens the **root span**. Its call to Orders carries a W3C `traceparent` header with the trace ID, the gateway's own span ID as the parent, and the *sampled* flag. Had the request arrived with a `traceparent`, the gateway would have continued that trace instead. |
| **2 · Propagate context** | Orders reads `traceparent` and opens a **child span**: same trace ID, a new span ID, the gateway's span as parent. Its database query is a client span that Orders records itself (and queues for export as soon as it ends), and its call to Payments carries a `traceparent` whose parent-id is now the Orders span. In the waterfall, children nest under their parents. |
| **3 · Export spans** | Open spans live in memory and are **queued when they end**. Each service's tracing SDK exports them asynchronously in batches, typically over OTLP, to a **collector** that forwards them to the tracing backend, where they arrive out of order. Export never sits on the request path, so it doesn't slow the response. |
| **4 · Find the bottleneck** | The backend groups the spans by trace ID and links them through their parent IDs into one **waterfall**, even though they arrived from three services at different times. It shows at a glance that Payments spent 180 ms of the 240 ms request, so that span's attributes and events are where to look next. |
<!-- END GENERATED: header -->

## The problem

A single user request now crosses a gateway, several services, a database and perhaps a queue. When it is slow or fails, each component's logs and metrics describe only its own slice: the gateway reports 240 ms, Orders looks slow, Payments looks busy, and nobody can say where the time actually went. Matching timestamps across hosts by hand doesn't scale, and clock skew makes it unreliable anyway.

## How it works

A **trace** records one request as a tree of **spans**. A span is one timed operation (an HTTP handler, an outgoing call, a query) with a name, start and end time, status, attributes and the ID of its parent span. The model comes from Google's Dapper paper (2010) and underlies Zipkin, Jaeger and OpenTelemetry. Tracing has two halves:

1. **Propagate the context in band.** The first instrumented component that sees a request without context starts a trace. Every outgoing call carries the context, and every receiver continues it. The standard wire format is W3C Trace Context:

   ```text
   traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
                │  │                                │                └ trace-flags: 01 = sampled
                │  │                                └ parent-id: the caller's span ID (8 bytes)
                │  └ trace-id: shared by every span in the trace (16 bytes)
                └ version
   tracestate:  rojo=00f067aa0ba902b7,congo=t61rcWkgMzE
   ```

   `traceparent` is the part every compliant tracer understands. `tracestate` carries vendor-specific entries alongside it, so several tracing systems can follow the same request. In practice the SDK also opens a *client* span for each outgoing call, so the callee's parent is that client span; the diagram folds client and server spans into one bar per service.

2. **Export spans out of band.** Each service's tracing SDK keeps open spans in memory. When a span ends it is queued, and a batch processor ships the queue in the background, typically over OTLP (the OpenTelemetry protocol) to a **collector**. The collector batches, filters, redacts and samples spans, then forwards them to one or more backends, which join them by trace ID and parent ID into the waterfall.

## When to use it

- Any request that crosses more than one process: microservices, serverless chains, service meshes, event-driven flows.
- Latency work (which hop owns the p99?), root-cause analysis (which call failed first?) and dependency mapping, since most backends derive a service graph from spans.
- Less valuable inside a single process with one database, where a profiler and good logs go further. Database spans still help there.
- Not a replacement for metrics: sampled traces can't give accurate rates or totals, so alert on metrics and use traces to explain them.

## Trade-offs

- **Gaps break the trace.** Any hop that drops the headers (an uninstrumented service, a proxy that strips unknown headers, a queue without message headers) splits one trace into two. Broad coverage matters more than deep coverage.
- **Tracing everything is expensive.** Every span costs CPU and memory in the service, network egress, collector capacity, and backend ingest and storage, which vendors often bill per span or per GB. At high request rates, traces can become your largest telemetry bill.
- **Head or tail sampling.** *Head sampling* decides at the root (for example, a parent-based, trace-ID-ratio sampler that keeps 10%) and passes the decision downstream in the sampled flag. It is cheap and consistent, but blind to the outcome, so it also drops 90% of the errors. *Tail sampling* decides in the collector once the trace is complete (keep every error, every trace over 500 ms and 1% of the rest). The price is a stateful tier that buffers whole traces and must receive every span of a trace, so spans are routed to it by trace ID.
- **Clock skew.** Span timestamps come from different hosts, so a child can appear to start before its parent. Durations measured inside one process are reliable; offsets between hosts are approximate.
- **Untrusted context.** A caller that sets the sampled flag on every request can make you record everything. The W3C spec suggests treating authenticated and unauthenticated requests differently and rate-limiting what you record. Many edges start a fresh trace for external traffic.

## Implementation notes

- **OpenTelemetry is the vendor-neutral default.** Each service uses the OpenTelemetry API and SDK with the W3C `tracecontext` and `baggage` propagators (the defaults) and exports OTLP to an OpenTelemetry Collector, deployed as an agent next to the workload, as a central gateway tier, or both. Adding or switching a backend (Jaeger, Grafana Tempo, Zipkin, AWS X-Ray, Google Cloud Trace, Azure Monitor or a commercial APM) then means changing collector configuration, not code.
- **Automatic vs manual instrumentation.** Zero-code agents and instrumentation libraries cover the plumbing: inbound and outbound HTTP and gRPC, database drivers, messaging clients, and injecting and extracting the headers. Manual instrumentation adds what only your code knows: spans around business steps, **attributes** you will filter by (`order.id`, `payment.provider`, using the semantic conventions where they exist), **events** for moments inside a span (a retry, a cache miss, an exception) and an error status on failure. OpenTelemetry is deprecating the span-event API (`AddEvent`, `RecordException`), so new code should emit events and exceptions through the Logs API, correlated with the current span; existing span events keep working.
- **Correlate logs and metrics.** Stamp `trace_id` and `span_id` on every log line (OpenTelemetry's logging integrations do this) so you can jump from a log to its trace and back. On metrics, **exemplars** attach the trace ID of a sample measurement to a histogram bucket, so a p99 spike on a dashboard links straight to a slow trace.
- **Crossing async boundaries.** For queues and topics, inject the context into the message headers: Kafka record headers, AMQP headers, SQS message attributes, or the CloudEvents distributed-tracing extension. The consumer extracts it and links its span to the producer's. Span links, rather than a parent, are the only option when one span processes a batch of messages. Within a process, make sure thread pools and callbacks carry the context along (instrumentation usually wraps executors).
- **Keep baggage small and harmless.** W3C `baggage` propagates key-value pairs to every downstream hop, including third-party APIs you call, and isn't added to spans unless you copy it there. Never put secrets, tokens or personal data in it, and strip it at trust boundaries. Span attributes need the same care: redact PII in code or in the collector.
- **Service meshes** (Envoy, Istio, Linkerd) can emit a span for every hop without code changes, but the application must still copy the trace headers from each inbound request onto its outbound calls. The proxy can't join them for you.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- Telemetry Pipeline (OpenTelemetry) *(planned)* — Receive, process and export traces, metrics and logs through one vendor-neutral collector.
- Centralized Logging *(planned)* — Ship structured logs from every service to one searchable store, correlated by request ID.
- [SLOs & Error Budgets](../slo-error-budgets/) — Measure SLIs against an objective and alert on error-budget burn rate, not on every blip.
- Service Mesh *(planned)* — Sidecar proxies plus a control plane: mTLS, retries and traffic shifting without touching app code.
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- [Microservices](../microservices/) — Small, independently deployable services, each owning one business capability and its data.
- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.

## References

- [W3C — Trace Context (Recommendation)](https://www.w3.org/TR/trace-context/)
- [OpenTelemetry — Traces](https://opentelemetry.io/docs/concepts/signals/traces/)
- [OpenTelemetry — Context propagation](https://opentelemetry.io/docs/concepts/context-propagation/)
- [OpenTelemetry — Sampling](https://opentelemetry.io/docs/concepts/sampling/)
- [OpenTelemetry — Collector](https://opentelemetry.io/docs/collector/)
- [OpenTelemetry — Semantic conventions for messaging spans](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/)
- [W3C — Baggage](https://www.w3.org/TR/baggage/)
- [Sigelman et al. — Dapper, a Large-Scale Distributed Systems Tracing Infrastructure (Google, 2010)](https://research.google/pubs/dapper-a-large-scale-distributed-systems-tracing-infrastructure/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
