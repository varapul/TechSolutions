## ปัญหา

หน้า checkout ต้องคิดค่าส่ง และร้านก็มีให้เลือกหลายแบบ: ค่าส่งเหมาจ่าย ราคาต่อกิโลกรัม บริการด่วน เวอร์ชันแรกมักใส่ทั้งหมดไว้ใน method เดียว `shippingCost(order, method)` ที่รับตัวเลือกของลูกค้ามาเป็น string แล้วแตก branch ตามค่านั้นด้วย `if` กับ `else if`

กฎใหม่ทุกข้อ อย่างส่งฟรีเมื่อซื้อครบ EUR 50 หมายถึงต้องเปิด method นั้นแก้อีกรอบ กฎแต่ละข้ออ่าน มีเจ้าของ หรือ test แยกกันไม่ได้: test ของ method นี้ต้องครอบคลุมทุก branch และการแก้เพื่อกฎข้อหนึ่งก็อาจทำกฎข้ออื่นพัง การแตก branch ตาม `method` ยังมักลามออกไปด้วย เพราะการประมาณวันส่ง ป้ายชื่อของตัวเลือก และการจอง carrier ก็ต้องรู้ method เหมือนกัน แล้วทุกจุดที่ก็อปไปก็ต้องตามหาและแก้ให้ครบ

## ทำงานยังไง

Strategy ให้อัลกอริทึมแต่ละแบบมี class ของตัวเอง อยู่หลัง interface เดียวกัน โค้ดที่ต้องใช้อัลกอริทึมจะถือ reference ไปที่ object ตัวใดตัวหนึ่งในนี้ แล้วเรียกผ่าน interface เลยไม่ต้องแตก branch ว่าตัวเองถือแบบไหนอยู่ การตัดสินว่าจะใช้แบบไหนกลายเป็นงานของคนอื่น: ใครก็ตามที่เป็นคนกำหนด reference ตัวนั้น ตัว pattern นี้เป็นหนึ่งใน behavioural pattern ใน *Design Patterns* ของ Gamma, Helm, Johnson และ Vlissides (1994) และในเล่มก็เรียกมันอีกชื่อว่า *Policy*

| ส่วนประกอบ | ใน diagram | หน้าที่ |
|---|---|---|
| **Strategy** | `ShippingStrategy` | interface ที่ทุกแบบต้อง implement ในที่นี้มี method เดียวคือ `cost(order)` |
| **ConcreteStrategy** | `Standard`, `ByWeight`, `Express`, `FreeOver50` | แต่ละตัวคืออัลกอริทึมหนึ่งแบบ พวกมันไม่รู้จักกันเอง และไม่รู้จัก checkout ด้วย |
| **Context** | `Checkout` | ถือ strategy ไว้หนึ่งตัว โดยมี type เป็น interface แล้ว delegate งานไปให้มัน ส่วน `setStrategy()` ให้ client เปลี่ยนตัวนั้นได้ |

client (ในที่นี้คือหน้า checkout) สร้าง strategy แล้วส่งให้ context จากนั้นก็คุยกับแค่ `Checkout` อย่างเดียว เงื่อนไขไม่ได้หายไปไหน: มันกลายเป็นการเลือก object ที่ทำครั้งเดียวตรงที่ลูกค้าคลิก แทนที่จะเป็น branch ที่รันอยู่ในโค้ดคิดราคาทุกครั้งที่เรียก

**context กับ strategy ใช้ข้อมูลร่วมกันยังไง** strategy ต้องมี input และในหนังสือก็อธิบายไว้สองวิธี:

- **ส่งข้อมูลไปให้** `cost(order)` รับสิ่งที่ต้องใช้มาเป็น argument ตัว strategy เลยไม่ผูกกับ `Checkout` และ test ง่าย แต่ argument ต้องครอบคลุมสิ่งที่ strategy *ตัวไหนก็ได้* อาจต้องใช้ การส่ง order ทั้งก้อนแทนที่จะส่งทีละ field ช่วยให้ interface นิ่ง: ถ้าเป็น `cost(kg)` การมาของ `FreeOver50` (กฎแรกที่ดู subtotal) จะทำให้ต้องเปลี่ยน interface และทุก class ที่ implement มัน
- **ส่ง context ไปให้** ถ้าใช้ `cost(checkout)` แต่ละ strategy จะถามสิ่งที่ต้องใช้จาก context เอง interface ไม่ต้องเปลี่ยนเลย แต่ strategy ทุกตัวก็จะผูกกับ method ของ `Checkout` ทำให้ทั้งสองฝั่ง reuse และ test แยกกันได้ยากขึ้น

การส่งค่าเล็ก ๆ ที่ immutable อย่าง order มักเป็น default ที่ดีกว่า ให้ส่ง context ไปเมื่อ strategy ต้องใช้ข้อมูลที่ต้นทุนสูงถ้าจะรวบรวมไว้ล่วงหน้า และมีแค่บางตัวที่ใช้

**เลือก strategy ยังไง** pattern นี้ไม่ได้บอกว่าใครเป็นคนตัดสิน ในทางปฏิบัติก็มักเป็นหนึ่งในนี้:

- **ผู้ใช้** อย่างใน diagram: ตัวเลือกที่ผู้ใช้เลือกจะกลายเป็น strategy object
- **Configuration**: ค่าที่ตั้งแยกตาม market, tenant หรือ environment แล้วอ่านตอน start-up
- **factory หรือ registry** ที่ map ชื่อไปเป็น strategy อย่าง `rules[name]` ในโค้ดด้านล่าง การ lookup ที่เหลืออยู่ครั้งเดียวก็จะอยู่ในที่เดียว และตัวเลือกบนหน้าก็ generate จาก list เดียวกันได้ กฎใหม่เลยไม่ต้องไปแตะหน้านั้นเหมือนกัน ส่วน dependency-injection container ก็สร้าง registry นี้ให้ได้: อย่าง Spring ก็ [inject `Map<String, ShippingStrategy>` ให้](https://docs.spring.io/spring-framework/reference/core/beans/annotation-config/autowired.html) ได้ โดยใส่ทุก bean ของ type นั้น และใช้ชื่อ bean เป็น key
- **feature flag** ที่ค่าของมันเป็นชื่อ strategy ทำให้ปล่อยกฎใหม่ให้ลูกค้าบางกลุ่มก่อนได้ แล้วปิดได้โดยไม่ต้อง deploy (ดู [Feature Flags](../feature-flags/))

## โค้ด

TypeScript ที่ตรงกับ diagram ตัว Node 22.18 ขึ้นไปรันได้เลยตามนี้ (`node shipping.ts`): มันแค่ตัด type ทิ้งโดยไม่ได้เช็ก เลยต้องรัน `tsc --noEmit` ด้วย เพื่อจับ class ที่ implement `cost()` ผิด เงินเก็บไว้เป็น cent จำนวนเต็ม (490 คือ EUR 4.90) แล้วค่อยแปลงเป็นยูโรตอนแสดงผล เลยไม่ต้องปัดเศษอะไรเลย ส่วนใน diagram แสดงจำนวนเดียวกันเป็นยูโร

```ts
// Money is kept in integer cents (490 is EUR 4.90), so nothing needs rounding.
interface Order {
  readonly kg: number;
  readonly subtotal: number; // cents
}

// Strategy: the one operation every shipping rule offers.
interface ShippingStrategy {
  cost(order: Order): number; // cents
}

// ConcreteStrategies: one small class per rule.
class Standard implements ShippingStrategy {
  cost(_order: Order): number { return 490; }                  // flat 4.90
}
class ByWeight implements ShippingStrategy {
  cost(order: Order): number { return 150 * order.kg; }       // 1.50 per kg
}
class Express implements ShippingStrategy {
  cost(order: Order): number { return 1200 + 100 * order.kg; } // 12 + 1 per kg
}

// Context: holds one strategy and never asks which one it is.
class Checkout {
  private strategy: ShippingStrategy;
  constructor(strategy: ShippingStrategy) { this.strategy = strategy; }
  setStrategy(strategy: ShippingStrategy): void { this.strategy = strategy; }
  shippingCost(order: Order): number { return this.strategy.cost(order); }
}

const eur = (cents: number): string => (cents / 100).toFixed(2);
const order: Order = { kg: 3, subtotal: 4200 };

const checkout = new Checkout(new Standard());
console.log(eur(checkout.shippingCost(order)));  // 4.90
checkout.setStrategy(new ByWeight());             // the customer picks another option
console.log(eur(checkout.shippingCost(order)));  // 4.50
checkout.setStrategy(new Express());
console.log(eur(checkout.shippingCost(order)));  // 15.00

// A new rule is a new class; Checkout and the other rules stay as they are.
class FreeOver50 implements ShippingStrategy {
  cost(order: Order): number { return order.subtotal >= 5000 ? 0 : 490; }
}
checkout.setStrategy(new FreeOver50());
console.log(eur(checkout.shippingCost(order)));                      // 4.90
console.log(eur(checkout.shippingCost({ kg: 3, subtotal: 5700 })));  // 0.00

// The functional form: a strategy is any function with this signature.
type ShippingRule = (order: Order) => number; // cents
const rules: Record<string, ShippingRule> = {
  standard: () => 490,
  byWeight: (o) => 150 * o.kg,
  express: (o) => 1200 + 100 * o.kg,
  freeOver50: (o) => (o.subtotal >= 5000 ? 0 : 490),
};
const rule = rules['byWeight'];  // e.g. the value of the selected radio button
console.log(eur(rule(order)));   // 4.50
```

ผลลัพธ์:

```
4.90
4.50
15.00
4.90
0.00
4.50
```

## ใช้ตอนไหนดี

- อัลกอริทึมเดียวที่มีหลายเวอร์ชันสลับกันได้ (ค่าส่ง การตั้งราคา ภาษี การจัดอันดับ การบีบอัด) ที่เลือกต่อ user ต่อ request หรือต่อ deployment และ list ก็ยาวขึ้นเรื่อย ๆ
- เงื่อนไขที่ switch ตาม type code หรือชื่อ method โดยเฉพาะเมื่อ switch แบบเดียวกันโผล่อยู่หลายที่
- แบบต่าง ๆ ที่ควรพัฒนา test หรือมีเจ้าของแยกกัน หรือเพิ่มเข้ามาเป็น plug-in
- ไม่ใช่ตอนที่แต่ละแบบต่างกันแค่ตัวเลข สามในสี่กฎที่นี่เป็นสูตรเดียวกัน คือราคาตั้งต้นบวกราคาต่อกิโลกรัม (`Standard` คือ 4.90 + 0 × kg, `ByWeight` คือ 0 + 1.50 × kg, `Express` คือ 12 + 1 × kg) และถ้าทุกกฎมีหน้าตาแบบนี้ ตารางอัตราค่าส่งตารางเดียวก็ดีกว่า class สี่ตัว ส่วน Strategy จะคุ้มก็ตอนที่อัลกอริทึมต่างกันคนละแบบจริง ๆ อย่าง threshold ใน `FreeOver50`
- ไม่ใช่ตอนที่มีแค่สองแบบและจะไม่เปลี่ยนอีก (ใช้ `if` ชัดกว่า) และไม่ใช่ตอนที่ object ควรเปลี่ยนพฤติกรรมเองเมื่อมันย้ายจาก state หนึ่งไปอีก state หนึ่ง (แบบนั้นคือ [State](../state/))

## ได้อะไร เสียอะไร

- **type เยอะขึ้น** กฎทุกข้อเป็น class หนึ่งตัว บวก interface ที่ใช้ร่วมกันอีกตัว ถ้าใช้ function ก็ตัดพิธีรีตองพวกนี้ไปได้เกือบหมด (ดูด้านล่าง)
- **ต้องมีคนรู้ว่ามีตัวเลือกอะไรบ้าง** จะเลือก strategy ได้ client ต้องรู้ว่ามีตัวไหนบ้างและต่างกันยังไง ในหนังสือนับเรื่องนี้เป็นหนึ่งในต้นทุนของ pattern นี้ ถ้ามี registry ที่อธิบาย strategy แต่ละตัว (ชื่อกับ label) ความรู้นี้ก็จะอยู่ในที่เดียว
- **interface เดียวสำหรับทุกตัว** strategy ทุกตัวได้ input เหมือนกัน ตัวง่าย ๆ เลยต้องมองข้ามข้อมูลที่ตัวซับซ้อนต้องใช้ และกฎที่ต้องการอะไรใหม่ก็จะเปลี่ยน interface ของทุกตัว
- **Indirection** อ่าน `Checkout` แล้วไม่รู้อีกต่อไปว่าคิดค่าส่งยังไง ต้องรู้ว่าตอน runtime มันถือ object ไหนอยู่
- **ส่วนที่ได้กลับมา** คือกฎใหม่เป็นแค่ class ใหม่โดยไม่มีอะไรอื่นต้องเปลี่ยน กฎแต่ละข้ออ่านและ test แยกกันได้ และเปลี่ยนตัวเลือกได้ระหว่างที่โปรแกรมรันอยู่

## ข้อควรรู้ตอนลงมือทำ

- **มันคือการ refactor** การเปลี่ยนจาก step 1 ไป step 2 คือสิ่งที่ catalog ของ Martin Fowler เรียกว่า [*Replace Conditional with Polymorphism*](https://refactoring.com/catalog/replaceConditionalWithPolymorphism.html) และใน catalog ก็มี *Replace Type Code with State/Strategy* ที่เกี่ยวข้องกันด้วย สร้าง class สำหรับแต่ละ branch ย้ายเนื้อของแต่ละ branch ไปไว้ใน method ของ class นั้น แล้วแทนเงื่อนไขด้วยการเรียกครั้งเดียว ถ้าย้ายทีละ branch ตัว test ก็จะผ่านตลอดทาง
- **แบบ functional** ถ้า strategy มีแค่ operation เดียว และภาษาที่ใช้ให้ function เป็นค่าได้ ตัว interface ก็เป็น function type ได้ อย่าง `type ShippingRule = (order: Order) => number` แล้ว strategy แต่ละตัวก็เป็น function หรือ lambda ส่วนใน standard library ก็มีของแบบนี้เต็มไปหมด:
  - [`Array.prototype.sort()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort) ของ JavaScript รับ compare function ถ้าไม่ส่งไป มันจะแปลง element เป็น string แล้วเทียบตาม UTF-16 code unit ทำให้ `[10, 9, 1].sort()` คืน `[1, 10, 9]` ส่วน `(a, b) => a - b` จะเรียงพวกมันแบบตัวเลข
  - [`Comparator`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/Comparator.html) ของ Java เป็น functional interface เลยส่ง lambda หรือ `Comparator.comparing(…)` ไปให้ `List.sort()`, `Collections.sort()` หรือ `TreeMap` ได้
  - [key function](https://docs.python.org/3/howto/sorting.html) ของ Python: `list.sort()`, `sorted()`, `min()`, `max()`, `heapq.nsmallest()` และ `heapq.nlargest()` รับ function `key` แล้วเรียกมันครั้งเดียวต่อ element เพื่อคำนวณค่าที่จะเอาไปเทียบ ส่วน `functools.cmp_to_key()` ใช้แปลง comparison function แบบเก่าให้ใช้ได้

  interface ที่มี method ยังชัดกว่า เมื่อ strategy มี **หลาย operation ที่เปลี่ยนไปด้วยกัน** (ราคา วันส่งโดยประมาณ และ label ที่แสดงให้ลูกค้าเห็น) เมื่อมันมี configuration ของตัวเอง หรือเมื่อมันต้องมีชื่อเพื่อเอาไป list, register และ log ตัว class เก็บของพวกนี้ไว้ด้วยกัน และ compiler ก็เช็กให้ว่า strategy แต่ละตัว implement ครบทุกอัน
- **ใช้ strategy ที่ไม่มี state ร่วมกัน** กฎคิดค่าส่งไม่มีตัวไหนเก็บ state ทำให้ใช้ instance เดียวของแต่ละตัวกับทุก checkout ได้ แม้จะข้าม thread ก็ตาม และในหนังสือก็แนะนำให้แชร์ strategy แบบนี้ เหมือนที่ [Flyweight](../flyweight/) แชร์ object ส่วน `String.CASE_INSENSITIVE_ORDER` ของ Java ก็คือ `Comparator` instance เดียวที่ใช้ร่วมกัน แต่ strategy ที่มี state ต่อการใช้งาน เช่นตำแหน่งของ round-robin ต้องมี instance หนึ่งตัวต่อ context หรือต้องเก็บ state นั้นไว้ที่อื่น
- **ค่า default** ตัว context เริ่มด้วย strategy ที่สมเหตุสมผลไว้ก่อนได้ ในที่นี้คือ `Standard` เพื่อให้ client ง่าย ๆ ไม่ต้องเลือก ในหนังสือยังพูดถึง context ที่ทำงานได้โดยไม่มี strategy object เลย แล้วกลับไปใช้พฤติกรรมของตัวเองแทน
- **test strategy แต่ละตัวแยกกัน และ test context ด้วย stub** ตัว strategy เป็น function ของ input ของมัน: `new FreeOver50().cost({ kg: 3, subtotal: 5000 })` ควรคืน 0 และ subtotal 4999 ควรคืน 490 ส่วน `Checkout` ไม่ต้องใช้กฎจริงเลย: ใน TypeScript แค่ `new Checkout({ cost: () => 123 })` ก็พอ ไม่ต้องใช้ mocking library
- **เงิน** เก็บจำนวนเงินเป็นหน่วยย่อยแบบจำนวนเต็ม หรือใช้ decimal type และปัดเศษในจุดเดียวที่ตกลงกันไว้ กฎพวกนี้ให้ผลเป็น cent เต็ม ๆ เลยไม่เคยต้องปัด
- **ตอน compile** ใน C++ ตัว strategy เป็น template parameter ได้ แบบนี้ไม่เสียอะไรเลยตอน runtime แต่เปลี่ยนหลัง compile ไม่ได้ [`Compare` parameter ของ `std::map`](https://en.cppreference.com/cpp/container/map) ที่ default เป็น `std::less<Key>` เป็นตัวตัดสินว่าจะเรียง key ยังไง ในหนังสือก็พูดถึงแบบนี้ด้วย
- **เจอได้ที่ไหนบ้าง**
  - Java: `ThreadPoolExecutor` รับ [`RejectedExecutionHandler`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/concurrent/RejectedExecutionHandler.html) ที่ตัดสินว่าจะทำยังไงกับ task ที่มันรับไม่ได้ มี policy ให้มาสี่แบบ และตัว default คือ `AbortPolicy` ที่จะ throw exception
  - Node.js: [Passport](https://www.passportjs.org/concepts/authentication/strategies/) เรียกกลไก authentication แต่ละแบบว่า *strategy* และแอปพลิเคชันก็ register ตัวที่ใช้ด้วย `passport.use()`
  - sort function ข้างบน
- **pattern ที่คล้ายกัน** หลาย pattern มีรูปร่างแบบเดียวกับ Strategy: object ตัวหนึ่ง delegate งานบางส่วนไปให้อีก object ผ่าน interface แต่ละตัวต่างกันที่ intent:
  - [State](../state/) มีโครงสร้างเดียวกัน แต่ state object (หรือ context) จะสลับไป state ถัดไปเองเมื่อ request เข้ามา และ client มักไม่ได้มีส่วนร่วม ส่วนใน Strategy ตัว client เป็นคนเลือก object และ strategy แต่ละตัวไม่รู้จักกัน
  - [Template Method](../template-method/) ล็อกโครงของอัลกอริทึมไว้ใน base class แล้วให้ subclass เติมบาง step เข้าไป นั่นคือ inheritance ที่ตัดสินกันต่อ class ตอนเขียนโค้ด ส่วน Strategy สลับทั้งอัลกอริทึมด้วย composition ต่อ object ระหว่างที่โปรแกรมรัน
  - [Bridge](../bridge/) ก็ delegate ไปที่ implementation object เหมือนกัน แต่จุดประสงค์ของมันเป็นเรื่องโครงสร้าง: มันแยก hierarchy เดียวออกเป็นสองชุดที่โตแยกกันได้ (เช่น shape กับ renderer) และมักออกแบบไว้ตั้งแต่แรก ส่วน strategy คืออัลกอริทึมหนึ่งตัวที่สลับกันได้
  - [Command](../command/) เปลี่ยน request (จะทำอะไร และใช้ argument อะไร) ให้เป็น object เพื่อเอาไปเข้า queue, log หรือ undo ได้ ส่วน strategy คือ*วิธี*ที่ context ทำงานที่มันรู้อยู่แล้วว่าต้องทำ
  - [Decorator](../decorator/) ห่อ object แล้วเพิ่มพฤติกรรมรอบ ๆ การเรียกของมัน โดยที่ interface ยังเหมือนเดิม ส่วน Strategy เปลี่ยนพฤติกรรมข้างใน object ในหนังสือเทียบสองตัวนี้ว่าเป็นการเปลี่ยน "ผิว" ของ object กับการเปลี่ยน "ไส้ใน" ของมัน
- **ในระดับ architecture**
  - อัลกอริทึมของ load balancer ก็คือ strategy ที่เลือกผ่าน configuration ตัว [NGINX](https://nginx.org/en/docs/http/ngx_http_upstream_module.html) ใช้ weighted round robin เว้นแต่ block `upstream` จะระบุ method อื่นไว้ เช่น `least_conn`, `ip_hash`, `hash` หรือ `random` ส่วน target group ของ [AWS Application Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-target-group-attributes.html) ใช้ round robin เป็น default และเปลี่ยนไปใช้ least outstanding requests หรือ weighted random ได้ โดยใช้ได้ทีละอัลกอริทึม มีสองอย่างที่เปลี่ยนไปในระดับนี้: อัลกอริทึมต้องใช้ข้อมูลสดจาก context ของมัน (request ที่ค้างอยู่ต่อ instance) เลยมี state และแชร์กันตามใจไม่ได้ และการสลับมันเป็นการเปลี่ยน configuration ไม่ใช่เปลี่ยนโค้ด ดู [Load Balancing](../load-balancing/)
  - feature flag ที่คืนชื่อ variant แล้วเอาไป lookup ใน registry อย่าง `rules` จะเลือก strategy ให้แต่ละ request กฎคิดราคาใหม่เลยไปถึงลูกค้า 5% ก่อนได้ แล้วปิดกลับได้โดยไม่ต้อง deploy ดู [Feature Flags](../feature-flags/)
