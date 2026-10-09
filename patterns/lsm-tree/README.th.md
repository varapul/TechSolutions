## ปัญหา

Acme Shop เขียน event ทุก step ของ order (`placed`, `paid`, `shipped`) ลงใน `order_events`: ตอนนี้มี 1.5 ล้าน row ที่ต่อท้ายเข้ามาตามลำดับเวลา และเครื่องมือ support ก็อ่านมันกลับมาด้วย `order_id` ใน [PostgreSQL](../postgresql/) การอ่านแบบนี้ต้องมี [B-tree index](../b-tree-index/) บน `order_id` ทำให้ event ใหม่ทุกตัวต้องเข้าไปใน index ด้วย ตัว B-tree เก็บ entry ไว้เรียงกันบน page ขนาด 8 kB และแก้ page พวกนั้นที่เดิม ส่วน insert แต่ละครั้งจะแพงแค่ไหนก็ขึ้นกับว่า key ของมันไปตกที่ไหน

การรันนี้ใช้ PostgreSQL 18.6 กับ table `ev` ที่สร้างจากข้อมูลตัวอย่าง: มี primary key บน `id`, index `ev_order_id_idx` บน `order_id` และ event 1,450,000 ตัวแรกที่ insert ตามลำดับเวลา หลัง `CHECKPOINT` ตัว table รับ row สองชุด ชุดละ 50,000 row และตอนจบ index มี 4,946 page ในสามชั้น: root page 412, internal page 17 page และ leaf 4,927 page บวกกับ metapage อีกหนึ่ง page

| insert 50,000 ครั้งหลัง checkpoint | event ถัดไป ตามลำดับเวลา | review ของ order แบบสุ่ม |
|---|---|---|
| index page ที่เปลี่ยน | 172 (166 page ในนั้นเป็น page ใหม่จาก split) | 4,927 คือทุก leaf |
| full-page image ใน WAL | 13 | 4,932 |
| WAL ที่เขียน | 11.5 MB | 36.6 MB |
| page ที่เปลี่ยนทั้งหมด (heap และ index ทั้งสองตัว) | 680 | 5,485 |
| byte ที่เขียนต่อ event (WAL บวก 8 kB ต่อ page ที่เปลี่ยน) | 341 | 1,631 |

event ของ order หนึ่งมาถึงห่างกันไม่เกินหนึ่งวัน `order_id` เลยเพิ่มขึ้นแทบจะสม่ำเสมอพอ ๆ กับเวลา และชุดแรกก็แตะแค่ขอบขวาของ index: leaf ล่าสุดสำหรับ `placed` และ `paid` และ leaf ที่ย้อนกลับไปราวหนึ่งวันของ order สำหรับ `shipped` ส่วน event ตัวที่ 68 คือ `shipped` ของ order 482,834 ทำให้ leaf 4,771 เต็ม แล้วมันก็ split และย้ายครึ่งบนไปที่ page ใหม่ 4,780 ส่วนชุดที่สองแทน key ที่ไม่ได้มาตามเวลาที่เข้ามา เช่น UUID แบบสุ่ม, id ของลูกค้าหรือ product ที่อยู่มานาน หรือ event ที่มาช้า: review 50,000 ตัวของ order ที่สุ่มเลือกมา ตัว key ของพวกมันกระจายไปทั่วทั้ง index ราวสิบตัวต่อ leaf รวมกันเลยเปลี่ยน leaf ครบทั้ง 4,927 page แล้วทุก page ที่เปลี่ยนก็จะกลับลง disk เป็น page ขนาด 8 kB เต็ม ๆ ตอน checkpoint ถัดไป และเพราะ `full_page_writes` เปิดอยู่ (เป็น default) การเปลี่ยนครั้งแรกของ page หลัง checkpoint ก็ก็อปทั้ง page ลงใน WAL ด้วย: page image 4,932 ตัว ทำให้ WAL ใหญ่ขึ้น 3.2 เท่าสำหรับ row จำนวนเท่าเดิม และพอ index ใหญ่จน memory ไม่พอแล้ว insert แต่ละตัวก็ต้องอ่าน leaf ของมันจาก disk ก่อนด้วย

นี่คือปัญหาที่ LSM tree ถูกคิดขึ้นมาแก้ Patrick O'Neil, Edward Cheng, Dieter Gawlick และ Elizabeth O'Neil อธิบายมันไว้ในปี 1996 โดยยกตัวอย่าง history table ที่โตเร็วและมี index บน account id ในกรณีนี้ การดูแล B-tree ให้เป็นปัจจุบันแบบ real time จะทำให้ I/O ของทุก transaction เพิ่มขึ้นราวสองเท่า

## ทำงานยังไง

**B-tree แก้ page ที่เดิม** ตอน insert ตัว PostgreSQL ไต่ลงจาก root ไปที่ leaf ที่ครอบ key นั้น เพิ่ม entry แล้ว log การเปลี่ยนลงใน [write-ahead log](../write-ahead-log/) ก่อน ส่วน page ก็ยัง dirty อยู่ใน shared buffer จนกว่า checkpoint หรือ background writer จะเขียนมันกลับลง disk ส่วน leaf ที่เต็มก็จะ split ถ้าเป็น leaf ขวาสุด page เก่าจะถูกทิ้งไว้ที่ 90% (`fillfactor` ของ B-tree) ทำให้ key ที่มีแต่เพิ่มขึ้นถูกอัดไว้แน่น ส่วนที่อื่นการ split มักแบ่งราวครึ่งต่อครึ่ง index นี้จบที่ 4,946 page โดย leaf เต็มอยู่ 65% ถ้าสร้างใหม่ตั้งแต่ต้นบน row ชุดเดียวกันจะใช้แค่ 3,017 page การอ่านเป็น path เดียว: สำหรับ order 181,236 คือ root page 412, internal page 1842 และ leaf 1797 แล้วต่อด้วย heap สาม page ที่เก็บ row สี่ตัวของมัน รวมหก page

**LSM tree ไม่เคยแก้ page ที่เดิม** มันรวบการเขียนไว้ใน memory เขียนออกไปเป็น file ที่เรียงแล้วทั้ง file แล้วค่อย merge file พวกนั้นทีหลังอยู่เบื้องหลัง เครื่องนี้ไม่มี LSM engine รันอยู่ หน้านี้เลยใช้ Python model ตัวเล็ก ๆ (แบบย่อ: ไม่มี block, compression, caching หรือ concurrency) แล้วป้อน event ชุดเดียวกันให้มัน ตัว event แต่ละตัวเป็นคู่ key-value ขนาด 32 byte: key คือ `(order_id, id)` และ value คือ `(kind, happened_at)` ขนาดต่าง ๆ ของ model อยู่ที่ราว 1/100 ของค่า default ของ RocksDB เพื่อให้เกิด level ขึ้นบนข้อมูล 62 MB:

| | model | default ของ RocksDB |
|---|---|---|
| memtable (`write_buffer_size`) | 600 kB, 15,000 event | 64 MiB |
| จำนวน file ใน L0 ที่เริ่ม compaction (`level0_file_num_compaction_trigger`) | 4 | 4 |
| ขนาดเป้าหมายของ L1 (`max_bytes_for_level_base`) | 2.4 MB | 256 MiB |
| การโตต่อ level (`max_bytes_for_level_multiplier`) | ×10 | ×10 |
| ขนาด file (`target_file_size_base`) | 0.6 MB | 64 MiB |
| bloom filter | 10 bit ต่อ key, 7 probe | ไม่มีถ้าไม่ได้ตั้งค่า ตัวอย่างใน wiki ใช้ 10 bit ต่อ key |

- **write path** การเขียนจะถูกต่อท้ายลงใน write-ahead log (48 byte ต่อ event ใน model) แล้วใส่เข้าไปใน memtable ที่เป็นโครงสร้างเรียงลำดับใน memory (ใน RocksDB default เป็น skip list ส่วน Cassandra เรียก log ของมันว่า commit log) พอ memtable เต็ม มันก็ถูก flush: เขียนจากต้นจนจบเป็น file เดียวที่เรียงแล้วและแก้ไม่ได้ เรียกว่า SSTable ใน level 0 ตัว review 50,000 ตัวต่อท้าย WAL ไป 2.4 MB และกลายเป็นสาม file ขนาด 0.62 MB โดยยังเหลือ 5,000 ตัวใน memtable ไม่มีอะไรบน disk ถูกเขียนใหม่เลย
- **level** ตัว file ใน level 0 ทับกันได้ เพราะแต่ละ file เก็บอะไรก็ตามที่เข้ามาระหว่างที่ memtable หนึ่งตัวเต็มขึ้น: review file ทั้งสามแต่ละตัวครอบเกือบทุก order ตั้งแต่ต่ำกว่า 120 ไปถึงเกิน 499,960 ส่วนทุก level ข้างล่างเป็น sorted run หนึ่งชุดที่หั่นเป็น file ที่ช่วง key ไม่ทับกัน และแต่ละ level ใหญ่ได้สิบเท่าของ level ที่อยู่เหนือมัน ข้อมูลที่มาตามลำดับ key ก็จมลงไปตามลำดับ key: พอผ่าน event 1.5 ล้านตัวแล้ว L3 เก็บ order 1 ถึง 290,000, L2 เก็บ 290,001 ถึง 485,000 และ L1 เก็บ 485,001 ถึง 500,000
- **read path** ตัว lookup จะเช็ก memtable แล้วเช็กทุก file ใน L0 จากใหม่ไปเก่า จากนั้นเช็ก file เดียวในแต่ละ level ที่ช่วง key ครอบ key นั้น โดยหาด้วย [binary search](../binary-search/) บน key ที่เล็กที่สุดและใหญ่ที่สุดของแต่ละ file ทุก file มี bloom filter ที่เป็น bit array ที่ทุก key จะตั้ง bit ไม่กี่ตัวที่เลือกด้วย [hash function](../hash-table/) มันตอบได้ว่า "ไม่อยู่ที่นี่แน่นอน" หรือ "อาจจะอยู่" ตัว model filter บน `order_id` เหมือน prefix filter ใน RocksDB หรือ filter บน partition key ของ Cassandra ส่วนกับ order 181,236 ตัว filter ตัด L0 file #227 และ #226 ออก ช่วง key ตัด L1 และ L2 ออก และมีแค่ L0 #225 (review) กับ L3 #86 (placed, paid, shipped) ที่ถูกอ่าน ในการทดสอบกับ order แบบสุ่ม 4,000 ตัว lookup หนึ่งครั้งเช็ก filter 4 ครั้งและอ่าน 1.1 file และการเช็ก 0.024 ครั้งต่อ lookup เป็น false positive หรือ 0.8% ของ file ที่ไม่มี order นั้น ตรงกับที่ 10 bit ต่อ key ทำนายไว้ ส่วน range scan ใช้ filter ไม่ได้: มันต้อง merge cursor บนทุก file ใน L0 และทุก level
- **compaction** พอ L0 มีครบ 4 file พวกมันจะถูก merge เข้ากับ file ใน L1 ที่ทับกัน เป็น [k-way merge](../merge-sort/) ของ sorted run และเมื่อ level ไหนโตเกินเป้าหมาย file หนึ่งของมันจะถูก merge ลงไปใน level ข้างล่าง ในการรัน การ flush ครั้งถัดไป (การลบที่อธิบายข้างล่าง) ทำให้ L0 มีครบ 4 file แล้ว compaction ก็อ่าน 4 file นั้นกับ 3 file ใน L1 แล้วเขียน file ใหม่ 7 file ลง L1 (4.3 MB) หลังจากนั้น L1 ใหญ่เกินไป เลยดัน 8.5 MB ลงไปที่ L2 ส่วน file ที่ไม่ทับกับอะไรใน level ข้างล่างจะแค่ย้ายลงไปโดยไม่ต้องเขียนใหม่ ที่ RocksDB เรียกว่า trivial move และนี่คือเหตุผลที่การ load event ตามลำดับเวลาถูก
- **การลบก็คือการเขียน** การลบ event ของ order ที่ถูกยกเลิก 9,755 รายการเขียน tombstone 30,199 ตัว เป็น marker เล็ก ๆ ที่ซ่อนสำเนาที่เก่ากว่าของ key นั้นจากการอ่านและการ merge ตัว tombstone จะทิ้งได้ก็ต่อเมื่อไม่มีสำเนาที่เก่ากว่าของ key ของมันอยู่ข้างล่างได้แล้ว ในทางปฏิบัติคือตอนที่ compaction พามันลงไปถึง level สุดท้าย: compaction L0→L1 ข้างบนเก็บ tombstone ทั้ง 16,667 ตัวที่มันเจอไว้ครบ ส่วน full compaction อย่าง `CompactRange` ของ RocksDB หรือ `nodetool compact` ใน Cassandra ทิ้ง tombstone ทั้ง 30,199 ตัวและ event 30,199 ตัวที่มันลบไป โดยเขียนใหม่ 61.4 MB และต้องใช้ disk 124.8 MB ตอนพีก ส่วน Cassandra ยังเก็บ tombstone แต่ละตัวไว้อย่างน้อย `gc_grace_seconds` (default สิบวัน) เพื่อให้ replica ที่พลาดการลบไปเอาข้อมูลกลับมาไม่ได้

**leveled หรือ size-tiered** leveled compaction ที่เป็น design ของ LevelDB และเป็น default ของ RocksDB เก็บ sorted run หนึ่งชุดต่อ level แล้ว merge ชิ้นเล็ก ๆ บ่อย ๆ ส่วน size-tiered compaction (strategy ที่เป็น default ของ Cassandra และ Universal Compaction ของ RocksDB) จะรอจนมีหลาย run ที่ขนาดใกล้กัน (ใน Cassandra default คือ 4) แล้ว merge พวกมันเป็น run ที่ใหญ่ขึ้นหนึ่งตัว: ข้อมูลถูกเขียนใหม่น้อยรอบกว่า แต่การอ่านอาจต้องเช็กหลาย run กว่า และการ merge ใหญ่ ๆ ต้องมีที่ว่างพอสำหรับสำเนาที่สอง Cassandra 5.0 เพิ่ม Unified Compaction Strategy ที่เอกสารของมันแนะนำสำหรับ workload ใหม่ ตัว model รันทั้งสองแบบบน stream ชุดเดียวกัน:

| | leveled | size-tiered |
|---|---|---|
| byte ที่เขียนต่อ event, event 1.5 ล้านตัวตามลำดับเวลา | 139 (4.3×) | 194 (6.0×) |
| byte ที่เขียนต่อ event, event ชุดเดียวกันแบบ key สุ่ม | 369 (11.5×) | 192 (6.0×) |
| file ที่อ่านต่อ lookup, order แบบสุ่ม 4,000 ตัวหลัง review | 1.1 | 1.1 |
| disk ÷ สำเนาที่เพิ่ง compact ใหม่ ตอนจบ | 1.03× | 1.03× |
| disk ÷ สำเนาที่เพิ่ง compact ใหม่ ตอนพีก | 1.17× | 1.26× |

ตัวเลข × หารด้วย 32 byte ของแต่ละ event ตามที่ tuning guide ของ RocksDB นิยาม write amplification ไว้: byte ที่เขียนลง storage หารด้วย byte ที่เขียนลง database เมื่อ key มาตามลำดับเวลา ตัว leveled compaction ส่วนใหญ่แค่ย้าย file แทนการเขียนใหม่ ในกรณีนั้นมันเลยเขียนน้อยกว่า size-tiered

## ลองรันดู

ข้อมูลตัวอย่างมาจาก [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop) ที่เป็น script สร้าง template database `acme` บน PostgreSQL 18 ในเวลาราวหนึ่งนาที

รันบนสำเนาใหม่ของข้อมูลตัวอย่าง Acme Shop (PostgreSQL 18) ส่วน comment แสดงบรรทัดสำคัญของ output ตัว `CHECKPOINT` ต้องใช้ superuser หรือ role `pg_checkpoint`

```sql
-- CREATE DATABASE lsm_try TEMPLATE acme;   -- then connect to lsm_try
CREATE EXTENSION IF NOT EXISTS pageinspect;
CREATE EXTENSION IF NOT EXISTS pgstattuple;

-- order_events in a table with the index the support tool reads by
CREATE TABLE ev (id bigint PRIMARY KEY, order_id bigint NOT NULL,
                 kind text NOT NULL, happened_at timestamptz NOT NULL);
CREATE INDEX ev_order_id_idx ON ev (order_id);
INSERT INTO ev SELECT * FROM order_events WHERE id <= 1450000 ORDER BY id;
VACUUM ANALYZE ev;

-- pages of a relation whose last change is newer than the mark
CREATE TABLE mark (lsn pg_lsn);
CREATE FUNCTION pages_changed(rel regclass) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM generate_series(0, pg_relation_size(rel) / 8192 - 1) AS b
  WHERE (page_header(get_raw_page(rel::text, b::int))).lsn > (SELECT lsn FROM mark) $$;

-- 1. the next 50,000 events, in time order
CHECKPOINT;
INSERT INTO mark SELECT pg_current_wal_lsn();
EXPLAIN (ANALYZE, BUFFERS, WAL, COSTS OFF, TIMING OFF)
INSERT INTO ev SELECT * FROM order_events WHERE id > 1450000 ORDER BY id;
-- WAL: records=151316 fpi=13 bytes=11475847
SELECT pages_changed('ev_order_id_idx');
-- 172

-- 2. 50,000 reviews for orders picked at random
SELECT setseed(0.42);
CREATE TABLE late_events AS
SELECT 1500000 + g AS id, (1 + floor(random() * 500000))::bigint AS order_id,
       'reviewed'::text AS kind,
       timestamptz '2026-10-03 18:00:00+00' + g * interval '1 second' AS happened_at
FROM generate_series(1, 50000) AS g;
VACUUM late_events;   -- sets hint bits now, so the INSERT below logs only its own changes
CHECKPOINT;
UPDATE mark SET lsn = pg_current_wal_lsn();
EXPLAIN (ANALYZE, BUFFERS, WAL, COSTS OFF, TIMING OFF)
INSERT INTO ev SELECT * FROM late_events ORDER BY id;
-- WAL: records=150138 fpi=4932 bytes=36632086
SELECT pages_changed('ev_order_id_idx');
-- 4927                                  every leaf

-- 3. what a read costs, and how full the leaves are now
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) SELECT * FROM ev WHERE order_id = 181236;
-- Index Scan using ev_order_id_idx on ev (actual rows=4.00 loops=1)
--   Buffers: shared hit=6               3 index pages + 3 heap pages
SELECT leaf_pages, avg_leaf_density FROM pgstatindex('ev_order_id_idx');
-- 4927 | 65.01
```

`EXPLAIN` อาจพิมพ์ `buffers full=…` ออกมาด้วย ที่บอกว่า WAL buffer เต็มกี่ครั้ง และตัวเลขนี้เปลี่ยนไปในแต่ละรอบที่รัน ส่วนจำนวน page กับ WAL record, image และ byte ออกมาเท่ากันทุกรอบ

## ใช้ตอนไหนดี

- **engine แบบ B-tree** (PostgreSQL, MySQL กับ InnoDB, SQL Server) เมื่อการอ่านสำคัญอย่างน้อยพอ ๆ กับการเขียน: point lookup และ range scan บน path เดียวจาก root ถึง leaf, leaf ที่เรียงไว้สำหรับ `ORDER BY`, row ที่ update ที่เดิม, secondary index หลายตัวและ transaction ที่ครอบมัน มันรับ insert rate สูง ๆ ได้ดีเมื่อ key มาเกือบตามลำดับ อย่าง identity column และ timestamp และเมื่อส่วนที่ hot ของแต่ละ index ยังอยู่ใน memory
- **engine แบบ LSM** (RocksDB และ database ที่สร้างบนมัน เช่น MyRocks รวมถึง Cassandra และ ScyllaDB) เมื่อการเขียนเป็นงานหลัก และ key มาแบบไม่มีลำดับ: การรับ event, log และ time-series เข้ามา, metric, state ของ messaging และ key-value store ที่เขียนหนัก สำหรับการเขียนเล็ก ๆ ไปที่ key สุ่ม มันมักเขียน byte น้อยกว่า และเขียนตามลำดับทั้งหมด สำหรับ MyRocks บน SSD ทาง Percona ระบุว่าใช้พื้นที่ storage น้อยกว่าและยืดอายุ flash ได้นานกว่า engine อื่น
- **ก่อนเปลี่ยน engine ให้แก้ key กับ index ก่อน** ใน PostgreSQL ตัวที่ทำร้ายคือ key แบบสุ่ม ส่วน `uuidv7()` ของ PostgreSQL 18 สร้าง UUID ที่เรียงตามเวลาที่สร้าง ทำให้ entry ใหม่ไปอยู่ที่ขอบขวา ต่างจาก version 4 แบบสุ่มจาก `gen_random_uuid()` นอกจากนี้ให้ drop index ที่ไม่มีใครอ่าน, insert เป็น batch, ใช้ BRIN index กับ column ที่เรียงตามเวลา ([index types](../index-types/)) และตั้ง `wal_compression` เพื่อย่อ full-page image
- **สำหรับ "event ทั้งหมดของ key เดียว"** ตัว wide-column store เก็บ row ของ key เดียวกันไว้ด้วยกัน: ใน [Cassandra](../cassandra/) พวกมันอยู่ใน partition เดียวกัน แต่ "NoSQL" ไม่ได้แปลว่า LSM: [DynamoDB](../amazon-dynamodb/) เก็บ item ไว้ใน B-tree (ดูหมายเหตุข้างล่าง)

## ได้อะไร เสียอะไร

- **write amplification ย้ายที่ ไม่ได้หายไป** B-tree จ่ายทั้ง page และ full-page image สำหรับการเปลี่ยนแต่ละครั้งที่กระจายกัน (341 byte ต่อ event เมื่อ key เรียง และ 1,631 เมื่อ key สุ่ม) ส่วน LSM tree เขียนแต่ละ byte ใหม่หนึ่งรอบต่อทุก level ที่มันผ่าน (139 และ 369 byte ใน model แบบ leveled) แต่เป็นการเขียนต่อเนื่องยาว ๆ ตามลำดับและทำอยู่เบื้องหลัง
- **การอ่านใน LSM tree แพงกว่า** point lookup ของ B-tree คือ path เดียว และ range scan ก็เดินตาม leaf ที่ link กันไว้ ส่วน lookup ของ LSM ต้องเช็ก memtable, ทุก file ใน L0 และทุก level ตัว bloom filter เปลี่ยนการเช็กส่วนใหญ่ให้เป็นแค่การทดสอบ bit ไม่กี่ตัวใน memory สำหรับ point lookup แต่ช่วยอะไร range scan ไม่ได้ และทุก false positive ก็ต้องเสียการอ่านหนึ่งครั้ง
- **พื้นที่** page ของ B-tree มีที่ว่างเหลือหลัง split (ที่นี่เต็ม 65% คือ 1.64× ของตัวที่สร้างใหม่) ส่วน LSM แบบ leveled อยู่ใกล้ขนาดข้อมูลที่ยังใช้งานอยู่ ที่นี่คือ 1.03× ส่วน size-tiered compaction ต้องมีที่เผื่อสำหรับ merge ใหญ่ ๆ และ full compaction ต้องมีที่สำหรับสำเนาที่สองของทุกอย่าง (124.8 MB สำหรับ 61.4 MB ใน model)
- **compaction แย่งทรัพยากรกับ query ของเรา** มันอ่านและเขียนข้อมูลใหม่อยู่เบื้องหลัง ถ้ามันตามไม่ทัน file ใน L0 จะกองขึ้นเรื่อย ๆ และทุกการอ่านก็ต้องเช็ก file พวกนั้นมากขึ้น RocksDB เลยชะลอการเขียนเมื่อมี L0 file 20 ตัว และหยุดการเขียนเมื่อมี 36 ตัว (`level0_slowdown_writes_trigger`, `level0_stop_writes_trigger`) และทำแบบเดียวกันเมื่อ byte ที่รอ compaction เกิน 64 GiB และ 256 GiB
- **การลบต้องจ่ายสองรอบ** tombstone ถูกเขียนเหมือน entry อื่น ๆ และมันจะค้างอยู่ กินพื้นที่และทำให้การอ่านที่ต้องข้ามมันช้าลง จนกว่า compaction จะพามันไปถึง level สุดท้าย (ใน Cassandra ต้องรอ `gc_grace_seconds` อย่างน้อยด้วย) workload ที่ลบหรือเขียนทับหนัก ๆ ต้องมี compaction setting ที่เคลียร์มันออกไป
- **RUM conjecture** Manos Athanassoulis และผู้เขียนร่วม (EDBT 2016) เสนอว่าไม่มี access method ไหนดีที่สุดได้พร้อมกันทั้งต้นทุนการอ่าน ต้นทุนการ update และ overhead ของ memory (พื้นที่): การจำกัดสองอย่างจะทำให้อย่างที่สามมีขีดต่ำสุดที่ลดลงไปกว่านั้นไม่ได้ ตัว B-tree ยอมเสียพื้นที่และต้นทุน update เพื่อให้การอ่านสั้น LSM tree ยอมเสียต้นทุนการอ่านเพื่อให้ update ถูก และทุกปุ่ม tuning ของ LSM ตั้งแต่ level multiplier ไปจนถึง tiering ก็ขยับอยู่บนสามเหลี่ยมเดียวกันนี้

## ข้อควรรู้ตอนลงมือทำ

**การวัดการเขียนใน PostgreSQL 18** `EXPLAIN (ANALYZE, WAL)` รายงานจำนวน record, full-page image และ byte ของ WAL ที่ statement หนึ่งสร้างขึ้น และจำนวนครั้งที่ WAL buffer เต็ม ตัว `pg_stat_wal` เก็บยอดรวมของทั้ง cluster ส่วนในเวอร์ชัน 18 ก็เอา column write และ sync ของมันออก ย้ายเวลาของ WAL ไปไว้ที่ `pg_stat_io` และเพิ่ม row ของ WAL กับจำนวน byte ให้ `pg_stat_io` (`read_bytes`, `write_bytes`, `extend_bytes`) บน server ที่ใช้ร่วมกัน ตัว `pg_stat_get_backend_io()` และ `pg_stat_get_backend_wal()` ให้ตัวเลขของ backend เดียว ถ้าจะนับ page ที่ statement หนึ่งเปลี่ยน ให้เทียบ LSN ของแต่ละ page กับ mark ที่เก็บไว้ก่อนรัน (`page_header()` จาก pageinspect) แบบในหัวข้อ "ลองรันดู" ส่วน PostgreSQL 18 ยังเปิด data checksum ใน cluster ใหม่เป็น default ด้วย และเมื่อเปิด checksum การ update hint bit ครั้งแรกของ page หลัง checkpoint ก็ถูก log เป็น full-page image เหมือนกัน: นี่คือเหตุผลที่ script ในหัวข้อ "ลองรันดู" vacuum `late_events` ก่อน checkpoint ของมัน

**MySQL (InnoDB, 8.4)** เก็บแต่ละ table เป็น B-tree บน primary key ของมัน ใช้ page ขนาด 16 KB และ secondary index ทุกตัวก็เป็น B-tree อีกตัว ส่วน change buffer ของมันคือคำตอบของ InnoDB ต่อการ insert ลง secondary index แบบสุ่ม: มันเก็บการเปลี่ยนของ secondary index page ที่ไม่ได้อยู่ใน buffer pool ไว้ แล้ว merge เข้าไปตอนที่ page นั้นถูกอ่านครั้งถัดไป เป็น buffer เล็ก ๆ คล้าย LSM ข้างใน engine แบบ B-tree แต่ใน 8.4 ค่า default ของ `innodb_change_buffering` คือ `none` ตัว **MyRocks** ใช้ RocksDB แทน InnoDB เป็น storage engine และมากับ Percona Server for MySQL

**SQL Server** เก็บ rowstore index ทั้งแบบ clustered และ nonclustered เป็น B+ tree ที่ update ที่เดิม ส่วน table ที่ไม่มี clustered index ก็เป็น heap เหมือนใน PostgreSQL

**Amazon DynamoDB** มักถูกจัดกลุ่มไว้กับ Cassandra แต่ paper ใน USENIX ATC ปี 2022 ที่อธิบาย design ของมันบอกว่า storage replica แต่ละตัวเก็บ write-ahead log กับ B-tree ของ item ไว้ และการเขียนจะถูก acknowledge เมื่อ replica ครบ quorum มี log record ของมันแล้ว

**Cassandra และ ScyllaDB** เป็น LSM store: มี commit log, memtable และ SSTable บนทุก node และเลือก compaction strategy ราย table ได้ (size-tiered, leveled ที่ใช้ SSTable ขนาด 160 MB, time-window และใน Cassandra 5.0 มี unified) ScyllaDB เพิ่ม incremental compaction ที่แบ่ง SSTable ใหญ่ ๆ เป็น run ของ file ที่เล็กลง เพื่อให้การ merge แบบ size-tiered ไม่ต้องใช้พื้นที่สองเท่า

**LevelDB และ RocksDB** ตัว LevelDB ที่ Sanjay Ghemawat กับ Jeff Dean สร้างที่ Google เป็นตัวที่นำ layout แบบ leveled มาใช้: level 0 ถูก merge เข้า level 1 เมื่อมีเกินสี่ file ตัว level *L* เก็บได้ 10^*L* MB และ file มีขนาดราว 2 MB ส่วน RocksDB ที่ Meta สร้างต่อจาก LevelDB ใช้ design นั้นเป็น default (`level_compaction_dynamic_level_bytes` เปิดอยู่ มันเลยกำหนดขนาด level จากล่างขึ้นบน) และเพิ่ม Universal Compaction, memtable หลายแบบ และ Ribbon filter ที่ได้ false-positive rate เท่ากับ Bloom filter แบบ 10 bit โดยใช้แค่ราว 7 bit ต่อ key

**ตัว model** เป็น Python ไม่กี่ร้อยบรรทัดที่ทำแค่สิ่งที่หน้านี้อธิบาย: memtable เก็บเป็น dictionary แล้ว sort ตอน flush, file เป็น sorted list ที่มี key เล็กสุดและใหญ่สุดของมัน, bloom filter หนึ่งตัวต่อ file, leveled compaction ที่เลือก file แบบ round-robin เหมือน option `kRoundRobin` ของ RocksDB (default ของมันคือ `kMinOverlappingRatio` ที่เลือก file ที่ทับกับ level ถัดไปน้อยที่สุดเมื่อเทียบกับขนาดของตัวเองก่อน) และย้าย file ที่ไม่ทับกันลงไป, size-tiered compaction ตามกฎ bucket ของ Cassandra และ tombstone ราย key ส่วนขนาดต่าง ๆ ของมันถูกย่อลง ตัวเลขสัมบูรณ์ของมันเลยไม่ใช่ของ RocksDB หรือ Cassandra สิ่งที่ใช้ต่อได้คือการเปรียบเทียบระหว่างการรันของมันเอง และการเปรียบเทียบกับการรันบน PostgreSQL
