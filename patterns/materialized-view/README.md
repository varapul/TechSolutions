<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗄️ Data Management](../../README.md#data-management)

# Materialized View

> Precompute query-shaped views so reads don't pay for joins and aggregations.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Materialized View" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/materialized-view.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Same query, every time** | The dashboard asks one question: revenue per product. Against the source tables that is a join of `order_items` with `products` and an aggregation over every order line, and it runs again for every viewer, even when almost nothing has changed since the last run. It is slow (1.8 s here, an illustrative figure), and it competes with the transactions that write those same tables. |
| **2 · Precompute the answer** | A **materialized view** stores the result of that query in the shape the question needs: one row per product, complete for every product and computed before anyone asks. The dashboard now reads a few rows by key (5 ms here, also illustrative) and no longer touches the source tables. The view is **derived data**: it holds nothing that cannot be rebuilt from the source. |
| **3 · Keep it fresh** | An order for two Mugs commits in the source, and the view is **stale** until it is refreshed, which its as-of time shows. A **scheduled full refresh** re-runs the whole query every 15 minutes: simple, and stale for up to the interval. **Incremental maintenance** applies only the change (+2 units and +$40 on one row), driven by the stream of changes: fresher, at the price of more machinery. |
| **4 · Rebuild it, know the price** | The question changes to revenue per product *and region*, which the stored rows cannot answer. A new version of the view is built beside the old one from the source, readers switch once it is complete, and the old one is dropped. Every view has a price: storage, work on each write or refresh, answers that can be slightly behind and one more thing to operate, so materialize only queries that are both expensive and frequent. |
<!-- END GENERATED: header -->

## The problem

Normalised tables are shaped for writing. Every fact is stored once, so an order line knows its product only by id, and a question such as *revenue per product* has to be assembled at read time: join `order_items` to `products`, then aggregate every order line. The database repeats that work for every viewer of the dashboard, even when almost nothing has changed since the last one, and the work grows with the tables. On the system of record it also competes with the transactions that are writing those tables.

The usual first fixes leave the work in place. An index helps a query find a few rows; it does not make an aggregation over all of them cheap. A [read replica](../read-replicas/) moves the query to another server, where it costs just as much. When the same expensive answer is wanted again and again, what remains is to compute it before anyone asks.

## How it works

A **materialized view** is the stored result of a query, kept in the shape one question needs. It has three parts:

1. **A definition**: the query, here the dashboard's join and aggregation.
2. **Stored rows**: its result, here `sales_by_product` with one row per product. Readers fetch these rows by key and never write to them.
3. **Maintenance**: a process that brings the rows up to date after the source changes.

The view is *derived data*. It holds nothing that cannot be dropped and rebuilt from the source, which is why it can be reshaped, moved to another store or thrown away without losing anything.

### What it is not

- **An ordinary view** stores only the query text and runs it on every read. It saves typing, not work.
- **An index** is also derived data that the database keeps current on every write, but it only helps to find rows of one table. A materialized view stores the *result* of joins and aggregations, and can carry indexes of its own.
- **A cache** ([Cache-Aside](../cache-aside/)) is filled on demand, one key at a time, and its entries expire, so a read can miss and pay the full price. A materialized view is complete for every key, is built ahead of the read and is maintained instead of expired.
- **A read replica** ([Read Replicas](../read-replicas/)) is a full copy with the same schema. It adds capacity for the expensive query without making it cheaper.
- **A CQRS read model** ([CQRS](../cqrs/)) is the larger idea: a separate model for all of an application's reads, fed by its writes. A materialized view is one way to build one.

### Three ways to keep it current

| | How | How stale | What it costs |
|---|---|---|---|
| **Full refresh** | Re-run the query and replace the contents, on a schedule or on demand | Up to one interval, plus the time the refresh takes | A scan of the source every time, however little has changed |
| **Incremental maintenance** | Apply only the changes since the last refresh, read from a change log or a stream | Seconds, or the gap between two incremental runs | Work in proportion to the change, plus the machinery that captures every change and applies it exactly once. Not every query can be maintained this way |
| **Synchronous maintenance** | Update the view inside the transaction that changes the source rows | Not at all | Every write is slower, and writers that touch the same summary row queue behind each other |

In the diagram the new order adds one row to `order_items`. A full refresh at 09:15 would read every order line again to arrive at 14 Mugs and $280. Incremental maintenance gets there with one small write:

```sql
UPDATE sales_by_product SET units = units + 2, revenue = revenue + 40 WHERE product = 'Mug';
```

That statement also shows the difficulty: a change applied twice is counted twice, and a change that is lost is never counted. Incremental maintenance is cheap to run and harder to get right.

### Where the view lives

**Inside the database**, where the engine stores and maintains it:

- **PostgreSQL.** `CREATE MATERIALIZED VIEW` stores the result. It changes only when `REFRESH MATERIALIZED VIEW` runs, and a refresh recomputes and replaces the whole contents. A plain refresh locks out every read of the view until it finishes. `REFRESH MATERIALIZED VIEW CONCURRENTLY` lets readers carry on with the old contents, but it needs a unique index on plain columns that covers every row and a view that is already populated, and it is the slower choice when most rows change. Only one refresh of a view runs at a time. Incremental maintenance is not built in; the `pg_ivm` extension adds views that triggers update inside the writing transaction.
- **SQL Server.** An *indexed view* is a view with a unique clustered index: the result is stored like a table, and the engine updates it as part of every insert, update and delete on the base tables. It is never stale and every write pays, so Microsoft advises against it for data that is updated often. The definition is restricted: schema-bound and deterministic, with no outer joins, subqueries, `DISTINCT`, `MIN` or `MAX`, and with `COUNT_BIG(*)` whenever it groups.
- **Oracle Database.** A *fast refresh* applies only the changes that materialized view logs on the base tables have recorded, either on demand or as part of each commit (`REFRESH FAST ON COMMIT`, which makes the commit take longer). A *complete refresh* re-runs the query.
- **Cloud data warehouses** refresh for you, within limits. *BigQuery* refreshes a materialized view in the background (by default within 5 to 30 minutes of a change, and no more often than every 30 minutes) and, at query time, combines the stored rows with whatever has changed in the base table since, so the answer is current unless you allow staleness with `max_staleness`. That works only for a restricted subset of SQL; other definitions can be declared non-incremental and are then recomputed in full at each refresh. *Snowflake* maintains materialized views with a background service and always returns current results, but such a view can read only one table (no joins) and needs Enterprise Edition; its *dynamic tables* accept joins and are refreshed, incrementally or in full, to stay within a target lag you set. *Amazon Redshift* refreshes incrementally when the definition allows it and in full otherwise: outer joins, set operations, window functions and subqueries rule the incremental path out.

**In a separate store, maintained by your own code.** A consumer of [change data capture](../change-data-capture/) or of domain events ([Event-Driven Architecture](../event-driven-architecture/)) keeps a table, a document or a search index up to date. The view can live in whichever store suits the read and can combine several sources. In exchange you own the ordering, the retries, the backfill and the rebuild. Architecture guides usually mean this wider sense by the pattern's name: any read-only projection that a pipeline keeps, of which the database object is one implementation.

**In a stream processor.** Engines built for incremental view maintenance take the definition as SQL and update the result as each change arrives. Materialize keeps materialized views up to date incrementally and stores their results durably; in Apache Flink a continuous query over changing tables produces a result table that is updated continuously. The gold tables of a medallion architecture are close relatives: query-shaped, derived and rebuildable.

## When to use it

- **A query that is both expensive and frequent**, with a stable shape: dashboards, reports, leaderboards, counters, list screens with totals. Weigh the cost of the query times how often it runs against the cost of maintaining the view times how often the data changes.
- **Data that is read far more often than it changes**, by readers who can accept an answer that is slightly behind.
- **A read that combines data owned by several services.** Each service publishes its changes and the reader keeps its own joined copy, so no service queries another's tables: the rule behind [microservices](../microservices/) that keep a database per service.
- **A source that cannot answer the question without reading everything**, such as an event store ([Event Sourcing](../event-sourcing/)) or a key-value store.

It is the wrong tool for:

- **Ad hoc queries with no stable shape.** A view answers the question it was built for. Exploration belongs on a replica or in a warehouse.
- **Data that changes far more often than it is read.** The maintenance costs more than the reads it saves.
- **Answers that must be exactly current**, such as a balance checked before a payment. Read the source, or accept the write cost of synchronous maintenance.

## Trade-offs

- **Staleness.** A view that is refreshed or fed asynchronously lags the source by its refresh interval or its processing lag. Decide how much lag each reader can accept before choosing the maintenance, and show the as-of time next to the numbers.
- **Readers who expect to see their own write.** Someone who has just placed an order and opens the dashboard may not find it there. Send that read to the source, hold it until the view has applied the write's position (the technique described under [Read Replicas](../read-replicas/) and [CQRS](../cqrs/)), or show the user's own change optimistically.
- **Work on every write or refresh.** Synchronous maintenance slows each write. A full refresh puts a heavy scan on the source at every interval. Incremental maintenance does less work but needs change capture. Ten views multiply whichever you chose.
- **Storage** for every copy, and for the change logs that incremental maintenance reads.
- **One more thing to operate.** Refresh jobs fail and streams fall behind, and a view that has stopped refreshing still answers, with old numbers.
- **Restricted definitions.** Engines that maintain a view incrementally or synchronously accept only part of SQL; a definition outside it is refused or falls back to full refresh.
- **Views drift apart.** Two views refreshed at different moments can disagree with each other and with the source until both have caught up.

## Implementation notes

- **Start from the reader's query.** Store exactly the result it needs, keyed and indexed for its lookup. One view per question stays simple; a view that serves five screens becomes a second schema.
- **Choose what to materialize with numbers.** List the queries by total time (cost times frequency) and check how often their inputs change. A query that is slow but rare, or frequent but cheap, is usually better left alone.
- **Record the as-of time.** Store the time, or the source's log position, that the contents correspond to, and return it with the data. PostgreSQL's catalog does not record when a materialized view was last refreshed, so keep it yourself.
- **Do not block readers during a refresh.** Use the engine's non-blocking form, or build beside and switch as described next. In PostgreSQL:

  ```sql
  CREATE UNIQUE INDEX ON sales_by_product (product);        -- CONCURRENTLY needs it
  REFRESH MATERIALIZED VIEW CONCURRENTLY sales_by_product;
  ```

- **Rebuild beside, then switch.** For a new definition, or a view that has drifted from the source, build a new version under another name, check it, switch the readers in one step and drop the old version once the new one has served real reads. Inside one database the switch can be a rename of both versions in a single transaction, where DDL is transactional, or a plain view that readers query and that is repointed. Oracle's out-of-place refresh does the same inside the engine: it builds the new contents in outside tables and swaps them in.
- **Backfill an incremental view from a snapshot.** Load a consistent snapshot of the source, then apply the changes that came after the snapshot's position. The same procedure is the rebuild, so practise it.
- **Apply changes in order and exactly once.** Streams redeliver, and a delta applied twice is counted twice. Record the last applied position in the same transaction as the update and skip anything at or before it ([Idempotent Consumer](../idempotent-consumer/)). Handle updates and deletes as well as inserts: an aggregate has to subtract.
- **Let the optimizer use the view where it can.** Some engines rewrite a query on the base tables to read a matching view: Oracle's query rewrite, BigQuery's smart tuning, Redshift's automatic query rewriting, and SQL Server in the editions that match indexed views automatically (on Standard edition a query has to name the view with the `NOEXPAND` hint). In PostgreSQL only queries that name the view use it.
- **Monitor it like a pipeline.** Track the refresh duration against the interval (a refresh that takes longer than its interval never catches up), the view's age (now minus its as-of time, or the number of changes not yet applied) with an alert at the staleness readers were promised, and failed or skipped refreshes. Compare a sample of the view with the source from time to time.
- **Carry the source's rules along.** Access control and deletion requirements apply to the copy too: a row removed from the source for privacy reasons has to disappear from every view built on it.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [CQRS](../cqrs/) — Separate the write model (commands) from read models (queries), each optimised for its job.
- [Cache-Aside](../cache-aside/) — Read from the cache first; on a miss load from the database and populate the cache.
- [Read Replicas](../read-replicas/) — Send writes to the primary and spread reads across asynchronously updated replicas.
- [Change Data Capture (CDC)](../change-data-capture/) — Stream every committed change from the database log to other systems.
- [Event Sourcing](../event-sourcing/) — Store every change as an immutable event and rebuild state by replaying them.
- [Database per Service](../database-per-service/) — Each service owns its data; others go through its API or events, never its tables.
- [Medallion Architecture](../medallion-architecture/) — Bronze, silver, gold: raw data is refined in layers inside a lakehouse.
- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.

## Related components and services

- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [MongoDB](../mongodb/) — A document database: JSON-like documents with flexible schemas, replica sets for failover and sharding to scale out.
- [Apache Cassandra](../cassandra/) — A wide-column database built for heavy writes across data centres: a token ring, tunable consistency and LSM storage.
- [Elasticsearch & OpenSearch](../elasticsearch/) — Search engines built on inverted indexes: full-text queries ranked by relevance, and aggregations over sharded indexes.
- [Apache Flink](../flink/) — A stream processor: stateful operators over unbounded streams, with event time, windows and exactly-once checkpoints.
- [Amazon DynamoDB](../amazon-dynamodb/) — A serverless key-value and document database: the partition key spreads items across partitions for single-digit-millisecond reads.

## Related database topics

- [Covering Index](../covering-index/) — Answer a query from the index alone: include the columns it selects, so the table is never read, and the scan is index-only.
- [Query Execution Plans](../query-execution-plans/) — Read EXPLAIN the way the planner thinks: scans, joins, estimated against actual rows, and the statistics behind each choice.
- [Normalization & Denormalization](../normalization/) — Store each fact once to keep data consistent, then copy some on purpose where reads must be fast, and keep the copies in step.
- [Row vs Column Storage](../row-vs-column-storage/) — Store rows together for transactions or columns together for analytics, and why a column store scans and compresses so much faster.

## References

- [Azure Architecture Center — Materialized View pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/materialized-view)
- [PostgreSQL documentation — Materialized Views](https://www.postgresql.org/docs/current/rules-materializedviews.html)
- [PostgreSQL documentation — REFRESH MATERIALIZED VIEW](https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html)
- [pg_ivm — Incremental View Maintenance as a PostgreSQL extension (README)](https://github.com/sraoss/pg_ivm)
- [Microsoft Learn — Create indexed views (SQL Server)](https://learn.microsoft.com/en-us/sql/relational-databases/views/create-indexed-views)
- [Oracle AI Database 26ai Data Warehousing Guide — Refreshing Materialized Views](https://docs.oracle.com/en/database/oracle/oracle-database/26/dwhsg/refreshing-materialized-views.html)
- [Google Cloud — BigQuery: Introduction to materialized views](https://docs.cloud.google.com/bigquery/docs/materialized-views-intro)
- [Google Cloud — BigQuery: Manage materialized views (automatic refresh)](https://docs.cloud.google.com/bigquery/docs/materialized-views-manage)
- [Snowflake documentation — Working with Materialized Views](https://docs.snowflake.com/en/user-guide/views-materialized)
- [Snowflake documentation — Dynamic tables](https://docs.snowflake.com/en/user-guide/dynamic-tables/overview)
- [Amazon Redshift Database Developer Guide — Refreshing a materialized view](https://docs.aws.amazon.com/redshift/latest/dg/materialized-view-refresh.html)
- [Materialize documentation — CREATE MATERIALIZED VIEW](https://materialize.com/docs/sql/create-materialized-view/)
- [Apache Flink documentation — Dynamic Tables (continuous queries)](https://nightlies.apache.org/flink/flink-docs-stable/docs/concepts/sql-table-concepts/dynamic_tables/)
- [Ashish Gupta & Inderpal Singh Mumick — Maintenance of Materialized Views: Problems, Techniques, and Applications (IEEE Data Engineering Bulletin 18(2), June 1995; archived PDF of the issue)](https://web.archive.org/web/20240617204059/http://sites.computer.org/debull/95JUN-CD.pdf)
- [Martin Kleppmann — Turning the database inside-out with Apache Samza (Strange Loop 2014 talk)](https://martin.kleppmann.com/2015/03/04/turning-the-database-inside-out.html)
- [Martin Kleppmann & Chris Riccomini — Designing Data-Intensive Applications, 2nd Edition (O'Reilly, 2026)](https://martin.kleppmann.com/2026/03/24/designing-data-intensive-applications-2e.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
