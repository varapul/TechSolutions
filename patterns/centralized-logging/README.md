<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔭 Observability & Operations](../../README.md#observability--operations)

# Centralized Logging

> Ship structured logs from every service to one searchable store, correlated by request ID.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Centralized Logging" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/centralized-logging.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Scattered logs** | The payment for order 8123 failed, and the request passed through three services on two nodes. Every instance writes free text, each service in its own format, to a file of its own, so the on-call engineer opens one machine after another and searches for the order number with `grep`. Before the search reaches Payments, a deployment replaces `payments-2`, and the one line that says why the charge failed is deleted together with the instance. |
| **2 · Structured and shipped** | Each service now writes **structured** events to standard output and nothing else: a timestamp, a level, the service name, a message, the order ID and the request's trace ID, as named fields instead of a sentence. The platform keeps that stream in files on the node, and one **agent per node** reads them, adds what a service cannot reliably know about itself (instance, node, environment) and ships the result to the central store. No service holds the store's address or credentials, so the store can change without a change to application code. |
| **3 · One query, one request** | The gateway starts a trace, every call passes its ID on in the W3C `traceparent` header (`4bf92f…`, the same ID as in the distributed tracing diagram), and each service writes that ID into every line as `trace_id`. One search for that value returns the lines of Gateway, Orders and Payments in time order, whichever instance wrote them, and shows that the charge timed out in Payments three seconds after the request arrived. Because the fields are named, a second query counts the errors of the last hour per service without parsing any text. |
| **4 · Affordable and safe** | The bill follows the volume, so decide on the node what is worth shipping: the agent drops `DEBUG` lines, keeps one in ten of the routine `INFO` lines and every warning and error, and masks a card number before the line leaves the node. The store keeps lines searchable for 14 days, archives them to cheap storage for 12 months and then deletes them. When the store is unavailable, each agent holds the lines in its **buffer** and retries, so delivery is late while the services, which only write to standard output, keep running. A buffer is finite: an outage that outlasts it still loses lines. |
<!-- END GENERATED: header -->

## The problem

A request in a system of services leaves a few log lines in every service it passes through, and each service runs as several instances. When the request fails, its story is spread over files on different machines, written in a different format by each service, and nothing in the lines says that they belong together. Finding them means opening one machine after another, searching each file, and guessing from timestamps which lines go with which.

The files are not safe where they are, either. An instance is replaced by every deployment, removed by every scale-in and lost with every failed node, and its local log goes with it. The Kubernetes documentation spells it out for evictions: when a pod is evicted from a node, its containers go, and their logs go with them. Even while a pod lives, the kubelet rotates a container's log at 10 MiB and keeps five files by default, and `kubectl logs` returns only the newest of them. The lines you need most are often the last ones an instance wrote before it disappeared.

Centralized logging moves the lines off the instances as they are written, into one store that outlives all of them and that a single query can search.

## How it works

1. **Each service writes structured events to standard output.** One event per line, with named fields instead of a sentence: when it happened, how severe it is, which service wrote it, what happened, and the ID of the request it happened in. The service does not open log files, rotate them or know where the lines end up.
2. **The platform captures the stream.** A container runtime writes each container's stdout and stderr to files on the node.
3. **A collector ships it.** An agent on every node follows those files, parses the lines, adds where they came from (instance, node, environment), buffers them and sends them on in batches. It is the only component that talks to the store.
4. **A central store keeps and indexes the events** for as long as the retention rules say, and answers queries over all services at once: every line of one request, every error of one service, a count per version.

### Logs, metrics and traces

The three signals answer different questions, and each is the wrong tool for the other two.

| Signal | What it holds | Ask it | Weak at |
|---|---|---|---|
| **Logs** | Discrete events, each with its own detail | What exactly happened to this request, this order, this user? | Trends and rates: counting means reading every line. Usually the largest signal by volume |
| **Metrics** | Numbers aggregated over time | How many, how fast, how often? Is it getting worse? | Explaining one case: the detail was aggregated away |
| **Traces** | The calls of one request, with their timing and their parents | Where did the time go, and which call failed? | Detail inside a step, and requests that were not sampled |

Alert on metrics, find the place with a trace, read the reason in the logs. [SLOs and error budgets](../slo-error-budgets/) cover the first and [distributed tracing](../distributed-tracing/) the second. The signals are joined by shared identifiers, above all the trace ID, which is why step 3 logs it.

### Structured logging and field names

A free-text line has to be taken apart with a regular expression before anything can be done with it, and every format needs its own expression. A structured event carries its fields by name:

```json
{"time":"2026-10-02T14:02:07.140Z","level":"ERROR","service":"payments","message":"charge timed out","trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","order_id":8123,"duration_ms":3000}
```

- **One event, one line, usually JSON.** Keep the message constant (`charge timed out`) and put everything that varies in fields (`order_id`, `duration_ms`). Constant messages can be grouped and counted; a sentence with the order number inside it cannot.
- **JSON alone is not structure.** OpenTelemetry's documentation draws the line: a JSON line without a stable schema is only semi-structured. Logs become queryable across services when the same thing has the same name and type everywhere.
- **Borrow a schema instead of inventing one.** The OpenTelemetry log data model, which is stable, defines a record as `Timestamp`, `ObservedTimestamp`, `TraceId`, `SpanId`, `TraceFlags`, `SeverityText`, `SeverityNumber`, `Body`, `Resource`, `InstrumentationScope`, `Attributes` and `EventName`, and the semantic conventions name the attributes: `service.name`, `service.instance.id`, `deployment.environment.name`. A vendor schema works the same way: the Elastic Common Schema (ECS) has `@timestamp`, `log.level`, `message`, `service.name` and `trace.id`. Elastic donated ECS to OpenTelemetry in April 2023, with the declared aim of converging the two.
- **Make levels comparable.** The data model maps every library's levels onto a `SeverityNumber` from 1 to 24 in six ranges: TRACE 1–4, DEBUG 5–8, INFO 9–12, WARN 13–16, ERROR 17–20 and FATAL 21–24. Syslog (RFC 5424) counts the other way, from 0 (emergency) to 7 (debug). Agree on what each level means as well: an ERROR that nobody has to act on is a WARN.
- **Enforce it in one place.** A shared logging module that sets the field names, adds the service name and version and reads the trace context does more than a convention document.

The diagram uses short names (`time`, `level`, `service`, `message`, `order_id`, `trace_id`, and `instance`, `node`, `env` from the agent) to stay readable. Map them to the names of the schema you choose.

### Logs as an event stream

The Twelve-Factor App's rule for logs is that a process does not route or store its own output. It writes its events, unbuffered, to standard output, and the environment it runs in captures the stream and sends it wherever it has to go. Three things follow:

- The service has no log files to name, rotate or fill a disk with, and no client library for a log store.
- The same code logs to a terminal on a laptop and to the central store in production.
- Where the logs go is a deployment decision. The store, the vendor and the retention rules can change without a release of any service.

On Kubernetes the capture is done by the container runtime, which writes each container's output to files under `/var/log/pods` on the node in the CRI logging format (a timestamp, the stream name, a tag and the line), and by the kubelet, which rotates those files.

### Collection topologies

| Topology | How it works | Why choose it | What it costs |
|---|---|---|---|
| **Agent per node** (the diagram) | One agent on every node, on Kubernetes a DaemonSet, follows the log files of every container on that node | One agent per node, and no change to any application | It only sees what goes to stdout and stderr, and one agent configuration serves every workload on the node |
| **Sidecar per instance** | A second container next to the application either copies a log file to its own stdout, where the node agent picks it up, or runs a full agent of its own | Applications that can only write files; parsing rules or destinations that differ per application | An agent in every pod uses far more resources than one per node. Lines shipped by a sidecar agent are not visible to `kubectl logs`, and a file that is copied to stdout is stored twice on the node |
| **Direct from the application** | The logging library sends events over the network, for example as OTLP, to a collector or to the store | No file parsing, and full structure and trace context from the start. It also works where there is no node to put an agent on | The application now depends on the pipeline. It needs a bounded queue that never blocks, and whatever is still in that queue when the process crashes is lost, which is when the lines matter most |
| **Collector tier** | Agents or applications send to a central pool of collectors that do the heavy processing and hold the store's credentials | One place for redaction, sampling and routing to several stores; the agents stay small | Another tier to run and to scale |

These combine. A common layout is node agents that forward to a collector tier: the two tiers described in [telemetry pipeline](../telemetry-pipeline/). The second row is an instance of the [sidecar](../sidecar/) pattern.

### Correlation IDs and trace context

- **One ID per request, created at the edge.** The first component to see a request, usually the [API gateway](../api-gateway/), continues the caller's trace context or starts a new one, and every service passes it on with each call it makes.
- **Use the trace ID rather than a home-made request ID.** The W3C Trace Context header is `traceparent: version-traceid-parentid-flags`. The trace ID is 32 hexadecimal characters and stays the same for the whole request; the parent ID is 16 and changes on every hop.
- **Write it into every line.** An OpenTelemetry log record has `TraceId`, `SpanId` and `TraceFlags` fields. For other formats the specification asks for top-level fields called `trace_id`, `span_id` and `trace_flags`, in lowercase hexadecimal. OpenTelemetry's integrations with logging libraries fill them in from the active span, so application code does not pass IDs around.
- **Then one value joins everything.** A search for the trace ID returns the request's lines from every service (step 3), and the same ID opens its trace, so you can go from a slow span to the lines written inside it and back.
- **Log business identifiers as fields too**: order, tenant, job. People search by what a customer told them, which is rarely a trace ID. Returning the trace ID to the caller with an error gives support something to ask for.
- **Carry the context across queues.** For asynchronous work, put it in the message's headers so that the consumer's lines join the same trace.

### Multi-line messages

A stack trace is one event printed on many lines. A collector that reads line by line turns it into dozens of events with no level and no trace ID, mixed in with the lines of other requests.

- **Fix it at the source if you can.** A structured logger writes the stack trace as one field of one JSON line.
- **Otherwise join the lines in the agent**, with a rule that recognises the first line of an event. Fluent Bit ships multiline parsers for Go, Java, Python and Ruby and lets you define your own; the OpenTelemetry Collector's filelog receiver takes a `multiline` block with a `line_start_pattern` or a `line_end_pattern`.
- **Long lines are split by the runtime.** The CRI format tags each stored line as partial (`P`) or full (`F`), and the agent has to put the partial ones back together. Fluent Bit's built-in `cri` and `docker` parsers do that.

### Clocks and time zones

- **Timestamps in UTC, in RFC 3339 form** (`2026-10-02T14:02:07.140Z`), with at least milliseconds, set by the service at the moment of the event. Local times without an offset cannot be ordered across regions or across a change to daylight saving time.
- **Order across hosts is only as good as the clocks.** Synchronise every machine (OWASP's logging guidance asks for it), and still do not read cause and effect from two timestamps a millisecond apart on different hosts. The parent and child spans of a trace give the real order.
- **Keep two timestamps.** OpenTelemetry separates `Timestamp`, when the event happened by the source's clock, from `ObservedTimestamp`, when the collector saw it. Sort and search by the first. The difference between them is the delivery delay, which is the number to watch in step 4: buffered lines arrive minutes late and still belong at their original place.

### Two kinds of store

How much a store indexes when a line arrives decides what ingestion costs and what a query costs.

| | Index everything | Index only labels |
|---|---|---|
| **Examples** | Elasticsearch, OpenSearch | Grafana Loki |
| **At ingestion** | Fields are indexed, and text is split into terms. New fields are mapped and indexed automatically unless you say otherwise | A few labels identify a stream: service, environment, level. The lines are compressed into chunks and written to object storage without an index of their content |
| **A query** | Looks terms up in the index: any field, any word, with aggregations | Selects streams by label and time, then reads their chunks and filters them |
| **Fast when** | Nearly always, at the price below | Labels and the time range narrow the search to little data |
| **Costly when** | Volume grows: the index takes disk, memory and CPU while writing | One rare value is searched for across every stream and a long period |
| **The trap** | A mapping explosion. Every new JSON key is a new field (the default limit is 1,000 per index), and the same key with two types is a conflict | High-cardinality labels. A label per user or per request creates a stream for each, a huge index and thousands of tiny chunks |
| **Lifecycle** | Index lifecycle management moves indices through hot, warm, cold and frozen phases and deletes them; OpenSearch has Index State Management policies | Retention is applied by the compactor, per tenant or per stream. It is off by default, so lines are kept forever |

Details worth knowing, as documented in October 2026:

- **Elasticsearch** maps a new string field as `text` with a `keyword` sub-field by default, so it is indexed twice: once for full-text search and once for exact matches and aggregations. Its `logsdb` index mode, the default for new `logs-*-*` data streams since version 9.0, stores log data more compactly: Elastic reports up to 60% less storage in its benchmarks, for indexing that is 10–20% slower. The frozen tier holds partially mounted searchable snapshots, which keeps old data searchable, slowly, without keeping it on fast disks.
- **Loki** has a default limit of 15 index labels, and its documentation recommends 10 to 15 at most, with values that are bounded and long-lived. High-cardinality values that you still want to filter on, such as a pod name or a trace ID, go into structured metadata, which is stored with the line and not indexed.
- **Cloud logging services** hide the index and sell tiers instead. Amazon CloudWatch Logs has a Standard log class and an Infrequent Access class with a subset of the features; ingestion is the only charge that differs between the two, and a log group's class cannot be changed after it is created. Azure Monitor Logs has Analytics, Basic and Auxiliary table plans. Google Cloud Logging routes every entry through sinks with inclusion and exclusion filters into log buckets.

### What it costs, and the controls

The bill follows three things: the volume ingested, how much of it is indexed, and how long it is kept. Google Cloud Logging shows the usual shape (prices as of October 2026): $0.50 per GiB streamed into a log bucket, which includes 30 days of storage, with the first 50 GiB per project per month free, and $0.01 per GiB per month for anything kept longer. Ingestion dominates, and a line costs the same whether or not anyone ever reads it.

So the controls work on volume first:

- **Levels.** Run production at INFO, and make DEBUG something you switch on for one service, for a limited time.
- **Fewer, wider events.** One line per request per service with twenty fields is cheaper and more useful than ten lines with two fields each.
- **Sampling.** Keep every warning and error and a fraction of the routine successes, such as health checks and `200` responses. Vector has a `sample` transform; the OpenTelemetry Collector's probabilistic sampler (alpha for logs) can decide by trace ID, which keeps the lines of a sampled trace together. Record the rate, or every count made from the sample is wrong.
- **Drop before you ship.** A filter in the agent or the collector removes lines that nobody queries: the OpenTelemetry Collector's filter processor (alpha) drops log records that match a condition such as `log.severity_number < SEVERITY_NUMBER_WARN`. Dropping at the store is the fallback. A Cloud Logging exclusion filter keeps an entry out of a bucket, but it is applied after the API has received the entry, so the entry still counts against the write quota.
- **Tiered retention.** Keep lines searchable for days or weeks, archive them cheaply for months and delete them on schedule: the ladder in the diagram. A CloudWatch Logs log group keeps its events forever unless you set a retention period, between one day and ten years. Azure Monitor keeps most tables available for interactive queries for 30 days by default and for up to two years, and in low-cost long-term retention for up to 12 years in total. Cloud Logging's `_Default` bucket keeps entries for 30 days, and a bucket in a project can be set to anything from 1 to 3,650 days.
- **Retention per stream.** Noisy, low-value streams get days; audit trails get years (see below).
- **A budget per team.** Publish the volume per service and level, and alert on a sudden rise: a retry loop that logs a stack trace on every attempt multiplies a service's volume within minutes.

### Sensitive data

A central store is a second copy of whatever the services logged, and it is readable by far more people than the production database.

- **Never log** passwords, access tokens, session identifiers, encryption keys, database connection strings, payment card data or sensitive personal data. The OWASP Logging Cheat Sheet has the full list, and says that where an event has to refer to such a value it should be removed, masked, sanitised, hashed or encrypted.
- **Redact at the source.** Log named fields from an allow-list, never whole request bodies, headers or objects. The service is the only place that knows what a value is.
- **Redact in the pipeline as a safety net**, like the masked card number in step 4. The OpenTelemetry Collector's redaction processor (alpha for logs) deletes attributes that are not on an allow-list and masks values that match blocked patterns. CloudWatch Logs data protection policies mask matching data wherever it leaves the service, and only principals with the `logs:Unmask` permission see the original. A pattern finds card numbers; it does not find a secret nobody wrote a pattern for.
- **Restrict and record access.** Scope read access by team and environment, record who searched for what, and encrypt the lines in transit and at rest.
- **Treat log content as untrusted input.** User-supplied text with line breaks in it can forge entries in a line-based log. Structured encoding escapes them, and OWASP asks for carriage returns and line feeds to be sanitised.
- **Retention is a privacy control too.** A line that was deleted on schedule cannot leak later.

### Reliability of the pipeline

Lines wait in four places on their way to the store, and each has a limit.

| Where | What holds the lines | What is lost when it fails |
|---|---|---|
| **The node's log files** | The runtime's files, rotated by size: 10 MiB and five files per container by default on Kubernetes | Everything not yet shipped when the node dies or the pod is removed, and whatever was rotated away while the agent was down or behind |
| **The agent's position** | A checkpoint of how far each file has been read | Without one, a restarted agent reads files again or skips them. Fluent Bit's tail input keeps offsets in a database file (`db`); the OpenTelemetry filelog receiver needs a storage extension |
| **The agent's buffer** | Memory, or memory backed by disk | A memory buffer dies with the agent. A disk buffer survives a restart and has a size limit |
| **The store's intake** | Rate limits and queues of its own | Whatever the agent gives up on after its retries |

- **Decide what happens when a buffer is full: block or drop.** Fluent Bit pauses an input that reaches `mem_buf_limit`; with filesystem buffering, an output that reaches `storage.total_limit_size` discards its oldest chunk. Vector's buffers block by default (`when_full: block`), which pushes back on whatever feeds them, and can be set to drop the newest event instead.
- **Back-pressure must never reach the request path.** With an agent that follows files, a stalled store only stops the agent from reading further (step 4), and the service keeps writing to stdout. Where the runtime or the application delivers the lines itself, look at the delivery mode. Docker delivers from the container to its logging driver in blocking mode by default; `mode=non-blocking` puts a per-container buffer in between (1 MB by default) and drops messages when it is full. For diagnostic logs, dropping is usually the right way to fail.
- **Expect duplicates and late arrivals.** Retries make delivery at-least-once, and buffered lines arrive out of order.
- **Watch the pipeline with metrics, not with its own logs**: buffer usage, retries, dropped records, and the delay between event time and arrival, per agent. [Telemetry pipeline](../telemetry-pipeline/) covers queues, retries and memory limits in a collector.
- **Do not keep facts that must not be lost in logs.** Orders, billing records and state changes belong in a database or in an event stream with delivery guarantees.

### Alerting: logs or metrics

- **Alert on symptoms with metrics** and SLO burn rates ([SLOs and error budgets](../slo-error-budgets/)), and use the logs to explain the alert.
- **A log-based alert fits an event that has no metric**: one specific error message, a security event, a line that must never appear. Turn the query into a metric and alert on that. Loki's ruler evaluates alerting and recording rules, Cloud Logging has log-based metrics (counters and distributions), and CloudWatch Logs has metric filters.
- **Know the limits.** Such an alert is only as timely as the pipeline, it is blind to lines that were sampled or dropped, and every evaluation is a query over stored data.
- **When the same line is counted every minute**, emit a metric from the code and drop the line.

### Audit logs are a different stream

An audit log records who did what, to what, and when. Its rules are the opposite of step 4's: nothing is sampled or dropped, records must be tamper-evident, retention is set by regulation and measured in years, and few people may read it. Keep it in a separate stream with its own store, access rules and retention.

- Google Cloud's Admin Activity audit logs are always written and cannot be disabled or excluded. They go to the `_Required` bucket, whose retention is fixed at 400 days.
- AWS CloudTrail can validate log file integrity: it hashes every log file with SHA-256 and delivers a digest file every hour, signed with RSA, so that a changed or deleted file is detected.
- OWASP's guidance for stored logs applies in full here: build in tamper detection, copy records to read-only media as soon as possible, and record every access.

## When to use it

- **As soon as instances are disposable, or there is more than one of them**: containers, autoscaling groups, functions. That is nearly every production system.
- **[Microservices](../microservices/)**, where no single service sees a whole request.
- **When someone other than the author has to debug.** On-call engineers and support need one place to look, without shell access to production machines.
- **When logs have to outlive the machines**, for security investigations or because a regulation says so.

It does not answer every question:

- **"Where did the time go?"** is a question for a trace ([distributed tracing](../distributed-tracing/)).
- **"Is the service healthy, and since when?"** is for metrics and health checks ([health endpoint monitoring](../health-endpoint-monitoring/)).
- **A single process on one long-lived host** can live with local files and `grep`, as long as losing the host does not also lose the evidence of why.

## Trade-offs

- **Cost grows with traffic and verbosity, not with value.** Most lines are never read, and every one of them is paid for when it is ingested.
- **It is another production system.** Agents on every node, a pipeline and a store need capacity planning, upgrades and monitoring of their own, or a vendor who is paid by volume.
- **A central store is a central target.** Everything every service ever logged is in one place, and a secret in one line is readable by everyone who can search.
- **A schema needs agreement.** Field names only help if every team uses them, and that takes a shared library and review.
- **Delivery is best-effort and late.** Lines can be lost at every stage and arrive seconds to minutes after the event. Decisions that need certainty should not read logs.
- **Indexing less is cheaper to write and slower to search.** The two store designs move cost between ingestion and query time; neither makes a large daily volume cheap.
- **Sampling and dropping change the numbers.** Counts made from sampled lines are wrong unless the rate is applied, and one day the dropped DEBUG line is the one you want.

## Implementation notes

- **Structured loggers.** Most ecosystems have one in or near the standard library: `log/slog` in Go, the JSON Template Layout in Log4j 2, the JSON console formatter in .NET (`AddJsonConsole`), `structlog` in Python, `pino` in Node.js. Wrap it once, so that every service gets the same field names, the service name and version, and the trace context.
- **Agents and collectors.** Fluent Bit, Vector and the OpenTelemetry Collector all follow files, parse, enrich, buffer and ship. On Kubernetes, run the agent as a DaemonSet with the node's log directory mounted read-only. In the OpenTelemetry Collector the pieces are the filelog receiver (beta) and the Kubernetes attributes processor (stable), which looks pods up through the Kubernetes API and adds their name, namespace and labels. Fluent Bit's Kubernetes filter does the same. If you ship to Loki, use Grafana Alloy: Promtail reached end of life on 2 March 2026.
- **Keep the application ignorant.** No store address, API key or vendor library in service code. That is what makes the store replaceable.
- **Give the agent a checkpoint and a disk buffer**, and size the buffer for the outage you intend to survive: lines per second × bytes per line × seconds of outage.
- **Cut the noise first**: probe requests ([health endpoint monitoring](../health-endpoint-monitoring/)), load balancer pings and per-item lines inside loops.
- **Write retention down as configuration**, per stream, next to the pipeline's configuration. Elasticsearch has index lifecycle policies and a simpler data stream lifecycle, OpenSearch has ISM policies, Loki has compactor retention, and the cloud services have a retention setting per log group, bucket or table.
- **Rehearse.** Delete a pod and check that its last lines reached the store. Block the store and watch the buffers fill and drain. Follow one trace ID from the gateway to the last service. Search the store for card-number and token patterns on a schedule.

### Common mistakes

- **Everything at one level.** If every line is INFO, levels cannot be used to filter or to drop, and if handled exceptions are logged as ERROR, the error count means nothing.
- **High-cardinality labels or index fields.** A user ID as a Loki label, or JSON keys that embed an ID in Elasticsearch, hurt the whole store and not just one query. Put such values in the line, or in structured metadata.
- **Logs where a metric would do.** Counting requests, measuring latency or tracking queue depth by parsing lines costs a stored line per data point. Emit a counter or a histogram.
- **The same error logged at every layer.** One failure becomes five stack traces. Log it where it is handled, and let the trace ID connect the rest.
- **Free text with the data inside.** `payment for order 8123 failed after 3000 ms` cannot be grouped; `payment failed` with `order_id` and `duration_ms` can.
- **Request and response bodies in the log.** It is the fastest way to put personal data and secrets into the store.
- **No trace context in background work.** Jobs, consumers and scheduled tasks need one too, or their lines cannot be joined to anything.
- **Using the log store as the record of what happened.** Audit trails and business facts need the guarantees described above.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Distributed Tracing](../distributed-tracing/) — Propagate a trace context across services and assemble the spans into one timeline.
- [Telemetry Pipeline (OpenTelemetry)](../telemetry-pipeline/) — Receive, process and export traces, metrics and logs through one vendor-neutral collector.
- [SLOs & Error Budgets](../slo-error-budgets/) — Measure SLIs against an objective and alert on error-budget burn rate, not on every blip.
- [Sidecar](../sidecar/) — Run helper capabilities (proxy, logging, config) in a separate process next to the app.
- [Health Endpoint Monitoring](../health-endpoint-monitoring/) — Expose liveness and readiness checks that load balancers and monitors probe.
- [Microservices](../microservices/) — Small, independently deployable services, each owning one business capability and its data.
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.

## Related components and services

- [Elasticsearch & OpenSearch](../elasticsearch/) — Search engines built on inverted indexes: full-text queries ranked by relevance, and aggregations over sharded indexes.
- [Prometheus & Grafana](../prometheus/) — Pull-based monitoring: scrape metrics into a time-series database, query them with PromQL, alert, and chart them in Grafana.
- [Amazon CloudWatch](../amazon-cloudwatch/) — Metrics, logs, alarms and dashboards for AWS resources and your applications, in one monitoring service.

## References

- [The Twelve-Factor App — XI. Logs](https://12factor.net/logs)
- [Chris Richardson — Pattern: Log aggregation (microservices.io)](https://microservices.io/patterns/observability/application-logging.html)
- [OpenTelemetry — Logs (structured, semi-structured and unstructured logs)](https://opentelemetry.io/docs/concepts/signals/logs/)
- [OpenTelemetry specification — OpenTelemetry Logging (collection from files, stdout and directly over OTLP)](https://opentelemetry.io/docs/specs/otel/logs/)
- [OpenTelemetry specification — Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/)
- [OpenTelemetry specification — Trace Context in non-OTLP Log Formats](https://opentelemetry.io/docs/specs/otel/compatibility/logging_trace_context/)
- [OpenTelemetry semantic conventions — Service attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/service/)
- [OpenTelemetry semantic conventions — Deployment attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/deployment/)
- [W3C — Trace Context (Recommendation)](https://www.w3.org/TR/trace-context/)
- [OWASP Cheat Sheet Series — Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [Kubernetes documentation — Logging Architecture](https://kubernetes.io/docs/concepts/cluster-administration/logging/)
- [Kubernetes documentation — DaemonSet](https://kubernetes.io/docs/concepts/workloads/controllers/daemonset/)
- [Kubernetes design proposal — CRI: Log management for container stdout/stderr streams](https://github.com/kubernetes/design-proposals-archive/blob/main/node/kubelet-cri-logging.md)
- [Docker documentation — Configure logging drivers (blocking and non-blocking delivery)](https://docs.docker.com/engine/logging/configure/)
- [Fluent Bit manual — Buffering](https://docs.fluentbit.io/manual/data-pipeline/buffering)
- [Fluent Bit manual — Backpressure](https://docs.fluentbit.io/manual/administration/backpressure)
- [Fluent Bit manual — Tail input (offsets database)](https://docs.fluentbit.io/manual/data-pipeline/inputs/tail)
- [Fluent Bit manual — Multiline parsing](https://docs.fluentbit.io/manual/data-pipeline/parsers/multiline-parsing)
- [Fluent Bit manual — Kubernetes filter](https://docs.fluentbit.io/manual/data-pipeline/filters/kubernetes)
- [Vector documentation — Buffering model](https://vector.dev/docs/architecture/buffering-model/)
- [Vector documentation — Sample transform](https://vector.dev/docs/reference/configuration/transforms/sample/)
- [OpenTelemetry — Important Components for Kubernetes (filelog receiver, Kubernetes attributes processor)](https://opentelemetry.io/docs/platforms/kubernetes/collector/components/)
- [OpenTelemetry Collector Contrib — File Log Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/receiver/filelogreceiver/README.md)
- [OpenTelemetry Collector Contrib — Filter Processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/filterprocessor/README.md)
- [OpenTelemetry Collector Contrib — Probabilistic Sampling Processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/probabilisticsamplerprocessor/README.md)
- [OpenTelemetry Collector Contrib — Redaction Processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/redactionprocessor/README.md)
- [Grafana Loki documentation — Loki overview](https://grafana.com/docs/loki/latest/get-started/overview/)
- [Grafana Loki documentation — Understand labels](https://grafana.com/docs/loki/latest/get-started/labels/)
- [Grafana Loki documentation — What is structured metadata](https://grafana.com/docs/loki/latest/get-started/labels/structured-metadata/)
- [Grafana Loki documentation — Log retention](https://grafana.com/docs/loki/latest/operations/storage/retention/)
- [Grafana Loki documentation — Alerting and recording rules](https://grafana.com/docs/loki/latest/alert/)
- [Grafana Loki documentation — Promtail agent (end-of-life notice)](https://grafana.com/docs/loki/latest/send-data/promtail/)
- [Elastic Docs — Index lifecycle management (ILM) in Elasticsearch](https://www.elastic.co/docs/manage-data/lifecycle/index-lifecycle-management)
- [Elastic Docs — Elasticsearch data tiers: hot, warm, cold and frozen](https://www.elastic.co/docs/manage-data/lifecycle/data-tiers)
- [Elastic Docs — Logs data streams (logsdb index mode)](https://www.elastic.co/docs/manage-data/data-store/data-streams/logs-data-stream)
- [Elastic Docs — Dynamic field mapping](https://www.elastic.co/docs/manage-data/data-store/mapping/dynamic-field-mapping)
- [Elasticsearch Reference — Mapping limit settings](https://www.elastic.co/docs/reference/elasticsearch/index-settings/mapping-limit)
- [Elastic Common Schema (ECS) reference](https://www.elastic.co/docs/reference/ecs)
- [Elastic Common Schema — ECS & OpenTelemetry](https://www.elastic.co/docs/reference/ecs/ecs-opentelemetry)
- [OpenSearch documentation — Index State Management](https://docs.opensearch.org/latest/im-plugin/ism/index/)
- [Amazon CloudWatch Logs User Guide — What is Amazon CloudWatch Logs?](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/WhatIsCloudWatchLogs.html)
- [Amazon CloudWatch Logs User Guide — Log classes](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CloudWatch_Logs_Log_Classes.html)
- [Amazon CloudWatch Logs User Guide — Help protect sensitive log data with masking](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/mask-sensitive-log-data.html)
- [Amazon CloudWatch Logs User Guide — Creating metrics from log events using filters](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/MonitoringLogData.html)
- [AWS CloudTrail User Guide — Validating CloudTrail log file integrity](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-log-file-validation-intro.html)
- [Google Cloud Logging — Route log entries (sinks, inclusion and exclusion filters)](https://docs.cloud.google.com/logging/docs/routing/overview)
- [Google Cloud Logging — Quotas and limits (retention periods)](https://docs.cloud.google.com/logging/quotas)
- [Google Cloud Logging — Log-based metrics overview](https://docs.cloud.google.com/logging/docs/logs-based-metrics)
- [Google Cloud Logging — Cloud Audit Logs overview](https://docs.cloud.google.com/logging/docs/audit)
- [Google Cloud Observability — Pricing](https://cloud.google.com/products/observability/pricing)
- [Microsoft Learn — Manage data retention in a Log Analytics workspace](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/data-retention-configure)
- [RFC 5424 — The Syslog Protocol](https://www.rfc-editor.org/rfc/rfc5424)
- [RFC 3339 — Date and Time on the Internet: Timestamps](https://www.rfc-editor.org/rfc/rfc3339)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
