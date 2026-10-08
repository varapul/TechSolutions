
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗃️ Database Internals & Performance](../../README.md#database-internals--performance)

# Join Algorithms

> Nested loop, hash join and merge join: how each joins two tables, what it costs, and when the planner picks it.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Join Algorithms" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/join-algorithms.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · A nested loop, no index** | Customer 2 has 45 orders since 1 September, and the query fetches each one's latest event with a `LATERAL` subquery, which runs once per order: a **nested loop**. `order_events` has no index on `order_id` (a foreign key doesn't create one), so each of the 45 loops is a full scan of 1,500,000 events: 67.5 million rows and 496,350 page reads for 45 result rows, 1.8 s in one run on a laptop. |
| **2 · Nested loop + index** | The same 45 orders joined to their items: the inner side is an index scan on `order_items_pkey`, so each outer row costs one descent of the three-level B-tree plus a heap page, 182 pages for 45 lookups and 117 rows in 14 ms (most of it the scan of `orders`). A nested loop wins when the outer side is small and the inner join column is indexed: about N × log M work, and the first row comes back at once. |
| **3 · Hash join, merge join** | **Hash join** (revenue per category in September): PostgreSQL builds a hash table on the smaller input, 23,436 orders in 32,768 buckets (1,216 kB, one batch), then reads all 1,250,000 order items once and probes it: 58,590 match, 84 ms. With `work_mem` cut to 64 kB it splits into 8 batches that spill to disk, 293 ms. **Merge join** (orders 100,001–300,000): both inputs come out of their primary key indexes in `order_id` order, so one pass over each joins them: 500,000 rows, no sort, 262 ms. |
| **4 · How the planner picks** | For each join order and method the planner estimates a cost from its row estimates and keeps the cheapest; the bars are its estimates for each query with the other methods switched off. A wrong row estimate can pick the wrong method, past 8 tables (`join_collapse_limit`) it partly keeps the JOIN order you wrote, and from 12 (`geqo_threshold`) it searches with a genetic algorithm. MySQL 8.4 has nested loops and, since 8.0.18, hash joins, but no merge join. |
<!-- END GENERATED: header -->

## The problem

A join pairs up rows from two inputs that share a key: orders with their items, items with their products. The obvious way, going through every row of one input for every row of the other, costs the product of the two sizes. Step 1 shows it on the sample data (PostgreSQL 18.6). A `LATERAL` subquery fetches the latest event of each of customer 2's 45 orders since 1 September, so it runs once per order, and `order_events` has no index on `order_id`. Every run is a full scan of 1,500,000 rows: 67.5 million rows and 496,350 page reads to return 45, 1.8 s in one run on a laptop.

The same shape appears whenever a join can only run row by row (a correlated subquery in the select list, a `LATERAL` subquery with `LIMIT`, a join on `<` or `BETWEEN`, or an application that queries once per row, as in [N+1 Queries](../n-plus-one-queries/)) and the inner side has no index on its key. A plain join is not stuck with it: the planner has three methods to choose from, and it prices each one before it runs anything.

## How it works

PostgreSQL, like most relational databases, has three ways to join two inputs. They return the same rows; they differ in what they need, how much memory they use and how the work grows. Below, N is the size of the outer input (the one that drives the loop, or probes the hash table) and M the size of the inner one (the one searched, or built into the hash table).

| | Nested loop | Hash join | Merge join |
|---|---|---|---|
| **How** | for each outer row, search the inner side | build a hash table on one input, stream the other through it | read both inputs sorted on the key and walk them together |
| **Work** | N × M with a scan; about N × log M with an index on the inner key | about N + M | N + M when both arrive sorted, plus N log N + M log M to sort them |
| **Memory** | none (a `Memoize` cache, if the planner adds one) | the hash table, up to `work_mem` × `hash_mem_multiplier`, then batches on disk | none for index scans; a `Sort` uses `work_mem` |
| **Join condition** | any (`=`, `<`, `BETWEEN`, a function) | equality only | equality only, on a sortable type |
| **First row** | at once | after the whole build input is read | at once when both inputs come from indexes |

**Nested loop.** For each outer row, the executor runs the inner side again with that row's key. With an index on the inner key, that is one index descent: in step 2 each of the 45 orders walks `order_items_pkey` from its root (page 235) through a branch page to a leaf (branch 4605 and leaf 4805 for order 499314) and then reads one heap page, about four pages per order and 182 in all. Without an index, each run is a full scan, as in step 1. The planner can add a `Memoize` node on the inner side to cache the results for keys that repeat. It is the only method that handles any join condition, and it returns rows before it has read a whole input, which is why it suits small lookups and `LIMIT`. See [B-Tree Index](../b-tree-index/) for the descent itself.

**Hash join.** The planner usually puts the smaller input on the build side. In step 3 it reads September's 23,436 orders and files each one in a bucket by a hash of `o.id`: for a single `bigint` key, PostgreSQL 18 uses `hashint8(id)` and the bucket is its low bits, so order 475656 lands in bucket 6,483 of 32,768. Then it reads `order_items` once, hashes each `order_id` and compares keys only within that one bucket: order 1 hashes to bucket 5,958, finds order 478168 there and is dropped. The 58,590 matches flow into a second, smaller hash join on `products` (10,000 rows, 597 kB) that adds the category. See [Hash Table](../hash-table/) for buckets and collisions.

PostgreSQL's hash join is a hybrid hash join: when the table doesn't fit in `work_mem` × `hash_mem_multiplier` (4 MB × 2.0 by default), it splits both inputs into batches by hash value, keeps one batch in memory, writes the others to temporary files and joins them batch by batch. At `work_mem = 64kB` the same query runs with 8 batches, writes about 66 MB of temporary files and takes 293 ms instead of 84. Under a parallel plan, a `Parallel Hash` is built once by all the workers together and shared (the one on `orders`), while a plain `Hash` is built in full by every process (the one on `products`, `loops=3`).

**Merge join.** Both inputs must arrive sorted on the join key, from an index or from a `Sort`. In step 3 the range of orders comes from `orders_pkey` and the items from `order_items_pkey`, both in `order_id` order, so the executor keeps one position in each input and advances whichever side has the smaller key; equal keys make joined rows. One pass over each input joins 200,000 orders to their 500,000 items with no sort and no hash table, and the result is already in `order_id` order for the `ORDER BY`. PostgreSQL doesn't carry the range on `o.id` over to `order_items`, so the inner scan starts at order 1 and reads 250,000 items before the first match (750,001 rows read). Walking two sorted inputs together is the merge step of [Merge Sort](../merge-sort/), applied to two tables.

**How the planner chooses.** For each pair of inputs, each join order and each method, the planner estimates a cost from its row estimates and its cost settings, and keeps the cheapest plan. Step 4 shows its estimates for each query, read from `EXPLAIN` with the other two methods switched off (`enable_nestloop`, `enable_hashjoin`, `enable_mergejoin`): each chosen method was the cheapest, by 3.8× for the nested loop, 1.6× for the hash join and 12% for the merge join. Because the choice rests on estimates, a wrong row count can pick the wrong method; the classic case is a nested loop planned for a handful of outer rows that meets thousands. [Query Execution Plans](../query-execution-plans/) shows how to spot one. The number of join orders grows exponentially with the number of tables, so PostgreSQL limits the search: it reorders explicit `JOIN`s only while the list of items stays within `join_collapse_limit` (8 by default), so past that it partly keeps the order you wrote, and from `geqo_threshold` (12) FROM items it switches to the genetic query optimizer, which tries a sample of join orders instead of all of them.

## Try it

The sample data comes from [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop), a script that builds the template database `acme` on PostgreSQL 18 in about a minute.

The plans and row counts below come from this script; timings vary from run to run, so they are left out.

```sql
-- Fresh copy of the sample data on PostgreSQL 18, then connect to it:
CREATE DATABASE join_algorithms TEMPLATE acme STRATEGY FILE_COPY;
\c join_algorithms

-- 1. A nested loop with no index on the inner key: LATERAL runs once per order,
--    and each run scans all of order_events (it takes seconds).
PREPARE latest AS
SELECT o.id, ev.kind, ev.happened_at
FROM orders o
LEFT JOIN LATERAL (SELECT e.kind, e.happened_at FROM order_events e
                   WHERE e.order_id = o.id
                   ORDER BY e.happened_at DESC LIMIT 1) ev ON true
WHERE o.customer_id = 2 AND o.created_at >= '2026-09-01';
EXPLAIN (ANALYZE, BUFFERS) EXECUTE latest;
--  Nested Loop Left Join  (... rows=45.00 loops=1)
--    ->  Seq Scan on orders o  (... rows=45.00 loops=1)
--    ->  Limit  (... rows=1.00 loops=45)
--          ->  Sort  (... rows=1.00 loops=45)
--                ->  Seq Scan on order_events e  (... rows=3.00 loops=45)
--                      Filter: (order_id = o.id)
--                      Rows Removed by Filter: 1499997
--                      Buffers: shared read=496350

--    The same nested loop with an index on the foreign key:
BEGIN;
CREATE INDEX ON order_events (order_id);
EXPLAIN (ANALYZE, BUFFERS) EXECUTE latest;
--                ->  Index Scan using order_events_order_id_idx on order_events e  (... rows=3.00 loops=45)
--                      Index Searches: 45
ROLLBACK;

-- 2. Nested loop with index lookups: customer 2's orders with their items.
EXPLAIN (ANALYZE, BUFFERS)
SELECT o.id, o.created_at, i.line_no, i.product_id, i.qty
FROM orders o JOIN order_items i ON i.order_id = o.id
WHERE o.customer_id = 2 AND o.created_at >= '2026-09-01'
ORDER BY o.created_at DESC;
--  ->  Nested Loop  (... rows=39.00 loops=3)
--        ->  Parallel Seq Scan on orders o  (... rows=15.00 loops=3)
--        ->  Index Scan using order_items_pkey on order_items i  (... rows=2.60 loops=45)
--              Index Searches: 45

-- 3a. Hash join: revenue per category in September, then with less memory.
PREPARE revenue AS
SELECT p.category, sum(i.qty * i.price_thb) AS revenue
FROM order_items i
JOIN orders o ON o.id = i.order_id
JOIN products p ON p.id = i.product_id
WHERE o.created_at >= '2026-09-01' AND o.created_at < '2026-10-01'
GROUP BY p.category ORDER BY revenue DESC;
EXPLAIN (ANALYZE, BUFFERS) EXECUTE revenue;
--  ->  Hash Join  (... rows=19530.00 loops=3)
--        Hash Cond: (i.product_id = p.id)
--        ->  Parallel Hash Join  (... rows=19530.00 loops=3)
--              Hash Cond: (i.order_id = o.id)
--              ->  Parallel Seq Scan on order_items i
--              ->  Parallel Hash  (... rows=7812.00 loops=3)
--                    Buckets: 32768  Batches: 1  Memory Usage: 1216kB
--        ->  Hash  (... rows=10000.00 loops=3)
--              Buckets: 16384  Batches: 1  Memory Usage: 597kB
SET work_mem = '64kB';
EXPLAIN (ANALYZE, BUFFERS) EXECUTE revenue;
--                    Buckets: 8192  Batches: 8  ...
RESET work_mem;

-- 3b. Merge join: a large range of orders with their items, in order_id order.
EXPLAIN (ANALYZE, BUFFERS)
SELECT o.id, o.created_at, i.line_no, i.product_id, i.qty
FROM orders o JOIN order_items i ON i.order_id = o.id
WHERE o.id BETWEEN 100001 AND 300000
ORDER BY o.id;
--  Merge Join  (... rows=500000.00 loops=1)
--    Merge Cond: (o.id = i.order_id)
--    ->  Index Scan using orders_pkey on orders o  (... rows=200000.00 loops=1)
--    ->  Index Scan using order_items_pkey on order_items i  (... rows=750001.00 loops=1)
```

## When to use it

You rarely choose the method yourself. What you control is what the planner can choose from and how good its estimates are.

- **Index the foreign keys you join on**, at least on the side that will be the inner side of a nested loop. PostgreSQL indexes primary keys and unique constraints but never creates an index for a foreign key, so `order_events.order_id` and `order_items.product_id` have none in the sample data. With the index, step 1's query does 45 index lookups and finishes in about 20 ms instead of 1.8 s.
- **Expect a nested loop for lookups**: a few outer rows, an index on the inner key, a `LIMIT`, or a join condition that isn't `=`.
- **Expect a hash join for reports**: large inputs in no useful order joined on `=`. Give reporting sessions enough `work_mem` and watch `EXPLAIN ANALYZE` for `Batches:` above 1.
- **Expect a merge join when both inputs are already sorted** on the key, for example two primary key or foreign key indexes over a large range, or when the result must come out in key order.
- **Write the join as a join.** A correlated subquery in the select list, or a `LATERAL` subquery with `LIMIT`, can only run as a nested loop. Written as a plain join (or with `DISTINCT ON` or a window function), the planner can use any of the three: the plain join of the same 45 orders to all of their events (135 rows) runs as a hash join in 154 ms even without the index.
- **Keep statistics current** (`ANALYZE` after bulk loads), because every choice rests on the row estimates.
- **Don't switch methods off** in production. The `enable_*` settings are for experiments in one session, as in step 4.

## Trade-offs

- **Nested loop** returns its first row at once and needs no memory, but its cost multiplies. A missing index on the inner key, or an outer side much bigger than the estimate, turns it into N × M work, and each lookup reads pages scattered across the index and the table.
- **Hash join** grows only with N + M, but it must read the whole build input before it returns a row, holds it in memory, and spills to disk in batches when that memory runs out (293 ms instead of 84 ms here). Many rows sharing one key all land in the same bucket. Equality joins only.
- **Merge join** streams with little memory when both inputs arrive sorted, and its output keeps the key order. When they don't, the `Sort` costs N log N plus memory or temporary files, which often makes a hash join cheaper. Equality joins only.
- **The planner** is only as good as its estimates: correlated columns, skewed values and stale statistics all mislead it, and the number of join orders to price grows exponentially with the number of tables.
- **`work_mem` is per operation, not per query.** A plan with several hashes and sorts can use it several times over, in every session that runs it.

## Implementation notes

- **PostgreSQL 18.** Plans name the methods `Nested Loop`, `Hash Join` (with a `Hash` child showing `Buckets`, `Batches` and `Memory Usage`) and `Merge Join` (with its `Merge Cond`); `Memoize` caches inner results for a nested loop. Hash tables may use `work_mem` × `hash_mem_multiplier` each (4 MB × 2.0 by default). Parallel plans run nested loops and merge joins with a complete inner side in every process, and hash joins either with a shared `Parallel Hash` or with one copy of the table per process.
- **MySQL 8.4 (InnoDB)** runs joins as nested loops, looking up the inner table through an index when it has one (Batched Key Access can batch those lookups, but it is off by default), or as hash joins. Hash joins arrived in 8.0.18 for equi-joins; since 8.0.20 they replace the block nested loop and also serve joins without an equality condition. There is no merge join. The hash table is limited by `join_buffer_size` and spills to files on disk, and `EXPLAIN FORMAT=TREE` shows it as `Inner hash join`.
- **SQL Server** has nested loops, merge and hash joins, and since SQL Server 2017 an adaptive join in batch mode that decides between a hash join and nested loops after reading its first input.
- **Oracle Database** has nested loops, hash and sort merge joins; its adaptive plans can also switch between nested loops and a hash join at run time.
- **SQLite** implements every join as nested loops. When the inner table has no usable index it may build an automatic index that lasts for one statement, which its documentation likens to a hash join that uses a B-tree.
- **DynamoDB** has no joins at all: its data modelling guide stores related items close together through composite keys and denormalizes, so one request returns what a relational join would assemble. See [Amazon DynamoDB](../amazon-dynamodb/).

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Query Execution Plans](../query-execution-plans/) — Read EXPLAIN the way the planner thinks: scans, joins, estimated against actual rows, and the statistics behind each choice.
- [B-Tree Index](../b-tree-index/) — How a B-tree index finds a row in three or four page reads, serves ranges in order, and what every insert costs to keep it sorted.
- [Hash Table](../hash-table/) — Hash each key straight to a bucket for O(1) average lookups; colliding keys share a bucket, and the table grows as it fills.
- [Merge Sort](../merge-sort/) — Split the list until single items remain, then merge sorted halves back together: O(n log n) every time, and stable.
- [N+1 Queries](../n-plus-one-queries/) — One query for a list, then one more for every row: how ORMs fall into it, how to spot it, and how batching or a join fixes it.
- [Normalization & Denormalization](../normalization/) — Store each fact once to keep data consistent, then copy some on purpose where reads must be fast, and keep the copies in step.
- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- Row vs Column Storage *(planned)* — Store rows together for transactions or columns together for analytics, and why a column store scans and compresses so much faster.

## References

- [PostgreSQL 18 — Planner/Optimizer](https://www.postgresql.org/docs/18/planner-optimizer.html)
- [PostgreSQL 18 — Using EXPLAIN](https://www.postgresql.org/docs/18/using-explain.html)
- [PostgreSQL 18 — Query Planning (enable_*, join_collapse_limit, geqo_threshold)](https://www.postgresql.org/docs/18/runtime-config-query.html)
- [PostgreSQL 18 — Resource Consumption (work_mem, hash_mem_multiplier)](https://www.postgresql.org/docs/18/runtime-config-resource.html)
- [PostgreSQL 18 — Parallel Plans: parallel joins](https://www.postgresql.org/docs/18/parallel-plans.html)
- [PostgreSQL 18 — Controlling the Planner with Explicit JOIN Clauses](https://www.postgresql.org/docs/18/explicit-joins.html)
- [PostgreSQL 18 — Genetic Query Optimization (GEQO)](https://www.postgresql.org/docs/18/geqo-pg-intro.html)
- [MySQL 8.4 Reference Manual — Nested-Loop Join Algorithms](https://dev.mysql.com/doc/refman/8.4/en/nested-loop-joins.html)
- [MySQL 8.0 Reference Manual — Hash Join Optimization (8.0.18 and 8.0.20 changes)](https://dev.mysql.com/doc/refman/8.0/en/hash-joins.html)
- [Microsoft Learn — Joins (SQL Server)](https://learn.microsoft.com/en-us/sql/relational-databases/performance/joins)
- [Oracle AI Database 26ai SQL Tuning Guide — Joins](https://docs.oracle.com/en/database/oracle/oracle-database/26/tgsql/joins.html)
- [SQLite — The SQLite Query Optimizer Overview](https://www.sqlite.org/optoverview.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
