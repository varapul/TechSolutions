<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗄️ Data Management](../../README.md#data-management)

# CQRS

> Separate the write model (commands) from read models (queries), each optimised for its job.

<p align="center"><img src="diagram.svg" alt="Animated diagram: CQRS" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/cqrs.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Commands change state** | The client sends a **command**, a business task such as `PlaceOrder`, not a generic update. The command handler checks the business rules against the **write model**, normalised tables that are the source of truth, and commits the change in one transaction. The client gets an acknowledgement: `201 Created` here. |
| **2 · Project to read models** | The commit is published as a **change event** (`OrderPlaced`, change #7), through a transactional outbox or change data capture. A **projector** consumes it and updates every **read model**: a summary table with one ready-made row per order, and a search index keyed by keyword. It then records its checkpoint so it can resume where it left off. |
| **3 · Queries hit the read side** | Queries never change state, so the query handler just reads the view that matches the screen: `SELECT * FROM order_summary WHERE customer_id = 7`, one table and no joins. Reads usually far outnumber writes, so the read side scales on its own, here to **three replicas**, while the write side stays small and consistent. |
| **4 · Eventual consistency** | The write commits at once, but the read model is updated asynchronously, so a query issued right after the command can return **stale data**, here `placed` instead of `cancelled`, until the projector catches up. Hide the lag where it matters: return the new state in the command's response, pass a **version token** so the read waits for change #8, or update the UI optimistically. |
<!-- END GENERATED: header -->

## The problem

One model usually does everything. The same `Order` entity, mapped onto the same normalised tables, validates a cancellation, renders the "My orders" screen, answers the search box and feeds the monthly report. Those jobs want different things:

- **Writes** want a normalised schema, where each fact is stored once, short transactions, and every business rule in one place, so the data stays correct.
- **Reads** want data already shaped for the screen: joined, aggregated and filtered, sometimes in a different engine altogether, such as a search index or a document store.
- **The load is lopsided.** Reads usually far outnumber writes (Greg Young's CQRS documents say often by two orders of magnitude or more), yet with one model they scale together and compete for the same locks. Each new screen adds another join, index or column to the transactional schema.

The compromise serves both sides badly: queries get slower and more complex, and the write model fills up with fields that only one screen needs.

## How it works

CQRS, Command Query Responsibility Segregation, splits that one model in two. Greg Young's CQRS documents trace it to Bertrand Meyer's command-query separation: CQRS keeps Meyer's definitions of commands and queries, but instead of separating them as methods on one object, it splits the object into two.

- **Commands** change state and carry intent: `PlaceOrder`, `CancelOrder`, not "set status to 3". A command handler loads the **write model**, checks the business rules (stock, credit limit, "not shipped yet") and commits in one transaction. It answers with an acknowledgement, perhaps with the new ID and a version, but not with query results.
- **Queries** never change state. Each one reads a **read model**, also called a view or projection, built for exactly that question: a summary table for "My orders", a search index for the search box. Query handlers hold no business rules, and most become a single-table `SELECT … WHERE key = ?`.
- **Projections** keep the read models current. Each committed change is published as an event (`OrderPlaced`, `OrderCancelled`) through a transactional outbox or change data capture, so a crash between the commit and the publish cannot lose it. A **projector** consumes the events in order, updates every read model, and records its **checkpoint**, the position of the last change it applied, so it can resume after a restart.

When the two sides share nothing but those events, each can pick the storage, schema and scale that suit it. In the diagram the write side is three normalised tables; the read side is a denormalised summary table with three replicas, plus a search index. Step 2 is the same hand-off that [event-driven architecture](../event-driven-architecture/) generalises: one change, any number of consumers.

### One store or several

CQRS does not require a second database. Martin Fowler notes that the two models "may share the same database, in which case the database acts as the communication between the two models".

| Option | What is separated | Read consistency | Good for |
|---|---|---|---|
| **One database, separate models** | Code and schema: commands write normalised tables, queries read views, materialised views or summary tables | Immediate if the summary is updated in the same transaction; otherwise as old as the last refresh | Getting the clarity of CQRS without running another store |
| **Primary plus read replicas** | Read capacity only; same schema | Behind by the replication lag | Read-heavy apps whose queries already fit the write schema |
| **Separate stores** | Schema, engine and scaling | Eventually consistent, through events | Different engines per side (relational writes, search or document reads) and very different scale |

The consistency trade-off arrives as soon as the read side stops being updated in the same transaction, even inside one database: a materialised view refreshed on a schedule (in PostgreSQL, `REFRESH MATERIALIZED VIEW CONCURRENTLY` refreshes without locking out readers) is stale between refreshes.

### With or without event sourcing

The diagram does not use event sourcing. The write model stores current state as rows, and the change events are derived from each commit.

- **Without event sourcing**, the write store keeps only the current state. Events are a by-product of commits and are not necessarily kept forever, so rebuilding a projection starts from a snapshot of the current state.
- **With event sourcing**, the event store *is* the write model and the single source of truth. Projections are simply consumers of the stream, so a new or corrected view is built by replaying the events from the beginning. Azure's guidance highlights this: views can be regenerated "by replaying historical events". The cost is a write model that is read through replays and snapshots.
- **Event sourcing practically requires CQRS**, because an append-only stream of events is hard to query directly; microservices.io calls CQRS "necessary in an event sourced architecture". The reverse does not hold.

## When to use it

CQRS pays off when the two sides genuinely differ:

- Reads and writes need different shapes or scale: read-heavy screens that would need joins and aggregations, full-text search, or a different storage engine on each side.
- The domain has rules worth isolating, for example behind a task-based UI or where many users edit the same data, while the screens are simple projections of it.
- One screen needs data owned by several services. A view database fed by their events replaces cross-service joins.
- You already use event sourcing, where queries need projections anyway.

It is overkill when:

- The domain is simple CRUD and one model serves the screens well. Azure lists simple domains and CRUD-style interfaces as cases where the pattern might not be suitable.
- Only part of the system has the problem. Fowler warns that "for most systems CQRS adds risky complexity" and that it belongs in specific bounded contexts, not across a whole system.
- The real problem is a slow report or a hot read path. A reporting database, read replicas or a cache ([cache-aside](../cache-aside/)) is far cheaper.

## Trade-offs

- **Eventual consistency.** With asynchronous projection the read side lags behind the write side, so users can fail to see their own change (step 4). Werner Vogels calls the guarantee they expect *read-your-writes consistency*. Provide it where it matters:
  - *Return the new state from the command.* The response carries what the client needs to render (the cancelled order, the new total), so it doesn't have to query straight away.
  - *Pass a version token.* The acknowledgement includes the change's position (#8 in the diagram). The client sends it with its next query, and the query side waits, with a short timeout, until its checkpoint has reached that position, or answers that one request from the write side. Azure Cosmos DB's session tokens apply the same idea inside a database, as a "minimum version barrier".
  - *Update the UI optimistically.* Show the expected result at once ("cancelled"), reconcile when the read model catches up, and roll back if the command failed. React's `useOptimistic` hook is one implementation.
  - Or design for it: a screen that says "cancellation requested" is honest, and often enough.
- **More moving parts.** An outbox relay or CDC connector, a broker, projectors and extra stores: each one to deploy, secure, monitor and pay for.
- **Delivery semantics.** Most pipelines deliver at least once and preserve order only per key or partition. Make projectors idempotent: store the last applied position or version with each view row and skip anything older.
- **Invariants live on the write side.** Don't rely on an eventually consistent read model to enforce a rule ("is this email taken?"); two commands can both pass the check before either one is projected. Enforce it in the write store, with a unique constraint or inside one aggregate.
- **Events become contracts.** Every read model depends on the event schemas. Version them and prefer additive changes.
- **Harder debugging.** A wrong screen can come from the command, the event, the projector or plain lag. Put correlation IDs on commands and on the events they cause.

## Implementation notes

- **Rebuilding projections.** Read models are disposable, and you will rebuild them: after a projector bug, for a new column, or for a whole new view.
  - Build the new version side by side, in a new table or index, while the old one keeps serving queries.
  - Feed it from the start of history: replay the event store (with event sourcing), re-read a compacted change topic (Kafka's log compaction retains at least the last value for each key), or take a fresh snapshot of the write store (Debezium's incremental snapshots read tables in chunks while streaming continues).
  - Once it has caught up with the live stream, switch reads over in one step, for example with a table rename or an atomic index-alias swap in Elasticsearch or OpenSearch, then drop the old version.
  - Keep projectors deterministic and free of side effects, so a replay rebuilds the view without sending any emails again.
- **Monitoring projection lag.** Measure it in two units and alert on both:
  - *Changes behind:* the write side's latest position minus the projector's checkpoint. Kafka reports this as consumer-group lag (`kafka-consumer-groups.sh --describe` prints a `LAG` column per partition); Azure Cosmos DB's change feed estimator reports how many changes are still pending.
  - *Time behind:* now minus the commit time of the last change applied. Debezium exposes this for its own leg as `MilliSecondsBehindSource`; the end-to-end figure also includes the broker, the projector and any replication to read replicas.
  - A heartbeat row that the write side updates every few seconds keeps the signal alive when traffic is quiet. A checkpoint that stops moving while changes keep arriving is the alert that matters most.
- **Commands over HTTP.** Map commands to `POST` on task-oriented resources (`/orders/1042/cancel`). Return `201 Created` or `200 OK` when the write commits synchronously, or `202 Accepted` with a status URL when commands are queued (asynchronous request-reply). Strict command-query separation says commands return nothing; returning an ID and a version is harmless and makes read-your-writes possible.
- **Managed building blocks.** AWS describes DynamoDB on the write side, with a DynamoDB stream feeding a Lambda function that updates an Aurora read model. Azure Cosmos DB's change feed can maintain materialised views, search indexes and caches. Self-managed stacks often pair Debezium and Kafka with Elasticsearch, OpenSearch or a document store.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- Event Sourcing *(planned)* — Store every change as an immutable event and rebuild state by replaying them.
- Materialized View *(planned)* — Precompute query-shaped views so reads don't pay for joins and aggregations.
- Change Data Capture (CDC) *(planned)* — Stream every committed change from the database log to other systems.
- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.
- Read Replicas *(planned)* — Send writes to the primary and spread reads across asynchronously updated replicas.
- [Cache-Aside](../cache-aside/) — Read from the cache first; on a miss load from the database and populate the cache.
- [Transactional Outbox](../transactional-outbox/) — Save the event in the same database transaction as the data, then relay it: no dual-write gap.

## References

- [Martin Fowler — CQRS](https://martinfowler.com/bliki/CQRS.html)
- [Greg Young — CQRS Documents (2010, PDF)](https://cqrs.wordpress.com/wp-content/uploads/2010/11/cqrs_documents.pdf)
- [Azure Architecture Center — CQRS pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)
- [microservices.io — Pattern: Command Query Responsibility Segregation (CQRS)](https://microservices.io/patterns/data/cqrs.html)
- [Udi Dahan — Clarified CQRS](https://udidahan.com/2009/12/09/clarified-cqrs/)
- [AWS Prescriptive Guidance — CQRS pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-data-persistence/cqrs-pattern.html)
- [Werner Vogels — Eventually Consistent, Revisited](https://www.allthingsdistributed.com/2008/12/eventually_consistent.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
