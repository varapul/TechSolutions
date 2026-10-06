## ปัญหา

ระบบส่วนใหญ่เก็บแค่ **state ปัจจุบัน** คำสั่ง `UPDATE accounts SET balance = 40 WHERE id = 42` เขียนทับค่า 70 ที่เคยอยู่ตรงนั้น แล้วคำตอบทุกข้อของคำถาม "เรามาถึงตรงนี้ได้ยังไง" ก็หายไปด้วย:

- **เรื่องราวหายไป** มันเป็นการถอนเงิน ค่าธรรมเนียม หรือการแก้ไข? เกิดเมื่อไหร่ และใครเป็นคนขอ? แถวที่เก็บแค่ค่าล่าสุดตอบไม่ได้ ส่วน audit table และ trigger แปะประวัติเพิ่มเข้าไปได้ แต่ประวัตินั้นก็เป็นบันทึกชุดที่สองที่อาจคลาดจากชุดแรก และไม่มีอะไรบังคับให้ทั้งสองตรงกัน
- **ข้อมูลเก่าตอบคำถามใหม่ไม่ได้** balance ตอนสิ้นเดือนมีนาคมเป็นเท่าไหร่? ลูกค้าคนนี้ถอนเงินกี่ครั้งเมื่อปีที่แล้ว? ถ้าค่าถูกเขียนทับไปแล้ว คำตอบก็หายไปแล้ว
- **State กับ event อาจไม่ตรงกัน** service ที่ update แถวแล้ว publish event ด้วยก็คือเขียนสองครั้ง ถ้าไม่มีอะไรผูกสองอย่างนี้ไว้ด้วยกัน crash ระหว่างนั้นจะทำให้ service อื่นเชื่อเรื่องราวที่ต่างจาก database

## ทำงานยังไง

Event sourcing กลับด้าน model: **ลำดับของ event คือบันทึก** ส่วน state ปัจจุบันเป็นสิ่งที่คำนวณออกมาจากมัน คำอธิบายของ Martin Fowler เมื่อปี 2005 ยังเป็นแบบที่สั้นที่สุด: "เก็บทุกการเปลี่ยนแปลงของ application state ไว้เป็นลำดับของ event" บัญชีแยกประเภท (ledger) ก็ทำงานแบบนี้ version control ก็เหมือนกัน โดย commit คือ event และ working copy คือ state ที่ได้มาจากมัน

1. **command เข้ามา** ในที่นี้คือ `Withdraw 30` ตัว handler โหลด stream ของ aggregate แล้ว fold event ให้กลายเป็น state ปัจจุบัน: `state = events.reduce(apply, initialState)` แนวทางของ Azure เรียกขั้นนี้ว่า *rehydration*
2. **ตัดสินใจ** เช็กกฎทางธุรกิจกับ state นั้น: balance 70 พอสำหรับ 30 ตรงนี้ command ยังถูกปฏิเสธได้ เพราะยังไม่มีอะไรถูกเขียนลงไป
3. **Append** event ใหม่หนึ่งตัวหรือมากกว่าต่อท้าย stream ในที่นี้คือ `Withdrew 30` และไม่แตะ event ก่อนหน้าเลย
4. **ทุกอย่างที่เหลือได้มาจาก stream:** การโหลดครั้งถัดไป, snapshot, read model และอะไรก็ตามที่ส่งไปบอก service อื่น

| | Store แบบเก็บ state ปัจจุบัน (CRUD) | แบบ event-sourced |
|---|---|---|
| **เก็บอะไร** | ค่าล่าสุดของแต่ละ record | ทุกการเปลี่ยนแปลง ในรูปของ event ที่แก้ไม่ได้ |
| **การเขียนคือ** | update ทับที่เดิม | append ต่อท้าย stream |
| **State ปัจจุบัน** | อ่านได้ตรง ๆ | fold ไล่ไปบน stream โดยจะเริ่มจาก snapshot ก็ได้ |
| **ประวัติและ audit** | แปะเพิ่มด้วย audit table หรือ trigger | มีอยู่ในตัว: event ก็คือประวัติ |
| **Query** | อ่านจากตารางได้ตรง ๆ | อ่านจาก projection ที่ eventually consistent |
| **การแก้ความผิดพลาด** | แก้แถว | append compensating event |

### Command กับ event

- **command** คือคำขอ ตั้งชื่อเป็นคำสั่ง: `Withdraw`, `ReverseDeposit` มันถูกปฏิเสธได้
- **event** คือข้อเท็จจริง ตั้งชื่อเป็นรูปอดีตด้วยภาษาของธุรกิจ: `AccountOpened`, `Deposited`, `Withdrew`, `DepositReversed` มันเกิดขึ้นไปแล้ว เลยปฏิเสธไม่ได้ ทำได้แค่ตามด้วย event อีกตัว เอกสาร CQRS ของ Greg Young ย้ำเรื่องไวยากรณ์นี้ด้วยเหตุผลนี้: รูปคำสั่งแสดงว่า server มีสิทธิ์ตอบว่าไม่
- บันทึก **เจตนา** ไม่ใช่แค่ state ที่เป็นผล: `Withdrew 30` แทนที่จะเป็น `BalanceChanged` เป็น 40 ส่วน Azure ก็ยกตัวอย่างเรื่องการจองที่นั่ง: "มีการจองสองที่นั่ง" มีค่ามากกว่า "จำนวนที่นั่งที่เหลือเปลี่ยนเป็น 42" เพราะ event ที่มีแค่ state จะทำให้ store กลายเป็น change log ที่ไม่มีความหมายทางธุรกิจ

### หนึ่ง stream ต่อหนึ่ง aggregate โดยมี version คุม

event ถูกจัดกลุ่มเป็น **stream** ปกติคือหนึ่ง stream ต่อ aggregate instance หนึ่งตัว (`account-42`) การโหลด aggregate เลยอ่านแค่ stream สั้น ๆ เส้นเดียว ไม่ใช่ทั้ง log แต่ละ event มีตำแหน่งใน stream ของมัน และตำแหน่งของตัวสุดท้ายคือ **version** ของ stream ส่วนบาง store เรียกมันว่า revision

version ยังใช้เป็นตัวเช็ก **optimistic concurrency** ไปด้วย handler จะ append พร้อม version ที่มันอ่านมา ("expected version 3") ถ้ามี writer อื่นเขียนไปก่อน stream ก็จะขยับไปแล้ว และ store จะปฏิเสธการ append นั้น ตัว handler ก็โหลด stream ใหม่ เช็กกฎอีกรอบกับ state ใหม่ แล้ว retry ไม่มี lock ค้างไว้ระหว่างที่ handler คิด และการถอนเงินสองครั้งจะไม่มีวันใช้เงิน 70 ก้อนเดียวกันได้ทั้งคู่

### Snapshot

การ replay stream ยาว ๆ ทุกครั้งที่มี command จะช้า **snapshot** เก็บ state ที่ fold แล้ว ณ version หนึ่ง (balance 40 ที่ version 4) แล้วการโหลดก็จะกลายเป็น snapshot ล่าสุดบวกกับ event ที่มาหลังจากนั้น snapshot เป็นแค่ cache: stream ยังเป็น source of truth อยู่ ตัว snapshot ลบแล้วสร้างใหม่ได้ทุกเมื่อ และต้องสร้างใหม่เมื่อรูปร่างของ state เปลี่ยน อย่าเพิ่ม snapshot ไปตามความเคยชิน Greg Young บอกว่า replay event ถึง 1,000 ตัวก็ยังเร็วพอสำหรับหลายระบบ และ snapshot ที่ persist ไว้ก็มักไม่คุ้มกับต้นทุนทั้งด้านความคิดและด้าน operation

### Projection และทำไม CQRS ถึงมาด้วยกัน

stream ตอบคำถามได้ดีอยู่ข้อเดียว: เกิดอะไรขึ้นกับบัญชี 42 บ้าง คำถามอื่น ("บัญชีไหนติดลบบ้าง") จะต้อง replay ทุก stream ระบบที่ใช้ event sourcing เลยมี **projection**: subscriber ที่ consume event ตามลำดับแล้วดูแล read model ที่จัดรูปมาสำหรับ query เช่น account summary และ monthly statement ใน step 3 การมี write model แบบ append-only คู่กับ read model แยกต่างหากก็คือ [CQRS](../cqrs/) และในทางปฏิบัติสองอย่างนี้มาด้วยกัน microservices.io พูดไว้ตรง ๆ ว่า เพราะ event store query ได้ยาก "application ต้องใช้ Command Query Responsibility Segregation (CQRS) ในการทำ query"

- projection **ทิ้งได้** ถ้าจะแก้ bug ในตัวหนึ่ง หรือจะเพิ่ม view ที่ไม่มีใครนึกถึงตอนเขียน event ก็สร้างมันใหม่ตั้งแต่ event #1 แล้วสลับไปใช้เมื่อมันตามทัน
- มันเป็นแบบ **eventually consistent**: read model ตามหลัง stream อยู่เท่ากับเวลาที่ใช้ส่งและประมวลผล
- ปกติการส่งเป็นแบบ at-least-once ตัว projection เลยต้อง **idempotent**: เก็บตำแหน่งของ event ล่าสุดที่ apply ไว้ข้าง ๆ view แล้วข้ามทุกอย่างที่อยู่ที่ตำแหน่งนั้นหรือต่ำกว่า

### การแก้ไขและคำถามเกี่ยวกับอดีต

event ไม่มี `UPDATE` ความผิดพลาดจะถูกแก้ด้วย **compensating event** ที่ append เข้าไปเหมือน event ทั่วไป: ใน step 4 ตัว `DepositReversed` ระบุการฝากเงินที่มันกลับรายการ และ stream ก็แสดงทั้งความผิดพลาดและการแก้ไข นี่คือ pattern Compensating Transaction ที่ใช้กับ stream เดียว นักบัญชีทำงานแบบนี้มาตลอด และคำแนะนำของ Greg Young ก็ตามแบบพวกเขา: ให้เลือก **full reversal** (ยกเลิกรายการที่ผิดทั้งรายการ แล้วค่อยบันทึกรายการที่ถูก) มากกว่าการปรับแค่บางส่วน เพราะย้อนกลับมาดูทีหลังแล้วเข้าใจง่ายกว่ามาก

เพราะไม่มีอะไรถูกเขียนทับ **temporal query** ก็ทำได้เป็นธรรมชาติ: state ณ event ใดก็ได้หรือ ณ เวลาใดก็ได้ ก็คือการ fold ไปจนถึงจุดนั้น

## ใช้ตอนไหนดี

- **ประวัติคือตัวธุรกิจเอง:** ledger, payment, order, claim, booking ทุกที่ที่ auditor, ลูกค้า หรือทีม support ถามว่า record มาอยู่ในสถานะปัจจุบันได้ยังไง
- คุณต้องการ **audit trail ที่ไม่มีวันคลาด** จากข้อมูล เพราะข้อมูลถูกสร้างขึ้นมาจากมัน
- คุณคาดว่าจะมี **คำถามใหม่เกี่ยวกับข้อมูลเก่า:** read model ใหม่, analytics หรือการ replay event จาก production เพื่อ debug และ test
- consumer หลายตัวต้องรู้ทุกการเปลี่ยนแปลงแบบเชื่อถือได้ การ append event คือการเขียนแบบ atomic ครั้งเดียว และ subscriber ก็ถูกป้อนจาก stream เลยไม่มี dual write

มันเป็นเครื่องมือที่ผิดเมื่อ:

- domain เป็น **CRUD ธรรมดา** ที่ไม่ต้องการประวัติ, audit หรือ replay หรือข้อมูลเป็น reference data ที่แทบไม่เปลี่ยน
- ทุก view ต้อง **consistent ทันที** แต่ projection เป็น eventually consistent โดยธรรมชาติ
- ทีมยังใหม่กับการออกแบบแบบ event-driven และ product เป็น prototype หรืออยู่ได้ไม่นาน งานที่ต้องลงแรงตั้งแต่ต้นกับการออกแบบ event, schema evolution และ projection แทบไม่เคยคุ้มทุน

ไม่ต้องเลือกแบบทั้งหมดหรือไม่เอาเลยก็ได้ แนวทางของ Azure แนะนำให้ใช้กับส่วนที่ได้ประโยชน์มากที่สุด เช่น payment ledger หรือ order pipeline แล้วใช้ CRUD ธรรมดากับส่วนที่เหลือ เช่น user profile และ configuration

## ได้อะไร เสียอะไร

- **วิธีทำงานที่ต่างออกไป และต้องใช้เวลาเรียนรู้** การ model, test, debug และ operation เปลี่ยนไปหมด อย่าง test ก็จะกลายเป็น "ถ้ามี event เหล่านี้ในอดีต เมื่อ command นี้เข้ามา ก็จะได้ event ใหม่เหล่านี้"
- **Eventual consistency** ระหว่าง stream กับ read model ทุกตัว พร้อมผลต่อ user experience ตามที่อธิบายไว้ใน [CQRS](../cqrs/)
- **Event อยู่ตลอดไป และ schema ของมันก็เช่นกัน** stream ที่เขียนวันนี้จะถูก replay ด้วยโค้ดที่เขียนขึ้นอีกหลายปีข้างหน้า (ดู schema evolution ด้านล่าง)
- **Query ต้องใช้ projection** แต่ละตัวคือโค้ดที่ต้องเขียน, store ที่ต้องรัน และ lag ที่ต้องคอยดู
- **Immutability ขัดกับ right to erasure** ข้อมูลส่วนบุคคลใน log แบบ append-only ชนกับกฎหมายอย่าง right to erasure ของ GDPR (Article 17) ต้องออกแบบรองรับไว้ตั้งแต่ต้น (ดูด้านล่าง)
- **Replay ต้องไม่ทำ side effect ซ้ำ** การ rebuild ที่ส่ง email ทุกฉบับออกไปอีกรอบคือหายนะ ให้ projection ไม่มี side effect และปิด gateway ไปยังระบบภายนอกระหว่าง replay อย่างที่ Fowler อธิบายไว้
- **Store มีแต่โตขึ้น** stream ยาว ๆ จะโหลดช้าถ้าไม่มี snapshot และสุดท้าย event เก่าก็ต้องถูก archive ไปที่ storage ที่ถูกกว่า ส่วน stream จะสั้นอยู่ได้ถ้ามันตาม lifecycle ที่มีจุดจบ (statement หนึ่งรอบ กะทำงานหนึ่งกะ) แทนที่จะตาม entity ที่อยู่ไปตลอด
- **Conflict กลายเป็น retry** ถ้ามีการแย่งกันหนักบน stream เดียว optimistic concurrency จะกลายเป็นงานที่ต้องทำซ้ำไปเรื่อย ๆ และนั่นมักแปลว่า aggregate ใหญ่เกินไป

## ข้อควรรู้ตอนลงมือทำ

- **การเลือก event store** store ต้องมี operation ไม่กี่อย่าง: append ลง stream พร้อม expected version, อ่าน stream ตามลำดับ และ subscribe ทุกอย่างตามลำดับ
  - *สร้างมาเพื่องานนี้โดยเฉพาะ* KurrentDB (ชื่อเดิมคือ EventStoreDB จนกระทั่ง vendor อย่าง Event Store เปลี่ยน brand เป็น Kurrent และ release แรกภายใต้ชื่อใหม่คือ 25.0) ให้การ append แต่ละครั้งระบุ stream state หรือ revision ที่คาดไว้ได้ และจะ throw ถ้า stream ไม่ได้อยู่ในสถานะนั้น ส่วน Marten เพิ่ม event store ให้ PostgreSQL สำหรับ .NET พร้อม append แบบมี version, snapshot และ projection
  - *ตาราง relational* ตาราง `events` ที่มี stream ID, version, event type และ payload พร้อม **unique constraint บน (stream ID, version)** ทำให้ writer สองตัวที่พยายาม insert version 4 สำเร็จพร้อมกันทั้งคู่ไม่ได้ เอกสาร CQRS ของ Greg Young ร่างแนวคิดเดียวกันนี้ไว้ด้วย version column ต่อ aggregate ที่เช็กภายใน transaction
  - *Key-value store หรือ document store* ใน DynamoDB ให้ใช้ stream เป็น partition key และ version เป็น sort key แล้ว put แต่ละ event ด้วยเงื่อนไข `attribute_not_exists` บน key แล้วการ put จะล้มเหลวถ้ามี item นั้นอยู่แล้ว ส่วนใน Azure Cosmos DB ให้ใช้ stream เป็น partition key และ version เป็น item ID: ID ไม่ซ้ำกันภายใน logical partition เดียว การสร้าง version เดิมสองครั้งเลยล้มเหลวด้วย `409 Conflict` และ transactional batch ก็ append หลาย event ลง stream เดียวแบบ atomic ได้
  - *ใช้ log broker อย่างเดียวไม่ค่อยลงตัว* Kafka และ broker แบบเดียวกันเก็บ record ตามลำดับภายใน partition และ replay ได้ดี เหมาะกับการกระจาย event ไปให้ projection และ service อื่น แต่มันอ่าน event ของ entity เดียวแบบต้นทุนต่ำไม่ได้ และไม่มี conditional append: [KIP-27 (Conditional Publish)](https://cwiki.apache.org/confluence/display/KAFKA/KIP-27+-+Conditional+Publish) ที่เสนอให้เพิ่มเรื่องนี้ใน Kafka ยังมีสถานะ "under discussion" อยู่ แนวทางของ Azure ก็ขีดเส้นแบบเดียวกัน: broker ใช้เป็น distribution layer ได้ดี "แต่มันใช้แทน event store ไม่ได้" ส่วนบทความของ AWS เกี่ยวกับ pattern นี้เลือกอีกทาง โดยใช้ Kinesis Data Streams เป็น store และ archive ไว้ใน Amazon S3 แล้วปล่อยให้ application ตรวจจับการเขียนที่ชนกันเอง
- **Schema evolution** event เก่าไม่เคยถูกเขียนใหม่ โค้ดเลยต้องอ่านได้ทุก version ที่เคยเขียนไว้
  - เลือกการเปลี่ยนแบบเพิ่มเข้าไป และใช้ **tolerant reader**: ไม่สน field ที่ไม่รู้จัก และใช้ค่า default กับ field ที่ขาดไป
  - **Upcast** ตอนอ่าน: ฟังก์ชันเล็ก ๆ แปลง event version 1 เป็น version 2 ตอนโหลด ทำให้โค้ดส่วนที่เหลือเห็นแค่รูปร่างล่าสุด ขณะที่ event ที่เก็บไว้ยังเหมือนตอนที่ถูกเขียน
  - กฎของ Greg Young ใน *Versioning in an Event Sourced System*: event version ใหม่ต้องแปลงมาจาก version เก่าได้ ถ้าแปลงไม่ได้ มันคือ event ใหม่ ไม่ใช่ version ใหม่
  - การเขียนประวัติใหม่ ไม่ว่าจะคัดลอก stream ไปเป็น stream ใหม่ผ่านการแปลง หรือ migrate event ในที่เดิม เป็นทางเลือกสุดท้าย มันทำลาย audit trail และ consumer ก็ได้ทำงานตาม event เก่าไปแล้ว
- **ข้อมูลส่วนบุคคล** ถ้าทำได้ให้เก็บมันไว้นอก event: เก็บในตารางธรรมดาแล้วใส่แค่ reference ไว้ใน event เพื่อให้ลบได้เมื่อมีคนขอ ถ้ามันต้องเดินทางไปกับ event จริง ๆ **crypto-shredding** จะเข้ารหัสข้อมูลของแต่ละคนด้วย key ของคนนั้นเอง และลบ key ทิ้งเมื่อจะลืมคนนั้น event ยังอยู่ที่เดิมแต่อ่านไม่ได้ ทั้งหมดนี้คือเทคนิคทางวิศวกรรม ไม่ใช่คำแนะนำทางกฎหมาย ให้ตรวจดูว่าวิธีของคุณเป็นไปตามกฎหมายจริง และ right to erasure ก็มีข้อยกเว้น เช่น record ที่กฎหมายบังคับให้ต้องเก็บไว้
- **Event ภายในไม่ใช่ public contract** event ใน store ละเอียดและมีรูปร่างตามโครงสร้างภายในของ aggregate ทีมอื่นที่ subscribe มันตรง ๆ จะผูกติดกับ model ของคุณ และทุกการ refactor จะกลายเป็น breaking change สำหรับพวกเขา ให้แปลงเป็น **integration event** แยกต่างหากที่หยาบกว่า แล้วถือว่าแค่พวกนั้นเป็น API ที่มี version
- **Publish ไปให้ service อื่น** ป้อน broker จาก subscription บน store ตัว store เลยทำหน้าที่เป็น [transactional outbox](../transactional-outbox/) ของตัวเอง: แต่ละ event ถูกเขียนครั้งเดียว relay ส่งมันแบบ at least once และ consumer ตัดตัวซ้ำเอง (pattern Idempotent Consumer)
- **กฎที่ข้ามหลาย stream** ถ้าทำได้ให้ command แต่ละตัวอยู่กับ stream เดียว กฎที่ข้าม aggregate เช่นการโอนเงินระหว่างสองบัญชี จะกลายเป็น [saga](../saga-orchestration/) ที่มีขั้น compensate ส่วนบาง store ตอนนี้ก็มีการ append แบบ atomic ลงหลาย stream แล้ว อย่าง KurrentDB ก็มีมาตั้งแต่ 25.1
- **Snapshot ในทางปฏิบัติ** สร้างแบบ asynchronous ทุกครั้งที่มี event ครบจำนวนหนึ่ง และเก็บไว้นอก stream โดยใช้ aggregate กับ version เป็น key เมื่อ format ของ state เปลี่ยน ให้สร้างใหม่แทนที่จะ migrate
- **ญาติใกล้ชิด** [Event-driven architecture](../event-driven-architecture/) เป็นเรื่องที่ service คุยกันยังไง ส่วน event sourcing เป็นเรื่องที่ service หนึ่งเก็บ state ของตัวเองยังไง และแต่ละอย่างใช้ได้โดยไม่ต้องมีอีกตัว ส่วน Change Data Capture ก็ให้ stream ของการเปลี่ยนแปลงเหมือนกัน แต่ได้มาจากแถวในตารางหลังเกิดเหตุไปแล้ว (balance เปลี่ยนจาก 70 เป็น 40) และไม่มีเจตนาแบบที่ domain event บันทึกไว้ และ Materialized View ก็คือสิ่งที่ projection ดูแลอยู่
