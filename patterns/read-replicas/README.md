<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗄️ Data Management](../../README.md#data-management)

# Read Replicas

> Send writes to the primary and spread reads across asynchronously updated replicas.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Read Replicas" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/read-replicas.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Split reads from writes** | The application's router (a driver setting, an ORM feature or a proxy) sends every write to the **primary** and spreads reads over the **replicas** through a reader endpoint. Every replica holds the same tables and the same data: the primary ships its log to each of them **asynchronously**, after the commit has already been acknowledged, and the replica replays it. Adding replicas adds read capacity; write capacity stays that of one primary. |
| **2 · Replication lag** | A user upgrades to Pro. The primary commits the change at log position 43 and acknowledges it before any replica has it. The page reloads at once, and the read lands on a replica that is 200 ms behind and has replayed only up to position 42, so it answers **Free**: a stale read, caused by nothing more than normal **replication lag**. |
| **3 · Read your own writes** | The write returns its log position (43) and the session keeps it. That user's next read carries the position, and the replica holds the read until it has replayed that far; the router can instead send such a read straight to the primary. Either way the user sees **Pro**, while other users' reads carry no position and still go to any replica without waiting. |
| **4 · Lagging or failed replicas** | A long report query holds up replay on replica 3, so its lag grows from milliseconds to seconds, and once it passes the lag limit (5 s here) the reader endpoint takes it out of rotation. Replica 1 stops answering its health check and is dropped the same way, which leaves the remaining replica to carry every read. If the *primary* fails, a replica is promoted to take its place, and with asynchronous replication the last commits that had not reached it are lost. |
<!-- END GENERATED: header -->

## The problem

Most applications read far more than they write. A product page, a timeline or a dashboard is fetched thousands of times for every change to the rows behind it, and all of those queries land on the same server that takes the writes. A bigger server moves the ceiling but does not remove it, and as long as there is one copy of the data, every report and every export competes with the users for the same CPU, memory and disk.

The database already has a mechanism that can help: replication. It exists so that a second server can take over after a failure, but a copy that is kept current can also answer queries. Read replicas use it for capacity: one server keeps taking the writes, and the copies take the reads. The price is that a copy is always a little behind, and most of this pattern is about what that delay does to users and what to do about it.

## How it works

1. **One primary takes every write.** It records every committed change, in commit order, in a log: the write-ahead log (WAL) in PostgreSQL, the binary log in MySQL.
2. **Replicas replay the log.** Each replica holds a connection to the primary, receives the log as a stream and applies it to its own copy. It ends up with the same tables, rows and indexes, and it accepts read-only queries (PostgreSQL calls this a hot standby). A replica can feed further replicas in a cascade, which takes connections and network traffic off the primary.
3. **A router splits the traffic.** Writes, and the reads that must be current, go to the primary. Everything else goes to a reader endpoint: a proxy, a load balancer or a DNS name that spreads reads over the replicas that are fit to serve.
4. **Replication is asynchronous unless you say otherwise.** The primary acknowledges a commit once it is durable locally and ships the log afterwards. A replica is therefore always some distance behind: milliseconds on a quiet system, seconds or more under load. That distance is the **replication lag**.

Each replica adds read capacity. Write capacity does not grow: there is still one primary, and every replica has to replay every write on top of serving its reads.

### Asynchronous, semi-synchronous, synchronous

How long a commit waits for the replicas decides what a replica can promise.

| | The commit returns when | It costs | It buys |
|---|---|---|---|
| **Asynchronous** | The primary has made it durable locally | Nothing per commit | Nothing: reads can be stale, and a failover loses the commits a replica had not received |
| **Semi-synchronous** | At least one replica has *received* the change and stored it, but not yet applied it | A network round trip per commit, and a stall when no replica answers | No acknowledged commit dies with the primary. Reads on a replica can still be stale |
| **Synchronous** | The chosen replicas have *applied* it | The round trip plus replay on the slowest required replica; a slow or dead replica holds up every write | A read on those replicas sees every acknowledged commit |

- **Asynchronous** is the default of PostgreSQL streaming replication and of MySQL replication, and it is what managed read replicas such as Amazon RDS's use.
- **Semi-synchronous** is a MySQL term: the source waits until at least one replica confirms that the transaction's events are written to its relay log and flushed to disk. If nobody confirms within `rpl_semi_sync_source_timeout` (10 seconds by default) the source quietly falls back to asynchronous replication. PostgreSQL offers the same middle ground under another name: with `synchronous_standby_names` set, `synchronous_commit = on` waits until a standby has flushed the commit's WAL.
- **Synchronous** in the strict sense, where the replica has also applied the change, is `synchronous_commit = remote_apply` in PostgreSQL. A commit then waits until the synchronous standbys have replayed it, and it keeps waiting if one of them is gone, so name more candidates than you require: `FIRST 1 (a, b)` picks by priority, `ANY 1 (a, b)` takes whichever answers first.

These settings are not all-or-nothing. A common layout is one synchronous standby for durability plus several asynchronous replicas for reads, and PostgreSQL lets a single transaction choose its own `synchronous_commit` level.

### Where lag comes from, and how to measure it

Lag is the time between a commit on the primary and the moment a replica has replayed it. It grows when:

- **The primary writes in bursts.** A bulk update or one very large transaction takes the replicas a while to receive and replay.
- **A long query runs on the replica.** Replay cannot remove row versions that a running query can still see, or take an exclusive lock on a table it is reading. PostgreSQL lets replay fall up to `max_standby_streaming_delay` (30 seconds by default) behind while it waits for such queries, and then cancels them. While it waits, nothing else is replayed either: this is the report in step 4.
- **The replica is smaller or busier than the primary.** It does all of the primary's writes plus its own reads.
- **Replay is less parallel than the original writes.** The primary commits from many connections at once; a MySQL replica applies them with `replica_parallel_workers` threads (4 by default in 8.4).
- **The replica is far away.** A replica in another region is usually further behind than one next to the primary.

Two examples of where to read it:

- **PostgreSQL.** On the primary, `pg_stat_replication` has one row per connected standby with the positions it has reached (`sent_lsn`, `write_lsn`, `flush_lsn`, `replay_lsn`) and the same as time (`write_lag`, `flush_lag`, `replay_lag`). On a standby, `pg_last_wal_receive_lsn()` and `pg_last_wal_replay_lsn()` return what it has received and replayed, and `pg_last_xact_replay_timestamp()` the commit time of the last transaction it replayed.
- **MySQL.** `SHOW REPLICA STATUS` reports `Seconds_Behind_Source`. It compares the applier with what the replica has received, so it can read 0 on a replica whose receiver is itself behind on a slow network. The Performance Schema is more exact: for the last transaction each worker applied, `replication_applier_status_by_worker` holds the commit time on the original source (`LAST_APPLIED_TRANSACTION_ORIGINAL_COMMIT_TIMESTAMP`) and the time the replica finished applying it (`LAST_APPLIED_TRANSACTION_END_APPLY_TIMESTAMP`).

Managed services publish lag as a metric: `ReplicaLag` in Amazon RDS, `AuroraReplicaLag` in Aurora, `database/replication/replica_lag` in Cloud SQL. Know what your number means. "Time since the last replayed commit" keeps growing while the primary is idle, although nothing is missing: RDS for PostgreSQL computes its metric that way and documents that it can show up to five minutes on a source without transactions. A distance in log positions, or a heartbeat row written every second, does not have that flaw.

### What stale replicas do to users

| Anomaly | What the user sees | Why | The guarantee that removes it |
|---|---|---|---|
| **Stale read after a write** | "I saved it, reloaded, and my change is gone" | The read reached a replica before the change did (step 2) | Read-your-writes |
| **Time going backwards** | A new comment is there, and after a refresh it is not | Two reads in a row hit replicas with different lag | Monotonic reads |

The fixes, from the roughest to the most exact:

- **Read from the primary for a while after a write.** Remember in the session when the user last wrote, and send their reads to the primary for a window longer than the usual lag. Rails ships this: with `config.active_record.database_selector = { delay: 2.seconds }`, a `GET` or `HEAD` request that follows the session's own write within two seconds is served by the writer. It is simple and it is a guess. Lag longer than the window still shows through, and every writer adds reads to the primary.
- **Wait for a position.** This is step 3, and it is exact. The write returns its log position or transaction ID, and the read does not run until the replica has reached it.
  - *MySQL:* with `session_track_gtids = OWN_GTID` the server returns the GTID of each transaction a session commits. On the replica, `WAIT_FOR_EXECUTED_GTID_SET(gtid_set, timeout)` blocks until that GTID has been applied and returns 0, or 1 when the timeout expires. MySQL Router's read/write splitting does the same without application code: with `wait_for_my_writes` a read waits for the session's last write, and after `wait_for_my_writes_timeout` (1 second by default) it goes to the primary instead.
  - *PostgreSQL:* read `pg_current_wal_insert_lsn()` on the primary after the commit and compare it with `pg_last_wal_replay_lsn()` on the standby. PostgreSQL 19, in beta as of October 2026, adds a `WAIT FOR LSN` command with a `TIMEOUT` option that does the waiting on the standby.
  - *MongoDB:* a causally consistent session, with read and write concern `"majority"`, guarantees both read-your-writes and monotonic reads across the members of a replica set.
  - Always wait with a timeout, and fall back to the primary when it expires.
- **Pin a session to one replica.** A single replica never goes backwards, so sending all of a user's reads to the same replica (chosen by a hash of the user or session ID) gives monotonic reads without any waiting. When that replica drops out, its users are moved and may step back once.
- **A synchronous replica for the few reads that need it.** If a particular change must be visible on a replica the moment it is acknowledged, commit that transaction with `synchronous_commit = remote_apply` against a synchronous standby and read from that standby.
- **Or read those queries from the primary.** A balance before a withdrawal, stock before an order, a permission check: anything that is read in order to decide a write belongs on the primary.

### Routing reads

- **In the application.** Keep two connection pools, one to the primary and one to the replicas, and let the code or the framework choose per query. Rails declares the roles (`connects_to database: { writing: :primary, reading: :primary_replica }`) and switches with `connected_to(role: :reading)`; Django asks its database routers (`db_for_read`, `db_for_write`). Drivers help with finding the nodes: libpq accepts a list of hosts and filters it with `target_session_attrs` (`read-write`, `read-only`, `primary`, `standby`, `prefer-standby`), shuffled by `load_balance_hosts=random`; pgJDBC has `targetServerType` and `loadBalanceHosts`; Azure SQL Database sends a connection that declares `ApplicationIntent=ReadOnly` to a read-only replica, in the service tiers that have one.
- **In a proxy.** MySQL Router (`access_mode=auto`), MariaDB MaxScale's `readwritesplit` router and Pgpool-II classify each statement, send writes to the primary and balance `SELECT`s over the replicas, so the application keeps a single connection string.
- **Through a reader endpoint.** Managed services put one name in front of the replicas: Aurora's reader endpoint spreads connections over the cluster's replicas, and a Cloud SQL read pool has a single endpoint in front of up to 20 nodes. These balance *connections*, not queries: a query goes wherever its connection already points, so long-lived pooled connections do not move when a replica is added.

Whichever of these you use, the application usually still has to choose per query. Only the application knows whether a read may be stale, whether it follows the user's own write, and whether it belongs to a transaction that is about to write. A proxy that splits by statement type gives a good default and needs an override for the rest (in MySQL Router, `ROUTER SET access_mode='read_write'` for the session).

### Failover, promotion and standbys

When the primary fails, a replica is **promoted**: it stops replaying and starts accepting writes (`pg_ctl promote` or `pg_promote()` in PostgreSQL). Then three things have to happen:

- **Clients must find the new primary**, through a writer endpoint that is repointed, or a driver that looks for the writable node.
- **The other replicas must follow it.** With MySQL GTIDs a replica can reconnect to the new source and find its own place (`SOURCE_AUTO_POSITION`). In Amazon RDS, promoting one replica leaves the others attached to the old source, so you create new replicas from the promoted instance.
- **The old primary must not come back as a second writer.**

With asynchronous replication, the commits that the promoted replica had not received are gone: the loss equals its lag at the moment of failure. Promote the replica that is furthest ahead, and treat the lag you tolerate as your recovery point objective.

A read replica is not the same thing as a **standby kept for availability**, even though both are fed by the same log:

| | Read replica | Standby |
|---|---|---|
| **Purpose** | Read capacity | Taking over when the primary fails |
| **Replication** | Usually asynchronous | Usually synchronous, so nothing acknowledged is lost |
| **Serves queries** | Yes | Often not |
| **Sized for** | Its share of the reads | The primary's full load |
| **Failover** | A promotion you run, or a managed one that may lose the lag | Automatic, behind the same endpoint |

Amazon RDS shows the difference well: the standby of a Multi-AZ DB instance deployment is replicated synchronously and serves no traffic, a read replica is asynchronous and readable, and a Multi-AZ DB cluster has two standbys that also serve reads. In Aurora the same instances do both jobs: the writer and up to 15 replicas share one storage volume, and when the writer fails Aurora promotes one of the readers.

## When to use it

- **Read-heavy workloads** where the primary's CPU or I/O goes to queries, and those queries can tolerate data that is a moment old: listings, search results, timelines, profile pages.
- **Reports, exports and analytics** that would otherwise slow down transactions. Give them a replica of their own (see Implementation notes).
- **Readers far from the primary.** A replica in another region answers nearby users quickly, while their writes still travel to the primary.
- **Taking load off the primary for backups**, schema inspection or ad hoc queries.
- **A copy to promote** in a disaster, as a by-product. If availability is the goal, add a proper standby as well.

It is the wrong tool when:

- **Writes are the bottleneck.** Replicas do not add write capacity; every one of them repeats every write. That needs sharding, or less writing.
- **The reads cannot be stale.** If most queries need the latest committed data, they all end up on the primary and the replicas sit idle.
- **A few expensive queries are the problem.** A replica runs the same slow query on the same schema. Fix the query or the index, cache the result with [cache-aside](../cache-aside/), or precompute a view shaped for that screen, as [CQRS](../cqrs/) and materialised views do.
- **The primary still has headroom.** A replica set is more to run: lag to watch, routing to maintain and failover to rehearse.
- **Writers in several regions need low latency.** Their writes still cross the world to one primary. That is the problem [multi-region active-active](../multi-region-active-active/) takes on, at the price of write conflicts.

## Trade-offs

- **Eventual consistency arrives in a relational database.** Code that reads right after writing, runs inside a web request that redirects, or passes an ID to a background job that reads at once will now and then see old data. These bugs are rare, load-dependent and hard to reproduce.
- **The application has to know.** Read/write splitting is not transparent: someone decides, per query, where it may run.
- **Lag is unbounded.** The usual figure is milliseconds; the worst case is as long as the longest replay stall. Plan for a replica that is minutes behind, because one day one will be.
- **Capacity has to survive a loss.** When a replica leaves the rotation its share of the reads moves to the others (step 4). With three replicas each running at 70 %, losing one overloads the remaining two, which then lag, leave the rotation in turn and push everything onto the primary.
- **Cost scales with data, not with traffic.** Every replica stores the whole dataset and replays every write, whether or not it answers many queries.
- **Replicas hold the primary back, too.** With a replication slot, a PostgreSQL replica that stops consuming the log makes the primary keep that log, and a standby with `hot_standby_feedback` on stops the primary from cleaning up rows that the standby's queries still need, which bloats the primary's tables.
- **A faithful copy copies mistakes.** A dropped table is dropped on every replica moments later. Replicas are not backups.

## Implementation notes

- **Keep the replicas read-only.** A PostgreSQL standby cannot be written to. A MySQL replica can, unless you set `read_only`, and `super_read_only` to bind privileged accounts as well; a stray write there makes the copies diverge.
- **A dedicated replica for analytics.** Do not put the reporting replica behind the reader endpoint. Give it its own name, let long queries run there, and accept that it lags. On PostgreSQL that means a high `max_standby_streaming_delay` on that replica (`-1` waits for queries without limit), and a low one on the replicas that serve users, where a cancelled query is better than a stale page. Aurora's custom endpoints, which address a chosen subset of a cluster's instances, fit this split, and Google's Cloud SQL documentation gives the same advice: separate replicas for transactional and analytical queries.
- **Take lagging replicas out of rotation.** Step 4 needs a router that looks at lag and not only at liveness. Pgpool-II stops sending `SELECT`s to a standby that is further behind than `delay_threshold`, MaxScale skips replicas beyond `max_replication_lag`, and MongoDB drivers drop secondaries that are staler than `maxStalenessSeconds` (90 seconds is the smallest value allowed). Not every reader endpoint looks at lag, so find out which kind you have. If yours checks only that a replica answers, make each replica's health check fail when its lag is over the limit: [health endpoint monitoring](../health-endpoint-monitoring/) and [load balancing](../load-balancing/) cover the mechanics.
- **Decide what happens when no replica qualifies.** Falling back to the primary keeps the pages correct and can overload it at the worst moment. Serving stale data keeps the primary safe. Choose per query class, before the incident.
- **Size replicas like the primary.** They apply the same writes, and one of them may have to become the primary. AWS recommends that an RDS for MySQL read replica has the same compute and storage as its source.
- **Limits, as documented in October 2026.**
  - *Amazon RDS:* up to 15 read replicas per source instance, in the same Region or another one.
  - *Amazon Aurora:* up to 15 replicas in a cluster, which usually lag by much less than 100 ms because they read the same storage; a global database adds up to 10 read-only secondary Regions that typically trail by under a second.
  - *Azure Database for PostgreSQL:* up to five replicas of a primary, in the same region or another. Its virtual endpoints give a writer name and a read-only name that survive a promotion, but the read-only one targets a single server and does not balance load.
  - *Google Cloud SQL:* Google recommends at most 10 direct replicas per primary and cascading replicas beyond that; cross-region replicas are supported, and a read pool holds 1 to 20 nodes.
- **Cross-region replicas** serve local reads and double as a disaster recovery copy, but expect more lag than in-region, and remember that their users' writes still go to the primary's region.
- **Alert on lag per replica**, not on an average, and alert when a replica leaves the rotation. A fleet average hides the one replica that is ten minutes behind and still serving.
- **Test the stale paths.** Add artificial delay to a replica in a test environment and click through the product. The screens that break are the ones that need one of the read-your-writes fixes.
- **Other consumers of the same log.** [Change data capture](../change-data-capture/) reads the log that the replicas follow and feeds caches, search indexes and warehouses with it, which is the way to go when the copy should have a different shape from the source.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [CQRS](../cqrs/) — Separate the write model (commands) from read models (queries), each optimised for its job.
- [Cache-Aside](../cache-aside/) — Read from the cache first; on a miss load from the database and populate the cache.
- [Sharding](../sharding/) — Split data horizontally across databases using a shard key.
- [Multi-Region Active-Active](../multi-region-active-active/) — Serve users from several regions at once and shift traffic away from a region that fails.
- [Change Data Capture (CDC)](../change-data-capture/) — Stream every committed change from the database log to other systems.
- [Materialized View](../materialized-view/) — Precompute query-shaped views so reads don't pay for joins and aggregations.
- [Active-Passive Failover](../active-passive-failover/) — A warm standby region is promoted when the primary region goes down.
- [Load Balancing](../load-balancing/) — Spread requests across healthy instances and stop sending to unhealthy ones.

## Related components and services

- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [MongoDB](../mongodb/) — A document database: JSON-like documents with flexible schemas, replica sets for failover and sharding to scale out.
- [Apache Cassandra](../cassandra/) — A wide-column database built for heavy writes across data centres: a token ring, tunable consistency and LSM storage.
- [Elasticsearch & OpenSearch](../elasticsearch/) — Search engines built on inverted indexes: full-text queries ranked by relevance, and aggregations over sharded indexes.
- [Amazon RDS & Aurora](../amazon-rds-aurora/) — Managed relational databases: backups, Multi-AZ failover and read replicas, and Aurora's storage shared across three zones.

## Related database topics

- [Query Execution Plans](../query-execution-plans/) — Read EXPLAIN the way the planner thinks: scans, joins, estimated against actual rows, and the statistics behind each choice.
- [MVCC](../mvcc/) — Multi-version concurrency control: an update writes a new row version, readers see a snapshot, and vacuum removes dead versions.
- [Write-Ahead Log](../write-ahead-log/) — Log each change before applying it, so a commit survives a crash, recovery replays the log, and replicas and backups follow it.

## References

- [PostgreSQL documentation — High Availability, Load Balancing, and Replication](https://www.postgresql.org/docs/current/high-availability.html)
- [PostgreSQL documentation — Log-Shipping Standby Servers (streaming, synchronous and cascading replication, monitoring)](https://www.postgresql.org/docs/current/warm-standby.html)
- [PostgreSQL documentation — Hot Standby (queries on a standby, replay conflicts)](https://www.postgresql.org/docs/current/hot-standby.html)
- [PostgreSQL 19 documentation — WAIT (the WAIT FOR LSN command)](https://www.postgresql.org/docs/19/sql-wait.html)
- [MySQL 8.4 Reference Manual — Replication](https://dev.mysql.com/doc/refman/8.4/en/replication.html)
- [MySQL 8.4 Reference Manual — Replication with Global Transaction Identifiers](https://dev.mysql.com/doc/refman/8.4/en/replication-gtids.html)
- [MySQL 8.4 Reference Manual — Functions Used with Global Transaction Identifiers (WAIT_FOR_EXECUTED_GTID_SET)](https://dev.mysql.com/doc/refman/8.4/en/gtid-functions.html)
- [MySQL 8.4 Reference Manual — Semisynchronous Replication](https://dev.mysql.com/doc/refman/8.4/en/replication-semisync.html)
- [MySQL Router 8.4 — Read/Write Splitting](https://dev.mysql.com/doc/mysql-router/8.4/en/router-read-write-splitting.html)
- [Amazon RDS User Guide — Working with DB instance read replicas](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html)
- [Amazon RDS User Guide — Configuring and managing a Multi-AZ deployment](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.html)
- [Amazon Aurora User Guide — Replication with Amazon Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Replication.html)
- [Amazon Aurora User Guide — Amazon Aurora endpoint connections](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Overview.Endpoints.html)
- [Microsoft Learn — Read replicas in Azure Database for PostgreSQL flexible server](https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas)
- [Google Cloud — About replication in Cloud SQL (PostgreSQL)](https://docs.cloud.google.com/sql/docs/postgres/replication)
- [Google Cloud — Cloud SQL: About read pools](https://docs.cloud.google.com/sql/docs/postgres/about-read-pools)
- [MongoDB Manual — Causal Consistency and Read and Write Concerns](https://www.mongodb.com/docs/manual/core/causal-consistency-read-write-concerns/)
- [MongoDB Manual — Read Preference maxStalenessSeconds](https://www.mongodb.com/docs/manual/core/read-preference-staleness/)
- [Ruby on Rails Guides — Multiple Databases with Active Record](https://guides.rubyonrails.org/active_record_multiple_databases.html)
- [Martin Kleppmann & Chris Riccomini — Designing Data-Intensive Applications, 2nd Edition (O'Reilly, 2026): the chapter on replication](https://martin.kleppmann.com/2026/03/24/designing-data-intensive-applications-2e.html)
- [Werner Vogels — Eventually Consistent, Revisited](https://www.allthingsdistributed.com/2008/12/eventually_consistent.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
