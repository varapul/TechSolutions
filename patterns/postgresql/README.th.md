## ปัญหา

Acme Shop เหลือแก้วมัค MUG-1 อยู่เจ็ดใบ ในจังหวะเดียวกัน checkout ใน service Orders ก็ลดค่าในแถวนั้น, service Catalog อ่านมัน และงาน export ตอนกลางคืนก็รวมยอดทั้ง table database ที่อยู่ข้างหลังต้องทำสิ่งเหล่านี้ได้:

- เก็บทุกการเปลี่ยนแปลงที่ acknowledge ไปแล้วไว้ได้ แม้เครื่องจะล่มหรือไฟดับ
- ให้ reader กับ writer ทำงานกับแถวเดียวกันได้พร้อมกัน โดยไม่แสดงการเปลี่ยนแปลงที่ยังทำไม่เสร็จ และไม่ทำให้ต้องต่อคิวรอกัน
- ตอบคำถามใหม่ ๆ ด้วย SQL, join และ index ได้ โดยไม่ต้องออกแบบใหม่
- ส่งการเปลี่ยนแปลงของตัวเองต่อให้ replica, cache และ event stream ทำให้แอปไม่ต้องเขียนทุกอย่างสองรอบ

PostgreSQL คือ relational database แบบ open source ที่สร้างมาเพื่องานนี้ กลไกสามอย่างที่อยู่ใน diagram ทั้งหมดรับภาระส่วนใหญ่ไว้: multiversion concurrency control (MVCC), write-ahead log (WAL) และ replication ที่สร้างบน log นั้น ตัว PostgreSQL พัฒนาโดย PostgreSQL Global Development Group ภายใต้ PostgreSQL License ที่เป็น license แบบ permissive คล้าย BSD และ MIT และแต่ละ major version ได้รับการ support ห้าปี ส่วน ณ ตุลาคม 2026 release ปัจจุบันคือ PostgreSQL 18 (18.0 ออกเมื่อ 25 กันยายน 2025 และ 18.6 เป็น minor release ล่าสุด) ส่วน PostgreSQL 19 อยู่ในช่วง beta

## ทำงานยังไง

### Process และ memory

server เริ่มด้วย supervisor process หนึ่งตัวชื่อ **postmaster** ที่ fork **backend** process ตัวใหม่ให้ทุก client connection ตัว backend เป็นคน parse วางแผน และรัน query ของ session นั้น ส่วน backend ทุกตัวแชร์ memory กัน: **shared buffers** cache page ขนาด 8 kB ของ table และ index (`shared_buffers` ปกติมี default เป็น 128 MB ส่วนบน server เฉพาะที่มี RAM ตั้งแต่ 1 GB ขึ้นไป เอกสารแนะนำให้เริ่มที่ 25 % ของ memory) และ WAL buffer ถือ log record ไว้จนกว่าจะถูกเขียนออกไป ส่วนที่เหลือเป็นหน้าที่ของ background process:

| Process | หน้าที่ |
|---|---|
| WAL writer | เขียน WAL record จาก memory ลงไฟล์ WAL |
| checkpointer | รัน checkpoint ทุก `checkpoint_timeout` (default 5 min) หรือเร็วกว่านั้นเมื่อ WAL ใกล้ถึง `max_wal_size` (1 GB) |
| background writer | เขียน dirty page ทีละ batch เล็ก ๆ เพื่อกระจาย I/O ออกไปตามเวลา |
| autovacuum launcher และ worker | vacuum และ analyze table เมื่อมันเปลี่ยนไป |
| WAL sender | stream WAL ไปที่ standby หรือ client ของ replication slot อย่าง Debezium |
| WAL archiver | ก็อป WAL segment แต่ละตัวที่เต็มแล้ว (default 16 MB) ไปที่ archive |

PostgreSQL 18 เพิ่ม asynchronous I/O subsystem เข้ามา ทำให้ backend มีการอ่านค้างอยู่ได้หลายตัวพร้อมกัน แทนที่จะรอทีละตัว โดย default (`io_method = worker`) จะมี I/O worker process เป็นคนสั่งอ่าน ส่วน build บน Linux ที่มี liburing ใช้ `io_uring` ได้

### MVCC: ใช้ row version แทน read lock

PostgreSQL ไม่เคย update แถวแบบ in place ตัว `UPDATE` จะเขียน **row version** ใหม่ที่ประทับ ID ของ transaction ที่เขียนไว้ใน system column `xmin` แล้วใส่ ID เดียวกันลงใน `xmax` ของ version เก่า ทุก query อ่านผ่าน **snapshot** ที่บันทึกว่ามี transaction ไหนบ้างที่ commit แล้วตอนที่ถ่าย snapshot ทำให้มันเห็นแค่ version เดียวของแต่ละแถว นี่คือเหตุผลที่ T2 ยังอ่านได้ 7 ขณะที่ T3 อ่านได้ 6 และเป็นเหตุผลที่ read ไม่เคยบล็อก write และ write ก็ไม่บล็อก read แต่ writer สองตัวบนแถวเดียวกันก็ยังชนกันอยู่: `UPDATE` ตัวที่สองบน MUG-1 จะรอจนกว่า T1 จะ commit หรือ rollback

isolation level เป็นตัวกำหนดว่าจะถ่าย snapshot เมื่อไร:

- **Read Committed** ที่เป็น default: ถ่าย snapshot ใหม่ทุก statement ทำให้ `SELECT` ตัวที่สองใน transaction เดียวกันอาจเห็นแถวที่ commit เข้ามาระหว่างนั้น
- **Repeatable Read**: ใช้ snapshot เดียว ที่ถ่ายตอน statement แรกของ transaction ไปตลอดทั้ง transaction ถ้า transaction แบบนี้พยายามแก้แถวที่ transaction อื่นที่ทำงานพร้อมกันแก้และ commit ไปแล้ว มันจะ fail ด้วย *could not serialize access due to concurrent update* แล้วแอปก็ต้อง retry
- **Serializable**: Repeatable Read บวกกับ **Serializable Snapshot Isolation (SSI)** ที่คอยติดตาม dependency แบบ read/write ระหว่าง transaction และ abort ตัวหนึ่งด้วย SQLSTATE `40001` เมื่อผลลัพธ์อาจต่างจากทุกลำดับแบบ serial แล้วแอปก็ retry
- Read Uncommitted ใช้ได้ แต่ทำงานเหมือน Read Committed

version เก่าไม่ได้หายไปเอง **VACUUM** จะลบ version ที่ตายแล้วเมื่อไม่มี snapshot ไหนเห็นมันได้อีก และ mark พื้นที่ของมันไว้ใช้ซ้ำ ส่วน **autovacuum** จะรัน VACUUM บน table เมื่อแถวที่ถูก update หรือ delete เกิน 50 บวก 20 % ของ table (`autovacuum_vacuum_threshold` และ `autovacuum_vacuum_scale_factor` โดยที่ PostgreSQL 18 จำกัดจุดที่ trigger ไว้ที่ `autovacuum_vacuum_max_threshold` คือ 100 ล้านแถว) นอกจากนี้ VACUUM ยัง **freeze** แถวเก่า ๆ ด้วย ตัว transaction ID มีขนาดแค่ 32 bit ทำให้ถ้าไม่ freeze มันจะวนกลับไปเริ่มใหม่ (wrap around) หลังผ่านไปราวสี่พันล้าน transaction และถ้าการ freeze ตามหลังไปมากเกินไป server จะไม่ยอมแจก transaction ID ใหม่จนกว่าจะตามทัน

### WAL, checkpoint และ crash recovery

ทุกการเปลี่ยนแปลงบน page ของ table หรือ index จะถูกอธิบายไว้ใน **WAL record** ก่อน โดยต่อท้ายไว้ที่ **LSN** (log sequence number) ตัวถัดไป โดย LSN คือตำแหน่ง byte ใน log ที่แสดงเป็นเลขฐานสิบหกสองตัว เช่น `0/3000148` กฎคือ data page จะลง disk ได้ก็ต่อเมื่อ WAL record ที่อธิบายมันลง disk ไปก่อนแล้ว ตัว `COMMIT` จะต่อ commit record ท้าย log และถ้าใช้ `synchronous_commit = on` (ค่า default) ก็จะรอจน WAL ถูก flush แล้วค่อยตอบ ส่วน data page ยัง dirty อยู่ใน shared buffer แล้ว background writer กับ **checkpoint** ก็จะเขียนมันลงไปทีหลัง

หลังเครื่องล่ม recovery จะเริ่มที่ redo point ของ checkpoint ล่าสุด แล้ว replay WAL ทำให้ทุก commit ที่ acknowledge ไปแล้วกลับมาครบ `full_page_writes` (เปิดไว้โดย default) จะ log ทั้ง page ตอนที่มันเปลี่ยนครั้งแรกหลัง checkpoint ทำให้ page ที่ฉีกขาดเพราะเครื่องล่มกลางการเขียนกู้คืนได้ ส่วนถ้าใช้ `synchronous_commit = off` ตัว commit จะ return ก่อน flush: ถ้าเครื่องล่มก็อาจเสีย commit ล่าสุดไป (เอกสารบอกว่าช่วงนี้ยาวไม่เกินสามเท่าของ `wal_writer_delay` ที่ default เป็น 200 ms) แต่ database จะไม่เสียหาย

### Index และ query plan

- **B-tree** ที่เป็น default: การเทียบเท่ากับ, ช่วง และการเรียงลำดับ ส่วน PostgreSQL 18 เพิ่ม **skip scan** ทำให้ B-tree index แบบหลาย column ช่วย query ที่ไม่มีเงื่อนไขแบบเท่ากับบน column แรกได้ด้วย
- **Hash**: การเทียบเท่ากับอย่างเดียว
- **GiST** และ **SP-GiST**: ข้อมูลเชิงเรขาคณิต, range และการค้นหา nearest-neighbour โดยที่ PostGIS สร้างอยู่บน index พวกนี้
- **GIN**: value ที่มีหลายส่วน เช่น array, เอกสาร `jsonb` และ full-text search
- **BRIN**: สรุปของช่วง block สำหรับ table ขนาดใหญ่มากที่ค่าใน column เรียงตามลำดับแถวจริงบน disk เช่น `created_at` ที่มีแต่ต่อท้าย

`EXPLAIN` แสดง plan ที่ planner เลือก ส่วน `EXPLAIN ANALYZE` รัน plan นั้นจริงแล้วรายงานจำนวนแถวและเวลาจริง และตั้งแต่ PostgreSQL 18 มันยังรวมการใช้ buffer มาให้ด้วยโดยไม่ต้องขอ

### Replication

- **Physical streaming replication** ส่งตัว WAL เองออกไป โดยมี WAL sender บน primary คอย stream record ไปที่ standby แต่ละตัว แล้ว standby ก็ replay มัน และในฐานะ **hot standby** ก็รับ query แบบอ่านอย่างเดียวได้ แบบนี้เป็น **asynchronous โดย default**: standby ตามหลังได้ (`replay_lag` ใน `pg_stat_replication` บอกว่าห่างแค่ไหน) และ failover อาจทำให้ commit ล่าสุดหายไป
- **Synchronous replication** ระบุ standby ไว้ใน `synchronous_standby_names` แล้วแต่ละ commit ก็จะรอ standby พวกนั้น (หรือรอ quorum ของมันถ้าใช้ `ANY`): `synchronous_commit = remote_write` รอจน standby เขียน WAL แล้ว, `on` รอจนมัน flush แล้ว และ `remote_apply` รอจนมัน replay แล้ว ทำให้ query บน standby นั้นเห็นการเปลี่ยนแปลง ราคาที่ต้องจ่ายคือ round trip หนึ่งรอบต่อ commit และ commit จะค้างตอนที่ไม่มี synchronous standby ตัวไหนตอบ เอกสารเลยแนะนำให้ระบุตัวเลือกไว้มากกว่าที่ต้องใช้ (`ANY 1 (s1, s2)`)
- **Query conflict บน hot standby:** การ replay การเก็บกวาด row version เก่าอาจลบแถวที่ query ที่รันนานบน standby ยังต้องใช้อยู่ หลัง `max_standby_streaming_delay` (default 30 s) query นั้นจะถูกยกเลิก เว้นแต่จะตั้ง `hot_standby_feedback = on` ที่บอกให้ primary เก็บแถวพวกนั้นไว้แทน โดยแลกกับการบวมที่ฝั่ง primary
- **Logical replication** (`wal_level = logical`) decode WAL ออกมาเป็นการเปลี่ยนแปลงระดับแถว ตัว publication กับ subscription ก็อป table ที่เลือกไว้ระหว่าง server ของ PostgreSQL ได้ รวมถึงข้าม major version ด้วย ส่วน **logical decoding** ที่ใช้ output plugin อย่าง `pgoutput` ที่มีมาในตัว ก็ป้อนข้อมูลให้เครื่องมือ change data capture อย่าง Debezium
- **replication slot** จำว่า consumer ของมันอ่านไปถึงไหนแล้ว และ primary จะเก็บไฟล์ WAL ทุกไฟล์ตั้งแต่จุดนั้นไว้ (และสำหรับ logical slot ก็เก็บแถวใน catalog ที่ต้องใช้ decode ด้วย) ถ้า consumer หายไป มันก็จะทิ้ง slot ค้างไว้ แล้ว WAL ก็จะกองสูงขึ้นเรื่อย ๆ จน disk เต็ม ให้จำกัดมันด้วย `max_slot_wal_keep_size` (default `-1` คือไม่จำกัด) หรือ `idle_replication_slot_timeout` ของ PostgreSQL 18 (default `0` คือปิด) และตั้ง alert จาก `pg_replication_slots`
- **Failover** promote standby ด้วย `pg_ctl promote` หรือ `pg_promote()` ตัว PostgreSQL เองไม่ได้ตัดสินว่าจะทำเมื่อไร: Patroni เป็นคนตัดสิน โดยประสานงานระหว่าง node ผ่าน [etcd](../etcd/), Consul หรือ ZooKeeper (pattern [Leader Election](../leader-election/)) ส่วน managed service ก็ทำให้คุณเอง

### Partitioning และ extension

**Declarative partitioning** แบ่ง table ใหญ่ตัวเดียวออกเป็น partition ตามช่วง (วันที่) ตามรายการ (region) หรือตาม hash ตัว planner จะข้าม partition ที่ query ไม่มีทางแตะ และการ drop หรือ detach partition เก่าก็เร็วกว่าการลบแถวของมันมาก โดยไม่ต้อง VACUUM ตามหลัง ทุกอย่างยังอยู่บน server ตัวเดียว: การกระจาย table ไปหลาย server คือ sharding ที่ทำในแอป หรือใช้ extension **Citus** (AGPL-3.0)

**Extension** เพิ่ม type, index method และ function เข้าไปใน server ตัวอย่างเช่น **PostGIS** สำหรับข้อมูล geospatial (GPL-2.0-or-later), **pgvector** สำหรับ vector similarity search (PostgreSQL License โดยเวอร์ชัน 0.8.7 รองรับ PostgreSQL 13 ขึ้นไป) และ **pg_stat_statements** ที่มากับ PostgreSQL และเก็บสถิติของทุก statement เมื่อใส่ไว้ใน `shared_preload_libraries` ส่วนถ้าใช้ managed service ก็ให้เช็กรายการ extension ที่มันรองรับ

### PostgreSQL 18 เพิ่มอะไรมาบ้าง

ออกเมื่อ 25 กันยายน 2025: asynchronous I/O subsystem, `uuidv7()` ที่เป็น UUID เรียงตาม timestamp และ index ได้ดีกว่า UUID แบบสุ่ม, virtual generated column ที่ตอนนี้เป็นชนิด default ของ generated column, B-tree skip scan, การยืนยันตัวตนด้วย OAuth 2.0, `OLD` และ `NEW` ใน `RETURNING`, constraint แบบ temporal `PRIMARY KEY` และ `UNIQUE` ด้วย `WITHOUT OVERLAPS`, สถิติของ planner ที่อยู่รอดหลัง `pg_upgrade`, data checksum ที่เปิดไว้โดย default สำหรับ cluster ใหม่ และการยืนยันตัวตนด้วยรหัสผ่านแบบ md5 ที่ถูก deprecate ไปเพื่อให้ใช้ SCRAM แทน

## อยู่ตรงไหนใน solution

- **System of record** ของ service ที่เป็น transactional: order, payment, account, stock
- **[Transactional Outbox](../transactional-outbox/):** service insert แถว outbox ใน transaction เดียวกับการเปลี่ยนแปลงทางธุรกิจ แล้ว Outbox Event Router ของ Debezium ก็แปลงแถวพวกนั้นเป็น event บน [Kafka](../kafka/)
- **Source ของ [Change Data Capture](../change-data-capture/):** logical decoding stream การเปลี่ยนแปลงที่ commit แล้ว ตามลำดับการ commit ไปที่ search index, cache และ warehouse
- **[Read Replicas](../read-replicas/)** สำหรับ report และหน้าที่อ่านเยอะ โดยมี lag แบบที่เห็นในขั้นที่ 4
- **ข้อมูลกึ่งมีโครงสร้าง** ใน column แบบ `jsonb` ข้าง ๆ column แบบ relational โดยทำ index ด้วย GIN (operator class `jsonb_path_ops` เหมาะกับ query แบบ containment อย่าง `@>`)
- **Job queue แบบง่าย ๆ:** worker แต่ละตัว claim job ด้วย `FOR UPDATE SKIP LOCKED` ที่ข้ามแถวที่ worker ตัวอื่น lock ไว้แล้ว

  ```sql
  SELECT id FROM jobs
  WHERE status = 'ready'
  ORDER BY id
  LIMIT 10
  FOR UPDATE SKIP LOCKED;
  ```

  วิธีนี้ใช้ได้กับปริมาณงานไม่มาก ที่เก็บไว้ข้าง ๆ ข้อมูลที่มันเกี่ยวข้อง แต่ job ทุกตัวที่ถูก claim คือ update หรือ delete ที่ VACUUM ต้องตามเก็บกวาด, worker ต้อง poll และไม่มี fan-out หรือ replay เพราะฉะนั้น messaging ที่หนักหรือมี consumer หลายตัวควรไปอยู่ใน broker อย่าง [RabbitMQ](../rabbitmq/) หรือ Kafka
- มันยังเป็น store ที่ใช้กันบ่อยหลัง [Database per Service](../database-per-service/), [Materialized View](../materialized-view/) (`REFRESH MATERIALIZED VIEW CONCURRENTLY` refresh ได้โดยไม่ล็อกไม่ให้ reader เข้า) และ [Sharding](../sharding/) (ด้วย Citus หรือทำในแอป)

**เพื่อนบ้านที่มักเจอ:** connection pooler (PgBouncer หรือ [Amazon RDS](../amazon-rds-aurora/) Proxy บน AWS), cache อย่าง [Redis](../redis/) สำหรับการอ่านที่ hot, Kafka ที่ Debezium ป้อนข้อมูลให้ และ object storage อย่าง [Amazon S3](../amazon-s3/) สำหรับ base backup และ WAL ที่ archive ไว้ โดยจัดการด้วย pgBackRest, WAL-G หรือ Barman

**Managed offering:**

- **Amazon RDS for PostgreSQL** การ deploy แบบ Multi-AZ DB instance มี standby หนึ่งตัวที่ update แบบ synchronous มีไว้สำหรับ failover และไม่รับการอ่าน ส่วน Multi-AZ DB cluster มี standby ที่อ่านได้สองตัว และใช้ semisynchronous replication ที่ต้องได้ acknowledgement จากอย่างน้อยหนึ่งตัวในนั้น แล้ว read replica ก็ใช้ asynchronous replication ของ PostgreSQL เอง ถ้าจะใช้ Debezium ให้ตั้ง parameter `rds.logical_replication` เป็น `1`
- **Amazon Aurora PostgreSQL** รัน engine ที่ compatible กับ PostgreSQL บน cluster volume ที่เก็บสำเนาข้อมูลไว้ในสาม Availability Zone โดยมี writer instance หนึ่งตัวกับ Aurora Replica ได้ถึง 15 ตัวแชร์ volume นั้นร่วมกัน ทำให้ AWS บอกว่า replica lag ปกติต่ำกว่า 100 ms มาก และสำหรับ engine บางเวอร์ชัน volume โตได้ถึง 256 TiB ส่วน autovacuum ก็ยังต้องคอยดูแลอยู่
- **Azure Database for PostgreSQL** (flexible server), **Google Cloud SQL for PostgreSQL** และ **AlloyDB for PostgreSQL** ครอบคลุม cloud รายใหญ่อื่น ๆ

## ใช้ตอนไหนดี

เลือก PostgreSQL เมื่อข้อมูลเป็นแบบ relational และความถูกต้องสำคัญ: transaction ที่แตะหลายแถว, constraint, join และ query แบบ ad-hoc โดยมี primary ตัวเดียวที่รับ write load ไหว แล้ว engine ตัวเดียวนี้ก็ครอบคลุม JSON, geospatial, full-text และ vector search ไปด้วย ให้มองหาตัวอื่นเมื่อการเขียนต้อง scale out ไปหลาย node หรือหลาย region เมื่อการเข้าถึงทุกครั้งเป็นการ lookup ด้วย key ในสเกลที่ใหญ่มาก หรือเมื่อสิ่งที่คุณต้องการจริง ๆ คือ log, queue หรือ cache

| | PostgreSQL | MySQL (InnoDB) | Amazon Aurora PostgreSQL | [Amazon DynamoDB](../amazon-dynamodb/) |
|---|---|---|---|---|
| Data model | Relational SQL, type ที่หลากหลาย (`jsonb`, array, range), extension | Relational SQL | Relational ที่ compatible กับ PostgreSQL | item แบบ key-value และ document โดยอ่านด้วย key |
| Concurrency | MVCC โดย version เก่าอยู่ใน table จนกว่าจะ VACUUM และใช้ Read Committed เป็น default | MVCC โดย version เก่าถูกสร้างขึ้นใหม่จาก undo log จนกว่าจะ purge และใช้ Repeatable Read เป็น default | MVCC ของ PostgreSQL รวมถึง autovacuum ด้วย | transaction ได้ถึง 100 action (`TransactWriteItems`) |
| Read scaling | streaming replica ที่เป็น asynchronous โดย default | replica จาก binary log ที่เป็น asynchronous โดย default (เลือกแบบ semisynchronous ได้) | replica ได้ถึง 15 ตัวบน volume ที่แชร์กัน โดย lag ปกติต่ำกว่า 100 ms มาก | read แบบ eventually consistent โดย default และแบบ strongly consistent เมื่อขอ |
| Write scaling | primary ตัวเดียว ทำ shard ด้วย Citus หรือในแอป | source ตัวเดียวใน replication แบบดั้งเดิม | writer instance ตัวเดียว | กระจายไปตาม partition ด้วย partition key |
| รันที่ไหน | ที่ไหนก็ได้ ใช้ PostgreSQL License | ที่ไหนก็ได้ ส่วน source ของ server ใช้ GPLv2 | AWS เท่านั้น แบบ managed | AWS เท่านั้น แบบ managed |

Amazon Aurora PostgreSQL เหมาะกับทีมที่อยากใช้ engine นี้บน AWS โดยมี storage ที่ replicate ข้าม zone และมี replica ที่ lag ต่ำหลายตัว และยอมรับได้ที่จะรันบน AWS อย่างเดียว ส่วน Amazon DynamoDB เหมาะกับ access pattern ที่รู้ล่วงหน้าและเข้าถึงด้วย key ที่การเขียนต้อง scale ข้าม partition โดยต้องแลกกับการออกแบบ table ให้เข้ากับ query พวกนั้น แทนที่จะ join ตอนอ่าน

## ได้อะไร เสียอะไร

- **primary ตัวเดียวรับการเขียนทั้งหมด** replica เพิ่ม capacity ฝั่งอ่าน ไม่ใช่ฝั่งเขียน พอเกินเครื่องที่ใหญ่ที่สุดไปแล้ว ทางเลือกที่เหลือคือ partitioning, sharding (Citus หรือในแอป) หรือเปลี่ยนไปใช้ store แบบอื่น
- **ทุก connection คือหนึ่ง process** backend แต่ละตัวกิน memory และเวลา start-up และ `max_connections` (ปกติ default เป็น 100) ก็จำกัดจำนวนไว้ ทำให้ connection จากแอปเป็นพัน ๆ ตัวต้องมี pooler คั่นกลาง
- **MVCC ทิ้งขยะไว้ข้างหลัง** update และ delete ทิ้ง row version ที่ตายแล้วไว้ และอะไรก็ตามที่ถือ snapshot เก่าไว้จะกันไม่ให้ VACUUM ลบมันได้: transaction ที่รันนาน, session ที่ค้าง idle อยู่ใน transaction, query บน standby ที่ใช้ `hot_standby_feedback = on` และ logical slot ที่ค้าง ผลคือ table จะบวม และถ้าแย่ที่สุด ตัวป้องกัน wraparound จะบล็อกการเขียนจนกว่า VACUUM จะตามทัน
- **asynchronous replica เสิร์ฟข้อมูล stale และอาจเสีย commit ล่าสุดไปตอน failover** synchronous replication แก้ปัญหานี้ได้ โดยแลกกับ commit latency และการค้างตอนที่ไม่มี synchronous standby ตัวไหนตอบ
- **replication slot เก็บ WAL ไว้จนกว่าจะถูกอ่าน** slot ที่ถูกทิ้งไว้เลยทำ disk เต็มได้
- **การ upgrade major version เป็นงานโปรเจกต์หนึ่งเลย:** ใช้ `pg_upgrade` หรือ switchover ผ่าน logical replication และทุก extension ต้องมีเวอร์ชันสำหรับรุ่นใหม่ด้วย

## ข้อควรรู้ตอนลงมือทำ

**ทำ connection pooling** ในโหมด `transaction` ตัว PgBouncer จะให้ client ยืม server connection แค่ช่วงหนึ่ง transaction ทำให้ connection จากแอป 200 ตัวแชร์ backend 20 ตัวได้ แต่ state ของ session จะไม่อยู่รอดข้าม transaction: `SET`, `LISTEN`, advisory lock ระดับ session, cursor แบบ `WITH HOLD` และ SQL `PREPARE` ใช้ไม่ได้ในโหมดนี้ ส่วน prepared statement ระดับ protocol ใช้ได้ตั้งแต่ PgBouncer 1.21 (`max_prepared_statements` ที่ default เป็น 200 ตั้งแต่ 1.24) ตอนนี้ release ปัจจุบันคือ 1.26.0 ออกเมื่อ 23 กันยายน 2026

```ini
; pgbouncer.ini for Acme Shop
[databases]
orders = host=10.0.1.10 port=5432 dbname=orders

[pgbouncer]
listen_port = 6432
pool_mode = transaction
; at most 20 server connections per user and database pair
default_pool_size = 20
; the default, 100, is too low for 200 application connections
max_client_conn = 200
```

**ตั้งค่า primary ให้รองรับ standby, archive และ Debezium**

```ini
# postgresql.conf
wal_level = logical                  # enough for the standby, the archive and Debezium
archive_mode = on
archive_command = 'pgbackrest --stanza=orders archive-push %p'
max_slot_wal_keep_size = 50GB        # a lagging slot loses its WAL instead of filling the disk
idle_replication_slot_timeout = 2d   # PostgreSQL 18: invalidate slots unused for two days
```

**Backup ให้ทำ point-in-time recovery ได้** ทำ base backup (`pg_basebackup` ที่ทำแบบ incremental ได้ด้วย `--incremental` ตั้งแต่ PostgreSQL 17 แล้วรวมด้วย `pg_combinebackup`) และ archive WAL segment ทุกตัวที่เต็มแล้ว จากนั้นตอน restore ก็หยุดที่เวลาไหนก็ได้ด้วย `recovery_target_time` ตัว pgBackRest, WAL-G และ Barman ทำทั้งสองอย่างนี้ให้อัตโนมัติ และมีแค่การทดลอง restore จริงเท่านั้นที่พิสูจน์ได้ว่า backup ใช้ได้

**คอยดู replication และ vacuum**

```sql
-- on the primary: how far behind is each standby?
SELECT application_name, replay_lsn, replay_lag FROM pg_stat_replication;
-- slots that hold WAL back
SELECT slot_name, active, wal_status, inactive_since FROM pg_replication_slots;
-- tables with the most dead row versions
SELECT relname, n_dead_tup, last_autovacuum FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC LIMIT 5;
```

**ปรับ autovacuum แยกตาม table** บน table ที่ใหญ่และงานยุ่ง ให้ลด threshold ของมันด้วย storage parameter เช่น `ALTER TABLE stock SET (autovacuum_vacuum_scale_factor = 0.02)` และปิด session ที่ถูกลืมทิ้งไว้ด้วย `idle_in_transaction_session_timeout`

**หา query ที่ช้า** ด้วย `pg_stat_statements` แล้วอ่าน plan ของมันด้วย `EXPLAIN (ANALYZE)`

**Upgrade major version** ด้วย `pg_upgrade` (`--link` หรือ `--swap` ของ PostgreSQL 18 ช่วยเลี่ยงการก็อปไฟล์ข้อมูล) หรือ replicate แบบ logical ไปที่ cluster ใหม่แล้ว switch over

**ล็อกให้แน่น** ให้แต่ละ service มี role ของตัวเองที่มีแค่สิทธิ์ที่ต้องใช้ ใช้การยืนยันตัวตนด้วยรหัสผ่านแบบ SCRAM และใช้ row-level security เมื่อ tenant ใช้ table ร่วมกัน: หลัง `ALTER TABLE … ENABLE ROW LEVEL SECURITY` แถวจะมองเห็นได้ผ่าน policy ที่สร้างด้วย `CREATE POLICY` เท่านั้น (ไม่มี policy ก็ไม่เห็นแถวเลย) แต่เจ้าของ table จะข้าม policy พวกนี้ได้ เว้นแต่ table นั้นจะตั้ง `FORCE ROW LEVEL SECURITY` ไว้ด้วย
