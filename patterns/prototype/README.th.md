## ปัญหา

reporting service สร้างรายงานแบบเดียวกันในหลายที่: PDF สำหรับบอร์ด, email digest และ data export ทุกตัวเริ่มจากรายงานรายไตรมาสมาตรฐาน ที่มี theme ของบริษัท (font Inter, accent teal), section Summary, Revenue และ Costs กับค่า default ของ chart ถ้าไม่มีจุดตั้งต้นร่วมกัน method แต่ละตัวก็ต้องสร้างรายงานนั้นเอง: `new Report()` ตามด้วย setter อีกสี่ตัว เป็นห้าครั้งที่เรียกซ้ำกันใน `pdf()`, `email()` และ `export()`

การตั้งค่าที่เขียนซ้ำกันจะค่อย ๆ เพี้ยน ตอนที่สี accent เปลี่ยนจากน้ำเงินเป็น teal และฝ่ายการเงินขอ section Costs เพิ่ม method สองในสามตัวถูกแก้ แต่ `export()` ไม่ได้แก้ ทำให้รายงานที่ export ออกมาหน้าตาและเนื้อหาต่างจากตัวอื่นแบบเงียบ ๆ ยิ่งการตั้งค่ายาว และยิ่งมีหลายที่เขียนซ้ำ เรื่องแบบนี้ก็ยิ่งมีโอกาสเกิด การตั้งค่าบางอย่างก็แพงด้วย (โหลด template จาก storage, parse theme, query ค่า default) การทำซ้ำทุกครั้งที่สร้างรายงานใหม่เลยเปลืองเวลาไปอีก

## ทำงานยังไง

Prototype สร้าง object ใหม่ด้วยการคัดลอก object ที่มีอยู่และตั้งค่าไว้ครบแล้ว แทนที่จะสร้างแต่ละตัวจาก class ของมัน การตั้งค่าทำแค่ครั้งเดียวบน prototype แล้ว object ใหม่ทุกตัวก็เริ่มชีวิตจากการเป็นสำเนาของมัน client เลยเปลี่ยนแค่ส่วนที่ต่าง Gamma, Helm, Johnson และ Vlissides เล่าแพตเทิร์นนี้ไว้ใน *Design Patterns* (1994) จุดสำคัญคือ object แต่ละตัวรู้วิธีคัดลอกตัวเอง โค้ดที่ขอสำเนาเลยไม่ต้องเอ่ยชื่อ concrete class เลย

| ผู้มีบทบาท | ในแผนภาพ | หน้าที่ |
|---|---|---|
| **Prototype** | `interface Prototype<T> { clone(): T }` | ประกาศ operation ที่คัดลอก object |
| **ConcretePrototype** | `Report` ในที่นี้คือ object `quarterly` กับ `monthly` ที่ลงทะเบียนไว้ | implement `clone()` ด้วยการคัดลอกตัวเอง รวมถึง state ที่ซ้อนอยู่ข้างในที่มันเป็นเจ้าของ |
| **Client** | `ReportService` | ขอให้ prototype คัดลอกตัวเองให้ (แทนที่จะเรียก constructor) แล้วค่อยปรับสำเนานั้น |
| *prototype manager* | `PrototypeRegistry` | registry ของ prototype ที่มีชื่อ ให้ client หาก่อนจะ clone ส่วนหนังสือก็เล่าว่ามันเป็นทางเลือกหนึ่งในการ implement ไม่ใช่ผู้มีบทบาท |

**registry** ถ้าชุดของ prototype ไม่ตายตัว ให้เก็บไว้ใน registry ที่ใช้ชื่อเป็น key (หนังสือเรียกว่า prototype manager ส่วน refactoring.guru เรียกว่า prototype registry) แอปลงทะเบียน object ที่ตั้งค่าแล้วตอนเริ่มทำงาน หรือโหลดมาจาก config แล้ว client ก็ขอสำเนาตามชื่อ จะเพิ่มรายงานชนิดใหม่ก็แค่ลงทะเบียน object ที่ตั้งค่าแล้วเพิ่มอีกตัว ไม่ต้องเขียน class

**shallow หรือ deep** ส่วนที่ยากของแพตเทิร์นนี้คือตัว `clone()` เอง shallow copy คัดลอก field ของ object เอง แต่ field ที่ถือ reference (array, object ที่ซ้อนอยู่) ก็ยังชี้ไปที่ของชิ้นเดียวกับ field ของ prototype อยู่ดี ใน JavaScript ทั้ง spread syntax `{ ...quarterly }` และ `Object.assign({}, quarterly)` เป็น shallow ทั้งคู่ ตัว `q4.sections.push('Forecast')` เลยเพิ่ม section ให้ prototype ด้วย และให้ทุกสำเนาที่คัดลอกจากมันหลังจากนั้น ส่วน deep copy คัดลอก state ที่ซ้อนอยู่และแก้ไขได้ไปด้วย ทำให้ prototype กับสำเนาของมันเปลี่ยนแยกกันได้ การแชร์กันไม่มีปัญหาสำหรับค่าที่ไม่มีวันเปลี่ยน (string, number, object ที่ freeze แล้ว) แต่อะไรที่อาจถูกแก้ต้องคัดลอก

**cycle และ reference ที่แชร์กัน** deep copy จะยากขึ้นเมื่อ object อ้างถึงกันไปมา เช่น section ที่ชี้กลับไปหารายงานของมัน การคัดลอกแบบ recursive ซื่อ ๆ จะวนตาม cycle ไปจน stack overflow และถ้ามีสอง field ชี้ไปที่ object ตัวเดียวกัน มันก็จะสร้างสำเนาแยกเป็นสองตัว `structuredClone()` กับ `copy.deepcopy()` ของ Python เลี่ยงปัญหานี้ด้วยการจำว่าคัดลอก object ไหนไปแล้วในรอบนี้ แล้วใช้สำเนาพวกนั้นซ้ำ ทำให้ cycle กับ reference ที่แชร์กันยังคงรูปเดิม

## โค้ด

TypeScript ที่ตรงกับแผนภาพ Node 22.18 ขึ้นไปรันได้เลย (`node report.ts`) ด้วยการตัด type ทิ้ง และมันผ่าน `tsc --noEmit --strict` ด้วย ตัว `clone()` สร้างสำเนาผ่าน constructor เลยยังเป็น `Report` ที่มี method ครบ มันใช้ `structuredClone()` คัดลอก array `sections` ที่แก้ไขได้ และแชร์ theme ที่ freeze ไว้ เพราะ theme ไม่มีวันเปลี่ยน

```ts
import assert from 'node:assert/strict';

type Theme = Readonly<{ font: string; accent: string }>;

interface Prototype<T> { clone(): T } // Prototype: anything that copies itself

// ConcretePrototype: a configured Report copies itself.
class Report implements Prototype<Report> {
  title: string;
  readonly theme: Theme;  // frozen, so copies can share it
  sections: string[];     // mutable, so each copy needs its own
  constructor(title: string, theme: Theme, sections: string[]) {
    this.title = title;
    this.theme = Object.freeze(theme);
    this.sections = sections;
  }
  clone(): Report {
    // A new Report keeps the class; structuredClone deep-copies the plain data.
    return new Report(this.title, this.theme, structuredClone(this.sections));
  }
}

// Prototype manager: named prototypes, configured once at start-up.
class PrototypeRegistry {
  private readonly prototypes = new Map<string, Prototype<Report>>();
  set(name: string, p: Prototype<Report>): void { this.prototypes.set(name, p); }
  get(name: string): Prototype<Report> {
    const p = this.prototypes.get(name);
    if (!p) throw new Error(`No prototype named '${name}'`);
    return p;
  }
}

// Client: copies a prototype and changes only what differs.
class ReportService {
  private readonly registry: PrototypeRegistry;
  constructor(registry: PrototypeRegistry) { this.registry = registry; }
  q4Report(): Report {
    const q4 = this.registry.get('quarterly').clone();
    q4.title = 'Q4 report';
    return q4;
  }
}

const theme = { font: 'Inter', accent: 'teal' };
const quarterly = new Report('Q3 report', theme, ['Summary', 'Revenue', 'Costs']);
const registry = new PrototypeRegistry();
registry.set('quarterly', quarterly);
registry.set('monthly', new Report('Monthly report', theme, ['Summary', 'KPIs']));

const q4 = new ReportService(registry).q4Report();
q4.sections.push('Forecast');
assert.deepEqual([quarterly.sections.length, q4.sections.length], [3, 4]);
assert.ok(q4 instanceof Report && q4.theme === quarterly.theme); // frozen theme: shared
console.log(q4.title, q4.sections); // Q4 report [ 'Summary', 'Revenue', 'Costs', 'Forecast' ]

// structuredClone copies deeply too, but returns a plain object, not a Report.
const sc = structuredClone(quarterly); // typed as Report, but it is a plain object
assert.equal(sc instanceof Report, false);
assert.notEqual(sc.sections, quarterly.sections); // the array was copied, though
console.log(typeof sc.clone); // undefined

// The bug that clone() avoids: a shallow copy shares the prototype's array.
const shallow = { ...quarterly };
shallow.sections.push('Forecast');
assert.equal(quarterly.sections.length, 4); // the prototype changed as well
console.log(quarterly.sections); // [ 'Summary', 'Revenue', 'Costs', 'Forecast' ]
```

ผลลัพธ์:

```
Q4 report [ 'Summary', 'Revenue', 'Costs', 'Forecast' ]
undefined
[ 'Summary', 'Revenue', 'Costs', 'Forecast' ]
```

comment ตรง `structuredClone` ควรดูอีกรอบ TypeScript ประกาศมันไว้ว่า `structuredClone<T>(value: T): T` ทำให้ compiler เชื่อว่า `sc` ยังเป็น `Report` อยู่ และยอมให้เรียก `sc.clone()` แต่พอถึง runtime มันก็พังด้วย `TypeError: sc.clone is not a function`

## ใช้ตอนไหนดี

- **การตั้งค่ายาวหรือแพง** การตั้งค่า object ต้องเรียกหลายครั้ง อ่านไฟล์ หรือ query service และ object หลายตัวก็ใช้การตั้งค่าส่วนใหญ่ร่วมกัน ตั้งค่าครั้งเดียวแล้วค่อยคัดลอก
- **ความหลากหลายอยู่ที่ config ไม่ได้อยู่ที่ class** รายงานรายไตรมาสกับรายเดือนเป็น class เดียวกันที่ตั้งค่าต่างกัน การลงทะเบียน instance ที่ตั้งค่าแล้วหนึ่งตัวต่อแบบ เบากว่าการมี subclass หรือ factory หนึ่งตัวต่อแบบ และยังเพิ่มแบบใหม่ตอน runtime ได้ด้วย
- **รู้ class ก็ต่อเมื่อถึง runtime** โค้ดที่ทำงานกับ object อะไรก็ได้ที่ถูกส่งมาให้ (plug-in, รูปทรงใน palette ของ editor, เอกสารที่โหลดมาจาก storage) สร้างเพิ่มได้ด้วยการ clone โดยไม่ต้องเอ่ยชื่อ class ของมัน ตัวอย่างในหนังสือเองคือ editor โน้ตเพลงที่สร้างบน graphics framework ทั่วไป โดยที่เครื่องมือใน palette สร้างตัวโน้ตกับบรรทัดห้าเส้นด้วยการ clone prototype ที่ถูกตั้งไว้ให้มัน framework เลยไม่ต้องมี tool subclass หนึ่งตัวต่อโน้ตแต่ละชนิด
- **ต้องการสำเนาไว้ทำงาน** สำเนาที่เก็บไว้ก่อนการเปลี่ยนแปลงที่เสี่ยง เพื่อ undo หรือเพื่อคำนวณแบบ what-if ก็คือ operation เดียวกัน Memento ทำ snapshot ให้เป็นระบบ และ refactoring.guru ก็บอกว่า clone ธรรมดาใช้แทนได้ถ้า object ไม่ซับซ้อน
- **เลือกอย่างอื่นดีกว่า** ถ้า object สร้างง่ายและถูก (constructor หรือ factory function สื่อความได้ดีกว่า) หรือถ้า object graph คัดลอกให้ถูกได้ยาก: connection ที่เปิดอยู่, file handle หรือ identity ที่ต้องไม่ซ้ำกัน

## ได้อะไร เสียอะไร

- **ทุก class ต้องมี `clone()` ที่ถูกต้อง** ConcretePrototype แต่ละตัวต้องคัดลอกตัวเองได้ รวมถึง subclass ที่เพิ่ม field เข้ามา หนังสือบอกว่าเรื่องนี้เพิ่มเข้าไปใน class ที่มีอยู่แล้วได้ยาก และยากด้วยถ้า object ถือส่วนที่คัดลอกไม่ได้ หรือส่วนที่อ้างถึงกันเป็น cycle
- **shallow copy รั่ว** clone ที่ลืม field ที่ซ้อนอยู่สักตัว จะแชร์ field นั้นกับ prototype แล้ว bug ก็จะโผล่ไกลจากจุดที่คัดลอก อาจเป็นการเปลี่ยน prototype ที่ลงทะเบียนไว้ แล้วสำเนาทุกตัวหลังจากนั้นก็จะได้ไปด้วย
- **deep copy มีต้นทุน** การคัดลอกโครงสร้างใหญ่ที่ซ้อนกันกินเวลาและ memory เลยควรแชร์ส่วนที่ immutable แทนที่จะคัดลอก
- **ค่าเหมือนเดิม แต่ identity ใหม่** id, timestamp ตอนสร้าง, resource ที่เปิดอยู่ และ subscription ต้องไม่ถูกคัดลอกไปทั้งอย่างนั้น `clone()` หรือขั้น initialise หลังจากนั้น (หนังสือพูดถึงการ initialise clone ไว้) ต้อง reset ค่าพวกนี้
- **สิ่งที่ได้กลับมา** แบบใหม่ ๆ กลายเป็นข้อมูลแทน class, client ไม่เคยเอ่ยชื่อ concrete class และการตั้งค่าอยู่ที่เดียว เลยเพี้ยนไม่ได้

## ข้อควรรู้ตอนลงมือทำ

- **`clone()` ใน TypeScript** เขียนเป็น method ที่เรียก constructor แบบที่ `Report` ทำ จะได้ class กับ method ของมันไว้ และได้รันการเช็กใน constructor ด้วย subclass ก็ override `clone()` ให้คัดลอก field ของตัวเองด้วย จะใช้ copy constructor หรือ static `Report.from(other)` ก็ทำงานเดียวกันได้ ส่วน `structuredClone()` เป็นเครื่องมือที่ใช่สำหรับข้อมูลธรรมดาข้างใน: มันคัดลอก array, map, set, date และ plain object ที่ซ้อนกันแบบ deep และรักษา cycle ไว้ได้ แต่มันไม่คัดลอก prototype chain หรือ private field ของ class, มัน throw `DataCloneError` ถ้าเจอ function และมันทิ้ง property attribute ไป object ที่ freeze ไว้เลยกลับมาแบบไม่ freeze (MDN, *The structured clone algorithm*) ถ้าเรียกบน instance ของ class มันจะคืน plain object: `structuredClone(quarterly) instanceof Report` เป็น `false`
- **แชร์ส่วนที่เปลี่ยนไม่ได้** ส่วนที่ immutable อย่าง theme ที่ freeze ไว้ ไม่ต้องคัดลอก: สำเนาทุกตัวชี้ไปที่ object ตัวเดียวกันได้ ทำให้สำเนาถูกลงและเล็กลง Flyweight ไปไกลกว่านั้น คือตั้งใจแชร์ส่วนที่เหมือนกันและ immutable ของ object จำนวนมาก แต่การแชร์ของที่แก้ไขได้ก็คือ bug ของ shallow copy นั่นเอง
- **registry หลายแบบ** registry ในตัวอย่างแจกตัว prototype ออกไป แล้ว client ก็เรียก `clone()` เอง registry ที่เข้มกว่าจะแจกแค่สำเนา (`create(name)`) client เลยแก้ prototype ที่ลงทะเบียนไว้โดยไม่ตั้งใจไม่ได้ registry ยังเป็นที่ที่เหมาะจะโหลด prototype มาจากไฟล์ config หรือ database ด้วย
- **Prototype กับ creational pattern ตัวอื่น** [Factory Method](../factory-method/) ให้ subclass เลือก class ที่จะสร้าง instance เลยต้องมี creator subclass หนึ่งตัวต่อ product ส่วน Prototype ไม่ต้องมี creator hierarchy แค่มี instance ที่ตั้งค่าแล้วหนึ่งตัวต่อ product แต่ทุก product ต้องคัดลอกได้ [Abstract Factory](../abstract-factory/) สร้างจาก prototype ได้: หนังสือเสนอ concrete factory ที่ถือ prototype ของ product แต่ละตัวไว้แล้ว clone มัน ทำให้ตระกูล product ใหม่เป็นแค่ config ใหม่ ไม่ใช่ class ใหม่ ส่วน [Builder](../builder/) ประกอบ object ที่ซับซ้อนทีละขั้น ขณะที่ Prototype เริ่มจาก object ที่เสร็จแล้ว สองตัวนี้ใช้ด้วยกันได้ดี เพราะ build prototype ครั้งเดียวแล้ว clone จากมันไปตลอดก็ได้
- **Composite กับ Decorator** โครงสร้าง object ที่สร้างด้วย [Composite](../composite/) (รายงานที่มี section และ chart ซ้อนกัน) หรือ [Decorator](../decorator/) สร้างใหม่ด้วยมือได้น่าเบื่อ หนังสือเลยบอกว่าดีไซน์แบบนี้มักได้ประโยชน์จาก Prototype การ clone composite ก็หมายถึงต้อง clone ลูก ๆ ของมันด้วย
- **ไม่ใช่ prototype chain ของ JavaScript** inheritance ของ JavaScript เป็นแบบ prototypal ก็จริง แต่ prototype ของมันเป็นคนละกลไก `Object.create(quarterly)` สร้าง object ว่าง ๆ ที่ property ไหนไม่มี จะไปหาจาก `quarterly` ตอน runtime (MDN, *Inheritance and the prototype chain*) ไม่มีอะไรถูกคัดลอกเลย ตัว `Object.create(quarterly).sections.push('Forecast')` เลยเปลี่ยน `quarterly` เอง นั่นคือ delegation ที่เป็นวิธีให้ object แชร์ state และ behaviour กัน ส่วนแพตเทิร์น Prototype สร้างสำเนาที่แยกเป็นอิสระ
- **Java** `Object.clone()` เป็น protected และคัดลอกแบบ field ต่อ field แบบ shallow แล้วมันก็ throw `CloneNotSupportedException` ถ้า class ไม่ได้ implement `Cloneable` ที่เป็น marker interface และไม่มี method `clone()` ของตัวเอง (เอกสาร Java SE API) *Effective Java* ของ Joshua Bloch (3rd edition, Item 13, "Override clone judiciously") อธิบายว่าทำไมกลไกนี้เปราะ: class ที่มี field แก้ไขได้ต้องซ่อม shallow copy เอง แบบที่ตัวอย่าง `Stack` ในหนังสือทำด้วยการคัดลอก array ภายในของมัน และวิธีนี้ก็ไปกันไม่ได้กับ final field ที่ชี้ไปที่ object ที่แก้ไขได้ Bloch แนะนำให้ใช้ copy constructor หรือ static copy factory แทน และ `clone()` ใน TypeScript ข้างบนก็ใช้ไอเดียเดียวกัน คือสร้างสำเนาผ่าน constructor
- **Python** module `copy` มี `copy.copy()` (shallow) กับ `copy.deepcopy()` (deep โดยมี memo dictionary ที่รับมือกับโครงสร้างแบบ recursive) และ class ก็ปรับแต่งทั้งสองตัวได้ด้วย `__copy__()` กับ `__deepcopy__()` ส่วนตั้งแต่ Python 3.13 ก็มี `copy.replace()` ที่สร้างสำเนาแบบแก้บางค่า ของ named tuple, dataclass และ class อื่นที่นิยาม `__replace__()`
- **ในระดับสถาปัตยกรรม** การปั๊มสำเนาออกมาจาก template ที่ตั้งค่าไว้เป็นไอเดียที่เจอบ่อยใน infrastructure ถึงจะไม่มี `clone()` ของ object ไหนเกี่ยวเลยก็ตาม Kubernetes Deployment, Job หรือ DaemonSet ถือ pod template ไว้ แล้ว controller ของมันก็สร้าง pod ทุกตัวจาก template นั้น การแก้ template ไม่ได้เปลี่ยน pod ที่รันอยู่ controller เลยแทนที่มันด้วย pod ที่สร้างจาก template ใหม่ [Deployment stamps](../deployment-stamps/) deploy สำเนาของ stack ทั้งชุดจาก template เดียว และ [immutable infrastructure](../immutable-infrastructure/) ก็เปิด server ทุกตัวจาก machine image ที่อบไว้แล้ว บทเรียนเดียวกันใช้ได้ที่นี่: ตัดสินว่าสำเนาแต่ละตัวต้องเป็นเจ้าของอะไร (ข้อมูลของมัน, identity ของมัน) และแชร์อะไรได้ (template, image)
