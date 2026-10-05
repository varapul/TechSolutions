<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧩 Design Patterns (GoF)](../../README.md#design-patterns-gof)

# Strategy

> Put interchangeable algorithms behind one interface and choose one at runtime, instead of branching inside the caller.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Strategy" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/strategy.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One method, many ifs** | The selected option reaches `Checkout.shippingCost(order, method)` as a string, and the method branches on it: `if standard … else if byWeight … else if express …`. The next rule, **FreeOver50**, means editing this function again, and because every rule lives in it, its one test suite has to check all four again. |
| **2 · Rules become strategies** | Each branch moves into its own class that implements **ShippingStrategy** (the *Strategy*), whose one method is `cost(order)`. `Checkout` (the *Context*) holds one strategy, typed as the interface, and `shippingCost(order)` just returns `strategy.cost(order)`: it never asks which class it holds. The UI now passes an object, `setStrategy(new Standard())`, instead of a string. |
| **3 · Swap at runtime** | The customer picks **ByWeight**, then **Express**. Each click calls `setStrategy()`, Checkout's reference moves to the new object, and the next `strategy.cost(order)` runs a different algorithm on the same order (3 kg, EUR 42): 4.90 with Standard, 4.50 with ByWeight (1.50 × 3) and 15.00 with Express (12 + 1 × 3). `Checkout` runs the same line every time. |
| **4 · Add one without editing** | **FreeOver50** (free from a EUR 50 subtotal, otherwise 4.90) is one new class, and neither `Checkout` nor the other strategies change: it returns 4.90 for this order and 0.00 for a EUR 57 one. Where functions are values, a strategy is often just a function, such as a sort comparator or a Python `key`. Unlike *State*, the client chooses the strategy; unlike *Template Method*, it varies by composition instead of subclassing. |
<!-- END GENERATED: header -->

## The problem

A checkout has to price shipping, and the shop offers several ways to do it: a flat rate, a price per kilogram, an express service. The first version usually puts all of them in one method that receives the customer's choice as a string, `shippingCost(order, method)`, and branches on it with `if` and `else if`.

Every new rule, such as free shipping from EUR 50, means opening that method again. The rules can't be read, owned or tested on their own: the method's tests have to cover every branch, and an edit made for one rule can break the others. The branching on `method` also tends to spread, because the delivery estimate, the label on the option and the carrier booking need to know the method too, and every copy has to be found and changed.

## How it works

Strategy gives each variant of an algorithm its own class behind one shared interface. The code that needs the algorithm keeps a reference to one of these objects and calls it through the interface, so it never branches on which variant it has. Deciding which variant to use becomes someone else's job: whoever sets the reference. The pattern is one of the behavioural patterns in *Design Patterns* by Gamma, Helm, Johnson and Vlissides (1994), which also calls it *Policy*.

| Participant | In the diagram | Role |
|---|---|---|
| **Strategy** | `ShippingStrategy` | The interface every variant implements, here one method, `cost(order)`. |
| **ConcreteStrategy** | `Standard`, `ByWeight`, `Express`, `FreeOver50` | One algorithm each. They know nothing about each other or about the checkout. |
| **Context** | `Checkout` | Holds one strategy, typed as the interface, and delegates to it. `setStrategy()` lets a client replace it. |

The client, here the checkout page, creates a strategy and hands it to the context, and from then on it talks only to `Checkout`. The conditional hasn't vanished: it has become a choice of object, made once where the customer clicks, instead of a branch that runs inside the pricing code on every call.

**How the context and the strategy share data.** A strategy needs inputs, and the book describes two ways to provide them:

- **Pass the data.** `cost(order)` receives what it needs as arguments. Strategies stay independent of `Checkout` and are easy to test, but the arguments have to cover what *any* strategy might need. Passing the whole order rather than single fields keeps the interface stable: with `cost(kg)`, the arrival of `FreeOver50`, the first rule that looks at the subtotal, would have changed the interface and every class that implements it.
- **Pass the context.** With `cost(checkout)`, each strategy asks the context for what it needs. The interface never has to change, but every strategy now depends on `Checkout`'s methods, so the two are harder to reuse and to test apart.

Passing a small, immutable value such as the order is usually the better default. Pass the context when strategies need data that is expensive to gather up front and only some of them use.

**Choosing the strategy.** The pattern leaves open who decides, and in practice it is one of these:

- **The user**, as in the diagram: the selected option becomes a strategy object.
- **Configuration**: a setting per market, tenant or environment, read at start-up.
- **A factory or registry** that maps a name to a strategy, such as `rules[name]` in the code below. The one remaining lookup lives in a single place, and the options on the page can be generated from the same list, so a new rule doesn't touch the page either. Dependency-injection containers can build the registry: Spring, for example, can [inject a `Map<String, ShippingStrategy>`](https://docs.spring.io/spring-framework/reference/core/beans/annotation-config/autowired.html) holding every bean of that type, keyed by bean name.
- **A feature flag** whose value names the strategy, so a new rule can go to some customers first and be switched off without a deploy (see [Feature Flags](../feature-flags/)).

## Code

TypeScript that mirrors the diagram. Node 22.18 or later runs it as is (`node shipping.ts`): it strips the types and doesn't check them, so run `tsc --noEmit` to catch a class that implements `cost()` wrongly. Money is kept in integer cents (490 is EUR 4.90) and turned into euros only for output, so nothing needs rounding. The diagram shows the same amounts in euros.

```ts
// Money is kept in integer cents (490 is EUR 4.90), so nothing needs rounding.
interface Order {
  readonly kg: number;
  readonly subtotal: number; // cents
}

// Strategy: the one operation every shipping rule offers.
interface ShippingStrategy {
  cost(order: Order): number; // cents
}

// ConcreteStrategies: one small class per rule.
class Standard implements ShippingStrategy {
  cost(_order: Order): number { return 490; }                  // flat 4.90
}
class ByWeight implements ShippingStrategy {
  cost(order: Order): number { return 150 * order.kg; }       // 1.50 per kg
}
class Express implements ShippingStrategy {
  cost(order: Order): number { return 1200 + 100 * order.kg; } // 12 + 1 per kg
}

// Context: holds one strategy and never asks which one it is.
class Checkout {
  private strategy: ShippingStrategy;
  constructor(strategy: ShippingStrategy) { this.strategy = strategy; }
  setStrategy(strategy: ShippingStrategy): void { this.strategy = strategy; }
  shippingCost(order: Order): number { return this.strategy.cost(order); }
}

const eur = (cents: number): string => (cents / 100).toFixed(2);
const order: Order = { kg: 3, subtotal: 4200 };

const checkout = new Checkout(new Standard());
console.log(eur(checkout.shippingCost(order)));  // 4.90
checkout.setStrategy(new ByWeight());             // the customer picks another option
console.log(eur(checkout.shippingCost(order)));  // 4.50
checkout.setStrategy(new Express());
console.log(eur(checkout.shippingCost(order)));  // 15.00

// A new rule is a new class; Checkout and the other rules stay as they are.
class FreeOver50 implements ShippingStrategy {
  cost(order: Order): number { return order.subtotal >= 5000 ? 0 : 490; }
}
checkout.setStrategy(new FreeOver50());
console.log(eur(checkout.shippingCost(order)));                      // 4.90
console.log(eur(checkout.shippingCost({ kg: 3, subtotal: 5700 })));  // 0.00

// The functional form: a strategy is any function with this signature.
type ShippingRule = (order: Order) => number; // cents
const rules: Record<string, ShippingRule> = {
  standard: () => 490,
  byWeight: (o) => 150 * o.kg,
  express: (o) => 1200 + 100 * o.kg,
  freeOver50: (o) => (o.subtotal >= 5000 ? 0 : 490),
};
const rule = rules['byWeight'];  // e.g. the value of the selected radio button
console.log(eur(rule(order)));   // 4.50
```

Output:

```
4.90
4.50
15.00
4.90
0.00
4.50
```

## When to use it

- Several interchangeable versions of one algorithm (shipping, pricing, tax, ranking, compression) that are chosen per user, per request or per deployment, and a list that keeps growing.
- A conditional that switches on a type code or a method name, especially when the same switch appears in several places.
- Variants that should be developed, tested or owned separately, or added as plug-ins.
- Not when the variants differ only in their numbers. Three of the four rules here are one formula, a base price plus a price per kilogram (`Standard` is 4.90 + 0 × kg, `ByWeight` 0 + 1.50 × kg, `Express` 12 + 1 × kg), and if every rule had that shape, a table of rates would beat four classes. Strategy pays off when the algorithms differ in kind, like the threshold in `FreeOver50`.
- Not for two variants that will never change (an `if` is clearer), and not when an object should change its behaviour by itself as it moves from state to state (that is *State*).

## Trade-offs

- **More types.** Every rule is a class, plus the interface they share. Functions remove most of this ceremony (see below).
- **Someone has to know the options.** To pick a strategy, the client must know which ones exist and how they differ; the book counts this among the pattern's costs. A registry that describes each strategy (a name and a label) keeps that knowledge in one place.
- **One interface for all.** Every strategy gets the same inputs, so simple ones ignore data that complex ones need, and a rule that needs something new changes the interface for all of them.
- **Indirection.** Reading `Checkout` no longer tells you how shipping is priced. You need to know which object it holds at runtime.
- **In return,** a new rule is a new class and nothing else changes, each rule can be read and tested alone, and the choice can change while the program runs.

## Implementation notes

- **It is a refactoring.** Going from step 1 to step 2 is what Martin Fowler's catalog calls [*Replace Conditional with Polymorphism*](https://refactoring.com/catalog/replaceConditionalWithPolymorphism.html), and the catalog also lists the related *Replace Type Code with State/Strategy*. Create a class for each branch, move each branch's body into its class's method, then replace the conditional with one call. Moving one branch at a time keeps the tests passing all the way.
- **The functional form.** When a strategy is a single operation and functions are values in your language, the interface can be a function type, `type ShippingRule = (order: Order) => number`, and each strategy a function or a lambda. Standard libraries are full of these:
  - JavaScript's [`Array.prototype.sort()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort) takes a compare function. Without one, it converts the elements to strings and compares their UTF-16 code units, so `[10, 9, 1].sort()` returns `[1, 10, 9]`; `(a, b) => a - b` sorts them as numbers.
  - Java's [`Comparator`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/Comparator.html) is a functional interface, so a lambda or `Comparator.comparing(…)` can be passed to `List.sort()`, `Collections.sort()` or a `TreeMap`.
  - Python's [key functions](https://docs.python.org/3/howto/sorting.html): `list.sort()`, `sorted()`, `min()`, `max()`, `heapq.nsmallest()` and `heapq.nlargest()` take a `key` function, called once per element to compute what is compared. `functools.cmp_to_key()` adapts an old-style comparison function.

  An interface with methods is still clearer when a strategy has **several operations that vary together** (the price, the delivery estimate and the label shown to the customer), when it carries its own configuration, or when it needs a name to be listed, registered and logged. A class keeps those together, and the compiler checks that each strategy implements all of them.
- **Share stateless strategies.** None of the shipping rules keeps state, so one instance of each can serve every checkout, even across threads, and the book suggests sharing such strategies the way *Flyweight* shares objects. Java's `String.CASE_INSENSITIVE_ORDER` is one shared `Comparator` instance. A strategy with per-use state, such as a round-robin position, needs one instance per context or has to keep that state somewhere else.
- **A default.** The context can start with a sensible strategy, `Standard` here, so simple clients don't have to choose. The book also describes a context that works without any strategy object and falls back to its own behaviour.
- **Test each strategy alone, and the context with a stub.** A strategy is a function of its inputs: `new FreeOver50().cost({ kg: 3, subtotal: 5000 })` should return 0, and a subtotal of 4999 should return 490. `Checkout` doesn't need a real rule at all: in TypeScript, `new Checkout({ cost: () => 123 })` is enough, without a mocking library.
- **Money.** Keep amounts in integer minor units or a decimal type, and round in one agreed place. These rules produce whole cents, so they never round.
- **At compile time.** In C++ a strategy can be a template parameter, which costs nothing at runtime but can't change after compilation. [`std::map`'s `Compare` parameter](https://en.cppreference.com/cpp/container/map), `std::less<Key>` by default, decides how keys are ordered. The book discusses this variant too.
- **Where it appears.**
  - Java: `ThreadPoolExecutor` takes a [`RejectedExecutionHandler`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/concurrent/RejectedExecutionHandler.html) that decides what happens to a task it can't accept. Four policies are provided, and the default, `AbortPolicy`, throws an exception.
  - Node.js: [Passport](https://www.passportjs.org/concepts/authentication/strategies/) calls each authentication mechanism a *strategy*, and an application registers the ones it uses with `passport.use()`.
  - The sort functions above.
- **Relatives.** Several patterns share Strategy's shape, an object that delegates part of its work to another object through an interface. They differ in intent:
  - *State* has the same structure, but the state objects (or the context) switch to the next state as requests arrive, and the client usually doesn't take part. With Strategy the client picks the object, and strategies don't know about each other.
  - *Template Method* fixes the skeleton of an algorithm in a base class and lets subclasses fill in steps. That is inheritance, decided per class when the code is written. Strategy swaps the whole algorithm by composition, per object, while the program runs.
  - *Bridge* also delegates to an implementation object, but its purpose is structural: it splits one hierarchy into two that grow independently (shapes and renderers, say), and it is usually designed up front. A strategy is one interchangeable algorithm.
  - [Command](../command/) turns a request, what to do and with which arguments, into an object so it can be queued, logged or undone. A strategy is *how* the context does a job it already knows it has to do.
  - [Decorator](../decorator/) wraps an object and adds behaviour around its calls while keeping its interface. Strategy replaces behaviour inside the object; the book contrasts the two as changing an object's "skin" versus its "guts".
- **At architecture scale.**
  - A load balancer's algorithm is a strategy chosen by configuration. [NGINX](https://nginx.org/en/docs/http/ngx_http_upstream_module.html) uses weighted round robin unless an `upstream` block names another method, such as `least_conn`, `ip_hash`, `hash` or `random`. An [AWS Application Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-target-group-attributes.html) target group uses round robin by default and can be switched to least outstanding requests or weighted random, one algorithm at a time. Two things change at that scale: the algorithm needs live data from its context (the requests in flight per instance), so it has state and can't be shared freely, and switching it is a configuration change, not a code change. See [Load Balancing](../load-balancing/).
  - A feature flag that returns a variant name, looked up in a registry like `rules`, picks the strategy for each request. A new pricing rule can then reach 5% of customers first and be turned off again without a deploy. See [Feature Flags](../feature-flags/).

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- State *(planned)* — Let an object change its behaviour when its state changes by delegating to state objects instead of growing switch statements.
- Template Method *(planned)* — Fix an algorithm's skeleton in a base class and let subclasses fill in individual steps, without changing their order.
- Bridge *(planned)* — Split an abstraction from its implementation so both vary independently: m shapes and n renderers need m + n classes, not m × n.
- [Command](../command/) — Turn a request into an object that can be queued, logged, undone and redone, decoupling who asks from who acts.
- [Decorator](../decorator/) — Wrap an object to add behaviour at runtime, stacking wrappers instead of multiplying subclasses for every combination.
- [Load Balancing](../load-balancing/) — Spread requests across healthy instances and stop sending to unhealthy ones.
- [Feature Flags](../feature-flags/) — Deploy code dark, then turn features on per user or percentage at runtime.

## References

- [Gamma, Helm, Johnson and Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software (1994)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610)
- [Refactoring.Guru — Strategy](https://refactoring.guru/design-patterns/strategy)
- [Martin Fowler — Replace Conditional with Polymorphism (refactoring catalog)](https://refactoring.com/catalog/replaceConditionalWithPolymorphism.html)
- [Java SE 27 API — java.util.Comparator](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/Comparator.html)
- [MDN — Array.prototype.sort()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort)
- [Python documentation — Sorting Techniques (key functions)](https://docs.python.org/3/howto/sorting.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
