<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧱 System Components](../../README.md#system-components)

# MongoDB

> A document database: JSON-like documents with flexible schemas, replica sets for failover and sharding to scale out.

<p align="center"><img src="diagram.svg" alt="Animated diagram: MongoDB" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/mongodb.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Acme Shop's Catalog service stores every product as one document in the collection **products**, through the MongoDB driver and a replica set of three members. A mug has a colour and a capacity, a T-shirt a size and an e-book a format, and nothing forces one shape on them. `insertOne` goes to the primary and is acknowledged once a majority of the members has it; a **change stream** then passes the new product to search-sync and analytics. |
| **2 · Documents and indexes** | MUG-1 keeps its nested `attributes` and its array of `tags` inside one document. `find({ "attributes.colour": "red", price: { $lt: 20 } })` walks the compound index `{ "attributes.colour": 1, price: 1 }`, equality field first and range field second, and fetches only MUG-1 and TEE-7 instead of scanning all 4 documents. The pipeline `$match` → `$group` → `$sort` keeps the 3 gift products, counts them per brand and returns Acme Home 2, Acme Wear 1. A write to one document is atomic; a transaction across documents is possible but costs more. |
| **3 · Replica set and failover** | The insert of **LAMP-4** goes to the primary **m1** and into its oplog; **m2** and **m3** copy the entry and apply it, and with `w: "majority"` the driver is acknowledged as soon as 2 of the 3 members have it. Then m1 fails with an update in flight. When the primary has been silent for `electionTimeoutMillis` (10 s by default), the secondaries elect **m2**; MongoDB puts the median time to a new primary at no more than 12 s with default settings. The driver retries the update once on m2 (retryable writes), and m3 copies it from there. |
| **4 · Sharding and the limits** | Once the catalog outgrows one replica set, `sh.shardCollection("catalog.products", { sku: "hashed" })` splits it into chunks by the hash of `sku`, and the balancer spreads the chunks over two shards, each a replica set of its own; the config servers keep the chunk ranges and the **mongos** routers cache them. `find({ sku: "MUG-1" })` goes to shard B alone, while `find({ "attributes.colour": "red" })` names no shard key, so mongos asks both shards and merges the answers. The limits: a document holds at most **16 MiB**, a poor shard key piles the load onto one shard, a flexible schema still needs validation rules, and `$lookup` joins only collections in the same database. Since 16 October 2018 the Community Server has been licensed under the **SSPL**. |
<!-- END GENERATED: header -->

## The problem

Acme Shop sells products of very different kinds. A mug has a colour and a capacity, a T-shirt has a size, an e-book has a format and a page count, and next season brings desk lamps with a wattage. In a relational schema that variety becomes a wide table of mostly empty columns, an entity–attribute–value table that is awkward to query, or a table per product type with a migration for every new type. The storefront, meanwhile, reads a product page as one unit: title, price, attributes and tags together.

MongoDB stores each product as one **document**, a nested, JSON-like record that holds exactly the fields that product needs, in a **collection** that doesn't impose one shape on its documents. What the application reads together is stored together, so a product page is one read. The server keeps copies of the data on the members of a **replica set**, which elect a new primary on their own when the current one fails, and a **sharded cluster** spreads a collection that has outgrown one replica set over several.

## How it works

### Documents, collections and BSON

A document is an ordered set of fields whose values can themselves be documents or arrays, nested up to 100 levels deep. MongoDB stores and sends documents as **BSON**, a binary encoding with more types than JSON: 32- and 64-bit integers, doubles, `Decimal128` for exact decimal amounts, dates, binary data and the 12-byte `ObjectId`. Every document has a unique `_id`; if the application doesn't set one, an ObjectId is generated. A single document can be at most **16 MiB** (MongoDB 9.0 limits).

```js
// mongosh, database catalog
db.products.insertOne({
  sku: "MUG-1",
  title: "Red ceramic mug",
  brand: "Acme Home",
  price: 12,
  attributes: { colour: "red", capacity_ml: 350 },
  tags: ["kitchen", "gift"]
})
```

`insertOne` creates the collection if it doesn't exist yet. The next product can carry `attributes: { colour: "red", size: "M" }` or `{ format: "ebook", pages: 212 }`; nothing has to be declared first.

### Modelling: embed or reference

MongoDB's own guidance is that data accessed together should be stored together, so the schema follows the application's queries rather than the shape of the entities.

- **Embed** data that is read with its parent, belongs to it and stays bounded: a product's attributes and tags, or the few most recent reviews shown on the product page. One read returns everything, and one write changes it atomically.
- **Reference** data that is large or unbounded, shared by many parents or updated on its own schedule: every review of a product, a brand's own page, stock levels that warehouses update all day. Store the other document's `_id` and read it separately, or join it with `$lookup`.
- **Avoid unbounded arrays.** An array that grows forever pushes its document toward the 16 MiB limit, and a multikey index on it holds one entry per element.

The manual collects recurring designs as schema design patterns: computed values, grouping data (the attribute, bucket, outlier and subset patterns), polymorphic and inheritance patterns, document and schema versioning, archiving and the single-collection pattern. A catalog is the textbook case for the **attribute pattern**: varying attributes stored as an array of key–value sub-documents can be served by one compound index on the key and value fields instead of an index per attribute. The alternative for a sub-document like `attributes` is a **wildcard index**, `{ "attributes.$**": 1 }`, which indexes every field under it; the manual notes that wildcard indexes don't perform as well as indexes on known fields, so keep them for fields you can't list in advance.

### Indexes

Indexes are B-trees over one or more fields. Every collection has a unique index on `_id`; without a usable index, a query scans the whole collection (`COLLSCAN` in `explain()`).

- **Types:** single field; **compound** (up to 32 fields); **multikey**, created automatically when an indexed field holds an array, with one entry per element; text indexes on self-managed deployments (MongoDB recommends MongoDB Search instead); geospatial; **hashed**, used for hashed sharding; **wildcard**; and clustered.
- **Properties:** unique; **partial**, which indexes only documents that match a filter and is preferred over sparse; sparse; **TTL**, where a background task deletes expired documents, running every 60 seconds; hidden, which the planner ignores while the index is still maintained, a safe way to test dropping it; and case-insensitive.
- A collection can have at most 64 indexes, and every index costs work on each write.

Order the fields of a compound index by the **ESR guideline**: equality fields first, then sort fields, then range fields (a very selective range can go before the sort). The index in step 2 puts the equality field `attributes.colour` before the range field `price`, so the matching keys sit next to each other and the query reads one short run of the index:

```js
db.products.createIndex({ "attributes.colour": 1, price: 1 })
db.products.find({ "attributes.colour": "red", price: { $lt: 20 } })  // MUG-1 and TEE-7
db.products.find({ "attributes.colour": "red", price: { $lt: 20 } }).explain("executionStats")
```

A document without `attributes.colour` (the e-book) is still in the index, under `null`; only a sparse or partial index leaves it out.

### Queries and the aggregation pipeline

`find` filters on nested fields with dot notation and matches arrays element by element (`{ tags: "gift" }` finds every document whose tags contain `"gift"`), with projection, sort and limit. Anything more goes through the **aggregation pipeline**: a list of stages that the server runs in order, each passing its output to the next. Common stages are `$match`, `$group`, `$sort`, `$project`, `$unwind`, `$lookup` and `$facet`; `$merge` and `$out` write the result to a collection, which is how MongoDB builds on-demand materialized views.

```js
db.products.aggregate([
  { $match: { tags: "gift" } },                                   // MUG-1, TEE-7, VASE-2
  { $group: { _id: "$brand", products: { $sum: 1 }, avgPrice: { $avg: "$price" } } },
  { $sort: { products: -1 } }
])
// { _id: "Acme Home", products: 2, avgPrice: 21 }
// { _id: "Acme Wear", products: 1, avgPrice: 18 }
```

`$lookup` is MongoDB's join: a left outer join to another collection **in the same database**, written as a pipeline stage. Since 5.1 the joined collection can be sharded, and since 8.0 `$lookup` on a sharded collection also works inside a transaction. Its speed depends on an index on the joined field, and the manual suggests embedding when the joined data is always needed. MongoDB 9.0 also caps the memory one query operation may use at 1 GB or 20% of the server's memory, whichever is greater.

### Atomicity and transactions

A write to **one document is atomic**, including every embedded field and array in it. This update changes the price and adds a tag together or not at all, and the filter on the current price turns it into an optimistic, compare-and-set update:

```js
db.products.updateOne({ sku: "MUG-1", price: 12 }, { $set: { price: 11 }, $push: { tags: "sale" } })
```

**Multi-document ACID transactions** work on replica sets (since 4.0) and sharded clusters (since 4.2). By default a transaction must finish within a minute (`transactionLifetimeLimitSeconds`), and in 9.0 the server accepts at most 10,000 concurrently open transactions by default (`maxConcurrentMultiDocumentTransactions`) and rejects new ones with `TooManyOpenTransactions`. The manual is plain about the cost: a distributed transaction is usually more expensive than single-document writes, and it is no substitute for a schema that keeps related data together.

### Replica sets, the oplog and elections

A **replica set** is a group of `mongod` processes holding the same data. One member is the **primary** and takes every write; the **secondaries** replicate it; an optional **arbiter** votes in elections without holding data. A set can have up to 50 members, of which at most 7 vote.

The primary applies each write and records it in its **oplog**, the capped collection `local.oplog.rs`. Secondaries copy the oplog and apply the entries **asynchronously**; each entry is idempotent, so applying it twice gives the same result, and a secondary may sync from another secondary rather than from the primary. With WiredTiger the oplog defaults to 5% of free disk, between 990 MB and 50 GB, and `replSetResizeOplog` changes it on a running member. The time between its oldest and newest entries is the **oplog window**: how long a secondary can stop copying and still catch up. A brand-new member instead runs an **initial sync**, a full copy of the data.

When the other members haven't heard from the primary for `electionTimeoutMillis` (10 seconds by default), an eligible secondary calls an **election**. The manual says the median time until a new primary is elected should not usually exceed 12 seconds with default settings, detection included. Member priorities steer the outcome, and a priority-0 member never becomes primary. During the election there is no primary to take writes; reads continue on secondaries if the read preference allows them.

**Retryable writes** hide most of that gap from the application. Drivers compatible with MongoDB 4.2 and later turn them on by default (`retryWrites=true`): after a network error, or when no healthy primary can be found, the driver waits up to `serverSelectionTimeoutMS` for a new primary and retries the write once. Single-document writes such as `insertOne`, `updateOne` and `deleteOne` are retryable; writes with `w: 0` and multi-document updates (`updateMany`) are not.

### Write concern, read concern and read preference

The **write concern** sets when a write counts as done:

- `w: 1`: the primary has applied it. Such a write can still be **rolled back** if the primary fails before a secondary has it.
- `w: "majority"`: the calculated majority of data-bearing voting members has it in its oplog, written to the on-disk journal by default (`writeConcernMajorityJournalDefault`). For a primary and two secondaries the majority is 2, as in step 3. Such a write survives the failover.
- `j: true` asks for the journal explicitly, and `wtimeout` limits the wait.

`w: "majority"` is the implicit default, with one exception: in a set with arbiters where the data-bearing voting members are no more than a voting majority, a primary-secondary-arbiter set for example, the default falls back to `w: 1`.

The **read concern** sets what a read may see: `"local"` (the default: the member's newest data, which may be rolled back), `"available"`, `"majority"` (only majority-committed data), `"linearizable"` (primary only, for one document) and `"snapshot"` (one point in time, used in transactions). The **read preference** chooses the member: `primary` (the default), `primaryPreferred`, `secondary`, `secondaryPreferred` or `nearest`, optionally limited by tags or `maxStalenessSeconds`. Reads from secondaries take load off the primary, as [read replicas](../read-replicas/) do, but may return slightly old data. A **causally consistent session** with majority read and write concern restores read-your-own-writes and monotonic reads even when the reads go to secondaries.

### Sharding

A **sharded cluster** has three parts:

- **Shards**, each a replica set holding part of the data.
- **`mongos` routers**, which the application connects to instead of the shards.
- **Config servers**, a replica set holding the cluster's metadata, including which shard owns which range of the shard key. Since 8.0 a *config shard* can hold application data as well, saving a replica set in small clusters.

Each sharded collection has a **shard key**: one or more fields, ranged or hashed (one hashed field, optionally in a compound key). Good keys have many distinct values, no single value that dominates, and no steady increase: a key that grows over time, such as a timestamp, sends every insert to the same chunk and therefore to one shard. Hashing spreads such keys evenly, at the price that range queries on the key reach every shard.

The data is split into **chunks**, contiguous ranges of shard-key values (lower bound inclusive, upper bound exclusive). The default range size is 128 MB, and the **balancer** moves ranges between shards once a collection's data on two shards differs by three times that, 384 MB by default. Sharding a populated collection starts with one large chunk, and the balancer then moves ranges off it gradually, because each shard takes part in only one migration at a time. For an existing collection, 8.0 and later recommend `sh.shardAndDistributeCollection()`, which shards and immediately redistributes the data without waiting for the balancer, if the cluster has the resources. An empty collection with a hashed key gets one chunk per shard (8.0 and later).

```js
// mongosh connected to mongos; since 6.0 sh.enableSharding() is no longer needed first
sh.shardCollection("catalog.products", { sku: "hashed" })
sh.getShardedDataDistribution()   // how much of each collection sits on each shard
```

`mongos` caches the chunk map from the config servers. A query that includes the shard key (or a prefix of a compound key) is **targeted** to the shards that own those values; with a hashed key that means equality matches. Any other query is **broadcast** to every shard, and mongos merges the results (scatter-gather). `insertOne` always targets one shard. Since 7.1, `updateOne` and `deleteOne` no longer need the shard key or `_id` in the filter; without either, mongos has to search every shard for the document.

A key can be changed later: `reshardCollection` (since 5.0) rewrites the collection under a new key, needs free storage of about twice the collection plus its indexes divided by the number of shards, blocks writes to the collection for about two seconds, and always takes at least five minutes. `refineCollectionShardKey` adds suffix fields instead, and since 8.0 resharding to the same key redistributes data onto new shards.

### Change streams

`watch()` opens a **change stream** on a collection, a database or the whole deployment. It reads the oplog for you, so an application can react to inserts, updates, replaces and deletes without tailing the oplog itself, and it accepts a pipeline to filter or reshape the events. Change streams report only changes committed to a majority of members, so an event never describes a write that a failover later rolls back. Each event's `_id` is a **resume token**: store it after processing and pass it to `resumeAfter` to continue where you stopped, as long as the oplog still holds that point. Since 6.0 events can carry the document's pre- and post-images. Change streams need a replica set or a sharded cluster (open them on `mongos`) and don't cover time series collections.

```js
const stream = db.products.watch(
  [{ $match: { operationType: { $in: ["insert", "update", "replace"] } } }],
  { fullDocument: "updateLookup" }
)
```

### Schema validation

A flexible schema is still a schema; it lives in the application unless the database checks it. A collection can carry a `$jsonSchema` validator:

```js
db.runCommand({
  collMod: "products",
  validator: { $jsonSchema: {
    bsonType: "object",
    required: ["sku", "title", "price"],
    properties: {
      sku: { bsonType: "string" },
      price: { bsonType: ["int", "double", "decimal"], minimum: 0 },
      tags: { bsonType: "array", items: { bsonType: "string" } }
    }
  } },
  validationLevel: "strict",
  validationAction: "error"
})
```

`validationLevel` is `strict` (the default: every insert and update is checked), `moderate` (updates to documents that were already invalid aren't checked, useful while migrating) or, new in 9.0, `constraint`, which guarantees that every document in the collection satisfies the rules and doesn't allow the rules to change while it is set. `validationAction` is `error` (the default), `warn` (accept and log) or `errorAndLog` (since 8.1).

### Storage, versions and licence

The **WiredTiger** storage engine uses document-level concurrency control for writes, compresses collections with snappy and indexes with prefix compression by default, and writes a checkpoint every 60 seconds, with a journal to replay what came after it.

**MongoDB 9.0** was released on 28 September 2026 and is supported until 31 October 2031; 8.0 (October 2024) is supported until 31 October 2029. Releases between the majors, such as 8.2 (September 2025) and 8.3 (May 2026), appear on the same lifecycle schedule for Atlas and Enterprise Advanced.

**Licence.** MongoDB Community Server releases since 16 October 2018 are licensed under the **Server Side Public License (SSPL)**; earlier releases stay under the GNU AGPL v3.0. The SSPL is based on the GPL v3 with a rewritten section 13: offering MongoDB to third parties as a service obliges you to publish the source of the whole service stack under the SSPL, while applications that merely use MongoDB as their database are unaffected. The OSI has not approved the SSPL, so it isn't an open-source licence in the OSI's sense. The official drivers are under the Apache License 2.0, Enterprise Advanced is sold under a commercial licence, and Atlas users don't run the server software themselves.

## Where it fits

- **Solutions.** Product catalogs and content management, where records of different shapes are read as a unit; user profiles and preferences; the operational database behind web and mobile back ends; and AI features that keep vector embeddings next to the documents they describe.
- **Patterns it implements or supports.** [Database per Service](../database-per-service/): the Catalog service owns the `catalog` database and nobody else reads it directly. [Change Data Capture](../change-data-capture/) through change streams, or into Kafka with the MongoDB Kafka Connector's source connector. [Materialized View](../materialized-view/) with `$merge`, or a change-stream consumer that maintains a read model. [Sharding](../sharding/) and [Read Replicas](../read-replicas/) are built in, and replica set elections are a form of [Leader Election](../leader-election/).
- **Usual neighbours.** Services using the official drivers; a search index fed by change streams, or MongoDB Search inside the cluster; [Kafka](../kafka/) through the connector; a cache such as [Redis](../redis/) in front of hot reads ([Cache-Aside](../cache-aside/)); a warehouse loaded from change streams for reporting.
- **Managed offerings.**
  - **MongoDB Atlas** runs MongoDB on AWS, Azure and Google Cloud. It has two editions: Atlas Core, where compute and storage share a node, and Atlas Infinite (public preview), which separates them. Atlas adds **MongoDB Search** (full-text search built on Apache Lucene, queried with `$search`) and **MongoDB Vector Search** (`$vectorSearch`, approximate or exact nearest-neighbour search, hybrid search, and Automated Embedding with Voyage AI models). Both run in a separate `mongot` process that stays in sync through change streams. Since June 2026 `mongot` is also generally available for self-managed Community and Enterprise Advanced deployments, after a public preview that began in October 2025.
  - **Amazon DocumentDB (with MongoDB compatibility)** is AWS's managed document database. It implements the MongoDB 3.6, 4.0, 5.0 and 8.0 APIs on a different, purpose-built engine: storage is replicated six ways across three Availability Zones, and up to 15 replicas share it, with replica lag usually under 100 ms. The developer guide lists functional differences: no `admin` or `local` database, retryable writes only from engine version 8.0.2 (disable them on earlier versions), vector search only through `$search` instead of `$vectorSearch`, and `explain()` output that differs from MongoDB's. Sharding uses elastic clusters, which shard on the hash of a single field and aren't available on DocumentDB 8.0. Test the application against it; don't assume full compatibility.

## When to use it

Choose MongoDB when each record is naturally a nested document that the application reads and writes as a whole, when its fields vary between records or change often, and when one product should give you replication with automatic failover now and sharding later, once a single replica set is no longer enough. Look elsewhere when the data is highly relational and queried ad hoc across many tables, when most changes span many records that must commit together, or when every access is a key lookup at very large scale.

| | MongoDB | [PostgreSQL](../postgresql/) with JSONB | [Amazon DynamoDB](../amazon-dynamodb/) | Apache Cassandra |
|---|---|---|---|---|
| Data model | BSON documents with nested fields and arrays, up to 16 MiB each | Rows in tables; `jsonb` columns hold the flexible part | Items of up to 400 KB, read by partition key (and sort key) | Rows in tables partitioned by a partition key (wide-column) |
| Querying the flexible part | Compound, multikey and wildcard indexes on nested paths; aggregation pipeline | GIN indexes on `jsonb` (`jsonb_ops`, `jsonb_path_ops`) next to SQL, joins and constraints | Key-based access; secondary indexes on attributes | CQL by partition key; secondary indexes |
| Transactions | Single-document atomic; multi-document ACID transactions | ACID transactions over any rows | `TransactWriteItems`: up to 100 actions, all or nothing | Conditional writes (`IF NOT EXISTS`), run through Paxos at extra cost |
| Scaling writes | Sharding by shard key across replica sets | One primary; shard with Citus or in the application | Automatic, by partition key | Every node takes writes; consistent hashing over a token ring |
| Consistency | Tunable with read and write concern; reads from the primary by default | Strong on the primary; replicas asynchronous by default | Eventually consistent reads by default, strongly consistent on request | Tunable per operation with consistency levels (`ONE`, `QUORUM`, `ALL` …) |
| Where it runs | Anywhere; Community under the SSPL; MongoDB Atlas; Amazon DocumentDB implements its API | Anywhere; PostgreSQL License; RDS and Aurora on AWS | AWS only | Anywhere; Apache License 2.0; Amazon Keyspaces is a compatible AWS service |

Figures and terms from the MongoDB 9.0, PostgreSQL 18, Amazon DynamoDB and Apache Cassandra 5.0 documentation, October 2026.

## Trade-offs

- **The schema moves into the application.** Nothing stops `colour` and `color` from coexisting until a validator or the code does. Use `$jsonSchema` validation and version the document shape.
- **Duplication is a design choice.** Embedding a brand's name in every product makes reads cheap and a brand rename a multi-document update. Decide per field which copy is the source of truth.
- **Joins are possible but second-class.** `$lookup` works within one database and depends on indexes, and ad-hoc relational reporting is easier in SQL. Feed a warehouse from change streams instead of reporting on the operational cluster.
- **Document size and growth.** 16 MiB per document, and unbounded arrays make documents and multikey indexes grow without limit.
- **Asynchronous replication.** Reads from secondaries can be stale, and writes acknowledged with `w: 1` can be rolled back after a failover. `w: "majority"`, the default, costs a round trip to a secondary on every write.
- **The shard key decides a lot.** A poor key creates hot shards or jumbo chunks that can't be split, queries without the key reach every shard, and resharding is a heavy operation.
- **Licence.** The SSPL restricts offering MongoDB itself as a service. Amazon DocumentDB implements the API but is a different engine with documented differences, so switching between them needs testing.

## Implementation notes

- **Run three data-bearing members**, in different failure domains such as Availability Zones, rather than two plus an arbiter: in a primary-secondary-arbiter set the default write concern drops to `w: 1`, and as a shard such a set can lose availability when one data-bearing member is down, because shards run some operations with `w: "majority"`.
- **Connect with the whole replica set** (`mongodb://m1,m2,m3/?replicaSet=rs0`, or a `mongodb+srv://` address) so the driver can find the new primary, and keep the defaults `retryWrites=true` and `w: "majority"`.
- **Design from the queries.** List the access patterns, embed what is read together, reference what grows without bound, and store money as `Decimal128`.
- **Index deliberately.** Follow the ESR guideline, confirm with `explain("executionStats")` that queries use an index, prefer partial indexes to sparse ones, and hide an index before dropping it to see what breaks.
- **Validate.** Add a `$jsonSchema` validator early, use `moderate` while migrating old documents, and consider `constraint` on 9.0 once the data is clean.
- **Size the oplog for your maintenance windows.** The oplog window is how long a secondary can be away and still catch up; `storage.oplogMinRetentionHours` keeps entries for a minimum time.
- **Choose the shard key from the query patterns** before sharding: high cardinality, even frequency, no steady increase. On 8.0 or later, shard a populated collection with `sh.shardAndDistributeCollection()` if the cluster has the resources, and watch the distribution with `sh.getShardedDataDistribution()`.
- **Consume change streams idempotently.** Save the resume token after each processed event and make consumers [idempotent](../idempotent-consumer/), because a restart can deliver an event again.
- **Keep transactions short.** Touch few documents, finish well within the one-minute default, and retry on transient errors.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Sharding](../sharding/) — Split data horizontally across databases using a shard key.
- [Read Replicas](../read-replicas/) — Send writes to the primary and spread reads across asynchronously updated replicas.
- [Database per Service](../database-per-service/) — Each service owns its data; others go through its API or events, never its tables.
- [Change Data Capture (CDC)](../change-data-capture/) — Stream every committed change from the database log to other systems.
- [Materialized View](../materialized-view/) — Precompute query-shaped views so reads don't pay for joins and aggregations.
- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [Amazon DynamoDB](../amazon-dynamodb/) — A serverless key-value and document database: the partition key spreads items across partitions for single-digit-millisecond reads.
- Apache Cassandra *(planned)* — A wide-column database built for heavy writes across data centres: a token ring, tunable consistency and LSM storage.

## References

- [MongoDB Database Manual (9.0) — Release Notes for MongoDB 9.0](https://www.mongodb.com/docs/manual/release-notes/9.0/)
- [MongoDB — Software Lifecycle Schedules](https://www.mongodb.com/legal/support-policy/lifecycles)
- [MongoDB Database Manual (9.0) — MongoDB Limits and Thresholds](https://www.mongodb.com/docs/manual/reference/limits/)
- [MongoDB Database Manual (9.0) — Data Modeling in MongoDB](https://www.mongodb.com/docs/manual/data-modeling/)
- [MongoDB Database Manual (9.0) — Group Data with the Attribute Pattern](https://www.mongodb.com/docs/manual/data-modeling/design-patterns/group-data/attribute-pattern/)
- [MongoDB Database Manual (9.0) — Index Types](https://www.mongodb.com/docs/manual/core/indexes/index-types/)
- [MongoDB Database Manual (9.0) — The ESR (Equality, Sort, Range) Guideline](https://www.mongodb.com/docs/manual/tutorial/equality-sort-range-guideline/)
- [MongoDB Database Manual (9.0) — Aggregation Operations](https://www.mongodb.com/docs/manual/aggregation/)
- [MongoDB Database Manual (9.0) — $lookup (aggregation stage)](https://www.mongodb.com/docs/manual/reference/operator/aggregation/lookup/)
- [MongoDB Database Manual (9.0) — Transactions](https://www.mongodb.com/docs/manual/core/transactions/)
- [MongoDB Database Manual (9.0) — Replica Set Oplog](https://www.mongodb.com/docs/manual/core/replica-set-oplog/)
- [MongoDB Database Manual (9.0) — Replica Set Elections](https://www.mongodb.com/docs/manual/core/replica-set-elections/)
- [MongoDB Database Manual (9.0) — Retryable Writes](https://www.mongodb.com/docs/manual/core/retryable-writes/)
- [MongoDB Database Manual (9.0) — Write Concern](https://www.mongodb.com/docs/manual/reference/write-concern/)
- [MongoDB Database Manual (9.0) — Read Preference](https://www.mongodb.com/docs/manual/core/read-preference/)
- [MongoDB Database Manual (9.0) — Causal Consistency and Read and Write Concerns](https://www.mongodb.com/docs/manual/core/causal-consistency-read-write-concerns/)
- [MongoDB Database Manual (9.0) — Sharding](https://www.mongodb.com/docs/manual/sharding/)
- [MongoDB Database Manual (9.0) — Choose a Shard Key](https://www.mongodb.com/docs/manual/core/sharding-choose-a-shard-key/)
- [MongoDB Database Manual (9.0) — Data Partitioning with Chunks](https://www.mongodb.com/docs/manual/core/sharding-data-partitioning/)
- [MongoDB Database Manual (9.0) — Routing with mongos](https://www.mongodb.com/docs/manual/core/sharded-cluster-query-router/)
- [MongoDB Database Manual (9.0) — Reshard a Collection](https://www.mongodb.com/docs/manual/core/sharding-reshard-a-collection/)
- [MongoDB Database Manual (9.0) — MongoDB Change Streams](https://www.mongodb.com/docs/manual/changestreams/)
- [MongoDB Database Manual (9.0) — Specify Validation Level for Existing Documents](https://www.mongodb.com/docs/manual/core/schema-validation/specify-validation-level/)
- [MongoDB — Server Side Public License FAQ](https://www.mongodb.com/legal/licensing/server-side-public-license/faq)
- [MongoDB Atlas documentation — MongoDB Atlas: Multi-Cloud Database Service](https://www.mongodb.com/docs/atlas/)
- [MongoDB docs — MongoDB Search and MongoDB Vector Search on Self-Managed Deployments](https://www.mongodb.com/docs/search/self-managed/current/)
- [Amazon DocumentDB Developer Guide — Functional differences: Amazon DocumentDB and MongoDB](https://docs.aws.amazon.com/documentdb/latest/devguide/functional-differences.html)
- [Amazon DocumentDB Developer Guide — Amazon DocumentDB: how it works](https://docs.aws.amazon.com/documentdb/latest/devguide/how-it-works.html)
- [PostgreSQL 18 documentation — JSON Types](https://www.postgresql.org/docs/current/datatype-json.html)
- [Apache Cassandra documentation — Dynamo (architecture)](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
