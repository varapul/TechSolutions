<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗄️ Data Management](../../README.md#data-management)

# Sharding

> Split data horizontally across databases using a shard key.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Sharding" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/sharding.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One database at its limit** | One database holds every customer and every order. Writes and data keep growing, and the server is at its ceiling: CPU at 95% and the disk 90% full. [Read replicas](../read-replicas/) would add read capacity but not write capacity, because every replica replays every write. |
| **2 · Split rows by a shard key** | Customers are split by `customer_id` across three shards: databases with the same schema, each holding its own subset of the rows. The router in the application's driver hashes the key into one of 12 logical shards and looks up which shard holds it, so customer 42 (logical shard 5) goes to B and nowhere else; a key range or a lookup table per key would work too. Orders carry the same `customer_id`, so a customer's orders live on the customer's shard and joins between them stay inside one database. |
| **3 · What the key makes hard** | A query by email, which is not the shard key, has to ask every shard and merge the answers (**scatter-gather**): three queries for one row, as slow as the slowest shard. One very large customer sends so much traffic to B that it runs at 92% while A and C stay at 32%, and a transaction over a customer on A and one on C needs two-phase commit, where the database offers it at all, or a [saga](../saga-orchestration/). The choice of shard key decides all three. |
| **4 · Add a shard, move only 25%** | Data keeps growing until the disks reach 80%, so a fourth server is added. With `hash(key) % N`, going from 3 to 4 shards changes the shard of every key except 3 in every 12, so 75% of the data would move. Because the data was split into 12 logical shards from the start, shard D takes one from each server, 3 of 12 or 25% of the data, while A, B and C keep serving: copy, catch up on the changes made meanwhile, then switch the map. Every shard ends at 60% disk; consistent hashing gives a similar result. |
<!-- END GENERATED: header -->

## The problem

A single database server has a ceiling. More CPU, more memory and faster disks raise it, but each step costs more than the last, and at some point there is no bigger machine to buy. Reads can get past the ceiling with copies: replicas and caches take queries off the primary. Writes cannot. Every write still lands on the one primary, and every replica has to replay it as well. When the write rate, the volume of data or the set of rows that must stay in memory outgrows one server, the data itself has to be divided.

## How it works

Sharding splits one data set into **shards**: separate databases with the same schema, each holding its own subset of the rows.

1. **Pick a shard key.** A column (or a few) that every row has, such as `customer_id`. All rows with the same key value live on the same shard.
2. **Map keys to shards.** A function of the key, a table of key ranges or a lookup table decides which shard holds each key.
3. **Route every query.** The application, its database driver or a proxy works out the shard from the key in the query and sends the query there and nowhere else.
4. **Keep related rows together.** Child tables carry the parent's key (orders carry `customer_id`), so a customer and all of their orders sit on one shard, and joins and transactions between them stay local.

Each shard takes a fraction of the writes, the storage and the queries, and adding shards adds capacity, as long as the key spreads the load evenly and most requests carry the key.

### Horizontal, vertical and functional partitioning

The Azure data partitioning guidance names three ways to divide data. They can be combined.

- **Horizontal partitioning**, usually called sharding: every partition has the same schema and holds different rows. This pattern.
- **Vertical partitioning:** each partition holds some of the columns of the same items, for example the frequently read fields in one store and the rarely used or sensitive ones in another.
- **Functional partitioning:** data is divided by the part of the system that uses it, such as invoices in one store and inventory in another. [Database per service](../database-per-service/) is functional partitioning along service boundaries.

### Strategies: how a key finds its shard

The Azure Architecture Center's Sharding pattern describes four strategies: lookup (also called directory-based), range-based, hash-based and geographic.

| Strategy | How the router finds the shard | Good at | Watch out for |
|---|---|---|---|
| **Lookup** (directory) | A map from each key, or each group of keys, to a shard | Full control: move one tenant, give a large customer a shard of its own | The map is critical state that must be highly available and cached, and every request pays for a lookup |
| **Range** | Each shard owns a contiguous range of keys | Range queries, such as all orders in one month, stay on one shard | Sequential keys (timestamps, auto-increment IDs) send every new write to the last shard |
| **Hash** | A hash of the key picks the shard | Spreads keys and load evenly, with no map to maintain | Range queries go to every shard, and `hash(key) % N` moves most keys whenever N changes |
| **Geographic** | The user's or tenant's region picks the shard | Data residency, and low latency for users near their data | Regions are rarely the same size, so combine it with another strategy inside each region |

Real systems mix them. The diagram hashes the key into one of 12 **logical shards** and then looks up which server holds each one: the hash spreads the data evenly, and the small map is what makes it possible to move whole logical shards later.

### Choosing a shard key

The shard key is the decision that is hardest to change, because changing it means moving every row. A good key:

- **Has many distinct values** (high cardinality). MongoDB's guidance uses a `continent` key as the bad example: seven possible values allow at most seven chunks, so no more than seven shards can ever share the data.
- **Spreads data and traffic evenly.** Values that occur very often, and values that only ever increase (timestamps, sequences), concentrate writes on one shard. Hashing the key solves the second problem but not the first, because every row with the same value still hashes to the same place.
- **Appears in the queries that matter.** A query that carries the key goes to one shard; a query that doesn't goes to all of them. List the queries you must serve before you choose.
- **Keeps related data together.** Tables that are joined or updated together should share the key so that their rows land on the same shard. Citus calls such tables co-located; Spanner can interleave child rows with their parent row.
- **Does not change.** A row whose key changes has to move to another shard. Azure Cosmos DB doesn't let you update an item's partition key value at all: you create the item again under the new value and delete the old one.

In multi-tenant software the tenant ID is the usual choice, because almost every request concerns one tenant and tenants don't share rows. It needs a plan for the tenant that outgrows a shard. Notion, for example, sharded its Postgres data by workspace ID, since every block belongs to exactly one workspace. [Cell-based architecture](../cell-based-architecture/) goes one step further and gives each group of tenants a copy of the whole stack, not only of the database.

### Routing: where the map lives

- **In the application or its driver.** A library works out the shard and keeps a connection pool per shard. The elastic database client library for Azure SQL Database is one example: it manages the shard map and routes each query by its key. This is the simplest place to start, but every service that touches the data needs the same logic and the same map.
- **In a proxy or coordinator.** The application talks to something that looks like a single database. Vitess puts VTGate in front of sharded MySQL: it turns the shard key into a keyspace ID with a *vindex* and sends the query to the shard whose key range contains it. Citus routes queries from a coordinator node to PostgreSQL worker nodes. In MongoDB, `mongos` routers send each query to the right shards, using the cluster metadata kept on the config servers.

Wherever it lives, the map has to be highly available and cacheable. If it is wrong or unreachable, nothing can find its data.

### Queries without the key: scatter-gather and global indexes

A query that doesn't include the shard key, like the lookup by email in step 3, can only be answered by asking every shard and merging the results. MongoDB calls these broadcast operations; Vitess scatters such a query to all shards. Scatter-gather costs one query per shard, waits for the slowest shard, and gets more expensive with every shard you add. A few of them are fine; a frequent one is a design problem. The ways out:

- **A global secondary index:** a second copy of the lookup, partitioned by the other column. A Vitess lookup vindex is a table that maps a value such as an email to its keyspace ID, so the query goes to one shard. Amazon DynamoDB updates global secondary indexes asynchronously and serves only eventually consistent reads from them, and the global secondary indexes of Azure Cosmos DB are likewise eventually consistent with their source.
- **A separate read model** built for those queries, fed from the shards: a search index, a reporting store or a [materialized view](../materialized-view/). See also [CQRS](../cqrs/).
- **Accept the fan-out** for rare queries, but query the shards in parallel and give the whole query a time limit.

### Joins and transactions across shards

Keeping related rows on one shard is the main defence. When that isn't possible:

- **Copy small reference tables to every shard** (countries, plans, currencies). Citus has reference tables for exactly this.
- **Denormalize** the few fields you need from the other side of the boundary, and accept that the copy can lag.
- **Use a distributed transaction where the database has one, and know its price.** Spanner commits a transaction that spans several splits with two-phase commit, and skips it when only one split is involved. MongoDB has supported transactions across shards since version 4.2, but its manual warns that they cost more than single-document writes and are no substitute for a schema that keeps them rare. Vitess has a two-phase-commit mode that makes a cross-shard commit atomic but not isolated: another reader can see some shards' changes before others', and commits get slower. DynamoDB transactions can cover up to 100 items in several tables of one account and Region, and every item is read or written twice, once to prepare and once to commit.
- **Avoid the distributed transaction** and coordinate local transactions with a [saga](../saga-orchestration/), with compensating steps when one fails.

### Hot spots

An even hash spreads keys, not traffic. One very large or very busy customer can still overload its shard, as in step 3. Ways to spread the load:

- **Move the big customer.** With a lookup map, a large tenant can get a shard of its own while small tenants share.
- **Split the hot key.** DynamoDB's guidance adds a suffix to a busy partition key value, either random or calculated from another attribute, so that its writes spread over many partitions. Reading everything for that key then means querying every suffix and merging the results.
- **Cache hot reads** with [cache-aside](../cache-aside/), so the popular rows are served from memory instead of from the shard.
- **Let the database split it.** DynamoDB's adaptive capacity can give a frequently accessed item a partition of its own, which can then serve up to the partition maximum of 3,000 read units and 1,000 write units per second. Spanner splits busy key ranges by load.

### Resharding without stopping

With `hash(key) % N` a key moves whenever its remainder changes. Going from 3 shards to 4, a key stays put only when `key % 3` equals `key % 4`, which holds for 3 of every 12 keys, so 75% of the data moves. There are two ways to avoid that:

- **Many logical shards on fewer servers.** Hash into a fixed and generous number of logical shards and keep a small map from logical shard to server. A key's logical shard never changes; adding a server moves whole logical shards and updates the map. Redis Cluster hashes every key into one of 16,384 slots (CRC16 of the key, or of the part inside a `{hash tag}` so that related keys share a slot, modulo 16,384) and moves slots between nodes while it keeps serving. Notion split its Postgres data into 480 logical shards, 15 on each of 32 databases, and later spread them over 96 databases with 5 each. The number of logical shards is a hard ceiling on the number of servers, so pick it far above what you expect to need.
- **Consistent hashing.** Place both keys and servers on a ring of hash values and give each key to the next server along the ring. A new server takes over only the keys between it and the server before it. Karger and colleagues described consistent hashing in 1997 to spread web caches without hot spots. Amazon's Dynamo used it with *virtual nodes*, several ring positions per server, and its paper describes a later move to a fixed number of equal-sized partitions shared out among the nodes, which separated partitioning from placement and balanced load best of the schemes the team tried.

Moving a logical shard while the system keeps serving follows the same outline in most databases. Step 4 shows the copy, the catch-up and the switch; a careful move also verifies before it switches:

1. **Copy** the rows to the new server while the old one keeps serving reads and writes.
2. **Catch up** by replaying, from the database's log, the changes made since the copy started. This is [change data capture](../change-data-capture/).
3. **Verify**, by comparing counts or checksums, or by sending the same reads to both copies and comparing the answers.
4. **Switch** the map during a brief pause in writes, then delete the old copy once nothing reads it.

Vitess's Reshard workflow copies the data, follows the binary log, compares the copies with VDiff, and then moves reads and writes with SwitchTraffic, keeping ReverseTraffic as the way back. MongoDB's `reshardCollection` (since 5.0) copies and catches up while the collection stays available, and blocks writes only once the remaining work is estimated at under 500 ms. Citus moves shards with PostgreSQL logical replication and needs only a short write lock to switch. Notion's re-shard also used logical replication, checked the new databases with dark reads, and switched at its connection pooler, which users saw as at most about a second of waiting.

## When to use it

- Write throughput, data volume or working set beyond what the largest server you can reasonably run can handle.
- Workloads where nearly every request carries one key: a tenant, a user, a device, an account.
- Data that must stay in particular regions, or tenants that need to be isolated from each other.

Sharding is hard to undo: once the data is spread out, every query, report, migration and backup has to deal with it. Try the cheaper options first:

- **Scale up**, and tune the queries and indexes. One bigger server keeps joins, transactions and operations simple.
- **Add [read replicas](../read-replicas/)** when reads, not writes, are the bottleneck.
- **Cache** with [cache-aside](../cache-aside/), and archive or delete data nobody reads any more.
- **Partition tables inside one database**, for example with PostgreSQL's declarative partitioning, when the problem is a few huge tables rather than a busy server.
- **Use a database that shards for you** (below), if its data model fits.

## Trade-offs

- **The key is hard to change.** Changing it means moving every row, and a poor key costs you in scatter queries and hot spots for as long as you keep it.
- **Queries without the key get expensive**, and their cost grows with the number of shards.
- **Joins and transactions across shards aren't free.** Keep them local by design, pay for two-phase commit, or accept eventual consistency with sagas.
- **Load is rarely even.** Large tenants, popular keys and sequential keys concentrate load on a few shards.
- **More to operate.** Many databases to back up, patch, monitor and fail over, plus the router and the map.
- **Database-wide guarantees stop at the shard.** A unique constraint or an auto-increment sequence only covers its own database, so two shards can hand out the same ID. Use globally unique IDs, such as UUIDs or IDs that include the logical shard number.

## Implementation notes

- **Plan for resharding on day one.** Start with many more logical shards than servers, even if they all live on one server at first.
- **Operate per shard.** Backups are taken per shard, and a point-in-time restore of one shard can disagree with the others, so decide how you would restore them together. A schema change has to reach every shard and can't land everywhere at the same moment, so make each change backward compatible with [expand and contract](../expand-and-contract/). Monitor every shard, not only the totals, to catch skew early.
- **Treat the map as a dependency.** Cache it in the routers, version it, and make a stale entry lead to a retry, the way Redis Cluster answers with a `MOVED` redirect, never to a write on the wrong shard.
- **Databases that partition for you:**
  - *Amazon DynamoDB* runs the partition key through an internal hash function to choose a partition, adds partitions as data or provisioned throughput grows, and limits each partition to 3,000 read units and 1,000 write units per second.
  - *Azure Cosmos DB* groups all items with the same partition key value into a logical partition of up to 20 GB, and spreads logical partitions by hash over physical partitions of up to 10,000 RU/s and 50 GB, which it splits as the container grows. A container's partition key can't be changed in place, and hierarchical partition keys of up to three levels help when one value would outgrow 20 GB.
  - *Google Cloud Spanner* keeps rows in primary-key order and divides them into *splits*, contiguous ranges of rows, adding or removing split boundaries automatically as the data and the load change. Avoid primary keys that only increase, which send every insert to the same end of the key range.

  These services take routing, splitting and rebalancing off your hands, but not the choice of key: a poor partition key still leads to hot partitions and cross-partition queries.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Read Replicas](../read-replicas/) — Send writes to the primary and spread reads across asynchronously updated replicas.
- [Cell-Based Architecture](../cell-based-architecture/) — Many isolated, identical cells behind a thin router contain the blast radius of any failure.
- [Database per Service](../database-per-service/) — Each service owns its data; others go through its API or events, never its tables.
- [Cache-Aside](../cache-aside/) — Read from the cache first; on a miss load from the database and populate the cache.
- [CQRS](../cqrs/) — Separate the write model (commands) from read models (queries), each optimised for its job.
- [Materialized View](../materialized-view/) — Precompute query-shaped views so reads don't pay for joins and aggregations.
- [Deployment Stamps](../deployment-stamps/) — Deploy many independent copies of the whole stack, each serving a subset of tenants.
- [Change Data Capture (CDC)](../change-data-capture/) — Stream every committed change from the database log to other systems.

## References

- [Azure Architecture Center — Sharding pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/sharding)
- [Azure Architecture Center — Data partitioning guidance (horizontal, vertical and functional partitioning)](https://learn.microsoft.com/en-us/azure/architecture/best-practices/data-partitioning)
- [Vitess documentation — Sharding](https://vitess.io/docs/reference/features/sharding/)
- [Vitess documentation — Vindexes (primary and lookup vindexes)](https://vitess.io/docs/reference/features/vindexes/)
- [Vitess documentation — Reshard](https://vitess.io/docs/reference/vreplication/reshard/)
- [Vitess documentation — Distributed Transactions](https://vitess.io/docs/reference/features/distributed-transaction/)
- [Citus documentation — Choosing Distribution Column](https://docs.citusdata.com/en/stable/sharding/data_modeling.html)
- [Citus documentation — Cluster Management (rebalancing shards)](https://docs.citusdata.com/en/stable/admin_guide/cluster_management.html)
- [MongoDB Manual — Sharding](https://www.mongodb.com/docs/manual/sharding/)
- [MongoDB Manual — Choose a Shard Key](https://www.mongodb.com/docs/manual/core/sharding-choose-a-shard-key/)
- [MongoDB Manual — reshardCollection](https://www.mongodb.com/docs/manual/reference/command/reshardcollection/)
- [MongoDB Manual — Transactions](https://www.mongodb.com/docs/manual/core/transactions/)
- [Amazon DynamoDB Developer Guide — Partitions and data distribution](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.Partitions.html)
- [Amazon DynamoDB Developer Guide — Best practices for designing and using partition keys](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html)
- [Amazon DynamoDB Developer Guide — Using write sharding to distribute workloads evenly](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-sharding.html)
- [Amazon DynamoDB Developer Guide — Burst and adaptive capacity](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/burst-adaptive-capacity.html)
- [Amazon DynamoDB Developer Guide — Using Global Secondary Indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html)
- [Amazon DynamoDB Developer Guide — Transactions: how it works](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html)
- [Microsoft Learn — Partitioning and horizontal scaling in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/partitioning)
- [Google Cloud — Spanner: Schemas overview (database splits)](https://docs.cloud.google.com/spanner/docs/schema-and-data-model)
- [Google Cloud — Life of Spanner Reads & Writes](https://docs.cloud.google.com/spanner/docs/whitepapers/life-of-reads-and-writes)
- [Redis — Redis cluster specification (hash slots and live resharding)](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/)
- [PostgreSQL documentation — Table Partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html)
- [Notion — Herding elephants: Lessons learned from sharding Postgres at Notion (2021)](https://www.notion.com/blog/sharding-postgres-at-notion)
- [Notion — The Great Re-shard: adding Postgres capacity (again) with zero downtime (2023)](https://www.notion.com/blog/the-great-re-shard)
- [Karger, Lehman, Leighton, Levine, Lewin and Panigrahy — Consistent Hashing and Random Trees (STOC 1997)](https://people.csail.mit.edu/karger/Papers/web.pdf)
- [DeCandia et al. — Dynamo: Amazon's Highly Available Key-value Store (SOSP 2007)](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf)
- [Martin Kleppmann & Chris Riccomini — Designing Data-Intensive Applications, 2nd Edition (O'Reilly, 2026)](https://martin.kleppmann.com/2026/03/24/designing-data-intensive-applications-2e.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
