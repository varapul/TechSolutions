<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧩 Design Patterns (GoF)](../../README.md#design-patterns-gof)

# Decorator

> Wrap an object to add behaviour at runtime, stacking wrappers instead of multiplying subclasses for every combination.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Decorator" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/decorator.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · A subclass per combination** | Adding retries, logging and caching by subclassing `FetchClient` needs a class for every combination: 2³ − 1 = 7 for three features, 15 for four. The caller picks one with `new`, so the mix, and the order the features run in, are baked into the class hierarchy. |
| **2 · Wrap instead** | `LoggingClient` and `RetryingClient` each implement `HttpClient` and hold the `HttpClient` they wrap, so they nest: `new LoggingClient(new RetryingClient(new FetchClient()))`. Three features need three small classes that combine in any mix and order at runtime, and the caller still holds one `HttpClient`. |
| **3 · One call, layer by layer** | `LoggingClient` logs `→ GET /orders` and passes the call in; `RetryingClient` passes it to `FetchClient`, which gets a 503. `RetryingClient` waits 200 ms and calls again: 200. The response travels back out through each layer and `LoggingClient` logs `← 200`: two lines, because it sits outside the retry and never sees the 503. |
| **4 · Order matters** | `new RetryingClient(new LoggingClient(new FetchClient()))` puts logging inside the retry, so it records every attempt: `→`, `← 503`, `→`, `← 200`. Java's `java.io` streams wrap the same way (a `BufferedInputStream` around a `FileInputStream`), and so does .NET's `DelegatingHandler` pipeline; Python's `@decorator` syntax applies a related idea to functions, and a [sidecar](../sidecar/) proxy is the out-of-process cousin. |
<!-- END GENERATED: header -->

## The problem

An `HttpClient` sends requests, and different callers want different extras around each call: retry a 503, log every request, cache `GET` responses. The obvious tool is inheritance: `RetryingClient extends FetchClient`, `LoggingClient extends FetchClient`. It stops working the moment a caller wants two extras at once, because every combination needs a class of its own. Three optional features already need 2³ − 1 = 7 subclasses (`RetryingLoggingClient`, `LoggingCachingClient` and the rest), a fourth makes it 15, and the retry or logging code is copied or tangled across all of them.

The choice is also frozen at compile time. A caller picks one class with `new`, so it can't add logging to a client it was handed, configuration can't switch retries off without yet another class, and the order in which the features run is buried inside each combined class.

## How it works

Wrap the object instead of subclassing it. A decorator implements the same interface as the object it wraps, holds a reference to it, and does its own small job before or after passing each call on. Because a decorator is itself an `HttpClient`, it can wrap another decorator, so features stack in any number and any order, chosen at runtime. Gamma, Helm, Johnson and Vlissides catalogued it as a structural pattern, also known as **Wrapper**.

The participants, mapped onto the diagram:

- **Component** (`HttpClient`): the interface callers depend on; here a single method, `send(req)`.
- **ConcreteComponent** (`FetchClient`): the object that does the real work, the HTTP call.
- **Decorator** (`LoggingClient`, `RetryingClient`): implements `HttpClient`, keeps the `HttpClient` it wraps in `inner`, and forwards to it. In the book an abstract Decorator class holds the reference and forwards every call, and *ConcreteDecorators* extend it to add the extra behaviour. With a one-method interface that base class saves nothing, so here each decorator implements the interface directly and plays both roles. With a wide interface the base class pays off: Java's `FilterInputStream` is exactly that class.

`new LoggingClient(new RetryingClient(new FetchClient()))` builds the onion in the animation. The caller holds the outermost object and sees one `HttpClient`; it can't tell how many layers there are. A call travels in through every layer, and the response travels back out through the same layers in reverse order, so each decorator can act on the way in, on the way out, or both.

### Why composition beats subclassing here

- **Combinations at runtime.** *n* features need *n* decorator classes instead of 2ⁿ − 1 subclasses, and any subset can be assembled per call site, per environment or from configuration.
- **One responsibility per class.** The retry policy lives only in `RetryingClient` and the log format only in `LoggingClient`. Each one can be tested on its own against a fake inner client.
- **Extension without edits.** Caching is one more class, `CachingClient`, and no existing class changes.

### Transparency and identity

A decorator has to keep the interface's contract: the same inputs, the same kinds of results and errors, the same meaning. Callers must not break when a layer is added or removed. A retry decorator that also retries a `POST` that is not idempotent, or a cache that serves data older than callers accept, breaks that promise even though the types still line up.

A decorated object is also a different object. `new LoggingClient(fetchClient) === fetchClient` is `false`, `instanceof FetchClient` is false for the wrapper, and a decorated client used as a map key won't find the entry stored under the plain one. The book warns against relying on object identity when decorators are involved.

### Order matters

The stack is a sequence, and reordering it changes the behaviour:

- **Logging once or per attempt.** Logging outside the retry writes one pair of lines per call (step 3: two lines) and records what the caller experienced, including the time spent retrying. Logging inside the retry writes a pair per attempt (step 4: four lines) and records what the server saw.
- **Cache outside or inside the retry.** With `new CachingClient(new RetryingClient(new FetchClient()))` a hit never reaches the retry logic and only the final outcome is stored. With the cache inside the retry it is consulted again on every attempt, and if it ever stores a 503, each retry gets that same 503 back from the cache.
- **Timeouts.** A timeout outside the retry bounds the whole operation, waits included; one inside bounds each attempt.

### Decorator and its relatives

Decorator, Proxy and Adapter all wrap an object; they differ in intent.

- **Proxy** has the same structure (same interface, a reference to the real object) but a different purpose: it controls access to the object, for lazy loading, access checks, remoting or caching. A proxy usually creates or looks up the object it stands in for, so callers don't choose what sits behind it; a decorator is handed its inner object by whoever composes the stack, and decorators are meant to be stacked.
- **Adapter** gives an object a *different* interface so existing code can call it. A decorator keeps the interface and changes the behaviour, which is why decorators can wrap each other recursively and adapters, whose outside differs from their inside, can't.
- **Chain of Responsibility** also links objects in a line, but each handler decides whether the request is its job and may stop it there. A decorator normally always forwards; a caching decorator that answers a hit without forwarding is borrowing that idea.
- **Strategy** puts the variation *inside* the object: the object delegates part of its work to a strategy it holds, so it has to know that the variation exists. In the book's phrase, a decorator changes an object's "skin" and a strategy changes its "guts". Choose Strategy when `FetchClient` should own the variation (a pluggable backoff policy, say), Decorator when it should stay unaware of it.
- **Composite** is structurally close: a decorator is like a composite with exactly one child. The intent differs: a composite makes a group act like one object; a decorator adds behaviour to one object.

## Code

The diagram's scenario in TypeScript. Save it as `decorator.ts` and run `node decorator.ts`; Node.js strips the types itself (on by default since 22.18).

```ts
import assert from 'node:assert/strict';

type HttpRequest = { method: string; path: string };
type HttpResponse = { status: number };

// Component: the one interface every layer implements
interface HttpClient {
  send(req: HttpRequest): Promise<HttpResponse>;
}

// ConcreteComponent: the real call (faked here: the first attempt gets a 503)
class FetchClient implements HttpClient {
  private attempts = 0;
  async send(req: HttpRequest): Promise<HttpResponse> {
    this.attempts += 1;
    return { status: this.attempts === 1 ? 503 : 200 };
  }
}

// Decorator: on a 503, wait 200 ms and call the wrapped client once more
class RetryingClient implements HttpClient {
  private readonly inner: HttpClient;
  constructor(inner: HttpClient) { this.inner = inner; }
  async send(req: HttpRequest): Promise<HttpResponse> {
    const res = await this.inner.send(req);
    if (res.status !== 503) return res;
    await new Promise((resolve) => setTimeout(resolve, 200));
    return this.inner.send(req);
  }
}

// Decorator: log the request on the way in and the status on the way out
class LoggingClient implements HttpClient {
  private readonly inner: HttpClient;
  readonly lines: string[] = [];
  constructor(inner: HttpClient) { this.inner = inner; }
  async send(req: HttpRequest): Promise<HttpResponse> {
    this.lines.push(`→ ${req.method} ${req.path}`);
    const res = await this.inner.send(req);
    this.lines.push(`← ${res.status}`);
    return res;
  }
}

const get: HttpRequest = { method: 'GET', path: '/orders' };

// Logging outside the retry: one call, two lines
const outside = new LoggingClient(new RetryingClient(new FetchClient()));
console.log((await outside.send(get)).status, outside.lines);
// 200 [ '→ GET /orders', '← 200' ]

// Logging inside the retry, new RetryingClient(new LoggingClient(new FetchClient())): every attempt
const inside = new LoggingClient(new FetchClient());
console.log((await new RetryingClient(inside).send(get)).status, inside.lines);
// 200 [ '→ GET /orders', '← 503', '→ GET /orders', '← 200' ]

assert.deepEqual(outside.lines, ['→ GET /orders', '← 200']);
assert.deepEqual(inside.lines, ['→ GET /orders', '← 503', '→ GET /orders', '← 200']);
```

## When to use it

- Optional, independent behaviours around a stable interface: retries, logging, metrics, caching, authentication headers, compression, buffering, encryption.
- When the mix or the order has to be chosen at runtime: from configuration, per environment, per call site.
- When you can't or shouldn't subclass: the class is final or sealed, it belongs to a library, or you only ever receive an instance from a factory or a dependency-injection container.
- Not when the interface is wide (every method must be forwarded; generate the forwarding or use a framework's interception instead), when the behaviour needs the object's internals (change the class, or use Strategy), or when callers depend on the concrete type or on object identity.

## Trade-offs

- **Many small objects.** One call passes through several layers, so stack traces and debugger sessions get deeper, and a reader has to find where the stack is assembled to know what a call does.
- **Order is configuration.** The composition root now decides behaviour, and a wrong order is a real bug that type checks won't catch. Review and test it like code.
- **Identity and type checks break.** Equality, `instanceof` and map lookups see the wrapper, not the original.
- **Wide interfaces cost forwarding code.** Each extra method is one more place to forget to pass the call on; a forwarding base class (like `FilterInputStream`) or generated forwarding keeps that in one place.
- **A little overhead per layer.** One extra call per decorator, negligible next to network I/O, noticeable in tight loops.

## Implementation notes

- **Python's `@decorator` syntax** applies a function to a function (or class) when it is defined and binds the name to whatever comes back, usually a wrapper that runs code before and after the original; the [glossary](https://docs.python.org/3/glossary.html#term-decorator) names `@classmethod` and `@staticmethod` as common examples. It is the same wrapping idea applied to functions, and [PEP 318](https://peps.python.org/pep-0318/) itself notes that the name does not match its use in the GoF book. Use [`functools.wraps`](https://docs.python.org/3/library/functools.html#functools.wraps) so the wrapper keeps the original's name and docstring.
- **JavaScript higher-order functions** give the same layering without any syntax: `const send = withLogging(withRetry(fetchOrders))`. The nesting order is the layer order, exactly as with objects.
- **TypeScript's `@decorator` syntax is a different mechanism.** It is a function the runtime calls on a class or class member as the class is defined, used for metadata, registration or wrapping a method. TypeScript 5.0 implemented the ECMAScript [decorators proposal](https://github.com/tc39/proposal-decorators), which TC39 lists at Stage 2.7 as of October 2026, alongside the older `--experimentalDecorators` mode. Node.js's [type stripping](https://nodejs.org/api/typescript.html) rejects decorator syntax, one more reason the example above wraps objects by hand.
- **Java's `java.io`** is the textbook case: `FilterInputStream` wraps another `InputStream` and forwards to it, and subclasses such as `BufferedInputStream` (buffering, `mark` and `reset`), `DataInputStream`, `InflaterInputStream` and `CipherInputStream` stack on top, as in `new BufferedInputStream(new FileInputStream("orders.csv"))`.
- **.NET's `HttpClient`** builds its outgoing pipeline from `DelegatingHandler`s: each is an `HttpMessageHandler` that holds an inner handler. Handlers added with `AddHttpMessageHandler` through `IHttpClientFactory` run in registration order, each wrapping the next, until the primary handler sends the request (`SocketsHttpHandler` by default since .NET 9, `HttpClientHandler` before), and Polly-based retry policies plug into the same pipeline.
- **Middleware pipelines** in web frameworks look similar: in [ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/) each middleware can do work before and after the next one, like a decorator, but it may also end the request early, like a chain of responsibility.
- **At architecture scale** the wrapper moves out of the process. A [sidecar](../sidecar/) proxy, or an [ambassador](../ambassador/) for outbound calls, wraps a service's network traffic and adds retries, timeouts, TLS and telemetry without touching its code, and a [service mesh](../service-mesh/) runs such proxies for every service and configures them all from a control plane. The interface becomes a network protocol, the layers can be written in any language and upgraded on their own, and each layer costs a hop and a process to run. Order still matters, and retries at two layers multiply: see [Retry with Backoff](../retry-with-backoff/), which a real `RetryingClient` also needs (retry only idempotent requests, with backoff and jitter). For the caching layer, see [Cache-Aside](../cache-aside/).

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Proxy](../proxy/) — Stand in for another object with the same interface to control access to it: lazy loading, caching, access checks, remoting.
- [Adapter](../adapter/) — Wrap an incompatible interface so existing code can use it unchanged: the classic fix for a third-party or legacy API.
- [Composite](../composite/) — Treat single objects and groups of objects through one interface, so a whole tree answers a question the way one leaf does.
- [Chain of Responsibility](../chain-of-responsibility/) — Pass a request along a chain of handlers until one handles it, so the sender never needs to know which one will.
- [Strategy](../strategy/) — Put interchangeable algorithms behind one interface and choose one at runtime, instead of branching inside the caller.
- [Sidecar](../sidecar/) — Run helper capabilities (proxy, logging, config) in a separate process next to the app.
- [Retry with Backoff & Jitter](../retry-with-backoff/) — Retry transient failures with growing, randomised delays so clients don't stampede.
- [Cache-Aside](../cache-aside/) — Read from the cache first; on a miss load from the database and populate the cache.

## References

- [Gamma, Helm, Johnson and Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software (Addison-Wesley, 1994)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610)
- [Java SE 27 API — java.io.FilterInputStream](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/io/FilterInputStream.html)
- [Microsoft Learn — Make HTTP requests with IHttpClientFactory in ASP.NET Core (outgoing request middleware)](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/http-requests)
- [Microsoft Learn — DelegatingHandler class](https://learn.microsoft.com/en-us/dotnet/api/system.net.http.delegatinghandler)
- [Python documentation — Glossary: decorator](https://docs.python.org/3/glossary.html#term-decorator)
- [PEP 318 — Decorators for Functions and Methods](https://peps.python.org/pep-0318/)
- [Refactoring.Guru — Decorator](https://refactoring.guru/design-patterns/decorator)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
