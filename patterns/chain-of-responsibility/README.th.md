## ปัญหา

ค่าใช้จ่ายต้องได้รับอนุมัติ และใครอนุมัติได้ก็ขึ้นกับยอดเงิน: team lead ได้ถึง EUR 500, manager ได้ถึง EUR 5,000, director ได้ถึง EUR 50,000 และเกินกว่านั้นเป็นของ CFO ส่วนเวอร์ชันแรกมักใส่ความรู้นี้ไว้ในโค้ดที่ส่ง request ตัว `ExpenseService.submit()` ถือ reference ไปหาผู้อนุมัติทุกคน มี `if … else if` ไล่เป็นขั้นบันไดตามยอดเงิน แล้วเรียกผู้อนุมัติที่ถูกคนเอง

แบบนี้ใช้ได้จนกว่าองค์กรจะเปลี่ยน ระดับ VP ใหม่ วงเงินที่ต่างออกไปในแผนกหนึ่ง หรือกฎชั่วคราว (CFO ไม่อยู่ ทำให้ director เซ็นทุกอย่าง) ล้วนต้องแก้ที่ผู้ส่ง ผู้ส่งเลยต้องถูกแก้และ test ใหม่ ทั้งที่ค่าใช้จ่ายที่มันส่งก็ยังเหมือนเดิม ความรู้ว่าใครรับผิดชอบอะไรถูกแบ่งอยู่สองที่ คือผู้อนุมัติที่รู้ว่าอนุมัติยังไง กับผู้ส่งที่รู้ว่าแต่ละคนควรอนุมัติเมื่อไหร่ แล้วผู้ส่งตัวนี้ก็เอาไป reuse กับทีมที่สายอนุมัติหน้าตาต่างออกไปไม่ได้

## ทำงานยังไง

Chain of Responsibility เอา object ที่อาจจัดการ request ได้มาเรียงต่อกัน แล้วส่ง request ให้ตัวแรก แต่ละตัวจะจัดการเองหรือไม่ก็ส่งต่อให้ตัวถัดไป ผู้ส่งเลยคุยกับ object แค่ตัวเดียว และไม่เคยรู้ว่าตัวไหนเป็นคนลงมือ ใครจัดการอะไรก็เลยถูกตัดสินโดย handler เอง และโดยลำดับที่พวกมันถูกต่อกัน ทั้งสองอย่างเปลี่ยนได้โดยไม่ต้องแตะผู้ส่ง pattern นี้เป็นหนึ่งใน behavioural pattern ใน *Design Patterns* ของ Gamma, Helm, Johnson และ Vlissides (1994) ตัวอย่างในเล่มคือ help ที่ขึ้นกับบริบทใน user interface: request ขอ help เริ่มที่ widget ที่ผู้ใช้ชี้อยู่ แล้วขยับออกไปผ่าน dialog ไปจนถึง application จนกว่าจะมีตัวไหนมี help ให้แสดง

| ส่วนประกอบ | ใน diagram | หน้าที่ |
|---|---|---|
| **Handler** | `Approver` | ประกาศ `handle(e)` และถือ link ไปหา handler ตัวถัดไป โดย default มันจะส่ง request ต่อ |
| **ConcreteHandler** | `TeamLead`, `Manager`, `Director`, `CFO`, `VP` | จัดการ request ที่ตัวเองรับผิดชอบ ในที่นี้คือยอดเงินที่อยู่ในวงเงินของตัวเอง แล้วส่งที่เหลือต่อให้ตัวถัดไป |
| **Client** | `ExpenseService` | ส่งทุก request ไปที่ handler ตัวแรก โดยไม่รู้ว่าสายยาวแค่ไหนหรือมีใครอยู่ในนั้นบ้าง |

ในโค้ดข้างล่าง `Approver.handle()` ทำการส่งต่อไว้ครั้งเดียวให้ผู้อนุมัติทุกคน และ subclass แต่ละตัวก็แค่บอกใน `canApprove(e)` ว่ามันอนุมัติอะไรได้ sample code ในหนังสือแบ่งงานต่างไปนิดหน่อย: concrete handler แต่ละตัว override method ที่จัดการ request และถ้า request ไม่ใช่งานของมัน ก็เรียก method เวอร์ชันที่ inherit มา แล้วเวอร์ชันนั้นก็ส่งต่อไป ไม่ว่าแบบไหน handler ก็เห็นแค่ rule ของตัวเองกับ `next` ของมัน

**สายสองแบบ** แบบในหนังสือหยุดที่ handler ตัวแรกที่รับ request: ผู้อนุมัติคนเดียวเซ็นค่าใช้จ่าย หรือไม่มีใครเซ็นเลย อีกแบบหนึ่งพบบ่อยพอ ๆ กันหรือมากกว่าในทุกวันนี้: handler ทุกตัวทำงานบางอย่างแล้วส่ง request ต่อ และตัวไหนก็จบมันก่อนได้ ตัว web middleware ก็ทำงานแบบนี้

- ใน [Express](https://expressjs.com/en/guide/using-middleware/) middleware function ได้รับ request, response และ function `next` มันรันโค้ดอะไรก็ได้ และแก้ request หรือ response ได้ แล้วก็จะจบ response เองหรือเรียก `next()` แต่ถ้าไม่ทำทั้งสองอย่าง request ก็จะไม่มีวันจบ
- ใน [ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/) middleware แต่ละตัวตัดสินว่าจะเรียกตัวถัดไปหรือไม่ และทำงานได้ทั้งก่อนและหลังตัวถัดไป ตัวที่ไม่เรียกต่อเรียกว่า *terminal* และจะ short-circuit pipeline อย่างที่ static-file middleware ทำกับไฟล์ที่มันเสิร์ฟ

โครงสร้างของทั้งสองแบบเหมือนกัน ที่ต่างคือการส่ง request ต่อเป็นข้อยกเว้นหรือเป็นเรื่องปกติ

**ประกอบสาย** ลำดับของ link คือลำดับที่ handler ถูกถาม การประกอบสายเลยเป็น configuration และควรอยู่ที่เดียว: composition root, builder หรือไฟล์ configuration ไม่ใช่ที่ผู้ส่ง ส่วน framework ก็ทำให้ลำดับเห็นชัด Express รัน middleware ตามลำดับที่ [register](https://expressjs.com/en/guide/writing-middleware/) ไว้ ทำให้ logger ที่ register หลัง route ไม่เคยเห็น request ที่ route นั้นตอบไปแล้ว ส่วน ASP.NET Core เรียก middleware ตามลำดับที่มันอยู่ในไฟล์ `Program` ของ app แล้วรันฝั่ง response ย้อนลำดับกลับ ส่วน `setNext()` ที่คืน argument ของตัวเองแบบข้างล่าง ทำให้เขียนสายสั้น ๆ ได้ในบรรทัดเดียว: `director.setNext(vp).setNext(cfo)`

## โค้ด

TypeScript ที่ตรงกับ diagram ตัว Node 22.18 ขึ้นไปรันได้เลยตามนี้ (`node expenses.ts`): มันแค่ตัด type ทิ้งโดยไม่ได้เช็ก เลยต้องรัน `tsc --noEmit` ด้วย ส่วน `this.constructor.name` ให้ชื่อ class ของผู้อนุมัติแต่ละคนสำหรับผลลัพธ์ ถ้าโค้ดต้องผ่าน minifier ควรเก็บชื่อไว้ตรง ๆ แทน เพราะ minifier อาจเปลี่ยนชื่อ class

```ts
// Amounts are whole euros.
type Expense = { readonly amount: number };
type Result = { readonly approvedBy: string | null; readonly hops: number };

// Handler: holds the next link and passes on what this link can't approve.
abstract class Approver {
  private next: Approver | null = null;
  setNext(next: Approver): Approver {
    this.next = next;
    return next; // so links can be chained: a.setNext(b).setNext(c)
  }

  handle(e: Expense): Result {
    if (this.canApprove(e)) return { approvedBy: this.constructor.name, hops: 1 };
    if (this.next === null) return { approvedBy: null, hops: 1 }; // fell off the end
    const r = this.next.handle(e);
    return { approvedBy: r.approvedBy, hops: r.hops + 1 };
  }

  protected abstract canApprove(e: Expense): boolean;
}

// ConcreteHandlers: each one knows only its own rule.
class TeamLead extends Approver { protected canApprove(e: Expense) { return e.amount <= 500; } }
class Manager extends Approver { protected canApprove(e: Expense) { return e.amount <= 5_000; } }
class Director extends Approver { protected canApprove(e: Expense) { return e.amount <= 50_000; } }
class CFO extends Approver { protected canApprove(_e: Expense) { return true; } } // the default

// Client: knows only the first link.
class ExpenseService {
  private readonly first: Approver;
  constructor(first: Approver) { this.first = first; }
  submit(e: Expense): Result { return this.first.handle(e); }
}

// The chain is wired once, outside ExpenseService.
const teamLead = new TeamLead(), manager = new Manager();
const director = new Director(), cfo = new CFO();
teamLead.setNext(manager);
manager.setNext(director);
director.setNext(cfo);
const service = new ExpenseService(teamLead);

console.log(service.submit({ amount: 300 }));     // { approvedBy: 'TeamLead', hops: 1 }
console.log(service.submit({ amount: 4_200 }));   // { approvedBy: 'Manager', hops: 2 }
console.log(service.submit({ amount: 18_000 }));  // { approvedBy: 'Director', hops: 3 }

// The reorganisation: a VP between Director and CFO. ExpenseService is untouched.
class VP extends Approver { protected canApprove(e: Expense) { return e.amount <= 200_000; } }
director.setNext(new VP()).setNext(cfo);
console.log(service.submit({ amount: 120_000 })); // { approvedBy: 'VP', hops: 4 }
console.log(service.submit({ amount: 300_000 })); // { approvedBy: 'CFO', hops: 5 }

// Without a default at the end, an expense can fall off the chain.
const noDefault = new TeamLead();
noDefault.setNext(new Manager()).setNext(new Director());
console.log(new ExpenseService(noDefault).submit({ amount: 80_000 })); // { approvedBy: null, hops: 3 }
```

ผลลัพธ์:

```
{ approvedBy: 'TeamLead', hops: 1 }
{ approvedBy: 'Manager', hops: 2 }
{ approvedBy: 'Director', hops: 3 }
{ approvedBy: 'VP', hops: 4 }
{ approvedBy: 'CFO', hops: 5 }
{ approvedBy: null, hops: 3 }
```

## ใช้ตอนไหนดี

- มีหลาย object ที่จัดการ request ได้ ตัวที่ถูกต้องขึ้นกับ request และ configuration และผู้ส่งไม่ควรต้องรู้ว่าเป็นตัวไหน: การอนุมัติ, การ escalate งาน support (first line, second line, on call), data source ที่ลองไล่ตามลำดับ, parser ที่แต่ละตัวรู้จัก format เดียว
- handler หรือลำดับของมันเปลี่ยนบ่อยกว่าผู้ส่ง หรือต่างกันไปตาม tenant, market หรือ deployment
- ขั้นตอนที่ทุก request ต้องผ่าน (authentication, logging, compression, caching) และขั้นไหนก็ตอบกลับก่อนได้ นี่คือแบบ middleware
- ไม่ใช้ถ้า request มีผู้รับที่ชัดเจนอยู่ตัวเดียวเสมอ: เรียกตรง ๆ ตามอ่านง่ายกว่า
- ไม่ใช้ถ้า handler ต่างกันแค่ตัวเลข ผู้อนุมัติสี่คนที่เทียบยอดเงินกับวงเงินสี่ค่า เป็น class เดียว คู่กับตารางวงเงินที่เรียงไว้ก็ได้ การแยก class จะคุ้มเมื่อ rule ต่างกันคนละแบบ เช่น CFO ที่ต้องการลายเซ็นที่สองด้วยถ้ายอดเกินระดับหนึ่ง หรือ compliance check ที่ปฏิเสธบาง category ทันที
- ไม่ใช้ถ้าผู้รับทุกตัวต้องเห็นทุก request: แบบนั้นคือ [Observer](../observer/) ภายใน process และ [publish-subscribe](../publish-subscribe/) ระหว่าง service

## ได้อะไร เสียอะไร

- **ไม่มีอะไรรับประกันว่าจะมี handler รับ** ไม่มีอะไรในโครงสร้างที่ทำให้แน่ใจว่าจะมี handler สักตัวรับ request และ request ที่ไม่มีใครจัดการก็จะหลุดออกปลายสายไป หนังสือนับข้อนี้เป็นหนึ่งในผลที่ตามมาของ pattern นี้ เลยควรปิดท้ายทุกสายด้วย default handler
- **ใครเป็นคนจัดการ** การตัดสินกระจายอยู่ใน object ที่ต่อกันตอน runtime อ่านโค้ดผู้ส่งเลยไม่รู้ว่า handler ไหนลงมือ และ breakpoint ใน handler ตัวหนึ่งก็ไม่บอกว่าทำไมตัวก่อนหน้าถึงส่งผ่าน ให้ return หรือ log handler กับจำนวน hop ไว้ อย่างที่ `handle()` ทำในที่นี้
- **ต้นทุนต่อ request** request อาจผ่านทุก link ก่อนจะมีตัวไหนรับ ต้นทุนโตตามความยาวของสาย และ call stack ในแบบ recursive ที่แสดงนี้ก็โตตามด้วย หนึ่ง frame ต่อหนึ่ง hop ให้สายสั้นเข้าไว้ เอากรณีที่เจอบ่อยไว้ก่อน หรือพอสายยาวแล้วก็หา handler จาก type ของ request แทน
- **ลำดับคือพฤติกรรม** สลับ link สองตัวอาจเปลี่ยนว่าใครอนุมัติอะไร หรือทำให้ request ข้ามการเช็กไปได้ และ `next` ที่ชี้ย้อนกลับไปหา link ก่อนหน้าก็จะส่ง request ที่ไม่มีใครจัดการวนเป็นวงกลมจน stack overflow ให้ประกอบสายไว้ที่เดียว และ test สายที่ประกอบเสร็จแล้วด้วย ไม่ใช่แค่ test handler ทีละตัว
- **ส่วนที่ได้คืนมา** ผู้ส่งแยกขาดจากผู้รับ เพิ่ม ลบ และสลับลำดับ handler ได้โดยไม่ต้องแตะผู้ส่ง และ handler แต่ละตัวก็เล็กและ test แยกเดี่ยว ๆ ได้

## ข้อควรรู้ตอนลงมือทำ

- **request ที่ไม่มีใครจัดการ กับ default handler** ตัดสินไว้ว่าจะเกิดอะไรที่ปลายสาย จะให้ link ตัวสุดท้ายรับทุกอย่าง อย่างที่ CFO ทำในที่นี้ หรือให้สายจบด้วย handler ที่ตอบชัด ๆ ด้วยการปฏิเสธ request คืน 404 หรือ raise error ก็ได้ Express แนะนำแบบนี้เป๊ะ ๆ สำหรับ 404: request ที่ไม่มี middleware หรือ route ไหนตอบเลย ไม่นับว่าเป็น error ตัว [FAQ](https://expressjs.com/en/starter/faq/) เลยแนะนำให้มี middleware ตัวสุดท้ายที่ก้น stack คอยส่ง 404 ส่วน logging module ของ Python มี handler ไว้เป็นทางสุดท้าย คือ [`logging.lastResort`](https://docs.python.org/3/library/logging.html#logging.lastResort) ที่เขียนลง standard error ที่ level `WARNING` เมื่อหา handler ไม่เจอเลยใน logger hierarchy ส่วนการคืน `null` อย่างที่สายที่ไม่มี CFO ทำในโค้ด จะปลอดภัยก็ต่อเมื่อ caller ทุกตัวเช็กค่านี้
- **สายที่ต่อไปตามโครงสร้างที่มีอยู่แล้ว** link ไม่ต้องเป็น field ใหม่ก็ได้ ถ้า object เป็น tree อยู่แล้ว reference ไปหา parent ก็ใช้เป็น `next` ได้ หนังสือแนะนำแบบนี้สำหรับ hierarchy แบบส่วนย่อยกับส่วนรวม ([Composite](../composite/))
  - ใน DOM การคลิกปุ่มจะ [bubble](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/Event_bubbling) จาก element ที่อยู่ในสุดออกไปผ่าน ancestor ของมัน และ listener ตัวไหนก็เรียก [`stopPropagation()`](https://developer.mozilla.org/en-US/docs/Web/API/Event/stopPropagation) เพื่อจบการเดินทางได้ ทำแบบนั้นแล้ว event จะไม่ไปถึง element อื่น แต่ไม่ได้ยกเลิก default action ของ browser และ listener ตัวอื่นบน element เดียวกันก็ยังรันอยู่ ยกเว้นจะเรียก [`stopImmediatePropagation()`](https://developer.mozilla.org/en-US/docs/Web/API/Event/stopImmediatePropagation) และก็ไม่ใช่ทุก event ที่ bubble: [`focus`](https://developer.mozilla.org/en-US/docs/Web/API/Element/focus_event) ไม่ bubble แต่ `focusin` bubble
  - logger ของ Python เป็น tree ตามชื่อที่คั่นด้วยจุด ค่า default ของ [`propagate`](https://docs.python.org/3/library/logging.html#logging.Logger.propagate) คือ true และถ้ามันเป็น true ตัว record ที่ log ลง `app.db` และผ่าน level ของ logger นั้น จะถูกส่งให้ handler ของ `app.db` แล้วของ `app` แล้วของ root logger และการเดินทางจะจบหลัง logger ตัวแรกที่ `propagate` เป็น false ส่วน level และ filter ของ ancestor เองจะถูกข้ามไป ใช้แค่ handler ของพวกมัน
  - ทั้งสองอย่างเป็นแบบ middleware: listener หรือ handler ทุกตัวระหว่างทางได้รับ event ยกเว้นจะมีตัวไหนหยุดมัน
- **Servlet filter** สำหรับ request ที่มี filter map ไว้ ตัว Jakarta servlet container จะสร้างสายของ filter ไว้หน้า resource ตัว filter ได้รับ request, response และ [`FilterChain`](https://jakarta.ee/specifications/servlet/6.1/apidocs/jakarta.servlet/jakarta/servlet/filterchain) การเรียก `doFilter()` บนตัวนั้นจะเรียก filter ตัวถัดไป หรือเรียก resource เองหลัง filter ตัวสุดท้าย ส่วน [filter](https://jakarta.ee/specifications/servlet/6.1/apidocs/jakarta.servlet/jakarta/servlet/filter) ที่ไม่เรียกมันจะบล็อก request ไว้ อย่างที่ authentication filter ที่ตอบ 401 ทำ และเหมือน middleware มันทำงานกับ response ได้ด้วยหลังจากส่วนที่เหลือของสายรันไปแล้ว
- **request เป็น object** หนังสือชั่งดูว่าจะแทน request ยังไง method หนึ่งตัวต่อ request หนึ่งแบบนั้น type-safe แต่ล็อกชุดของ request ไว้ ส่วน `handle(request)` ตัวเดียวที่รับ object ทำให้ request แบบใหม่เดินทางไปตามสายเดิมได้ โดยที่ handler แต่ละตัวเช็กแบบที่มันเข้าใจ ค่าใช้จ่ายในที่นี้ก็เป็น object แบบนั้น ส่วน request object ที่พกสิ่งที่ต้องทำมาด้วยก็ใกล้กับ [Command](../command/) และ command ก็มักผ่านสายของ handler (validation, authorisation, logging) ก่อนจะมีตัวหนึ่ง execute มัน
- **ไม่ใช้ class** ถ้ามี first-class function สายก็มักเป็น list ของ function แทน object ที่มี field `next` ตัว `approvers.find((a) => a.canApprove(e))` เดินไปตาม list ตามลำดับ ตำแหน่งของตัวที่ match ก็คือจำนวน hop และการเพิ่ม VP ก็แค่แทรกลงใน list ส่วน middleware framework ส่ง `next` ให้ handler แต่ละตัวเป็น argument ของ function แทนการเก็บไว้ ทำให้ handler ตัวเดียวกันอยู่ได้หลายสาย
- **ต่อสายใหม่ตอนที่ request ยังวิ่งอยู่** ใน server ที่มีหลาย thread การเปลี่ยนสายที่ใช้งานอยู่คือ concurrent update ให้ต่อ handler ตัวใหม่เข้ากับตัวถัดไปของมันก่อน แล้วค่อยให้ตัวก่อนหน้าชี้มาที่มัน หรือสร้างสายใหม่แล้วสลับ reference ของหัวสาย จะได้ไม่มี request ไหนไปถึง VP ที่ยังไม่มี `next` ส่วนตัวอย่าง JavaScript รันแบบ synchronous ลำดับในตัวอย่างเลยไม่สำคัญ
- **ญาติ ๆ**
  - [Decorator](../decorator/) มีรูปร่างเหมือนกัน คือแถวของ object ที่แต่ละตัวถือตัวถัดไป แต่ปกติ decorator จะส่งต่อทุกการเรียกแล้วเพิ่มพฤติกรรมรอบ ๆ ส่วน handler ตัดสินว่าจะส่งต่อหรือไม่
  - [Composite](../composite/) มักเป็นตัวให้ link: node ที่จัดการ request ไม่ได้ก็ส่งมันให้ parent
  - [Command](../command/) มักเป็นสิ่งที่วิ่งไปตามสาย
  - [Observer](../observer/) ส่ง notification ทุกตัวให้ subscriber ทุกตัว ส่วนสายจะยื่น request ให้ handler ทีละตัวจนกว่าจะมีตัวหนึ่งรับ
  - [Mediator](../mediator/) ก็ช่วยให้ผู้ส่งไม่ต้องรู้จักผู้รับเหมือนกัน แต่ส่งทุก message ผ่าน object กลางตัวเดียวที่ตัดสินว่าใครคุยกับใคร ส่วนสายไม่มีศูนย์กลาง: link แต่ละตัวรู้จักแค่ตัวถัดไป
- **ที่ระดับ architecture**
  - [API gateway](../api-gateway/) ส่งทุก request ผ่าน policy ชุดหนึ่งตามลำดับ (authentication, rate limiting, caching, routing) และ policy ไหนก็ตอบเองได้: 401 ถ้าไม่มี token, 429 ถ้า quota หมด, response จาก cache นี่คือแบบ middleware ที่ขอบ network ลำดับของ policy เป็น configuration ส่วน request ที่ไม่ผ่าน policy ตัวใดตัวหนึ่ง ก็จะไปไม่ถึง service และราคาที่ต้องจ่ายคือ latency ที่ policy ทุกตัวเพิ่มให้ทุก request
  - [Pipes and Filters](../pipes-and-filters/) ก็ส่งข้อมูลไปตามแถวของขั้นตอนที่แยกกันเหมือนกัน แต่ filter ทุกตัวประมวลผลทุก message ที่มาถึงมัน และใน diagram นั้น filter เป็น service แยกกันที่เชื่อมด้วย queue มันคือ pipeline ของการแปลงข้อมูล ไม่ใช่การหา handler ตัวเดียวที่จะรับ request
