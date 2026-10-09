
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗃️ Database Internals & Performance](../../README.md#database-internals--performance)

# Transaction Isolation Levels

> What concurrent transactions can see of each other: the anomalies each isolation level allows and the defaults engines use.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Transaction Isolation Levels" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/isolation-levels.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Two runs at READ COMMITTED** | At PostgreSQL's default level, READ COMMITTED, each statement sees what was committed before that statement began. Acme's finance report (A) reads order 495179's total and customer 42's order count while a refund (B) and a new order (C) commit, so in one transaction it reads **51,179.03, then 47,193.60**, and **179, then 180** orders. Two staff selling product 2892 both read a stock of 10 and write 9: B's UPDATE waits for A's row lock, then writes 9 as well, so **two sales take the stock from 10 to 9**. |
| **2 · The anomalies, named** | PostgreSQL never shows uncommitted data: the read taken before B committed still returned 51,179.03, and READ UNCOMMITTED runs as READ COMMITTED. The changed total is a **non-repeatable read**, the new order a **phantom** and the stock a **lost update**; when both shift leads see 2 on duty and each signs off, leaving none, that is **write skew**. The SQL standard defines its levels by the first three: READ COMMITTED forbids dirty reads, REPEATABLE READ non-repeatable reads too, and SERIALIZABLE must give a result that some serial order could give (the dashed cells). |
| **3 · Stronger levels, retried** | **REPEATABLE READ** reads from one snapshot, taken at the transaction's first statement: the report sees 51,179.03 and 179 throughout, and B's stock UPDATE fails with *could not serialize access due to concurrent update*, SQLSTATE `40001`; B retries, reads 9 and writes 8. Write skew still commits, because the two leads changed different rows. **SERIALIZABLE** (serializable snapshot isolation) also tracks what each transaction read, and fails B's COMMIT with `40001` (*read/write dependencies among transactions*); the retry sees 1 on duty, so Malee stays. |
| **4 · Costs and other engines** | Eight sessions selling one product for 10 s (pgbench, median of 3 runs on a laptop): read-then-write at READ COMMITTED recorded 8,537 sales while the stock fell by only 1,090; REPEATABLE READ with up to 10 tries sold 2,707, retried 17,059 times and gave up on 1,841; `SELECT … FOR UPDATE` sold 6,902 by waiting instead, and one `UPDATE … SET qty = qty - 1` sold 9,718. PostgreSQL and SQL Server default to READ COMMITTED, MySQL's InnoDB to REPEATABLE READ: its plain reads keep one snapshot, yet the same stock run on MySQL 8.4 lost an update and raised no error. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's database runs many transactions at once: checkouts, refunds, stock updates, reports. Each one is written as if it ran alone, and in testing it usually does. In production they overlap, and what one transaction sees of another's work depends on the **isolation level** it runs at. A transaction that doesn't ask for one gets the engine's default, and on [PostgreSQL](../postgresql/) that default is READ COMMITTED.

The diagram replays three interleavings on PostgreSQL 18.6, each session a separate `psql` process and the statements sent in a fixed order by a script, so every value shown is what a session really received:

- **The finance report.** Session A reads order 495179's `total_thb` (51,179.03) and customer 42's order count (179). Meanwhile B refunds line 3 of that order (3,985.43) and commits, and C places a new order for customer 42 (id 500001). At READ COMMITTED the report, still inside one transaction, then reads 47,193.60 and 180: two different totals and two different counts on the same report.
- **The stock.** Two staff sell product 2892, which has 10 in stock. Each reads `qty`, computes 9 in the application and writes it. B's `UPDATE` waits for A's row lock; when A commits, B re-checks the row and writes 9 too. Two sales, but the stock went from 10 to 9.
- **The duty rule.** At least one of the two warehouse shift leads, Anan and Malee, must stay on duty. Each signs off through the app, which first counts the leads on duty (2, so it is allowed) and then updates its own row. Both commit, and nobody is on duty.

None of these raised an error. Each transaction was correct on its own; the bug lives in the overlap, it depends on timing, and it rarely shows up in tests.

## How it works

**The anomalies.** Each is a way a transaction can observe, or be hurt by, a concurrent one:

| Anomaly | What happens | In Acme's runs (READ COMMITTED) |
|---|---|---|
| Dirty read | A transaction reads a change that another has not committed and may still roll back | Never in PostgreSQL: while the refund was uncommitted, the report still read 51,179.03 |
| Non-repeatable read | The same row, read twice, has changed because another transaction committed in between | The total went from 51,179.03 to 47,193.60 |
| Phantom | The same search, run twice, returns a different set of rows because another transaction committed a row that matches | Customer 42's count went from 179 to 180 |
| Lost update | Two transactions read a value and both write a value computed from it; the second write erases the first | Two sales, stock 10 → 9 |
| Write skew | Two transactions read overlapping data and each writes a different row; each is fine alone, together they break a rule | Both leads signed off: 0 on duty |

**What the SQL standard requires.** The standard defines four levels by the first three anomalies (it calls them phenomena), and leaves everything else to SERIALIZABLE, which must produce a result that some one-at-a-time order of the same transactions could have produced. SERIALIZABLE is also the standard's default level.

| Level | Dirty read | Non-repeatable read | Phantom | PostgreSQL 18 |
|---|---|---|---|---|
| READ UNCOMMITTED | allowed | allowed | allowed | runs as READ COMMITTED: no dirty reads |
| READ COMMITTED | forbidden | allowed | allowed | as the standard |
| REPEATABLE READ | forbidden | forbidden | allowed | phantoms are not possible either |
| SERIALIZABLE | forbidden | forbidden | forbidden | anomalies of any kind are prevented |

The standard sets the minimum each level must protect against, so an engine may do more, as PostgreSQL does at READ UNCOMMITTED and REPEATABLE READ. In *A Critique of ANSI SQL Isolation Levels* (SIGMOD 1995), Berenson, Bernstein, Gray, Melton, O'Neil and O'Neil showed that the phenomena are worded ambiguously and fail to describe the levels real systems implement, including the classic locking ones. They argued for a broad reading of each phenomenon, added the ones the standard leaves out (dirty write, lost update, read skew and write skew among them), and defined **snapshot isolation**: every transaction reads from a snapshot of the data as of its start, and when two concurrent transactions write the same item only the first to commit succeeds. Snapshot isolation rules out the standard's three anomalies in their strict sense, yet it is not serializable, because it allows write skew. The paper also shows that a locking REPEATABLE READ and snapshot isolation can't be ranked: the first allows phantoms that snapshot isolation prevents, and prevents the write skew that snapshot isolation allows. That is why "REPEATABLE READ" means different guarantees in different engines.

**READ COMMITTED** gives every statement a fresh snapshot of what was committed when that statement began. That is the whole report story: the second read of the total, while B's refund was uncommitted, still saw 51,179.03; the third read began after B's commit and saw 47,193.60. A write that finds its target row changed by a transaction still in progress waits for it; if that transaction commits, PostgreSQL re-evaluates the `WHERE` clause against the new version of the row and applies the write to it. That is why B's `UPDATE stock SET qty = 9` went through after A's commit: the row still matched, and the 9 B had computed from its stale read replaced A's 9.

**REPEATABLE READ** is PostgreSQL's snapshot isolation. The transaction takes one snapshot at its first statement (not at `BEGIN`) and reads from it until it ends, so the report read 51,179.03 and 179 every time while the refund and the new order committed around it. Writes check their target against the snapshot: B's `UPDATE` waited for A's row lock, and once A committed a change B's snapshot could not see, B failed with `ERROR: could not serialize access due to concurrent update`. Every serialization failure carries SQLSTATE `40001`. The application rolls back and runs the whole transaction again, which reads 9 and writes 8. The duty rule still broke: Anan and Malee each updated a different row, so there was no conflicting write to detect, and both committed.

**SERIALIZABLE** is snapshot isolation plus checks for serialization anomalies, a technique called **Serializable Snapshot Isolation** (SSI). It was proposed by Cahill, Röhm and Fekete (SIGMOD 2008), and PostgreSQL 9.1 shipped the first implementation in a production database release, described by Ports and Grittner (VLDB 2012). Each serializable transaction records what it read as predicate locks, which `pg_locks` lists with the mode `SIReadLock`; they never block anyone. In the duty run each session held two: one on the whole `shift_leads` table, because the count used a sequential scan, and one on page 1 of `shift_leads_pkey`, which its `UPDATE … WHERE id = …` read. When a transaction writes data that a concurrent one read, PostgreSQL records a read/write conflict between them. Every anomaly that snapshot isolation allows contains a "dangerous structure": one transaction, the pivot, with a read/write conflict coming in and another going out. Here B read Anan's row, which A then changed, and A read Malee's row, which B then changed, which made B the pivot. A committed first, and B's `COMMIT` failed with `could not serialize access due to read/write dependencies among transactions`, with the detail `Canceled on identification as a pivot, during commit attempt`. On retry B counted 1 lead on duty, so the app kept Malee on duty. The check can report a failure where no real anomaly exists, which costs an extra retry but never a wrong result.

| What our runs saw on PostgreSQL 18.6 | READ COMMITTED | REPEATABLE READ | SERIALIZABLE |
|---|---|---|---|
| Dirty read | no | no | no |
| Non-repeatable read | yes: 47,193.60 | no | no |
| Phantom | yes: 180 | no | no |
| Lost update | yes: stock 9 | `40001`, retried: 8 | `40001`, retried: 8 |
| Write skew | yes: 0 on duty | yes: 0 on duty | `40001`, retried: Malee stays |

## Try it

The sample data comes from [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop), a script that builds the template database `acme` on PostgreSQL 18 in about a minute.

Run this in `psql`, connected as a superuser. The `psql` session is A; sessions B and C are second and third connections opened with the `dblink` extension, which ships with PostgreSQL. The server makes those connections itself, over its local socket and without a password, which the official Docker image allows; elsewhere add a host and a password to the connection strings. `dblink_send_query` starts B's `UPDATE` without waiting for it, so that A can commit while B waits for A's lock. The comments show one run; the levels named in the comments at each `BEGIN` give the other results in the table above.

```sql
CREATE DATABASE isolation_levels_try TEMPLATE acme STRATEGY FILE_COPY;
\c isolation_levels_try
CREATE EXTENSION dblink;
CREATE TABLE stock (product_id bigint PRIMARY KEY REFERENCES products, qty int NOT NULL);
INSERT INTO stock VALUES (2892, 10);
CREATE TABLE shift_leads (id int PRIMARY KEY, name text NOT NULL, on_duty boolean NOT NULL);
INSERT INTO shift_leads VALUES (1, 'Anan', true), (2, 'Malee', true);
SELECT dblink_connect('b', 'dbname=isolation_levels_try');   -- session B
SELECT dblink_connect('c', 'dbname=isolation_levels_try');   -- session C
\set tot 'SELECT total_thb FROM orders WHERE id = 495179'
\set cnt 'SELECT count(*) FROM orders WHERE customer_id = 42'

-- 1. The report (this session, A) while B refunds and C places an order
BEGIN ISOLATION LEVEL READ COMMITTED;   -- then run it again with REPEATABLE READ
:tot;                                                       -- 51179.03
:cnt;                                                       -- 179
SELECT dblink_exec('b', 'BEGIN');
SELECT dblink_exec('b', 'UPDATE orders SET total_thb = total_thb - 3985.43 WHERE id = 495179');
:tot;                                                       -- 51179.03  (B not committed)
SELECT dblink_exec('b', 'COMMIT');
SELECT * FROM dblink('c', $$INSERT INTO orders (customer_id, status, shipping_country, created_at, total_thb)
  VALUES (42, 'pending', 'TH', '2026-10-02 18:00+00', 1290.00) RETURNING id$$) AS t(id bigint);   -- 500001
:tot;                                                       -- 47193.60  REPEATABLE READ: 51179.03
:cnt;                                                       -- 180       REPEATABLE READ: 179
COMMIT;
UPDATE orders SET total_thb = 51179.03 WHERE id = 495179;   -- undo, for the next run
DELETE FROM orders WHERE id > 500000;
SELECT setval(pg_get_serial_sequence('orders', 'id'), 500000);

-- 2. Two staff sell product 2892: read the stock, then write the new value
BEGIN ISOLATION LEVEL REPEATABLE READ;  -- READ COMMITTED: B's UPDATE returns UPDATE 1; committed, it leaves 9
SELECT qty FROM stock WHERE product_id = 2892;              -- 10
SELECT dblink_exec('b', 'BEGIN ISOLATION LEVEL REPEATABLE READ');
SELECT * FROM dblink('b', 'SELECT qty FROM stock WHERE product_id = 2892') AS t(qty int);   -- 10
UPDATE stock SET qty = 9 WHERE product_id = 2892;
SELECT dblink_send_query('b', 'UPDATE stock SET qty = 9 WHERE product_id = 2892');   -- B waits for A
SELECT pg_sleep(0.5);
COMMIT;
SELECT * FROM dblink_get_result('b', false) AS t(status text);
-- NOTICE:  could not serialize access due to concurrent update        (SQLSTATE 40001)
SELECT * FROM dblink_get_result('b') AS t(status text);    -- (0 rows): B's connection is free
SELECT dblink_exec('b', 'ROLLBACK');                        -- B retries in a new transaction
SELECT dblink_exec('b', 'BEGIN ISOLATION LEVEL REPEATABLE READ');
SELECT * FROM dblink('b', 'SELECT qty FROM stock WHERE product_id = 2892') AS t(qty int);   -- 9
SELECT dblink_exec('b', 'UPDATE stock SET qty = 8 WHERE product_id = 2892');
SELECT dblink_exec('b', 'COMMIT');
SELECT qty FROM stock WHERE product_id = 2892;              -- 8

-- 3. Write skew: at least one shift lead must stay on duty
BEGIN ISOLATION LEVEL SERIALIZABLE;     -- with REPEATABLE READ, both commit and 0 stay on duty
SELECT count(*) FROM shift_leads WHERE on_duty;             -- 2
SELECT dblink_exec('b', 'BEGIN ISOLATION LEVEL SERIALIZABLE');
SELECT * FROM dblink('b', 'SELECT count(*) FROM shift_leads WHERE on_duty') AS t(n bigint);   -- 2
UPDATE shift_leads SET on_duty = false WHERE id = 1;
SELECT dblink_exec('b', 'UPDATE shift_leads SET on_duty = false WHERE id = 2');
SELECT mode, locktype, relation::regclass, page FROM pg_locks WHERE mode = 'SIReadLock' ORDER BY pid, 2;
--     mode    | locktype |     relation     | page    (one row like these per session)
--  SIReadLock | page     | shift_leads_pkey |    1
--  SIReadLock | relation | shift_leads      |
COMMIT;
SELECT dblink_exec('b', 'COMMIT');
-- ERROR:  could not serialize access due to read/write dependencies among transactions
-- DETAIL:  Reason code: Canceled on identification as a pivot, during commit attempt.
SELECT name, on_duty FROM shift_leads ORDER BY id;          -- Anan f, Malee t
```

## When to use it

Choose the level per transaction, for what that transaction needs:

- **READ COMMITTED** suits the many transactions that do their work in single statements: an `UPDATE stock SET qty = qty - 1 WHERE product_id = 2892 AND qty > 0` reads and writes the current row in one step, so concurrent sales queue on the row lock and none is lost. It is the wrong level for a read, a decision in the application, and then a write based on that read, unless that read locks the rows it depends on (below).
- **REPEATABLE READ** suits reports and exports that run several queries and need them to agree with each other, such as the finance report. A transaction that only reads never fails with a serialization error at this level. Transactions that read, decide and then write the same rows get `40001` instead of a lost update, and must be retried.
- **SERIALIZABLE** suits rules that span several rows or tables and that no constraint can express: at least one lead on duty, no double booking of a room, a credit limit across all of a customer's accounts. Each transaction only has to be correct when run alone; the database rolls back any one whose concurrent result could differ from running them one at a time. Every transaction that takes part, read-only ones included, needs the retry loop.
- **Explicit locks** are the alternative at READ COMMITTED when you know which rows a decision depends on. `SELECT qty FROM stock WHERE product_id = 2892 FOR UPDATE` made B wait at its read, so B read 9 and wrote 8 with no retry. For the duty rule, `SELECT id, name FROM shift_leads WHERE on_duty FOR UPDATE` locks both leads' rows: B waited for A, and then got only Malee's row, because Anan's no longer matched. Locks cannot protect rows that do not exist yet; a phantom insert needs SERIALIZABLE, a unique or exclusion constraint, or a lock on a parent row.
- **Constraints** beat all of these where they apply: a `CHECK (qty >= 0)` with the single-statement `UPDATE`, a unique index, an exclusion constraint against overlapping bookings.

## Trade-offs

- **Retries cost throughput under contention.** Eight pgbench sessions sold product 2892 for 10 seconds each way (median of three runs on a laptop, a shared machine, so treat the numbers as rough):

  | How each sale updates the stock | Sales in 10 s | Retries | Gave up after 10 tries | Stock decremented |
  |---|---|---|---|---|
  | READ COMMITTED, read then write | 8,537 | 0 | 0 | 1,090 (7,447 decrements lost) |
  | REPEATABLE READ, read then write | 2,707 | 17,059 | 1,841 | 2,707 |
  | READ COMMITTED, `SELECT … FOR UPDATE` | 6,902 | 0 | 0 | 6,902 |
  | READ COMMITTED, `UPDATE … SET qty = qty - 1` | 9,718 | 0 | 0 | 9,718 |

  pgbench simply repeats a failed transaction after rolling it back; real code should wait between attempts, with [backoff and jitter](../retry-with-backoff/), and cap them. These conflicts arise only between transactions that write the same rows, so one hot row is the worst case; spread over many products, the same load conflicts far less often.
- **Retry the whole transaction, and only the transaction.** Rerun everything from `BEGIN`, including the reads and the application logic that chose the values, since the data they were based on has changed. PostgreSQL does not retry for you. Retry `40001` always, and the deadlock error `40P01` too (see [Locks & Deadlocks](../locks-and-deadlocks/)). Keep side effects such as emails, payments and messages out of the retried block, or make them safe to repeat with an idempotency key ([Idempotent Consumer](../idempotent-consumer/)).
- **Long transactions hurt more at higher levels.** A REPEATABLE READ or SERIALIZABLE transaction keeps its snapshot to the end, so the longer it runs, the more concurrent changes it can conflict with; at SERIALIZABLE its SIRead locks often outlive its commit, until the read-write transactions that overlapped it finish. An open snapshot also holds back cleanup of old row versions ([MVCC](../mvcc/)). Keep transactions short, run a long report as `SERIALIZABLE READ ONLY DEFERRABLE` (it may wait once for a safe snapshot, then can neither fail nor make others fail with a serialization error), and set `idle_in_transaction_session_timeout`, or `transaction_timeout` (PostgreSQL 17 and later).
- **SSI needs some care.** A sequential scan takes a predicate lock on the whole table, which raises the chance of false-positive failures; indexes keep the locks narrow. When the predicate lock table runs short of memory, PostgreSQL merges locks into coarser ones, raising the failure rate again (`max_pred_locks_per_transaction` and its relatives raise the limits). Declare read-only transactions `READ ONLY`, keep the number of active connections down with a pool, and drop the explicit locks that SERIALIZABLE makes unnecessary.
- **Explicit locks trade retries for waiting.** Waiting sessions hold connections, and two transactions that lock the same rows in different orders deadlock.
- **Isolation ends at the database.** A business process spread over several services and databases gets no isolation between its local transactions; a [saga](../saga-orchestration/) has to design for intermediate states and compensate instead, and [optimistic concurrency](../optimistic-concurrency/) with a version column protects a record across a user's think time, where no transaction can stay open.

## Implementation notes

- **Setting the level.** `BEGIN ISOLATION LEVEL …`, or `SET TRANSACTION ISOLATION LEVEL …` before the transaction's first query. `default_transaction_isolation` changes the default for a session, a role (`ALTER ROLE … SET`) or a database. Most drivers expose the level on the connection or transaction object; check that yours sends it, rather than assuming.
- **Error codes.** Serialization failures always carry SQLSTATE `40001` (`serialization_failure`), whatever the message text; deadlocks carry `40P01`. A unique violation (`23505`) can also be a serialization problem in disguise, for example two transactions that both checked a key was free and then inserted it; PostgreSQL's documentation suggests retrying those only where that is the likely cause, since they can also be permanent errors.
- **MySQL 8.4 (InnoDB)** defaults to REPEATABLE READ. Plain `SELECT`s are consistent reads from a snapshot taken at the transaction's first read, so on MySQL the report saw 51,179.03 throughout. Locking reads (`FOR SHARE`, `FOR UPDATE`), `UPDATE` and `DELETE` work on the latest committed rows instead: they lock what they find, and for a range they also lock the gaps between index records (next-key locks), so other sessions cannot insert into the range. A `SELECT count(*) … FOR SHARE` on customer 42 made a concurrent insert for customer 42 wait. Unlike PostgreSQL's REPEATABLE READ, InnoDB does not fail a write to a row changed since the snapshot: the stock run on MySQL lost an update with no error, B's `UPDATE` reporting `Rows matched: 1, Changed: 0` and the stock ending at 9. With `FOR UPDATE` on the reads it ended at 8. At SERIALIZABLE InnoDB turns plain `SELECT`s into `SELECT … FOR SHARE` when autocommit is off, so both sessions held shared locks, B's `UPDATE` hit a deadlock (`ERROR 1213 (40001)`) and was rolled back, and the write-skew run failed the same way. READ UNCOMMITTED really does read uncommitted data on InnoDB: our report read 47,193.60 while the refund was still open.
- **SQL Server** defaults to READ COMMITTED. With the database option `READ_COMMITTED_SNAPSHOT` off, the default for SQL Server and Azure SQL Managed Instance, reads take shared locks and wait for writers; with it on, the default on Azure SQL Database, each statement reads from a row-version snapshot instead. Either way it is statement-level, so the report's anomalies, lost updates and write skew remain possible. The `SNAPSHOT` level (after `ALLOW_SNAPSHOT_ISOLATION ON`) is transaction-level snapshot isolation that ends a transaction with error 3960 on an update conflict; its SERIALIZABLE uses key-range locks held to the end of the transaction.
- **Oracle Database** defaults to READ COMMITTED and offers SERIALIZABLE and READ ONLY. Its SERIALIZABLE reads from a snapshot taken when the transaction began and fails with `ORA-08177` when it tries to change rows that another transaction changed and committed after that point, much like PostgreSQL's REPEATABLE READ.
- **Managed services.** On [Amazon RDS & Aurora](../amazon-rds-aurora/) you run the engine itself, with its levels. One documented difference: the writer of an Aurora MySQL cluster offers the same four levels as RDS for MySQL, but its read-only replicas always use REPEATABLE READ and ignore `SET TRANSACTION ISOLATION LEVEL`, unless a session turns on `aurora_read_replica_read_committed` to run long queries at READ COMMITTED. [Amazon DynamoDB](../amazon-dynamodb/) has no levels to choose: `TransactWriteItems` and `TransactGetItems` are serializable with respect to other writes and to `GetItem`, while `Query`, `Scan` and `BatchGetItem` as a whole are only read-committed against transactions. For a read-then-write on one item, a conditional write that checks a version attribute detects the conflict and the application retries ([Optimistic Concurrency Control](../optimistic-concurrency/)).
- **The diagram's runs** used a copy of the sample data on PostgreSQL 18.6 and a MySQL 8.4.11 server. Each session was a separate client process, fed its statements by a script in the order shown, with a half-second to one-second pause wherever a session had to wait for another's lock.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [MVCC](../mvcc/) — Multi-version concurrency control: an update writes a new row version, readers see a snapshot, and vacuum removes dead versions.
- [Locks & Deadlocks](../locks-and-deadlocks/) — Row locks make writers wait for each other; two transactions waiting on each other is a deadlock, and the database aborts one.
- [Optimistic Concurrency Control](../optimistic-concurrency/) — Update a row only if it is unchanged since you read it, using a version column, and retry on conflict instead of holding locks.
- [Write-Ahead Log](../write-ahead-log/) — Log each change before applying it, so a commit survives a crash, recovery replays the log, and replicas and backups follow it.
- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.
- [Retry with Backoff & Jitter](../retry-with-backoff/) — Retry transient failures with growing, randomised delays so clients don't stampede.
- [Saga (Orchestration)](../saga-orchestration/) — A coordinator runs local transactions in sequence and triggers compensations when one fails.

## References

- [PostgreSQL 18 documentation — Transaction Isolation](https://www.postgresql.org/docs/18/transaction-iso.html)
- [PostgreSQL 18 documentation — Serialization Failure Handling](https://www.postgresql.org/docs/18/mvcc-serialization-failure-handling.html)
- [PostgreSQL 18 documentation — Data Consistency Checks at the Application Level](https://www.postgresql.org/docs/18/applevel-consistency.html)
- [PostgreSQL 18 documentation — SET TRANSACTION](https://www.postgresql.org/docs/18/sql-set-transaction.html)
- [PostgreSQL 18 documentation — Client Connection Defaults (transaction_timeout)](https://www.postgresql.org/docs/18/runtime-config-client.html)
- [PostgreSQL 18 documentation — pgbench (serialization and deadlock retries)](https://www.postgresql.org/docs/18/pgbench.html)
- [PostgreSQL source — README-SSI, the serializable implementation (REL_18_STABLE)](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/storage/lmgr/README-SSI)
- [Berenson, Bernstein, Gray, Melton, O'Neil and O'Neil — A Critique of ANSI SQL Isolation Levels (SIGMOD 1995)](https://arxiv.org/abs/cs/0701157)
- [Ports and Grittner — Serializable Snapshot Isolation in PostgreSQL (PVLDB 5(12), 2012)](https://www.vldb.org/pvldb/vol5/p1850_danrkports_vldb2012.pdf)
- [MySQL 8.4 Reference Manual — Transaction Isolation Levels](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html)
- [MySQL 8.4 Reference Manual — Consistent Nonlocking Reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-consistent-read.html)
- [MySQL 8.4 Reference Manual — Locking Reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html)
- [MySQL 8.4 Reference Manual — Phantom Rows (next-key locking)](https://dev.mysql.com/doc/refman/8.4/en/innodb-next-key-locking.html)
- [Microsoft Learn — SET TRANSACTION ISOLATION LEVEL (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/statements/set-transaction-isolation-level-transact-sql)
- [Microsoft Learn — Transaction locking and row versioning guide](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide)
- [Oracle AI Database 26ai Concepts — Data Concurrency and Consistency](https://docs.oracle.com/en/database/oracle/oracle-database/26/cncpt/data-concurrency-and-consistency.html)
- [Amazon Aurora User Guide — Aurora MySQL isolation levels](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraMySQL.Reference.IsolationLevels.html)
- [Amazon DynamoDB Developer Guide — Transactions: how it works (isolation levels)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
