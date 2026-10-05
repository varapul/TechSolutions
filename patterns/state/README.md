<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧩 Design Patterns (GoF)](../../README.md#design-patterns-gof)

# State

> Let an object change its behaviour when its state changes by delegating to state objects instead of growing switch statements.

<p align="center"><img src="diagram.svg" alt="Animated diagram: State" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/state.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · A switch in every method** | `Order` keeps a `status` field, and `pay()`, `ship()` and `cancel()` each `switch` on it: four cases per method, 12 branches in all, and the rules for one status, such as *Shipped*, are spread over three methods. A fraud review, **OnHold**, needs a new case in all three switches; miss one, as `cancel()` does here, and cancelling an order on hold silently does nothing. |
| **2 · One class per state** | Each status becomes a class that implements **OrderState** (the *State*), so the same 12 behaviours are now grouped by state instead of by method. `Order` (the *Context*) holds its current state object and hands every call to it, and each *ConcreteState* decides what the call means: it returns the next state, which `Order` switches to, or refuses with a reason. Each `→` cell is one arrow of the state diagram. |
| **3 · The state decides** | The client calls `order.pay()`: `Order` passes it to **Pending**, which returns **Paid**, and the reference moves; `ship()` then takes the order to **Shipped**. The same `cancel()` that would cancel a pending or paid order is refused in Shipped (too late, start a return), so the state stays as it is and the client gets the error. The log records all three calls. |
| **4 · A new state, one class** | **OnHold**, a fraud review between Pending and Paid, is one new class (`pay()` goes on to Paid once the review has cleared, `ship()` is refused, `cancel()` cancels), and the only edit is one line in **Pending**, whose `pay()` now returns OnHold. Unlike [Strategy](../strategy/), which the client picks, states replace one another, and a state with no fields can be one shared instance. Large machines are often written as tables or statecharts, and at system scale a [circuit breaker](../circuit-breaker/) and a [saga orchestrator](../saga-orchestration/) are state machines too. |
<!-- END GENERATED: header -->

## The problem

An online order goes through a short lifecycle: it waits for payment, it is paid, it is shipped, and it can be cancelled on the way. What `pay()`, `ship()` and `cancel()` should do depends on where the order is. Paying twice must be refused, shipping needs a payment first, and once the parcel has left, cancelling is no longer possible: the customer has to send it back.

The first version keeps the stage in a `status` field, and every method branches on it with a `switch`. Four statuses and three methods make 12 branches, and the rules for any one status are spread over all three methods, so to learn what a shipped order allows you read all of them. Nothing lists which status may follow which: the transitions hide in the assignments to `status` inside the branches.

The next status is where it hurts. A fraud review that holds each payment between Pending and Paid needs a new case in every switch on `status`: three here, and in a real codebase also in the views, the e-mails and the reports. A forgotten case usually still compiles. If `cancel()` has no case for `'onHold'`, cancelling an order under review falls through the switch and does nothing, and nobody hears about it.

## How it works

State moves the behaviour that depends on an object's state into one class per state. The object itself, the *context*, keeps a reference to the object for its current state and passes every state-dependent call to it. Replacing that reference changes what the next call does, so from the outside the order seems to change its class as it moves from Pending to Paid. The pattern is one of the behavioural patterns in *Design Patterns* by Gamma, Helm, Johnson and Vlissides (1994), where it is also called *Objects for States*.

| Participant | In the diagram | Role |
|---|---|---|
| **Context** | `Order` | The class clients use. It holds the current state object, passes each state-dependent call to it and moves to the state the call returns. Clients never see the state objects. |
| **State** | `OrderState` | The interface: one method for each call whose meaning depends on the state, here `pay`, `ship` and `cancel`. |
| **ConcreteState** | `Pending`, `Paid`, `Shipped`, `Cancelled`, later `OnHold` | What each call means in one state: do the work and name the next state, or refuse. |

The 12 decisions from step 1 don't go away. They move from three switches, grouped by method, into four classes, grouped by state, which is why the diagram keeps the same 12 cells and only regroups them. One class now answers what a shipped order can do, each `→` cell is an arrow in the state diagram, and a new state is a new class plus the transitions that lead into it.

**Who changes the state** is the main decision the pattern leaves open:

- **The states**, as here: each state names its successor, so `Pending.pay()` returns the `Paid` state. A state's rules stay together, and a new state touches only the states that lead to it, but the states now depend on one another (`Pending` knows `Paid` and `Cancelled`). A state can switch the context itself, through a method such as `order.setState(next)`, or return the next state and let the context assign it, as the code below does. Returning it keeps a setter that clients shouldn't call out of `Order`'s interface, and gives `Order` one place to log, check and save every transition.
- **The context**: `Order` looks the next state up in a table of (state, call) pairs, and the states only do the work. The states stay independent of each other and all the transitions can be read in one place, but every new state means editing that table as well. It suits a small, fixed set of transitions.

## Code

TypeScript that mirrors the diagram. Node 22.18 or later runs it as is (`node order.ts`) by stripping the types; `tsc --noEmit --strict` type-checks it. Each state method returns the next state or throws `Refused` with a reason, and `Order.handle()` is the one place that switches, logs, and passes a refusal on to the caller. The states have no fields, so one shared instance of each is enough.

```ts
import assert from 'node:assert/strict';

// State: what pay(), ship() and cancel() mean in one state. Each call
// returns the order's next state, or throws Refused with the reason.
interface OrderState {
  readonly name: string;
  pay(order: Order): OrderState;
  ship(order: Order): OrderState;
  cancel(order: Order): OrderState;
}
class Refused extends Error {}
const refuse = (reason: string): never => { throw new Refused(reason); };

// ConcreteStates: one class per state. They keep no fields, so one shared
// instance of each (created below the classes) serves every order.
class Pending implements OrderState {
  readonly name = 'Pending';
  pay(): OrderState { return PAID; }
  ship(): OrderState { return refuse('pay first'); }
  cancel(): OrderState { return CANCELLED; }
}
class Paid implements OrderState {
  readonly name = 'Paid';
  pay(): OrderState { return refuse('already paid'); }
  ship(): OrderState { return SHIPPED; }
  cancel(order: Order): OrderState { order.refund(); return CANCELLED; }
}
class Shipped implements OrderState {
  readonly name = 'Shipped';
  pay(): OrderState { return refuse('already paid'); }
  ship(): OrderState { return refuse('already shipped'); }
  cancel(): OrderState { return refuse('too late, start a return'); }
}
class Cancelled implements OrderState {
  readonly name = 'Cancelled';
  pay(): OrderState { return refuse('order is cancelled'); }
  ship(): OrderState { return refuse('order is cancelled'); }
  cancel(): OrderState { return refuse('order is cancelled'); }
}
const PENDING = new Pending(), PAID = new Paid(), SHIPPED = new Shipped(), CANCELLED = new Cancelled();

// Context: clients call Order, and Order hands each call to its current state.
class Order {
  private state: OrderState = PENDING;
  readonly log: string[] = [];
  get status(): string { return this.state.name; }
  pay(): void { this.handle('pay', (s) => s.pay(this)); }
  ship(): void { this.handle('ship', (s) => s.ship(this)); }
  cancel(): void { this.handle('cancel', (s) => s.cancel(this)); }
  refund(): void { this.log.push('refund issued'); }

  private handle(call: string, run: (state: OrderState) => OrderState): void {
    const from = this.state.name;
    try { this.state = run(this.state); } catch (err) {
      if (err instanceof Refused) this.log.push(`${call}(): refused in ${from}: ${err.message}`);
      throw err; // never swallowed: the caller hears about every refusal
    }
    this.log.push(`${call}(): ${from} → ${this.state.name}`);
  }
}

// Step 3 of the diagram: three calls on one order, three different outcomes.
const refusedWith = (reason: string) => (err: unknown) => err instanceof Refused && err.message === reason;
const order = new Order();
order.pay();
order.ship();
assert.throws(() => order.cancel(), refusedWith('too late, start a return'));
assert.equal(order.status, 'Shipped'); // a refused call leaves the state alone
console.log(order.log.join('\n'));

// Every other refusal, reached through Order's public methods only.
type Call = 'pay' | 'ship' | 'cancel';
const after = (...calls: Call[]): Order => { const o = new Order(); calls.forEach((c) => o[c]()); return o; };
assert.throws(() => after().ship(), refusedWith('pay first'));
assert.throws(() => after('pay').pay(), refusedWith('already paid'));
assert.throws(() => after('pay', 'ship').pay(), refusedWith('already paid'));
assert.throws(() => after('pay', 'ship').ship(), refusedWith('already shipped'));
for (const call of ['pay', 'ship', 'cancel'] as const) {
  assert.throws(() => after('cancel')[call](), refusedWith('order is cancelled'));
}
// Cancelling a paid order refunds it; a pending one has nothing to refund.
assert.deepEqual(after('pay', 'cancel').log, ['pay(): Pending → Paid', 'refund issued', 'cancel(): Paid → Cancelled']);
assert.deepEqual(after('cancel').log, ['cancel(): Pending → Cancelled']);
```

Output:

```
pay(): Pending → Paid
ship(): Paid → Shipped
cancel(): refused in Shipped: too late, start a return
```

Step 4 of the diagram adds one class, `OnHold`: its `pay()` asks the fraud review whether the order has cleared and returns `PAID` if so (and refuses until then), its `ship()` refuses, and its `cancel()` returns `CANCELLED`. The only existing line that changes is the body of `Pending.pay()`, which now returns the `OnHold` instance. `Order`, `Paid`, `Shipped` and `Cancelled` stay as they are.

## When to use it

- An object whose state decides what several of its operations do, with `switch` or `if` chains on the same status field in more than one method.
- A lifecycle with rules about what may come next: orders, payments, documents in review, support tickets, subscriptions, network connections, a multi-step form. The pattern makes the calls each state allows explicit, and refusing the others a deliberate act.
- States that are added over time, or behaviour per state big enough to be read and tested on its own.
- Not for two or three states with a line of behaviour each: a field and a small switch that the compiler checks are clearer (see *When a switch is enough* below).
- Not when only the transitions matter and the states do almost nothing: a transition table is shorter.
- Not when the variant is picked from outside and doesn't change by itself: that is [Strategy](../strategy/).

## Trade-offs

- **The scatter moves.** Everything about one state now sits in one class, but everything about one call is spread over all of them: to see what `cancel()` does in every state, you open five classes. The table in the diagram shows both views at once.
- **New states are cheap, new calls are not.** OnHold is one class. A new call, such as a reviewer's `approve()`, adds a method to `OrderState` and so to every state class. A base class that refuses every call by default keeps that change small, but then the compiler no longer makes each state decide: a state that should accept the new call and forgets to override it refuses it.
- **States know each other.** When states pick their successors, they depend on one another, and the whole machine is visible only by reading every class. Keep the state diagram next to the code, or describe the machine as data (see below).
- **More moving parts.** A call goes from the context to a state object, so reproducing a bug needs the state the order was in, which is one reason to log every transition, as `Order` does.
- **In return,** each state is a small class that can be read and tested alone, the transitions are explicit, an invalid call is refused in one obvious place, and the context stays the same size however many states there are.

## Implementation notes

### It is a refactoring

Going from step 1 to step 2 is a known refactoring. Martin Fowler's catalog lists the first move as [*Replace Type Code with Subclasses*](https://refactoring.com/catalog/replaceTypeCodeWithSubclasses.html), which it also calls *Replace Type Code with State/Strategy*, and the second as [*Replace Conditional with Polymorphism*](https://refactoring.com/catalog/replaceConditionalWithPolymorphism.html). Make the state classes first, move one switch at a time into them (`pay()`, then `ship()`, then `cancel()`), and keep the tests passing after each move; the `status` field becomes the reference to the state object last.

### Refuse invalid calls, and say why

A call that the current state doesn't allow should fail with an error that names the reason, and leave the state unchanged. Never ignore it silently: a client that called `cancel()` and heard nothing will tell the customer the order is cancelled. In the code, each refusal throws `Refused`, and `Order` logs it and rethrows it. A dedicated error type lets callers tell a refusal from a bug, and an HTTP API can answer it with `409 Conflict`, which [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-409-conflict) defines for a request that conflicts with the current state of the resource. Decide deliberately about repeats: when clients retry, a second `cancel()` on a cancelled order may be better answered as a success than as an error, as long as every repeat gets the same answer.

### Entry and exit actions

Some work belongs to a transition and some to a state. The refund belongs to the transition from Paid to Cancelled, because cancelling a pending order has nothing to refund, so it lives in `Paid.cancel()` rather than in `Cancelled`. Work that must happen however a state is entered, such as telling the warehouse that an order is paid (Paid is entered from Pending before step 4 and from OnHold after it), belongs in an entry hook that the context calls after every switch, for example `next.onEnter(order)`. An exit hook is the place to stop what a state started, such as the review's timer when an order leaves OnHold. UML state machines give states entry, exit and *do* behaviours and attach effects to transitions, and the diagram's labels use UML's transition notation: `pay [cleared]` is a call with a guard, and `cancel / refund` a call with an effect ([UML 2.5.1](https://www.omg.org/spec/UML/2.5.1/), clause 14). The libraries below offer the same hooks.

### Persisting the state

An object reference can't be stored, so store the state's name, such as `status = 'Shipped'` in a column, and rebuild the object when the order is loaded, from a map of names to state objects (`{ Pending: PENDING, Paid: PAID, … }`). Keep the stored names stable and independent of class names, so that renaming a class doesn't strand old rows, and let the database reject unknown names with a check constraint or an enum type. Two requests can try to move the same order at once, so make the write conditional on the state the call started from, `UPDATE orders SET status = 'Paid' WHERE id = ? AND status = 'Pending'`, or on a version number. If no row changed, another request moved the order first: reload it and run the call again, which may now be refused. [Event Sourcing](../event-sourcing/) turns this around and stores the transitions themselves as events, rebuilding the current state by replaying them. XState saves a running machine with [`getPersistedSnapshot()`](https://stately.ai/docs/persistence) and restores it with `createActor(machine, { snapshot })`.

### Sharing state objects

The states in the code have no fields, so one instance of each can serve every order; the constants `PENDING`, `PAID`, `SHIPPED` and `CANCELLED` are those instances. The book points to Flyweight for this kind of sharing and observes that state objects are often singletons. A module-level constant gives the one instance without the global access point of a [Singleton](../singleton/). A state that needs data of its own, such as OnHold's review ID and deadline, or a retry count, keeps that data in the context or becomes a new object at each transition, and then can't be shared. Java's enums make the shared form compact: each enum constant can have a class body of its own ([JLS §8.9.1](https://docs.oracle.com/javase/specs/jls/se27/html/jls-8.html#jls-8.9.1)), so an `OrderStatus` enum whose constants override `pay()`, `ship()` and `cancel()` is a set of shared state objects that can also be stored by name.

### State versus Strategy

The two class diagrams are the same, a context that delegates to an object behind an interface, but who chooses the object differs:

- With [Strategy](../strategy/), the client chooses the algorithm and hands it to the context. Strategies don't know each other, and a choice usually holds for a whole task.
- With State, the states replace one another as calls arrive. They usually name their successors, and the client never sees them.

A quick test: if the object would switch on its own in response to the calls it receives, it is State.

### Tables, statecharts and libraries

When a machine grows, or the transitions themselves need reviewing, describe it as data. A transition table maps each (state, call) pair to the next state and an action, and one small interpreter runs it. The book weighs this against the pattern: with a table, changing a transition means changing data rather than code, but the actions that go with a transition are harder to attach. The table describes how the states follow one another; the pattern describes what each state does.

*Statecharts*, introduced by David Harel in 1987, add three things to plain state diagrams: hierarchy (states nested in a parent state, so one `cancel` transition on an "open" parent serves every open state, and a child such as Paid can override it to add the refund), concurrency (regions that are active at the same time, such as payment and delivery) and communication between them. UML's state machines are based on an object-oriented variant of statecharts, and the W3C's [SCXML](https://www.w3.org/TR/scxml/), a Recommendation since 2015, writes them as XML. Libraries that implement statecharts, or a simpler state machine:

- [XState](https://stately.ai/docs/xstate) (version 5) for JavaScript and TypeScript: statecharts with [parent](https://stately.ai/docs/parent-states) and [parallel](https://stately.ai/docs/parallel-states) states, [guards](https://stately.ai/docs/guards), [entry, exit and transition actions](https://stately.ai/docs/actions), and actors.
- [transitions](https://github.com/pytransitions/transitions) for Python: a lightweight, object-oriented state machine with conditions and `on_enter`/`on_exit` callbacks.
- Erlang/OTP's [`gen_statem`](https://www.erlang.org/doc/system/statem.html) behaviour: the code for each state can sit in its own callback function, with state enter calls and state time-outs built in.

### When a switch is enough

A switch that the compiler checks fixes the "forgot one" half of step 1. TypeScript reports a `switch` that misses a member of a union when its `default` branch assigns the value to a variable of type `never` ([exhaustiveness checking](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking)). Java requires switch expressions to be exhaustive ([JEP 361](https://openjdk.org/jeps/361), final in Java 14), pattern-matching switches included, and over a sealed interface one case per permitted class is enough ([JEP 441](https://openjdk.org/jeps/441), Java 21). For a few states with little behaviour each, that is often the better trade: the rules for one state stay scattered, but the compiler finds every switch that needs the new case.

### At architecture scale

State machines run much of a distributed system:

- A [circuit breaker](../circuit-breaker/) is a three-state machine around a remote call (Closed, Open and Half-Open); the [Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker) describes its proxy as a state machine.
- A [saga orchestrator](../saga-orchestration/) is a state machine over a saga's steps and compensations, saved at every transition so that a restarted orchestrator carries on where it stopped.
- Workflow services make the machine the program. [AWS Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-statemachines.html) defines each workflow as a state machine in the JSON-based Amazon States Language, with states such as `Task`, `Choice`, `Wait`, `Parallel`, `Map` and `Fail`; an execution starts at the `StartAt` state and follows each state's `Next` until it reaches a terminal state.

What changes at that scale: the state lives in a database or in the workflow service rather than in memory, so every transition is a durable write. Calls become messages that can arrive late, twice or out of order, so each transition has to check the current state and tolerate repeats (the conditional update above, an [idempotent consumer](../idempotent-consumer/)). Waiting becomes timers, because a review that never finishes still has to leave OnHold. And the history of transitions becomes the audit trail that operators read.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Strategy](../strategy/) — Put interchangeable algorithms behind one interface and choose one at runtime, instead of branching inside the caller.
- [Flyweight](../flyweight/) — Share the common, immutable part of many similar objects and keep only what differs in each one, to cut memory.
- [Singleton](../singleton/) — Guarantee one instance with a global access point, and why injecting one shared instance usually serves that need better.
- [Memento](../memento/) — Capture an object's state in a snapshot only it can read, so it can be restored later without breaking encapsulation.
- [Circuit Breaker](../circuit-breaker/) — Stop calling a failing dependency, fail fast with a fallback, and probe until it recovers.
- [Saga (Orchestration)](../saga-orchestration/) — A coordinator runs local transactions in sequence and triggers compensations when one fails.

## References

- [Gamma, Helm, Johnson and Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software (1994)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610)
- [David Harel — Statecharts: A Visual Formalism for Complex Systems (Science of Computer Programming, 1987)](https://doi.org/10.1016/0167-6423(87)90035-9)
- [W3C — State Chart XML (SCXML): State Machine Notation for Control Abstraction (Recommendation, 2015)](https://www.w3.org/TR/scxml/)
- [OMG — Unified Modeling Language 2.5.1 (state machines: clause 14)](https://www.omg.org/spec/UML/2.5.1/)
- [Stately — XState documentation](https://stately.ai/docs/xstate)
- [AWS Step Functions — Learn about state machines in Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-statemachines.html)
- [Azure Architecture Center — Circuit Breaker pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker)
- [Refactoring.Guru — State](https://refactoring.guru/design-patterns/state)
- [Martin Fowler — Replace Type Code with Subclasses (refactoring catalog)](https://refactoring.com/catalog/replaceTypeCodeWithSubclasses.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
