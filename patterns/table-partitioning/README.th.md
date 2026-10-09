## ปัญหา

Acme Shop บันทึก event สามตัวสำหรับทุก order (`placed`, `paid` และ `shipped`) ไว้ใน `order_events`: 1,500,000 row ตั้งแต่ 31 ธันวาคม 2024 ถึง 3 ตุลาคม 2026 อยู่ใน table เดียวขนาด 86 MB จำนวน 11,030 page พร้อม primary key ขนาด 32 MB ตัว row ถูกเขียนตามลำดับเวลา ทำให้ event เก่าสุดอยู่บน page แรก ๆ ของไฟล์ ส่วน Acme เก็บ event ไว้สิบสองเดือน และงานสองแบบบน table นี้ก็โตตามมันไปด้วย:

- **report ตามช่วงเวลา** `SELECT count(*) FROM order_events WHERE happened_at >= '2026-08-31' AND happened_at < '2026-09-07'` ต้องการแค่หนึ่งสัปดาห์: 16,408 row บน 122 page แต่มี index แค่ primary key ตัว [PostgreSQL](../postgresql/) 18.6 เลยรัน `Parallel Seq Scan` ด้วย worker สองตัว ทั้งสาม process อ่านครบทั้ง 11,030 page และทิ้ง row ไป 1,483,592 ตัว ใช้เวลา 30 ms ในการรันครั้งหนึ่งบน laptop
- **retention** การลบทุกอย่างก่อน 1 ตุลาคม 2025 ใช้ statement เดียว คือ `DELETE FROM order_events WHERE happened_at < '2025-10-01'` และมันคือตัวที่แพง การ delete ของ PostgreSQL ไม่ได้เอา row ออก: มันเขียน id ของ transaction ที่ลบลงใน `xmax` ของ row แล้ว row ก็ยังอยู่บน page ของมันจนกว่า VACUUM จะเก็บกวาดคืน ([MVCC](../mvcc/)) ตัว statement นี้ใช้ 0.31 s เพื่อ mark row 639,726 ตัว คือ 43% ของ table บน 4,704 page และ `EXPLAIN (ANALYZE, WAL)` นับได้ WAL record 639,726 ตัวบวก full-page image อีก 4,705 ตัว: **WAL 70 MB** สำหรับ row ที่กินพื้นที่ page แค่ 37 MB ([write-ahead log](../write-ahead-log/)) ส่วน streaming replica หรือ WAL archive ที่ server มีอยู่ ก็ต้องรับทุก byte ของมันไปด้วย

ต่อมาก็ถึงการเก็บกวาด ตัว `pg_stat_user_tables` รายงาน dead row 639,726 ตัว ส่วน `VACUUM (VERBOSE)` scan heap 4,705 page และ primary key ทั้ง 4,116 page เพื่อลบ index entry ของพวกมัน แล้วเขียน WAL เพิ่มอีก 17 MB ใน 0.09 s ส่วน heap page 0 ที่ `pageinspect` เคยแสดงว่ามี 136 row ที่มี `xmax` 631066 ก็ว่างเปล่าหลังจากนั้น โดยมีที่ว่าง 8,164 byte แต่ไฟล์ไม่ได้เล็กลง: VACUUM คืนพื้นที่ให้ operating system ก็ต่อเมื่อ page ว่างอยู่ท้าย table แต่ 4,703 page นี้อยู่ต้น table ตัว table เลยยังมีขนาด 86 MB และ row ใหม่จะไปเติมรูพวกนั้น ทำให้ table เสียลำดับตามเวลาไปด้วย เวลาพวกนี้น้อยเพราะ table เล็ก แต่ WAL และงานของ vacuum โตตามทุก row ที่ลบ

## ทำงานยังไง

**parent และ partition ของมัน** declarative partitioning เปลี่ยน table เชิง logical หนึ่งตัวให้เป็น parent กับชุดของ partition ที่แบ่งด้วย partition key:

```sql
CREATE TABLE order_events (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  order_id    bigint NOT NULL REFERENCES orders (id),
  kind        text NOT NULL,
  happened_at timestamptz NOT NULL,
  PRIMARY KEY (id, happened_at)
) PARTITION BY RANGE (happened_at);

CREATE TABLE order_events_2026_09 PARTITION OF order_events
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
```

ตัว parent ไม่ได้เก็บ row เลย (`pg_relation_size` คืน 0) มันเก็บ definition, key และ list ของ partition ส่วนแต่ละ partition คือ table ธรรมดาที่มี heap file, index, statistics และรอบ vacuum ของตัวเอง ตัว range รวมขอบล่างแต่ไม่รวมขอบบน ทำให้ event ที่เกิดตอนเที่ยงคืนพอดีของ 1 ตุลาคมไปอยู่ใน `order_events_2026_10` ทาง Acme สร้าง 25 partition ตั้งแต่ธันวาคม 2024 ถึงธันวาคม 2026 โดย generate `CREATE TABLE … PARTITION OF` เดือนละหนึ่งตัวด้วย `\gexec` ของ psql (ดู *ลองรันดู*) ขอบของ key ที่เป็น `timestamptz` จะถูกอ่านตาม time zone ของ session (บน server นี้คือ UTC) และเก็บเป็น `'2026-09-01 00:00:00+00'`

มีสามวิธี:

| วิธี | partition หนึ่งตัวเก็บ | เหมาะกับ | ตัวอย่างบนข้อมูลของ Acme |
|---|---|---|---|
| Range | ค่า key ที่เป็นช่วงต่อเนื่องกัน | timestamp, id | `order_events` รายเดือน |
| List | ค่าที่ระบุไว้ให้มัน | ประเทศ, region, tenant | `orders` ตาม `shipping_country` |
| Hash | row ที่ hash ของ key แล้วได้เศษตรงกับของมัน (`MODULUS 8, REMAINDER 3`) | key ที่ไม่มี range ที่มีประโยชน์ | `order_items` ตาม `order_id` แบ่งเป็น 8 ส่วนขนาดใกล้ ๆ กัน |

partition หนึ่งตัวแบ่ง partition ต่อได้อีก และ partition แบบ `DEFAULT` (เฉพาะ range และ list) จะรับ row ที่ไม่เข้ากับ partition ไหนเลย

**การ route** row ถูกเขียนลงที่ parent แล้ว PostgreSQL ก็ route แต่ละ row ไปที่ partition ที่ range ของมันครอบ key ของ row นั้น: `INSERT INTO order_events VALUES (DEFAULT, 500000, 'delivered', '2026-10-06 09:30') RETURNING tableoid::regclass` คืน `order_events_2026_10` ส่วน event ที่ลงวันที่ 5 มกราคม 2027 fail ด้วย `no partition of relation "order_events" found for row` เพราะยังไม่มี partition ไหนครอบมัน ทำให้ partition ของเดือนหน้าต้องมีอยู่ก่อนที่ row ของมันจะมาถึง ส่วน `UPDATE` ที่ย้าย `happened_at` ข้ามขอบจะย้าย row ไปอยู่อีก partition

**index และ key** `CREATE INDEX ON order_events (order_id)` สร้าง partitioned index บน parent และ index จริงบนแต่ละ partition ทั้ง 25 ตัว เช่น `order_events_2026_09_order_id_idx` ขนาด 1,152 kB และทุก partition ที่สร้างหรือ attach ทีหลังก็จะได้ index นี้ด้วย และ `pg_partition_tree('order_events_order_id_idx')` ก็ list พวกมันออกมา index แต่ละตัวเห็นแค่ partition ของตัวเอง นี่คือเหตุผลที่ unique constraint ต้องมีทุก column ของ partition key: `PRIMARY KEY (id)` fail ด้วย `unique constraint on partitioned table must include all partitioning columns` ทำให้ key เป็น `(id, happened_at)` ตัว identity column ยังแจก `id` แต่ละค่าแค่ครั้งเดียว แต่ไม่มี index ไหนกัน row ที่สองที่มี `id` เดียวกันแต่ `happened_at` ต่างกันได้ ส่วน `CREATE INDEX CONCURRENTLY` ใช้กับ parent ไม่ได้ วิธีเลี่ยงตาม documentation คือสร้าง index `ON ONLY` parent แล้ว build index ของแต่ละ partition แบบ concurrently และ attach ด้วย `ALTER INDEX … ATTACH PARTITION`

**partition pruning** planner เทียบ clause `WHERE` กับขอบของ partition แล้วตัดทุก partition ที่ไม่มีทางมี row ที่ตรงออกไป นี่คือสัปดาห์จาก *ปัญหา* บน table ที่แบ่ง partition แล้ว:

```
Aggregate (actual rows=1.00)                              Buffers: shared hit=1052
  ->  Append (actual rows=16408.00)
        ->  Seq Scan on order_events_2026_08   Rows Removed by Filter: 70314   Buffers: shared hit=535
        ->  Seq Scan on order_events_2026_09   Rows Removed by Filter: 56250   Buffers: shared hit=517
```

มันอ่าน 1,052 page แทน 11,030 ใช้ 9 ms เทียบกับ 30 ms ในการรันครั้งหนึ่ง อีก 23 partition ถูก prune ไปตอน plan เลยไม่โผล่ใน plan เลย ถ้าค่าบางตัวรู้ได้แค่ตอนรัน ตัว executor จะ prune แทน และ `EXPLAIN` จะรายงาน `Subplans Removed`: prepared statement ที่มี `$1` และ `$2` ภายใต้ generic plan แสดง `Subplans Removed: 23` และ `happened_at >= now() - interval '7 days'` แสดง `Subplans Removed: 22` แล้ว scan ตุลาคมถึงธันวาคม 2026 ส่วน partition ที่ถูกตัดออกตอน executor เริ่มทำงานยังถูก lock อยู่ ตัว pruning เปิดไว้เป็นค่า default (`enable_partition_pruning`)

pruning ไม่ได้ชนะ index ดี ๆ บนช่วงแคบ ๆ ถ้ามี B-tree ขนาด 32 MB บน `happened_at` ตัว query บน table เดียวอ่าน 170 page ใน 2.4 ms ด้วย `Index Only Scan` และ BRIN index ขนาด 24 kB บน column เดียวกันจาก [index types](../index-types/) ก็บีบ scan ให้แคบลงได้เหมือนกัน ส่วน pruning ช่วยได้มากที่สุดตรงที่ index จะไม่ถูกใช้: report ที่ group ทั้งเดือนกันยายน 2026 ตาม `kind` อ่านทุก page ของ table เดียว (26 ms) แต่อ่านแค่ 517 page ของ partition เดียว (12 ms)

**partition-wise join และ aggregate** ถ้าเปิด `enable_partitionwise_join` ไว้ ตัว join ระหว่างสอง table ที่แบ่ง partition แบบเดียวกันบน partition key ทุกตัว จะรันเป็นหนึ่ง join ต่อแต่ละคู่ partition ที่ตรงกัน ถ้าเปิด `enable_partitionwise_aggregate` ไว้ การ group และ aggregate จะรันทีละ partition แบบเต็มตัวถ้า `GROUP BY` มี partition key และแบบบางส่วนถ้าไม่มี ทั้งสองตัวปิดไว้เป็นค่า default เพราะมันทำให้การ plan แพงขึ้น และอาจทำให้ memory ที่ query ใช้ทวีคูณ ได้ถึงหนึ่ง `work_mem` ต่อ partition สำหรับแต่ละ sort หรือ hash ส่วน PostgreSQL 18 ยอมให้ใช้ partition-wise join ได้ในหลายกรณีขึ้นและใช้ memory น้อยลง

**statistics** autovacuum จะ vacuum และ analyze ทุก partition เหมือน table อื่น ๆ แต่ไม่เคย analyze ตัว parent ถ้า query ต้องใช้ statistics ของ parent เพื่อให้ได้ plan ที่ดี ให้รัน `ANALYZE order_events` เองหลัง load หรือลบข้อมูลก้อนใหญ่ ส่วน `ANALYZE ONLY order_events` ที่เป็นของใหม่ใน PostgreSQL 18 จะ refresh statistics ของ parent โดยไม่ต้อง analyze ทุก partition ใหม่อีกรอบ

**retention: detach แล้วค่อย drop** ตอนนี้การลบหนึ่งเดือนคือการลบ table หนึ่งตัว และ lock ที่มันเอาไปสำคัญกว่าความเร็วของมัน lock ในตารางนี้อ่านจาก `pg_locks` ภายใน transaction ที่ rollback บน schema นี้ ส่วน `DETACH … CONCURRENTLY` รันใน transaction ไม่ได้ แถวของมันในตารางเลยรวมระดับ lock ที่ documentation ระบุสำหรับ `order_events` เข้ากับ lock ที่เห็นว่ามันรออยู่บน `orders`:

| Statement | lock บน `order_events` | lock บน `orders` ผ่าน foreign key |
|---|---|---|
| `CREATE TABLE … PARTITION OF order_events` | ACCESS EXCLUSIVE | SHARE ROW EXCLUSIVE |
| `ALTER TABLE order_events ATTACH PARTITION …` | SHARE UPDATE EXCLUSIVE | SHARE ROW EXCLUSIVE |
| `ALTER TABLE order_events DETACH PARTITION …` | ACCESS EXCLUSIVE | SHARE ROW EXCLUSIVE |
| `ALTER TABLE order_events DETACH PARTITION … CONCURRENTLY` | SHARE UPDATE EXCLUSIVE | SHARE ROW EXCLUSIVE |
| `DROP TABLE` ของ partition ที่ยัง attach อยู่ | ACCESS EXCLUSIVE | ไม่มี |
| `DROP TABLE` ของ partition ที่ detach แล้ว | ไม่มี | ACCESS EXCLUSIVE |

ACCESS EXCLUSIVE ชนกับ lock ทุกแบบ รวมถึง `SELECT` ธรรมดา ส่วน SHARE ROW EXCLUSIVE ให้การอ่านผ่านไปได้แต่ไม่ให้การเขียน ตัว statement ที่รอ lock ยังทำให้ query ที่มาถึงทีหลังต้องรอต่อคิวอยู่ข้างหลังมันด้วย ([locks and deadlocks](../locks-and-deadlocks/)) นี่คือสาม session บนสำเนาใหม่ ที่ script สั่งตามลำดับนี้:

| เวลา | Session 1 | Session 2 (retention) | Session 3 (report ของสัปดาห์นั้น) |
|---|---|---|---|
| 0.0 s | `BEGIN`, นับ event ตั้งแต่ 1 กันยายน 2026, `pg_sleep(3)` | | |
| 0.5 s | | `DROP TABLE order_events_2024_12` รอ ACCESS EXCLUSIVE | |
| 1.0 s | | | รอ ACCESS SHARE ต่อคิวหลัง session 2 |
| 3.0 s | `COMMIT` | เสร็จที่ 3.04 s | ได้คำตอบที่ 3.05 s หลังรอไป 2.04 s |

ถ้า session 2 เปลี่ยนไปรัน `ALTER TABLE order_events DETACH PARTITION order_events_2025_01 CONCURRENTLY` ตัว report ก็ได้คำตอบใน 0.05 s ส่วนตัว detach รอ session 1 (`pg_stat_activity` แสดงว่ามันรออยู่ที่ `Lock/virtualxid`) แล้วเสร็จที่ 3.05 s

**foreign key ไปที่ `orders`** partition ที่ detach แล้วจะเก็บสำเนาของ foreign key ไว้เอง และ lock ที่เหลือก็ไปตกอยู่ที่นั่น ตอนมี query 3 วินาทีที่อ่าน `orders` อยู่ ตัว `DROP TABLE` ของ `order_events_2025_02` ที่ detach แล้วต้องรอ ACCESS EXCLUSIVE บน `orders` อยู่ 2.55 s และ `SELECT status FROM orders WHERE id = 42` ของหน้า order ก็ต่อคิวข้างหลังมันอยู่ 2.05 s ตอนมี transaction ที่ถือ update บน `orders` อยู่ ตัว concurrent detach ของเดือนถัดไปต้องรอ SHARE ROW EXCLUSIVE อยู่ 2.53 s และ `UPDATE orders` อีกตัวก็ต่อคิวข้างหลังมันอยู่ 2.03 s การ drop foreign key ก่อนก็ไม่ช่วย เพราะ `ALTER TABLE … DROP CONSTRAINT` ก็เอา ACCESS EXCLUSIVE บน `orders` เหมือนกัน วิธีป้องกันที่ใช้กันทั่วไปคือตั้ง `lock_timeout` สั้น ๆ ให้ retention job: ด้วย `SET lock_timeout = '100ms'` ตัว `DROP TABLE` เดิมยอมแพ้หลัง 0.14 s (`canceling statement due to lock timeout`) หน้า order ได้คำตอบใน 0.03 s และ job ก็ลองใหม่ทีหลังได้ อีกทางคือไม่ใส่ foreign key บน event table ที่มีปริมาณสูง แล้วไปเช็ก reference ใน application แทน

`DETACH … CONCURRENTLY` รันเป็นสอง transaction: ตัวแรก mark ว่า partition กำลังถูก detach แล้ว commit จากนั้นคำสั่งจะรอทุก transaction ที่กำลังใช้ partitioned table อยู่ แล้ว transaction ที่สองก็ทำ detach ให้เสร็จ มันรันใน transaction block ไม่ได้ ใช้ไม่ได้ตอนที่ table มี default partition และมันทิ้ง `CHECK` constraint ที่ทวนขอบเดิมไว้บน table ที่ detach แล้ว (`\d order_events_2025_08` แสดงให้เห็น) ถ้ามันถูกขัดจังหวะกลางทาง คำสั่ง `DETACH PARTITION … FINALIZE` จะทำให้เสร็จ ช่วงระหว่าง detach กับ drop เป็นจังหวะที่ดีในการ archive เดือนนั้นด้วย `COPY` หรือ `pg_dump`

สำหรับการรันครั้งแรกของ Acme สิบเดือนก่อนตุลาคม 2025 ใช้ 20 statement: รวม 38 ms และ WAL 159 kB (1,871 record, ไม่มี full-page image) ไม่มี dead row และไม่มีอะไรต้อง vacuum ไฟล์ 67 MB ของพวกมัน (heap 37 MB, index 30 MB) ถูกคืนทันทีที่แต่ละ `DROP` commit และ database ลดจาก 469 MB เหลือ 402 MB ส่วน `DELETE` กับ VACUUM ของมันทำงานเดียวกันโดยใช้ WAL 87 MB และทิ้งไฟล์ 86 MB ไว้

**สร้าง partition ไว้ล่วงหน้า** `order_events_2026_11` และ `order_events_2026_12` มีอยู่ก่อน row แรกของมัน ตัว `CREATE TABLE … PARTITION OF` เอา ACCESS EXCLUSIVE บน parent เพราะฉะนั้นให้สร้างมันตอนที่ระบบเงียบ ๆ หรือสร้าง table แยกเดี่ยว ๆ ก่อน เพิ่ม `CHECK` constraint ที่ตรงกับขอบ แล้ว attach ด้วย ATTACH PARTITION ที่ต้องการแค่ SHARE UPDATE EXCLUSIVE ไม่ว่าทางไหนก็ให้ตั้ง `lock_timeout` สั้น ๆ ไว้ ส่วน pg_partman 5.5.0 (กรกฎาคม 2026) ทำงานบ้านทั้งสองอย่างนี้ให้อัตโนมัติ: `create_parent()` เก็บ partition ล่วงหน้าไว้สี่ตัวเป็นค่า default (`p_premake`), column `retention` ของ `part_config` เก็บช่วงเวลาที่จะเก็บ (`'12 months'`) และ maintenance รันจาก background worker ของมัน ทุกชั่วโมงเป็นค่า default หรือรันจาก `run_maintenance_proc()` ภายใต้ scheduler อย่าง pg_cron ค่า default ของมันสองตัวควรดูให้ดี: `create_parent()` สร้าง default partition ให้ด้วย ทำให้ใช้ `DETACH … CONCURRENTLY` ไม่ได้ และ retention จะแค่ detach partition เก่า ถ้าไม่ได้ตั้ง `retention_keep_table` เป็น false

## ลองรันดู

ข้อมูลตัวอย่างมาจาก [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop) ที่เป็น script สร้าง template database `acme` บน PostgreSQL 18 ในเวลาราวหนึ่งนาที

รันชุดนี้ด้วย psql บนสำเนาใหม่ของมัน ตัว `\gexec` จะรันแต่ละ statement ที่ generate ออกมาแยกกันทีละตัว แบบที่ `DETACH … CONCURRENTLY` ต้องการ ตัว comment แสดงบรรทัดสำคัญของ output

```sql
-- CREATE DATABASE partitioning_try TEMPLATE acme;   -- then connect to partitioning_try

-- 1. One table: a week of events reads every page
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM order_events
WHERE happened_at >= '2026-08-31' AND happened_at < '2026-09-07';
-- Parallel Seq Scan on order_events   Rows Removed by Filter: 494531   (per process, x 3)
--   Buffers: shared read=11030

-- 2. The retention DELETE, rolled back so that the rows stay for step 3
BEGIN;
EXPLAIN (ANALYZE, WAL) DELETE FROM order_events WHERE happened_at < '2025-10-01';
-- Delete on order_events   WAL: records=639726 fpi=4704 bytes=73066260
--   ->  Seq Scan on order_events (actual rows=639726.00)
ROLLBACK;

-- 3. Partition by month and move the rows in
ALTER TABLE order_events RENAME TO order_events_old;
ALTER INDEX order_events_pkey RENAME TO order_events_old_pkey;
CREATE TABLE order_events (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  order_id    bigint NOT NULL REFERENCES orders (id),
  kind        text NOT NULL,
  happened_at timestamptz NOT NULL,
  PRIMARY KEY (id, happened_at)                  -- must include the partition key
) PARTITION BY RANGE (happened_at);
SELECT format('CREATE TABLE order_events_%s PARTITION OF order_events FOR VALUES FROM (%L) TO (%L)',
              to_char(m, 'YYYY_MM'), m::date, (m + interval '1 month')::date)
FROM generate_series(timestamptz '2024-12-01', '2026-12-01', interval '1 month') AS m \gexec
-- CREATE TABLE, 25 times: order_events_2024_12 ... order_events_2026_12
INSERT INTO order_events OVERRIDING SYSTEM VALUE SELECT * FROM order_events_old;
-- INSERT 0 1500000
SELECT setval(pg_get_serial_sequence('order_events', 'id'), 1500000);
CREATE INDEX ON order_events (order_id);
ANALYZE order_events;

-- 4. The same week reads two partitions
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM order_events
WHERE happened_at >= '2026-08-31' AND happened_at < '2026-09-07';
-- Append (actual rows=16408.00)   Buffers: shared hit=1052
--   ->  Seq Scan on order_events_2026_08 order_events_1   Rows Removed by Filter: 70314   Buffers: shared hit=535
--   ->  Seq Scan on order_events_2026_09 order_events_2   Rows Removed by Filter: 56250   Buffers: shared hit=517

INSERT INTO order_events VALUES (DEFAULT, 500000, 'delivered', '2026-10-06 09:30')
RETURNING tableoid::regclass;
-- order_events_2026_10

-- 5. Retention: detach and drop every month before October 2025, one statement at a time
SELECT format('ALTER TABLE order_events DETACH PARTITION %I CONCURRENTLY', inhrelid::regclass),
       format('DROP TABLE %I', inhrelid::regclass)
FROM pg_inherits
WHERE inhparent = 'order_events'::regclass AND inhrelid::regclass::text < 'order_events_2025_10'
ORDER BY 1 \gexec
-- ALTER TABLE and DROP TABLE, 10 times each: order_events_2024_12 ... order_events_2025_09
SELECT count(*) FROM order_events;
-- 860275
```

จำนวน full-page image ในขั้นที่ 2 ขึ้นกับว่า checkpoint ล่าสุดรันตอนไหน: การเปลี่ยน page ครั้งแรกหลัง checkpoint เท่านั้นที่ log ทั้ง page ส่วนถ้ายังไม่มี checkpoint รันเลยตั้งแต่ทำสำเนา ค่า `fpi` อาจเป็น 0 และ `bytes` เหลือราวครึ่งหนึ่ง (34,545,204 ในการรันแบบนั้นครั้งหนึ่ง)

## ใช้ตอนไหนดี

- **table ใหญ่ที่มี lifecycle ตามเวลา:** event, log, metric และ audit trail ที่ข้อมูลเก่าออกไปเป็นช่วงเวลาทั้งก้อน และ query ส่วนใหญ่ระบุช่วงเวลา ส่วน documentation ของ PostgreSQL ให้ rule of thumb ว่า partitioning จะคุ้มเมื่อ table นั้นจะใหญ่กว่า memory ของ server ถ้าไม่ได้แบ่ง
- **load และ archive ตามช่วงเวลา:** load ข้อมูลหนึ่งเดือนลง table ของมันเอง เช็กให้เรียบร้อย แล้วค่อย attach ส่วนเดือนที่จะ archive ก็ detach ออกมา
- **report ที่อ่านข้อมูลก้อนใหญ่ของช่วงเวลาหนึ่ง:** report รายเดือนอ่านแค่ partition เดียว ส่วน lookup ที่แคบและ selective ใช้ index จะดีกว่า: [B-tree](../b-tree-index/) บน `happened_at` อ่าน 170 page สำหรับหนึ่งสัปดาห์ เทียบกับ 1,052 page ของสอง partition และ BRIN ก็เหมาะกับ table ที่เรียงตามเวลา ([index types](../index-types/))
- **ไม่ใช่เพื่อกระจาย load ไปหลายเครื่อง** ทุก partition อยู่ใน database เดียวกันบน server เดียวกัน และใช้ CPU, memory, disk และ WAL ร่วมกัน การกระจาย row ไปหลาย server คือ [sharding](../sharding/) ที่ทำใน application หรือด้วย extension อย่าง Citus และ partition หนึ่งตัวยังเป็น foreign table บน server อื่นผ่าน `postgres_fdw` ได้ด้วย แบบนี้ก็เป็นหนึ่งใน building block ของการทำ sharding
- **ไม่ใช่ตอนที่ query ส่วนใหญ่ filter ด้วยอย่างอื่น** ทุก query ที่ไม่ระบุ key ต้องค้นทุก partition และถ้าแต่ละวันมี row ออกไปแค่ไม่กี่พันตัว การ `DELETE` เป็น batch กับ autovacuum ที่ปรับมาดี ๆ อาจง่ายกว่าการดูแล partition ส่วน batch แค่กระจาย WAL และ lock ออกไป ไม่ได้ลดมันลง

ให้เลือกความกว้างของ partition จากวิธีที่ข้อมูลออกไปและวิธีที่มันถูก query ตัวเลขข้างล่างมาจากข้อมูลของ Acme โดยจับเวลาด้วย query เดียวกันที่ไม่มี partition key อยู่ในนั้น และทุก layout มี primary key กับ index บน `order_id` (median ของการรันเจ็ดรอบ):

| Layout | Partition | row ต่อ partition | เวลา plan |
|---|---|---|---|
| table เดียว | 1 | 1,500,000 | 0.02 ms |
| รายเดือน หลัง retention | 15 | ราว 70,000 | 0.10 ms |
| รายวัน สิบสองเดือน | 368 | ราว 2,300 | 4.0 ms และ 23 ms ในการรันครั้งแรกของ session ใหม่ |

documentation เตือนไว้ทั้งสองทาง partition น้อยเกินไปทำให้ index ใหญ่และ locality ของข้อมูลแย่ ส่วนถ้ามากเกินไปก็ทำให้การ plan ช้าลงและใช้ memory มากขึ้น เพราะทุก session ต้อง load metadata ของทุก partition ที่มันแตะ hierarchy ที่มีได้ถึงไม่กี่พัน partition ยังรับมือได้ค่อนข้างดี ถ้า query ทั่วไป prune จนเหลือแค่ไม่กี่ตัว ส่วน query ของ table รายวันยังถือ lock 1,107 ตัวไว้จนกว่าจะจบ: สามตัวต่อ parent และต่อทุก partition คือบน table กับ index สองตัวของมัน

## ได้อะไร เสียอะไร

- **retention และการเปลี่ยนข้อมูลก้อนใหญ่ถูกลง** การ drop หนึ่งเดือนคือการลบไฟล์แทนการลบ row: ที่นี่ใช้ 38 ms และ WAL 159 kB สำหรับสิบเดือน เทียบกับ `DELETE` ที่ต้องมี WAL record หนึ่งตัวต่อทุก row และต้อง VACUUM
- **key ต้องมี partition key อยู่ด้วย** ทุก unique constraint ต้องรวม `happened_at` ไว้ ทำให้ประกาศ `id` อย่างเดียวว่า unique ไม่ได้ และ column หรือชุด column อื่นที่ไม่มีมันก็ประกาศไม่ได้เหมือนกัน
- **query ที่ไม่มี key ต้องจ่ายให้ทุก partition** `WHERE order_id = 250000` รัน index scan 13 ครั้งกับ scan partition ว่างอีก 2 ครั้ง อ่าน 28 page เทียบกับ 5 page เมื่อใช้ index เดียวกันบน table เดียว และเวลา plan ก็โตตามจำนวน partition ที่เหลือหลัง prune
- **งาน operate เยอะขึ้น** partition ต้องมีอยู่ก่อนที่ row ของมันจะมาถึง, parent ต้องรัน `ANALYZE` เอง, `CREATE TABLE … PARTITION OF`, `DROP TABLE` ของ partition และ `DETACH` แบบธรรมดาล้วนเอา ACCESS EXCLUSIVE บน parent และ foreign key ก็เพิ่ม lock บน table ที่ถูกอ้างถึงตอนที่ partition ถูกสร้าง, attach, detach หรือถูก drop หลัง detach
- **partition จำนวนมากกิน memory และ lock:** lock 1,107 ตัวสำหรับ query เดียวบน daily partition 368 ตัวกับ index ของพวกมัน และ metadata ที่ทุก session ที่แตะพวกมัน cache ไว้
- **การ migrate ต้องลงแรง** การก็อป row 1,500,000 ตัวเข้า partitioned table ที่นี่ใช้เวลา 8.3 s และเขียน WAL 298 MB และ table ที่ busy ก็หยุดรับการเขียนระหว่างนั้นไม่ได้

## ข้อควรรู้ตอนลงมือทำ

**migrate table ที่มีอยู่แล้ว** มีสองทาง

- *ก็อป:* rename table เก่า สร้าง partitioned table ใหม่ ก็อปข้อมูลแล้วสลับ แบบใน *ลองรันดู* ส่วนบนระบบที่ live อยู่ การเขียนที่เข้ามาระหว่างก็อปต้องถูกหยุดไว้ หรือถูกเก็บไว้ด้วย trigger หรือ [change data capture](../change-data-capture/) แล้ว replay ก่อนสลับ ส่วน `partition_data_proc()` ของ pg_partman ย้าย row จาก source table เข้า partitioned table ทีละ batch และ commit หลังแต่ละ batch
- *attach:* เก็บ table เก่าไว้แล้ว attach มันทั้งก้อนเป็น partition สำหรับข้อมูลในอดีต `FOR VALUES FROM (MINVALUE) TO ('2026-10-01')` แล้วให้เดือนใหม่ ๆ มี partition ของตัวเอง ให้เพิ่ม `CHECK` constraint ที่ตรงกับขอบก่อน ไม่งั้น ATTACH จะ scan ทั้ง table เพื่อ validate ระหว่างที่ถือ ACCESS EXCLUSIVE บนมันไว้ และให้ build index ที่ parent คาดหวังไว้ก่อน (เช่น unique index บน `(id, happened_at)`) ไม่งั้น ATTACH จะ build ให้เอง ส่วน partition ก้อนใหญ่นี้จะถูก drop ทีเดียวเมื่อข้อมูลทั้งหมดในนั้นเลยช่วง retention ไปแล้ว

**MySQL 8.4** รองรับ partitioning แบบ `RANGE`, `LIST`, `HASH` และ `KEY`, variant แบบ `RANGE COLUMNS` และ `LIST COLUMNS` และ subpartitioning ใน storage engine InnoDB และ NDB เท่านั้น กฎเรื่อง unique key ของมันเหมือนกัน: ทุก unique key รวมถึง primary key ต้องใช้ทุก column ของ partitioning expression แต่ต่างจาก PostgreSQL ตรงที่ InnoDB table ที่แบ่ง partition มี foreign key ไม่ได้เลย ไม่ว่าทิศทางไหน ตัว table หนึ่งตัวมี partition ได้ถึง 8,192 ตัว รวม subpartition แล้ว ส่วน retention ใช้ `ALTER TABLE … DROP PARTITION` ที่ลบ partition พร้อม row ของมัน และ `ALTER TABLE … EXCHANGE PARTITION … WITH TABLE` สลับ partition กับ table ธรรมดาเพื่อ archive ตัว pruning ใช้ได้กับ partitioning column โดยตรง และผ่าน `TO_DAYS()`, `TO_SECONDS()`, `YEAR()` และ `UNIX_TIMESTAMP()`

**SQL Server** แยกกฎออกจาก storage: partition function กำหนดค่าขอบ และ partition scheme map partition ไปที่ filegroup มันรองรับได้ถึง 15,000 partition ส่วนข้อมูลเก่าออกไปด้วยการ switch partition ออกไปเป็น archive table หรือด้วย `TRUNCATE TABLE … WITH (PARTITIONS (…))`

**Amazon RDS และ Aurora PostgreSQL** รองรับ pg_partman ทั้งคู่ และมี documentation เรื่องการรัน maintenance ของมันด้วย pg_cron

**Amazon DynamoDB และ Cassandra** ใช้คำนี้กับอีกเรื่องหนึ่ง partition key ของพวกมันเป็นตัวตัดสินว่า partition ไหน และก็คือ node ไหน ที่เก็บ item หนึ่งตัว แบบนี้ใกล้กับ sharding มากกว่า ([Amazon DynamoDB](../amazon-dynamodb/), [Cassandra](../cassandra/)) การหมดอายุตามเวลาใช้ time to live แทนการ drop partition: DynamoDB ลบ item ที่หมดอายุภายในไม่กี่วันหลังเวลาหมดอายุโดยไม่กิน write throughput และ TimeWindowCompactionStrategy ของ Cassandra จัดกลุ่ม SSTable ตาม time window เพื่อให้ drop SSTable ทั้งก้อนได้เมื่อข้อมูลทั้งหมดในนั้นหมดอายุแล้ว

**lakehouse table** ใน [medallion architecture](../medallion-architecture/) ใช้ไอเดียเดียวกันกับไฟล์: table ที่แบ่ง partition ตามวันที่จะเก็บไฟล์ของแต่ละวันแยกกัน ทำให้ query engine ข้ามได้ทั้งวัน และวันเก่า ๆ ก็ถูกลบออกทั้งวัน
