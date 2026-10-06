## ปัญหา

`HttpClient` ส่ง request และผู้เรียกแต่ละคนก็อยากได้ของเสริมรอบการเรียกแต่ละครั้งไม่เหมือนกัน: retry เมื่อเจอ 503, log ทุก request, cache response ของ `GET` เครื่องมือที่เห็นชัดที่สุดคือ inheritance: `RetryingClient extends FetchClient`, `LoggingClient extends FetchClient` แต่มันใช้ไม่ได้ทันทีที่ผู้เรียกอยากได้ของเสริมสองอย่างพร้อมกัน เพราะทุกชุดผสมต้องมี class ของตัวเอง feature เสริมสามตัวก็ต้องใช้ 2³ − 1 = 7 subclass แล้ว (`RetryingLoggingClient`, `LoggingCachingClient` และที่เหลือ) ตัวที่สี่ทำให้เป็น 15 และโค้ด retry หรือ logging ก็ถูกก๊อปหรือพันกันอยู่ในทุกตัว

การเลือกยังถูกแช่แข็งไว้ตั้งแต่ตอน compile ด้วย ผู้เรียกเลือก class ตัวเดียวด้วย `new` เลยเพิ่ม logging ให้ client ที่ได้รับมาไม่ได้ ส่วน config ก็ปิด retry ไม่ได้ถ้าไม่มี class เพิ่มอีกตัว และลำดับที่ feature ทำงานก็ถูกฝังไว้ใน class ที่ผสมแต่ละตัว

## ทำงานยังไง

ห่อ object แทนที่จะ subclass มัน decorator implement interface เดียวกับ object ที่มันห่อ ถือ reference ไปที่ object นั้น และทำงานเล็ก ๆ ของตัวเองก่อนหรือหลังส่งการเรียกแต่ละครั้งต่อไป เพราะ decorator ก็เป็น `HttpClient` เหมือนกัน มันเลยห่อ decorator ตัวอื่นได้ ทำให้ feature ซ้อนกันได้กี่ชั้นก็ได้ ในลำดับไหนก็ได้ และเลือกได้ตอน runtime แพตเทิร์นนี้ Gamma, Helm, Johnson และ Vlissides จัดไว้เป็น structural pattern ที่มีอีกชื่อว่า **Wrapper**

ผู้มีบทบาทเทียบกับแผนภาพ:

- **Component** (`HttpClient`): interface ที่ผู้เรียกพึ่ง ในที่นี้มี method เดียวคือ `send(req)`
- **ConcreteComponent** (`FetchClient`): object ที่ทำงานจริง คือการเรียก HTTP
- **Decorator** (`LoggingClient`, `RetryingClient`): implement `HttpClient` เก็บ `HttpClient` ที่มันห่อไว้ใน `inner` และส่งต่อไปที่ตัวนั้น ในหนังสือจะมี Decorator class แบบ abstract ที่ถือ reference และส่งต่อทุกการเรียก แล้ว *ConcreteDecorators* ก็ extend มันเพื่อเพิ่มพฤติกรรมเสริม ถ้า interface มีแค่ method เดียว ตัว base class นั้นก็ไม่ได้ช่วยประหยัดอะไร ในที่นี้ decorator แต่ละตัวเลย implement interface ตรง ๆ และเล่นทั้งสองบทบาท ถ้า interface กว้าง ตัว base class ถึงจะคุ้ม: `FilterInputStream` ของ Java ก็คือ class แบบนั้นเป๊ะ ๆ

`new LoggingClient(new RetryingClient(new FetchClient()))` สร้างหัวหอมแบบใน animation ผู้เรียกถือ object ชั้นนอกสุด และเห็นแค่ `HttpClient` ตัวเดียว: มันบอกไม่ได้ว่ามีกี่ชั้น การเรียกวิ่งเข้าไปผ่านทุกชั้น แล้ว response ก็วิ่งกลับออกมาผ่านชั้นเดิมในลำดับย้อนกลับ decorator แต่ละตัวเลยทำงานได้ตอนขาเข้า ตอนขาออก หรือทั้งสองตอน

### ทำไมในเคสนี้ composition ชนะ subclassing

- **ผสมกันตอน runtime** feature *n* ตัวต้องใช้ decorator class *n* ตัว แทนที่จะเป็น subclass 2ⁿ − 1 ตัว และจะประกอบชุดย่อยไหนก็ได้ ต่อจุดที่เรียก ต่อ environment หรือจาก config
- **หนึ่ง class หนึ่งหน้าที่** retry policy อยู่แค่ใน `RetryingClient` และรูปแบบ log อยู่แค่ใน `LoggingClient` แต่ละตัว test แยกได้กับ inner client ปลอม
- **ขยายได้โดยไม่ต้องแก้** caching ก็แค่ class เพิ่มอีกตัว คือ `CachingClient` และไม่มี class เดิมตัวไหนเปลี่ยน

### ความโปร่งใสและ identity

decorator ต้องรักษา contract ของ interface: input แบบเดิม ผลลัพธ์และ error ชนิดเดิม ความหมายเดิม ผู้เรียกต้องไม่พังเมื่อมีการเพิ่มหรือถอดชั้นออก retry decorator ที่ retry `POST` ที่ไม่ idempotent ไปด้วย หรือ cache ที่ส่งข้อมูลเก่ากว่าที่ผู้เรียกรับได้ ก็ผิดสัญญานั้น ถึง type จะยังตรงกันอยู่ก็ตาม

object ที่ถูก decorate ยังเป็น object คนละตัวด้วย `new LoggingClient(fetchClient) === fetchClient` เป็น `false` และ `instanceof FetchClient` ก็เป็น false สำหรับตัวห่อ แล้ว client ที่ถูก decorate ถ้าเอาไปใช้เป็น key ของ map ก็จะหา entry ที่เก็บไว้ใต้ตัวเปล่าไม่เจอ หนังสือเตือนว่าอย่าพึ่ง object identity ถ้ามี decorator เกี่ยวข้อง

### ลำดับมีผล

stack คือลำดับ และการสลับลำดับก็เปลี่ยนพฤติกรรม:

- **log ครั้งเดียว หรือทุกครั้งที่ลอง** logging ที่อยู่นอก retry เขียน log หนึ่งคู่ต่อการเรียกหนึ่งครั้ง (ขั้นที่ 3: สองบรรทัด) และบันทึกสิ่งที่ผู้เรียกเจอ รวมถึงเวลาที่เสียไปกับการ retry ส่วน logging ที่อยู่ใน retry เขียนหนึ่งคู่ต่อการลองแต่ละครั้ง (ขั้นที่ 4: สี่บรรทัด) และบันทึกสิ่งที่ server เห็น
- **cache อยู่นอกหรือใน retry** ถ้าเป็น `new CachingClient(new RetryingClient(new FetchClient()))` การ hit จะไม่ไปถึง logic ของ retry เลย และจะเก็บแค่ผลลัพธ์สุดท้าย ถ้า cache อยู่ใน retry มันจะถูกถามซ้ำทุกครั้งที่ลอง และถ้ามันเผลอเก็บ 503 ไว้ การ retry ทุกครั้งก็จะได้ 503 ตัวเดิมกลับมาจาก cache
- **timeout** timeout ที่อยู่นอก retry จำกัดเวลาของทั้ง operation รวมเวลาที่รอด้วย ส่วนตัวที่อยู่ข้างในจำกัดเวลาของการลองแต่ละครั้ง

### Decorator กับญาติ ๆ

Decorator, Proxy และ Adapter ห่อ object เหมือนกันหมด ที่ต่างกันคือเจตนา

- **Proxy** มีโครงสร้างเดียวกัน (interface เดียวกัน และมี reference ไปที่ object ตัวจริง) แต่จุดประสงค์ต่างกัน: มันคุมการเข้าถึง object นั้น เพื่อ lazy loading, เช็กสิทธิ์, remoting หรือ caching แล้วปกติ proxy ก็จะสร้างหรือหา object ที่มันยืนแทนเอง ผู้เรียกเลยไม่ได้เลือกว่าอะไรอยู่ข้างหลัง ส่วน decorator ได้ inner object มาจากคนที่ประกอบ stack และ decorator ก็มีไว้ให้ซ้อนกัน
- **Adapter** ให้ object มี interface *คนละแบบ* เพื่อให้โค้ดที่มีอยู่เรียกมันได้ ส่วน decorator คง interface ไว้แล้วเปลี่ยนพฤติกรรม นี่คือเหตุที่ decorator ห่อกันเองซ้อนไปเรื่อย ๆ ได้ แต่ adapter ที่ข้างนอกต่างจากข้างในทำแบบนั้นไม่ได้
- **Chain of Responsibility** ก็ต่อ object เป็นแถวเหมือนกัน แต่ handler แต่ละตัวตัดสินเองว่า request นี้เป็นงานของมันไหม และอาจหยุดมันไว้ตรงนั้น ส่วน decorator ปกติจะส่งต่อเสมอ ตัว caching decorator ที่ตอบ hit เองโดยไม่ส่งต่อ ก็คือการยืมไอเดียนั้นมาใช้
- **Strategy** เอาความต่างไปไว้*ข้างใน* object: object มอบงานบางส่วนให้ strategy ที่มันถืออยู่ มันเลยต้องรู้ว่ามีความต่างนี้อยู่ ตามสำนวนของหนังสือ decorator เปลี่ยน "ผิว" ของ object ส่วน strategy เปลี่ยน "ไส้ใน" ของมัน เลือก Strategy ถ้า `FetchClient` ควรเป็นเจ้าของความต่างนั้น (เช่น backoff policy ที่เสียบเปลี่ยนได้) และเลือก Decorator ถ้ามันควรไม่ต้องรู้เรื่องนี้เลย
- **Composite** มีโครงสร้างใกล้กัน: decorator ก็เหมือน composite ที่มีลูกตัวเดียวพอดี แต่เจตนาต่างกัน: composite ทำให้กลุ่มทำตัวเหมือน object ตัวเดียว ส่วน decorator เพิ่มพฤติกรรมให้ object ตัวเดียว

## โค้ด

สถานการณ์ในแผนภาพเขียนเป็น TypeScript เซฟเป็น `decorator.ts` แล้วรัน `node decorator.ts` ได้เลย ตัว Node.js ตัด type ทิ้งเอง (เปิดไว้โดย default ตั้งแต่ 22.18)

```ts
import assert from 'node:assert/strict';

type HttpRequest = { method: string; path: string };
type HttpResponse = { status: number };

// Component: the one interface every layer implements
interface HttpClient {
  send(req: HttpRequest): Promise<HttpResponse>;
}

// ConcreteComponent: the real call (faked here: the first attempt gets a 503)
class FetchClient implements HttpClient {
  private attempts = 0;
  async send(req: HttpRequest): Promise<HttpResponse> {
    this.attempts += 1;
    return { status: this.attempts === 1 ? 503 : 200 };
  }
}

// Decorator: on a 503, wait 200 ms and call the wrapped client once more
class RetryingClient implements HttpClient {
  private readonly inner: HttpClient;
  constructor(inner: HttpClient) { this.inner = inner; }
  async send(req: HttpRequest): Promise<HttpResponse> {
    const res = await this.inner.send(req);
    if (res.status !== 503) return res;
    await new Promise((resolve) => setTimeout(resolve, 200));
    return this.inner.send(req);
  }
}

// Decorator: log the request on the way in and the status on the way out
class LoggingClient implements HttpClient {
  private readonly inner: HttpClient;
  readonly lines: string[] = [];
  constructor(inner: HttpClient) { this.inner = inner; }
  async send(req: HttpRequest): Promise<HttpResponse> {
    this.lines.push(`→ ${req.method} ${req.path}`);
    const res = await this.inner.send(req);
    this.lines.push(`← ${res.status}`);
    return res;
  }
}

const get: HttpRequest = { method: 'GET', path: '/orders' };

// Logging outside the retry: one call, two lines
const outside = new LoggingClient(new RetryingClient(new FetchClient()));
console.log((await outside.send(get)).status, outside.lines);
// 200 [ '→ GET /orders', '← 200' ]

// Logging inside the retry, new RetryingClient(new LoggingClient(new FetchClient())): every attempt
const inside = new LoggingClient(new FetchClient());
console.log((await new RetryingClient(inside).send(get)).status, inside.lines);
// 200 [ '→ GET /orders', '← 503', '→ GET /orders', '← 200' ]

assert.deepEqual(outside.lines, ['→ GET /orders', '← 200']);
assert.deepEqual(inside.lines, ['→ GET /orders', '← 503', '→ GET /orders', '← 200']);
```

## ใช้ตอนไหนดี

- พฤติกรรมเสริมที่ไม่บังคับและเป็นอิสระต่อกัน รอบ interface ที่นิ่งแล้ว: retry, logging, metric, caching, authentication header, การบีบอัด, buffering, การเข้ารหัส
- ตอนที่ชุดผสมหรือลำดับต้องถูกเลือกตอน runtime: จาก config, ต่อ environment, ต่อจุดที่เรียก
- ตอนที่ subclass ไม่ได้หรือไม่ควร: class เป็น final หรือ sealed, เป็นของ library หรือเราได้แค่ instance มาจาก factory หรือ dependency-injection container
- ไม่ใช่ตอนที่ interface กว้าง (ทุก method ต้องส่งต่อ ให้ generate โค้ดส่งต่อ หรือใช้ interception ของ framework แทน), ตอนที่พฤติกรรมต้องใช้ข้างในของ object (แก้ class หรือใช้ Strategy) หรือตอนที่ผู้เรียกพึ่ง concrete type หรือ object identity

## ได้อะไร เสียอะไร

- **object เล็ก ๆ เยอะ** การเรียกครั้งเดียวผ่านหลายชั้น ทำให้ stack trace กับ session ใน debugger ลึกขึ้น และคนอ่านต้องไปหาว่า stack ถูกประกอบที่ไหน ถึงจะรู้ว่าการเรียกหนึ่งครั้งทำอะไรบ้าง
- **ลำดับคือ config** ตอนนี้ composition root เป็นตัวกำหนดพฤติกรรม และลำดับที่ผิดก็คือ bug จริง ๆ ที่การเช็ก type จับไม่ได้ ต้อง review และ test มันเหมือนโค้ด
- **การเช็ก identity และ type พัง** equality, `instanceof` และการหาใน map เห็นตัวห่อ ไม่ใช่ตัวต้นฉบับ
- **interface กว้างก็ต้องมีโค้ดส่งต่อเยอะ** method ที่เพิ่มมาแต่ละตัวคืออีกที่หนึ่งที่อาจลืมส่งการเรียกต่อ ส่วน base class ที่ส่งต่อให้ (แบบ `FilterInputStream`) หรือการ generate โค้ดส่งต่อช่วยให้เรื่องนี้อยู่ที่เดียว
- **overhead เล็กน้อยต่อชั้น** decorator แต่ละตัวเพิ่มการเรียกหนึ่งครั้ง ไม่ต้องนับเลยถ้าเทียบกับ network I/O แต่เห็นได้ใน loop ที่วนถี่ ๆ

## ข้อควรรู้ตอนลงมือทำ

- **syntax `@decorator` ของ Python** เอา function ไปใช้กับ function (หรือ class) ตอนที่มันถูกนิยาม แล้วผูกชื่อเข้ากับสิ่งที่ได้กลับมา ปกติก็คือ wrapper ที่รันโค้ดก่อนและหลังตัวต้นฉบับ ส่วนหน้า [glossary](https://docs.python.org/3/glossary.html#term-decorator) ของ Python ก็ยก `@classmethod` กับ `@staticmethod` เป็นตัวอย่างที่เจอบ่อย มันคือไอเดียการห่อแบบเดียวกันที่เอามาใช้กับ function และ [PEP 318](https://peps.python.org/pep-0318/) เองก็บอกว่าชื่อนี้ไม่ตรงกับความหมายที่ใช้ในหนังสือ GoF เวลาเขียน wrapper ให้ใช้ [`functools.wraps`](https://docs.python.org/3/library/functools.html#functools.wraps) เพื่อให้ wrapper เก็บชื่อและ docstring ของตัวต้นฉบับไว้
- **higher-order function ของ JavaScript** ให้การซ้อนชั้นแบบเดียวกันโดยไม่ต้องมี syntax อะไรเลย: `const send = withLogging(withRetry(fetchOrders))` ลำดับการซ้อนก็คือลำดับของชั้น เหมือนกับตอนใช้ object เป๊ะ
- **syntax `@decorator` ของ TypeScript เป็นคนละกลไก** มันคือ function ที่ runtime เรียกบน class หรือ class member ตอนที่ class ถูกนิยาม ใช้ทำ metadata, การ register หรือห่อ method ตัว TypeScript 5.0 implement [decorators proposal](https://github.com/tc39/proposal-decorators) ของ ECMAScript (ที่ TC39 จัดไว้ที่ Stage 2.7 ณ เดือนตุลาคม 2026) ควบคู่ไปกับโหมด `--experimentalDecorators` แบบเก่า ส่วน [type stripping](https://nodejs.org/api/typescript.html) ของ Node.js ไม่รับ syntax ของ decorator และนี่ก็เป็นอีกเหตุผลที่ตัวอย่างข้างบนห่อ object เองด้วยมือ
- **`java.io` ของ Java** คือตัวอย่างตามตำรา: `FilterInputStream` ห่อ `InputStream` อีกตัวแล้วส่งต่อไปที่มัน และ subclass อย่าง `BufferedInputStream` (buffering, `mark` และ `reset`), `DataInputStream`, `InflaterInputStream` และ `CipherInputStream` ก็ซ้อนอยู่ข้างบน แบบใน `new BufferedInputStream(new FileInputStream("orders.csv"))`
- **`HttpClient` ของ .NET** สร้าง pipeline ขาออกจาก `DelegatingHandler`: แต่ละตัวคือ `HttpMessageHandler` ที่ถือ inner handler ไว้ handler ที่เพิ่มด้วย `AddHttpMessageHandler` ผ่าน `IHttpClientFactory` จะรันตามลำดับที่ register โดยแต่ละตัวห่อตัวถัดไป จนถึง primary handler ที่ส่ง request ออกไป (`SocketsHttpHandler` โดย default ตั้งแต่ .NET 9 และ `HttpClientHandler` ก่อนหน้านั้น) และ retry policy ที่ใช้ Polly ก็เสียบเข้ามาใน pipeline เดียวกันนี้
- **middleware pipeline** ใน web framework ก็หน้าตาคล้ายกัน: ใน [ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/) middleware แต่ละตัวทำงานได้ทั้งก่อนและหลังตัวถัดไป เหมือน decorator แต่มันก็จบ request ก่อนได้ด้วย เหมือน chain of responsibility
- **ในระดับสถาปัตยกรรม** ตัวห่อย้ายออกไปอยู่นอก process โดย proxy แบบ [sidecar](../sidecar/) หรือ [ambassador](../ambassador/) สำหรับการเรียกขาออก ห่อ network traffic ของ service แล้วเพิ่ม retry, timeout, TLS และ telemetry โดยไม่ต้องแตะโค้ดของมัน ส่วน [service mesh](../service-mesh/) ก็รัน proxy แบบนี้ให้ทุก service และตั้งค่าทั้งหมดจาก control plane ในระดับนี้ interface กลายเป็น network protocol ส่วนชั้นต่าง ๆ ก็เขียนด้วยภาษาอะไรก็ได้และอัปเกรดแยกกันได้ แต่ทุกชั้นมีต้นทุนเป็น hop หนึ่งครั้งกับ process ที่ต้องรันเพิ่ม ลำดับยังมีผลอยู่ และการ retry ในสองชั้นจะคูณกัน: ดู [Retry with Backoff](../retry-with-backoff/) ที่ `RetryingClient` ตัวจริงก็ต้องใช้ด้วย (retry แค่ request ที่ idempotent พร้อม backoff และ jitter) ส่วนชั้น caching ให้ดู [Cache-Aside](../cache-aside/)
