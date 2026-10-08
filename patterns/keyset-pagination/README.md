
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗃️ Database Internals & Performance](../../README.md#database-internals--performance)

# Keyset Pagination

> Page with WHERE key > last seen instead of OFFSET, so page 1,000 is as fast as page 1 and no row repeats or goes missing.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Keyset Pagination" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/keyset-pagination.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · OFFSET reads, then drops** | Acme's back office lists orders newest first, 50 to a page, and page 1,000 asks for `LIMIT 50 OFFSET 49950`. Even with an index on `(created_at, id)`, PostgreSQL can't start at row 49,951: an **Index Scan Backward** goes down to the newest leaf, walks 192 leaf pages and fetches **50,000** rows, and the Limit node drops **49,950** of them (50,185 buffers, 33 ms in one run on a laptop). Page 100 reads 5,000 rows in 4.0 ms and page 1 reads 50 in 0.1 ms: the work grows with the page number. |
| **2 · Rows shift between loads** | `OFFSET` counts positions, and positions move. Load 1 shows page 1, ending with order **499955** at #50; then order **500001** arrives, sorts first and pushes every row down one place, so load 2 with `OFFSET 50` starts with 499955 **again**. A deleted order does the opposite and makes page 2 skip a row. Keyset pagination asks for the rows after 499955's key, so load 2 starts at 499952 whatever changed above it. |
| **3 · Seek past the last key** | Keyset pagination keeps the last row's key instead of a count. `WHERE (created_at, id) < ($1, $2)` is a row comparison in the index's own order, so it becomes an **Index Cond**: the descent compares the cursor with root page 290 and level-1 page 1715, lands in leaf 1733 just after row #49,950 and reads 50 entries, **53 buffers and 0.1 ms for page 1,000, the same as page 1**. The API returns the key as an opaque cursor (base64url of the timestamp and id), and the `id` tie-breaker makes every key unique, so no row can fall between two pages. |
| **4 · Limits and other engines** | There's no page 734 to jump to: its first key is unknown until the 36,650 rows before it are read, so offer Next and Previous, or a jump by date. A total is another query, and `count(*)` reads all **5,058 pages** (29 ms) every time. Each filter needs an index that leads with it and ends with the sort key: customer 1's keyset page 50 reads **9,825** rows through `(created_at, id)` but 50 through `(customer_id, created_at, id)`. DynamoDB hands back `LastEvaluatedKey` for the next request's `ExclusiveStartKey`, and Elasticsearch pages deep results with `search_after`. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's back office lists orders newest first, 50 to a page, and staff page deep into history to find an old order. The obvious query numbers the pages with `OFFSET`:

```sql
SELECT * FROM orders
ORDER BY created_at DESC, id DESC
LIMIT 50 OFFSET 50 * (page - 1);
```

It has two problems, and both come from counting rows instead of remembering where the last page ended.

- **The cost grows with the page number.** A database can't jump to the 49,951st row of an ordered result: it produces the 49,950 rows before it and throws them away. The PostgreSQL documentation says so in its section on `LIMIT` and `OFFSET`: skipped rows are still computed inside the server. With an index on `(created_at, id)`, page 1 reads 50 rows (0.1 ms), page 100 reads 5,000 (4.0 ms) and page 1,000 reads 50,000 rows and 50,185 buffers (33 ms, one run on a laptop), and each of those rows is fetched from the table before the Limit node drops it. A job that walks all 10,000 pages this way reads about 2.5 billion rows, 5,000 times the table.
- **Pages slip.** `OFFSET 50` means "skip whatever sits in the first 50 places right now". When order 500001 arrives between two page loads, every row moves down one place, and the last order of page 1 (499955) comes back as the first order of page 2. When an order on page 1 is deleted, every row after it moves up one place and page 2 silently skips one. Any table that changes while people page through it does this.

## How it works

**Keyset pagination**, which Markus Winand calls the *seek method*, remembers the key of the last row it showed and asks for the rows that come after it:

```sql
-- page 1
SELECT * FROM orders ORDER BY created_at DESC, id DESC LIMIT 50;

-- every next page: $1, $2 = created_at and id of the last row shown
SELECT * FROM orders
WHERE (created_at, id) < ($1, $2)
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

- **A row comparison in the index's order.** `(created_at, id) < ($1, $2)` compares left to right and stops at the first pair that differs, so it means `created_at < $1 OR (created_at = $1 AND id < $2)`: exactly "comes after" in a `created_at DESC, id DESC` list. Because it follows the column order of the index on `(created_at, id)`, PostgreSQL uses it as an **Index Cond**. For page 1,000 it descends once from root page 290 through level-1 page 1715 to leaf 1733, lands just after the cursor's entry (row #49,950) and reads the next 50 entries backward: 53 buffers (3 index pages and 50 table rows) and 0.1 ms, the same as page 1. A B-tree can be read in either direction, so the ascending index serves the descending sort.
- **A unique, stable key.** Two orders can share a `created_at`: `now()` returns the start time of the transaction, so a batch inserted in one transaction gets one value. Paged by `created_at` alone, a strict `<` skips the rest of a tie and `<=` repeats it. Adding the primary key as the last sort column makes every key unique. The key must also stay put while people page: paged by `updated_at`, an edit moves a row to the newest end of the list, so a newest-first list never shows it if the reader hadn't reached it yet, and an oldest-first list shows it twice.
- **One direction for every column.** A row comparison applies one operator to all its columns, so it can express `created_at DESC, id DESC` but not `created_at DESC, id ASC`. For mixed directions, write the `OR` form out and give the index the same mixed order, `(created_at DESC, id ASC)`.
- **No NULLs in the key.** When a pair in a row comparison is NULL, the result is unknown and the row drops out of the page. Keep the sort columns `NOT NULL`, or map NULLs to a value in both the index and the query.
- **An opaque cursor.** An API hands the key back as a token that the client returns without reading it. Acme's is base64url of a small JSON object: `{"t":"2026-07-30T18:45:26.947567Z","id":450057}` becomes `eyJ0IjoiMjAyNi0wNy0zMFQxODo0NToyNi45NDc1NjdaIiwiaWQiOjQ1MDA1N30`. Keep the timestamp's full microsecond precision: a JavaScript `Date` holds whole milliseconds, and a cursor cut to 18:45:26.947 would skip any row between that and 18:45:26.947567. Sign the token or validate it on the server, and record the sort and the filters in it, so a cursor from one list can't be replayed against another.
- **Backward.** For Previous, flip the comparison and the order, then reverse the 50 rows: `WHERE (created_at, id) > ($1, $2) ORDER BY created_at, id LIMIT 50`, with the first row of the current page as the cursor. From page 1,000's first row (450045) this is a forward index scan with the same 53 buffers, and it returns exactly page 999.
- **Filters.** A filter's columns go in front of the key in the index: customer 1's orders, newest first, need `(customer_id, created_at, id)`. With only `(created_at, id)`, page 50 of customer 1's 2,633 orders walks the index and throws away 9,775 other customers' rows to find 50 (9,859 buffers, 2.1 ms); with the matching index it reads 50 rows and 53 buffers (0.03 ms). [Composite Index](../composite-index/) explains the column order.
- **Counting.** `SELECT count(*) FROM orders` is a Parallel Seq Scan over all 5,058 pages, 29 ms every time it runs, about what page 1,000 costs with `OFFSET`. Most lists can do without it: fetch 51 rows and show Next only when the 51st exists, or show an estimate such as `pg_class.reltuples`.

## Try it

The sample data comes from [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop), a script that builds the template database `acme` on PostgreSQL 18 in about a minute.

Run it on a fresh copy of the Acme Shop sample data (PostgreSQL 18); the comments show the key lines of the output. Buffer counts are the same on every run (on the first run some of them show as `read=` instead of `hit=`); times vary with the machine, so the plans leave them out: the diagram's 33 ms and 0.1 ms come from one run on a laptop.

```sql
-- CREATE DATABASE keyset_pagination TEMPLATE acme STRATEGY FILE_COPY;  then connect to it
SET TimeZone = 'UTC';
CREATE INDEX orders_created_at_id_idx ON orders (created_at, id);

-- Page 1,000 with OFFSET: the scan reads 50,000 rows and Limit keeps the last 50
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM orders ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET 49950;
-- Limit (actual rows=50.00)
--   ->  Index Scan Backward using orders_created_at_id_idx on orders (actual rows=50000.00)
--         Index Searches: 1
--         Buffers: shared hit=49991 read=194     (50,185 in all)

-- The cursor: the last row of page 999
SELECT created_at, id FROM orders ORDER BY created_at DESC, id DESC LIMIT 1 OFFSET 49949;
-- 2026-07-30 18:45:26.947567+00 | 450057

-- Page 1,000 with keyset: seek past the cursor and read 50 rows
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM orders
WHERE (created_at, id) < ('2026-07-30 18:45:26.947567+00', 450057)
ORDER BY created_at DESC, id DESC LIMIT 50;
-- Limit (actual rows=50.00)
--   ->  Index Scan Backward using orders_created_at_id_idx on orders (actual rows=50.00)
--         Index Cond: (ROW(created_at, id) < ROW('2026-07-30 18:45:26.947567+00'::timestamp with time zone, 450057))
--         Index Searches: 1
--         Buffers: shared hit=53

-- A total is its own query
EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM orders;
-- Finalize Aggregate (actual rows=1.00)
--   ->  Gather   Workers Launched: 2
--         ->  Partial Aggregate
--               ->  Parallel Seq Scan on orders   Buffers: shared hit=5058

-- Shifting rows: page 1 ends with order 499955, then a new order arrives
SELECT id FROM orders ORDER BY created_at DESC, id DESC LIMIT 1 OFFSET 49;
-- 499955
INSERT INTO orders (customer_id, status, shipping_country, created_at, total_thb)
VALUES (42, 'pending', 'TH', '2026-10-02 17:20:00+00', 1290.00) RETURNING id;
-- 500001
SELECT id FROM orders ORDER BY created_at DESC, id DESC LIMIT 3 OFFSET 50;
-- 499955, 499952, 499951   page 2 by OFFSET starts with page 1's last order
SELECT id FROM orders WHERE (created_at, id) < ('2026-10-02 15:38:37.916976+00', 499955)
ORDER BY created_at DESC, id DESC LIMIT 3;
-- 499952, 499951, 499946   page 2 by keyset carries on after it
```

## When to use it

- Infinite scroll, activity feeds, "load more" buttons and the list endpoints of an API, where clients move forward and new rows keep arriving.
- Exports, backfills, sync jobs and crawlers that walk a whole table: every batch costs the same, and a job can resume from the last key it saved.
- Any list that people page deep into, or that changes while they page.
- Plain `OFFSET` is still fine for short lists (a few pages of a small table that rarely changes) and for screens where people must jump to page *n*. A common mix is keyset for Next and Previous plus a jump by value, a date or an order number, which is just another seek.

## Trade-offs

- **No random access.** Page numbers don't exist: the first key of page 734 is only known after reading the 36,650 rows before it.
- **One index per sort and filter.** Every order a user can choose, and every filter in front of it, wants its own index, and every index costs space and slows writes (see [B-Tree Index](../b-tree-index/)).
- **Totals cost extra.** A count is a separate query that grows with the table.
- **A cursor belongs to its query.** Change the sort or a filter and an old cursor means nothing; change the cursor's format and the links clients have stored break.
- **Not a snapshot.** Each page is a new query. New orders sort above the cursor and appear when the user goes back to page 1, while rows inserted or deleted further down show up or vanish on later pages. A row never repeats or goes missing just because others moved, as long as its own key doesn't change.

## Implementation notes

- **PostgreSQL 18** turns a row comparison on the leading columns of a B-tree index into an index condition, as the plans above show. Version 18's `EXPLAIN` reports `Index Searches: 1` for that single descent, and `EXPLAIN ANALYZE` now includes the buffer counts without being asked. In a plan, `OFFSET` shows up as a Limit node returning 50 rows above a scan that returned 50,000 ([Query Execution Plans](../query-execution-plans/)).
- **MySQL 8.4 (InnoDB)** writes the offset as `LIMIT 49950, 50`, or `LIMIT 50 OFFSET 49950` for compatibility with PostgreSQL, and, as Markus Winand points out for every database, it still has to fetch the skipped rows before it can send the ones after them. Its manual, in the section on row constructor expressions, advises writing the inequality out as `created_at < ? OR (created_at = ? AND id < ?)` so the range optimizer can use every column of the index. InnoDB appends the primary key to each secondary index and the optimizer uses those extended keys, so an index on `created_at` alone already orders by `(created_at, id)` when `id` is the primary key.
- **SQL Server** has `OFFSET … FETCH`, and its pages drift the same way: [Microsoft's documentation](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-order-by-clause-transact-sql) says stable pages need a unique `ORDER BY` and either data that doesn't change or every page read in one snapshot or serializable transaction. Use The Index, Luke notes that SQL Server (2017) has no row values and that Oracle can't apply `<` or `>` to them (ORA-01796), so both use the expanded `OR` form.
- **SQLite** has supported row values since 3.15.0 (2016), and [its documentation](https://sqlite.org/rowvalue.html) uses this query shape for a scrolling window over a list.
- **Amazon DynamoDB** pages only by key: a Query returns at most 1 MB, and when more remains, its `LastEvaluatedKey` becomes the next request's `ExclusiveStartKey` ([Amazon DynamoDB](../amazon-dynamodb/)).
- **Elasticsearch** stops `from` + `size` at 10,000 hits by default (`index.max_result_window`) and pages deeper with `search_after`, the sort values of the last hit. A point in time (PIT) keeps the view steady across requests and adds an implicit `_shard_doc` tiebreaker ([Elasticsearch](../elasticsearch/)).
- **MongoDB**'s manual says `skip()` scans from the start of the results and slows down as the offset grows, and suggests range queries on an indexed field instead, with `_id` in the sort to keep the order unique ([MongoDB](../mongodb/)).
- **APIs.** The GraphQL Cursor Connections Specification (Relay) defines `first` and `after` arguments and a `pageInfo` with `endCursor` and `hasNextPage`, and treats cursors as opaque strings. Stripe's list endpoints page with `starting_after` and `ending_before`, which take the ID of an object.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Composite Index](../composite-index/) — A multi-column index serves queries that use its leading columns: put equality columns first and the range or sort column last.
- [B-Tree Index](../b-tree-index/) — How a B-tree index finds a row in three or four page reads, serves ranges in order, and what every insert costs to keep it sorted.
- [Query Execution Plans](../query-execution-plans/) — Read EXPLAIN the way the planner thinks: scans, joins, estimated against actual rows, and the statistics behind each choice.
- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [Amazon DynamoDB](../amazon-dynamodb/) — A serverless key-value and document database: the partition key spreads items across partitions for single-digit-millisecond reads.
- [Elasticsearch & OpenSearch](../elasticsearch/) — Search engines built on inverted indexes: full-text queries ranked by relevance, and aggregations over sharded indexes.
- [MongoDB](../mongodb/) — A document database: JSON-like documents with flexible schemas, replica sets for failover and sharding to scale out.

## References

- [PostgreSQL 18 documentation — LIMIT and OFFSET](https://www.postgresql.org/docs/18/queries-limit.html)
- [PostgreSQL 18 documentation — Row Constructor Comparison](https://www.postgresql.org/docs/18/functions-comparisons.html#ROW-WISE-COMPARISON)
- [PostgreSQL 18 documentation — Indexes and ORDER BY](https://www.postgresql.org/docs/18/indexes-ordering.html)
- [Markus Winand, Use The Index, Luke — OFFSET is bad for skipping previous rows (the seek method)](https://use-the-index-luke.com/sql/partial-results/fetch-next-page)
- [Markus Winand — We need tool support for keyset pagination](https://use-the-index-luke.com/no-offset)
- [Amazon DynamoDB Developer Guide — Paginating table query results](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html)
- [Elasticsearch Reference — Paginate search results (search_after, point in time)](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/paginate-search-results)
- [MongoDB Manual — cursor.skip() and pagination with range queries](https://www.mongodb.com/docs/manual/reference/method/cursor.skip/)
- [MySQL 8.4 Reference Manual — Row Constructor Expression Optimization](https://dev.mysql.com/doc/refman/8.4/en/row-constructor-optimization.html)
- [GraphQL Cursor Connections Specification (Relay)](https://relay.dev/graphql/connections.htm)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
