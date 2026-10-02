<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗄️ Data Management](../../README.md#data-management)

# Change Data Capture (CDC)

> Stream every committed change from the database log to other systems.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Change Data Capture (CDC)" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/change-data-capture.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Every commit is logged** | The application changes a customer's email address with an ordinary `UPDATE`. Before the database acknowledges the commit, the change is in its **transaction log**, which it keeps anyway for crash recovery and replication. The application is not modified and writes to nothing else. |
| **2 · Read the log, emit events** | A **CDC connector** tails that log from its saved position and turns every committed row change into an event on the table's topic, in commit order: the operation (insert, update or delete), the row before and after, and the source table and log position. Polling the table by a timestamp column instead misses deletes and intermediate values, and loads the database with queries. |
| **3 · One write, many copies** | The search index, the cache and the data warehouse each consume the topic at their own pace and apply the change to their own copy. A new consumer starts from a **snapshot** of the existing rows and then continues from the stream. There is no dual write: everything downstream derives from what was committed. |
| **4 · Restarts and their price** | The connector saves its position only periodically. It crashes after publishing change 43 but before saving that position, so it resumes from 42 and sends 43 again: delivery is **at-least-once**, which is why consumers apply changes idempotently, upserting by key and ignoring positions they have already applied. While the connector is down the database must keep the unread log, so the log grows: monitor the lag. |
<!-- END GENERATED: header -->

## The problem

A row changes in the system of record, and copies of it live elsewhere: in a search index, a cache, a data warehouse, another service's read model. Every copy has to follow, and the two obvious ways of making that happen both fail.

- **Dual writes.** The application writes to its database and then to each of the other systems. No transaction spans them, so a crash or a timeout between two writes leaves the copies disagreeing, and two concurrent requests can reach the systems in different orders. Every new consumer is also another change to the application.
- **Polling.** Each consumer queries the tables for rows whose `updated_at` is newer than its last run. A query sees only the state at the moment it runs: a deleted row is simply absent, several updates between two polls collapse into the last one, and every table needs a timestamp column that all writers maintain. The queries add load, and the copies still trail by up to one polling interval.

Meanwhile the database is already writing down exactly what the consumers need. Every committed change goes into its transaction log, in order, before the commit is acknowledged. Change data capture (CDC) turns that log into a stream.

## How it works

1. **The log is the source.** The write-ahead log in PostgreSQL, the binary log in MySQL and the transaction log in SQL Server exist so that the database can recover from a crash, feed its replicas or be restored to a point in time. They hold what a table cannot show: every intermediate value and every delete, in commit order. The application keeps writing as before and does not know that anyone else is reading.
2. **A connector tails it.** The connector attaches to the database much as a replica would, reads the log from its saved position and turns each committed row change into an event. Work from transactions that rolled back never appears.
3. **Events go to a stream.** The usual layout is one topic per table, with the row's primary key as the message key.
4. **Consumers apply them.** Each consumer reads the topic at its own pace, keeps its own offset, and upserts or deletes in its own store. Adding a consumer changes nothing upstream.

The connector saves how far it has read, and after a restart it carries on from there. That saved position is what makes the pipeline restartable, and also what makes it at-least-once: in the diagram the connector has read entry 43 but has saved only position 42 when it crashes, so 43 is published a second time (see Trade-offs).

### Three ways to capture changes

| | Log-based | Trigger-based | Query-based |
|---|---|---|---|
| **Finds changes by** | Reading the transaction log | Triggers that copy each change into a side table, inside the writing transaction | Polling for rows with a newer timestamp or version |
| **Sees** | Every committed change in commit order, deletes included, and the old values if the database logs them | What the triggers record, deletes included | Only the current state: no deletes, no values in between |
| **Cost on the source** | Reading the log, and keeping it until it has been read | Extra writes in every transaction, and triggers to maintain on every table | A query per poll, plus a timestamp column and an index per table |
| **Delay** | Usually well under a second | Depends on how the side table is read | Up to one polling interval |
| **Needs** | Access to the log and a connector for that database | Trigger support and schema changes | Only SQL |

This pattern is the first column. Product names blur the lines: SQL Server's feature called *change data capture* reads the transaction log with a capture job, but stores the result in change tables that clients then query, and its lighter *change tracking* only records, synchronously, that a row changed.

### What an event carries

Debezium's envelope is a good reference; other tools carry the same information under other names:

- **`op`**: `c` for an insert, `u` for an update, `d` for a delete, and `r` for a row read during a snapshot.
- **`before`** and **`after`**: the row before and after the change. An insert has no `before`, a delete no `after`.
- **`source`**: the table, the position in the log (an LSN in PostgreSQL; a binary log file and offset, or a GTID, in MySQL), the transaction and the commit time.
- **The message key**: the row's primary key.

How much of the old row arrives depends on what the database logs. By default PostgreSQL logs only the old primary key, and for an update only if the key itself changed; `REPLICA IDENTITY FULL` logs the whole old row at the price of more WAL. Large values that PostgreSQL stores out of line (TOAST) are left out of an event when they did not change. MySQL logs complete before and after images by default (`binlog_row_image=FULL`), and Debezium requires that setting.

### Ordering

- **Per row: yes.** All changes to one row share a key, so they land in one partition, in commit order. This is the guarantee to build on.
- **Per table: only with a single partition.** With several, changes to different rows can be consumed in a different order from the one they committed in.
- **Across tables: no.** Each table is its own topic, so a transaction that touched three tables arrives as events on three topics, and a consumer can see the order line before the order. Debezium can emit `BEGIN` and `END` markers with event counts per table (`provide.transaction.metadata`) for consumers that must reassemble transactions; most consumers are written to tolerate the gap instead.

### Snapshots

The log only reaches back so far, so a stream that starts today lacks the rows that were written last year.

- **Initial snapshot.** On its first start a connector reads the existing rows at one consistent point in the log, emits them as `r` events, and then streams from exactly that position, so nothing falls between the two phases.
- **Incremental snapshot.** A table that is added later, or has to be read again, should not stop the stream for hours. An incremental snapshot reads the table in chunks while streaming continues, and uses watermarks written through the log to drop a chunk's rows that a newer change event has overtaken. Debezium starts one with a signal; the technique comes from Netflix's DBLog paper.
- **New consumers** start from a snapshot too. If the topic still holds every key (next section), reading it from the beginning is that snapshot; if it does not, an incremental snapshot emits the rows again.

### Deletes, tombstones and compaction

- A delete arrives as an event with `op: d` and the old row, or just its key, in `before`.
- On Kafka, a change topic with **log compaction** keeps at least the latest event for every key, so the topic itself is a snapshot that a new consumer can read from the start. To let compaction remove a deleted row altogether, the connector follows the delete event with a **tombstone**: the same key with an empty value.
- Kafka discards tombstones after `delete.retention.ms` (24 hours by default). A consumer that needs longer than that to read a compacted topic from the beginning can miss a delete and keep a row that no longer exists.
- Consumers handle both records: delete by key on the delete event, and ignore the tombstone.
- A soft delete (`deleted_at`) is an ordinary update as far as the log is concerned.

### Schema changes

- The events mirror the table: add a column and it shows up in the next event. Adding a nullable column, or one with a default, is safe for consumers; renaming, dropping or retyping a column is not.
- Register the event schemas (Debezium can serialise with Avro and a schema registry) and enforce a compatibility rule there, so an incompatible change is rejected when the connector registers it rather than discovered by each consumer.
- Engines differ in how the connector learns of a change. MySQL's binary log contains the DDL statements, and Debezium keeps them in a schema history topic so that it can interpret older log entries after a restart. PostgreSQL's logical decoding does not emit DDL: the connector sees the new shape with the next row change.
- Roll out breaking changes in the expand-and-contract order: add the new column, move the consumers, then drop the old one.

## When to use it

- **Derived stores.** A search index, a cache, a feature store: anything that holds a copy of data that a database owns.
- **Cache invalidation.** Deleting or refreshing entries from the change stream also covers writes that bypass the application, which [cache-aside](../cache-aside/) on its own never sees.
- **Analytics ingestion.** Feeding a warehouse or a lakehouse continuously instead of with nightly extracts. The raw change stream is a natural bronze layer in a medallion architecture.
- **Read models.** Keeping the query side of [CQRS](../cqrs/), or a materialised view, up to date.
- **Migrations.** Replicating data into a new database or a new service while traffic moves over, as in a [strangler fig](../strangler-fig/) migration.
- **Relaying an outbox.** Reading the outbox table from the log is the low-latency way to run a [transactional outbox](../transactional-outbox/).
- **Systems you cannot change.** A legacy or packaged application whose code is off limits still has a log.

It is a poor fit when:

- **Consumers need business intent.** A row change says that `status` went from 3 to 4, not that an order shipped, or why. See the coupling problem below.
- **A caller must read its own write from the copy.** The copies always trail the source.
- **The database gives no access to its log**, or the tables have no primary key to identify rows by.
- **A periodic query is enough**: small tables, no deletes, and minutes of delay are acceptable.

## Trade-offs

- **At-least-once delivery.** The connector saves its position periodically, not per event: Kafka Connect commits source offsets every `offset.flush.interval.ms`, one minute by default. After a crash it replays everything it published since the last save. The database can repeat itself too, because PostgreSQL persists a slot's position only at checkpoints. Kafka Connect's exactly-once support for source connectors (Kafka 3.3 and later) removes the first kind of duplicate for connectors that implement it, but not redelivery to a consumer, nor the consumer's own side effects. So consumers have to be idempotent, like any [event-driven](../event-driven-architecture/) consumer.
- **The coupling problem.** Table topics publish your internal schema. Every consumer then depends on column names, on how the data is split into tables, and on status codes that were never meant to leave the service, so a refactoring becomes a breaking change for other teams. Two ways out:
  - Publish business events on purpose. Write them to an outbox table in the same transaction, and capture only that table: the [transactional outbox](../transactional-outbox/).
  - Reshape the stream before exposing it. Keep the raw table topics private to the owning team, and let a stream processor or a connector transformation map them to a documented, versioned contract.
- **Eventual consistency.** Each copy trails the source by the connector's lag plus its own.
- **The source pays.** It keeps log that has not been read, spends CPU on decoding, writes more log (`wal_level=logical`, full row images), and an initial snapshot reads every row of every captured table.
- **Bulk changes become floods.** One `UPDATE` over a million rows is a million events, and the events of a long transaction appear only when it commits.
- **Every column leaves the database.** Personal data and secrets flow into topics unless columns are excluded or masked, and the topics need the access rules and retention limits that the tables have.
- **More to operate.** A connector, a stream, schemas, and a database account that may read everything it captures.

### CDC, outbox or event sourcing

All three end with a stream of changes that other systems consume. They differ in what the application writes and in what the stream means.

| | Change data capture | [Transactional outbox](../transactional-outbox/) | [Event sourcing](../event-sourcing/) |
|---|---|---|---|
| **The application writes** | Its tables, as before | Its tables plus an outbox row, in one transaction | Events, which are the state |
| **Consumers receive** | Row changes: what the data became | Business events the service chose to publish | The same events the service stores |
| **Contract** | The table schema, unless the stream is reshaped | An event schema designed for consumers | The event schema |
| **Code changes** | None | Every state change also writes its event | A different way of modelling state |

## Implementation notes

- **PostgreSQL.** CDC builds on logical decoding: set `wal_level=logical` and read through a **replication slot**, for example with the built-in `pgoutput` plug-in. The slot remembers what the connector has confirmed and holds on to all WAL after that point, connected or not, so a stopped connector fills the disk: this is the behaviour in step 4 of the diagram. `max_slot_wal_keep_size` caps what a slot may retain (unlimited by default); a slot that falls further behind is invalidated, and the connector then needs a new snapshot. PostgreSQL 18 added `idle_replication_slot_timeout`, which invalidates slots that stay inactive. On a server where other tables or databases are busy while the captured ones are quiet, the slot does not advance and WAL piles up anyway: Debezium's heartbeats (`heartbeat.interval.ms`, plus `heartbeat.action.query` when the captured database itself is idle) keep it moving.
- **MySQL.** Use row-based logging with full row images. There is no slot, so the risk is the opposite one: binary log files are purged after `binlog_expire_logs_seconds` (30 days by default) whether or not the connector has read them. A connector that was down for longer cannot resume, and has to take a new snapshot.
- **SQL Server.** Change data capture is enabled per database and per table. A capture job copies changes from the transaction log into change tables, which Debezium and other clients read, and a cleanup job removes entries after three days by default. The log cannot be truncated past changes that the capture job has not yet harvested.
- **Failover of the source.** The saved position has to mean something on the new primary. MySQL's GTIDs identify a transaction on every server, so a connector can find its place on a promoted replica. In PostgreSQL a slot used to exist on the primary only; version 16 allows logical decoding on a standby, and version 17 added failover slots, which keep a logical slot synchronised to a standby (`sync_replication_slots`) so that a connector can continue after a promotion.
- **Managed change streams.** DynamoDB Streams keeps item-level changes for 24 hours, in order per item and without duplicates. Azure Cosmos DB's change feed returns, in its default mode, only the latest version of each item and no deletes; its all-versions-and-deletes mode depends on continuous backup. MongoDB change streams are built on the oplog and resume from a token, as long as the oplog still reaches back that far.
- **Connectors and services.** Debezium is a set of Kafka Connect source connectors, and also runs without Kafka as Debezium Server, with sinks such as Amazon Kinesis, Google Cloud Pub/Sub and Azure Event Hubs. AWS Database Migration Service runs full-load-plus-CDC or CDC-only tasks, for migrations and ongoing replication between data stores. Google Cloud Datastream is a serverless service that replicates changes into BigQuery or Cloud Storage.
- **Idempotent consumers.** Upsert by primary key and delete by key, so that applying an event twice gives the same row. Also keep the source position of the last change applied, per key or as an external version in the target store, and skip any event at or below it: that catches duplicates as well as an old event that arrives after a newer one. The Idempotent Consumer pattern covers consumers whose effects cannot be made repeatable this way.
- **Watch the lag.** There are two legs. Source lag is how far the connector is behind the database: Debezium reports `MilliSecondsBehindSource`, and PostgreSQL's `pg_replication_slots` view shows `confirmed_flush_lsn`, `wal_status` and `inactive_since` for each slot. Consumer lag is how far each consumer group is behind the topic. Alert on a slot that is inactive or whose retained WAL keeps growing: it is the alert that saves the primary's disk.
- **Shape and filter at the connector.** `column.exclude.list` and the `column.mask.*` properties keep sensitive columns out of the stream. Debezium's new record state extraction transformation reduces the envelope to the `after` row for sinks that only want rows, and its Outbox Event Router turns outbox rows into events on per-aggregate topics.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Transactional Outbox](../transactional-outbox/) — Save the event in the same database transaction as the data, then relay it: no dual-write gap.
- [CQRS](../cqrs/) — Separate the write model (commands) from read models (queries), each optimised for its job.
- Materialized View *(planned)* — Precompute query-shaped views so reads don't pay for joins and aggregations.
- [Event Sourcing](../event-sourcing/) — Store every change as an immutable event and rebuild state by replaying them.
- [Cache-Aside](../cache-aside/) — Read from the cache first; on a miss load from the database and populate the cache.
- [Read Replicas](../read-replicas/) — Send writes to the primary and spread reads across asynchronously updated replicas.
- Medallion Architecture *(planned)* — Bronze, silver, gold: raw data is refined in layers inside a lakehouse.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.

## References

- [Debezium documentation — Architecture](https://debezium.io/documentation/reference/stable/architecture.html)
- [Debezium documentation — Connector for PostgreSQL (snapshots, change events, WAL disk space, failures)](https://debezium.io/documentation/reference/stable/connectors/postgresql.html)
- [Gunnar Morling — Five Advantages of Log-Based Change Data Capture (Debezium blog)](https://debezium.io/blog/2018/07/19/advantages-of-log-based-change-data-capture/)
- [Jiri Pechanec — Incremental Snapshots in Debezium (Debezium blog)](https://debezium.io/blog/2021/10/07/incremental-snapshots/)
- [PostgreSQL documentation — Logical Decoding Concepts (replication slots)](https://www.postgresql.org/docs/current/logicaldecoding-explanation.html)
- [MySQL 8.4 Reference Manual — The Binary Log](https://dev.mysql.com/doc/refman/8.4/en/binary-log.html)
- [Apache Kafka 4.3 documentation — Kafka Connect user guide](https://kafka.apache.org/43/kafka-connect/user-guide/)
- [Apache Kafka 4.3 documentation — Design: Log Compaction](https://kafka.apache.org/43/design/design/#log-compaction)
- [Shirshanka Das et al. — All Aboard the Databus! LinkedIn's Scalable Consistent Change Data Capture Platform (SoCC 2012)](https://dl.acm.org/doi/10.1145/2391229.2391247)
- [Martin Kleppmann — Turning the database inside-out with Apache Samza (Strange Loop 2014 talk)](https://martin.kleppmann.com/2015/03/04/turning-the-database-inside-out.html)
- [Martin Kleppmann & Chris Riccomini — Designing Data-Intensive Applications, 2nd Edition (O'Reilly, 2026)](https://martin.kleppmann.com/2026/03/24/designing-data-intensive-applications-2e.html)
- [Amazon DynamoDB Developer Guide — Change data capture for DynamoDB Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html)
- [Azure Cosmos DB — Work with the change feed](https://learn.microsoft.com/en-us/azure/cosmos-db/change-feed)
- [AWS Database Migration Service — Creating tasks for ongoing replication (CDC)](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Task.CDC.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
