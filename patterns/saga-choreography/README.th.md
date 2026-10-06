## ปัญหา

การสั่ง order หนึ่งครั้งเปลี่ยนข้อมูลที่ service สี่ตัวเป็นเจ้าของ แต่ละตัวมี database ของตัวเอง: Orders บันทึก order, Payments ตัดเงินจากบัตร, Inventory จอง stock และ Shipping จอง courier ไม่มี local transaction ไหนครอบ database สี่ตัวได้ ส่วน distributed transaction ด้วย two-phase commit ต้องให้ทุก participant รองรับมันและติดต่อได้ในเวลาเดียวกัน แล้วยังถือ lock ไว้ในทุกตัวจนกว่า coordinator จะตัดสินใจ **saga** เลยเลือกทิ้ง transaction ก้อนเดียวไปแทน: แต่ละ service commit local transaction ของตัวเอง และขั้นไหนที่ต้องย้อนกลับก็ย้อนด้วย transaction ใหม่

แบบนี้ยังเหลือคำถามหนึ่งข้อ: ใครเป็นคนตัดสินว่าจะเกิดอะไรต่อ [orchestrator](../saga-orchestration/) ทำได้ ด้วยการส่ง command ให้แต่ละ service แล้วรอ reply แต่มันคืออีก component ที่ต้องสร้างและดูแลให้ใช้งานได้ตลอด มันต้องรู้จักทุก participant และทุกการเปลี่ยนแปลงของ flow ต้องผ่านคนที่เป็นเจ้าของมัน สำหรับสามสี่ขั้น นี่อาจเป็นเครื่องไม้เครื่องมือที่มากเกินกว่าปัญหาต้องการ

## ทำงานยังไง

saga คือลำดับของ local transaction และทุกตัวที่อาจต้องย้อนกลับจะมี **compensating transaction** ของมัน Hector Garcia-Molina กับ Kenneth Salem เสนอแนวคิดนี้ในปี 1987 สำหรับ long-lived transaction ภายใน database เดียว โดยมีคำสัญญาง่าย ๆ: ทุก transaction ของ saga ทำเสร็จครบ หรือไม่ก็ตัวที่ทำเสร็จไปแล้วจะถูก compensate

ในแบบ **choreography** ไม่มีใครเป็นคนรันลำดับนั้น ทุก service ทำตามกฎเดียวกัน: **รอฟัง** event ที่ตัวเองสนใจ **ตอบสนอง** ด้วย local transaction ใน database ของตัวเอง แล้ว **publish** event ที่บอกว่าเกิดอะไรขึ้น event เดินทางผ่าน message broker ทำให้ service ไม่เคยเรียกกันตรง ๆ flow ของ order ทั้งหมดใน diagram ก็คือกฎแบบนี้เจ็ดข้อ:

| Service | รอฟัง | Local transaction | แล้ว publish |
|---|---|---|---|
| Orders | request ของลูกค้า | บันทึก order เป็น PENDING | *OrderPlaced* |
| Payments | *OrderPlaced* | ตัดเงินจากบัตร | *PaymentCompleted* |
| Inventory | *PaymentCompleted* | จอง stock | *StockReserved* หรือ *StockReservationFailed* |
| Shipping | *StockReserved* | จอง courier | *ShipmentBooked* |
| Orders | *ShipmentBooked* | mark order เป็น CONFIRMED | |
| Payments | *StockReservationFailed* | คืนเงินที่ตัดไป | *PaymentRefunded* |
| Orders | *PaymentRefunded* | mark order เป็น CANCELLED | |

อ่านจากบนลงล่าง ตารางนี้ก็คือ workflow แต่ในระบบที่รันจริงไม่มีตารางแบบนี้อยู่เลย: แต่ละแถวอยู่ในโค้ดของคนละ service และ broker ก็รู้แค่ว่าใคร subscribe event ไหน

- **Event ไม่ใช่ command** event บอกข้อเท็จจริงในรูปอดีต (*OrderPlaced*) และคน publish ไม่รู้ว่าใครจะตอบสนอง หรือจะมีใครตอบสนองหรือเปล่า ส่วน command (*ChargePayment*) ขอให้ service ตัวใดตัวหนึ่งทำอะไรบางอย่างและคาดหวังผลลัพธ์ choreography ใช้แค่ event ทำให้การตัดสินใจว่าจะทำอะไรเป็นของฝั่งผู้รับ: Payments ตัดเงินเพราะ Payments ตัดสินใจเองว่า order ที่ถูกสั่งเป็นเหตุผลให้ตัดเงิน
- **ความล้มเหลวก็ถูก publish เหมือนอย่างอื่น** ถ้า Inventory จองไม่ได้ ตัว local transaction ของมันจะไม่เขียนอะไรเลย แล้วมันก็ publish *StockReservationFailed* ส่วน Payments ที่ตัดเงินจากบัตรไปแล้วก็รอฟัง event นี้อยู่ และ compensate ขั้นของตัวเอง แล้ว *PaymentRefunded* ที่มัน publish ก็คือสิ่งที่ Orders ตอบสนอง ไม่มีใครส่ง command "undo" และไม่มีอะไรถูก rollback แบบ global เลย แม้แต่ลำดับของ compensation ก็เกิดขึ้นเองจาก subscription
- **Compensation คือ action ทางธุรกิจ ไม่ใช่การ undo** การตัดเงินยังอยู่ใน payments ledger และมีรายการคืนเงินบันทึกไว้ข้าง ๆ compensation ทำให้ธุรกิจกลับมา consistent ไม่ใช่คืนข้อมูลกลับเป็นสถานะเดิม และมันก็คือ local transaction อีกตัวที่ publish event อีกตัว
- **ผู้เรียกไม่ต้องรอ** ปกติ Orders ตอบกลับทันทีที่ order เป็น PENDING แล้ว client ก็รู้ผลทีหลัง ด้วยการ poll สถานะของ order หรือผ่าน notification เช่น webhook หรือ message ทาง WebSocket

## ใช้ตอนไหนดี

- business transaction หนึ่งครอบ service ไม่กี่ตัว แต่ละตัวมี database ของตัวเอง และ flow สั้นและส่วนใหญ่เป็นเส้นตรง ทั้งแนวทางของ AWS และ Azure แนะนำ choreography สำหรับ saga ง่าย ๆ ที่มี participant ไม่กี่ตัว
- participant เป็นของคนละทีมหรือคนละ bounded context ที่ควรผูกกันหลวม ๆ และ event เป็นข้อเท็จจริงของ domain ที่ consumer อื่น (analytics, notification, search) ก็อยากได้อยู่แล้ว
- มี [event backbone](../event-driven-architecture/) อยู่แล้ว และ coordinator จะกลายเป็นอีก component ที่ทุก order ต้องพึ่ง
- ทุกขั้นที่อาจมีความล้มเหลวตามมา มีวิธีย้อนทางธุรกิจที่มีความหมาย: คืนเงิน ปล่อย stock ยกเลิก

**อย่า**ใช้:

- **กับไม่กี่ขั้นภายใน service เดียว** ถ้าข้อมูลอยู่ใน database เดียวได้ ใช้ local transaction ตัวเดียวก็ง่ายกว่าและให้ isolation จริง ๆ
- **กับขั้นเยอะ ๆ ทางแยก timer หรือการอนุมัติจากคน** ให้ใช้ [orchestration](../saga-orchestration/): นิยามของ flow ที่เดียวที่อ่าน ทำ version, test และ monitor ได้
- **ถ้าต้องมีคนบอกได้ตลอดว่า order อยู่ตรงไหนแล้ว** และคุณยังไม่พร้อมจะสร้างระบบติดตามที่อธิบายไว้ด้านล่าง
- **ถ้าสถานะระหว่างทางต้องไม่มีใครเห็นเลย** ไม่มี saga ไหนให้ isolation

## ได้อะไร เสียอะไร

| | Choreography | Orchestration |
|---|---|---|
| **ใครรู้จัก flow** | ไม่มีใคร: มันเกิดขึ้นจาก subscription ของแต่ละ service | orchestrator: นิยามเดียวในที่เดียว |
| **Message** | event: ข้อเท็จจริง และผู้รับตัดสินใจเองว่าจะทำอะไร | command และ reply: ผู้ส่งเป็นคนตัดสินใจ |
| **Coupling** | service พึ่ง event ของกันและกัน และบ่อยครั้งเป็นวง | participant ไม่รู้จักกันเลย แต่ orchestrator รู้จักทุกตัว |
| **Visibility** | ต้องสร้างเอง: correlation ID, tracing, tracking view | state ของ saga ก็คือข้อมูลของ orchestrator เอง |
| **Control** | ไม่มี coordinator ที่จะล่มหรือกลายเป็นคอขวด (แต่ broker ยังใช้ร่วมกันอยู่) ส่วน retry และ timeout ต้องมีในทุก service | retry, timeout และ compensation อยู่ในที่เดียว และที่นั่นต้อง highly available |
| **การเปลี่ยนแปลง** | listener ใหม่ไม่ต้องแก้ที่อื่น แต่ขั้นใหม่หรือการย้ายขั้นต้องแตะหลาย service | แก้นิยามที่เดียว ส่วน participant ปกติไม่ต้องเปลี่ยน |

- **ไม่มีใครเห็นภาพรวม** flow ไม่ได้อยู่ในโค้ดชิ้นไหนเลย Martin Fowler เตือนว่าถ้ามีสาย event notification ต่อกันยาว ๆ คุณอาจต้องสังเกตระบบที่รันจริงถึงจะรู้ว่า flow เป็นยังไง ถ้า saga หยุดกลางทาง อย่าง order #1044 ใน step 4 ก็ไม่มี service ไหนอยู่ในตำแหน่งที่จะสังเกตเห็น
- **Dependency วนเป็นวงกลม** Orders consume event จาก Payments และ Shipping ส่วน Payments consume event จาก Orders และ Inventory แล้วก็วนไปเรื่อย ๆ รอบวง ทั้ง Azure และ AWS ระบุว่า dependency แบบวนระหว่าง participant คือความเสี่ยงของ choreography
- **ทุกกรณีล้มเหลวเพิ่ม subscription** ใน diagram มีแค่ Inventory ที่ล้มเหลว ถ้าการจอง courier ล้มเหลวได้ด้วย Inventory ก็ต้องรอฟัง event นั้นแล้วปล่อย stock และ Payments ก็ต้องรอฟังการปล่อย stock หรือรอฟังความล้มเหลวนั้นเอง แล้วคืนเงิน ประเภทของ event และจำนวน listener โตเร็วกว่าจำนวนขั้น
- **การย้ายขั้นคือการเปลี่ยนแปลงข้ามทีม** ถ้าจะจอง stock ก่อนตัดเงิน Inventory ต้องรอฟัง *OrderPlaced* แล้ว Payments ต้องรอฟัง *StockReserved* ส่วน Shipping ต้องรอฟัง *PaymentCompleted*: service สามตัวต้องเปลี่ยนและ deploy พร้อมกัน Bernd Ruecker กับ Martin Schimak ใช้ตัวอย่างนี้เลยเพื่อค้านสาย event ที่ยาว
- **Event ที่จริง ๆ คือ command ปลอมตัวมา** ถ้า Orders publish event แค่เพื่อให้ Payments ตัดเงิน มันกำลังส่งสิ่งที่ Fowler เรียกว่า "passive-aggressive command": coupling ยังอยู่ แค่มองเห็นยากขึ้น ถ้า service หนึ่งต้องการให้อีกตัวทำอะไร ก็ใช้ command บอกไปตรง ๆ
- **ไม่มี isolation** saga เป็น atomic ในที่สุด consistent และ durable แต่ request อื่นจะเห็นสถานะระหว่างทางของมัน: stock ที่ถูกจองไว้ให้ order ที่กำลังจะถูกยกเลิก หรือเงินที่ตัดไปแล้วจะถูกคืน แบบนี้ทำให้เกิด lost update, dirty read และ fuzzy (non-repeatable) read ได้ วิธีรับมือที่ใช้กันบ่อยคือ **semantic lock** (ตัวบอกระดับ application เช่นสถานะ PENDING ของ order ที่บอกคนอื่นว่า record นี้กำลังเปลี่ยนอยู่), update แบบ commutative, pessimistic view (เรียง saga ใหม่ให้ update ที่เสี่ยงไปอยู่ในขั้นที่ retry ได้), การอ่านค่าใหม่ก่อน update, version file (log ของ operation บน record เพื่อให้ apply ได้ตามลำดับที่ถูกต้อง) และการเลือกกลไกตามความเสี่ยงทางธุรกิจของแต่ละ request
- **Eventual consistency** จนกว่า saga จะจบ order จะเป็น PENDING และ API กับหน้าจอต้องแสดงเรื่องนี้ตามจริง
- **Timeout และ retry เป็นงานของทุกคน** เพราะไม่มี coordinator แต่ละ service ต้องทำ retry, timeout และการจัดการ compensation ของตัวเอง AWS บอกว่าการทำเรื่องพวกนี้ให้ถูกต้องข้ามหลาย component ยากกว่าทำที่ orchestrator
- **End-to-end test ต้องรันทุกอย่าง** จะลอง saga ทั้งก้อนได้ก็ต่อเมื่อทุก service ของมันและ broker ทำงานอยู่

## ข้อควรรู้ตอนลงมือทำ

- **Publish ให้เชื่อถือได้** service ที่ commit แล้วค่อย publish อาจ crash ระหว่างนั้นได้ และ saga ที่ทำ event หายจะหยุดไปเฉย ๆ โดยไม่มี error ที่ไหนเลย ให้เขียน event ใน local transaction เดียวกับการเปลี่ยน state ด้วย [transactional outbox](../transactional-outbox/) หรือให้ event เป็น state เองไปเลย แบบ [event sourcing](../event-sourcing/)
- **Consume แบบ idempotent** การส่งที่เชื่อถือได้ก็คือการส่งแบบ at-least-once: broker ส่งซ้ำสิ่งที่ยังไม่ถูก acknowledge และ outbox relay ก็ publish ซ้ำหลัง crash สักวันหนึ่งทุก handler เลยต้องเจอ event ซ้ำสองครั้ง ให้แต่ละตัวเป็น [idempotent consumer](../idempotent-consumer/): *StockReservationFailed* ตัวที่สองต้องไม่ทำให้เกิดการคืนเงินครั้งที่สอง
- **รักษาลำดับ event ของ order เดียวกัน** ใช้ order ID เป็น message key, session หรือ group ตัว Kafka เขียน event ที่ key เดียวกันลง partition เดียวกัน และส่ง partition ตามลำดับที่เขียน ส่วน Azure Service Bus มี session และ SQS FIFO queue เรียงลำดับเคร่งครัดภายใน message group เดียวกัน แต่ไม่มีตัวไหนเรียงลำดับ event ข้าม topic หรือข้าม queue และ consumer ที่ scale out โดยไม่มี key แบบนี้จะประมวลผล event ผิดลำดับ เลยควรใส่ version หรือ sequence number ไว้ทุกที่ที่ event เก่าจะทำความเสียหายได้
- **topic เดียวหรือหลาย topic** diagram ใช้ topic เดียวสำหรับทั้ง saga ทำให้ event ทั้งหมดของ order หนึ่งอยู่ใน stream เดียวที่เรียงลำดับ การมี topic ต่อ service หรือต่อประเภท event ก็พบบ่อยพอกัน แบบนั้นแยกความเป็นเจ้าของได้ชัดกว่า แต่เสียลำดับระหว่าง topic ไป
- **คาดไว้เลยว่า event มาได้ในทุกสถานะ** handler จะเจอ event ซ้ำ, event ที่มาช้า และ event ของ order ที่มันไม่มีบันทึกอยู่ ให้มันเช็กข้อมูลของตัวเองก่อนแล้วค่อยตัดสินใจ: *StockReservationFailed* ของ order ที่ไม่เคยถูกตัดเงินก็ไม่ต้องคืนเงิน
- **เรียงขั้นตามความยากในการย้อนกลับ** แนวทางของ Azure แบ่งขั้นเป็นสามแบบ: transaction แบบ *compensable* ที่ย้อนกลับได้, *pivot* ที่พอผ่านไปแล้ว saga ต้องรันไปจนจบ และ transaction แบบ *retryable* ที่ตามหลัง pivot และ idempotent ทำให้ทำซ้ำได้จนกว่าจะสำเร็จ ให้เอาการตรวจที่มีโอกาสล้มเหลวสูงสุดไว้ก่อน และอะไรที่ย้อนกลับไม่ได้ (พัสดุที่ส่งให้ courier แล้ว, email) ไว้ท้ายสุด ใน diagram ตัดเงินจากบัตรก่อนเพื่อให้มีอะไรให้ compensate แต่ flow จริงจะจอง stock ก่อน หรือ authorise บัตรไว้ตั้งแต่ต้นแล้วค่อย capture ตอนท้าย ทำให้การคืนเงินกลายเป็นแค่การปล่อย hold
- **Compensation ต้องไม่ยอมแพ้** compensation ล้มเหลวได้เหมือนขั้นอื่น ให้มัน idempotent แล้ว retry และถ้า retry ไม่ช่วย ก็ alert คนพร้อมรายละเอียดมากพอให้ทำงานที่เหลือให้จบด้วยมือได้
- **ใส่ correlation ID ในทุก event** order ID หรือ saga ID แยกต่างหาก คือสิ่งที่ทำให้ log, trace และ tracking view ผูก event ของ saga เดียวกันเข้าด้วยกันได้ ส่วน event ID ที่ไม่ซ้ำกันที่อยู่ข้าง ๆ คือสิ่งที่ consumer ใช้ตัดตัวซ้ำ:

  ```json
  {
    "eventId": "e-7c1",
    "type": "PaymentCompleted",
    "orderId": 1044,
    "occurredAt": "2026-10-02T09:15:04Z",
    "data": { "amount": 80, "currency": "USD" }
  }
  ```

- **Trace มัน** ส่งต่อ trace context ไปใน message header เพื่อให้ trace เดียวตาม saga ข้าม broker ไปได้: ดู [distributed tracing](../distributed-tracing/) ปกติ trace จะถูก sample ทำให้มันช่วย debug saga ทีละตัวได้ แต่บอกไม่ได้ว่าทุก order อยู่ตรงไหน
- **มี state view** consumer ตัวเล็ก ๆ subscribe ทุก event ของ saga แล้วเก็บแถวละหนึ่ง order: event ที่เห็นแล้ว ตัวล่าสุด และเวลาที่มันมาถึง มันไม่ต้องรู้อะไรเกี่ยวกับ flow นอกจากว่า event ไหนเปิดและปิด saga ส่วน Bernd Ruecker ไล่ดูทางเลือกต่าง ๆ ตั้งแต่ store ของทุก event ที่ query ได้ ไปจนถึง workflow engine ที่แค่รอฟังเฉย ๆ พอ view เริ่มลงมือทำอะไร เช่นยกเลิก order ที่ timeout มันก็เริ่ม orchestrate แล้ว และนั่นอาจเป็นจังหวะที่ควรย้าย flow ไปไว้ที่ orchestrator
- **ให้ทุก saga มี deadline** ขั้นหนึ่งไม่ได้ล้มเหลวเสมอไป บางทีมันก็แค่ไม่ตอบเลย ให้ alert ทุก saga ที่ยังไม่เห็น event ปิดภายใน deadline ของมัน ถ้า timeout ควรยกเลิก order ด้วย ก็ให้ service ที่เริ่ม saga เป็นเจ้าของเรื่องนี้: Orders ทำให้ order ที่เป็น PENDING นานเกินไปหมดอายุ แล้ว publish event ที่ตัวอื่นใช้เป็นสัญญาณให้ compensate แต่ timeout ไม่ได้พิสูจน์ว่าล้มเหลว *ShipmentBooked* ที่มาช้าเลยยังมาถึงได้ และพอมาถึงก็ต้อง compensate ด้วย
- **คอยดู dead-letter queue** event ที่ consumer ทำไม่ผ่านซ้ำ ๆ จะถูกพักไว้ใน [dead-letter queue](../dead-letter-queue/) และ saga ของมันก็รออยู่ตรงนั้นด้วย ให้ alert ทุกครั้งที่มีอะไรเข้ามา แล้วใช้ correlation ID หา order
- **ถือว่า event เป็น public contract** event หนึ่งมี consumer ได้หลายตัว และคน publish ก็ไม่รู้จักทุกตัว การเปลี่ยนรูปร่างของมันเลยอาจทำให้ service ที่ไม่มีใครนึกถึงพัง ให้ evolve schema ทีละขั้นแบบ backward-compatible และใช้ schema registry บังคับเรื่องนี้ได้
- **Test แต่ละกฎ แล้วค่อย test saga ทั้งก้อนสักสองสามตัว** สำหรับทุกแถวในตารางข้างบน ให้ตั้ง service ไว้ในสถานะที่รู้แน่ ส่ง event เข้าไป แล้ว assert ที่ database ของมันและที่ event ที่มัน publish จากนั้นส่ง event ซ้ำสองครั้ง และส่ง event ผิดลำดับ เช็ก schema ของ event ด้วย contract test ระหว่างคน publish แต่ละตัวกับ consumer ของมัน ส่วน end-to-end test ให้มีน้อย ๆ: happy path และอีกหนึ่งตัวต่อหนึ่งเส้นทาง compensation
- **ผสมทั้งสองแบบ** การเลือกทำเป็นราย flow ไม่ใช่ทั้งระบบ วิธีแบ่งที่เจอบ่อยคือใช้ choreography ระหว่าง bounded context และใช้ orchestrator ภายใน context เดียว ส่วน flow ที่โตจนสาย event รับไม่ไหว ก็ส่งต่อให้ orchestrator ที่รอฟัง event เดิมและตอบด้วย command ได้
