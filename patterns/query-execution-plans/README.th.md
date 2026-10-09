## ปัญหา

dashboard ของ Acme Shop รัน report ตัวหนึ่ง: ยอดขายแยกตามประเทศของ customer สำหรับ order ใน 30 วันล่าสุด พอรันบน [PostgreSQL](../postgresql/) 18.6 มันก็ join `orders` (500,000 row) กับ `customers` (100,000 row) แล้ว group order ล่าสุด 23,213 ตัวให้เหลือ 6 row โดยใช้เวลาประมาณ 106 ms พอ query แบบนี้รู้สึกช้า ทีมก็มักจะเดา: ใส่ index ทุก column, ให้ server มี memory มากขึ้น, ย้ายไป instance ที่ใหญ่ขึ้น ทุกการเดามีราคาของมัน (ทุก index เพิ่มงานให้ insert และ update ส่วน memory และ instance ก็ต้องจ่ายเงิน) และไม่มีข้อไหนเลยที่ไปดูว่า database ทำอะไรจริง ๆ

database บอกเราได้เอง `EXPLAIN` พิมพ์ plan ที่ planner เลือกพร้อมค่าประมาณของมันออกมา ส่วน `EXPLAIN (ANALYZE, BUFFERS)` รัน statement จริงด้วย แล้วเพิ่มสิ่งที่เกิดขึ้นจริงในทุกขั้นเข้าไป: row, loop, เวลา และ page ที่แตะ การอ่าน output นี้พาเราจาก "มันช้า" ไปถึง "node นี้ ด้วยเหตุผลนี้"

## ทำงานยังไง

planner แปลง query เป็น tree ของ plan node สำหรับแต่ละ tree ที่เป็นตัวเลือก มันประมาณว่าทุก node จะให้ row ออกมากี่ row โดยใช้ statistics ที่ `ANALYZE` เก็บไว้ของแต่ละ table และ column แล้วตีราคางานด้วย cost constant ไม่กี่ตัว และเก็บ tree ที่ถูกที่สุดไว้ จากนั้น executor ก็ดึง row ขึ้นไปตาม tree: scan อยู่ที่ leaf, join, sort และ aggregate อยู่เหนือขึ้นไป และผลลัพธ์อยู่ที่ root

**กายวิภาคของ node** นี่คือ node หนึ่งตัวจากการรันใน diagram:

```
Index Scan using customers_pkey on customers c  (cost=0.29..8.06 rows=1 width=11) (actual time=0.002..0.002 rows=1.00 loops=23213)
  Index Cond: (id = o.customer_id)
  Index Searches: 23213
  Buffers: shared hit=69639
```

- `cost=0.29..8.06` คือ startup cost ที่ประมาณไว้ (ก่อนได้ row แรก) และ total cost ในหน่วยที่ไม่มีความหมายตายตัว โดยการอ่าน page หนึ่ง page แบบเรียงลำดับมีต้นทุน 1.0 (`seq_page_cost`) ค่า default ตัวอื่น ๆ คือ 4.0 สำหรับการอ่าน page แบบไม่เรียงลำดับ (`random_page_cost`), 0.01 ต่อ row (`cpu_tuple_cost`), 0.005 ต่อ index entry (`cpu_index_tuple_cost`) และ 0.0025 ต่อ operator (`cpu_operator_cost`) ส่วน cost ของ node หนึ่งก็รวม cost ของ node ลูกไว้ด้วย
- `rows=1` และ `width=11` คือจำนวน row ที่ประมาณไว้ต่อการรันหนึ่งครั้ง และความกว้างเฉลี่ยของ row เป็น byte
- `actual time=0.002..0.002` คือเวลาที่วัดได้เป็น millisecond จนถึง row แรกและ row สุดท้าย ส่วน `rows=1.00` คือจำนวน row ที่คืนมา ทั้งสองค่าเป็นค่าเฉลี่ยต่อการรันหนึ่งครั้ง และ `loops=23213` คือจำนวนครั้งที่ node นี้รัน ให้คูณด้วย `loops` เพื่อได้ยอดรวม: ที่นี่คือ 23,213 row และประมาณ 46 ms
- `Buffers: shared hit=69639` นับ page ขนาด 8 kB: `hit` แปลว่าเจอใน shared buffer ส่วน `read` แปลว่าต้องดึงมาจาก operating system หรือ disk ตัว buffer ของ node หนึ่งรวมของ node ลูกไว้ด้วย
- บรรทัดเพิ่มเติมอธิบายงานที่ทำ: `Rows Removed by Filter`, `Sort Method`, `Batches` และ `Memory Usage` ของ hash และ aggregate, `Heap Blocks` ของ bitmap scan ตัว PostgreSQL 18 เพิ่ม `Buffers` ให้อัตโนมัติทุกครั้งที่ใช้ `ANALYZE` พิมพ์ actual rows เป็นทศนิยมสองตำแหน่ง และรายงาน `Index Searches` ของ index scan

**ลำดับการอ่าน** เริ่มที่ node ในสุดแล้วไล่ขึ้นมา ที่แต่ละ node ให้เทียบจำนวน row ที่ประมาณไว้กับจำนวน row จริง (คูณ `loops`): ช่องว่างใหญ่ช่องแรกมักจะอธิบายทุกอย่างที่อยู่เหนือมันได้ เพราะทุกค่าประมาณถูกใช้ตัดสินใจเลือก node ที่อยู่ข้างบน แล้วค่อยตามเวลาและ buffer ไปหา node ที่แพงที่สุด นี่คือการรันที่ statistics เก่าแล้ว อ่านจากล่างขึ้นบน:

| Node | Row ที่ประมาณไว้ | Row จริง × loops | เวลาจริง (ms) | Buffer |
|---|---|---|---|---|
| Seq Scan on orders o | 48 | 23,213 × 1 | 0.010..43.964 | 5,059 |
| Index Scan using customers_pkey | 1 | 1.00 × 23,213 | 0.002 ต่อ loop | 69,639 |
| Nested Loop | 48 | 23,213 × 1 | 0.018..92.780 | 74,698 |
| Sort (ตาม country) | 48 | 23,213 × 1 | 99.374..101.329 | 74,701 |
| GroupAggregate | 6 | 6 × 1 | 99.754..105.598 | 74,701 |
| Sort (ตาม revenue) | 6 | 6 × 1 | 105.619..105.627 | 74,704 |

scan คืน row มามากกว่าที่ประมาณไว้ 484 เท่า สำหรับ 48 row ตัว nested loop เป็น join ที่ถูกที่สุด (cost ที่ประมาณไว้ 11,409 เทียบกับ 14,408 ของ hash join) ทำให้ index scan ด้านในรัน 23,213 ครั้งและใช้ buffer ไป 93% ของทั้งหมด ส่วน nested loop ที่ด้านในรันเป็นพัน ๆ ครั้งก็คือ [N+1 queries](../n-plus-one-queries/) ในแบบของ database เอง: ให้เช็คค่าประมาณของด้าน outer ก่อน

**ค่าประมาณมาจากไหน** `pg_class` เก็บจำนวน row และจำนวน page ของแต่ละ table (`reltuples`, `relpages`) แล้ว planner ก็ปรับสเกลให้เข้ากับขนาดปัจจุบันของ table ส่วน `pg_stats` เก็บสิ่งที่ `ANALYZE` เจอใน sample แบบสุ่มไว้ต่อ column: สัดส่วนของ null, จำนวนค่าที่ไม่ซ้ำ (`n_distinct`), ค่าที่เจอบ่อยที่สุดพร้อมความถี่, histogram ของค่าที่เหลือแบ่งเป็น bucket ที่มีความถี่เท่ากัน (ได้ถึง 100 bucket ถ้าใช้ `default_statistics_target` ค่า default) และ correlation ระหว่างลำดับของ column กับลำดับทางกายภาพของ table สำหรับ range อย่าง `created_at >= '2026-09-03'` ตัว planner จะหา bucket ที่ค่านั้นตกอยู่ นับ bucket ที่อยู่เหนือขึ้นไป แล้ว interpolate แบบเส้นตรงภายใน bucket นั้น ถ้ามีหลายเงื่อนไข มันจะคูณ selectivity ของแต่ละตัวเข้าด้วยกันโดยสมมติว่าเป็นอิสระต่อกัน ยกเว้นมี extended statistics object (`CREATE STATISTICS … (ndistinct, dependencies, mcv)`) ที่บันทึกว่า column ของ table เดียวกันสัมพันธ์กันยังไง ส่วน object แบบนี้จะถูกเติมข้อมูลตอน `ANALYZE` ครั้งถัดไป

**อะไรผิดพลาดตรงนี้** statistics ของ `orders` ถูกเก็บไว้ก่อนที่ order ของ 30 วันล่าสุดจะเข้ามา ทำให้ histogram ของ `created_at` ไปจบที่ 2026-09-02 23:58 และทุก row ที่ report ต้องการก็อยู่เลย bucket สุดท้ายไปแล้ว planner ไม่เชื่อว่าปลายของ histogram จะเป็นค่าปัจจุบัน แทนที่จะใช้ศูนย์ มันเลยใช้ค่าขั้นต่ำคือหนึ่งในร้อยของหนึ่ง bucket ([`selfuncs.c`](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/utils/adt/selfuncs.c)): 0.01% ของ 476,881 row ที่มันสมมติไว้คือ 48 ส่วน autovacuum ก็ไม่ได้ refresh statistics เพราะมันจะ analyze table ใหม่ก็ต่อเมื่อมีการเปลี่ยนแปลงเกิน `autovacuum_analyze_threshold` + `autovacuum_analyze_scale_factor` × จำนวน row โดย default ค่านี้คือ 50 + 10% ของ 476,787 = 47,729 แต่ order ใหม่ 23,213 ตัวยังน้อยกว่านั้น หลัง `ANALYZE orders` ตัว histogram ไปถึง 2026-10-02 17:16 ทำให้ช่วงที่ report ขอครอบ 4.59 จาก 100 bucket และค่าประมาณกลายเป็น 22,956 แล้ว planner ก็เลือก hash join ที่อ่าน `customers` ครั้งเดียวเข้า hash table แทนที่จะ lookup 23,213 ครั้ง ([Join Algorithms](../join-algorithms/) เทียบทั้งสามวิธี): 6,198 buffer แทน 74,704 และ 88 ms แทน 106 ms

**ค่าประมาณที่พลาดบ่อยแบบอื่น ๆ และวิธีแก้** แต่ละข้อวัดหนึ่งครั้งบนข้อมูลตัวอย่างชุดเดียวกัน:

- *statistics เก่ากว่าข้อมูล* แบบข้างบน: รัน `ANALYZE` หลังเปลี่ยนข้อมูลก้อนใหญ่ และลด `autovacuum_analyze_scale_factor` ของ table ใหญ่ที่โตขึ้นเรื่อย ๆ
- *column ที่สัมพันธ์กัน* ตรงนี้ customer ทุกคนส่งของไปประเทศของตัวเอง ทำให้ `customer_id = 1 AND shipping_country = 'MY'` ตรงกับ order 2,633 ตัว แต่การคูณ selectivity สองตัวให้ค่าประมาณ 331 หลัง `CREATE STATISTICS orders_customer_country (dependencies) ON customer_id, shipping_country FROM orders` และ `ANALYZE` อีกรอบ ค่าประมาณกลายเป็น 2,783 ส่วน extended statistics ครอบได้แค่ column ของ table เดียว: ไม่มีอะไรบอก planner ว่า `orders.shipping_country` ตรงกับ `country` ของ customer
- *function ที่ครอบ column อยู่* `date_trunc('day', created_at) >= '2026-09-03'` ไม่มี statistics ของตัวเอง planner เลยถอยไปใช้ค่า default คือหนึ่งในสาม: ประมาณไว้ 166,667 row แต่เจอจริง 23,213 row ทางแก้คือเทียบ column เปล่า ๆ กับ range แทน หรือเก็บ statistics ของ expression นั้น (`CREATE STATISTICS … ON (date_trunc('day', created_at)) FROM orders` ได้ 24,346) ส่วน index ต้องใช้ expression ที่ immutable และบน `timestamptz` รูปแบบนี้ขึ้นกับ `TimeZone` ของ session ทำให้ `CREATE INDEX` ไม่ยอมรับ: ให้ทำ index บน `date_trunc('day', created_at, 'UTC')` แล้วเขียน query แบบเดียวกัน
- *parameter ที่ planner มองไม่เห็น*: generic plan ของ prepared statement อยู่ในหัวข้อ "ได้อะไร เสียอะไร" ข้างล่าง

## ลองรันดู

ข้อมูลตัวอย่างมาจาก [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop) คือ script ที่สร้าง template database `acme` บน PostgreSQL 18 ในเวลาประมาณหนึ่งนาที

รันบนสำเนาใหม่ของข้อมูลตัวอย่าง Acme Shop (PostgreSQL 18) โดยต่อเข้าไปเป็น superuser: ขั้นย้อนเวลาตอนต้นจะปิดการเช็ค foreign key ไว้ระหว่างที่ดึง order ของ 30 วันล่าสุดออกแล้วใส่กลับเข้าไป ตัว comment แสดงบรรทัดสำคัญของการรันหนึ่งรอบ ส่วนในการรันของคุณ รอบแรกจะเห็น buffer บางส่วนเป็น `read=` แทน `hit=` และยอดรวมอาจต่างกันไม่กี่ catalog page

```sql
-- CREATE DATABASE query_execution_plans TEMPLATE acme STRATEGY FILE_COPY;  then connect to it
SET TimeZone = 'UTC';
SET max_parallel_workers_per_gather = 0;            -- one process: a smaller plan tree

-- Rewind the statistics to before the last 30 days of orders arrived
ALTER TABLE orders SET (autovacuum_enabled = off);  -- keep autovacuum out of the experiment
SET session_replication_role = replica;             -- no FK checks while the rows are out
CREATE TEMP TABLE recent AS SELECT * FROM orders WHERE created_at >= '2026-09-03';  -- SELECT 23213
DELETE FROM orders WHERE created_at >= '2026-09-03';
VACUUM ANALYZE orders;
INSERT INTO orders OVERRIDING SYSTEM VALUE SELECT * FROM recent;
RESET session_replication_role;

SELECT (histogram_bounds::text::timestamptz[])[101] AS last_bound
FROM pg_stats WHERE tablename = 'orders' AND attname = 'created_at';
-- 2026-09-02 23:58:49+00   (ANALYZE samples rows at random: yours differs a little)

EXPLAIN (ANALYZE, BUFFERS)
SELECT c.country, count(*) AS orders, sum(o.total_thb) AS revenue
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.created_at >= '2026-09-03'
GROUP BY c.country
ORDER BY revenue DESC;
-- Sort  (cost=11408.87..11408.88 rows=6 width=43) (actual time=105.619..105.627 rows=6.00 loops=1)
--   Buffers: shared hit=74704
--   ->  GroupAggregate ... ->  Sort ...
--         ->  Nested Loop  (cost=0.29..11406.89 rows=48 width=11) (actual time=0.018..92.780 rows=23213.00 loops=1)
--               ->  Seq Scan on orders o  (cost=0.00..11020.01 rows=48 width=16) (actual time=0.010..43.964 rows=23213.00 loops=1)
--                     Rows Removed by Filter: 476787
--               ->  Index Scan using customers_pkey on customers c  (cost=0.29..8.06 rows=1 width=11) (actual time=0.002..0.002 rows=1.00 loops=23213)
--                     Buffers: shared hit=69639
-- Execution Time: 105.779 ms

ANALYZE orders;
EXPLAIN (ANALYZE, BUFFERS)
SELECT c.country, count(*) AS orders, sum(o.total_thb) AS revenue
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.created_at >= '2026-09-03'
GROUP BY c.country
ORDER BY revenue DESC;
-- Sort  (cost=14927.58..14927.60 rows=6 width=43) (actual time=87.441..87.449 rows=6.00 loops=1)
--   Buffers: shared hit=6198
--   ->  HashAggregate ...
--         ->  Hash Join  (cost=3386.00..14755.26 rows=22956 width=11) (actual time=32.519..82.040 rows=23213.00 loops=1)
--               ->  Seq Scan on orders o  (cost=0.00..11309.00 rows=22956 width=16) (actual time=0.011..37.430 rows=23213.00 loops=1)
--               ->  Hash  (cost=2136.00..2136.00 rows=100000 width=11) (actual time=32.253..32.254 rows=100000.00 loops=1)
--                     ->  Seq Scan on customers c  (cost=0.00..2136.00 rows=100000 width=11) (actual time=0.005..13.591 rows=100000.00 loops=1)
-- Execution Time: 87.659 ms

ALTER TABLE orders RESET (autovacuum_enabled);
```

เวลามาจากการรันหนึ่งรอบบน laptop และเปลี่ยนไปในแต่ละรอบ สิ่งที่สำคัญคือ plan, จำนวน row และ buffer

## ใช้ตอนไหนดี

- **ก่อนเปลี่ยนอะไรก็ตาม** กับ statement ที่ช้า ให้รัน `EXPLAIN (ANALYZE, BUFFERS)` หา node ที่แพงที่สุดกับค่าประมาณที่พลาดมากตัวแรกที่อยู่ข้างใต้มัน แล้วแก้ตรงนั้น และให้รันสองครั้ง: รอบแรกอาจอ่าน page จาก disk ที่รอบสองเจอใน memory แล้ว
- **`EXPLAIN` ที่ไม่มี `ANALYZE`** แค่วาง plan โดยไม่รัน statement เลยใช้กับ `DELETE` บน production ได้ แต่มันแสดงแค่ค่าประมาณ
- **option ที่ควรรู้:** `SETTINGS` แสดง planner setting ที่ต่างจาก default, `WAL` แสดง WAL ที่การเขียนสร้างขึ้น, `SERIALIZE` (PostgreSQL 17 ขึ้นไป) วัดการแปลงผลลัพธ์เป็น text หรือ binary, `MEMORY` (17 ขึ้นไป) วัด memory ของ planner, `GENERIC_PLAN` (16 ขึ้นไป) วาง plan ให้ statement ที่มี parameter `$1` โดยไม่ต้องมีค่า, `TIMING OFF` เก็บจำนวน row ไว้แต่ตัดเวลาของแต่ละ node ออก และ `FORMAT JSON` ใช้ป้อนให้ tool
- **tree ใหญ่ ๆ** อ่านง่ายกว่าใน visualizer เช่น [explain.depesz.com](https://explain.depesz.com/), [explain.dalibo.com](https://explain.dalibo.com/) หรือ [pgMustard](https://www.pgmustard.com/)
- **บน production** ให้หา statement ที่คุ้มจะ explain ก่อน ตัว `pg_stat_statements` เก็บจำนวนครั้งที่เรียก, เวลารวมและเวลาเฉลี่ย, row และ buffer ของแต่ละ statement ที่ normalize แล้ว (ต้องใส่มันไว้ใน `shared_preload_libraries`) ส่วน `auto_explain` จะ log plan ของทุก statement ที่ช้ากว่า `auto_explain.log_min_duration` พร้อม actual rows และ buffer ถ้าเปิด `log_analyze` และ `log_buffers` ไว้

## ได้อะไร เสียอะไร

- **`EXPLAIN ANALYZE` รัน statement จริง** `SELECT` ไม่ส่งอะไรกลับมาให้ แต่ทำงานครบทั้งหมด ส่วน `INSERT`, `UPDATE` หรือ `DELETE` เปลี่ยนข้อมูลจริง ๆ เลยต้องครอบด้วย `BEGIN; … ROLLBACK;`
- **การวัดกินเวลา** การจับเวลาราย node ต้องอ่านนาฬิกาซ้ำแล้วซ้ำอีก จากการวัดสามชุด ชุดละ 15 รอบ ค่า median ของ report ตอนไม่ใช้ `EXPLAIN` อยู่ที่ 77 ถึง 81 ms ตอน statistics เก่า และ 62 ถึง 64 ms หลัง `ANALYZE` ส่วน `EXPLAIN ANALYZE` เพิ่มเวลาประมาณ 16 ms ให้ทั้งสองแบบ ให้ใช้ `TIMING OFF` ถ้าจำนวน row ก็พอแล้ว และเปิด `auto_explain.log_analyze` ไว้แค่ตอนสืบสวนสั้น ๆ: ระหว่างที่เปิดอยู่ ทุก statement ต้องจ่ายค่าจับเวลา ไม่ว่าจะถูก log หรือไม่
- **cache ที่อุ่นอยู่ซ่อน plan ที่แย่ไว้** plan ที่ผิดแตะ buffer มากกว่า 12 เท่า แต่ช้ากว่าแค่ประมาณ 25% เพราะทุก page อยู่ใน memory อยู่แล้ว ถ้า page พวกนั้นต้องมาจาก disk แต่ละ lookup ในจำนวน 23,213 ครั้งก็อาจกลายเป็น random read แบบที่ `random_page_cost` ตีราคาไว้
- **statistics เป็นแค่ sample** เพราะ `ANALYZE` สุ่ม sample ทำให้ค่าประมาณขยับไปนิดหน่อยหลังรันแต่ละครั้ง (ที่นี่ได้ 22,956 ส่วนอีกรอบของ script เดียวกันได้ 23,960) การตั้ง statistics target ของ column ให้สูงขึ้น (`ALTER TABLE … ALTER COLUMN … SET STATISTICS`) ทำให้ได้ histogram ที่ละเอียดขึ้นและ list ของค่าที่เจอบ่อยที่ยาวขึ้น แลกกับ `ANALYZE` ที่ช้าลง, กินที่ใน `pg_statistic` มากขึ้น และวาง plan ช้าลงเล็กน้อย
- **ค่าประมาณที่ถูกไม่ได้แปลว่างานน้อยลง** ถึง statistics จะใหม่แล้ว report ก็ยังอ่าน `orders` ครบทั้ง 5,059 page และทิ้งไป 476,787 row ส่วนในการรันของเรา [B-tree index](../b-tree-index/) บน `created_at` ลดเวลาเหลือประมาณ 60 ms ด้วย bitmap scan บน 3,963 page ที่มี order ล่าสุดอยู่ (ข้อมูลตัวอย่างกระจาย order พวกนี้ไปเกือบทั้ง table) ตัว index ยังช่วยเรื่องค่าประมาณด้วย: ถ้าค่าหนึ่งอยู่เลย histogram ไป planner จะอ่านค่าต่ำสุดหรือสูงสุดปัจจุบันของ column จาก index ทำให้ค่าประมาณเก่าที่เป็น 48 กลายเป็น 4,009 ถ้า report เก่าได้สักไม่กี่นาที ตัว [materialized view](../materialized-view/) ก็เลี่ยงงานนี้ได้ทั้งหมด
- **generic plan** ตัว prepared statement จะถูกวาง plan ด้วยค่า parameter จริงในการรันห้าครั้งแรก หลังจากนั้น PostgreSQL อาจเปลี่ยนไปใช้ generic plan ตัวเดียว ถ้า cost ที่ประมาณไว้ของมันไม่ได้สูงกว่าค่าเฉลี่ยมากนัก ตัว generic plan มองไม่เห็น `$1`: สำหรับ `created_at >= $1` มันสมมติไว้หนึ่งในสามของ table คือ 166,667 row ส่วนในการรันของเรา custom plan ยังถูกกว่า ทำให้ PostgreSQL ใช้ custom plan ต่อไป ส่วนถ้าค่ากระจายตัวไม่สม่ำเสมอ `plan_cache_mode = force_custom_plan` จะวาง plan ใหม่ทุกครั้งที่รัน
- **setting `enable_*` มีไว้ทดลอง** `SET enable_nestloop = off` แสดงให้เห็นว่า planner จะทำอะไรถ้าไม่ใช้วิธีนั้น (เอกสารเรียก setting พวกนี้ว่าวิธีแบบหยาบ ๆ) บน production ให้แก้ค่าประมาณแทน

## ข้อควรรู้ตอนลงมือทำ

- **PostgreSQL 18** เปิด `BUFFERS` เป็น default เมื่อใช้ `EXPLAIN ANALYZE` แล้วยังพิมพ์ actual row count เป็นทศนิยม แสดง `Index Searches` และให้ `pg_upgrade` เก็บ optimizer statistics ไว้ได้ แต่ extended statistics ยังต้อง `ANALYZE` หลัง upgrade
- **รักษา statistics ให้ใหม่อยู่เสมอ** รัน `ANALYZE` หลังโหลดข้อมูลก้อนใหญ่และหลังลบข้อมูลเยอะ ๆ สำหรับ table ใหญ่ที่มีการ append เยอะ ให้ลด threshold ราย table ลง เช่น `ALTER TABLE orders SET (autovacuum_analyze_scale_factor = 0.01)` ตัว autovacuum ไม่เคย analyze temporary table หรือ parent ของ partitioned table เลยต้อง analyze พวกนั้นเอง
- **replica ใช้ statistics ร่วมกับ primary** ตัว hot standby รัน `ANALYZE` ไม่ได้ มันใช้ statistics ที่ primary เก็บไว้ ทำให้ report บน [read replica](../read-replicas/) ได้ค่าประมาณเหมือนบน primary
- **MySQL 8.4** มีของที่เทียบกันได้สองตัว `EXPLAIN FORMAT=TREE` พิมพ์ iterator tree พร้อม cost และ row ที่ประมาณไว้ ส่วน `explain_format` ที่เป็น default คือ table format แบบเก่า ที่บอกว่าเป็น hash join แค่ด้วย `Using join buffer (hash join)` ใน column `Extra` ของมัน ตัว `EXPLAIN ANALYZE` รัน statement แล้วเพิ่มข้อมูลให้แต่ละ iterator คือเวลาถึง row แรกและถึงทุก row เป็น millisecond (เฉลี่ยต่อ loop), จำนวน row จริง และจำนวน loop โดยใช้ได้แค่ใน tree format ส่วน InnoDB เก็บ persistent index statistics ที่ sample จาก 20 page ต่อ index โดย default และคำนวณใหม่เบื้องหลังเมื่อ row ของ table เปลี่ยนไปเกิน 10% ส่วน column histogram จะมีก็ต่อเมื่อสร้างเองด้วย `ANALYZE TABLE … UPDATE HISTOGRAM` และจะ refresh อัตโนมัติก็ต่อเมื่อสร้างด้วย `AUTO UPDATE` (default คือ `MANUAL UPDATE`)
- **ความนิ่งของ plan** Aurora PostgreSQL (ดู [Amazon RDS & Aurora](../amazon-rds-aurora/)) เพิ่ม query plan management คือ extension `apg_plan_mgmt`: มันเก็บ plan ไว้และบังคับให้ optimizer เลือกจาก plan ที่อนุมัติแล้ว เพื่อกันไม่ให้ plan แย่ลงหลัง statistics, parameter หรือ engine เปลี่ยน ส่วน Query Store ของ SQL Server (SQL Server 2016 ขึ้นไป และเปิดเป็น default สำหรับ database ใหม่ตั้งแต่ SQL Server 2022) เก็บประวัติ plan ของแต่ละ query พร้อม runtime statistics และบังคับให้ใช้ plan ก่อนหน้าได้
- **รันซ้ำให้ได้ผลเดิม** ตัวเลขใน diagram มาจากการรัน script ข้างบนหนึ่งรอบบน PostgreSQL 18.6 โดยปิด parallel query ถ้าใช้ default คือ parallel worker สองตัวต่อ gather ตัว plan ชุดเดิมจะมี `Gather Merge` กับ partial และ final aggregate เพิ่มเข้ามา และ scan จะแสดง row ต่อ process พร้อม `loops=3`
