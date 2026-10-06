## ปัญหา

รายงาน disk usage ต้องบอกว่า folder ของ project กินพื้นที่เท่าไร folder มีไฟล์และ folder อื่นอยู่ข้างใน แล้ว folder พวกนั้นก็มีไฟล์และ folder ซ้อนลงไปอีก คำตอบเลยได้มาจากการเดิน tree ถ้า `File` กับ `Folder` เป็น class ที่ไม่เกี่ยวกันเลย โค้ดที่เดิน tree ก็ต้องเช็กทุกขั้นว่ากำลังถืออะไรอยู่: ถ้าเป็นไฟล์ก็คืนขนาด ถ้าเป็น folder ก็วน loop ไปตามลูก แล้วถามซ้ำ

การเช็กนี้ไม่ได้อยู่ที่เดียว การนับไฟล์ การหาไฟล์ใหญ่ และการพิมพ์ tree ต่างก็เดินโครงสร้างเดียวกัน เลยต้องเขียน branch `instanceof` ชุดเดิมซ้ำ และแต่ละตัวต้องรู้จักทุก class ที่อาจโผล่มาใน folder พอมี entry ชนิดใหม่เข้ามา เช่น symbolic link ก็ต้องเพิ่ม branch ใหม่ในทุก function พวกนั้น และ function ที่ตกหล่นไปจะไม่ได้พังให้เห็นชัด ๆ: ใน JavaScript ตัว `usage()` จะหลุดผ่านทั้งสอง branch แล้วคืน `undefined` และยอดรวมของ folder ก็กลายเป็น `NaN` แบบเงียบ ๆ

## ทำงานยังไง

Composite ให้ object เดี่ยว ๆ กับกลุ่มของ object ใช้ interface เดียวกัน และให้กลุ่มถือ object อะไรก็ได้ที่เป็น interface นั้น รวมถึงกลุ่มอื่นด้วย โค้ดที่ถือ node อยู่ก็ถามคำถามกับมันได้เลย โดยไม่ต้องรู้ว่ามันเป็นไฟล์เดียวหรือทั้ง tree: leaf ตอบเอง ส่วนกลุ่มส่งคำถามต่อให้ลูก แล้วรวมคำตอบของลูกเข้าด้วยกัน recursion ที่ผู้เรียกทุกคนเคยต้องเขียนเอง ตอนนี้ไปอยู่ใน method ของกลุ่มเอง และเขียนแค่ครั้งเดียว แพตเทิร์นนี้เป็นหนึ่งใน structural pattern ในหนังสือ *Design Patterns* ของ Gamma, Helm, Johnson และ Vlissides (1994) ที่ใช้ตัวอย่างเป็นภาพวาดที่ประกอบด้วยเส้น สี่เหลี่ยม ข้อความ และภาพวาดที่เล็กกว่า

| ผู้มีบทบาท | ในแผนภาพ | หน้าที่ |
|---|---|---|
| **Component** | `Node` | interface ที่ทั้งส่วนย่อยและส่วนรวมใช้ร่วมกัน ในที่นี้คือ `name` กับ `size()` |
| **Leaf** | `File`, `Symlink` | node ที่ไม่มีลูก ตอบจากข้อมูลของตัวเอง |
| **Composite** | `Folder` | ถือลูกที่เป็น type `Node` ส่ง request ต่อให้ลูกแต่ละตัว แล้วรวมคำตอบ |
| **Client** | usage report | คุยกับ `Node` อย่างเดียว การเรียกแบบเดียวกันเลยใช้ได้ทั้งกับ `README.md` และ `project/` |

tree ในแผนภาพสร้างจาก object ไม่ใช่ class: `project/`, `assets/`, `src/` และ `icons/` คือ instance ของ `Folder` สี่ตัว และไฟล์ทั้งหกคือ instance ของ `File` สิ่งที่ทำให้โครงสร้างนี้เป็น recursive คือ type ของลูกใน folder ที่เป็น `Node[]` ไม่ใช่ `File[]`: folder ถือ folder ได้ และไม่ต้องรู้เลยว่ากำลังถือชนิดไหนอยู่

**`add()` ควรอยู่ตรงไหน: transparency หรือ safety** ทุก node ตอบ `size()` ได้ แต่มีแค่ folder ที่มีลูก และหนังสือก็ชั่งน้ำหนักไว้สองที่ สำหรับ method ที่เพิ่มและลบลูก:

- **ไว้ที่ `Node` (transparency)** ทุก node มี `add()` โค้ดที่สร้างหรือแก้ tree เลยไม่ต้องรู้ว่ากำลังถืออะไรอยู่ แต่ leaf ต้องปฏิเสธการเรียกตอน runtime ตัว DOM ทำงานแบบนี้: [`appendChild()`](https://developer.mozilla.org/en-US/docs/Web/API/Node/appendChild) เป็น method ของ `Node` และถ้าเรียกมันบน text node ก็จะ throw `HierarchyRequestError`
- **ไว้ที่ `Folder` อย่างเดียว (safety)** leaf ไม่มี `add()` ให้ใช้ผิด และ compiler ก็จับความผิดพลาดได้ แต่โค้ดที่เพิ่มลูกต้องถือ `Folder` อยู่ เลยต้องรู้ type ตัว AWT ทำแบบนี้: method `add(Component)` ถูกประกาศไว้ที่ [`java.awt.Container`](https://docs.oracle.com/en/java/javase/27/docs/api/java.desktop/java/awt/Container.html) (`Component` ที่ถือ component อื่นไว้) ไม่ได้ประกาศไว้ที่ตัว `Component` เอง แล้ว Swing ก็ทำให้ base class ของมันคือ `JComponent` เป็น subclass ของ `Container` ทำให้ component ของ Swing ตัวไหนก็ถือลูกได้

หนังสือนำเสนอแบบ transparent ส่วนโค้ดข้างล่างเลือกแบบ safe: โค้ดที่สร้าง tree รู้อยู่แล้วว่ากำลังสร้าง folder และทุกอย่างที่แค่อ่าน tree ก็ยังเห็นแค่ `Node` อยู่ดี

## โค้ด

TypeScript ที่ตรงกับแผนภาพ Node 22.18 ขึ้นไปรันได้เลย (`node disk-usage.ts`): มันตัด type ทิ้งและไม่ได้ตรวจให้ เลยต้องรัน `tsc --noEmit` เพื่อตรวจ type ส่วนขนาดเป็นกิโลไบต์เต็ม ๆ แบบในแผนภาพ

```ts
import assert from 'node:assert/strict';

// Component: what every node offers, file or folder.
interface Node {
  readonly name: string;
  size(): number;                 // KB
  contains(n: Node): boolean;     // is n this node, or somewhere inside it?
  lines(depth: number): string[]; // an indented listing
}
const pad = (depth: number): string => '  '.repeat(depth);

// Leaf: a file knows its own size.
class File implements Node {
  readonly name: string;
  private readonly kb: number;
  constructor(name: string, kb: number) { this.name = name; this.kb = kb; }
  size(): number { return this.kb; }
  contains(n: Node): boolean { return n === this; }
  lines(depth: number): string[] { return [`${pad(depth)}${this.name} ${this.kb} KB`]; }
}

// Composite: a folder asks each child and never checks what kind it is.
class Folder implements Node {
  readonly name: string;
  private readonly children: Node[] = [];
  constructor(name: string) { this.name = name; }
  add(...nodes: Node[]): this { // only folders have add(): the "safe" choice
    for (const node of nodes) {
      if (node.contains(this)) throw new Error(`${node.name} already contains ${this.name}`);
      this.children.push(node);
    }
    return this;
  }
  size(): number { return this.children.reduce((kb, c) => kb + c.size(), 0); }
  contains(n: Node): boolean { return n === this || this.children.some((c) => c.contains(n)); }
  lines(depth: number): string[] {
    const own = `${pad(depth)}${this.name} ${this.size()} KB`;
    return [own, ...this.children.flatMap((c) => c.lines(depth + 1))];
  }
}

// A new kind of Leaf. Folder needs no change to hold it.
class Symlink implements Node {
  readonly name: string;
  readonly target: string;
  constructor(name: string, target: string) { this.name = name; this.target = target; }
  size(): number { return 0; } // count the link, not its target (du's default)
  contains(n: Node): boolean { return n === this; }
  lines(depth: number): string[] { return [`${pad(depth)}${this.name} -> ${this.target} 0 KB`]; }
}

const icons = new Folder('icons/').add(new File('home.svg', 2), new File('user.svg', 2));
const assets = new Folder('assets/').add(new File('logo.png', 48), icons);
const src = new Folder('src/').add(new File('app.ts', 12), new File('util.ts', 3));
const project = new Folder('project/').add(assets, new File('README.md', 4), src);

assert.deepEqual([icons.size(), src.size(), assets.size(), project.size()], [4, 15, 52, 71]);

icons.add(new Symlink('brand.png', '../logo.png')); // a new kind of Leaf; Folder is unchanged
assert.equal(project.size(), 71);
assert.throws(() => icons.add(project), /already contains/); // no cycles
console.log(project.lines(0).join('\n'));
```

ผลลัพธ์:

```
project/ 71 KB
  assets/ 52 KB
    logo.png 48 KB
    icons/ 4 KB
      home.svg 2 KB
      user.svg 2 KB
      brand.png -> ../logo.png 0 KB
  README.md 4 KB
  src/ 15 KB
    app.ts 12 KB
    util.ts 3 KB
```

`contains()` เป็น operation แบบ recursive ตัวที่สอง และ `add()` ใช้มันปฏิเสธ node ที่มี folder นั้นอยู่ข้างในแล้ว นี่คือเหตุที่ `icons.add(project)` throw ส่วน `lines()` ถาม `size()` จากแต่ละ folder แล้วแต่ละ folder ก็รวม subtree ของตัวเองใหม่อีกรอบ สำหรับ 11 node ไม่มีปัญหาอะไร และหัวข้อเรื่อง cache ข้างล่างก็บอกว่าต้องทำยังไงกับ tree ขนาดใหญ่

## ใช้ตอนไหนดี

- hierarchy แบบส่วนย่อยกับส่วนรวม ที่ของชิ้นเดียวกับกลุ่มของมันควรถูกจัดการแบบเดียวกัน: ไฟล์กับ folder, widget กับ panel, shape กับกลุ่มของ shape ในโปรแกรมวาดรูป, section ของเอกสาร, menu item กับ submenu, ชิ้นส่วนกับชุดประกอบใน bill of materials, node ของ syntax tree
- คำถามที่ตอบได้ด้วยการรวมคำตอบของส่วนย่อย (ขนาดรวม, ราคา, น้ำหนัก, bounding box, จำนวน) และคำสั่งที่ต้องไปถึงทุกส่วน (วาด, ปิดใช้งาน, ตั้งค่า)
- node ชนิดใหม่โผล่มาเรื่อย ๆ แต่ operation ที่ใช้กับมันยังมีไม่กี่ตัว
- ไม่ใช่ตอนที่โครงสร้างไม่ได้เป็น recursive: ไฟล์ใน folder เดียวก็คือ list
- ไม่ใช่ตอนที่ leaf กับกลุ่มมีอะไรเหมือนกันน้อย แบบนั้น interface เดียวสำหรับทั้งคู่จะเต็มไปด้วย method ที่ class ครึ่งหนึ่งปฏิเสธ
- ไม่ใช่ตอนที่ชนิดของ node ตายตัวแล้ว แต่มี operation ใหม่เข้ามาตลอด แบบนั้น operation แต่ละตัวจะกลายเป็น method ในทุก class (ดู *ได้อะไร เสียอะไร*) และ union แบบปิดที่ใช้ pattern matching หรือ Visitor จะเข้ากันกว่า

## ได้อะไร เสียอะไร

- **client เรียบง่าย** report เรียก `size()` ครั้งเดียว และไม่เคยแตก branch ตาม type เลย ไฟล์เดียวกับทั้ง project ผ่านโค้ดชุดเดียวกัน
- **เพิ่มชนิดใหม่ได้ถูก แต่เพิ่ม operation ใหม่แพง** `Symlink` คือ class เดียวและไม่ต้องแก้อะไร ส่วนคำถามใหม่ เช่นจำนวนไฟล์ คือ method ใหม่ใน `Node` และใน `File`, `Folder` และ `Symlink`: การแก้แบบในขั้นที่ 1 แค่ย้ายจาก function ไปอยู่ใน class แทน ส่วน Visitor คือคำตอบแบบ object-oriented สำหรับเรื่องนี้ และ pattern matching คือคำตอบแบบ functional (ดู *ข้อควรรู้ตอนลงมือทำ*)
- **interface ที่กว้างเกินไป** เพราะ folder รับ `Node` อะไรก็ได้ ตัว type เลยแสดงกฎอย่าง "`icons/` เก็บได้แค่รูปภาพ" ไม่ได้ หนังสือเตือนว่าแพตเทิร์นนี้ทำให้การบอกข้อจำกัดแบบนี้ทำได้ยาก มันเลยกลายเป็นการเช็กตอน runtime ใน `add()`
- **ทุกคำตอบต้องเดิน subtree** `project.size()` ไปเยี่ยมทุก node ทุกครั้ง การ cache ยอดรวมไว้ทำให้ถามซ้ำได้ถูก แต่ต้องแลกกับการทำให้ cache นั้นใช้ไม่ได้ทุกครั้งที่ข้างล่างมีอะไรเปลี่ยน
- **พฤติกรรมกระจายตัว** ขนาดของทั้ง tree คือผลรวมของ method เล็ก ๆ ในหลาย class แต่ละตัวอ่านง่าย แต่การไล่หายอดรวมที่ผิดผ่าน recursion นั้นยากกว่า

## ข้อควรรู้ตอนลงมือทำ

- **กัน cycle** folder ต้องไม่มีวันไปอยู่ข้างในตัวเอง ไม่ว่าจะตรง ๆ หรือผ่าน subfolder ตัวไหน ไม่งั้นทุกการเรียกแบบ recursive จะวนจน stack หมด `Folder.add()` ข้างบนปฏิเสธ node ที่มี folder นั้นอยู่ข้างในแล้ว ตัว DOM ก็เช็กเรื่องเดียวกัน โดย `appendChild()` จะ throw `HierarchyRequestError` ถ้าลูกตัวใหม่เป็นบรรพบุรุษของ node ที่มันถูกเพิ่มเข้าไป ส่วน `Container` ของ AWT ก็ throw `IllegalArgumentException` ถ้า component ที่กำลังเพิ่มเป็นบรรพบุรุษตัวหนึ่งของมัน
- **reference ไปที่ parent** node มักต้องเอื้อมขึ้นข้างบน: เพื่อสร้าง path อย่าง `project/assets/icons/home.svg`, เพื่อส่ง request ขึ้นไปตาม tree จนกว่าจะมีตัวไหนรับไป (แบบที่ DOM event bubble ขึ้นไปหาบรรพบุรุษของ target) หรือเพื่อทำให้ cache ใช้ไม่ได้ ดีไซน์ที่ใช้กันทั่วไปคือให้ node ทุกตัวมี field `parent` ที่มีแค่ `add()` กับ `remove()` เปลี่ยนได้ ทำให้ parent กับ list ของลูกไม่มีทางขัดกัน ถ้ามี parent การเช็ก cycle ก็เดินขึ้นจาก parent ตัวใหม่แทนการค้นทั้ง subtree ได้ `parentNode` ของ DOM กับ `getParent()` ของ AWT ก็คือ reference แบบนี้
- **cache ยอดรวม แล้วทำให้ใช้ไม่ได้ไล่ขึ้นข้างบน** folder เก็บยอดรวมล่าสุดไว้ได้ แทนที่จะถามลูกทุกตัวทุกครั้ง แต่ถ้าข้างล่างมีอะไรเปลี่ยน (ไฟล์ใหญ่ขึ้น, มีลูกถูกเพิ่มหรือลบ) ก็ต้องล้างยอดรวมที่ cache ไว้ของบรรพบุรุษทุกตัว และงานนี้ต้องมี reference ไปที่ parent ส่วน AWT ก็ทำแบบนี้กับ layout: [`Component.invalidate()`](https://docs.oracle.com/en/java/javase/27/docs/api/java.desktop/java/awt/Component.html#invalidate()) mark ตัว component และโดย default ก็ mark บรรพบุรุษทุกตัวขึ้นไปจนถึง top-level container ว่า invalid แล้ว `validate()` ครั้งถัดไปก็จะจัด layout พวกมันใหม่
- **ลำดับของลูก** ยอดรวมไม่ขึ้นกับลำดับของลูก แต่อย่างอื่นอีกเยอะขึ้นกับมัน: การพิมพ์, ลำดับของ statement ใน syntax tree, ลำดับของขั้นตอนใน macro และการซ้อนกันของ widget (ใน AWT ลำดับใน list ลูกของ container คือลำดับหน้าไปหลังของ component) ถ้าลำดับสำคัญก็เก็บลูกไว้ใน list และตัดสินใจว่า `add()` จะต่อท้ายหรือแทรกที่ตำแหน่งไหน
- **tree ที่ลึกมาก** recursion ทุกชั้นกิน stack frame หนึ่งอัน file system กับ user interface ปกติไม่ลึก แต่ tree ที่ generate มาหรือ tree ที่เสียรูป เช่น folder ที่ซ้อนกันเป็นสายยาว ๆ ทำให้ stack หมดได้ แล้ว JavaScript engine ก็จะ throw `RangeError` ใน Chrome กับ Safari หรือ `InternalError` ใน Firefox ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Too_much_recursion)) สำหรับ tree ที่ลึกได้ไม่จำกัด ให้เดินด้วย stack ที่เขียนเอง: push root เข้าไป แล้ว pop node ออกมาทีละตัว บวกขนาดของมันเอง และ push ลูกของมันเข้าไป วิธีนี้ต้องมีทาง list ลูกผ่าน `Node` (สำหรับ leaf ก็เป็น list ว่าง) ถือเป็นการขยับไปทาง transparency นิดหนึ่ง
- **แชร์ leaf** ไม่มีอะไรใน `add()` ห้าม object `File` ตัวเดียวกันไม่ให้ถูกเพิ่มเข้าไปในสอง folder แบบนั้นโครงสร้างก็จะเป็น graph ไม่ใช่ tree: ยอดรวมจะนับ leaf ที่แชร์กันหนึ่งครั้งต่อ parent หนึ่งตัว และ field `parent` ตัวเดียวก็อธิบายมันไม่ได้ การแชร์อาจเป็นความตั้งใจก็ได้: Flyweight แชร์ object ที่ immutable (object หนึ่งตัวต่อ character code หนึ่งตัวใน text editor) เพื่อประหยัด memory และหนังสือบอกว่าการแชร์ขัดกับการให้ component แต่ละตัวมี reference ไปที่ parent ตัวเดียวของมัน file system ก็เจอคำถามเดียวกันกับ hard link: GNU `du` นับไฟล์ที่มี hard link หลายตัวแค่ครั้งเดียว เว้นแต่จะสั่งให้นับทุก link
- **symbolic link** `Symlink.size()` คืน 0: มันนับตัว link ไม่ได้นับไฟล์ที่ link ชี้ไป ถ้าตาม link ไปแทนก็จะนับ `logo.png` สองรอบ และ link ที่ชี้ไปหา folder บรรพบุรุษจะวนไม่รู้จบ ถ้าไม่จดไว้ว่าเคยเข้า folder ไหนไปแล้ว GNU [`du`](https://www.gnu.org/software/coreutils/manual/html_node/du-invocation.html) ไม่ตาม symbolic link โดย default ส่วน `-L` ทำให้มันตามไป
- **การสร้าง เดิน และขยาย tree**
  - [Builder](../builder/) มักสร้าง composite ออกมา เช่น เอกสาร, user interface หรือ syntax tree และการเรียก `add()` ต่อกันเป็นสายข้างบนก็คือก้าวเล็ก ๆ ไปทางนั้น
  - [Iterator](../iterator/) เดิน composite ทีละ node โดยไม่เปิด list ลูกออกมาให้เห็น ใน TypeScript ใช้ generator แบบ recursive ทำได้ คือ `*walk() { yield this; for (const c of this.children) yield* c.walk(); }` บน `Folder` และ `*walk() { yield this; }` บน leaf แล้ว `for (const n of project.walk())` ก็จะเยี่ยมทุก node
  - Visitor ย้าย operation อย่าง `size()`, `count()` และ `print()` ออกจาก class ของ node ไปไว้ใน visitor object หนึ่งตัวต่อ operation ทำให้เพิ่ม operation ใหม่ได้ถูก แต่เพิ่ม node ชนิดใหม่แพง: กลับกันกับ Composite ธรรมดา
  - [Command](../command/) ใช้ Composite ทำ macro: macro คือ command ที่ถือ command ไว้ รันพวกมันตามลำดับ และ undo ย้อนลำดับ ส่วน history ก็นับมันเป็นขั้นเดียว
- **ญาติ ๆ**
  - [Decorator](../decorator/) มีรูปแบบ recursive เหมือนกัน คือ object ที่ implement interface และถือ object ของ interface นั้น แต่มีลูกแค่ตัวเดียวพอดี decorator เพิ่มพฤติกรรมรอบการเรียกที่มันส่งต่อ ส่วน composite มีไว้รวมคำตอบของลูกหลายตัว สองตัวนี้มักใช้ด้วยกัน และหนังสือบอกว่าพอใช้ด้วยกันก็มักแชร์ base class เดียวกัน
  - Interpreter แทนประโยคของภาษาเล็ก ๆ ด้วย syntax tree (composite ที่มี operation เป็น `evaluate()`)
  - [Chain of Responsibility](../chain-of-responsibility/) มักเดินตาม reference ไปที่ parent ของ composite: request ที่ node รับมือไม่ได้จะไปที่ parent ของมัน แล้วก็ไปที่ parent ของ parent
- **กับ sum type** การเช็ก type แบบในขั้นที่ 1 ไม่ได้ผิดเสมอไป ถ้าชุดของชนิด node ปิดตายแล้ว discriminated union ที่ใช้ pattern matching ก็ทำให้สไตล์นั้นปลอดภัย เพราะ compiler จะชี้ทุก function ที่ตกหล่นชนิดที่เพิ่งเพิ่มเข้ามา: TypeScript ทำได้ด้วย [exhaustiveness checking](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking) กับ `never` ส่วน Java 21 ทำด้วย sealed interface และ [pattern matching for `switch`](https://openjdk.org/jeps/441) แบบนี้ trade-off ก็กลับด้าน: operation ใหม่คือ function ใหม่ตัวเดียว ส่วนชนิดใหม่คือการแก้หลายที่ ที่ compiler ชี้ให้ ส่วน Composite ยังเหมาะกว่า ถ้า node ชนิดใหม่มาบ่อยกว่า operation ใหม่ หรือมาจาก plug-in ที่โค้ดหลักไล่รายชื่อไม่ได้
- **เจอได้ที่ไหนบ้าง**
  - DOM: ทุก object ในเอกสารคือ [`Node`](https://developer.mozilla.org/en-US/docs/Web/API/Node) โดย element, document และ document fragment มีลูกได้ แต่ text node มีไม่ได้ และ script ก็อ่านและแก้ทั้ง tree ผ่าน `childNodes`, `parentNode` และ `appendChild()` ของ `Node`
  - AWT กับ Swing ของ Java: `Container` คือ `Component` ที่ถือ `Component` ไว้ หน้าต่าง, panel และปุ่มเลยถูกจัด layout และวาดผ่าน interface เดียวกัน
  - React: user interface คือ hierarchy ของ component ที่ render component อื่นเป็นลูกของมัน [Thinking in React](https://react.dev/learn/thinking-in-react) เริ่มด้วยการวาด hierarchy นั้น และข้อมูลก็ไหลลงตามมันจาก parent ไปหาลูก
  - compiler กับ linter: node class ทุกตัวใน module [`ast`](https://docs.python.org/3/library/ast.html) ของ Python สืบทอดจาก `ast.AST` และ `ast.NodeVisitor` ก็เดิน tree แล้วเรียก method หนึ่งตัวต่อ node แต่ละชนิด เป็น Visitor ที่ทำงานบน Composite
- **ในระดับสถาปัตยกรรม** รูปแบบเดียวกันนี้โผล่มาเมื่อ node เป็น service ตัว [Gateway Aggregation](../gateway-aggregation/) คือ composite ที่ลึกชั้นเดียว: gateway ส่ง request เดียวไปหาหลาย service แล้วรวมคำตอบของพวกมัน ส่วน analytics engine ซ้อนกันหลายชั้นกว่านั้น: Dremel ของ Google ([VLDB 2010](https://research.google/pubs/dremel-interactive-analysis-of-web-scale-datasets-2/)) รัน query บน tree ของ server โดย root server ส่ง query ลงไปผ่าน intermediate server จนถึง leaf server ที่ scan ข้อมูล และแต่ละชั้นก็รวมคำตอบจากชั้นล่าง ในระดับนั้นมีสามอย่างที่เปลี่ยนไป อย่างแรก ลูกถูกเรียกแบบขนาน แต่ละชั้นเลยใช้เวลาเท่ากับลูกที่ช้าที่สุด ไม่ใช่ผลรวมของลูกทุกตัว อย่างที่สอง ลูกอาจ fail หรือ timeout ได้ parent เลยต้องเลือกระหว่างคืน error หรือคืนคำตอบบางส่วน และอย่างที่สาม มีแค่ operation ที่ผลลัพธ์บางส่วนรวมกันได้ เช่น ผลรวม จำนวน และค่าสูงสุด ที่แบ่งแบบนี้ได้: ค่าเฉลี่ยต้องเดินทางขึ้นไปเป็นผลรวมกับจำนวน
