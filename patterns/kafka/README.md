<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧱 System Components](../../README.md#system-components)

# Apache Kafka

> A partitioned, replicated commit log: producers append events, consumer groups read at their own pace and can replay history.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Apache Kafka" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/kafka.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | The Orders service publishes every `OrderPlaced` event to the topic **orders** and moves on, without knowing who reads it. **billing**, **search-indexer** and **analytics-loader** are three consumer groups, and each reads every event at its own pace. Reading doesn't remove anything: the topic keeps records for 7 days (`retention.ms`), so a group can fall behind, catch up or start over. |
| **2 · Append and replicate** | The topic has 3 partitions, each with 3 replicas on brokers b1, b2 and b3. The producer hashes the key `C-14` and gets **P1**, so every event for that customer lands in the same partition, in order. P1's leader on **b2** appends the record at **offset 42**, the followers on b1 and b3 fetch it, and with `acks=all` (the default since Kafka 3.0) the producer is acknowledged once every in-sync replica has it. |
| **3 · Consumer groups** | Within a group each partition belongs to exactly one consumer: billing-1 reads P0 and P1, billing-2 reads P2. When billing-3 joins, a **rebalance** moves P1 to it; billing-4 gets nothing, because 3 partitions keep at most 3 consumers of a group busy. Each group commits its own offsets: billing has processed 42 and committed 43, while search-indexer is at 39, 4 records behind, which is fine. A group can also reset its offsets to replay. |
| **4 · Failover and the limits** | Broker **b2** fails. The controller makes **b1**, an in-sync replica, the leader of P1, and because b1 and b3 still meet `min.insync.replicas=2`, `acks=all` writes go on. The limits: order holds only **within a partition**, a **hot key** sends all its traffic to one partition, and records are deleted after the retention period (7 days here) or, with compaction, reduced to the latest value per key. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's Orders service produces a steady stream of facts (`OrderPlaced`, `OrderPaid`, `OrderShipped`) that several teams need. Billing has to charge each order once, search wants it indexed within seconds, analytics loads it into the warehouse in batches, and a fraud model trained next quarter will want to read the last week again. Calling each of them directly ties Orders to every consumer's speed and availability. A classic message queue removes that coupling, but it hands each message to one consumer and deletes it once acknowledged: every new reader needs its own queue and its own copy, and nobody can go back in time.

Kafka writes each event **once** to a durable, ordered log. Any number of readers consume it independently, each remembers how far it has read, and the events stay for as long as the topic is configured to keep them.

## How it works

### A log, not a queue

A Kafka **topic** is stored as a set of append-only logs. Each new record goes to the end of a log and gets the next **offset**, a sequence number that never changes. Records are not modified, and reading them doesn't remove them. What a reader has consumed is therefore a single number per partition, the offset of the next record it will read, which is why the Kafka design documentation calls acknowledgement cheap. Different readers keep different numbers over the same data, and a reader can move its number back to read history again. Records leave the log only through the topic's retention policy. Jay Kreps's 2013 essay *The Log* explains why this simple structure works so well as the meeting point between systems.

### Topics, partitions and keys

A topic is split into **partitions**, spread over the **brokers** (the servers of the cluster). Each partition is an independent ordered log with its own offsets, which is why P0, P1 and P2 count separately in the animation. A partition is the unit of storage and of parallelism: it is stored whole on each broker that holds a replica of it, and it is read by one consumer per group.

The producer chooses the partition for each record:

1. a partition set on the record wins;
2. otherwise a configured `partitioner.class` decides;
3. otherwise, when the record has a key, the built-in partitioner hashes the serialized key with murmur2 and takes the result modulo the number of partitions;
4. without a key, it keeps sending to one partition until at least `batch.size` bytes have gone there, then switches (the *sticky* partitioner).

Every record with the same key therefore lands in the same partition, and **order is guaranteed only within a partition**: a consumer reads a partition's records in the order they were written, while records in different partitions have no order relative to each other. Key by the entity whose events must stay in order, here the customer ID. The key in the animation is real: for the string key `C-14`, Kafka's partitioner returns partition 1 of 3.

The mapping depends on the partition count. Grow the topic from 3 to 4 partitions and `C-14` moves to P2, while its older events stay in P1; the Kafka documentation warns that adding partitions can break per-key ordering in exactly this way, and a topic's partition count can't be reduced at all. Choose it up front, with headroom:

```sh
bin/kafka-topics.sh --bootstrap-server localhost:9092 --create --topic orders \
  --partitions 3 --replication-factor 3 --config min.insync.replicas=2
```

### Replication: leader, followers and the ISR

Each partition has as many **replicas** as its replication factor, each on a different broker. One replica is the **leader** and takes every write; the others are **followers** that fetch from the leader much as a consumer does, so every copy holds the same records at the same offsets. Leaders are spread across the brokers: in the animation b1 leads P0, b2 leads P1 and b3 leads P2.

The replicas that are caught up with the leader, the leader included, form the **in-sync replicas (ISR)**. A follower that hasn't fetched, or hasn't reached the end of the leader's log, for `replica.lag.time.max.ms` (30 seconds by default) is removed from the set. A record is **committed** once every replica in the ISR has it, and only committed records are given to consumers.

The producer's `acks` setting decides when a write counts as done:

- `acks=0`: the producer doesn't wait for the broker at all;
- `acks=1`: the leader has written the record, which is lost if the leader fails before a follower copies it;
- `acks=all`: every in-sync replica has it, so it survives as long as one of them does.

On its own, `acks=all` still accepts a write when the ISR has shrunk to the leader. The topic setting **`min.insync.replicas`** (1 by default) adds a floor: with fewer in-sync replicas than that, `acks=all` writes fail with a `NotEnoughReplicas` error instead of landing on too few copies. With a replication factor of 3 and `min.insync.replicas=2`, one broker can be down and writes go on, as in step 4.

Since Kafka 3.0 the producer defaults to `acks=all` and `enable.idempotence=true` (KIP-679; a bug left idempotence off by default in 3.0.0 and 3.1.0, fixed in 3.0.1, 3.1.1 and 3.2.0). With idempotence the broker gives each producer an ID and discards duplicates by sequence number, so a retry after a lost acknowledgement doesn't write the record twice.

When a broker stops sending heartbeats, the cluster's **controller** declares it offline after `broker.session.timeout.ms` (9 seconds by default) and makes another member of the ISR the leader of every partition it led. A replica outside the ISR may be missing committed records, so it is not elected while `unclean.leader.election.enable` keeps its default, `false`. The exception, on clusters created with Kafka 4.1 or later, is an *eligible leader replica* (ELR, KIP-966): the high watermark can't advance while the ISR is smaller than `min.insync.replicas`, so the controller can tell which replicas outside the ISR still hold every committed record, and elects one of them when no ISR member is left. When b2 comes back it catches up as a follower, and with `auto.leader.rebalance.enable=true` (the default) the controller's periodic check, every 300 seconds by default, hands P1 back to its preferred leader.

### Consumer groups, offsets and rebalancing

Consumers that share a `group.id` form a **consumer group**. The group divides the partitions among its members so that each partition is read by **exactly one** member at a time. A member can own several partitions, and a member with none sits idle, so the partition count caps the parallelism of a group: three partitions keep at most three billing consumers busy. Groups are independent of each other and each one sees every record, so Kafka behaves like [publish-subscribe](../publish-subscribe/) across groups and like [competing consumers](../competing-consumers/) within one.

Each group keeps its **committed offsets** in Kafka itself, in the internal topic `__consumer_offsets`. By default the consumer commits automatically every 5 seconds (`enable.auto.commit=true`, `auto.commit.interval.ms=5000`). A group with no committed offset starts where `auto.offset.reset` says, `latest` by default, so a new group sees only new records unless you set `earliest`. The distance between a partition's log-end offset and a group's committed offset is the **consumer lag**, the main health signal of a Kafka consumer.

When members join, leave or fail, or partitions are added, the group **rebalances** and reassigns partitions. There are two protocols:

- **Classic.** The members agree on an assignment computed by a client-side assignor; the default `partition.assignment.strategy` is `[RangeAssignor, CooperativeStickyAssignor]`.
- **Consumer** (KIP-848). Generally available since Kafka 4.0 and enabled on the brokers by default. The group coordinator on the broker computes the assignment (with the `uniform` assignor by default, or `range`) and moves partitions incrementally, without a group-wide synchronization barrier, so the members whose partitions don't move keep consuming. Consumers opt in with `group.protocol=consumer`. As of Kafka 4.3 the default is still `classic`; the documentation expects `KafkaConsumer` to switch its default in Kafka 5.0.

`kafka-consumer-groups.sh` shows where a group is and can move it:

```sh
# Where is search-indexer? (output trimmed to the offset columns)
bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group search-indexer
# TOPIC   PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
# orders  0          61              64              3
# orders  1          39              43              4
# orders  2          28              31              3

# Replay from a point in time. Stop the group's consumers first; without --execute this is a dry run.
bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --reset-offsets \
  --group search-indexer --topic orders --to-datetime 2026-10-05T00:00:00.000 --execute
```

### Delivery semantics

By default Kafka delivers **at least once**. The idempotent producer keeps retries from writing duplicates, but a consumer that crashes after processing a record and before committing its offset gets that record again after the rebalance; committing before processing gives at-most-once instead. For **exactly-once** within Kafka, a transactional producer (`transactional.id`) writes its output records and the offsets of the input it consumed in one atomic transaction, and downstream consumers set `isolation.level=read_committed` (the default is `read_uncommitted`) to skip records from aborted transactions. Kafka Streams packages this as `processing.guarantee=exactly_once_v2`. The guarantee ends at Kafka's edge: charging a card or sending an email can still happen twice, so make those consumers [idempotent](../idempotent-consumer/).

### Retention, compaction and tiered storage

With the default `cleanup.policy=delete`, a topic drops whole old log segments once they are older than `retention.ms` (7 days by default, from the broker's `log.retention.hours=168`) or the partition grows past `retention.bytes` (no limit by default). Retention is a deadline for every consumer: a group that stays away longer loses records, and when its committed offset no longer exists, `auto.offset.reset` decides where it resumes. With the default `latest`, it jumps to the end and the missed records are skipped.

With `cleanup.policy=compact`, Kafka instead keeps at least the latest record for each key, which suits topics that hold current state, such as a customer's address. A record with a key and a null value is a **tombstone** that deletes the key, and tombstones themselves go after `delete.retention.ms` (1 day by default). Compaction removes older records but never reorders the rest. The two policies combine as `delete,compact`.

**Tiered storage** (KIP-405), production-ready since Kafka 3.9, keeps recent segments on the brokers and moves older ones to remote storage such as an object store, so long retention doesn't need large broker disks. It doesn't support compacted topics.

### KRaft: no more ZooKeeper

Cluster metadata (topics, partitions, leaders, ISRs, configurations) used to live in Apache ZooKeeper. KIP-500 replaced it with **KRaft**: a quorum of **controllers**, typically 3 or 5, that replicate the metadata among themselves with a Raft-based protocol. One controller is active and the others are hot standbys, so 3 controllers tolerate one failure and 5 tolerate two. Kafka 4.0 (March 2025) is the first release that runs only in KRaft mode; a ZooKeeper-based cluster must migrate to KRaft on a bridge release first, the last one being Kafka 3.9.

### Connect, Streams and share groups

- **Kafka Connect** runs source and sink **connectors** that move data between Kafka and other systems (databases, object storage, search engines) without custom code. Debezium's change data capture connectors are usually deployed on it.
- **Kafka Streams** is a client library for Java and Scala applications that process streams (filters, joins, windowed aggregations) whose input and output are Kafka topics.
- **Share groups** (KIP-932, "Queues for Kafka") add queue-style consumption: early access in 4.0, preview in 4.1, production-ready in 4.2. Consumers in a share group take records cooperatively, so several of them can work on the same partition and a group can have more consumers than partitions. Each record is acknowledged on its own; a consumer holds it under an acquisition lock (`share.record.lock.duration.ms`, 30 seconds by default), and delivery attempts are counted up to `share.delivery.count.limit` (5 by default). The price is order: records arrive in offset order only within one batch from one partition.

## Where it fits

- **Solutions.** The event backbone of an [event-driven](../event-driven-architecture/) system; pipelines that feed search indexes, caches, data lakes and warehouses; [change data capture](../change-data-capture/) with Debezium on Kafka Connect, which can also be the relay behind a [transactional outbox](../transactional-outbox/); collecting logs, metrics and clickstreams in a [telemetry pipeline](../telemetry-pipeline/); input and output for stream processors such as Kafka Streams and Apache Flink.
- **Patterns it implements or supports.** [Publish-subscribe](../publish-subscribe/) across consumer groups and [competing consumers](../competing-consumers/) within one; [CQRS](../cqrs/) read models and [materialized views](../materialized-view/) built by consumers; [idempotent consumers](../idempotent-consumer/) to absorb redelivery. [Event sourcing](../event-sourcing/) with care: Kafka can carry the events, but it has no per-entity stream to read back, no append that checks an entity's current version, and retention or compaction must never drop events you still need, so many teams keep the event store elsewhere and publish from it to Kafka.
- **Usual neighbours.** Services and CDC connectors that produce; a schema registry beside the cluster; stream processors, sink connectors and services that consume; monitoring of lag and replication around it.
- **Managed offerings.** **Amazon MSK** runs Apache Kafka on AWS: MSK Provisioned with Standard or Express brokers, MSK Serverless, MSK Connect for connectors and MSK Replicator for copying data between clusters. As of October 2026, MSK supports Kafka versions up to 4.2, with 4.2 on Express brokers only, and lists 3.9 as the recommended version. Express brokers manage storage for you, run only across three Availability Zones and don't support share groups yet. Confluent Cloud is another managed Kafka service, and Redpanda is a separate, Kafka API-compatible broker.
- **Licences.** Apache Kafka is an Apache Software Foundation project under the Apache License 2.0. Redpanda's core is source-available under the Business Source License 1.1, which turns each version into Apache 2.0 four years after release, and its enterprise features are under the Redpanda Community License.

## When to use it

Choose Kafka when several independent consumers need the same events at their own pace, when events must be kept and **replayed** (to rebuild a read model, backfill a new service or reprocess after a bug), when per-key order matters but one consumer is not enough, and when you are building streaming pipelines or CDC and want the Connect and Streams ecosystem around them. For a plain work queue with per-message acknowledgements, retries and dead-lettering, a queue broker such as [RabbitMQ](../rabbitmq/) or Amazon SQS is simpler; for request/response, call the service.

| | Apache Kafka | [RabbitMQ](../rabbitmq/) | [Amazon SQS](../amazon-sqs/) | Amazon Kinesis Data Streams |
|---|---|---|---|---|
| Model | Partitioned, replicated log | Broker: exchanges route messages into queues; streams add a log | Managed queue | Managed partitioned log (shards) |
| After a read | The record stays; each group moves its own offset | Queue: removed once acknowledged. Stream: stays | The consumer deletes it after processing | The record stays; each consumer tracks its own position |
| Order | Per partition, chosen by key | FIFO per queue; priorities and requeues can change what consumers see | Standard: best effort. FIFO: per message group | Per shard, chosen by partition key |
| Keeps data | Until retention (7 days by default) or compaction; tiered storage for long retention | Queues: until consumed. Streams: by size or age | 4 days by default, 1 minute to 14 days | 24 hours by default, up to 365 days |
| Readers | Consumer groups, one consumer per partition each; share groups (4.2+) | Competing consumers per queue; fan-out through exchanges | Competing consumers; fan-out needs SNS in front or a queue per reader | 2 MB/s per shard shared by all readers, or enhanced fan-out with 2 MB/s per shard for each |
| Who runs it | You, Amazon MSK, Confluent Cloud | You, Amazon MQ | AWS | AWS |

Figures from the Kafka 4.3, RabbitMQ, Amazon SQS and Kinesis Data Streams documentation, October 2026.

## Trade-offs

- **More to run.** A production cluster means brokers, a controller quorum, partition placement, rolling upgrades and capacity planning. A managed service takes over the machines and the patching, not the design decisions: keys, partition counts, retention and schemas stay yours.
- **Order is per partition, and the key decides the load.** All of one key's records go to one partition and to one consumer per group. A hot key, such as one very large customer, overloads its partition however many partitions you add, and spreading it means giving up its order.
- **The partition count is hard to change.** Adding partitions moves keys, and partitions can't be removed.
- **Consumers see duplicates.** At-least-once delivery means a crash or rebalance replays the records since the last commit.
- **Coarse acknowledgement.** A consumer group keeps one offset per partition, not a status per message, so a record that keeps failing holds up its partition until the application skips it or parks it in a [dead-letter](../dead-letter-queue/) topic. There are no message priorities, no delayed delivery and no filtering on the broker. Share groups (4.2+) add per-record acknowledgement and delivery counts, but give up order.
- **Retention is a deadline.** A consumer that is down longer than the retention period loses records.
- **Latency for throughput and safety.** The producer batches records (`linger.ms`, 5 ms by default in Kafka 4.3, and `batch.size`, 16 KB), and `acks=all` waits for the in-sync replicas; both add a little latency in exchange for throughput and durability.

## Implementation notes

- **Size partitions for the parallelism you need.** A group can't keep more consumers busy than there are partitions, and each partition is stored whole on every broker that replicates it. Plan for peak consumer count and growth up front.
- **Start from the durable baseline:** replication factor 3, `min.insync.replicas=2`, producer `acks=all` with idempotence (both defaults) and `unclean.leader.election.enable=false` (the default).
- **Spread replicas across failure domains.** Set `broker.rack`, for example to the Availability Zone, so that each partition's replicas land in different racks. Consumers can then read from a replica in their own zone instead of the leader: set `client.rack` on the consumer and `replica.selector.class=org.apache.kafka.common.replica.RackAwareReplicaSelector` on the brokers (by default consumers read from the leader).
- **Watch lag and replication.** Consumer lag per group and partition (`kafka-consumer-groups.sh --describe`, or the consumer metric `records-lag-max`), and on the brokers `UnderReplicatedPartitions`, `UnderMinIsrPartitionCount` and `OfflinePartitionsCount`.
- **Treat schemas as a contract.** Kafka stores bytes. Agree on a format (Avro, Protobuf or JSON Schema), register the schemas in a registry such as Confluent Schema Registry or AWS Glue Schema Registry, and allow only compatible changes.
- **Secure every listener.** Encrypt with TLS; authenticate clients with mutual TLS or SASL (SCRAM-SHA-256 or -512, OAUTHBEARER, GSSAPI for Kerberos, or PLAIN, which the documentation says to use only over TLS); authorize with ACLs on topics and groups. Amazon MSK also offers IAM access control.
- **Write consumers for redelivery.** Commit offsets after processing, make processing idempotent, and call `poll()` again within `max.poll.interval.ms` (5 minutes by default), or the consumer is considered failed and its partitions are reassigned.
- **Avoid dual writes.** Writing to your database and then to Kafka can lose or duplicate events if one of the two fails; use a [transactional outbox](../transactional-outbox/) or [change data capture](../change-data-capture/) instead.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Publish-Subscribe](../publish-subscribe/) — Broadcast each message to every interested subscriber through a topic.
- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.
- [Change Data Capture (CDC)](../change-data-capture/) — Stream every committed change from the database log to other systems.
- [Event Sourcing](../event-sourcing/) — Store every change as an immutable event and rebuild state by replaying them.
- [Transactional Outbox](../transactional-outbox/) — Save the event in the same database transaction as the data, then relay it: no dual-write gap.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.
- [Competing Consumers](../competing-consumers/) — Several workers pull from one queue, so work is shared and throughput scales out.
- [RabbitMQ](../rabbitmq/) — A message broker: exchanges route each message into queues, and a consumer holds it until it acknowledges or rejects it.
- Amazon Kinesis Data Streams *(planned)* — Managed streaming: records go to shards by partition key, and consumers read each shard in order and can replay it.
- Apache Flink *(planned)* — A stream processor: stateful operators over unbounded streams, with event time, windows and exactly-once checkpoints.

## References

- [Apache Kafka 4.3 documentation — Design](https://kafka.apache.org/43/design/design/)
- [Apache Kafka 4.3 documentation — Producer Configs](https://kafka.apache.org/43/configuration/producer-configs/)
- [Apache Kafka 4.3 documentation — Consumer Rebalance Protocol](https://kafka.apache.org/43/operations/consumer-rebalance-protocol/)
- [Apache Kafka 4.3 documentation — Eligible Leader Replicas](https://kafka.apache.org/43/operations/eligible-leader-replicas/)
- [Apache Kafka 4.3 documentation — Basic Kafka Operations](https://kafka.apache.org/43/operations/basic-kafka-operations/)
- [Apache Kafka 4.0.0 Release Announcement (March 2025)](https://kafka.apache.org/blog/2025/03/18/apache-kafka-4.0.0-release-announcement/)
- [Apache Kafka 4.2.0 Release Announcement (February 2026)](https://kafka.apache.org/blog/2026/02/17/apache-kafka-4.2.0-release-announcement/)
- [KIP-500: Replace ZooKeeper with a Self-Managed Metadata Quorum](https://cwiki.apache.org/confluence/display/KAFKA/KIP-500%3A+Replace+ZooKeeper+with+a+Self-Managed+Metadata+Quorum)
- [KIP-848: The Next Generation of the Consumer Rebalance Protocol](https://cwiki.apache.org/confluence/display/KAFKA/KIP-848%3A+The+Next+Generation+of+the+Consumer+Rebalance+Protocol)
- [KIP-932: Queues for Kafka](https://cwiki.apache.org/confluence/display/KAFKA/KIP-932%3A+Queues+for+Kafka)
- [Jay Kreps — The Log: What every software engineer should know about real-time data's unifying abstraction (LinkedIn Engineering, 2013)](https://www.linkedin.com/blog/engineering/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying)
- [Amazon MSK — Welcome to the Amazon MSK Developer Guide](https://docs.aws.amazon.com/msk/latest/developerguide/what-is-msk.html)
- [Amazon MSK Developer Guide — Supported Apache Kafka versions](https://docs.aws.amazon.com/msk/latest/developerguide/supported-kafka-versions.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
