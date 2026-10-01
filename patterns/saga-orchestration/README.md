<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [📨 Messaging & Integration](../../README.md#messaging--integration)

# Saga (Orchestration)

> A coordinator runs local transactions in sequence and triggers compensations when one fails.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Saga (Orchestration)" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/saga-orchestration.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Start the saga** | Order Service saves the new order as **PENDING** and starts the saga. The orchestrator records the step in its saga log and sends a *Charge payment* command. Payments charges the card in its own local transaction, commits, and replies with success. |
| **2 · Next local transaction** | The orchestrator records the reply and sends the next command, *Reserve stock*. Inventory commits a reservation in its own database and replies. Each step is visible to the rest of the system as soon as it commits: no database lock is held across services while the saga runs. |
| **3 · A step fails** | *Book shipment* fails because no courier is available. Shipping's local transaction rolls back, so nothing is written there, and it replies with a failure. Unlike two-phase commit there is no global rollback: the charge and the reservation are already committed and can only be reversed by new transactions. |
| **4 · Compensate in reverse** | The orchestrator runs the compensations of the completed steps in reverse order: *Release stock*, then *Refund payment*. Each is a new local transaction with a business meaning (the refund sits next to the charge; nothing is erased). Finally it cancels the order, which ends **CANCELLED**. |
<!-- END GENERATED: header -->

## The problem

With a database per service, one business operation touches data that several services own. Placing an order means charging the card in Payments, reserving stock in Inventory and booking a courier in Shipping, and no single database transaction spans all three. The classic answer is a distributed transaction with **two-phase commit** (2PC, for example through XA). It holds locks in every participant until the coordinator decides, leaves participants blocked "in doubt" if the coordinator fails at the wrong moment, and needs every participant to be available at once. Many databases, message brokers and third-party APIs don't support it at all. Without some other form of coordination, a failure halfway leaves the system inconsistent: a customer is charged for an order that will never ship.

## How it works

A **saga** replaces the one big transaction with a sequence of **local transactions** T1 … Tn, each committed in one service's own database. Every step that may need undoing has a **compensating transaction**. Garcia-Molina and Salem, who proposed sagas in 1987 for long-lived transactions inside a single database, stated the guarantee: either T1 … Tn all commit, or T1 … Tj commit and are followed by their compensations Cj … C1. In the diagram T3 fails, so C2 and C1 run. Nothing that has committed is ever rolled back; it is compensated.

In the **orchestration** style, one coordinator owns the flow:

- The **orchestrator** is a state machine that knows the steps, their order and their compensations. It can be a component of the service that starts the saga or a separate workflow engine.
- It records every transition in a durable **saga log**, sends each participant a **command** (usually as an asynchronous message) and waits for the **reply**.
- On a failure reply it stops going forward and sends the compensating commands for the completed steps, newest first. The failed step itself needs no compensation, because its local transaction rolled back.
- Participants only run their own local transaction and its compensation. They know nothing about each other or about the overall flow.

Compensation is **semantic**, not an undo. The charge stays in the payments ledger and a refund is recorded next to it; the customer sees both on their statement. A compensation restores business consistency, not the exact previous state.

## When to use it

- A business transaction spans several services or data stores that can't share one ACID transaction, such as microservices with a database each, or third-party APIs.
- Every step before the point of no return has a meaningful business reversal: refund, release, cancel.
- The flow has several steps, branches or timeouts, and you want it explicit in one place where it can be versioned, tested and monitored.
- Not when the data can live in one database (a local transaction is simpler and stronger), or when nobody may ever see the intermediate states.

## Trade-offs

- **No isolation.** A saga provides atomicity (eventually), consistency and durability, but not isolation. Other requests see intermediate states, such as stock held for an order that is about to be cancelled, which allows lost updates, dirty reads and non-repeatable reads. Countermeasures include a **semantic lock** (an application-level flag, like the order's PENDING status, that tells other operations the record is in flux), commutative updates, reordering the steps so that risky updates happen in retriable steps (*pessimistic view*), rereading a value before overwriting it, and recording the operations applied to a record so they can be applied in the right order (*version file*).
- **Compensation is business logic.** Every compensatable step needs a reverse operation that must be designed and tested, and some actions (a sent email, a shipped parcel) can't be reversed at all. A compensation must not give up: retry it, and escalate to a human if it keeps failing.
- **Eventual consistency.** Until the saga finishes, the order is PENDING. APIs and UIs have to be designed for that.
- **Orchestration vs. choreography.** An orchestrator makes the flow explicit and easy to follow, keeps participants decoupled from each other and avoids cyclic dependencies between them. The cost is one more component that must be highly available, and the temptation to move business logic into it. In choreography, services react to each other's events and there is no coordinator; that suits short flows, but a long one becomes hard to follow and to change.

## Implementation notes

- **Pivot and retriable transactions.** Order the steps as compensatable transactions, then a **pivot** (the go/no-go step: once it commits, the saga must run to completion), then **retriable** transactions that are retried until they succeed. Here *Book shipment* is the pivot: had it succeeded, the remaining step (approving the order) would be retried, never compensated. Put the checks most likely to fail early, and hard-to-reverse actions at or after the pivot. With cards, for instance, authorizing early and capturing after the pivot turns the compensation into voiding a hold instead of issuing a refund.
- **Idempotent commands and replies.** Messages are delivered at least once and the orchestrator retries after timeouts, so participants must deduplicate commands (for example by saga ID and step) and the orchestrator must ignore duplicate or late replies. Compensations must be idempotent too, and safe to run when the forward step never took effect.
- **A timeout means "unknown", not "failed".** Retry the idempotent command or ask the participant for the outcome before compensating.
- **Durable saga state.** Persist the saga's state at every transition so that a restarted orchestrator resumes where it stopped. Workflow engines such as Temporal, AWS Step Functions (Standard workflows), Azure Durable Functions and Camunda do this for you; in a hand-written orchestrator, the saga log is a table in the orchestrator's own database.
- **No dual writes.** A service that commits and then sends a message (a participant's reply, the orchestrator's next command) can crash in between. Use a transactional outbox, or the workflow engine's own guarantees, so that a message is sent if and only if its transaction commits.
- **Make it observable.** Carry the saga ID through commands, replies and logs, and alert on sagas stuck in a non-final state.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- Saga (Choreography) *(planned)* — Services react to each other's events to complete a workflow, with no central coordinator.
- Compensating Transaction *(planned)* — Undo the completed steps of a multi-step operation that failed part-way.
- [Transactional Outbox](../transactional-outbox/) — Save the event in the same database transaction as the data, then relay it: no dual-write gap.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.
- Database per Service *(planned)* — Each service owns its data; others go through its API or events, never its tables.
- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.
- [Retry with Backoff & Jitter](../retry-with-backoff/) — Retry transient failures with growing, randomised delays so clients don't stampede.

## References

- [Hector Garcia-Molina & Kenneth Salem — Sagas (SIGMOD 1987)](https://dl.acm.org/doi/10.1145/38713.38742)
- [Chris Richardson — Pattern: Saga (microservices.io)](https://microservices.io/patterns/data/saga.html)
- [Chris Richardson — Microservices Patterns (Manning)](https://www.manning.com/books/microservices-patterns)
- [Azure Architecture Center — Saga design pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/saga)
- [AWS Prescriptive Guidance — Saga orchestration pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-orchestration.html)
- [Azure Architecture Center — Compensating Transaction pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
