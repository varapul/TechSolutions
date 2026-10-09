
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗃️ Database Internals & Performance](../../README.md#database-internals--performance)

# Write-Ahead Log

> Log each change before applying it, so a commit survives a crash, recovery replays the log, and replicas and backups follow it.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Write-Ahead Log" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/write-ahead-log.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · No log: force every page** | Acme Shop's checkout commits order 500001 for customer 42: one row in `orders` and two in `order_items`. That changes **8 pages in 7 files**: two heap pages and two index leaves for the new rows, the identity sequence, and three parent pages whose rows the foreign-key checks lock. If COMMIT had to write them itself, every commit would wait for scattered 8 kB writes and an fsync per file (a checkpoint that wrote one such order's pages took 6–7 ms), and a crash part-way could leave the items on disk without their order, or a **torn page**, half new and half old. |
| **2 · Log first, pages later** | PostgreSQL logs first: each change appends a **WAL record** to the WAL buffers and stamps the page with the record's **LSN**, its byte position in the log. COMMIT adds a commit record and waits only until the WAL is flushed up to it: 12 records, 41,268 bytes and one fdatasync, 0.37 ms in one run on a laptop. The 8 pages stay dirty in shared buffers until the background writer or the next checkpoint writes them, and because a CHECKPOINT (redo point 0/76000028) had just run, 7 of the 12 records carry a **full-page image** of the page they change. |
| **3 · Replay after a crash** | We killed the server 2 seconds after the commit, before any of the 8 pages had reached disk. On restart it read the last checkpoint from `pg_control` and replayed the WAL from the redo point 0/76000028 to its end, restoring each page from its image and reapplying the rest: order 500001 was back, and an end-of-recovery checkpoint wrote the pages. The same WAL streams to a **standby**, which had replayed the commit 1.6 ms after the flush, goes to an **archive** for point-in-time recovery, and feeds **logical decoding** for [change data capture](../change-data-capture/). |
| **4 · What durability costs** | Each commit waits for its WAL flush: one client managed about 2,200 orders a second with `synchronous_commit = on` and 3,400 with `off`, which can lose the last few hundred milliseconds of commits in a crash but never corrupts the data; with 8 clients, one fsync served 2.8 commits on average. Page images make the first change to each page after a checkpoint expensive (41,268 bytes of WAL for the first order, 742 for the next), so checkpoints are spaced minutes apart and their writes spread over 90% of the interval. MySQL's InnoDB does the same jobs with its **redo log** and a **doublewrite buffer** that keeps a copy of each page before writing it in place. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's checkout writes an order in one transaction:

```sql
BEGIN;
INSERT INTO orders (customer_id, status, shipping_country, created_at, total_thb)
VALUES (42, 'pending', 'TH', now(), 20491.28);                   -- order 500001
INSERT INTO order_items (order_id, line_no, product_id, qty, price_thb)
VALUES (500001, 1, 42, 1, 5290.92), (500001, 2, 128, 2, 7600.18);
COMMIT;
```

Once COMMIT returns, the customer sees "order placed", so the order has to survive a crash that comes a millisecond later. On [PostgreSQL](../postgresql/) 18.6 with the sample data, this transaction changed eight 8 kB pages in seven files: the last heap page of `orders` (block 5057) and of `order_items` (block 10416), the rightmost leaf of each primary key, the page of the identity sequence, and, less obviously, block 0 of `customers` and blocks 0 and 1 of `products`. Each foreign-key check locks the parent row it finds, and a row lock is a change to that row's page.

The direct way to make the commit durable is to write those eight pages to their files and fsync each file before COMMIT returns. That fails twice over:

- **It is slow.** Every commit waits for writes scattered over seven files and an fsync per file, and two orders that touch the same page write it twice. In our runs, a checkpoint that wrote just the pages of one such order took 6–7 ms; the commit below takes 0.37 ms.
- **It isn't atomic.** A crash between the writes leaves the items on disk without their order. A crash during a write is worse: PostgreSQL writes 8 kB pages, but a disk only writes whole sectors (the documentation's example is 512 bytes), so a power failure can leave a page *torn*, part new and part old, and nothing on disk can put it back together.

## How it works

The numbers below come from one run on a laptop: a throwaway PostgreSQL 18.6 server in Docker, loaded with the same sample data so that it could be crashed, plus short pgbench runs against it. The *Try it* script repeats the logging part on a copy of the sample data.

**Log first.** The rule fits in one line: a change may reach the data files only after the log records describing it are on stable storage. PostgreSQL enforces it page by page. Each page header holds the LSN of the last WAL record that changed the page, and before the buffer manager writes a dirty page it flushes the WAL at least up to that LSN. With the log in place, COMMIT doesn't have to write any data page, and dirty pages can be written whenever it suits the server: the *no-force* and *steal* buffer policies that ARIES (Mohan et al., ACM TODS, 1992), the classic description of WAL-based recovery, is designed around.

**Records, LSNs and segments.** Each change appends a record to the WAL buffers in shared memory: 8 MB here, which is 1/32 of `shared_buffers` by default, capped at one segment. An LSN is a 64-bit byte position in the log, printed as two hexadecimal halves (0/7600C2E0), and subtracting two LSNs gives the bytes between them. On disk the log is a series of 16 MB segment files in `pg_wal`, each made of 8 kB pages and named in sequence: `pg_walfile_name('0/7600C308')` is `000000010000000000000076`. Every record carries a CRC-32C. Our order wrote 12 records, read back with `pg_walinspect`:

| LSN | Record | Page | Page image |
|---|---|---|---|
| 0/76002130 | Sequence LOG | `orders_id_seq` block 0 | – |
| 0/76002198 | Heap INSERT (5057,91) | `orders` block 5057 | 7,516 B |
| 0/76003F30 | Btree INSERT_LEAF | `orders_pkey` block 1373 | 940 B |
| 0/76004330 | Heap LOCK, customer 42 (FK check) | `customers` block 0 | 8,172 B |
| 0/76006370 | Heap INSERT (10416,81) | `order_items` block 10416 | 5,532 B |
| 0/76007948 | Btree INSERT_LEAF | `order_items_pkey` block 4812 | 2,056 B |
| 0/760081A0 | Heap INSERT (10416,82) | `order_items` block 10416 | – |
| 0/76008200 | Btree INSERT_LEAF | `order_items_pkey` block 4812 | – |
| 0/76008248 | Heap LOCK, order 500001 (FK check) | `orders` block 5057 | – |
| 0/76008280 | Heap LOCK, product 42 (FK check) | `products` block 0 | 8,156 B |
| 0/7600A2B0 | Heap LOCK, product 128 (FK check) | `products` block 1 | 8,156 B |
| 0/7600C2E0 | Transaction COMMIT | – | – |

**COMMIT waits for one flush.** Until COMMIT, the records sat in memory: the insert position had reached 0/7600C2E0 while the flush position was still 0/76000130. COMMIT appended its 34-byte record and flushed the WAL up to its end, 0/7600C308, with one write and one `fdatasync` (the default `wal_sync_method` on Linux). By `pg_stat_get_backend_io()`, the `fdatasync` took 0.23 ms of the commit's 0.37 ms. The log is written sequentially, and when several sessions commit at once, one flush covers every commit record already in the buffers (group commit).

**Pages later.** The eight pages stayed dirty in shared buffers. On disk, block 5057 of `orders` still held 90 rows and page LSN 0/64A3FE20; in memory it held 91 rows and LSN 0/76008280. The background writer writes some dirty pages ahead of demand, and the checkpointer writes all of them at every checkpoint. Until then a page can take many more changes and still be written once.

**Checkpoints and full-page images.** A checkpoint writes every dirty page and then logs a checkpoint record whose *redo point* is where crash recovery will start; older WAL is no longer needed for recovery. Because a page write can tear, the first change to each page after a checkpoint logs an image of the whole page (`full_page_writes = on`), and replay restores that image instead of patching a page that may be half written. Our `CHECKPOINT` (redo point 0/76000028) ran about a second before the order, so 7 of the 12 records carried images: 41,268 bytes in all. The next order, on the same pages, wrote 11 records and 742 bytes. Since PostgreSQL 18, `initdb` enables data checksums by default, and with checksums even the first hint-bit change to a page after a checkpoint logs an image (`FPI_FOR_HINT`): an 8 kB one, for a catalog page the session had just read, sits right before our order in the log.

**Crash recovery.** We killed the server with `docker kill` (SIGKILL) two seconds after the commit, before any of the eight pages had been written. On restart it found the last checkpoint through `pg_control`, logged `redo starts at 0/76000028`, replayed every record to the end of the valid WAL (`redo done at 0/7600D630`, elapsed 0.00 s), ran an end-of-recovery checkpoint that wrote 13 buffers in 7 ms, and accepted connections. Order 500001 and its two items were there, and block 5057 on disk now held 91 rows with LSN 0/76008280. Replay compares each record's LSN with the page's LSN and skips changes the page already has. There is no undo pass: a transaction whose commit record never reached the WAL counts as aborted, and [MVCC](../mvcc/) never shows its row versions. ARIES instead repeats history in a redo pass and then rolls back the unfinished transactions, logging compensation records as it goes. Either way, recovery time grows with the WAL written since the last redo point, which is what the checkpoint settings bound.

**One log, several readers.** The same records leave the server three ways:

- **Streaming replication.** A standby connects, receives the records as they are written and replays them; ours reported `replay_lsn` 0/7600C308 1.6 ms after the commit's flush. Replication is asynchronous by default; name a standby in `synchronous_standby_names` and COMMIT waits for it as well ([read replicas](../read-replicas/)).
- **Archiving and point-in-time recovery.** `archive_command` copies each completed segment elsewhere; ours copied `…076` once `pg_switch_wal()` closed it. A base backup plus the archived WAL can be replayed up to any moment, for example the minute before a bad `DELETE` ([disaster recovery strategies](../disaster-recovery-strategies/)).
- **Logical decoding.** With `wal_level = logical`, a replication slot decodes the same WAL into row changes, which is how Debezium publishes them to [Kafka](../kafka/) for [change data capture](../change-data-capture/).

The log is the record of truth and the tables are its materialised result, an idea [event sourcing](../event-sourcing/) applies at the application level. Log-structured stores keep the same discipline: [Cassandra](../cassandra/) appends each write to its commit log before the memtable ([LSM tree vs B-tree](../lsm-tree/)).

## Try it

The sample data comes from [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop), a script that builds the template database `acme` on PostgreSQL 18 in about a minute.

Run it in `psql` as a superuser (for `pg_walinspect`, `CHECKPOINT` and `pg_read_binary_file`) on a fresh copy of the sample data; your LSNs will differ, the counts and sizes should not.

```sql
-- CREATE DATABASE wal_try TEMPLATE acme STRATEGY FILE_COPY;   -- then connect to wal_try
CREATE EXTENSION pg_walinspect;
CREATE EXTENSION pageinspect;

CHECKPOINT;                                     -- start a fresh checkpoint cycle
SELECT pg_current_wal_insert_lsn() AS before \gset

BEGIN;
INSERT INTO orders (customer_id, status, shipping_country, created_at, total_thb)
VALUES (42, 'pending', 'TH', now(), 20491.28) RETURNING id, ctid;
-- 500001 | (5057,91)
INSERT INTO order_items (order_id, line_no, product_id, qty, price_thb)
VALUES (500001, 1, 42, 1, 5290.92), (500001, 2, 128, 2, 7600.18);
SELECT pg_current_xact_id() AS xid, pg_current_wal_insert_lsn() AS inserted,
       pg_current_wal_flush_lsn() AS flushed \gset
\echo inserted :inserted flushed :flushed
-- inserted 3/B8682330 flushed 3/B8678180: the records are still in the WAL buffers
COMMIT;
SELECT pg_current_wal_flush_lsn() AS after \gset

SELECT record_type, pg_filenode_relation(0, relfilenode) AS rel,
       relblocknumber AS block, block_fpi_length AS page_image
FROM pg_get_wal_block_info(:'before', :'after') WHERE xid = :'xid';
-- LOG         | orders_id_seq    |     0 |    0
-- INSERT      | orders           |  5057 | 7516
-- INSERT_LEAF | orders_pkey      |  1373 |  940
-- LOCK        | customers        |     0 | 8172   the FK check locks customer 42
-- INSERT      | order_items      | 10416 | 5532
-- INSERT_LEAF | order_items_pkey |  4812 | 2056
-- INSERT      | order_items      | 10416 |    0
-- INSERT_LEAF | order_items_pkey |  4812 |    0
-- LOCK        | orders           |  5057 |    0
-- LOCK        | products         |     0 | 8156
-- LOCK        | products         |     1 | 8156   (the COMMIT record has no block)

SELECT count(*) AS records, count(*) FILTER (WHERE fpi_length > 0) AS page_images,
       sum(record_length) AS bytes
FROM pg_get_wal_records_info(:'before', :'after') WHERE xid = :'xid';
-- 12 | 7 | 41268

-- COMMIT flushed the log, not the table: page 5057 in memory and in the file
SELECT (lower - 24) / 4 AS rows_in_memory FROM page_header(get_raw_page('orders', 5057));
-- 91
SELECT (get_byte(p, 12) + 256 * get_byte(p, 13) - 24) / 4 AS rows_on_disk
FROM pg_read_binary_file(pg_relation_filepath('orders'), 5057 * 8192, 16) AS p;
-- 90   (pd_lower read from the file, little-endian; until the next checkpoint)

-- the next order changes the same pages, which already have their images
SELECT pg_current_wal_insert_lsn() AS before \gset
BEGIN;
INSERT INTO orders (customer_id, status, shipping_country, created_at, total_thb)
VALUES (42, 'pending', 'TH', now(), 20491.28) RETURNING id;     -- 500002
INSERT INTO order_items (order_id, line_no, product_id, qty, price_thb)
VALUES (500002, 1, 42, 1, 5290.92), (500002, 2, 128, 2, 7600.18);
SELECT pg_current_xact_id() AS xid \gset
COMMIT;
SELECT pg_current_wal_flush_lsn() AS after \gset
SELECT count(*) AS records, count(*) FILTER (WHERE fpi_length > 0) AS page_images,
       sum(record_length) AS bytes
FROM pg_get_wal_records_info(:'before', :'after') WHERE xid = :'xid';
-- 11 | 0 | 742

CHECKPOINT;                                     -- now the pages go to disk
SELECT (get_byte(p, 12) + 256 * get_byte(p, 13) - 24) / 4 AS rows_on_disk
FROM pg_read_binary_file(pg_relation_filepath('orders'), 5057 * 8192, 16) AS p;
-- 92
```

## When to use it

PostgreSQL always writes the WAL; what you decide is how it is tuned and who else reads it.

- **Keep `synchronous_commit = on` for orders and payments.** Turn it off per transaction (`SET LOCAL synchronous_commit = off`) or per role for data you can afford to lose a fraction of a second of, such as clickstream events: a crash loses at most about three `wal_writer_delay` intervals (600 ms by default) of commits, and the database stays consistent.
- **Never set `fsync = off`** outside a cluster you can rebuild from scratch, and turn `full_page_writes` off only where the file system rules out partial page writes (the documentation names ZFS).
- **Let time, not WAL volume, trigger checkpoints.** Raise `max_wal_size` until the `checkpoint_warning` messages stop, and choose `checkpoint_timeout` by how long a crash recovery may take.
- **Archive the WAL** if you need point-in-time recovery. A streaming replica doesn't protect you from a bad `DELETE`: it replays it.
- **Put `pg_wal` on low-latency storage that honours flushes**, because its flush time is your commit time. The documentation warns about drives that report writes as done while they are still in a volatile cache.
- **Watch it:** `pg_stat_wal` (records, page images, bytes), `pg_stat_io` rows for `wal`, `pg_stat_checkpointer`, `pg_stat_archiver`, `pg_stat_replication` and `pg_replication_slots`.

## Trade-offs

- **Commit latency is a WAL flush.** One client managed about 2,200 orders a second with `synchronous_commit = on`, one fsync per commit, and 3,400 with `off`, in two 10-second pgbench runs each on a laptop. With 8 clients, 79,562 commits needed 28,654 fsyncs: one flush served 2.8 commits on average. The slower the storage flushes, the wider the gap.
- **Everything is written twice**, once to the WAL and later to the data file, and every index adds its own records: [B-tree index](../b-tree-index/) measured 8.5 MB of WAL for 50,000 inserts with one index and 15.6 MB with three.
- **Page images after every checkpoint.** In the first 10 s after a `CHECKPOINT`, pgbench orders averaged 1,162 bytes of WAL, 36% of it page images (1,238 of them, nearly all of `customers` and `products` pages that only the foreign-key locks had touched); in the next 10 s they averaged 740 bytes. Vacuum pays the same way: the first autovacuum after those runs marked the old pages of `orders` and `order_items` all-visible and logged 126 MB of page images. `wal_compression` (`pglz`, `lz4` or `zstd`) shrinks the images for some CPU.
- **Checkpoint I/O.** A checkpoint writes every dirty page, so it paces the writes to finish at 90% of the interval (`checkpoint_completion_target = 0.9`). One timed checkpoint in our runs wrote 19,880 buffers, 60.7% of shared buffers, over 270 seconds. More frequent checkpoints shorten recovery but bring more page images and more writes.
- **Disk to watch.** `pg_wal` keeps a segment until recovery no longer needs it, the archiver has copied it and every replication slot has consumed it, so a failing `archive_command` or an abandoned slot fills the disk; `max_slot_wal_keep_size` caps what slots may hold.

## Implementation notes

**Reading the log.** `pg_walinspect` (`pg_get_wal_records_info`, `pg_get_wal_block_info`, `pg_get_wal_stats`) reads records from SQL and, by default, only superusers and members of `pg_read_server_files` may call it; `pg_waldump` reads the segment files directly and must run as the server's operating-system user. PostgreSQL 18 reports WAL writes and fsyncs in `pg_stat_io` (with their times when `track_wal_io_timing` is on) and per backend through `pg_stat_get_backend_wal()` and `pg_stat_get_backend_io()`; `pg_stat_wal` lost its write and sync columns in 18. One side effect of logging ahead: a sequence logs 32 values beyond the one it hands out, so after our crash the next order id was 500034, not 500002. Gaps in sequences are normal.

**MySQL (InnoDB, 8.4)** splits the same jobs differently. Its **redo log** is replayed at startup after a crash; `innodb_redo_log_capacity` sets its size, 100 MB by default in 32 files under `#innodb_redo` (defaults read from a MySQL 8.4.11 server). `innodb_flush_log_at_trx_commit = 1`, the default, writes and flushes the log at every commit; with 2 the log is written at commit and flushed about once a second, with 0 both happen about once a second, and a crash can lose about a second of commits. Torn pages are handled by the **doublewrite buffer** (`innodb_doublewrite = ON`): InnoDB writes pages to doublewrite files first, in large sequential batches, and only then to their places, so recovery can take a clean copy of a page that a crash tore, where PostgreSQL uses the page image in its WAL. After the redo, InnoDB rolls back transactions that were still active, using its undo logs. Replication and point-in-time recovery read a separate log, the **binary log**, which the server keeps consistent with the redo log through a two-phase commit (`sync_binlog = 1` flushes it at every commit).

**SQL Server** also uses a write-ahead transaction log. Its **delayed durability** (`ALTER DATABASE … SET DELAYED_DURABILITY = ALLOWED` or `FORCED`, `DISABLED` by default) is the counterpart of `synchronous_commit = off`: commit returns before the log records reach disk, and they are written when the log buffer fills, when a fully durable transaction commits or when `sys.sp_flush_log` runs.

**SQLite** in WAL mode (`PRAGMA journal_mode = WAL`) appends changes to a separate `-wal` file and copies them into the database file at checkpoints. With `PRAGMA synchronous = NORMAL` it stays consistent after a power loss but may lose the last commits.

**Amazon Aurora** pushes redo processing down into its storage service: the database instance sends log records, and storage nodes spread across three Availability Zones build the pages from them, which cuts network traffic and makes crash recovery fast ([Amazon RDS & Aurora](../amazon-rds-aurora/)).

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Read Replicas](../read-replicas/) — Send writes to the primary and spread reads across asynchronously updated replicas.
- [Change Data Capture (CDC)](../change-data-capture/) — Stream every committed change from the database log to other systems.
- [Disaster Recovery Strategies](../disaster-recovery-strategies/) — Backup & restore, pilot light, warm standby, active-active: trading cost against RTO and RPO.
- [MVCC](../mvcc/) — Multi-version concurrency control: an update writes a new row version, readers see a snapshot, and vacuum removes dead versions.
- [LSM Tree vs B-Tree](../lsm-tree/) — Two storage engine designs: update pages in place, or append in memory and merge sorted files, and what each costs to read and write.
- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [Amazon RDS & Aurora](../amazon-rds-aurora/) — Managed relational databases: backups, Multi-AZ failover and read replicas, and Aurora's storage shared across three zones.
- [Event Sourcing](../event-sourcing/) — Store every change as an immutable event and rebuild state by replaying them.

## References

- [PostgreSQL 18 documentation — Write-Ahead Logging (WAL)](https://www.postgresql.org/docs/18/wal-intro.html)
- [PostgreSQL 18 documentation — Reliability (torn pages, full-page images, CRCs)](https://www.postgresql.org/docs/18/wal-reliability.html)
- [PostgreSQL 18 documentation — Asynchronous Commit](https://www.postgresql.org/docs/18/wal-async-commit.html)
- [PostgreSQL 18 documentation — WAL Configuration (checkpoints, group commit)](https://www.postgresql.org/docs/18/wal-configuration.html)
- [PostgreSQL 18 documentation — WAL Internals (LSNs, segments, pg_control)](https://www.postgresql.org/docs/18/wal-internals.html)
- [PostgreSQL 18 documentation — Server Configuration: Write Ahead Log](https://www.postgresql.org/docs/18/runtime-config-wal.html)
- [PostgreSQL 18 documentation — Resource Consumption (the background writer)](https://www.postgresql.org/docs/18/runtime-config-resource.html)
- [PostgreSQL 18 documentation — Continuous Archiving and Point-in-Time Recovery (PITR)](https://www.postgresql.org/docs/18/continuous-archiving.html)
- [PostgreSQL 18 documentation — Log-Shipping Standby Servers](https://www.postgresql.org/docs/18/warm-standby.html)
- [PostgreSQL 18 documentation — Logical Decoding Concepts](https://www.postgresql.org/docs/18/logicaldecoding-explanation.html)
- [PostgreSQL 18 documentation — pg_walinspect](https://www.postgresql.org/docs/18/pgwalinspect.html)
- [PostgreSQL 18 documentation — Release 18 (data checksums by default, WAL rows in pg_stat_io)](https://www.postgresql.org/docs/18/release-18.html)
- [PostgreSQL source — access/transam README, Write-Ahead Log Coding (REL_18_STABLE)](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/access/transam/README)
- [C. Mohan, D. Haderle, B. Lindsay, H. Pirahesh and P. Schwarz — ARIES: A Transaction Recovery Method Supporting Fine-Granularity Locking and Partial Rollbacks Using Write-Ahead Logging (ACM TODS, 1992)](https://dl.acm.org/doi/10.1145/128765.128770)
- [MySQL 8.4 Reference Manual — Redo Log](https://dev.mysql.com/doc/refman/8.4/en/innodb-redo-log.html)
- [MySQL 8.4 Reference Manual — Doublewrite Buffer](https://dev.mysql.com/doc/refman/8.4/en/innodb-doublewrite-buffer.html)
- [MySQL 8.4 Reference Manual — InnoDB Startup Options and System Variables (innodb_flush_log_at_trx_commit)](https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html)
- [MySQL 8.4 Reference Manual — InnoDB Recovery](https://dev.mysql.com/doc/refman/8.4/en/innodb-recovery.html)
- [MySQL 8.4 Reference Manual — The Binary Log](https://dev.mysql.com/doc/refman/8.4/en/binary-log.html)
- [Microsoft Learn — SQL Server transaction log architecture and management guide](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-log-architecture-and-management-guide)
- [Microsoft Learn — Control transaction durability (SQL Server)](https://learn.microsoft.com/en-us/sql/relational-databases/logs/control-transaction-durability)
- [SQLite — Write-Ahead Logging](https://www.sqlite.org/wal.html)
- [SQLite — PRAGMA synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous)
- [Alexandre Verbitski et al. — Amazon Aurora: Design Considerations for High Throughput Cloud-Native Relational Databases (SIGMOD 2017)](https://www.amazon.science/publications/amazon-aurora-design-considerations-for-high-throughput-cloud-native-relational-databases)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
