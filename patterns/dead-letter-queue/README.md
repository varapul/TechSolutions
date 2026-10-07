<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [📨 Messaging & Integration](../../README.md#messaging--integration)

# Dead-Letter Queue

> Park messages that keep failing so they stop blocking the queue and can be inspected.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Dead-Letter Queue" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/dead-letter-queue.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · A poison message** | `m-13` carries a field the handler does not expect, so the handler throws and never acknowledges the message. The broker makes it available again and delivers it again, and its **receive count** climbs to 1, 2, 3 with the same error each time: a retry cannot fix a failure that is in the message or in the code. This queue delivers in order, so `m-14`, `m-15` and `m-16` wait behind it. In an unordered queue they would get through, but each redelivery of `m-13` would still burn consumer capacity. |
| **2 · Park it after 3 receives** | The source queue has a dead-letter policy with a **maximum receive count** of 3. Instead of delivering `m-13` a fourth time, the broker moves it to the **dead-letter queue** together with what it knows: the reason (receive limit reached), the receive count and the queue it came from. The source queue flows again, and `m-14`, `m-15` and `m-16` are handled and saved. |
| **3 · Alarm, then inspect** | The dead-letter queue now holds one message, and an alarm on *depth > 0* pages the on-call engineer. Without that alarm a dead-letter queue is silent data loss: nothing consumes it, and many brokers delete parked messages when their retention runs out. The engineer reads `m-13` without removing it, matches it with the handler's error log and finds the cause: the handler rejects any field it does not know. The message is valid and the bug is in the consumer, so the fix is a new handler version. |
| **4 · Redrive** | Only after the fix is deployed does the engineer **redrive** `m-13`: it re-enters the source queue as a new delivery with a fresh receive count, handler v2 saves it, and the dead-letter queue is empty again. It is saved after `m-14` to `m-16`, because parking a message gives up its place in the order. A redriven message can also repeat work that was partly done before it failed, so the consumer must be **idempotent**. A message that is invalid for good is archived or discarded on purpose instead, not left to expire. |
<!-- END GENERATED: header -->

## The problem

A consumer that cannot process a message does the sensible thing: it does not acknowledge it, and the broker delivers it again. For a **transient** failure (a database failover, a throttled API, a deployment in progress) that is exactly right, because a later attempt will probably succeed. For a **poison message** it is exactly wrong. A poison message fails every time: its payload is malformed, it carries a field or a value the code does not expect, it points at a record that no longer exists, or it reaches a bug that no other input reaches. Delivering it again changes nothing.

Redelivered without limit, such a message costs you in one of two ways:

- **In an ordered queue it blocks.** Where messages are delivered strictly in order (a FIFO message group, a session, a partition), the next one is not handed out until the current one is settled. One bad message stops everything behind it. That is the queue in the diagram.
- **In an unordered queue it burns capacity.** The other messages get through, but the bad one keeps coming back, occupies a consumer each time and fills the error log. It does that for ever, or until the queue's retention runs out and it is deleted without anyone having looked at it.

## How it works

A dead-letter queue (DLQ) is a second queue, attached to the first, for messages that are no longer worth delivering.

1. **Count the deliveries.** The broker keeps a counter on every message and raises it each time the message is delivered. A delivery that ends without an acknowledgement (the handler failed, the consumer crashed, the lock ran out) leaves the message in the queue with a higher count. Brokers call it the receive count, the delivery count or the number of delivery attempts.
2. **Move the message at the limit.** A policy on the source queue names the dead-letter queue and a maximum count. When a message has used up its deliveries, the broker moves it instead of delivering it again, and the source queue carries on with the next message. In the diagram the limit is 3 and `m-13` is moved in place of a fourth delivery.
3. **Or move it at once.** A consumer that can tell that a failure is permanent (the payload does not parse, a required field is missing) does not have to use up the attempts. It dead-letters the message itself and says why.
4. **Keep the evidence.** The message arrives with its payload and headers unchanged, plus what is known about the failure: where it came from, how often it was delivered, why it was moved.
5. **Raise an alarm.** Nothing consumes a dead-letter queue in the normal flow, so its depth should be zero. An alarm on a depth above zero tells a person that a message needs a decision.
6. **Decide.** That person reads the message and the handler's logs, then either fixes the cause and **redrives** the message to the source queue, or archives or discards it on purpose.

Brokers also dead-letter messages that no handler ever failed on: a message that expired, a queue that grew past its length limit. *Enterprise Integration Patterns* keeps the two cases apart. Its **Dead Letter Channel** is where the messaging system puts a message it cannot deliver, and its **Invalid Message Channel** is where a receiver puts a message it cannot make sense of. Today's dead-letter queues usually do both jobs, which is one more reason to store the reason with every message.

## When to use it

- On every queue or subscription whose messages you are not prepared to lose: commands, orders, payments, business events.
- Wherever input comes from outside your control: other teams, partners, webhooks, an old producer that still sends last year's format. Sooner or later one of them sends something the consumer does not expect.
- Where one stuck message must not stop the others, and that message's place in the order can be given up.
- Behind consumers that a platform runs for you (functions, connectors, stream processors), which otherwise stop at the bad record, or retry for a while and then drop it. See [Serverless](../serverless/).

Do **not** use one:

- **For data you may drop.** Metric samples, cache invalidations and presence updates are stale within seconds. Count the failure and drop the message; parking it only builds a pile that nobody will read.
- **Where order must never be broken.** If each message builds on the one before it (ledger entries, a [change stream](../change-data-capture/) applied to a replica, a sequence of edits), skipping one corrupts everything after it. Stop the consumer, alert, and treat the stuck message as an incident.
- **In place of retries.** A dead-letter queue is for the failures that retrying cannot fix. If transient failures reach it, the retry policy is wrong.

## Trade-offs

- **It only moves the problem.** A parked message is still an order that was not processed. Without an alarm, an owner and a deadline, the dead-letter queue is where messages go to be forgotten.
- **Order is given up.** The parked message is handled later than the ones behind it, or never. In the diagram, order 13 is saved after order 16.
- **Redrive creates duplicates.** The handler may have finished part of its work before it failed, and an operator can redrive the same message twice. Every consumer in front of a dead-letter queue has to be idempotent.
- **An outage can flood it.** While a dependency is down, *every* message fails all of its attempts and is dead-lettered, although nothing is wrong with any of them. You are left with thousands of healthy messages in the wrong queue and a replay to plan. During an outage it is better to slow down than to park: back off, or stop consuming until the dependency is back, which a [circuit breaker](../circuit-breaker/) can decide.
- **The broker does not know why.** A message that was moved because of its count carries no error. The reason has to come from the consumer.
- **It is a second copy of your data,** kept for longer and often behind weaker access rules than the first.

## Implementation notes

- **Transient or permanent.** Classify failures in the consumer. Transient ones (timeouts, throttling, connection errors, lock conflicts) get [retries with backoff](../retry-with-backoff/), and a message is dead-lettered only when those are used up. Failures that will be the same tomorrow (a payload that does not parse or validate, an unknown message type, a business rule that rejects it) go to the dead-letter queue at once, with the reason attached. Some brokers have an operation for that: an explicit dead-letter call in Azure Service Bus, or in RabbitMQ a reject without requeue on a queue that has a dead-letter exchange. Elsewhere the consumer publishes the message to the dead-letter queue itself and then acknowledges the original, in that order, so that a crash in between duplicates the message and does not lose it.
- **Choosing the limit.** The limit multiplied by the wait between deliveries is how long a poison message blocks an ordered queue or wastes capacity in an unordered one. Set it too low and ordinary hiccups park healthy messages: with a limit of 1, a single failed receive is enough. The count also rises on every delivery that is not acknowledged in time, including the ones where the consumer crashed, was scaled in or was simply slower than its lock or visibility timeout, so keep that timeout above your slowest processing time. The diagram uses 3 to keep the animation short; AWS suggests at least 5 when Lambda reads from SQS, and the vendors' defaults run from 5 to 20:

  | Broker | Setting | Default |
  |---|---|---|
  | Amazon SQS | `maxReceiveCount` in the source queue's redrive policy | 10 |
  | Azure Service Bus | maximum delivery count (`MaxDeliveryCount`) of the queue or subscription | 10 |
  | RabbitMQ, quorum queues | `delivery-limit` | 20, since RabbitMQ 4.0 |
  | Google Cloud Pub/Sub | maximum delivery attempts of the subscription | 5 (5 to 100 allowed) |
  | Apache Kafka, share groups | `group.share.delivery.count.limit` | 5 |

- **What to record with the message.** Leave the payload and the original headers untouched, so that the message can be redriven exactly as it was. Add, as headers or attributes: the source queue or topic (on a log, also the partition and offset), the delivery count, the time of the first failure and of the dead-lettering, the error type and message, the name and version of the consumer, and the correlation or trace ID. Brokers add what they know. RabbitMQ records each dead-lettering in the message's `x-death` header: the queue, the reason and a count. Pub/Sub adds attributes that name the source subscription and the delivery count. Service Bus sets a dead-letter reason and a description. None of them knows your exception unless the consumer supplies it, so at the very least log the error together with the message ID.
- **Ordering.** In an ordered queue the choice is explicit: block the group until the message is fixed, or park the message and let the group continue out of order. Parking suits groups whose messages do not depend on each other, such as different orders that happen to share a partition. Blocking suits groups in which each message builds on the last. A middle course parks the failed message and then every later message with the same key until the first one is resolved. That keeps the order within the key, at the price of tracking which keys are blocked.
- **Retention and age.** Give the dead-letter queue a longer retention than the source queue, and give yourself a deadline for emptying it: every dead letter redriven, archived or discarded within a week, say. In an SQS standard queue the clock does not restart when a message is moved, so a message that spent one day in the source queue has one day less in the dead-letter queue. In Service Bus, by contrast, dead-lettered messages never expire and stay until someone removes them.
- **Alert on depth and on age.** Alarm when the depth is above zero (or above a small number, where the odd dead letter is normal) and when the oldest message is older than your deadline. Use a metric that counts what is *in* the queue. For SQS that is `ApproximateNumberOfMessagesVisible`, because `NumberOfMessagesSent` leaves out the messages that the redrive policy moved. Azure Monitor has `DeadletteredMessages`, and Pub/Sub has `subscription/dead_letter_message_count` for the messages forwarded from a subscription. Send the alarm to the team that owns the consumer, and chart dead letters by error type: a sudden wave with one error is a deployment or an outage, a trickle of different errors is bad input.
- **One per source.** Give each source queue or subscription its own dead-letter queue. The owner, the alarm and the redrive target are then never in doubt.
- **Redrive safely.** Fix first: a redrive before the fix only sends the messages round the loop again. Start with one message, then replay the rest at a limited rate so that it does not starve live traffic; an SQS redrive takes a maximum number of messages per second. Make the consumer [idempotent](../idempotent-consumer/), and deduplicate on an ID carried inside the message, because the broker's own ID may not survive: SQS gives every redriven message a new message ID. Send the message back to the queue that failed, not to the topic that feeds every subscriber, or the healthy subscribers get it a second time. And stop loops: count redrives in a header and give up after one or two.
- **A middle stage: retry topics and delay queues.** Between *retry now* and *dead* there is room for *retry later, without blocking*. The consumer republishes the failed message to a retry queue with a delay (10 seconds, then 1 minute, then 10 minutes), acknowledges the original and moves on, and a message that fails the last stage goes to the dead-letter queue. Uber describes this arrangement for Kafka, with one topic for each delay. In SQS a per-message visibility timeout of up to 12 hours gives a similar delay, and in RabbitMQ so does a waiting queue whose messages expire into a dead-letter exchange that routes them back to the work queue. Like the dead-letter queue itself, it costs the retried message its place in the order.
- **Security.** A dead-letter queue holds the same personal or financial data as its source, for longer, and tends to be read by more people. Give it the same encryption and the same access rules, restrict who may read it and who may redrive (a redrive replays commands), and include it when you delete or export a person's data. Keep secrets and whole payloads out of error descriptions and logs. In SQS, a redrive allow policy on the dead-letter queue limits which source queues may use it.
- **How brokers do it.** Examples, checked in October 2026:
  - **Amazon SQS.** The source queue's redrive policy names a dead-letter queue (`deadLetterTargetArn`) and a `maxReceiveCount`. The dead-letter queue is an ordinary queue of the same type (FIFO for FIFO, standard for standard) in the same account and Region. A *redrive*, started in the console or with `StartMessageMoveTask`, moves the messages back to the source queue or to another queue of that type.
  - **Azure Service Bus.** Every queue and every topic subscription has a built-in dead-letter subqueue (`<queue>/$deadletterqueue`). A message goes there when its delivery count passes the limit, when it expires and dead-lettering of expired messages is enabled, or when the receiver dead-letters it with a reason and a description.
  - **RabbitMQ.** A policy gives a queue a dead-letter exchange, which routes dead letters to whichever queue you bind to it. A message is dead-lettered when a consumer rejects it without requeueing, when it expires, when the queue is over its length limit, or when a quorum queue's delivery limit is passed. A quorum queue with no dead-letter exchange *drops* the message at that limit. Dead-lettering is at-most-once by default, and quorum queues can be switched to at-least-once.
  - **Google Cloud Pub/Sub.** A subscription names a dead-letter topic and a maximum number of delivery attempts, which Pub/Sub applies on a best-effort basis, so the count is approximate. The dead-letter topic needs a subscription of its own, or the forwarded messages are lost, and the Pub/Sub service account needs permission to publish to it. With message ordering enabled, order is not guaranteed for the messages that are forwarded.
  - **Apache Kafka.** There is no broker-side dead-letter queue for ordinary consumer groups: the consumer, or its framework, publishes the failed record to a dead-letter topic and commits past it. Kafka Connect does this for sink connectors (`errors.tolerance=all` with `errors.deadletterqueue.topic.name`), and since Kafka 4.2 the default exception handlers of Kafka Streams do it when `errors.dead.letter.queue.topic.name` is set. Share groups (*Queues for Kafka*, production-ready since 4.2) count delivery attempts and stop delivering a record at the limit, but in Kafka 4.3 they still have no dead-letter topic: KIP-1191, which adds one, is accepted and not yet released.
  - **Serverless consumers.** When a function reads from a queue, the dead-letter queue belongs to the *queue*: with SQS as the event source of an AWS Lambda function, it is the source queue's redrive policy that parks the message. For asynchronous invocations Lambda retries twice by itself, then sends the event to an on-failure destination or a dead-letter queue if one is configured, and discards it if not. Azure Functions gives a Storage queue message five attempts and then moves it to a *poison queue* named `<queue>-poison`.
- **Rehearse it.** Put a poison message into a test environment and watch all of it happen: the message is parked, the alarm fires, the tool shows the reason, and a redrive after the fix goes through. A dead-letter queue that has never been exercised usually has no alarm and no runbook.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Retry with Backoff & Jitter](../retry-with-backoff/) — Retry transient failures with growing, randomised delays so clients don't stampede.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.
- [Queue-Based Load Leveling](../queue-based-load-leveling/) — A queue absorbs traffic spikes so the backend can work at a steady pace.
- [Competing Consumers](../competing-consumers/) — Several workers pull from one queue, so work is shared and throughput scales out.
- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.
- [Transactional Outbox](../transactional-outbox/) — Save the event in the same database transaction as the data, then relay it: no dual-write gap.
- [Serverless (Functions)](../serverless/) — Functions start per event, scale out automatically and scale to zero when idle.
- [Publish-Subscribe](../publish-subscribe/) — Broadcast each message to every interested subscriber through a topic.

## Related components and services

- [RabbitMQ](../rabbitmq/) — A message broker: exchanges route each message into queues, and a consumer holds it until it acknowledges or rejects it.
- [Amazon SQS](../amazon-sqs/) — A managed message queue: consumers poll, a visibility timeout hides messages in flight, and repeated failures go to a dead-letter queue.
- [Amazon SNS](../amazon-sns/) — Managed publish-subscribe: a message published to a topic fans out to queues, functions, HTTP endpoints, email and SMS.

## References

- [Enterprise Integration Patterns — Dead Letter Channel](https://www.enterpriseintegrationpatterns.com/patterns/messaging/DeadLetterChannel.html)
- [Enterprise Integration Patterns — Invalid Message Channel](https://www.enterpriseintegrationpatterns.com/patterns/messaging/InvalidMessageChannel.html)
- [Amazon SQS — Using dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)
- [Amazon SQS — Learn how to configure a dead-letter queue redrive](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html)
- [Amazon SQS — Available CloudWatch metrics (dead-letter queues)](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-available-cloudwatch-metrics.html)
- [Amazon SQS — Visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html)
- [Azure Service Bus — Dead-letter queues](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-dead-letter-queues)
- [RabbitMQ — Dead Letter Exchanges](https://www.rabbitmq.com/docs/dlx)
- [RabbitMQ — Quorum Queues (poison message handling)](https://www.rabbitmq.com/docs/quorum-queues)
- [Google Cloud Pub/Sub — Dead-letter topics](https://docs.cloud.google.com/pubsub/docs/dead-letter-topics)
- [Apache Kafka 4.3 — Kafka Connect configs (errors.tolerance, errors.deadletterqueue.*)](https://kafka.apache.org/43/configuration/kafka-connect-configs/)
- [Apache Kafka 4.3 — Kafka Streams upgrade guide (dead-letter queue support in 4.2)](https://kafka.apache.org/43/streams/upgrade-guide/)
- [Apache Kafka — KIP-932: Queues for Kafka (share groups)](https://cwiki.apache.org/confluence/spaces/KAFKA/pages/255070434/KIP-932+Queues+for+Kafka)
- [Apache Kafka — KIP-1191: Dead-letter queues for share groups](https://cwiki.apache.org/confluence/spaces/KAFKA/pages/373885564/KIP-1191+Dead-letter+queues+for+share+groups)
- [Uber Engineering — Building Reliable Reprocessing and Dead Letter Queues with Apache Kafka](https://www.uber.com/blog/reliable-reprocessing/)
- [AWS Lambda — Creating and configuring an Amazon SQS event source mapping](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html)
- [AWS Lambda — Capturing records of asynchronous invocations](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-retain-records.html)
- [Azure Functions — Azure Queue storage trigger (poison messages)](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-storage-queue-trigger)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
