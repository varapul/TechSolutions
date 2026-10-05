<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧩 Design Patterns (GoF)](../../README.md#design-patterns-gof)

# Proxy

> Stand in for another object with the same interface to control access to it: lazy loading, caching, access checks, remoting.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Proxy" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/proxy.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Load everything up front** | `GalleryPage` fills `photos: Photo[]` with `new FullPhoto(name)` for all 20 thumbnails, and each `FullPhoto` constructor reads its full-size file, 12 MB. The page holds **20 × 12 MB = 240 MB** and paints only after the last load, although the user opens a single photo, #7: 228 MB of it is never shown. |
| **2 · A stand-in, same interface** | `PhotoProxy` (the *Proxy*) implements the same `Photo` interface (the *Subject*) as `FullPhoto` (the *RealSubject*), but it keeps only the file name and an empty `real` reference. Creating 20 of them reads **0 MB**, so the page paints at once. `GalleryPage` (the *Client*) still holds `Photo[]` and calls `display()`: only the line that creates the photos changed. |
| **3 · Load on first use** | The user opens #7. `PhotoProxy.display()` finds `real` empty, creates `FullPhoto('IMG_0007.jpg')`, which reads its 12 MB, and forwards `display()` to it; the result travels back to the page. The second open finds `real` set and forwards straight away, so the page has read **12 MB once** instead of 240 MB up front. |
| **4 · Other proxies, same shape** | The same shape controls access for other reasons. `ProtectedPhoto`, a *protection proxy*, checks that the signed-in user owns the private photo and refuses bob before anything is forwarded; a *remote proxy* such as a gRPC client stub sends each call over the network, and a *caching proxy* answers repeat calls itself. JavaScript's `Proxy`, Java's `java.lang.reflect.Proxy` (behind Spring AOP's interface-based proxies) and Hibernate's lazy-loading proxies generate them for you, and at network scale the idea becomes an [ambassador](../ambassador/), an [API gateway](../api-gateway/), a [CDN](../cdn-edge-caching/) or the sidecars of a [service mesh](../service-mesh/). |
<!-- END GENERATED: header -->

## The problem

A photo gallery page shows 20 thumbnails, and clicking one opens the full-size picture: 12 MB of pixels. The natural model is a `Photo` interface with a `display()` method and a `FullPhoto` class whose constructor reads the image file. That class is simple and correct. Once a `FullPhoto` exists, it is ready to show.

The trouble is when the objects get created. If the page builds a `FullPhoto` for every thumbnail as it loads, it reads 20 × 12 MB = 240 MB before it can paint, although a typical visitor opens one photo and 228 MB of that is never shown. The obvious fixes spread the problem around. The page could create each photo on click, but then every piece of code that touches `photos[i]` has to check whether it exists yet. Or `FullPhoto` could load its pixels lazily, but then every method of the class checks its own state, and a class that described a photo now also decides when its data arrives.

The same tension appears whenever something has to happen *around* access to an object rather than inside it: checking that the viewer may see a private photo, calling an object that lives on another machine, remembering an answer that was expensive to compute. Put that logic in every caller and it gets copied and forgotten. Put it in the class and the class does two jobs.

## How it works

Put a stand-in in front of the real object. The stand-in implements the same interface, so callers can't tell the two apart, and it decides when, whether and how each call reaches the real object. Gamma, Helm, Johnson and Vlissides catalogued Proxy in *Design Patterns* (1994) as a structural pattern, also known as **Surrogate**. Their motivating example is close to this one: a document editor keeps a stand-in object for each large embedded image and loads the image only when it has to be drawn. The stand-in already knows the file name and the image's size, which is enough to lay out the page.

| Participant | In the diagram | Role |
|---|---|---|
| **Subject** | `Photo` | The interface the client uses. The real object and the proxy both implement it. |
| **RealSubject** | `FullPhoto` | The object that does the work. Here it is expensive to create, because its constructor reads 12 MB. |
| **Proxy** | `PhotoProxy`, `ProtectedPhoto` | Implements the Subject, holds the RealSubject or what it needs to create or find it, controls access and forwards calls. |
| **Client** | `GalleryPage` | Works only with `Photo` and never learns which class it holds. |

In the diagram the page holds 20 `PhotoProxy` objects, each with a file name and an empty `real` field. The first `display()` on #7 creates the `FullPhoto`, which reads its file, and forwards the call. The second finds `real` set and forwards straight away. The page's code is the same as in step 1: only the line that fills `photos` changed, from `new FullPhoto(n)` to `new PhotoProxy(n)`. In a larger application that line lives in a factory or a repository, and the page doesn't change at all.

### Kinds of proxy

The structure stays the same; the reason for standing in between changes. The book describes four kinds, and caching and logging proxies are common additions.

- **Virtual proxy.** Creates an expensive object only when it is first needed, as `PhotoProxy` does. Lazy loading in an ORM is the everyday example.
- **Protection proxy.** Checks whether the caller may perform an operation before forwarding it, as `ProtectedPhoto` does when bob opens ana's private photo in step 4.
- **Remote proxy.** A local object that stands for one in another process or on another machine and turns each method call into a message. A gRPC client stub offers the same methods as the service and sends every call over the network. The book notes that Coplien called this kind of proxy an *Ambassador*.
- **Smart reference.** Does some bookkeeping on every access: counting references so the object can be freed when the last user lets go (C++'s `std::shared_ptr` works this way), loading a persistent object the first time it is touched, or checking that the object is locked before letting anyone change it. The book also shows a proxy hiding copy-on-write: callers share one copy of a large object, and the proxy copies it only when someone modifies it.
- **Caching proxy.** Keeps the results of expensive or remote calls and answers repeats itself, so it has to decide how long an answer stays valid (see [Cache-Aside](../cache-aside/) for the invalidation side).
- **Logging proxy.** Records each call, its arguments and its result, without the caller or the real object knowing.

### Proxy, Decorator and Adapter

All three wrap one object and forward calls to it. What they do to the interface, and who provides the object inside, tells them apart:

| | Proxy | [Decorator](../decorator/) | [Adapter](../adapter/) |
|---|---|---|---|
| Interface | the subject's own | the wrapped object's own | a different one: the interface the caller expects |
| The object inside | usually created or found by the proxy itself, or by the factory or framework that hands the proxy out | passed in by whoever composes the stack, often the client | passed in by the code that wires the adapter up |
| Intent | control access: when, whether and where calls reach the real object | add behaviour, with wrappers stacked in any order | make an existing class fit an interface it doesn't implement |

The book also distinguishes proxies by the reference they hold: a remote proxy has only an indirect one, such as a host and an address on that host, while a virtual proxy starts with an indirect one (the file name) and ends up holding the object itself. The edges still blur. A protection proxy that is handed its subject is built exactly like a decorator, and the book says as much; the difference is intent, because the proxy may refuse the call. A caching wrapper is a proxy when it guards an expensive or remote subject and a decorator when it is one optional layer among several. A [Facade](../facade/) is different again: it puts a new, simpler interface over a whole subsystem instead of standing in for one object.

## Code

TypeScript that mirrors the diagram. Node 22.18 or later runs it as is (`node gallery.ts`) because it strips the types, and the assertions check what the animation shows.

```ts
import assert from 'node:assert/strict';

// Subject: the only type GalleryPage knows.
interface Photo {
  display(): string;
}

let loadedMB = 0; // full-size image data in memory: the gauge in the diagram

// RealSubject: the constructor reads the whole file, 12 MB per photo.
class FullPhoto implements Photo {
  private readonly fileName: string;

  constructor(fileName: string) {
    this.fileName = fileName;
    loadedMB += 12; // stands in for reading the 12 MB file
  }

  display(): string { return `showing ${this.fileName}`; }
}

// Virtual proxy: same interface; keeps the name, creates FullPhoto on first use.
class PhotoProxy implements Photo {
  private readonly fileName: string;
  private real?: FullPhoto;

  constructor(fileName: string) { this.fileName = fileName; }

  display(): string {
    this.real ??= new FullPhoto(this.fileName); // only the first call reads the file
    return this.real.display();
  }
}

// Protection proxy: checks the signed-in user before forwarding.
class ProtectedPhoto implements Photo {
  private readonly inner: Photo;
  private readonly owner: string;
  private readonly session: { user: string };

  constructor(inner: Photo, owner: string, session: { user: string }) {
    this.inner = inner;
    this.owner = owner;
    this.session = session;
  }

  display(): string {
    if (this.session.user !== this.owner) throw new Error(`${this.session.user} may not see it`);
    return this.inner.display();
  }
}

const names = Array.from({ length: 20 }, (_, i) => `IMG_${String(i + 1).padStart(4, '0')}.jpg`);

const eager: Photo[] = names.map((name) => new FullPhoto(name));
assert.equal(loadedMB, 240); // step 1: 20 × 12 MB before the first paint

loadedMB = 0; // the same page again, with proxies
const photos: Photo[] = names.map((name) => new PhotoProxy(name));
assert.equal(loadedMB, 0); // step 2: 20 proxies, nothing read yet

console.log(photos[6].display(), `${loadedMB} MB`); // showing IMG_0007.jpg 12 MB
console.log(photos[6].display(), `${loadedMB} MB`); // showing IMG_0007.jpg 12 MB
assert.equal(loadedMB, 12); // step 3: two opens of #7, one 12 MB read

const session = { user: 'bob' };
const privatePhoto: Photo = new ProtectedPhoto(photos[6], 'ana', session);
assert.throws(() => privatePhoto.display(), /bob may not see it/); // step 4: refused
session.user = 'ana';
console.log(privatePhoto.display()); // showing IMG_0007.jpg
```

Output:

```
showing IMG_0007.jpg 12 MB
showing IMG_0007.jpg 12 MB
showing IMG_0007.jpg
```

`GalleryPage` sees only `photos: Photo[]`. Whether an entry is a `FullPhoto`, a `PhotoProxy` or a `ProtectedPhoto` in front of one is decided where the array is filled. The protection proxy here wraps the virtual proxy: proxies with different jobs can be combined, but the code that hands out the photos combines them, not the page that uses them.

## When to use it

- An object is expensive to create or to keep in memory, and many are never used: images, documents, large records, connections. Create each one on first use behind a virtual proxy.
- Every caller must pass the same access check, and you would rather enforce it in one place than trust each caller to remember it.
- The real object lives in another process or service, and callers should use ordinary method calls. Generate the remote proxy from the service definition instead of writing it by hand.
- Repeated calls with the same arguments are expensive, and a slightly stale answer is acceptable.
- You can't change the real class (it belongs to a library) or its callers, but you do control where instances are created.
- Not when the object is cheap to create (a plain `new` is clearer), when the client should choose and combine optional extras (use [Decorator](../decorator/)), when the interfaces differ (use [Adapter](../adapter/)), or when a single field should be lazy: a lazy property inside the class, such as `??=` on first use, Kotlin's `by lazy` or .NET's `Lazy<T>`, does that with less ceremony.

## Trade-offs

- **The cost moves; it doesn't vanish.** Start-up drops from 240 MB to 0 MB, but the first open of a photo now waits for its 12 MB. If that wait shows, prefetch the likely next one, such as the next photo in a slideshow.
- **A cheap-looking call can be expensive, or fail in new ways.** `display()` may now read a file or cross the network, so it can be slow, throw an I/O error or time out. A remote proxy makes a network call look like a local one, which is exactly what makes it easy to call in a loop.
- **Identity changes.** The proxy is a different object from its subject, so equality, `instanceof` and map lookups see the proxy (see *Implementation notes*).
- **One more class to keep in step.** Every method added to `Photo` has to be added to each hand-written proxy, which is why wide interfaces are usually proxied by generated code: dynamic proxies, gRPC stubs, ORM proxies.
- **In return,** the client and the real class stay unchanged, the access policy lives in one place, and expensive objects exist only once they are used.

## Implementation notes

- **Who creates the proxy.** Not the client. A factory, a repository, a dependency-injection container or the framework hands out proxies, so the client keeps coding against the Subject. That is also how a proxy usually comes to manage its subject's lifetime, while a decorator's inner object comes from whoever builds the stack.
- **Answer cheap questions without the real object.** A proxy can keep metadata and serve it directly, as the book's image proxy reports the image's size for layout. `PhotoProxy` could answer for the file name, the dimensions or the thumbnail and create `FullPhoto` only for `display()`.
- **Lazy creation and concurrency.** `this.real ??= new FullPhoto(...)` is safe in JavaScript only because it runs synchronously. Once the load is asynchronous, two clicks that arrive together can both find `real` empty and start two 12 MB reads. Store the promise of the load instead of its result, so the second caller awaits the same one; it is the same race as the async trap in [Singleton](../singleton/). In multithreaded runtimes two threads can race the same way. In Java, guard the check with `synchronized` or use double-checked locking on a `volatile` field; .NET's [`Lazy<T>`](https://learn.microsoft.com/en-us/dotnet/api/system.lazy-1) is thread-safe by default, and Kotlin's [`by lazy`](https://kotlinlang.org/docs/delegated-properties.html#lazy-properties) is synchronized by default. The real object still has to be safe to share once it exists.
- **Identity and equality.** A proxy is never `===` its subject: `photos[6] instanceof FullPhoto` is false, and a `Map` keyed by the real `FullPhoto` finds nothing when it is given the proxy. Compare photos by an ID, not by reference. Generated proxies behave the same way:
  - MDN points out that a JavaScript `Proxy` is a separate object with its own identity, and Vue documents that the proxy returned by [`reactive()`](https://vuejs.org/guide/essentials/reactivity-fundamentals.html) is not equal to the original object.
  - A Java dynamic proxy sends `equals`, `hashCode` and `toString` to its invocation handler as well, so the handler decides what equality means.
  - Hibernate's guide warns that `equals()` must cope with being passed a proxy, and that `instanceof` and casts don't work correctly on a proxy for a polymorphic association.
- **Leaky behaviour.** Lazy loading hides when the work happens, which makes it easy to trigger in a loop. List 20 photos and read `photo.album.title` on each, where `album` is a lazy ORM proxy, and the page runs one query for the list and one more per photo, 21 in all. This is the *N+1 selects* problem, which Hibernate's guide names as the most frequent reason that data access code in Java runs slowly. Map associations as lazy, but fetch what a screen needs up front with a join fetch, or with batch or subselect fetching. Lifetimes leak too: a Hibernate proxy first touched after its session has closed throws `LazyInitializationException`.
- **Functions need less.** When the subject is a single function, a higher-order function is the whole proxy: a memoizing wrapper is a caching proxy, and a wrapper that checks a permission before calling through is a protection proxy. A dynamic `import()` does for a module of code what a virtual proxy does for an object, loading it the first time it is needed.
- **Calls from inside skip the proxy.** A proxy sees only the calls that go through it. In Spring AOP, when a method of the target calls another method on `this`, the call bypasses the proxy, so the advice on the second method, a transaction for example, doesn't run.
- **Language and framework support.**
  - JavaScript: [`Proxy`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) wraps any object in a handler whose traps (`get`, `set`, `apply`, `has` and others) intercept its basic operations, usually forwarding them with `Reflect`. A method that runs with the proxy as `this` can't reach the target's private `#fields` or a built-in's internal slots: `new Proxy(new Map(), {}).size` throws a `TypeError` unless the handler calls the method on the target itself.
  - Java: [`java.lang.reflect.Proxy`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/lang/reflect/Proxy.html), available since Java 1.3, creates a class at runtime that implements a list of interfaces and sends every call to an `InvocationHandler`. It proxies interfaces, not classes.
  - Spring: [Spring AOP](https://docs.spring.io/spring-framework/reference/core/aop/proxying.html) uses those JDK dynamic proxies when the target implements at least one interface and generates a CGLIB subclass when it doesn't. Spring Boot may make class-based proxies the default, and since Spring Framework 7.0 the `@Proxyable` annotation chooses the kind for an individual bean.
  - ORMs: Hibernate's `getReference()` returns an unfetched proxy, and lazy associations are proxies that load on first use. EF Core's [lazy-loading proxies](https://learn.microsoft.com/en-us/ef/core/querying/related-data/lazy) (`UseLazyLoadingProxies()`, from the `Microsoft.EntityFrameworkCore.Proxies` package) work on navigation properties that can be overridden, which means `virtual` ones on classes that can be inherited from.
  - gRPC: the generated [client stub](https://grpc.io/docs/what-is-grpc/introduction/) is a remote proxy with the service's methods.
  - Python: [`weakref.proxy`](https://docs.python.org/3/library/weakref.html#weakref.proxy) is a smart reference that doesn't keep its object alive; using it after the object has been collected raises `ReferenceError`.
- **At architecture scale.** The proxy moves out of the process and in front of a network endpoint. An [Ambassador](../ambassador/) is a remote proxy that runs next to its client and adds retries, TLS and routing to the client's outbound calls. An [API Gateway](../api-gateway/) is a reverse proxy in front of many services that authenticates, rate-limits and routes, a protection proxy for a whole API. A [CDN](../cdn-edge-caching/) is a caching proxy for HTTP, and a [Service Mesh](../service-mesh/) puts a [sidecar](../sidecar/) proxy next to every service. The idea carries over, since clients keep calling the same address with the same protocol, but the interface is now a protocol instead of a method signature, every call pays a network hop, and the proxy is a process to deploy, scale and monitor, configured rather than coded.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Decorator](../decorator/) — Wrap an object to add behaviour at runtime, stacking wrappers instead of multiplying subclasses for every combination.
- [Adapter](../adapter/) — Wrap an incompatible interface so existing code can use it unchanged: the classic fix for a third-party or legacy API.
- [Facade](../facade/) — Give a complex subsystem one simple entry point, so callers make one call instead of orchestrating many classes.
- [Ambassador](../ambassador/) — An out-of-process proxy that handles outbound connectivity (retries, TLS, routing) for a client.
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- [CDN & Edge Caching](../cdn-edge-caching/) — Serve static content from edge locations close to users; only cache misses reach the origin.
- [Service Mesh](../service-mesh/) — Sidecar proxies plus a control plane: mTLS, retries and traffic shifting without touching app code.
- [Sidecar](../sidecar/) — Run helper capabilities (proxy, logging, config) in a separate process next to the app.

## References

- [Gamma, Helm, Johnson and Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software (Addison-Wesley, 1994)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610)
- [Refactoring.Guru — Proxy](https://refactoring.guru/design-patterns/proxy)
- [MDN — Proxy (JavaScript)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy)
- [Java SE 27 API — java.lang.reflect.Proxy](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/lang/reflect/Proxy.html)
- [Spring Framework reference — Proxying Mechanisms (AOP)](https://docs.spring.io/spring-framework/reference/core/aop/proxying.html)
- [Hibernate ORM 7.4 — A Short Guide to Hibernate 7 (proxies, lazy fetching, N+1 selects)](https://docs.hibernate.org/orm/7.4/introduction/html_single/)
- [gRPC — Introduction to gRPC (client stubs)](https://grpc.io/docs/what-is-grpc/introduction/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
