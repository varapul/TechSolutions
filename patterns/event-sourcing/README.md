<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗄️ Data Management](../../README.md#data-management)

# Event Sourcing

> Store every change as an immutable event and rebuild state by replaying them.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Event Sourcing" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/event-sourcing.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Append, don't overwrite** | A `Withdraw 30` **command** arrives for one aggregate, bank account 42. The handler loads the account's stream, checks the rule against the current state (balance 70 covers 30) and **appends** a new event, `#4 Withdrew 30`, with the version it expects the stream to be at (3): if another writer appended first, the store rejects the append and the command is retried. Nothing is updated or deleted, whereas the CRUD way, `UPDATE accounts SET balance = 40`, keeps only the latest value and loses the story. |
| **2 · Replay to rebuild state** | Current state is **derived**, a fold over the events: replaying #1 to #4 takes the balance through 0, 100, 70 and 40. A **snapshot** (balance 40 at version 4) shortens the next load to the latest snapshot plus the events after it. Snapshots are an optimisation: throw one away and the replay still gives the same answer. |
| **3 · Project and subscribe** | The same events feed **read models** (an account summary, a monthly statement) and other subscribers, such as fraud checks and notifications. A brand-new read model added later replays from event #1 and gets the whole history. Projections are disposable and the log is the source of truth, but they lag a little behind the stream (eventual consistency): this is the read side of [CQRS](../cqrs/). |
| **4 · Correct by appending** | A mistaken deposit, `#5 Deposited 500`, is not edited or deleted. A **compensating event**, `#6 DepositReversed 500`, is appended instead, so the audit trail shows both the error and the fix, and the balance is 40 again. Because history is kept, you can also ask about the past: replaying only #1 to #3 gives the balance as of event #3, which was 70. |
<!-- END GENERATED: header -->

## The problem

Most systems store only the **current state**. `UPDATE accounts SET balance = 40 WHERE id = 42` overwrites the 70 that was there, and with it every answer to the question "how did we get here?":

- **The story is lost.** Was it a withdrawal, a fee or a correction? When, and requested by whom? A row that holds the latest value cannot say. Audit tables and triggers bolt a history on, but that history is a second record that can drift from the first, and nothing forces the two to agree.
- **Old data can't answer new questions.** What was the balance at the end of March? How many withdrawals did this customer make last year? If the values were overwritten, the answers are gone.
- **State and events can disagree.** A service that updates a row and also publishes an event makes two writes. Unless something ties them together, a crash between them leaves other services believing a different story from the database.

## How it works

Event sourcing turns the model around: the **sequence of events is the record**, and current state is something you compute from it. Martin Fowler's 2005 description is still the shortest: "Capture all changes to an application state as a sequence of events." A ledger works this way, and so does version control, where the commits are the events and the working copy is the derived state.

1. **A command arrives**, here `Withdraw 30`. The handler loads the aggregate's stream and folds the events into the current state: `state = events.reduce(apply, initialState)`. Azure's guidance calls this *rehydration*.
2. **It decides.** The business rule is checked against that state: balance 70 covers 30. A command can still be refused, because nothing has been written yet.
3. **It appends** one or more new events to the end of the stream, here `Withdrew 30`, and never touches the earlier ones.
4. **Everything else is derived from the stream:** the next load, snapshots, read models, and whatever other services are told.

| | Current-state store (CRUD) | Event-sourced |
|---|---|---|
| **What is stored** | The latest value of each record | Every change, as an immutable event |
| **A write is** | An update in place | An append to the end of a stream |
| **Current state** | Read directly | A fold over the stream, optionally starting from a snapshot |
| **History and audit** | Bolted on with audit tables or triggers | Built in: the events are the history |
| **Queries** | Straight from the tables | From projections, which are eventually consistent |
| **Fixing a mistake** | Edit the row | Append a compensating event |

### Commands and events

- A **command** is a request, named in the imperative: `Withdraw`, `ReverseDeposit`. It can be rejected.
- An **event** is a fact, named in the past tense in the language of the business: `AccountOpened`, `Deposited`, `Withdrew`, `DepositReversed`. It has already happened, so it can't be rejected, only followed by another event. Greg Young's CQRS documents insist on the grammar for this reason: the imperative shows that the server is allowed to say no.
- Record the **intent**, not only the resulting state: `Withdrew 30` rather than `BalanceChanged` to 40. Azure makes the point with seat reservations: "two seats were reserved" is worth more than "remaining seats changed to 42", because events that only carry state turn the store into a change log with no business meaning.

### One stream per aggregate, guarded by a version

Events are grouped into **streams**, normally one per aggregate instance (`account-42`), so loading an aggregate reads one short stream and not the whole log. Each event has a position in its stream, and the position of the last one is the stream's **version**; some stores call it the revision.

The version doubles as an **optimistic concurrency** check. The handler appends with the version it read ("expected version 3"). If another writer got there first, the stream has moved on and the store rejects the append; the handler reloads the stream, checks the rule again against the new state and retries. No lock is held while the handler thinks, and two withdrawals can never both spend the same 70.

### Snapshots

Replaying a long stream for every command gets slow. A **snapshot** stores the folded state at some version (balance 40 at version 4), and loading becomes the latest snapshot plus the events after it. A snapshot is only a cache: the stream stays the source of truth, a snapshot can be deleted and rebuilt at any time, and it has to be rebuilt when the shape of the state changes. Don't add snapshots by reflex. Greg Young notes that replaying even 1,000 events is fast enough for many systems, and that persisted snapshots are often not worth their conceptual and operational cost.

### Projections, and why CQRS comes with it

A stream answers one question well: what happened to account 42? Any other question ("which accounts are overdrawn?") would mean replaying every stream. So event-sourced systems keep **projections**: subscribers that consume the events in order and maintain read models shaped for queries, like the account summary and the monthly statement in step 3. An append-only write model with separate read models is [CQRS](../cqrs/), and in practice the two arrive together. microservices.io says it flatly: because the event store is difficult to query, "the application must use Command Query Responsibility Segregation (CQRS) to implement queries".

- Projections are **disposable**. To fix a bug in one, or to add a view nobody thought of when the events were written, build it from event #1 and switch over once it has caught up.
- They are **eventually consistent**: a read model lags the stream by however long delivery and processing take.
- Delivery is normally at-least-once, so a projection must be **idempotent**: keep the position of the last event applied next to the view, and skip anything at or below it.

### Corrections and questions about the past

There is no `UPDATE` for an event. A mistake is corrected by a **compensating event**, appended like any other: in step 4, `DepositReversed` names the deposit it reverses, and the stream shows both the error and the fix. It is the Compensating Transaction pattern applied to a single stream. Accountants have always worked this way, and Greg Young's advice follows theirs: prefer a **full reversal** (undo the whole wrong entry, then record the right one) to a partial adjustment, because it is much easier to understand afterwards.

Since nothing is overwritten, **temporal queries** come naturally: the state as of any event, or any point in time, is the fold up to that point.

## When to use it

- **The history is the business:** ledgers, payments, orders, claims, bookings. Anywhere auditors, customers or support staff ask how a record got into its current state.
- You need an **audit trail that cannot drift** from the data, because the data is rebuilt from it.
- You expect **new questions about old data:** new read models, analytics, or replaying production events to debug and test.
- Several consumers must learn of every change reliably. Appending the event is one atomic write, and subscribers are fed from the stream, so there is no dual write.

It is the wrong tool when:

- The domain is **simple CRUD** with no need for history, audit or replay, or the data is reference data that rarely changes.
- Every view must be **consistent immediately**. Projections are eventually consistent by nature.
- The team is new to event-driven design and the product is a prototype or short-lived. The up-front work on event design, schema evolution and projections rarely pays back.

It doesn't have to be all or nothing. Azure's guidance suggests applying it to the parts that benefit most, such as a payment ledger or an order pipeline, and keeping plain CRUD for the rest, such as user profiles and configuration.

## Trade-offs

- **A different way of working, with a learning curve.** Modelling, testing, debugging and operations all change. Tests, for one, become "given these past events, when this command arrives, then these new events are produced".
- **Eventual consistency** between the stream and every read model, with the user-experience consequences described under [CQRS](../cqrs/).
- **Events are forever, and so are their schemas.** A stream written today will be replayed by code written years from now (see schema evolution below).
- **Queries need projections.** Each one is code to write, a store to run and a lag to watch.
- **Immutability against the right to erasure.** Personal data in an append-only log collides with laws such as the GDPR's right to erasure (Article 17). Design for it from the start (see below).
- **Replays must not repeat side effects.** A rebuild that sends every email again is a disaster. Keep projections free of side effects, and switch gateways to external systems off during a replay, as Fowler describes.
- **The store only grows.** Long streams load slowly without snapshots, and old events eventually need archiving to cheaper storage. Streams stay short when they follow a lifecycle that ends (one statement period, one shift) instead of an entity that lives forever.
- **Conflicts become retries.** Under heavy contention on one stream, optimistic concurrency turns into repeated work. That usually means the aggregate is too big.

## Implementation notes

- **Choosing an event store.** The store needs few operations: append to a stream with an expected version, read a stream in order, and subscribe to everything in order.
  - *Purpose-built.* KurrentDB (called EventStoreDB until its vendor, Event Store, rebranded as Kurrent; the first release under the new name was 25.0) lets each append state the stream state or revision it expects, and throws if the stream is not in that state. Marten adds an event store to PostgreSQL for .NET, with versioned appends, snapshots and projections.
  - *A relational table.* An `events` table with the stream ID, the version, the event type and the payload, and a **unique constraint on (stream ID, version)**. Two writers that both try to insert version 4 cannot both succeed. Greg Young's CQRS documents sketch the same idea with a version column per aggregate, checked inside the transaction.
  - *A key-value or document store.* In DynamoDB, use the stream as the partition key and the version as the sort key, and put each event with the condition `attribute_not_exists` on the key, which fails if that item already exists. In Azure Cosmos DB, use the stream as the partition key and the version as the item ID: IDs are unique within a logical partition, so creating the same version twice fails with `409 Conflict`, and a transactional batch can append several events to one stream atomically.
  - *A log broker alone is an awkward fit.* Kafka and similar brokers keep records in order within a partition and replay them well, which suits distributing events to projections and other services. They don't read one entity's events cheaply, though, and they have no conditional append: [KIP-27 (Conditional Publish)](https://cwiki.apache.org/confluence/display/KAFKA/KIP-27+-+Conditional+Publish), the proposal to add one to Kafka, is still marked "under discussion". Azure's guidance draws the same line: brokers work well as a distribution layer, "but they aren't a substitute for an event store". AWS's write-up of the pattern takes the other route, with Kinesis Data Streams as the store and an archive in Amazon S3, and leaves detecting conflicting writes to the application.
- **Schema evolution.** Old events are never rewritten, so the code has to read every version it ever wrote.
  - Prefer additive changes and **tolerant readers**: ignore unknown fields and use defaults for missing ones.
  - **Upcast** on read: a small function turns version 1 of an event into version 2 as it is loaded, so the rest of the code only sees the latest shape, while the stored event stays as it was written.
  - Greg Young's rule in *Versioning in an Event Sourced System*: a new version of an event must be convertible from the old one. If it isn't, it is a new event, not a new version.
  - Rewriting history, by copying a stream into a new one through a transformation or by migrating events in place, is a last resort. It undermines the audit trail, and consumers have already acted on the old events.
- **Personal data.** Keep it out of the events where you can: store it in an ordinary table and put only a reference in the event, so it can be deleted on request. Where it has to travel with the event, **crypto-shredding** encrypts each person's data with a key of their own and deletes the key to forget them; the events stay in place, unreadable. These are engineering techniques, not legal advice. Check that your approach satisfies the regulation, and note that the right to erasure has exceptions, for example for records the law requires you to keep.
- **Internal events are not a public contract.** The events in the store are fine-grained and shaped by the aggregate's internals. Other teams that subscribe to them directly are coupled to your model, and every refactoring becomes a breaking change for them. Translate them into separate, coarser **integration events** and treat only those as a versioned API.
- **Publishing to other services.** Feed the broker from a subscription on the store. The store then acts as its own [transactional outbox](../transactional-outbox/): each event is written once, the relay delivers it at least once, and consumers deduplicate (the Idempotent Consumer pattern).
- **Rules that span streams.** Keep each command to one stream where you can. A rule across aggregates, such as a transfer between two accounts, becomes a [saga](../saga-orchestration/) with compensating steps. Some stores now also offer atomic appends to several streams; KurrentDB has had them since 25.1.
- **Snapshots in practice.** Take them asynchronously, every so many events, and keep them outside the stream, keyed by aggregate and version. When the format of the state changes, rebuild them instead of migrating them.
- **Close relatives.** [Event-driven architecture](../event-driven-architecture/) is about how services talk to each other; event sourcing is about how one service stores its own state, and each works without the other. Change Data Capture also yields a stream of changes, but it derives them from table rows after the fact (the balance went from 70 to 40) and lacks the intent that a domain event records. A Materialized View is what a projection maintains.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [CQRS](../cqrs/) — Separate the write model (commands) from read models (queries), each optimised for its job.
- [Materialized View](../materialized-view/) — Precompute query-shaped views so reads don't pay for joins and aggregations.
- [Change Data Capture (CDC)](../change-data-capture/) — Stream every committed change from the database log to other systems.
- [Transactional Outbox](../transactional-outbox/) — Save the event in the same database transaction as the data, then relay it: no dual-write gap.
- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.
- [Compensating Transaction](../compensating-transaction/) — Undo the completed steps of a multi-step operation that failed part-way.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.

## Related components and services

- [Apache Kafka](../kafka/) — A partitioned, replicated commit log: producers append events, consumer groups read at their own pace and can replay history.
- [Apache Cassandra](../cassandra/) — A wide-column database built for heavy writes across data centres: a token ring, tunable consistency and LSM storage.

## Related database topics

- [Normalization & Denormalization](../normalization/) — Store each fact once to keep data consistent, then copy some on purpose where reads must be fast, and keep the copies in step.
- [Optimistic Concurrency Control](../optimistic-concurrency/) — Update a row only if it is unchanged since you read it, using a version column, and retry on conflict instead of holding locks.
- [Write-Ahead Log](../write-ahead-log/) — Log each change before applying it, so a commit survives a crash, recovery replays the log, and replicas and backups follow it.

## References

- [Martin Fowler — Event Sourcing (2005)](https://martinfowler.com/eaaDev/EventSourcing.html)
- [Martin Fowler — What do you mean by "Event-Driven"?](https://martinfowler.com/articles/201701-event-driven.html)
- [Greg Young — CQRS Documents (2010, PDF)](https://cqrs.wordpress.com/wp-content/uploads/2010/11/cqrs_documents.pdf)
- [Greg Young — Versioning in an Event Sourced System](https://leanpub.com/read/esversioning)
- [Azure Architecture Center — Event Sourcing pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)
- [microservices.io — Pattern: Event sourcing](https://microservices.io/patterns/data/event-sourcing.html)
- [AWS Prescriptive Guidance — Event sourcing pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/event-sourcing-pattern.html)
- [Kurrent Docs — KurrentDB concepts: events, streams and optimistic concurrency](https://docs.kurrent.io/getting-started/concepts)
- [Marten — Appending Events](https://martendb.io/events/appending.html)
- [Martin Kleppmann — Designing Data-Intensive Applications](https://dataintensive.net/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
