
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗃️ Database Internals & Performance](../../README.md#database-internals--performance)

# Table Partitioning

> Split a large table into partitions by range, list or hash, so queries skip partitions and old data is dropped in an instant.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Table Partitioning" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/table-partitioning.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One table, slow cleanup** | Acme keeps 12 months of `order_events`, and all 1,500,000 rows (86 MB, stored in time order) sit in one table. A report on one week runs a **Parallel Seq Scan** of all 11,030 pages to count 16,408 rows, and the retention job's `DELETE … WHERE happened_at < '2025-10-01'` marks 639,726 rows dead in 0.31 s while writing **70 MB of WAL**: a record for every row and an image of every page it touched. VACUUM then writes 17 MB more and leaves 4,703 empty pages behind, but the file stays 86 MB. |
| **2 · Partition by month** | `CREATE TABLE … PARTITION BY RANGE (happened_at)` turns `order_events` into a parent that stores nothing, and each `PARTITION OF … FOR VALUES FROM ('2026-09-01') TO ('2026-10-01')` is an ordinary table that holds the rows from its lower bound up to, but not including, its upper one. Acme creates 25 of them, December 2024 to December 2026, and copies the rows in: PostgreSQL routes every row, old or new, to the partition whose range holds its `happened_at`. An index created on the parent is created on every partition too, so `order_events_2026_09` has its own primary key and `order_id` index. |
| **3 · Pruning and retention** | With constants in the `WHERE` clause the planner prunes the other 23 partitions before it builds the plan, so two sequential scans read **1,052 pages instead of 11,030** (9 ms against 30 ms in one run). Retention becomes `DETACH PARTITION … CONCURRENTLY` and `DROP TABLE` for each month before October 2025: 20 statements, 38 ms and 159 kB of WAL in all, 67 MB of files freed at once and no dead rows. The detach doesn't block reports, where a plain `DROP TABLE` of a partition made one queue for 2.04 s, but the foreign key to `orders` still makes both steps lock `orders`, so the job runs with a short `lock_timeout`. |
| **4 · Keys, plans and limits** | A primary key on `id` alone is rejected, so the key becomes `(id, happened_at)` and no index checks that `id` by itself is unique. `WHERE order_id = 250000` can't be pruned: it searches all 15 partitions, 28 pages against 5 on one table, and with 368 daily partitions just planning such a query took 4.0 ms instead of 0.02 ms. Every partition still lives on the same server, unlike [sharding](../sharding/), and MySQL 8.4 has the same rule for unique keys but, unlike PostgreSQL, allows no foreign keys on partitioned InnoDB tables. |
<!-- END GENERATED: header -->
## The problem

Acme Shop records three events for every order (`placed`, `paid` and `shipped`) in `order_events`: 1,500,000 rows from 31 December 2024 to 3 October 2026, in one 86 MB table of 11,030 pages with a 32 MB primary key. The rows were written in time order, so the oldest events sit on the first pages of the file. Acme keeps twelve months of events, and two kinds of work on the table grow with it:

- **Reports on a time range.** `SELECT count(*) FROM order_events WHERE happened_at >= '2026-08-31' AND happened_at < '2026-09-07'` wants one week: 16,408 rows on 122 pages. Only the primary key is indexed, so [PostgreSQL](../postgresql/) 18.6 runs a `Parallel Seq Scan` with two workers. The three processes read all 11,030 pages and throw away 1,483,592 rows, in 30 ms in one run on a laptop.
- **Retention.** Removing everything before 1 October 2025 takes one statement, `DELETE FROM order_events WHERE happened_at < '2025-10-01'`, and it is the expensive one. A PostgreSQL delete doesn't remove a row: it writes the deleting transaction's id into the row's `xmax`, and the row stays on its page until VACUUM reclaims it ([MVCC](../mvcc/)). The statement took 0.31 s to mark 639,726 rows, 43% of the table, on 4,704 pages, and `EXPLAIN (ANALYZE, WAL)` counted 639,726 WAL records plus 4,705 full-page images: **70 MB of WAL** for rows that filled 37 MB of pages ([write-ahead log](../write-ahead-log/)). Streaming replicas and a WAL archive, where a server has them, receive every byte of it too.

Then comes the cleanup. `pg_stat_user_tables` reported 639,726 dead rows. `VACUUM (VERBOSE)` scanned 4,705 heap pages and the whole 4,116-page primary key to remove their index entries, and wrote another 17 MB of WAL in 0.09 s. Heap page 0, which `pageinspect` had shown holding 136 rows with `xmax` 631066, was empty afterwards, with 8,164 bytes free. The file didn't shrink: VACUUM gives space back to the operating system only when the empty pages are at the end of the table, and these 4,703 pages are at its start. The table stays at 86 MB, and new rows will fill those holes, so the table also loses its time order. The times are small because the table is small; the WAL and the vacuum work grow with every row deleted.

## How it works

**A parent and its partitions.** Declarative partitioning turns one logical table into a parent and a set of partitions, divided by a partition key:

```sql
CREATE TABLE order_events (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  order_id    bigint NOT NULL REFERENCES orders (id),
  kind        text NOT NULL,
  happened_at timestamptz NOT NULL,
  PRIMARY KEY (id, happened_at)
) PARTITION BY RANGE (happened_at);

CREATE TABLE order_events_2026_09 PARTITION OF order_events
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
```

The parent stores no rows (`pg_relation_size` returns 0); it holds the definition, the key and the list of partitions. Each partition is an ordinary table with its own heap file, indexes, statistics and vacuum runs. A range includes its lower bound and excludes its upper one, so an event at exactly midnight on 1 October belongs to `order_events_2026_10`. Acme created 25 partitions, December 2024 to December 2026, generating one `CREATE TABLE … PARTITION OF` per month with psql's `\gexec` (see *Try it*). Bounds on a `timestamptz` key are read in the session's time zone, UTC on this server, and stored as `'2026-09-01 00:00:00+00'`.

There are three methods:

| Method | A partition holds | Suits | On Acme's data, for example |
|---|---|---|---|
| Range | a continuous range of key values | timestamps, ids | `order_events` by month |
| List | the values listed for it | countries, regions, tenants | `orders` by `shipping_country` |
| Hash | the rows whose hashed key leaves its remainder (`MODULUS 8, REMAINDER 3`) | a key with no useful ranges | `order_items` by `order_id`, in 8 parts of similar size |

A partition can itself be partitioned, and a `DEFAULT` partition (range and list only) catches rows that fit no other partition.

**Routing.** Rows are written to the parent, and PostgreSQL routes each one to the partition whose range holds its key: `INSERT INTO order_events VALUES (DEFAULT, 500000, 'delivered', '2026-10-06 09:30') RETURNING tableoid::regclass` returned `order_events_2026_10`. An event dated 5 January 2027 failed with `no partition of relation "order_events" found for row`, because no partition covers it yet, so next month's partition has to exist before its rows arrive. An `UPDATE` that moves `happened_at` across a boundary moves the row into the other partition.

**Indexes and keys.** `CREATE INDEX ON order_events (order_id)` creates a partitioned index on the parent and a real index on each of the 25 partitions, such as the 1,152 kB `order_events_2026_09_order_id_idx`; every partition created or attached later gets one too, and `pg_partition_tree('order_events_order_id_idx')` lists them. Each of those indexes only sees its own partition, which is why a unique constraint must contain every column of the partition key: `PRIMARY KEY (id)` failed with `unique constraint on partitioned table must include all partitioning columns`, so the key is `(id, happened_at)`. The identity column still hands out each `id` once, but no index would stop a second row with the same `id` and another `happened_at`. `CREATE INDEX CONCURRENTLY` doesn't work on the parent; the documented workaround creates the index `ON ONLY` the parent, builds each partition's index concurrently and attaches it with `ALTER INDEX … ATTACH PARTITION`.

**Partition pruning.** The planner compares the `WHERE` clause with the partition bounds and leaves out every partition that can't hold a match. The week from *The problem*, on the partitioned table:

```
Aggregate (actual rows=1.00)                              Buffers: shared hit=1052
  ->  Append (actual rows=16408.00)
        ->  Seq Scan on order_events_2026_08   Rows Removed by Filter: 70314   Buffers: shared hit=535
        ->  Seq Scan on order_events_2026_09   Rows Removed by Filter: 56250   Buffers: shared hit=517
```

It read 1,052 pages instead of 11,030, in 9 ms against 30 ms in one run. The other 23 partitions were pruned while planning, so they don't appear in the plan at all. When a value is only known at run time, the executor prunes instead and `EXPLAIN` reports `Subplans Removed`: a prepared statement with `$1` and `$2` under a generic plan showed `Subplans Removed: 23`, and `happened_at >= now() - interval '7 days'` showed `Subplans Removed: 22` and scanned October to December 2026. Partitions removed as the executor starts are still locked. Pruning is on by default (`enable_partition_pruning`).

Pruning doesn't beat a good index on a narrow range. With a 32 MB B-tree on `happened_at`, the one-table query read 170 pages in 2.4 ms with an `Index Only Scan`, and the 24 kB BRIN index on the same column from [index types](../index-types/) narrows the scan too. Pruning helps most where an index wouldn't be used: a report grouping all of September 2026 by `kind` read every page of the one table (26 ms) but only the 517 pages of one partition (12 ms).

**Partition-wise joins and aggregates.** With `enable_partitionwise_join` on, a join between two tables partitioned the same way, on all of their partition keys, runs as one join per matching pair of partitions; with `enable_partitionwise_aggregate` on, grouping and aggregation run partition by partition, completely when the `GROUP BY` contains the partition key and partially otherwise. Both are off by default, because they make planning more expensive and can multiply a query's memory use, up to one `work_mem` per partition for each sort or hash. PostgreSQL 18 allows partition-wise joins in more cases and with less memory.

**Statistics.** Autovacuum vacuums and analyzes every partition like any other table, but it never analyzes the parent. If queries need statistics on the parent for good plans, run `ANALYZE order_events` yourself after loading or removing a lot of data. `ANALYZE ONLY order_events`, new in PostgreSQL 18, refreshes the parent's statistics without analyzing every partition again.

**Retention: detach, then drop.** Removing a month now means removing a table, and the locks it takes matter more than its speed. These were read from `pg_locks` inside rolled-back transactions on this schema. `DETACH … CONCURRENTLY` can't run inside a transaction, so its row combines the level the documentation gives for `order_events` with the lock it was seen waiting for on `orders`:

| Statement | Lock on `order_events` | Lock on `orders`, through the foreign key |
|---|---|---|
| `CREATE TABLE … PARTITION OF order_events` | ACCESS EXCLUSIVE | SHARE ROW EXCLUSIVE |
| `ALTER TABLE order_events ATTACH PARTITION …` | SHARE UPDATE EXCLUSIVE | SHARE ROW EXCLUSIVE |
| `ALTER TABLE order_events DETACH PARTITION …` | ACCESS EXCLUSIVE | SHARE ROW EXCLUSIVE |
| `ALTER TABLE order_events DETACH PARTITION … CONCURRENTLY` | SHARE UPDATE EXCLUSIVE | SHARE ROW EXCLUSIVE |
| `DROP TABLE` of an attached partition | ACCESS EXCLUSIVE | none |
| `DROP TABLE` of a detached partition | none | ACCESS EXCLUSIVE |

ACCESS EXCLUSIVE conflicts with every other lock, plain `SELECT` included, while SHARE ROW EXCLUSIVE lets reads through but not writes. A statement that waits for a lock also makes the queries that arrive after it wait behind it ([locks and deadlocks](../locks-and-deadlocks/)). Three sessions on a fresh copy, driven by a script in this order:

| Time | Session 1 | Session 2 (retention) | Session 3 (the week report) |
|---|---|---|---|
| 0.0 s | `BEGIN`, a count of the events since 1 September 2026, `pg_sleep(3)` | | |
| 0.5 s | | `DROP TABLE order_events_2024_12` waits for ACCESS EXCLUSIVE | |
| 1.0 s | | | waits for ACCESS SHARE, queued behind session 2 |
| 3.0 s | `COMMIT` | done at 3.04 s | answered at 3.05 s, after 2.04 s of waiting |

With `ALTER TABLE order_events DETACH PARTITION order_events_2025_01 CONCURRENTLY` as session 2 instead, the report was answered in 0.05 s. The detach waited for session 1 (`pg_stat_activity` showed it waiting on `Lock/virtualxid`) and finished at 3.05 s.

**The foreign key to `orders`.** A detached partition keeps its own copy of the foreign key, and the remaining locks land there. With a 3-second query reading `orders`, `DROP TABLE` of the detached `order_events_2025_02` waited 2.55 s for ACCESS EXCLUSIVE on `orders`, and an order page's `SELECT status FROM orders WHERE id = 42` queued behind it for 2.05 s. With a transaction holding an update on `orders`, the concurrent detach of the next month waited 2.53 s for SHARE ROW EXCLUSIVE, and another `UPDATE orders` queued behind it for 2.03 s. Dropping the foreign key first doesn't help, since `ALTER TABLE … DROP CONSTRAINT` also takes ACCESS EXCLUSIVE on `orders`. The usual defence is a short `lock_timeout` on the retention job: with `SET lock_timeout = '100ms'` the same `DROP TABLE` gave up after 0.14 s (`canceling statement due to lock timeout`), the order page was answered in 0.03 s, and the job can try again later. The other option is to leave the foreign key off a high-volume event table and check the reference in the application.

`DETACH … CONCURRENTLY` runs as two transactions: the first marks the partition as being detached and commits, the command then waits for every transaction that is using the partitioned table, and the second completes the detach. It can't run inside a transaction block, it isn't allowed while the table has a default partition, and it leaves a `CHECK` constraint that repeats the old bounds on the detached table (`\d order_events_2025_08` showed it). If it's interrupted, `DETACH PARTITION … FINALIZE` completes it. The gap between detach and drop is a good moment to archive the month with `COPY` or `pg_dump`.

For Acme's first run, the ten months before October 2025 took 20 statements: 38 ms and 159 kB of WAL in all (1,871 records, no full-page images), no dead rows and nothing to vacuum. Their 67 MB of files (37 MB of heap, 30 MB of indexes) were freed as each `DROP` committed, and the database went from 469 MB to 402 MB. The `DELETE` and its VACUUM had done the same job with 87 MB of WAL and left an 86 MB file.

**Partitions ahead of time.** `order_events_2026_11` and `order_events_2026_12` exist before their first row. Since `CREATE TABLE … PARTITION OF` takes ACCESS EXCLUSIVE on the parent, create them at a quiet moment, or create the table on its own, add a `CHECK` constraint that matches the bounds and attach it with ATTACH PARTITION, which needs only SHARE UPDATE EXCLUSIVE; give either a short `lock_timeout`. pg_partman 5.5.0 (July 2026) automates both chores: `create_parent()` keeps four future partitions by default (`p_premake`), the `retention` column of `part_config` holds the period to keep (`'12 months'`), and maintenance runs from its background worker, hourly by default, or from `run_maintenance_proc()` under a scheduler such as pg_cron. Two of its defaults deserve a look: `create_parent()` also creates a default partition, which rules out `DETACH … CONCURRENTLY`, and retention only detaches old partitions unless `retention_keep_table` is set to false.

## Try it

The sample data comes from [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop), a script that builds the template database `acme` on PostgreSQL 18 in about a minute.

Run this with psql on a fresh copy of it; `\gexec` runs each generated statement on its own, which `DETACH … CONCURRENTLY` needs. The comments show the key lines of the output.

```sql
-- CREATE DATABASE partitioning_try TEMPLATE acme;   -- then connect to partitioning_try

-- 1. One table: a week of events reads every page
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM order_events
WHERE happened_at >= '2026-08-31' AND happened_at < '2026-09-07';
-- Parallel Seq Scan on order_events   Rows Removed by Filter: 494531   (per process, x 3)
--   Buffers: shared read=11030

-- 2. The retention DELETE, rolled back so that the rows stay for step 3
BEGIN;
EXPLAIN (ANALYZE, WAL) DELETE FROM order_events WHERE happened_at < '2025-10-01';
-- Delete on order_events   WAL: records=639726 fpi=4704 bytes=73066260
--   ->  Seq Scan on order_events (actual rows=639726.00)
ROLLBACK;

-- 3. Partition by month and move the rows in
ALTER TABLE order_events RENAME TO order_events_old;
ALTER INDEX order_events_pkey RENAME TO order_events_old_pkey;
CREATE TABLE order_events (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  order_id    bigint NOT NULL REFERENCES orders (id),
  kind        text NOT NULL,
  happened_at timestamptz NOT NULL,
  PRIMARY KEY (id, happened_at)                  -- must include the partition key
) PARTITION BY RANGE (happened_at);
SELECT format('CREATE TABLE order_events_%s PARTITION OF order_events FOR VALUES FROM (%L) TO (%L)',
              to_char(m, 'YYYY_MM'), m::date, (m + interval '1 month')::date)
FROM generate_series(timestamptz '2024-12-01', '2026-12-01', interval '1 month') AS m \gexec
-- CREATE TABLE, 25 times: order_events_2024_12 ... order_events_2026_12
INSERT INTO order_events OVERRIDING SYSTEM VALUE SELECT * FROM order_events_old;
-- INSERT 0 1500000
SELECT setval(pg_get_serial_sequence('order_events', 'id'), 1500000);
CREATE INDEX ON order_events (order_id);
ANALYZE order_events;

-- 4. The same week reads two partitions
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM order_events
WHERE happened_at >= '2026-08-31' AND happened_at < '2026-09-07';
-- Append (actual rows=16408.00)   Buffers: shared hit=1052
--   ->  Seq Scan on order_events_2026_08 order_events_1   Rows Removed by Filter: 70314   Buffers: shared hit=535
--   ->  Seq Scan on order_events_2026_09 order_events_2   Rows Removed by Filter: 56250   Buffers: shared hit=517

INSERT INTO order_events VALUES (DEFAULT, 500000, 'delivered', '2026-10-06 09:30')
RETURNING tableoid::regclass;
-- order_events_2026_10

-- 5. Retention: detach and drop every month before October 2025, one statement at a time
SELECT format('ALTER TABLE order_events DETACH PARTITION %I CONCURRENTLY', inhrelid::regclass),
       format('DROP TABLE %I', inhrelid::regclass)
FROM pg_inherits
WHERE inhparent = 'order_events'::regclass AND inhrelid::regclass::text < 'order_events_2025_10'
ORDER BY 1 \gexec
-- ALTER TABLE and DROP TABLE, 10 times each: order_events_2024_12 ... order_events_2025_09
SELECT count(*) FROM order_events;
-- 860275
```

The number of full-page images in step 2 depends on when the last checkpoint ran: only a page's first change after a checkpoint logs the whole page. If no checkpoint has run since the copy was made, `fpi` can be 0 and `bytes` about half (34,545,204 in one such run).

## When to use it

- **Large tables with a time-based lifecycle:** events, logs, metrics and audit trails, where old data leaves in whole periods and most queries name a time range. The PostgreSQL documentation's rule of thumb is that partitioning pays off once the table would otherwise be larger than the server's memory.
- **Loading and archiving by period:** load a month into a table of its own, check it, then attach it; detach a month to archive it.
- **Reports that read a large share of a period:** a month's report reads one partition. A narrow, selective lookup is served better by an index: a [B-tree](../b-tree-index/) on `happened_at` read 170 pages for the week, against 1,052 for two partitions, and BRIN suits time-ordered tables ([index types](../index-types/)).
- **Not to spread load over several machines.** All partitions live in the same database on the same server and share its CPU, memory, disk and WAL. Spreading rows over servers is [sharding](../sharding/), done in the application or with an extension such as Citus; a partition can also be a foreign table on another server through `postgres_fdw`, one of the building blocks for that.
- **Not when most queries filter on something else.** Every query that doesn't name the key searches every partition. And when only a few thousand rows leave each day, a `DELETE` in batches with a well-tuned autovacuum may be simpler than keeping partitions; batches spread the WAL and the locks, they don't reduce them.

Choose the width of a partition from how data leaves and how it is queried. The counts on Acme's data, timed on the same query with no partition key in it, with the primary key and the `order_id` index in every layout (median of seven runs):

| Layout | Partitions | Rows each | Planning time |
|---|---|---|---|
| One table | 1 | 1,500,000 | 0.02 ms |
| Monthly, after retention | 15 | about 70,000 | 0.10 ms |
| Daily, twelve months | 368 | about 2,300 | 4.0 ms, and 23 ms on the first run in a new session |

The documentation warns in both directions. Too few partitions leave large indexes and poor locality of data; too many make planning slower and use more memory, because every session loads the metadata of each partition it touches. Hierarchies of up to a few thousand partitions are handled fairly well when typical queries prune all but a few. The daily table's query also held 1,107 locks until it finished: three for the parent and for every partition, on the table and its two indexes.

## Trade-offs

- **Retention and bulk changes get cheap.** Dropping a month removes files instead of rows: 38 ms and 159 kB of WAL for ten months here, against a `DELETE`, a WAL record for every row and a VACUUM.
- **Keys must contain the partition key.** Every unique constraint has to include `happened_at`, so `id` on its own can't be declared unique, and neither can any other column or set of columns without it.
- **Queries without the key pay for every partition.** `WHERE order_id = 250000` ran 13 index scans and 2 scans of empty partitions, 28 pages against 5 with the same index on one table, and planning time grows with the number of partitions left after pruning.
- **More to operate.** Partitions must exist before their rows arrive, the parent needs a manual `ANALYZE`, `CREATE TABLE … PARTITION OF`, `DROP TABLE` of a partition and a plain `DETACH` all take ACCESS EXCLUSIVE on the parent, and a foreign key adds locks on the referenced table when partitions are created, attached, detached, or dropped after a detach.
- **Many partitions cost memory and locks:** 1,107 locks for a query over 368 daily partitions and their indexes, and metadata cached by every session that touches them.
- **Migrating takes work.** Copying the 1,500,000 rows into the partitioned table took 8.3 s and wrote 298 MB of WAL here, and a busy table can't stop taking writes while that happens.

## Implementation notes

**Migrating an existing table.** There are two ways in.

- *Copy:* rename the old table, create the partitioned one, copy and switch, as in *Try it*. On a live system, writes that arrive during the copy have to be paused, or captured by a trigger or [change data capture](../change-data-capture/) and replayed before the switch. pg_partman's `partition_data_proc()` moves rows from a source table into the partitioned one in batches, committing after each.
- *Attach:* keep the old table and attach it whole as the partition for the past, `FOR VALUES FROM (MINVALUE) TO ('2026-10-01')`, then give the new months their own partitions. Add a `CHECK` constraint that matches the bound first, or ATTACH scans the whole table to validate it while holding ACCESS EXCLUSIVE on it, and build the indexes the parent expects (such as a unique index on `(id, happened_at)`) beforehand, or ATTACH builds them. The big partition is dropped in one go once all of it is past the retention period.

**MySQL 8.4** supports `RANGE`, `LIST`, `HASH` and `KEY` partitioning, the `RANGE COLUMNS` and `LIST COLUMNS` variants, and subpartitioning, in the InnoDB and NDB storage engines only. Its rule for unique keys is the same: every unique key, the primary key included, must use every column of the partitioning expression. Unlike PostgreSQL, partitioned InnoDB tables can't have foreign keys at all, in either direction. A table can have up to 8,192 partitions, subpartitions included. Retention is `ALTER TABLE … DROP PARTITION`, which removes the partition with its rows, and `ALTER TABLE … EXCHANGE PARTITION … WITH TABLE` swaps a partition with an ordinary table, for archiving. Pruning works on the partitioning columns directly and through `TO_DAYS()`, `TO_SECONDS()`, `YEAR()` and `UNIX_TIMESTAMP()`.

**SQL Server** separates the rules from the storage: a partition function defines the boundary values, and a partition scheme maps the partitions to filegroups. It supports up to 15,000 partitions. Old data leaves by switching a partition out into an archive table, or with `TRUNCATE TABLE … WITH (PARTITIONS (…))`.

**Amazon RDS and Aurora PostgreSQL** both support pg_partman and document running its maintenance with pg_cron.

**Amazon DynamoDB and Cassandra** use the word for something else. Their partition key decides which partition, and so which nodes, store an item, which is closer to sharding ([Amazon DynamoDB](../amazon-dynamodb/), [Cassandra](../cassandra/)). Time-based expiry is a time to live instead of a dropped partition: DynamoDB deletes expired items within a few days of their expiry time without consuming write throughput, and Cassandra's TimeWindowCompactionStrategy groups SSTables by time window so that a whole SSTable can be dropped once all of its data has expired.

**Lakehouse tables** in a [medallion architecture](../medallion-architecture/) apply the same idea to files: a table partitioned by date keeps each day's files apart, so a query engine can skip whole days, and old days are removed whole.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Sharding](../sharding/) — Split data horizontally across databases using a shard key.
- [Index Types](../index-types/) — Beyond B-trees: hash, GIN for arrays, JSON and text, GiST, BRIN for time-ordered data, and partial and expression indexes.
- [Query Execution Plans](../query-execution-plans/) — Read EXPLAIN the way the planner thinks: scans, joins, estimated against actual rows, and the statistics behind each choice.
- [MVCC](../mvcc/) — Multi-version concurrency control: an update writes a new row version, readers see a snapshot, and vacuum removes dead versions.
- [Write-Ahead Log](../write-ahead-log/) — Log each change before applying it, so a commit survives a crash, recovery replays the log, and replicas and backups follow it.
- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [Apache Cassandra](../cassandra/) — A wide-column database built for heavy writes across data centres: a token ring, tunable consistency and LSM storage.
- [Amazon DynamoDB](../amazon-dynamodb/) — A serverless key-value and document database: the partition key spreads items across partitions for single-digit-millisecond reads.
- [Medallion Architecture](../medallion-architecture/) — Bronze, silver, gold: raw data is refined in layers inside a lakehouse.

## References

- [PostgreSQL 18 documentation — Table Partitioning (declarative partitioning, pruning, maintenance, best practices)](https://www.postgresql.org/docs/18/ddl-partitioning.html)
- [PostgreSQL 18 documentation — ALTER TABLE (ATTACH PARTITION, DETACH PARTITION … CONCURRENTLY)](https://www.postgresql.org/docs/18/sql-altertable.html)
- [PostgreSQL 18 documentation — Query Planning (enable_partition_pruning, enable_partitionwise_join, enable_partitionwise_aggregate)](https://www.postgresql.org/docs/18/runtime-config-query.html)
- [PostgreSQL 18 documentation — Routine Vacuuming (autovacuum and partitioned tables)](https://www.postgresql.org/docs/18/routine-vacuuming.html)
- [PostgreSQL 18 release notes](https://www.postgresql.org/docs/18/release-18.html)
- [pg_partman 5.5.0 documentation](https://github.com/pgpartman/pg_partman/blob/v5.5.0/doc/pg_partman.md)
- [Amazon RDS User Guide — Managing PostgreSQL partitions with the pg_partman extension](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL_Partitions.html)
- [MySQL 8.4 Reference Manual — Partitioning](https://dev.mysql.com/doc/refman/8.4/en/partitioning.html)
- [MySQL 8.4 Reference Manual — Partitioning Keys, Primary Keys, and Unique Keys](https://dev.mysql.com/doc/refman/8.4/en/partitioning-limitations-partitioning-keys-unique-keys.html)
- [MySQL 8.4 Reference Manual — Restrictions and Limitations on Partitioning](https://dev.mysql.com/doc/refman/8.4/en/partitioning-limitations.html)
- [Microsoft Learn — Partitioned tables and indexes (SQL Server)](https://learn.microsoft.com/en-us/sql/relational-databases/partitions/partitioned-tables-and-indexes)
- [Amazon DynamoDB Developer Guide — Using time to live (TTL)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)
- [Apache Cassandra documentation — Time Window Compaction Strategy](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/compaction/twcs.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
