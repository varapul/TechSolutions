## ปัญหา

ฟอร์ม checkout มี widget สี่ตัวที่ขึ้นต่อกัน การเลือกประเทศจะกำหนดรูปแบบรหัสไปรษณีย์ เปลี่ยนตัวเลือกการส่งที่มีให้ และทำให้ลูกค้ายังจ่ายเงินไม่ได้ ส่วนรหัสไปรษณีย์ที่ถูกต้องจะทำให้จ่ายได้ เวอร์ชันแรกมักต่อ widget เข้าหากันตรง ๆ: `CountrySelect` ถือช่องรหัสไปรษณีย์ ตัวเลือกการส่ง และปุ่ม Pay ไว้ แล้วเรียกทั้งสามตัวทุกครั้งที่มันเปลี่ยน ส่วน `PostcodeField` เปิดปุ่ม Pay เมื่อค่าของมันถูกต้อง และ `ShippingOptions` ปิดปุ่ม Pay ระหว่างที่มัน reload

การเรียกแต่ละครั้งก็ดูสมเหตุสมผลตรงที่มันเขียนอยู่ แต่พอรวมกันก็ผูก widget ทุกตัวเข้ากับตัวอื่นทั้งหมด ถ้า widget แต่ละตัวจาก n ตัวเข้าถึงตัวอื่นได้ทุกตัว ฟอร์มก็จะถือ reference ทั้งหมด n(n − 1) ตัว: 12 สำหรับ widget สี่ตัว 20 สำหรับห้าตัว และ 90 สำหรับสิบตัว ฟอร์มจริงไม่ค่อยใช้ครบทุกคู่ แต่ต้นทุนก็โผล่มาตั้งนานก่อนจะถึงจุดนั้นแล้ว:

- **กฎไม่มีที่อยู่ของตัวเอง** การตัดสินว่าปุ่ม Pay เปิดหรือไม่ เกิดขึ้นในสาม class เลยไม่มีใครอ่านกฎนี้ได้จากที่เดียว และการเปลี่ยนกฎก็หมายถึงต้องตามหาการเรียกให้ครบทุกจุด
- **reuse widget ไม่ได้** `PostcodeField` ที่เรียก `pay.enable()` ใช้ได้แค่ในหน้าที่มีปุ่ม Pay ตัวนั้น
- **widget ใหม่ทุกตัวต้องไปแก้ตัวเก่า** checkbox ห่อของขวัญ (gift wrap) ต้องเข้าถึง widget ที่มันมีผลด้วย และ widget พวกนั้นก็ต้องเข้าถึงมันได้ การเพิ่มมันเลยหมายถึงต้องเปิด class ที่ทำงานได้ดีอยู่แล้วมาแก้

## ทำงานยังไง

Mediator ดึงการโต้ตอบออกจาก object ทั้งหลาย แล้วยกให้ object ตัวเดียวที่อยู่ตรงกลางระหว่างพวกมัน widget แต่ละตัว (เรียกว่า *colleague*) ถือ reference แค่ตัวเดียว คือไปที่ mediator ของมัน แล้วบอก mediator เมื่อมีอะไรเกิดขึ้นกับตัวเอง ส่วน mediator รู้จัก colleague ทุกตัวและถือกฎไว้: พอรู้ว่าประเทศเปลี่ยน มันก็ตัดสินว่า widget ไหนต้องตอบสนอง แล้วเรียกตัวพวกนั้น colleague ไม่เคยเรียกกันเอง ใยแบบ many-to-many เลยกลายเป็น one-to-many ตัว pattern นี้เป็นหนึ่งใน behavioural pattern ใน *Design Patterns* ของ Gamma, Helm, Johnson และ Vlissides (1994) และตัวอย่างในเล่มเองก็คือ dialog box ที่มี director object คอยประสาน widget ต่าง ๆ

| ส่วนประกอบ | ใน diagram | หน้าที่ |
|---|---|---|
| **Mediator** | `Mediator` | interface ที่ colleague ใช้คุยด้วย ในที่นี้มี method เดียวคือ `notify(sender, event)` |
| **ConcreteMediator** | `CheckoutMediator` | รู้จัก widget ทั้งสี่ตัว และถือกฎระหว่างพวกมันไว้: จะเกิดอะไรขึ้นเมื่อประเทศหรือรหัสไปรษณีย์เปลี่ยน |
| **Colleague** | `CountrySelect`, `PostcodeField`, `ShippingOptions`, `PayButton` | รู้จักแค่ mediator ของตัวเอง มันรายงานว่าเกิดอะไรขึ้น และทำตามที่ mediator สั่ง โดยไม่เคยเรียก colleague ตัวอื่น |

**ลองนับดู** ถ้าต่อกันตรง ๆ widget แต่ละตัวจาก n ตัวจะถือ reference ไปหาอีก n − 1 ตัวที่เหลือ รวมเป็น n(n − 1) ตัว จำนวนนี้โตตามกำลังสองของขนาดฟอร์ม ถ้ามี mediator แล้ว widget แต่ละตัวจะถือแค่ตัวเดียว รวมเป็น n ตัว: ในที่นี้คือ 4 แทนที่จะเป็น 12 และถ้ามีสิบ widget ก็เป็น 10 แทนที่จะเป็น 90 ส่วนตัว mediator เองก็ถือ reference กลับไปหา widget แต่ละตัวอีกหนึ่งตัว ถ้านับทั้งสองทิศ รูปดาวก็จะมี 2n reference คือ 20 เทียบกับ 90 สำหรับสิบ widget ส่วน widget ตัวที่ห้าจะเพิ่ม reference ให้ mesh ของสี่ตัว 8 ตัว (20 − 12) แต่เพิ่มให้รูปดาวแค่ตัวเดียว หรือสองตัวถ้านับของ mediator ด้วย

colleague จะเรียบง่ายขึ้น: widget รู้แค่ว่าจะแสดงค่า เปลี่ยนรูปแบบ หรือ reload ตัวเลือกยังไง และไม่รู้อะไรเรื่องกฎของ checkout เลย เพราะกฎอยู่ใน class เดียว เราเลยอ่าน แก้ และ test มันไปพร้อมกันได้ ในหนังสือยังบอกไว้ด้วยว่าตัด `Mediator` ที่เป็น abstract ทิ้งได้ ถ้า colleague ทำงานกับ mediator แค่ตัวเดียวเสมอ แต่ให้เก็บ interface ไว้ถ้า widget ชุดเดียวกันไปโผล่ในฟอร์มอื่นที่มีกฎอื่น หรือถ้าอยาก test widget กับ mediator ปลอม

## โค้ด

TypeScript ที่ตรงกับ diagram ตัวโค้ดรันด้วย Node 22.18 ขึ้นไปได้เลย (`node checkout.ts`) โดยตัด type ทิ้ง ส่วน `tsc --noEmit --strict` ใช้เช็ก type ได้ ตัว `CheckoutMediator` สร้าง widget ทั้งสี่ตัวแล้วส่งตัวเองให้แต่ละตัว เลยไม่มี widget ไหนได้ widget ตัวอื่นไปถือเลย `type()` ตั้งค่าทั้งก้อนในทีเดียว แต่ช่องจริงที่ฟัง event `input` จะ notify ทุกครั้งที่กดแป้น แล้ว mediator ก็จะปิดปุ่ม Pay ไว้จนถึงหลักที่ห้า และ assert `'1011'` ก็เช็กเรื่องนี้อยู่

```ts
import assert from 'node:assert/strict';

// Mediator: the one object every widget knows.
interface Mediator {
  notify(sender: Widget, event: string): void;
}

// Colleague: tells its mediator what happened and never calls another widget.
abstract class Widget {
  protected readonly mediator: Mediator;
  constructor(mediator: Mediator) { this.mediator = mediator; }
  protected changed(): void { this.mediator.notify(this, 'changed'); }
}
class CountrySelect extends Widget {
  value = '';
  choose(code: string): void { this.value = code; this.changed(); }
}
class PostcodeField extends Widget {
  value = '';
  hint = '';
  setFormat(hint: string): void { this.hint = hint; this.value = ''; }
  type(text: string): void { this.value = text; this.changed(); }
}
class ShippingOptions extends Widget {
  options: string[] = [];
  reload(country: string): void { this.options = OPTIONS[country] ?? []; }
}
class PayButton extends Widget {
  enabled = false;
  enable(): void { this.enabled = true; }
  disable(): void { this.enabled = false; }
}

const FORMATS: Record<string, { hint: string; pattern: RegExp }> = {
  TH: { hint: '5 digits', pattern: /^\d{5}$/ },
};
const OPTIONS: Record<string, string[]> = { TH: ['Standard · 3–5 days', 'Express · 1–2 days'] };

// ConcreteMediator: creates the four widgets and holds every rule between them.
class CheckoutMediator implements Mediator {
  readonly country = new CountrySelect(this);
  readonly postcode = new PostcodeField(this);
  readonly shipping = new ShippingOptions(this);
  readonly pay = new PayButton(this);

  notify(sender: Widget, event: string): void {
    if (event !== 'changed') return;
    const format = FORMATS[this.country.value];
    if (sender === this.country) {
      this.postcode.setFormat(format?.hint ?? '');
      this.shipping.reload(this.country.value);
      this.pay.disable();                          // until the postcode is valid
    } else if (sender === this.postcode) {
      if (format?.pattern.test(this.postcode.value)) this.pay.enable();
      else this.pay.disable();
    }
  }
}

const { country, postcode, shipping, pay } = new CheckoutMediator();
country.choose('TH');                              // the user picks Thailand
assert.deepEqual([postcode.hint, shipping.options.length, pay.enabled], ['5 digits', 2, false]);
postcode.type('1011');                             // four digits: Pay stays disabled
assert.equal(pay.enabled, false);
postcode.type('10110');                            // five digits: the mediator enables Pay
assert.equal(pay.enabled, true);
// No widget holds another widget: its one reference is the mediator.
for (const widget of [country, postcode, shipping, pay]) {
  assert.ok(Object.values(widget).every((field) => !(field instanceof Widget)));
}
console.log(postcode.hint, '|', shipping.options.join(', '), '|', pay.enabled);
```

ผลลัพธ์:

```
5 digits | Standard · 3–5 days, Express · 1–2 days | true
```

## ใช้ตอนไหนดี

- กลุ่ม object ที่ส่วนยากคือการโต้ตอบกันเอง: ฟอร์มและ dialog ที่ช่องต่าง ๆ คอยเปิดใช้ เติมค่า และเช็กกันเอง, panel ใน editor ที่ตอบสนองต่อสิ่งที่เลือกอยู่, ขั้นตอนของ wizard, ยูนิตต่าง ๆ ในฉากของเกม
- กฎที่คร่อมหลาย object (ปุ่ม Pay ขึ้นกับประเทศและรหัสไปรษณีย์) และเปลี่ยนบ่อย: class เดียวคือที่ที่ใช้แก้และ test กฎพวกนั้น
- object ที่อยาก reuse ในบริบทอื่น แต่ทำไม่ได้ตราบใดที่มันยังถือตัวข้าง ๆ ไว้
- ไม่ใช่สำหรับ object สองตัวที่โต้ตอบกันแบบง่าย ๆ อย่างเดียว ตรงนั้นเรียกกันตรง ๆ จะชัดกว่า และไม่ใช่สำหรับการ broadcast ทางเดียวที่ listener แต่ละตัวตัดสินเองว่าจะทำอะไร: อันนั้นคือ [Observer](../observer/)

## ได้อะไร เสียอะไร

- **มันรวมการควบคุมไว้ที่ศูนย์กลาง** ความซับซ้อนของการโต้ตอบไม่ได้หายไป แค่ย้ายไปอยู่ใน mediator กฎใหม่ทุกข้อไปลงที่ class เดียวกัน ทำให้ checkout mediator อาจโตจนเป็น god object ที่รู้ทุกอย่างเกี่ยวกับหน้านั้น หนังสือเตือนไว้ว่าตัว mediator เองอาจกลายเป็น class ใหญ่ที่ดูแลยาก
- **ต้องอ้อม** อ่าน `CountrySelect` แล้วจะไม่รู้อีกต่อไปว่าการเปลี่ยนประเทศทำอะไรบ้าง ต้องไปอ่าน mediator แต่แลกกับการที่มีที่ให้อ่านแค่ที่เดียวพอดี
- **mediator เป็นส่วนที่ reuse ได้น้อยที่สุด** colleague reuse ได้เพราะ logic ที่เฉพาะกับหน้านี้ถูกย้ายออกไป และทั้งหมดก็ไปลงที่ mediator ตัว mediator เลยใช้ได้กับฟอร์มนี้ฟอร์มเดียว
- **สิ่งที่ได้กลับมา** คือ colleague เรียบง่ายและไม่ผูกกัน widget ใหม่แก้แค่ mediator และ test กฎการโต้ตอบได้ในที่เดียว

## ข้อควรรู้ตอนลงมือทำ

- **colleague คุยกับ mediator ยังไง**
  - *เรียกโดยบอกว่าใครเป็นคนส่ง* widget เรียก `mediator.notify(this, 'changed')` แล้ว mediator ก็เทียบ sender กับ colleague ที่มันถืออยู่ เหมือนในที่นี้ โค้ดตัวอย่างในหนังสือก็ทำแบบนี้: widget ส่งตัวเองให้ director ของมันตอนที่มันเปลี่ยน อีกทางที่มี type คือให้ mediator มีหนึ่ง method ต่อหนึ่ง event อย่าง `countryChanged(code)` และ `postcodeChanged(value)`: ชัดกว่าและ compiler ช่วยเช็กให้ แต่ interface ก็จะโตขึ้นทุกครั้งที่มี event ใหม่
  - *Event* ให้ colleague publish event แล้ว mediator ก็ subscribe ไว้ ก็คือเอา Observer มาใช้เป็นท่อนั่นเอง หนังสือระบุว่านี่เป็นอีกวิธีหนึ่งในการต่อ colleague เข้ากับ mediator ของมัน แบบนี้ widget จะไม่รู้ด้วยซ้ำว่าใครฟังอยู่ ใน browser [event `input` และ `change` จะ bubble](https://html.spec.whatwg.org/multipage/input.html#common-input-element-events) ทำให้ listener ตัวเดียวบน `<form>` เลยได้ยินทุกช่องและรันกฎได้
  - *Callback* ในภาษาที่ function เป็นค่าได้ widget รับ callback อย่าง `onChange` แทน reference ไปที่ type ของ mediator ได้ แล้วกฎก็ไปอยู่ใน object ที่สร้าง widget เหล่านั้น [lifting state up](https://react.dev/learn/sharing-state-between-components) ของ React ก็มีรูปแบบนี้: parent ร่วมที่ใกล้ที่สุดเป็นเจ้าของ state ที่ใช้ร่วมกัน ส่งค่าลงไปเป็น props และได้การเปลี่ยนแปลงกลับมาผ่าน props ที่เป็น event handler ตัว component ฟอร์มที่เป็น parent เลยเป็น mediator และ controlled input ก็คือ colleague ของมัน
- **test กฎในที่เดียว** เพราะกฎอยู่ใน `CheckoutMediator` ตัว test เลยสั่ง widget แล้วเช็กว่า mediator ทำอะไรไปบ้าง เหมือนที่ assert ข้างบนทำ โดยไม่ต้องมี browser ส่วน widget ก็ test แยกเดี่ยว ๆ ได้กับ mediator ปลอมที่จดการเรียก `notify()` ที่มันได้รับไว้
- **อย่าให้มันกลายเป็น god object**
  - ให้ widget โง่ไว้: มันรายงานว่าเกิดอะไรขึ้นและมี operation ให้เรียก ส่วนกฎไหนที่เกี่ยวกับ widget ตัวอื่นก็ให้ไปอยู่ที่ mediator
  - ให้ mediator ทำแค่งานประสาน: รูปแบบรหัสไปรษณีย์ ราคา และการเรียก API ควรอยู่ใน class ของตัวเอง แล้วให้ mediator เป็นคนเรียก
  - พอมันโตขึ้นก็แยกตามเรื่อง: address mediator สำหรับประเทศ รหัสไปรษณีย์ และการส่ง, payment mediator สำหรับปุ่ม Pay โค้ดส่วนลด และบัตรที่บันทึกไว้ ตรงที่สองเรื่องมาเจอกัน (ปุ่ม Pay ต้องมีที่อยู่ที่ถูกต้อง) ให้ mediator ตัวหนึ่ง publish event หรือเปิด state ให้อีกตัวฟัง แทนที่จะรวมกลับเป็นตัวเดียว
- **pattern ญาติ ๆ** ในหนังสือ ตอนที่คุยเรื่อง behavioural pattern ได้มอง Mediator, Observer, Chain of Responsibility และ Command ว่าเป็นสี่วิธีในการแยก object ที่ส่ง request ออกจาก object ที่ลงมือทำตาม request นั้น:
  - [Observer](../observer/) คือการ broadcast แบบ one-to-many: subject แจ้งใครก็ตามที่ subscribe ไว้ แล้ว observer แต่ละตัวตัดสินเองว่าจะทำอะไร logic เลยกระจายอยู่ตาม observer ส่วน mediator รวมมันไว้ที่ศูนย์กลาง: object ตัวเดียวตัดสินว่าใครทำอะไร ทั้งสองใช้ด้วยกันได้ดี โดยให้ colleague เป็น subject และ mediator เป็น observer ของพวกมัน
  - [Facade](../facade/) ก็เอา object ตัวเดียวมาไว้หน้าหลายตัวเหมือนกัน แต่ protocol ของมันวิ่งทางเดียว: client เรียก facade แล้ว facade ก็เรียก subsystem และ class ใน subsystem ไม่รู้ด้วยซ้ำว่ามี facade อยู่ ส่วน colleague รู้จัก mediator ของตัวเอง เรียกมัน และถูกมันเรียกกลับ
  - [Chain of Responsibility](../chain-of-responsibility/) ส่ง request ไปตาม chain จนกว่าจะมี handler ตัวหนึ่งรับไป มันไม่มีศูนย์กลาง และแต่ละข้อรู้จักแค่ตัวถัดไป
  - [Command](../command/) เปลี่ยน request ให้เป็น object ที่เชื่อม sender หนึ่งตัวเข้ากับ receiver หนึ่งตัว: sender ถือ command และ command ก็รู้จัก receiver ของมัน library "mediator" ที่ทำงานใน process เดียวกันอย่าง MediatR ก็ dispatch request object คล้าย ๆ แบบนี้ ตามที่ข้อถัดไปจะเล่า
- **library ที่ชื่อ mediator** [MediatR](https://github.com/LuckyPennySoftware/MediatR) สำหรับ .NET บอกว่าตัวเองเป็น mediator implementation แบบง่าย ๆ: messaging ภายใน process ที่ request ที่ส่งด้วย `Send` จะไปถึง handler ตัวเดียวพอดี ส่วน notification ที่ส่งด้วย `Publish` จะไปถึง handler ทุกตัวที่ match โดย default จะไปทีละตัวตามลำดับ ส่วน pipeline behavior ห่อการจัดการ request ไว้สำหรับเรื่องที่คร่อมหลายส่วนอย่าง logging และ validation สิ่งที่มันแยกออกจากกันคือโค้ดที่ส่ง message (เช่น web controller) กับ class ที่จัดการ message นั้น ทำให้มันใกล้กับ command dispatcher มากกว่า mediator ในหนังสือ ที่ object ตัวเดียวถือกฎระหว่างกลุ่ม object ที่เท่าเทียมกัน ตั้งแต่เวอร์ชัน 13.0 เป็นต้นมา MediatR กลายเป็นผลิตภัณฑ์เชิงพาณิชย์ของ Lucky Penny Software ที่ต้องใช้ license key โดยมี community edition ฟรีสำหรับองค์กรขนาดเล็ก ([mediatr.io](https://mediatr.io/)) ส่วนเวอร์ชันก่อนหน้ายังอยู่ภายใต้ license แบบ open source เหมือนเดิม
- **ในระดับ architecture** การเลือกระหว่าง mesh กับ hub แบบเดียวกันนี้ก็โผล่มาระหว่าง service และระหว่าง network:
  - [saga orchestrator](../saga-orchestration/) คือ mediator สำหรับ service: coordinator ตัวเดียวบอก participant แต่ละตัวว่าต้องรัน local transaction ไหน และตัดสินว่าจะทำอะไรต่อ รวมถึง compensation ด้วย ส่วน [choreography](../saga-choreography/) คือแบบ mesh: service แต่ละตัวตอบสนองต่อ event ของตัวอื่น และ flow มีอยู่แค่ในรูปของผลรวมของ subscription ทั้งหมด [คำแนะนำเรื่อง Saga pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/saga) ของ Azure ชั่งน้ำหนักสองแบบนี้แบบเดียวกับที่หน้านี้ชั่ง widget: choreography เหมาะกับ flow ง่าย ๆ ที่มี service ไม่กี่ตัวและไม่มี single point of failure ตรงกลาง แต่จะตามยากขึ้นเมื่อเพิ่มขั้นตอน และเสี่ยงจะเกิด dependency วนกันระหว่าง service ส่วน orchestration เหมาะกับ flow ซับซ้อนและเก็บแต่ละ flow ไว้ในที่เดียว แลกกับต้องสร้าง logic การประสานงาน และมี component เพิ่มอีกตัวที่พังได้
  - [hub-and-spoke network](../hub-spoke-network/) เอา hub ตัวเดียวที่ spoke ทุกตัว peer ด้วย มาแทนการ peer ทุก network เข้ากับทุก network ถ้าเป็น full mesh ของสิบ network ก็ต้องใช้ 45 peering คือ n(n − 1)/2 เพราะ peering หนึ่งตัวเชื่อมสอง network ส่วนสิบ spoke ใช้แค่สิบ peering แล้ว traffic ระหว่าง spoke ก็วิ่งผ่าน firewall หรือ router ของ hub ทำให้ policy อยู่ที่เดียว แลกกับ hop ที่เพิ่มมาหนึ่ง hop และ [hub-spoke reference architecture](https://learn.microsoft.com/en-us/azure/architecture/networking/architecture/hub-spoke) ของ Azure ก็ยังแนะนำให้ peer ตรงระหว่าง spoke ของ workload เดียวกันที่ต้องการ latency ต่ำ
  - สิ่งที่เปลี่ยนไปในระดับนั้นคือ mediator เป็น process แยกที่ต้อง deploy, scale และดูแลให้พร้อมใช้งาน การเรียกมันข้าม network และ timeout ได้ และ state ของมัน (เช่น saga ไปถึงไหนแล้ว) ต้องรอดผ่านการ restart ได้
