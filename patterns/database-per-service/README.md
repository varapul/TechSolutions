<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗄️ Data Management](../../README.md#data-management)

# Database per Service

> Each service owns its data; others go through its API or events, never its tables.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Database per Service" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/database-per-service.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One shared database** | Orders, Customers and Payments all read and write the same tables. Payments renames a column and an Orders query breaks; a heavy report run by Customers slows down Orders' writes; and because nobody knows which service uses which table, nobody can change one safely. The services are independent only in name. |
| **2 · Each service owns its data** | Every service gets a **private store** that only it can reach: no other service has credentials for it, so the others ask through its API or listen to its events. The red lines are the direct table access being cut. *Private* is about ownership, not hardware: a schema with its own credentials, a database of its own or a server of its own all qualify, and each service can pick the kind of store that suits it (**polyglot persistence**: a document store for Customers here). |
| **3 · Cross-service queries** | The order screen needs the customer's name and the payment status, and no join can span two databases. **API composition**: Orders calls Customers and Payments and joins the answers itself; simple, but the screen waits for the slowest call, and a slow or failing service holds it up. **Local read model**: Orders keeps a read-only copy of the few customer fields it needs, updated from Customers' events; fast and independent, but eventually consistent. |
| **4 · Cross-service transactions** | Placing an order must also charge the card, and no transaction spans the three stores. Each service commits locally and records its event in the same commit (a [transactional outbox](../transactional-outbox/)), and a saga carries the business transaction from service to service, by [choreography](../saga-choreography/) here or with an [orchestrator](../saga-orchestration/). The card is declined, so Orders runs a **compensating transaction** and cancels the order. |
<!-- END GENERATED: header -->

## The problem

When several services share one database, they are coupled through its schema. Every table becomes a public interface, and nobody keeps a list of who depends on it. Martin Fowler calls this an *integration database*, and notes that most architects he respects advise against it. In practice:

- **Every change needs a meeting.** Renaming a column, splitting a table or changing a type can break a query in another team's code. Schema changes have to be coordinated across teams, and deployments slide back into lockstep.
- **The services share their failures.** A heavy report or a long transaction in one service competes with every other service's writes for the same CPU, I/O, locks and connections. A bad migration or a database outage takes all of them down at once.
- **Nobody owns the data.** With no record of which service reads which table, nobody can change or clean up a table safely, and the business rules for the same data end up spread over several codebases.
- **One engine has to fit every job.** A customer profile, a payment ledger and a session store all live in the same kind of database, whether it suits them or not.

The result is sometimes called a distributed monolith: services that deploy separately but still have to change together.

## How it works

**Each service owns its data.** Only the owning service reads and writes its tables. Every other service asks through the owner's API, or listens to the events the owner publishes when its data changes. A local transaction only ever touches the owner's store.

That buys back what the shared database took away:

- **Independent change.** A service can rename a column, restructure its tables or migrate to another engine without asking anyone, as long as its API and events stay compatible.
- **Independent scaling.** Each store is sized, replicated or sharded for its own service's load.
- **Failure isolation.** A runaway query or an outage in one store stays inside one service.
- **A free choice of store.** Each service picks the kind of store that fits its data: a document store for customer profiles, a relational database for a payment ledger, a key-value store for sessions. Fowler calls this *polyglot persistence*. Every extra technology is one more to learn, secure and operate, so use the freedom when it pays off.

Private means owned, not necessarily on separate hardware. The usual levels of separation, from cheapest to most isolated:

| Level | What each service gets | Isolation and cost |
|---|---|---|
| Private tables | Its own tables in a shared schema, granted only to its own database user | The cheapest. The boundary is nothing more than a set of grants, which is easy to get wrong, and the services still compete for one server |
| Schema per service | Its own schema and database role; no other role is granted access | Cheap, with a clear boundary. Still one server's CPU, memory, I/O, version and maintenance window for everyone |
| Database per service | Its own database on a shared server | A PostgreSQL connection sees only one database, so cross-service joins need an extension such as `postgres_fdw` and can't happen by accident. Still one server to overload or lose |
| Server per service | Its own database server or managed instance | Independent scaling, failures, upgrades and engine choice. The most to run and pay for |

In MySQL a schema *is* a database (`CREATE SCHEMA` is a synonym for `CREATE DATABASE`), so the middle two levels are the same thing there. Chris Richardson points out that private tables and a schema per service have the lowest overhead, and the Azure guidance notes that services can safely share a physical server: the trouble starts when they share a schema or the same tables.

## When to use it

- Services owned by different teams that need to deploy, scale and fail independently. The promise of [microservices](../microservices/) rests on it: services that share tables can't change independently.
- Services with genuinely different storage needs: data model, scale, availability, or (as the AWS guidance lists) different compliance and security requirements.
- **Not** for one team shipping one deployable. A [modular monolith](../modular-monolith/) with a schema per module, and grants that keep each module out of the others' schemas, gets clear ownership while keeping local ACID transactions, joins and a single database to run. Give a module its own store when it actually becomes a separate service.
- **Not** when two services can't do anything without each other's data in the same transaction. That usually means the boundary is in the wrong place and the two belong together.

## Trade-offs

- **Queries that span services.** There is no join across stores. *API composition* (in the caller, an [API gateway](../api-gateway/) or a [backend for frontend](../backends-for-frontends/)) is simple, but the answer waits for the slowest call, it degrades or fails when one service is down, and joining large result sets in memory is inefficient. *Read models fed by events* ([CQRS](../cqrs/), [materialized views](../materialized-view/)) are fast and keep working when the source is down, at the price of eventual consistency and more moving parts. Reporting and analytics belong in a separate store fed by [change data capture](../change-data-capture/) or by events, not in ad-hoc queries against every service's database.
- **Duplicated data.** Copies are normal, as long as every fact has exactly one source of truth: the owning service. A copy is read-only, eventually consistent and limited to the fields its service needs. If a service starts writing to its copy, there are suddenly two sources of truth.
- **No foreign keys across services.** Keep the other service's ID, not a constraint. The database can no longer stop an order from pointing at a deleted customer, so react to the owner's events (such as `CustomerDeleted`) and decide what a dangling ID means: hide it, anonymise it, or keep it for history.
- **No distributed transaction.** Two-phase commit across the stores is usually not an option: many NoSQL databases and message brokers don't support it, and it ties the availability of every participant together. A business transaction becomes a saga: a chain of local transactions linked by events ([choreography](../saga-choreography/)) or driven by an [orchestrator](../saga-orchestration/). When a step fails, the steps that already committed are undone by [compensating transactions](../compensating-transaction/), such as a refund or a cancellation. These are new business operations, not rollbacks, and a saga has no isolation: other requests can see its intermediate states (an order that is still `PENDING`), so the design has to allow for them.
- **Operating cost.** There are more stores to provision, patch, back up, restore-test, monitor, secure and pay for. Backups are no longer consistent with each other either: restore one store to last night and the others may point at data it no longer has.

## Implementation notes

- **Enforce ownership in the database, not just by convention.** Give every service its own database user or role and keep its credentials in that service's own secrets; never share an admin or application account between services. In PostgreSQL a role can't use objects in a schema it doesn't own unless the owner grants `USAGE` on it, and since PostgreSQL 15 ordinary roles can no longer create objects in the `public` schema of a new database by default. In the cloud, scope each service's identity (an IAM role, a managed identity) to its own store, and let network rules admit only the owner's workloads.
- **Back it with reviews and tooling.** Reject changes that add another service's connection string or table names. Before moving a table, check audit logs or query statistics to find out who still reads it.
- **Moving away from a shared database.** First decide which service owns each table, and split tables that mix two owners. Then route the other services through the owner's API or events while the data still lives in the shared database. Only then move the data into the owner's private store, one table at a time: route callers over gradually ([strangler fig](../strangler-fig/)), change schemas in backward-compatible steps ([expand and contract](../expand-and-contract/)), and keep the old and new copies in sync with [change data capture](../change-data-capture/) until every reader and writer has switched. Finally revoke the old grants and drop the old tables. Sam Newman's *Monolith to Microservices* covers these moves in depth.
- **Publish events reliably.** Record each event in the same local transaction as the change ([transactional outbox](../transactional-outbox/)), or derive events from the database log with change data capture. Brokers redeliver, so make consumers [idempotent](../idempotent-consumer/).
- **Keep copies small and rebuildable.** A read model should hold only the fields its service needs, record where they came from, and be rebuildable from the owner's events or API.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Microservices](../microservices/) — Small, independently deployable services, each owning one business capability and its data.
- [Saga (Orchestration)](../saga-orchestration/) — A coordinator runs local transactions in sequence and triggers compensations when one fails.
- [Saga (Choreography)](../saga-choreography/) — Services react to each other's events to complete a workflow, with no central coordinator.
- [CQRS](../cqrs/) — Separate the write model (commands) from read models (queries), each optimised for its job.
- [Materialized View](../materialized-view/) — Precompute query-shaped views so reads don't pay for joins and aggregations.
- [Change Data Capture (CDC)](../change-data-capture/) — Stream every committed change from the database log to other systems.
- [Transactional Outbox](../transactional-outbox/) — Save the event in the same database transaction as the data, then relay it: no dual-write gap.
- [Modular Monolith](../modular-monolith/) — One deployable unit built from strongly bounded modules that talk through explicit interfaces.

## Related components and services

- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [MongoDB](../mongodb/) — A document database: JSON-like documents with flexible schemas, replica sets for failover and sharding to scale out.
- [Amazon RDS & Aurora](../amazon-rds-aurora/) — Managed relational databases: backups, Multi-AZ failover and read replicas, and Aurora's storage shared across three zones.

## Related principles and frameworks

- [Team Topologies](../team-topologies/) — Four team types and three interaction modes that organise teams around the flow of change and keep cognitive load in check.

## Related database topics

- [Normalization & Denormalization](../normalization/) — Store each fact once to keep data consistent, then copy some on purpose where reads must be fast, and keep the copies in step.

## References

- [Chris Richardson (microservices.io) — Pattern: Database per service](https://microservices.io/patterns/data/database-per-service.html)
- [Chris Richardson (microservices.io) — Pattern: Shared database](https://microservices.io/patterns/data/shared-database.html)
- [Chris Richardson (microservices.io) — Pattern: API Composition](https://microservices.io/patterns/data/api-composition.html)
- [Azure Architecture Center — Data considerations for microservices](https://learn.microsoft.com/en-us/azure/architecture/microservices/design/data-considerations)
- [AWS Prescriptive Guidance — Database-per-service pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-data-persistence/database-per-service.html)
- [Martin Fowler — IntegrationDatabase](https://martinfowler.com/bliki/IntegrationDatabase.html)
- [Martin Fowler — PolyglotPersistence](https://martinfowler.com/bliki/PolyglotPersistence.html)
- [Sam Newman — Monolith to Microservices](https://samnewman.io/books/monolith-to-microservices/)
- [PostgreSQL documentation — Schemas](https://www.postgresql.org/docs/current/ddl-schemas.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
