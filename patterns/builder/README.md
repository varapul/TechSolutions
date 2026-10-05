<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧩 Design Patterns (GoF)](../../README.md#design-patterns-gof)

# Builder

> Assemble a complex object step by step and validate it once at the end, instead of calling a constructor with ten arguments.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Builder" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/builder.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Telescoping constructor** | Without a builder, every option is a constructor parameter in a fixed order. To set `timeoutMs` the call must also fill `connectTimeoutMs` before it, so it passes `null`; the two timeouts share a type, so swapping `null` and `5000` still compiles, and nothing at the call site says what `true` means. Each new option makes the list longer. |
| **2 · Build it step by step** | A `RequestBuilder` takes one named call per part and keeps the parts it has collected so far. `json()` serialises the body with `JSON.stringify` and sets `Content-Type: application/json` as well, and options you never call keep their defaults. `build()` creates the `Request` from the parts and freezes it. |
| **3 · Check once, at build()** | Some rules span several parts: a body is fine on a POST but not on a GET. So `build()` checks the whole combination once, before anything is sent: a GET with a body, or a request with no URL, fails with a clear error, and the valid POST comes back frozen. Writing to it afterwards fails, with a `TypeError` in strict-mode code. |
| **4 · Same steps, two products** | In the GoF form a **Director**, `describeCreateOrder(b)`, holds the recipe and calls the steps through the `Builder` interface, and each concrete builder decides what the result is: `RequestBuilder` a frozen `Request`, the new `CurlBuilder` a `curl` command line, with no change to the Director. Java's `HttpRequest.newBuilder()`, `StringBuilder` and Lombok's `@Builder` apply the same idea, while named arguments or an options object often make a builder unnecessary. |
<!-- END GENERATED: header -->

## The problem

An HTTP request has one value you always need, the URL, and a long tail of options: the method, headers, a body, timeouts, whether to follow redirects. Put them all in one constructor and every call becomes a row of positional values:

```ts
new Request('https://api.example.com/orders', 'POST', headers, body, null, 5000, true);
```

Joshua Bloch calls the classic form of this the **telescoping constructor**: one constructor takes the required parameters, the next adds one option, the next another, each passing defaults down the line. However it is written, the call site suffers in the same ways:

- **Placeholders.** To set `timeoutMs` the call must also fill `connectTimeoutMs`, which comes first and isn't needed, so it passes `null`.
- **Silent mix-ups.** The two timeouts sit next to each other with the same type, so swapping them still compiles, and the request ends up with a connect timeout and no overall time limit.
- **Values without names.** Nothing at the call site says that `true` means "follow redirects".
- **Growth.** Every new option lengthens the list or adds another overload.

The usual way out, a constructor with no arguments plus a setter per option, reads better but hands out an object that can be used half configured and can never be immutable. It also has no moment at which every field is known, so a rule that involves several of them, such as "a GET has no body", has no natural place to be checked.

## How it works

A **builder** takes construction out of the constructor. It collects the parts one named step at a time, remembers what it has so far, and produces the finished object only when asked, after checking that the parts fit together. Two shapes share the name.

**The GoF Builder** (Gamma, Helm, Johnson and Vlissides, 1994) keeps the recipe for assembling an object apart from the code that decides what the result looks like, so one recipe can yield results of different kinds:

| Participant | In the diagram | Role |
|---|---|---|
| Builder | the `Builder` interface | declares the steps: `url`, `method`, `header`, `json`, `timeout` |
| ConcreteBuilder | `RequestBuilder`, `CurlBuilder` | implements the steps, keeps the parts and returns its own product |
| Director | `describeCreateOrder(b)` | knows which steps to call, and in what order, for one kind of product |
| Product | the `Request` object, the `curl` command | the result; products of different builders need not share a type |

The client picks a concrete builder, lets the Director run the steps on it, and then asks that builder, not the Director, for the result, because only the concrete builder knows what type it produces. A new representation is a new builder, and the Director stays as it is.

**The fluent builder** that Joshua Bloch describes in *Effective Java* (Item 2) has no Director and a single product. It exists to replace long constructors: each method records one option and returns the builder, so the calls chain, and `build()` creates the object. Most builders in today's libraries are this kind, including Java's `HttpRequest.newBuilder()` and the ones Lombok's `@Builder` generates.

Both forms share the two habits that make the extra class worth having:

- **Validate once, in `build()`.** A step can reject a bad argument on its own (Java's `HttpRequest.Builder.timeout()` refuses a duration that isn't positive), but a rule that spans several parts can only be checked once all of them are known. `build()` is that single place. Java's `build()` throws `IllegalStateException` when no URI was set, and the builder in the diagram rejects a GET or HEAD with a body, which [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.1) gives no defined meaning and advises clients not to send.
- **Return an immutable result.** The object is complete when it is created, so it needs no setters. A Java `HttpRequest` can't be changed once built. In JavaScript, `Object.freeze` does the job at run time, but it is shallow, so nested objects such as the headers need freezing too; a write to a frozen property throws a `TypeError` in strict-mode code (every ES module and class body) and is silently ignored elsewhere. To change a built object, copy it into a new builder: Lombok has `@Builder(toBuilder = true)`, and Java 16 added `HttpRequest.newBuilder(request, filter)`.

**Required values: in the builder's constructor or checked in `build()`?** Bloch's builder takes the required parameters in its own constructor, so they can't be forgotten, and leaves only the options to the chained methods. Java's HTTP client offers both: `HttpRequest.newBuilder(uri)` takes the URI up front, while `newBuilder()` followed by `uri(…)` relies on the check in `build()`. A constructor argument catches the mistake at compile time but brings positional parameters back, so keep it to one or two values; a check in `build()` can enforce any rule but only fails at run time.

## Code

A `Builder` interface, two concrete builders and a Director, in TypeScript that runs as is with Node 22.18 or later, which strips the types itself (`node builder.ts`):

```ts
import assert from 'node:assert/strict';

// Builder: the construction steps. Each one returns the builder, so calls can chain.
interface Builder {
  url(url: string): this;
  method(method: string): this;
  header(name: string, value: string): this;
  json(data: unknown): this;
  timeout(ms: number): this;
}

// Product: an immutable HTTP request.
type Request = Readonly<{ url: string; method: string; headers: Readonly<Record<string, string>>;
  body: string | null; timeoutMs: number | null }>;

// ConcreteBuilder: collects the parts and checks the combination once, in build().
class RequestBuilder implements Builder {
  private parts = { url: '', method: 'GET', headers: {} as Record<string, string>,
    body: null as string | null, timeoutMs: null as number | null };
  url(url: string) { this.parts.url = url; return this; }
  method(method: string) { this.parts.method = method; return this; }
  header(name: string, value: string) { this.parts.headers[name] = value; return this; }
  json(data: unknown) {
    this.parts.body = JSON.stringify(data);
    return this.header('Content-Type', 'application/json');
  }
  timeout(ms: number) { this.parts.timeoutMs = ms; return this; }
  build(): Request {
    const { url, method, headers, body } = this.parts;
    if (!url) throw new Error('url is required');
    if (body !== null && (method === 'GET' || method === 'HEAD'))
      throw new Error(`${method} request cannot have a body`);
    // Object.freeze is shallow, so the headers object is frozen too.
    return Object.freeze({ ...this.parts, headers: Object.freeze({ ...headers }) });
  }
}

// Another ConcreteBuilder: the same steps produce a curl command line.
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`; // POSIX shell quoting
class CurlBuilder implements Builder {
  private target = ''; private verb = 'GET'; private flags: string[] = [];
  url(url: string) { this.target = url; return this; }
  method(method: string) { this.verb = method; return this; }
  header(name: string, value: string) {
    this.flags.push(`-H ${quote(`${name}: ${value}`)}`);
    return this;
  }
  json(data: unknown) {
    this.header('Content-Type', 'application/json');
    this.flags.push(`-d ${quote(JSON.stringify(data))}`);
    return this;
  }
  timeout(ms: number) { this.flags.push(`--max-time ${ms / 1000}`); return this; }
  build(): string { return ['curl -X', this.verb, this.target, ...this.flags].join(' '); }
}

// Director: the create-order recipe, written once against the Builder interface.
function describeCreateOrder(b: Builder): void {
  b.url('https://api.example.com/orders');
  b.method('POST');
  b.header('Authorization', 'Bearer t0k3n');
  b.json({ sku: 'MUG-1', qty: 2 });
  b.timeout(5000);
}

const requestBuilder = new RequestBuilder();
describeCreateOrder(requestBuilder);
const req = requestBuilder.build();
console.log(req.method, req.url, req.headers);
// POST https://api.example.com/orders { Authorization: 'Bearer t0k3n', 'Content-Type': 'application/json' }

const curlBuilder = new CurlBuilder();
describeCreateOrder(curlBuilder);
console.log(curlBuilder.build());
// curl -X POST https://api.example.com/orders -H 'Authorization: Bearer t0k3n' -H 'Content-Type: application/json' -d '{"sku":"MUG-1","qty":2}' --max-time 5

// A client can chain the steps itself, too. build() rejects a bad combination:
assert.throws(() => new RequestBuilder().url('https://api.example.com/orders')
  .method('GET').json({ sku: 'MUG-1', qty: 2 }).build(), /GET request cannot have a body/);
assert.throws(() => new RequestBuilder().method('POST').build(), /url is required/);
// @ts-expect-error: timeoutMs is readonly, and the object is frozen at run time too
assert.throws(() => { req.timeoutMs = 0; }, TypeError);
```

`build()` copies the parts before freezing them, so the builder can be reused without changing a request it has already returned. `CurlBuilder` puts `-X` before the URL whatever order the steps arrive in, because the layout of the command is the builder's business, not the Director's. It writes `-X POST` even though curl would infer POST from `-d`, so that every step leaves a mark in the output.

## When to use it

- A class has many optional parameters, several of the same type, or values that are easy to confuse at a call site.
- Some rules involve several fields at once and must hold before the object is used.
- You want immutable objects, but they are assembled in several steps or in several places.
- One recipe should produce several representations (the GoF form): the same document as HTML or Markdown, the same request as an object, a `curl` command or a log line.
- **Tests.** A test-data builder for each domain class, preset with valid defaults, lets every test state only the fields it cares about, as in `anOrder().withQty(0).build()`. Steve Freeman and Nat Pryce describe the technique in *Growing Object-Oriented Software, Guided by Tests*.
- **Not** when the language already has named arguments with defaults (Python, Kotlin, C#) or, in JavaScript and TypeScript, an options object, and you need neither staged construction nor several representations. An options object can validate, too: the [Fetch standard's `Request` constructor](https://fetch.spec.whatwg.org/#dom-request) takes one and throws a `TypeError` for a GET or HEAD with a body.

## Trade-offs

- **More code.** A builder repeats the product's fields and adds a class for each product. Lombok generates the class in Java, which saves the typing but not the indirection.
- **Mistakes surface at run time.** A forgotten required step is caught by `build()`, not by the compiler, unless the required values go into the builder's constructor or you write a staged builder whose types only offer `build()` once every required step has been called.
- **The builder itself is mutable.** It is meant for one caller building one object at a time. The methods of Java's `HttpRequest.Builder` aren't synchronized, so it must not be shared between threads without locking.
- **The Director is optional.** Without several representations, or a recipe worth reusing, it is one more layer, and the fluent form alone is enough.

## Implementation notes

- In TypeScript, declare the steps as returning `this`, so chaining keeps the concrete type through interfaces and subclasses.
- Keep the steps cheap: record the part and return. Do the work (validation, copying, freezing, formatting) in `build()`.
- When the products are unrelated, give each concrete builder its own `build()` with its own return type (`build(): Request`, `build(): string`) instead of declaring it on the Builder interface.
- **Closest relatives.** Factory Method lets a subclass decide *which class* to instantiate, and Abstract Factory creates whole families of related objects, each returned at once from a single call. Builder is about *assembling one* complex object over several calls and handing it over at the end. Builders often produce Composite trees (a document, a syntax tree, a UI layout), with steps that recurse. Prototype makes new objects by copying a configured instance; a `toBuilder`-style copy gives a builder a similar starting point.
- **At architecture scale,** [immutable infrastructure](../immutable-infrastructure/) applies the same discipline to servers: a pipeline assembles an image from a recipe (a Dockerfile or a Packer template), tests it once and runs it unchanged, and any change means a new build. There the builder is a pipeline, the check in `build()` is a test stage, and immutability comes from replacing servers rather than freezing objects.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Factory Method](../factory-method/) — Let subclasses decide which class to create: the base class codes against an interface and calls an overridable create method.
- [Abstract Factory](../abstract-factory/) — Create families of related objects through one interface, so swapping the whole family never touches client code.
- [Prototype](../prototype/) — Create new objects by copying a configured prototype instead of building them from scratch, and know when a copy must go deep.
- [Composite](../composite/) — Treat single objects and groups of objects through one interface, so a whole tree answers a question the way one leaf does.
- [Immutable Infrastructure](../immutable-infrastructure/) — Never patch servers in place: bake a new image and replace them.

## References

- [Gamma, Helm, Johnson and Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software (Addison-Wesley, 1994)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610)
- [Joshua Bloch — Effective Java, 3rd edition (Item 2: builders for classes with many constructor parameters)](https://www.informit.com/store/effective-java-9780134685991)
- [Java SE 25 API — HttpRequest.Builder](https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpRequest.Builder.html)
- [Project Lombok — @Builder](https://projectlombok.org/features/Builder)
- [MDN — Object.freeze()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze)
- [Steve Freeman and Nat Pryce — Growing Object-Oriented Software, Guided by Tests (chapter 22: test data builders)](https://www.informit.com/store/growing-object-oriented-software-guided-by-tests-9780321503626)
- [refactoring.guru — Builder](https://refactoring.guru/design-patterns/builder)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
