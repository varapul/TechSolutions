<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗃️ Database Internals & Performance](../../README.md#database-internals--performance)

# B-Tree Index

> How a B-tree index finds a row in three or four page reads, serves ranges in order, and what every insert costs to keep it sorted.

<p align="center"><img src="diagram.svg" alt="Animated diagram: B-Tree Index" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/b-tree-index.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · No index: read everything** | Acme's support tool asks for customer 42's orders, but `customer_id` has no index: PostgreSQL doesn't create one for a foreign key. The only plan is a **sequential scan**, a Gather with two parallel workers that reads all **5,058 pages** of `orders`, checks every row and throws **499,821** away to keep **179** (about 11 ms in one run on a laptop). The work grows with the table, not with the answer. |
| **2 · Walk down the B-tree** | `CREATE INDEX ON orders (customer_id)` builds a 705-page B-tree with three levels. The lookup compares 42 with the keys of root page 286, follows a downlink to page 3 and then to leaf page 14, where the keys are sorted and 42's entry holds **179 TIDs** in two posting lists. PostgreSQL collects the TIDs in a bitmap and reads the **175 heap pages** in page order: **3 + 175 pages** instead of 5,058, in about 0.09 ms. |
| **3 · When the planner uses it** | Leaf pages link to their neighbours, so `BETWEEN 42 AND 47` descends once and walks right from leaf 14 into leaf 15 (4 index pages, 902 rows). The planner prices each plan from its statistics: customer 1's 2,633 orders still go through the index but touch 2,080 heap pages, and `status = 'delivered'` matches 487,245 rows, so it reads the table sequentially even though `orders_status_idx` exists. |
| **4 · What every write pays** | A new order lands on heap page 5,057 and its key goes into leaf 14, which had 104 bytes free: it absorbed 39 new orders for customer 42 and the 40th **split** it, moving keys 43–46 to new page 705 and adding the separator 43 to page 3. Inserting 50,000 orders wrote 8.5 MB of WAL with the primary key alone, 12.4 MB with `orders_customer_id_idx` and 15.6 MB with an index on `status` as well, and an update that changes an indexed column can't be a HOT update. **Index the foreign keys you query by**, and drop the indexes nobody uses. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's support tool opens a customer's order history with one query:

```sql
SELECT id, status, created_at, total_thb FROM orders WHERE customer_id = 42;
```

`orders` holds 500,000 rows on 5,058 heap pages of 8 kB, 40 MB in all. `customer_id` is a foreign key to `customers`, but declaring a foreign key gives the referencing column no index in [PostgreSQL](../postgresql/), so the planner has only one way to answer: read the table. On PostgreSQL 18.6 the plan is a `Gather` over a `Parallel Seq Scan` with two workers. Between them the three processes read all 5,058 pages, test 500,000 rows and discard 499,821 of them to return customer 42's 179 orders, in about 11 ms in one run on a laptop. That sounds harmless until you look at what it grows with: double the orders and every lookup does twice the work for the same 179 rows, while each agent's click competes with all the others for CPU and cache.

## How it works

**A tree of 8 kB pages.** `CREATE INDEX ON orders (customer_id)` (128 ms here) sorts all 500,000 `(customer_id, TID)` pairs and packs them into pages. A TID is a row's address in the heap, `(page, item)`: `(46,22)` is item 22 on heap page 46. The run built 705 pages in three levels (`bt_metap` reports the root at level 2):

- **Leaf pages**, 700 of them, hold the entries in key order, about 90% full after the build, which is the default `fillfactor` for B-tree leaves. Since PostgreSQL 13 a run of equal keys is stored once with a sorted list of TIDs, a *posting list*: leaf page 14 keeps keys 38 to 46 in 16 tuples, and customer 42's 179 TIDs fill two of them (132 + 47). Deduplication is why this index needs 705 pages while the primary key, with as many entries but no duplicates, needs 1,374.
- **Internal pages** hold separator keys, each with a downlink to the page below. Page 3 has 280 of them (`… 32 38 46 55 …`); the entry for 38 points to leaf 14, which holds the keys from 38 up to 46.
- **The root**, page 286, holds three downlinks (`−∞`, `22893`, `71420`) and little else: 8,096 of its 8,192 bytes are free, so the tree can grow a long way before it needs a fourth level.

Where a [binary search tree](../binary-search-tree/) gives each node two children, a B-tree page fans out to hundreds, and that keeps the tree this shallow. Inside a page PostgreSQL [binary-searches](../binary-search/) the sorted keys (`_bt_binsrch` in [nbtsearch.c](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/access/nbtree/nbtsearch.c)).

**The lookup.** For `customer_id = 42` the search reads the root (42 is below 22893, so the first downlink), then page 3 (38 ≤ 42 < 46, so leaf 14), then leaf 14, where it finds 42's posting lists. That is three page reads, exactly what the `Bitmap Index Scan` node reports. PostgreSQL then sorted the 179 TIDs into a bitmap of heap pages and read those 175 pages in physical order (`Heap Blocks: exact=175`): 178 pages against 5,058, in 0.09 ms. A unique key is the textbook case: `WHERE id = 836` reads three pages of `orders_pkey` and one heap page, four in all.

**Built for concurrency.** PostgreSQL's B-tree implementation, `nbtree`, follows Lehman and Yao's B-link tree (ACM TODS, 1981). Every page also stores a *right-link* to its neighbour on the same level and a *high key*, the upper bound of what the page may hold. A search that reaches a page just as another backend splits it sees that its key lies above the high key and follows the right-link, so readers don't have to lock the path from the root while writers work. The same links between leaves are what range scans walk along.

**Ranges and ORDER BY.** `customer_id BETWEEN 42 AND 47` descends once to 42 in leaf 14, walks right through 43 to 46, and follows the link into leaf 15 for the rest of 46 and for 47: four index pages for 902 rows. Because the leaves are sorted, `ORDER BY customer_id LIMIT 20` ran as an `Index Scan` that stopped after 20 entries (21 pages) and sorted nothing. A bitmap gives that order up, because it visits the heap in page order: `BETWEEN 42 AND 47 ORDER BY customer_id` was planned as a bitmap scan with a `Sort` on top.

**Selectivity decides the plan.** The planner estimates how many rows match from the column statistics and prices each plan; by default a random page read costs 4.0 and a sequential one 1.0 (`random_page_cost`, `seq_page_cost`). The runs on this data, with indexes on `customer_id` and `status`:

| Query | Rows | Plan | Pages read | Time |
|---|---|---|---|---|
| `id = 836` | 1 | Index Scan on `orders_pkey` | 4 | 0.01 ms |
| `customer_id = 42`, no index | 179 | Gather → Parallel Seq Scan | 5,058 | 11 ms |
| `customer_id = 42` | 179 | Bitmap Index Scan → Bitmap Heap Scan | 3 + 175 | 0.09 ms |
| `customer_id BETWEEN 42 AND 47` | 902 | Bitmap Index Scan → Bitmap Heap Scan | 4 + 822 | 1.7 ms |
| `status = 'pending'` | 990 | Index Scan on `orders_status_idx` | 872 | 0.9 ms |
| `customer_id = 1` | 2,633 | Bitmap Index Scan → Bitmap Heap Scan | 5 + 2,080 | 2.3 ms |
| `status = 'delivered'` | 487,245 | Seq Scan | 5,058 | 60 ms |

The times come from single runs on a laptop with every page cached; the plans and page counts are what carry over. Customer 42's rows got a bitmap rather than a plain index scan because they are scattered over 175 pages (`pg_stats` puts the correlation between `customer_id` and the physical row order at −0.01), and the planner estimated that reading each of those pages once, in order, costs less: 730 against 860 for a plain index scan. Customer 1's 2,633 orders still go through the index although they touch 41% of the table's pages. When 97% of the rows match, as with `'delivered'`, the planner skips the index, since visiting nearly every page through it would cost more than one pass over the table. The `'pending'` row shows that the plan is only as good as the statistics: correlation is one number per column, 0.95 for `status`, so the planner priced a plain index scan as almost sequential, yet the 990 pending rows are spread over 868 pages.

**Every write pays for every index.** An index is a second, sorted copy of the column that each write must keep in order. A new order for customer 42 went to heap page 5,057, and its key into leaf 14 next to 42's other entries. Leaf 14 had 104 bytes free. When a leaf is full, PostgreSQL first tries to make room, by deleting dead entries and then by merging duplicates into posting lists, so the page absorbed 39 new orders for customer 42 and the 40th split it: keys 43 to 46 moved to a new page, 705, page 3 gained the separator 43, and the index grew to 706 pages. The split point falls between two different keys whenever it can, so one customer's entries stay together. Random keys split pages all over the tree: after 50,000 orders for random customers the index had 818 leaf pages instead of 700, filled to 84% instead of 90%. Ever-increasing keys such as the identity `id` always land in the rightmost leaf, which each backend remembers so that it can skip the descent.

The bill for 50,000 inserts, measured with `EXPLAIN (ANALYZE, BUFFERS, WAL)`:

| Indexes on `orders` | [WAL](../write-ahead-log/) written | WAL records per row | Pages touched |
|---|---|---|---|
| `orders_pkey` | 8.5 MB | 2 | 152,000 |
| + `orders_customer_id_idx` | 12.4 MB | 3 | 302,000 |
| + `orders_status_idx` | 15.6 MB | 4 | 453,000 |

Each extra index added a WAL record and three page visits (root, internal page, leaf) per row. The elapsed time rose as well, but it varied too much between runs on a shared laptop to quote. Updates pay too: a HOT (heap-only tuple) update needs no new index entries, but it is only possible when no indexed column changes and the row's page has room. Changing `total_thb` of the order on page 123 was a HOT update; changing its `customer_id` wasn't, although the new row version fit on the same page.

**Indexes need upkeep.** Deleted and updated rows leave entries that point at dead row versions. VACUUM removes them, and between vacuums a B-tree also deletes such entries itself when a page is about to split (simple and bottom-up index deletion). B-tree pages that become completely empty are reused, but a page with only a few live keys stays allocated, so an index that has lost most of its rows doesn't shrink until `REINDEX` rebuilds it.

## Try it

The sample data comes from [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop), a script that builds the template database `acme` on PostgreSQL 18 in about a minute.

Run it on a fresh copy of the Acme Shop sample data (PostgreSQL 18); the comments show the key lines of the output.

```sql
-- CREATE DATABASE btree_try TEMPLATE acme;   -- then connect to btree_try

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, status, created_at, total_thb FROM orders WHERE customer_id = 42;
-- Gather (actual rows=179.00)   Workers Launched: 2
--   ->  Parallel Seq Scan on orders   Filter: (customer_id = 42)
--         Rows Removed by Filter: 166607   (per process, x 3 = 499,821)
--         Buffers: shared read=5058         (hit=5058 once cached)

CREATE INDEX ON orders (customer_id);         -- orders_customer_id_idx

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, status, created_at, total_thb FROM orders WHERE customer_id = 42;
-- Bitmap Heap Scan on orders (actual rows=179.00)
--   Heap Blocks: exact=175
--   Buffers: shared hit=178 read=3          (178 on later runs: 3 index + 175 heap)
--   ->  Bitmap Index Scan on orders_customer_id_idx   Index Searches: 1

CREATE EXTENSION IF NOT EXISTS pageinspect;
SELECT root, level FROM bt_metap('orders_customer_id_idx');
-- 286 | 2                                    root page 286, three levels
SELECT live_items, free_size, btpo_prev, btpo_next
FROM bt_page_stats('orders_customer_id_idx', 14);
-- 17 | 104 | 13 | 15                         leaf 14: 104 bytes free, linked to 13 and 15
SELECT pg_relation_size('orders_customer_id_idx') / 8192 AS pages;
-- 705

CREATE INDEX ON orders (status);
EXPLAIN SELECT id FROM orders WHERE status = 'delivered';
-- Seq Scan on orders   Filter: (status = 'delivered'::text)
EXPLAIN SELECT id FROM orders WHERE status = 'pending';
-- Index Scan using orders_status_idx on orders
```

## When to use it

- **Selective columns you filter, join or sort on:** foreign keys such as `orders.customer_id`, lookup keys, timestamps you read ranges of. A B-tree serves `=`, `<`, `<=`, `>=`, `>`, `BETWEEN`, `IN`, `IS NULL` and sorted output, and `LIKE 'abc%'` too when the database uses the C locale or the index has a pattern operator class.
- **Foreign keys you query by.** PostgreSQL leaves them unindexed. The index also speeds up deleting a customer or changing its key, which otherwise scans `orders` to check for referencing rows.
- **Not for values most rows share.** `status = 'delivered'` doesn't use `orders_status_idx`. If only the rare statuses are ever queried, a partial index on them is a fraction of the size ([index types](../index-types/)).
- **Several conditions, or no table visit at all:** a [composite index](../composite-index/) serves queries on its leading columns, and a [covering index](../covering-index/) answers from the index alone. For equality only, a hash index is an option, but only the B-tree's order serves ranges and sorting (compare a [hash table](../hash-table/)).
- **Check the plan, not the intention:** run `EXPLAIN (ANALYZE, BUFFERS)` on the real query with real values; [query execution plans](../query-execution-plans/) covers reading the output.

## Trade-offs

- **Every write maintains every index.** Each one adds a WAL record and a root-to-leaf descent per inserted row (8.5 → 12.4 → 15.6 MB of WAL above), and page splits on top.
- **Space.** 5.5 MB for `orders_customer_id_idx`, 3.4 MB for `orders_status_idx` and 11 MB for the primary key, on a 40 MB table, plus the free space that splits and deletes leave behind.
- **Lost HOT updates.** Indexing a column that changes often turns cheap heap-only updates into updates of every index on the table.
- **Building blocks writes.** A plain `CREATE INDEX` blocks inserts, updates and deletes on the table until it finishes; reads carry on. `CREATE INDEX CONCURRENTLY` keeps writes flowing but scans the table twice, waits for running transactions, can't run inside a transaction block, and leaves an `INVALID` index behind if it fails, which you drop and build again.
- **An unused index costs as much as a used one.** `pg_stat_user_indexes.idx_scan` counts the searches of each index since the statistics were last reset; one that stays at 0 through a full business cycle is a candidate for `DROP INDEX`.

## Implementation notes

**Measure with buffers.** In PostgreSQL 18, `EXPLAIN ANALYZE` reports buffer counts without being asked, and index scans report `Index Searches`. `pageinspect` (`bt_metap`, `bt_page_stats`, `bt_page_items`) shows the pages themselves. Amazon RDS for PostgreSQL lists it among its extensions (version 1.13 on PostgreSQL 18); [Aurora PostgreSQL](../amazon-rds-aurora/) doesn't list it for its current versions, so there `EXPLAIN` and the statistics views are the tools.

**Find indexes nobody uses** (unique indexes stay: they enforce a constraint even if never searched):

```sql
SELECT s.indexrelid::regclass AS index, s.idx_scan,
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS size
FROM pg_stat_user_indexes s
JOIN pg_index i USING (indexrelid)
WHERE s.idx_scan = 0 AND NOT i.indisunique
ORDER BY pg_relation_size(s.indexrelid) DESC;
```

**Build on a live table with `CONCURRENTLY`:** `CREATE INDEX CONCURRENTLY orders_customer_id_idx ON orders (customer_id);` outside a transaction, then check that `\d orders` doesn't mark it `INVALID`.

**MySQL (InnoDB, 8.4) clusters the table on its primary key.** The rows live in the leaves of the primary-key B-tree; without a primary key InnoDB uses the first `UNIQUE` index whose columns are all `NOT NULL`, or else a hidden row-ID index. A secondary index stores the indexed columns plus the primary key, so `WHERE customer_id = 42` searches the secondary index first and then looks each row up in the clustered index by its primary key. PostgreSQL's TID points straight at the heap page instead, and its table has no order of its own. A long primary key therefore makes every InnoDB secondary index bigger. MySQL also requires an index on foreign-key columns and creates one when none exists, the opposite of PostgreSQL.

**SQL Server offers both layouts.** A table with a clustered index stores its rows in that index (a primary key becomes the clustered index by default), and a table without one is a heap. A nonclustered index locates its row by the clustered key, or by a pointer to the row on a heap, which is the closest match to PostgreSQL's TID. Creating a foreign key doesn't create an index there either.

**MongoDB** indexes are B-trees as well ([MongoDB](../mongodb/)), and its manual makes the same point about writes: every insert has to update each index on the collection.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Composite Index](../composite-index/) — A multi-column index serves queries that use its leading columns: put equality columns first and the range or sort column last.
- [Covering Index](../covering-index/) — Answer a query from the index alone: include the columns it selects, so the table is never read, and the scan is index-only.
- [Index Types](../index-types/) — Beyond B-trees: hash, GIN for arrays, JSON and text, GiST, BRIN for time-ordered data, and partial and expression indexes.
- [Query Execution Plans](../query-execution-plans/) — Read EXPLAIN the way the planner thinks: scans, joins, estimated against actual rows, and the statistics behind each choice.
- [Binary Search Tree](../binary-search-tree/) — Smaller keys left, larger right: O(log n) search and insert while the tree stays balanced, O(n) once it degrades into a list.
- [Hash Table](../hash-table/) — Hash each key straight to a bucket for O(1) average lookups; colliding keys share a bucket, and the table grows as it fills.
- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [MVCC](../mvcc/) — Multi-version concurrency control: an update writes a new row version, readers see a snapshot, and vacuum removes dead versions.
- [LSM Tree vs B-Tree](../lsm-tree/) — Two storage engine designs: update pages in place, or append in memory and merge sorted files, and what each costs to read and write.

## References

- [PostgreSQL 18 documentation — B-Tree Indexes (structure, deduplication, bottom-up deletion)](https://www.postgresql.org/docs/18/btree.html)
- [PostgreSQL 18 documentation — Combining Multiple Indexes (bitmap scans)](https://www.postgresql.org/docs/18/indexes-bitmap-scans.html)
- [PostgreSQL 18 documentation — Using EXPLAIN](https://www.postgresql.org/docs/18/using-explain.html)
- [PostgreSQL 18 documentation — pageinspect](https://www.postgresql.org/docs/18/pageinspect.html)
- [PostgreSQL 18 documentation — CREATE INDEX (fillfactor, CONCURRENTLY)](https://www.postgresql.org/docs/18/sql-createindex.html)
- [PostgreSQL 18 documentation — Heap-Only Tuples (HOT)](https://www.postgresql.org/docs/18/storage-hot.html)
- [PostgreSQL source — nbtree README (REL_18_STABLE)](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/access/nbtree/README)
- [Philip L. Lehman and S. Bing Yao — Efficient Locking for Concurrent Operations on B-Trees (ACM TODS, 1981)](https://dl.acm.org/doi/10.1145/319628.319663)
- [MySQL 8.4 Reference Manual — Clustered and Secondary Indexes](https://dev.mysql.com/doc/refman/8.4/en/innodb-index-types.html)
- [Microsoft Learn — Clustered and nonclustered indexes (SQL Server)](https://learn.microsoft.com/en-us/sql/relational-databases/indexes/clustered-and-nonclustered-indexes-described)
- [Markus Winand — Use The Index, Luke: the B-tree](https://use-the-index-luke.com/sql/anatomy/the-tree)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
