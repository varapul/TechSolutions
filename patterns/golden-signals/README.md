
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧭 DevOps & SRE Principles](../../README.md#devops--sre-principles)

# Golden Signals, RED & USE

> What to measure and alert on: latency, traffic, errors and saturation, RED for request-driven services and USE for resources.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Golden Signals, RED &amp; USE" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/golden-signals.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Alerts on causes** | Acme's search service (the search box on every catalog page, 1,200 requests a second at peak) has about 140 alert rules, all on **causes**: CPU above 80%, disk, GC pauses, pod restarts. They page someone every night while shoppers notice nothing (CPU at 85% on pod 3 hurts nobody), so the on-call engineer acks each page and stops reading them. On Saturday search slowed to a p99 of 2.4 s for 40 minutes and no rule fired, because none watched what users feel. |
| **2 · The four golden signals** | Google's SRE book (chapter 6, *Monitoring Distributed Systems*) names four signals to watch on any user-facing system, and the team rebuilds the search dashboard around them. At the next Saturday peak they read: **latency** p50 140 ms and p99 850 ms for successful requests (failed requests are timed apart, so fast errors can't hide a slow service), **traffic** 1,200 requests a second, **errors** 0.4% (HTTP 5xx *and* wrong answers such as empty results from a broken index), and **saturation** 92%: 46 of the database pool's 50 connections busy, above the 80% target. |
| **3 · RED and USE in practice** | Every request-driven service gets a **RED** view (rate, errors and duration per endpoint: Tom Wilkie's method) and every resource a **USE** view (utilisation, saturation and errors: Brendan Gregg's method). The page fires on a symptom, search p99 above 800 ms for 10 minutes (once search has an SLO, a burn-rate alert as in [SLOs & Error Budgets](../slo-error-budgets/) can replace the fixed threshold). The on-call engineer goes from the RED row (search is slow) to the USE row (the DB pool is 92% busy and 12 requests wait for a connection) to the cause: since Friday's deploy the price query takes 38 ms instead of 30, so they roll it back. |
| **4 · Common pitfalls** | **Averages hide the tail**: a mean of 190 ms looks fine while 1 search in 100 takes over 850 ms, so read percentiles from histograms. **Errors can come back as HTTP 200**: counting only 5xx shows 0.3% and misses the empty results from a broken index shard; **saturation needs a known limit** (46 busy connections mean nothing without the 50), and a **dashboard of 60 graphs** buries the four signals. **Every page must be actionable**: CPU at 85% belongs on a dashboard, a disk that fills in 9 days is a ticket, and only a symptom that needs a human now pages. |
<!-- END GENERATED: header -->

## The problem

Monitoring tends to grow from the bottom up. Every incident leaves behind a rule for the cause someone found: CPU above 80%, a disk above 80%, a garbage-collection pause over 200 ms, a pod that restarted. Acme Shop's search service (the search box on every catalog page, 1,200 requests a second at peak) has collected about 140 of them. They page the on-call engineer every night, nearly always for something no shopper notices: a pod at 85% CPU is simply busy. Google's SRE book describes where this ends. When pages come too often, people skim them, second-guess them or ignore them, and the page that matters gets lost in the noise.

The other half of the problem is what the rules miss. A cause-based rule fires only for the failure someone predicted. One Saturday evening search slowed down, its 99th-percentile latency reaching 2.4 s for 40 minutes, and nothing fired, because no rule watched what users feel. The team heard about it from customers. The dashboards had the same blind spot: dozens of per-host graphs that answered "is this machine busy?" and none that answered "is search working?"

## How it works

### The four golden signals

The idea comes from chapter 6 of Google's *Site Reliability Engineering* book (O'Reilly, 2016), *Monitoring Distributed Systems*, written by Rob Ewaschuk and edited by Betsy Beyer. The chapter picks four signals as the minimum to watch on any user-facing system:

- **Latency**: how long requests take. Keep successful and failed requests apart. A request that fails because the database connection is gone can return an HTTP 500 within milliseconds, and mixing fast failures into one latency figure makes a slow service look quick. Don't drop the failures either: one that also takes seconds hurts users twice, so give failures a latency of their own.
- **Traffic**: the demand on the system, in the unit that fits it: HTTP requests per second for a web service (split by kind of request where that matters), sessions or bandwidth for streaming, transactions per second for a data store.
- **Errors**: the rate of requests that fail. That covers explicit failures (an HTTP 500), implicit ones (an HTTP 200 with the wrong content, such as an empty result list from a broken index) and failures by policy (a request slower than you promised counts as failed). Status codes at the load balancer catch the first kind; only checks that look at the content catch the second.
- **Saturation**: how full the service is, measured on the resource that runs out first: memory for a memory-bound service, I/O for an I/O-bound one, a connection pool for Acme's search. Most systems slow down well before 100%, so give that resource a utilisation target below it. Rising latency is often the first sign of saturation, and it pays to predict it too (the book's example is a database disk that will be full in four hours).

The chapter's promise is modest: a team that watches all four and pages someone when one of them is a problem (for saturation, when it is close to one) has its service reasonably well covered. In the diagram the rebuilt search dashboard reads p50 140 ms and p99 850 ms for successful requests, 1,200 requests a second, 0.4% errors (0.3% HTTP 5xx plus 0.1% empty results) and 92% saturation: 46 of the pool's 50 connections busy, above the 80% target.

### Symptoms and causes, black box and white box

The chapter frames monitoring as two questions: what is broken, and why. *What* is the symptom (search is slow); *why* is the cause (the pool is full because the price query got slower). Page on symptoms. One symptom rule covers every cause, including the ones nobody has thought of yet, while a cause rule pages when users are fine and still misses the next new cause. Causes belong on dashboards, where they help the person who was paged find the problem. Which is which depends on the layer: slow database reads are a symptom to the database team and a cause to the search team.

The chapter also separates **black-box** monitoring, which tests the system from outside the way a user would (a probe that runs a search), from **white-box** monitoring, which reads what the system reports about itself (latency histograms, pool gauges, logs). A black-box check only sees problems that are already hurting users, which makes it a good source of pages and no help as an early warning. White-box metrics are what you debug with, and the only way to see trouble coming, such as a disk filling up. Google's teams rely heavily on white-box monitoring and use a small amount of critical black-box monitoring.

The chapter grew out of Rob Ewaschuk's essay *My Philosophy on Alerting*, written from his time as a Google SRE. Its summary asks for pages that are urgent, important, actionable and real; advises deleting noisy alerts, since too much alerting is harder to recover from than too little; and keeps cause-based rules for the rare cliff that has no symptom before it, such as running out of quota or disk.

### RED: the same view for every service

Tom Wilkie's **RED method**, which he created in 2015 and presented at GrafanaCon EU in 2018, applies the user-facing signals to every request-driven service in a microservice system:

- **Rate**: requests per second.
- **Errors**: how many of those requests fail.
- **Duration**: how long they take, as a distribution rather than an average.

The value is in the uniformity. Every service gets the same three panels for each endpoint, so whoever is on call can read the dashboard of a service they have never worked on, and alerts and SLOs are written the same way everywhere. RED leaves out saturation on purpose. Wilkie based the method on the four golden signals he learned as a Google SRE and treats saturation as a more advanced step, to add once rate, errors and duration are in place; for the resources a service runs on, USE covers it.

### USE: the same checklist for every resource

Brendan Gregg's **USE method** (2012, published as the ACM Queue article *Thinking Methodically about Performance* and presented at FISL13) says: for every resource, check

- **Utilisation**: the share of time the resource was busy;
- **Saturation**: work the resource can't take on yet, usually waiting in a queue;
- **Errors**: the count of error events.

The resources start with the hardware (CPUs, memory, storage devices, network interfaces, interconnects) and can include software resources such as locks, thread pools and, for Acme, a database connection pool: its utilisation is the share of connections in use and its saturation the number of callers waiting for one. Gregg's notes on reading the numbers are worth keeping: 100% utilisation usually marks a bottleneck, some resources start to queue noticeably above about 70%, an average over minutes can hide seconds spent at 100%, any saturation at all can hurt, and an error counter that is still climbing during a slowdown deserves a look. He also publishes checklists (for Linux and other systems) that name the tool or metric for each resource.

Watch the word **saturation**, because the two methods use it differently. In the golden signals it means how full the service is, in effect the utilisation of its tightest resource: 46 of 50 connections, 92%. In USE it means the queue in front of a resource: 12 requests waiting for a connection. Label each panel with the one it shows.

### Side by side

| | Golden signals | RED | USE |
|---|---|---|---|
| Source | Google SRE book, chapter 6 (2016) | Tom Wilkie (2015) | Brendan Gregg (2012) |
| Applies to | a user-facing service | every request-driven service, per endpoint | every resource: CPU, memory, disks, network, pools, locks |
| Measures | latency, traffic, errors, saturation | rate, errors, duration | utilisation, saturation, errors |
| Answers | do users get fast, correct answers, and how close is the service to full? | is each service serving its callers well? | which resource is the bottleneck? |
| Best for | pages and the top of a service dashboard | pages, SLOs and one dashboard layout for every service | debugging, capacity planning and tickets |

Grafana's dashboard guidance draws the same line: USE describes the health of the machines and RED the experience of the users, so alerts belong on the RED view (symptoms) and the USE view is where you look for causes.

### How they relate to SLOs

Golden signals and RED are where service level indicators come from. An SLO turns "p99 latency" into a ratio of good events (searches answered in under 800 ms, say) to valid ones, with a target over a window, and errors become an availability indicator the same way. Once a service has SLOs, a burn-rate alert ([SLOs & Error Budgets](../slo-error-budgets/)) makes a better page than a fixed threshold such as "p99 above 800 ms for 10 minutes": it pages quickly for a big outage, later for a slow leak, and not at all for a blip the budget can absorb. The fixed threshold is a reasonable first step for a team that has no SLO yet.

## Putting it into practice

1. **List what you serve and what it runs on.** For each request-driven service, its endpoints; for each service, its resources: CPU and memory against the container limits, connection and thread pools, queues, disks, and the downstream services it calls.
2. **Instrument RED with histograms.** Record request duration as a histogram labelled by endpoint and outcome, so successes and failures are timed apart, and count the failures that return 200 (an empty result for a query that should match, a fallback page) with their own counter. In Prometheus, compute the p99 with `histogram_quantile()` over the summed bucket rates. The Prometheus documentation now prefers native histograms where your client library supports them, which few do yet; classic histograms with fixed buckets work almost everywhere. Avoid summaries here: their quantiles can't be combined across Acme's six pods. In Amazon CloudWatch, percentile statistics such as p99 work on custom metrics published as raw values, and the Application Load Balancer reports `TargetResponseTime` (which supports percentiles), `RequestCount` and `HTTPCode_Target_5XX_Count`.
3. **Instrument USE for the resources.** node_exporter covers the nodes, and its `pressure` collector exposes Linux pressure-stall information, a direct saturation signal. cAdvisor covers containers, where the limits are resources too: `container_cpu_cfs_throttled_seconds_total` (time spent throttled at the CPU limit) and `container_oom_events_total` (out-of-memory kills, which Gregg's Linux checklist counts as memory saturation) show a container pressing against its limits. Libraries cover the software resources: HikariCP, for example, reports active, maximum and pending connections and acquisition timeouts (`hikaricp.connections.active`, `.max`, `.pending` and `.timeout` through Micrometer), which map straight onto utilisation, saturation and errors.
4. **Know every limit.** Saturation is a fraction, so record the denominator next to the usage. For a pool, Little's law gives the expected occupancy: connections in use ≈ requests per second × seconds each request holds one. At 1,200 requests a second a 30 ms price query keeps 36 of Acme's 50 connections busy (72%); at 38 ms after Friday's deploy it keeps 46 busy (92%), and bursts start to queue.
5. **Lay out the dashboards from the top down.** One dashboard per service with the four signals at the top, a RED row per service in the order requests flow, and links down to the USE view of each resource. Grafana's guidance adds template variables instead of copied dashboards, dashboard JSON under version control, and alerts that link to the dashboard that explains them.
6. **Rewrite the alerts.** Page on symptoms, as high up the stack as you can and once per stack (the Prometheus alerting guide suggests paging on latency at only one point): search p99 above 800 ms for 10 minutes, or an SLO burn rate. Give every page a link to its dashboard and runbook. Then sort the old cause rules: delete them, move them to a dashboard, or turn them into tickets for things that need a person this week but not tonight. Keep a cause-based page only for a cliff with no symptom before it, such as a disk that will be full within hours.
7. **Add a black-box probe** that runs a search from outside the cluster, so DNS, CDN and load balancer failures show up as well.
8. **Review regularly.** The SRE book suggests removing rules and data that are rarely used (less than once a quarter, for some of its teams) and signals that no dashboard or alert reads. Count the pages per on-call shift and ask of each one whether it was urgent, actionable and real.

## Where it fits

- [SLOs & Error Budgets](../slo-error-budgets/) turns the latency and error signals into indicators with targets, and replaces fixed thresholds with burn-rate alerts.
- [Prometheus & Grafana](../prometheus/) and [Amazon CloudWatch](../amazon-cloudwatch/) store the metrics, compute the percentiles, evaluate the alert rules and draw the dashboards.
- [Telemetry Pipeline (OpenTelemetry)](../telemetry-pipeline/) collects the metrics from every service and ships them in one format to whichever backend you use.
- [Distributed Tracing](../distributed-tracing/) and [Centralized Logging](../centralized-logging/) take over where RED and USE stop: a trace shows which call inside a slow request took the time, and the logs show the individual errors.
- [Health Endpoint Monitoring](../health-endpoint-monitoring/) keeps broken instances out of rotation with liveness and readiness checks; a black-box probe of the user journey complements it, and neither replaces the four signals.
- [Bulkhead](../bulkhead/): a bounded pool like the search service's 50 connections is a bulkhead, and its USE numbers show when it has become the limit.
- [Incident Management](../incident-management/): a page from a golden signal is usually where an incident begins.

## When to use it

- **Any service with users and an on-call rotation**, internal platforms included. The four signals are the smallest useful set, and RED gives every team the same dashboard layout, which pays off as soon as engineers are on call for services they didn't write.
- **When pages are noisy.** A few symptom rules replace many cause rules, so the pages that remain are worth answering.
- **For capacity work and debugging**, where USE gives a complete checklist, so no resource is skipped because nobody thought of it.

Where it needs adapting:

- **Batch jobs and pipelines** have no request rate or per-request latency. Watch freshness, the success of the last run and the age of the oldest unprocessed item; the Prometheus alerting guide suggests paging when a batch job hasn't succeeded recently enough to cause user-visible problems.
- **Queue consumers** are better described by consumer lag and the age of the oldest message than by latency.
- **Low-traffic services** produce noisy percentiles: the p99 of 50 requests is in effect the single slowest one. Use longer windows, counts of slow requests or a synthetic probe.
- **Legacy systems you can't instrument**: start from load balancer metrics and logs plus a black-box probe.
- **Regulated environments** may require alerts on specific causes (a failed backup, an expiring certificate, audit logs that stop arriving). Keep them, as tickets wherever the deadline allows.
- **It isn't free.** The SRE book notes that a Google SRE team of 10 to 12 people typically has one or two whose main job is building and running its monitoring. Histograms also multiply time series by their buckets and labels, so keep the labels to endpoint and outcome.

## Common pitfalls

- **Averaging latency.** A mean hides the tail. The SRE book's example is a service averaging 100 ms at 1,000 requests a second in which 1% of requests can take 5 seconds. Read percentiles from histograms, and never average percentiles across pods: sum the buckets first, then compute the percentile.
- **Paging on causes.** CPU at 85% is a reading, not a problem. Page on what users feel, and put causes on dashboards and in tickets.
- **Counting only 5xx.** Errors that come back as HTTP 200 (empty results, fallback content, a wrong price) never show up. Count wrong answers with application counters, and use black-box checks that inspect the content.
- **One latency for successes and failures.** Fast errors make a slow service look fast. Label the histogram by outcome.
- **Saturation without a limit.** 46 connections in use says nothing until you know there are 50. Record the limit, show the fraction and set a target below 100%.
- **Two meanings of saturation.** A golden-signal panel and a USE panel can both say "saturation" and mean different things; label them.
- **Dashboards with 60 graphs.** Nobody reads them during an incident. Put the four signals at the top, one RED row per service below, and drill down to USE. Watch the number of dashboards as well: Grafana's guidance warns against sprawl, the uncontrolled growth of copied and one-off dashboards.
- **Pages nobody can act on.** If the response is always to ack and wait, or always the same scripted step, it shouldn't page: make it a ticket, automate it or delete it. Every page should need a person to think, now.
- **Forgetting traffic.** A sudden drop in requests is a symptom too: users can't reach you. The SRE book, which otherwise avoids clever anomaly detection, keeps simple rules for unexpected changes in end-user request rates.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [SLOs & Error Budgets](../slo-error-budgets/) — Measure SLIs against an objective and alert on error-budget burn rate, not on every blip.
- [Prometheus & Grafana](../prometheus/) — Pull-based monitoring: scrape metrics into a time-series database, query them with PromQL, alert, and chart them in Grafana.
- [Amazon CloudWatch](../amazon-cloudwatch/) — Metrics, logs, alarms and dashboards for AWS resources and your applications, in one monitoring service.
- [Distributed Tracing](../distributed-tracing/) — Propagate a trace context across services and assemble the spans into one timeline.
- [Centralized Logging](../centralized-logging/) — Ship structured logs from every service to one searchable store, correlated by request ID.
- [Telemetry Pipeline (OpenTelemetry)](../telemetry-pipeline/) — Receive, process and export traces, metrics and logs through one vendor-neutral collector.
- [Health Endpoint Monitoring](../health-endpoint-monitoring/) — Expose liveness and readiness checks that load balancers and monitors probe.
- [Incident Management](../incident-management/) — A practised response when production breaks: declare early, assign roles, mitigate first and keep everyone informed.

## References

- [Google SRE Book — Monitoring Distributed Systems (chapter 6, the four golden signals)](https://sre.google/sre-book/monitoring-distributed-systems/)
- [Rob Ewaschuk — My Philosophy on Alerting](https://docs.google.com/document/d/199PqyG3UsyXlwieHaqbGiWVa8eMWi8zzAn0YfcApr8Q/edit)
- [Tom Wilkie — The RED Method: key metrics for microservices architecture (Weaveworks blog, 2017; archived copy)](https://web.archive.org/web/20240114064147/https://www.weave.works/blog/the-red-method-key-metrics-for-microservices-architecture/)
- [Grafana Labs blog — The RED Method: How to Instrument Your Services (Julie Dam, 2018, on Tom Wilkie's GrafanaCon EU talk)](https://grafana.com/blog/the-red-method-how-to-instrument-your-services/)
- [Brendan Gregg — The USE Method](https://www.brendangregg.com/usemethod.html)
- [Brendan Gregg — USE Method: Linux Performance Checklist](https://www.brendangregg.com/USEmethod/use-linux.html)
- [Grafana documentation — Grafana dashboard best practices](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/)
- [Prometheus — Histograms and summaries](https://prometheus.io/docs/practices/histograms/)
- [Prometheus — Alerting (best practices)](https://prometheus.io/docs/practices/alerting/)
- [Amazon CloudWatch — Metrics concepts (percentiles)](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch_concepts.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
