<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗄️ Data Management](../../README.md#data-management)

# Medallion Architecture

> Bronze, silver, gold: raw data is refined in layers inside a lakehouse.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Medallion Architecture" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/medallion-architecture.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Bronze: land as-is** | Change events from the orders database, the clickstream and a partner's daily CSV file are **appended unchanged** to bronze tables, together with ingestion metadata (source, load time, batch ID). Today that is 1,000 order records, **12 duplicates and 3 malformed records included**: bronze fixes nothing and throws nothing away, so it is the complete, replayable history of what the sources sent. |
| **2 · Silver: clean and conform** | A silver job reads **only the new bronze records**, parses and types the fields, removes the 12 duplicates by order ID, converts country names to ISO codes and amounts to one currency, and joins customer data. The 3 malformed records move to a **quarantine table** with the reason, so silver holds **985 validated records** (1,000 − 12 − 3): the trusted, record-level view that many uses share. |
| **3 · Gold: shape for use** | A gold job aggregates and models silver into **business-level tables** for each audience: daily revenue by region for the BI dashboard, a customer features table for the ML model and a product summary (from the clickstream) for the data API. Gold tables are named in business terms, optimised for reading and governed per audience. |
| **4 · Fix and replay** | A bug is found in the currency conversion. The silver job is fixed and **replayed from bronze**, which still holds every raw record. **Lineage** shows that only the orders path is affected (two gold tables, the dashboard and the model), and the table format's **time travel** lets the team compare the old and new versions. Day to day, every hop processes only new data, by streaming or incremental merges. |
<!-- END GENERATED: header -->

## The problem

Analytics data arrives from many places: change events from operational databases, clickstreams, files that partners drop once a day. If every report and model reads those feeds directly, each team writes its own parsing, deduplication and business rules, and their numbers disagree. If the data is cleaned on the way in and only the cleaned copy is kept, each rule is applied once and for good: when a transformation turns out to be wrong (a bad exchange rate, a parser that mangles dates), the original records are gone and the history can't be rebuilt. Rejected records vanish without a trace, and nobody can say which dashboards were built from which inputs.

## How it works

The medallion architecture, sometimes called a *multi-hop* architecture, organises a lakehouse into layers of increasing quality. Each hop is a job that reads one layer and writes the next, and each layer makes one promise:

| Layer | Holds | Promises | Read by |
|---|---|---|---|
| **Bronze** (raw) | Every record exactly as the source sent it, appended, plus ingestion metadata | A complete, replayable history: nothing fixed, nothing removed | The pipelines that build silver; engineers and auditors |
| **Silver** (validated) | Typed, deduplicated, conformed records; rejects set aside in quarantine | At least one validated, non-aggregated version of every record | Engineers, analysts, data scientists |
| **Gold** (business-ready) | Aggregates, dimensional models and feature tables, named in business terms | Shaped and governed for one audience, fast to read | Dashboards, ML models, applications |

- **Bronze** keeps each source's data in its original form and only grows. [Databricks](https://docs.databricks.com/aws/en/lakehouse/medallion) recommends minimal validation here, with most fields stored as strings, `VARIANT` or binary so that an unexpected schema change can't lose data, and treats bronze as input for pipelines rather than something analysts query. [Microsoft Fabric](https://learn.microsoft.com/en-us/fabric/onelake/onelake-medallion-lakehouse-architecture) also keeps bronze in the source's format where possible, and suggests a *shortcut* instead of a copy when the files already sit in OneLake, ADLS Gen2, Amazon S3 or Google Cloud Storage.
- **Silver** is where records are cleaned and conformed: schema enforcement, type casting, handling of nulls, deduplication, late and out-of-order records, quality checks and joins. Databricks advises against loading silver straight from the sources, because then a schema change or a corrupt record breaks the load instead of simply landing in bronze.
- **Gold** holds the data products: dimensional models, aggregates and feature tables for specific consumers. Because gold mirrors business domains, some organisations run several gold layers, for example one each for finance, HR and IT.

All three layers live in one **lakehouse**: tables kept as open files (usually Parquet) in object storage, with an **open table format** such as Delta Lake, Apache Iceberg or Apache Hudi keeping a transaction log beside them. That log is what makes the hops safe. Commits are atomic, so a reader never sees half of a job's output. Writes are checked against the table's schema: Delta Lake rejects a write whose columns or types don't match, and adds new columns only when you allow the schema to evolve. And every commit creates a new table version, so in Delta Lake and Iceberg you can query a table as it was at an earlier version (*time travel*). Armbrust, Ghodsi, Xin and Zaharia argued for this design, warehouse-style management on cheap open storage, in the [CIDR 2021 paper](https://www.cidrdb.org/cidr2021/papers/cidr2021_paper17.pdf) that set out the lakehouse architecture.

## When to use it

- Several sources (database change feeds, event streams, partner files) feed several kinds of consumer: BI, machine learning, data APIs.
- You must be able to rebuild derived data after a bug or a rule change, or to show later exactly what a source sent.
- Batch and streaming data meet on one platform, and different teams own different stages.

When **not** to use it:

- Small data that fits comfortably in one database: a few views over the raw tables are enough.
- A single warehouse where staged models already separate raw, cleaned and business-ready data. dbt's layering (below) is the same idea without a lake.
- Serving an application's own screens with low latency. That's a read model inside the application (see [CQRS](../cqrs/)), not an analytics pipeline.

## Trade-offs

- **Copies and hops cost money.** The same records are stored in bronze, in silver and often again in gold, and every hop is a job to run, monitor and pay for.
- **Every hop adds latency**, unless the hops run as streams.
- **The names are a convention, not a guarantee.** "Silver" means whatever your checks enforce. Without explicit expectations and owners, the layers drift into three copies of the same mess.
- **Personal data multiplies.** Each copy falls under the same retention rules and deletion requests (see *Governance* below).
- **It's a recommendation, not a law.** Databricks calls the pattern a best practice but not a requirement; pushing every dataset through three layers by rule can be pure ceremony.

## Implementation notes

**Ingestion**

- Land batch files, streams and [change data capture](../change-data-capture/) feeds in bronze, and record the source, load time and batch or file name with every row.
- Make loads **idempotent and replayable**, in the spirit of an [idempotent consumer](../idempotent-consumer/): a retried batch must not append the same rows twice. Delta Lake, for instance, ignores a write that repeats an application ID and transaction version it has already committed.
- Expect **late and out-of-order data**. Resolve it in silver (merge by key, event-time windows), never by editing bronze.

**Data quality**

- Declare checks as **expectations**. In Databricks' [Lakeflow pipelines](https://docs.databricks.com/aws/en/ldp/expectations) (formerly Delta Live Tables) each expectation either keeps and counts the bad records, drops them or fails the update. Fabric's materialized lake views carry data quality rules too.
- Route rejects to a **quarantine table** with the reason and batch ID instead of dropping them. It is the [dead-letter queue](../dead-letter-queue/) of a data pipeline, and someone must own reviewing and replaying it.
- Agree **data contracts** with source teams (schema, meaning, freshness), so that a breaking change is caught at the boundary and not in a dashboard.

**Deduplication, merges and history**

- Deduplicate by business key with a merge: [Delta Lake's documentation](https://docs.delta.io/delta-update/) shows an insert-only `MERGE` that skips records already in the table.
- Apply CDC feeds to silver as upserts and deletes, again with `MERGE`.
- Keep history where consumers need it. A type 2 slowly changing dimension keeps every version of, say, a customer's address with the dates it was valid, and is written with `MERGE` as well.

**Modelling gold**

- Star schemas (facts and dimensions) for BI, pre-aggregated tables for hot queries (often a [materialized view](../materialized-view/)), and feature tables with one row per entity for ML.
- Document each table's grain ("one row per region per day") and name it in business terms.

**Incremental processing and backfills**

- Day to day, move only what's new: streaming reads from append-only bronze tables, Delta Lake's [change data feed](https://docs.delta.io/delta-change-data-feed/) (row-level changes between table versions) or Iceberg's incremental reads of the data appended between two snapshots.
- A backfill is a replay. Fix the job, rebuild the affected silver and gold tables from bronze, and compare the old and new versions with time travel before consumers switch over.

**Governance**

- Register every table in a **catalog** and capture **lineage**. [Unity Catalog](https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-lineage), for example, records lineage automatically down to the column level, and Fabric shows lineage across layers for materialized lake views. With lineage, "what did this bug touch?" becomes a lookup instead of an investigation.
- Grant **access per layer**: bronze to pipelines and engineers, silver to analysts and data scientists, gold per audience. Microsoft recommends a separate Fabric workspace for each layer for this reason.
- **Personal data**: mask or tokenise it in silver and gold. A deletion request has to reach bronze too, and deleted rows survive in older table versions until those are cleaned up: Delta Lake removes old data files only when [`VACUUM`](https://docs.delta.io/delta-batch/) runs (by default it keeps files deleted in the last seven days), and Iceberg when [snapshots are expired](https://iceberg.apache.org/docs/latest/maintenance/).

**Cost**

- Three layers can mean three copies. Keep bronze compressed, and retain it for as long as you may need to replay, not forever by default.
- Compact the small files that streaming hops produce (Delta Lake's `OPTIMIZE`, Iceberg's `rewriteDataFiles`) and expire old versions on a schedule. Fabric notes that small files are acceptable in bronze, while gold, where most queries run, benefits from larger ones.

**Variations**

- More or fewer layers: a landing zone before bronze, several gold layers for different domains, or silver and gold merged for a small dataset.
- The same idea in a warehouse: [dbt](https://docs.getdbt.com/best-practices/how-we-structure/1-guide-overview) structures projects as *staging* (cleaned-up building blocks made straight from the sources), *intermediate* (purpose-built transformation steps) and *marts* (the business entities that consumers query).

**How it relates to other patterns**

- A gold aggregate is often a [materialized view](../materialized-view/); the medallion architecture is the layered pipeline around such tables.
- [CQRS](../cqrs/) read models answer one application's queries; gold tables serve analytics for many teams.
- [Event sourcing](../event-sourcing/) keeps an application's events as its source of truth and rebuilds state by replaying them; bronze plays the same role for analytics.
- Each hop is a filter in a pipes and filters pipeline whose pipes are durable tables.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Change Data Capture (CDC)](../change-data-capture/) — Stream every committed change from the database log to other systems.
- [Materialized View](../materialized-view/) — Precompute query-shaped views so reads don't pay for joins and aggregations.
- [CQRS](../cqrs/) — Separate the write model (commands) from read models (queries), each optimised for its job.
- [Event Sourcing](../event-sourcing/) — Store every change as an immutable event and rebuild state by replaying them.
- Pipes and Filters *(planned)* — Split processing into independent stages connected by channels.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.
- [Dead-Letter Queue](../dead-letter-queue/) — Park messages that keep failing so they stop blocking the queue and can be inspected.

## References

- [Databricks — What is the medallion lakehouse architecture?](https://docs.databricks.com/aws/en/lakehouse/medallion)
- [Microsoft Learn — Implement medallion lakehouse architecture in Fabric](https://learn.microsoft.com/en-us/fabric/onelake/onelake-medallion-lakehouse-architecture)
- [Armbrust, Ghodsi, Xin, Zaharia — Lakehouse: A New Generation of Open Platforms that Unify Data Warehousing and Advanced Analytics (CIDR 2021)](https://www.cidrdb.org/cidr2021/papers/cidr2021_paper17.pdf)
- [Delta Lake — Table deletes, updates, and merges](https://docs.delta.io/delta-update/)
- [Delta Lake — Table batch reads and writes (time travel and data retention)](https://docs.delta.io/delta-batch/)
- [Apache Iceberg — Introduction](https://iceberg.apache.org/docs/latest/)
- [Databricks — Manage data quality with pipeline expectations](https://docs.databricks.com/aws/en/ldp/expectations)
- [dbt — How we structure our dbt projects](https://docs.getdbt.com/best-practices/how-we-structure/1-guide-overview)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
