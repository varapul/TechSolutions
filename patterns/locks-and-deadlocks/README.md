
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗃️ Database Internals & Performance](../../README.md#database-internals--performance)

# Locks & Deadlocks

> Row locks make writers wait for each other; two transactions waiting on each other is a deadlock, and the database aborts one.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Locks &amp; Deadlocks" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/locks-and-deadlocks.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One open transaction** | Acme's back-office script runs `UPDATE orders SET status = 'cancelled' WHERE id = 497003` in a transaction and then sits **idle in transaction**: nobody has typed COMMIT, so the row lock stays. The warehouse job, which has just updated order 499846, and the shop app both try to update 497003 and wait; at 10 s `pg_stat_activity` shows them 9.0 and 8.0 s into a `Lock` wait, while the support screen's SELECT returned at once. At 20 s the script's next UPDATE asks for order 499846, which the warehouse job holds, and the two transactions now wait for each other. |
| **2 · Row locks and the queue** | An UPDATE that leaves key columns alone takes a FOR NO KEY UPDATE row lock, and PostgreSQL records it in the row itself: the version of 497003 at ctid (774,54) gets `xmax = 165763`, A's transaction ID, so row locks need no shared memory and mostly don't appear in `pg_locks`. The first waiter takes the `tuple` lock on (774,54) and waits for a `ShareLock` on transaction 165763, granted only when A ends; later writers queue for the tuple lock, and readers take no row lock at all. `pg_blocking_pids()` gives the wait-for graph: C waits for B, B for A and A for B, a cycle. |
| **3 · Detect, abort, prevent** | PostgreSQL doesn't look for deadlocks when a wait starts: after `deadlock_timeout` (1 s by default) the waiting process searches the wait-for graph, finds the cycle and usually aborts its own transaction, so A gets `ERROR: deadlock detected` (SQLSTATE 40P01) and B and C finish after 20.0 and 19.0 s. In more runs, locking both orders in id order with `ORDER BY id FOR UPDATE` left B waiting 5.5 s without a cycle, `lock_timeout = '2s'` stopped C after 2.0 s (55P03), and `idle_in_transaction_session_timeout` ended the forgotten transaction. For a job queue, `FOR UPDATE SKIP LOCKED` gives each packer a different paid order, and `NOWAIT` fails at once instead of waiting. |
| **4 · Schema changes and InnoDB** | `ALTER TABLE orders ADD COLUMN gift_note text` needs an ACCESS EXCLUSIVE lock, so it waited 7.0 s behind a report's open transaction, and every plain SELECT that arrived meanwhile queued behind the ALTER (6.0 and 5.0 s), although the report blocks no reader. With `SET lock_timeout = '2s'` the ALTER gave up after 2.0 s, reads waited at most 1.0 s, and the retry took 2.6 ms. On MySQL 8.4, InnoDB rolled back A 5 ms after the same cycle formed (`innodb_deadlock_detect` is on by default), and under REPEATABLE READ its next-key and gap locks made new orders for customers 1049 and 1050 wait 3.5 and 4.0 s, where PostgreSQL inserted both at once. |
<!-- END GENERATED: header -->

## The problem

Customer 1050 asks Acme Shop to cancel both of their paid orders, 497003 and 499846. An operator opens psql and runs the back-office script by hand: `BEGIN`, the UPDATE for 497003, and then a phone call, with the transaction still open. Nothing in [PostgreSQL](../postgresql/) times out by default, so the row lock that UPDATE took stays until the session commits, rolls back or disconnects. Here is one run on PostgreSQL 18.6, with times in seconds from the script's first statement (one run on a laptop):

| t (s) | A · back-office script | B · warehouse job | C · shop app | D · support screen |
|---|---|---|---|---|
| 0.0 | `BEGIN; UPDATE orders SET status = 'cancelled' WHERE id = 497003;` → `UPDATE 1`, then nothing | | | |
| 1.0 | | `BEGIN; UPDATE orders SET status = 'shipped' WHERE id = 499846;` → `UPDATE 1`, then the same for 497003, which waits | | |
| 2.0 | | | `UPDATE orders SET shipping_country = 'TH' WHERE id = 497003;` waits | |
| 3.0 | | | | `SELECT id, status FROM orders WHERE id = 497003;` → `paid` in 3 ms |
| 20.0 | `UPDATE orders SET status = 'cancelled' WHERE id = 499846;` waits | | | |
| 21.0 | `ERROR: deadlock detected` (SQLSTATE 40P01) | `UPDATE 1` after 20.0 s, then `COMMIT` | `UPDATE 1` after 19.0 s | |

No statement was slow in the usual sense. Each needs a few milliseconds, and at 10 s `pg_stat_activity` showed the script `idle in transaction` and the two writers in a `Lock` wait, not on CPU or I/O: the time went into waiting for a session that was doing nothing. In production the waiters are web requests that each hold a pool connection, the callers time out and retry, and every retry joins the same queue. When the operator came back, the script's next UPDATE asked for order 499846, which the warehouse job had locked first, so each transaction now waited for the other. PostgreSQL broke the deadlock a second later by aborting the script's transaction: the cancellation was rolled back, and both orders shipped.

## How it works

**Two levels of locks.** Every statement takes a table-level lock on the tables it uses, and statements that change rows also lock those rows. PostgreSQL has eight table-level modes. Despite names such as ROW EXCLUSIVE, all of them lock the table, and they differ only in which other modes they conflict with. The ones that matter day to day (the documentation has the full conflict table, with SHARE ROW EXCLUSIVE and EXCLUSIVE too):

| Table lock mode | Taken by | Conflicts with |
|---|---|---|
| `ACCESS SHARE` | `SELECT` | `ACCESS EXCLUSIVE` only |
| `ROW SHARE` | `SELECT … FOR UPDATE` and the other locking reads | `EXCLUSIVE`, `ACCESS EXCLUSIVE` |
| `ROW EXCLUSIVE` | `INSERT`, `UPDATE`, `DELETE`, `MERGE` | `SHARE`, `SHARE ROW EXCLUSIVE`, `EXCLUSIVE`, `ACCESS EXCLUSIVE` |
| `SHARE UPDATE EXCLUSIVE` | `VACUUM` (not `FULL`), `ANALYZE`, `CREATE INDEX CONCURRENTLY`, `VALIDATE CONSTRAINT` | itself and every mode from `SHARE` up |
| `SHARE` | `CREATE INDEX` | `ROW EXCLUSIVE`, `SHARE UPDATE EXCLUSIVE` and every mode above `SHARE` |
| `ACCESS EXCLUSIVE` | `DROP TABLE`, `TRUNCATE`, `VACUUM FULL`, many forms of `ALTER TABLE`, `LOCK TABLE` | all eight, plain `SELECT` included |

`ROW EXCLUSIVE` doesn't conflict with itself, so writers that touch different rows never wait for each other at the table level. Their conflicts are on rows, which have four lock modes of their own:

| Row lock mode | Taken by | Blocks |
|---|---|---|
| `FOR KEY SHARE` | `SELECT … FOR KEY SHARE`, foreign-key checks | `FOR UPDATE` only |
| `FOR SHARE` | `SELECT … FOR SHARE` | `FOR NO KEY UPDATE`, `FOR UPDATE` |
| `FOR NO KEY UPDATE` | an `UPDATE` that changes no key column, `SELECT … FOR NO KEY UPDATE` | `FOR SHARE`, `FOR NO KEY UPDATE`, `FOR UPDATE` |
| `FOR UPDATE` | `SELECT … FOR UPDATE`, `DELETE`, an `UPDATE` of a key column | all four |

A key column here is one with a unique index that a foreign key can use. The weak lock for foreign-key checks is why order items can still be added to a locked order: while A held 497003, `INSERT INTO order_items (order_id, …) VALUES (497003, …)` went in after 3 ms, because its `FOR KEY SHARE` doesn't conflict with A's `FOR NO KEY UPDATE`. A plain `SELECT` takes no row lock at all.

**A row lock is written into the row.** A transaction can lock millions of rows, so PostgreSQL doesn't keep row locks in shared memory. It stores the locking transaction's ID in the row version's `xmax`, with flag bits for the strength, as the heap's [README.tuplock](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/access/heap/README.tuplock) describes. After A's UPDATE, the version of 497003 at ctid (774,54) carried `xmax = 165763`, A's transaction ID, and `pgrowlocks` reported it as a `No Key Update` lock held by pid 14562. That is why the number of locked rows has no limit, why `SELECT … FOR UPDATE` writes to the table, and why `pg_locks` normally doesn't list row locks at all.

**The queue.** A transaction that changes data holds an exclusive lock on its own transaction ID until it ends, and waiting for another transaction means asking for a share lock on that ID. A writer that finds a locked row waits in two stages: it first takes a heavyweight `tuple` lock on that row version, which decides who goes next, and then waits for the holder's transaction ID. `pg_locks` at 20.5 s shows exactly that, in its `transactionid` and `tuple` rows:

| application_name | locktype | xid / tuple | mode | granted |
|---|---|---|---|---|
| back-office | transactionid | 165763 | ExclusiveLock | t |
| warehouse | transactionid | 165764 | ExclusiveLock | t |
| shop-app | transactionid | 165765 | ExclusiveLock | t |
| warehouse | tuple | (774,54) | ExclusiveLock | t |
| warehouse | transactionid | 165763 | ShareLock | **f** |
| shop-app | tuple | (774,54) | ExclusiveLock | **f** |
| back-office | tuple | (2194,90) | ExclusiveLock | t |
| back-office | transactionid | 165764 | ShareLock | **f** |

The warehouse job is first in line for row (774,54) and waits for transaction 165763; the shop app waits for the tuple lock behind it. `pg_stat_activity` reports the same as wait events, `Lock: transactionid` for the first in line and `Lock: tuple` for the rest. When A's transaction ended, B got the row and C followed B, in arrival order. Readers are not part of the queue: the support screen read the last committed version, `paid`, in 3 ms, because under [MVCC](../mvcc/) a plain SELECT never waits for a row lock.

**Deadlock detection.** Looking for deadlocks costs time, so PostgreSQL doesn't look when a wait begins. The waiting process sets a timer of `deadlock_timeout`, 1 s by default, and only if it is still waiting when the timer fires does it search the wait-for graph; normally it finds nothing and goes back to sleep, which is what B's and C's checks would have done one second into their waits. A's check ran at 21.0 s, one second after its second UPDATE started waiting, found A → B → A and resolved it by aborting A's own transaction, which is the usual outcome according to the [lock manager's README](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/storage/lmgr/README); the documentation warns not to rely on which transaction is chosen. psql showed:

```
ERROR:  deadlock detected
DETAIL:  Process 14562 waits for ShareLock on transaction 165764; blocked by process 14564.
Process 14564 waits for ShareLock on transaction 165763; blocked by process 14562.
HINT:  See server log for query details.
CONTEXT:  while updating tuple (2194,90) in relation "orders"
```

The server log adds both processes' statements. SQLSTATE 40P01 tells the application to roll back and run the whole transaction again. Once A's locks were gone, B finished after 20.0 s and C after 19.0 s.

**Who blocks whom.** `pg_blocking_pids(pid)` returns the sessions a process is waiting for: those that hold a conflicting lock, and those queued ahead of it with a conflicting request. At 20.5 s it returned `{14564}` for A, `{14562}` for B and `{14564}` for C, the wait-for graph with its cycle. A query worth keeping at hand (each call briefly needs exclusive access to the lock manager's shared state, so don't run it in a tight loop):

```sql
SELECT pid, application_name, state, wait_event_type, wait_event,
       pg_blocking_pids(pid) AS blocked_by,
       now() - state_change AS in_state, left(query, 60) AS query
FROM pg_stat_activity
WHERE cardinality(pg_blocking_pids(pid)) > 0 OR state = 'idle in transaction';
```

`log_lock_waits`, off by default, logs every wait that lasts longer than `deadlock_timeout`, and PostgreSQL 18 adds `log_lock_failures` for locks that `NOWAIT` failed to get.

## Try it

The sample data comes from [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop), a script that builds the template database `acme` on PostgreSQL 18 in about a minute.

The script plays two sessions at once: it opens the second one with the `dblink` extension that ships with PostgreSQL. Run it as `postgres`, because dblink connects without a password only for superusers. The comments show the key output; process and transaction IDs differ on every run.

```sql
-- CREATE DATABASE locks_try TEMPLATE acme;   -- then connect to locks_try as postgres
CREATE EXTENSION IF NOT EXISTS dblink;        -- opens a second session from this one
SELECT dblink_connect('warehouse', 'dbname=' || current_database());

BEGIN;                                        -- this session plays the back-office script
UPDATE orders SET status = 'cancelled' WHERE id = 497003;
SELECT dblink_exec('warehouse', 'BEGIN');
SELECT dblink_exec('warehouse', $$UPDATE orders SET status = 'shipped' WHERE id = 499846$$);
SELECT dblink_send_query('warehouse', $$UPDATE orders SET status = 'shipped' WHERE id = 497003$$);
SELECT pg_sleep(1.5);                         -- the warehouse now waits for this session

SELECT wait_event_type, wait_event, pg_blocking_pids(pid) = ARRAY[pg_backend_pid()] AS blocked_by_me
FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();
-- Lock | transactionid | t

SELECT locktype, page, tuple, mode, granted FROM pg_locks
WHERE locktype IN ('transactionid', 'tuple') ORDER BY granted, locktype;
-- transactionid |     |    | ShareLock     | f    the warehouse waits for this transaction
-- transactionid |     |    | ExclusiveLock | t    each transaction holds its own ID
-- transactionid |     |    | ExclusiveLock | t
-- tuple         | 774 | 54 | ExclusiveLock | t    the warehouse is first in line for 497003

UPDATE orders SET status = 'cancelled' WHERE id = 499846;   -- closes the cycle
-- ERROR:  deadlock detected                    (after deadlock_timeout, 1 s)
-- DETAIL:  Process … waits for ShareLock on transaction …; blocked by process ….
ROLLBACK;
SELECT * FROM dblink_get_result('warehouse') AS r(status text);  -- UPDATE 1: it got 497003
SELECT * FROM dblink_get_result('warehouse') AS r(status text);  -- (0 rows): all results read
SELECT dblink_exec('warehouse', 'COMMIT');

-- A job queue: the warehouse holds the first paid order, so SKIP LOCKED moves on
SELECT dblink_exec('warehouse', 'BEGIN');
SELECT * FROM dblink('warehouse', $$SELECT id FROM orders WHERE status = 'paid'
  ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED$$) AS t(id bigint);                    -- 497001
SELECT id FROM orders WHERE status = 'paid' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED; -- 497005
SELECT id FROM orders WHERE status = 'paid' ORDER BY id LIMIT 1 FOR UPDATE NOWAIT;
-- ERROR:  could not obtain lock on row in relation "orders"
SELECT dblink_exec('warehouse', 'ROLLBACK');
```

## When to use it

PostgreSQL takes the locks it needs on its own. Taking more yourself pays off in a few cases:

- **Read, decide, then write** in one short transaction: `SELECT … FOR UPDATE` on the rows you are about to change (the stock before an order, a balance before a transfer) stops another writer from changing them between your read and your write. Never wait for a person inside such a transaction. For edits that take someone minutes, check a version column at write time instead ([optimistic concurrency](../optimistic-concurrency/)), and see [isolation levels](../isolation-levels/) for what each level adds on its own.
- **Several rows in one transaction:** lock them in the same order everywhere, for example with `SELECT … WHERE id IN (…) ORDER BY id FOR UPDATE` before changing them. In a second run the warehouse job did this and waited 5.5 s for the script while holding nothing, so no cycle could form.
- **Fail instead of waiting:** `NOWAIT` raises 55P03 at once, which suits an editing screen that should say "someone else is changing this order" instead of hanging.
- **A table used as a job queue:** `FOR UPDATE SKIP LOCKED` hands each worker the next row nobody holds, so several workers share one table as [competing consumers](../competing-consumers/), and ordering the claim by a priority column first turns the table into a [priority queue](../priority-queue/). Index the queue condition: without an index each claim walked the primary key past 497,004 rows (302 ms); with `CREATE INDEX ON orders (id) WHERE status = 'paid'` a claim read 12 buffers in 0.1 ms.
- **Something that isn't a row,** such as one invoice run at a time: advisory locks give the application named locks. `pg_advisory_xact_lock(key)` waits like any other lock request, shows up in `pg_locks`, and is released when the transaction ends.

## Trade-offs

- **Waits look like slowness.** A blocked statement uses no CPU, so lock trouble shows up as latency, exhausted [connection pools](../connection-pooling/) and timeouts at the callers. Watch `wait_event_type = 'Lock'` and `idle in transaction`, not just CPU.
- **Timeouts turn waits into errors.** `lock_timeout`, `statement_timeout` and the 40P01 abort all hand the caller an error; the caller has to roll back and run the transaction again with backoff ([retry with backoff](../retry-with-backoff/)), so the transaction must be safe to repeat.
- **`deadlock_timeout` is a balance.** A higher value saves needless checks under load but leaves a real deadlock stuck for longer. The documentation suggests a value above your typical transaction time and calls 1 s about the smallest worth using.
- **SKIP LOCKED gives an inconsistent view.** It suits a queue, where any free row will do, and nothing that must see every row.
- **Locking a row writes.** `SELECT … FOR UPDATE` sets `xmax` on every row it locks, so it dirties pages even when nothing else changes.
- **Long transactions cost more than their locks.** An open transaction also keeps VACUUM from removing dead row versions ([MVCC](../mvcc/)), one more reason to set `idle_in_transaction_session_timeout`.

## Implementation notes

**Prevention, measured** in more runs on the same data:

| Technique | What happened |
|---|---|
| Lock both orders in id order: `SELECT id, status FROM orders WHERE id IN (499846, 497003) ORDER BY id FOR UPDATE` | B waited 5.5 s for A without holding a lock; A's second UPDATE went through in 5 ms, no deadlock; B then found both orders cancelled and its `UPDATE … AND status = 'paid'` changed nothing |
| `SET lock_timeout = '2s'` | C stopped after 2.0 s: `ERROR: canceling statement due to lock timeout` (55P03) |
| `SET statement_timeout = '3s'` | C stopped after 3.0 s: `ERROR: canceling statement due to statement timeout` (57014) |
| `SET idle_in_transaction_session_timeout = '5s'` | the server ended A's session after 5 s idle (`FATAL: terminating connection due to idle-in-transaction timeout`), so B waited 4.0 s |
| `FOR UPDATE NOWAIT` | `ERROR: could not obtain lock on row in relation "orders"` (55P03), without waiting |
| `FOR UPDATE SKIP LOCKED` | three packers got 497001, 497005 and 497008 while A held 497003 |

Set the timeouts per session, per transaction (`SET LOCAL`) or per role (`ALTER ROLE shop_app SET lock_timeout = '2s'`); the documentation advises against setting `lock_timeout` or `statement_timeout` in `postgresql.conf`, where they would hit every session. `transaction_timeout`, added in PostgreSQL 17, caps a whole transaction, idle time included.

**Schema changes without an outage.** `ADD COLUMN` without a default, or with a non-volatile one, only changes the catalog: the retry after the report ended took 2.6 ms. The danger is the ACCESS EXCLUSIVE lock it has to wait for. The lock manager grants a request only if it conflicts with neither the locks held nor the requests already waiting, so behind a report's open transaction the ALTER waited 7.0 s and every read that arrived meanwhile waited behind it, 6.0 s and 5.0 s here, although the report itself blocks no reader. Wrap DDL in `SET lock_timeout` and retry it in a loop with a pause: with a 2 s timeout the ALTER gave up after 2.0 s (55P03) and the reads waited at most 1.0 s. Build indexes with `CREATE INDEX CONCURRENTLY` and add constraints as `NOT VALID` followed by `VALIDATE CONSTRAINT`; both take SHARE UPDATE EXCLUSIVE, which lets reads and writes go on. Split bigger changes into [expand and contract](../expand-and-contract/) steps. `NOWAIT` and `SKIP LOCKED` don't help here: they apply only to row locks, and the table lock is still requested the usual way.

**MySQL 8.4 (InnoDB)** locks index records rather than row versions, and `performance_schema.data_locks` lists every lock it holds: in the same interleaving, B and C waited for an `X,REC_NOT_GAP` lock on primary key 497003. Deadlock detection is on by default (`innodb_deadlock_detect`), and since MySQL 8.0.18 a background thread searches for cycles, so A got `ERROR 1213 (40001): Deadlock found when trying to get lock; try restarting transaction` 5 ms after it closed the cycle, with no one-second wait. InnoDB rolls back the transaction it considers smaller, by rows inserted, updated or deleted. With detection turned off, waits end after `innodb_lock_wait_timeout` (50 s by default) with error 1205, which rolls back only the statement unless `innodb_rollback_on_timeout` is set. The bigger difference is gap locking. Under REPEATABLE READ, InnoDB's default, a locking scan takes next-key locks: a lock on each index record plus the gap before it. `UPDATE orders SET status = 'cancelled' WHERE customer_id = 1050 AND status = 'paid'` changed 2 rows but locked all 27 of customer 1050's entries in the `customer_id` index, the gap after them and 27 primary-key records. A new order for customer 1050 then waited 4.0 s, one for customer 1049 waited 3.5 s because its entry fell into the gap before 1050's first, and one for customer 1051 went in after 10 ms. PostgreSQL has no gap locks, and the same two inserts took under 8 ms there. In InnoDB, READ COMMITTED switches gap locking off for searches and index scans, and a locking statement that can't use an index locks every row it scans. `NOWAIT` and `SKIP LOCKED` exist there too. Schema changes queue in the same way: an `ALTER TABLE` waiting for a metadata lock behind an open transaction made a plain SELECT wait 3.0 s, because pending exclusive metadata-lock requests go ahead of shared ones, and `lock_wait_timeout` defaults to one year, so set it low for migrations.

**SQL Server** finds deadlocks with a lock monitor thread that searches every 5 seconds by default, and more often, down to 100 ms, while deadlocks keep turning up. It rolls back the session with the lower `DEADLOCK_PRIORITY`, or else the transaction that is cheaper to roll back, and returns error 1205; lock waits have no time limit unless the session sets `LOCK_TIMEOUT`. Its READ COMMITTED takes shared locks for reads while `READ_COMMITTED_SNAPSHOT` is off, which is the default in SQL Server, so there readers can wait for writers; Azure SQL Database turns the option on by default.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Transaction Isolation Levels](../isolation-levels/) — What concurrent transactions can see of each other: the anomalies each isolation level allows and the defaults engines use.
- [MVCC](../mvcc/) — Multi-version concurrency control: an update writes a new row version, readers see a snapshot, and vacuum removes dead versions.
- [Optimistic Concurrency Control](../optimistic-concurrency/) — Update a row only if it is unchanged since you read it, using a version column, and retry on conflict instead of holding locks.
- [Competing Consumers](../competing-consumers/) — Several workers pull from one queue, so work is shared and throughput scales out.
- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [Expand and Contract](../expand-and-contract/) — Change a schema or API in backward-compatible steps: expand, migrate, then contract.
- [Retry with Backoff & Jitter](../retry-with-backoff/) — Retry transient failures with growing, randomised delays so clients don't stampede.
- [Priority Queue](../priority-queue/) — Urgent messages are processed ahead of routine ones.

## References

- [PostgreSQL 18 documentation — Explicit Locking (table and row lock modes, deadlocks, advisory locks)](https://www.postgresql.org/docs/18/explicit-locking.html)
- [PostgreSQL 18 documentation — Lock Management (deadlock_timeout)](https://www.postgresql.org/docs/18/runtime-config-locks.html)
- [PostgreSQL 18 documentation — Client Connection Defaults (lock_timeout, statement_timeout, idle_in_transaction_session_timeout, transaction_timeout)](https://www.postgresql.org/docs/18/runtime-config-client.html)
- [PostgreSQL 18 documentation — SELECT: the locking clause (NOWAIT, SKIP LOCKED)](https://www.postgresql.org/docs/18/sql-select.html#SQL-FOR-UPDATE-SHARE)
- [PostgreSQL 18 documentation — pg_locks](https://www.postgresql.org/docs/18/view-pg-locks.html)
- [PostgreSQL 18 documentation — System Information Functions (pg_blocking_pids)](https://www.postgresql.org/docs/18/functions-info.html)
- [PostgreSQL 18 documentation — Error Reporting and Logging (log_lock_waits, log_lock_failures)](https://www.postgresql.org/docs/18/runtime-config-logging.html)
- [PostgreSQL 18 documentation — ALTER TABLE (lock levels, ADD COLUMN, VALIDATE CONSTRAINT)](https://www.postgresql.org/docs/18/sql-altertable.html)
- [PostgreSQL 18 documentation — pgrowlocks](https://www.postgresql.org/docs/18/pgrowlocks.html)
- [PostgreSQL source — README.tuplock: how tuple locks and their waits work (REL_18_STABLE)](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/access/heap/README.tuplock)
- [PostgreSQL source — lock manager README: wait queues and deadlock detection (REL_18_STABLE)](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/storage/lmgr/README)
- [MySQL 8.4 Reference Manual — InnoDB Locking (record, gap, next-key and insert intention locks)](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking.html)
- [MySQL 8.4 Reference Manual — Deadlock Detection (innodb_deadlock_detect)](https://dev.mysql.com/doc/refman/8.4/en/innodb-deadlock-detection.html)
- [MySQL 8.4 Reference Manual — Metadata Locking](https://dev.mysql.com/doc/refman/8.4/en/metadata-locking.html)
- [MySQL 8.4 Reference Manual — Locking Reads (NOWAIT and SKIP LOCKED)](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html)
- [MySQL 8.0 Release Notes — Changes in MySQL 8.0.18 (deadlock detection moved to a background thread)](https://dev.mysql.com/doc/relnotes/mysql/8.0/en/news-8-0-18.html)
- [Microsoft Learn — Deadlocks guide (SQL Server)](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-deadlocks-guide)
- [Microsoft Learn — Transaction locking and row versioning guide (SQL Server)](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
