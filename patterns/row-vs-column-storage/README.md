<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗃️ Database Internals & Performance](../../README.md#database-internals--performance)

# Row vs Column Storage

> Store rows together for transactions or columns together for analytics, and why a column store scans and compresses so much faster.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Row vs Column Storage" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/row-vs-column-storage.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · A row store reads it all** | Acme's analysts want revenue per product category over all 1,250,000 order items. PostgreSQL keeps each row whole on 8 kB heap pages, 120 to a page, so its **Parallel Seq Scan** reads all **10,417 pages** of `order_items` and the 94 pages of `products`: 82 MB. A row takes 68 bytes of its page (a 24-byte header, a 4-byte pointer, 9 bytes of padding and 31 bytes of values) and the query uses 19 of them, `product_id`, `qty` and `price_thb`: about **130 ms** with two parallel workers and 330 ms in one process (medians of nine runs on a laptop). |
| **2 · Store each column apart** | A column store such as **DuckDB** (1.5.6 here) cuts a table into row groups of up to 122,880 rows and stores each column of a row group as its own compressed segment. One column's values look alike, so frame-of-reference **bit-packing** fits `qty` and `line_no` in 2 bits a value, `product_id` in 14 and `price_thb` (a `DECIMAL` kept as an integer) in 20, delta encoding fits the sorted `order_id` in about 1 bit, and `category` becomes a dictionary. The scan reads only the three columns the query needs, and each operator takes **vectors of up to 2,048 values** where PostgreSQL's plan nodes hand up one row per call. |
| **3 · Measured: 13× less data** | Loaded with the same rows, DuckDB returns the same 12 sums after reading **25 blocks of 256 kB (6.25 MB)**, 13 times less, in about **5 ms** with 8 threads; on one core it takes 11 ms against PostgreSQL's 330 ms. Three of five columns, packed into 36 bits a row with no per-row headers, shrink the bytes, and vectors shrink the CPU work. With a filter, **zone maps** (each segment's minimum and maximum) skip more: for September's orders the join passed `order_id` 475,224–498,664 to the scan, which read 2 of 11 row groups (2.25 MB, 2 ms), while PostgreSQL read all 15,569 pages of the three tables (47 ms). |
| **4 · One-row writes favour rows** | Change one `qty`: PostgreSQL finds the row through `order_items_pkey` (4 pages) and writes a new 59-byte version at (10416,81), since page 0 has 8 bytes free, plus an index entry: 3 WAL records, 235 bytes. DuckDB scans the 122,880 keys of row group 0, logs 147 bytes, and its next `CHECKPOINT` rewrites the whole `qty` segment of that row group, 266,240 bytes. Run OLTP on a row store and analytics on a column store, and move the data between them with [change data capture](../change-data-capture/) or batch ELT into a [medallion architecture](../medallion-architecture/). |
<!-- END GENERATED: header -->

## The problem

Acme Shop's analysts want one number per product category: revenue over every order item ever sold.

```sql
SELECT p.category, sum(i.qty * i.price_thb) AS revenue
FROM order_items i JOIN products p ON p.id = i.product_id
GROUP BY p.category ORDER BY revenue DESC;
```

The query needs three of the five columns of `order_items` (`product_id`, `qty` and `price_thb`) and two of `products`. [PostgreSQL](../postgresql/) 18.6 can't fetch just those, because it stores every row whole. Its plan is a `Gather Merge` over two parallel workers: with the leader, three processes share a `Parallel Seq Scan` of all 10,417 heap pages of `order_items` (81 MB), each one reads the 94 pages of `products` to build its own hash table, and 1,250,000 rows go through a `Hash Join` and a `Partial HashAggregate` to become 12. That took about 130 ms, and 330 ms with parallel query switched off (medians of nine runs on a laptop, without `EXPLAIN`'s own overhead). The cost grows with every row and every column the table gains, whatever the analysts ask for.

`pageinspect` shows where the bytes go. Heap page 0 holds 120 rows, and each takes 68 bytes of it: a 4-byte line pointer near the start of the page, and from the end of the page backwards a 23-byte tuple header padded to 24 (`t_hoff`), 31 bytes of values, 4 bytes of padding that put `product_id` on an 8-byte boundary, and 5 more that align the next row. The query uses 19 of those 68 bytes (28%): `product_id` (8), `qty` (4) and `price_thb` (a `numeric`, 7 bytes here). PostgreSQL reads and caches whole 8 kB pages, so the other 49 bytes of every row come along.

## How it works

**Row layout.** A row store keeps each row's values next to each other. In PostgreSQL's heap a row is one tuple on one page, found by its address `(page, item)`: order 2's first line is `(0,4)`. Reading or changing one row touches one heap page plus the index pages that lead to it, which is what transactions do all day, and an analytical scan reads every page.

**Column layout.** A column store keeps each column's values next to each other. To compare, the same three tables went into DuckDB 1.5.6, an embedded column store, loaded from a CSV export in the same order. DuckDB cuts a table into row groups of up to 122,880 rows (here ten full ones and one of 21,200) and stores each column of a row group as a separate column segment in 256 kB blocks. A scan names the columns it needs, and the plan for the query above shows exactly three: `TABLE_SCAN order_items, Projections: product_id, qty, price_thb`.

**Compression.** The values of one column share a type and usually a narrow range, which row storage interleaves with everything else. DuckDB analyses each segment when it writes it and keeps the method that comes out smallest. `pragma_storage_info` shows what it picked:

| Column | PostgreSQL | DuckDB segment | Bits per value | Why it packs |
|---|---|---|---|---|
| `order_id` | 8 bytes | bit-packing, `DELTA_FOR` | about 1 | sorted, each step is 0 or 1 |
| `line_no` | 4 bytes | bit-packing, `FOR` | 2 | values 1 to 4 |
| `product_id` | 8 bytes | bit-packing, `FOR` | 14 | values 1 to 10,000 |
| `qty` | 4 bytes | bit-packing, `FOR` | 2 | values 1 to 3 |
| `price_thb` | 7 bytes (`numeric`) | bit-packing, `FOR` | 20 | 59.53 to 9,998.89, held as whole satang |
| `products.category` | text | dictionary | about 4 | 12 distinct names |

Frame of reference (`FOR`) stores the minimum of each group of 2,048 values once and every value as its distance from it, in as few bits as the largest distance needs; `DELTA_FOR` does the same with the differences between neighbours. A `DECIMAL(10,2)` is a 64-bit integer inside DuckDB, so prices pack like any other integer. The `NOT NULL` columns' validity masks compressed to a constant, `products.id` (1 to 10,000 in order) to 112 bytes, and `sku` and `name` with FSST, a dictionary of common substrings. Its other methods include run-length encoding, which needs long runs of equal values and found none here, ALP for floating-point numbers, and Zstd. `order_items` came to 6.7 MB in a DuckDB file of its own, against 81 MB of heap.

**Vectorised execution.** PostgreSQL's executor pulls rows through the plan: each call to a plan node returns one row, and every `qty * price_thb` is computed in the arbitrary-precision `numeric` type. DuckDB's operators take vectors of up to 2,048 values: the 1,250,000 rows leave the scan in 611 vectors, and each operator call is a tight loop over arrays of 64-bit integers. The idea goes back to MonetDB/X100 (Boncz, Zukowski and Nes, CIDR 2005); SQL Server calls it batch mode. It shows on one thread: 11 ms against 330 ms is a 30-fold gap, more than the 13-fold cut in bytes explains.

**Late materialisation.** In a column store a row is only a position shared by its column segments. Engines filter and join on the few columns that decide which rows survive, and assemble full rows from the other columns only for the survivors, at the end. Abadi, Boncz, Harizopoulos, Idreos and Madden's survey of column stores (2013) calls this late materialisation and covers it next to vectorised processing and operating on compressed data. A row store has the whole row in hand from the first read, so there is nothing to postpone.

**Zone maps.** DuckDB keeps the minimum and maximum of every segment and skips segments a filter rules out. `order_id` is sorted, so the zone maps are tight: row group 0 holds orders 1 to 49,152, row group 9 orders 442,369 to 491,520, row group 10 the rest up to 500,000. For revenue in September 2026, the join built its hash table from the 23,436 September orders and passed their id range to the `order_items` scan (`order_id>=475224 AND order_id<=498664` under *Dynamic Filters* in the plan). Two row groups overlap that range, so the scan read 144,080 of 1,250,000 rows (the profiler's `OPERATOR_ROWS_SCANNED`), `orders` was cut to 67,872 of 500,000 rows by its `created_at` zone maps, and the whole query read 9 blocks (2.25 MB) cold and took 2 ms. PostgreSQL read all 15,569 pages of the three tables in 47 ms. Zone maps only help on columns stored in roughly the order you filter on; PostgreSQL's opt-in equivalent is a BRIN index, which keeps a minimum and maximum for every range of 128 pages by default ([index types](../index-types/)).

**What the runs measured** (PostgreSQL in a Docker container and DuckDB in Python on the same 8-core laptop, both with the data in memory; times are medians of nine runs):

| | PostgreSQL 18.6, heap | DuckDB 1.5.6, columns |
|---|---|---|
| `order_items` on disk | 10,417 pages, 81 MB | 6.7 MB |
| Read by the query | 10,511 pages, 82 MB | 25 blocks, 6.25 MB |
| Time, default settings | 130 ms (2 workers) | 5 ms (8 threads), 10 ms cold |
| Time, one core | 330 ms | 11 ms |
| September only | 15,569 pages, 47 ms | 2 of 11 row groups, 2.25 MB, 2 ms |
| One row by key, cold | 4 pages, 32 kB | 4 blocks, 1 MB; 122,880 keys scanned |
| `UPDATE` one `qty` | new version + index entry; WAL 235 B | WAL 147 B, then 266,240 B at `CHECKPOINT` |

**Writes go the other way.** `UPDATE order_items SET qty = 3 WHERE order_id = 2 AND line_no = 1` costs PostgreSQL an index descent (4 pages: three levels of `order_items_pkey` and the heap page) and a new 59-byte row version. Heap page 0 has 8 bytes free, so the version went to the last page as `(10416,81)`, and because it moved off its page the update couldn't be a HOT update: the primary key got a new entry too. Three WAL records, 235 bytes (21 kB when they were the first changes to those pages after a checkpoint, which logs the full pages). The old version stays behind for VACUUM ([MVCC](../mvcc/)). DuckDB found the row without its primary-key index: the plan was a scan of `order_id` and `line_no` that the zone maps narrowed to row group 0, 122,880 keys. It kept the new value in memory beside the segment (`has_updates` turns true) and logged 147 bytes to its WAL; the next `CHECKPOINT` re-encoded the whole `qty` segment of row group 0, all 122,880 values, into a new block and wrote 266,240 bytes. The rewrite is paid per segment, not per row: 1,000 random single-row updates, about 0.3 ms each, left 136 kB of WAL, and the next checkpoint rewrote all 11 `qty` segments for 528,384 bytes. Column stores want changes in batches. C-Store, an influential 2005 design by Stonebraker and colleagues, sent inserts and updates to a small writeable store and had a *tuple mover* merge them into the read-optimised column store in bulk; SQL Server's deltastore and ClickHouse's background merges of parts follow the same plan.

## Try it

The sample data comes from [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop), a script that builds the template database `acme` on PostgreSQL 18 in about a minute.

Run this in `psql` on a fresh copy; the comments show the key lines of the output, and the `\copy` lines write three CSV files next to you:

```sql
-- CREATE DATABASE rowcol_try TEMPLATE acme;   -- then connect to rowcol_try

EXPLAIN (ANALYZE, BUFFERS)
SELECT p.category, sum(i.qty * i.price_thb) AS revenue
FROM order_items i JOIN products p ON p.id = i.product_id
GROUP BY p.category ORDER BY revenue DESC;
-- Gather Merge   Workers Launched: 2
--   ->  Partial HashAggregate (actual rows=12.00 loops=3)
--         ->  Hash Join (actual rows=416666.67 loops=3)
--               ->  Parallel Seq Scan on order_items i
--                     Buffers: shared hit=2048 read=8369    (10,417 pages between 3 processes)
--               ->  Hash  ->  Seq Scan on products p
--                     Buffers: shared hit=282               (94 pages, once per process)

SELECT pg_relation_size('order_items') / 8192 AS pages,
       pg_size_pretty(pg_relation_size('order_items')) AS size;
-- 10417 | 81 MB

CREATE EXTENSION IF NOT EXISTS pageinspect;
SELECT lp, lp_off, lp_len, t_hoff
FROM heap_page_items(get_raw_page('order_items', 0)) WHERE lp BETWEEN 2 AND 6;
-- 2 | 8064 | 59 | 24      a 24-byte header and 35 bytes of data, rows 64 bytes apart
-- 3 | 8000 | 59 | 24
SELECT lower, upper FROM page_header(get_raw_page('order_items', 0));
-- 504 | 512               24-byte page header + 120 line pointers of 4 bytes; 8 bytes free

\copy (SELECT * FROM order_items ORDER BY order_id, line_no) TO 'order_items.csv' CSV HEADER
\copy (SELECT * FROM products ORDER BY id) TO 'products.csv' CSV HEADER
\copy (SELECT * FROM orders ORDER BY id) TO 'orders.csv' CSV HEADER

EXPLAIN (ANALYZE, BUFFERS, WAL, COSTS OFF)
UPDATE order_items SET qty = 3 WHERE order_id = 2 AND line_no = 1;
-- Update on order_items   WAL: records=3 bytes=235
--   ->  Index Scan using order_items_pkey on order_items
SELECT ctid FROM order_items WHERE order_id = 2 AND line_no = 1;
-- (10416,81)               page 0 was full, so the new version went to the last page
```

Then load the CSV files into DuckDB 1.5 (`python3 -m venv duck && duck/bin/pip install duckdb`) and run these statements in the same folder, one at a time with `duckdb.sql(...)` in Python or in the DuckDB command-line client:

```sql
ATTACH 'acme.duckdb' AS acme;
USE acme;
SET threads = 1;     -- load in one pass, so row groups fill up in key order
CREATE TABLE products (id BIGINT PRIMARY KEY, sku VARCHAR NOT NULL UNIQUE, name VARCHAR NOT NULL,
                       category VARCHAR NOT NULL, price_thb DECIMAL(10,2) NOT NULL);
CREATE TABLE order_items (order_id BIGINT NOT NULL, line_no INTEGER NOT NULL,
                          product_id BIGINT NOT NULL, qty INTEGER NOT NULL,
                          price_thb DECIMAL(10,2) NOT NULL, PRIMARY KEY (order_id, line_no));
CREATE TABLE orders (id BIGINT PRIMARY KEY, customer_id BIGINT NOT NULL, status VARCHAR NOT NULL,
                     shipping_country VARCHAR NOT NULL, created_at TIMESTAMPTZ NOT NULL,
                     total_thb DECIMAL(12,2) NOT NULL);
INSERT INTO products SELECT * FROM 'products.csv';
INSERT INTO order_items SELECT * FROM 'order_items.csv';
INSERT INTO orders SELECT * FROM 'orders.csv';
CHECKPOINT;
RESET threads;
SET TimeZone = 'UTC';

SELECT column_name, compression, max(segment_info) AS info, count(*) AS segments
FROM pragma_storage_info('order_items') WHERE segment_type <> 'VALIDITY'
GROUP BY ALL ORDER BY column_name;
-- line_no    | BitPacking | FOR: 60       | 11
-- order_id   | BitPacking | DELTA_FOR: 60 | 11
-- price_thb  | BitPacking | FOR: 50       | 21    (two segments per row group)
-- product_id | BitPacking | FOR: 60       | 11
-- qty        | BitPacking | FOR: 60       | 11

EXPLAIN ANALYZE
SELECT p.category, sum(i.qty * i.price_thb) AS revenue
FROM order_items i JOIN products p ON p.id = i.product_id
GROUP BY p.category ORDER BY revenue DESC;
-- TABLE_SCAN order_items   Projections: product_id, qty, price_thb   1,250,000 rows
--   -> HASH_JOIN product_id = id -> HASH_GROUP_BY -> 12 rows

EXPLAIN ANALYZE
SELECT p.category, sum(i.qty * i.price_thb) AS revenue
FROM order_items i JOIN orders o ON o.id = i.order_id JOIN products p ON p.id = i.product_id
WHERE o.created_at >= '2026-09-01' AND o.created_at < '2026-10-01'
GROUP BY p.category ORDER BY revenue DESC;
-- TABLE_SCAN order_items   Dynamic Filters: order_id>=475224 AND order_id<=498664   58,601 rows

UPDATE order_items SET qty = 3 WHERE order_id = 2 AND line_no = 1;
SELECT block_id, block_offset, has_updates FROM pragma_storage_info('order_items')
WHERE column_name = 'qty' AND segment_type = 'INTEGER' AND row_group_id = 0;
-- 7 | 31448 | true        the change waits in memory
CHECKPOINT;
SELECT block_id, block_offset, has_updates FROM pragma_storage_info('order_items')
WHERE column_name = 'qty' AND segment_type = 'INTEGER' AND row_group_id = 0;
-- 186 | 0 | false         the whole segment was written again, to a new block
```

## When to use it

- **A row store for OLTP:** many short transactions that insert, read and change whole rows by key, under concurrency, with indexes and row-level locks. This is PostgreSQL's, MySQL's and SQL Server's home ground, and Acme Shop's checkout belongs there.
- **A column store for analytics:** scans and aggregations over millions of rows that touch a few columns at a time, data loaded in batches, and data that compresses well because it is sorted or repetitive. Examples are DuckDB inside an application or a notebook, ClickHouse, and the warehouses Amazon Redshift and Google BigQuery, which store tables by column.
- **Columnar files for a data lake:** Parquet keeps the same idea in a file, with row groups, column chunks and per-column encodings, so any engine can read just the columns it needs from object storage such as [Amazon S3](../amazon-s3/). Exported by DuckDB with its defaults (Snappy compression), `order_items` became an 8.5 MB file in which the query's three columns take 5.4 MB, and the same query over the file took 6 ms.
- **Wide tables gain the most.** `order_items` has five narrow columns, so most of the 13 times came from compression and from dropping the per-row overhead. A fact table with forty columns of which a report reads four gains much more from skipping columns.
- **Maybe you don't need a second engine.** When the report is fixed, a [materialized view](../materialized-view/) or a summary table refreshed in PostgreSQL may be enough; when reads and writes need different shapes, [CQRS](../cqrs/) keeps a read model next to the write model. A separate column store pays off when analysts ask new questions of large data.

## Trade-offs

- **Single-row writes cost more.** One changed value meant rewriting a 122,880-value segment at the next checkpoint (266,240 bytes against PostgreSQL's 3 dirty pages), and each insert adds to five column segments instead of one row. DuckDB's own documentation advises against loading data with many single-row `INSERT` statements and suggests bulk loads or, failing that, large transactions.
- **Point lookups touch every column.** Reading order 2's first line cold cost DuckDB 4 blocks (1 MB), because each column sits in a different segment; PostgreSQL read 4 pages (32 kB) through the B-tree ([B-tree index](../b-tree-index/)).
- **One writer process.** A DuckDB database file is opened read-write by one process at a time, or read-only by several; inside that process transactions run under MVCC with optimistic concurrency control, and two that change the same rows conflict. That suits analytics and doesn't suit a busy web shop.
- **Indexes cost more than the data.** The primary key on `order_items` made DuckDB build an ART index of about 30 MB, more than four times the 6.7 MB of compressed data. ART indexes mainly enforce keys and serve very selective lookups, so analytical tables often go without them.
- **Two copies drift.** Analytics in a separate column store reads a copy of the data that is as fresh as the pipeline that fills it: [change data capture](../change-data-capture/) streams changes from the write-ahead log as they commit, and batch ELT reloads on a schedule, often through the bronze, silver and gold layers of a [medallion architecture](../medallion-architecture/). Either way there is a pipeline to run, monitor and repair, and a schema to keep in step.
- **Compression and skipping depend on order.** Sorted columns such as `order_id` pack into a bit per value and give tight zone maps; random keys such as UUIDs pack poorly and leave the zone maps little to skip.

## Implementation notes

**PostgreSQL** stores tables in the heap unless a table access method says otherwise, and the access method interface lets extensions plug in other layouts. The Citus `columnar` access method stores a table created `USING columnar` by column and compressed, in stripes of up to 150,000 rows (one transaction's worth at most). `pg_duckdb` runs DuckDB's columnar, vectorised engine inside PostgreSQL and reads Parquet, Iceberg and Delta Lake files. TOAST, PostgreSQL's built-in compression, works on single large values once a row passes about 2 kB, so it never compresses a column. BRIN indexes give the heap a zone map for columns that follow the physical order, such as a creation time.

**MySQL (InnoDB, 8.4)** is a row store too: rows live in the leaves of the primary key's B-tree, the clustered index, in the `DYNAMIC` row format by default. Each clustered-index record carries a 5-byte header plus a 6-byte transaction id and a 7-byte roll pointer for MVCC, so an analytical scan pays a per-row overhead there as well.

**SQL Server** offers both layouts in one database. A clustered columnstore index stores a whole table by column in rowgroups of up to 1,048,576 rows; small writes go to a deltastore, a B-tree, until a background tuple-mover compresses them into column segments. A nonclustered columnstore index on an ordinary rowstore table lets analytics run on the column copy while transactions use the rows, which Microsoft calls real-time operational analytics, and queries on columnstore indexes run in batch mode, its vectorised execution.

**Other hybrids keep two formats of the same data.** Oracle Database In-Memory keeps rows in the buffer cache and on disk and holds compressed columnar copies of chosen tables in memory. TiDB replicates rows from TiKV to TiFlash column replicas asynchronously through Raft learners, so analytical queries read columns without a separate pipeline.

**Warehouses and lakes.** Amazon Redshift stores each column in its own blocks, BigQuery stores tables in its Capacitor columnar format, and ClickHouse's MergeTree writes each insert as a new part, sorted by the table's key and stored by column, and merges parts in the background, a design close to an [LSM tree](../lsm-tree/); its `ALTER TABLE … UPDATE` is a mutation that rewrites whole parts, documented as a heavy operation. Parquet encodes each column chunk on its own, with plain, dictionary, run-length and bit-packing, delta and byte-stream-split encodings. Amazon [Aurora](../amazon-rds-aurora/) offers zero-ETL integrations that replicate an Aurora cluster into Amazon Redshift in near real time, which removes the pipeline you would otherwise run but not the second copy.

**Where the ideas come from.** C-Store (Stonebraker, Abadi and colleagues, VLDB 2005) stored data by column in overlapping sorted projections, compressed each column and split writes from reads; MonetDB/X100 (CIDR 2005) introduced vector-at-a-time execution; and Abadi, Boncz, Harizopoulos, Idreos and Madden's 2013 survey brings the techniques together. DuckDB's documentation gives the rest: compression per segment, row groups of 122,880 rows, vectors of 2,048 values and zone maps on columns of every general-purpose type.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Medallion Architecture](../medallion-architecture/) — Bronze, silver, gold: raw data is refined in layers inside a lakehouse.
- [Change Data Capture (CDC)](../change-data-capture/) — Stream every committed change from the database log to other systems.
- [Materialized View](../materialized-view/) — Precompute query-shaped views so reads don't pay for joins and aggregations.
- [CQRS](../cqrs/) — Separate the write model (commands) from read models (queries), each optimised for its job.
- [Join Algorithms](../join-algorithms/) — Nested loop, hash join and merge join: how each joins two tables, what it costs, and when the planner picks it.
- [Index Types](../index-types/) — Beyond B-trees: hash, GIN for arrays, JSON and text, GiST, BRIN for time-ordered data, and partial and expression indexes.
- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [Amazon S3](../amazon-s3/) — Object storage: objects in buckets, addressed by key, stored across Availability Zones, with storage classes, versioning and events.
- [LSM Tree vs B-Tree](../lsm-tree/) — Two storage engine designs: update pages in place, or append in memory and merge sorted files, and what each costs to read and write.

## References

- [PostgreSQL 18 documentation — Database Page Layout](https://www.postgresql.org/docs/18/storage-page-layout.html)
- [PostgreSQL 18 documentation — Executor (one row per call)](https://www.postgresql.org/docs/18/executor.html)
- [PostgreSQL 18 documentation — Heap-Only Tuples (HOT)](https://www.postgresql.org/docs/18/storage-hot.html)
- [PostgreSQL 18 documentation — BRIN Indexes](https://www.postgresql.org/docs/18/brin.html)
- [DuckDB documentation — Storage Versions and Format (compression algorithms, row groups)](https://duckdb.org/docs/current/internals/storage.html)
- [DuckDB documentation — Execution Format (vectors)](https://duckdb.org/docs/current/internals/vector.html)
- [DuckDB documentation — Indexing (zonemaps and ART indexes)](https://duckdb.org/docs/current/guides/performance/indexing.html)
- [DuckDB documentation — Concurrency](https://duckdb.org/docs/current/connect/concurrency.html)
- [DuckDB blog — Lightweight Compression in DuckDB (2022)](https://duckdb.org/2022/10/28/lightweight-compression.html)
- [Apache Parquet — Encodings](https://parquet.apache.org/docs/file-format/data-pages/encodings/)
- [Mike Stonebraker et al. — C-Store: A Column-oriented DBMS (VLDB 2005)](https://www.vldb.org/archives/website/2005/program/paper/thu/p553-stonebraker.pdf)
- [Daniel Abadi, Peter Boncz, Stavros Harizopoulos, Stratos Idreos and Samuel Madden — The Design and Implementation of Modern Column-Oriented Database Systems (Foundations and Trends in Databases, 2013)](https://www.cs.umd.edu/~abadi/papers/abadi-column-stores.pdf)
- [Peter Boncz, Marcin Zukowski and Niels Nes — MonetDB/X100: Hyper-Pipelining Query Execution (CIDR 2005)](https://www.cidrdb.org/cidr2005/papers/P19.pdf)
- [MySQL 8.4 Reference Manual — InnoDB Row Formats](https://dev.mysql.com/doc/refman/8.4/en/innodb-row-format.html)
- [Microsoft Learn — Columnstore indexes: Overview (SQL Server)](https://learn.microsoft.com/en-us/sql/relational-databases/indexes/columnstore-indexes-overview)
- [Amazon Redshift Database Developer Guide — Columnar storage](https://docs.aws.amazon.com/redshift/latest/dg/c_columnar_storage_disk_mem_mgmnt.html)
- [Amazon Aurora User Guide — Aurora zero-ETL integrations](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/zero-etl.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
