## ปัญหา

โปรแกรมแต่งภาพปรับแสงและใส่ filter ให้รูปขนาด 12 megapixel ตัว `ImageEditor` เก็บ state ไว้ใน field ที่เป็น private: ค่าที่ปรับ brightness, รัศมีของ blur ครั้งล่าสุด และตัว pixel เอง ที่มีอยู่ 4,000 × 3,000 จุด จุดละ 4 byte (แดง เขียว น้ำเงิน และ alpha) รวมเป็น 48 MB ผู้ใช้คาดว่ากด Ctrl+Z แล้วรูปจะกลับไปเป็นแบบเมื่อหนึ่งขั้นก่อนหน้าเป๊ะ ๆ

ทำ undo ได้สองวิธี วิธีแรกคือรัน inverse operation แบบที่ pattern [Command](../command/) ทำ: ลบ 20 เพื่อ undo *Brightness +20* วิธีนี้ใช้ได้แค่ตอนที่มี inverse แบบเป๊ะ ๆ อยู่จริง และในโปรแกรมแต่งภาพก็มักจะไม่มีด้วย ตัว blur เอาค่าเฉลี่ยของ pixel ข้าง ๆ มาแทนแต่ละ pixel ทำให้รูปที่ต่างกันมากมาย blur ออกมาได้ pixel ชุดเดียวกัน และไม่มีอะไรย้อนหาได้ว่าเราเริ่มจากรูปไหน แม้แต่ brightness ก็ย้อนกลับได้แค่เกือบ ๆ: channel ขนาด 8 bit ตันที่ 255 การ +20 เลยทำให้ pixel ที่เป็น 240 กลายเป็น 255 แล้วพอ −20 ก็ได้ 235

อีกวิธีคือเก็บสำเนาของ state ไว้ก่อนแก้แต่ละครั้ง แล้วใส่กลับคืนตอน undo วิธีนี้ต้องมีอะไรสักอย่างนอก editor คือ `History` มาถือสำเนาไว้ แต่ state เป็น private ทางแก้ที่เห็นได้ชัดก็มีปัญหาทั้งหมด:

- **field แบบ public** หรือมี getter กับ setter ให้ทุกตัว ทำให้ History คัดลอก state ได้ก็จริง แต่ก็ทำให้โค้ดอื่นเขียนมันได้ด้วย: `editor.blur = -3` หรือ pixel ชุดใหม่ที่ไม่มี brightness ที่สร้างมันขึ้นมา ตัว editor จะรับประกันกฎของตัวเองไม่ได้อีกต่อไป
- มันยังทำให้ไส้ในของ editor กลายเป็น API ด้วย พอ History อ่าน `#pixels` เป็น buffer แบน ๆ ก้อนเดียว ตัว editor ก็จะย้ายไปใช้ tile หรือ GPU texture ไม่ได้ถ้าไม่แก้ History และทุก class ที่ใช้ทางลัดเดียวกัน
- **ประตูหลัง** อย่าง `private` ของ TypeScript บวกการ cast ก็ให้ coupling แบบเดียวกัน แต่ซื่อตรงน้อยกว่า: compiler เลิกบ่น และนอกนั้นไม่มีอะไรเปลี่ยนเลย

## ทำงานยังไง

Memento ให้ object ที่เป็นเจ้าของ state คัดลอกเอง สำเนาจะออกไปแบบปิดผนึก: ใครที่เก็บมันไว้ก็เก็บและส่งคืนได้ แต่อ่านหรือแก้ของข้างในไม่ได้ มีแค่ object ที่สร้างมันขึ้นมาเท่านั้นที่เปิดมันได้อีกครั้งแล้ว restore ตัวเองจากมัน encapsulation ยังอยู่ครบ เพราะ field ที่เป็น private ไม่เคยโผล่ให้เห็นนอก class และคนเก็บก็ขึ้นกับแค่ type ของ snapshot ไม่ได้ขึ้นกับของข้างใน ตัว pattern นี้ Gamma, Helm, Johnson และ Vlissides อธิบายไว้ใน *Design Patterns* (1994) และในเล่มก็เรียกมันอีกชื่อว่า *Token*

| ส่วนประกอบ | ใน diagram | หน้าที่ |
|---|---|---|
| **Originator** | `ImageEditor` | เป็นเจ้าของ state ตัว `save()` คัดลอกสิ่งที่การ restore ต้องใช้ลงใน snapshot ตัวใหม่ ส่วน `restore(snap)` คัดลอกมันกลับ เป็น class เดียวที่อ่าน snapshot ได้ |
| **Memento** | `EditorSnapshot` | ถือ state ที่คัดลอกไว้ มันเปิดทุกอย่างให้ originator เห็น (interface แบบ *wide* ในหนังสือ) และเปิดให้คนอื่นเห็นแทบไม่มีอะไรเลย: ในที่นี้คือ label สำหรับเมนู Undo (interface แบบ *narrow*) |
| **Caretaker** | `History` | ตัดสินว่าจะ save ตอนไหนและ restore ตอนไหน เก็บ snapshot ไว้ตามลำดับ (เป็น stack สำหรับ undo) และไม่เคยดูข้างในหรือแก้ snapshot เลย |

ใน diagram แอปจะเรียก `history.backup()` ก่อนแก้แต่ละครั้ง แล้ว History ก็ขอ snapshot จาก `editor.save()` เริ่มจาก snapshot ที่ brightness 0 และ blur 0 ถูกวางลง stack แล้ว *Brightness +20* ก็ทำงาน จากนั้น snapshot ที่ brightness 20 และ blur 0 ถูกวางซ้อนข้างบน แล้ว *Blur 3* ก็ทำงาน กด Ctrl+Z ก็จะ pop snapshot ล่าสุดออกมาแล้วส่งให้ `editor.restore(snap)`: blur กลับเป็น 0 ส่วน brightness ยังเป็น 20 กด Ctrl+Z ครั้งที่สองก็จะ restore brightness 0 กลับมา การ undo ทั้งสองครั้งนี้ editor คัดลอก pixel ที่เก็บไว้กลับมา รูปเลยกลับมาเหมือนเดิมเป๊ะ โดยไม่ต้องมี inverse ของ operation ไหนเลย

หนังสือชั่งผลที่ตามมาไว้ originator ยังเรียบง่าย: มันไม่ต้องเก็บเวอร์ชันเก่าของตัวเอง หรือรู้ว่าแอปต้องการกี่เวอร์ชัน caretaker ก็ยังเป็นของกลาง ๆ: History ที่แค่ซ้อน token แล้วส่งคืน ก็เอาไปใช้กับโปรแกรมแก้ข้อความได้เหมือนกัน ต้นทุนคือการคัดลอกทุกครั้งที่ save และพื้นที่เก็บ แล้วพื้นที่เก็บก็ถูกซ่อนจาก caretaker ด้วย เพราะมันมองไม่เห็นว่า snapshot ใหญ่แค่ไหน History ที่ดูเบา ๆ อาจถือข้อมูลอยู่หลายร้อย megabyte: snapshot ของรูปนี้สิบตัวคือ 480 MB

**ทำให้ snapshot ทึบใน TypeScript** ตัว interface แบบ narrow ต้องมีวิธีซ่อน field จาก History แต่ไม่ซ่อนจาก editor

- keyword `private` ของ TypeScript ทำไม่ได้ มันถูกเช็กแค่ตอน compile: `snap['state']` ผ่าน type checker ได้ และตอน run field นั้นก็เป็น property ธรรมดาที่ `JSON.stringify`, `Object.keys` และโค้ด JavaScript ไหนก็เห็นได้ ตัว handbook เรียกแบบนี้ว่า privacy แบบ *soft*
- field แบบ `#` ของ JavaScript เป็น private แบบ *hard* ตัว engine เป็นคนบังคับ: โค้ดนอก body ของ class เอ่ยชื่อมันไม่ได้ด้วยซ้ำ (ทำแล้วเป็น syntax error) และมันไม่โผล่ใน `Object.keys` หรือ `JSON.stringify` แต่ field แบบ `#` เป็นของ class ที่ประกาศมัน ทำให้ `ImageEditor` อ่าน field `#state` ที่ประกาศใน `EditorSnapshot` ไม่ได้เหมือนกัน
- โค้ดข้างล่างเลยปล่อยให้ snapshot ว่างเปล่า มีแค่ label แล้วเอาเนื้อหาไปใส่ใน `WeakMap` ที่ถืออยู่ใน field แบบ `static #` ของ `ImageEditor` มีแค่โค้ดใน body ของ class editor เท่านั้นที่เข้าถึง map นี้ได้ และ `WeakMap` ไม่ได้ทำให้ key ของมันยังอยู่ต่อ พอ History ทิ้ง snapshot ไป เนื้อหาข้างในก็ถูก collect ไปพร้อมกันได้ `WeakMap` ที่อยู่ใน module scope และ module ไม่ได้ export ออกไปก็ใช้ได้เหมือนกัน และนี่ก็คือวิธีที่ TypeScript ใช้ implement field แบบ `#` ตอน compile เป็น ES2021 หรือเก่ากว่า
- ใน C++ หนังสือให้ originator เป็น `friend` ของ memento แล้วเก็บ interface แบบ wide ไว้เป็น private ส่วน tile engine ของ Krita ก็ทำแบบเดียวกัน: [`KisMemento`](https://github.com/KDE/krita/blob/master/libs/image/tiles3/kis_memento.h) เก็บไส้ในของตัวเองเป็น private และประกาศ `friend class KisMementoManager`

## โค้ด

TypeScript ที่ตรงกับ diagram ตัวโค้ดรันด้วย Node 22.18 ขึ้นไปได้เลย (`node editor.ts`) โดยตัด type ทิ้ง ส่วน `tsc --noEmit` ใช้เช็ก type ได้ ตรงนี้ใช้ pixel สีเทาหกจุดแทนรูปขนาด 12 megapixel

```ts
import assert from 'node:assert/strict';

type Saved = { brightness: number; blur: number; pixels: Uint8ClampedArray };
const mean = (a: Uint8ClampedArray) => a.reduce((sum, v) => sum + v, 0) / a.length;

// Memento: an opaque token. Its only public member is a label for the Undo menu.
class EditorSnapshot {
  readonly label: string;
  constructor(label: string) { this.label = label; Object.freeze(this); }
}

// Originator: owns the private state, and is the only code that can seal or unseal a snapshot.
class ImageEditor {
  static #sealed = new WeakMap<EditorSnapshot, Saved>(); // unreachable outside this class body
  #brightness = 0;
  #blur = 0;
  #pixels = Uint8ClampedArray.of(10, 10, 240, 240, 10, 10); // six grey pixels stand in for 12 MP

  brighten(n: number): void {
    this.#brightness += n;
    this.#pixels = this.#pixels.map((v) => v + n); // clamped to 0..255
  }
  blur(r: number): void { // box blur: each pixel becomes the mean of its neighbourhood
    const p = this.#pixels;
    this.#blur = r;
    this.#pixels = p.map((_, i) => mean(p.subarray(Math.max(0, i - r), i + r + 1)));
  }
  save(label: string): EditorSnapshot {
    const snap = new EditorSnapshot(label), pixels = this.#pixels.slice(); // a copy, not the buffer
    ImageEditor.#sealed.set(snap, { brightness: this.#brightness, blur: this.#blur, pixels });
    return snap;
  }
  restore(snap: EditorSnapshot): void {
    const saved = ImageEditor.#sealed.get(snap);
    if (!saved) throw new TypeError('not a snapshot taken by an ImageEditor');
    this.#brightness = saved.brightness;
    this.#blur = saved.blur;
    this.#pixels = saved.pixels.slice(); // copy again: later edits must not change the snapshot
  }
  describe(): string {
    return `brightness ${this.#brightness}, blur ${this.#blur}, pixels ${this.#pixels.join(' ')}`;
  }
}

// Caretaker: decides when to save and when to restore, and never looks inside a snapshot.
class History {
  #editor: ImageEditor;
  #stack: EditorSnapshot[] = [];
  constructor(editor: ImageEditor) { this.#editor = editor; }
  backup(label: string): void { this.#stack.push(this.#editor.save(label)); }
  undo(): void { const snap = this.#stack.pop(); if (snap) this.#editor.restore(snap); }
  get labels(): string[] { return this.#stack.map((s) => s.label); }
}

const editor = new ImageEditor();
const history = new History(editor);
const show = (want: string) => { assert.equal(editor.describe(), want); console.log(want); };

history.backup('before Brightness +20'); editor.brighten(20);
show('brightness 20, blur 0, pixels 30 30 255 255 30 30');
history.backup('before Blur 3'); editor.blur(3);
show('brightness 20, blur 3, pixels 142 120 105 105 120 142');
assert.deepEqual(history.labels, ['before Brightness +20', 'before Blur 3']);
history.undo(); show('brightness 20, blur 0, pixels 30 30 255 255 30 30');
history.undo(); show('brightness 0, blur 0, pixels 10 10 240 240 10 10');

// All that History, or any other code, can see of a snapshot is its label.
const snap = editor.save('probe');
assert.deepEqual(Object.keys(snap), ['label']);
assert.equal(JSON.stringify(snap), '{"label":"probe"}');
assert.throws(() => editor.restore(new EditorSnapshot('forged')), TypeError);
```

ผลลัพธ์:

```
brightness 20, blur 0, pixels 30 30 255 255 30 30
brightness 20, blur 3, pixels 142 120 105 105 120 142
brightness 20, blur 0, pixels 30 30 255 255 30 30
brightness 0, blur 0, pixels 10 10 240 240 10 10
```

บรรทัดที่สองคือการสูญเสียข้อมูลในขนาดย่อ ๆ ถ้ารัศมีเป็น 3 pixel สองตัวตรงกลางจะกลายเป็นค่าเฉลี่ยของทั้งหกค่า มันเลยออกมาเท่ากันไม่ว่าแถวนั้นเดิมจะเป็นยังไง: แถวที่ต่างกันจะ blur ออกมาได้ผลเดียวกัน และไม่มี function ไหน map มันกลับได้ แต่การ restore ไม่ต้องใช้ function แบบนั้นเลย

## ใช้ตอนไหนดี

- undo, redo และ panel แสดง history ที่ operation บางตัวไม่มี inverse แบบเป๊ะ ๆ: filter, การ resample, การเติมพื้นที่แบบ generate, อะไรก็ตามที่ปัดเศษ ตัดค่า หรือรวมข้อมูล
- checkpoint ระหว่างทำงาน: ลองเปลี่ยนอะไรสักอย่างแล้ว rollback ถ้า validation ไม่ผ่าน, จุด save ในเกม, ขั้นตอนของ wizard, transaction บน model ใน memory
- ทำต่อทีหลัง: ตำแหน่งของการวนลูป หรือ pagination cursor ของ API ที่ client ส่งคืนโดยไม่ดูข้างใน (ดู [Iterator](../iterator/))
- object ที่ state มีขนาดเล็กเมื่อเทียบกับแรงที่ต้องใช้เขียนและ test inverse ของทุก operation
- ให้ใช้ inverse operation แบบ [Command](../command/) ดีกว่า ถ้า state ใหญ่ และการเปลี่ยนแต่ละครั้งเล็กและย้อนกลับได้เป๊ะ อย่างในโปรแกรมแก้ข้อความ และให้ใช้ immutable data ดีกว่า ถ้าทุก state เป็นค่าอยู่แล้ว: การเก็บเวอร์ชันก่อนหน้าก็แค่เก็บ reference ไปหามัน และเวอร์ชันต่าง ๆ ก็แชร์ส่วนที่ไม่เปลี่ยนกัน (ดู *แชร์ข้อมูลที่ไม่เปลี่ยน* ข้างล่าง)

## ได้อะไร เสียอะไร

- **กิน memory** snapshot เต็ม ๆ คัดลอกทุกอย่าง และ caretaker ก็บอกไม่ได้ว่ามันใหญ่แค่ไหน: snapshot ของรูป 12 MP สิบตัวคือ 480 MB
- **เวลา** การคัดลอก 48 MB ก่อนแก้ทุกครั้งทำให้แต่ละครั้งสะดุดไปแวบหนึ่ง ให้คัดลอกแบบ lazy (copy-on-write) หรือคัดลอกแค่ส่วนที่การแก้กำลังจะเปลี่ยน
- **ทึบก็มีสองด้าน** History แสดงไม่ได้ว่า snapshot มีอะไรอยู่ข้างใน เทียบสองตัวกันไม่ได้ หรือรวมตัวเล็ก ๆ เข้าด้วยกันไม่ได้ มันมีแค่สิ่งที่ interface แบบ narrow ให้มา อย่าง label
- **อายุของ snapshot** ต้องมีอะไรสักอย่างตัดสินว่า snapshot จะหายไปตอนไหน: จำกัดจำนวนหรือขนาด, ทิ้ง branch ของ redo หลังการแก้ครั้งใหม่, ล้างทั้งหมดตอนปิดเอกสาร
- **ได้คืนมาแค่ตัว object** การ restore editor ไม่ได้ยกเลิก email ที่ส่งไปแล้ว หรือลบไฟล์ที่ export ไปแล้ว ผลกระทบที่อยู่นอก object ต้องมี compensation ของตัวเอง
- **ความเป็น private ขึ้นกับภาษา** ถ้าใช้ field แบบ `#` หรือ `WeakMap` ตัว runtime จะบังคับให้ ถ้าใช้แค่ `private` ของ TypeScript หรือใช้ภาษา dynamic ที่ไม่มี access control มันก็เป็นแค่ข้อตกลงกัน
- **สิ่งที่ได้กลับมา** คือ editor เก็บ field ของตัวเองเป็น private และเปลี่ยนได้อิสระ History ใช้กับ originator ตัวไหนก็ได้ และ undo ได้เป๊ะไม่ว่า operation จะย้อนกลับได้หรือไม่

## ข้อควรรู้ตอนลงมือทำ

- **เก็บแค่สิ่งที่ restore ต้องใช้** field ที่กำหนด state ต้องเก็บ ส่วน cache และค่าที่คำนวณมาจาก field พวกนั้น (thumbnail, histogram, pixel ที่ upload ขึ้น GPU) สร้างใหม่หลัง restore ได้ ส่วนของที่ object แค่อ้างถึง อย่าง colour profile ที่ใช้ร่วมกันหรือไฟล์ที่เปิดอยู่ ก็ให้เป็น reference ต่อไปโดยไม่ต้องคัดลอก
- **คัดลอกส่วนที่ mutable ทั้งขาเข้าและขาออก** snapshot ที่แชร์ pixel buffer กับ editor จะเปลี่ยนตามในครั้งถัดไปที่ editor blur ทับ buffer เดิม `save()` เลยคัดลอก buffer และ `restore()` ก็คัดลอกอีกรอบ การแก้ครั้งต่อ ๆ ไปจะได้เข้าไปยุ่งกับ snapshot ไม่ได้ `Object.freeze()` ปกป้อง buffer ไม่ได้: มันจะ throw `TypeError` กับ typed array ที่มี element และไม่มีผลอะไรกับ field แบบ `#` ส่วนค่าที่ immutable (ตัวเลข, string, object ที่ freeze แล้ว) แชร์ไปได้ตามที่เป็นอยู่เลย
- **เก็บแค่ส่วนที่เปลี่ยน** หนังสือสังเกตว่าถ้า snapshot ถูกเก็บและ restore ตามลำดับที่คาดเดาได้ อย่างใน undo history แต่ละตัวก็เก็บแค่การเปลี่ยนแปลงนับจากตัวก่อนหน้าได้ โปรแกรมแต่งภาพทำงานเป็น tile ส่วนหนึ่งก็เพราะเหตุผลนี้ ใน tile engine ของ Krita ตัว tile เป็นแบบ copy-on-write และ [`KisMementoManager`](https://github.com/KDE/krita/blob/master/libs/image/tiles3/kis_memento_manager.h) จะรวบรวมข้อมูล tile ที่ action หนึ่งเขียน แล้ว commit เป็น revision เดียวที่ undo ย้อนกลับได้ ทำให้ undo หนึ่งขั้นกินแค่ tile ที่ action นั้นไปแตะ ส่วน GIMP แสดงอีกด้านหนึ่งให้เห็น: มัน undo filter ส่วนใหญ่ด้วยการเก็บ[เนื้อหาทั้งหมดของ layer ที่ได้รับผล](https://docs.gimp.org/3.0/en/gimp-concepts-undo.html) ทั้งก่อนและหลัง เพราะ filter รันเป็น plug-in และตัว core บอกไม่ได้ว่าอะไรเปลี่ยนไป แค่รัน filter ไม่กี่ครั้งเลยอาจดันขั้นเก่า ๆ หลุดออกจาก undo history ได้
- **แชร์ข้อมูลที่ไม่เปลี่ยน** ถ้าใช้ copy-on-write ตัว snapshot จะแชร์พื้นที่เก็บกับ state ที่ใช้งานอยู่ และ block จะถูกคัดลอกก็ต่อเมื่อมันกำลังจะเปลี่ยนเท่านั้น [database snapshot](https://learn.microsoft.com/en-us/sql/relational-databases/databases/database-snapshots-sql-server) ของ SQL Server ได้สำเนาของแต่ละ page ไปก่อนที่ page นั้นจะถูกแก้ครั้งแรกใน database ต้นทาง และ [EBS snapshot](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-snapshots.html) เก็บแค่ block ที่เปลี่ยนไปนับจาก snapshot ก่อนหน้าของ volume นั้น ส่วน immutable data structure ใช้วิธีแชร์โครงสร้างแทน: [Immer](https://immerjs.github.io/immer/) เอาทุกส่วนที่ไม่เปลี่ยนของ state tree เก่ามาใช้ซ้ำใน tree ใหม่ การเก็บทุก state ที่ Redux store ผ่านมาเลยแทบไม่เปลืองอะไรนอกจากส่วนที่เปลี่ยนไป
- **จำกัด history** กำหนดเพดานด้วยจำนวนหรือ memory แล้วทิ้งตัวเก่าสุดก่อน GIMP มี[สอง setting](https://docs.gimp.org/3.0/en/gimp-prefs-system-resources.html): จำนวน undo level ขั้นต่ำที่มันเก็บไว้ไม่ว่าจะกินเท่าไร และ undo memory สูงสุดต่อรูป ถ้าเกินกว่านั้นมันจะลบขั้นที่เก่าที่สุด ส่วน extension Redux DevTools เก็บ [50 action โดย default](https://github.com/reduxjs/redux-devtools/blob/main/extension/docs/API/Arguments.md) (`maxAge`) แล้วลบตัวเก่าสุดหลังจากนั้น
- **snapshot ที่ออกไปนอก process** snapshot ที่เขียนลงไฟล์ save เก็บไว้กู้คืนตอน crash หรือส่งไปให้ worker จะไม่ทึบอีกต่อไป: มันกลายเป็น byte ที่ใครก็อ่านหรือแก้ได้ ให้ originator เป็นเจ้าของ format (เช่น `editor.export(snap)` และ `ImageEditor.import(bytes)`) ใส่เลขเวอร์ชันไว้ในนั้น และ validate มันตอนที่มันกลับมา เหมือนที่ทำกับ input ทั่วไป ให้ serialise อย่างตั้งใจ: ทั้ง `JSON.stringify` และ [structured cloning](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm) ที่ `structuredClone()` กับ `postMessage()` ใช้ ไม่ได้คัดลอก field แบบ `#` และ structured cloning ก็ไม่เก็บ prototype ไว้ด้วย
- **history ของ browser ก็คือ caretaker** `history.pushState(state, …)` เก็บ state object ไว้คู่กับ history entry ใหม่ และพอผู้ใช้ย้อนกลับมาที่ entry นั้น event `popstate` ก็ให้สำเนาของมันกับหน้าเว็บ หน้าเว็บเป็นคนตัดสินว่าจะใส่อะไรลงไป ส่วน browser แค่เก็บไว้แล้วส่งคืน ตัว object นั้นต้อง serialize ได้ และ browser บางตัวก็ save มันลง disk และจำกัดขนาดไว้ [MDN](https://developer.mozilla.org/en-US/docs/Web/API/History/pushState) เลยแนะนำให้ใช้ `sessionStorage` หรือ `localStorage` กับของที่ใหญ่
- **time-travel debugging** [Redux DevTools](https://redux.js.org/tutorials/essentials/part-1-overview-concepts) แสดงรายการทุก state ที่ store เคยผ่านมา และกระโดดกลับไป state ไหนก็ได้ ตัว instrument ของมันเก็บ [state ที่คำนวณแล้วหลังแต่ละ action](https://github.com/reduxjs/redux-devtools/blob/main/packages/redux-devtools-instrument/src/instrument.ts) ไว้ การกระโดดเลยแค่ย้าย pointer ไปที่ state ที่เก็บไว้ ถ้า reducer อัปเดตแบบ immutable ตัว state ที่ติดกันจะแชร์ทุกส่วนที่ไม่เปลี่ยน snapshot พวกนั้นเลยไม่เปลือง
- **ในระดับระบบ** [Event Sourcing](../event-sourcing/) เก็บการเปลี่ยนแปลงทุกครั้งเป็น event และการ replay stream ยาว ๆ ทุกครั้งที่ load ก็จะช้า ระบบเลยเก็บ snapshot ของ state ที่ fold แล้ว ณ เวอร์ชันหนึ่งไว้ แล้ว load snapshot ล่าสุดบวก event ที่ตามหลังมัน ([Fowler](https://martinfowler.com/eaaDev/EventSourcing.html)) snapshot แบบนี้ต่างจาก memento ตรงที่มันเป็นแค่ cache: event ยังเป็นบันทึกตัวจริง และ snapshot ที่หายไปก็สร้างใหม่จาก event ได้ ส่วน snapshot ของ database และ VM คือ memento ที่ platform เก็บไว้ให้ อย่าง SQL Server ก็ย้อน database กลับไปที่ database snapshot ตัวหนึ่งของมันได้ และ Hyper-V ก็[ย้อน virtual machine กลับไปที่ checkpoint](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/checkpoints) ได้ (checkpoint แบบ *standard* รวม state ของ memory ไว้ด้วย) และทั้งคู่ไม่ต้องรู้ว่าข้อมูลมีความหมายว่าอะไร แต่พวกมันไม่ใช่ backup: database snapshot ใช้ไม่ได้ถ้า database ต้นทางไม่ online และเอกสารของ Microsoft ก็บอกว่า snapshot ใช้แทน backup ปกติไม่ได้ ถ้าต้องการสำเนาที่รอดได้แม้ต้นฉบับหายไป ให้ดู [Disaster Recovery Strategies](../disaster-recovery-strategies/)
- **pattern ญาติ ๆ**
  - [Command](../command/) undo ด้วยการรัน inverse ส่วน Memento undo ด้วยการใส่สำเนากลับคืน ให้เลือกเป็นราย operation: inverse มีขนาดเล็กแต่ต้องเป๊ะ ส่วน snapshot เป๊ะแต่กิน memory ทั้งสองใช้ด้วยกันได้ดี: หนังสือแนะนำให้ command เก็บ memento ของ state ที่มันกำลังจะเปลี่ยน แล้ว restore มันใน `undo()` ของตัวเอง แบบนี้ command ที่ทำ blur ก็ undo ตัวเองได้
  - [Prototype](../prototype/) ก็คัดลอกเหมือนกัน แต่เพื่อสร้าง object ใหม่ ไม่ได้เอาไว้คืนสภาพ object ที่มีอยู่ ถ้าเป็น object ง่าย ๆ ตัว clone ที่เก็บไว้ใน stack ก็ใช้แทน memento ได้ Refactoring.Guru แนะนำวิธีนี้ถ้า object ไม่ได้ถือ link ไปหา resource ภายนอก แต่ clone เป็น object เต็มตัวที่มี public interface ใครที่ถือมันอยู่ก็เลยแก้มันได้: สำเนาไม่ได้ถูกปิดผนึกอีกต่อไป
  - [Iterator](../iterator/): หนังสือแนะนำให้ใช้ memento บันทึกว่าการวนลูปไปถึงไหนแล้ว และ cursor token แบบทึบของ API ก็ทำหน้าที่นั้นให้ client ที่ไล่ดูผลลัพธ์ทีละหน้า
  - [State](../state/) เปลี่ยนพฤติกรรมของ object ตาม state ของมัน ส่วน Memento save และ restore state ถ้า object ใช้ State ตัว memento ต้องบันทึกด้วยว่า state object ตัวไหนเป็นตัวปัจจุบัน (หรือ key ของมัน) ไม่อย่างนั้นการ restore จะได้ข้อมูลกลับมาพร้อมพฤติกรรมที่ผิด
