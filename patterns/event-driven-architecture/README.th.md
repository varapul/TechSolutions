## ปัญหา

ในโลกของ request/response ตัว service ที่มีเรื่อง*เกิดขึ้น*ต้องเรียกทุก service ที่*สนใจ*เรื่องนั้น การสั่ง order แปลว่าต้องเรียก Inventory แล้วก็ Payments แล้วก็ Notifications ไปเรื่อย ๆ ตัวเรียกต้องรู้จัก service ปลายทางทุกตัว รอให้ทุกตัวทำเสร็จ พังเมื่อตัวไหนพัง และต้องแก้ทุกครั้งที่มีตัวใหม่เพิ่มเข้ามา latency ของมันกลายเป็นผลบวกของ latency ทุกตัว และ availability ของมันก็กลายเป็นผลคูณของ availability ทุกตัว

## ทำงานยังไง

service คุยกันผ่าน **event** คือข้อเท็จจริงที่เปลี่ยนไม่ได้ เกี่ยวกับเรื่องที่เกิดขึ้นไปแล้ว (`OrderPlaced`, `PaymentCaptured`)

- **producer** publish event ไปที่ broker แล้วก็ไปทำอย่างอื่นต่อ มันไม่รู้ว่าใครฟังอยู่
- **broker** (Kafka, Amazon SNS + SQS หรือ EventBridge, Azure Service Bus หรือ Event Grid, Google Pub/Sub, RabbitMQ) เก็บ event ไว้แล้วส่งให้ทุก **subscription**
- **consumer** ประมวลผล event ตามจังหวะของตัวเอง consumer แต่ละตัว scale, พัง และฟื้นตัวได้แยกกัน และ subscription ของมันก็จำไว้ว่าทำค้างไว้ถึงตรงไหน

การเพิ่ม capability ใหม่ปกติก็แค่เพิ่ม subscriber ตัวใหม่ โดยไม่ต้องแก้ producer เลย

## ใช้ตอนไหนดี

- มีปฏิกิริยาหลายอย่างที่ไม่ขึ้นต่อกัน กับข้อเท็จจริงทาง business เรื่องเดียวกัน
- งานที่ traffic มาเป็นพัก ๆ ที่ควรให้ queue รับช่วงพุ่งไว้ แทนที่จะให้ dependency ตัวที่ช้าที่สุดรับ
- เชื่อมระบบที่ต่างทีมเป็นเจ้าของ ที่ temporal coupling (ทุกตัวต้องออนไลน์พร้อมกัน) เป็นภาระ
- streaming และ analytics แบบเกือบ real-time ที่ consume event log ชุดเดียวกัน

## ได้อะไร เสียอะไร

- **Eventual consistency** ตอนที่ publish `OrderPlaced` สต็อก*ยัง*ไม่ได้ถูกจองไว้ UI กับ API ต้องออกแบบเผื่อเรื่องนี้
- **ไล่ตามยากขึ้น** ไม่มี call stack เดียวให้ดู ต้องมี correlation ID, distributed tracing และ event catalog ดี ๆ ถึงจะเห็น flow ทั้งเส้น
- **semantics ของการส่ง** broker ส่วนใหญ่เป็นแบบ at-least-once ทำให้ consumer ต้อง **idempotent** และรับมือกับ event ที่มาไม่ตามลำดับได้
- **schema ที่เปลี่ยนไปตามเวลา** event คือ public contract ให้ทำ version และเลือกการเปลี่ยนแบบเพิ่มเข้าไปไว้ก่อน
- **Dual write** การ update database ของเรา*และ* publish event ไม่ได้เป็น atomic ให้ใช้ transactional outbox หรือ change data capture

## ข้อควรรู้ตอนลงมือทำ

- ตั้งชื่อ event เป็น past tense ตามข้อเท็จจริงทาง business (`OrderPlaced`) ไม่ใช่เป็นคำสั่ง (`SendEmail`)
- ตัดสินใจระหว่าง **thin event** (มีแค่ ID แล้ว consumer เรียกกลับมาเอารายละเอียด) กับ **fat event** (พกข้อมูลมาด้วย) fat event ลด coupling ตอน runtime แต่ทำให้ schema เป็น contract ที่ใหญ่ขึ้น
- คอยดู **consumer lag** ของแต่ละ subscription นี่คือสัญญาณสุขภาพที่ดีที่สุดตัวเดียวในระบบ event-driven และเป็น metric สำหรับ autoscaling ที่ใช้ได้เลย (เช่น KEDA ที่ scale ตามความยาวของ queue)
- ใส่ **dead-letter queue** ไว้หลังทุก subscription เพื่อให้ poison message ตัวเดียวไม่บล็อกตัวที่เหลือ
