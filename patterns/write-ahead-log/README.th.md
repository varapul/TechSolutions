## ปัญหา

checkout ของ Acme Shop เขียน order ใน transaction เดียว:

```sql
BEGIN;
INSERT INTO orders (customer_id, status, shipping_country, created_at, total_thb)
VALUES (42, 'pending', 'TH', now(), 20491.28);                   -- order 500001
INSERT INTO order_items (order_id, line_no, product_id, qty, price_thb)
VALUES (500001, 1, 42, 1, 5290.92), (500001, 2, 128, 2, 7600.18);
COMMIT;
```

พอ COMMIT คืนค่ากลับมา ลูกค้าจะเห็นว่า "สั่งซื้อแล้ว" order นี้เลยต้องรอดจาก crash ที่มาหลังจากนั้นแค่ millisecond เดียว บน [PostgreSQL](../postgresql/) 18.6 กับข้อมูลตัวอย่าง transaction นี้เปลี่ยน page ขนาด 8 kB ไปแปด page ในเจ็ด file: heap page สุดท้ายของ `orders` (block 5057) และของ `order_items` (block 10416), leaf ขวาสุดของ primary key แต่ละตัว, page ของ identity sequence และที่ไม่ค่อยเห็นชัดคือ block 0 ของ `customers` กับ block 0 และ 1 ของ `products` การเช็ก foreign key แต่ละครั้งจะ lock row แม่ที่มันเจอ และ [row lock](../locks-and-deadlocks/) ก็คือการเปลี่ยน page ของ row นั้น

วิธีตรง ๆ ที่จะทำให้ commit ทนทานคือเขียน page ทั้งแปดลง file ของมัน แล้ว fsync ทุก file ก่อนที่ COMMIT จะคืนค่า แต่วิธีนี้พังอยู่สองทาง:

- **มันช้า** ทุก commit ต้องรอการเขียนที่กระจายอยู่ในเจ็ด file และ fsync หนึ่งครั้งต่อ file และ order สองรายการที่แตะ page เดียวกันก็ต้องเขียน page นั้นสองรอบ ในการรันของเรา checkpoint ที่เขียนแค่ page ของ order แบบนี้หนึ่งรายการใช้เวลา 6–7 ms ส่วน commit ข้างล่างใช้แค่ 0.37 ms
- **มันไม่ atomic** crash ที่เกิดคั่นระหว่างการเขียนแต่ละครั้งจะเหลือ item อยู่บน disk โดยไม่มี order ของมัน crash ระหว่างที่กำลังเขียนยิ่งแย่กว่า: PostgreSQL เขียน page ขนาด 8 kB แต่ disk เขียนได้ทีละ sector เต็ม ๆ เท่านั้น (ตัวอย่างในเอกสารคือ 512 byte) ไฟดับเลยอาจทิ้ง page ไว้แบบ *torn* คือใหม่บางส่วน เก่าบางส่วน และไม่มีอะไรบน disk ที่จะประกอบมันกลับคืนได้

## ทำงานยังไง

ตัวเลขข้างล่างมาจากการรันครั้งหนึ่งบน laptop: server PostgreSQL 18.6 ที่ใช้แล้วทิ้งใน Docker โหลดข้อมูลตัวอย่างชุดเดียวกันไว้เพื่อให้ทำ crash ได้ บวกกับ pgbench สั้น ๆ ที่รันกับมัน ส่วน script ใน *ลองรันดู* ทำส่วนที่เกี่ยวกับ log ซ้ำบนสำเนาของข้อมูลตัวอย่าง

**เขียน log ก่อน** กฎนี้เขียนได้ในบรรทัดเดียว: การเปลี่ยนจะไปถึง data file ได้ก็ต่อเมื่อ log record ที่อธิบายมันอยู่บน storage ที่ถาวรแล้ว PostgreSQL บังคับกฎนี้ทีละ page โดยที่ header ของแต่ละ page เก็บ LSN ของ WAL record ล่าสุดที่เปลี่ยน page นั้น และก่อนที่ buffer manager จะเขียน dirty page มันจะ flush WAL อย่างน้อยไปถึง LSN นั้นก่อน พอมี log แล้ว COMMIT ก็ไม่ต้องเขียน data page เลยสักตัว และ dirty page จะถูกเขียนตอนไหนก็ได้ที่สะดวกกับ server: นี่คือ buffer policy แบบ *no-force* และ *steal* ที่ ARIES (Mohan et al., ACM TODS, 1992) ออกแบบไว้รองรับ ตัว ARIES คือคำอธิบายคลาสสิกของ recovery ที่ใช้ WAL

**record, LSN และ segment** ทุกการเปลี่ยนจะต่อท้าย record ลงใน WAL buffer ใน shared memory: ที่นี่คือ 8 MB ตามค่า default ที่เป็น 1/32 ของ `shared_buffers` แต่ไม่เกินหนึ่ง segment ตัว LSN คือตำแหน่ง byte ขนาด 64-bit ใน log แสดงเป็นเลขฐานสิบหกสองครึ่ง (0/7600C2E0) และการลบ LSN สองตัวก็ได้จำนวน byte ระหว่างมัน บน disk ตัว log เป็นชุดของ segment file ขนาด 16 MB ใน `pg_wal` แต่ละ file ประกอบด้วย page ขนาด 8 kB และตั้งชื่อตามลำดับ: `pg_walfile_name('0/7600C308')` คือ `000000010000000000000076` ทุก record มี CRC-32C ติดไปด้วย ส่วน order ของเราเขียนไป 12 record ที่อ่านกลับมาด้วย `pg_walinspect`:

| LSN | Record | Page | Page image |
|---|---|---|---|
| 0/76002130 | Sequence LOG | `orders_id_seq` block 0 | – |
| 0/76002198 | Heap INSERT (5057,91) | `orders` block 5057 | 7,516 B |
| 0/76003F30 | Btree INSERT_LEAF | `orders_pkey` block 1373 | 940 B |
| 0/76004330 | Heap LOCK, customer 42 (เช็ก FK) | `customers` block 0 | 8,172 B |
| 0/76006370 | Heap INSERT (10416,81) | `order_items` block 10416 | 5,532 B |
| 0/76007948 | Btree INSERT_LEAF | `order_items_pkey` block 4812 | 2,056 B |
| 0/760081A0 | Heap INSERT (10416,82) | `order_items` block 10416 | – |
| 0/76008200 | Btree INSERT_LEAF | `order_items_pkey` block 4812 | – |
| 0/76008248 | Heap LOCK, order 500001 (เช็ก FK) | `orders` block 5057 | – |
| 0/76008280 | Heap LOCK, product 42 (เช็ก FK) | `products` block 0 | 8,156 B |
| 0/7600A2B0 | Heap LOCK, product 128 (เช็ก FK) | `products` block 1 | 8,156 B |
| 0/7600C2E0 | Transaction COMMIT | – | – |

**COMMIT รอ flush แค่ครั้งเดียว** ก่อน COMMIT ตัว record อยู่ใน memory: ตำแหน่ง insert ไปถึง 0/7600C2E0 แล้ว ขณะที่ตำแหน่ง flush ยังอยู่ที่ 0/76000130 ตัว COMMIT ต่อท้าย record ขนาด 34 byte ของมัน แล้ว flush WAL ไปจนถึงท้าย record นั้นที่ 0/7600C308 ด้วยการเขียนหนึ่งครั้งและ `fdatasync` หนึ่งครั้ง (`wal_sync_method` ที่เป็น default บน Linux) จาก `pg_stat_get_backend_io()` ตัว `fdatasync` ใช้ไป 0.23 ms จาก 0.37 ms ที่ commit ใช้ทั้งหมด ตัว log ถูกเขียนต่อกันไปตามลำดับ และเมื่อหลาย session commit พร้อมกัน flush ครั้งเดียวก็ครอบทุก commit record ที่อยู่ใน buffer แล้ว (group commit)

**page ค่อยตามมา** page ทั้งแปดยัง dirty อยู่ใน shared buffer บน disk ตัว block 5057 ของ `orders` ยังมี 90 row และ page LSN เป็น 0/64A3FE20 ส่วนใน memory มี 91 row และ LSN เป็น 0/76008280 ตัว background writer เขียน dirty page บางส่วนไว้ล่วงหน้าก่อนจะมีใครต้องใช้ ส่วน checkpointer เขียนทั้งหมดทุกครั้งที่ checkpoint ก่อนจะถึงตอนนั้น page หนึ่งรับการเปลี่ยนได้อีกหลายครั้ง และก็ยังถูกเขียนแค่ครั้งเดียว

**checkpoint และ full-page image** checkpoint เขียน dirty page ทุกตัว แล้ว log checkpoint record ที่มี *redo point* เป็นจุดที่ crash recovery จะเริ่ม ส่วน WAL ที่เก่ากว่านั้นก็ไม่ต้องใช้สำหรับ recovery แล้ว เพราะการเขียน page อาจ torn ได้ การเปลี่ยนครั้งแรกของแต่ละ page หลัง checkpoint เลย log image ของทั้ง page ไว้ (`full_page_writes = on`) และตอน replay ก็กู้ image นั้นกลับมา แทนการไปแปะการเปลี่ยนลงบน page ที่อาจเขียนไปแค่ครึ่งเดียว ตัว `CHECKPOINT` ของเรา (redo point 0/76000028) รันก่อน order ราวหนึ่งวินาที ทำให้ record 7 จาก 12 ตัวพก image ไว้: รวม 41,268 byte ส่วน order ถัดไปบน page ชุดเดิมเขียน 11 record และ 742 byte ส่วนตั้งแต่ PostgreSQL 18 เป็นต้นมา ตัว `initdb` เปิด data checksum ไว้เป็น default และเมื่อมี checksum แม้แต่การเปลี่ยน hint bit ครั้งแรกของ page หลัง checkpoint ก็ log image ด้วย (`FPI_FOR_HINT`): image ขนาด 8 kB ของ catalog page ที่ session เพิ่งอ่าน อยู่ก่อน order ของเราใน log พอดี

**crash recovery** เรา kill server ด้วย `docker kill` (SIGKILL) สองวินาทีหลัง commit ก่อนที่ page ไหนในแปด page จะถูกเขียน พอ restart มันหา checkpoint ล่าสุดผ่าน `pg_control` แล้ว log ว่า `redo starts at 0/76000028` จากนั้น replay ทุก record ไปจนสุด WAL ที่ใช้ได้ (`redo done at 0/7600D630`, elapsed 0.00 s) รัน checkpoint ตอนจบ recovery ที่เขียน 13 buffer ใน 7 ms แล้วก็เริ่มรับ connection ส่วน order 500001 กับ item สองตัวของมันกลับมาอยู่ครบ และ block 5057 บน disk ตอนนี้มี 91 row กับ LSN 0/76008280 ตอน replay จะเทียบ LSN ของแต่ละ record กับ LSN ของ page แล้วข้ามการเปลี่ยนที่ page มีอยู่แล้ว ไม่มีรอบ undo: transaction ที่ commit record ไปไม่ถึง WAL ถือว่า abort และ [MVCC](../mvcc/) ก็ไม่แสดง row version ของมันเลย ส่วน ARIES ใช้วิธีเล่นประวัติซ้ำในรอบ redo แล้วค่อย rollback transaction ที่ยังไม่จบ โดย log compensation record ไปตลอดทาง ไม่ว่าแบบไหน เวลา recovery ก็โตตาม WAL ที่เขียนตั้งแต่ redo point ล่าสุด และนี่คือสิ่งที่ setting ของ checkpoint ใช้คุม

**log เดียว คนอ่านหลายคน** record ชุดเดียวกันนี้ออกจาก server ไปได้สามทาง:

- **streaming replication** ตัว standby connect เข้ามา รับ record ตอนที่มันถูกเขียน แล้ว replay ตาม ตัว standby ของเรารายงาน `replay_lsn` 0/7600C308 ที่ 1.6 ms หลัง flush ของ commit ตัว replication เป็นแบบ asynchronous โดย default แต่ถ้าใส่ชื่อ standby ไว้ใน `synchronous_standby_names` ตัว COMMIT ก็จะรอ standby นั้นด้วย ([read replicas](../read-replicas/))
- **archiving และ point-in-time recovery** `archive_command` ก็อป segment ที่เต็มแล้วแต่ละตัวไปเก็บที่อื่น ส่วนของเราก็อป `…076` ทันทีที่ `pg_switch_wal()` ปิดมัน ตัว base backup บวก WAL ที่ archive ไว้ replay ไปถึงจังหวะไหนก็ได้ เช่น หนึ่งนาทีก่อน `DELETE` ที่พลาด ([disaster recovery strategies](../disaster-recovery-strategies/))
- **logical decoding** ถ้าตั้ง `wal_level = logical` ตัว replication slot จะ decode WAL ชุดเดียวกันออกมาเป็นการเปลี่ยนระดับ row และนี่คือวิธีที่ Debezium publish มันไปที่ [Kafka](../kafka/) สำหรับ [change data capture](../change-data-capture/)

log คือบันทึกความจริง ส่วน table คือผลลัพธ์ที่สร้างขึ้นจากมัน เป็นแนวคิดที่ [event sourcing](../event-sourcing/) เอาไปใช้ในระดับแอปพลิเคชัน ส่วน store แบบ log-structured ก็ยึดหลักเดียวกัน: [Cassandra](../cassandra/) ต่อท้ายทุกการเขียนลง commit log ก่อนเข้า memtable ([LSM tree vs B-tree](../lsm-tree/))

## ลองรันดู

ข้อมูลตัวอย่างมาจาก [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop) ที่เป็น script สร้าง template database `acme` บน PostgreSQL 18 ในเวลาราวหนึ่งนาที

รันใน `psql` ในฐานะ superuser (เพราะต้องใช้ `pg_walinspect`, `CHECKPOINT` และ `pg_read_binary_file`) บนสำเนาใหม่ของข้อมูลตัวอย่าง ตัว LSN ของคุณจะไม่ตรงกับที่นี่ แต่จำนวนและขนาดควรตรง

```sql
-- CREATE DATABASE wal_try TEMPLATE acme STRATEGY FILE_COPY;   -- then connect to wal_try
CREATE EXTENSION pg_walinspect;
CREATE EXTENSION pageinspect;

CHECKPOINT;                                     -- start a fresh checkpoint cycle
SELECT pg_current_wal_insert_lsn() AS before \gset

BEGIN;
INSERT INTO orders (customer_id, status, shipping_country, created_at, total_thb)
VALUES (42, 'pending', 'TH', now(), 20491.28) RETURNING id, ctid;
-- 500001 | (5057,91)
INSERT INTO order_items (order_id, line_no, product_id, qty, price_thb)
VALUES (500001, 1, 42, 1, 5290.92), (500001, 2, 128, 2, 7600.18);
SELECT pg_current_xact_id() AS xid, pg_current_wal_insert_lsn() AS inserted,
       pg_current_wal_flush_lsn() AS flushed \gset
\echo inserted :inserted flushed :flushed
-- inserted 3/B8682330 flushed 3/B8678180: the records are still in the WAL buffers
COMMIT;
SELECT pg_current_wal_flush_lsn() AS after \gset

SELECT record_type, pg_filenode_relation(0, relfilenode) AS rel,
       relblocknumber AS block, block_fpi_length AS page_image
FROM pg_get_wal_block_info(:'before', :'after') WHERE xid = :'xid';
-- LOG         | orders_id_seq    |     0 |    0
-- INSERT      | orders           |  5057 | 7516
-- INSERT_LEAF | orders_pkey      |  1373 |  940
-- LOCK        | customers        |     0 | 8172   the FK check locks customer 42
-- INSERT      | order_items      | 10416 | 5532
-- INSERT_LEAF | order_items_pkey |  4812 | 2056
-- INSERT      | order_items      | 10416 |    0
-- INSERT_LEAF | order_items_pkey |  4812 |    0
-- LOCK        | orders           |  5057 |    0
-- LOCK        | products         |     0 | 8156
-- LOCK        | products         |     1 | 8156   (the COMMIT record has no block)

SELECT count(*) AS records, count(*) FILTER (WHERE fpi_length > 0) AS page_images,
       sum(record_length) AS bytes
FROM pg_get_wal_records_info(:'before', :'after') WHERE xid = :'xid';
-- 12 | 7 | 41268

-- COMMIT flushed the log, not the table: page 5057 in memory and in the file
SELECT (lower - 24) / 4 AS rows_in_memory FROM page_header(get_raw_page('orders', 5057));
-- 91
SELECT (get_byte(p, 12) + 256 * get_byte(p, 13) - 24) / 4 AS rows_on_disk
FROM pg_read_binary_file(pg_relation_filepath('orders'), 5057 * 8192, 16) AS p;
-- 90   (pd_lower read from the file, little-endian; until the next checkpoint)

-- the next order changes the same pages, which already have their images
SELECT pg_current_wal_insert_lsn() AS before \gset
BEGIN;
INSERT INTO orders (customer_id, status, shipping_country, created_at, total_thb)
VALUES (42, 'pending', 'TH', now(), 20491.28) RETURNING id;     -- 500002
INSERT INTO order_items (order_id, line_no, product_id, qty, price_thb)
VALUES (500002, 1, 42, 1, 5290.92), (500002, 2, 128, 2, 7600.18);
SELECT pg_current_xact_id() AS xid \gset
COMMIT;
SELECT pg_current_wal_flush_lsn() AS after \gset
SELECT count(*) AS records, count(*) FILTER (WHERE fpi_length > 0) AS page_images,
       sum(record_length) AS bytes
FROM pg_get_wal_records_info(:'before', :'after') WHERE xid = :'xid';
-- 11 | 0 | 742

CHECKPOINT;                                     -- now the pages go to disk
SELECT (get_byte(p, 12) + 256 * get_byte(p, 13) - 24) / 4 AS rows_on_disk
FROM pg_read_binary_file(pg_relation_filepath('orders'), 5057 * 8192, 16) AS p;
-- 92
```

## ใช้ตอนไหนดี

PostgreSQL เขียน WAL เสมอ สิ่งที่เราเลือกได้คือจะ tune มันยังไง และใครอีกบ้างที่จะอ่านมัน

- **ใช้ `synchronous_commit = on` ต่อไปสำหรับ order และการจ่ายเงิน** ปิดมันเป็นราย transaction (`SET LOCAL synchronous_commit = off`) หรือราย role สำหรับข้อมูลที่ยอมเสียไปได้เสี้ยววินาที เช่น clickstream event: crash ทำให้ commit หายไปได้มากสุดราวสามช่วงของ `wal_writer_delay` (ค่า default รวมเป็น 600 ms) และ database ก็ยัง consistent อยู่
- **อย่าตั้ง `fsync = off`** นอก cluster ที่สร้างใหม่ตั้งแต่ศูนย์ได้ และปิด `full_page_writes` เฉพาะที่ file system รับประกันว่าไม่มีการเขียน page แค่บางส่วน (เอกสารยกตัวอย่าง ZFS)
- **ให้เวลาเป็นตัว trigger checkpoint ไม่ใช่ปริมาณ WAL** เพิ่ม `max_wal_size` จนข้อความ `checkpoint_warning` หยุดขึ้น แล้วเลือก `checkpoint_timeout` ตามเวลาที่ crash recovery ใช้ได้
- **archive WAL** ถ้าต้องการ point-in-time recovery ส่วน streaming replica ไม่ได้ช่วยกัน `DELETE` ที่พลาด: มัน replay คำสั่งนั้นตามไปด้วย
- **วาง `pg_wal` ไว้บน storage ที่ latency ต่ำและ flush ได้จริง** เพราะเวลา flush ของมันคือเวลา commit ของเรา เอกสารเตือนเรื่อง drive ที่รายงานว่าเขียนเสร็จแล้วทั้งที่ข้อมูลยังอยู่ใน cache ที่หายเมื่อไฟดับ
- **คอยดูมัน:** `pg_stat_wal` (record, page image, byte), row ของ `wal` ใน `pg_stat_io`, `pg_stat_checkpointer`, `pg_stat_archiver`, `pg_stat_replication` และ `pg_replication_slots`

## ได้อะไร เสียอะไร

- **latency ของ commit คือ WAL flush หนึ่งครั้ง** client ตัวเดียวทำได้ราว 2,200 order ต่อวินาทีด้วย `synchronous_commit = on` ที่ fsync หนึ่งครั้งต่อ commit และ 3,400 ด้วย `off` จากการรัน pgbench รอบละ 10 วินาที แบบละสองรอบบน laptop พอมี 8 client การ commit 79,562 ครั้งใช้ fsync 28,654 ครั้ง: flush หนึ่งครั้งรองรับเฉลี่ย 2.8 commit ยิ่ง storage flush ช้า ช่องว่างนี้ก็ยิ่งกว้าง
- **ทุกอย่างถูกเขียนสองรอบ** รอบหนึ่งลง WAL และอีกรอบทีหลังลง data file และทุก index ก็เพิ่ม record ของตัวเองเข้าไป: [B-tree index](../b-tree-index/) วัดได้ WAL 8.5 MB สำหรับการ insert 50,000 ครั้งตอนมี index ตัวเดียว และ 15.6 MB ตอนมีสามตัว
- **page image หลังทุก checkpoint** ใน 10 s แรกหลัง `CHECKPOINT` ตัว order ของ pgbench เขียน WAL เฉลี่ย 1,162 byte โดย 36% เป็น page image (1,238 ตัว เกือบทั้งหมดเป็น page ของ `customers` และ `products` ที่มีแค่ lock ของ foreign key แตะ) ส่วนใน 10 s ถัดมาเฉลี่ยแค่ 740 byte ตัว vacuum ก็ต้องจ่ายแบบเดียวกัน: autovacuum รอบแรกหลังการรันพวกนั้น mark page เก่าของ `orders` และ `order_items` ว่า all-visible แล้ว log page image ไป 126 MB ตัว `wal_compression` (`pglz`, `lz4` หรือ `zstd`) ช่วยย่อ image ได้โดยแลกกับการใช้ CPU เพิ่มขึ้นบ้าง
- **I/O ของ checkpoint** checkpoint เขียน dirty page ทุกตัว มันเลยคุมจังหวะการเขียนให้เสร็จที่ 90% ของช่วงเวลา (`checkpoint_completion_target = 0.9`) ส่วน timed checkpoint ครั้งหนึ่งในการรันของเราเขียน 19,880 buffer หรือ 60.7% ของ shared buffer ในเวลา 270 วินาที checkpoint ที่ถี่ขึ้นทำให้ recovery สั้นลง แต่ก็มี page image และการเขียนมากขึ้น
- **disk ที่ต้องคอยดู** `pg_wal` เก็บ segment ไว้จนกว่า recovery จะไม่ต้องใช้มันแล้ว archiver ก็อปมันไปแล้ว และ replication slot ทุกตัว consume มันไปแล้ว ถ้า `archive_command` fail อยู่หรือมี slot ที่ถูกทิ้งไว้ disk ก็จะเต็ม ส่วน `max_slot_wal_keep_size` ใช้จำกัดปริมาณที่ slot ถือไว้ได้

## ข้อควรรู้ตอนลงมือทำ

**การอ่าน log** `pg_walinspect` (`pg_get_wal_records_info`, `pg_get_wal_block_info`, `pg_get_wal_stats`) อ่าน record จาก SQL และโดย default มีแค่ superuser กับสมาชิกของ `pg_read_server_files` ที่เรียกใช้ได้ ส่วน `pg_waldump` อ่าน segment file โดยตรง และต้องรันในฐานะ user ของ operating system ที่รัน server ส่วน PostgreSQL 18 รายงานการเขียนและ fsync ของ WAL ใน `pg_stat_io` (พร้อมเวลาถ้าเปิด `track_wal_io_timing`) และรายงานแยกราย backend ผ่าน `pg_stat_get_backend_wal()` และ `pg_stat_get_backend_io()` และ `pg_stat_wal` ก็เสีย column ของ write และ sync ไปในเวอร์ชัน 18 อีกเรื่องคือผลข้างเคียงหนึ่งของการ log ล่วงหน้าคือ sequence จะ log ค่าเกินไปจากตัวที่มันแจกออกไป 32 ค่า หลัง crash ของเรา order id ถัดไปเลยเป็น 500034 ไม่ใช่ 500002 ช่องว่างใน sequence เป็นเรื่องปกติ

**MySQL (InnoDB, 8.4)** แบ่งงานชุดเดียวกันต่างออกไป **redo log** ของมันถูก replay ตอน startup หลัง crash ตัว `innodb_redo_log_capacity` กำหนดขนาดของมัน ที่ default คือ 100 MB ใน 32 file ใต้ `#innodb_redo` (ค่า default อ่านจาก server MySQL 8.4.11) ส่วน `innodb_flush_log_at_trx_commit = 1` ที่เป็น default จะเขียนและ flush log ทุก commit ถ้าตั้งเป็น 2 ตัว log จะถูกเขียนตอน commit และ flush ราววินาทีละครั้ง ถ้าตั้งเป็น 0 ทั้งสองอย่างเกิดราววินาทีละครั้ง และ crash อาจทำให้ commit ราวหนึ่งวินาทีหายไป ส่วน torn page จัดการด้วย **doublewrite buffer** (`innodb_doublewrite = ON`): InnoDB เขียน page ลง doublewrite file ก่อน เป็นชุดใหญ่ ๆ ต่อกันตามลำดับ แล้วค่อยเขียนลงที่ของมัน ตอน recovery เลยหยิบสำเนาที่สมบูรณ์ของ page ที่ crash ทำให้ torn มาใช้ได้ ในขณะที่ PostgreSQL ใช้ page image ใน WAL ของมันแทน หลัง redo แล้ว InnoDB จะ rollback transaction ที่ยัง active อยู่ด้วย undo log ของมัน ส่วน replication และ point-in-time recovery อ่าน log อีกตัวที่แยกกัน คือ **binary log** ที่ server ทำให้ตรงกับ redo log ด้วย two-phase commit (`sync_binlog = 1` flush มันทุก commit)

**SQL Server** ก็ใช้ transaction log แบบ write-ahead เหมือนกัน **delayed durability** ของมัน (`ALTER DATABASE … SET DELAYED_DURABILITY = ALLOWED` หรือ `FORCED` โดย default เป็น `DISABLED`) คือคู่เทียบของ `synchronous_commit = off`: commit คืนค่ากลับมาก่อนที่ log record จะถึง disk แล้ว record พวกนั้นจะถูกเขียนเมื่อ log buffer เต็ม เมื่อ transaction ที่ durable เต็มรูปแบบ commit หรือเมื่อ `sys.sp_flush_log` รัน

**SQLite** ใน WAL mode (`PRAGMA journal_mode = WAL`) ต่อท้ายการเปลี่ยนลงใน file `-wal` ที่แยกออกมา แล้วก็อปมันเข้า database file ตอน checkpoint ถ้าตั้ง `PRAGMA synchronous = NORMAL` มันจะยัง consistent หลังไฟดับ แต่อาจเสีย commit ช่วงสุดท้ายไป

**Amazon Aurora** ดันงานประมวลผล redo ลงไปที่ storage service ของมัน: database instance ส่ง log record ออกไป และ storage node ที่กระจายอยู่ในสาม Availability Zone ก็สร้าง page จาก record พวกนั้น ทำให้ network traffic ลดลงและ crash recovery เร็ว ([Amazon RDS & Aurora](../amazon-rds-aurora/))
