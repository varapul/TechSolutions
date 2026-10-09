
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗃️ Database Internals & Performance](../../README.md#database-internals--performance)

# Composite Index

> A multi-column index serves queries that use its leading columns: put equality columns first and the range or sort column last.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Composite Index" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/composite-index.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Wrong column first** | Acme Shop already has an index on **(created_at, customer_id)**. The history screen asks for customer 42's 20 newest delivered orders, and the best PostgreSQL 18 can do with that index is walk it backward from the newest entry, checking `customer_id = 42` on each one: 52,936 entries and 226 buffers for 20 rows. For customer 1012, with 34 orders, the planner gives up on the index: it reads all 5,058 table pages and sorts. |
| **2 · Leftmost prefix** | A B-tree on (a, b) is sorted by `a`, and by `b` only among entries with the same `a`. On **(customer_id, created_at)** an equality on the leading column lands on one contiguous slice, customer 42's 179 entries, and inside it the entries are already in `created_at` order. A condition on `created_at` alone has no single range to seek to: its matches sit in every customer's slice. |
| **3 · Equality first, sort last** | After `CREATE INDEX ON orders (customer_id, created_at)` the plan is again an Index Scan Backward with `Index Cond: (customer_id = 42)`, but now it seeks to the end of the slice, takes 20 entries newest first and stops: 23 buffers and no Sort node. The dashboard (`status = 'pending' AND created_at >= '2026-10-02'`) follows the same rule with **(status, created_at)**, equality first and range last, so it reads exactly its 210 entries: 213 buffers instead of 526. |
| **4 · Skip scan and the costs** | With PostgreSQL 18's **skip scan**, (status, created_at) also answers `created_at >= '2026-10-02'` with no status condition: 6 index searches over its 5 statuses, 579 buffers, so the old (created_at, customer_id) index can go if nothing else needs it. (customer_id, created_at) couldn't stand in: with 95,880 customers to skip, the planner would rather read the whole table. Every index is written on every INSERT (5 WAL records here with four indexes, 2 with the primary key alone), and an index on (customer_id) alone would be redundant next to (customer_id, created_at). |
<!-- END GENERATED: header -->

## The problem

Acme Shop keeps its orders in PostgreSQL 18.6: 500,000 rows in 5,058 pages (40 MB). Someone once added an index on `(created_at, customer_id)`, and the order history screen runs this query on every visit:

```sql
SELECT id, created_at, total_thb FROM orders
WHERE customer_id = 42 AND status = 'delivered'
ORDER BY created_at DESC LIMIT 20;
```

Both columns the query filters and sorts on are in that index, yet it barely helps. The index is sorted by `created_at`, so customer 42's 179 orders are spread across all 500,000 entries. The best plan PostgreSQL finds walks the index backward from the newest entry and checks `customer_id = 42` on each one until it has 20 matches: 204 leaf pages, 52,936 entries and 226 buffers for 20 rows.

For most customers it is worse. Customer 1012 has 34 orders. The planner estimates 9 matching rows, fewer than the `LIMIT`, so walking the index could not stop early; it reads all 5,058 table pages with a parallel sequential scan and sorts what it finds. That took 10 to 16 ms in runs on a laptop, against well under a millisecond with the right index.

## How it works

**A multicolumn B-tree is sorted by its first column, and by the second only among entries with the same first value**, and so on; PostgreSQL adds each row's location (its TID) as a final tiebreaker. It is a phone book sorted by surname and then first name: every "Lee" sits together, every "Somchai" is spread through the whole book.

That ordering gives the **leftmost prefix rule**. Equality conditions on the leading columns, plus a range on the first column without an equality, decide which contiguous part of the index is read. Conditions on later columns are still checked inside the index, which saves visits to the table, but they don't shrink the part that is read. EXPLAIN prints both kinds as `Index Cond`: the slow plan above and the fast one below both show `Index Cond: (customer_id = 42)`, and only the buffer counts tell them apart.

On `(customer_id, created_at)`, the equality `customer_id = 42` lands on one contiguous slice of 179 entries, and inside the slice the entries are already in `created_at` order. Each descent to a slice reads one page per level (three here: root, internal page, leaf) and does a [binary search](../binary-search/) among the keys inside each page.

| Query on `(customer_id, created_at)` | What the index does |
|---|---|
| `customer_id = 42` | seeks straight to one slice |
| `customer_id = 42 AND created_at >= '2026-09-01'` | seeks to the start of part of the slice |
| `customer_id = 42 ORDER BY created_at DESC LIMIT 20` | reads the slice backward and stops after 20: no sort |
| `created_at >= '2026-10-02'` | no single range: the matches sit in every customer's slice |

**Equality first, range or sort last.** Once the equality columns have pinned the scan to one slice, the next column is in order inside it, so a range on it is one contiguous stretch and a sort on it comes free. Turn the order around and the equality matches are scattered through the range. The dashboard shows it: for pending orders since 1 September (990 of the 24,776 orders in that range), an index on `(created_at, status)` reads 121 index pages because it checks every entry in the range, while `(status, created_at)` reads 6. Markus Winand's rule of thumb in *Use The Index, Luke* is the same: equality first, then ranges.

With `(customer_id, created_at)` the history query's plan keeps its shape, an Index Scan Backward with `Index Cond: (customer_id = 42)`, but now it descends to the end of customer 42's slice, takes the entries newest first and stops after 20: 23 buffers (3 index pages and 20 table pages) and no Sort node. The planner uses that order when it expects the `LIMIT` to cut the scan short. For customer 1012, estimated at 9 rows, it fetches the whole 34-entry slice with a bitmap scan and sorts it instead, which costs 37 buffers.

**Sort direction.** A B-tree can be read in either direction, so `(customer_id, created_at)` serves `ORDER BY created_at DESC` for one customer. Mixed directions over two columns are another matter: `WHERE customer_id IN (42, 43) ORDER BY customer_id, created_at DESC LIMIT 20` can't come straight out of a plain index, and PostgreSQL added an Incremental Sort on top of it (the rows arrive presorted by `customer_id`). An index declared as `(customer_id, created_at DESC)` would return that order directly.

**Most selective column first?** This old advice is mostly a myth. When a query has equality conditions on every indexed column, the B-tree navigates on the whole key, and the column order hardly changes how much it reads. What the order does decide is which queries can use the index at all, through the leftmost prefix, and whether ranges and sorts are served, so derive it from the queries and put range and sort columns last. Winand's Myth Directory makes the same case: selectivity matters mainly when two independent range conditions compete, and skip scans favour a leading column with *few* distinct values, the opposite of the old rule.

**Skip scan, new in PostgreSQL 18.** A B-tree scan can now use an index whose leading column has no condition, or only a range, by treating that column internally as an equality on each of its values in turn, with a fresh index search for each one. It pays only when the leading column has few distinct values, and the planner decides from its statistics. `(status, created_at)` answers `created_at >= '2026-10-02'` with 6 index searches over its 5 statuses (579 buffers), and the new `Index Searches` line of EXPLAIN ANALYZE shows it. `(customer_id, created_at)` can't do the same: with 95,880 customers to skip, the planner chose a sequential scan of the table, and forcing the index gave 52 index searches and about 2,560 buffers, close to reading the whole index.

## Try it

The sample data comes from [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop), a script that builds the template database `acme` on PostgreSQL 18 in about a minute.

Run it in `psql` on PostgreSQL 18, on a fresh copy of the Acme Shop sample data (the template database `acme`). Don't run `ANALYZE` first: the copy keeps the template's statistics, so the plans match these. Buffers count the 8 kB pages each plan touched, `hit` plus `read`; the numbers below are from a second run of each `EXPLAIN`, because the first run of a query in a new session also counts a few catalog pages (235 instead of 226 for the first plan, 584 instead of 579 for the last).

```sql
CREATE DATABASE composite_index TEMPLATE acme STRATEGY FILE_COPY;
\c composite_index

-- The index the shop already has
CREATE INDEX orders_created_at_customer_id_idx ON orders (created_at, customer_id);

-- History screen: customer 42's newest delivered orders
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, created_at, total_thb FROM orders
WHERE customer_id = 42 AND status = 'delivered'
ORDER BY created_at DESC LIMIT 20;
--  Limit (actual rows=20.00 loops=1)
--    ->  Index Scan Backward using orders_created_at_customer_id_idx on orders
--          Index Cond: (customer_id = 42)
--          Filter: (status = 'delivered'::text)
--          Index Searches: 1
--          Buffers: shared hit=226          (204 leaf pages walked)

-- Equality column first, sort column last
CREATE INDEX orders_customer_id_created_at_idx ON orders (customer_id, created_at);
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, created_at, total_thb FROM orders
WHERE customer_id = 42 AND status = 'delivered'
ORDER BY created_at DESC LIMIT 20;
--  Limit (actual rows=20.00 loops=1)
--    ->  Index Scan Backward using orders_customer_id_created_at_idx on orders
--          Index Cond: (customer_id = 42)
--          Filter: (status = 'delivered'::text)
--          Index Searches: 1
--          Buffers: shared hit=23           (3 index pages, 20 table pages, no Sort)

-- Dashboard: pending orders of the last day
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, customer_id, created_at FROM orders
WHERE status = 'pending' AND created_at >= '2026-10-02';
--  Bitmap Heap Scan on orders (actual rows=210.00 loops=1)
--    Recheck Cond: (created_at >= '2026-10-02 00:00:00+00'::timestamp with time zone)
--    Filter: (status = 'pending'::text)
--    Rows Removed by Filter: 349
--    Buffers: shared hit=526
--    ->  Bitmap Index Scan on orders_created_at_customer_id_idx (actual rows=559.00 loops=1)

CREATE INDEX orders_status_created_at_idx ON orders (status, created_at);
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, customer_id, created_at FROM orders
WHERE status = 'pending' AND created_at >= '2026-10-02';
--  Index Scan using orders_status_created_at_idx on orders (actual rows=210.00 loops=1)
--    Index Cond: ((status = 'pending'::text) AND (created_at >= '2026-10-02 00:00:00+00'::timestamp with time zone))
--    Index Searches: 1
--    Buffers: shared hit=213

-- Skip scan: no condition on status, with the old index out of the way
BEGIN;
DROP INDEX orders_created_at_customer_id_idx;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, status, created_at FROM orders WHERE created_at >= '2026-10-02';
--  Index Scan using orders_status_created_at_idx on orders (actual rows=559.00 loops=1)
--    Index Cond: (created_at >= '2026-10-02 00:00:00+00'::timestamp with time zone)
--    Index Searches: 6
--    Buffers: shared hit=579
ROLLBACK;
```

## When to use it

- Queries that filter on two or three columns together, usually an equality on one or two of them and a range or a sort on the last: a customer's orders by date, a tenant's events by time, a queue's open jobs by priority.
- Top-N and paging queries (`ORDER BY … LIMIT n`) inside one parent: the index returns the rows already sorted and the scan stops after n. [Keyset pagination](../keyset-pagination/) is built on exactly this.
- Instead of several single-column indexes that queries always use together. PostgreSQL can combine single-column indexes with a bitmap AND, but it scans each one for its own condition and loses their order, so an `ORDER BY` needs a separate sort.
- Not when the columns are queried separately: an index on (a, b) doesn't help a query on b alone, apart from a skip scan over a leading column with few values. Two single-column indexes may serve such a workload better.
- Not by reflex. The PostgreSQL documentation advises using multicolumn indexes sparingly, and indexes of more than three columns rarely help unless the table is used in a very fixed way.

## Trade-offs

- **Writes.** Every index is updated on every INSERT, and on every UPDATE that changes one of its columns, which also rules out a HOT update for that row. One INSERT into `orders` wrote 5 [WAL](../write-ahead-log/) records (380 bytes) with the primary key and the three composite indexes, against 2 records (164 bytes) with the primary key alone; inserting 10,000 rows wrote 4.5 MB of WAL against 1.7 MB.
- **Space.** The three composite indexes take 49 MB (15, 15 and 19 MB) next to the 40 MB table. A partial index `ON orders (created_at) WHERE status = 'pending'` serves the dashboard in 5 pages (40 kB), because it holds only the 990 pending orders; it reads 212 buffers, about the same as `(status, created_at)`, but only queries that include `status = 'pending'` can use it. [Index types](../index-types/) covers partial indexes.
- **Redundant prefixes.** `(customer_id, created_at)` answers every lookup an index on `(customer_id)` alone would, including the check on `orders.customer_id` when a customer is deleted. The single-column index is smaller (5.5 MB here), so scanning it is a little cheaper, but rarely by enough to pay for maintaining both.
- **Plans follow estimates.** Customer 42's 179 orders put it in the planner's list of most common values (estimated at 217 rows), so it gets the ordered index scan; customer 1012, estimated at 9, gets a bitmap scan and a sort. Both are fast, but on a skewed column a new `ANALYZE` can move a customer in or out of that list and change the plan. [Query execution plans](../query-execution-plans/) shows how to read the estimates.
- **How many indexes?** There is no fixed number. Use The Index, Luke shows insert time growing with each index, the first one making the biggest jump. Keep the indexes your queries use (`pg_stat_user_indexes.idx_scan` shows the ones that are never scanned) and drop the rest: here skip scan made the old `(created_at, customer_id)` index unnecessary for the dashboard, though a feed of the newest orders across all customers would still want it.

## Implementation notes

- **PostgreSQL 18.** B-tree, GiST, GIN and BRIN indexes can have several key columns, up to 32 including `INCLUDE` columns. Column order matters for B-tree and GiST (whose first column decides how much is scanned), not for GIN or BRIN. Skip scan and the `Index Searches` line are new in 18; on 17 and earlier a query without a condition on the leading column reads the whole index or the table. Answering a query from the index alone is the subject of [covering indexes](../covering-index/), and the page structure underneath is the [B-tree index](../b-tree-index/). More about the engine: [PostgreSQL](../postgresql/).
- **MySQL 8.4 / InnoDB.** The same leftmost-prefix rule applies, for indexes of up to 16 columns. Every InnoDB secondary index record also carries the primary key, and the optimizer uses those columns (index extensions), so `(customer_id, created_at)` behaves like `(customer_id, created_at, id)`. `DESC` in an index definition is stored as descending order (InnoDB only), so a mixed-direction `ORDER BY` can be read forward from an index such as `(customer_id ASC, created_at DESC)`. The Skip Scan range access method works on one table without `GROUP BY` or `DISTINCT`, when the query references only columns of the index and has a range on a later key part; EXPLAIN then shows `Using index for skip scan`, and the `skip_scan` optimizer switch is on by default.
- **Oracle Database** has an index skip scan too: its optimizer considers one when the query doesn't constrain the leading column of a composite index, that column has few distinct values and the next one has many.
- **SQLite** uses a skip-scan only after `ANALYZE` has shown that the leftmost column has many duplicates, about 18 or more per value on average.
- **[MongoDB](../mongodb/)** states the rule for compound indexes as the ESR guideline: equality fields first, then sort fields, then range fields, so the sort comes from the index; a very selective range may go before the sort fields instead.
- **[Amazon DynamoDB](../amazon-dynamodb/)** builds the rule into its keys: a Query needs an equality on the partition key and allows one condition on the sort key (`=`, `<`, `<=`, `>`, `>=`, `BETWEEN` or `begins_with`). A table with partition key `customer_id` and sort key `created_at` answers the history screen with one Query.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [B-Tree Index](../b-tree-index/) — How a B-tree index finds a row in three or four page reads, serves ranges in order, and what every insert costs to keep it sorted.
- [Covering Index](../covering-index/) — Answer a query from the index alone: include the columns it selects, so the table is never read, and the scan is index-only.
- [Index Types](../index-types/) — Beyond B-trees: hash, GIN for arrays, JSON and text, GiST, BRIN for time-ordered data, and partial and expression indexes.
- [Query Execution Plans](../query-execution-plans/) — Read EXPLAIN the way the planner thinks: scans, joins, estimated against actual rows, and the statistics behind each choice.
- [Keyset Pagination](../keyset-pagination/) — Page with WHERE key > last seen instead of OFFSET, so page 1,000 is as fast as page 1 and no row repeats or goes missing.
- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [Binary Search](../binary-search/) — Halve a sorted range with every check: about 20 steps find one item among a million, where a scan may need a million.
- [MongoDB](../mongodb/) — A document database: JSON-like documents with flexible schemas, replica sets for failover and sharding to scale out.
- [Amazon DynamoDB](../amazon-dynamodb/) — A serverless key-value and document database: the partition key spreads items across partitions for single-digit-millisecond reads.

## References

- [PostgreSQL 18 Documentation — 11.3 Multicolumn Indexes](https://www.postgresql.org/docs/18/indexes-multicolumn.html)
- [PostgreSQL 18 Documentation — 11.4 Indexes and ORDER BY](https://www.postgresql.org/docs/18/indexes-ordering.html)
- [PostgreSQL 18 Release Notes — B-tree skip scan and Index Searches in EXPLAIN](https://www.postgresql.org/docs/18/release-18.html)
- [PostgreSQL 18 Documentation — 14.1 Using EXPLAIN](https://www.postgresql.org/docs/18/using-explain.html)
- [MySQL 8.4 Reference Manual — 10.3.6 Multiple-Column Indexes](https://dev.mysql.com/doc/refman/8.4/en/multiple-column-indexes.html)
- [MySQL 8.4 Reference Manual — Range Optimization: Skip Scan Range Access Method](https://dev.mysql.com/doc/refman/8.4/en/range-optimization.html#range-access-skip-scan)
- [MySQL 8.4 Reference Manual — 10.3.10 Use of Index Extensions](https://dev.mysql.com/doc/refman/8.4/en/index-extensions.html)
- [Markus Winand, Use The Index, Luke — Concatenated Indexes](https://use-the-index-luke.com/sql/where-clause/the-equals-operator/concatenated-keys)
- [Markus Winand, Use The Index, Luke — Greater, Less and BETWEEN](https://use-the-index-luke.com/sql/where-clause/searching-for-ranges/greater-less-between-tuning-sql-access-filter-predicates)
- [Markus Winand, Use The Index, Luke — Myth: Most Selective First](https://use-the-index-luke.com/sql/myth-directory/most-selective-first)
- [MongoDB Manual — The ESR (Equality, Sort, Range) Guideline](https://www.mongodb.com/docs/manual/tutorial/equality-sort-range-guideline/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
