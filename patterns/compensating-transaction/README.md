<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🛡️ Resilience & Reliability](../../README.md#resilience--reliability)

# Compensating Transaction

> Undo the completed steps of a multi-step operation that failed part-way.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Compensating Transaction" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/compensating-transaction.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Can't be rolled back** | Booking a trip books a flight, then a hotel, then a car, each with a different provider and each committed in that provider's own system. The flight and the hotel are confirmed; the car fails because none are left. No transaction spans the three providers, so there is nothing to roll back: the first two bookings are already real, and the seat and the room are off sale for everyone else. |
| **2 · Undo by compensating** | The workflow runs a compensating action for each completed step, newest first: cancel the hotel, then cancel the flight. A compensation is a new business operation, not a restore of the old data: the seat goes back on sale, the airline keeps a $40 cancellation fee, and the original booking stays in its history. Each step was written to the durable log before the next one ran, so when the worker crashes half-way, a new worker reads the log and knows that only the flight is left to undo. |
| **3 · Compensations fail too** | On the next trip the hotel's cancellation times out. The workflow retries it with the same idempotency key, which is safe only because cancelling is idempotent: cancelling twice still leaves one cancellation. After the third attempt it puts the case on the manual-intervention queue with what a person needs to finish it and alerts on-call, still cancels the flight, and marks the trip *needs attention* instead of leaving it half-cancelled with nobody noticing. |
| **4 · Design for cheap undo** | Design so that undo is cheap or unnecessary. Hold the seat and the room for 15 minutes, and take the payment and issue the ticket last, once everything is held: here the car fails, nothing is confirmed, and the holds lapse by themselves with nothing to compensate. Some effects can't be taken back at all (an email has been read, money has been paid out), so their compensation is a correction, such as an apology or a refund. |
<!-- END GENERATED: header -->

## The problem

Booking a trip touches three companies: an airline, a hotel and a car-rental firm. Each one commits the booking in its own system, and none of them will join a transaction that you control. When the third booking fails, the first two are already real: the seat and the room are off sale for everyone else, and the money may already have been taken. There is no transaction to roll back.

Even inside one database, a step that committed minutes ago can't simply be put back: other work may have read the data and built on it since, and writing the old values back would overwrite those changes. Undoing has to be a deliberate business operation.

## How it works

A **compensating transaction** undoes a completed step with a new operation that reverses its business effect: a cancellation for a booking, a refund for a charge, a correcting entry for a ledger posting. Garcia-Molina and Salem's 1987 paper on sagas already framed it this way: a compensation undoes a step's effects semantically, without promising to put the data back exactly as it was. That is why compensation is application-specific. A cancellation may cost a fee, a refund may be partial, and the original record stays in the history next to the one that reverses it.

- **Record progress durably.** Before running the next step, write down which steps have completed and what undoes each one. If the worker crashes, its replacement reads that record and knows what is left to do. Workflow engines keep this record for you: Temporal's durable execution keeps compensations running through worker failures, Azure Durable Functions keep each orchestration's history in an append-only, event-sourced store and replay it after a restart, and AWS Step Functions Standard workflows persist their execution state between steps (Express workflows don't).
- **Choose the order.** Undoing the newest step first is the usual default, and Temporal's saga helpers run compensations in the reverse order in which they were registered. Microsoft's guidance adds that the order doesn't have to be the exact reverse: undo first whatever is most sensitive to inconsistency, and run undo steps that don't depend on each other in parallel.
- **Expect compensations to fail.** A cancel call can time out like any other call. Retry it (see [Retry with Backoff & Jitter](../retry-with-backoff/)), which is safe only when the compensation is idempotent: send the same idempotency key on every attempt, so that cancelling twice still leaves one cancellation (see [Idempotent Consumer](../idempotent-consumer/)).
- **Hand over what can't be finished.** When the retries run out, raise an alert and put the case on a queue for a person, with the trip, the booking references, what has already been undone and the last error. A half-undone operation that nobody notices is far worse than one waiting in a queue.

## When to use it

- An operation spans several services, data stores or third-party APIs that can't share one atomic transaction, and completed steps must be undone when a later step fails. Every saga needs this: see [Saga (Orchestration)](../saga-orchestration/) and [Saga (Choreography)](../saga-choreography/). It is also the price of [Database per Service](../database-per-service/): once each service owns its data, no single transaction covers a business operation that spans them.
- Undoing needs business rules (fees, partial refunds, a message to the customer) rather than a restore of old data.
- Long-running workflows, where holding locks for the whole duration is not an option.

Don't use it when everything lives in one database: a local transaction gives you a real rollback for free. Prefer plain retries when failures are transient and the step will succeed eventually, and prefer atomic transactions when the business can't tolerate a temporary inconsistency. Before compensating, also ask whether moving forward is better: the Azure guidance's own travel example offers the customer another hotel rather than cancelling the flights, and leaves that choice to the customer.

## Trade-offs

- **Others see the in-between state.** Until the compensation runs, the seat is sold out for other travellers and the charge sits on the card. A saga has no isolation, so teams add countermeasures: a *semantic lock* that marks a record as in progress (Richardson's saga examples create the order in a PENDING state), a *pessimistic view* that reorders the saga so that updates land in the retriable steps at the end, rereading a value before overwriting it, and updates that commute. Chris Richardson's book *Microservices Patterns* covers these in depth.
- **Undo is rarely perfect.** Fees remain, an email has been read, money has been paid out, a parcel has shipped. For those, the compensation is a correction: an apology, a refund, a credit note.
- **Twice the logic.** Every step that can be undone needs an undo that someone writes, reviews and keeps in step with the forward code, plus enough stored data to run it.
- **Compensations run rarely, so they break unnoticed.** Test them on purpose: make each step fail in turn in integration tests and check what is left, and inject faults in a test environment (see [Chaos Engineering](../chaos-engineering/)).
- **It needs observability.** Correlate each operation with its compensations end to end, alert when a compensation fails, and keep a dashboard of instances that are stuck or waiting for a person.

## Implementation notes

- **Put the hardest-to-undo step last.** Chris Richardson sorts saga steps into *compensatable* steps, which can be undone; a *pivot*, the point of no return; and *retriable* steps after it, which can't break a business rule and are simply retried until they succeed (Microsoft's saga guidance calls them compensable, pivot and retryable). In the trip, the holds are compensatable, taking the payment and issuing the ticket is the pivot, and sending the confirmation email is retriable.
- **Reserve first, confirm later.** A hold that lapses by itself turns a failure into doing nothing. Microsoft suggests a short-term lock with a timeout on each resource, acquired before the real work and finalised before it expires. Pat Helland describes tentative operations that always end in either a confirmation or a cancellation, and Guy Pardon and Cesare Pautasso's Try-Cancel/Confirm (TCC) design for REST APIs has each participant cancel on its own when it hears nothing before its timeout.
- **Store what the undo needs with the step:** the booking reference, the amount and the idempotency key. Temporal lets you register a compensation before its step runs, so that a step that dies half-way is still covered; the compensation then has to cope with a step that never happened.
- **Set a retry policy for compensations.** In AWS Step Functions a `Retry` block (by default three retries, the first after one second, with the interval doubling each time) runs before a `Catch` hands the error to the next state, such as a compensation or an escalation. Temporal advises against workflow-level timeouts so that compensations keep retrying until they succeed, while the Azure example caps the retries and moves the message to a [dead-letter queue](../dead-letter-queue/) with an alert. Either way, someone must find out.
- **Ledgers and event stores never erase.** Accounting fixes a wrong posting with a correcting entry, and an event-sourced system appends a compensating event (such as *ReservationCanceled*) instead of deleting the original: see [Event Sourcing](../event-sourcing/).
- **Send undo commands reliably.** When a compensation publishes a message, write it through a [transactional outbox](../transactional-outbox/) so that the undo can't be lost between the database and the broker.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Saga (Orchestration)](../saga-orchestration/) — A coordinator runs local transactions in sequence and triggers compensations when one fails.
- [Saga (Choreography)](../saga-choreography/) — Services react to each other's events to complete a workflow, with no central coordinator.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.
- [Retry with Backoff & Jitter](../retry-with-backoff/) — Retry transient failures with growing, randomised delays so clients don't stampede.
- [Event Sourcing](../event-sourcing/) — Store every change as an immutable event and rebuild state by replaying them.
- [Transactional Outbox](../transactional-outbox/) — Save the event in the same database transaction as the data, then relay it: no dual-write gap.
- [Dead-Letter Queue](../dead-letter-queue/) — Park messages that keep failing so they stop blocking the queue and can be inspected.
- [Database per Service](../database-per-service/) — Each service owns its data; others go through its API or events, never its tables.

## References

- [Azure Architecture Center — Compensating Transaction pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction)
- [Hector Garcia-Molina & Kenneth Salem — Sagas (SIGMOD 1987)](https://www.cs.cornell.edu/andru/cs711/2002fa/reading/sagas.pdf)
- [Pat Helland — Life beyond Distributed Transactions: an Apostate's Opinion (CIDR 2007)](https://www.cidrdb.org/cidr2007/papers/cidr07p15.pdf)
- [Chris Richardson — Pattern: Saga (microservices.io)](https://microservices.io/patterns/data/saga.html)
- [Chris Richardson — How modular can your monolith go? Part 6: transaction management for commands](https://microservices.io/post/architecture/2023/11/13/how-modular-can-your-monolith-go-part-6-transactional-commands.html)
- [Azure Architecture Center — Saga design pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/saga)
- [Guy Pardon & Cesare Pautasso — Atomic Distributed Transactions: a RESTful Design (WS-REST 2014)](https://design.inf.usi.ch/publications/2014/wsrest/tcc)
- [Temporal — Saga Pattern](https://docs.temporal.io/design-patterns/saga-pattern)
- [AWS Step Functions — Handling errors in Step Functions workflows](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)
- [AWS Step Functions — Choosing workflow type (Standard vs Express)](https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html)
- [Microsoft Learn — Durable orchestrations overview (Durable Functions)](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-orchestrations)
- [Azure Architecture Center — Event Sourcing pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
