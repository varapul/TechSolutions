<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧱 System Components](../../README.md#system-components)

# Apache Cassandra

> A wide-column database built for heavy writes across data centres: a token ring, tunable consistency and LSM storage.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Apache Cassandra" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/cassandra.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Acme Shop's tracking service writes a status event for every parcel (picked up, sorted, out for delivery…), millions a day, in Bangkok and in Singapore, and customers read the latest events of one shipment. The cluster has six nodes in two data centres, **dc-bkk** and **dc-sgp**; each data centre serves its own clients and keeps 3 copies of every partition, and every node takes reads and writes, so there is no primary. The table `shipment_events` keeps one partition per shipment, its events sorted newest first. |
| **2 · Partition and replicate** | The write reaches **bkk-1**, which becomes its coordinator. The partition key `S-77` hashes (Murmur3) to the token 4480090637218407206, which falls in **bkk-2**'s range; walking the ring clockwise gives the replicas bkk-2, bkk-3 and bkk-1 (with 3 nodes and 3 replicas, every node of a data centre holds every partition). A write always goes to every replica: bkk-1 sends it to the three in dc-bkk and to one node in dc-sgp, which passes it on. With `LOCAL_QUORUM` the client is answered once 2 of the 3 replicas in dc-bkk have it, and dc-sgp catches up without the client waiting. |
| **3 · Inside a node** | Inside **bkk-2** the write is appended to the commit log and added to the memtable, then acknowledged. The read of the latest 10 events of S-77 merges the memtable with the SSTables whose bloom filter says the partition may be there (SSTable 2 is skipped); each holds S-77's rows newest first, so every file is one short slice, and the tombstone that a `DELETE` wrote hides the 22:10 row. A full memtable is flushed to a new, immutable SSTable, and compaction merges SSTables in the background, keeping tombstones until `gc_grace_seconds` (10 days by default) has passed. |
| **4 · Failure and the limits** | **bkk-3** is down. The `delivered` event still reaches 2 of the 3 replicas in dc-bkk, so `LOCAL_QUORUM` succeeds; bkk-1 keeps a hint and replays it when bkk-3 is back (hints are written only during the first `max_hint_window` of an outage, 3 hours by default), and regular repair fixes anything older. The limits: you design one table per query (every query names the partition key, there are no joins, and `ALLOW FILTERING` means a scan), very large partitions and piles of tombstones slow reads, lightweight transactions cost extra round trips, and a cluster is work to run. Cassandra 5.0 (September 2024) added Storage-Attached Indexes, vector search, trie-based memtables and SSTables and the Unified Compaction Strategy; general-purpose transactions (Accord) are in 6.0, which is still an alpha release in October 2026. |
<!-- END GENERATED: header -->

## The problem

Acme Shop records an event every time a parcel moves: picked up, sorted, in transit, out for delivery, delivered. That is millions of small writes a day, arriving in Bangkok and in Singapore, and customers keep asking the same question: what are the latest events of my shipment? A single relational primary would send every write to one machine in one region. Singapore would pay a cross-region round trip for each event, the primary's disk and CPU would cap the write rate, and a failover would stop writes while a replica is promoted.

Apache Cassandra spreads the data over a ring of equal nodes in several data centres. Every node accepts reads and writes, every partition is copied to a set number of nodes in each data centre, and each request says how many of those copies must answer. On each node a write is appended to a log and to an in-memory table, so writing costs sequential I/O instead of updates in place. The price is a data model built around queries you know in advance. Avinash Lakshman and Prashant Malik built Cassandra at Facebook for Inbox Search, combining Dynamo's partitioning and replication with Bigtable's storage model; it is now an Apache Software Foundation project under the Apache License 2.0.

## How it works

### Tables, partitions and CQL

Data lives in **tables**, grouped into **keyspaces**, and the keyspace decides the replication. A table's primary key has two parts. The **partition key** (here `shipment_id`) decides where a row lives: all rows that share it form one **partition**, stored together on the same replicas. The **clustering columns** (here `event_time`) sort the rows inside the partition, ascending unless `CLUSTERING ORDER BY` says otherwise, and that order can't be changed once the table exists. This is what makes Cassandra a wide-column store: a partition holds many rows, and each row can carry its own set of columns.

You talk to Cassandra in **CQL**, which reads like SQL. The keyspace and table of the diagram:

```sql
CREATE KEYSPACE tracking WITH replication =
  {'class': 'NetworkTopologyStrategy', 'dc-bkk': 3, 'dc-sgp': 3};

CREATE TABLE tracking.shipment_events (
  shipment_id text,
  event_time  timestamp,
  status      text,
  PRIMARY KEY ((shipment_id), event_time)
) WITH CLUSTERING ORDER BY (event_time DESC);

-- cqlsh command; drivers set the consistency level per session or per statement
CONSISTENCY LOCAL_QUORUM;

INSERT INTO tracking.shipment_events (shipment_id, event_time, status)
  VALUES ('S-77', '2026-10-07 09:12+0700', 'out for delivery');

-- the newest 10 events: one slice of one partition
SELECT event_time, status FROM tracking.shipment_events
  WHERE shipment_id = 'S-77' LIMIT 10;

-- returns 4480090637218407206, the token of the diagram
SELECT token(shipment_id) FROM tracking.shipment_events
  WHERE shipment_id = 'S-77' LIMIT 1;
```

Every value carries a write timestamp, and when two writes change the same column of the same row, the later timestamp wins (**last write wins**). Cassandra's correctness therefore depends on clocks: run NTP on clients and nodes. The changes of one statement within one partition are applied atomically and in isolation, but there are no joins and no transactions across partitions; the only conditional write is the single-partition compare-and-set of a lightweight transaction (below).

### Query-first data modelling

A query should read one partition, so you design tables from the queries, not from the entities. Each query the application runs gets a table whose partition key is the value the query filters on. There are no joins: the data-modelling guide prefers writing a second, denormalized table over joining in the client. If Acme Shop's hubs also need every parcel that passed through one hub on one day, that is a second table, partitioned by hub and day, which the tracking service writes alongside `shipment_events`. In this catalog's terms each such table is a [materialized view](../materialized-view/) that the application maintains.

Keep partitions bounded and spread out. The hard limit is 2 billion cells per partition, and the guide warns that performance suffers long before it; when a partition could grow forever (all of a hub's events), add a time bucket to the partition key. A shipment's events are naturally few, which is why `shipment_id` alone is enough here. A partition key with many distinct values also spreads the load evenly over the ring.

Secondary indexes exist: the original ones and, since 5.0, **Storage-Attached Indexes (SAI)**, which index each memtable and SSTable as it is written. Both are local to each node, so a query that doesn't name the partition key still has to ask nodes across the cluster. `ALLOW FILTERING` goes further: it lets a query scan the whole table and filter as it goes, which the CQL documentation calls unpredictable. Treat it as a warning sign in application code.

### The token ring and virtual nodes

The **partitioner** turns the partition key into a **token**. The default, `Murmur3Partitioner`, hashes the key into a 64-bit number from −2⁶³ to 2⁶³−1, and that range is treated as a ring. Each node takes positions on the ring and owns the range that ends at each of them: a key belongs to the first node clockwise from its token. For the text key `S-77` the token is 4480090637218407206; in the diagram it falls in bkk-2's range. Choose the partitioner once, because changing it means reloading all the data.

Since Cassandra 4.0 a node takes 16 positions by default (`num_tokens: 16`, down from 256), called **virtual nodes**, and with `allocate_tokens_for_local_replication_factor: 3` the allocation algorithm places them so that the load comes out even for 3 replicas. Many small ranges mean that a new node takes a little data from many others and that a failed node's traffic spreads over many survivors. The documentation notes the cost: each extra token adds neighbours on the ring, so more combinations of failures can make part of the data unavailable, and cluster-wide maintenance gets slower. The diagram draws each node's ranges as one.

### Replication: strategies, snitches and racks

Each keyspace has a **replication strategy**. `NetworkTopologyStrategy` takes a replication factor per data centre, and the documentation recommends it for every production cluster, even one with a single data centre, because adding a data centre later is then a change to the map. It walks the ring clockwise from the token and picks distinct nodes in each data centre, on different racks where it can. `SimpleStrategy` ignores data centres and racks and is meant for test clusters; a 5.0 guardrail can forbid it. Nodes learn each other's data centre and rack from the **snitch**: `GossipingPropertyFileSnitch`, the recommended one for production, reads them from each node's `cassandra-rackdc.properties` and spreads them through gossip. In a cloud, many operators treat each availability zone as a rack.

In the diagram each data centre has 3 nodes and 3 replicas, so every node holds every partition and the ring only decides the order of the replicas. With 12 nodes in dc-bkk, the token would pick 3 of the 12.

### Consistency levels and R + W > RF

Every read and write carries a **consistency level**: how many replicas must answer before the coordinator, the node that received the request, replies.

| Level | Waits for | In this cluster (3 replicas per data centre) |
|---|---|---|
| `ONE`, `TWO`, `THREE` | that many replicas, in any data centre | the fastest replicas, wherever they are |
| `LOCAL_ONE` | one replica in the coordinator's data centre | 1 local replica; reads never go to the other data centre |
| `QUORUM` | a majority of all replicas | 4 of 6, so at least one in the other data centre |
| `LOCAL_QUORUM` | a majority in the coordinator's data centre | 2 of 3, local |
| `EACH_QUORUM` | a majority in every data centre | 2 of 3 in dc-bkk and 2 of 3 in dc-sgp |
| `ALL` | every replica | all 6: one slow node fails the request |
| `ANY` | one replica, or a hint stored by the coordinator (writes only) | survives every replica being down, but reads may miss the write |

`SERIAL` and `LOCAL_SERIAL` set the consistency of the Paxos round of a lightweight transaction.

A write is always sent to every replica; the level only sets how many acknowledgements the coordinator waits for. A read asks only as many replicas as the level needs: one returns the data and the others a digest (a hash of it). If they disagree, the coordinator writes the newest version back to the stale replicas before it answers (blocking read repair, the default `read_repair = 'BLOCKING'`).

Choose levels so that the replicas written and the replicas read overlap: **R + W > RF**. In one data centre with 3 replicas, writing and reading at `QUORUM` gives 2 + 2 > 3, so every read includes at least one replica that has the latest acknowledged write. Across data centres, `LOCAL_QUORUM` for both gives the same guarantee within one data centre: a customer in Bangkok reads what the Bangkok tracking service wrote. A reader in Singapore sees it once the copy arrives, usually soon, but nothing waits for that, and if both data centres write the same column at the same time, the later timestamp wins.

### The write path

On each replica, a write takes two steps before it is acknowledged:

1. It is appended to the **commit log**, one sequential log on disk shared by all tables, in segments of 32 MiB by default. With the default `commitlog_sync: periodic`, the write is acknowledged at once and the log is synced to disk every `commitlog_sync_period` (10 seconds by default), so a node that crashes can lose up to that much of its newest writes, which the other replicas still hold. `batch` mode waits for the sync instead.
2. It is added to the table's **memtable**, an in-memory structure sorted by partition and clustering key.

When memtables use too much memory, or the commit log needs room, a memtable is **flushed**: written out in sorted order as a new **SSTable** (sorted string table), a set of immutable files that holds the data, a partition index, a bloom filter of the partition keys, statistics and more. The commit-log segments it covered can then be recycled. Nothing on disk is ever updated in place; an update or a delete is just a newer entry. This design is a log-structured merge tree, and it is why writes are cheap and reads do a little more work.

### The read path

To answer `SELECT … WHERE shipment_id = 'S-77' LIMIT 10`, a replica looks in the memtable and in every SSTable that may hold the partition. Each SSTable's **bloom filter** answers "definitely not here" or "maybe here", so most files without S-77 are skipped without reading them; the false-positive rate is set per table with `bloom_filter_fp_chance`. In the remaining files the partition index finds where S-77 starts. Because every file stores the partition's rows in clustering order, newest first here, the replica reads one short slice from each file and merges them, keeping the newest version of each cell and dropping whatever a tombstone covers. The more SSTables a read has to touch, the slower it gets, and compaction is what keeps that number down.

Cassandra 5.0 adds a trie-indexed SSTable format (BTI) that drops the index summary, needs no key cache and finds rows quickly even in partitions with millions of rows, and a trie-based memtable that uses less memory and creates less garbage for the JVM to collect. Both are opt-in in 5.0's `cassandra.yaml` (`sstable: selected_format: bti` and the `trie` memtable configuration) and switched on in `cassandra_latest.yaml`, a second configuration file the release ships for trying the newest defaults.

### Compaction

**Compaction** merges SSTables in the background: it reads several, keeps the newest version of each cell, drops the data that tombstones cover and the tombstones that are old enough, writes new SSTables and deletes the old ones. The strategy is set per table:

- **SizeTieredCompactionStrategy (STCS)** merges SSTables of similar size. It is the default in `cassandra.yaml`, a fallback when nothing else fits better.
- **LeveledCompactionStrategy (LCS)** suits read-heavy tables and tables with many updates and deletes, and costs more compaction I/O.
- **TimeWindowCompactionStrategy (TWCS)** groups SSTables into time windows and drops a whole SSTable once all of its data has expired. It is designed for time series written with a TTL, such as `shipment_events`.
- **UnifiedCompactionStrategy (UCS)**, new in 5.0, can be tuned to behave like the tiered or the leveled strategy (`scaling_parameters`, such as `T4` or `L10`) and compacts with more parallelism. The 5.0 documentation recommends it for most workloads, and it is the default in `cassandra_latest.yaml`.

DateTieredCompactionStrategy was removed in 5.0; tables that still use it must move to TWCS before the upgrade.

### Tombstones and gc_grace_seconds

A `DELETE`, or a TTL running out, doesn't remove data: it leaves a **tombstone**, a marker with a timestamp that hides older data during reads and merges. A tombstone is kept for the table's `gc_grace_seconds` (864000, 10 days, by default) and removed only by a compaction after that. The grace period protects against replicas that missed the delete: if the tombstone disappeared before every replica had it, repair would copy the old value back from a replica that never saw the delete, and the deleted data would return as a "zombie". Hence the rule to repair every node at least once within `gc_grace_seconds`; with the default, the repair documentation suggests at least every 7 days.

Tombstones also slow reads, because a query must read every tombstone in the slice it scans. Cassandra warns when one query scans more than 1,000 of them (`tombstone_warn_threshold`) and fails the query at 100,000 (`tombstone_failure_threshold`). A table used as a queue, with rows inserted, read and deleted, is the classic way to reach those numbers, and `cassandra.yaml` points to that anti-pattern next to the thresholds.

### Hints, read repair and anti-entropy repair

Replicas accept writes without agreeing on them first, so they can drift apart. Three mechanisms bring them back together:

- **Hinted handoff.** When a replica is down, or a write to it times out, the coordinator stores a **hint** on its own disk and replays it when the replica is back, as bkk-1 does for bkk-3 in step 4. Hints are generated only for the first `max_hint_window` of an outage (3 hours by default), and they are best effort.
- **Read repair.** When a read finds replicas that disagree, the coordinator updates the stale ones before it answers (`read_repair = 'BLOCKING'`, the default; `'NONE'` turns it off).
- **Anti-entropy repair.** `nodetool repair` builds Merkle trees (trees of hashes) over each replica's data, compares them and streams the ranges that differ. Incremental repair, the default, covers only data written since the previous incremental repair; `nodetool repair --full` covers everything, and `-pr` limits a run to the node's primary ranges so that running it on every node doesn't repeat work. As a starting point, the documentation suggests incremental repair every 1 to 3 days and a full repair every 1 to 3 weeks. Until 6.0, which adds a built-in repair scheduler (CEP-37), operators schedule repair themselves.

### Gossip and failure detection

No master tracks the cluster. Every second each node increments its heartbeat and exchanges state with a randomly chosen peer, also with a seed node when that peer wasn't one, and sometimes with a node it can't reach, so membership, tokens and schema versions spread from node to node. Each node runs a **phi accrual failure detector** over the heartbeats it hears and decides for itself when a peer is down (`phi_convict_threshold`, 8 by default); that decision isn't gossiped. A node that is down stays in the ring until an operator decommissions or replaces it, so a restart doesn't move data around. Seed nodes are ordinary nodes that new nodes contact to join and that gossip rounds favour; a few per data centre, often one per rack, is common. Cassandra 6.0 moves membership, token ownership and schema changes onto a linearized metadata log (Transactional Cluster Metadata, CEP-21).

### Lightweight transactions

For the rare write that must not race another, CQL has **lightweight transactions (LWT)**: a condition on an `INSERT`, `UPDATE` or `DELETE` within one partition, such as `IF NOT EXISTS`, checked and applied atomically through a Paxos round among the partition's replicas. They are expensive. With the default `paxos_variant: v1`, a conditional write takes 4 round trips and a serial read 3; v2, available since 4.1 and set in `cassandra_latest.yaml`, needs 2 for a write. Acme Shop would use one to claim a new shipment ID exactly once, not for every scan.

General-purpose transactions are on the way. **Accord** (CEP-15) adds `BEGIN TRANSACTION` blocks that read and write several partitions with strict-serializable isolation, designed to need one wide-area round trip in the normal case. It ships in Cassandra 6.0, which was still an alpha release (6.0-alpha2, August 2026) when this page was written, so a 5.0 cluster has only lightweight transactions.

### Several data centres

One cluster can span data centres, each with its own replication factor and its own clients:

- Clients use their local data centre. The default load-balancing policy of the Apache Cassandra Java driver requires the local data centre's name (`basic.load-balancing-policy.local-datacenter`) and is token-aware: it sends each request to a replica of its partition.
- At `LOCAL_ONE` and `LOCAL_QUORUM` a request waits only for local replicas; `QUORUM` and `EACH_QUORUM` wait for the other data centre too.
- The coordinator sends a write to its local replicas directly and to one replica in each remote data centre, which relays it to the others there, so the write crosses the WAN once per data centre (`StorageProxy` in the 5.0 source).
- Both data centres take writes for the same partitions, and concurrent writes to the same column are settled by timestamp, not by a primary.
- If a whole data centre goes away, the other keeps serving at `LOCAL_*` levels. When it returns, hints cover the first 3 hours (by default) and repair the rest.

### What 5.0 added, and what comes next

Cassandra 5.0 became generally available on 5 September 2024 with Storage-Attached Indexes, vector search (a `vector<float, n>` column type and approximate-nearest-neighbour queries through SAI), trie memtables and trie-indexed SSTables, the Unified Compaction Strategy, JDK 17 support and dynamic data masking; the 3.0 and 3.11 lines reached end of life with it. As of October 2026 the maintained releases are 5.0.9, 4.1.12 and 4.0.21, all from August 2026. Out of the box, 5.0's `cassandra.yaml` keeps the 4.x-compatible choices (skip-list memtables, the BIG SSTable format, STCS, Paxos v1 and `storage_compatibility_mode: CASSANDRA_4`), so you opt in to the new formats. Cassandra 6.0, in alpha, adds Accord, Transactional Cluster Metadata, built-in repair and official support for JDK 21.

## Where it fits

- **Solutions.** Write-heavy, time-ordered data that is read by key: tracking events like Acme Shop's, device telemetry, activity feeds and message histories, especially when the same data must be writable in more than one region at once.
- **Patterns it implements or supports.** [Sharding](../sharding/) built in: the token ring is consistent hashing, so a partition key lands on a token range much as a key lands in a bucket of a [hash table](../hash-table/), and adding a node moves a slice of its neighbours' data rather than reshuffling everything. [Multi-region active-active](../multi-region-active-active/): every data centre takes writes, and conflicts are settled by timestamp. One table per query is the [materialized view](../materialized-view/) idea done by the application, and the read side of [CQRS](../cqrs/) often lands in such tables; Cassandra's own materialized views are experimental and disabled by default (`materialized_views_enabled: false`). For [event sourcing](../event-sourcing/), a partition per entity with a sequence number as the clustering column makes a natural event stream, but rejecting an append at a stale version needs a lightweight transaction on every write. Unlike [read replicas](../read-replicas/), every copy here also takes writes.
- **Usual neighbours.** Services that write through a driver configured with a local data centre; a log such as [Kafka](../kafka/) in front to absorb bursts and feed other consumers; a search engine such as [Elasticsearch](../elasticsearch/) for the ad hoc queries Cassandra can't serve; an analytics store loaded in bulk.
- **Managed offerings.** **Amazon Keyspaces (for Apache Cassandra)** is a serverless AWS service compatible with the CQL 3.11 API that works with existing Cassandra drivers, configured for it: there are no nodes to run, capacity is on-demand or provisioned, every write is stored three times across Availability Zones at `LOCAL_QUORUM`, reads use `ONE`, `LOCAL_ONE` or `LOCAL_QUORUM`, multi-Region replication is active-active with last-writer-wins, and AWS says lightweight transactions carry no performance penalty. It leaves things out: no `CREATE INDEX`, materialized views, user-defined functions or triggers, rows of at most 1 MB, and compaction, compression, caching and bloom filter settings are ignored. **Astra DB** is a serverless database built on Cassandra, with vector search, from DataStax; IBM announced its acquisition of DataStax in February 2025 and now sells Astra DB and Hyper-Converged Database (HCD, for self-managed clusters) as IBM DataStax.
- **Licences (October 2026).** Apache Cassandra is under the Apache License 2.0. ScyllaDB, a Cassandra-compatible database written in C++ on the Seastar framework (one thread per CPU core, sharing nothing), moved to a source-available licence with release 2025.1; ScyllaDB OSS 6.2 was its last AGPL release.

## When to use it

Choose Cassandra when writes are many and steady, every query can name a partition key, the data must be writable in more than one region at once, and a single primary would be the bottleneck or the point of failure. Acme Shop's tracking fits: one partition per shipment, always read the same way. Look elsewhere when queries are ad hoc or relational (joins, reports, flexible filters: a relational database such as [PostgreSQL](../postgresql/)), when the data fits comfortably on one server, when you need multi-partition transactions today, or when the same keys are updated and deleted all the time.

| | Apache Cassandra | ScyllaDB | [Amazon DynamoDB](../amazon-dynamodb/) | [MongoDB](../mongodb/) |
|---|---|---|---|---|
| Data model | Rows in partitions, sorted by clustering columns (CQL) | The same CQL model; also a DynamoDB-compatible API (Alternator) | Items of up to 400 KB under a partition key and an optional sort key | BSON documents of up to 16 MiB in collections |
| Who takes writes | Every replica; no primary | Every replica; no primary | The service, routed by partition key | The primary of each replica set |
| Consistency | Chosen per request, from `ONE` to `ALL`; last write wins | Chosen per request, the same levels | Eventually consistent reads by default, strongly consistent on request | Read and write concerns; reads from the primary by default |
| Several regions | Built in: one cluster spans data centres, all writable | Built in, like Cassandra | Global tables: multi-Region eventual (last writer wins) or strong consistency | Replica set members in several regions; writes go to the primary |
| Transactions | Single-partition compare-and-set (LWT, Paxos); Accord in 6.0, still alpha | Single-partition LWT (Paxos) | Up to 100 actions in one transaction | Multi-document ACID transactions |
| Runs as (October 2026) | Self-managed under the Apache License 2.0; Amazon Keyspaces; Astra DB | Self-managed under a source-available licence (free up to 10 TB and 50 vCPUs for organisations that aren't recent paying customers); ScyllaDB X Cloud | AWS only | Self-managed under the SSPL; MongoDB Atlas; Amazon DocumentDB implements its API |

Figures and terms from the Apache Cassandra 5.0, ScyllaDB, Amazon DynamoDB and MongoDB documentation and licences, October 2026.

## Trade-offs

- **The queries are fixed in the schema.** A new query usually needs a new table and a backfill, and ad hoc analysis needs another system.
- **Consistency is a choice per request.** `LOCAL_QUORUM` is safe within a data centre, but a reader in the other data centre can briefly see older data, and because concurrent writes are settled by timestamp, clock skew can let an older write win.
- **Deletes are not free.** Tombstones slow reads until compaction removes them after `gc_grace_seconds`, and repair has to finish within that window or deleted data can come back.
- **Partitions must stay bounded and balanced.** One huge or hot partition overloads its replicas whatever the size of the cluster.
- **Transactions are narrow.** Compare-and-set within one partition, at the price of several round trips; nothing across partitions before 6.0.
- **Operations are real work.** Repair schedules, compaction strategies, capacity planning, rolling upgrades and JVM tuning are yours. A managed service takes most of that away and brings its own limits.

## Implementation notes

- **Start from the queries.** List them, give each its table, and estimate partition sizes; bucket by time where a partition could grow without end.
- **Use the durable multi-DC baseline:** `NetworkTopologyStrategy` with 3 replicas per data centre, `LOCAL_QUORUM` for reads and writes, a driver with its local data centre set and token-aware routing, and racks mapped to failure domains.
- **Let time series expire.** Write events with a TTL and compact them by time window. With a 90-day TTL, the TWCS documentation suggests 3-day windows, about 30 in all:

  ```sql
  ALTER TABLE tracking.shipment_events
    WITH default_time_to_live = 7776000
    AND compaction = {'class': 'TimeWindowCompactionStrategy',
                      'compaction_window_unit': 'DAYS', 'compaction_window_size': 3};
  ```

  Avoid deleting single events on the hot path, and never use a table as a queue.
- **Schedule repair** (incremental every 1 to 3 days and full every 1 to 3 weeks is the documentation's starting point), and make sure every node finishes one within `gc_grace_seconds`.
- **Watch** node state with `nodetool status`; each table's SSTable count, largest partition and tombstones per slice with `nodetool tablestats`; and pending compactions, stored hints and read and write latency.
- **Turn on security.** The default `cassandra.yaml` lets anyone in (`authenticator: AllowAllAuthenticator`, `authorizer: AllowAllAuthorizer`): use `PasswordAuthenticator` or mutual TLS with `CassandraAuthorizer`, and encrypt client and node-to-node traffic (`client_encryption_options`, `server_encryption_options`).
- **Keep clocks in sync** with NTP, since last write wins by timestamp.
- **Upgrade one node at a time.** A 5.0 node starts in `storage_compatibility_mode: CASSANDRA_4`, writing 4.x-compatible files; once every node runs 5.0, rolling restarts through `UPGRADING` to `NONE` enable the new formats and features such as TTLs that reach 2106.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Sharding](../sharding/) — Split data horizontally across databases using a shard key.
- [Multi-Region Active-Active](../multi-region-active-active/) — Serve users from several regions at once and shift traffic away from a region that fails.
- [Amazon DynamoDB](../amazon-dynamodb/) — A serverless key-value and document database: the partition key spreads items across partitions for single-digit-millisecond reads.
- [MongoDB](../mongodb/) — A document database: JSON-like documents with flexible schemas, replica sets for failover and sharding to scale out.
- [Event Sourcing](../event-sourcing/) — Store every change as an immutable event and rebuild state by replaying them.
- [CQRS](../cqrs/) — Separate the write model (commands) from read models (queries), each optimised for its job.
- [Materialized View](../materialized-view/) — Precompute query-shaped views so reads don't pay for joins and aggregations.
- [Read Replicas](../read-replicas/) — Send writes to the primary and spread reads across asynchronously updated replicas.

## Related database topics

- [LSM Tree vs B-Tree](../lsm-tree/) — Two storage engine designs: update pages in place, or append in memory and merge sorted files, and what each costs to read and write.
- [Table Partitioning](../table-partitioning/) — Split a large table into partitions by range, list or hash, so queries skip partitions and old data is dropped in an instant.

## References

- [Apache Cassandra 5.0 documentation — Dynamo (partitioning, replication, consistency, gossip)](https://cassandra.apache.org/doc/5.0/cassandra/architecture/dynamo.html)
- [Apache Cassandra 5.0 documentation — Storage Engine](https://cassandra.apache.org/doc/5.0/cassandra/architecture/storage-engine.html)
- [Apache Cassandra 5.0 documentation — Data modeling: RDBMS design](https://cassandra.apache.org/doc/5.0/cassandra/developing/data-modeling/data-modeling_rdbms.html)
- [Apache Cassandra 5.0 documentation — Data manipulation (CQL)](https://cassandra.apache.org/doc/5.0/cassandra/developing/cql/dml.html)
- [Apache Cassandra 5.0 documentation — Storage-Attached Indexing FAQ](https://cassandra.apache.org/doc/5.0/cassandra/developing/cql/indexing/sai/sai-faq.html)
- [Apache Cassandra 5.0 documentation — Compaction overview](https://cassandra.apache.org/doc/5.0/cassandra/managing/operating/compaction/overview.html)
- [Apache Cassandra 5.0 documentation — Time Window Compaction Strategy (TWCS)](https://cassandra.apache.org/doc/5.0/cassandra/managing/operating/compaction/twcs.html)
- [Apache Cassandra 5.0 documentation — Tombstones](https://cassandra.apache.org/doc/5.0/cassandra/managing/operating/compaction/tombstones.html)
- [Apache Cassandra 5.0 documentation — Hints](https://cassandra.apache.org/doc/5.0/cassandra/managing/operating/hints.html)
- [Apache Cassandra 5.0 documentation — Repair](https://cassandra.apache.org/doc/5.0/cassandra/managing/operating/repair.html)
- [Apache Cassandra 5.0 documentation — cassandra.yaml file configuration](https://cassandra.apache.org/doc/5.0/cassandra/managing/configuration/cass_yaml_file.html)
- [Announcing Apache Cassandra 5.0 (September 2024)](https://cassandra.apache.org/_/blog/Apache-Cassandra-5.0-Announcement.html)
- [Apache Cassandra — Downloads (supported releases)](https://cassandra.apache.org/_/download.html)
- [Apache Cassandra 6.0-alpha2 — CHANGES.txt](https://github.com/apache/cassandra/blob/cassandra-6.0-alpha2/CHANGES.txt)
- [CEP-15: General Purpose Transactions (Accord)](https://cwiki.apache.org/confluence/display/CASSANDRA/CEP-15%3A+General+Purpose+Transactions)
- [Apache Cassandra 5.0.9 source — StorageProxy.java (write fan-out to remote data centres)](https://github.com/apache/cassandra/blob/cassandra-5.0.9/src/java/org/apache/cassandra/service/StorageProxy.java)
- [Apache Cassandra Java Driver 4.x manual — Load balancing](https://github.com/apache/cassandra-java-driver/tree/4.x/manual/core/load_balancing)
- [Avinash Lakshman and Prashant Malik — Cassandra: A Decentralized Structured Storage System (LADIS 2009; ACM SIGOPS OSR, 2010)](https://www.cs.cornell.edu/projects/ladis2009/papers/lakshman-ladis2009.pdf)
- [Giuseppe DeCandia et al. — Dynamo: Amazon's Highly Available Key-value Store (SOSP 2007)](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf)
- [Amazon Keyspaces Developer Guide — Functional differences: Amazon Keyspaces vs. Apache Cassandra](https://docs.aws.amazon.com/keyspaces/latest/devguide/functional-differences.html)
- [Amazon Keyspaces Developer Guide — Supported Apache Cassandra read and write consistency levels](https://docs.aws.amazon.com/keyspaces/latest/devguide/consistency.html)
- [Amazon Keyspaces Developer Guide — Supported Cassandra APIs, operations, functions, and data types](https://docs.aws.amazon.com/keyspaces/latest/devguide/cassandra-apis.html)
- [Amazon Keyspaces Developer Guide — Multi-Region replication](https://docs.aws.amazon.com/keyspaces/latest/devguide/multiRegion-replication.html)
- [IBM — IBM to Acquire DataStax (February 2025)](https://newsroom.ibm.com/2025-02-25-ibm-to-acquire-datastax,-deepening-watsonx-capabilities-and-addressing-generative-ai-data-needs-for-the-enterprise)
- [IBM DataStax — Astra DB and Hyper-Converged Database](https://www.ibm.com/products/datastax)
- [ScyllaDB — Why We’re Moving to a Source Available License (December 2024)](https://www.scylladb.com/2024/12/18/why-were-moving-to-a-source-available-license/)
- [ScyllaDB Software License Agreement (source-available licence)](https://github.com/scylladb/scylladb/blob/master/LICENSE-ScyllaDB-Source-Available.md)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
