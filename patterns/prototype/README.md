<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧩 Design Patterns (GoF)](../../README.md#design-patterns-gof)

# Prototype

> Create new objects by copying a configured prototype instead of building them from scratch, and know when a copy must go deep.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Prototype" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/prototype.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Set up from scratch** | Without the pattern, every place that needs a quarterly report builds it from nothing: `new Report()`, then four setters for the title, the theme (font Inter, accent teal), the three sections and the chart defaults. `ReportService` repeats those five calls in `pdf()`, `email()` and `export()`, so every change to the standard setup has to reach all three. Here two changes missed one of them: `export()` still uses the old blue accent and has no Costs section. |
| **2 · Clone a ready prototype** | The setup now happens once: at start-up the application registers configured reports, `quarterly` and `monthly`, in a `PrototypeRegistry` (the GoF book calls it a *prototype manager*). `ReportService` calls `registry.get('quarterly').clone()`, gets back a new `Report` with the same theme and sections, and changes only what differs: the title becomes `Q4 report`. The *Prototype* interface declares `clone()`, and `Report`, which implements it, is the *ConcretePrototype*. |
| **3 · Shallow copy, shared trap** | A shallow copy, made with `{ ...quarterly }` or `Object.assign({}, quarterly)`, copies only the top level: the copy has its own fields, but its `sections` field points at the prototype's array. So `q4.sections.push('Forecast')` changes the prototype as well, and both now show 4 sections, as will every later copy. `clone()` copies the array too, so after the same push the prototype keeps its 3 sections and the copy has 4. |
| **4 · Deep copies and limits** | `structuredClone()` copies nested data deeply, cycles included, but not the prototype chain: the result is a plain object, `instanceof Report` is false and calling `clone()` on it throws a `TypeError`. So a class writes `clone()` itself, with a constructor call that keeps the class, and shares parts that never change, such as the frozen theme, instead of copying them. The same idea appears as Java's `Object.clone()` (to be used with care, *Effective Java* Item 13), Python's `copy` module and, at system scale, Kubernetes pod templates, [deployment stamps](../deployment-stamps/) and [machine images](../immutable-infrastructure/); JavaScript's prototype chain is a different thing, since it delegates property lookups and copies nothing. |
<!-- END GENERATED: header -->

## The problem

A reporting service produces the same kind of report in several places: a PDF for the board, an email digest and a data export. Each one starts out as the standard quarterly report, with the house theme (font Inter, teal accent), the sections Summary, Revenue and Costs, and the default chart settings. Without a shared starting point, each method builds that report itself: `new Report()` followed by four setters, five calls repeated in `pdf()`, `email()` and `export()`.

Duplicated setup drifts. When the accent colour changed from blue to teal and finance asked for a Costs section, two of the three methods were updated and `export()` was not, so the exported report quietly looks and reads differently from the others. The longer the setup and the more places repeat it, the more likely this becomes. Some setups are also expensive (loading a template from storage, parsing a theme, querying defaults), and repeating them for every new report wastes time as well.

## How it works

Prototype creates new objects by copying an existing, fully configured object instead of building each one from its class. The configuration is done once, on the prototype, and every new object starts life as a copy of it, so the client only changes what is different. Gamma, Helm, Johnson and Vlissides describe the pattern in *Design Patterns* (1994). The key move is that each object knows how to copy itself, so the code that asks for a copy never needs to name the concrete class.

| Participant | In the diagram | Role |
|---|---|---|
| **Prototype** | `interface Prototype<T> { clone(): T }` | Declares the operation that copies an object. |
| **ConcretePrototype** | `Report`, here the registered `quarterly` and `monthly` objects | Implements `clone()` by copying itself, including the nested state it owns. |
| **Client** | `ReportService` | Asks a prototype for a copy of itself instead of calling a constructor, then adjusts the copy. |
| *prototype manager* | `PrototypeRegistry` | A registry of named prototypes that clients look up before cloning. The book describes it as an implementation option rather than a participant. |

**The registry.** When the set of prototypes is open-ended, keep them in a registry keyed by name (the book calls it a prototype manager, refactoring.guru a prototype registry). The application registers configured objects at start-up or loads them from configuration, and clients ask for a copy by name. Adding a new kind of report then means registering one more configured object, not writing a class.

**Shallow or deep.** The hard part of the pattern is `clone()` itself. A shallow copy duplicates an object's own fields, but a field that holds a reference (an array, a nested object) still points at the same thing as the prototype's field. In JavaScript the spread syntax `{ ...quarterly }` and `Object.assign({}, quarterly)` are both shallow, so `q4.sections.push('Forecast')` adds a section to the prototype too, and to every copy made from it afterwards. A deep copy duplicates the nested mutable state as well, so the prototype and its copies change independently. Sharing is fine for values that never change (strings, numbers, frozen objects); anything that may be mutated must be copied.

**Cycles and shared references.** Deep copying gets harder when objects refer to each other, such as a section that points back to its report. A naive recursive copy follows a cycle until the stack overflows, and where two fields point at one object it makes two separate copies. `structuredClone()` and Python's `copy.deepcopy()` both avoid this by remembering which objects they have already copied in the current pass and reusing those copies, so cycles and shared references keep their shape.

## Code

TypeScript that mirrors the diagram. Node 22.18 or later runs it as is (`node report.ts`) by stripping the types, and it passes `tsc --noEmit --strict`. `clone()` builds the copy through the constructor, so it stays a `Report` with its methods; it copies the mutable `sections` array with `structuredClone()` and shares the frozen theme, which can never change.

```ts
import assert from 'node:assert/strict';

type Theme = Readonly<{ font: string; accent: string }>;

interface Prototype<T> { clone(): T } // Prototype: anything that copies itself

// ConcretePrototype: a configured Report copies itself.
class Report implements Prototype<Report> {
  title: string;
  readonly theme: Theme;  // frozen, so copies can share it
  sections: string[];     // mutable, so each copy needs its own
  constructor(title: string, theme: Theme, sections: string[]) {
    this.title = title;
    this.theme = Object.freeze(theme);
    this.sections = sections;
  }
  clone(): Report {
    // A new Report keeps the class; structuredClone deep-copies the plain data.
    return new Report(this.title, this.theme, structuredClone(this.sections));
  }
}

// Prototype manager: named prototypes, configured once at start-up.
class PrototypeRegistry {
  private readonly prototypes = new Map<string, Prototype<Report>>();
  set(name: string, p: Prototype<Report>): void { this.prototypes.set(name, p); }
  get(name: string): Prototype<Report> {
    const p = this.prototypes.get(name);
    if (!p) throw new Error(`No prototype named '${name}'`);
    return p;
  }
}

// Client: copies a prototype and changes only what differs.
class ReportService {
  private readonly registry: PrototypeRegistry;
  constructor(registry: PrototypeRegistry) { this.registry = registry; }
  q4Report(): Report {
    const q4 = this.registry.get('quarterly').clone();
    q4.title = 'Q4 report';
    return q4;
  }
}

const theme = { font: 'Inter', accent: 'teal' };
const quarterly = new Report('Q3 report', theme, ['Summary', 'Revenue', 'Costs']);
const registry = new PrototypeRegistry();
registry.set('quarterly', quarterly);
registry.set('monthly', new Report('Monthly report', theme, ['Summary', 'KPIs']));

const q4 = new ReportService(registry).q4Report();
q4.sections.push('Forecast');
assert.deepEqual([quarterly.sections.length, q4.sections.length], [3, 4]);
assert.ok(q4 instanceof Report && q4.theme === quarterly.theme); // frozen theme: shared
console.log(q4.title, q4.sections); // Q4 report [ 'Summary', 'Revenue', 'Costs', 'Forecast' ]

// structuredClone copies deeply too, but returns a plain object, not a Report.
const sc = structuredClone(quarterly); // typed as Report, but it is a plain object
assert.equal(sc instanceof Report, false);
assert.notEqual(sc.sections, quarterly.sections); // the array was copied, though
console.log(typeof sc.clone); // undefined

// The bug that clone() avoids: a shallow copy shares the prototype's array.
const shallow = { ...quarterly };
shallow.sections.push('Forecast');
assert.equal(quarterly.sections.length, 4); // the prototype changed as well
console.log(quarterly.sections); // [ 'Summary', 'Revenue', 'Costs', 'Forecast' ]
```

Output:

```
Q4 report [ 'Summary', 'Revenue', 'Costs', 'Forecast' ]
undefined
[ 'Summary', 'Revenue', 'Costs', 'Forecast' ]
```

The comment on `structuredClone` is worth a second look. TypeScript declares it as `structuredClone<T>(value: T): T`, so the compiler believes `sc` is still a `Report` and accepts `sc.clone()`, which fails at runtime with `TypeError: sc.clone is not a function`.

## When to use it

- **The setup is long or expensive.** Configuring an object takes many calls, reads files or queries services, and many objects share most of that configuration. Configure once, then copy.
- **The variety lives in configuration, not in classes.** Quarterly and monthly reports are the same class with different settings. Registering one configured instance per variant is lighter than a subclass or a factory per variant, and new variants can be added at runtime.
- **The class is only known at runtime.** Code that works with whatever objects it is handed (plug-ins, shapes on an editor's palette, documents loaded from storage) can make more of them by cloning, without naming their classes. The book's own example is a music-score editor built on a general graphics framework, where a palette tool creates notes and staves by cloning the prototype it was set up with, so the framework needs no tool subclass per kind of note.
- **You need a copy to work on.** A copy taken before a risky change, for undo or for a what-if calculation, is the same operation. Memento formalises snapshots, and refactoring.guru notes that a plain clone can stand in for one when the object is simple.
- **Prefer something else** when objects are cheap and simple to construct (a constructor or a factory function says more), or when the object graph is hard to copy correctly: open connections, file handles, or identities that must stay unique.

## Trade-offs

- **Every class needs a correct `clone()`.** Each ConcretePrototype has to copy itself, including subclasses that add fields. The book notes that this is hard to add to classes that already exist, and hard when the object holds parts that can't be copied or that refer to each other in cycles.
- **Shallow copies leak.** A clone that forgets one nested field shares it with the prototype. The bug shows up far from the copy, possibly as a change to the registered prototype that every later copy inherits.
- **Deep copies cost.** Copying large nested structures takes time and memory, so share what is immutable instead of copying it.
- **Same values, new identity.** Ids, creation timestamps, open resources and subscriptions must not be copied as they are. `clone()`, or an initialisation step after it (the book discusses initialising clones), has to reset them.
- **In return,** new variants become data instead of classes, the client never names a concrete class, and the setup lives in one place, so it can't drift.

## Implementation notes

- **`clone()` in TypeScript.** Write it as a method that calls the constructor, as `Report` does, which keeps the class and its methods and runs the constructor's checks. Subclasses override `clone()` to copy their own fields too. A copy constructor or a static `Report.from(other)` does the same job. `structuredClone()` is the right tool for the plain data inside: it copies arrays, maps, sets, dates and nested plain objects deeply and keeps cycles. It does not copy the prototype chain or class private fields, it throws a `DataCloneError` on functions, and it drops property attributes, so a frozen object comes back unfrozen (MDN, *The structured clone algorithm*). Called on a class instance, it returns a plain object: `structuredClone(quarterly) instanceof Report` is `false`.
- **Share what can't change.** Immutable parts, like the frozen theme, need no copying: every copy can point at the same object, which makes copies cheaper and smaller. Flyweight takes this further and shares the common, immutable part of many objects on purpose. Sharing something mutable is exactly the shallow-copy bug.
- **Registry variations.** The registry in the example hands out the prototype and the client calls `clone()`. A stricter registry hands out only copies (`create(name)`), so no client can change a registered prototype by accident. A registry is also the natural place to load prototypes from configuration files or a database.
- **Prototype and the other creational patterns.** [Factory Method](../factory-method/) lets a subclass choose the class to instantiate, so each product needs a creator subclass; Prototype needs no creator hierarchy, only one configured instance per product, but every product must be copyable. [Abstract Factory](../abstract-factory/) can be built from prototypes: the book suggests a concrete factory that holds a prototype of each product and clones it, which turns a new product family into new configuration rather than new classes. [Builder](../builder/) assembles a complex object step by step, while Prototype starts from a finished one; they combine well, since you can build a prototype once and clone it from then on.
- **Composite and Decorator.** Object structures made with [Composite](../composite/) (a report with nested sections and charts) or [Decorator](../decorator/) are tedious to rebuild by hand, which is why the book notes that such designs often benefit from Prototype. Cloning a composite means cloning its children too.
- **Not JavaScript's prototype chain.** JavaScript's inheritance is prototypal, but its prototypes are a different mechanism. `Object.create(quarterly)` makes an empty object whose missing properties are looked up on `quarterly` at runtime (MDN, *Inheritance and the prototype chain*). Nothing is copied, so `Object.create(quarterly).sections.push('Forecast')` changes `quarterly` itself. That is delegation, a way for objects to share state and behaviour; the Prototype pattern makes independent copies.
- **Java.** `Object.clone()` is protected and makes a field-by-field, shallow copy, and it throws `CloneNotSupportedException` unless the class implements `Cloneable`, a marker interface that has no `clone()` method of its own (Java SE API documentation). Joshua Bloch's *Effective Java* (3rd edition, Item 13, "Override clone judiciously") explains why the mechanism is fragile: a class with mutable fields has to repair the shallow copy itself, as the book's `Stack` example does by copying its internal array, and the approach doesn't fit final fields that refer to mutable objects. Bloch recommends a copy constructor or a static copy factory instead; the TypeScript `clone()` above follows the same idea by building the copy through the constructor.
- **Python.** The `copy` module provides `copy.copy()` (shallow) and `copy.deepcopy()` (deep, with a memo dictionary that handles recursive structures), and a class can customise both with `__copy__()` and `__deepcopy__()`. Since Python 3.13, `copy.replace()` makes a modified copy of named tuples, dataclasses and other classes that define `__replace__()`.
- **At architecture scale.** Stamping out copies of a configured template is a common idea in infrastructure, even though no object's `clone()` is involved. A Kubernetes Deployment, Job or DaemonSet holds a pod template, and its controller creates every pod from it; editing the template doesn't change running pods, so the controller replaces them with pods made from the new template. [Deployment stamps](../deployment-stamps/) deploy whole copies of a stack from one template, and [immutable infrastructure](../immutable-infrastructure/) launches every server from a baked machine image. The lesson carries over: decide what each copy must own (its data, its identity) and what it may share (the template, the image).

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Abstract Factory](../abstract-factory/) — Create families of related objects through one interface, so swapping the whole family never touches client code.
- [Factory Method](../factory-method/) — Let subclasses decide which class to create: the base class codes against an interface and calls an overridable create method.
- [Builder](../builder/) — Assemble a complex object step by step and validate it once at the end, instead of calling a constructor with ten arguments.
- [Composite](../composite/) — Treat single objects and groups of objects through one interface, so a whole tree answers a question the way one leaf does.
- [Memento](../memento/) — Capture an object's state in a snapshot only it can read, so it can be restored later without breaking encapsulation.
- [Flyweight](../flyweight/) — Share the common, immutable part of many similar objects and keep only what differs in each one, to cut memory.
- [Deployment Stamps](../deployment-stamps/) — Deploy many independent copies of the whole stack, each serving a subset of tenants.
- [Immutable Infrastructure](../immutable-infrastructure/) — Never patch servers in place: bake a new image and replace them.

## References

- [Gamma, Helm, Johnson and Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software (Addison-Wesley, 1994)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610)
- [MDN — Window: structuredClone() method](https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone)
- [MDN — The structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
- [MDN — Inheritance and the prototype chain](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Inheritance_and_the_prototype_chain)
- [MDN — Spread syntax (...): copying objects](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Spread_syntax)
- [Java SE 27 API — Object.clone()](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/lang/Object.html#clone())
- [Java SE 27 API — Cloneable](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/lang/Cloneable.html)
- [Joshua Bloch — Effective Java, 3rd edition (Item 13: Override clone judiciously)](https://www.informit.com/store/effective-java-9780134685991)
- [Python documentation — copy: Shallow and deep copy operations](https://docs.python.org/3/library/copy.html)
- [Kubernetes documentation — Pods: pod templates](https://kubernetes.io/docs/concepts/workloads/pods/#pod-templates)
- [refactoring.guru — Prototype](https://refactoring.guru/design-patterns/prototype)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
