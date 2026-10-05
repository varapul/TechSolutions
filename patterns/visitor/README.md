<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧩 Design Patterns (GoF)](../../README.md#design-patterns-gof)

# Visitor

> Add new operations to a stable set of classes without editing them: each operation is a visitor that every element accepts.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Visitor" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/visitor.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Nine edits, mixed concerns** | Each operation on the invoice is written as a method on every kind of line: `total()`, `toCsv()` and then `tax()` go into **ProductLine**, **ServiceLine** and **ShippingLine**, so three operations cost 3 × 3 = **9 edits**, and every line class ends up mixing pricing, CSV formatting and tax rules. The alternative leaves the classes alone and writes one function per operation that checks `instanceof` on each line, which repeats the same three type checks in every function. |
| **2 · Operations as visitors** | Every line class gets one method, `accept(v)`, which calls the visitor method for its own kind: `ProductLine` calls `v.visitProduct(this)`. **InvoiceVisitor** (the *Visitor*) declares one method per kind of line, and each operation becomes one class (a *ConcreteVisitor*) that holds its rule for every kind: **TotalVisitor** prices each kind its own way and **CsvVisitor** writes one row per line. `Invoice` (the *ObjectStructure*) walks its lines and hands each one the visitor; tax returns in step 4 as a visitor of its own. |
| **3 · Double dispatch** | `invoice.accept(totalVisitor)` calls `line.accept(v)` on each line, and the line calls back `v.visitProduct(this)`, `v.visitService(this)` or `v.visitShipping(this)`. That is **double dispatch**: the first call is resolved by the line's class, which picks the method, and the second by the visitor's class, which picks the code. The sum builds up inside the visitor, 24.00 + 60.00 + 4.50 = **EUR 88.50**, and the same walk with a `CsvVisitor` runs its methods instead and writes `product,Mug,24.00` and the other two rows. |
| **4 · Add operations, not kinds** | **TaxVisitor** (an illustrative 20 % on products and services, none on shipping) is one new class that returns **EUR 16.80**, and no line class changes. A new kind of line is the opposite: **DiscountLine** needs `visitDiscount()` on `InvoiceVisitor` and so in every visitor, the same trade-off as [Abstract Factory](../abstract-factory/), where new families are cheap and new kinds of product are not. ESLint rules, Babel plugins and Java's `FileVisitor` are visitors; when the set of kinds is closed, a TypeScript union with an exhaustive `switch`, or Java's `switch` over a sealed interface, gives the same split without `accept()`. |
<!-- END GENERATED: header -->

## The problem

An invoice holds three kinds of line: a `ProductLine` (2 mugs at EUR 12.00), a `ServiceLine` (an hour and a half of setup at EUR 40.00 an hour) and a `ShippingLine` (3 kg at EUR 1.50 per kg). The line classes are small and rarely change. What keeps changing is the list of things the business wants done with an invoice: the total first, then a CSV export for accounting, then tax, and later perhaps a PDF or a fraud check.

The direct design adds a method for each operation to every kind of line. Three operations on three classes are nine edits, and each line class ends up holding pricing rules, CSV formatting and tax law side by side: code that changes for different reasons, at different times, and is often owned by different people. When the line classes come from a library or another team, the edit may not be possible at all.

The other direct design leaves the classes alone and writes each operation as one function that asks what it is holding: `if (line instanceof ProductLine) … else if (line instanceof ServiceLine) …`. The classes stay clean, but every function repeats the same chain of type checks, and nothing makes sure that each function handles every kind. A function that misses one falls through quietly: in JavaScript it returns `undefined`, and the invoice total becomes `NaN`.

## How it works

Visitor takes each operation out of the classes it works on and makes it an object of its own: a visitor class with one method for each kind of element. The element classes get a single method, `accept(visitor)`, which does nothing but call the visitor's method for its own kind and pass itself along. From then on a new operation is a new visitor class, and the element classes don't change for it. The pattern is one of the behavioural patterns in *Design Patterns* by Gamma, Helm, Johnson and Vlissides (1994), whose motivating example is a compiler: without visitors, every class of its syntax tree would carry type checking, code generation, pretty-printing and whatever analysis comes next.

| Participant | In the diagram | Role |
|---|---|---|
| **Visitor** | `InvoiceVisitor` | Declares one visit method per kind of element: `visitProduct`, `visitService` and `visitShipping`. |
| **ConcreteVisitor** | `TotalVisitor`, `CsvVisitor`, `TaxVisitor` | One operation, with its rule for every kind of element and any state it builds up on the way. |
| **Element** | `Line` | Declares `accept(v)`, the only thing an element has to offer any operation. |
| **ConcreteElement** | `ProductLine`, `ServiceLine`, `ShippingLine` | Implements `accept(v)` by calling the visit method for its own kind with itself as the argument. |
| **ObjectStructure** | `Invoice` | Holds the elements and lets a visitor reach each of them; here `accept(v)` loops over the lines. |

**Double dispatch, plainly.** In most object-oriented languages a call picks its code by one object at run time, the receiver: `line.total()` runs `ProductLine`'s `total()` because the line is a `ProductLine`. Visitor needs the code to depend on two things at once, the kind of line and the operation, and it gets there with two ordinary calls in a row. First, `line.accept(v)` is dispatched on the line, so `ProductLine.accept` runs. Its body names the method for its own kind, `v.visitProduct(this)`, and that second call is dispatched on the visitor, so `TotalVisitor.visitProduct` runs, or `CsvVisitor.visitProduct` if the walk was given a `CsvVisitor`. These are the two hops of step 3. In Java and C# the visit methods often share one name, `visit`, and overloading does the choosing: inside `ProductLine.accept`, `this` has the static type `ProductLine`, so the compiler binds `v.visit(this)` to the `ProductLine` overload. TypeScript resolves overloads only at compile time and keeps a single implementation behind them, so the methods need different names. Languages with multiple dispatch, such as [Julia](https://docs.julialang.org/en/v1/manual/methods/), choose a method by the run-time types of all its arguments and need no handshake at all.

**Where the traversal lives.** Something has to walk the elements and hand each one the visitor, and the book weighs three places for it:

- **In the object structure.** `Invoice.accept(v)` loops over its lines, and in a [Composite](../composite/) a node's `accept` visits the node and then its children. This is the common choice: the walk is written once and every visitor gets the same order.
- **In the visitor.** The visitor decides what to visit next, which it needs when the walk depends on what it finds, such as skipping a subtree. Python's [`ast.NodeVisitor`](https://docs.python.org/3/library/ast.html#ast.NodeVisitor) works this way: when a node has its own `visit_` method, its children are visited only if that method calls `generic_visit()`. The price is walking code repeated in every visitor that needs it.
- **In an iterator.** A separate [Iterator](../iterator/) walks the structure and the client calls `accept` on each element it yields, as in `for (const line of invoice) line.accept(v)` if `Invoice` were iterable. The iterator chooses the order and the visitor chooses what happens to each element.

Java's `Files.walkFileTree` adds a variation: the walker owns the traversal, and the visitor steers it through the value each method returns (`CONTINUE`, `SKIP_SUBTREE`, `SKIP_SIBLINGS` or `TERMINATE`).

**State in the visitor.** A visitor is an ordinary object, so it can build a result as it goes: `TotalVisitor.sum` grows from 24.00 to 84.00 to 88.50, and `CsvVisitor.rows` collects one row per line, without the elements or the walk passing a running total along. The flip side is that such a visitor serves one walk: reuse it and the old sum carries over, and two walks sharing one visitor mix their results. The alternative is a visitor whose methods return values, with `accept<R>(v: Visitor<R>): R`. Java's [`ElementVisitor<R, P>`](https://docs.oracle.com/en/java/javase/27/docs/api/java.compiler/javax/lang/model/element/ElementVisitor.html), which annotation processors use to inspect classes, methods and fields, is built that way: one type parameter for the result and one for an extra argument passed to every visit.

## Code

TypeScript that mirrors the diagram. Node 22.18 or later runs it as is (`node invoice.ts`): it strips the types and doesn't check them, and `tsc --strict` passes, which is what reports a visitor that lacks a visit method. Money is kept in integer cents (1200 is EUR 12.00) and turned into euros only for output, so nothing needs rounding; the diagram shows the same amounts in euros.

```ts
import assert from 'node:assert/strict';

// Visitor: one method per kind of line. Money is integer cents (1200 = EUR 12.00).
interface InvoiceVisitor {
  visitProduct(line: ProductLine): void;
  visitService(line: ServiceLine): void;
  visitShipping(line: ShippingLine): void;
}
// Element: all a line has to offer an operation is accept().
interface Line { accept(v: InvoiceVisitor): void }

// ConcreteElements: their own data, and an accept() that names their own kind.
class ProductLine implements Line {
  readonly data: { name: string; qty: number; price: number };
  constructor(data: ProductLine['data']) { this.data = data; }
  accept(v: InvoiceVisitor) { v.visitProduct(this); }
}
class ServiceLine implements Line {
  readonly data: { name: string; hours: number; rate: number };
  constructor(data: ServiceLine['data']) { this.data = data; }
  accept(v: InvoiceVisitor) { v.visitService(this); }
}
class ShippingLine implements Line {
  readonly data: { kg: number; perKg: number };
  constructor(data: ShippingLine['data']) { this.data = data; }
  accept(v: InvoiceVisitor) { v.visitShipping(this); }
}
// ObjectStructure: the invoice walks its lines and hands each one the visitor.
class Invoice {
  readonly lines: Line[];
  constructor(...lines: Line[]) { this.lines = lines; }
  accept(v: InvoiceVisitor) { for (const line of this.lines) line.accept(v); }
}

// ConcreteVisitors: one class per operation, with its rule for every kind of line.
class TotalVisitor implements InvoiceVisitor {
  sum = 0; // state that builds up during the walk
  visitProduct(l: ProductLine) { this.sum += l.data.qty * l.data.price; }
  visitService(l: ServiceLine) { this.sum += l.data.hours * l.data.rate; }
  visitShipping(l: ShippingLine) { this.sum += l.data.kg * l.data.perKg; }
}
// One line's amount: run a TotalVisitor on that line alone, so prices live in one place.
const amount = (line: Line) => { const t = new TotalVisitor(); line.accept(t); return t.sum; };
const eur = (cents: number) => (cents / 100).toFixed(2);

class CsvVisitor implements InvoiceVisitor {
  rows: string[] = [];
  visitProduct(l: ProductLine) { this.rows.push(`product,${l.data.name},${eur(amount(l))}`); }
  visitService(l: ServiceLine) { this.rows.push(`service,${l.data.name},${eur(amount(l))}`); }
  visitShipping(l: ShippingLine) { this.rows.push(`shipping,${l.data.kg} kg,${eur(amount(l))}`); }
}
// Added later: one new class, and no line class changes.
class TaxVisitor implements InvoiceVisitor {
  sum = 0;
  visitProduct(l: ProductLine) { this.sum += amount(l) * 20 / 100; } // an illustrative 20 %
  visitService(l: ServiceLine) { this.sum += amount(l) * 20 / 100; }
  visitShipping(_l: ShippingLine) {} // no tax on shipping in this example
}

const invoice = new Invoice(
  new ProductLine({ name: 'Mug', qty: 2, price: 1200 }),
  new ServiceLine({ name: 'Setup', hours: 1.5, rate: 4000 }),
  new ShippingLine({ kg: 3, perKg: 150 }),
);
const total = new TotalVisitor(), csv = new CsvVisitor(), tax = new TaxVisitor();
for (const v of [total, csv, tax]) invoice.accept(v);

assert.equal(eur(total.sum), '88.50');
assert.deepEqual(csv.rows, ['product,Mug,24.00', 'service,Setup,60.00', 'shipping,3 kg,4.50']);
assert.equal(eur(tax.sum), '16.80');
console.log(`total ${eur(total.sum)}, tax ${eur(tax.sum)}`);
console.log(csv.rows.join('\n'));
```

Output:

```
total 88.50, tax 16.80
product,Mug,24.00
service,Setup,60.00
shipping,3 kg,4.50
```

`amount()` runs a `TotalVisitor` on a single line, so the price of each kind of line is written once and `CsvVisitor` and `TaxVisitor` reuse it. Adding `TaxVisitor` touched no line class. Adding `visitDiscount()` to `InvoiceVisitor` instead makes `tsc` reject `TotalVisitor`, `CsvVisitor` and `TaxVisitor` until each of them implements it: the ripple of step 4, reported by the compiler.

## When to use it

- The kinds of element are few and stable, and the operations on them keep coming: syntax trees in compilers, linters, formatters and code transformers (a language changes slowly, while new rules arrive all the time), document models exported to several formats, file trees, and business records whose kinds are fixed while the reports, exports and checks multiply.
- Operations that have little to do with the elements' own job, or with each other. One class per operation keeps the element classes small and puts all of the tax rules in one place.
- Element classes you can't change, as long as they offer `accept` or a similar hook. Compiler and linter APIs do (see *Implementation notes*).
- Not when new kinds of element arrive often: each one changes the visitor interface and every visitor (see *Trade-offs*).
- Not for one or two operations. A method in each class, or [Composite](../composite/)'s shared interface for a tree, is simpler.
- Not when you own the element types, their set is closed and the language has exhaustive pattern matching: a `switch` over a TypeScript union or a Java sealed interface does the same job without `accept` (see *Implementation notes*).

## Trade-offs

- **New operations are cheap, new kinds are not.** `TaxVisitor` was one class and no edits. A `DiscountLine` changes `InvoiceVisitor` and every visitor that implements it. This is one face of what Philip Wadler named [the expression problem](https://homepages.inf.ed.ac.uk/wadler/papers/expression/expression.txt) in 1998: adding both new cases and new operations to a data type without recompiling the code that already exists, and without giving up static type safety. Plain classes make new kinds cheap and new operations costly, and Visitor swaps the two. [Abstract Factory](../abstract-factory/) makes the same trade-off: a new family is one more factory, like a new visitor, while a new kind of product changes every factory, like a new kind of line.
- **Code is grouped by operation, not by class.** Everything about tax is in `TaxVisitor`, which is the point. Everything about `ProductLine` is now spread over every visitor, which is the price. Pick the grouping that matches how the code changes.
- **Encapsulation gives way.** A visitor can do its work only if it can read the elements' data, so the elements expose fields or getters that a method inside the class wouldn't need: `data` is public in the code above so that `TotalVisitor` can price a line. The book lists this among the pattern's consequences.
- **State lives in the visitor.** It is convenient for sums and lists, but a stateful visitor serves one walk at a time (see *How it works*).
- **Indirection.** Every element has an `accept` that only calls back, every visitor has a method for every kind even where several do the same thing, and a stack trace alternates between the two hierarchies. Newcomers to the pattern find the control flow hard to follow.

## Implementation notes

- **One name per kind, or one overloaded name.** `visitProduct`, `visitService` and `visitShipping` work in any language; Java and C# also allow `visit(ProductLine)`, `visit(ServiceLine)` and so on, with the overload chosen at compile time inside each `accept`. Either way, `accept` has to be written in every concrete element class rather than inherited from a base class, because in the base class `this` has the base type and the call can't name the right method.
- **Default methods and versioned visitors.** A base visitor whose methods do nothing lets each visitor override only the kinds it cares about, and lets a new kind of element arrive without breaking every visitor, at the cost that visitors which inherit the default ignore the new kind without a word. Java's `javax.lang.model` shows both sides on a platform scale. When modules (Java 9) and record components (Java 16) joined the language, `ElementVisitor` gained `visitModule` and `visitRecordComponent` as default methods that fall back to `visitUnknown`, and its documentation warns that more methods may follow and recommends extending one of the versioned base classes, from `AbstractElementVisitor6` to `AbstractElementVisitor14`, instead of implementing the interface directly.
- **When the set of kinds does change.** From Python 3.8 the parser represents every constant (numbers, strings, bytes, `True`, `False`, `None` and `...`) as one `ast.Constant` node instead of the separate `Num`, `Str`, `Bytes`, `NameConstant` and `Ellipsis` nodes. Visitors that handled them in `visit_Num`, `visit_Str` and the rest had to add `visit_Constant`, and since Python 3.14 the old methods are no longer called. That is the cost of a changed kind, paid by every visitor in every codebase that had one.
- **Visitors over composites and syntax trees.** Visitor and [Composite](../composite/) are often used together: the composite is the structure, the visitor carries the operations, and a composite node's `accept` visits the node itself and then its children. When the visit happens relative to the children matters: before them for a printer that writes a heading before its contents, after them for an evaluator that needs its operands first. ESLint offers a rule both: a handler keyed by a node type runs on the way down the tree, and one keyed by the node type plus `:exit` runs on the way back up.
- **Visitors keyed by type name.** Not every visitor uses `accept`. In an [ESLint rule](https://eslint.org/docs/latest/extend/custom-rules), `create()` returns an object whose keys are syntax-tree node types (or selectors), and ESLint calls the matching function for each node as it walks the tree. A [Babel plugin](https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/plugin-handbook.md#visitors) names its visitor methods after node types the same way, and Python's `NodeVisitor` looks up `visit_` followed by the node's class name. The nodes carry their kind as data (every ESTree node has a `type` string), so a lookup by name replaces the second dispatch. The idea is unchanged, one object per operation with a handler per kind, and such a visitor lists only the kinds it cares about, like a base class with empty methods.
- **Java's FileVisitor.** [`java.nio.file.FileVisitor`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/nio/file/FileVisitor.html) has a method for each event of a walk over a file tree: `preVisitDirectory`, `visitFile`, `visitFileFailed` and `postVisitDirectory`. `Files.walkFileTree` walks the tree depth-first and decides which method to call from what it finds; paths have no `accept`, so this is a visitor in the sense of one object per operation over a structure that someone else walks, without double dispatch. `SimpleFileVisitor` provides defaults, so a visitor overrides only what it needs.
- **Pattern matching instead of `accept`.** When you own the element types and their set is closed, current languages express the same split directly. In TypeScript the lines become a discriminated union and each operation a function with a `switch` on the `kind` field, and a `default` branch that assigns the value to a `never` variable turns a missing case into a compile error ([TypeScript handbook](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking)):

  ```ts
  import assert from 'node:assert/strict';

  // The same lines as a closed union: the kind is a field, and an operation is a function.
  type Line =
    | { kind: 'product'; name: string; qty: number; price: number }
    | { kind: 'service'; name: string; hours: number; rate: number }
    | { kind: 'shipping'; kg: number; perKg: number };

  function taxCents(line: Line): number {
    switch (line.kind) {
      case 'product': return line.qty * line.price * 20 / 100;
      case 'service': return line.hours * line.rate * 20 / 100;
      case 'shipping': return 0;
      default: {
        const unhandled: never = line; // a kind without a case is a compile error here
        throw new Error(`no tax rule for ${JSON.stringify(unhandled)}`);
      }
    }
  }

  const lines: Line[] = [
    { kind: 'product', name: 'Mug', qty: 2, price: 1200 },
    { kind: 'service', name: 'Setup', hours: 1.5, rate: 4000 },
    { kind: 'shipping', kg: 3, perKg: 150 },
  ];
  const tax = lines.reduce((sum, line) => sum + taxCents(line), 0);
  assert.equal((tax / 100).toFixed(2), '16.80');
  console.log(`tax ${(tax / 100).toFixed(2)}`); // tax 16.80
  ```

  Java does the same with a sealed interface that lists its permitted classes ([JEP 409](https://openjdk.org/jeps/409), final in Java 17) and a `switch` with type patterns over it ([JEP 441](https://openjdk.org/jeps/441), final in Java 21). The compiler accepts such a `switch` without a `default` only when it covers every permitted type, and adds a hidden one that throws in case a class compiled separately turns up at run time. The trade-off is Visitor's: a new operation is one new function, and a new kind is an edit in every `switch`, which the compiler lists for you. What goes away is `accept`, the visitor interface and the second hop. Visitor still fits in languages without exhaustive pattern matching, and wherever the element classes belong to a library that offers `accept` and a visitor interface, as compiler and linter APIs do.
- **Relatives.**
  - [Composite](../composite/) is the usual structure, and its own answer to an operation over a tree is a method in every node class: the approach of step 1, which suits trees whose kinds of node grow while the operations stay few.
  - [Iterator](../iterator/) walks a structure without caring what each element is, and Visitor decides what happens to each element by its kind. They combine when an iterator does the walking.
  - [Interpreter](../interpreter/) gives every node class of a small language's syntax tree an `interpret()` method. Further operations on the same tree, such as pretty-printing or type checking, are often written as visitors instead.
  - [Strategy](../strategy/) also turns an algorithm into an object passed in from outside, but a strategy is one algorithm behind one method, chosen per call. A visitor is a set of per-kind variants of one operation, applied across a whole structure.
  - [Abstract Factory](../abstract-factory/) makes the same trade-off, with families where Visitor has operations (see *Trade-offs*).
- **At architecture scale.** The projections of [Event Sourcing](../event-sourcing/) behave like visitors over a log: each projection is one operation with a handler per event type, and a new read model is a new projection that replays the log without touching the events or the other projections. A new event type is the expensive direction again, since every projection that must react to it needs a new handler. What changes at that scale is that producers and projections are deployed separately and no compiler lists the gaps, so projections have to skip event types they don't know (the role `visitUnknown` plays in `javax.lang.model`), and the projections that need a new event type are usually updated before producers start writing it.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Composite](../composite/) — Treat single objects and groups of objects through one interface, so a whole tree answers a question the way one leaf does.
- [Iterator](../iterator/) — Walk a collection one element at a time without exposing how it is stored: an array, a tree or a stream that never ends.
- [Interpreter](../interpreter/) — Represent a small language's grammar as classes and evaluate a sentence by walking its syntax tree.
- [Abstract Factory](../abstract-factory/) — Create families of related objects through one interface, so swapping the whole family never touches client code.
- [Strategy](../strategy/) — Put interchangeable algorithms behind one interface and choose one at runtime, instead of branching inside the caller.
- [Event Sourcing](../event-sourcing/) — Store every change as an immutable event and rebuild state by replaying them.

## References

- [Gamma, Helm, Johnson and Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software (Addison-Wesley, 1994)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610)
- [Refactoring.Guru — Visitor](https://refactoring.guru/design-patterns/visitor)
- [Refactoring.Guru — Visitor and Double Dispatch](https://refactoring.guru/design-patterns/visitor-double-dispatch)
- [Philip Wadler — The Expression Problem (1998)](https://homepages.inf.ed.ac.uk/wadler/papers/expression/expression.txt)
- [ESLint documentation — Custom Rules](https://eslint.org/docs/latest/extend/custom-rules)
- [Jamie Kyle — Babel Plugin Handbook: Visitors](https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/plugin-handbook.md#visitors)
- [Java SE 27 API — java.nio.file.FileVisitor](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/nio/file/FileVisitor.html)
- [Java SE 27 API — javax.lang.model.element.ElementVisitor](https://docs.oracle.com/en/java/javase/27/docs/api/java.compiler/javax/lang/model/element/ElementVisitor.html)
- [Python documentation — ast.NodeVisitor](https://docs.python.org/3/library/ast.html#ast.NodeVisitor)
- [TypeScript Handbook — Narrowing: exhaustiveness checking](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking)
- [OpenJDK — JEP 441: Pattern Matching for switch](https://openjdk.org/jeps/441)
- [OpenJDK — JEP 409: Sealed Classes](https://openjdk.org/jeps/409)
- [Julia documentation — Methods (multiple dispatch)](https://docs.julialang.org/en/v1/manual/methods/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
