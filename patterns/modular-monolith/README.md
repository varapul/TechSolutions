<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🏛️ Application Architecture](../../README.md#application-architecture)

# Modular Monolith

> One deployable unit built from strongly bounded modules that talk through explicit interfaces.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Modular Monolith" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/modular-monolith.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One unit, clear modules** | The whole application is built, released and run as **one unit**. Inside it, each module (Orders, Catalog, Shipping, Payments) owns one business capability, its code and its own tables. When Orders needs something from Catalog it calls Catalog's public API, and that is an ordinary in-process call: no network hop and no serialisation. |
| **2 · Boundaries are enforced** | Two shortcuts are tried: code in Orders reaches into Catalog's internals, and a query in Orders joins Catalog's tables. Inside one codebase and one database both would simply work, so the boundary is checked in the **build**: both are reported as violations and the build fails, while the call through Catalog's public API passes. Without that check the modules decay, one convenient shortcut at a time, into a tangle. |
| **3 · Interfaces and events** | Modules work together in the same two styles that services use. Orders **asks** Catalog a question through its API and waits for the answer. Then it **announces** `OrderPlaced` as an in-process event; Shipping and Payments have subscribed and react, and Orders does not know who is listening. There is no network and no broker in between. |
| **4 · Extract only for a reason** | Payments now has to scale and be released on its own. Because its boundary is already clean, it can move out: its API becomes a network API, its schema becomes its own database, and calls to it now cross the network. The other three modules stay together in one deployment. Most modules never need this step: extraction answers a concrete need, it is not the goal. |
<!-- END GENERATED: header -->

## The problem

A system is divided twice: into pieces of **code** that people can understand and change, and into pieces that are **deployed**. Two common designs treat these as one decision, and each gets one half wrong.

- **A monolith with no inner boundaries.** Everything ships together, which is simple, but nothing separates one part of the code from another. Any class may call any class and any query may join any table, so sooner or later every shortcut is taken. A change to pricing breaks checkout, nobody can say what the catalog's interface is, teams wait on each other's changes, and the build and the test suite grow with the whole. This is the "big ball of mud".
- **Microservices adopted to get boundaries.** A network between the parts does force them apart, but it is an expensive way to buy modularity: every call can fail or be slow, no transaction spans two services, each service needs its own pipeline, monitoring and on-call, and a boundary drawn in the wrong place is hard to move. Martin Fowler calls this cost the [microservice premium](https://martinfowler.com/bliki/MicroservicePremium.html) and advises against microservices unless the system is too complex to manage as a monolith. In [Monolith First](https://martinfowler.com/bliki/MonolithFirst.html) he reports that almost all the successful microservice stories he had heard began as a monolith that grew too big, while nearly every system he knew of that was built as microservices from scratch had run into serious trouble.

Poor structure is also not cured by distribution. Simon Brown's [well-known remark](https://simonbrown.je/modular-monolith/) from 2015 is that a team which cannot build a monolith properly will not be helped by microservices; the same tangle, spread over a network, is only harder to untangle.

## How it works

A modular monolith makes the two decisions separately. It keeps **one deployable unit** and puts strong boundaries *inside* it. Kamil Grzybek's [primer](https://www.kamilgrzybek.com/blog/posts/modular-monolith-primer) defines the words exactly this way: a monolith is a system with exactly one deployment unit, nothing more, and "modular" describes how its inside is designed.

**What makes a monolith modular**

- **Cohesive modules around business capabilities.** Orders, Catalog, Shipping and Payments are vertical slices: each one holds everything its capability needs, from its API down to its tables. In domain-driven design terms a module is usually one bounded context. Simon Brown's "package by component" is the same idea applied to code organisation: everything one coarse-grained component is responsible for sits in one package behind a public interface, instead of being spread over technical layers.
- **A small public API each.** A module shows the rest of the application a few interfaces, the data types they exchange and the events it publishes. Everything else (domain classes, persistence, helpers) is internal, and in the diagram it sits behind the lock.
- **Private data.** A module's tables belong to it. No other module reads them, writes them, joins them or holds a foreign key into them. Data is obtained by asking the owner's API or by listening to its events.
- **No shortcuts.** Dependencies between modules are declared, few and free of cycles, and a module is only ever used through its API. This is the rule that erodes first, which is why it has to be checked by a machine (step 2).

Inside its boundary a module is free to be organised as it likes: a small one may be a handful of classes, a complex one may be a [hexagon](../hexagonal-architecture/) of its own.

**How the boundary is enforced**

A convention that only lives in a wiki does not survive deadlines. The check belongs in the build, and it should be as close to the compiler as the stack allows. The tools below are examples, not requirements.

- **Language module systems.** A Java module (`module-info.java`) exports only the packages it names, and the others are inaccessible from other modules at compile time and at run time. Without Java modules, package-private classes already hide a module's implementation from other packages. In Go, a package under a directory named `internal` can be imported only from inside the tree that contains that directory, and the `go` command refuses anything else. `internal` in C# limits a type to its assembly, and `internal` in Kotlin to its compilation module, so one project per module gives a boundary the compiler checks.
- **Build-level dependency rules.** When each module is its own build unit (a Gradle subproject, a Maven module, a .NET project, a Bazel package), it can only see the modules it declares. Gradle's `implementation` configuration keeps a module's own dependencies off its consumers' compile classpath, unlike `api`. Bazel targets are private to their package unless their `visibility` is widened. Nx offers the `@nx/enforce-module-boundaries` lint rule, driven by tags on projects.
- **Architecture tests.** Where the language cannot express the rule, a test that fails the build can: ArchUnit for Java (slices that must be free of cycles, modules with declared allowed dependencies and exposed packages), ArchUnitNET and NetArchTest for .NET, dependency-cruiser for JavaScript and TypeScript, Import Linter for Python, Packwerk for Ruby on Rails, Deptrac for PHP.
- **A framework's module support.** [Spring Modulith](https://docs.spring.io/spring-modulith/reference/) treats each direct sub-package of the application's main package as a module. The module's base package is its API and its sub-packages are internal. Calling `ApplicationModules.of(Application.class).verify()` in a test fails on a cycle between modules and on any reference into another module's internal package, and a module can list the only modules it is allowed to depend on.

For an existing codebase with hundreds of violations, record them as a baseline and fail only on new ones (ArchUnit's `FreezingArchRule`, Packwerk's `package_todo.yml` files), then shrink the baseline.

**The database**

Data is separated in the same spirit, and usually in three stages of increasing strength:

1. **Separate tables.** Each table has one owning module, by naming convention. Cheap, and enforced only by review.
2. **Separate schemas**, as in the diagram. Each module gets its own schema in the shared database and connects with its own database role, which has privileges on that schema only. In PostgreSQL the roles are what make this real: schemas inside one database are not walled off from each other, and a role can reach the objects of any schema it holds privileges on (starting with `USAGE` on the schema itself). In MySQL a schema and a database are the same thing, so this stage already means one database per module on a shared server.
3. **Separate databases**, still used by the one application. This is the last stop before a module can leave.

At every stage the rules are the same: **no joins and no foreign keys across modules**. A reference to another module's row is stored as a plain identifier. A screen or report that needs data from several modules either composes it from their APIs or reads a model built from their events (see [CQRS](../cqrs/)).

The data shortcut is caught differently from the code shortcut. A dependency check sees a join only when it is written through the other module's entity classes, which are internal types; a join inside an SQL string is invisible to it. The per-module database role closes that gap: the query fails for lack of privileges the first time the module's tests run it, in the same build.

**Transactions**

- **One module, one transaction.** A use case changes its own module's tables and commits.
- **Events between modules.** What other modules must do in response travels as an event and runs in their own transactions, so modules are consistent with each other *eventually*. An event that is published in memory after the commit is lost if the process dies at that moment, so record it in the same transaction as the change (a [transactional outbox](../transactional-outbox/)) and make the handlers [idempotent](../idempotent-consumer/).
- **In-process does not mean asynchronous.** Check what your event mechanism actually does. In Spring, a plain event listener runs synchronously in the publisher's thread and inside the publisher's transaction, and a `@TransactionalEventListener` runs after the commit by default. Spring Modulith's `@ApplicationModuleListener` combines an asynchronous listener, a transaction of its own and after-commit delivery, and its event publication registry writes an entry for each listener in the original transaction and marks it complete when the listener succeeds, so unfinished deliveries can be resubmitted.
- **A shared transaction as a deliberate exception.** Because the modules share a process and a database, a use case *can* update two modules in one database transaction. That is a real advantage over services, where the same need takes a [saga](../saga-orchestration/). Use it sparingly and on purpose: it couples the two modules' locks and failures, and that pair cannot be separated later until the flow is redesigned.

**Calls and events point in opposite directions.** When Orders calls Catalog's API, Orders depends on Catalog. When Orders publishes `OrderPlaced`, Shipping and Payments depend on an event type that Orders owns, and Orders depends on nobody. Choosing between the two is how you keep the dependency graph between modules acyclic.

## When to use it

- **As the default starting point.** For a new product, or a domain you are still learning, module boundaries inside one codebase are cheap to move: a refactoring, one commit, checked by the compiler. The same change between services is a migration.
- **One team or a few teams** that do not need to release on separate schedules.
- **An existing monolith that hurts.** Modularising in place is less risky than a rewrite, and it is the preparation any later extraction needs anyway.
- **When operations should stay simple:** one pipeline, one artefact, one thing to run, monitor and debug.

It is not enough, on its own, when a part of the system has clearly different needs: a very different load or resource profile, a different availability or security requirement, a different technology, or so many teams that one release train has become the bottleneck. That is what step 4 is for.

## Trade-offs

**What it keeps from a monolith**

- **Simple deployment.** One build and one release. There are no cross-service version combinations to test.
- **Local calls.** A call between modules is a method call: fast, typed, with no serialisation, no timeout to choose, no partial failure, and one stack trace when it goes wrong.
- **One transaction when you need it** (see above).
- **Easy refactoring across modules.** Moving a responsibility, renaming an API or redrawing a boundary changes both sides in one commit.

**What it does not give you**

- **Independent scaling.** The unit scales as a whole. You can run more copies of the application, but not more copies of Payments only.
- **Independent releases.** Every change rides the same release, and one module's bad change can block or roll back everyone's.
- **Fault isolation.** Modules share a process, its memory, its threads and its connection pool. A memory leak, a crash or a runaway query in one module hurts all of them.
- **Different technology per module.** One language, one runtime, one framework version, and upgrades happen for everybody at once.

**What it costs**

- **Discipline, backed by tooling.** An in-process boundary is easy to cross, and the check has to stay switched on. Fowler's article gives the counter-argument a fair hearing: the discipline needed to keep a monolith cleanly separable may be more than most teams can sustain.
- **Builds and tests that grow** with the codebase, unless the build is made incremental (below).
- **Design work up front.** Public APIs, events and data ownership have to be thought through, and module boundaries drawn in the wrong place are as unhelpful here as anywhere, only cheaper to fix.

## Implementation notes

- **A layout that makes the rule visible.** The top level of the codebase names the business capabilities, and each module separates what it offers from what it hides:

  ```text
  shop/
    orders/
      api/         interfaces, data types and events: all that other modules may import
      internal/    domain logic, persistence, event handlers
      migrations/  the orders schema, owned here
    catalog/   shipping/   payments/     the same shape
    main           wires the modules together and starts the one process
  ```

- **Team ownership per module.** Give every module one owning team and write it down where the tools can use it: a code owners file (on GitHub, the owners are requested for review automatically when a pull request touches their paths), alert and error routing by module, and the module's public API reviewed by its owners. Shopify reports that explicit ownership of each component lets it triage exceptions to the right team automatically.
- **Long builds and one release train.** These are the price of one deployable, and large teams manage them rather than escape them:
  - *Build and test only what a change affects.* Modules that are separate build units let the build tool skip or cache the untouched ones, and a clean dependency graph makes test selection possible. Shopify [cut the 95th-percentile CI time](https://shopify.engineering/faster-shopify-ci) of its core monolith from about 45 minutes to 18 through faster container start-up, caching, parallel steps and running only the tests related to a change.
  - *Keep the main branch releasable.* A merge queue runs CI on each change before it lands. Shopify's [rules for its queue](https://shopify.engineering/successfully-merging-work-1000-developers) are that the main branch is always green, stays close to production, and still lets an emergency fix through quickly.
  - *Separate release from deployment.* Deploy small changes often and switch features on with [feature flags](../feature-flags/), so that an unfinished feature in one module does not hold back the others, and limit the blast radius of each deployment with a [canary](../canary-release/).
  - *Test a module on its own.* Start only one module with its collaborators stubbed at their APIs (Spring Modulith's `@ApplicationModuleTest` does this), and keep a small end-to-end suite for the whole application.
- **Common ways it fails.**
  - *A shared module that grows.* `common`, `core` or `utils` attracts business concepts until every module depends on it and it changes with every feature. Keep shared code small, technical and stable. Shopify found that, early on, every component depended on more than half of the others and that the graph was full of cycles, which made components impossible to reason about separately.
  - *Reaching into another module's tables:* a join, a foreign key, a shared ORM entity or a reporting query that bypasses the owner.
  - *Boundaries drawn around technical layers.* "Modules" named controllers, services and repositories are layers, and every feature then touches all of them.
  - *A public API that is too wide.* If everything is public, a package is only a folder. Shopify's retrospective on Packwerk makes a related point: checking for use of a public API is not enough if nobody asks whether the dependency should exist at all, and the tool's privacy checks were removed in version 3.0 (they live on in a separate extension) to return the focus to the dependency graph.
  - *A baseline of violations that never shrinks,* or a check that someone switched off.
  - *Chatty APIs.* Thousands of tiny calls are harmless in-process and ruinous after extraction, so design module APIs around whole business operations.
- **When to extract a module.** Have a reason you can measure: a load profile that needs its own scaling, a release rhythm the shared train cannot serve, an isolation or compliance requirement, or a technology the rest should not adopt. "It is big" and "microservices are modern" are not reasons. Most modules stay where they are.
- **How to extract.** The work is mostly finished before the move, which is the point of the pattern:
  1. Make the boundary truly clean: no cross-module joins, no shared transactions, and every caller going through the API.
  2. Put the API behind an interface with two implementations, the in-process module and a remote client, and switch between them by configuration (branch by abstraction).
  3. Move the data: the module's schema becomes its own database (database per service), with the application still reaching it only through the API.
  4. Deploy the module as a service and shift traffic to it gradually, as in a [Strangler Fig](../strangler-fig/) migration.
  5. Replace in-process events with messages on a broker (see [Event-Driven Architecture](../event-driven-architecture/)), and give the new remote call what a local call never needed: a timeout, [retries](../retry-with-backoff/) that are safe to repeat, and a [circuit breaker](../circuit-breaker/).

  From then on the trade-offs of [microservices](../microservices/) apply to that module. Sam Newman's book *Monolith to Microservices* covers these migration steps and the database decomposition in depth.
- **A real example: Shopify.** In 2019 Shopify [described](https://shopify.engineering/deconstructing-monolith-designing-software-maximizes-developer-productivity) choosing a modular monolith over microservices for its core Rails application: one codebase and one deployment, with code reorganised by business domain into components and boundaries that are enforced. Its [2020 follow-up](https://shopify.engineering/shopify-monolith) puts the monolith at over 2.8 million lines of Ruby in 37 components and is frank about the lessons: polishing public interfaces first, while ignoring the dependency graph, mostly added a layer of indirection, and a call-graph tool that needed more than an hour per run was replaced by Packwerk, a static analysis that runs in minutes inside the pull request workflow. The [2024 retrospective](https://shopify.engineering/a-packwerk-retrospective) reviews what the tool did and did not achieve.
- **Research direction: let a runtime choose the deployment.** Google's HotOS 2023 paper, *Towards Modern Development of Cloud Applications*, proposes writing an application as a logical monolith of components, letting a runtime decide which components share a process, and always rolling out the whole application atomically. Its prototype reduced latency by up to 15 times and cost by up to 9 times against the status quo. The open-source implementation, [Service Weaver](https://github.com/ServiceWeaver/weaver), stopped active development in December 2024 and its repository is now archived, so treat it as an idea rather than a product.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Microservices](../microservices/) — Small, independently deployable services, each owning one business capability and its data.
- [Layered (N-Tier)](../layered-architecture/) — Presentation, business and data layers; each layer only calls the one directly below it.
- [Hexagonal (Ports & Adapters)](../hexagonal-architecture/) — Domain logic at the core; UIs, databases and queues plug in through ports and adapters.
- [Strangler Fig](../strangler-fig/) — Put a facade in front of the legacy system and move routes to new services one at a time.
- [Database per Service](../database-per-service/) — Each service owns its data; others go through its API or events, never its tables.
- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.
- [Branch by Abstraction](../branch-by-abstraction/) — Introduce an abstraction, build the new implementation behind it, then switch over.

## References

- [Martin Fowler — Monolith First](https://martinfowler.com/bliki/MonolithFirst.html)
- [Simon Brown — Modular monolith and "package by component"](https://simonbrown.je/modular-monolith/)
- [Kamil Grzybek — Modular Monolith: A Primer](https://www.kamilgrzybek.com/blog/posts/modular-monolith-primer)
- [Shopify Engineering — Deconstructing the Monolith: Designing Software that Maximizes Developer Productivity](https://shopify.engineering/deconstructing-monolith-designing-software-maximizes-developer-productivity)
- [Shopify Engineering — Under Deconstruction: The State of Shopify's Monolith](https://shopify.engineering/shopify-monolith)
- [Shopify Engineering — A Packwerk Retrospective](https://shopify.engineering/a-packwerk-retrospective)
- [Spring Modulith — Reference documentation](https://docs.spring.io/spring-modulith/reference/)
- [ArchUnit — User Guide](https://www.archunit.org/userguide/html/000_Index.html)
- [PostgreSQL documentation — Schemas](https://www.postgresql.org/docs/current/ddl-schemas.html)
- [Ghemawat et al. — Towards Modern Development of Cloud Applications (HotOS 2023)](https://sigops.org/s/conferences/hotos/2023/papers/ghemawat.pdf)
- [Sam Newman — Monolith to Microservices](https://samnewman.io/books/monolith-to-microservices/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
