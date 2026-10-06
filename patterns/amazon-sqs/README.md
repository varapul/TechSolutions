<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🟧 AWS Services](../../README.md#aws-services)

# Amazon SQS

> A managed message queue: consumers poll, a visibility timeout hides messages in flight, and repeated failures go to a dead-letter queue.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Amazon SQS" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/amazon-sqs.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Acme Shop's Orders API calls `SendMessage` for every new order and answers **202 Accepted** as soon as SQS confirms the message, which it has stored in several Availability Zones. A burst of 8 orders (m-11 to m-18) waits in the standard queue **orders** instead of landing on the workers. Three workers long-poll the queue and each takes the next message when it is free, so the burst drains at their pace and no order is rejected. |
| **2 · Receive, hide, delete** | worker-1's `ReceiveMessage` returns **m-17** with a receipt handle. The message stays in the queue but is hidden from other receivers for the `VisibilityTimeout` of **60 s**, so worker-2 gets m-18 instead; worker-1 then calls `DeleteMessage` with the receipt handle, and only then is m-17 gone. worker-3 finds the queue empty and its long poll (`WaitTimeSeconds` 20) waits instead of returning at once, then returns m-19 as soon as it arrives. |
| **3 · Redelivery and the DLQ** | worker-2 crashes holding **m-18** and never deletes it; once its 60 s run out, m-18 is visible again and worker-3 receives it (receive count 2), which is why handlers must be idempotent. **m-20** can never be processed: after 5 failed receives the redrive policy (`maxReceiveCount` 5) moves it to **orders-dlq**, where an alarm on the queue's depth pages the on-call engineer. After the fix, a redrive (`StartMessageMoveTask`) sends m-20 back to orders. |
| **4 · Standard, FIFO, limits** | A **standard** queue takes a nearly unlimited number of calls per second, but keeps messages in order only on a best-effort basis and may deliver one twice. **payments.fifo** hands out each customer's messages (one message group per customer) in order, holding a group's later messages back while earlier ones are in flight, and drops a resend with the same deduplication ID within 5 minutes; it handles 300 calls per second per API action (3,000 messages with batches of 10), or up to 70,000 in high-throughput mode in US East (N. Virginia), US West (Oregon) and Europe (Ireland). Limits as of October 2026: 1 MiB per message, retention of 1 minute to 14 days (4 by default), a visibility timeout of at most 12 hours and about 120,000 in-flight messages per queue. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's checkout calls the Orders API, and the work behind each order (charging the card, reserving stock, sending the confirmation) takes longer than a shopper should wait and arrives in bursts. If the API calls the workers directly, every sale peak and every worker deployment shows up as timeouts at checkout, and an order that sits in a worker's memory when the worker crashes is lost.

A queue between the two fixes that: the API records the order and answers at once, and the workers take orders at their own pace. Running a message broker for that queue yourself means servers, disks, replication, upgrades and capacity planning. Amazon SQS (Simple Queue Service) is AWS's managed queue. You create a queue and send and receive over an HTTPS API; AWS runs the servers, stores every message redundantly and scales a standard queue with the load, and you pay per request.

## How it works

### Producers, the queue, consumers that poll

- A producer calls `SendMessage`, or `SendMessageBatch` for up to 10 messages and 1 MiB in one call. A standard queue writes the message to servers in several Availability Zones before it acknowledges the call, which is why Acme's API can answer **202 Accepted** as soon as the call returns.
- The queue holds any number of messages. Each one is kept for the queue's `MessageRetentionPeriod`, 4 days by default and anything from 1 minute to 14 days, and is then deleted whether anyone has read it or not.
- Consumers ask for work. `ReceiveMessage` returns up to 10 messages per call; the consumer processes each one and then removes it with `DeleteMessage`. SQS never calls your code: even the Lambda integration is a poller that AWS runs for you.

### Visibility timeout and receipt handles

- Receiving a message does not remove it. SQS hides it from other receivers for the **visibility timeout**: 30 s by default, anything from 0 s to 12 hours, set on the queue (Acme uses 60 s) or on a single `ReceiveMessage` call. That is why worker-2 gets m-18 while worker-1 holds m-17 in step 2.
- Every receive returns a **receipt handle**, which belongs to that receive rather than to the message. `DeleteMessage` and `ChangeMessageVisibility` take the handle, not the message ID. Receive the same message twice and you get two different handles; delete with the older one and the call succeeds, but the message may stay.
- If the message is not deleted before its timeout runs out (the worker crashed, hit a bug or was simply slow), it becomes visible again and the next receive gets it, with its `ApproximateReceiveCount` one higher. That is how m-18 survives worker-2's crash in step 3.
- The timeout is not a lock. A standard queue does not promise that a message is never delivered twice, even within the timeout, and on rare occasions a message can be received again after it was deleted. Make every handler [idempotent](../idempotent-consumer/), for example by recording the order ID in the same database transaction as the work.
- For a long job, keep a heartbeat that calls `ChangeMessageVisibility` before the timeout ends. The new value counts from the moment of the call, and the total cannot go past 12 hours from the first receive: extending does not restart that clock. A value of 0 hands the message back at once, which is what a worker should do with unfinished messages when it shuts down.

```sh
aws sqs receive-message \
  --queue-url https://sqs.us-east-1.amazonaws.com/111122223333/orders \
  --wait-time-seconds 20 --max-number-of-messages 10 \
  --message-system-attribute-names ApproximateReceiveCount
# process each message, then delete it with the handle from this receive
aws sqs delete-message \
  --queue-url https://sqs.us-east-1.amazonaws.com/111122223333/orders \
  --receipt-handle "AQEB…"
```

### Long polling and batching

- With **short polling** (`WaitTimeSeconds` 0, the default) a receive asks only a sample of SQS's servers and answers at once, so it can come back empty while messages wait on other servers.
- With **long polling** (`WaitTimeSeconds` 1 to 20, on the call or as the queue's `ReceiveMessageWaitTimeSeconds`) it asks all of them and returns as soon as a message is there, or empty when the wait is over. In step 2, worker-3's call waits on an empty queue and returns m-19 the moment it arrives. Fewer empty responses also mean fewer billed requests.
- `SendMessageBatch`, `DeleteMessageBatch` and `ChangeMessageVisibilityBatch` take up to 10 entries, and a batch is billed as one request (see the payload rule under Pricing). Entries succeed or fail one by one, so check the `Failed` list even when the call returns HTTP 200.

### Delay queues and message timers

A queue's `DelaySeconds` (0 to 15 minutes) hides every new message for that long before its first delivery. A message timer does the same for one message and overrides the queue's delay; FIFO queues support only the queue-wide delay. A delay hides a message before anyone has received it, the visibility timeout after a receive. For anything further out than 15 minutes, AWS points to EventBridge Scheduler.

### Dead-letter queues and redrive

- A queue's **redrive policy** names a dead-letter queue (`deadLetterTargetArn`) and a `maxReceiveCount` (1 to 1,000; 10 if you leave it out). When a message's receive count goes past it, SQS moves the message to the dead-letter queue instead of delivering it again. In step 3, m-20 goes to orders-dlq after its fifth failed receive.
- The dead-letter queue is an ordinary queue of the same type (FIFO for a FIFO queue) in the same account and Region. Its redrive allow policy can limit which source queues may use it.
- On a standard queue with a `maxReceiveCount` above 3, a message that has been received three or more times without being deleted is also moved to the back of the queue.
- Mind the retention. On a standard queue a message keeps its original enqueue time when it moves, so with the same 4-day retention on both queues, a message that spent 3 days failing in orders has 1 day left in the dead-letter queue. Give the dead-letter queue a longer retention than its source; orders-dlq keeps messages for the maximum, 14 days. In a FIFO queue the clock starts again on the move.
- Alarm on it: a CloudWatch alarm on the dead-letter queue's `ApproximateNumberOfMessagesVisible` tells a person that a message needs a look, as in step 3.
- After the fix, **redrive**, in the console or with `StartMessageMoveTask`. Without a destination it sends each message back to the queue it came from, and `--max-number-of-messages-per-second` caps the rate (500 at most; without it SQS chooses one). Only one move task can run per queue. A redriven message is a new message, with a new message ID and enqueue time, so its retention starts again. FIFO dead-letter queues can be redriven too, and their messages mix with whatever producers send at the same time. Where every operation must stay in sequence, AWS advises against a dead-letter queue on the FIFO queue at all, since moving one message aside already breaks the sequence.

```sh
aws sqs create-queue --queue-name orders --attributes file://orders.json
```

```json
{
  "VisibilityTimeout": "60",
  "ReceiveMessageWaitTimeSeconds": "20",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:111122223333:orders-dlq\",\"maxReceiveCount\":\"5\"}"
}
```

```sh
# after the fix: move the messages in orders-dlq back to orders, 50 per second
aws sqs start-message-move-task \
  --source-arn arn:aws:sqs:us-east-1:111122223333:orders-dlq \
  --max-number-of-messages-per-second 50
```

The pattern itself, with the inspection step in between, is on the [Dead-Letter Queue](../dead-letter-queue/) page.

### Standard or FIFO

- A **standard** queue accepts a nearly unlimited number of API calls per second for each action. It delivers each message at least once, sometimes more often, and keeps the order only on a best-effort basis.
- A **FIFO** queue (its name ends in `.fifo`; an existing standard queue cannot be converted) needs a `MessageGroupId` on every message. Within a group, messages are handed out strictly in order. One receive can return several messages of the same group, but while any of them are in flight, no more of that group are handed out until those are deleted or their visibility timeout runs out. Different groups are processed in parallel, so Acme gives payments.fifo one group per customer: cust-41's payments never overtake each other, and cust-77's do not wait for them. A consumer cannot ask for a particular group.
- FIFO queues also drop duplicates. A message sent again with the same `MessageDeduplicationId` within the 5-minute deduplication interval is accepted but not added again; with `ContentBasedDeduplication` the ID is a SHA-256 hash of the body. A `ReceiveRequestAttemptId` makes a retried receive safe in the same way. A message whose visibility timeout runs out is still delivered again, so the consumer must finish or extend in time.
- Throughput is where FIFO costs you: 300 transactions per second per API action, or 3,000 messages per second with batches of 10. **High-throughput mode** (`DeduplicationScope` = `messageGroup`, `FifoThroughputLimit` = `perMessageGroupId`) raises that to as many as 70,000 transactions per second per action in US East (N. Virginia), US West (Oregon) and Europe (Ireland), or 700,000 messages per second with batching; other Regions get less, down to 2,400 by default. SQS spreads a FIFO queue over partitions by hashing the group ID, so the throughput needs many active groups.
- In flight: a FIFO queue can hold 120,000 received-but-not-deleted messages (raised from 20,000 in November 2024), a standard queue about 120,000. A standard queue that reaches the limit answers short polls with an `OverLimit` error, while a long poll simply returns nothing.
- **Fair queues** (July 2025) are for the opposite problem: a standard queue shared by many tenants. Put the tenant in `MessageGroupId` on a standard queue, and when one tenant holds a disproportionate share of the in-flight messages, SQS delivers the other tenants' messages first, so their wait stays short. Nothing is ordered, and these requests carry an extra fair-queue charge.

### Using SQS with Lambda

- A Lambda **event source mapping** long-polls the queue, invokes the function synchronously with a batch of messages and deletes them when the function succeeds. `BatchSize` is 10 by default, at most 10,000 for a standard queue and 10 for a FIFO queue. `MaximumBatchingWindowInSeconds` (0 to 300, standard queues only) waits to fill a batch, and must be at least 1 when the batch size is above 10.
- If the function fails, the whole batch becomes visible again after the visibility timeout. Add `ReportBatchItemFailures` to `FunctionResponseTypes` and return the IDs of the failed messages, and only those come back.
- On a standard queue Lambda starts with 5 concurrent invocations and adds up to 300 a minute, to at most 1,250 per mapping by default. `ScalingConfig` with `MaximumConcurrency` (2 to 1,000) keeps one queue from taking all of the function's concurrency. **Provisioned mode** (November 2025) instead keeps a minimum and maximum number of pollers ready (`ProvisionedPollerConfig`) and scales faster, at extra cost; it cannot be combined with a maximum concurrency. On a FIFO queue only one invocation works on a message group at a time.
- Set the queue's visibility timeout to at least six times the function timeout, plus the batching window. Lambda refuses a mapping whose function timeout is longer than the queue's visibility timeout.

```sh
aws lambda create-event-source-mapping --function-name process-order \
  --event-source-arn arn:aws:sqs:us-east-1:111122223333:orders \
  --batch-size 10 --function-response-types ReportBatchItemFailures \
  --scaling-config MaximumConcurrency=50
```

```json
{ "batchItemFailures": [ { "itemIdentifier": "<messageId of a message that failed>" } ] }
```

### Scaling workers on the backlog

SQS publishes `ApproximateNumberOfMessagesVisible` (waiting), `ApproximateNumberOfMessagesNotVisible` (in flight) and `ApproximateAgeOfOldestMessage` to CloudWatch for each queue. Scale the workers on the backlog per worker, the visible messages divided by the running workers, against the backlog one worker can clear within the delay you accept; the EC2 Auto Scaling guide shows this with metric math, and explains why the raw queue depth on its own makes a poor target. Alarm on the age of the oldest message as well: a growing age with a small depth points to messages that keep failing. See [Autoscaling](../autoscaling/).

### Large messages

A message can be up to 1 MiB (since 4 August 2025; the limit was 256 KiB before), and a queue's `MaximumMessageSize` can lower that. For anything bigger, the Amazon SQS Extended Client Library for Java or Python puts the payload in Amazon S3 and sends a message that points to it, for payloads of up to 2 GB, and the S3 storage is billed as usual. That is the [Claim Check](../claim-check/) pattern.

### Encryption and access

- New queues are encrypted at rest with SQS-managed keys (SSE-SQS) by default, since late 2022. SSE-KMS uses a key in AWS KMS instead, at the price of KMS calls; `KmsDataKeyReusePeriodSeconds` (1 minute to 24 hours, 5 minutes by default) sets how often SQS goes back to KMS. Requests to an encrypted queue must use HTTPS and Signature Version 4.
- IAM policies give your own roles access. The queue's access policy, a resource-based policy, admits other accounts and AWS services that send to it, such as an SNS topic or an S3 bucket; scope such statements with `aws:SourceArn` or `aws:SourceAccount`. From a VPC, an interface VPC endpoint keeps the traffic off the internet (see [Private Endpoints](../private-endpoints/)).

### Pricing

You pay per request. The first million requests a month are free (counted across Regions); after that, the US East (N. Virginia) price list of September 2026 charges $0.40 per million requests to standard queues and $0.50 per million to FIFO queues, for the first 100 billion requests a month, with lower tiers above. Requests that carry a message group ID to a standard queue pay a fair-queue rate of $0.10 per million on top.

- Every API action counts, empty receives included. Three workers long-polling an idle queue make at most 3 calls a minute each: about 390,000 requests in a 30-day month, roughly $0.16 beyond the free tier.
- A batch of up to 10 messages is one request, but every 64 KB chunk of payload is billed as a request of its own, so a 1 MiB message costs 16.
- Data transfer between SQS and your compute in the same Region is free; SSE-KMS adds KMS charges.

## Where it fits

- **Solutions:** order and job processing behind an API, as here; work queues for EC2, ECS or EKS workers and for Lambda functions; a buffer in front of a slow or rate-limited dependency (a payment provider, a legacy database, a partner API); receiving [S3](../amazon-s3/) event notifications; one queue per subscriber behind an SNS topic or an EventBridge rule; decoupling microservices so one can be down without the others failing.
- **Patterns it implements or supports:** [Queue-Based Load Leveling](../queue-based-load-leveling/) and [Competing Consumers](../competing-consumers/) (steps 1 and 2), [Dead-Letter Queue](../dead-letter-queue/) (step 3), [Claim Check](../claim-check/) (the extended client), [Asynchronous Request-Reply](../asynchronous-request-reply/) (the 202) and [Web-Queue-Worker](../web-queue-worker/). [Publish-Subscribe](../publish-subscribe/) comes from SNS or EventBridge in front of the queues. SQS has no priorities, so a [Priority Queue](../priority-queue/) is one queue per priority. Consumers need to be [idempotent](../idempotent-consumer/), and a producer that writes to its own database and sends a message needs a [transactional outbox](../transactional-outbox/), because `SendMessage` is not part of the database transaction.
- **Usual neighbours:** producers on API Gateway, Lambda, ECS or EC2; SNS and EventBridge for fan-out and routing; [AWS Lambda](../aws-lambda/) or auto-scaled workers as consumers; CloudWatch alarms on the backlog and on the dead-letter queues; KMS for keys; S3 for large payloads.
- **Managed offerings:** SQS is itself the managed service. When applications already speak to a message broker, Amazon MQ runs ActiveMQ or [RabbitMQ](../rabbitmq/) for you; when several consumers need to read and replay the same ordered stream, Kinesis Data Streams or Amazon MSK ([Kafka](../kafka/)) fits better. Other clouds offer Azure Queue Storage and Service Bus, and Google Cloud Pub/Sub.

## When to use it

- Work that can wait seconds and must not be lost: orders, emails, image and document processing, imports, webhooks to deliver.
- Bursty producers and consumers that should scale, fail and deploy independently.
- A small team that wants a queue without running brokers: there is nothing to size, patch or replicate.
- Not when every consumer must see every message (use SNS or EventBridge, each with a queue per consumer), when messages must be replayed or read again later (a stream), when the work needs request-response latency, or when one strict order across all messages is required at high volume (a single FIFO message group is processed one batch at a time).

| | Consumers get messages | Each message goes to | Kept for | Choose it for |
|---|---|---|---|---|
| **SQS standard** | they poll, then delete | one consumer at a time, at least once; order best-effort | until deleted, 1 minute to 14 days | work queues, buffering, decoupling |
| **SQS FIFO** | they poll, then delete | one consumer at a time per group, in order; duplicates dropped for 5 minutes | until deleted, 1 minute to 14 days | order per customer, account or device |
| **Amazon SNS** | pushed to every subscription: SQS, Lambda, HTTP(S), email, SMS, mobile push, Data Firehose | every subscriber, a copy each | no backlog: delivery is retried, then dropped or sent to a dead-letter queue; FIFO topics can archive and replay | fan-out of one message to many |
| **Amazon EventBridge** | pushed to the targets whose rules match the event (up to 5 per rule) | each matching target | retried for up to 24 hours (185 attempts) by default; archives can replay | routing events between services, accounts and SaaS applications |
| **Kinesis Data Streams** | read by position from a shared log | every consuming application, in order per shard | 24 hours by default, up to 365 days | streams that several applications read or replay |
| **Amazon MQ** | through ActiveMQ Classic or RabbitMQ brokers that AWS manages | as the broker's queues and topics define | until consumed | applications that already speak to such a broker |

## Trade-offs

- **At least once, and roughly in order.** Standard queues can deliver a message twice and out of order; FIFO queues fix both, for a throughput ceiling and blocking within a group.
- **Polling has a cost.** Consumers pay for every receive, empty ones included, and a message waits until the next receive picks it up. Long polling makes both small.
- **No replay.** A deleted message is gone, and one nobody deletes expires after at most 14 days. A second consumer cannot read the same messages later; put SNS or EventBridge in front, or use a stream.
- **One timeout to tune.** Too short and slow messages are processed twice; too long and a crashed worker's messages wait that long. Long jobs need heartbeat code.
- **Limits to design around:** 1 MiB per message, 12 hours of visibility, about 120,000 messages in flight per queue, 15 minutes of delay and 14 days of retention.
- **Few features inside the queue.** No priorities, no filtering or routing by content, and delays of at most 15 minutes; those come from other services (SNS subscriptions, EventBridge rules, EventBridge Scheduler).
- **AWS only.** The API is SQS's own; moving off AWS means new client code, unlike a broker with a standard protocol.

## Implementation notes

- **Choose the settings on purpose:** `VisibilityTimeout` a little above the normal processing time (or six times a Lambda function's timeout), `ReceiveMessageWaitTimeSeconds` 20, a redrive policy on every queue with a `maxReceiveCount` high enough to ride out a short outage of a dependency, and a dead-letter queue retention longer than the source's.
- **Alarm on three numbers:** messages visible in each dead-letter queue, the age of the oldest message in each work queue, and messages in flight against the 120,000 limit.
- **Make processing idempotent** and delete only after the work is committed. Recognise repeats by a business key such as the order ID rather than the message ID, which a redrive replaces.
- **Shut down gracefully:** on `SIGTERM`, stop receiving, finish what can be finished, and hand the rest back with `ChangeMessageVisibility` set to 0.
- **Keep the producer honest:** send after the database commit through an outbox, retry `SendMessage` on errors, and on FIFO queues reuse the same `MessageDeduplicationId` for a retried send.
- **Batch where it pays:** send and delete in batches of up to 10 for busy queues, and watch for partial failures in each batch.
- **Define queues as code** (CloudFormation, CDK or Terraform), including the dead-letter queue, the redrive policy, the access policy and the alarms, so every environment gets the same safety net.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Queue-Based Load Leveling](../queue-based-load-leveling/) — A queue absorbs traffic spikes so the backend can work at a steady pace.
- [Competing Consumers](../competing-consumers/) — Several workers pull from one queue, so work is shared and throughput scales out.
- [Dead-Letter Queue](../dead-letter-queue/) — Park messages that keep failing so they stop blocking the queue and can be inspected.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.
- Amazon SNS *(planned)* — Managed publish-subscribe: a message published to a topic fans out to queues, functions, HTTP endpoints, email and SMS.
- [AWS Lambda](../aws-lambda/) — Functions as a service: code runs per event in managed execution environments that scale out with concurrency.
- [RabbitMQ](../rabbitmq/) — A message broker: exchanges route each message into queues, and a consumer holds it until it acknowledges or rejects it.
- [Apache Kafka](../kafka/) — A partitioned, replicated commit log: producers append events, consumer groups read at their own pace and can replay history.

## References

- [Amazon SQS Developer Guide — What is Amazon Simple Queue Service?](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html)
- [Amazon SQS — Standard queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html)
- [Amazon SQS — Visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html)
- [Amazon SQS — Queue and message identifiers (receipt handle)](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-queue-message-identifiers.html)
- [Amazon SQS — Short and long polling](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-short-and-long-polling.html)
- [Amazon SQS — Batch actions](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-batch-api-actions.html)
- [Amazon SQS — Delay queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-delay-queues.html)
- [Amazon SQS — Message timers](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-message-timers.html)
- [Amazon SQS — Using dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)
- [Amazon SQS — Configure a dead-letter queue (console)](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue.html)
- [Amazon SQS — Configure a dead-letter queue redrive](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html)
- [Amazon SQS — Creating alarms for dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/dead-letter-queues-alarms-cloudwatch.html)
- [Amazon SQS — FIFO queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fifo-queues.html)
- [Amazon SQS — FIFO queue delivery logic](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-understanding-logic.html)
- [Amazon SQS — Exactly-once processing (FIFO deduplication)](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-exactly-once-processing.html)
- [Amazon SQS — Moving from a standard queue to a FIFO queue](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-moving.html)
- [Amazon SQS — High throughput for FIFO queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/high-throughput-fifo.html)
- [Amazon SQS — FIFO queue and Lambda concurrency behavior](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/fifo-queue-lambda-behavior.html)
- [Amazon SQS — Fair queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fair-queues.html)
- [Amazon SQS — How fair queues work](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fair-queues-detailed.html)
- [Amazon SQS — Message quotas (size, retention, FIFO throughput)](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html)
- [Amazon SQS — Standard queue quotas (in-flight messages)](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-queues.html)
- [Amazon SQS — FIFO queue quotas](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-fifo.html)
- [Amazon SQS — Managing large messages with the Extended Client Library and Amazon S3](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-managing-large-messages.html)
- [Amazon SQS — Encryption at rest](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-server-side-encryption.html)
- [Amazon SQS — Basic examples of Amazon SQS policies](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-basic-examples-of-sqs-policies.html)
- [Amazon SQS — Internetwork traffic privacy (VPC endpoints)](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-internetwork-traffic-privacy.html)
- [Amazon SQS — Available CloudWatch metrics](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-available-cloudwatch-metrics.html)
- [Amazon SQS — Documentation history](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-release-notes.html)
- [Amazon SQS API Reference — ReceiveMessage](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_ReceiveMessage.html)
- [Amazon SQS API Reference — DeleteMessage](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_DeleteMessage.html)
- [Amazon SQS API Reference — ChangeMessageVisibility](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_ChangeMessageVisibility.html)
- [Amazon SQS API Reference — SendMessageBatch](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_SendMessageBatch.html)
- [Amazon SQS API Reference — SetQueueAttributes](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_SetQueueAttributes.html)
- [Amazon SQS API Reference — StartMessageMoveTask](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_StartMessageMoveTask.html)
- [Amazon SQS pricing](https://aws.amazon.com/sqs/pricing/)
- [AWS What's New (Aug 2025) — Amazon SQS increases maximum message payload size to 1 MiB](https://aws.amazon.com/about-aws/whats-new/2025/08/amazon-sqs-max-payload-size-1mib/)
- [AWS What's New (Jul 2025) — Amazon SQS introduces fair queues for multi-tenant workloads](https://aws.amazon.com/about-aws/whats-new/2025/07/amazon-sqs-introduces-fair/)
- [AWS What's New (Nov 2024) — Amazon SQS increases in-flight limit for FIFO queues from 20K to 120K](https://aws.amazon.com/about-aws/whats-new/2024/11/amazon-sqs-increases-in-flight-limit-fifo-queues/)
- [AWS What's New (Nov 2023) — Amazon SQS announces support for FIFO dead-letter queue redrive](https://aws.amazon.com/about-aws/whats-new/2023/11/amazon-sqs-fifo-dead-letter-queue-redrive/)
- [AWS What's New (Oct 2022) — SSE-SQS encryption by default](https://aws.amazon.com/about-aws/whats-new/2022/10/amazon-sqs-announces-server-side-encryption-ssq-managed-sse-sqs-default/)
- [AWS Lambda — Using Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)
- [AWS Lambda — Creating and configuring an Amazon SQS event source mapping](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html)
- [AWS Lambda — Configuring scaling behavior for SQS event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html)
- [AWS Lambda — Handling errors for an SQS event source (partial batch responses)](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html)
- [AWS Lambda — Lambda parameters for Amazon SQS event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-parameters.html)
- [AWS Lambda API Reference — ScalingConfig (MaximumConcurrency)](https://docs.aws.amazon.com/lambda/latest/api/API_ScalingConfig.html)
- [AWS What's New (Nov 2025) — Provisioned Mode for SQS event source mappings](https://aws.amazon.com/about-aws/whats-new/2025/11/aws-lambda-provisioned-mode-sqs-esm/)
- [Amazon EC2 Auto Scaling — Scaling policy based on Amazon SQS](https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-using-sqs-queue.html)
- [AWS CLI — aws sqs receive-message](https://docs.aws.amazon.com/cli/latest/reference/sqs/receive-message.html)
- [AWS CLI — aws sqs create-queue](https://docs.aws.amazon.com/cli/latest/reference/sqs/create-queue.html)
- [AWS CLI — aws sqs start-message-move-task](https://docs.aws.amazon.com/cli/latest/reference/sqs/start-message-move-task.html)
- [AWS CLI — aws lambda create-event-source-mapping](https://docs.aws.amazon.com/cli/latest/reference/lambda/create-event-source-mapping.html)
- [Amazon SNS — What is Amazon SNS?](https://docs.aws.amazon.com/sns/latest/dg/welcome.html)
- [Amazon SNS — Fanout to Amazon SQS queues](https://docs.aws.amazon.com/sns/latest/dg/sns-sqs-as-subscriber.html)
- [Amazon SNS — Subscribing an Amazon SQS queue to an Amazon SNS topic (queue policy)](https://docs.aws.amazon.com/sns/latest/dg/subscribe-sqs-queue-to-sns-topic.html)
- [Amazon SNS — Message delivery retries](https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html)
- [AWS What's New (Oct 2023) — Amazon SNS message archiving and replay for FIFO topics](https://aws.amazon.com/about-aws/whats-new/2023/10/amazon-sns-in-place-message-archiving-replay-fifo-topics/)
- [Amazon EventBridge — Event bus targets](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-targets.html)
- [Amazon EventBridge — How EventBridge retries delivering events](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-retry-policy.html)
- [Amazon EventBridge — Archiving and replaying events](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-archive.html)
- [Amazon Kinesis Data Streams — Terminology and concepts](https://docs.aws.amazon.com/streams/latest/dev/key-concepts.html)
- [Amazon Kinesis Data Streams — Change the data retention period](https://docs.aws.amazon.com/streams/latest/dev/kinesis-extended-retention.html)
- [Amazon MQ — What is Amazon MQ?](https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/welcome.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
