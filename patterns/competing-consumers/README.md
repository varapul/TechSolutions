<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [📨 Messaging & Integration](../../README.md#messaging--integration)

# Competing Consumers

> Several workers pull from one queue, so work is shared and throughput scales out.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Competing Consumers" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/competing-consumers.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One consumer falls behind** | Jobs arrive at **10 per second** and the only worker finishes **4**. The queue grows by 6 every second and the oldest job waits longer and longer: nothing is lost, but every job is later than the one before it. |
| **2 · Add consumers, one queue** | Three identical workers pull from the **same queue**. The broker hands each message to one worker and hides it from the others while that worker holds it, under a **lease** (the visibility timeout), so the work is shared, not copied as in [publish-subscribe](../publish-subscribe/). Capacity rises to 12 per second and the backlog drains by 2 every second. |
| **3 · A worker dies mid-job** | Worker 2 crashes while it holds **m-41** and never acknowledges it; until it is replaced, the other two handle 8 per second and the backlog grows again. When the lease runs out, the broker makes m-41 visible again and worker 3 processes it: nothing is lost, but worker 2 may have done part of the work, so delivery is **at least once** and processing must be [idempotent](../idempotent-consumer/). A message that keeps failing is moved to a [dead-letter queue](../dead-letter-queue/) after a few attempts. |
| **4 · What you give up: order** | What you give up is **order**: m-50 and m-51 both update order 7, m-50 runs into a slow call and m-51 finishes first. Where per-key order matters, route every message with the same key to one consumer at a time (message groups, sessions or partitions), which caps the parallelism at the number of keys or partitions. Scale the workers on queue depth or the age of the oldest message, and remember that every extra worker adds load on whatever it writes to. |
<!-- END GENERATED: header -->

## The problem

A queue between the part of a system that accepts work and the part that does it turns a burst into a backlog instead of a wave of errors. But a single consumer reading that queue has a fixed pace. In the animation the Orders API puts 10 jobs per second on the queue and the only worker finishes 4, so the backlog grows by 6 every second and each job waits a little longer than the one before it. Nothing is lost, yet as long as arrivals stay above the worker's pace the wait has no upper bound.

A bigger machine raises that ceiling; it does not remove it. A lone consumer is also a single point of failure: while it is crashed, stuck or being redeployed, nothing gets processed at all.

## How it works

Run several identical consumers against **the same queue** and let them compete for its messages. *Enterprise Integration Patterns* describes them as receivers on a point-to-point channel: each message is consumed by exactly one of them, and the messaging system decides which. That is the difference from [publish-subscribe](../publish-subscribe/), where every subscriber gets its own copy. Here the work is divided, not duplicated.

Because any worker can take any message, the pool can grow and shrink without the producer noticing, and a worker that fails takes no work with it. In the animation three workers handle 3 × 4 = 12 jobs per second against the 10 that arrive, so the backlog left over from step 1 drains by 2 every second.

### One message, one worker at a time

In most brokers, taking a message is a two-step affair:

1. **Receive.** The broker hands the message to one consumer and *hides* it from the others for a while, without deleting it. That lease has a different name in each product: the visibility timeout in Amazon SQS, the lock in Azure Service Bus's peek-lock mode, the acknowledgement deadline in Google Cloud Pub/Sub, the acquisition lock in Kafka share groups.
2. **Acknowledge.** When the work is done, the consumer deletes, completes or acks the message, and only then is it gone for good.

If the acknowledgement never comes, because the worker crashed, hung or simply took longer than the lease, the lease runs out and the message becomes visible again for any consumer. That is what happens to m-41 in step 3. RabbitMQ works differently: it has no lease clock. A delivery that was not acknowledged goes back to the queue as soon as the consumer's channel or connection closes, and a delivery acknowledgement timeout (30 minutes by default, and since RabbitMQ 4.3 a quorum-queue feature) catches consumers that stay connected but never answer.

**Acknowledge only after the work is committed.** Modes that remove a message the moment it is handed out are faster and lose work. In Service Bus's receive-and-delete mode a message counts as consumed once it is on the wire; a RabbitMQ consumer with automatic acknowledgement loses the message it was working on, and every message already dispatched to it, when it dies.

### At least once, so make it idempotent

Redelivery is what makes the pattern safe, and also what makes it tricky. Worker 2 may have charged the card, sent the email or written half its rows before it died, and worker 3 then does the job again. Delivery is *at least once*: an SQS standard queue does not even promise that a message is never handed out twice within its visibility timeout. Write the handler so that a repeat has no extra effect, for example by recording the message ID in the same transaction as the work. See [Idempotent Consumer](../idempotent-consumer/).

### Poison messages

A message that can never succeed, such as a malformed payload or an input that hits a bug, comes back after every lease and ties up a worker each time. Count the attempts and park it after a few. Brokers count for you:

- **SQS** increments `ApproximateReceiveCount` on every receive and moves the message to a dead-letter queue once it exceeds the `maxReceiveCount` of the queue's redrive policy. On a standard queue with a `maxReceiveCount` above 3, a message received three or more times without being deleted is also moved to the back of the queue.
- **Service Bus** dead-letters a message after `MaxDeliveryCount` deliveries, 10 by default.
- **RabbitMQ quorum queues** give up after 20 failed deliveries by default (since 4.0) and then drop the message, or dead-letter it if the queue has a dead-letter exchange.
- **Pub/Sub** forwards a message to the subscription's dead-letter topic after 5 delivery attempts by default (5 to 100, and approximate).
- **Kafka share groups** archive a record after 5 delivery attempts by default, after which it is never delivered again.

Alert on whatever lands there. See [Dead-Letter Queue](../dead-letter-queue/).

### Pull, push and prefetch

How messages reach the workers decides how evenly the work is spread. *Enterprise Integration Patterns* names the two styles: a polling consumer asks for the next message when it is ready, and an event-driven consumer is handed messages as they arrive.

- **Pull.** SQS consumers call `ReceiveMessage`, which returns at most 10 messages per call. Turn on long polling (a wait of up to 20 seconds): the call then waits for a message instead of coming back empty, and it asks all of the queue's servers instead of a sample. Kafka consumers poll as well, and so do Pub/Sub pull subscriptions.
- **Push.** RabbitMQ pushes deliveries to the consumers registered on a queue. Fetching one message at a time with `basic.get` also works, but the RabbitMQ documentation recommends long-lived consumers over polling. A Pub/Sub push subscription sends each message to your endpoint.
- **Prefetch.** Fetching ahead keeps a worker busy, but a message that sits in one worker's buffer is not available to a worker that is idle. Without a limit, RabbitMQ deals messages out round-robin, every n-th message to the n-th consumer, however busy that consumer is. Its tutorial's *fair dispatch* sets a prefetch of 1 (`basic.qos`), so a worker gets its next message only after it has acknowledged the last one, and the work goes to whoever is free. A prefetch of 0 means no limit. In Service Bus a prefetched message is already locked and its lock runs while it waits in the buffer, so a big buffer and slow processing can let locks expire before the work starts. Microsoft's guidance is to keep the lock longer than the time it takes to process the whole buffer plus one more message. Keep prefetch small when each message is expensive, and larger when messages are cheap and throughput is what counts.

### Leases for long jobs

Set the lease a little above the normal processing time, and have the worker renew it while a long job runs. A huge lease looks safer, but it also hides a crashed worker's messages for that long.

- **SQS:** 30 seconds by default. `ChangeMessageVisibility` extends it, up to 12 hours counted from the first receive (extending does not restart that clock), and setting it to 0 hands the message back at once. AWS recommends a heartbeat that keeps extending the timeout during long work.
- **Service Bus:** a lock of 1 minute by default and 5 minutes at most, renewed by the client or by the SDK's automatic lock renewal. The Azure Functions trigger renews it while the function runs, but by default only for 5 minutes (`maxAutoLockRenewalDuration` in host.json).
- **Pub/Sub:** an acknowledgement deadline of 10 seconds by default (10 to 600 seconds). The high-level client libraries extend it automatically, by default for up to an hour. The deadline is only guaranteed with exactly-once delivery turned on.
- **Kafka share groups:** an acquisition lock of 30 seconds by default (`share.record.lock.duration.ms`).

Too short a lease and slow messages are processed twice; too long and a crashed worker's message waits that long before anyone retries it.

### Ordering, and what it costs

With several workers, the order in which messages leave the queue is not the order in which their work finishes. In step 4, m-50 and m-51 both update order 7. m-50 runs into a slow call and m-51 is applied first. Microsoft's Service Bus documentation walks through the same race, in which three messages and two consumers end up processed as 2, 3, 1.

Usually only the order *per key* matters: per order, per customer, per account. So brokers let you send every message with the same key to one consumer at a time:

- **Amazon SQS FIFO queues: the message group ID.** Messages of one group are processed one at a time and in order. While one of them is in flight, no other message of that group is handed out until it is deleted or its visibility timeout runs out; different groups are processed in parallel. On a *standard* queue a `MessageGroupId` only switches on fair queues, which keep one noisy tenant from delaying the others and order nothing.
- **Azure Service Bus: sessions.** A receiver accepts a session and then holds an exclusive lock on all of its messages, including those that arrive later; other receivers get other sessions. Sessions are switched on per queue or subscription, after which every message needs a session ID, and the Basic tier does not have them.
- **Apache Kafka: partitions.** A producer that sets a key sends all records with that key to the same partition (the default partitioner hashes the key), and in a consumer group each partition belongs to exactly one consumer. Order per key holds, and parallelism stops at the number of partitions: a fourth consumer on a three-partition topic gets nothing to do. *Share groups* (Queues for Kafka, KIP-932), production-ready since Kafka 4.2, lift that cap. Several consumers can read the same partition, with acknowledgements and delivery counts per record, and in exchange records are no longer processed in order.
- **Google Cloud Pub/Sub: ordering keys.** Turn on message ordering for the subscription and publish related messages with the same ordering key, in the same region. Ordering has its own costs: a redelivered message brings every later message of its key back with it, even those already acknowledged; a push subscription allows only one outstanding message per key; and publishing is limited to 1 MBps per key.
- **RabbitMQ: single active consumer.** Only one consumer at a time reads the queue, and another registered consumer takes over if it is cancelled or disconnects. That keeps a whole queue in order. To order per key and still work in parallel, you would split the keys over several such queues.

The price is the same everywhere. Parallelism is capped at the number of keys, groups or partitions, and one slow or failing message holds up everything behind it with the same key. If the handler can cope with reordering, for example by ignoring an update whose version is older than the one it has already stored, you keep the full parallelism and need none of this.

### Scaling the pool

Scale on what the queue tells you, not on CPU: the number of messages waiting and the age of the oldest one. A worker that waits on I/O can sit behind a huge backlog with an idle CPU. KEDA is an example for Kubernetes. Its SQS scaler aims for a target number of messages per replica (`queueLength`, 5 by default) and counts in-flight messages as well as waiting ones unless told otherwise, and its Pub/Sub scaler can scale on the age of the oldest unacknowledged message instead of the backlog. With `minReplicaCount` at its default of 0, KEDA removes every replica once the queue has been quiet for the cooldown period (300 seconds by default) and starts one again when work arrives. Serverless platforms consume queues the same way, and there too the first message after a quiet spell waits for a cold start. See [Autoscaling](../autoscaling/) and [Serverless](../serverless/).

### Protect what the workers call

Ten workers on one database mean ten times the connections and queries. The queue protects the workers from bursts, and nothing protects the database from the workers except the limits you set: a maximum pool size (KEDA's `maxReplicaCount` is 100 by default), a concurrency limit per worker, a separate pool per dependency ([Bulkhead](../bulkhead/)) and limits on the call rate ([Rate Limiting & Throttling](../rate-limiting/)). Microsoft's description of the pattern also counts a cap on concurrent consumers as a way to control cost.

### Shutting a worker down

Scale-in and deployments stop workers on purpose, so do it gracefully. On `SIGTERM` (Kubernetes sends it, then waits 30 seconds by default before it kills the container), stop receiving, finish and acknowledge what can be finished within the grace period, and hand the rest back instead of letting their leases run out: `ChangeMessageVisibility` to 0 in SQS, *abandon* in Service Bus, a nack with requeue in RabbitMQ (closing the channel requeues too), `close()` on a Kafka share consumer, which releases the records it holds.

### Next to this pattern

- **Urgent work ahead of routine work.** Competing consumers serve a queue roughly in arrival order, so an urgent job waits behind the backlog. The Priority Queue pattern solves that, typically with a queue and a pool of workers for each priority.
- **Results for the caller.** Workers do not answer the producer. If the caller needs the result, use Asynchronous Request-Reply: accept the request with an ID, let the worker store the result or send it on a reply queue with a correlation ID, and let the caller poll or be notified.

## When to use it

- The work arrives as independent tasks that can run in parallel and in any order: resizing images, sending email, rendering documents, indexing, importing files, processing payments for different customers.
- The volume changes over the day and you want to add or remove capacity without touching the producer.
- Processing must survive a worker failure: the other workers carry on, and the failed worker's messages come back.
- Not when the messages need one global order. A single ordered stream can only be processed by one consumer at a time, so there is nothing to compete for.
- Not when the work cannot be split into independent messages, or when one task needs the result of another. A workflow or a saga fits better then.
- Not when the bottleneck is downstream. More workers only press harder on the database or API that is already saturated.

## Trade-offs

- **Order is gone,** or kept only per key at the price of capped parallelism.
- **Duplicates are normal.** Every handler has to be idempotent, and every side effect outside your own database needs its own guard, such as an idempotency key.
- **The lease has to be tuned.** Too short and slow messages run twice; too long and recovery after a crash is slow. Long jobs need renewal code.
- **Poison messages** need a retry limit, a dead-letter queue and someone who looks at it.
- **The load moves downstream.** Scaling out the pool scales out its calls too.
- **Harder to follow.** One request now ends up in one of N workers. Carry a correlation ID in the message and log it, or use [distributed tracing](../distributed-tracing/).
- **The queue can become the bottleneck.** At very high volume a single queue limits throughput; Microsoft suggests partitioning the messaging system across several queues.

## Implementation notes

**The same pattern in each broker:**

| | How workers get messages | Lease (default) | Order per key | Gives up after (default) |
|---|---|---|---|---|
| Amazon SQS | Pull: `ReceiveMessage`, up to 10 per call, long polling up to 20 s | Visibility timeout, 30 s; up to 12 h | FIFO queue with a message group ID | `maxReceiveCount` in the redrive policy, which you set |
| Azure Service Bus | Receivers ask for messages, with optional prefetch | Peek-lock, 1 min (5 min at most), renewable | Sessions | `MaxDeliveryCount`, 10 |
| RabbitMQ | Push to registered consumers, limited by prefetch | No timer: redelivered when the channel or connection closes; acknowledgement timeout 30 min | Single active consumer, per queue | Quorum queues: 20 failed deliveries |
| Apache Kafka, consumer group | Pull: `poll()` | None per record: a partition belongs to one consumer; it is reassigned if `poll()` is not called within `max.poll.interval.ms` (5 min) | Partition, chosen by key | No broker-side limit: the application decides |
| Apache Kafka, share group (4.2+) | Pull: `poll()` | Acquisition lock, 30 s | None | 5 delivery attempts |
| Google Cloud Pub/Sub | Pull or push subscription | Acknowledgement deadline, 10 s (10 to 600 s), extended by the client libraries | Ordering keys, enabled on the subscription | Dead-letter topic: 5 attempts (5 to 100) |

- **Watch depth and age per queue,** and in-flight messages too. In SQS those are `ApproximateNumberOfMessagesVisible`, `ApproximateAgeOfOldestMessage` and `ApproximateNumberOfMessagesNotVisible`. A depth that keeps growing means too few workers; an age that grows while the depth stays small points to messages that keep failing or are stuck behind a key.
- **Keep workers identical and stateless.** Anything a job needs belongs in the message or in a shared store, so that any worker can pick up any message, including one that another worker dropped.
- **Test the crash path.** Kill a worker in the middle of a message and check that the message comes back after its lease, that the second run is harmless and that a message which always fails ends up in the dead-letter queue.
- **Batch with care.** Receiving and acknowledging in batches saves calls, but every message in a batch starts its lease at the same moment. The last message of a slow batch can expire while it waits its turn, and a crashed worker's whole batch comes back together.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Queue-Based Load Leveling](../queue-based-load-leveling/) — A queue absorbs traffic spikes so the backend can work at a steady pace.
- [Publish-Subscribe](../publish-subscribe/) — Broadcast each message to every interested subscriber through a topic.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.
- [Dead-Letter Queue](../dead-letter-queue/) — Park messages that keep failing so they stop blocking the queue and can be inspected.
- [Autoscaling](../autoscaling/) — Add and remove instances automatically as load rises and falls.
- Priority Queue *(planned)* — Urgent messages are processed ahead of routine ones.
- Web-Queue-Worker *(planned)* — A web front end hands slow work to background workers through a queue.
- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.

## References

- [Enterprise Integration Patterns — Competing Consumers](https://www.enterpriseintegrationpatterns.com/patterns/messaging/CompetingConsumers.html)
- [Enterprise Integration Patterns — Point-to-Point Channel](https://www.enterpriseintegrationpatterns.com/patterns/messaging/PointToPointChannel.html)
- [Enterprise Integration Patterns — Polling Consumer](https://www.enterpriseintegrationpatterns.com/patterns/messaging/PollingConsumer.html)
- [Enterprise Integration Patterns — Event-Driven Consumer](https://www.enterpriseintegrationpatterns.com/patterns/messaging/EventDrivenConsumer.html)
- [Azure Architecture Center — Competing Consumers pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/competing-consumers)
- [Amazon SQS — Visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html)
- [Amazon SQS — Short and long polling](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-short-and-long-polling.html)
- [Amazon SQS API Reference — ReceiveMessage](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_ReceiveMessage.html)
- [Amazon SQS — Using the message group ID with FIFO queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/using-messagegroupid-property.html)
- [Amazon SQS — Fair queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fair-queues.html)
- [Amazon SQS — Using dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)
- [Amazon SQS — Available CloudWatch metrics](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-available-cloudwatch-metrics.html)
- [Azure Service Bus — Message transfers, locks, and settlement](https://learn.microsoft.com/en-us/azure/service-bus-messaging/message-transfers-locks-settlement)
- [Azure Service Bus — Message sessions (FIFO)](https://learn.microsoft.com/en-us/azure/service-bus-messaging/message-sessions)
- [Azure Service Bus — Prefetch messages](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-prefetch)
- [RabbitMQ tutorial — Work Queues (acknowledgements, fair dispatch)](https://www.rabbitmq.com/tutorials/tutorial-two-python)
- [RabbitMQ — Consumer Prefetch](https://www.rabbitmq.com/docs/consumer-prefetch)
- [RabbitMQ — Consumers (single active consumer, delivery acknowledgement timeout)](https://www.rabbitmq.com/docs/consumers)
- [RabbitMQ — Consumer Acknowledgements and Publisher Confirms](https://www.rabbitmq.com/docs/confirms)
- [RabbitMQ — Quorum Queues (poison message handling)](https://www.rabbitmq.com/docs/quorum-queues)
- [Apache Kafka 4.3 — KafkaConsumer (consumer groups)](https://kafka.apache.org/43/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html)
- [Apache Kafka 4.3 — KafkaShareConsumer (share groups)](https://kafka.apache.org/43/javadoc/org/apache/kafka/clients/consumer/KafkaShareConsumer.html)
- [Apache Kafka 4.3 — Consumer and share consumer configs (max.poll.interval.ms)](https://kafka.apache.org/43/configuration/consumer-configs/)
- [Apache Kafka 4.3 — Producer configs (partitioning by key)](https://kafka.apache.org/43/configuration/producer-configs/)
- [Apache Kafka 4.3 — Group configs (share-group lock duration and delivery limit)](https://kafka.apache.org/43/configuration/group-configs/)
- [Apache Kafka 4.2 — Upgrade notes (Queues for Kafka is production-ready)](https://kafka.apache.org/42/getting-started/upgrade/)
- [Apache Kafka — KIP-932: Queues for Kafka](https://cwiki.apache.org/confluence/spaces/KAFKA/pages/255070434/KIP-932+Queues+for+Kafka)
- [Google Cloud Pub/Sub — Subscription overview (pull and push)](https://docs.cloud.google.com/pubsub/docs/subscription-overview)
- [Google Cloud Pub/Sub — Order messages](https://docs.cloud.google.com/pubsub/docs/ordering)
- [Google Cloud Pub/Sub — Extend ack time with lease management](https://docs.cloud.google.com/pubsub/docs/lease-management)
- [Google Cloud Pub/Sub — Subscription properties (acknowledgment deadline)](https://docs.cloud.google.com/pubsub/docs/subscription-properties)
- [Google Cloud Pub/Sub — Dead-letter topics](https://docs.cloud.google.com/pubsub/docs/dead-letter-topics)
- [KEDA — AWS SQS Queue scaler](https://keda.sh/docs/latest/scalers/aws-sqs/)
- [KEDA — Google Cloud Platform Pub/Sub scaler](https://keda.sh/docs/latest/scalers/gcp-pub-sub/)
- [KEDA — ScaledObject specification](https://keda.sh/docs/latest/reference/scaledobject-spec/)
- [Kubernetes — Pod Lifecycle (termination of Pods)](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
