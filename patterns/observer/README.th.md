## ปัญหา

หน้าร้านแสดง cart ไว้สามที่: badge บอกจำนวนสินค้า, label บอกยอดรวม และ banner ที่นับถอยหลังสู่ free shipping ที่ EUR 50 เวอร์ชันที่เร็วที่สุดคือให้ cart คอยอัปเดตทั้งสามเอง `Cart` ถือ reference ไปที่ view แต่ละตัว แล้ว `add()` ก็ปิดท้ายด้วย `badge.render(count)`, `label.render(total)` และ `banner.update(total)` (step 1)

มันทำงานได้ แต่ผูกของผิดคู่เข้าด้วยกัน cart เป็น business state แต่ตอนนี้มัน import UI class สามตัว และรู้ว่าแต่ละตัวบังเอิญมี method อะไรให้เรียก มัน test ไม่ได้ถ้าไม่มีพวกนั้น ใช้ในหน้าที่ขาดตัวใดตัวหนึ่งไม่ได้ และทุกครั้งที่อยากให้มีอะไรตอบสนองต่อการเปลี่ยนของ cart เพิ่ม (mini-cart drawer, analytics event) ก็ต้องเปิด `Cart` มาเพิ่มอีกบรรทัด การที่ view ขึ้นกับข้อมูลของ cart น่ะไม่เป็นไร การที่ cart ขึ้นกับ view ของมันต่างหากที่เป็นปัญหา

## ทำงานยังไง

Observer กลับทิศ dependency นั้น โดยให้ object ที่สนใจ state ของ object อื่นลงทะเบียนกับมันไว้ แล้ว object นั้นก็จะบอกทุกตัวที่ลงทะเบียนไว้ทุกครั้งที่ state เปลี่ยน โดยไม่รู้อะไรเกี่ยวกับพวกมันเลยนอกจากว่ามี method สำหรับ update (Gamma, Helm, Johnson และ Vlissides, 1994) ส่วนประกอบต่าง ๆ ตามชื่อใน diagram:

- **Subject** (`Subject`) เก็บรายการ observer ให้พวกมัน subscribe และ unsubscribe ได้ และบอกทุกตัวเมื่อมีการเปลี่ยนแปลงด้วย `notify()`
- **Observer** (`Observer<S>`) คือ interface ที่มี method เดียวให้ subject เรียก: `update(subject)`
- **ConcreteSubject** (`Cart`) เป็นเจ้าของ state (สินค้า จำนวน และยอดรวม) และเรียก `notify()` หลังเปลี่ยนแปลงทุกครั้ง
- **ConcreteObserver** (`CartBadge`, `TotalLabel`, `FreeShippingBanner`) implement `update()` ด้วยการอ่านสิ่งที่ต้องใช้จาก subject แล้ว refresh หน้าจอของตัวเอง

view ทั้งหลาย subscribe แค่ครั้งเดียว (step 2) จากนั้นหน้าเว็บก็เรียก `cart.add()` แล้ว cart ก็เปลี่ยน state ของมันและเรียก `notify()` ส่วน `notify()` ก็เรียก `update(cart)` กับ observer ทีละตัว (step 3) ไม่มีอะไรใน `Cart` ที่เอ่ยชื่อ view class ทำให้ view ตัวที่สี่เป็นแค่ class ใหม่ที่ subscribe เข้ามา โดยไม่ต้องแก้ `Cart`

### Push หรือ pull

notification หนึ่งตัวจะพกข้อมูลไปมากแค่ไหน เป็นเรื่องที่ต้องออกแบบ

- **Pull** ตัว notification พกแค่ตัว subject หรือไม่พกอะไรเลย แล้ว observer แต่ละตัวก็ถามเอาสิ่งที่ต้องใช้เอง: `update(cart)` แล้วตามด้วย `cart.count` ทั้ง diagram และโค้ดข้างล่างก็ทำงานแบบนี้ interface ของ subject ยังเหมือนเดิมไม่ว่า observer จะต้องการอะไร แต่ observer จะรู้ไม่ได้ว่าอะไรเปลี่ยนถ้าไม่เทียบเอง และต้องเรียกเพิ่มเพื่อหาคำตอบ
- **Push** ตัว subject ส่งการเปลี่ยนแปลงไปให้เลย: `update({ count, total })` หรือ event object ที่บอกว่าเกิดอะไรขึ้น ฝั่ง observer ได้ข้อมูลโดยไม่ต้องเรียกกลับ แต่ตอนนี้ subject เป็นคนตัดสินว่า observer ทุกตัวจะได้อะไร payload เลยโตขึ้นให้พอกับตัวที่ต้องการมากที่สุด และกลายเป็น contract ที่ต้องดูแล

event API ส่วนใหญ่ผสมทั้งสองแบบ อย่าง DOM `Event` ก็ push `type` ของมันไปให้ (และ `CustomEvent` ก็ push payload `detail`) แล้วส่ง `target` ให้ listener ไปอ่านอย่างอื่นเอา

### Observer กับ pattern ใกล้เคียง

- **Observer** ทำงานภายใน process เดียว ตัว subject ถือ reference ตรงไปที่ observer ของมันแล้วเรียกพวกมันเอง ส่วนใหญ่แบบ synchronous ไม่มีอะไรถูกเก็บไว้: observer ที่ subscribe หลังการเปลี่ยนแปลงจะไม่มีวันได้ยินเรื่องนั้น และ subject กับ observer ก็อยู่ด้วยกันและพังไปด้วยกัน
- **[Publish-subscribe](../publish-subscribe/)** เอา broker มาไว้ระหว่างสองฝั่ง publisher ส่งไปที่ topic ที่มีชื่อ และไม่รู้อะไรเกี่ยวกับ subscriber เลย ส่วน durable subscription เก็บ message ไว้ตอนที่ subscriber ของมันไม่อยู่ และการส่งมักเป็นแบบ at least once ทำให้ subscriber ต้องรับมือกับของซ้ำได้ การแยกกันทั้งในแง่ที่อยู่และเวลาแบบนี้เองที่ทำให้ [event-driven architecture](../event-driven-architecture/) เชื่อม service ที่ deploy, scale และ restart แยกกันได้ บางทีสองชื่อนี้ก็ถูกใช้เรียกสิ่งเดียวกัน แต่ใน catalog นี้ *publish-subscribe* หมายถึง pattern ที่ใช้ broker
- **[Webhooks](../webhooks/)** คือ Observer ระหว่างองค์กรผ่าน HTTP: การ subscribe คือการลงทะเบียน URL และการ notify คือการส่ง HTTP `POST` ไปที่ URL นั้น เพราะการเรียกนั้นข้าม internet ฝั่ง provider เลย sign และ retry ทุกการส่ง ส่วนฝั่งรับก็ verify signature ตอบกลับเร็ว ๆ และทิ้งของซ้ำ
- **[Chain of Responsibility](../chain-of-responsibility/)** ก็ส่ง request ให้ผู้รับที่ผู้ส่งไม่รู้จักเหมือนกัน แต่ส่งต่อไปตามแถวของ handler จนกว่าจะมีตัวหนึ่งรับไป ส่วน Observer ส่ง notification ทุกตัวให้ subscriber ทุกตัว
- **Mediator** แก้ปัญหาคนละเรื่อง Observer ให้ object ตัวหนึ่ง broadcast ไปหา object กี่ตัวก็ได้ที่มันไม่รู้จัก ส่วน Mediator เอา object ตัวหนึ่งไปไว้ตรงกลางกลุ่มที่ถ้าไม่มีมัน สมาชิกทุกตัวก็จะคุยกันเองหมด แล้วให้มันเป็นคนประสานงาน ทั้งสองใช้ด้วยกันได้ดี: วิธีสร้าง mediator ที่เจอบ่อยคือให้สมาชิก subscribe event ที่ mediator publish

### Reactive stream และ signal

- **ReactiveX** (RxJS, RxJava, Rx.NET) ขยาย observer ให้กลายเป็น stream ตัว *Observable* ส่งลำดับของค่าผ่าน callback สามตัว ตัวหนึ่งสำหรับแต่ละค่า ตัวหนึ่งสำหรับ error และอีกตัวสำหรับตอนจบลำดับ แล้ว operator ก็ filter, map และรวม stream เข้าด้วยกันได้ คล้ายกับที่ method ของ array แปลง list ส่วน `subscribe()` คืน *Subscription* มาให้ และ `unsubscribe()` ของมันจะปล่อย subscription นั้น ส่วน `Subject` ของ RxJS คือของที่ใกล้กับ subject ของ GoF ที่สุด: มันเก็บ registry ของ observer และ multicast ทุกค่าไปให้ทุกตัว
- **.NET** มีรูปแบบเดียวกันนี้ในตัว: `IObservable<T>.Subscribe(observer)` คืน `IDisposable` ที่ใช้จบ subscription และ `IObserver<T>` มี `OnNext`, `OnError` และ `OnCompleted` คู่มือของ Microsoft บอกว่าลำดับที่ observer ถูก notify ไม่ได้ถูกกำหนดไว้ และแนะนำให้ใช้ event ธรรมดาของ .NET สำหรับ notification ง่าย ๆ ภายในแอปเดียว
- **Signal** ใน UI framework ทำให้การ subscribe เกิดขึ้นเอง ใน Angular และ SolidJS การอ่าน signal ภายใน reactive context (template, computed signal หรือ effect ของ Angular; effect หรือ memo ของ Solid) จะบันทึกผู้อ่านไว้เป็น dependent และพอ signal เปลี่ยนก็จะ notify เฉพาะ dependent พวกนั้น (ใน Solid คือ computation ที่อ่านมัน ไม่ใช่ทั้ง component) มันก็คือ Observer ที่ framework เขียนการเรียก subscribe และ unsubscribe ให้

### java.util.Observable

Java มี `Observer` และ `Observable` ใน `java.util` มาตั้งแต่ 1.0 ทั้งคู่ถูก deprecate ใน Java 9 และยังอยู่ใน Java SE 27 โดยไม่ได้ถูกทำเครื่องหมายว่าจะลบ หมายเหตุเรื่อง deprecation ให้เหตุผลไว้สามข้อ: event model ที่ทั้งสองรองรับจำกัดเกินไป ลำดับที่ observer ถูก notify ไม่ได้ระบุไว้ และ notification หนึ่งตัวไม่จำเป็นว่าจะหมายถึงการเปลี่ยน state หนึ่งครั้งพอดี สำหรับแต่ละความต้องการ มันชี้ไปที่อื่น: `java.beans` สำหรับ event model ที่ครบกว่า, concurrent data structure ใน `java.util.concurrent` สำหรับ message ระหว่าง thread ที่เชื่อถือได้และมีลำดับ, และ `java.util.concurrent.Flow` สำหรับ reactive stream การออกแบบนี้ยังมีต้นทุนอื่นด้วย `Observable` เป็น class ทำให้ subject ต้อง extend มัน และ `setChanged()` เป็น protected ทำให้โค้ดที่แค่ถือ `Observable` ไว้สั่งให้มัน notify ใครไม่ได้

## โค้ด

TypeScript ที่ตรงกับ diagram ตัวโค้ดรันด้วย Node 22.18 ขึ้นไปได้เลย (`node cart.ts`) โดยตัด type ทิ้ง แต่ Node ไม่ได้เช็ก type ให้ งานนั้นเป็นของ `tsc --noEmit --strict` ตัว `Subject` ใช้ polymorphic type `this` ของ TypeScript ทำให้ `Cart` ได้ `subscribe(observer: Observer<Cart>)` มาโดยไม่ต้องมี type parameter ของตัวเอง ส่วน view แต่ละตัว subscribe ตัวเองใน constructor และ banner ก็เก็บ function unsubscribe ที่ `subscribe()` คืนมาไว้เป็น `close()` ของมัน

```ts
// Observer: the one method a subject calls. S is the type of the subject.
interface Observer<S> {
  update(subject: S): void;
}

// Subject: keeps the list of observers and tells each of them about a change.
class Subject {
  #observers: Observer<this>[] = [];

  subscribe(observer: Observer<this>): () => void {
    this.#observers.push(observer);
    return () => { this.#observers = this.#observers.filter((o) => o !== observer); };
  }

  protected notify(): void {
    for (const o of [...this.#observers]) o.update(this); // a copy, in case the list changes mid-loop
  }
}

type Item = { name: string; price: number };

// ConcreteSubject: changes its state, then notifies. It never names a view class.
class Cart extends Subject {
  items: Item[] = [];
  get count(): number { return this.items.length; }
  get total(): number { return this.items.reduce((sum, item) => sum + item.price, 0); }

  add(name: string, price: number): void {
    this.items.push({ name, price });
    this.notify(); // pull model: each observer gets the cart and reads what it needs
  }

  remove(name: string): void {
    this.items = this.items.filter((item) => item.name !== name);
    this.notify();
  }
}

// ConcreteObservers: each subscribes itself and keeps the text it would render.
class CartBadge implements Observer<Cart> {
  text = '0';
  constructor(cart: Cart) { cart.subscribe(this); }
  update(cart: Cart): void { this.text = String(cart.count); }
}

class TotalLabel implements Observer<Cart> {
  text = 'EUR 0.00';
  constructor(cart: Cart) { cart.subscribe(this); }
  update(cart: Cart): void { this.text = `EUR ${cart.total.toFixed(2)}`; }
}

class FreeShippingBanner implements Observer<Cart> {
  text = 'EUR 50.00 to free shipping';
  readonly close: () => void; // the unsubscribe function: closing the banner calls it
  constructor(cart: Cart) { this.close = cart.subscribe(this); }
  update(cart: Cart): void {
    const left = 50 - cart.total;
    this.text = left > 0 ? `EUR ${left.toFixed(2)} to free shipping` : 'Free shipping';
  }
}

const cart = new Cart();
const badge = new CartBadge(cart);
const label = new TotalLabel(cart);
const banner = new FreeShippingBanner(cart);
const show = () => console.log(`${badge.text} | ${label.text} | ${banner.text}`);

cart.add('Mug', 12);  show(); // 1 | EUR 12.00 | EUR 38.00 to free shipping
cart.add('Lamp', 45); show(); // 2 | EUR 57.00 | Free shipping

banner.close();               // the shopper closes the banner, and it unsubscribes
cart.remove('Lamp');  show(); // 1 | EUR 12.00 | Free shipping   (the banner no longer hears the cart)
```

ผลลัพธ์:

```
1 | EUR 12.00 | EUR 38.00 to free shipping
2 | EUR 57.00 | Free shipping
1 | EUR 12.00 | Free shipping
```

loop ใน `notify()` ตั้งใจเขียนให้เรียบ ๆ มันรัน `update()` ทุกตัวแบบ synchronous ตามลำดับการ subscribe และถ้า observer ตัวหนึ่ง throw exception ตัวที่เหลือก็จะไม่ได้รัน ส่วน *ข้อควรรู้ตอนลงมือทำ* จะเล่าว่าเมื่อไหร่ควรทำต่างจากนี้

## ใช้ตอนไหนดี

- มีหลาย object ที่ต้องสะท้อนหรือตอบสนองต่อ state ของ object ตัวเดียว และตัวไหนบ้างก็เปลี่ยนไปได้: ตามหน้า ตาม feature flag ตาม plugin หรือตอน runtime
- แกนกลางไม่ควรรู้ว่าใครตอบสนองต่อมัน: model กับ view ของมัน, domain object กับ logging, metrics หรือ caching ที่อยู่รอบมัน
- notification อยู่แค่ใน process เดียว และ subject ไม่ต้องการอะไรตอบกลับมา

ให้เลือกอย่างอื่นเมื่อ:

- **มี dependent ตัวเดียวและจะไม่เปลี่ยน** เรียกตรง ๆ อ่านง่ายและ debug ง่ายกว่า
- **subject ต้องการผลลัพธ์หรือลำดับที่ตายตัว** เช็ก stock แล้วตัดบัตร แล้วจองการส่ง แบบนี้คือ workflow: ให้เรียกแต่ละขั้นตรง ๆ หรือ orchestrate มัน
- **notification ต้องข้าม process หรือต้องรอดผ่านการ crash** ให้ใช้ [publish-subscribe](../publish-subscribe/) ผ่าน broker หรือ [webhooks](../webhooks/) ระหว่างองค์กร

## ได้อะไร เสียอะไร

- **coupling หลวม แต่ flow ถูกซ่อน** ไม่มีอะไรใน `Cart` บอกว่าหลัง `add()` จะเกิดอะไรขึ้น ถ้าอยากรู้ก็ต้องรู้ว่าใคร subscribe ไว้บ้าง และเรื่องนี้อาจตัดสินกันตอน runtime เท่านั้น ส่วน stack trace ก็บอกได้แค่ว่า `notify()` เรียก `update()`
- **observer ทุกตัวได้ยินทุกการเปลี่ยนแปลง** banner ถูกแจ้งเรื่องที่ไม่มีผลกับมันเลย และถ้ามี observer เยอะหรือเปลี่ยนบ่อย ตัว notification เองก็กลายเป็นต้นทุน ทางที่ช่วยได้คือ subject ที่ย่อยละเอียดขึ้น การ notify เฉพาะตอนที่ค่าเปลี่ยนจริง ๆ และการรวมหลายการเปลี่ยนแปลงเป็น notification เดียว
- **อายุเป็นหน้าที่ของคุณ** subscription แต่ละตัวคือ reference จาก subject ที่อยู่นาน ไปหา observer ที่อาจอยู่แค่แป๊บเดียว (step 4 และข้างล่าง)
- **pattern นี้ไม่ได้กำหนดเรื่องลำดับ re-entrancy error และ threading** แต่ละเรื่องต้องตัดสินใจ แล้วเขียนไว้ตรงที่นิยาม subject

## ข้อควรรู้ตอนลงมือทำ

### อายุของ subscription

ให้ `subscribe()` คืนวิธี unsubscribe กลับมา โค้ดนี้คืน function ส่วน RxJS คืน `Subscription`, .NET คืน `IDisposable` และ `addEventListener()` ของ DOM รับ `AbortSignal` ใน option `signal` แล้วจะเอา listener ออกเมื่อ signal ถูก abort ส่วนตอนที่ observer หายไปก็ให้เรียกมัน เหมือนที่ `close()` ของ banner ทำในโค้ด หรือตอนที่ component unmount หรือ dialog ปิด

ถ้าข้ามขั้นนี้ไปจะเกิด leak แบบ *lapsed listener* ใน step 4 รายการของ subject ถือ strong reference ไว้ ทำให้ view ที่ปิดไปแล้วแต่ยังอยู่ในรายการค้างอยู่ใน memory นานเท่ากับ subject และยังทำงานทุกครั้งที่มีการเปลี่ยนแปลง เอกสาร WPF ของ Microsoft อธิบายกลไกไว้ว่า การผูก handler ทำให้ event source ได้ strong reference ไปหา listener ถ้าไม่เอา handler ออก listener ก็จะอยู่นานเท่ากับ source ส่วน `EventEmitter` ของ Node จะพิมพ์คำเตือนโดย default ถ้ามี listener มากกว่า 10 ตัวสำหรับ event เดียว เพราะจำนวน listener ที่โตไม่หยุดคืออาการที่เจอบ่อยที่สุด

weak reference ดูเหมือนจะเป็นยาแก้: subject ถือ observer ไว้ผ่าน `WeakRef` ใน JavaScript, `WeakReference` ใน Java หรือ weak event pattern ของ WPF ก็ได้ แต่มันไม่ค่อยใช่คำตอบ garbage ถูก collect ตอนที่ runtime ตัดสินใจ ทำให้ view ที่ปิดไปแล้วยังได้รับ update ต่อไปจนถึงตอนนั้น MDN แนะนำให้เลี่ยง `WeakRef` ถ้าทำได้ เพราะเวลาแบบนั้นคาดเดาไม่ได้ และ observer ที่ไม่มีอะไรอ้างถึงเลย อย่าง inline callback ก็อาจถูก collect ไปทั้งที่ยังต้องการมันอยู่ แล้ว update ของมันก็หยุดไปเงียบ ๆ WPF ใช้ weak event ในจุดที่ listener รู้ไม่ได้ว่าจะ unregister ตอนไหน อย่างใน data binding ส่วนในโค้ดแอป ให้ผูกการเรียก unsubscribe ไว้กับ lifecycle ของ observer แทน

### ลำดับ, re-entrancy และ cascade

- **อย่าพึ่งลำดับ** pattern นี้ไม่ได้กำหนดลำดับไว้ DOM และ `EventEmitter` ของ Node เรียก listener ตามลำดับที่เพิ่มเข้ามา `java.util.Observable` เขียนไว้ในเอกสารว่าลำดับไม่ได้ระบุ และ implementation default ของมัน notify observer ตัวที่เพิ่มล่าสุดก่อน ทั้งที่เอกสารเดียวกันอธิบายว่าเป็นลำดับการลงทะเบียน คู่มือ .NET ของ Microsoft ก็บอกว่าลำดับไม่ได้ถูกกำหนดไว้ ถ้า observer ตัวหนึ่งต้องรันหลังอีกตัว นั่นคือ dependency ที่ต้อง model ให้ชัด: ให้ตัวที่สอง observe ตัวแรก หรือคำนวณค่าที่ derive มาใน subject เลย
- **อย่าแก้ subject จาก `update()`** เพราะมันจะเริ่ม `notify()` ซ้อนเข้าไปก่อนที่ตัวนอกจะเสร็จ: observer ที่อยู่ท้ายรายการจะเห็นการเปลี่ยนแปลงครั้งที่สองก่อนครั้งแรก และการเปลี่ยนแปลงที่กระตุ้นให้เกิดอีกครั้งทุกทีก็จะวน loop จน stack overflow ถ้า observer ต้องตอบด้วยการเปลี่ยนแปลง ให้ queue ไว้รันหลัง notification จบ และให้ subject notify เฉพาะตอนที่ค่าเปลี่ยนจริง ๆ
- **ระวัง cascade** ถ้า observer เป็น subject ด้วย (ยอดรวมที่คำนวณแล้วให้ banner observe) การเปลี่ยนครั้งเดียวจะกระเพื่อมผ่านหลายชั้น และ observer ที่ขึ้นกับต้นทางเดียวกันผ่านสองเส้นทางก็อาจรันสองครั้ง หรือเห็นเส้นทางหนึ่งอัปเดตแล้วแต่อีกเส้นยัง ให้รวมการเปลี่ยนแปลงแล้ว notify ครั้งเดียว ส่วน reactive library และ signal มีไว้ส่วนหนึ่งก็เพื่อ schedule graph แบบนี้ให้เรา
- **notify ตอนที่ state สอดคล้องกันแล้ว** คือหลังการเปลี่ยนแปลงเสร็จทั้งหมด ไม่ใช่ตอนทำไปได้ครึ่งทาง และให้วน loop บนสำเนาของรายการ เหมือนที่ `notify()` ทำในโค้ด แบบนี้ observer ที่ subscribe หรือ unsubscribe ระหว่าง notification จะได้ไม่ทำให้ loop ข้ามหรือเพิ่มใครเข้ามา DOM ก็ทำแบบเดียวกัน: มันคัดลอกรายการ listener ไว้ก่อนจะเรียก ทำให้ listener ที่เพิ่มเข้ามาระหว่าง dispatch ไม่ได้รันสำหรับ event นั้นที่ target นั้น

### Error

ใน loop ธรรมดาแบบในโค้ด exception ที่ observer ตัวหนึ่ง throw จะทำให้ observer ทุกตัวที่อยู่ถัดไปถูกข้าม แล้วไปตกที่คนที่เรียก subject: `cart.add()` throw ทั้งที่สินค้าถูกเพิ่มไปแล้ว `EventEmitter.emit()` ของ Node ก็ทำแบบเดียวกัน แต่ DOM ไม่ใช่: มันรายงาน exception ของ listener แล้วทำต่อกับ listener ตัวถัดไป ถ้า observer แต่ละตัวเป็นอิสระต่อกัน ให้ catch รอบการเรียก `update()` แต่ละครั้งแล้วรายงาน error ไว้ ทำให้ view ที่พังตัวเดียวไม่ลากตัวอื่นพังตามไปด้วย

### Synchronous หรือ asynchronous

pattern ดั้งเดิมเป็นแบบ synchronous: `update()` ทุกตัวรันอยู่ใน `notify()` ก่อนที่ `add()` จะ return แบบนี้เรียบง่าย มีลำดับ และสอดคล้องกัน แล้ว observer แต่ละตัวก็อ่าน state ที่ทำให้มันถูกเรียก ราคาที่ต้องจ่ายคือ latency: observer ทุกตัวเพิ่มเวลาให้คนเรียก ทำให้ observer ที่ช้าตัวเดียวถ่วง observer ที่อยู่ถัดไป และถ่วงคนเรียกไปด้วย Node อธิบาย model เดียวกันนี้ไว้สำหรับ `EventEmitter` (listener รันแบบ synchronous ตามลำดับการลงทะเบียน) และแนะนำว่า listener สลับไปทำงานแบบ asynchronous ด้วย `setImmediate()` หรือ `process.nextTick()` ได้ในจุดที่เหมาะ การ notify แบบ asynchronous ผ่าน queue หรือ task ต่อ observer แต่ละตัว ทำให้คนเรียกเป็นอิสระ แต่เรื่องลำดับและการจัดการ error จะย้ายไปอยู่ที่ scheduler และถ้าใช้ model แบบ pull ตัว observer ก็อาจอ่าน state ที่เปลี่ยนไปแล้ว ถ้าทุกการเปลี่ยนแปลงสำคัญ ให้ push snapshot ของแต่ละการเปลี่ยนแปลงไป

### ภาษาสมัยใหม่ให้อะไรมาบ้าง

first-class function ตัดพิธีรีตองไปได้เกือบหมด observer เป็นแค่ callback ก็ได้ (`subscribe(fn)` แทน `subscribe(observer)`) โดยไม่ต้องมี interface หรือ class และ function unsubscribe ที่ subject คืนมาก็เป็น closure ส่วน platform ต่าง ๆ ก็มีกลไกนี้ให้ด้วย: ใน browser และใน Node ที่ `EventTarget` เป็น global ตัว class จะ extend `EventTarget` แล้ว dispatch event ของตัวเองได้ Node ยังมี `EventEmitter` อีก ส่วน .NET มี event และ `IObservable<T>` ส่วน Java มี `PropertyChangeSupport` ใน `java.beans` ให้หยิบ RxJS หรือ library ของ signal มาใช้เมื่อ notification กลายเป็น stream หรือ state ที่ derive ต่อกัน
