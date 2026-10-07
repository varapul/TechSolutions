## ปัญหา

order service ของร้านออนไลน์ถามคำถามเดิม ๆ ไม่กี่ข้อทั้งวัน: บันทึก order นี้, ขอ list order ของลูกค้าคนนี้, หา order `o-981` มันต้องตอบด้วย latency เท่าเดิม ทั้งตอนที่มีสิบ request ต่อวินาทีและตอน flash sale ถ้าใช้ relational server ตัวเดียว capacity ก็คือเครื่องหนึ่งเครื่องที่เราต้องกำหนดขนาด patch และ fail over เอง แถม Lambda execution environment ทุกตัวที่รันพร้อมกันก็เปิด database connection ของตัวเอง ส่วนการ scale out ด้วยการ shard database เองก็ต้องเพิ่มโค้ด routing, rebalancing และ resharding ที่ไม่เกี่ยวอะไรกับ order เลย

Amazon DynamoDB ตอบคำถามพวกนี้ในรูปของ service ไม่มี server หรือ version ให้ดูแล ทุก request เป็น HTTPS call ที่เซ็นแล้ว และตารางก็กระจายตัวเองไปตาม partition โดยดูจาก key ส่วนสิ่งที่ต้องแลกคือเราต้องออกแบบตารางรอบคำถามพวกนั้นก่อนจะเขียน item แรก

## ทำงานยังไง

### Table, item และ key

**table** เก็บ **item** และ item หนึ่งคือชุดของ **attribute**: string, number, ค่า binary, Boolean และ null รวมถึง list, map และ set ที่ซ้อนกันได้ลึกถึง 32 ชั้น นอกจาก primary key แล้วก็ไม่มี schema ทำให้ item สองตัวในตารางเดียวกันมี attribute ต่างกันได้ ส่วน item หนึ่ง (นับชื่อ attribute ด้วย) ใหญ่ได้ไม่เกิน **400 KB**

**primary key** เป็นได้ทั้ง **partition key** อย่างเดียว หรือ partition key คู่กับ **sort key** ส่วนตาราง `Orders` ใน diagram ใช้ key พวกนี้:

| Attribute | หน้าที่ | ตัวอย่าง |
|---|---|---|
| `customerId` | partition key ของตาราง | `C-17` |
| `sk` | sort key เขียนเป็น `orderDate#orderId` | `2026-10-06#o-981` |
| `orderId` | partition key ของ global secondary index `byOrderId` | `o-981` |

DynamoDB ส่ง partition key เข้า hash function ภายใน แล้วผลลัพธ์ก็เป็นตัวเลือก **partition** ที่เก็บ item นั้น ส่วน item ทั้งหมดที่มี partition key เดียวกันรวมกันเป็น **item collection** ที่เก็บเรียงตาม sort key จากน้อยไปมาก นี่คือเหตุผลที่ "order ของ C-17 ในเดือนตุลาคม 2026" เป็นการอ่านช่วงเดียวจบ ค่าของ partition key ยาวได้ถึง 2,048 byte และค่าของ sort key ได้ถึง 1,024 byte

### Partition, replica และ throughput

partition คือ storage บน SSD ที่ DynamoDB replicate ข้ามสาม Availability Zone และจัดการเองทั้งหมด มันเพิ่ม partition เมื่อตารางโตขึ้นหรือต้องการ throughput มากขึ้น และถ้าตารางไม่มี local secondary index มันก็กระจาย item collection ก้อนใหญ่ก้อนเดียวไปหลาย partition ได้

paper ของ USENIX ATC ปี 2022 อธิบายว่าข้างในเกิดอะไรขึ้น replica ของแต่ละ partition รวมกันเป็น replication group ที่เลือก leader ด้วย Multi-Paxos ตัว leader รับ write และการอ่านแบบ strongly consistent: มันต่อ write แต่ละตัวลง log ของตัวเอง ส่งไปให้ peer แล้วตอบรับเมื่อ replica สองในสามตัว ที่อยู่คนละ zone เก็บไว้แล้ว ส่วนการอ่านแบบ eventually consistent ใช้ replica ตัวไหนตอบก็ได้

แต่ละ partition ออกแบบมาให้รับได้มากสุด **3,000 read unit และ 1,000 write unit ต่อวินาที** read unit หนึ่งหน่วยคือการอ่านแบบ strongly consistent หนึ่งครั้งขนาดไม่เกิน 4 KB (หรือแบบ eventually consistent สองครั้ง) ส่วน write unit หนึ่งหน่วยคือการเขียนหนึ่งครั้งขนาดไม่เกิน 1 KB และ item ที่ใหญ่กว่านั้นก็ใช้หลายหน่วย: การอ่านแบบ strongly consistent ของ item ขนาด 20 KB ใช้ 5 read unit

### การอ่าน: GetItem, Query และ Scan

- `GetItem` ดึง item ตัวเดียวด้วย primary key ครบทั้งชุด
- `Query` ต้องมี partition key เป็นเงื่อนไขแบบเท่ากับ และกรอง sort key ให้แคบลงได้ด้วย `=`, `<`, `<=`, `>`, `>=`, `BETWEEN` หรือ `begins_with` ผลลัพธ์กลับมาเรียงตาม sort key หรือเรียงกลับด้านถ้าใส่ `ScanIndexForward=false`
- `Scan` อ่านทุก item ในตารางหรือใน index

`Query` และ `Scan` คืนได้มากสุด **1 MB ต่อ call** ถ้า response มี `LastEvaluatedKey` ให้ส่งมันกลับไปเป็น `ExclusiveStartKey` เพื่อดึงหน้าถัดไป และหยุดเมื่อ response ไม่มีมันแล้ว ตัว paginator ของ SDK ทำเรื่องนี้ให้ ส่วน `FilterExpression` แค่ตัดของที่จะส่งกลับ: item ที่มันตัดทิ้งก็ยังถูกอ่านและโดนคิดเงินไปแล้ว

```sh
# C-17's orders in October 2026, newest first (after step 2: o-981, then o-967)
aws dynamodb query \
  --table-name Orders \
  --key-condition-expression "customerId = :c AND begins_with(sk, :month)" \
  --expression-attribute-values '{":c": {"S": "C-17"}, ":month": {"S": "2026-10"}}' \
  --no-scan-index-forward
```

### Secondary index

- **global secondary index** (GSI) อย่าง `byOrderId` มี partition key ของตัวเอง (และจะมี sort key ของตัวเองด้วยก็ได้) และมี partition ของตัวเอง DynamoDB copy ทุก write ของตารางเข้าไปแบบ **asynchronous** ปกติใช้เวลาไม่ถึงวินาที การอ่านจาก GSI เลยเป็น eventually consistent เสมอ เราเพิ่ม GSI ให้ตารางที่มีอยู่แล้วได้ แล้ว DynamoDB ก็จะ backfill ให้ ส่วน quota ตั้งต้นคือ 20 ตัวต่อตาราง และทุก index ที่ write ไปแตะจะใช้ write unit แยกของมันเอง บนตารางแบบ provisioned ถ้า GSI มี write capacity ไม่พอ มันจะทำให้ write ของตัวตารางเองโดน throttle ไปด้วย
- **local secondary index** (LSI) ใช้ partition key ของตาราง แล้วเพิ่ม sort key อีกตัว ต้องสร้างพร้อมตาราง (มากสุด 5 ตัวต่อตาราง) และรองรับการอ่านแบบ strongly consistent แต่แลกกับการที่ item collection ทุกก้อนถูกจำกัดไว้ที่ 10 GB และ DynamoDB จะแบ่ง item collection ไปหลาย partition ไม่ได้อีก

### Read consistency

การอ่านเป็น **eventually consistent** เป็นค่าตั้งต้น การอ่านทันทีหลัง write สำเร็จเลยอาจยังไม่เห็นมัน ถ้าใส่ `ConsistentRead=true` ตัว `GetItem`, `Query` และ `Scan` บนตารางหรือ LSI จะคืนค่าล่าสุดที่ commit แล้ว โดยใช้ read unit สองเท่า ส่วน GSI และ stream อ่านแบบ strongly consistent ไม่ได้

### Conditional write และ transaction

`ConditionExpression` ทำให้ `PutItem`, `UpdateItem` หรือ `DeleteItem` มีผลก็ต่อเมื่อ item ยังเป็นอย่างที่เราคาดไว้ ไม่อย่างนั้น call จะพังด้วย `ConditionalCheckFailedException` และก็ยังใช้ write unit อยู่ดี ที่ใช้กันบ่อยมีสองแบบ:

- **Optimistic locking:** เก็บ attribute `version` ไว้ และอัปเดตก็ต่อเมื่อมันไม่ได้เปลี่ยนไปตั้งแต่ตอนที่เราอ่าน item
- **Put if absent:** `attribute_not_exists(pk)` ทำให้การเขียน key เดิมเป็นครั้งที่สองพัง idempotency record ก็ทำงานแบบนี้

```sh
# Mark o-981 as paid, but only if nobody changed it since we read version 1
aws dynamodb update-item \
  --table-name Orders \
  --key '{"customerId": {"S": "C-17"}, "sk": {"S": "2026-10-06#o-981"}}' \
  --update-expression "SET #st = :paid, version = :next" \
  --condition-expression "version = :seen" \
  --expression-attribute-names '{"#st": "status"}' \
  --expression-attribute-values '{":paid": {"S": "PAID"}, ":seen": {"N": "1"}, ":next": {"N": "2"}}'
```

`status` เป็นคำสงวนใน expression ของ DynamoDB เลยต้องใช้ placeholder `#st`

`TransactWriteItems` และ `TransactGetItems` รวมได้ถึง **100 action บน 100 item ที่ไม่ซ้ำกัน** (รวมกันไม่เกิน 4 MB) ข้ามตารางได้ภายใน account และ Region เดียว แบบได้ทั้งหมดหรือไม่ได้เลย DynamoDB อ่านหรือเขียน item แต่ละตัวใน transaction สองรอบ transaction เลยแพงเป็นสองเท่า ส่วน `ClientRequestToken` ทำให้ call `TransactWriteItems` เป็น idempotent อยู่ 10 นาที

### Capacity mode และราคา

| | On-demand (ค่าตั้งต้น) | Provisioned |
|---|---|---|
| เราตั้งค่า | ไม่ต้องตั้งอะไร จะตั้ง throughput สูงสุดต่อตารางหรือต่อ GSI ก็ได้ | read และ write capacity unit ต่อวินาที ปกติใช้คู่กับ auto scaling |
| เราจ่ายค่า | read และ write request unit ที่ใช้จริง | capacity unit ต่อชั่วโมง จะใช้หรือไม่ใช้ก็ตาม ส่วน reserved capacity ลดราคาต่อชั่วโมงลงได้ ถ้าผูกสัญญาหนึ่งหรือสามปี |
| การ scale | ตารางใหม่รับได้ต่อเนื่องถึง 4,000 write/s และ 12,000 read/s และรับ traffic ที่พุ่งถึงสองเท่าของ peak ครั้งก่อนได้ทันที | auto scaling ปรับตาม target utilisation |

ทั้งสองโหมดคิดค่า storage ต่อ GB-month ด้วย และมี table class แบบ Standard-Infrequent Access ที่ถูกกว่าไว้ให้ตารางที่ค่า storage เป็นส่วนใหญ่ แล้วก็มีของเสริมที่เลือกได้อย่าง backup, point-in-time recovery, การอ่าน stream, replication ของ global table และ data transfer แล้ว AWS ก็ลดราคา throughput แบบ on-demand ลง 50% และราคา global table ลงสูงสุด 67% มีผลตั้งแต่ 1 พฤศจิกายน 2024 และหลังจากนั้นก็วาง on-demand เป็นโหมดตั้งต้นที่แนะนำสำหรับ workload ส่วนใหญ่ ตารางหนึ่งเปลี่ยนจาก provisioned ไป on-demand ได้สูงสุดสี่ครั้งใน 24 ชั่วโมง และเปลี่ยนกลับได้ตลอด ก่อนช่วง peak ที่วางแผนไว้อย่างช่วง sale ตัว **warm throughput** ให้เรา pre-warm ตารางไว้ที่ rate ที่มันรับได้ทันที ราคาต่างกันไปในแต่ละ Region เพราะฉะนั้นให้เช็กหน้า pricing

### Hot key และ adaptive capacity

throughput ถูกแบ่งกันตาม partition ทำให้ key ที่ยุ่งตัวเดียวโดน throttle ได้ ทั้งที่ตารางโดยรวมยังมีที่เหลืออีกเยอะ ใน diagram ทุก checkout ของ guest เขียนลง `customerId = GUEST`: ช่วง sale มี 2,400 write/s ไป hash ลงที่ P3 ที่รับได้ 1,000 แล้ว write ที่เกินจากนั้นก็โดน throttle ด้วยเหตุผล `TableWriteKeyRangeThroughputExceeded` ตัว AWS SDK จะ retry call ที่โดน throttle ด้วย exponential backoff ช่วยให้ burst สั้น ๆ เรียบขึ้น แต่ยกเพดานไม่ได้

**Adaptive capacity** เปิดอยู่ตลอด ในทั้งสอง capacity mode และไม่มีค่าใช้จ่ายเพิ่ม มันให้ throughput ของตารางกับ partition ที่ร้อนมากขึ้น ย้าย item ที่ถูกเข้าถึงบ่อยแยกออกจากกันเพื่อไม่ให้อยู่ partition เดียวกัน และหั่น item collection ที่ยุ่งเป็นช่วงตาม sort key ได้ แต่มันก็มีขีดจำกัด: partition เดียว (และเพราะฉะนั้น item เดียว) ยังได้มากสุด 3,000 read และ 1,000 write ต่อวินาที, collection ที่ write มาเรียงตาม sort key (อย่างวันที่ของ `GUEST`) หั่นแล้วไม่ช่วยอะไร และบนตารางที่มี LSI ทุก item collection จะอยู่ใน partition เดียว ทางแก้อยู่ที่ key:

- เลือก partition key ที่มีค่าไม่ซ้ำกันเยอะ ๆ ให้ traffic กระจายไปทุก partition: ใช้ id จริงของ guest แต่ละคนแทน `GUEST`
- **Write sharding:** ต่อท้าย key ด้วย suffix จะสุ่มก็ได้ (`GUEST#0` … `GUEST#9`) หรือคำนวณจากสิ่งที่ใช้ค้นหา item ก็ได้ (hash ของ order id) แล้วอ่านกลับมาให้ครบทุก suffix ด้วย query แบบขนาน
- ใช้ [CloudWatch](../amazon-cloudwatch/) Contributor Insights ดูว่า item ไหนถูกเข้าถึงบ่อยที่สุดและโดน throttle มากที่สุด

### Time to live

เปิด TTL บน attribute ประเภท Number ที่เก็บเวลาหมดอายุเป็น Unix epoch seconds แล้ว DynamoDB ก็จะลบ item ที่หมดอายุอยู่เบื้องหลัง ปกติภายในไม่กี่วันหลังเวลาหมดอายุ และไม่ใช้ write unit ส่วนระหว่างนั้นการอ่านก็ยังอาจได้ item พวกนั้นกลับมา เพราะฉะนั้นให้กรองด้วย attribute นี้ด้วย การลบจาก TTL จะโผล่ใน DynamoDB Streams เป็น service deletion ทำให้ consumer เก็บ archive ของที่หมดอายุไว้ได้

### Change data capture: Streams หรือ Kinesis

| | DynamoDB Streams | [Kinesis Data Streams](../amazon-kinesis-data-streams/) for DynamoDB |
|---|---|---|
| Retention | 24 ชั่วโมง | ได้ถึง 1 ปี |
| คนอ่าน | ได้ถึง 2 ตัวต่อ shard | ได้ถึง 5 ตัวต่อ shard หรือ 20 ถ้าใช้ enhanced fan-out |
| ลำดับและตัวซ้ำ | แต่ละ record โผล่ครั้งเดียวพอดี เรียงตามลำดับในแต่ละ item | อาจมีตัวซ้ำ เรียงด้วย timestamp ของ record |
| การ process | Lambda หรือ DynamoDB Streams Kinesis Adapter | Lambda, Managed Service for Apache Flink, Firehose, Glue streaming |

ถ้าใช้ DynamoDB stream เป็น event source ตัว Lambda จะ poll stream วินาทีละสี่ครั้ง แล้วเรียก function พร้อม batch ของ record ถ้า function พัง Lambda จะ retry batch นั้นจนกว่าจะสำเร็จหรือ record หมดอายุ consumer เลยต้อง idempotent ส่วน partial batch response ช่วยไม่ให้ record ที่สำเร็จไปแล้วถูก process ซ้ำ

### Global table

global table เก็บ replica ของตารางไว้ในหลาย Region และทุก replica รับ write ได้

- **Multi-Region eventual consistency (MREC)** เป็นค่าตั้งต้น มัน replicate การเปลี่ยนแปลงแบบ asynchronous ปกติภายในหนึ่งวินาที ถ้า item เดียวกันถูกแก้ในสอง Region พร้อมกัน การเปลี่ยนแปลงที่มี timestamp ภายในล่าสุดจะชนะ (last writer wins) และ transaction จะ atomic แค่ใน Region ที่มันรัน
- **Multi-Region strong consistency (MRSC)** copy ทุก write ไปอีก Region แบบ synchronous ก่อนจะตอบรับ ทำให้การอ่านแบบ strongly consistent ใน Region ไหนก็ได้ version ล่าสุด มันต้องใช้สาม Region พอดี (สาม replica หรือสอง replica กับหนึ่ง witness) จาก list ของ Region ที่รองรับ และ write กับการอ่านแบบ strong ก็ต้องจ่ายค่า round trip ข้าม Region ถ้า write ไปที่ item ที่อีก Region กำลังแก้อยู่ จะพังด้วย `ReplicatedWriteConflictException` และ retry ได้ และตาราง MRSC ไม่รองรับ transaction, TTL หรือ LSI

AWS ให้ SLA ด้าน availability 99.999% สำหรับ global table เทียบกับ 99.99% ของตารางใน Region เดียว

### Backup, export และ caching

- **Backup:** on-demand backup รวมถึง **point-in-time recovery** (PITR) ย้อนไปได้ทุกวินาทีในช่วง 1 ถึง 35 วันล่าสุด ตั้งด้วย `RecoveryPeriodInDays` การ restore จะสร้างตารางใหม่เสมอ
- **Export ไป [S3](../amazon-s3/):** export แบบเต็มหรือแบบ incremental จากข้อมูล PITR ในรูป DynamoDB JSON หรือ Amazon Ion โดยไม่ใช้ read capacity แล้ว Athena, Glue หรือ EMR ก็ query มันได้
- **DAX** (DynamoDB Accelerator) คือ in-memory cache ที่อยู่หน้าตาราง ตอบการอ่านแบบ eventually consistent ในระดับ microsecond แต่ไม่ช่วยโค้ดที่ต้องอ่านแบบ strongly consistent

### Single-table design

คู่มือ data modelling ของ AWS ให้ฐานไว้สองแบบ **Single-table design** เก็บ entity หลายประเภทไว้ในตารางเดียวภายใต้ชื่อ key กลาง ๆ (`pk = CUSTOMER#C-17` คู่กับ `sk = PROFILE` หรือ `sk = ORDER#2026-10-06#o-981`) ทำให้ `Query` ครั้งเดียวได้ลูกค้าพร้อม order ของเขา และมีตารางเดียวให้ดูแลเรื่อง security, monitor และ scale ส่วนที่ต้องแลกคือ learning curve ที่ชัน และ setting ที่ต้องใช้ร่วมกัน: backup policy เดียว, encryption key เดียว, table class เดียว และ stream เดียวที่พาการเปลี่ยนแปลงของทุก entity ส่วน **Multiple-table design** อ่านง่ายและปรับเปลี่ยนง่ายกว่า และก็พอแล้วถ้า entity แทบไม่ถูกดึงมาพร้อมกัน ไม่ว่าแบบไหน ให้เขียน access pattern ออกมาก่อนเลือก key

### จาก Dynamo (2007) สู่ DynamoDB

paper Dynamo ปี 2007 อธิบาย key-value store ภายในของ Amazon สำหรับตะกร้าสินค้า ที่แต่ละทีมรันกันเอง ดีไซน์ของมันไม่มี leader และสร้างมาให้รับ write ได้ตลอดเวลา: consistent hashing กับ virtual node, sloppy quorum กับ hinted handoff, vector clock ที่ reconcile conflict ตอนอ่าน, anti-entropy ด้วย Merkle tree และ membership แบบ gossip

DynamoDB ที่เปิดเป็น public service ตั้งแต่ปี 2012 เป็นคนละระบบกัน paper ของ USENIX ATC ปี 2022 อธิบายว่ามันเอา incremental scalability และ performance ที่คาดเดาได้ของ Dynamo มารวมกับการเป็น managed service, consistency และ table model ของ SimpleDB และนอกจากชื่อแล้วก็แทบไม่ได้เก็บ architecture ของ Dynamo ไว้เลย มันเป็น service แบบ multi-tenant ที่มี request router, metadata service ที่ map key ไปหา partition, replication group แบบมี leader ที่ใช้ Multi-Paxos สำหรับแต่ละ partition และ global admission control ที่ติดตามการใช้งานรวมของแต่ละตาราง ส่วน [Apache Cassandra](../cassandra/) ยังใกล้กับดีไซน์ Dynamo ดั้งเดิมมากกว่า: consistent hashing, gossip และ tunable consistency โดยใช้ timestamp แบบ last-write-wins แทน vector clock

## อยู่ตรงไหนใน solution

- **Solution:** back end ของเว็บและแอปมือถือแบบ serverless (API Gateway, Lambda และ DynamoDB อย่างใน diagram), ตะกร้าสินค้าและ user session ที่หมดอายุผ่าน TTL, idempotency record ที่ใช้ request id เป็น key, metadata store อย่าง product catalogue, registry ของอุปกรณ์ หรือ index ของ object ที่เก็บใน S3 และ key-value lookup ปริมาณสูงอย่าง profile, game state หรือ feature setting
- **Pattern ใน catalog นี้:** data store ของ back end แบบ [Serverless](../serverless/) ที่สร้างบน [AWS Lambda](../aws-lambda/), [Sharding](../sharding/) ที่ DynamoDB ทำให้เอง โดย route แต่ละ key แบบเดียวกับที่ [Hash Table](../hash-table/) เลือก bucket, [Change Data Capture](../change-data-capture/) ผ่าน Streams ที่ป้อน [Materialized View](../materialized-view/) อย่าง order-views และฝั่งอ่านของ [CQRS](../cqrs/), record ของ [Idempotent Consumer](../idempotent-consumer/) ที่เขียนด้วย conditional put และ [Claim Check](../claim-check/) สำหรับ payload ที่ใหญ่เกิน 400 KB โดยเก็บไว้ใน S3 แล้วเก็บ key ไว้ใน item
- **ของที่อยู่ข้าง ๆ บ่อย ๆ:** API Gateway, Lambda, Kinesis Data Streams, S3 และ Athena (export), Amazon OpenSearch Service (zero-ETL integration สำหรับ search), DAX, [IAM](../aws-iam/), KMS และ CloudWatch
- **Managed offering:** DynamoDB ก็คือ managed service อยู่แล้ว และรันได้แค่บน AWS ส่วน DynamoDB local เป็นเวอร์ชันที่ดาวน์โหลดมาใช้ตอน dev และเทสต์ ถ้าอยากได้ API ที่ย้ายไปที่อื่นได้ AWS ก็มี database ที่ compatible กับ Cassandra (Amazon Keyspaces) และกับ [MongoDB](../mongodb/) (Amazon DocumentDB) รวมถึง [PostgreSQL](../postgresql/) บน [Amazon RDS](../amazon-rds-aurora/) และ Aurora

## ใช้ตอนไหนดี

เลือก DynamoDB เมื่อ:

- รู้ access pattern แล้วและเป็นแบบอิง key (get ด้วย id, list ตามเจ้าของ, N ตัวล่าสุดตามเวลา) และอยากได้ latency เท่าเดิมไม่ว่า request rate จะเท่าไร
- สร้างบน Lambda และอยากได้ database ที่ไม่มี connection, server หรือการวางแผน capacity
- traffic พุ่งเป็นช่วง ๆ หรือยังไม่รู้ (on-demand) หรือใหญ่มาก
- ต้องเขียนได้ในหลาย Region พร้อมกัน (global table)

ให้มองหาตัวอื่นเมื่อ query เป็นแบบ ad hoc หรือ relational (join, report, filter ที่ยืดหยุ่น), เมื่อแอปต้องรันนอก AWS หรือเมื่อ entity ตัวเดียวโตเกิน 400 KB และแบ่งไม่ได้

| | Amazon DynamoDB | Apache Cassandra | MongoDB | PostgreSQL / Aurora |
|---|---|---|---|---|
| Data model | item ใต้ partition key และ sort key (ถ้ามี) | row ใต้ partition key และ clustering column (CQL) | document แบบ JSON ใน collection | relational table (SQL) |
| Query | ตาม key และช่วงของ sort key บวก secondary index ไม่มี join | ตาม partition key และช่วงของ clustering ใช้ secondary index สำหรับการค้นหาแบบอื่น | query แบบ ad hoc, secondary index, aggregation pipeline | SQL แบบ ad hoc ที่มี join และ index หลายประเภท |
| Consistency | eventual เป็นค่าตั้งต้น ขออ่านแบบ strongly consistent ได้ ส่วน transaction ได้ถึง 100 item | ปรับได้ทีละ request (`ONE`, `QUORUM`, `ALL` …) และใช้ last write wins | primary หนึ่งตัวต่อ replica set รับ write มี multi-document transaction | ACID transaction บน primary |
| Scaling | เพิ่ม partition ให้อัตโนมัติ ส่วน throughput เป็นแบบ on-demand หรือ provisioned | เพิ่ม node เข้า ring | shard collection ด้วย shard key | scale up และเพิ่ม read replica (Aurora: ได้ถึง 15 ตัว บน storage ที่ copy ข้าม 3 AZ) |
| รันแบบ | AWS service แบบ fully managed เท่านั้น | ดูแลเอง หรือ Amazon Keyspaces | ดูแลเอง, MongoDB Atlas หรือ Amazon DocumentDB (compatible) | ดูแลเอง หรือ Amazon RDS และ Aurora |
| License (ตุลาคม 2026) | service แบบ proprietary | Apache License 2.0 | Server Side Public License v1 สำหรับ release ตั้งแต่ตุลาคม 2018 | PostgreSQL License ส่วน Aurora เป็น proprietary |

## ได้อะไร เสียอะไร

- **access pattern มาก่อน** key ถูกออกแบบมาสำหรับคำถามที่เรารู้ ถ้ามีคำถามใหม่ก็ต้องเพิ่ม GSI (ที่ต้อง backfill และมีค่า write ของตัวเอง) หรือปรับรูปข้อมูลใหม่
- **ไม่มี join หรือ query แบบ ad hoc** งาน analytics ต้องไปที่ S3 ผ่าน export หรือไปที่ service ด้าน search หรือ analytics ผ่าน stream หรือ zero-ETL integration
- **เพดานต่อ partition** hot key โดน throttle ที่ 3,000 read หรือ 1,000 write ต่อวินาทีต่อ partition ไม่ว่าตารางจะมี throughput เท่าไร
- **consistency เป็นทางเลือกที่ต้องจ่าย** การอ่านเป็นแบบ eventual เป็นค่าตั้งต้น การอ่านแบบ strong แพงสองเท่าและไม่มีบน GSI และ global table แบบ MREC ตัดสิน conflict แบบ last writer wins
- **ขนาด item** 400 KB ต่อ item ส่วน payload ใหญ่ ๆ ให้เก็บใน S3
- **รูปแบบต้นทุน** ทุก GSI เพิ่มค่า write และ operation แบบ strongly consistent และแบบ transaction ก็แพงกว่า ตั้งแต่ลดราคาเมื่อพฤศจิกายน 2024 ทาง AWS คาดว่า on-demand จะถูกกว่า provisioned สำหรับ workload ส่วนใหญ่ แต่ถ้าเป็นตารางที่ traffic นิ่งมากและใช้เต็มที่ ให้ลองคิดราคาทั้งสองแบบ
- **Lock-in** API และพฤติกรรมของมันมีแค่บน AWS ส่วน DynamoDB local ช่วยเรื่องเทสต์ แต่ไม่ช่วยเรื่องย้ายที่

## ข้อควรรู้ตอนลงมือทำ

- เขียน access pattern ออกมาก่อน แล้วค่อยเลือก key ถ้าจะให้ entity หลายประเภทใช้ตารางเดียวกัน ให้ใช้ชื่อ attribute กลาง ๆ (`pk`, `sk`)
- อย่าให้ `Scan` อยู่ในเส้นทางของ request: ใช้ `Query`, ตาม `LastEvaluatedKey` ไปจนครบ และ project เฉพาะ attribute ที่ GSI แต่ละตัวต้องใช้
- ทำ write ให้ retry ได้อย่างปลอดภัย: conditional put สำหรับ idempotency, attribute `version` สำหรับ optimistic locking และ `ClientRequestToken` บน transaction
- คอยดูการโดน throttle: ตั้ง alarm ที่ request ที่โดน throttle, อ่าน `ThrottlingReasons` ใน exception, ใช้ Contributor Insights หา hot key และให้ SDK retry พร้อม backoff
- เปิด PITR ให้ทุกตารางที่สร้างใหม่ไม่ได้ ตั้ง TTL ให้ตะกร้า, session และ idempotency record และเลือก stream view type ที่ consumer ต้องใช้ (`NEW_IMAGE` หรือ `NEW_AND_OLD_IMAGES` ถ้าอยากเห็นว่าอะไรเปลี่ยน)
- ทำ stream consumer ให้ idempotent: Lambda จะ retry batch ที่พังจนกว่าจะสำเร็จหรือ record หมดอายุ
