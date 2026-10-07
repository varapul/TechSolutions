## ปัญหา

Acme Shop อยากเห็นว่าคนซื้อทำอะไรอยู่ระหว่างที่เขายังทำอยู่ ทุก page view ทุกการค้นหา และทุกการกด add-to-cart ใน web shop และ mobile app จะกลายเป็น click event ประมาณ 2,000 ครั้งต่อวินาทีในช่วงที่ยุ่ง และราว 1 KB ต่อตัว หลายทีมต้องการ event ชุดเดียวกัน: dashboard แบบ live ต้องการ conversion rate และ error rate ภายในไม่กี่วินาที ทีม data อยากได้ทุกคลิกใน data lake บน S3 และ stream-processing job ก็จัดกลุ่มคลิกเป็น session เพื่อหา bot และตะกร้าที่ถูกทิ้ง พอ job นี้ได้ bug fix แล้ว ทีมของมันก็จะอยากรันมันกับคลิกของ 7 วันที่ผ่านมาอีกรอบ

การเรียก consumer แต่ละตัวจาก web server ทำให้ร้านผูกติดกับความเร็วและ uptime ของ consumer ทุกตัว ส่วน queue ส่ง message แต่ละตัวให้ consumer ตัวเดียวแล้วลบทิ้ง ทำให้ reader ทุกตัวต้องมีสำเนาของตัวเอง และไม่มีใครย้อนเวลากลับไปได้ การเขียนคลิกลง table ใน database แค่เพื่อ scan มันออกมาอีกที ก็แพงเกินไปที่อัตรานี้ สิ่งที่เหมาะคือ log: เขียนแต่ละ event ครั้งเดียว ให้ reader ทุกตัวไล่อ่านตามจังหวะของตัวเอง และเก็บไว้สักพัก

Amazon Kinesis Data Streams คือ log แบบ managed ประเภทนั้นของ AWS ตัว stream แบ่งเป็น shard: producer เพิ่ม record ผ่าน HTTPS API ส่วน consumer อ่านแต่ละ shard ตามลำดับ และ record จะอยู่ไปตาม retention period (default 24 ชั่วโมง และได้ถึง 365 วัน) ไม่ว่าจะมีใครอ่านแล้วหรือยัง ตัว AWS ดูแล server ให้และ replicate ทุก record แบบ synchronous ข้ามสาม Availability Zone ส่วน Acme ยังต้องตัดสินใจเองว่าจะซื้อ capacity เท่าไร จะแบ่ง partition ด้วย key ไหน และจะเก็บข้อมูลไว้นานแค่ไหน

## ทำงานยังไง

### Stream, shard และ record

- **stream** คือชุดของ **shard** และ shard หนึ่งเป็นทั้งลำดับของ record ที่เรียงกัน และเป็นหน่วยของ capacity ในโหมด provisioned แต่ละ shard รับ write ได้ถึง **1 MB/s หรือ 1,000 record ต่อวินาที** (นับ partition key ด้วย) และให้ read ได้ถึง **2 MB/s** ผ่าน **`GetRecords` ไม่เกิน 5 call ต่อวินาที** ตัว stream `clicks` ของ Acme มี 4 shard: ขาเข้า 4 MB/s หรือ 4,000 record ต่อวินาที ขาออก 8 MB/s แล้ว 2,000 คลิกต่อวินาทีของมันก็ใช้ไปครึ่งหนึ่ง
- **record** ประกอบด้วย partition key, data blob และ sequence number ตัว Kinesis ไม่เคยดูข้างใน blob ส่วนขนาดของ record โดย default ใหญ่ได้ไม่เกิน 1 MiB และตั้งแต่ตุลาคม 2025 ก็ตั้งค่า stream ให้รับ record ได้ถึง 10 MiB (`UpdateMaxRecordSize`) ตัว record ใหญ่ ๆ จะยืม burst capacity จาก shard ของมัน โดยที่ limit ของ shard ยังเท่าเดิม AWS เลยตั้งใจให้ใช้กับ payload ที่มีเป็นครั้งคราว และแนะนำให้มีไม่เกิน 2% ของ traffic
- shard มี ID อย่าง `shardId-000000000001` ส่วน diagram เรียก shard สี่ตัวของ Acme ว่า 0 ถึง 3 ส่วนปกติแล้ว record จะอ่านได้ภายในไม่ถึงวินาทีหลังถูกเขียน

### Partition key, hash key และ sequence number

ทุก record มี **partition key** ติดมา เป็น Unicode string ยาวไม่เกิน 256 ตัวอักษร Kinesis คำนวณ MD5 digest ของ key แล้วอ่านเป็น unsigned integer ขนาด 128-bit เรียกว่า **hash key** แต่ละ shard ที่เปิดอยู่เป็นเจ้าของ **hash key range** ที่ต่อเนื่องกัน และ range ทั้งหมดรวมกันครอบคลุมทุกค่าตั้งแต่ 0 ถึง 2^128 − 1 ตัว stream ใหม่จะแบ่งพื้นที่นี้เท่า ๆ กัน ทำให้ shard ทั้ง 4 ตัวของ Acme ได้คนละหนึ่งในสี่ แล้ว record ก็ไปที่ shard ที่ range ของมันมี hash key ของ record นั้น ทุก record ที่มี key เดียวกันเลยไปลง shard เดียวกัน ถ้า producer อยากเลือก shard เอง ก็ส่ง `ExplicitHashKey` แทน

ตัวเลขใน animation เป็นของจริง MD5 ของ `s-41` ขึ้นต้นด้วย `6e19676a` ที่อยู่ในหนึ่งในสี่ส่วนที่สอง ทำให้ session s-41 ไปลง shard 1 เสมอ ส่วน session ของ scraper คือ `s-90` (`b772d1fa…`) ไปลง shard 2:

```python
import hashlib

def hash_key(partition_key: str) -> int:
    # Kinesis reads the MD5 digest of the key as a 128-bit unsigned integer
    return int.from_bytes(hashlib.md5(partition_key.encode("utf-8")).digest(), "big")

def shard_of(partition_key: str, shards: int = 4) -> int:
    # valid while the shards split the key space evenly, as after CreateStream
    return hash_key(partition_key) * shards >> 128

for key in ["s-41", "s-90"]:
    print(key, f"{hash_key(key):032x}"[:8], shard_of(key))
# s-41 6e19676a 1
# s-90 b772d1fa 2
```

`list-shards` รายงาน range เป็นเลขฐานสิบ:

```sh
aws kinesis list-shards --stream-name clicks --output text \
  --query 'Shards[].[ShardId, HashKeyRange.StartingHashKey, HashKeyRange.EndingHashKey]'
# shardId-000000000000  0                                        85070591730234615865843651857942052863
# shardId-000000000001  85070591730234615865843651857942052864   170141183460469231731687303715884105727
# shardId-000000000002  170141183460469231731687303715884105728  255211775190703847597530955573826158591
# shardId-000000000003  255211775190703847597530955573826158592  340282366920938463463374607431768211455
```

เมื่อ shard เก็บ record มันจะให้ **sequence number** เป็น string ตัวเลขฐานสิบยาว ๆ ที่เพิ่มขึ้นตามเวลาภายใน shard และคำตอบของ `PutRecord` หรือ `PutRecords` ก็ส่งมันกลับมาพร้อม shard ID ส่วน sequence number ต่างจาก offset ของ Kafka ตรงที่มันไม่ได้ต่อเนื่องกัน: มันใช้เป็นตำแหน่ง ("เริ่มหลัง record นี้") ไม่ใช่ตัวนับจำนวน record ส่วน diagram ย่อมันเหลือสามหลัก

### Capacity mode

- **Provisioned** เราเลือกจำนวน shard เอง และจ่ายต่อ shard-hour ไม่ว่า shard จะยุ่งหรือไม่ บวกค่าต่อข้อมูลที่เขียนทุก 25 KB เรา scale ด้วย `UpdateShardCount` หรือด้วยการ split และ merge ทีละ shard (ดูด้านล่าง) AWS แนะนำโหมดนี้สำหรับ traffic ที่คาดเดาได้ และเมื่ออยากควบคุมว่า hash key ไหนไปที่ shard ไหน กฎการคำนวณขนาดของมันคือเอาค่าที่มากกว่าระหว่างอัตรา write หารด้วย 1 MB/s กับอัตรา read ของ consumer ทุกตัวรวมกันหารด้วย 2 MB/s
- **On-demand Standard** เราไม่ต้องตั้งจำนวน shard ตัว stream ใหม่รับ write ได้ 4 MB/s จากนั้น Kinesis จะเพิ่ม shard ให้ stream รับได้สองเท่าของอัตรา write สูงสุดใน 30 วันที่ผ่านมา และ split shard ภายในประมาณ 15 นาทีเมื่อมันรับเกิน 500 KB/s ส่วน traffic ที่โตเกินสองเท่าของ peak ก่อนหน้าภายใน 15 นาทีก็ยังโดน throttle ได้ จนกว่า stream จะตามทัน ส่วนเพดานของ stream หนึ่งคือ write 10 GB/s และ read 20 GB/s ใน US East (N. Virginia), US West (Oregon) และ Europe (Ireland) และ 200 MB/s กับ 400 MB/s ใน Region อื่น เว้นแต่ AWS Support จะเพิ่มให้ และ account หนึ่งมี on-demand stream ได้ 50 ตัวโดย default เราจ่ายต่อ GB ที่เขียนและอ่าน บวกค่าคงที่ต่อ stream-hour
- **On-demand Advantage** (พฤศจิกายน 2025) เป็นการตั้งค่าสำหรับ on-demand stream ทุกตัวของ account ใน Region หนึ่ง มันตัดค่าต่อ stream ออก ทำให้ write, read และ retention ที่ยาวขึ้นถูกลงอย่างน้อย 60% ต่อ GB คิดค่า read แบบ enhanced fan-out เท่ากับ read ธรรมดา เพิ่มจำนวน enhanced fan-out consumer ต่อ stream จาก 20 เป็น 50 (ใน Region ที่เอกสารระบุ) และให้ตั้ง **warm throughput** เพื่อให้ stream พร้อมรับ burst ก่อนที่มันจะมาถึง และตั้งแต่กรกฎาคม 2026 warm throughput ก็ใช้หด stream กลับได้ด้วย ส่วนสิ่งที่ต้องแลกคือ account ต้อง commit ว่าจะใช้ write อย่างน้อย 25 MB/s และ read 25 MB/s รวมทุก on-demand stream ถ้าใช้น้อยกว่านั้นก็จะถูกเก็บเงินส่วนที่ขาด และการตั้งค่านี้ปิดไม่ได้ภายใน 24 ชั่วโมงหลังเปิด AWS วางมันไว้สำหรับ account ที่เขียนอย่างน้อย 10 MB/s, fan out ไปหาแอป consumer มากกว่าสองตัว หรือรัน stream จำนวนมาก
- stream สลับระหว่าง provisioned กับ on-demand ได้สองครั้งใน 24 ชั่วโมง โดยไม่ขัดจังหวะ producer หรือ consumer มันยังเก็บ shard เดิมไว้ และจากนั้นก็เป็นเราหรือ Kinesis ที่ดูแล shard พวกนั้น
- **Service-managed partition key** (กันยายน 2026) เป็นการตั้งค่าสำหรับ on-demand stream: ถ้าใช้ record distribution strategy แบบ `AUTO` แทน `USER_PARTITION_KEY` ที่เป็น default ตัว Kinesis จะไม่สน partition key และกระจาย record ไปบน shard เอง โดยไม่คิดเงินเพิ่ม ทำให้ hot key หายไป แต่ลำดับก็หายไปด้วย AWS แนะนำให้ใช้กับ log, metric, telemetry และ clickstream ที่ไม่ต้องการลำดับ และให้คง partition key ไว้สำหรับ change data capture, transaction ต่อ account และ session analytics ส่วน Flink job ของ Acme สร้าง session มันเลยใช้ session ID เป็น key ต่อไป

### การเขียน record

- `PutRecord` เขียน record หนึ่งตัว ส่วน `PutRecords` เขียนได้ถึง 500 record ใน request ขนาดไม่เกิน 10 MiB รวม partition key (ก่อนตุลาคม 2025 คือ 5 MiB) และ record ในนั้นไปคนละ shard ได้
- `PutRecords` ไม่ใช่แบบ all-or-nothing คำตอบของมันลิสต์ทุก record ตามลำดับใน request โดยแต่ละตัวมี `ShardId` กับ `SequenceNumber` หรือไม่ก็ `ErrorCode` (`ProvisionedThroughputExceededException` หรือ `InternalFailure`) และ `FailedRecordCount` บอกว่ามีกี่ตัวที่ fail ส่วน producer ที่ไม่ส่ง record ที่ fail ซ้ำ (ด้วย exponential backoff) ก็จะเสีย record พวกนั้นไป และเพราะ record แต่ละตัวถูกจัดการแยกกัน `PutRecords` เลยไม่สัญญาว่าจะรักษาลำดับของ request ไว้ ถ้า producer ต้องการลำดับที่เคร่งครัดสำหรับ key หนึ่ง ก็ต้องส่ง `PutRecord` ทีละตัว แล้วส่ง sequence number ของ record ก่อนหน้าไปใน `SequenceNumberForOrdering`
- การ retry จะเขียนซ้ำ ถ้า call หนึ่ง timeout หลังจากที่ Kinesis เก็บ record ไปแล้ว การ retry ก็จะเก็บมันอีกครั้งภายใต้ sequence number ใหม่ ส่วน Acme ให้ทุกคลิกมี `clickId` เพื่อให้ reader ทิ้งตัวที่ซ้ำได้
- **Kinesis Producer Library (KPL)** เป็น Java library ที่ทำ batch, retry และ rate-limit ให้ มันยัง **aggregate** user record เล็ก ๆ หลายตัวรวมเป็น Kinesis record ตัวเดียวได้ด้วย เรื่องนี้สำคัญเมื่อ record เล็กกว่า 1 KB เพราะตอนนั้น 1,000 record ต่อวินาทีต่อ shard จะเป็น limit ที่ชนก่อน ส่วน reader ต้องแกะมันออกอีกที: KCL แกะให้เอง ตัว Firehose แกะให้อัตโนมัติ และ Lambda function ใช้ de-aggregation module ของ AWS ตัว KPL 1.x (ธันวาคม 2024) สร้างบน AWS SDK for Java 2.x ส่วน KPL 0.x หมด support ไปเมื่อ 30 มกราคม 2026 และ aggregation ใช้กับ service-managed partition key ไม่ได้
- AWS service ก็เขียนลง stream ได้: Kinesis Agent คอย tail log file ส่วน [CloudWatch](../amazon-cloudwatch/) Logs, AWS IoT Core, EventBridge, CloudFront real-time log และ DynamoDB (ดูหัวข้ออยู่ตรงไหนใน solution) ก็ส่งเข้า stream ได้

จาก CLI โดยมี record อยู่ในไฟล์ (`raw-in-base64-out` ส่งข้อมูลตามที่เขียนไว้ แทนที่จะคาดหวังว่าเป็น base64):

```sh
aws kinesis put-records --stream-name clicks \
  --cli-binary-format raw-in-base64-out --records file://clicks.json
```

```json
[
  { "Data": "{\"clickId\":\"c-90211\",\"page\":\"/cart\"}", "PartitionKey": "s-41" }
]
```

### การอ่าน: shared throughput หรือ enhanced fan-out

- consumer แบบ **shared-throughput** (แบบ default) ขอจุดเริ่มต้นจาก `GetShardIterator`: record ที่เก่าที่สุดที่ยังเก็บอยู่ (`TRIM_HORIZON`) ตัวใหม่สุด (`LATEST`) sequence number (`AT_SEQUENCE_NUMBER`, `AFTER_SEQUENCE_NUMBER`) หรือเวลา (`AT_TIMESTAMP`) จากนั้นก็เรียก `GetRecords` วนไป โดย call หนึ่งคืนได้ถึง 10,000 record หรือ 10 MB และ iterator หมดอายุหลัง 5 นาที consumer แบบนี้ทุกตัวของ shard หนึ่งแชร์ 5 call และ 2 MB ต่อวินาทีของ shard นั้นกัน และหลัง call ที่คืน 10 MB ตัว call ใน 5 วินาทีถัดไปจะโดน throttle ส่วน AWS ให้ตัวเลข delay เฉลี่ยจาก write ถึง read ไว้ที่ประมาณ 200 ms ถ้ามี consumer ตัวเดียว และขึ้นไปถึงประมาณ 1 วินาทีถ้ามีห้าตัว
- consumer แบบ **enhanced fan-out** (EFO) ต้อง register บน stream ด้วย `RegisterStreamConsumer` มันเรียก `SubscribeToShard` แล้ว Kinesis ก็ push record ไปให้ผ่าน HTTP/2 connection ได้นานสุด 5 นาที หลังจากนั้น consumer ก็ subscribe ใหม่ ตัว consumer ที่ register แต่ละตัวได้ 2 MB/s ต่อ shard เป็นของตัวเอง ไม่ว่าตัวอื่นจะทำอะไร โดยมี delay ปกติประมาณ 70 ms ตัว stream หนึ่งมี consumer ที่ register ได้ 20 ตัว หรือ 50 ตัวถ้าใช้ On-demand Advantage ส่วนในโหมด provisioned ตัว EFO มีค่าใช้จ่ายเพิ่มต่อ consumer-shard hour และต่อ GB ที่อ่าน
- สำหรับ on-demand stream AWS แนะนำให้มีแอปแบบ shared-throughput แค่ตัวเดียว เพื่อให้มันมีที่ว่างพอจะตามทันหลังระบบล่ม และให้ใช้ enhanced fan-out กับแอปตัวอื่นทุกตัว

### Consumer ที่ใช้กันบ่อย

- **AWS Lambda** ตัว event source mapping จะ poll แต่ละ shard ประมาณวินาทีละครั้ง (แชร์กับตัวที่ poll อื่น) หรืออ่านผ่าน EFO consumer แล้ว invoke function แบบ synchronous ด้วย batch จาก shard เดียว: default 100 record และได้ถึง 10,000 รวบรวมไว้นานสุด `MaximumBatchingWindowInSeconds` (สูงสุด 300) และ payload ไม่เกิน 6 MB มันทำงานทีละ batch ต่อ shard ตามลำดับ ส่วน `ParallelizationFactor` (1 ถึง 10) รันหลาย batch ของ shard เดียวพร้อมกันได้ โดยที่ยังรักษาลำดับของ record ในแต่ละ partition key ไว้ ให้เริ่ม mapping ใหม่ที่ `TRIM_HORIZON` เพราะถ้าใช้ `LATEST` ตัว mapping อาจพลาด record ที่ถูกเขียนระหว่างที่มันกำลังถูกสร้างหรือ update
- เมื่อ function fail ตัว Lambda จะ retry batch นั้นโดย default ไปจนกว่า record ของมันจะหมดอายุจาก stream และส่วนที่เหลือของ shard ก็ต้องรอข้างหลัง ให้จำกัดมันด้วย `MaximumRetryAttempts` และ `MaximumRecordAgeInSeconds` ให้ `BisectBatchOnFunctionError` ผ่า batch ที่ fail เป็นสองส่วน (ไม่นับเป็น retry) เพื่อไล่ต้อน record ที่เสีย และส่งสิ่งที่ยอมแพ้ไปแล้วไปที่ on-failure destination (SQS queue, SNS topic หรือ S3 bucket) ถ้าใช้ `ReportBatchItemFailures` ตัว function จะคืน sequence number ของ record ตัวแรกที่มันประมวลผลไม่ได้ แล้ว Lambda ก็ retry จากตรงนั้น แทนที่จะเริ่มใหม่ตั้งแต่ต้น batch ส่วนการส่งเป็นแบบ at least once ทำให้ function ต้อง idempotent

```sh
aws lambda create-event-source-mapping --function-name live-metrics \
  --event-source-arn arn:aws:kinesis:us-east-1:111122223333:stream/clicks \
  --starting-position TRIM_HORIZON --batch-size 100 --parallelization-factor 2 \
  --bisect-batch-on-function-error --maximum-retry-attempts 3 \
  --maximum-record-age-in-seconds 3600 --function-response-types ReportBatchItemFailures \
  --destination-config '{"OnFailure":{"Destination":"arn:aws:sqs:us-east-1:111122223333:live-metrics-failed"}}'
```

- **Amazon Data Firehose** (ชื่อเดิมคือ Kinesis Data Firehose จนถึงกุมภาพันธ์ 2024) อ่าน stream จาก `LATEST` ด้วย `GetRecords` วินาทีละครั้งต่อ shard (สองครั้งถ้าเปิด full backup) และนับรวมใน shared limit ของ shard เหมือนตัว poll อื่น ๆ มัน de-aggregate KPL record แล้ว buffer ไว้ตามปลายทาง (สำหรับ S3 คือ 1 ถึง 128 MiB และ 0 ถึง 900 วินาที default คือ 5 MiB และ 300 s แล้วแต่อย่างไหนถึงก่อน) แล้วค่อยเขียน object ออกไป มันยังแปลง record เป็น Parquet หรือ ORC และแบ่ง partition ตามเนื้อหาได้ด้วย ถ้า source เป็น stream ตัว Firehose จะ retry การส่งไป S3 ที่ fail ไปเรื่อย ๆ ตราบที่ stream ยังเก็บ record นั้นอยู่
- **Amazon Managed Service for Apache Flink** (ชื่อเดิมคือ Kinesis Data Analytics จนถึงสิงหาคม 2023) รันแอป [Apache Flink](../flink/) ตัว Kinesis source ของ Flink ใช้การ poll โดย default ถ้าตั้ง reader type เป็น `EFO` และตั้งชื่อ consumer ให้ ตัว connector ก็จะ register consumer นั้นแล้วอ่านผ่านมัน ตัว Flink เองเก็บตำแหน่งใน shard ไว้ใน checkpoint ของตัวเอง ไม่ได้เก็บใน Kinesis หรือ DynamoDB ทำให้หลัง failure มัน restore state และตำแหน่งพร้อมกัน และมันอ่าน parent shard จนจบก่อนจะอ่าน child shard
- แอปที่ใช้ **Kinesis Client Library (KCL)** รันได้บน EC2, ECS, EKS หรือที่ไหนก็ได้ KCL เป็น Java library (ภาษาอื่นใช้ผ่าน MultiLangDaemon ของมัน) ที่ให้แต่ละ shard กับ worker ตัวเดียวภายใต้ **lease** และเก็บ **checkpoint** ของแต่ละ lease (ตำแหน่งของ record ตัวสุดท้ายที่ประมวลผลแล้ว) ไว้ใน **lease table** บน DynamoDB ที่ตั้งชื่อตามแอป ส่วน KCL 3.x (พฤศจิกายน 2024) เพิ่ม table สำหรับ worker metric และ table สำหรับ coordinator state และย้าย lease ออกจาก worker ที่ CPU ยุ่งที่สุด แล้วตั้งแต่ KCL 3.5 ทั้งสาม table ก็อยู่รวมใน table เดียวได้ ตัว consumer ที่สร้างด้วย KCL 2.0 ขึ้นไปใช้ enhanced fan-out โดย default ส่วน KCL 1.x หมด support ไปเมื่อ 30 มกราคม 2026
- ตั้งแต่สิงหาคม 2026 Kinesis ยังส่ง stream ไปที่ S3 bucket แบบ general-purpose ในรูปแบบตามต้นทาง หรือไปที่ Apache Iceberg table ใน Amazon S3 Tables (*streaming tables*) ได้เอง โดยไม่ต้องรัน consumer ใด ๆ ทั้งสองแบบต้องใช้ on-demand stream และคิดเงินต่อ GB ที่ส่ง นอกจากนี้ EventBridge Pipes, AWS Glue streaming job, Spark บน Amazon EMR, Amazon Redshift streaming ingestion และ Amazon OpenSearch Ingestion ก็อ่าน stream ได้เหมือนกัน

### ลำดับและการซ้ำ

- **ลำดับรับประกันภายใน shard** record ที่มี partition key เดียวกันไปที่ shard เดียวกัน และ reader ทุกตัวเห็น record ของ shard หนึ่งตามลำดับ sequence number ส่วนข้าม shard ไม่มีลำดับ ลำดับยังหายได้ตอนขาเข้า: `PutRecords` ไม่รักษาลำดับของ request และ record ที่ถูก retry จะไปลงหลัง record ที่ส่งมาในระหว่างนั้น
- **resharding รักษาลำดับได้ก็ต่อเมื่อ reader ร่วมมือ** หลัง split หรือ merge ตัว shard เก่า (parent) จะเลิกรับ write แต่ยังเก็บ record ของมันไว้ ทำให้ reader ต้องอ่าน parent ให้จบก่อนจะเริ่มอ่าน child ตัว KCL, Lambda และ connector ของ Flink ทำแบบนี้
- **การส่งเป็นแบบ at least once ทั้งสองฝั่ง** การ retry ของ producer เก็บข้อมูลเดียวกันสองครั้งภายใต้ sequence number สองตัว และ consumer ก็เห็น record ซ้ำหลัง restart, deploy, lease ย้ายไปอยู่กับ worker อื่น, reshard หรือ batch ที่ถูก retry ส่วน AWS ก็บอกว่าการ retry ฝั่ง consumer เป็นต้นเหตุของการซ้ำส่วนใหญ่ ให้ใส่ ID ที่ไม่ซ้ำไว้ในแต่ละ record และทำ consumer ให้ [idempotent](../idempotent-consumer/)
- การเปลี่ยนแปลงของ item ที่ DynamoDB เขียนลง stream ก็มาไม่เรียงลำดับและมาซ้ำได้เหมือนกัน attribute `ApproximateCreationDateTime` ของมันบอกลำดับจริงและทำให้เห็นตัวที่ซ้ำ

### Resharding, hot shard และ hot key

- `SplitShard` แบ่ง hash key range ของ shard หนึ่งเป็นสองส่วนที่ hash key ที่เราเลือก ส่วน `MergeShards` รวม shard สองตัวที่ range อยู่ติดกัน แต่ละ operation ทำกับ shard หนึ่งหรือสองตัว ตัว parent shard จะกลายเป็น `CLOSED` (ไม่รับ record ใหม่ แต่ตัวเก่ายังอ่านได้) แล้วกลายเป็น `EXPIRED` เมื่อพ้น retention period ไปแล้ว ส่วน child ได้ shard ID ใหม่
- `UpdateShardCount` ปรับขนาด provisioned stream แบบเท่า ๆ กัน (`UNIFORM_SCALING`) โดยทำ split และ merge ให้ ส่วนโดย default stream หนึ่ง scale ได้ 10 ครั้งในช่วง 24 ชั่วโมงแบบ rolling แต่ละ call ได้สูงสุดสองเท่าหรือต่ำสุดครึ่งหนึ่งของจำนวน shard ปัจจุบัน และไม่เกิน 10,000 shard ส่วน AWS แนะนำให้ตั้งเป้าเป็นขั้นละ 25% ของจำนวนปัจจุบัน เพราะจะเสร็จเร็วกว่า
- **hot shard** คือ shard ที่รับเกินส่วนของตัวเอง AWS แนะนำให้หามันด้วย shard-level metric หรือด้วยการ log shard ID ที่ทุก put ส่งกลับมา แล้ว split แค่ shard นั้น ส่วน Acme ก็ split shard 2 ที่กลาง range ของมัน ทำให้ key ของ bot ไปอยู่ใน child shard ที่ได้ traffic ปกติของ shard 2 ไปครึ่งหนึ่ง: 250 + 600 = 850 record ต่อวินาที ต่ำกว่า limit

```sh
aws kinesis split-shard --stream-name clicks \
  --shard-to-split shardId-000000000002 \
  --new-starting-hash-key 212676479325586539664609129644855132160   # 2^127 + 2^125, hex a000…
```

- **hot key** split ไม่ได้ ตัว key หนึ่งมี hash key ตัวเดียว เลยอยู่ใน shard เดียว ที่ไม่มีวันรับเกิน 1 MB/s หรือ 1,000 record ต่อวินาที ไม่ว่าจะใช้ capacity mode ไหน โหมด on-demand split shard ที่ยุ่งก็จริง แต่ไม่ได้แยก key ที่อยู่ข้างใน วิธีแก้คือเปลี่ยน key (เช่น session ID บวก suffix สำหรับผู้ส่งที่รู้ว่าส่งหนัก โดยยอมทิ้งลำดับของพวกนั้น) หยุดต้นทาง หรือใช้ service-managed partition key กับ stream ที่ไม่ต้องการลำดับ

### Retention

- record อยู่ 24 ชั่วโมงโดย default ตัว `IncreaseStreamRetentionPeriod` ขยายช่วงนี้ได้ถึง 8,760 ชั่วโมง (365 วัน) และ record ที่ยังไม่หมดอายุก็อยู่ต่อ ส่วน `DecreaseStreamRetentionPeriod` ลดลงได้ไม่ต่ำกว่า 24 ชั่วโมง และทำให้ record ที่เก่ากว่านั้นอ่านไม่ได้แทบจะทันที
- Acme เก็บไว้ 7 วัน ทำให้ Flink job ที่แก้แล้ว replay ย้อนหลังได้ทั้ง 7 วัน:

```sh
aws kinesis increase-stream-retention-period --stream-name clicks --retention-period-hours 168
```

- retention period ยังเป็น deadline ของ reader ที่ค้างอยู่ด้วย: อะไรที่มันยังไม่ได้อ่านถึงตอนนั้นก็หายไป AWS แนะนำให้ตั้ง alarm บนค่าสูงสุดของ `GetRecords.IteratorAgeMilliseconds` ให้ดังตั้งแต่ก่อนที่มันจะไปถึงครึ่งหนึ่งของ retention period นาน ๆ

### Encryption และสิทธิ์การเข้าถึง

- server-side encryption ใช้ AWS KMS key: จะเป็น AWS managed key `aws/kinesis` ที่ไม่มีค่าใช้จ่าย (แต่ call ที่ Kinesis เรียก KMS ยังคิดเงิน) หรือ customer managed key ที่ producer และ consumer ต้องได้สิทธิ์ใช้ก็ได้ มันมีผลกับ record ที่เขียนหลังเปิดใช้ (`StartStreamEncryption`) ส่วน record ที่อยู่ใน stream แล้วก็ยังไม่ถูกเข้ารหัส
- client เชื่อมต่อผ่าน TLS (ต้องใช้ 1.2 และแนะนำ 1.3) ส่วน [IAM](../aws-iam/) policy แยก producer (`kinesis:PutRecord`, `kinesis:PutRecords`), consumer และ operator ที่ทำ reshard ออกจากกัน resource-based policy บน stream หรือ consumer ใช้แชร์มันกับอีก account ได้ เช่นแชร์ให้ Lambda function ที่อยู่ใน account นั้น แต่การแชร์ stream ที่เข้ารหัสแบบนี้ต้องใช้ customer managed key ส่วน interface VPC endpoint ทำให้ traffic อยู่ในเครือข่ายของ AWS (ดู [Private Endpoints](../private-endpoints/))

### Metric ที่ควรดู

- `IncomingBytes` และ `IncomingRecords` เทียบกับ limit ของ shard ส่วน `WriteProvisionedThroughputExceeded` และ `PutRecords.ThrottledRecords` ใช้ดู write ที่โดน throttle
- `GetRecords.IteratorAgeMilliseconds` คืออายุของ record ตัวสุดท้ายที่อ่านผ่าน `GetRecords` เป็นตัวบอกว่า reader แบบ poll ที่ช้าที่สุดตามหลังอยู่เท่าไร (Lambda รายงาน `IteratorAge` ของตัวเองต่อ function) ส่วน `SubscribeToShardEvent.MillisBehindLatest` ทำแบบเดียวกันสำหรับ reader แบบ enhanced fan-out และ `ReadProvisionedThroughputExceeded` นับ read ที่โดน throttle
- stream-level metric ใช้ฟรี ส่วน shard-level metric ที่บอกชื่อ hot shard ได้ต้องจ่ายเพิ่ม และเปิดเป็นราย stream ด้วย `EnableEnhancedMonitoring`

### ราคา

ราคาใน US East (N. Virginia) จาก price list ของ AWS เดือนกันยายน 2026:

| | Provisioned | On-demand Standard | On-demand Advantage |
|---|---|---|---|
| ค่าคงที่ | $0.015 ต่อ shard-hour | $0.04 ต่อ stream-hour | ไม่มี แต่คิดเงินขั้นต่ำขาเข้าและขาออกอย่างละ 25 MB/s ต่อ account |
| Write | $0.014 ต่อ payload unit 25 KB หนึ่งล้านหน่วย | $0.08 ต่อ GB โดยปัด record แต่ละตัวขึ้นเป็น 1 KB | $0.032 ต่อ GB |
| Shared read | รวมอยู่แล้วสำหรับข้อมูลอายุไม่เกิน 7 วัน | $0.04 ต่อ GB | $0.016 ต่อ GB |
| Enhanced fan-out read | $0.015 ต่อ consumer-shard hour + $0.013 ต่อ GB | $0.05 ต่อ GB | $0.016 ต่อ GB |
| Retention 24 h ถึง 7 วัน | $0.020 ต่อ shard-hour | $0.10 ต่อ GB-month | $0.023 ต่อ GB-month |
| Retention เกิน 7 วัน | $0.023 ต่อ GB-month + $0.021 ต่อ GB ที่อ่านด้วย `GetRecords` | $0.023 ต่อ GB-month | $0.023 ต่อ GB-month |

สำหรับ stream ของ Acme ในเดือนที่มี 30 วัน: $43.20 สำหรับ 4 shard, $72.58 สำหรับ payload unit 5,184 ล้านหน่วย (2,000 record ต่อวินาที แต่ละตัวต่ำกว่า 25 KB), $57.60 สำหรับ retention 7 วัน และสำหรับ enhanced fan-out ของ Flink คือ consumer-shard hour $43.20 บวกประมาณ $64 สำหรับการอ่าน 4,944 GB แล้วรวมทั้งหมดก็ประมาณ $281 ก่อนบวกค่างานของ Lambda, Firehose และ Flink เอง ถ้าเป็น traffic เท่ากันใน On-demand Standard จะเสียประมาณ $1,166 ($396 สำหรับการเขียน, $396 สำหรับ reader แบบ poll สองตัว, $247 สำหรับ Flink, $29 สำหรับ stream และ $99 สำหรับ retention) ส่วน On-demand Advantage จะคิดเงินขั้นต่ำของมัน ประมาณ $3,040 ต่อเดือน ตัว traffic ที่สม่ำเสมอและคาดเดาได้คือที่ที่ provisioned shard คุ้มค่า

ข้อมูลที่วิ่งระหว่าง Kinesis กับ producer หรือ consumer ใน Region เดียวกันไม่คิดเงิน และ Kinesis ไม่ได้อยู่ใน AWS Free Tier ส่วนการส่งไป S3 ของ Kinesis เองคิดเงินแยกจากตัว stream: ใน US East (N. Virginia) คือ $0.0275 ต่อ GB ที่ส่งจาก On-demand Standard stream และ $0.011 ถ้าใช้ On-demand Advantage

## อยู่ตรงไหนใน solution

- **Solution:** clickstream และ product analytics แบบที่นี่, [telemetry pipeline](../telemetry-pipeline/) ที่เก็บ log, metric และค่าจาก IoT, [change data capture](../change-data-capture/) จาก DynamoDB table หรือจาก relational database ผ่าน AWS DMS หรือ Debezium, dashboard แบบ live, การตรวจจับ fraud และความผิดปกติ และการเอา raw event ลง data lake บน S3 (bronze layer ของ [medallion architecture](../medallion-architecture/))
- **Pattern ที่มัน implement หรือช่วยรองรับ:** [Publish-Subscribe](../publish-subscribe/) ที่ replay ได้ เพราะ reader ทุกตัวได้ทุก record, event backbone ของ [event-driven architecture](../event-driven-architecture/), [sharding](../sharding/) ตาม hash range ที่มีปัญหา hot key แบบเดียวกัน, [competing consumers](../competing-consumers/) ในระดับ shard เพราะ KCL worker แบ่ง shard ของ stream กันเอง, [idempotent consumer](../idempotent-consumer/) ที่รับมือการส่งซ้ำ และ read model ของ [CQRS](../cqrs/) กับ [materialized view](../materialized-view/) ที่ consumer คอยอัปเดตให้เป็นปัจจุบัน
- **เพื่อนบ้านที่มักเจอ:** producer บน [ECS](../amazon-ecs/), EC2 หรือ [Lambda](../aws-lambda/), Kinesis Agent, CloudFront real-time log, IoT Core และ [DynamoDB](../amazon-dynamodb/), consumer อย่าง Lambda, Data Firehose, Managed Service for Apache Flink, แอป KCL และ Redshift streaming ingestion, ปลายทางอย่าง [S3](../amazon-s3/), Glue และ Athena และรอบ ๆ ก็มี CloudWatch, KMS และ [IAM](../aws-iam/)
- **Managed offering:** Kinesis Data Streams เป็น managed service อยู่แล้วในตัว และมีแค่บน AWS ส่วน managed log อีกตัวของ AWS คือ Amazon MSK ที่รัน Apache [Kafka](../kafka/) ส่วนบน cloud อื่น service ที่ใกล้เคียงที่สุดคือ Azure Event Hubs และ Google Cloud Pub/Sub

## ใช้ตอนไหนดี

เลือก Kinesis Data Streams เมื่อหลายแอปบน AWS ต้องการ event ชุดเดียวกัน เรียงตามลำดับต่อ key และอาจต้องอ่านซ้ำ เมื่อปริมาณข้อมูลต้องแบ่ง partition แต่ไม่มีใครอยากดูแล broker และเมื่อ reader เป็น AWS service ที่อ่าน stream ได้ตรง ๆ อย่าง Lambda, Data Firehose และ Managed Service for Apache Flink แต่ให้มองหาตัวอื่นเมื่อ message แต่ละตัวควรไปที่ worker ตัวเดียว ([SQS](../amazon-sqs/)) เมื่อ message ต้องไปถึงหลาย endpoint พร้อมกัน ([SNS](../amazon-sns/)) เมื่อ event ควรถูก route ตามเนื้อหา ([EventBridge](../amazon-eventbridge/)) เมื่อข้อมูลแค่ต้องไปลง storage (Data Firehose แบบ direct put หรือการส่งไป S3 ของ Kinesis เอง) หรือเมื่อทีมอยากได้ protocol, connector และ stream-processing library ของ Kafka (Amazon MSK)

| | Kinesis Data Streams | Amazon MSK (Kafka) | [Amazon SQS](../amazon-sqs/) | [Amazon SNS](../amazon-sns/) | [Amazon EventBridge](../amazon-eventbridge/) | Amazon Data Firehose |
|---|---|---|---|---|---|---|
| มันคืออะไร | log แบบ managed ที่แบ่งเป็น shard | Kafka cluster แบบ managed: log ที่แบ่งเป็น partition | queue แบบ managed | publish-subscribe แบบ managed | event bus ที่มี rule | การส่งข้อมูลแบบ managed เข้า storage และ analytics service |
| ใครอ่าน message | ทุกแอป ตามตำแหน่ง | ทุก consumer group ตาม offset | consumer ตัวเดียว ที่ลบมันทิ้ง | ทุก subscription แบบ push | target ทุกตัวที่ match แบบ push | ไม่มีใคร: มันเขียนไปที่ปลายทาง |
| ลำดับ | ต่อ shard เลือกด้วย partition key | ต่อ partition เลือกด้วย key | FIFO queue: ต่อ message group | FIFO topic: ต่อ message group | ไม่มีบน bus แบบ classic ส่วนบน Custom Event Bus ตัวใหม่คือต่อ event group | — |
| เก็บข้อมูล | 24 ชั่วโมงโดย default ได้ถึง 365 วัน | ต่อ topic โดย default ของ Kafka คือ 7 วัน | 4 วันโดย default ตั้งได้ 1 นาทีถึง 14 วัน | ไม่เก็บ แต่ FIFO topic archive ได้ถึง 365 วัน | bus แบบ classic: แค่ใน archive ที่เลือกเปิดได้ ส่วน Custom Event Bus: 1 ถึง 365 วัน | แค่ระหว่าง buffer และ retry |
| Capacity | shard หรือ on-demand | broker และ partition หรือ MSK Serverless | scale เอง | scale เอง | scale เอง | scale เอง |
| เลือกใช้เมื่อ | stream ที่เรียงลำดับ replay ได้ และมี AWS service หลายตัวอ่าน | แบบเดียวกัน แต่ได้ ecosystem ของ Kafka | work queue และการ buffer | fan-out ไปหลาย endpoint | route ตามเนื้อหาข้าม service และ account | โหลดเข้า S3, Redshift, [OpenSearch](../elasticsearch/) และอื่น ๆ |

ตัวเลขจากเอกสารของ AWS เดือนตุลาคม 2026 และจากหน้าต่าง ๆ ใน catalog นี้ที่ table ลิงก์ไป

## ได้อะไร เสียอะไร

- **capacity มาเป็นราย shard และราย key** 1 MB/s และ 1,000 record ต่อวินาทีของ shard เป็น limit ตายตัว และ key เดียวใช้เกินหนึ่ง shard ไม่ได้ ส่วน key ที่กระจายไม่เท่ากันจะทำให้ write โดน throttle ทั้งที่ stream โดยรวมยังมีที่ว่าง แบบในขั้นที่ 4: shard หนึ่งให้ shard อื่นยืม capacity ที่เหลือไม่ได้
- **ลำดับมีแค่ภายใน shard และการส่งเป็นแบบ at least once** ทั้ง producer และ consumer ทำให้เกิดการซ้ำ และการรักษาลำดับข้าม shard หรือข้ามการ retry ก็เป็นหน้าที่ของแอป
- **reader แบบ poll แชร์ 2 MB/s ต่อ shard** แอปที่ poll สองสามตัวก็กิน read capacity ของ shard จนเต็ม reader ตัวต่อ ๆ ไปเลยมักต้องใช้ enhanced fan-out ที่เสียเงินเพิ่มถ้าไม่ได้ใช้ On-demand Advantage
- **resharding หยาบ** split และ merge จัดการได้ทีละหนึ่งหรือสอง shard ส่วน `UpdateShardCount` เปลี่ยนได้ 10 ครั้งต่อวัน แต่ละครั้งไม่เกินสองเท่าหรือครึ่งหนึ่ง และ reader ต้องอ่าน parent shard ให้หมดก่อน
- **record เล็ก และจำได้ไม่นานโดย default** 1 MiB ต่อ record (10 MiB ถ้าขยาย และควรใช้แค่เป็นครั้งคราว) และ retention 24 ชั่วโมง ทุกวันที่เพิ่มต้องเสียเงิน
- **จ่ายตาม capacity ไม่ใช่แค่ตามที่ใช้** ต่อ shard-hour ในโหมด provisioned และต่อ stream-hour ใน On-demand Standard ส่วน On-demand Advantage เปลี่ยนค่าพวกนั้นเป็นขั้นต่ำระดับ account
- **มีแค่บน AWS** API และ client library เป็นของ Kinesis เอง การย้ายไป Kafka หรือ cloud อื่นแปลว่าต้องเขียนโค้ด producer และ consumer ใหม่

## ข้อควรรู้ตอนลงมือทำ

- **เลือก partition key ให้ได้ทั้งลำดับและการกระจาย** มันควรเก็บสิ่งที่ต้องเรียงลำดับไว้ด้วยกัน (session, account, อุปกรณ์) และมีค่าที่เป็นไปได้มากกว่าจำนวน shard เยอะ ๆ โดยไม่มีค่าไหนยุ่งกว่าตัวอื่นมาก ระวัง key ที่อาจกลายเป็น hot: bot, merchant ที่ใหญ่มาก ๆ หรือค่า default อย่าง `unknown`
- **กำหนดขนาด provisioned stream ตาม peak และเผื่อที่ว่าง:** เอาค่าที่มากกว่าระหว่าง write ÷ 1 MB/s (หรือ record ÷ 1,000) กับ read แบบ poll ÷ 2 MB/s ปัดขึ้น แล้วเผื่อที่สำหรับ burst และสำหรับ reader ที่กำลังไล่ตาม ถ้า traffic คาดเดาไม่ได้ ให้เริ่มที่ on-demand แล้วค่อยสลับเมื่อรู้ pattern แล้ว
- **จัดการ partial failure ใน producer** เช็ก `FailedRecordCount` ในทุกคำตอบของ `PutRecords` แล้วส่งซ้ำแค่ record ที่ fail ด้วย exponential backoff และ jitter หรือให้ KPL ทำให้
- **ทำ consumer ทุกตัวให้ idempotent** ด้วย ID ที่ติดมากับ record และ checkpoint หลังทำงานเสร็จแล้วเท่านั้น
- **ให้ Lambda mapping มี failure policy:** `MaximumRetryAttempts` และ `MaximumRecordAgeInSeconds` ที่มีขอบเขต, `BisectBatchOnFunctionError` หรือ `ReportBatchItemFailures` และ on-failure destination เพื่อไม่ให้ record เสียตัวเดียวขวาง shard ของมันไว้จนหมดอายุ
- **ตั้ง alarm เรื่อง lag และ throttling:** ค่าสูงสุดของ `GetRecords.IteratorAgeMilliseconds` (และ `IteratorAge` ของ Lambda) ให้ดังก่อนถึงครึ่งหนึ่งของ retention period นาน ๆ รวมถึง `WriteProvisionedThroughputExceeded` และ `ReadProvisionedThroughputExceeded`
- **ดูแลแอป KCL ให้เรียบร้อย** ตั้งชื่อแอปแต่ละตัวไม่ให้ซ้ำ เพราะ lease table ตั้งชื่อตามแอป และลบ DynamoDB table ของมันตอนเลิกใช้แอป เพราะ KCL ทิ้ง table พวกนั้นไว้
- **เข้ารหัสตั้งแต่แรกและแยกสิทธิ์** เปิด server-side encryption ก่อนเขียน record ตัวแรก เพราะ record ที่เก่ากว่านั้นจะไม่ถูกเข้ารหัส และให้สิทธิ์ทำ resharding กับ operator role ไม่ใช่กับ producer และ consumer
- **ซ้อมรับมือ throttling** ตั้งแต่ตุลาคม 2025 AWS Fault Injection Service มี action สำหรับ Kinesis ที่ฉีด error `ProvisionedThroughputExceededException` และ `ExpiredIteratorException` เข้าไปได้ ทำให้เราเห็นว่า producer และ consumer รับมือยังไง ก่อนที่ hot shard ตัวจริงจะมาบอก
