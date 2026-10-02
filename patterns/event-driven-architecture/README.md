<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🏛️ Application Architecture](../../README.md#application-architecture)

# Event-Driven Architecture

> Producers publish events to a broker; any number of consumers react on their own schedule.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Event-Driven Architecture" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/event-driven-architecture.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Publish** | The producer records a fact (*an order was placed*) as an event on a topic. It doesn't know or care who is listening, and it doesn't wait for anyone to finish. |
| **2 · Fan out** | Each subscriber has its own subscription (a queue). The broker drops a copy of the event into every one, so Inventory, Payments and Notifications each react at their own pace, in parallel. |
| **3 · Backlog builds** | During a spike the producer keeps publishing at full speed. Fast consumers stay at zero lag, while the slow one (waiting on an email API) builds a **backlog**. Nobody else is slowed down: the queue absorbs the difference. |
| **4 · Scale out** | Because work waits in a queue, the slow consumer can scale out as **competing consumers** without any change to the producer or the other services. The backlog drains, and the instances can scale back in once it's empty. |
<!-- END GENERATED: header -->

## The problem

In a request/response world, the service where something *happens* has to call every service that *cares*. Placing an order means calling Inventory, then Payments, then Notifications, and so on. That caller must know every downstream service, wait for all of them, fail when any of them fails, and change every time a new one is added. Its latency becomes the sum of theirs, and its availability the product of theirs.

## How it works

Services communicate through **events**: immutable facts about something that happened (`OrderPlaced`, `PaymentCaptured`).

- **Producers** publish events to a broker and move on. They don't know who is listening.
- The **broker** (Kafka, Amazon SNS + SQS or EventBridge, Azure Service Bus or Event Grid, Google Pub/Sub, RabbitMQ) stores the events and delivers them to every **subscription**.
- **Consumers** process events at their own pace. Each consumer can scale, fail and recover independently. Its subscription remembers where it left off.

Adding a new capability usually means adding a new subscriber, with no change to the producer.

## When to use it

- Several independent reactions to the same business fact.
- Workloads with bursty traffic, where a queue should absorb spikes instead of the slowest dependency.
- Integrating systems owned by different teams, where temporal coupling (everyone up at the same time) is a liability.
- Streaming and near-real-time analytics that consume the same event log.

## Trade-offs

- **Eventual consistency.** When `OrderPlaced` is published, the stock is not reserved *yet*. UIs and APIs must be designed for that.
- **Harder to follow.** There is no single call stack. You need correlation IDs, distributed tracing and good event catalogs to see a whole flow.
- **Delivery semantics.** Most brokers are at-least-once: consumers must be **idempotent** and handle out-of-order events.
- **Schema evolution.** Events are a public contract. Version them, and prefer additive changes.
- **Dual writes.** Updating your database *and* publishing an event is not atomic. Use a transactional outbox or change data capture.

## Implementation notes

- Name events in the past tense after business facts (`OrderPlaced`), not as commands (`SendEmail`).
- Decide between **thin events** (IDs only, consumers call back for details) and **fat events** (carry the data). Fat events reduce coupling at runtime but make the schema a bigger contract.
- Watch **consumer lag** per subscription. It is the single best health signal in an event-driven system, and a natural autoscaling metric (for example KEDA scaling on queue length).
- Put a **dead-letter queue** behind every subscription so one poison message can't block the rest.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- Publish-Subscribe *(planned)* — Broadcast each message to every interested subscriber through a topic.
- Competing Consumers *(planned)* — Several workers pull from one queue, so work is shared and throughput scales out.
- [Queue-Based Load Leveling](../queue-based-load-leveling/) — A queue absorbs traffic spikes so the backend can work at a steady pace.
- [Transactional Outbox](../transactional-outbox/) — Save the event in the same database transaction as the data, then relay it: no dual-write gap.
- Saga (Choreography) *(planned)* — Services react to each other's events to complete a workflow, with no central coordinator.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.
- [Dead-Letter Queue](../dead-letter-queue/) — Park messages that keep failing so they stop blocking the queue and can be inspected.
- [CQRS](../cqrs/) — Separate the write model (commands) from read models (queries), each optimised for its job.

## References

- [Azure Architecture Center — Event-driven architecture style](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/event-driven)
- [Martin Fowler — What do you mean by "Event-Driven"?](https://martinfowler.com/articles/201701-event-driven.html)
- [AWS — What is an event-driven architecture?](https://aws.amazon.com/event-driven-architecture/)
- [Enterprise Integration Patterns — Publish-Subscribe Channel](https://www.enterpriseintegrationpatterns.com/patterns/messaging/PublishSubscribeChannel.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
