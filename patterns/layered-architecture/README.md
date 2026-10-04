<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🏛️ Application Architecture](../../README.md#application-architecture)

# Layered (N-Tier)

> Presentation, business and data layers; each layer only calls the one directly below it.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Layered (N-Tier)" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/layered-architecture.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One job, closed layers** | A **Place order** request enters **Presentation**, which reads the form and, at the end, renders the answer. Presentation calls **Business**, which checks stock and applies the discount rule; Business calls **Data access** to save the order, and only Data access talks to the database. Each layer depends only on the layer directly beneath it: the layers are **closed**, so a call never skips a layer or goes back up. |
| **2 · Change one layer** | Because each layer sees only the interface of the one below, a change can stay inside one layer. The database product is replaced and only the data access code is rewritten, since Business still calls the same `OrderRepository` interface; a JSON API is added next to the HTML pages and only Presentation changes. The same seam lets Business be **tested on its own** against an in-memory fake, with no database. |
| **3 · Layers are not tiers** | **Layers** organise code; **tiers** are where it runs. The same three layers can run as one process on one server, or as web, application and database **tiers** with a network hop between each. Tiers can be scaled and secured separately (the web tier in a public subnet, the others in private subnets that admit only the tier above), but every hop adds latency and one more call that can fail. |
| **4 · Three traps** | **Sinkhole:** a simple read passes through every layer and none of them adds anything. **Open layer:** Business is marked open so that reads can skip it and Presentation calls Data access directly; that is quicker, but Presentation now depends on Data access too. **Changes cut across:** one new field touches every layer, because the layers split the code by technical role rather than by feature. Vertical modules ([modular monolith](../modular-monolith/)) and a core that doesn't depend on the database ([hexagonal](../hexagonal-architecture/)) are the usual answers. |
<!-- END GENERATED: header -->

## The problem

Left to itself, code gets sorted by convenience. A controller runs a SQL query because the connection is right there, a pricing rule ends up in a view template because that is where the price is shown, and a stored procedure quietly grows a discount calculation. Each shortcut is small. Together they make every change risky: nobody can say where a piece of logic belongs, a change to a screen or a table ripples into unrelated code, and the business rules can only be exercised with a browser and a database running. Microsoft's .NET architecture guide describes how a single-project application drifts this way, with business logic spread across folders and no clear rule about which classes may depend on which, until the result is spaghetti code.

## How it works

Split the code by responsibility into a stack of horizontal **layers**. Each layer serves the layer above it and uses only the layer below it.

**The usual layers.**

- **Presentation** turns the outside world into calls and the results back into something a person or a program can read: controllers, views, API endpoints, parsing the input and rendering the answer.
- **Business** (or domain) holds what the application is for: rules, calculations and workflows. In the diagram it checks stock and applies the discount rule.
- **Data access** (persistence) hides how data is stored: repositories, data mappers, SQL, the ORM.
- **The database** sits at the bottom. Some descriptions count it as a fourth layer; others treat it as an external resource that the data access layer talks to.

Microsoft's guide abbreviates the classic three as UI, BLL (business logic layer) and DAL (data access layer), and [Martin Fowler](https://martinfowler.com/bliki/PresentationDomainDataLayering.html) names them presentation, domain and data source. Frameworks often build the split into their vocabulary: Spring documents its `@Controller`, `@Service` and `@Repository` stereotypes as markers for the presentation, service and persistence layers.

A common four-layer variant comes from domain-driven design and splits the middle in two. A thin **application** layer runs one use case at a time and coordinates the work, and a **domain** layer holds the business concepts and rules; infrastructure (persistence, messaging, other systems) sits below. Eric Evans's definitions, which Microsoft's DDD guidance reproduces, keep business rules out of the application layer entirely: it directs domain objects and delegates the decisions to them.

**Closed and open layers.** The [Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/n-tier) gives the two definitions: in a *closed* layer architecture a layer can call only the layer immediately below it, and in an *open* one it can call any layer below it. Closed is the default and the safer choice: Presentation goes through Business even to read something, and Business goes through Data access. An open layer is a layer that callers above may skip. It should be a deliberate, named exception, such as letting simple reads go from Presentation straight to Data access, and each one adds a dependency that jumps over a layer.

**Layers of isolation.** The payoff of closed layers is what Mark Richards calls *layers of isolation*: as long as a layer keeps its interface, the layers above it don't notice how it changes. That is step 2 of the diagram. Microsoft's guide uses the same example: if an application keeps its SQL Server persistence inside a layer, that layer can later be replaced by one for a cloud store or a web API that implements the same public interface. And a layer that can be replaced can be replaced *in a test*: a fake data access layer with known answers lets the business layer be tested without a database, and those tests are easier to write and faster to run.

**Which way the dependencies point.** In the classic form, source-code dependencies follow the calls: Presentation depends on Business, and Business depends on Data access. Microsoft's guide names the cost: the business layer, which usually holds the most important logic, then depends on data access details and often on a database existing at all, so testing it tends to need a test database. Two habits soften this:

- Business calls Data access through an interface (`OrderRepository`) and receives the implementation from outside, through dependency injection, so a test can pass in a fake. In the classic form Business still imports the data access package, because that is where the interface lives.
- The interface speaks the business's language (`save(order)`), not the database's (`execute(sql)`), so a change of database product stays below it.

Moving that interface up into the business layer, so that data access implements an interface the business owns, reverses the last dependency. That is the step from classic layering to [hexagonal architecture](../hexagonal-architecture/) and its relatives (see below).

**Layers are not tiers.** A layer is a logical grouping of code. A tier is a physical place where code runs: a process, a server, a pool of servers. Microsoft's guide notes that it is quite common to deploy an N-layer application to a single tier, and Azure adds that one tier can host several layers. The classic **three-tier** deployment (the N-tier style) puts Presentation on web servers, Business and Data access on application servers, and the database on database servers.

- **Each tier scales on its own.** In Azure's reference deployment every tier is a pool of two or more VMs behind its own load balancer, and the web and business tiers are stateless, so any instance can take any request.
- **Each tier is secured on its own.** Each tier gets its own subnet, used as a security boundary, and the data tier accepts requests only from the middle tier. A web application firewall or a perimeter network sits between the internet and the front end. AWS's [example for web and database servers](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-example-web-database-servers.html) puts the web servers in public subnets behind a load balancer and the database servers in private subnets that admit only the web servers' security group; its [example with servers in private subnets](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-example-private-subnets-nat.html) goes further and leaves only the load balancer and the NAT gateways in public subnets.
- **Each hop costs.** A call between tiers is a network call: it adds latency, and it can time out or fail in ways that an in-process call cannot. Azure puts it as a trade: physical separation improves scalability and resiliency but adds latency. It also distinguishes *strict* tiers, where a request must pass through every tier in turn (more latency and overhead), from *relaxed* ones that may skip a tier (more coupling, harder to change). Its best practices add asynchronous messaging to decouple the tiers and caching for data that rarely changes.

## When to use it

- **Simple, data-centred applications:** forms over data, line-of-business tools, admin back offices, where the logic is modest and the main job is moving data between screens and tables.
- **Small teams and first versions.** Almost every developer knows the shape, frameworks and templates generate it, and it gives a new application a clear place for everything. Azure lists the small learning curve among the style's benefits.
- **Existing N-tier systems moving to the cloud.** Azure suggests the style for migrating on-premises applications with minimal changes and for applications that span on-premises and cloud.
- **Inside something bigger.** A module of a [modular monolith](../modular-monolith/), or a single [microservice](../microservices/), is often a small layered application.

**When not to use it:**

- **As the top-level structure of a large application.** Fowler argues that presentation, domain and data should not be the top-level modules of a large system: the top level should follow the business domain, with layers inside each part.
- **Rich, fast-changing domains.** When the rules are the valuable part, a business layer that depends on data access is the wrong way round; invert the dependency ([hexagonal](../hexagonal-architecture/)).
- **Parts with different release or scaling needs.** Azure notes that the monolithic design prevents deploying features independently. If one capability needs its own release cycle or its own scaling, split by capability rather than by layer.
- **Mostly pass-through requests.** If nearly every request flows down and back with no logic on the way, the layers are ceremony: a simpler design, or an explicit read path, fits better.

## Trade-offs

What it is good for:

- **Familiarity.** The shape is so widely known that a newcomer can find the controller, the service and the repository on the first day.
- **Separation of concerns.** Each layer can be understood on its own. Fowler points out that this lets you think about one topic at a time, and that it leaves room for several presentations (a web app, mobile apps, an API, a command line) on top of one domain layer.
- **Testing a layer in isolation.** Layers are seams. With interfaces between them, a fake data access layer makes business tests fast and independent of any database.
- **Skills split by layer.** Front-end, back-end and database specialists can each work in the layer that matches their skills. Fowler's caution is about teams rather than people: individuals may specialise, but teams organised by layer add friction between groups that must work together on every feature and put the developers further from the users, so each team should cover every layer.

Where it hurts (step 4):

- **Sinkholes.** A request that passes through every layer with no layer adding anything costs latency and code for nothing. Richards calls this the *architecture sinkhole* anti-pattern, and Azure lists its tier-level form, a middle tier that only performs basic create, read, update and delete operations, among the challenges of N-tier. Some pass-through is normal in any layered system. When it describes most requests, the layers cost more than they give.
- **Technical rather than domain partitioning.** The layers split code by technical role, so one business capability, such as ordering, is spread across all of them. Adding one field to an order means touching a form, a request object, a rule, a mapping and a column: every layer. Jimmy Bogard's [vertical slice architecture](https://www.jimmybogard.com/vertical-slice-architecture/) starts from exactly this observation.
- **Every feature touches every layer,** so changes are wide, merges conflict, and if teams are split by layer, one feature needs every team.
- **One deployable that scales as a unit.** However cleanly the code is layered, a single-tier deployment ships and scales all of it together. Microsoft's guide notes that scaling such an application out means copying the whole of it to more servers, even when only one part is under load.
- **Drift without enforcement.** The rule lives in people's heads unless the build checks it. A shortcut from a controller to a repository compiles fine, and after enough of them the layers exist only in the folder names.
- **Open layers spread.** Each exception adds a dependency that skips a layer, and the callers that use it lose the isolation that step 2 relies on.

## Implementation notes

- **Make the rule checkable.**
  - *Package conventions:* one package, namespace or folder per layer, with names that say so (`web`, `service`, `repository`), and one direction of imports.
  - *Build modules:* put each layer in its own build module that depends only on the layer directly below it. With Gradle's `java-library` plugin, declare that dependency as `implementation` rather than `api`: implementation dependencies stay off the compile classpath of the module's consumers, so Presentation cannot even compile against Data access.
  - *Architecture tests:* ArchUnit (Java) has a layered-architecture rule. This one keeps all three layers closed and every call pointing down:

    ```java
    @ArchTest
    static final ArchRule layers = layeredArchitecture()
        .consideringAllDependencies()
        .layer("Presentation").definedBy("..web..")
        .layer("Business").definedBy("..service..")
        .layer("DataAccess").definedBy("..repository..")
        .whereLayer("Presentation").mayNotBeAccessedByAnyLayer()
        .whereLayer("Business").mayOnlyBeAccessedByLayers("Presentation")
        .whereLayer("DataAccess").mayOnlyBeAccessedByLayers("Business");
    ```

    Opening Business for reads then becomes a visible, reviewed change to one line: `.whereLayer("DataAccess").mayOnlyBeAccessedByLayers("Business", "Presentation")`.
  - *Other stacks:* for Python, Import Linter's layers contract stops a lower layer from importing a higher one, directly or through other modules, but lets a higher layer import anything below it, which is an open layering. To close a layer, add a forbidden contract between the outer layers with `allow_indirect_imports` set, so the legitimate route through the middle layer still passes.
- **Keep each layer's types to itself.** Presentation works with view models and request and response objects, Business with its own objects, Data access with rows or ORM entities. Microsoft's DDD guidance keeps domain entities out of the presentation layer for this reason. The mapping costs some code, and it is what stops a database change from reaching a screen.
- **Validate in the right place.** Format checks (the field is present, the date is a date) belong in Presentation. Business rules (there is stock, the discount applies) belong in Business, so every way in (HTML, JSON, a batch job, a test) meets the same rules. The business layer usually also sets the transaction boundary of a use case, because a repository cannot know which writes belong together.
- **Open a layer on purpose, not by accident.** If many reads are sinkholes, choose: accept them, open Business for a named set of read-only queries, or give reads their own path and model ([CQRS](../cqrs/)). Record the decision in the architecture test.
- **Tiers:** keep the web and application tiers stateless so that a load balancer can send any request to any instance; give each tier its own subnet and admit traffic only from the tier above; put a firewall in front of the web tier; set timeouts on every call between tiers; and consider a queue between the web tier and a worker for slow jobs (the Web-Queue-Worker style).

**Relatives.**

- **[Hexagonal](../hexagonal-architecture/), onion and clean architecture** keep the idea of layers but reverse the bottom dependency: the business core defines the interfaces it needs and data access implements them, so dependencies point toward the domain rather than toward the database. Fowler notes that putting a mapper between the domain and the data source removes the domain's dependency on it, which is the hexagonal approach, and Microsoft's guide presents clean architecture, the dependency inversion principle applied, as its answer to the testing problem of N-layer applications.
- **Vertical slices and the [modular monolith](../modular-monolith/)** turn the split through ninety degrees. The top-level units are features or business capabilities, each with its own, often thin, layers inside, so a new field changes one slice instead of every layer of the application.
- **[Microservices](../microservices/).** A microservice is usually a small layered application whose boundary follows a business capability. Splitting a system into services *by layer* (a web service, a business service, a data service) rebuilds N-tier over the network: every feature still crosses every service.
- **Microkernel (plug-in)** is the other classic shape for a single deployable: a minimal core extended by plug-ins, rather than a stack of layers.
- **[Anti-corruption layer](../anti-corruption-layer/)** uses the word differently. It is a translation boundary toward another system's model, not a horizontal slice of your own code.
- **Origins.** The pattern is old: Buschmann and his co-authors catalogued it as Layers in *Pattern-Oriented Software Architecture, Volume 1* (1996), and Richards's *Software Architecture Patterns* describes it as the layered architecture style.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Hexagonal (Ports & Adapters)](../hexagonal-architecture/) — Domain logic at the core; UIs, databases and queues plug in through ports and adapters.
- [Modular Monolith](../modular-monolith/) — One deployable unit built from strongly bounded modules that talk through explicit interfaces.
- [Microservices](../microservices/) — Small, independently deployable services, each owning one business capability and its data.
- [Web-Queue-Worker](../web-queue-worker/) — A web front end hands slow work to background workers through a queue.
- Microkernel (Plug-in) *(planned)* — A minimal core system extended by independent plug-in modules.
- [CQRS](../cqrs/) — Separate the write model (commands) from read models (queries), each optimised for its job.
- [Anti-Corruption Layer](../anti-corruption-layer/) — A translation layer that keeps a legacy model from leaking into the new domain.

## References

- [Azure Architecture Center — N-tier architecture style](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/n-tier)
- [Martin Fowler — Presentation Domain Data Layering](https://martinfowler.com/bliki/PresentationDomainDataLayering.html)
- [Microsoft .NET architecture guide — Common web application architectures (traditional N-layer applications)](https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/common-web-application-architectures)
- [Microsoft .NET architecture guide — Designing a DDD-oriented microservice (layers in DDD)](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ddd-oriented-microservice)
- [AWS — Example: VPC for web and database servers](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-example-web-database-servers.html)
- [ArchUnit User Guide — Layer checks](https://www.archunit.org/userguide/html/000_Index.html#_layer_checks)
- [Import Linter — Layers contract](https://import-linter.readthedocs.io/en/stable/contract_types/layers/)
- [Gradle User Manual — The Java Library Plugin (api and implementation)](https://docs.gradle.org/current/userguide/java_library_plugin.html)
- [Jimmy Bogard — Vertical Slice Architecture](https://www.jimmybogard.com/vertical-slice-architecture/)
- [Mark Richards — Software Architecture Patterns, 2nd edition (O'Reilly, 2022), listed on the author's publications page](https://www.developertoarchitect.com/books.html)
- [Buschmann, Meunier, Rohnert, Sommerlad and Stal — Pattern-Oriented Software Architecture, Volume 1: A System of Patterns (Wiley, 1996)](https://www.wiley.com/en-us/Pattern+Oriented+Software+Architecture%2C+Volume+1%3A+A+System+of+Patterns-p-9780471958697)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
