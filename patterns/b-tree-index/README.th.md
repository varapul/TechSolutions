## ปัญหา

เครื่องมือ support ของ Acme Shop เปิดประวัติ order ของลูกค้าด้วย query เดียว:

```sql
SELECT id, status, created_at, total_thb FROM orders WHERE customer_id = 42;
```

`orders` เก็บ 500,000 row ไว้บน heap page ขนาด 8 kB จำนวน 5,058 page รวมแล้ว 40 MB ตัว `customer_id` เป็น foreign key ที่ชี้ไปที่ `customers` แต่ใน [PostgreSQL](../postgresql/) การประกาศ foreign key ไม่ได้สร้าง index ให้ column ที่อ้างอิง ทำให้ planner มีทางตอบแค่ทางเดียว คืออ่านทั้ง table ส่วน plan ที่ได้บน PostgreSQL 18.6 คือ `Gather` ที่ครอบ `Parallel Seq Scan` ที่มี worker สองตัว แล้ว process ทั้งสามตัวก็ช่วยกันอ่านครบทั้ง 5,058 page เช็ก 500,000 row แล้วทิ้งไป 499,821 row เพื่อคืน order 179 รายการของลูกค้า 42 ใช้เวลาราว 11 ms ในการรันครั้งหนึ่งบน laptop ฟังดูไม่มีพิษภัยอะไร จนกว่าจะดูว่ามันโตตามอะไร: ถ้า order เพิ่มเป็นสองเท่า ทุก lookup ก็ต้องทำงานเพิ่มเป็นสองเท่าเพื่อได้ 179 row เท่าเดิม ระหว่างนั้นทุกคลิกของ agent แต่ละคนก็แย่ง CPU และ cache กับคลิกของคนอื่นทั้งหมด

## ทำงานยังไง

**tree ของ page ขนาด 8 kB** คำสั่ง `CREATE INDEX ON orders (customer_id)` (ใช้ 128 ms ในการรันนี้) เรียงคู่ `(customer_id, TID)` ทั้ง 500,000 คู่แล้วอัดลงไปใน page ตัว TID คือที่อยู่ของ row ใน heap ในรูป `(page, item)`: `(46,22)` คือ item 22 บน heap page 46 การรันนี้สร้าง index ได้ 705 page ในสามชั้น (`bt_metap` รายงานว่า root อยู่ที่ level 2):

- **Leaf page** มี 700 page เก็บ entry เรียงตาม key หลัง build เสร็จแต่ละ page เต็มราว 90% ตรงกับ `fillfactor` default ของ leaf ใน B-tree ตั้งแต่ PostgreSQL 13 เป็นต้นมา key ที่ซ้ำกันเป็นชุดจะถูกเก็บครั้งเดียว พร้อม list ของ TID ที่เรียงแล้ว เรียกว่า *posting list*: leaf page 14 เก็บ key 38 ถึง 46 ไว้ใน 16 tuple และ TID 179 ตัวของลูกค้า 42 ใช้ tuple ไปสองตัว (132 + 47) ที่ index นี้ใช้แค่ 705 page ก็เพราะ deduplication ขณะที่ primary key ที่มี entry เท่ากันแต่ไม่มีค่าซ้ำต้องใช้ถึง 1,374 page
- **Internal page** เก็บ separator key ที่แต่ละตัวมี downlink ไปยัง page ชั้นล่าง ตัว page 3 มีอยู่ 280 ตัว (`… 32 38 46 55 …`) โดย entry ของ 38 ชี้ไปที่ leaf 14 ที่เก็บ key ตั้งแต่ 38 ขึ้นไปจนถึง 46
- **Root** คือ page 286 เก็บ downlink สามตัว (`−∞`, `22893`, `71420`) และแทบไม่มีอะไรอื่น: 8,096 จาก 8,192 byte ของมันยังว่างอยู่ tree เลยโตได้อีกไกลกว่าจะต้องเพิ่มชั้นที่สี่

[binary search tree](../binary-search-tree/) ให้ node แต่ละตัวมีลูกสองตัว แต่ page ของ B-tree แตกกิ่งออกไปได้เป็นร้อย ๆ ตัว ทำให้ tree ตื้นได้ขนาดนี้ ภายใน page ตัว PostgreSQL ใช้ [binary search](../binary-search/) หา key ที่เรียงอยู่ (`_bt_binsrch` ใน [nbtsearch.c](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/access/nbtree/nbtsearch.c))

**การ lookup** สำหรับ `customer_id = 42` การค้นจะอ่าน root (42 น้อยกว่า 22893 เลยไป downlink แรก) แล้วอ่าน page 3 (38 ≤ 42 < 46 เลยไป leaf 14) แล้วอ่าน leaf 14 ที่เจอ posting list ของ 42 รวมเป็นการอ่าน page สามครั้ง ตรงกับที่ node `Bitmap Index Scan` รายงานเป๊ะ จากนั้น PostgreSQL ก็เรียง TID 179 ตัวลงใน bitmap ของ heap page แล้วอ่าน 175 page นั้นตามลำดับ physical (`Heap Blocks: exact=175`): 178 page เทียบกับ 5,058 page ใช้เวลา 0.09 ms ส่วน unique key ก็คือตัวอย่างแบบในตำรา: `WHERE id = 836` อ่าน `orders_pkey` สาม page และ heap อีกหนึ่ง page รวมเป็นสี่ page

**ออกแบบมาเพื่อ concurrency** `nbtree` ที่เป็น B-tree ของ PostgreSQL ทำตาม B-link tree ของ Lehman และ Yao (ACM TODS, 1981) ทุก page ยังเก็บ *right-link* ไปหา page ข้างเคียงในชั้นเดียวกัน และ *high key* ที่เป็นขอบบนของค่าที่ page นั้นเก็บได้ ถ้าการค้นมาถึง page ตอนที่ backend อีกตัวกำลัง split มันอยู่พอดี ก็จะเห็นว่า key ที่หาอยู่เกิน high key แล้วตาม right-link ไปต่อ ทำให้ reader ไม่ต้อง lock เส้นทางจาก root ลงมาระหว่างที่ writer ทำงาน ส่วน link ระหว่าง leaf ชุดเดียวกันนี้ก็คือทางที่ range scan เดินไปตาม

**Range และ ORDER BY** คำสั่ง `customer_id BETWEEN 42 AND 47` ไต่ลงครั้งเดียวไปที่ 42 ใน leaf 14 เดินไปทางขวาผ่าน 43 ถึง 46 แล้วตาม link เข้า leaf 15 เพื่ออ่าน 46 ที่เหลือกับ 47: ใช้ index 4 page สำหรับ 902 row และเพราะ leaf เรียงกันอยู่แล้ว `ORDER BY customer_id LIMIT 20` เลยรันเป็น `Index Scan` ที่หยุดหลังได้ 20 entry (21 page) โดยไม่ต้อง sort อะไรเลย แต่ bitmap ทิ้งลำดับนี้ไป เพราะมันเข้า heap ตามลำดับ page: `BETWEEN 42 AND 47 ORDER BY customer_id` เลยถูกวางแผนเป็น bitmap scan ที่มี `Sort` ครอบอยู่ข้างบน

**selectivity เป็นตัวตัดสิน plan** ตัว planner ประเมินจาก statistics ของ column ว่าจะมีกี่ row ที่ตรงเงื่อนไข แล้วคิดราคาแต่ละ plan โดย default การอ่าน page แบบ random มีราคา 4.0 และแบบ sequential มีราคา 1.0 (`random_page_cost`, `seq_page_cost`) นี่คือผลการรันบนข้อมูลชุดนี้ ตอนที่มี index บน `customer_id` และ `status`:

| Query | Row | Plan | Page ที่อ่าน | เวลา |
|---|---|---|---|---|
| `id = 836` | 1 | Index Scan on `orders_pkey` | 4 | 0.01 ms |
| `customer_id = 42`, ไม่มี index | 179 | Gather → Parallel Seq Scan | 5,058 | 11 ms |
| `customer_id = 42` | 179 | Bitmap Index Scan → Bitmap Heap Scan | 3 + 175 | 0.09 ms |
| `customer_id BETWEEN 42 AND 47` | 902 | Bitmap Index Scan → Bitmap Heap Scan | 4 + 822 | 1.7 ms |
| `status = 'pending'` | 990 | Index Scan on `orders_status_idx` | 872 | 0.9 ms |
| `customer_id = 1` | 2,633 | Bitmap Index Scan → Bitmap Heap Scan | 5 + 2,080 | 2.3 ms |
| `status = 'delivered'` | 487,245 | Seq Scan | 5,058 | 60 ms |

เวลาในตารางมาจากการรันครั้งเดียวบน laptop ที่ทุก page อยู่ใน cache แล้ว สิ่งที่เอาไปใช้ต่อได้คือ plan กับจำนวน page ส่วน row ของลูกค้า 42 ได้ bitmap แทน index scan ธรรมดา เพราะมันกระจายอยู่บน 175 page (`pg_stats` ให้ค่า correlation ระหว่าง `customer_id` กับลำดับ physical ของ row เป็น −0.01) และ planner ประเมินว่าอ่านแต่ละ page ครั้งเดียวตามลำดับจะถูกกว่า: 730 เทียบกับ 860 ของ index scan ธรรมดา ส่วน order 2,633 รายการของลูกค้า 1 ยังไปผ่าน index ทั้งที่แตะ page ถึง 41% ของ table แต่พอ row ตรงเงื่อนไขถึง 97% อย่าง `'delivered'` ตัว planner ก็ข้าม index ไป เพราะการเข้าเกือบทุก page ผ่าน index จะแพงกว่าอ่านทั้ง table รอบเดียว บรรทัด `'pending'` แสดงให้เห็นว่า plan ดีได้แค่เท่าที่ statistics ดี: correlation เป็นตัวเลขตัวเดียวต่อหนึ่ง column และของ `status` คือ 0.95 planner เลยคิดราคา index scan ธรรมดาว่าเกือบจะเป็น sequential ทั้งที่จริง ๆ แล้ว row ที่เป็น pending 990 row กระจายอยู่บน 868 page

**ทุกการเขียนต้องจ่ายให้ทุก index** index คือสำเนาที่สองของ column ที่เรียงไว้แล้ว และทุกการเขียนต้องคอยรักษาให้มันเรียงอยู่เสมอ ตัว order ใหม่ของลูกค้า 42 ไปลงที่ heap page 5,057 ส่วน key ของมันไปลง leaf 14 ข้าง ๆ entry อื่นของ 42 ตอนนั้น leaf 14 มีที่ว่าง 104 byte พอ leaf เต็ม ตัว PostgreSQL จะพยายามหาที่ว่างก่อน ด้วยการลบ entry ที่ตายแล้ว แล้วค่อยรวมค่าซ้ำเข้าไปใน posting list ทำให้ page นี้รับ order ใหม่ของลูกค้า 42 ได้ 39 รายการ แล้ว order ที่ 40 ก็ทำให้มัน split: key 43 ถึง 46 ย้ายไปที่ page ใหม่ 705 ตัว page 3 ได้ separator 43 เพิ่มมา และ index โตเป็น 706 page จุด split จะตกระหว่าง key สองค่าที่ต่างกันทุกครั้งที่ทำได้ entry ของลูกค้าคนหนึ่งเลยอยู่ด้วยกัน ส่วน key แบบสุ่มทำให้ page split กระจายไปทั่ว tree: หลัง insert order 50,000 รายการของลูกค้าแบบสุ่ม index มี leaf page 818 page แทน 700 และแต่ละ page เต็มแค่ 84% แทน 90% ส่วน key ที่เพิ่มขึ้นเรื่อย ๆ อย่าง identity `id` จะลง leaf ขวาสุดเสมอ และแต่ละ backend ก็จำ leaf นี้ไว้ จะได้ข้ามขั้นไต่ลงไปได้

ค่าใช้จ่ายของการ insert 50,000 ครั้ง วัดด้วย `EXPLAIN (ANALYZE, BUFFERS, WAL)`:

| Index บน `orders` | WAL ที่เขียน | WAL record ต่อ row | Page ที่แตะ |
|---|---|---|---|
| `orders_pkey` | 8.5 MB | 2 | 152,000 |
| + `orders_customer_id_idx` | 12.4 MB | 3 | 302,000 |
| + `orders_status_idx` | 15.6 MB | 4 | 453,000 |

index แต่ละตัวที่เพิ่มเข้ามาเพิ่ม WAL record หนึ่งตัวกับการเข้า page สามครั้ง (root, internal page, leaf) ต่อ row เวลาที่ใช้ก็เพิ่มขึ้นด้วย แต่ต่างกันมากเกินไปในแต่ละรอบบน laptop ที่ใช้ร่วมกับงานอื่น จนยกตัวเลขมาไม่ได้ ส่วน update ก็ต้องจ่ายเหมือนกัน: HOT (heap-only tuple) update ไม่ต้องสร้าง index entry ใหม่ แต่จะทำได้ก็ต่อเมื่อไม่มี column ไหนที่มี index ถูกเปลี่ยน และ page ของ row ยังมีที่ว่าง การเปลี่ยน `total_thb` ของ order บน page 123 เป็น HOT update แต่การเปลี่ยน `customer_id` ของมันไม่ใช่ ทั้งที่ row version ใหม่ก็ใส่ลง page เดิมได้

**index ต้องการการดูแล** row ที่ถูก delete และ update ทิ้ง entry ที่ชี้ไปยัง row version ที่ตายแล้วไว้ VACUUM เป็นคนลบมันออก และระหว่างรอบ vacuum ตัว B-tree ก็ลบ entry แบบนี้เองด้วยตอนที่ page กำลังจะ split (simple และ bottom-up index deletion) ส่วน B-tree page ที่ว่างหมดจะถูกเอากลับมาใช้ใหม่ แต่ page ที่เหลือ key ที่ยังมีชีวิตอยู่ไม่กี่ตัวยังถูกจองไว้ index ที่เสีย row ไปเกือบหมดเลยไม่หดลงจนกว่า `REINDEX` จะ build มันใหม่

## ลองรันดู

ข้อมูลตัวอย่างมาจาก [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop) ที่เป็น script สร้าง template database `acme` บน PostgreSQL 18 ในเวลาราวหนึ่งนาที

รันบนสำเนาใหม่ของข้อมูลตัวอย่าง Acme Shop (PostgreSQL 18) ส่วน comment แสดงบรรทัดสำคัญของ output

```sql
-- CREATE DATABASE btree_try TEMPLATE acme;   -- then connect to btree_try

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, status, created_at, total_thb FROM orders WHERE customer_id = 42;
-- Gather (actual rows=179.00)   Workers Launched: 2
--   ->  Parallel Seq Scan on orders   Filter: (customer_id = 42)
--         Rows Removed by Filter: 166607   (per process, x 3 = 499,821)
--         Buffers: shared read=5058         (hit=5058 once cached)

CREATE INDEX ON orders (customer_id);         -- orders_customer_id_idx

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, status, created_at, total_thb FROM orders WHERE customer_id = 42;
-- Bitmap Heap Scan on orders (actual rows=179.00)
--   Heap Blocks: exact=175
--   Buffers: shared hit=178 read=3          (178 on later runs: 3 index + 175 heap)
--   ->  Bitmap Index Scan on orders_customer_id_idx   Index Searches: 1

CREATE EXTENSION IF NOT EXISTS pageinspect;
SELECT root, level FROM bt_metap('orders_customer_id_idx');
-- 286 | 2                                    root page 286, three levels
SELECT live_items, free_size, btpo_prev, btpo_next
FROM bt_page_stats('orders_customer_id_idx', 14);
-- 17 | 104 | 13 | 15                         leaf 14: 104 bytes free, linked to 13 and 15
SELECT pg_relation_size('orders_customer_id_idx') / 8192 AS pages;
-- 705

CREATE INDEX ON orders (status);
EXPLAIN SELECT id FROM orders WHERE status = 'delivered';
-- Seq Scan on orders   Filter: (status = 'delivered'::text)
EXPLAIN SELECT id FROM orders WHERE status = 'pending';
-- Index Scan using orders_status_idx on orders
```

## ใช้ตอนไหนดี

- **column ที่ selective และใช้ filter, join หรือ sort:** foreign key อย่าง `orders.customer_id`, lookup key และ timestamp ที่อ่านเป็นช่วง ตัว B-tree รองรับ `=`, `<`, `<=`, `>=`, `>`, `BETWEEN`, `IN`, `IS NULL` และ output ที่เรียงแล้ว รวมถึง `LIKE 'abc%'` ด้วย ถ้า database ใช้ C locale หรือ index มี pattern operator class
- **foreign key ที่ใช้ query** ตัว PostgreSQL ไม่ทำ index ให้มันเอง และ index นี้ยังช่วยให้การลบลูกค้าหรือการเปลี่ยน key ของลูกค้าเร็วขึ้น เพราะถ้าไม่มี index ก็ต้อง scan `orders` เพื่อเช็กว่ามี row ที่อ้างอิงอยู่หรือเปล่า
- **ไม่เหมาะกับค่าที่ row ส่วนใหญ่มีเหมือนกัน** `status = 'delivered'` ไม่ใช้ `orders_status_idx` ถ้ามีแค่ status ที่นาน ๆ เจอทีเท่านั้นที่ถูก query ก็ทำ partial index เฉพาะค่าพวกนั้น ขนาดจะเหลือแค่เศษเสี้ยว ([index types](../index-types/))
- **หลายเงื่อนไข หรือไม่ต้องเข้า table เลย:** [composite index](../composite-index/) ตอบ query บน leading column ของมัน ส่วน [covering index](../covering-index/) ตอบได้จาก index อย่างเดียว ถ้ามีแค่ equality ก็ใช้ hash index ได้ แต่มีแค่ลำดับของ B-tree ที่ใช้กับ range และการ sort ได้ (เทียบกับ [hash table](../hash-table/))
- **เช็ก plan อย่าเดาจากความตั้งใจ:** รัน `EXPLAIN (ANALYZE, BUFFERS)` กับ query จริงด้วยค่าจริง ส่วนวิธีอ่าน output อยู่ใน [query execution plans](../query-execution-plans/)

## ได้อะไร เสียอะไร

- **ทุกการเขียนต้องดูแลทุก index** index แต่ละตัวเพิ่ม WAL record หนึ่งตัวกับการไต่จาก root ลงไปถึง leaf หนึ่งรอบต่อ row ที่ insert (WAL 8.5 → 12.4 → 15.6 MB ข้างบน) แล้วยังมี page split ซ้อนเข้ามาอีก
- **พื้นที่** 5.5 MB สำหรับ `orders_customer_id_idx`, 3.4 MB สำหรับ `orders_status_idx` และ 11 MB สำหรับ primary key บน table ขนาด 40 MB บวกกับที่ว่างที่ split และ delete ทิ้งไว้
- **เสีย HOT update** การทำ index บน column ที่เปลี่ยนบ่อยทำให้ heap-only update ที่ต้นทุนต่ำกลายเป็น update ของทุก index บน table
- **การ build บล็อกการเขียน** `CREATE INDEX` แบบธรรมดาบล็อก insert, update และ delete บน table จนกว่าจะเสร็จ ส่วนการอ่านยังทำต่อได้ ถ้าใช้ `CREATE INDEX CONCURRENTLY` การเขียนจะไหลต่อได้ แต่มันต้อง scan table สองรอบ รอ transaction ที่กำลังรันอยู่ รันใน transaction block ไม่ได้ และถ้า fail ก็จะทิ้ง index ที่เป็น `INVALID` ไว้ ให้ drop แล้ว build ใหม่
- **index ที่ไม่มีใครใช้ก็มีต้นทุนเท่ากับตัวที่ใช้** `pg_stat_user_indexes.idx_scan` นับว่าแต่ละ index ถูกค้นไปกี่ครั้งนับตั้งแต่ statistics ถูก reset ครั้งล่าสุด ตัวไหนค้างอยู่ที่ 0 ตลอดทั้งรอบธุรกิจก็เป็นตัวเลือกสำหรับ `DROP INDEX`

## ข้อควรรู้ตอนลงมือทำ

**วัดด้วย buffer** ใน PostgreSQL 18 ตัว `EXPLAIN ANALYZE` รายงานจำนวน buffer ให้โดยไม่ต้องขอ และ index scan ก็รายงาน `Index Searches` ด้วย ส่วน `pageinspect` (`bt_metap`, `bt_page_stats`, `bt_page_items`) แสดงตัว page ออกมาให้ดูตรง ๆ ตัว Amazon RDS for PostgreSQL มีมันอยู่ในรายการ extension (เวอร์ชัน 1.13 บน PostgreSQL 18) แต่ [Aurora PostgreSQL](../amazon-rds-aurora/) ไม่มีมันในรายการสำหรับเวอร์ชันปัจจุบัน ที่นั่นเลยต้องใช้ `EXPLAIN` กับ statistics view แทน

**หา index ที่ไม่มีใครใช้** (unique index ให้เก็บไว้ เพราะมันบังคับ constraint อยู่ แม้จะไม่เคยถูกค้นเลยก็ตาม):

```sql
SELECT s.indexrelid::regclass AS index, s.idx_scan,
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS size
FROM pg_stat_user_indexes s
JOIN pg_index i USING (indexrelid)
WHERE s.idx_scan = 0 AND NOT i.indisunique
ORDER BY pg_relation_size(s.indexrelid) DESC;
```

**build บน table ที่ใช้งานอยู่ด้วย `CONCURRENTLY`:** รัน `CREATE INDEX CONCURRENTLY orders_customer_id_idx ON orders (customer_id);` นอก transaction แล้วเช็กว่า `\d orders` ไม่ได้ติดป้าย `INVALID` ให้มัน

**MySQL (InnoDB, 8.4) จัด table แบบ clustered ตาม primary key** ตัว row อยู่ใน leaf ของ B-tree ของ primary key ถ้าไม่มี primary key ตัว InnoDB จะใช้ `UNIQUE` index ตัวแรกที่ทุก column เป็น `NOT NULL` และถ้าไม่มีอีกก็ใช้ index ของ row ID ที่ซ่อนไว้ ตัว secondary index เก็บ column ที่ทำ index บวกกับ primary key ทำให้ `WHERE customer_id = 42` ค้น secondary index ก่อน แล้วค่อยหาแต่ละ row ใน clustered index ด้วย primary key ของมัน ส่วน TID ของ PostgreSQL ชี้ตรงไปที่ heap page และ table ของมันก็ไม่มีลำดับในตัวเอง เพราะแบบนี้ primary key ที่ยาวเลยทำให้ secondary index ทุกตัวของ InnoDB ใหญ่ขึ้น นอกจากนี้ MySQL ยังบังคับให้มี index บน column ที่เป็น foreign key และสร้างให้เองถ้ายังไม่มี ตรงข้ามกับ PostgreSQL

**SQL Server มีให้ทั้งสองแบบ** ถ้า table มี clustered index ก็จะเก็บ row ไว้ใน index นั้น (โดย default primary key จะกลายเป็น clustered index) ส่วน table ที่ไม่มีก็เป็น heap ตัว nonclustered index หา row ของมันด้วย clustered key หรือด้วย pointer ไปที่ row บน heap แบบหลังนี้ใกล้เคียงกับ TID ของ PostgreSQL ที่สุด และที่นั่นการสร้าง foreign key ก็ไม่ได้สร้าง index ให้เหมือนกัน

index ของ **MongoDB** ก็เป็น B-tree เหมือนกัน ([MongoDB](../mongodb/)) และคู่มือของมันก็พูดเรื่องการเขียนไว้แบบเดียวกัน: ทุก insert ต้อง update ทุก index ของ collection
