<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🟧 AWS Services](../../README.md#aws-services)

# Amazon SNS

> Managed publish-subscribe: a message published to a topic fans out to queues, functions, HTTP endpoints, email and SMS.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Amazon SNS" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/amazon-sns.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Acme Shop's Orders service calls `Publish` once per order to send **OrderPlaced** to the standard topic **order-events**, and never sees who subscribes. SNS pushes a copy to every subscription whose filter policy matches: the SQS queues **email-queue** and **analytics-queue**, the Lambda function **fraud-check** and a partner's HTTPS endpoint, while the on-call phone's SMS subscription only wants orders of 5000 or more. Because each queue consumer reads its own queue (the SNS-to-SQS fan-out), the hourly analytics loader can fall behind without holding up anyone else. |
| **2 · Publish and filter** | `Publish` returns **200** with a `MessageId` once SNS has written copies of the message to several Availability Zones; the answer says nothing about who will get it. SNS then checks each subscription's `FilterPolicy` against the message attributes, `amount` = 640 (a Number) and `country` = TH (a String): subscriptions without a policy take every message, fraud-check's `amount ≥ 500` matches, and the on-call phone's `amount ≥ 5000` does not, so no text goes out. |
| **3 · Delivery and retries** | SNS pushes each copy: email-queue, which has raw message delivery on, stores just the body, analytics-queue stores it inside a JSON envelope, and Lambda accepts fraud-check's event with a 202 and runs it asynchronously. The partner answers **503**, so SNS follows the default HTTP/S delivery policy, 3 retries 20 s apart (SQS and Lambda endpoints get 100,015 attempts over 23 days), and then moves the message to the subscription's dead-letter queue **partner-dlq**. Delivery is at least once, so every consumer must cope with duplicates. |
| **4 · No archive, FIFO, limits** | A standard topic keeps no archive: **search-queue**, subscribed the next day, never receives the orders published before it. FIFO topics (`.fifo`) keep order within a message group, drop a duplicate sent within 5 minutes, take only SQS queues as subscribers, and can archive messages for up to 365 days to replay them. Limits as of October 2026: 256 KiB a message by default (1 MiB on topics whose subscribers are all SQS, Lambda or Data Firehose) and 30,000 published messages a second per account in US East (N. Virginia); to route events from many sources to many kinds of targets, EventBridge offers richer rules. |
<!-- END GENERATED: header -->

## The problem

When a shopper places an order at Acme Shop, several parts of the business need to hear about it: the confirmation email goes out, the analytics warehouse records the sale, a fraud check scores the order, a delivery partner expects a webhook, and the on-call engineer wants a text when an order is unusually large. If the Orders service called each of them itself, it would have to know every address, wait for every answer, retry the ones that are down, and change its own code whenever a consumer is added. One slow consumer would slow down checkout.

[Publish-subscribe](../publish-subscribe/) removes that coupling: Orders announces the event once, and a broker hands a copy to everyone who subscribed. Amazon SNS (Simple Notification Service) is AWS's managed publish-subscribe service. A publisher sends a message to a **topic**; SNS stores it and pushes a copy to each **subscription**: SQS queues, Lambda functions, Data Firehose streams, HTTP(S) endpoints, email addresses, phone numbers by SMS, and mobile apps. There are no brokers to run, and you pay per request and per delivery.

## How it works

### Topics, subscriptions and protocols

- A **topic** is a named channel in one Region, such as `order-events`. It is either **standard** or **FIFO** (a FIFO topic's name ends in `.fifo`), and neither its type nor its name can change after it is created.
- A **subscription** joins a topic to one endpoint over one protocol: `sqs`, `lambda`, `firehose`, `http`, `https`, `email`, `email-json`, `sms` or `application` (a mobile app endpoint for push notifications). Each subscription has its own settings: a filter policy, raw message delivery, a dead-letter queue for what can't be delivered and, for HTTP/S, a retry policy that overrides the topic's.
- HTTP(S) and email endpoints, and endpoints in another AWS account, have to **confirm** before they receive anything. SNS sends them a confirmation message whose token is valid for two days; an HTTPS endpoint confirms by requesting the `SubscribeURL` in that message (or by calling `ConfirmSubscription`), and until then the subscription shows as `PendingConfirmation`. Unconfirmed subscriptions are deleted after 48 hours.
- SQS queues and Lambda functions in the topic's own account need no confirmation, only permission: the queue's access policy must let `sns.amazonaws.com` call `sqs:SendMessage`, with `aws:SourceArn` set to the topic's ARN, and the function needs a resource-based permission (`aws lambda add-permission`) for the same principal.

```sh
aws sns create-topic --name order-events
aws sns subscribe --topic-arn arn:aws:sns:us-east-1:111122223333:order-events \
  --protocol sqs --notification-endpoint arn:aws:sqs:us-east-1:111122223333:email-queue \
  --attributes RawMessageDelivery=true
aws sns subscribe --topic-arn arn:aws:sns:us-east-1:111122223333:order-events \
  --protocol lambda --notification-endpoint arn:aws:lambda:us-east-1:111122223333:function:fraud-check \
  --attributes '{"FilterPolicy": "{\"amount\": [{\"numeric\": [\">=\", 500]}]}"}'
```

### Publishing

- A publisher calls `Publish` with the message body, an optional `Subject`, and optional **message attributes**: typed name-value pairs (`String`, `String.Array`, `Number` or `Binary`) that travel next to the body and that filter policies can read. `PublishBatch` sends up to 10 messages in one request.
- Before it answers, SNS writes copies of the message to disk in several Availability Zones. The answer is a `MessageId` (plus a `SequenceNumber` on a FIFO topic). It says nothing about the subscribers, and a published message can't be recalled.
- A message, attributes included, may be 256 KiB by default. Since 18 September 2026 the topic attribute `MaximumMessageSize` can raise that to 1 MiB, but only on a topic with at most 100 subscriptions, all of them SQS, Lambda or Data Firehose. order-events has HTTPS and SMS subscribers, so it stays at 256 KiB. For larger payloads, the SNS Extended Client Library for Java or Python stores the body in Amazon S3 and publishes a reference to it, for payloads of up to 2 GB: the [Claim Check](../claim-check/) pattern.

```sh
aws sns publish --topic-arn arn:aws:sns:us-east-1:111122223333:order-events \
  --message '{"orderId":"o-1041","amount":640,"country":"TH"}' \
  --message-attributes '{"amount":{"DataType":"Number","StringValue":"640"},"country":{"DataType":"String","StringValue":"TH"}}'
```

### Filter policies

- A subscription without a filter policy receives every message. A **filter policy** is a JSON document on the subscription that SNS evaluates for each message, delivering only on a match. `FilterPolicyScope` sets what it reads: `MessageAttributes` (the default) or `MessageBody`, which expects the body to be a JSON object and allows nested keys.
- Every key in a policy must match, and the values listed for one key are alternatives; `$or` combines whole conditions. Besides exact values there are `prefix`, `suffix`, `equals-ignore-case`, `wildcard`, `anything-but`, IP address ranges (`cidr`), `exists` and `numeric` comparisons. Attribute policies only look at `String`, `String.Array` and `Number` attributes, so `amount` is published as a `Number`.
- fraud-check's policy (the on-call phone's is the same with 5000):

```json
{ "amount": [ { "numeric": [ ">=", 500 ] } ] }
```

- Limits: 5 keys and 150 combinations of values per policy, 256 KB of JSON, numbers from −10⁹ to 10⁹ with five digits after the decimal point, and by default 200 filter policies per topic and 10,000 per account. A new or changed policy can take up to 15 minutes to apply everywhere, so publish test messages before relying on it.
- A message that doesn't match is simply not delivered to that subscription; the topic's `NumberOfNotificationsFilteredOut` metric counts it. Attribute-based filtering is free, while body-based filtering is billed per GB of payload scanned.

### Delivery and message formats

- **SQS.** By default SNS wraps the message in a JSON envelope (`Type`, `MessageId`, `TopicArn`, `Subject`, `Message`, `Timestamp`, the signature fields, `UnsubscribeURL` and the attributes), which is what analytics-queue receives. With `RawMessageDelivery`, as on email-queue, the queue gets the body alone, and up to 10 message attributes become SQS message attributes; SNS discards a message with more than 10 attributes for such a subscription as a client-side error.
- **Lambda.** SNS invokes the function **asynchronously**: Lambda puts the event on its own internal queue and answers 202, retries a function error twice by default, and keeps retrying throttled events for up to 6 hours. Lambda takes triggers from standard topics only.
- **HTTP/S.** SNS sends a `POST` with headers such as `x-amz-sns-message-type` and `x-amz-sns-topic-arn` and the JSON envelope as the body, as `text/plain; charset=UTF-8` unless the delivery policy's `headerContentType` says otherwise. The endpoint must be reachable from the internet (SNS doesn't deliver to private HTTP endpoints) and should verify each message's signature. Topics sign with SHA1 (`SignatureVersion` 1) unless you set `SignatureVersion` to 2, which uses SHA256.
- **People.** Email subscriptions (standard topics only) are meant for internal alerts, their body can't be customised, and each takes at most 10 messages a second. SMS goes out through AWS End User Messaging SMS; new accounts start in an SMS sandbox that can only text verified numbers, and the price depends on the destination country.

### Retries and dead-letter queues

When the endpoint's side fails, SNS retries according to the delivery policy for the protocol. The defaults as of October 2026:

| Endpoints | Attempts | Spread over |
|---|---|---|
| SQS, Lambda (AWS managed) | 100,015: 3 at once, 2 one second apart, 10 backing off from 1 s to 20 s, then 100,000 every 20 s | 23 days |
| Email, SMS, mobile push | 50: 2 ten seconds apart, 10 backing off from 10 s to 10 min, then 38 every 10 min | 6 hours |
| HTTP/S, default policy | 4: the first attempt and 3 retries 20 s apart (`numRetries` 3, `minDelayTarget` = `maxDelayTarget` = 20, `linear`) | about a minute |
| HTTP/S, your own policy | up to 100 retries in four phases, with arithmetic, exponential, geometric or linear backoff | at most 3,600 s |

- Throttling errors from Data Firehose follow the second row. Only HTTP/S policies can be changed, on the topic or on the subscription; the others are fixed. SNS adds jitter to the delays.
- An HTTP/S endpoint's 5xx answers and 429 are retried; any other status is a permanent failure. Client-side errors, such as a deleted endpoint or a policy that no longer lets SNS in, are never retried. In step 3 the partner answers 503, so it gets the three default retries.
- When the policy runs out, or at once after a client-side error, SNS drops the message, unless the subscription has a **dead-letter queue**: an SQS queue named in the subscription's `RedrivePolicy` (`deadLetterTargetArn`), in the same account and Region. Its access policy must allow SNS to send to it, an encrypted one needs a customer managed KMS key that lets SNS use it, and AWS suggests the maximum retention of 14 days. On a FIFO topic the dead-letter queue has the same type as the subscribed queue.
- Watch it with a CloudWatch alarm on the queue's `ApproximateNumberOfMessagesVisible`; SNS also counts `NumberOfNotificationsRedrivenToDlq` and `NumberOfNotificationsFailedToRedriveToDlq`.
- Getting the messages out again is up to you. SQS's redrive (`StartMessageMoveTask`) doesn't accept dead-letter queues whose source is an SNS subscription, so once the partner is back, a consumer (a Lambda function with partner-dlq as its event source, say) reads the queue and delivers the messages again. The pattern is on the [Dead-Letter Queue](../dead-letter-queue/) page.
- Delivery is **at least once**. A subscriber occasionally receives the same message twice, and a standard topic tries to keep the publishing order but can deliver out of order. Make every consumer [idempotent](../idempotent-consumer/), keyed on something like the order ID.

A partner that is down for longer than a minute needs more than the default. A subscription-level policy such as this one makes 10 retries, backing off from 20 s to 5 minutes, and limits deliveries to an average of 50 a second:

```json
{
  "healthyRetryPolicy": {
    "numRetries": 10, "numNoDelayRetries": 0,
    "numMinDelayRetries": 2, "minDelayTarget": 20,
    "numMaxDelayRetries": 3, "maxDelayTarget": 300,
    "backoffFunction": "exponential"
  },
  "throttlePolicy": { "maxReceivesPerSecond": 50 }
}
```

```sh
aws sns set-subscription-attributes --subscription-arn "$PARTNER_SUBSCRIPTION_ARN" \
  --attribute-name RedrivePolicy \
  --attribute-value '{"deadLetterTargetArn":"arn:aws:sqs:us-east-1:111122223333:partner-dlq"}'
```

### FIFO topics

- A FIFO topic (`order-events.fifo`, say) needs a `MessageGroupId` on every message and keeps the order within each group, while different groups are delivered in parallel. It drops a message whose `MessageDeduplicationId` it has already seen in the last 5 minutes; with content-based deduplication the ID is a hash of the body.
- Only SQS queues can subscribe. FIFO queues keep the order and the deduplication end to end; standard queues (allowed since September 2023) get the messages at least once and in best-effort order. A Lambda function reads from such a queue, and HTTP/S, email, SMS and mobile endpoints can't subscribe at all.
- Throughput: 300 messages a second per message group. By default (`FifoThroughputScope` = `Topic`) deduplication covers the whole topic, which handles up to 3,000 messages or 20 MB a second. High-throughput mode (`MessageGroup`, since January 2025, and permanent once set) deduplicates per group and lets the topic use the account's Publish quota for the Region. A FIFO topic can have 100 subscriptions, and an account 1,000 FIFO topics.
- **Archive and replay** exist only for FIFO topics. The topic owner sets an `ArchivePolicy` (`MessageRetentionPeriod` from 1 to 365 days) and SNS keeps a copy of every message. A subscriber sets a `ReplayPolicy` on its subscription (`PointType` `Timestamp`, a `StartingPoint` and an optional `EndingPoint`), and SNS delivers the archived messages again, through the subscription's filter policy, with their original `MessageId` and timestamp and a `Replayed` attribute. A subscription can replay as soon as it is created, which is how a FIFO consumer added tomorrow catches up. Deactivating the archive deletes it, and a topic with an active archive can't be deleted.

### The fan-out pattern: one SQS queue per consumer

Subscribing a queue for each consumer, as Acme does for the email sender and the analytics loader, is the most common way to use SNS. Each queue has its own backlog, retention (up to 14 days), visibility timeout, dead-letter queue and scaling, so a consumer that is slow, being deployed or down delays only its own queue, and neither the other consumers nor the publisher notice. A new consumer is a new queue and a new subscription, with no change to Orders. Deliveries to SQS carry no per-delivery charge, though the data transferred is billed. Since July 2025 a `MessageGroupId` on a message to a standard topic is passed on to subscribed standard queues, where it turns on SQS fair queues for consumers shared by many tenants. The consumer side is on the [Amazon SQS](../amazon-sqs/) page, and scaling the workers behind one queue on [Competing Consumers](../competing-consumers/).

### Lambda straight from SNS, or through a queue?

- **Directly** is simplest: one invocation per message, and failures of the function itself go through Lambda's asynchronous retries and on to the function's on-failure destination or dead-letter queue. The subscription's own dead-letter queue only catches what SNS couldn't hand to Lambda, such as a deleted function or a removed permission.
- **Through a queue** (SNS to SQS to Lambda) adds batches, a cap on concurrency (`MaximumConcurrency` on the event source mapping), partial batch failures, a visible backlog kept for up to 14 days, and redrive from the queue's dead-letter queue. Choose it when the function calls a rate-limited dependency, when work must survive a long outage, and for FIFO topics, which Lambda can't subscribe to. Lambda's documentation also warns that when a function can't keep up, events can be deleted from its asynchronous queue without ever running. See [AWS Lambda](../aws-lambda/).

### Encryption, access and networks

- **Encryption at rest.** With server-side encryption (`KmsMasterKeyId`: the AWS managed key `alias/aws/sns` or a customer managed symmetric key), SNS encrypts message bodies as soon as it receives them and decrypts them for delivery. Topic and message metadata (the subject, message ID, timestamp and attributes) stay unencrypted, and requests to an encrypted topic must use HTTPS and Signature Version 4. To deliver to an encrypted queue, the queue's customer managed key must allow the SNS service principal `kms:GenerateDataKey` and `kms:Decrypt`.
- **Access.** IAM policies give your own roles `sns:Publish` or `sns:Subscribe`; the topic's access policy, a resource-based policy, admits other accounts and AWS services. By default only the topic owner can publish or subscribe. A queue in another account is best subscribed by the queue's owner, which needs no confirmation. SNS also delivers to SQS queues and Lambda functions in other Regions.
- **Networks.** Interface VPC endpoints keep `Publish` calls from a VPC off the internet (see [Private Endpoints](../private-endpoints/)).
- SNS message data protection, which audits or masks sensitive data in messages, has been closed to new customers since 30 April 2026.

### Observability

- Per-topic CloudWatch metrics include `NumberOfMessagesPublished`, `NumberOfNotificationsDelivered`, `NumberOfNotificationsFailed`, `NumberOfNotificationsFilteredOut` and `PublishSize`.
- **Delivery status logging** writes the outcome of deliveries to SQS, Lambda, HTTP/S, Data Firehose and mobile app endpoints to CloudWatch Logs, with a sample rate for successes: the endpoint's response and the dwell time between publish and hand-off. That is where you see what the partner's endpoint answered.
- With AWS X-Ray active tracing (`TracingConfig` = `Active`), a request can be followed from the publisher through the topic to its subscribers.

### Quotas and pricing

- Quotas as of October 2026: `Publish` (and `PublishBatch`, counted per message) is limited per account and Region, to 30,000 messages a second in US East (N. Virginia), 9,000 in US West (Oregon) and Europe (Ireland), 1,500 in eight more Regions (3,000 for FIFO topics) and 300 elsewhere (3,000 for FIFO); these are soft quotas. An account can have 100,000 standard topics, and a standard topic 12,500,000 subscriptions.
- Prices from the US East (N. Virginia) price list of 15 September 2026. Standard topics: the first million API requests a month are free (counted across Regions), then $0.50 per million; every 64 KB chunk of a published message counts as one request, and of a delivered one as one delivery. Deliveries are free to SQS and Lambda (data transfer is billed), $0.60 per million to HTTP/S after 100,000 free, $2.00 per 100,000 emails after 1,000 free, $0.50 per million mobile push notifications after a million free, and $0.19 per million to Data Firehose; SMS is priced per destination country through AWS End User Messaging.
- FIFO topics: $0.30 per million publish requests plus $0.017 per GB published, and $0.01 per million subscription messages plus $0.001 per GB, where subscription messages are the published messages times the subscriptions, filtered out or not. Archiving costs $0.10 per GB processed and $0.023 per GB-month stored, and a replay is billed at the FIFO rates. Body-based filtering costs $0.09 per GB scanned.
- For Acme, a million small orders a month cost roughly $0.50 in publish requests if the free tier is used up elsewhere, plus $0.54 for the partner's 900,000 billable HTTPS deliveries; the two queues and the function receive theirs without a delivery charge.

## Where it fits

- **Solutions:** fanning out domain events, as here; notifications to people (CloudWatch alarms and other AWS events by email, SMS or chat through Amazon Q Developer in chat applications); webhooks to partners; mobile push; spreading S3 event notifications to several consumers; distributing events to other accounts.
- **Patterns it implements or supports:** [Publish-Subscribe](../publish-subscribe/) (steps 1 and 2) and the event channel of an [event-driven architecture](../event-driven-architecture/); the delivery side of [Webhooks](../webhooks/), with signed `POST`s and retries; [Retry with Backoff](../retry-with-backoff/) in its delivery policies and a [Dead-Letter Queue](../dead-letter-queue/) per subscription (step 3); [Competing Consumers](../competing-consumers/) behind each subscribed queue; [Claim Check](../claim-check/) through the extended client. Consumers need to be [idempotent](../idempotent-consumer/), and a service that writes to its database and then publishes needs a [transactional outbox](../transactional-outbox/), because `Publish` is not part of the database transaction. Inside one process the same idea is the [Observer](../observer/) pattern.
- **Usual neighbours:** [Amazon SQS](../amazon-sqs/) and [AWS Lambda](../aws-lambda/) as subscribers; Data Firehose for archiving messages to [Amazon S3](../amazon-s3/); CloudWatch alarms and EventBridge rules publishing to topics; KMS for keys; AWS End User Messaging for SMS.
- **Managed offerings:** SNS is itself the managed service. [Amazon EventBridge](../amazon-eventbridge/) routes events between AWS services, SaaS applications and accounts; Amazon MQ runs ActiveMQ or [RabbitMQ](../rabbitmq/) brokers with topics; Amazon MSK runs [Kafka](../kafka/). Other clouds offer Google Cloud Pub/Sub and Azure Event Grid or Service Bus topics.

## When to use it

- One event, several independent consumers, each with its own pace and failure handling, usually with a queue per consumer.
- Pushing from AWS to people and to outside systems: alerts by email, SMS or mobile push, and webhooks to partners.
- Wide fan-out with simple filters on attributes or JSON fields.
- Not when a consumer needs history or replay (a standard topic keeps nothing; use a FIFO topic's archive, EventBridge or a stream), when many kinds of events from many sources need routing and transformation (EventBridge), when each message should go to just one worker (a queue), or when strict order must reach something other than an SQS FIFO queue.

| | How consumers get messages | Who gets each message | Kept for | Order | Choose it for |
|---|---|---|---|---|---|
| **SNS standard topic** | pushed to subscriptions: SQS, Lambda, Firehose, HTTP/S, email, SMS, mobile push | every subscription whose filter matches | until delivered; then retried, sent to a DLQ or dropped | best effort | fan-out of one message to many, notifications |
| **SNS FIFO topic** | pushed to SQS queues only | every matching subscription | until delivered; optional archive of up to 365 days for replay | per message group | ordered, deduplicated fan-out to queues |
| **EventBridge** | rules route events to targets; since September 2026 the new Custom event bus also has subscribers | each matching target | rule targets retried for up to 24 hours by default; archives replay; the new Custom event bus keeps 24 hours, extendable to a year | strict ordering on the new Custom event bus | routing events from AWS services, SaaS apps and other accounts by content |
| **SQS** | they poll, then delete | one consumer at a time | until deleted, at most 14 days | best effort, or per group in FIFO | work queues, buffering in front of a consumer |
| **Kinesis Data Streams** | read by position from a shared stream | every consuming application | 24 hours by default, up to 365 days | per shard | streams that several applications read and replay |
| **Kafka (Amazon MSK)** | consumer groups pull from partitions | every consumer group | as long as the topic's retention says (7 days by default) | per partition | high-volume event streams with replay |

## Trade-offs

- **Push, not pull.** SNS decides when to deliver, and an endpoint that isn't ready relies on retries. A queue per consumer turns that back into pull, at the price of another service.
- **No backlog.** A standard topic keeps a message only while it delivers it. A consumer added later, or one whose retries ran out without a dead-letter queue, never gets it.
- **At least once, roughly in order.** Standard topics can deliver twice and out of order; FIFO topics fix both, but only for SQS subscribers, with a group-level throughput limit and 100 subscriptions per topic.
- **Short default retries for HTTP/S.** About a minute, then the message is gone unless the subscription has a dead-letter queue. The fixed policies for SQS and Lambda are very patient, those for email and SMS give up after 6 hours.
- **Simple filters.** Five keys and 150 combinations per policy, changes that take up to 15 minutes, and a filtered-out message is gone for that subscription.
- **Size.** 256 KiB per message on most topics; 1 MiB only where every subscriber is SQS, Lambda or Data Firehose.
- **AWS only.** The API and the envelope are SNS's own; HTTP subscribers must handle its confirmation messages and signatures.

## Implementation notes

- **Give every consumer a queue, and every subscription a dead-letter queue,** HTTP/S and Lambda subscriptions in particular, with 14 days of retention and an alarm on its depth.
- **Agree on a delivery policy with each partner:** retries spread over the outage you want to ride out, a `maxReceivesPerSecond` their servers can take, and an endpoint that answers 5xx or 429 when it wants the message again, since SNS treats any other error status as final.
- **Secure HTTP endpoints:** verify the signature (set `SignatureVersion` 2), check `x-amz-sns-topic-arn`, and confirm subscriptions only for topics you expect.
- **Design the attributes with the filters:** put what subscribers filter on into message attributes of the right type (or filter on the JSON body), and test a policy with real messages before relying on it.
- **Make consumers idempotent** on a business key such as the order ID, since both SNS and SQS can deliver twice.
- **Keep the publisher honest:** publish after the database commit through an outbox, and retry `Publish` with backoff when it is throttled.
- **Turn on delivery status logging** for HTTP/S and Lambda subscriptions, and alarm on `NumberOfNotificationsFailed`.
- **Lock it down:** scope topic and queue policies with `aws:SourceArn` or `aws:SourceAccount`, and use customer managed KMS keys when the subscribed queues are encrypted.
- **Define it as code** (CloudFormation, CDK or Terraform): topics, subscriptions, filter, delivery and redrive policies, queue policies and alarms.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Publish-Subscribe](../publish-subscribe/) — Broadcast each message to every interested subscriber through a topic.
- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.
- [Amazon SQS](../amazon-sqs/) — A managed message queue: consumers poll, a visibility timeout hides messages in flight, and repeated failures go to a dead-letter queue.
- [Amazon EventBridge](../amazon-eventbridge/) — An event bus: rules match events from AWS services, SaaS apps and your own code by content and route them to targets.
- [AWS Lambda](../aws-lambda/) — Functions as a service: code runs per event in managed execution environments that scale out with concurrency.
- [Webhooks](../webhooks/) — Notify subscribers by calling their HTTP endpoints, with signatures, retries and idempotency.
- [Dead-Letter Queue](../dead-letter-queue/) — Park messages that keep failing so they stop blocking the queue and can be inspected.
- [Competing Consumers](../competing-consumers/) — Several workers pull from one queue, so work is shared and throughput scales out.

## References

- [Amazon SNS Developer Guide — What is Amazon SNS?](https://docs.aws.amazon.com/sns/latest/dg/welcome.html)
- [Amazon SNS — Features and capabilities (message durability)](https://docs.aws.amazon.com/sns/latest/dg/welcome-features.html)
- [Amazon SNS — Creating a topic](https://docs.aws.amazon.com/sns/latest/dg/sns-create-topic.html)
- [Amazon SNS — Creating a subscription to a topic](https://docs.aws.amazon.com/sns/latest/dg/sns-create-subscribe-endpoint-to-topic.html)
- [Amazon SNS — Publishing a message](https://docs.aws.amazon.com/sns/latest/dg/sns-publishing.html)
- [Amazon SNS — Message attributes](https://docs.aws.amazon.com/sns/latest/dg/sns-message-attributes.html)
- [Amazon SNS — Message batching (PublishBatch)](https://docs.aws.amazon.com/sns/latest/dg/sns-batch-api-actions.html)
- [Amazon SNS — Publishing large messages (MaximumMessageSize)](https://docs.aws.amazon.com/sns/latest/dg/large-message-payloads.html)
- [Amazon SNS — Message filtering](https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html)
- [Amazon SNS — Subscription filter policy scope](https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering-scope.html)
- [Amazon SNS — Filter policy constraints](https://docs.aws.amazon.com/sns/latest/dg/subscription-filter-policy-constraints.html)
- [Amazon SNS — Numeric value matching](https://docs.aws.amazon.com/sns/latest/dg/numeric-value-matching.html)
- [Amazon SNS — String value matching](https://docs.aws.amazon.com/sns/latest/dg/string-value-matching.html)
- [Amazon SNS — AND/OR logic in filter policies](https://docs.aws.amazon.com/sns/latest/dg/and-or-logic.html)
- [Amazon SNS — Applying a subscription filter policy](https://docs.aws.amazon.com/sns/latest/dg/message-filtering-apply.html)
- [Amazon SNS — Raw message delivery](https://docs.aws.amazon.com/sns/latest/dg/sns-large-payload-raw-message-delivery.html)
- [Amazon SNS — Fanout to Amazon SQS queues](https://docs.aws.amazon.com/sns/latest/dg/sns-sqs-as-subscriber.html)
- [Amazon SNS — Subscribing an Amazon SQS queue to a topic](https://docs.aws.amazon.com/sns/latest/dg/subscribe-sqs-queue-to-sns-topic.html)
- [Amazon SNS — Fanout to Lambda functions](https://docs.aws.amazon.com/sns/latest/dg/sns-lambda-as-subscriber.html)
- [Amazon SNS — Fanout to HTTPS endpoints](https://docs.aws.amazon.com/sns/latest/dg/sns-http-https-endpoint-as-subscriber.html)
- [Amazon SNS — Confirming an HTTP/S subscription](https://docs.aws.amazon.com/sns/latest/dg/SendMessageToHttp.confirm.html)
- [Amazon SNS — Configuring the message signature version](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message-configure-message-signature.html)
- [Amazon SNS — Message delivery retries (delivery policies)](https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html)
- [Amazon SNS — SetSubscriptionAttributes delivery policy JSON format](https://docs.aws.amazon.com/sns/latest/dg/set-sub-attributes-delivery-policy-json.html)
- [Amazon SNS — Dead-letter queues](https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html)
- [Amazon SNS — Configuring a dead-letter queue for a subscription](https://docs.aws.amazon.com/sns/latest/dg/sns-configure-dead-letter-queue.html)
- [Amazon SNS — FIFO topics](https://docs.aws.amazon.com/sns/latest/dg/sns-fifo-topics.html)
- [Amazon SNS — Message delivery for FIFO topics](https://docs.aws.amazon.com/sns/latest/dg/fifo-message-delivery.html)
- [Amazon SNS — Message deduplication for FIFO topics](https://docs.aws.amazon.com/sns/latest/dg/fifo-message-dedup.html)
- [Amazon SNS — Message grouping for FIFO topics](https://docs.aws.amazon.com/sns/latest/dg/fifo-message-grouping.html)
- [Amazon SNS — High throughput FIFO topics](https://docs.aws.amazon.com/sns/latest/dg/fifo-high-throughput.html)
- [Amazon SNS — Message archiving and replay for FIFO topics](https://docs.aws.amazon.com/sns/latest/dg/fifo-message-archiving-replay.html)
- [Amazon SNS — Message archiving for FIFO topic owners](https://docs.aws.amazon.com/sns/latest/dg/message-archiving-and-replay-topic-owner.html)
- [Amazon SNS — Message replay for FIFO topic subscribers](https://docs.aws.amazon.com/sns/latest/dg/message-archiving-and-replay-subscriber.html)
- [Amazon SNS — Server-side encryption](https://docs.aws.amazon.com/sns/latest/dg/sns-server-side-encryption.html)
- [Amazon SNS — Topic encryption with encrypted Amazon SQS queue subscriptions](https://docs.aws.amazon.com/sns/latest/dg/sns-enable-encryption-for-topic-sqs-queue-subscriptions.html)
- [Amazon SNS — Sending messages to an SQS queue in a different account](https://docs.aws.amazon.com/sns/latest/dg/sns-send-message-to-sqs-cross-account.html)
- [Amazon SNS — Cross-Region delivery to SQS and Lambda](https://docs.aws.amazon.com/sns/latest/dg/sns-cross-region-delivery.html)
- [Amazon SNS — Email subscriptions](https://docs.aws.amazon.com/sns/latest/dg/sns-email-notifications.html)
- [Amazon SNS — Mobile text messaging (SMS)](https://docs.aws.amazon.com/sns/latest/dg/sns-mobile-phone-number-as-subscriber.html)
- [Amazon SNS — The SMS sandbox](https://docs.aws.amazon.com/sns/latest/dg/sns-sms-sandbox.html)
- [Amazon SNS — Monitoring topics with CloudWatch](https://docs.aws.amazon.com/sns/latest/dg/sns-monitoring-using-cloudwatch.html)
- [Amazon SNS — Message delivery status logging](https://docs.aws.amazon.com/sns/latest/dg/sns-topic-attributes.html)
- [Amazon SNS — Documentation history](https://docs.aws.amazon.com/sns/latest/dg/sns-release-notes.html)
- [AWS General Reference — Amazon SNS endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/sns.html)
- [Amazon SNS API Reference — Publish](https://docs.aws.amazon.com/sns/latest/api/API_Publish.html)
- [Amazon SNS API Reference — Subscribe](https://docs.aws.amazon.com/sns/latest/api/API_Subscribe.html)
- [Amazon SNS API Reference — CreateTopic](https://docs.aws.amazon.com/sns/latest/api/API_CreateTopic.html)
- [AWS CLI Command Reference — aws sns publish](https://awscli.amazonaws.com/v2/documentation/api/latest/reference/sns/publish.html)
- [AWS CLI Command Reference — aws sns subscribe](https://awscli.amazonaws.com/v2/documentation/api/latest/reference/sns/subscribe.html)
- [Amazon SNS pricing](https://aws.amazon.com/sns/pricing/)
- [Amazon SNS FAQs (reliability, ordering, duplicates)](https://aws.amazon.com/sns/faqs/)
- [What's New (September 2026) — Amazon SNS supports message payloads up to 1 MiB](https://aws.amazon.com/about-aws/whats-new/2026/09/amazon-sns-1mib-support/)
- [What's New (January 2025) — High-throughput mode for Amazon SNS FIFO topics](https://aws.amazon.com/about-aws/whats-new/2025/01/high-throughput-mode-amazon-sns-fifo-topics/)
- [What's New (July 2025) — Additional Amazon SNS message filtering operators](https://aws.amazon.com/about-aws/whats-new/2025/07/amazon-sns-message-filtering-operators/)
- [What's New (July 2025) — Amazon SNS standard topics support Amazon SQS fair queues](https://aws.amazon.com/about-aws/whats-new/2025/07/amazon-sns-standard-topics-sqs-fair-queues/)
- [AWS Lambda — Invoking Lambda functions with Amazon SNS notifications](https://docs.aws.amazon.com/lambda/latest/dg/with-sns.html)
- [AWS Lambda — Invoking a function asynchronously](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async.html)
- [AWS Lambda — Error handling and retries for asynchronous invocation](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html)
- [Amazon SQS API Reference — StartMessageMoveTask (DLQ redrive sources)](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_StartMessageMoveTask.html)
- [Amazon EventBridge — What is Amazon EventBridge?](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is.html)
- [Amazon EventBridge — How EventBridge retries delivering events](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-retry-policy.html)
- [Amazon EventBridge — Archiving and replaying events](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-archive.html)
- [What's New (September 2026) — Amazon EventBridge relaunches event buses](https://aws.amazon.com/about-aws/whats-new/2026/09/eventbridge-relaunches-custom-event-buses/)
- [Amazon Kinesis Data Streams — Changing the data retention period](https://docs.aws.amazon.com/streams/latest/dev/kinesis-extended-retention.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
