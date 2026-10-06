## ปัญหา

notification service มีงานหนึ่งที่ไม่เปลี่ยน คือส่ง message แต่มีหลายวิธีส่ง: วันนี้มี email กับ SMS ไตรมาสหน้าก็จะมี push ส่วนเวอร์ชันแรกมักเลือกวิธีส่งไว้ใน method ที่ทำงานจริงเลย `Notifier.send(msg, kind)` เช็ก `kind` แล้วเรียก `new EmailChannel()` หรือ `new SmsChannel()` เอง

แบบนี้ logic ที่ควรอยู่นิ่ง ๆ (จัดรูปแบบ, retry, logging) ก็ไปอยู่ใน method เดียวกับส่วนที่เปลี่ยนอยู่ตลอด `Notifier` ผูกกับ concrete channel ทุกตัว ทำให้การเพิ่ม push ต้องเปิด `send()` มาแก้อีก เพิ่ม branch แล้ว test ซ้ำอีกรอบกับ method ที่ caller ทุกตัวพึ่งอยู่ แถม `if/else` ชุดเดียวกันนี้ก็มักถูกก๊อปไปทุกที่ที่ต้องใช้ channel

## ทำงานยังไง

Factory Method แยกการ*ใช้* object ออกจากการ*เลือก class ของมัน* class ที่มี logic ประกาศ method ที่คืน object ตัวนั้นเป็น type แบบ interface แล้วเรียก method นี้ทุกที่ที่ต้องใช้ object จากนั้น subclass แต่ละตัวก็ override method นั้นเพื่อเลือก concrete class แพตเทิร์นนี้ได้ชื่อมาจากหนังสือ *Design Patterns* ของ Gamma, Helm, Johnson และ Vlissides (1994) ที่ให้อีกชื่อไว้ว่า *Virtual Constructor*: การเรียก constructor ที่ถูก dispatch เหมือน virtual method

| ผู้มีบทบาท | ในแผนภาพ | หน้าที่ |
|---|---|---|
| **Product** | `Channel` | interface ที่ object ทุกตัวที่ถูกสร้าง implement |
| **ConcreteProduct** | `EmailChannel`, `SmsChannel` | class ที่ลงมือส่งจริง |
| **Creator** | `Notifier` | ประกาศ factory method `createChannel()` และถือ logic ที่ใช้ผลลัพธ์ของมัน คือ `send()` |
| **ConcreteCreator** | `EmailNotifier`, `SmsNotifier` | override `createChannel()` ให้คืน ConcreteProduct หนึ่งตัว |

การสร้าง object ไม่ใช่งานหลักของ Creator มันถือ logic จริงไว้ ส่วน factory method เป็นแค่ hook ข้างในนั้น hierarchy สองชุดวิ่งขนานกัน โดยมี ConcreteCreator หนึ่งตัวต่อ ConcreteProduct หนึ่งตัว

**ทำไม Creator รู้จักแค่ interface** ถ้าไม่มีแพตเทิร์นนี้ source code ของ `Notifier` จะพึ่ง `EmailChannel` กับ `SmsChannel` ทำให้ policy ระดับสูง (ส่ง notification ยังไง) ไปพึ่งรายละเอียดระดับล่าง (เรียก SMS gateway ยังไง) พอมีแพตเทิร์นนี้ `Notifier` กับ channel ทุกตัวก็พึ่ง abstraction ที่ชื่อ `Channel` และบรรทัดเดียวที่เอ่ยชื่อ `SmsChannel` ก็คือ override ใน `SmsNotifier` นี่คือ dependency inversion principle ในระดับ class เดียว และเป็นสิ่งที่ทำให้ `Notifier` ถูก compile, ship และ test ได้โดยไม่ต้องมี channel สักตัว รวมถึงทำให้ขั้นที่ 4 เพิ่ม push ได้โดยไม่ต้องแตะมันเลย

แต่การตัดสินใจก็ไม่ได้หายไปไหน ยังต้องมีอะไรสักอย่างสร้าง `SmsNotifier` แทนที่จะเป็น `EmailNotifier` การเลือกนี้ย้ายออกจากการเรียก `send()` ทุกครั้ง ไปอยู่ที่จุดที่แอปถูกประกอบเข้าด้วยกัน และเลือกแค่ครั้งเดียวที่นั่น

**มีสามอย่างที่ใช้ชื่อเดียวกัน** และสับสนกันง่าย:

| | มันคืออะไร | subclass เปลี่ยนสิ่งที่ถูกสร้างได้ไหม? |
|---|---|---|
| **Simple factory** | function หรือ class ตัวเดียวที่มี switch บน parameter เช่น `createChannel(kind)` ตัวแนวคิดนี้มาจากหนังสือ *Head First Design Patterns* และไม่ได้เป็นหนึ่งใน 23 แพตเทิร์นของ GoF | ไม่ได้ ชนิดใหม่ก็ยังต้องแก้ switch อยู่ดี แต่อย่างน้อย switch ก็อยู่ที่เดียว แทนที่จะอยู่ใน `send()` |
| **Static factory method** | static method ที่ใช้แทน constructor ตั้งชื่อให้มีความหมายได้ คืน object ที่ cache ไว้ได้ หรือคืน subtype ก็ได้ `Integer.valueOf(int)` อาจคืน instance ที่ cache ไว้ (เสมอสำหรับ −128 ถึง 127) และเอกสารของ Java ก็เรียก `List.of(…)` ว่า static factory method ส่วน *Effective Java* ของ Joshua Bloch ก็สนับสนุนให้ใช้ใน Item 1 | ไม่ได้ มันถูกเรียกผ่านชื่อ class เลยไม่มีอะไรถูกโยนไปให้ subclass: เป็นอีกไอเดียหนึ่งที่ชื่อคล้ายกัน |
| **Factory Method (GoF)** | instance method ที่ Creator เรียก และ subclass override แบบในแผนภาพนี้ | ได้ นั่นแหละคือหัวใจทั้งหมด |

คำว่า *factory* เฉย ๆ แปลแค่ว่าอะไรสักอย่างที่สร้าง object ส่วน refactoring ของ Martin Fowler ที่ชื่อ [*Replace Constructor with Factory Function*](https://refactoring.com/catalog/replaceConstructorWithFactoryFunction.html) (มีอีกชื่อว่า *Replace Constructor with Factory Method*) ทำให้ได้ function สร้าง object ที่มีชื่อ แบบสองชนิดแรก ไม่ใช่แพตเทิร์นของ GoF

## โค้ด

TypeScript ที่ตรงกับแผนภาพ Node 22.18 ขึ้นไปรันได้เลย (`node notifier.ts`) ด้วยการตัด type ทิ้ง แต่มันไม่ได้ตรวจ type ให้ ตัวที่จับ subclass ที่ลืม `createChannel()` ได้คือ `tsc --noEmit`

```ts
// Product: the only type Notifier.send() knows about.
interface Channel {
  deliver(msg: string): string;
}

// ConcreteProducts
class EmailChannel implements Channel {
  deliver(msg: string): string { return `Email sent: ${msg}`; }
}

class SmsChannel implements Channel {
  deliver(msg: string): string { return `SMS sent: ${msg}`; }
}

// Creator: send() is written once, against the Channel interface.
abstract class Notifier {
  send(msg: string): string {
    const channel = this.createChannel(); // the factory method
    return channel.deliver(msg);
  }

  protected abstract createChannel(): Channel;
}

// ConcreteCreators: each one decides which Channel to create.
class EmailNotifier extends Notifier {
  protected createChannel(): Channel { return new EmailChannel(); }
}

class SmsNotifier extends Notifier {
  protected createChannel(): Channel { return new SmsChannel(); }
}

// The client holds a Notifier; the composition root picked SmsNotifier.
const notifier: Notifier = new SmsNotifier();
console.log(notifier.send('Your code is 4721')); // SMS sent: Your code is 4721

// Later, a new channel: two new classes, no edits to anything above.
class PushChannel implements Channel {
  deliver(msg: string): string { return `Push sent: ${msg}`; }
}

class PushNotifier extends Notifier {
  protected createChannel(): Channel { return new PushChannel(); }
}

console.log(new PushNotifier().send('Your code is 4721')); // Push sent: Your code is 4721
```

ผลลัพธ์:

```
SMS sent: Your code is 4721
Push sent: Your code is 4721
```

## ใช้ตอนไหนดี

- class หนึ่งถือ logic จริงรอบ ๆ object ที่มันสร้าง และ subclass ควรเป็นคนตัดสินว่า object นั้นเป็น concrete class ไหน นี่คือสถานการณ์ทั่วไปของ framework: framework เป็นเจ้าของ algorithm ส่วนแอปส่ง object เข้ามาด้วยการ override hook
- มี subclass หนึ่งตัวต่อหนึ่งแบบอยู่แล้ว การ override เพิ่มอีก method เลยไม่มีต้นทุนอะไร แพตเทิร์นนี้เข้ากันที่สุดตอนที่มี creator hierarchy อยู่แล้ว
- library อยากให้ผู้ใช้เปลี่ยน object ภายในตัวหนึ่งได้ด้วยการ subclass (ดูตัวอย่างใน *ข้อควรรู้ตอนลงมือทำ*)
- เลือกอย่างอื่นดีกว่า ถ้าการเลือกเปลี่ยนไปทุกครั้งที่เรียก หรือมาจากข้อมูล (ส่ง parameter, หา class จาก map หรือส่ง function), ถ้า subclass จะมีไว้แค่เลือก class อย่างเดียว (ส่ง factory function หรือให้ dependency-injection container ทำ) หรือถ้ามี implementation เดียวและไม่มีวี่แววจะมีตัวที่สอง (`new` ธรรมดาก็พอ)

## ได้อะไร เสียอะไร

- **subclass หนึ่งตัวต่อ product หนึ่งตัว** channel ใหม่ทุกตัวต้องมีสอง class คือตัว channel กับ notifier ที่สร้างมัน และ hierarchy สองชุดก็โตไปพร้อม ๆ กัน subclass ที่ไม่ได้ทำอะไรนอกจากเลือก class เป็นแค่พิธีรีตอง โค้ดในภาษาที่มี first-class function เลยมักส่ง factory function เข้าไปแทน
- **การเลือกตายตัวต่อ class** มันถูกเลือกด้วยการ subclass เลยเปลี่ยนตอน runtime ไม่ได้ถ้าไม่เปลี่ยน object ทั้งตัว และการผสมกัน (SMS กับ retry policy, email กับ template) ก็ทำให้ subclass งอกเพิ่มแบบทวีคูณ
- **inheritance ผูกกันแน่น** subclass พึ่ง contract แบบ protected ของ base class: `createChannel()` ถูกเรียกตอนไหน บ่อยแค่ไหน และผลลัพธ์ของมันไปเจออะไรต่อ
- **ทางอ้อม (indirection)** อ่านแค่ `send()` อย่างเดียวจะไม่รู้ว่า channel ไหนทำงาน ต้องรู้ด้วยว่า object เป็น class อะไร
- **สิ่งที่ได้กลับมา** `send()` ปิดต่อการแก้ไขและเปิดต่อการขยาย, Creator ถูก test ได้ด้วย product ปลอม และโค้ดที่ใช้ channel กับโค้ดที่เลือก channel ก็เปลี่ยนด้วยเหตุผลที่ต่างกัน

## ข้อควรรู้ตอนลงมือทำ

- **abstract หรือมี default** `createChannel()` แบบ abstract บังคับให้ subclass ทุกตัวต้องเลือก ส่วน implementation แบบ default (เช่น email) ทำให้จะ subclass หรือไม่ก็ได้ subclass ก็ override แค่สิ่งที่ต้องการ `AbstractList.iterator()` ของ Java เป็น default แบบนี้ ที่สร้างอยู่บน `get(int)` กับ `size()` แล้ว `ArrayList` ก็ override มันด้วย iterator ของตัวเอง
- **factory method แบบมี parameter** `createChannel(kind)` รับตัวระบุมาแล้ว switch ตามค่านั้น ส่วน subclass ก็ override เพื่อเพิ่มหรือเปลี่ยนชนิด แล้วโยนที่เหลือให้ `super.createChannel(kind)` แบบนี้ switch ก็กลับมาอีกครั้ง แต่อยู่ในที่เดียวที่ override ได้ แทนที่จะอยู่ใน `send()`
- **อย่าเรียกจาก constructor** ใน TypeScript, JavaScript และ Java ถ้า constructor ของ base class เรียก method ที่ถูก override มันจะรันเวอร์ชันของ subclass ก่อนที่ field ของ subclass เองจะถูก initialise ส่วนใน C++ การเรียกจะไปไม่ถึง override เลย เพราะ virtual call ที่เกิดระหว่างการสร้างจะ resolve ไปที่ class ที่กำลังถูกสร้าง ให้สร้าง product ตอนใช้ครั้งแรก หรือใน method ที่ต้องใช้มัน แบบที่ `send()` ทำ
- **test ด้วยการ override** ใช้ test subclass คืน fake ที่คอยบันทึกว่ามันถูกขอให้ส่งอะไรบ้าง โดยไม่ต้องใช้ mocking library: `class TestNotifier extends Notifier { readonly fake = new RecordingChannel(); protected createChannel() { return this.fake; } }`
- **หรือส่ง function เข้าไป** ถ้า subclass มีไว้แค่เลือก class ให้ทำ `Notifier` เป็น concrete class ตัวเดียวที่รับ function สำหรับสร้าง channel อย่าง `new Notifier(() => new SmsChannel())` แบบนี้ก็เลือกตอน runtime ได้ และนี่ก็คือไอเดียของ [Strategy](../strategy/) ที่เอามาใช้กับการสร้าง object ส่วนในภาษาที่ class เป็นค่าได้ อย่าง Python กับ JavaScript ก็ส่งตัว class เข้าไปได้เลย บาง library มีให้ทั้งสองแบบ: [`logging.Logger.makeRecord()`](https://docs.python.org/3/library/logging.html#logging.Logger.makeRecord) ของ Python เขียนไว้ในเอกสารว่าเป็น factory method ให้ subclass override ส่วน `logging.setLogRecordFactory()` (ตั้งแต่ Python 3.2) รับ callable ธรรมดา ตัว `Collectors.toCollection(TreeSet::new)` ของ Java รับ factory เป็น `Supplier` ส่วน dependency-injection container ขยายแนวคิดนี้ออกไป: มันเก็บ factory ไว้หนึ่งตัวต่อ interface แล้วสร้าง object graph ทั้งหมด เช่น [`services.AddTransient<IChannel>(sp => new SmsChannel())`](https://learn.microsoft.com/en-us/dotnet/api/microsoft.extensions.dependencyinjection.servicecollectionserviceextensions.addtransient) ของ .NET
- **เจอได้ที่ไหนบ้าง**
  - Java: [`Collection.iterator()`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/Collection.html#iterator()) ตัว `AbstractCollection` implement `contains`, `toArray` และ `toString` บน `iterator()` แล้วปล่อยตัว `iterator()` เองไว้ให้ subclass ทำให้ collection class แต่ละตัวสร้าง iterator ของตัวเอง
  - .NET: `DbConnection.CreateCommand()` เรียก [`CreateDbCommand()`](https://learn.microsoft.com/en-us/dotnet/api/system.data.common.dbconnection.createdbcommand) ที่เป็น protected abstract โดยที่ connection ของ ADO.NET provider แต่ละเจ้า override มันให้คืน command class ของตัวเอง
  - Python: `logging.Logger.makeRecord()` ที่เล่าไว้ข้างบน
  - Qt: [`QMainWindow::createPopupMenu()`](https://doc.qt.io/qt-6/qmainwindow.html#createPopupMenu) เป็น virtual หน้าต่างหลักเรียกมันตอนที่ผู้ใช้เปิด context menu แล้ว subclass ก็ reimplement มันให้คืนเมนูของตัวเอง
- **ญาติ ๆ**
  - [Template Method](../template-method/): `send()` คือ template method ตัวเล็ก ๆ ที่ขั้นที่เปลี่ยนไปคือการสร้าง object ส่วน factory method โดยทั่วไปก็มักถูกเรียกจาก template method และ Factory Method ก็มักถูกเล่าว่าเป็น Template Method ที่เจาะจงไว้สำหรับการสร้าง object
  - [Abstract Factory](../abstract-factory/): factory object แยกต่างหาก ที่มี method สร้างของหนึ่งตัวต่อ product แต่ละตัวในตระกูล และ method พวกนั้นก็มักเป็น factory method ตัวอย่างหนึ่งคือ [`DbProviderFactory`](https://learn.microsoft.com/en-us/dotnet/api/system.data.common.dbproviderfactory) ของ .NET ที่มี `CreateConnection()`, `CreateCommand()` และ `CreateParameter()`
  - [Prototype](../prototype/): สร้าง object ด้วยการก๊อป instance ที่ตั้งค่าไว้แล้ว เลยไม่ต้องมี creator subclass แต่ต้องมีการก๊อปที่ไว้ใจได้
  - [Builder](../builder/): ประกอบ object ที่ซับซ้อนหนึ่งตัวทีละขั้น ส่วน Factory Method ตัดสินในการเรียกครั้งเดียวว่าจะสร้าง instance จาก class ไหน
  - [Singleton](../singleton/): factory method อาจแจก instance ที่แชร์กันแทนตัวใหม่ก็ได้ และฝั่งที่เรียกก็แยกไม่ออกว่าต่างกัน
- **ในระดับสถาปัตยกรรม** ใน [Hexagonal Architecture](../hexagonal-architecture/) ตัว core เป็นเจ้าของ port (interface แบบ `Channel`) แล้ว adapter ก็ implement มัน นี่คือการกลับทิศแบบเดียวกัน แต่การเลือก implementation ย้ายจากการ override ใน subclass ไปอยู่ที่ composition root ตอนเริ่มทำงาน และ implementation ก็คือ adapter ที่ต่อกับระบบจริง (SMTP server, SMS gateway, push service) ส่วน [Microkernel](../microkernel/) ไปไกลกว่านั้นอีกขั้น: plug-in ส่ง implementation เข้ามาที่ extension point ที่ core คอยหาตอน runtime
