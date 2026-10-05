<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧩 Design Patterns (GoF)](../../README.md#design-patterns-gof)

# Singleton

> Guarantee one instance with a global access point, and why injecting one shared instance usually serves that need better.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Singleton" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/singleton.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Three pools by accident** | OrdersRepo, UsersRepo and ReportsJob each call `new ConnectionPool()`, so one process ends up with three pools of 10 connections: 30 where a single pool of 10 was planned. Each pool also keeps its own state (which connections are idle, what it has cached), so the three drift apart instead of sharing one view. |
| **2 · One instance, one way in** | The **Singleton** makes its constructor private, so no caller can build a pool, and offers a static `getInstance()` as the one way in. The first call creates the pool and keeps it in a static field; every later call returns that same object, so `a === b && b === c` and the database sees one pool of 10. |
| **3 · The async trap** | Opening a pool is asynchronous in JavaScript. If `getInstance()` awaits the connection before it stores anything, two requests that arrive together both find the field empty and open two pools (20 connections); storing the creation **promise** first makes the second caller await the same one. Multithreaded runtimes have the classic version of this race, which Java code avoids with eager initialisation, a holder class or an enum. |
| **4 · Costs, and the alternative** | A singleton is global state: it hides a dependency, carries state from one test into the next, and is unique only within a process, so 4 replicas still open 4 pools and 40 connections. Usually it is better to create one pool at startup and pass it in (a DI container's *singleton lifetime* does this) or to export it from a module. One active instance across a whole cluster is a different problem: [leader election](../leader-election/). |
<!-- END GENERATED: header -->

## The problem

Some objects should exist only once in a process: a database connection pool, a metrics registry, an in-process cache, a configuration snapshot. A plain class doesn't enforce that. If any code can call `new ConnectionPool()`, the repositories in one service each open their own pool, a database sized for 10 connections from this service gets 30, and every pool keeps its own idea of which connections are idle. Passing one shared object down through every layer that needs it feels like plumbing, and that is when a singleton looks attractive.

## How it works

A Singleton makes a class responsible for having at most one instance, and for handing that instance to whoever asks for it (Gamma, Helm, Johnson and Vlissides, 1994). The pattern has a single participant, the **Singleton** class, and clients reach the instance only through it:

- the constructor is **private**, so no other code can create an instance;
- a **static field** holds the one instance;
- a **static access method**, here `getInstance()`, creates the instance on the first call (lazy) or returns one built when the class loaded (eager), and returns that same object on every later call.

A singleton does two jobs at once. **One instance** protects a scarce resource and keeps shared state consistent, and that part is often exactly what you need. **Global access** lets any code reach the object without being handed it, and that is the controversial part. It is global mutable state under another name: a class's dependencies disappear into its method bodies, tests inherit whatever the previous test left behind, and the order in which things initialise starts to matter. You can keep the first job and drop the second: create one instance when the program starts and pass it to the code that needs it.

**Lazy or eager.** Eager creation, when the class or module loads, is simple and has no race, but every run pays the start-up cost and a failure surfaces at load time. Lazy creation moves the cost to the first caller, and that is where the concurrency bugs live: two threads, or two asynchronous callers, can both see "no instance yet".

**The asynchronous version of the race.** In JavaScript and TypeScript, opening a pool returns a promise. A `getInstance()` that awaits the connection before it stores anything leaves a gap in which a second caller also finds the field empty and opens a second pool: two pools and 20 connections in the diagram's third step. Store the creation *promise* in the field before awaiting it, and every caller awaits the same promise. If creation fails, clear the field, or every later caller gets the cached rejection.

**Relatives.** Factory Method and Abstract Factory decide *which* class gets instantiated; Singleton decides *how many* instances exist. Concrete factories and facades often need only one instance, so they are frequently written as singletons, but that is an implementation choice, not part of those patterns. Flyweight shares many instances, one per distinct shared state, through a factory; a registry that hands out one instance per name sits between the two (Python's `logging.getLogger(name)` returns the same logger for the same name). Modern languages have absorbed much of the pattern: a module is evaluated once, Kotlin's `object` declaration is a singleton the compiler builds for you, and dependency injection (DI) containers manage a *singleton lifetime*.

## Code

A `ConnectionPool` with a private constructor and a static `getInstance()` that caches the creation promise. A fake `connect()` counts how many pools get opened, and the usage at the end makes two concurrent calls, as in step 3, then a later one, as in step 2.

```ts
// connection-pool.ts: run with `node connection-pool.ts` (Node 22.18+ strips the types)
import assert from 'node:assert/strict';

let poolsOpened = 0;                         // what the database would count
async function connect(size: number): Promise<string[]> {
  poolsOpened++;                             // a fake driver: opening takes a while
  await new Promise((resolve) => setTimeout(resolve, 50));
  return Array.from({ length: size }, (_, i) => `conn ${poolsOpened}.${i + 1}`);
}

class ConnectionPool {
  private static pending: Promise<ConnectionPool> | undefined;
  readonly connections: string[];

  private constructor(connections: string[]) {   // `new` only from inside the class
    this.connections = connections;
  }

  // Store the promise *before* awaiting it: a caller that arrives while the pool
  // is still opening gets the same promise instead of opening a second pool.
  // The broken version awaits first and stores the result afterwards:
  //   ConnectionPool.instance ??= await ConnectionPool.open();
  // Two concurrent calls both find no instance: poolsOpened === 2, 20 connections.
  static async getInstance(): Promise<ConnectionPool> {
    ConnectionPool.pending ??= ConnectionPool.open();
    return ConnectionPool.pending;
  }

  private static async open(): Promise<ConnectionPool> {
    try {
      return new ConnectionPool(await connect(10));
    } catch (err) {
      ConnectionPool.pending = undefined;    // don't cache a failure: the next call retries
      throw err;
    }
  }
}

// OrdersRepo and UsersRepo ask at the same moment; ReportsJob asks later.
const [a, b] = await Promise.all([ConnectionPool.getInstance(), ConnectionPool.getInstance()]);
const c = await ConnectionPool.getInstance();

assert.equal(poolsOpened, 1);
assert.ok(a === b && b === c);
console.log(`pools opened: ${poolsOpened}, connections: ${a.connections.length}, same object: ${a === b && b === c}`);
// pools opened: 1, connections: 10, same object: true
```

The fix works because an `async` function runs synchronously up to its first `await`: the `??=` assignment happens during the first call, before any other caller gets a turn. The broken line checks the field, then awaits, then assigns, and two concurrent calls both fall into the gap between the check and the assignment.

## When to use it

- A resource that must be unique within the process and is expensive or limited: a connection pool, a thread pool, a metrics registry, an in-process cache. Even then, prefer creating it once where the program is assembled (`main()` or the DI container) and passing it in. Keep a static `getInstance()` for places where you can't pass things in, such as a library's entry point or a framework callback.
- Objects that model something the process has exactly one of. The JDK's `Runtime.getRuntime()` returns the single `Runtime` object every Java application has.
- Not for stateless helpers: plain functions, or a module of functions, do that job without an instance.
- Not when "only one" has to hold across the whole system. One active scheduler or writer among many replicas is [leader election](../leader-election/), and one source of settings for every instance is an [external configuration store](../external-configuration-store/).

## Trade-offs

- **Hidden dependencies.** A class that calls `ConnectionPool.getInstance()` inside a method needs a database, but nothing in its constructor says so. Miško Hevery's 2008 post calls singletons "pathological liars" for this reason and argues for passing dependencies in through constructors instead.
- **Tests that leak into each other.** The instance outlives each test, so state left by one test changes the next, and a test can't swap in a fake pool without reaching into the class. A static `resetForTests()` hook is a smell: it puts a backdoor into production code and still fails once tests run in parallel. Inject the instance instead, and each test builds what it needs.
- **Unique only within a boundary.** A Java singleton is one per class loader (Spring's documentation contrasts this with its own per-container singletons), a JavaScript one is one per loaded module, and a Python one is one per interpreter. Scale the service to 4 replicas and you have 4 pools and 40 connections; with PostgreSQL's default `max_connections` of 100, ten such replicas would use the whole budget.
- **Lifecycle.** Someone has to close the pool at shutdown, after everything that uses it has stopped. A container that created a singleton can dispose of it; a hand-written static is usually left open until the process exits.
- **Concurrency.** Lazy creation needs a guard that is safe for threads or for concurrent promises, and the instance itself must be safe to use from every caller at once.

## Implementation notes

- **Java has three safe forms.** *Eager*: a `private static final` field set where it is declared; the JVM runs class initialisation under a per-class lock, so exactly one instance is built. *Lazy*: the holder idiom, a nested class whose static field holds the instance; the JVM initialises the nested class only when `getInstance()` first reads that field. *Enum*: `enum ConnectionPool { INSTANCE; ... }`, the form Joshua Bloch recommends in *Effective Java* (Item 3) and shows in the book's [example code](https://github.com/jbloch/effective-java-3e-source-code/tree/master/src/effectivejava/chapter2/item3). Double-checked locking needs the field to be `volatile`, which is reliable from Java 5 on (an immutable object with only `final` fields is the one exception); without it, another thread can see the reference before the object behind it is fully constructed.
- **Java's loopholes.** Deserialising a class-based singleton produces a new object unless the class defines `readResolve()` to return the existing instance. Reflection with `setAccessible(true)` can still call a private constructor where module access allows it, so defensive code throws from the constructor when an instance already exists. An enum closes both gaps: a constant is serialised as its name and resolved back to the same constant, and `Constructor.newInstance` refuses to create enum instances. The cost is that an enum can't extend another class.
- **Other runtimes.** In C#, `Lazy<T>` is thread-safe by default, so a `static readonly Lazy<ConnectionPool>` creates exactly one pool. In Go, `sync.OnceValue` (Go 1.21 and later) wraps a constructor so that it runs once, even when called concurrently. In Kotlin, an `object` declaration is initialised thread-safely on first access.
- **TypeScript's `private` is a compile-time check.** The TypeScript handbook notes that `private` is enforced only during type checking, so plain JavaScript, or a cast, can still call `new ConnectionPool()`. If that matters, don't export the class at all: export the accessor or the instance.
- **Module scope is the idiomatic singleton in JavaScript and Python.** An ES module's body runs once, however many modules import it, so an exported `pool` is shared by every importer. Node.js keys that cache by resolved URL, so a different query string loads a second copy, and keys CommonJS modules by resolved file name, so two copies of a package in `node_modules` give two instances. Python keeps every imported module in `sys.modules`, so a module-level `pool = ConnectionPool()` runs once per interpreter, unless something calls `importlib.reload()` or deletes the entry.
- **DI containers.** Spring beans are singleton-scoped by default: one instance per container and bean definition. In .NET, `AddSingleton` registers a service that the container creates on first request (or an instance you supply) and reuses for every later request. Such a service must be thread-safe and must not hold on to a *scoped* service; in the Development environment the default service provider checks for that mistake.
- **At cluster scale.** "One" across replicas needs coordination rather than a static field: a lease in a shared store, and a plan for when its holder dies, which is [leader election](../leader-election/). To cap database connections across many replicas, put a server-side pooler such as PgBouncer, or a managed database proxy, in front of the database.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Factory Method](../factory-method/) — Let subclasses decide which class to create: the base class codes against an interface and calls an overridable create method.
- [Abstract Factory](../abstract-factory/) — Create families of related objects through one interface, so swapping the whole family never touches client code.
- [Facade](../facade/) — Give a complex subsystem one simple entry point, so callers make one call instead of orchestrating many classes.
- [Flyweight](../flyweight/) — Share the common, immutable part of many similar objects and keep only what differs in each one, to cut memory.
- [Leader Election](../leader-election/) — Instances elect one coordinator; another takes over when its lease expires.
- [External Configuration Store](../external-configuration-store/) — Keep configuration out of the deployment package, in a central store read at runtime.

## References

- [Gamma, Helm, Johnson and Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software (Addison-Wesley, 1994)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610)
- [Joshua Bloch — Effective Java, 3rd edition (Item 3: the singleton property)](https://www.informit.com/store/effective-java-9780134685991)
- [Bill Pugh et al. — The "Double-Checked Locking is Broken" Declaration](https://www.cs.umd.edu/~pugh/java/memoryModel/DoubleCheckedLocking.html)
- [Java Language Specification, Java SE 27 — 12.4.2 Detailed Initialization Procedure](https://docs.oracle.com/javase/specs/jls/se27/html/jls-12.html#jls-12.4.2)
- [Java Object Serialization Specification — The readResolve Method](https://docs.oracle.com/en/java/javase/27/docs/specs/serialization/input.html#the-readresolve-method)
- [Spring Framework reference — Bean Scopes](https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html)
- [Microsoft Learn — Service lifetimes (dependency injection in .NET)](https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/service-lifetimes)
- [Node.js documentation — CommonJS modules: Caching](https://nodejs.org/api/modules.html#caching)
- [Python documentation — The import system: The module cache](https://docs.python.org/3/reference/import.html#the-module-cache)
- [Miško Hevery — Singletons are Pathological Liars (Google Testing Blog, 2008)](https://testing.googleblog.com/2008/08/by-miko-hevery-so-you-join-new-project.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
