## ปัญหา

object บางตัวควรมีแค่ตัวเดียวใน process: database connection pool, metrics registry, cache ใน process, snapshot ของ config แต่ class ธรรมดาไม่ได้บังคับเรื่องนี้ ถ้าโค้ดตรงไหนก็เรียก `new ConnectionPool()` ได้ repository แต่ละตัวใน service เดียวกันก็จะเปิด pool ของตัวเอง แล้ว database ที่เตรียมไว้รับ 10 connection จาก service นี้ก็โดนไป 30 และ pool แต่ละชุดก็มีความเข้าใจของตัวเองว่า connection ไหนว่างอยู่ การส่ง object ที่ใช้ร่วมกันตัวเดียวลงไปทุก layer ที่ต้องใช้มันก็รู้สึกเหมือนงานเดินท่อ และตอนนั้นแหละที่ singleton ดูน่าใช้

## ทำงานยังไง

Singleton ให้ class รับผิดชอบเองว่าจะมี instance ได้ไม่เกินหนึ่งตัว และต้องส่ง instance นั้นให้ใครก็ตามที่ขอ (Gamma, Helm, Johnson และ Vlissides, 1994) แพตเทิร์นนี้มีผู้มีบทบาทแค่ตัวเดียว คือ class **Singleton** และ client เข้าถึง instance ได้ผ่านมันเท่านั้น:

- constructor เป็น **private** โค้ดอื่นเลยสร้าง instance ไม่ได้
- **static field** ถือ instance ตัวเดียวนั้นไว้
- **static access method** (ในที่นี้คือ `getInstance()`) สร้าง instance ตอนเรียกครั้งแรก (lazy) หรือคืนตัวที่สร้างไว้ตอนโหลด class (eager) แล้วคืน object ตัวเดิมทุกครั้งที่เรียกหลังจากนั้น

singleton ทำสองงานพร้อมกัน **instance เดียว** ปกป้อง resource ที่มีจำกัด และทำให้ state ที่ใช้ร่วมกันสอดคล้องกัน ส่วนนี้มักเป็นสิ่งที่ต้องการพอดี **การเข้าถึงแบบ global** ทำให้โค้ดไหนก็ได้เอื้อมถึง object โดยไม่ต้องมีใครส่งให้ และส่วนนี้แหละที่เถียงกันอยู่ มันก็คือ global mutable state ในชื่ออื่น: dependency ของ class หายเข้าไปอยู่ในเนื้อ method, test ได้ของที่ test ก่อนหน้าทิ้งไว้ติดมาด้วย และลำดับที่ของต่าง ๆ initialise ก็เริ่มมีผล เก็บงานแรกไว้แล้วทิ้งงานที่สองได้: สร้าง instance ตัวเดียวตอนโปรแกรมเริ่ม แล้วส่งให้โค้ดที่ต้องใช้มัน

**lazy หรือ eager** การสร้างแบบ eager ตอน class หรือ module โหลด ทำง่ายและไม่มี race แต่ทุกการรันต้องจ่ายต้นทุนตอนเริ่ม และถ้าพังก็จะพังตอนโหลด ส่วนการสร้างแบบ lazy ย้ายต้นทุนไปให้ผู้เรียกคนแรก และตรงนั้นแหละที่ bug เรื่อง concurrency อยู่: thread สองตัว หรือผู้เรียกแบบ asynchronous สองตัว อาจเห็นพร้อมกันว่า "ยังไม่มี instance"

**race เวอร์ชัน asynchronous** ใน JavaScript กับ TypeScript การเปิด pool จะคืน promise ถ้า `getInstance()` await connection ก่อนจะเก็บอะไรไว้ ก็จะเกิดช่องว่างที่ผู้เรียกคนที่สองเจอ field ว่างเหมือนกัน แล้วเปิด pool ชุดที่สอง: ได้ pool สองชุดกับ 20 connection ในขั้นที่สามของแผนภาพ ให้เก็บ *promise* ของการสร้างไว้ใน field ก่อนจะ await มัน แล้วผู้เรียกทุกคนก็จะ await promise ตัวเดียวกัน ถ้าการสร้างล้มเหลว ให้ล้าง field ทิ้ง ไม่งั้นผู้เรียกทุกคนหลังจากนั้นจะได้ rejection ที่ cache ไว้

**ญาติ ๆ** Factory Method กับ Abstract Factory ตัดสินว่าจะสร้าง instance จาก class *ไหน* ส่วน Singleton ตัดสินว่าจะมี instance *กี่ตัว* concrete factory กับ facade มักต้องการ instance แค่ตัวเดียว เลยมักถูกเขียนเป็น singleton แต่นั่นเป็นการเลือกตอน implement ไม่ใช่ส่วนหนึ่งของแพตเทิร์นพวกนั้น Flyweight แชร์ instance หลายตัว หนึ่งตัวต่อ shared state แต่ละแบบ ผ่าน factory ส่วน registry ที่แจก instance หนึ่งตัวต่อหนึ่งชื่อก็อยู่ตรงกลางระหว่างสองแบบนี้ (`logging.getLogger(name)` ของ Python คืน logger ตัวเดิมสำหรับชื่อเดิม) ภาษาสมัยใหม่ดูดแพตเทิร์นนี้เข้าไปเยอะแล้ว: module ถูก evaluate ครั้งเดียว, การประกาศ `object` ของ Kotlin ก็คือ singleton ที่ compiler สร้างให้ และ dependency injection (DI) container ก็ดูแล *singleton lifetime* ให้

## โค้ด

`ConnectionPool` ที่มี private constructor กับ static `getInstance()` ที่ cache promise ของการสร้างไว้ ตัว `connect()` ปลอมนับว่ามีการเปิด pool กี่ชุด ส่วนโค้ดที่ใช้งานตอนท้ายเรียกพร้อมกันสองครั้งแบบในขั้นที่ 3 แล้วเรียกอีกครั้งทีหลังแบบในขั้นที่ 2

```ts
// connection-pool.ts: run with `node connection-pool.ts` (Node 22.18+ strips the types)
import assert from 'node:assert/strict';

let poolsOpened = 0;                         // what the database would count
async function connect(size: number): Promise<string[]> {
  poolsOpened++;                             // a fake driver: opening takes a while
  await new Promise((resolve) => setTimeout(resolve, 50));
  return Array.from({ length: size }, (_, i) => `conn ${poolsOpened}.${i + 1}`);
}

class ConnectionPool {
  private static pending: Promise<ConnectionPool> | undefined;
  readonly connections: string[];

  private constructor(connections: string[]) {   // `new` only from inside the class
    this.connections = connections;
  }

  // Store the promise *before* awaiting it: a caller that arrives while the pool
  // is still opening gets the same promise instead of opening a second pool.
  // The broken version awaits first and stores the result afterwards:
  //   ConnectionPool.instance ??= await ConnectionPool.open();
  // Two concurrent calls both find no instance: poolsOpened === 2, 20 connections.
  static async getInstance(): Promise<ConnectionPool> {
    ConnectionPool.pending ??= ConnectionPool.open();
    return ConnectionPool.pending;
  }

  private static async open(): Promise<ConnectionPool> {
    try {
      return new ConnectionPool(await connect(10));
    } catch (err) {
      ConnectionPool.pending = undefined;    // don't cache a failure: the next call retries
      throw err;
    }
  }
}

// OrdersRepo and UsersRepo ask at the same moment; ReportsJob asks later.
const [a, b] = await Promise.all([ConnectionPool.getInstance(), ConnectionPool.getInstance()]);
const c = await ConnectionPool.getInstance();

assert.equal(poolsOpened, 1);
assert.ok(a === b && b === c);
console.log(`pools opened: ${poolsOpened}, connections: ${a.connections.length}, same object: ${a === b && b === c}`);
// pools opened: 1, connections: 10, same object: true
```

ที่แก้ได้ก็เพราะ function แบบ `async` รันแบบ synchronous ไปจนถึง `await` ตัวแรก: การ assign ด้วย `??=` เกิดขึ้นระหว่างการเรียกครั้งแรก ก่อนที่ผู้เรียกคนอื่นจะได้คิว ส่วนบรรทัดที่พังเช็ก field ก่อน แล้ว await แล้วค่อย assign ทำให้การเรียกพร้อมกันสองครั้งตกลงไปในช่องว่างระหว่างการเช็กกับการ assign ทั้งคู่

## ใช้ตอนไหนดี

- resource ที่ต้องมีตัวเดียวใน process และแพงหรือมีจำกัด: connection pool, thread pool, metrics registry, cache ใน process ถึงอย่างนั้นก็ควรสร้างมันครั้งเดียวในจุดที่ประกอบโปรแกรม (`main()` หรือ DI container) แล้วส่งเข้าไป เก็บ static `getInstance()` ไว้ใช้ในที่ที่ส่งของเข้าไปไม่ได้ เช่น entry point ของ library หรือ callback ของ framework
- object ที่จำลองสิ่งที่ process มีอยู่แค่ชิ้นเดียวจริง ๆ ตัว `Runtime.getRuntime()` ของ JDK คืน object `Runtime` ตัวเดียวที่แอป Java ทุกตัวมี
- ไม่ใช่สำหรับ helper ที่ไม่มี state: function ธรรมดา หรือ module ที่รวม function ไว้ ทำงานนี้ได้โดยไม่ต้องมี instance
- ไม่ใช่ตอนที่ "มีแค่ตัวเดียว" ต้องเป็นจริงทั้งระบบ การมี scheduler หรือ writer ที่ active ตัวเดียวในบรรดา replica หลายตัวคือ [leader election](../leader-election/) และการมีแหล่ง setting แหล่งเดียวสำหรับทุก instance คือ [external configuration store](../external-configuration-store/)

## ได้อะไร เสียอะไร

- **dependency ที่ซ่อนอยู่** class ที่เรียก `ConnectionPool.getInstance()` ข้างใน method ต้องใช้ database แต่ไม่มีอะไรใน constructor ของมันบอกไว้เลย บล็อกโพสต์ปี 2008 ของ Miško Hevery เรียก singleton ว่า "pathological liars" ด้วยเหตุผลนี้ และเสนอให้ส่ง dependency เข้าไปทาง constructor แทน
- **test ที่รั่วใส่กัน** instance อยู่ได้นานกว่า test แต่ละตัว state ที่ test หนึ่งทิ้งไว้เลยไปเปลี่ยน test ถัดไป และ test ก็สลับเอา pool ปลอมเข้าไปแทนไม่ได้ ถ้าไม่ล้วงเข้าไปใน class ส่วน hook แบบ static อย่าง `resetForTests()` ก็เป็น code smell: มันเจาะประตูหลังไว้ในโค้ด production และก็ยังพังอยู่ดีเมื่อ test รันแบบขนาน ให้ inject instance เข้าไปแทน แล้ว test แต่ละตัวก็สร้างของที่ตัวเองต้องใช้
- **มีตัวเดียวแค่ในขอบเขตหนึ่ง** singleton ใน Java มีหนึ่งตัวต่อ class loader (เอกสารของ Spring เทียบเรื่องนี้กับ singleton แบบหนึ่งตัวต่อ container ของ Spring เอง) ใน JavaScript มีหนึ่งตัวต่อ module ที่โหลด และใน Python มีหนึ่งตัวต่อ interpreter ถ้า scale service ไปเป็น 4 replica ก็จะได้ 4 pool กับ 40 connection โดยที่ `max_connections` ของ PostgreSQL มีค่า default เป็น 100 แค่สิบ replica แบบนี้ก็ใช้โควตาไปหมดแล้ว
- **lifecycle** ต้องมีคนปิด pool ตอน shutdown หลังจากทุกอย่างที่ใช้มันหยุดไปแล้ว container ที่สร้าง singleton จะ dispose มันได้ ส่วน static ที่เขียนเองมักถูกเปิดค้างไว้จน process จบ
- **concurrency** การสร้างแบบ lazy ต้องมีตัวกันที่ปลอดภัยทั้งกับ thread หรือกับ promise ที่วิ่งพร้อมกัน และตัว instance เองก็ต้องปลอดภัยเมื่อผู้เรียกทุกคนใช้มันพร้อมกัน

## ข้อควรรู้ตอนลงมือทำ

- **Java มีสามแบบที่ปลอดภัย** *Eager*: field แบบ `private static final` ที่ตั้งค่าตรงที่ประกาศ โดยที่ JVM รัน class initialisation ภายใต้ lock ต่อ class เลยได้ instance ตัวเดียวแน่นอน *Lazy*: holder idiom คือ nested class ที่มี static field ถือ instance ไว้ แล้ว JVM จะ initialise nested class นั้นก็ต่อเมื่อ `getInstance()` อ่าน field นั้นครั้งแรก *Enum*: `enum ConnectionPool { INSTANCE; ... }` แบบที่ Joshua Bloch แนะนำใน *Effective Java* (Item 3) และแสดงไว้ใน [โค้ดตัวอย่าง](https://github.com/jbloch/effective-java-3e-source-code/tree/master/src/effectivejava/chapter2/item3) ของหนังสือ ส่วน double-checked locking ต้องให้ field เป็น `volatile` และวิธีนี้ไว้ใจได้ตั้งแต่ Java 5 เป็นต้นมา (ยกเว้นอย่างเดียวคือ immutable object ที่มีแต่ field แบบ `final`) ถ้าไม่มีมัน thread อื่นก็อาจเห็น reference ก่อนที่ object ข้างหลังมันจะถูกสร้างเสร็จ
- **ช่องโหว่ของ Java** การ deserialise singleton ที่เป็น class จะได้ object ใหม่ เว้นแต่ class จะนิยาม `readResolve()` ให้คืน instance ที่มีอยู่ ส่วน reflection ที่ใช้ `setAccessible(true)` ก็ยังเรียก private constructor ได้ในที่ที่ module access ยอม โค้ดที่ระวังตัวเลย throw จาก constructor ถ้ามี instance อยู่แล้ว enum ปิดช่องโหว่ได้ทั้งคู่: ค่าคงที่ถูก serialise เป็นชื่อของมัน แล้ว resolve กลับมาเป็นค่าคงที่ตัวเดิม และ `Constructor.newInstance` ก็ไม่ยอมสร้าง instance ของ enum ราคาที่ต้องจ่ายคือ enum extend class อื่นไม่ได้
- **runtime อื่น ๆ** ใน C# ตัว `Lazy<T>` เป็น thread-safe โดย default ตัว `static readonly Lazy<ConnectionPool>` เลยสร้าง pool ตัวเดียวแน่นอน ใน Go ตัว `sync.OnceValue` (Go 1.21 ขึ้นไป) ห่อ constructor ไว้ให้รันครั้งเดียว ต่อให้ถูกเรียกพร้อมกันก็ตาม ใน Kotlin การประกาศ `object` จะถูก initialise แบบ thread-safe ตอนเข้าถึงครั้งแรก
- **`private` ของ TypeScript เป็นการเช็กตอน compile** TypeScript handbook บอกว่า `private` ถูกบังคับแค่ตอน type checking ทำให้ JavaScript ธรรมดา หรือการ cast ก็ยังเรียก `new ConnectionPool()` ได้ ถ้าเรื่องนี้สำคัญ ก็อย่า export class เลย: export ตัว accessor หรือตัว instance แทน
- **module scope คือ singleton ตามธรรมชาติของ JavaScript และ Python** เนื้อของ ES module รันแค่ครั้งเดียว ไม่ว่าจะมี module กี่ตัว import มัน `pool` ที่ export ไว้เลยถูกแชร์กับทุกตัวที่ import ส่วน Node.js ใช้ URL ที่ resolve แล้วเป็น key ของ cache นั้น query string ที่ต่างกันเลยโหลดสำเนาที่สองขึ้นมา และสำหรับ CommonJS module ก็ใช้ชื่อไฟล์ที่ resolve แล้วเป็น key ทำให้ package เดียวกันที่มีสองสำเนาใน `node_modules` ได้ instance สองตัว Python เก็บ module ทุกตัวที่ import ไว้ใน `sys.modules` ทำให้ `pool = ConnectionPool()` ระดับ module รันครั้งเดียวต่อ interpreter เว้นแต่จะมีอะไรเรียก `importlib.reload()` หรือลบ entry นั้นทิ้ง
- **DI container** Spring bean เป็น singleton scope โดย default: instance เดียวต่อ container และ bean definition ส่วนใน .NET ตัว `AddSingleton` register service ที่ container สร้างตอน request แรก (หรือ instance ที่ส่งให้เอง) แล้วใช้ซ้ำกับทุก request ที่ตามมา ตัว service แบบนี้ต้อง thread-safe และต้องไม่ถือ service แบบ *scoped* ค้างไว้ ใน Development environment ตัว default service provider จะเช็กความผิดพลาดนี้ให้
- **ในระดับ cluster** "ตัวเดียว" ข้าม replica ต้องอาศัยการประสานงาน ไม่ใช่ static field: lease ใน store ที่ใช้ร่วมกัน และแผนรับมือตอนที่ตัวที่ถือ lease ตาย นั่นก็คือ [leader election](../leader-election/) ถ้าจะจำกัดจำนวน database connection ข้าม replica หลายตัว ให้วาง pooler ฝั่ง server อย่าง PgBouncer หรือ managed database proxy ไว้หน้า database
