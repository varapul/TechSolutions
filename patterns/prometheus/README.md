<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧱 System Components](../../README.md#system-components)

# Prometheus & Grafana

> Pull-based monitoring: scrape metrics into a time-series database, query them with PromQL, alert, and chart them in Grafana.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Prometheus &amp; Grafana" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/prometheus.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Acme Shop's Catalog service runs as three pods on Kubernetes, and each serves its metrics at `/metrics`. Prometheus discovers them, along with `node_exporter` and `kube-state-metrics`, through the Kubernetes API and **pulls** their metrics every 15 seconds (`scrape_interval: 15s`; the default is 1 minute). It stores the samples in its own time-series database, evaluates rules on them, sends firing alerts to **Alertmanager**, and answers **Grafana**'s PromQL queries. |
| **2 · Scrape and store** | A scrape returns text, one sample per line, such as `http_requests_total{service="catalog",status="200"} 18420`. Prometheus adds the target's labels (`job`, `instance`, and `pod` through relabeling): the metric name and the whole label set identify one **time series**, and the value with the scrape's timestamp is one **sample**. Samples are written to the **write-ahead log** and the in-memory **head**; once the head spans 3 hours, its oldest 2 hours go to disk as an immutable **block**, and blocks are later **compacted**, three 2-hour blocks into one 6-hour block. |
| **3 · Query and alert** | `rate()` turns a counter's running total into a per-second rate and treats any drop as a restart: catalog-x2m's counter falls from 1226 to 36, and its rate still reads 2.4 errors/s. The recording rule divides the 5xx rate by the total, 7.2/s of 120/s, which is **6%**. `CatalogHighErrorRate` turns **pending** above 5% and **firing** once that has held for 10 minutes (`for: 10m`); Alertmanager groups it, waits `group_wait` (30 s) and pages the on-call engineer, and Grafana plots the same expression. `histogram_quantile(0.99, …)` reads the p99 latency, 0.67 s, off the histogram's buckets. |
| **4 · Limits and trade-offs** | Every distinct label value creates another series, and the head holds each one in memory: a `user_id` label with 50,000 users would turn 12 series (3 pods × 4 status codes) into up to 600,000. One server keeps its data on local disk, 15 days by default, and isn't highly available on its own: run two identical servers, and Alertmanager de-duplicates their alerts. For long-term or global views, `remote_write` streams samples from the WAL to Thanos, Grafana Mimir or a managed service. Pull needs reachable targets (the Pushgateway is only for batch jobs), and metrics are aggregates: per-request detail comes from logs and traces. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's Catalog service runs as three pods on Kubernetes. The team wants to know, minute by minute, how many requests it serves, how many of them fail and how slow the slowest are, and it wants a person paged when the failure rate stays high, not when one request fails. The numbers have to come from every pod, including the one that started five minutes ago, and they have to add up across pods. Logs can answer these questions only by counting lines after the fact, which gets slow and expensive as traffic grows.

Prometheus collects numbers instead of events. Every process keeps a few counters, gauges and histograms in memory and serves their current values over HTTP; Prometheus fetches them on a fixed interval, stores them as time series in its own database, queries them with a language built for time series (PromQL), and turns query results into alerts. Alertmanager decides who hears about an alert, and Grafana draws dashboards from the same queries.

## How it works

### Pull, store, evaluate

Prometheus **pulls**. Service discovery tells it which targets exist, and its scraper sends each one `GET /metrics` every `scrape_interval` (1 minute by default, 15 seconds here). Each response becomes a batch of samples in the local time-series database (TSDB). Every `evaluation_interval` the rule engine runs PromQL expressions over the stored data: recording rules save their results as new series, and alerting rules send alerts that are firing to Alertmanager. Grafana, and anything else, reads through the HTTP API, for example `/api/v1/query`. One Prometheus server is a single binary with all of these parts inside; its local storage is not clustered or replicated.

Pulling has practical advantages that the Prometheus FAQ lists: a scrape that fails is itself a signal (the `up` series becomes 0), you can open a target's `/metrics` in a browser, and you can point a second Prometheus at the same targets without changing them.

### The data model: names, labels and samples

A **time series** is identified by a metric name and a set of labels, for example `http_requests_total{job="catalog", instance="10.1.4.7:8080", pod="catalog-7d9", service="catalog", status="200"}`. Change any label value and you have a different series. The series holds **samples**: a float64 value (or a native histogram) with a millisecond timestamp. Labels are what make the model dimensional: PromQL filters on any label and aggregates over the rest, so one metric can be read per pod, per status code or for the whole service.

Since Prometheus 3.0, metric and label names may use any UTF-8 characters; names outside the classic set (letters, digits, `_` and `:`) need quoting in PromQL, and the data model page warns that parts of the ecosystem are still catching up.

### Metric types

The client libraries offer four types. Apart from native histograms, the server doesn't use the type: it stores everything as plain float series.

- **Counter.** A running total that only goes up, or back to zero when the process restarts: `http_requests_total`. You read it through `rate()` or `increase()`.
- **Gauge.** A value that goes up and down: memory in use, queue length, requests in flight.
- **Histogram.** Counts observations, such as request durations, in buckets. A **classic** histogram is several series: a cumulative counter per bucket, `_bucket{le="0.5"}` meaning "at most 0.5 s", plus `_sum` and `_count`. A **native** histogram is one series whose samples carry the whole bucket layout; its bucket boundaries grow exponentially by a fixed schema, so nobody has to choose them, and it costs less, resolves finer and can always be added to another native histogram. Native histograms became a stable feature in Prometheus 3.8 (November 2025), but they are optional: a scrape config turns them on with `scrape_native_histograms: true`, which also makes Prometheus ask for the protobuf format first. The metric types page names the Go and Java client libraries as the ones that support them.
- **Summary.** The client computes quantiles over a sliding time window and exposes them with `_sum` and `_count`. Quantiles from different pods can't be combined, so a service with several replicas is usually better served by a histogram.

### Exposition formats and OTLP

A target serves plain text, one sample per line, after optional `# HELP` and `# TYPE` lines:

```text
# TYPE http_requests_total counter
http_requests_total{service="catalog",status="200"} 18420
http_requests_total{service="catalog",status="500"} 1176
```

Prometheus negotiates the format through the `Accept` header. By default it asks for OpenMetrics 1.0 first, then the Prometheus text format; with native histograms on, it asks for the protobuf format first. OpenMetrics 2.0 is still an experimental release candidate, which 3.15 can scrape behind `--enable-feature=openmetrics2`. Since 3.0, a response without a valid `Content-Type` fails the scrape unless the scrape config names a `fallback_scrape_protocol`.

Prometheus can also accept pushed data. `--web.enable-otlp-receiver` opens an OTLP endpoint at `/api/v1/otlp/v1/metrics`, so OpenTelemetry SDKs or an OpenTelemetry Collector can send metrics straight to it, and `--web.enable-remote-write-receiver` accepts remote write at `/api/v1/write`. Both are off by default: Prometheus can run without any authentication, so the OpenTelemetry guide warns that accepting incoming data is safe only once it has been set up on purpose.

### Service discovery and relabeling

Pods come and go, so a static list of targets doesn't work. `kubernetes_sd_configs` watches the Kubernetes API in one of six roles (`node`, `service`, `pod`, `endpoints`, `endpointslice`, `ingress`) and turns each object into a target with metadata labels such as `__meta_kubernetes_pod_name`. `relabel_configs` then keep or drop targets and copy metadata into real labels; every label that still starts with `__` is removed afterwards. Prometheus adds `job` and `instance` to everything it scrapes and writes a few series of its own for each scrape: `up` (1 if the scrape worked, 0 if not), `scrape_duration_seconds` and `scrape_samples_scraped`, among others. The `endpoints` role reads the Endpoints API, which Kubernetes deprecated in v1.33; the Prometheus documentation recommends `endpointslice` instead.

The scrape configuration for the catalog pods:

```yaml
global:
  scrape_interval: 15s       # the default is 1m
  evaluation_interval: 15s   # the default is 1m

scrape_configs:
  - job_name: catalog
    kubernetes_sd_configs:
      - role: pod
        namespaces:
          names: [shop]
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_label_app]
        regex: catalog
        action: keep                  # only the catalog pods
      - source_labels: [__meta_kubernetes_pod_name]
        target_label: pod             # keep the pod name as a label
```

On many clusters the Prometheus Operator writes this configuration for you from `ServiceMonitor` and `PodMonitor` resources.

### The TSDB: head, WAL, blocks and retention

- **Head.** New samples go to the head, the newest part of the database, which lives in memory (full chunks are memory-mapped from `chunks_head/`). Before they're added there, a batch of samples is written to the **write-ahead log** in `wal/`, in 128 MB segments, so a restart can replay what hadn't reached disk.
- **Blocks.** When the head spans more than 3 hours, its oldest 2 hours are written to disk as a **block**: a directory with the compressed chunks, an index from labels to series, a `meta.json` and a tombstones file for deletions. Blocks are never rewritten in place.
- **Compaction.** In the background, blocks are merged into longer ones, three 2-hour blocks into a 6-hour block and so on, up to 10% of the retention time or 31 days, whichever is smaller.
- **Retention.** Whole blocks are deleted once they fall outside the retention period: 15 days when neither a time nor a size limit is set. In Prometheus 3.15 both limits live in the configuration file, and the `--storage.tsdb.retention.time` and `--storage.tsdb.retention.size` flags are deprecated:

```yaml
storage:
  tsdb:
    retention:
      time: 15d       # also the default when no time or size is set
```

The storage documentation puts the average cost at 1 to 2 bytes per sample, so the disk you need is roughly retention × samples ingested per second × bytes per sample; the number of active series drives memory. Local storage is a single-node database: it isn't clustered or replicated, and network file systems such as NFS, including Amazon EFS, aren't supported.

### PromQL essentials

- `rate(http_requests_total[5m])`: the per-second average increase over the last 5 minutes. It treats any drop in a counter as a restart and adds the lost total back, and it extrapolates to the edges of the window. Take the `rate()` first and aggregate afterwards, or resets go unnoticed.
- `increase(http_requests_total[1h])`: the same calculation, expressed as a total for the window.
- `sum by (service) (…)` and `sum without (pod) (…)`: aggregate over the labels you drop.
- `histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))`: the 99th percentile from classic histogram buckets. It finds the bucket that contains the 99th percentile and interpolates linearly inside it. For a native histogram, leave out `_bucket` and `le`.
- `… offset 1w`: the same expression a week earlier, to compare with last week.

The numbers in the animation work out like this. Across the three pods, the 5xx counters grow by 2.4 per second each and all requests by 120 per second, so `sum(rate(…{status=~"5.."}[5m])) / sum(rate(…[5m]))` is 7.2 / 120 = 6%. When catalog-x2m restarts, its counter falls from 1226 to 36; `rate()` counts the 36 as new requests instead of a drop of 1190, so the pod still reads 2.4 errors per second. The latency buckets hold, per second, 114 requests at or under 0.25 s, 118.2 at or under 0.5 s and 120 at or under 1 s. The 99th percentile is request number 118.8 of 120, which lies a third of the way into the 0.5–1 s bucket: 0.5 + 0.5 × (118.8 − 118.2) / (120 − 118.2) ≈ 0.67 s.

### Recording and alerting rules

Rules live in rule groups, evaluated in order every `evaluation_interval`. **Recording rules** run an expression and store the result as a new series, so dashboards and alerts read one cheap series instead of recomputing an expensive query; the naming convention is `level:metric:operations`. **Alerting rules** are active while their expression returns any series: with a `for` clause, an alert is **pending** until the condition has held for that long at every evaluation, then **firing**. An optional `keep_firing_for` keeps it firing for a while after the condition clears, which stops flapping. Prometheus sends firing alerts to every Alertmanager it knows and keeps resending them while they last, by default no more often than once a minute (`--rules.alert.resend-delay`).

```yaml
groups:
  - name: catalog
    rules:
      - record: service:http_errors_per_request:ratio_rate5m
        expr: |
          sum by (service) (rate(http_requests_total{status=~"5.."}[5m]))
            /
          sum by (service) (rate(http_requests_total[5m]))
      - record: service:http_request_duration_seconds:p99_rate5m
        expr: |
          histogram_quantile(0.99,
            sum by (service, le) (rate(http_request_duration_seconds_bucket[5m])))
      - alert: CatalogHighErrorRate
        expr: service:http_errors_per_request:ratio_rate5m{service="catalog"} > 0.05
        for: 10m
        labels:
          severity: page
        annotations:
          summary: "Catalog 5xx ratio is {{ $value | humanizePercentage }}"
```

`promtool check rules` validates a file like this one, and `promtool test rules` runs it against synthetic series. Fed the animation's numbers, this group computes 0.5% before the incident and 6% during it, returns 2.4 errors per second for catalog-x2m across its restart and 0.67 s for the p99, and the alert is pending about 4 minutes after the errors begin (the 5-minute window has to fill) and firing 10 minutes after that.

### Alertmanager

Alertmanager is a separate program that receives alerts from one or more Prometheus servers and decides what happens to them:

- **Grouping.** Alerts with the same values for the `group_by` labels become one notification. A new group waits `group_wait` (30 s by default) for related alerts, later changes go out at most every `group_interval` (5 min), and a notification that hasn't changed is repeated every `repeat_interval` (4 h).
- **Routing.** A tree of routes matches alert labels to receivers: email, PagerDuty, Opsgenie, Slack, webhooks and others.
- **Inhibition and silences.** An inhibition rule mutes alerts while a related, bigger one fires (no "pod down" pages while the whole cluster is down); a silence mutes matching alerts for a set time, created in Alertmanager's web interface.
- **High availability and de-duplication.** Several Alertmanagers can form a highly available cluster with the `--cluster.*` flags. Each Prometheus should send its alerts to all of them directly, not through a load balancer, and identical alerts are de-duplicated, also when they come from two Prometheus servers.

```yaml
route:
  receiver: catalog-oncall
  group_by: [alertname, service]
  group_wait: 30s          # the defaults: 30s, 5m and 4h
  group_interval: 5m
  repeat_interval: 4h

receivers:
  - name: catalog-oncall
    pagerduty_configs:
      - routing_key_file: /etc/alertmanager/pagerduty-key
```

`amtool check-config` validates it. Alertmanager is at version 0.34 (September 2026).

### Grafana

Grafana is a separate project from Grafana Labs that draws dashboards from **data sources**: Prometheus, and anything that speaks its query API such as Grafana Mimir and Thanos, as well as logs, traces, SQL databases and cloud services. The Prometheus data source is preinstalled and supports PromQL queries, alerting, annotations and exemplars. A **dashboard** is a set of panels; each panel runs one or more queries over the time range on screen and draws the result. Grafana also has its own alerting, which can evaluate queries from several data sources, so a team can keep alert rules in Prometheus, in Grafana, or both. The current major version is Grafana 13, at 13.2.3 on 29 September 2026; in Grafana 13 the core Prometheus data source no longer handles AWS SigV4 or Azure AD authentication, and Amazon Managed Service for Prometheus has its own data source plugin.

### Exporters

Software that can't be instrumented directly gets an **exporter**: a small process that reads the software's own statistics and serves them as `/metrics`. `node_exporter` exposes hardware and operating system metrics from Linux and other Unix kernels; `kube-state-metrics` watches the Kubernetes API and turns the state of objects (deployments, pods, nodes) into metrics; `blackbox_exporter` probes endpoints from outside over HTTP, HTTPS, DNS, TCP, ICMP and gRPC. The Prometheus site lists exporters for databases, message brokers, proxies and hardware.

### Federation, remote_write and high availability

- **Federation.** A Prometheus can scrape selected series from another one at `/federate`. The usual shape is hierarchical: one server per cluster or data centre keeps the detail, and a global server pulls aggregated series from them.
- **remote_write.** Each configured destination gets a queue that reads samples from the WAL, splits them into shards and sends them on. If the destination is unreachable, Prometheus retries without losing data for up to about 2 hours; after that the WAL is truncated and unsent samples are lost. The Remote Write 1.0 protocol is stable; 2.0, which adds metadata, exemplars, created timestamps and native histograms and shrinks payloads by interning repeated strings, is still experimental.
- **Agent mode.** `prometheus --agent` (stable since 3.0) only discovers, scrapes and remote-writes: no local queries, rules or alerts, and only a short local buffer.
- **High availability.** A single server is a single point of failure, and the FAQ's answer is to run identical servers on two or more machines. Both scrape the same targets and evaluate the same rules; Alertmanager de-duplicates their identical alerts, and Thanos or a remote store can de-duplicate the data. Give each replica its own `external_labels` value (for example `replica: a` and `replica: b`) and drop that label in `alert_relabel_configs`, which the documentation describes for exactly this case, so both send identical alerts.

### Long-term and global storage

- **Thanos** (Apache 2.0, a CNCF incubating project) adds components around existing servers: a sidecar next to each Prometheus uploads its 2-hour blocks to object storage, a querier answers PromQL across all servers and the bucket and de-duplicates HA pairs, and a compactor downsamples old data.
- **Grafana Mimir** (AGPLv3) is a horizontally scalable, multi-tenant, long-term store for Prometheus and OpenTelemetry metrics that receives data through remote write or OTLP.
- **VictoriaMetrics** (Apache 2.0) is a time-series database that runs as a single node or a cluster, scrapes targets itself or with `vmagent`, accepts remote write, OTLP, InfluxDB and Graphite data, and answers queries in MetricsQL, which its documentation describes as backwards-compatible with PromQL. It keeps data for 1 month by default.

### Prometheus 3 and the release cycle (October 2026)

Prometheus 3.0 (14 November 2024) was the first major version in seven years. It brought a new web UI, UTF-8 metric and label names by default, the OTLP receiver behind `--web.enable-otlp-receiver`, Remote Write 2.0 as an experimental protocol and agent mode as a stable feature. It also changed behaviour: range selectors and the lookback window exclude a sample that falls exactly on their start, a scrape without a valid `Content-Type` fails, `holt_winters` became `double_exponential_smoothing` behind a feature flag, and Alertmanager's long-deprecated v1 API can no longer be configured. Native histograms followed as a stable feature in 3.8 (November 2025).

A new minor version ships every six weeks, and selected releases are long-term-support (LTS) releases that get fixes for serious bugs for a year. In October 2026 the latest release is **3.15** (24 September 2026) and the supported LTS release is **3.13** (1 July 2026, supported until 31 July 2027).

## Where it fits

- **Solutions.** Monitoring Kubernetes clusters and the services on them, as for Acme Shop's catalog; service health and capacity dashboards; [SLOs and error budgets](../slo-error-budgets/) with the multiwindow, multi-burn-rate alerts that the Google SRE Workbook writes as Prometheus rules; [autoscaling](../autoscaling/) on application metrics, through the Prometheus Adapter, which serves Prometheus queries through the Kubernetes custom and external metrics APIs for the Horizontal Pod Autoscaler, or KEDA's Prometheus scaler; and [telemetry pipelines](../telemetry-pipeline/) in which the OpenTelemetry Collector sends metrics to Prometheus over OTLP or with its Prometheus remote write exporter.
- **Patterns it implements or supports.** [Health endpoint monitoring](../health-endpoint-monitoring/), through the `up` series of every scrape and the probes of `blackbox_exporter`; [SLOs and error budgets](../slo-error-budgets/) built from recording rules; and the metrics part of observability next to [centralized logging](../centralized-logging/) and [distributed tracing](../distributed-tracing/). Exemplars, stored with `--enable-feature=exemplar-storage`, attach a trace ID to a sample so that Grafana can jump from a slow bucket to an example trace.
- **Usual neighbours.** [Kubernetes](../kubernetes/) and its service discovery; exporters such as `node_exporter` and `kube-state-metrics`; Alertmanager with PagerDuty, Slack or e-mail behind it; Grafana in front; a long-term store behind; the OpenTelemetry Collector at the edges.
- **Managed offerings.** **Amazon Managed Service for Prometheus** is a serverless, Prometheus-compatible service: you send data with remote write (or let its AWS managed collectors scrape an Amazon EKS cluster without an agent), query with PromQL, and run recording and alerting rules with an alert manager that forwards to [Amazon SNS](../amazon-sns/). Data is replicated across three Availability Zones and kept for 150 days by default, adjustable up to 1,095 days. **Amazon Managed Grafana** runs Grafana workspaces with single sign-on and built-in data sources for AWS services, [CloudWatch](../amazon-cloudwatch/) and Amazon Managed Service for Prometheus among them. **Grafana Cloud** is Grafana Labs' hosted Grafana with its own Prometheus-compatible metrics store.
- **Licences.** Prometheus and Alertmanager are open source under the Apache License 2.0; Prometheus joined the Cloud Native Computing Foundation in 2016 as its second project, after Kubernetes. Grafana moved from Apache 2.0 to the AGPLv3 in April 2021, keeping its plugins, agents and some libraries under Apache 2.0.

## When to use it

Choose Prometheus with Grafana when your services run on Kubernetes or other dynamic infrastructure, when you want metrics with labels you choose and a query language to slice them, and when you want to keep the monitoring stack open source and portable between clouds. Run it yourself for a cluster or two; add Thanos, Mimir, VictoriaMetrics or a managed service once you need long retention, a global view or several teams' data in one place. Prometheus doesn't fit where every event must be counted exactly: its own documentation names per-request billing as a job for another system. For logs and traces you need other tools next to it.

| | Prometheus with Grafana | Amazon CloudWatch | Datadog | VictoriaMetrics |
|---|---|---|---|---|
| What it is | Open-source metrics server, alert router and dashboards | AWS's monitoring service: metrics, logs, alarms and dashboards | Commercial SaaS for metrics, logs, traces and more | Open-source time-series database, compatible with Prometheus |
| How data gets in | Pull: scrapes `/metrics`; OTLP and remote write receivers can be turned on | AWS services publish their metrics automatically; your own come from the API, the CloudWatch agent or OTLP | The Datadog Agent sends it; its OpenMetrics check can scrape Prometheus endpoints | Both: scrapes targets, or accepts remote write, OTLP, InfluxDB and Graphite |
| Queries | PromQL | Metrics Insights, a SQL dialect, for classic metrics; PromQL for OpenTelemetry metrics | Datadog's own query editor | MetricsQL, backwards-compatible with PromQL |
| Keeps data | 15 days by default on one server's disk; longer through remote storage | 15 months, at coarser resolution as data ages | 15 months on paid plans | 1 month by default |
| Cost driver | Your servers: active series drive memory | Classic custom metrics per metric; OpenTelemetry metrics per GB ingested, with 15 months of storage included | Hosts, and custom metrics: each metric name and tag-value combination counts | Your servers, or VictoriaMetrics Cloud |
| Who runs it | You, or Amazon Managed Service for Prometheus with Amazon Managed Grafana, or Grafana Cloud | AWS | Datadog | You, or VictoriaMetrics Cloud |
| Licence | Prometheus Apache 2.0; Grafana AGPLv3 | Proprietary service | Proprietary service | Apache 2.0 |

Figures from the Prometheus 3.15, Amazon CloudWatch, Datadog and VictoriaMetrics documentation and the CloudWatch pricing page, October 2026.

## Trade-offs

- **Every label value is a series.** Memory, disk and query time grow with the number of active series, and a label with unbounded values multiplies them: `user_id` on the catalog's 12 request series (3 pods × 4 status codes) means up to 600,000 with 50,000 users. The naming guidelines rule out user IDs, e-mail addresses and other unbounded values as labels.
- **One server, one disk.** Local data is kept for 15 days by default and isn't replicated; high availability means running two identical servers, and long retention or a global view means remote storage.
- **Pull needs reachable targets.** Prometheus has to reach every target over the network, which is awkward across NAT or firewalls and impossible for a job that ends before the next scrape. The Pushgateway exists for service-level batch jobs, but the documentation warns that it is a single point of failure, that its series lose the `up` health signal, and that it keeps exposing pushed series until they are deleted.
- **Samples, not events.** Counters lose nothing between scrapes, because they only add up, but a gauge is seen only at scrape time: a spike that comes and goes within 15 seconds can be missed. And metrics carry no per-request detail. Which request failed, and why, is a question for [logs](../centralized-logging/) and [traces](../distributed-tracing/).
- **Several moving parts.** Prometheus, Alertmanager, Grafana, exporters and possibly a long-term store are separate systems to configure, upgrade and monitor, each with its own configuration file.
- **Licences differ.** Prometheus is Apache 2.0, but Grafana and Mimir are AGPLv3, whose terms matter if you modify them and offer the result to others as a service.

## Implementation notes

- **Instrument with counters and histograms.** Count requests and errors with counters, measure latency with a histogram, and follow the naming guidelines: base units (seconds, bytes), a `_total` suffix on counters, and a unit suffix such as `_seconds`.
- **Guard cardinality.** Set `sample_limit` and `label_limit` on scrape configs so that one bad deploy fails its own scrape instead of filling the server's memory, drop labels you don't need with `metric_relabel_configs`, and watch `prometheus_tsdb_head_series`.
- **Size storage on purpose.** Estimate disk from retention, samples per second and 1 to 2 bytes per sample, keep `retention.size` (if you use it) at no more than 80–85% of the volume as the storage documentation advises, and put the data on a local disk, never NFS.
- **Alert on symptoms, with a `for`.** Page on what users feel (error ratio, latency, saturation), not on every pod restart; use `for` so brief spikes don't page, `keep_firing_for` against flapping, and burn-rate alerts for SLOs. Test rules with `promtool test rules` and configurations with `promtool check config` before you deploy them.
- **Run HA pairs properly.** Two identical servers with a `replica` external label, removed again by `alert_relabel_configs`; every server sends to every Alertmanager; the Alertmanagers form a cluster.
- **Protect the endpoints.** Prometheus and its exporters support TLS and basic authentication through a web configuration file (`--web.config.file`, still marked experimental); keep `/metrics`, the HTTP API and especially the OTLP and remote write receivers off the public internet.
- **On Amazon EKS,** consider the AWS managed collectors and Amazon Managed Service for Prometheus instead of running the server yourself, and Amazon Managed Grafana in front.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [SLOs & Error Budgets](../slo-error-budgets/) — Measure SLIs against an objective and alert on error-budget burn rate, not on every blip.
- [Health Endpoint Monitoring](../health-endpoint-monitoring/) — Expose liveness and readiness checks that load balancers and monitors probe.
- [Telemetry Pipeline (OpenTelemetry)](../telemetry-pipeline/) — Receive, process and export traces, metrics and logs through one vendor-neutral collector.
- [Distributed Tracing](../distributed-tracing/) — Propagate a trace context across services and assemble the spans into one timeline.
- [Centralized Logging](../centralized-logging/) — Ship structured logs from every service to one searchable store, correlated by request ID.
- [Kubernetes](../kubernetes/) — A container orchestrator: you declare the desired state, and controllers keep pods scheduled, healthy and reachable.
- [Autoscaling](../autoscaling/) — Add and remove instances automatically as load rises and falls.
- [Amazon CloudWatch](../amazon-cloudwatch/) — Metrics, logs, alarms and dashboards for AWS resources and your applications, in one monitoring service.

## References

- [Prometheus documentation — Overview](https://prometheus.io/docs/introduction/overview/)
- [Prometheus documentation — Data model](https://prometheus.io/docs/concepts/data_model/)
- [Prometheus documentation — Metric types](https://prometheus.io/docs/concepts/metric_types/)
- [Prometheus documentation — Storage](https://prometheus.io/docs/prometheus/latest/storage/)
- [Prometheus documentation — Configuration (scrape, kubernetes_sd_config, relabeling, storage)](https://prometheus.io/docs/prometheus/latest/configuration/configuration/)
- [Prometheus documentation — Querying basics](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [Prometheus documentation — Query functions](https://prometheus.io/docs/prometheus/latest/querying/functions/)
- [Prometheus documentation — Alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
- [Prometheus documentation — Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/)
- [Prometheus documentation — Alertmanager configuration](https://prometheus.io/docs/alerting/latest/configuration/)
- [Prometheus documentation — Metric and label naming](https://prometheus.io/docs/practices/naming/)
- [Prometheus documentation — When to use the Pushgateway](https://prometheus.io/docs/practices/pushing/)
- [Prometheus documentation — Remote write tuning](https://prometheus.io/docs/practices/remote_write/)
- [Prometheus documentation — Agent Mode](https://prometheus.io/docs/prometheus/latest/prometheus_agent/)
- [Prometheus documentation — Federation](https://prometheus.io/docs/prometheus/latest/federation/)
- [Prometheus documentation — Exporters and integrations](https://prometheus.io/docs/instrumenting/exporters/)
- [Prometheus documentation — Using Prometheus as your OpenTelemetry backend](https://prometheus.io/docs/guides/opentelemetry/)
- [Prometheus documentation — Long-term support](https://prometheus.io/docs/introduction/release-cycle/)
- [Announcing Prometheus 3.0 (November 2024)](https://prometheus.io/blog/2024/11/14/prometheus-3-0/)
- [Prometheus CHANGELOG](https://github.com/prometheus/prometheus/blob/main/CHANGELOG.md)
- [Grafana documentation — Prometheus data source](https://grafana.com/docs/grafana/latest/datasources/prometheus/)
- [Grafana Labs — Grafana, Loki, and Tempo will be relicensed to AGPLv3 (April 2021)](https://grafana.com/blog/2021/04/20/grafana-loki-tempo-relicensing-to-agplv3/)
- [Google SRE Workbook — Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/)
- [Amazon Managed Service for Prometheus User Guide — What is Amazon Managed Service for Prometheus?](https://docs.aws.amazon.com/prometheus/latest/userguide/what-is-Amazon-Managed-Service-Prometheus.html)
- [Amazon Managed Grafana User Guide — What is Amazon Managed Grafana?](https://docs.aws.amazon.com/grafana/latest/userguide/what-is-Amazon-Managed-Service-Grafana.html)
- [Amazon CloudWatch User Guide — Query metrics with PromQL](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-PromQL.html)
- [Amazon CloudWatch User Guide — Metrics concepts (retention)](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch_concepts.html)
- [Amazon CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/)
- [Datadog documentation — OpenMetrics integration](https://docs.datadoghq.com/integrations/openmetrics/)
- [Datadog documentation — Custom metrics billing](https://docs.datadoghq.com/account_management/billing/custom_metrics/)
- [Datadog pricing](https://www.datadoghq.com/pricing/)
- [Thanos](https://thanos.io/)
- [Grafana Mimir documentation](https://grafana.com/docs/mimir/latest/)
- [VictoriaMetrics documentation — Single-node version](https://docs.victoriametrics.com/victoriametrics/single-server-victoriametrics/)
- [KEDA — Prometheus scaler](https://keda.sh/docs/latest/scalers/prometheus/)
- [Prometheus Adapter for Kubernetes Metrics APIs](https://github.com/kubernetes-sigs/prometheus-adapter)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
