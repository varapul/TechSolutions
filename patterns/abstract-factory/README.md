<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧩 Design Patterns (GoF)](../../README.md#design-patterns-gof)

# Abstract Factory

> Create families of related objects through one interface, so swapping the whole family never touches client code.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Abstract Factory" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/abstract-factory.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Hard-coded and mixable** | `ReceiptService` calls `new S3BlobStore()` and `new SqsQueue()` itself, in `issue()`, in `reissue()` and wherever else it needs them. Halfway through a move to Azure, `issue()` already sends to a `ServiceBusQueue` but still stores the PDF in S3: a mixed family that nothing in the code prevents, and each of the three remaining `new` calls is one more edit. |
| **2 · One factory per family** | `ReceiptService` (the *Client*) receives an `InfraFactory` (the *AbstractFactory*) at startup and calls `createBlobStore()` and `createQueue()` on it, so it knows only the `BlobStore` and `Queue` interfaces (the *AbstractProducts*). Each *ConcreteFactory* creates one family's *ConcreteProducts*: `AwsFactory` makes an `S3BlobStore` and an `SqsQueue`. Whatever the service holds therefore comes from one family. |
| **3 · Swap the whole family** | `issue(1001)` stores `receipts/1001.pdf` with `put()` and then sends `{receiptId: 1001}` with `send()`. With `INFRA=aws` the factory is `AwsFactory`, so that is an S3 put and an SQS send; with `azure` the same code writes to Blob Storage and Service Bus, and a test sets `memory` and runs without any cloud. `ReceiptService` never changes. |
| **4 · Add families, not products** | Google Cloud is one more row, `GcpFactory` with `GcsBlobStore` and `PubSubQueue`, plus one more `INFRA` value, and no existing class changes. A new kind of product is the opposite: `createCache()` changes the `InfraFactory` interface and therefore every factory, which is the pattern's known cost. ADO.NET's `DbProviderFactory`, Java's `DocumentBuilderFactory.newInstance()` and Swing's look and feels follow the pattern, and at system scale ports and adapters do the same job, with the risk that a cloud-neutral port shrinks to the lowest common denominator. |
<!-- END GENERATED: header -->

## The problem

A receipts service does two things with every receipt: it stores the PDF in blob storage and announces it on a message queue, so that billing and email can react. The first version runs on AWS, and that choice is written straight into the code. `issue()` calls `new S3BlobStore()` and `new SqsQueue()`, `reissue()` does the same, and so does every other method that needs storage or messaging.

Each line is harmless on its own. The trouble is that the decision "we run on AWS" is repeated in all of them. Moving to Azure means finding and editing every `new`, and until the last one is done the service runs in a combination nobody designed: `issue()` already sends to Service Bus but still writes to S3, while `reissue()` still sends to SQS, so a consumer that listens on one queue misses part of the receipts. The compiler can't object, because each `new` is a separate decision. Tests have the same problem from the other side: to run without a cloud they have to replace the objects one at a time.

What the code doesn't express is that these classes come in sets. An S3 store goes with an SQS queue, Blob Storage with Service Bus, and an in-memory store with an in-memory queue, so the code should pick a set, not individual classes.

## How it works

Abstract Factory turns each set into a family and gives the family one place where its members are made. One interface declares a creation method for every kind of object the client needs, and each family implements that interface once. The client asks its factory for everything and sees only the abstract types, so all of its objects come from the same factory and belong together. It is one of the creational patterns in *Design Patterns* by Gamma, Helm, Johnson and Vlissides (1994), which also calls it *Kit*.

| Participant | In the diagram | Role |
|---|---|---|
| **AbstractFactory** | `InfraFactory` | Declares one creation method per kind of product: `createBlobStore()` and `createQueue()`. |
| **ConcreteFactory** | `AwsFactory`, `AzureFactory`, `InMemoryFactory` | Implements every creation method for one family. |
| **AbstractProduct** | `BlobStore`, `Queue` | The interface for one kind of product. |
| **ConcreteProduct** | `S3BlobStore`, `SqsQueue`, `AzureBlobStore`, `ServiceBusQueue`, `MemoryBlobStore`, `MemoryQueue` | One implementation per family and kind. |
| **Client** | `ReceiptService` | Uses only `InfraFactory`, `BlobStore` and `Queue`. |

It helps to picture a table, as the diagram draws it: the kinds of product are the columns, the families are the rows, and each concrete factory owns one row. The client is written against the column headings, and the factory decides which row it gets.

**Consistency is the point.** Putting a class behind an interface already hides that one class. What a factory for the whole family adds is a guarantee about combinations: a `ReceiptService` built with an `AwsFactory` can't end up with a Service Bus queue next to an S3 store, because one object made both. The book counts this among the pattern's main benefits, together with keeping concrete class names out of the client and making it easy to exchange a whole family.

**The choice is made once.** Something still has to decide which factory to use, but that decision moves out of the methods that do the work and into the code that assembles the application at startup. Mark Seemann calls that place the *composition root*: the one spot where the application's object graph is put together. In the diagram it reads `INFRA` and takes the factory from a map. An application usually needs a single instance of its concrete factory, so the book suggests making each one a [Singleton](../singleton/); creating that one instance at startup and passing it in gets the same result without a global access point.

**Where the products come from.** Each creation method is usually a [Factory Method](../factory-method/) that the concrete factory implements with a plain `new`, as in the code below. When there would be many similar families, the book offers a second way: one concrete factory that holds a prototype of each product and makes new products by copying them (the Prototype pattern), so that a new family is new configuration rather than a new class.

**How it differs from its relatives.**

- [Factory Method](../factory-method/) is about one product: a class leaves the choice of that product's class to its subclasses. Abstract Factory is a separate object with a creation method for each product, and the family changes when you pass in a different factory object, not when you subclass the client.
- [Builder](../builder/) assembles one complex product step by step and hands it over at the end. Abstract Factory returns each product immediately, and what it cares about is which products belong together.
- Prototype creates objects by copying a configured instance. It can take the place of the concrete factory subclasses, as described above.
- [Facade](../facade/) gives a subsystem one simple entry point. The book notes that the two work together: an abstract factory can create a subsystem's objects without naming platform-specific classes, and can even stand in for a facade when hiding those classes is all that is needed.

## Code

TypeScript that mirrors the diagram. Node 22.18 or later runs it as is (`node receipts.ts`) by stripping the types; it doesn't type-check them, so `tsc --noEmit` is what catches a factory that forgets one of its methods.

```ts
import assert from 'node:assert/strict';

// AbstractProducts and AbstractFactory: all that ReceiptService knows.
interface BlobStore { put(key: string, pdf: string): void; }
interface Queue { send(msg: { receiptId: number }): void; }
interface InfraFactory {
  createBlobStore(): BlobStore;
  createQueue(): Queue;
}

// Fakes that record each call with their provider, where real ones would call an SDK.
const calls: string[] = [];
const log = (provider: string, call: string, arg: unknown) =>
  calls.push(`${provider}: ${call} ${typeof arg === 'string' ? arg : JSON.stringify(arg)}`);

// One family per row: two ConcreteProducts and the ConcreteFactory that makes them.
class S3BlobStore implements BlobStore { put(key: string) { log('aws', 'S3 put', key); } }
class SqsQueue implements Queue { send(msg: object) { log('aws', 'SQS send', msg); } }
class AwsFactory implements InfraFactory {
  createBlobStore(): BlobStore { return new S3BlobStore(); }
  createQueue(): Queue { return new SqsQueue(); }
}

class AzureBlobStore implements BlobStore { put(key: string) { log('azure', 'Blob put', key); } }
class ServiceBusQueue implements Queue { send(msg: object) { log('azure', 'Service Bus send', msg); } }
class AzureFactory implements InfraFactory {
  createBlobStore(): BlobStore { return new AzureBlobStore(); }
  createQueue(): Queue { return new ServiceBusQueue(); }
}

class MemoryBlobStore implements BlobStore { put(key: string) { log('memory', 'Map set', key); } }
class MemoryQueue implements Queue { send(msg: object) { log('memory', 'array push', msg); } }
class InMemoryFactory implements InfraFactory {
  createBlobStore(): BlobStore { return new MemoryBlobStore(); }
  createQueue(): Queue { return new MemoryQueue(); }
}

// Client: written once against the interfaces; it never names a cloud.
class ReceiptService {
  private readonly blob: BlobStore;
  private readonly queue: Queue;
  constructor(factory: InfraFactory) {
    this.blob = factory.createBlobStore(); // both products come
    this.queue = factory.createQueue();    // from the same factory
  }
  issue(id: number): void {
    this.blob.put(`receipts/${id}.pdf`, '%PDF-1.7 ...');
    this.queue.send({ receiptId: id });
  }
}

// Composition root: the INFRA setting picks one factory, and with it one family.
const factories: Record<string, InfraFactory> = {
  aws: new AwsFactory(), azure: new AzureFactory(), memory: new InMemoryFactory(),
};
for (const infra of ['aws', 'azure', 'memory']) {
  calls.length = 0;
  new ReceiptService(factories[infra]).issue(1001);
  console.log(calls.join('  |  '));
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.startsWith(`${infra}: `)), 'one family per run');
}
// aws: S3 put receipts/1001.pdf  |  aws: SQS send {"receiptId":1001}
// azure: Blob put receipts/1001.pdf  |  azure: Service Bus send {"receiptId":1001}
// memory: Map set receipts/1001.pdf  |  memory: array push {"receiptId":1001}
```

Output:

```
aws: S3 put receipts/1001.pdf  |  aws: SQS send {"receiptId":1001}
azure: Blob put receipts/1001.pdf  |  azure: Service Bus send {"receiptId":1001}
memory: Map set receipts/1001.pdf  |  memory: array push {"receiptId":1001}
```

The last assertion is the pattern's promise: every call in a run comes from the family that `INFRA` named. Make `AwsFactory.createQueue()` return a `ServiceBusQueue` and it fails.

## When to use it

- A client needs several kinds of objects that only work correctly together: the storage and messaging clients of one cloud, the widgets of one look and feel, the connection, command and parameter classes of one database provider.
- The family should be chosen once, by configuration or at startup, and the code that uses the objects shouldn't know which one it got.
- Tests or local development need a complete substitute family, such as in-memory fakes, rather than one replacement at a time.
- The kinds of product are stable and the families change. If new kinds keep appearing, every factory changes each time (see *Trade-offs*).
- Prefer something simpler when there is one product (a factory function, or [Factory Method](../factory-method/)), when the objects don't have to match (inject each one on its own), or when there is one family and no realistic second (construct it directly at the composition root).

## Trade-offs

- **Families are cheap, kinds of product are not.** A new family is a new row: `GcpFactory` with `GcsBlobStore` and `PubSubQueue`, and nothing that exists changes. A new kind of product is a new column: `createCache()` changes `InfraFactory`, so every concrete factory has to implement it and every family needs a cache class before the code compiles again. The book singles this out as the case the pattern handles badly.
- **Ways to soften it.** A single parameterised method, `create(kind)`, lets new kinds arrive without changing the interface, but it has to return a common base type, so callers cast, and an unknown kind fails at runtime instead of at compile time. A base class can also add the new method with a default. When .NET 6 added batching, [`DbProviderFactory`](https://github.com/dotnet/runtime/blob/main/src/libraries/System.Data.Common/src/System/Data/Common/DbProviderFactory.cs) gained a virtual `CreateBatch()` that throws `NotSupportedException` unless a provider overrides it, and a `CanCreateBatch` property that is `false` by default, so existing providers kept working and callers can check before they ask.
- **Indirection.** Reading `ReceiptService` alone, you can't tell which cloud it uses. The answer is in the composition root.
- **Ceremony.** With one family, or with products that don't depend on each other, the extra interfaces and classes cost more than they return.
- **Hiding the cloud has a price.** An interface can only promise what every family delivers. An SQS standard queue delivers each message at least once and occasionally out of order, while Service Bus offers ordered delivery through sessions, which its Basic tier doesn't support. A cloud-neutral `Queue` either promises only what all providers share, the lowest common denominator, or grows options that only some families honour. Gregor Hohpe's article on lock-in lists what such layers cost: provider features you stop using, one more layer to understand and run, and a new dependency on the abstraction itself. Running the same code in memory for tests is usually worth that price; keeping a move to another cloud open, which may never happen, often isn't.

## Implementation notes

- **Decide at startup and pass the factory in.** Read the setting once, create one factory and hand it to the objects that need it. If code deep in the system calls `new AwsFactory()`, the decision spreads again.
- **Dependency injection is where this idea mostly lives today.** A container keeps every "which class implements this interface" decision in one place, and registering a family's classes together gives you the factory. In Spring, a `@Configuration` class marked `@Profile("aws")` whose `@Bean` methods return a `BlobStore` and a `Queue` is a concrete factory for that family, and `spring.profiles.active` (or `@ActiveProfiles` in an integration test) picks one at startup. In ASP.NET Core the [convention](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/dependency-injection) for a group of related services is one `Add{Group}` extension method, so `AddAwsInfrastructure()` would register the matching pair. The container then injects the products themselves and the client never sees a factory; keep an explicit factory when the client has to create products later, or more than once.
- **Make mixing impossible, not just unlikely.** Where the language allows it, keep the concrete products private to their family's package or module (package-private in Java, `internal` in C#, not exported in TypeScript), so the factory is the only way to get one.
- **Run one contract test suite against every family.** The same tests, run against the in-memory family and against each real one, keep the fakes honest. An in-memory queue that never duplicates or reorders messages lets tests pass that production would fail.
- **Where it appears.**
  - .NET: `DbProviderFactory` creates a database provider's own classes through `CreateConnection()`, `CreateCommand()`, `CreateParameter()` and similar methods, so code written against `DbConnection` and `DbCommand` can change database by changing the factory. `DbProviderFactories.GetFactory()` looks a factory up by the provider's invariant name. On .NET Framework, providers register themselves in `machine.config`; on .NET Core and later, the application registers them with [`DbProviderFactories.RegisterFactory()`](https://learn.microsoft.com/en-us/dotnet/api/system.data.common.dbproviderfactories.registerfactory).
  - Java: `DocumentBuilderFactory.newInstance()` picks the XML parser implementation through the [JAXP lookup](https://docs.oracle.com/en/java/javase/27/docs/api/java.xml/module-summary.html) (a system property, then the JAXP configuration file, then `ServiceLoader`, then the JDK's built-in default), and the `DocumentBuilder` objects it creates, and the DOM documents they build, all come from that implementation.
  - Swing: each look and feel supplies a table of UI delegate classes, and `UIManager.getUI()` creates a component's delegate from the current one. After `UIManager.setLookAndFeel()`, updating the component tree replaces every delegate with the new look and feel's. The table is keyed by each component's UI class ID, a parameterised factory, which is how new component types fit in without a new method. The book's own motivating example is a widget toolkit that supports several look-and-feel standards.
- **At architecture scale: ports and adapters.** In [Hexagonal Architecture](../hexagonal-architecture/), `BlobStore` and `Queue` are driven ports that the application core owns, and `S3BlobStore` or `ServiceBusQueue` are adapters. The composition root plugs in a matching set of adapters, which is the job of a concrete factory. What changes at that scale is that a family becomes deployable infrastructure, with its own credentials, regions, network rules and integration tests. Define each port by what the core needs (store this receipt, announce that it was issued) rather than as a copy of one vendor's SDK, or it will shrink to the lowest common denominator described under *Trade-offs*.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Factory Method](../factory-method/) — Let subclasses decide which class to create: the base class codes against an interface and calls an overridable create method.
- [Builder](../builder/) — Assemble a complex object step by step and validate it once at the end, instead of calling a constructor with ten arguments.
- [Prototype](../prototype/) — Create new objects by copying a configured prototype instead of building them from scratch, and know when a copy must go deep.
- [Singleton](../singleton/) — Guarantee one instance with a global access point, and why injecting one shared instance usually serves that need better.
- [Facade](../facade/) — Give a complex subsystem one simple entry point, so callers make one call instead of orchestrating many classes.
- [Hexagonal (Ports & Adapters)](../hexagonal-architecture/) — Domain logic at the core; UIs, databases and queues plug in through ports and adapters.

## References

- [Gamma, Helm, Johnson and Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software (Addison-Wesley, 1994)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610)
- [Refactoring.Guru — Abstract Factory](https://refactoring.guru/design-patterns/abstract-factory)
- [Microsoft Learn — DbProviderFactory Class (System.Data.Common)](https://learn.microsoft.com/en-us/dotnet/api/system.data.common.dbproviderfactory)
- [Microsoft Learn — Obtaining a DbProviderFactory (ADO.NET)](https://learn.microsoft.com/en-us/dotnet/framework/data/adonet/obtaining-a-dbproviderfactory)
- [Java SE 27 API — javax.xml.parsers.DocumentBuilderFactory](https://docs.oracle.com/en/java/javase/27/docs/api/java.xml/javax/xml/parsers/DocumentBuilderFactory.html)
- [Java SE 27 API — javax.swing.UIManager](https://docs.oracle.com/en/java/javase/27/docs/api/java.desktop/javax/swing/UIManager.html)
- [Alistair Cockburn — Hexagonal Architecture (the original 2005 article)](https://alistair.cockburn.us/hexagonal-architecture)
- [Mark Seemann — Composition Root](https://blog.ploeh.dk/2011/07/28/CompositionRoot/)
- [Spring Framework reference — Environment Abstraction (bean definition profiles)](https://docs.spring.io/spring-framework/reference/core/beans/environment.html)
- [Gregor Hohpe — Don't get locked up into avoiding lock-in (martinfowler.com, 2019)](https://martinfowler.com/articles/oss-lockin.html)
- [Amazon SQS Developer Guide — Standard queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html)
- [Microsoft Learn — Azure Service Bus message sessions (FIFO)](https://learn.microsoft.com/en-us/azure/service-bus-messaging/message-sessions)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
