<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [📨 Messaging & Integration](../../README.md#messaging--integration)

# Queue-Based Load Leveling

> A queue absorbs traffic spikes so the backend can work at a steady pace.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Queue-Based Load Leveling" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/queue-based-load-leveling.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Without a queue** | The API tier calls the backend directly and every caller waits for its answer. A 2-second spike of 15 requests per second meets a service that can finish 5 per second. Of the 30 calls only 10 can be answered in time. The other 20 time out, and the database behind the service is overloaded as well. |
| **2 · Put a queue in between** | The API tier now writes each request to a durable queue and replies **202 Accepted** as soon as the queue has acknowledged the message. A worker pulls from the queue at its own pace. At the normal 3 per second it has capacity to spare (it can do 5), so messages pass straight through and the queue stays empty. |
| **3 · The spike is absorbed** | The same spike arrives: 15 messages per second for 2 seconds. The worker keeps to 5 per second, so the backlog grows by 10 every second and peaks at 20. Nothing is dropped and the database sees no spike. The price is **waiting time**: the oldest message in the queue gets older, and a message that arrives now waits 20 ÷ 5 = 4 seconds. |
| **4 · Drain, and know the limits** | Arrivals fall back to 3 per second, which leaves the worker 2 per second to spare, so the 20 queued messages clear in 10 seconds (shown fast-forwarded). A queue only **moves load in time**: if arrivals stay above capacity it grows without end. So cap the queue and reject or shed when it is full, alert on its depth and on the age of the oldest message, and scale the workers on those two signals. |
<!-- END GENERATED: header -->

## The problem

A front end can accept work much faster than the service behind it can finish it. As long as it calls that service directly and waits, the service has to keep up with every burst: a sale opens, a batch job starts, a partner replays a day of webhooks. A backend that can finish 5 requests per second is suddenly offered 15. It cannot work faster, so requests wait inside it, callers run into their timeouts, and many of them retry, which adds to the pile. The service still works through requests whose callers have already given up, so that work is wasted, and the database behind it sees the same burst as contention for connections and locks.

The classic fix is to size the backend for the peak. That works, and most of that capacity then sits idle for most of the day.

## How it works

Put a durable queue between the component that accepts work and the component that does it, and let each side run at its own rate.

- The **producer** (here the web or API tier) validates the request, writes a message to the queue and replies as soon as the queue has acknowledged it. Over HTTP that reply is usually `202 Accepted`, a status that only says the request has been taken on, not that the work is done.
- The **queue** stores messages until a consumer takes them. Its depth grows whenever arrivals outpace processing and shrinks when processing catches up.
- The **worker** pulls messages at a rate that the backend and its database can sustain, and removes a message from the queue only after its work has succeeded.

What the backend sees is now set by the worker's pace, not by the callers. A spike no longer turns into errors. It turns into a backlog, and the backlog into waiting time.

**What the caller gets back.** An acknowledgement now and the result later. The acknowledgement means *stored safely*, not *done*, so the caller needs another way to learn the outcome: a status URL to poll (sent in the `Location` header of the 202, with a `Retry-After` hint), a webhook, a push over an open connection, or simply the email that says the order has shipped. That is the Asynchronous Request-Reply pattern, and it is a real part of the cost of adopting a queue. Validate before you enqueue: a malformed request should get its 4xx while the caller is still there to read it.

**Sizing it.** Three numbers describe the behaviour: the arrival rate, the service rate (what the workers finish per second) and the backlog. The animation uses one worker that finishes 5 messages per second, a normal load of 3 per second and a spike of 15 per second that lasts 2 seconds.

| Question | Rule | In the animation |
|---|---|---|
| How big does the backlog get? | (arrival rate − service rate) × length of the spike | (15 − 5) × 2 s = 20 messages |
| How long does a new message wait? | backlog ÷ service rate | 20 ÷ 5 = 4 s |
| How long until the queue is empty again? | backlog ÷ (service rate − arrival rate after the spike) | 20 ÷ (5 − 3) = 10 s |

The last row is the one to watch. A backlog drains only at the *spare* capacity, so a worker that normally runs close to its limit takes a long time to recover: with 4.5 arrivals per second the same 20 messages would take 40 seconds, and with 5 or more they would never clear. A queue levels load only while the average arrival rate stays below the service rate. The chart in the diagram shows this as two areas of the same size: the block above the capacity line during the spike is the work that has to wait, and the thin band after it is the same work being done later.

**Depth and age.** Depth says how much work is waiting, and the age of the oldest message says how late it is. In the animation the oldest message is 1.3 seconds old when the spike ends and keeps getting older while the queue is already draining, until the last message of the spike is taken 4 seconds after it arrived. Only then does the age come down.

## When to use it

- Bursty or unpredictable load in front of a service, a database or a third-party API whose capacity is fixed, expensive or rate-limited.
- Work whose result isn't needed in the same request: placing an order, sending email, rendering a document, indexing, delivering webhooks, importing a file.
- When you want to size, and pay for, the backend at the average load instead of the peak.
- When the front end should keep accepting work while the backend is slow, being deployed or down.
- Not when the caller needs the answer in the same request, such as a login, a price lookup or a search. A queue there only adds delay. Protect those paths with caching, more capacity or [rate limiting](../rate-limiting/).
- Not when the load is steady and well under capacity. The queue then adds moving parts and buys nothing.

## Trade-offs

- **Latency in place of errors.** That is the whole deal, so find out how much waiting the business accepts. A queue-based system has two modes: with no backlog it is fast, and with a backlog every message waits behind the ones in front of it. Amazon's Builders' Library calls this *bimodal behaviour* and warns that, once a failure or a surge has tipped the system into the slow mode, it can take a long time to work its way back.
- **It moves load in time and does not remove it.** If arrivals stay above capacity, the backlog grows without end, and an unbounded queue hides that until its messages are hours old.
- **The caller's contract changes.** There is no result in the response, errors surface later, and someone has to build and keep the status resource.
- **Duplicates.** Most queue services deliver *at least once*. A worker takes a message under a lease, called the visibility timeout in Amazon SQS (30 seconds by default) and the lock in Azure Service Bus (1 minute by default). If the worker crashes, or is merely slower than the lease, the message is delivered again while the first attempt may still finish. SQS standard queues can also deliver an occasional duplicate on their own. Workers therefore have to be idempotent: see [Idempotent Consumer](../idempotent-consumer/).
- **Poison messages.** A message that can never be processed comes back after every failed attempt. It burns capacity and, in an ordered queue, blocks everything behind it. Move it to a dead-letter queue after a few attempts and alert on that queue.
- **Ordering.** One consumer on a first-in, first-out queue keeps the order. Several workers on the same queue (Competing Consumers) and any redelivery do not. Where order matters it usually matters per customer or per order, so keep it per key: message group IDs in SQS FIFO queues, sessions in Service Bus, a partition key in Kafka. Or design the handler so that it does not care.
- **More to run and to watch.** The queue is one more dependency, with its own quotas for message size and retention. Failures also get quieter: instead of errors on a dashboard there are messages that are late.

## Implementation notes

- **Watch two numbers for every queue: depth and age.** In SQS they are `ApproximateNumberOfMessagesVisible` and `ApproximateAgeOfOldestMessage`. Google Cloud Pub/Sub publishes the number of unacknowledged messages and the age of the oldest one for each subscription. Azure Service Bus has a metric for active messages but none for age, so let the worker report how long each message waited (the broker stamps every message with its enqueue time). Alert on age against your latency promise. Google's Pub/Sub monitoring guide reads the pair like this: a backlog and an age that grow together mean the consumers can't keep up, while a small, steady backlog with a growing age points to messages that are stuck.
- **Scale the workers on backlog, not on CPU.** A worker that waits on I/O can sit behind a huge backlog with an idle CPU. The raw queue length is a poor target too, because it does not change in proportion to the number of workers. Use the *backlog per worker*. The EC2 Auto Scaling guide derives the target from the latency you accept divided by the time one message takes (10 s ÷ 0.1 s = 100 messages per instance) and tracks the queue length divided by the number of running instances against it, these days as a metric-math expression. KEDA's queue scalers do the same for Kubernetes with a target number of messages per replica (`queueLength` for SQS, `messageCount` for Service Bus, 5 by default in both), and Azure Functions computes its instance count as the queue length divided by the target executions per instance. See [Autoscaling](../autoscaling/).
- **Put a ceiling on the scale-out.** More workers clear the backlog sooner, and they also bring back the load that the queue was hiding. Microsoft's description of this pattern warns that autoscaling the consumers without a bound on what they do in total only moves the overload downstream. Set a maximum that the database can take: a replica limit, a concurrency limit per worker or, for AWS Lambda reading from SQS, the maximum concurrency of the event source mapping (2 to 1,000).
- **Bound the queue.** Decide the largest backlog that is still worth working through (your latency budget × the service rate) and refuse work beyond it. RabbitMQ can enforce a `max-length`; by default it then drops (or dead-letters) the oldest messages, and with `overflow: reject-publish` it rejects the new ones and tells publishers that use confirms. Service Bus rejects sends once a queue reaches its size quota. SQS has no limit on depth, only a retention period (4 days by default, 14 at most), so there the producer has to check depth or age itself. When the queue is full, tell the caller the truth with `429` or `503` and a `Retry-After`. That is throttling, and it complements leveling: [Rate Limiting & Throttling](../rate-limiting/) keeps the *average* arrival rate within what the workers can clear, and the queue smooths the bursts below that line.
- **Let stale work expire.** A password-reset email that arrives two hours late is worse than none. Give messages a time to live (per message or per queue in RabbitMQ and Service Bus, the retention period in SQS) and decide whether expired ones are dropped or dead-lettered. For work where freshness matters, the Builders' Library describes two more tactics: serve new messages first while the old backlog is worked off on the side, and push back on the producers.
- **Fit the lease to the work.** Set the visibility timeout or lock a little above the slowest normal processing time and extend it from the worker during long jobs. SQS allows up to 12 hours in total; a Service Bus lock lasts at most 5 minutes and can be renewed. If the lease is too short, slow messages are processed twice. If it is too long, the messages of a crashed worker stay hidden for that long. Delete or complete a message only after its work is committed.
- **Dead-letter after a few attempts.** In SQS, set a redrive policy with a `maxReceiveCount`. Service Bus dead-letters a message after 10 deliveries by default. RabbitMQ quorum queues give up after 20 failed deliveries by default (since 4.0) and then drop the message unless a dead-letter exchange is configured. Raise an alarm for anything that lands in the dead-letter queue, and keep a way to replay it once the bug is fixed.
- **Don't confuse this with the request queue inside a server.** There the caller is still connected and waiting, so a long queue only fills up with requests that nobody is waiting for any more. Google's SRE book advises keeping such queues short relative to the thread pool and rejecting early. Load leveling works because the caller has been released.
- **Queue services are interchangeable here:** Amazon SQS, Azure Service Bus or Queue Storage, Google Cloud Pub/Sub or Cloud Tasks, RabbitMQ, or a Kafka topic read by one consumer group, where depth is the consumer lag. Choose on delivery guarantees, ordering, message size and the way you want to scale the consumers, and keep the choice behind a small interface.
- **Neighbours.** Competing Consumers adds workers to the same queue, Priority Queue lets urgent work overtake, Dead-Letter Queue parks the messages that keep failing, and Web-Queue-Worker is the application style built around this pattern. [Event-Driven Architecture](../event-driven-architecture/) relies on the same buffering but fans each event out to several subscribers, and [Retry with Backoff & Jitter](../retry-with-backoff/) is what a rejected producer should do when a bounded queue is full.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Competing Consumers](../competing-consumers/) — Several workers pull from one queue, so work is shared and throughput scales out.
- [Autoscaling](../autoscaling/) — Add and remove instances automatically as load rises and falls.
- [Rate Limiting & Throttling](../rate-limiting/) — Cap how fast each client may call (token bucket) and shed the excess with 429s.
- [Asynchronous Request-Reply](../asynchronous-request-reply/) — Accept now with 202, process in the background, and let the client poll a status URL.
- [Web-Queue-Worker](../web-queue-worker/) — A web front end hands slow work to background workers through a queue.
- [Dead-Letter Queue](../dead-letter-queue/) — Park messages that keep failing so they stop blocking the queue and can be inspected.
- [Priority Queue](../priority-queue/) — Urgent messages are processed ahead of routine ones.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.

## Related components and services

- [RabbitMQ](../rabbitmq/) — A message broker: exchanges route each message into queues, and a consumer holds it until it acknowledges or rejects it.
- [Amazon SQS](../amazon-sqs/) — A managed message queue: consumers poll, a visibility timeout hides messages in flight, and repeated failures go to a dead-letter queue.
- [AWS Lambda](../aws-lambda/) — Functions as a service: code runs per event in managed execution environments that scale out with concurrency.

## References

- [Azure Architecture Center — Queue-Based Load Leveling pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/queue-based-load-leveling)
- [AWS Builder Center — Avoiding insurmountable queue backlogs (first published in the Amazon Builders' Library)](https://builder.aws.com/content/3EuRcgkTP1MI0c7zM8W6HL3WIqA/avoiding-insurmountable-queue-backlogs)
- [Google SRE Book — Addressing Cascading Failures (queue management, load shedding)](https://sre.google/sre-book/addressing-cascading-failures/)
- [Enterprise Integration Patterns — Competing Consumers](https://www.enterpriseintegrationpatterns.com/patterns/messaging/CompetingConsumers.html)
- [RFC 9110 — HTTP Semantics: 202 Accepted](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.3)
- [Azure Architecture Center — Asynchronous Request-Reply pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/asynchronous-request-reply)
- [Amazon EC2 Auto Scaling — Scaling policy based on Amazon SQS](https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-using-sqs-queue.html)
- [KEDA — Scalers](https://keda.sh/docs/latest/scalers/)
- [Azure Functions — Target-based scaling](https://learn.microsoft.com/en-us/azure/azure-functions/functions-target-based-scaling)
- [AWS Lambda — Configuring scaling behavior for SQS event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html)
- [Amazon SQS — At-least-once delivery](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html)
- [Amazon SQS — Visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html)
- [Amazon SQS — Using dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)
- [Amazon SQS — Available CloudWatch metrics](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-available-cloudwatch-metrics.html)
- [Amazon SQS — Message quotas](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html)
- [Azure Service Bus — Message transfers, locks, and settlement](https://learn.microsoft.com/en-us/azure/service-bus-messaging/message-transfers-locks-settlement)
- [Azure Service Bus — Dead-letter queues](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-dead-letter-queues)
- [Azure Service Bus — Quotas and limits](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-quotas)
- [RabbitMQ — Queue Length Limit](https://www.rabbitmq.com/docs/maxlength)
- [RabbitMQ — Quorum Queues](https://www.rabbitmq.com/docs/quorum-queues)
- [Google Cloud — Monitor Pub/Sub in Cloud Monitoring](https://docs.cloud.google.com/pubsub/docs/monitoring)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
