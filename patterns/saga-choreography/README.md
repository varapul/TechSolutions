<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [📨 Messaging & Integration](../../README.md#messaging--integration)

# Saga (Choreography)

> Services react to each other's events to complete a workflow, with no central coordinator.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Saga (Choreography)" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/saga-choreography.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · An event starts it** | Orders commits the new order as **PENDING** in its own database and publishes *OrderPlaced* to the topic. That is all it does: it sends no command and does not know who will react. The other services have each subscribed to the events they care about, and Payments is the one that listens for this one. |
| **2 · React and publish** | Payments consumes *OrderPlaced*, charges the card in a local transaction and publishes *PaymentCompleted*. Inventory reacts to that by reserving stock and publishing *StockReserved*, Shipping reacts by booking a courier and publishing *ShipmentBooked*, and Orders reacts by marking the order **CONFIRMED**. No component ran this sequence: the workflow exists only as the chain of subscriptions. |
| **3 · A failure is an event too** | On order #1043 the card has already been charged, but Inventory has nothing left to reserve, so it publishes *StockReservationFailed*. Payments listens for that event too: it refunds the charge in a new local transaction and publishes *PaymentRefunded*, and Orders reacts by marking the order **CANCELLED**. Each service undoes its own step; there is no global rollback. |
| **4 · Nobody sees the whole flow** | The flow is written down nowhere, so when Inventory's consumer is down, order #1044 simply stops after the charge and no service reports it. Teams add what the pattern leaves out: every event carries the order ID as a **correlation ID**, a tracking view subscribes to the topic and assembles each saga's state from its events, and a **timeout** flags a saga that has gone quiet half-way. As steps and branches grow, the subscriptions become hard to follow and an orchestrator pays off. |
<!-- END GENERATED: header -->

## The problem

Placing an order changes data that four services own, each in its own database: Orders records the order, Payments charges the card, Inventory reserves the stock and Shipping books a courier. No local transaction spans four databases. A distributed transaction with two-phase commit needs every participant to support it and to be reachable at the same moment, and it keeps locks in all of them until the coordinator has decided. A **saga** gives up the single transaction instead: each service commits its own local transaction, and a step that has to be taken back is reversed by a new transaction.

That leaves one question open: who decides what happens next? An [orchestrator](../saga-orchestration/) can, by sending each service a command and waiting for its reply. But it is one more component to build and keep available, it has to know every participant, and every change to the flow goes through whoever owns it. For three or four steps that can be more machinery than the problem needs.

## How it works

A saga is a sequence of local transactions, and each one that may need undoing has a **compensating transaction**. Hector Garcia-Molina and Kenneth Salem proposed the idea in 1987 for long-lived transactions inside one database, with a simple promise: either every transaction of the saga completes, or the ones that did complete are compensated.

In the **choreography** style nobody runs that sequence. Every service follows the same rule: **listen** for the events it cares about, **react** with a local transaction in its own database, and **publish** an event that says what happened. The events travel through a message broker, so the services never call each other. The whole order flow in the diagram is seven such rules:

| Service | Listens for | Local transaction | Then publishes |
|---|---|---|---|
| Orders | a customer's request | save the order as PENDING | *OrderPlaced* |
| Payments | *OrderPlaced* | charge the card | *PaymentCompleted* |
| Inventory | *PaymentCompleted* | reserve the stock | *StockReserved*, or *StockReservationFailed* |
| Shipping | *StockReserved* | book a courier | *ShipmentBooked* |
| Orders | *ShipmentBooked* | mark the order CONFIRMED | |
| Payments | *StockReservationFailed* | refund the charge | *PaymentRefunded* |
| Orders | *PaymentRefunded* | mark the order CANCELLED | |

Read from top to bottom, this table is the workflow. In the running system no such table exists: every row lives in a different service's code, and the broker only knows who subscribed to which event.

- **Events, not commands.** An event states a fact in the past tense (*OrderPlaced*), and its publisher does not know who reacts, if anyone. A command (*ChargePayment*) asks one particular service to do something and expects an outcome. Choreography uses only events, so the decision to act belongs to the receiver: Payments charges because Payments has decided that a placed order is a reason to charge.
- **A failure is published like anything else.** When Inventory cannot reserve, its local transaction writes nothing and it publishes *StockReservationFailed*. Payments, which has already charged the card, listens for that event and compensates its own step, and the *PaymentRefunded* it publishes is what Orders reacts to. Nobody sends an "undo" command and nothing is rolled back globally; even the order of the compensations comes out of the subscriptions.
- **Compensation is a business action, not an undo.** The charge stays in the payments ledger and a refund is recorded next to it. A compensation restores consistency for the business, not the earlier state of the data, and it is one more local transaction that publishes one more event.
- **The caller does not wait.** Usually Orders answers as soon as the order is PENDING, and the client learns the outcome later, by polling the order's status or through a notification such as a webhook or a WebSocket message.

## When to use it

- A business transaction spans a few services, each with its own database, and the flow is short and mostly linear. Both the AWS and the Azure guidance recommend choreography for simple sagas with few participants.
- The participants belong to different teams or bounded contexts that should stay loosely coupled, and the events are domain facts that other consumers (analytics, notifications, search) want anyway.
- An [event backbone](../event-driven-architecture/) already exists, and a coordinator would be one more component that every order depends on.
- Each step that can be followed by a failure has a meaningful business reversal: refund, release, cancel.

Do **not** use it:

- **For a few steps inside one service.** If the data can live in one database, one local transaction is simpler and gives you real isolation.
- **For many steps, branches, timers or human approvals.** Use [orchestration](../saga-orchestration/): one definition of the flow that can be read, versioned, tested and monitored.
- **When somebody must always be able to say where an order stands,** and you are not prepared to build the tracking described below.
- **When intermediate states must never be visible.** No saga gives you isolation.

## Trade-offs

| | Choreography | Orchestration |
|---|---|---|
| **Who knows the flow** | Nobody: it emerges from each service's subscriptions | The orchestrator: one definition in one place |
| **Messages** | Events: facts, and the receiver decides what to do | Commands and replies: the sender decides |
| **Coupling** | Services depend on each other's events, often in a cycle | Participants know nothing of each other; the orchestrator knows them all |
| **Visibility** | Has to be built: correlation IDs, tracing, a tracking view | The saga's state is the orchestrator's own data |
| **Control** | No coordinator to fail or to become a bottleneck (the broker is still shared); retries and timeouts in every service | Retries, timeouts and compensation in one place, which must be highly available |
| **Change** | A new listener needs no change elsewhere; a new or moved step touches several services | Edit one definition; the participants usually stay as they are |

- **Nobody holds the whole picture.** The flow appears in no single piece of code. Martin Fowler warns that with a chain of event notifications you may have to observe the live system to find out what the flow is. When a saga stops half-way, as order #1044 does in step 4, no service is in a position to notice.
- **Dependencies run in a circle.** Orders consumes events from Payments and Shipping, Payments consumes events from Orders and Inventory, and so on round the ring. Both Azure and AWS list cyclic dependencies between participants as a risk of choreography.
- **Every failure case adds subscriptions.** In the diagram only Inventory fails. If booking the courier could fail too, Inventory would have to listen for that event and release the stock, and Payments would have to listen for the release, or for the failure itself, and refund. Event types and listeners grow faster than steps.
- **Moving a step is a cross-team change.** To reserve stock before charging, Inventory has to listen for *OrderPlaced*, Payments for *StockReserved* and Shipping for *PaymentCompleted*: three services change and deploy together. Bernd Ruecker and Martin Schimak use this very example against long event chains.
- **Events that are commands in disguise.** If Orders publishes an event only so that Payments will charge, it is sending what Fowler calls a "passive-aggressive command": the coupling is still there, only harder to see. When one service needs another to act, a command says so.
- **No isolation.** A saga is atomic in the end, consistent and durable, but other requests see its intermediate states: stock held for an order that is about to be cancelled, a charge that will be refunded. That allows lost updates, dirty reads and fuzzy (non-repeatable) reads. The usual countermeasures are a **semantic lock** (an application-level marker, such as the order's PENDING status, that tells others the record is in flux), commutative updates, a pessimistic view (reorder the saga so that the risky updates happen in retryable steps), rereading values before updating them, version files (a log of the operations on a record, so that they are applied in the right sequence) and choosing the mechanism by the business risk of each request.
- **Eventual consistency.** Until the saga ends, the order is PENDING, and APIs and screens have to show that honestly.
- **Timeouts and retries are everybody's job.** With no coordinator, each service implements its own retry, timeout and compensation handling. AWS notes that this is harder to get right across components than at an orchestrator.
- **End-to-end tests need everything running.** A whole saga can only be exercised with all of its services and the broker up.

## Implementation notes

- **Publish reliably.** A service that commits and then publishes can crash in between, and a saga that loses an event stops without an error anywhere. Write the event in the same local transaction as the state change with a [transactional outbox](../transactional-outbox/), or make the events themselves the state, as in [event sourcing](../event-sourcing/).
- **Consume idempotently.** Reliable delivery is at-least-once delivery: a broker redelivers what was not acknowledged and an outbox relay publishes again after a crash, so sooner or later every handler sees an event twice. Make each one an [idempotent consumer](../idempotent-consumer/): a second *StockReservationFailed* must not produce a second refund.
- **Keep one order's events in order.** Use the order ID as the message key, session or group. Kafka writes events with the same key to the same partition and delivers a partition in the order it was written; Azure Service Bus has sessions; an SQS FIFO queue is strictly ordered within a message group. None of them orders events across topics or queues, and consumers scaled out without such a key process events out of order, so carry a version or sequence number wherever a stale event would do harm.
- **One topic or several.** The diagram uses a single topic for the whole saga, which keeps all events of one order in one ordered stream. A topic for each service or event type is just as common; it separates ownership more cleanly and gives up the order between topics.
- **Expect an event in any state.** A handler meets duplicates, late events and events for orders it has no record of. Let it check its own data first and decide: a *StockReservationFailed* for an order that was never charged needs no refund.
- **Order the steps by how hard they are to undo.** Azure's guidance names three kinds of step: *compensable* transactions that can be reversed, a *pivot* after which the saga has to run to completion, and *retryable* transactions that follow the pivot and are idempotent, so that they can be repeated until they succeed. Put the checks most likely to fail first and anything that cannot be taken back (a parcel handed to the courier, an email) last. The diagram charges the card first so that there is something to compensate. A real flow would reserve the stock first, or authorise the card early and capture it at the end, which turns the refund into the release of a hold.
- **Compensations must not give up.** A compensation can fail like any other step. Make it idempotent and retry it, and when retrying does not help, alert a person with enough detail to finish the job by hand.
- **Put a correlation ID on every event.** The order ID, or a saga ID of its own, is what lets logs, traces and the tracking view tie the events of one saga together. A unique event ID next to it is what consumers deduplicate on:

  ```json
  {
    "eventId": "e-7c1",
    "type": "PaymentCompleted",
    "orderId": 1044,
    "occurredAt": "2026-10-02T09:15:04Z",
    "data": { "amount": 80, "currency": "USD" }
  }
  ```

- **Trace it.** Propagate the trace context in the message headers so that one trace follows the saga across the broker: see [distributed tracing](../distributed-tracing/). Traces are usually sampled, so they help to debug one saga but cannot tell you where every order stands.
- **Keep a state view.** A small consumer subscribes to every event of the saga and keeps one row for each order: the events seen, the latest one and when it arrived. It needs no knowledge of the flow beyond which events open and close a saga. Bernd Ruecker walks through the options, from a store of all events that you can query to a workflow engine that only listens. Once the view starts to act, for example by cancelling orders that time out, it has begun to orchestrate, and that may be the moment to move the flow to an orchestrator.
- **Give every saga a deadline.** A step does not always fail; sometimes it just never answers. Alert on every saga that has seen no closing event within its deadline. If a timeout should also cancel the order, let the service that started the saga own it: Orders expires an order that stays PENDING too long and publishes an event on which the others compensate. A timeout is not proof of failure, so a late *ShipmentBooked* can still arrive and must then be compensated too.
- **Watch the dead-letter queues.** An event that a consumer keeps failing on is parked in a [dead-letter queue](../dead-letter-queue/), and its saga waits there with it. Alert on every arrival and use the correlation ID to find the order.
- **Treat events as a public contract.** An event can have several consumers, and its publisher does not know them all, so a change to its shape can break services that nobody thought of. Evolve schemas in backward-compatible steps; a schema registry can enforce that.
- **Test each rule, then a few whole sagas.** For every row of the table above, put the service in a known state, deliver the event, and assert on its database and on the event it publishes. Then deliver the event twice, and deliver events in the wrong order. Check event schemas with contract tests between each publisher and its consumers. Keep the end-to-end tests few: the happy path and one for each compensation path.
- **Mix the styles.** The choice is made for each flow, not for the whole system. A common split is choreography between bounded contexts and an orchestrator inside one, and a flow that outgrows its event chain can be handed to an orchestrator that listens for the same events and answers with commands.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Saga (Orchestration)](../saga-orchestration/) — A coordinator runs local transactions in sequence and triggers compensations when one fails.
- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.
- [Transactional Outbox](../transactional-outbox/) — Save the event in the same database transaction as the data, then relay it: no dual-write gap.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.
- [Compensating Transaction](../compensating-transaction/) — Undo the completed steps of a multi-step operation that failed part-way.
- [Dead-Letter Queue](../dead-letter-queue/) — Park messages that keep failing so they stop blocking the queue and can be inspected.
- [Publish-Subscribe](../publish-subscribe/) — Broadcast each message to every interested subscriber through a topic.
- [Database per Service](../database-per-service/) — Each service owns its data; others go through its API or events, never its tables.

## Related components and services

- [Amazon EventBridge](../amazon-eventbridge/) — An event bus: rules match events from AWS services, SaaS apps and your own code by content and route them to targets.

## References

- [Chris Richardson — Pattern: Saga (microservices.io)](https://microservices.io/patterns/data/saga.html)
- [Hector Garcia-Molina & Kenneth Salem — Sagas (SIGMOD 1987)](https://www.cs.cornell.edu/andru/cs711/2002fa/reading/sagas.pdf)
- [Azure Architecture Center — Saga design pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/saga)
- [Azure Architecture Center — Choreography pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/choreography)
- [AWS Prescriptive Guidance — Saga choreography pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-choreography.html)
- [Martin Fowler — What do you mean by "Event-Driven"?](https://martinfowler.com/articles/201701-event-driven.html)
- [Bernd Ruecker & Martin Schimak — Know the Flow! Microservices and Event Choreographies (InfoQ)](https://www.infoq.com/articles/microservice-event-choreographies/)
- [Bernd Ruecker — Monitoring and Managing Workflows across Collaborating Microservices (InfoQ)](https://www.infoq.com/articles/monitor-workflow-collaborating-microservices/)
- [Azure Architecture Center — Compensating Transaction pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
