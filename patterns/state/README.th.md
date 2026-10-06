## ปัญหา

order ออนไลน์มีวงจรชีวิตสั้น ๆ: รอจ่ายเงิน จ่ายแล้ว ส่งแล้ว และถูกยกเลิกระหว่างทางได้ สิ่งที่ `pay()`, `ship()` และ `cancel()` ควรทำ ขึ้นกับว่า order อยู่ที่ขั้นไหน จ่ายซ้ำต้องถูกปฏิเสธ จะส่งของได้ต้องจ่ายก่อน และพอพัสดุออกไปแล้วก็ยกเลิกไม่ได้อีก: ลูกค้าต้องส่งของคืนแทน

เวอร์ชันแรกเก็บขั้นไว้ใน field `status` แล้วทุก method ก็แตก branch ตามค่านี้ด้วย `switch` สี่ status กับสาม method ได้ 12 branch และกฎของ status ไหนก็ตามก็กระจายอยู่ในทั้งสาม method ถ้าอยากรู้ว่า order ที่ส่งแล้วทำอะไรได้บ้าง ก็ต้องอ่านครบทุกตัว ไม่มีตรงไหนบอกว่า status ไหนตามหลัง status ไหนได้: การเปลี่ยนผ่าน (transition) ซ่อนอยู่ในการกำหนดค่า `status` ข้างใน branch

ที่เจ็บจริงคือตอนเพิ่ม status ถัดไป การตรวจ fraud ที่ hold การจ่ายเงินแต่ละครั้งไว้ระหว่าง Pending กับ Paid ต้องเพิ่ม case ใหม่ในทุก switch ที่ดู `status`: ในที่นี้คือสามที่ และใน codebase จริงก็ต้องเพิ่มใน view, e-mail และ report ด้วย ส่วน case ที่ลืมไปมักยัง compile ผ่าน ถ้า `cancel()` ไม่มี case สำหรับ `'onHold'` การยกเลิก order ที่กำลังถูกตรวจอยู่ก็จะหลุดผ่าน switch ไปเฉย ๆ โดยไม่ทำอะไรเลย และไม่มีใครรู้เรื่อง

## ทำงานยังไง

State ย้ายพฤติกรรมที่ขึ้นกับ state ของ object ไปไว้ใน class หนึ่งตัวต่อหนึ่ง state ตัว object เอง (เรียกว่า *context*) ถือ reference ไปที่ object ของ state ปัจจุบัน แล้วส่งทุกการเรียกที่ขึ้นกับ state ต่อให้มัน การเปลี่ยน reference ตัวนั้นจะเปลี่ยนสิ่งที่การเรียกครั้งถัดไปทำ มองจากข้างนอกเลยเหมือน order เปลี่ยน class ของตัวเองตอนที่ย้ายจาก Pending ไป Paid ตัว pattern นี้เป็นหนึ่งใน behavioural pattern ใน *Design Patterns* ของ Gamma, Helm, Johnson และ Vlissides (1994) และในเล่มก็เรียกมันอีกชื่อว่า *Objects for States*

| ส่วนประกอบ | ใน diagram | หน้าที่ |
|---|---|---|
| **Context** | `Order` | class ที่ client ใช้ มันถือ state object ปัจจุบัน ส่งแต่ละการเรียกที่ขึ้นกับ state ต่อให้ object นั้น แล้วย้ายไปที่ state ที่การเรียกคืนกลับมา client ไม่เคยเห็น state object เลย |
| **State** | `OrderState` | interface ที่มีหนึ่ง method ต่อหนึ่งการเรียกที่ความหมายขึ้นกับ state ในที่นี้คือ `pay`, `ship` และ `cancel` |
| **ConcreteState** | `Pending`, `Paid`, `Shipped`, `Cancelled` และต่อมาก็ `OnHold` | ความหมายของแต่ละการเรียกใน state หนึ่ง: ทำงานแล้วบอกชื่อ state ถัดไป หรือปฏิเสธ |

การตัดสินใจ 12 อย่างจาก step 1 ไม่ได้หายไป มันแค่ย้ายจาก switch สามตัวที่จัดกลุ่มตาม method ไปอยู่ใน class สี่ตัวที่จัดกลุ่มตาม state ทำให้ diagram ยังมี 12 ช่องเท่าเดิม แค่จัดกลุ่มใหม่ ตอนนี้ class เดียวตอบได้ว่า order ที่ส่งแล้วทำอะไรได้บ้าง ช่อง `→` แต่ละช่องคือลูกศรหนึ่งเส้นใน state diagram และ state ใหม่ก็คือ class ใหม่หนึ่งตัว บวกกับ transition ที่พาเข้ามาหามัน

**ใครเป็นคนเปลี่ยน state** คือเรื่องหลักที่ pattern นี้เปิดไว้ให้เราตัดสินเอง:

- **ตัว state เอง** แบบในที่นี้: แต่ละ state บอกชื่อตัวที่มาต่อจากมัน `Pending.pay()` เลยคืน state `Paid` กฎของ state หนึ่งยังอยู่รวมกัน และ state ใหม่ก็แตะแค่ state ที่พาเข้ามาหามัน แต่ตอนนี้ state ต่าง ๆ ก็ขึ้นกับกันเอง (`Pending` รู้จัก `Paid` และ `Cancelled`) ตัว state เปลี่ยน context เองได้ผ่าน method อย่าง `order.setState(next)` หรือจะคืน state ถัดไปแล้วให้ context เป็นคนกำหนดก็ได้ แบบที่โค้ดข้างล่างทำ การคืนค่าทำให้ setter ที่ client ไม่ควรเรียกไม่ต้องอยู่ใน interface ของ `Order` และทำให้ `Order` มีที่เดียวสำหรับ log, เช็ก และ save ทุก transition
- **ตัว context**: `Order` เปิดหา state ถัดไปจากตารางของคู่ (state, การเรียก) ส่วน state ทำแค่งานของมัน ทำให้ state ต่าง ๆ เป็นอิสระต่อกัน และอ่าน transition ทั้งหมดได้จากที่เดียว แต่ state ใหม่ทุกตัวหมายถึงต้องแก้ตารางนั้นด้วย แบบนี้เหมาะกับชุด transition ที่เล็กและตายตัว

## โค้ด

TypeScript ที่ตรงกับ diagram ตัวโค้ดรันด้วย Node 22.18 ขึ้นไปได้เลย (`node order.ts`) โดยตัด type ทิ้ง ส่วน `tsc --noEmit --strict` ใช้เช็ก type ได้ ตัว method ของแต่ละ state คืน state ถัดไป หรือ throw `Refused` พร้อมเหตุผล และ `Order.handle()` คือที่เดียวที่สลับ state, เขียน log และส่งการปฏิเสธต่อให้คนเรียก ตัว state ไม่มี field เลยใช้ instance เดียวร่วมกันได้ทุก order

```ts
import assert from 'node:assert/strict';

// State: what pay(), ship() and cancel() mean in one state. Each call
// returns the order's next state, or throws Refused with the reason.
interface OrderState {
  readonly name: string;
  pay(order: Order): OrderState;
  ship(order: Order): OrderState;
  cancel(order: Order): OrderState;
}
class Refused extends Error {}
const refuse = (reason: string): never => { throw new Refused(reason); };

// ConcreteStates: one class per state. They keep no fields, so one shared
// instance of each (created below the classes) serves every order.
class Pending implements OrderState {
  readonly name = 'Pending';
  pay(): OrderState { return PAID; }
  ship(): OrderState { return refuse('pay first'); }
  cancel(): OrderState { return CANCELLED; }
}
class Paid implements OrderState {
  readonly name = 'Paid';
  pay(): OrderState { return refuse('already paid'); }
  ship(): OrderState { return SHIPPED; }
  cancel(order: Order): OrderState { order.refund(); return CANCELLED; }
}
class Shipped implements OrderState {
  readonly name = 'Shipped';
  pay(): OrderState { return refuse('already paid'); }
  ship(): OrderState { return refuse('already shipped'); }
  cancel(): OrderState { return refuse('too late, start a return'); }
}
class Cancelled implements OrderState {
  readonly name = 'Cancelled';
  pay(): OrderState { return refuse('order is cancelled'); }
  ship(): OrderState { return refuse('order is cancelled'); }
  cancel(): OrderState { return refuse('order is cancelled'); }
}
const PENDING = new Pending(), PAID = new Paid(), SHIPPED = new Shipped(), CANCELLED = new Cancelled();

// Context: clients call Order, and Order hands each call to its current state.
class Order {
  private state: OrderState = PENDING;
  readonly log: string[] = [];
  get status(): string { return this.state.name; }
  pay(): void { this.handle('pay', (s) => s.pay(this)); }
  ship(): void { this.handle('ship', (s) => s.ship(this)); }
  cancel(): void { this.handle('cancel', (s) => s.cancel(this)); }
  refund(): void { this.log.push('refund issued'); }

  private handle(call: string, run: (state: OrderState) => OrderState): void {
    const from = this.state.name;
    try { this.state = run(this.state); } catch (err) {
      if (err instanceof Refused) this.log.push(`${call}(): refused in ${from}: ${err.message}`);
      throw err; // never swallowed: the caller hears about every refusal
    }
    this.log.push(`${call}(): ${from} → ${this.state.name}`);
  }
}

// Step 3 of the diagram: three calls on one order, three different outcomes.
const refusedWith = (reason: string) => (err: unknown) => err instanceof Refused && err.message === reason;
const order = new Order();
order.pay();
order.ship();
assert.throws(() => order.cancel(), refusedWith('too late, start a return'));
assert.equal(order.status, 'Shipped'); // a refused call leaves the state alone
console.log(order.log.join('\n'));

// Every other refusal, reached through Order's public methods only.
type Call = 'pay' | 'ship' | 'cancel';
const after = (...calls: Call[]): Order => { const o = new Order(); calls.forEach((c) => o[c]()); return o; };
assert.throws(() => after().ship(), refusedWith('pay first'));
assert.throws(() => after('pay').pay(), refusedWith('already paid'));
assert.throws(() => after('pay', 'ship').pay(), refusedWith('already paid'));
assert.throws(() => after('pay', 'ship').ship(), refusedWith('already shipped'));
for (const call of ['pay', 'ship', 'cancel'] as const) {
  assert.throws(() => after('cancel')[call](), refusedWith('order is cancelled'));
}
// Cancelling a paid order refunds it; a pending one has nothing to refund.
assert.deepEqual(after('pay', 'cancel').log, ['pay(): Pending → Paid', 'refund issued', 'cancel(): Paid → Cancelled']);
assert.deepEqual(after('cancel').log, ['cancel(): Pending → Cancelled']);
```

ผลลัพธ์:

```
pay(): Pending → Paid
ship(): Paid → Shipped
cancel(): refused in Shipped: too late, start a return
```

step 4 ของ diagram เพิ่ม class มาตัวเดียวคือ `OnHold`: `pay()` ของมันถามการตรวจ fraud ว่า order ผ่านแล้วหรือยัง ถ้าผ่านก็คืน `PAID` (และปฏิเสธไปจนกว่าจะผ่าน) `ship()` ของมันปฏิเสธ และ `cancel()` ของมันคืน `CANCELLED` บรรทัดเดิมที่ต้องเปลี่ยนมีแค่ body ของ `Pending.pay()` ที่ตอนนี้คืน instance ของ `OnHold` แทน ส่วน `Order`, `Paid`, `Shipped` และ `Cancelled` ยังเหมือนเดิม

## ใช้ตอนไหนดี

- object ที่ state ของมันเป็นตัวตัดสินว่า operation หลายตัวจะทำอะไร โดยมี `switch` หรือ `if` ต่อกันยาว ๆ บน field status ตัวเดียวกันในมากกว่าหนึ่ง method
- วงจรชีวิตที่มีกฎว่าอะไรมาต่อได้บ้าง: order, การจ่ายเงิน, เอกสารที่รอ review, support ticket, subscription, network connection, ฟอร์มหลายขั้นตอน ตัว pattern นี้ทำให้เห็นชัดว่าแต่ละ state ยอมให้เรียกอะไรได้บ้าง และทำให้การปฏิเสธที่เหลือเป็นการตั้งใจ
- state ที่ถูกเพิ่มเข้ามาเรื่อย ๆ หรือพฤติกรรมต่อ state ที่ใหญ่พอจะอ่านและ test แยกได้
- ไม่ใช่สำหรับสองสาม state ที่แต่ละตัวมีพฤติกรรมแค่บรรทัดเดียว: field กับ switch เล็ก ๆ ที่ compiler เช็กให้จะชัดกว่า (ดู *ตอนที่ switch ก็พอแล้ว* ข้างล่าง)
- ไม่ใช่ตอนที่มีแค่ transition ที่สำคัญ และ state แทบไม่ได้ทำอะไร: ตาราง transition สั้นกว่า
- ไม่ใช่ตอนที่ตัวเลือกถูกเลือกจากข้างนอกและไม่ได้เปลี่ยนเอง: แบบนั้นคือ [Strategy](../strategy/)

## ได้อะไร เสียอะไร

- **การกระจายแค่ย้ายที่** ทุกอย่างเกี่ยวกับ state หนึ่งอยู่ใน class เดียวแล้ว แต่ทุกอย่างเกี่ยวกับการเรียกหนึ่งตัวกลับกระจายไปอยู่ในทุก class: ถ้าอยากเห็นว่า `cancel()` ทำอะไรในทุก state ก็ต้องเปิดห้า class ตารางใน diagram แสดงทั้งสองมุมไว้พร้อมกัน
- **เพิ่ม state ใหม่ไม่แพง แต่เพิ่มการเรียกใหม่แพง** OnHold เป็น class เดียว แต่การเรียกใหม่อย่าง `approve()` ของคน review จะเพิ่ม method ให้ `OrderState` และเลยต้องเพิ่มให้ทุก state class ด้วย ส่วน base class ที่ปฏิเสธทุกการเรียกโดย default ช่วยให้การเปลี่ยนนี้เล็กลง แต่ compiler ก็จะไม่บังคับให้แต่ละ state ต้องตัดสินใจอีก: state ที่ควรรับการเรียกใหม่แต่ลืม override ก็จะปฏิเสธมันไป
- **state รู้จักกันเอง** ถ้า state เป็นคนเลือกตัวที่มาต่อ พวกมันก็ขึ้นกับกันเอง และจะเห็น machine ทั้งตัวได้ก็ต่อเมื่ออ่านครบทุก class ให้เก็บ state diagram ไว้ข้างโค้ด หรืออธิบาย machine เป็นข้อมูล (ดูข้างล่าง)
- **ชิ้นส่วนที่ขยับได้เยอะขึ้น** การเรียกวิ่งจาก context ไปที่ state object การ reproduce bug เลยต้องรู้ว่าตอนนั้น order อยู่ใน state ไหน นี่เป็นเหตุผลหนึ่งที่ควร log ทุก transition แบบที่ `Order` ทำ
- **สิ่งที่ได้กลับมา** คือแต่ละ state เป็น class เล็ก ๆ ที่อ่านและ test แยกได้ transition ชัดเจน การเรียกที่ไม่ถูกต้องถูกปฏิเสธในที่ที่เห็นชัดที่เดียว และ context ก็มีขนาดเท่าเดิมไม่ว่าจะมีกี่ state

## ข้อควรรู้ตอนลงมือทำ

### มันคือการ refactor

การไปจาก step 1 ถึง step 2 เป็นการ refactor ที่รู้จักกันดี catalog ของ Martin Fowler ระบุขั้นแรกว่าเป็น [*Replace Type Code with Subclasses*](https://refactoring.com/catalog/replaceTypeCodeWithSubclasses.html) ที่เรียกอีกชื่อว่า *Replace Type Code with State/Strategy* และขั้นที่สองว่าเป็น [*Replace Conditional with Polymorphism*](https://refactoring.com/catalog/replaceConditionalWithPolymorphism.html) ให้สร้าง state class ก่อน ย้าย switch เข้าไปทีละตัว (`pay()` แล้วก็ `ship()` แล้วก็ `cancel()`) และให้ test ผ่านหลังย้ายแต่ละครั้ง ส่วน field `status` จะกลายเป็น reference ไปที่ state object เป็นขั้นสุดท้าย

### ปฏิเสธการเรียกที่ไม่ถูกต้อง และบอกเหตุผล

การเรียกที่ state ปัจจุบันไม่อนุญาต ควร fail ด้วย error ที่บอกเหตุผล และไม่แตะ state อย่าเมินมันเงียบ ๆ เด็ดขาด: client ที่เรียก `cancel()` แล้วไม่ได้ยินอะไรกลับมา จะไปบอกลูกค้าว่า order ถูกยกเลิกแล้ว ในโค้ด การปฏิเสธแต่ละครั้งจะ throw `Refused` แล้ว `Order` ก็ log และ throw มันต่อ ส่วน error type เฉพาะทำให้คนเรียกแยกการปฏิเสธออกจาก bug ได้ และ HTTP API ก็ตอบมันด้วย `409 Conflict` ได้ [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-409-conflict) นิยาม status นี้ไว้สำหรับ request ที่ขัดกับ state ปัจจุบันของ resource เรื่องการเรียกซ้ำต้องตัดสินใจให้ชัด: ถ้า client มีการ retry ก็อาจดีกว่าถ้าตอบ `cancel()` ครั้งที่สองบน order ที่ยกเลิกไปแล้วว่าสำเร็จ แทนที่จะตอบเป็น error ขอแค่ทุกการเรียกซ้ำได้คำตอบเดียวกัน

### Entry action และ exit action

งานบางอย่างเป็นของ transition และบางอย่างเป็นของ state การคืนเงินเป็นของ transition จาก Paid ไป Cancelled เพราะการยกเลิก order ที่ยัง pending ไม่มีอะไรให้คืน มันเลยอยู่ใน `Paid.cancel()` ไม่ใช่ใน `Cancelled` งานที่ต้องเกิดไม่ว่าจะเข้า state มาทางไหน อย่างการบอกคลังสินค้าว่า order จ่ายแล้ว (ก่อน step 4 เข้า Paid มาจาก Pending และหลัง step 4 เข้ามาจาก OnHold) ควรอยู่ใน entry hook ที่ context เรียกหลังสลับ state ทุกครั้ง เช่น `next.onEnter(order)` ส่วน exit hook คือที่สำหรับหยุดสิ่งที่ state เริ่มไว้ อย่าง timer ของการ review ตอนที่ order ออกจาก OnHold ส่วน UML state machine ให้ state มีพฤติกรรม entry, exit และ *do* และผูก effect ไว้กับ transition ส่วน label ใน diagram ก็ใช้สัญลักษณ์ transition ของ UML: `pay [cleared]` คือการเรียกที่มี guard และ `cancel / refund` คือการเรียกที่มี effect ([UML 2.5.1](https://www.omg.org/spec/UML/2.5.1/) clause 14) library ข้างล่างก็มี hook แบบเดียวกันนี้ให้

### การเก็บ state ลง storage

object reference เก็บลง storage ไม่ได้ ให้เก็บชื่อของ state แทน เช่น `status = 'Shipped'` ใน column หนึ่ง แล้วตอน load order ก็สร้าง object ขึ้นมาใหม่จาก map ของชื่อไปหา state object (`{ Pending: PENDING, Paid: PAID, … }`) ให้ชื่อที่เก็บไว้นิ่งและไม่ขึ้นกับชื่อ class การเปลี่ยนชื่อ class จะได้ไม่ทำให้ row เก่าค้างเติ่ง และให้ database ปฏิเสธชื่อที่ไม่รู้จักด้วย check constraint หรือ enum type ส่วน request สองตัวอาจพยายามย้าย order เดียวกันพร้อมกัน เลยต้องให้การเขียนมีเงื่อนไขตาม state ที่การเรียกเริ่มต้นจาก อย่าง `UPDATE orders SET status = 'Paid' WHERE id = ? AND status = 'Pending'` หรือตามเลขเวอร์ชัน ถ้าไม่มี row ไหนเปลี่ยน แปลว่า request อื่นย้าย order ไปก่อนแล้ว: ให้ load ใหม่แล้วรันการเรียกอีกรอบ รอบนี้อาจโดนปฏิเสธก็ได้ [Event Sourcing](../event-sourcing/) กลับด้านเรื่องนี้ โดยเก็บ transition เองเป็น event แล้วสร้าง state ปัจจุบันขึ้นมาใหม่ด้วยการ replay ส่วน XState save machine ที่กำลังรันด้วย [`getPersistedSnapshot()`](https://stately.ai/docs/persistence) และ restore มันด้วย `createActor(machine, { snapshot })`

### ใช้ state object ร่วมกัน

state ในโค้ดไม่มี field เลยใช้ instance เดียวต่อ state กับทุก order ได้ ค่าคงที่ `PENDING`, `PAID`, `SHIPPED` และ `CANCELLED` ก็คือ instance พวกนั้น หนังสือชี้ไปที่ Flyweight สำหรับการแชร์แบบนี้ และสังเกตว่า state object มักเป็น singleton ค่าคงที่ระดับ module ให้ instance เดียวได้โดยไม่ต้องมีจุดเข้าถึงแบบ global ของ [Singleton](../singleton/) ส่วน state ที่ต้องมีข้อมูลของตัวเอง อย่าง review ID และ deadline ของ OnHold หรือจำนวน retry จะเก็บข้อมูลนั้นไว้ใน context หรือไม่ก็ถูกสร้างเป็น object ใหม่ทุก transition แล้วแบบนั้นก็แชร์ไม่ได้ enum ของ Java ทำให้แบบแชร์กระชับ: enum constant แต่ละตัวมี class body ของตัวเองได้ ([JLS §8.9.1](https://docs.oracle.com/javase/specs/jls/se27/html/jls-8.html#jls-8.9.1)) ตัว enum `OrderStatus` ที่ constant แต่ละตัว override `pay()`, `ship()` และ `cancel()` เลยเป็นชุดของ state object ที่แชร์กันได้ และเก็บลง storage ด้วยชื่อได้ด้วย

### State กับ Strategy

class diagram ของทั้งสองเหมือนกัน คือ context ที่ delegate ไปหา object หลัง interface แต่คนเลือก object ต่างกัน:

- ใน [Strategy](../strategy/) client เป็นคนเลือกอัลกอริทึมแล้วส่งให้ context ตัว strategy ไม่รู้จักกันเอง และตัวเลือกหนึ่งมักใช้ไปตลอดทั้งงาน
- ใน State ตัว state สลับแทนกันเองเมื่อมีการเรียกเข้ามา ปกติพวกมันจะบอกชื่อตัวที่มาต่อเอง และ client ไม่เคยเห็นพวกมันเลย

วิธีเช็กเร็ว ๆ: ถ้า object จะสลับเองตามการเรียกที่ได้รับ นั่นคือ State

### ตาราง statechart และ library

เมื่อ machine โตขึ้น หรือตัว transition เองต้องถูก review ก็ให้อธิบายมันเป็นข้อมูล ตาราง transition จับคู่ (state, การเรียก) แต่ละคู่เข้ากับ state ถัดไปและ action แล้ว interpreter เล็ก ๆ ตัวเดียวก็รันมัน หนังสือชั่งวิธีนี้เทียบกับ pattern: ถ้าใช้ตาราง การเปลี่ยน transition คือการแก้ข้อมูลแทนการแก้โค้ด แต่ผูก action ที่มากับ transition ได้ยากกว่า ตารางอธิบายว่า state ต่าง ๆ ตามกันมายังไง ส่วน pattern อธิบายว่าแต่ละ state ทำอะไร

*Statechart* ที่ David Harel เสนอไว้ในปี 1987 เพิ่มสามอย่างให้ state diagram ธรรมดา: ลำดับชั้น (state ซ้อนอยู่ใน parent state ทำให้ transition `cancel` ตัวเดียวบน parent "open" ใช้ได้กับทุก state ที่ open อยู่ และ child อย่าง Paid ก็ override มันเพื่อเพิ่มการคืนเงินได้) การทำงานพร้อมกัน (region ที่ active พร้อมกัน อย่างการจ่ายเงินและการส่งของ) และการสื่อสารระหว่างกัน ส่วน state machine ของ UML สร้างอยู่บน statechart รุ่นที่เป็น object-oriented และ [SCXML](https://www.w3.org/TR/scxml/) ของ W3C ที่เป็น Recommendation ตั้งแต่ปี 2015 ก็เขียนมันเป็น XML ส่วน library ที่ implement statechart หรือ state machine ที่ง่ายกว่า:

- [XState](https://stately.ai/docs/xstate) (เวอร์ชัน 5) สำหรับ JavaScript และ TypeScript: statechart ที่มี state แบบ [parent](https://stately.ai/docs/parent-states) และ [parallel](https://stately.ai/docs/parallel-states), [guard](https://stately.ai/docs/guards), [action แบบ entry, exit และ transition](https://stately.ai/docs/actions) และ actor
- [transitions](https://github.com/pytransitions/transitions) สำหรับ Python: state machine แบบ object-oriented ที่เบา มี condition และ callback `on_enter`/`on_exit`
- behaviour [`gen_statem`](https://www.erlang.org/doc/system/statem.html) ของ Erlang/OTP: โค้ดของแต่ละ state แยกอยู่ใน callback function ของตัวเองได้ และมี state enter call กับ state time-out มาในตัว

### ตอนที่ switch ก็พอแล้ว

switch ที่ compiler เช็กให้ แก้ปัญหาครึ่งที่เป็น "ลืมไปตัวหนึ่ง" ของ step 1 ได้ TypeScript จะรายงาน `switch` ที่ขาด member ของ union ไป ถ้า branch `default` ของมันกำหนดค่าให้ตัวแปร type `never` ([exhaustiveness checking](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking)) Java บังคับให้ switch expression ต้องครอบคลุมทุกกรณี ([JEP 361](https://openjdk.org/jeps/361) final ใน Java 14) รวมถึง switch แบบ pattern matching ด้วย และถ้าเป็น sealed interface แค่หนึ่ง case ต่อหนึ่ง class ที่ได้รับอนุญาตก็พอ ([JEP 441](https://openjdk.org/jeps/441), Java 21) สำหรับ state ไม่กี่ตัวที่แต่ละตัวมีพฤติกรรมไม่มาก แบบนี้มักคุ้มกว่า: กฎของ state หนึ่งยังกระจายอยู่ แต่ compiler จะหา switch ทุกตัวที่ต้องเพิ่ม case ใหม่ให้

### ในระดับ architecture

state machine ขับเคลื่อนระบบ distributed อยู่เยอะทีเดียว:

- [circuit breaker](../circuit-breaker/) คือ machine สาม state ที่ครอบ remote call ไว้ (Closed, Open และ Half-Open) และ [Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker) ก็อธิบาย proxy ของมันว่าเป็น state machine
- [saga orchestrator](../saga-orchestration/) คือ state machine ที่คุมขั้นตอนและ compensation ของ saga และถูก save ทุก transition เพื่อให้ orchestrator ที่ restart ขึ้นมาทำต่อจากจุดที่หยุดไว้ได้
- workflow service ทำให้ machine กลายเป็นตัวโปรแกรมเลย [AWS Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-statemachines.html) นิยามแต่ละ workflow เป็น state machine ใน Amazon States Language ที่เป็น JSON โดยมี state อย่าง `Task`, `Choice`, `Wait`, `Parallel`, `Map` และ `Fail` แต่ละ execution เริ่มที่ state ใน `StartAt` แล้วตาม `Next` ของแต่ละ state ไปจนถึง terminal state

สิ่งที่เปลี่ยนไปในระดับนั้นคือ state อยู่ใน database หรือใน workflow service แทนที่จะอยู่ใน memory ทำให้ทุก transition เป็นการเขียนที่ durable การเรียกกลายเป็น message ที่อาจมาช้า มาซ้ำ หรือมาผิดลำดับ แต่ละ transition เลยต้องเช็ก state ปัจจุบันและรับมือกับการซ้ำได้ (conditional update ข้างบน, [idempotent consumer](../idempotent-consumer/)) การรอกลายเป็น timer เพราะ review ที่ไม่มีวันเสร็จก็ยังต้องออกจาก OnHold และประวัติของ transition ก็กลายเป็น audit trail ที่ทีม operation อ่าน
