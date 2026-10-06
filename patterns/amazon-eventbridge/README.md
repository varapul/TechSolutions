<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🟧 AWS Services](../../README.md#aws-services)

# Amazon EventBridge

> An event bus: rules match events from AWS services, SaaS apps and your own code by content and route them to targets.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Amazon EventBridge" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/amazon-eventbridge.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Acme Shop's Orders service publishes `OrderPlaced` events to the custom bus **shop-bus** with `PutEvents`; S3 sends `Object Created` events for the bucket `product-images` to the account's **default** bus, and Stripe sends dispute events to a **partner** bus. On each bus, **rules** match events by their content and deliver them to targets, up to five per rule: here a Step Functions workflow, the SQS queue `analytics`, a Lambda function and an event bus in Acme's finance account. Producers never learn who reacts, so a new consumer is a new rule, not a change to the Orders service. |
| **2 · Rules match on content** | One `PutEvents` call carries two entries: **o-981** (amount 1280, country TH) and **o-982** (420, TH). Each rule compares its **event pattern** with the event's JSON, and every field the pattern lists must match: o-981 has `detail-type` OrderPlaced, `country` TH and an `amount` of at least 1000 (a `numeric` comparison), so it matches **all-orders** and **high-value**, while o-982 fails the numeric test and goes only to `analytics`. The high-value target has an **input transformer**, so Step Functions receives just `{"orderId": "o-981", "amount": 1280}`. |
| **3 · Retries, DLQ and replay** | Step Functions throttles the start of `high-value-review`, so EventBridge retries with exponential backoff and jitter: by default for 24 hours and up to 185 attempts, here for at most an hour because the target's `RetryPolicy` sets `MaximumEventAgeInSeconds` to 3600. Then it sends o-981 to the target's **dead-letter queue** `high-value-dlq`, a standard SQS queue, with attributes that name the error and the limit that ran out. **shop-archive** keeps every event for 30 days: `analytics` went live today, so a **replay** of the 24 hours before, sent only to the all-orders rule, back-fills it, and each replayed event carries a `replay-name` field. |
| **4 · Limits and alternatives** | Delivery is **at least once** and **unordered**: o-982 can reach `analytics` before o-981, and o-981 can arrive twice, so consumers deduplicate, here on `orderId`. Every event takes an extra routing hop (AWS measured a P99 of about 130 ms from ingestion to the first delivery attempt in August 2024), a `PutEvents` request holds at most 10 entries and 1 MB, us-east-1 allows 10,000 such requests per second by default (an adjustable quota), and custom events cost $1.00 per million (October 2026). The **Custom Event Bus** launched in September 2026 adds ordering per event group, built-in retention and subscribers that consumers own, while **Pipes** (one source to one target, with filtering and enrichment) and **Scheduler** are separate parts of EventBridge. |
<!-- END GENERATED: header -->

## The problem

When Acme Shop takes an order, several parts of the company need to know: big orders from Thailand go to a manual review, every order feeds the analytics pipeline, and next quarter someone will want loyalty points too. If the Orders service calls each of them, it has to know every consumer, wait for them, handle their outages, and change whenever a team adds one. A queue per consumer removes the waiting, but somebody still has to decide which events go to which queue. And some of the events the shop reacts to aren't produced by its own code at all: S3 reports new product photos, and Stripe reports payment disputes. What's needed is one place where producers publish facts and each consumer states, by content, which facts it wants.

## How it works

Amazon EventBridge is a serverless event router. Producers send events to an **event bus**; each **rule** on that bus compares every event with its **event pattern** and sends the ones that match to its **targets**. Consumers don't poll: EventBridge pushes each matching event to each target, and retries when a target fails. Producers and consumers never address each other, so either side can change without the other knowing.

### Buses: default, custom and partner

- The **default bus** exists in every account and Region, and AWS services publish their events to it: an EC2 instance changing state, a CloudFormation stack finishing, or, once you turn on EventBridge notifications for a bucket, an S3 `Object Created` event for every new object in `product-images`. Each service sends its events either *durably* (at least once) or on a *best-effort* basis; the EventBridge events reference lists which.
- A **custom bus** such as `shop-bus` receives your own events, sent with `PutEvents`. Giving your events their own bus keeps their rules, permissions and archive separate from the AWS events on the default bus.
- A **partner bus** receives events from a SaaS partner. Stripe, for example, creates a *partner event source* in your account; you associate it with a bus of the same name (`aws.partner/stripe.com/…`), and any event the partner sends before that is dropped. The partner list includes Stripe, Shopify, Zendesk, Datadog, PagerDuty, Okta, Auth0 and Salesforce (through Amazon AppFlow), among others.

### The event

Every event on a bus is a JSON document with the same top-level fields. This is **o-981** as `shop-bus` stores it:

```json
{
  "version": "0",
  "id": "7b3c4c2e-…",
  "detail-type": "OrderPlaced",
  "source": "shop.orders",
  "account": "111122223333",
  "time": "2026-10-06T09:14:03Z",
  "region": "us-east-1",
  "resources": [],
  "detail": { "orderId": "o-981", "amount": 1280, "country": "TH" }
}
```

`source` and `detail-type` together say who published the event and what kind of fact it records, and `detail` carries the facts themselves. Sources that begin with `aws.` are reserved for AWS services; for your own, AWS recommends reverse domain names such as `com.example.orders`, and `shop.orders` just keeps this example short. EventBridge assigns the `id`, fills in `account`, `region` and `time` (unless the producer sets the time), and adds a `replay-name` field to events it replays from an archive.

### Event patterns and rules

A rule belongs to one bus and has one event pattern, a JSON document shaped like the events it should select. Every field the pattern names must be present in the event and hold one of the listed values; fields the pattern doesn't mention are ignored. The two rules on `shop-bus` are:

```json
{ "detail-type": ["OrderPlaced"] }

{ "detail-type": ["OrderPlaced"],
  "detail": { "country": ["TH"], "amount": [{ "numeric": [">=", 1000] }] } }
```

The first is **all-orders**, which matches every `OrderPlaced` event; the second is **high-value**, which also requires Thailand and an amount of at least 1000, so it matches o-981 (1280) but not o-982 (420). Besides exact values, patterns support these operators: `prefix` and `suffix`, `equals-ignore-case`, `anything-but`, `numeric` comparisons and ranges such as `[">", 10, "<=", 20]`, `cidr` for IP addresses, `exists`, `wildcard`, and `$or` across fields. The partner rule `disputes` uses `prefix` to catch every Stripe event whose type starts with `charge.dispute.`. Numbers are compared as 64-bit floating-point values, so integers are exact only up to 2⁵³.

Every rule sees every event on its bus, and each rule that matches delivers its own copy. A pattern that also matches events caused by the rule's own target can trigger itself without end, for example a rule that reacts to an S3 change and whose target makes another one, so keep patterns as narrow as the job allows. You can try a pattern against sample events in the console's sandbox, or with `aws events test-event-pattern`, before you deploy it.

### Targets

A rule can have up to **five targets**, although AWS's own advice is one target per rule and a second rule when another consumer needs the same events, so that each can change on its own. Targets include Lambda functions, SQS queues (standard, fair and FIFO), [SNS](../amazon-sns/) topics, Step Functions state machines, Kinesis and Firehose streams, ECS tasks, API Gateway, AWS AppSync, CloudWatch log groups and several more. Two kinds deserve a closer look:

- **API destinations** make any HTTPS endpoint a target. A *connection* holds the endpoint's authorization (basic, OAuth or an API key, stored in AWS Secrets Manager). EventBridge waits at most 5 seconds for an answer, retries 401, 407, 409, 429 and 5xx responses, and calls each destination at most 300 times a second unless you raise that quota.
- **Event buses**, in the same account, in another account or in another Region, which is how events cross account boundaries. The receiving account grants access in its bus's resource policy and writes its own rules, the sending account pays for the forwarded events, and an event that arrived from another account isn't forwarded a third time. Since January 2025 a rule can also deliver straight to an SQS queue, Lambda function, Kinesis stream, SNS topic or API Gateway API in another account, if that resource's policy allows it.

EventBridge invokes Lambda functions and Step Functions state machines **asynchronously**: a successful delivery means the function or execution started, not that it finished. To reach a target, EventBridge assumes an IAM role you give it (Step Functions and Kinesis targets need one), or, for Lambda, SNS and SQS, it can rely on the target's resource-based policy instead.

### Input transformers

By default a target receives the whole event. An **input transformer** builds a different payload: `InputPathsMap` copies up to 100 values out of the event with JSON paths, and `InputTemplate` places them into a string or JSON template. The high-value target sends Step Functions only `{"orderId": "o-981", "amount": 1280}`. Predefined variables add the rule's name and ARN, the ingestion time, or the original event.

### Retries and dead-letter queues

If a delivery fails with a retriable error, such as the target throttling the call, EventBridge tries again with exponential backoff and jitter: by default for **24 hours** and up to **185 attempts**. Each target has its own `RetryPolicy`: `MaximumEventAgeInSeconds` (60 to 86,400) and `MaximumRetryAttempts` (0 to 185), whichever runs out first. The high-value target allows one hour, so a stuck review reaches a person within the hour rather than the next day.

When the retries run out, EventBridge drops the event, unless the target has a **dead-letter queue**: a *standard* SQS queue (FIFO queues aren't supported) in the rule's Region, set with `DeadLetterConfig`. Each message in it carries attributes naming the rule, the target, the `ERROR_CODE`, the `EXHAUSTED_RETRY_CONDITION` and the number of attempts. Some failures skip the retries and go straight to the queue: a missing permission, a target that no longer exists, an address that doesn't resolve. EventBridge doesn't redrive the queue itself: once the cause is fixed, a Lambda function or your own consumer reads the messages and sends the events again.

### Archive and replay

An **archive** stores the events of one bus, all of them or those matching a pattern, for a number of days you choose (indefinitely by default). `shop-archive` keeps every `shop-bus` event for 30 days. A **replay** sends the archived events from a time window back to the same bus, either to all its rules or only to the rules you list:

- `analytics` went live this morning, so a replay of the 24 hours before, limited to the all-orders rule, gives it yesterday's orders without sending them to high-value-review a second time.
- Replayed events carry a `replay-name` field, which consumers can use to tell them apart, and which a managed rule uses to keep them out of the archive.
- Events reach the archive with some delay, so AWS suggests waiting about 10 minutes before replaying recent ones. A replay sends the window one minute at a time and doesn't promise the original order, and an account can run 10 replays at once per Region.

### Two kinds of custom bus

In September 2026 AWS launched a second kind of custom bus, called the **Custom Event Bus**, and renamed the existing kind, the one this page animates, to **Custom Event Bus - Classic**. Classic buses, the default bus and partner buses keep working unchanged. The new bus is built differently:

- Consumers attach **subscribers** to a bus that is shared with their accounts through AWS RAM. Each subscriber has its filters and exactly one target, so the bus owner writes no routing on their behalf.
- The bus **retains** every event for a period you set, from 1 to 365 days, and the first 24 hours are included in the price. A new subscriber can start from a point in that window, which replaces archives and replays.
- A **FIFO** subscriber delivers events in publish order within an *event group* (an `EventGroupId` set by the producer), and the bus can drop a duplicate published within 5 minutes.
- `PutRawEvents` accepts JSON, Avro, Protobuf or raw bytes, next to `PutEvents`.
- It has its own CLI and SDK names (`aws eventsv2`), shorter default retries (5 attempts or 300 seconds), and prices data by the GB instead of counting events.

AWS's documentation recommends the new bus for new applications. At launch it was available in 14 Regions, including us-east-1.

### Schema registry, Pipes and Scheduler

EventBridge has three more parts, each with its own API:

- The **schema registry** holds the structure of every AWS service event, your own schemas (OpenAPI 3 or JSON Schema Draft 4), and schemas that **schema discovery** infers from the events on a bus. From a schema you can download code bindings for Java, Python, TypeScript or Go. The registry is free; discovery is free for 5 million events a month.
- **Pipes** connect one source to one target, with an optional filter, an enrichment step (a Lambda function, an Express Step Functions workflow, API Gateway or an API destination) and an input transformation. Sources are pollable streams and queues: SQS, Kinesis and [DynamoDB](../amazon-dynamodb/) streams, Amazon MSK, self-managed Kafka and Amazon MQ. A pipe keeps the order its source delivers, and you pay only for events that pass the filter.
- **Scheduler** runs millions of one-time (`at`), `rate` and `cron` schedules that call more than 270 AWS services, with retries and an optional dead-letter queue. AWS recommends it over the older scheduled rules on event buses, which the documentation now marks as legacy.

## Where it fits

- **Solutions.** Event-driven integration between services owned by different teams or accounts; reacting to AWS events, such as processing uploads, enforcing tagging or alerting on security findings; receiving events from SaaS applications and calling external webhooks through API destinations; and fan-out from one business event to several workflows.
- **Patterns in this catalog.** EventBridge is a managed router for an [event-driven architecture](../event-driven-architecture/) and does [publish-subscribe](../publish-subscribe/) with routing by content. Services that react to each other's events through a bus form a [saga by choreography](../saga-choreography/). API destinations deliver [webhooks](../webhooks/), and partner buses receive them. Each consumer still needs to be an [idempotent consumer](../idempotent-consumer/), and the per-target queue is a [dead-letter queue](../dead-letter-queue/). For payloads near the size limit, store the data in S3 and publish a pointer ([claim check](../claim-check/)).
- **Usual neighbours.** [AWS Lambda](../aws-lambda/) and AWS Step Functions as targets; [Amazon SQS](../amazon-sqs/) in front of consumers that need buffering, batching or throttling of their own, and as the dead-letter queue; Amazon SNS when one event must reach thousands of endpoints or SMS, email and mobile push; [Amazon S3](../amazon-s3/) and nearly every other AWS service as sources; CloudWatch for metrics and alarms; IAM for the roles EventBridge uses.
- **Managed offerings.** EventBridge is itself the managed service, with no servers or brokers to size. The closest services on other clouds are Azure Event Grid and Google Cloud Eventarc.

## When to use it

Use EventBridge when the events matter to more than one consumer, when consumers belong to other teams or accounts, when the routing should depend on what an event says, or when the events come from AWS services or SaaS partners. It costs nothing while idle and needs no capacity planning up to its quotas.

Look elsewhere when a single consumer works through a backlog at its own pace (a queue), when every consumer must read a high-volume stream in order and replay it at will (Kinesis Data Streams or Kafka), when one message must reach a very large number of subscribers or phones (SNS), or when a caller needs an answer (a direct call).

| | EventBridge Classic bus | EventBridge Custom Event Bus | Amazon SNS | [Amazon SQS](../amazon-sqs/) | Kinesis Data Streams | [Apache Kafka](../kafka/) |
|---|---|---|---|---|---|---|
| Consumers get events | pushed to each matching rule's targets (up to 5 per rule) | pushed to each matching subscriber's one target | pushed to every subscription | they poll, then delete | they read by position in a shard | they pull by offset from a partition |
| Selection | event patterns on any field of the event | filters on the data, your metadata or system metadata | filter policies on attributes or the message body | none: each message goes to one consumer | none: each reader gets the whole shard | none in the broker |
| Order | none | FIFO subscribers: per event group | FIFO topics: per message group | FIFO queues: per message group | per shard | per partition |
| Keeps events | only in an archive (optional) | on the bus, 1 to 365 days | no; FIFO topics can archive and replay | until deleted, 1 minute to 14 days | 24 hours by default, up to 365 days | per topic, 7 days by default |
| Sources | your code, AWS services, SaaS partners | your code; AWS and SaaS events through event sources | your code and AWS services that publish to SNS | your code | your code | your code and connectors |
| Choose it for | routing by content across services, accounts and SaaS | the same, with ordering, retention and consumer-owned subscriptions | fan-out to many endpoints, including SMS, email and push | work queues and buffering | ordered, replayable streams | high-volume streams in your own or MSK clusters |

Figures from the AWS documentation in October 2026, and from the Kafka page of this catalog.

## Trade-offs

- **At least once, in no particular order.** On a Classic bus a rule can occasionally fire twice for one event, and a target can be invoked twice, so o-981 may reach `analytics` twice and after o-982. Consumers have to be idempotent and must not depend on order; when order matters, use the new bus's FIFO subscribers or a stream such as Kinesis or Kafka.
- **Another hop of latency.** The FAQ quotes a typical latency of about half a second, against under 30 ms for SNS. In November 2024 AWS reported a P99 of about 130 ms from ingestion to the first delivery attempt (measured in August 2024), down from about 2.2 seconds in January 2023. Either way, it belongs on asynchronous paths, not inside a request that a user is waiting for.
- **Quotas per Region.** `PutEvents` allows 10,000 requests per second in us-east-1, us-west-2 and eu-west-1 by default, but as few as 400 in smaller Regions; target invocations are capped at 18,750 a second in us-east-1, and above that they are delayed rather than lost. A bus can have 300 rules and an account 100 buses by default; these can be raised, but the 5 targets per rule can't.
- **Size.** A `PutEvents` request holds up to 10 entries and 1 MB in total (raised from 256 KB in January 2026; that announcement left out a few Regions, among them Asia Pacific (Thailand)), and every 64 KB of an event is billed as one event, so large payloads belong in S3, with a pointer in the event.
- **Cost per event.** $1.00 per million custom events, partner events and opt-in data events such as S3's; AWS management events (the control-plane events most services send) are free, and so is delivery to a target in the same account, while delivery to another bus costs another $1.00 per million. At 1,000 events a second that is about 2.6 billion events and $2,600 a month for publishing alone.
- **Harder to follow.** Nobody calls anybody, so tracing an order through rules, retries and dead-letter queues needs correlation IDs and the bus's metrics and logs, and a rule with a typo in its pattern simply never matches.
- **The event is a contract.** Every consumer depends on the shape of `detail`. Changing it is an API change: add fields, don't rename them, and use the schema registry to publish the shape.

## Implementation notes

**Create the bus, a rule and its target.** The high-value target gets its input transformer, a one-hour retry window and a dead-letter queue. The account ID and role name are examples:

```sh
aws events create-event-bus --name shop-bus

aws events put-rule --name high-value --event-bus-name shop-bus \
  --event-pattern '{"detail-type": ["OrderPlaced"], "detail": {"country": ["TH"], "amount": [{"numeric": [">=", 1000]}]}}'

aws events put-targets --rule high-value --event-bus-name shop-bus --targets '[{
  "Id": "review",
  "Arn": "arn:aws:states:us-east-1:111122223333:stateMachine:high-value-review",
  "RoleArn": "arn:aws:iam::111122223333:role/shop-bus-start-review",
  "InputTransformer": {
    "InputPathsMap": {"orderId": "$.detail.orderId", "amount": "$.detail.amount"},
    "InputTemplate": "{\"orderId\": <orderId>, \"amount\": <amount>}"
  },
  "RetryPolicy": {"MaximumEventAgeInSeconds": 3600, "MaximumRetryAttempts": 185},
  "DeadLetterConfig": {"Arn": "arn:aws:sqs:us-east-1:111122223333:high-value-dlq"}
}]'
```

**Archive everything, and replay into a new consumer.** The replay covers the 24 hours before `analytics` went live and goes only to the all-orders rule:

```sh
aws events create-archive --archive-name shop-archive --retention-days 30 \
  --event-source-arn arn:aws:events:us-east-1:111122223333:event-bus/shop-bus

aws events start-replay --replay-name backfill \
  --event-source-arn arn:aws:events:us-east-1:111122223333:archive/shop-archive \
  --event-start-time 2026-10-05T09:00:00Z --event-end-time 2026-10-06T09:00:00Z \
  --destination '{"Arn": "arn:aws:events:us-east-1:111122223333:event-bus/shop-bus",
                  "FilterArns": ["arn:aws:events:us-east-1:111122223333:rule/shop-bus/all-orders"]}'
```

**Publish, and check every entry.** `PutEvents` succeeds or fails per entry: a response with HTTP 200 can still carry a `FailedEntryCount` above zero, and the failed entries, which have an `ErrorCode`, have to be sent again. An event sent to a bus name that doesn't exist is accepted and then silently dropped, so a typo in `EventBusName` loses events without an error:

```sh
aws events put-events --entries '[
  {"EventBusName": "shop-bus", "Source": "shop.orders", "DetailType": "OrderPlaced",
   "Detail": "{\"orderId\": \"o-981\", \"amount\": 1280, \"country\": \"TH\"}"},
  {"EventBusName": "shop-bus", "Source": "shop.orders", "DetailType": "OrderPlaced",
   "Detail": "{\"orderId\": \"o-982\", \"amount\": 420, \"country\": \"TH\"}"}
]'
```

- **Publish after the commit.** If the Orders service writes the order to its database and then calls `PutEvents`, a crash in between loses the event. A [transactional outbox](../transactional-outbox/), or, if the orders live in DynamoDB, a pipe reading the table's stream, publishes only what was committed.
- **Watch the safety nets.** Alarm on `FailedInvocations` and `InvocationsSentToDlq` per rule and on the depth of each dead-letter queue, and watch `ThrottledRules`, `RetryInvocationAttempts` and the latency metrics from ingestion to invocation; AWS's guidance treats latency that stays above 30 seconds as a sign of rule throttling or a service problem.
- **Work out the bill** (us-east-1, October 2026). 10 million orders a month, each well under 64 KB, cost $10 to publish; the deliveries to Step Functions and SQS in the same account are free; archiving them, at about 1 KB each, adds roughly $1 of processing at $0.10 per GB plus $0.023 per GB-month of storage; forwarding all of them to a bus in another account would add another $10. API destinations cost $0.20 per million calls, Pipes $0.40 per million requests after filtering, and Scheduler $1.00 per million invocations after 14 million free a month.
- **Survive a Regional outage.** A **global endpoint** sends custom events to the bus in a primary Region and fails over to a bus with the same name in a secondary Region when a Route 53 health check turns unhealthy. With the alarms AWS prescribes, the documented recovery time and recovery point objectives are 360 seconds, at most 420. The endpoint itself costs nothing extra, but turning on event replication, which AWS recommends, adds to the bill, and consumers have to cope with events processed in both Regions.
- **Keep consumers in charge of their rules.** In a multi-account setup, a central bus forwards events to a bus in each consumer's account, where that team writes its own rules; or, on the new Custom Event Bus, each team attaches subscribers to the shared bus directly.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.
- [Publish-Subscribe](../publish-subscribe/) — Broadcast each message to every interested subscriber through a topic.
- [Saga (Choreography)](../saga-choreography/) — Services react to each other's events to complete a workflow, with no central coordinator.
- [Amazon SNS](../amazon-sns/) — Managed publish-subscribe: a message published to a topic fans out to queues, functions, HTTP endpoints, email and SMS.
- [Amazon SQS](../amazon-sqs/) — A managed message queue: consumers poll, a visibility timeout hides messages in flight, and repeated failures go to a dead-letter queue.
- [AWS Lambda](../aws-lambda/) — Functions as a service: code runs per event in managed execution environments that scale out with concurrency.
- AWS Step Functions *(planned)* — Workflows as state machines: sequence, branch, retry, wait and run in parallel across services, with every step recorded.
- [Webhooks](../webhooks/) — Notify subscribers by calling their HTTP endpoints, with signatures, retries and idempotency.

## References

- [Amazon EventBridge User Guide — What Is Amazon EventBridge?](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is.html)
- [Amazon EventBridge — Event bus (default and Classic)](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-bus.html)
- [Amazon EventBridge — What is the EventBridge Custom Event Bus?](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-custom-bus-what-is.html)
- [Amazon EventBridge — Migrating from Custom Event Bus - Classic to the Custom Event Bus](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-custom-bus-migrate.html)
- [Amazon EventBridge — Ordering and deduplicating events on a Custom Event Bus](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-custom-bus-ordering.html)
- [Amazon EventBridge — Retry policies and dead-letter queues (Custom Event Bus)](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-custom-bus-retry.html)
- [Amazon EventBridge — Names, endpoints, and IAM permissions for the Custom Event Bus](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-custom-bus-names.html)
- [Amazon EventBridge — Events in Amazon EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-events.html)
- [EventBridge Events Reference — AWS service event metadata](https://docs.aws.amazon.com/eventbridge/latest/ref/events-structure.html)
- [EventBridge Events Reference — Delivery level for AWS service events](https://docs.aws.amazon.com/eventbridge/latest/ref/event-delivery-level.html)
- [Amazon EventBridge — Event patterns](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns.html)
- [Amazon EventBridge — Comparison operators for use in event patterns](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-pattern-operators.html)
- [Amazon EventBridge — Best practices when defining rules](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rules-best-practices.html)
- [Amazon EventBridge — Sending events with PutEvents](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-putevents.html)
- [Amazon EventBridge — Event bus targets](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-targets.html)
- [Amazon EventBridge — Using resource-based policies](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-use-resource-based.html)
- [Amazon EventBridge — API destinations as targets](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-api-destinations.html)
- [Amazon EventBridge — Connections for API targets](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-target-connection.html)
- [Amazon EventBridge — Sending and receiving events between AWS accounts](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-cross-account.html)
- [Amazon EventBridge — Input transformation](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-transform-target-input.html)
- [Amazon EventBridge — How EventBridge retries delivering events](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-retry-policy.html)
- [Amazon EventBridge — Using dead-letter queues to process undelivered events](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-dlq.html)
- [Amazon EventBridge — Archiving and replaying events](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-archive.html)
- [Amazon EventBridge — Creating replays of archived events](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-replay-archived-event.html)
- [Amazon EventBridge — Receiving events from a SaaS partner](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-saas.html)
- [Amazon EventBridge — Schemas](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-schema.html)
- [Amazon EventBridge — Code bindings for schemas](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-schema-code-bindings.html)
- [Amazon EventBridge — Pipes](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes.html)
- [Amazon EventBridge — Event enrichment in EventBridge Pipes](https://docs.aws.amazon.com/eventbridge/latest/userguide/pipes-enrichment.html)
- [EventBridge Scheduler — What is Amazon EventBridge Scheduler?](https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html)
- [Amazon EventBridge — Amazon EventBridge Scheduler (recommended over scheduled rules)](https://docs.aws.amazon.com/eventbridge/latest/userguide/using-eventbridge-scheduler.html)
- [EventBridge Scheduler — Schedule types](https://docs.aws.amazon.com/scheduler/latest/UserGuide/schedule-types.html)
- [EventBridge Scheduler — Configuring a schedule's dead-letter queue](https://docs.aws.amazon.com/scheduler/latest/UserGuide/configuring-schedule-dlq.html)
- [Amazon EventBridge — Making applications Regional-fault tolerant with global endpoints](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-global-endpoints.html)
- [Amazon EventBridge — Quotas](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-quota.html)
- [Amazon EventBridge — Monitoring (CloudWatch metrics)](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-monitoring.html)
- [Amazon EventBridge — Troubleshooting (a rule ran more than once)](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-troubleshooting.html)
- [Amazon EventBridge API Reference — RetryPolicy](https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_RetryPolicy.html)
- [Amazon EventBridge API Reference — ReplayDestination](https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_ReplayDestination.html)
- [Amazon EventBridge API Reference — InputTransformer](https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_InputTransformer.html)
- [Amazon EventBridge API Reference — PutEventsRequestEntry](https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_PutEventsRequestEntry.html)
- [AWS CLI — aws events put-rule](https://docs.aws.amazon.com/cli/latest/reference/events/put-rule.html)
- [AWS CLI — aws events put-targets](https://docs.aws.amazon.com/cli/latest/reference/events/put-targets.html)
- [AWS CLI — aws events put-events](https://docs.aws.amazon.com/cli/latest/reference/events/put-events.html)
- [AWS CLI — aws events create-archive](https://docs.aws.amazon.com/cli/latest/reference/events/create-archive.html)
- [AWS CLI — aws events start-replay](https://docs.aws.amazon.com/cli/latest/reference/events/start-replay.html)
- [AWS CLI — aws events test-event-pattern](https://docs.aws.amazon.com/cli/latest/reference/events/test-event-pattern.html)
- [Service Authorization Reference — Amazon EventBridge (resource ARN formats)](https://docs.aws.amazon.com/service-authorization/latest/reference/list_eventbridge.html)
- [Amazon EventBridge pricing](https://aws.amazon.com/eventbridge/pricing/)
- [Amazon EventBridge FAQs](https://aws.amazon.com/eventbridge/faqs/)
- [AWS What's New (Sep 2026) — Amazon EventBridge relaunches event buses for enterprise scale](https://aws.amazon.com/about-aws/whats-new/2026/09/eventbridge-relaunches-custom-event-buses/)
- [AWS News Blog (Sep 2026) — Introducing enhanced custom event buses in Amazon EventBridge](https://aws.amazon.com/blogs/aws/introducing-enhanced-custom-event-buses-in-amazon-eventbridge-for-enterprise-scale-event-driven-applications/)
- [AWS What's New (Jan 2026) — Increased 1 MB payload size support in Amazon EventBridge](https://aws.amazon.com/about-aws/whats-new/2026/01/amazon-eventbridge-increases-event-payload-size-256-kb-1-mb/)
- [AWS What's New (Nov 2024) — Up to 94% improvement in end-to-end latency for event buses](https://aws.amazon.com/about-aws/whats-new/2024/11/amazon-eventbridge-improvement-latency-event-buses/)
- [AWS What's New (Jan 2025) — Direct delivery to cross-account targets](https://aws.amazon.com/about-aws/whats-new/2025/01/amazon-eventbridge-direct-delivery-cross-account-targets/)
- [Amazon S3 — Using EventBridge](https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventBridge.html)
- [Stripe Docs — Send events to Amazon EventBridge](https://docs.stripe.com/event-destinations/eventbridge)
- [Amazon SNS — Message filtering](https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html)
- [Amazon SNS — Message ordering and deduplication with FIFO topics](https://docs.aws.amazon.com/sns/latest/dg/sns-fifo-topics.html)
- [Amazon SNS — Message archiving for FIFO topic owners](https://docs.aws.amazon.com/sns/latest/dg/message-archiving-and-replay-topic-owner.html)
- [Amazon Kinesis Data Streams — Change the data retention period](https://docs.aws.amazon.com/streams/latest/dev/kinesis-extended-retention.html)
- [Microsoft Learn — Introduction to Azure Event Grid](https://learn.microsoft.com/en-us/azure/event-grid/overview)
- [Google Cloud — Eventarc overview](https://docs.cloud.google.com/eventarc/docs/overview)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
