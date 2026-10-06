## ปัญหา

invoice หนึ่งใบมี line อยู่สามชนิด: `ProductLine` (แก้วมัค 2 ใบ ใบละ EUR 12.00), `ServiceLine` (ค่าติดตั้งชั่วโมงครึ่ง ชั่วโมงละ EUR 40.00) และ `ShippingLine` (3 kg กิโลละ EUR 1.50) line class พวกนี้เล็กและไม่ค่อยเปลี่ยน ที่เปลี่ยนอยู่เรื่อย ๆ คือรายการสิ่งที่ฝั่งธุรกิจอยากทำกับ invoice: เริ่มจากยอดรวม แล้วก็ export CSV ให้ฝ่ายบัญชี แล้วก็ภาษี และต่อไปอาจเป็น PDF หรือการเช็ก fraud

ดีไซน์แบบตรง ๆ คือเพิ่ม method ให้ line ทุกชนิด หนึ่งตัวต่อหนึ่ง operation ถ้ามีสาม operation บนสาม class ก็คือแก้เก้าที่ และ line class แต่ละตัวก็ลงเอยด้วยการถือกฎคิดราคา การจัดรูปแบบ CSV และกฎหมายภาษีไว้ข้าง ๆ กัน: โค้ดที่เปลี่ยนด้วยเหตุผลต่างกัน ในเวลาต่างกัน และบ่อยครั้งก็มีเจ้าของเป็นคนละคน ถ้า line class มาจาก library หรือทีมอื่น ก็อาจแก้ไม่ได้เลยด้วยซ้ำ

ดีไซน์ตรง ๆ อีกแบบคือปล่อย class ไว้เหมือนเดิม แล้วเขียนแต่ละ operation เป็น function ตัวเดียวที่ถามว่ากำลังถืออะไรอยู่: `if (line instanceof ProductLine) … else if (line instanceof ServiceLine) …` ตัว class ยังสะอาดอยู่ แต่ทุก function ก็เช็ก type เป็นทอด ๆ ซ้ำกันแบบเดิม และไม่มีอะไรรับประกันว่าแต่ละ function จัดการครบทุกชนิด ถ้า function ไหนขาดไปชนิดหนึ่งก็จะหลุดผ่านไปเงียบ ๆ: ใน JavaScript มันจะคืน `undefined` แล้วยอดรวมของ invoice ก็กลายเป็น `NaN`

## ทำงานยังไง

Visitor ดึงแต่ละ operation ออกจาก class ที่มันทำงานด้วย แล้วทำให้เป็น object ของตัวเอง: visitor class ที่มีหนึ่ง method ต่อ element หนึ่งชนิด ส่วน element class ได้ method เดียวคือ `accept(visitor)` ที่ไม่ทำอะไรเลยนอกจากเรียก method ของ visitor ที่ตรงกับชนิดของตัวเอง แล้วส่งตัวเองไปด้วย จากนั้น operation ใหม่ก็คือ visitor class ใหม่หนึ่งตัว และ element class ก็ไม่ต้องเปลี่ยนเพื่อมัน ตัว pattern นี้เป็นหนึ่งใน behavioural pattern ใน *Design Patterns* ของ Gamma, Helm, Johnson และ Vlissides (1994) และตัวอย่างที่เป็นจุดเริ่มต้นในเล่มคือ compiler: ถ้าไม่มี visitor ทุก class ใน syntax tree ของมันจะต้องแบกทั้ง type checking, code generation, pretty-printing และ analysis อะไรก็ตามที่จะตามมา

| ส่วนประกอบ | ใน diagram | หน้าที่ |
|---|---|---|
| **Visitor** | `InvoiceVisitor` | ประกาศ visit method หนึ่งตัวต่อ element หนึ่งชนิด: `visitProduct`, `visitService` และ `visitShipping` |
| **ConcreteVisitor** | `TotalVisitor`, `CsvVisitor`, `TaxVisitor` | operation หนึ่งตัว มีกฎสำหรับ element ทุกชนิด และ state อะไรก็ตามที่มันสะสมระหว่างทาง |
| **Element** | `Line` | ประกาศ `accept(v)` ที่เป็นสิ่งเดียวที่ element ต้องมีให้ operation ทุกตัว |
| **ConcreteElement** | `ProductLine`, `ServiceLine`, `ShippingLine` | implement `accept(v)` ด้วยการเรียก visit method ของชนิดตัวเอง โดยส่งตัวเองเป็น argument |
| **ObjectStructure** | `Invoice` | ถือ element ต่าง ๆ และให้ visitor เข้าถึงแต่ละตัวได้ ในที่นี้ `accept(v)` วนไปตาม line |

**Double dispatch แบบเข้าใจง่าย** ในภาษา object-oriented ส่วนใหญ่ การเรียกจะเลือกโค้ดตอน runtime ตาม object ตัวเดียว คือตัวรับ: `line.total()` รัน `total()` ของ `ProductLine` เพราะ line นั้นเป็น `ProductLine` แต่ Visitor ต้องให้โค้ดขึ้นกับสองอย่างพร้อมกัน คือชนิดของ line และ operation และมันทำได้ด้วยการเรียกธรรมดาสองครั้งต่อกัน ครั้งแรก `line.accept(v)` ถูก dispatch ตาม line ทำให้ `ProductLine.accept` รัน ตัว body ของมันเอ่ยชื่อ method ของชนิดตัวเอง คือ `v.visitProduct(this)` แล้วการเรียกครั้งที่สองนี้ก็ถูก dispatch ตาม visitor ทำให้ `TotalVisitor.visitProduct` รัน หรือถ้าการไล่ได้ `CsvVisitor` มา ก็จะเป็น `CsvVisitor.visitProduct` แทน นี่คือสอง hop ใน step 3 ส่วนใน Java และ C# ตัว visit method มักใช้ชื่อเดียวกันคือ `visit` แล้วให้ overloading เป็นคนเลือก: ข้างใน `ProductLine.accept` ตัว `this` มี static type เป็น `ProductLine` ทำให้ compiler ผูก `v.visit(this)` เข้ากับ overload ของ `ProductLine` ส่วน TypeScript resolve overload แค่ตอน compile และมี implementation อยู่ตัวเดียวข้างหลัง overload พวกนั้น ทำให้ visit method ต้องมีชื่อต่างกัน ภาษาที่มี multiple dispatch อย่าง [Julia](https://docs.julialang.org/en/v1/manual/methods/) เลือก method ตาม type ตอน runtime ของทุก argument และไม่ต้องมีการส่งต่อกันไปมาแบบนี้เลย

**การไล่ไปตาม element อยู่ที่ไหน** ต้องมีอะไรสักอย่างเดินไปตาม element แล้วส่ง visitor ให้ทีละตัว และหนังสือก็ชั่งไว้สามที่:

- **ใน object structure** `Invoice.accept(v)` วนไปตาม line ของมัน และใน [Composite](../composite/) ตัว `accept` ของ node จะ visit ตัว node แล้วค่อย visit ลูก ๆ ของมัน แบบนี้คือทางที่เลือกกันทั่วไป: เขียนการไล่ไว้ครั้งเดียว และ visitor ทุกตัวได้ลำดับเดียวกัน
- **ใน visitor** ตัว visitor ตัดสินเองว่าจะ visit อะไรต่อ ต้องใช้แบบนี้ตอนที่การไล่ขึ้นกับสิ่งที่มันเจอ อย่างการข้าม subtree ตัว [`ast.NodeVisitor`](https://docs.python.org/3/library/ast.html#ast.NodeVisitor) ของ Python ก็ทำงานแบบนี้: ถ้า node มี method `visit_` ของตัวเอง ลูก ๆ ของมันจะถูก visit ก็ต่อเมื่อ method นั้นเรียก `generic_visit()` ราคาที่ต้องจ่ายคือโค้ดสำหรับไล่ต้องเขียนซ้ำในทุก visitor ที่ต้องใช้
- **ใน iterator** มี [Iterator](../iterator/) แยกอีกตัวเดินไปตาม structure แล้ว client ก็เรียก `accept` บนแต่ละ element ที่มัน yield ออกมา อย่าง `for (const line of invoice) line.accept(v)` ถ้า `Invoice` iterate ได้ ตรงนี้ iterator เป็นคนเลือกลำดับ ส่วน visitor เลือกว่าจะทำอะไรกับแต่ละ element

`Files.walkFileTree` ของ Java เพิ่มอีกแบบหนึ่ง: ตัว walker เป็นเจ้าของการไล่ ส่วน visitor บังคับทิศทางผ่านค่าที่แต่ละ method คืน (`CONTINUE`, `SKIP_SUBTREE`, `SKIP_SIBLINGS` หรือ `TERMINATE`)

**State ใน visitor** ตัว visitor เป็น object ธรรมดา มันเลยสร้างผลลัพธ์ไประหว่างทางได้: `TotalVisitor.sum` โตจาก 24.00 เป็น 84.00 แล้วเป็น 88.50 และ `CsvVisitor.rows` ก็เก็บหนึ่ง row ต่อหนึ่ง line โดยที่ element หรือการไล่ไม่ต้องส่งยอดสะสมต่อกันไป แต่อีกด้านคือ visitor แบบนี้ใช้ได้กับการไล่รอบเดียว: ถ้าเอากลับมาใช้ซ้ำ ยอดเก่าก็จะติดมาด้วย และการไล่สองรอบที่ใช้ visitor ตัวเดียวกันก็จะได้ผลปนกัน ทางเลือกอื่นคือ visitor ที่ method คืนค่า โดยใช้ `accept<R>(v: Visitor<R>): R` ส่วน [`ElementVisitor<R, P>`](https://docs.oracle.com/en/java/javase/27/docs/api/java.compiler/javax/lang/model/element/ElementVisitor.html) ของ Java ที่ annotation processor ใช้ตรวจ class, method และ field ก็สร้างแบบนั้น: type parameter ตัวหนึ่งสำหรับผลลัพธ์ และอีกตัวสำหรับ argument เพิ่มเติมที่ส่งให้ทุก visit

## โค้ด

TypeScript ที่ตรงกับ diagram ตัวโค้ดรันด้วย Node 22.18 ขึ้นไปได้เลย (`node invoice.ts`): Node ตัด type ทิ้งโดยไม่เช็ก ส่วน `tsc --strict` ผ่าน และตัวนี้แหละที่จะรายงาน visitor ที่ขาด visit method ส่วนเงินเก็บเป็นจำนวนเต็มหน่วย cent (1200 คือ EUR 12.00) และแปลงเป็นยูโรแค่ตอนแสดงผล เลยไม่ต้องปัดเศษอะไร ส่วน diagram แสดงจำนวนเงินเดียวกันเป็นยูโร

```ts
import assert from 'node:assert/strict';

// Visitor: one method per kind of line. Money is integer cents (1200 = EUR 12.00).
interface InvoiceVisitor {
  visitProduct(line: ProductLine): void;
  visitService(line: ServiceLine): void;
  visitShipping(line: ShippingLine): void;
}
// Element: all a line has to offer an operation is accept().
interface Line { accept(v: InvoiceVisitor): void }

// ConcreteElements: their own data, and an accept() that names their own kind.
class ProductLine implements Line {
  readonly data: { name: string; qty: number; price: number };
  constructor(data: ProductLine['data']) { this.data = data; }
  accept(v: InvoiceVisitor) { v.visitProduct(this); }
}
class ServiceLine implements Line {
  readonly data: { name: string; hours: number; rate: number };
  constructor(data: ServiceLine['data']) { this.data = data; }
  accept(v: InvoiceVisitor) { v.visitService(this); }
}
class ShippingLine implements Line {
  readonly data: { kg: number; perKg: number };
  constructor(data: ShippingLine['data']) { this.data = data; }
  accept(v: InvoiceVisitor) { v.visitShipping(this); }
}
// ObjectStructure: the invoice walks its lines and hands each one the visitor.
class Invoice {
  readonly lines: Line[];
  constructor(...lines: Line[]) { this.lines = lines; }
  accept(v: InvoiceVisitor) { for (const line of this.lines) line.accept(v); }
}

// ConcreteVisitors: one class per operation, with its rule for every kind of line.
class TotalVisitor implements InvoiceVisitor {
  sum = 0; // state that builds up during the walk
  visitProduct(l: ProductLine) { this.sum += l.data.qty * l.data.price; }
  visitService(l: ServiceLine) { this.sum += l.data.hours * l.data.rate; }
  visitShipping(l: ShippingLine) { this.sum += l.data.kg * l.data.perKg; }
}
// One line's amount: run a TotalVisitor on that line alone, so prices live in one place.
const amount = (line: Line) => { const t = new TotalVisitor(); line.accept(t); return t.sum; };
const eur = (cents: number) => (cents / 100).toFixed(2);

class CsvVisitor implements InvoiceVisitor {
  rows: string[] = [];
  visitProduct(l: ProductLine) { this.rows.push(`product,${l.data.name},${eur(amount(l))}`); }
  visitService(l: ServiceLine) { this.rows.push(`service,${l.data.name},${eur(amount(l))}`); }
  visitShipping(l: ShippingLine) { this.rows.push(`shipping,${l.data.kg} kg,${eur(amount(l))}`); }
}
// Added later: one new class, and no line class changes.
class TaxVisitor implements InvoiceVisitor {
  sum = 0;
  visitProduct(l: ProductLine) { this.sum += amount(l) * 20 / 100; } // an illustrative 20 %
  visitService(l: ServiceLine) { this.sum += amount(l) * 20 / 100; }
  visitShipping(_l: ShippingLine) {} // no tax on shipping in this example
}

const invoice = new Invoice(
  new ProductLine({ name: 'Mug', qty: 2, price: 1200 }),
  new ServiceLine({ name: 'Setup', hours: 1.5, rate: 4000 }),
  new ShippingLine({ kg: 3, perKg: 150 }),
);
const total = new TotalVisitor(), csv = new CsvVisitor(), tax = new TaxVisitor();
for (const v of [total, csv, tax]) invoice.accept(v);

assert.equal(eur(total.sum), '88.50');
assert.deepEqual(csv.rows, ['product,Mug,24.00', 'service,Setup,60.00', 'shipping,3 kg,4.50']);
assert.equal(eur(tax.sum), '16.80');
console.log(`total ${eur(total.sum)}, tax ${eur(tax.sum)}`);
console.log(csv.rows.join('\n'));
```

ผลลัพธ์:

```
total 88.50, tax 16.80
product,Mug,24.00
service,Setup,60.00
shipping,3 kg,4.50
```

`amount()` รัน `TotalVisitor` บน line เดียว ราคาของ line แต่ละชนิดเลยถูกเขียนไว้ครั้งเดียว แล้ว `CsvVisitor` กับ `TaxVisitor` ก็ใช้ซ้ำ การเพิ่ม `TaxVisitor` ไม่ได้แตะ line class เลยสักตัว แต่ถ้าเพิ่ม `visitDiscount()` ใน `InvoiceVisitor` แทน ตัว `tsc` ก็จะไม่ยอมรับ `TotalVisitor`, `CsvVisitor` และ `TaxVisitor` จนกว่าทุกตัวจะ implement มัน: นี่คือผลกระทบเป็นทอด ๆ ใน step 4 ที่ compiler รายงานให้

## ใช้ตอนไหนดี

- element มีไม่กี่ชนิดและนิ่ง แต่ operation บนมันเพิ่มมาเรื่อย ๆ: syntax tree ใน compiler, linter, formatter และ code transformer (ภาษาเปลี่ยนช้า แต่ rule ใหม่มาตลอด), document model ที่ export ได้หลาย format, file tree และ business record ที่ชนิดตายตัวแต่ report, export และการเช็กเพิ่มขึ้นเรื่อย ๆ
- operation ที่แทบไม่เกี่ยวกับงานของ element เอง หรือไม่เกี่ยวกันเอง หนึ่ง class ต่อหนึ่ง operation ทำให้ element class เล็ก และรวมกฎภาษีทั้งหมดไว้ที่เดียว
- element class ที่เราแก้ไม่ได้ ตราบใดที่มันมี `accept` หรือ hook คล้าย ๆ กันให้ใช้ และ API ของ compiler กับ linter ก็มีให้ (ดู *ข้อควรรู้ตอนลงมือทำ*)
- ไม่ใช่ตอนที่ element ชนิดใหม่มาบ่อย: แต่ละชนิดจะเปลี่ยน visitor interface และ visitor ทุกตัว (ดู *ได้อะไร เสียอะไร*)
- ไม่ใช่สำหรับ operation แค่หนึ่งหรือสองตัว แบบนั้น method ในแต่ละ class หรือ interface ร่วมของ [Composite](../composite/) สำหรับ tree จะง่ายกว่า
- ไม่ใช่ตอนที่เราเป็นเจ้าของ element type เอง ชุดของมันปิดตายแล้ว และภาษามี pattern matching แบบครอบคลุมทุกกรณี: `switch` บน union ของ TypeScript หรือ sealed interface ของ Java ทำงานเดียวกันได้โดยไม่ต้องมี `accept` (ดู *ข้อควรรู้ตอนลงมือทำ*)

## ได้อะไร เสียอะไร

- **เพิ่ม operation ใหม่ไม่แพง แต่เพิ่มชนิดใหม่แพง** `TaxVisitor` เป็น class เดียวและไม่ต้องแก้อะไรเลย แต่ `DiscountLine` จะเปลี่ยน `InvoiceVisitor` และ visitor ทุกตัวที่ implement มัน นี่คือด้านหนึ่งของสิ่งที่ Philip Wadler ตั้งชื่อไว้ว่า [the expression problem](https://homepages.inf.ed.ac.uk/wadler/papers/expression/expression.txt) ในปี 1998: การเพิ่มทั้ง case ใหม่และ operation ใหม่ให้ data type โดยไม่ต้อง compile โค้ดที่มีอยู่แล้วใหม่ และไม่ต้องยอมทิ้ง static type safety ส่วน class ธรรมดาทำให้ชนิดใหม่ราคาถูก แต่ operation ใหม่ราคาแพง แล้ว Visitor ก็สลับสองอย่างนี้กัน [Abstract Factory](../abstract-factory/) ก็แลกแบบเดียวกัน: ตระกูลใหม่คือ factory เพิ่มอีกหนึ่งตัว เหมือน visitor ใหม่ ส่วน product ชนิดใหม่จะเปลี่ยนทุก factory เหมือน line ชนิดใหม่
- **โค้ดถูกจัดกลุ่มตาม operation ไม่ใช่ตาม class** ทุกอย่างเรื่องภาษีอยู่ใน `TaxVisitor` นี่คือจุดประสงค์ ส่วนทุกอย่างเรื่อง `ProductLine` ตอนนี้กระจายอยู่ในทุก visitor นี่คือราคาที่ต้องจ่าย ให้เลือกการจัดกลุ่มที่ตรงกับวิธีที่โค้ดเปลี่ยน
- **encapsulation ต้องหลีกทาง** visitor จะทำงานได้ก็ต่อเมื่ออ่านข้อมูลของ element ได้ ตัว element เลยต้องเปิด field หรือ getter ที่ method ข้างใน class ไม่ต้องใช้: ในโค้ดข้างบน `data` เป็น public เพื่อให้ `TotalVisitor` คิดราคา line ได้ หนังสือก็ระบุเรื่องนี้ไว้ในผลที่ตามมาของ pattern
- **state อยู่ใน visitor** สะดวกสำหรับยอดรวมและ list แต่ visitor ที่มี state ใช้ได้กับการไล่ทีละรอบ (ดู *ทำงานยังไง*)
- **ต้องอ้อม** element ทุกตัวมี `accept` ที่แค่เรียกกลับ ส่วน visitor ทุกตัวก็มี method สำหรับทุกชนิดแม้หลายตัวจะทำเหมือนกัน และ stack trace ก็สลับไปมาระหว่างสอง hierarchy คนที่เพิ่งเจอ pattern นี้จะตาม control flow ได้ยาก

## ข้อควรรู้ตอนลงมือทำ

- **หนึ่งชื่อต่อหนึ่งชนิด หรือชื่อเดียวแบบ overload** `visitProduct`, `visitService` และ `visitShipping` ใช้ได้ทุกภาษา ส่วน Java และ C# ก็ใช้ `visit(ProductLine)`, `visit(ServiceLine)` ไปเรื่อย ๆ ได้ โดย overload ถูกเลือกตอน compile ข้างในแต่ละ `accept` แต่ไม่ว่าจะแบบไหน `accept` ก็ต้องเขียนในทุก concrete element class แทนที่จะสืบทอดมาจาก base class เพราะใน base class ตัว `this` มี type เป็น base type และการเรียกก็เอ่ยชื่อ method ที่ถูกต้องไม่ได้
- **default method และ visitor ที่มีเวอร์ชัน** base visitor ที่ method ไม่ทำอะไรเลย ทำให้ visitor แต่ละตัว override แค่ชนิดที่มันสนใจ และทำให้ element ชนิดใหม่มาได้โดยไม่ทำ visitor ทุกตัวพัง แลกกับการที่ visitor ที่ใช้ default จะเมินชนิดใหม่ไปโดยไม่พูดอะไรสักคำ `javax.lang.model` ของ Java แสดงให้เห็นทั้งสองด้านในระดับ platform ตอนที่ module (Java 9) และ record component (Java 16) เข้ามาในภาษา ตัว `ElementVisitor` ก็ได้ `visitModule` และ `visitRecordComponent` เพิ่มมาเป็น default method ที่ fallback ไปที่ `visitUnknown` และเอกสารของมันก็เตือนว่าอาจมี method เพิ่มอีก และแนะนำให้ extend base class ตัวใดตัวหนึ่งที่มีเวอร์ชัน ตั้งแต่ `AbstractElementVisitor6` ถึง `AbstractElementVisitor14` แทนการ implement interface ตรง ๆ
- **ตอนที่ชุดของชนิดเปลี่ยนจริง ๆ** ตั้งแต่ Python 3.8 ตัว parser แทนค่าคงที่ทุกตัว (ตัวเลข, string, bytes, `True`, `False`, `None` และ `...`) ด้วย node `ast.Constant` ตัวเดียว แทนที่จะเป็น node แยกกันอย่าง `Num`, `Str`, `Bytes`, `NameConstant` และ `Ellipsis` ทำให้ visitor ที่จัดการพวกนี้ใน `visit_Num`, `visit_Str` และตัวอื่น ๆ ต้องเพิ่ม `visit_Constant` และพอถึง Python 3.14 ตัว method เก่าก็ไม่ถูกเรียกอีกแล้ว นี่คือต้นทุนของชนิดที่เปลี่ยน ที่ visitor ทุกตัวในทุก codebase ที่มี visitor ต้องจ่าย
- **visitor บน composite และ syntax tree** Visitor กับ [Composite](../composite/) มักใช้ด้วยกัน: composite คือ structure ส่วน visitor ถือ operation และ `accept` ของ composite node ก็ visit ตัว node เองแล้วค่อย visit ลูก ๆ ของมัน จังหวะที่ visit เทียบกับลูก ๆ มีผล: ก่อนลูกสำหรับ printer ที่เขียนหัวข้อก่อนเนื้อหา และหลังลูกสำหรับ evaluator ที่ต้องได้ operand ก่อน ESLint ให้ rule ทำได้ทั้งสองแบบ: handler ที่ใช้ node type เป็น key จะรันขาลง tree และ handler ที่ใช้ node type ต่อด้วย `:exit` เป็น key จะรันขากลับขึ้นมา
- **visitor ที่ใช้ชื่อ type เป็น key** ไม่ใช่ทุก visitor ที่ใช้ `accept` ส่วนใน [ESLint rule](https://eslint.org/docs/latest/extend/custom-rules) ตัว `create()` คืน object ที่ key เป็นชนิดของ node ใน syntax tree (หรือ selector) แล้ว ESLint ก็เรียก function ที่ตรงกันกับแต่ละ node ระหว่างที่มันไล่ tree ส่วน [Babel plugin](https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/plugin-handbook.md#visitors) ก็ตั้งชื่อ visitor method ตามชนิดของ node แบบเดียวกัน และ `NodeVisitor` ของ Python ก็มองหา `visit_` ตามด้วยชื่อ class ของ node ทั้งหมดนี้ทำได้เพราะ node พกชนิดของตัวเองมาเป็นข้อมูล (ESTree node ทุกตัวมี string `type`) การหาตามชื่อเลยมาแทน dispatch ครั้งที่สอง แนวคิดยังเหมือนเดิม คือหนึ่ง object ต่อหนึ่ง operation ที่มี handler ต่อชนิด และ visitor แบบนี้ก็ระบุแค่ชนิดที่มันสนใจ เหมือน base class ที่มี method ว่าง ๆ
- **FileVisitor ของ Java** [`java.nio.file.FileVisitor`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/nio/file/FileVisitor.html) มี method สำหรับแต่ละ event ของการไล่ file tree: `preVisitDirectory`, `visitFile`, `visitFileFailed` และ `postVisitDirectory` ส่วน `Files.walkFileTree` ไล่ tree แบบ depth-first และตัดสินว่าจะเรียก method ไหนจากสิ่งที่มันเจอ ตัว path ไม่มี `accept` นี่เลยเป็น visitor ในความหมายของหนึ่ง object ต่อหนึ่ง operation บน structure ที่คนอื่นเป็นคนไล่ โดยไม่มี double dispatch ส่วน `SimpleFileVisitor` มี default มาให้ ทำให้ visitor แต่ละตัว override แค่สิ่งที่ต้องใช้
- **pattern matching แทน `accept`** ถ้าเราเป็นเจ้าของ element type และชุดของมันปิดตายแล้ว ภาษาปัจจุบันเขียนการแยกแบบเดียวกันนี้ได้ตรง ๆ ใน TypeScript ตัว line กลายเป็น discriminated union และแต่ละ operation ก็เป็น function ที่มี `switch` บน field `kind` แล้ว branch `default` ที่กำหนดค่าให้ตัวแปร `never` ก็ทำให้ case ที่ขาดไปกลายเป็น compile error ([TypeScript handbook](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking)):

  ```ts
  import assert from 'node:assert/strict';

  // The same lines as a closed union: the kind is a field, and an operation is a function.
  type Line =
    | { kind: 'product'; name: string; qty: number; price: number }
    | { kind: 'service'; name: string; hours: number; rate: number }
    | { kind: 'shipping'; kg: number; perKg: number };

  function taxCents(line: Line): number {
    switch (line.kind) {
      case 'product': return line.qty * line.price * 20 / 100;
      case 'service': return line.hours * line.rate * 20 / 100;
      case 'shipping': return 0;
      default: {
        const unhandled: never = line; // a kind without a case is a compile error here
        throw new Error(`no tax rule for ${JSON.stringify(unhandled)}`);
      }
    }
  }

  const lines: Line[] = [
    { kind: 'product', name: 'Mug', qty: 2, price: 1200 },
    { kind: 'service', name: 'Setup', hours: 1.5, rate: 4000 },
    { kind: 'shipping', kg: 3, perKg: 150 },
  ];
  const tax = lines.reduce((sum, line) => sum + taxCents(line), 0);
  assert.equal((tax / 100).toFixed(2), '16.80');
  console.log(`tax ${(tax / 100).toFixed(2)}`); // tax 16.80
  ```

  Java ทำแบบเดียวกันได้ด้วย sealed interface ที่ระบุ class ที่ได้รับอนุญาต ([JEP 409](https://openjdk.org/jeps/409) final ใน Java 17) กับ `switch` ที่ใช้ type pattern บนมัน ([JEP 441](https://openjdk.org/jeps/441) final ใน Java 21) compiler จะยอมรับ `switch` แบบนี้โดยไม่มี `default` ก็ต่อเมื่อมันครอบคลุมทุก type ที่ได้รับอนุญาต และจะเพิ่ม branch ที่มองไม่เห็นไว้ให้ ตัวนั้นจะ throw เผื่อมี class ที่ compile แยกโผล่มาตอน runtime ส่วน trade-off ก็เหมือนของ Visitor: operation ใหม่คือ function ใหม่หนึ่งตัว และชนิดใหม่คือการแก้ในทุก `switch` ที่ compiler จะ list ให้ สิ่งที่หายไปคือ `accept`, visitor interface และ hop ที่สอง แต่ Visitor ก็ยังเหมาะกับภาษาที่ไม่มี pattern matching แบบครอบคลุมทุกกรณี และทุกที่ที่ element class เป็นของ library ที่มี `accept` และ visitor interface ให้ แบบที่ API ของ compiler และ linter มี
- **pattern ญาติ ๆ**
  - [Composite](../composite/) คือ structure ที่ใช้กันบ่อย และคำตอบของมันเองสำหรับ operation บน tree คือ method ในทุก node class: วิธีใน step 1 ที่เหมาะกับ tree ที่ชนิดของ node เพิ่มขึ้นเรื่อย ๆ ส่วน operation มีไม่กี่ตัว
  - [Iterator](../iterator/) ไล่ไปตาม structure โดยไม่สนว่าแต่ละ element เป็นอะไร ส่วน Visitor ตัดสินว่าจะทำอะไรกับแต่ละ element ตามชนิดของมัน ทั้งสองใช้ด้วยกันได้ตอนที่ให้ iterator เป็นคนไล่
  - [Interpreter](../interpreter/) ให้ทุก node class ใน syntax tree ของภาษาเล็ก ๆ มี method `interpret()` ส่วน operation อื่นบน tree เดียวกัน อย่าง pretty-printing หรือ type checking มักเขียนเป็น visitor แทน
  - [Strategy](../strategy/) ก็เปลี่ยนอัลกอริทึมให้เป็น object ที่ส่งเข้ามาจากข้างนอกเหมือนกัน แต่ strategy คืออัลกอริทึมเดียวหลัง method เดียว ที่เลือกต่อการเรียก ส่วน visitor คือชุดของ variant ของ operation เดียว แยกตามชนิด ที่ใช้กับทั้ง structure
  - [Abstract Factory](../abstract-factory/) แลกแบบเดียวกัน โดยมีตระกูลในจุดที่ Visitor มี operation (ดู *ได้อะไร เสียอะไร*)
- **ในระดับ architecture** projection ของ [Event Sourcing](../event-sourcing/) ทำตัวเหมือน visitor บน log: แต่ละ projection คือ operation หนึ่งตัวที่มี handler ต่อ event type และ read model ใหม่ก็คือ projection ใหม่ที่ replay log โดยไม่แตะ event หรือ projection ตัวอื่น ส่วน event type ใหม่ก็กลับเป็นทิศที่แพงอีก เพราะทุก projection ที่ต้องตอบสนองต่อมันต้องมี handler ใหม่ สิ่งที่เปลี่ยนไปในระดับนั้นคือ producer และ projection ถูก deploy แยกกัน และไม่มี compiler มา list ช่องที่ขาดให้ ตัว projection เลยต้องข้าม event type ที่ไม่รู้จัก (บทบาทเดียวกับที่ `visitUnknown` เล่นใน `javax.lang.model`) และ projection ที่ต้องใช้ event type ใหม่ก็มักถูกอัปเดตก่อนที่ producer จะเริ่มเขียน event นั้น
