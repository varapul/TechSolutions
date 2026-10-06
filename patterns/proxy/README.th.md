## ปัญหา

หน้าแกลเลอรีรูปแสดง thumbnail 20 ภาพ คลิกภาพไหนก็จะเปิดภาพขนาดเต็ม: pixel 12 MB ส่วน model ที่คิดได้ตามธรรมชาติคือมี interface `Photo` ที่มี method `display()` กับ class `FullPhoto` ที่ constructor อ่านไฟล์ภาพ ตัว class นี้ง่ายและถูกต้อง พอมี `FullPhoto` แล้วก็พร้อมแสดงได้เลย

ปัญหาอยู่ที่จังหวะที่ object ถูกสร้าง ถ้าหน้าเว็บสร้าง `FullPhoto` ให้ทุก thumbnail ตอนโหลด มันก็ต้องอ่าน 20 × 12 MB = 240 MB ก่อนจะวาดหน้าได้ ทั้งที่คนเข้ามาดูส่วนใหญ่เปิดแค่ภาพเดียว และ 228 MB ในนั้นไม่เคยได้แสดง ทางแก้ที่เห็นชัด ๆ ก็แค่ย้ายปัญหาไปไว้ที่อื่น หน้าเว็บจะสร้างแต่ละภาพตอนคลิกก็ได้ แต่แล้วโค้ดทุกจุดที่แตะ `photos[i]` ก็ต้องเช็กว่ามันมีอยู่หรือยัง หรือให้ `FullPhoto` โหลด pixel แบบ lazy ก็ได้ แต่แล้วทุก method ของ class ก็ต้องเช็ก state ของตัวเอง และ class ที่เคยแค่บรรยายภาพหนึ่งภาพ ตอนนี้ก็ต้องตัดสินด้วยว่าข้อมูลของมันจะมาเมื่อไหร่

ความขัดกันแบบเดียวกันโผล่มาทุกครั้งที่มีบางอย่างต้องเกิด*รอบ ๆ* การเข้าถึง object แทนที่จะเกิดข้างในมัน: เช็กว่าคนดูมีสิทธิ์ดูภาพส่วนตัวหรือเปล่า เรียก object ที่อยู่บนอีกเครื่อง จำคำตอบที่คำนวณมาแพง ถ้าใส่ logic นี้ไว้ใน caller ทุกตัว มันก็ถูกก็อปแล้วก็ถูกลืม ถ้าใส่ไว้ใน class ตัว class ก็ต้องทำสองงาน

## ทำงานยังไง

วางตัวแทนไว้หน้า object ตัวจริง ตัวแทน implement interface เดียวกัน caller เลยแยกไม่ออกว่าตัวไหนเป็นตัวไหน และตัวแทนจะเป็นคนตัดสินว่าการเรียกแต่ละครั้งจะไปถึง object ตัวจริงเมื่อไหร่ ไปหรือไม่ไป และไปยังไง Gamma, Helm, Johnson และ Vlissides รวบรวม Proxy ไว้ใน *Design Patterns* (1994) เป็น structural pattern ที่มีอีกชื่อว่า **Surrogate** ตัวอย่างตั้งต้นของพวกเขาใกล้กับตัวอย่างนี้มาก: document editor เก็บ object ตัวแทนไว้หนึ่งตัวต่อภาพใหญ่ที่ฝังอยู่หนึ่งภาพ แล้วโหลดภาพก็ต่อเมื่อต้องวาดมันจริง ๆ ตัวแทนรู้ชื่อไฟล์และขนาดภาพอยู่แล้ว แค่นั้นก็พอจะจัด layout ของหน้าได้

| ส่วนประกอบ | ใน diagram | หน้าที่ |
|---|---|---|
| **Subject** | `Photo` | interface ที่ client ใช้ ทั้ง object ตัวจริงและ proxy implement มัน |
| **RealSubject** | `FullPhoto` | object ที่ทำงานจริง ในที่นี้มันสร้างแพง เพราะ constructor อ่าน 12 MB |
| **Proxy** | `PhotoProxy`, `ProtectedPhoto` | implement Subject, ถือ RealSubject หรือสิ่งที่ต้องใช้ในการสร้างหรือหามัน, คุมการเข้าถึงและส่งต่อการเรียก |
| **Client** | `GalleryPage` | ทำงานกับ `Photo` อย่างเดียว และไม่เคยรู้ว่าตัวเองถือ class ไหนอยู่ |

ใน diagram หน้าเว็บถือ object `PhotoProxy` 20 ตัว แต่ละตัวมีชื่อไฟล์และ field `real` ที่ยังว่าง พอเรียก `display()` ครั้งแรกบน #7 ก็จะสร้าง `FullPhoto` ขึ้นมา แล้วตัวนั้นก็อ่านไฟล์ของมัน จากนั้น proxy ก็ส่งต่อการเรียกไปให้ ครั้งที่สองเจอว่า `real` มีค่าแล้วก็ส่งต่อได้ทันที โค้ดของหน้าเว็บเหมือนใน step 1 ทุกอย่าง: เปลี่ยนแค่บรรทัดที่เติม `photos` จาก `new FullPhoto(n)` เป็น `new PhotoProxy(n)` ใน application ที่ใหญ่กว่านี้ บรรทัดนั้นอยู่ใน factory หรือ repository และหน้าเว็บไม่ต้องเปลี่ยนเลย

### proxy แบบต่าง ๆ

โครงสร้างยังเหมือนเดิม ที่เปลี่ยนคือเหตุผลที่มายืนคั่นกลาง หนังสืออธิบายไว้สี่แบบ และ caching proxy กับ logging proxy ก็เป็นแบบที่เพิ่มเข้ามาบ่อย

- **Virtual proxy** สร้าง object ที่แพงก็ต่อเมื่อต้องใช้ครั้งแรก อย่างที่ `PhotoProxy` ทำ ส่วน lazy loading ใน ORM ก็คือตัวอย่างที่เจอกันทุกวัน
- **Protection proxy** เช็กว่า caller มีสิทธิ์ทำ operation นั้นหรือเปล่าก่อนจะส่งต่อ อย่างที่ `ProtectedPhoto` ทำตอน bob เปิดภาพส่วนตัวของ ana ใน step 4
- **Remote proxy** object ในเครื่องที่เป็นตัวแทนของ object ในอีก process หรืออีกเครื่อง และแปลงการเรียก method แต่ละครั้งเป็น message ตัว gRPC client stub มี method ชุดเดียวกับ service และส่งทุกการเรียกผ่าน network หนังสือบอกว่า Coplien เรียก proxy แบบนี้ว่า *Ambassador*
- **Smart reference** ทำงานจดบันทึกบางอย่างทุกครั้งที่มีการเข้าถึง: นับ reference เพื่อให้ปล่อย object ได้เมื่อผู้ใช้คนสุดท้ายเลิกใช้ (`std::shared_ptr` ของ C++ ทำแบบนี้) โหลด persistent object ตอนที่ถูกแตะครั้งแรก หรือเช็กว่า object ถูก lock อยู่ก่อนจะให้ใครแก้มัน หนังสือยังแสดง proxy ที่ซ่อน copy-on-write ไว้ด้วย: caller แชร์สำเนาเดียวของ object ใหญ่ แล้ว proxy จะก็อปมันก็ต่อเมื่อมีคนแก้
- **Caching proxy** เก็บผลลัพธ์ของการเรียกที่แพงหรือเรียกข้ามเครื่องไว้ แล้วตอบการเรียกซ้ำเอง มันเลยต้องตัดสินว่าคำตอบหนึ่งใช้ได้นานแค่ไหน (ดูเรื่อง invalidation ได้ที่ [Cache-Aside](../cache-aside/))
- **Logging proxy** บันทึกการเรียกแต่ละครั้ง พร้อม argument และผลลัพธ์ โดยที่ทั้ง caller และ object ตัวจริงไม่รู้ตัว

### Proxy, Decorator และ Adapter

ทั้งสามตัวห่อ object หนึ่งตัวและส่งต่อการเรียกไปหามัน สิ่งที่แยกพวกมันออกจากกันคือมันทำอะไรกับ interface และใครเป็นคนให้ object ที่อยู่ข้างใน:

| | Proxy | [Decorator](../decorator/) | [Adapter](../adapter/) |
|---|---|---|---|
| Interface | ของ subject เอง | ของ object ที่ถูกห่อเอง | คนละตัว: interface ที่ caller คาดไว้ |
| object ข้างใน | ปกติ proxy สร้างหรือหาเอง หรือ factory หรือ framework ที่แจก proxy ออกไปเป็นคนทำ | คนที่ประกอบ stack เป็นคนส่งเข้ามา ส่วนใหญ่คือ client | โค้ดที่ต่อ adapter เข้าด้วยกันเป็นคนส่งเข้ามา |
| เจตนา | คุมการเข้าถึง: การเรียกจะไปถึง object ตัวจริงเมื่อไหร่ ไปหรือไม่ไป และไปที่ไหน | เพิ่มพฤติกรรม โดยซ้อน wrapper ได้ทุกลำดับ | ทำให้ class ที่มีอยู่เข้ากับ interface ที่มันไม่ได้ implement |

หนังสือยังแยก proxy ตาม reference ที่มันถือด้วย: remote proxy มีแค่ reference ทางอ้อม อย่าง host กับ address บน host นั้น ส่วน virtual proxy เริ่มจาก reference ทางอ้อม (ชื่อไฟล์) แล้วสุดท้ายก็ถือ object ตัวจริงไว้ แต่เส้นแบ่งก็ยังเบลออยู่ดี protection proxy ที่ได้รับ subject มาจากข้างนอกมีโครงสร้างเหมือน decorator ทุกอย่าง และหนังสือก็พูดไว้แบบนั้น ความต่างอยู่ที่เจตนา เพราะ proxy อาจปฏิเสธการเรียก ส่วน wrapper ที่ทำ caching จะเป็น proxy ถ้ามันเฝ้า subject ที่แพงหรืออยู่ข้ามเครื่อง และเป็น decorator ถ้ามันเป็น layer เสริมชั้นหนึ่งในหลาย ๆ ชั้น ส่วน [Facade](../facade/) ต่างออกไปอีก: มันวาง interface ใหม่ที่ง่ายกว่าไว้ครอบทั้ง subsystem แทนที่จะเป็นตัวแทนของ object ตัวเดียว

## โค้ด

TypeScript ที่ตรงกับ diagram ตัว Node 22.18 ขึ้นไปรันได้เลยตามนี้ (`node gallery.ts`) เพราะมันตัด type ทิ้ง ส่วน assertion ก็เช็กสิ่งที่ animation แสดง

```ts
import assert from 'node:assert/strict';

// Subject: the only type GalleryPage knows.
interface Photo {
  display(): string;
}

let loadedMB = 0; // full-size image data in memory: the gauge in the diagram

// RealSubject: the constructor reads the whole file, 12 MB per photo.
class FullPhoto implements Photo {
  private readonly fileName: string;

  constructor(fileName: string) {
    this.fileName = fileName;
    loadedMB += 12; // stands in for reading the 12 MB file
  }

  display(): string { return `showing ${this.fileName}`; }
}

// Virtual proxy: same interface; keeps the name, creates FullPhoto on first use.
class PhotoProxy implements Photo {
  private readonly fileName: string;
  private real?: FullPhoto;

  constructor(fileName: string) { this.fileName = fileName; }

  display(): string {
    this.real ??= new FullPhoto(this.fileName); // only the first call reads the file
    return this.real.display();
  }
}

// Protection proxy: checks the signed-in user before forwarding.
class ProtectedPhoto implements Photo {
  private readonly inner: Photo;
  private readonly owner: string;
  private readonly session: { user: string };

  constructor(inner: Photo, owner: string, session: { user: string }) {
    this.inner = inner;
    this.owner = owner;
    this.session = session;
  }

  display(): string {
    if (this.session.user !== this.owner) throw new Error(`${this.session.user} may not see it`);
    return this.inner.display();
  }
}

const names = Array.from({ length: 20 }, (_, i) => `IMG_${String(i + 1).padStart(4, '0')}.jpg`);

const eager: Photo[] = names.map((name) => new FullPhoto(name));
assert.equal(loadedMB, 240); // step 1: 20 × 12 MB before the first paint

loadedMB = 0; // the same page again, with proxies
const photos: Photo[] = names.map((name) => new PhotoProxy(name));
assert.equal(loadedMB, 0); // step 2: 20 proxies, nothing read yet

console.log(photos[6].display(), `${loadedMB} MB`); // showing IMG_0007.jpg 12 MB
console.log(photos[6].display(), `${loadedMB} MB`); // showing IMG_0007.jpg 12 MB
assert.equal(loadedMB, 12); // step 3: two opens of #7, one 12 MB read

const session = { user: 'bob' };
const privatePhoto: Photo = new ProtectedPhoto(photos[6], 'ana', session);
assert.throws(() => privatePhoto.display(), /bob may not see it/); // step 4: refused
session.user = 'ana';
console.log(privatePhoto.display()); // showing IMG_0007.jpg
```

ผลลัพธ์:

```
showing IMG_0007.jpg 12 MB
showing IMG_0007.jpg 12 MB
showing IMG_0007.jpg
```

`GalleryPage` เห็นแค่ `photos: Photo[]` ส่วน entry แต่ละตัวจะเป็น `FullPhoto`, `PhotoProxy` หรือ `ProtectedPhoto` ที่วางอยู่หน้าตัวใดตัวหนึ่ง ถูกตัดสินตรงที่เติม array ส่วน protection proxy ในที่นี้ห่อ virtual proxy ไว้: proxy ที่ทำงานต่างกันเอามารวมกันได้ แต่คนที่รวมคือโค้ดที่แจกภาพออกไป ไม่ใช่หน้าเว็บที่ใช้ภาพ

## ใช้ตอนไหนดี

- object สร้างแพงหรือเก็บไว้ใน memory แพง และหลายตัวไม่เคยถูกใช้: ภาพ, document, record ใหญ่ ๆ, connection ก็ให้สร้างแต่ละตัวตอนใช้ครั้งแรกโดยมี virtual proxy อยู่ข้างหน้า
- caller ทุกตัวต้องผ่านการเช็กสิทธิ์แบบเดียวกัน และอยากบังคับไว้ที่เดียว มากกว่าจะหวังให้ caller ทุกตัวจำได้เอง
- object ตัวจริงอยู่ในอีก process หรืออีก service และ caller ควรได้ใช้การเรียก method ธรรมดา ให้ generate remote proxy จาก service definition แทนการเขียนเอง
- การเรียกซ้ำด้วย argument เดิมมีต้นทุนสูง และคำตอบที่เก่าไปนิดหน่อยก็รับได้
- แก้ class ตัวจริงไม่ได้ (มันเป็นของ library) และแก้ caller ของมันก็ไม่ได้ แต่คุมจุดที่สร้าง instance ได้
- ไม่ใช้ถ้า object สร้างไม่แพง (`new` ธรรมดาชัดกว่า) ถ้า client ควรเป็นคนเลือกและรวมของเสริมเอง (ใช้ [Decorator](../decorator/)) ถ้า interface ต่างกัน (ใช้ [Adapter](../adapter/)) หรือถ้าต้องการให้ lazy แค่ field เดียว: lazy property ใน class อย่าง `??=` ตอนใช้ครั้งแรก, `by lazy` ของ Kotlin หรือ `Lazy<T>` ของ .NET ทำเรื่องนี้ได้โดยไม่ต้องมีพิธีรีตองเยอะ

## ได้อะไร เสียอะไร

- **ต้นทุนแค่ย้ายที่ ไม่ได้หายไป** ตอน start-up ลดจาก 240 MB เหลือ 0 MB แต่การเปิดภาพครั้งแรกตอนนี้ต้องรอ 12 MB ของมัน ถ้าการรอนี้เห็นได้ชัด ก็ให้ prefetch ภาพที่น่าจะถูกเปิดต่อไป อย่างภาพถัดไปใน slideshow
- **การเรียกที่ดูไม่แพงอาจแพง หรือ fail ในแบบใหม่ ๆ** ตอนนี้ `display()` อาจอ่านไฟล์หรือวิ่งข้าม network มันเลยอาจช้า throw I/O error หรือ timeout ได้ ตัว remote proxy ทำให้ network call ดูเหมือนการเรียกในเครื่อง และนั่นแหละที่ทำให้มันถูกเรียกใน loop ได้ง่าย
- **identity เปลี่ยนไป** proxy เป็นคนละ object กับ subject ของมัน การเทียบ equality, `instanceof` และการ lookup ใน map เลยเห็น proxy แทน (ดู *ข้อควรรู้ตอนลงมือทำ*)
- **มีอีก class ที่ต้องแก้ตามให้ทัน** ทุก method ที่เพิ่มเข้าไปใน `Photo` ต้องเพิ่มลงใน proxy ที่เขียนเองทุกตัวด้วย ทำให้ interface ที่กว้างมักใช้ proxy จากโค้ดที่ generate: dynamic proxy, gRPC stub, ORM proxy
- **ส่วนที่ได้คืนมา** client กับ class ตัวจริงไม่ต้องเปลี่ยน ส่วน policy การเข้าถึงก็อยู่ที่เดียว และ object ที่แพงจะมีอยู่ก็ต่อเมื่อถูกใช้แล้วเท่านั้น

## ข้อควรรู้ตอนลงมือทำ

- **ใครเป็นคนสร้าง proxy** ไม่ใช่ client แต่เป็น factory, repository, dependency-injection container หรือ framework ที่แจก proxy ออกไป ทำให้ client ยังเขียนโค้ดกับ Subject ต่อไปได้ ปกติ proxy ก็ได้มาดูแลอายุของ subject ด้วยวิธีนี้แหละ ส่วน object ข้างในของ decorator มาจากใครก็ตามที่ประกอบ stack
- **ตอบคำถามที่ไม่แพงได้ โดยไม่ต้องใช้ object ตัวจริง** proxy เก็บ metadata ไว้แล้วตอบเองได้ อย่างที่ image proxy ในหนังสือบอกขนาดภาพสำหรับจัด layout ส่วน `PhotoProxy` ก็ตอบเรื่องชื่อไฟล์ ขนาดภาพ หรือ thumbnail ได้ แล้วค่อยสร้าง `FullPhoto` สำหรับ `display()` เท่านั้น
- **lazy creation กับ concurrency** `this.real ??= new FullPhoto(...)` ปลอดภัยใน JavaScript ก็เพราะมันรันแบบ synchronous เท่านั้น พอการโหลดเป็น asynchronous คลิกสองครั้งที่มาพร้อมกันก็อาจเจอ `real` ว่างทั้งคู่ แล้วเริ่มอ่าน 12 MB สองรอบ ให้เก็บ promise ของการโหลดแทนผลลัพธ์ของมัน caller ตัวที่สองจะได้ await promise ตัวเดียวกัน นี่คือ race แบบเดียวกับกับดักเรื่อง async ใน [Singleton](../singleton/) ใน runtime ที่มีหลาย thread สอง thread ก็แย่งกันได้แบบเดียวกัน ใน Java ให้ครอบการเช็กด้วย `synchronized` หรือใช้ double-checked locking กับ field ที่เป็น `volatile` ส่วน [`Lazy<T>`](https://learn.microsoft.com/en-us/dotnet/api/system.lazy-1) ของ .NET เป็น thread-safe โดย default และ [`by lazy`](https://kotlinlang.org/docs/delegated-properties.html#lazy-properties) ของ Kotlin ก็ synchronized โดย default ส่วน object ตัวจริงก็ยังต้องแชร์ได้อย่างปลอดภัยหลังจากถูกสร้างแล้วด้วย
- **identity กับ equality** proxy ไม่มีวัน `===` subject ของมัน: `photos[6] instanceof FullPhoto` เป็น false และ `Map` ที่ใช้ `FullPhoto` ตัวจริงเป็น key จะหาอะไรไม่เจอถ้าได้ proxy มา ให้เทียบภาพด้วย ID ไม่ใช่ด้วย reference ส่วน proxy ที่ generate ขึ้นมาก็เป็นแบบเดียวกัน:
  - MDN ชี้ว่า `Proxy` ของ JavaScript เป็น object แยกที่มี identity ของตัวเอง และ Vue ก็เขียนไว้ใน documentation ว่า proxy ที่ [`reactive()`](https://vuejs.org/guide/essentials/reactivity-fundamentals.html) คืนมาไม่เท่ากับ object ต้นฉบับ
  - dynamic proxy ของ Java ส่ง `equals`, `hashCode` และ `toString` ไปให้ invocation handler ด้วย handler เลยเป็นคนตัดสินว่า equality หมายถึงอะไร
  - guide ของ Hibernate เตือนว่า `equals()` ต้องรับมือได้ถ้าถูกส่ง proxy เข้ามา และ `instanceof` กับการ cast ทำงานไม่ถูกต้องกับ proxy ของ polymorphic association
- **พฤติกรรมที่รั่วออกมา** lazy loading ซ่อนว่างานเกิดขึ้นเมื่อไหร่ เลยเผลอไปเรียกมันใน loop ได้ง่าย ลอง list ภาพ 20 ภาพแล้วอ่าน `photo.album.title` ทีละภาพ โดยที่ `album` เป็น ORM proxy แบบ lazy หน้าเว็บก็จะรัน query หนึ่งครั้งสำหรับ list และอีกหนึ่งครั้งต่อภาพ รวม 21 ครั้ง นี่คือปัญหา *N+1 selects* ที่ guide ของ Hibernate บอกว่าเป็นเหตุผลที่พบบ่อยที่สุดที่ทำให้โค้ด data access ใน Java ช้า ให้ map association เป็น lazy แต่ fetch สิ่งที่หน้าจอต้องใช้ไว้ก่อนด้วย join fetch หรือด้วย batch fetching หรือ subselect fetching เรื่องอายุของ object ก็รั่วได้: Hibernate proxy ที่ถูกแตะครั้งแรกหลัง session ปิดไปแล้วจะ throw `LazyInitializationException`
- **function ใช้น้อยกว่านั้น** ถ้า subject เป็น function ตัวเดียว higher-order function ก็คือ proxy ทั้งตัว: wrapper ที่ทำ memoize คือ caching proxy และ wrapper ที่เช็กสิทธิ์ก่อนเรียกต่อคือ protection proxy ส่วน `import()` แบบ dynamic ทำกับ module ของโค้ด แบบที่ virtual proxy ทำกับ object: โหลดมันตอนที่ต้องใช้ครั้งแรก
- **การเรียกจากข้างในไม่ผ่าน proxy** proxy เห็นแค่การเรียกที่ผ่านตัวมัน ใน Spring AOP ถ้า method ของ target เรียก method อื่นบน `this` การเรียกนั้นจะข้าม proxy ไป ทำให้ advice บน method ที่สอง อย่างเช่น transaction ไม่ทำงาน
- **สิ่งที่ภาษาและ framework มีให้**
  - JavaScript: [`Proxy`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) ห่อ object ไหนก็ได้ด้วย handler ที่มี trap (`get`, `set`, `apply`, `has` และอื่น ๆ) คอยดักการทำงานพื้นฐานของมัน ปกติก็ส่งต่อด้วย `Reflect` ส่วน method ที่รันโดยมี proxy เป็น `this` จะเข้าถึง `#fields` ที่เป็น private ของ target หรือ internal slot ของ built-in ไม่ได้: `new Proxy(new Map(), {}).size` จะ throw `TypeError` ยกเว้น handler จะเรียก method นั้นบน target เอง
  - Java: [`java.lang.reflect.Proxy`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/lang/reflect/Proxy.html) ที่มีมาตั้งแต่ Java 1.3 สร้าง class ตอน runtime ที่ implement รายการ interface ที่ให้ไป แล้วส่งทุกการเรียกไปที่ `InvocationHandler` มันทำ proxy ให้ interface ได้ แต่ทำให้ class ไม่ได้
  - Spring: [Spring AOP](https://docs.spring.io/spring-framework/reference/core/aop/proxying.html) ใช้ JDK dynamic proxy พวกนั้นถ้า target implement interface อย่างน้อยหนึ่งตัว และ generate subclass ด้วย CGLIB ถ้าไม่มี ส่วน Spring Boot อาจตั้งให้ proxy แบบอิง class เป็น default และตั้งแต่ Spring Framework 7.0 annotation `@Proxyable` ก็เลือกแบบของ proxy ให้ bean แต่ละตัวได้
  - ORM: `getReference()` ของ Hibernate คืน proxy ที่ยังไม่ได้ fetch และ lazy association ก็คือ proxy ที่โหลดตอนใช้ครั้งแรก ส่วน [lazy-loading proxies](https://learn.microsoft.com/en-us/ef/core/querying/related-data/lazy) ของ EF Core (`UseLazyLoadingProxies()` จาก package `Microsoft.EntityFrameworkCore.Proxies`) ใช้ได้กับ navigation property ที่ override ได้ แปลว่าต้องเป็นตัวที่เป็น `virtual` บน class ที่ inherit ได้
  - gRPC: [client stub](https://grpc.io/docs/what-is-grpc/introduction/) ที่ generate ขึ้นมาคือ remote proxy ที่มี method ของ service
  - Python: [`weakref.proxy`](https://docs.python.org/3/library/weakref.html#weakref.proxy) เป็น smart reference ที่ไม่ได้ทำให้ object ของมันยังมีชีวิตอยู่ ถ้าใช้มันหลังจาก object ถูก collect ไปแล้วจะ raise `ReferenceError`
- **ที่ระดับ architecture** proxy ย้ายออกจาก process ไปอยู่หน้า network endpoint ตัว [Ambassador](../ambassador/) คือ remote proxy ที่รันอยู่ข้าง client และเพิ่ม retry, TLS และ routing ให้การเรียกขาออกของ client ส่วน [API Gateway](../api-gateway/) คือ reverse proxy ที่อยู่หน้า service หลายตัว คอย authenticate, rate-limit และ route เป็น protection proxy ของทั้ง API ส่วน [CDN](../cdn-edge-caching/) คือ caching proxy ของ HTTP และ [Service Mesh](../service-mesh/) วาง proxy แบบ [sidecar](../sidecar/) ไว้ข้าง service ทุกตัว แนวคิดนี้ยกไปใช้ได้ เพราะ client ยังเรียก address เดิมด้วย protocol เดิม แต่ตอนนี้ interface เป็น protocol แทนที่จะเป็น method signature แล้วทุกการเรียกก็ต้องจ่ายค่าข้าม network หนึ่งทอด และ proxy ก็เป็น process ที่ต้อง deploy, scale และ monitor โดยตั้งค่าเอาแทนการเขียนโค้ด
