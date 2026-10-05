<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🏛️ Application Architecture](../../README.md#application-architecture)

# Hexagonal (Ports & Adapters)

> Domain logic at the core; UIs, databases and queues plug in through ports and adapters.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Hexagonal (Ports &amp; Adapters)" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/hexagonal-architecture.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · In through an adapter** | An HTTP `POST /orders` reaches the **REST controller**, a driving adapter. It parses the request and turns it into a plain call on the `PlaceOrder` port. The core checks its business rule on its own objects: it knows nothing about HTTP, JSON or the web framework. |
| **2 · Out through driven ports** | To finish the job the core calls `OrderRepository`, `PaymentGateway` and `EventPublisher`. These **driven ports** are interfaces the core owns, written in its own language; the SQL, payment and broker adapters implement them and talk to the real database, provider and broker. The calls flow outward, but every source-code dependency points inward: adapters depend on the core, never the reverse. |
| **3 · Swap and add adapters** | The SQL adapter is unplugged and a document-store adapter takes its place behind the same `OrderRepository` port. A second driving adapter, a message consumer, is plugged in next to the REST controller: it takes an order from a queue and calls the same `PlaceOrder` port. Both changes happen outside. The hexagon and its ports stay exactly as they were. |
| **4 · Test the core on its own** | The production adapters are unplugged. A **test driver** calls the driving port directly and **in-memory fakes** stand behind the driven ports, so the business rules run in milliseconds with no network, database or framework. Each real adapter gets its own integration test against the real technology, and the core that was tested is the core that ships. |
<!-- END GENERATED: header -->

## The problem

Business rules drift into whatever technology happens to be nearby. A "place an order" rule ends up partly in a controller that reads the HTTP request, partly in a service written against ORM entities, and partly in a callback that calls the payment provider's SDK. Nothing in the code separates *what the business decided* from *how the request arrived* and *where the result went*, and the bill comes later:

- The rule can only be exercised through HTTP and with a database running, so its tests are slow, brittle and few.
- A second way in (a queue consumer, a batch import, a command line, a new API version) has to copy logic from the first, because the logic lives in the controller.
- Replacing the database, the payment provider or the web framework means editing business code, so early technology choices turn permanent.

## How it works

Draw one boundary around the business logic, and make everything that crosses it go through an explicit interface.

- **The core** (the inside of the hexagon) holds the domain model and the use cases. It is plain code in the business's own terms, with no HTTP, SQL or framework types in it.
- **Ports** are the interfaces on the boundary, and the core owns them. A **driving port** is something the application offers (`PlaceOrder`). A **driven port** is something it needs from outside (`OrderRepository`, `PaymentGateway`, `EventPublisher`).
- **Adapters** sit outside, and each one connects one technology to one port. A **driving adapter** (a REST controller, a message consumer, a command line, a test) turns an outside request into a call on a driving port. A **driven adapter** (a SQL repository, a payment client, a broker publisher, an in-memory fake) implements a driven port by talking to the real thing.
- **The dependency rule:** adapters depend on the core, never the reverse. On the driving side that comes naturally, since the controller calls the port. On the driven side the *call* goes outward, from the core to the database, while the *source-code dependency* points inward: the core declares the interface and the adapter implements it. This is dependency inversion, and it is what lets steps 3 and 4 happen without touching the core.
- **Wiring:** at start-up a small piece of code outside the core (the *composition root*: `main`, or the dependency-injection configuration) chooses the adapters and hands them to the core. It is the only place that knows every concrete class.

**Where it comes from.** Alistair Cockburn described the pattern in [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture) (2005), which also gives it the more descriptive name *Ports and Adapters*. The aim was an application that does not care who is driving it (a person, another program, a batch script or an automated test) and that can be built and tested on its own, with no real database or device attached. With Juan Manuel Garrido de Paz he later expanded the article into the book *Hexagonal Architecture Explained* (2024).

**Why a hexagon.** The number six means nothing. The shape breaks the habit of drawing layers with a top and a bottom, and its flat sides leave room to draw several ports, each with several adapters. In the article Cockburn reports two, three or four ports as typical. How finely to cut them is a judgement call between two extremes: a port for every use case, or a single port for each side.

**Driving and driven.** Cockburn's terms are *primary* and *secondary*, after the primary and secondary actors of use cases; driver/driven, inbound/outbound and input/output name the same distinction. The test is who starts the conversation: a driving actor triggers the application, a driven actor is triggered by it. By convention the driving side is drawn on the left and the driven side on the right. The two sides are wired differently (a driving adapter *calls* its port, a driven adapter *implements* its port), but the dependency points inward on both.

**Ports speak the core's language.** A port is shaped by what the core needs, not by what a technology offers: `OrderRepository.save(order)`, not `execute(sql)`; `PaymentGateway.charge(total)`, not `post(url, json)`; `EventPublisher.publish(event)`, not `send(topic, bytes)`. The classic mistake is a port that mirrors a technology: a `KafkaPort`, an `HttpClientPort`, a repository that returns ORM entities or accepts query fragments. Such a port keeps the technology's concepts inside the core and can only ever have one real adapter, so the swap in step 3 would mean changing the core after all. A useful check: could this port be implemented by a completely different technology, or by a hash map in a test, without touching its signature?

**Relatives.**

- *Layered architecture.* In the usual three layers, presentation depends on the domain and the domain depends on data access. Hexagonal keeps the first dependency and reverses the second, so that persistence depends on the domain. Martin Fowler notes that this variation of layering is what people often mean by hexagonal architecture.
- *Onion architecture* (Jeffrey Palermo, 2008) and *Clean Architecture* (Robert C. Martin, 2012) draw the same idea as concentric rings and add structure inside the boundary: a domain model at the centre with domain and application services around it, or entities, use cases, interface adapters and frameworks. Both state the same rule, that dependencies point only toward the centre, and both name hexagonal architecture among their close relatives. Cockburn's pattern itself says nothing about the inside: it separates inside from outside and stops there.

## When to use it

- The application has real business rules, and they will outlive the current framework, database or provider.
- The same logic must be reachable in more than one way: an API and a queue consumer, a UI and a batch import, today's REST and whatever comes next.
- A dependency is expected to change or is not chosen yet: a store to be decided later, a monolith's API that a new service will replace, a provider that may be swapped. A port lets the decision wait.
- Fast, reliable tests of business behaviour matter, because the rules are complicated, regulated or change often.
- It works at more than one scale: a whole application, one [microservice](../microservices/) or one module of a modular monolith can each be a hexagon that reaches the others through driven ports.

**When not to use it:**

- **Simple CRUD.** If the application is forms over tables with hardly any rules, the core is an empty pass-through and the ports and mappers are pure overhead.
- **Short-lived code.** A prototype, a one-off migration script or an experiment will be thrown away before any adapter is swapped.
- **A team that will not keep the boundary.** A boundary that is crossed "just this once" costs all of the mapping and returns none of the benefits. If nobody will enforce it, a plain layered design is the more honest choice.

AWS's guidance makes the same point from the cost side: the extra adapter code pays for itself only when a component really has several inputs or outputs, or when they are expected to change.

## Trade-offs

- **Indirection.** Every crossing of the boundary is an interface call, and a reader has to follow it to find the implementation. Navigating and debugging take longer than in code that calls the database directly.
- **Mapping code.** The same order exists as a request DTO, a domain object, a table row and an event payload, with a mapper between each pair. It is dull code, and it is where field-by-field bugs hide. Many teams allow persistence annotations on domain classes to avoid a second model; that is a hole in the boundary, so make it a decision rather than an accident.
- **More types and more wiring.** Ports, adapters, commands, fakes and the composition root all have to be written, named and kept in step.
- **A port hides an API, not behaviour.** Swapping SQL for a document store is easy only if the port never promised what only SQL can do, such as ad-hoc queries or one transaction across several aggregates. Consistency, latency and failure modes show through any interface.
- **Performance.** An interface call and an object mapping are small next to the network or disk call behind them, but they are not free, and AWS lists the added layer as a possible source of latency. A hot read path sometimes deserves a narrower port that returns exactly the shape the caller needs.
- **Fakes can lie.** A core that passes against an in-memory fake proves nothing about the real adapter. The adapter tests below are not optional.

## Implementation notes

- **Mapping lives in the adapters.** Each adapter converts between its own representation (request body, row, message schema, provider response) and the core's types, in both directions. The core never imports an adapter's types.
- **Validation is split.** An adapter checks what belongs to its technology: the JSON parses, the date is a date, the caller is authenticated. Business rules (credit limit, stock, allowed state changes) are checked in the core, so that every way in, including a test, meets the same rules.
- **Transactions wrap the use case.** A repository adapter cannot know which other writes belong to the same business operation, so the boundary is set around the use case: by a decorator or interceptor supplied from outside the core, or by a small unit-of-work port. A database transaction covers only the database, so the three calls in step 2 are not atomic. Publish the event through a [transactional outbox](../transactional-outbox/), make the payment call idempotent so that a retry cannot charge twice, and be ready to refund if the order cannot be saved.
- **Errors are translated too.** An adapter turns timeouts, SQL states and provider error codes into the core's own failures (`PaymentDeclined`, `OrderNotFound`). [Retries](../retry-with-backoff/), timeouts and [circuit breakers](../circuit-breaker/) belong in the driven adapter; handling redelivered messages belongs on the driving side (see [idempotent consumer](../idempotent-consumer/)).
- **Testing strategy.**
  - *Core tests* call the driving ports directly, with fakes behind the driven ports. They run in milliseconds, cover every business rule and make up the bulk of the suite. They test behaviour at the application boundary, not individual classes.
  - *Adapter integration tests* exercise each real adapter on its own against the real technology: the SQL adapter against a real database (for example in a container), the payment adapter against the provider's sandbox or a contract stub, the REST controller with real HTTP requests and a stubbed port.
  - *Shared contract tests* run one suite against both the fake and the real adapter of a port, so the fake cannot drift.
  - *A few end-to-end tests* go through everything, to check the wiring and configuration rather than the rules.
  - Netflix's Studio Workflows team describes the same split (business logic tested against mocked repositories, integration tests for each data source, a small number of specs through the whole stack) and reports that moving one entity's reads from a JSON API to a GraphQL data source took about two hours.
- **Enforce the rule in the build.** The strongest form is a module boundary: put the core in its own build module or package with no dependency on web, persistence or messaging libraries, and the compiler rejects the wrong import. Where that is impractical, add a dependency check that fails the build: ArchUnit for Java (its onion-architecture rule forbids dependencies from the core to adapters and between adapters), ArchUnitNET for .NET, dependency-cruiser for JavaScript and TypeScript, Import Linter for Python. In review, a framework import in the core or a technology type in a port signature is the smell to look for.
- **Keep adapters apart.** An adapter talks to the core, not to another adapter. A controller that reads straight from the SQL adapter "just for a list" has made a hole in the boundary. If reads need a shortcut, give them their own query port and read model (see [CQRS](../cqrs/)).
- **A layout that makes the rule visible:**

  ```text
  orders/
    core/        domain model, use cases and ports; no framework imports
    adapters/
      rest/  messaging/  sql/  payments/  broker/
    main         composition root: builds the adapters and injects them
  ```

- **Domain-driven design.** Hexagonal architecture is not part of DDD, but the two fit together: the hexagon is a natural home for one bounded context's model, and the ubiquitous language supplies the names of the ports.
- **Anti-corruption layer.** An [anti-corruption layer](../anti-corruption-layer/) is a driven adapter with a harder job. An ordinary adapter hides a technology; that one also hides another system's model, so it translates meaning as well as format.
- **Branch by abstraction.** A driven port is a ready-made abstraction for replacing an implementation gradually: keep the old and the new adapter behind the same port and switch between them by configuration.
- **Microkernel.** Both have a core and things that plug in, but a plug-in adds features to the product, while an adapter adds no business behaviour and only connects.
- **Examples, not requirements.** Any dependency-injection container (Spring, ASP.NET Core's built-in container, NestJS) or a hand-written `main` can be the composition root. AWS's example applies the pattern inside a single Lambda function behind an API Gateway REST API, keeping the domain logic apart from the code that reads and writes DynamoDB.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Layered (N-Tier)](../layered-architecture/) — Presentation, business and data layers; each layer only calls the one directly below it.
- [Modular Monolith](../modular-monolith/) — One deployable unit built from strongly bounded modules that talk through explicit interfaces.
- [Anti-Corruption Layer](../anti-corruption-layer/) — A translation layer that keeps a legacy model from leaking into the new domain.
- [Microservices](../microservices/) — Small, independently deployable services, each owning one business capability and its data.
- [Microkernel (Plug-in)](../microkernel/) — A minimal core system extended by independent plug-in modules.
- [Branch by Abstraction](../branch-by-abstraction/) — Introduce an abstraction, build the new implementation behind it, then switch over.
- [CQRS](../cqrs/) — Separate the write model (commands) from read models (queries), each optimised for its job.

## References

- [Alistair Cockburn — Hexagonal Architecture (the original 2005 article)](https://alistair.cockburn.us/hexagonal-architecture)
- [Juan Manuel Garrido de Paz — Ports and Adapters Pattern (Hexagonal Architecture)](https://jmgarridopaz.github.io/content/hexagonalarchitecture.html)
- [Jeffrey Palermo — The Onion Architecture: part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/)
- [Robert C. Martin — The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [Martin Fowler — Presentation Domain Data Layering](https://martinfowler.com/bliki/PresentationDomainDataLayering.html)
- [AWS Prescriptive Guidance — Hexagonal architecture pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/hexagonal-architecture.html)
- [Netflix Technology Blog — Ready for changes with Hexagonal Architecture](https://netflixtechblog.com/ready-for-changes-with-hexagonal-architecture-b315ec967749)
- [ArchUnit User Guide — Onion Architecture](https://www.archunit.org/userguide/html/000_Index.html#_onion_architecture)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
