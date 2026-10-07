## ปัญหา

ตอนที่คนซื้อสั่ง order ที่ Acme Shop หลายส่วนของธุรกิจต้องรู้เรื่องนี้: อีเมลยืนยันต้องถูกส่งออกไป, analytics warehouse ต้องบันทึกยอดขาย, fraud check ต้องให้คะแนน order, delivery partner รอ webhook อยู่ และ on-call engineer ก็อยากได้ SMS ตอนที่ order ใหญ่ผิดปกติ ถ้า Orders service เรียกแต่ละตัวเอง มันจะต้องรู้ address ทุกตัว รอคำตอบทุกตัว retry ตัวที่ล่มอยู่ และแก้โค้ดตัวเองทุกครั้งที่มี consumer เพิ่ม แล้ว consumer ที่ช้าแค่ตัวเดียวก็จะทำให้ checkout ช้าตามไปด้วย

[Publish-subscribe](../publish-subscribe/) ตัดการผูกกันแบบนี้ออก: Orders ประกาศ event แค่ครั้งเดียว แล้ว broker ก็ส่งสำเนาให้ทุกคนที่ subscribe ไว้ ตัว Amazon SNS (Simple Notification Service) คือ publish-subscribe service แบบ managed ของ AWS ตัว publisher ส่ง message ไปที่ **topic** แล้ว SNS ก็เก็บมันไว้ และ push สำเนาไปให้แต่ละ **subscription**: SQS queue, Lambda function, Data Firehose stream, HTTP(S) endpoint, อีเมล, เบอร์โทรศัพท์ผ่าน SMS และ mobile app ตรงนี้ไม่มี broker ให้ต้องรัน และเราจ่ายตามจำนวน request และจำนวนการส่ง

## ทำงานยังไง

### Topic, subscription และ protocol

- **topic** คือ channel ที่มีชื่อและอยู่ใน Region เดียว เช่น `order-events` มันเป็นได้ทั้งแบบ **standard** หรือ **FIFO** (ชื่อของ FIFO topic ลงท้ายด้วย `.fifo`) และทั้งแบบและชื่อของมันเปลี่ยนไม่ได้หลังสร้างแล้ว
- **subscription** ผูก topic เข้ากับ endpoint หนึ่งตัวผ่าน protocol หนึ่งตัว: `sqs`, `lambda`, `firehose`, `http`, `https`, `email`, `email-json`, `sms` หรือ `application` (mobile app endpoint สำหรับ push notification) แต่ละ subscription มี setting ของตัวเอง: filter policy, raw message delivery, dead-letter queue สำหรับของที่ส่งไม่ได้ และสำหรับ HTTP/S ก็มี retry policy ที่ override ของ topic
- HTTP(S) endpoint, อีเมล และ endpoint ที่อยู่ใน AWS account อื่น ต้อง **confirm** ก่อนถึงจะได้รับอะไร SNS ส่ง confirmation message ไปให้ โดย token ในนั้นใช้ได้สองวัน ส่วน HTTPS endpoint จะ confirm ด้วยการ request `SubscribeURL` ที่อยู่ใน message นั้น (หรือเรียก `ConfirmSubscription`) และระหว่างนั้น subscription จะแสดงเป็น `PendingConfirmation` ตัว subscription ที่ไม่ได้ confirm จะถูกลบหลัง 48 ชั่วโมง
- SQS queue และ Lambda function ที่อยู่ใน account เดียวกับ topic ไม่ต้อง confirm แค่ต้องมีสิทธิ์: access policy ของ queue ต้องยอมให้ `sns.amazonaws.com` เรียก `sqs:SendMessage` โดยตั้ง `aws:SourceArn` เป็น ARN ของ topic ส่วน function ก็ต้องมี resource-based permission (`aws lambda add-permission`) สำหรับ principal ตัวเดียวกัน

```sh
aws sns create-topic --name order-events
aws sns subscribe --topic-arn arn:aws:sns:us-east-1:111122223333:order-events \
  --protocol sqs --notification-endpoint arn:aws:sqs:us-east-1:111122223333:email-queue \
  --attributes RawMessageDelivery=true
aws sns subscribe --topic-arn arn:aws:sns:us-east-1:111122223333:order-events \
  --protocol lambda --notification-endpoint arn:aws:lambda:us-east-1:111122223333:function:fraud-check \
  --attributes '{"FilterPolicy": "{\"amount\": [{\"numeric\": [\">=\", 500]}]}"}'
```

### การ publish

- publisher เรียก `Publish` พร้อม body ของ message, `Subject` ที่จะใส่หรือไม่ก็ได้ และ **message attribute** ที่จะใส่หรือไม่ก็ได้: คู่ชื่อกับค่าที่มี type (`String`, `String.Array`, `Number` หรือ `Binary`) ที่เดินทางไปข้าง ๆ body และ filter policy อ่านได้ ส่วน `PublishBatch` ส่งได้ถึง 10 message ใน request เดียว
- ก่อนตอบ SNS จะเขียนสำเนาของ message ลง disk ในหลาย Availability Zone คำตอบคือ `MessageId` (บวก `SequenceNumber` ถ้าเป็น FIFO topic) มันไม่ได้บอกอะไรเกี่ยวกับ subscriber เลย และ message ที่ publish ไปแล้วเรียกคืนไม่ได้
- message หนึ่งรวม attribute แล้วมีขนาดได้ 256 KiB เป็นค่าตั้งต้น ตั้งแต่ 18 กันยายน 2026 ตัว topic attribute `MaximumMessageSize` ขยายได้ถึง 1 MiB แต่เฉพาะ topic ที่มี subscription ไม่เกิน 100 ตัว และทุกตัวเป็น SQS, Lambda หรือ Data Firehose ตัว order-events มี subscriber ที่เป็น HTTPS และ SMS เลยยังอยู่ที่ 256 KiB ถ้า payload ใหญ่กว่านั้น SNS Extended Client Library สำหรับ Java หรือ Python จะเก็บ body ไว้ใน Amazon S3 แล้ว publish แค่ reference ไปหามัน ใช้กับ payload ได้ถึง 2 GB: นี่คือ pattern [Claim Check](../claim-check/)

```sh
aws sns publish --topic-arn arn:aws:sns:us-east-1:111122223333:order-events \
  --message '{"orderId":"o-1041","amount":640,"country":"TH"}' \
  --message-attributes '{"amount":{"DataType":"Number","StringValue":"640"},"country":{"DataType":"String","StringValue":"TH"}}'
```

### Filter policy

- subscription ที่ไม่มี filter policy จะได้ทุก message ส่วน **filter policy** คือเอกสาร JSON บน subscription ที่ SNS ประเมินกับทุก message และส่งให้เฉพาะเมื่อ match ตัว `FilterPolicyScope` กำหนดว่ามันอ่านอะไร: `MessageAttributes` (ค่าตั้งต้น) หรือ `MessageBody` ที่คาดว่า body เป็น JSON object และรองรับ key ที่ซ้อนกัน
- ทุก key ใน policy ต้อง match และค่าที่ list ไว้ใต้ key เดียวกันเป็นตัวเลือกแบบ "หรือ" ส่วน `$or` ใช้รวมเงื่อนไขทั้งก้อน นอกจากค่าที่ตรงกันเป๊ะ ๆ ก็ยังมี `prefix`, `suffix`, `equals-ignore-case`, `wildcard`, `anything-but`, ช่วง IP address (`cidr`), `exists` และการเปรียบเทียบแบบ `numeric` ส่วน policy ที่อ่าน attribute จะดูแค่ attribute แบบ `String`, `String.Array` และ `Number` เลยต้อง publish `amount` เป็น `Number`
- policy ของ fraud-check (ของโทรศัพท์ on-call ก็เหมือนกันแต่ใช้ 5000):

```json
{ "amount": [ { "numeric": [ ">=", 500 ] } ] }
```

- ข้อจำกัด: 5 key และ 150 combination ของค่าต่อ policy, JSON ขนาด 256 KB, ตัวเลขตั้งแต่ −10⁹ ถึง 10⁹ ที่มีทศนิยมห้าตำแหน่ง และโดยค่าตั้งต้น 200 filter policy ต่อ topic และ 10,000 ต่อ account ตัว policy ที่สร้างใหม่หรือแก้อาจใช้เวลาถึง 15 นาทีกว่าจะมีผลทุกที่ เพราะฉะนั้นให้ publish message ทดสอบก่อนจะพึ่งมัน
- message ที่ไม่ match ก็แค่ไม่ถูกส่งให้ subscription นั้น โดยที่ metric `NumberOfNotificationsFilteredOut` ของ topic นับมันไว้ การ filter บน attribute ฟรี ส่วนการ filter บน body คิดเงินตาม GB ของ payload ที่ scan

### การส่ง และรูปแบบของ message

- **SQS** โดยค่าตั้งต้น SNS จะห่อ message ไว้ใน JSON envelope (`Type`, `MessageId`, `TopicArn`, `Subject`, `Message`, `Timestamp`, field ของ signature, `UnsubscribeURL` และ attribute) แบบที่ analytics-queue ได้รับ ถ้าเปิด `RawMessageDelivery` แบบ email-queue ตัว queue จะได้แค่ body และ message attribute ได้ถึง 10 ตัวจะกลายเป็น SQS message attribute ส่วน message ที่มี attribute เกิน 10 ตัว SNS จะทิ้งมันสำหรับ subscription แบบนี้ โดยถือเป็น client-side error
- **Lambda** SNS เรียก function แบบ **asynchronous**: Lambda เอา event ไปใส่ internal queue ของตัวเองแล้วตอบ 202 ส่วนถ้า function error มันจะ retry สองครั้งเป็นค่าตั้งต้น และ retry event ที่โดน throttle ต่อไปได้นานถึง 6 ชั่วโมง ตัว Lambda รับ trigger จาก standard topic เท่านั้น
- **HTTP/S** SNS ส่ง `POST` ที่มี header อย่าง `x-amz-sns-message-type` และ `x-amz-sns-topic-arn` และมี JSON envelope เป็น body ในแบบ `text/plain; charset=UTF-8` เว้นแต่ `headerContentType` ของ delivery policy จะบอกเป็นอย่างอื่น ตัว endpoint ต้องเข้าถึงได้จาก internet (SNS ไม่ส่งให้ HTTP endpoint แบบ private) และควร verify signature ของทุก message ตัว topic จะ sign ด้วย SHA1 (`SignatureVersion` 1) เว้นแต่เราจะตั้ง `SignatureVersion` เป็น 2 ที่ใช้ SHA256
- **คน** subscription แบบอีเมล (standard topic เท่านั้น) มีไว้สำหรับ alert ภายใน ปรับแต่ง body ไม่ได้ และแต่ละตัวรับได้ไม่เกิน 10 message ต่อวินาที ส่วน SMS ส่งออกผ่าน AWS End User Messaging SMS โดยที่ account ใหม่เริ่มต้นใน SMS sandbox ที่ส่งได้แค่เบอร์ที่ verify แล้ว และราคาขึ้นกับประเทศปลายทาง

### Retry และ dead-letter queue

ถ้าฝั่ง endpoint พัง SNS จะ retry ตาม delivery policy ของ protocol นั้น ค่าตั้งต้น ณ ตุลาคม 2026:

| Endpoint | จำนวน attempt | กระจายตลอดช่วง |
|---|---|---|
| SQS, Lambda (AWS managed) | 100,015: 3 ครั้งทันที, 2 ครั้งห่างกันหนึ่งวินาที, 10 ครั้งที่ back off จาก 1 s ถึง 20 s แล้วก็ 100,000 ครั้งทุก 20 s | 23 วัน |
| อีเมล, SMS, mobile push | 50: 2 ครั้งห่างกันสิบวินาที, 10 ครั้งที่ back off จาก 10 s ถึง 10 นาที แล้วก็ 38 ครั้งทุก 10 นาที | 6 ชั่วโมง |
| HTTP/S, policy ตั้งต้น | 4: attempt แรกกับ retry 3 ครั้งห่างกัน 20 s (`numRetries` 3, `minDelayTarget` = `maxDelayTarget` = 20, `linear`) | ราวหนึ่งนาที |
| HTTP/S, policy ของเราเอง | retry ได้ถึง 100 ครั้งในสี่ phase ด้วย backoff แบบ arithmetic, exponential, geometric หรือ linear | ไม่เกิน 3,600 s |

- throttling error จาก Data Firehose ทำตามแถวที่สอง มีแค่ policy ของ HTTP/S ที่แก้ได้ ทั้งบน topic หรือบน subscription ส่วนตัวอื่นตายตัว แล้ว SNS ก็ใส่ jitter ให้ delay ด้วย
- คำตอบ 5xx และ 429 ของ HTTP/S endpoint จะถูก retry ส่วน status อื่นถือเป็นความล้มเหลวถาวร ส่วน client-side error เช่น endpoint ที่ถูกลบไปแล้ว หรือ policy ที่ไม่ยอมให้ SNS เข้าแล้ว จะไม่ถูก retry เลย ใน step 3 ตัว partner ตอบ 503 เลยได้ retry ตั้งต้นสามครั้ง
- เมื่อ policy หมด หรือทันทีหลังเจอ client-side error ตัว SNS จะทิ้ง message เว้นแต่ subscription จะมี **dead-letter queue**: SQS queue ที่ระบุไว้ใน `RedrivePolicy` (`deadLetterTargetArn`) ของ subscription และอยู่ใน account และ Region เดียวกัน ตัว access policy ของมันต้องยอมให้ SNS ส่งเข้าไปได้ ถ้าเป็น queue ที่ encrypt ก็ต้องใช้ customer managed KMS key ที่ยอมให้ SNS ใช้ และ AWS แนะนำให้ตั้ง retention สูงสุดคือ 14 วัน ส่วนบน FIFO topic ตัว dead-letter queue จะเป็นแบบเดียวกับ queue ที่ subscribe อยู่
- เฝ้าดูมันด้วย [CloudWatch](../amazon-cloudwatch/) alarm บน `ApproximateNumberOfMessagesVisible` ของ queue และ SNS ก็นับ `NumberOfNotificationsRedrivenToDlq` กับ `NumberOfNotificationsFailedToRedriveToDlq` ไว้ด้วย
- การเอา message ออกมาส่งใหม่เป็นหน้าที่ของเรา redrive ของ SQS (`StartMessageMoveTask`) ไม่รับ dead-letter queue ที่ต้นทางเป็น SNS subscription เพราะฉะนั้นพอ partner กลับมาแล้ว ก็ต้องมี consumer (เช่น Lambda function ที่มี partner-dlq เป็น event source) อ่าน queue แล้วส่ง message พวกนั้นอีกรอบ ตัว pattern นี้อยู่ในหน้า [Dead-Letter Queue](../dead-letter-queue/)
- การส่งเป็นแบบ **at least once** บางครั้ง subscriber ได้ message เดียวกันสองครั้ง และ standard topic พยายามรักษาลำดับการ publish แต่ก็อาจส่งไม่ตามลำดับได้ ให้ทำ consumer ทุกตัวให้ [idempotent](../idempotent-consumer/) โดยใช้ key อย่าง order ID

partner ที่ล่มนานกว่าหนึ่งนาทีต้องการมากกว่าค่าตั้งต้น อย่าง policy ระดับ subscription ตัวนี้จะ retry 10 ครั้ง โดย back off จาก 20 s ถึง 5 นาที และจำกัดการส่งไว้ที่เฉลี่ย 50 ครั้งต่อวินาที:

```json
{
  "healthyRetryPolicy": {
    "numRetries": 10, "numNoDelayRetries": 0,
    "numMinDelayRetries": 2, "minDelayTarget": 20,
    "numMaxDelayRetries": 3, "maxDelayTarget": 300,
    "backoffFunction": "exponential"
  },
  "throttlePolicy": { "maxReceivesPerSecond": 50 }
}
```

```sh
aws sns set-subscription-attributes --subscription-arn "$PARTNER_SUBSCRIPTION_ARN" \
  --attribute-name RedrivePolicy \
  --attribute-value '{"deadLetterTargetArn":"arn:aws:sqs:us-east-1:111122223333:partner-dlq"}'
```

### FIFO topic

- FIFO topic (เช่น `order-events.fifo`) ต้องมี `MessageGroupId` ในทุก message และรักษาลำดับภายในแต่ละ group ส่วน group ที่ต่างกันจะถูกส่งขนานกันไป มันทิ้ง message ที่มี `MessageDeduplicationId` ที่มันเคยเห็นแล้วใน 5 นาทีที่ผ่านมา ส่วนถ้าใช้ content-based deduplication ตัว ID จะเป็น hash ของ body
- subscribe ได้แค่ SQS queue เท่านั้น ตัว FIFO queue รักษาลำดับและ deduplication ไว้ได้ตลอดสาย ส่วน standard queue (ทำได้ตั้งแต่กันยายน 2023) ได้ message แบบ at least once และเรียงลำดับแบบ best-effort ตัว Lambda function อ่านจาก queue แบบนี้ได้ ส่วน HTTP/S, อีเมล, SMS และ mobile endpoint subscribe ไม่ได้เลย
- Throughput: 300 message ต่อวินาทีต่อ message group และโดยค่าตั้งต้น (`FifoThroughputScope` = `Topic`) deduplication ครอบคลุมทั้ง topic ทำให้รับได้ถึง 3,000 message หรือ 20 MB ต่อวินาที ส่วนโหมด high-throughput (`MessageGroup` มีตั้งแต่มกราคม 2025 และตั้งแล้วเปลี่ยนกลับไม่ได้) ทำ deduplication ต่อ group และให้ topic ใช้ Publish quota ของ account ใน Region นั้นได้ ส่วน FIFO topic หนึ่งมีได้ 100 subscription และ account หนึ่งมี FIFO topic ได้ 1,000 ตัว
- **Archive และ replay** มีแค่ใน FIFO topic โดยเจ้าของ topic ตั้ง `ArchivePolicy` (`MessageRetentionPeriod` ตั้งแต่ 1 ถึง 365 วัน) แล้ว SNS ก็เก็บสำเนาของทุก message ไว้ ส่วน subscriber ตั้ง `ReplayPolicy` บน subscription ของตัวเอง (`PointType` `Timestamp`, `StartingPoint` และ `EndingPoint` ที่จะใส่หรือไม่ก็ได้) แล้ว SNS ก็ส่ง message ที่ archive ไว้มาอีกรอบ โดยผ่าน filter policy ของ subscription พร้อม `MessageId` และ timestamp เดิม และมี attribute `Replayed` ตัว subscription replay ได้ทันทีที่ถูกสร้าง นี่คือวิธีที่ FIFO consumer ที่เพิ่มเข้ามาพรุ่งนี้ตามทันของเก่า การ deactivate archive จะลบมันทิ้ง และ topic ที่มี archive ที่ active อยู่จะลบไม่ได้

### Fan-out pattern: SQS queue หนึ่งตัวต่อ consumer

การ subscribe queue หนึ่งตัวให้แต่ละ consumer แบบที่ Acme ทำกับตัวส่งอีเมลและ analytics loader คือวิธีใช้ SNS ที่เจอบ่อยที่สุด แต่ละ queue มี backlog, retention (ได้ถึง 14 วัน), visibility timeout, dead-letter queue และการ scale ของตัวเอง ทำให้ consumer ที่ช้า กำลัง deploy หรือล่มอยู่ ทำให้ queue ของตัวเองช้าลงเท่านั้น โดยที่ consumer ตัวอื่นและ publisher ไม่รู้สึกอะไรเลย consumer ใหม่ก็แค่ queue ใหม่กับ subscription ใหม่ โดยไม่ต้องแก้ Orders การส่งไป SQS ไม่มีค่าใช้จ่ายรายการส่ง แต่ data ที่ transfer ยังคิดเงิน ตั้งแต่กรกฎาคม 2025 ตัว `MessageGroupId` บน message ที่ส่งไป standard topic จะถูกส่งต่อไปที่ standard queue ที่ subscribe อยู่ ตรงนั้นมันจะเปิด SQS fair queue ให้ consumer ที่ tenant หลายรายใช้ร่วมกัน ฝั่ง consumer อยู่ในหน้า [Amazon SQS](../amazon-sqs/) และการ scale worker ที่อยู่หลัง queue เดียวอยู่ในหน้า [Competing Consumers](../competing-consumers/)

### Lambda รับตรงจาก SNS หรือผ่าน queue?

- **รับตรง** ง่ายที่สุด: เรียก function หนึ่งครั้งต่อ message และความล้มเหลวของตัว function เองจะผ่าน asynchronous retry ของ Lambda แล้วไปต่อที่ on-failure destination หรือ dead-letter queue ของ function ส่วน dead-letter queue ของ subscription เองจับได้แค่สิ่งที่ SNS ส่งให้ Lambda ไม่ได้ เช่น function ที่ถูกลบไปแล้วหรือ permission ที่ถูกถอดออก
- **ผ่าน queue** (SNS ไป SQS ไป Lambda) เพิ่ม batch, เพดาน concurrency (`MaximumConcurrency` บน event source mapping), partial batch failure, backlog ที่มองเห็นได้และเก็บได้ถึง 14 วัน และ redrive จาก dead-letter queue ของ queue นั้น ให้เลือกแบบนี้เมื่อ function เรียก dependency ที่มี rate limit, เมื่องานต้องรอดผ่าน outage ที่นาน ๆ และสำหรับ FIFO topic ที่ Lambda subscribe ไม่ได้ เอกสารของ Lambda ยังเตือนด้วยว่าเมื่อ function ตามไม่ทัน event อาจถูกลบออกจาก asynchronous queue ของมันโดยไม่เคยได้รันเลย ดู [AWS Lambda](../aws-lambda/)

### Encryption, สิทธิ์การเข้าถึง และ network

- **Encryption at rest** ถ้าใช้ server-side encryption (`KmsMasterKeyId`: AWS managed key `alias/aws/sns` หรือ customer managed symmetric key) SNS จะ encrypt body ของ message ทันทีที่ได้รับ และ decrypt ตอนส่ง ส่วน metadata ของ topic และ message (subject, message ID, timestamp และ attribute) ไม่ถูก encrypt และ request ที่ไป topic ที่ encrypt ต้องใช้ HTTPS และ Signature Version 4 ถ้าจะส่งไป queue ที่ encrypt ไว้ ตัว customer managed key ของ queue ต้องยอมให้ SNS service principal ใช้ `kms:GenerateDataKey` และ `kms:Decrypt`
- **สิทธิ์การเข้าถึง** [IAM](../aws-iam/) policy ให้ `sns:Publish` หรือ `sns:Subscribe` กับ role ของเราเอง ส่วน access policy ของ topic ที่เป็น resource-based policy จะยอมให้ account อื่นและ AWS service เข้ามา โดยค่าตั้งต้นมีแค่เจ้าของ topic ที่ publish หรือ subscribe ได้ ถ้าเป็น queue ใน account อื่น ทางที่ดีที่สุดคือให้เจ้าของ queue เป็นคน subscribe เพราะแบบนี้ไม่ต้อง confirm ส่วน SNS ก็ยังส่งไปที่ SQS queue และ Lambda function ใน Region อื่นได้ด้วย
- **Network** ตัว interface VPC endpoint ทำให้ call `Publish` จาก VPC ไม่ต้องออก internet (ดู [Private Endpoints](../private-endpoints/))
- SNS message data protection ที่ใช้ audit หรือ mask ข้อมูลอ่อนไหวใน message ปิดรับลูกค้าใหม่แล้วตั้งแต่ 30 เมษายน 2026

### Observability

- CloudWatch metric ราย topic มี `NumberOfMessagesPublished`, `NumberOfNotificationsDelivered`, `NumberOfNotificationsFailed`, `NumberOfNotificationsFilteredOut` และ `PublishSize`
- **Delivery status logging** เขียนผลการส่งไปที่ SQS, Lambda, HTTP/S, Data Firehose และ mobile app endpoint ลงใน CloudWatch Logs โดยตั้ง sample rate ของการส่งที่สำเร็จได้: มี response ของ endpoint และ dwell time ระหว่าง publish ถึงตอนส่งต่อ ตรงนี้คือที่ที่เราเห็นว่า endpoint ของ partner ตอบอะไรมา
- ถ้าเปิด AWS X-Ray active tracing (`TracingConfig` = `Active`) ก็ตาม request ได้ตั้งแต่ publisher ผ่าน topic ไปจนถึง subscriber

### Quota และราคา

- Quota ณ ตุลาคม 2026: `Publish` (และ `PublishBatch` ที่นับต่อ message) ถูกจำกัดต่อ account และ Region ไว้ที่ 30,000 message ต่อวินาทีใน US East (N. Virginia), 9,000 ใน US West (Oregon) และ Europe (Ireland), 1,500 ในอีกแปด Region (3,000 สำหรับ FIFO topic) และ 300 ใน Region อื่น (3,000 สำหรับ FIFO) ทั้งหมดนี้เป็น soft quota ส่วน account หนึ่งมี standard topic ได้ 100,000 ตัว และ standard topic หนึ่งมี subscription ได้ 12,500,000 ตัว
- ราคาจาก price list ของ US East (N. Virginia) วันที่ 15 กันยายน 2026 สำหรับ standard topic: API request ล้านแรกของแต่ละเดือนฟรี (นับรวมทุก Region) หลังจากนั้น $0.50 ต่อล้าน ทุกก้อน 64 KB ของ message ที่ publish นับเป็นหนึ่ง request และของ message ที่ส่งออกนับเป็นหนึ่งการส่ง การส่งไป SQS และ Lambda ฟรี (data transfer คิดเงิน), ไป HTTP/S $0.60 ต่อล้านหลัง 100,000 ครั้งแรกที่ฟรี, อีเมล $2.00 ต่อ 100,000 ฉบับหลัง 1,000 ฉบับแรกที่ฟรี, mobile push notification $0.50 ต่อล้านหลังล้านแรกที่ฟรี และไป Data Firehose $0.19 ต่อล้าน ส่วน SMS คิดราคาตามประเทศปลายทางผ่าน AWS End User Messaging
- FIFO topic: $0.30 ต่อล้าน publish request บวก $0.017 ต่อ GB ที่ publish และ $0.01 ต่อล้าน subscription message บวก $0.001 ต่อ GB โดยที่ subscription message คือจำนวน message ที่ publish คูณจำนวน subscription ไม่ว่าจะถูก filter ออกหรือไม่ก็ตาม การ archive คิด $0.10 ต่อ GB ที่ process และ $0.023 ต่อ GB-month ที่เก็บ ส่วน replay คิดตามอัตรา FIFO แล้วการ filter บน body ก็คิด $0.09 ต่อ GB ที่ scan
- สำหรับ Acme ตัว order เล็ก ๆ หนึ่งล้านรายการต่อเดือนจะเสียค่า publish request ราว $0.50 ถ้า free tier ถูกใช้หมดไปกับที่อื่นแล้ว บวก $0.54 สำหรับการส่ง HTTPS ไปหา partner อีก 900,000 ครั้งที่คิดเงิน ส่วน queue สองตัวและ function ได้รับของตัวเองโดยไม่มีค่าส่ง

## อยู่ตรงไหนใน solution

- **Solution:** กระจาย domain event แบบในตัวอย่างนี้, แจ้งเตือนคน (CloudWatch alarm และ AWS event อื่นผ่านอีเมล SMS หรือแชตผ่าน Amazon Q Developer in chat applications), webhook ไปหา partner, mobile push, กระจาย S3 event notification ไปหาหลาย consumer และกระจาย event ไปที่ account อื่น
- **Pattern ที่มัน implement หรือช่วยรองรับ:** [Publish-Subscribe](../publish-subscribe/) (step 1 และ 2) และ event channel ของ [event-driven architecture](../event-driven-architecture/), ฝั่งส่งของ [Webhooks](../webhooks/) ที่มี `POST` แบบ sign และ retry, [Retry with Backoff](../retry-with-backoff/) ใน delivery policy และ [Dead-Letter Queue](../dead-letter-queue/) ต่อ subscription (step 3), [Competing Consumers](../competing-consumers/) หลัง queue แต่ละตัวที่ subscribe และ [Claim Check](../claim-check/) ผ่าน extended client ตัว consumer ต้อง [idempotent](../idempotent-consumer/) และ service ที่เขียน database แล้วค่อย publish ต้องมี [transactional outbox](../transactional-outbox/) เพราะ `Publish` ไม่ได้เป็นส่วนหนึ่งของ database transaction ส่วนถ้าอยู่ใน process เดียว แนวคิดเดียวกันนี้คือ pattern [Observer](../observer/)
- **เพื่อนบ้านที่มักเจอ:** [Amazon SQS](../amazon-sqs/) และ [AWS Lambda](../aws-lambda/) ในฐานะ subscriber, Data Firehose สำหรับ archive message ลง [Amazon S3](../amazon-s3/), CloudWatch alarm และ EventBridge rule ที่ publish ไปที่ topic, KMS สำหรับ key และ AWS End User Messaging สำหรับ SMS
- **Managed offering:** SNS เองก็คือ managed service ส่วน [Amazon EventBridge](../amazon-eventbridge/) route event ระหว่าง AWS service, SaaS application และ account ส่วน Amazon MQ รัน broker ของ ActiveMQ หรือ [RabbitMQ](../rabbitmq/) ที่มี topic และ Amazon MSK รัน [Kafka](../kafka/) ส่วน cloud อื่นมี Google Cloud Pub/Sub และ Azure Event Grid หรือ topic ของ Service Bus

## ใช้ตอนไหนดี

- event เดียวที่มี consumer หลายตัวที่ไม่ขึ้นต่อกัน แต่ละตัวมีจังหวะและวิธีจัดการความล้มเหลวของตัวเอง ปกติจะมี queue หนึ่งตัวต่อ consumer
- push จาก AWS ไปหาคนและระบบภายนอก: alert ผ่านอีเมล SMS หรือ mobile push และ webhook ไปหา partner
- fan-out กว้าง ๆ ที่มี filter ง่าย ๆ บน attribute หรือ field ใน JSON
- ไม่ใช่ตอนที่ consumer ต้องการประวัติหรือ replay (standard topic ไม่เก็บอะไรไว้เลย ให้ใช้ archive ของ FIFO topic, EventBridge หรือ stream แทน), ตอนที่ event หลายแบบจากหลายแหล่งต้อง route และแปลงรูป (EventBridge), ตอนที่แต่ละ message ควรไปที่ worker ตัวเดียว (queue) หรือตอนที่ลำดับแบบเคร่งครัดต้องไปถึงอะไรที่ไม่ใช่ SQS FIFO queue

| | consumer ได้ message ยังไง | ใครได้แต่ละ message | เก็บไว้นานแค่ไหน | ลำดับ | เลือกใช้เมื่อ |
|---|---|---|---|---|---|
| **SNS standard topic** | push ไปที่ subscription: SQS, Lambda, Firehose, HTTP/S, อีเมล, SMS, mobile push | ทุก subscription ที่ filter match | จนกว่าจะส่งถึง ถ้าไม่ถึงก็ retry ส่งเข้า DLQ หรือทิ้ง | best effort | fan-out message เดียวไปหลายที่, การแจ้งเตือน |
| **SNS FIFO topic** | push ไปที่ SQS queue เท่านั้น | ทุก subscription ที่ match | จนกว่าจะส่งถึง และมี archive ได้ถึง 365 วันไว้ replay ถ้าเปิด | ต่อ message group | fan-out ไปที่ queue แบบเรียงลำดับและตัดของซ้ำ |
| **EventBridge** | rule route event ไปหา target และตั้งแต่กันยายน 2026 Custom event bus แบบใหม่ก็มี subscriber ด้วย | ทุก target ที่ match | target ของ rule ถูก retry ได้ถึง 24 ชั่วโมงเป็นค่าตั้งต้น, archive ใช้ replay ได้ และ Custom event bus แบบใหม่เก็บ 24 ชั่วโมง ขยายได้ถึงหนึ่งปี | เรียงลำดับเคร่งครัดบน Custom event bus แบบใหม่ | route event จาก AWS service, SaaS app และ account อื่นตาม content |
| **SQS** | consumer poll แล้วลบ | consumer ทีละตัว | จนกว่าจะถูกลบ ไม่เกิน 14 วัน | best effort หรือต่อ group ใน FIFO | work queue, buffer หน้า consumer |
| **[Kinesis Data Streams](../amazon-kinesis-data-streams/)** | อ่านตามตำแหน่งจาก stream ที่ใช้ร่วมกัน | ทุก application ที่ consume | 24 ชั่วโมงเป็นค่าตั้งต้น ได้ถึง 365 วัน | ต่อ shard | stream ที่หลาย application อ่านและ replay |
| **Kafka (Amazon MSK)** | consumer group ดึงจาก partition | ทุก consumer group | ตาม retention ของ topic (ค่าตั้งต้น 7 วัน) | ต่อ partition | event stream ปริมาณสูงที่ replay ได้ |

## ได้อะไร เสียอะไร

- **Push ไม่ใช่ pull** SNS เป็นคนตัดสินว่าจะส่งเมื่อไร และ endpoint ที่ยังไม่พร้อมต้องพึ่ง retry การมี queue หนึ่งตัวต่อ consumer เปลี่ยนมันกลับเป็น pull แต่ต้องแลกกับการมี service เพิ่มอีกตัว
- **ไม่มี backlog** standard topic เก็บ message ไว้แค่ตอนที่กำลังส่งมันเท่านั้น consumer ที่เพิ่มเข้ามาทีหลัง หรือตัวที่ retry หมดแล้วโดยไม่มี dead-letter queue จะไม่ได้ message นั้นเลย
- **At least once และเรียงลำดับแบบคร่าว ๆ** standard topic ส่งซ้ำและส่งไม่ตามลำดับได้ ส่วน FIFO topic แก้ได้ทั้งสองเรื่อง แต่เฉพาะกับ subscriber ที่เป็น SQS โดยมีเพดาน throughput ระดับ group และ 100 subscription ต่อ topic
- **Retry ตั้งต้นของ HTTP/S สั้น** ราวหนึ่งนาที แล้ว message ก็หายไป เว้นแต่ subscription จะมี dead-letter queue ส่วน policy ตายตัวของ SQS และ Lambda อดทนมาก แต่ของอีเมลและ SMS ยอมแพ้หลัง 6 ชั่วโมง
- **Filter แบบง่าย** 5 key และ 150 combination ต่อ policy, การแก้ที่ใช้เวลาถึง 15 นาที และ message ที่ถูก filter ออกก็หายไปสำหรับ subscription นั้น
- **ขนาด** 256 KiB ต่อ message บน topic ส่วนใหญ่ ส่วน 1 MiB ได้เฉพาะตรงที่ subscriber ทุกตัวเป็น SQS, Lambda หรือ Data Firehose
- **ใช้ได้แค่บน AWS** API และ envelope เป็นของ SNS เอง และ subscriber ที่เป็น HTTP ต้องรับมือกับ confirmation message และ signature ของมัน

## ข้อควรรู้ตอนลงมือทำ

- **ให้ทุก consumer มี queue และทุก subscription มี dead-letter queue** โดยเฉพาะ subscription แบบ HTTP/S และ Lambda โดยตั้ง retention 14 วัน และมี alarm ดูความลึกของมัน
- **ตกลง delivery policy กับ partner แต่ละราย:** retry ที่กระจายครอบช่วง outage ที่เราอยากรอดผ่านไปได้, `maxReceivesPerSecond` ที่ server ของเขารับไหว และ endpoint ที่ตอบ 5xx หรือ 429 เมื่ออยากได้ message อีกรอบ เพราะ SNS ถือว่า error status อื่นทุกตัวคือจบแล้ว
- **ทำ HTTP endpoint ให้ปลอดภัย:** verify signature (ตั้ง `SignatureVersion` 2) เช็ก `x-amz-sns-topic-arn` และ confirm subscription เฉพาะของ topic ที่เราคาดไว้
- **ออกแบบ attribute ไปพร้อมกับ filter:** ใส่สิ่งที่ subscriber จะ filter ไว้ใน message attribute ที่มี type ถูกต้อง (หรือ filter บน JSON body) และทดสอบ policy ด้วย message จริงก่อนจะพึ่งมัน
- **ทำ consumer ให้ idempotent** บน business key อย่าง order ID เพราะทั้ง SNS และ SQS ส่งซ้ำได้
- **ให้ publisher ทำตัวดี:** publish หลัง database commit ผ่าน outbox และ retry `Publish` แบบมี backoff เมื่อโดน throttle
- **เปิด delivery status logging** สำหรับ subscription แบบ HTTP/S และ Lambda และตั้ง alarm ที่ `NumberOfNotificationsFailed`
- **ล็อกให้แน่น:** จำกัด scope ของ topic policy และ queue policy ด้วย `aws:SourceArn` หรือ `aws:SourceAccount` และใช้ customer managed KMS key เมื่อ queue ที่ subscribe อยู่ถูก encrypt
- **นิยามเป็นโค้ด** (CloudFormation, CDK หรือ Terraform): topic, subscription, filter policy, delivery policy และ redrive policy, queue policy และ alarm
