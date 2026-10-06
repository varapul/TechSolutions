<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🟧 AWS Services](../../README.md#aws-services)

# Amazon DynamoDB

> A serverless key-value and document database: the partition key spreads items across partitions for single-digit-millisecond reads.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Amazon DynamoDB" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/amazon-dynamodb.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | The shop's API Gateway invokes the **orders-api** Lambda function, which saves each order in the table **Orders** with `PutItem`. Every call is a signed HTTPS request, so there are no servers, versions or connection pools to manage, and in **on-demand** mode you pay per request. **DynamoDB Streams** passes every change to **order-views**, which keeps other views up to date; the table is designed around access patterns known in advance. |
| **2 · Partition and sort key** | The partition key `C-17` is hashed to pick partition **P2**, and inside it C-17's items are kept in order of the sort key `sk` (`orderDate#orderId`), so `2026-10-06#o-981` lands after `2026-10-02#o-967`. P2 is stored on **3 replicas in 3 Availability Zones**, and the write is acknowledged once 2 of them have it. A `Query` for `C-17` with `begins_with(sk, "2026-10")` reads one contiguous range of one partition; a `Scan` reads every item in the table. |
| **3 · Throughput and hot keys** | Each partition serves at most **3,000 read units and 1,000 write units per second**. In the flash sale every guest order is saved under `customerId = GUEST`, so 2,400 writes/s hash to P3, which throttles while P1 and P2 sit idle and the table as a whole has room. Adaptive capacity moves throughput to busy partitions but not past that ceiling; the fix is a key with many values (an id per guest) or **write sharding** (`GUEST#0` … `GUEST#9`). |
| **4 · Consistency and limits** | Reads are **eventually consistent** by default; `ConsistentRead=true` costs twice the read units, and global secondary indexes don't offer it. **byOrderId** is updated asynchronously, so a lookup right after `PutItem` misses `o-982` until the index catches up. Conditional writes give optimistic locking and a transaction covers up to 100 items, but an item is at most **400 KB**, queries must follow the keys you designed (export to S3 for analytics), and global tables settle conflicting writes with last writer wins unless you choose multi-Region strong consistency. |
<!-- END GENERATED: header -->

## The problem

An online shop's order service asks the same few questions all day: save this order, list this customer's orders, find order `o-981`. It has to answer them with the same latency at ten requests a second and during a flash sale. On a single relational server, capacity is a machine you size, patch and fail over, and every concurrent Lambda execution environment opens database connections of its own. Scaling out by sharding the database yourself adds routing, rebalancing and resharding code that has nothing to do with orders.

Amazon DynamoDB answers those questions as a service. There is no server or version to manage, every request is a signed HTTPS call, and a table spreads itself over partitions by key. The price is that you design the table around the questions before you write the first item.

## How it works

### Tables, items and keys

A **table** holds **items**, and an item is a set of **attributes**: strings, numbers, binary values, Booleans and null, plus lists, maps and sets nested up to 32 levels deep. Apart from the primary key there is no schema, so two items in one table can carry different attributes. An item, attribute names included, is at most **400 KB**.

The **primary key** is either a **partition key** alone or a partition key plus a **sort key**. The `Orders` table in the diagram uses these keys:

| Attribute | Role | Example |
|---|---|---|
| `customerId` | partition key of the table | `C-17` |
| `sk` | sort key, written as `orderDate#orderId` | `2026-10-06#o-981` |
| `orderId` | partition key of the global secondary index `byOrderId` | `o-981` |

DynamoDB feeds the partition key to an internal hash function, and the result picks the **partition** that stores the item. All the items with the same partition key form an **item collection**, kept in ascending sort-key order. That is why "C-17's orders in October 2026" is a single range read. A partition key value can be up to 2,048 bytes and a sort key value up to 1,024 bytes.

### Partitions, replicas and throughput

A partition is SSD storage that DynamoDB replicates across three Availability Zones and manages by itself. It adds partitions when a table grows or needs more throughput, and when a table has no local secondary index it can spread one large item collection over several partitions.

The 2022 USENIX ATC paper describes what happens inside. The replicas of each partition form a replication group that elects a leader with Multi-Paxos. The leader takes the writes and the strongly consistent reads: it appends each write to its log, sends it to its peers and acknowledges it once two of the three replicas, in different zones, have stored it. Any replica can serve an eventually consistent read.

Every partition is designed to deliver at most **3,000 read units and 1,000 write units per second**. One read unit is one strongly consistent read of up to 4 KB (or two eventually consistent ones), one write unit is one write of up to 1 KB, and larger items use more units: a strongly consistent read of a 20 KB item costs 5 read units.

### Reading: GetItem, Query and Scan

- `GetItem` fetches one item by its full primary key.
- `Query` needs the partition key as an equality condition and can narrow the sort key with `=`, `<`, `<=`, `>`, `>=`, `BETWEEN` or `begins_with`. Results come back in sort-key order, or in reverse with `ScanIndexForward=false`.
- `Scan` reads every item in a table or index.

`Query` and `Scan` return at most **1 MB per call**. When a response carries `LastEvaluatedKey`, send it back as `ExclusiveStartKey` to fetch the next page, and stop when a response has none; the SDK paginators do this for you. A `FilterExpression` only trims what is returned: the items it drops were still read and paid for.

```sh
# C-17's orders in October 2026, newest first (after step 2: o-981, then o-967)
aws dynamodb query \
  --table-name Orders \
  --key-condition-expression "customerId = :c AND begins_with(sk, :month)" \
  --expression-attribute-values '{":c": {"S": "C-17"}, ":month": {"S": "2026-10"}}' \
  --no-scan-index-forward
```

### Secondary indexes

- A **global secondary index** (GSI) such as `byOrderId` has its own partition key (and optionally its own sort key) and its own partitions. DynamoDB copies each table write into it **asynchronously**, normally within a fraction of a second, so reads from a GSI are always eventually consistent. You can add a GSI to an existing table, which DynamoDB then backfills; the default quota is 20 per table, and each index a write touches costs write units of its own. On a provisioned table, a GSI without enough write capacity throttles the writes to the table itself.
- A **local secondary index** (LSI) keeps the table's partition key and adds a different sort key. It has to be created with the table (at most 5 per table) and supports strongly consistent reads. In return it limits every item collection to 10 GB and stops DynamoDB from splitting an item collection across partitions.

### Read consistency

Reads are **eventually consistent** by default, so a read right after a successful write may not see it yet. With `ConsistentRead=true`, `GetItem`, `Query` and `Scan` on a table or an LSI return the latest committed value, for twice the read units. GSIs and streams have no strongly consistent reads.

### Conditional writes and transactions

A `ConditionExpression` makes `PutItem`, `UpdateItem` or `DeleteItem` apply only if the item still looks the way you expect; otherwise the call fails with `ConditionalCheckFailedException`, and it still uses write units. Two common uses:

- **Optimistic locking:** keep a `version` attribute and update only if it hasn't changed since you read the item.
- **Put if absent:** `attribute_not_exists(pk)` makes a second write of the same key fail, which is how idempotency records work.

```sh
# Mark o-981 as paid, but only if nobody changed it since we read version 1
aws dynamodb update-item \
  --table-name Orders \
  --key '{"customerId": {"S": "C-17"}, "sk": {"S": "2026-10-06#o-981"}}' \
  --update-expression "SET #st = :paid, version = :next" \
  --condition-expression "version = :seen" \
  --expression-attribute-names '{"#st": "status"}' \
  --expression-attribute-values '{":paid": {"S": "PAID"}, ":seen": {"N": "1"}, ":next": {"N": "2"}}'
```

`status` is a reserved word in DynamoDB expressions, hence the `#st` placeholder.

`TransactWriteItems` and `TransactGetItems` group up to **100 actions on 100 distinct items** (4 MB in total), across tables in one account and Region, all or nothing. DynamoDB reads or writes each item of a transaction twice, so transactions cost double, and a `ClientRequestToken` makes a `TransactWriteItems` call idempotent for 10 minutes.

### Capacity modes and pricing

| | On-demand (the default) | Provisioned |
|---|---|---|
| You set | nothing; optionally a maximum throughput per table or GSI | read and write capacity units per second, usually with auto scaling |
| You pay for | the read and write request units you use | capacity units per hour, used or not; reserved capacity lowers the hourly rate for a one- or three-year term |
| Scaling | a new table sustains up to 4,000 writes/s and 12,000 reads/s, and absorbs up to double its previous peak at once | auto scaling follows a target utilisation |

Both modes also bill storage per GB-month, with a cheaper Standard-Infrequent Access table class for tables where storage dominates, and optional extras such as backups, point-in-time recovery, stream reads, global-table replication and data transfer. Effective 1 November 2024, AWS cut on-demand throughput prices by 50% and the price of global tables by up to 67%, and has since presented on-demand as the default and recommended mode for most workloads. A table can switch from provisioned to on-demand up to four times in 24 hours, and back at any time. Before a planned peak such as a sale, **warm throughput** lets you pre-warm a table to a rate it can serve instantly. Prices differ by Region, so check the pricing page.

### Hot keys and adaptive capacity

Throughput is shared out by partition, so one busy key can be throttled while the table as a whole has room to spare. In the diagram every guest checkout writes `customerId = GUEST`: during the sale 2,400 writes/s hash to P3, which can take 1,000, and the writes above that are throttled with the reason `TableWriteKeyRangeThroughputExceeded`. The AWS SDKs retry throttled calls with exponential backoff, which smooths short bursts but can't lift a ceiling.

**Adaptive capacity** is always on, in both capacity modes, at no extra cost. It gives a hot partition more of the table's throughput, moves frequently accessed items apart so they don't share a partition, and can cut a busy item collection into sort-key ranges. It has limits: one partition, and so one item, still tops out at 3,000 reads and 1,000 writes per second; a collection whose writes follow the sort key in order (like `GUEST`'s dates) can't be split usefully; and on a table with an LSI each item collection stays in one partition. The fixes are in the key:

- Choose a partition key with many distinct values, so the traffic spreads over the partitions: a real id for every guest instead of `GUEST`.
- **Write sharding:** append a suffix, either random (`GUEST#0` … `GUEST#9`) or computed from something you look items up by (a hash of the order id), and read all the suffixes back with parallel queries.
- Use CloudWatch Contributor Insights to see the most accessed and most throttled items.

### Time to live

Enable TTL on a Number attribute that holds an expiry time in Unix epoch seconds. DynamoDB deletes expired items in the background, typically within a few days of the expiry time and without using write units; until then reads can still return them, so filter on the attribute. TTL deletions appear in DynamoDB Streams as service deletions, so a consumer can archive what expires.

### Change data capture: Streams or Kinesis

| | DynamoDB Streams | Kinesis Data Streams for DynamoDB |
|---|---|---|
| Retention | 24 hours | up to 1 year |
| Readers | up to 2 per shard | up to 5 per shard, or 20 with enhanced fan-out |
| Order and duplicates | each record appears exactly once, in order for each item | duplicates can appear; order by the record timestamp |
| Processing | Lambda, or the DynamoDB Streams Kinesis Adapter | Lambda, Managed Service for Apache Flink, Firehose, Glue streaming |

With a DynamoDB stream as its event source, Lambda polls the stream four times per second and invokes the function with a batch of records. If the function fails, Lambda retries the batch until it succeeds or the records expire, so the consumer has to be idempotent; a partial batch response stops records that already succeeded from being processed again.

### Global tables

A global table keeps a replica of the table in each of several Regions, and every replica takes writes.

- **Multi-Region eventual consistency (MREC)**, the default, replicates changes asynchronously, typically within a second. If the same item changes in two Regions at once, the change with the latest internal timestamp wins (last writer wins), and a transaction is atomic only in the Region where it ran.
- **Multi-Region strong consistency (MRSC)** copies every write synchronously to another Region before acknowledging it, so a strongly consistent read in any Region returns the latest version. It needs exactly three Regions (three replicas, or two replicas and a witness) from a list of supported Regions, and writes and strong reads pay the cross-Region round trip. A write to an item that another Region is modifying fails with `ReplicatedWriteConflictException` and can be retried, and MRSC tables don't support transactions, TTL or LSIs.

AWS offers a 99.999% availability SLA for global tables, against 99.99% for a table in one Region.

### Backups, export and caching

- **Backups:** on-demand backups, plus **point-in-time recovery** (PITR) to any second of the last 1 to 35 days, set with `RecoveryPeriodInDays`. A restore always creates a new table.
- **Export to S3:** a full or incremental export from the PITR data, in DynamoDB JSON or Amazon Ion, without using read capacity. Athena, Glue or EMR can then query it.
- **DAX** (DynamoDB Accelerator) is an in-memory cache in front of a table that answers eventually consistent reads in microseconds. It doesn't help code that needs strongly consistent reads.

### Single-table design

AWS's data-modelling guide offers two foundations. **Single-table design** stores several entity types in one table under generic key names (`pk = CUSTOMER#C-17` with `sk = PROFILE` or `sk = ORDER#2026-10-06#o-981`), so one `Query` returns a customer together with their orders, and there is one table to secure, monitor and scale. It costs a steep learning curve and shared settings: one backup policy, one encryption key, one table class, and one stream that carries every entity's changes. **Multiple-table design** is easier to read and evolve, and it is enough when entities are rarely fetched together. Either way, write the access patterns down before you choose the keys.

### From Dynamo (2007) to DynamoDB

The 2007 Dynamo paper described Amazon's internal key-value store for shopping carts, which each team ran for itself. Its design was leaderless and built to accept writes at all times: consistent hashing with virtual nodes, sloppy quorums with hinted handoff, vector clocks with conflicts reconciled on read, Merkle-tree anti-entropy and gossip-based membership.

DynamoDB, a public service since 2012, is a different system. The 2022 USENIX ATC paper explains that it combined Dynamo's incremental scalability and predictable performance with SimpleDB's managed operation, consistency and table model, and that apart from the name it kept little of Dynamo's architecture. It is a multi-tenant service with request routers, a metadata service that maps keys to partitions, a leader-based Multi-Paxos replication group for each partition, and global admission control that tracks each table's total consumption. Apache Cassandra stays much closer to the original Dynamo design: consistent hashing, gossip and tunable consistency, with last-write-wins timestamps instead of vector clocks.

## Where it fits

- **Solutions:** serverless web and mobile back ends (API Gateway, Lambda and DynamoDB, as in the diagram); shopping carts and user sessions that expire through TTL; idempotency records keyed by request id; metadata stores such as product catalogues, device registries or an index of objects kept in S3; and high-volume key-value lookups such as profiles, game state or feature settings.
- **Patterns in this catalog:** the data store of [Serverless](../serverless/) back ends built on [AWS Lambda](../aws-lambda/); [Sharding](../sharding/) done for you, routing each key the way a [Hash Table](../hash-table/) picks a bucket; [Change Data Capture](../change-data-capture/) through Streams, feeding a [Materialized View](../materialized-view/) such as order-views and the read side of [CQRS](../cqrs/); [Idempotent Consumer](../idempotent-consumer/) records written with conditional puts; and [Claim Check](../claim-check/) for payloads above 400 KB, stored in S3 with the key kept in the item.
- **Usual neighbours:** API Gateway, Lambda, Kinesis Data Streams, S3 and Athena (export), Amazon OpenSearch Service (a zero-ETL integration for search), DAX, IAM, KMS and CloudWatch.
- **Managed offerings:** DynamoDB is itself the managed service and runs only on AWS; DynamoDB local is a downloadable version for development and tests. If you need a portable API instead, AWS also runs Cassandra-compatible (Amazon Keyspaces) and MongoDB-compatible (Amazon DocumentDB) databases, and [PostgreSQL](../postgresql/) on Amazon RDS and Aurora.

## When to use it

Choose DynamoDB when:

- the access patterns are known and key-based (get by id, list by owner, latest N by time), and you want the same latency at any request rate;
- you build on Lambda and want a database without connections, servers or capacity planning;
- traffic is spiky or unknown (on-demand) or very large;
- you need writes in several Regions at once (global tables).

Look elsewhere when the queries are ad hoc or relational (joins, reports, flexible filters), when the application must run outside AWS, or when a single entity outgrows 400 KB and can't be split.

| | Amazon DynamoDB | Apache Cassandra | [MongoDB](../mongodb/) | PostgreSQL / Aurora |
|---|---|---|---|---|
| Data model | items under a partition key and an optional sort key | rows under a partition key and clustering columns (CQL) | JSON-like documents in collections | relational tables (SQL) |
| Queries | by key and sort-key range, plus secondary indexes; no joins | by partition key and clustering range; secondary indexes for other lookups | ad hoc queries, secondary indexes, aggregation pipeline | ad hoc SQL with joins and many index types |
| Consistency | eventual by default, strongly consistent reads on request; transactions of up to 100 items | tunable per request (`ONE`, `QUORUM`, `ALL` …); last write wins | one primary per replica set takes the writes; multi-document transactions | ACID transactions on the primary |
| Scaling | partitions added automatically; on-demand or provisioned throughput | add nodes to the ring | shard collections by a shard key | scale up, add read replicas (Aurora: up to 15, on storage copied across 3 AZs) |
| Runs as | a fully managed AWS service only | self-managed, or Amazon Keyspaces | self-managed, MongoDB Atlas, or Amazon DocumentDB (compatible) | self-managed, or Amazon RDS and Aurora |
| Licence (October 2026) | proprietary service | Apache License 2.0 | Server Side Public License v1, for releases since October 2018 | PostgreSQL License; Aurora is proprietary |

## Trade-offs

- **Access patterns come first.** Keys are designed for the questions you know; a new question means a new GSI (backfilled, with its own write cost) or reshaping the data.
- **No joins or ad hoc queries.** Analytics go to S3 through an export, or to a search or analytics service through a stream or a zero-ETL integration.
- **Per-partition ceilings.** A hot key throttles at 3,000 reads or 1,000 writes per second per partition, however much throughput the table has.
- **Consistency is a choice you pay for.** Reads are eventual by default, strong reads cost double and don't exist on GSIs, and MREC global tables settle conflicts with last writer wins.
- **Item size.** 400 KB per item; keep large payloads in S3.
- **Cost shape.** Every GSI adds write cost, and strongly consistent and transactional operations cost more. Since the November 2024 price cut AWS expects on-demand to cost less than provisioned for most workloads; price both for very steady, well-used tables.
- **Lock-in.** The API and its behaviour are AWS-specific; DynamoDB local helps with tests, not with portability.

## Implementation notes

- Write the access patterns down first, then choose the keys. Use generic attribute names (`pk`, `sk`) if several entity types will share one table.
- Keep `Scan` off request paths: use `Query`, follow `LastEvaluatedKey`, and project only the attributes each GSI needs.
- Make writes safe to retry: conditional puts for idempotency, a `version` attribute for optimistic locking, and a `ClientRequestToken` on transactions.
- Watch for throttling: alarm on throttled requests, read the `ThrottlingReasons` in exceptions, use Contributor Insights to find hot keys, and let the SDK retry with backoff.
- Turn on PITR for every table you can't rebuild, set TTL on carts, sessions and idempotency records, and choose the stream view type your consumers need (`NEW_IMAGE`, or `NEW_AND_OLD_IMAGES` to see what changed).
- Keep stream consumers idempotent: Lambda retries a failed batch until it succeeds or the records expire.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Sharding](../sharding/) — Split data horizontally across databases using a shard key.
- [Serverless (Functions)](../serverless/) — Functions start per event, scale out automatically and scale to zero when idle.
- [AWS Lambda](../aws-lambda/) — Functions as a service: code runs per event in managed execution environments that scale out with concurrency.
- [Change Data Capture (CDC)](../change-data-capture/) — Stream every committed change from the database log to other systems.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.
- Apache Cassandra *(planned)* — A wide-column database built for heavy writes across data centres: a token ring, tunable consistency and LSM storage.
- Amazon RDS & Aurora *(planned)* — Managed relational databases: backups, Multi-AZ failover and read replicas, and Aurora's storage shared across three zones.
- [Materialized View](../materialized-view/) — Precompute query-shaped views so reads don't pay for joins and aggregations.

## References

- [Amazon DynamoDB Developer Guide — Core components of Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html)
- [Amazon DynamoDB Developer Guide — Partitions and data distribution](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.Partitions.html)
- [Amazon DynamoDB Developer Guide — Best practices for designing and using partition keys effectively](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html)
- [Amazon DynamoDB Developer Guide — Burst and adaptive capacity](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/burst-adaptive-capacity.html)
- [Amazon DynamoDB Developer Guide — Read consistency](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html)
- [Amazon DynamoDB Developer Guide — Transactions: how it works](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html)
- [Amazon DynamoDB Developer Guide — How global tables work](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/V2globaltables_HowItWorks.html)
- [Amazon DynamoDB Developer Guide — Constraints](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html)
- [Amazon DynamoDB Developer Guide — Quotas](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ServiceQuotas.html)
- [Amazon DynamoDB Developer Guide — On-demand capacity mode](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/on-demand-capacity-mode.html)
- [Amazon DynamoDB Developer Guide — Diagnosing throttling](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/throttling-diagnosing-workflow.html)
- [Amazon DynamoDB Developer Guide — Change data capture with Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/streamsmain.html)
- [Amazon DynamoDB pricing](https://aws.amazon.com/dynamodb/pricing/)
- [AWS Database Blog — Amazon DynamoDB lowers pricing for on-demand throughput and global tables (November 2024)](https://aws.amazon.com/blogs/database/new-amazon-dynamodb-lowers-pricing-for-on-demand-throughput-and-global-tables/)
- [Elhemali et al. — Amazon DynamoDB: A Scalable, Predictably Performant, and Fully Managed NoSQL Database Service (USENIX ATC 2022)](https://www.usenix.org/conference/atc22/presentation/elhemali)
- [DeCandia et al. — Dynamo: Amazon's Highly Available Key-value Store (SOSP 2007)](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
