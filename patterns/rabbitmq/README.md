<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧱 System Components](../../README.md#system-components)

# RabbitMQ

> A message broker: exchanges route each message into queues, and a consumer holds it until it acknowledges or rejects it.

<p align="center"><img src="diagram.svg" alt="Animated diagram: RabbitMQ" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/rabbitmq.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Acme Shop's **Orders** service publishes an event for every order and answers the customer as soon as RabbitMQ confirms it; it never waits for an email or a shipment. RabbitMQ keeps each message until a worker has processed it, so the email, fulfilment and audit workers take work at their own pace, and a burst of orders waits in the queues instead of slowing down the web tier. |
| **2 · Routing by binding** | Orders publishes to the **topic exchange** `orders` with a routing key such as `order.created.th` and never names a queue. The exchange compares the key with each **binding** word by word (`*` matches exactly one word, `#` zero or more) and puts a copy in every queue that matches: `order.created.th` lands in email, fulfilment-th and audit, while `order.cancelled.us` matches only `#` and lands in audit alone. |
| **3 · Push, ack, redeliver** | The broker **pushes** messages to consumers, at most 10 unacknowledged per email worker (`basic.qos` prefetch 10), and deletes a message only when its consumer acks it after the work is done. email-2 crashes holding 3 unacked messages, so RabbitMQ requeues them and email-1 receives them with `redelivered` set: delivery is at least once, so consumers must be idempotent. Each **quorum queue** keeps replicas on 3 nodes and Orders' publisher confirm arrives only after 2 of them have the message, so losing rabbit-3 loses nothing that was confirmed. |
| **4 · Poison message and limits** | Order 1042 makes the fulfilment worker fail every time: the worker rejects it with requeue, and the quorum queue counts each failed delivery in `x-delivery-count`. Once the count passes the **delivery limit** (20 by default since RabbitMQ 4.0), the queue dead-letters the message through `orders.dlx` into `orders.dead`, where a person can inspect it. The limits, in amber: an acked message is gone (a **stream** keeps a log you can replay), long queues use memory until the memory alarm blocks publishers, and several consumers plus redeliveries do not keep order. |
<!-- END GENERATED: header -->

## The problem

Every order in Acme Shop sets off follow-up work: a confirmation email, a booking with the Thai warehouse when the order ships in Thailand, and an audit record for everything. Done inside the checkout request, that work makes the customer wait for the slowest part of it, and a slow mail server or warehouse API turns into failed checkouts. Calling each worker directly is no better: the Orders service has to know all of them, and a burst of orders reaches all of them at the same moment.

A message broker sits in between. Orders hands each event to RabbitMQ and answers the customer; RabbitMQ stores the event, works out which workers need a copy, and gives each worker its work when the worker is ready for it.

## How it works

RabbitMQ implements the AMQP 0-9-1 model, and the diagram uses its vocabulary:

- **Publishers** send messages to an **exchange**, never straight to a queue. Each message carries a **routing key**, here words separated by dots such as `order.created.th`.
- The exchange's type decides how it routes. A **direct** exchange delivers to the queues whose binding key equals the routing key, a **topic** exchange matches patterns in which `*` stands for exactly one word and `#` for zero or more, a **fanout** exchange copies every message to every bound queue, and a **headers** exchange matches message headers instead of the key. There is also a nameless default exchange that delivers to the queue named by the routing key.
- A **binding** connects an exchange to a queue with a key or a pattern. A message that matches several bindings is copied into each of those queues. One that matches none is discarded, sent to an alternate exchange if one is configured, or returned to the publisher if it was published as `mandatory`.
- A **queue** keeps messages in order until consumers have processed them. RabbitMQ 4.x has three types: **classic** queues (one copy, on one node), **quorum** queues (replicated with Raft; the type to use when the data matters) and **streams** (an append-only log that consumers read without removing anything).
- **Consumers** subscribe, and the broker pushes messages to them, up to the number of unacknowledged messages that the consumer's **prefetch** (`basic.qos`) allows. The consumer acknowledges with `basic.ack` once the work is done, and the message is deleted; `basic.reject` and `basic.nack` give it back, to be requeued or, with requeue off, dead-lettered or dropped. If a channel or connection closes while it holds unacknowledged messages, RabbitMQ requeues them and redelivers them with the `redelivered` flag set, so delivery is at least once.
- **Publisher confirms** (`confirm.select`) cover the other direction: the broker acknowledges a message once every queue it was routed to has accepted it, which for a quorum queue means a majority of its replicas.

Quorum queues bring the behaviour of steps 3 and 4. Each one has a leader and followers on different nodes (three members by default, set with `x-quorum-initial-group-size`), so a queue on three nodes keeps working, and keeps every confirmed message, when one node is lost. A follower that comes back resumes replication where it stopped, without the catch-up that classic mirrored queues needed; mirroring was deprecated in 2021 and removed in RabbitMQ 4.0, leaving quorum queues and streams as the replicated types.

Quorum queues also count failed deliveries in the `x-delivery-count` header. Since RabbitMQ 4.0 the **delivery limit** defaults to 20: when the count goes past it, the queue drops the message, or dead-letters it if a **dead-letter exchange** (DLX) is configured. Messages are also dead-lettered when a consumer rejects them without requeueing, when their TTL runs out (a `message-ttl` policy or the per-message `expiration` property) and when a length limit pushes them out; the `x-death` header records why.

The rest of the model, briefly:

- **Priorities.** Classic queues support them when declared with `x-max-priority`, and the documentation recommends only a few levels. Quorum queues gained priorities in 4.0 and strict priorities with 32 levels (0 to 31) in 4.3. Streams have none.
- **Request-reply.** The client sets `reply_to` (where to send the answer) and `correlation_id` (to match the answer to its request); Direct Reply-To (`amq.rabbitmq.reply-to`) does without a reply queue.
- **Protocols.** AMQP 0-9-1, and AMQP 1.0, which has been a core protocol, always enabled, since 4.0. MQTT 3.1, 3.1.1 and 5.0 and STOMP 1.0 to 1.2 come as plugins that ship with the server, and streams also have their own binary protocol.
- **Clusters.** Nodes share their metadata (virtual hosts, users, exchanges, queues, bindings, policies) through a metadata store. Khepri, which is based on Raft, became the default for new clusters in 4.2 and the only store in 4.3, which removed Mnesia; a majority of the nodes must now be running for the cluster to be available.
- **Version and licence.** The 4.3 series is current (4.3.6, released in September 2026). The server and its core plugins are open source under the Mozilla Public License 2.0.

## Where it fits

- **Background work behind a web or API tier**, the Acme Shop case: the request publishes and returns, and workers send emails, render documents or call slow partners. This is [Web-Queue-Worker](../web-queue-worker/), with the queue absorbing bursts as in [Queue-Based Load Leveling](../queue-based-load-leveling/), and with email-1 and email-2 sharing one queue as [Competing Consumers](../competing-consumers/).
- **Routing events by content.** One topic exchange and a queue for each interested service, bound to the keys it needs: [Publish-Subscribe](../publish-subscribe/) with the filtering done by the broker, a common backbone for [Event-Driven Architecture](../event-driven-architecture/).
- **Request-reply between services**, with `reply_to` and `correlation_id`. For jobs that take longer than a client should wait, see [Asynchronous Request-Reply](../asynchronous-request-reply/).
- **Task queues for frameworks.** Celery uses RabbitMQ as its default broker and can declare quorum queues (`task_default_queue_type = "quorum"`).
- **Devices**, through the MQTT plugin, publishing into the same exchanges that services consume from.

It also implements or supports [Dead-Letter Queue](../dead-letter-queue/) (a DLX plus the delivery limit), [Priority Queue](../priority-queue/), [Idempotent Consumer](../idempotent-consumer/) (needed because delivery is at least once), [Retry with Backoff](../retry-with-backoff/) (the delayed retry of quorum queues in 4.3), [Claim Check](../claim-check/) for payloads above the maximum message size (16 MiB by default since 4.0) and [Transactional Outbox](../transactional-outbox/) for publishing reliably from a database transaction.

Its usual neighbours are the services that publish; the worker deployments that consume, often scaled on queue length (for example by KEDA's RabbitMQ scaler on Kubernetes); Prometheus and Grafana, through the `rabbitmq_prometheus` plugin that ships with the server; and a load balancer in front of the nodes.

Managed offerings: **Amazon MQ for RabbitMQ** supports RabbitMQ 4.3 and 4.2 (on mq.m7g instances) and 3.13 as of October 2026, either as a single-instance broker in one Availability Zone or as a cluster of three nodes across Availability Zones, behind a Network Load Balancer in both cases; it doesn't support streams. **CloudAMQP** is a hosted RabbitMQ service.

## When to use it

Choose RabbitMQ when each message is a task or a notification that is finished once it has been processed, and you want the broker to route it, track an acknowledgement for every message and set aside the ones that keep failing: background jobs, events routed to the services that need them, request-reply.

| | RabbitMQ 4.3 | [Apache Kafka](../kafka/) 4.3 | [Amazon SQS](../amazon-sqs/) |
|---|---|---|---|
| Model | Exchanges route messages into queues | A partitioned, replicated log of records | A managed queue |
| Consumers | Pushed up to the prefetch limit, ack each message | Pull records and track their position (offset) | Poll, then delete each message when done |
| After processing | Deleted on ack (a stream keeps it) | Kept until retention ends (7 days by default) and can be re-read | Deleted by the consumer |
| Routing | Direct, topic, fanout and headers exchanges | Topic and partition, chosen by the producer | None in the queue; fan out with SNS or EventBridge |
| Order | Per queue, until several consumers or redeliveries | Per partition | Best effort (standard), per message group (FIFO) |
| Poison messages | Quorum queues: delivery limit (20 by default), then a dead-letter exchange | Up to the application; share groups cap the attempts | `maxReceiveCount`, then a dead-letter queue |
| Running it | Your cluster, Amazon MQ or CloudAMQP | Your brokers, or a service such as Amazon MSK | Fully managed by AWS |

Choose something else when consumers must re-read history or start again from the beginning (Kafka, or RabbitMQ streams), when you run on AWS and want plain queues with no brokers to operate (SQS, with SNS or EventBridge to fan out), or when strict order has to hold across many parallel consumers (Kafka partitions, or one single active consumer per key).

## Trade-offs

- **At least once.** Crashes, lost connections, timeouts and requeues all lead to redelivery, so the same message can be processed twice, and consumers must be idempotent. The `redelivered` flag only says that the message may have been seen before; `x-delivery-count` says how many deliveries failed.
- **No replay.** An acknowledged message is deleted. Streams keep messages until their retention runs out and let a consumer start from any offset; classic and quorum queues do not.
- **Order holds per queue, not per workload.** Messages published on one channel are enqueued in that order, and a single consumer receives them in that order. Several consumers, redeliveries and priorities all change the order in which messages are processed. When the order per order ID matters, use single active consumer, or split the messages by key across several queues (the `x-modulus-hash` exchange), each with one active consumer.
- **Long queues cost memory.** A quorum queue keeps at least 32 bytes of metadata in memory for every message it holds, roughly 1 MB per 30,000 messages whatever their size. When a node's memory use reaches its high watermark (about 60% of RAM by default) or its free disk space falls below the limit (50 MB by default), RabbitMQ blocks the connections that publish until the alarm clears. Keeping queues short is the best way to keep memory use low.
- **Someone has to run it.** Cluster sizing, quorum queue membership, upgrades (only 4.2.x clusters can be upgraded in place to 4.3) and capacity are yours, unless a managed service takes them on.

## Implementation notes

- **Keep the topology in code or definitions, and the tunables in policies.** Applications declare their exchanges, queues and bindings, or the nodes import a definitions file at boot. Settings that operators may want to change, such as the dead-letter exchange and the delivery limit, belong in a policy rather than in hard-coded `x-` arguments. For Acme Shop:

  ```bash
  rabbitmqctl set_policy orders-qq '^(email|fulfilment-th|audit)$' \
    '{"dead-letter-exchange": "orders.dlx", "delivery-limit": 20}' \
    --apply-to quorum_queues
  ```

- **A consumer**, in Python with pika (the client that the RabbitMQ tutorials use):

  ```python
  import pika

  conn = pika.BlockingConnection(pika.ConnectionParameters("rabbitmq.internal"))
  ch = conn.channel()
  ch.exchange_declare("orders", exchange_type="topic", durable=True)
  ch.queue_declare("email", durable=True, arguments={"x-queue-type": "quorum"})
  ch.queue_bind("email", "orders", routing_key="order.created.*")
  ch.basic_qos(prefetch_count=10)  # at most 10 unacked deliveries to this consumer

  def on_message(ch, method, properties, body):
      try:
          send_email(body)  # may run twice for one order: make it idempotent
      except TemporaryFailure:
          ch.basic_reject(method.delivery_tag, requeue=True)  # counts toward delivery-limit
      else:
          ch.basic_ack(method.delivery_tag)

  ch.basic_consume("email", on_message)
  ch.start_consuming()
  ```

  A publisher calls `ch.confirm_delivery()` once; from then on `basic_publish` waits for the broker's confirm, and raises an exception if the broker nacks the message, or returns it because it was published with `mandatory=True` and matched no queue.
- **Reject, nack and the delivery limit.** Since 4.3 only real failures count toward the limit: `basic.reject`, a consumer that crashes and a lost connection. A `basic.nack` with requeue, or a consumer timeout, returns the message without raising `x-delivery-count`, so a consumer that nacks a poison message over and over never reaches the limit. 4.3 also adds **delayed retry** for quorum queues (`delayed-retry-type`, `delayed-retry-min`, `delayed-retry-max`), which keeps a returned message out of circulation for longer after each failure.
- **Dead-lettering is at most once by default** for quorum queues. Where every dead letter matters, set `dead-letter-strategy` to `at-least-once`, which also needs `overflow` set to `reject-publish`.
- **Prefetch.** Keep it low for slow jobs (1 for the fulfilment and audit workers here, whose jobs take seconds) and higher for quick ones. Quorum queues cap it at 2,000, and the documentation notes that a prefetch of 2,000 gives about the same consumer throughput as 300. Quorum queues do not support a global (per-channel) prefetch, so set it per consumer.
- **Consumer timeout.** A delivery left unacknowledged for 30 minutes (the default) is returned to the queue. From 4.3 the timeout applies to quorum queues only, and it can be set per queue or per consumer.
- **What to watch.** Per queue, `messages_ready` (waiting) and `messages_unacknowledged` (delivered, not yet acked), for example with `rabbitmqctl list_queues name messages_ready messages_unacknowledged` or the Prometheus metrics; the number of consumers; memory and disk alarms; and connection and channel churn. Connections and channels are meant to be long-lived: open them once and reuse them, rather than opening one per message.
- **Sizing quorum queues.** Three members tolerate the loss of one node and five tolerate two, while a fourth member adds no tolerance over three. All the quorum queues on a node share a write-ahead log that can hold 512 MiB by default (`raft.wal_max_size_bytes`), and the documentation suggests giving each node at least three to four times that much memory.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Competing Consumers](../competing-consumers/) — Several workers pull from one queue, so work is shared and throughput scales out.
- [Queue-Based Load Leveling](../queue-based-load-leveling/) — A queue absorbs traffic spikes so the backend can work at a steady pace.
- [Dead-Letter Queue](../dead-letter-queue/) — Park messages that keep failing so they stop blocking the queue and can be inspected.
- [Priority Queue](../priority-queue/) — Urgent messages are processed ahead of routine ones.
- [Publish-Subscribe](../publish-subscribe/) — Broadcast each message to every interested subscriber through a topic.
- [Asynchronous Request-Reply](../asynchronous-request-reply/) — Accept now with 202, process in the background, and let the client poll a status URL.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.
- [Apache Kafka](../kafka/) — A partitioned, replicated commit log: producers append events, consumer groups read at their own pace and can replay history.
- [Amazon SQS](../amazon-sqs/) — A managed message queue: consumers poll, a visibility timeout hides messages in flight, and repeated failures go to a dead-letter queue.

## References

- [RabbitMQ — AMQP 0-9-1 Model Explained](https://www.rabbitmq.com/tutorials/amqp-concepts)
- [RabbitMQ — Exchanges](https://www.rabbitmq.com/docs/exchanges)
- [RabbitMQ tutorial — Topics](https://www.rabbitmq.com/tutorials/tutorial-five-python)
- [RabbitMQ tutorial — Work Queues](https://www.rabbitmq.com/tutorials/tutorial-two-python)
- [RabbitMQ tutorial — Remote procedure call (RPC)](https://www.rabbitmq.com/tutorials/tutorial-six-python)
- [RabbitMQ — Quorum Queues](https://www.rabbitmq.com/docs/quorum-queues)
- [RabbitMQ — Classic Queues](https://www.rabbitmq.com/docs/classic-queues)
- [RabbitMQ — Streams and Superstreams](https://www.rabbitmq.com/docs/streams)
- [RabbitMQ — Queues (message ordering)](https://www.rabbitmq.com/docs/queues)
- [RabbitMQ — Consumer Acknowledgements and Publisher Confirms](https://www.rabbitmq.com/docs/confirms)
- [RabbitMQ — Consumer Prefetch](https://www.rabbitmq.com/docs/consumer-prefetch)
- [RabbitMQ — Consumers (delivery acknowledgement timeout)](https://www.rabbitmq.com/docs/consumers)
- [RabbitMQ — Publishers (unroutable messages)](https://www.rabbitmq.com/docs/publishers)
- [RabbitMQ — Dead Letter Exchanges](https://www.rabbitmq.com/docs/dlx)
- [RabbitMQ — Time-To-Live and Expiration](https://www.rabbitmq.com/docs/ttl)
- [RabbitMQ — Priority Support in Queues](https://www.rabbitmq.com/docs/priority)
- [RabbitMQ — Direct Reply-To](https://www.rabbitmq.com/docs/direct-reply-to)
- [RabbitMQ — Policies](https://www.rabbitmq.com/docs/policies)
- [RabbitMQ — Schema Definition Export and Import](https://www.rabbitmq.com/docs/definitions)
- [RabbitMQ — Memory and Disk Alarms](https://www.rabbitmq.com/docs/alarms)
- [RabbitMQ — Memory Threshold and Limit](https://www.rabbitmq.com/docs/memory)
- [RabbitMQ — Free Disk Space Alarms](https://www.rabbitmq.com/docs/disk-alarms)
- [RabbitMQ — Connections (high connection churn)](https://www.rabbitmq.com/docs/connections)
- [RabbitMQ — Monitoring with Prometheus and Grafana](https://www.rabbitmq.com/docs/prometheus)
- [RabbitMQ — rabbitmqctl(8)](https://www.rabbitmq.com/docs/man/rabbitmqctl.8)
- [RabbitMQ — Metadata store](https://www.rabbitmq.com/docs/metadata-store)
- [RabbitMQ — MQTT Plugin](https://www.rabbitmq.com/docs/mqtt)
- [RabbitMQ — STOMP Plugin](https://www.rabbitmq.com/docs/stomp)
- [RabbitMQ 4.0.1 release notes (mirroring removed, AMQP 1.0 core, delivery limit 20)](https://github.com/rabbitmq/rabbitmq-server/blob/main/release-notes/4.0.1.md)
- [RabbitMQ 4.2.0 release notes (Khepri default for new clusters)](https://github.com/rabbitmq/rabbitmq-server/blob/main/release-notes/4.2.0.md)
- [RabbitMQ 4.3.0 release notes (Khepri only, quorum queue priorities and delayed retry)](https://github.com/rabbitmq/rabbitmq-server/blob/main/release-notes/4.3.0.md)
- [RabbitMQ 4.3.6 release](https://github.com/rabbitmq/rabbitmq-server/releases/tag/v4.3.6)
- [rabbitmq-server LICENSE (MPL 2.0)](https://github.com/rabbitmq/rabbitmq-server/blob/main/LICENSE)
- [Amazon MQ — Managing Amazon MQ for RabbitMQ engine versions](https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/rabbitmq-version-management.html)
- [Amazon MQ — Deployment options for Amazon MQ for RabbitMQ brokers](https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/rabbitmq-broker-architecture.html)
- [Amazon MQ — Quorum queues for RabbitMQ on Amazon MQ](https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/quorum-queues.html)
- [CloudAMQP](https://www.cloudamqp.com/)
- [Celery — Using RabbitMQ](https://docs.celeryq.dev/en/stable/getting-started/backends-and-brokers/rabbitmq.html)
- [KEDA — RabbitMQ Queue scaler](https://keda.sh/docs/latest/scalers/rabbitmq-queue/)
- [Apache Kafka 4.3 — Introduction](https://kafka.apache.org/43/getting-started/introduction/)
- [Apache Kafka 4.3 — Design (push vs. pull)](https://kafka.apache.org/43/design/design/)
- [Apache Kafka 4.3 — Broker configs (log.retention.hours)](https://kafka.apache.org/43/configuration/broker-configs/)
- [Apache Kafka 4.3 — Group configs (share.delivery.count.limit)](https://kafka.apache.org/43/configuration/group-configs/)
- [Apache Kafka 4.2 — Upgrading (Queues for Kafka is production-ready)](https://kafka.apache.org/42/getting-started/upgrade/)
- [Amazon MSK](https://aws.amazon.com/msk/)
- [Amazon SQS — Queue types](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-queue-types.html)
- [Amazon SQS — Message quotas](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html)
- [Amazon SQS — Using dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
