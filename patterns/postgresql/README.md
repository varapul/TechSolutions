<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧱 System Components](../../README.md#system-components)

# PostgreSQL

> A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.

<p align="center"><img src="diagram.svg" alt="Animated diagram: PostgreSQL" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/postgresql.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Acme Shop's orders database is the **system of record**. Orders and Catalog reach it through **PgBouncer** in transaction mode, because every PostgreSQL connection is a server process of its own. Its write-ahead log (WAL) then feeds three neighbours: a hot **standby** that serves reports; **Debezium**, which reads a logical replication slot and publishes each committed change to Kafka; and a **WAL archive** in object storage that makes point-in-time recovery possible. |
| **2 · MVCC: row versions** | T1 runs `UPDATE stock SET qty = qty - 1 WHERE sku = 'MUG-1'`. PostgreSQL does not overwrite the row: it adds a new **row version** (qty 6, `xmin` 742) and stamps the old one with `xmax` 742, so T2, a REPEATABLE READ export whose snapshot predates T1's commit, keeps reading 7 while T3, a new transaction, reads 6, and nobody waits for a lock. Once T2 ends, no snapshot can see the old version any more, and **VACUUM** removes it. |
| **3 · Commit = WAL on disk** | Each change is first written as a **WAL record** in WAL buffers, and COMMIT flushes the WAL to disk before the client gets its OK. The table page stays dirty in shared buffers until the background writer or a **checkpoint** writes it, so if the server crashes first, recovery replays the WAL from the last checkpoint and rebuilds the page. The same WAL records stream to the standby. |
| **4 · Replicas and limits** | Streaming replication is **asynchronous** by default: T1's commit returns before the standby has replayed it, so during 200 ms of replay lag a report there still reads qty 7. With `synchronous_commit = remote_apply` and the standby named in `synchronous_standby_names`, every commit waits for that replay instead, at the cost of commit latency. If the primary fails, the standby is promoted (by Patroni or the managed service), but the limits remain: one primary takes every write, every connection is a process, and dead row versions must be vacuumed. |
<!-- END GENERATED: header -->

## The problem

Acme Shop has seven MUG-1 mugs left. At the same moment, checkouts in the Orders service decrement that row, the Catalog service reads it, and a nightly export totals the whole table. The database behind them has to:

- keep every acknowledged change through a crash or a power cut;
- let readers and writers work on the same rows at once, without showing half-finished changes and without making them queue behind each other;
- answer new questions with SQL, joins and indexes, without a redesign;
- hand its changes to replicas, caches and event streams, so the application does not have to write everything twice.

PostgreSQL is an open-source relational database built for this job. Three mechanisms, all in the diagram, carry most of the weight: multiversion concurrency control (MVCC), a write-ahead log (WAL), and replication built on that log. It is developed by the PostgreSQL Global Development Group under the PostgreSQL License, a permissive licence similar to BSD and MIT, and each major version is supported for five years. As of October 2026 the current release is PostgreSQL 18 (18.0 shipped on 25 September 2025, and 18.6 is the latest minor release); PostgreSQL 19 is in beta.

## How it works

### Processes and memory

A server starts with one supervisor process, the **postmaster**, which forks a new **backend** process for every client connection. The backend parses, plans and runs that session's queries. Backends share memory: **shared buffers** cache 8 kB table and index pages (`shared_buffers` is typically 128 MB by default; on a dedicated server with 1 GB or more of RAM, the documentation suggests starting at 25 % of memory), and WAL buffers hold log records until they are written. Background processes do the rest:

| Process | Job |
|---|---|
| WAL writer | Writes WAL records from memory to the WAL files. |
| checkpointer | Runs checkpoints: every `checkpoint_timeout` (5 min by default), or sooner when the WAL approaches `max_wal_size` (1 GB). |
| background writer | Writes dirty pages in small batches, spreading the I/O over time. |
| autovacuum launcher and workers | Vacuum and analyze tables as they change. |
| WAL sender | Streams WAL to a standby or to a replication-slot client such as Debezium. |
| WAL archiver | Copies each completed WAL segment (16 MB by default) to the archive. |

PostgreSQL 18 adds an asynchronous I/O subsystem, so a backend can have several reads in flight instead of waiting for each one. By default (`io_method = worker`) I/O worker processes issue them; Linux builds with liburing can use `io_uring`.

### MVCC: row versions instead of read locks

PostgreSQL never updates a row in place. An `UPDATE` writes a new **row version** stamped with the writing transaction's ID in its `xmin` system column, and puts the same ID in the old version's `xmax`. Every query reads through a **snapshot**, which records the transactions that had committed when it was taken, so it sees exactly one version of each row. That is why T2 keeps reading 7 while T3 reads 6, and why reads never block writes or the other way round. Two writers on the same row still conflict: a second `UPDATE` of MUG-1 waits until T1 commits or rolls back.

The isolation level decides when the snapshot is taken:

- **Read Committed**, the default: a fresh snapshot for every statement, so a second `SELECT` in the same transaction can see rows committed in between.
- **Repeatable Read**: one snapshot, taken at the transaction's first statement, for the whole transaction. If such a transaction tries to change a row that a concurrent transaction has changed and committed, it fails with *could not serialize access due to concurrent update*, and the application retries it.
- **Serializable**: Repeatable Read plus **Serializable Snapshot Isolation (SSI)**, which tracks read/write dependencies between transactions and aborts one with SQLSTATE `40001` when the outcome could differ from every serial order. The application retries.
- Read Uncommitted is accepted, but behaves like Read Committed.

Old versions do not disappear on their own. **VACUUM** removes dead versions once no snapshot can still see them and marks their space for reuse, and **autovacuum** runs it on a table once the updated or deleted rows exceed 50 plus 20 % of the table (`autovacuum_vacuum_threshold` and `autovacuum_vacuum_scale_factor`; PostgreSQL 18 caps the trigger at `autovacuum_vacuum_max_threshold`, 100 million rows). VACUUM also **freezes** old rows. Transaction IDs are 32 bits wide, so without freezing they would wrap around after about four billion transactions; if freezing falls too far behind, the server refuses to assign new transaction IDs until it catches up.

### WAL, checkpoints and crash recovery

Every change to a table or index page is first described in a **WAL record**, appended at the next **LSN** (log sequence number): a byte position in the log, printed as two hexadecimal numbers such as `0/3000148`. The rule is that a data page may reach disk only after the WAL records describing it are there. `COMMIT` appends a commit record and, with `synchronous_commit = on` (the default), waits until the WAL is flushed before it answers. The data pages stay dirty in shared buffers, and the background writer and **checkpoints** write them later.

After a crash, recovery starts at the last checkpoint's redo point and replays the WAL, so every acknowledged commit comes back. `full_page_writes` (on by default) logs a whole page the first time it changes after a checkpoint, so a page torn by a crash mid-write can be restored. With `synchronous_commit = off`, commits return before the flush: a crash can then lose the most recent commits (the documentation bounds the window at three times `wal_writer_delay`, which defaults to 200 ms), but it cannot corrupt the database.

### Indexes and query plans

- **B-tree**, the default: equality, ranges and sorting. PostgreSQL 18 adds **skip scan**, so a multicolumn B-tree index also helps queries without an equality condition on its leading column.
- **Hash**: equality only.
- **GiST** and **SP-GiST**: geometric data, ranges and nearest-neighbour searches; PostGIS builds on them.
- **GIN**: values with many parts, such as arrays, `jsonb` documents and full-text search.
- **BRIN**: summaries of block ranges, for very large tables whose column values follow the physical row order, such as an append-only `created_at`.

`EXPLAIN` shows the plan the planner chooses, and `EXPLAIN ANALYZE` runs it and reports real row counts and timings; since PostgreSQL 18 it also includes buffer usage without being asked.

### Replication

- **Physical streaming replication** ships the WAL itself. A WAL sender on the primary streams records to each standby, which replays them and, as a **hot standby**, serves read-only queries. It is **asynchronous by default**: a standby can lag behind (`replay_lag` in `pg_stat_replication` shows how far), and a failover can lose the last commits.
- **Synchronous replication** lists standbys in `synchronous_standby_names`, and each commit then waits for them (or for a quorum of them, with `ANY`): `synchronous_commit = remote_write` until a standby has written the WAL, `on` until it has flushed it, and `remote_apply` until it has replayed it, so queries on that standby see the change. The price is a round trip per commit, and commits stall while no synchronous standby answers, which is why the documentation suggests naming more candidates than you need (`ANY 1 (s1, s2)`).
- **Query conflicts on a hot standby:** replaying the cleanup of old row versions can remove rows that a long standby query still needs. After `max_standby_streaming_delay` (30 s by default) the query is cancelled, unless `hot_standby_feedback = on`, which tells the primary to keep those rows instead, at the cost of bloat there.
- **Logical replication** (`wal_level = logical`) decodes the WAL into row changes. Publications and subscriptions copy chosen tables between PostgreSQL servers, including across major versions, and **logical decoding** with an output plugin such as the built-in `pgoutput` feeds change data capture tools like Debezium.
- A **replication slot** remembers how far its consumer has read, and the primary keeps every WAL file from that point (and, for logical slots, the catalog rows needed to decode it). A consumer that goes away leaves its slot behind and the WAL piles up until the disk is full. Cap it with `max_slot_wal_keep_size` (`-1`, unlimited, by default) or PostgreSQL 18's `idle_replication_slot_timeout` (`0`, off, by default), and alert on `pg_replication_slots`.
- **Failover** promotes a standby with `pg_ctl promote` or `pg_promote()`. PostgreSQL itself does not decide when to do it: Patroni does, coordinating the nodes through [etcd](../etcd/), Consul or ZooKeeper (the [Leader Election](../leader-election/) pattern), and managed services do it for you.

### Partitioning and extensions

**Declarative partitioning** splits one large table into partitions by range (dates), list (regions) or hash. The planner skips partitions a query cannot touch, and dropping or detaching an old partition is far faster than deleting its rows, with no VACUUM afterwards. Everything stays on one server: spreading a table over several servers is sharding, done in the application or with the **Citus** extension (AGPL-3.0).

**Extensions** add types, index methods and functions inside the server. Examples: **PostGIS** for geospatial data (GPL-2.0-or-later), **pgvector** for vector similarity search (PostgreSQL License; version 0.8.7 supports PostgreSQL 13 and later), and **pg_stat_statements**, which ships with PostgreSQL and records statistics for every statement once it is listed in `shared_preload_libraries`. On a managed service, check its list of supported extensions.

### What PostgreSQL 18 added

Released on 25 September 2025: the asynchronous I/O subsystem; `uuidv7()`, timestamp-ordered UUIDs that index better than random ones; virtual generated columns, now the default kind of generated column; B-tree skip scan; OAuth 2.0 authentication; `OLD` and `NEW` in `RETURNING`; temporal `PRIMARY KEY` and `UNIQUE` constraints with `WITHOUT OVERLAPS`; planner statistics that survive `pg_upgrade`; data checksums on by default for new clusters; and md5 password authentication deprecated in favour of SCRAM.

## Where it fits

- **System of record** for transactional services: orders, payments, accounts, stock.
- **[Transactional Outbox](../transactional-outbox/):** the service inserts an outbox row in the same transaction as the business change, and Debezium's Outbox Event Router turns those rows into events on [Kafka](../kafka/).
- **Source for [Change Data Capture](../change-data-capture/):** logical decoding streams committed changes, in commit order, to search indexes, caches and the warehouse.
- **[Read Replicas](../read-replicas/)** for reports and read-heavy pages, with the lag shown in step 4.
- **Semi-structured data** in `jsonb` columns next to relational ones, indexed with GIN (the `jsonb_path_ops` operator class suits containment queries such as `@>`).
- **Simple job queues:** each worker claims jobs with `FOR UPDATE SKIP LOCKED`, which skips rows that other workers have already locked.

  ```sql
  SELECT id FROM jobs
  WHERE status = 'ready'
  ORDER BY id
  LIMIT 10
  FOR UPDATE SKIP LOCKED;
  ```

  This works for modest volumes kept next to the data they belong to. Every claimed job is an update or a delete that VACUUM has to clean up, workers must poll, and there is no fan-out or replay, so heavy or many-consumer messaging belongs in a broker such as [RabbitMQ](../rabbitmq/) or Kafka.
- It is also the usual store behind [Database per Service](../database-per-service/), [Materialized View](../materialized-view/) (`REFRESH MATERIALIZED VIEW CONCURRENTLY` refreshes without locking out readers) and [Sharding](../sharding/) (with Citus or in the application).

**Usual neighbours:** a connection pooler (PgBouncer, or [Amazon RDS](../amazon-rds-aurora/) Proxy on AWS), a cache such as [Redis](../redis/) for hot reads, Kafka fed by Debezium, and object storage such as [Amazon S3](../amazon-s3/) for base backups and archived WAL, managed with pgBackRest, WAL-G or Barman.

**Managed offerings:**

- **Amazon RDS for PostgreSQL.** A Multi-AZ DB instance deployment keeps one standby, updated synchronously, that is there for failover and serves no reads. A Multi-AZ DB cluster has two readable standbys and semisynchronous replication, which needs an acknowledgement from at least one of them. Read replicas use PostgreSQL's own asynchronous replication. For Debezium, set the parameter `rds.logical_replication` to `1`.
- **Amazon Aurora PostgreSQL** runs a PostgreSQL-compatible engine on a cluster volume that keeps copies of the data in three Availability Zones. One writer instance and up to 15 Aurora Replicas share that volume, so AWS states that replica lag is usually much less than 100 ms; for specific engine versions the volume can grow to 256 TiB. Autovacuum still needs attention.
- **Azure Database for PostgreSQL** (flexible server), **Google Cloud SQL for PostgreSQL** and **AlloyDB for PostgreSQL** cover the other large clouds.

## When to use it

Choose PostgreSQL when the data is relational and correctness matters: multi-row transactions, constraints, joins and ad-hoc queries, with one primary that can carry the write load. One engine then also covers JSON, geospatial, full-text and vector search. Look elsewhere when writes must scale out across many nodes or regions, when every access is a key lookup at very large scale, or when what you need is a log, a queue or a cache.

| | PostgreSQL | MySQL (InnoDB) | Amazon Aurora PostgreSQL | [Amazon DynamoDB](../amazon-dynamodb/) |
|---|---|---|---|---|
| Data model | Relational SQL, rich types (`jsonb`, arrays, ranges), extensions | Relational SQL | PostgreSQL-compatible relational | Key-value and document items, read by key |
| Concurrency | MVCC; old versions stay in the table until VACUUM; Read Committed by default | MVCC; old versions are rebuilt from undo logs until purge; Repeatable Read by default | PostgreSQL's MVCC, autovacuum included | Transactions of up to 100 actions (`TransactWriteItems`) |
| Read scaling | Streaming replicas, asynchronous by default | Binary-log replicas, asynchronous by default (semisynchronous optional) | Up to 15 replicas on the shared volume; lag usually much less than 100 ms | Eventually consistent reads by default, strongly consistent on request |
| Write scaling | One primary; shard with Citus or in the application | One source in traditional replication | One writer instance | Spread across partitions by partition key |
| Where it runs | Anywhere; PostgreSQL License | Anywhere; server source under GPLv2 | AWS only, managed | AWS only, managed |

Amazon Aurora PostgreSQL suits teams that want this engine on AWS with storage replicated across zones and many low-lag replicas, and accept running only on AWS. Amazon DynamoDB suits known, key-based access patterns whose writes must scale across partitions, at the price of designing tables around those queries instead of joining at read time.

## Trade-offs

- **One primary takes every write.** Replicas add read capacity, not write capacity. Past the largest machine, the options are partitioning, sharding (Citus or the application) or a different store.
- **Every connection is a process.** Each backend costs memory and start-up time, and `max_connections` (typically 100 by default) caps them, so thousands of application connections need a pooler in between.
- **MVCC leaves garbage behind.** Updates and deletes leave dead row versions, and anything that holds an old snapshot stops VACUUM from removing them: a long transaction, a session left idle inside a transaction, a standby query with `hot_standby_feedback = on`, a stalled logical slot. Tables bloat, and in the worst case the wraparound protection blocks writes until VACUUM catches up.
- **Asynchronous replicas serve stale reads and can lose the last commits on failover.** Synchronous replication fixes that, at the cost of commit latency and of stalls when no synchronous standby answers.
- **Replication slots keep WAL until it is consumed,** so an abandoned slot can fill the disk.
- **Major-version upgrades are a project:** `pg_upgrade` or a switchover through logical replication, and every extension has to exist for the new version.

## Implementation notes

**Pool the connections.** In `transaction` mode PgBouncer lends a client a server connection only for the length of one transaction, so 200 application connections can share 20 backends. Session state does not survive between transactions: `SET`, `LISTEN`, session-level advisory locks, `WITH HOLD` cursors and SQL `PREPARE` are not supported in that mode, while protocol-level prepared statements work since PgBouncer 1.21 (`max_prepared_statements`, 200 by default since 1.24). The current release is 1.26.0, from 23 September 2026.

```ini
; pgbouncer.ini for Acme Shop
[databases]
orders = host=10.0.1.10 port=5432 dbname=orders

[pgbouncer]
listen_port = 6432
pool_mode = transaction
; at most 20 server connections per user and database pair
default_pool_size = 20
; the default, 100, is too low for 200 application connections
max_client_conn = 200
```

**Configure the primary for the standby, the archive and Debezium.**

```ini
# postgresql.conf
wal_level = logical                  # enough for the standby, the archive and Debezium
archive_mode = on
archive_command = 'pgbackrest --stanza=orders archive-push %p'
max_slot_wal_keep_size = 50GB        # a lagging slot loses its WAL instead of filling the disk
idle_replication_slot_timeout = 2d   # PostgreSQL 18: invalidate slots unused for two days
```

**Back up for point-in-time recovery.** Take base backups (`pg_basebackup`, incremental with `--incremental` since PostgreSQL 17, then merged with `pg_combinebackup`) and archive every completed WAL segment; a restore can then stop at any moment with `recovery_target_time`. pgBackRest, WAL-G and Barman automate both, and only a test restore proves that the backups work.

**Watch replication and vacuum.**

```sql
-- on the primary: how far behind is each standby?
SELECT application_name, replay_lsn, replay_lag FROM pg_stat_replication;
-- slots that hold WAL back
SELECT slot_name, active, wal_status, inactive_since FROM pg_replication_slots;
-- tables with the most dead row versions
SELECT relname, n_dead_tup, last_autovacuum FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC LIMIT 5;
```

**Tune autovacuum per table.** On a large, busy table, lower its threshold with a storage parameter, for example `ALTER TABLE stock SET (autovacuum_vacuum_scale_factor = 0.02)`, and end forgotten sessions with `idle_in_transaction_session_timeout`.

**Find slow queries** with `pg_stat_statements`, then read their plans with `EXPLAIN (ANALYZE)`.

**Upgrade major versions** with `pg_upgrade` (`--link`, or PostgreSQL 18's `--swap`, avoids copying the data files) or by replicating logically into a new cluster and switching over.

**Lock it down.** Give each service its own role with only the privileges it needs, use SCRAM password authentication, and use row-level security when tenants share a table: after `ALTER TABLE … ENABLE ROW LEVEL SECURITY`, rows are visible only through policies created with `CREATE POLICY` (no policy means no rows), although the table's owner bypasses them unless the table also has `FORCE ROW LEVEL SECURITY`.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Read Replicas](../read-replicas/) — Send writes to the primary and spread reads across asynchronously updated replicas.
- [Transactional Outbox](../transactional-outbox/) — Save the event in the same database transaction as the data, then relay it: no dual-write gap.
- [Change Data Capture (CDC)](../change-data-capture/) — Stream every committed change from the database log to other systems.
- [Database per Service](../database-per-service/) — Each service owns its data; others go through its API or events, never its tables.
- [Sharding](../sharding/) — Split data horizontally across databases using a shard key.
- [Materialized View](../materialized-view/) — Precompute query-shaped views so reads don't pay for joins and aggregations.
- [Amazon RDS & Aurora](../amazon-rds-aurora/) — Managed relational databases: backups, Multi-AZ failover and read replicas, and Aurora's storage shared across three zones.
- [Redis & Valkey](../redis/) — An in-memory data-structure server: cache, session store, rate limiter, leaderboard and lightweight queue in one process.
- [Apache Kafka](../kafka/) — A partitioned, replicated commit log: producers append events, consumer groups read at their own pace and can replay history.

## References

- [PostgreSQL documentation — Concurrency Control: Introduction (MVCC)](https://www.postgresql.org/docs/current/mvcc-intro.html)
- [PostgreSQL documentation — Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
- [PostgreSQL documentation — Write-Ahead Logging (WAL)](https://www.postgresql.org/docs/current/wal-intro.html)
- [PostgreSQL documentation — WAL Configuration (checkpoints)](https://www.postgresql.org/docs/current/wal-configuration.html)
- [PostgreSQL documentation — Log-Shipping Standby Servers (streaming and synchronous replication)](https://www.postgresql.org/docs/current/warm-standby.html)
- [PostgreSQL documentation — Failover](https://www.postgresql.org/docs/current/warm-standby-failover.html)
- [PostgreSQL documentation — Logical Decoding Concepts (replication slots)](https://www.postgresql.org/docs/current/logicaldecoding-explanation.html)
- [PostgreSQL documentation — Routine Vacuuming](https://www.postgresql.org/docs/current/routine-vacuuming.html)
- [PostgreSQL documentation — Continuous Archiving and Point-in-Time Recovery](https://www.postgresql.org/docs/current/continuous-archiving.html)
- [PostgreSQL 18 release notes](https://www.postgresql.org/docs/18/release-18.html)
- [PostgreSQL — Versioning policy (supported releases)](https://www.postgresql.org/support/versioning/)
- [PgBouncer — Features (pooling modes)](https://www.pgbouncer.org/features.html)
- [Debezium — Connector for PostgreSQL](https://debezium.io/documentation/reference/stable/connectors/postgresql.html)
- [Amazon RDS User Guide — Amazon RDS for PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_PostgreSQL.html)
- [Amazon Aurora User Guide — Replication with Amazon Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Replication.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
