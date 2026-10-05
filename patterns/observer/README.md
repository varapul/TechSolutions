<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧩 Design Patterns (GoF)](../../README.md#design-patterns-gof)

# Observer

> A subject notifies its subscribed observers of every change, so one change updates many dependents it never names.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Observer" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/observer.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · The cart calls every view** | Without the pattern the model updates the screen itself. `Cart` keeps a `CartBadge`, a `TotalLabel` and a `FreeShippingBanner`, and `add()` calls `render()` on the first two and `update()` on the third. `Cart` now depends on every view class and on each one's own method, so adding a mini-cart drawer means editing and retesting `Cart` again. |
| **2 · Subscribe and notify** | `Cart` extends `Subject`, which keeps a list of `Observer`s, and each view implements the one-method `Observer` interface and subscribes itself. After every change `Cart` calls `update(cart)` on whatever is on the list, without naming a single view class. A fourth view would just subscribe, and `Cart` would not change. |
| **3 · One change, many updates** | After `add(Mug, 12)`, `notify()` calls `update(cart)` on each observer in turn: the badge shows 1, the label EUR 12.00 and the banner EUR 38.00 to free shipping. After `add(Lamp, 45)` they show 2, EUR 57.00 and free shipping. This is the **pull** model: the cart passes itself and each view reads `count` or `total`; in the **push** model the cart would send the data, as in `update({ count, total })`. |
| **4 · Pitfalls, and at scale** | The shopper closes the banner, but the cart's list still holds it: a **lapsed listener** stays in memory and keeps being updated until it calls the `unsubscribe` function that `subscribe()` returned. Don't rely on the order of notifications, don't change the subject from inside `update()` (that notifies again and can loop), and remember that with synchronous notification a slow or failing observer holds up the rest. The same idea is behind DOM events (`addEventListener`), RxJS observables and Java's `java.util.Observable` (deprecated since Java 9), and at system scale behind [publish-subscribe](../publish-subscribe/) through a broker, [event-driven architecture](../event-driven-architecture/) and [webhooks](../webhooks/). |
<!-- END GENERATED: header -->

## The problem

A shop page shows the cart in three places: a badge with the number of items, a label with the total, and a banner that counts down to free shipping at EUR 50. The quickest version lets the cart keep them up to date itself. `Cart` holds a reference to each view, and `add()` ends with `badge.render(count)`, `label.render(total)` and `banner.update(total)` (step 1).

It works, and it ties the wrong things together. The cart is business state, yet it now imports three UI classes and knows which method each of them happens to expose. It can't be tested without them or used on a page that lacks one of them, and every new reaction to a change in the cart (a mini-cart drawer, an analytics event) means opening `Cart` and adding another line. The views depending on the cart's data is fine. The cart depending on its views is the problem.

## How it works

Observer turns that dependency around. Objects that care about another object's state register with it, and that object tells every registered one whenever its state changes, knowing nothing about them except that they have an update method (Gamma, Helm, Johnson and Vlissides, 1994). The participants, in the diagram's terms:

- **Subject** (`Subject`) keeps the list of observers, lets them subscribe and unsubscribe, and tells them all about a change with `notify()`.
- **Observer** (`Observer<S>`) is the one-method interface the subject calls: `update(subject)`.
- **ConcreteSubject** (`Cart`) owns the state (the items, their count and their total) and calls `notify()` after each change.
- **ConcreteObserver** (`CartBadge`, `TotalLabel`, `FreeShippingBanner`) implements `update()` by reading what it needs from the subject and refreshing its own display.

The views subscribe once (step 2). From then on the page calls `cart.add()`, the cart changes its state and calls `notify()`, and `notify()` calls `update(cart)` on each observer in turn (step 3). Nothing in `Cart` names a view class, so a fourth view is a new class that subscribes, and `Cart` is not edited.

### Push or pull

How much a notification carries is a design decision.

- **Pull.** The notification carries the subject, or nothing at all, and each observer asks for what it needs: `update(cart)`, then `cart.count`. The diagram and the code below work this way. The subject's interface stays the same whatever the observers need, but an observer can't tell what changed without comparing, and it makes extra calls to find out.
- **Push.** The subject sends the change itself: `update({ count, total })`, or an event object that says what happened. Observers get the data without calling back, but now the subject decides what every observer receives, so the payload grows to suit the most demanding one and becomes a contract to maintain.

Most event APIs mix the two. A DOM `Event` pushes its `type` (and a `CustomEvent` a `detail` payload), and hands listeners the `target` to read anything else from.

### Observer and its relatives

- **Observer** works inside one process. The subject holds direct references to its observers and calls them itself, usually synchronously. Nothing is stored: an observer that subscribes after a change never hears about it, and the subject and its observers live and fail together.
- **[Publish-subscribe](../publish-subscribe/)** puts a broker between the two sides. Publishers send to a named topic and know nothing about the subscribers, a durable subscription keeps messages while its subscriber is away, and delivery is usually at least once, so subscribers have to cope with duplicates. That decoupling in space and time is what lets an [event-driven architecture](../event-driven-architecture/) connect services that are deployed, scaled and restarted independently. The two names are sometimes used for the same thing; in this catalog *publish-subscribe* means the broker-based pattern.
- **[Webhooks](../webhooks/)** are Observer between organisations, over HTTP: subscribing means registering a URL, and notifying means sending an HTTP `POST` to it. Because that call crosses the internet, the provider signs and retries every delivery, and the receiver verifies the signature, answers quickly and drops duplicates.
- **Chain of Responsibility** also hands a request to receivers the sender doesn't know, but passes it along a line of handlers until one of them takes it. Observer gives every notification to every subscriber.
- **Mediator** solves a different problem. Observer lets one object broadcast to any number of objects it doesn't know. Mediator puts one object in the middle of a group whose members would otherwise all talk to each other, and lets it coordinate them. The two combine well: a common way to build a mediator is to have the members subscribe to events that the mediator publishes.

### Reactive streams and signals

- **ReactiveX** (RxJS, RxJava, Rx.NET) generalises the observer into a stream. An *Observable* delivers a sequence of values through three callbacks, one for each value, one for an error and one for the end of the sequence, and operators filter, map and combine streams much as array methods transform lists. `subscribe()` returns a *Subscription* whose `unsubscribe()` releases it. An RxJS `Subject` is the closest thing to the GoF subject: it keeps a registry of observers and multicasts every value to all of them.
- **.NET** builds the same shape in: `IObservable<T>.Subscribe(observer)` returns an `IDisposable` that ends the subscription, and `IObserver<T>` has `OnNext`, `OnError` and `OnCompleted`. Microsoft's guide states that the order in which observers are notified isn't defined, and suggests ordinary .NET events for simple notifications inside one application.
- **Signals** in UI frameworks make subscribing automatic. In Angular and in SolidJS, reading a signal inside a reactive context (an Angular template, computed signal or effect; a Solid effect or memo) records the reader as a dependent, and a change to the signal notifies exactly those dependents (in Solid, the computations that read it rather than whole components). It is Observer with the subscribe and unsubscribe calls written by the framework.

### java.util.Observable

Java has shipped `Observer` and `Observable` in `java.util` since 1.0. Both were deprecated in Java 9 and are still present, not marked for removal, in Java SE 27. The deprecation note gives three reasons: the event model the two support is too limited, the order in which observers are notified is unspecified, and a notification doesn't necessarily stand for exactly one state change. For each need it points elsewhere: `java.beans` for a richer event model, the concurrent data structures in `java.util.concurrent` for reliable, ordered messages between threads, and `java.util.concurrent.Flow` for reactive streams. The design had other costs. `Observable` is a class, so a subject has to extend it, and `setChanged()` is protected, so code that merely holds an `Observable` can't make it notify anyone.

## Code

TypeScript that mirrors the diagram. Node 22.18 or later runs it as is (`node cart.ts`) by stripping the types; it doesn't check them, which is what `tsc --noEmit --strict` is for. `Subject` uses TypeScript's polymorphic `this` type, so `Cart` inherits `subscribe(observer: Observer<Cart>)` without a type parameter of its own. Each view subscribes itself in its constructor, and the banner keeps the unsubscribe function that `subscribe()` returns as its `close()`.

```ts
// Observer: the one method a subject calls. S is the type of the subject.
interface Observer<S> {
  update(subject: S): void;
}

// Subject: keeps the list of observers and tells each of them about a change.
class Subject {
  #observers: Observer<this>[] = [];

  subscribe(observer: Observer<this>): () => void {
    this.#observers.push(observer);
    return () => { this.#observers = this.#observers.filter((o) => o !== observer); };
  }

  protected notify(): void {
    for (const o of [...this.#observers]) o.update(this); // a copy, in case the list changes mid-loop
  }
}

type Item = { name: string; price: number };

// ConcreteSubject: changes its state, then notifies. It never names a view class.
class Cart extends Subject {
  items: Item[] = [];
  get count(): number { return this.items.length; }
  get total(): number { return this.items.reduce((sum, item) => sum + item.price, 0); }

  add(name: string, price: number): void {
    this.items.push({ name, price });
    this.notify(); // pull model: each observer gets the cart and reads what it needs
  }

  remove(name: string): void {
    this.items = this.items.filter((item) => item.name !== name);
    this.notify();
  }
}

// ConcreteObservers: each subscribes itself and keeps the text it would render.
class CartBadge implements Observer<Cart> {
  text = '0';
  constructor(cart: Cart) { cart.subscribe(this); }
  update(cart: Cart): void { this.text = String(cart.count); }
}

class TotalLabel implements Observer<Cart> {
  text = 'EUR 0.00';
  constructor(cart: Cart) { cart.subscribe(this); }
  update(cart: Cart): void { this.text = `EUR ${cart.total.toFixed(2)}`; }
}

class FreeShippingBanner implements Observer<Cart> {
  text = 'EUR 50.00 to free shipping';
  readonly close: () => void; // the unsubscribe function: closing the banner calls it
  constructor(cart: Cart) { this.close = cart.subscribe(this); }
  update(cart: Cart): void {
    const left = 50 - cart.total;
    this.text = left > 0 ? `EUR ${left.toFixed(2)} to free shipping` : 'Free shipping';
  }
}

const cart = new Cart();
const badge = new CartBadge(cart);
const label = new TotalLabel(cart);
const banner = new FreeShippingBanner(cart);
const show = () => console.log(`${badge.text} | ${label.text} | ${banner.text}`);

cart.add('Mug', 12);  show(); // 1 | EUR 12.00 | EUR 38.00 to free shipping
cart.add('Lamp', 45); show(); // 2 | EUR 57.00 | Free shipping

banner.close();               // the shopper closes the banner, and it unsubscribes
cart.remove('Lamp');  show(); // 1 | EUR 12.00 | Free shipping   (the banner no longer hears the cart)
```

Output:

```
1 | EUR 12.00 | EUR 38.00 to free shipping
2 | EUR 57.00 | Free shipping
1 | EUR 12.00 | Free shipping
```

The loop in `notify()` is deliberately plain. It runs every `update()` synchronously, in subscription order, and an exception from one observer stops the rest; *Implementation notes* covers when to do otherwise.

## When to use it

- Several objects have to reflect or react to one object's state, and which ones varies: by page, by feature flag, by plugin, at runtime.
- The core should not know who reacts to it: a model and its views, a domain object and the logging, metrics or caching around it.
- The notification stays inside one process, and the subject needs nothing back.

Choose something else when:

- **There is one dependent and it won't change.** A direct call is easier to read and to debug.
- **The subject needs results or a fixed sequence.** Checking stock, then charging the card, then booking the shipment is a workflow: call the steps explicitly or orchestrate them.
- **The notification has to cross a process or survive a crash.** Use [publish-subscribe](../publish-subscribe/) through a broker, or [webhooks](../webhooks/) between organisations.

## Trade-offs

- **Loose coupling, hidden flow.** Nothing in `Cart` says what happens after `add()`. To find out you need to know who subscribed, which may only be decided at runtime, and a stack trace only shows that `notify()` called `update()`.
- **Every observer hears every change.** The banner is told about changes that can't affect it, and with many observers or frequent changes the notifications become the cost. Finer-grained subjects, notifying only when a value really changes, and batching several changes into one notification all help.
- **Lifetime is your job.** Each subscription is a reference from a long-lived subject to an observer that may be short-lived (step 4, and below).
- **The pattern leaves order, re-entrancy, errors and threading open.** Each needs a decision, written down where the subject is defined.

## Implementation notes

### Subscription lifetime

Return a way to unsubscribe from `subscribe()`. The code returns a function; RxJS returns a `Subscription`, .NET an `IDisposable`, and the DOM's `addEventListener()` accepts an `AbortSignal` in its `signal` option and removes the listener when the signal is aborted. Call it when the observer goes away, as the banner's `close()` does in the code, or when a component unmounts or a dialog closes.

Skipping that causes the *lapsed listener* leak of step 4. The subject's list holds strong references, so a closed view that is still on it stays in memory for as long as the subject does and keeps doing work on every change. Microsoft's WPF documentation describes the mechanism: attaching a handler gives the event source a strong reference to the listener, so unless the handler is removed, the listener lives as long as the source. Node's `EventEmitter` prints a warning by default when more than 10 listeners are added for one event, because a listener count that keeps growing is the usual symptom.

Weak references look like the cure: the subject could hold its observers through `WeakRef` in JavaScript, a `WeakReference` in Java, or WPF's weak event pattern. They are rarely the answer. Garbage is collected when the runtime decides, so a closed view keeps receiving updates until then; MDN advises avoiding `WeakRef` where possible because that timing can't be predicted. And an observer that nothing else references, such as an inline callback, can be collected while it is still wanted, and its updates silently stop. WPF uses weak events where a listener can't know when to unregister, as in data binding. In application code, tie the unsubscribe call to the observer's lifecycle instead.

### Order, re-entrancy and cascades

- **Don't depend on the order.** The pattern doesn't define one. The DOM and Node's `EventEmitter` call listeners in the order they were added. `java.util.Observable` documents the order as unspecified, and its default implementation notifies the most recently added observer first, although the same documentation describes registration order. Microsoft's .NET guide says the order isn't defined. If one observer must run after another, that is a dependency to model: let the second observe the first, or compute the derived value in the subject.
- **Don't change the subject from `update()`.** That starts a nested `notify()` before the outer one has finished: observers later in the list see the second change before the first, and a change that always provokes another one loops until the stack overflows. If an observer must answer with a change, queue it to run after the notification, and have the subject notify only when a value actually changes.
- **Watch for cascades.** When observers are subjects too (a computed total that the banner observes), one change ripples through several layers, and an observer that depends on the same source along two paths can run twice, or see one path updated and the other not yet. Batch changes and notify once; reactive libraries and signals exist partly to schedule such graphs for you.
- **Notify once the state is consistent**, after the whole change rather than halfway through it. And loop over a copy of the list, as `notify()` does in the code, so that an observer subscribing or unsubscribing during a notification can't make the loop skip or add anyone. The DOM does the same: it copies the listener list before invoking it, so a listener added during a dispatch doesn't run for that event at that target.

### Errors

In a plain loop like the one in the code, an exception thrown by one observer skips every observer after it and lands in the subject's caller: `cart.add()` throws although the item has been added. Node's `EventEmitter.emit()` behaves the same way. The DOM does not: it reports a listener's exception and carries on with the next listener. If the observers are independent, catch around each `update()` call and report the error, so that one broken view can't take the others down with it.

### Synchronous or asynchronous

The classic pattern is synchronous: every `update()` runs inside `notify()`, before `add()` returns. That keeps it simple, ordered and consistent, and each observer reads the state that triggered it. The price is latency: every observer adds to the caller's time, so one slow observer holds up the observers after it and the caller with them. Node documents the same model for `EventEmitter` (listeners run synchronously, in registration order) and suggests that a listener switch to asynchronous work with `setImmediate()` or `process.nextTick()` where that is appropriate. Notifying asynchronously, through a queue or a task per observer, frees the caller, but ordering and error handling move into the scheduler, and with the pull model an observer may read a state that has already moved on. Push a snapshot of each change if every change matters.

### What modern languages give you

First-class functions remove most of the ceremony. An observer can simply be a callback (`subscribe(fn)` instead of `subscribe(observer)`), with no interface or class, and the unsubscribe function the subject returns is a closure. Platforms ship the mechanism too: in browsers and in Node, where `EventTarget` is a global, a class can extend `EventTarget` and dispatch its own events; Node also has `EventEmitter`; .NET has events and `IObservable<T>`; and Java has `PropertyChangeSupport` in `java.beans`. Reach for RxJS or a signals library when notifications turn into streams or derived state.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Publish-Subscribe](../publish-subscribe/) — Broadcast each message to every interested subscriber through a topic.
- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.
- [Webhooks](../webhooks/) — Notify subscribers by calling their HTTP endpoints, with signatures, retries and idempotency.
- Mediator *(planned)* — Route the interactions between objects through one mediator, so many-to-many dependencies become one-to-many.
- [Command](../command/) — Turn a request into an object that can be queued, logged, undone and redone, decoupling who asks from who acts.
- State *(planned)* — Let an object change its behaviour when its state changes by delegating to state objects instead of growing switch statements.

## References

- [Gamma, Helm, Johnson and Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software (Addison-Wesley, 1994)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610)
- [MDN — EventTarget: addEventListener() method](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener)
- [Java SE 27 API — java.util.Observable (deprecated since Java 9)](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/Observable.html)
- [Microsoft Learn — Observer design pattern (.NET)](https://learn.microsoft.com/en-us/dotnet/standard/events/observer-design-pattern)
- [Microsoft Learn — Weak event patterns (WPF)](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/events/weak-event-patterns)
- [ReactiveX — Observable](https://reactivex.io/documentation/observable.html)
- [RxJS — Subscription](https://rxjs.dev/guide/subscription)
- [Node.js documentation — Events](https://nodejs.org/api/events.html)
- [Refactoring.Guru — Observer](https://refactoring.guru/design-patterns/observer)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
