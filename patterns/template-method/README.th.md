## ปัญหา

catalogue สินค้า import ข้อมูลจาก supplier และ supplier แต่ละรายก็ส่งไฟล์มาใน format ของตัวเอง importer ตัวแรกอ่าน CSV: มันเปิดไฟล์ อ่าน row แปลงแต่ละ row เป็น record สินค้า เช็กแต่ละ record บันทึกตัวที่ถูกต้อง แล้วปิดไฟล์ พอมี supplier ส่ง JSON Lines มาแทน ทางที่เร็วที่สุดคือก็อป class มาแล้วแก้บรรทัดที่ parse row ตอนนี้เลยมีสอง class ที่ถือขั้นตอนเดียวกัน ทั้งที่จากหกขั้นมีแค่ขั้นเดียวที่ต่างกันจริง ๆ

พอแก้ครั้งแรก ฉบับที่ก็อปกันมาก็เริ่มเดินคนละทาง ใน diagram มีสินค้าที่ไม่มีชื่อหลุดเข้า catalogue เลยมีการเพิ่มการเช็กชื่อใน `CsvImporter` แต่ `JsonImporter` มีขั้นนั้นเป็นฉบับของตัวเอง ไม่มีใครนึกถึงมัน และมันก็ยังรับสินค้าพวกนั้นอยู่ ทุกการเปลี่ยนแปลงต่อจากนี้ในขั้นที่ใช้ร่วมกัน (transaction ครอบการบันทึก, จำกัดจำนวน row, error message ที่ชัดขึ้น) ต้องตามหา แก้ และ test ในทุกฉบับ และไม่มีอะไรกันไม่ให้ฉบับหนึ่งรันขั้นตอนต่างลำดับจากฉบับอื่น

## ทำงานยังไง

Template Method เขียนขั้นตอนไว้ครั้งเดียวใน base class เป็น method ที่เรียกแต่ละขั้นตามลำดับที่ตายตัว แล้วเว้นบางขั้นไว้ให้ subclass เติม ตัว base class ตัดสินว่า*อะไร*เกิดขึ้นและเกิด*เมื่อไหร่* ส่วน subclass ตัดสินแค่ว่าขั้นของตัวเองทำ*ยังไง* ตัว pattern นี้เป็นหนึ่งใน behavioural pattern ใน *Design Patterns* ของ Gamma, Helm, Johnson และ Vlissides (1994) และต่างจาก pattern ส่วนใหญ่ในกลุ่มตรงที่มันทำงานผ่าน inheritance แทนการประกอบ object เข้าด้วยกัน

| ส่วนประกอบ | ใน diagram | หน้าที่ |
|---|---|---|
| **AbstractClass** | `DataImporter` | ถือ template method คือ `run(file)` ที่เรียกแต่ละขั้นตามลำดับ มัน implement ขั้นที่ไม่เคยเปลี่ยน (`open`, `readRows`, `save`, `close`) ประกาศขั้นที่เป็น abstract และให้ default กับ hook แต่ละตัว |
| **ConcreteClass** | `CsvImporter`, `JsonImporter` | implement ขั้นที่เป็น abstract (`parse(row)`) และ override hook เมื่อจำเป็น (`JsonImporter.validate`) มันไม่ได้เป็นคนตัดสินลำดับของขั้นตอน |

**ขั้นตายตัว ขั้น abstract และ hook** ขั้นที่ template method เรียกมีสามแบบ และใครที่เขียน subclass ก็ต้องรู้ว่าขั้นไหนเป็นแบบไหน:

- **ขั้นตายตัว** เป็นของ base class และไม่ได้มีไว้ให้เปลี่ยน: `open`, `readRows`, `save` และ `close` ในโค้ดข้างล่างพวกนี้เป็น private ของ `DataImporter`
- **ขั้น abstract** ไม่มี implementation ใน base class ทุก subclass เลยต้องเขียนเอง: `parse(row)` ส่วน compiler ของ TypeScript, Java และ C# จะไม่ยอมรับ concrete subclass ที่ขาดขั้นนี้ไป
- **Hook** มี default มาให้ และ subclass จะ override ก็ได้: `validate(rec)` ปฏิเสธ record ที่ไม่มีชื่อ เว้นแต่ subclass จะบอกเป็นอย่างอื่น ส่วน hook หลายตัวไม่ได้ทำอะไรเลยโดย default แค่ทำเครื่องหมายจุดที่ subclass เพิ่มพฤติกรรมได้ บ่อยครั้งก็อยู่ก่อนหรือหลังขั้นสำคัญ [Refactoring.Guru](https://refactoring.guru/design-patterns/template-method) สงวนคำว่า *hook* ไว้เรียกตัวที่ว่างพวกนี้ และเรียกขั้นที่มี default จริง ๆ ว่า *optional step* ไม่ว่าจะเรียกแบบไหน template method ก็ทำงานได้ทั้งตอนที่ขั้นนั้นถูก override และไม่ถูก override

ทำให้ความต่างนี้เห็นได้ในโค้ด method แบบ abstract ดูแลขั้นที่ต้องเขียนให้แล้ว ส่วน hook ให้ตั้งชื่อตามจังหวะที่มันรัน หรือตามเรื่องที่มันตัดสิน (`beforeSave`, `afterRow`, `shouldSkip`) จะได้อ่านแล้วรู้ว่าเป็นตัวเลือก เขียน default ของมันไว้ในเอกสาร และให้มันเป็น `protected` คนเรียกจะได้รันมันผิดลำดับไม่ได้ [`ThreadPoolExecutor`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html) ของ Java เป็นแบบอย่างที่ดี: เอกสารของมันแสดง `beforeExecute`, `afterExecute` และ `terminated` ไว้ใต้หัวข้อ *Hook methods* และสองตัวแรกไม่ทำอะไรเลยถ้า subclass ไม่ override

**การควบคุมที่กลับทิศ** ใน diagram การเรียกวิ่งจาก base class ลงไปที่ subclass: `run()` เรียก `this.parse(row)` และ `CsvImporter` ไม่เคยเป็นคนขับการ import เอง นี่คือ inversion of control หรือที่เรียกกันว่า Hollywood principle ("don't call us, we'll call you") และ [*InversionOfControl*](https://martinfowler.com/bliki/InversionOfControl.html) ของ Martin Fowler ก็ใช้ template method เป็นตัวอย่างที่ง่ายที่สุด: superclass เป็นเจ้าของ flow และ subclass เติมขั้นที่มันเรียก ตัว framework เองก็ถูกขยายด้วยวิธีนี้ และนี่ก็เป็นเหตุผลที่อ่าน subclass แยกเดี่ยว ๆ แล้วจะไม่รู้ว่า method ของมันรันตอนไหน

**ปกป้องโครง** pattern นี้ใช้ได้ก็ต่อเมื่อ subclass เปลี่ยนลำดับไม่ได้ ตัว template method เองเลยไม่ควร override ได้:

- **Java:** ประกาศให้เป็น `final` ตัว [Java tutorial](https://docs.oracle.com/javase/tutorial/java/IandI/final.html) แนะนำให้ใช้ `final` กับ method ที่พฤติกรรมห้ามเปลี่ยน เพราะความสอดคล้องของ object ขึ้นกับมัน
- **C# และ Kotlin** ทำให้ method override ไม่ได้ ถ้าไม่ได้บอกเป็นอย่างอื่น: method ใน C# เป็น [non-virtual โดย default](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/virtual) และ member ใน Kotlin override ไม่ได้ถ้าไม่มี [`open`](https://kotlinlang.org/docs/inheritance.html) แล้วก็ให้ใส่ `abstract`, `virtual` หรือ `open` แค่กับขั้นต่าง ๆ
- **TypeScript** ไม่มี `final` เลยต้องปกป้องโครงด้วยข้อตกลง (comment, code review) และด้วยการไม่เปิดสิ่งที่ไม่ควรเปลี่ยน: private method แบบ ES อย่าง `#save` ถูกเรียกหรือถูกแทนที่จาก subclass ไม่ได้ ส่วน `protected` กันไม่ให้คนเรียกเข้าถึงขั้นอื่น ๆ ได้ในตอน compile ส่วนถ้าเปิด compiler option [`noImplicitOverride`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-3.html) ทุกการ override ต้องมี `override` กำกับ ทำให้ `run()` ไม่ถูก override โดยบังเอิญ แต่ถ้าตั้งใจก็ยังทำได้อยู่
- **Python:** [`@typing.final`](https://docs.python.org/3/library/typing.html#typing.final) บอก type checker ว่า method นี้ห้าม override แต่ตอน runtime ไม่มีอะไรเช็กให้

## โค้ด

TypeScript ที่ตรงกับ diagram ตัวโค้ดรันด้วย Node 22.18 ขึ้นไปได้เลย (`node importer.ts`): Node ตัด type ทิ้งโดยไม่เช็ก เลยต้องใช้ `tsc --noEmit` จับ subclass ที่ลืม `parse()` ตัวโค้ดนี้ยังผ่านแม้จะเปิด `noImplicitOverride` ไว้ด้วย ส่วน map ใช้แทน file system และ array `saved` ใช้แทน database

```ts
interface Product { readonly id: number; readonly name: string; readonly price: number }

// Stand-ins for the file system and the database, so the example runs as is.
const files: Record<string, string> = {
  'products.csv': '1001,Mug,12.00\n1002,Lamp,45.00\n1003,,7.50\n1004,Plate,9.90\n1005,Bowl,6.40',
  'products.jsonl': '{"id":2001,"name":"Cup","price":0}\n{"id":2002,"name":"Vase","price":19.5}',
};

// AbstractClass: run() is the template method.
abstract class DataImporter {
  readonly saved: Product[] = [];
  readonly rejected: Product[] = [];
  #text = '';

  // The skeleton. Don't override it: TypeScript has no `final`.
  run(file: string): void {
    this.#open(file);
    const records = this.#readRows().map((row) => this.parse(row));
    for (const rec of records) {
      if (this.validate(rec)) this.#save(rec);
      else this.rejected.push(rec);
    }
    this.#close();
  }

  // Abstract step: every subclass must supply it.
  protected abstract parse(row: string): Product;

  // Hook: a default that a subclass may override.
  protected validate(rec: Product): boolean {
    return rec.name.trim() !== '';
  }

  // Fixed steps: #private, so a subclass can neither call nor replace them.
  #open(file: string): void { this.#text = files[file]; }
  #readRows(): string[] { return this.#text.split('\n'); }
  #save(rec: Product): void { this.saved.push(rec); }
  #close(): void { this.#text = ''; }
}

// ConcreteClasses
class CsvImporter extends DataImporter {
  protected override parse(row: string): Product {
    const [id, name, price] = row.split(',');
    return { id: Number(id), name, price: Number(price) };
  }
}

class JsonImporter extends DataImporter {
  protected override parse(row: string): Product {
    return JSON.parse(row) as Product;
  }
  protected override validate(rec: Product): boolean {
    return super.validate(rec) && rec.price > 0; // keep the default, add a rule
  }
}

const csv = new CsvImporter();
csv.run('products.csv');
console.log(`${csv.saved.length} saved, ${csv.rejected.length} rejected`); // 4 saved, 1 rejected
console.log(csv.rejected.map((r) => r.id));                                 // [ 1003 ]

const json = new JsonImporter();
json.run('products.jsonl');
console.log(json.rejected.map((r) => r.name));                              // [ 'Cup' ] (price 0)
```

ผลลัพธ์:

```
4 saved, 1 rejected
[ 1003 ]
[ 'Cup' ]
```

`JsonImporter` อ่าน JSON Lines ที่เป็นหนึ่ง object ต่อหนึ่ง row ทำให้ขั้น `readRows()` ที่ตายตัวใช้ได้กับทั้งสอง format ส่วน `Cup` ในไฟล์ที่สองราคา 0 ทำให้ hook ของ `JsonImporter` ปฏิเสธมัน แต่ถ้าเป็น `CsvImporter` ที่ใช้ default ก็จะบันทึกมันไว้

## ใช้ตอนไหนดี

- หลาย class รันขั้นตอนเดียวกันและต่างกันแค่บางขั้น โดยลำดับต้องเหมือนกันทุกตัว: importer และ exporter, ตัวสร้าง report, lifecycle ของ test, request หรือ job
- กำลังเขียน framework หรือ base class ของ library: framework เก็บ flow ไว้เอง แล้วเปิดขั้น abstract และ hook เป็นจุดให้ผู้ใช้เสียบของตัวเองเข้ามา
- class สองตัวโตมาจากการ copy-paste แบบใน step 1 และขั้นที่ใช้ร่วมกันควรมีอยู่ที่เดียว (ดู *มันคือการ refactor* ข้างล่าง)
- ไม่ใช่ตอนที่ส่วนที่เปลี่ยนได้ต้องถูกเลือกตอน runtime หรือผสมกันได้อิสระ (เช่น parse แบบ CSV กับ validation ที่เข้มกว่าแบบ JSON): แบบนั้นให้ส่งมันเข้าไปเป็น object หรือ function แทน นั่นก็คือ [Strategy](../strategy/) และไม่ใช่สำหรับ variant เดียว ตรงนั้น method ธรรมดาง่ายกว่า

## ได้อะไร เสียอะไร

- **inheritance ผูกติด** subclass ขึ้นกับ contract แบบ protected ของ base class: มีขั้นอะไรบ้าง ถูกเรียกเมื่อไหร่ และแต่ละขั้นสมมติอะไรได้บ้าง การเปลี่ยน base class อาจทำ subclass ที่มันไม่เคยเห็นพังได้ และในภาษาที่มี single inheritance ตัว class ที่ extend `DataImporter` ก็ extend อย่างอื่นไม่ได้อีก
- **หนึ่ง subclass ต่อหนึ่งชุดผสม** parser สองตัวกับกฎ validation สองข้อ ได้ subclass สี่ตัว หรือ hierarchy ที่ลึกขึ้น และแต่ละ variant ก็ตายตัวตั้งแต่ตอนเขียน class
- **control flow ถูกซ่อน** อ่าน `CsvImporter` อย่างเดียวจะไม่เห็นว่า `parse()` รันตอนไหน หรือผลของมันไปไหนต่อ ต้องไปอ่าน `run()` ใน base class
- **override อาจทำให้ default อ่อนลง** `JsonImporter.validate()` ยังเช็กชื่ออยู่ก็เพราะมันเรียก `super.validate(rec)` เท่านั้น ถ้าเอาการเรียกนั้นออก สินค้าที่ไม่มีชื่อก็จะหลุดเข้ามาอีกเหมือนใน step 1 และ subclass ก็ผิดสัญญาที่ base class ให้ไว้ Refactoring.Guru เตือนว่าการกด default step ทิ้งแบบนี้อาจละเมิด Liskov substitution principle ส่วนข้อควรรู้ตอนลงมือทำมีรูปแบบที่ปลอดภัยกว่าให้ดู
- **สิ่งที่ได้กลับมา** คือขั้นตอนถูกเขียนและกำหนดตายตัวไว้แค่ครั้งเดียว importer ทุกตัวได้การแก้ในขั้นที่ใช้ร่วมกันไปพร้อมกัน และ format ใหม่ก็เป็นแค่ class เล็ก ๆ ที่มี method เดียว

## ข้อควรรู้ตอนลงมือทำ

- **มันคือการ refactor** การไปจาก step 1 ถึง step 2 คือ [*Form Template Method*](https://refactoring.com/catalog/formTemplateMethod.html) ของ Martin Fowler จาก *Refactoring* ฉบับแรก (1999): ย้ายแต่ละส่วนที่ต่างกันไปไว้ใน method ที่ชื่อและ signature เหมือนกันในทั้งสอง subclass แล้วพอ `run()` สองตัวเหมือนกันเป๊ะ ก็ดึง `run()` ขึ้นไปไว้ใน base class การ refactor นี้ไม่อยู่ในสารบัญของ catalog ออนไลน์ฉบับปัจจุบัน แต่หน้าของมันก็ยังอยู่ ส่วน [*Replace Subclass with Delegate*](https://refactoring.com/catalog/replaceSubclassWithDelegate.html) ไปทางกลับกัน คือจาก subclass ไปเป็น object ที่ class delegate งานไปให้
- **ให้ hook แคบไว้** ถ้า subclass ต้องเรียก `super` เพื่อเก็บพฤติกรรมของ base ไว้ ก็ไม่มีอะไรเตือนให้มันเรียก รูปแบบที่ปลอดภัยกว่าคือให้ `validate()` ตายตัวอยู่ใน base class แล้วให้มันเรียก hook ว่าง ๆ หลังเช็กของตัวเองเสร็จ: `validate(rec)` เช็กชื่อ แล้ว return `this.extraChecks(rec)` ที่โดย default คืน `true` ส่วน `JsonImporter` override แค่ `extraChecks()` ด้วย `rec.price > 0` และไม่มี subclass ไหนทำการเช็กชื่อหายไปได้
- **ใช้ composition ดีกว่าถ้าแต่ละขั้นเปลี่ยนแยกกัน** ถ้า parser กับกฎ validation เปลี่ยนเป็นอิสระต่อกัน หรือต้องเลือกต่อไฟล์ตอน runtime ให้ importer class ตัวเดียวรับขั้นต่าง ๆ มาเป็น object หรือ function: `new Importer({ parse: parseCsv, validate: requirePositivePrice })` นี่คือ [Strategy](../strategy/) ที่ใช้กับแต่ละขั้น โดยโครงยังอยู่ที่เดียว [`JdbcTemplate`](https://docs.spring.io/spring-framework/reference/data-access/jdbc/core.html) ของ Spring สร้างแบบนี้: มันรัน workflow ของ JDBC ที่ตายตัว (สร้างและปล่อย resource สร้างและรัน statement วนอ่านผลลัพธ์ และแปลง exception) แล้วแอปก็ส่ง callback อย่าง lambda ของ `RowMapper` เข้าไปสำหรับส่วนที่เปลี่ยนได้ ในภาษาที่ function เป็นค่าได้ template method มักกลายเป็น higher-order function ที่รับขั้นต่าง ๆ มาเป็น argument
- **ให้ hierarchy ตื้นไว้** ทุกชั้นที่ override ขั้นหนึ่งแล้วเรียก `super` ทำให้ตามลำดับจริงได้ยากขึ้น: ถ้าอยากรู้ว่า `run()` ทำอะไรสำหรับ `GzipCsvImporter` ที่ extend `CsvImporter` ก็ต้องอ่านสาม class ส่วนการมี abstract base class หนึ่งตัวกับ concrete class หนึ่งชั้นคือกรณีที่ง่าย ส่วนที่เปลี่ยนได้มากกว่านั้นให้ย้ายไปอยู่ใน object ที่ประกอบเข้ามา
- **อย่าเรียกขั้นต่าง ๆ จาก constructor** ใน TypeScript, JavaScript และ Java ถ้า constructor ของ base class เรียกขั้นที่ถูก override มันจะรันโค้ดของ subclass ก่อนที่ field ของ subclass เองจะถูก initialise แทนที่จะทำแบบนั้น ให้ client เรียก template method หลังสร้าง object เสร็จ เหมือนที่เรียก `run()` ในที่นี้
- **เจอได้ที่ไหนบ้าง**
  - Java: [`AbstractList`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/AbstractList.html) ต้องการแค่ `get(int)` กับ `size()` จาก subclass ก็สร้าง list ที่แก้ไม่ได้ได้แล้ว และสร้างส่วนที่เหลือของ interface `List` บนสองตัวนั้น รวมถึง iterator ด้วย ส่วน [`InputStream`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/io/InputStream.html) เว้น `read()` ที่อ่านทีละ byte ไว้ให้ subclass และ `read(byte[], int, int)` แบบ default ของมันก็แค่เรียก `read()` ซ้ำ ๆ เอกสารสนับสนุนให้ subclass override ตัวนั้นด้วยของที่เร็วกว่า ส่วน hook method ของ `ThreadPoolExecutor` เล่าไว้ข้างบนแล้ว
  - Python: [`unittest.TestCase.run()`](https://docs.python.org/3/library/unittest.html#unittest.TestCase.run) เรียก `setUp()`, test method แล้วก็ `tearDown()` ส่วน fixture method ทั้งสองตัวไม่ทำอะไรเลยโดย default และ `tearDown()` จะรันแม้ test จะ raise exception แต่ต้อง `setUp()` สำเร็จก่อน บทความใน bliki ของ Fowler ก็พูดเรื่องเดียวกันนี้เกี่ยวกับ `setUp` และ `tearDown` ของ JUnit ที่เป็นต้นแบบของ `unittest`
  - Jakarta Servlet: `service()` ของ [`HttpServlet`](https://jakarta.ee/specifications/servlet/6.1/apidocs/jakarta.servlet/jakarta/servlet/http/httpservlet) dispatch แต่ละ request ไปที่ `doGet`, `doPost` หรือ method `doXxx` ตัวอื่น แล้ว servlet ก็ override ตัวที่มันรองรับ และเอกสารบอกว่าแทบไม่มีเหตุผลที่จะ override `service()` เอง
- **pattern ญาติ ๆ**
  - [Factory Method](../factory-method/): factory method มักเป็นขั้นหนึ่งของ template method คือขั้นที่มีหน้าที่สร้าง object และ Refactoring.Guru เรียก Factory Method ว่าเป็นรูปแบบเฉพาะของ Template Method การ override มันเปลี่ยนสิ่งที่ถูกสร้าง ไม่ได้เปลี่ยนลำดับของขั้นตอน
  - [Strategy](../strategy/): ทั้งคู่แยกส่วนที่เปลี่ยนออกจากส่วนที่ไม่เปลี่ยน Template Method เปลี่ยน*ขั้น*ของอัลกอริทึมผ่าน subclass โดยเลือกต่อ class ตอนเขียนโค้ด ส่วน Strategy เปลี่ยนอัลกอริทึม*ทั้งก้อน*ผ่าน object ที่ context ถืออยู่ โดยเลือกต่อ object และสลับได้ตอน runtime
  - [Builder](../builder/): Director ของมันรันลำดับขั้นการสร้างที่ตายตัวบน builder object ที่ได้รับมา เลยเป็นแนวคิดเดียวกันที่สร้างด้วย composition
- **ในระดับ architecture** ลำดับขั้นที่ตายตัวคือ [Pipes and Filters](../pipes-and-filters/): read, parse, validate และ save กลายเป็น filter แยกกันที่ต่อกันด้วย pipe สิ่งที่เปลี่ยนไปคือแต่ละขั้นเป็น component ที่ deploy แยกได้ของตัวเอง และ scale, เปลี่ยนตัวใหม่ หรือ reuse แยกกันได้ ส่วนลำดับถูกกำหนดด้วยการต่อ pipe แทนที่จะเป็น base class และแต่ละขั้นแชร์กันแค่ข้อมูลที่ไหลผ่านระหว่างกัน
