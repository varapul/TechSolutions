<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧱 System Components](../../README.md#system-components)

# System Map

> One request and one event through a typical system: DNS, CDN, load balancer, gateway, services, cache, database, queue and search.

<p align="center"><img src="diagram.svg" alt="Animated diagram: System Map" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/system-map.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · A page view** | The browser resolves **shop.example** in DNS and loads images and scripts from the nearest **CDN** edge. Its API call `GET /products/42` passes the **load balancer** and the **API gateway**, which checks the token and the rate limit, to the **Catalog** service, which finds product 42 in the **cache** (Redis) and answers without querying the **database**. |
| **2 · An order, one transaction** | `POST /orders` takes the same path to the **Orders** service. One **database transaction** writes order 1001 and an `OrderPlaced` row in an **outbox** table, and the customer gets **201 Created** as soon as it commits. Nothing else is called while the customer waits. |
| **3 · The event fans out** | The **outbox relay** publishes `OrderPlaced` to the **event stream** (topic `orders`). Three consumer groups read it independently: the **Email worker** (a Lambda function) sends the confirmation, the **Search indexer** adds order 1001 to the search index and the **analytics loader** stores the event in the **data lake** on S3. All of it happens after the customer already has the response. |
| **4 · Running it** | Every box sends metrics, logs and traces to **observability** (Prometheus and Grafana, or CloudWatch). When the **Search indexer** crashes, orders 1002–1004 still succeed and their events wait in the stream; the dashboard shows the search group's **consumer lag** climbing to 3, and search results stay behind until the indexer is back. That delay is the price of the asynchronous half: **eventual consistency**. |
<!-- END GENERATED: header -->

## The problem

Most systems start as one service in front of one database, and for a while that is all they need. Then pressure arrives, one kind at a time: the same product page is read over and over, sending the confirmation email inside the checkout makes the customer wait on a mail service, the search box needs typo tolerance that SQL `LIKE` cannot give, and images travel from one data centre to customers on every continent. Each pressure has a well-known component that relieves it, and each component is a product with its own vocabulary: Kafka, Redis, an API gateway, a CDN.

Learning those products one at a time hides the questions that matter when you design: where does each one sit, what talks to it, and what changes in the rest of the system once it is there? This page is the map for the *System Components* and *AWS Services* pages of this catalog. It follows one page view and one order through an ordinary online shop, Acme Shop, so that every other page can be placed on it.

## How it works

The shop has two halves, and the dotted line between them is the most useful thing on the map.

### The synchronous half: the customer waits

Everything above the line happens while the customer waits for an answer, so every box there adds latency and every box there can fail the request.

- **DNS** turns `shop.example` into addresses. In Amazon Route 53 an *alias record* can point a name, even the zone apex, straight at a CloudFront distribution or a load balancer, and Route 53 follows that resource when its addresses change.
- The **CDN** serves images and scripts from an edge location near the customer. CloudFront routes each request to the edge location with the lowest latency and answers from its cache when it can; only misses travel on to the origin ([CDN edge caching](../cdn-edge-caching/)).
- The **load balancer** spreads requests over healthy instances ([load balancing](../load-balancing/)). An Application Load Balancer works at layer 7, so it can route by path or host name; NGINX does the same job when you run it yourself.
- The **API gateway** is the front door for the APIs. It checks the caller's token and applies rate limits before any service sees the request ([API gateway](../api-gateway/)). Amazon API Gateway can validate JWTs with a JWT authorizer on HTTP APIs, and it throttles with a token bucket, answering `429 Too Many Requests` when the bucket is empty; Kong does the same work through plugins.
- The **services** hold the business logic. Catalog serves `/products` and Orders serves `/orders`; both run as containers, scheduled by Kubernetes or Amazon ECS.
- The **cache** keeps hot data in memory. In step 1 the Catalog service finds product 42 in Redis and answers without querying the database ([cache-aside](../cache-aside/)); the dashed line is the path a miss would take.
- The **database** is the system of record: PostgreSQL, run by you or by Amazon RDS or Aurora.

### The order: one transaction, then the answer

The order in step 2 is where the two halves meet. The Orders service has to store order 1001 *and* tell the rest of the shop about it. Doing that as two writes, first the database and then a message broker, loses one of them whenever the process dies in between. So it writes both in **one database transaction**, the order row and an `OrderPlaced` row in an **outbox** table, and answers `201 Created` as soon as the transaction commits ([transactional outbox](../transactional-outbox/)). The confirmation email, the search index and the analytics copy are not on the request path at all: the customer has the answer before any of them starts.

### The asynchronous half: after the response

- The **outbox relay** reads committed outbox rows and publishes them. It can poll the table or follow the database's change log; Debezium's Outbox Event Router does the second for PostgreSQL ([change data capture](../change-data-capture/)).
- The **event stream** keeps `OrderPlaced` on the topic `orders` and lets every interested consumer read it at its own pace ([publish-subscribe](../publish-subscribe/), [event-driven architecture](../event-driven-architecture/)). With Kafka each consumer group keeps its own position in the log; with Amazon SNS fanning out to Amazon SQS each subscriber gets its own queue. Either way a slow or broken consumer holds back only itself.
- **Workers** do the follow-up work: the Email worker (a Lambda function), the Search indexer (a container) and the analytics loader (Kafka Connect, or Amazon Data Firehose). Several copies of one worker can split a group's work between them as [competing consumers](../competing-consumers/).
- **Email sending** goes through a mail service such as Amazon SES, or a mail server you run, such as Postfix.
- **Search** (OpenSearch or Elasticsearch) answers the queries SQL handles badly: full text, typos, relevance ranking, facets. It holds a copy of data owned elsewhere, kept current by the indexer.
- The **data lake** keeps every event in Amazon S3 for analytics.

### Observability across both halves

Every box sends **metrics, logs and traces** to one place: Prometheus scraping metrics and Grafana charting them, or Amazon CloudWatch. It is how the failure in step 4 gets noticed at all. When the Search indexer crashes, nothing on the request path fails: orders 1002 to 1004 succeed, their events wait in the stream, and the symptom is the **consumer lag** of the `search` group climbing to 3 on the dashboard while search results fall behind the database. A trace that crosses the stream needs the trace context carried inside the event ([distributed tracing](../distributed-tracing/)), and logs from every box need one home ([centralized logging](../centralized-logging/)).

## Where it fits

This page is the map; the other pages zoom in. Each row is a role, with the products that usually fill it and the patterns of this catalog it implements or supports.

| Role | What it does in Acme Shop | Open source | AWS | Patterns |
|---|---|---|---|---|
| DNS | Turns `shop.example` into addresses | Usually a managed service | Amazon Route 53 | [Active-passive failover](../active-passive-failover/) |
| CDN | Serves images and scripts from the edge | Usually a managed service | Amazon CloudFront | [CDN edge caching](../cdn-edge-caching/) |
| Load balancer | Spreads requests over healthy instances | NGINX | Elastic Load Balancing (ALB) | [Load balancing](../load-balancing/), [health endpoint monitoring](../health-endpoint-monitoring/) |
| API gateway | Checks tokens, limits rates, routes to services | Kong | Amazon API Gateway | [API gateway](../api-gateway/), [rate limiting](../rate-limiting/), [gateway offloading](../gateway-offloading/), [JWT validation](../jwt-validation/) |
| Services | Business logic, run as containers | Kubernetes | Amazon ECS, Amazon EKS | [Microservices](../microservices/), [autoscaling](../autoscaling/) |
| Cache | Keeps hot reads in memory | Redis, Valkey | Amazon ElastiCache | [Cache-aside](../cache-aside/) |
| Database | Stores orders; one transaction per order | PostgreSQL | Amazon RDS, Amazon Aurora | [Transactional outbox](../transactional-outbox/), [read replicas](../read-replicas/) |
| Outbox relay | Publishes committed outbox rows | Debezium | — | [Change data capture](../change-data-capture/) |
| Event stream or queue | Keeps events; each consumer reads at its own pace | Apache Kafka | Amazon MSK; Amazon SNS with Amazon SQS | [Publish-subscribe](../publish-subscribe/), [event-driven architecture](../event-driven-architecture/), [queue-based load leveling](../queue-based-load-leveling/) |
| Workers | Do follow-up work off the request path | Kafka Connect, any container | AWS Lambda, Amazon Data Firehose | [Competing consumers](../competing-consumers/), [web-queue-worker](../web-queue-worker/), [idempotent consumer](../idempotent-consumer/) |
| Search | Full-text queries over a copy of the data | OpenSearch, Elasticsearch | Amazon OpenSearch Service | [CQRS](../cqrs/), [materialized view](../materialized-view/) |
| Email sending | Delivers the confirmation | Postfix | Amazon SES | — |
| Data lake | Keeps every event for analytics | — | Amazon S3 | [Medallion architecture](../medallion-architecture/) |
| Observability | Metrics, logs, traces and alerts | Prometheus, Grafana, OpenTelemetry | Amazon CloudWatch | [Distributed tracing](../distributed-tracing/), [centralized logging](../centralized-logging/), [telemetry pipeline](../telemetry-pipeline/) |

Component pages: [Apache Kafka](../kafka/), [RabbitMQ](../rabbitmq/), [Redis & Valkey](../redis/), [PostgreSQL](../postgresql/), [Amazon S3](../amazon-s3/), [Amazon SQS](../amazon-sqs/), [Amazon DynamoDB](../amazon-dynamodb/) and [AWS Lambda](../aws-lambda/) so far, with MongoDB, Apache Cassandra, Elasticsearch & OpenSearch, NGINX, Docker, Kubernetes, etcd, Prometheus & Grafana, HashiCorp Vault, Keycloak, Apache Flink, Amazon VPC, Amazon SNS, Amazon EventBridge, Amazon Kinesis Data Streams, Amazon RDS & Aurora, AWS Step Functions, Amazon ECS & Fargate, Amazon Route 53, AWS IAM, Amazon Cognito and Amazon CloudWatch planned.

Licences matter when you choose, and several changed recently (checked October 2026):

- **Redis** 8 and later is offered under a choice of RSALv2, SSPLv1 or AGPLv3. **Valkey**, forked from Redis just before Redis moved to source-available licences and backed by the Linux Foundation, is BSD-licensed, and Amazon ElastiCache offers Valkey, Memcached and Redis OSS.
- **Elasticsearch** added AGPLv3 in 2024 as a third option next to SSPL and the Elastic License 2.0. **OpenSearch**, the fork of Elasticsearch 7.10, is Apache 2.0 and a Linux Foundation project; Amazon OpenSearch Service runs OpenSearch and legacy Elasticsearch OSS up to 7.10.
- **Grafana** moved to AGPLv3 in 2021. **Kong** Gateway's source is Apache 2.0, and **NGINX** uses a two-clause BSD licence.

## When to use it

Start with one service and one database, and add a part when its pressure shows up in measurements, not in advance. A shop with a few hundred orders a day may need nothing from the asynchronous half: one service, PostgreSQL and a CDN go a long way.

| Add | When | What it costs |
|---|---|---|
| A CDN | Static files are a large share of the traffic, or customers are far from the servers | Another cache to invalidate: ship files under versioned names |
| A cache | Reads dominate and the same items are read again and again | Stale reads, invalidation rules, and a database that must survive a cold cache |
| A load balancer and more instances | One instance is no longer enough, or must not be a single point of failure | Health checks, and state that has to live outside the instances |
| An API gateway | Several services and clients share auth, rate limits and routing | Another hop on every request, which must itself stay highly available |
| A queue | Work can wait, or arrives in bursts | At-least-once delivery, retries and a dead-letter queue to watch |
| A stream | Several consumers need the same events, or need to replay them | A cluster or service to run, lag to watch, and event schemas that become a contract |
| Search | Queries outgrow SQL: full text, typos, ranking, facets | A second copy of the data that lags behind, and reindexing |

## Trade-offs

- **Every box is another thing to run.** Each needs patching, capacity planning, backups or replicas, alerts and a budget line, managed service or not.
- **Every hop is another way to fail.** The synchronous half is only as available as the chain of boxes the customer waits on, so each call there needs a timeout, and retries need limits.
- **The asynchronous half lags.** In step 4 search is 3 orders behind the database. That is eventual consistency: the interface has to say "we will email you", and a search that cannot find a brand-new order has to be acceptable.
- **Delivery is at least once.** Brokers and Lambda event source mappings can deliver an event twice, so every consumer must be [idempotent](../idempotent-consumer/).
- **Failures go quiet.** A crashed consumer breaks no request. Without consumer lag on a dashboard and an alert on it, the first report comes from a customer.

## Implementation notes

- **Write the order and the outbox row in one transaction.** With Debezium's default column names, the order in step 2 is:

  ```sql
  BEGIN;
  INSERT INTO orders (id, total) VALUES (1001, 59.90);
  INSERT INTO outbox (id, aggregatetype, aggregateid, type, payload)
  VALUES (gen_random_uuid(), 'order', '1001', 'OrderPlaced',
          '{"orderId": 1001, "total": 59.90}');
  COMMIT;
  ```

  The outbox `id` travels with the event as a header, which gives consumers a key for dropping duplicates. Debezium names the topic `outbox.event.` plus the `aggregatetype` value by default; set `route.topic.replacement` to publish to a topic such as `orders` instead.
- **Watch lag per consumer group.** For Kafka, describe the group; the `LAG` column is `LOG-END-OFFSET` minus `CURRENT-OFFSET` for each partition:

  ```sh
  bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group search
  ```

  Amazon MSK publishes consumer-lag metrics such as `MaxOffsetLag` and `EstimatedMaxTimeLag` to CloudWatch or to Prometheus, and for SQS the equivalents are `ApproximateNumberOfMessagesVisible` and `ApproximateAgeOfOldestMessage`. Alert on lag that keeps growing, not on a single non-zero value.
- **Catch up within the retention.** Waiting events are only safe for as long as the stream keeps them: 168 hours (7 days) by default for a Kafka 4.3 broker (`log.retention.hours`), and 4 days by default for an SQS queue, adjustable from 1 minute to 14 days. A Kafka consumer that restarts resumes from its group's last committed offset, and an SQS consumer finds its messages still waiting; either way it has to catch up before that window closes.
- **Give the cache a TTL and delete on write.** A key that expires on its own bounds how stale a read can get, even when an invalidation is lost.
- **Throttle at the gateway and back off at the client.** A `429` from the gateway is a signal for the client to slow down, not to retry at once.
- **Carry the trace context inside events.** Put it in the message headers so the asynchronous half shows up in the same trace as the request that caused it; OpenTelemetry has conventions for Kafka, SQS and SNS.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Apache Kafka](../kafka/) — A partitioned, replicated commit log: producers append events, consumer groups read at their own pace and can replay history.
- [Redis & Valkey](../redis/) — An in-memory data-structure server: cache, session store, rate limiter, leaderboard and lightweight queue in one process.
- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [Amazon SQS](../amazon-sqs/) — A managed message queue: consumers poll, a visibility timeout hides messages in flight, and repeated failures go to a dead-letter queue.
- [AWS Lambda](../aws-lambda/) — Functions as a service: code runs per event in managed execution environments that scale out with concurrency.
- [Amazon S3](../amazon-s3/) — Object storage: objects in buckets, addressed by key, stored across Availability Zones, with storage classes, versioning and events.
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- [Cache-Aside](../cache-aside/) — Read from the cache first; on a miss load from the database and populate the cache.
- [Transactional Outbox](../transactional-outbox/) — Save the event in the same database transaction as the data, then relay it: no dual-write gap.
- [Load Balancing](../load-balancing/) — Spread requests across healthy instances and stop sending to unhealthy ones.

## References

- [AWS Well-Architected Framework](https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html)
- [AWS Architecture Center — Reference architecture examples and best practices](https://aws.amazon.com/architecture/)
- [Azure Architecture Center — Web-Queue-Worker architecture style](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/web-queue-worker)
- [Martin Kleppmann & Chris Riccomini — Designing Data-Intensive Applications, 2nd Edition (O'Reilly, 2026)](https://martin.kleppmann.com/2026/03/24/designing-data-intensive-applications-2e.html)
- [RFC 9110 — HTTP Semantics, §15.3.2 201 Created](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.2)
- [Amazon Route 53 — Choosing between alias and non-alias records](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-choosing-alias-non-alias.html)
- [Amazon CloudFront — What is Amazon CloudFront?](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Introduction.html)
- [Amazon CloudFront — Invalidate files to remove content](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Invalidation.html)
- [Elastic Load Balancing — What is an Application Load Balancer?](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html)
- [NGINX — Using nginx as HTTP load balancer](https://nginx.org/en/docs/http/load_balancing.html)
- [NGINX — License (2-clause BSD)](https://nginx.org/LICENSE)
- [Kong Gateway — source repository (Apache License 2.0)](https://github.com/Kong/kong)
- [Amazon API Gateway — Throttle requests to your REST APIs (token bucket, 429)](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-request-throttling.html)
- [Amazon API Gateway — Control access to HTTP APIs with JWT authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)
- [Kubernetes — Overview](https://kubernetes.io/docs/concepts/overview/)
- [Amazon ECS — What is Amazon Elastic Container Service?](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html)
- [Amazon EKS — What is Amazon EKS?](https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html)
- [Amazon ElastiCache — What is Amazon ElastiCache? (Valkey, Memcached, Redis OSS)](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.html)
- [Redis — Licenses (Redis 8 and later: RSALv2, SSPLv1 or AGPLv3)](https://redis.io/legal/licenses/)
- [Valkey — an open-source (BSD) key/value datastore](https://valkey.io/)
- [Valkey — README (forked from Redis before its licence change)](https://github.com/valkey-io/valkey)
- [AWS Prescriptive Guidance — Transactional outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)
- [Debezium — Outbox Event Router](https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html)
- [Apache Kafka 4.3 — Basic Kafka Operations (consumer groups and lag)](https://kafka.apache.org/43/operations/basic-kafka-operations/)
- [Apache Kafka 4.3 — Broker configs (log.retention.hours)](https://kafka.apache.org/43/configuration/broker-configs/)
- [Apache Kafka 4.3 — Kafka Connect overview](https://kafka.apache.org/43/kafka-connect/overview/)
- [Amazon MSK — Welcome to the Amazon MSK Developer Guide](https://docs.aws.amazon.com/msk/latest/developerguide/what-is-msk.html)
- [Amazon MSK — Monitor consumer lags](https://docs.aws.amazon.com/msk/latest/developerguide/consumer-lag.html)
- [Amazon SNS — Fanout to Amazon SQS queues](https://docs.aws.amazon.com/sns/latest/dg/sns-sqs-as-subscriber.html)
- [Amazon SQS — Message quotas (retention)](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html)
- [Amazon SQS — Available CloudWatch metrics](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-available-cloudwatch-metrics.html)
- [AWS Lambda — How Lambda processes records from stream and queue-based event sources](https://docs.aws.amazon.com/lambda/latest/dg/invocation-eventsourcemapping.html)
- [Amazon SES — What is Amazon SES?](https://docs.aws.amazon.com/ses/latest/dg/Welcome.html)
- [Postfix — home page](https://www.postfix.org/)
- [Amazon OpenSearch Service — What is Amazon OpenSearch Service?](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/what-is.html)
- [OpenSearch — FAQ (Apache License 2.0)](https://opensearch.org/faq/)
- [Elastic — FAQ on software licensing (AGPLv3 option)](https://www.elastic.co/pricing/faq/licensing)
- [Amazon Data Firehose — What is Amazon Data Firehose?](https://docs.aws.amazon.com/firehose/latest/dev/what-is-this-service.html)
- [AWS whitepaper — Amazon S3 as the data lake storage platform](https://docs.aws.amazon.com/whitepapers/latest/building-data-lakes/amazon-s3-data-lake-storage-platform.html)
- [Prometheus — Overview](https://prometheus.io/docs/introduction/overview/)
- [Grafana Labs — Licensing (AGPLv3)](https://grafana.com/licensing/)
- [OpenTelemetry — What is OpenTelemetry?](https://opentelemetry.io/docs/what-is-opentelemetry/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
