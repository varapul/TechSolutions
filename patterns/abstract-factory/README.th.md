## ปัญหา

receipts service ทำสองอย่างกับใบเสร็จทุกใบ คือเก็บไฟล์ PDF ไว้ใน blob storage แล้วประกาศผ่าน message queue ให้ billing กับ email รับไปทำต่อ เวอร์ชันแรกรันบน AWS และการเลือกนี้ก็ถูกเขียนลงไปในโค้ดตรง ๆ `issue()` เรียก `new S3BlobStore()` กับ `new SqsQueue()` ส่วน `reissue()` ก็ทำแบบเดียวกัน และ method อื่นทุกตัวที่ต้องใช้ storage หรือ messaging ก็เหมือนกันหมด

แต่ละบรรทัดดูเฉย ๆ ก็ไม่มีพิษภัยอะไร ปัญหาอยู่ที่การตัดสินใจว่า "เรารันบน AWS" ถูกเขียนซ้ำอยู่ในทุกบรรทัด จะย้ายไป Azure ก็ต้องไล่หาแล้วแก้ `new` ทุกจุด และจนกว่าจะแก้ครบจุดสุดท้าย service ก็รันอยู่ในส่วนผสมที่ไม่มีใครออกแบบไว้: `issue()` ส่งไปที่ Service Bus แล้ว แต่ยังเขียนลง S3 อยู่ ส่วน `reissue()` ยังส่งไปที่ SQS ทำให้ consumer ที่ฟังอยู่แค่ queue เดียวพลาดใบเสร็จไปบางส่วน compiler ก็ทักท้วงอะไรไม่ได้ เพราะ `new` แต่ละจุดเป็นการตัดสินใจแยกกัน ส่วน test ก็เจอปัญหาเดียวกันจากอีกฝั่ง: ถ้าจะรันโดยไม่มี cloud ก็ต้องเปลี่ยน object ทีละตัว

สิ่งที่โค้ดไม่ได้บอกไว้คือ class พวกนี้มาเป็นชุด โดย S3 store มาคู่กับ SQS queue, Blob Storage มาคู่กับ Service Bus และ in-memory store ก็มาคู่กับ in-memory queue โค้ดเลยควรเลือกเป็นชุด ไม่ใช่เลือกทีละ class

## ทำงานยังไง

Abstract Factory เปลี่ยนแต่ละชุดให้เป็นตระกูล (family) แล้วให้ตระกูลนั้นมีที่เดียวที่สร้างสมาชิกของมัน interface ตัวเดียวประกาศ method สร้างของไว้หนึ่งตัวต่อ object แต่ละชนิดที่ client ต้องใช้ แล้วแต่ละตระกูลก็ implement interface นี้หนึ่งครั้ง client ขอทุกอย่างจาก factory ของมัน และเห็นแค่ type ที่เป็น abstract ทำให้ object ทุกตัวของมันมาจาก factory เดียวกันและเข้าชุดกัน แพตเทิร์นนี้เป็นหนึ่งใน creational pattern ในหนังสือ *Design Patterns* ของ Gamma, Helm, Johnson และ Vlissides (1994) ที่เรียกมันอีกชื่อว่า *Kit*

| ผู้มีบทบาท | ในแผนภาพ | หน้าที่ |
|---|---|---|
| **AbstractFactory** | `InfraFactory` | ประกาศ method สร้างของหนึ่งตัวต่อ product แต่ละชนิด: `createBlobStore()` และ `createQueue()` |
| **ConcreteFactory** | `AwsFactory`, `AzureFactory`, `InMemoryFactory` | implement method สร้างของทุกตัวสำหรับตระกูลเดียว |
| **AbstractProduct** | `BlobStore`, `Queue` | interface ของ product หนึ่งชนิด |
| **ConcreteProduct** | `S3BlobStore`, `SqsQueue`, `AzureBlobStore`, `ServiceBusQueue`, `MemoryBlobStore`, `MemoryQueue` | implementation หนึ่งตัวต่อหนึ่งตระกูลและหนึ่งชนิด |
| **Client** | `ReceiptService` | ใช้แค่ `InfraFactory`, `BlobStore` และ `Queue` |

ลองนึกภาพเป็นตารางแบบที่แผนภาพวาดไว้: ชนิดของ product คือคอลัมน์ ตระกูลคือแถว และ concrete factory แต่ละตัวเป็นเจ้าของหนึ่งแถว client เขียนโค้ดโดยอิงหัวคอลัมน์ ส่วน factory เป็นตัวตัดสินว่าจะได้แถวไหน

**หัวใจคือความเข้าชุดกัน** แค่เอา class ไปซ่อนไว้หลัง interface ก็ซ่อน class นั้นได้อยู่แล้ว สิ่งที่ factory ของทั้งตระกูลเพิ่มเข้ามาคือการรับประกันเรื่องการจับคู่: `ReceiptService` ที่สร้างด้วย `AwsFactory` จะไม่มีทางได้ Service Bus queue มาอยู่ข้าง S3 store เพราะ object ตัวเดียวสร้างทั้งคู่ หนังสือนับข้อนี้เป็นหนึ่งในประโยชน์หลักของแพตเทิร์น คู่กับการกันชื่อ concrete class ออกจาก client และการเปลี่ยนทั้งตระกูลได้ง่าย

**เลือกครั้งเดียวจบ** ยังต้องมีอะไรสักอย่างตัดสินว่าจะใช้ factory ตัวไหน แต่การตัดสินใจนั้นย้ายออกจาก method ที่ทำงานจริง ไปอยู่ในโค้ดที่ประกอบแอปตอนเริ่มทำงาน Mark Seemann เรียกที่นี้ว่า *composition root*: จุดเดียวที่ object graph ของแอปถูกประกอบขึ้นมา ในแผนภาพมันอ่านค่า `INFRA` แล้วไปหยิบ factory ใน map มาใช้ ปกติแอปต้องการ instance ของ concrete factory แค่ตัวเดียว หนังสือเลยแนะนำให้ทำแต่ละตัวเป็น [Singleton](../singleton/) แต่การสร้าง instance นั้นตัวเดียวตอนเริ่มทำงานแล้วส่งต่อเข้าไป ก็ได้ผลแบบเดียวกันโดยไม่ต้องมีจุดเข้าถึงแบบ global

**product มาจากไหน** ปกติ method สร้างของแต่ละตัวคือ [Factory Method](../factory-method/) ที่ concrete factory implement ด้วย `new` ธรรมดา แบบในโค้ดข้างล่าง ถ้ามีตระกูลหน้าตาคล้าย ๆ กันเยอะ หนังสือเสนออีกทาง: concrete factory ตัวเดียวที่ถือ prototype ของ product แต่ละชนิดไว้ แล้วสร้าง product ใหม่ด้วยการก๊อปตัวพวกนั้น (แพตเทิร์น Prototype) แบบนี้ตระกูลใหม่ก็แค่ config ใหม่ ไม่ต้องมี class ใหม่

**ต่างจากญาติ ๆ ยังไง**

- [Factory Method](../factory-method/) ดูแล product ตัวเดียว: class หนึ่งปล่อยให้ subclass เป็นคนเลือก class ของ product นั้น ส่วน Abstract Factory เป็น object แยกที่มี method สร้างของสำหรับ product แต่ละตัว และตระกูลจะเปลี่ยนตอนที่ส่ง factory object ตัวอื่นเข้าไป ไม่ใช่ตอนที่ subclass ตัว client
- [Builder](../builder/) ประกอบ product ที่ซับซ้อนหนึ่งตัวทีละขั้น แล้วส่งให้ตอนจบ ส่วน Abstract Factory คืน product แต่ละตัวทันที และสิ่งที่มันสนใจคือ product ตัวไหนเข้าชุดกัน
- Prototype สร้าง object ด้วยการก๊อป instance ที่ตั้งค่าไว้แล้ว มันใช้แทน subclass ของ concrete factory ได้ ตามที่เล่าไว้ข้างบน
- [Facade](../facade/) ให้ subsystem มีทางเข้าที่เรียบง่ายทางเดียว หนังสือบอกว่าสองตัวนี้ทำงานด้วยกันได้: abstract factory สร้าง object ของ subsystem ได้โดยไม่ต้องเอ่ยชื่อ class เฉพาะ platform และยังใช้แทน facade ได้ด้วย ถ้าสิ่งที่ต้องการมีแค่การซ่อน class พวกนั้น

## โค้ด

TypeScript ที่ตรงกับแผนภาพ Node 22.18 ขึ้นไปรันได้เลย (`node receipts.ts`) ด้วยการตัด type ทิ้ง แต่มันไม่ได้ตรวจ type ให้ ตัวที่จับ factory ที่ลืม method ไปสักตัวได้คือ `tsc --noEmit`

```ts
import assert from 'node:assert/strict';

// AbstractProducts and AbstractFactory: all that ReceiptService knows.
interface BlobStore { put(key: string, pdf: string): void; }
interface Queue { send(msg: { receiptId: number }): void; }
interface InfraFactory {
  createBlobStore(): BlobStore;
  createQueue(): Queue;
}

// Fakes that record each call with their provider, where real ones would call an SDK.
const calls: string[] = [];
const log = (provider: string, call: string, arg: unknown) =>
  calls.push(`${provider}: ${call} ${typeof arg === 'string' ? arg : JSON.stringify(arg)}`);

// One family per row: two ConcreteProducts and the ConcreteFactory that makes them.
class S3BlobStore implements BlobStore { put(key: string) { log('aws', 'S3 put', key); } }
class SqsQueue implements Queue { send(msg: object) { log('aws', 'SQS send', msg); } }
class AwsFactory implements InfraFactory {
  createBlobStore(): BlobStore { return new S3BlobStore(); }
  createQueue(): Queue { return new SqsQueue(); }
}

class AzureBlobStore implements BlobStore { put(key: string) { log('azure', 'Blob put', key); } }
class ServiceBusQueue implements Queue { send(msg: object) { log('azure', 'Service Bus send', msg); } }
class AzureFactory implements InfraFactory {
  createBlobStore(): BlobStore { return new AzureBlobStore(); }
  createQueue(): Queue { return new ServiceBusQueue(); }
}

class MemoryBlobStore implements BlobStore { put(key: string) { log('memory', 'Map set', key); } }
class MemoryQueue implements Queue { send(msg: object) { log('memory', 'array push', msg); } }
class InMemoryFactory implements InfraFactory {
  createBlobStore(): BlobStore { return new MemoryBlobStore(); }
  createQueue(): Queue { return new MemoryQueue(); }
}

// Client: written once against the interfaces; it never names a cloud.
class ReceiptService {
  private readonly blob: BlobStore;
  private readonly queue: Queue;
  constructor(factory: InfraFactory) {
    this.blob = factory.createBlobStore(); // both products come
    this.queue = factory.createQueue();    // from the same factory
  }
  issue(id: number): void {
    this.blob.put(`receipts/${id}.pdf`, '%PDF-1.7 ...');
    this.queue.send({ receiptId: id });
  }
}

// Composition root: the INFRA setting picks one factory, and with it one family.
const factories: Record<string, InfraFactory> = {
  aws: new AwsFactory(), azure: new AzureFactory(), memory: new InMemoryFactory(),
};
for (const infra of ['aws', 'azure', 'memory']) {
  calls.length = 0;
  new ReceiptService(factories[infra]).issue(1001);
  console.log(calls.join('  |  '));
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.startsWith(`${infra}: `)), 'one family per run');
}
// aws: S3 put receipts/1001.pdf  |  aws: SQS send {"receiptId":1001}
// azure: Blob put receipts/1001.pdf  |  azure: Service Bus send {"receiptId":1001}
// memory: Map set receipts/1001.pdf  |  memory: array push {"receiptId":1001}
```

ผลลัพธ์:

```
aws: S3 put receipts/1001.pdf  |  aws: SQS send {"receiptId":1001}
azure: Blob put receipts/1001.pdf  |  azure: Service Bus send {"receiptId":1001}
memory: Map set receipts/1001.pdf  |  memory: array push {"receiptId":1001}
```

assertion สุดท้ายคือคำสัญญาของแพตเทิร์นนี้: ทุกการเรียกในรอบหนึ่งมาจากตระกูลที่ `INFRA` ระบุไว้ ลองให้ `AwsFactory.createQueue()` คืน `ServiceBusQueue` ดู แล้วมันจะ fail

## ใช้ตอนไหนดี

- client ต้องใช้ object หลายชนิดที่จะทำงานถูกต้องก็ต่อเมื่อใช้ด้วยกันเท่านั้น: client ของ storage กับ messaging ของ cloud เดียวกัน, widget ของ look and feel เดียวกัน, class ของ connection, command และ parameter ของ database provider เดียวกัน
- ควรเลือกตระกูลครั้งเดียว ผ่าน config หรือตอนเริ่มทำงาน และโค้ดที่ใช้ object พวกนั้นไม่ควรรู้ว่าได้ตระกูลไหนมา
- test หรือการพัฒนาบนเครื่องต้องใช้ตระกูลทดแทนแบบครบชุด เช่น fake แบบ in-memory ไม่ใช่เปลี่ยนทีละตัว
- ชนิดของ product นิ่งแล้ว ส่วนตระกูลยังเปลี่ยนได้ ถ้ามีชนิดใหม่โผล่มาเรื่อย ๆ factory ทุกตัวก็ต้องเปลี่ยนทุกครั้ง (ดู *ได้อะไร เสียอะไร*)
- เลือกอะไรที่ง่ายกว่านี้ ถ้ามี product แค่ตัวเดียว (ใช้ factory function หรือ [Factory Method](../factory-method/)), ถ้า object ไม่ต้องเข้าชุดกัน (inject แต่ละตัวแยกกัน) หรือถ้ามีตระกูลเดียวและไม่มีตระกูลที่สองที่เป็นไปได้จริง (สร้างมันตรง ๆ ที่ composition root)

## ได้อะไร เสียอะไร

- **เพิ่มตระกูลได้ถูก แต่เพิ่มชนิด product แพง** ตระกูลใหม่คือแถวใหม่: `GcpFactory` ที่มี `GcsBlobStore` กับ `PubSubQueue` และไม่มีอะไรที่มีอยู่แล้วต้องเปลี่ยน ส่วนชนิด product ใหม่คือคอลัมน์ใหม่: `createCache()` ทำให้ `InfraFactory` เปลี่ยน แล้ว concrete factory ทุกตัวก็ต้อง implement มัน และทุกตระกูลต้องมี class สำหรับ cache ก่อนโค้ดจะ compile ผ่านอีกครั้ง หนังสือยกกรณีนี้ขึ้นมาเป็นกรณีที่แพตเทิร์นนี้รับมือได้ไม่ดี
- **ทางบรรเทา** method แบบมี parameter ตัวเดียว `create(kind)` ทำให้เพิ่มชนิดใหม่ได้โดยไม่ต้องเปลี่ยน interface แต่มันต้องคืน base type ร่วม ฝั่งที่เรียกเลยต้อง cast และชนิดที่ไม่รู้จักจะ fail ตอน runtime แทนที่จะเป็นตอน compile อีกทางคือให้ base class เพิ่ม method ใหม่พร้อม implementation แบบ default ตอนที่ .NET 6 เพิ่ม batching เข้ามา [`DbProviderFactory`](https://github.com/dotnet/runtime/blob/main/src/libraries/System.Data.Common/src/System/Data/Common/DbProviderFactory.cs) ได้ `CreateBatch()` แบบ virtual ที่ throw `NotSupportedException` ถ้า provider ไม่ได้ override มัน กับ property `CanCreateBatch` ที่เป็น `false` โดย default ทำให้ provider ที่มีอยู่ยังทำงานได้ และฝั่งที่เรียกก็เช็กก่อนขอได้
- **ทางอ้อม (indirection)** อ่านแค่ `ReceiptService` อย่างเดียวจะไม่รู้ว่ามันใช้ cloud ไหน คำตอบอยู่ที่ composition root
- **พิธีรีตอง** ถ้ามีตระกูลเดียว หรือ product ไม่ได้พึ่งกันเลย interface กับ class ที่เพิ่มเข้ามาก็มีต้นทุนมากกว่าที่ได้คืน
- **การซ่อน cloud มีราคา** interface สัญญาได้แค่สิ่งที่ทุกตระกูลทำได้ SQS standard queue ส่ง message แต่ละตัวอย่างน้อยหนึ่งครั้ง และบางทีก็สลับลำดับ ส่วน Service Bus ส่งตามลำดับได้ผ่าน session แต่ Basic tier ของมันไม่รองรับ ส่วน `Queue` ที่เป็นกลางกับทุก cloud เลยต้องสัญญาแค่สิ่งที่ทุก provider มีร่วมกัน คือ lowest common denominator ไม่งั้นก็ต้องงอก option ที่มีแค่บางตระกูลทำตาม บทความเรื่อง lock-in ของ Gregor Hohpe ไล่ต้นทุนของ layer แบบนี้ไว้: feature ของ provider ที่เลิกได้ใช้, layer เพิ่มอีกชั้นที่ต้องเข้าใจและดูแล และ dependency ใหม่ที่ผูกกับ abstraction เอง การรันโค้ดเดิมแบบ in-memory สำหรับ test มักคุ้มกับราคานี้ ส่วนการเปิดทางไว้ย้ายไป cloud อื่น (ที่อาจไม่มีวันเกิดขึ้น) มักจะไม่คุ้ม

## ข้อควรรู้ตอนลงมือทำ

- **ตัดสินใจตอนเริ่มทำงาน แล้วส่ง factory เข้าไป** อ่าน setting ครั้งเดียว สร้าง factory ตัวเดียว แล้วส่งให้ object ที่ต้องใช้ ถ้าโค้ดที่อยู่ลึก ๆ ในระบบเรียก `new AwsFactory()` เอง การตัดสินใจก็จะกระจายออกไปอีก
- **ทุกวันนี้แนวคิดนี้ส่วนใหญ่อยู่ใน dependency injection** container เก็บการตัดสินใจว่า "class ไหน implement interface นี้" ไว้ที่เดียวทั้งหมด และการ register class ของตระกูลหนึ่งไว้ด้วยกันก็ให้ factory มาเลย ใน Spring ตัว class `@Configuration` ที่ติด `@Profile("aws")` แล้วมี method `@Bean` ที่คืน `BlobStore` กับ `Queue` ก็คือ concrete factory ของตระกูลนั้น แล้ว `spring.profiles.active` (หรือ `@ActiveProfiles` ใน integration test) ก็เลือกตัวหนึ่งตอนเริ่มทำงาน ใน ASP.NET Core [ธรรมเนียม](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/dependency-injection) สำหรับกลุ่ม service ที่เกี่ยวข้องกันคือ extension method `Add{Group}` หนึ่งตัว ตัว `AddAwsInfrastructure()` ก็จะ register คู่ที่เข้าชุดกัน จากนั้น container ก็ inject ตัว product เข้าไปเลย และ client ก็ไม่เคยเห็น factory เลย แต่ถ้า client ต้องสร้าง product ทีหลัง หรือสร้างมากกว่าหนึ่งครั้ง ก็ให้เก็บ factory แบบชัด ๆ ไว้
- **ทำให้การปนกันเป็นไปไม่ได้ ไม่ใช่แค่ไม่น่าจะเกิด** ถ้าภาษาเปิดให้ทำ ให้เก็บ concrete product เป็นของเฉพาะ package หรือ module ของตระกูลมัน (package-private ใน Java, `internal` ใน C#, ไม่ export ใน TypeScript) แบบนี้ factory ก็จะเป็นทางเดียวที่ได้ของพวกนี้มา
- **รัน contract test ชุดเดียวกับทุกตระกูล** test ชุดเดียวกัน ที่รันทั้งกับตระกูล in-memory และกับตระกูลจริงแต่ละตัว ช่วยให้ fake ซื่อตรง in-memory queue ที่ไม่เคยส่ง message ซ้ำหรือสลับลำดับ จะทำให้ test ผ่านในเคสที่ production จะพัง
- **เจอได้ที่ไหนบ้าง**
  - .NET: `DbProviderFactory` สร้าง class ของ database provider แต่ละเจ้าผ่าน `CreateConnection()`, `CreateCommand()`, `CreateParameter()` และ method คล้าย ๆ กัน ทำให้โค้ดที่เขียนโดยอิง `DbConnection` กับ `DbCommand` เปลี่ยน database ได้ด้วยการเปลี่ยน factory ส่วน `DbProviderFactories.GetFactory()` หา factory จาก invariant name ของ provider ส่วนเรื่อง register นั้น บน .NET Framework ตัว provider register ตัวเองไว้ใน `machine.config` ส่วนบน .NET Core ขึ้นไป แอปเป็นคน register เองด้วย [`DbProviderFactories.RegisterFactory()`](https://learn.microsoft.com/en-us/dotnet/api/system.data.common.dbproviderfactories.registerfactory)
  - Java: `DocumentBuilderFactory.newInstance()` เลือก implementation ของ XML parser ผ่าน [JAXP lookup](https://docs.oracle.com/en/java/javase/27/docs/api/java.xml/module-summary.html) (system property ก่อน แล้วไฟล์ config ของ JAXP แล้ว `ServiceLoader` แล้วค่า default ที่ติดมากับ JDK) และ object `DocumentBuilder` ที่มันสร้าง รวมถึงเอกสาร DOM ที่ object พวกนั้นสร้าง ก็มาจาก implementation นั้นทั้งหมด
  - Swing: look and feel แต่ละตัวมีตาราง class ของ UI delegate ของตัวเอง แล้ว `UIManager.getUI()` ก็สร้าง delegate ของ component จาก look and feel ปัจจุบัน หลัง `UIManager.setLookAndFeel()` การอัปเดต component tree จะเปลี่ยน delegate ทุกตัวเป็นของ look and feel ใหม่ ตารางนี้ใช้ UI class ID ของ component แต่ละตัวเป็น key เท่ากับเป็น factory แบบมี parameter และนี่คือเหตุที่ component ชนิดใหม่เข้ามาได้โดยไม่ต้องเพิ่ม method ใหม่ ตัวอย่างตั้งต้นในหนังสือเองก็คือ widget toolkit ที่รองรับ look and feel หลายมาตรฐาน
- **ในระดับสถาปัตยกรรม: ports and adapters** ใน [Hexagonal Architecture](../hexagonal-architecture/) ตัว `BlobStore` กับ `Queue` คือ driven port ที่ application core เป็นเจ้าของ ส่วน `S3BlobStore` หรือ `ServiceBusQueue` คือ adapter แล้ว composition root ก็เสียบ adapter ชุดที่เข้ากันเข้าไป นี่ก็คืองานของ concrete factory สิ่งที่เปลี่ยนไปในระดับนี้คือตระกูลหนึ่งกลายเป็น infrastructure ที่ deploy ได้ มี credential, region, network rule และ integration test ของตัวเอง ให้นิยาม port แต่ละตัวจากสิ่งที่ core ต้องการ (เก็บใบเสร็จนี้ไว้ ประกาศว่าออกใบเสร็จแล้ว) แทนที่จะก๊อป SDK ของ vendor เจ้าใดเจ้าหนึ่งมา ไม่งั้นมันจะหดเหลือ lowest common denominator ตามที่เล่าไว้ใน *ได้อะไร เสียอะไร*
