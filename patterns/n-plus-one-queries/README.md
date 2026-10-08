
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗃️ Database Internals & Performance](../../README.md#database-internals--performance)

# N+1 Queries

> One query for a list, then one more for every row: how ORMs fall into it, how to spot it, and how batching or a join fixes it.

<p align="center"><img src="diagram.svg" alt="Animated diagram: N+1 Queries" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/n-plus-one-queries.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · 73 queries, one page** | Acme's **My orders** endpoint shows customer 42's 20 latest orders with their items and product names. With lazy loading the ORM sends 1 query for the orders, 1 per order for its items and 1 per item for its product: **1 + 20 + 52 = 73 queries**, one round trip after another. Each is quick, yet the page takes **33 ms** at the app (median of 100 views, one run on a laptop), and at an assumed 100 page views a second that is 7,300 queries a second. |
| **2 · Lazy loading in a loop** | The code reads like one query, but `order.items` and `item.product` are lazy: each first access runs a query. The server log shows the same statement again and again with a new `$1`, and **pg_stat_statements** folds them into 3 entries with 1, 20 and 52 calls. PostgreSQL spends **1.9 ms** planning and executing all 73; the other 31 ms of the page view go to round trips and per-statement overhead. |
| **3 · Batch by keys, or join** | Ask for all the children at once. With `.preload` the ORM sends the orders query, then `order_items WHERE order_id = ANY($1)` with the 20 order ids as one array, then `products WHERE id = ANY($1)` with the 52 product ids: **3 queries, 1.9 ms**. Or one statement joins the three tables and nests each order's items with `json_agg`: **1 query, 1.2 ms**. |
| **4 · Pitfalls** | Preload only what the page renders. Send keys as one array: an `IN` list with a parameter per key is a new statement for every length, and PostgreSQL caps a statement at 65,535 parameters. Don't join two child collections in one query: items and events together turn 52 + 60 rows into 156. A cache hides N+1 until it misses, and GraphQL resolvers fall into it field by field; a batching loader such as **DataLoader** collects the keys of one tick into one batch call, and so into one query. |
<!-- END GENERATED: header -->

## The problem

A page that lists records together with related data is easy to write as "load the list, then walk it". With an ORM's lazy loading, every relation the walk touches for the first time sends a query of its own. Acme Shop's **My orders** endpoint loads customer 42's 20 latest orders, then each order's items, then each item's product: **1 + 20 + 52 = 73 queries** for one page view. The name describes the shape: one query for a list of N parents, then N more for their children. Here it happens twice, one level inside the other.

None of the 73 queries is slow. In the run behind this page (PostgreSQL 18.6 in a Docker container on a laptop, the app a short Node.js script on one connection, as an ORM would use it), pg_stat_statements reports 0.007 to 0.034 ms of execution per call, far below anything a slow-query log would catch. What adds up is the waiting: the app sends a query, waits for its rows, and only then sends the next one. Over 100 page views the median was **33 ms** at the app, and PostgreSQL spent **1.9 ms** of it planning and executing. The rest went to 73 round trips of about 0.4 ms each, including the work the driver and the server do for every statement. Across a real network each round trip costs more, so the page gets slower without any query getting slower. The count also grows with the data (more items per order means more product queries) and with traffic: at an assumed 100 page views a second, the endpoint sends 7,300 queries a second where 300 would do.

## How it works

**Why it happens.** An ORM hands back objects whose relations are placeholders until you touch them: a proxy, a related manager, a lazy collection. The first access to `order.items` runs `SELECT … FROM order_items WHERE order_id = $1` for that one order, and the first access to `item.product` runs `SELECT … FROM products WHERE id = $1` for that one item. Inside a loop the code still reads like a single fetch, but the ORM sends a statement per iteration.

**How to spot it.**

- **pg_stat_statements** groups statements that differ only in their constants or parameters, so N+1 shows up as one statement with a huge `calls` count, a tiny mean time and only a few rows per call. After 100 page views of each version (the lazy one, the batched one and the join), the top of the view looked like this; the orders query ran in both the lazy and the batched views, and `mean_plan_time` needs `pg_stat_statements.track_planning = on`, which is off by default:

```sql
SELECT calls, rows, round(mean_exec_time::numeric, 3) AS exec_ms,
       round(mean_plan_time::numeric, 3) AS plan_ms, query
FROM pg_stat_statements ORDER BY calls DESC LIMIT 3;
--  calls | rows | exec_ms | plan_ms | query
--   5200 | 5200 |   0.007 |   0.018 | SELECT id, sku, name, price_thb FROM products WHERE id = $1
--   2000 | 5200 |   0.009 |   0.018 | SELECT order_id, line_no, product_id, qty, price_thb FROM order_items WHERE order_id = $1
--    200 | 4000 |   0.034 |   0.033 | SELECT id, status, created_at, total_thb FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT $2
```

- **The server log.** With `log_min_duration_statement = 0`, set for one session or one role rather than the whole server, PostgreSQL logs every statement with its duration and its parameters. Over the extended query protocol each statement appears as parse, bind and execute lines. One page view produced 73 `execute` lines with only 3 distinct statement texts:

```
LOG:  duration: 0.013 ms  execute <unnamed>: SELECT order_id, line_no, product_id, qty, price_thb FROM order_items WHERE order_id = $1
DETAIL:  Parameters: $1 = '495179'
LOG:  duration: 0.009 ms  execute <unnamed>: SELECT id, sku, name, price_thb FROM products WHERE id = $1
DETAIL:  Parameters: $1 = '7689'
LOG:  duration: 0.008 ms  execute <unnamed>: SELECT id, sku, name, price_thb FROM products WHERE id = $1
DETAIL:  Parameters: $1 = '2892'
```

- **Traces and the ORM's own log.** A trace of the request (see [Distributed Tracing](../distributed-tracing/)) shows a staircase of short, identical database spans, one after another. Most ORMs can log the SQL they send, and a test can pin the number of queries a page may run (Django's `assertNumQueries`, for example), so a regression fails the build instead of reaching production.

**Fix it in SQL.** Ask for all the children of one level in one statement.

- **Batch by keys.** Collect the parent keys and send them as one array parameter: `SELECT … FROM order_items WHERE order_id = ANY($1)` with the 20 order ids, then `SELECT … FROM products WHERE id = ANY($1)` with the 52 product ids, and match the rows up in memory by key. That is 3 round trips for the page however large N gets, and the statement text stays the same for any number of keys. The database still looks up every key: `EXPLAIN ANALYZE` in PostgreSQL 18 shows one Index Scan with `Index Searches: 19` for the 20 order ids (orders 475685 and 475698 sit on the same leaf page of `order_items_pkey`, so one descent finds both) and 22 searches for the 52 product ids. Measured at the app: **3 queries, 1.9 ms** per page view (median of 100), 0.3 ms of it planning and executing.
- **Join and aggregate.** One statement joins orders, items and products and folds each order's items into a JSON array with `json_agg(… ORDER BY i.line_no)`, one row per order. Inside the server the plan is a nested loop that searches `order_items_pkey` 20 times and `products_pkey` 52 times: the same lookups as the N+1 version, with no round trip between them ([Join Algorithms](../join-algorithms/) shows how the database runs such a join, and [Query Execution Plans](../query-execution-plans/) how to read the plan). Measured: **1 query, 1.2 ms**, of which 0.47 ms is planning and executing. The server does a little more work than for the three batches, and the app saves two round trips.
- **LATERAL.** When each parent needs a subquery of its own (its latest three events, say), `CROSS JOIN LATERAL (SELECT … WHERE e.order_id = o.id ORDER BY … LIMIT 3)` runs it for every parent row inside one statement, instead of once per row from the app.

**Fix it in the ORM.** Every major ORM can load relations up front; only the names differ. The batch query usually carries the keys as an `IN` list (SQLAlchemy's documentation says so for `selectinload()`), while the example in Hibernate's guide shows `= any (?)` with an array.

| ORM | One extra query per relation, with the keys | One query with joins | Make lazy loads fail loudly |
|---|---|---|---|
| Django 6.1 | `prefetch_related()` | `select_related()` (foreign keys and one-to-one only) | `fetch_mode(models.FETCH_RAISE)` |
| Rails (Active Record) | `preload` | `eager_load` (a `LEFT OUTER JOIN`); `includes` picks one of the two | `strict_loading` |
| Hibernate 7 / JPA | `@BatchSize` or `hibernate.default_batch_fetch_size` | `join fetch` in HQL, or an `EntityGraph` | a `StatelessSession`, where every fetch is explicit |
| SQLAlchemy 2.0 | `selectinload()` | `joinedload()` | `raiseload()` or `lazy="raise"` |
| EF Core | `Include()` with `AsSplitQuery()` | `Include()` and `ThenInclude()` | nothing loads lazily unless you enable it (proxies or `ILazyLoader`) |

Django 6.1 also added fetch modes: with `FETCH_PEERS`, the first access to a foreign key on one instance loads it for every instance from the same QuerySet. Each order's `order.items.all()` is a QuerySet of its own, so `item.product` costs one query per order instead of one per item (20 instead of 52 here). Fetch modes don't change the queries of related managers such as `order.items.all()`, which still need `prefetch_related()`.

**GraphQL.** A resolver runs per field, so `Order.items` resolves once for every order in the result, which is N+1 again. [DataLoader](https://github.com/graphql/dataloader) fixes it in the resolver layer: you create one loader per request, each resolver calls `load(key)`, and the loader collects the keys requested within one tick of the event loop and calls your batch function once with all of them, where you run a single `= ANY($1)` query. It also caches each key for the rest of the request. See [GraphQL Federation](../graphql-federation/) for the same concern across services.

## Try it

The sample data comes from [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop), a script that builds the template database `acme` on PostgreSQL 18 in about a minute.

Run it in `psql` on PostgreSQL 18, on a fresh copy of the Acme Shop sample data (the template database `acme`). The orders query needs the `(customer_id, created_at)` index that [Composite Index](../composite-index/) builds; without it, every page view would also scan all 500,000 orders. Timings are from one run on a laptop and will differ on yours.

```sql
CREATE DATABASE n_plus_one TEMPLATE acme STRATEGY FILE_COPY;
\c n_plus_one
CREATE INDEX orders_customer_id_created_at_idx ON orders (customer_id, created_at);

-- The list: customer 42's 20 latest orders, kept in a psql variable
SELECT array_agg(id ORDER BY created_at DESC) AS ids
FROM (SELECT id, created_at FROM orders WHERE customer_id = 42
      ORDER BY created_at DESC LIMIT 20) latest \gset
\echo :ids
-- {495179,493709,485504,481174,475698,475685,473551,471860,471274,465759,462606,461749,459786,457379,456248,455805,454178,451508,450897,447059}

-- N+1: \gexec sends every generated statement as a query of its own
\timing on
SELECT format('SELECT order_id, count(*) FROM order_items WHERE order_id = %s GROUP BY 1', id)
FROM unnest(:'ids'::bigint[]) AS id \gexec
--  order_id | count
--    495179 |     4
--  Time: 0.627 ms
--  ... 19 more result sets (493709: 2, 485504: 1, 481174: 3 ...), 52 items in all,
--  each after a round trip of its own; \timing printed a few tenths of a ms for each
\timing off

-- Batched by keys: one statement, the 20 ids as one array parameter
EXPLAIN (ANALYZE, COSTS OFF)
SELECT order_id, line_no, product_id, qty, price_thb
FROM order_items WHERE order_id = ANY (:'ids'::bigint[]);
--  Index Scan using order_items_pkey on order_items (actual rows=52.00 loops=1)
--    Index Cond: (order_id = ANY ('{495179,493709,...,447059}'::bigint[]))
--    Index Searches: 19
--    Buffers: shared hit=76

-- ... and the products of all 52 items at once
SELECT array_agg(DISTINCT product_id) AS pids
FROM order_items WHERE order_id = ANY (:'ids'::bigint[]) \gset
EXPLAIN (ANALYZE, COSTS OFF)
SELECT id, sku, name, price_thb FROM products WHERE id = ANY (:'pids'::bigint[]);
--  Index Scan using products_pkey on products (actual rows=52.00 loops=1)
--    Index Cond: (id = ANY ('{9,11,22,...,9779}'::bigint[]))
--    Index Searches: 22
--    Buffers: shared hit=21 read=58

-- One statement: join, then nest each order's items with json_agg
-- (LIMIT 2 only keeps the output short)
SELECT o.id, json_agg(json_build_object('qty', i.qty, 'sku', p.sku, 'name', p.name)
                      ORDER BY i.line_no) AS items
FROM (SELECT id, created_at FROM orders WHERE customer_id = 42
      ORDER BY created_at DESC LIMIT 20) o
JOIN order_items i ON i.order_id = o.id
JOIN products p ON p.id = i.product_id
GROUP BY o.id, o.created_at
ORDER BY o.created_at DESC
LIMIT 2;
--    id   | items
--  495179 | [{"qty" : 3, "sku" : "SKU-007689", "name" : "Product 7689"}, {"qty" : 3, "sku" : "SKU-002892", ...}, ...]
--  493709 | [{"qty" : 1, "sku" : "SKU-005003", "name" : "Product 5003"}, {"qty" : 2, "sku" : "SKU-001172", "name" : "Product 1172"}]

-- Two child collections in one join multiply: items x events per order
WITH o AS (SELECT id FROM orders WHERE customer_id = 42 ORDER BY created_at DESC LIMIT 20)
SELECT (SELECT count(*) FROM order_items i JOIN o ON i.order_id = o.id) AS items,
       (SELECT count(*) FROM order_events e JOIN o ON e.order_id = o.id) AS events,
       (SELECT count(*) FROM o JOIN order_items i ON i.order_id = o.id
                               JOIN order_events e ON e.order_id = o.id) AS joined_rows;
--  items | events | joined_rows
--     52 |     60 |         156
```

## When to use it

**N+1 is fine when the loop stays small and rare.** A detail page that always shows two or three related rows, an admin export that runs once a night, or relations that almost always come from a warm cache (see [Cache-Aside](../cache-aside/)) don't need the extra code. N+1 is also cheap when there is no round trip at all: SQLite runs inside the application's process, and its documentation argues that many small queries are efficient there for exactly that reason. Measure the miss path before you rely on a cache, and remember that N grows with the data.

**Batch by keys** when the children are many, need their own filtering or paging, or come from another store or service: two or three simple, cacheable queries that look the same for every page. **Join** (flat, or with `json_agg`) when the page has a fixed shape and you want a single round trip, and use a lateral subquery for "top N per parent". Across services the same pattern shows up as one API call per item, and a batch endpoint or [Gateway Aggregation](../gateway-aggregation/) is the fix at that level.

## Trade-offs

- **Round trips against database work.** Batching costs one round trip per level and the app matches rows up in memory. The `json_agg` join costs one round trip, but the server does the shaping: 0.47 ms of planning and execution here, against 0.29 ms for the three batched statements. That is a good deal while round trips dominate, and a worse one when the database is the bottleneck. The JSON also bypasses the ORM's object mapping.
- **Key lists must stay bounded.** PostgreSQL accepts at most 65,535 parameters in one statement, and an `IN` list with one placeholder per key is a different statement for every list length, so a driver that prepares statements keeps one per length. Send one array instead, split very long lists into chunks, or let the database find the keys itself with a subquery (`WHERE order_id IN (SELECT id FROM orders WHERE …)`), which is what Hibernate's subselect fetching does.
- **Eager by default over-fetches.** Loading every relation on every query pays for data most pages never show (preloading `order_events` here would add 60 rows to every view). JPA makes `@ManyToOne` eager by default, which the Hibernate guide warns against; map relations lazily and fetch per use case.
- **Two collections in one join multiply rows.** Items and events of the same 20 orders are 52 + 60 rows in two queries, but 156 rows in one join, because every item repeats for every event of its order. EF Core calls this a cartesian explosion and splits such queries with `AsSplitQuery()`.
- **Caches hide it.** A cached page sends no queries at all, so N+1 behind it looks free until the entry expires or the cache restarts; every miss pays all 73 round trips again.
- **Pipelining helps less than batching.** libpq's pipeline mode (since PostgreSQL 14) lets a client send queries without waiting for each result. It cuts the waiting, but not the number of statements, and it needs a driver and code written for it.

## Implementation notes

- **pg_stat_statements** ships with PostgreSQL, and the official `postgres:18` Docker image includes it, but it only works when it is listed in `shared_preload_libraries`, which takes a server restart, followed by `CREATE EXTENSION pg_stat_statements` in a database to get the view. With the default `compute_query_id = auto`, loading the module also turns on query ids. It tracks every database on the server, replaces constants with `$1`, `$2` …, and since PostgreSQL 18 also merges `IN` lists of constants that differ only in length into one entry. This page's run used its own container started with `-c shared_preload_libraries=pg_stat_statements -c pg_stat_statements.track_planning=on`.
- **Index Searches** is new in PostgreSQL 18's `EXPLAIN ANALYZE`: it counts the index descents of a scan node, which makes a batched `= ANY` scan (19 searches for 20 keys) and a nested loop (`loops=20`, 20 searches) easy to compare.
- **MySQL 8.4 (InnoDB)** has no array type, so batches usually go out as `IN` lists with one placeholder per key. The equivalent of pg_stat_statements is the Performance Schema table `events_statements_summary_by_digest`, one row per normalized statement with `COUNT_STAR` as its call count, or the friendlier `sys.statement_analysis` view (`exec_count`). Nesting works with `JSON_ARRAYAGG(JSON_OBJECT(…))`, but MySQL leaves the order of the aggregated elements undefined, and lateral derived tables are supported.
- **SQL Server** reports an `execution_count` per cached plan in `sys.dm_exec_query_stats`, so a parameterized N+1 statement shows up as one plan with a very large count.
- **SQLite** runs in the application's process, so a query costs a function call rather than a network round trip, which is why its documentation calls many small queries efficient.
- **DynamoDB** has no joins: fetching items one `GetItem` at a time in a loop is the key-value version of N+1, and `BatchGetItem` reads up to 100 items (at most 16 MB) by key in one call. It can return a partial result, so retry the keys it leaves unprocessed.
- **A connection pool doesn't fix it.** Pooling saves the cost of opening connections, not the round trip of each statement; the 73 queries in this run all went over one open connection.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Query Execution Plans](../query-execution-plans/) — Read EXPLAIN the way the planner thinks: scans, joins, estimated against actual rows, and the statistics behind each choice.
- [Join Algorithms](../join-algorithms/) — Nested loop, hash join and merge join: how each joins two tables, what it costs, and when the planner picks it.
- [B-Tree Index](../b-tree-index/) — How a B-tree index finds a row in three or four page reads, serves ranges in order, and what every insert costs to keep it sorted.
- [Composite Index](../composite-index/) — A multi-column index serves queries that use its leading columns: put equality columns first and the range or sort column last.
- [Distributed Tracing](../distributed-tracing/) — Propagate a trace context across services and assemble the spans into one timeline.
- [GraphQL Federation](../graphql-federation/) — Subgraphs from many services compose into one graph; a router plans each query across them.
- [Cache-Aside](../cache-aside/) — Read from the cache first; on a miss load from the database and populate the cache.
- [Gateway Aggregation](../gateway-aggregation/) — Fan one client request out to several services and merge the answers into one response.
- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.

## References

- [PostgreSQL 18 — pg_stat_statements](https://www.postgresql.org/docs/18/pgstatstatements.html)
- [PostgreSQL 18 — Row and Array Comparisons (= ANY)](https://www.postgresql.org/docs/18/functions-comparisons.html)
- [PostgreSQL 18 — Aggregate Functions (json_agg)](https://www.postgresql.org/docs/18/functions-aggregate.html)
- [PostgreSQL 18 — Table Expressions (LATERAL subqueries)](https://www.postgresql.org/docs/18/queries-table-expressions.html)
- [PostgreSQL 18 — libpq Pipeline Mode](https://www.postgresql.org/docs/18/libpq-pipeline-mode.html)
- [SQLite — Many Small Queries Are Efficient In SQLite](https://www.sqlite.org/np1queryprob.html)
- [GraphQL — DataLoader](https://github.com/graphql/dataloader)
- [Django 6.1 — QuerySet API reference (select_related, prefetch_related, fetch_mode)](https://docs.djangoproject.com/en/6.1/ref/models/querysets/)
- [Rails Guides — Active Record Query Interface: Eager Loading Associations](https://guides.rubyonrails.org/active_record_querying.html#eager-loading-associations)
- [A Short Guide to Hibernate 7 (7.4) — Association fetching](https://docs.hibernate.org/orm/7.4/introduction/html_single/)
- [EF Core — Single vs. Split Queries](https://learn.microsoft.com/en-us/ef/core/querying/single-split-queries)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
