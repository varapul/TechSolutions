## ปัญหา

นักวิเคราะห์ของ Acme Shop อยากได้ตัวเลขหนึ่งตัวต่อหนึ่งหมวดสินค้า: ยอดขายจาก order item ทุกรายการที่เคยขายมา

```sql
SELECT p.category, sum(i.qty * i.price_thb) AS revenue
FROM order_items i JOIN products p ON p.id = i.product_id
GROUP BY p.category ORDER BY revenue DESC;
```

query นี้ใช้สามจากห้า column ของ `order_items` (`product_id`, `qty` และ `price_thb`) กับสอง column ของ `products` แต่ [PostgreSQL](../postgresql/) 18.6 ดึงมาเฉพาะ column พวกนั้นไม่ได้ เพราะมันเก็บทุก row ไว้ทั้งก้อน plan ของมันคือ `Gather Merge` ที่ครอบ parallel worker สองตัว: รวมกับ leader ก็เป็นสาม process ที่แบ่งกันทำ `Parallel Seq Scan` ของ heap page ทั้ง 10,417 page ของ `order_items` (81 MB) แต่ละ process อ่าน `products` 94 page เพื่อสร้าง hash table ของตัวเอง แล้ว row 1,250,000 ตัวก็ผ่าน `Hash Join` กับ `Partial HashAggregate` จนเหลือ 12 row ทั้งหมดนี้ใช้เวลาราว 130 ms และ 330 ms ตอนปิด parallel query (median ของการรันเก้ารอบบน laptop โดยไม่รวม overhead ของ `EXPLAIN` เอง) ต้นทุนนี้โตขึ้นตามทุก row และทุก column ที่ table มีเพิ่ม ไม่ว่านักวิเคราะห์จะถามอะไร

`pageinspect` แสดงให้เห็นว่า byte ไปอยู่ตรงไหนบ้าง heap page 0 เก็บ 120 row และแต่ละ row กินพื้นที่ของ page ไป 68 byte: line pointer 4 byte ใกล้หัว page และจากท้าย page ย้อนกลับมาคือ tuple header 23 byte ที่ pad เป็น 24 (`t_hoff`), ค่าจริง 31 byte, padding 4 byte ที่ทำให้ `product_id` เริ่มที่ขอบ 8 byte และอีก 5 byte ที่จัด alignment ให้ row ถัดไป query ใช้แค่ 19 จาก 68 byte นี้ (28%): `product_id` (8), `qty` (4) และ `price_thb` (เป็น `numeric` ที่ตรงนี้ใช้ 7 byte) ตัว PostgreSQL อ่านและ cache page ขนาด 8 kB ทั้ง page ทำให้อีก 49 byte ของทุก row ติดมาด้วย

## ทำงานยังไง

**วางข้อมูลแบบ row** ตัว row store เก็บค่าของแต่ละ row ไว้ติดกัน ใน heap ของ PostgreSQL หนึ่ง row คือหนึ่ง tuple บนหนึ่ง page และหาเจอได้จากที่อยู่ `(page, item)` ของมัน: บรรทัดแรกของ order 2 คือ `(0,4)` การอ่านหรือเปลี่ยน row หนึ่งตัวแตะแค่ heap page เดียวกับ index page ที่พาไปถึงมัน งานแบบนี้คือสิ่งที่ transaction ทำกันทั้งวัน ส่วน scan เพื่อ analytics ต้องอ่านทุก page

**วางข้อมูลแบบ column** ตัว column store เก็บค่าของแต่ละ column ไว้ติดกัน เพื่อเทียบกัน เราเอา table สามตัวเดิมใส่ DuckDB 1.5.6 ที่เป็น column store แบบ embedded โดย load จาก CSV ที่ export ออกมาในลำดับเดิม ตัว DuckDB ตัด table เป็น row group ละไม่เกิน 122,880 row (ที่นี่มี group เต็ม ๆ สิบ group กับอีกหนึ่ง group ที่มี 21,200 row) แล้วเก็บแต่ละ column ของ row group เป็น column segment แยกกันใน block ขนาด 256 kB ตัว scan ระบุ column ที่ต้องใช้ และ plan ของ query ข้างบนก็แสดงไว้สามตัวพอดี: `TABLE_SCAN order_items, Projections: product_id, qty, price_thb`

**การบีบอัด** ค่าใน column เดียวกันมี type เดียวกันและมักอยู่ในช่วงแคบ ๆ แต่การเก็บแบบ row เอาค่าพวกนี้ไปสลับปนกับค่าอื่นทั้งหมด ตัว DuckDB วิเคราะห์แต่ละ segment ตอนที่เขียนมัน แล้วเก็บวิธีที่ได้ขนาดเล็กที่สุดไว้ ส่วน `pragma_storage_info` แสดงว่ามันเลือกอะไร:

| Column | PostgreSQL | segment ของ DuckDB | bit ต่อค่า | ทำไมถึง pack ได้ |
|---|---|---|---|---|
| `order_id` | 8 byte | bit-packing, `DELTA_FOR` | ราว 1 | เรียงอยู่แล้ว แต่ละขั้นเพิ่ม 0 หรือ 1 |
| `line_no` | 4 byte | bit-packing, `FOR` | 2 | ค่า 1 ถึง 4 |
| `product_id` | 8 byte | bit-packing, `FOR` | 14 | ค่า 1 ถึง 10,000 |
| `qty` | 4 byte | bit-packing, `FOR` | 2 | ค่า 1 ถึง 3 |
| `price_thb` | 7 byte (`numeric`) | bit-packing, `FOR` | 20 | 59.53 ถึง 9,998.89 เก็บเป็นจำนวนเต็มหน่วยสตางค์ |
| `products.category` | text | dictionary | ราว 4 | มี 12 ชื่อที่ไม่ซ้ำกัน |

Frame of reference (`FOR`) เก็บค่าต่ำสุดของแต่ละกลุ่ม 2,048 ค่าไว้ครั้งเดียว แล้วเก็บทุกค่าเป็นระยะห่างจากค่านั้น โดยใช้ bit น้อยที่สุดเท่าที่ระยะห่างที่มากที่สุดต้องใช้ ส่วน `DELTA_FOR` ทำแบบเดียวกันกับผลต่างระหว่างค่าที่อยู่ติดกัน ใน DuckDB ตัว `DECIMAL(10,2)` คือ integer 64 bit ราคาก็เลย pack ได้เหมือน integer ตัวอื่น ๆ validity mask ของ column ที่เป็น `NOT NULL` ถูกบีบอัดเหลือแค่ค่าคงที่ ตัว `products.id` (1 ถึง 10,000 เรียงกัน) เหลือ 112 byte ส่วน `sku` กับ `name` ใช้ FSST ที่เป็น dictionary ของ substring ที่เจอบ่อย วิธีอื่น ๆ ที่มันมีก็เช่น run-length encoding (ต้องมีค่าเดียวกันเรียงกันยาว ๆ และที่นี่ไม่เจอเลย), ALP สำหรับเลข floating-point และ Zstd สุดท้ายตัว `order_items` มีขนาด 6.7 MB ในไฟล์ DuckDB ของมันเอง เทียบกับ heap 81 MB

**การรันแบบ vectorised** executor ของ PostgreSQL ดึง row ผ่าน plan: การเรียก plan node แต่ละครั้งคืนมาหนึ่ง row และทุก `qty * price_thb` ถูกคำนวณด้วย type `numeric` ที่ความละเอียดไม่จำกัด ส่วน operator ของ DuckDB รับ vector ละไม่เกิน 2,048 ค่า: row 1,250,000 ตัวออกจาก scan เป็น 611 vector และการเรียก operator แต่ละครั้งก็เป็น loop สั้น ๆ ที่วนบน array ของ integer 64 bit ไอเดียนี้ย้อนไปถึง MonetDB/X100 (Boncz, Zukowski และ Nes, CIDR 2005) ส่วน SQL Server เรียกมันว่า batch mode ผลของมันเห็นได้แม้บน thread เดียว: 11 ms เทียบกับ 330 ms คือต่างกัน 30 เท่า มากกว่าที่การลด byte ลง 13 เท่าจะอธิบายได้

**late materialisation** ใน column store หนึ่ง row เป็นแค่ตำแหน่งที่ column segment ของมันใช้ร่วมกัน engine จะ filter และ join ด้วย column ไม่กี่ตัวที่ตัดสินว่า row ไหนรอด แล้วค่อยประกอบ row เต็ม ๆ จาก column ที่เหลือตอนท้ายสุด เฉพาะ row ที่รอดเท่านั้น survey เรื่อง column store ของ Abadi, Boncz, Harizopoulos, Idreos และ Madden (2013) เรียกวิธีนี้ว่า late materialisation และอธิบายไว้คู่กับ vectorised processing และการทำงานบนข้อมูลที่ยังบีบอัดอยู่ ส่วน row store มี row ทั้ง row อยู่ในมือตั้งแต่อ่านครั้งแรก เลยไม่มีอะไรให้เลื่อนไปทำทีหลัง

**zone map** DuckDB เก็บค่าต่ำสุดและสูงสุดของทุก segment ไว้ และข้าม segment ที่ filter ตัดทิ้งได้ ตัว `order_id` เรียงอยู่แล้ว zone map เลยแคบ: row group 0 เก็บ order 1 ถึง 49,152, row group 9 เก็บ order 442,369 ถึง 491,520 และ row group 10 เก็บที่เหลือจนถึง 500,000 สำหรับยอดขายเดือนกันยายน 2026 ตัว join สร้าง hash table จาก order 23,436 ตัวของเดือนกันยายน แล้วส่งช่วง id ของมันไปให้ scan ของ `order_items` (`order_id>=475224 AND order_id<=498664` ใต้ *Dynamic Filters* ใน plan) มี row group สองตัวที่ทับกับช่วงนั้น scan เลยอ่านแค่ 144,080 จาก 1,250,000 row (`OPERATOR_ROWS_SCANNED` ของ profiler) ส่วน `orders` ถูก zone map ของ `created_at` ตัดเหลือ 67,872 จาก 500,000 row และทั้ง query อ่าน 9 block (2.25 MB) ตอน cold ในเวลา 2 ms ขณะที่ PostgreSQL อ่านครบทั้ง 15,569 page ของทั้งสาม table ใน 47 ms ตัว zone map ช่วยได้เฉพาะ column ที่ถูกเก็บเรียงตามลำดับที่ใกล้เคียงกับที่เรา filter ส่วนของที่เทียบเท่ากันใน PostgreSQL แบบที่ต้องเปิดใช้เองคือ BRIN index ที่เก็บค่าต่ำสุดและสูงสุดของทุกช่วง 128 page โดย default ([index types](../index-types/))

**สิ่งที่การรันวัดได้** (PostgreSQL ใน Docker container และ DuckDB ใน Python บน laptop 8 core เครื่องเดียวกัน ทั้งคู่มีข้อมูลอยู่ใน memory แล้ว เวลาเป็น median ของการรันเก้ารอบ):

| | PostgreSQL 18.6, heap | DuckDB 1.5.6, column |
|---|---|---|
| `order_items` บน disk | 10,417 page, 81 MB | 6.7 MB |
| ที่ query อ่าน | 10,511 page, 82 MB | 25 block, 6.25 MB |
| เวลา, ค่า default | 130 ms (2 worker) | 5 ms (8 thread), 10 ms ตอน cold |
| เวลา, core เดียว | 330 ms | 11 ms |
| เฉพาะเดือนกันยายน | 15,569 page, 47 ms | 2 จาก 11 row group, 2.25 MB, 2 ms |
| row เดียวตาม key, cold | 4 page, 32 kB | 4 block, 1 MB; scan 122,880 key |
| `UPDATE` `qty` ตัวเดียว | version ใหม่ + index entry; [WAL](../write-ahead-log/) 235 B | WAL 147 B แล้ว 266,240 B ตอน `CHECKPOINT` |

**การเขียนกลับด้านกัน** `UPDATE order_items SET qty = 3 WHERE order_id = 2 AND line_no = 1` ทำให้ PostgreSQL เสียการไล่ index ลงไปหนึ่งรอบ (4 page: สามชั้นของ `order_items_pkey` กับ heap page) และ row version ใหม่ขนาด 59 byte ตัว heap page 0 เหลือที่ว่างแค่ 8 byte ทำให้ version ใหม่ไปอยู่ที่ page สุดท้ายเป็น `(10416,81)` และเพราะมันย้ายออกจาก page เดิม update นี้เลยเป็น HOT update ไม่ได้: primary key ต้องได้ entry ใหม่ด้วย รวมเป็น WAL สาม record, 235 byte (21 kB ถ้าเป็นการเปลี่ยนครั้งแรกของ page พวกนั้นหลัง checkpoint เพราะตอนนั้นจะ log ทั้ง page) ส่วน version เก่ายังค้างอยู่รอ VACUUM ([MVCC](../mvcc/)) ฝั่ง DuckDB หา row เจอโดยไม่ใช้ index ของ primary key: plan เป็น scan ของ `order_id` กับ `line_no` ที่ zone map บีบให้เหลือ row group 0 คือ 122,880 key มันเก็บค่าใหม่ไว้ใน memory ข้าง ๆ segment (`has_updates` กลายเป็น true) และ log 147 byte ลง WAL ของมัน แล้ว `CHECKPOINT` ครั้งถัดไปก็ encode segment `qty` ของ row group 0 ใหม่ทั้งก้อน ครบทั้ง 122,880 ค่า ลง block ใหม่ โดยเขียนไป 266,240 byte การเขียนใหม่นี้จ่ายกันเป็น segment ไม่ใช่เป็น row: update ทีละ row แบบสุ่ม 1,000 ครั้ง ครั้งละราว 0.3 ms ทิ้ง WAL ไว้ 136 kB แล้ว checkpoint ครั้งถัดไปก็เขียน segment `qty` ใหม่ครบทั้ง 11 ตัว รวม 528,384 byte สรุปคือ column store อยากได้การเปลี่ยนเป็น batch แล้ว C-Store ที่เป็น design ทรงอิทธิพลจากปี 2005 ของ Stonebraker และทีมก็ส่ง insert และ update ไปที่ writeable store ขนาดเล็ก แล้วให้ *tuple mover* ค่อย merge ทีละก้อนใหญ่เข้า column store ที่ optimise ไว้สำหรับการอ่าน ส่วน deltastore ของ SQL Server และการ merge part อยู่เบื้องหลังของ ClickHouse ก็ใช้แผนเดียวกัน

## ลองรันดู

ข้อมูลตัวอย่างมาจาก [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop) ที่เป็น script สร้าง template database `acme` บน PostgreSQL 18 ในเวลาราวหนึ่งนาที

รันชุดนี้ใน `psql` บนสำเนาใหม่ ตัว comment แสดงบรรทัดสำคัญของ output และบรรทัด `\copy` จะเขียนไฟล์ CSV สามไฟล์ไว้ใน folder ที่คุณอยู่:

```sql
-- CREATE DATABASE rowcol_try TEMPLATE acme;   -- then connect to rowcol_try

EXPLAIN (ANALYZE, BUFFERS)
SELECT p.category, sum(i.qty * i.price_thb) AS revenue
FROM order_items i JOIN products p ON p.id = i.product_id
GROUP BY p.category ORDER BY revenue DESC;
-- Gather Merge   Workers Launched: 2
--   ->  Partial HashAggregate (actual rows=12.00 loops=3)
--         ->  Hash Join (actual rows=416666.67 loops=3)
--               ->  Parallel Seq Scan on order_items i
--                     Buffers: shared hit=2048 read=8369    (10,417 pages between 3 processes)
--               ->  Hash  ->  Seq Scan on products p
--                     Buffers: shared hit=282               (94 pages, once per process)

SELECT pg_relation_size('order_items') / 8192 AS pages,
       pg_size_pretty(pg_relation_size('order_items')) AS size;
-- 10417 | 81 MB

CREATE EXTENSION IF NOT EXISTS pageinspect;
SELECT lp, lp_off, lp_len, t_hoff
FROM heap_page_items(get_raw_page('order_items', 0)) WHERE lp BETWEEN 2 AND 6;
-- 2 | 8064 | 59 | 24      a 24-byte header and 35 bytes of data, rows 64 bytes apart
-- 3 | 8000 | 59 | 24
SELECT lower, upper FROM page_header(get_raw_page('order_items', 0));
-- 504 | 512               24-byte page header + 120 line pointers of 4 bytes; 8 bytes free

\copy (SELECT * FROM order_items ORDER BY order_id, line_no) TO 'order_items.csv' CSV HEADER
\copy (SELECT * FROM products ORDER BY id) TO 'products.csv' CSV HEADER
\copy (SELECT * FROM orders ORDER BY id) TO 'orders.csv' CSV HEADER

EXPLAIN (ANALYZE, BUFFERS, WAL, COSTS OFF)
UPDATE order_items SET qty = 3 WHERE order_id = 2 AND line_no = 1;
-- Update on order_items   WAL: records=3 bytes=235
--   ->  Index Scan using order_items_pkey on order_items
SELECT ctid FROM order_items WHERE order_id = 2 AND line_no = 1;
-- (10416,81)               page 0 was full, so the new version went to the last page
```

จากนั้น load ไฟล์ CSV เข้า DuckDB 1.5 (`python3 -m venv duck && duck/bin/pip install duckdb`) แล้วรัน statement พวกนี้ใน folder เดียวกัน ทีละตัวด้วย `duckdb.sql(...)` ใน Python หรือใน command-line client ของ DuckDB:

```sql
ATTACH 'acme.duckdb' AS acme;
USE acme;
SET threads = 1;     -- load in one pass, so row groups fill up in key order
CREATE TABLE products (id BIGINT PRIMARY KEY, sku VARCHAR NOT NULL UNIQUE, name VARCHAR NOT NULL,
                       category VARCHAR NOT NULL, price_thb DECIMAL(10,2) NOT NULL);
CREATE TABLE order_items (order_id BIGINT NOT NULL, line_no INTEGER NOT NULL,
                          product_id BIGINT NOT NULL, qty INTEGER NOT NULL,
                          price_thb DECIMAL(10,2) NOT NULL, PRIMARY KEY (order_id, line_no));
CREATE TABLE orders (id BIGINT PRIMARY KEY, customer_id BIGINT NOT NULL, status VARCHAR NOT NULL,
                     shipping_country VARCHAR NOT NULL, created_at TIMESTAMPTZ NOT NULL,
                     total_thb DECIMAL(12,2) NOT NULL);
INSERT INTO products SELECT * FROM 'products.csv';
INSERT INTO order_items SELECT * FROM 'order_items.csv';
INSERT INTO orders SELECT * FROM 'orders.csv';
CHECKPOINT;
RESET threads;
SET TimeZone = 'UTC';

SELECT column_name, compression, max(segment_info) AS info, count(*) AS segments
FROM pragma_storage_info('order_items') WHERE segment_type <> 'VALIDITY'
GROUP BY ALL ORDER BY column_name;
-- line_no    | BitPacking | FOR: 60       | 11
-- order_id   | BitPacking | DELTA_FOR: 60 | 11
-- price_thb  | BitPacking | FOR: 50       | 21    (two segments per row group)
-- product_id | BitPacking | FOR: 60       | 11
-- qty        | BitPacking | FOR: 60       | 11

EXPLAIN ANALYZE
SELECT p.category, sum(i.qty * i.price_thb) AS revenue
FROM order_items i JOIN products p ON p.id = i.product_id
GROUP BY p.category ORDER BY revenue DESC;
-- TABLE_SCAN order_items   Projections: product_id, qty, price_thb   1,250,000 rows
--   -> HASH_JOIN product_id = id -> HASH_GROUP_BY -> 12 rows

EXPLAIN ANALYZE
SELECT p.category, sum(i.qty * i.price_thb) AS revenue
FROM order_items i JOIN orders o ON o.id = i.order_id JOIN products p ON p.id = i.product_id
WHERE o.created_at >= '2026-09-01' AND o.created_at < '2026-10-01'
GROUP BY p.category ORDER BY revenue DESC;
-- TABLE_SCAN order_items   Dynamic Filters: order_id>=475224 AND order_id<=498664   58,601 rows

UPDATE order_items SET qty = 3 WHERE order_id = 2 AND line_no = 1;
SELECT block_id, block_offset, has_updates FROM pragma_storage_info('order_items')
WHERE column_name = 'qty' AND segment_type = 'INTEGER' AND row_group_id = 0;
-- 7 | 31448 | true        the change waits in memory
CHECKPOINT;
SELECT block_id, block_offset, has_updates FROM pragma_storage_info('order_items')
WHERE column_name = 'qty' AND segment_type = 'INTEGER' AND row_group_id = 0;
-- 186 | 0 | false         the whole segment was written again, to a new block
```

## ใช้ตอนไหนดี

- **row store สำหรับ OLTP:** transaction สั้น ๆ จำนวนมากที่ insert, อ่าน และเปลี่ยน row ทั้ง row ตาม key ภายใต้ concurrency โดยมี index และ row-level lock นี่คือถิ่นของ PostgreSQL, MySQL และ SQL Server และ checkout ของ Acme Shop ก็อยู่ตรงนี้
- **column store สำหรับ analytics:** scan และ aggregation บน row หลักล้านที่แตะทีละไม่กี่ column, ข้อมูลที่ load เป็น batch และข้อมูลที่บีบอัดได้ดีเพราะเรียงอยู่แล้วหรือมีค่าซ้ำ ๆ ตัวอย่างคือ DuckDB ที่ฝังอยู่ใน application หรือ notebook, ClickHouse และ warehouse อย่าง Amazon Redshift กับ Google BigQuery ที่เก็บ table เป็น column
- **ไฟล์แบบ columnar สำหรับ data lake:** Parquet ใช้ไอเดียเดียวกันในรูปไฟล์ มี row group, column chunk และ encoding แยกต่อ column ทำให้ engine ไหนก็อ่านเฉพาะ column ที่ต้องใช้จาก object storage อย่าง [Amazon S3](../amazon-s3/) ได้ พอ export ด้วย DuckDB แบบค่า default (บีบอัดด้วย Snappy) ตัว `order_items` กลายเป็นไฟล์ 8.5 MB ที่สาม column ของ query ใช้ไป 5.4 MB และ query เดียวกันบนไฟล์นี้ใช้เวลา 6 ms
- **table กว้าง ๆ ได้ประโยชน์มากที่สุด** `order_items` มีห้า column แคบ ๆ ทำให้ 13 เท่าส่วนใหญ่มาจากการบีบอัดและการตัด overhead ต่อ row ทิ้ง ส่วน fact table ที่มีสี่สิบ column แต่ report อ่านแค่สี่ตัว จะได้ประโยชน์จากการข้าม column มากกว่านี้เยอะ
- **บางทีก็ไม่ต้องมี engine ที่สอง** ถ้า report ตายตัว [materialized view](../materialized-view/) หรือ summary table ที่ refresh ใน PostgreSQL ก็อาจพอแล้ว ถ้าการอ่านและการเขียนต้องการข้อมูลคนละรูปแบบ [CQRS](../cqrs/) ก็เก็บ read model ไว้ข้าง write model ส่วน column store แยกจะคุ้มก็ตอนที่นักวิเคราะห์ถามคำถามใหม่ ๆ กับข้อมูลขนาดใหญ่

## ได้อะไร เสียอะไร

- **การเขียนทีละ row แพงกว่า** ค่าที่เปลี่ยนแค่ค่าเดียวทำให้ต้องเขียน segment 122,880 ค่าใหม่ทั้งก้อนตอน checkpoint ครั้งถัดไป (266,240 byte เทียบกับ dirty page 3 page ของ PostgreSQL) และทุก insert ต้องเพิ่มข้อมูลลง column segment ห้าตัวแทนที่จะเป็น row เดียว ตัว documentation ของ DuckDB เองก็แนะนำว่าไม่ควร load ข้อมูลด้วย `INSERT` ทีละ row จำนวนมาก แต่ให้ใช้ bulk load หรือถ้าทำไม่ได้ก็ใช้ transaction ใหญ่ ๆ
- **point lookup ต้องแตะทุก column** การอ่านบรรทัดแรกของ order 2 ตอน cold ทำให้ DuckDB เสีย 4 block (1 MB) เพราะแต่ละ column อยู่คนละ segment ส่วน PostgreSQL อ่าน 4 page (32 kB) ผ่าน B-tree ([B-tree index](../b-tree-index/))
- **เขียนได้ทีละ process เดียว** ไฟล์ database ของ DuckDB เปิดแบบ read-write ได้ทีละ process หรือเปิดแบบ read-only ได้หลาย process ส่วนภายใน process นั้น transaction รันภายใต้ MVCC ด้วย [optimistic concurrency control](../optimistic-concurrency/) และถ้ามีสอง transaction เปลี่ยน row เดียวกันก็จะ conflict กัน แบบนี้เหมาะกับ analytics แต่ไม่เหมาะกับร้านค้าออนไลน์ที่วุ่น ๆ
- **index แพงกว่าตัวข้อมูล** primary key บน `order_items` ทำให้ DuckDB สร้าง ART index ขนาดราว 30 MB มากกว่าสี่เท่าของข้อมูลที่บีบอัดแล้ว 6.7 MB ตัว ART index มีไว้บังคับ key และรับ lookup ที่ selective มาก ๆ เป็นหลัก table สำหรับ analytics เลยมักไม่มี index พวกนี้
- **สองสำเนาค่อย ๆ ไม่ตรงกัน** analytics ใน column store แยกจะอ่านสำเนาของข้อมูลที่สดได้แค่เท่ากับ pipeline ที่เติมมัน: [change data capture](../change-data-capture/) stream การเปลี่ยนจาก write-ahead log ทันทีที่ commit ส่วน batch ELT load ใหม่ตาม schedule และมักผ่านชั้น bronze, silver และ gold ของ [medallion architecture](../medallion-architecture/) ไม่ว่าทางไหนก็ต้องมี pipeline ให้รัน, monitor และซ่อม และมี schema ที่ต้องคอยให้ตรงกัน
- **การบีบอัดและการข้ามขึ้นกับลำดับ** column ที่เรียงอยู่แล้วอย่าง `order_id` pack ได้ค่าละหนึ่ง bit และได้ zone map ที่แคบ ส่วน key แบบสุ่มอย่าง UUID pack ได้ไม่ดี และทำให้ zone map ข้ามอะไรได้น้อย

## ข้อควรรู้ตอนลงมือทำ

**PostgreSQL** เก็บ table ใน heap ถ้า table access method ไม่ได้กำหนดเป็นอย่างอื่น และ interface ของ access method ก็ให้ extension เสียบ layout แบบอื่นเข้ามาได้ ตัว access method `columnar` ของ Citus เก็บ table ที่สร้างด้วย `USING columnar` เป็น column และบีบอัดไว้ ใน stripe ละไม่เกิน 150,000 row (และไม่เกินข้อมูลของหนึ่ง transaction) ส่วน `pg_duckdb` รัน engine แบบ columnar และ vectorised ของ DuckDB ข้างใน PostgreSQL และอ่านไฟล์ Parquet, Iceberg และ Delta Lake ได้ ตัว TOAST ที่เป็นการบีบอัดในตัวของ PostgreSQL ทำงานกับค่าใหญ่ ๆ ทีละค่าเมื่อ row ใหญ่เกินราว 2 kB เลยไม่เคยบีบอัดทั้ง column ส่วน BRIN index ให้ zone map กับ heap สำหรับ column ที่เรียงตามลำดับทางกายภาพ เช่นเวลาที่สร้าง

**MySQL (InnoDB, 8.4)** ก็เป็น row store เหมือนกัน: row อยู่ใน leaf ของ B-tree ของ primary key ที่เรียกว่า clustered index โดยใช้ row format `DYNAMIC` เป็นค่า default แต่ละ record ใน clustered index พก header 5 byte บวก transaction id 6 byte และ roll pointer 7 byte สำหรับ MVCC ทำให้ scan เพื่อ analytics ก็ต้องจ่าย overhead ต่อ row ที่นี่เหมือนกัน

**SQL Server** มีให้ทั้งสอง layout ใน database เดียว ตัว clustered columnstore index เก็บทั้ง table เป็น column ใน rowgroup ละไม่เกิน 1,048,576 row ส่วนการเขียนเล็ก ๆ จะไปที่ deltastore ที่เป็น B-tree จนกว่า tuple-mover ที่ทำงานอยู่เบื้องหลังจะบีบอัดมันเป็น column segment ส่วน nonclustered columnstore index บน rowstore table ธรรมดาทำให้ analytics รันบนสำเนาแบบ column ได้ ขณะที่ transaction ก็ใช้ row กันไป แบบนี้ Microsoft เรียกว่า real-time operational analytics และ query บน columnstore index จะรันใน batch mode ที่เป็น vectorised execution ของมัน

**hybrid อื่น ๆ เก็บข้อมูลชุดเดียวกันไว้สองรูปแบบ** Oracle Database In-Memory เก็บ row ไว้ใน buffer cache และบน disk และเก็บสำเนาแบบ columnar ที่บีบอัดแล้วของ table ที่เลือกไว้ใน memory ส่วน TiDB replicate row จาก TiKV ไปยัง column replica ของ TiFlash แบบ asynchronous ผ่าน Raft learner ทำให้ query เชิง analytics อ่าน column ได้โดยไม่ต้องมี pipeline แยก

**warehouse และ lake** Amazon Redshift เก็บแต่ละ column ไว้ใน block ของตัวเอง ส่วน BigQuery เก็บ table ในรูปแบบ columnar ชื่อ Capacitor และ MergeTree ของ ClickHouse เขียนแต่ละ insert เป็น part ใหม่ที่เรียงตาม key ของ table และเก็บเป็น column แล้ว merge part ต่าง ๆ อยู่เบื้องหลัง design นี้ใกล้กับ [LSM tree](../lsm-tree/) ส่วน `ALTER TABLE … UPDATE` ของมันเป็น mutation ที่เขียน part ใหม่ทั้ง part และ documentation ก็ระบุว่าเป็น operation ที่หนัก ตัว Parquet encode แต่ละ column chunk แยกกัน ด้วย encoding แบบ plain, dictionary, run-length กับ bit-packing, delta และ byte-stream-split ส่วน Amazon [Aurora](../amazon-rds-aurora/) มี zero-ETL integration ที่ replicate cluster ของ Aurora เข้า Amazon Redshift แบบเกือบ real time แบบนี้ช่วยตัด pipeline ที่ไม่งั้นคุณต้องรันเองออกไปได้ แต่สำเนาที่สองก็ยังอยู่

**ไอเดียพวกนี้มาจากไหน** C-Store (Stonebraker, Abadi และทีม, VLDB 2005) เก็บข้อมูลเป็น column ใน sorted projection ที่ทับซ้อนกัน บีบอัดแต่ละ column และแยกการเขียนออกจากการอ่าน ส่วน MonetDB/X100 (CIDR 2005) เป็นตัวเริ่ม execution แบบทีละ vector และ survey ปี 2013 ของ Abadi, Boncz, Harizopoulos, Idreos และ Madden ก็รวมเทคนิคทั้งหมดไว้ด้วยกัน รายละเอียดที่เหลือมาจาก documentation ของ DuckDB: การบีบอัดต่อ segment, row group ละ 122,880 row, vector ละ 2,048 ค่า และ zone map บน column ของทุก type แบบ general-purpose
