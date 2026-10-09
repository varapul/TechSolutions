## ปัญหา

join จับคู่ row จาก input สองตัวที่มี key เดียวกัน: order กับ item ของมัน, item กับ product ของมัน วิธีที่เห็นชัดที่สุดคือไล่ทุก row ของ input ตัวหนึ่งต่อทุก row ของอีกตัว และวิธีนี้มีต้นทุนเท่ากับขนาดของสองตัวคูณกัน step 1 แสดงให้เห็นบนข้อมูลตัวอย่าง (PostgreSQL 18.6) ตัว `LATERAL` subquery ดึง event ล่าสุดของ order แต่ละตัวจาก 45 ตัวของ customer 2 ตั้งแต่ 1 กันยายน มันเลยรันหนึ่งครั้งต่อหนึ่ง order และ `order_events` ก็ไม่มี index บน `order_id` ทำให้ทุกรอบที่รันเป็น full scan ของ 1,500,000 row: 67.5 ล้าน row และอ่าน page 496,350 ครั้งเพื่อคืนแค่ 45 row ใช้เวลา 1.8 s ในการรันหนึ่งรอบบน laptop

รูปแบบเดียวกันนี้โผล่มาทุกครั้งที่ join รันได้แค่ทีละ row (correlated subquery ใน select list, `LATERAL` subquery ที่มี `LIMIT`, join บน `<` หรือ `BETWEEN` หรือ application ที่ query หนึ่งครั้งต่อหนึ่ง row แบบใน [N+1 Queries](../n-plus-one-queries/)) และด้าน inner ไม่มี index บน key ของมัน แต่ join ธรรมดาไม่ได้ติดอยู่กับวิธีนี้: planner มีสามวิธีให้เลือก และมันตีราคาแต่ละวิธีก่อนจะรันอะไรเลย

## ทำงานยังไง

PostgreSQL ก็เหมือน relational database ส่วนใหญ่ คือมีสามวิธีในการ join input สองตัว ทุกวิธีคืน row ชุดเดียวกัน แต่ต่างกันที่สิ่งที่ต้องการ, ปริมาณ memory ที่ใช้ และงานโตขึ้นยังไง ข้างล่างนี้ N คือขนาดของ input ด้าน outer (ตัวที่ขับ loop หรือไป probe hash table) และ M คือขนาดของ input ด้าน inner (ตัวที่ถูกค้นหา หรือถูกสร้างเป็น hash table)

| | Nested loop | Hash join | Merge join |
|---|---|---|---|
| **วิธีทำ** | ทุก outer row ไปค้นหาในด้าน inner | สร้าง hash table จาก input ตัวหนึ่ง แล้ว stream อีกตัวผ่านมัน | อ่าน input ทั้งสองตัวที่เรียงตาม key แล้วไล่ไปพร้อมกัน |
| **งาน** | N × M ถ้าใช้ scan และประมาณ N × log M ถ้ามี index บน key ด้าน inner | ประมาณ N + M | N + M ถ้าทั้งสองตัวมาแบบเรียงแล้ว บวก N log N + M log M ถ้าต้อง sort |
| **Memory** | ไม่ใช้ (ยกเว้น `Memoize` cache ถ้า planner ใส่ไว้) | hash table ได้ถึง `work_mem` × `hash_mem_multiplier` จากนั้นแบ่ง batch ลง disk | ไม่ใช้ถ้าเป็น index scan ส่วน `Sort` ใช้ `work_mem` |
| **เงื่อนไข join** | อะไรก็ได้ (`=`, `<`, `BETWEEN`, function) | เท่ากันเท่านั้น | เท่ากันเท่านั้น และต้องเป็น type ที่ sort ได้ |
| **row แรก** | ทันที | หลังอ่าน build input ครบทั้งหมด | ทันทีถ้า input ทั้งสองตัวมาจาก index |

**Nested loop** สำหรับแต่ละ outer row ตัว executor จะรันด้าน inner ใหม่อีกรอบด้วย key ของ row นั้น ถ้ามี index บน key ด้าน inner ก็คือการไล่ลง index หนึ่งรอบ: ใน step 2 order แต่ละตัวจาก 45 ตัวไล่ `order_items_pkey` จาก root (page 235) ผ่าน branch page ไปที่ leaf (branch 4605 และ leaf 4805 สำหรับ order 499314) แล้วอ่าน heap page หนึ่ง page รวมประมาณสี่ page ต่อ order และ 182 page ทั้งหมด ถ้าไม่มี index แต่ละรอบก็เป็น full scan แบบใน step 1 ตัว planner ใส่ node `Memoize` ไว้ที่ด้าน inner ได้ เพื่อ cache ผลลัพธ์ของ key ที่ซ้ำ ตัว nested loop เองเป็นวิธีเดียวที่รับเงื่อนไข join ได้ทุกแบบ และคืน row ได้ก่อนจะอ่าน input ตัวไหนครบ มันเลยเหมาะกับ lookup เล็ก ๆ และ `LIMIT` ส่วนเรื่องการไล่ลง index ดูได้ที่ [B-Tree Index](../b-tree-index/)

**Hash join** ปกติ planner จะเอา input ตัวที่เล็กกว่าไว้ฝั่ง build แล้วใน step 3 มันก็อ่าน order ของเดือนกันยายน 23,436 ตัวแล้วจัดแต่ละตัวลง bucket ตาม hash ของ `o.id`: ถ้าเป็น key `bigint` ตัวเดียว PostgreSQL 18 ใช้ `hashint8(id)` และ bucket ก็คือ bit ต่ำ ๆ ของมัน ทำให้ order 475656 ตกที่ bucket 6,483 จาก 32,768 จากนั้นมันอ่าน `order_items` รอบเดียว hash `order_id` ของแต่ละตัว แล้วเทียบ key แค่ใน bucket นั้น bucket เดียว: order 1 hash ไปได้ bucket 5,958 เจอ order 478168 อยู่ในนั้น แล้วตัวมันก็ถูกทิ้งไป ตัวที่ตรงกัน 58,590 ตัวไหลต่อไปเข้า hash join ตัวที่สองที่เล็กกว่าบน `products` (10,000 row, 597 kB) แล้ว join ตัวนี้ก็เติม category เข้าไป เรื่อง bucket และการชนกันดูได้ที่ [Hash Table](../hash-table/)

hash join ของ PostgreSQL เป็น hybrid hash join: ถ้า table ใส่ใน `work_mem` × `hash_mem_multiplier` ไม่พอ (default 4 MB × 2.0) มันจะแบ่ง input ทั้งสองตัวเป็น batch ตามค่า hash เก็บ batch หนึ่งไว้ใน memory เขียนที่เหลือลง temporary file แล้ว join ทีละ batch ส่วนถ้าตั้ง `work_mem = 64kB` query เดิมจะรันด้วย 8 batch เขียน temporary file ประมาณ 66 MB และใช้เวลา 293 ms แทน 84 และใน parallel plan ตัว `Parallel Hash` จะถูกสร้างครั้งเดียวโดย worker ทุกตัวช่วยกันแล้วแชร์กันใช้ (ตัวที่อยู่บน `orders`) ส่วน `Hash` ธรรมดาจะถูกสร้างเต็ม ๆ ในทุก process (ตัวที่อยู่บน `products`, `loops=3`)

**Merge join** ต้องได้ input ทั้งสองตัวแบบเรียงตาม join key มาแล้ว ไม่ว่าจะมาจาก index หรือจาก `Sort` ใน step 3 ช่วงของ order มาจาก `orders_pkey` และ item มาจาก `order_items_pkey` ทั้งคู่เรียงตาม `order_id` ตัว executor เลยจำตำแหน่งไว้หนึ่งจุดในแต่ละ input แล้วขยับฝั่งที่ key น้อยกว่าไปข้างหน้า ส่วน key ที่เท่ากันก็กลายเป็น row ที่ join แล้ว ไล่แต่ละ input รอบเดียวก็ join order 200,000 ตัวกับ item 500,000 ตัวของมันได้ โดยไม่ต้อง sort และไม่ต้องมี hash table และผลลัพธ์ก็เรียงตาม `order_id` อยู่แล้วสำหรับ `ORDER BY` ตัว PostgreSQL ไม่ได้ส่งต่อช่วงของ `o.id` ไปให้ `order_items` ทำให้ scan ด้าน inner เริ่มที่ order 1 และอ่าน item ไป 250,000 ตัวก่อนจะเจอตัวแรกที่ตรง (อ่านไป 750,001 row) การไล่ input ที่เรียงแล้วสองตัวไปพร้อมกันก็คือขั้น merge ของ [Merge Sort](../merge-sort/) ที่เอามาใช้กับสอง table

**planner เลือกยังไง** สำหรับ input แต่ละคู่ แต่ละลำดับการ join และแต่ละวิธี planner ประมาณ cost จากจำนวน row ที่ประมาณไว้และ cost setting ของมัน แล้วเก็บ plan ที่ถูกที่สุดไว้ ส่วน step 4 แสดงค่าประมาณของมันสำหรับแต่ละ query ที่อ่านมาจาก `EXPLAIN` โดยปิดอีกสองวิธีไว้ (`enable_nestloop`, `enable_hashjoin`, `enable_mergejoin`): วิธีที่ถูกเลือกถูกที่สุดทุกครั้ง โดยถูกกว่า 3.8× สำหรับ nested loop, 1.6× สำหรับ hash join และ 12% สำหรับ merge join เพราะการเลือกขึ้นกับค่าประมาณ จำนวน row ที่ผิดก็อาจทำให้เลือกวิธีผิดได้ กรณีคลาสสิกคือ nested loop ที่วาง plan ไว้สำหรับ outer row ไม่กี่ตัวแต่ไปเจอเป็นพัน ๆ ตัว หน้า [Query Execution Plans](../query-execution-plans/) แสดงวิธีจับกรณีแบบนี้ จำนวนลำดับการ join โตแบบ exponential ตามจำนวน table ทำให้ PostgreSQL ต้องจำกัดการค้นหา: มันจะสลับลำดับ `JOIN` ที่เขียนไว้ชัด ๆ ก็ต่อเมื่อ list ของ item ยังไม่เกิน `join_collapse_limit` (default 8) ถ้าเกินกว่านั้นมันจะคงลำดับที่คุณเขียนไว้บางส่วน และตั้งแต่ `geqo_threshold` (12) FROM item ขึ้นไป มันจะเปลี่ยนไปใช้ genetic query optimizer ที่ลองแค่ตัวอย่างของลำดับการ join แทนที่จะลองทั้งหมด

## ลองรันดู

ข้อมูลตัวอย่างมาจาก [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop) คือ script ที่สร้าง template database `acme` บน PostgreSQL 18 ในเวลาประมาณหนึ่งนาที

plan และจำนวน row ข้างล่างมาจาก script นี้ ส่วนเวลาเปลี่ยนไปในแต่ละรอบที่รัน เลยไม่ได้ใส่ไว้

```sql
-- Fresh copy of the sample data on PostgreSQL 18, then connect to it:
CREATE DATABASE join_algorithms TEMPLATE acme STRATEGY FILE_COPY;
\c join_algorithms

-- 1. A nested loop with no index on the inner key: LATERAL runs once per order,
--    and each run scans all of order_events (it takes seconds).
PREPARE latest AS
SELECT o.id, ev.kind, ev.happened_at
FROM orders o
LEFT JOIN LATERAL (SELECT e.kind, e.happened_at FROM order_events e
                   WHERE e.order_id = o.id
                   ORDER BY e.happened_at DESC LIMIT 1) ev ON true
WHERE o.customer_id = 2 AND o.created_at >= '2026-09-01';
EXPLAIN (ANALYZE, BUFFERS) EXECUTE latest;
--  Nested Loop Left Join  (... rows=45.00 loops=1)
--    ->  Seq Scan on orders o  (... rows=45.00 loops=1)
--    ->  Limit  (... rows=1.00 loops=45)
--          ->  Sort  (... rows=1.00 loops=45)
--                ->  Seq Scan on order_events e  (... rows=3.00 loops=45)
--                      Filter: (order_id = o.id)
--                      Rows Removed by Filter: 1499997
--                      Buffers: shared read=496350

--    The same nested loop with an index on the foreign key:
BEGIN;
CREATE INDEX ON order_events (order_id);
EXPLAIN (ANALYZE, BUFFERS) EXECUTE latest;
--                ->  Index Scan using order_events_order_id_idx on order_events e  (... rows=3.00 loops=45)
--                      Index Searches: 45
ROLLBACK;

-- 2. Nested loop with index lookups: customer 2's orders with their items.
EXPLAIN (ANALYZE, BUFFERS)
SELECT o.id, o.created_at, i.line_no, i.product_id, i.qty
FROM orders o JOIN order_items i ON i.order_id = o.id
WHERE o.customer_id = 2 AND o.created_at >= '2026-09-01'
ORDER BY o.created_at DESC;
--  ->  Nested Loop  (... rows=39.00 loops=3)
--        ->  Parallel Seq Scan on orders o  (... rows=15.00 loops=3)
--        ->  Index Scan using order_items_pkey on order_items i  (... rows=2.60 loops=45)
--              Index Searches: 45

-- 3a. Hash join: revenue per category in September, then with less memory.
PREPARE revenue AS
SELECT p.category, sum(i.qty * i.price_thb) AS revenue
FROM order_items i
JOIN orders o ON o.id = i.order_id
JOIN products p ON p.id = i.product_id
WHERE o.created_at >= '2026-09-01' AND o.created_at < '2026-10-01'
GROUP BY p.category ORDER BY revenue DESC;
EXPLAIN (ANALYZE, BUFFERS) EXECUTE revenue;
--  ->  Hash Join  (... rows=19530.00 loops=3)
--        Hash Cond: (i.product_id = p.id)
--        ->  Parallel Hash Join  (... rows=19530.00 loops=3)
--              Hash Cond: (i.order_id = o.id)
--              ->  Parallel Seq Scan on order_items i
--              ->  Parallel Hash  (... rows=7812.00 loops=3)
--                    Buckets: 32768  Batches: 1  Memory Usage: 1216kB
--        ->  Hash  (... rows=10000.00 loops=3)
--              Buckets: 16384  Batches: 1  Memory Usage: 597kB
SET work_mem = '64kB';
EXPLAIN (ANALYZE, BUFFERS) EXECUTE revenue;
--                    Buckets: 8192  Batches: 8  ...
RESET work_mem;

-- 3b. Merge join: a large range of orders with their items, in order_id order.
EXPLAIN (ANALYZE, BUFFERS)
SELECT o.id, o.created_at, i.line_no, i.product_id, i.qty
FROM orders o JOIN order_items i ON i.order_id = o.id
WHERE o.id BETWEEN 100001 AND 300000
ORDER BY o.id;
--  Merge Join  (... rows=500000.00 loops=1)
--    Merge Cond: (o.id = i.order_id)
--    ->  Index Scan using orders_pkey on orders o  (... rows=200000.00 loops=1)
--    ->  Index Scan using order_items_pkey on order_items i  (... rows=750001.00 loops=1)
```

## ใช้ตอนไหนดี

ส่วนใหญ่คุณไม่ได้เลือกวิธีเอง สิ่งที่คุณคุมได้คือ planner มีอะไรให้เลือกบ้าง และค่าประมาณของมันดีแค่ไหน

- **ทำ index ให้ foreign key ที่ใช้ join** อย่างน้อยก็ฝั่งที่จะเป็นด้าน inner ของ nested loop ตัว PostgreSQL ทำ index ให้ primary key และ unique constraint แต่ไม่เคยสร้าง index ให้ foreign key ทำให้ `order_events.order_id` และ `order_items.product_id` ไม่มี index เลยในข้อมูลตัวอย่าง พอมี index แล้ว query ของ step 1 ก็ทำ index lookup 45 ครั้งและเสร็จในประมาณ 20 ms แทน 1.8 s
- **คาดว่าจะได้ nested loop สำหรับ lookup**: outer row ไม่กี่ตัว, index บน key ด้าน inner, `LIMIT` หรือเงื่อนไข join ที่ไม่ใช่ `=`
- **คาดว่าจะได้ hash join สำหรับ report**: input ใหญ่ที่ไม่ได้เรียงแบบที่ใช้ประโยชน์ได้ และ join ด้วย `=` แล้วควรให้ session ที่ทำ report มี `work_mem` พอ และคอยดูใน `EXPLAIN ANALYZE` ว่า `Batches:` เกิน 1 ไหม
- **คาดว่าจะได้ merge join เมื่อ input ทั้งสองตัวเรียงอยู่แล้ว** ตาม key เช่น primary key index หรือ foreign key index สองตัวบนช่วงข้อมูลกว้าง ๆ หรือเมื่อผลลัพธ์ต้องออกมาเรียงตาม key
- **เขียน join ให้เป็น join** ตัว correlated subquery ใน select list หรือ `LATERAL` subquery ที่มี `LIMIT` รันได้แค่เป็น nested loop แต่ถ้าเขียนเป็น join ธรรมดา (หรือใช้ `DISTINCT ON` หรือ window function) planner ก็ใช้ได้ทั้งสามวิธี: join ธรรมดาของ order 45 ตัวชุดเดิมกับ event ทั้งหมดของมัน (135 row) รันเป็น hash join ใน 154 ms ถึงจะไม่มี index ก็ตาม
- **รักษา statistics ให้ใหม่อยู่เสมอ** (`ANALYZE` หลังโหลดข้อมูลก้อนใหญ่) เพราะทุกการเลือกขึ้นกับค่าประมาณจำนวน row
- **อย่าปิดวิธี join ทิ้ง** บน production ตัว setting `enable_*` มีไว้ทดลองใน session เดียว แบบใน step 4

## ได้อะไร เสียอะไร

- **Nested loop** คืน row แรกได้ทันทีและไม่ต้องใช้ memory แต่ต้นทุนของมันคูณกัน ถ้าไม่มี index บน key ด้าน inner หรือด้าน outer ใหญ่กว่าที่ประมาณไว้มาก มันก็กลายเป็นงาน N × M และแต่ละ lookup ก็อ่าน page ที่กระจายอยู่ทั่ว index และ table
- **Hash join** โตแค่ตาม N + M แต่ต้องอ่าน build input ทั้งหมดก่อนจะคืน row แรก ต้องถือมันไว้ใน memory และ spill ลง disk เป็น batch เมื่อ memory หมด (ที่นี่ 293 ms แทน 84 ms) ส่วน row จำนวนมากที่มี key เดียวกันจะไปกองอยู่ใน bucket เดียวกันหมด และ hash join ใช้ได้แค่ join ด้วยเงื่อนไขเท่ากัน
- **Merge join** stream ข้อมูลได้โดยใช้ memory น้อยเมื่อ input ทั้งสองตัวมาแบบเรียงแล้ว และ output ก็ยังเรียงตาม key แต่ถ้าไม่ได้เรียงมา `Sort` จะมีต้นทุน N log N บวก memory หรือ temporary file ทำให้ hash join มักถูกกว่า ส่วน merge join เองก็ใช้ได้แค่ join ด้วยเงื่อนไขเท่ากัน
- **planner** ดีได้แค่เท่ากับค่าประมาณของมัน: column ที่สัมพันธ์กัน, ค่าที่กระจายไม่สม่ำเสมอ และ statistics ที่เก่าแล้ว ล้วนทำให้มันพลาดได้ และจำนวนลำดับการ join ที่ต้องตีราคาก็โตแบบ exponential ตามจำนวน table
- **`work_mem` เป็นค่าต่อ operation ไม่ใช่ต่อ query** ตัว plan ที่มี hash และ sort หลายตัวอาจใช้มันหลายเท่า ในทุก session ที่รัน plan นั้น

## ข้อควรรู้ตอนลงมือทำ

- **PostgreSQL 18** ใน plan จะเรียกชื่อวิธีว่า `Nested Loop`, `Hash Join` (มี node ลูก `Hash` ที่แสดง `Buckets`, `Batches` และ `Memory Usage`) และ `Merge Join` (มี `Merge Cond` ของมัน) ส่วน `Memoize` cache ผลลัพธ์ด้าน inner ให้ nested loop ตัว hash table แต่ละตัวใช้ได้ถึง `work_mem` × `hash_mem_multiplier` (default 4 MB × 2.0) ส่วน parallel plan จะรัน nested loop และ merge join โดยมีด้าน inner ครบทั้งหมดในทุก process และรัน hash join ด้วย `Parallel Hash` ที่แชร์กัน หรือด้วย table หนึ่งชุดต่อหนึ่ง process
- **MySQL 8.4 (InnoDB)** รัน join เป็น nested loop โดย lookup table ด้าน inner ผ่าน index ถ้ามี (Batched Key Access รวม lookup พวกนั้นเป็น batch ได้ แต่ปิดไว้เป็น default) หรือรันเป็น hash join ตัว hash join มาใน 8.0.18 สำหรับ equi-join และตั้งแต่ 8.0.20 ก็มาแทน block nested loop และใช้กับ join ที่ไม่มีเงื่อนไขเท่ากันได้ด้วย แต่ไม่มี merge join ส่วน hash table ถูกจำกัดด้วย `join_buffer_size` และ spill ลงไฟล์บน disk และ `EXPLAIN FORMAT=TREE` แสดงมันเป็น `Inner hash join`
- **SQL Server** มี nested loop, merge join และ hash join และตั้งแต่ SQL Server 2017 ก็มี adaptive join ใน batch mode ที่ตัดสินใจเลือกระหว่าง hash join กับ nested loop หลังอ่าน input ตัวแรกแล้ว
- **Oracle Database** มี nested loop, hash join และ sort merge join และ adaptive plan ของมันก็สลับระหว่าง nested loop กับ hash join ตอน run time ได้ด้วย
- **SQLite** implement ทุก join เป็น nested loop ส่วนถ้า table ด้าน inner ไม่มี index ที่ใช้ได้ มันอาจสร้าง automatic index ที่อยู่แค่ statement เดียว และเอกสารของมันเปรียบ index นี้ว่าเหมือน hash join ที่ใช้ B-tree
- **DynamoDB** ไม่มี join เลย: คู่มือ data modelling ของมันให้เก็บ item ที่เกี่ยวข้องกันไว้ใกล้กันผ่าน composite key และ denormalize ทำให้ request เดียวคืนสิ่งที่ relational join จะประกอบขึ้นมาให้ ดู [Amazon DynamoDB](../amazon-dynamodb/)
