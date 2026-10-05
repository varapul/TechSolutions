<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧩 Design Patterns (GoF)](../../README.md#design-patterns-gof)

# Flyweight

> Share the common, immutable part of many similar objects and keep only what differs in each one, to cut memory.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Flyweight" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/flyweight.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Every Tree holds it all** | The map draws 100,000 street trees of 5 species, and each marker is a full `Tree` object: its own `x` and `y`, plus the species' name, colour and a fresh copy of its 2 KB icon. At 2,048 bytes for the icon and 24 bytes for the position and a reference, that is 100,000 × 2,072 bytes ≈ **207.2 MB**, and 98.8% of it is the same five icons, copied. |
| **2 · Split shared from unique** | What is the same for every oak (name, colour, icon) is **intrinsic** state: it moves into an immutable `TreeType`, the *Flyweight*. What differs from marker to marker, `x` and `y`, is **extrinsic** state and stays in each `Tree` (the *Context*), next to a reference to its type. A `TreeFactory` (the *FlyweightFactory*) keeps a map from species to `TreeType`, returns the one it already has and creates each type only once. |
| **3 · Plant 100,000, create 5** | Planting calls `factory.get(species)` for every marker. The first oak misses, so the factory creates the Oak `TreeType` and keeps it; the second oak gets the same object back, and once all five species exist the map stops growing: 99,995 of the 100,000 calls return a type that already exists. Drawing passes the extrinsic state in, as `type.draw(canvas, x, y)`, and memory falls to 5 × 2,048 + 100,000 × 24 bytes ≈ **2.41 MB**, 86 times less. |
| **4 · Rules, and where it hides** | Every oak shares one object, so `oak.colour = 'red'` recolours every oak on the map: a flyweight has to be immutable. Compare flyweights by value unless the factory guarantees one object per value, and give the factory a policy for types nobody uses any more, such as eviction or weak references. The same sharing is behind Java's `Integer.valueOf()` cache and `String.intern()`, Python's `sys.intern()`, one glyph object per character in text layout, GPU instanced drawing such as WebGL's `drawArraysInstanced()`, and the image layers that containers on one host share. |
<!-- END GENERATED: header -->

## The problem

A city map shows its 100,000 street trees. There are only five species (oak, maple, plane, birch and pine), and each species has a name, a colour and a 2 KB icon. The obvious model makes every marker a complete object, `new Tree(x, y, species, colourOf(species), loadIcon(species))`, and so every marker carries its own copy of its species' icon.

Count 2,048 bytes for the icon and 24 bytes for the position and a reference, and the markers take 100,000 × 2,072 bytes ≈ 207.2 MB (1 MB = 10⁶ bytes here; object headers and the short name and colour strings are left out, so the real figure is higher). Only five icons are actually different, so 98.8% of that memory holds copies. Nothing in the code is wrong. It just stores five pictures 100,000 times over, and on a phone or in a browser tab that can decide whether the map opens at all.

## How it works

Flyweight splits each object's state in two. The part that many objects have in common moves into a few shared objects that never change. The part that belongs to one object stays outside them and is handed in whenever a shared object needs it. A factory makes sure there is exactly one shared object for each distinct value. The pattern is one of the 23 in *Design Patterns* by Gamma, Helm, Johnson and Vlissides (1994), but the name is older: Paul Calder and Mark Linton's 1990 paper *Glyphs: Flyweight Objects for User Interfaces* (UIST '90) explored sharing glyph objects in a WYSIWYG document editor.

- **Intrinsic state** is what makes an oak an oak: its name, colour and icon. It doesn't depend on where the tree stands, so every oak can use the same object.
- **Extrinsic state** depends on the context: this tree's `x` and `y`. It can't be shared, so it stays with the client and is passed in as arguments, as in `type.draw(canvas, x, y)`.

| Participant | In the diagram | Role |
|---|---|---|
| **Flyweight** | `draw(canvas, x, y)` on `TreeType` | The interface through which a shared object receives the extrinsic state. With a single kind of flyweight, as here, it needs no separate interface type. |
| **ConcreteFlyweight** | `TreeType`: the Plane, Oak, Maple, Birch and Pine objects | Stores the intrinsic state and is shared, so it must not change. |
| **UnsharedConcreteFlyweight** | not drawn | Implements the same interface but is not shared: a heritage tree with its own photo and plaque, say. |
| **FlyweightFactory** | `TreeFactory` | Owns the pool, here a `Map` from species to `TreeType`, and returns the existing object or creates it. |
| **Client** | the city map | Plants and draws the trees. It keeps the references to flyweights and stores or computes their extrinsic state, here inside `Tree` objects. |
| **Context** | `Tree` | Not one of the book's participants. Many modern write-ups, Refactoring.Guru's among them, give the extrinsic state a small class of its own that pairs it with the flyweight reference; a context and its flyweight together carry the full state of the original object. Refactoring.Guru's example is a similar forest of `Tree`, `TreeType` and a factory. |

**Finding the split.** Count the distinct values of each field across all the objects. A field with a handful of distinct values (5 species) is a candidate for intrinsic state; a field that differs on nearly every object (position) is extrinsic. A heap snapshot full of equal arrays or strings points the same way. Then ask two questions of each candidate: does it depend on where or how the object is used (then it is extrinsic), and will anyone ever need to change it for one object alone (then it can't be shared)? Extrinsic state doesn't always need storing: a text layout can work out each glyph's position while it lays out the line.

**The factory.** `get(species)` looks the species up in its map and returns the `TreeType` it finds, or creates one, stores it and returns it. Clients never call `new TreeType()` themselves; if they did, two oaks could end up with two Oak objects and the sharing would quietly erode. In the diagram, 100,000 calls to `get()` create five objects, and the other 99,995 calls return one that already exists.

**Immutability is the precondition.** A shared object is part of every object that refers to it. If one marker could recolour its Oak, every oak on the map would change, which is what step 4 shows. Make the intrinsic fields read-only, freeze the object, and treat "this tree looks different" as "this tree has a different type": a new key such as `'Oak (diseased)'`, or, if colour really varies from tree to tree, extrinsic state.

**The arithmetic.** Before, 100,000 × (2,048 + 24) bytes ≈ 207.2 MB. After, 5 × 2,048 + 100,000 × 24 bytes ≈ 2.41 MB, about 86 times less. The saving is roughly the number of objects times the size of the shared state, minus one copy per distinct flyweight. Notice what is left: 2.40 of the 2.41 MB is the per-marker part (`x`, `y` and the reference), so after sharing, that is what to keep small, or to compute instead of storing.

**Relatives.**

- [Singleton](../singleton/) keeps exactly one instance of a class and offers a global way to reach it. A flyweight factory keeps one instance per distinct intrinsic value (five TreeTypes here) and needs no global access; a factory that only ever sees one key degenerates into a lazily created singleton.
- Prototype makes new objects by copying a configured one, and each copy is independent and may change. Flyweight is the opposite trade: one object, never copied, never changed.
- [Composite](../composite/) is where flyweights often live. The book's editor shares character glyphs as leaves of its document tree, which turns the tree into a graph; a shared leaf can't keep a pointer to its one parent, so the parent becomes extrinsic state.
- [State](../state/) and [Strategy](../strategy/) objects that keep no fields of their own can be shared the same way, one instance per kind, and the book suggests implementing them as flyweights.
- An object pool (not one of the 23) lends a mutable object to one user at a time and takes it back, like a database connection. Flyweights are shared by everyone at once and never change.
- `TreeFactory` is not a [Factory Method](../factory-method/): no subclass decides which class to create. It is a cache with a creation step, keyed by intrinsic state.

## Code

TypeScript that mirrors the diagram. Node 22.18 or later runs it as is (`node trees.ts`) by stripping the types; with `@types/node` installed, `tsc --noEmit --strict` type-checks it. The `assert` lines check what the diagram shows: five types, two oaks sharing one object, a frozen flyweight and the memory estimate.

```ts
import assert from 'node:assert/strict';

const COLOURS: Record<string, string> = {
  Oak: 'darkgreen', Maple: 'orange', Plane: 'olive', Birch: 'yellowgreen', Pine: 'seagreen',
};
const loadIcon = (_species: string) => new Uint8Array(2048); // stands in for a decoded 2 KB icon

// Flyweight: the intrinsic state of one species, shared by all its trees.
class TreeType {
  readonly name: string;
  readonly colour: string;
  readonly icon: Uint8Array;
  constructor(name: string, colour: string, icon: Uint8Array) {
    this.name = name; this.colour = colour; this.icon = icon;
    Object.freeze(this); // shallow: the icon's bytes must not be written either
  }
  draw(canvas: string[], x: number, y: number): void { // the extrinsic state comes in
    canvas.push(`${this.name} (${this.colour}) at ${x}, ${y}`);
  }
}

// FlyweightFactory: one TreeType per species, created on the first request.
class TreeFactory {
  private readonly types = new Map<string, TreeType>();
  get(species: string): TreeType {
    let type = this.types.get(species);
    if (!type) {
      type = new TreeType(species, COLOURS[species], loadIcon(species));
      this.types.set(species, type);
    }
    return type;
  }
  get size(): number { return this.types.size; }
}

// Context: what is unique to one marker, plus a reference to its type.
class Tree {
  readonly x: number;
  readonly y: number;
  readonly type: TreeType;
  constructor(x: number, y: number, type: TreeType) { this.x = x; this.y = y; this.type = type; }
  draw(canvas: string[]): void { this.type.draw(canvas, this.x, this.y); }
}

// The client plants 100,000 trees of 5 species, starting with the diagram's three.
const factory = new TreeFactory();
const species = Object.keys(COLOURS);
const trees = [new Tree(66, 50, factory.get('Oak')), new Tree(116, 50, factory.get('Oak'))];
trees.push(new Tree(42, 132, factory.get('Maple')));
for (let i = trees.length; i < 100_000; i++) {
  trees.push(new Tree(i % 400, Math.floor(i / 400), factory.get(species[i % 5])));
}

assert.equal(factory.size, 5);              // the map stopped growing at 5 types
assert.equal(trees[0].type, trees[1].type); // two oaks, one TreeType object
assert.throws(() => { (trees[0].type as any).colour = 'red'; }, TypeError); // frozen

const ICON = 2048, PER_TREE = 24; // x and y as 8-byte numbers, plus one 8-byte reference
const copied = trees.length * (ICON + PER_TREE);
const shared = factory.size * ICON + trees.length * PER_TREE;
assert.equal(copied, 207_200_000);
assert.equal(shared, 2_410_240);

const canvas: string[] = [];
trees[0].draw(canvas);
console.log(canvas[0]); // Oak (darkgreen) at 66, 50
console.log(`${(copied / 1e6).toFixed(1)} MB → ${(shared / 1e6).toFixed(2)} MB`); // 207.2 MB → 2.41 MB
```

Output:

```
Oak (darkgreen) at 66, 50
207.2 MB → 2.41 MB
```

The file is an ES module, which is always strict-mode code, so the write to a frozen object throws a `TypeError` instead of failing silently. The estimate is the same simplified one as in the diagram; a real engine adds object headers and lays out fields in its own way.

## When to use it

- There are very many objects, from tens of thousands up, and memory is a problem you have measured: on a phone, in a browser tab, in a game, or in a cache that holds millions of entries.
- Most of each object's state repeats across many of them, in few distinct combinations: 5 species, the characters of an alphabet, a few hundred kinds of map tile.
- What remains per object is small, or can be computed when it's needed.
- Nothing depends on the objects' identity: no code expects two trees' types to be different objects, uses them as locks or hangs per-tree data on them.
- Skip it when the objects are few or mostly unique, when the shared part is small next to the rest (sharing a 4-byte colour saves little), or when the runtime already shares the data for you, as it does for string literals in Java.

## Trade-offs

- **The extrinsic state has to travel.** Every operation that needs a position must be given it, so `draw(canvas)` becomes `draw(canvas, x, y)`. The client stores or computes that state, and the interfaces get wider.
- **One more hop.** Reading a tree's colour means following a reference, and the object you hold (`Tree`) is not the one that has the data (`TreeType`).
- **Harder debugging.** A bug that writes to shared state shows up far from where it happened, on every object that shares it. You can't set a flag on "the third oak", because there is only one Oak.
- **Identity becomes unreliable.** Whether two equal values are the same object depends on the factory's policy, so a `==` that holds today can fail after the cache changes.
- **The factory is shared, mutable state.** It needs a rule for concurrent misses and for memory, since a factory whose keys keep arriving grows forever (see below).
- **In return,** memory drops by roughly the size of the shared state times the number of objects, and the work of allocating, collecting and loading that memory drops with it.

## Implementation notes

- **Freeze it.** In TypeScript, `readonly` only stops the compiler. `Object.freeze(this)` in the constructor makes writes throw at runtime in strict-mode code, which the example asserts. Freezing is shallow: nested objects stay writable, and a typed array with elements can't be frozen at all (`Object.freeze(new Uint8Array(4))` throws a `TypeError`), so keep the icon's buffer private or hand out copies. In Java, use `final` fields and don't let a mutable array escape.
- **Compare by value, unless identity is the point.** Code that receives flyweights should compare them by key or with `equals()`. Identity comparison is only safe when the factory guarantees one object per value and the code relies on that on purpose, as with interned strings used for fast lookups or hash-consed data. Java's `Integer.valueOf(int)` shows the trap: it always caches −128 to 127 and may cache other values, so `Integer.valueOf(127) == Integer.valueOf(127)` is true, while the same comparison for 1,000 is not guaranteed to be. Its documentation calls `Integer` a value-based class whose equal instances should be treated as interchangeable.
- **Dropping unused flyweights.** A factory that holds ordinary references keeps every type forever. That is fine for five species and a leak when the keys are unbounded: user input, fonts from uploaded documents, generated names. Two ways out:
  - *A size limit*, such as least-recently-used eviction. It is simple, but an evicted flyweight that clients still hold stays alive, and the next `get()` for that key creates a second, equal object, so identity can no longer be trusted.
  - *Weak references*, so that an entry goes away once no client uses its flyweight. In JavaScript, a `WeakMap` won't do, because its keys must be objects or non-registered symbols, not strings. The usual shape is a `Map<string, WeakRef<TreeType>>` in which `get()` treats an entry whose `deref()` returns `undefined` as a miss, plus a [`FinalizationRegistry`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry) callback that deletes stale entries. MDN advises avoiding both where possible: when, and whether, an object is collected is up to the engine, and a cleanup callback may run late or never, so the `deref()` check must stay. Java's [`WeakReference`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/lang/ref/WeakReference.html) documentation names canonicalizing mappings as their most common use; note that a `WeakHashMap` holds its keys weakly but its values strongly. Python's [`weakref.WeakValueDictionary`](https://docs.python.org/3/library/weakref.html#weakref.WeakValueDictionary) drops an entry when nothing else refers to its value.
- **Threads.** Immutable flyweights can be shared between threads without locks; the factory can't. Two threads that miss on `'Oak'` at the same moment can each create an Oak. In Java, [`ConcurrentHashMap.computeIfAbsent`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html#computeIfAbsent(K,java.util.function.Function)) performs the whole get-or-create atomically and calls the creating function at most once per call. JavaScript runs `get()` to completion on one thread, so the plain `Map` in the example is enough.
- **Where it appears.**
  - Java: `Integer.valueOf(int)`, above, and `String.intern()`, which returns the pooled string equal to the one it is called on, adding it to the pool first if needed. Every string literal is interned already.
  - Python: `sys.intern()` makes equal strings one object, so that dictionary lookups can compare pointers instead of characters. Names used in programs are normally interned automatically, and interned strings are not immortal: keep a reference to the result.
  - JavaScript: [`Symbol.for(key)`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol/for) returns the symbol registered under `key` in a runtime-wide registry, or creates and registers one: a flyweight factory built into the language.
  - Text: the book motivates the pattern with a document editor that makes each character an object. It shares one object per character code, the intrinsic state, and supplies each character's position, the extrinsic state, when it is drawn.
  - GPUs: instanced drawing sends one mesh to the GPU and draws it many times with a small block of data per instance, such as a position or a transform. In WebGL 2, `drawArraysInstanced()` draws several instances of the same range of vertices, and [`vertexAttribDivisor()`](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/vertexAttribDivisor) makes an attribute advance once per instance instead of once per vertex. It is the same split as the map: one shared mesh, many small sets of extrinsic state.
- **Related ideas.**
  - *Interning* is a flyweight factory for values such as strings and symbols.
  - *Hash-consing* applies the idea to immutable data structures: before building a node, look for a structurally equal one and reuse it. Equal structures are then the same object, so testing them for equality is one pointer comparison.
  - *Caching* also hands out a stored result instead of building a new one. At system scale, as in [Cache-Aside](../cache-aside/), a cache holds copies of data that lives elsewhere and can go stale, so entries expire and are refreshed. A flyweight factory holds the only copies there are, and its entries can't go stale because they never change.
- **At architecture scale.** Container images apply the same split. An image is a stack of read-only layers, every container started from it shares those layers, and each container adds only a thin writable layer of its own. The Docker documentation describes this for the classic storage drivers and notes that the same concepts hold for the containerd image store, the default on fresh installs of Docker Engine 29.0 and later. The image layers are the intrinsic state, and each container's writable layer and settings are the extrinsic state. As with flyweights, the sharing is only safe because the shared part never changes: a container that modifies a file gets its own copy in its writable layer.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Composite](../composite/) — Treat single objects and groups of objects through one interface, so a whole tree answers a question the way one leaf does.
- [State](../state/) — Let an object change its behaviour when its state changes by delegating to state objects instead of growing switch statements.
- [Singleton](../singleton/) — Guarantee one instance with a global access point, and why injecting one shared instance usually serves that need better.
- [Prototype](../prototype/) — Create new objects by copying a configured prototype instead of building them from scratch, and know when a copy must go deep.
- [Factory Method](../factory-method/) — Let subclasses decide which class to create: the base class codes against an interface and calls an overridable create method.
- [Cache-Aside](../cache-aside/) — Read from the cache first; on a miss load from the database and populate the cache.

## References

- [Gamma, Helm, Johnson and Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software (1994)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610)
- [Refactoring.Guru — Flyweight](https://refactoring.guru/design-patterns/flyweight)
- [Java SE 27 API — Integer.valueOf(int)](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/lang/Integer.html#valueOf(int))
- [Java SE 27 API — String.intern()](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/lang/String.html#intern())
- [Python documentation — sys.intern()](https://docs.python.org/3/library/sys.html#sys.intern)
- [MDN — WebGL2RenderingContext: drawArraysInstanced() method](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/drawArraysInstanced)
- [Docker Docs — Storage drivers (images and layers)](https://docs.docker.com/engine/storage/drivers/)
- [MDN — WeakRef](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakRef)
- [MDN — FinalizationRegistry](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
