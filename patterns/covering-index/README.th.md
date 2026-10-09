## ปัญหา

แอปมือถือของ Acme เปิดมาก็เจอ order ล่าสุดของลูกค้า และ list นี้แสดงแค่สาม column:

```sql
SELECT id, status, total_thb FROM orders
WHERE customer_id = 42 ORDER BY created_at DESC LIMIT 20;
```

ถ้ามี index บน `(customer_id, created_at)` ตัว PostgreSQL ก็หา entry 20 ตัวเจอได้เร็ว มันอ่าน root, internal page หนึ่ง page และ leaf page หนึ่ง page ที่ entry ล่าสุดของลูกค้า 42 อยู่เรียงติดกัน (ที่นี่คือ leaf page 58) แล้วเดินถอยหลังไปตาม leaf นั้น จากใหม่สุดก่อน แต่ entry ของ B-tree เก็บแค่ key กับที่อยู่ของ row คือ *tid* ของมัน (heap page และหมายเลข item) ถ้าจะคืน `id`, `status` และ `total_thb` ได้ ตัว scan ต้องอ่าน row แต่ละตัวจาก table และ order ของลูกค้า 42 ก็กระจายอยู่ใน table ปนกับของคนอื่น ๆ: row ทั้ง 20 ตัวอยู่บน 20 page ที่ต่างกันของ heap ขนาด 5,058 page หรือ 40 MB

บน PostgreSQL 18.6 คำสั่ง `EXPLAIN (ANALYZE, BUFFERS)` รายงาน `Buffers: shared hit=23`: index 3 page กับ heap 20 page คืออ่าน page ขนาด 8 kB เต็ม ๆ หนึ่ง page ต่อทุก row ตอนที่ทุกอย่างอยู่ใน cache ก็ยังรันเสร็จในเวลาต่ำกว่า 0.1 ms ไปมาก (รันครั้งหนึ่งบน laptop) แต่พอ page พวกนั้นไม่อยู่ใน memory แล้ว การเปิดหน้าจอนี้อาจต้องอ่านแบบ random 20 ครั้ง ส่วน query เดียวกันนี้ตอนที่ไม่มี index บน `customer_id` สักตัว อ่านครบทั้ง 5,058 page

## ทำงานยังไง

**covering index** เก็บทุก column ที่ query ใช้ ทำให้ PostgreSQL ตอบ query นั้นได้จาก index อย่างเดียวด้วย **index-only scan** ตั้งแต่ PostgreSQL 11 เป็นต้นมา clause `INCLUDE` เพิ่ม column เข้าไปใน B-tree index ในฐานะ payload: column พวกนี้ถูกเก็บในทุก entry แต่ไม่ได้เป็นส่วนหนึ่งของ key

```sql
CREATE INDEX orders_customer_covering_idx ON orders (customer_id, created_at)
  INCLUDE (id, status, total_thb);
```

- **key ยังเป็นตัวทำงานหลัก** `customer_id` กับ `created_at` เป็นตัวเรียง entry และใช้กับการค้นและการ sort ส่วน column ที่ include ไว้ก็ติดไปด้วยใน leaf entry ที่ในตัวอย่างนี้ขยายจาก 24 เป็น 56 byte ตัว root กับ internal page เก็บแค่ค่า key เพราะ suffix truncation ของ B-tree ตัด column ที่ไม่ใช่ key ออกจากชั้นบน ๆ เสมอ
- **ทุก column ต้องอยู่ครบ รวมถึง `id`** ตัว planner จะพิจารณา index-only scan ก็ต่อเมื่อทุก column ที่ query อ้างถึงอยู่ใน index ครบ ตัว index entry ของ PostgreSQL ไม่ได้พก primary key ไว้ (ของ InnoDB พก) ถ้ามีแค่ `INCLUDE (status, total_thb)` ตัว plan เลยยังเป็น `Index Scan` ที่ใช้ 23 buffer พอ include `id` เข้าไปด้วยก็กลายเป็น `Index Only Scan Backward` ที่มี `Heap Fetches: 0` และ `Buffers: shared hit=4`: index 3 page กับ visibility map 1 page
- **payload ไม่ใช่ key** column ที่ include ไว้ใช้เป็นเงื่อนไขค้นใน index ไม่ได้: พอเพิ่ม `AND status = 'cancelled'` ก็ได้ `Filter` ที่เช็กกับ entry ทั้ง 179 ตัวของลูกค้า 42 (ตัดออก 175 ตัว โดยยังไม่ต้องแตะ heap) ไม่ใช่ `Index Cond` และ column พวกนี้ก็ไม่ได้ให้ลำดับด้วย: `ORDER BY total_thb` ทำให้มี `Sort` ครอบ row 179 ตัว ส่วนใน `UNIQUE` index พวกมันไม่มีส่วนในการเช็ก uniqueness
- **visibility map ตัดสินว่าจะข้าม heap ได้ไหม** index entry ไม่มีข้อมูล visibility: row version ไหน visible กับ snapshot ไหน ถูกบันทึกไว้ใน heap เท่านั้น PostgreSQL เลยเก็บ **visibility map** ไว้ให้ทุก table ใช้สอง bit ต่อ heap page โดย bit แรกบอกว่าทุก row ใน page นั้น visible กับทุก transaction ตัว index-only scan จะเปิดดู bit ของ heap page ที่ entry แต่ละตัวชี้ไป ถ้า bit ถูกตั้งไว้ ค่าก็มาจาก index ได้ตรง ๆ ถ้าไม่ได้ตั้ง PostgreSQL จะดึง row จาก heap มาเช็ก และ `EXPLAIN ANALYZE` จะนับการเข้าแบบนี้ไว้ใน `Heap Fetches`
- **VACUUM ตั้ง bit ส่วนการเขียนล้าง bit** การ insert, update หรือ delete ใด ๆ บน page จะล้าง bit ของ page นั้น และมีแค่ `VACUUM` (หรือ autovacuum) ที่ตั้งมันกลับได้ ในการรันนี้ `UPDATE` ที่ลด 500 บาทจาก order 2 รายการของลูกค้า 42 เขียน row version ใหม่ลง page 5057 และทิ้ง version เก่าที่ตายแล้วไว้บน page 2392 และ 4806 ทำให้ bit ถูกล้าง 3 ตัว: `Heap Fetches: 4` และ `shared hit=8` คือเข้า heap สองครั้งเพื่อคืน version ใหม่ และอีกสองครั้งเพื่อพบว่า version เก่าตายแล้ว ระหว่างทาง scan ยัง mark entry ที่ตายแล้ว 2 ตัวนั้นไว้ใน index ทำให้ scan รอบหลัง ๆ ข้ามมันไปได้ หลัง `VACUUM` ตัว page 5057 ก็เป็น all-visible อีกครั้ง และตัวเลขลดลงเหลือ 0 พอมี dead row แค่ 2 row ตัว VACUUM ก็ข้ามรอบที่ไล่ index ไป (มันทำแบบนี้ตอนที่ row ตายน้อยมาก) ทำให้ page 2392 และ 4806 ยังมี dead line pointer ค้างอยู่ และยังไม่ถูกตั้ง bit ใน map จนกว่าจะ vacuum รอบหลัง ส่วน live entry ก็ไม่มีตัวไหนชี้ไปที่นั่นแล้ว

## ลองรันดู

ข้อมูลตัวอย่างมาจาก [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop) ที่เป็น script สร้าง template database `acme` บน PostgreSQL 18 ในเวลาราวหนึ่งนาที

ทำสำเนาใหม่ของข้อมูลตัวอย่างโดยสั่งจาก database อื่นบน server เดียวกัน แล้วรัน script ในสำเนานั้น ตัวเลข buffer หลัง `CREATE INDEX` แต่ละครั้งมาจากการรัน `EXPLAIN` รอบที่สอง เพราะรอบแรกยังต้องอ่าน index ใหม่เข้า buffer cache ด้วย ส่วนตัวเลขหลัง `UPDATE` มาจากการรันรอบแรก: รอบนั้น mark entry ที่ตายแล้ว 2 ตัวไว้ ทำให้รอบที่สองแสดง `Heap Fetches: 2`

```sql
-- from another database:  CREATE DATABASE covering_index TEMPLATE acme STRATEGY FILE_COPY;
-- then, connected to covering_index (PostgreSQL 18):

VACUUM (ANALYZE) orders;  -- a fresh copy has an empty visibility map

PREPARE recent AS
  SELECT id, status, total_thb FROM orders
  WHERE customer_id = 42 ORDER BY created_at DESC LIMIT 20;

CREATE INDEX orders_customer_id_created_at_idx ON orders (customer_id, created_at);
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE recent;
-- Index Scan Backward using orders_customer_id_created_at_idx on orders
--   Index Cond: (customer_id = 42)
--   Buffers: shared hit=23               3 index pages + 20 heap pages

CREATE INDEX orders_customer_covering_idx ON orders (customer_id, created_at)
  INCLUDE (id, status, total_thb);
DROP INDEX orders_customer_id_created_at_idx;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE recent;
-- Index Only Scan Backward using orders_customer_covering_idx on orders
--   Heap Fetches: 0
--   Buffers: shared hit=4                3 index pages + 1 visibility map page

UPDATE orders SET total_thb = total_thb - 500 WHERE id IN (495179, 493709);
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE recent;
--   Heap Fetches: 4                      new versions on page 5057, dead ones on 2392 and 4806
--   Buffers: shared hit=8

VACUUM orders;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE recent;
--   Heap Fetches: 0
--   Buffers: shared hit=4

SELECT pg_size_pretty(pg_relation_size('orders_customer_covering_idx'));
-- 32 MB   (orders_customer_id_created_at_idx was 15 MB)
```

## ใช้ตอนไหนดี

- **query ที่ hot และแคบ** หน้าจอ, API endpoint หรือ lookup ที่รันเป็นพัน ๆ ครั้งต่อนาที และอ่าน column สั้น ๆ ไม่กี่ตัวผ่าน index ที่ selective: list order ล่าสุด, การเช็ก status, การดูราคา
- **page ที่ยัง all-visible อยู่** heap จะถูกข้ามก็เฉพาะตรงที่ visibility bit ถูกตั้งไว้ ประโยชน์เลยมากที่สุดกับ table ที่ส่วนใหญ่มีแต่การอ่านหรือการต่อท้าย และ autovacuum ตามทัน: ประวัติ, reference data, order ที่แทบไม่ถูกเปลี่ยนอีกหลัง delivered ส่วน table ที่ row เปลี่ยนตลอดเวลา ตัว scan ก็ต้องเข้า heap อยู่ดี และ payload ก็มีแต่ต้นทุน
- **unique key ที่ต้องการ column เพิ่มอีกสักหนึ่งหรือสองตัว** ด้วย `CREATE UNIQUE INDEX … ON customers (email) INCLUDE (id, name)` การ lookup ด้วย email จะคืน `id` และ `name` ของลูกค้าจาก index ได้เลย และ uniqueness ก็ยังใช้กับ `email` อย่างเดียว
- **ไม่เหมาะกับ column ที่กว้างหรือมีหลายตัว** การ include column เกือบทั้งหมดของ row ก็คือการก็อป table ไปไว้ใน index และการอ่าน heap ยังถูกกว่าการคอยดูแลสำเนาที่สองให้เป็นปัจจุบัน ถ้าเป็น read model ที่มีหลาย column หรือมี join ใช้ [materialized view](../materialized-view/) หรือ read store แยก แบบใน [CQRS](../cqrs/) จะเหมาะกว่า

## ได้อะไร เสียอะไร

- **ขนาด** covering index ใช้ 32 MB (4,121 page) เทียบกับ 15 MB (1,927 page) ของ index สอง column แบบธรรมดา: มี 122 entry ต่อ leaf page แทน 261 และต้องใช้ memory สองเท่าเพื่อเก็บมันไว้ใน cache
- **ทุกการเขียนต้องจ่าย** ทุก insert ต้องเขียน entry ที่กว้างขึ้น: order ใหม่ 10,000 รายการเขียน [WAL](../write-ahead-log/) 26 MB แทน 15 MB ในช่วงทันทีหลัง checkpoint ตอนที่การเปลี่ยนครั้งแรกของแต่ละ page จะ log ทั้ง page ส่วนการ update column ที่ include ไว้ไม่มีทางเป็น HOT (heap-only) ได้ เพราะ HOT ต้องไม่มี column ที่มี index ถูกเปลี่ยน: จากการ update `pending → paid` 990 ครั้ง มี 80 ครั้งที่เป็น HOT ตอนใช้ index ธรรมดา และไม่มีเลยตอนใช้ covering index ทำให้ทุกครั้งต้องเพิ่ม entry ลงในทุก index ของ table
- **ประโยชน์อยู่ได้แค่เท่าที่ visibility map ยังช่วยได้** page ที่เปลี่ยนไประหว่างรอบ vacuum ทำให้ต้องเสีย heap fetch อีก ส่วนค่า default ของ autovacuum คือจะจัดการ table เมื่อมี row ที่ตายแล้ว 50 row บวก 20 % ของ table: สำหรับ `orders` คือ 100,050 row ถ้า table ไหนพึ่ง index-only scan อาจอยากตั้ง `autovacuum_vacuum_scale_factor` ให้ต่ำลง โดยตั้งเป็น storage parameter บน table นั้น
- **ข้อจำกัด** entry ของ B-tree ใหญ่เกินราวหนึ่งในสามของ page ไม่ได้ ถ้า payload กว้างเกินไป insert ก็อาจ fail ได้ ส่วน column ที่ include จะเป็น expression ไม่ได้ และ B-tree deduplication (PostgreSQL 13 ขึ้นไป) ไม่ถูกใช้กับ index ที่มี `INCLUDE` เลย

## ข้อควรรู้ตอนลงมือทำ

- **การอ่าน EXPLAIN** มองหา `Index Only Scan` แล้วดูที่ `Heap Fetches` ถ้าตัวเลขใกล้กับจำนวน row ที่คืน แปลว่า visibility map ไม่ได้ช่วย และ scan นั้นก็คือ index scan ที่ปลอมตัวมา ตัวเลข `pg_class.relallvisible` เทียบกับ `relpages` คือค่าประเมินของ planner ว่ามีสัดส่วน all-visible เท่าไร ส่วน extension `pg_visibility` อ่านตัว map ได้โดยตรง และตั้งแต่ PostgreSQL 18 เป็นต้นมา ตัว `EXPLAIN ANALYZE` รายงาน buffer ให้โดยไม่ต้องขอ เรื่องการอ่าน plan โดยรวมอยู่ใน [Query Execution Plans](../query-execution-plans/)
- **vacuum หลัง bulk load** table ที่เพิ่ง load หรือ restore มาใหม่มี visibility map ว่าง: บนสำเนาใหม่ของข้อมูลตัวอย่าง plan บอกว่าเป็น `Index Only Scan` แล้วก็จริง แต่กลับแสดง `Heap Fetches: 20` และ 23 buffer ไม่ได้ดีไปกว่า index ธรรมดาเลย จนกว่าจะรัน `VACUUM` ส่วนตั้งแต่ PostgreSQL 13 เป็นต้นมา การ insert ก็ trigger autovacuum ได้ด้วย ตัว table แบบ append-only ก็เลยได้ bit ตั้งไว้เหมือนกัน
- **INCLUDE หรือ key column** ถ้าใส่ column เหล่านี้เป็น key column ต่อท้ายอย่าง `(customer_id, created_at, id, status, total_thb)` ก็ได้ 32 MB เท่ากันในตัวอย่างนี้ เพราะ suffix truncation ก็ตัด key column ท้าย ๆ ออกจาก page ชั้นบนด้วย ตอนที่แค่ column ข้างหน้าก็พอแล้ว ให้ใช้ `INCLUDE` เมื่อ column ที่เพิ่มต้องไม่เปลี่ยนสิ่งที่ unique, เมื่อ type ของมันไม่มี B-tree operator class หรือเมื่ออยากให้เห็นชัดว่าเป็น payload ส่วน key column ให้ใช้เมื่อ query filter หรือ sort ด้วย column พวกนั้นด้วย แบบใน [Composite Index](../composite-index/) ตัว B-tree รองรับ `INCLUDE` ตั้งแต่ PostgreSQL 11, GiST ตั้งแต่ 12 และ SP-GiST ตั้งแต่ 14 ส่วน index type อื่น ๆ เปรียบเทียบไว้ใน [Index Types](../index-types/) และตัว B-tree เองอยู่ใน [B-Tree Index](../b-tree-index/)
- **MySQL 8.4 (InnoDB)** ตัว table เองคือ clustered index บน primary key และทุก entry ของ secondary index เก็บ column ของ primary key ไว้ให้ InnoDB ใช้หา row เพราะแบบนี้ index บน `(customer_id, created_at)` เลย cover `SELECT id …` อยู่แล้ว และ lookup ด้วย `id` ก็ไปถึง row ใน clustered index ได้โดยตรง MySQL ไม่มี `INCLUDE`: ให้เพิ่ม `status` และ `total_thb` เป็น key column ต่อท้าย แล้ว `EXPLAIN` จะแสดง `Using index` เมื่อ query ถูก cover ส่วนคำถามเรื่อง visibility ตอบกันที่ระดับ index page: ถ้า record ของ secondary index ถูก delete-mark หรือ page ของมันถูก update โดย transaction ที่ใหม่กว่า ตัว InnoDB จะไปหา row ใน clustered index แทนการตอบจาก index
- **SQL Server** ตัว nonclustered index รับ `INCLUDE (status, total_thb)` ได้ ส่วน column ที่ include จะเก็บไว้ที่ระดับ leaf เท่านั้น และไม่นับรวมใน key limit (32 key column และ 1,700 byte ตั้งแต่ SQL Server 2016) บน table ที่มี clustered index ทุก entry ของ nonclustered index จะพก clustering key ไว้ คล้ายกับใน InnoDB ถ้า index ขาด column ที่ query ต้องใช้ ตัว plan จะแสดง Key Lookup (หรือ RID Lookup บน heap table) สำหรับทุก row
- **DynamoDB** ตัว global secondary index เก็บ projection ของแต่ละ item เป็น `KEYS_ONLY`, `INCLUDE` หรือ `ALL` และมี key attribute ของ table อยู่ในนั้นเสมอ query บน global secondary index ดึง attribute ที่ไม่ได้ project ไว้ไม่ได้ ทำให้ projection ต้อง cover query นั้น ดูเพิ่มที่ [Amazon DynamoDB](../amazon-dynamodb/)
- วิธีที่ `UPDATE` เขียน row version และวิธีที่ `VACUUM` ลบมันออก อธิบายไว้ในหน้า [PostgreSQL](../postgresql/)
