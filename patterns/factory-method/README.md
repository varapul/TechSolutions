<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧩 Design Patterns (GoF)](../../README.md#design-patterns-gof)

# Factory Method

> Let subclasses decide which class to create: the base class codes against an interface and calls an overridable create method.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Factory Method" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/factory-method.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · new inside send()** | `Notifier.send(msg, kind)` decides which channel to build with an if/else on `kind`, and calls `new` on each concrete class itself. Notifier now depends on `EmailChannel` and `SmsChannel` directly, so adding push means opening `send()` again, adding a branch and retesting a method that every caller uses. |
| **2 · Defer to createChannel()** | `send()` asks `this.createChannel()` for a channel and uses it only through the `Channel` interface. `createChannel()` is the **factory method**: `Notifier` (the *Creator*) declares it, and each *ConcreteCreator* overrides it to return its own *ConcreteProduct*. That gives two parallel hierarchies, and `send()` is written once. |
| **3 · One call at runtime** | The client calls `send('Your code is 4721')` on an `SmsNotifier`. The inherited `send()` runs, `this.createChannel()` is dispatched to `SmsNotifier`, which returns a new `SmsChannel`, and `send()` then calls `deliver(msg)` on it through the `Channel` interface. The result, `SMS sent: Your code is 4721`, travels back to the client. |
| **4 · New channel, no edits** | Push needs a `PushChannel` and a `PushNotifier` that creates it, and no existing class changes: `send()` is untouched. Java's `Collection.iterator()` works the same way, with each collection class creating its own iterator. The price is a creator subclass for every product, which is why many languages pass a factory function instead. |
<!-- END GENERATED: header -->

## The problem

A notification service has one job that stays the same, sending a message, and several ways of doing it: email and SMS today, push next quarter. The first version usually makes the choice inside the method that does the work. `Notifier.send(msg, kind)` checks `kind` and calls `new EmailChannel()` or `new SmsChannel()` itself.

That puts the logic that should stay put (formatting, retries, logging) in the same method as the part that keeps changing. `Notifier` depends on every concrete channel, so adding push means opening `send()` again, adding a branch and retesting a method that every caller relies on. The same `if/else` also tends to be copied to every other place that needs a channel.

## How it works

Factory Method separates *using* an object from *choosing its class*. The class that has the logic declares a method that returns the object, typed as an interface, and calls it wherever it needs one. Each subclass overrides that method to pick the concrete class. The pattern was named in *Design Patterns* by Gamma, Helm, Johnson and Vlissides (1994), which also gives it the name *Virtual Constructor*: a constructor call that is dispatched like a virtual method.

| Participant | In the diagram | Role |
|---|---|---|
| **Product** | `Channel` | The interface that every created object implements. |
| **ConcreteProduct** | `EmailChannel`, `SmsChannel` | The classes that do the actual delivery. |
| **Creator** | `Notifier` | Declares the factory method `createChannel()` and holds the logic that uses its result, `send()`. |
| **ConcreteCreator** | `EmailNotifier`, `SmsNotifier` | Override `createChannel()` to return one ConcreteProduct. |

Creating objects is not the Creator's main job. It holds the real logic, and the factory method is a hook inside it. The two hierarchies run in parallel, with one ConcreteCreator for each ConcreteProduct.

**Why the Creator knows only the interface.** Without the pattern, the source code of `Notifier` depends on `EmailChannel` and `SmsChannel`, so the high-level policy (how a notification is sent) depends on low-level details (how an SMS gateway is called). With it, `Notifier` and every channel depend on the `Channel` abstraction, and the only line that names `SmsChannel` is the override in `SmsNotifier`. This is the dependency inversion principle at the scale of one class. It is what lets `Notifier` be compiled, shipped and tested without any channel, and what lets step 4 add push without touching it.

The decision doesn't disappear, though. Something still has to construct an `SmsNotifier` rather than an `EmailNotifier`. That choice moves out of every call to `send()` to the place where the application is wired together, where it is made once.

**Three different things share the name.** They are easy to mix up:

| | What it is | Can a subclass change what gets created? |
|---|---|---|
| **Simple factory** | One function or class with a switch on a parameter, such as `createChannel(kind)`. It comes from *Head First Design Patterns* and is not one of the 23 GoF patterns. | No. A new kind still edits the switch, but at least the switch lives in one place instead of inside `send()`. |
| **Static factory method** | A static method used instead of a constructor, which can have a meaningful name, hand out a cached object or return a subtype. `Integer.valueOf(int)` may return a cached instance (always for −128 to 127), and the Java documentation calls `List.of(…)` a static factory method. Joshua Bloch's *Effective Java* makes the case for them in Item 1. | No. It is called on a class name, so nothing is deferred to a subclass: a different idea under a similar name. |
| **Factory Method (GoF)** | An instance method that the Creator calls and subclasses override, as in this diagram. | Yes. That is the whole point. |

On its own, *factory* just means something that creates objects. Martin Fowler's refactoring [*Replace Constructor with Factory Function*](https://refactoring.com/catalog/replaceConstructorWithFactoryFunction.html) (also listed as *Replace Constructor with Factory Method*) gives you a named creation function of the first two kinds, not the GoF pattern.

## Code

TypeScript that mirrors the diagram. Node 22.18 or later runs it as is (`node notifier.ts`) by stripping the types; it doesn't type-check them, so `tsc --noEmit` is what catches a subclass that forgets `createChannel()`.

```ts
// Product: the only type Notifier.send() knows about.
interface Channel {
  deliver(msg: string): string;
}

// ConcreteProducts
class EmailChannel implements Channel {
  deliver(msg: string): string { return `Email sent: ${msg}`; }
}

class SmsChannel implements Channel {
  deliver(msg: string): string { return `SMS sent: ${msg}`; }
}

// Creator: send() is written once, against the Channel interface.
abstract class Notifier {
  send(msg: string): string {
    const channel = this.createChannel(); // the factory method
    return channel.deliver(msg);
  }

  protected abstract createChannel(): Channel;
}

// ConcreteCreators: each one decides which Channel to create.
class EmailNotifier extends Notifier {
  protected createChannel(): Channel { return new EmailChannel(); }
}

class SmsNotifier extends Notifier {
  protected createChannel(): Channel { return new SmsChannel(); }
}

// The client holds a Notifier; the composition root picked SmsNotifier.
const notifier: Notifier = new SmsNotifier();
console.log(notifier.send('Your code is 4721')); // SMS sent: Your code is 4721

// Later, a new channel: two new classes, no edits to anything above.
class PushChannel implements Channel {
  deliver(msg: string): string { return `Push sent: ${msg}`; }
}

class PushNotifier extends Notifier {
  protected createChannel(): Channel { return new PushChannel(); }
}

console.log(new PushNotifier().send('Your code is 4721')); // Push sent: Your code is 4721
```

Output:

```
SMS sent: Your code is 4721
Push sent: Your code is 4721
```

## When to use it

- A class holds real logic around an object it creates, and subclasses should decide which concrete class that object is. This is the typical framework situation: the framework owns the algorithm and the application supplies objects by overriding hooks.
- You already have one subclass per variant, so overriding one more method costs nothing. The pattern fits best when the creator hierarchy exists anyway.
- A library wants to let its users replace one internal object by subclassing (see the examples under *Implementation notes*).
- Prefer something else when the choice changes from call to call or comes from data (pass a parameter, look the class up in a map, or pass a function), when subclasses would exist only to pick a class (pass a factory function or let a dependency-injection container do it), or when there is one implementation and no sign of a second (a plain `new` is fine).

## Trade-offs

- **A subclass per product.** Every new channel costs two classes, the channel and the notifier that creates it, and the two hierarchies grow in lockstep. Subclasses that do nothing but pick a class are ceremony, which is why code in languages with first-class functions often passes a factory function instead.
- **The choice is fixed per class.** It is made by subclassing, so it can't change at runtime without replacing the object, and combinations (SMS with a retry policy, email with templates) multiply the subclasses.
- **Inheritance couples.** Subclasses depend on the base class's protected contract: when `createChannel()` is called, how often, and what happens to its result.
- **Indirection.** Reading `send()` on its own, you can't tell which channel runs. You need to know the object's class.
- **In return,** `send()` is closed for modification and open for extension, the Creator can be tested with a fake product, and the code that uses channels and the code that chooses them change for different reasons.

## Implementation notes

- **Abstract or default.** An abstract `createChannel()` forces every subclass to choose. A default implementation (say, email) makes subclassing optional, so a subclass overrides only what it needs. Java's `AbstractList.iterator()` is a default of this kind, built on `get(int)` and `size()`, and `ArrayList` overrides it with its own iterator.
- **Parameterised factory methods.** `createChannel(kind)` takes an identifier and switches on it, and a subclass overrides it to add or replace kinds while delegating the rest to `super.createChannel(kind)`. The switch comes back, but in one overridable place instead of inside `send()`.
- **Don't call it from the constructor.** In TypeScript, JavaScript and Java, a base-class constructor that calls an overridden method runs the subclass's version before the subclass's own fields are initialised. In C++ the call never reaches the override, because virtual calls made during construction resolve to the class being constructed. Create the product on first use, or in the method that needs it, as `send()` does.
- **Test by overriding.** A test subclass can return a fake that records what it was asked to deliver, without a mocking library: `class TestNotifier extends Notifier { readonly fake = new RecordingChannel(); protected createChannel() { return this.fake; } }`.
- **Or pass a function.** When subclasses exist only to pick a class, make `Notifier` one concrete class that takes a function creating the channel, `new Notifier(() => new SmsChannel())`. The choice can then be made at runtime, and it is the [Strategy](../strategy/) idea applied to creation. Where classes are values, as in Python and JavaScript, you can pass the class itself. Some libraries offer both styles: Python's [`logging.Logger.makeRecord()`](https://docs.python.org/3/library/logging.html#logging.Logger.makeRecord) is documented as a factory method for subclasses to override, while `logging.setLogRecordFactory()` (since Python 3.2) takes a plain callable. Java's `Collectors.toCollection(TreeSet::new)` takes the factory as a `Supplier`. Dependency-injection containers generalise this: they keep a factory for each interface and build the whole object graph, as in .NET's [`services.AddTransient<IChannel>(sp => new SmsChannel())`](https://learn.microsoft.com/en-us/dotnet/api/microsoft.extensions.dependencyinjection.servicecollectionserviceextensions.addtransient).
- **Where it appears.**
  - Java: [`Collection.iterator()`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/Collection.html#iterator()). `AbstractCollection` implements `contains`, `toArray` and `toString` on top of `iterator()` and leaves `iterator()` itself to subclasses, so each collection class creates its own iterator.
  - .NET: `DbConnection.CreateCommand()` calls the protected abstract [`CreateDbCommand()`](https://learn.microsoft.com/en-us/dotnet/api/system.data.common.dbconnection.createdbcommand), which each ADO.NET provider's connection overrides to return its own command class.
  - Python: `logging.Logger.makeRecord()`, above.
  - Qt: [`QMainWindow::createPopupMenu()`](https://doc.qt.io/qt-6/qmainwindow.html#createPopupMenu) is virtual. The main window calls it when the user opens a context menu, and a subclass reimplements it to return its own menu.
- **Relatives.**
  - *Template Method*: `send()` is a small template method whose varying step is creation. Factory methods are usually called from template methods, and Factory Method is often described as a Template Method specialised for creating objects.
  - *Abstract Factory*: a separate factory object with one creation method for each product in a family, and those methods are often factory methods. .NET's [`DbProviderFactory`](https://learn.microsoft.com/en-us/dotnet/api/system.data.common.dbproviderfactory), with `CreateConnection()`, `CreateCommand()` and `CreateParameter()`, is one.
  - *Prototype*: creates objects by copying a configured instance, so it needs no creator subclasses, but it needs a reliable copy.
  - [Builder](../builder/): assembles one complex object step by step, where Factory Method decides in one call which class to instantiate.
  - [Singleton](../singleton/): a factory method may hand out a shared instance instead of a new one, and its callers can't tell the difference.
- **At architecture scale.** In [Hexagonal Architecture](../hexagonal-architecture/) the core owns a port, an interface like `Channel`, and adapters implement it. It is the same inversion, but the choice of implementation moves from a subclass override to the composition root at start-up, and the implementations are adapters to real systems (an SMTP server, an SMS gateway, a push service). A [Microkernel](../microkernel/) goes one step further: plug-ins contribute implementations to extension points that the core looks up at runtime.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- Abstract Factory *(planned)* — Create families of related objects through one interface, so swapping the whole family never touches client code.
- Template Method *(planned)* — Fix an algorithm's skeleton in a base class and let subclasses fill in individual steps, without changing their order.
- Prototype *(planned)* — Create new objects by copying a configured prototype instead of building them from scratch, and know when a copy must go deep.
- [Builder](../builder/) — Assemble a complex object step by step and validate it once at the end, instead of calling a constructor with ten arguments.
- [Strategy](../strategy/) — Put interchangeable algorithms behind one interface and choose one at runtime, instead of branching inside the caller.
- [Singleton](../singleton/) — Guarantee one instance with a global access point, and why injecting one shared instance usually serves that need better.
- [Hexagonal (Ports & Adapters)](../hexagonal-architecture/) — Domain logic at the core; UIs, databases and queues plug in through ports and adapters.

## References

- [Gamma, Helm, Johnson and Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software (1994)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610)
- [Refactoring.Guru — Factory Method](https://refactoring.guru/design-patterns/factory-method)
- [Refactoring.Guru — Factory Comparison](https://refactoring.guru/design-patterns/factory-comparison)
- [Joshua Bloch — Effective Java, 3rd edition (Item 1, static factory methods)](https://www.informit.com/store/effective-java-9780134685991)
- [Java SE 27 API — Collection.iterator()](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/Collection.html#iterator())
- [Martin Fowler — Replace Constructor with Factory Function](https://refactoring.com/catalog/replaceConstructorWithFactoryFunction.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
