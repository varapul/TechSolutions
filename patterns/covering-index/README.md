
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗃️ Database Internals & Performance](../../README.md#database-internals--performance)

# Covering Index

> Answer a query from the index alone: include the columns it selects, so the table is never read, and the scan is index-only.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Covering Index" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/covering-index.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One heap page per row** | With an index on `(customer_id, created_at)`, PostgreSQL 18.6 walks three index pages (root, internal, leaf) to customer 42's newest entries, all on leaf page 58. An entry holds only the key and the row's address (its tid), and the 20 rows sit on 20 different pages of the 40 MB heap: `EXPLAIN (ANALYZE, BUFFERS)` reports `shared hit=23`, 3 index pages and 20 heap pages for 20 rows. With a cold cache, that is 20 random reads. |
| **2 · INCLUDE: index-only scan** | The covering index `(customer_id, created_at) INCLUDE (id, status, total_thb)` stores the selected columns in every leaf entry (56 bytes instead of 24), but not in the root and internal pages. The plan becomes an **Index Only Scan** with `Heap Fetches: 0` and `shared hit=4`: 3 index pages and 1 visibility map page. Included columns can't guide the search or the sort, and `id` has to be included too, because a PostgreSQL index entry doesn't carry the primary key. |
| **3 · The visibility map decides** | Index entries hold no visibility information, so for each entry the scan checks its heap page's all-visible bit and visits the heap only when the bit is clear. After an `UPDATE` of 2 of customer 42's orders, the new versions on page 5057 and the dead ones on pages 2392 and 4806 cost `Heap Fetches: 4` (`shared hit=8`), and the scan marks the 2 dead entries as it passes. `VACUUM` sets page 5057 all-visible again, and the count drops to 0. |
| **4 · Costs and other engines** | The covering index takes 32 MB instead of 15 MB, every insert writes the wider entry, and status updates can no longer be HOT: 80 of 990 were before, none after. Between vacuums, changed pages cost heap fetches again. In InnoDB every secondary index entry carries the primary key and the clustered index holds the rows; SQL Server has `INCLUDE` too, with the columns at the leaf level only. |
<!-- END GENERATED: header -->

## The problem

Acme's mobile app opens on a customer's latest orders, and the list shows only three columns:

```sql
SELECT id, status, total_thb FROM orders
WHERE customer_id = 42 ORDER BY created_at DESC LIMIT 20;
```

With an index on `(customer_id, created_at)`, PostgreSQL finds the 20 entries quickly. It reads the root, one internal page and one leaf page, where customer 42's newest entries sit side by side (leaf page 58 here), and walks that leaf backward, newest first. But a B-tree entry holds only the key and the row's address, its *tid* (heap page and item number). To return `id`, `status` and `total_thb`, the scan has to read each row from the table, and customer 42's orders are spread through it among everyone else's: the 20 rows sit on 20 different pages of the 5,058-page, 40 MB heap.

On PostgreSQL 18.6, `EXPLAIN (ANALYZE, BUFFERS)` reports `Buffers: shared hit=23`: 3 index pages and 20 heap pages, a whole 8 kB page for every row. With all of it cached, that still ran in well under 0.1 ms (one run on a laptop). Once those pages are no longer in memory, opening the screen can cost 20 random reads. Without any index on `customer_id`, the same query read all 5,058 pages.

## How it works

A **covering index** holds every column a query uses, so PostgreSQL can answer it from the index alone with an **index-only scan**. Since PostgreSQL 11, the `INCLUDE` clause adds columns to a B-tree index as payload: they are stored in each entry but are not part of the key.

```sql
CREATE INDEX orders_customer_covering_idx ON orders (customer_id, created_at)
  INCLUDE (id, status, total_thb);
```

- **The key still does the work.** `customer_id` and `created_at` order the entries and serve the search and the sort. The included columns ride along in the leaf entries, which grew from 24 to 56 bytes here. Root and internal pages keep only key values, because B-tree suffix truncation always removes non-key columns from the upper levels.
- **Every column counts, `id` too.** The planner considers an index-only scan only when every column the query references is in the index. A PostgreSQL index entry doesn't carry the primary key (an InnoDB one does), so with `INCLUDE (status, total_thb)` alone the plan stayed an `Index Scan` with 23 buffers. With `id` included it became `Index Only Scan Backward` with `Heap Fetches: 0` and `Buffers: shared hit=4`: 3 index pages and 1 page of the visibility map.
- **Payload, not key.** Included columns can't serve as an index search condition: adding `AND status = 'cancelled'` gave a `Filter` checked against all 179 of customer 42's entries (175 removed, still without touching the heap), not an `Index Cond`. They give no order either: `ORDER BY total_thb` added a `Sort` over the 179 rows. In a `UNIQUE` index they take no part in the uniqueness check.
- **The visibility map decides whether the heap is skipped.** An index entry carries no visibility information: whether a row version is visible to a snapshot is recorded only in the heap. So PostgreSQL keeps a **visibility map** for each table, two bits per heap page, the first of which says that every row on the page is visible to all transactions. For each entry, the index-only scan looks up the bit of the entry's heap page. If it is set, the values come straight from the index; if not, PostgreSQL fetches the row from the heap to check it, and `EXPLAIN ANALYZE` counts the visit under `Heap Fetches`.
- **VACUUM sets the bits; writes clear them.** Any insert, update or delete on a page clears its bit, and only `VACUUM` (or autovacuum) sets it again. In the run, an `UPDATE` that took 500 baht off 2 of customer 42's orders wrote the new row versions to page 5057 and left the old ones dead on pages 2392 and 4806, clearing 3 bits: `Heap Fetches: 4` and `shared hit=8`, two visits to return the new versions and two to find the old ones dead. In passing, the scan marked those 2 dead entries in the index, so later scans skip them. After `VACUUM`, page 5057 was all-visible again and the count dropped to 0. With only 2 dead rows, VACUUM skipped its pass over the indexes (it does when very few rows are dead), so pages 2392 and 4806 kept a dead line pointer and stayed off the map until a later vacuum; no live entry pointed there anymore.

## Try it

The sample data comes from [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop), a script that builds the template database `acme` on PostgreSQL 18 in about a minute.

Make a fresh copy of the sample data from another database on the same server, then run the script in the copy. Buffer counts after each `CREATE INDEX` are from a second run of the `EXPLAIN`, because the first run also reads the new index into the buffer cache. The counts after the `UPDATE` are from its first run: that run marks the 2 dead entries, so a second one shows `Heap Fetches: 2`.

```sql
-- from another database:  CREATE DATABASE covering_index TEMPLATE acme STRATEGY FILE_COPY;
-- then, connected to covering_index (PostgreSQL 18):

VACUUM (ANALYZE) orders;  -- a fresh copy has an empty visibility map

PREPARE recent AS
  SELECT id, status, total_thb FROM orders
  WHERE customer_id = 42 ORDER BY created_at DESC LIMIT 20;

CREATE INDEX orders_customer_id_created_at_idx ON orders (customer_id, created_at);
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE recent;
-- Index Scan Backward using orders_customer_id_created_at_idx on orders
--   Index Cond: (customer_id = 42)
--   Buffers: shared hit=23               3 index pages + 20 heap pages

CREATE INDEX orders_customer_covering_idx ON orders (customer_id, created_at)
  INCLUDE (id, status, total_thb);
DROP INDEX orders_customer_id_created_at_idx;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE recent;
-- Index Only Scan Backward using orders_customer_covering_idx on orders
--   Heap Fetches: 0
--   Buffers: shared hit=4                3 index pages + 1 visibility map page

UPDATE orders SET total_thb = total_thb - 500 WHERE id IN (495179, 493709);
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE recent;
--   Heap Fetches: 4                      new versions on page 5057, dead ones on 2392 and 4806
--   Buffers: shared hit=8

VACUUM orders;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE recent;
--   Heap Fetches: 0
--   Buffers: shared hit=4

SELECT pg_size_pretty(pg_relation_size('orders_customer_covering_idx'));
-- 32 MB   (orders_customer_id_created_at_idx was 15 MB)
```

## When to use it

- **A hot, narrow query.** A screen, an API endpoint or a lookup that runs thousands of times a minute and reads a few short columns through a selective index: a recent-orders list, a status check, a price lookup.
- **Pages that stay all-visible.** The heap is skipped only where the visibility bit is set, so the payoff is largest on read-mostly or append-mostly tables that autovacuum keeps up with: history, reference data, orders that are rarely changed once delivered. On a table whose rows change all the time, the scan visits the heap anyway and the payload only costs.
- **A unique key that needs a column or two more.** With `CREATE UNIQUE INDEX … ON customers (email) INCLUDE (id, name)`, a lookup by email returns the customer's `id` and `name` from the index, and uniqueness still applies to `email` alone.
- **Not for wide or many columns.** Including most of the row copies the table into the index, and reading the heap is cheaper than keeping a second copy current. For a read model with many columns or joins, a [materialized view](../materialized-view/) or a separate read store, as in [CQRS](../cqrs/), fits better.

## Trade-offs

- **Size.** The covering index took 32 MB (4,121 pages) against 15 MB (1,927 pages) for the plain two-column index: 122 entries per leaf page instead of 261, and twice the memory to keep it cached.
- **Every write pays.** Each insert writes the wider entry: 10,000 new orders wrote 26 MB of WAL instead of 15 MB right after a checkpoint, when the first change to each page logs the whole page. An update of an included column can never be HOT (heap-only), because HOT requires that no indexed column changes: of 990 `pending → paid` updates, 80 were HOT with the plain index and none with the covering one, so every one of them added an entry to each index on the table.
- **The benefit lasts only as long as the visibility map.** Between vacuums, changed pages cost heap fetches again. By default autovacuum processes a table once 50 rows plus 20 % of it are dead: 100,050 rows for `orders`. A table that depends on index-only scans may want a lower `autovacuum_vacuum_scale_factor`, set as a storage parameter on that table.
- **Limits.** A B-tree entry can't exceed about a third of a page, so a wide payload can make inserts fail. Included columns can't be expressions, and B-tree deduplication (PostgreSQL 13 and later) is never used for an index with `INCLUDE`.

## Implementation notes

- **Reading EXPLAIN.** Look for `Index Only Scan`, then at `Heap Fetches`. A count close to the number of rows returned means the visibility map isn't helping, and the scan is an index scan in disguise. `pg_class.relallvisible` against `relpages` is the planner's estimate of the all-visible share, and the `pg_visibility` extension reads the map itself. Since PostgreSQL 18, `EXPLAIN ANALYZE` reports buffers without being asked. Reading plans in general is the subject of [Query Execution Plans](../query-execution-plans/).
- **Vacuum after bulk loads.** A freshly loaded or restored table has an empty visibility map: on a fresh copy of the sample data the plan already said `Index Only Scan`, yet showed `Heap Fetches: 20` and 23 buffers, no better than the plain index, until `VACUUM` ran. Since PostgreSQL 13, inserts also trigger autovacuum, so append-only tables get their bits set too.
- **INCLUDE or key columns.** Listing the columns as trailing key columns, `(customer_id, created_at, id, status, total_thb)`, gave the same 32 MB here, because suffix truncation also drops trailing key columns from the upper pages when the leading ones are enough. Use `INCLUDE` when the extra columns must not change what is unique, when their types have no B-tree operator class, or to make the payload explicit; use key columns when queries also filter or sort on them, as in [Composite Index](../composite-index/). B-tree supports `INCLUDE` since PostgreSQL 11, GiST since 12 and SP-GiST since 14; the other index types are compared in [Index Types](../index-types/), and the B-tree itself in [B-Tree Index](../b-tree-index/).
- **MySQL 8.4 (InnoDB).** The table itself is a clustered index on the primary key, and every secondary index entry holds the primary key columns, which InnoDB uses to find the row. An index on `(customer_id, created_at)` therefore already covers `SELECT id …`, and a lookup by `id` reaches the row in the clustered index directly. There is no `INCLUDE`: add `status` and `total_thb` as trailing key columns, and `EXPLAIN` shows `Using index` when the query is covered. The visibility question is answered per index page: when a secondary index record is delete-marked, or its page was updated by a newer transaction, InnoDB looks the row up in the clustered index instead of answering from the index.
- **SQL Server.** Nonclustered indexes accept `INCLUDE (status, total_thb)`; included columns are stored at the leaf level only and don't count toward the key limits (32 key columns and 1,700 bytes since SQL Server 2016). On a table with a clustered index, each nonclustered entry carries the clustering key, much as in InnoDB. When the index lacks a column the query needs, the plan shows a Key Lookup (a RID Lookup on a heap table) for each row.
- **DynamoDB.** A global secondary index stores a projection of each item, `KEYS_ONLY`, `INCLUDE` or `ALL`, and the table's key attributes are always in it. A query on a global secondary index can't fetch attributes that aren't projected, so the projection has to cover the query; see [Amazon DynamoDB](../amazon-dynamodb/).
- How `UPDATE` writes row versions and how `VACUUM` removes them is explained on the [PostgreSQL](../postgresql/) page.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [B-Tree Index](../b-tree-index/) — How a B-tree index finds a row in three or four page reads, serves ranges in order, and what every insert costs to keep it sorted.
- [Composite Index](../composite-index/) — A multi-column index serves queries that use its leading columns: put equality columns first and the range or sort column last.
- MVCC *(planned)* — Multi-version concurrency control: an update writes a new row version, readers see a snapshot, and vacuum removes dead versions.
- [Query Execution Plans](../query-execution-plans/) — Read EXPLAIN the way the planner thinks: scans, joins, estimated against actual rows, and the statistics behind each choice.
- [Index Types](../index-types/) — Beyond B-trees: hash, GIN for arrays, JSON and text, GiST, BRIN for time-ordered data, and partial and expression indexes.
- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [Materialized View](../materialized-view/) — Precompute query-shaped views so reads don't pay for joins and aggregations.
- [CQRS](../cqrs/) — Separate the write model (commands) from read models (queries), each optimised for its job.

## References

- [PostgreSQL 18 documentation — Index-Only Scans and Covering Indexes](https://www.postgresql.org/docs/18/indexes-index-only-scans.html)
- [PostgreSQL 18 documentation — CREATE INDEX (the INCLUDE clause)](https://www.postgresql.org/docs/18/sql-createindex.html)
- [PostgreSQL 18 documentation — Visibility Map](https://www.postgresql.org/docs/18/storage-vm.html)
- [PostgreSQL 18 documentation — Routine Vacuuming](https://www.postgresql.org/docs/18/routine-vacuuming.html)
- [PostgreSQL 18 documentation — VACUUM (INDEX_CLEANUP)](https://www.postgresql.org/docs/18/sql-vacuum.html)
- [PostgreSQL 18 documentation — Heap-Only Tuples (HOT)](https://www.postgresql.org/docs/18/storage-hot.html)
- [MySQL 8.4 Reference Manual — Clustered and Secondary Indexes](https://dev.mysql.com/doc/refman/8.4/en/innodb-index-types.html)
- [MySQL 8.4 Reference Manual — InnoDB Multi-Versioning](https://dev.mysql.com/doc/refman/8.4/en/innodb-multi-versioning.html)
- [MySQL 8.4 Reference Manual — EXPLAIN Output Format (Using index)](https://dev.mysql.com/doc/refman/8.4/en/explain-output.html)
- [Microsoft Learn — Create indexes with included columns (SQL Server)](https://learn.microsoft.com/en-us/sql/relational-databases/indexes/create-indexes-with-included-columns)
- [Microsoft Learn — SQL Server index architecture and design guide](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-index-design-guide)
- [Microsoft Learn — Showplan operator reference (Key Lookup)](https://learn.microsoft.com/en-us/sql/relational-databases/showplan-logical-and-physical-operators-reference)
- [Amazon DynamoDB Developer Guide — Using global secondary indexes (projections)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
