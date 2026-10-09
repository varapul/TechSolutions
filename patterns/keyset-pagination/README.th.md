## ปัญหา

back office ของ Acme Shop แสดง order ใหม่สุดก่อน หน้าละ 50 รายการ และพนักงานก็ไล่ดูทีละหน้าย้อนลึกไปในประวัติเพื่อหา order เก่า ๆ ตัว query ที่คิดออกเป็นอย่างแรกจะนับเลขหน้าด้วย `OFFSET`:

```sql
SELECT * FROM orders
ORDER BY created_at DESC, id DESC
LIMIT 50 OFFSET 50 * (page - 1);
```

มันมีปัญหาสองข้อ และทั้งคู่มาจากการนับแถว แทนที่จะจำว่าหน้าก่อนหน้าจบลงตรงไหน

- **ต้นทุนโตตามเลขหน้า** database กระโดดไปที่แถวที่ 49,951 ของผลลัพธ์ที่เรียงแล้วไม่ได้: มันต้องสร้าง 49,950 แถวก่อนหน้านั้นขึ้นมาแล้วโยนทิ้ง เอกสารของ PostgreSQL ก็บอกไว้แบบนี้ในหัวข้อ `LIMIT` และ `OFFSET`: แถวที่ถูกข้ามก็ยังถูกคำนวณอยู่ใน server ถ้ามี index บน `(created_at, id)` หน้า 1 อ่าน 50 แถว (0.1 ms) หน้า 100 อ่าน 5,000 แถว (4.0 ms) และหน้า 1,000 อ่าน 50,000 แถวกับ 50,185 buffer (33 ms ในการรันครั้งหนึ่งบน laptop) และทุกแถวในนั้นถูก fetch มาจาก table ก่อนที่ Limit node จะทิ้งมันไป งานที่ไล่ครบทั้ง 10,000 หน้าด้วยวิธีนี้อ่านไปราว 2.5 พันล้านแถว เท่ากับ 5,000 เท่าของ table
- **หน้าเลื่อน** `OFFSET 50` แปลว่า "ข้ามอะไรก็ตามที่อยู่ใน 50 ตำแหน่งแรกตอนนี้" ถ้า order 500001 เข้ามาระหว่างการโหลดสองหน้า ทุกแถวจะเลื่อนลงไปหนึ่งตำแหน่ง แล้ว order สุดท้ายของหน้า 1 (499955) ก็กลับมาเป็น order แรกของหน้า 2 ถ้า order ในหน้า 1 ถูกลบ ทุกแถวที่อยู่หลังมันจะเลื่อนขึ้นหนึ่งตำแหน่ง แล้วหน้า 2 ก็ข้ามไปหนึ่งแถวแบบเงียบ ๆ table ไหนที่เปลี่ยนระหว่างที่คนกำลังไล่ดูทีละหน้าก็เป็นแบบนี้หมด

## ทำงานยังไง

**Keyset pagination** ที่ Markus Winand เรียกว่า *seek method* จะจำ key ของแถวสุดท้ายที่แสดงไป แล้วขอแถวที่มาต่อจากมัน:

```sql
-- page 1
SELECT * FROM orders ORDER BY created_at DESC, id DESC LIMIT 50;

-- every next page: $1, $2 = created_at and id of the last row shown
SELECT * FROM orders
WHERE (created_at, id) < ($1, $2)
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

- **row comparison ตามลำดับของ index** เงื่อนไข `(created_at, id) < ($1, $2)` เทียบจากซ้ายไปขวาและหยุดที่คู่แรกที่ต่างกัน เลยมีความหมายว่า `created_at < $1 OR (created_at = $1 AND id < $2)`: ตรงกับ "มาต่อจาก" ใน list ที่เรียงแบบ `created_at DESC, id DESC` พอดี และเพราะมันตามลำดับ column ของ index บน `(created_at, id)` ตัว PostgreSQL เลยใช้มันเป็น **Index Cond** สำหรับหน้า 1,000 มันไล่ลงครั้งเดียวจาก root page 290 ผ่าน page 1715 ใน level 1 ไปที่ leaf 1733 แล้วลงตรงถัดจาก entry ของ cursor (แถว #49,950) พอดี จากนั้นอ่าน 50 entry ถัดไปแบบย้อนหลัง: 53 buffer (index page 3 page และ table row 50 แถว) และ 0.1 ms เท่ากับหน้า 1 ส่วน B-tree ก็อ่านได้ทั้งสองทิศ ทำให้ index ที่เรียงจากน้อยไปมากใช้กับการ sort จากมากไปน้อยได้
- **key ที่ไม่ซ้ำและไม่เปลี่ยน** order สองตัวมี `created_at` เดียวกันได้: `now()` คืนเวลาเริ่มของ transaction ทำให้ batch ที่ insert ใน transaction เดียวกันได้ค่าเดียวกันหมด ถ้าแบ่งหน้าด้วย `created_at` อย่างเดียว ตัว `<` แบบเข้มจะข้ามแถวที่เหลือของกลุ่มที่ค่าเท่ากัน ส่วน `<=` จะแสดงซ้ำ การเพิ่ม primary key เป็น column สุดท้ายของการ sort ทำให้ทุก key ไม่ซ้ำกัน ส่วนตัว key ก็ยังต้องอยู่กับที่ระหว่างที่คนไล่ดูทีละหน้าด้วย: ถ้าแบ่งหน้าด้วย `updated_at` การแก้ไขจะย้ายแถวไปอยู่ฝั่งที่ใหม่สุดของ list ทำให้ list ที่เรียงใหม่สุดก่อนไม่แสดงแถวนั้นเลยถ้าคนอ่านยังไล่ไปไม่ถึง ส่วน list ที่เรียงเก่าสุดก่อนจะแสดงมันสองครั้ง
- **ทุก column ทิศเดียวกัน** row comparison ใช้ operator ตัวเดียวกับทุก column ของมัน เลยเขียน `created_at DESC, id DESC` ได้ แต่เขียน `created_at DESC, id ASC` ไม่ได้ ถ้าทิศปนกัน ให้เขียนแบบ `OR` ออกมาเต็ม ๆ แล้วให้ index เรียงปนแบบเดียวกัน คือ `(created_at DESC, id ASC)`
- **ห้ามมี NULL ใน key** ถ้าคู่ไหนใน row comparison เป็น NULL ผลจะเป็น unknown และแถวนั้นก็หลุดออกจากหน้าไป ให้ตั้ง column ที่ใช้ sort เป็น `NOT NULL` หรือ map NULL เป็นค่าหนึ่งทั้งใน index และใน query
- **cursor แบบ opaque** ตัว API คืน key ออกไปเป็น token ที่ client ส่งกลับมาโดยไม่ต้องอ่านมัน ของ Acme เป็น base64url ของ JSON object เล็ก ๆ: `{"t":"2026-07-30T18:45:26.947567Z","id":450057}` กลายเป็น `eyJ0IjoiMjAyNi0wNy0zMFQxODo0NToyNi45NDc1NjdaIiwiaWQiOjQ1MDA1N30` ให้เก็บ timestamp ไว้ละเอียดถึง microsecond ครบ: `Date` ของ JavaScript เก็บได้แค่ millisecond เต็ม ๆ และ cursor ที่ถูกตัดเหลือ 18:45:26.947 จะข้ามทุกแถวที่อยู่ระหว่างค่านั้นกับ 18:45:26.947567 ให้ sign token หรือ validate มันที่ server และบันทึกการ sort กับ filter ไว้ในนั้นด้วย ทำให้ cursor จาก list หนึ่งเอาไป replay กับอีก list ไม่ได้
- **ย้อนกลับ** สำหรับปุ่ม Previous ให้กลับทิศทั้งการเทียบและการเรียง แล้วกลับลำดับ 50 แถวนั้น: `WHERE (created_at, id) > ($1, $2) ORDER BY created_at, id LIMIT 50` โดยใช้แถวแรกของหน้าปัจจุบันเป็น cursor ถ้าเริ่มจากแถวแรกของหน้า 1,000 (450045) นี่คือ index scan แบบเดินหน้าที่ใช้ 53 buffer เท่าเดิม และได้หน้า 999 ออกมาพอดี
- **filter** ให้ใส่ column ของ filter ไว้หน้า key ใน index: order ของ customer 1 แบบใหม่สุดก่อนต้องใช้ `(customer_id, created_at, id)` ถ้ามีแค่ `(created_at, id)` หน้า 50 ของ order 2,633 รายการของ customer 1 จะเดินไปตาม index แล้วทิ้งแถวของ customer อื่นไป 9,775 แถวกว่าจะเจอ 50 แถว (9,859 buffer, 2.1 ms) ส่วนถ้ามี index ที่ตรงกัน มันอ่าน 50 แถวกับ 53 buffer (0.03 ms) [Composite Index](../composite-index/) อธิบายเรื่องลำดับ column
- **การนับ** `SELECT count(*) FROM orders` คือ Parallel Seq Scan ผ่านครบทั้ง 5,058 page ใช้ 29 ms ทุกครั้งที่รัน พอ ๆ กับต้นทุนของหน้า 1,000 ที่ใช้ `OFFSET` แต่ list ส่วนใหญ่ก็ไม่ต้องมีมัน: ให้ fetch 51 แถว แล้วแสดงปุ่ม Next ก็ต่อเมื่อมีแถวที่ 51 หรือแสดงค่าประมาณอย่าง `pg_class.reltuples`

## ลองรันดู

sample data มาจาก [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop) ที่เป็น script สร้าง template database `acme` บน PostgreSQL 18 ในเวลาราวหนึ่งนาที

รันกับ sample data ของ Acme Shop ชุดที่ copy มาใหม่ (PostgreSQL 18) โดย comment แสดงบรรทัดสำคัญของ output จำนวน buffer เท่ากันทุกครั้งที่รัน (ตอนรันครั้งแรกบางส่วนจะขึ้นเป็น `read=` แทน `hit=`) ส่วนเวลาเปลี่ยนไปตามเครื่อง ทำให้ plan ข้างล่างไม่ได้ใส่เวลาไว้: 33 ms กับ 0.1 ms ใน diagram มาจากการรันครั้งหนึ่งบน laptop

```sql
-- CREATE DATABASE keyset_pagination TEMPLATE acme STRATEGY FILE_COPY;  then connect to it
SET TimeZone = 'UTC';
CREATE INDEX orders_created_at_id_idx ON orders (created_at, id);

-- Page 1,000 with OFFSET: the scan reads 50,000 rows and Limit keeps the last 50
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM orders ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET 49950;
-- Limit (actual rows=50.00)
--   ->  Index Scan Backward using orders_created_at_id_idx on orders (actual rows=50000.00)
--         Index Searches: 1
--         Buffers: shared hit=49991 read=194     (50,185 in all)

-- The cursor: the last row of page 999
SELECT created_at, id FROM orders ORDER BY created_at DESC, id DESC LIMIT 1 OFFSET 49949;
-- 2026-07-30 18:45:26.947567+00 | 450057

-- Page 1,000 with keyset: seek past the cursor and read 50 rows
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM orders
WHERE (created_at, id) < ('2026-07-30 18:45:26.947567+00', 450057)
ORDER BY created_at DESC, id DESC LIMIT 50;
-- Limit (actual rows=50.00)
--   ->  Index Scan Backward using orders_created_at_id_idx on orders (actual rows=50.00)
--         Index Cond: (ROW(created_at, id) < ROW('2026-07-30 18:45:26.947567+00'::timestamp with time zone, 450057))
--         Index Searches: 1
--         Buffers: shared hit=53

-- A total is its own query
EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM orders;
-- Finalize Aggregate (actual rows=1.00)
--   ->  Gather   Workers Launched: 2
--         ->  Partial Aggregate
--               ->  Parallel Seq Scan on orders   Buffers: shared hit=5058

-- Shifting rows: page 1 ends with order 499955, then a new order arrives
SELECT id FROM orders ORDER BY created_at DESC, id DESC LIMIT 1 OFFSET 49;
-- 499955
INSERT INTO orders (customer_id, status, shipping_country, created_at, total_thb)
VALUES (42, 'pending', 'TH', '2026-10-02 17:20:00+00', 1290.00) RETURNING id;
-- 500001
SELECT id FROM orders ORDER BY created_at DESC, id DESC LIMIT 3 OFFSET 50;
-- 499955, 499952, 499951   page 2 by OFFSET starts with page 1's last order
SELECT id FROM orders WHERE (created_at, id) < ('2026-10-02 15:38:37.916976+00', 499955)
ORDER BY created_at DESC, id DESC LIMIT 3;
-- 499952, 499951, 499946   page 2 by keyset carries on after it
```

## ใช้ตอนไหนดี

- infinite scroll, activity feed, ปุ่ม "load more" และ list endpoint ของ API ที่ client เดินหน้าไปเรื่อย ๆ และมีแถวใหม่เข้ามาตลอด
- งาน export, backfill, sync job และ crawler ที่ไล่ทั้ง table: ทุก batch มีต้นทุนเท่ากัน และ job ก็ทำต่อจาก key สุดท้ายที่บันทึกไว้ได้
- list ไหนก็ตามที่คนไล่หน้าลงไปลึก ๆ หรือที่เปลี่ยนไประหว่างที่เขากำลังไล่ดู
- `OFFSET` ธรรมดายังใช้ได้ดีกับ list สั้น ๆ (ไม่กี่หน้าของ table เล็ก ๆ ที่ไม่ค่อยเปลี่ยน) และกับหน้าจอที่คนต้องกระโดดไปหน้าที่ *n* ได้ แบบผสมที่เจอบ่อยคือใช้ keyset กับ Next และ Previous แล้วเสริมด้วยการกระโดดตามค่า เช่นวันที่หรือเลข order และนั่นก็เป็นแค่การ seek อีกแบบหนึ่ง

## ได้อะไร เสียอะไร

- **ไม่มี random access** ไม่มีเลขหน้า: จะรู้ key แรกของหน้า 734 ได้ก็ต่อเมื่ออ่าน 36,650 แถวก่อนหน้ามันแล้ว
- **หนึ่ง index ต่อการ sort และ filter แต่ละแบบ** ทุกลำดับที่ผู้ใช้เลือกได้ และทุก filter ที่อยู่หน้ามัน ต้องมี index ของตัวเอง และทุก index ก็กินพื้นที่และทำให้การเขียนช้าลง (ดู [B-Tree Index](../b-tree-index/))
- **ยอดรวมต้องจ่ายเพิ่ม** การนับคือ query แยกอีกตัวที่โตตาม table
- **cursor เป็นของ query ของมัน** ถ้าเปลี่ยนการ sort หรือ filter ตัว cursor เก่าก็ไม่มีความหมาย และถ้าเปลี่ยน format ของ cursor ลิงก์ที่ client เก็บไว้ก็พัง
- **ไม่ใช่ snapshot** ทุกหน้าคือ query ใหม่ ตัว order ใหม่จะเรียงอยู่เหนือ cursor และโผล่มาตอนผู้ใช้กลับไปหน้า 1 ส่วนแถวที่ถูก insert หรือ delete ลึกลงไปข้างล่างจะโผล่มาหรือหายไปในหน้าถัด ๆ ไป แถวหนึ่งจะไม่ซ้ำหรือหายไปแค่เพราะแถวอื่นขยับ ตราบใดที่ key ของมันเองไม่เปลี่ยน

## ข้อควรรู้ตอนลงมือทำ

- **PostgreSQL 18** เปลี่ยน row comparison บน column นำของ B-tree index ให้เป็น index condition อย่างที่เห็นใน plan ข้างบน ส่วน `EXPLAIN` ของเวอร์ชัน 18 รายงาน `Index Searches: 1` สำหรับการไล่ลงครั้งเดียวนั้น และตอนนี้ `EXPLAIN ANALYZE` ก็รวมจำนวน buffer มาให้โดยไม่ต้องขอ ใน plan ตัว `OFFSET` จะโผล่มาเป็น Limit node ที่คืน 50 แถว อยู่เหนือ scan ที่คืนมา 50,000 แถว ([Query Execution Plans](../query-execution-plans/))
- **MySQL 8.4 (InnoDB)** เขียน offset เป็น `LIMIT 49950, 50` หรือเป็น `LIMIT 50 OFFSET 49950` ที่มีไว้ให้เข้ากันได้กับ PostgreSQL และอย่างที่ Markus Winand ชี้ไว้สำหรับทุก database มันก็ยังต้อง fetch แถวที่ถูกข้ามก่อน ถึงจะส่งแถวที่อยู่ถัดไปได้ คู่มือของมันในหัวข้อ row constructor expression แนะนำให้เขียน inequality ออกมาเต็ม ๆ เป็น `created_at < ? OR (created_at = ? AND id < ?)` เพื่อให้ range optimizer ใช้ทุก column ของ index ได้ ตัว InnoDB ต่อ primary key ไว้ท้าย secondary index ทุกตัว และ optimizer ก็ใช้ key ที่ขยายแล้วนี้ ทำให้ index บน `created_at` อย่างเดียวก็เรียงตาม `(created_at, id)` อยู่แล้วถ้า `id` เป็น primary key
- **SQL Server** มี `OFFSET … FETCH` และหน้าของมันก็เลื่อนแบบเดียวกัน: [เอกสารของ Microsoft](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-order-by-clause-transact-sql) บอกว่าถ้าจะให้หน้านิ่ง ต้องมี `ORDER BY` ที่ไม่ซ้ำ และข้อมูลต้องไม่เปลี่ยน หรือไม่ก็อ่านทุกหน้าใน snapshot หรือ serializable transaction เดียว ส่วน Use The Index, Luke ก็บอกว่า SQL Server (2017) ไม่มี row value และ Oracle ใช้ `<` หรือ `>` กับมันไม่ได้ (ORA-01796) ทั้งคู่เลยใช้รูปแบบ `OR` ที่เขียนออกมาเต็ม
- **SQLite** รองรับ row value ตั้งแต่ 3.15.0 (2016) และ [เอกสารของมัน](https://sqlite.org/rowvalue.html) ก็ใช้ query รูปนี้ทำหน้าต่างที่เลื่อนไปตาม list
- **Amazon DynamoDB** แบ่งหน้าได้แค่ตาม key: Query หนึ่งครั้งคืนได้ไม่เกิน 1 MB และถ้ายังเหลืออีก ตัว `LastEvaluatedKey` ของมันก็กลายเป็น `ExclusiveStartKey` ของ request ถัดไป ([Amazon DynamoDB](../amazon-dynamodb/))
- **Elasticsearch** หยุด `from` + `size` ไว้ที่ 10,000 hit โดย default (`index.max_result_window`) และแบ่งหน้าที่ลึกกว่านั้นด้วย `search_after` ที่ใช้ค่า sort ของ hit สุดท้าย ส่วน point in time (PIT) ทำให้มุมมองนิ่งตลอดหลาย request และเพิ่ม tiebreaker `_shard_doc` ให้โดยอัตโนมัติ ([Elasticsearch](../elasticsearch/))
- คู่มือของ **MongoDB** บอกว่า `skip()` scan ตั้งแต่ต้นของผลลัพธ์และช้าลงเมื่อ offset โตขึ้น และแนะนำให้ใช้ range query บน field ที่มี index แทน โดยใส่ `_id` ไว้ในการ sort เพื่อให้ลำดับไม่ซ้ำ ([MongoDB](../mongodb/))
- **API** ตัว GraphQL Cursor Connections Specification (Relay) กำหนด argument `first` กับ `after` และ `pageInfo` ที่มี `endCursor` กับ `hasNextPage` และถือว่า cursor เป็น string แบบ opaque ส่วน list endpoint ของ Stripe แบ่งหน้าด้วย `starting_after` และ `ending_before` ที่รับ ID ของ object
