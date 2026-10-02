<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [📨 Messaging & Integration](../../README.md#messaging--integration)

# Transactional Outbox

> Save the event in the same database transaction as the data, then relay it: no dual-write gap.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Transactional Outbox" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/transactional-outbox.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · The dual-write gap** | Order Service commits order 1042 to its database, then publishes *OrderPlaced* to the broker: two writes to two systems, and no transaction spans both. It crashes in between, so the order exists but no other service ever hears of it. The reverse order fails too: publish first, or from inside the still-open transaction, and a rollback leaves consumers acting on an order that doesn't exist. |
| **2 · One local transaction** | Instead of calling the broker, the service inserts the event as a row in an **outbox** table in the same database, inside the same local transaction as the order. Both rows become visible at commit, or neither does if the transaction rolls back, so the event is recorded if and only if the order is. No distributed transaction is needed. |
| **3 · Relay: at-least-once** | A separate **message relay** reads the unsent rows, by polling the table or by tailing the database log with change data capture (CDC) such as Debezium. It publishes each event and only then records it as sent; a CDC connector records its log position instead. If it crashes after publishing but before recording that, it publishes the same event again when it restarts. Delivery is **at-least-once**: nothing is lost, but an event can arrive twice. |
| **4 · Idempotent consumers** | Every event carries a unique ID (`a7f3`). Each consumer records the IDs it has processed, ideally in the same transaction as its own changes, and skips any event it has already seen, so the duplicate has no effect. The order ID is the message key, so one order's events share a partition and arrive in the order they were published. |
<!-- END GENERATED: header -->

## The problem

A service that changes its data usually has to tell other services about it: Order Service saves an order and announces *OrderPlaced*, so that Inventory, Payments and Notifications can react. That takes two writes to two different systems, the database and the message broker, and no local transaction covers both. A distributed transaction (two-phase commit, for example through XA) could, but the broker or the database often doesn't support it, and even where both do, it couples every write to the availability of both systems.

Without one, either order of the two writes leaves a gap:

- **Commit, then publish.** If the process crashes, is redeployed or can't reach the broker between the two calls, the change is saved but the event is never sent. Downstream services silently drift out of sync, and nothing retries, because the intent to publish only existed in memory.
- **Publish, then commit**, or publish from inside the still-open transaction. If the commit then fails or rolls back, consumers have already acted on an order that doesn't exist.

Retrying doesn't close the gap. An in-memory retry dies with the process, and saving the pending event durably somewhere else is just another dual write, unless it is saved in the same database, in the same transaction. That is the outbox.

## How it works

1. **Write the event to an outbox table, in the same transaction.** The local transaction that inserts or updates the business rows also inserts one row per event into an `outbox` table in the same database: a unique event ID, the aggregate (here the order) it belongs to, the event type and the payload. The database's atomicity does the rest: the event exists if and only if the business change committed. The request path never calls the broker.
2. **Relay the outbox to the broker.** A separate process, the **message relay**, picks up committed outbox rows, publishes them in order, and records its progress only after the broker has acknowledged them. A crash between the publish and that record makes it publish the same events again, so delivery is **at-least-once**.
3. **Deduplicate in the consumers.** Every event carries its unique ID, and consumers remember the IDs they have processed and skip repeats (the Idempotent Consumer pattern). Events of one aggregate share a message key, so a partitioned broker keeps them in order.

### Polling or log tailing

The relay can find new events in two ways:

| | Polling publisher | Transaction log tailing (CDC) |
|---|---|---|
| **Finds new events by** | Querying the outbox for unsent rows on a short interval | Reading the database's change log and picking out outbox inserts: the PostgreSQL write-ahead log through logical decoding, the MySQL binlog, DynamoDB Streams, the Azure Cosmos DB change feed |
| **Records progress by** | Marking rows as sent, or deleting them | Saving its position in the log |
| **Latency** | Up to one polling interval | Close to real time: the log is read as it is written |
| **Load on the database** | A query on every poll, plus the updates or deletes | Log reads, and log retained until the relay has read it |
| **Ordering** | By a sequence column; tricky with concurrent writers and several pollers | Commit order, as the log records it; rolled-back transactions never appear |
| **Needs** | Any SQL database | Log access and a database-specific connector such as Debezium |

Both are at-least-once: a poller repeats events if it crashes after publishing but before marking them sent, a log reader if it crashes before saving its position.

## When to use it

- A service must change its own data **and** reliably tell others about it: domain events, integration events for other teams, the commands and replies of a [saga](../saga-orchestration/), or changes that feed read models, search indexes and caches.
- The database and the broker can't take part in one transaction, or you don't want every write to depend on both being up. With a database per service and a separate broker, that is the usual case.
- You need *if and only if*: no event for a change that rolled back, and no committed change without its event.
- Not needed when losing an occasional event is acceptable (telemetry, best-effort notifications), or when the events already are the source of truth (event sourcing, below).

## Trade-offs

- **At-least-once, not exactly-once.** The relay can publish an event twice, and most brokers can redeliver anyway, so every consumer must be idempotent. Some pipelines remove duplicates on the way into the broker. Debezium can use Kafka Connect's exactly-once support for source connectors (KIP-618, Kafka 3.3 and later), Amazon SQS FIFO queues ignore a repeated deduplication ID within 5 minutes, and Azure Service Bus drops a repeated `MessageId` within its duplicate-detection window (10 minutes by default). None of them covers redelivery to a consumer or the consumer's own side effects.
- **Eventual consistency, with a delay.** Consumers see a change only after the relay has picked it up: up to one polling interval, or the log reader's lag. The producing service keeps read-your-own-writes, because its own database is updated synchronously.
- **More work for the database.** Every transaction writes an extra row per event, and the relay adds polling queries and updates, or log that must be retained until it is read. On a busy primary this is real load; measure it.
- **Another component to run.** The relay needs monitoring, alerting and failover. Several relay instances without coordination can publish rows twice or out of order.
- **Order only per key.** Partitioned brokers keep order within a partition, so key messages by aggregate ID. There is no global order across aggregates.
- **Easy to forget.** Every code path that changes state must also write its event. Raise domain events from the aggregate and let the persistence layer write them to the outbox in the same unit of work, rather than relying on each handler to remember.

### Alternatives

| Approach | The one write goes to | Other services get the event from | Main cost |
|---|---|---|---|
| **Transactional outbox** | The service's database: business rows plus an outbox row | A relay that publishes the outbox rows | An outbox table and a relay to run; at-least-once delivery |
| **CDC on the business tables** | The service's database, unchanged | A CDC connector that streams every row change | No code changes, but consumers get row-level changes instead of business events, and can break when the internal schema changes |
| **Event sourcing** | An event store, where the events are the state | Subscriptions on the store, or a relay as with an outbox | A different way of modelling and querying data, usually with projections and CQRS |
| **Listen to yourself** | The broker | The broker; the service also consumes its own event to update its database | The service's own reads lag behind its writes, and a failure while applying the event surfaces after the caller has moved on |
| **Distributed transaction (2PC/XA)** | Both, atomically | The broker | Both systems must support it; prepared participants block if the coordinator fails, and every write depends on both systems being up |

## Implementation notes

- **Outbox schema.** A unique event ID (a UUID), the aggregate type and ID, the event type, the payload and a creation time, plus a sent flag or `sent_at` column for a polling relay. Debezium's Outbox Event Router expects the columns `id`, `aggregatetype`, `aggregateid`, `type` and `payload` by default. It routes each event to a topic named `outbox.event.<aggregatetype>`, uses `aggregateid` as the Kafka message key, and passes `id` in a message header that consumers can deduplicate on.
- **Polling safely.** Read unsent rows in small batches, ordered by a sequence column, publish them, then mark them sent. Don't track progress as "the highest ID sent so far": IDs are assigned when rows are inserted, not when transactions commit, so a slow transaction can commit a lower ID after the poller has moved past it. Several pollers can share the work with `SELECT … FOR UPDATE SKIP LOCKED`, which PostgreSQL's documentation suggests for queue-like tables, but they may then publish one aggregate's events out of order. To keep per-key order, run one active relay with leader election, or split the outbox between relays by a hash of the key.
- **Log tailing.** Debezium runs as a Kafka Connect source connector, or as Debezium Server, which delivers to other systems such as Amazon Kinesis, Google Cloud Pub/Sub or Apache Pulsar without Kafka. For PostgreSQL it needs logical decoding (`wal_level=logical`) and a replication slot. The slot keeps WAL until the connector has confirmed it, so a stopped connector can fill the database server's disk: monitor slot lag, and consider `max_slot_wal_keep_size` (unlimited by default) as a cap.
- **Cleaning up.** A polling relay deletes rows once they are sent, or keeps them for a few days for replay and audit and deletes them in batches; partitioning the table by day makes old rows cheap to drop. With log tailing you can delete the outbox row in the same transaction that inserted it: the log still carries the insert, Debezium's router filters out the delete, and the table stays empty. The Azure Cosmos DB guidance stores events next to the business documents in the same logical partition and lets a TTL remove them.
- **Ordering.** Use the aggregate ID as the message key, so one aggregate's events stay in order: the partition key in Kafka, `MessageGroupId` in SQS FIFO queues, `SessionId` in Azure Service Bus, the ordering key in Google Cloud Pub/Sub. The relay must publish each key's events in the order they were committed, and consumers must process each key one message at a time.
- **Idempotent consumers.** Insert the event ID into a processed-messages table with a unique key, in the same transaction as the consumer's own changes. A duplicate fails the insert and is skipped. Kafka's idempotent producer doesn't help here: it removes duplicates caused by its own retries within one producer session, not a row that a restarted relay sends again.
- **Watch the lag.** The age of the oldest unsent row, or the connector's lag, is the health signal: it grows whenever the relay or the broker is down. Alert on it, and on events that fail to publish repeatedly.
- **Libraries and products.** Debezium with its Outbox Event Router (log tailing), Eventuate Tram (polling or log tailing), and for .NET the NServiceBus Outbox and MassTransit's transactional outbox, which both pair the outbox with consumer-side deduplication.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.
- [Change Data Capture (CDC)](../change-data-capture/) — Stream every committed change from the database log to other systems.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.
- [Saga (Orchestration)](../saga-orchestration/) — A coordinator runs local transactions in sequence and triggers compensations when one fails.
- [Publish-Subscribe](../publish-subscribe/) — Broadcast each message to every interested subscriber through a topic.
- [Dead-Letter Queue](../dead-letter-queue/) — Park messages that keep failing so they stop blocking the queue and can be inspected.

## References

- [Chris Richardson — Pattern: Transactional outbox (microservices.io)](https://microservices.io/patterns/data/transactional-outbox.html)
- [Debezium — Outbox Event Router](https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html)
- [Gunnar Morling — Reliable Microservices Data Exchange With the Outbox Pattern (Debezium blog)](https://debezium.io/blog/2019/02/19/reliable-microservices-data-exchange-with-the-outbox-pattern/)
- [AWS Prescriptive Guidance — Transactional outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)
- [Azure Architecture Center — Implement the Transactional Outbox pattern by using Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/architecture/databases/guide/transactional-out-box-cosmos)
- [Confluent — Understanding the Dual-Write Problem and Its Solutions](https://www.confluent.io/blog/dual-write-problem/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
