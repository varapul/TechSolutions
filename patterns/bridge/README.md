<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧩 Design Patterns (GoF)](../../README.md#design-patterns-gof)

# Bridge

> Split an abstraction from its implementation so both vary independently: m shapes and n renderers need m + n classes, not m × n.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Bridge" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/bridge.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · A class for every pair** | Without the pattern, every class answers two questions at once, which shape and which output: `SvgCircle`, `CanvasCircle`, `PdfCircle`, `SvgRectangle` … 3 shapes × 3 renderers = **9 classes**. A fourth renderer, `Ascii`, adds a whole column (3 × 4 = 12) and a fourth shape, `Hexagon`, a whole row (4 × 4 = 16). Meanwhile the SVG code is copied into every `Svg…` class and the circle geometry into every `…Circle` class. |
| **2 · Two hierarchies, a bridge** | The two questions become two hierarchies. `Shape` (the *Abstraction*) holds a `Renderer` (the *Implementor*), and `Circle`, `Rectangle` and `Triangle` (*RefinedAbstractions*) draw themselves only through its primitives, `circle(x, y, r)` and `polygon(points)`, while `SvgRenderer`, `CanvasRenderer` and `PdfRenderer` (*ConcreteImplementors*) implement those primitives and know nothing about shapes. The reference from `Shape` to `Renderer` is the bridge, and 3 + 3 = **6 classes** replace the 9. |
| **3 · A call across the bridge** | `new Circle(svg, 50, 50, 40).draw()` runs Circle's one line, `renderer.circle(50, 50, 40)`. The call crosses the bridge to `SvgRenderer`, and `<circle cx="50" cy="50" r="40"/>` comes back. The same `Circle` class built with `canvas` gets `ctx.beginPath()`, `ctx.arc(50, 50, 40, 0, 2 * Math.PI)` and `ctx.stroke()` instead: the shape's code is identical, and only the object behind the bridge differs. |
| **4 · Grow either side** | `AsciiRenderer` is one new class that every shape can use at once, and `Hexagon` is one new class that every renderer can draw: 4 shapes and 4 renderers take 4 + 4 = **8 classes** instead of 16, and neither side was edited. Unlike an *Adapter*, which makes existing classes fit after the fact, a bridge is planned up front so that both sides can grow; *Strategy* shares its structure but swaps a single algorithm, and an *Abstract Factory* can pick the renderer that suits the platform. JDBC drivers and Qt's paint engines work this way, and ports and adapters apply the same split to a whole application. |
<!-- END GENERATED: header -->

## The problem

A drawing library has shapes, such as circles, rectangles and triangles, and several ways to output them: SVG markup for a web page, calls on an HTML canvas, a PDF page. Those are two separate questions, *what* to draw and *how* to write it out, but a class hierarchy has only one axis. Give `Shape` a subclass for every combination of shape and output, and you get one class per pair: `SvgCircle`, `CanvasCircle`, `PdfCircle`, `SvgRectangle` and so on, 3 × 3 = 9 here.

The count is only the visible part. Every `Svg…` class repeats the code that writes SVG and every `…Circle` class repeats the circle's geometry, so a fix to either has to be made three times. Growth multiplies: ASCII output for a terminal adds a column of three classes (12), and a hexagon then adds a row of four (16). The output format is also baked into the class at every call site, so code that says `new SvgCircle(…)` can't send the same circle to a PDF without being edited.

## How it works

Bridge cuts the one hierarchy in two along those two questions and joins the halves with a reference. Shapes form one hierarchy and renderers another, and each shape holds the renderer it draws with. A shape works out what to draw and says it in the renderer's small vocabulary of primitives; a renderer knows how to put those primitives into its format, and nothing about shapes. Either side can then gain classes without the other noticing. The pattern is one of the structural patterns in *Design Patterns* by Gamma, Helm, Johnson and Vlissides (1994), which also lists it as *Handle/Body* and takes its name from that reference: the bridge between an abstraction and its implementation.

| Participant | In the diagram | Role |
|---|---|---|
| **Abstraction** | `Shape` | What clients use: `draw()`. It holds the reference to a `Renderer`, which is the bridge. |
| **RefinedAbstraction** | `Circle`, `Rectangle`, `Triangle`, `Hexagon` | Variants of the abstraction. Each implements `draw()` with the renderer's primitives and nothing else. |
| **Implementor** | `Renderer` | The interface of the implementation side, here two primitives: `circle(x, y, r)` and `polygon(points)`. It doesn't have to resemble the abstraction's interface, and it is usually lower level. |
| **ConcreteImplementor** | `SvgRenderer`, `CanvasRenderer`, `PdfRenderer`, `AsciiRenderer` | One per output format. Each implements the primitives and never sees a shape. |

**What "abstraction" and "implementation" mean here.** They don't mean an abstract class and the concrete class that implements it, the everyday sense of the words: each side of a bridge has both. `Shape` is abstract and `Circle` concrete; `Renderer` is an interface and `SvgRenderer` a class. The two words name two *dimensions of variation*. The abstraction is the part the application reasons about (which shapes exist and what they consist of), and the implementation is the part that carries it out on some platform or medium (markup, canvas calls, PDF content, characters in a terminal). The test for a bridge is whether the two change for different reasons: new shapes come from product requests, new renderers from the platforms you have to support.

**The arithmetic.** With one class per pair, *m* shapes and *n* renderers cost *m × n* classes. With a bridge they cost *m + n*, not counting `Shape` and `Renderer` themselves. At 3 and 3 that is 9 against 6, hardly a reason for a pattern, but a fourth renderer makes it 12 against 7 and a fourth shape 16 against 8. The better argument is locality: `AsciiRenderer` is one class that draws every shape there is, and `Hexagon` is one class that every renderer can draw, so each addition is written, reviewed and tested once.

## Code

TypeScript that mirrors the diagram (`PdfRenderer` and `Triangle` are left out to keep it short). Node 22.18 or later runs it as is (`node shapes.ts`) by stripping the types; `tsc --noEmit` type-checks it. `CanvasRenderer` returns the calls it would make on a `CanvasRenderingContext2D` as text, so the example runs outside a browser. They follow MDN's recipe for a full circle: `arc()` from angle 0 to 2π, between `beginPath()` and `stroke()`.

```ts
import assert from 'node:assert/strict';

type Point = readonly [number, number];

// Implementor: the primitives that every output format can provide.
interface Renderer {
  circle(x: number, y: number, r: number): string;
  polygon(points: readonly Point[]): string;
}

// ConcreteImplementors: one per format. None of them knows what a shape is.
class SvgRenderer implements Renderer {
  circle(x: number, y: number, r: number) { return `<circle cx="${x}" cy="${y}" r="${r}"/>`; }
  polygon(points: readonly Point[]) { return `<polygon points="${points.join(' ')}"/>`; }
}
class CanvasRenderer implements Renderer { // returns the calls as text, so that it runs in Node
  circle(x: number, y: number, r: number) {
    return `ctx.beginPath(); ctx.arc(${x}, ${y}, ${r}, 0, 2 * Math.PI); ctx.stroke();`;
  }
  polygon(points: readonly Point[]) {
    const path = points.map(([x, y], i) => `ctx.${i ? 'lineTo' : 'moveTo'}(${x}, ${y}); `).join('');
    return `ctx.beginPath(); ${path}ctx.closePath(); ctx.stroke();`;
  }
}

// Abstraction: holds the bridge, and draws only through Renderer's primitives.
abstract class Shape {
  protected readonly renderer: Renderer;
  constructor(renderer: Renderer) { this.renderer = renderer; }
  abstract draw(): string;
}

// RefinedAbstractions: each one decides what to draw, never how.
class Circle extends Shape {
  readonly x: number; readonly y: number; readonly r: number;
  constructor(renderer: Renderer, x: number, y: number, r: number) {
    super(renderer); this.x = x; this.y = y; this.r = r;
  }
  draw() { return this.renderer.circle(this.x, this.y, this.r); }
}
class Rectangle extends Shape {
  readonly corners: Point[];
  constructor(renderer: Renderer, x: number, y: number, w: number, h: number) {
    super(renderer); this.corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  }
  draw() { return this.renderer.polygon(this.corners); }
}

const svg = new SvgRenderer(), canvas = new CanvasRenderer();
assert.equal(new Circle(svg, 50, 50, 40).draw(), '<circle cx="50" cy="50" r="40"/>');
assert.equal(new Circle(canvas, 50, 50, 40).draw(),
  'ctx.beginPath(); ctx.arc(50, 50, 40, 0, 2 * Math.PI); ctx.stroke();');
assert.equal(new Rectangle(svg, 10, 20, 80, 40).draw(), '<polygon points="10,20 90,20 90,60 10,60"/>');

for (const c of [Shape, Circle, Rectangle]) Object.freeze(c.prototype); // shapes done: edits now throw

// Added later, against Renderer alone: a 100 x 100 drawing as 20 x 10 characters.
class AsciiRenderer implements Renderer {
  private plot(inside: (x: number, y: number) => boolean) {
    return Array.from({ length: 10 }, (_, row) => Array.from({ length: 20 },
      (_, col) => (inside(5 * col + 2.5, 10 * row + 5) ? '#' : '.')).join('')).join('\n');
  }
  circle(cx: number, cy: number, r: number) {
    return this.plot((x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r);
  }
  polygon(points: readonly Point[]) { // inside if a ray to the right crosses an odd number of edges
    return this.plot((x, y) => points.filter(([x1, y1], i) => {
      const [x2, y2] = points[(i + 1) % points.length];
      return (y1 > y) !== (y2 > y) && x < x1 + ((y - y1) * (x2 - x1)) / (y2 - y1);
    }).length % 2 === 1);
  }
}
const ascii = new AsciiRenderer();
const round = new Circle(ascii, 50, 50, 40).draw().split('\n'); // the same, frozen classes
const box = new Rectangle(ascii, 10, 20, 80, 40).draw().split('\n');
assert.equal(round[4], '..################..');               // 80 units wide: 16 characters
assert.equal(box.filter((row) => row.includes('#')).length, 4); // 40 units high: 4 rows
console.log(round.map((row, i) => `${row}   ${box[i]}`).join('\n'));
```

Output, the circle and the rectangle as `AsciiRenderer` draws them:

```
....................   ....................
......########......   ....................
....############....   ..################..
...##############...   ..################..
..################..   ..################..
..################..   ..################..
...##############...   ....................
....############....   ....................
......########......   ....................
....................   ....................
```

The shape classes are frozen with `Object.freeze` before `AsciiRenderer` is declared, so the new renderer can't have patched them: it reaches `Circle` and `Rectangle` only through the `Renderer` interface. The other direction works the same way. A `Hexagon` would be one more `Shape` subclass that passes six corners to `renderer.polygon()`, and all three renderers would draw it without a change.

## When to use it

- A class varies along two independent dimensions, such as shape and output format, message and delivery channel, or a UI control and the platform it runs on, and subclassing would need a class for every combination.
- Both sides will grow, at different times or in different teams: shapes from product work, renderers from platform work.
- The implementation should be chosen while the program runs (from configuration, the platform, the kind of file being written), or replaced by a fake in tests, without touching the code that uses the abstraction.
- Clients shouldn't see the implementation's details, or be recompiled when they change (the C++ pImpl case below).
- Not when only one dimension varies: an interface with a few implementations is enough. And not when the two dimensions aren't really independent: if every shape needs special handling in every renderer, shape knowledge leaks into the primitives, and the split costs more than it saves.

## Trade-offs

- **Two hierarchies and an indirection** instead of one class tree. For two shapes and two outputs, four small classes may well be simpler.
- **The primitives are a contract** between the two sides. Adding one, such as `text()` or `bezier()`, means implementing it in every renderer at once, which is exactly the kind of change the pattern exists to avoid. Give new primitives a default (see below).
- **A common denominator.** Shapes can only use what the interface names, so a format's own strengths (SVG filters, PDF links) stay out of reach unless the interface grows or offers optional capabilities.
- **Chatty interfaces are slow.** Primitives that are too fine-grained, a call per pixel or per character, multiply the calls, and that hurts much more once a call crosses a process or network boundary.
- **In return,** shapes and renderers are written, tested and shipped separately, each new class works with the whole other side at once, and the implementation can be picked at run time.

## Implementation notes

- **Choosing the primitives.** This is the main design decision. They have to be low-level enough that every renderer can provide them (a polygon is just a list of points, which any of these formats can draw) and high-level enough that one shape isn't hundreds of calls (no `setPixel()`, which only a raster can implement cheaply and which would make every drawing chatty). Neither extreme works: only what every back end has in common is too poor, and everything that any back end can do leaves each renderer stubbing most of the interface.

  Qt's paint system shows a middle way. Applications draw with `QPainter` on a paint device (a widget, an image, a printer, a PDF writer), and the device's `QPaintEngine` does the work; application code never sees the engine unless it adds its own kind of device. An engine must implement a polygon primitive, while `drawEllipse()` has a default implementation that calls `drawPolygon()`, so only an engine with native ellipses needs to override it. Engines also declare which features they support, and `QPainter` emulates the missing ones as well as it can. A small required core, plus richer operations whose defaults are built from the core, maps directly onto an abstract base class with default methods.
- **Who creates and wires the implementor.** If `Shape`'s constructor called `new SvgRenderer()`, the dependency the pattern removes would be back. Hand the renderer in instead: constructor injection, as in the code, with the choice made in one place at start-up (from configuration, the output file's extension or the platform). The book also describes letting the abstraction choose from its constructor's arguments, starting with a default and switching later (a collection that changes its representation as it grows), and handing the decision to another object. That object is often an [Abstract Factory](../abstract-factory/), which returns the implementor that fits the platform, or a whole family of them, so that no shape ever names a concrete renderer.
- **Sharing implementors.** A renderer without per-drawing state can serve every shape: one `SvgRenderer` for a whole document, or for the whole program. One that holds state, such as an open PDF page or a canvas context and its current transform, belongs to one drawing at a time, so make it explicit who opens and closes it. The book's C++ discussion shares one body among several handles and counts the references to it (the Handle/Body idiom of James Coplien, which it cites), and the bridge keeps that bookkeeping out of the clients' sight.
- **Changing it at run time** is possible with a setter, but it is rarely the point: a bridge is usually wired once, when the object is built. Code that swaps the implementor from call to call is doing Strategy's job.
- **Without classes.** Where functions are values, an implementor can be a plain object of functions, `{ circle, polygon }`, which in TypeScript satisfies `Renderer` without a class. Modules do the same at a coarser grain, with the implementation chosen at build or start-up time. The abstraction side still gains from being a type that holds a reference, because that is what lets new shapes work with renderers that don't exist yet.
- **One implementor: pImpl.** With a single implementation the pattern degenerates into C++'s [pImpl idiom](https://en.cppreference.com/cpp/language/pimpl): the class's private members move into a separate class reached through an opaque pointer, so changing them doesn't recompile the class's users, and a library can keep a stable ABI. The book covers this degenerate case too.
- **Where it appears.**
  - **JDBC.** Application code is written against the `java.sql` interfaces, and each database vendor ships a driver that implements them. [`java.sql.Driver`](https://docs.oracle.com/en/java/javase/27/docs/api/java.sql/java/sql/Driver.html) is the interface every driver class must implement. [`DriverManager`](https://docs.oracle.com/en/java/javase/27/docs/api/java.sql/java/sql/DriverManager.html) finds drivers through the service-provider mechanism (or the `jdbc.drivers` system property) and, for each connection request, asks the registered drivers in turn to connect to the URL; its documentation names a `DataSource` as the preferred way to connect. On the abstraction side sit DAOs, query builders and ORMs: m of those and n databases need m + n pieces of code, not m × n.
  - **Qt.** `QPainter` and `QPaintEngine`, as above. The raster engine is the default for painting widgets on Windows, X11 and macOS and for painting on a `QImage`, and Qt also provides engines for OpenGL and for printing. A new kind of output means subclassing `QPaintEngine` and having a paint device return it.
- **Relatives.**
  - [Adapter](../adapter/) can look the same on a class diagram. The difference is timing and intent: an adapter is added afterwards, to make a class that already exists fit an interface it wasn't written for, while a bridge is planned before either side exists, so that both can grow.
  - [Strategy](../strategy/) has the same shape, an object that delegates through an interface. A strategy is one interchangeable algorithm, usually chosen by the client and often swapped while the program runs; a bridge separates two hierarchies that both grow, and is usually fixed when the object is built.
  - [Abstract Factory](../abstract-factory/) can create and configure a bridge, as above.
  - [Decorator](../decorator/) also replaces a class per combination, but for optional features that stack (retries, logging, caching), where an object can have any subset in any order. In a bridge each object has exactly one choice on each side: one shape, one renderer.
- **At architecture scale.** [Hexagonal architecture](../hexagonal-architecture/) (ports and adapters) makes the same split for a whole application. The core declares the interfaces it needs, its driven ports (the Implementor's role), and each technology plugs in behind one as an adapter (a ConcreteImplementor), so use cases and infrastructure change independently and a test can plug in an in-memory adapter. Three things change at that scale. The interface belongs to the core and is shaped by what the core needs, `save(order)` rather than `execute(sql)`. The other side is often across a process or network boundary, so the interface has to be coarse: the chatty-primitives problem above, at a much higher price. And the wiring moves out of each object's constructor into one composition root at start-up.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Adapter](../adapter/) — Wrap an incompatible interface so existing code can use it unchanged: the classic fix for a third-party or legacy API.
- [Strategy](../strategy/) — Put interchangeable algorithms behind one interface and choose one at runtime, instead of branching inside the caller.
- [Abstract Factory](../abstract-factory/) — Create families of related objects through one interface, so swapping the whole family never touches client code.
- [Decorator](../decorator/) — Wrap an object to add behaviour at runtime, stacking wrappers instead of multiplying subclasses for every combination.
- [Hexagonal (Ports & Adapters)](../hexagonal-architecture/) — Domain logic at the core; UIs, databases and queues plug in through ports and adapters.

## References

- [Gamma, Helm, Johnson and Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software (1994)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610)
- [Refactoring.Guru — Bridge](https://refactoring.guru/design-patterns/bridge)
- [Java SE 27 API — java.sql.DriverManager](https://docs.oracle.com/en/java/javase/27/docs/api/java.sql/java/sql/DriverManager.html)
- [Java SE 27 API — java.sql.Driver](https://docs.oracle.com/en/java/javase/27/docs/api/java.sql/java/sql/Driver.html)
- [Qt 6 documentation — Paint System](https://doc.qt.io/qt-6/paintsystem.html)
- [Qt 6 documentation — QPaintEngine Class](https://doc.qt.io/qt-6/qpaintengine.html)
- [MDN — circle (SVG element)](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/circle)
- [MDN — CanvasRenderingContext2D: arc() method](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/arc)
- [Alistair Cockburn — Hexagonal Architecture (2005)](https://alistair.cockburn.us/hexagonal-architecture/)
- [cppreference — PImpl](https://en.cppreference.com/cpp/language/pimpl)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
