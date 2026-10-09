
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗃️ Database Internals & Performance](../../README.md#database-internals--performance)

# MVCC

> Multi-version concurrency control: an update writes a new row version, readers see a snapshot, and vacuum removes dead versions.

<p align="center"><img src="diagram.svg" alt="Animated diagram: MVCC" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/mvcc.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Locks: readers vs writers** | Acme's nightly report must not see orders change halfway through, and without row versions the only way to promise that is to lock what it reads: here it takes `LOCK TABLE orders IN SHARE MODE`. It first waited 1.5 s for a writer's open transaction, then held the lock, so support's cancel of order 495179 waited until `lock_timeout` (5 s) ended it with `ERROR: 55P03: canceling statement due to lock timeout`. InnoDB at `SERIALIZABLE` does the same by itself: the same report took 502,025 shared record locks, and the cancel failed with `ERROR 1205`. |
| **2 · Row versions & snapshots** | On PostgreSQL 18.6 the report runs at `REPEATABLE READ` with snapshot `165806:165806:` and takes no row locks. The writer, transaction 165806, cancels order 495179: page 2392 had 48 bytes free, so the new version went to page 5057 as line pointer 91 (`xmin` 165806), the old one got `xmax` 165806 and a `t_ctid` pointing to `(5057,91)`, and `orders_pkey` got a second entry. The report keeps reading `delivered`, because 165806 is too new for its snapshot, while the writer's next statement reads `cancelled`; nobody waited. |
| **3 · VACUUM and the horizon** | The night goes on: 3,000 more status changes, one transaction each, while the report stays open. `n_dead_tup` climbs to 3,001 and the heap grows from 5,058 to 5,087 pages, yet `VACUUM` removes nothing: *3001 are dead but not yet removable*, because the report's `backend_xmin` 165806 is the cutoff. After the report commits, `VACUUM` removes all 3,001 in 33 ms. Only 104 of the updates were HOT on these full pages, against 3,001 of 3,001 in the same run on a copy rewritten with `fillfactor = 90`. |
| **4 · Costs and other engines** | Dead versions hold space until `VACUUM` frees it for reuse, and autovacuum only starts on `orders` at 50 + 20 % of its rows: 100,050 dead rows. Transaction IDs are 32 bits, so `VACUUM` must also freeze old rows before the counter wraps around, and a forgotten open transaction holds all of this back until `idle_in_transaction_session_timeout` (off by default) ends it. InnoDB updates the row in place and keeps the old version in an undo log until purge (history list length 3,002 while the report was open, 0 after it), and Oracle rebuilds old versions from undo segments, failing a long query with `ORA-01555` once the undo it needs is overwritten. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's nightly report adds up the day's business: `SELECT status, count(*), sum(total_thb) FROM orders GROUP BY status`, then more queries by country, by product and by day, for minutes in all. Its numbers have to agree with each other, so it needs the whole of `orders` to stand still while it reads. The shop doesn't stop at night, though. Support cancels orders, payments clear, couriers deliver, and every one of those is an `UPDATE` on the same table.

If each row exists only once, the only way to hold it still is to lock it. A reader takes shared locks on what it reads and keeps them until it commits, and a writer needs an exclusive lock that conflicts with them. The diagram's first step runs that design on PostgreSQL 18.6, with the report taking the lock itself (`LOCK TABLE orders IN SHARE MODE`), and both directions hurt:

- **Writers block the report.** A writer had just moved order 497001 from `paid` to `shipped` and not yet committed. The report's lock request waited 1.5 s for it (`pg_blocking_pids()` named the writer, wait event `Lock: relation`).
- **The report blocks writers.** Once the report held its lock, support's cancel of order 495179 waited, and after 5 s `lock_timeout` ended it with `ERROR: 55P03: canceling statement due to lock timeout`. Without the timeout it would have waited until the report committed, minutes later, with every other change to `orders` queued behind it.

This is not just a PostgreSQL trick. InnoDB works this way at `SERIALIZABLE`: with autocommit off, it turns each plain `SELECT` into `SELECT ... FOR SHARE`. The same report on MySQL 8.4 held 502,025 shared record locks, and the same cancel failed after `innodb_lock_wait_timeout` (set to 5 s for the run; the default is 50) with `ERROR 1205 (HY000): Lock wait timeout exceeded`.

## How it works

Multiversion concurrency control keeps several versions of a row instead of one. A writer adds a new version and leaves the old one where it is, and each reader picks the version that was current when its snapshot was taken. Readers take no row locks, so, as the PostgreSQL manual puts it, reading never blocks writing and writing never blocks reading. The rest of this page shows how PostgreSQL stores the versions and how it gets rid of them; the [isolation levels](../isolation-levels/) page covers what the snapshots let transactions see.

### Row versions on a heap page

A PostgreSQL table, its *heap*, is a file of 8 kB pages. A page starts with a small header and an array of line pointers, 4 bytes each, growing forward; the row versions, called *tuples*, fill the page from its end backward, and the free space sits in between. A row's address, its `ctid`, is the page and the line pointer number: `(2392,2)` is line pointer 2 on page 2392, and that is where order 495179 lives in a fresh copy of the sample data.

Every tuple header carries three fields that make MVCC work:

| Field | Holds | Order 495179, before the cancel |
|---|---|---|
| `t_xmin` | the ID of the transaction that created this version | 775 (frozen, see below) |
| `t_xmax` | the ID of the transaction that deleted or replaced it; 0 if none | 0 |
| `t_ctid` | the address of this version, or of its newer version | `(2392,2)` |

An `UPDATE` never changes a row in place. In the run, transaction 165806 cancelled order 495179:

1. It wrote a new tuple with `xmin` 165806 and `status = 'cancelled'`. Page 2392 had only 48 bytes free, so the new version went to page 5057, the last page of the table, as line pointer 91; that page's free space dropped from 760 to 676 bytes.
2. It stamped the old tuple at `(2392,2)` with `xmax` 165806 and pointed its `t_ctid` at `(5057,91)`.
3. Because the row moved to another page, `orders_pkey` got a second entry for key 495179, pointing at `(5057,91)`, next to the old one on leaf page 1359 of the [B-tree](../b-tree-index/). `pg_stat_user_tables` counted the update in `n_tup_newpage_upd`.

The `UPDATE` took 5 ms and waited for nothing. `pageinspect` shows both versions: `heap_page_items(get_raw_page('orders', 2392))` lists line pointer 2 with `t_xmax` 165806 and `t_ctid` `(5057,91)`, and page 5057 lists line pointer 91 with `t_xmin` 165806. A `DELETE` only sets `xmax`; an `INSERT` writes a tuple with `xmax` 0.

### Snapshots decide which version a statement sees

A snapshot is three things: the oldest transaction still running (`xmin`), one past the highest transaction ID that has finished (`xmax`), and the list of transactions in progress. `pg_current_snapshot()` prints it as `xmin:xmax:list`. The report's snapshot was `165806:165806:`: every transaction below 165806 had finished, and none was running.

A version is visible to a snapshot when the transaction in its `xmin` had committed before the snapshot was taken, and the one in its `xmax`, if any, had not. PostgreSQL looks up whether a transaction committed in the commit log (`pg_xact`) and caches the answer in hint bits on the tuple. For the report:

- The old version: `xmin` 775 is long committed and frozen, and `xmax` 165806 is not below the snapshot's `xmax`, so the cancel is invisible to the report. The report still sees `delivered`, even with the writer's transaction open (that read took 1.3 ms) and again after the writer committed.
- The new version: `xmin` 165806 is too new, so the report doesn't see it.

The writer's next statement got the snapshot `165807:165807:`. For it, 165806 had committed: the old version is deleted, the new one is visible, and it reads `cancelled`. Every scan applies this test to each version it reaches, so the report's second `GROUP BY`, thirty seconds later, still counted 487,245 delivered orders.

When the snapshot is taken depends on the isolation level: `READ COMMITTED`, the default, takes a fresh one for every statement, while `REPEATABLE READ` and `SERIALIZABLE` take one at the transaction's first statement and keep it. Two writers on the same row still wait for each other: the second `UPDATE` finds a live `xmax` from a running transaction and waits for it to finish, which is the subject of [locks and deadlocks](../locks-and-deadlocks/).

### Dead versions and VACUUM

The old version of 495179 is dead once no snapshot can see it any more. PostgreSQL finds that point with the *xmin horizon*: the oldest `xmin` or transaction ID still held by any session of the database (a standby with `hot_standby_feedback` on counts too, through its physical replication slot even while it is disconnected). Versions deleted by a transaction older than the horizon can go; anything newer must stay, because some snapshot might still need it.

The report held the horizon. While the night's 3,000 status changes ran, one transaction per order, `n_dead_tup` climbed from 1 to 3,001, and `pg_stat_activity` showed the report idle in transaction with `backend_xmin` 165806, 3,001 transaction IDs old after 29 seconds. `VACUUM (VERBOSE) orders` then removed nothing:

```text
tuples: 0 removed, 503011 remain, 3001 are dead but not yet removable
removable cutoff: 165806, which was 3001 XIDs old when operation ended
visibility map: 0 pages set all-visible, 0 pages set all-frozen (0 were all-visible)
```

After the report committed, the same command removed all of them in 33 ms:

```text
finished vacuuming "mvcc.public.orders": index scans: 1
tuples: 3001 removed, 499413 remain, 0 are dead but not yet removable
visibility map: 2140 pages set all-visible, 2006 pages set all-frozen (0 were all-visible)
index scan needed: 2045 pages from table (40.20% of total) had 2897 dead item identifiers removed
```

`pg_stat_progress_vacuum`, sampled during that run, shows the phases: *scanning heap* over 5,087 pages, pruning dead tuples and collecting their addresses; *vacuuming indexes*, which deleted the 2,897 index entries that pointed at them, including `495179 → (2392,2)`; *vacuuming heap*, which marked their line pointers unused; and *cleaning up indexes*. Line pointer 2 on page 2392 is now unused, and the page was compacted, so it has 128 bytes free instead of 48. `VACUUM` keeps that space for future rows in the free space map; it doesn't shrink the file, except for empty pages at its very end.

**Autovacuum** does this on its own. Its launcher checks every `autovacuum_naptime` (1 minute) and vacuums a table once its dead tuples pass `autovacuum_vacuum_threshold` + `autovacuum_vacuum_scale_factor` × rows, by default 50 + 20 %: 100,050 dead rows for `orders`, so tonight's 3,001 would not have started it. PostgreSQL 18 caps that number with `autovacuum_vacuum_max_threshold` (100 million by default), which matters for tables with billions of rows. Inserts can trigger a vacuum too, so that append-only tables get their visibility map set and their rows frozen.

### The visibility map

Each table has a visibility map with two bits per heap page: *all-visible*, every tuple on the page is visible to every transaction, and *all-frozen*, every tuple is frozen. `VACUUM` sets them, any change to the page clears them, and both `VACUUM` and [index-only scans](../covering-index/) skip the pages whose bit is set. With the report open, the first `VACUUM` could set no bit at all; after its commit, 2,140 pages became all-visible.

### HOT updates and fillfactor

An update that changes no indexed column and fits on the same page as the old version is a *heap-only tuple* (HOT) update. The index keeps pointing at the old line pointer, the old tuple's `t_ctid` leads to the new one, and no index entry is written. Later, any query or update that visits the page can prune the chain: the original line pointer becomes a redirect to the oldest version someone may still need, and the versions nobody needs are removed without waiting for `VACUUM`.

`status` is not indexed, so all of tonight's updates could have been HOT, but the sample data was compacted with `VACUUM FULL`, which leaves every page full. The measurements, each from a fresh copy with the same 3,001 updates:

| Setup | HOT updates | New page for the row | Heap pages after | `orders_pkey` pages |
|---|---:|---:|---:|---:|
| full pages, report open | 104 | 2,897 | 5,087 (+29) | 1,382 (+8) |
| full pages, no open report | 928 | 2,073 | 5,079 (+21) | 1,382 (+8) |
| `fillfactor = 90`, report open | 3,001 | 0 | 5,624 (+0) | 1,374 (+0) |

The first two rows show a second cost of the long report: pruning obeys the same horizon as `VACUUM`, so with the report open the dead versions stayed on their pages, and the updates that came after them found no room there. With `ALTER TABLE orders SET (fillfactor = 90)` and a rewrite, every page keeps 10 % free for updates, at the price of 11 % more pages; every update stayed HOT, the table didn't grow, and the final `VACUUM` reported *index scan not needed*. `EXPLAIN (ANALYZE, WAL)` counted 3 records in the [write-ahead log](../write-ahead-log/) for the update of 495179 that moved to page 5057, and 1 record of 85 bytes for the same update on the `fillfactor = 90` copy, where it was HOT.

### Freezing and transaction ID wraparound

Transaction IDs are 32 bits, and PostgreSQL compares them on a circle: for every ID, about two billion are older and two billion newer. A row whose `xmin` falls more than two billion behind would suddenly look as if it came from the future and disappear. To prevent that, `VACUUM` *freezes* old tuples: it sets a flag that means "visible to everyone", and since PostgreSQL 9.4 it keeps the original `xmin` for forensics. That is why order 495179 shows `xmin` 775 marked frozen: the sample data was rewritten with `VACUUM FULL`, and a rewrite always freezes.

Freezing runs as part of normal vacuuming, with a few settings that bound how far it may fall behind (defaults in PostgreSQL 18):

- `vacuum_freeze_min_age` (50 million): how old a transaction ID must be before `VACUUM` freezes it.
- `autovacuum_freeze_max_age` (200 million): a table whose `relfrozenxid` is older than this gets an anti-wraparound autovacuum, even if autovacuum is turned off.
- `vacuum_failsafe_age` (1.6 billion): `VACUUM` drops its cost-based delay and skips index vacuuming to finish freezing sooner.
- Forty million transactions before the wraparound point, the server starts warning; with fewer than three million left, it refuses to assign new transaction IDs until a `VACUUM` advances the oldest one.

PostgreSQL 18 also lets normal vacuums freeze some all-visible pages early (`vacuum_max_eager_freeze_failure_rate`), so that the next aggressive vacuum has less to do.

## Try it

The sample data comes from [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop), a script that builds the template database `acme` on PostgreSQL 18 in about a minute.

The script plays both sessions from one `psql`: the report is the session itself, and the writer is a second connection opened with `dblink`, which ships with PostgreSQL. Your transaction IDs will differ from the ones in the comments.

```sql
-- psql postgresql://postgres:acme@localhost:55432/postgres \
--      -c "CREATE DATABASE mvcc_try TEMPLATE acme STRATEGY FILE_COPY"
-- psql postgresql://postgres:acme@localhost:55432/mvcc_try -f mvcc.sql
CREATE EXTENSION IF NOT EXISTS pageinspect;
CREATE EXTENSION IF NOT EXISTS dblink;   -- a second session, for the writer
\set other 'dbname=' :DBNAME
VACUUM (ANALYZE) orders;

BEGIN ISOLATION LEVEL REPEATABLE READ;   -- the nightly report
SELECT count(*) FROM orders WHERE status = 'delivered';
-- 487245                                   the report's snapshot is taken here

-- the writer cancels order 495179 in its own session, and commits
SELECT dblink_exec(:'other', $$UPDATE orders SET status = 'cancelled' WHERE id = 495179$$);
-- UPDATE 1                                 no waiting

SELECT xmin, xmax, ctid, status FROM orders WHERE id = 495179;
-- 775 | 357523 | (2392,2) | delivered       the report still reads the old version
SELECT * FROM dblink(:'other', $$SELECT xmin, xmax, ctid, status FROM orders WHERE id = 495179$$)
  AS t(xmin xid, xmax xid, ctid tid, status text);
-- 357523 | 0 | (5057,91) | cancelled       a new snapshot reads the new one
SELECT lp, t_xmin, t_xmax, t_ctid FROM heap_page_items(get_raw_page('orders', 2392)) WHERE lp = 2;
-- 2 | 775 | 357523 | (5057,91)             the old version points to the new one

-- VACUUM from another session while the report is still open
SELECT dblink_exec(:'other', 'VACUUM orders');
SELECT * FROM dblink(:'other', $$SELECT n_dead_tup FROM pg_stat_user_tables WHERE relname = 'orders'$$)
  AS t(n_dead_tup bigint);
-- 1                                         the dead version had to stay
COMMIT;

VACUUM (VERBOSE) orders;
-- tuples: 1 removed, 500000 remain, 0 are dead but not yet removable
SELECT n_tup_upd, n_tup_hot_upd, n_dead_tup FROM pg_stat_user_tables WHERE relname = 'orders';
-- 1 | 0 | 0                                 page 2392 was full: not a HOT update

-- HOT: leave 10% of every page free, then change a column that no index covers
ALTER TABLE orders SET (fillfactor = 90);
VACUUM FULL orders;
SELECT pg_relation_size('orders') / 8192 AS pages;
-- 5624                                      5,058 before
SELECT ctid, status FROM orders WHERE id = 497001;
-- (3657,1) | paid
UPDATE orders SET status = 'shipped' WHERE id = 497001;
SELECT ctid, status FROM orders WHERE id = 497001;
-- (3657,90) | shipped                       same page: a HOT update
SELECT pg_stat_force_next_flush();
SELECT n_tup_upd, n_tup_hot_upd FROM pg_stat_user_tables WHERE relname = 'orders';
-- 2 | 1
```

To see the lock-based version of step 1, run `BEGIN; LOCK TABLE orders IN SHARE MODE;` in one `psql` and `SET lock_timeout = '5s'; UPDATE orders SET status = 'cancelled' WHERE id = 495179;` in another.

## When to use it

MVCC is not something you switch on: PostgreSQL, InnoDB and Oracle always keep row versions, and SQL Server does once row versioning is enabled. What you choose is how to work with it.

- **Long reads next to short writes.** Reports, exports and backups get a consistent view without stopping the shop. Run the long ones at `REPEATABLE READ`, so that all their queries share one snapshot, and keep them as short as the job allows. Moving them to a [read replica](../read-replicas/) takes their load off the primary, but on a PostgreSQL standby the same conflict comes back in another form: replay cancels queries that need rows `VACUUM` has removed (after `max_standby_streaming_delay`), unless `hot_standby_feedback` is on, which makes the standby hold back `VACUUM` on the primary instead.
- **Short transactions everywhere else.** Commit as soon as the work is done, and never keep a transaction open across a user's think time, an HTTP call to a payment provider, or a batch job's sleep. For edits that span user interactions, check a version column at save time instead ([optimistic concurrency](../optimistic-concurrency/)).
- **Tables updated in place all day**, such as orders moving through statuses, stock levels and sessions: leave room for HOT updates with a lower `fillfactor`, don't index columns that change often unless queries need them, and give the table its own autovacuum settings.
- **When versions are not enough.** Snapshots make reads consistent, but two writers on one row still queue on a row lock ([locks and deadlocks](../locks-and-deadlocks/)), and only `SERIALIZABLE` catches anomalies such as write skew ([isolation levels](../isolation-levels/)), at the price of retries.

## Trade-offs

- **Gained: nobody waits to read.** The report, the cancel and the night's 3,000 updates ran side by side; the only waits left are between writers of the same row.
- **Space until cleanup.** Every update leaves a dead version until `VACUUM` removes it, and indexes keep entries for it too. The night's 3,001 updates grew `orders` from 5,058 to 5,087 pages, and the file stays that size afterwards; only `VACUUM FULL`, `CLUSTER` or an online tool such as `pg_repack` gives the space back, and `VACUUM FULL` blocks the table while it rewrites it.
- **Write amplification.** A non-HOT update writes a whole new tuple and a new entry in every index on the table, with WAL for each; most of tonight's updates were of that kind.
- **One old snapshot holds back a whole database.** A long report, a session idle in a transaction that has written something or holds a snapshot, a forgotten prepared transaction, or a standby with `hot_standby_feedback` all pin the horizon, and no table in the database can be cleaned past it. A logical replication slot holds back only the system catalogs, and the WAL it has not consumed.
- **Freezing is not optional.** Even a table that never changes must eventually be read and frozen by `VACUUM`, and if freezing falls too far behind, the server stops assigning transaction IDs until it catches up.
- **Background work.** Autovacuum reads and writes pages all day; its cost-based delay (`autovacuum_vacuum_cost_delay`, 2 ms by default) keeps that gentle, sometimes too gentle for a busy table.

## Implementation notes

**Find what holds the horizon** and how far behind cleanup is:

```sql
-- sessions holding old snapshots or transaction IDs
SELECT pid, application_name, state, backend_xid, backend_xmin,
       age(backend_xmin) AS xmin_age, now() - xact_start AS open_for
FROM pg_stat_activity
WHERE backend_xmin IS NOT NULL OR backend_xid IS NOT NULL
ORDER BY greatest(age(backend_xmin), age(backend_xid)) DESC;

-- dead rows, HOT share and the last vacuum, per table
SELECT relname, n_live_tup, n_dead_tup, n_tup_upd, n_tup_hot_upd, n_tup_newpage_upd,
       last_vacuum, last_autovacuum
FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 10;

-- how close each database is to a forced anti-wraparound vacuum
SELECT datname, age(datfrozenxid) FROM pg_database ORDER BY 2 DESC;
```

`n_live_tup` and `n_dead_tup` are estimates: after the second `VACUUM` scanned 79 % of the pages, `n_live_tup` read 499,413 for a table of 500,000 rows. `pg_stat_progress_vacuum` shows a running vacuum's phase and pages, and `VACUUM (VERBOSE)` prints what each run removed and why it could not remove more.

**Put limits on forgotten transactions.** `idle_in_transaction_session_timeout` ends a session that sits idle inside a transaction for longer than the limit; it is 0 (off) by default, and when it fires, the client sees `FATAL: 25P03: terminating connection due to idle-in-transaction timeout`. PostgreSQL 17 added `transaction_timeout` for the length of the whole transaction (`FATAL: 25P04`). Both can be set per role or per database, for example only for the reporting role. A read-only `READ COMMITTED` transaction holds no snapshot between statements, so in the run only sessions that had written something or held a `REPEATABLE READ` snapshot showed up with a `backend_xid` or `backend_xmin`.

**Tune autovacuum per table** with storage parameters instead of globally: `ALTER TABLE orders SET (autovacuum_vacuum_scale_factor = 0.02)` starts it at about 10,050 dead rows instead of 100,050. `fillfactor` applies only to pages written after the change; a rewrite applies it to the whole table.

**Amazon RDS and Aurora PostgreSQL** run the same MVCC and the same autovacuum, configured through the DB parameter group. RDS for PostgreSQL adds *adaptive autovacuum* (`rds.adaptive_autovacuum`, on by default), which makes autovacuum more aggressive when transaction IDs age, and AWS still recommends a CloudWatch alarm on transaction ID age. See [Amazon RDS & Aurora](../amazon-rds-aurora/) and [PostgreSQL](../postgresql/).

**MySQL 8.4 (InnoDB) updates the row in place** in the clustered index and keeps the old values in an *undo log*. Each row carries hidden fields: `DB_TRX_ID` (6 bytes), the last transaction that changed it, and `DB_ROLL_PTR` (7 bytes), a pointer to the undo record that rebuilds the previous version. A consistent read follows that chain until it reaches a version its read view may see; at `REPEATABLE READ`, the default, the read view is created by the transaction's first read, or at once by `START TRANSACTION WITH CONSISTENT SNAPSHOT`. In the same run on MySQL 8.4.11, the report kept reading `delivered` while transaction 8626 cancelled the order. The cost moves from the table to the undo logs: *purge* may discard an update's undo only when no read view needs it, so the *history list length* in `SHOW ENGINE INNODB STATUS` grew by one per committed update transaction while the report was open, from 7 to 3,002, and dropped to 0 about 46 seconds after the report committed. Purge also removes the delete-marked index records that InnoDB leaves behind. `innodb_purge_threads` defaults to 1 on machines with up to 16 logical processors and 4 above that, and `innodb_max_purge_lag` (0, off, by default) can slow down writes when purge falls behind.

**Oracle AI Database 26ai** also writes the old values to undo segments and rebuilds, block by block, the version a query needs as of the moment it started. It doesn't keep undo forever: committed undo older than the undo retention period can be overwritten, and a query that still needed it fails with `ORA-01555: snapshot too old`. The trade-off runs the other way from PostgreSQL's: Oracle's long report may fail, where PostgreSQL's makes the table bloat. `UNDO_RETENTION` and `RETENTION GUARANTEE` shift the balance.

**SQL Server** gives readers row versions only when `READ_COMMITTED_SNAPSHOT` or `ALLOW_SNAPSHOT_ISOLATION` is on (`READ_COMMITTED_SNAPSHOT` is on by default in Azure SQL Database). Otherwise its default `READ COMMITTED` reads with short shared locks, so a reader waits for a writer's uncommitted change. The versions live in a version store in `tempdb`, or in the database itself when accelerated database recovery is enabled.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Transaction Isolation Levels](../isolation-levels/) — What concurrent transactions can see of each other: the anomalies each isolation level allows and the defaults engines use.
- [Locks & Deadlocks](../locks-and-deadlocks/) — Row locks make writers wait for each other; two transactions waiting on each other is a deadlock, and the database aborts one.
- [Write-Ahead Log](../write-ahead-log/) — Log each change before applying it, so a commit survives a crash, recovery replays the log, and replicas and backups follow it.
- [Covering Index](../covering-index/) — Answer a query from the index alone: include the columns it selects, so the table is never read, and the scan is index-only.
- [B-Tree Index](../b-tree-index/) — How a B-tree index finds a row in three or four page reads, serves ranges in order, and what every insert costs to keep it sorted.
- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [Read Replicas](../read-replicas/) — Send writes to the primary and spread reads across asynchronously updated replicas.
- [Amazon RDS & Aurora](../amazon-rds-aurora/) — Managed relational databases: backups, Multi-AZ failover and read replicas, and Aurora's storage shared across three zones.

## References

- [PostgreSQL 18 documentation — Concurrency Control: Introduction (MVCC)](https://www.postgresql.org/docs/18/mvcc-intro.html)
- [PostgreSQL 18 documentation — Routine Vacuuming (dead tuples, visibility map, wraparound, autovacuum)](https://www.postgresql.org/docs/18/routine-vacuuming.html)
- [PostgreSQL 18 documentation — Heap-Only Tuples (HOT)](https://www.postgresql.org/docs/18/storage-hot.html)
- [PostgreSQL 18 documentation — Database Page Layout (line pointers, t_xmin, t_xmax, t_ctid)](https://www.postgresql.org/docs/18/storage-page-layout.html)
- [PostgreSQL 18 documentation — VACUUM](https://www.postgresql.org/docs/18/sql-vacuum.html)
- [PostgreSQL 18 documentation — Vacuuming settings (autovacuum thresholds, freezing)](https://www.postgresql.org/docs/18/runtime-config-vacuum.html)
- [PostgreSQL 18 documentation — Client Connection Defaults (lock_timeout, idle_in_transaction_session_timeout)](https://www.postgresql.org/docs/18/runtime-config-client.html)
- [PostgreSQL 18 documentation — The Cumulative Statistics System (pg_stat_user_tables, pg_stat_activity)](https://www.postgresql.org/docs/18/monitoring-stats.html)
- [PostgreSQL 18 documentation — Progress Reporting (pg_stat_progress_vacuum)](https://www.postgresql.org/docs/18/progress-reporting.html)
- [PostgreSQL 18 documentation — pageinspect](https://www.postgresql.org/docs/18/pageinspect.html)
- [PostgreSQL 18 documentation — Explicit Locking (table-level lock modes)](https://www.postgresql.org/docs/18/explicit-locking.html)
- [MySQL 8.4 Reference Manual — InnoDB Multi-Versioning](https://dev.mysql.com/doc/refman/8.4/en/innodb-multi-versioning.html)
- [MySQL 8.4 Reference Manual — Purge Configuration (history list)](https://dev.mysql.com/doc/refman/8.4/en/innodb-purge-configuration.html)
- [MySQL 8.4 Reference Manual — Transaction Isolation Levels](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html)
- [Oracle AI Database 26ai Concepts — Data Concurrency and Consistency (read consistency and undo)](https://docs.oracle.com/en/database/oracle/oracle-database/26/cncpt/data-concurrency-and-consistency.html)
- [Oracle AI Database 26ai Administrator's Guide — Managing Undo](https://docs.oracle.com/en/database/oracle/oracle-database/26/admin/managing-undo.html)
- [Microsoft Learn — Transaction locking and row versioning guide (SQL Server)](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide)
- [AWS documentation — Working with PostgreSQL autovacuum on Amazon RDS for PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.Autovacuum.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
