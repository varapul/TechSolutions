## ปัญหา

toolbar ของ text editor เริ่มต้นแบบง่าย ๆ ปุ่ม Insert เรียก `doc.insert(5, ' world')` ปุ่ม Delete เรียก `doc.delete(0, 6)` แล้วข้อความก็เปลี่ยนทันที จากนั้น request ที่คุ้นกันดีก็ตามมา: Ctrl+Z เพื่อ undo การแก้ครั้งล่าสุด และ Ctrl+Y เพื่อ redo, ตัวอัด macro ที่เล่นการแก้หลาย ๆ ครั้งต่อกันซ้ำได้, โหมดทำงานร่วมกันที่ส่งการแก้ทุกครั้งไปที่ server และการกู้งานที่ยังไม่ได้ save หลังโปรแกรม crash

ไม่มีอะไรในนี้ที่สร้างได้ ถ้าการแก้ยังเป็นแค่การเรียก method พอการเรียก return ไปแล้ว ก็ไม่มีอะไรจำไว้ว่า method ไหนรันไป ด้วย argument อะไร หรือ delete ลบข้อความไหนไป ทำให้ undo ไม่มีอะไรให้ทำงานด้วย และไม่มีอะไรให้จัดกลุ่ม เก็บ ส่ง หรือ replay การเชื่อมต่อก็แข็งด้วย: ปุ่มแต่ละปุ่มเรียก method ตัวเดียวของ class ตัวเดียว ทำให้ menu item, ปุ่มบน toolbar และ keyboard shortcut ที่ทำสิ่งเดียวกันต้องเขียนการเรียกซ้ำกันทุกตัว พร้อมการเช็กว่าตอนนี้ทำได้หรือเปล่า

## ทำงานยังไง

Command ทำให้ตัว request เองเป็น object ตัว object เก็บสิ่งที่ต้องใช้ในการทำ request นั้นทีหลัง: ตัว receiver ที่มันจะไปทำงานด้วย ตัว argument และถ้ามัน undo ได้ ก็เก็บอะไรก็ตามที่ต้องจำไว้เพื่อย้อนผลของมัน โค้ดที่สั่งมัน (ปุ่ม, shortcut หรือ scheduler) รู้จักแค่ interface เล็ก ๆ ตัวเดียว ปกติก็คือ method `execute()` ตัวเดียว และไม่เคยรู้ว่า class ไหนทำงานหรือทำยังไง พอ request กลายเป็นค่าค่าหนึ่งแล้ว ก็เก็บไว้ ส่งต่อ เข้า queue เขียน log ทำซ้ำ และ undo ได้เหมือนค่าอื่น ๆ Gamma, Helm, Johnson และ Vlissides อธิบาย pattern นี้ไว้ใน *Design Patterns* (1994) และในเล่มก็ให้ชื่ออื่นไว้ด้วยว่า *Action* และ *Transaction*

| ส่วนประกอบ | ใน diagram | หน้าที่ |
|---|---|---|
| **Command** | `Command` | interface ที่ทุก request implement: `execute()` และมี `undo()` ด้วยถ้า request นั้นย้อนกลับได้ |
| **ConcreteCommand** | `InsertText`, `DeleteText` | ผูก receiver หนึ่งตัวเข้ากับ action หนึ่งอย่างพร้อม argument ของมัน และเก็บอะไรก็ตามที่ `undo()` ของมันจะต้องใช้ |
| **Receiver** | `Document` | ทำงานจริง (`insert`, `delete`) มันไม่รู้ด้วยซ้ำว่ามี command อยู่ |
| **Invoker** | `History` | สั่งให้ command รัน แล้วเก็บมันไว้หลังจากนั้น ในที่นี้เก็บไว้ใน undo stack กับ redo stack |
| **Client** | `Toolbar` | สร้าง concrete command แต่ละตัว ใส่ receiver กับ argument ให้ แล้วส่งให้ invoker |

`History` พึ่งแค่ `Command` มันเลยสั่ง `InsertText`, `DeleteText` หรือ command ที่จะเขียนปีหน้า ให้รัน undo และ redo ได้โดยไม่ต้องเปลี่ยนตัวเอง ส่วน `Document` ไม่รู้เลยว่ากำลังถูกสั่งงานผ่าน command: มันแค่มี `insert` กับ `delete`

**command เก็บอะไรไว้เพื่อ undo ตัวเอง** `undo()` รัน operation ที่ทำกลับกัน command เลยต้องถือข้อมูลที่ operation กลับกันนั้นต้องใช้ สำหรับ `InsertText` แค่ argument ก็พอ: ลบตัวอักษร `s.length` ตัวที่ `at` ก็ย้อนการแทรก `s` ที่ `at` ได้ แต่ `DeleteText` ไม่เหมือนกัน argument ของมันบอกว่าที่ไหนและกี่ตัวอักษร แต่ไม่ได้บอกว่าตัวไหน ทำให้ `execute()` ของมันต้องเก็บข้อความที่ลบไป (`'Hello '`) และ `undo()` ของมันก็แทรกข้อความนั้นกลับเข้าไปแบบเป๊ะ ๆ หลักทั่วไปคือ command เก็บทุกค่าที่ operation ของมันทำลายหรือเขียนทับ (ข้อความที่ลบ สีเดิม ตำแหน่งเก่า) โดยเก็บตอนที่มัน execute ไม่ใช่มาคำนวณใหม่ตอน undo

**operation กลับกัน หรือ snapshot** อีกทางคือ Memento pattern: save snapshot ของ document ไว้ก่อนการแก้แต่ละครั้ง แล้ว restore มันตอน undo ตัว snapshot ง่ายและถูกต้องเป๊ะเสมอ และเป็นทางเดียวที่มีถ้า operation ไม่มีตัวกลับกันที่ใช้ได้จริง อย่าง blur filter ที่ใส่ให้ภาพ แต่มันกิน memory ยกเว้น state จะเป็นโครงสร้างแบบ immutable ที่แชร์ส่วนที่ไม่เปลี่ยนกันระหว่างเวอร์ชัน ส่วน operation กลับกันเก็บแค่ส่วนต่าง แต่ command ทุกตัวต้องมีของมัน ทั้งเขียนและ test และ operation กลับกันที่ถูกแค่เกือบ ๆ จะดัน document ให้ห่างจากต้นฉบับทีละนิดทุกครั้งที่ undo และ redo สองแบบนี้ใช้ร่วมกันได้ดี: หนังสือ GoF แนะนำให้ command เก็บ memento ไว้เฉพาะส่วนที่มันเปลี่ยน undo ของมันจะได้ restore ส่วนนั้นได้เป๊ะ

**stack สองตัว** undo จะ pop command ล่าสุดออกจาก undo stack เรียก `undo()` ของมัน แล้ว push ลง redo stack ส่วน redo จะ pop ออกจาก redo stack เรียก `execute()` อีกครั้ง แล้ว push command กลับลง undo stack การ execute command *ใหม่* จะล้าง redo stack: command ที่ถูก undo ไปถูกบันทึกไว้กับข้อความเวอร์ชันที่การแก้ครั้งใหม่ได้แทนที่ไปแล้ว ตำแหน่งและข้อความที่มันเก็บไว้เลยไม่เข้ากันอีกต่อไป ทั้ง `UndoManager` ของ Swing และ `QUndoStack` ของ Qt ทิ้งการแก้ที่ถูก undo ไปเมื่อมีการแก้ใหม่เข้ามา ส่วน Vim เก็บไว้แทน เป็น [branch ของ undo tree](https://vimhelp.org/undo.txt.html#undo-branches) โดยแลกกับ model ที่ซับซ้อนขึ้นเวลาจะเดินไปมาในนั้น

**macro คือ composite command** macro คือ command ที่ถือ list ของ command ตัว `execute()` ของมันรันพวกนั้นตามลำดับ ส่วน `undo()` ของมัน undo ย้อนลำดับ และ `History` มอง macro ทั้งก้อนเป็นขั้นเดียว นี่คือ Composite pattern ที่เอามาใช้กับ command ตัวอย่างในหนังสือ GoF คือ `MacroCommand` ส่วน Qt สร้าง macro ด้วย [`QUndoStack::beginMacro()`](https://doc.qt.io/qt-6/qundostack.html#beginMacro) กับ `endMacro()` และ [`CompoundEdit`](https://docs.oracle.com/en/java/javase/27/docs/api/java.desktop/javax/swing/undo/CompoundEdit.html) ของ Swing ก็รวมการแก้เล็ก ๆ ให้เป็นอันเดียว

## โค้ด

TypeScript ที่ตรงกับ diagram ตัว Node 22.18 ขึ้นไปรันได้เลยตามนี้ (`node editor.ts`) โดยตัด type ทิ้ง ส่วน `tsc --noEmit` ก็เช็ก type ให้

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

ผลลัพธ์:

```
Hello world
world
Hello world
Hello
Hello world
Hello world!
```

## ใช้ตอนไหนดี

- undo และ redo ที่ action แต่ละตัวบอกตัวกลับกันของตัวเองได้: text editor และ code editor, เครื่องมือวาดและออกแบบ, spreadsheet, ตัวสร้าง form และหน้าเว็บ
- action เดียวที่เรียกได้จากหลายที่ (menu item, ปุ่มบน toolbar, shortcut, command palette) command object ตัวเดียวถือทั้งพฤติกรรม label และสถานะ enabled แล้ว control ทุกตัวก็ใช้มัน
- งานที่ควรรันทีหลังหรือรันที่อื่น: job queue, scheduler, retry loop, batch ที่รันข้ามคืน
- บันทึกว่ามีการขออะไรไปบ้าง เพื่อเอาไป audit หรือเอาไป replay จาก state เริ่มต้นที่รู้แน่ชัดหลังโปรแกรม crash
- macro และ scripting: อัดสิ่งที่ผู้ใช้ทำแล้วเล่นซ้ำ
- ใช้การเรียก method หรือ function ธรรมดาดีกว่า ถ้า action นั้นถูกเรียกตรง ๆ อย่างเดียว และไม่เคยถูกเก็บไว้, ถูก undo หรือถูกเลื่อนไปทำทีหลัง

## ได้อะไร เสียอะไร

- **หนึ่ง class ต่อหนึ่ง action** ทุก operation กลายเป็น class เล็ก ๆ ที่มี `undo()` ของตัวเอง แล้วหลายสิบตัวก็รวมกันเป็นภาระ ส่วน closure ก็ตัดพิธีรีตองส่วนใหญ่ออกไปได้ (ดู *ข้อควรรู้ตอนลงมือทำ*)
- **undo ต้องเป๊ะ** operation กลับกันแต่ละตัวคือโค้ดที่ต้องถูกสำหรับทุก input รวมถึงกรณีขอบ (ลบที่ท้ายข้อความ แทรกลงใน document ว่าง) และต้องถูกต่อไปเมื่อ receiver เปลี่ยน ถ้าผิดก็จะทำ document พังแบบเงียบ ๆ
- **บาง action undo ไม่ได้** การส่ง email หรือตัดเงินจากบัตรทำได้แค่ชดเชย (แก้ไขรายการ คืนเงิน) แต่ย้อนกลับไม่ได้ ให้กัน command แบบนี้ออกจาก undo history หรือให้มันมี compensating action ที่ชัดเจน อย่างที่ [Compensating Transaction](../compensating-transaction/) ทำข้าม service
- **history กิน memory** command แต่ละตัว และอะไรก็ตามที่มันเก็บไว้เพื่อ undo ตัวเอง จะยังอยู่ตราบที่มันอยู่บน stack ให้จำกัดขนาด history (`UndoManager` ของ Swing เก็บ 100 การแก้โดย default และ `QUndoStack` มี [`undoLimit`](https://doc.qt.io/qt-6/qundostack.html#undoLimit-prop)) และรวมการแก้เล็ก ๆ เข้าด้วยกัน
- **ต้องตามอ่านเพิ่มอีกทอดหนึ่ง** โค้ดของ toolbar เขียนว่า `history.execute(new InsertText(doc, 5, ' world'))` ไม่ได้บอกว่าอะไรเปลี่ยน พฤติกรรมเลยอยู่ห่างออกไปอีกหนึ่ง class
- **ส่วนที่ได้คืนมา** invoker เป็นอิสระจาก receiver, action ใหม่ไม่ต้องแก้ `History` หรือการเชื่อมต่อของ toolbar และทุก request ก็กลายเป็นสิ่งที่เก็บ, ตรวจดู, test, เข้า queue และ replay ได้

## ข้อควรรู้ตอนลงมือทำ

- **แบบ functional** ในภาษาที่มี closure ตัว command เป็น function สองตัวแทน class ได้:

  ```ts
  function deleteText(doc: Document, at: number, n: number): Command {
    let removed = '';
    return {
      execute: () => { removed = doc.delete(at, n); },
      undo: () => doc.insert(at, removed),
    };
  }
  ```

  closure จับ receiver กับ argument ไว้ และตัวแปร `removed` ที่ใช้ร่วมกันก็ทำหน้าที่แทน field ของ `DeleteText` ถ้าไม่มี undo ตัว command ก็หดเหลือ function เดียว นี่คือเหตุผลที่การใช้ pattern นี้หลาย ๆ ที่เป็นแค่ callback ธรรมดา: click handler, function ที่ส่งให้ `setTimeout` หรือ `Runnable` ที่ส่งให้ [`Executor`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/concurrent/Executor.html) ของ Java โดยที่ documentation ของ Executor อธิบายว่ามันเป็นทางแยกโค้ดที่ส่งงานออกจากเรื่องว่างานนั้นรันยังไงและรันที่ไหน ส่วน class จะคุ้มค่าก็ตอนที่ command ต้องมีชื่อ, equality, serialisation หรือ method เพิ่มอย่าง `canExecute()` หรือ `merge()`
- **freeze command หลังมันรันแล้ว** หลังจาก command execute และขึ้นไปอยู่บน stack แล้ว อย่าไปเปลี่ยนมัน เพราะ `History` พึ่ง field ของมันในการ undo ส่วน Qt ก็ย้ำเรื่องนี้ไว้ใน documentation ของ [`QUndoStack::command()`](https://doc.qt.io/qt-6/qundostack.html#command): stack จะคืน command ที่ push ไปแล้วเป็นแค่ const pointer เพราะการเปลี่ยนมันหลังจากที่รันไปแล้วแทบจะแน่นอนว่าทำ document พัง ถ้าปุ่มใช้ command object ที่ตั้งค่าไว้ตัวเดียวซ้ำทุกครั้งที่กด ให้ก็อปมันก่อนขึ้น stack ตรงนี้หนังสือ GoF ชี้ว่าตอนนั้น command ก็ทำหน้าที่เป็น [Prototype](../prototype/)
- **รวมการแก้เล็ก ๆ** ถ้าพิมพ์ "world" เป็น command ตัวอักษรเดียวห้าตัว ก็ต้อง undo ห้าครั้งกว่าจะลบหมด editor เลยรวม command ประเภทเดียวกันที่ต่อกันให้เป็นขั้นเดียว: [`QUndoCommand::mergeWith()`](https://doc.qt.io/qt-6/qundocommand.html#mergeWith) ของ Qt และ [`UndoableEdit.addEdit()`](https://docs.oracle.com/en/java/javase/27/docs/api/java.desktop/javax/swing/undo/UndoableEdit.html#addEdit(javax.swing.undo.UndoableEdit)) ของ Swing มีไว้เพื่อเรื่องนี้
- **command ที่เดินทาง** พอ command ออกจาก process ไป ไม่ว่าจะเป็น message ใน queue, request ไปที่ server หรือบรรทัดใน log มันก็พก object reference หรือ closure ไปด้วยไม่ได้ มันกลายเป็นข้อมูล ที่มี type, argument และ ID ของสิ่งที่มันไปทำงานด้วย (`{ type: 'InsertText', docId: 'd-42', at: 5, text: ' world' }`) และ handler ฝั่งรับก็ถือ logic ที่ `execute()` เคยมี เรื่องที่ต้องคิดตามมามีสามข้อ:
  - *Validation* ตัว receiver อาจปฏิเสธ command (document เป็น read-only, ตำแหน่งอยู่เกินท้ายข้อความไปแล้ว) command เลยเป็นการขอ ไม่ใช่คำสัญญา
  - *Idempotency* ตัว broker ที่ทำ message หายไม่ได้จะส่ง message อย่างน้อยหนึ่งครั้ง เลยต้องให้ command แต่ละตัวมี ID แล้วให้ handler ข้ามตัวที่เคยทำไปแล้ว ([Idempotent Consumer](../idempotent-consumer/))
  - *Versioning* ตัว command ที่เขียนลง log ต้องยังอ่านได้ หลังจากโค้ดที่เขียนมันเปลี่ยนไปแล้ว
- **command หรือ event** command คือคำสั่ง ตั้งชื่อเป็นประโยคคำสั่ง (`InsertText`, `BookRoom`, `PlaceOrder`) มันไปหา handler ตัวเดียว และ handler อาจปฏิเสธมันได้ ส่วน event คือข้อเท็จจริง ตั้งชื่อเป็น past tense (`TextInserted`, `RoomBooked`, `OrderPlaced`) มันเกิดขึ้นไปแล้ว listener กี่ตัวก็ react กับมันได้ และไม่มีตัวไหนปฏิเสธมันได้ Martin Fowler เรียก event ที่แอบคาดหวังให้ listener ลงมือทำอะไรสักอย่างว่า [*passive-aggressive command*](https://martinfowler.com/articles/201701-event-driven.html): ถ้าต้องการให้อะไรเกิดขึ้น ก็บอกออกมาตรง ๆ ด้วย command ส่วนคำแนะนำเรื่องการตั้งชื่อก็ใช้ในทางกลับกันได้ด้วย ตัว Redux dispatch action คล้าย ๆ กับที่ invoker รัน command แต่ style guide ของมันแนะนำให้ [model action เป็น event ไม่ใช่ setter](https://redux.js.org/style-guide/#model-actions-as-events-not-setters) เพราะชื่อที่บอกว่าเกิดอะไรขึ้นทำให้ log มีความหมายมากกว่า
- **ใน UI framework และ editor**
  - Java Swing: [`Action`](https://docs.oracle.com/en/java/javase/27/docs/api/java.desktop/javax/swing/Action.html) ให้ menu item กับปุ่มบน toolbar ใช้พฤติกรรม, label, icon และสถานะ enabled ชุดเดียวกัน พอ disable action ก็เลย disable ทั้งสองตัว ส่วน [`UndoManager`](https://docs.oracle.com/en/java/javase/27/docs/api/java.desktop/javax/swing/undo/UndoManager.html) เก็บ object `UndoableEdit` ที่แต่ละตัวมี `undo()` กับ `redo()` และตัวมันเองก็เป็น `CompoundEdit`
  - .NET: [`ICommand`](https://learn.microsoft.com/en-us/dotnet/api/system.windows.input.icommand) ประกาศ `Execute`, `CanExecute` และ event `CanExecuteChanged` ปุ่มใน XAML เอาพฤติกรรมมาจากมัน และ `RoutedCommand` ของ WPF ก็ implement มัน
  - Qt: [`QUndoStack`](https://doc.qt.io/qt-6/qundostack.html) เรียก `redo()` ของ command ตอนที่มันถูก push แล้วลบ command ที่ถูก undo ไปเมื่อมีการ push ใหม่ และรองรับการ merge, macro และ undo limit
  - VS Code: ทุก command ถูก [register](https://code.visualstudio.com/api/extension-guides/command#registering-a-command) ไว้ใต้ string ID โดยที่ keybinding, menu และ Command Palette อ้างถึง ID นั้น และ `vscode.commands.executeCommand` ก็รัน command ด้วย ID พร้อม argument เพราะ ID กับ argument เป็นแค่ข้อมูลธรรมดา command เลยเป็น link ได้ด้วย: [command URI](https://code.visualstudio.com/api/extension-guides/command#command-uris) ใช้ได้ใน Markdown hover ส่วน command ที่ register ไว้ก็แค่ callback ที่มีชื่อและไม่มี `undo()`: Command ในรูปแบบที่ง่ายที่สุด ที่แยกสิ่งที่สั่ง action ออกจากสิ่งที่ action ทำ
- **ที่ระดับระบบ** [CQRS](../cqrs/) สร้างขึ้นรอบ command: request ที่มีรูปร่างเป็นงาน อย่าง *จองห้องพักโรงแรม* แทนที่จะเป็นการ update field โดยที่ฝั่ง write จะ validate มัน และมักรับมันมาจาก queue ตัว command object ที่ execute ตัวเองได้จะกลายเป็น message ที่มีแต่ข้อมูล บวกกับ handler อย่างที่ว่าไว้ข้างบน ส่วน work queue ใช้แนวคิดเดียวกันกับ background job: request ที่ถูกแปลงเป็น message แล้วรอจนกว่าจะมี worker ว่าง ([Queue-Based Load Leveling](../queue-based-load-leveling/), [Competing Consumers](../competing-consumers/)) ส่วน [Event Sourcing](../event-sourcing/) เก็บ *event* ที่ระบบสร้างขึ้น ไม่ได้เก็บ command แล้วสร้าง state ใหม่ด้วยการ replay event พวกนั้น การ replay command จะรัน validation และ side effect ของมันซ้ำอีกรอบ (อย่างการเรียก payment provider) แต่ event บันทึกผลลัพธ์ไว้ และถึงอย่างนั้นการ replay ก็ต้องกันระบบภายนอกออกไป อย่างที่ [บทความของ Fowler](https://martinfowler.com/eaaDev/EventSourcing.html) อธิบายไว้ undo เองก็มีญาติที่ระดับระบบ: [saga](../saga-orchestration/) rollback ขั้นที่ commit ไปแล้วไม่ได้ พอขั้นหลัง ๆ fail มันเลยรัน compensating action ย้อนลำดับ
- **ญาติ ๆ**
  - [Memento](../memento/) restore snapshot แทนการรัน operation กลับกัน (ดูข้างบน) และ command ก็เก็บ memento ของส่วนที่มันเปลี่ยนไว้ได้
  - [Composite](../composite/) คือวิธีสร้าง macro: command ที่ประกอบขึ้นจาก command
  - [Strategy](../strategy/) ก็ใส่พฤติกรรมไว้ใน object ที่อยู่หลัง interface เล็ก ๆ เหมือนกัน strategy คือวิธีหนึ่งในการทำงานที่ context ของมันทำอยู่แล้วเสมอ เสียบเข้าไปเพื่อเปลี่ยนว่าจะทำ*ยังไง* ส่วน command คือ request ว่าจะทำ*อะไร* ผูกอยู่กับ receiver และ argument ของมัน และเก็บไว้ เลื่อนไปทำทีหลัง เขียน log และ undo ได้
  - [Chain of Responsibility](../chain-of-responsibility/) ส่ง request object ที่คล้าย command ไปตามสายของ handler ได้ จนกว่าจะมีตัวหนึ่งรับไป
  - [Prototype](../prototype/): ก็อป command ที่ใช้ซ้ำได้ก่อนจะใส่ลงใน history
  - [Observer](../observer/) ทำงานกับ event ไม่ใช่ command: subject ประกาศว่ามีอะไรเกิดขึ้น แล้ว observer แต่ละตัวก็ตัดสินเองว่าจะทำอะไรกับเรื่องนั้น
