<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧩 Design Patterns (GoF)](../../README.md#design-patterns-gof)

# Command

> Turn a request into an object that can be queued, logged, undone and redone, decoupling who asks from who acts.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Command" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/command.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Buttons call methods** | The toolbar calls `doc.insert(5, ' world')` and then `doc.delete(0, 6)` itself, and the text goes from *Hello* to *Hello world* to *world*. Once a call returns, nothing remembers what it did or which text it deleted, so Ctrl+Z has nothing to undo. There is also no object to put in a macro, a queue or a log. |
| **2 · Requests as objects** | The toolbar (the *Client*) now wraps each edit in a command object that holds everything it needs: its receiver `doc`, its arguments, and room for what `undo()` will need. `History.execute(cmd)` (the *Invoker*) calls `cmd.execute()` through the `Command` interface, and the concrete command calls the `Document` (the *Receiver*). History then pushes the command on its undo stack. `DeleteText` keeps the text it removed, `'Hello '`, so that it can put it back. |
| **3 · Undo and redo** | Ctrl+Z pops `DeleteText` and calls its `undo()`, which inserts `'Hello '` again (*world* → *Hello world*), then moves it to the redo stack. A second Ctrl+Z does the same for `InsertText` (→ *Hello*). Ctrl+Y pops `InsertText` from the redo stack and calls `execute()` again (→ *Hello world*). Executing a new command would clear the redo stack. |
| **4 · Queue, log, replay** | Because a request is now an object, it can wait in a queue for a worker, be written to a log and replayed from a known state, or be grouped with others into a macro whose `undo()` runs its parts in reverse (a Composite). Swing's `Action` and `UndoManager` and VS Code's command registry use the idea in user interfaces. At system scale it becomes the command messages of [CQRS](../cqrs/) and the jobs on a [work queue](../queue-based-load-leveling/). A command asks for something to happen and can be refused; an event, as stored by [Event Sourcing](../event-sourcing/), reports something that already happened. |
<!-- END GENERATED: header -->

## The problem

A text editor's toolbar starts out simple. The Insert button calls `doc.insert(5, ' world')`, the Delete button calls `doc.delete(0, 6)`, and the text changes straight away. Then the usual requests arrive: Ctrl+Z to undo the last edit and Ctrl+Y to redo it, a macro recorder that plays back a sequence of edits, a collaborative mode that sends every edit to a server, and recovery of unsaved work after a crash.

None of these can be built while an edit is only a method call. Once the call returns, nothing records which method ran, with which arguments, or which text the delete removed. Undo has nothing to work with, and there is nothing to group, store, send or replay. The wiring is rigid too: each button calls one method of one class, so a menu item, a toolbar button and a keyboard shortcut that do the same thing each repeat the call, along with the check for whether it is allowed right now.

## How it works

Command makes the request itself an object. The object holds what is needed to perform the request later: the receiver it acts on, the arguments, and, if it can be undone, whatever it has to remember to reverse its effect. The code that triggers it (a button, a shortcut, a scheduler) knows only a small interface, usually a single `execute()` method, and never which class does the work or how. Because the request is now a value, it can be kept, passed around, queued, logged, repeated and undone like any other value. Gamma, Helm, Johnson and Vlissides described the pattern in *Design Patterns* (1994), which also gives it the names *Action* and *Transaction*.

| Participant | In the diagram | Role |
|---|---|---|
| **Command** | `Command` | The interface every request implements: `execute()`, plus `undo()` when the request can be reversed. |
| **ConcreteCommand** | `InsertText`, `DeleteText` | Binds one receiver to one action and its arguments, and keeps whatever its `undo()` will need. |
| **Receiver** | `Document` | Does the real work (`insert`, `delete`). It doesn't know that commands exist. |
| **Invoker** | `History` | Asks commands to run and keeps them afterwards, here on an undo stack and a redo stack. |
| **Client** | `Toolbar` | Creates each concrete command, gives it its receiver and arguments, and hands it to the invoker. |

`History` depends only on `Command`, so it can run, undo and redo an `InsertText`, a `DeleteText` or a command written next year without changing. The `Document` has no idea it is being driven by commands: it just has `insert` and `delete`.

**What a command keeps so it can undo itself.** `undo()` runs the inverse operation, so the command must hold the data the inverse needs. For `InsertText` the arguments are enough: removing `s.length` characters at `at` reverses inserting `s` at `at`. `DeleteText` is different. Its arguments say where and how many characters, but not which ones, so its `execute()` keeps the text it removed (`'Hello '`) and its `undo()` inserts exactly that text again. As a rule, a command keeps every value its operation destroys or overwrites (the deleted text, the previous colour, the old position), captured when it executes rather than worked out again when it is undone.

**Inverse or snapshot.** The alternative is the Memento pattern: save a snapshot of the document before each edit and restore it on undo. A snapshot is simple and always exact, and it is the only choice when an operation has no practical inverse, such as a blur filter applied to an image. It costs memory, though, unless the state is an immutable structure that shares its unchanged parts between versions. An inverse stores only the difference, but every command needs one, written and tested, and an inverse that is only nearly right moves the document a little further from the original with every undo and redo. The two combine well: the GoF book suggests letting a command keep a memento of just the part it changes, so that its undo restores that part exactly.

**The two stacks.** Undo pops the newest command from the undo stack, calls its `undo()` and pushes it on the redo stack. Redo pops from the redo stack, calls `execute()` again and pushes the command back on the undo stack. Executing a *new* command clears the redo stack: the undone commands were recorded against a version of the text that the new edit has replaced, so their positions and saved text no longer fit. Swing's `UndoManager` and Qt's `QUndoStack` both throw the undone edits away when a new one arrives. Vim keeps them instead, as [branches of an undo tree](https://vimhelp.org/undo.txt.html#undo-branches), at the price of a more complex model to move around in.

**Macros are composite commands.** A macro is a command that holds a list of commands. Its `execute()` runs them in order, its `undo()` undoes them in reverse order, and `History` treats the whole macro as one step. This is the Composite pattern applied to commands. The GoF book's example is a `MacroCommand`, Qt builds macros with [`QUndoStack::beginMacro()`](https://doc.qt.io/qt-6/qundostack.html#beginMacro) and `endMacro()`, and Swing's [`CompoundEdit`](https://docs.oracle.com/en/java/javase/27/docs/api/java.desktop/javax/swing/undo/CompoundEdit.html) collects small edits into one.

## Code

TypeScript that mirrors the diagram. Node 22.18 or later runs it as is (`node editor.ts`) by stripping the types; `tsc --noEmit` type-checks it.

```ts
import assert from 'node:assert/strict';

// Receiver: owns the text and knows how to change it.
class Document {
  text = 'Hello';
  insert(at: number, s: string): void {
    this.text = this.text.slice(0, at) + s + this.text.slice(at);
  }
  delete(at: number, n: number): string {
    const removed = this.text.slice(at, at + n);
    this.text = this.text.slice(0, at) + this.text.slice(at + n);
    return removed;
  }
}

// Command: all that History knows about an edit.
interface Command { execute(): void; undo(): void; }

// ConcreteCommands: a receiver, the arguments, and what undo() will need.
class InsertText implements Command {
  doc: Document; at: number; s: string;
  constructor(doc: Document, at: number, s: string) {
    this.doc = doc; this.at = at; this.s = s;
  }
  execute() { this.doc.insert(this.at, this.s); }
  undo() { this.doc.delete(this.at, this.s.length); }
}

class DeleteText implements Command {
  doc: Document; at: number; n: number;
  removed = ''; // set by execute(), needed by undo()
  constructor(doc: Document, at: number, n: number) {
    this.doc = doc; this.at = at; this.n = n;
  }
  execute() { this.removed = this.doc.delete(this.at, this.n); }
  undo() { this.doc.insert(this.at, this.removed); }
}

// Invoker: runs commands and keeps the undo and redo stacks.
class History {
  undoStack: Command[] = [];
  redoStack: Command[] = [];
  execute(cmd: Command) {
    cmd.execute();
    this.undoStack.push(cmd);
    this.redoStack = []; // a new edit makes the undone ones unreachable
  }
  undo() {
    const cmd = this.undoStack.pop();
    if (cmd) { cmd.undo(); this.redoStack.push(cmd); }
  }
  redo() {
    const cmd = this.redoStack.pop();
    if (cmd) { cmd.execute(); this.undoStack.push(cmd); }
  }
}

// Client: the toolbar creates each command and hands it to History.
const doc = new Document();
const history = new History();
const show = (want: string) => { assert.equal(doc.text, want); console.log(doc.text); };

history.execute(new InsertText(doc, 5, ' world')); show('Hello world');
history.execute(new DeleteText(doc, 0, 6));        show('world'); // removed = 'Hello '
history.undo();                                    show('Hello world');
history.undo();                                    show('Hello');
history.redo();                                    show('Hello world');
assert.equal(history.redoStack.length, 1);         // DeleteText could still be redone,
history.execute(new InsertText(doc, 11, '!'));     show('Hello world!');
assert.equal(history.redoStack.length, 0);         // but a new command cleared the stack
```

Output:

```
Hello world
world
Hello world
Hello
Hello world
Hello world!
```

## When to use it

- Undo and redo, where each action can describe its own inverse: text and code editors, drawing and design tools, spreadsheets, form and page builders.
- One action reachable from several places (a menu item, a toolbar button, a shortcut, a command palette). A single command object carries the behaviour, the label and the enabled state, and every control uses it.
- Work that should run later or somewhere else: a job queue, a scheduler, a retry loop, a batch that runs overnight.
- A record of what was asked for, to audit it, or to replay it from a known starting state after a crash.
- Macros and scripting: recording what a user does and playing it back.
- Prefer a plain method call or function when an action is only ever called directly, and never stored, undone or deferred.

## Trade-offs

- **A class per action.** Every operation becomes a small class with its own `undo()`, and dozens of them add up. Closures remove most of the ceremony (see *Implementation notes*).
- **Undo has to be exact.** Each inverse is code that must be right for every input, including the edges (deleting at the end of the text, inserting into an empty document), and must stay right as the receiver changes. Mistakes corrupt documents quietly.
- **Some actions can't be undone.** Sending an email or charging a card can only be compensated (a correction, a refund), not reversed. Keep such commands out of the undo history, or give them an explicit compensating action, as [Compensating Transaction](../compensating-transaction/) does across services.
- **History costs memory.** Each command, and whatever it kept in order to undo itself, stays alive while it is on a stack. Cap the history (Swing's `UndoManager` keeps 100 edits by default, and `QUndoStack` has an [`undoLimit`](https://doc.qt.io/qt-6/qundostack.html#undoLimit-prop)) and merge small edits.
- **One more hop to read.** The toolbar's code says `history.execute(new InsertText(doc, 5, ' world'))`, not what changes, so the behaviour is one class away.
- **In return,** the invoker is independent of the receivers, a new action needs no change to `History` or to the toolbar's wiring, and every request becomes something you can store, inspect, test, queue and replay.

## Implementation notes

- **The functional form.** In a language with closures, a command can be two functions instead of a class:

  ```ts
  function deleteText(doc: Document, at: number, n: number): Command {
    let removed = '';
    return {
      execute: () => { removed = doc.delete(at, n); },
      undo: () => doc.insert(at, removed),
    };
  }
  ```

  The closures capture the receiver and the arguments, and the shared `removed` variable does the job of `DeleteText`'s field. Without undo, a command shrinks to a single function, which is why so many uses of the pattern are plain callbacks: a click handler, a function passed to `setTimeout`, or a `Runnable` handed to Java's [`Executor`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/concurrent/Executor.html), whose documentation presents it as a way to keep the code that submits a task apart from how and where the task runs. Classes earn their keep when commands need names, equality, serialisation or extra methods such as `canExecute()` or `merge()`.
- **Freeze a command once it has run.** After a command has executed and gone onto a stack, don't change it, because `History` relies on its fields to undo it. Qt makes the point in the documentation for [`QUndoStack::command()`](https://doc.qt.io/qt-6/qundostack.html#command): the stack hands a pushed command back only as a const pointer, because changing one after it has run would almost certainly break the document. If a button reuses one configured command object for every press, copy it before it goes onto the stack; the GoF book points out that the command then acts as a Prototype.
- **Merge small edits.** Typing "world" as five one-character commands would take five undos to remove. Editors merge consecutive commands of the same kind into one step: Qt's [`QUndoCommand::mergeWith()`](https://doc.qt.io/qt-6/qundocommand.html#mergeWith) and Swing's [`UndoableEdit.addEdit()`](https://docs.oracle.com/en/java/javase/27/docs/api/java.desktop/javax/swing/undo/UndoableEdit.html#addEdit(javax.swing.undo.UndoableEdit)) exist for this.
- **Commands that travel.** Once a command leaves the process, as a message on a queue, a request to a server or a line in a log, it can't carry object references or closures. It becomes data, with a type, the arguments and the IDs of what it acts on (`{ type: 'InsertText', docId: 'd-42', at: 5, text: ' world' }`), and a handler on the receiving side holds the logic that `execute()` had. Three concerns follow:
  - *Validation.* The receiver may refuse the command (the document is read-only, the position is past the end), so a command is a request, not a promise.
  - *Idempotency.* A broker that must not lose messages delivers them at least once, so give each command an ID and let the handler skip one it has already applied ([Idempotent Consumer](../idempotent-consumer/)).
  - *Versioning.* A command written to a log must still be readable after the code that wrote it has changed.
- **Command or event.** A command is an instruction, named in the imperative (`InsertText`, `BookRoom`, `PlaceOrder`). It goes to one handler, which may refuse it. An event is a fact, named in the past tense (`TextInserted`, `RoomBooked`, `OrderPlaced`). It has already happened, any number of listeners may react to it, and none of them can refuse it. Martin Fowler calls an event that quietly expects a listener to act a [*passive-aggressive command*](https://martinfowler.com/articles/201701-event-driven.html): if you need something done, say so with a command. The naming advice cuts the other way as well. Redux dispatches actions much as an invoker runs commands, yet its style guide recommends [modelling actions as events, not setters](https://redux.js.org/style-guide/#model-actions-as-events-not-setters), because names that describe what happened make a more meaningful log.
- **In UI frameworks and editors.**
  - Java Swing: an [`Action`](https://docs.oracle.com/en/java/javase/27/docs/api/java.desktop/javax/swing/Action.html) lets a menu item and a toolbar button share one behaviour, label, icon and enabled state, so disabling the action disables both. [`UndoManager`](https://docs.oracle.com/en/java/javase/27/docs/api/java.desktop/javax/swing/undo/UndoManager.html) keeps `UndoableEdit` objects, each with `undo()` and `redo()`, and is itself a `CompoundEdit`.
  - .NET: [`ICommand`](https://learn.microsoft.com/en-us/dotnet/api/system.windows.input.icommand) declares `Execute`, `CanExecute` and a `CanExecuteChanged` event. XAML buttons take their behaviour from one, and WPF's `RoutedCommand` implements it.
  - Qt: [`QUndoStack`](https://doc.qt.io/qt-6/qundostack.html) calls a command's `redo()` when it is pushed, deletes the undone commands on a new push, and supports merging, macros and an undo limit.
  - VS Code: every command is [registered](https://code.visualstudio.com/api/extension-guides/command#registering-a-command) under a string ID, keybindings, menus and the Command Palette refer to that ID, and `vscode.commands.executeCommand` runs a command by ID with arguments. Because an ID with arguments is plain data, a command can even be a link: [command URIs](https://code.visualstudio.com/api/extension-guides/command#command-uris) work in Markdown hovers. A registered command is just a named callback with no `undo()`: Command in its simplest form, keeping what triggers an action apart from what it does.
- **At system scale.** [CQRS](../cqrs/) is built around commands: task-shaped requests such as *book a hotel room* rather than updates to fields, which the write side validates and often takes from a queue. The command object that executes itself becomes a data-only message and a handler, as above. A work queue applies the same idea to background jobs: a request turned into a message that waits until a worker is free ([Queue-Based Load Leveling](../queue-based-load-leveling/), [Competing Consumers](../competing-consumers/)). [Event Sourcing](../event-sourcing/) keeps the *events* a system produced, not the commands, and rebuilds state by replaying them. Replaying commands would run their validation and their side effects again (a call to a payment provider, say); events record the outcome, and even then a replay must keep external systems out of it, as [Fowler's article](https://martinfowler.com/eaaDev/EventSourcing.html) explains. Undo has a system-scale cousin too: a [saga](../saga-orchestration/) can't roll back the steps it has already committed, so when a later step fails it runs compensating actions in reverse order.
- **Relatives.**
  - *Memento* restores a snapshot instead of running an inverse (see above), and a command can keep a memento of the part it changes.
  - *Composite* is how macros are built: a command made of commands.
  - [Strategy](../strategy/) also puts behaviour in an object behind a small interface. A strategy is one way of doing a job its context always does, plugged in to change *how* it is done; a command is a request, *what* to do, bound to its receiver and arguments, and it can be kept, delayed, logged and undone.
  - *Chain of Responsibility* can pass a request object, much like a command, along a chain of handlers until one of them takes it.
  - *Prototype*: copy a reusable command before it goes into the history.
  - [Observer](../observer/) deals in events, not commands: a subject announces that something happened, and each observer decides what to do about it.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- Memento *(planned)* — Capture an object's state in a snapshot only it can read, so it can be restored later without breaking encapsulation.
- Composite *(planned)* — Treat single objects and groups of objects through one interface, so a whole tree answers a question the way one leaf does.
- [Strategy](../strategy/) — Put interchangeable algorithms behind one interface and choose one at runtime, instead of branching inside the caller.
- Chain of Responsibility *(planned)* — Pass a request along a chain of handlers until one handles it, so the sender never needs to know which one will.
- [CQRS](../cqrs/) — Separate the write model (commands) from read models (queries), each optimised for its job.
- [Event Sourcing](../event-sourcing/) — Store every change as an immutable event and rebuild state by replaying them.
- [Queue-Based Load Leveling](../queue-based-load-leveling/) — A queue absorbs traffic spikes so the backend can work at a steady pace.

## References

- [Gamma, Helm, Johnson and Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software (1994)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610)
- [Refactoring.Guru — Command](https://refactoring.guru/design-patterns/command)
- [Java SE 27 API — javax.swing.undo.UndoManager](https://docs.oracle.com/en/java/javase/27/docs/api/java.desktop/javax/swing/undo/UndoManager.html)
- [Java SE 27 API — javax.swing.Action](https://docs.oracle.com/en/java/javase/27/docs/api/java.desktop/javax/swing/Action.html)
- [Qt 6 — QUndoStack Class](https://doc.qt.io/qt-6/qundostack.html)
- [Visual Studio Code Extension API — Commands](https://code.visualstudio.com/api/extension-guides/command)
- [Azure Architecture Center — CQRS pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)
- [Martin Fowler — Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)
- [Martin Fowler — What do you mean by “Event-Driven”?](https://martinfowler.com/articles/201701-event-driven.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
