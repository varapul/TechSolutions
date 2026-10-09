
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗃️ Database Internals & Performance](../../README.md#database-internals--performance)

# Query Execution Plans

> Read EXPLAIN the way the planner thinks: scans, joins, estimated against actual rows, and the statistics behind each choice.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Query Execution Plans" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/query-execution-plans.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · The report is slow** | Acme Shop's report adds up the last 30 days of orders per customer country: 23,213 orders become 6 rows. On PostgreSQL 18.6 it takes **106 ms** (one `EXPLAIN ANALYZE` run on a laptop, parallel query off), and the team starts guessing: an index on every column, more memory, a bigger instance. None of those guesses looks at what the database actually did. |
| **2 · Reading the plan** | `EXPLAIN (ANALYZE, BUFFERS)` prints the plan tree; read it from the innermost nodes up and compare each node's estimated `rows` with the actual rows. The `Seq Scan` on orders was **estimated at 48 rows and returned 23,213**, so the `Nested Loop` above it looked up `customers_pkey` once per row: `loops=23213`, about 46 ms and 69,639 of the 74,704 buffers. The most expensive node is where to look, and the first big gap between estimate and reality usually explains it. |
| **3 · Estimates versus reality** | The planner estimates rows from `pg_stats`. The `created_at` histogram was built before the last 30 days of orders arrived and ends at **2026-09-02 23:58**, so `created_at >= '2026-09-03'` falls past its last bucket and the planner uses a floor of 0.01%: 48 rows. After `ANALYZE orders` the range covers 4.59 of the 100 buckets, the estimate is **22,956**, the plan switches to a `Hash Join`, and the report reads **6,198 buffers instead of 74,704** (88 ms instead of 106 ms in this run). |
| **4 · Pitfalls in production** | Plain `EXPLAIN` shows estimates only; `EXPLAIN ANALYZE` really runs the statement, so wrap an `UPDATE` or `DELETE` in `BEGIN … ROLLBACK`. Plans change with parameters: after five runs a prepared statement may switch to a **generic plan** (`plan_cache_mode = auto`), which can't see `$1` and here assumed 166,667 rows, a third of the table. In production, `auto_explain` logs the plans of slow statements and `pg_stat_statements` shows which statements cost the most in total. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's dashboard runs a report: revenue per customer country for the last 30 days of orders. On [PostgreSQL](../postgresql/) 18.6 it joins `orders` (500,000 rows) with `customers` (100,000 rows), groups the 23,213 recent orders into 6 rows, and takes about 106 ms. When a query like that feels slow, teams guess: add an index on every column, give the server more memory, move to a bigger instance. Every guess has a price (each index adds work to inserts and updates, memory and instances cost money), and none of them looks at what the database actually did.

The database can tell you. `EXPLAIN` prints the plan the planner chose, with its estimates. `EXPLAIN (ANALYZE, BUFFERS)` also runs the statement and adds what really happened at every step: rows, loops, time and pages touched. Reading that output takes you from "it's slow" to "this node, for this reason".

## How it works

The planner turns a query into a tree of plan nodes. For each candidate tree it estimates how many rows every node will produce, using statistics that `ANALYZE` keeps for each table and column, prices the work with a few cost constants, and keeps the cheapest tree. The executor then pulls rows up the tree: scans at the leaves, joins, sorts and aggregates above them, the result at the root.

**Anatomy of a node.** One node of the run in the diagram:

```
Index Scan using customers_pkey on customers c  (cost=0.29..8.06 rows=1 width=11) (actual time=0.002..0.002 rows=1.00 loops=23213)
  Index Cond: (id = o.customer_id)
  Index Searches: 23213
  Buffers: shared hit=69639
```

- `cost=0.29..8.06` is the estimated startup cost (before the first row) and total cost, in arbitrary units where reading one page sequentially costs 1.0 (`seq_page_cost`). The other defaults are 4.0 for a page read out of order (`random_page_cost`), 0.01 per row (`cpu_tuple_cost`), 0.005 per index entry (`cpu_index_tuple_cost`) and 0.0025 per operator (`cpu_operator_cost`). A node's cost includes its children's.
- `rows=1` and `width=11` are the estimated rows per execution and their average width in bytes.
- `actual time=0.002..0.002` is the measured time in milliseconds to the first row and to the last row, and `rows=1.00` the rows returned, both averaged over executions; `loops=23213` is how many times the node ran. Multiply by `loops` for totals: 23,213 rows and about 46 ms here.
- `Buffers: shared hit=69639` counts 8 kB pages: `hit` means found in shared buffers, `read` means fetched from the operating system or disk. A node's buffers include its children's.
- Extra lines explain the work: `Rows Removed by Filter`, `Sort Method`, the `Batches` and `Memory Usage` of hashes and aggregates, `Heap Blocks` for bitmap scans. PostgreSQL 18 adds `Buffers` automatically whenever `ANALYZE` is used, prints actual rows with two decimals, and reports `Index Searches` for index scans.

**Reading order.** Start at the innermost nodes and work up. At each node compare the estimated rows with the actual rows (times `loops`): the first large gap usually explains everything above it, because every estimate feeds the choice of the node above. Then follow the time and the buffers to the most expensive node. The run with the stale statistics, read from the bottom:

| Node | Estimated rows | Actual rows × loops | Actual time (ms) | Buffers |
|---|---|---|---|---|
| Seq Scan on orders o | 48 | 23,213 × 1 | 0.010..43.964 | 5,059 |
| Index Scan using customers_pkey | 1 | 1.00 × 23,213 | 0.002 per loop | 69,639 |
| Nested Loop | 48 | 23,213 × 1 | 0.018..92.780 | 74,698 |
| Sort (by country) | 48 | 23,213 × 1 | 99.374..101.329 | 74,701 |
| GroupAggregate | 6 | 6 × 1 | 99.754..105.598 | 74,701 |
| Sort (by revenue) | 6 | 6 × 1 | 105.619..105.627 | 74,704 |

The scan returned 484 times as many rows as estimated. For 48 rows a nested loop was the cheapest join (estimated cost 11,409, against 14,408 for a hash join), so the inner index scan ran 23,213 times and used 93% of all buffers. A nested loop whose inner side runs thousands of times is the database's own version of [N+1 queries](../n-plus-one-queries/): check the estimate of its outer side first.

**Where estimates come from.** `pg_class` keeps each table's row and page counts (`reltuples`, `relpages`), which the planner scales to the table's current size. `pg_stats` keeps, per column, what `ANALYZE` found in a random sample: the fraction of nulls, the number of distinct values (`n_distinct`), the most common values and their frequencies, a histogram of the other values in equal-frequency buckets (up to 100 with the default `default_statistics_target`), and the correlation between the column's order and the table's physical order. For a range such as `created_at >= '2026-09-03'` the planner finds the bucket the value falls in, counts the buckets above it and interpolates linearly inside the bucket. For several conditions it multiplies their selectivities, assuming they are independent, unless an extended statistics object (`CREATE STATISTICS … (ndistinct, dependencies, mcv)`) records how the columns of one table relate; such an object is filled by the next `ANALYZE`.

**What went wrong here.** The statistics of `orders` were gathered before the last 30 days of orders arrived, so the `created_at` histogram ended at 2026-09-02 23:58 and every row the report wanted lay past its last bucket. The planner doesn't trust a histogram's ends to be current, so instead of zero it uses a floor of a hundredth of one bucket ([`selfuncs.c`](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/utils/adt/selfuncs.c)): 0.01% of the 476,881 rows it assumed is 48. Autovacuum hadn't refreshed the statistics because it re-analyzes a table only after `autovacuum_analyze_threshold` + `autovacuum_analyze_scale_factor` × rows changes, 50 + 10% of 476,787 = 47,729 by default, and 23,213 new orders are fewer. After `ANALYZE orders` the histogram reached 2026-10-02 17:16, the range covered 4.59 of the 100 buckets and the estimate became 22,956. The planner then chose a hash join, which reads `customers` once into a hash table instead of looking it up 23,213 times ([Join Algorithms](../join-algorithms/) compares the three methods): 6,198 buffers instead of 74,704, and 88 ms instead of 106 ms.

**Other common misestimates, and their fixes**, each measured once on the same sample data:

- *Statistics older than the data*, as above: run `ANALYZE` after bulk changes, and lower `autovacuum_analyze_scale_factor` for big tables that keep growing.
- *Correlated columns.* Every customer ships to their own country, so `customer_id = 1 AND shipping_country = 'MY'` matches 2,633 orders, but multiplying the two selectivities gave an estimate of 331. After `CREATE STATISTICS orders_customer_country (dependencies) ON customer_id, shipping_country FROM orders` and an `ANALYZE`, it was 2,783. Extended statistics cover the columns of one table only: nothing tells the planner that `orders.shipping_country` matches the customer's `country`.
- *A function around the column.* `date_trunc('day', created_at) >= '2026-09-03'` has no statistics of its own, so the planner falls back to a default of one third: 166,667 rows estimated, 23,213 found. Compare the bare column with a range instead, or collect statistics on the expression (`CREATE STATISTICS … ON (date_trunc('day', created_at)) FROM orders` gave 24,346). An index needs an immutable expression, and on a `timestamptz` this form depends on the session's `TimeZone`, so `CREATE INDEX` rejects it: index `date_trunc('day', created_at, 'UTC')` and write the query the same way.
- *Parameters the planner can't see*: generic plans of prepared statements, under Trade-offs below.

## Try it

The sample data comes from [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop), a script that builds the template database `acme` on PostgreSQL 18 in about a minute.

Run it on a fresh copy of the Acme Shop sample data (PostgreSQL 18), connected as a superuser: the rewind at the start switches off foreign-key checks while it takes the last 30 days of orders out and puts them back. The comments show the key lines of one run; in yours, a first run shows part of the buffers as `read=` instead of `hit=`, and the totals can differ by a few catalog pages.

```sql
-- CREATE DATABASE query_execution_plans TEMPLATE acme STRATEGY FILE_COPY;  then connect to it
SET TimeZone = 'UTC';
SET max_parallel_workers_per_gather = 0;            -- one process: a smaller plan tree

-- Rewind the statistics to before the last 30 days of orders arrived
ALTER TABLE orders SET (autovacuum_enabled = off);  -- keep autovacuum out of the experiment
SET session_replication_role = replica;             -- no FK checks while the rows are out
CREATE TEMP TABLE recent AS SELECT * FROM orders WHERE created_at >= '2026-09-03';  -- SELECT 23213
DELETE FROM orders WHERE created_at >= '2026-09-03';
VACUUM ANALYZE orders;
INSERT INTO orders OVERRIDING SYSTEM VALUE SELECT * FROM recent;
RESET session_replication_role;

SELECT (histogram_bounds::text::timestamptz[])[101] AS last_bound
FROM pg_stats WHERE tablename = 'orders' AND attname = 'created_at';
-- 2026-09-02 23:58:49+00   (ANALYZE samples rows at random: yours differs a little)

EXPLAIN (ANALYZE, BUFFERS)
SELECT c.country, count(*) AS orders, sum(o.total_thb) AS revenue
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.created_at >= '2026-09-03'
GROUP BY c.country
ORDER BY revenue DESC;
-- Sort  (cost=11408.87..11408.88 rows=6 width=43) (actual time=105.619..105.627 rows=6.00 loops=1)
--   Buffers: shared hit=74704
--   ->  GroupAggregate ... ->  Sort ...
--         ->  Nested Loop  (cost=0.29..11406.89 rows=48 width=11) (actual time=0.018..92.780 rows=23213.00 loops=1)
--               ->  Seq Scan on orders o  (cost=0.00..11020.01 rows=48 width=16) (actual time=0.010..43.964 rows=23213.00 loops=1)
--                     Rows Removed by Filter: 476787
--               ->  Index Scan using customers_pkey on customers c  (cost=0.29..8.06 rows=1 width=11) (actual time=0.002..0.002 rows=1.00 loops=23213)
--                     Buffers: shared hit=69639
-- Execution Time: 105.779 ms

ANALYZE orders;
EXPLAIN (ANALYZE, BUFFERS)
SELECT c.country, count(*) AS orders, sum(o.total_thb) AS revenue
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.created_at >= '2026-09-03'
GROUP BY c.country
ORDER BY revenue DESC;
-- Sort  (cost=14927.58..14927.60 rows=6 width=43) (actual time=87.441..87.449 rows=6.00 loops=1)
--   Buffers: shared hit=6198
--   ->  HashAggregate ...
--         ->  Hash Join  (cost=3386.00..14755.26 rows=22956 width=11) (actual time=32.519..82.040 rows=23213.00 loops=1)
--               ->  Seq Scan on orders o  (cost=0.00..11309.00 rows=22956 width=16) (actual time=0.011..37.430 rows=23213.00 loops=1)
--               ->  Hash  (cost=2136.00..2136.00 rows=100000 width=11) (actual time=32.253..32.254 rows=100000.00 loops=1)
--                     ->  Seq Scan on customers c  (cost=0.00..2136.00 rows=100000 width=11) (actual time=0.005..13.591 rows=100000.00 loops=1)
-- Execution Time: 87.659 ms

ALTER TABLE orders RESET (autovacuum_enabled);
```

Timings are from one run on a laptop and change from run to run; the plans, the row counts and the buffers are what matter.

## When to use it

- **Before changing anything** about a slow statement. Run `EXPLAIN (ANALYZE, BUFFERS)`, find the most expensive node and the first big misestimate below it, and fix that. Run it twice: the first run may read pages from disk that the second finds in memory.
- **`EXPLAIN` without `ANALYZE`** only plans and doesn't run the statement, so you can use it on a production `DELETE`; it shows estimates only.
- **Options worth knowing:** `SETTINGS` lists planner settings that differ from the defaults, `WAL` shows the [WAL](../write-ahead-log/) a write generates, `SERIALIZE` (PostgreSQL 17 and later) measures converting the result to text or binary, `MEMORY` (17 and later) the planner's memory, `GENERIC_PLAN` (16 and later) plans a statement with `$1` parameters without values, `TIMING OFF` keeps the row counts but drops per-node timing, and `FORMAT JSON` feeds tools.
- **Big trees** are easier to read in a visualizer, for example [explain.depesz.com](https://explain.depesz.com/), [explain.dalibo.com](https://explain.dalibo.com/) or [pgMustard](https://www.pgmustard.com/).
- **In production**, find the statements worth explaining first. `pg_stat_statements` keeps calls, total and mean time, rows and buffers for each normalized statement (it must be listed in `shared_preload_libraries`), and `auto_explain` logs the plan of every statement slower than `auto_explain.log_min_duration`, with actual rows and buffers if `log_analyze` and `log_buffers` are on.

## Trade-offs

- **`EXPLAIN ANALYZE` runs the statement.** A `SELECT` sends you nothing but does all its work; an `INSERT`, `UPDATE` or `DELETE` really changes data, so wrap it in `BEGIN; … ROLLBACK;`.
- **Measuring takes time.** Per-node timing reads the clock again and again. In three rounds of 15 runs each, the report's median without `EXPLAIN` was 77 to 81 ms with the stale statistics and 62 to 64 ms after `ANALYZE`, and `EXPLAIN ANALYZE` added about 16 ms to both. Use `TIMING OFF` when row counts are enough, and keep `auto_explain.log_analyze` for short investigations: while it is on, every statement pays for the timing, logged or not.
- **A warm cache hides a bad plan.** The wrong plan touched 12 times as many buffers but was only about 25% slower, because every page was already in memory. Where those pages must come from disk, each of the 23,213 lookups can become a random read, the case `random_page_cost` prices in.
- **Statistics are a sample.** Because `ANALYZE` samples at random, estimates move a little after each run (22,956 here, 23,960 in another run of the same script). A higher statistics target for a column (`ALTER TABLE … ALTER COLUMN … SET STATISTICS`) buys finer histograms and longer lists of common values, at the cost of a slower `ANALYZE`, more space in `pg_statistic` and slightly slower planning.
- **A right estimate isn't less work.** With fresh statistics the report still reads all 5,059 pages of `orders` and discards 476,787 rows. In our run a [B-tree index](../b-tree-index/) on `created_at` brought it to about 60 ms with a bitmap scan of the 3,963 pages that hold recent orders (the sample data spreads them over most of the table). The index helps the estimate too: when a value lies past the histogram, the planner reads the column's current minimum or maximum from the index, which turned the stale estimate of 48 into 4,009. If the report can be a few minutes old, a [materialized view](../materialized-view/) avoids the work altogether.
- **Generic plans.** A prepared statement is planned with its parameter values for its first five executions; then PostgreSQL may switch to one generic plan if its estimated cost is not much higher than the average. A generic plan can't see `$1`: for `created_at >= $1` it assumed a third of the table, 166,667 rows. In our run the custom plans stayed cheaper, so PostgreSQL kept them; when values are skewed, `plan_cache_mode = force_custom_plan` plans every execution afresh.
- **`enable_*` settings are for experiments.** `SET enable_nestloop = off` shows what the planner would do otherwise (the documentation calls these settings a crude method); in production, fix the estimate instead.

## Implementation notes

- **PostgreSQL 18** turned `BUFFERS` on by default with `EXPLAIN ANALYZE`, prints fractional actual row counts and `Index Searches`, and lets `pg_upgrade` keep the optimizer statistics; extended statistics still need an `ANALYZE` after the upgrade.
- **Keep statistics fresh.** Run `ANALYZE` after bulk loads and big deletes. For large append-heavy tables lower the per-table threshold, for example `ALTER TABLE orders SET (autovacuum_analyze_scale_factor = 0.01)`. Autovacuum never analyzes temporary tables or the parent of a [partitioned table](../table-partitioning/), so analyze those yourself.
- **Replicas share the primary's statistics.** A hot standby can't run `ANALYZE`; it uses the statistics the primary gathered, so a report on a [read replica](../read-replicas/) gets the same estimates as on the primary.
- **MySQL 8.4** has two counterparts. `EXPLAIN FORMAT=TREE` prints the iterator tree with estimated cost and rows; the default `explain_format` is the older table format, which marks a hash join only as `Using join buffer (hash join)` in its `Extra` column. `EXPLAIN ANALYZE` runs the statement and adds, for each iterator, the time to the first row and to all rows in milliseconds (averaged per loop), the actual rows and the loops, in tree format only. InnoDB keeps persistent index statistics, sampled from 20 pages per index by default and recalculated in the background after more than 10% of a table's rows change. Column histograms exist only once you create them with `ANALYZE TABLE … UPDATE HISTOGRAM`, and refresh automatically only if created with `AUTO UPDATE` (the default is `MANUAL UPDATE`).
- **Plan stability.** Aurora PostgreSQL (see [Amazon RDS & Aurora](../amazon-rds-aurora/)) adds query plan management, the `apg_plan_mgmt` extension: it captures plans and makes the optimizer pick from approved ones, to prevent regressions after statistics, parameter or engine changes. SQL Server's Query Store (SQL Server 2016 and later, on by default for new databases from SQL Server 2022) keeps each query's plan history with runtime statistics and can force an earlier plan.
- **Reproducing the run.** The diagram's numbers come from one run of the script above on PostgreSQL 18.6 with parallel query off. With the default of two parallel workers per gather, the same plans gain `Gather Merge` and partial and final aggregates, and the scans show rows per process with `loops=3`.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [B-Tree Index](../b-tree-index/) — How a B-tree index finds a row in three or four page reads, serves ranges in order, and what every insert costs to keep it sorted.
- [Join Algorithms](../join-algorithms/) — Nested loop, hash join and merge join: how each joins two tables, what it costs, and when the planner picks it.
- [Composite Index](../composite-index/) — A multi-column index serves queries that use its leading columns: put equality columns first and the range or sort column last.
- [N+1 Queries](../n-plus-one-queries/) — One query for a list, then one more for every row: how ORMs fall into it, how to spot it, and how batching or a join fixes it.
- [Table Partitioning](../table-partitioning/) — Split a large table into partitions by range, list or hash, so queries skip partitions and old data is dropped in an instant.
- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [Read Replicas](../read-replicas/) — Send writes to the primary and spread reads across asynchronously updated replicas.
- [Materialized View](../materialized-view/) — Precompute query-shaped views so reads don't pay for joins and aggregations.
- [Amazon RDS & Aurora](../amazon-rds-aurora/) — Managed relational databases: backups, Multi-AZ failover and read replicas, and Aurora's storage shared across three zones.

## References

- [PostgreSQL 18 documentation — Using EXPLAIN](https://www.postgresql.org/docs/18/using-explain.html)
- [PostgreSQL 18 documentation — EXPLAIN](https://www.postgresql.org/docs/18/sql-explain.html)
- [PostgreSQL 18 documentation — Statistics Used by the Planner](https://www.postgresql.org/docs/18/planner-stats.html)
- [PostgreSQL 18 documentation — Row Estimation Examples](https://www.postgresql.org/docs/18/row-estimation-examples.html)
- [PostgreSQL 18 documentation — pg_stats](https://www.postgresql.org/docs/18/view-pg-stats.html)
- [PostgreSQL 18 documentation — CREATE STATISTICS](https://www.postgresql.org/docs/18/sql-createstatistics.html)
- [PostgreSQL 18 documentation — Routine Vacuuming (the autovacuum daemon)](https://www.postgresql.org/docs/18/routine-vacuuming.html)
- [PostgreSQL 18 documentation — Query Planning (planner cost constants, plan_cache_mode)](https://www.postgresql.org/docs/18/runtime-config-query.html)
- [PostgreSQL 18 documentation — PREPARE (custom and generic plans)](https://www.postgresql.org/docs/18/sql-prepare.html)
- [PostgreSQL 18 documentation — auto_explain](https://www.postgresql.org/docs/18/auto-explain.html)
- [PostgreSQL 18 documentation — pg_stat_statements](https://www.postgresql.org/docs/18/pgstatstatements.html)
- [PostgreSQL 18 release notes](https://www.postgresql.org/docs/18/release-18.html)
- [PostgreSQL source — selfuncs.c, histogram selectivity (REL_18_STABLE)](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/utils/adt/selfuncs.c)
- [MySQL 8.4 Reference Manual — EXPLAIN Statement (FORMAT=TREE, EXPLAIN ANALYZE)](https://dev.mysql.com/doc/refman/8.4/en/explain.html)
- [MySQL 8.4 Reference Manual — Configuring Persistent Optimizer Statistics Parameters](https://dev.mysql.com/doc/refman/8.4/en/innodb-persistent-stats.html)
- [MySQL 8.4 Reference Manual — ANALYZE TABLE Statement (histograms)](https://dev.mysql.com/doc/refman/8.4/en/analyze-table.html)
- [Amazon Aurora User Guide — Managing query execution plans for Aurora PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraPostgreSQL.Optimize.html)
- [Microsoft Learn — Monitor performance by using the Query Store (SQL Server)](https://learn.microsoft.com/en-us/sql/relational-databases/performance/monitoring-performance-by-using-the-query-store)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
