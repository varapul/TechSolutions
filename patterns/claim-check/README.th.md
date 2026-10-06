## ปัญหา

เคลมประกันรถยนต์หนึ่งรายการเข้ามาที่ claims intake service: เป็นฟอร์ม JSON เล็ก ๆ กับรูปความเสียหายสิบสองรูป รวม 25 MB มีสอง service ที่ต้องใช้มัน: Damage assessment ให้คะแนนรูป ส่วน archive เก็บสำเนาไว้ ทั้งสองต่อกันผ่าน message broker วิธีที่คิดได้ทันทีก็คือ publish claim ทั้งก้อนเป็น message เดียว

broker ถูกสร้างมาเพื่อส่ง message เล็ก ๆ จำนวนมาก และส่วนใหญ่ก็จำกัดขนาดของ message ไว้ topic บน Azure Service Bus Standard tier รับได้ไม่เกิน 256 KB ทำให้ message นี้ถูกปฏิเสธ และผู้ส่งได้ exception กลับมา ทางแก้ที่ทำกันบ่อย ๆ ก็แค่ย้ายปัญหาไปที่อื่น:

- **ขยาย limit** ด้วย tier ที่ใหญ่ขึ้นหรือ setting ของ broker แต่แล้ว message ใหญ่ทุกตัวก็จะกิน memory และ disk บน broker และบนทุก replica ของมัน และถูกคัดลอกอีกรอบสำหรับทุก subscription ที่รับมัน Microsoft บอกว่า message ใหญ่บน Service Bus Premium ทำให้ throughput ลดลงและ latency เพิ่มขึ้น และหลาย service ก็คิดเงินตามขนาด: Amazon SQS และ Amazon SNS คิดเงินแต่ละ chunk ขนาด 64 KB เป็น request แยกกัน ทำให้ message ขนาด 1 MiB หนึ่งตัวคิดเป็น 16 request
- **แบ่ง payload** เป็น message ขนาด 256 KB สักร้อยตัว แต่ byte เท่าเดิมก็ยังผ่าน broker อยู่ดี แล้วตอนนี้ consumer ยังต้องเก็บ เรียง และประกอบชิ้นส่วนกลับ แถมต้องตัดสินใจว่าจะทำยังไงถ้าชิ้นที่ 63 ไม่มาถึงเลย
- **ส่งให้น้อยลง** ด้วยการบีบอัดหรือย่อรูป ยังไงก็ควรทำ แต่มันแค่ซื้อเวลา และ damage assessment อาจต้องใช้รูปความละเอียดเต็ม

ยังมีปัญหาที่เงียบกว่านั้นอีก claim มีข้อมูลส่วนบุคคลและรูปถ่าย และอะไรก็ตามที่อ่าน topic ได้ก็อ่านพวกนี้ได้: subscription และ dead-letter queue ของมัน, เครื่องมือ monitoring และ log ที่ message ที่ล้มเหลวไปตกอยู่

## ทำงานยังไง

ลองนึกถึงป้ายกระเป๋าที่สนามบิน: คุณฝากกระเป๋าใบหนักไว้ เดินทางไปพร้อมป้ายเล็ก ๆ แล้วใช้ป้ายนั้นรับกระเป๋าคืนที่ปลายทาง producer เอา payload ไปไว้ใน store ที่สร้างมาสำหรับ object ใหญ่ ๆ เช่น Amazon S3, Azure Blob Storage หรือ Google Cloud Storage แล้วส่ง **claim check** ผ่าน broker แทน: เป็น message เล็ก ๆ ที่บอกว่า payload อยู่ที่ไหน บวกกับ field ไม่กี่ตัวที่ consumer ต้องใช้ route message และตัดสินใจว่าจะทำอะไรกับมัน

1. **message ใหญ่เกินไป** Intake publish claim ขนาด 25 MB เป็น message เดียว แล้ว topic ก็ปฏิเสธมันเพราะเกิน limit 256 KB
2. **เก็บ payload ก่อน แล้วค่อยส่ง check** Intake upload payload ภายใต้ key ที่สร้างจาก claim ID คือ `claims/7f3a.zip` แล้วรอจน upload สำเร็จ หลังจากนั้นถึงจะ publish claim check ขนาดราว 1 KB:

   ```json
   { "claimId": "7f3a", "type": "auto",
     "payload": { "ref": "claims/7f3a.zip", "size": "25 MB", "sha256": "9c41…e07b" } }
   ```

3. **เอา claim check ไปรับของ** broker route โดยดูแค่ metadata: subscription ของ damage assessment มี filter `type = auto` และไม่ต้องดาวน์โหลดอะไรเลยเพื่อใช้ filter นี้ จากนั้น consumer แต่ละตัวอ่าน message ฉบับของตัวเอง ดึง payload ตรงจาก storage ด้วยสิทธิ์ read-only ของตัวเอง เช็ก SHA-256 แล้วประมวลผล claim ส่วน archive ก็เอา claim check ใบเดียวกันไปรับของเองแยกต่างหากตามจังหวะของตัวเอง และถ้ามัน scale out เป็น [competing consumers](../competing-consumers/) แต่ละ instance ก็ดึงเฉพาะ payload ของ message ที่ตัวเองหยิบไป
4. **Lifecycle และความปลอดภัย** ต้องมีใครสักคนลบ payload: จะเป็น consumer ตัวสุดท้ายที่ทำเสร็จ หรือ lifecycle rule ใน store ที่ลบมันเมื่อถึงอายุที่กำหนด (ในที่นี้ 30 วัน) โดยอายุนี้ต้องนานกว่าอายุของ claim check ทุกใบ ถ้า publish ล้มเหลวหลัง upload ไปแล้ว ก็จะเหลือ *orphan* ที่มีแค่ rule ตามอายุเท่านั้นที่ลบได้ ส่วน claim check ที่อยู่นานกว่า payload ของมันจะได้ not-found และควรไปอยู่ใน [dead-letter queue](../dead-letter-queue/) ตอนนี้ payload ไม่ได้เดินทางอยู่ใน broker แล้ว store เลยต้องมี access control และ encryption ของตัวเอง

แต่ละระบบได้ทำสิ่งที่ตัวเองถนัด broker ส่ง message เล็ก ๆ ได้อย่างเชื่อถือได้และ route มันได้ ส่วน store เก็บ object ใหญ่ ๆ ได้ถูกและให้คนอ่านหลายคนอ่านพร้อมกันได้

### ขนาด message สูงสุด แยกตาม broker

ตรวจกับเอกสารของแต่ละ vendor เมื่อวันที่ 5 ตุลาคม 2026 ตัวเลขพวกนี้เปลี่ยนได้ เลยควรเช็กอีกรอบก่อนออกแบบโดยยึดตัวเลขไหน

| Broker | Message ใหญ่สุด | หมายเหตุ |
|---|---|---|
| Azure Service Bus, Basic และ Standard tier | 256 KB | นับรวม system property และ user property ด้วย ไม่ใช่แค่ body นี่คือ limit ใน diagram |
| Azure Service Bus, Premium tier | 1 MB โดย default สูงสุด 100 MB | ได้ถึง 100 MB ต่อ queue หรือ topic เฉพาะผ่าน AMQP และไม่ใช้ batching (HTTP ยังอยู่ที่ 1 MB) Microsoft ยังแนะนำให้ message มีขนาดเล็ก ส่วน message ที่เกิน 1 MB ถูกนับสองครั้งใน size quota ของ queue และนับ X + 1 ครั้งบน topic ที่มี X subscription match กับมัน |
| Amazon SQS | 1 MiB | เพิ่มขึ้นจาก 256 KiB เมื่อสิงหาคม 2025 แต่ละ chunk ขนาด 64 KB คิดเงินเป็นหนึ่ง request |
| Amazon SNS | 256 KiB โดย default สูงสุด 1 MiB | ตั้งแต่กันยายน 2026 topic attribute `MaximumMessageSize` ตั้งได้ถึง 1 MiB บน topic ที่มี subscription ไม่เกิน 100 ตัว และทุกตัวต้องเป็น Amazon SQS, AWS Lambda หรือ Amazon Data Firehose แต่ละ chunk ขนาด 64 KB คิดเงินหนึ่งครั้งตอน publish และอีกหนึ่งครั้งต่อการส่งแต่ละครั้ง |
| Azure Event Hubs | 256 KB (Basic), 1 MB (Standard และ Premium), 20 MB (Dedicated) | Basic และ Standard คิดเงินขาเข้าเป็น event ละ 64 KB |
| Google Cloud Pub/Sub | message data 10 MB | ได้ไม่เกิน 100 attribute ต่อ message โดย key ยาวได้ถึง 256 byte และ value ได้ถึง 1,024 byte: พอสำหรับ metadata ที่ใช้ route ไม่ใช่สำหรับ payload |
| Apache Kafka | 1,048,588 byte โดย default | `message.max.bytes` ของ broker หรือ `max.message.bytes` ต่อ topic จำกัดขนาดของ record batch หลังบีบอัด ฝั่ง producer ก็มี `max.request.size` ของตัวเอง (default 1,048,576 byte) ที่ต้องขยายด้วย |

AWS มี claim check มาให้เป็น library ตัว **Amazon SQS Extended Client Library** (Java ที่มีทั้ง client แบบ synchronous และ asynchronous และ Python) และ **Amazon SNS Extended Client Library** เก็บ payload ขนาดได้ถึง 2 GB ไว้ใน Amazon S3 แล้วส่ง reference ไปแทน ส่วนฝั่ง consumer ก็แปลง reference กลับให้เองโดยไม่ต้องทำอะไร ตัว library SQS ของ Java ยัง offload ทุกอย่างที่เกิน 262,144 byte (256 KiB) โดย default ตาม limit เดิมของ SQS ที่ใช้จนถึงสิงหาคม 2025 แต่ threshold นี้ปรับได้

### แบบอัตโนมัติ: storage event คือ claim check

แทนที่จะ publish claim check เอง คุณให้ store เป็นคนประกาศว่ามี object ใหม่ก็ได้ ทั้ง **Amazon S3 event notification** (ไปที่ Amazon SQS, Amazon SNS, AWS Lambda หรือ Amazon EventBridge) และ event `Microsoft.Storage.BlobCreated` ของ **Azure Event Grid** มีตำแหน่งและขนาดของ object อยู่แล้ว ตัว event เองเลยเป็น claim check ได้เลย ตัวอย่าง claim check สามในสี่ตัวของ Azure Architecture Center ก็ใช้ blob URL ใน notification ของ Event Grid แบบนี้ มันคือ [event-driven architecture](../event-driven-architecture/) ที่มี store เป็น producer และมันแก้ปัญหาเรื่องลำดับไปด้วย เพราะ event จะมีก็ต่อเมื่อ object มีแล้วเท่านั้น ต้นทุนคือ:

- event มี metadata ของ store ไม่ใช่ของคุณ อะไรก็ตามที่ consumer ใช้ route (ในที่นี้คือประเภท claim) ต้องมาจาก object key, object metadata หรือ tag หรือไม่ก็ต้อง lookup เอา
- การส่งเป็นแบบ at least once และไม่ได้ทันที: S3 notification ปกติมาถึงภายในไม่กี่วินาที แต่อาจใช้เวลาเป็นนาทีหรือนานกว่านั้น และ consumer ของ Event Grid ต้องรับมือกับ event ที่มาช้า ซ้ำ และผิดลำดับได้ ตัว consumer เลยต้อง [idempotent](../idempotent-consumer/)
- กรองเอาเฉพาะ object ที่สมบูรณ์ ตัว `BlobCreated` เกิดขึ้นทั้งกับ `PutBlob`, `PutBlockList` และ `CopyBlob` และบน Data Lake Storage มันเกิดกับ `CreateFile` ด้วย ที่นั่นเลยต้องกรองเอา `FlushWithClose` ส่วน S3 notification ส่งตรงไปที่ SQS FIFO queue ไม่ได้ (ให้ route ผ่าน EventBridge)

### ชื่อนี้มาจากไหน

Claim Check เป็นหนึ่งใน message transformation pattern ในหนังสือ *Enterprise Integration Patterns* (2003) ของ Gregor Hohpe กับ Bobby Woolf อยู่คู่กับ **Content Enricher** ที่เติมข้อมูลที่ message ยังขาด และ **Content Filter** ที่ตัดข้อมูลที่ผู้รับไม่ต้องใช้ออก ในแบบของพวกเขา ขั้น "check luggage" จะเก็บ message บางส่วนไว้ภายใต้ key ที่ไม่ซ้ำกัน แล้วแทนที่ส่วนนั้นด้วย key พอไปถึงขั้นถัด ๆ ไป ตัว Content Enricher ก็ใช้ key ใส่ข้อมูลกลับเข้าไป เหตุผลของพวกเขากว้างกว่าเรื่อง size limit: ข้อมูลที่ขั้นระหว่างทางไม่ต้องใช้ทำให้ทุกขั้นช้าลง และทำให้ debug message ยากขึ้น มันเลยรอใน store ได้จนกว่าจะถึงขั้นที่ต้องใช้

## ใช้ตอนไหนดี

- **Payload ที่เกิน limit ของ broker** ไม่ว่าตอนนี้หรือเมื่อมันโตขึ้น: เอกสาร, รูปภาพ, เสียง, export, input ของ model หรือ batch ของ record
- **Payload ที่ใส่ได้แต่สร้างปัญหา**: ใหญ่พอจะทำให้ broker ที่ใช้ร่วมกันช้าลง ถูกคิดเงินตามขนาด หรือถูกคัดลอกไปให้ subscriber จำนวนมาก
- **ข้อมูล sensitive ที่ไม่ควรอยู่ใน broker** รวมถึง dead-letter queue, เครื่องมือ และ log ของมัน ให้เก็บไว้ใน store ที่มี access control ของตัวเองแล้วส่งแค่ reference
- **Route ด้วย metadata อย่างเดียว** router, filter และตัวกลางอ่าน message ขนาด 1 KB แล้วเลือกปลายทางได้โดยไม่ต้องแตะ payload เลย
- **ข้อมูลใหญ่ที่ส่งต่อระหว่างขั้นของการประมวลผล** ใน pipeline แบบ [pipes-and-filters](../pipes-and-filters/) แต่ละขั้นเขียน output เป็น object ใหม่แล้วส่ง reference ต่อได้: queue ระหว่างขั้นก็ยังเบา และขั้นที่ล้มเหลวก็ retry จาก object ขาเข้าของมันได้

**ตอนไหนไม่ควรใช้:**

- **message เล็ก ๆ** สำหรับ event ขนาด 2 KB pattern นี้เพิ่ม round trip ไปที่ storage กับระบบที่สองที่ต้องรัน โดยไม่ได้อะไรเลย
- **เส้นทางที่ latency สำคัญมาก** ที่การให้ consumer ทุกตัวต้อง fetch เพิ่มอีกรอบก่อนเริ่มงานได้ช้าเกินไป
- **tier ที่รับไหวอยู่แล้ว** ถ้า broker tier ที่รับขนาดของคุณได้นั้นเร็วและถูกพอ (เช่น Service Bus Premium ที่รองรับ message ใหญ่) การส่ง payload ไปใน message เลยจะง่ายกว่า อย่างที่แนวทางของ Microsoft ชี้ไว้
- **ไม่มี store ที่ใช้ร่วมกัน** ถ้า producer กับ consumer เข้าถึง store เดียวกันไม่ได้ทั้งคู่ ก็ไม่มีที่ให้เอา claim check ไปรับของ

## ได้อะไร เสียอะไร

- **มีสองระบบที่ต้องทำให้ตรงกัน** การ upload กับการ publish เป็นสอง operation แยกกัน ไม่ใช่ transaction เดียว: publish ล้มเหลวก็เหลือ orphan และ payload ที่ถูกลบเร็วเกินไปก็ทิ้ง claim check ที่เอาไปรับของไม่ได้
- **มี hop และ dependency เพิ่มอีกหนึ่ง** consumer ทุกตัวต้องส่ง request ไปที่ storage ก่อนเริ่มงาน ถ้า store ล่มหรือโดน throttle ตัว consumer ก็จะค้างทั้งที่ broker ยังปกติดี
- **Lifecycle กลายเป็นงานของคุณ** broker ลบ message เมื่อมันถูก consume หรือหมดอายุ แต่ไม่มีใครลบ payload ให้ถ้าคุณไม่จัดการเอง
- **Security ถูกแยกเป็นสองส่วน** access control, encryption และ network rule ของ broker ไม่ได้ครอบ payload อีกต่อไป
- **ตรวจดู message ได้ยากขึ้น** message ใน queue หรือใน dead-letter queue ไม่ได้แสดงเนื้อหาอีกแล้ว เครื่องมือและคนต้องตาม reference ไปดูเอง
- **ต้นทุนย้ายที่** คุณจ่ายค่า storage, storage request และ data transfer แทนค่า capacity ของ broker สำหรับ payload เล็ก ๆ ต้นทุนแบบนี้แพงกว่า แต่สำหรับตัวใหญ่ปกติจะถูกกว่ามาก

## ข้อควรรู้ตอนลงมือทำ

### ลำดับและการ retry

- **เก็บก่อน แล้วค่อย publish** publish claim check หลังจาก upload ตอบกลับว่าสำเร็จแล้วเท่านั้น consumer จะได้ไม่เคยได้ reference ไปที่ object ที่ยังไม่มีอยู่ แนวทางของ Azure ก็พูดเรื่องเดียวกันนี้
- **ใช้ key ที่ deterministic** สร้าง object key จากตัวตนทางธุรกิจ (`claims/7f3a.zip`) แทน UUID ใหม่ทุกครั้งที่ลอง เพื่อให้ upload ที่ retry เขียนทับ object เดิม แทนที่จะทิ้งสำเนาที่สองไว้ ตัว extended client ของ Java สำหรับ SQS และ SNS ตั้งชื่อ payload แต่ละตัวด้วย UUID แบบสุ่มโดย default ทำให้การส่งที่ retry ตรงนั้นทิ้ง orphan ไว้ให้ lifecycle rule มาเก็บกวาด
- **ทำให้ consumer idempotent** broker ส่งแบบ at least once ทำให้ claim check ใบเดียวกันมาถึงสองครั้งได้ ดาวน์โหลดสองครั้งไม่เป็นไร แต่ประเมิน claim สองครั้งอาจเป็นปัญหา ([idempotent consumer](../idempotent-consumer/))
- **Publish ให้เชื่อถือได้** ถ้า intake บันทึก claim ลง database ด้วย ให้ upload payload ก่อน แล้วบันทึก claim กับ claim check ใน transaction เดียวด้วย [transactional outbox](../transactional-outbox/) แล้วให้ relay เป็นคน publish ส่วนถ้า transaction ล้มเหลว ก็จะทิ้งไว้แค่ orphan ไม่มีวันทิ้ง check ที่ไม่มี payload
- **ถือว่า payload ที่หายไปคือความล้มเหลวถาวร** not-found ไม่หายเองตอน retry เลยให้ dead-letter message พร้อมเหตุผล ตัว SQS extended client ของ Java เลือกลบ message แบบนี้ทิ้งแทนได้ (`ignorePayloadNotFound` ปิดไว้โดย default) แต่แบบนั้นก็คือซ่อนปัญหา

### การลบ payload

ตัดสินใจก่อนจะเก็บ payload ตัวแรกว่าใครเป็นเจ้าของการลบ และลบเมื่อไหร่ ทางเลือกมีดังนี้:

- **Consumer เป็นคนลบ** ใช้ได้ถ้ามี consumer แค่ตัวเดียว ตัว SQS extended client ของ Java ทำแบบนี้โดย default คือลบ S3 object ตอนที่ message ถูกลบ และ large-message utility ใน Powertools for AWS Lambda (Java) ก็ลบหลังประมวลผลสำเร็จ แต่กับ [publish-subscribe](../publish-subscribe/) นี่คือ bug: subscriber ตัวแรกที่ทำเสร็จจะลบ payload ที่ตัวอื่นยังต้องใช้ เลยต้องปิดการเก็บกวาดนี้สำหรับ topic ที่ fan out
- **Reference counting** บันทึกว่ามี consumer กี่ตัวที่ต้องทำให้เสร็จ แล้วลบเมื่อตัวสุดท้ายรายงานว่าเสร็จ วิธีนี้ต้องมีชุด consumer ที่ตายตัวและรู้แน่ชัด และต้องมีที่เก็บตัวนับ ใน publish-subscribe ตัว producer ตั้งใจไม่รู้จัก subscriber ของตัวเอง ตัวนับเลยผิดได้ง่ายตอนมี subscriber เพิ่มเข้ามา
- **หมดอายุตามอายุ** lifecycle rule ลบ payload หลังจากเขียนไปแล้วตามเวลาที่กำหนด: S3 Lifecycle expiration, Azure Blob Storage lifecycle management หรือ Cloud Storage Object Lifecycle Management ตั้งอายุให้นานกว่าอายุของ claim check ทุกใบ: time-to-live หรือ retention period ของ message (Amazon SQS เก็บ message 4 วันโดย default และสูงสุด 14 วัน) บวกเวลาที่ใช้ไปกับ retry และใน dead-letter queue ที่คุณอาจอยาก redrive ส่วนบน Service Bus Standard และ Premium tier ตัว time-to-live แบบ default ของ message แทบจะไม่มีขีดจำกัด เลยต้องตั้งค่าไว้ที่ entity

หลายระบบใช้หลายวิธีรวมกัน: consumer หรือตัวนับลบทันที ส่วน rule ตามอายุคอยเก็บ orphan และกรณีที่ล้มเหลว lifecycle rule ไม่ใช่ timer ที่แม่นยำ ตัว S3 ลบ object ที่หมดอายุแบบ asynchronous และอาจลบหลังจากที่มันหมดอายุไปสักพัก (แต่หยุดคิดเงินตั้งแต่ตอนหมดอายุ) และ lifecycle policy ของ Azure ที่ตั้งใหม่หรือแก้ไขอาจใช้เวลาถึง 24 ชั่วโมงกว่าจะมีผล เลยให้ถือว่าอายุที่ตั้งไว้คือค่าต่ำสุด เก็บ payload ไว้ใต้ prefix หรือ bucket ของมันเอง เพื่อไม่ให้ rule ไปแตะอย่างอื่น

### Security

- **ปกป้อง store ในฐานะระบบหนึ่งของมันเอง** ตอนอยู่ใน message ตัว payload ถูกครอบด้วย access control, encryption และ network rule ของ broker แต่พออยู่ใน store ก็ไม่ได้ครอบแล้ว encryption at rest เปิดไว้โดย default ใน object store หลัก ๆ (Amazon S3 เข้ารหัส object ใหม่ทุกตัวมาตั้งแต่มกราคม 2023 และ encryption ของ Azure Storage ปิดไม่ได้) งานที่เหลือเลยเป็นการใช้ customer-managed key ถ้า broker เคยใช้, การบังคับ TLS และการจำกัด network access
- **Least privilege สำหรับแต่ละฝ่าย** producer ได้สิทธิ์เขียนแค่ prefix ของตัวเอง และ consumer แต่ละตัวได้สิทธิ์อ่าน ภายใต้ identity ของตัวเอง เช่น managed identity หรือ IAM role
- **ไม่ใส่ credential ใน claim check** แนวทางของ Azure คือให้ authorization อยู่ระหว่าง consumer แต่ละตัวกับ store ถ้าใส่ signed URL ไว้ใน message ใครก็ตามที่อ่าน topic, dead-letter queue หรือ log ได้ก็ใช้มันได้ จนกว่ามันจะหมดอายุ ถ้า consumer ที่อยู่นอก trust boundary ของคุณต้องใช้ payload ให้มันขอ URL แบบ read-only อายุสั้นตอนที่ต้องใช้: คือ [valet key](../valet-key/)
- **ไม่ใส่ secret ใน metadata** broker, router และเครื่องมือ monitoring เห็น message property ได้ เลยให้ส่งแค่ identifier และ category ไม่ใช่ชื่อ เลขบัตร หรือ token

### Integrity

- **ใส่ checksum ไว้ใน claim check** (ในที่นี้คือ SHA-256) แล้ว verify หลังดาวน์โหลด และตัดสินใจไว้ว่าถ้าไม่ตรงจะทำยังไง: ดึงใหม่ หรือ dead-letter message ไว้ตรวจสอบ
- **ให้ store เช็ก upload ด้วย** Amazon S3 verify checksum ที่ส่งมาพร้อม upload (รองรับ CRC-64/NVME ที่เป็น default ของมัน รวมถึง SHA-256, CRC-32C และอื่น ๆ) และ Azure Blob Storage เช็ก header `Content-MD5` หรือ `x-ms-content-crc64` บน Put Blob
- **ใช้ content hash เป็น key ได้** (`claims/9c41…e07b.zip`) ตัว retry และตัวซ้ำจะลงที่ object เดียวกัน และ key ก็พิสูจน์ได้ว่ามันชี้ไปที่อะไร แลกกับการที่ต้องคำนวณ hash ก่อน upload และถ้า claim สองรายการมีไฟล์เหมือนกันเป๊ะ object หนึ่งตัวก็จะมีเจ้าของสองคนที่ต้องคิดถึงก่อนจะลบมัน

### Latency และต้นทุน

- **consumer ทุกตัวต้องเสีย storage round trip หนึ่งรอบ** ต่อ message ก่อนเริ่มงานได้ บวกกับการ transfer เอง ส่วน router และ filter ที่อ่านแค่ metadata ไม่ต้องเสียอะไร
- **Offload แบบมีเงื่อนไขถ้า payload ส่วนใหญ่เล็ก** ส่งตัวเล็กไปใน message เลย แล้วส่งเฉพาะตัวใหญ่ผ่าน storage อย่างที่ SQS extended client ทำโดย default (`alwaysThroughS3` บังคับให้ทุก payload ผ่าน S3) แบบนี้ message ต้องบอกให้ชัดว่ามันมี payload อยู่ข้างในหรือมีแค่ reference
- **ระวังเรื่อง data transfer** consumer ที่อยู่ region อื่นหรืออยู่นอก cloud จะเสียค่า transfer ทุกครั้งที่ fetch ให้วาง store ไว้ใกล้คนที่อ่านมัน

### Library

- **AWS:** Amazon SQS และ Amazon SNS Extended Client Library, Payload Offloading Java Common Library for AWS ที่ client ของ Java สร้างอยู่บนนั้น และ large-message utility ใน Powertools for AWS Lambda (Java)
- **.NET:** ฟีเจอร์ claim check ของ NServiceBus (package `NServiceBus.ClaimCheck` ที่รู้จักกันมานานในชื่อ DataBus)
- **Azure:** ตัวอย่างของ Azure Architecture Center ครอบคลุม Event Grid กับ Queue Storage, Event Hubs และ Service Bus บวกกับ custom claim check ที่ส่งไปที่ Event Hubs ผ่าน Kafka endpoint ของมัน
