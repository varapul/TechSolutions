
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗃️ Database Internals & Performance](../../README.md#database-internals--performance)

# Index Types

> Beyond B-trees: hash, GIN for arrays, JSON and text, GiST, BRIN for time-ordered data, and partial and expression indexes.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Index Types" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/index-types.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One B-tree for everything** | Acme Shop gave every column it searched a plain B-tree. The one on `status` (3,464 kB) holds all 500,000 orders to find the 3,000 open ones and sorts them all to return 20, the unique index on `email` can't serve `lower(email) = …`, so a login scans 100,000 customers, the one on `happened_at` takes 32 MB, and no B-tree can look inside `attrs @> '{…}'`, so all 10,000 products are checked. |
| **2 · Partial and expression** | A **partial index** stores only the rows that pass its `WHERE`: the 3,000 open orders, keyed by `created_at`, in 88 kB instead of 3,464 kB, and the queue reads one leaf page. The planner uses it only when it can prove that the query's condition implies the index predicate. An **expression index** stores `lower(email)`, so the login is one lookup, and as a `UNIQUE` index it also rejects the same address typed in another case. |
| **3 · BRIN and GIN** | **BRIN** stores one summary, the lowest and highest `happened_at`, for every 128 heap pages: 87 summaries in 24 kB. It works because events are stored in time order (`pg_stats` correlation 1.00), so one range matches and its 128 pages are read and rechecked. **GIN** is an inverted index: each key (with `jsonb_path_ops`, a hash of path and value) points to a sorted list of the rows that contain it, so `@>` intersects two lists and fetches 8 rows; the same structure serves arrays and full-text search. |
| **4 · Costs and limits** | Written as `NOT IN ('delivered', 'cancelled')`, the same open orders no longer prove the predicate, so the partial index is skipped. A **hash** index answers `=` only (no `UNIQUE`, ranges or ordering; WAL-logged, so crash-safe, since PostgreSQL 10), BRIN on `orders.created_at` (correlation 0.22) matches 37 of 40 ranges and loses to a plain scan, and GIN's **pending list** makes inserts cheaper but every search reads it until `VACUUM` or `gin_clean_pending_list()` merges it. **GiST** covers ranges, geometry and nearest-neighbour search, **SP-GiST** quad-trees and prefixes, and MySQL's InnoDB has B-tree, `FULLTEXT` and `SPATIAL` indexes but no partial or BRIN ones. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's developers gave every column they searched the index `CREATE INDEX` builds by default: a B-tree. Four queries show where that goes wrong, measured on PostgreSQL 18.6 with the shop's sample data (500,000 orders, 100,000 customers, 1,500,000 order events, 10,000 products):

- **The open-orders queue** asks for the 20 oldest orders whose status is `pending`, `paid` or `shipped`, which are 3,000 of the 500,000. A B-tree on `status` answers it, but the index is 3,464 kB, keeps a pointer to each of the 497,000 delivered and cancelled orders that nobody looks up, and returns the open orders in status order, so PostgreSQL fetches all 3,000 (2,652 buffers) and sorts them to keep 20.
- **Login by email** compares `lower(email)` with `lower('Customer42@Example.com')`, so it doesn't matter how the customer types the address. The unique index on `email` is built on a different expression and can't be used: a sequential scan reads all 1,136 pages of `customers` and throws away 99,999 rows (76 ms).
- **One day of order events** is fast with a B-tree on `happened_at` (27 buffers), but that index takes 32 MB, 37% as much as the 86 MB table itself, and every new event has to be inserted into it.
- **Products by attribute** keeps colour and size in a `jsonb` column, `attrs`, and asks for `attrs @> '{"colour": "red", "size": 42}'`. A B-tree on `attrs` (448 kB) sorts whole documents and has no operator for containment, so all 10,000 products are checked to find 8.

The B-tree is the right default, and the [B-Tree Index](../b-tree-index/) page explains why. This page is about the other kinds of index in PostgreSQL, and about the two ways to fit any index to its query: a predicate and an expression.

## How it works

PostgreSQL 18 has six index methods: B-tree, hash, GiST, SP-GiST, GIN and BRIN, plus `bloom` as an extension. Each serves its own set of operators, and the **operator class** of each indexed column decides which. Two features work with most of them: a `WHERE` clause makes an index **partial**, and an expression in place of a column makes it an **expression index**.

The numbers on this page come from `EXPLAIN (ANALYZE, BUFFERS)`, `pageinspect` and `pgstattuple`, run once on a laptop against a copy of the sample data. Sizes are as `pg_size_pretty` prints them (1 kB = 1,024 bytes), and timings are rounded: they change from run to run, the plans and row counts don't.

### Partial indexes

```sql
CREATE INDEX orders_open_idx ON orders (created_at)
  WHERE status IN ('pending', 'paid', 'shipped');
```

A partial index holds entries only for the rows that pass its predicate. The 3,000 open orders fit in 9 leaf pages under one root page: 11 pages and 88 kB, against 3,464 kB for the B-tree on `status`. Because its key is `created_at`, it also returns the open orders in queue order, so the plan is a `Limit` over an `Index Scan using orders_open_idx` that stops after 20 rows: 22 buffers and 0.09 ms, with no sort. An order has an entry only while it's open: the row version written when it's delivered or cancelled gets none, and vacuum removes the old entry. Writes to rows that never match don't touch the index at all.

The planner can use a partial index only if it proves, while planning, that the query's `WHERE` implies the index predicate. It handles simple cases: `status = 'paid'` implies the `IN` list, and that query used the index. It has no general theorem prover, so `status NOT IN ('delivered', 'cancelled')`, which picks out exactly the same 3,000 rows, isn't recognised, and the plan fell back to a parallel sequential scan of all 5,058 pages (27 ms). For the same reason a parameter can't match a predicate: with `plan_cache_mode = force_generic_plan`, a prepared `WHERE status = $1` got a sequential scan. The default `auto` mode plans the first five executions with the actual value, and keeps doing so while a generic plan looks much more expensive, so there it used the index.

A **partial unique index** enforces uniqueness only among the rows that match it, for example one open cart per customer. The documentation warns against the opposite use, many non-overlapping partial indexes that split one big table: the planner has to test each of them for every query, and partitioning is the tool for that job.

### Expression indexes

```sql
CREATE UNIQUE INDEX customers_lower_email_key ON customers (lower(email));
```

An expression index stores the value of the expression rather than a column. The login query names the same expression, so the planner sees an ordinary indexed comparison: root page, inner page and leaf, where `customer42@example.com` points to heap tuple `(0,42)`. That is 4 buffers and 0.06 ms instead of a 76 ms scan. The index is exactly as big as the one on `email` (4,880 kB, 610 pages), since it holds the same strings. Being `UNIQUE`, it also does what the plain constraint can't: inserting `Customer42@example.com` failed with a duplicate-key error.

- The query must use the same expression: `upper(email) = …` or `email ILIKE …` still scans the table.
- The expression is computed when a row is inserted and on every update that isn't HOT, never during a search. Every function in it must be `IMMUTABLE`.
- PostgreSQL keeps statistics on index expressions as if they were columns. Before the index existed, the planner guessed 500 rows for `lower(email) = …`; after `ANALYZE`, it expected 1.

The key itself can also be made case-insensitive, without an expression: with ICU, a nondeterministic collation such as `und-u-ks-level2` makes `=` and a plain unique index treat `Customer42@Example.com` and `customer42@example.com` as equal, and since PostgreSQL 18 `LIKE` works with such collations too.

### Hash indexes

A hash index is a [hash table](../hash-table/) kept in index pages: it stores a 32-bit hash code of each key, so it serves `=` and nothing else. On `lower(email)` it took 4,112 kB (514 pages) against 4,880 kB for the B-tree: the code of `customer42@example.com` is `0x22701379`, which falls in bucket 377 of 512, and that bucket's page lists hash codes with heap tuple ids, `(0,42)` among them (3 buffers). A hash index can't be `UNIQUE` (PostgreSQL refused to build one), can't span several columns, and can't help with ranges, `LIKE 'customer42%'` or `ORDER BY`. Since PostgreSQL 10, hash indexes are WAL-logged, so they survive a crash and reach replicas; before that, PostgreSQL warned against using them. The saving is real for long keys, but a B-tree does everything a hash index does and more, so hash stays a niche choice.

### BRIN

A block range index keeps a small summary for each run of consecutive heap pages. With the default `minmax` operator class and `pages_per_range = 128`, the summary is the lowest and highest `happened_at` in 128 pages, so the 11,030 pages of `order_events` need 87 summaries, which fit in 3 pages (24 kB, against 32 MB for the B-tree). To find one day, PostgreSQL checks every summary. Only range 82 (pages 10,368 to 10,495, from 08-25 16:04 to 09-02 02:21) overlaps the day, so the bitmap marks those 128 pages as lossy, and the heap scan reads all of them and rechecks each row: 2,341 kept and 15,067 dropped, 136 buffers and 2.3 ms, where the B-tree needed 27 buffers and 0.8 ms.

That works only because the table is stored in `happened_at` order, which `pg_stats.correlation` shows as 1.00. The `orders` table was loaded in a single transaction but not in `created_at` order, and its correlation is 0.22. A BRIN index on `orders.created_at` is just as small, but 37 of its 40 ranges run from 2024 or 2025 into October 2026 and so overlap the day, so the same kind of query read 4,674 of 5,058 pages and rechecked 461,268 rows: 60 ms, against 26 ms for a plain parallel sequential scan. Updates that move rows to other pages erode the order in the same way over time.

- Pages added after the last summarization stay unsummarized until `VACUUM` processes the table, `brin_summarize_new_values()` is called, or the index has `autosummarize` on, which it isn't by default. Until then every query reads them: after 40,000 events were appended, the same one-day query read 316 pages instead of 128.
- The `minmax-multi` and `bloom` operator classes (PostgreSQL 14) keep several intervals or a Bloom filter per range, for data that is only roughly in order.
- BRIN is a summarizing index: since PostgreSQL 16, an update that changes only BRIN-indexed columns can still be a HOT update.

### GIN

A generalized inverted index stores each key once, with a **posting list**: the sorted heap tuple ids of the rows that contain it (or a posting tree when the list is long). With the `jsonb_path_ops` operator class, each key is a hash of a value and the path that leads to it, so `{"colour": "red", "size": 42}` yields two keys. PostgreSQL looks up both, intersects the two lists (1,287 red products, 72 in size 42) and gets 8 tuple ids, which a bitmap heap scan fetches and rechecks: 13 buffers and 0.09 ms, against a 125-page scan. The 10,000 products produce only 18 distinct keys, so the index is 32 kB (4 pages). The default `jsonb_ops` class indexes every key and every value separately and also serves the key-exists operators `?`, `?|` and `?&`; on this data it was 64 kB. The other built-in classes index arrays (`@>`, `<@`, `=`, `&&`) and `tsvector` for full-text search (`@@`).

Writes are where GIN pays. One row can add many keys, and a text document adds one per distinct word, so with `fastupdate` on (the default) GIN appends new entries to an unsorted **pending list** and merges them into the main structure later, in bulk: when `VACUUM` or autoanalyze processes the table, when `gin_clean_pending_list()` is called, or when the list grows past `gin_pending_list_limit` (4 MB by default). Until then every search reads the whole list. After 10,000 products were inserted, the list held 10,000 rows on 50 pages and the same search read 55 index pages instead of 5 (63 buffers, 1.5 ms); after `gin_clean_pending_list()` it read 6 (14 buffers, 0.2 ms). Turn `fastupdate` off where steady search latency matters more than insert speed, and for a large load consider building the index afterwards. PostgreSQL 18 can build GIN indexes in parallel.

### GiST and SP-GiST

**GiST**, the generalized search tree, is a framework for balanced trees in which every inner entry covers everything below it, such as a bounding box or a covering range, so a search descends only into subtrees that can match. Its operator classes cover geometric types, ranges and multiranges (overlap `&&`, containment `@>` and `<@`), `inet` and `tsvector`, and many of them can return rows in order of distance with `<->`, which serves nearest-neighbour searches. GiST also enforces exclusion constraints: with the `btree_gist` extension, `EXCLUDE USING gist (courier_id WITH =, slot WITH &&)` on a table of delivery slots rejected a second booking that overlapped the first for the same courier.

**SP-GiST**, space-partitioned GiST, supports trees that repeatedly divide the search space into parts and need not be balanced: quad-trees and k-d trees for points, a radix tree for text (including the prefix operator `^@`), and classes for `inet`, ranges, boxes and polygons. Its point and polygon classes support nearest-neighbour search: `ORDER BY location <-> point '(100.53,13.74)' LIMIT 5` on a table of pickup points ran as an index scan with an `Order By` condition.

### Extensions

- **`pg_trgm`** adds GIN and GiST operator classes over trigrams, the three-character pieces of a string, which serve `LIKE` and `ILIKE` with wildcards anywhere, regular expressions, `=` and similarity search. A GIN trigram index on `customers.email` (3,864 kB) answered `email LIKE '%4242%'` with 26 buffers in 0.16 ms, where a scan read 1,136 pages in 16 ms. A pattern with no trigram to extract falls back to a full index scan.
- **`btree_gin`** and **`btree_gist`** give GIN and GiST the B-tree operators for ordinary types, for multicolumn indexes and exclusion constraints that mix the two.
- **`bloom`** builds one signature index over many columns, for queries that test arbitrary combinations of them with `=`.

### Side by side

| Index | Operators it serves | Size in this run | Write cost | Typical use |
|---|---|---|---|---|
| **B-tree** (default) | `<` `<=` `=` `>=` `>`, `BETWEEN`, `IN`, `IS NULL`, ordered output, `LIKE 'abc%'` in the C locale or with a pattern operator class | 3,464 kB on `orders.status`, 32 MB on `order_events.happened_at` | one entry per row, kept in order | keys, foreign keys, ranges, `ORDER BY … LIMIT` |
| **Partial** (any method) | the method's operators, when the query's `WHERE` implies the predicate | 88 kB for the 3,000 open orders | only rows that match | queues, active rows, uniqueness within a subset |
| **Expression** (any method) | the method's operators on the computed value | 4,880 kB on `lower(email)` | evaluates the expression on insert and non-HOT update | case-insensitive keys, computed lookups |
| **Hash** | `=` | 4,112 kB on `lower(email)` | one 32-bit code per row | equality on long keys |
| **GiST** | per operator class: overlap, containment, distance `<->`, exclusion constraints | not measured | moderate | ranges and bookings, geometry, nearest neighbour |
| **SP-GiST** | per operator class: points, `inet`, text prefixes, ranges, distance `<->` | not measured | moderate | points, IP networks, prefix search |
| **GIN** | `@>` `<@` `&&` on arrays, `@>` `?` `@@` on `jsonb`, `@@` on `tsvector`, `LIKE '%…%'` with `pg_trgm` | 32 kB on `products.attrs`, 3,864 kB trigram index on `customers.email` | high: one entry per key, eased by the pending list | `jsonb`, arrays, full-text search |
| **BRIN** | `<` `<=` `=` `>=` `>` (minmax), when the column follows the physical order | 24 kB on `order_events.happened_at` | very low, and doesn't block HOT updates | big append-only tables queried by time or id |

## Try it

The sample data comes from [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop), a script that builds the template database `acme` on PostgreSQL 18 in about a minute.

Run this as is on a fresh copy of the sample data, made with `CREATE DATABASE index_types TEMPLATE acme STRATEGY FILE_COPY;`. It took about 3 seconds; the comments show the output of one run on PostgreSQL 18.6.

```sql
-- CREATE DATABASE index_types TEMPLATE acme STRATEGY FILE_COPY;  then connect to index_types

-- Products get attributes: a colour each, and a size for shoes
ALTER TABLE products ADD COLUMN attrs jsonb;
UPDATE products SET attrs =
  jsonb_build_object('colour', (ARRAY['black', 'white', 'grey', 'red', 'blue', 'green', 'pink', 'yellow'])
                               [1 + get_byte(decode(md5(sku), 'hex'), 0) % 8])
  || CASE WHEN category = 'shoes'
          THEN jsonb_build_object('size', 36 + get_byte(decode(md5(sku), 'hex'), 1) % 10)
          ELSE '{}' END;
VACUUM FULL products;

-- Plain B-trees, for comparison
CREATE INDEX orders_status_idx ON orders (status);
CREATE INDEX order_events_happened_at_idx ON order_events (happened_at);
SELECT pg_size_pretty(pg_relation_size('orders_status_idx')) AS status_btree,
       pg_size_pretty(pg_relation_size('order_events_happened_at_idx')) AS happened_at_btree;
-- 3464 kB | 32 MB
DROP INDEX orders_status_idx, order_events_happened_at_idx;

-- One kind of index per query
CREATE INDEX orders_open_idx ON orders (created_at)
  WHERE status IN ('pending', 'paid', 'shipped');                           -- partial
CREATE UNIQUE INDEX customers_lower_email_key ON customers (lower(email));  -- expression
CREATE INDEX order_events_happened_at_brin ON order_events
  USING brin (happened_at);                                                 -- BRIN
CREATE INDEX products_attrs_gin ON products
  USING gin (attrs jsonb_path_ops);                                         -- GIN
VACUUM ANALYZE;

SELECT relname, pg_size_pretty(pg_relation_size(oid)) FROM pg_class
WHERE relname IN ('orders_open_idx', 'customers_lower_email_key',
                  'order_events_happened_at_brin', 'products_attrs_gin')
ORDER BY relname;
-- customers_lower_email_key 4880 kB, order_events_happened_at_brin 24 kB,
-- orders_open_idx 88 kB, products_attrs_gin 32 kB

EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM orders
WHERE status IN ('pending', 'paid', 'shipped') ORDER BY created_at LIMIT 20;
-- Limit (rows=20)  Buffers: shared hit=20 read=2
--   ->  Index Scan using orders_open_idx on orders (rows=20)

EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM customers
WHERE lower(email) = lower('Customer42@Example.com');
-- Index Scan using customers_lower_email_key on customers (rows=1)
--   Index Cond: (lower(email) = 'customer42@example.com'::text)
--   Buffers: shared hit=1 read=3

EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM order_events
WHERE happened_at BETWEEN '2026-09-01' AND '2026-09-02';
-- Bitmap Heap Scan on order_events (rows=2341)
--   Rows Removed by Index Recheck: 15067
--   Heap Blocks: lossy=128
--   ->  Bitmap Index Scan on order_events_happened_at_brin

EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM products
WHERE attrs @> '{"colour": "red", "size": 42}';
-- Bitmap Heap Scan on products (rows=8)  Heap Blocks: exact=8  Buffers: shared hit=13
--   ->  Bitmap Index Scan on products_attrs_gin (rows=8)

-- The same open orders asked another way: the predicate can't be proven
EXPLAIN SELECT * FROM orders
WHERE status NOT IN ('delivered', 'cancelled') ORDER BY created_at LIMIT 20;
-- Limit -> Gather Merge -> Sort -> Parallel Seq Scan on orders

-- BRIN needs rows stored in the order of the column
SELECT tablename, attname, round(correlation::numeric, 2) AS correlation FROM pg_stats
WHERE (tablename, attname) IN (('order_events', 'happened_at'), ('orders', 'created_at'));
-- orders created_at 0.22, order_events happened_at 1.00
```

## When to use it

Start from the query, not from the column:

- **Equality and ranges on a scalar column, sorting, `LIMIT`:** a B-tree, the default. The [Composite Index](../composite-index/) and [Covering Index](../covering-index/) pages show how to shape one, and [Query Execution Plans](../query-execution-plans/) how to check that the planner uses it.
- **A query that only ever wants a small subset** (a queue, unprocessed rows, rows not soft-deleted): a partial index whose predicate the query repeats word for word.
- **A lookup on a computed value** (`lower(email)`, a field extracted from `jsonb`): an expression index, written with the exact expression the query uses.
- **A huge table that only grows, queried by time or an ever-increasing id** (events, logs, metrics): BRIN, after checking that `pg_stats.correlation` for the column is close to 1 or −1.
- **Containment inside documents, arrays or text** (`@>`, `&&`, `@@`): GIN. For `LIKE '%…%'`, a GIN index with `pg_trgm`.
- **Overlap, distance and non-overlap rules** (bookings, maps, IP ranges): GiST, or SP-GiST for points and prefixes.
- **`=` on long keys where size matters:** a hash index, after measuring that it helps; a B-tree is usually fine.

**When full-text search belongs in Elasticsearch or OpenSearch.** PostgreSQL's own full-text search (`tsvector`, `tsquery` and a GIN index) is enough for search inside an application: a few supported languages, stemming, a ranked list, and data that stays transactional. Search outgrows it when it becomes a product of its own:

- **Relevance has to be tuned.** PostgreSQL's ranking functions use no information about the collection as a whole; [Elasticsearch and OpenSearch](../elasticsearch/) score with BM25, which weighs how rare each term is in the collection.
- **A language needs an analyzer PostgreSQL lacks.** PostgreSQL 18.6 ships 30 text search configurations and none for Thai. Thai is written without spaces between words, so its parser kept the phrase สั่งรองเท้าสีแดง ("order red shoes") as a single token. Elasticsearch's `thai` tokenizer splits Thai text into words, and OpenSearch has a Thai analyzer.
- **Facets over many hits, fuzzy matching, synonyms**, and search traffic that shouldn't load the primary database. The search engine then keeps a second copy of the data, fed from the database (for example by change data capture), which brings its own lag and its own operations work.

## Trade-offs

- **Every index is paid for on every write.** An insert adds an entry to every index on the table whose predicate the row matches, and an update that changes an indexed column can't be HOT. GIN pays the most per row, BRIN the least, and changes to BRIN-only columns stay HOT. Indexes also compete with the table for memory in shared buffers.
- **Partial and expression indexes match exactly or not at all.** A query written another way, an ORM that adds a cast, or a prepared statement with a generic plan won't use them. Check the plans of the SQL the application really sends.
- **BRIN is lossy and depends on physical order.** Each matching range costs 128 pages, rows that arrive out of order or move during updates widen the ranges, and new pages stay unsummarized until a vacuum.
- **GIN trades search time for insert time** through its pending list, and an insert that overflows the list pays for the whole merge. `fastupdate = off` gives steadier searches and slower writes.
- **Hash only buys a smaller index for `=`**: no uniqueness, no ranges, no sorting, one column.
- **Unused indexes are pure cost.** `pg_stat_user_indexes.idx_scan` and `last_idx_scan` show which indexes the planner actually picks.
- **Building an index blocks writes** to the table until it finishes. `CREATE INDEX CONCURRENTLY` doesn't, at the price of two table scans, and a failed build leaves an invalid index behind that still costs writes until it's dropped.

## Implementation notes

- **Looking inside.** `pageinspect` shows the pages themselves (`bt_page_items`, `brin_page_items`, `hash_page_items`, `gin_metapage_info`), and `pgstattuple` summarises them (`pgstatindex`, `pgstatginindex`); the keys, ranges and bucket in the animation come from them.
- **MySQL 8.4 (InnoDB).** InnoDB stores rows in the clustered index, which is usually the primary key, and its secondary indexes are B-trees. `USING HASH` is supported only by the MEMORY and NDB engines; InnoDB's own adaptive hash index is internal, and 8.4 turns it off by default. `CREATE INDEX` has no `WHERE` clause, so there are no partial indexes, and there is nothing like BRIN. **Functional key parts** (MySQL 8.0.13 and later), such as `INDEX ((lower(email)))`, play the role of expression indexes and are implemented as hidden virtual generated columns, but the login doesn't need one: the default collation, `utf8mb4_0900_ai_ci`, compares strings case-insensitively, so a plain index on `email` matches `Customer42@Example.com` and a unique one rejects case variants. **Multi-valued indexes** (8.0.17 and later) index each element of a JSON array and serve `MEMBER OF()`, `JSON_CONTAINS()` and `JSON_OVERLAPS()`, the closest thing to GIN on `jsonb`. `FULLTEXT` indexes (inverted lists in InnoDB, for `CHAR`, `VARCHAR` and `TEXT`) and `SPATIAL` indexes (R-trees) cover text and geometry.
- **SQL Server** has filtered indexes, its partial indexes, limited to simple comparison operators (no `LIKE`), and indexes on computed columns in place of expression indexes.
- **SQLite** has had partial indexes since 3.8.0 (2013) and indexes on expressions, which may call only deterministic functions, since 3.9.0 (2015).
- **Oracle Database** has function-based indexes, which may be B-tree or bitmap indexes, and bitmap indexes, in which each key holds a bitmap of the rows that have it.
- **[MongoDB](../mongodb/)** has partial indexes (`partialFilterExpression`), multikey indexes that get one entry per array element, and wildcard indexes (`$**`) for documents whose fields vary.
- **DynamoDB** writes an item into a secondary index only if the item has the index's key attributes, so a sparse index serves the same purpose as a partial index.
- **Naming.** Name an index after the query it serves (`orders_open_idx`, `customers_lower_email_key`), so that whoever changes the query knows the index depends on its exact wording. The [PostgreSQL](../postgresql/) page covers the rest of the engine.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [B-Tree Index](../b-tree-index/) — How a B-tree index finds a row in three or four page reads, serves ranges in order, and what every insert costs to keep it sorted.
- [Composite Index](../composite-index/) — A multi-column index serves queries that use its leading columns: put equality columns first and the range or sort column last.
- [Covering Index](../covering-index/) — Answer a query from the index alone: include the columns it selects, so the table is never read, and the scan is index-only.
- [Query Execution Plans](../query-execution-plans/) — Read EXPLAIN the way the planner thinks: scans, joins, estimated against actual rows, and the statistics behind each choice.
- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [Elasticsearch & OpenSearch](../elasticsearch/) — Search engines built on inverted indexes: full-text queries ranked by relevance, and aggregations over sharded indexes.
- [MongoDB](../mongodb/) — A document database: JSON-like documents with flexible schemas, replica sets for failover and sharding to scale out.
- [Hash Table](../hash-table/) — Hash each key straight to a bucket for O(1) average lookups; colliding keys share a bucket, and the table grows as it fills.
- Table Partitioning *(planned)* — Split a large table into partitions by range, list or hash, so queries skip partitions and old data is dropped in an instant.

## References

- [PostgreSQL 18 documentation — 11.2 Index Types](https://www.postgresql.org/docs/18/indexes-types.html)
- [PostgreSQL 18 documentation — 11.8 Partial Indexes](https://www.postgresql.org/docs/18/indexes-partial.html)
- [PostgreSQL 18 documentation — 11.7 Indexes on Expressions](https://www.postgresql.org/docs/18/indexes-expressional.html)
- [PostgreSQL 18 documentation — 65.6 Hash Indexes](https://www.postgresql.org/docs/18/hash-index.html)
- [PostgreSQL 18 documentation — 65.5 BRIN Indexes](https://www.postgresql.org/docs/18/brin.html)
- [PostgreSQL 18 documentation — 65.4 GIN Indexes](https://www.postgresql.org/docs/18/gin.html)
- [PostgreSQL 18 documentation — 8.14 JSON Types (jsonb indexing)](https://www.postgresql.org/docs/18/datatype-json.html)
- [PostgreSQL 18 documentation — 65.2 GiST Indexes](https://www.postgresql.org/docs/18/gist.html)
- [PostgreSQL 18 documentation — 65.3 SP-GiST Indexes](https://www.postgresql.org/docs/18/spgist.html)
- [PostgreSQL 18 documentation — F.35 pg_trgm](https://www.postgresql.org/docs/18/pgtrgm.html)
- [PostgreSQL 18 documentation — CREATE INDEX](https://www.postgresql.org/docs/18/sql-createindex.html)
- [PostgreSQL 18 documentation — PREPARE (generic and custom plans)](https://www.postgresql.org/docs/18/sql-prepare.html)
- [PostgreSQL 18 documentation — 66.7 Heap-Only Tuples (HOT)](https://www.postgresql.org/docs/18/storage-hot.html)
- [PostgreSQL 18 documentation — 23.2 Collation Support](https://www.postgresql.org/docs/18/collation.html)
- [PostgreSQL 18 documentation — 12.3 Controlling Text Search (ranking)](https://www.postgresql.org/docs/18/textsearch-controls.html)
- [PostgreSQL 10 release notes (hash indexes WAL-logged)](https://www.postgresql.org/docs/10/release-10.html)
- [PostgreSQL 14 release notes (BRIN minmax-multi and bloom)](https://www.postgresql.org/docs/14/release-14.html)
- [PostgreSQL 16 release notes (HOT updates with BRIN)](https://www.postgresql.org/docs/16/release-16.html)
- [PostgreSQL 18 release notes (parallel GIN builds)](https://www.postgresql.org/docs/18/release-18.html)
- [MySQL 8.4 Reference Manual — CREATE INDEX Statement](https://dev.mysql.com/doc/refman/8.4/en/create-index.html)
- [MySQL 8.4 Reference Manual — Case Sensitivity in String Searches](https://dev.mysql.com/doc/refman/8.4/en/case-sensitivity.html)
- [Microsoft Learn — Create Filtered Indexes (SQL Server)](https://learn.microsoft.com/en-us/sql/relational-databases/indexes/create-filtered-indexes)
- [SQLite — Partial Indexes](https://sqlite.org/partialindex.html)
- [SQLite — Indexes On Expressions](https://sqlite.org/expridx.html)
- [Oracle AI Database 26ai Concepts — Indexes and Index-Organized Tables](https://docs.oracle.com/en/database/oracle/oracle-database/26/cncpt/indexes-and-index-organized-tables.html)
- [MongoDB Manual — Partial Indexes](https://www.mongodb.com/docs/manual/core/index-partial/)
- [Amazon DynamoDB Developer Guide — Take advantage of sparse indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-indexes-general-sparse-indexes.html)
- [Elasticsearch Reference — Thai tokenizer](https://www.elastic.co/docs/reference/text-analysis/analysis-thai-tokenizer)
- [OpenSearch Documentation — Thai analyzer](https://docs.opensearch.org/latest/analyzers/language-analyzers/thai/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
