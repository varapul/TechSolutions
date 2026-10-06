## ปัญหา

queue ที่คั่นระหว่างส่วนของระบบที่รับงานกับส่วนที่ทำงาน จะเปลี่ยน burst ให้กลายเป็น backlog แทนที่จะเป็นระลอก error แต่ถ้ามี consumer ตัวเดียวอ่าน queue นั้น จังหวะก็ตายตัว ใน animation ตัว Orders API ใส่งานลง queue 10 งานต่อวินาที แต่ worker ตัวเดียวที่มีทำเสร็จได้ 4 งาน ทำให้ backlog โตขึ้นวินาทีละ 6 และงานแต่ละงานก็ต้องรอนานกว่างานก่อนหน้านิดหนึ่ง ไม่มีอะไรหาย แต่ตราบใดที่งานเข้ามาเร็วกว่าจังหวะของ worker เวลารอก็ไม่มีเพดาน

เครื่องที่ใหญ่ขึ้นช่วยยกเพดานนั้นขึ้นได้ แต่ไม่ได้ทำให้มันหายไป consumer ตัวเดียวยังเป็น single point of failure ด้วย: ตอนที่มัน crash, ค้าง หรือกำลังถูก redeploy ก็ไม่มีอะไรถูก process เลย

## ทำงานยังไง

รัน consumer ที่เหมือนกันหลายตัวกับ **queue เดียวกัน** แล้วให้มันแย่ง message กัน *Enterprise Integration Patterns* อธิบายว่าพวกนี้คือผู้รับบน point-to-point channel: message แต่ละตัวถูก consume โดยตัวเดียวในกลุ่มเท่านั้น และระบบ messaging เป็นคนตัดสินว่าตัวไหน นี่คือความต่างจาก [publish-subscribe](../publish-subscribe/) ที่ subscriber ทุกตัวได้สำเนาของตัวเอง ตรงนี้งานถูกแบ่ง ไม่ได้ถูกคัดลอก

เพราะ worker ตัวไหนก็หยิบ message ไหนก็ได้ pool เลยขยายหรือหดได้โดยที่ producer ไม่รู้ตัว และ worker ที่ล้มก็ไม่ได้เอางานติดไปด้วย ใน animation worker สามตัวทำได้ 3 × 4 = 12 งานต่อวินาที เทียบกับ 10 งานที่เข้ามา ทำให้ backlog ที่เหลือจาก step 1 ลดลงวินาทีละ 2

### message หนึ่งตัว worker หนึ่งตัวในแต่ละครั้ง

ใน broker ส่วนใหญ่ การหยิบ message มีสองขั้น:

1. **Receive** broker ส่ง message ให้ consumer ตัวหนึ่ง แล้ว*ซ่อน*มันจากตัวอื่นไว้ช่วงหนึ่ง โดยยังไม่ลบ ส่วน lease นี้มีชื่อต่างกันในแต่ละ product: visibility timeout ใน Amazon SQS, lock ในโหมด peek-lock ของ Azure Service Bus, acknowledgement deadline ใน Google Cloud Pub/Sub และ acquisition lock ใน Kafka share group
2. **Acknowledge** พอทำงานเสร็จ consumer ก็ delete, complete หรือ ack message แล้วตอนนั้นมันถึงจะหายไปจริง ๆ

ถ้า acknowledgement ไม่มาเลย เพราะ worker crash หรือค้าง หรือแค่ใช้เวลานานกว่า lease ตัว lease ก็จะหมดเวลา แล้ว message ก็กลับมามองเห็นได้สำหรับ consumer ทุกตัว นี่คือสิ่งที่เกิดกับ m-41 ใน step 3 ส่วน RabbitMQ ทำงานต่างออกไป: มันไม่มีนาฬิกาของ lease แต่ delivery ที่ยังไม่ถูก acknowledge จะกลับเข้า queue ทันทีที่ channel หรือ connection ของ consumer ปิด และมี delivery acknowledgement timeout (default 30 นาที และตั้งแต่ RabbitMQ 4.3 เป็นฟีเจอร์ของ quorum queue) ไว้จับ consumer ที่ยังต่ออยู่แต่ไม่เคยตอบ

**Acknowledge หลังจาก commit งานแล้วเท่านั้น** โหมดที่ลบ message ทันทีที่ส่งออกไปจะเร็วกว่า แต่ทำงานหาย ในโหมด receive-and-delete ของ Service Bus ตัว message นับว่าถูก consume แล้วตั้งแต่มันอยู่บนสาย ส่วน RabbitMQ consumer ที่ใช้ automatic acknowledgement จะเสีย message ที่กำลังทำอยู่ และทุก message ที่ถูกส่งมาให้มันแล้ว ตอนที่มันตาย

### At least once เลยต้อง idempotent

การส่งซ้ำคือสิ่งที่ทำให้ pattern นี้ปลอดภัย และก็เป็นสิ่งที่ทำให้มันยุ่งยากด้วย worker 2 อาจตัดเงินบัตรไปแล้ว ส่ง email ไปแล้ว หรือเขียน row ไปครึ่งหนึ่งก่อนจะตาย แล้ว worker 3 ก็มาทำงานนั้นซ้ำอีกรอบ การส่งเป็นแบบ *at least once*: SQS standard queue ไม่ได้สัญญาด้วยซ้ำว่า message จะไม่ถูกส่งออกไปสองครั้งภายใน visibility timeout ของมัน ให้เขียน handler ให้การทำซ้ำไม่มีผลเพิ่ม เช่นบันทึก message ID ไว้ใน transaction เดียวกับงาน ดู [Idempotent Consumer](../idempotent-consumer/)

### Poison message

message ที่ไม่มีวันสำเร็จ เช่น payload ที่ผิดรูปแบบ หรือ input ที่ไปเจอ bug จะกลับมาทุกครั้งที่ lease หมด และกิน worker ไปหนึ่งตัวทุกครั้ง ให้นับจำนวนครั้งที่ลอง แล้วพักมันไว้หลังลองไปไม่กี่ครั้ง broker นับให้เราอยู่แล้ว:

- **SQS** เพิ่มค่า `ApproximateReceiveCount` ทุกครั้งที่ receive และย้าย message ไปที่ dead-letter queue เมื่อค่านี้เกิน `maxReceiveCount` ของ redrive policy ของ queue บน standard queue ที่ `maxReceiveCount` มากกว่า 3 ทุก message ที่ถูก receive ไปสามครั้งขึ้นไปโดยไม่ถูกลบจะถูกย้ายไปท้าย queue ด้วย
- **Service Bus** ส่ง message เข้า dead-letter หลังส่งไปแล้ว `MaxDeliveryCount` ครั้ง default คือ 10
- **RabbitMQ quorum queue** เลิกพยายามหลังส่งไม่สำเร็จ 20 ครั้งเป็นค่า default (ตั้งแต่ 4.0) แล้วก็ทิ้ง message ไป หรือส่งเข้า dead-letter ถ้า queue มี dead-letter exchange
- **Pub/Sub** forward message ไปที่ dead-letter topic ของ subscription หลังลองส่ง 5 ครั้งเป็นค่า default (ตั้งได้ 5 ถึง 100 และเป็นค่าประมาณ)
- **Kafka share group** archive record หลังลองส่ง 5 ครั้งเป็นค่า default แล้วหลังจากนั้นก็จะไม่ส่งอีกเลย

ตั้ง alert กับทุกอย่างที่ไปตกอยู่ตรงนั้น ดู [Dead-Letter Queue](../dead-letter-queue/)

### Pull, push และ prefetch

วิธีที่ message ไปถึง worker เป็นตัวตัดสินว่างานจะกระจายเท่ากันแค่ไหน *Enterprise Integration Patterns* ตั้งชื่อไว้สองแบบ: polling consumer จะขอ message ถัดไปเมื่อพร้อม ส่วน event-driven consumer จะถูกส่ง message ให้ทันทีที่มาถึง

- **Pull** SQS consumer เรียก `ReceiveMessage` ที่คืน message ได้มากสุด 10 ตัวต่อครั้ง ให้เปิด long polling (รอได้สูงสุด 20 วินาที): call นั้นจะรอ message แทนที่จะกลับมามือเปล่า และจะถาม server ทุกตัวของ queue แทนที่จะสุ่มถามแค่บางตัว Kafka consumer ก็ poll เหมือนกัน และ Pub/Sub pull subscription ก็เช่นกัน
- **Push** RabbitMQ push delivery ไปให้ consumer ที่ register ไว้กับ queue การดึงทีละ message ด้วย `basic.get` ก็ใช้ได้ แต่เอกสารของ RabbitMQ แนะนำ consumer ที่อยู่ยาวมากกว่าการ poll ส่วน Pub/Sub push subscription ส่ง message แต่ละตัวไปที่ endpoint ของเรา
- **Prefetch** การดึงล่วงหน้าทำให้ worker มีงานทำตลอด แต่ message ที่นั่งอยู่ใน buffer ของ worker ตัวหนึ่งก็ไม่ว่างให้ worker ที่ว่างอยู่หยิบ ถ้าไม่ตั้งขีดจำกัด RabbitMQ จะแจก message แบบ round-robin: message ลำดับที่ n ไปให้ consumer ตัวที่ n ไม่ว่าตัวนั้นจะยุ่งแค่ไหน *fair dispatch* ใน tutorial ของมันตั้ง prefetch เป็น 1 (`basic.qos`) worker เลยได้ message ถัดไปก็ต่อเมื่อ acknowledge ตัวล่าสุดแล้ว งานก็จะไปหาตัวที่ว่าง ส่วน prefetch เป็น 0 แปลว่าไม่จำกัด ใน Service Bus ตัว message ที่ prefetch มาจะถูก lock แล้ว และ lock ก็เดินไปเรื่อย ๆ ระหว่างที่มันรออยู่ใน buffer ถ้า buffer ใหญ่และ process ช้า ตัว lock ก็หมดก่อนงานจะเริ่มได้ คำแนะนำของ Microsoft คือให้ lock นานกว่าเวลาที่ใช้ process ทั้ง buffer บวกอีกหนึ่ง message ให้ prefetch น้อย ๆ ถ้า message แต่ละตัวแพง และให้มากขึ้นถ้า message ถูกและสิ่งที่สำคัญคือ throughput

### Lease สำหรับงานที่ยาว

ตั้ง lease ให้มากกว่าเวลา process ปกติเล็กน้อย และให้ worker ต่ออายุมันระหว่างที่งานยาวยังรันอยู่ lease ที่ยาวมาก ๆ ดูปลอดภัยกว่า แต่มันก็ซ่อน message ของ worker ที่ crash ไว้นานเท่านั้นด้วย

- **SQS:** default 30 วินาที `ChangeMessageVisibility` ต่อเวลาได้ สูงสุด 12 ชั่วโมงนับจากการ receive ครั้งแรก (การต่อเวลาไม่ได้รีเซ็ตนาฬิกานี้) และการตั้งเป็น 0 จะส่ง message คืนทันที AWS แนะนำให้มี heartbeat ที่คอยต่อ timeout ไปเรื่อย ๆ ระหว่างงานที่ยาว
- **Service Bus:** lock default 1 นาที สูงสุด 5 นาที ต่ออายุได้โดย client หรือโดย automatic lock renewal ของ SDK ตัว trigger ของ Azure Functions ต่อ lock ให้ระหว่างที่ function รันอยู่ แต่โดย default ต่อให้แค่ 5 นาที (`maxAutoLockRenewalDuration` ใน host.json)
- **Pub/Sub:** acknowledgement deadline default 10 วินาที (ตั้งได้ 10 ถึง 600 วินาที) client library ระดับสูงต่อเวลาให้อัตโนมัติ โดย default ได้ถึงหนึ่งชั่วโมง deadline นี้รับประกันก็ต่อเมื่อเปิด exactly-once delivery ไว้เท่านั้น
- **Kafka share group:** acquisition lock default 30 วินาที (`share.record.lock.duration.ms`)

lease สั้นเกินไป message ที่ช้าก็ถูก process สองรอบ ยาวเกินไป message ของ worker ที่ crash ก็ต้องรอนานเท่านั้นกว่าจะมีใคร retry

### ลำดับ และราคาของมัน

พอมี worker หลายตัว ลำดับที่ message ออกจาก queue ก็ไม่ใช่ลำดับที่งานของมันเสร็จ ใน step 4 ตัว m-50 กับ m-51 update order 7 ทั้งคู่ แต่ m-50 ไปเจอ call ที่ช้า ทำให้ m-51 ถูก apply ก่อน เอกสาร Service Bus ของ Microsoft ก็ไล่ให้ดู race แบบเดียวกัน ที่ message สามตัวกับ consumer สองตัวจบลงด้วยการ process ตามลำดับ 2, 3, 1

ปกติที่สำคัญมีแค่ลำดับ*ต่อ key*: ต่อ order ต่อลูกค้า ต่อ account แล้ว broker ก็มีวิธีให้เราส่งทุก message ที่มี key เดียวกันไปหา consumer ตัวเดียวในแต่ละช่วงเวลาได้:

- **Amazon SQS FIFO queue: message group ID** message ของ group เดียวกันถูก process ทีละตัวตามลำดับ ระหว่างที่ตัวหนึ่ง in flight อยู่ จะไม่มี message อื่นของ group นั้นถูกส่งออกไป จนกว่าตัวนั้นจะถูกลบหรือ visibility timeout ของมันหมด ส่วน group ที่ต่างกันถูก process แบบขนาน บน queue แบบ *standard* ตัว `MessageGroupId` แค่เปิด fair queue ที่กันไม่ให้ tenant ที่เสียงดังตัวเดียวไปถ่วงตัวอื่น และไม่ได้เรียงลำดับอะไรเลย
- **Azure Service Bus: session** receiver รับ session หนึ่งไป แล้วถือ exclusive lock บนทุก message ของ session นั้น รวมถึงตัวที่มาถึงทีหลัง ส่วน receiver ตัวอื่นก็ได้ session อื่นไป session เปิดเป็นราย queue หรือราย subscription หลังจากนั้นทุก message ต้องมี session ID และ tier Basic ไม่มีฟีเจอร์นี้
- **Apache Kafka: partition** producer ที่ตั้ง key จะส่งทุก record ที่มี key นั้นไป partition เดียวกัน (default partitioner hash ตัว key) และใน consumer group แต่ละ partition เป็นของ consumer ตัวเดียวเท่านั้น ลำดับต่อ key ยังอยู่ แต่ parallelism ก็หยุดที่จำนวน partition: consumer ตัวที่สี่บน topic ที่มีสาม partition จะไม่มีอะไรให้ทำเลย *Share group* (Queues for Kafka, KIP-932) ที่พร้อมใช้ใน production ตั้งแต่ Kafka 4.2 เข้ามายกเพดานนี้ออก consumer หลายตัวอ่าน partition เดียวกันได้ โดยมี acknowledgement และ delivery count ต่อ record แต่แลกกับการที่ record ไม่ได้ถูก process ตามลำดับอีกต่อไป
- **Google Cloud Pub/Sub: ordering key** เปิด message ordering บน subscription แล้ว publish message ที่เกี่ยวข้องกันด้วย ordering key เดียวกัน ใน region เดียวกัน แต่ ordering ก็มีต้นทุนของมัน: message ที่ถูกส่งซ้ำจะลากทุก message ที่ตามมาทีหลังใน key เดียวกันกลับมาด้วย แม้แต่ตัวที่ acknowledge ไปแล้ว ส่วน push subscription ยอมให้มี message ค้างได้แค่ตัวเดียวต่อ key และการ publish ก็จำกัดไว้ที่ 1 MBps ต่อ key
- **RabbitMQ: single active consumer** consumer อ่าน queue ได้ทีละตัวเท่านั้น และ consumer ตัวอื่นที่ register ไว้จะรับช่วงต่อถ้าตัวนั้นถูก cancel หรือหลุด แบบนี้ทั้ง queue ก็รักษาลำดับไว้ได้ ถ้าอยากเรียงลำดับต่อ key และยังทำงานขนานกันได้ ก็ต้องแบ่ง key ไปไว้ใน queue แบบนี้หลาย ๆ ตัว

ราคาเหมือนกันทุกที่ parallelism ถูกจำกัดไว้ที่จำนวน key, group หรือ partition และ message ที่ช้าหรือล้มเพียงตัวเดียวก็ถ่วงทุกอย่างที่อยู่ข้างหลังใน key เดียวกัน ถ้า handler รับมือกับการสลับลำดับได้ เช่นเมินการ update ที่ version เก่ากว่าตัวที่เก็บไว้แล้ว เราก็ได้ parallelism เต็มที่ และไม่ต้องใช้อะไรพวกนี้เลย

### Scale pool

scale ตามสิ่งที่ queue บอก ไม่ใช่ตาม CPU: จำนวน message ที่รออยู่ กับอายุของตัวที่เก่าที่สุด worker ที่รอ I/O อาจนั่งอยู่หลัง backlog ก้อนใหญ่ทั้งที่ CPU ว่างก็ได้ KEDA เป็นตัวอย่างหนึ่งสำหรับ Kubernetes ตัว SQS scaler ของมันตั้งเป้าจำนวน message ต่อ replica (`queueLength` default 5) และนับ message ที่ in flight รวมกับตัวที่รออยู่ด้วย ถ้าไม่ได้บอกเป็นอย่างอื่น ส่วน Pub/Sub scaler ของมัน scale ตามอายุของ message ที่ยังไม่ acknowledge ตัวที่เก่าที่สุดแทน backlog ได้ ถ้า `minReplicaCount` เป็นค่า default คือ 0 ตัว KEDA จะลบทุก replica ออกเมื่อ queue เงียบไปนานครบ cooldown period (default 300 วินาที) แล้วค่อยเริ่มตัวหนึ่งใหม่เมื่อมีงานเข้ามา serverless platform ก็ consume queue แบบเดียวกัน และที่นั่นก็เหมือนกัน: message แรกหลังช่วงเงียบต้องรอ cold start ดู [Autoscaling](../autoscaling/) และ [Serverless](../serverless/)

### ปกป้องสิ่งที่ worker เรียก

worker สิบตัวบน database ตัวเดียวแปลว่า connection และ query มากขึ้นสิบเท่า queue ปกป้อง worker จาก burst แต่ไม่มีอะไรปกป้อง database จาก worker นอกจากขีดจำกัดที่เราตั้งเอง: ขนาด pool สูงสุด (`maxReplicaCount` ของ KEDA default 100) ขีดจำกัด concurrency ต่อ worker, pool แยกต่อ dependency ([Bulkhead](../bulkhead/)) และขีดจำกัดอัตราการเรียก ([Rate Limiting & Throttling](../rate-limiting/)) คำอธิบาย pattern นี้ของ Microsoft ยังนับการจำกัดจำนวน consumer ที่ทำงานพร้อมกันเป็นวิธีคุมค่าใช้จ่ายด้วย

### ปิด worker

scale-in และการ deploy หยุด worker แบบตั้งใจ เลยต้องทำให้นุ่มนวล เมื่อได้ `SIGTERM` (Kubernetes ส่งตัวนี้มา แล้วรอ 30 วินาทีเป็นค่า default ก่อนจะ kill container) ให้หยุดรับ ทำและ acknowledge สิ่งที่ทำเสร็จได้ภายใน grace period แล้วส่งที่เหลือคืน แทนที่จะปล่อยให้ lease หมดเอง: `ChangeMessageVisibility` เป็น 0 ใน SQS, *abandon* ใน Service Bus, nack พร้อม requeue ใน RabbitMQ (ปิด channel ก็ requeue เหมือนกัน) และ `close()` บน Kafka share consumer ที่จะปล่อย record ที่มันถืออยู่

### ข้าง ๆ pattern นี้

- **งานด่วนก่อนงานประจำ** competing consumers ให้บริการ queue ตามลำดับที่มาถึงคร่าว ๆ งานด่วนเลยต้องรอหลัง backlog ส่วน pattern Priority Queue แก้เรื่องนี้ โดยทั่วไปด้วย queue หนึ่งตัวและ worker pool หนึ่งชุดต่อ priority
- **ผลลัพธ์สำหรับผู้เรียก** worker ไม่ได้ตอบ producer ถ้าผู้เรียกต้องการผลลัพธ์ ให้ใช้ Asynchronous Request-Reply: รับ request พร้อม ID แล้วให้ worker เก็บผลลัพธ์ไว้ หรือส่งไปทาง reply queue พร้อม correlation ID แล้วให้ผู้เรียก poll หรือรอรับแจ้ง

## ใช้ตอนไหนดี

- งานเข้ามาเป็น task ที่อิสระต่อกัน รันขนานกันได้และลำดับไหนก็ได้: ย่อขนาดรูป, ส่ง email, render เอกสาร, ทำ index, import ไฟล์, process payment ของลูกค้าที่ต่างกัน
- ปริมาณงานเปลี่ยนไปตามช่วงของวัน และเราอยากเพิ่มหรือลด capacity โดยไม่ต้องแตะ producer
- การ process ต้องรอดได้เมื่อ worker ล้ม: worker ตัวอื่นทำต่อไป และ message ของตัวที่ล้มก็กลับมา
- ไม่เหมาะเมื่อ message ต้องมีลำดับเดียวทั้งระบบ ตัว stream ที่เรียงลำดับเดียว process ได้ทีละ consumer เท่านั้น เลยไม่มีอะไรให้แย่ง
- ไม่เหมาะเมื่องานแบ่งเป็น message ที่อิสระต่อกันไม่ได้ หรือเมื่อ task หนึ่งต้องใช้ผลลัพธ์ของอีก task กรณีนั้น workflow หรือ saga เหมาะกว่า
- ไม่เหมาะเมื่อคอขวดอยู่ปลายทาง worker ที่มากขึ้นก็แค่กดดัน database หรือ API ที่อิ่มตัวอยู่แล้วให้หนักขึ้น

## ได้อะไร เสียอะไร

- **ลำดับหายไป** หรือเก็บไว้ได้แค่ต่อ key โดยแลกกับ parallelism ที่ถูกจำกัด
- **ตัวซ้ำเป็นเรื่องปกติ** handler ทุกตัวต้อง idempotent และ side effect ทุกอย่างที่อยู่นอก database ของเราเองก็ต้องมีตัวกันของมันเอง เช่น idempotency key
- **lease ต้องจูน** สั้นเกินไป message ที่ช้าจะรันสองรอบ ยาวเกินไป การกู้คืนหลัง crash ก็ช้า งานที่ยาวต้องมีโค้ดต่ออายุ lease
- **Poison message** ต้องมี retry limit, dead-letter queue และคนที่คอยดูมัน
- **โหลดย้ายไปปลายทาง** การ scale out pool ก็คือการ scale out call ที่มันยิงออกไปด้วย
- **ตามยากขึ้น** request หนึ่งตอนนี้ไปจบที่ worker ตัวใดตัวหนึ่งใน N ตัว ให้ใส่ correlation ID ไว้ใน message แล้ว log มัน หรือใช้ [distributed tracing](../distributed-tracing/)
- **queue กลายเป็นคอขวดได้** ที่ปริมาณสูงมาก ๆ queue ตัวเดียวจะจำกัด throughput ไว้ ส่วน Microsoft แนะนำให้แบ่งระบบ messaging ออกเป็น partition กระจายไปหลาย queue

## ข้อควรรู้ตอนลงมือทำ

**pattern เดียวกันในแต่ละ broker:**

| | worker ได้ message ยังไง | Lease (default) | ลำดับต่อ key | เลิกพยายามหลัง (default) |
|---|---|---|---|---|
| Amazon SQS | Pull: `ReceiveMessage` ได้สูงสุด 10 ตัวต่อครั้ง long polling ได้สูงสุด 20 s | Visibility timeout 30 s สูงสุด 12 h | FIFO queue กับ message group ID | `maxReceiveCount` ใน redrive policy ที่เราตั้งเอง |
| Azure Service Bus | receiver ขอ message เอง เปิด prefetch ได้ถ้าต้องการ | Peek-lock 1 min (สูงสุด 5 min) ต่ออายุได้ | Session | `MaxDeliveryCount` 10 |
| RabbitMQ | push ไปให้ consumer ที่ register ไว้ จำกัดด้วย prefetch | ไม่มีตัวจับเวลา: ส่งซ้ำเมื่อ channel หรือ connection ปิด ส่วน acknowledgement timeout คือ 30 min | Single active consumer ต่อ queue | Quorum queue: ส่งไม่สำเร็จ 20 ครั้ง |
| Apache Kafka, consumer group | Pull: `poll()` | ไม่มีต่อ record: partition เป็นของ consumer ตัวเดียว และจะถูกย้ายไปตัวอื่นถ้าไม่เรียก `poll()` ภายใน `max.poll.interval.ms` (5 min) | Partition เลือกตาม key | broker ไม่มีขีดจำกัด: แอปพลิเคชันตัดสินเอง |
| Apache Kafka, share group (4.2+) | Pull: `poll()` | Acquisition lock 30 s | ไม่มี | ลองส่ง 5 ครั้ง |
| Google Cloud Pub/Sub | pull หรือ push subscription | Acknowledgement deadline 10 s (10 ถึง 600 s) client library ต่อเวลาให้ | Ordering key เปิดบน subscription | Dead-letter topic: ลอง 5 ครั้ง (5 ถึง 100) |

- **เฝ้า depth กับอายุของแต่ละ queue** และดู message ที่ in flight ด้วย ใน SQS คือ `ApproximateNumberOfMessagesVisible`, `ApproximateAgeOfOldestMessage` และ `ApproximateNumberOfMessagesNotVisible` ถ้า depth โตขึ้นเรื่อย ๆ ก็แปลว่า worker น้อยเกินไป ส่วนถ้าอายุโตขึ้นขณะที่ depth ยังเล็ก ก็ชี้ว่ามี message ที่ล้มซ้ำ ๆ หรือติดอยู่หลัง key ตัวหนึ่ง
- **ให้ worker เหมือนกันทุกตัวและ stateless** อะไรก็ตามที่งานต้องใช้ ให้อยู่ใน message หรือใน store ที่ใช้ร่วมกัน worker ตัวไหนก็จะได้หยิบ message ไหนก็ได้ รวมถึงตัวที่ worker อื่นทำหล่นไว้
- **test เส้นทางตอน crash** kill worker กลาง message แล้วเช็กว่า message กลับมาหลัง lease หมด การรันรอบที่สองไม่ก่อความเสียหาย และ message ที่ล้มทุกครั้งไปจบที่ dead-letter queue
- **Batch อย่างระวัง** การ receive และ acknowledge เป็น batch ช่วยประหยัด call แต่ทุก message ใน batch เริ่มนับ lease พร้อมกัน message ตัวสุดท้ายของ batch ที่ช้าอาจหมดเวลาระหว่างรอคิว และทั้ง batch ของ worker ที่ crash ก็จะกลับมาพร้อมกันหมด
