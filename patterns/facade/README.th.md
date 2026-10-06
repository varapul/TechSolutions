## ปัญหา

การอัปโหลดรูปใน web application ต้องใช้ห้า class ตัว `MimeSniffer` ดูว่าไฟล์เป็น type อะไร ส่วน `Resizer` ทำภาพแต่ละขนาด ตัว `Optimizer` บีบอัดแต่ละภาพ ตัว `ObjectStore` เก็บภาพแล้วคืน URL ของมันมา ส่วน `CdnPurger` ล้าง path ที่ cache ไว้ เพื่อให้ CDN เสิร์ฟไฟล์ใหม่ แต่ละ class เล็กและทำงานเดียวได้ดี แต่ใครที่จะอัปโหลดรูปก็ต้องรู้จักทั้งห้าตัว เรียกให้ถูกลำดับ (ตรวจ type ก่อนย่อภาพ เก็บก่อน purge) ใส่ option ให้ถูก แล้วรวบรวมผลลัพธ์เอง

ถ้า caller ทุกตัวทำเรื่องนี้เอง ความรู้ชุดนี้ก็ถูกก็อปไปอยู่ใน caller ทุกตัว ดูอย่าง `ProfilePhotoController` กับ `ProductImageController` ต่างก็มีการเรียก 11 ครั้งชุดเดียวกัน และรายการขนาดภาพชุดเดียวกัน การเพิ่มขนาดใหม่ 2,000 px การเปลี่ยนไปใช้ WebP หรือการเปลี่ยน CDN เลยหมายถึงต้องแก้แบบเดียวกันทั้งสองที่ ถ้ามี caller ตัวที่สามก็คือก็อปชุดที่สาม controller แต่ละตัวยังผูกอยู่กับทั้งห้า class ด้วย: subsystem จะเปลี่ยนอะไรก็ต้องแก้ controller ไปด้วย และ test ของ controller ทุกตัวก็ต้อง mock collaborator ห้าตัว พร้อมลำดับการเรียกของพวกมัน

## ทำงานยังไง

Gamma, Helm, Johnson และ Vlissides อธิบาย Facade ไว้ใน *Design Patterns* (1994) ว่าเป็น structural pattern: วาง interface ระดับสูงขึ้นมาหนึ่งตัวไว้หน้า class หลาย ๆ ตัวของ subsystem งานที่ทำกันบ่อยจะได้กลายเป็นการเรียกครั้งเดียว และ caller ก็พึ่งแค่ class เดียว ไม่ต้องพึ่งทุกตัว

- **Facade** (`ImageUploader`) รู้ว่า class ไหนจัดการ request ส่วนไหน และต้องเรียงลำดับยังไง แล้ว delegate งานไปให้พวกมัน มันอาจแปลงระหว่าง interface ของตัวเองกับของพวกมันด้วยก็ได้ (ในที่นี้มันสร้าง key สำหรับเก็บไฟล์และ path ที่จะ purge จากชื่อไฟล์) แต่งานจริงยังอยู่ใน subsystem
- **Subsystem class** (`MimeSniffer`, `Resizer`, `Optimizer`, `ObjectStore`, `CdnPurger`) เป็นคนทำงานนั้น พวกมันมอง facade เป็น caller ธรรมดาตัวหนึ่ง และไม่ได้ถือ reference ไปหามัน
- **Client** (controller สองตัว) เรียก facade ถ้า client ตัวไหนต้องการสิ่งที่ facade ไม่มีให้ ก็ยังใช้ subsystem class ได้ตรง ๆ ในหนังสือนับข้อนี้เป็นข้อดี เพราะ caller แต่ละตัวเลือกได้ว่าจะเอาความสะดวกหรือจะคุมเองทั้งหมด

dependency ชี้ไปทางเดียว: client รู้จัก facade, facade รู้จัก subsystem ส่วน subsystem ไม่รู้จักทั้งสองฝั่ง ทำให้ subsystem ยัง reuse แยกเดี่ยว ๆ ได้ และจะเขียน facade ใหม่หรือเปลี่ยนเป็นตัวอื่นก็ได้โดยไม่ต้องแตะ subsystem

ส่วนว่าอะไรข้างหลัง facade ยังเข้าถึงได้บ้าง เป็นอีกเรื่องที่ต้องตัดสินแยกกัน หนังสือแยก class ที่เป็น public ของ subsystem ออกจากตัวที่เป็น private และบอกว่าภาษา object-oriented ในยุคนั้นมีไม่กี่ภาษาที่บังคับความต่างนี้ได้ ตอนนี้ module system ทำได้แล้ว: Java module จะ export แค่ package ที่มันระบุชื่อ ส่วน package อื่น module อื่นเข้าถึงไม่ได้ ([JEP 261](https://openjdk.org/jeps/261)) ส่วน Node.js package ที่มี field `exports` ก็จะไม่ยอมให้ import path ที่ไม่ได้อยู่ในรายการ ([package entry points](https://nodejs.org/api/packages.html#package-entry-points)) แต่ถ้าใช้ absolute file path ก็ยังผ่านไปได้ ใน [modular monolith](../modular-monolith/) ตัว public API ของแต่ละ module ก็คือ facade แบบนี้เป๊ะ ๆ และมีการเช็กตอน build คอยกันไม่ให้ module อื่นข้ามมันไปเรียกข้างใน

facade ยังเป็นทางเข้าให้แต่ละ layer ด้วย: หนังสือแนะนำให้มี facade หนึ่งตัวต่อหนึ่งชั้นของ subsystem ที่แบ่งเป็น layer แต่ละชั้นจะได้คุยกับชั้นถัดไปผ่านหน้าสัมผัสเล็ก ๆ ([Layered Architecture](../layered-architecture/)) Service Layer ของ Martin Fowler คือเวอร์ชันระดับทั้ง application: ชุด operation ชุดเดียวที่ทุก interface ของ application ใช้ร่วมกัน (user interface, integration gateway, data loader) แต่ละ operation ประสานงานการตอบ request หนึ่งตัว ถ้า business rule อยู่ใน domain model ตัว service layer ก็บางได้แล้วแค่ delegate ต่อ ตอนนั้นมันก็คือ facade ที่ครอบ domain ไว้ บทความ [Anemic Domain Model](https://martinfowler.com/bliki/AnemicDomainModel.html) ของ Fowler ยกคำพูดของ Eric Evans ที่อธิบาย application layer แบบบาง ๆ นี้ไว้

## โค้ด

TypeScript ที่ Node.js 22.18 ขึ้นไปรันได้เลยตามนี้ (`node facade.ts`: ตั้งแต่ release นั้น type stripping เปิดเป็น default) subsystem class ทุกตัวจะต่อท้ายการเรียกของตัวเองลงใน log ที่ใช้ร่วมกันอันเดียว assert ตอนท้ายเลยเช็กลำดับการเรียกที่อยู่เบื้องหลัง `upload()` หนึ่งครั้งได้เป๊ะ ๆ

```ts
import assert from 'node:assert/strict';

type Image = { file: string; width: number };
const CDN = 'https://cdn.example.com/';
const log: string[] = [];                  // every subsystem call, in order

// The subsystem: five small classes, one job each. None of them knows the facade.
class MimeSniffer {
  detect(file: string): string { log.push(`detect ${file}`); return 'image/jpeg'; }
}
class Resizer {
  resize(file: string, w: number): Image { log.push(`resize ${w}`); return { file, width: w }; }
}
class Optimizer {
  compress(img: Image): Image { log.push(`compress ${img.width}`); return img; }
}
class ObjectStore {
  put(key: string, img: Image): string { log.push(`put ${key}`); return CDN + key; }
}
class CdnPurger {
  purge(path: string): void { log.push(`purge ${path}`); }
}

// The facade: owns the sequence and the sizes; the real work stays in the subsystem.
class ImageUploader {
  static readonly WIDTHS = [150, 600, 1200];
  private readonly sniffer = new MimeSniffer();
  private readonly resizer = new Resizer();
  private readonly optimizer = new Optimizer();
  private readonly store = new ObjectStore();
  private readonly cdn = new CdnPurger();

  upload(file: string): string[] {
    const type = this.sniffer.detect(file);
    if (!type.startsWith('image/')) throw new Error(`${file} is not an image`);
    const name = file.replace(/\.[^.]+$/, '');                    // 'cat.jpg' -> 'cat'
    const sized = ImageUploader.WIDTHS.map((w) => this.resizer.resize(file, w));
    const small = sized.map((img) => this.optimizer.compress(img));
    const urls = small.map((img) => this.store.put(`img/${name}/${img.width}.jpg`, img));
    this.cdn.purge(`/img/${name}/*`);
    return urls;
  }
}

// ProfilePhotoController and ProductImageController each make just this one call.
const urls = new ImageUploader().upload('cat.jpg');
console.log(urls.join('\n'));
console.log(`${log.length} subsystem calls for 1 facade call`);
// https://cdn.example.com/img/cat/150.jpg
// https://cdn.example.com/img/cat/600.jpg
// https://cdn.example.com/img/cat/1200.jpg
// 11 subsystem calls for 1 facade call

assert.deepEqual(log, [
  'detect cat.jpg', 'resize 150', 'resize 600', 'resize 1200',
  'compress 150', 'compress 600', 'compress 1200',
  'put img/cat/150.jpg', 'put img/cat/600.jpg', 'put img/cat/1200.jpg',
  'purge /img/cat/*',
]);
assert.equal(log.length, 1 + 3 + 3 + 3 + 1);
```

test facade สองระดับ ใน test ของ controller ให้แทน `ImageUploader` ด้วย stub ที่ `upload()` คืน URL สามตัว: ของปลอมตัวเดียวแทน mock ห้าตัวกับลำดับของมัน ส่วน test ของ facade เองให้รันกับ subsystem ตัวจริง หรือกับตัวแทนบนเครื่องของ object store และ CDN แล้วเช็กสิ่งที่ assert ข้างบนเช็ก: ลำดับการเรียก, ขนาดภาพ, key และ path ที่ purge ตรงนี้คือที่ที่ bug ด้านการประสานงานอยู่ และถ้า mock subsystem class ทุกตัวในที่นี้ ก็แค่เขียน implementation ซ้ำอีกรอบ

## ใช้ตอนไหนดี

- subsystem ที่มีหลาย class ทำงานร่วมกัน และมีงานที่ทำกันบ่อยไม่กี่อย่างที่ caller ทุกตัวจะต้องเขียนลำดับแบบเดียวกัน: อัปโหลด media, checkout ตะกร้าสินค้า, ส่ง notification ผ่าน template engine, mail client และ delivery log
- อยากให้ module, package หรือ layer มีทางเข้า public เล็ก ๆ แล้วเก็บส่วนที่เหลือไว้ข้างใน
- อยากกันไม่ให้ caller โดนผลกระทบจาก subsystem ที่คาดว่าจะเปลี่ยน: เปลี่ยน image library หรือ CDN ที่อยู่หลัง facade ไป controller ก็ไม่รู้ตัว
- อยากวาง method ไม่กี่ตัวที่ตรงกับงาน ไว้หน้า SDK ใหญ่ของ third party ที่เราใช้แค่ส่วนเล็ก ๆ

ข้ามไปได้ถ้า:

- มีอยู่ class เดียว และ interface ของมันก็ใช้ง่ายอยู่แล้ว facade ที่ครอบมันไว้ก็แค่เพิ่มทางผ่านอีกชั้น
- caller ต้องใช้ operation ของ subsystem ในหลายแบบผสมกันมาก facade ที่ลอกทุก method มาก็ไม่ได้ทำอะไรให้ง่ายขึ้นเลย
- สิ่งที่ต้องการคือพฤติกรรมเพิ่มรอบ ๆ การเรียก ([Decorator](../decorator/)) หรือทำให้ class เข้ากับ interface ที่ caller คาดไว้อยู่แล้ว ([Adapter](../adapter/))

## ได้อะไร เสียอะไร

- **ความสะดวกกับการคุมเอง** facade รองรับกรณีทั่วไป caller ที่ต้องการอะไรแปลก ๆ ก็อ้อมมันไป อย่างที่ `CdnAdminTool` ทำใน diagram หรือไม่ก็ได้ facade ตัวที่สองไป ถ้าใส่ option พิเศษทุกอย่างลงใน facade ตัวแรก มันก็จะซับซ้อนพอ ๆ กับสิ่งที่มันซ่อนไว้
- **god object** facade ดึงโค้ดเข้าหาตัว: คิดเงินค่าอัปโหลด ส่ง email เมื่อรูปเปลี่ยน เช็ก moderation พอเพิ่มทีละอย่างก็สะดวกดี แล้วไม่นาน class เดียวก็รู้ทุกส่วนของ application และทุกทีมก็มาแก้มัน ให้ facade ทำแค่ประสานงาน ส่วน rule ควรอยู่ใน subsystem หรือ domain
- **เรียกครั้งเดียวอาจซ่อนงานไว้เยอะ** `upload()` อ่านแล้วเหมือน operation เดียว แต่มันเรียก 11 ครั้ง ถ้าอยู่ใน process เดียวกันก็ไม่แพง แต่พอ class ข้างหลังกลายเป็น remote service มันก็คือ network call 11 ครั้ง พร้อม latency และ partial failure ของมัน ชื่อ method ไม่ได้บอกเรื่องนี้ เลยต้องวัดและเขียนไว้ว่ามันมีต้นทุนเท่าไร
- **มีอีก interface ที่ต้องตามให้ทัน** พอ subsystem มีความสามารถใหม่ caller ก็ต้องรอให้ facade เปิดมันออกมา หรือไม่ก็อ้อม facade ไป อ้อมบ้างนาน ๆ ครั้งไม่เป็นไร แต่ถ้า caller จำนวนมากอ้อม facade แปลว่า interface ของมันผิด

## ข้อควรรู้ตอนลงมือทำ

- **ทำให้บางเข้าไว้** facade เรียงลำดับการเรียก แปลง argument และ map ผลลัพธ์ การ validate ที่ subsystem class รับไปทำเองได้ business rule และ state ควรอยู่ที่อื่น facade ที่เต็มไปด้วยการตัดสินเรื่องราคาหรือสิทธิ์ ได้กลายเป็น application service ที่มี rule ของตัวเองไปแล้ว
- **หลาย facade ต่อหนึ่ง subsystem** facade หนึ่งตัวต่อหนึ่งกลุ่มผู้ใช้หรือหนึ่งกลุ่มงาน ช่วยให้แต่ละตัวเล็ก: `ImageUploader` สำหรับ flow อัปโหลด, facade `ImageMaintenance` สำหรับ re-encode และ purge, `VideoUploader` ที่ reuse `ObjectStore` กับ `CdnPurger` แล้ว facade ก็เรียกกันเองได้ refactoring.guru เรียกตัวที่เพิ่มมาว่า *additional facades* หนังสือบอกว่าปกติ facade *object* ตัวเดียวต่อหนึ่ง subsystem ก็พอ facade เลยมักเป็น singleton ส่วน instance ตัวเดียวที่ใช้ร่วมกันและลงทะเบียนไว้ใน dependency-injection container ก็ได้ผลเหมือนกันโดยไม่ต้องมี global state (ดู [Singleton](../singleton/))
- **แยก facade ที่โตขึ้นเรื่อย ๆ** สัญญาณคือ: มี method ของ feature ที่ไม่เกี่ยวกัน มี field ของครึ่ง application และทุกการเปลี่ยนแปลงกับทุกทีมต้องผ่าน class เดียว ให้จัดกลุ่ม method ตาม caller หรือความสามารถที่มันรับใช้ ย้ายแต่ละกลุ่มไปเป็น facade ของตัวเอง แล้วดัน rule ที่มันสะสมไว้ลงไปที่ class ที่เป็นเจ้าของข้อมูล caller แต่ละตัวก็จะพึ่งแค่ facade ตัวเล็กที่มันใช้
- **inject subsystem เข้ามา** ส่ง object ทั้งห้าเข้ามาทาง constructor (ตัวอย่างสร้างมันเองแค่เพื่อให้สั้น) test จะได้ส่งตัวแทนให้ facade ได้ และ implementation อื่น อย่างเช่น object store ตัวอื่น ก็ไม่ต้องแก้ facade เลย หนังสือนับข้อนี้เป็นหนึ่งในสองวิธีที่ลด coupling ลงได้อีก อีกวิธีคือ abstract facade ที่มี concrete subclass หนึ่งตัวต่อ implementation ของ subsystem หนึ่งแบบ
- **facade เดียว หลาย implementation** SLF4J หรือ Simple Logging Facade for Java คือ logging API ตัวเดียวที่อยู่หน้า framework ตัวไหนก็ได้ที่ deploy ไว้: Logback implement มันมาในตัว ส่วน reload4j หรือ `java.util.logging` เสียบเข้ามาผ่าน provider module ตัว SLF4J 2.0 หา provider ด้วย `ServiceLoader` ของ Java ถ้าไม่มีสักตัวใน class path มันจะพิมพ์ warning แล้วถอยไปใช้ no-op logger ที่ทิ้งทุกการเรียก Apache Commons Logging ก็ทำหน้าที่เดียวกัน และเรียกตัวเองว่าสะพานบาง ๆ ระหว่าง logging implementation ต่าง ๆ library จะ log ผ่าน facade แล้ว application ก็เลือก framework ตอน deploy
- **first-class function กับ module** ในภาษาที่มีของพวกนี้ facade มักไม่ได้เป็น class เลย: module ที่ export function `uploadImage(file)` ตัวเดียว แล้วไม่ export helper ทั้งห้าตัว ก็คือ pattern เดียวกัน

**Facade กับเพื่อนบ้านของมัน** มีหลาย pattern ที่วาง object ไว้ระหว่าง caller กับ object อื่น สิ่งที่ต่างคือ interface ที่มันให้ และมันมีไว้ทำอะไร:

| Pattern | interface ที่ให้ | มีไว้ทำอะไร |
|---|---|---|
| Facade | ตัวใหม่ที่ง่ายกว่า ครอบหลาย object | ทำให้ subsystem ใช้ง่าย โดยไม่เพิ่ม feature ใหม่ |
| [Adapter](../adapter/) | ตัวที่ caller คาดไว้อยู่แล้ว | ทำให้ class ที่มีอยู่ตัวหนึ่งเข้ากันได้ |
| [Decorator](../decorator/) | ตัวเดียวกับ object ที่มันห่อ | เพิ่มพฤติกรรมตอน runtime |
| [Proxy](../proxy/) | ตัวเดียวกับ subject ของมัน | คุมการเข้าถึง: สร้างแบบ lazy, เรียกข้ามเครื่อง, เช็กสิทธิ์ |
| Mediator | ตัวที่ colleague เรียกมัน และมันก็เรียก colleague | ประสานการโต้ตอบระหว่างตัวที่อยู่ระดับเดียวกัน |

หนังสือขีดเส้นแบ่งเองไว้สองเส้น facade กำหนด interface ใหม่ ส่วน adapter ใช้ interface ที่มีอยู่แล้ว และ colleague ของ mediator รู้จักมันแล้วสื่อสารกันผ่านมัน ตัว mediator เองก็มักมีพฤติกรรมที่ไม่ได้เป็นของ colleague ตัวไหน ส่วน facade แค่ทำให้ subsystem ใช้ง่ายขึ้น และ class ของ subsystem ก็ไม่รู้ด้วยซ้ำว่ามี facade อยู่ Abstract Factory ทำงานคู่กับ facade ได้ โดยสร้าง object ของ subsystem โดยไม่ต้องระบุ concrete class หรือใช้แทน facade ไปเลย ถ้าเป้าหมายมีแค่ซ่อน class ที่ผูกกับ platform

**ญาติระดับ architecture** ท่าเดียวกันนี้ใช้ได้ระหว่าง service ด้วย โดยที่ทุกการเรียกต้องข้าม network:

- [API Gateway](../api-gateway/) คือทางเข้าเดียวที่อยู่หน้า service หลายตัว คู่มือ .NET microservices ของ Microsoft เทียบมันกับ Facade pattern ที่เอามาใช้กับ distributed system และเตือนว่า gateway ตัวเดียวที่รับทุก client app จะบวมจนกลายเป็น monolith ในตัวมันเอง เลยแนะนำให้แยก gateway ตามประเภท client และตาม business boundary
- [Gateway Aggregation](../gateway-aggregation/) คือ step 3 ของ diagram ที่ทำข้าม network: request หนึ่งตัวจาก client กลายเป็นการเรียก service หลายครั้ง แล้วเอาคำตอบมารวมกัน คำแนะนำของ Azure ให้ย้าย aggregation ที่ต้องใช้ domain logic จริง ๆ ไปไว้ใน service เฉพาะที่อยู่หลัง gateway ก็คือกฎ "ทำให้บางเข้าไว้" ข้อเดียวกัน
- [Backends for Frontends](../backends-for-frontends/) ให้ประสบการณ์ของ client แต่ละแบบมี facade ของตัวเอง ครอบ service ชุดเดียวกัน: หลาย facade ต่อหนึ่ง subsystem
- ที่ระดับนั้น การเรียกแต่ละครั้ง timeout หรือ fail ได้เอง facade เลยต้องมี timeout และกฎสำหรับผลลัพธ์ที่ได้มาไม่ครบ และ class ข้างหลังมันก็กลายเป็น service ที่ทีมอื่นเป็นคน deploy
- [Anti-Corruption Layer](../anti-corruption-layer/) มักมี facade ที่ทำให้ interface ของ legacy system ง่ายขึ้นรวมอยู่ด้วย โดยยังใช้ศัพท์ของ legacy system เอง วางอยู่ข้าง ๆ adapter และ translator ส่วน facade ในการ migrate แบบ [Strangler Fig](../strangler-fig/) เป็นคนละเรื่องกัน: มันคือ router ที่คง interface ที่ client ใช้อยู่ไว้ แล้วตัดสินว่าระบบไหนจะเป็นคนตอบ เลยใกล้กับ proxy มากกว่า
