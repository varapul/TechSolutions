<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧩 Design Patterns (GoF)](../../README.md#design-patterns-gof)

# Template Method

> Fix an algorithm's skeleton in a base class and let subclasses fill in individual steps, without changing their order.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Template Method" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/template-method.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Copy-paste importers** | `CsvImporter` and `JsonImporter` each implement the whole import in their own `run(file)`: open the file, read the rows, parse each row, validate each record, save the valid ones and close. Only the parsing line differs, so five of the six steps are copies. When products with empty names slipped through, the name check was added to `CsvImporter`'s copy and missed in `JsonImporter`'s, which still saves a product without a name. |
| **2 · The skeleton in the base** | The steps move into the abstract **DataImporter** (the *AbstractClass*), whose `run(file)` is the **template method**: it exists once and calls open, read rows, parse, validate, save and close in that order. `parse(row)` is an **abstract step** that each *ConcreteClass* must supply, and `validate(rec)` is a **hook**, with a default (the name must not be empty) that a subclass may override. The base class calls the subclass and not the other way round: the *Hollywood principle*, don't call us, we'll call you. |
| **3 · One run, step by step** | `run('products.csv')` is called on a `CsvImporter`, so the inherited `run()` executes: it opens the file and reads 5 rows, and each `this.parse(row)` is dispatched to **CsvImporter**, which splits the row at the commas. CsvImporter doesn't override `validate`, so the default runs and rejects **1003** for its empty name. The 4 valid records are saved and the file is closed: **4 saved, 1 rejected**. |
| **4 · Hooks, and the alternative** | **JsonImporter** overrides the hook, calling `super.validate(rec)` and also requiring a positive price, without an edit to `DataImporter` or `CsvImporter`. Java's `AbstractList` (implement `get` and `size`, inherit the rest) and Python's `unittest.TestCase` (`setUp`, the test method, `tearDown`) work this way, and Spring's `JdbcTemplate` gets the same effect with callbacks instead of subclasses. The cost is inheritance: every variant is a subclass coupled to its base class, which is why [Strategy](../strategy/) is the usual alternative; one of the steps is often a [factory method](../factory-method/), and at system scale a fixed sequence of stages becomes [Pipes and Filters](../pipes-and-filters/). |
<!-- END GENERATED: header -->

## The problem

A product catalogue imports data from its suppliers, and each supplier sends a file in some format. The first importer reads CSV: it opens the file, reads its rows, turns each row into a product record, checks each record, saves the good ones and closes the file. When a supplier sends JSON Lines instead, the quickest route is to copy the class and change the line that parses a row. Two classes now hold the same procedure, and only one of its six steps really differs.

The copies drift apart with the first fix. In the diagram, products without a name were getting into the catalogue, so a name check was added to `CsvImporter`; `JsonImporter` has its own copy of that step, nobody remembered it, and it still accepts them. Every later change to the shared steps (a transaction around the saves, a limit on the number of rows, clearer error messages) has to be found, made and tested in every copy, and nothing stops one copy from running the steps in a different order.

## How it works

Template Method writes the procedure once, in a base class, as a method that calls the steps in a fixed order, and leaves some of those steps for subclasses to fill in. The base class decides *what* happens and *when*; a subclass decides only *how* its own steps are done. The pattern is one of the behavioural patterns in *Design Patterns* by Gamma, Helm, Johnson and Vlissides (1994), and unlike most of them it works through inheritance rather than by combining objects.

| Participant | In the diagram | Role |
|---|---|---|
| **AbstractClass** | `DataImporter` | Holds the template method, `run(file)`, which calls the steps in order. It implements the steps that never vary (`open`, `readRows`, `save`, `close`), declares the abstract ones and gives each hook its default. |
| **ConcreteClass** | `CsvImporter`, `JsonImporter` | Implements the abstract steps (`parse(row)`) and overrides a hook when it needs to (`JsonImporter.validate`). It doesn't decide the order of the steps. |

**Fixed steps, abstract steps and hooks.** The steps that a template method calls come in three kinds, and whoever writes a subclass needs to know which is which:

- **Fixed steps** belong to the base class and are not meant to change: `open`, `readRows`, `save` and `close`. In the code below they are private to `DataImporter`.
- **Abstract steps** have no implementation in the base class, so every subclass has to provide one: `parse(row)`. The TypeScript, Java and C# compilers reject a concrete subclass that leaves one out.
- **Hooks** come with a default, and a subclass may override them: `validate(rec)` rejects a record without a name unless a subclass says otherwise. Many hooks do nothing by default and only mark a place, often just before or after an important step, where a subclass can add behaviour. [Refactoring.Guru](https://refactoring.guru/design-patterns/template-method) keeps the word *hook* for those empty ones and calls a step with a real default an *optional step*. Either way, the template method works whether the step is overridden or not.

Make the difference visible in the code. Abstract methods take care of the steps that must be written. Name hooks for the moment they run or the decision they make (`beforeSave`, `afterRow`, `shouldSkip`) so that they read as optional, document their defaults, and make them `protected` so that callers can't run them out of order. Java's [`ThreadPoolExecutor`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html) is a good model: its documentation lists `beforeExecute`, `afterExecute` and `terminated` under the heading *Hook methods*, and the first two do nothing unless a subclass overrides them.

**Inverted control.** In the diagram the calls go from the base class down into the subclass: `run()` calls `this.parse(row)`, and `CsvImporter` never drives the import itself. This is inversion of control, also called the Hollywood principle ("don't call us, we'll call you"), and Martin Fowler's [*InversionOfControl*](https://martinfowler.com/bliki/InversionOfControl.html) uses the template method as its simplest example: the superclass owns the flow, and subclasses fill in the steps it calls. Frameworks are extended this way, which is also why a subclass read on its own doesn't tell you when its methods run.

**Protecting the skeleton.** The pattern holds only while subclasses can't change the order, so the template method itself should not be overridable:

- **Java:** declare it `final`. The [Java tutorial](https://docs.oracle.com/javase/tutorial/java/IandI/final.html) suggests `final` for a method whose behaviour must not change because the object's consistency depends on it.
- **C# and Kotlin** make methods non-overridable unless you say otherwise: C# methods are [non-virtual by default](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/virtual), and Kotlin members can't be overridden without [`open`](https://kotlinlang.org/docs/inheritance.html). Mark only the steps `abstract`, `virtual` or `open`.
- **TypeScript** has no `final`. Protect the skeleton by convention (a comment, code review) and by not exposing what shouldn't change: ES private methods such as `#save` can't be called or replaced from a subclass, and `protected` keeps the other steps out of callers' reach, at compile time. With the compiler option [`noImplicitOverride`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-3.html), every override has to be marked `override`, so `run()` can't be overridden by accident, although it still can be on purpose.
- **Python:** [`@typing.final`](https://docs.python.org/3/library/typing.html#typing.final) tells type checkers that a method must not be overridden; nothing checks it at runtime.

## Code

TypeScript that mirrors the diagram. Node 22.18 or later runs it as is (`node importer.ts`): it strips the types without checking them, so use `tsc --noEmit` to catch a subclass that forgets `parse()`. The code also passes with `noImplicitOverride` turned on. A map stands in for the file system, and the `saved` array for the database.

```ts
interface Product { readonly id: number; readonly name: string; readonly price: number }

// Stand-ins for the file system and the database, so the example runs as is.
const files: Record<string, string> = {
  'products.csv': '1001,Mug,12.00\n1002,Lamp,45.00\n1003,,7.50\n1004,Plate,9.90\n1005,Bowl,6.40',
  'products.jsonl': '{"id":2001,"name":"Cup","price":0}\n{"id":2002,"name":"Vase","price":19.5}',
};

// AbstractClass: run() is the template method.
abstract class DataImporter {
  readonly saved: Product[] = [];
  readonly rejected: Product[] = [];
  #text = '';

  // The skeleton. Don't override it: TypeScript has no `final`.
  run(file: string): void {
    this.#open(file);
    const records = this.#readRows().map((row) => this.parse(row));
    for (const rec of records) {
      if (this.validate(rec)) this.#save(rec);
      else this.rejected.push(rec);
    }
    this.#close();
  }

  // Abstract step: every subclass must supply it.
  protected abstract parse(row: string): Product;

  // Hook: a default that a subclass may override.
  protected validate(rec: Product): boolean {
    return rec.name.trim() !== '';
  }

  // Fixed steps: #private, so a subclass can neither call nor replace them.
  #open(file: string): void { this.#text = files[file]; }
  #readRows(): string[] { return this.#text.split('\n'); }
  #save(rec: Product): void { this.saved.push(rec); }
  #close(): void { this.#text = ''; }
}

// ConcreteClasses
class CsvImporter extends DataImporter {
  protected override parse(row: string): Product {
    const [id, name, price] = row.split(',');
    return { id: Number(id), name, price: Number(price) };
  }
}

class JsonImporter extends DataImporter {
  protected override parse(row: string): Product {
    return JSON.parse(row) as Product;
  }
  protected override validate(rec: Product): boolean {
    return super.validate(rec) && rec.price > 0; // keep the default, add a rule
  }
}

const csv = new CsvImporter();
csv.run('products.csv');
console.log(`${csv.saved.length} saved, ${csv.rejected.length} rejected`); // 4 saved, 1 rejected
console.log(csv.rejected.map((r) => r.id));                                 // [ 1003 ]

const json = new JsonImporter();
json.run('products.jsonl');
console.log(json.rejected.map((r) => r.name));                              // [ 'Cup' ] (price 0)
```

Output:

```
4 saved, 1 rejected
[ 1003 ]
[ 'Cup' ]
```

`JsonImporter` reads JSON Lines, one object per row, so the fixed `readRows()` step serves both formats. The second file's `Cup` costs 0, so `JsonImporter`'s hook rejects it; `CsvImporter`, which keeps the default, would have saved it.

## When to use it

- Several classes run the same procedure and differ in a few of its steps, and the order must be the same for all of them: importers and exporters, report generators, the life cycle of a test, a request or a job.
- You are writing a framework or a library base class: the framework keeps the flow and offers abstract steps and hooks as the places where its users plug in.
- Two classes grew by copy and paste, as in step 1, and the shared steps should exist once (see *It is a refactoring* below).
- Not when the variable parts must be chosen at runtime or combined freely (CSV parsing with the stricter JSON validation, say): pass them in as objects or functions instead, which is [Strategy](../strategy/). And not for a single variant, where a plain method is simpler.

## Trade-offs

- **Inheritance couples.** A subclass depends on the base class's protected contract: which steps exist, when they are called and what each may assume. A change to the base class can break subclasses it has never seen, and in a language with single inheritance a class that extends `DataImporter` can extend nothing else.
- **A subclass for every combination.** Two parsers and two validation rules make four subclasses, or a deeper hierarchy, and each variant is fixed when its class is written.
- **Hidden control flow.** Reading `CsvImporter` alone, you can't see when `parse()` runs or what happens to its result; you have to read `run()` in the base class.
- **Overrides can weaken the default.** `JsonImporter.validate()` keeps the name check only because it calls `super.validate(rec)`. Drop that call and nameless products get in again, as in step 1, and the subclass breaks a promise the base class made; Refactoring.Guru warns that suppressing a default step this way can violate the Liskov substitution principle. The implementation notes show a safer shape.
- **In return,** the procedure is written and fixed once, every importer gets a fix to the shared steps at the same moment, and a new format is a small class with one method.

## Implementation notes

- **It is a refactoring.** Going from step 1 to step 2 is Martin Fowler's [*Form Template Method*](https://refactoring.com/catalog/formTemplateMethod.html), from the first edition of *Refactoring* (1999): move each part that differs into a method with the same name and signature in both subclasses, and once the two `run()` methods are identical, pull `run()` up into the base class. The refactoring isn't in the index of the current online catalog, but its page is still there. [*Replace Subclass with Delegate*](https://refactoring.com/catalog/replaceSubclassWithDelegate.html) goes the other way, from a subclass to an object the class delegates to.
- **Keep hooks narrow.** When a subclass has to call `super` to keep the base behaviour, nothing reminds it to. A safer shape keeps `validate()` fixed in the base class and has it call an empty hook after its own check: `validate(rec)` checks the name and then returns `this.extraChecks(rec)`, which returns `true` by default. `JsonImporter` overrides only `extraChecks()`, with `rec.price > 0`, and no subclass can lose the name check.
- **Prefer composition when steps vary on their own.** If the parser and the validation rule vary independently, or have to be chosen per file at runtime, give one importer class its steps as objects or functions: `new Importer({ parse: parseCsv, validate: requirePositivePrice })`. That is [Strategy](../strategy/) applied to the steps, with the skeleton still in one place. Spring's [`JdbcTemplate`](https://docs.spring.io/spring-framework/reference/data-access/jdbc/core.html) is built this way: it runs the fixed JDBC workflow (it creates and releases the resources, creates and runs the statement, iterates over the results and translates exceptions), and the application passes callbacks, such as a `RowMapper` lambda, for the parts that vary. Where functions are values, a template method often becomes a higher-order function that takes its steps as arguments.
- **Keep the hierarchy shallow.** Each level that overrides a step and calls `super` makes the real sequence harder to follow: to know what `run()` does for a `GzipCsvImporter` that extends `CsvImporter`, you read three classes. One abstract base class and one level of concrete classes is the easy case; push further variation into composed objects.
- **Don't call steps from the constructor.** In TypeScript, JavaScript and Java, a base-class constructor that calls an overridden step runs the subclass's code before the subclass's own fields are initialised. Let the client call the template method after construction, as it calls `run()` here.
- **Where it appears.**
  - Java: [`AbstractList`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/AbstractList.html) needs only `get(int)` and `size()` from a subclass to make an unmodifiable list, and builds the rest of the `List` interface on them, iterators included. [`InputStream`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/io/InputStream.html) leaves the one-byte `read()` to subclasses, and its default `read(byte[], int, int)` simply calls `read()` repeatedly; the documentation encourages subclasses to override that one with something faster. `ThreadPoolExecutor`'s hook methods are above.
  - Python: [`unittest.TestCase.run()`](https://docs.python.org/3/library/unittest.html#unittest.TestCase.run) calls `setUp()`, the test method and `tearDown()`. Both fixture methods do nothing by default, and `tearDown()` runs even when the test raised an exception, but only if `setUp()` succeeded. Fowler's bliki entry makes the same point about JUnit's `setUp` and `tearDown`, the framework that inspired `unittest`.
  - Jakarta Servlet: [`HttpServlet`](https://jakarta.ee/specifications/servlet/6.1/apidocs/jakarta.servlet/jakarta/servlet/http/httpservlet)'s `service()` dispatches each request to `doGet`, `doPost` or another `doXxx` method; a servlet overrides the ones it supports, and the documentation says there is almost no reason to override `service()` itself.
- **Relatives.**
  - [Factory Method](../factory-method/): a factory method is often one of the steps of a template method, the step whose job is to create an object, and Refactoring.Guru calls Factory Method a specialisation of Template Method. Overriding it changes what gets created, not the order of the steps.
  - [Strategy](../strategy/): both separate a part that varies from a part that doesn't. Template Method varies *steps* of an algorithm through subclasses, chosen per class when the code is written; Strategy varies the *whole* algorithm through an object that the context holds, chosen per object and swappable at runtime.
  - [Builder](../builder/): its Director runs a fixed sequence of building steps on a builder object it is given, so it is the same idea built by composition.
- **At architecture scale,** a fixed sequence of stages is [Pipes and Filters](../pipes-and-filters/): read, parse, validate and save become separate filters joined by pipes. What changes is that each stage is its own deployable component, which can be scaled, replaced or reused on its own, the order is set by how the pipes are wired rather than by a base class, and the stages share only the data that flows between them.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Strategy](../strategy/) — Put interchangeable algorithms behind one interface and choose one at runtime, instead of branching inside the caller.
- [Factory Method](../factory-method/) — Let subclasses decide which class to create: the base class codes against an interface and calls an overridable create method.
- [Builder](../builder/) — Assemble a complex object step by step and validate it once at the end, instead of calling a constructor with ten arguments.
- [Pipes and Filters](../pipes-and-filters/) — Split processing into independent stages connected by channels.

## References

- [Gamma, Helm, Johnson and Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software (1994)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610)
- [Refactoring.Guru — Template Method](https://refactoring.guru/design-patterns/template-method)
- [Martin Fowler — Form Template Method (refactoring catalog, first edition)](https://refactoring.com/catalog/formTemplateMethod.html)
- [Martin Fowler — InversionOfControl](https://martinfowler.com/bliki/InversionOfControl.html)
- [Java SE 27 API — java.util.AbstractList](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/AbstractList.html)
- [Python documentation — unittest (TestCase, setUp, tearDown)](https://docs.python.org/3/library/unittest.html)
- [Spring Framework reference — Using the JDBC core classes (JdbcTemplate)](https://docs.spring.io/spring-framework/reference/data-access/jdbc/core.html)
- [TypeScript 4.3 release notes — override and the --noImplicitOverride flag](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-3.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
