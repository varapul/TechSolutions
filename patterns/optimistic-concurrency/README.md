
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗃️ Database Internals & Performance](../../README.md#database-internals--performance)

# Optimistic Concurrency Control

> Update a row only if it is unchanged since you read it, using a version column, and retry on conflict instead of holding locks.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Optimistic Concurrency Control" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/optimistic-concurrency.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Last write wins** | Agents A and B open order 499996 in Acme's back-office tool and edit its shipping address for a few minutes. A fixes the house number to **88/5** and saves; later B saves the address B loaded with the postcode **10110** added. Both saves report `UPDATE 1`, the row ends as `88 Sukhumvit 11, Bangkok 10110`, and A's fix is gone without anyone being told: a **lost update**, which even SERIALIZABLE transactions don't catch, because B's read happened in a transaction that had already ended. |
| **2 · Save only if unchanged** | A `version` column (4 ms to add to 500,000 rows, because PostgreSQL stores the default in the table's metadata instead of rewriting it) travels with every read. Each save is `UPDATE … SET …, version = version + 1 WHERE id = $1 AND version = $2 RETURNING version`: A's matches and returns **2**, B's still carries version 1 and matches **0 rows**, which the tool reports as a conflict. When both saves arrive at once, B's UPDATE waits for A's row lock and then re-checks its WHERE clause on the row A committed, so the check and the write are one atomic step. |
| **3 · If-Match over HTTP** | The API sends the version as a strong ETag (`ETag: "1"`) and expects it back in `If-Match` on every save, running the same checked UPDATE. A's `PUT` gets `200 OK` with `ETag: "2"`; B's gets **412 Precondition Failed** and writes nothing, so B's tool reloads, shows both edits and saves the merge with `If-Match: "2"` (version 3). DynamoDB does the same with a condition expression on a version attribute and rejects a stale write with `ConditionalCheckFailedException`. |
| **4 · Limits and alternatives** | Holding `SELECT … FOR UPDATE` while A thinks blocks B until `lock_timeout` cancels it (`ERROR 55P03`), and with the default of 0 B waits as long as A thinks. On a hot row optimism backfires: 8 sessions saving one stock row 100 times each needed **5,019 attempts** for 800 saves, while row locks or a single `UPDATE … SET qty = qty - 1` needed no retries. Use a counter as the version: a MySQL `DATETIME` changes at most once a second, and PostgreSQL's `xmin` changes on every UPDATE but is 32-bit and wraps. |
<!-- END GENERATED: header -->

## The problem

A back-office screen loads a record, a person edits it for a while, and the screen saves it. The load and the save are separate requests, and so separate database transactions: nothing ties the save to what was read. If two people edit the same record in that window, the second save is built from a copy that is already out of date, and it silently replaces the first. This is the **lost update**.

At Acme Shop, agents A and B both open order 499996, which is paid but not yet shipped, and its shipping address reads `88 Sukhumvit 11, Bangkok`. The customer phones A to correct the house number, and A saves `88/5 Sukhumvit 11, Bangkok`. A minute later B, who loaded the order before A saved, adds the postcode from the customer's email and saves `88 Sukhumvit 11, Bangkok 10110`. In the run behind this page ([PostgreSQL](../postgresql/) 18.6 in Docker on a laptop, a Node.js script with one connection per agent, and the minutes of editing shortened to a second), both statements answered `UPDATE 1`. The row ended with B's text, the `/5` was gone, and neither agent heard about it: the parcel would go to house 88.

A stricter isolation level doesn't help, because an isolation level only governs what happens inside one transaction (see [Transaction Isolation Levels](../isolation-levels/)). B's read ran in a transaction that had ended minutes before B's save began. In the same run, each save wrapped in `BEGIN ISOLATION LEVEL SERIALIZABLE … COMMIT` still committed, with the same result. The database can't tell that B's new value came from an old read unless the save says what it read.

## How it works

**The idea.** H. T. Kung and John T. Robinson's 1981 paper *On Optimistic Methods for Concurrency Control* proposed controlling concurrency without locks. A transaction reads freely and keeps its writes in private copies (the read phase), then checks that nothing it relied on was changed by others in the meantime (validation), and only then makes its writes visible (the write phase); a transaction that fails validation is backed up and runs again. It pays off when conflicts are rare, so that checking at the end costs less than locking everything in advance. Applications make the same bet across requests: Martin Fowler's *Patterns of Enterprise Application Architecture* describes it as **Optimistic Offline Lock** (a pattern written by David Rice), where one business transaction spans several system transactions and the check runs in the one that saves.

**A version column.** Give the row a counter and hand it out with every read:

```sql
ALTER TABLE orders ADD COLUMN version integer NOT NULL DEFAULT 1;
```

PostgreSQL stores a non-volatile default like this in the table's metadata instead of rewriting the table, so the statement took 4 ms on 500,000 orders, and every existing row reads as version 1. Each save then names the version it started from and moves it on, in one statement:

```sql
UPDATE orders SET shipping_address = $3, version = version + 1
WHERE id = $1 AND version = $2
RETURNING version;
```

A's save carried version 1, matched the row and returned 2. B's save also carried version 1, but the row was at version 2 by then, so the statement matched nothing: no row came back and the command tag was `UPDATE 0`. PostgreSQL doesn't treat a count of 0 as an error, so the application has to check the count and report the conflict. Because nothing was written, B's tool can reload the order (version 2, with A's `/5`), show B both edits, and save the merge against version 2, which returned 3.

**Why the check can't race.** The comparison and the write happen in one statement, and the database serializes concurrent writers on the row. If both saves arrive at the same moment, the first `UPDATE` takes the row lock and the second waits. In the run, with A's save still uncommitted, `pg_locks` showed B's backend waiting for a `ShareLock` on A's transaction id (148865), `granted = false`. Once A committed, PostgreSQL re-evaluated B's `WHERE` clause against the row version A had just written, which READ COMMITTED does for any `UPDATE` that waited on a concurrent writer. It found version 2, and B's statement ended with `UPDATE 0`. When B's transaction was REPEATABLE READ instead, it failed with `ERROR: could not serialize access due to concurrent update` (SQLSTATE 40001), which also means "reload and try again". A `SELECT version` followed by a separate unconditional `UPDATE` has none of this protection, since another save can land between the two. [Locks & Deadlocks](../locks-and-deadlocks/) covers row locks and the waits they cause, and [MVCC](../mvcc/) the row versions an update writes.

**Over HTTP.** The version belongs in the API, and HTTP already has the headers for it ([RFC 9110](https://www.rfc-editor.org/rfc/rfc9110)):

- A `GET` returns the representation with an entity tag that changes whenever the data does: `ETag: "1"`.
- A save sends the tag back as a precondition: `PUT /orders/499996` with `If-Match: "1"`. The server must evaluate it before applying the method, must not apply the method when it is false, and can then answer `412 Precondition Failed`.
- `If-Match` uses the **strong** comparison: a weak tag such as `W/"1"` never matches, even itself. RFC 9110 describes If-Match as the usual guard against lost updates when several clients act on the same resource.
- A server can refuse unconditional saves with `428 Precondition Required` ([RFC 6585](https://www.rfc-editor.org/rfc/rfc6585#section-3)), so a client that forgets the header can't fall back to last write wins.

Acme's API maps `If-Match` onto the version check. In the run, A's `PUT` with `If-Match: "1"` got `200 OK` and `ETag: "2"`. B's `PUT` with `If-Match: "1"` ran `UPDATE … AND version = 1`, matched no row, and got `412`. B's tool reloaded the order (`ETag: "2"`) and saved the merge with `If-Match: "2"`: `200 OK`, `ETag: "3"`, and the row reads `88/5 Sukhumvit 11, Bangkok 10110`. Sending B's stale request a second time got `412` again and changed nothing, a `PUT` without `If-Match` got `428`, and one with `If-Match: W/"3"` got `412`.

**Handle the conflict in the UI.** A conflict is a prompt, not a crash. Show the agent the current value next to their draft, let them merge, and save against the new version. Re-sending the same request is harmless (it can only fail again), but re-sending the draft with the new ETag and no merge is last write wins with extra steps. Some forms can merge automatically when the two edits touch different fields; the same address field, as here, needs a person.

**ORMs do the bookkeeping.** They add the version to the `WHERE` clause of every update and delete, and turn a count of 0 into an exception:

| Framework | Version | A stale save raises |
|---|---|---|
| Hibernate 7.4 (Jakarta Persistence) | a `@Version` attribute: an integer type, or a timestamp | `OptimisticLockException` |
| EF Core | a `[ConcurrencyCheck]` property the app changes on every save, or `[Timestamp]` (SQL Server `rowversion`; with Npgsql a `uint` mapped to `xmin`) | `DbUpdateConcurrencyException` |
| Rails 8.1 (Active Record) | a `lock_version` integer column | `ActiveRecord::StaleObjectError` |
| SQLAlchemy 2.0 | `version_id_col` in `__mapper_args__` | `StaleDataError` |

Hibernate can also check optimistically without a version column: `@OptimisticLocking` compares all fields, or only the changed ones, in the `WHERE` clause.

**DynamoDB and other stores.** [Amazon DynamoDB](../amazon-dynamodb/) has no `WHERE` clause on writes, but it has the same primitive: a conditional write. An `UpdateItem` with the condition `version = :read` and the update `SET version = version + :one` succeeds only if the item still holds the version you read. Otherwise it fails with `ConditionalCheckFailedException` (HTTP 400) and changes nothing, although the failed write still consumes write capacity. Setting `ReturnValuesOnConditionCheckFailure` to `ALL_OLD` returns the current item with the error, which saves a read before the merge. In the AWS SDK for Java 2.x, the enhanced client's `VersionedRecordExtension` (with `@DynamoDbVersionAttribute`) adds the condition and the increment for you. DynamoDB's guide recommends optimistic locking for single items with infrequent conflicts, transactions for updates that span items, and warns that global tables settle concurrent writes in different Regions as last writer wins, so a version check in one Region can't stop a write in another. Amazon S3 accepts `If-Match` on `PutObject` and answers `412` when the object's ETag has changed (see [Amazon S3](../amazon-s3/)), and Kubernetes rejects an update with a stale `resourceVersion` with `409 Conflict`. [Event Sourcing](../event-sourcing/) guards each stream the same way, with an expected version on every append.

## Try it

The sample data comes from [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop), a script that builds the template database `acme` on PostgreSQL 18 in about a minute.

Run it in `psql` against a fresh copy. One `psql` session plays both agents: each statement commits on its own, as the tool's requests do, and `\gset` keeps the version each agent read. Section 4 opens a second connection with the `dblink` extension, which ships with PostgreSQL, to show two saves racing. That connection is made by the server itself, over its local socket and without a password, which the official Docker image allows; elsewhere add a host and a password to the connection string. Transaction ids will differ on your machine.

```sql
CREATE DATABASE optimistic_concurrency TEMPLATE acme STRATEGY FILE_COPY;
\c optimistic_concurrency
ALTER TABLE orders ADD COLUMN shipping_address text;
UPDATE orders SET shipping_address = '88 Sukhumvit 11, Bangkok' WHERE id = 499996;

-- 1. Last write wins. Agents A and B both read the address (not shown), then save
--    in turn. Each statement is a transaction of its own, as in the back-office tool.
UPDATE orders SET shipping_address = '88/5 Sukhumvit 11, Bangkok' WHERE id = 499996;      -- A
UPDATE orders SET shipping_address = '88 Sukhumvit 11, Bangkok 10110' WHERE id = 499996;  -- B
SELECT shipping_address FROM orders WHERE id = 499996;
--  88 Sukhumvit 11, Bangkok 10110          A's /5 is gone, and both saves said UPDATE 1

-- 2. A version column. With a constant default this changes only the table's metadata:
--    no table rewrite, every existing row reads as version 1.
UPDATE orders SET shipping_address = '88 Sukhumvit 11, Bangkok' WHERE id = 499996;
ALTER TABLE orders ADD COLUMN version integer NOT NULL DEFAULT 1;
SELECT shipping_address, version FROM orders WHERE id = 499996 \gset a_
SELECT shipping_address, version FROM orders WHERE id = 499996 \gset b_
UPDATE orders SET shipping_address = '88/5 Sukhumvit 11, Bangkok', version = version + 1
WHERE id = 499996 AND version = :a_version RETURNING version;
--  version
--        2
--  UPDATE 1
UPDATE orders SET shipping_address = '88 Sukhumvit 11, Bangkok 10110', version = version + 1
WHERE id = 499996 AND version = :b_version RETURNING version;
--  (0 rows)
--  UPDATE 0                                 the conflict: nothing was written

-- 3. B reloads (version 2), merges both edits and saves again
SELECT shipping_address, version FROM orders WHERE id = 499996 \gset b_
UPDATE orders SET shipping_address = '88/5 Sukhumvit 11, Bangkok 10110', version = version + 1
WHERE id = 499996 AND version = :b_version RETURNING version;
--  version
--        3

-- 4. Both saves at the same instant. A's save is still open; B's goes through a
--    second connection (dblink), waits for A's row lock, then re-checks its WHERE
--    clause against the row A committed.
CREATE EXTENSION dblink;
SELECT dblink_connect('agent_b', 'dbname=optimistic_concurrency');
BEGIN;
UPDATE orders SET shipping_address = '88/5 Sukhumvit 11, Bangkok 10110', version = version + 1
WHERE id = 499996 AND version = 3;
SELECT dblink_send_query('agent_b', $$UPDATE orders SET shipping_address = '88 Sukhumvit 11, Bangkok 10110',
  version = version + 1 WHERE id = 499996 AND version = 3$$);
SELECT pg_sleep(0.5);
SELECT l.locktype, l.mode, l.granted, l.transactionid = pg_current_xact_id()::xid AS on_a
FROM pg_locks l WHERE l.locktype = 'transactionid' AND NOT l.granted;
--     locktype    |   mode    | granted | on_a
--  transactionid  | ShareLock | f       | t       B waits for A's transaction to end
COMMIT;
SELECT * FROM dblink_get_result('agent_b') AS t(status text);
--   status
--  UPDATE 0                                 version is 4 now, so B's check fails
SELECT dblink_disconnect('agent_b');

-- 5. xmin, the row version's inserting transaction, changes on every update,
--    even one that changes nothing
SELECT xmin, version FROM orders WHERE id = 499996;
UPDATE orders SET shipping_address = shipping_address WHERE id = 499996;
SELECT xmin, version FROM orders WHERE id = 499996;
--  xmin is a new transaction id; version is still 4
```

## When to use it

- **A read, a pause, then a save.** Forms, admin tools, REST APIs and mobile apps that sync later all read a record in one request and write it in another. You can't hold a transaction open while a person types, and conflicts on any one record are rare, so checking at save time is cheap.
- **Many records, few writers each.** In the run, 8 sessions saving 100 times each to 8 different rows made exactly 800 attempts: no conflicts, 0.16 s in all.

Choose something else when:

- **The database can compute the new value.** `UPDATE stock SET qty = qty - 1 WHERE product_id = $1 AND qty > 0` reads nothing first, so there is no version to compare; the row lock alone keeps concurrent updates correct. In the run it did 800 saves to one row in 0.19 s.
- **A row is hot.** With 8 sessions saving the stock row of product 7689 100 times each, read-then-check-and-retry needed **5,019 attempts** for 800 saves (4,219 conflicts, 84 %) and took 1.1 s, while `SELECT … FOR UPDATE` followed by an `UPDATE` needed 800 attempts and 0.7 s, because the sessions queued on the row lock instead of redoing work. Backing off between retries ([Retry with Backoff](../retry-with-backoff/)) spreads the attempts out but doesn't remove the contention; send the writes through one consumer instead ([Queue-Based Load Leveling](../queue-based-load-leveling/)), or split the hot row.
- **A conflict throws away expensive work.** If a redo costs an hour of editing, let people check a record out instead (Fowler's *Pessimistic Offline Lock*): a lock the application records, with an owner and an expiry so that an abandoned edit doesn't block the record for good. It is still not a database lock.

Never hold a database lock across a person's think time. In the run, A's tool opened a transaction and ran `SELECT … FOR UPDATE` while A edited. B's `SELECT … FOR UPDATE` then waited until `lock_timeout = '5s'` cancelled it with `ERROR: canceling statement due to lock timeout` (SQLSTATE 55P03). `lock_timeout` defaults to 0, which disables it, so B would otherwise have waited until A's transaction ended. Meanwhile A's session sat `idle in transaction`, keeping a connection busy and stopping vacuum from removing row versions that only it might still need; `idle_in_transaction_session_timeout`, also 0 by default, can end such sessions.

## Trade-offs

- **Conflicts surface late.** The agent finds out after the work is done, so the conflict screen matters as much as the check. Keep the window short and the merge easy.
- **Every writer has to take part.** A batch job or a manual `UPDATE` that doesn't bump the version slips past every check. Route all writes through code that bumps it, or make a `BEFORE UPDATE` trigger set `NEW.version := OLD.version + 1` (and stop the application from bumping it as well), or use a version the database maintains, such as SQL Server's `rowversion`.
- **A timestamp is a weaker version than a counter.** It only changes when the clock does. MySQL's `DATETIME` and `TIMESTAMP` keep whole seconds unless declared with fractional digits, and in a MySQL 8.4 run an edit saved in the same second that B read the row left `updated_at` unchanged: B's `WHERE updated_at = …` still matched, and A's `/5` was lost. Hibernate's guide calls timestamps a less reliable way to lock optimistically than version numbers, and HTTP treats a `Last-Modified` date as a weak validator unless it can show otherwise, for the same reason: it has one-second steps. PostgreSQL's `timestamptz` holds microseconds, but `now()` returns the start time of the transaction, not the moment of the write.
- **`xmin` works, with caveats.** Every row version in PostgreSQL records the id of the transaction that wrote it in the hidden column `xmin`, so it changes on every `UPDATE`. In the run, an `UPDATE` that set the address to itself moved `xmin` from 148870 to 148878 while `version` stayed at 1: `xmin` never misses a change, but it also reports writes that changed nothing. Transaction ids are 32-bit and wrap around, and the documentation advises against relying on their uniqueness over more than about a billion transactions. A dump and restore, or a logical replica, gives every row a new `xmin`, and code that relies on it runs only on PostgreSQL. EF Core with Npgsql and SQLAlchemy can both use it.
- **One version per row means conflicts per row.** If A edits the address and B the phone number, a single version rejects B even though the edits don't overlap. Merge non-overlapping fields automatically, or version smaller pieces.
- **A strong ETag can get lost on the way.** If-Match needs a strong tag, but a proxy that changes the response may weaken it: since 1.7.3, [NGINX](../nginx/) turns strong entity tags into weak ones when it modifies a response, for example by compressing it. Clients then send `W/"…"`, and every save fails with 412. Check what reaches the client through each [API Gateway](../api-gateway/), proxy and CDN in front of the service.
- **Retries cost real work.** Every conflict is a re-read and a redo for the user or the service, and in DynamoDB a failed conditional write still consumes write capacity.

## Implementation notes

- **PostgreSQL 18.** `UPDATE … RETURNING` hands back the new version in the same round trip, and PostgreSQL 18 can return both sides with `RETURNING old.version, new.version`. The count in the `UPDATE` tag includes matched rows whose values didn't change, so it measures matches, not changes. The re-check after a lock wait applies to `UPDATE`, `DELETE` and `SELECT … FOR UPDATE` in READ COMMITTED; REPEATABLE READ and SERIALIZABLE raise SQLSTATE 40001, which the documentation says to retry by re-running the whole transaction, including the logic that chose the values. `NOWAIT` makes `SELECT … FOR UPDATE` fail at once instead of waiting.
- **MySQL 8.4 (InnoDB).** The same `UPDATE … WHERE id = ? AND version = ?` works, and the client reports `Rows matched: 0  Changed: 0`. By default the affected-rows count of an `UPDATE` is the number of rows actually changed, unless the client connects with `CLIENT_FOUND_ROWS`, which makes it count matched rows. With `version = version + 1` every matched row changes, so both counts agree. The race ends differently from PostgreSQL under InnoDB's default REPEATABLE READ: in the run, B's `UPDATE` waited on A's record lock (`performance_schema.data_locks` showed `X,REC_NOT_GAP` `WAITING`), then read the latest committed row, matched nothing and returned no error, while a plain `SELECT` in B's transaction still showed version 1 from its snapshot. InnoDB's snapshot covers plain `SELECT`s; `UPDATE` and `DELETE` act on the latest committed rows. A lock wait ends after `innodb_lock_wait_timeout` (50 seconds by default) with `ERROR 1205 (HY000): Lock wait timeout exceeded`, and `FOR UPDATE NOWAIT` fails at once with error 3572.
- **SQL Server.** A `rowversion` column (8 bytes) gets a new, database-wide increasing value on every insert and update, and a save checks it with `UPDATE … WHERE id = @id AND rv = @rv` and `@@ROWCOUNT`. `timestamp` is a deprecated synonym, and EF Core's `[Timestamp]` maps to `rowversion`.
- **SQLite** has no column that updates itself, so EF Core's documentation suggests an application-managed token there, such as a GUID the app replaces on every save.
- **Amazon DynamoDB.** Put the version in a condition expression, as above; the AWS SDK for Java 1.x's `DynamoDBMapper` with `@DynamoDBVersionAttribute` did the same before the 2.x enhanced client. Conditional writes on the attribute being updated are idempotent, so a request retried after a network error can't apply twice, which is the same guarantee an [Idempotent Consumer](../idempotent-consumer/) gets from its processed-message table.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Transaction Isolation Levels](../isolation-levels/) — What concurrent transactions can see of each other: the anomalies each isolation level allows and the defaults engines use.
- [MVCC](../mvcc/) — Multi-version concurrency control: an update writes a new row version, readers see a snapshot, and vacuum removes dead versions.
- [Locks & Deadlocks](../locks-and-deadlocks/) — Row locks make writers wait for each other; two transactions waiting on each other is a deadlock, and the database aborts one.
- [Amazon DynamoDB](../amazon-dynamodb/) — A serverless key-value and document database: the partition key spreads items across partitions for single-digit-millisecond reads.
- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.
- [Retry with Backoff & Jitter](../retry-with-backoff/) — Retry transient failures with growing, randomised delays so clients don't stampede.
- [Event Sourcing](../event-sourcing/) — Store every change as an immutable event and rebuild state by replaying them.

## References

- [H. T. Kung and J. T. Robinson — On Optimistic Methods for Concurrency Control (ACM TODS, 1981)](https://dl.acm.org/doi/10.1145/319566.319567)
- [Martin Fowler — Optimistic Offline Lock (Patterns of Enterprise Application Architecture, by David Rice)](https://martinfowler.com/eaaCatalog/optimisticOfflineLock.html)
- [RFC 9110 — HTTP Semantics: If-Match](https://www.rfc-editor.org/rfc/rfc9110#section-13.1.1)
- [RFC 6585 — Additional HTTP Status Codes: 428 Precondition Required](https://www.rfc-editor.org/rfc/rfc6585#section-3)
- [PostgreSQL 18 — UPDATE](https://www.postgresql.org/docs/18/sql-update.html)
- [PostgreSQL 18 — Transaction Isolation](https://www.postgresql.org/docs/18/transaction-iso.html)
- [PostgreSQL 18 — System Columns (xmin)](https://www.postgresql.org/docs/18/ddl-system-columns.html)
- [PostgreSQL 18 — Client Connection Defaults (lock_timeout)](https://www.postgresql.org/docs/18/runtime-config-client.html)
- [MySQL 8.4 — Consistent Nonlocking Reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-consistent-read.html)
- [MySQL 8.4 — Fractional Seconds in Time Values](https://dev.mysql.com/doc/refman/8.4/en/fractional-seconds.html)
- [Amazon DynamoDB — Best practices for handling concurrent updates](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/BestPractices_ImplementingVersionControl.html)
- [Amazon DynamoDB — Working with items (conditional writes)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithItems.html)
- [Amazon S3 — Conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
- [SQL Server — rowversion](https://learn.microsoft.com/en-us/sql/t-sql/data-types/rowversion-transact-sql)
- [EF Core — Handling Concurrency Conflicts](https://learn.microsoft.com/en-us/ef/core/saving/concurrency)
- [Hibernate ORM 7.4 — User Guide (optimistic locking)](https://docs.hibernate.org/orm/7.4/userguide/html_single/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
