<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🏛️ Application Architecture](../../README.md#application-architecture)

# Microservices

> Small, independently deployable services, each owning one business capability and its data.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Microservices" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/microservices.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Split by capability** | The monolith is one deployable unit over one shared database, so every change ships together and any module can reach into any table. Split it along **business capabilities** (Catalog, Orders, Payments, Inventory): each service gets its own codebase, its own deployment and its **own database**, which other services reach only through its API or its events. |
| **2 · Independent deploy & scale** | Each service has its own version and release cadence. The Payments team rolls out **v2** on its own schedule, with no coordinated release, while Catalog and Orders keep serving requests on their current versions. When Catalog comes under load, only Catalog **scales out** (to three instances here); nothing else is redeployed or resized. |
| **3 · Sync queries, async events** | Use a **synchronous** call when the caller needs the answer now: `GET /products` waits for Catalog's response. Between services, announce a **state change** as an event instead of calling everyone who cares: Orders saves the order, replies, and publishes `OrderPlaced`; the broker delivers a copy to Payments and to Inventory, and each one updates its own data at its own pace. |
| **4 · Contain failures** | Payments crashes. Orders never calls it directly, so orders are still accepted, Inventory keeps consuming, and the `OrderPlaced` events for Payments **wait in its queue** on the broker. Catalog doesn't notice. When Payments recovers it works through the backlog and catches up: the failure stayed inside one service, and orders placed during the outage are simply paid a little later. |
<!-- END GENERATED: header -->

## The problem

A monolith keeps every capability in one codebase that is built, tested and deployed as a single unit, usually on top of one shared database. For a young product and a small team that is the right choice. As the product and the organization grow, the same properties start to hurt:

- **Every change ships together.** Teams queue behind one release train, one team's bug blocks everyone's release, and a one-line fix means redeploying everything.
- **Everything scales together.** The catalog takes most of the load, but the only way to add capacity is to run more copies of the whole application.
- **The shared database couples everything.** Any module can read or write any table, so a schema change made by one team can break code owned by another, and nobody is sure who depends on what.
- **One fault can take everything down.** A memory leak or a runaway query in one module shares the process, the connection pool and the database with all the others.
- **One stack for everything.** Every capability is tied to the same language, framework and database, whether they fit or not.

## How it works

James Lewis and Martin Fowler describe the style as "an approach to developing a single application as a suite of small services, each running in its own process and communicating with lightweight mechanisms, often an HTTP resource API." In practice:

- **One business capability per service.** Boundaries follow the domain (catalog, orders, payments, inventory), typically a bounded context from domain-driven design, not technical layers such as UI, logic and data.
- **Independently deployable.** Each service has its own codebase, pipeline, version and release schedule, and scales on its own. Shipping Payments v2 needs nobody else's release.
- **Owns its data.** A service keeps its data private (its own tables, schema or database server), and other services get at it only through its API or its events, never by querying its tables. Each one can pick the storage that suits it.
- **Communicates deliberately.** A synchronous call (HTTP or gRPC) suits a query whose caller needs the answer now. A state change that other services care about goes out as an asynchronous event through a broker ([Event-Driven Architecture](../event-driven-architecture/)), so the publisher doesn't depend on its consumers being up, or even known.
- **Smart endpoints, dumb pipes.** Business logic lives in the services. The gateway and the broker route and deliver messages; they hold no business rules.
- **Designed for failure.** Any remote call can fail or hang, so callers use timeouts and fallbacks, and a service that goes down should degrade one feature, not the whole system.

Around the services sits shared infrastructure: an [API Gateway](../api-gateway/) as the single entry point for clients, a message broker, a container platform that schedules, restarts and scales each service, and observability that can follow one request across all of them.

**Teams and Conway's law.** Melvin Conway observed in 1968 that a system's design ends up copying the communication structure of the organization that designs it. Microservices put this to work: each service belongs to one long-lived team that builds it and runs it in production, and service boundaries go where teams should be able to work without coordinating. Reorganizing teams to get the architecture you want is called the *inverse Conway maneuver*. It helps, but it won't fix a rigid architecture on its own. A service that several teams must change together, or a feature that always needs releases from three teams, means the boundaries and the organization disagree.

**How big is a service?** Size is a consequence, not a goal. Start from business capabilities: a service should be small enough for one team to own and understand, and big enough that most changes stay inside it. Things that change together belong together. Two services that always deploy in lockstep, or call each other many times per request, are probably one service cut in the wrong place: a *distributed monolith* with all the costs below and few of the benefits. Splitting a coarse service later, along a seam that has proven stable, is usually cheaper than merging services that were cut too fine.

## When to use it

- Several teams deliver on a large, complex domain, and coordinated releases have become the bottleneck.
- Parts of the system have clearly different needs for scale, availability, release frequency, security or technology.
- You can provision, deploy and monitor services automatically, and the teams that build services are ready to run them. Without that, many services multiply the toil.
- **Not** for a small team, an early product whose domain is still shifting, or a system that simply isn't that big. Fowler notes that microservices carry a significant premium that only pays off in more complex systems, and that almost all successful microservice stories started with a monolith that got too big and was broken up. Start with a **modular monolith** instead: one deployable made of strongly bounded modules that talk through explicit interfaces and each keep their own tables. It delivers most of the design benefits without the distributed-systems bill, lets you find the right boundaries while they are still cheap to move, and a clean module is the easiest thing to extract later with the [Strangler Fig](../strangler-fig/) pattern.

## Trade-offs

You trade complexity inside one codebase for complexity between many processes, and the second kind costs more.

- **The network.** In-process calls become remote calls that are slower and can time out or fail halfway. Every call needs a timeout, retries need idempotent operations, and a [Circuit Breaker](../circuit-breaker/) keeps one slow dependency from tying up its callers. Synchronous chains compound: if each of three services in a chain is available 99.9% of the time, the chain is available only about 99.7% of the time.
- **Consistency.** There is no ACID transaction across services, so data is eventually consistent. In the diagram, an order is accepted before it is paid, and UIs and APIs must be designed for that. Multi-service workflows use a [Saga](../saga-orchestration/) instead of a distributed transaction; updating a database and publishing an event reliably calls for a transactional outbox or change data capture; a query that joins data owned by several services needs API composition or a read model built from their events (CQRS).
- **Observability.** One user request crosses many processes. Without correlation IDs, centralized logs, per-service metrics and [Distributed Tracing](../distributed-tracing/), finding where it failed or slowed down is guesswork.
- **Operations.** Dozens of services mean dozens of pipelines, databases, configurations, secrets, dashboards and on-call rotations. That only works with heavy automation, usually provided by a platform team.
- **Contracts and testing.** APIs and event schemas become contracts between teams. Change them in backward-compatible steps, version them when you can't, and test them with contract tests rather than relying only on slow end-to-end environments.
- **What you get for it:** independent deployment and scaling, failure isolation (when communication is designed for it), teams that move without waiting for each other, and a free choice of technology per service.

## Implementation notes

- **Calls and events.** Use HTTP/REST or gRPC for request/response, and a broker such as Apache Kafka, RabbitMQ, Amazon SNS with SQS, Azure Service Bus or Google Cloud Pub/Sub for events. Give each consuming service its own durable subscription or consumer group, so a slow or failed consumer builds up its own backlog and nobody else's, and keep events long enough to outlast the longest outage you expect.
- **Data ownership.** Private tables, a private schema or a private database server per service all work, as long as no other service touches them. Separate schemas on a shared server are a cheaper start; enforce the boundary with credentials, not conventions.
- **Platform.** Containers on an orchestrator (Kubernetes, or managed options such as Azure Container Apps, Amazon ECS and Google Cloud Run) handle placement, health checks, restarts and per-service autoscaling, for example a Kubernetes HorizontalPodAutoscaler adding replicas to the one service under load.
- **Traffic.** An API gateway at the edge handles authentication, rate limits and routing. Between services, client libraries or a service mesh add mutual TLS, timeouts, retries and traffic shifting.
- **Delivery.** One pipeline per service, small releases rolled out gradually ([Canary Release](../canary-release/), feature flags), and consumer-driven contract tests for HTTP and message contracts (for example with Pact).
- **Observability.** Instrument every service with OpenTelemetry, and carry the trace context in message headers as well, so a trace continues through the broker.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Modular Monolith](../modular-monolith/) — One deployable unit built from strongly bounded modules that talk through explicit interfaces.
- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- [Database per Service](../database-per-service/) — Each service owns its data; others go through its API or events, never its tables.
- [Saga (Orchestration)](../saga-orchestration/) — A coordinator runs local transactions in sequence and triggers compensations when one fails.
- [Service Mesh](../service-mesh/) — Sidecar proxies plus a control plane: mTLS, retries and traffic shifting without touching app code.
- [Strangler Fig](../strangler-fig/) — Put a facade in front of the legacy system and move routes to new services one at a time.
- [Distributed Tracing](../distributed-tracing/) — Propagate a trace context across services and assemble the spans into one timeline.

## References

- [James Lewis and Martin Fowler — Microservices (2014)](https://martinfowler.com/articles/microservices.html)
- [Azure Architecture Center — Microservices architecture style](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/microservices)
- [Chris Richardson (microservices.io) — Pattern: Microservice Architecture](https://microservices.io/patterns/microservices.html)
- [Sam Newman — Building Microservices (2nd edition)](https://samnewman.io/books/building_microservices_2nd_edition/)
- [Martin Fowler — Microservice Trade-Offs](https://martinfowler.com/articles/microservice-trade-offs.html)
- [Martin Fowler — Monolith First](https://martinfowler.com/bliki/MonolithFirst.html)
- [Martin Fowler — Conway's Law](https://martinfowler.com/bliki/ConwaysLaw.html)
- [Melvin E. Conway — How Do Committees Invent? (1968)](https://www.melconway.com/Home/Committees_Paper.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
