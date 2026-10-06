## ปัญหา

service ของ order เปิด API แบบแบ่งหน้าไว้ ตัว `getPage(page)` คืน order สามตัวพร้อม flag `hasMore` (API จริงคืนหน้าละ 50 หรือ 100 ตัว ที่ใช้สามก็เพื่อให้ตัวเลขเล็ก) order 1001 ถึง 1007 เลยกลับมาเป็นหน้าละ 3, 3 และ 1 ตัว

วิธีอ่านทั้งหมดที่เห็นชัด ๆ คือเขียน loop ไว้ใน caller:

```ts
for (let page = 1; ; page++) {
  const res = await orders.getPage(page);
  for (const o of res.orders) csv.write(o);
  if (!res.hasMore) break;
}
```

มันใช้ได้ เลยถูกก็อปต่อ ๆ กันไป ตัว export CSV ตัวส่งใบเสร็จทาง email และตัว sync กับ CRM ต่างก็มีสำเนาของตัวเองที่ต่างกันแค่บรรทัดตรงกลาง และทุกสำเนาก็รู้ว่า API แบ่งข้อมูลยังไง: หน้าเริ่มนับจาก 1 และมี flag บอกว่ายังมีหน้าถัดไปหรือเปล่า พอ API เปลี่ยนไปใช้ cursor token ก็ต้องแก้ทุกสำเนา และทุกสำเนาก็เป็นอีกโอกาสที่จะเขียนเงื่อนไขหยุดผิด ส่วน caller ที่ต้องการแค่ order ไม่กี่ตัวแรกก็ต้องเพิ่มทางออกของตัวเองเข้าไปด้วย ไม่อย่างนั้นก็จะ fetch หน้าที่ไม่เคยได้อ่าน

โครงสร้างใน memory ก็มีปัญหาเดียวกันในขนาดที่เล็กกว่า โค้ดที่เดิน tree ด้วยการตาม `left` กับ `right` ต้องพึ่งว่า tree ถูกสร้างมายังไง และ loop ที่ใช้ index เข้าไปใน array ก็เอา linked list, generator หรือ stream ส่งให้แทนไม่ได้

## ทำงานยังไง

iterator ส่ง element ของ collection ให้ทีละตัว โดยไม่เปิดให้เห็นว่า collection เก็บมันไว้ยังไง การเดินและตำแหน่งปัจจุบันของการเดินจะย้ายออกจาก caller และออกจาก collection ไปอยู่ใน object ของตัวเอง ทำให้ loop ของ caller มีรูปร่างเหมือนเดิมไม่ว่าจะเดินอะไร ตัว collection ก็เปลี่ยนวิธีเก็บข้อมูลได้โดยไม่ทำให้ caller พัง และการเดิน collection เดียวกันหลายรอบก็ทำไปพร้อมกันได้ แต่ละรอบมีตำแหน่งของตัวเอง Gamma, Helm, Johnson และ Vlissides รวบรวม pattern นี้ไว้ใน *Design Patterns* (1994) และในเล่มก็ให้อีกชื่อว่า *Cursor*

| ส่วนประกอบ | ใน diagram | หน้าที่ |
|---|---|---|
| **Iterator** | `AsyncIterator<Order>` | interface สำหรับการเดิน: `next()` คืน promise ของ `{ value, done }` และ `return()` ที่มีหรือไม่มีก็ได้ ใช้จบการเดินก่อนกำหนด |
| **ConcreteIterator** | generator object ที่ `allOrders()` คืนมา | เดิน collection แบบหนึ่ง และเก็บ state ของการเดิน: cursor (`page`) กับ buffer (ส่วนที่เหลือของหน้าปัจจุบัน) |
| **Aggregate** | `OrderSource` | ประกาศ method ที่สร้าง iterator คือ `all()` |
| **ConcreteAggregate** | `OrdersApi` | implement `all()` ด้วยการสร้าง iterator ตัวใหม่บนข้อมูลของตัวเอง |
| **Client** | ตัว preview order | ขอ iterator จาก aggregate แล้วใช้แค่ interface ของ Iterator |

JavaScript ฝัง interface ทั้งสองตัวไว้ในภาษา ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols)) object ที่ `next()` คืน `{ value, done }` คือ iterator ส่วน object ที่มี method `[Symbol.iterator]()` ที่คืน iterator คือ iterable (Aggregate ของภาษานี้) และ `for...of` ก็ขับ protocol นี้ให้ เวอร์ชัน asynchronous ใช้ `[Symbol.asyncIterator]()`, `next()` ที่คืน promise และ `for await...of` ตัว method ที่สร้าง iterator คือ [Factory Method](../factory-method/): collection แต่ละตัวตัดสินเองว่าจะสร้าง iterator จาก class ไหน อย่างที่ `Collection.iterator()` ของ Java และ `GetEnumerator()` ของ C# ทำ ใน diagram ตัว `all()` รับบทนี้ ถ้าให้ `OrdersApi` มี method `[Symbol.asyncIterator]()` ที่คืน `this.all()` แล้ว caller ก็จะเขียน `for await (const order of orders)` ได้

**External iterator กับ internal iterator** ถ้าใช้ `for...of` caller เป็นคนคุม: มันดึง element ทีละตัวด้วยการเรียก `next()` เลยหยุดเมื่อไหร่ก็ได้ พักไว้ก็ได้ หรือเดิน iterator สองตัวไปคู่กันก็ได้ และการเทียบหรือ merge sequence ที่เรียงแล้วสองชุดก็ต้องใช้แบบนี้ ส่วน internal iterator กลับด้านกัน: collection เป็นคนรัน loop แล้วเรียก function ของเราให้ทุก element อย่างที่ `array.forEach(fn)` และ [`Iterable.forEach(action)`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/lang/Iterable.html) ของ Java ทำ ตัว internal iterator เขียนง่ายกว่า เพราะ collection แค่ recurse ไปตาม tree ได้เลย แต่หยุดยากกว่า: MDN บอกว่า [มีแค่การ throw exception](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/forEach) เท่านั้นที่พาออกจาก `forEach` ได้ ส่วน generator ให้ทั้งสองอย่าง เราเขียนการเดินด้วย loop และ recursion ธรรมดา เหมือนเขียน internal iterator แล้ว caller ก็ได้ external iterator ไว้ดึงเอง

**state ของ iterator และ iterator หลายตัวพร้อมกัน** ตำแหน่งอยู่ใน iterator ไม่ได้อยู่ใน collection ทำให้การเรียก `orders.all()` แต่ละครั้งเริ่มการเดินที่เป็นอิสระ มี cursor และ buffer ของตัวเอง และ loop สองตัวบน `OrdersApi` ตัวเดียวกันก็ไม่รบกวนกัน iterator ส่วนใหญ่รันได้ครั้งเดียวและไปข้างหน้าอย่างเดียว: generator ที่จบแล้วก็จบเลย และ documentation ของ Python เรียก iterator ว่าพัง ถ้า `__next__()` เลิก raise `StopIteration` หลังจากที่เคย raise ไปแล้วหนึ่งครั้ง ถ้าจะเดินอีกรอบ ให้ขอ iterator ตัวใหม่จาก aggregate หนังสือยังใช้คำว่า *cursor* กับ iterator ที่แค่จดตำแหน่งไว้ โดยที่ aggregate เป็นคนขยับเอง ส่วน cursor token ของ API ก็คือแนวคิดเดียวกันในขนาดของ network call

**ความ lazy และการออกก่อนกำหนด** iterator สร้าง element แต่ละตัวก็ต่อเมื่อถูกขอเท่านั้น `allOrders()` ขอหน้าใหม่ก็ต่อเมื่อ buffer ว่าง ทำให้ preview ที่หยุดหลัง order สี่ตัวเสีย request แค่สองครั้ง generator ที่ไม่มีวันจบก็ไม่มีพิษภัยอะไรตราบที่ฝั่งที่ใช้หยุดเป็น: กับ `function* ids(id = 1001) { while (true) yield id++; }` ตัว iterator helper ของ ES2025 [`ids().take(5)`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Iterator/take) จะ yield 1001 ถึง 1005 แล้วปิด generator (`itertools.islice` ทำงานเดียวกันใน Python และ `Take(5)` ใน LINQ) การหยุดก่อนกำหนดต้องปล่อยทุกอย่างที่ iterator ถืออยู่:

- เมื่อ body ของ loop `for...of` หรือ `for await...of` ออกก่อนกำหนด ไม่ว่าจะด้วย `break`, `return` หรือ exception ตัว loop จะเรียก method `return()` ของ iterator ส่วนบน generator ตัว [`return()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Generator/return) จะรัน block `finally` ที่ค้างอยู่ทั้งหมด และตรงนั้นก็คือที่ที่ใช้ปิด connection หรือไฟล์
- Python เรียก `close()` บน generator ที่ถูก finalize ก่อนจะรันจบ และนั่นก็รัน block `finally` ของมันด้วย สำหรับ asynchronous generator เรื่องนี้ไม่รับประกัน เลยต้องปิดมันด้วย `aclose()` หรือ [`contextlib.aclosing()`](https://docs.python.org/3/library/contextlib.html#contextlib.aclosing) (Python 3.10)
- `foreach` ของ C# จะ dispose enumerator เมื่อ loop จบ ไม่ว่าจะจบก่อนกำหนดหรือไม่ และตอนนั้นแหละที่ iterator method ปล่อย resource ของ statement `using` ของมัน ([Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/yield))

**ถ้า collection เปลี่ยนระหว่างการเดิน** หนังสือเรียก iterator ว่า *robust* ถ้าการแทรกและการลบไม่ทำให้การเดินที่กำลังทำอยู่เพี้ยน และทำได้โดยไม่ต้องก็อป collection แต่ละ library ตอบคำถามนี้ต่างกัน และควรรู้ไว้ว่าตัวที่ใช้อยู่ตอบแบบไหน:

- iterator ของ [`ArrayList`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/ArrayList.html) ใน Java เป็นแบบ fail-fast: ถ้า list ถูกแก้โครงสร้างผ่านทางอื่นที่ไม่ใช่ตัว iterator เอง ตัว iterator ก็จะ throw `ConcurrentModificationException` ถึงจะมีอยู่ thread เดียวก็ตาม documentation เรียกข้อนี้ว่า best-effort และมีไว้หา bug ไม่ใช่สิ่งที่ควรเอาไปพึ่ง
- collection ส่วนใหญ่ใน [`java.util.concurrent`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/concurrent/package-summary.html) มี iterator แบบ weakly consistent แทน ตัวนี้ไม่เคย throw exception นั้น และอาจเห็นหรือไม่เห็นการเปลี่ยนแปลงที่เกิดหลังจากมันถูกสร้างก็ได้ ส่วน `CopyOnWriteArrayList` วนบน snapshot ที่ถ่ายไว้ตอนสร้าง iterator
- `List<T>` ของ C# [ทำให้ enumerator ใช้ไม่ได้](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.list-1.getenumerator) ทันทีที่มีการเปลี่ยนแปลงใด ๆ และ `MoveNext()` ครั้งถัดไปจะ throw `InvalidOperationException`
- Python [อาจ raise `RuntimeError` หรือข้าม entry ไป](https://docs.python.org/3/library/stdtypes.html#dictionary-view-objects) ถ้าเพิ่มหรือลบ entry ของ dictionary ระหว่างที่วนอยู่บน dictionary นั้น
- [array iterator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/values) ของ JavaScript อ่าน array ตัวจริงทุก step รวมถึงความยาวปัจจุบันของมันด้วย ทำให้ element ที่ push เข้ามาระหว่าง `for...of` ก็จะถูกเดินถึงเหมือนกัน แล้ว loop ที่ push ทุกรอบก็เลยไม่มีวันไปถึงจุดจบ

**Asynchronous iteration** ถ้าต้องรอ element ตัวถัดไป `next()` ก็จะคืน promise ฝั่ง `for await...of` ใช้ async iterable (และ iterable ธรรมดาด้วย) ส่วน `async function*` สร้างมันขึ้นมา นี่คือวิธีที่ `allOrders()` ซ่อน request ของแต่ละหน้าไว้หลัง loop เดียว ตัว [readable stream](https://nodejs.org/api/stream.html#readablesymbolasynciterator) ของ Node.js เป็น async iterable, C# มี `IAsyncEnumerable<T>` กับ `await foreach` และ Python มี `async for` บน object ที่มี `__aiter__()` กับ `__anext__()` ส่วน client library ก็ใช้สิ่งนี้กับ list endpoint: ใน Node.js library ของ Stripe การวน `for await` บนการเรียก list จะ [fetch หน้าถัด ๆ ไปให้เอง](https://docs.stripe.com/api/pagination/auto) และ [paginator](https://docs.aws.amazon.com/boto3/latest/guide/paginators.html) ของ boto3 ก็ส่งหน้าต่าง ๆ ของ list operation ของ AWS ให้ใน loop `for` ธรรมดา

**generator คือวิธีเขียน iterator ที่ติดมากับภาษา** ถ้าเขียน `allOrders()` เป็น class มันจะต้องเก็บ `page`, หน้าปัจจุบัน และตำแหน่งในหน้านั้นไว้เป็น field และ `next()` ของมันก็ต้องคำนวณทุกครั้งว่าค้างไว้ตรงไหน ส่วน generator คง loop ไว้ตามเดิม: `yield` ส่ง element ออกไปหนึ่งตัวแล้วพัก function ไว้ และตัวแปร local ของ function ก็คือ state ของ iterator ตัว generator ใน diagram ก็คือ loop ของ caller จาก step 1 ที่ใส่ `yield* res.orders` ไว้ตรงที่เคยเป็นงานของ caller ตัว JavaScript มี `function*` และ `async function*`, Python มี `yield` และ C# มี `yield return` ใน method ที่คืน `IEnumerable<T>`, `IEnumerator<T>` หรือ `IAsyncEnumerable<T>` ส่วน Java ไม่มี generator: iterator คือ class ที่มี `hasNext()` กับ `next()` แต่ stream ก็ครอบคลุมการใช้งานแบบเดียวกันได้หลายอย่าง

**cursor กับ offset** เลขหน้าใน diagram ก็คือ offset ที่ปลอมตัวมา: หน้า 2 หมายถึง "ข้าม order สามตัวแรก" ถ้ามี order ถูกเพิ่มหรือลบระหว่าง request สองครั้ง ทุกหน้าหลังจากนั้นก็จะเลื่อน การเดินเลยเห็น order ซ้ำหรือพลาดไปตัวหนึ่ง และ database ก็ต้องอ่านทุกแถวที่ข้ามแล้วทิ้งไป หน้าท้าย ๆ เลยช้ากว่า ส่วน cursor ระบุตำแหน่งตรง ๆ แทนการนับไปจนถึงตำแหน่งนั้น list endpoint ของ Stripe รับ [`starting_after`](https://docs.stripe.com/api/pagination) ที่เป็น ID ของ object ตัวสุดท้ายที่ได้รับ แล้วคืน `has_more` ส่วน API อื่นคืน next-page token แบบทึบมาให้ ทาง Markus Winand เรียกฝั่ง database ของแนวคิดนี้ว่า [keyset pagination](https://use-the-index-luke.com/no-offset): filter ด้วย key ตัวสุดท้ายที่เห็นแทนการใช้ `OFFSET` ส่วนการเปลี่ยน `allOrders()` จากเลขหน้าไปเป็น cursor ก็เป็นการแก้ function เดียว เพราะ caller เรียกแค่ `orders.all()` เสมอ

## โค้ด

TypeScript ที่ตรงกับ diagram ตัว Node 22.18 ขึ้นไปรันได้เลยตามนี้ (`node orders.ts`) โดยตัด type ทิ้งแบบไม่เช็ก และมันก็ผ่าน `tsc --strict` ถ้า compile เป็น ES module (`--module nodenext` ที่ top-level `await` ต้องใช้)

```ts
import assert from 'node:assert/strict';

type Order = { id: number };
type Page = { orders: Order[]; hasMore: boolean };

// Aggregate: anything that can create an iterator over its orders.
interface OrderSource {
  all(): AsyncGenerator<Order>;
}

// ConcreteAggregate: a fake paged API, 3 orders per page, that counts requests.
class OrdersApi implements OrderSource {
  fetches = 0;
  private readonly ids = [1001, 1002, 1003, 1004, 1005, 1006, 1007];

  async getPage(page: number): Promise<Page> {
    this.fetches++;
    const start = (page - 1) * 3;
    const orders = this.ids.slice(start, start + 3).map((id) => ({ id }));
    return { orders, hasMore: start + 3 < this.ids.length };
  }

  // The factory method: each call creates a new, independent iterator.
  all(): AsyncGenerator<Order> {
    return allOrders(this);
  }
}

// ConcreteIterator, written as an async generator. Its local variables are
// the iterator's state: page is the cursor, res.orders the buffer.
async function* allOrders(api: OrdersApi): AsyncGenerator<Order> {
  for (let page = 1; ; page++) {
    const res = await api.getPage(page); // only once the buffer is empty
    yield* res.orders;                   // one order per next()
    if (!res.hasMore) return;
  }
}

// Client: read every order...
const orders = new OrdersApi();
const ids: number[] = [];
for await (const order of orders.all()) ids.push(order.id);
assert.deepEqual(ids, [1001, 1002, 1003, 1004, 1005, 1006, 1007]);
assert.equal(orders.fetches, 3);
console.log(`all:     ${ids.join(' ')} (${orders.fetches} requests)`);

// ...or show the first 4: break calls return(), so page 3 is never fetched.
orders.fetches = 0;
const shown: number[] = [];
for await (const order of orders.all()) {
  shown.push(order.id);
  if (shown.length === 4) break;
}
assert.deepEqual(shown, [1001, 1002, 1003, 1004]);
assert.equal(orders.fetches, 2);
console.log(`preview: ${shown.join(' ')} (${orders.fetches} requests)`);
```

ผลลัพธ์:

```
all:     1001 1002 1003 1004 1005 1006 1007 (3 requests)
preview: 1001 1002 1003 1004 (2 requests)
```

## ใช้ตอนไหนดี

- collection ที่อยากซ่อนวิธีเก็บข้อมูล หรืออยากให้เปลี่ยนวิธีเก็บได้อิสระ: API แบบแบ่งหน้าหรือแบบ streaming, tree, result set จาก database, ไฟล์ที่อ่านทีละบรรทัด
- ข้อมูลที่ใหญ่เกินจะโหลดทีเดียว ทยอยมาเรื่อย ๆ หรือไม่มีวันจบ: จัดการทีละ element แล้วหยุดเมื่อได้พอแล้ว
- มีหลายวิธีในการเดินโครงสร้างเดียว (in-order และ level-order, เดินหน้าและถอยหลัง) หรือมีการเดินหลายรอบที่ทำอยู่พร้อมกัน
- โค้ด generic อย่างการก็อป, filter, แบ่ง batch หรือแบ่งหน้า ที่ควรใช้ได้กับ collection ทุกแบบ
- ใช้อย่างอื่นดีกว่า ถ้า collection และ loop ที่ติดมากับภาษาทำงานนี้ได้อยู่แล้ว (ใช้พวกนั้นไป) ถ้าต้องการ random access, ความยาว หรือเดินหลายรอบ (โหลดข้อมูลลง array ไปเลย) หรือถ้าสิ่งที่ต้องทำกับแต่ละ element ขึ้นกับ type ของมันมากกว่าลำดับของการเดิน ([Visitor](../visitor/))

## ได้อะไร เสียอะไร

- **รอบเดียว เดินหน้าอย่างเดียว** iterator ส่วนใหญ่ย้อนกลับไม่ได้ บอกความยาวไม่ได้ และแชร์กันไม่ได้ และ iterator ที่ใช้หมดแล้วก็จะว่างไปตลอด ถ้าต้องการอย่างใดอย่างหนึ่งในนี้ ให้รวบรวม element ลง array
- **งานย้ายเข้าไปอยู่ใน loop** การเรียก `orders.all()` ยังไม่ได้ทำอะไรเลย: request เกิดขึ้นระหว่างที่ loop รัน ส่วน failure ที่หน้า 2 จะโผล่ขึ้นมากลาง loop ที่จัดการหน้า 1 ไปแล้ว และ loop ที่ดูเหมือนเดิน list ในเครื่องก็อาจกำลังเรียก network อยู่
- **อายุของ iterator** iterator ที่ถือ connection หรือ file handle ไว้ต้องถูกเดินจนจบหรือถูกปิด (`return()`, `close()`, `Dispose()`) ตัวที่ถูกทิ้งไว้กลางทางต้องพึ่ง cleanup ที่บาง runtime ทำช้าหรือไม่ทำเลย
- **การเปลี่ยนแปลงระหว่างการเดิน** ต้องมีคำตอบที่กำหนดไว้ชัด: fail fast, เดินบน snapshot หรือเป็นแบบ weakly consistent
- **overhead** object เพิ่มหนึ่งตัวต่อการเดินหนึ่งรอบ และการเรียกทางอ้อมหนึ่งครั้งต่อ element ถ้าเป็น array ธรรมดาใน hot loop ใช้ index จะเร็วกว่า ส่วน generator แบบ recursive ส่ง element ทุกตัวขึ้นไปผ่าน `yield*` ทุกชั้นที่ครอบอยู่ ทำให้ element ที่อยู่ลึกใน tree สูง ๆ ส่งออกมาแพงกว่า
- **ส่วนที่ได้คืนมา** caller พึ่งแค่ interface เล็ก ๆ ตัวเดียว วิธีเก็บข้อมูลข้างหลังเปลี่ยนได้ การหยุดก่อนกำหนดไม่แพง และ memory ก็ไม่เกินหนึ่งหน้า

## ข้อควรรู้ตอนลงมือทำ

- **เขียนเป็น generator** เริ่มจาก loop ที่จะเขียนไว้ใน caller แล้วใส่ `yield` ตรงที่เคยเป็นงานของ caller ส่วนตัวแปร local ของ generator คือ cursor กับ buffer และ `try`/`finally` คือที่สำหรับ cleanup
- **ทำให้ aggregate เป็น iterable** ใส่ `[Symbol.asyncIterator]() { return this.all(); }` ไว้บน `OrdersApi` แล้ว caller ก็เขียน `for await (const order of orders)` ได้ ส่วนการเดินแบบอื่นให้ใช้ method ที่มีชื่อ (`all({ status: 'open' })`, `newestFirst()`) เพราะ class หนึ่งมี default iterator ได้แค่ตัวเดียว
- **prefetch แบบตั้งใจ** iterator ที่แบ่งหน้าขอหน้า n + 1 ไว้ระหว่างที่ caller ทำงานกับหน้า n ได้ โดยแลก request ที่อาจเสียเปล่ากับการรอที่น้อยลง ให้ทำเป็น option เพราะมันทำให้เสียการประหยัดแบบสองครั้งแทนสามครั้งไป
- **Tree** generator แบบ recursive เป็นวิธีที่เป็นธรรมชาติในการเดินโครงสร้างแบบ composite: `yield* left; yield key; yield* right` คือการเดินแบบ in-order ของ [binary search tree](../binary-search-tree/) ใน step 4 แต่ถ้า tree ลึกมาก ให้ใช้ stack ที่จัดการเองแทน เวอร์ชัน Python ในหน้านั้นก็ทำแบบนี้ เพราะ generator แบบ recursive จะชน recursion limit ของ Python เมื่อเจอสายที่ยาว
- **helper ต่อกันแบบ lazy** iterator helper ของ ES2025 (`map`, `filter`, `take`, `drop`, `flatMap` และอื่น ๆ) และ `itertools` ของ Python คืน iterator ตัวใหม่ ทำให้ `ids().filter((id) => id % 2 === 0).take(5)` อ่าน ID สิบตัวเพื่อหาเลขคู่ห้าตัว และไม่เคยขอตัวที่สิบเอ็ด
- **ญาติ ๆ**
  - [Composite](../composite/): tree ที่ iterator มักเดิน ตัว Composite กำหนดโครงสร้าง ส่วน Iterator กำหนดลำดับในการไปเยี่ยมมัน
  - [Visitor](../visitor/): หนึ่ง operation ต่อ element หนึ่ง type และมักถูกใช้ระหว่างที่ iterator เดินโครงสร้าง โดยที่ iterator ตัดสินลำดับ ส่วน visitor ตัดสินว่าจะทำอะไรกับแต่ละ element
  - [Factory Method](../factory-method/): `all()`, `[Symbol.iterator]()` หรือ `iterator()` ของ aggregate เป็นตัวสร้าง iterator และ collection class แต่ละตัวก็เลือก iterator ของตัวเอง
  - [Memento](../memento/): ตำแหน่งของ iterator ที่เก็บไว้ เพื่อให้การเดินกลับมาทำต่อได้ทีหลัง ตัว cursor token แบบทึบของ API ก็ทำงานแบบนี้: client ส่งมันกลับไปโดยไม่ต้องดูข้างใน
- **ที่ระดับ architecture** ใน [Publish-Subscribe](../publish-subscribe/) บน log ตัว subscriber แต่ละตัวเก็บ cursor ไว้ คือ offset ใน log ที่มันขยับและ commit ไปเรื่อย ๆ ทำให้ reader หลายตัวเดิน log เดียวกันได้อย่างอิสระ และ restart แล้วก็ทำต่อได้ พอถึงระดับนั้น ตำแหน่งของ iterator ต้องเก็บไว้นอก process และ collection ก็โตขึ้นเรื่อย ๆ ระหว่างที่ถูกอ่าน ส่วน consumer ของ [Change Data Capture](../change-data-capture/) ก็ทำงานแบบเดียวกัน แต่ละตัวมี offset ของตัวเอง สายของ lazy iterator (`filter`, `map`, `take`) คือ pull pipeline ภายใน process เดียว และ [Pipes and Filters](../pipes-and-filters/) ก็เป็นรูปร่างเดียวกันเมื่อ filter เป็น component แยกกันที่เชื่อมด้วย queue
