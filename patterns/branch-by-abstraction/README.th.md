## ปัญหา

การเปลี่ยนแปลงบางอย่างใส่ไว้ใน commit เดียวไม่ได้ การเปลี่ยน client ของ payment provider, object-relational mapper, HTTP library หรือ pricing engine แปลว่าต้องไปแตะของที่ถูกเรียกจากหลายที่ และตัวที่จะมาแทนก็ใช้เวลาเขียนเป็นสัปดาห์ ในขณะที่แอปพลิเคชันก็ยังต้อง ship ต่อไป

ปฏิกิริยาแรกคือแตก branch ใน version control: ทำงานในนั้นแล้ว merge ตอนเสร็จ แต่ branch ที่อยู่เป็นสัปดาห์ต้องจ่ายราคาตอนจบ

- **merge ยากขึ้นตามระยะห่าง** main branch ขยับทุกวัน และงานแทนที่ก็ไปแตะโค้ดที่การเปลี่ยนแปลงของคนอื่นทุกคนเรียกใช้พอดี conflict ในตัวอักษรเป็นส่วนที่ง่าย ส่วนที่แพงคือสิ่งที่ Martin Fowler เรียกว่า semantic conflict: สองฝั่ง merge กันได้เรียบร้อย แต่ผลลัพธ์ build ไม่ผ่าน หรือ build ผ่านแต่ทำงานผิด
- **ไม่มีอะไรถูก integrate จนถึงตอนจบ** หลายสัปดาห์ที่โค้ดใหม่ไม่เคยถูก compile เทสต์ หรือรันร่วมกับงานของคนอื่นในทีมเลย และมันไปถึง production ใน release ก้อนใหญ่ก้อนเดียวที่แบกความเสี่ยงทั้งหมดไว้พร้อมกัน
- **มันแช่แข็งโค้ดรอบ ๆ** ใครที่ refactor ส่วนที่โดนผลกระทบบน main branch ก็ทำให้ merge ที่กำลังจะมาแย่ลง คนก็เลยเลิก refactor กันไป ส่วน Fowler มองว่าการที่มันทำให้คนไม่กล้า refactor แบบนี้อาจเป็นปัญหาใหญ่ที่สุดของ feature branch
- **วางมันลงไม่ได้** branch ที่ทำไปครึ่งเดียวแล้วต้องรอหนึ่งเดือนเพราะมีโปรเจกต์ด่วนแทรก ต้องถูก merge ตามให้ทันอีกรอบก่อนจะกลับมาทำงานต่อได้

ทีมที่ทำ continuous integration เลี่ยงเรื่องนี้ด้วยการทำ branch ให้สั้น งานวิจัยของ DORA เชื่อมโยง delivery performance ที่สูงกว่า กับการมี active branch ไม่เกินสามตัว การ merge เข้า trunk อย่างน้อยวันละครั้ง และการไม่มี code freeze หรือช่วง integration แยก ส่วน trunk-based development guide ก็ให้ feature branch อยู่ได้อย่างมากแค่สองสามวัน งานแทนที่ที่ใช้เวลาเป็นสัปดาห์ใส่ใน branch แบบนั้นไม่ได้ และ branch by abstraction ก็คือวิธีทำงานนี้โดยไม่ต้องมี branch

## ทำงานยังไง

เอา branch ไปไว้ในโค้ดแทนที่จะไว้ใน version control แล้วใส่ abstraction คั่นระหว่างตัวเรียกกับ component ที่จะถูกแทนที่ ให้ implementation ตัวเก่ากับตัวใหม่อยู่คู่กันข้างหลังมันบน main branch แล้วมี switch คอยตัดสินว่าจะใช้ตัวไหน ทุก commit ระหว่างทางเล็ก และทำให้แอปพลิเคชันยังพร้อม release อยู่เสมอ

ไดอะแกรมแสดงการแทนที่ client ของ payment provider ตัวเก่าชื่อ LegacyPay ด้วยตัวใหม่ชื่อ NewPay โดยมีสามส่วนของแอปพลิเคชันที่เรียกมัน: Checkout, Invoicing และ Reports ส่วนบนแถบด้านบน เครื่องหมายถูกสีเขียวแต่ละอันคือ commit บน main branch ที่ build เทสต์ และ release ไปแล้ว จุดเล็ก ๆ คืองานของคนอื่นที่ลงมาคั่นระหว่างนั้น และรูปเพชรคือการเปลี่ยน flag

1. **สร้าง seam** เพิ่ม abstraction ที่บอกว่าตัวเรียกต้องการอะไร (`PaymentGateway` ที่มี `charge`, `refund` และ `payouts`) แล้วเอา implementation ที่มีอยู่ไปไว้ข้างหลัง โดยถ้า API เก่ามีหน้าตาต่างออกไป ก็ให้ผ่าน adapter บาง ๆ ตอนนี้ยังไม่มีอะไรทำงานต่างไปจากเดิม
2. **ย้ายตัวเรียกมาใช้มันทีละตัว** ตัวเรียกแต่ละตัวที่เลิกใช้ client เก่าตรง ๆ คือ commit เล็ก ๆ หนึ่งอัน ในไดอะแกรมนับจำนวนการเรียกตรงลดลงจากสามเหลือศูนย์ จนกว่าตัวเรียกตัวสุดท้ายจะย้ายเสร็จ ทั้งสองแบบก็อยู่ด้วยกันไปก่อน และทุก commit ระหว่างนั้นก็ยัง build ได้ ผ่านเทสต์ และถูก release
3. **สร้าง implementation ใหม่ไว้หลัง abstraction** มันค่อย ๆ โตบน main branch ทีละ commit ในที่นี้คือทีละ method มันถูก compile เทสต์ และ ship ไปกับทุก release แต่ switch ยังเลือก implementation เก่าอยู่ เลยไม่มีอะไรใน production ไปถึงมัน Fowler เรียกสิ่งนี้ว่า *latent code*: โค้ดที่อยู่ใน release ที่ live แล้ว ทั้งที่งานที่มันเป็นส่วนหนึ่งยังไม่เสร็จ
4. **สลับไป** ขยับ switch ไปที่ implementation ใหม่ เริ่มจากตัวเรียกเดียวหรือ environment เดียวก่อน แล้วค่อยขยับทั้งหมด ส่วน implementation เก่ายังอยู่ที่เดิม ทางถอยกลับเลยก็คือตัว switch นั่นเอง
5. **เก็บกวาด** ลบ implementation เก่า แล้วค่อยลบ switch เก็บ abstraction ไว้ถ้ามันเป็นขอบเขตที่คุ้มจะมี และ inline ทิ้งถ้าไม่ใช่

ไดอะแกรมรวมสองข้อแรกไว้เป็น step เดียว ถ้ามองจาก main branch การแทนที่ทั้งหมดคือ commit เล็ก ๆ สิบอันกับการเปลี่ยน flag สองครั้ง

| การเปลี่ยนแปลง | production ใช้อะไร | ทางถอย |
|---|---|---|
| เพิ่ม `PaymentGateway` โดยมี client เก่าอยู่ข้างหลัง | client เก่า เรียกตรง ๆ | revert commit เล็ก ๆ หนึ่งอัน |
| ย้าย Reports แล้ว Invoicing แล้ว Checkout (ตัวละหนึ่ง commit) | client เก่า เรียกผ่าน interface | revert commit นั้น |
| เพิ่ม contract test และ switch | client เก่า | revert commit นั้น |
| สร้าง NewPay ทีละ method ต่อ commit | client เก่า ส่วนโค้ดใหม่ ship ไปแล้วแต่ไม่ถูกเรียก | ไม่มีอะไรต้องย้อน |
| *flag:* Reports ใช้ NewPay | NewPay สำหรับ Reports ส่วนที่เหลือใช้ client เก่า | สับ flag กลับ |
| *flag:* ตัวเรียกทุกตัวใช้ NewPay | NewPay | สับ flag กลับ |
| ลบ client ของ LegacyPay | NewPay | redeploy release ก่อนหน้า |
| ลบ switch | NewPay | |

**มาจากไหน** ทีมต่าง ๆ ทำงานแบบนี้กันมาก่อนที่เทคนิคนี้จะมีชื่อ Paul Hammant เขียนถึงมันในปี 2007 ใน [Introducing Branch By Abstraction](https://paulhammant.com/blog/branch_by_abstraction.html) ภายใต้ชื่อที่เขาให้เครดิตกับ Stacy Curl และวางไว้เป็นคู่ตรงข้ามกับการแตก branch ใน source control ส่วน [trunk-based development guide](https://trunkbaseddevelopment.com/branch-by-abstraction/) ของเขาก็มีคำอธิบายที่ยาวกว่านั้น guide นี้วางกฎสองข้อครอบทั้งกระบวนการไว้: ต้องไม่ทำให้คนอื่นในทีมช้าลง และต้องไม่ทำให้ความสามารถในการขึ้น production มีความเสี่ยงเลย บทความปี 2011 ของ Jez Humble ชื่อ [Make Large Scale Changes Incrementally with Branch By Abstraction](https://continuousdelivery.com/2011/05/make-large-scale-changes-incrementally-with-branch-by-abstraction/) แสดงเทคนิคนี้กับ product จริง ทีมที่ทำ Go ของ ThoughtWorks ที่เป็น server สำหรับ continuous integration และ release management ตอนนั้นใช้เวลาไปกว่าหนึ่งปีย้าย persistence จาก iBatis ไป Hibernate และกำลังย้าย user interface จาก Velocity และ JsTemplate ไป JRuby on Rails ด้วยวิธีเดียวกัน ในขณะที่ยังพัฒนา feature ใหม่บน mainline เดียวกันและ check in กันวันละหลายครั้ง บทสรุปปี 2014 ของ Martin Fowler ชื่อ [Branch By Abstraction](https://martinfowler.com/bliki/BranchByAbstraction.html) อธิบายลำดับเดียวกันในแง่ของ client และ supplier ส่วนหนังสือ *Continuous Delivery* (Jez Humble และ David Farley) และ *Monolith to Microservices* (Sam Newman) ก็พูดถึงมันทั้งคู่

### เทสต์ที่ทั้งสอง implementation ใช้ร่วมกัน

abstraction ยังเป็นจุดที่พฤติกรรมถูกตอกหมุดไว้ด้วย เขียนเทสต์กับ interface อย่างเดียว (`charge` คืนอะไรสำหรับบัตรที่ถูกปฏิเสธ และ `payouts` คืนอะไรสำหรับวันที่ไม่มี payout เลย) แล้วรันเทสต์ชุดเดียวกันกับทุก implementation เทสต์พวกนี้คือ contract test ในความหมายตรงตัว: มันบอกว่า implementation ไหนของ `PaymentGateway` ก็ตามต้องทำอะไร คำนี้ยังถูกใช้กับเทสต์ระหว่าง service ด้วย แต่ในที่นี้ contract คือ interface ภายใน codebase เดียว

implementation เก่าผ่านเทสต์พวกนี้ตั้งแต่แรก เพราะมันถูกเขียนขึ้นจากการสังเกตว่าตัวเก่าทำอะไร รวมถึงพฤติกรรมแปลก ๆ ที่ตัวเรียกเริ่มพึ่งพาไปแล้วด้วย ส่วนสำหรับ implementation ใหม่ เทสต์พวกนี้คือรายการงานและนิยามของคำว่าเสร็จ: ในไดอะแกรม method จะเปลี่ยนเป็นสีเขียวเมื่อเทสต์ของมันผ่าน ส่วนบน main branch ห้ามมี build แดง เทสต์ของ method ที่ implementation ใหม่ยังไม่มี เลยถูกข้ามไปสำหรับตัวใหม่ แล้วค่อยเปิดใน commit ที่เพิ่ม method นั้น รันเทสต์ชุดนี้กับทั้งสองตัวไปตลอดตราบที่ยังมีทั้งสองตัว นี่คือสิ่งที่ทำให้ implementation เก่ายังเป็นทางถอยที่ใช้ได้จริง

### Switch

มีที่เดียวที่ตัดสินว่า abstraction จะส่ง implementation ตัวไหนออกไป ที่ตรงนั้น dynamic แค่ไหน ก็กำหนดว่าการสลับไปและการถอยกลับจะเป็นแบบไหน

- **ในโค้ดหรือใน build** การ wiring (factory หรือ configuration ของ dependency injection) ระบุ implementation ตัวเดียว Humble อธิบายว่านี่คือกรณีปกติ: developer เป็นคนเลือก และสิ่งที่เลือกก็ถูก hard-code หรือถูกกำหนดตายตัวตอน build การสลับคือ commit บรรทัดเดียว และการถอยกลับคืออีก commit กับอีก release
- **ใน configuration ที่อ่านตอนเริ่มทำงาน** property หรือ environment variable เลือก implementation ทำให้ test และ staging รันตัวใหม่ได้ ในขณะที่ production ยังอยู่กับตัวเก่า การถอยกลับคือการเปลี่ยน configuration แล้ว restart
- **Runtime flag** abstraction ถาม [feature flag](../feature-flags/) ทุกครั้งที่ถูกเรียก ทำให้ switch ขยับได้ทีละตัวเรียก ทีละ tenant หรือทีละสัดส่วนของ traffic โดยไม่ต้อง deploy และขยับกลับได้ในไม่กี่วินาที เหตุผลของ Steve Smith คือ toggle ตอน runtime ลดต้นทุนของการสลับที่ผิดพลาด แบบนี้คือแบบที่อยู่ในไดอะแกรม

จะเป็นแบบไหนก็ตาม ให้สลับเป็นส่วน ๆ และเริ่มจากจุดที่พลาดแล้วเสียหายน้อยที่สุด Reports แค่อ่านข้อมูล ส่วน Checkout รับเงิน ก็เลยให้ Reports ไปก่อน ส่วน flag ตัวนี้เป็น release flag: มันอยู่แค่ตลอดช่วง migration และถูกลบไปพร้อมกับ switch

### รันทั้งคู่แล้วเทียบกัน

ผ่านเทสต์ชุดเดียวกันไม่ได้พิสูจน์ว่าพฤติกรรมเหมือนกันกับข้อมูลใน production ระหว่างที่มีทั้งสอง implementation อยู่ ก็ป้อน input เดียวกันให้ทั้งคู่แล้วเทียบผลก่อนขยับ switch ได้ นี่ก็คือ parallel run ในสเกลของ component เดียว Fowler ชี้ว่า flag ทำให้ supplier ตัวใหม่รันใน test environment ได้ จะได้เทียบพฤติกรรมของมันกับตัวเก่า ส่วนแบบของ Steve Smith ที่ชื่อ *verify branch by abstraction* ชี้ toggle ไปที่ implementation สำหรับตรวจสอบ ที่เรียกทั้งสองตัวด้วย input เดียวกัน แล้ว fail fast เมื่อผลไม่ตรงกัน แบบที่นุ่มนวลกว่าสำหรับ production จะเสิร์ฟผลของตัวเก่า เรียก implementation ใหม่ด้วย และบันทึกทุกความต่าง ส่วน library Scientist ของ GitHub ทำแบบนี้ให้ Ruby และมี port สำหรับภาษาอื่นด้วย

เทียบเฉพาะการเรียกที่ไม่เปลี่ยนอะไร การเทียบคำตอบสองชุดของ `payouts(day)` ไม่มีพิษภัย แต่การเรียก `charge` กับ provider ทั้งสองตัวจะเก็บเงินลูกค้าสองรอบ เอกสารของ Scientist ก็ขีดเส้นเดียวกัน: มันมีไว้สำหรับโค้ดที่ไม่เปลี่ยนข้อมูล

### Abstraction อยู่ที่ไหน

abstraction เป็นของฝั่งตัวเรียก มันบอกว่าตัวเรียกต้องการอะไรด้วยภาษาของตัวเรียก ไม่ใช่สิ่งที่ implementation เก่าบังเอิญมีให้: `charge(order)` ไม่ใช่ method ที่รับ request object ของ provider ตัวเก่า ในศัพท์ของ [hexagonal architecture](../hexagonal-architecture/) มันคือ driven port และ implementation สองตัวก็คือ adapter ถ้า codebase จัดแบบนั้นอยู่แล้ว ก็จะมี seam ของตัวเองอยู่แล้ว ส่วนตัวที่ไม่ได้จัดแบบนั้นก็จะได้ port แรกตรงนี้

abstraction ที่ดีสำหรับงานนี้ต้องแคบ (มีแค่ operation ที่ตัวเรียกใช้จริง) ไม่มี type ของ implementation เก่าปนอยู่ (ถ้า error code ของ LegacyPay ข้ามมันมาได้ ตัว implementation ใหม่ก็ต้องเลียนแบบ error code พวกนั้น) และออกแบบโดยคิดถึง implementation ใหม่ไว้ด้วย เตรียมใจไว้ว่าจะต้องปรับมันระหว่างที่ implementation ใหม่ค่อย ๆ เป็นรูปเป็นร่าง guide ของ Hammant ยอมให้ทำได้ภายใต้กฎเดียวกับทุก commit อื่น คือ build ต้องเขียวอยู่ตลอด ถ้า model ของ component เก่ารั่วเข้าไปในตัวเรียกแล้ว abstraction ก็ทำหน้าที่เป็น [anti-corruption layer](../anti-corruption-layer/) ไปด้วย

มันไม่ต้องเป็น interface ที่เขียนขึ้นมาเฉพาะกิจก็ได้ ในตัวอย่างของ Humble ตัว abstraction สำหรับการเปลี่ยน persistence คือ repository layer ที่แอปพลิเคชันมีอยู่แล้ว ส่วนของ user interface คือ servlet engine ที่ส่งแต่ละ URL ไปที่ stack เก่าหรือ stack ใหม่

### ตอนที่ข้อมูลต้องย้ายด้วย

การสลับ implementation ไม่ได้ย้าย state ของมันไปด้วย ถ้าตัวใหม่เก็บข้อมูลต่างออกไป (table อื่น หรือ ID ของลูกค้าและการชำระเงินของ provider อื่น) การ migrate ข้อมูลก็รันคู่กันไปเป็นขั้นที่ compatible ของมันเอง: เขียนทั้งสองที่, backfill, เทียบ, สลับการอ่าน, เลิกเขียนที่เก่า นี่คือ [expand and contract](../expand-and-contract/)

state ยังจำกัดทางถอยอีกด้วย อย่าง payment ที่รับผ่าน NewPay ต้อง refund ผ่าน NewPay แม้จะสับ flag กลับไปแล้วก็ตาม เพราะฉะนั้นสำหรับ operation ที่ทำกับ record ที่มีอยู่แล้ว switch เลยอาจต้องดูที่ record ด้วย ไม่ใช่ดูแค่ flag

### ไอเดียเดียวกันในระดับอื่น

[strangler fig](../strangler-fig/) ทำสิ่งเดียวกันในระดับที่สูงขึ้นไปหนึ่งขั้น มันวาง facade ไว้หน้าระบบ legacy ทั้งระบบ แล้วย้าย route ไปที่ service ใหม่ทีละอัน ข้าม deployable ส่วน branch by abstraction อยู่ใน codebase เดียวและ deployable เดียว: facade ของมันคือ interface และ route ของมันคือตัวเรียก สองตัวนี้ใช้ร่วมกันได้ โดยที่ implementation ใหม่ที่อยู่หลัง abstraction เป็น client ของ service ใหม่ได้ และนี่คือวิธีแกะ module ออกจาก monolith ส่วนใน modular monolith ตัว public interface ของ module ก็คือ abstraction

feature flag ซ่อน *feature* จาก user ตอน runtime ส่วน branch by abstraction เป็นวิธีจัดโครงสร้าง *การเปลี่ยนแปลง* ในโค้ด และ flag ก็ใช้เป็น switch ของมันได้ ส่วน expand and contract ก็คือรูปแบบเดียวกันที่ใช้กับ schema และ contract: เพิ่มของใหม่ไว้ข้างของเก่า ย้ายทุกคนข้ามไป แล้วลบของเก่า

## ใช้ตอนไหนดี

- **แทนที่ของที่มีตัวเรียกเยอะ:** SDK ของ provider, persistence framework, library สำหรับ messaging หรือ HTTP, module ที่ทำเองในบริษัทแล้วต้องเขียนใหม่
- **ทำ algorithm หรือ subsystem ใหม่** ที่ต้องทำงานได้ต่อและเปลี่ยนต่อไปได้ ระหว่างที่การทำใหม่ยังไม่เสร็จ
- **แยก module ออกจาก monolith** ไปเป็น service โดยมี client ของ service เป็น implementation ใหม่
- **การเปลี่ยนแปลงไหนก็ตามที่ถ้าไม่ทำแบบนี้จะค้างอยู่บน branch นานกว่าไม่กี่วัน** ในทีมที่ main branch ต้องพร้อม release ทุกวัน

**ตอนไหนไม่ควรใช้** การเปลี่ยนที่ใส่ใน branch อายุสั้นได้ งานวันสองวันที่ review และ merge เป็นก้อนเดียว ไม่ต้องใช้อะไรพวกนี้เลย: abstraction, implementation ตัวที่สอง และ switch จะแพงกว่าการ merge ส่วน component ที่มีตัวเรียกตัวเดียวก็เหมือนกัน ส่วนบางสถานการณ์ก็ต้องใช้ pattern ข้างเคียงแทน: feature ใหม่ที่ไม่มีอะไรให้แทนที่ใช้แค่ flag ก็พอ การเปลี่ยนรูปร่างของข้อมูลคือ expand and contract และการแทนที่ทั้งระบบข้าม deployable คือ strangler fig ส่วน trunk-based development guide ก็เพิ่มข้อจำกัดอีกข้อ: เทคนิคนี้ไม่ช่วยถ้าต้องดูแล release เก่า ๆ ให้ลูกค้าที่อัปเกรดตอนไหนก็ได้ตามใจ

## ได้อะไร เสียอะไร

- **มีชั้นอ้อมเพิ่มชั่วคราว** ตลอดช่วง migration โค้ดต้องแบก layer, switch และ flag เพิ่มมา ที่หลังจากนั้นจะไม่ต้องใช้แล้ว
- **ต้องดูแลให้สอง implementation ใช้งานได้** ทุก bug fix และทุก requirement ใหม่ในส่วนนั้นต้องลงสองที่จนกว่าตัวเก่าจะหายไป และ pipeline ก็ต้องทำให้ทั้งสองเส้นทางเขียวอยู่ ช่วงเปลี่ยนผ่านยิ่งยาว งานซ้ำซ้อนแบบนี้ก็ยิ่งเยอะ
- **ดูช้ากว่าบนกระดาษ** Humble พูดตรง ๆ เรื่อง overhead ที่โตขึ้นใน codebase ที่มีโครงสร้างน้อย เพราะต้องสร้าง seam ก่อนจะเริ่มอะไรได้ ส่วนต้นทุนของอีกทางเลือกแค่มองเห็นได้น้อยกว่า เพราะมันถูกเลื่อนไปจ่ายตอน merge
- **ต้องมีวินัยทำให้จบ** การเก็บกวาดไม่ได้เพิ่ม feature อะไร มันเลยเป็นขั้นที่ถูกทิ้ง migration ที่ค้างอยู่ที่ 80% ทิ้งไว้ให้มีสอง implementation, switch ที่ไม่มีใครกล้าลบ และคนใหม่ที่แยกไม่ออกว่าเส้นทางไหนคือตัวจริง วางแผนการลบตั้งแต่ตอนวางแผน abstraction และติดตามจำนวนตัวเรียกที่เหลือเป็นตัวเลข
- **แต่การพักหรือยกเลิกก็ถูก** เพราะ implementation ที่ยังไม่เสร็จถูก compile และเทสต์ไปพร้อมกับทุกอย่าง งานเลยหยุดไปได้หนึ่งเดือนแล้วกลับมาทำต่อโดยไม่ต้อง merge การยกเลิกก็คือลบ implementation ใหม่ และจะลบ abstraction ด้วยก็ได้ถ้าอยาก
- **โค้ดที่ยังไม่เสร็จถูก ship ไปด้วย** implementation ใหม่อยู่ในทุก release ตั้งแต่ commit แรก มันต้องผ่านมาตรฐานคุณภาพเดียวกับส่วนอื่นของ main branch ต้องเข้าถึงไม่ได้จนกว่า switch จะขยับ และ switch ต้องมี default เป็น implementation เก่า
- **abstraction ตัวเดียวอาจครอบทั้งสองตัวไม่ได้** ถ้าตัวเก่ากับตัวใหม่ต่างกันมากกว่าแค่ไส้ใน (ตอบทันที เทียบกับแจ้งผลทีหลัง หรือพฤติกรรมด้าน error หรือ consistency ต่างกัน) ก็ไม่มี interface ไหนซ่อนความต่างนั้นได้ และตัวเรียกก็ต้องเปลี่ยนด้วย
- **ทั้งคู่ต้องอยู่ร่วมกันใน build เดียว** library เดียวกันสอง major version ที่โหลดคู่กันไม่ได้ ต้องถูกแยกออกจากกันก่อน เช่นแยกเป็นคนละ module หรือคนละ process

## ข้อควรรู้ตอนลงมือทำ

- **หา seam ให้เจอ หรือสร้างขึ้นมา** หนังสือ *Working Effectively with Legacy Code* (2004) ของ Michael Feathers เป็นคนแรกที่ใช้คำว่า *seam* หมายถึงจุดที่เปลี่ยนพฤติกรรมจากข้างนอกได้ โดยที่โค้ดตรงจุดนั้นยังเหมือนเดิม: interface, constructor parameter, function ที่ส่งเข้ามา โค้ดที่เรียก static method, สร้าง dependency ของตัวเองในบรรทัด หรือส่ง type ของ SDK ไปมา ก็ไม่มี seam เลย สร้างมันขึ้นมาด้วยการ refactor เล็ก ๆ ที่ไม่เปลี่ยนพฤติกรรม: ห่อ API เก่าไว้ใน class ของคุณเอง extract interface ออกจาก class นั้น แล้วส่งมันให้ตัวเรียกแทนที่จะปล่อยให้ตัวเรียกไปหยิบ dependency เอง บทความของ Fowler เรื่อง legacy seam แสดงวิธีทำไว้หลายแบบ และหนังสือของ Feathers ก็มีทั้งภาคที่ว่าด้วยเทคนิคการตัด dependency ส่วนก่อนเริ่ม ให้เขียนเทสต์ที่บันทึกว่าโค้ดทำอะไรอยู่ในวันนี้
- **ใส่เฟืองกันถอยหลังให้วิธีเก่า** กฎของทีม Go คือห้ามใครเพิ่มของแบบเก่า และบทความของ Humble แนะนำให้บังคับกฎนี้ด้วยการทำให้ build fail ทุกครั้งที่จำนวน query แบบเก่าเพิ่มขึ้น ตัวเลขนี้จะได้มีแต่ลดลง วิธีเดียวกันใช้ได้กับการเรียก client เก่าตรง ๆ เหมือนกัน ส่วน `FreezingArchRule` ของ ArchUnit บันทึกการละเมิดกฎที่มีอยู่แล้ว รายงานเฉพาะตัวใหม่ และหดรายการลงเมื่อมีการแก้ และ `no-restricted-imports` ของ ESLint ห้ามการ import module และปิดได้สำหรับ adapter ตัวเดียวที่ได้รับอนุญาต ส่วน deprecation annotation บน API เก่าก็ช่วยบอกคนที่ linter เอื้อมไปไม่ถึง
- **switch ตัวเดียว อยู่ใน wiring** อย่าโปรย `if (flag)` ไว้ตามจุดเรียกต่าง ๆ ถ้าเป็น switch ตอนเริ่มทำงาน configuration ของ dependency injection ก็พอแล้ว: ใน Spring Boot ตัว `@ConditionalOnProperty(name = "payments.gateway", havingValue = "newpay")` ลงทะเบียน bean ก็ต่อเมื่อ property มีค่านั้น ส่วน switch ตอน runtime ก็คือ implementation อีกตัวของ interface ที่ถาม flag ทุกครั้งที่ถูกเรียก:

  ```java
  interface PaymentGateway {                       // the seam: what the callers need
      Receipt charge(Order order);
      Refund refund(Payment payment);
      List<Payout> payouts(LocalDate day);
  }

  final class SwitchedGateway implements PaymentGateway {
      private final PaymentGateway legacyPay, newPay;
      private final Flags flags;
      private final String caller;                 // "checkout", "invoicing" or "reports"

      SwitchedGateway(PaymentGateway legacyPay, PaymentGateway newPay, Flags flags, String caller) {
          this.legacyPay = legacyPay; this.newPay = newPay; this.flags = flags; this.caller = caller;
      }

      public Receipt charge(Order order)         { return current().charge(order); }
      public Refund refund(Payment payment)      { return current().refund(payment); }
      public List<Payout> payouts(LocalDate day) { return current().payouts(day); }

      private PaymentGateway current() {           // asked on every call, so a flip takes effect at once
          return flags.isOn("payments.newpay", caller) ? newPay : legacyPay;
      }
  }
  ```

  ตัวเรียกไม่มีวันรู้ว่ามีสอง implementation และการลบ switch ทีหลังก็คือการลบ class นี้กับ wiring อีกหนึ่งบรรทัด
- **รันเทสต์ชุดเดียวกับทั้งสองตัว** ใน JUnit Jupiter ให้ใส่เทสต์ไว้ใน test interface เป็น default method แล้ว implement interface นั้นหนึ่งครั้งต่อหนึ่ง implementation โดย user guide ก็อธิบายการใช้แบบนี้สำหรับ interface contract ไว้ ส่วนใน pytest ตัว fixture ที่ parametrize ด้วยทั้งสอง implementation จะรันทุกเทสต์ที่ใช้มันหนึ่งครั้งต่อตัว
- **ดูแต่ละ implementation แยกกัน** ติด tag ให้ metric และ log ว่า implementation ไหนเป็นตัวตอบการเรียก จะได้เทียบ error rate และ latency ระหว่างตัวเก่ากับตัวใหม่ได้ระหว่างที่ switch ขยับ และตัดสินใจไว้ก่อนว่าตัวเลขไหนแปลว่า "สับกลับ"
- **ลบแยก commit** ลบ implementation เก่าก่อน พร้อมกับของที่มีแค่มันที่ใช้ (dependency ของมันในไฟล์ build, configuration ของมัน, credential ของมัน) จะเหลือ switch ที่มีฝั่งเดียว จากนั้นค่อยลบ switch กับ flag เว้นเวลาไว้ระหว่างการเปลี่ยน flag ครั้งสุดท้ายกับการลบครั้งแรก เพราะหลังจากนั้นทางถอยจะเป็นการ redeploy ไม่ใช่การสับ flag อีกแล้ว
- **ตัดสินใจว่า abstraction จะเอายังไง** เก็บไว้ถ้ามันกั้น third party ไว้ ถ้ามันคือจุดที่การแทนที่ครั้งหน้าจะเกิดขึ้น หรือถ้าเทสต์ใช้มันสลับเป็นของปลอม แต่ให้ inline ทิ้งถ้ามันมี implementation ตัวเดียวและไม่ได้ซ่อนอะไร
