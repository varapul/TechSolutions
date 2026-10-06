## ปัญหา

ปกติจะมี model เดียวที่ทำทุกอย่าง entity `Order` ตัวเดียวกันที่ map ลงตารางแบบ normalised ชุดเดียวกัน ทั้ง validate การยกเลิก แสดงหน้าจอ "My orders" ตอบช่องค้นหา และป้อนข้อมูลให้รายงานประจำเดือน งานพวกนี้ต้องการของคนละแบบ:

- **การเขียน** ต้องการ schema แบบ normalised ที่เก็บข้อเท็จจริงแต่ละอย่างไว้ที่เดียว, transaction สั้น ๆ และกฎทางธุรกิจทุกข้ออยู่ในที่เดียว เพื่อให้ข้อมูลถูกต้องอยู่เสมอ
- **การอ่าน** ต้องการข้อมูลที่จัดรูปไว้พร้อมสำหรับหน้าจอแล้ว: join, aggregate และ filter ไว้แล้ว บางทีก็อยู่ใน engine คนละตัวไปเลย เช่น search index หรือ document store
- **Load ไม่สมดุล** ปกติการอ่านเยอะกว่าการเขียนมาก (เอกสาร CQRS ของ Greg Young บอกว่าบ่อยครั้งต่างกันถึงสอง order of magnitude หรือมากกว่านั้น) แต่ถ้ามี model เดียว ทั้งสองฝั่งก็ต้อง scale ไปด้วยกันและแย่ง lock เดียวกัน หน้าจอใหม่แต่ละหน้าก็เพิ่ม join, index หรือ column ลงใน schema ของ transaction อีก

การประนีประนอมแบบนี้ทำให้ทั้งสองฝั่งได้ของที่ไม่ดี: query ก็ช้าลงและซับซ้อนขึ้น ส่วน write model ก็เต็มไปด้วย field ที่มีแค่หน้าจอเดียวใช้

## ทำงานยังไง

CQRS หรือ Command Query Responsibility Segregation แยก model เดียวนั้นออกเป็นสอง เอกสาร CQRS ของ Greg Young บอกว่ามันมีที่มาจาก command-query separation ของ Bertrand Meyer: CQRS ใช้นิยามของ command และ query ตามแบบของ Meyer แต่แทนที่จะแยกพวกมันเป็น method บน object เดียว มันแยก object ออกเป็นสองตัว

- **Command** เปลี่ยน state และบอกเจตนา: `PlaceOrder`, `CancelOrder` ไม่ใช่ "set status เป็น 3" ตัว command handler โหลด **write model** มาเช็กกฎทางธุรกิจ (stock, วงเงินเครดิต, "ยังไม่ได้ส่งของ") แล้ว commit ใน transaction เดียว มันตอบกลับด้วยการตอบรับ อาจมี ID ใหม่กับ version ติดไปด้วย แต่ไม่ใช่ผลของ query
- **Query** ไม่เคยเปลี่ยน state แต่ละตัวอ่าน **read model** (เรียกอีกอย่างว่า view หรือ projection) ที่สร้างมาสำหรับคำถามนั้นพอดี: ตาราง summary สำหรับ "My orders" และ search index สำหรับช่องค้นหา query handler ไม่มีกฎทางธุรกิจเลย และส่วนใหญ่ก็เหลือแค่ `SELECT … WHERE key = ?` บนตารางเดียว
- **Projection** ทำให้ read model เป็นปัจจุบันอยู่เสมอ การเปลี่ยนแปลงแต่ละครั้งที่ commit แล้วจะถูก publish เป็น event (`OrderPlaced`, `OrderCancelled`) ผ่าน transactional outbox หรือ change data capture เพื่อให้ crash ระหว่าง commit กับ publish ไม่ทำมันหาย **projector** จะ consume event ตามลำดับ, update read model ทุกตัว แล้วบันทึก **checkpoint** ของมัน คือตำแหน่งของการเปลี่ยนแปลงล่าสุดที่ apply ไปแล้ว เพื่อให้ทำต่อได้หลัง restart

ถ้าสองฝั่งไม่ได้ใช้อะไรร่วมกันเลยนอกจาก event พวกนั้น แต่ละฝั่งก็เลือก storage, schema และ scale ที่เหมาะกับตัวเองได้ ใน diagram ฝั่ง write คือตารางแบบ normalised สามตาราง ส่วนฝั่ง read คือตาราง summary แบบ denormalised ที่มีสาม replica บวกกับ search index ตัว step 2 คือการส่งต่อแบบเดียวกับที่ [event-driven architecture](../event-driven-architecture/) ขยายให้ใช้ได้ทั่วไป: การเปลี่ยนแปลงครั้งเดียว กับ consumer กี่ตัวก็ได้

### Store เดียวหรือหลายตัว

CQRS ไม่ได้บังคับให้มี database ตัวที่สอง Martin Fowler บอกว่าสอง model นี้ "อาจใช้ database เดียวกันก็ได้ และถ้าเป็นแบบนั้น database จะทำหน้าที่เป็นตัวสื่อสารระหว่างสอง model"

| ทางเลือก | อะไรถูกแยก | Consistency ของการอ่าน | เหมาะกับ |
|---|---|---|---|
| **Database เดียว แยก model** | โค้ดและ schema: command เขียนตารางแบบ normalised ส่วน query อ่าน view, materialised view หรือตาราง summary | ทันที ถ้า summary ถูก update ใน transaction เดียวกัน ไม่อย่างนั้นก็เก่าเท่ากับการ refresh ครั้งล่าสุด | ได้ความชัดเจนของ CQRS โดยไม่ต้องรัน store เพิ่มอีกตัว |
| **Primary กับ read replica** | แค่ capacity ของการอ่าน ส่วน schema ยังเป็นตัวเดียวกัน | ตามหลังเท่ากับ replication lag | app ที่อ่านเยอะ และ query เข้ากับ schema ของฝั่ง write อยู่แล้ว |
| **Store แยกกัน** | schema, engine และการ scale | eventually consistent ผ่าน event | ใช้ engine ต่างกันในแต่ละฝั่ง (เขียนลง relational แต่อ่านจาก search หรือ document) และ scale ต่างกันมาก |

เรื่องแลกกันของ consistency จะมาทันทีที่ฝั่ง read ไม่ได้ถูก update ใน transaction เดียวกันแล้ว ต่อให้อยู่ใน database เดียวก็ตาม: materialised view ที่ refresh ตามรอบเวลา (ใน PostgreSQL ตัว `REFRESH MATERIALIZED VIEW CONCURRENTLY` refresh ได้โดยไม่ lock คนอ่าน) จะ stale อยู่ในช่วงระหว่างการ refresh แต่ละครั้ง

### ใช้หรือไม่ใช้ event sourcing

diagram ไม่ได้ใช้ event sourcing ตัว write model เก็บ state ปัจจุบันเป็นแถว แล้ว change event ก็ได้มาจากแต่ละ commit

- **ถ้าไม่ใช้ event sourcing** write store จะเก็บแค่ state ปัจจุบัน ส่วน event เป็นผลพลอยได้ของ commit และไม่ต้องเก็บไว้ตลอดไปก็ได้ การสร้าง projection ใหม่เลยต้องเริ่มจาก snapshot ของ state ปัจจุบัน
- **ถ้าใช้ event sourcing** ตัว event store *คือ* write model และเป็น source of truth หนึ่งเดียว projection ก็เป็นแค่ consumer ของ stream ทำให้ view ใหม่หรือ view ที่แก้แล้วสร้างได้ด้วยการ replay event ตั้งแต่ต้น แนวทางของ Azure เน้นเรื่องนี้: view สร้างใหม่ได้ "ด้วยการ replay event ในอดีต" ต้นทุนคือ write model ที่ต้องอ่านผ่าน replay และ snapshot
- **Event sourcing แทบจะต้องใช้ CQRS** เพราะ stream ของ event แบบ append-only นั้น query ตรง ๆ ได้ยาก microservices.io บอกว่า CQRS "จำเป็นใน architecture แบบ event sourced" แต่กลับกันไม่จริง

## ใช้ตอนไหนดี

CQRS คุ้มเมื่อสองฝั่งต่างกันจริง ๆ:

- การอ่านกับการเขียนต้องการรูปแบบหรือ scale ต่างกัน: หน้าจอที่อ่านเยอะและต้อง join และ aggregate, full-text search หรือ storage engine คนละแบบในแต่ละฝั่ง
- domain มีกฎที่ควรแยกออกมา เช่นหลัง UI แบบ task-based หรือในที่ที่ผู้ใช้หลายคนแก้ข้อมูลเดียวกัน ขณะที่หน้าจอเป็นแค่ projection ง่าย ๆ ของข้อมูลนั้น
- หน้าจอหนึ่งต้องใช้ข้อมูลที่หลาย service เป็นเจ้าของ ตัว view database ที่ป้อนด้วย event ของ service เหล่านั้นจะมาแทนการ join ข้าม service
- คุณใช้ event sourcing อยู่แล้ว และในแบบนั้น query ก็ต้องใช้ projection อยู่ดี

มันเกินจำเป็นเมื่อ:

- domain เป็นแค่ CRUD ธรรมดา และ model เดียวก็รองรับหน้าจอได้ดี Azure ระบุว่า domain ที่เรียบง่ายและ interface แบบ CRUD เป็นกรณีที่ pattern นี้อาจไม่เหมาะ
- มีแค่บางส่วนของระบบที่มีปัญหา Fowler เตือนว่า "สำหรับระบบส่วนใหญ่ CQRS เพิ่มความซับซ้อนที่เสี่ยง" และควรใช้ใน bounded context เฉพาะ ไม่ใช่ทั้งระบบ
- ปัญหาจริง ๆ คือรายงานที่ช้าหรือเส้นทางการอ่านที่ร้อน ใช้ reporting database, read replica หรือ cache ([cache-aside](../cache-aside/)) ก็ถูกกว่ามาก

## ได้อะไร เสียอะไร

- **Eventual consistency** ถ้า projection เป็นแบบ asynchronous ฝั่ง read ก็จะตามหลังฝั่ง write ทำให้ผู้ใช้อาจไม่เห็นการเปลี่ยนแปลงของตัวเอง (step 4) Werner Vogels เรียกสิ่งที่ผู้ใช้คาดหวังนี้ว่า *read-your-writes consistency* ทำให้ได้แบบนั้นในจุดที่สำคัญ:
  - *คืน state ใหม่จาก command* response มีสิ่งที่ client ต้องใช้แสดงผล (order ที่ถูกยกเลิก, ยอดรวมใหม่) client เลยไม่ต้อง query ทันที
  - *ส่ง version token* การตอบรับมีตำแหน่งของการเปลี่ยนแปลงนั้นมาด้วย (#8 ใน diagram) แล้ว client ก็ส่งมันไปกับ query ถัดไป ฝั่ง query จะรอ (โดยมี timeout สั้น ๆ) จน checkpoint ของตัวเองไปถึงตำแหน่งนั้น หรือไม่ก็ตอบ request นั้นจากฝั่ง write แทน ส่วน session token ของ Azure Cosmos DB ก็ใช้แนวคิดเดียวกันนี้ภายใน database ในรูปของ "minimum version barrier"
  - *Update UI แบบ optimistic* แสดงผลที่คาดไว้ทันที ("cancelled") แล้วค่อยปรับให้ตรงเมื่อ read model ตามทัน และ rollback ถ้า command ล้มเหลว ตัว hook `useOptimistic` ของ React เป็น implementation หนึ่ง
  - หรือออกแบบให้รับมือกับมันไปเลย: หน้าจอที่บอกว่า "ส่งคำขอยกเลิกแล้ว" ก็ตรงไปตรงมา และบ่อยครั้งก็เพียงพอ
- **ชิ้นส่วนเยอะขึ้น** outbox relay หรือ CDC connector, broker, projector และ store เพิ่ม: แต่ละตัวต้อง deploy, secure, monitor และจ่ายเงิน
- **Delivery semantics** pipeline ส่วนใหญ่ส่งแบบ at least once และรักษาลำดับแค่ต่อ key หรือต่อ partition เลยต้องทำให้ projector idempotent: เก็บตำแหน่งหรือ version ล่าสุดที่ apply ไว้กับแต่ละแถวของ view แล้วข้ามอะไรที่เก่ากว่า
- **Invariant อยู่ที่ฝั่ง write** อย่าพึ่ง read model ที่ eventually consistent ในการบังคับกฎ ("email นี้มีคนใช้แล้วหรือยัง") เพราะ command สองตัวอาจผ่านการเช็กทั้งคู่ก่อนที่ตัวไหนจะถูก project ทางที่ถูกคือบังคับกฎใน write store ด้วย unique constraint หรือภายใน aggregate เดียว
- **Event กลายเป็น contract** read model ทุกตัวพึ่ง schema ของ event เลยควรทำ version ให้มัน และเลือกการเปลี่ยนแบบเพิ่มเข้าไปเป็นหลัก
- **Debug ยากขึ้น** หน้าจอที่ผิดอาจมาจาก command, event, projector หรือแค่ lag ธรรมดา ให้ใส่ correlation ID ไว้ใน command และใน event ที่ command นั้นทำให้เกิด

## ข้อควรรู้ตอนลงมือทำ

- **การสร้าง projection ใหม่** read model ทิ้งได้ และคุณจะต้องสร้างมันใหม่แน่ ๆ: หลังเจอ bug ใน projector, เมื่อต้องการ column ใหม่ หรือเมื่อต้องการ view ใหม่ทั้งตัว
  - สร้างเวอร์ชันใหม่ไว้ข้าง ๆ ในตารางหรือ index ใหม่ ระหว่างที่ตัวเก่ายังให้บริการ query อยู่
  - ป้อนข้อมูลให้มันตั้งแต่ต้นประวัติ: replay event store (ถ้าใช้ event sourcing), อ่าน change topic ที่ถูก compact แล้วใหม่อีกรอบ (log compaction ของ Kafka เก็บค่าล่าสุดของแต่ละ key ไว้อย่างน้อยหนึ่งค่า) หรือถ่าย snapshot ใหม่ของ write store (incremental snapshot ของ Debezium อ่านตารางเป็นช่วง ๆ ไประหว่างที่ streaming ยังทำงานอยู่)
  - พอมันตาม live stream ทันแล้ว ก็สลับการอ่านไปทีเดียว เช่นด้วยการ rename ตาราง หรือการสลับ index alias แบบ atomic ใน Elasticsearch หรือ OpenSearch แล้วค่อย drop เวอร์ชันเก่า
  - ทำให้ projector deterministic และไม่มี side effect เพื่อให้ replay สร้าง view ใหม่ได้โดยไม่ส่ง email ซ้ำอีก
- **การ monitor projection lag** วัดเป็นสองหน่วยแล้ว alert ทั้งคู่:
  - *ตามหลังกี่การเปลี่ยนแปลง:* ตำแหน่งล่าสุดของฝั่ง write ลบด้วย checkpoint ของ projector ตัว Kafka รายงานค่านี้เป็น consumer-group lag (`kafka-consumer-groups.sh --describe` พิมพ์ column `LAG` ต่อ partition) ส่วน change feed estimator ของ Azure Cosmos DB รายงานว่ายังมีการเปลี่ยนแปลงค้างอยู่อีกกี่ตัว
  - *ตามหลังนานแค่ไหน:* เวลาตอนนี้ลบด้วยเวลา commit ของการเปลี่ยนแปลงล่าสุดที่ apply แล้ว Debezium เปิดค่านี้ให้ดูสำหรับช่วงของตัวเองเป็น `MilliSecondsBehindSource` ส่วนตัวเลขแบบ end-to-end ต้องรวม broker, projector และ replication ไปที่ read replica ด้วย
  - แถว heartbeat ที่ฝั่ง write update ทุกไม่กี่วินาที ทำให้สัญญาณยังมีอยู่ตอนที่ traffic เงียบ ส่วน checkpoint ที่หยุดขยับทั้งที่ยังมีการเปลี่ยนแปลงเข้ามาเรื่อย ๆ คือ alert ที่สำคัญที่สุด
- **Command ผ่าน HTTP** map command เป็น `POST` บน resource ที่เน้นงาน (`/orders/1042/cancel`) คืน `201 Created` หรือ `200 OK` เมื่อการเขียน commit แบบ synchronous หรือคืน `202 Accepted` พร้อม status URL เมื่อ command ถูกเข้าคิว (asynchronous request-reply) ถ้าแยก command กับ query แบบเคร่งครัด command จะไม่คืนอะไรเลย แต่การคืน ID กับ version ก็ไม่เสียหายอะไร และทำให้ read-your-writes เป็นไปได้
- **Building block แบบ managed** AWS อธิบายแบบที่ใช้ DynamoDB เป็นฝั่ง write โดยมี DynamoDB stream ป้อนให้ Lambda function ที่ update read model บน Aurora ส่วน change feed ของ Azure Cosmos DB ใช้ดูแล materialised view, search index และ cache ได้ ขณะที่ stack ที่ดูแลเองมักจับคู่ Debezium และ Kafka กับ Elasticsearch, OpenSearch หรือ document store
