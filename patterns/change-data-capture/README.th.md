## ปัญหา

แถวหนึ่งเปลี่ยนใน system of record แต่สำเนาของมันอยู่ที่อื่นด้วย: ใน search index, cache, data warehouse หรือ read model ของ service อื่น ทุกสำเนาต้องตามให้ทัน และสองวิธีที่คิดออกเป็นอย่างแรกก็ล้มเหลวทั้งคู่

- **Dual write** แอปพลิเคชันเขียนลง database ของตัวเอง แล้วเขียนต่อไปที่ระบบอื่นทีละตัว ไม่มี transaction ไหนครอบทั้งหมด ถ้า crash หรือ timeout ระหว่างการเขียนสองครั้ง สำเนาก็จะไม่ตรงกัน และ request สองตัวที่มาพร้อมกันก็อาจไปถึงแต่ละระบบคนละลำดับ แล้ว consumer ใหม่ทุกตัวก็หมายถึงต้องแก้แอปพลิเคชันอีกรอบ
- **Polling** ให้ consumer แต่ละตัว query ตารางหาแถวที่ `updated_at` ใหม่กว่ารอบที่แล้ว query เห็นแค่ state ณ ตอนที่มันรัน: แถวที่ถูกลบก็แค่หายไปเฉย ๆ การ update หลายครั้งระหว่างการ poll สองรอบก็ยุบเหลือแค่ครั้งสุดท้าย และทุกตารางต้องมี column timestamp ที่ writer ทุกตัวคอยดูแล ส่วน query พวกนี้ก็เพิ่ม load และสำเนาก็ยังตามหลังได้นานถึงหนึ่งรอบ poll

ในขณะเดียวกัน database ก็จดสิ่งที่ consumer ต้องการไว้ครบอยู่แล้ว ทุกการเปลี่ยนแปลงที่ commit จะลงไปใน transaction log ของมันตามลำดับ ก่อนที่การ commit จะถูก acknowledge ส่วน Change data capture (CDC) ก็คือการเปลี่ยน log นั้นให้เป็น stream

## ทำงานยังไง

1. **log คือต้นทาง** write-ahead log ใน PostgreSQL, binary log ใน MySQL และ transaction log ใน SQL Server มีไว้ให้ database กู้คืนหลัง crash ป้อนข้อมูลให้ replica หรือ restore กลับไปที่จุดเวลาใดเวลาหนึ่ง ในนั้นมีสิ่งที่ตารางแสดงให้เห็นไม่ได้: ทุกค่าระหว่างทางและทุกการ delete ตามลำดับการ commit ส่วนแอปพลิเคชันก็เขียนไปตามเดิม และไม่รู้ด้วยซ้ำว่ามีคนอื่นอ่านอยู่
2. **connector tail log นั้น** connector ต่อเข้า database คล้าย ๆ กับที่ replica ทำ อ่าน log จาก position ที่บันทึกไว้ แล้วแปลงการเปลี่ยนแปลงระดับแถวที่ commit แล้วแต่ละตัวให้เป็น event งานจาก transaction ที่ rollback ไปจะไม่โผล่มาเลย
3. **event ไปลง stream** แบบที่ใช้กันทั่วไปคือหนึ่ง topic ต่อหนึ่งตาราง และใช้ primary key ของแถวเป็น message key
4. **consumer เอาไป apply** แต่ละ consumer อ่าน topic ตามจังหวะของตัวเอง เก็บ offset ของตัวเอง แล้ว upsert หรือ delete ใน store ของตัวเอง การเพิ่ม consumer ไม่ได้เปลี่ยนอะไรที่ต้นน้ำเลย

connector บันทึกไว้ว่าอ่านไปถึงไหนแล้ว และหลัง restart ก็ทำต่อจากตรงนั้น position ที่บันทึกไว้นี้คือสิ่งที่ทำให้ pipeline เริ่มใหม่ได้ และก็เป็นสิ่งที่ทำให้มันเป็น at-least-once ด้วย: ใน diagram ตัว connector อ่าน entry 43 ไปแล้ว แต่บันทึก position ไว้แค่ 42 ตอนที่มัน crash ทำให้ 43 ถูก publish ซ้ำเป็นครั้งที่สอง (ดูได้อะไร เสียอะไร)

### สามวิธีจับการเปลี่ยนแปลง

| | Log-based | Trigger-based | Query-based |
|---|---|---|---|
| **หาการเปลี่ยนแปลงด้วย** | การอ่าน transaction log | trigger ที่ copy การเปลี่ยนแปลงแต่ละครั้งไปไว้ในตารางข้าง ภายใน transaction ที่เขียน | การ poll หาแถวที่ timestamp หรือ version ใหม่กว่า |
| **เห็นอะไร** | ทุกการเปลี่ยนแปลงที่ commit ตามลำดับการ commit รวมถึง delete และค่าเก่าถ้า database log ไว้ | สิ่งที่ trigger บันทึก รวมถึง delete | แค่ state ปัจจุบัน: ไม่เห็น delete ไม่เห็นค่าระหว่างทาง |
| **ภาระที่ต้นทาง** | การอ่าน log และการเก็บ log ไว้จนกว่าจะถูกอ่าน | การเขียนเพิ่มในทุก transaction และ trigger ที่ต้องดูแลในทุกตาราง | query หนึ่งครั้งต่อการ poll บวก column timestamp กับ index อีกหนึ่งตัวต่อตาราง |
| **Delay** | ปกติต่ำกว่าหนึ่งวินาทีไปเยอะ | ขึ้นกับว่าอ่านตารางข้างยังไง | ได้ถึงหนึ่งรอบ poll |
| **ต้องมี** | สิทธิ์เข้าถึง log และ connector สำหรับ database นั้น | การรองรับ trigger และการแก้ schema | แค่ SQL |

pattern นี้คือคอลัมน์แรก ชื่อ product ทำให้เส้นแบ่งพร่ามัว: feature ของ SQL Server ที่ชื่อ *change data capture* อ่าน transaction log ด้วย capture job แต่เก็บผลไว้ใน change table ที่ client ต้องมา query เอาอีกที ส่วน *change tracking* ที่เบากว่าก็แค่บันทึกแบบ synchronous ว่าแถวไหนเปลี่ยน

### event มีอะไรติดมาบ้าง

envelope ของ Debezium เป็นตัวอ้างอิงที่ดี เครื่องมืออื่นก็มีข้อมูลชุดเดียวกันแต่ใช้ชื่ออื่น:

- **`op`**: `c` สำหรับ insert, `u` สำหรับ update, `d` สำหรับ delete และ `r` สำหรับแถวที่อ่านระหว่างทำ snapshot
- **`before`** กับ **`after`**: แถวก่อนและหลังการเปลี่ยนแปลง insert ไม่มี `before` ส่วน delete ไม่มี `after`
- **`source`**: ตาราง, position ใน log (LSN ใน PostgreSQL ส่วนใน MySQL เป็นไฟล์ binary log กับ offset หรือ GTID), transaction และเวลา commit
- **message key**: primary key ของแถว

แถวเก่าจะมาครบแค่ไหน ขึ้นกับว่า database log อะไรไว้ โดย default ตัว PostgreSQL log แค่ primary key เก่า และสำหรับ update ก็ log เฉพาะตอนที่ตัว key เปลี่ยน ส่วน `REPLICA IDENTITY FULL` จะ log แถวเก่าทั้งแถว แลกกับ WAL ที่เยอะขึ้น ค่าขนาดใหญ่ที่ PostgreSQL เก็บแยกไว้นอกแถว (TOAST) จะไม่อยู่ใน event ถ้ามันไม่ได้เปลี่ยน ส่วน MySQL log ภาพก่อนและหลังแบบครบทั้งแถวเป็น default (`binlog_row_image=FULL`) และ Debezium ก็บังคับให้ตั้งค่านี้

### ลำดับ

- **ระดับแถว: ได้** การเปลี่ยนแปลงทั้งหมดของแถวเดียวใช้ key เดียวกัน เลยไปลง partition เดียวกันตามลำดับการ commit นี่คือการรับประกันที่เอาไปต่อยอดได้
- **ระดับตาราง: ได้เฉพาะตอนมี partition เดียว** ถ้ามีหลาย partition การเปลี่ยนแปลงของแถวต่างกันอาจถูก consume คนละลำดับกับตอนที่ commit
- **ข้ามตาราง: ไม่ได้** แต่ละตารางเป็น topic ของตัวเอง transaction ที่แตะสามตารางเลยมาเป็น event บนสาม topic และ consumer อาจเห็น order line ก่อน order ส่วน Debezium ปล่อย marker `BEGIN` กับ `END` พร้อมจำนวน event ต่อตาราง (`provide.transaction.metadata`) ได้ สำหรับ consumer ที่ต้องประกอบ transaction กลับขึ้นมา แต่ consumer ส่วนใหญ่ถูกเขียนให้ทนช่องว่างนี้แทน

### Snapshot

log ย้อนกลับไปได้แค่ระยะหนึ่ง stream ที่เริ่มวันนี้เลยไม่มีแถวที่ถูกเขียนเมื่อปีที่แล้ว

- **Initial snapshot** ตอนเริ่มครั้งแรก connector จะอ่านแถวที่มีอยู่ ณ จุดที่ consistent จุดเดียวใน log ปล่อยมันออกมาเป็น event แบบ `r` แล้ว stream ต่อจาก position นั้นพอดี ทำให้ไม่มีอะไรตกหล่นระหว่างสองช่วง
- **Incremental snapshot** ตารางที่เพิ่มเข้ามาทีหลัง หรือต้องอ่านใหม่อีกรอบ ไม่ควรทำให้ stream หยุดไปหลายชั่วโมง incremental snapshot อ่านตารางทีละ chunk ระหว่างที่ stream ยังทำงานต่อ และใช้ watermark ที่เขียนผ่าน log เพื่อทิ้งแถวใน chunk ที่มี change event ใหม่กว่าแซงไปแล้ว Debezium เริ่มมันด้วย signal ส่วนเทคนิคนี้มาจาก paper DBLog ของ Netflix
- **consumer ใหม่** ก็เริ่มจาก snapshot เหมือนกัน ถ้า topic ยังเก็บทุก key ไว้ (หัวข้อถัดไป) การอ่านมันตั้งแต่ต้นก็คือ snapshot นั้น ถ้าไม่ได้เก็บ ก็ใช้ incremental snapshot ปล่อยแถวออกมาอีกรอบ

### Delete, tombstone และ compaction

- delete มาเป็น event ที่มี `op: d` และมีแถวเก่า หรือแค่ key ของมัน อยู่ใน `before`
- บน Kafka ตัว change topic ที่เปิด **log compaction** จะเก็บ event ล่าสุดของทุก key ไว้อย่างน้อยหนึ่งตัว ตัว topic เองเลยเป็น snapshot ที่ consumer ใหม่อ่านตั้งแต่ต้นได้ และเพื่อให้ compaction ลบแถวที่ถูก delete ออกไปได้หมด connector จะส่ง **tombstone** ตามหลัง delete event: คือ key เดิมที่มี value ว่าง
- Kafka ทิ้ง tombstone หลัง `delete.retention.ms` (default 24 ชั่วโมง) ทำให้ consumer ที่ต้องใช้เวลานานกว่านั้นในการอ่าน compacted topic ตั้งแต่ต้นอาจพลาด delete แล้วเก็บแถวที่ไม่มีอยู่แล้วไว้
- consumer จัดการทั้งสอง record: ลบตาม key เมื่อเจอ delete event และไม่ต้องทำอะไรกับ tombstone
- soft delete (`deleted_at`) ในมุมของ log ก็เป็นแค่ update ธรรมดา

### การเปลี่ยน schema

- event สะท้อนตารางตรง ๆ: เพิ่ม column แล้วมันก็โผล่มาใน event ถัดไป การเพิ่ม column ที่เป็น null ได้หรือมี default ปลอดภัยกับ consumer แต่การ rename, drop หรือเปลี่ยน type ของ column ไม่ปลอดภัย
- register schema ของ event ไว้ (Debezium serialise ด้วย Avro และ schema registry ได้) แล้วบังคับใช้กฎเรื่อง compatibility ที่นั่น การเปลี่ยนที่ไม่ compatible จะได้ถูกปฏิเสธตอน connector register มัน แทนที่จะให้ consumer แต่ละตัวไปเจอเอง
- engine แต่ละตัวให้ connector รู้เรื่องการเปลี่ยน schema ต่างกัน binary log ของ MySQL มี DDL statement อยู่ในนั้น และ Debezium เก็บมันไว้ใน schema history topic เพื่อให้ตีความ log entry เก่า ๆ ได้หลัง restart ส่วน logical decoding ของ PostgreSQL ไม่ปล่อย DDL ออกมา: connector จะเห็นรูปร่างใหม่ตอนแถวเปลี่ยนครั้งถัดไป
- ปล่อยการเปลี่ยนแปลงที่ทำให้ของพังตามลำดับแบบ expand-and-contract: เพิ่ม column ใหม่ ย้าย consumer ไปใช้ แล้วค่อย drop ตัวเก่า

## ใช้ตอนไหนดี

- **Derived store** เช่น search index, cache, feature store: อะไรก็ตามที่เก็บสำเนาข้อมูลที่ database เป็นเจ้าของ
- **Cache invalidation** การลบหรือ refresh entry จาก change stream ครอบคลุมไปถึงการเขียนที่ไม่ผ่านแอปพลิเคชันด้วย ส่วน [cache-aside](../cache-aside/) อย่างเดียวไม่มีทางเห็นการเขียนพวกนั้น
- **Analytics ingestion** ป้อนข้อมูลเข้า warehouse หรือ lakehouse อย่างต่อเนื่อง แทนการ extract ทุกคืน change stream ดิบเป็น bronze layer โดยธรรมชาติใน medallion architecture
- **Read model** ทำให้ฝั่ง query ของ [CQRS](../cqrs/) หรือ materialised view ทันสมัยอยู่เสมอ
- **Migration** ใช้ replicate ข้อมูลเข้า database ใหม่หรือ service ใหม่ระหว่างที่ traffic ค่อย ๆ ย้ายไป แบบใน migration ด้วย [strangler fig](../strangler-fig/)
- **Relay outbox** การอ่านตาราง outbox จาก log เป็นวิธีรัน [transactional outbox](../transactional-outbox/) ที่ latency ต่ำ
- **ระบบที่แก้ไม่ได้** แอปพลิเคชัน legacy หรือแอปสำเร็จรูปที่แตะโค้ดไม่ได้ ก็ยังมี log อยู่

ไม่ค่อยเหมาะเมื่อ:

- **consumer ต้องการเจตนาทางธุรกิจ** การเปลี่ยนแถวบอกว่า `status` เปลี่ยนจาก 3 เป็น 4 ไม่ได้บอกว่า order ถูกส่งออกไปแล้ว หรือเพราะอะไร ดูปัญหาเรื่อง coupling ด้านล่าง
- **ผู้เรียกต้องอ่านสิ่งที่ตัวเองเพิ่งเขียนจากสำเนา** สำเนาตามหลังต้นทางอยู่เสมอ
- **database ไม่ให้เข้าถึง log** หรือตารางไม่มี primary key ไว้ระบุแถว
- **query เป็นรอบ ๆ ก็พอแล้ว**: ตารางเล็ก ไม่มี delete และ delay ระดับนาทียอมรับได้

## ได้อะไร เสียอะไร

- **ส่งแบบ at-least-once** ตัว connector บันทึก position เป็นระยะ ๆ ไม่ได้บันทึกทุก event: Kafka Connect commit source offset ทุก `offset.flush.interval.ms` โดย default คือหนึ่งนาที หลัง crash มันจะ replay ทุกอย่างที่ publish ไปตั้งแต่การบันทึกครั้งล่าสุด database เองก็ส่งซ้ำได้ เพราะ PostgreSQL บันทึก position ของ slot ลง disk แค่ตอน checkpoint ส่วน exactly-once ของ Kafka Connect สำหรับ source connector (Kafka 3.3 ขึ้นไป) ตัดการซ้ำแบบแรกออกได้สำหรับ connector ที่ implement มัน แต่ไม่ได้ตัดการส่งซ้ำไปที่ consumer หรือ side effect ของ consumer เอง เพราะฉะนั้น consumer ต้อง idempotent เหมือน consumer แบบ [event-driven](../event-driven-architecture/) ทุกตัว
- **ปัญหาเรื่อง coupling** พวก topic ระดับตาราง publish schema ภายในของคุณออกไป แล้ว consumer ทุกตัวก็จะผูกกับชื่อ column กับวิธีแบ่งข้อมูลเป็นตาราง และกับ status code ที่ไม่เคยตั้งใจให้หลุดออกนอก service การ refactor เลยกลายเป็น breaking change ของทีมอื่น ทางออกมีสองทาง:
  - ตั้งใจ publish business event ออกไป เขียนมันลงตาราง outbox ใน transaction เดียวกัน แล้วจับเฉพาะตารางนั้น: นี่คือ [transactional outbox](../transactional-outbox/)
  - ปรับรูป stream ก่อนเปิดให้คนอื่นใช้ เก็บ topic ระดับตารางแบบดิบไว้เป็นของทีมเจ้าของเท่านั้น แล้วให้ stream processor หรือ connector transformation แปลงมันเป็น contract ที่มีเอกสารและมี version
- **Eventual consistency** สำเนาแต่ละชุดตามหลังต้นทางเท่ากับ lag ของ connector บวก lag ของตัวเอง
- **ต้นทางต้องจ่าย** มันต้องเก็บ log ที่ยังไม่มีใครอ่าน ใช้ CPU ไปกับการ decode เขียน log มากขึ้น (`wal_level=logical`, ภาพแถวเต็ม) และ initial snapshot ก็อ่านทุกแถวของทุกตารางที่ถูกจับ
- **การเปลี่ยนทีละเยอะกลายเป็นน้ำท่วม** `UPDATE` ตัวเดียวที่ครอบล้านแถวคือล้าน event และ event ของ transaction ที่ยาวจะโผล่มาตอนมัน commit เท่านั้น
- **ทุก column ออกไปจาก database** ข้อมูลส่วนบุคคลและ secret ไหลเข้า topic หมด ถ้าไม่ได้ exclude หรือ mask column ไว้ และ topic ก็ต้องมีกฎการเข้าถึงและ retention limit แบบเดียวกับที่ตารางมี
- **มีของให้ดูแลมากขึ้น** connector, stream, schema และ database account ที่อ่านได้ทุกอย่างที่มันจับ

### CDC, outbox หรือ event sourcing

ทั้งสามแบบจบที่ stream ของการเปลี่ยนแปลงที่ระบบอื่น consume เหมือนกัน ที่ต่างคือแอปพลิเคชันเขียนอะไร และ stream มีความหมายว่าอะไร

| | Change data capture | [Transactional outbox](../transactional-outbox/) | [Event sourcing](../event-sourcing/) |
|---|---|---|---|
| **แอปพลิเคชันเขียน** | ตารางของตัวเองตามเดิม | ตารางของตัวเองบวกแถวใน outbox ใน transaction เดียว | event ที่เป็นตัว state เอง |
| **consumer ได้รับ** | การเปลี่ยนแถว: ข้อมูลกลายเป็นอะไร | business event ที่ service เลือก publish | event ชุดเดียวกับที่ service เก็บไว้ |
| **Contract** | schema ของตาราง ถ้าไม่ได้ปรับรูป stream | event schema ที่ออกแบบมาเพื่อ consumer | event schema |
| **ต้องแก้โค้ด** | ไม่ต้อง | ทุกการเปลี่ยน state ต้องเขียน event ของมันด้วย | เปลี่ยนวิธี model state ไปเลย |

## ข้อควรรู้ตอนลงมือทำ

- **PostgreSQL** ตัว CDC สร้างอยู่บน logical decoding: ตั้ง `wal_level=logical` แล้วอ่านผ่าน **replication slot** เช่นใช้ plug-in `pgoutput` ที่มีมาให้ แล้ว slot ก็จะจำว่า connector ยืนยันไปถึงไหนแล้ว และเก็บ WAL ทั้งหมดหลังจุดนั้นไว้ ไม่ว่า connector จะต่ออยู่หรือไม่ก็ตาม เพราะฉะนั้น connector ที่หยุดอยู่จะทำให้ disk เต็ม: นี่คือพฤติกรรมใน step 4 ของ diagram ตัว `max_slot_wal_keep_size` จำกัดว่า slot เก็บได้แค่ไหน (default คือไม่จำกัด) ส่วน slot ที่ตามหลังเกินนั้นจะถูก invalidate แล้ว connector ก็ต้องทำ snapshot ใหม่ PostgreSQL 18 เพิ่ม `idle_replication_slot_timeout` ที่ invalidate slot ที่ไม่ active ค้างไว้นาน บน server ที่ตารางหรือ database อื่นยุ่งอยู่ แต่ตัวที่ถูกจับเงียบ ตัว slot จะไม่ขยับ แล้ว WAL ก็กองขึ้นอยู่ดี heartbeat ของ Debezium (`heartbeat.interval.ms` บวก `heartbeat.action.query` ตอนที่ database ที่ถูกจับเองว่าง) ช่วยให้มันขยับต่อ
- **MySQL** ใช้ row-based logging แบบภาพแถวเต็ม ที่นี่ไม่มี slot ความเสี่ยงเลยกลับด้าน: ไฟล์ binary log จะถูก purge หลัง `binlog_expire_logs_seconds` (default 30 วัน) ไม่ว่า connector จะอ่านไปแล้วหรือยัง connector ที่ล่มนานกว่านั้นจะทำต่อไม่ได้ และต้องทำ snapshot ใหม่
- **SQL Server** เปิด change data capture แยกต่อ database และต่อตาราง แล้ว capture job จะ copy การเปลี่ยนแปลงจาก transaction log ไปไว้ใน change table ที่ Debezium และ client อื่นอ่าน และ cleanup job ลบ entry ทิ้งหลังสามวันโดย default และถ้ามีการเปลี่ยนแปลงที่ capture job ยังไม่ได้เก็บไป ตัว log ก็ truncate เลยจุดนั้นไปไม่ได้
- **Failover ของต้นทาง** position ที่บันทึกไว้ต้องมีความหมายบน primary ตัวใหม่ด้วย อย่าง GTID ของ MySQL ก็ระบุ transaction ได้บนทุก server ทำให้ connector หาตำแหน่งของตัวเองบน replica ที่ถูก promote ได้ ส่วนใน PostgreSQL แต่ก่อน slot มีอยู่บน primary เท่านั้น version 16 ให้ทำ logical decoding บน standby ได้ และ version 17 เพิ่ม failover slot ที่ sync logical slot ไปที่ standby (`sync_replication_slots`) เพื่อให้ connector ทำต่อได้หลัง promote
- **Managed change stream** อย่าง DynamoDB Streams เก็บการเปลี่ยนแปลงระดับ item ไว้ 24 ชั่วโมง เรียงตามลำดับต่อ item และไม่มีการซ้ำ ส่วน change feed ของ Azure Cosmos DB ในโหมด default คืนแค่ version ล่าสุดของแต่ละ item และไม่มี delete ส่วนโหมด all-versions-and-deletes ต้องใช้ continuous backup ด้าน MongoDB change stream สร้างอยู่บน oplog และ resume จาก token ได้ ตราบใดที่ oplog ยังย้อนไปถึงตรงนั้น
- **Connector และ service** ตัว Debezium เป็นชุด source connector ของ Kafka Connect และยังรันแบบไม่มี Kafka ในรูป Debezium Server ได้ด้วย โดยมี sink อย่าง Amazon Kinesis, Google Cloud Pub/Sub และ Azure Event Hubs ส่วน AWS Database Migration Service รัน task แบบ full-load-plus-CDC หรือ CDC-only สำหรับ migration และการ replicate ต่อเนื่องระหว่าง data store และ Google Cloud Datastream เป็น serverless service ที่ replicate การเปลี่ยนแปลงเข้า BigQuery หรือ Cloud Storage
- **Idempotent consumer** ให้ upsert ตาม primary key และ delete ตาม key เพื่อให้การ apply event ซ้ำสองครั้งได้แถวเหมือนเดิม และเก็บ position ต้นทางของการเปลี่ยนแปลงล่าสุดที่ apply ไว้ด้วย จะเก็บต่อ key หรือเป็น external version ใน store ปลายทางก็ได้ แล้วข้าม event ที่ position เท่ากับหรือต่ำกว่านั้น: วิธีนี้จับได้ทั้ง event ซ้ำ และ event เก่าที่มาถึงหลังตัวใหม่กว่า ส่วน Idempotent Consumer pattern ครอบคลุม consumer ที่ทำให้ผลของมันทำซ้ำได้ด้วยวิธีนี้ไม่ได้
- **คอยดู lag** มีสองช่วง: source lag คือ connector ตามหลัง database อยู่แค่ไหน: Debezium รายงาน `MilliSecondsBehindSource` และ view `pg_replication_slots` ของ PostgreSQL แสดง `confirmed_flush_lsn`, `wal_status` และ `inactive_since` ของแต่ละ slot ส่วน consumer lag คือ consumer group แต่ละกลุ่มตามหลัง topic อยู่แค่ไหน ตั้ง alert เมื่อ slot ไม่ active หรือ WAL ที่มันเก็บไว้โตขึ้นเรื่อย ๆ: alert ตัวนี้แหละที่ช่วยรักษา disk ของ primary
- **ปรับรูปและกรองที่ connector** ทั้ง `column.exclude.list` และ property `column.mask.*` ช่วยกัน column ที่ sensitive ไม่ให้เข้า stream ตัว new record state extraction transformation ของ Debezium ลด envelope ให้เหลือแค่แถว `after` สำหรับ sink ที่ต้องการแค่แถว และ Outbox Event Router ของมันแปลงแถวใน outbox เป็น event บน topic แยกต่อ aggregate
