<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🟧 AWS Services](../../README.md#aws-services)

# Amazon CloudWatch

> Metrics, logs, alarms and dashboards for AWS resources and your applications, in one monitoring service.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Amazon CloudWatch" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/amazon-cloudwatch.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | CloudWatch is the monitoring service built into AWS. Acme Shop's ALB publishes `TargetResponseTime` and `HTTPCode_Target_5XX_Count`, Lambda publishes `Errors` and `Duration` and ECS publishes `CPUUtilization`, each into its own namespace and with no setup, while Lambda and the Catalog service send their logs to the log groups `/aws/lambda/make-thumbnail` and `/ecs/catalog`, where Catalog's JSON lines also carry a custom metric. **Alarms** turn thresholds into actions (a page through Amazon SNS, more ECS tasks), and **dashboards** and **Logs Insights** queries let people look. |
| **2 · Metrics and logs** | A metric is a **namespace**, a **name** and a set of **dimensions**: `AWS/ApplicationELB`, `TargetResponseTime`, `LoadBalancer=app/acme-shop/50dc6c495c0c9188`. Each request adds a sample, and CloudWatch keeps statistics for every one-minute period (custom metrics can be high-resolution, down to one second): in the 10:41 minute 1,840 requests, an average of 0.21 s and a **p99** of 0.62 s. Catalog's log line in **embedded metric format** stays in `/ecs/catalog`, and CloudWatch extracts the custom metric `OrderLatency` (namespace `AcmeShop`, dimension `Service=catalog`) from it; a **Logs Insights** query counts the ERROR lines in `/ecs/catalog` per 5 minutes. |
| **3 · Alarms and actions** | From 10:42 the p99 climbs to 1.4 s. The alarm `latency` (p99 above 1 s, 60-second periods, 3 of 5 datapoints) finds 1.12, 1.31 and 1.40 s among the last five minutes and goes from OK to **ALARM**; `errors` (more than 50 5xx responses a minute) breaches too, so the **composite alarm** `impact`, `ALARM("latency") AND ALARM("errors")`, notifies the SNS topic that pages the on-call engineer. Paging only on the composite cuts noise, and an **anomaly detection** band learned from the metric's history could replace the fixed 1 s threshold. CPU reaches 85% against target tracking's 60%, so the alarm that target tracking created has Application Auto Scaling raise the `catalog` service from 3 tasks to 5. |
| **4 · Limits and costs** | In us-east-1 (October 2026) a classic custom metric costs $0.30 a month for the first 10,000, and each combination of dimensions is a metric of its own: adding `userId` for 50,000 users to `OrderLatency` makes up to 50,000 metrics and up to $7,000 a month. Logs cost $0.50 per GB ingested and $0.03 per GB-month stored, Logs Insights $0.005 per GB scanned, an alarm $0.10 per metric a month and a dashboard $3 a month. Metrics are kept for 15 months, rolled up as they age (one-minute data for 15 days, five-minute for 63, hourly for 455), log groups keep everything unless you set a retention, and CloudWatch runs only on AWS; the newer OpenTelemetry metrics, queried with PromQL, are billed per GB instead of per metric. |
<!-- END GENERATED: header -->

## The problem

Acme Shop runs on AWS. An Application Load Balancer sends shoppers' requests to the Catalog service, three tasks on [Amazon ECS](../amazon-ecs/) with Fargate, and [AWS Lambda](../aws-lambda/) functions such as `make-thumbnail` work in the background. When product pages turn slow at 10:45, the team needs answers fast: is every request slow or only the slowest few, since when, is the service also returning errors, and who should be woken up? There is no server to log into. Fargate tasks and Lambda execution environments come and go, and their local disks go with them, so the numbers (request counts, latencies, CPU) and the log lines have to leave each component as they are produced and land somewhere that keeps them, answers questions about them and acts when they cross a line.

Amazon CloudWatch is AWS's monitoring service for that job. Almost every AWS service already sends its metrics there without any setup, applications add their own metrics and logs, alarms turn thresholds into notifications and scaling, and dashboards and queries let people look. The work is in using it well: choosing statistics and alarm settings that catch real problems without paging for noise, and watching what custom metrics and logs cost.

## How it works

### Metrics

A **metric** is a time series identified by a **namespace** (`AWS/ApplicationELB`, `AWS/Lambda`, `AWS/ECS`, or your own, such as `AcmeShop`), a **name** (`TargetResponseTime`) and up to 30 **dimensions**, name/value pairs such as `LoadBalancer=app/acme-shop/50dc6c495c0c9188`. Each unique combination of dimensions is a separate metric, and you can read back only the combinations that were published. A metric exists only in the Region it was sent to; it can't be deleted, but it expires once it has received no data for 15 months.

- **AWS services publish on their own.** The ALB reports every 60 seconds while requests flow through it, and nothing when there is no traffic. Its `TargetResponseTime` is the time, in seconds, from the moment a request leaves the load balancer until the target starts sending response headers; `HTTPCode_Target_5XX_Count` counts the 5xx responses the targets returned (not those the load balancer generated). Lambda publishes `Invocations`, `Errors`, `Throttles` and `Duration` for each function, and ECS publishes `CPUUtilization` and `MemoryUtilization` for each cluster and service once a minute. EC2 sends basic monitoring every 5 minutes at no charge, and detailed monitoring every minute at the custom-metric price.
- **Statistics** summarise the data points of one period: `SampleCount`, `Sum`, `Average`, `Minimum`, `Maximum`, percentiles such as `p99`, and trimmed and winsorized means, trimmed counts and sums, percentile rank and the interquartile mean. For latency the average hides the slow tail; `p99` shows what the slowest 1% of requests wait. Percentiles need the raw values, so a custom metric sent only as pre-aggregated statistic sets has none (with a narrow exception), and no metric with negative values has them.
- **Periods and resolution.** A period is 1, 5, 10 or 30 seconds or a multiple of 60, and 60 by default. AWS services publish at standard resolution, with one-minute granularity; your own metrics can also be high-resolution, stored per second and read with sub-minute periods.
- **Retention and roll-ups.** Data points with periods under a minute are kept for 3 hours, one-minute data for 15 days, five-minute data for 63 days and hourly data for 455 days (15 months). Older data is rolled up rather than dropped: one-minute data is still there after 15 days at five-minute resolution, and after 63 days at one hour.

### Custom metrics: PutMetricData and the embedded metric format

Applications publish their own metrics in two ways.

- **`PutMetricData`** sends data points directly: up to 1,000 different metrics and 1 MB per request (gzip is allowed), and up to 150 values per metric in one request when you send `Values` with `Counts`, which keeps percentiles available. Time stamps can be up to two weeks in the past and two hours in the future, and `StorageResolution` 1 makes a metric high-resolution.
- **The embedded metric format (EMF)** puts metrics inside a structured log line. The JSON event carries an `_aws` object with a `Timestamp` in milliseconds and a `CloudWatchMetrics` list, each entry naming a `Namespace`, the `Dimensions` (sets of keys, at most 30 keys per set) and the `Metrics` (a name with an optional `Unit` and `StorageResolution`); the values themselves are ordinary top-level members of the line. When the line arrives in CloudWatch Logs, CloudWatch extracts the metrics asynchronously and keeps the line too, so the same event can be graphed, alarmed on and searched. Catalog's line in the diagram declares `OrderLatency` in `AcmeShop` with the dimension `Service`, and its members `"Service": "catalog"` and `"OrderLatency": 182` become one data point of the metric `AcmeShop` › `OrderLatency` › `Service=catalog`.
- EMF suits Lambda functions and containers. The code only writes to stdout: Lambda sends stdout to CloudWatch Logs, and on ECS the `awslogs` log driver does. The function or task needs `logs:PutLogEvents`, not `cloudwatch:PutMetricData`. AWS publishes open-source client libraries for Node.js, Python, Java and C#. One log event can define at most 100 metrics, extraction delivers each value at least once (a duplicate can occasionally appear), and you pay for the log ingestion plus every custom metric the lines create. Every distinct dimension value makes a new metric, so a request ID or user ID belongs in a plain member of the line, where Logs Insights can still find it, never in `Dimensions`.

### Querying metrics

- **Metric math** combines metrics in a graph or an alarm: `100 * m1 / m2` turns Lambda `Errors` and `Invocations` into an error rate, and functions such as `FILL`, `RATE`, `IF`, `METRICS()` and `ANOMALY_DETECTION_BAND` fill gaps and compute rates, conditions and expected ranges. An alarm on an expression is billed for each metric in it.
- **Metrics Insights** is a SQL dialect over metrics with up to two weeks of data. `SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/ECS", ClusterName, ServiceName) GROUP BY ServiceName ORDER BY AVG() DESC LIMIT 10` finds the ten busiest services in one query, and an alarm on such a query follows the fleet as services come and go. Queries in the console's query editor are free.
- **PromQL, for OpenTelemetry metrics.** The documentation now calls everything above *classic* metrics. *OpenTelemetry metrics* arrive at the OTLP endpoint `https://monitoring.<region>.amazonaws.com/v1/metrics`, keep open-source metric names and up to 150 labels per data point, and are queried with PromQL in Query Studio (generally available since June 2026) or through Prometheus-compatible APIs. AWS service metrics can be copied into that path with their resource tags as labels, which the documentation calls OTel enrichment.

### Alarms

A **metric alarm** watches one metric or one math expression and is always in one of three states: `OK`, `ALARM` or `INSUFFICIENT_DATA`. Three settings decide when it changes state:

- **Period**, the length of each data point: 60 seconds for `latency`.
- **EvaluationPeriods** (N), how many of the most recent data points to look at: 5.
- **DatapointsToAlarm** (M), how many of those must breach: 3. They don't have to be consecutive. This *M out of N* rule lets `latency` ignore one slow minute, yet fire when 1.12, 1.31 and 1.40 s fall within the same five minutes.

Alarms with periods of a minute or more are evaluated every minute over a sliding window, which can instead be aligned to the wall clock in a chosen time zone; high-resolution alarms, with 10-, 20- or 30-second periods, are evaluated every 10 seconds and cost more. Further settings and kinds:

- **`TreatMissingData`** says what a missing data point means: `missing` (the default: when every point in the window is missing, the alarm goes to `INSUFFICIENT_DATA`), `notBreaching`, `breaching` or `ignore` (keep the current state). The ALB reports nothing for a minute without traffic, so both of Acme Shop's ALB alarms treat missing data as `notBreaching`.
- **`EvaluateLowSampleCountPercentile`** decides whether a percentile alarm judges a period with too few samples to be statistically meaningful (`evaluate`, the default) or leaves its state unchanged (`ignore`).
- **Anomaly detection** replaces the fixed threshold with a band of expected values. CloudWatch trains a model for one metric and statistic on up to two weeks of history, following trends and hourly, daily and weekly patterns; you choose the band's width (the `2` in `ANOMALY_DETECTION_BAND(m1, 2)`), and the alarm fires above the band, below it or on either side. Such an alarm is billed as three metrics: the metric and the band's two edges.
- **Composite alarms** combine other alarms' states with `AND`, `OR` and `NOT` and the functions `ALARM()`, `OK()` and `INSUFFICIENT_DATA()`, and since November 2025 with `AT_LEAST`, for rules such as two of four volumes running low. `impact` is `ALARM("latency") AND ALARM("errors")`, so slow pages without errors, or a few errors at normal speed, page no one. A rule can reference up to 100 alarms, and an *actions suppressor* holds the composite's actions back while another alarm, a deployment in progress say, is in `ALARM`.
- **Query alarms**: an alarm on a Metrics Insights query covers a whole fleet and can track each matching time series on its own; a PromQL alarm does the same for OpenTelemetry metrics; and a log alarm runs a Logs Insights query on a schedule and applies M out of N to the results.

**Actions** run when an alarm changes state, not while it stays there: notify an Amazon SNS topic, invoke a Lambda function, stop, terminate, reboot or recover an EC2 instance, run an Auto Scaling policy, create a Systems Manager OpsItem or Incident Manager incident, or start a CloudWatch investigation. Auto Scaling actions are the exception and repeat every minute while the alarm stays in the state. Composite alarms can notify, invoke Lambda and open OpsItems, incidents and investigations, but can't take EC2 or Auto Scaling actions. Every state change is also an event on [Amazon EventBridge](../amazon-eventbridge/), and CloudWatch keeps 30 days of alarm history. In the diagram the CPU alarm belongs to the ECS service's **target tracking** policy: Application Auto Scaling creates and manages two alarms for it, a high one and a low one (the high one is named `TargetTracking-service/acme-shop/catalog-AlarmHigh-…`, `cpu-high` in the diagram), and with CPU at 85% against a 60% target it raises the desired count from 3 to 5 (3 × 85 ÷ 60 = 4.25, rounded up; see [autoscaling](../autoscaling/)).

### Logs

- **Log groups, streams and events.** A log event is a time stamp and a message of up to 1 MB. A log stream holds the events of one source: one container of an ECS task, named `catalog/catalog/<task ID>` with the `awslogs` stream prefix `catalog`, or one Lambda execution environment, named after the date, the function version and an ID. A log group holds streams that share retention, permissions and settings: `/ecs/catalog`, and `/aws/lambda/make-thumbnail`, the group Lambda uses by default.
- **Retention.** A log group keeps its events forever unless you set a retention of 1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1,096, 1,827, 2,192, 2,557, 2,922, 3,288 or 3,653 days. Expired events can take up to 72 hours to disappear.
- **Log classes.** *Standard* has every feature. *Infrequent Access* costs half as much to ingest but leaves out metric filters, subscription filters, EMF extraction, Live Tail and a few more features, and its events are read only through Logs Insights; it suits logs kept for audits and later investigations. A group's class is fixed when it is created. The *Delivery* class only passes Lambda logs on to Amazon S3 or Amazon Data Firehose and keeps them for two days. Separately, **Intelligent Tiering**, turned on per account and Region, moves stored data that hasn't been read for 30 days to an Infrequent Access storage tier and, after 90 days, to Archive Instant Access, at lower storage prices and with the same query experience.
- **Metric filters** turn matching log lines into metrics, up to 100 per log group, for logs you can't switch to EMF.
- **Subscription filters** stream matching events as they arrive to [Kinesis Data Streams](../amazon-kinesis-data-streams/), Amazon Data Firehose, a Lambda function or Amazon OpenSearch Service, up to five per log group: the usual feed for a [centralized logging](../centralized-logging/) or security pipeline. Logs can also be exported to S3.
- **Logs Insights** queries log groups in its own pipe language, in OpenSearch PPL or in OpenSearch SQL. It discovers the fields of JSON lines by itself and can use field indexes to skip events that lack an indexed field; an account runs up to 100 Logs Insights QL queries at once, a query stops after 60 minutes, results are kept for 7 days, and you pay per GB scanned.
- **Live Tail** streams new events from up to 10 log groups as they arrive, with filters and highlighting, for watching a deployment or an incident. It works on Standard log groups only and is billed per minute.

### Traces and application monitoring

- **AWS X-Ray** collects traces, the path of one request through the services it touches with the time spent in each call, and draws them as a trace map (see [distributed tracing](../distributed-tracing/)). The X-Ray SDKs and daemon entered maintenance mode on 25 February 2026, with releases for security fixes only; AWS recommends instrumenting with OpenTelemetry instead, through the AWS Distro for OpenTelemetry (ADOT) or by sending spans to CloudWatch's OTLP endpoint for traces.
- **Transaction Search** stores every span as a structured log event in the log group `aws/spans`, so all spans can be searched and analysed, not only a sample.
- **Application Signals** instruments Java, Python, Node.js and .NET services on EKS, ECS, EC2 and Lambda, shows each service's call volume, availability, latency, faults and errors with a map of its dependencies, and tracks service level objectives with burn-rate alarms (see [SLOs and error budgets](../slo-error-budgets/)).

### Synthetics, RUM, Container Insights and Lambda Insights

- **Synthetics canaries** are scripts in Node.js, Python or Java that run on a schedule as Lambda functions, call an API or drive a headless browser (Playwright, Puppeteer or Selenium) and record whether it worked: outside-in [health endpoint monitoring](../health-endpoint-monitoring/).
- **RUM** (real user monitoring) collects page load times, client-side errors and user behaviour from real browser sessions, and screen loads, app launches, crashes and network errors from mobile apps.
- **Container Insights** collects CPU, memory, disk and network metrics and diagnostics such as container restarts for ECS, EKS, Red Hat OpenShift on AWS and [Kubernetes](../kubernetes/) on EC2, Fargate included. It writes performance events in EMF, and the metrics are extracted from them.
- **Lambda Insights** adds a CloudWatch extension, shipped as a Lambda layer, that reports CPU time, memory, disk and network use and diagnostics such as cold starts for every invocation, also as EMF.

### Dashboards, accounts and Regions

- **Dashboards** are pages of widgets (graphs, single numbers, alarm states, Logs Insights results, text) that can mix data from several Regions and, with cross-account observability, several accounts. CloudWatch also builds **automatic dashboards** for each service at no charge.
- **Cross-account observability** links source accounts to a monitoring account in the same Region, with a sink in the monitoring account and a link in each source account, managed by Observability Access Manager. The monitoring account can then search the metrics, log groups, traces and Application Signals data of every linked account without copying them. Log and metric **centralization** do copy data into one account, across accounts and Regions.
- **Metric streams** push metrics continuously through Amazon Data Firehose to S3 or a third-party tool, as JSON or in OpenTelemetry format.

### Pricing

Prices in us-east-1 from the AWS Price List, October 2026; other Regions differ.

| Item | Price |
|---|---|
| Custom metric (classic), a month | $0.30 each for the first 10,000, $0.10 for the next 240,000, $0.05 for the next 750,000, $0.02 above 1,000,000; prorated by the hour |
| API requests | $0.01 per 1,000; `GetMetricData`: $0.01 per 1,000 metrics requested |
| OpenTelemetry metrics | $0.50 per GB ingested, 15 months of storage included; PromQL through the API $0.01 per million samples scanned, free in the console |
| Alarm, a month | $0.10 per metric at standard resolution, $0.30 at high resolution; composite $0.50 |
| Dashboard, a month | $3 |
| Logs ingested | $0.50 per GB (Standard class), $0.25 per GB (Infrequent Access); logs that AWS services deliver (vended logs) are tiered, from $0.50 per GB down to $0.05 |
| Logs stored | $0.03 per GB-month, compressed; with Intelligent Tiering $0.018 in the Infrequent Access tier and $0.006 in Archive Instant Access |
| Logs Insights | $0.005 per GB scanned |
| Live Tail | $0.01 per minute |

The free tier covers AWS services' basic monitoring metrics, 10 custom or detailed-monitoring metrics, 1 million API requests (not `GetMetricData`), 3 dashboards of up to 50 metrics, 10 alarm metrics, 5 GB of log data and 1,800 minutes of Live Tail a month. In the diagram, `OrderLatency` with `Service` alone is one metric, $0.30 a month; with `userId` added for 50,000 users it becomes up to 50,000 metrics, 10,000 × $0.30 + 40,000 × $0.10 = $7,000 a month if every user's series gets data in every hour, since a metric is billed for the hours in which it receives data.

## Where it fits

- **Solutions.** Nearly every workload on AWS uses it in some way: web applications and APIs behind load balancers, containers on ECS and EKS, serverless applications on Lambda, data pipelines and batch jobs. It receives the logs of many AWS services (VPC Flow Logs, for one), and its alarms are what scale fleets and page people.
- **Patterns in this catalog.** Alarms on load balancer and canary metrics implement [health endpoint monitoring](../health-endpoint-monitoring/); Application Signals SLOs with burn-rate alarms implement [SLOs and error budgets](../slo-error-budgets/); log groups with subscription filters feed [centralized logging](../centralized-logging/); X-Ray and Transaction Search provide [distributed tracing](../distributed-tracing/); the CloudWatch agent, the OTLP endpoints and CloudWatch pipelines make it the destination of a [telemetry pipeline](../telemetry-pipeline/); and its alarms drive [autoscaling](../autoscaling/), including target tracking for [Amazon ECS](../amazon-ecs/) services.
- **Usual neighbours.** [Amazon SNS](../amazon-sns/) for notifications (and through it email, SMS and the HTTPS endpoints of incident tools), [AWS Lambda](../aws-lambda/) for automated responses, Amazon EventBridge for alarm state changes, Application Auto Scaling and EC2 Auto Scaling, Kinesis Data Streams, Data Firehose and [OpenSearch](../elasticsearch/) for log pipelines, [Amazon S3](../amazon-s3/) for archives, Systems Manager for OpsItems and incidents, and Amazon Managed Grafana for dashboards over CloudWatch and other sources.
- **Managed offerings.** CloudWatch is itself the managed service, in every Region with nothing to run. Teams that prefer the open-source stack on AWS use Amazon Managed Service for Prometheus with Amazon Managed Grafana (see [Prometheus](../prometheus/)); Azure Monitor and Google Cloud's Cloud Monitoring and Cloud Logging play the same role on the other clouds.

## When to use it

Use CloudWatch for whatever runs on AWS: the service metrics are already there, Auto Scaling acts on its alarms, and EMF, the `awslogs` driver and the CloudWatch agent add your own metrics and logs with little code. Bring in Prometheus with Grafana, or a SaaS such as Datadog, when you want PromQL over many teams' labelled metrics in one place, one tool across several clouds and data centres, or features CloudWatch doesn't have. Many teams combine them: AWS metrics stay in CloudWatch, and Grafana or the SaaS reads them through the API or a metric stream.

| | Amazon CloudWatch | Prometheus with Grafana | Datadog |
|---|---|---|---|
| What it is | AWS's monitoring service: metrics, logs, alarms, dashboards, traces | Open-source metrics server and alert router, with Grafana for dashboards | Commercial SaaS for metrics, logs, traces and more |
| AWS services' metrics | Published automatically, no setup | Through exporters, or Grafana's CloudWatch data source | Through its AWS integration |
| Your metrics | `PutMetricData`, EMF log lines, the CloudWatch agent, OTLP | Scraped from `/metrics` endpoints; remote write and OTLP receivers can be turned on | The Datadog Agent and DogStatsD, OpenTelemetry |
| Queries | Metric math, Metrics Insights (SQL), Logs Insights; PromQL for OpenTelemetry metrics | PromQL | Datadog's own query editor |
| Keeps metrics | 15 months, rolled up as they age | 15 days by default on the server's disk; Amazon Managed Service for Prometheus 150 days by default, up to 1,095 | 15 months |
| Cost driver | Classic custom metrics per dimension combination, logs per GB, alarms, dashboards | Your servers; on the managed service, samples ingested, storage and query samples | Hosts, custom metrics (each metric name and tag-value combination), logs |
| Runs | Only as an AWS service, per account and Region | Anywhere you run it, or managed (Amazon Managed Service for Prometheus, Grafana Cloud) | Datadog's SaaS |

Figures from the Amazon CloudWatch, Prometheus, Amazon Managed Service for Prometheus and Datadog documentation and pricing pages, October 2026.

## Trade-offs

- **Cardinality costs money.** In classic metrics every dimension combination is a billed metric, so a `userId`, `requestId` or `podName` dimension multiplies the bill. OpenTelemetry metrics are billed per GB instead, so extra labels cost only the bytes they add.
- **Logs are usually the biggest line.** Ingestion is charged per GB, Logs Insights per GB scanned, and storage grows every month for groups that never expire. Set retention on every group, send chatty debug logs to Infrequent Access or not at all, and watch `IncomingBytes` in the `AWS/Logs` namespace per log group.
- **A view by the minute.** AWS services report at one-minute granularity (EC2 basic monitoring every five), alarms evaluate once a minute, and an M-out-of-N alarm needs M bad minutes, so `latency` fires three minutes into a slowdown at the earliest. High resolution shortens that and costs more.
- **Querying is narrower than PromQL or a dedicated tool** for classic metrics: metric math and Metrics Insights handle most dashboards and alarms, but joining series across label sets, long ad-hoc analyses and correlation across signals are easier elsewhere. PromQL on OpenTelemetry metrics closes part of the gap.
- **Scoped to accounts and Regions.** Metrics live in their Region, cross-account observability works within a Region, and centralizing data across Regions copies it at a cost.
- **AWS only.** Alarms, dashboards, queries and the agent's configuration are AWS resources; moving to another platform means rebuilding them. Instrumenting with OpenTelemetry keeps the application side portable.
- **Sparse data needs care.** A metric that reports nothing when idle sends its alarms to `INSUFFICIENT_DATA` under the default `missing` setting, so choose `TreatMissingData` on purpose; and percentiles over a handful of night-time requests swing widely.

## Implementation notes

**Catalog's EMF line**, printed as one line to stdout; `orderId` stays searchable without becoming a dimension:

```json
{
  "_aws": {
    "Timestamp": 1791369690000,
    "CloudWatchMetrics": [
      {
        "Namespace": "AcmeShop",
        "Dimensions": [["Service"]],
        "Metrics": [{ "Name": "OrderLatency", "Unit": "Milliseconds" }]
      }
    ]
  },
  "Service": "catalog",
  "OrderLatency": 182,
  "orderId": "o-1042",
  "level": "INFO"
}
```

**The two metric alarms.** Neither has an action of its own; the composite alarm pages. The account ID and the load balancer's ID are examples:

```sh
aws cloudwatch put-metric-alarm \
  --alarm-name latency \
  --namespace AWS/ApplicationELB --metric-name TargetResponseTime \
  --dimensions Name=LoadBalancer,Value=app/acme-shop/50dc6c495c0c9188 \
  --extended-statistic p99 --period 60 \
  --evaluation-periods 5 --datapoints-to-alarm 3 \
  --threshold 1 --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching

aws cloudwatch put-metric-alarm \
  --alarm-name errors \
  --namespace AWS/ApplicationELB --metric-name HTTPCode_Target_5XX_Count \
  --dimensions Name=LoadBalancer,Value=app/acme-shop/50dc6c495c0c9188 \
  --statistic Sum --period 60 \
  --evaluation-periods 5 --datapoints-to-alarm 3 \
  --threshold 50 --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching
```

**The composite alarm that pages:**

```sh
aws cloudwatch put-composite-alarm \
  --alarm-name impact \
  --alarm-rule 'ALARM("latency") AND ALARM("errors")' \
  --alarm-actions arn:aws:sns:us-east-1:111122223333:acme-oncall
```

**The Logs Insights query** from the diagram, over the five 5-minute bins from 10:15 to 10:40 UTC on 7 October 2026 (the times are epoch seconds):

```sh
aws logs start-query \
  --log-group-name /ecs/catalog \
  --start-time 1791368100 --end-time 1791369600 \
  --query-string 'filter @message like /ERROR/ | stats count(*) as errors by bin(5m)'
```

**Retention**, set where the log group is created, since Lambda creates its group on first use with no retention:

```sh
aws logs put-retention-policy --log-group-name /ecs/catalog --retention-in-days 30
```

- **Page on symptoms, file the rest.** Page on what users feel (`impact`, an SLO burn rate, a failing canary) and send cause alarms such as CPU, queue depth or disk to a ticket or chat topic, so the on-call engineer is woken once per incident.
- **Choose the statistic for the question.** `p99` or `p95` for latency, `Sum` for counts, `Maximum` for saturation. A percentile alarm on a quiet service may want `EvaluateLowSampleCountPercentile` set to `ignore`.
- **Prefer EMF to `PutMetricData` on hot paths.** A log line costs no extra API call and keeps the context for later queries; send `PutMetricData` from batch jobs or when you need a metric without the log line.
- **Keep dimensions few and bounded:** service, operation, status class, Availability Zone. Anything with thousands of values belongs in the log line.
- **Manage alarms and dashboards as code** (CloudFormation, CDK or Terraform), next to the services they watch, and test them with `SetAlarmState`, which sets a state until the next evaluation.
- **Look before you scan.** Narrow the time range and the log groups before running Logs Insights queries over large groups, and use field indexes for fields you filter on often; both cut the bytes scanned that you pay for.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Health Endpoint Monitoring](../health-endpoint-monitoring/) — Expose liveness and readiness checks that load balancers and monitors probe.
- [SLOs & Error Budgets](../slo-error-budgets/) — Measure SLIs against an objective and alert on error-budget burn rate, not on every blip.
- [Centralized Logging](../centralized-logging/) — Ship structured logs from every service to one searchable store, correlated by request ID.
- [Distributed Tracing](../distributed-tracing/) — Propagate a trace context across services and assemble the spans into one timeline.
- [Telemetry Pipeline (OpenTelemetry)](../telemetry-pipeline/) — Receive, process and export traces, metrics and logs through one vendor-neutral collector.
- [Autoscaling](../autoscaling/) — Add and remove instances automatically as load rises and falls.
- [Prometheus & Grafana](../prometheus/) — Pull-based monitoring: scrape metrics into a time-series database, query them with PromQL, alert, and chart them in Grafana.
- [Amazon SNS](../amazon-sns/) — Managed publish-subscribe: a message published to a topic fans out to queues, functions, HTTP endpoints, email and SMS.
- [Amazon ECS & Fargate](../amazon-ecs/) — Run containers on AWS: task definitions, services that keep tasks running behind a load balancer, on EC2 or serverless Fargate.
- [AWS Lambda](../aws-lambda/) — Functions as a service: code runs per event in managed execution environments that scale out with concurrency.

## References

- [Amazon CloudWatch User Guide — Metrics concepts](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch_concepts.html)
- [Amazon CloudWatch User Guide — CloudWatch statistics definitions](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Statistics-definitions.html)
- [Amazon CloudWatch User Guide — CloudWatch Metrics (Classic)](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/metrics-classic.html)
- [Amazon CloudWatch User Guide — Publish custom metrics (PutMetricData / EMF)](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/publishingMetrics.html)
- [Amazon CloudWatch User Guide — Embedding metrics within logs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format.html)
- [Amazon CloudWatch User Guide — Specification: Embedded metric format](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html)
- [Amazon CloudWatch User Guide — Creating logs in embedded metric format using the client libraries](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Libraries.html)
- [Amazon CloudWatch User Guide — Using the PutLogEvents API to send manually-created embedded metric format logs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Generation_PutLogEvents.html)
- [Amazon CloudWatch User Guide — Math expressions with metrics](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/using-metric-math.html)
- [Amazon CloudWatch User Guide — Query your CloudWatch metrics with CloudWatch Metrics Insights](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/query_with_cloudwatch-metrics-insights.html)
- [Amazon CloudWatch User Guide — Query components and syntax in CloudWatch Metrics Insights](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch-metrics-insights-querylanguage.html)
- [Amazon CloudWatch User Guide — OpenTelemetry Metrics (Recommended)](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/metrics-otel-recommended.html)
- [Amazon CloudWatch User Guide — CloudWatch OpenTelemetry Metrics](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/metrics-otel-overview.html)
- [Amazon CloudWatch User Guide — OTel metrics pricing and storage](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/metrics-otel-pricing.html)
- [Amazon CloudWatch User Guide — Query metrics with PromQL](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-PromQL.html)
- [Amazon CloudWatch User Guide — AWS vended metrics in OpenTelemetry format](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-OTelEnrichment.html)
- [Amazon CloudWatch User Guide — OTLP Endpoints](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-OTLPEndpoint.html)
- [Amazon CloudWatch User Guide — Using Amazon CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Alarms.html)
- [Amazon CloudWatch User Guide — Alarm evaluation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarm-evaluation.html)
- [Amazon CloudWatch User Guide — Configuring how CloudWatch alarms treat missing data](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarms-and-missing-data.html)
- [Amazon CloudWatch User Guide — Alarm actions](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarm-actions.html)
- [Amazon CloudWatch User Guide — Create a composite alarm](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Create_Composite_Alarm.html)
- [Amazon CloudWatch User Guide — Using CloudWatch anomaly detection](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Anomaly_Detection.html)
- [Amazon CloudWatch User Guide — Create a CloudWatch alarm based on anomaly detection](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Create_Anomaly_Detection_Alarm.html)
- [Amazon CloudWatch User Guide — PromQL alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarm-promql.html)
- [Amazon CloudWatch User Guide — CloudWatch service quotas](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch_limits.html)
- [Amazon CloudWatch User Guide — CloudWatch cross-account observability](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Unified-Cross-Account.html)
- [Amazon CloudWatch User Guide — Use metric streams](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Metric-Streams.html)
- [Amazon CloudWatch User Guide — Container Insights](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/ContainerInsights.html)
- [Amazon CloudWatch User Guide — Lambda Insights](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Lambda-Insights.html)
- [Amazon CloudWatch User Guide — Synthetic monitoring (canaries)](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Synthetics_Canaries.html)
- [Amazon CloudWatch User Guide — CloudWatch RUM](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-RUM.html)
- [Amazon CloudWatch User Guide — Application Signals](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Monitoring-Sections.html)
- [Amazon CloudWatch User Guide — Transaction Search](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Transaction-Search.html)
- [Amazon CloudWatch Logs User Guide — Amazon CloudWatch Logs concepts](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CloudWatchLogsConcepts.html)
- [Amazon CloudWatch Logs User Guide — Working with log groups and log streams (retention)](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/Working-with-log-groups-and-streams.html)
- [Amazon CloudWatch Logs User Guide — Log classes](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CloudWatch_Logs_Log_Classes.html)
- [Amazon CloudWatch Logs User Guide — Optimize storage costs with CloudWatch Logs Intelligent Tiering](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/cwl_intelligent_tier.html)
- [Amazon CloudWatch Logs User Guide — Creating metrics from log events using filters](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/MonitoringLogData.html)
- [Amazon CloudWatch Logs User Guide — Real-time processing of log data with subscriptions](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/Subscriptions.html)
- [Amazon CloudWatch Logs User Guide — Log group-level subscription filters](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/SubscriptionFilters.html)
- [Amazon CloudWatch Logs User Guide — Analyzing log data with CloudWatch Logs Insights](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/AnalyzingLogData.html)
- [Amazon CloudWatch Logs User Guide — Logs Insights query syntax: filter](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-Filter.html)
- [Amazon CloudWatch Logs User Guide — Logs Insights query syntax: stats](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-Stats.html)
- [Amazon CloudWatch Logs User Guide — Troubleshoot with CloudWatch Logs Live Tail](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CloudWatchLogs_LiveTail.html)
- [Amazon CloudWatch Logs User Guide — Monitoring with CloudWatch metrics (IncomingBytes)](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CloudWatch-Logs-Monitoring-CloudWatch-Metrics.html)
- [Amazon CloudWatch Logs User Guide — CloudWatch Logs quotas](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/cloudwatch_limits_cwl.html)
- [Amazon CloudWatch API Reference — PutMetricData](https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_PutMetricData.html)
- [Amazon CloudWatch API Reference — PutMetricAlarm](https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_PutMetricAlarm.html)
- [Amazon CloudWatch API Reference — PutCompositeAlarm](https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_PutCompositeAlarm.html)
- [Amazon CloudWatch Logs API Reference — PutRetentionPolicy](https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_PutRetentionPolicy.html)
- [AWS CLI — aws cloudwatch put-metric-alarm](https://docs.aws.amazon.com/cli/latest/reference/cloudwatch/put-metric-alarm.html)
- [AWS CLI — aws cloudwatch put-composite-alarm](https://docs.aws.amazon.com/cli/latest/reference/cloudwatch/put-composite-alarm.html)
- [AWS CLI — aws logs start-query](https://docs.aws.amazon.com/cli/latest/reference/logs/start-query.html)
- [AWS CLI — aws logs put-retention-policy](https://docs.aws.amazon.com/cli/latest/reference/logs/put-retention-policy.html)
- [Amazon CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/)
- [Elastic Load Balancing — CloudWatch metrics for your Application Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-cloudwatch-metrics.html)
- [AWS Lambda Developer Guide — Types of metrics for Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-types.html)
- [AWS Lambda Developer Guide — Configuring CloudWatch log groups](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-loggroups.html)
- [AWS Lambda Developer Guide — Viewing CloudWatch logs for Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-view.html)
- [Amazon ECS Developer Guide — Amazon ECS CloudWatch metrics](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/available-metrics.html)
- [Application Auto Scaling — Target tracking scaling policies](https://docs.aws.amazon.com/autoscaling/application/userguide/application-auto-scaling-target-tracking.html)
- [Application Auto Scaling — Create a target tracking scaling policy using the AWS CLI](https://docs.aws.amazon.com/autoscaling/application/userguide/create-target-tracking-policy-cli.html)
- [AWS X-Ray Developer Guide — What is AWS X-Ray?](https://docs.aws.amazon.com/xray/latest/devguide/aws-xray.html)
- [AWS X-Ray Developer Guide — Instrumenting your application (SDK and daemon maintenance notice)](https://docs.aws.amazon.com/xray/latest/devguide/xray-instrumenting-your-app.html)
- [AWS What's New (Nov 2025) — Amazon CloudWatch Composite Alarms adds threshold-based alerting](https://aws.amazon.com/about-aws/whats-new/2025/11/amazon-cloudwatch-composite-alarms-threshold-based/)
- [AWS What's New (Apr 2026) — Amazon CloudWatch introduces PromQL querying with Query Studio Preview](https://aws.amazon.com/about-aws/whats-new/2026/04/amazon-cloudwatch-query-studio-preview/)
- [AWS What's New (Jun 2026) — Amazon CloudWatch Query Studio is now generally available](https://aws.amazon.com/about-aws/whats-new/2026/06/amazon-cloudwatch-query-studio-generally-available/)
- [Amazon Managed Service for Prometheus — What is Amazon Managed Service for Prometheus?](https://docs.aws.amazon.com/prometheus/latest/userguide/what-is-Amazon-Managed-Service-Prometheus.html)
- [Amazon Managed Service for Prometheus pricing](https://aws.amazon.com/prometheus/pricing/)
- [Amazon Managed Grafana — What is Amazon Managed Grafana?](https://docs.aws.amazon.com/grafana/latest/userguide/what-is-Amazon-Managed-Service-Grafana.html)
- [Prometheus documentation — Storage (retention defaults)](https://prometheus.io/docs/prometheus/latest/storage/)
- [Datadog documentation — Custom Metrics Billing](https://docs.datadoghq.com/account_management/billing/custom_metrics/)
- [Datadog documentation — Data Retention Periods](https://docs.datadoghq.com/data_security/data_retention_periods/)
- [Datadog pricing](https://www.datadoghq.com/pricing/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
