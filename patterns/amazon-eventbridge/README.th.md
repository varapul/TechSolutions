## ปัญหา

ตอนที่ Acme Shop รับ order หลายส่วนของบริษัทต้องรู้เรื่องนี้: order ใหญ่จากประเทศไทยต้องไปให้คนรีวิว, ทุก order ต้องป้อนเข้า analytics pipeline และไตรมาสหน้าก็จะมีคนอยากได้ loyalty point ด้วย ถ้า Orders service เรียกแต่ละตัวเอง มันต้องรู้จัก consumer ทุกตัว รอพวกมัน รับมือตอนพวกมันล่ม และต้องแก้ตัวเองทุกครั้งที่มีทีมเพิ่ม consumer เข้ามา การมี queue หนึ่งตัวต่อ consumer ช่วยตัดเรื่องการรอออกไป แต่ก็ยังต้องมีใครสักคนตัดสินว่า event ไหนไป queue ไหน แล้ว event บางตัวที่ร้านต้องตอบสนองก็ไม่ได้มาจากโค้ดของร้านเองเลย: S3 แจ้งเรื่องรูปสินค้าใหม่ และ Stripe แจ้งเรื่อง payment dispute สิ่งที่ต้องการคือที่เดียวที่ producer publish ข้อเท็จจริงลงไป แล้ว consumer แต่ละตัวก็บอกตาม content ว่าอยากได้ข้อเท็จจริงไหน

## ทำงานยังไง

Amazon EventBridge คือ event router แบบ serverless ตัว producer ส่ง event ไปที่ **event bus** แล้วแต่ละ **rule** บน bus นั้นก็เทียบทุก event กับ **event pattern** ของตัวเอง และส่งตัวที่ match ไปให้ **target** ของมัน ส่วน consumer ไม่ต้อง poll: EventBridge push event ที่ match แต่ละตัวไปให้แต่ละ target และ retry เมื่อ target พัง ตัว producer กับ consumer ไม่เคยระบุถึงกันตรง ๆ ทำให้ฝั่งไหนก็เปลี่ยนได้โดยที่อีกฝั่งไม่ต้องรู้

### Bus: default, custom และ partner

- **default bus** มีอยู่แล้วในทุก account และ Region และ AWS service ก็ publish event ของตัวเองไปที่นี่: EC2 instance ที่เปลี่ยน state, CloudFormation stack ที่ทำเสร็จ หรือเมื่อเราเปิด EventBridge notification ให้ bucket แล้ว ก็จะมี event S3 `Object Created` สำหรับ object ใหม่ทุกตัวใน `product-images` แต่ละ service ส่ง event ของตัวเองแบบ *durable* (at least once) หรือแบบ *best-effort* ตัวใดตัวหนึ่ง โดยที่ EventBridge events reference บอกไว้ว่าตัวไหนเป็นแบบไหน
- **custom bus** อย่าง `shop-bus` รับ event ของเราเองที่ส่งมาด้วย `PutEvents` การให้ event ของเรามี bus ของตัวเองทำให้ rule, permission และ archive ของมันแยกจาก AWS event บน default bus
- **partner bus** รับ event จาก SaaS partner ยกตัวอย่างเช่น Stripe: มันจะสร้าง *partner event source* ไว้ใน account ของเรา แล้วเราก็ผูกมันเข้ากับ bus ที่ชื่อเดียวกัน (`aws.partner/stripe.com/…`) ส่วน event ที่ partner ส่งมาก่อนหน้านั้นจะถูกทิ้ง รายชื่อ partner มี Stripe, Shopify, Zendesk, Datadog, PagerDuty, Okta, Auth0 และ Salesforce (ผ่าน Amazon AppFlow) และอื่น ๆ อีก

### Event

ทุก event บน bus เป็นเอกสาร JSON ที่มี field ระดับบนสุดชุดเดียวกัน นี่คือ **o-981** แบบที่ `shop-bus` เก็บไว้:

```json
{
  "version": "0",
  "id": "7b3c4c2e-…",
  "detail-type": "OrderPlaced",
  "source": "shop.orders",
  "account": "111122223333",
  "time": "2026-10-06T09:14:03Z",
  "region": "us-east-1",
  "resources": [],
  "detail": { "orderId": "o-981", "amount": 1280, "country": "TH" }
}
```

`source` กับ `detail-type` รวมกันบอกว่าใครเป็นคน publish event และมันบันทึกข้อเท็จจริงแบบไหน ส่วน `detail` เก็บตัวข้อเท็จจริงเอง ตัว source ที่ขึ้นต้นด้วย `aws.` สงวนไว้ให้ AWS service ส่วนของเราเอง AWS แนะนำให้ใช้ชื่อ domain แบบกลับด้าน เช่น `com.example.orders` และ `shop.orders` ก็แค่ทำให้ตัวอย่างนี้สั้นลง EventBridge เป็นคนกำหนด `id` เติม `account`, `region` และ `time` ให้ (เว้นแต่ producer จะตั้งเวลาเอง) และเพิ่ม field `replay-name` ให้ event ที่มัน replay มาจาก archive

### Event pattern และ rule

rule หนึ่งตัวเป็นของ bus เดียว และมี event pattern ตัวเดียว คือเอกสาร JSON ที่หน้าตาเหมือน event ที่มันควรเลือก ทุก field ที่ pattern ระบุต้องมีอยู่ใน event และมีค่าใดค่าหนึ่งที่ list ไว้ ส่วน field ที่ pattern ไม่ได้พูดถึงจะถูกข้ามไป rule สองตัวบน `shop-bus` คือ:

```json
{ "detail-type": ["OrderPlaced"] }

{ "detail-type": ["OrderPlaced"],
  "detail": { "country": ["TH"], "amount": [{ "numeric": [">=", 1000] }] } }
```

ตัวแรกคือ **all-orders** ที่ match event `OrderPlaced` ทุกตัว ส่วนตัวที่สองคือ **high-value** ที่ต้องเป็นประเทศไทยและมี amount อย่างน้อย 1000 ด้วย ทำให้มัน match o-981 (1280) แต่ไม่ match o-982 (420) นอกจากค่าที่ตรงกันเป๊ะ ๆ แล้ว pattern ยังรองรับ operator พวกนี้: `prefix` และ `suffix`, `equals-ignore-case`, `anything-but`, การเปรียบเทียบแบบ `numeric` และช่วงอย่าง `[">", 10, "<=", 20]`, `cidr` สำหรับ IP address, `exists`, `wildcard` และ `$or` ข้าม field ตัว partner rule `disputes` ใช้ `prefix` จับทุก event ของ Stripe ที่ type ขึ้นต้นด้วย `charge.dispute.` ตัวเลขถูกเทียบเป็นค่า floating-point แบบ 64-bit ทำให้จำนวนเต็มแม่นยำได้แค่ถึง 2⁵³

ทุก rule เห็นทุก event บน bus ของมัน และแต่ละ rule ที่ match ก็ส่งสำเนาของตัวเองไป ส่วน pattern ที่ไป match event ที่ target ของ rule เองเป็นคนก่อด้วย อาจ trigger ตัวเองไม่รู้จบ เช่น rule ที่ตอบสนองต่อการเปลี่ยนแปลงใน S3 แล้ว target ของมันก็ไปทำให้เกิดการเปลี่ยนแปลงอีกครั้ง เพราะฉะนั้นให้ pattern แคบเท่าที่งานยอมได้ เราลอง pattern กับ event ตัวอย่างได้ใน sandbox ของ console หรือด้วย `aws events test-event-pattern` ก่อนจะ deploy

### Target

rule หนึ่งมี target ได้ถึง **ห้าตัว** แต่คำแนะนำของ AWS เองคือหนึ่ง target ต่อ rule และเพิ่ม rule ตัวที่สองเมื่อมี consumer อีกตัวต้องการ event ชุดเดียวกัน เพื่อให้แต่ละตัวเปลี่ยนได้อิสระ ส่วน target มีทั้ง Lambda function, SQS queue (standard, fair และ FIFO), [SNS](../amazon-sns/) topic, Step Functions state machine, Kinesis และ Firehose stream, [ECS](../amazon-ecs/) task, API Gateway, AWS AppSync, CloudWatch log group และอีกหลายตัว มีสองแบบที่ควรดูใกล้ ๆ:

- **API destination** ทำให้ HTTPS endpoint ไหนก็ได้เป็น target ตัว *connection* เก็บ authorization ของ endpoint ไว้ (basic, OAuth หรือ API key โดยเก็บไว้ใน AWS Secrets Manager) ตัว EventBridge รอคำตอบไม่เกิน 5 วินาที, retry response 401, 407, 409, 429 และ 5xx และเรียกแต่ละ destination ไม่เกิน 300 ครั้งต่อวินาที เว้นแต่เราจะขอเพิ่ม quota นั้น
- **Event bus** ทั้งใน account เดียวกัน ใน account อื่น หรือใน Region อื่น นี่คือวิธีที่ event ข้ามขอบเขตของ account ตัว account ฝั่งรับให้สิทธิ์ใน resource policy ของ bus ตัวเองและเขียน rule ของตัวเอง ส่วน account ฝั่งส่งจ่ายค่า event ที่ forward ไป และ event ที่มาจาก account อื่นจะไม่ถูก forward ต่อเป็นทอดที่สาม ตั้งแต่มกราคม 2025 ตัว rule ยังส่งตรงไปที่ SQS queue, Lambda function, Kinesis stream, SNS topic หรือ API Gateway API ใน account อื่นได้ด้วย ถ้า policy ของ resource นั้นยอมให้

EventBridge เรียก Lambda function และ Step Functions state machine แบบ **asynchronous**: ส่งสำเร็จแปลว่า function หรือ execution เริ่มแล้ว ไม่ได้แปลว่ามันทำเสร็จแล้ว ถ้าจะเข้าถึง target ตัว EventBridge จะ assume [IAM](../aws-iam/) role ที่เราให้ไว้ (target แบบ Step Functions และ Kinesis ต้องมี) หรือถ้าเป็น Lambda, SNS และ SQS มันจะพึ่ง resource-based policy ของ target แทนก็ได้

### Input transformer

โดยค่าตั้งต้น target จะได้ event ทั้งตัว ส่วน **input transformer** สร้าง payload แบบอื่นขึ้นมา: `InputPathsMap` copy ค่าได้ถึง 100 ตัวออกมาจาก event ด้วย JSON path แล้ว `InputTemplate` ก็วางค่าพวกนั้นลงใน template ที่เป็น string หรือ JSON ตัว target ของ high-value ส่งให้ Step Functions แค่ `{"orderId": "o-981", "amount": 1280}` ส่วน predefined variable ช่วยเติมชื่อและ ARN ของ rule, เวลาที่รับเข้า หรือ event ต้นฉบับให้ได้

### Retry และ dead-letter queue

ถ้าการส่งพังด้วย error ที่ retry ได้ เช่น target throttle call ตัว EventBridge จะลองใหม่ด้วย exponential backoff และ jitter: โดยค่าตั้งต้นนาน **24 ชั่วโมง** และได้ถึง **185 attempt** แต่ละ target มี `RetryPolicy` ของตัวเอง: `MaximumEventAgeInSeconds` (60 ถึง 86,400) และ `MaximumRetryAttempts` (0 ถึง 185) ตัวไหนหมดก่อนก็จบที่ตัวนั้น ตัว target ของ high-value ให้เวลาหนึ่งชั่วโมง ทำให้รีวิวที่ติดอยู่ไปถึงคนได้ภายในชั่วโมงนั้น แทนที่จะเป็นวันถัดไป

พอ retry หมด EventBridge จะทิ้ง event เว้นแต่ target จะมี **dead-letter queue**: SQS queue แบบ *standard* (ไม่รองรับ FIFO queue) ใน Region ของ rule โดยตั้งไว้ด้วย `DeadLetterConfig` แต่ละ message ในนั้นมี attribute ที่บอกชื่อ rule, target, `ERROR_CODE`, `EXHAUSTED_RETRY_CONDITION` และจำนวน attempt ส่วนความล้มเหลวบางแบบข้าม retry แล้วตรงไปที่ queue เลย: permission ที่ขาดไป, target ที่ไม่มีอยู่แล้ว, address ที่ resolve ไม่ได้ ส่วน EventBridge ไม่ redrive queue ให้เอง: พอแก้สาเหตุแล้ว Lambda function หรือ consumer ของเราเองต้องอ่าน message พวกนั้นแล้วส่ง event อีกรอบ

### Archive และ replay

**archive** เก็บ event ของ bus หนึ่งตัว จะเก็บทั้งหมดหรือเก็บแค่ตัวที่ match pattern ก็ได้ เป็นจำนวนวันที่เราเลือก (ค่าตั้งต้นคือเก็บไม่มีกำหนด) ตัว `shop-archive` เก็บทุก event ของ `shop-bus` ไว้ 30 วัน ส่วน **replay** ส่ง event ที่ archive ไว้ในช่วงเวลาหนึ่งกลับไปที่ bus เดิม จะส่งให้ทุก rule ของมัน หรือแค่ rule ที่เรา list ไว้ก็ได้:

- `analytics` เพิ่งเปิดใช้เมื่อเช้านี้ การ replay ย้อนหลัง 24 ชั่วโมงที่จำกัดไว้แค่ rule all-orders เลยให้ order ของเมื่อวานกับมันได้ โดยไม่ส่ง order พวกนั้นไปที่ high-value-review เป็นรอบที่สอง
- event ที่ถูก replay มี field `replay-name` ที่ consumer ใช้แยกมันออกจาก event ปกติได้ และ managed rule ก็ใช้ field นี้กันไม่ให้มันเข้าไปใน archive
- event ไปถึง archive ช้ากว่าเวลาจริงอยู่บ้าง AWS เลยแนะนำให้รอราว 10 นาทีก่อนจะ replay event ที่เพิ่งเกิด การ replay ส่ง event ในช่วงเวลานั้นทีละหนึ่งนาที และไม่สัญญาว่าจะเรียงตามลำดับเดิม และ account หนึ่งรัน replay พร้อมกันได้ 10 ตัวต่อ Region

### Custom bus สองแบบ

เดือนกันยายน 2026 AWS เปิดตัว custom bus แบบที่สองที่ชื่อ **Custom Event Bus** และเปลี่ยนชื่อแบบเดิม ที่หน้านี้ทำ animation ให้ดู เป็น **Custom Event Bus - Classic** ตัว Classic bus, default bus และ partner bus ยังทำงานเหมือนเดิม ส่วน bus แบบใหม่สร้างมาต่างออกไป:

- consumer ผูก **subscriber** เข้ากับ bus ที่แชร์มาให้ account ของตัวเองผ่าน AWS RAM แต่ละ subscriber มี filter ของตัวเองและมี target หนึ่งตัวพอดี ทำให้เจ้าของ bus ไม่ต้องเขียน routing แทนใคร
- bus **เก็บ** ทุก event ไว้ตามช่วงที่เราตั้ง ตั้งแต่ 1 ถึง 365 วัน และ 24 ชั่วโมงแรกรวมอยู่ในราคาแล้ว subscriber ใหม่เริ่มจากจุดไหนก็ได้ในช่วงนั้น แบบนี้เลยใช้แทน archive และ replay ได้
- subscriber แบบ **FIFO** ส่ง event ตามลำดับการ publish ภายใน *event group* (`EventGroupId` ที่ producer ตั้ง) และ bus ทิ้งของซ้ำที่ publish มาภายใน 5 นาทีได้
- `PutRawEvents` รับ JSON, Avro, Protobuf หรือ raw byte ได้ นอกเหนือจาก `PutEvents`
- มันมีชื่อใน CLI และ SDK ของตัวเอง (`aws eventsv2`) มี retry ตั้งต้นที่สั้นกว่า (5 attempt หรือ 300 วินาที) และคิดราคา data เป็น GB แทนการนับ event

เอกสารของ AWS แนะนำ bus แบบใหม่สำหรับ application ใหม่ ตอนเปิดตัวมันมีให้ใช้ใน 14 Region รวมถึง us-east-1

### Schema registry, Pipes และ Scheduler

EventBridge มีอีกสามส่วน แต่ละส่วนมี API ของตัวเอง:

- **schema registry** เก็บโครงสร้างของ event จากทุก AWS service, schema ของเราเอง (OpenAPI 3 หรือ JSON Schema Draft 4) และ schema ที่ **schema discovery** อนุมานมาจาก event บน bus จาก schema หนึ่งเรา download code binding สำหรับ Java, Python, TypeScript หรือ Go ได้ ตัว registry ฟรี ส่วน discovery ฟรีสำหรับ 5 ล้าน event ต่อเดือน
- **Pipes** ต่อ source หนึ่งตัวเข้ากับ target หนึ่งตัว โดยมี filter ที่จะใส่หรือไม่ก็ได้ ขั้น enrichment (Lambda function, Express Step Functions workflow, API Gateway หรือ API destination) และ input transformation ตัว source เป็น stream และ queue ที่ poll ได้: SQS, Kinesis และ [DynamoDB](../amazon-dynamodb/) stream, Amazon MSK, Kafka ที่ดูแลเอง และ Amazon MQ ตัว pipe รักษาลำดับตามที่ source ส่งมา และเราจ่ายเงินแค่สำหรับ event ที่ผ่าน filter
- **Scheduler** รัน schedule แบบครั้งเดียว (`at`), `rate` และ `cron` ได้เป็นล้านตัว ที่เรียก AWS service ได้มากกว่า 270 ตัว พร้อม retry และ dead-letter queue ที่จะใส่หรือไม่ก็ได้ AWS แนะนำให้ใช้มันแทน scheduled rule แบบเก่าบน event bus ที่ตอนนี้เอกสารมาร์กไว้ว่าเป็น legacy แล้ว

## อยู่ตรงไหนใน solution

- **Solution** integration แบบ event-driven ระหว่าง service ที่เป็นของต่างทีมหรือต่าง account, ตอบสนองต่อ AWS event เช่น process ไฟล์ที่ upload, บังคับเรื่อง tagging หรือแจ้งเตือนเรื่อง security finding, รับ event จาก SaaS application และเรียก webhook ภายนอกผ่าน API destination และ fan-out จาก business event ตัวเดียวไปหลาย workflow
- **Pattern ใน catalog นี้** EventBridge คือ router แบบ managed สำหรับ [event-driven architecture](../event-driven-architecture/) และทำ [publish-subscribe](../publish-subscribe/) โดย route ตาม content ได้ service ที่ตอบสนองต่อ event ของกันและกันผ่าน bus จะกลายเป็น [saga แบบ choreography](../saga-choreography/) ตัว API destination ส่ง [webhook](../webhooks/) ออกไป และ partner bus ก็รับ webhook เข้ามา consumer แต่ละตัวก็ยังต้องเป็น [idempotent consumer](../idempotent-consumer/) และ queue ราย target ก็คือ [dead-letter queue](../dead-letter-queue/) ส่วน payload ที่ใกล้ขนาดสูงสุด ให้เก็บข้อมูลไว้ใน S3 แล้ว publish แค่ pointer ([claim check](../claim-check/))
- **เพื่อนบ้านที่มักเจอ** [AWS Lambda](../aws-lambda/) และ AWS Step Functions ในฐานะ target, [Amazon SQS](../amazon-sqs/) ที่อยู่หน้า consumer ที่ต้องการ buffer, batch หรือ throttle ของตัวเอง และใช้เป็น dead-letter queue, Amazon SNS ตอนที่ event ตัวเดียวต้องไปถึง endpoint เป็นพัน ๆ ตัว หรือไปถึง SMS อีเมล และ mobile push, [Amazon S3](../amazon-s3/) และ AWS service แทบทุกตัวในฐานะ source, CloudWatch สำหรับ metric และ alarm และ IAM สำหรับ role ที่ EventBridge ใช้
- **Managed offering** EventBridge เองก็คือ managed service ไม่มี server หรือ broker ให้ต้องกำหนดขนาด ตัวที่ใกล้เคียงที่สุดบน cloud อื่นคือ Azure Event Grid และ Google Cloud Eventarc

## ใช้ตอนไหนดี

ใช้ EventBridge เมื่อ event สำคัญกับ consumer มากกว่าหนึ่งตัว เมื่อ consumer เป็นของทีมอื่นหรือ account อื่น เมื่อ routing ควรขึ้นกับสิ่งที่ event บอก หรือเมื่อ event มาจาก AWS service หรือ SaaS partner มันไม่เสียเงินเลยตอนว่าง และไม่ต้องวางแผน capacity จนกว่าจะชน quota ของมัน

ให้มองหาตัวอื่นเมื่อมี consumer ตัวเดียวที่ทยอยทำ backlog ตามจังหวะของตัวเอง (queue), เมื่อ consumer ทุกตัวต้องอ่าน stream ปริมาณสูงตามลำดับและ replay ได้ตามใจ (Kinesis Data Streams หรือ Kafka), เมื่อ message หนึ่งต้องไปถึง subscriber หรือโทรศัพท์จำนวนมาก ๆ (SNS) หรือเมื่อผู้เรียกต้องการคำตอบ (เรียกตรง)

| | EventBridge Classic bus | EventBridge Custom Event Bus | Amazon SNS | [Amazon SQS](../amazon-sqs/) | Kinesis Data Streams | [Apache Kafka](../kafka/) |
|---|---|---|---|---|---|---|
| consumer ได้ event ยังไง | push ไปที่ target ของแต่ละ rule ที่ match (ได้ถึง 5 ตัวต่อ rule) | push ไปที่ target ตัวเดียวของแต่ละ subscriber ที่ match | push ไปที่ทุก subscription | consumer poll แล้วลบ | อ่านตามตำแหน่งใน shard | ดึงตาม offset จาก partition |
| การเลือก | event pattern บน field ไหนก็ได้ของ event | filter บน data, metadata ของเรา หรือ system metadata | filter policy บน attribute หรือ body ของ message | ไม่มี: แต่ละ message ไปหา consumer ตัวเดียว | ไม่มี: ผู้อ่านแต่ละตัวได้ทั้ง shard | ไม่มีใน broker |
| ลำดับ | ไม่มี | FIFO subscriber: ต่อ event group | FIFO topic: ต่อ message group | FIFO queue: ต่อ message group | ต่อ shard | ต่อ partition |
| เก็บ event | เฉพาะใน archive (ถ้าเปิด) | บน bus, 1 ถึง 365 วัน | ไม่เก็บ ส่วน FIFO topic archive และ replay ได้ | จนกว่าจะถูกลบ, 1 นาทีถึง 14 วัน | 24 ชั่วโมงเป็นค่าตั้งต้น ได้ถึง 365 วัน | ต่อ topic, ค่าตั้งต้น 7 วัน |
| Source | โค้ดของเรา, AWS service, SaaS partner | โค้ดของเรา ส่วน event จาก AWS และ SaaS มาผ่าน event source | โค้ดของเราและ AWS service ที่ publish ไปที่ SNS | โค้ดของเรา | โค้ดของเรา | โค้ดของเราและ connector |
| เลือกใช้เมื่อ | route ตาม content ข้าม service, account และ SaaS | แบบเดียวกัน แต่มีลำดับ retention และ subscription ที่ consumer เป็นเจ้าของ | fan-out ไปหลาย endpoint รวมถึง SMS อีเมล และ push | work queue และ buffering | stream ที่เรียงลำดับและ replay ได้ | stream ปริมาณสูงใน cluster ของเราเองหรือ MSK |

ตัวเลขมาจากเอกสารของ AWS ณ ตุลาคม 2026 และจากหน้า Kafka ของ catalog นี้

## ได้อะไร เสียอะไร

- **At least once และไม่มีลำดับ** บน Classic bus บางครั้ง rule อาจ fire สองครั้งกับ event ตัวเดียว และ target ก็อาจถูกเรียกสองครั้ง ทำให้ o-981 อาจไปถึง `analytics` สองครั้ง และไปถึงหลัง o-982 ตัว consumer ต้อง idempotent และต้องไม่พึ่งลำดับ ถ้าลำดับสำคัญ ให้ใช้ FIFO subscriber ของ bus แบบใหม่ หรือ stream อย่าง Kinesis หรือ Kafka
- **Latency เพิ่มอีกหนึ่ง hop** FAQ บอก latency ปกติไว้ราวครึ่งวินาที เทียบกับไม่ถึง 30 ms ของ SNS ส่วนเดือนพฤศจิกายน 2024 AWS รายงาน P99 ไว้ราว 130 ms จากตอนรับเข้าถึงการส่งครั้งแรก (วัดเมื่อสิงหาคม 2024) ลดลงจากราว 2.2 วินาทีเมื่อมกราคม 2023 ไม่ว่าจะตัวเลขไหน มันก็ควรอยู่บนเส้นทางแบบ asynchronous ไม่ใช่อยู่ใน request ที่ user กำลังรอ
- **Quota ต่อ Region** `PutEvents` รับได้ 10,000 request ต่อวินาทีใน us-east-1, us-west-2 และ eu-west-1 เป็นค่าตั้งต้น แต่ใน Region ที่เล็กกว่าอาจได้แค่ 400 ส่วนการเรียก target ถูกจำกัดไว้ที่ 18,750 ครั้งต่อวินาทีใน us-east-1 และส่วนที่เกินจะถูกหน่วงไว้แทนที่จะหายไป ส่วน bus หนึ่งมีได้ 300 rule และ account หนึ่งมีได้ 100 bus เป็นค่าตั้งต้น ตัวเลขพวกนี้ขอเพิ่มได้ แต่ 5 target ต่อ rule เพิ่มไม่ได้
- **ขนาด** request `PutEvents` หนึ่งตัวมีได้ถึง 10 entry และรวมกัน 1 MB (เพิ่มจาก 256 KB เมื่อมกราคม 2026 โดยประกาศครั้งนั้นไม่ได้รวมบาง Region ไว้ หนึ่งในนั้นคือ Asia Pacific (Thailand)) และทุก 64 KB ของ event คิดเงินเป็นหนึ่ง event ทำให้ payload ใหญ่ ๆ ควรอยู่ใน S3 โดยมี pointer อยู่ใน event
- **ค่าใช้จ่ายต่อ event** $1.00 ต่อล้านสำหรับ custom event, partner event และ data event ที่ต้องเปิดเอง อย่างของ S3 ส่วน AWS management event (event ฝั่ง control plane ที่ service ส่วนใหญ่ส่ง) ฟรี และการส่งไป target ใน account เดียวกันก็ฟรี แต่การส่งไป bus อื่นคิดเพิ่มอีก $1.00 ต่อล้าน ที่ 1,000 event ต่อวินาทีจะได้ราว 2.6 พันล้าน event และ $2,600 ต่อเดือนแค่ค่า publish อย่างเดียว
- **ตามรอยยากขึ้น** ไม่มีใครเรียกใครตรง ๆ ทำให้การตามรอย order ผ่าน rule, retry และ dead-letter queue ต้องใช้ correlation ID รวมทั้ง metric และ log ของ bus และ rule ที่ pattern พิมพ์ผิดก็จะไม่ match อะไรเลยแบบเงียบ ๆ
- **Event คือสัญญา** consumer ทุกตัวพึ่งหน้าตาของ `detail` การเปลี่ยนมันคือการเปลี่ยน API: เพิ่ม field ได้ แต่อย่าเปลี่ยนชื่อ และใช้ schema registry เผยแพร่หน้าตาของมัน

## ข้อควรรู้ตอนลงมือทำ

**สร้าง bus, rule และ target ของมัน** target ของ high-value ได้ input transformer, ช่วง retry หนึ่งชั่วโมง และ dead-letter queue ส่วน account ID และชื่อ role เป็นแค่ตัวอย่าง:

```sh
aws events create-event-bus --name shop-bus

aws events put-rule --name high-value --event-bus-name shop-bus \
  --event-pattern '{"detail-type": ["OrderPlaced"], "detail": {"country": ["TH"], "amount": [{"numeric": [">=", 1000]}]}}'

aws events put-targets --rule high-value --event-bus-name shop-bus --targets '[{
  "Id": "review",
  "Arn": "arn:aws:states:us-east-1:111122223333:stateMachine:high-value-review",
  "RoleArn": "arn:aws:iam::111122223333:role/shop-bus-start-review",
  "InputTransformer": {
    "InputPathsMap": {"orderId": "$.detail.orderId", "amount": "$.detail.amount"},
    "InputTemplate": "{\"orderId\": <orderId>, \"amount\": <amount>}"
  },
  "RetryPolicy": {"MaximumEventAgeInSeconds": 3600, "MaximumRetryAttempts": 185},
  "DeadLetterConfig": {"Arn": "arn:aws:sqs:us-east-1:111122223333:high-value-dlq"}
}]'
```

**Archive ทุกอย่าง แล้ว replay ให้ consumer ใหม่** การ replay ครอบคลุม 24 ชั่วโมงก่อนที่ `analytics` จะเปิดใช้ และส่งไปที่ rule all-orders เท่านั้น:

```sh
aws events create-archive --archive-name shop-archive --retention-days 30 \
  --event-source-arn arn:aws:events:us-east-1:111122223333:event-bus/shop-bus

aws events start-replay --replay-name backfill \
  --event-source-arn arn:aws:events:us-east-1:111122223333:archive/shop-archive \
  --event-start-time 2026-10-05T09:00:00Z --event-end-time 2026-10-06T09:00:00Z \
  --destination '{"Arn": "arn:aws:events:us-east-1:111122223333:event-bus/shop-bus",
                  "FilterArns": ["arn:aws:events:us-east-1:111122223333:rule/shop-bus/all-orders"]}'
```

**Publish แล้วเช็กทุก entry** `PutEvents` สำเร็จหรือพังแยกกันเป็นราย entry: response ที่เป็น HTTP 200 ก็ยังมี `FailedEntryCount` มากกว่าศูนย์ได้ และ entry ที่พังจะมี `ErrorCode` และต้องส่งใหม่ ส่วน event ที่ส่งไปหาชื่อ bus ที่ไม่มีอยู่จะถูกรับไว้แล้วถูกทิ้งไปเงียบ ๆ ทำให้การพิมพ์ `EventBusName` ผิดทำ event หายโดยไม่มี error เลย:

```sh
aws events put-events --entries '[
  {"EventBusName": "shop-bus", "Source": "shop.orders", "DetailType": "OrderPlaced",
   "Detail": "{\"orderId\": \"o-981\", \"amount\": 1280, \"country\": \"TH\"}"},
  {"EventBusName": "shop-bus", "Source": "shop.orders", "DetailType": "OrderPlaced",
   "Detail": "{\"orderId\": \"o-982\", \"amount\": 420, \"country\": \"TH\"}"}
]'
```

- **Publish หลัง commit** ถ้า Orders service เขียน order ลง database แล้วค่อยเรียก `PutEvents` การ crash ระหว่างสองขั้นนี้จะทำ event หาย ตัว [transactional outbox](../transactional-outbox/) (หรือถ้า order อยู่ใน DynamoDB ก็เป็น pipe ที่อ่าน stream ของ table) จะ publish แค่สิ่งที่ commit แล้ว
- **เฝ้าตาข่ายนิรภัย** ตั้ง alarm ที่ `FailedInvocations` และ `InvocationsSentToDlq` ราย rule และที่ความลึกของ dead-letter queue แต่ละตัว และเฝ้าดู `ThrottledRules`, `RetryInvocationAttempts` และ latency metric จากตอนรับเข้าถึงตอนเรียก target คำแนะนำของ AWS ถือว่า latency ที่ค้างอยู่เกิน 30 วินาทีเป็นสัญญาณว่า rule โดน throttle หรือ service มีปัญหา
- **คำนวณค่าใช้จ่าย** (us-east-1, ตุลาคม 2026) order 10 ล้านรายการต่อเดือนที่แต่ละตัวเล็กกว่า 64 KB มาก มีค่า publish $10 ส่วนการส่งไป Step Functions และ SQS ใน account เดียวกันฟรี การ archive พวกมันที่ตัวละราว 1 KB เพิ่มค่า process ราว $1 ที่อัตรา $0.10 ต่อ GB บวก $0.023 ต่อ GB-month สำหรับการเก็บ และการ forward ทั้งหมดไป bus ใน account อื่นจะเพิ่มอีก $10 ตัว API destination คิด $0.20 ต่อล้าน call, Pipes คิด $0.40 ต่อล้าน request หลัง filter และ Scheduler คิด $1.00 ต่อล้านครั้งที่เรียก หลัง 14 ล้านครั้งแรกที่ฟรีในแต่ละเดือน
- **รอดตอน Region ล่ม** **global endpoint** ส่ง custom event ไปที่ bus ใน Region หลัก และ failover ไปที่ bus ชื่อเดียวกันใน Region สำรองเมื่อ Route 53 health check กลายเป็น unhealthy ถ้าใช้ alarm ตามที่ AWS กำหนด เป้า recovery time และ recovery point ตามเอกสารคือ 360 วินาที และไม่เกิน 420 วินาที ส่วนตัว endpoint เองไม่มีค่าใช้จ่ายเพิ่ม แต่การเปิด event replication ที่ AWS แนะนำจะเพิ่มค่าใช้จ่าย และ consumer ต้องรับมือกับ event ที่ถูก process ในทั้งสอง Region
- **ให้ consumer คุม rule ของตัวเอง** ใน setup แบบหลาย account ตัว bus กลางจะ forward event ไปที่ bus ใน account ของ consumer แต่ละราย แล้วทีมนั้นก็เขียน rule ของตัวเองที่นั่น หรือถ้าเป็น Custom Event Bus แบบใหม่ แต่ละทีมก็ผูก subscriber เข้ากับ bus ที่แชร์กันได้ตรง ๆ
