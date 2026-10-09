
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗃️ Database Internals & Performance](../../README.md#database-internals--performance)

# LSM Tree vs B-Tree

> Two storage engine designs: update pages in place, or append in memory and merge sorted files, and what each costs to read and write.

<p align="center"><img src="diagram.svg" alt="Animated diagram: LSM Tree vs B-Tree" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/lsm-tree.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · B-tree: pages in place** | Acme keeps `order_events` in PostgreSQL 18.6, here in a copy `ev` with a B-tree on `order_id`. The next 50,000 events arrive almost in key order, because an order's events come within a day, so they change **172 index pages** at the right edge (166 of them new, from leaf splits), with 13 full-page images and 11.5 MB of WAL. 50,000 review events for random orders change **all 4,927 leaves**: each is an 8 kB page to write back at the next checkpoint, and its first change after the checkpoint logged a full-page image, 4,932 of them in 36.6 MB of WAL, **1,631 bytes per event** instead of 341. |
| **2 · LSM: log, sort, flush** | An LSM tree never changes a page in place. In a small Python model fed the same 50,000 reviews, each event is appended to a write-ahead log (2.4 MB, 48 bytes per event) and put into a sorted in-memory **memtable**; every 15,000 events the memtable is written out as an immutable sorted file in level 0, three files of 0.62 MB, each written once, front to back. Older data sits below in L1 to L3, each level one sorted run cut into files by key range. |
| **3 · Reads and compaction** | Reading order 181,236 checks the memtable, the L0 files newest first, then the one file per level whose key range covers it: **bloom filters** (10 bits per key) rule out L0 #227 and #226, key ranges rule out L1 and L2, and only #225 (the review) and L3 #86 (placed, paid, shipped) are read; over 4,000 random orders that is 1.1 files per lookup. Deleting the events of 9,755 cancelled orders writes 30,199 **tombstones**. When L0 holds 4 files, **compaction** merges them with the L1 files they overlap (4.3 MB written); the tombstones travel down with the data and can only be dropped where no older copy of their key can lie below, in practice at the last level. |
| **4 · Write, read, space** | Per 32-byte event the PostgreSQL run wrote 341 bytes in key order and 1,631 for random keys; the model's leveled LSM wrote 139 and 369 bytes, size-tiered 194 and 192, all as long sequential writes. Reads go the other way: the B-tree finds an order on one root-to-leaf path (3 index and 3 heap pages), while the LSM checks 4 bloom filters and reads 2 files, and a range scan has to merge every level. The **RUM conjecture** (EDBT 2016) says no design minimises read, update and memory overhead at once: PostgreSQL, InnoDB and SQL Server use B-trees, while RocksDB, MyRocks, Cassandra, ScyllaDB and LevelDB use LSM trees and pay in background compaction, which stalls writes when it falls behind. |
<!-- END GENERATED: header -->

## The problem

Acme Shop writes an event for every step of an order (`placed`, `paid`, `shipped`) to `order_events`: 1.5 million rows so far, appended in time order, and the support tool reads them back by `order_id`. In [PostgreSQL](../postgresql/) that read needs a [B-tree index](../b-tree-index/) on `order_id`, so every new event also has to go into the index. A B-tree keeps its entries sorted on 8 kB pages and changes those pages in place, and what an insert costs depends on where its key lands.

The run uses PostgreSQL 18.6 and a table `ev` built from the sample data: the primary key on `id`, an index `ev_order_id_idx` on `order_id`, and the first 1,450,000 events inserted in time order. After a `CHECKPOINT` the table takes two batches of 50,000 rows, and at the end the index has 4,946 pages in three levels: root page 412, 17 internal pages and 4,927 leaves, plus a metapage.

| 50,000 inserts after a checkpoint | the next events, in time order | reviews for random orders |
|---|---|---|
| index pages changed | 172 (166 of them new, from splits) | 4,927, every leaf |
| full-page images in the WAL | 13 | 4,932 |
| WAL written | 11.5 MB | 36.6 MB |
| pages changed in all (heap and both indexes) | 680 | 5,485 |
| bytes written per event (WAL plus 8 kB per changed page) | 341 | 1,631 |

An order's events arrive within a day of each other, so `order_id` rises almost as steadily as time does, and the first batch only touches the right edge of the index: the newest leaf for `placed` and `paid`, and a leaf a day's worth of orders further back for `shipped`. The 68th event, a `shipped` for order 482,834, filled leaf 4,771, which split and moved its upper half to the new page 4,780. The second batch stands in for keys that don't follow arrival time, such as random UUIDs, the id of a long-lived customer or product, or late events: 50,000 reviews for orders picked at random. Their keys are spread over the whole index, about ten to a leaf, so together they changed all 4,927 leaves. Each changed page goes back to disk as a whole 8 kB page at the next checkpoint, and because `full_page_writes` is on (the default), the first change to a page after a checkpoint also copies the page into the WAL: 4,932 page images, which made the WAL 3.2 times bigger for the same number of rows. Once the index no longer fits in memory, each of those inserts also has to read its leaf from disk first.

This is the problem the LSM tree was invented for. Patrick O'Neil, Edward Cheng, Dieter Gawlick and Elizabeth O'Neil described it in 1996 with a fast-growing history table indexed by account id, where keeping a B-tree current in real time would roughly double the I/O of every transaction.

## How it works

**A B-tree changes pages in place.** To insert, PostgreSQL descends from the root to the leaf that covers the key, adds the entry and logs the change in the [write-ahead log](../write-ahead-log/) first; the page stays dirty in shared buffers until a checkpoint or the background writer writes it back. A full leaf splits. When it is the rightmost leaf, the old page is left 90% full (the B-tree `fillfactor`), so keys that only grow pack tightly; elsewhere the split is usually about half and half. This index ended at 4,946 pages with its leaves 65% full; built from scratch over the same rows it takes 3,017. A read is a single path: for order 181,236, root page 412, internal page 1842 and leaf 1797, then the three heap pages that hold its four rows, six pages in all.

**An LSM tree never changes a page in place.** It collects writes in memory, writes them out as whole sorted files and merges those files later in the background. No LSM engine runs on this machine, so this page uses a small Python model (simplified: no blocks, compression, caching or concurrency) and drives it with the same events. Each event is a 32-byte key-value pair: key `(order_id, id)`, value `(kind, happened_at)`. The model's sizes are about 1/100 of RocksDB's defaults so that levels form on 62 MB of data:

| | the model | RocksDB default |
|---|---|---|
| memtable (`write_buffer_size`) | 600 kB, 15,000 events | 64 MiB |
| L0 files that start a compaction (`level0_file_num_compaction_trigger`) | 4 | 4 |
| L1 target size (`max_bytes_for_level_base`) | 2.4 MB | 256 MiB |
| growth per level (`max_bytes_for_level_multiplier`) | ×10 | ×10 |
| file size (`target_file_size_base`) | 0.6 MB | 64 MiB |
| bloom filter | 10 bits per key, 7 probes | none unless configured; the wiki's example uses 10 bits per key |

- **Write path.** A write is appended to the write-ahead log (48 bytes per event in the model) and put into the memtable, a sorted structure in memory (a skip list by default in RocksDB; Cassandra calls its log the commit log). When the memtable is full, it is flushed: written front to back as one immutable, sorted file, an SSTable, in level 0. The 50,000 reviews appended 2.4 MB to the WAL and became three files of 0.62 MB, with 5,000 still in the memtable. Nothing on disk was rewritten.
- **Levels.** Level 0 files overlap each other, because each holds whatever arrived while one memtable filled up: each of the three review files spans almost every order, from below 120 to above 499,960. Every level below is one sorted run cut into files with non-overlapping key ranges, and each level may be ten times the size of the one above. Data that arrives in key order sinks down in key order: after the 1.5 million events, L3 held orders 1 to 290,000, L2 290,001 to 485,000 and L1 485,001 to 500,000.
- **Read path.** A lookup checks the memtable, then every L0 file from newest to oldest, then in each level the one file whose key range covers the key, found by a [binary search](../binary-search/) over the files' smallest and largest keys. Each file has a bloom filter, a bit array in which every key sets a few bits chosen by [hash functions](../hash-table/); it answers "definitely not here" or "maybe". The model filters on `order_id`, like a prefix filter in RocksDB or Cassandra's filter on the partition key. For order 181,236 the filters ruled out L0 files #227 and #226, the key ranges ruled out L1 and L2, and only L0 #225 (the review) and L3 #86 (placed, paid, shipped) were read. Over 4,000 random orders a lookup made 4 filter checks and read 1.1 files; 0.024 checks per lookup were false positives, 0.8% of the files that didn't hold the order, as 10 bits per key predicts. A range scan can't use the filters: it has to merge a cursor on every L0 file and every level.
- **Compaction.** When L0 reaches 4 files, they are merged with the L1 files they overlap, a [k-way merge](../merge-sort/) of sorted runs; when a level outgrows its target, one of its files is merged into the level below. In the run, the next flush (the deletes described below) brought L0 to 4 files, and compaction read those 4 and the 3 L1 files and wrote 7 new L1 files (4.3 MB); L1 was then too big and pushed 8.5 MB down into L2. A file that overlaps nothing in the level below simply moves down without being rewritten, which RocksDB calls a trivial move, and that is why loading the events in time order was cheap.
- **Deletes are writes too.** Deleting the events of the 9,755 cancelled orders wrote 30,199 tombstones, small markers that hide older copies of a key from reads and merges. A tombstone can only be dropped once no older copy of its key can be underneath, which in practice means when compaction carries it into the last level: the L0→L1 compaction above kept all 16,667 it saw. A full compaction, like RocksDB's `CompactRange` or `nodetool compact` in Cassandra, dropped all 30,199 tombstones and the 30,199 events they deleted, rewriting 61.4 MB and needing 124.8 MB of disk at its peak. Cassandra also keeps each tombstone for at least `gc_grace_seconds` (ten days by default), so that a replica that missed the delete can't bring the data back.

**Leveled or size-tiered.** Leveled compaction, LevelDB's design and RocksDB's default, keeps one sorted run per level and merges small pieces often. Size-tiered compaction (Cassandra's default strategy, and RocksDB's Universal Compaction) waits until there are several runs of similar size, 4 by default in Cassandra, and merges them into one larger run: data is rewritten fewer times, but a read may have to check more runs, and a large merge needs room for a second copy. Cassandra 5.0 added the Unified Compaction Strategy, which its documentation recommends for new workloads. The model ran both on the same streams:

| | leveled | size-tiered |
|---|---|---|
| bytes written per event, the 1.5 million events in time order | 139 (4.3×) | 194 (6.0×) |
| bytes written per event, the same events in random key order | 369 (11.5×) | 192 (6.0×) |
| files read per lookup, 4,000 random orders after the reviews | 1.1 | 1.1 |
| disk ÷ a freshly compacted copy, at the end | 1.03× | 1.03× |
| disk ÷ a freshly compacted copy, at the peak | 1.17× | 1.26× |

The ×-figures divide by the 32 bytes of each event, the way RocksDB's tuning guide defines write amplification: bytes written to storage over bytes written to the database. With keys in time order, leveled compaction mostly moved files instead of rewriting them, so there it wrote less than size-tiered.

## Try it

The sample data comes from [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop), a script that builds the template database `acme` on PostgreSQL 18 in about a minute.

Run it on a fresh copy of the Acme Shop sample data (PostgreSQL 18); the comments show the key lines of the output. `CHECKPOINT` needs a superuser or the `pg_checkpoint` role.

```sql
-- CREATE DATABASE lsm_try TEMPLATE acme;   -- then connect to lsm_try
CREATE EXTENSION IF NOT EXISTS pageinspect;
CREATE EXTENSION IF NOT EXISTS pgstattuple;

-- order_events in a table with the index the support tool reads by
CREATE TABLE ev (id bigint PRIMARY KEY, order_id bigint NOT NULL,
                 kind text NOT NULL, happened_at timestamptz NOT NULL);
CREATE INDEX ev_order_id_idx ON ev (order_id);
INSERT INTO ev SELECT * FROM order_events WHERE id <= 1450000 ORDER BY id;
VACUUM ANALYZE ev;

-- pages of a relation whose last change is newer than the mark
CREATE TABLE mark (lsn pg_lsn);
CREATE FUNCTION pages_changed(rel regclass) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM generate_series(0, pg_relation_size(rel) / 8192 - 1) AS b
  WHERE (page_header(get_raw_page(rel::text, b::int))).lsn > (SELECT lsn FROM mark) $$;

-- 1. the next 50,000 events, in time order
CHECKPOINT;
INSERT INTO mark SELECT pg_current_wal_lsn();
EXPLAIN (ANALYZE, BUFFERS, WAL, COSTS OFF, TIMING OFF)
INSERT INTO ev SELECT * FROM order_events WHERE id > 1450000 ORDER BY id;
-- WAL: records=151316 fpi=13 bytes=11475847
SELECT pages_changed('ev_order_id_idx');
-- 172

-- 2. 50,000 reviews for orders picked at random
SELECT setseed(0.42);
CREATE TABLE late_events AS
SELECT 1500000 + g AS id, (1 + floor(random() * 500000))::bigint AS order_id,
       'reviewed'::text AS kind,
       timestamptz '2026-10-03 18:00:00+00' + g * interval '1 second' AS happened_at
FROM generate_series(1, 50000) AS g;
VACUUM late_events;   -- sets hint bits now, so the INSERT below logs only its own changes
CHECKPOINT;
UPDATE mark SET lsn = pg_current_wal_lsn();
EXPLAIN (ANALYZE, BUFFERS, WAL, COSTS OFF, TIMING OFF)
INSERT INTO ev SELECT * FROM late_events ORDER BY id;
-- WAL: records=150138 fpi=4932 bytes=36632086
SELECT pages_changed('ev_order_id_idx');
-- 4927                                  every leaf

-- 3. what a read costs, and how full the leaves are now
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) SELECT * FROM ev WHERE order_id = 181236;
-- Index Scan using ev_order_id_idx on ev (actual rows=4.00 loops=1)
--   Buffers: shared hit=6               3 index pages + 3 heap pages
SELECT leaf_pages, avg_leaf_density FROM pgstatindex('ev_order_id_idx');
-- 4927 | 65.01
```

`EXPLAIN` may also print `buffers full=…`, how often the WAL buffers filled up; that number changes from run to run. The page counts and the WAL records, images and bytes came out the same in every run.

## When to use it

- **A B-tree engine** (PostgreSQL, MySQL with InnoDB, SQL Server) when reads matter at least as much as writes: point lookups and range scans on one root-to-leaf path, ordered leaves for `ORDER BY`, rows updated in place, many secondary indexes and transactions over them. It handles high insert rates well when keys arrive roughly in order, like identity columns and timestamps, and when the hot part of each index stays in memory.
- **An LSM engine** (RocksDB and the databases built on it such as MyRocks, Cassandra, ScyllaDB) when writes dominate and keys arrive in any order: event, log and time-series ingestion, metrics, messaging state, write-heavy key-value stores. For small writes to random keys it usually writes fewer bytes, all of them sequentially; for MyRocks on SSDs, Percona lists less storage space and longer flash endurance than other engines.
- **Before switching engines, fix the keys and the indexes.** In PostgreSQL the random keys are what hurt. PostgreSQL 18's `uuidv7()` makes UUIDs that sort by creation time, so new entries go to the right edge, unlike the random version 4 from `gen_random_uuid()`. Drop indexes nobody reads, insert in batches, use a BRIN index for time-ordered columns ([index types](../index-types/)), and set `wal_compression` to shrink full-page images.
- **For "all events of one key"**, a wide-column store keeps a key's rows together: in [Cassandra](../cassandra/) they share a partition. "NoSQL" doesn't mean LSM, though: [DynamoDB](../amazon-dynamodb/) stores items in B-trees (see the notes below).

## Trade-offs

- **Write amplification moves; it doesn't go away.** The B-tree pays a whole page, and a full-page image, for each scattered change (341 bytes per event in key order, 1,631 for random keys). The LSM tree rewrites each byte once per level it passes through (139 and 369 bytes in the leveled model), but in long sequential writes and in the background.
- **Reads cost more in an LSM tree.** A B-tree point lookup is one path, and a range scan follows linked leaves. An LSM lookup checks the memtable, every L0 file and every level; bloom filters turn most of those checks into a few bit tests in memory for point lookups, but do nothing for range scans, and each false positive costs a read.
- **Space.** B-tree pages carry free space after splits (65% full here, 1.64× a fresh build). A leveled LSM stays close to its live data size, 1.03× here; size-tiered compaction needs headroom for large merges, and a full compaction needs room for a second copy of everything (124.8 MB for 61.4 MB in the model).
- **Compaction competes with your queries.** It reads and rewrites data in the background; if it falls behind, L0 files pile up and every read checks more of them. RocksDB then slows writes at 20 L0 files and stops them at 36 (`level0_slowdown_writes_trigger`, `level0_stop_writes_trigger`), and also when the bytes waiting for compaction pass 64 GiB and 256 GiB.
- **Deletes cost twice.** A tombstone is written like any other entry, and it stays, taking space and slowing the reads that have to skip it, until compaction carries it to the last level (in Cassandra, for at least `gc_grace_seconds` as well). Workloads that delete or overwrite heavily need compaction settings that clear them.
- **The RUM conjecture.** Manos Athanassoulis and co-authors (EDBT 2016) argue that no access method can be optimal for read cost, update cost and memory (space) overhead at once: bounding two of them puts a floor under the third. B-trees spend space and update cost to keep reads short; LSM trees spend read cost to make updates cheap; and every LSM tuning knob, from the level multiplier to tiering, moves along the same triangle.

## Implementation notes

**Measuring writes in PostgreSQL 18.** `EXPLAIN (ANALYZE, WAL)` reports the records, full-page images and bytes of WAL a statement generated, and how often the WAL buffers filled. `pg_stat_wal` keeps the cluster-wide totals; version 18 removed its write and sync columns, moved WAL timing to `pg_stat_io`, and gave `pg_stat_io` WAL rows and byte counts (`read_bytes`, `write_bytes`, `extend_bytes`). On a shared server, `pg_stat_get_backend_io()` and `pg_stat_get_backend_wal()` give the numbers for one backend. To count the pages a statement changed, compare each page's LSN with a mark taken before it (`page_header()` from pageinspect), as in Try it. PostgreSQL 18 also enables data checksums in new clusters by default, and with checksums on, the first hint-bit update of a page after a checkpoint is logged as a full-page image as well: that is why Try it vacuums `late_events` before its checkpoint.

**MySQL (InnoDB, 8.4)** stores each table as a B-tree on its primary key, with 16 KB pages, and every secondary index is another B-tree. Its change buffer was InnoDB's answer to random secondary-index inserts: it keeps changes to secondary index pages that aren't in the buffer pool and merges them in when the page is next read, a small LSM-like buffer inside a B-tree engine. In 8.4 `innodb_change_buffering` defaults to `none`. **MyRocks** replaces InnoDB with RocksDB as the storage engine and ships in Percona Server for MySQL.

**SQL Server** stores its rowstore indexes, clustered and nonclustered, as B+ trees updated in place; a table without a clustered index is a heap, as in PostgreSQL.

**Amazon DynamoDB** is often grouped with Cassandra, but the 2022 USENIX ATC paper on its design says each storage replica holds a write-ahead log and a B-tree of the items, and a write is acknowledged once a quorum of replicas has its log record.

**Cassandra and ScyllaDB** are LSM stores: commit log, memtables and SSTables on every node, with compaction strategies chosen per table (size-tiered, leveled with 160 MB SSTables, time-window, and in Cassandra 5.0 unified). ScyllaDB adds incremental compaction, which splits large SSTables into runs of smaller files so that a size-tiered merge doesn't need twice the space.

**LevelDB and RocksDB.** LevelDB, by Sanjay Ghemawat and Jeff Dean at Google, introduced the leveled layout: level 0 is merged into level 1 once it holds more than four files, level *L* may hold 10^*L* MB, and files are about 2 MB. RocksDB, which Meta built on LevelDB, keeps that design as its default (`level_compaction_dynamic_level_bytes` is on, so it sizes the levels from the bottom up) and adds Universal Compaction, many memtable types and Ribbon filters, which reach the false-positive rate of a 10-bit Bloom filter with about 7 bits per key.

**The model** is a few hundred lines of Python that only does what this page describes: a memtable kept as a dictionary and sorted at flush, files as sorted lists with their smallest and largest key, a bloom filter per file, leveled compaction that picks files round-robin, like RocksDB's `kRoundRobin` option (its default, `kMinOverlappingRatio`, first picks the file whose overlap with the next level is smallest relative to its own size), and moves non-overlapping files down, size-tiered compaction with Cassandra's bucket rules, and per-key tombstones. Its sizes are scaled down, so its absolute numbers aren't RocksDB's or Cassandra's; the comparisons between its runs, and with the PostgreSQL run, are what carry over.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [B-Tree Index](../b-tree-index/) — How a B-tree index finds a row in three or four page reads, serves ranges in order, and what every insert costs to keep it sorted.
- [Write-Ahead Log](../write-ahead-log/) — Log each change before applying it, so a commit survives a crash, recovery replays the log, and replicas and backups follow it.
- [Apache Cassandra](../cassandra/) — A wide-column database built for heavy writes across data centres: a token ring, tunable consistency and LSM storage.
- [Merge Sort](../merge-sort/) — Split the list until single items remain, then merge sorted halves back together: O(n log n) every time, and stable.
- [Hash Table](../hash-table/) — Hash each key straight to a bucket for O(1) average lookups; colliding keys share a bucket, and the table grows as it fills.
- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [Amazon DynamoDB](../amazon-dynamodb/) — A serverless key-value and document database: the partition key spreads items across partitions for single-digit-millisecond reads.
- [Row vs Column Storage](../row-vs-column-storage/) — Store rows together for transactions or columns together for analytics, and why a column store scans and compresses so much faster.

## References

- [Patrick O'Neil, Edward Cheng, Dieter Gawlick and Elizabeth O'Neil — The Log-Structured Merge-Tree (LSM-Tree) (Acta Informatica, 1996)](https://link.springer.com/article/10.1007/s002360050048)
- [Manos Athanassoulis et al. — Designing Access Methods: The RUM Conjecture (EDBT 2016)](https://openproceedings.org/2016/conf/edbt/paper-12.pdf)
- [RocksDB wiki — Leveled Compaction](https://github.com/facebook/rocksdb/wiki/Leveled-Compaction)
- [RocksDB wiki — Universal Compaction (size-tiered)](https://github.com/facebook/rocksdb/wiki/Universal-Compaction)
- [RocksDB wiki — RocksDB Tuning Guide (write, read and space amplification)](https://github.com/facebook/rocksdb/wiki/RocksDB-Tuning-Guide)
- [RocksDB wiki — Write Stalls](https://github.com/facebook/rocksdb/wiki/Write-Stalls)
- [RocksDB wiki — RocksDB Bloom Filter](https://github.com/facebook/rocksdb/wiki/RocksDB-Bloom-Filter)
- [LevelDB — Implementation notes (files, levels and compactions)](https://github.com/google/leveldb/blob/main/doc/impl.md)
- [Apache Cassandra 5.0 documentation — Storage engine](https://cassandra.apache.org/doc/latest/cassandra/architecture/storage-engine.html)
- [Apache Cassandra 5.0 documentation — Compaction overview](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/compaction/overview.html)
- [PostgreSQL 18 documentation — Write Ahead Log settings (full_page_writes, wal_compression)](https://www.postgresql.org/docs/18/runtime-config-wal.html)
- [PostgreSQL 18 documentation — The Cumulative Statistics System (pg_stat_wal, pg_stat_io)](https://www.postgresql.org/docs/18/monitoring-stats.html)
- [MySQL 8.4 Reference Manual — Change Buffer](https://dev.mysql.com/doc/refman/8.4/en/innodb-change-buffer.html)
- [Mostafa Elhemali et al. — Amazon DynamoDB: A Scalable, Predictably Performant, and Fully Managed NoSQL Database Service (USENIX ATC 2022)](https://www.usenix.org/conference/atc22/presentation/elhemali)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
