<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [📨 Messaging & Integration](../../README.md#messaging--integration)

# Publish-Subscribe

> Broadcast each message to every interested subscriber through a topic.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Publish-Subscribe" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/publish-subscribe.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Publish once, fan out** | Orders publishes `OrderPlaced` to the topic `orders` and is done: it does not know who is listening and does not wait for anyone. The broker puts a copy into every **subscription**. Each subscription is a small queue of its own with its own position, the record of what its subscriber has acknowledged, and Billing, Shipping and Analytics each receive their copy and acknowledge it. The inset shows the contrast: on a plain queue a message is taken by exactly one receiver, so Billing would take it and Shipping would never see it. |
| **2 · Independent and durable** | Analytics goes offline. Its subscription is **durable**: the two messages published in the meantime wait there, Billing and Shipping carry on unaffected, and when Analytics returns it catches up from where it stopped. The live dashboard has a **non-durable** subscription, which exists only while the dashboard is connected. Nothing is kept for it, so the two messages published while it was away are simply missed. |
| **3 · Filter in the broker** | Shipping's subscription carries a filter on a message attribute: `region = 'EU'`. Three messages are published (EU, US, EU). The subscriptions of Billing and Analytics have no filter and receive all three; Shipping's receives only the two that match. The broker evaluates the filter, so the US message never enters Shipping's subscription and never reaches the subscriber. Depending on the broker, a filter can look at the topic name (with wildcards), at attributes as it does here, or at the content of the message. |
| **4 · Add a subscriber** | A new Fraud service creates its own subscription on the topic. The publisher's code, configuration and deployment do not change, and the other subscribers are not affected. The new subscription receives what is published from now on: the six earlier messages are not in it. On a log-based broker, or one with retention and replay, a new subscriber can start from an earlier position and read the history instead. |
<!-- END GENERATED: header -->

## The problem

An order is placed, and several parts of the business have to hear about it: Billing has to invoice it, Shipping has to send it, Analytics has to count it. The service where the order was placed has two obvious ways to tell them, and both tie it to its listeners.

- **Call each of them.** Orders then needs the address of every service that cares, waits for all of them, has to decide what to do when one is down, and must be changed and redeployed whenever another listener appears.
- **Put the news on a queue.** A queue is a *point-to-point* channel: each message is taken by exactly one receiver. If Billing and Shipping read from the same queue they compete, and every order reaches only one of them (the inset in step 1). One queue per receiver solves that, but now the sender has to know every queue and send each message several times, and it can fail halfway down the list.

What the sender wants is to say it **once**, to nobody in particular, and to leave it to the infrastructure to give every interested party a copy of its own.

## How it works

There are two roles, and two things on the broker between them.

- A **publisher** sends each message to a **topic**, a named channel on the broker. It addresses nobody. Once the broker has accepted the message, the publisher is done.
- A **subscription** is one subscriber's standing claim on a topic. For every message published to the topic, each subscription gets its own copy (or its own pointer to the one stored message) and keeps its own **position**: which messages its subscriber has been given and has acknowledged.
- A **subscriber** receives from its own subscription and from nowhere else. It processes a message and then acknowledges it; what it does not acknowledge is delivered to it again.

Because every subscription has a position of its own, subscribers do not affect each other. One can be slow, crash, be redeployed or be away for an hour while the others carry on (step 2), and one can be added or removed without anybody else noticing (step 4).

*Enterprise Integration Patterns* names the two kinds of channel. On a **Point-to-Point Channel** only one receiver consumes any given message. A **Publish-Subscribe Channel** has one input and one output per subscriber, and every output gets a copy. The survey by Eugster, Felber, Guerraoui and Kermarrec describes what the second kind buys as three sorts of decoupling: in **space** (the parties do not know each other), in **time** (they need not be running at the same moment) and in **synchronisation** (the publisher is not blocked while the subscribers work).

**Durable or not.** A *durable* subscription lives in the broker and does not depend on any connection. Messages published while its subscriber is away wait in it, and the subscriber carries on from its position when it returns. A *non-durable* subscription exists only for as long as its subscriber is connected, and nothing is kept for it in between. The first is for work that must not be lost. The second is for a live view in which a late message is worth nothing: a dashboard, a price ticker, a signal to drop a cache entry.

**Filters.** A subscription can say which messages it wants. The broker applies the filter before it delivers, so the subscriber never receives the rest and needs no capacity for it (step 3).

**Two ways to build it.** Brokers implement this model in two ways, and the difference decides what can be replayed.

- **A queue per subscription.** The broker puts a copy of each message (or a reference to it) into every subscription that wants it, and removes it from that subscription once it is acknowledged. A subscription holds only what arrived after it was created. Azure Service Bus, RabbitMQ exchanges with queues, and Amazon SNS feeding Amazon SQS queues work like this.
- **A shared log with one cursor per subscriber.** The topic is an append-only log that keeps messages for a retention period, whether or not anyone has read them, and a subscription is little more than an offset into it. Reading removes nothing, so a subscriber can be moved back, and a new one can begin at the oldest message still retained. Apache Kafka works like this, and so do RabbitMQ streams.

Google Cloud Pub/Sub sits between the two: it tracks acknowledgements per message for each subscription, like a queue, and it can retain messages on the topic and move a subscription back in time, like a log.

## When to use it

- Several independent consumers need the same message, and the list is likely to grow. [Event-driven architecture](../event-driven-architecture/) is built on this primitive.
- The sender should not know its receivers, wait for them or fail with them.
- The message states a fact (`OrderPlaced`) and each receiver decides for itself what follows from it, as in a [choreographed saga](../saga-choreography/).
- The same stream feeds consumers of different kinds: other services, a data warehouse, an audit trail, cache invalidation, live screens.
- Each consumer should absorb bursts at its own pace. Every durable subscription is a buffer in front of its subscriber: see [queue-based load leveling](../queue-based-load-leveling/).

Do **not** use it when:

- **The sender needs an answer.** A publisher learns that the broker accepted the message and never what a subscriber did with it. If the caller needs a result (a price, a validation, a yes or a no), call the service that has it. Replies bolted onto topics rebuild a call with more moving parts and no timeout.
- **Exactly one handler must act.** A command (*charge this card*, *send this email*) has to be carried out once, by one owner. Published to a topic it is carried out by every subscription, and by nobody when there is none. Send commands to a queue.
- **One global order is required.** A subscriber sees messages in order only within a partition, key, session or message group. Between keys, and between subscribers, there is no order. A single order across everything means one partition and one consumer, which gives up the scaling the pattern is used for.
- **There is one consumer and no second one in sight.** A queue does the same job with less to configure and to explain.

## Trade-offs

- **The publisher cannot know whether anyone handled the message.** A successful publish means that the broker has the message. It says nothing about the subscribers: not that they received it, not that they processed it, not even that there are any. On a broker that keeps a queue per subscription, a topic without subscriptions accepts messages and discards them. Someone has to watch each subscription instead (see *Watch every subscription* below).
- **Duplicates.** Almost every broker delivers at least once. A subscriber that crashes after doing the work and before acknowledging gets the message again.
- **Order is partial.** Order holds per key or partition at best, and a redelivery can put an old message behind a newer one.
- **The message becomes a public contract.** The publisher no longer depends on its subscribers' APIs, but all of them depend on its message, and it cannot see who reads which field. Coupling has moved from the call to the schema.
- **Consistency is eventual.** The subscribers act after the fact and at different moments. Billing may have invoiced an order that Shipping has not seen yet.
- **The flow is harder to follow.** No call stack shows who reacts to `OrderPlaced`: the answer is in the broker's configuration. Carry a correlation ID in every message and use [distributed tracing](../distributed-tracing/).
- **Cost grows with fan-out.** Every message is stored and delivered once per subscription, and a subscription that nobody reads any more keeps filling up until it expires or is deleted. Brokers also cap the fan-out: 10,000 subscriptions on a Pub/Sub topic, 2,000 on a Service Bus topic, 12.5 million on a standard SNS topic and 100 on a FIFO one.

## Implementation notes

- **One model, many names.** What this page calls a subscription is a consumer group in Kafka, a queue bound to an exchange in RabbitMQ, an SQS queue behind an SNS topic and a session in MQTT.

  | Product | You publish to | Each subscriber reads from | Filtering in the broker |
  |---|---|---|---|
  | Apache Kafka | a topic, which is a partitioned log | the topic's partitions, as its own **consumer group** with a committed offset per partition | none: a group receives every record of the topics it subscribes to |
  | Google Cloud Pub/Sub | a topic | its own **subscription** (pull, push or export) | a filter on message attributes, fixed when the subscription is created |
  | Amazon SNS with SQS | an SNS topic | its own **SQS queue**, subscribed to the topic | a filter policy per subscription, on message attributes or on a JSON body |
  | Azure Service Bus | a topic | its own **subscription**, which behaves like a queue | rules per subscription: SQL or correlation filters on message properties |
  | RabbitMQ | an exchange | its own **queue**, bound to the exchange | the exchange type and the binding: everything (fanout), a routing key (direct, topic) or headers |
  | MQTT | a topic name | the **session** the broker keeps for that client | topic filters with wildcards |
  | Redis pub/sub | a channel | its connection | channel patterns |

- **How products build it.** Examples, checked in October 2026:
  - **Apache Kafka (4.3).** Kafka delivers each record to one member of every consumer group that subscribes to the topic, so each subscriber is a consumer group of its own. The group's position is a committed offset per partition, which Kafka stores in an internal topic. Records are not removed when they are read: the log is kept for the topic's retention, 7 days unless configured otherwise. A group that has no committed offset starts where `auto.offset.reset` says, and the default is `latest`, which means new records only; `earliest` reads everything still retained. A group that stays empty for `offsets.retention.minutes` (7 days by default) loses its offsets and is treated as new the next time it connects.
  - **Google Cloud Pub/Sub.** A topic can have many subscriptions, and each subscription belongs to one topic. A subscription sees only what was published after it was created, is delivered at least once and is unordered unless ordering keys are used. Unacknowledged messages are kept for 7 days by default (10 minutes to 31 days), and a subscription with no subscriber activity for 31 days is deleted unless its expiration policy says otherwise. A topic can also retain messages itself, for up to 31 days, which lets a subscription seek back to a timestamp, including one before the subscription existed.
  - **Amazon SNS with Amazon SQS.** SNS pushes each message to the endpoints subscribed to a topic and keeps nothing for a consumer to fetch later. Subscribing one SQS queue per consumer turns that into a durable subscription that the consumer polls. This arrangement is usually called *fan-out*. The queue's policy has to allow the topic to send to it. Without raw message delivery the queue receives a JSON envelope around the published message. Standard topics deliver at least once with best-effort ordering; FIFO topics add ordering within a message group and deduplication.
  - **Azure Service Bus.** A subscription behaves like a virtual queue that receives a copy of every message sent to the topic, and receivers use it exactly as they would use a queue. Each subscription has named **rules**, a filter with an optional action, and a new subscription starts with a default rule that accepts everything. Filters see system and user properties and never the message body.
  - **RabbitMQ.** Publishers send to an **exchange**, and the exchange routes to the queues bound to it. A fanout exchange routes to all of them, a direct or topic exchange by routing key, a headers exchange by header values. Each subscriber declares its own queue. A durable queue with a fixed name is a durable subscription; an exclusive, server-named queue is deleted when its connection closes and is the non-durable kind. A message that matches no binding is dropped (or passed to an alternate exchange, if one is configured), or returned to the publisher if it was published as mandatory. A **stream** is the log-shaped alternative: reading does not remove messages, and a consumer attaches at the first message, the last, the next, an offset or a timestamp.
  - **MQTT 5.0.** A client subscribes with **topic filters** over `/`-separated topic names: `+` matches exactly one level, and `#`, which must come last, matches any number of levels. Whether the subscription is durable is decided by the session. With a Session Expiry Interval above zero the server keeps the client's subscriptions and its pending QoS 1 and QoS 2 messages for that long after the client disconnects; with an interval of zero, the session ends with the network connection. A **retained** message is the last one published to a topic with the retain flag, and the server sends it to each new subscriber, so a newcomer learns the current value and not the history.
  - **Redis pub/sub.** Channels with no storage at all: delivery is at most once, and a subscriber that is disconnected or fails simply loses the message. Subscribers can match channel names with glob-style patterns. It is the non-durable case in its purest form, and Redis points to Redis Streams when stronger guarantees are needed.
- **Durable is not for ever.** Most brokers limit how long an absent subscriber's messages wait: the retention of a Pub/Sub subscription (7 days by default), of an SQS queue (4 days by default, 14 at most) or of a Kafka log. After that, the messages are gone and nothing reports an error. Choose the retention from the longest outage the subscriber must survive, and alarm well before it is reached. Decide per subscriber, too, whether it should be durable at all. Jakarta Messaging makes the choice explicit: a non-durable subscription exists only while it has an active consumer, and a durable one keeps collecting messages until it is deleted with `unsubscribe`.
- **Delivery guarantees belong to the subscription.** At-least-once is the norm: acknowledge after the work is done, and expect the same message again after a crash, a timeout or a lost acknowledgement. Make every subscriber an [idempotent consumer](../idempotent-consumer/). Stronger guarantees exist and are narrow: Pub/Sub offers exactly-once delivery for pull subscriptions within one region, SNS FIFO topics drop a message whose deduplication ID repeats within five minutes, and Kafka transactions make a read-process-write step atomic as long as the output is in Kafka. In MQTT the guarantee is per subscription: a message arrives with the lower of the QoS it was published with and the QoS granted to the subscription.
- **Ordering is per key.** Kafka keeps order within a partition and sends records with the same key to the same partition. Pub/Sub orders messages that share an ordering key, if they are published in the same region and ordering is enabled on the subscription. SNS FIFO topics order within a message group and Service Bus within a session. Choose the key that has to stay in order (the order ID, the account) and assume nothing across keys. A redelivery also repeats: in Pub/Sub, redelivering one message redelivers the later messages with that key as well.
- **Filter by topic, by attribute or by content.**
  - *By topic hierarchy.* Publish to narrow topics and let subscribers choose by name. MQTT topic filters and RabbitMQ topic exchanges add wildcards (in a binding key `*` stands for exactly one word and `#` for zero or more), and Redis has channel patterns. Narrow topics need less filtering and give more topics to manage.
  - *By attributes.* The publisher sets metadata next to the payload (type, region, tenant) and the subscription filters on it. Pub/Sub filters see attributes only, Service Bus filters see properties only, and attributes are the default scope of an SNS filter policy.
  - *By content.* The broker looks inside the payload. An SNS filter policy can be scoped to the message body when the body is JSON.
  - A filter is part of the contract: the publisher has to set the attribute on every message, and a message that was filtered out is gone for that subscription. Mind the operational details. A Pub/Sub filter cannot be changed once the subscription exists; a change to an SNS filter policy can take up to 15 minutes to apply everywhere; SQL filters in Service Bus cost throughput, so correlation filters are preferred where they are enough. In Kafka a group gets every record, so the consumer filters, or a stream-processing job writes a narrower topic.
- **Push or pull.** With *pull* the subscriber asks for messages: Kafka consumers, SQS polling, a Pub/Sub pull subscription. The subscriber sets the pace, falls behind without being overrun, and only needs an outgoing connection. With *push* the broker initiates delivery: SNS, a Pub/Sub push subscription that POSTs to an HTTPS endpoint and takes a success status as the acknowledgement, RabbitMQ and MQTT over the subscriber's open connection. Push saves the polling loop, but the broker sets the pace, so the subscriber needs a limit on what is in flight, and an HTTP endpoint has to be reachable and has to authenticate its caller. RabbitMQ recommends registering a consumer over polling a queue.
- **Retention, replay and what a new subscriber sees.** By default a new subscription begins now, as in step 4. To give a new subscriber history, or to reprocess after a bug, the broker has to have kept the messages:
  - Kafka: start a new group with `auto.offset.reset=earliest`, or move a stopped group with `kafka-consumer-groups.sh --reset-offsets` to the earliest offset or to a point in time.
  - Pub/Sub: enable message retention on the topic and seek the subscription to a timestamp or to a snapshot.
  - SNS: a FIFO topic can archive messages for up to 365 days, and a subscription's replay policy sends them again from a starting point.
  - RabbitMQ streams: attach the consumer at `first`, at an offset or at a timestamp.
  - A replay delivers messages the subscriber may have handled already, which is one more reason for idempotence. Where the broker keeps nothing, a newcomer needs another source for the past: the publisher's API, an export, or a snapshot followed by the stream.
- **The message is a contract.** Give every message type a schema (Avro, Protocol Buffers, JSON Schema) and a rule for changing it. Add optional fields and never rename a field or reuse it for something else. A breaking change is a new type or a new topic, published next to the old one until the last subscriber has moved, the same sequence as [expand and contract](../expand-and-contract/). A schema registry enforces the rule where messages are published. Confluent Schema Registry rejects a new version that breaks the configured compatibility; its default, `BACKWARD`, means that consumers on the new schema can read data written with the previous one, so consumers are upgraded first. Pub/Sub can attach an Avro or Protocol Buffers schema to a topic and refuses messages that do not conform. An envelope such as CloudEvents standardises the metadata (`id`, `source`, `type`), which gives filters and idempotence checks something uniform to work with.
- **Failures stay inside one subscription.** A message that Billing cannot process is retried in Billing's subscription, and Shipping never notices. Configure retries and a [dead-letter queue](../dead-letter-queue/) per subscription: a dead-letter topic on a Pub/Sub subscription, the dead-letter subqueue that every Service Bus subscription has, a redrive policy on the SQS queue. SNS has a dead-letter queue of its own on each subscription, for messages it could not deliver to the endpoint. It retries an SQS queue or a Lambda function 100,015 times over 23 days, and an email, SMS or mobile push endpoint 50 times over 6 hours; an HTTP/S endpoint has a configurable policy that lasts an hour at most. When the retries are used up, the message is discarded unless that dead-letter queue is configured. Redrive a parked message to the subscription it failed in, not to the topic, or every other subscriber receives it a second time.
- **Scaling one subscriber is a different thing.** To process faster, run several instances of the subscriber on the *same* subscription: more members in a Kafka consumer group (at most one per partition does useful work), several receivers on one Service Bus subscription or one SQS queue, an MQTT shared subscription (`$share/<name>/<filter>`). That is the competing-consumers pattern, and its instances share one position. Two classic mistakes come from mixing the two up: two different services on one subscription each see only part of the messages, and two instances of one service with a subscription each do all the work twice.
- **Subscribers outside the organisation.** Do not hand a partner access to your broker. Deliver over HTTP with [webhooks](../webhooks/): a subscription of your own receives the messages and a sender signs them, posts them and retries. A push subscription is the same mechanism inside one cloud.
- **Publish reliably.** Saving the order and publishing `OrderPlaced` are two writes, and a crash between them leaves an order nobody hears about, or an event for an order that was rolled back. Use a [transactional outbox](../transactional-outbox/) or [change data capture](../change-data-capture/). The relay may publish a message twice, so give every message an ID that subscribers can deduplicate on.
- **Watch every subscription.** This is the price of not knowing the subscribers. For each subscription, track the **backlog** (messages not yet acknowledged) and the **age of the oldest unacknowledged message**, and have the alarm go to the team that owns the subscriber. In Pub/Sub the metrics are `subscription/num_unacked_messages_by_region` and `subscription/oldest_unacked_message_age_by_region`, in SQS `ApproximateNumberOfMessagesVisible` and `ApproximateAgeOfOldestMessage`, and in Kafka the lag per partition that `kafka-consumer-groups.sh --describe` prints. Age is the better alarm: a large backlog is normal on a busy subscription, and a small one that keeps getting older means a few messages are stuck. Compare the age with the retention, because a message older than that is lost. Look also for subscriptions that nobody consumes and for topics that nobody subscribes to. When the publisher really needs to know the outcome, the subscriber publishes an event of its own (`OrderInvoiced`), and the publisher subscribes to that.
- **Who may publish, and who may subscribe.** Grant the two separately and narrowly. Anyone who can publish can inject messages that every subscriber will act on. Anyone who can create a subscription gets a copy of everything, sensitive fields included. In SNS a topic policy grants `sns:Publish` and `sns:Subscribe`. In Pub/Sub the Publisher role goes on the topic and the Subscriber role on the subscription, and attaching a new subscription needs a permission on the topic. In Kafka, ACLs give producers write access to the topic and consumers read access to the topic and to their group. Service Bus separates Send and Listen rights. Keep secrets and unnecessary personal data out of messages: a topic's audience grows over time, and the publisher will not be asked.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.
- [Competing Consumers](../competing-consumers/) — Several workers pull from one queue, so work is shared and throughput scales out.
- [Dead-Letter Queue](../dead-letter-queue/) — Park messages that keep failing so they stop blocking the queue and can be inspected.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.
- [Webhooks](../webhooks/) — Notify subscribers by calling their HTTP endpoints, with signatures, retries and idempotency.
- [Transactional Outbox](../transactional-outbox/) — Save the event in the same database transaction as the data, then relay it: no dual-write gap.
- [Saga (Choreography)](../saga-choreography/) — Services react to each other's events to complete a workflow, with no central coordinator.
- [Queue-Based Load Leveling](../queue-based-load-leveling/) — A queue absorbs traffic spikes so the backend can work at a steady pace.

## Related components and services

- [Apache Kafka](../kafka/) — A partitioned, replicated commit log: producers append events, consumer groups read at their own pace and can replay history.
- [RabbitMQ](../rabbitmq/) — A message broker: exchanges route each message into queues, and a consumer holds it until it acknowledges or rejects it.
- [Amazon SNS](../amazon-sns/) — Managed publish-subscribe: a message published to a topic fans out to queues, functions, HTTP endpoints, email and SMS.
- [Amazon EventBridge](../amazon-eventbridge/) — An event bus: rules match events from AWS services, SaaS apps and your own code by content and route them to targets.
- [Amazon Kinesis Data Streams](../amazon-kinesis-data-streams/) — Managed streaming: records go to shards by partition key, and consumers read each shard in order and can replay it.

## References

- [Enterprise Integration Patterns — Publish-Subscribe Channel](https://www.enterpriseintegrationpatterns.com/patterns/messaging/PublishSubscribeChannel.html)
- [Enterprise Integration Patterns — Point-to-Point Channel](https://www.enterpriseintegrationpatterns.com/patterns/messaging/PointToPointChannel.html)
- [Enterprise Integration Patterns — Durable Subscriber](https://www.enterpriseintegrationpatterns.com/patterns/messaging/DurableSubscription.html)
- [Enterprise Integration Patterns — Message Filter](https://www.enterpriseintegrationpatterns.com/patterns/messaging/Filter.html)
- [Azure Architecture Center — Publisher-Subscriber pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/publisher-subscriber)
- [Eugster, Felber, Guerraoui, Kermarrec — The Many Faces of Publish/Subscribe (ACM Computing Surveys 35(2), 2003)](https://infoscience.epfl.ch/entities/publication/e290bdee-459f-404c-905e-21c765c9dc02)
- [Apache Kafka 4.3 — Introduction (topics, partitions, retention)](https://kafka.apache.org/43/getting-started/introduction/)
- [Apache Kafka 4.3 — KafkaConsumer (consumer groups and topic subscriptions)](https://kafka.apache.org/43/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html)
- [Apache Kafka 4.3 — Consumer and share consumer configs (auto.offset.reset)](https://kafka.apache.org/43/configuration/consumer-configs/)
- [Apache Kafka 4.3 — Broker configs (log.retention.hours, offsets.retention.minutes)](https://kafka.apache.org/43/configuration/broker-configs/)
- [Apache Kafka 4.3 — Basic Kafka operations (consumer group lag, resetting offsets)](https://kafka.apache.org/43/operations/basic-kafka-operations/)
- [Google Cloud Pub/Sub — Subscription overview](https://docs.cloud.google.com/pubsub/docs/subscription-overview)
- [Google Cloud Pub/Sub — Subscription properties (retention, expiration)](https://docs.cloud.google.com/pubsub/docs/subscription-properties)
- [Google Cloud Pub/Sub — Filter messages from a subscription](https://docs.cloud.google.com/pubsub/docs/subscription-message-filter)
- [Google Cloud Pub/Sub — Replay and purge messages with seek](https://docs.cloud.google.com/pubsub/docs/replay-overview)
- [Google Cloud Pub/Sub — Monitor Pub/Sub in Cloud Monitoring](https://docs.cloud.google.com/pubsub/docs/monitoring)
- [Google Cloud Pub/Sub — Quotas and limits](https://docs.cloud.google.com/pubsub/quotas)
- [Amazon SNS — Fanout to Amazon SQS queues](https://docs.aws.amazon.com/sns/latest/dg/sns-sqs-as-subscriber.html)
- [Amazon SNS — Message filtering](https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html)
- [Amazon SNS — Message delivery retries](https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html)
- [Amazon SNS — Message archiving and replay for FIFO topics](https://docs.aws.amazon.com/sns/latest/dg/fifo-message-archiving-replay.html)
- [AWS General Reference — Amazon SNS endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/sns.html)
- [Amazon SQS — Message quotas (retention)](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html)
- [Azure Service Bus — Queues, topics, and subscriptions](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-queues-topics-subscriptions)
- [Azure Service Bus — Topic filters and actions](https://learn.microsoft.com/en-us/azure/service-bus-messaging/topic-filters)
- [Azure Service Bus — Quotas and limits](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-quotas)
- [RabbitMQ — Exchanges](https://www.rabbitmq.com/docs/exchanges)
- [RabbitMQ tutorial — Publish/Subscribe](https://www.rabbitmq.com/tutorials/tutorial-three-python)
- [RabbitMQ — Streams and Superstreams](https://www.rabbitmq.com/docs/streams)
- [OASIS Standard — MQTT Version 5.0](https://docs.oasis-open.org/mqtt/mqtt/v5.0/os/mqtt-v5.0-os.html)
- [Redis Docs — Redis Pub/sub](https://redis.io/docs/latest/develop/pubsub/)
- [Jakarta Messaging 3.1 — Specification (durable and non-durable subscriptions)](https://jakarta.ee/specifications/messaging/3.1/jakarta-messaging-spec-3.1)
- [Confluent — Schema Evolution and Compatibility for Schema Registry](https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html)
- [CloudEvents — Specification, version 1.0.2](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
