## ปัญหา

แผนที่เมืองแสดงต้นไม้ริมถนน 100,000 ต้น มีอยู่แค่ห้าสายพันธุ์ (oak, maple, plane, birch และ pine) และแต่ละสายพันธุ์มีชื่อ สี และ icon ขนาด 2 KB ถ้าออกแบบตามที่คิดได้ทันที marker ทุกตัวจะเป็น object ที่ครบในตัว `new Tree(x, y, species, colourOf(species), loadIcon(species))` ทำให้ marker ทุกตัวถือสำเนา icon ของสายพันธุ์ตัวเองไว้หนึ่งชุด

คิด icon ที่ 2,048 bytes กับตำแหน่งและ reference อีก 24 bytes ตัว marker ทั้งหมดก็จะกิน 100,000 × 2,072 bytes ≈ 207.2 MB (ในที่นี้ 1 MB = 10⁶ bytes และยังไม่ได้นับ object header กับ string สั้น ๆ ของชื่อและสี ตัวเลขจริงเลยสูงกว่านี้) icon ที่ต่างกันจริง ๆ มีแค่ห้าแบบ ทำให้ memory ส่วนนั้น 98.8% เป็นแค่สำเนา โค้ดไม่ได้ผิดอะไร มันแค่เก็บรูปห้ารูปซ้ำไป 100,000 รอบ และบนมือถือหรือใน browser tab เรื่องนี้ตัดสินได้เลยว่าแผนที่จะเปิดขึ้นหรือไม่

## ทำงานยังไง

Flyweight แบ่ง state ของแต่ละ object ออกเป็นสองส่วน ส่วนที่ object จำนวนมากมีเหมือนกันจะย้ายไปอยู่ใน object ที่แชร์กันไม่กี่ตัวและไม่มีวันเปลี่ยน ส่วนที่เป็นของ object ตัวเดียวจะอยู่ข้างนอก แล้วส่งเข้าไปทุกครั้งที่ object ที่แชร์ต้องใช้ มี factory คอยดูให้มี object ที่แชร์อยู่ตัวเดียวพอดีต่อหนึ่งค่าที่ต่างกัน pattern นี้เป็นหนึ่งใน 23 ตัวของ *Design Patterns* ของ Gamma, Helm, Johnson และ Vlissides (1994) แต่ชื่อนี้เก่ากว่านั้น: paper ปี 1990 ของ Paul Calder กับ Mark Linton เรื่อง *Glyphs: Flyweight Objects for User Interfaces* (UIST '90) ลองแชร์ glyph object ใน document editor แบบ WYSIWYG

- **Intrinsic state** คือสิ่งที่ทำให้ oak เป็น oak: ชื่อ สี และ icon ของมัน มันไม่ขึ้นกับว่าต้นไม้ยืนอยู่ตรงไหน oak ทุกต้นเลยใช้ object ตัวเดียวกันได้
- **Extrinsic state** ขึ้นกับบริบท: `x` และ `y` ของต้นนี้ มันแชร์ไม่ได้ เลยอยู่กับ client และส่งเข้าไปเป็น argument อย่างใน `type.draw(canvas, x, y)`

| ส่วนประกอบ | ใน diagram | หน้าที่ |
|---|---|---|
| **Flyweight** | `draw(canvas, x, y)` บน `TreeType` | interface ที่ object ที่แชร์ใช้รับ extrinsic state ถ้ามี flyweight แค่แบบเดียวอย่างในที่นี้ ก็ไม่ต้องมี interface type แยก |
| **ConcreteFlyweight** | `TreeType`: object ของ Plane, Oak, Maple, Birch และ Pine | เก็บ intrinsic state และถูกแชร์ เลยต้องห้ามเปลี่ยน |
| **UnsharedConcreteFlyweight** | ไม่ได้วาดไว้ | implement interface เดียวกันแต่ไม่ถูกแชร์: อย่างเช่นต้นไม้มรดกที่มีรูปและป้ายของตัวเอง |
| **FlyweightFactory** | `TreeFactory` | เป็นเจ้าของ pool ในที่นี้คือ `Map` จากสายพันธุ์ไปหา `TreeType` แล้วคืน object ที่มีอยู่แล้ว หรือสร้างใหม่ |
| **Client** | แผนที่เมือง | ปลูกและวาดต้นไม้ มันถือ reference ไปหา flyweight และเก็บหรือคำนวณ extrinsic state ของพวกมัน ในที่นี้เก็บไว้ใน object `Tree` |
| **Context** | `Tree` | ไม่ได้เป็นส่วนประกอบในหนังสือ บทความสมัยใหม่หลายที่ รวมถึง Refactoring.Guru ให้ extrinsic state มี class เล็ก ๆ ของตัวเองที่จับคู่มันกับ reference ไปหา flyweight โดยที่ context กับ flyweight ของมันรวมกันจะถือ state ทั้งหมดของ object เดิม ตัวอย่างของ Refactoring.Guru ก็เป็นป่าคล้าย ๆ กันที่มี `Tree`, `TreeType` และ factory |

**หาจุดแบ่ง** นับว่าแต่ละ field มีค่าที่ต่างกันกี่ค่าใน object ทั้งหมด field ที่มีค่าต่างกันอยู่ไม่กี่ค่า (5 สายพันธุ์) น่าจะเป็น intrinsic state ส่วน field ที่ต่างกันเกือบทุก object (ตำแหน่ง) เป็น extrinsic ส่วน heap snapshot ที่เต็มไปด้วย array หรือ string ที่เท่ากัน ก็ชี้ไปทางเดียวกัน จากนั้นถามสองข้อกับแต่ละตัวที่เข้าข่าย: มันขึ้นกับว่า object ถูกใช้ที่ไหนหรือยังไงหรือเปล่า (ถ้าใช่ก็เป็น extrinsic) และจะมีใครต้องเปลี่ยนมันให้ object ตัวเดียวหรือเปล่า (ถ้าใช่ก็แชร์ไม่ได้) extrinsic state ไม่ได้ต้องเก็บไว้เสมอไป: ตัวจัดวางข้อความคำนวณตำแหน่งของแต่ละ glyph ได้ตอนที่จัดบรรทัดอยู่

**ตัว factory** `get(species)` หาสายพันธุ์ใน map ของมัน แล้วคืน `TreeType` ที่เจอ หรือไม่ก็สร้างใหม่ เก็บไว้ แล้วคืนตัวนั้น ฝั่ง client ไม่เคยเรียก `new TreeType()` เอง ถ้า client เรียกเอง oak สองต้นก็อาจได้ object Oak คนละตัว แล้วการแชร์ก็จะค่อย ๆ หายไปแบบไม่มีใครรู้ ใน diagram การเรียก `get()` 100,000 ครั้งสร้าง object แค่ห้าตัว ส่วนอีก 99,995 ครั้งได้ตัวที่มีอยู่แล้วกลับไป

**immutability คือเงื่อนไขที่ต้องมีก่อน** object ที่แชร์เป็นส่วนหนึ่งของทุก object ที่อ้างถึงมัน ถ้า marker ตัวหนึ่งเปลี่ยนสี Oak ของตัวเองได้ oak ทุกต้นบนแผนที่ก็จะเปลี่ยนตาม อย่างที่ step 4 แสดง ให้ intrinsic field เป็น read-only, freeze object และมอง "ต้นนี้หน้าตาไม่เหมือนต้นอื่น" ว่าเป็น "ต้นนี้มี type ต่างออกไป": key ใหม่อย่าง `'Oak (diseased)'` หรือถ้าสีต่างกันไปทีละต้นจริง ๆ ก็ให้เป็น extrinsic state

**คิดเลขดู** ก่อนหน้านี้ 100,000 × (2,048 + 24) bytes ≈ 207.2 MB ส่วนหลังแชร์ 5 × 2,048 + 100,000 × 24 bytes ≈ 2.41 MB น้อยลงประมาณ 86 เท่า ที่ประหยัดได้คร่าว ๆ คือจำนวน object คูณขนาดของ state ที่แชร์ ลบสำเนาหนึ่งชุดต่อ flyweight หนึ่งตัว ลองดูว่าเหลืออะไร: 2.40 จาก 2.41 MB เป็นส่วนของแต่ละ marker (`x`, `y` และ reference) ทำให้หลังแชร์แล้ว ส่วนนี้แหละที่ต้องทำให้เล็ก หรือคำนวณเอาแทนการเก็บ

**ญาติ ๆ**

- [Singleton](../singleton/) มี instance ของ class อยู่ตัวเดียวพอดี และมีทางเข้าถึงมันแบบ global ส่วน flyweight factory มี instance หนึ่งตัวต่อ intrinsic value หนึ่งค่า (ในที่นี้คือ TreeType ห้าตัว) และไม่ต้องเข้าถึงแบบ global ถ้า factory เจอ key แค่ตัวเดียวตลอด มันก็ลดรูปเป็น singleton ที่สร้างแบบ lazy
- Prototype สร้าง object ใหม่ด้วยการก็อปตัวที่ตั้งค่าไว้แล้ว และสำเนาแต่ละตัวเป็นอิสระและเปลี่ยนได้ ส่วน Flyweight แลกกันแบบตรงข้าม: object ตัวเดียว ไม่เคยถูกก็อป ไม่เคยเปลี่ยน
- [Composite](../composite/) เป็นที่ที่ flyweight มักไปอยู่ ตัว editor ในหนังสือแชร์ glyph ของตัวอักษรเป็น leaf ของ document tree ทำให้ tree กลายเป็น graph ตัว leaf ที่แชร์กันเก็บ pointer ไปหา parent ตัวเดียวของมันไม่ได้ parent เลยกลายเป็น extrinsic state
- object ของ [State](../state/) และ [Strategy](../strategy/) ที่ไม่มี field ของตัวเอง ก็แชร์แบบเดียวกันได้ หนึ่ง instance ต่อหนึ่งแบบ และหนังสือก็แนะนำให้ implement มันเป็น flyweight
- object pool (ไม่ได้อยู่ใน 23 ตัวนั้น) ให้ผู้ใช้ยืม object ที่เปลี่ยนได้ไปใช้ทีละคนแล้วเอาคืน อย่าง database connection ส่วน flyweight ทุกคนแชร์ใช้พร้อมกัน และไม่มีวันเปลี่ยน
- `TreeFactory` ไม่ใช่ [Factory Method](../factory-method/): ไม่มี subclass ไหนตัดสินว่าจะสร้าง class อะไร มันคือ cache ที่มีขั้นตอนสร้าง และใช้ intrinsic state เป็น key

## โค้ด

TypeScript ที่ตรงกับ diagram ตัว Node 22.18 ขึ้นไปรันได้เลยตามนี้ (`node trees.ts`) โดยตัด type ทิ้ง ถ้าติดตั้ง `@types/node` ไว้ ตัว `tsc --noEmit --strict` ก็จะเช็ก type ให้ บรรทัด `assert` เช็กสิ่งที่ diagram แสดง: type ห้าตัว, oak สองต้นที่แชร์ object ตัวเดียว, flyweight ที่ถูก freeze และตัวเลขประมาณการของ memory

```ts
import assert from 'node:assert/strict';

const COLOURS: Record<string, string> = {
  Oak: 'darkgreen', Maple: 'orange', Plane: 'olive', Birch: 'yellowgreen', Pine: 'seagreen',
};
const loadIcon = (_species: string) => new Uint8Array(2048); // stands in for a decoded 2 KB icon

// Flyweight: the intrinsic state of one species, shared by all its trees.
class TreeType {
  readonly name: string;
  readonly colour: string;
  readonly icon: Uint8Array;
  constructor(name: string, colour: string, icon: Uint8Array) {
    this.name = name; this.colour = colour; this.icon = icon;
    Object.freeze(this); // shallow: the icon's bytes must not be written either
  }
  draw(canvas: string[], x: number, y: number): void { // the extrinsic state comes in
    canvas.push(`${this.name} (${this.colour}) at ${x}, ${y}`);
  }
}

// FlyweightFactory: one TreeType per species, created on the first request.
class TreeFactory {
  private readonly types = new Map<string, TreeType>();
  get(species: string): TreeType {
    let type = this.types.get(species);
    if (!type) {
      type = new TreeType(species, COLOURS[species], loadIcon(species));
      this.types.set(species, type);
    }
    return type;
  }
  get size(): number { return this.types.size; }
}

// Context: what is unique to one marker, plus a reference to its type.
class Tree {
  readonly x: number;
  readonly y: number;
  readonly type: TreeType;
  constructor(x: number, y: number, type: TreeType) { this.x = x; this.y = y; this.type = type; }
  draw(canvas: string[]): void { this.type.draw(canvas, this.x, this.y); }
}

// The client plants 100,000 trees of 5 species, starting with the diagram's three.
const factory = new TreeFactory();
const species = Object.keys(COLOURS);
const trees = [new Tree(66, 50, factory.get('Oak')), new Tree(116, 50, factory.get('Oak'))];
trees.push(new Tree(42, 132, factory.get('Maple')));
for (let i = trees.length; i < 100_000; i++) {
  trees.push(new Tree(i % 400, Math.floor(i / 400), factory.get(species[i % 5])));
}

assert.equal(factory.size, 5);              // the map stopped growing at 5 types
assert.equal(trees[0].type, trees[1].type); // two oaks, one TreeType object
assert.throws(() => { (trees[0].type as any).colour = 'red'; }, TypeError); // frozen

const ICON = 2048, PER_TREE = 24; // x and y as 8-byte numbers, plus one 8-byte reference
const copied = trees.length * (ICON + PER_TREE);
const shared = factory.size * ICON + trees.length * PER_TREE;
assert.equal(copied, 207_200_000);
assert.equal(shared, 2_410_240);

const canvas: string[] = [];
trees[0].draw(canvas);
console.log(canvas[0]); // Oak (darkgreen) at 66, 50
console.log(`${(copied / 1e6).toFixed(1)} MB → ${(shared / 1e6).toFixed(2)} MB`); // 207.2 MB → 2.41 MB
```

ผลลัพธ์:

```
Oak (darkgreen) at 66, 50
207.2 MB → 2.41 MB
```

ไฟล์นี้เป็น ES module และ ES module เป็นโค้ด strict mode เสมอ การเขียนลง object ที่ถูก freeze เลย throw `TypeError` แทนที่จะ fail เงียบ ๆ ตัวเลขประมาณการเป็นแบบง่ายตัวเดียวกับใน diagram ส่วน engine จริงจะบวก object header เข้าไป และจัดวาง field ในแบบของมันเอง

## ใช้ตอนไหนดี

- มี object เยอะมาก ตั้งแต่หลักหมื่นขึ้นไป และ memory เป็นปัญหาที่วัดมาแล้วจริง ๆ: บนมือถือ ใน browser tab ในเกม หรือใน cache ที่ถือ entry เป็นล้าน
- state ส่วนใหญ่ของแต่ละ object ซ้ำกันในหลาย ๆ ตัว และมีชุดค่าที่ต่างกันอยู่ไม่กี่ชุด: 5 สายพันธุ์, ตัวอักษรของ alphabet หนึ่งชุด, map tile ไม่กี่ร้อยแบบ
- ส่วนที่เหลือต่อ object เล็ก หรือคำนวณเอาตอนที่ต้องใช้ได้
- ไม่มีอะไรขึ้นกับ identity ของ object: ไม่มีโค้ดไหนคาดว่า type ของต้นไม้สองต้นจะเป็นคนละ object ไม่เอามันไปใช้เป็น lock และไม่ได้แขวนข้อมูลของแต่ละต้นไว้กับมัน
- ข้ามไปถ้า object มีไม่กี่ตัวหรือส่วนใหญ่ไม่ซ้ำกัน ถ้าส่วนที่แชร์ได้เล็กเมื่อเทียบกับส่วนที่เหลือ (แชร์สีขนาด 4 bytes ก็ประหยัดได้นิดเดียว) หรือถ้า runtime แชร์ข้อมูลให้อยู่แล้ว อย่างที่ Java ทำกับ string literal

## ได้อะไร เสียอะไร

- **extrinsic state ต้องเดินทาง** ทุก operation ที่ต้องใช้ตำแหน่งต้องได้รับตำแหน่งเข้าไป `draw(canvas)` เลยกลายเป็น `draw(canvas, x, y)` ฝั่ง client ต้องเก็บหรือคำนวณ state นั้น และ interface ก็กว้างขึ้น
- **เพิ่มอีกทอดหนึ่ง** จะอ่านสีของต้นไม้ก็ต้องตาม reference ไป และ object ที่ถืออยู่ (`Tree`) ก็ไม่ใช่ตัวที่มีข้อมูล (`TreeType`)
- **debug ยากขึ้น** bug ที่เขียนลง state ที่แชร์จะไปโผล่ไกลจากจุดที่มันเกิด บนทุก object ที่แชร์ state นั้น จะตั้ง flag ให้ "oak ต้นที่สาม" ก็ไม่ได้ เพราะมี Oak อยู่ตัวเดียว
- **identity เชื่อไม่ได้** ค่าสองค่าที่เท่ากันจะเป็น object เดียวกันหรือเปล่าขึ้นกับ policy ของ factory ตัว `==` ที่จริงอยู่วันนี้ เลยอาจไม่จริงหลังจาก cache เปลี่ยน
- **factory คือ state ที่แชร์และเปลี่ยนได้** มันต้องมีกฎสำหรับตอนที่ miss พร้อมกัน และสำหรับ memory เพราะ factory ที่มี key ใหม่เข้ามาเรื่อย ๆ จะโตไปไม่หยุด (ดูข้างล่าง)
- **ส่วนที่ได้คืนมา** memory ลดลงประมาณขนาดของ state ที่แชร์คูณจำนวน object และงาน allocate, collect และโหลด memory ส่วนนั้นก็ลดลงไปด้วย

## ข้อควรรู้ตอนลงมือทำ

- **freeze มันไว้** ใน TypeScript ตัว `readonly` มีผลแค่กับ compiler ส่วน `Object.freeze(this)` ใน constructor ทำให้การเขียนลงไป throw ตอน runtime ในโค้ด strict mode อย่างที่ตัวอย่าง assert ไว้ การ freeze เป็นแบบตื้น: object ที่ซ้อนอยู่ข้างในยังเขียนได้ และ typed array ที่มี element จะ freeze ไม่ได้เลย (`Object.freeze(new Uint8Array(4))` throw `TypeError`) เลยต้องเก็บ buffer ของ icon เป็น private หรือส่งสำเนาออกไปแทน ใน Java ให้ใช้ field แบบ `final` และอย่าปล่อย array ที่เปลี่ยนได้หลุดออกไป
- **เทียบด้วยค่า ยกเว้นตั้งใจจะใช้ identity** โค้ดที่ได้รับ flyweight ควรเทียบมันด้วย key หรือด้วย `equals()` การเทียบ identity ปลอดภัยก็ต่อเมื่อ factory รับประกันว่ามี object เดียวต่อหนึ่งค่า และโค้ดตั้งใจพึ่งข้อนี้ อย่าง interned string ที่ใช้ lookup ให้เร็ว หรือข้อมูลแบบ hash-consed ตัว `Integer.valueOf(int)` ของ Java ให้เห็นกับดักนี้: มัน cache −128 ถึง 127 เสมอ และอาจ cache ค่าอื่นด้วย ทำให้ `Integer.valueOf(127) == Integer.valueOf(127)` เป็น true แต่การเทียบแบบเดียวกันกับ 1,000 ไม่รับประกันว่าจะ true ส่วน documentation ของมันเรียก `Integer` ว่าเป็น value-based class ที่ instance ที่เท่ากันควรถูกมองว่าใช้แทนกันได้
- **ทิ้ง flyweight ที่ไม่มีใครใช้** factory ที่ถือ reference ธรรมดาจะเก็บทุก type ไว้ตลอดไป สำหรับห้าสายพันธุ์ไม่เป็นไร แต่จะกลายเป็น leak ถ้า key ไม่มีขอบเขต: input ของผู้ใช้ font จาก document ที่อัปโหลดมา ชื่อที่ generate ขึ้น ทางออกมีสองทาง:
  - *จำกัดขนาด* อย่าง eviction แบบ least-recently-used มันง่าย แต่ flyweight ที่ถูก evict ไปแล้วที่ client ยังถืออยู่จะยังไม่ตาย และ `get()` ครั้งถัดไปของ key นั้นจะสร้าง object ตัวที่สองที่เท่ากันขึ้นมา identity เลยเชื่อไม่ได้อีกต่อไป
  - *Weak reference* เพื่อให้ entry หายไปเองเมื่อไม่มี client ไหนใช้ flyweight ของมันแล้ว ใน JavaScript ใช้ `WeakMap` ไม่ได้ เพราะ key ของมันต้องเป็น object หรือ symbol ที่ไม่ได้ register ไม่ใช่ string ส่วนรูปแบบที่ใช้กันปกติคือ `Map<string, WeakRef<TreeType>>` ที่ `get()` มอง entry ที่ `deref()` คืน `undefined` ว่าเป็น miss บวกกับ callback ของ [`FinalizationRegistry`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry) ที่ลบ entry เก่าทิ้ง MDN แนะนำให้เลี่ยงทั้งสองตัวถ้าทำได้: object จะถูก collect เมื่อไหร่ หรือจะถูก collect หรือเปล่า เป็นเรื่องของ engine และ cleanup callback อาจรันช้าหรือไม่รันเลย เลยต้องคงการเช็ก `deref()` ไว้ documentation ของ [`WeakReference`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/lang/ref/WeakReference.html) ใน Java บอกว่า canonicalizing mapping คือการใช้งานที่พบบ่อยที่สุดของมัน แต่ระวังว่า `WeakHashMap` ถือ key แบบ weak แต่ถือ value แบบ strong ส่วน [`weakref.WeakValueDictionary`](https://docs.python.org/3/library/weakref.html#weakref.WeakValueDictionary) ของ Python จะทิ้ง entry เมื่อไม่มีอะไรอื่นอ้างถึง value ของมันแล้ว
- **Thread** flyweight ที่ immutable แชร์ข้าม thread ได้โดยไม่ต้อง lock แต่ factory ทำแบบนั้นไม่ได้ ถ้าสอง thread miss `'Oak'` ในจังหวะเดียวกัน ก็อาจต่างคนต่างสร้าง Oak ขึ้นมา ใน Java ตัว [`ConcurrentHashMap.computeIfAbsent`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html#computeIfAbsent(K,java.util.function.Function)) ทำ get-or-create ทั้งหมดแบบ atomic และเรียก function ที่ใช้สร้างไม่เกินหนึ่งครั้งต่อการเรียกหนึ่งครั้ง ส่วน JavaScript รัน `get()` จนจบบน thread เดียว `Map` ธรรมดาในตัวอย่างเลยพอแล้ว
- **เจอได้ที่ไหนบ้าง**
  - Java: `Integer.valueOf(int)` ข้างบน และ `String.intern()` ที่คืน string ใน pool ที่เท่ากับตัวที่เรียกมัน โดยเพิ่มเข้า pool ก่อนถ้าจำเป็น string literal ทุกตัวถูก intern ไว้แล้ว
  - Python: `sys.intern()` ทำให้ string ที่เท่ากันเป็น object เดียว dictionary lookup จะได้เทียบ pointer แทนการเทียบทีละตัวอักษร ชื่อที่ใช้ในโปรแกรมปกติจะถูก intern ให้อัตโนมัติ และ interned string ก็ไม่ได้อยู่ตลอดไป: ต้องเก็บ reference ของผลลัพธ์ไว้
  - JavaScript: [`Symbol.for(key)`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol/for) คืน symbol ที่ register ไว้ภายใต้ `key` ใน registry ระดับทั้ง runtime หรือไม่ก็สร้างแล้ว register ตัวใหม่: เป็น flyweight factory ที่ติดมากับภาษา
  - ข้อความ: หนังสือเปิดเรื่อง pattern นี้ด้วย document editor ที่ให้ตัวอักษรทุกตัวเป็น object มันแชร์ object หนึ่งตัวต่อ character code หนึ่งค่า ตรงนี้คือ intrinsic state แล้วตอนวาดก็ส่งตำแหน่งของแต่ละตัวอักษรเข้าไป ตรงนี้คือ extrinsic state
  - GPU: การวาดแบบ instanced ส่ง mesh หนึ่งตัวไปที่ GPU แล้ววาดมันหลายครั้ง โดยมีข้อมูลก้อนเล็ก ๆ ต่อ instance อย่างตำแหน่งหรือ transform ใน WebGL 2 ตัว `drawArraysInstanced()` วาด vertex ช่วงเดียวกันหลาย instance และ [`vertexAttribDivisor()`](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/vertexAttribDivisor) ทำให้ attribute ขยับไปหนึ่งครั้งต่อ instance แทนที่จะเป็นหนึ่งครั้งต่อ vertex มันคือการแบ่งแบบเดียวกับแผนที่: mesh ที่แชร์ตัวเดียว กับ extrinsic state ชุดเล็ก ๆ หลายชุด
- **แนวคิดที่เกี่ยวข้อง**
  - *Interning* คือ flyweight factory สำหรับค่าอย่าง string และ symbol
  - *Hash-consing* เอาแนวคิดนี้ไปใช้กับ immutable data structure: ก่อนจะสร้าง node ให้หาตัวที่โครงสร้างเท่ากันก่อน แล้วใช้ตัวนั้นซ้ำ โครงสร้างที่เท่ากันจะเป็น object เดียวกัน การเช็กว่าเท่ากันเลยเหลือแค่เทียบ pointer ครั้งเดียว
  - *Caching* ก็ส่งผลลัพธ์ที่เก็บไว้ออกไปแทนการสร้างใหม่เหมือนกัน ที่ระดับระบบ อย่างใน [Cache-Aside](../cache-aside/) ตัว cache ถือสำเนาของข้อมูลที่อยู่ที่อื่น และข้อมูลนั้นเก่าได้ entry เลยต้องหมดอายุแล้ว refresh ส่วน flyweight factory ถือสำเนาเดียวที่มีอยู่ และ entry ของมันไม่มีวันเก่า เพราะมันไม่เคยเปลี่ยน
- **ที่ระดับ architecture** container image ใช้การแบ่งแบบเดียวกัน image คือ layer แบบ read-only ที่ซ้อนกันอยู่ แล้ว container ทุกตัวที่ start จาก image นั้นแชร์ layer เหล่านั้นร่วมกัน และ container แต่ละตัวเพิ่มแค่ layer บาง ๆ ที่เขียนได้ของตัวเอง documentation ของ Docker อธิบายเรื่องนี้สำหรับ storage driver แบบดั้งเดิม และบอกว่าแนวคิดเดียวกันใช้ได้กับ containerd image store ด้วย ตัวนี้เป็น default ในการติดตั้งใหม่ของ Docker Engine 29.0 ขึ้นไป แล้ว image layer ก็คือ intrinsic state ส่วน layer ที่เขียนได้และ setting ของแต่ละ container คือ extrinsic state เหมือนกับ flyweight การแชร์จะปลอดภัยก็เพราะส่วนที่แชร์ไม่มีวันเปลี่ยน: container ที่แก้ไฟล์จะได้สำเนาของตัวเองใน layer ที่เขียนได้ของมัน
