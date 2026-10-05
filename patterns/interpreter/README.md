<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧩 Design Patterns (GoF)](../../README.md#design-patterns-gof)

# Interpreter

> Represent a small language's grammar as classes and evaluate a sentence by walking its syntax tree.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Interpreter" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/interpreter.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Rules frozen in code** | The targeting for the `new-checkout` flag is nested `if`s in `FlagService.isEnabled()`: Thailand, and either the pro plan or more than ten seats. When Marketing asks to add Malaysia and teams over five seats, a developer edits the code, and the change goes through review, CI and a deploy like any release. When Sales asks for a rule just for Acme there is nowhere to put it: the same `if`s run for every customer. |
| **2 · Grammar as classes** | The rule becomes text in a tiny language, `country = 'TH' and (plan = 'pro' or seats > 10)`, and each construct of its grammar becomes a class that implements **Expr** (the *AbstractExpression*): the comparisons **Equals** and **GreaterThan** are *TerminalExpressions*, and **And** and **Or**, which hold other expressions, are *NonterminalExpressions*; parentheses only group, so they need no class. Parsing is a separate step: when the rule is saved, a parser turns the text into a tree of these objects once, leaves first, and **FlagService** (the *Client*) keeps its root. Each account's attributes become the **Context** that the tree is evaluated against. |
| **3 · Evaluate against a context** | FlagService calls `rule.interpret(ctx)` with account #1's attributes (TH, free plan, 12 seats). **And** asks its left child first: `Equals(country, 'TH')` returns true, so And asks **Or**, whose `Equals(plan, 'pro')` returns false and `GreaterThan(seats, 10)` true, so Or and then And return **true**. Account #2 has 5 seats, so GreaterThan, Or and And return **false**; for account #3 (JP) the first Equals is already false, and And returns **false** without asking Or at all. |
| **4 · Small languages only** | Changing the rule is now a text edit that goes live without a deploy, and each customer can have a rule of its own. The pattern suits a small, stable grammar: each new construct is another class plus a parser change, bigger languages need a real parser and are usually compiled to closures or bytecode, and rules that users write must never reach `eval()`, only an interpreter with limits on nesting, size and run time. Feature-flag targeting ([Feature Flags](../feature-flags/)), policy languages such as OPA's Rego ([Policy-Based Authorization](../policy-based-authorization/)), CEL in Kubernetes and Envoy, regex engines and SQL `WHERE` clauses are interpreters too; the tree is a [Composite](../composite/), and further operations over it fit [Visitor](../visitor/). |
<!-- END GENERATED: header -->

## The problem

A feature flag, `new-checkout`, should be on for some accounts and off for the rest. The first version of its targeting is code: `FlagService.isEnabled()` checks that the account is in Thailand and either on the pro plan or with more than ten seats, in nested `if`s next to similar blocks for every other flag.

That works until the rules start to move. Marketing wants Malaysia added and the seat threshold lowered, and each such change is a code edit that goes through review, CI and a deploy, so the people who own the rule wait for a release. Sales wants a different rule for one customer, Acme, and there is nowhere to put it: one `if` serves every customer, and a rule per customer would mean a branch per customer inside the service. Moving the values into configuration, with fields such as `countries` and `minSeats`, helps only until someone needs a combination that the fields can't express, such as an `or` inside an `and`.

What the team needs is a small language for targeting: rules written as text that is stored with the flag, edited without a deploy, kept per customer if need be, and evaluated by the service for each account.

## How it works

Interpreter gives each construct of a small language its own class. A sentence of the language, here one targeting rule, becomes a tree of objects of those classes, and evaluating the sentence means asking the root of the tree to interpret itself against a context: each inner node asks its children and combines their answers, and the leaves read what they need from the context. Gamma, Helm, Johnson and Vlissides describe it among the behavioural patterns in *Design Patterns* (1994). Their running example is regular expressions, and their sample code evaluates Boolean expressions whose variables are looked up in a context, much as the rule here does.

| Participant | In the diagram | Role |
|---|---|---|
| **AbstractExpression** | `Expr` | Declares `interpret(ctx)`, the one operation that every node of the tree implements. |
| **TerminalExpression** | `Equals`, `GreaterThan` | A leaf. It compares one attribute of the context with a literal and holds no other expression. |
| **NonterminalExpression** | `And`, `Or` | A construct built from other expressions. It holds its operands as `Expr`, interprets them and combines the results. |
| **Context** | an account's attributes | What a sentence is evaluated against, passed down the tree: here `country`, `plan` and `seats`. |
| **Client** | `FlagService` | Gets the tree for a rule (it parses the text once) and calls `interpret(ctx)` on its root for every check. |

**Terminal and nonterminal expressions.** The names come from grammars, where a terminal symbol is not broken down any further and a nonterminal is defined in terms of other symbols. In the tree, terminal expressions are the leaves and nonterminal expressions are the inner nodes. A comparison is a leaf here even though it has three parts, because those parts are a name and a literal, not further expressions. A new leaf such as `In(country, ['TH', 'MY'])` or a new inner node such as `Not` is one more class.

**From grammar to classes.** The grammar in the diagram has three rules because it encodes precedence: `and` binds tighter than `or`, so an `expr` is a list of `term`s joined by `or`, and a `term` is a list of `factor`s joined by `and`. The tree has no nodes for `expr`, `term` or `factor`, only one class per operation: `or` becomes `Or`, `and` becomes `And`, and a comparison becomes `Equals` or `GreaterThan`. The parentheses decide the shape of the tree and then disappear. That is the difference between a parse tree, which follows the grammar exactly, and the abstract syntax tree that the pattern evaluates.

**The context.** Everything a rule reads comes from the context, which is what makes one tree reusable: the diagram evaluates the same tree for three accounts. Here the context is a read-only map of an account's attributes, much like OpenFeature's [evaluation context](https://openfeature.dev/specification/sections/evaluation-context/), the data that flag evaluation can use for targeting. In other interpreters it also holds variables that expressions assign, the current time, a counter that enforces a cost limit, or a record of which nodes decided the result, so that a decision can be explained.

**Parsing is a separate concern.** The pattern describes how to represent and evaluate a sentence, not how to get from text to the tree, and the book leaves parsing aside. There are three usual ways to build the tree:

- In code, through constructors or a small builder API, when developers write the rules themselves (an internal DSL).
- With a hand-written recursive-descent parser: one function per grammar rule, each calling the functions of the rules it contains. For a grammar like this one that is a few dozen lines, as the code below shows, and *Crafting Interpreters* builds one step by step in [Parsing Expressions](https://craftinginterpreters.com/parsing-expressions.html).
- With a parser generator such as [ANTLR](https://www.antlr.org/), which produces the parser from the grammar and pays off once the grammar grows.

Some systems skip the text and store the tree itself: a [JsonLogic](https://jsonlogic.com/) rule is a JSON tree of operators that is evaluated directly, and flagd writes its targeting rules in a modified JsonLogic. Either way, parse once, when the rule is saved, and keep the tree. Syntax errors then reach the person editing the rule instead of failing requests, and each check pays only for the walk.

## Code

TypeScript that mirrors the diagram. Node 22.18 or later runs it as is (`node targeting.ts`): it strips the types and doesn't check them, so run `tsc --noEmit` to type-check.

```ts
import assert from 'node:assert/strict';

type Context = Record<string, string | number>;     // Context: the account's attributes
interface Expr { interpret(ctx: Context): boolean; } // AbstractExpression: any node of the tree

// TerminalExpressions: compare one attribute of the context with a literal.
class Equals implements Expr {
  readonly name: string; readonly value: string | number;
  constructor(name: string, value: string | number) { this.name = name; this.value = value; }
  interpret(ctx: Context) { return ctx[this.name] === this.value; }
}
class GreaterThan implements Expr {
  readonly name: string; readonly limit: number;
  constructor(name: string, limit: number) { this.name = name; this.limit = limit; }
  interpret(ctx: Context) { const v = ctx[this.name]; return typeof v === 'number' && v > this.limit; }
}
// NonterminalExpressions: ask their children, left first, and combine the answers.
abstract class Binary implements Expr {
  readonly left: Expr; readonly right: Expr;
  constructor(left: Expr, right: Expr) { this.left = left; this.right = right; }
  abstract interpret(ctx: Context): boolean;
}
class And extends Binary {
  interpret(ctx: Context) { return this.left.interpret(ctx) && this.right.interpret(ctx); }
}
class Or extends Binary {
  interpret(ctx: Context) { return this.left.interpret(ctx) || this.right.interpret(ctx); }
}

// Parsing is a separate step: recursive descent, one function per grammar rule.
function parse(text: string): Expr {
  const tokens = [...text.matchAll(/'[^']*'|\d+|\w+|\S/g)]; // strings, numbers, words, symbols
  let pos = 0;
  const peek = () => tokens[pos]?.[0];
  const fail = (msg: string, at = pos): never => {
    throw new SyntaxError(`${msg} at column ${(tokens[at]?.index ?? text.length) + 1}`);
  };
  const next = (want?: string): string => {
    const t = peek();
    if (t === undefined || (want && t !== want)) return fail(`expected ${want ?? 'more'}`);
    pos++; return t;
  };
  const expr = (): Expr => { // expr := term ('or' term)*
    let e = term(); while (peek() === 'or') { next(); e = new Or(e, term()); } return e;
  };
  const term = (): Expr => { // term := factor ('and' factor)*
    let e = factor(); while (peek() === 'and') { next(); e = new And(e, factor()); } return e;
  };
  const factor = (): Expr => { // factor := comparison | '(' expr ')'
    if (peek() === '(') { next(); const e = expr(); next(')'); return e; }
    const name = next(), op = next(), lit = next();
    const value = /^'.*'$/.test(lit) ? lit.slice(1, -1) : /^\d+$/.test(lit) ? Number(lit) : null;
    if (op === '=' && value !== null) return new Equals(name, value);
    if (op === '>' && typeof value === 'number') return new GreaterThan(name, value);
    return fail(`can't read ${name} ${op} ${lit}`, pos - 3);
  };
  const tree = expr();
  if (pos < tokens.length) fail(`unexpected ${peek()}`);
  return tree;
}

// Client: parse once when the rule is saved, then interpret the tree for every check.
const rule = parse("country = 'TH' and (plan = 'pro' or seats > 10)");
assert.deepEqual(rule, new And(new Equals('country', 'TH'),
  new Or(new Equals('plan', 'pro'), new GreaterThan('seats', 10))));
const accounts = [
  { country: 'TH', plan: 'free', seats: 12 },
  { country: 'TH', plan: 'free', seats: 5 },
  { country: 'JP', plan: 'pro', seats: 50 }, // And stops at the first false: Or never runs
];
assert.deepEqual(accounts.map((ctx) => rule.interpret(ctx)), [true, false, false]);
assert.throws(() => parse("country = 'TH' and (plan = 'pro'"), /expected \) at column 33/);
for (const ctx of accounts) console.log(JSON.stringify(ctx), '->', rule.interpret(ctx));
// {"country":"TH","plan":"free","seats":12} -> true
// {"country":"TH","plan":"free","seats":5} -> false
// {"country":"JP","plan":"pro","seats":50} -> false
```

`expr()`, `term()` and `factor()` are the three grammar rules, and the order in which they call each other is what makes `and` bind tighter than `or`. Because each function returns only after its operands are built, the leaves are created before the nodes that hold them, which is the order the diagram shows. The parser refuses what it can't read rather than guessing: `plan = pro` without quotes and `seats > ten` both fail with a column number, where a looser parser would build an `Equals` that silently never matches.

## When to use it

- Rules that change more often than the code that runs them, or that differ per customer, tenant or region: targeting and segmentation, pricing and discount conditions, alerting and routing rules, validation rules, search filters, access policies.
- Rules that people other than the service's developers read or edit, or that must be stored, versioned and audited as data.
- A grammar that is small and settles quickly, where evaluation speed is not critical: walking a tree of a few nodes per request is cheap.
- Not for big languages. A general-purpose language or full SQL needs a real parser, usually generated, and an evaluator that compiles the tree into something faster to run (see *Implementation notes*).
- Not when an established expression language fits. CEL, Rego or JsonLogic come with documentation, tools, tests and safety properties that a home-grown language has to earn.
- Not when a few fixed options are enough: if every rule is a list of countries and a minimum number of seats, a configuration schema is simpler than a language.

## Trade-offs

- **The language is easy to extend.** A new operator is one class plus a change to the parser, and the existing classes stay as they are.
- **The code is easy to follow.** Each class matches one construct, and its `interpret()` is a line or two.
- **New operations are expensive.** Evaluation is a method in every node class, and so is every further operation: printing a rule back as text, explaining a decision, listing the attributes a rule reads, checking types, or translating a rule into a SQL query. Visitor moves such operations out of the node classes (see *Implementation notes*).
- **Walking a tree is slow.** Each node costs a virtual call, and the nodes are separate objects scattered over the heap. That is fine for a targeting rule and too slow for a general-purpose language.
- **Big grammars are hard to maintain.** A class per construct grows into a large hierarchy, and the book itself points to parser generators and similar tools once a grammar gets complex.
- **A language is a product.** Its users need documentation, clear error messages and stable meaning, and rules saved under one version of the grammar must keep working after the next change.

## Implementation notes

- **Error reporting.** Two kinds of error need different handling.
  - *Syntax errors* happen when a rule is saved. Report where the problem is and what was expected (the parser above says `expected ) at column 33`), and refuse to store the rule.
  - *Evaluation problems* happen during a check: an attribute that the context lacks, or a value of the wrong type, such as `seats > 'ten'`. Decide what they mean, false or an error, and make every node agree. Better still, check each rule against a schema of the known attributes and their types when it is saved. Kubernetes does this for CEL: the validation rules of a custom resource definition are fully type-checked, and an expression that names an undefined field of a typed variable fails the check.
- **Performance: walk, closures or bytecode.** Walking the tree is the simplest evaluator, and it is enough for small rules. The book's own example makes the point that it is rarely the fastest: a regular expression is usually matched by a state machine built from it, not by walking its tree. Two common ways to translate a tree before running it:
  - *Closures.* Walk the tree once and turn each node into a function that calls its children's functions, `(ctx) => left(ctx) && right(ctx)` for `And`. A check then runs plain function calls, and work such as looking up attribute names can happen once, at compile time.
  - *Bytecode.* Flatten the tree into an array of simple instructions and run them in a loop. [PostgreSQL](https://github.com/postgres/postgres/blob/master/src/backend/executor/README) evaluates expressions, such as a `WHERE` clause, from a flat array of steps instead of walking the expression tree, because the work per node is small next to the cost of the walk, and the same steps can be [JIT-compiled](https://www.postgresql.org/docs/current/jit-reason.html) to native code. [SQLite](https://www.sqlite.org/opcode.html) compiles every SQL statement into bytecode for its own virtual machine. Spring's expression language, SpEL, interprets expressions by default and can be configured to [compile](https://docs.spring.io/spring-framework/reference/core/expressions/evaluation.html) an expression into a generated Java class once it has run in interpreted mode.

  *Crafting Interpreters* builds both kinds: a tree-walking interpreter in Java, then a bytecode virtual machine in C. Its chapter [Chunks of Bytecode](https://craftinginterpreters.com/chunks-of-bytecode.html) explains why the tree walker is slow, down to the pointers between heap objects that defeat the CPU cache.
- **Short-circuiting and order.** `And` and `Or` evaluate their left operand first and stop as soon as the result is known, so the account in Japan never reaches the `Or` branch. Put cheap or selective conditions first, and keep expressions free of side effects so that the order only ever changes the speed, never the result.
- **Safety when users write rules.**
  - Never turn a rule into host-language code and run it with `eval()` or `new Function()`. The rule would run with every privilege of the service, which is why MDN's page on [`eval()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/eval) warns against using it. An interpreter can only do what its classes do: a rule can compare attributes, but it can't read a file or call a network service. JsonLogic makes this its selling point: rules never pass through `eval()`, and they can only read the data they are given.
  - Bound what a rule can cost. The recursive-descent parser and the recursive `interpret()` both use a stack frame per level of nesting, so cap the nesting depth, the length of the text and the number of nodes. Anything that is not linear needs its own bound: loops over lists, and regular expressions, which should go to an engine with linear-time matching such as RE2, the engine whose syntax CEL's `matches()` uses.
  - CEL was designed for untrusted expressions: the project describes it as not Turing-complete, free of mutation and linear in evaluation time, and it reads only the data that the host application provides. Kubernetes adds a [runtime cost budget](https://kubernetes.io/docs/reference/using-api/cel/) that halts an expression which runs too long, and for some resources it rejects an expression when it is written if its estimated worst case would be too expensive.
- **Sharing nodes.** The nodes are immutable, so identical subtrees can be shared: one `Equals('country', 'TH')` object can serve every rule that contains that comparison. The book suggests [Flyweight](../flyweight/) for sharing terminal symbols this way.
- **Walking without evaluating.** Some questions need every node but no evaluation, such as which attributes a rule reads, so that the service knows what to put into the context or can warn about a rule that names an attribute that doesn't exist. An [Iterator](../iterator/) over the tree answers them, and in TypeScript a recursive generator over the children is enough.
- **Interpreter, Composite and Visitor.**
  - The syntax tree is a [Composite](../composite/): `And` and `Or` hold their children through the same interface that the leaves implement. Composite is about the shape, parts and wholes handled alike; Interpreter gives that shape a meaning, a language whose sentences are evaluated.
  - In Interpreter, evaluation is a method on each node class. [Visitor](../visitor/) moves operations into separate classes, one per operation, with a method for each kind of node, so a new operation (printing, explaining, translating to SQL) is one new class, while a new kind of node becomes an edit to every visitor. [*Crafting Interpreters*](https://craftinginterpreters.com/representing-code.html) weighs exactly this choice and turns the Interpreter pattern down: its tree classes serve several stages, from the parser to the interpreter, and a method per stage on every class would tangle them, so it uses Visitor instead.
  - Where functions are values, a node can simply be a closure. With a discriminated union and one `switch` per operation, a tree gets the same trade-off as with Visitor: a new operation is one function, and a new kind of node is an edit to every function.
- **At architecture scale.** Keeping rules as data and an interpreter in every service is how [Feature Flags](../feature-flags/) and [Policy-Based Authorization](../policy-based-authorization/) work. A flag service stores targeting rules and sends them to SDKs that evaluate them in process against an evaluation context; [flagd](https://flagd.dev/reference/flag-definitions/), for example, writes them in a modified JsonLogic. A policy engine evaluates policies against the attributes of a request, as Open Policy Agent does with Rego, which it can also compile to [WebAssembly](https://www.openpolicyagent.org/docs/wasm). Three things change at that scale:
  - Rules become deployable artifacts: versioned, tested, rolled out and rolled back, and every decision should record the version of the rule that made it.
  - Several implementations must agree. An SDK in each language carries its own interpreter of the same language, so the language needs a precise specification and shared tests; CEL publishes [conformance tests](https://github.com/cel-expr/cel-spec/tree/master/tests) that its implementations are expected to pass.
  - Evaluation moves next to the caller to stay within its latency budget, one more reason to keep the language small and its cost bounded.
- **Where it appears.**
  - Regular expressions, the book's own example. Java's `java.util.regex.Pattern` compiles a pattern into a graph of [`Node` objects](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/regex/Pattern.java), each with its own `match()` method, which is Interpreter almost exactly; Python's `re` compiles a pattern into a [list of opcodes](https://github.com/python/cpython/blob/main/Lib/re/_compiler.py) for its matching engine, which is written in C.
  - Spring's SpEL, whose syntax tree has classes such as [`OpAnd`](https://github.com/spring-projects/spring-framework/blob/main/spring-expression/src/main/java/org/springframework/expression/spel/ast/OpAnd.java), `OpOr`, `OpEQ` and `OpGT` that each evaluate themselves against an `ExpressionState`, its context. `OpAnd` returns false without evaluating its right operand when the left one is false.
  - CEL ([cel.dev](https://cel.dev/)), in [Kubernetes](https://kubernetes.io/docs/reference/using-api/cel/) validation rules and admission policies, and in [Envoy](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/advanced/attributes), which exposes request attributes to CEL expressions in its RBAC filter.
  - Rego, the [policy language](https://www.openpolicyagent.org/docs/policy-language) of Open Policy Agent, which was inspired by Datalog.
  - SQL `WHERE` clauses, which databases such as PostgreSQL and SQLite evaluate with interpreters of their own, as described above.
- **Further reading.** [*Crafting Interpreters*](https://craftinginterpreters.com/) by Robert Nystrom, free to read online, builds a scripting language twice, first as a tree-walking interpreter and then as a bytecode virtual machine. Martin Fowler and Rebecca Parsons' [*Domain-Specific Languages*](https://martinfowler.com/books/dsl.html) covers how to build both internal and external DSLs and how to choose between them.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Composite](../composite/) — Treat single objects and groups of objects through one interface, so a whole tree answers a question the way one leaf does.
- [Visitor](../visitor/) — Add new operations to a stable set of classes without editing them: each operation is a visitor that every element accepts.
- [Flyweight](../flyweight/) — Share the common, immutable part of many similar objects and keep only what differs in each one, to cut memory.
- [Iterator](../iterator/) — Walk a collection one element at a time without exposing how it is stored: an array, a tree or a stream that never ends.
- [Feature Flags](../feature-flags/) — Deploy code dark, then turn features on per user or percentage at runtime.
- [Policy-Based Authorization](../policy-based-authorization/) — Services ask a central policy engine for allow/deny decisions (RBAC, ABAC, ReBAC).

## References

- [Gamma, Helm, Johnson and Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software (1994)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610)
- [Robert Nystrom — Crafting Interpreters (free online)](https://craftinginterpreters.com/)
- [Crafting Interpreters — Representing Code](https://craftinginterpreters.com/representing-code.html)
- [cel-expr/cel-spec — Common Expression Language specification](https://github.com/cel-expr/cel-spec)
- [Kubernetes documentation — Common Expression Language in Kubernetes](https://kubernetes.io/docs/reference/using-api/cel/)
- [Envoy documentation — Attributes](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/advanced/attributes)
- [Open Policy Agent documentation — Policy Language](https://www.openpolicyagent.org/docs/policy-language)
- [flagd documentation — Definition Overview (targeting rules)](https://flagd.dev/reference/flag-definitions/)
- [Spring Framework reference — Evaluation (Spring Expression Language)](https://docs.spring.io/spring-framework/reference/core/expressions/evaluation.html)
- [PostgreSQL documentation — What Is JIT compilation?](https://www.postgresql.org/docs/current/jit-reason.html)
- [SQLite — The SQLite Bytecode Engine](https://www.sqlite.org/opcode.html)
- [MDN — eval()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/eval)
- [Martin Fowler with Rebecca Parsons — Domain-Specific Languages (2010)](https://martinfowler.com/books/dsl.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
