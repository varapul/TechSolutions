<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧩 Design Patterns (GoF)](../../README.md#design-patterns-gof)

# Memento

> Capture an object's state in a snapshot only it can read, so it can be restored later without breaking encapsulation.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Memento" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/memento.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Undo needs private state** | `History` has to remember how the photo looked before each edit, but `ImageEditor` keeps `#brightness`, `#blur` and `#pixels` private. Making them public would let History copy them, and would also let any code write them (`editor.blur = -3`) and tie every caller to how the editor stores its state. Undoing with an inverse operation doesn't work either: a blur averages neighbouring pixels, and many different photos blur to the same result. |
| **2 · A sealed snapshot** | Before an edit, the app calls `history.backup()`, which asks `editor.save()` for a snapshot. The editor (the *Originator*) copies its own fields into a new `EditorSnapshot` (the *Memento*) that only an `ImageEditor` can open. History (the *Caretaker*) stacks it, seeing nothing but a label, and on undo hands it back to `editor.restore(snap)`, which unseals it and copies the values back. |
| **3 · Edit, snapshot, restore** | History saves the state (brightness 0, blur 0), then *Brightness +20* runs; it saves again (brightness 20, blur 0), then *Blur 3* runs. The first undo pops the newest snapshot and restores blur 0, with brightness still 20; the second restores brightness 0. Each restore copies back the saved pixels, so the photo comes back exactly, although the blur has no inverse. |
| **4 · The cost, and the cousins** | A full snapshot of a 12-megapixel RGBA photo is 48 MB, so ten undo steps hold 480 MB. Editors limit the history, save only the tiles an edit touched, or share unchanged data between snapshots (copy-on-write, immutable state). [Command](../command/) undoes by running an inverse operation instead, and a command can keep a memento to undo itself. The idea also shows up in the state objects of `history.pushState()`, in the time travel of Redux DevTools, in database and VM snapshots, and in the snapshots that spare [Event Sourcing](../event-sourcing/) from replaying every event. |
<!-- END GENERATED: header -->

## The problem

A photo editor applies adjustments and filters to a 12-megapixel picture. `ImageEditor` keeps its state in private fields: the brightness adjustment, the radius of the last blur, and the pixels themselves, 4,000 × 3,000 of them at 4 bytes each (red, green, blue and alpha), 48 MB in all. Users expect Ctrl+Z to put the photo back exactly as it was one step ago.

There are two ways to build undo. One runs an inverse operation, as the [Command](../command/) pattern does: subtract 20 to undo *Brightness +20*. That works only when an exact inverse exists, and in an image editor it often doesn't. A blur replaces each pixel with the average of its neighbours, so many different photos blur to the same pixels, and nothing can work out which one you started from. Even brightness is only nearly reversible: an 8-bit channel stops at 255, so +20 turns a pixel at 240 into 255, and −20 then gives 235.

The other way keeps a copy of the state from before each edit and puts it back on undo. That needs something outside the editor, a `History`, to hold the copies, and the state is private. The obvious fixes all hurt:

- **Public fields**, or a getter and a setter for each, let History copy the state, but they let any other code write it too: `editor.blur = -3`, or new pixels without the brightness that produced them. The editor can no longer guarantee its own rules.
- They also turn the editor's internals into an API. Once History reads `#pixels` as one flat buffer, the editor can't move to tiles or a GPU texture without changing History, and every other class that took the same shortcut.
- **A back door**, such as TypeScript's `private` plus a cast, gives the same coupling with less honesty: the compiler stops complaining, and nothing else changes.

## How it works

Memento lets the object that owns the state make the copy itself. The copy goes out sealed: whoever keeps it can store it and hand it back, but can't read or change what's inside. Only the object that made it can open it again and restore itself from it. Encapsulation holds, because the private fields are never visible outside the class, and the keeper depends only on the snapshot's type, not on what it contains. Gamma, Helm, Johnson and Vlissides described the pattern in *Design Patterns* (1994), where it is also called *Token*.

| Participant | In the diagram | Role |
|---|---|---|
| **Originator** | `ImageEditor` | Owns the state. `save()` copies what a restore will need into a new snapshot, and `restore(snap)` copies it back. The only class that can read a snapshot. |
| **Memento** | `EditorSnapshot` | Holds the copied state. It shows the originator everything (the book's *wide* interface) and everyone else almost nothing: here, a label for the Undo menu (the *narrow* interface). |
| **Caretaker** | `History` | Decides when to save and when to restore, keeps the snapshots in order (a stack, for undo), and never looks inside one or changes it. |

In the diagram the app calls `history.backup()` before each edit, and History asks `editor.save()` for a snapshot. A snapshot of brightness 0 and blur 0 goes on the stack and *Brightness +20* runs; a snapshot of brightness 20 and blur 0 goes on top and *Blur 3* runs. Ctrl+Z pops the newest snapshot and passes it to `editor.restore(snap)`: blur is 0 again and brightness still 20. A second Ctrl+Z restores brightness 0. Both times the editor copies the saved pixels back, so the photo returns exactly, without an inverse for either operation.

The book weighs the consequences. The originator stays simple: it doesn't keep old versions of itself or need to know how many the application wants. The caretaker stays generic: a History that only stacks tokens and hands them back could serve a text editor as well. The costs are the copying on every save and the storage, and the storage is hidden from the caretaker, which can't see how big a snapshot is. A History that looks lightweight may be holding hundreds of megabytes: ten snapshots of this photo are 480 MB.

**Keeping the snapshot opaque in TypeScript.** The narrow interface needs a way to hide fields from History but not from the editor.

- TypeScript's `private` keyword can't do it. It is checked only while compiling: `snap['state']` passes the type checker, and at run time the field is an ordinary property that `JSON.stringify`, `Object.keys` and any JavaScript code can see. The handbook calls this *soft* privacy.
- JavaScript's `#` fields are *hard* private. The engine enforces them: code outside the class body can't even name one (that is a syntax error), and they don't appear in `Object.keys` or `JSON.stringify`. But a `#` field belongs to the class that declares it, so `ImageEditor` couldn't read a `#state` field declared in `EditorSnapshot` either.
- So the code below keeps the snapshot empty apart from its label, and puts the contents in a `WeakMap` held in a `static #` field of `ImageEditor`. Only code inside the editor's class body can reach the map, and a `WeakMap` doesn't keep its keys alive, so when History drops a snapshot, its contents can be collected with it. A `WeakMap` at module scope that the module doesn't export works the same way; it is also how TypeScript implements `#` fields when it compiles for ES2021 or older.
- In C++, the book makes the originator a `friend` of the memento and keeps the wide interface private. Krita's tile engine does the same: [`KisMemento`](https://github.com/KDE/krita/blob/master/libs/image/tiles3/kis_memento.h) keeps its internals private and declares `friend class KisMementoManager`.

## Code

TypeScript that mirrors the diagram. Node 22.18 or later runs it as is (`node editor.ts`) by stripping the types; `tsc --noEmit` type-checks it. Six grey pixels stand in for the 12-megapixel photo.

```ts
import assert from 'node:assert/strict';

type Saved = { brightness: number; blur: number; pixels: Uint8ClampedArray };
const mean = (a: Uint8ClampedArray) => a.reduce((sum, v) => sum + v, 0) / a.length;

// Memento: an opaque token. Its only public member is a label for the Undo menu.
class EditorSnapshot {
  readonly label: string;
  constructor(label: string) { this.label = label; Object.freeze(this); }
}

// Originator: owns the private state, and is the only code that can seal or unseal a snapshot.
class ImageEditor {
  static #sealed = new WeakMap<EditorSnapshot, Saved>(); // unreachable outside this class body
  #brightness = 0;
  #blur = 0;
  #pixels = Uint8ClampedArray.of(10, 10, 240, 240, 10, 10); // six grey pixels stand in for 12 MP

  brighten(n: number): void {
    this.#brightness += n;
    this.#pixels = this.#pixels.map((v) => v + n); // clamped to 0..255
  }
  blur(r: number): void { // box blur: each pixel becomes the mean of its neighbourhood
    const p = this.#pixels;
    this.#blur = r;
    this.#pixels = p.map((_, i) => mean(p.subarray(Math.max(0, i - r), i + r + 1)));
  }
  save(label: string): EditorSnapshot {
    const snap = new EditorSnapshot(label), pixels = this.#pixels.slice(); // a copy, not the buffer
    ImageEditor.#sealed.set(snap, { brightness: this.#brightness, blur: this.#blur, pixels });
    return snap;
  }
  restore(snap: EditorSnapshot): void {
    const saved = ImageEditor.#sealed.get(snap);
    if (!saved) throw new TypeError('not a snapshot taken by an ImageEditor');
    this.#brightness = saved.brightness;
    this.#blur = saved.blur;
    this.#pixels = saved.pixels.slice(); // copy again: later edits must not change the snapshot
  }
  describe(): string {
    return `brightness ${this.#brightness}, blur ${this.#blur}, pixels ${this.#pixels.join(' ')}`;
  }
}

// Caretaker: decides when to save and when to restore, and never looks inside a snapshot.
class History {
  #editor: ImageEditor;
  #stack: EditorSnapshot[] = [];
  constructor(editor: ImageEditor) { this.#editor = editor; }
  backup(label: string): void { this.#stack.push(this.#editor.save(label)); }
  undo(): void { const snap = this.#stack.pop(); if (snap) this.#editor.restore(snap); }
  get labels(): string[] { return this.#stack.map((s) => s.label); }
}

const editor = new ImageEditor();
const history = new History(editor);
const show = (want: string) => { assert.equal(editor.describe(), want); console.log(want); };

history.backup('before Brightness +20'); editor.brighten(20);
show('brightness 20, blur 0, pixels 30 30 255 255 30 30');
history.backup('before Blur 3'); editor.blur(3);
show('brightness 20, blur 3, pixels 142 120 105 105 120 142');
assert.deepEqual(history.labels, ['before Brightness +20', 'before Blur 3']);
history.undo(); show('brightness 20, blur 0, pixels 30 30 255 255 30 30');
history.undo(); show('brightness 0, blur 0, pixels 10 10 240 240 10 10');

// All that History, or any other code, can see of a snapshot is its label.
const snap = editor.save('probe');
assert.deepEqual(Object.keys(snap), ['label']);
assert.equal(JSON.stringify(snap), '{"label":"probe"}');
assert.throws(() => editor.restore(new EditorSnapshot('forged')), TypeError);
```

Output:

```
brightness 20, blur 0, pixels 30 30 255 255 30 30
brightness 20, blur 3, pixels 142 120 105 105 120 142
brightness 20, blur 0, pixels 30 30 255 255 30 30
brightness 0, blur 0, pixels 10 10 240 240 10 10
```

The second line is the loss in miniature. With a radius of 3, the two middle pixels both become the mean of all six values, so they come out equal whatever the row was: different rows blur to the same result, and no function can map it back. The restores don't need one.

## When to use it

- Undo, redo and history panels where some operations have no exact inverse: filters, resampling, generated fills, anything that rounds, clips or merges data.
- Checkpoints inside a process: try a change and roll back if validation fails, save points in a game, the steps of a wizard, a transaction over an in-memory model.
- Resuming later: the position of an iteration, or an API's pagination cursor that the client hands back without looking inside (see [Iterator](../iterator/)).
- Objects whose state is small next to the effort of writing and testing an inverse for every operation.
- Prefer [Command](../command/)'s inverse operations when the state is large and each change is small and exactly reversible, as in a text editor. Prefer immutable data when every state is a value anyway: keeping the previous version is then just keeping a reference to it, and the versions share their unchanged parts (see *Share unchanged data* below).

## Trade-offs

- **Memory.** A full snapshot copies everything, and the caretaker can't tell how much that is: ten snapshots of a 12 MP photo are 480 MB.
- **Time.** Copying 48 MB before every edit adds a pause to each one. Copy lazily (copy-on-write), or only the part an edit is about to change.
- **Opaque cuts both ways.** History can't show what a snapshot holds, compare two of them or merge small ones. It has only what the narrow interface offers, such as a label.
- **Lifetime.** Something has to decide when snapshots go: a cap on their number or size, discarding the redo branch after a new edit, clearing everything when the document closes.
- **Only the object comes back.** Restoring the editor doesn't unsend an email or delete an exported file. Effects outside the object need their own compensation.
- **Privacy depends on the language.** With `#` fields or a `WeakMap` the runtime enforces it; with TypeScript's `private` alone, or in a dynamic language without access control, it is a convention.
- **In return,** the editor keeps its fields private and free to change, History works with any originator, and undo is exact whether or not an operation can be reversed.

## Implementation notes

- **Capture only what restore needs.** The fields that define the state go in. Caches and values derived from them (a thumbnail, a histogram, the pixels uploaded to the GPU) can be rebuilt after a restore. Things the object only refers to, such as a shared colour profile or an open file, stay references and aren't copied.
- **Copy mutable parts on the way in and on the way out.** A snapshot that shared the pixel buffer with the editor would change the next time the editor blurred in place, so `save()` copies the buffer, and `restore()` copies it again so that later edits can't reach into the snapshot. `Object.freeze()` won't protect the buffer: it throws a `TypeError` for a typed array that has elements, and it has no effect on `#` fields. Immutable values (numbers, strings, frozen objects) can be shared as they are.
- **Save only what changed.** The book observes that when snapshots are taken and restored in a predictable order, as in an undo history, each can hold just the change since the one before. Image editors work in tiles partly for this reason. In Krita's tile engine, tiles are copy-on-write, and a [`KisMementoManager`](https://github.com/KDE/krita/blob/master/libs/image/tiles3/kis_memento_manager.h) collects the tile data an action writes and commits it as one revision that undo can roll back, so an undo step costs only the tiles the action touched. GIMP shows the other side: it undoes most filters by keeping [the entire contents of the affected layer](https://docs.gimp.org/3.0/en/gimp-concepts-undo.html) from before and after, because a filter runs as a plug-in and the core can't tell what changed, so a few filter runs can push older steps out of the undo history.
- **Share unchanged data.** With copy-on-write, a snapshot shares storage with the live state, and a block is copied only when it is about to change. A SQL Server [database snapshot](https://learn.microsoft.com/en-us/sql/relational-databases/databases/database-snapshots-sql-server) receives a copy of each page just before the page is first modified in the source database, and an [EBS snapshot](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-snapshots.html) stores only the blocks that changed since the previous snapshot of the volume. Immutable data structures share structure instead: [Immer](https://immerjs.github.io/immer/) reuses every unchanged part of the old state tree in the new one, so keeping each state that a Redux store goes through costs little more than the parts that changed.
- **Limit the history.** Cap it by count or by memory, and drop the oldest first. GIMP has [two settings](https://docs.gimp.org/3.0/en/gimp-prefs-system-resources.html): a minimal number of undo levels that it keeps whatever they cost, and a maximum undo memory per image, beyond which it deletes the oldest steps. The Redux DevTools extension keeps [50 actions by default](https://github.com/reduxjs/redux-devtools/blob/main/extension/docs/API/Arguments.md) (`maxAge`) and removes the oldest after that.
- **Snapshots that leave the process.** A snapshot written to a save file, kept for crash recovery or sent to a worker stops being opaque: it becomes bytes that anyone can read or edit. Let the originator own the format (`editor.export(snap)` and `ImageEditor.import(bytes)`, say), put a version number in it, and validate it when it comes back, as you would any input. Serialise explicitly: neither `JSON.stringify` nor [structured cloning](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm), which `structuredClone()` and `postMessage()` use, copies `#` fields, and structured cloning doesn't keep the prototype either.
- **The browser's history is a caretaker.** `history.pushState(state, …)` keeps a state object with the new history entry, and when the user navigates back to that entry, the `popstate` event gives the page a copy of it. The page decides what goes in; the browser only stores it and hands it back. The object must be serializable, and some browsers save it to disk and limit its size, so [MDN](https://developer.mozilla.org/en-US/docs/Web/API/History/pushState) suggests `sessionStorage` or `localStorage` for anything large.
- **Time-travel debugging.** The [Redux DevTools](https://redux.js.org/tutorials/essentials/part-1-overview-concepts) list every state a store has been through and can jump back to any of them. Their instrument keeps the [computed state after each action](https://github.com/reduxjs/redux-devtools/blob/main/packages/redux-devtools-instrument/src/instrument.ts), so a jump only moves a pointer to a stored state. When reducers update immutably, consecutive states share every part that didn't change, which keeps those snapshots cheap.
- **At system scale.** [Event Sourcing](../event-sourcing/) stores every change as an event, and replaying a long stream on every load gets slow, so systems keep a snapshot of the folded state at some version and load the latest snapshot plus the events after it ([Fowler](https://martinfowler.com/eaaDev/EventSourcing.html)). Unlike a memento, such a snapshot is only a cache: the events remain the record, and a lost snapshot can be rebuilt from them. Database and VM snapshots are mementos that the platform keeps. SQL Server can revert a database to one of its database snapshots, and Hyper-V can [revert a virtual machine to a checkpoint](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/checkpoints) (a *standard* checkpoint includes the memory state), and neither needs to know what the data means. They aren't backups, though: a database snapshot can't be used unless its source database is online, and Microsoft's documentation says snapshots don't replace regular backups. For copies that survive the loss of the original, see [Disaster Recovery Strategies](../disaster-recovery-strategies/).
- **Relatives.**
  - [Command](../command/) undoes by running an inverse; Memento by putting a copy back. Choose per operation: an inverse is small but must be exact, and a snapshot is exact but costs memory. The two combine well: the book suggests that a command keep a memento of the state it is about to change and restore it in its `undo()`, which is how a blur command can undo itself.
  - [Prototype](../prototype/) also copies, but to make a new object, not to bring an existing one back. For a simple object, clones kept on a stack can stand in for mementos; Refactoring.Guru suggests this when the object holds no links to external resources. A clone is a full object with a public interface, though, so whoever holds it can change it: the copy is no longer sealed.
  - [Iterator](../iterator/): the book suggests a memento for recording how far an iteration has got, and an API's opaque cursor token plays that role for a client paging through results.
  - [State](../state/) changes an object's behaviour with its state; Memento saves and restores the state. If an object uses State, its memento must record which state object is current (or a key for it), or a restore brings back the data with the wrong behaviour.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Command](../command/) — Turn a request into an object that can be queued, logged, undone and redone, decoupling who asks from who acts.
- [Prototype](../prototype/) — Create new objects by copying a configured prototype instead of building them from scratch, and know when a copy must go deep.
- [Iterator](../iterator/) — Walk a collection one element at a time without exposing how it is stored: an array, a tree or a stream that never ends.
- [State](../state/) — Let an object change its behaviour when its state changes by delegating to state objects instead of growing switch statements.
- [Event Sourcing](../event-sourcing/) — Store every change as an immutable event and rebuild state by replaying them.
- [Disaster Recovery Strategies](../disaster-recovery-strategies/) — Backup & restore, pilot light, warm standby, active-active: trading cost against RTO and RPO.

## References

- [Gamma, Helm, Johnson and Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software (1994)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610)
- [Refactoring.Guru — Memento](https://refactoring.guru/design-patterns/memento)
- [MDN — Private elements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Private_elements)
- [MDN — WeakMap](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakMap)
- [TypeScript Handbook — Classes (private and #private)](https://www.typescriptlang.org/docs/handbook/2/classes.html)
- [MDN — The structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
- [MDN — History: pushState() method](https://developer.mozilla.org/en-US/docs/Web/API/History/pushState)
- [Redux — Redux Essentials, Part 1: Redux Overview and Concepts](https://redux.js.org/tutorials/essentials/part-1-overview-concepts)
- [Redux DevTools — Extension API arguments (maxAge)](https://github.com/reduxjs/redux-devtools/blob/main/extension/docs/API/Arguments.md)
- [GIMP 3.0 User Manual — Undoing](https://docs.gimp.org/3.0/en/gimp-concepts-undo.html)
- [KDE Krita source — kis_memento_manager.h (tile-based undo)](https://github.com/KDE/krita/blob/master/libs/image/tiles3/kis_memento_manager.h)
- [Martin Fowler — Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)
- [Microsoft Learn — Database snapshots (SQL Server)](https://learn.microsoft.com/en-us/sql/relational-databases/databases/database-snapshots-sql-server)
- [Microsoft Learn — Hyper-V: using checkpoints](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/checkpoints)
- [AWS — Amazon EBS snapshots](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-snapshots.html)
- [Immer — Introduction to Immer](https://immerjs.github.io/immer/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
