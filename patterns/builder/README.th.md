## ปัญหา

HTTP request มีค่าที่ต้องใช้เสมออยู่ค่าเดียว คือ URL แล้วตามด้วย option อีกยาวเหยียด: method, header, body, timeout, จะตาม redirect หรือไม่ ถ้ายัดทั้งหมดไว้ใน constructor ตัวเดียว การเรียกทุกครั้งก็จะกลายเป็นค่าเรียงตามตำแหน่งยาวเป็นแถว:

```ts
new Request('https://api.example.com/orders', 'POST', headers, body, null, 5000, true);
```

Joshua Bloch เรียกรูปแบบคลาสสิกของเรื่องนี้ว่า **telescoping constructor**: constructor ตัวแรกรับ parameter ที่จำเป็น ตัวถัดไปเพิ่ม option มาหนึ่งตัว ตัวถัดไปก็เพิ่มอีกตัว แต่ละตัวส่งค่า default ต่อลงไปเป็นทอด ๆ ไม่ว่าจะเขียนแบบไหน ตรงที่เรียกก็เจ็บแบบเดียวกัน:

- **ค่าเติมช่อง** จะตั้ง `timeoutMs` ก็ต้องใส่ `connectTimeoutMs` ที่มาก่อนด้วย ทั้งที่ไม่ได้ต้องใช้ เลยต้องส่ง `null` ไป
- **สลับกันแบบเงียบ ๆ** timeout สองตัวอยู่ติดกันและเป็น type เดียวกัน สลับกันก็ยัง compile ผ่าน แล้ว request ก็จะได้ connect timeout มาแทน และไม่มีเวลาจำกัดโดยรวมเลย
- **ค่าไม่มีชื่อ** ตรงที่เรียกไม่มีอะไรบอกว่า `true` แปลว่า "ตาม redirect"
- **โตไม่หยุด** option ใหม่ทุกตัวทำให้รายการยาวขึ้น หรือต้องเพิ่ม overload อีกตัว

ทางออกที่นิยมกัน คือ constructor ที่ไม่มี argument บวก setter หนึ่งตัวต่อ option อ่านง่ายขึ้นก็จริง แต่จะได้ object ที่เอาไปใช้ได้ทั้งที่ตั้งค่ายังไม่ครบ และไม่มีวันเป็น immutable ได้ แถมยังไม่มีจังหวะไหนที่รู้ค่าทุก field ครบ กฎที่เกี่ยวกับหลาย field พร้อมกัน เช่น "GET ไม่มี body" เลยไม่มีที่ให้เช็กแบบเป็นธรรมชาติ

## ทำงานยังไง

**builder** ดึงการสร้างออกมาจาก constructor มันเก็บส่วนต่าง ๆ ทีละขั้นที่มีชื่อบอกชัด จำว่าได้อะไรมาแล้วบ้าง และสร้าง object ที่เสร็จแล้วก็ต่อเมื่อถูกขอเท่านั้น หลังเช็กแล้วว่าส่วนต่าง ๆ เข้ากันได้ ชื่อนี้ใช้กับสองรูปแบบ

**Builder แบบ GoF** (Gamma, Helm, Johnson และ Vlissides, 1994) แยกสูตรการประกอบ object ออกจากโค้ดที่ตัดสินว่าผลลัพธ์จะหน้าตาเป็นยังไง สูตรเดียวเลยให้ผลลัพธ์ได้หลายแบบ:

| ผู้มีบทบาท | ในแผนภาพ | หน้าที่ |
|---|---|---|
| Builder | interface `Builder` | ประกาศขั้นตอนต่าง ๆ: `url`, `method`, `header`, `json`, `timeout` |
| ConcreteBuilder | `RequestBuilder`, `CurlBuilder` | implement ขั้นตอน เก็บส่วนต่าง ๆ ไว้ และคืน product ของตัวเอง |
| Director | `describeCreateOrder(b)` | รู้ว่าต้องเรียกขั้นไหน ตามลำดับไหน สำหรับ product ชนิดหนึ่ง |
| Product | object `Request`, คำสั่ง `curl` | ผลลัพธ์ ส่วน product ของ builder ต่างตัวกันไม่ต้องเป็น type เดียวกันก็ได้ |

client เลือก concrete builder ตัวหนึ่ง ให้ Director รันขั้นตอนต่าง ๆ บนมัน แล้วขอผลลัพธ์จาก builder ตัวนั้น ไม่ใช่จาก Director เพราะมีแค่ concrete builder ที่รู้ว่ามันสร้าง type อะไร ส่วน representation แบบใหม่ก็คือ builder ตัวใหม่ และ Director ก็อยู่เหมือนเดิม

**fluent builder** ที่ Joshua Bloch เล่าไว้ใน *Effective Java* (Item 2) ไม่มี Director และมี product แบบเดียว มันมีไว้แทน constructor ยาว ๆ: แต่ละ method บันทึก option หนึ่งตัวแล้วคืนตัว builder เอง เลยเรียกต่อกันเป็นสายได้ แล้ว `build()` ก็สร้าง object ออกมา ทุกวันนี้ builder ส่วนใหญ่ใน library เป็นแบบนี้ รวมถึง `HttpRequest.newBuilder()` ของ Java และตัวที่ `@Builder` ของ Lombok generate ให้

ทั้งสองแบบมีนิสัยร่วมกันสองข้อ ที่ทำให้ class ที่เพิ่มมาคุ้มค่า:

- **validate ครั้งเดียวใน `build()`** ขั้นตอนแต่ละขั้นปฏิเสธ argument ที่ไม่ดีได้เอง (`HttpRequest.Builder.timeout()` ของ Java ไม่รับ duration ที่ไม่เป็นบวก) แต่กฎที่คร่อมหลายส่วนจะเช็กได้ก็ต่อเมื่อรู้ทุกส่วนครบแล้ว `build()` คือที่เดียวที่ว่านั้น ตัว `build()` ของ Java throw `IllegalStateException` ถ้าไม่ได้ตั้ง URI ไว้ ส่วน builder ในแผนภาพไม่รับ GET หรือ HEAD ที่มี body เพราะ [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.1) ไม่ได้กำหนดความหมายของมันไว้ และแนะนำให้ client ไม่ส่ง
- **คืนผลลัพธ์ที่เป็น immutable** object สมบูรณ์ตั้งแต่ตอนถูกสร้าง เลยไม่ต้องมี setter เลย ส่วน `HttpRequest` ของ Java ก็แก้ไม่ได้อีกหลัง build แล้ว ใน JavaScript ตัว `Object.freeze` ทำหน้าที่นี้ตอน run time แต่มัน freeze แค่ชั้นเดียว object ที่ซ้อนอยู่ข้างใน เช่น header ก็ต้อง freeze ด้วย การเขียนค่าลง property ที่ freeze แล้วจะ throw `TypeError` ในโค้ด strict mode (ES module และ class body ทุกตัว) และจะถูกเมินแบบเงียบ ๆ ในที่อื่น ถ้าจะแก้ object ที่ build แล้ว ให้ก๊อปมันใส่ builder ตัวใหม่: Lombok มี `@Builder(toBuilder = true)` ส่วน Java 16 ก็เพิ่ม `HttpRequest.newBuilder(request, filter)` เข้ามา

**ค่าที่จำเป็น: ใส่ใน constructor ของ builder หรือเช็กใน `build()`?** builder ของ Bloch รับ parameter ที่จำเป็นใน constructor ของตัวเอง เลยลืมไม่ได้ แล้วเหลือแค่ option ให้ method ที่เรียกต่อกัน HTTP client ของ Java มีให้ทั้งสองแบบ: `HttpRequest.newBuilder(uri)` รับ URI ตั้งแต่แรก ส่วน `newBuilder()` ตามด้วย `uri(…)` พึ่งการเช็กใน `build()` การใช้ argument ของ constructor จับความผิดพลาดได้ตอน compile แต่ก็พา parameter แบบเรียงตามตำแหน่งกลับมา เลยควรใช้แค่หนึ่งหรือสองค่า ส่วนการเช็กใน `build()` บังคับกฎอะไรก็ได้ แต่จะ fail ก็ตอน run time เท่านั้น

## โค้ด

interface `Builder`, concrete builder สองตัว และ Director หนึ่งตัว เขียนเป็น TypeScript ที่รันได้เลยด้วย Node 22.18 ขึ้นไป โดยที่ Node ตัด type ทิ้งเอง (`node builder.ts`):

```ts
import assert from 'node:assert/strict';

// Builder: the construction steps. Each one returns the builder, so calls can chain.
interface Builder {
  url(url: string): this;
  method(method: string): this;
  header(name: string, value: string): this;
  json(data: unknown): this;
  timeout(ms: number): this;
}

// Product: an immutable HTTP request.
type Request = Readonly<{ url: string; method: string; headers: Readonly<Record<string, string>>;
  body: string | null; timeoutMs: number | null }>;

// ConcreteBuilder: collects the parts and checks the combination once, in build().
class RequestBuilder implements Builder {
  private parts = { url: '', method: 'GET', headers: {} as Record<string, string>,
    body: null as string | null, timeoutMs: null as number | null };
  url(url: string) { this.parts.url = url; return this; }
  method(method: string) { this.parts.method = method; return this; }
  header(name: string, value: string) { this.parts.headers[name] = value; return this; }
  json(data: unknown) {
    this.parts.body = JSON.stringify(data);
    return this.header('Content-Type', 'application/json');
  }
  timeout(ms: number) { this.parts.timeoutMs = ms; return this; }
  build(): Request {
    const { url, method, headers, body } = this.parts;
    if (!url) throw new Error('url is required');
    if (body !== null && (method === 'GET' || method === 'HEAD'))
      throw new Error(`${method} request cannot have a body`);
    // Object.freeze is shallow, so the headers object is frozen too.
    return Object.freeze({ ...this.parts, headers: Object.freeze({ ...headers }) });
  }
}

// Another ConcreteBuilder: the same steps produce a curl command line.
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`; // POSIX shell quoting
class CurlBuilder implements Builder {
  private target = ''; private verb = 'GET'; private flags: string[] = [];
  url(url: string) { this.target = url; return this; }
  method(method: string) { this.verb = method; return this; }
  header(name: string, value: string) {
    this.flags.push(`-H ${quote(`${name}: ${value}`)}`);
    return this;
  }
  json(data: unknown) {
    this.header('Content-Type', 'application/json');
    this.flags.push(`-d ${quote(JSON.stringify(data))}`);
    return this;
  }
  timeout(ms: number) { this.flags.push(`--max-time ${ms / 1000}`); return this; }
  build(): string { return ['curl -X', this.verb, this.target, ...this.flags].join(' '); }
}

// Director: the create-order recipe, written once against the Builder interface.
function describeCreateOrder(b: Builder): void {
  b.url('https://api.example.com/orders');
  b.method('POST');
  b.header('Authorization', 'Bearer t0k3n');
  b.json({ sku: 'MUG-1', qty: 2 });
  b.timeout(5000);
}

const requestBuilder = new RequestBuilder();
describeCreateOrder(requestBuilder);
const req = requestBuilder.build();
console.log(req.method, req.url, req.headers);
// POST https://api.example.com/orders { Authorization: 'Bearer t0k3n', 'Content-Type': 'application/json' }

const curlBuilder = new CurlBuilder();
describeCreateOrder(curlBuilder);
console.log(curlBuilder.build());
// curl -X POST https://api.example.com/orders -H 'Authorization: Bearer t0k3n' -H 'Content-Type: application/json' -d '{"sku":"MUG-1","qty":2}' --max-time 5

// A client can chain the steps itself, too. build() rejects a bad combination:
assert.throws(() => new RequestBuilder().url('https://api.example.com/orders')
  .method('GET').json({ sku: 'MUG-1', qty: 2 }).build(), /GET request cannot have a body/);
assert.throws(() => new RequestBuilder().method('POST').build(), /url is required/);
// @ts-expect-error: timeoutMs is readonly, and the object is frozen at run time too
assert.throws(() => { req.timeoutMs = 0; }, TypeError);
```

`build()` ก๊อปส่วนต่าง ๆ ก่อนจะ freeze ทำให้ใช้ builder ซ้ำได้โดยไม่ไปเปลี่ยน request ที่มันคืนไปแล้ว ส่วน `CurlBuilder` วาง `-X` ไว้ก่อน URL เสมอ ไม่ว่าขั้นตอนจะมาตามลำดับไหน เพราะหน้าตาของคำสั่งเป็นเรื่องของ builder ไม่ใช่ของ Director มันเขียน `-X POST` ไว้ทั้งที่ curl เดาเองได้ว่าเป็น POST จาก `-d` เพื่อให้ทุกขั้นตอนทิ้งร่องรอยไว้ในผลลัพธ์

## ใช้ตอนไหนดี

- class มี parameter ที่เป็น option เยอะ มีหลายตัวที่เป็น type เดียวกัน หรือมีค่าที่สับสนกันง่ายตรงที่เรียก
- มีกฎบางข้อที่เกี่ยวกับหลาย field พร้อมกัน และต้องเป็นจริงก่อนจะเอา object ไปใช้
- อยากได้ object ที่เป็น immutable แต่มันถูกประกอบขึ้นมาหลายขั้น หรือจากหลายที่
- สูตรเดียวควรสร้าง representation ได้หลายแบบ (แบบ GoF): เอกสารเดียวกันเป็น HTML หรือ Markdown, request เดียวกันเป็น object, คำสั่ง `curl` หรือบรรทัด log
- **test** ทำ test-data builder ไว้หนึ่งตัวต่อ domain class แล้วตั้งค่า default ที่ถูกต้องไว้ในนั้น ทำให้ test แต่ละตัวระบุแค่ field ที่มันสนใจ เช่น `anOrder().withQty(0).build()` เทคนิคนี้ Steve Freeman กับ Nat Pryce เล่าไว้ใน *Growing Object-Oriented Software, Guided by Tests*
- **ไม่ใช่**ตอนที่ภาษามี named argument พร้อมค่า default อยู่แล้ว (Python, Kotlin, C#) หรือมี options object ใน JavaScript กับ TypeScript และเราก็ไม่ได้ต้องการทั้งการสร้างเป็นขั้น ๆ หรือ representation หลายแบบ ตัว options object เองก็ validate ได้เหมือนกัน: [constructor ของ `Request` ใน Fetch standard](https://fetch.spec.whatwg.org/#dom-request) รับ options object มาหนึ่งตัว และ throw `TypeError` ถ้าเป็น GET หรือ HEAD ที่มี body

## ได้อะไร เสียอะไร

- **โค้ดเยอะขึ้น** builder ต้องเขียน field ของ product ซ้ำ และเพิ่ม class หนึ่งตัวต่อ product ใน Java ตัว Lombok generate class ให้ ช่วยประหยัดการพิมพ์ แต่ไม่ช่วยเรื่องทางอ้อม (indirection)
- **ความผิดพลาดโผล่ตอน run time** ขั้นตอนที่จำเป็นแต่ลืมเรียก จะถูกจับโดย `build()` ไม่ใช่ compiler เว้นแต่จะเอาค่าที่จำเป็นไปไว้ใน constructor ของ builder หรือเขียน staged builder ที่ type ของมันจะยอมให้เรียก `build()` ได้ก็ต่อเมื่อเรียกขั้นที่จำเป็นครบทุกขั้นแล้ว
- **ตัว builder เองเป็น mutable** มันมีไว้ให้ผู้เรียกคนเดียวสร้าง object ทีละตัว method ของ `HttpRequest.Builder` ใน Java ไม่ได้ synchronized ก็เลยห้ามแชร์ข้าม thread โดยไม่ล็อก
- **Director มีหรือไม่มีก็ได้** ถ้าไม่มี representation หลายแบบ หรือไม่มีสูตรที่คุ้มจะใช้ซ้ำ มันก็เป็นแค่อีกชั้นหนึ่ง และแค่แบบ fluent อย่างเดียวก็พอแล้ว

## ข้อควรรู้ตอนลงมือทำ

- ใน TypeScript ให้ประกาศขั้นตอนต่าง ๆ ว่าคืน `this` แบบนี้การเรียกต่อกันเป็นสายจะยังได้ concrete type อยู่ แม้จะผ่าน interface หรือ subclass
- ทำให้ขั้นตอนต่าง ๆ เบา ๆ: บันทึกส่วนนั้นแล้ว return ไปเลย ส่วนงานจริง (validate, ก๊อป, freeze, จัดรูปแบบ) ให้ไปทำใน `build()`
- ถ้า product ไม่ได้เกี่ยวกัน ให้ concrete builder แต่ละตัวมี `build()` ของตัวเองที่มี return type ของตัวเอง (`build(): Request`, `build(): string`) แทนที่จะประกาศมันไว้ใน interface Builder
- **ญาติที่ใกล้ที่สุด** Factory Method ให้ subclass เป็นคนตัดสินว่าจะสร้าง instance จาก *class ไหน* ส่วน Abstract Factory สร้าง object ที่เกี่ยวข้องกันทั้งตระกูล โดยแต่ละตัวได้กลับมาทันทีจากการเรียกครั้งเดียว ส่วน Builder เป็นเรื่องของการ*ประกอบ object ที่ซับซ้อนหนึ่งตัว*ผ่านการเรียกหลายครั้ง แล้วส่งให้ตอนจบ builder มักสร้าง tree แบบ Composite (เอกสาร, syntax tree, UI layout) โดยมีขั้นตอนที่ recursive ส่วน Prototype สร้าง object ใหม่ด้วยการก๊อป instance ที่ตั้งค่าไว้แล้ว และการก๊อปแบบ `toBuilder` ก็ให้จุดเริ่มต้นแบบเดียวกันนี้กับ builder
- **ในระดับสถาปัตยกรรม** [immutable infrastructure](../immutable-infrastructure/) ใช้วินัยเดียวกันนี้กับ server: pipeline ประกอบ image ขึ้นมาจากสูตร (Dockerfile หรือ Packer template) แล้ว test ครั้งเดียว จากนั้นก็รันมันแบบไม่เปลี่ยนอะไร และการเปลี่ยนแปลงใด ๆ ก็หมายถึง build ใหม่ ในระดับนั้น builder คือ pipeline ส่วนการเช็กใน `build()` ก็คือ test stage และความเป็น immutable มาจากการเปลี่ยน server ใหม่ ไม่ใช่การ freeze object
