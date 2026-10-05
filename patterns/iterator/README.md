<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧩 Design Patterns (GoF)](../../README.md#design-patterns-gof)

# Iterator

> Walk a collection one element at a time without exposing how it is stored: an array, a tree or a stream that never ends.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Iterator" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/iterator.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · The loop knows the storage** | `exportCsv()`, `sendReceipts()` and `syncCrm()` each contain the same paging loop: start at page 1, call `orders.getPage(page)`, go through `res.orders`, stop when `hasMore` is false, otherwise `page++`. Every caller knows how the API splits its data, so when the API moves to cursor tokens, all three loops must change, and the next caller will copy the loop again. |
| **2 · An iterator hides it** | `OrdersApi.all()` is a factory method: every call returns a new iterator, the generator object that the async generator function `allOrders()` creates, and the caller writes only `for await (const order of orders.all())`. The paging loop now lives in one place, and the generator's local variables are the iterator's state: the cursor (`page`) and the buffer (what is left of the current page). Nothing has run yet: a generator's body starts on the first `next()`. |
| **3 · Lazy, one page at a time** | The first `next()` starts the generator, which fetches page 1; 1002 and 1003 then come out of its buffer without another request, and asking for the 4th order fetches page 2. After 1004 the preview breaks, `for await` calls the iterator's `return()`, and the generator stops, so page 3 is never requested: 2 requests instead of 3. |
| **4 · Same loop, any structure** | `for…of` asks each source for an iterator and calls `next()` until `done`: the array's built-in iterator, an in-order generator over a binary search tree (1001 to 1007, sorted), and an endless generator that `take(5)` stops after five values. JavaScript, Python, Java and C# all build the pattern into the language. The cost is one more object per walk, and a collection that changes during the walk needs a defined answer: Java's `ArrayList` iterator throws `ConcurrentModificationException`. |
<!-- END GENERATED: header -->

## The problem

An orders service exposes a paged API. `getPage(page)` returns three orders and a `hasMore` flag (real APIs return 50 or 100 per page; three keeps the numbers small), so orders 1001 to 1007 come back as pages of 3, 3 and 1.

The obvious way to read them all is a loop in the caller:

```ts
for (let page = 1; ; page++) {
  const res = await orders.getPage(page);
  for (const o of res.orders) csv.write(o);
  if (!res.hasMore) break;
}
```

It works, so it gets copied. The CSV export, the receipt mailer and the CRM sync each carry their own copy with a different line in the middle, and every copy knows how the API splits its data: pages are numbered from 1, and a flag says whether another one follows. When the API moves to cursor tokens, every copy has to change, and every copy is another chance to get the stopping condition wrong. A caller that needs only the first few orders has to add its own exit as well, or it fetches pages it never reads.

In-memory structures have the same problem on a smaller scale. Code that walks a tree by following `left` and `right` depends on how the tree is built, and a loop that indexes into an array can't be handed a linked list, a generator or a stream instead.

## How it works

An iterator hands you the elements of a collection one at a time without revealing how the collection stores them. The walk and its current position move out of the caller, and out of the collection, into an object of their own. The caller's loop then has the same shape whatever it walks, the collection can change how it stores its data without breaking callers, and several walks of one collection can be under way at once, each with its own position. Gamma, Helm, Johnson and Vlissides catalogued the pattern in *Design Patterns* (1994), which also gives it the name *Cursor*.

| Participant | In the diagram | Role |
|---|---|---|
| **Iterator** | `AsyncIterator<Order>` | The interface for walking: `next()` returns a promise of `{ value, done }`, and the optional `return()` ends a walk early. |
| **ConcreteIterator** | the generator object that `allOrders()` returns | Walks one kind of collection and keeps the walk's state: the cursor (`page`) and the buffer (what is left of the current page). |
| **Aggregate** | `OrderSource` | Declares the method that creates an iterator, `all()`. |
| **ConcreteAggregate** | `OrdersApi` | Implements `all()` by creating a new iterator over its own data. |
| **Client** | the order preview | Gets an iterator from the aggregate and uses only the Iterator interface. |

JavaScript builds both interfaces into the language ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols)). An object whose `next()` returns `{ value, done }` is an iterator, an object with a `[Symbol.iterator]()` method that returns one is an iterable (the language's Aggregate), and `for...of` drives the protocol for you. The asynchronous versions use `[Symbol.asyncIterator]()`, a `next()` that returns a promise, and `for await...of`. The method that creates the iterator is a [Factory Method](../factory-method/): each collection decides which iterator class to instantiate, as Java's `Collection.iterator()` and C#'s `GetEnumerator()` do. In the diagram, `all()` plays that part. Giving `OrdersApi` a `[Symbol.asyncIterator]()` method that returns `this.all()` would let callers write `for await (const order of orders)`.

**External and internal iterators.** With `for...of` the caller is in control: it pulls each element by calling `next()`, so it can stop when it likes, pause, or advance two iterators side by side, which is what comparing or merging two sorted sequences needs. An internal iterator turns this around: the collection runs the loop and calls your function for each element, as `array.forEach(fn)` and Java's [`Iterable.forEach(action)`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/lang/Iterable.html) do. Internal iterators are easier to write, because the collection can simply recurse through a tree, but harder to stop: MDN notes that [only throwing an exception](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/forEach) gets you out of `forEach`. Generators give you both. You write the walk with ordinary loops and recursion, as you would an internal iterator, and the caller gets an external iterator to pull from.

**Iterator state, and several iterators at once.** The position lives in the iterator, not in the collection, so every call to `orders.all()` starts an independent walk with its own cursor and buffer, and two loops over the same `OrdersApi` don't disturb each other. Most iterators run once, forwards: a finished generator stays finished, and Python's documentation calls an iterator broken if `__next__()` stops raising `StopIteration` after it has raised it once. To walk again, ask the aggregate for a new iterator. The book also uses the word *cursor* for an iterator that only records a position while the aggregate does the stepping; an API's cursor token is the same idea at the scale of a network call.

**Laziness and early exit.** An iterator produces each element only when it is asked for one. `allOrders()` requests a page only when its buffer is empty, so a preview that stops after four orders costs two requests. An endless generator is harmless as long as the consumer stops: with `function* ids(id = 1001) { while (true) yield id++; }`, the ES2025 iterator helper [`ids().take(5)`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Iterator/take) yields 1001 to 1005 and then closes the generator (`itertools.islice` does the same job in Python, `Take(5)` in LINQ). Stopping early has to release whatever the iterator holds:

- When the body of a `for...of` or `for await...of` loop leaves early, through `break`, `return` or an exception, the loop calls the iterator's `return()` method. On a generator, [`return()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Generator/return) runs any pending `finally` blocks, which is the place to close a connection or a file.
- Python calls `close()` on a generator that is finalized before it finishes, which runs its `finally` blocks too. For asynchronous generators that isn't guaranteed, so close them with `aclose()` or [`contextlib.aclosing()`](https://docs.python.org/3/library/contextlib.html#contextlib.aclosing) (Python 3.10).
- C#'s `foreach` disposes the enumerator when the loop ends, early or not, and that is when an iterator method releases the resources of its `using` statements ([Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/yield)).

**When the collection changes during a walk.** The book calls an iterator *robust* if insertions and removals don't upset a walk that is under way, and if it manages that without copying the collection. Libraries answer the question differently, and it pays to know which answer you have:

- Java's [`ArrayList`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/ArrayList.html) iterators are fail-fast: if the list is structurally modified other than through the iterator itself, the iterator throws `ConcurrentModificationException`, even when only one thread is involved. The documentation calls this best-effort and meant for finding bugs, not something to build on.
- Most [`java.util.concurrent`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/concurrent/package-summary.html) collections have weakly consistent iterators instead, which never throw that exception and may or may not show changes made after they were created. `CopyOnWriteArrayList` iterates over a snapshot taken when the iterator was created.
- C#'s `List<T>` [invalidates its enumerators](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.list-1.getenumerator) on any change, and the next `MoveNext()` throws `InvalidOperationException`.
- Python [may raise `RuntimeError` or skip entries](https://docs.python.org/3/library/stdtypes.html#dictionary-view-objects) if you add or remove dictionary entries while iterating over the dictionary.
- JavaScript's [array iterator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/values) reads the live array, including its current length, at every step. Elements pushed during a `for...of` are visited too, so a loop that pushes on every pass never reaches the end.

**Asynchronous iteration.** When the next element has to be waited for, `next()` returns a promise. `for await...of` consumes async iterables (and plain iterables too), and an `async function*` produces them, which is how `allOrders()` hides the page requests behind one loop. Node.js [readable streams](https://nodejs.org/api/stream.html#readablesymbolasynciterator) are async iterable, C# has `IAsyncEnumerable<T>` with `await foreach`, and Python has `async for` over objects with `__aiter__()` and `__anext__()`. Client libraries use this for list endpoints: in Stripe's Node.js library a `for await` loop over a list call [fetches the following pages for you](https://docs.stripe.com/api/pagination/auto), and boto3's [paginators](https://docs.aws.amazon.com/boto3/latest/guide/paginators.html) hand you the pages of an AWS list operation in a plain `for` loop.

**Generators are the built-in way to write iterators.** Written as a class, `allOrders()` would keep `page`, the current page and a position in it as fields, and its `next()` would have to work out each time where it had left off. A generator keeps the loop as it is: `yield` hands out one element and suspends the function, and the function's local variables are the iterator's state. The generator in the diagram is the callers' loop from step 1 with `yield* res.orders` where their work used to be. JavaScript has `function*` and `async function*`, Python has `yield`, and C# has `yield return` in methods that return `IEnumerable<T>`, `IEnumerator<T>` or `IAsyncEnumerable<T>`. Java has no generators: an iterator is a class with `hasNext()` and `next()`, although streams cover many of the same uses.

**Cursors versus offsets.** The page number in the diagram is an offset in disguise: page 2 means "skip the first three orders". If an order is added or deleted between two requests, every later page shifts, so the walk sees an order twice or misses one, and the database has to read and throw away every skipped row, which makes late pages slower. A cursor names a position instead of counting up to it. Stripe's list endpoints take [`starting_after`](https://docs.stripe.com/api/pagination), the ID of the last object you received, and return `has_more`; other APIs hand back an opaque next-page token. Markus Winand calls the database side of the idea [keyset pagination](https://use-the-index-luke.com/no-offset): filter on the last key you saw instead of using `OFFSET`. Because callers only ever call `orders.all()`, moving `allOrders()` from page numbers to cursors is a change to one function.

## Code

TypeScript that mirrors the diagram. Node 22.18 or later runs it as is (`node orders.ts`) by stripping the types without checking them; it also passes `tsc --strict` compiled as an ES module (`--module nodenext`, which the top-level `await` needs).

```ts
import assert from 'node:assert/strict';

type Order = { id: number };
type Page = { orders: Order[]; hasMore: boolean };

// Aggregate: anything that can create an iterator over its orders.
interface OrderSource {
  all(): AsyncGenerator<Order>;
}

// ConcreteAggregate: a fake paged API, 3 orders per page, that counts requests.
class OrdersApi implements OrderSource {
  fetches = 0;
  private readonly ids = [1001, 1002, 1003, 1004, 1005, 1006, 1007];

  async getPage(page: number): Promise<Page> {
    this.fetches++;
    const start = (page - 1) * 3;
    const orders = this.ids.slice(start, start + 3).map((id) => ({ id }));
    return { orders, hasMore: start + 3 < this.ids.length };
  }

  // The factory method: each call creates a new, independent iterator.
  all(): AsyncGenerator<Order> {
    return allOrders(this);
  }
}

// ConcreteIterator, written as an async generator. Its local variables are
// the iterator's state: page is the cursor, res.orders the buffer.
async function* allOrders(api: OrdersApi): AsyncGenerator<Order> {
  for (let page = 1; ; page++) {
    const res = await api.getPage(page); // only once the buffer is empty
    yield* res.orders;                   // one order per next()
    if (!res.hasMore) return;
  }
}

// Client: read every order...
const orders = new OrdersApi();
const ids: number[] = [];
for await (const order of orders.all()) ids.push(order.id);
assert.deepEqual(ids, [1001, 1002, 1003, 1004, 1005, 1006, 1007]);
assert.equal(orders.fetches, 3);
console.log(`all:     ${ids.join(' ')} (${orders.fetches} requests)`);

// ...or show the first 4: break calls return(), so page 3 is never fetched.
orders.fetches = 0;
const shown: number[] = [];
for await (const order of orders.all()) {
  shown.push(order.id);
  if (shown.length === 4) break;
}
assert.deepEqual(shown, [1001, 1002, 1003, 1004]);
assert.equal(orders.fetches, 2);
console.log(`preview: ${shown.join(' ')} (${orders.fetches} requests)`);
```

Output:

```
all:     1001 1002 1003 1004 1005 1006 1007 (3 requests)
preview: 1001 1002 1003 1004 (2 requests)
```

## When to use it

- A collection whose storage you want to hide, or keep free to change: a paged or streaming API, a tree, a database result set, a file read line by line.
- Data that is too big to load at once, arrives over time or never ends: handle it one element at a time and stop when you have enough.
- Several ways to walk one structure (in-order and level-order, forwards and backwards), or several walks under way at once.
- Generic code, such as copying, filtering, batching or paging, that should work on any collection.
- Prefer something else when the language's own collections and loops already do the job (use them), when you need random access, a length or several passes (load the data into an array), or when what happens to each element depends on its type more than on the order of the walk ([Visitor](../visitor/)).

## Trade-offs

- **One pass, forwards.** Most iterators can't rewind, report a length or be shared, and a used-up iterator stays empty. Collect the elements into an array when you need any of those.
- **The work moves into the loop.** Calling `orders.all()` does nothing yet: the requests happen while the loop runs. A failure on page 2 surfaces in the middle of a loop that has already handled page 1, and a loop that looks as if it walks a local list may be making network calls.
- **Lifetime.** An iterator that holds a connection or a file handle has to be finished or closed (`return()`, `close()`, `Dispose()`). One that is dropped half-way relies on cleanup that some runtimes do late or not at all.
- **Changes during a walk** need a defined answer: fail fast, walk a snapshot, or be weakly consistent.
- **Overhead.** One more object per walk and an indirect call per element; over a plain array in a hot loop, an index is faster. A recursive generator passes every element up through each enclosing `yield*`, so elements deep in a tall tree cost more to deliver.
- **In return,** callers depend on one small interface, the storage can change behind it, stopping early is cheap, and memory stays bounded by one page.

## Implementation notes

- **Write it as a generator.** Start from the loop you would have written in the caller and put `yield` where the caller's work was. The generator's local variables are the cursor and the buffer, and `try`/`finally` is where cleanup goes.
- **Make the aggregate iterable.** `[Symbol.asyncIterator]() { return this.all(); }` on `OrdersApi` lets callers write `for await (const order of orders)`. Keep named methods for the other walks (`all({ status: 'open' })`, `newestFirst()`), because a class has only one default iterator.
- **Prefetch on purpose.** A paging iterator can request page n + 1 while the caller works through page n, trading a request that may be wasted for less waiting. Make it an option, because it gives up the two-instead-of-three saving.
- **Trees.** A recursive generator is the natural way to walk a composite structure: `yield* left; yield key; yield* right` is the in-order walk of a [binary search tree](../binary-search-tree/) in step 4. For very deep trees, keep an explicit stack instead. The Python version on that page does, because a recursive generator runs into Python's recursion limit on a long chain.
- **Helpers compose lazily.** The ES2025 iterator helpers (`map`, `filter`, `take`, `drop`, `flatMap` and others) and Python's `itertools` return new iterators, so `ids().filter((id) => id % 2 === 0).take(5)` reads ten IDs to find five even ones and never asks for the eleventh.
- **Relatives.**
  - [Composite](../composite/): the tree that an iterator often walks. Composite defines the structure; Iterator defines an order in which to visit it.
  - [Visitor](../visitor/): one operation per element type, often applied while an iterator walks the structure. The iterator decides the order, and the visitor decides what happens to each element.
  - [Factory Method](../factory-method/): the aggregate's `all()`, `[Symbol.iterator]()` or `iterator()` creates the iterator, and each collection class picks its own.
  - [Memento](../memento/): an iterator's position, captured so that a walk can resume later. An API's opaque cursor token works like one: the client hands it back without looking inside.
- **At architecture scale.** In [Publish-Subscribe](../publish-subscribe/) over a log, each subscriber keeps a cursor, an offset into the log that it advances and commits, so many readers walk the same log independently and resume after a restart. At that scale the iterator's position has to be stored outside the process, and the collection keeps growing while it is read. [Change Data Capture](../change-data-capture/) consumers work the same way, each with its own offset. A chain of lazy iterators (`filter`, `map`, `take`) is a pull pipeline inside one process, and [Pipes and Filters](../pipes-and-filters/) is the same shape when the filters are separate components connected by queues.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Composite](../composite/) — Treat single objects and groups of objects through one interface, so a whole tree answers a question the way one leaf does.
- [Visitor](../visitor/) — Add new operations to a stable set of classes without editing them: each operation is a visitor that every element accepts.
- [Factory Method](../factory-method/) — Let subclasses decide which class to create: the base class codes against an interface and calls an overridable create method.
- [Memento](../memento/) — Capture an object's state in a snapshot only it can read, so it can be restored later without breaking encapsulation.
- [Binary Search Tree](../binary-search-tree/) — Smaller keys left, larger right: O(log n) search and insert while the tree stays balanced, O(n) once it degrades into a list.
- [Publish-Subscribe](../publish-subscribe/) — Broadcast each message to every interested subscriber through a topic.
- [Pipes and Filters](../pipes-and-filters/) — Split processing into independent stages connected by channels.

## References

- [Gamma, Helm, Johnson and Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software (1994)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610)
- [MDN — Iteration protocols](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols)
- [MDN — function* (generator functions)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/function*)
- [MDN — for await...of](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of)
- [Python documentation — Built-in Types: iterator and generator types](https://docs.python.org/3/library/stdtypes.html#iterator-types)
- [Java SE 27 API — java.util.Iterator](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/Iterator.html)
- [Java SE 27 API — ConcurrentModificationException](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/ConcurrentModificationException.html)
- [Microsoft Learn — Iterators (C#)](https://learn.microsoft.com/en-us/dotnet/csharp/iterators)
- [Stripe API reference — Auto-pagination](https://docs.stripe.com/api/pagination/auto)
- [Stripe API reference — Pagination (cursor-based, starting_after)](https://docs.stripe.com/api/pagination)
- [Markus Winand — We need tool support for keyset pagination](https://use-the-index-luke.com/no-offset)
- [Refactoring.Guru — Iterator](https://refactoring.guru/design-patterns/iterator)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
