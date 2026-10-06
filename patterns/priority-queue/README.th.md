## ปัญหา

queue ส่วนใหญ่แจกงานตามลำดับที่มาถึง แบบนี้ยุติธรรมดี แต่ไม่สนเลยว่าแต่ละ message มีไว้ทำอะไร พอ batch ตอนกลางคืนใส่งานประจำหลายร้อยงานลงใน queue เดียวกับงานแบบ interactive ทำให้อีเมล password reset หรือข้อความ "payment failed" ก็ต้องรอหลังงานพวกนั้นทั้งหมด แล้วคนที่นั่งอยู่หน้าจอก็ต้องรอไปด้วย consumer ที่มากขึ้นช่วยลดเวลารอโดยเฉลี่ยได้ แต่ message ด่วนทุกตัวก็ยังนั่งอยู่หลัง backlog ทั้งหมดที่มาถึงก่อนมันอยู่ดี

## ทำงานยังไง

ให้แต่ละ message มี priority ตั้งแต่ตอนที่สร้างขึ้นมา แล้วให้ consumer หยิบงานที่ priority สูงกว่าไปก่อน มีสองแบบ:

- **queue เดียวที่ broker จัดการ priority ให้** broker เรียง queue ตาม field priority แล้วส่ง message ที่สำคัญที่สุดออกไปก่อน RabbitMQ ทำแบบนี้ โดย classic queue ต้องใส่ argument `x-max-priority` ตอนประกาศ queue (1 ถึง 255 ส่วนเอกสารแนะนำให้ใช้แค่ไม่กี่ระดับ และตั้งผ่าน policy ไม่ได้) ส่วน quorum queue รองรับ priority เสมอ: ตั้งแต่ RabbitMQ 4.3 เป็นแบบเข้มงวด มีระดับ 0 ถึง 31 ส่วน version 4.0 ถึง 4.2 มีสองระดับคือ normal กับ high โดยส่ง high สองตัวต่อ normal หนึ่งตัว
- **queue หรือ subscription หนึ่งตัวต่อ priority** producer ส่งแต่ละ message ไปที่ queue high หรือ queue low หรือ publish ไปที่ topic เดียว แล้วให้ subscription ของแต่ละ priority filter ตาม attribute แบบนี้ใช้ได้กับ broker ที่ไม่มี field priority: Amazon SQS (AWS แนะนำให้แยก queue สำหรับจัด priority ส่วน fair queue ของมันใช้เกลี่ยระหว่าง tenant ไม่ใช่ความด่วน) Azure Service Bus (ตัวอย่างของ Azure pattern ตั้ง property `Priority` เอง แล้ว route ด้วย SQL filter ไปที่ subscription high กับ low) Google Cloud Pub/Sub (message มี attribute แต่ไม่มี priority และ subscription filter จับคู่กับ attribute ได้) และ Apache Kafka (topic หนึ่งตัวต่อ priority)

จากนั้น consumer ก็เลือกว่าจะหยิบอะไรต่อ:

- **Poll high ก่อน** pool เดียวเช็ก queue high และหยิบงาน low ก็ต่อเมื่อ high ว่าง วิธีนี้ทำให้งานด่วนรอสั้นที่สุดและไม่เปลือง capacity เลย แต่งาน low จะอดตายทุกครั้งที่ high ไม่เคยว่าง
- **pool เฉพาะของแต่ละ queue** แต่ละ queue มี consumer และขีดจำกัดการ scale ของตัวเอง ตัวอย่างของ Azure ให้ consumer ของ high scale out ได้ถึง 200 instance และของ low ได้ 40 แต่ละ class แยกขาดจากกัน แต่ consumer ของ high ที่ว่างอยู่ก็ไม่ได้ช่วยระบาย backlog ของ low เว้นแต่เราจะยอมให้มันช่วย
- **อัตราส่วนแบบถ่วงน้ำหนัก** pool หยิบ เช่น high สามตัวต่อ low หนึ่งตัว งาน low ก็ขยับได้ตลอด แลกกับ latency ของงานด่วนที่เพิ่มขึ้นนิดหน่อย

ใน diagram มี worker สี่ตัว ทำได้ตัวละ 2.5 งานต่อวินาที (รวม 10 งาน ใช้ 0.4 s ต่องาน) ถ้าอยู่หลังงานประจำ 500 งานใน queue เดียว อีเมล reset ต้องรอ 500 ÷ 10 = 50 s แต่ถ้ามี queue high มันรอแค่ worker ตัวถัดไปที่ว่าง

## ใช้ตอนไหนดี

- งาน interactive ใช้ worker ร่วมกับงาน batch: password reset กับ order confirmation อยู่ข้างงาน import, re-index หรือการสร้าง report
- ลูกค้าหรือ tenant ซื้อระดับบริการต่างกัน และ request ของ premium ต้องมีเป้า latency ที่แคบกว่า
- alert กับ page ห้ามไปรอหลัง report หรือ digest ประจำ
- ไม่เหมาะเมื่องานทุกอย่างด่วนเท่ากัน หรือเมื่อสิ่งที่สำคัญมีแค่ throughput เฉลี่ย: priority เพิ่ม queue, routing rule และรูปแบบความล้มเหลว โดยไม่ได้ช่วยเรื่องไหนให้ดีขึ้นเลย

## ได้อะไร เสียอะไร

- **Starvation** การให้บริการ high ก่อนแบบเข้มงวดอาจรั้งงาน low ไว้ได้นานเท่าที่งานด่วนยังเข้ามาเรื่อย ๆ ให้จำกัดมันไว้: กัน consumer ไว้ให้ low (worker หนึ่งในสี่ตัวใน diagram ทำให้ high ได้ 7.5 งานต่อวินาที และ low ได้ 2.5) ดึงงานในอัตราส่วนตายตัว หรือทำ *aging* ให้ message โดยเลื่อนอะไรก็ตามที่รอเกินเป้าไปไว้ใน queue ที่สูงกว่า เอกสารของ RabbitMQ บอกว่า classic queue ให้บริการแต่ละระดับ priority เป็นรอบ ๆ ระดับที่ต่ำกว่าเลยไม่มีวันอดตาย ส่วน quorum queue แบบเข้มงวดอาจทำให้ระดับต่ำล่าช้าไปได้เรื่อย ๆ ไม่มีกำหนด
- **ไม่มี pre-emption** priority แค่เลือก message ถัดไป งาน low-priority ยาว ๆ ที่เริ่มไปแล้วจะครอง worker ไว้จนกว่าจะเสร็จ เลยควรแบ่งงานยาวเป็นขั้นสั้น ๆ ที่มี checkpoint แล้ว worker จะได้กลับมาที่ queue บ่อย ๆ
- **ลำดับข้าม priority หายไป** message ด่วนที่มาทีหลังจะแซง message ประจำที่มาก่อน ถ้า message สองตัวแก้ entity เดียวกัน ให้เก็บไว้ใน class เดียวกัน หรือทำให้ consumer รับมือกับลำดับแบบไหนก็ได้
- **priority ไม่ใช่ capacity** ถ้างานด่วนอย่างเดียวก็เกินกว่าที่ consumer ทำเสร็จได้แล้ว queue high ก็จะโตด้วย ให้ scale consumer ของแต่ละ queue ตาม depth ของ queue นั้นเอง หรือตามอายุของ message ที่เก่าที่สุดในนั้น: ดู [Autoscaling](../autoscaling/) และ [Competing Consumers](../competing-consumers/)
- **ชิ้นส่วนที่ต้องดูแลมากขึ้น** queue ที่แยกกันก็มาพร้อม dead-letter queue, alarm, permission และค่าใช้จ่ายของการ poll ที่แยกกันด้วย

## ข้อควรรู้ตอนลงมือทำ

- **priority มีผลก็ต่อเมื่องานต้องรอ** ถ้าใช้ RabbitMQ ให้ใช้ manual acknowledgement กับ prefetch เล็ก ๆ: consumer ที่ prefetch เยอะจะหยิบ message low-priority ไปแล้วตั้งแต่ก่อนที่ตัวด่วนจะมาถึง ถ้าใช้ SQS การทำ long polling กับ queue high ที่ว่างจะดึง loop ไว้ได้นานถึง wait time ก่อนจะไปดู queue low เลยควรใช้ wait สั้น ๆ ใน loop ที่ดู high ก่อน หรือแยก poller กัน
- **Kafka ไม่มี priority ของ message** consumer fetch จากทุก partition ของมันพร้อมกัน ถ้าจะให้ topic ที่ priority สูงได้เปรียบ ให้ pause partition ของ topic low ระหว่างที่ high มี backlog แล้ว resume ทีหลัง หรือรัน consumer group แยกกันต่อ topic
- **ตัดสินว่าใครเป็นคนตั้ง priority** ให้ได้มาจากข้อเท็จจริงที่ระบบเชื่อถือ (ประเภท message, plan ของลูกค้า) ไม่ใช่จาก flag ที่ producer ไหนก็ตั้งได้ จำกัดว่าใคร publish เข้า queue high ได้ด้วย credential หรือ topic permission ที่แยกกัน และเฝ้าดูปริมาณต่อ producer: ถ้า producer ทุกตัวติดป้ายว่าด่วนหมด ก็ไม่มีอะไรด่วนจริง
- **scale แต่ละ queue ตามสัญญาณของตัวเอง** KEDA มี scaler สำหรับ RabbitMQ, Amazon SQS, Azure Service Bus, Google Cloud Pub/Sub และ Kafka ตัว Pub/Sub scaler ใช้อายุของ message ที่ยังไม่ acknowledge ตัวที่เก่าที่สุดเป็นเกณฑ์ scale ได้ ส่วน SQS ก็ publish สัญญาณที่ตรงกันเป็น CloudWatch metric `ApproximateAgeOfOldestMessage`
- **dead-letter แยกต่อ queue** ให้แต่ละ priority มี [dead-letter queue](../dead-letter-queue/) ของตัวเอง แบบนี้ poison message ที่ด่วนจะไม่ block เส้นทาง high และ alarm ของมันก็จะไปถึงทีมที่ถูกต้อง
- **monitor แยกต่อ class** ติดตาม depth กับอายุของ message ที่เก่าที่สุดของแต่ละ queue เทียบกับเป้าของแต่ละ class เช่นไม่กี่วินาทีสำหรับ high และหนึ่งชั่วโมงสำหรับ low ค่าเฉลี่ยข้าม class จะซ่อน starvation ไว้
- **จัดลำดับงานที่ขอบระบบด้วย** queue เป็นแค่ที่หนึ่งที่จัด priority ได้ ที่ API ให้ทิ้ง request ที่สำคัญน้อยที่สุดก่อนเมื่อโหลดเกิน ([Rate Limiting](../rate-limiting/) ส่วนหนังสือ SRE ของ Google อธิบาย criticality level ที่เดินทางไปกับแต่ละ request) และให้แต่ละ class มี pool ของตัวเอง ตัวหนึ่งจะได้ใช้ทรัพยากรของอีกตัวจนหมดไม่ได้ ([Bulkhead](../bulkhead/))
