## ปัญหา

report กลางคืนของ Acme Shop รวมยอดธุรกิจของวัน: `SELECT status, count(*), sum(total_thb) FROM orders GROUP BY status` แล้วก็ query อื่นอีกหลายตัวแยกตามประเทศ ตาม product และตามวัน รวมแล้วหลายนาที ตัวเลขของมันต้องตรงกันเอง มันเลยต้องให้ `orders` ทั้ง table อยู่นิ่ง ๆ ระหว่างที่มันอ่าน แต่ร้านไม่ได้หยุดตอนกลางคืน ทีม support cancel order, payment ผ่าน, courier ส่งของ และทุกเรื่องพวกนี้ก็คือ `UPDATE` บน table เดียวกัน

ถ้าแต่ละ row มีอยู่แค่ชุดเดียว วิธีเดียวที่จะให้มันนิ่งก็คือ lock มันไว้ ตัว reader ถือ shared lock บนสิ่งที่มันอ่านไว้จนกว่าจะ commit ส่วน writer ต้องใช้ exclusive lock ที่ชนกับ shared lock พวกนั้น ขั้นแรกของ diagram รันการออกแบบแบบนี้บน PostgreSQL 18.6 โดยให้ report ขอ lock เอง (`LOCK TABLE orders IN SHARE MODE`) แล้วก็เจ็บทั้งสองทาง:

- **writer block report** writer ตัวหนึ่งเพิ่งเปลี่ยน order 497001 จาก `paid` เป็น `shipped` และยังไม่ commit ตัวคำขอ lock ของ report เลยต้องรอมัน 1.5 s (`pg_blocking_pids()` บอกชื่อ writer ตัวนั้น และ wait event คือ `Lock: relation`)
- **report block writer** พอ report ถือ lock ไว้แล้ว การ cancel order 495179 ของ support ก็ต้องรอ แล้วพอครบ 5 s ตัว `lock_timeout` ก็ตัดจบด้วย `ERROR: 55P03: canceling statement due to lock timeout` ถ้าไม่มี timeout มันจะรอจนกว่า report จะ commit ในอีกหลายนาทีต่อมา และทุกการเปลี่ยนแปลงอื่นบน `orders` ก็ต่อคิวอยู่ข้างหลังมัน

นี่ไม่ใช่แค่ลูกเล่นของ PostgreSQL ตัว InnoDB ทำงานแบบนี้ที่ `SERIALIZABLE`: ถ้าปิด autocommit มันจะเปลี่ยน `SELECT` ธรรมดาทุกตัวเป็น `SELECT ... FOR SHARE` ตัว report เดียวกันบน MySQL 8.4 ถือ shared record lock ไว้ 502,025 ตัว และการ cancel เดียวกันก็ fail หลังครบ `innodb_lock_wait_timeout` (ตั้งไว้ 5 s สำหรับการรันนี้ ส่วนค่า default คือ 50) ด้วย `ERROR 1205 (HY000): Lock wait timeout exceeded`

## ทำงานยังไง

Multiversion concurrency control เก็บ row ไว้หลาย version แทนที่จะมีแค่ตัวเดียว writer เพิ่ม version ใหม่และทิ้ง version เก่าไว้ที่เดิม แล้ว reader แต่ละตัวก็เลือก version ที่เป็นปัจจุบันตอนที่ snapshot ของมันถูกถ่ายไว้ ตัว reader ไม่ถือ row lock เลย ทำให้อย่างที่คู่มือ PostgreSQL บอกไว้ การอ่านไม่เคย block การเขียน และการเขียนไม่เคย block การอ่าน ส่วนที่เหลือของหน้านี้จะแสดงว่า PostgreSQL เก็บ version ไว้ยังไง และกำจัดมันทิ้งยังไง ส่วนหน้า [isolation levels](../isolation-levels/) จะพูดถึงว่า snapshot ทำให้ transaction เห็นอะไรได้บ้าง

### row version บน heap page

table ของ PostgreSQL หรือ *heap* ของมัน คือไฟล์ที่ประกอบด้วย page ขนาด 8 kB แต่ละ page เริ่มด้วย header เล็ก ๆ และ array ของ line pointer ตัวละ 4 bytes ที่โตไปข้างหน้า ส่วน row version ที่เรียกว่า *tuple* จะเติม page จากท้ายย้อนกลับมา และที่ว่างก็อยู่ตรงกลาง ที่อยู่ของ row หรือ `ctid` ของมัน คือเลข page กับเลข line pointer: `(2392,2)` คือ line pointer 2 บน page 2392 และนั่นคือที่ที่ order 495179 อยู่ในสำเนาใหม่ของข้อมูลตัวอย่าง

header ของทุก tuple มีสาม field ที่ทำให้ MVCC ทำงานได้:

| Field | เก็บอะไร | order 495179 ก่อน cancel |
|---|---|---|
| `t_xmin` | ID ของ transaction ที่สร้าง version นี้ | 775 (frozen ดูข้างล่าง) |
| `t_xmax` | ID ของ transaction ที่ลบหรือแทนที่มัน ถ้าไม่มีก็เป็น 0 | 0 |
| `t_ctid` | ที่อยู่ของ version นี้ หรือของ version ที่ใหม่กว่า | `(2392,2)` |

`UPDATE` ไม่เคยเปลี่ยน row ในที่เดิม ในการรันนี้ transaction 165806 cancel order 495179:

1. มันเขียน tuple ใหม่ที่มี `xmin` 165806 และ `status = 'cancelled'` ตัว page 2392 มีที่ว่างเหลือแค่ 48 bytes ทำให้ version ใหม่ไปอยู่ที่ page 5057 (page สุดท้ายของ table) เป็น line pointer 91 และที่ว่างของ page นั้นลดจาก 760 เหลือ 676 bytes
2. มันประทับ `xmax` 165806 ลงบน tuple เก่าที่ `(2392,2)` แล้วชี้ `t_ctid` ของมันไปที่ `(5057,91)`
3. เพราะ row ย้ายไปอีก page ตัว `orders_pkey` เลยได้ entry ที่สองของ key 495179 ที่ชี้ไปที่ `(5057,91)` อยู่ข้าง ๆ entry เก่าบน leaf page 1359 ของ [B-tree](../b-tree-index/) แล้ว `pg_stat_user_tables` ก็นับ update นี้ไว้ใน `n_tup_newpage_upd`

`UPDATE` ใช้เวลา 5 ms และไม่ต้องรออะไรเลย ตัว `pageinspect` แสดงทั้งสอง version: `heap_page_items(get_raw_page('orders', 2392))` แสดง line pointer 2 ที่มี `t_xmax` 165806 และ `t_ctid` `(5057,91)` ส่วน page 5057 แสดง line pointer 91 ที่มี `t_xmin` 165806 ส่วน `DELETE` แค่ตั้ง `xmax` และ `INSERT` เขียน tuple ที่มี `xmax` เป็น 0

### snapshot ตัดสินว่า statement จะเห็น version ไหน

snapshot ประกอบด้วยสามอย่าง: transaction ที่เก่าที่สุดที่ยังรันอยู่ (`xmin`), ค่าที่มากกว่า transaction ID สูงสุดที่จบไปแล้วหนึ่ง (`xmax`) และ list ของ transaction ที่กำลังรันอยู่ ตัว `pg_current_snapshot()` พิมพ์มันออกมาเป็น `xmin:xmax:list` ส่วน snapshot ของ report คือ `165806:165806:`: ทุก transaction ที่ต่ำกว่า 165806 จบไปแล้ว และไม่มีตัวไหนรันอยู่

version หนึ่งจะมองเห็นได้สำหรับ snapshot หนึ่ง เมื่อ transaction ใน `xmin` ของมัน commit ไปแล้วก่อนที่ snapshot จะถูกถ่าย และ transaction ใน `xmax` ของมัน ถ้ามี ยังไม่ได้ commit ในตอนนั้น ตัว PostgreSQL ดูว่า transaction commit แล้วหรือยังจาก commit log (`pg_xact`) แล้ว cache คำตอบไว้ใน hint bit บน tuple สำหรับ report:

- version เก่า: `xmin` 775 commit ไปนานแล้วและถูก freeze แล้ว ส่วน `xmax` 165806 ไม่ได้ต่ำกว่า `xmax` ของ snapshot ทำให้ report มองไม่เห็นการ cancel นี้ ตัว report ยังเห็น `delivered` อยู่ ทั้งตอนที่ transaction ของ writer ยังเปิดอยู่ (การอ่านครั้งนั้นใช้ 1.3 ms) และอีกครั้งหลัง writer commit แล้ว
- version ใหม่: `xmin` 165806 ใหม่เกินไป report เลยมองไม่เห็นมัน

statement ถัดไปของ writer ได้ snapshot `165807:165807:` สำหรับมัน 165806 commit แล้ว: version เก่าถูกลบ ส่วน version ใหม่มองเห็นได้ และมันอ่านได้ `cancelled` ส่วนทุก scan ก็ใช้การทดสอบนี้กับทุก version ที่มันไปเจอ ทำให้ `GROUP BY` ตัวที่สองของ report ที่รันหลังจากนั้นสามสิบวินาที ยังนับ order ที่ delivered ได้ 487,245 ตัว

snapshot จะถูกถ่ายตอนไหนขึ้นกับ isolation level: `READ COMMITTED` ที่เป็นค่า default ถ่ายใหม่ทุก statement ส่วน `REPEATABLE READ` และ `SERIALIZABLE` ถ่ายครั้งเดียวตอน statement แรกของ transaction แล้วใช้ตัวนั้นตลอด ส่วน writer สองตัวที่เขียน row เดียวกันก็ยังต้องรอกัน: `UPDATE` ตัวที่สองจะเจอ `xmax` ที่ยังมีผลของ transaction ที่ยังรันอยู่ แล้วก็รอให้มันจบ เรื่องนี้อยู่ในหน้า [locks and deadlocks](../locks-and-deadlocks/)

### version ที่ตายแล้ว กับ VACUUM

version เก่าของ 495179 จะตายเมื่อไม่มี snapshot ไหนมองเห็นมันได้อีกแล้ว PostgreSQL หาจุดนั้นด้วย *xmin horizon*: คือ `xmin` หรือ transaction ID ที่เก่าที่สุดที่ session ไหนก็ตามของ database ยังถืออยู่ (standby ที่เปิด `hot_standby_feedback` ก็นับด้วย ผ่าน physical replication slot ของมัน แม้ตอนที่มันหลุด connection อยู่) version ที่ถูกลบโดย transaction ที่เก่ากว่า horizon ลบทิ้งได้ ส่วนอะไรที่ใหม่กว่านั้นต้องเก็บไว้ เพราะอาจมี snapshot ไหนยังต้องใช้มันอยู่

report ถือ horizon ไว้ ระหว่างที่ status เปลี่ยน 3,000 ครั้งของคืนนั้นรันไป ครั้งละหนึ่ง transaction ต่อ order ตัว `n_dead_tup` ก็ขึ้นจาก 1 เป็น 3,001 และ `pg_stat_activity` แสดงว่า report อยู่ในสถานะ idle in transaction ด้วย `backend_xmin` 165806 ที่เก่าไป 3,001 transaction ID หลังผ่านไป 29 วินาที แล้ว `VACUUM (VERBOSE) orders` ก็ไม่ได้ลบอะไรเลย:

```text
tuples: 0 removed, 503011 remain, 3001 are dead but not yet removable
removable cutoff: 165806, which was 3001 XIDs old when operation ended
visibility map: 0 pages set all-visible, 0 pages set all-frozen (0 were all-visible)
```

หลัง report commit คำสั่งเดียวกันก็ลบทั้งหมดใน 33 ms:

```text
finished vacuuming "mvcc.public.orders": index scans: 1
tuples: 3001 removed, 499413 remain, 0 are dead but not yet removable
visibility map: 2140 pages set all-visible, 2006 pages set all-frozen (0 were all-visible)
index scan needed: 2045 pages from table (40.20% of total) had 2897 dead item identifiers removed
```

`pg_stat_progress_vacuum` ที่ sample ไว้ระหว่างการรันนั้นแสดง phase ต่าง ๆ: *scanning heap* ไล่ไป 5,087 page เพื่อ prune dead tuple และเก็บที่อยู่ของมันไว้, *vacuuming indexes* ที่ลบ index entry 2,897 ตัวที่ชี้ไปที่ tuple พวกนั้น รวมถึง `495179 → (2392,2)`, *vacuuming heap* ที่ mark line pointer ของมันเป็น unused และ *cleaning up indexes* ผลคือตอนนี้ line pointer 2 บน page 2392 เป็น unused แล้ว และ page ก็ถูกบีบให้แน่น ทำให้มีที่ว่าง 128 bytes แทนที่จะเป็น 48 ส่วน `VACUUM` เก็บที่ว่างนั้นไว้ให้ row ในอนาคตใน free space map โดยไม่ได้ทำให้ไฟล์เล็กลง ยกเว้น page ว่างที่อยู่ท้ายสุดของไฟล์

**Autovacuum** ทำเรื่องนี้ให้เอง ตัว launcher ของมันเช็กทุก `autovacuum_naptime` (1 นาที) แล้ว vacuum table เมื่อ dead tuple ของมันเกิน `autovacuum_vacuum_threshold` + `autovacuum_vacuum_scale_factor` × จำนวน row ค่า default คือ 50 + 20 %: สำหรับ `orders` คือ dead row 100,050 ตัว ทำให้ 3,001 ตัวของคืนนี้ไม่พอให้มันเริ่ม ตัว PostgreSQL 18 ตั้งเพดานของตัวเลขนี้ด้วย `autovacuum_vacuum_max_threshold` (100 ล้านโดย default) ที่มีผลกับ table ที่มี row เป็นพันล้าน ส่วน insert ก็ทำให้เกิด vacuum ได้ด้วย เพื่อให้ table ที่มีแต่ append ได้ตั้ง visibility map และ freeze row ของมัน

### visibility map

แต่ละ table มี visibility map ที่มีสอง bit ต่อ heap page: *all-visible* คือทุก tuple บน page มองเห็นได้สำหรับทุก transaction และ *all-frozen* คือทุก tuple ถูก freeze แล้ว `VACUUM` เป็นตัวตั้ง bit ส่วนการเปลี่ยนแปลงใด ๆ บน page จะล้างมัน และทั้ง `VACUUM` และ [index-only scan](../covering-index/) ก็ข้าม page ที่ตั้ง bit ไว้แล้ว ตอนที่ report ยังเปิดอยู่ `VACUUM` ครั้งแรกตั้ง bit ไม่ได้เลยสักตัว ส่วนหลัง report commit มี 2,140 page ที่กลายเป็น all-visible

### HOT update กับ fillfactor

update ที่ไม่ได้เปลี่ยน column ที่มี index และใส่ลง page เดียวกับ version เก่าได้ คือ update แบบ *heap-only tuple* (HOT) ตัว index ยังชี้ไปที่ line pointer เดิม ส่วน `t_ctid` ของ tuple เก่าพาไปหาตัวใหม่ และไม่ต้องเขียน index entry เลย หลังจากนั้น query หรือ update ไหนก็ตามที่แวะมาที่ page นี้ก็ prune chain ได้: line pointer ตัวแรกกลายเป็น redirect ไปหา version ที่เก่าที่สุดที่อาจยังมีคนต้องใช้ และ version ที่ไม่มีใครต้องใช้แล้วก็ถูกลบทิ้งโดยไม่ต้องรอ `VACUUM`

`status` ไม่มี index ทำให้ update ทั้งหมดของคืนนี้ควรจะเป็น HOT ได้ แต่ข้อมูลตัวอย่างถูกบีบด้วย `VACUUM FULL` ที่ทำให้ทุก page เต็ม ผลการวัดข้างล่าง แต่ละแถวมาจากสำเนาใหม่ที่รัน update 3,001 ครั้งชุดเดียวกัน:

| Setup | HOT update | ย้ายไป page ใหม่ | Heap page หลังรัน | page ของ `orders_pkey` |
|---|---:|---:|---:|---:|
| page เต็ม, report เปิดอยู่ | 104 | 2,897 | 5,087 (+29) | 1,382 (+8) |
| page เต็ม, ไม่มี report เปิดอยู่ | 928 | 2,073 | 5,079 (+21) | 1,382 (+8) |
| `fillfactor = 90`, report เปิดอยู่ | 3,001 | 0 | 5,624 (+0) | 1,374 (+0) |

สองแถวแรกแสดงต้นทุนอย่างที่สองของ report ที่รันนาน: การ prune ใช้ horizon เดียวกับ `VACUUM` ทำให้ตอน report เปิดอยู่ version ที่ตายแล้วยังค้างอยู่บน page ของมัน และ update ที่ตามมาทีหลังก็ไม่เจอที่ว่างบน page นั้น ถ้าใช้ `ALTER TABLE orders SET (fillfactor = 90)` แล้ว rewrite table ใหม่ ก็จะทำให้ทุก page เว้นที่ว่างไว้ 10 % ให้ update โดยแลกกับจำนวน page ที่มากขึ้น 11 % ผลคือทุก update เป็น HOT, table ไม่โตขึ้น และ `VACUUM` ครั้งสุดท้ายรายงาน *index scan not needed* ตัว `EXPLAIN (ANALYZE, WAL)` นับได้ 3 record ใน [write-ahead log](../write-ahead-log/) สำหรับ update ของ 495179 ที่ย้ายไป page 5057 และ 1 record ขนาด 85 bytes สำหรับ update เดียวกันบนสำเนาที่ `fillfactor = 90` ที่มันเป็น HOT

### การ freeze กับ transaction ID wraparound

transaction ID มีขนาด 32 bit และ PostgreSQL เทียบมันกันบนวงกลม: สำหรับทุก ID จะมีราวสองพันล้านตัวที่เก่ากว่าและสองพันล้านตัวที่ใหม่กว่า row ที่ `xmin` ตามหลังเกินสองพันล้าน จะดูเหมือนมาจากอนาคตขึ้นมาทันที แล้วก็หายไป เพื่อกันเรื่องนี้ `VACUUM` จะ *freeze* tuple เก่า: มันตั้ง flag ที่แปลว่า "ทุกคนมองเห็นได้" และตั้งแต่ PostgreSQL 9.4 มันก็เก็บ `xmin` ตัวเดิมไว้ให้ใช้สืบย้อนดู นี่คือเหตุผลที่ order 495179 แสดง `xmin` 775 ที่ mark ว่า frozen: ข้อมูลตัวอย่างถูก rewrite ด้วย `VACUUM FULL` และการ rewrite จะ freeze เสมอ

การ freeze รันเป็นส่วนหนึ่งของ vacuum ปกติ โดยมี setting ไม่กี่ตัวที่จำกัดว่ามันจะตามหลังได้แค่ไหน (ค่า default ใน PostgreSQL 18):

- `vacuum_freeze_min_age` (50 ล้าน): transaction ID ต้องเก่าแค่ไหน `VACUUM` ถึงจะ freeze มัน
- `autovacuum_freeze_max_age` (200 ล้าน): table ที่ `relfrozenxid` เก่ากว่านี้จะโดน anti-wraparound autovacuum แม้จะปิด autovacuum ไว้ก็ตาม
- `vacuum_failsafe_age` (1.6 พันล้าน): `VACUUM` จะเลิกใช้ cost-based delay และข้ามการ vacuum index เพื่อให้ freeze เสร็จเร็วขึ้น
- เมื่อเหลืออีกสี่สิบล้าน transaction ก่อนถึงจุด wraparound ตัว server จะเริ่มเตือน และเมื่อเหลือน้อยกว่าสามล้าน มันจะไม่ยอมแจก transaction ID ใหม่ จนกว่า `VACUUM` จะขยับตัวที่เก่าที่สุดไปข้างหน้า

PostgreSQL 18 ยังให้ vacuum ปกติ freeze page ที่ all-visible บางส่วนล่วงหน้าได้ด้วย (`vacuum_max_eager_freeze_failure_rate`) เพื่อให้ aggressive vacuum ครั้งถัดไปมีงานน้อยลง

## ลองรันดู

ข้อมูลตัวอย่างมาจาก [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop) ที่เป็น script สร้าง template database `acme` บน PostgreSQL 18 ในเวลาราวหนึ่งนาที

script นี้เล่นทั้งสอง session จาก `psql` ตัวเดียว: report คือตัว session เอง ส่วน writer คือ connection ที่สองที่เปิดด้วย `dblink` ที่มากับ PostgreSQL อยู่แล้ว ส่วน transaction ID ของคุณจะไม่ตรงกับใน comment

```sql
-- psql postgresql://postgres:acme@localhost:55432/postgres \
--      -c "CREATE DATABASE mvcc_try TEMPLATE acme STRATEGY FILE_COPY"
-- psql postgresql://postgres:acme@localhost:55432/mvcc_try -f mvcc.sql
CREATE EXTENSION IF NOT EXISTS pageinspect;
CREATE EXTENSION IF NOT EXISTS dblink;   -- a second session, for the writer
\set other 'dbname=' :DBNAME
VACUUM (ANALYZE) orders;

BEGIN ISOLATION LEVEL REPEATABLE READ;   -- the nightly report
SELECT count(*) FROM orders WHERE status = 'delivered';
-- 487245                                   the report's snapshot is taken here

-- the writer cancels order 495179 in its own session, and commits
SELECT dblink_exec(:'other', $$UPDATE orders SET status = 'cancelled' WHERE id = 495179$$);
-- UPDATE 1                                 no waiting

SELECT xmin, xmax, ctid, status FROM orders WHERE id = 495179;
-- 775 | 357523 | (2392,2) | delivered       the report still reads the old version
SELECT * FROM dblink(:'other', $$SELECT xmin, xmax, ctid, status FROM orders WHERE id = 495179$$)
  AS t(xmin xid, xmax xid, ctid tid, status text);
-- 357523 | 0 | (5057,91) | cancelled       a new snapshot reads the new one
SELECT lp, t_xmin, t_xmax, t_ctid FROM heap_page_items(get_raw_page('orders', 2392)) WHERE lp = 2;
-- 2 | 775 | 357523 | (5057,91)             the old version points to the new one

-- VACUUM from another session while the report is still open
SELECT dblink_exec(:'other', 'VACUUM orders');
SELECT * FROM dblink(:'other', $$SELECT n_dead_tup FROM pg_stat_user_tables WHERE relname = 'orders'$$)
  AS t(n_dead_tup bigint);
-- 1                                         the dead version had to stay
COMMIT;

VACUUM (VERBOSE) orders;
-- tuples: 1 removed, 500000 remain, 0 are dead but not yet removable
SELECT n_tup_upd, n_tup_hot_upd, n_dead_tup FROM pg_stat_user_tables WHERE relname = 'orders';
-- 1 | 0 | 0                                 page 2392 was full: not a HOT update

-- HOT: leave 10% of every page free, then change a column that no index covers
ALTER TABLE orders SET (fillfactor = 90);
VACUUM FULL orders;
SELECT pg_relation_size('orders') / 8192 AS pages;
-- 5624                                      5,058 before
SELECT ctid, status FROM orders WHERE id = 497001;
-- (3657,1) | paid
UPDATE orders SET status = 'shipped' WHERE id = 497001;
SELECT ctid, status FROM orders WHERE id = 497001;
-- (3657,90) | shipped                       same page: a HOT update
SELECT pg_stat_force_next_flush();
SELECT n_tup_upd, n_tup_hot_upd FROM pg_stat_user_tables WHERE relname = 'orders';
-- 2 | 1
```

ถ้าอยากเห็นขั้นที่ 1 แบบที่ใช้ lock ให้รัน `BEGIN; LOCK TABLE orders IN SHARE MODE;` ใน `psql` ตัวหนึ่ง และรัน `SET lock_timeout = '5s'; UPDATE orders SET status = 'cancelled' WHERE id = 495179;` ในอีกตัว

## ใช้ตอนไหนดี

MVCC ไม่ใช่สิ่งที่ต้องเปิดใช้เอง: PostgreSQL, InnoDB และ Oracle เก็บ row version ไว้เสมอ ส่วน SQL Server ก็เก็บเมื่อเปิด row versioning แล้ว สิ่งที่คุณเลือกได้คือจะทำงานกับมันยังไง

- **การอ่านยาว ๆ ข้าง ๆ การเขียนสั้น ๆ** report, export และ backup ได้ภาพที่ consistent โดยไม่ต้องหยุดร้าน ให้รันตัวที่ยาวที่ `REPEATABLE READ` เพื่อให้ทุก query ของมันใช้ snapshot เดียวกัน และทำให้มันสั้นที่สุดเท่าที่งานจะยอม การย้ายมันไปที่ [read replica](../read-replicas/) ช่วยเอาโหลดออกจาก primary แต่บน standby ของ PostgreSQL ปัญหาเดียวกันก็กลับมาอีกรูปแบบหนึ่ง: การ replay จะ cancel query ที่ต้องใช้ row ที่ `VACUUM` ลบไปแล้ว (หลัง `max_standby_streaming_delay`) ยกเว้นจะเปิด `hot_standby_feedback` ไว้ ที่จะทำให้ standby ไปรั้ง `VACUUM` บน primary แทน
- **transaction สั้น ๆ ในที่อื่นทั้งหมด** commit ทันทีที่งานเสร็จ และอย่าเปิด transaction ค้างไว้ข้ามช่วงที่ user กำลังคิด, การเรียก HTTP ไปหา payment provider หรือช่วงที่ batch job หลับอยู่ สำหรับการแก้ที่ข้ามหลาย interaction ของ user ให้เช็ก version column ตอน save แทน ([optimistic concurrency](../optimistic-concurrency/))
- **table ที่ถูก update ในที่เดิมทั้งวัน** อย่าง order ที่เปลี่ยน status ไปเรื่อย ๆ, ระดับ stock และ session: เว้นที่ไว้ให้ HOT update ด้วย `fillfactor` ที่ต่ำลง อย่าทำ index ให้ column ที่เปลี่ยนบ่อยถ้า query ไม่ได้ต้องใช้ และตั้ง autovacuum ให้ table นั้นแยกต่างหาก
- **เมื่อ version อย่างเดียวไม่พอ** snapshot ทำให้การอ่าน consistent แต่ writer สองตัวที่เขียน row เดียวกันก็ยังต่อคิวกันที่ row lock ([locks and deadlocks](../locks-and-deadlocks/)) และมีแค่ `SERIALIZABLE` ที่จับ anomaly อย่าง write skew ได้ ([isolation levels](../isolation-levels/)) โดยแลกกับการ retry

## ได้อะไร เสียอะไร

- **ได้: ไม่มีใครต้องรอเพื่ออ่าน** report, การ cancel และ update 3,000 ครั้งของคืนนั้นรันไปพร้อม ๆ กันได้ การรอที่เหลืออยู่มีแค่ระหว่าง writer ที่เขียน row เดียวกัน
- **เสียที่จนกว่าจะเก็บกวาด** ทุก update ทิ้ง version ที่ตายแล้วไว้จนกว่า `VACUUM` จะลบมัน และ index ก็เก็บ entry ของมันไว้ด้วย update 3,001 ครั้งของคืนนั้นทำให้ `orders` โตจาก 5,058 เป็น 5,087 page และไฟล์ก็ยังขนาดนั้นต่อไป มีแค่ `VACUUM FULL`, `CLUSTER` หรือเครื่องมือแบบ online อย่าง `pg_repack` ที่คืนที่ได้ และ `VACUUM FULL` ก็ block table ไว้ตลอดที่มัน rewrite
- **write amplification** update ที่ไม่ใช่ HOT จะเขียน tuple ใหม่ทั้งตัว และ entry ใหม่ในทุก index ของ table โดยแต่ละอย่างก็มี WAL ของมัน และ update ส่วนใหญ่ของคืนนี้เป็นแบบนั้น
- **snapshot เก่าตัวเดียวรั้งทั้ง database ไว้ได้** report ที่รันนาน, session ที่ idle อยู่ใน transaction ที่เขียนอะไรไปแล้วหรือถือ snapshot อยู่, prepared transaction ที่ถูกลืม หรือ standby ที่เปิด `hot_standby_feedback` ล้วนตรึง horizon ไว้ และไม่มี table ไหนใน database ที่เก็บกวาดเลยจุดนั้นไปได้ ส่วน logical replication slot รั้งไว้แค่ system catalog กับ WAL ที่มันยังไม่ได้อ่าน
- **การ freeze ไม่ใช่ทางเลือก** แม้แต่ table ที่ไม่เคยเปลี่ยนเลย สุดท้ายก็ต้องถูก `VACUUM` อ่านและ freeze และถ้าการ freeze ตามหลังมากเกินไป server จะหยุดแจก transaction ID จนกว่ามันจะตามทัน
- **งานเบื้องหลัง** autovacuum อ่านและเขียน page ทั้งวัน ตัว cost-based delay ของมัน (`autovacuum_vacuum_cost_delay` ค่า default 2 ms) ทำให้มันเบามือ บางทีก็เบามือเกินไปสำหรับ table ที่งานเยอะ

## ข้อควรรู้ตอนลงมือทำ

**หาว่าอะไรถือ horizon ไว้** และการเก็บกวาดตามหลังอยู่แค่ไหน:

```sql
-- sessions holding old snapshots or transaction IDs
SELECT pid, application_name, state, backend_xid, backend_xmin,
       age(backend_xmin) AS xmin_age, now() - xact_start AS open_for
FROM pg_stat_activity
WHERE backend_xmin IS NOT NULL OR backend_xid IS NOT NULL
ORDER BY greatest(age(backend_xmin), age(backend_xid)) DESC;

-- dead rows, HOT share and the last vacuum, per table
SELECT relname, n_live_tup, n_dead_tup, n_tup_upd, n_tup_hot_upd, n_tup_newpage_upd,
       last_vacuum, last_autovacuum
FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 10;

-- how close each database is to a forced anti-wraparound vacuum
SELECT datname, age(datfrozenxid) FROM pg_database ORDER BY 2 DESC;
```

`n_live_tup` และ `n_dead_tup` เป็นค่าประมาณ: หลัง `VACUUM` ครั้งที่สอง scan ไป 79 % ของ page ตัว `n_live_tup` อ่านได้ 499,413 ทั้งที่ table มี 500,000 row ส่วน `pg_stat_progress_vacuum` แสดง phase และ page ของ vacuum ที่กำลังรัน และ `VACUUM (VERBOSE)` พิมพ์ว่าแต่ละรอบลบอะไรไป และทำไมลบได้ไม่มากกว่านั้น

**ตั้งขีดจำกัดให้ transaction ที่ถูกลืม** `idle_in_transaction_session_timeout` ตัด session ที่ idle อยู่ใน transaction นานเกินขีดจำกัด ค่า default เป็น 0 (ปิด) และเมื่อมันทำงาน client จะเห็น `FATAL: 25P03: terminating connection due to idle-in-transaction timeout` ส่วน PostgreSQL 17 เพิ่ม `transaction_timeout` สำหรับความยาวของทั้ง transaction (`FATAL: 25P04`) ทั้งสองตัวตั้งแยกต่อ role หรือต่อ database ได้ เช่น ตั้งให้แค่ role ที่ทำ report ส่วน transaction แบบ `READ COMMITTED` ที่อ่านอย่างเดียวไม่ถือ snapshot ไว้ระหว่าง statement ทำให้ในการรันนี้ มีแค่ session ที่เขียนอะไรไปแล้ว หรือถือ snapshot ของ `REPEATABLE READ` อยู่ ที่โผล่มาพร้อม `backend_xid` หรือ `backend_xmin`

**ปรับ autovacuum ทีละ table** ด้วย storage parameter แทนที่จะปรับทั้งระบบ: `ALTER TABLE orders SET (autovacuum_vacuum_scale_factor = 0.02)` ทำให้มันเริ่มที่ราว 10,050 dead row แทน 100,050 ส่วน `fillfactor` มีผลแค่กับ page ที่เขียนหลังเปลี่ยนค่า การ rewrite จะทำให้มันมีผลกับทั้ง table

**Amazon RDS และ Aurora PostgreSQL** รัน MVCC และ autovacuum แบบเดียวกัน โดยตั้งค่าผ่าน DB parameter group ตัว RDS for PostgreSQL เพิ่ม *adaptive autovacuum* (`rds.adaptive_autovacuum` เปิดอยู่โดย default) ที่ทำให้ autovacuum ดุขึ้นเมื่อ transaction ID เริ่มเก่า และ AWS ก็ยังแนะนำให้ตั้ง CloudWatch alarm บนอายุของ transaction ID ดู [Amazon RDS & Aurora](../amazon-rds-aurora/) และ [PostgreSQL](../postgresql/)

**MySQL 8.4 (InnoDB) update row ในที่เดิม** ใน clustered index และเก็บค่าเก่าไว้ใน *undo log* ทุก row มี field ที่ซ่อนไว้: `DB_TRX_ID` (6 bytes) คือ transaction ล่าสุดที่เปลี่ยนมัน และ `DB_ROLL_PTR` (7 bytes) คือ pointer ไปหา undo record ที่ใช้สร้าง version ก่อนหน้าขึ้นใหม่ ตัว consistent read จะไล่ตาม chain นั้นไปจนเจอ version ที่ read view ของมันมองเห็นได้ ที่ `REPEATABLE READ` (ค่า default) ตัว read view ถูกสร้างตอนการอ่านครั้งแรกของ transaction หรือสร้างทันทีด้วย `START TRANSACTION WITH CONSISTENT SNAPSHOT` ในการรันเดียวกันบน MySQL 8.4.11 ตัว report ยังอ่านได้ `delivered` ตลอดระหว่างที่ transaction 8626 cancel order นั้น ต้นทุนย้ายจาก table ไปอยู่ที่ undo log: *purge* จะทิ้ง undo ของ update ได้ก็ต่อเมื่อไม่มี read view ไหนต้องใช้มันแล้ว ทำให้ *history list length* ใน `SHOW ENGINE INNODB STATUS` โตขึ้นหนึ่งต่อ update transaction ที่ commit แต่ละตัวระหว่างที่ report เปิดอยู่ จาก 7 เป็น 3,002 และลดลงเหลือ 0 ราว 46 วินาทีหลัง report commit ตัว purge ยังลบ index record ที่ถูก mark ว่าลบแล้วที่ InnoDB ทิ้งไว้ด้วย ส่วน `innodb_purge_threads` มีค่า default เป็น 1 บนเครื่องที่มี logical processor ไม่เกิน 16 ตัว และเป็น 4 ถ้ามากกว่านั้น และ `innodb_max_purge_lag` (0 คือปิด โดย default) ทำให้การเขียนช้าลงได้เมื่อ purge ตามหลัง

**Oracle AI Database 26ai** ก็เขียนค่าเก่าลง undo segment เหมือนกัน แล้วสร้าง version ที่ query ต้องการขึ้นมาใหม่ทีละ block โดยเป็น version ณ ตอนที่ query นั้นเริ่ม มันไม่ได้เก็บ undo ไว้ตลอดไป: undo ที่ commit แล้วและเก่ากว่า undo retention period ถูกเขียนทับได้ และ query ที่ยังต้องใช้มันอยู่จะ fail ด้วย `ORA-01555: snapshot too old` การแลกเปลี่ยนนี้กลับด้านกับของ PostgreSQL: report ยาว ๆ ของ Oracle อาจ fail ส่วนของ PostgreSQL ทำให้ table บวม ส่วน `UNDO_RETENTION` และ `RETENTION GUARANTEE` ใช้ขยับสมดุลนี้

**SQL Server** ให้ row version กับ reader ก็ต่อเมื่อเปิด `READ_COMMITTED_SNAPSHOT` หรือ `ALLOW_SNAPSHOT_ISOLATION` ไว้ (`READ_COMMITTED_SNAPSHOT` เปิดอยู่โดย default บน Azure SQL Database) ถ้าไม่ได้เปิด ตัว `READ COMMITTED` ที่เป็นค่า default ของมันจะอ่านด้วย shared lock สั้น ๆ ทำให้ reader ต้องรอการเปลี่ยนแปลงที่ยังไม่ commit ของ writer ส่วน version พวกนี้เก็บอยู่ใน version store ใน `tempdb` หรือในตัว database เองเมื่อเปิด accelerated database recovery
