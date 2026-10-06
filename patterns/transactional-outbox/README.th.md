## ปัญหา

service ที่เปลี่ยนข้อมูลของตัวเอง ส่วนใหญ่ต้องบอก service อื่นด้วย: Order Service บันทึก order แล้วประกาศ *OrderPlaced* ออกไป เพื่อให้ Inventory, Payments และ Notifications ทำงานต่อได้ แบบนี้ต้องเขียนสองครั้งลงสองระบบที่ต่างกัน คือ database กับ message broker และไม่มี local transaction ไหนครอบทั้งสองได้ distributed transaction (two-phase commit เช่นผ่าน XA) ครอบได้ แต่บ่อยครั้งที่ broker หรือ database ไม่รองรับ และต่อให้รองรับทั้งคู่ มันก็ผูกการเขียนทุกครั้งไว้กับ availability ของทั้งสองระบบ

ถ้าไม่มี transaction แบบนั้น จะเขียนสองครั้งนี้ลำดับไหนก็มีช่องโหว่:

- **Commit ก่อน แล้วค่อย publish** ถ้า process crash โดน redeploy หรือติดต่อ broker ไม่ได้ในช่วงระหว่างสองจังหวะนี้ การเปลี่ยนแปลงจะถูกบันทึกแล้ว แต่ event ไม่เคยถูกส่ง ข้อมูลของ service ปลายทางก็ค่อย ๆ เพี้ยนไปเงียบ ๆ และไม่มีอะไร retry ให้ เพราะความตั้งใจที่จะ publish มีอยู่แค่ใน memory
- **Publish ก่อน แล้วค่อย commit** หรือ publish จากใน transaction ที่ยังเปิดอยู่ ถ้า commit พังหรือ rollback ทีหลัง consumer ก็ทำงานตาม order ที่ไม่มีอยู่จริงไปแล้ว

retry ก็ปิดช่องโหว่นี้ไม่ได้ ตัว retry ใน memory ตายไปพร้อมกับ process และการเก็บ event ที่ค้างส่งแบบ durable ไว้ที่อื่นก็เป็นแค่ dual write อีกรอบ ยกเว้นจะเก็บไว้ใน database เดียวกันและใน transaction เดียวกัน และนั่นก็คือ outbox

## ทำงานยังไง

1. **เขียน event ลงตาราง outbox ใน transaction เดียวกัน** local transaction ที่ insert หรือ update แถวข้อมูลธุรกิจ จะ insert แถวลงตาราง `outbox` ใน database เดียวกันด้วย event ละหนึ่งแถว: มี event ID ที่ไม่ซ้ำกัน aggregate (ในที่นี้คือ order) ที่ event นั้นเป็นของ ประเภท event และ payload แล้ว atomicity ของ database ก็จัดการส่วนที่เหลือให้: event จะมีอยู่ก็ต่อเมื่อการเปลี่ยนแปลงทางธุรกิจ commit แล้วเท่านั้น และเส้นทางของ request ไม่เคยเรียก broker เลย
2. **Relay outbox ไปที่ broker** process อีกตัวที่แยกออกมา คือ **message relay** จะหยิบแถวใน outbox ที่ commit แล้วมา publish ตามลำดับ แล้วบันทึกความคืบหน้าหลังจาก broker ตอบรับแล้วเท่านั้น ถ้า crash ระหว่าง publish กับการบันทึกนั้น มันก็จะ publish event เดิมซ้ำ การส่งเลยเป็นแบบ **at-least-once**
3. **ตัด event ซ้ำที่ฝั่ง consumer** ทุก event มี ID ที่ไม่ซ้ำกัน แล้ว consumer ก็จำ ID ที่ประมวลผลไปแล้ว และข้ามตัวที่ซ้ำ (pattern Idempotent Consumer) ส่วน event ของ aggregate เดียวกันใช้ message key เดียวกัน ทำให้ broker แบบแบ่ง partition รักษาลำดับของมันไว้ได้

### Polling หรือ log tailing

relay หา event ใหม่ได้สองแบบ:

| | Polling publisher | Transaction log tailing (CDC) |
|---|---|---|
| **หา event ใหม่โดย** | query outbox หาแถวที่ยังไม่ได้ส่งทุกช่วงเวลาสั้น ๆ | อ่าน change log ของ database แล้วเลือกเฉพาะการ insert ลง outbox: write-ahead log ของ PostgreSQL ผ่าน logical decoding, binlog ของ MySQL, DynamoDB Streams, change feed ของ Azure Cosmos DB |
| **บันทึกความคืบหน้าโดย** | mark แถวว่าส่งแล้ว หรือลบทิ้ง | บันทึกตำแหน่งของตัวเองใน log |
| **Latency** | ไม่เกินหนึ่งรอบของ polling interval | เกือบ real time: อ่าน log ไปพร้อมกับที่ log ถูกเขียน |
| **ภาระของ database** | query ทุกรอบที่ poll บวกกับการ update หรือ delete | การอ่าน log และ log ที่ต้องเก็บไว้จนกว่า relay จะอ่าน |
| **ลำดับ** | เรียงตาม sequence column แต่จะยุ่งยากถ้ามีหลายตัวเขียนพร้อมกันและมี poller หลายตัว | ตามลำดับ commit ที่ log บันทึกไว้ ส่วน transaction ที่ rollback จะไม่โผล่มาเลย |
| **ต้องมี** | SQL database ตัวไหนก็ได้ | สิทธิ์เข้าถึง log และ connector เฉพาะของ database นั้น เช่น Debezium |

ทั้งสองแบบเป็น at-least-once: poller จะส่ง event ซ้ำถ้ามัน crash หลัง publish แต่ก่อน mark ว่าส่งแล้ว ส่วนตัวอ่าน log จะส่งซ้ำถ้ามัน crash ก่อนบันทึกตำแหน่ง

## ใช้ตอนไหนดี

- service ต้องเปลี่ยนข้อมูลของตัวเอง **และ** บอก service อื่นแบบเชื่อถือได้: domain event, integration event สำหรับทีมอื่น, command และ reply ของ [saga](../saga-orchestration/) หรือการเปลี่ยนแปลงที่ป้อนให้ read model, search index และ cache
- database กับ broker เข้าร่วม transaction เดียวกันไม่ได้ หรือคุณไม่อยากให้การเขียนทุกครั้งต้องพึ่งให้ทั้งสองระบบทำงานอยู่ ถ้ามี database ต่อ service และ broker แยกต่างหาก ก็มักจะเป็นแบบนี้
- คุณต้องการ *ก็ต่อเมื่อ*: ไม่มี event ของการเปลี่ยนแปลงที่ rollback ไปแล้ว และไม่มีการเปลี่ยนแปลงที่ commit แล้วแต่ไม่มี event
- ไม่ต้องใช้ ถ้าการเสีย event ไปบ้างเป็นครั้งคราวรับได้ (telemetry, notification แบบ best-effort) หรือถ้า event เป็น source of truth อยู่แล้ว (event sourcing ด้านล่าง)

## ได้อะไร เสียอะไร

- **At-least-once ไม่ใช่ exactly-once** relay อาจ publish event เดียวกันสองครั้ง และ broker ส่วนใหญ่ก็ส่งซ้ำได้อยู่แล้ว consumer ทุกตัวเลยต้อง idempotent บาง pipeline ตัดตัวซ้ำออกตอนเข้า broker: Debezium ใช้ exactly-once support สำหรับ source connector ของ Kafka Connect ได้ (KIP-618, Kafka 3.3 ขึ้นไป) ส่วน Amazon SQS FIFO queue จะไม่สน deduplication ID ที่ซ้ำภายใน 5 นาที และ Azure Service Bus จะทิ้ง `MessageId` ที่ซ้ำภายใน duplicate-detection window (default 10 นาที) แต่ไม่มีตัวไหนครอบการส่งซ้ำไปที่ consumer หรือ side effect ของ consumer เอง
- **Eventual consistency แบบมีดีเลย์** consumer จะเห็นการเปลี่ยนแปลงก็ต่อเมื่อ relay หยิบมันไปแล้ว: นานสุดหนึ่งรอบของ polling interval หรือเท่ากับ lag ของตัวอ่าน log ส่วน service ที่เป็นผู้ผลิตยังได้ read-your-own-writes เพราะ database ของตัวเองถูก update แบบ synchronous
- **database ทำงานหนักขึ้น** ทุก transaction ต้องเขียนแถวเพิ่มอีก event ละหนึ่งแถว แล้ว relay ก็เพิ่ม query สำหรับ polling และการ update หรือเพิ่ม log ที่ต้องเก็บไว้จนกว่าจะถูกอ่าน บน primary ที่งานเยอะ นี่คือภาระจริง ต้องวัดดู
- **มีอีก component ที่ต้องรัน** relay ต้องมี monitoring, alerting และ failover ถ้ามี relay หลาย instance ที่ไม่ประสานกัน ก็อาจ publish แถวซ้ำสองครั้งหรือผิดลำดับได้
- **ลำดับรับประกันแค่ต่อ key** broker แบบแบ่ง partition รักษาลำดับภายใน partition เดียว เลยต้องใช้ aggregate ID เป็น key ของ message และไม่มีลำดับรวมข้าม aggregate
- **ลืมง่าย** ทุกเส้นทางในโค้ดที่เปลี่ยน state ต้องเขียน event ของมันด้วย ให้ aggregate เป็นตัวสร้าง domain event แล้วให้ persistence layer เขียนลง outbox ใน unit of work เดียวกัน ดีกว่าพึ่งให้ handler แต่ละตัวจำเอง

### ทางเลือกอื่น

| แนวทาง | การเขียนครั้งเดียวไปที่ | service อื่นได้ event จาก | ต้นทุนหลัก |
|---|---|---|---|
| **Transactional outbox** | database ของ service: แถวข้อมูลธุรกิจบวกแถวใน outbox | relay ที่ publish แถวใน outbox | มีตาราง outbox และ relay ที่ต้องรัน และส่งแบบ at-least-once |
| **CDC บนตารางธุรกิจ** | database ของ service แบบเดิมไม่เปลี่ยน | CDC connector ที่ stream การเปลี่ยนแปลงทุกแถว | ไม่ต้องแก้โค้ด แต่ consumer ได้การเปลี่ยนแปลงระดับแถวแทน business event และอาจพังได้เมื่อ schema ภายในเปลี่ยน |
| **Event sourcing** | event store ที่ event คือ state | subscription บน store หรือ relay แบบเดียวกับ outbox | วิธี model และ query ข้อมูลที่ต่างออกไป ปกติต้องมี projection และ CQRS |
| **Listen to yourself** | broker | broker และ service ก็ consume event ของตัวเองเพื่อ update database ของตัวเองด้วย | การอ่านของ service เองตามหลังการเขียน และถ้าพังตอน apply event ปัญหาจะโผล่หลังจากที่ผู้เรียกไปทำอย่างอื่นต่อแล้ว |
| **Distributed transaction (2PC/XA)** | ทั้งสองที่ แบบ atomic | broker | ทั้งสองระบบต้องรองรับแบบนี้ ส่วน participant ที่ prepare แล้วจะค้างถ้า coordinator ล้ม และการเขียนทุกครั้งต้องพึ่งให้ทั้งสองระบบทำงานอยู่ |

## ข้อควรรู้ตอนลงมือทำ

- **Schema ของ outbox** มี event ID ที่ไม่ซ้ำกัน (UUID) ประเภทและ ID ของ aggregate, ประเภท event, payload และเวลาที่สร้าง บวกกับ flag ว่าส่งแล้ว หรือคอลัมน์ `sent_at` สำหรับ relay แบบ polling ตัว Outbox Event Router ของ Debezium คาดหวังคอลัมน์ `id`, `aggregatetype`, `aggregateid`, `type` และ `payload` เป็น default มัน route แต่ละ event ไปที่ topic ชื่อ `outbox.event.<aggregatetype>` แล้วใช้ `aggregateid` เป็น message key ของ Kafka และส่ง `id` ไปใน message header ให้ consumer ใช้ตัดตัวซ้ำได้
- **Poll ให้ปลอดภัย** อ่านแถวที่ยังไม่ได้ส่งทีละ batch เล็ก ๆ เรียงตาม sequence column แล้ว publish จากนั้นค่อย mark ว่าส่งแล้ว อย่าติดตามความคืบหน้าแบบ "ID สูงสุดที่ส่งไปแล้ว" เพราะ ID ถูกกำหนดตอน insert แถว ไม่ใช่ตอน transaction commit ทำให้ transaction ที่ช้าอาจ commit ID ที่ต่ำกว่าได้หลังจาก poller ข้ามไปแล้ว ส่วน poller หลายตัวแบ่งงานกันได้ด้วย `SELECT … FOR UPDATE SKIP LOCKED` ตามที่เอกสารของ PostgreSQL แนะนำไว้สำหรับตารางที่ใช้เหมือน queue แต่แบบนั้นมันอาจ publish event ของ aggregate เดียวกันผิดลำดับได้ ถ้าจะรักษาลำดับต่อ key ให้รัน relay ที่ active แค่ตัวเดียวด้วย leader election หรือแบ่ง outbox ให้ relay แต่ละตัวตาม hash ของ key
- **Log tailing** Debezium รันเป็น source connector ของ Kafka Connect หรือเป็น Debezium Server ที่ส่งไปยังระบบอื่น เช่น Amazon Kinesis, Google Cloud Pub/Sub หรือ Apache Pulsar ได้โดยไม่ต้องมี Kafka ส่วนถ้าเป็น PostgreSQL มันต้องใช้ logical decoding (`wal_level=logical`) และ replication slot ตัว slot จะเก็บ WAL ไว้จนกว่า connector จะยืนยัน ทำให้ connector ที่หยุดไปอาจทำ disk ของ database server เต็มได้: ให้ monitor lag ของ slot และลองใช้ `max_slot_wal_keep_size` (default ไม่จำกัด) เป็นเพดาน
- **การเก็บกวาด** relay แบบ polling ลบแถวทิ้งเมื่อส่งแล้ว หรือเก็บไว้สักสองสามวันเผื่อ replay และ audit แล้วค่อยลบเป็น batch และถ้าแบ่ง partition ตารางตามวัน ก็ drop แถวเก่าได้ถูก ๆ ส่วนถ้าใช้ log tailing คุณลบแถวใน outbox ได้ใน transaction เดียวกับที่ insert มันเลย: log ยังมีการ insert อยู่ แล้ว router ของ Debezium ก็กรองการ delete ทิ้ง ตารางเลยว่างอยู่ตลอด แนวทางของ Azure Cosmos DB เก็บ event ไว้ข้าง ๆ document ธุรกิจใน logical partition เดียวกัน แล้วให้ TTL ลบมันทิ้ง
- **ลำดับ** ใช้ aggregate ID เป็น message key เพื่อให้ event ของ aggregate เดียวกันเรียงตามลำดับ: partition key ใน Kafka, `MessageGroupId` ใน SQS FIFO queue, `SessionId` ใน Azure Service Bus, ordering key ใน Google Cloud Pub/Sub ตัว relay ต้อง publish event ของแต่ละ key ตามลำดับที่ commit และ consumer ต้องประมวลผลแต่ละ key ทีละ message
- **Idempotent consumer** insert event ID ลงตาราง processed-messages ที่มี unique key ใน transaction เดียวกับการเปลี่ยนแปลงของ consumer เอง ตัวที่ซ้ำจะ insert ไม่ผ่าน แล้วก็ถูกข้ามไป ส่วน idempotent producer ของ Kafka ช่วยตรงนี้ไม่ได้: มันตัดตัวซ้ำที่เกิดจาก retry ของตัวเองภายใน producer session เดียว ไม่ใช่แถวที่ relay ส่งซ้ำอีกรอบหลัง restart
- **คอยดู lag** อายุของแถวที่ยังไม่ได้ส่งที่เก่าที่สุด หรือ lag ของ connector คือสัญญาณสุขภาพ: มันจะโตขึ้นทุกครั้งที่ relay หรือ broker ล่ม ตั้ง alert ไว้ที่ค่านี้ และที่ event ที่ publish ไม่ผ่านซ้ำ ๆ
- **Library และ product** Debezium กับ Outbox Event Router ของมัน (log tailing), Eventuate Tram (polling หรือ log tailing) และสำหรับ .NET มี NServiceBus Outbox กับ transactional outbox ของ MassTransit โดยทั้งคู่จับคู่ outbox กับการตัดตัวซ้ำที่ฝั่ง consumer
