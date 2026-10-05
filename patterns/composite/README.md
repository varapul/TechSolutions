<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧩 Design Patterns (GoF)](../../README.md#design-patterns-gof)

# Composite

> Treat single objects and groups of objects through one interface, so a whole tree answers a question the way one leaf does.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Composite" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/composite.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Type checks everywhere** | Without a shared interface, the code that walks the tree has to ask what each node is: `usage(n)` returns a **File**'s size, and for a **Folder** it loops over the children and asks the same question of each one. Counting files, finding large files and printing the tree repeat the same `instanceof` branches, so a new kind of node, a **Symlink**, means editing all four functions. |
| **2 · One interface for both** | **Node** (the *Component*) declares `name` and `size()`, and both kinds of node implement it. **File** (a *Leaf*) returns its own size; **Folder** (the *Composite*) keeps its children as `Node[]` and returns the sum of their `size()` calls, without asking which kind each child is: `assets/` calls `logo.png` and `icons/` the same way. The client, the usage report, talks only to `Node`. |
| **3 · One call, the whole tree** | The report makes one call, `project.size()`. Each folder passes it on to its children, each file answers with its own size, and the sums climb back up: icons/ 2 + 2 = 4, src/ 12 + 3 = 15, assets/ 48 + 4 = 52 and project/ 52 + 4 + 15 = **71 KB**. The diagram moves one level at a time; at runtime the calls go depth-first, finishing one child before starting the next, and reach the same totals. |
| **4 · Uniform, with a catch** | A new kind of leaf, **Symlink** (`brand.png → ../logo.png`), implements `Node` and joins `icons/`; `Folder` needs no change. It reports 0 KB because it counts the link, not the file it points to, as `du` does by default; following the link would count `logo.png` twice. The catch is child management: `add(child)` on `Node` keeps every node alike but makes a File refuse it (*transparency*), `add()` only on `Folder` makes clients know the type (*safety*), and either way `add()` must refuse a folder that would end up inside itself. The DOM, AWT's `Container`, React components and compilers' syntax trees are all built this way. |
<!-- END GENERATED: header -->

## The problem

A disk-usage report has to show how much space a project folder takes. The folder holds files and other folders, which hold more files and folders, so the answer comes from walking a tree. If `File` and `Folder` are unrelated classes, the code that walks the tree has to find out what it is holding at every step: return the size if it is a file, or loop over the children and ask again if it is a folder.

That check doesn't stay in one place. Counting files, listing the large ones and printing the tree all walk the same structure, so each repeats the same `instanceof` branches, and each has to know every class that can appear in a folder. When a new kind of entry arrives, such as a symbolic link, every one of those functions needs a new branch. A function that is missed doesn't fail loudly: in JavaScript, `usage()` falls through both branches and returns `undefined`, and the folder's total quietly becomes `NaN`.

## How it works

Composite gives single objects and groups of objects one interface, and lets a group hold any object of that interface, including other groups. Code holding a node can then ask it a question without knowing whether it is one file or a whole tree: a leaf answers for itself, and a group passes the question on to its children and combines their answers. The recursion that every caller used to write now lives in the group's own method, written once. The pattern is one of the structural patterns in *Design Patterns* by Gamma, Helm, Johnson and Vlissides (1994), whose example is a drawing made of lines, rectangles, text and smaller drawings.

| Participant | In the diagram | Role |
|---|---|---|
| **Component** | `Node` | The interface that parts and wholes share, here `name` and `size()`. |
| **Leaf** | `File`, `Symlink` | A node without children. It answers from its own data. |
| **Composite** | `Folder` | Holds children typed as `Node`, passes each request on to them and combines the answers. |
| **Client** | the usage report | Talks only to `Node`, so the same call works on `README.md` and on `project/`. |

The tree in the diagram is made of objects, not classes: `project/`, `assets/`, `src/` and `icons/` are four `Folder` instances, and the six files are `File` instances. What makes the structure recursive is the type of a folder's children, `Node[]` rather than `File[]`: a folder can hold folders, and it never needs to know which kind it is holding.

**Where `add()` goes: transparency or safety.** Every node answers `size()`, but only folders have children, and the book weighs two places for the methods that add and remove them:

- **On `Node` (transparency).** Every node has `add()`, so code that builds or edits the tree never needs to know what it holds, but a leaf has to refuse the call at runtime. The DOM works this way: [`appendChild()`](https://developer.mozilla.org/en-US/docs/Web/API/Node/appendChild) is a method of `Node`, and calling it on a text node throws a `HierarchyRequestError`.
- **On `Folder` only (safety).** A leaf has no `add()` to misuse and the compiler catches the mistake, but code that adds children must hold a `Folder`, so it has to know the type. AWT does this: the `add(Component)` methods are declared on [`java.awt.Container`](https://docs.oracle.com/en/java/javase/27/docs/api/java.desktop/java/awt/Container.html), a `Component` that holds other components, and not on `Component` itself. Swing then made its base class `JComponent` a subclass of `Container`, so any Swing component can hold children.

The book presents the transparent version. The code below takes the safe one: the code that builds the tree knows it is creating folders, and everything that only reads the tree still sees nothing but `Node`.

## Code

TypeScript that mirrors the diagram. Node 22.18 or later runs it as is (`node disk-usage.ts`): it strips the types and doesn't check them, so run `tsc --noEmit` to type-check. Sizes are whole kilobytes, as in the diagram.

```ts
import assert from 'node:assert/strict';

// Component: what every node offers, file or folder.
interface Node {
  readonly name: string;
  size(): number;                 // KB
  contains(n: Node): boolean;     // is n this node, or somewhere inside it?
  lines(depth: number): string[]; // an indented listing
}
const pad = (depth: number): string => '  '.repeat(depth);

// Leaf: a file knows its own size.
class File implements Node {
  readonly name: string;
  private readonly kb: number;
  constructor(name: string, kb: number) { this.name = name; this.kb = kb; }
  size(): number { return this.kb; }
  contains(n: Node): boolean { return n === this; }
  lines(depth: number): string[] { return [`${pad(depth)}${this.name} ${this.kb} KB`]; }
}

// Composite: a folder asks each child and never checks what kind it is.
class Folder implements Node {
  readonly name: string;
  private readonly children: Node[] = [];
  constructor(name: string) { this.name = name; }
  add(...nodes: Node[]): this { // only folders have add(): the "safe" choice
    for (const node of nodes) {
      if (node.contains(this)) throw new Error(`${node.name} already contains ${this.name}`);
      this.children.push(node);
    }
    return this;
  }
  size(): number { return this.children.reduce((kb, c) => kb + c.size(), 0); }
  contains(n: Node): boolean { return n === this || this.children.some((c) => c.contains(n)); }
  lines(depth: number): string[] {
    const own = `${pad(depth)}${this.name} ${this.size()} KB`;
    return [own, ...this.children.flatMap((c) => c.lines(depth + 1))];
  }
}

// A new kind of Leaf. Folder needs no change to hold it.
class Symlink implements Node {
  readonly name: string;
  readonly target: string;
  constructor(name: string, target: string) { this.name = name; this.target = target; }
  size(): number { return 0; } // count the link, not its target (du's default)
  contains(n: Node): boolean { return n === this; }
  lines(depth: number): string[] { return [`${pad(depth)}${this.name} -> ${this.target} 0 KB`]; }
}

const icons = new Folder('icons/').add(new File('home.svg', 2), new File('user.svg', 2));
const assets = new Folder('assets/').add(new File('logo.png', 48), icons);
const src = new Folder('src/').add(new File('app.ts', 12), new File('util.ts', 3));
const project = new Folder('project/').add(assets, new File('README.md', 4), src);

assert.deepEqual([icons.size(), src.size(), assets.size(), project.size()], [4, 15, 52, 71]);

icons.add(new Symlink('brand.png', '../logo.png')); // a new kind of Leaf; Folder is unchanged
assert.equal(project.size(), 71);
assert.throws(() => icons.add(project), /already contains/); // no cycles
console.log(project.lines(0).join('\n'));
```

Output:

```
project/ 71 KB
  assets/ 52 KB
    logo.png 48 KB
    icons/ 4 KB
      home.svg 2 KB
      user.svg 2 KB
      brand.png -> ../logo.png 0 KB
  README.md 4 KB
  src/ 15 KB
    app.ts 12 KB
    util.ts 3 KB
```

`contains()` is a second recursive operation, and `add()` uses it to refuse a node that already holds the folder, which is why `icons.add(project)` throws. `lines()` asks each folder for its `size()`, which sums that folder's subtree again; that is harmless for eleven nodes, and the notes on caching below show what to do for large trees.

## When to use it

- Part–whole hierarchies where one item and a group of items should be handled the same way: files and folders, widgets and panels, shapes and groups of shapes in a drawing tool, sections of a document, menu items and submenus, parts and assemblies in a bill of materials, the nodes of a syntax tree.
- Questions answered by combining the answers of the parts (total size, price, weight, a bounding box, a count) and commands that must reach every part (draw, disable, apply a setting).
- New kinds of node keep arriving while the operations on them stay few.
- Not when the structure isn't recursive: the files of one folder are a list.
- Not when leaves and groups have little in common. One interface for both then fills up with methods that half the classes refuse.
- Not when the kinds of node are fixed and new operations arrive all the time. Each operation then becomes a method in every class (see *Trade-offs*), and a closed union with pattern matching, or Visitor, fits better.

## Trade-offs

- **Simple clients.** The report makes one `size()` call and never branches on types; one file and the whole project go through the same code.
- **New kinds are cheap, new operations are not.** `Symlink` was one class and no edits. A new question, such as the number of files, is a new method on `Node` and in `File`, `Folder` and `Symlink`: the edit of step 1 has moved from the functions into the classes. Visitor is the object-oriented answer to that, and pattern matching the functional one (see *Implementation notes*).
- **An interface that is too general.** Since a folder accepts any `Node`, the types can't express a rule such as "`icons/` holds only images". The book warns that the pattern makes such restrictions hard to state, so they become runtime checks in `add()`.
- **Every answer walks the subtree.** `project.size()` visits every node, every time. Caching the totals makes repeated questions cheap, at the price of invalidating them whenever something changes below.
- **Behaviour is spread out.** The size of the whole tree is the sum of small methods in several classes. Each one is easy to read; following a wrong total through the recursion is harder.

## Implementation notes

- **Prevent cycles.** A folder must never end up inside itself, directly or through one of its subfolders, or every recursive call loops until the stack runs out. `Folder.add()` above refuses a node that already contains the folder. The DOM checks the same thing, and `appendChild()` throws a `HierarchyRequestError` when the new child is an ancestor of the node it is added to; AWT's `Container` throws an `IllegalArgumentException` when the component being added is one of its ancestors.
- **Parent references.** Nodes often need to reach upwards: to build a path such as `project/assets/icons/home.svg`, to pass a request up the tree until something handles it (the way a DOM event bubbles to the ancestors of its target), or to invalidate a cache. The usual design gives each node a `parent` field that only `add()` and `remove()` change, so parents and child lists can't disagree. With parents, the cycle check walks up from the new parent instead of searching the subtree. The DOM's `parentNode` and AWT's `getParent()` are such references.
- **Cache totals and invalidate upwards.** A folder can keep its last total instead of asking all its children every time. Any change below it (a file grows, a child is added or removed) must then clear the cached totals of every ancestor, which needs parent references. AWT does this for layout: [`Component.invalidate()`](https://docs.oracle.com/en/java/javase/27/docs/api/java.desktop/java/awt/Component.html#invalidate()) marks the component and, by default, all its ancestors up to the top-level container as invalid, and the next `validate()` lays them out again.
- **Order of children.** Totals don't depend on the order of the children, but a lot else does: printing, the order of statements in a syntax tree, the order of steps in a macro, and the stacking of widgets (in AWT, the order of a container's child list is its components' front-to-back order). Keep the children in a list when order matters, and decide whether `add()` appends or inserts at a position.
- **Very deep trees.** Every level of recursion takes a stack frame. File systems and user interfaces are usually shallow, but generated or degenerate trees, such as a long chain of nested folders, can exhaust the stack, and JavaScript engines then throw a `RangeError` in Chrome and Safari or an `InternalError` in Firefox ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Too_much_recursion)). For trees of unbounded depth, walk with an explicit stack: push the root, then repeatedly pop a node, add its own size and push its children. That needs a way to list children through `Node` (an empty list for a leaf), a small step towards transparency.
- **Sharing leaves.** Nothing in `add()` stops the same `File` object from being added to two folders. The structure is then a graph rather than a tree: totals count the shared leaf once per parent, and a single `parent` field can't describe it. Sharing can be deliberate: Flyweight shares immutable objects (one object per character code in a text editor) to save memory, and the book notes that sharing clashes with giving each component a reference to its one parent. File systems meet the same question with hard links: GNU `du` counts a file that has several hard links only once, unless asked to count every link.
- **Symbolic links.** `Symlink.size()` returns 0: it counts the link, not the file it points to. Following links instead would count `logo.png` twice, and a link to an ancestor folder would loop forever without a record of the folders already visited. GNU [`du`](https://www.gnu.org/software/coreutils/manual/html_node/du-invocation.html) doesn't follow symbolic links by default; `-L` makes it follow them.
- **Building, walking and extending trees.**
  - [Builder](../builder/) often produces a composite, such as a document, a user interface or a syntax tree, and the chained `add()` calls above are a small step in that direction.
  - [Iterator](../iterator/) walks a composite one node at a time without exposing the children's lists. In TypeScript a recursive generator does it, `*walk() { yield this; for (const c of this.children) yield* c.walk(); }` on `Folder` and `*walk() { yield this; }` on the leaves, and `for (const n of project.walk())` then visits every node.
  - Visitor moves operations such as `size()`, `count()` and `print()` out of the node classes into one visitor object per operation, which makes a new operation cheap and a new kind of node expensive: the reverse of plain Composite.
  - [Command](../command/) uses Composite for macros: a macro is a command that holds commands, runs them in order and undoes them in reverse, and the history treats it as one step.
- **Relatives.**
  - [Decorator](../decorator/) has the same recursive shape, an object that implements an interface and holds an object of that interface, but with exactly one child. A decorator adds behaviour around the call it passes on; a composite exists to combine the answers of many children. The two are often used together, and the book notes that they then usually share a base class.
  - Interpreter represents a sentence of a small language as a syntax tree, a composite whose operation is `evaluate()`.
  - [Chain of Responsibility](../chain-of-responsibility/) often follows a composite's parent references: a request that a node can't handle goes to its parent, and then to the parent's parent.
- **With sum types.** The type checks of step 1 aren't always wrong. When the set of node kinds is closed, a discriminated union with pattern matching makes that style safe, because the compiler lists every function that misses a newly added kind: TypeScript does it with [exhaustiveness checking](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking) against `never`, and Java 21 with sealed interfaces and [pattern matching for `switch`](https://openjdk.org/jeps/441). That reverses the trade-off: a new operation is one new function, and a new kind is an edit in many places that the compiler points out. Composite remains the better fit when new kinds of node arrive more often than new operations, or come from plug-ins that the core code can't list.
- **Where it appears.**
  - The DOM: every object in a document is a [`Node`](https://developer.mozilla.org/en-US/docs/Web/API/Node). Elements, documents and document fragments can have children and text nodes can't, and scripts read and change the whole tree through `Node`'s `childNodes`, `parentNode` and `appendChild()`.
  - Java's AWT and Swing: a `Container` is a `Component` that holds `Component`s, so a window, a panel and a button are laid out and painted through one interface.
  - React: a user interface is a hierarchy of components that render other components as their children. [Thinking in React](https://react.dev/learn/thinking-in-react) starts by drawing that hierarchy, and data flows down it from parent to child.
  - Compilers and linters: every node class in Python's [`ast`](https://docs.python.org/3/library/ast.html) module derives from `ast.AST`, and `ast.NodeVisitor` walks the tree and calls a method for each kind of node, a Visitor over a Composite.
- **At architecture scale.** The same shape appears when the nodes are services. [Gateway Aggregation](../gateway-aggregation/) is a composite one level deep: a gateway passes one request to several services and merges their answers. Analytics engines stack more levels: Google's Dremel ([VLDB 2010](https://research.google/pubs/dremel-interactive-analysis-of-web-scale-datasets-2/)) runs a query on a tree of servers, where a root server passes it down through intermediate servers to the leaf servers that scan the data, and each level aggregates the replies from the level below. Three things change at that scale. Children are called in parallel, so a level takes as long as its slowest child rather than the sum of all of them. A child can fail or time out, so a parent must choose between an error and a partial answer. And only operations whose partial results combine, such as sums, counts and maximums, can be split up this way: an average has to travel up as a sum and a count.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Decorator](../decorator/) — Wrap an object to add behaviour at runtime, stacking wrappers instead of multiplying subclasses for every combination.
- [Iterator](../iterator/) — Walk a collection one element at a time without exposing how it is stored: an array, a tree or a stream that never ends.
- [Visitor](../visitor/) — Add new operations to a stable set of classes without editing them: each operation is a visitor that every element accepts.
- [Chain of Responsibility](../chain-of-responsibility/) — Pass a request along a chain of handlers until one handles it, so the sender never needs to know which one will.
- [Builder](../builder/) — Assemble a complex object step by step and validate it once at the end, instead of calling a constructor with ten arguments.
- [Command](../command/) — Turn a request into an object that can be queued, logged, undone and redone, decoupling who asks from who acts.
- [Flyweight](../flyweight/) — Share the common, immutable part of many similar objects and keep only what differs in each one, to cut memory.
- [Interpreter](../interpreter/) — Represent a small language's grammar as classes and evaluate a sentence by walking its syntax tree.
- [Gateway Aggregation](../gateway-aggregation/) — Fan one client request out to several services and merge the answers into one response.

## References

- [Gamma, Helm, Johnson and Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software (1994)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610)
- [Refactoring.Guru — Composite](https://refactoring.guru/design-patterns/composite)
- [MDN — Node (Web APIs)](https://developer.mozilla.org/en-US/docs/Web/API/Node)
- [MDN — Node: appendChild() method](https://developer.mozilla.org/en-US/docs/Web/API/Node/appendChild)
- [Java SE 27 API — java.awt.Container](https://docs.oracle.com/en/java/javase/27/docs/api/java.desktop/java/awt/Container.html)
- [React documentation — Thinking in React](https://react.dev/learn/thinking-in-react)
- [GNU Coreutils manual — du invocation](https://www.gnu.org/software/coreutils/manual/html_node/du-invocation.html)
- [Melnik et al. — Dremel: Interactive Analysis of Web-Scale Datasets (VLDB 2010)](https://research.google/pubs/dremel-interactive-analysis-of-web-scale-datasets-2/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
