## ปัญหา

โค้ด Checkout ตัดเงินจากบัตรผ่าน interface ที่ทีมออกแบบไว้ใช้เอง: `PaymentGateway.charge(amountMinor, currency)` คืน `Receipt` และยอดเงินทุกยอดเป็นจำนวนเต็มในหน่วยย่อยของสกุลเงินนั้น 1250 เลยหมายถึง €12.50 ส่วน provider เจ้าใหม่ที่เพิ่งเซ็นสัญญากันไป ส่ง SDK มาให้ ที่ทำงานเดียวกันผ่าน interface คนละแบบ: เรียก `makePayment` ที่อยากได้ยอดเงินเป็น string ทศนิยมในหน่วยหลัก (`'12.50'`) ภายใต้ชื่อ field อีกแบบ แล้วตอบกลับมาเป็น status object ตัว SDK แก้ไม่ได้ ถ้าเขียน Checkout ใหม่ให้ใช้ภาษาของ provider ก็จะทำให้ชื่อ หน่วย และ error code ของ provider เจ้านั้นกระจายไปทั่วโค้ดที่ไม่ควรต้องสนใจว่าใครเป็นคนโอนเงิน และพอมี provider เจ้าถัดไปก็ต้องทำใหม่ทั้งหมดอีกรอบ

## ทำงานยังไง

Gamma, Helm, Johnson และ Vlissides จัด Adapter (มีอีกชื่อว่า Wrapper) ไว้ในกลุ่ม structural pattern ในหนังสือ *Design Patterns* (1994) ไอเดียคือ: ถ้ามี class ที่ทำสิ่งที่ต้องการได้อยู่แล้ว แต่ไม่ได้ทำผ่าน interface ที่โค้ดของเราคาดไว้ ก็วาง class เล็ก ๆ ไว้ตรงกลาง ให้มันเปิด interface ที่คาดไว้ แปลงทุกการเรียกให้เป็นแบบที่ class เดิมเข้าใจ และแปลงทุกคำตอบกลับมา

- **Target** (`PaymentGateway`): interface ที่ client เขียนโค้ดโดยอิงมัน มันเป็นของเรา และหน้าตาของมันมาจากสิ่งที่ Checkout ต้องการ
- **Client** (`Checkout`): ใช้ target และไม่ใช้อะไรอื่นเลย
- **Adaptee** (`LegacyPay`): class ที่มีอยู่แล้ว มีพฤติกรรมที่มีประโยชน์ แต่ interface ไม่ตรง ปกติก็คือ vendor SDK, API client ที่ generate มา หรือ legacy module
- **Adapter** (`LegacyPayAdapter`): implement target แล้วส่งต่อไปที่ adaptee โดยแปลง argument ตอนขาเข้า และแปลงผลลัพธ์กับ error ตอนขาออก

ทั้ง client และ adaptee ไม่ต้องเปลี่ยน ตัว adapter เป็น class เดียวที่รู้จักทั้งสอง interface และโค้ดที่ประกอบแอปเข้าด้วยกันก็ส่ง `new LegacyPayAdapter(sdk)` ให้ Checkout ทุกที่ที่มันคาดว่าจะได้ `PaymentGateway` การสลับ provider แบบในขั้นที่ 4 ก็แค่เปลี่ยนบรรทัดนั้นบรรทัดเดียว

**object adapter หรือ class adapter** หนังสือเล่าวิธีสร้างไว้สองแบบ:

- **object adapter** ถือ adaptee ไว้ (composition) แบบในแผนภาพ แล้ว adapter class ตัวเดียวก็ใช้ได้กับ adaptee และกับ subclass ไหนของมันก็ได้ รวมถึง fake ที่ใช้ test ด้วย และ method ของ adaptee เองก็ถูกซ่อนไว้หลัง target แบบนี้คือตัวเลือกปกติ
- **class adapter** สืบทอดจาก adaptee และ implement target: `class LegacyPayAdapter extends LegacyPay implements PaymentGateway` มันเป็น object ตัวเดียวแทนที่จะเป็นสองตัว และ override method ของ adaptee ได้ แต่มันผูกอยู่กับ concrete class ตัวนั้นตัวเดียว และใน Java หรือ TypeScript ตัว `makePayment` ที่สืบทอดมาก็ยังเป็น public อยู่บน adapter ส่วนเวอร์ชัน C++ ในหนังสือเลยสืบทอดจาก adaptee แบบ private เพื่อเลี่ยงเรื่องนี้ ภาษาที่สืบทอด class ได้แค่ตัวเดียว (single inheritance) จะสร้าง class adapter ได้ก็ต่อเมื่อ target เป็น interface

**adapter แบบสองทาง** adapter ไม่ได้หน้าตาเหมือน adaptee ของมันอีกแล้ว โค้ดที่เขียนโดยอิง adaptee เลยใช้มันไม่ได้ ถ้าสองส่วนของระบบต้องใช้ object ตัวเดียวกันผ่าน interface ต่างกัน (เช่นระหว่าง migration ที่โค้ดเก่ายังเรียก legacy interface อยู่ ส่วนโค้ดใหม่เรียก interface ใหม่) adapter แบบสองทางก็ implement ทั้งสองตัว หนังสือสร้างมันด้วย multiple inheritance ส่วนถ้าใช้ interface ก็แค่ให้ class ตัวเดียว implement ทั้งสองตัว

## โค้ด

TypeScript ที่ Node.js 22.18 ขึ้นไปรันได้เลย (`node adapter.ts`: type stripping เปิดไว้โดย default ตั้งแต่ release นั้น) ตัว `LegacyPay` ปลอมมีหน้าตาการเรียกและการตอบแบบเดียวกับ SDK และบันทึกทุก request ไว้ ทำให้ assert เช็กได้ตรง ๆ ว่า provider จะได้รับอะไรไป

```ts
import assert from 'node:assert/strict';

// Target: the interface checkout code is written against.
interface Receipt { id: string; amountMinor: number; currency: string }
interface PaymentGateway { charge(amountMinor: number, currency: string): Receipt }
class PaymentDeclined extends Error {}

// Adaptee: the provider's SDK, faked here with its real call and reply shapes.
type LegacyRequest = { amount: string; curr: string };
type LegacyReply = { status: 'OK'; ref: string } | { status: 'DECLINED'; code: string };
class LegacyPay {
  sent: LegacyRequest[] = [];
  declineNext = false;
  makePayment(req: LegacyRequest): LegacyReply {
    this.sent.push(req);
    return this.declineNext ? { status: 'DECLINED', code: '51' } : { status: 'OK', ref: 'PX-77' };
  }
}

// ISO 4217 minor units: how many digits follow the decimal point.
const MINOR_UNITS: Record<string, number> = { JPY: 0, EUR: 2, BHD: 3 };

// 1250 -> '12.50' with string arithmetic only: no binary floating point.
function toDecimal(amountMinor: number, currency: string): string {
  const exp = MINOR_UNITS[currency];
  if (exp === undefined) throw new Error(`unsupported currency ${currency}`);
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new RangeError(`bad amount ${amountMinor}`);
  if (exp === 0) return String(amountMinor);
  const digits = String(amountMinor).padStart(exp + 1, '0');
  return `${digits.slice(0, -exp)}.${digits.slice(-exp)}`;
}

// Adapter: implements PaymentGateway, holds a LegacyPay, translates both ways.
class LegacyPayAdapter implements PaymentGateway {
  private readonly sdk: LegacyPay;
  constructor(sdk: LegacyPay) { this.sdk = sdk; }

  charge(amountMinor: number, currency: string): Receipt {
    const reply = this.sdk.makePayment({ amount: toDecimal(amountMinor, currency), curr: currency });
    if (reply.status === 'DECLINED') throw new PaymentDeclined('card declined'); // the code stays here
    return { id: reply.ref, amountMinor, currency };
  }
}

// Client: checkout code knows only PaymentGateway, Receipt and PaymentDeclined.
function checkout(gateway: PaymentGateway, totalMinor: number, currency: string): string {
  try { return `paid, receipt ${gateway.charge(totalMinor, currency).id}`; }
  catch (e) { if (e instanceof PaymentDeclined) return 'declined: ask for another card'; throw e; }
}

const sdk = new LegacyPay();
const gateway: PaymentGateway = new LegacyPayAdapter(sdk);
console.log(gateway.charge(1250, 'EUR')); // { id: 'PX-77', amountMinor: 1250, currency: 'EUR' }
gateway.charge(1250, 'JPY');
sdk.declineNext = true;                   // as in step 3, the BHD charge is declined
assert.throws(() => gateway.charge(1250, 'BHD'), PaymentDeclined);
assert.deepEqual(sdk.sent.map((r) => r.amount), ['12.50', '1250', '1.250']);
console.log(checkout(gateway, 1250, 'BHD')); // declined: ask for another card
```

การแปลงยังถูกเช็กแยกเดี่ยว ๆ ด้วย ทั้งศูนย์ (`'0.00'`), หน่วยที่เล็กที่สุด (`1` ใน BHD คือ `'0.001'`), จำนวนเต็มที่ปลอดภัยที่ใหญ่ที่สุด และยอดติดลบ เศษทศนิยม กับสกุลเงินที่ไม่รู้จัก ที่ต้อง throw ทั้งหมด ตาราง exponent ตั้งใจให้เล็กมาก ๆ: ตารางจริงต้องมีทุกสกุลเงินที่รับ เอาค่ามาจาก ISO 4217 (หน่วยงานที่ดูแลคือ SIX ที่เผยแพร่รายการเป็น XML และ XLS) และต้องปฏิเสธสกุลเงินที่ไม่รู้จัก แทนที่จะเดาว่ามีทศนิยมสองตำแหน่ง

## ใช้ตอนไหนดี

- มี class ที่ทำงานได้ แต่ไม่ได้ทำผ่าน interface ที่โค้ดของเราคาดไว้ และแก้ฝั่งไหนก็ไม่ได้หรือไม่ควรแก้: vendor SDK, API client ที่ generate มา, legacy module, platform API
- อยากกันชื่อ หน่วย และ status code ของ vendor ไว้นอก domain ของเรา จะได้เปลี่ยน provider ได้ หรือใช้หลายเจ้าคู่กัน ด้วยการเขียน adapter เจ้าละตัว
- ไม่ใช่ตอนที่เราเป็นเจ้าของทั้งสองฝั่ง และแค่แก้ฝั่งใดฝั่งหนึ่งก็จบ และไม่ใช่เพื่อกู้ target ที่ออกแบบมาไม่ดี: ไปแก้ target
- ไม่ใช่ตอนที่ความต่างอยู่ที่พฤติกรรม ไม่ใช่หน้าตา ถ้า provider ยืนยันการจ่ายเงินทีหลังผ่าน webhook ตัว `charge()` แบบ synchronous ที่คืน `Receipt` ก็เป็น target ที่ผิด และ adapter ที่ซ่อนความต่างนี้ไว้ก็จะรายงานการจ่ายเงินที่ยังไม่เกิดขึ้นจริง ให้เปลี่ยน target แทน เช่น ให้คืน payment ที่ยัง pending อยู่

## ได้อะไร เสียอะไร

- **class เพิ่มหนึ่งตัวต่อ adaptee หนึ่งตัว** และทุกการเรียกต้องผ่าน object เพิ่มอีกหนึ่งตัว ต้นทุนตอน runtime น้อยจนไม่ต้องนับ ต้นทุนจริงคือโค้ดที่ต้องดูแล ต้อง review และต้อง test
- **target เป็นตัวกำหนดว่าจะอยู่ได้นานแค่ไหน** ให้ออกแบบมันจากสิ่งที่ client ต้องการ ไม่ใช่จาก API ของ provider เจ้าแรก ไม่งั้น adapter ทุกตัวหลังจากนั้นจะต้องสู้กับมัน [Hexagonal Architecture](../hexagonal-architecture/) ก็พูดเรื่องเดียวกันนี้เกี่ยวกับ port
- **lowest common denominator** target ที่ provider ทุกเจ้ารองรับได้ อาจซ่อน feature ที่มีแค่เจ้าเดียวไว้ และการขยาย target เพื่อ provider เจ้าเดียว ก็ทำให้ adapter ตัวอื่นทุกตัวต้อง implement หรือปฏิเสธ method ใหม่นั้น
- **ความหมายรั่วผ่านมาได้** timeout, partial capture, 3-D Secure challenge และ idempotency เป็นพฤติกรรม ไม่ใช่รูปแบบข้อมูล และไม่มี adapter ไหนทำให้มันหายไปได้ ถ้า client ต้องรับมือกับเรื่องพวกนี้ target ก็ต้องจำลองมันไว้ด้วย
- **class adapter ผูกแน่นกว่า** มันผูกกับ concrete class ตัวเดียวและเปิด method ของ class นั้นออกมา object adapter เลยเป็นตัวเลือก default

## ข้อควรรู้ตอนลงมือทำ

**อะไรควรอยู่ใน adapter** การแปลง และไม่มีอะไรอื่น:

- *หน้าตา:* ชื่อ method และ field, การซ้อนกัน, field ที่ไม่บังคับ, enumeration และค่า status
- *หน่วยและรูปแบบ:* หน่วยย่อยหรือหน่วยหลัก, string ทศนิยม, ตัวพิมพ์เล็กใหญ่ของรหัสสกุลเงิน, รูปแบบวันที่และเวลา
- *error:* failure ทุกตัวที่ provider บันทึกไว้ในเอกสาร ต้อง map เป็น error type ของเราเองสักตัว (ตรงนี้คือ `PaymentDeclined`) และอะไรที่ไม่รู้จักก็ให้ถือเป็น error ด้วย ส่วนรหัสดิบของ provider ให้ log ไว้พร้อม correlation ID เพราะทีม support จะต้องใช้ แต่อย่าส่งต่อขึ้นไป การแยก decline (ไม่ต้อง retry) ออกจาก timeout (ไม่รู้ผล) ก็เป็นส่วนหนึ่งของการแปลง
- *ไม่ใช่ policy:* retry, timeout, circuit breaking, caching และ metric ให้ไปอยู่ใน decorator ที่ครอบ `PaymentGateway` (decorator คง interface เดิมไว้แล้วเพิ่มพฤติกรรม) หรือไปอยู่ใน infrastructure เช่น [Ambassador](../ambassador/) ดู [Retry with Backoff](../retry-with-backoff/) และ [Circuit Breaker](../circuit-breaker/) การ retry การจ่ายเงินยังต้องมี idempotency key ด้วย ไม่งั้นอาจตัดบัตรซ้ำสองครั้ง adapter ที่ทำแค่แปลงจะเล็ก และ test กับ response ที่อัดไว้ได้ง่าย
- *ไม่ใช่ business rule:* จะตัดเงินไหม ตัดเท่าไร การเช็ก fraud

**เงิน: ใช้จำนวนเต็มในหน่วยย่อย ห้ามใช้ binary floating point** ใน JavaScript `0.1 + 0.2` ได้ `0.30000000000000004` เพราะ `number` คือ binary double ให้เก็บยอดเงินเป็นจำนวนเต็มในหน่วยย่อย หรือเป็น decimal type อย่าง `BigDecimal` ของ Java แล้วแปลงเป็นรูปแบบของ provider ด้วย operation ของจำนวนเต็มและ string แบบที่ `toDecimal` ทำ ตัว `number` ของ JavaScript เก็บจำนวนเต็มได้ตรงเป๊ะแค่ถึง 2⁵³ − 1 (9,007,199,254,740,991) เกินจากนั้นให้ใช้ `BigInt` ส่วนจำนวนตำแหน่งทศนิยมเป็นของสกุลเงิน: ISO 4217 ระบุไว้เป็น *minor unit* คือ 0 สำหรับ JPY, 2 สำหรับ EUR, 3 สำหรับ BHD และ KWD และถึงขั้น 4 สำหรับ unit of account อย่าง CLF และ UYW มีกับดักสองข้อ:

- อย่าดึง exponent มาจากการจัดรูปแบบตอนแสดงผล `Intl.NumberFormat` ทำตามธรรมเนียมการแสดงผลของ CLDR ที่ต่างจาก ISO 4217 ในบางสกุลเงิน: ใน Node.js 22 มีสิบสามสกุล หนึ่งในนั้นคือดีนาร์อิรัก (3 minor unit ใน ISO 4217 แต่ 0 fraction digit ใน `Intl`)
- provider ก็มีกฎของตัวเองเพิ่มเข้ามา เช่น [Stripe](https://docs.stripe.com/currencies) คาดว่าทุกยอดเงินจะเป็นหน่วยย่อยของสกุลเงินนั้น แต่กลับขอโครนาไอซ์แลนด์แบบมีทศนิยมสองตำแหน่งที่เป็นศูนย์เสมอ เพื่อ backward compatibility ทั้งที่ ISO 4217 ไม่ได้ให้ ISK มี minor unit เลย ความแปลกแบบนี้ควรอยู่ใน adapter ของ provider เจ้านั้น และไม่ควรอยู่ที่อื่น

การแปลงระหว่างรูปแบบต่าง ๆ ควรตรงเป๊ะ: ถ้ายอดเงินแสดงในแบบที่ provider ต้องการไม่ได้ ก็ให้ fail แบบโวยวายออกมา แทนที่จะปัดเศษแบบเงียบ ๆ การปัดเศษเป็นการตัดสินใจทางธุรกิจ (ภาษี, การแปลงสกุลเงิน, การหารบิล) ที่ทำครั้งเดียว อยู่ฝั่งเราของเส้นแบ่ง

**การ test** test ตัว adapter แยกเดี่ยว ๆ ในสามระดับ:

- unit test กับ adaptee ปลอม แบบในโค้ดข้างบน: exponent ของแต่ละสกุลเงิน, ศูนย์, หน่วยที่เล็กที่สุด, ยอดที่ปลอดภัยที่ใหญ่ที่สุด, สกุลเงินที่ไม่รู้จัก และ status ทุกตัวที่มีในเอกสาร
- replay test กับ response ที่อัดไว้: เก็บคู่ request และ response จริงจาก sandbox ของ provider ไว้ครั้งเดียว แล้วเล่นซ้ำ ทำให้ test ยังเร็วอยู่และยังเห็นรูปแบบจริงของ provider ตัวอย่างเช่น [WireMock](https://wiremock.org/docs/record-playback/) ทำตัวเป็น proxy หน้า API แล้วอัด traffic เก็บไว้เป็น stub ได้
- contract test ไม่กี่ตัวกับ sandbox เอง ที่รันตามตารางเวลา เพื่อจับวันที่ provider เปลี่ยนอะไรบางอย่าง

แล้ว test ของ Checkout เองก็ไม่ต้องมี provider เลย: แค่ได้ `PaymentGateway` ปลอมไป

**adapter ใน migration และระหว่าง bounded context**

- ใน migration แบบ [Strangler Fig](../strangler-fig/) โค้ดใหม่เขียนโดยอิง interface ของตัวเอง ขณะที่การเรียกบางส่วนยังต้องไปถึงระบบเก่า adapter เป็นตัวเชื่อมช่องว่างนี้ และถูกลบทิ้งไปพร้อมกับโค้ด legacy ส่วน [Branch by Abstraction](../branch-by-abstraction/) ก็คือท่าเดียวกันภายใน codebase เดียว: วาง interface ไว้หน้า implementation เก่า สร้างตัวใหม่ไว้ข้างหลังมัน สลับ แล้วลบตัวเก่าทิ้ง
- [Anti-Corruption Layer](../anti-corruption-layer/) คือญาติในระดับสถาปัตยกรรม ระหว่าง bounded context สองตัว layer นี้แปลงทั้ง model (ชื่อ, รหัส, entity และความหมายของมัน) ไม่ใช่แค่ method signature ตัวเดียว มันเลยรวม adapter, facade และ translator ไว้ด้วยกัน มันอาจรันเป็น service แยกของตัวเองก็ได้ ทำให้มี network hop เพิ่ม และมีของต้อง deploy, scale และ monitor เพิ่มอีกหนึ่งอย่าง กฎยังเหมือนเดิม: ภาษาของอีกฝั่งต้องหยุดอยู่ที่ layer นี้
- ใน [Hexagonal Architecture](../hexagonal-architecture/) ตัว `PaymentGateway` จะเป็น driven port และ `LegacyPayAdapter` เป็น driven adapter แพตเทิร์นของ GoF คือกลไกในระดับ class ส่วน ports and adapters ทำให้มันเป็นกฎสำหรับ dependency ภายนอกทุกตัว

**ญาติ ๆ** หลายแพตเทิร์นวาง object ตัวหนึ่งไว้หน้า object อื่น สิ่งที่แต่ละตัวทำกับ interface คือสิ่งที่แยกพวกมันออกจากกัน

- [Facade](../facade/) นิยาม interface *ใหม่*ที่ง่ายกว่าครอบ subsystem ทั้งก้อน ส่วน adapter ทำให้ class *ตัวเดียว*เข้ากับ interface ที่มีอยู่แล้ว
- [Decorator](../decorator/) คง interface ของ object ที่ถูกห่อไว้แล้วเพิ่มพฤติกรรม decorator เลยซ้อนกันได้ ส่วน adapter มีข้างนอกต่างจากข้างใน
- Proxy ก็คง interface ของ subject ไว้เหมือนกัน และคุมการเข้าถึงมัน: สร้างแบบ lazy, เรียกแบบ remote, เช็ก permission
- Bridge อาจดูเหมือน object adapter ใน class diagram แต่มันถูกออกแบบไว้ตั้งแต่แรก เพื่อให้ abstraction กับ implementation ของมันเปลี่ยนแยกกันได้ ส่วน adapter ถูกเพิ่มเข้ามาทีหลัง เพื่อให้ class ที่มีอยู่แล้วทำงานด้วยกันได้

**ตอนที่ภาษาช่วยได้** ถ้ามี structural typing (TypeScript, Go) object ที่หน้าตาถูกอยู่แล้วก็ตรงกับ interface ได้เลย ไม่ต้องมี `implements` และไม่ต้องห่อ เลยเขียน adapter แค่ตอนที่หน้าตาต่างกันจริง ๆ ถ้า target เป็น function ตัวเดียว แค่ closure ก็พอ: `util.promisify` คือ adapter ที่เขียนเป็น higher-order function ส่วนบางภาษาทำให้ type ที่มีอยู่แล้วเข้ากับ interface ใหม่ได้โดยไม่ต้องห่อเลยด้วยซ้ำ: [Swift extension](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/protocols/#Adding-Protocol-Conformance-with-an-Extension) เพิ่ม protocol conformance ให้ type ที่เราไม่มี source ได้ และ [Rust](https://doc.rust-lang.org/book/ch10-02-traits.html) ให้ implement trait ของเราเองกับ type จาก crate อื่นได้ (orphan rule ห้ามแค่ตอนที่ทั้ง trait และ type มาจากข้างนอก)

**adapter ใน standard library และ framework:**

- `InputStreamReader` ของ Java ห่อ `InputStream` แบบ byte ไว้แล้วเปิด `Reader` แบบตัวอักษร โดย decode byte ด้วย charset ตัว `Arrays.asList` คืน `List` ขนาดคงที่ที่มี array อยู่ข้างหลัง: การเขียนจะทะลุไปถึง array และ method ที่จะเปลี่ยนขนาดจะ throw `UnsupportedOperationException` ส่วน `Enumeration.asIterator()` (Java 9) แปลง `Enumeration` แบบเก่าให้เป็น `Iterator`
- `io.TextIOWrapper` ของ Python ใส่ interface แบบ text ให้ binary stream ที่มี buffer
- `util.promisify` ของ Node.js (ตั้งแต่ Node.js 8) เปลี่ยน function ที่รับ callback แบบ error-first ให้เป็น function ที่คืน promise ส่วนการเรียกมันกับ function ที่คืน promise อยู่แล้วถูก deprecate ไปตั้งแต่ Node.js 20.8
- ใน Spring MVC ตัว `DispatcherServlet` เรียก handler ทุกตัวผ่าน [`HandlerAdapter`](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet/special-bean-types.html) มันเลยไม่ต้องรู้เลยว่า handler แต่ละแบบถูกเรียกยังไง
