## ปัญหา

หน้า checkout ของ Acme Shop เรียก Orders API แล้วงานเบื้องหลังของแต่ละ order (ตัดบัตร จองสต็อก ส่งอีเมลยืนยัน) ก็ใช้เวลานานเกินกว่าที่คนซื้อควรต้องรอ แถมยังมาเป็นระลอก ถ้า API เรียก worker ตรง ๆ ทุกช่วงที่ยอดขายพุ่งและทุกครั้งที่ deploy worker จะกลายเป็น timeout ที่หน้า checkout และ order ที่ค้างอยู่ใน memory ของ worker ตอนที่ worker crash ก็จะหายไป

queue ที่คั่นระหว่างสองฝั่งแก้เรื่องนี้ได้: API บันทึก order แล้วตอบกลับทันที ส่วน worker ก็หยิบ order ไปทำตามจังหวะของตัวเอง แต่ถ้าจะรัน message broker สำหรับ queue นี้เอง ก็ต้องดูแล server, disk, replication, การ upgrade และวางแผน capacity เอง Amazon SQS (Simple Queue Service) คือ queue แบบ managed ของ AWS เราแค่สร้าง queue แล้วส่งและรับผ่าน HTTPS API ส่วน AWS รัน server ให้ เก็บทุก message ไว้หลายชุด และ scale standard queue ตามโหลด แล้วเราก็จ่ายเงินตามจำนวน request

## ทำงานยังไง

### Producer, queue และ consumer ที่คอย poll

- producer เรียก `SendMessage` หรือ `SendMessageBatch` สำหรับส่งได้ถึง 10 message และ 1 MiB ในครั้งเดียว ตัว standard queue จะเขียน message ลง server ในหลาย Availability Zone ก่อนตอบรับ call นั้น ทำให้ API ของ Acme ตอบ **202 Accepted** ได้ทันทีที่ call กลับมา
- queue เก็บ message ได้ไม่จำกัดจำนวน แต่ละตัวถูกเก็บไว้ตาม `MessageRetentionPeriod` ของ queue ค่าตั้งต้นคือ 4 วัน ตั้งได้ตั้งแต่ 1 นาทีถึง 14 วัน แล้วก็ถูกลบทิ้ง ไม่ว่าจะมีใครอ่านแล้วหรือยัง
- consumer เป็นฝ่ายของาน โดย `ReceiveMessage` คืนได้ถึง 10 message ต่อครั้ง แล้ว consumer ก็ process ทีละตัว และลบมันทิ้งด้วย `DeleteMessage` ตัว SQS ไม่เคยเรียกโค้ดของเรา: แม้แต่ Lambda integration ก็ยังเป็น poller ที่ AWS รันให้

### Visibility timeout และ receipt handle

- การรับ message ไม่ได้เอามันออกจาก queue แต่ SQS จะซ่อนมันจากตัวรับอื่นไว้ตลอด **visibility timeout**: ค่าตั้งต้น 30 s ตั้งได้ตั้งแต่ 0 s ถึง 12 ชั่วโมง ตั้งที่ queue (Acme ใช้ 60 s) หรือที่ `ReceiveMessage` แต่ละครั้งก็ได้ นี่คือเหตุผลที่ worker-2 ได้ m-18 ใน step 2 ระหว่างที่ worker-1 ถือ m-17 อยู่
- การรับแต่ละครั้งจะได้ **receipt handle** มาด้วย และ handle นี้เป็นของการรับครั้งนั้น ไม่ใช่ของ message ส่วน `DeleteMessage` และ `ChangeMessageVisibility` รับ handle ไม่ใช่ message ID ถ้ารับ message เดียวกันสองครั้งก็จะได้ handle ที่ต่างกันสองตัว แล้วถ้าลบด้วยตัวที่เก่ากว่า call จะสำเร็จ แต่ message อาจยังอยู่
- ถ้า message ไม่ถูกลบก่อน timeout หมด (worker crash, เจอ bug หรือแค่ช้า) มันจะกลับมามองเห็นได้อีก แล้วการรับครั้งถัดไปก็ได้มันไป โดยที่ `ApproximateReceiveCount` เพิ่มขึ้นหนึ่ง แบบนี้เองที่ m-18 รอดจากการ crash ของ worker-2 ใน step 3
- timeout ไม่ใช่ lock ตัว standard queue ไม่ได้สัญญาว่า message จะไม่ถูกส่งซ้ำสองครั้ง แม้แต่ในช่วง timeout และบางครั้ง (นาน ๆ ที) message ก็อาจถูกรับอีกได้หลังลบไปแล้ว ให้ทำทุก handler ให้ [idempotent](../idempotent-consumer/) เช่นบันทึก order ID ไว้ใน database transaction เดียวกับตัวงาน
- ถ้างานยาว ให้มี heartbeat ที่เรียก `ChangeMessageVisibility` ก่อน timeout หมด ค่าใหม่นับจากตอนที่เรียก และรวมกันแล้วเกิน 12 ชั่วโมงนับจากการรับครั้งแรกไม่ได้: การต่อเวลาไม่ได้รีเซ็ตนาฬิกาตัวนั้น ส่วนค่า 0 คือคืน message กลับทันที ตอน worker shut down ก็ควรทำแบบนี้กับ message ที่ยังทำไม่เสร็จ

```sh
aws sqs receive-message \
  --queue-url https://sqs.us-east-1.amazonaws.com/111122223333/orders \
  --wait-time-seconds 20 --max-number-of-messages 10 \
  --message-system-attribute-names ApproximateReceiveCount
# process each message, then delete it with the handle from this receive
aws sqs delete-message \
  --queue-url https://sqs.us-east-1.amazonaws.com/111122223333/orders \
  --receipt-handle "AQEB…"
```

### Long polling และ batching

- ถ้าใช้ **short polling** (`WaitTimeSeconds` 0 คือค่าตั้งต้น) การรับแต่ละครั้งจะถามแค่ server บางส่วนของ SQS แล้วตอบทันที เลยอาจได้ผลว่างกลับมา ทั้งที่มี message รออยู่ใน server ตัวอื่น
- ถ้าใช้ **long polling** (`WaitTimeSeconds` 1 ถึง 20 ตั้งที่ call หรือตั้งเป็น `ReceiveMessageWaitTimeSeconds` ของ queue) มันจะถามทุก server และกลับมาทันทีที่มี message หรือกลับมาว่าง ๆ เมื่อหมดเวลารอ ส่วนใน step 2 call ของ worker-3 รออยู่บน queue ที่ว่าง แล้วคืน m-19 ทันทีที่มันมาถึง ผลว่างที่น้อยลงก็แปลว่า request ที่โดนคิดเงินน้อยลงด้วย
- `SendMessageBatch`, `DeleteMessageBatch` และ `ChangeMessageVisibilityBatch` รับได้ถึง 10 entry และ batch หนึ่งคิดเงินเป็นหนึ่ง request (ดูกฎเรื่อง payload ในหัวข้อ Pricing) แต่ละ entry สำเร็จหรือพังแยกกัน เพราะฉะนั้นให้เช็ก list `Failed` ด้วย แม้ call จะคืน HTTP 200

### Delay queue และ message timer

`DelaySeconds` ของ queue (0 ถึง 15 นาที) ซ่อน message ใหม่ทุกตัวไว้นานเท่านั้นก่อนส่งครั้งแรก ส่วน message timer ทำแบบเดียวกันกับ message ตัวเดียวและมีผลเหนือ delay ของ queue โดยที่ FIFO queue รองรับแค่ delay ระดับทั้ง queue ส่วน delay จะซ่อน message ก่อนที่จะมีใครรับ แต่ visibility timeout ซ่อนหลังการรับ ถ้าต้องรอนานกว่า 15 นาที AWS แนะนำให้ใช้ [EventBridge](../amazon-eventbridge/) Scheduler

### Dead-letter queue และ redrive

- **redrive policy** ของ queue ระบุ dead-letter queue (`deadLetterTargetArn`) และ `maxReceiveCount` (1 ถึง 1,000 ถ้าไม่ใส่จะเป็น 10) เมื่อ receive count ของ message เกินค่านี้ SQS จะย้าย message ไปที่ dead-letter queue แทนการส่งซ้ำ ใน step 3 ตัว m-20 ก็ไปที่ orders-dlq หลังรับแล้วพังเป็นครั้งที่ห้า
- dead-letter queue คือ queue ธรรมดาประเภทเดียวกัน (FIFO สำหรับ FIFO queue) ใน account และ Region เดียวกัน ส่วน redrive allow policy ของมันจำกัดได้ว่า source queue ไหนใช้มันได้บ้าง
- บน standard queue ที่ตั้ง `maxReceiveCount` ไว้เกิน 3 ถ้า message ถูกรับไปแล้วสามครั้งขึ้นไปโดยไม่ถูกลบ มันจะถูกย้ายไปท้าย queue ด้วย
- ระวังเรื่อง retention ด้วย บน standard queue พอ message ถูกย้าย มันยังใช้เวลาเข้า queue เดิมอยู่ ถ้าทั้งสอง queue ตั้ง retention ไว้ 4 วันเท่ากัน message ที่ใช้เวลาพังอยู่ใน orders ไปแล้ว 3 วัน จะเหลือเวลาอีกแค่ 1 วันใน dead-letter queue ให้ตั้ง retention ของ dead-letter queue ให้นานกว่า source อย่าง orders-dlq ก็เก็บ message ไว้นานสุดที่ทำได้คือ 14 วัน ส่วนใน FIFO queue นาฬิกาจะเริ่มนับใหม่ตอนย้าย
- ตั้ง alarm ไว้: CloudWatch alarm บน `ApproximateNumberOfMessagesVisible` ของ dead-letter queue จะบอกคนว่ามี message ที่ต้องเข้าไปดู แบบใน step 3
- หลังแก้เสร็จ ให้ **redrive** ผ่าน console หรือด้วย `StartMessageMoveTask` ถ้าไม่ระบุปลายทาง มันจะส่งแต่ละ message กลับไปที่ queue ที่มันมา และ `--max-number-of-messages-per-second` ใช้คุม rate (สูงสุด 500 ถ้าไม่ใส่ค่านี้ SQS จะเลือกให้เอง) แต่ละ queue รัน move task ได้ทีละตัว message ที่ถูก redrive คือ message ใหม่ ที่มี message ID ใหม่ และเวลาเข้า queue ก็เป็นเวลาใหม่ ทำให้ retention ของมันเริ่มนับใหม่ ส่วน dead-letter queue แบบ FIFO ก็ redrive ได้ แล้ว message ของมันก็จะปนกับอะไรก็ตามที่ producer ส่งเข้ามาตอนเดียวกัน ถ้าทุก operation ต้องเรียงลำดับตลอด AWS แนะนำว่าไม่ควรมี dead-letter queue บน FIFO queue นั้นเลย เพราะแค่ย้าย message ตัวเดียวออกไปพักก็ทำให้ลำดับพังแล้ว

```sh
aws sqs create-queue --queue-name orders --attributes file://orders.json
```

```json
{
  "VisibilityTimeout": "60",
  "ReceiveMessageWaitTimeSeconds": "20",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:111122223333:orders-dlq\",\"maxReceiveCount\":\"5\"}"
}
```

```sh
# after the fix: move the messages in orders-dlq back to orders, 50 per second
aws sqs start-message-move-task \
  --source-arn arn:aws:sqs:us-east-1:111122223333:orders-dlq \
  --max-number-of-messages-per-second 50
```

ตัว pattern เอง พร้อมขั้นตรวจดูที่อยู่ตรงกลาง อยู่ในหน้า [Dead-Letter Queue](../dead-letter-queue/)

### Standard หรือ FIFO

- queue แบบ **standard** รับ API call ได้แทบไม่จำกัดต่อวินาทีในแต่ละ action มันส่ง message แต่ละตัวอย่างน้อยหนึ่งครั้ง บางทีก็มากกว่านั้น และรักษาลำดับได้แค่แบบ best-effort
- queue แบบ **FIFO** (ชื่อลงท้ายด้วย `.fifo` และแปลง standard queue ที่มีอยู่ให้เป็น FIFO ไม่ได้) ต้องมี `MessageGroupId` ในทุก message ภายใน group เดียวกัน message จะถูกส่งออกไปตามลำดับเป๊ะ ๆ การรับครั้งเดียวอาจได้หลาย message ของ group เดียวกัน แต่ระหว่างที่ตัวไหนยัง in flight อยู่ จะไม่มี message ของ group นั้นถูกส่งออกไปเพิ่ม จนกว่าพวกนั้นจะถูกลบหรือ visibility timeout ของมันหมด ส่วน group ที่ต่างกันถูก process แบบขนาน Acme เลยให้ payments.fifo ใช้หนึ่ง group ต่อลูกค้าหนึ่งคน: payment ของ cust-41 ไม่มีวันแซงกันเอง และของ cust-77 ก็ไม่ต้องรอพวกมัน แต่ consumer ขอ group ที่เจาะจงไม่ได้
- FIFO queue ยังทิ้ง message ที่ซ้ำให้ด้วย message ที่ส่งซ้ำด้วย `MessageDeduplicationId` เดิมภายในช่วง deduplication 5 นาทีจะถูกรับไว้ แต่ไม่ถูกเพิ่มเข้า queue อีก ถ้าเปิด `ContentBasedDeduplication` ตัว ID จะเป็น SHA-256 hash ของ body ส่วน `ReceiveRequestAttemptId` ทำให้การ retry ฝั่งรับปลอดภัยในแบบเดียวกัน แต่ message ที่ visibility timeout หมดก็ยังถูกส่งซ้ำอยู่ดี consumer เลยต้องทำให้เสร็จหรือต่อเวลาให้ทัน
- throughput คือจุดที่ FIFO ทำให้เราเสีย: 300 transaction ต่อวินาทีต่อ API action หรือ 3,000 message ต่อวินาทีถ้าส่งเป็น batch ละ 10 แล้ว **high-throughput mode** (`DeduplicationScope` = `messageGroup`, `FifoThroughputLimit` = `perMessageGroupId`) ก็ดันขึ้นไปได้ถึง 70,000 transaction ต่อวินาทีต่อ action ใน US East (N. Virginia), US West (Oregon) และ Europe (Ireland) หรือ 700,000 message ต่อวินาทีถ้าใช้ batch ส่วน Region อื่นได้น้อยกว่านั้น ต่ำสุดที่ 2,400 เป็นค่าตั้งต้น ส่วน SQS กระจาย FIFO queue ไปหลาย partition ด้วยการ hash group ID ทำให้ throughput ระดับนี้ต้องมี group ที่ active อยู่เยอะ ๆ
- เรื่อง in flight: FIFO queue ถือ message ที่ถูกรับแล้วแต่ยังไม่ถูกลบได้ 120,000 ตัว (เพิ่มจาก 20,000 เมื่อพฤศจิกายน 2024) ส่วน standard queue ได้ประมาณ 120,000 ตัว ถ้า standard queue ชนเพดานนี้ก็จะตอบ short poll ด้วย error `OverLimit` ส่วน long poll จะแค่ไม่คืนอะไรกลับมา
- **Fair queue** (กรกฎาคม 2025) มีไว้แก้ปัญหาฝั่งตรงข้าม: standard queue ที่ tenant หลายรายใช้ร่วมกัน ให้ใส่ tenant ไว้ใน `MessageGroupId` บน standard queue แล้วถ้า tenant รายไหนถือ message ที่ in flight ไว้มากเกินสัดส่วน SQS จะส่ง message ของ tenant อื่นก่อน ทำให้รายอื่นรอไม่นาน แบบนี้ไม่มีการเรียงลำดับ และ request พวกนี้มีค่า fair-queue เพิ่ม

### ใช้ SQS กับ Lambda

- Lambda **event source mapping** จะ long-poll queue แล้วเรียก function แบบ synchronous พร้อม batch ของ message และลบพวกมันทิ้งเมื่อ function สำเร็จ ค่าตั้งต้นของ `BatchSize` คือ 10 สูงสุด 10,000 สำหรับ standard queue และ 10 สำหรับ FIFO queue ส่วน `MaximumBatchingWindowInSeconds` (0 ถึง 300 ใช้ได้แค่ standard queue) จะรอให้ batch เต็ม และต้องตั้งอย่างน้อย 1 เมื่อ batch size เกิน 10
- ถ้า function พัง ทั้ง batch จะกลับมามองเห็นได้อีกหลัง visibility timeout หมด แต่ถ้าใส่ `ReportBatchItemFailures` ไว้ใน `FunctionResponseTypes` แล้วคืน ID ของ message ที่พัง ก็จะมีแค่ตัวพวกนั้นที่กลับมา
- บน standard queue ตัว Lambda เริ่มที่ 5 concurrent invocation แล้วเพิ่มได้ถึง 300 ต่อนาที จนถึงสูงสุด 1,250 ต่อ mapping เป็นค่าตั้งต้น ส่วน `ScalingConfig` ที่มี `MaximumConcurrency` (2 ถึง 1,000) กันไม่ให้ queue เดียวกิน concurrency ของ function ไปหมด อีกทางคือ **provisioned mode** (พฤศจิกายน 2025) ที่เตรียม poller ไว้ตามจำนวนขั้นต่ำและสูงสุด (`ProvisionedPollerConfig`) และ scale ได้เร็วกว่า แต่มีค่าใช้จ่ายเพิ่ม และใช้ร่วมกับ maximum concurrency ไม่ได้ ส่วนบน FIFO queue จะมี invocation เดียวที่ทำงานกับ message group หนึ่งในแต่ละช่วงเวลา
- ตั้ง visibility timeout ของ queue ให้อย่างน้อยหกเท่าของ function timeout บวก batching window ตัว Lambda จะไม่ยอมสร้าง mapping ถ้า function timeout นานกว่า visibility timeout ของ queue

```sh
aws lambda create-event-source-mapping --function-name process-order \
  --event-source-arn arn:aws:sqs:us-east-1:111122223333:orders \
  --batch-size 10 --function-response-types ReportBatchItemFailures \
  --scaling-config MaximumConcurrency=50
```

```json
{ "batchItemFailures": [ { "itemIdentifier": "<messageId of a message that failed>" } ] }
```

### Scale worker ตาม backlog

SQS ส่ง `ApproximateNumberOfMessagesVisible` (ที่รออยู่), `ApproximateNumberOfMessagesNotVisible` (ที่ in flight) และ `ApproximateAgeOfOldestMessage` ไปที่ CloudWatch สำหรับแต่ละ queue ส่วน worker ให้ scale ตาม backlog ต่อ worker คือ message ที่มองเห็นได้หารด้วยจำนวน worker ที่รันอยู่ แล้วเทียบกับ backlog ที่ worker หนึ่งตัวเคลียร์ได้ภายในเวลาหน่วงที่เรารับได้ คู่มือ EC2 Auto Scaling แสดงวิธีนี้ด้วย metric math และอธิบายว่าทำไมความลึกของ queue ดิบ ๆ อย่างเดียวถึงเป็น target ที่ไม่ดี ให้ตั้ง alarm ที่อายุของ message ที่เก่าที่สุดด้วย: ถ้าอายุโตขึ้นเรื่อย ๆ แต่ความลึกน้อย แปลว่ามี message ที่พังซ้ำ ๆ ดู [Autoscaling](../autoscaling/)

### Message ขนาดใหญ่

message ใหญ่ได้ถึง 1 MiB (ตั้งแต่ 4 สิงหาคม 2025 ก่อนหน้านั้นเพดานคือ 256 KiB) และ `MaximumMessageSize` ของ queue ลดเพดานนี้ลงได้ ถ้าใหญ่กว่านั้น Amazon SQS Extended Client Library สำหรับ Java หรือ Python จะเอา payload ไปเก็บใน Amazon S3 แล้วส่ง message ที่ชี้ไปหามัน รองรับ payload ได้ถึง 2 GB และค่าเก็บใน S3 ก็คิดตามปกติ นี่คือ pattern [Claim Check](../claim-check/)

### Encryption และสิทธิ์เข้าถึง

- ตั้งแต่ปลายปี 2022 queue ใหม่จะถูกเข้ารหัสตอนเก็บด้วย key ที่ SQS จัดการให้ (SSE-SQS) เป็นค่าตั้งต้น ส่วน SSE-KMS ใช้ key ใน AWS KMS แทน แลกกับค่า KMS call แล้ว `KmsDataKeyReusePeriodSeconds` (1 นาทีถึง 24 ชั่วโมง ค่าตั้งต้น 5 นาที) ก็กำหนดว่า SQS จะกลับไปหา KMS บ่อยแค่ไหน request ที่ไปหา queue ที่เข้ารหัสต้องใช้ HTTPS และ Signature Version 4
- IAM policy ให้สิทธิ์ role ของเราเอง ส่วน access policy ของ queue (เป็น resource-based policy) เปิดให้ account อื่นและ AWS service ที่ส่งเข้ามา อย่าง [SNS](../amazon-sns/) topic หรือ S3 bucket ส่วน statement พวกนี้ควรจำกัดด้วย `aws:SourceArn` หรือ `aws:SourceAccount` ถ้าเรียกจากใน VPC ตัว interface VPC endpoint จะกัน traffic ไม่ให้ออก internet (ดู [Private Endpoints](../private-endpoints/))

### Pricing

เราจ่ายตามจำนวน request โดยที่ล้าน request แรกของแต่ละเดือนฟรี (นับรวมทุก Region) หลังจากนั้น price list ของ US East (N. Virginia) เดือนกันยายน 2026 คิด $0.40 ต่อล้าน request สำหรับ standard queue และ $0.50 ต่อล้านสำหรับ FIFO queue สำหรับ 100,000 ล้าน request แรกต่อเดือน และถูกลงเป็นขั้น ๆ หลังจากนั้น ส่วน request ที่ส่ง message group ID ไปที่ standard queue จะโดนค่า fair-queue เพิ่มอีก $0.10 ต่อล้าน

- ทุก API action นับหมด รวมถึงการรับที่ได้ผลว่างด้วย worker สามตัวที่ long-poll queue ที่ว่างอยู่ เรียกได้มากสุดตัวละ 3 ครั้งต่อนาที: ราว ๆ 390,000 request ในเดือนที่มี 30 วัน คิดเป็นประมาณ $0.16 หลังพ้น free tier
- batch ที่มีได้ถึง 10 message นับเป็นหนึ่ง request แต่ทุก ๆ 64 KB ของ payload คิดเป็น request แยกกัน message ขนาด 1 MiB เลยคิดเป็น 16 request
- data transfer ระหว่าง SQS กับ compute ของเราใน Region เดียวกันฟรี ส่วน SSE-KMS มีค่า KMS เพิ่ม

## อยู่ตรงไหนใน solution

- **Solution:** การ process order และ job หลัง API แบบในตัวอย่างนี้, work queue ให้ worker บน EC2, ECS หรือ EKS และให้ Lambda function, buffer หน้า dependency ที่ช้าหรือโดน rate limit (payment provider, database รุ่นเก่า, API ของ partner), รับ event notification จาก [S3](../amazon-s3/), หนึ่ง queue ต่อ subscriber หนึ่งตัวหลัง SNS topic หรือ EventBridge rule และแยก microservice ออกจากกัน ให้ตัวหนึ่งล่มได้โดยที่ตัวอื่นไม่พังตาม
- **Pattern ที่มัน implement หรือช่วยรองรับ:** [Queue-Based Load Leveling](../queue-based-load-leveling/) และ [Competing Consumers](../competing-consumers/) (step 1 และ 2), [Dead-Letter Queue](../dead-letter-queue/) (step 3), [Claim Check](../claim-check/) (ตัว extended client), [Asynchronous Request-Reply](../asynchronous-request-reply/) (ตัว 202) และ [Web-Queue-Worker](../web-queue-worker/) ส่วน [Publish-Subscribe](../publish-subscribe/) ได้มาจาก SNS หรือ EventBridge ที่อยู่หน้า queue แล้ว SQS ก็ไม่มี priority เลยต้องทำ [Priority Queue](../priority-queue/) เป็นหนึ่ง queue ต่อหนึ่ง priority ส่วน consumer ต้อง [idempotent](../idempotent-consumer/) และ producer ที่เขียนลง database ของตัวเองแล้วส่ง message ด้วยต้องใช้ [transactional outbox](../transactional-outbox/) เพราะ `SendMessage` ไม่ได้อยู่ใน database transaction
- **ของที่อยู่ข้าง ๆ บ่อย ๆ:** producer บน API Gateway, Lambda, ECS หรือ EC2, SNS และ EventBridge สำหรับ fan-out และ routing, [AWS Lambda](../aws-lambda/) หรือ worker ที่ auto-scale เป็น consumer, CloudWatch alarm บน backlog และบน dead-letter queue, KMS สำหรับ key และ S3 สำหรับ payload ขนาดใหญ่
- **Managed offering:** SQS ก็คือ managed service อยู่แล้ว ถ้าแอปคุยกับ message broker อยู่แล้ว Amazon MQ จะรัน ActiveMQ หรือ [RabbitMQ](../rabbitmq/) ให้ ส่วนถ้ามีหลาย consumer ที่ต้องอ่านและ replay stream ที่เรียงลำดับตัวเดียวกัน Kinesis Data Streams หรือ Amazon MSK ([Kafka](../kafka/)) จะเหมาะกว่า ส่วน cloud อื่นก็มี Azure Queue Storage กับ Service Bus และ Google Cloud Pub/Sub

## ใช้ตอนไหนดี

- งานที่รอได้เป็นวินาทีและห้ามหาย: order, อีเมล, การ process รูปและเอกสาร, การ import และ webhook ที่ต้องส่งออกไป
- producer และ consumer ที่ traffic มาเป็นระลอก และควร scale, พัง และ deploy แยกกันได้
- ทีมเล็กที่อยากได้ queue โดยไม่ต้องรัน broker: ไม่มีอะไรต้องกำหนดขนาด patch หรือ replicate
- ไม่เหมาะเมื่อทุก consumer ต้องเห็นทุก message (ใช้ SNS หรือ EventBridge โดยให้ consumer แต่ละตัวมี queue ของตัวเอง), เมื่อต้อง replay หรืออ่าน message ซ้ำทีหลัง (ใช้ stream), เมื่องานต้องการ latency แบบ request-response หรือเมื่อต้องเรียงลำดับเป๊ะ ๆ ข้ามทุก message ตอนปริมาณสูง (message group เดียวของ FIFO ถูก process ทีละ batch)

| | consumer ได้ message ยังไง | message แต่ละตัวไปที่ | เก็บไว้นานแค่ไหน | เลือกใช้เมื่อ |
|---|---|---|---|---|
| **SQS standard** | poll แล้วลบ | consumer ทีละตัว อย่างน้อยหนึ่งครั้ง ลำดับแบบ best-effort | จนกว่าจะถูกลบ 1 นาทีถึง 14 วัน | work queue, buffering, decoupling |
| **SQS FIFO** | poll แล้วลบ | consumer ทีละตัวต่อ group ตามลำดับ ทิ้งตัวซ้ำภายใน 5 นาที | จนกว่าจะถูกลบ 1 นาทีถึง 14 วัน | ลำดับต่อลูกค้า ต่อ account หรือต่ออุปกรณ์ |
| **Amazon SNS** | push ไปทุก subscription: SQS, Lambda, HTTP(S), email, SMS, mobile push, Data Firehose | ทุก subscriber ได้คนละ copy | ไม่มี backlog: retry การส่ง แล้วทิ้งหรือส่งไป dead-letter queue ส่วน FIFO topic archive และ replay ได้ | fan-out message ตัวเดียวไปหลายที่ |
| **Amazon EventBridge** | push ไปที่ target ที่ rule match กับ event (ได้ถึง 5 ตัวต่อ rule) | ทุก target ที่ match | ค่าตั้งต้น retry ได้นานถึง 24 ชั่วโมง (185 ครั้ง) ส่วน archive ใช้ replay ได้ | route event ระหว่าง service, account และแอป SaaS |
| **Kinesis Data Streams** | อ่านตามตำแหน่งจาก log ที่ใช้ร่วมกัน | ทุกแอปที่ consume ตามลำดับในแต่ละ shard | ค่าตั้งต้น 24 ชั่วโมง นานสุด 365 วัน | stream ที่หลายแอปอ่านหรือ replay |
| **Amazon MQ** | ผ่าน broker ActiveMQ Classic หรือ RabbitMQ ที่ AWS ดูแลให้ | ตามที่ queue และ topic ของ broker กำหนด | จนกว่าจะถูก consume | แอปที่คุยกับ broker แบบนี้อยู่แล้ว |

## ได้อะไร เสียอะไร

- **อย่างน้อยหนึ่งครั้ง และเรียงลำดับแบบคร่าว ๆ** standard queue อาจส่ง message ซ้ำสองครั้งและไม่เรียงลำดับ ส่วน FIFO queue แก้ได้ทั้งสองเรื่อง แลกกับเพดาน throughput และการ block กันภายใน group
- **Polling มีต้นทุน** consumer ต้องจ่ายทุกครั้งที่รับ รวมถึงครั้งที่ได้ผลว่าง และ message ต้องรอจนกว่าการรับครั้งถัดไปจะหยิบมันไป long polling ช่วยให้ทั้งสองเรื่องเล็กลง
- **ไม่มี replay** message ที่ถูกลบแล้วก็หายไปเลย ส่วนตัวที่ไม่มีใครลบก็หมดอายุภายใน 14 วันเป็นอย่างมาก consumer ตัวที่สองจะมาอ่าน message ชุดเดิมทีหลังไม่ได้ ให้วาง SNS หรือ EventBridge ไว้ข้างหน้า หรือไปใช้ stream
- **มี timeout ตัวเดียวให้จูน** ถ้าสั้นไป message ที่ทำช้าจะถูก process สองรอบ ถ้านานไป message ของ worker ที่ crash ก็ต้องรอนานเท่านั้น งานยาว ๆ เลยต้องมีโค้ด heartbeat
- **ข้อจำกัดที่ต้องออกแบบรอบ ๆ:** 1 MiB ต่อ message, visibility 12 ชั่วโมง, message ที่ in flight ได้ประมาณ 120,000 ตัวต่อ queue, delay 15 นาที และ retention 14 วัน
- **ใน queue มี feature น้อย** ไม่มี priority ไม่มี filtering หรือ routing ตาม content และ delay ได้ไม่เกิน 15 นาที ของพวกนี้ต้องได้จาก service อื่น (SNS subscription, EventBridge rule, EventBridge Scheduler)
- **ใช้ได้แค่บน AWS** API เป็นของ SQS เอง ถ้าจะย้ายออกจาก AWS ก็ต้องเขียนโค้ดฝั่ง client ใหม่ ไม่เหมือน broker ที่ใช้ protocol มาตรฐาน

## ข้อควรรู้ตอนลงมือทำ

- **เลือกค่า setting อย่างตั้งใจ:** `VisibilityTimeout` สูงกว่าเวลา process ปกติเล็กน้อย (หรือหกเท่าของ timeout ของ Lambda function), `ReceiveMessageWaitTimeSeconds` 20, redrive policy ในทุก queue ที่ `maxReceiveCount` สูงพอจะรอดช่วงที่ dependency ล่มสั้น ๆ และ retention ของ dead-letter queue ที่นานกว่าของ source
- **ตั้ง alarm ที่สามตัวเลข:** message ที่มองเห็นได้ในแต่ละ dead-letter queue, อายุของ message ที่เก่าที่สุดในแต่ละ work queue และ message ที่ in flight เทียบกับเพดาน 120,000
- **ทำการ process ให้ idempotent** และลบหลังงาน commit แล้วเท่านั้น ให้จับการทำซ้ำด้วย business key อย่าง order ID แทน message ID เพราะ redrive จะเปลี่ยน message ID ใหม่
- **Shut down อย่างนุ่มนวล:** พอได้ `SIGTERM` ให้หยุดรับ ทำงานที่ทำให้เสร็จได้ให้เสร็จ แล้วคืนที่เหลือด้วย `ChangeMessageVisibility` ที่ตั้งเป็น 0
- **ให้ producer ทำตัวดี:** ส่งหลัง database commit ผ่าน outbox, retry `SendMessage` เมื่อเจอ error และบน FIFO queue ให้ใช้ `MessageDeduplicationId` ตัวเดิมตอน retry การส่ง
- **ใช้ batch ตรงที่คุ้ม:** queue ที่ยุ่งให้ส่งและลบเป็น batch ละไม่เกิน 10 และคอยดู partial failure ในแต่ละ batch
- **นิยาม queue เป็นโค้ด** (CloudFormation, CDK หรือ Terraform) รวมถึง dead-letter queue, redrive policy, access policy และ alarm เพื่อให้ทุก environment ได้ตาข่ายนิรภัยแบบเดียวกัน
