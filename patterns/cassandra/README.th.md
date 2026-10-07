## ปัญหา

Acme Shop บันทึก event ทุกครั้งที่พัสดุขยับ: รับพัสดุแล้ว คัดแยกแล้ว กำลังขนส่ง กำลังนำส่ง และส่งถึงแล้ว นั่นคือ write เล็ก ๆ วันละหลายล้านครั้ง ที่เข้ามาทั้งที่กรุงเทพฯ และสิงคโปร์ ส่วนลูกค้าก็ถามคำถามเดิมซ้ำ ๆ ว่า event ล่าสุดของ shipment ฉันคืออะไร ถ้าใช้ relational database ที่มี primary ตัวเดียว ทุก write จะไปลงเครื่องเดียวใน region เดียว ฝั่งสิงคโปร์ต้องเสีย round trip ข้าม region ทุก event ตัว disk กับ CPU ของ primary จะเป็นเพดานของอัตราการเขียน และ failover จะหยุด write ไว้ระหว่างที่ promote replica ขึ้นมา

Apache Cassandra กระจายข้อมูลไปบน ring ของ node ที่เท่าเทียมกันในหลาย data centre ทุก node รับทั้ง read และ write ส่วนทุก partition ถูกก็อปไปไว้บน node จำนวนที่กำหนดในแต่ละ data centre และแต่ละ request ก็บอกเองว่าต้องมีสำเนากี่ชุดตอบกลับ บนแต่ละ node ตัว write ถูกต่อท้าย log และใส่ลง table ใน memory ทำให้การเขียนเป็น I/O แบบ sequential แทนที่จะเป็นการแก้ข้อมูลในที่เดิม ราคาที่ต้องจ่ายคือ data model ที่สร้างรอบ query ที่รู้ล่วงหน้า Avinash Lakshman กับ Prashant Malik สร้าง Cassandra ที่ Facebook สำหรับ Inbox Search โดยรวมการแบ่ง partition และ replication ของ Dynamo เข้ากับ storage model ของ Bigtable ตอนนี้มันเป็นโปรเจกต์ของ Apache Software Foundation ภายใต้ Apache License 2.0

## ทำงานยังไง

### Table, partition และ CQL

ข้อมูลอยู่ใน **table** ที่จัดกลุ่มอยู่ใน **keyspace** และ keyspace เป็นตัวกำหนด replication ตัว primary key ของ table มีสองส่วน ส่วนแรกคือ **partition key** (ที่นี่คือ `shipment_id`) ที่กำหนดว่า row ไปอยู่ที่ไหน: row ทั้งหมดที่มีค่านี้ร่วมกันรวมเป็น **partition** เดียว เก็บไว้ด้วยกันบน replica ชุดเดียวกัน ส่วน **clustering column** (ที่นี่คือ `event_time`) เรียง row ภายใน partition จากน้อยไปมาก เว้นแต่ `CLUSTERING ORDER BY` จะบอกเป็นอย่างอื่น และลำดับนี้เปลี่ยนไม่ได้หลังสร้าง table แล้ว นี่คือสิ่งที่ทำให้ Cassandra เป็น wide-column store: partition หนึ่งเก็บได้หลาย row และแต่ละ row มีชุด column ของตัวเองได้

เราคุยกับ Cassandra ด้วย **CQL** ที่อ่านแล้วคล้าย SQL ตัว keyspace และ table ของ diagram:

```sql
CREATE KEYSPACE tracking WITH replication =
  {'class': 'NetworkTopologyStrategy', 'dc-bkk': 3, 'dc-sgp': 3};

CREATE TABLE tracking.shipment_events (
  shipment_id text,
  event_time  timestamp,
  status      text,
  PRIMARY KEY ((shipment_id), event_time)
) WITH CLUSTERING ORDER BY (event_time DESC);

-- cqlsh command; drivers set the consistency level per session or per statement
CONSISTENCY LOCAL_QUORUM;

INSERT INTO tracking.shipment_events (shipment_id, event_time, status)
  VALUES ('S-77', '2026-10-07 09:12+0700', 'out for delivery');

-- the newest 10 events: one slice of one partition
SELECT event_time, status FROM tracking.shipment_events
  WHERE shipment_id = 'S-77' LIMIT 10;

-- returns 4480090637218407206, the token of the diagram
SELECT token(shipment_id) FROM tracking.shipment_events
  WHERE shipment_id = 'S-77' LIMIT 1;
```

ทุกค่ามี write timestamp ติดอยู่ และเมื่อ write สองตัวแก้ column เดียวกันของ row เดียวกัน timestamp ที่ใหม่กว่าจะชนะ (**last write wins**) ความถูกต้องของ Cassandra เลยขึ้นกับนาฬิกา: ต้องรัน NTP ทั้งบน client และ node การเปลี่ยนแปลงของ statement เดียวภายใน partition เดียวถูก apply แบบ atomic และ isolated แต่ไม่มี join และไม่มี transaction ข้าม partition ส่วน write แบบมีเงื่อนไขก็มีแค่ compare-and-set ภายใน partition เดียวของ lightweight transaction (ดูด้านล่าง)

### ออกแบบ data model จาก query

query หนึ่งควรอ่าน partition เดียว เราเลยออกแบบ table จาก query ไม่ใช่จาก entity แต่ละ query ที่แอปรันจะได้ table ของตัวเอง โดยมี partition key เป็นค่าที่ query นั้นใช้ filter แล้วก็ไม่มี join: คู่มือ data modelling แนะนำให้เขียน table ที่สองแบบ denormalize ดีกว่า join ฝั่ง client ถ้า hub ของ Acme Shop ต้องการพัสดุทุกชิ้นที่ผ่าน hub หนึ่งในวันหนึ่งด้วย นั่นก็คือ table ที่สอง แบ่ง partition ตาม hub และวัน โดยที่ service tracking เขียนลงไปพร้อมกับ `shipment_events` ถ้าพูดด้วยคำของ catalog นี้ table แบบนี้แต่ละตัวก็คือ [materialized view](../materialized-view/) ที่แอปดูแลเอง

ทำให้ partition มีขนาดจำกัดและกระจายตัว เพดานจริงคือ 2 พันล้าน cell ต่อ partition แต่คู่มือเตือนว่า performance แย่ลงตั้งนานก่อนถึงตรงนั้น ถ้า partition มีโอกาสโตไปเรื่อย ๆ ไม่มีวันจบ (event ทั้งหมดของ hub หนึ่ง) ให้เพิ่ม time bucket เข้าไปใน partition key ส่วน event ของ shipment หนึ่งมีไม่มากอยู่แล้ว ที่นี่เลยใช้ `shipment_id` อย่างเดียวก็พอ partition key ที่มีค่าไม่ซ้ำกันเยอะ ๆ ยังช่วยกระจายโหลดไปทั่ว ring ได้เท่า ๆ กันด้วย

secondary index มีให้ใช้: แบบดั้งเดิม และตั้งแต่ 5.0 ก็มี **Storage-Attached Index (SAI)** ที่ index แต่ละ memtable และ SSTable ตอนที่มันถูกเขียน ทั้งสองแบบเป็น index ประจำแต่ละ node ทำให้ query ที่ไม่ได้ระบุ partition key ยังต้องถาม node ไปทั่ว cluster ส่วน `ALLOW FILTERING` ไปไกลกว่านั้นอีก: มันยอมให้ query scan ทั้ง table และ filter ไประหว่างทาง แล้วเอกสาร CQL ก็เรียกมันว่าคาดเดาไม่ได้ ให้ถือว่ามันเป็นสัญญาณเตือนในโค้ดของแอป

### Token ring และ virtual node

**partitioner** แปลง partition key เป็น **token** ตัว default คือ `Murmur3Partitioner` ที่ hash key เป็นตัวเลข 64-bit ตั้งแต่ −2⁶³ ถึง 2⁶³−1 และช่วงนี้ถูกมองเป็น ring แต่ละ node จองตำแหน่งบน ring และเป็นเจ้าของช่วงที่จบที่แต่ละตำแหน่งนั้น: key หนึ่งเป็นของ node แรกที่เจอเมื่อเดินตามเข็มนาฬิกาจาก token ของมัน สำหรับ text key `S-77` ตัว token คือ 4480090637218407206 และใน diagram มันตกอยู่ในช่วงของ bkk-2 ให้เลือก partitioner ครั้งเดียว เพราะการเปลี่ยนมันหมายถึงต้องโหลดข้อมูลใหม่ทั้งหมด

ตั้งแต่ Cassandra 4.0 node หนึ่งจองตำแหน่ง 16 ตำแหน่งเป็น default (`num_tokens: 16` ลดลงจาก 256) เรียกว่า **virtual node** และถ้าตั้ง `allocate_tokens_for_local_replication_factor: 3` อัลกอริทึมจัดสรรก็จะวางตำแหน่งเหล่านี้ให้โหลดออกมาเท่า ๆ กันสำหรับ 3 replica ช่วงเล็ก ๆ จำนวนมากแปลว่า node ใหม่จะดึงข้อมูลมานิดหน่อยจาก node อื่นหลายตัว และ traffic ของ node ที่ล่มก็กระจายไปที่ node ที่รอดอยู่หลายตัว เอกสารก็บอกต้นทุนไว้: token ที่เพิ่มแต่ละตัวเพิ่มเพื่อนบ้านบน ring ทำให้มีรูปแบบการล่มพร้อมกันมากขึ้นที่ทำให้ข้อมูลบางส่วนใช้ไม่ได้ และงาน maintenance ทั้ง cluster ก็ช้าลง ส่วน diagram วาดช่วงของแต่ละ node รวมเป็นช่วงเดียว

### Replication: strategy, snitch และ rack

แต่ละ keyspace มี **replication strategy** ตัว `NetworkTopologyStrategy` รับ replication factor ต่อ data centre และเอกสารแนะนำให้ใช้กับ cluster ใน production ทุกตัว แม้จะมี data centre เดียวก็ตาม เพราะแบบนี้การเพิ่ม data centre ทีหลังก็แค่แก้ map มันเดิน ring ตามเข็มนาฬิกาจาก token และเลือก node ที่ไม่ซ้ำกันในแต่ละ data centre โดยให้อยู่คนละ rack ถ้าทำได้ ส่วน `SimpleStrategy` ไม่สนใจ data centre และ rack และมีไว้สำหรับ cluster ทดสอบ แล้วใน 5.0 ก็ตั้ง guardrail ให้ห้ามใช้มันได้ด้วย node รู้ data centre และ rack ของกันและกันจาก **snitch**: ตัว `GossipingPropertyFileSnitch` ที่แนะนำสำหรับ production อ่านค่าเหล่านี้จาก `cassandra-rackdc.properties` ของแต่ละ node และกระจายมันผ่าน gossip ส่วนบน cloud คนดูแลระบบหลายคนถือว่าแต่ละ availability zone เป็น rack หนึ่ง

ใน diagram แต่ละ data centre มี 3 node และ 3 replica ทำให้ทุก node เก็บทุก partition และ ring ก็กำหนดแค่ลำดับของ replica ถ้ามี 12 node ใน dc-bkk ตัว token จะเลือก 3 จาก 12 ตัว

### Consistency level และ R + W > RF

ทุก read และ write มี **consistency level** ติดไปด้วย: ต้องมี replica ตอบกี่ตัวก่อนที่ coordinator (node ที่รับ request) จะตอบกลับ

| Level | รออะไร | ใน cluster นี้ (3 replica ต่อ data centre) |
|---|---|---|
| `ONE`, `TWO`, `THREE` | replica ตามจำนวนนั้น ใน data centre ไหนก็ได้ | replica ที่เร็วที่สุด ไม่ว่าจะอยู่ที่ไหน |
| `LOCAL_ONE` | replica หนึ่งตัวใน data centre ของ coordinator | replica local 1 ตัว ส่วน read ไม่ไปที่อีก data centre เลย |
| `QUORUM` | เสียงข้างมากของ replica ทั้งหมด | 4 จาก 6 อย่างน้อยหนึ่งตัวเลยอยู่ในอีก data centre |
| `LOCAL_QUORUM` | เสียงข้างมากใน data centre ของ coordinator | 2 จาก 3 แบบ local |
| `EACH_QUORUM` | เสียงข้างมากในทุก data centre | 2 จาก 3 ใน dc-bkk และ 2 จาก 3 ใน dc-sgp |
| `ALL` | ทุก replica | ครบทั้ง 6: node ช้าตัวเดียวก็ทำให้ request fail |
| `ANY` | replica หนึ่งตัว หรือ hint ที่ coordinator เก็บไว้ (เฉพาะ write) | รอดได้แม้ replica ล่มทุกตัว แต่ read อาจไม่เห็น write นั้น |

`SERIAL` กับ `LOCAL_SERIAL` กำหนด consistency ของรอบ Paxos ใน lightweight transaction

write ถูกส่งไปที่ทุก replica เสมอ ส่วน level แค่กำหนดว่า coordinator จะรอ acknowledgement กี่ตัว ฝั่ง read จะถามแค่ replica เท่าที่ level ต้องการ: ตัวหนึ่งส่งข้อมูลกลับมา ส่วนตัวอื่นส่ง digest (hash ของข้อมูล) ถ้าไม่ตรงกัน coordinator จะเขียน version ใหม่สุดกลับไปที่ replica ที่มีข้อมูลเก่าก่อนจะตอบ (blocking read repair ค่า default คือ `read_repair = 'BLOCKING'`)

เลือก level ให้ replica ที่เขียนกับ replica ที่อ่านซ้อนกัน: **R + W > RF** แล้วใน data centre เดียวที่มี 3 replica การเขียนและอ่านที่ `QUORUM` ก็ได้ 2 + 2 > 3 ทำให้ทุก read มี replica อย่างน้อยหนึ่งตัวที่มี write ล่าสุดที่ acknowledge แล้ว ถ้าข้าม data centre การใช้ `LOCAL_QUORUM` ทั้งสองฝั่งให้การรับประกันแบบเดียวกันภายใน data centre เดียว: ลูกค้าในกรุงเทพฯ อ่านสิ่งที่ service tracking ในกรุงเทพฯ เขียนไว้ ส่วนคนอ่านในสิงคโปร์จะเห็นมันเมื่อสำเนาไปถึง ปกติก็ไม่นาน แต่ไม่มีอะไรรอสิ่งนั้น และถ้าทั้งสอง data centre เขียน column เดียวกันในเวลาเดียวกัน timestamp ที่ใหม่กว่าจะชนะ

### Write path

บนแต่ละ replica ตัว write ผ่านสองขั้นก่อนจะถูก acknowledge:

1. ถูกต่อท้าย **commit log** เป็น log แบบ sequential หนึ่งตัวบน disk ที่ทุก table ใช้ร่วมกัน แบ่งเป็น segment ละ 32 MiB เป็น default ถ้าใช้ค่า default `commitlog_sync: periodic` ตัว write จะถูก acknowledge ทันที และ log จะ sync ลง disk ทุก `commitlog_sync_period` (default 10 วินาที) ทำให้ node ที่ crash อาจเสีย write ใหม่สุดไปได้มากสุดเท่ากับช่วงเวลานั้น แต่ replica ตัวอื่นยังเก็บ write พวกนั้นไว้อยู่ ส่วนโหมด `batch` จะรอ sync ก่อน
2. ถูกใส่ลง **memtable** ของ table นั้น เป็นโครงสร้างใน memory ที่เรียงตาม partition key และ clustering key

เมื่อ memtable ใช้ memory มากเกินไป หรือ commit log ต้องการที่ว่าง memtable จะถูก **flush**: เขียนออกมาตามลำดับเป็น **SSTable** (sorted string table) ใหม่ เป็นชุดไฟล์ที่แก้ไม่ได้ ที่เก็บตัวข้อมูล, partition index, bloom filter ของ partition key, สถิติ และอื่น ๆ จากนั้น segment ของ commit log ที่มันครอบคลุมอยู่ก็เอาไปใช้ใหม่ได้ ไม่มีอะไรบน disk ถูกแก้ในที่เดิมเลย การ update หรือ delete ก็แค่เป็น entry ที่ใหม่กว่า design นี้คือ log-structured merge tree และเป็นเหตุผลที่การเขียนมีต้นทุนต่ำ ส่วนการอ่านต้องทำงานมากขึ้นอีกหน่อย

### Read path

เพื่อตอบ `SELECT … WHERE shipment_id = 'S-77' LIMIT 10` ตัว replica จะดูใน memtable และใน SSTable ทุกตัวที่อาจมี partition นี้อยู่ ตัว **bloom filter** ของแต่ละ SSTable ตอบว่า "ไม่มีแน่นอน" หรือ "อาจมี" ทำให้ไฟล์ส่วนใหญ่ที่ไม่มี S-77 ถูกข้ามไปโดยไม่ต้องอ่าน ส่วนอัตรา false positive ตั้งได้ต่อ table ด้วย `bloom_filter_fp_chance` แล้วในไฟล์ที่เหลือ partition index ก็จะหาว่า S-77 เริ่มตรงไหน เพราะทุกไฟล์เก็บ row ของ partition เรียงตาม clustering order (ที่นี่คือใหม่ไปเก่า) replica เลยอ่านแค่ช่วงสั้น ๆ ช่วงเดียวจากแต่ละไฟล์แล้ว merge กัน โดยเก็บ version ใหม่สุดของแต่ละ cell และทิ้งสิ่งที่ tombstone ครอบไว้ ยิ่ง read ต้องแตะ SSTable มาก ก็ยิ่งช้า และ compaction คือสิ่งที่คอยกดจำนวนนั้นไว้

Cassandra 5.0 เพิ่ม SSTable format แบบ trie-indexed (BTI) ที่ตัด index summary ออก ไม่ต้องใช้ key cache และหา row ได้เร็วแม้ใน partition ที่มี row เป็นล้าน และเพิ่ม memtable แบบ trie ที่ใช้ memory น้อยกว่าและสร้าง garbage ให้ JVM เก็บน้อยกว่า ทั้งสองอย่างต้อง opt in ใน `cassandra.yaml` ของ 5.0 (`sstable: selected_format: bti` และการตั้งค่า memtable แบบ `trie`) และเปิดไว้ใน `cassandra_latest.yaml` ไฟล์ configuration ตัวที่สองที่ release มาด้วย เพื่อให้ลองค่า default ใหม่สุด

### Compaction

**Compaction** merge SSTable อยู่เบื้องหลัง: มันอ่านหลายไฟล์ เก็บ version ใหม่สุดของแต่ละ cell ทิ้งข้อมูลที่ tombstone ครอบไว้และ tombstone ที่เก่าพอแล้ว เขียน SSTable ใหม่ แล้วลบตัวเก่า strategy ตั้งได้ต่อ table:

- **SizeTieredCompactionStrategy (STCS)** merge SSTable ที่ขนาดใกล้ ๆ กัน มันเป็น default ใน `cassandra.yaml` เป็นตัวสำรองเมื่อไม่มีตัวอื่นที่เหมาะกว่า
- **LeveledCompactionStrategy (LCS)** เหมาะกับ table ที่อ่านเยอะ และ table ที่มี update กับ delete เยอะ แต่เสีย compaction I/O มากกว่า
- **TimeWindowCompactionStrategy (TWCS)** จัด SSTable เป็นกลุ่มตาม time window และทิ้ง SSTable ทั้งไฟล์เมื่อข้อมูลทั้งหมดในนั้นหมดอายุ มันออกแบบมาสำหรับ time series ที่เขียนพร้อม TTL อย่าง `shipment_events`
- **UnifiedCompactionStrategy (UCS)** ใหม่ใน 5.0 ปรับให้ทำตัวเหมือน strategy แบบ tiered หรือ leveled ได้ (`scaling_parameters` เช่น `T4` หรือ `L10`) และ compact แบบขนานได้มากกว่า เอกสาร 5.0 แนะนำให้ใช้กับ workload ส่วนใหญ่ และมันเป็น default ใน `cassandra_latest.yaml`

DateTieredCompactionStrategy ถูกถอดออกใน 5.0 แล้ว table ที่ยังใช้มันอยู่ต้องย้ายไป TWCS ก่อน upgrade

### Tombstone และ gc_grace_seconds

`DELETE` หรือ TTL ที่หมดอายุ ไม่ได้ลบข้อมูลออก: มันทิ้ง **tombstone** ไว้ เป็น marker ที่มี timestamp และคอยซ่อนข้อมูลที่เก่ากว่าระหว่าง read และ merge ตัว tombstone ถูกเก็บไว้ตาม `gc_grace_seconds` ของ table (default 864000 คือ 10 วัน) และจะถูกลบโดย compaction หลังจากนั้นเท่านั้น ช่วง grace นี้กันปัญหา replica ที่พลาด delete ไป: ถ้า tombstone หายไปก่อนที่ทุก replica จะได้มัน repair จะก็อปค่าเก่ากลับมาจาก replica ที่ไม่เคยเห็น delete นั้น แล้วข้อมูลที่ลบไปแล้วก็จะกลับมาเป็น "zombie" เลยมีกฎว่าต้อง repair ทุก node อย่างน้อยหนึ่งครั้งภายใน `gc_grace_seconds` ถ้าใช้ค่า default เอกสารเรื่อง repair แนะนำให้ทำอย่างน้อยทุก 7 วัน

tombstone ยังทำให้ read ช้าด้วย เพราะ query ต้องอ่าน tombstone ทุกตัวในช่วงที่มัน scan ตัว Cassandra จะเตือนเมื่อ query หนึ่ง scan เกิน 1,000 ตัว (`tombstone_warn_threshold`) และทำให้ query fail ที่ 100,000 ตัว (`tombstone_failure_threshold`) การใช้ table เป็น queue (insert row อ่าน แล้วลบ) คือทางคลาสสิกที่จะไปถึงตัวเลขพวกนั้น และ `cassandra.yaml` ก็ชี้ถึง anti-pattern นี้ไว้ข้าง ๆ threshold

### Hint, read repair และ anti-entropy repair

replica รับ write โดยไม่ได้ตกลงกันก่อน มันเลยค่อย ๆ ไม่ตรงกันได้ แล้วมีสามกลไกที่ดึงมันกลับมาตรงกัน:

- **Hinted handoff** เมื่อ replica ล่ม หรือ write ไปหามัน timeout ตัว coordinator จะเก็บ **hint** ไว้บน disk ของตัวเอง แล้ว replay ให้ตอน replica กลับมา เหมือนที่ bkk-1 ทำให้ bkk-3 ในขั้นที่ 4 ส่วน hint จะถูกสร้างแค่ในช่วง `max_hint_window` แรกของการล่ม (default 3 ชั่วโมง) และเป็นแบบ best effort
- **Read repair** เมื่อ read เจอ replica ที่ไม่ตรงกัน coordinator จะอัปเดตตัวที่มีข้อมูลเก่าก่อนจะตอบ (`read_repair = 'BLOCKING'` เป็น default ส่วน `'NONE'` ปิดมัน)
- **Anti-entropy repair** ตัว `nodetool repair` สร้าง Merkle tree (tree ของ hash) บนข้อมูลของแต่ละ replica เทียบกัน แล้ว stream ช่วงที่ต่างกัน ตัว incremental repair ที่เป็น default ครอบคลุมแค่ข้อมูลที่เขียนหลัง incremental repair ครั้งก่อน ส่วน `nodetool repair --full` ครอบคลุมทุกอย่าง และ `-pr` จำกัดการรันให้อยู่แค่ primary range ของ node ทำให้การรันบนทุก node ไม่ทำงานซ้ำกัน เอกสารแนะนำจุดเริ่มต้นไว้ที่ incremental repair ทุก 1 ถึง 3 วัน และ full repair ทุก 1 ถึง 3 สัปดาห์ จนกว่าจะถึง 6.0 ที่เพิ่ม repair scheduler ในตัว (CEP-37) คนดูแลระบบต้องตั้งเวลา repair เอง

### Gossip และการตรวจจับ failure

ไม่มี master คอยติดตาม cluster ส่วนแต่ละ node จะเพิ่ม heartbeat ของตัวเองทุกวินาที และแลก state กับ peer ที่สุ่มเลือกมา แลกกับ seed node ด้วยถ้า peer ตัวนั้นไม่ใช่ seed และบางครั้งก็แลกกับ node ที่ติดต่อไม่ได้ ทำให้ membership, token และ schema version กระจายจาก node สู่ node แต่ละ node รัน **phi accrual failure detector** บน heartbeat ที่มันได้ยิน และตัดสินเองว่า peer ล่มเมื่อไร (`phi_convict_threshold` default 8) และการตัดสินนี้ไม่ได้ถูก gossip ต่อ ส่วน node ที่ล่มยังอยู่ใน ring จนกว่าคนดูแลระบบจะ decommission หรือ replace มัน ทำให้การ restart ไม่ทำให้ข้อมูลย้ายไปมา seed node คือ node ธรรมดาที่ node ใหม่ติดต่อเพื่อเข้าร่วม และรอบ gossip ก็เลือกหามันบ่อยกว่า ปกติจะมีไม่กี่ตัวต่อ data centre และมักเป็นหนึ่งตัวต่อ rack ส่วน Cassandra 6.0 ย้าย membership, ความเป็นเจ้าของ token และการเปลี่ยน schema ไปไว้บน metadata log แบบ linearized (Transactional Cluster Metadata, CEP-21)

### Lightweight transaction

สำหรับ write ส่วนน้อยที่ห้ามแข่งกับ write อื่น CQL มี **lightweight transaction (LWT)**: เงื่อนไขบน `INSERT`, `UPDATE` หรือ `DELETE` ภายใน partition เดียว เช่น `IF NOT EXISTS` ที่ถูกเช็กและ apply แบบ atomic ผ่านรอบ Paxos ระหว่าง replica ของ partition นั้น มันแพง ถ้าใช้ค่า default `paxos_variant: v1` ตัว conditional write ใช้ 4 round trip และ serial read ใช้ 3 ส่วน v2 ที่มีตั้งแต่ 4.1 และตั้งไว้ใน `cassandra_latest.yaml` ใช้แค่ 2 สำหรับ write ส่วน Acme Shop จะใช้มันเพื่อจอง shipment ID ใหม่ให้ได้แค่ครั้งเดียวพอดี ไม่ใช่ใช้กับทุก scan

transaction แบบทั่วไปกำลังมา **Accord** (CEP-15) เพิ่ม block `BEGIN TRANSACTION` ที่อ่านและเขียนได้หลาย partition ด้วย isolation แบบ strict-serializable โดยออกแบบให้ใช้ round trip ข้าม wide-area แค่ครั้งเดียวในกรณีปกติ มันมากับ Cassandra 6.0 ที่ตอนเขียนหน้านี้ยังเป็น alpha release (6.0-alpha2 สิงหาคม 2026) ทำให้ cluster 5.0 มีแค่ lightweight transaction

### หลาย data centre

cluster เดียวขยายข้ามหลาย data centre ได้ แต่ละที่มี replication factor และ client ของตัวเอง:

- client ใช้ data centre ที่เป็น local ของตัวเอง ส่วน load-balancing policy แบบ default ของ Java driver ของ Apache Cassandra ต้องระบุชื่อ local data centre (`basic.load-balancing-policy.local-datacenter`) และเป็นแบบ token-aware: มันส่งแต่ละ request ไปที่ replica ของ partition นั้น
- ที่ `LOCAL_ONE` และ `LOCAL_QUORUM` ตัว request รอแค่ replica local ส่วน `QUORUM` กับ `EACH_QUORUM` รออีก data centre ด้วย
- coordinator ส่ง write ไปที่ replica local ตรง ๆ และส่งไปที่ replica หนึ่งตัวในแต่ละ data centre ที่อยู่ไกล แล้วตัวนั้นก็ส่งต่อให้ตัวอื่นที่นั่น ทำให้ write ข้าม WAN แค่ครั้งเดียวต่อ data centre (`StorageProxy` ใน source ของ 5.0)
- ทั้งสอง data centre รับ write ของ partition เดียวกัน และ write ที่มาพร้อมกันบน column เดียวกันถูกตัดสินด้วย timestamp ไม่ใช่ด้วย primary
- ถ้า data centre ทั้งที่หายไป อีกที่ก็ยังให้บริการต่อได้ที่ level `LOCAL_*` พอมันกลับมา hint จะครอบคลุม 3 ชั่วโมงแรก (default) แล้ว repair ก็จัดการที่เหลือ

### สิ่งที่ 5.0 เพิ่มเข้ามา และสิ่งที่กำลังจะมา

Cassandra 5.0 ออกเป็น generally available เมื่อ 5 กันยายน 2024 พร้อม Storage-Attached Index, vector search (column type `vector<float, n>` และ query แบบ approximate-nearest-neighbour ผ่าน SAI), memtable แบบ trie และ SSTable แบบ trie-indexed, Unified Compaction Strategy, การรองรับ JDK 17 และ dynamic data masking ส่วนสาย 3.0 และ 3.11 ก็ถึง end of life ไปพร้อมกัน ส่วน ณ ตุลาคม 2026 release ที่ยังดูแลอยู่คือ 5.0.9, 4.1.12 และ 4.0.21 ทั้งหมดออกเดือนสิงหาคม 2026 ถ้าไม่ปรับอะไร `cassandra.yaml` ของ 5.0 จะใช้ตัวเลือกที่ compatible กับ 4.x (memtable แบบ skip-list, SSTable format แบบ BIG, STCS, Paxos v1 และ `storage_compatibility_mode: CASSANDRA_4`) ทำให้เราต้อง opt in เพื่อใช้ format ใหม่ ส่วน Cassandra 6.0 ที่อยู่ใน alpha เพิ่ม Accord, Transactional Cluster Metadata, repair ในตัว และการรองรับ JDK 21 อย่างเป็นทางการ

## อยู่ตรงไหนใน solution

- **Solution** ข้อมูลที่เขียนเยอะ เรียงตามเวลา และอ่านด้วย key: tracking event แบบของ Acme Shop, telemetry ของอุปกรณ์, activity feed และประวัติ message โดยเฉพาะเมื่อข้อมูลชุดเดียวกันต้องเขียนได้ในหลาย region พร้อมกัน
- **Pattern ที่มัน implement หรือช่วยรองรับ** [Sharding](../sharding/) ในตัว: token ring คือ consistent hashing ทำให้ partition key ไปลงที่ช่วง token ได้คล้ายกับที่ key ไปลง bucket ของ [hash table](../hash-table/) และการเพิ่ม node ก็ย้ายข้อมูลแค่ส่วนหนึ่งของเพื่อนบ้าน แทนที่จะสับทุกอย่างใหม่ [Multi-region active-active](../multi-region-active-active/): ทุก data centre รับ write และ conflict ถูกตัดสินด้วย timestamp ส่วนการใช้หนึ่ง table ต่อหนึ่ง query ก็คือไอเดียของ [materialized view](../materialized-view/) ที่แอปทำเอง และฝั่ง read ของ [CQRS](../cqrs/) ก็มักไปลงที่ table แบบนี้ ส่วน materialized view ของ Cassandra เองยังเป็น experimental และปิดไว้โดย default (`materialized_views_enabled: false`) สำหรับ [event sourcing](../event-sourcing/) การใช้หนึ่ง partition ต่อหนึ่ง entity โดยมี sequence number เป็น clustering column ก็เป็น event stream ได้อย่างเป็นธรรมชาติ แต่การปฏิเสธ append ที่ version เก่าต้องใช้ lightweight transaction ทุกครั้งที่เขียน และต่างจาก [read replica](../read-replicas/) ตรงที่สำเนาทุกชุดที่นี่รับ write ด้วย
- **เพื่อนบ้านที่มักเจอ** service ที่เขียนผ่าน driver ที่ตั้ง data centre ของตัวเองไว้, log อย่าง [Kafka](../kafka/) ที่อยู่ข้างหน้าเพื่อรับ burst และป้อน consumer อื่น, search engine อย่าง [Elasticsearch](../elasticsearch/) สำหรับ query แบบ ad hoc ที่ Cassandra ตอบไม่ได้ และ analytics store ที่โหลดข้อมูลเป็นก้อน
- **Managed offering** **Amazon Keyspaces (for Apache Cassandra)** เป็น AWS service แบบ serverless ที่ compatible กับ CQL 3.11 API และใช้กับ Cassandra driver ที่มีอยู่ได้ (ต้องตั้งค่าให้เข้ากับมัน): ไม่มี node ให้ดูแล ส่วน capacity เป็นแบบ on-demand หรือ provisioned ทุก write ถูกเก็บสามชุดข้าม Availability Zone ที่ `LOCAL_QUORUM` ส่วน read ใช้ `ONE`, `LOCAL_ONE` หรือ `LOCAL_QUORUM` และ replication แบบ multi-Region เป็น active-active แบบ last-writer-wins แล้ว AWS ก็บอกว่า lightweight transaction ไม่มี performance penalty มันตัดบางอย่างออก: ไม่มี `CREATE INDEX`, materialized view, user-defined function หรือ trigger ตัว row ใหญ่ได้ไม่เกิน 1 MB และการตั้งค่า compaction, compression, caching และ bloom filter จะถูกเมิน ส่วน **Astra DB** เป็น database แบบ serverless ที่สร้างบน Cassandra พร้อม vector search จาก DataStax ตัว IBM ประกาศซื้อ DataStax ในเดือนกุมภาพันธ์ 2025 และตอนนี้ขาย Astra DB และ Hyper-Converged Database (HCD สำหรับ cluster ที่ดูแลเอง) ในชื่อ IBM DataStax
- **License (ตุลาคม 2026)** Apache Cassandra อยู่ภายใต้ Apache License 2.0 ส่วน ScyllaDB เป็น database ที่ compatible กับ Cassandra เขียนด้วย C++ บน framework Seastar (หนึ่ง thread ต่อ CPU core โดยไม่แชร์อะไรกัน) ได้ย้ายไปใช้ license แบบ source-available ตั้งแต่ release 2025.1 และ ScyllaDB OSS 6.2 เป็น release สุดท้ายที่เป็น AGPL

## ใช้ตอนไหนดี

เลือก Cassandra เมื่อ write มีเยอะและมาสม่ำเสมอ ทุก query ระบุ partition key ได้ ข้อมูลต้องเขียนได้ในหลาย region พร้อมกัน และ primary ตัวเดียวจะเป็นคอขวดหรือเป็น point of failure งาน tracking ของ Acme Shop เข้าข่ายนี้: หนึ่ง partition ต่อหนึ่ง shipment และอ่านแบบเดิมทุกครั้ง ให้มองหาตัวอื่นเมื่อ query เป็นแบบ ad hoc หรือแบบ relational (join, report, filter ที่ยืดหยุ่น: ใช้ relational database อย่าง [PostgreSQL](../postgresql/)) เมื่อข้อมูลอยู่บน server เครื่องเดียวได้สบาย ๆ เมื่อต้องการ transaction ข้าม partition ตอนนี้เลย หรือเมื่อ key เดิม ๆ ถูก update และ delete อยู่ตลอดเวลา

| | Apache Cassandra | ScyllaDB | [Amazon DynamoDB](../amazon-dynamodb/) | [MongoDB](../mongodb/) |
|---|---|---|---|---|
| Data model | row ใน partition เรียงตาม clustering column (CQL) | model แบบ CQL เดียวกัน และมี API ที่ compatible กับ DynamoDB ด้วย (Alternator) | item ขนาดไม่เกิน 400 KB ภายใต้ partition key และ sort key (ถ้ามี) | document แบบ BSON ขนาดไม่เกิน 16 MiB ใน collection |
| ใครรับ write | ทุก replica ไม่มี primary | ทุก replica ไม่มี primary | ตัว service ที่ route ตาม partition key | primary ของแต่ละ replica set |
| Consistency | เลือกต่อ request ตั้งแต่ `ONE` ถึง `ALL` และใช้ last write wins | เลือกต่อ request ด้วย level ชุดเดียวกัน | read เป็น eventually consistent โดย default และเป็น strongly consistent ได้ถ้าขอ | read concern และ write concern ส่วน read ไปที่ primary โดย default |
| หลาย region | มีในตัว: cluster เดียวข้ามหลาย data centre และเขียนได้ทุกที่ | มีในตัว เหมือน Cassandra | Global table: multi-Region แบบ eventual (last writer wins) หรือ strong consistency | สมาชิกของ replica set อยู่ได้หลาย region แต่ write ไปที่ primary |
| Transaction | compare-and-set ภายใน partition เดียว (LWT, Paxos) ส่วน Accord อยู่ใน 6.0 ที่ยังเป็น alpha | LWT ภายใน partition เดียว (Paxos) | ได้ถึง 100 action ใน transaction เดียว | ACID transaction ข้ามหลาย document |
| รันแบบไหน (ตุลาคม 2026) | ดูแลเองภายใต้ Apache License 2.0, Amazon Keyspaces, Astra DB | ดูแลเองภายใต้ license แบบ source-available (ฟรีถึง 10 TB และ 50 vCPU สำหรับองค์กรที่ไม่ได้เป็นลูกค้าที่จ่ายเงินมาไม่นานนี้), ScyllaDB X Cloud | AWS เท่านั้น | ดูแลเองภายใต้ SSPL, MongoDB Atlas และ Amazon DocumentDB ก็ implement API ของมัน |

ตัวเลขและเงื่อนไขจากเอกสารและ license ของ Apache Cassandra 5.0, ScyllaDB, Amazon DynamoDB และ MongoDB เดือนตุลาคม 2026

## ได้อะไร เสียอะไร

- **query ถูกตรึงไว้ใน schema** query ใหม่มักต้องมี table ใหม่และต้อง backfill ส่วนการวิเคราะห์แบบ ad hoc ต้องใช้อีกระบบ
- **consistency เป็นตัวเลือกต่อ request** `LOCAL_QUORUM` ปลอดภัยภายใน data centre แต่คนอ่านในอีก data centre อาจเห็นข้อมูลเก่ากว่าอยู่สักพัก และเพราะ write ที่มาพร้อมกันถูกตัดสินด้วย timestamp นาฬิกาที่เพี้ยนก็ทำให้ write ที่เก่ากว่าชนะได้
- **delete ไม่ได้ฟรี** tombstone ทำให้ read ช้าจนกว่า compaction จะลบมันออกหลัง `gc_grace_seconds` และ repair ต้องเสร็จภายในช่วงนั้น ไม่อย่างนั้นข้อมูลที่ลบไปแล้วอาจกลับมา
- **partition ต้องมีขนาดจำกัดและสมดุล** partition ที่ใหญ่มากหรือ hot ตัวเดียวทำให้ replica ของมันรับไม่ไหว ไม่ว่า cluster จะใหญ่แค่ไหน
- **transaction แคบ** compare-and-set ภายใน partition เดียว แลกกับ round trip หลายรอบ และไม่มีอะไรข้าม partition ได้ก่อน 6.0
- **งาน operation เป็นงานจริง** ตารางเวลา repair, compaction strategy, การวางแผน capacity, rolling upgrade และการ tune JVM เป็นของคุณทั้งหมด ส่วน managed service รับส่วนใหญ่ไปให้ แต่ก็มีข้อจำกัดของตัวเองมาด้วย

## ข้อควรรู้ตอนลงมือทำ

- **เริ่มจาก query** ลิสต์มันออกมา ให้แต่ละตัวมี table ของตัวเอง และประเมินขนาด partition แล้วแบ่ง bucket ตามเวลาในที่ที่ partition อาจโตไม่มีที่สิ้นสุด
- **ใช้ baseline แบบ multi-DC ที่ durable:** `NetworkTopologyStrategy` ที่มี 3 replica ต่อ data centre, `LOCAL_QUORUM` สำหรับ read และ write, driver ที่ตั้ง data centre ของตัวเองไว้และใช้ routing แบบ token-aware และ map rack ให้ตรงกับ failure domain
- **ปล่อยให้ time series หมดอายุ** เขียน event พร้อม TTL และ compact ตาม time window ถ้าใช้ TTL 90 วัน เอกสาร TWCS แนะนำ window ละ 3 วัน รวมประมาณ 30 window:

  ```sql
  ALTER TABLE tracking.shipment_events
    WITH default_time_to_live = 7776000
    AND compaction = {'class': 'TimeWindowCompactionStrategy',
                      'compaction_window_unit': 'DAYS', 'compaction_window_size': 3};
  ```

  เลี่ยงการลบ event ทีละตัวบน hot path และอย่าใช้ table เป็น queue เด็ดขาด
- **ตั้งเวลา repair** (incremental ทุก 1 ถึง 3 วัน และ full ทุก 1 ถึง 3 สัปดาห์ คือจุดเริ่มต้นที่เอกสารแนะนำ) และให้แน่ใจว่าทุก node รันเสร็จหนึ่งรอบภายใน `gc_grace_seconds`
- **คอยดู** สถานะ node ด้วย `nodetool status` ดูจำนวน SSTable, partition ที่ใหญ่ที่สุด และ tombstone ต่อ slice ของแต่ละ table ด้วย `nodetool tablestats` แล้วก็ดู compaction ที่ค้างอยู่ hint ที่เก็บไว้ และ latency ของ read กับ write
- **เปิด security** `cassandra.yaml` แบบ default ให้ใครก็เข้าได้ (`authenticator: AllowAllAuthenticator`, `authorizer: AllowAllAuthorizer`): ให้ใช้ `PasswordAuthenticator` หรือ mutual TLS คู่กับ `CassandraAuthorizer` และเข้ารหัส traffic ทั้งฝั่ง client และระหว่าง node (`client_encryption_options`, `server_encryption_options`)
- **ทำให้นาฬิกาตรงกัน** ด้วย NTP เพราะ last write wins ตัดสินด้วย timestamp
- **upgrade ทีละ node** node 5.0 จะเริ่มใน `storage_compatibility_mode: CASSANDRA_4` ที่เขียนไฟล์แบบ compatible กับ 4.x พอทุก node รัน 5.0 แล้ว การ rolling restart ผ่าน `UPGRADING` ไปจนถึง `NONE` ก็จะเปิด format ใหม่และฟีเจอร์ใหม่ อย่าง TTL ที่ยาวไปถึงปี 2106
