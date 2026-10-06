## ปัญหา

library วาดรูปมี shape อย่างวงกลม สี่เหลี่ยม และสามเหลี่ยม และมี output หลายแบบ: SVG markup สำหรับหน้าเว็บ, การเรียกบน HTML canvas, หน้า PDF นี่เป็นสองคำถามที่แยกกัน คือจะวาด*อะไร* และจะเขียนออกมา*ยังไง* แต่ class hierarchy มีแค่แกนเดียว ถ้าให้ `Shape` มี subclass สำหรับทุกคู่ของ shape กับ output ก็จะได้ class หนึ่งตัวต่อหนึ่งคู่: `SvgCircle`, `CanvasCircle`, `PdfCircle`, `SvgRectangle` ไปเรื่อย ๆ ในที่นี้คือ 3 × 3 = 9

จำนวน class เป็นแค่ส่วนที่มองเห็น class `Svg…` ทุกตัวเขียนโค้ดที่สร้าง SVG ซ้ำกัน และ class `…Circle` ทุกตัวก็เขียน geometry ของวงกลมซ้ำกัน จะแก้อะไรฝั่งไหนก็ต้องแก้สามรอบ การโตก็เป็นแบบทวีคูณ: output แบบ ASCII สำหรับ terminal เพิ่มมาทั้งคอลัมน์สาม class (12) แล้ว hexagon ก็เพิ่มมาทั้งแถวสี่ class (16) รูปแบบ output ยังถูกฝังไว้ใน class ในทุกจุดที่เรียกใช้ด้วย โค้ดที่เขียนว่า `new SvgCircle(…)` เลยส่งวงกลมเดียวกันไปเป็น PDF ไม่ได้ ถ้าไม่แก้โค้ด

## ทำงานยังไง

Bridge ผ่า hierarchy เดียวนั้นออกเป็นสองตามสองคำถามนั้น แล้วเชื่อมสองครึ่งไว้ด้วย reference โดย shape เป็น hierarchy หนึ่ง renderer เป็นอีก hierarchy หนึ่ง และ shape แต่ละตัวก็ถือ renderer ที่มันใช้วาดไว้ ตัว shape คิดว่าจะวาดอะไร แล้วบอกออกไปด้วยคำศัพท์ primitive ชุดเล็ก ๆ ของ renderer ส่วน renderer รู้ว่าจะเขียน primitive พวกนั้นลงรูปแบบของตัวเองยังไง และไม่รู้อะไรเกี่ยวกับ shape เลย แบบนี้ฝั่งไหนจะเพิ่ม class ก็ได้โดยอีกฝั่งไม่รู้ตัว แพตเทิร์นนี้เป็นหนึ่งใน structural pattern ในหนังสือ *Design Patterns* ของ Gamma, Helm, Johnson และ Vlissides (1994) ที่ให้อีกชื่อไว้ว่า *Handle/Body* และตั้งชื่อตาม reference ตัวนั้น: สะพานระหว่าง abstraction กับ implementation ของมัน

| ผู้มีบทบาท | ในแผนภาพ | หน้าที่ |
|---|---|---|
| **Abstraction** | `Shape` | สิ่งที่ client ใช้: `draw()` มันถือ reference ไปที่ `Renderer` ไว้ และ reference ตัวนี้แหละคือ bridge |
| **RefinedAbstraction** | `Circle`, `Rectangle`, `Triangle`, `Hexagon` | แบบต่าง ๆ ของ abstraction แต่ละตัว implement `draw()` ด้วย primitive ของ renderer เท่านั้น |
| **Implementor** | `Renderer` | interface ของฝั่ง implementation ในที่นี้มีสอง primitive: `circle(x, y, r)` และ `polygon(points)` มันไม่ต้องหน้าตาเหมือน interface ของ abstraction และปกติก็อยู่ระดับต่ำกว่า |
| **ConcreteImplementor** | `SvgRenderer`, `CanvasRenderer`, `PdfRenderer`, `AsciiRenderer` | หนึ่งตัวต่อหนึ่งรูปแบบ output แต่ละตัว implement primitive และไม่เคยเห็น shape เลย |

**"abstraction" กับ "implementation" ในที่นี้หมายถึงอะไร** มันไม่ได้หมายถึง abstract class กับ concrete class ที่ implement มัน ตามความหมายที่ใช้กันทั่วไป: bridge แต่ละฝั่งมีทั้งสองอย่าง `Shape` เป็น abstract และ `Circle` เป็น concrete ส่วน `Renderer` เป็น interface และ `SvgRenderer` เป็น class สองคำนี้เป็นชื่อของ*มิติที่เปลี่ยนแปลงได้*สองมิติ abstraction คือส่วนที่แอปคิดถึง (มี shape อะไรบ้าง และแต่ละตัวประกอบด้วยอะไร) ส่วน implementation คือส่วนที่ทำมันออกมาจริงบน platform หรือสื่อสักอย่าง (markup, การเรียก canvas, เนื้อหา PDF, ตัวอักษรใน terminal) วิธีเช็กว่าควรใช้ bridge ไหม คือดูว่าสองฝั่งเปลี่ยนด้วยเหตุผลต่างกันหรือเปล่า: shape ใหม่มาจากความต้องการของ product ส่วน renderer ใหม่มาจาก platform ที่ต้องรองรับ

**เลขคณิต** ถ้ามี class หนึ่งตัวต่อหนึ่งคู่ แล้วมี shape *m* แบบกับ renderer *n* แบบ ก็ต้องใช้ *m × n* class ถ้ามี bridge ก็ใช้ *m + n* โดยไม่นับ `Shape` กับ `Renderer` เอง ที่ 3 กับ 3 คือ 9 ต่อ 6 แทบไม่ใช่เหตุผลที่ต้องใช้แพตเทิร์น แต่ renderer ตัวที่สี่ทำให้เป็น 12 ต่อ 7 และ shape ตัวที่สี่ทำให้เป็น 16 ต่อ 8 เหตุผลที่ดีกว่าคือของแต่ละอย่างอยู่ในที่เดียว (locality): `AsciiRenderer` เป็น class ตัวเดียวที่วาด shape ได้ทุกตัวที่มี และ `Hexagon` เป็น class ตัวเดียวที่ renderer ทุกตัววาดได้ ของที่เพิ่มแต่ละอย่างเลยถูกเขียน ถูก review และถูก test แค่ครั้งเดียว

## โค้ด

TypeScript ที่ตรงกับแผนภาพ (ตัด `PdfRenderer` กับ `Triangle` ออกให้สั้นลง) Node 22.18 ขึ้นไปรันได้เลย (`node shapes.ts`) ด้วยการตัด type ทิ้ง ส่วน `tsc --noEmit` เป็นตัวตรวจ type ให้ ตัว `CanvasRenderer` คืนการเรียกที่มันจะทำบน `CanvasRenderingContext2D` ออกมาเป็น text ตัวอย่างเลยรันนอก browser ได้ การเรียกพวกนี้ทำตามสูตรของ MDN สำหรับวงกลมเต็มวง: `arc()` จากมุม 0 ถึง 2π อยู่ระหว่าง `beginPath()` กับ `stroke()`

```ts
import assert from 'node:assert/strict';

type Point = readonly [number, number];

// Implementor: the primitives that every output format can provide.
interface Renderer {
  circle(x: number, y: number, r: number): string;
  polygon(points: readonly Point[]): string;
}

// ConcreteImplementors: one per format. None of them knows what a shape is.
class SvgRenderer implements Renderer {
  circle(x: number, y: number, r: number) { return `<circle cx="${x}" cy="${y}" r="${r}"/>`; }
  polygon(points: readonly Point[]) { return `<polygon points="${points.join(' ')}"/>`; }
}
class CanvasRenderer implements Renderer { // returns the calls as text, so that it runs in Node
  circle(x: number, y: number, r: number) {
    return `ctx.beginPath(); ctx.arc(${x}, ${y}, ${r}, 0, 2 * Math.PI); ctx.stroke();`;
  }
  polygon(points: readonly Point[]) {
    const path = points.map(([x, y], i) => `ctx.${i ? 'lineTo' : 'moveTo'}(${x}, ${y}); `).join('');
    return `ctx.beginPath(); ${path}ctx.closePath(); ctx.stroke();`;
  }
}

// Abstraction: holds the bridge, and draws only through Renderer's primitives.
abstract class Shape {
  protected readonly renderer: Renderer;
  constructor(renderer: Renderer) { this.renderer = renderer; }
  abstract draw(): string;
}

// RefinedAbstractions: each one decides what to draw, never how.
class Circle extends Shape {
  readonly x: number; readonly y: number; readonly r: number;
  constructor(renderer: Renderer, x: number, y: number, r: number) {
    super(renderer); this.x = x; this.y = y; this.r = r;
  }
  draw() { return this.renderer.circle(this.x, this.y, this.r); }
}
class Rectangle extends Shape {
  readonly corners: Point[];
  constructor(renderer: Renderer, x: number, y: number, w: number, h: number) {
    super(renderer); this.corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  }
  draw() { return this.renderer.polygon(this.corners); }
}

const svg = new SvgRenderer(), canvas = new CanvasRenderer();
assert.equal(new Circle(svg, 50, 50, 40).draw(), '<circle cx="50" cy="50" r="40"/>');
assert.equal(new Circle(canvas, 50, 50, 40).draw(),
  'ctx.beginPath(); ctx.arc(50, 50, 40, 0, 2 * Math.PI); ctx.stroke();');
assert.equal(new Rectangle(svg, 10, 20, 80, 40).draw(), '<polygon points="10,20 90,20 90,60 10,60"/>');

for (const c of [Shape, Circle, Rectangle]) Object.freeze(c.prototype); // shapes done: edits now throw

// Added later, against Renderer alone: a 100 x 100 drawing as 20 x 10 characters.
class AsciiRenderer implements Renderer {
  private plot(inside: (x: number, y: number) => boolean) {
    return Array.from({ length: 10 }, (_, row) => Array.from({ length: 20 },
      (_, col) => (inside(5 * col + 2.5, 10 * row + 5) ? '#' : '.')).join('')).join('\n');
  }
  circle(cx: number, cy: number, r: number) {
    return this.plot((x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r);
  }
  polygon(points: readonly Point[]) { // inside if a ray to the right crosses an odd number of edges
    return this.plot((x, y) => points.filter(([x1, y1], i) => {
      const [x2, y2] = points[(i + 1) % points.length];
      return (y1 > y) !== (y2 > y) && x < x1 + ((y - y1) * (x2 - x1)) / (y2 - y1);
    }).length % 2 === 1);
  }
}
const ascii = new AsciiRenderer();
const round = new Circle(ascii, 50, 50, 40).draw().split('\n'); // the same, frozen classes
const box = new Rectangle(ascii, 10, 20, 80, 40).draw().split('\n');
assert.equal(round[4], '..################..');               // 80 units wide: 16 characters
assert.equal(box.filter((row) => row.includes('#')).length, 4); // 40 units high: 4 rows
console.log(round.map((row, i) => `${row}   ${box[i]}`).join('\n'));
```

ผลลัพธ์ คือวงกลมกับสี่เหลี่ยมที่ `AsciiRenderer` วาดออกมา:

```
....................   ....................
......########......   ....................
....############....   ..################..
...##############...   ..################..
..################..   ..################..
..################..   ..################..
...##############...   ....................
....############....   ....................
......########......   ....................
....................   ....................
```

class ของ shape ถูก freeze ด้วย `Object.freeze` ก่อนจะประกาศ `AsciiRenderer` ทำให้ renderer ตัวใหม่ไม่มีทางไปแพตช์มันได้: มันเข้าถึง `Circle` กับ `Rectangle` ได้ผ่าน interface `Renderer` เท่านั้น อีกทิศก็ทำงานแบบเดียวกัน `Hexagon` จะเป็นแค่ subclass ของ `Shape` อีกตัวที่ส่งมุมหกมุมให้ `renderer.polygon()` แล้ว renderer ทั้งสามตัวก็จะวาดมันได้โดยไม่ต้องเปลี่ยนอะไร

## ใช้ตอนไหนดี

- class เปลี่ยนไปตามสองมิติที่เป็นอิสระต่อกัน เช่น shape กับรูปแบบ output, message กับช่องทางส่ง หรือ UI control กับ platform ที่มันรันอยู่ และการทำ subclass จะต้องมี class สำหรับทุกคู่
- ทั้งสองฝั่งจะโต ในเวลาที่ต่างกันหรือโดยทีมที่ต่างกัน: shape มาจากงาน product ส่วน renderer มาจากงาน platform
- implementation ควรถูกเลือกตอนโปรแกรมรันอยู่ (จาก config, จาก platform, จากชนิดไฟล์ที่กำลังเขียน) หรือถูกแทนด้วย fake ใน test โดยไม่ต้องแตะโค้ดที่ใช้ abstraction
- client ไม่ควรเห็นรายละเอียดของ implementation หรือไม่ควรต้อง compile ใหม่เมื่อมันเปลี่ยน (กรณี pImpl ของ C++ ข้างล่าง)
- ไม่ใช่ตอนที่เปลี่ยนแค่มิติเดียว: interface ที่มี implementation ไม่กี่ตัวก็พอแล้ว และไม่ใช่ตอนที่สองมิติไม่ได้อิสระต่อกันจริง: ถ้า shape ทุกตัวต้องได้การดูแลพิเศษใน renderer ทุกตัว ความรู้เรื่อง shape ก็จะรั่วเข้าไปใน primitive และการแยกก็จะเสียมากกว่าได้

## ได้อะไร เสียอะไร

- **hierarchy สองชุดกับทางอ้อมหนึ่งชั้น** แทนที่จะเป็น class tree ชุดเดียว ถ้ามี shape สองแบบกับ output สองแบบ class เล็ก ๆ สี่ตัวก็อาจง่ายกว่าจริง ๆ
- **primitive คือ contract** ระหว่างสองฝั่ง การเพิ่ม primitive สักตัว เช่น `text()` หรือ `bezier()` หมายถึงต้อง implement มันใน renderer ทุกตัวพร้อมกัน และนี่ก็คือการเปลี่ยนแปลงแบบที่แพตเทิร์นนี้มีไว้เพื่อเลี่ยงพอดี ให้ primitive ใหม่มี implementation แบบ default (ดูข้างล่าง)
- **ตัวหารร่วม** shape ใช้ได้แค่สิ่งที่ interface ระบุไว้ จุดแข็งเฉพาะของแต่ละรูปแบบ (SVG filter, PDF link) เลยเอื้อมไม่ถึง เว้นแต่ interface จะโตขึ้น หรือเปิด capability แบบไม่บังคับไว้
- **interface ที่คุยถี่จะช้า** primitive ที่ละเอียดเกินไป เรียกหนึ่งครั้งต่อหนึ่ง pixel หรือหนึ่งตัวอักษร จะทำให้จำนวนการเรียกทวีขึ้น และยิ่งเจ็บหนักเมื่อการเรียกข้าม process หรือ network
- **สิ่งที่ได้กลับมา** shape กับ renderer ถูกเขียน ถูก test และถูก ship แยกกัน class ใหม่ทุกตัวทำงานกับอีกฝั่งได้ครบทั้งฝั่งทันที และเลือก implementation ได้ตอน run time

## ข้อควรรู้ตอนลงมือทำ

- **การเลือก primitive** นี่คือการตัดสินใจหลักในการออกแบบ primitive ต้องอยู่ระดับต่ำพอที่ renderer ทุกตัวจะทำให้ได้ (polygon ก็แค่ list ของจุด ที่รูปแบบไหนในนี้ก็วาดได้) และต้องอยู่ระดับสูงพอที่ shape ตัวเดียวจะไม่กลายเป็นการเรียกหลายร้อยครั้ง (ไม่มี `setPixel()` ที่มีแค่ raster ที่ implement ได้แบบถูก ๆ และจะทำให้ทุกการวาดคุยถี่) สุดทางทั้งสองฝั่งใช้ไม่ได้: เอาแค่สิ่งที่ back end ทุกตัวมีร่วมกันก็จนเกินไป ส่วนเอาทุกอย่างที่ back end ตัวไหนก็ตามทำได้ ก็ทำให้ renderer แต่ละตัวต้องเขียน stub ไว้เกือบทั้ง interface

  paint system ของ Qt แสดงทางสายกลางให้ดู แอปวาดด้วย `QPainter` ลงบน paint device (widget, image, printer, PDF writer) แล้ว `QPaintEngine` ของ device ก็ทำงานจริง โค้ดของแอปไม่เคยเห็น engine เลย เว้นแต่จะเพิ่ม device แบบของตัวเอง ตัว engine ต้อง implement primitive แบบ polygon ส่วน `drawEllipse()` มี implementation แบบ default ที่เรียก `drawPolygon()` เลยมีแค่ engine ที่มี ellipse แบบ native ที่ต้อง override มัน ตัว engine ยังประกาศด้วยว่ารองรับ feature ไหน แล้ว `QPainter` ก็จำลองตัวที่ขาดให้เท่าที่ทำได้ แกนหลักเล็ก ๆ ที่บังคับ บวก operation ที่หลากหลายกว่าที่มี default สร้างจากแกนนั้น ก็ map ตรง ๆ ไปเป็น abstract base class ที่มี default method
- **ใครสร้างและต่อ implementor** ถ้า constructor ของ `Shape` เรียก `new SvgRenderer()` เอง dependency ที่แพตเทิร์นนี้เอาออกไปก็จะกลับมาอีก ให้ส่ง renderer เข้าไปแทน: constructor injection แบบในโค้ด โดยเลือกในที่เดียวตอนเริ่มทำงาน (จาก config, นามสกุลของไฟล์ output หรือ platform) หนังสือยังเล่าถึงการให้ abstraction เลือกเองจาก argument ของ constructor โดยเริ่มจาก default แล้วสลับทีหลัง (collection ที่เปลี่ยน representation ตอนมันโตขึ้น) และการโยนการตัดสินใจให้ object อื่น โดย object ตัวนั้นมักเป็น [Abstract Factory](../abstract-factory/) ที่คืน implementor ที่เหมาะกับ platform หรือคืนทั้งตระกูล ทำให้ไม่มี shape ตัวไหนต้องเอ่ยชื่อ concrete renderer เลย
- **การแชร์ implementor** renderer ที่ไม่มี state ต่อการวาดแต่ละครั้ง ใช้กับ shape ทุกตัวได้: `SvgRenderer` ตัวเดียวสำหรับเอกสารทั้งฉบับ หรือสำหรับทั้งโปรแกรม ส่วนตัวที่ถือ state เช่นหน้า PDF ที่เปิดอยู่ หรือ canvas context กับ transform ปัจจุบันของมัน เป็นของการวาดทีละครั้ง เลยต้องทำให้ชัดว่าใครเปิดและใครปิดมัน ในหนังสือ ส่วนที่คุยเรื่อง C++ แชร์ body ตัวเดียวให้ handle หลายตัวแล้วนับ reference ไปที่มัน (Handle/Body idiom ของ James Coplien ที่หนังสืออ้างถึง) และ bridge ก็ซ่อนงานจดบัญชีนี้ไว้ไม่ให้ client เห็น
- **การเปลี่ยนตอน run time** ทำได้ด้วย setter แต่ไม่ค่อยใช่ประเด็น: ปกติ bridge ถูกต่อแค่ครั้งเดียวตอนสร้าง object โค้ดที่สลับ implementor ทุกครั้งที่เรียกกำลังทำงานของ Strategy อยู่
- **แบบไม่ใช้ class** ในภาษาที่ function เป็นค่าได้ implementor ก็เป็นแค่ object ธรรมดาที่รวม function ไว้ได้ คือ `{ circle, polygon }` ที่ใน TypeScript ก็ตรงกับ `Renderer` โดยไม่ต้องมี class ส่วน module ก็ทำแบบเดียวกันในระดับที่หยาบกว่า โดยเลือก implementation ตอน build หรือตอนเริ่มทำงาน ฝั่ง abstraction ยังได้ประโยชน์จากการเป็น type ที่ถือ reference อยู่ เพราะนั่นคือสิ่งที่ทำให้ shape ใหม่ทำงานกับ renderer ที่ยังไม่มีอยู่ได้
- **implementor ตัวเดียว: pImpl** ถ้ามี implementation ตัวเดียว แพตเทิร์นนี้ก็ลดรูปเหลือ [pImpl idiom](https://en.cppreference.com/cpp/language/pimpl) ของ C++: private member ของ class ย้ายไปอยู่ใน class แยกที่เข้าถึงผ่าน opaque pointer ทำให้การเปลี่ยนพวกมันไม่ทำให้ผู้ใช้ class ต้อง compile ใหม่ และ library ก็รักษา ABI ให้นิ่งได้ หนังสือก็พูดถึงกรณีลดรูปนี้ไว้ด้วย
- **เจอได้ที่ไหนบ้าง**
  - **JDBC** โค้ดของแอปเขียนโดยอิง interface ของ `java.sql` แล้ว database vendor แต่ละเจ้าก็ส่ง driver ที่ implement interface พวกนั้นมา [`java.sql.Driver`](https://docs.oracle.com/en/java/javase/27/docs/api/java.sql/java/sql/Driver.html) คือ interface ที่ driver class ทุกตัวต้อง implement ส่วน [`DriverManager`](https://docs.oracle.com/en/java/javase/27/docs/api/java.sql/java/sql/DriverManager.html) หา driver ผ่านกลไก service-provider (หรือ system property `jdbc.drivers`) และทุกครั้งที่มีคำขอ connection มันจะไล่ถาม driver ที่ register ไว้ทีละตัวให้ connect ไปที่ URL นั้น เอกสารของมันบอกว่า `DataSource` เป็นวิธี connect ที่แนะนำมากกว่า ฝั่ง abstraction มี DAO, query builder และ ORM: ถ้ามีพวกนี้ m ตัวกับ database n ตัว ก็ต้องมีโค้ด m + n ชิ้น ไม่ใช่ m × n
  - **Qt** `QPainter` กับ `QPaintEngine` แบบที่เล่าไว้ข้างบน ตัว raster engine เป็น default สำหรับวาด widget บน Windows, X11 และ macOS และสำหรับวาดลง `QImage` และ Qt ยังมี engine สำหรับ OpenGL และสำหรับการพิมพ์ด้วย ส่วน output แบบใหม่ก็หมายถึงการ subclass `QPaintEngine` แล้วให้ paint device คืนตัวนั้นออกมา
- **ญาติ ๆ**
  - [Adapter](../adapter/) อาจดูเหมือนกันใน class diagram ความต่างอยู่ที่จังหวะเวลาและเจตนา: adapter ถูกเพิ่มเข้ามาทีหลัง เพื่อให้ class ที่มีอยู่แล้วเข้ากับ interface ที่มันไม่ได้ถูกเขียนมาเพื่อ ส่วน bridge ถูกวางแผนไว้ก่อนที่ฝั่งไหนจะมีอยู่ เพื่อให้ทั้งสองฝั่งโตได้
  - [Strategy](../strategy/) มีโครงสร้างเดียวกัน คือ object ที่ delegate ผ่าน interface ตัว strategy คือ algorithm ตัวเดียวที่สลับกันได้ ปกติ client เป็นคนเลือก และมักถูกสลับตอนโปรแกรมรันอยู่ ส่วน bridge แยก hierarchy สองชุดที่โตทั้งคู่ และปกติจะถูกตั้งไว้ตายตัวตอนสร้าง object
  - [Abstract Factory](../abstract-factory/) สร้างและตั้งค่า bridge ได้ แบบที่เล่าไว้ข้างบน
  - [Decorator](../decorator/) ก็มาแทน class หนึ่งตัวต่อหนึ่งคู่เหมือนกัน แต่ใช้กับ feature ที่ไม่บังคับและซ้อนกันได้ (retry, logging, caching) ที่ object หนึ่งตัวมีชุดย่อยไหนก็ได้ ในลำดับไหนก็ได้ ส่วนใน bridge object แต่ละตัวมีตัวเลือกเดียวพอดีในแต่ละฝั่ง: shape หนึ่งแบบ renderer หนึ่งตัว
- **ในระดับสถาปัตยกรรม** [Hexagonal architecture](../hexagonal-architecture/) (ports and adapters) แยกแบบเดียวกันนี้กับทั้งแอป core ประกาศ interface ที่มันต้องใช้ คือ driven port (บทบาทของ Implementor) แล้วเทคโนโลยีแต่ละตัวก็เสียบเข้ามาข้างหลัง port ตัวหนึ่งในฐานะ adapter (ConcreteImplementor) ทำให้ use case กับ infrastructure เปลี่ยนแยกกันได้ และ test ก็เสียบ adapter แบบ in-memory เข้าไปได้ ในระดับนั้นมีสามอย่างที่เปลี่ยนไป อย่างแรก interface เป็นของ core และหน้าตาของมันมาจากสิ่งที่ core ต้องการ คือ `save(order)` ไม่ใช่ `execute(sql)` อย่างที่สอง อีกฝั่งมักอยู่คนละ process หรือข้าม network ทำให้ interface ต้องหยาบ: นี่คือปัญหา primitive ที่คุยถี่ที่เล่าไว้ข้างบน แต่ราคาแพงกว่ามาก และอย่างที่สาม การต่อสายก็ย้ายออกจาก constructor ของแต่ละ object ไปอยู่ที่ composition root จุดเดียวตอนเริ่มทำงาน
