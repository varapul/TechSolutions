<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧩 Design Patterns (GoF)](../../README.md#design-patterns-gof)

# Facade

> Give a complex subsystem one simple entry point, so callers make one call instead of orchestrating many classes.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Facade" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/facade.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Every caller orchestrates** | ProfilePhotoController and ProductImageController each call **MimeSniffer**, **Resizer**, **Optimizer**, **ObjectStore** and **CdnPurger** themselves, in the right order and with the right options. The sequence and the list of sizes are copied into both, so a new 2,000 px size, or a new CDN path, is the same edit in two places, and every new caller adds another. |
| **2 · One entry point** | **ImageUploader** is the facade: its one method, `upload(file)`, owns the sequence and the sizes, and both controllers now call only that, so a new size is one edit. The five classes are unchanged and still public: a rare caller that needs just one of them, here a CdnAdminTool that purges a path by hand, still calls it directly (the dotted line). |
| **3 · One call, eleven behind it** | ProfilePhotoController calls `upload('cat.jpg')` once. Behind it the facade detects `image/jpeg`, resizes to 150, 600 and 1,200 px, compresses and stores each size, and purges `/img/cat/*`: **11 subsystem calls** for one facade call. The three URLs come back to the controller. |
| **4 · What it is and isn't** | A facade defines a new, simpler interface and adds no features of its own: a **Decorator** keeps an object's interface and adds behaviour, and an **Adapter** makes an existing interface fit the one its clients expect. Keep it thin, coordination rather than business rules, or it grows into a god object. The same idea appears as SLF4J, the Simple Logging Facade for Java, and between services as an API gateway, gateway aggregation or a backend for each frontend. |
<!-- END GENERATED: header -->

## The problem

An image upload in a web application needs five classes. `MimeSniffer` works out the file type, `Resizer` makes each size, `Optimizer` compresses each one, `ObjectStore` stores it and returns its URL, and `CdnPurger` clears the cached path so the CDN serves the new files. Each class is small and does one job well, but whoever uploads an image has to know all five, call them in the right order (detect before resizing, store before purging), pass the right options and collect the results.

When every caller does that itself, the knowledge is copied into every caller. `ProfilePhotoController` and `ProductImageController` each carry the same eleven calls and the same list of sizes, so a new 2,000 px size, a switch to WebP or a different CDN means the same edit in both, and a third caller would mean a third copy. Each controller is also coupled to all five classes: the subsystem can't change without them, and every controller test has to mock five collaborators and the order of their calls.

## How it works

Gamma, Helm, Johnson and Vlissides describe Facade in *Design Patterns* (1994) as a structural pattern: put one higher-level interface in front of a subsystem's many classes, so that a common task becomes a single call and callers depend on one class instead of all of them.

- **Facade** (`ImageUploader`) knows which classes handle each part of a request, and in what order, and delegates to them. It may translate between its own interface and theirs (here it derives the storage keys and the purge path from the file name), but the real work stays in the subsystem.
- **Subsystem classes** (`MimeSniffer`, `Resizer`, `Optimizer`, `ObjectStore`, `CdnPurger`) do that work. They treat the facade like any other caller and hold no reference to it.
- **Clients** (the two controllers) call the facade. A client that needs something the facade doesn't offer can still use a subsystem class directly; the book counts this as a benefit, since each caller can pick convenience or full control.

The dependencies point one way: clients know the facade, the facade knows the subsystem, and the subsystem knows neither. That keeps the subsystem reusable on its own, and the facade can be rewritten or replaced without touching it.

What stays reachable behind the facade is a separate decision. The book distinguishes a subsystem's public classes from its private ones and notes that few object-oriented languages of the time could enforce the difference. Module systems can now: a Java module exports only the packages it names, and the others are inaccessible from other modules ([JEP 261](https://openjdk.org/jeps/261)); a Node.js package with an `exports` field refuses imports of any path it doesn't list ([package entry points](https://nodejs.org/api/packages.html#package-entry-points)), although an absolute file path still gets through. In a [modular monolith](../modular-monolith/) each module's public API is exactly this kind of facade, and a check in the build stops other modules from reaching past it.

Facades also give layers their entry points: the book suggests one for each level of a layered subsystem, so each level talks to the next through a small surface ([Layered Architecture](../layered-architecture/)). Martin Fowler's Service Layer is the application-wide version: one set of operations that every interface of the application shares (user interfaces, integration gateways, data loaders), each coordinating the response to one request. When the business rules live in a domain model, the service layer can stay thin and delegate, and then it is a facade over the domain; Fowler's [Anemic Domain Model](https://martinfowler.com/bliki/AnemicDomainModel.html) article quotes Eric Evans describing that thin application layer.

## Code

TypeScript that Node.js 22.18 or later runs as is (`node facade.ts`: type stripping is on by default from that release). Every subsystem class appends its call to one shared log, so the asserts at the end can check the exact sequence behind one `upload()`.

```ts
import assert from 'node:assert/strict';

type Image = { file: string; width: number };
const CDN = 'https://cdn.example.com/';
const log: string[] = [];                  // every subsystem call, in order

// The subsystem: five small classes, one job each. None of them knows the facade.
class MimeSniffer {
  detect(file: string): string { log.push(`detect ${file}`); return 'image/jpeg'; }
}
class Resizer {
  resize(file: string, w: number): Image { log.push(`resize ${w}`); return { file, width: w }; }
}
class Optimizer {
  compress(img: Image): Image { log.push(`compress ${img.width}`); return img; }
}
class ObjectStore {
  put(key: string, img: Image): string { log.push(`put ${key}`); return CDN + key; }
}
class CdnPurger {
  purge(path: string): void { log.push(`purge ${path}`); }
}

// The facade: owns the sequence and the sizes; the real work stays in the subsystem.
class ImageUploader {
  static readonly WIDTHS = [150, 600, 1200];
  private readonly sniffer = new MimeSniffer();
  private readonly resizer = new Resizer();
  private readonly optimizer = new Optimizer();
  private readonly store = new ObjectStore();
  private readonly cdn = new CdnPurger();

  upload(file: string): string[] {
    const type = this.sniffer.detect(file);
    if (!type.startsWith('image/')) throw new Error(`${file} is not an image`);
    const name = file.replace(/\.[^.]+$/, '');                    // 'cat.jpg' -> 'cat'
    const sized = ImageUploader.WIDTHS.map((w) => this.resizer.resize(file, w));
    const small = sized.map((img) => this.optimizer.compress(img));
    const urls = small.map((img) => this.store.put(`img/${name}/${img.width}.jpg`, img));
    this.cdn.purge(`/img/${name}/*`);
    return urls;
  }
}

// ProfilePhotoController and ProductImageController each make just this one call.
const urls = new ImageUploader().upload('cat.jpg');
console.log(urls.join('\n'));
console.log(`${log.length} subsystem calls for 1 facade call`);
// https://cdn.example.com/img/cat/150.jpg
// https://cdn.example.com/img/cat/600.jpg
// https://cdn.example.com/img/cat/1200.jpg
// 11 subsystem calls for 1 facade call

assert.deepEqual(log, [
  'detect cat.jpg', 'resize 150', 'resize 600', 'resize 1200',
  'compress 150', 'compress 600', 'compress 1200',
  'put img/cat/150.jpg', 'put img/cat/600.jpg', 'put img/cat/1200.jpg',
  'purge /img/cat/*',
]);
assert.equal(log.length, 1 + 3 + 3 + 3 + 1);
```

Test a facade at two levels. In the controllers' tests, replace `ImageUploader` with a stub whose `upload()` returns three URLs: one fake instead of five mocks and their order. The facade's own tests run it against the real subsystem, or against local stand-ins for the object store and the CDN, and check what the asserts above check: the order of the calls, the sizes, the keys and the purge path. That is where orchestration bugs live, and mocking every subsystem class there would only restate the implementation.

## When to use it

- A subsystem of several collaborating classes with a few common tasks that every caller would otherwise script the same way: uploading media, checking out a basket, sending a notification through a template engine, a mail client and a delivery log.
- To give a module, package or layer a small public entry point and keep the rest internal.
- To shield callers from a subsystem you expect to change: swap the image library or the CDN behind the facade and no controller notices.
- To put a few task-shaped methods in front of a large third-party SDK of which you use a small part.

Skip it when:

- There is one class and its interface is already usable; a facade over it only adds a hop.
- Callers need many different combinations of the subsystem's operations. A facade that mirrors every method simplifies nothing.
- What you need is extra behaviour around calls ([Decorator](../decorator/)) or a class made to fit an interface its callers already expect ([Adapter](../adapter/)).

## Trade-offs

- **Convenience versus control.** A facade serves the common case. Callers with unusual needs go around it, as `CdnAdminTool` does in the diagram, or get a second facade; adding every special option to the first one makes it as complicated as what it hides.
- **The god object.** Facades attract code: billing for uploads, an email when a photo changes, a moderation check. Each addition is convenient, and soon one class knows every part of the application and every team edits it. Keep a facade to coordination; rules belong in the subsystem or the domain.
- **One call can hide a lot of work.** `upload()` reads like one operation and makes eleven calls. In process that is cheap. Once the classes behind it become remote services it means eleven network calls with their latency and partial failures, which the method's name doesn't reveal, so measure it and document what it costs.
- **Another interface to keep in step.** When the subsystem gains a capability, callers wait for the facade to expose it or go around it. A rare bypass is fine; many callers going around the facade mean its interface is wrong.

## Implementation notes

- **Keep it thin.** A facade sequences calls, translates arguments and maps results. Validation that a subsystem class can own, business rules and state belong elsewhere; a facade full of decisions about prices or permissions has become an application service with rules of its own.
- **Several facades for one subsystem.** One facade per audience or task area keeps each one small: `ImageUploader` for the upload flow, an `ImageMaintenance` facade for re-encoding and purges, a `VideoUploader` that reuses `ObjectStore` and `CdnPurger`. Facades can call each other; refactoring.guru calls the extra ones *additional facades*. The book observes that one facade *object* per subsystem is usually enough, which is why facades are often singletons; one shared instance registered in a dependency-injection container gives the same without global state (see [Singleton](../singleton/)).
- **Splitting a facade that grows.** The signs: methods for unrelated features, fields for half the application, and every change and every team passing through one class. Group its methods by the callers or capabilities they serve, move each group into a facade of its own, and push any rule it collected down into the class that owns the data. Each caller then depends on the smaller facade it uses.
- **Inject the subsystem.** Pass the five objects in through the constructor (the example builds them itself only to stay short). Tests can then hand the facade stand-ins, and a different implementation, another object store say, needs no change to the facade. The book lists this as one of two ways to loosen the coupling further; the other is an abstract facade with one concrete subclass per subsystem implementation.
- **One facade, several implementations.** SLF4J, the Simple Logging Facade for Java, is one logging API in front of whichever framework is deployed: Logback implements it natively, and reload4j or `java.util.logging` plug in through provider modules. SLF4J 2.0 finds the provider with Java's `ServiceLoader`; with none on the class path it prints a warning and falls back to a no-op logger that discards every call. Apache Commons Logging fills the same role and calls itself a thin bridge between logging implementations. Libraries log through the facade, and the application chooses the framework at deployment time.
- **First-class functions and modules.** Where a language has them, a facade often isn't a class at all: a module that exports one `uploadImage(file)` function and keeps the five helpers unexported is the same pattern.

**Facade and its neighbours.** Several patterns put an object between a caller and other objects. What differs is the interface they offer and what they are for:

| Pattern | Interface it offers | Purpose |
|---|---|---|
| Facade | a new, simpler one over several objects | make a subsystem easy to use, without new features |
| [Adapter](../adapter/) | the one its callers already expect | make one existing class fit |
| [Decorator](../decorator/) | the same as the object it wraps | add behaviour at runtime |
| Proxy | the same as its subject | control access: create lazily, call remotely, check permissions |
| Mediator | one its colleagues call, and it calls them | coordinate the interactions among peers |

The book draws two of these lines itself. A facade defines a new interface, where an adapter reuses one that already exists. And a mediator's colleagues know it and communicate through it, and it often carries behaviour that belongs to none of them, while a facade only makes the subsystem easier to use and its classes don't know it exists. Abstract Factory works alongside a facade, creating the subsystem's objects without naming their concrete classes, or replaces it when the only goal is to hide platform-specific classes.

**Architecture-scale cousins.** The same move works between services, where every call crosses a network:

- An [API Gateway](../api-gateway/) is one entry point in front of many services. Microsoft's .NET microservices guide compares it to the Facade pattern, applied to a distributed system, and warns that a single gateway serving every client app swells into a monolith of its own; it recommends splitting gateways by client type and by business boundary.
- [Gateway Aggregation](../gateway-aggregation/) is step 3 of the diagram over a network: one client request becomes several service calls whose answers are merged. Azure's guidance moves aggregation that needs real domain logic into a dedicated service behind the gateway, the same keep-it-thin rule.
- [Backends for Frontends](../backends-for-frontends/) gives each client experience a facade of its own over the same services: several facades for one subsystem.
- At that scale each call can time out or fail on its own, so the facade needs timeouts and a rule for partial results, and the classes behind it become services that other teams deploy.
- An [Anti-Corruption Layer](../anti-corruption-layer/) often includes a facade that simplifies a legacy system's interface, still in the legacy system's own terms, next to adapters and translators. The facade in a [Strangler Fig](../strangler-fig/) migration is a different thing: a router that keeps the interface clients already use and decides which system answers, which makes it closer to a proxy.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Adapter](../adapter/) — Wrap an incompatible interface so existing code can use it unchanged: the classic fix for a third-party or legacy API.
- Mediator *(planned)* — Route the interactions between objects through one mediator, so many-to-many dependencies become one-to-many.
- Abstract Factory *(planned)* — Create families of related objects through one interface, so swapping the whole family never touches client code.
- [Singleton](../singleton/) — Guarantee one instance with a global access point, and why injecting one shared instance usually serves that need better.
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- [Gateway Aggregation](../gateway-aggregation/) — Fan one client request out to several services and merge the answers into one response.
- [Backends for Frontends (BFF)](../backends-for-frontends/) — A dedicated backend per client type, shaped for exactly what that UI needs.
- [Modular Monolith](../modular-monolith/) — One deployable unit built from strongly bounded modules that talk through explicit interfaces.
- [Layered (N-Tier)](../layered-architecture/) — Presentation, business and data layers; each layer only calls the one directly below it.

## References

- [Gamma, Helm, Johnson and Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software (Addison-Wesley, 1994)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610)
- [SLF4J — SLF4J Manual](https://www.slf4j.org/manual.html)
- [Martin Fowler — Service Layer (Patterns of Enterprise Application Architecture catalog)](https://martinfowler.com/eaaCatalog/serviceLayer.html)
- [Azure Architecture Center — Gateway Aggregation pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/gateway-aggregation)
- [Microsoft — The API gateway pattern versus direct client-to-microservice communication](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/architect-microservice-container-applications/direct-client-to-microservice-communication-versus-the-api-gateway-pattern)
- [Refactoring.Guru — Facade](https://refactoring.guru/design-patterns/facade)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
