## ปัญหา

service Orders ของ Acme Shop สร้างข้อเท็จจริงออกมาเป็นสายต่อเนื่อง (`OrderPlaced`, `OrderPaid`, `OrderShipped`) ที่หลายทีมต้องใช้: Billing ต้องเก็บเงินแต่ละ order แค่ครั้งเดียว search อยากให้ index ได้ภายในไม่กี่วินาที analytics โหลดเข้า warehouse เป็น batch ส่วน fraud model ที่จะ train ไตรมาสหน้าก็จะอยากอ่านข้อมูลสัปดาห์ที่แล้วซ้ำอีกรอบ ถ้าเรียกแต่ละตัวตรง ๆ ตัว Orders ก็จะผูกติดกับความเร็วและ availability ของ consumer ทุกตัว ส่วน message queue แบบดั้งเดิมตัดการผูกนี้ออกได้ แต่มันส่ง message แต่ละตัวให้ consumer ตัวเดียว แล้วลบทิ้งเมื่อ acknowledge แล้ว: reader ใหม่ทุกตัวต้องมี queue และสำเนาของตัวเอง และไม่มีใครย้อนเวลากลับไปได้

Kafka เขียนแต่ละ event **ครั้งเดียว** ลงใน log ที่ durable และเรียงลำดับไว้ reader กี่ตัวก็อ่านมันได้แยกกันเอง แต่ละตัวจำว่าตัวเองอ่านไปถึงไหนแล้ว และ event จะอยู่ไปนานเท่าที่ topic ตั้งค่าให้เก็บไว้

## ทำงานยังไง

### เป็น log ไม่ใช่ queue

Kafka **topic** เก็บเป็นชุดของ log แบบ append-only ตัว record ใหม่แต่ละตัวจะไปต่อท้าย log และได้ **offset** ตัวถัดไป เป็นเลขลำดับที่ไม่มีวันเปลี่ยน record ไม่ถูกแก้ และการอ่านก็ไม่ได้ลบมันออก สิ่งที่ reader ใช้ไปแล้วเลยเป็นแค่ตัวเลขตัวเดียวต่อ partition คือ offset ของ record ตัวถัดไปที่มันจะอ่าน เพราะแบบนี้เอกสาร design ของ Kafka ถึงบอกว่า acknowledgement มีต้นทุนต่ำ reader แต่ละตัวถือตัวเลขของตัวเองบนข้อมูลชุดเดียวกัน และ reader ก็เลื่อนตัวเลขของตัวเองย้อนกลับเพื่ออ่านประวัติซ้ำได้ record จะออกจาก log ได้ทางเดียวคือผ่าน retention policy ของ topic ส่วนบทความ *The Log* ปี 2013 ของ Jay Kreps อธิบายว่าทำไมโครงสร้างง่าย ๆ แบบนี้ถึงเหมาะมากกับการเป็นจุดนัดพบระหว่างระบบ

### Topic, partition และ key

topic ถูกแบ่งเป็น **partition** กระจายอยู่บน **broker** (server ของ cluster) แต่ละ partition คือ log ที่เรียงลำดับและแยกเป็นอิสระ มี offset ของตัวเอง เพราะแบบนี้ P0, P1 และ P2 ใน animation ถึงนับเลขแยกกัน partition เป็นหน่วยของทั้งการเก็บข้อมูลและการทำงานขนาน: มันถูกเก็บทั้งก้อนบน broker ทุกตัวที่ถือ replica ของมัน และถูกอ่านโดย consumer ตัวเดียวต่อ group

producer เป็นคนเลือก partition ให้แต่ละ record:

1. ถ้า record ระบุ partition ไว้ ก็ใช้ตามนั้น
2. ถ้าไม่ ก็ให้ `partitioner.class` ที่ตั้งไว้เป็นคนตัดสิน
3. ถ้าไม่มีอีก และ record มี key ตัว partitioner ในตัวจะเอา key ที่ serialize แล้วไป hash ด้วย murmur2 แล้ว mod ด้วยจำนวน partition
4. ถ้าไม่มี key มันจะส่งไปที่ partition เดียวไปเรื่อย ๆ จนกว่าจะส่งไปแล้วอย่างน้อย `batch.size` byte แล้วค่อยสลับ (partitioner แบบ *sticky*)

record ที่มี key เดียวกันเลยไปลงที่ partition เดียวกันเสมอ และ **ลำดับรับประกันแค่ภายใน partition เดียว**: consumer อ่าน record ของ partition หนึ่งตามลำดับที่เขียน ส่วน record ที่อยู่คนละ partition ไม่มีลำดับต่อกัน ให้ตั้ง key ตาม entity ที่ event ของมันต้องเรียงลำดับ ในที่นี้คือ customer ID ตัว key ใน animation เป็นของจริง: สำหรับ key ที่เป็น string `C-14` ตัว partitioner ของ Kafka คืน partition 1 จาก 3

การ map แบบนี้ขึ้นกับจำนวน partition ถ้าขยาย topic จาก 3 เป็น 4 partition ตัว `C-14` จะย้ายไปที่ P2 ขณะที่ event เก่า ๆ ของมันยังอยู่ใน P1 เอกสารของ Kafka เตือนว่าการเพิ่ม partition ทำให้ลำดับต่อ key พังได้แบบนี้เลย และจำนวน partition ของ topic ก็ลดลงไม่ได้เลย ให้เลือกไว้ตั้งแต่แรก โดยเผื่อที่ไว้:

```sh
bin/kafka-topics.sh --bootstrap-server localhost:9092 --create --topic orders \
  --partitions 3 --replication-factor 3 --config min.insync.replicas=2
```

### Replication: leader, follower และ ISR

แต่ละ partition มี **replica** เท่ากับ replication factor ของมัน แต่ละตัวอยู่คนละ broker โดยมี replica ตัวหนึ่งเป็น **leader** ที่รับการเขียนทั้งหมด ส่วนตัวอื่นเป็น **follower** ที่ fetch จาก leader คล้ายกับที่ consumer ทำ ทุกสำเนาเลยมี record ชุดเดียวกันที่ offset เดียวกัน leader กระจายอยู่ทั่ว broker: ใน animation ตัว b1 เป็น leader ของ P0, b2 เป็น leader ของ P1 และ b3 เป็น leader ของ P2

replica ที่ตาม leader ทันแล้ว (นับ leader ด้วย) รวมกันเป็น **in-sync replicas (ISR)** follower ที่ไม่ได้ fetch หรือยังไปไม่ถึงท้าย log ของ leader นานเกิน `replica.lag.time.max.ms` (default 30 วินาที) จะถูกเอาออกจากชุดนี้ record จะนับว่า **committed** เมื่อ replica ทุกตัวใน ISR มี record นั้นแล้ว และมีแค่ record ที่ committed เท่านั้นที่ส่งให้ consumer

setting `acks` ของ producer เป็นตัวกำหนดว่าการเขียนจะนับว่าเสร็จเมื่อไร:

- `acks=0`: producer ไม่รอ broker เลย
- `acks=1`: leader เขียน record แล้ว และ record จะหายไปถ้า leader ล่มก่อนที่ follower จะก็อปไป
- `acks=all`: in-sync replica ทุกตัวมี record แล้ว มันเลยรอดตราบที่ยังมี replica ในชุดนั้นเหลืออยู่สักตัว

ถ้าใช้ `acks=all` อย่างเดียว ก็ยังรับการเขียนอยู่ดีตอนที่ ISR หดเหลือแค่ leader ส่วน topic setting **`min.insync.replicas`** (default 1) เพิ่มพื้นขั้นต่ำเข้ามา: ถ้า in-sync replica น้อยกว่าค่านี้ การเขียนแบบ `acks=all` จะ fail ด้วย error `NotEnoughReplicas` แทนที่จะไปลงบนสำเนาที่น้อยเกินไป ถ้าใช้ replication factor 3 กับ `min.insync.replicas=2` ก็ปล่อยให้ broker ล่มได้หนึ่งตัวโดยที่การเขียนยังทำต่อได้ เหมือนในขั้นที่ 4

ตั้งแต่ Kafka 3.0 producer ใช้ default เป็น `acks=all` และ `enable.idempotence=true` (KIP-679 โดยที่ bug ตัวหนึ่งทำให้ idempotence ปิดอยู่โดย default ใน 3.0.0 และ 3.1.0 แล้วถูกแก้ใน 3.0.1, 3.1.1 และ 3.2.0) พอมี idempotence ตัว broker จะให้ ID กับ producer แต่ละตัว และทิ้งตัวที่ซ้ำโดยดูจาก sequence number ทำให้การ retry หลัง acknowledgement หายไปจะไม่เขียน record ซ้ำสองครั้ง

พอ broker หยุดส่ง heartbeat ตัว **controller** ของ cluster จะประกาศว่ามัน offline หลัง `broker.session.timeout.ms` (default 9 วินาที) แล้วตั้งสมาชิกตัวอื่นใน ISR ให้เป็น leader ของทุก partition ที่ broker นั้นเคยเป็น leader อยู่ ส่วน replica ที่อยู่นอก ISR อาจขาด record ที่ committed ไปแล้ว มันเลยไม่ถูกเลือกตราบที่ `unclean.leader.election.enable` ยังเป็นค่า default คือ `false` ข้อยกเว้นบน cluster ที่สร้างด้วย Kafka 4.1 ขึ้นไปคือ *eligible leader replica* (ELR, KIP-966): high watermark ขยับไม่ได้ตอนที่ ISR เล็กกว่า `min.insync.replicas` ตัว controller เลยรู้ได้ว่า replica ตัวไหนนอก ISR ที่ยังมี record ที่ committed ครบทุกตัว และจะเลือกหนึ่งในนั้นเมื่อไม่มีสมาชิก ISR เหลืออยู่เลย พอ b2 กลับมา มันจะตามให้ทันในฐานะ follower แล้วถ้า `auto.leader.rebalance.enable=true` (ค่า default) การเช็กเป็นรอบของ controller ที่ default ทุก 300 วินาที ก็จะคืน P1 ให้ preferred leader ของมัน

### Consumer group, offset และ rebalancing

consumer ที่ใช้ `group.id` เดียวกันรวมกันเป็น **consumer group** แล้ว group จะแบ่ง partition ให้สมาชิก โดยที่แต่ละ partition ถูกอ่านโดยสมาชิก **ตัวเดียวเท่านั้น** ในเวลาหนึ่ง สมาชิกตัวหนึ่งถือหลาย partition ได้ ส่วนสมาชิกที่ไม่ได้ partition เลยก็นั่งว่าง จำนวน partition เลยเป็นเพดานของการทำงานขนานใน group: สาม partition ทำให้ billing consumer มีงานทำได้มากสุดแค่สามตัว แต่ละ group ไม่ขึ้นต่อกันและเห็นทุก record ทำให้ Kafka ทำตัวเหมือน [publish-subscribe](../publish-subscribe/) เมื่อมองข้าม group และเหมือน [competing consumers](../competing-consumers/) เมื่อมองภายใน group เดียว

แต่ละ group เก็บ **committed offset** ไว้ใน Kafka เอง ใน internal topic `__consumer_offsets` โดย default ตัว consumer จะ commit อัตโนมัติทุก 5 วินาที (`enable.auto.commit=true`, `auto.commit.interval.ms=5000`) ส่วน group ที่ยังไม่มี committed offset จะเริ่มตามที่ `auto.offset.reset` บอก (default คือ `latest`) ทำให้ group ใหม่เห็นแค่ record ใหม่ เว้นแต่คุณจะตั้งเป็น `earliest` ระยะห่างระหว่าง log-end offset ของ partition กับ committed offset ของ group คือ **consumer lag** ที่เป็นตัวบอกสุขภาพหลักของ Kafka consumer

พอมีสมาชิกเข้า ออก หรือล่ม หรือมีการเพิ่ม partition ตัว group จะ **rebalance** และแบ่ง partition ใหม่ ตรงนี้มีสอง protocol:

- **Classic** สมาชิกตกลงกันตาม assignment ที่ assignor ฝั่ง client คำนวณ ค่า default ของ `partition.assignment.strategy` คือ `[RangeAssignor, CooperativeStickyAssignor]`
- **Consumer** (KIP-848) generally available ตั้งแต่ Kafka 4.0 และเปิดไว้บน broker โดย default ตัว group coordinator บน broker คำนวณ assignment (ใช้ assignor `uniform` เป็น default หรือ `range`) และย้าย partition ทีละส่วน โดยไม่มี synchronization barrier ทั้ง group ทำให้สมาชิกที่ partition ไม่ได้ย้ายยังอ่านต่อได้ ส่วน consumer ต้อง opt in ด้วย `group.protocol=consumer` ณ Kafka 4.3 ค่า default ยังเป็น `classic` อยู่ และเอกสารคาดว่า `KafkaConsumer` จะเปลี่ยน default ใน Kafka 5.0

`kafka-consumer-groups.sh` บอกว่า group อยู่ตรงไหน และเลื่อนมันได้:

```sh
# Where is search-indexer? (output trimmed to the offset columns)
bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group search-indexer
# TOPIC   PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
# orders  0          61              64              3
# orders  1          39              43              4
# orders  2          28              31              3

# Replay from a point in time. Stop the group's consumers first; without --execute this is a dry run.
bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --reset-offsets \
  --group search-indexer --topic orders --to-datetime 2026-10-05T00:00:00.000 --execute
```

### Delivery semantics

โดย default ตัว Kafka ส่งแบบ **at least once** ตัว producer แบบ idempotent กันไม่ให้ retry เขียนซ้ำ แต่ consumer ที่ล่มหลังประมวลผล record แล้วแต่ก่อน commit offset จะได้ record นั้นอีกรอบหลัง rebalance ส่วนถ้า commit ก่อนประมวลผล ก็จะได้ at-most-once แทน ถ้าจะเอา **exactly-once** ภายใน Kafka ตัว transactional producer (`transactional.id`) จะเขียน output record และ offset ของ input ที่มันอ่านไปใน transaction เดียวแบบ atomic แล้ว consumer ปลายทางก็ตั้ง `isolation.level=read_committed` (default คือ `read_uncommitted`) เพื่อข้าม record จาก transaction ที่ abort ส่วน Kafka Streams ห่อเรื่องนี้ไว้เป็น `processing.guarantee=exactly_once_v2` การรับประกันนี้จบที่ขอบของ Kafka: การตัดบัตรหรือการส่งอีเมลยังเกิดซ้ำสองครั้งได้ เลยต้องทำให้ consumer พวกนั้น [idempotent](../idempotent-consumer/)

### Retention, compaction และ tiered storage

ถ้าใช้ default `cleanup.policy=delete` ตัว topic จะทิ้ง log segment เก่า ๆ ทั้ง segment เมื่อมันเก่ากว่า `retention.ms` (default 7 วัน มาจาก `log.retention.hours=168` ของ broker) หรือเมื่อ partition โตเกิน `retention.bytes` (default ไม่จำกัด) retention คือ deadline ของ consumer ทุกตัว: group ที่หายไปนานกว่านั้นจะเสีย record ไป และเมื่อ committed offset ของมันไม่มีอยู่แล้ว `auto.offset.reset` จะเป็นตัวตัดสินว่ามันจะทำต่อจากตรงไหน ถ้าใช้ default `latest` มันจะกระโดดไปท้าย log แล้วข้าม record ที่พลาดไป

ส่วนถ้าใช้ `cleanup.policy=compact` ตัว Kafka จะเก็บ record ล่าสุดของแต่ละ key ไว้อย่างน้อยหนึ่งตัวแทน เหมาะกับ topic ที่เก็บ state ปัจจุบัน เช่น ที่อยู่ของลูกค้า ส่วน record ที่มี key แต่ value เป็น null คือ **tombstone** ที่ใช้ลบ key นั้น และ tombstone เองก็จะหายไปหลัง `delete.retention.ms` (default 1 วัน) compaction ลบ record เก่า ๆ ออกแต่ไม่เคยสลับลำดับของที่เหลือ สอง policy นี้ใช้ร่วมกันได้เป็น `delete,compact`

**Tiered storage** (KIP-405) ที่พร้อมใช้ใน production ตั้งแต่ Kafka 3.9 เก็บ segment ล่าสุดไว้บน broker และย้ายตัวเก่าไปที่ remote storage อย่าง object store ทำให้ retention ยาว ๆ ไม่ต้องใช้ disk ใหญ่บน broker แต่มันไม่รองรับ topic แบบ compacted

### KRaft: ไม่มี ZooKeeper แล้ว

metadata ของ cluster (topic, partition, leader, ISR, configuration) เคยอยู่ใน Apache ZooKeeper แล้ว KIP-500 ก็เปลี่ยนมาใช้ **KRaft** แทน: quorum ของ **controller** ปกติ 3 หรือ 5 ตัว ที่ replicate metadata กันเองด้วย protocol ที่ใช้ Raft เป็นฐาน controller ตัวหนึ่ง active ส่วนตัวอื่นเป็น hot standby ทำให้ controller 3 ตัวทนการล่มได้หนึ่งตัว และ 5 ตัวทนได้สองตัว แล้ว Kafka 4.0 (มีนาคม 2025) ก็เป็น release แรกที่รันได้แค่ในโหมด KRaft ส่วน cluster ที่ใช้ ZooKeeper ต้อง migrate ไป KRaft บน bridge release ก่อน โดยตัวสุดท้ายคือ Kafka 3.9

### Connect, Streams และ share group

- **Kafka Connect** รัน **connector** แบบ source และ sink ที่ย้ายข้อมูลระหว่าง Kafka กับระบบอื่น (database, object storage, search engine) โดยไม่ต้องเขียนโค้ดเอง ตัว connector สำหรับ change data capture ของ Debezium มัก deploy อยู่บนนี้
- **Kafka Streams** คือ client library สำหรับแอป Java และ Scala ที่ประมวลผล stream (filter, join, windowed aggregation) โดยมี input และ output เป็น Kafka topic
- **Share group** (KIP-932, "Queues for Kafka") เพิ่มการอ่านแบบ queue: early access ใน 4.0, preview ใน 4.1 และพร้อมใช้ใน production ใน 4.2 ตัว consumer ใน share group ช่วยกันหยิบ record ทำให้หลายตัวทำงานบน partition เดียวกันได้ และ group หนึ่งมี consumer มากกว่า partition ได้ ส่วน record แต่ละตัวถูก acknowledge แยกกัน โดยที่ consumer ถือ record ไว้ภายใต้ acquisition lock (`share.record.lock.duration.ms`, default 30 วินาที) และจำนวนครั้งที่พยายามส่งจะถูกนับไปจนถึง `share.delivery.count.limit` (default 5) ราคาที่ต้องจ่ายคือลำดับ: record จะมาตามลำดับ offset แค่ภายใน batch เดียวจาก partition เดียว

## อยู่ตรงไหนใน solution

- **Solution** เป็น event backbone ของระบบ [event-driven](../event-driven-architecture/) เป็น pipeline ที่ป้อนข้อมูลให้ search index, cache, data lake และ warehouse ทำ [change data capture](../change-data-capture/) ด้วย Debezium บน Kafka Connect (ตัวนี้เป็น relay ที่อยู่หลัง [transactional outbox](../transactional-outbox/) ได้ด้วย) เก็บ log, metric และ clickstream ใน [telemetry pipeline](../telemetry-pipeline/) และเป็น input กับ output ของ stream processor อย่าง Kafka Streams และ Apache Flink
- **Pattern ที่มัน implement หรือช่วยรองรับ** [Publish-subscribe](../publish-subscribe/) เมื่อมองข้าม consumer group และ [competing consumers](../competing-consumers/) ภายใน group เดียว รวมถึง read model ของ [CQRS](../cqrs/) และ [materialized views](../materialized-view/) ที่ consumer สร้างขึ้น และ [idempotent consumers](../idempotent-consumer/) ที่รับมือการส่งซ้ำ ส่วน [Event sourcing](../event-sourcing/) ต้องใช้อย่างระวัง: Kafka ขน event ไปได้ แต่ไม่มี stream ต่อ entity ให้อ่านกลับ ไม่มีการ append ที่เช็ก version ปัจจุบันของ entity และ retention หรือ compaction ต้องไม่ทิ้ง event ที่คุณยังต้องใช้ หลายทีมเลยเก็บ event store ไว้ที่อื่น แล้ว publish จากตรงนั้นไปที่ Kafka
- **เพื่อนบ้านที่มักเจอ** service และ CDC connector ที่เป็นฝั่ง produce, schema registry ที่อยู่ข้าง cluster, stream processor, sink connector และ service ที่เป็นฝั่ง consume และ monitoring ของ lag กับ replication ที่อยู่รอบ ๆ
- **Managed offering** **Amazon MSK** รัน Apache Kafka บน AWS: MSK Provisioned ที่มี broker แบบ Standard หรือ Express, MSK Serverless, MSK Connect สำหรับ connector และ MSK Replicator สำหรับก็อปข้อมูลข้าม cluster ณ ตุลาคม 2026 ตัว MSK รองรับ Kafka ถึงเวอร์ชัน 4.2 (4.2 มีแค่บน Express broker) และระบุ 3.9 เป็นเวอร์ชันที่แนะนำ ตัว Express broker จัดการ storage ให้ รันได้แค่ข้ามสาม Availability Zone และยังไม่รองรับ share group ส่วน Confluent Cloud เป็น managed Kafka service อีกตัว และ Redpanda เป็น broker แยกต่างหากที่ compatible กับ Kafka API
- **License** Apache Kafka เป็นโปรเจกต์ของ Apache Software Foundation ภายใต้ Apache License 2.0 ส่วน core ของ Redpanda เป็น source-available ภายใต้ Business Source License 1.1 ที่เปลี่ยนแต่ละเวอร์ชันเป็น Apache 2.0 หลัง release ไปสี่ปี และฟีเจอร์ enterprise ของมันอยู่ภายใต้ Redpanda Community License

## ใช้ตอนไหนดี

เลือก Kafka เมื่อ consumer หลายตัวที่เป็นอิสระต่อกันต้องใช้ event เดียวกันตามจังหวะของตัวเอง เมื่อต้องเก็บ event ไว้และ **replay** (เพื่อสร้าง read model ใหม่ backfill service ใหม่ หรือประมวลผลใหม่หลังเจอ bug) เมื่อลำดับต่อ key สำคัญแต่ consumer ตัวเดียวไม่พอ และเมื่อคุณสร้าง streaming pipeline หรือ CDC แล้วอยากได้ ecosystem ของ Connect กับ Streams มาช่วย ถ้าเป็น work queue ธรรมดาที่ต้องการ acknowledgement ต่อ message, retry และ dead-lettering ตัว queue broker อย่าง [RabbitMQ](../rabbitmq/) หรือ Amazon SQS จะง่ายกว่า ส่วนถ้าเป็น request/response ก็เรียก service ไปเลย

| | Apache Kafka | [RabbitMQ](../rabbitmq/) | [Amazon SQS](../amazon-sqs/) | Amazon Kinesis Data Streams |
|---|---|---|---|---|
| โมเดล | log ที่แบ่ง partition และมี replica | Broker: exchange route message เข้า queue ส่วน stream เพิ่ม log เข้ามา | Managed queue | Managed log ที่แบ่ง partition (shard) |
| หลังอ่าน | record ยังอยู่ แต่ละ group เลื่อน offset ของตัวเอง | Queue: ลบออกเมื่อ acknowledge แล้ว ส่วน Stream: ยังอยู่ | consumer ลบมันหลังประมวลผลเสร็จ | record ยังอยู่ โดย consumer แต่ละตัวจำตำแหน่งของตัวเอง |
| ลำดับ | ต่อ partition โดยเลือกด้วย key | FIFO ต่อ queue ส่วน priority กับ requeue เปลี่ยนสิ่งที่ consumer เห็นได้ | Standard: best effort ส่วน FIFO: ต่อ message group | ต่อ shard โดยเลือกด้วย partition key |
| เก็บข้อมูล | จนถึง retention (default 7 วัน) หรือ compaction และมี tiered storage สำหรับ retention ยาว ๆ | Queue: จนกว่าจะมีคนอ่าน ส่วน Stream: ตามขนาดหรืออายุ | default 4 วัน ตั้งได้ 1 นาทีถึง 14 วัน | default 24 ชั่วโมง ได้ถึง 365 วัน |
| Reader | consumer group โดยแต่ละ group มี consumer หนึ่งตัวต่อ partition และ share group (4.2+) | competing consumers ต่อ queue และ fan-out ผ่าน exchange | competing consumers ส่วน fan-out ต้องมี SNS อยู่ข้างหน้า หรือมี queue ต่อ reader | 2 MB/s ต่อ shard ที่ reader ทุกตัวแชร์กัน หรือ enhanced fan-out ที่ให้ 2 MB/s ต่อ shard แยกให้แต่ละตัว |
| ใครเป็นคนรัน | คุณเอง, Amazon MSK, Confluent Cloud | คุณเอง, Amazon MQ | AWS | AWS |

ตัวเลขจากเอกสารของ Kafka 4.3, RabbitMQ, Amazon SQS และ Kinesis Data Streams, ตุลาคม 2026

## ได้อะไร เสียอะไร

- **มีของต้องรันมากขึ้น** cluster ใน production หมายถึง broker, controller quorum, การวาง partition, rolling upgrade และการวางแผน capacity ส่วน managed service รับเรื่องเครื่องกับการ patch ไปให้ แต่ไม่ได้รับการตัดสินใจเรื่อง design: key, จำนวน partition, retention และ schema ยังเป็นของคุณ
- **ลำดับเป็นแบบต่อ partition และ key เป็นตัวกำหนดโหลด** record ทั้งหมดของ key หนึ่งไปที่ partition เดียว และไปที่ consumer ตัวเดียวต่อ group ตัว hot key อย่างลูกค้ารายใหญ่มาก ๆ สักราย จะทำให้ partition ของมันรับไม่ไหว ไม่ว่าคุณจะเพิ่ม partition ไปกี่ตัว และถ้าจะกระจายมันออกไป ก็ต้องยอมทิ้งลำดับของมัน
- **จำนวน partition เปลี่ยนยาก** การเพิ่ม partition ทำให้ key ย้ายที่ และ partition ก็ลบออกไม่ได้
- **consumer เจอของซ้ำ** delivery แบบ at-least-once แปลว่าการล่มหรือการ rebalance จะ replay record ตั้งแต่ commit ล่าสุด
- **acknowledgement หยาบ** consumer group เก็บ offset หนึ่งตัวต่อ partition ไม่ได้เก็บสถานะต่อ message ทำให้ record ที่ fail ซ้ำ ๆ ขวาง partition ของมันไว้ จนกว่าแอปจะข้ามมันไป หรือเอาไปพักไว้ใน topic แบบ [dead-letter](../dead-letter-queue/) ไม่มี message priority ไม่มี delayed delivery และไม่มีการ filter บน broker ส่วน share group (4.2+) เพิ่ม acknowledgement ต่อ record และการนับจำนวนครั้งที่ส่งเข้ามา แต่ต้องยอมทิ้งลำดับ
- **Retention คือ deadline** consumer ที่ล่มนานกว่าช่วง retention จะเสีย record ไป
- **แลก latency กับ throughput และความปลอดภัยของข้อมูล** producer รวม record เป็น batch (`linger.ms` default 5 ms ใน Kafka 4.3 และ `batch.size` 16 KB) และ `acks=all` ก็รอ in-sync replica แล้วทั้งสองอย่างก็เพิ่ม latency นิดหน่อย เพื่อแลกกับ throughput และ durability

## ข้อควรรู้ตอนลงมือทำ

- **กำหนดจำนวน partition ตามการทำงานขนานที่ต้องการ** group หนึ่งให้ consumer มีงานทำได้ไม่เกินจำนวน partition และแต่ละ partition ถูกเก็บทั้งก้อนบน broker ทุกตัวที่ replicate มัน ให้วางแผนจำนวน consumer ตอน peak และการเติบโตไว้ตั้งแต่แรก
- **เริ่มจาก baseline ที่ durable:** replication factor 3, `min.insync.replicas=2`, producer ใช้ `acks=all` พร้อม idempotence (เป็น default ทั้งคู่) และ `unclean.leader.election.enable=false` (ค่า default)
- **กระจาย replica ข้าม failure domain** ตั้ง `broker.rack` เช่นให้เป็น Availability Zone เพื่อให้ replica ของแต่ละ partition ไปอยู่คนละ rack จากนั้น consumer ก็อ่านจาก replica ใน zone ของตัวเองแทน leader ได้: ตั้ง `client.rack` ที่ consumer และ `replica.selector.class=org.apache.kafka.common.replica.RackAwareReplicaSelector` ที่ broker (โดย default consumer อ่านจาก leader)
- **คอยดู lag และ replication** consumer lag ต่อ group และ partition (`kafka-consumer-groups.sh --describe` หรือ consumer metric `records-lag-max`) และบน broker ให้ดู `UnderReplicatedPartitions`, `UnderMinIsrPartitionCount` และ `OfflinePartitionsCount`
- **ถือว่า schema เป็น contract** Kafka เก็บแค่ byte ให้ตกลง format กัน (Avro, Protobuf หรือ JSON Schema) register schema ไว้ใน registry อย่าง Confluent Schema Registry หรือ AWS Glue Schema Registry และยอมให้เปลี่ยนได้แค่แบบที่ compatible
- **ทำ listener ทุกตัวให้ปลอดภัย** เข้ารหัสด้วย TLS ยืนยันตัวตน client ด้วย mutual TLS หรือ SASL (SCRAM-SHA-256 หรือ -512, OAUTHBEARER, GSSAPI สำหรับ Kerberos หรือ PLAIN ที่เอกสารบอกให้ใช้แค่บน TLS) และให้สิทธิ์ด้วย ACL บน topic และ group ส่วน Amazon MSK ยังมี IAM access control ให้ด้วย
- **เขียน consumer ให้รับการส่งซ้ำได้** commit offset หลังประมวลผล ทำให้การประมวลผล idempotent และเรียก `poll()` อีกครั้งภายใน `max.poll.interval.ms` (default 5 นาที) ไม่อย่างนั้น consumer จะถูกมองว่าล่ม และ partition ของมันจะถูกแบ่งให้ตัวอื่น
- **อย่าเขียนสองที่** การเขียนลง database ของคุณแล้วค่อยเขียนลง Kafka อาจทำให้ event หายหรือซ้ำถ้าฝั่งใดฝั่งหนึ่ง fail ให้ใช้ [transactional outbox](../transactional-outbox/) หรือ [change data capture](../change-data-capture/) แทน
