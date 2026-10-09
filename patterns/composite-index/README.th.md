## ปัญหา

Acme Shop เก็บ order ไว้ใน PostgreSQL 18.6: 500,000 row ใน 5,058 page (40 MB) เคยมีคนเพิ่ม index บน `(created_at, customer_id)` ไว้ และหน้าจอประวัติ order ก็รัน query นี้ทุกครั้งที่มีคนเข้ามาดู:

```sql
SELECT id, created_at, total_thb FROM orders
WHERE customer_id = 42 AND status = 'delivered'
ORDER BY created_at DESC LIMIT 20;
```

column ทั้งสองตัวที่ query ใช้ filter และ sort อยู่ใน index นั้นครบ แต่มันแทบไม่ช่วยอะไรเลย ตัว index เรียงตาม `created_at` ทำให้ order 179 รายการของลูกค้า 42 กระจายอยู่ทั่ว entry ทั้ง 500,000 ตัว ส่วน plan ที่ดีที่สุดที่ PostgreSQL หาได้คือเดินถอยหลังไปตาม index จาก entry ล่าสุด แล้วเช็ก `customer_id = 42` ทีละ entry จนได้ 20 ตัวที่ตรง: ใช้ 204 leaf page, 52,936 entry และ 226 buffer เพื่อให้ได้ 20 row

สำหรับลูกค้าส่วนใหญ่ มันแย่กว่านี้อีก ลูกค้า 1012 มี order 34 รายการ ตัว planner ประเมินว่ามี row ที่ตรงแค่ 9 row คือน้อยกว่า `LIMIT` ทำให้การเดินไปตาม index หยุดก่อนไม่ได้ ตัว planner เลยอ่าน table ครบทั้ง 5,058 page ด้วย parallel sequential scan แล้ว sort สิ่งที่เจอ ใช้เวลา 10 ถึง 16 ms ในการรันบน laptop เทียบกับต่ำกว่าหนึ่ง millisecond ไปมากถ้ามี index ที่ถูกตัว

## ทำงานยังไง

**B-tree หลาย column เรียงตาม column แรก และเรียงตาม column ที่สองเฉพาะในกลุ่ม entry ที่ค่าแรกเท่ากัน** แล้วก็ไล่ต่อไปแบบนี้ ตัว PostgreSQL เติมตำแหน่งของแต่ละ row (TID ของมัน) ไว้เป็นตัวตัดสินสุดท้ายเวลาค่าเท่ากัน มันก็เหมือนสมุดโทรศัพท์ที่เรียงตามนามสกุลแล้วค่อยตามชื่อ: "Lee" ทุกคนอยู่ติดกัน แต่ "Somchai" ทุกคนกระจายอยู่ทั่วทั้งเล่ม

ลำดับแบบนี้ทำให้เกิด **กฎ leftmost prefix** เงื่อนไข equality บน leading column รวมกับ range บน column แรกที่ไม่มี equality เป็นตัวกำหนดว่าจะอ่าน index ส่วนไหนที่ต่อเนื่องกัน เงื่อนไขบน column ถัด ๆ ไปก็ยังถูกเช็กใน index อยู่ ทำให้ประหยัดการเข้า table แต่มันไม่ทำให้ส่วนที่ต้องอ่านเล็กลง EXPLAIN แสดงทั้งสองแบบเป็น `Index Cond`: plan ที่ช้าข้างบนกับ plan ที่เร็วข้างล่างต่างก็แสดง `Index Cond: (customer_id = 42)` และมีแค่จำนวน buffer ที่บอกได้ว่ามันต่างกัน

บน `(customer_id, created_at)` เงื่อนไข equality `customer_id = 42` จะตกลงที่ช่วงเดียวที่ต่อเนื่องกันขนาด 179 entry และในช่วงนั้น entry ก็เรียงตาม `created_at` อยู่แล้ว การไต่ลงไปหาช่วงแต่ละครั้งจะอ่าน page ชั้นละหนึ่ง page (ที่นี่มีสามชั้น: root, internal page, leaf) และทำ [binary search](../binary-search/) หา key ภายในแต่ละ page

| Query บน `(customer_id, created_at)` | index ทำอะไร |
|---|---|
| `customer_id = 42` | seek ตรงไปที่ช่วงเดียว |
| `customer_id = 42 AND created_at >= '2026-09-01'` | seek ไปที่จุดเริ่มของส่วนหนึ่งในช่วงนั้น |
| `customer_id = 42 ORDER BY created_at DESC LIMIT 20` | อ่านช่วงนั้นถอยหลังแล้วหยุดหลังได้ 20 ตัว: ไม่ต้อง sort |
| `created_at >= '2026-10-02'` | ไม่มีช่วงเดียวให้อ่าน: ค่าที่ตรงกระจายอยู่ในช่วงของลูกค้าทุกคน |

**equality ก่อน range หรือ sort ไว้ท้าย** พอ column ที่เป็น equality ตรึง scan ไว้ที่ช่วงเดียวแล้ว column ถัดไปก็เรียงอยู่ในช่วงนั้น range บน column นี้เลยเป็นช่วงต่อเนื่องช่วงเดียว และ sort บนมันก็ได้มาฟรี ถ้ากลับลำดับ ค่าที่ตรง equality ก็จะกระจายอยู่ทั่ว range นั้น ตัวอย่างจาก dashboard ก็เห็นชัด: สำหรับ order สถานะ pending ตั้งแต่ 1 กันยายน (990 จาก 24,776 order ในช่วงนั้น) index บน `(created_at, status)` อ่าน index 121 page เพราะต้องเช็กทุก entry ในช่วง ขณะที่ `(status, created_at)` อ่านแค่ 6 page กฎง่าย ๆ ของ Markus Winand ใน *Use The Index, Luke* ก็เหมือนกัน: equality ก่อน แล้วค่อย range

ถ้ามี `(customer_id, created_at)` แล้ว ตัว plan ของ query หน้าประวัติก็ยังมีรูปเดิม คือ Index Scan Backward ที่มี `Index Cond: (customer_id = 42)` แต่คราวนี้มันไต่ลงไปที่ท้ายช่วงของลูกค้า 42 หยิบ entry จากล่าสุดก่อน แล้วหยุดหลังได้ 20 ตัว: 23 buffer (index 3 page กับ table 20 page) และไม่มี Sort node ตัว planner จะใช้ลำดับนี้ตอนที่คาดว่า `LIMIT` จะตัด scan ให้จบเร็ว ส่วนลูกค้า 1012 ที่ประเมินไว้ 9 row มันจะดึงช่วงทั้งหมด 34 entry ด้วย bitmap scan แล้ว sort แทน ใช้ 37 buffer

**ทิศทางการ sort** B-tree อ่านได้ทั้งสองทิศ `(customer_id, created_at)` เลยรองรับ `ORDER BY created_at DESC` ของลูกค้าคนเดียวได้ แต่ทิศผสมข้ามสอง column เป็นอีกเรื่อง: `WHERE customer_id IN (42, 43) ORDER BY customer_id, created_at DESC LIMIT 20` ออกมาจาก index ธรรมดาตรง ๆ ไม่ได้ และ PostgreSQL ก็ใส่ Incremental Sort ครอบไว้ข้างบน (row มาถึงแบบเรียงตาม `customer_id` ไว้แล้ว) ส่วน index ที่ประกาศเป็น `(customer_id, created_at DESC)` จะคืนลำดับนั้นให้ได้เลย

**ใส่ column ที่ selective ที่สุดไว้ก่อน?** คำแนะนำเก่านี้ส่วนใหญ่เป็นแค่ความเชื่อผิด ๆ ถ้า query มีเงื่อนไข equality บนทุก column ใน index ตัว B-tree จะนำทางด้วย key ทั้งชุด และลำดับ column แทบไม่เปลี่ยนว่ามันต้องอ่านมากแค่ไหน สิ่งที่ลำดับเป็นตัวตัดสินจริง ๆ คือ query ไหนใช้ index ได้บ้าง ผ่านกฎ leftmost prefix และ range กับ sort จะได้ประโยชน์จาก index หรือเปล่า เพราะฉะนั้นให้ดูจาก query แล้วเอา column ที่ใช้ range และ sort ไว้ท้าย Myth Directory ของ Winand ก็บอกแบบเดียวกัน: selectivity สำคัญเป็นหลักตอนที่มีเงื่อนไข range อิสระสองตัวแข่งกัน และ skip scan ชอบ leading column ที่มีค่าที่ต่างกันแค่ *ไม่กี่ค่า* ตรงข้ามกับกฎเก่า

**Skip scan ของใหม่ใน PostgreSQL 18** ตอนนี้ B-tree scan ใช้ index ที่ leading column ไม่มีเงื่อนไข หรือมีแค่ range ได้แล้ว โดยข้างในจะมอง column นั้นเป็น equality กับค่าแต่ละค่าของมันทีละค่า และค้น index ใหม่หนึ่งครั้งต่อค่า วิธีนี้คุ้มก็ต่อเมื่อ leading column มีค่าที่ต่างกันไม่กี่ค่า และ planner ตัดสินจาก statistics ของมัน index `(status, created_at)` ตอบ `created_at >= '2026-10-02'` ด้วยการค้น index 6 ครั้งไล่ตาม status ทั้ง 5 ค่า (579 buffer) และบรรทัด `Index Searches` ที่เพิ่มมาใหม่ใน EXPLAIN ANALYZE ก็แสดงให้เห็น ส่วน `(customer_id, created_at)` ทำแบบเดียวกันไม่ได้: มีลูกค้า 95,880 คนให้ skip ตัว planner เลยเลือก sequential scan บน table และพอบังคับให้ใช้ index ก็ได้การค้น index 52 ครั้งกับประมาณ 2,560 buffer ใกล้เคียงกับการอ่านทั้ง index

## ลองรันดู

ข้อมูลตัวอย่างมาจาก [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop) ที่เป็น script สร้าง template database `acme` บน PostgreSQL 18 ในเวลาราวหนึ่งนาที

รันใน `psql` บน PostgreSQL 18 กับสำเนาใหม่ของข้อมูลตัวอย่าง Acme Shop (template database `acme`) อย่าเพิ่งรัน `ANALYZE` ก่อน: สำเนาจะเก็บ statistics ของ template ไว้ ทำให้ plan ออกมาตรงกับที่แสดงนี้ ตัวเลข buffer นับ page ขนาด 8 kB ที่แต่ละ plan แตะ คือ `hit` บวก `read` ส่วนตัวเลขข้างล่างมาจากการรัน `EXPLAIN` แต่ละตัวรอบที่สอง เพราะการรัน query ครั้งแรกใน session ใหม่จะนับ catalog page เพิ่มเข้ามาอีกนิดหน่อย (235 แทน 226 สำหรับ plan แรก และ 584 แทน 579 สำหรับ plan สุดท้าย)

```sql
CREATE DATABASE composite_index TEMPLATE acme STRATEGY FILE_COPY;
\c composite_index

-- The index the shop already has
CREATE INDEX orders_created_at_customer_id_idx ON orders (created_at, customer_id);

-- History screen: customer 42's newest delivered orders
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, created_at, total_thb FROM orders
WHERE customer_id = 42 AND status = 'delivered'
ORDER BY created_at DESC LIMIT 20;
--  Limit (actual rows=20.00 loops=1)
--    ->  Index Scan Backward using orders_created_at_customer_id_idx on orders
--          Index Cond: (customer_id = 42)
--          Filter: (status = 'delivered'::text)
--          Index Searches: 1
--          Buffers: shared hit=226          (204 leaf pages walked)

-- Equality column first, sort column last
CREATE INDEX orders_customer_id_created_at_idx ON orders (customer_id, created_at);
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, created_at, total_thb FROM orders
WHERE customer_id = 42 AND status = 'delivered'
ORDER BY created_at DESC LIMIT 20;
--  Limit (actual rows=20.00 loops=1)
--    ->  Index Scan Backward using orders_customer_id_created_at_idx on orders
--          Index Cond: (customer_id = 42)
--          Filter: (status = 'delivered'::text)
--          Index Searches: 1
--          Buffers: shared hit=23           (3 index pages, 20 table pages, no Sort)

-- Dashboard: pending orders of the last day
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, customer_id, created_at FROM orders
WHERE status = 'pending' AND created_at >= '2026-10-02';
--  Bitmap Heap Scan on orders (actual rows=210.00 loops=1)
--    Recheck Cond: (created_at >= '2026-10-02 00:00:00+00'::timestamp with time zone)
--    Filter: (status = 'pending'::text)
--    Rows Removed by Filter: 349
--    Buffers: shared hit=526
--    ->  Bitmap Index Scan on orders_created_at_customer_id_idx (actual rows=559.00 loops=1)

CREATE INDEX orders_status_created_at_idx ON orders (status, created_at);
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, customer_id, created_at FROM orders
WHERE status = 'pending' AND created_at >= '2026-10-02';
--  Index Scan using orders_status_created_at_idx on orders (actual rows=210.00 loops=1)
--    Index Cond: ((status = 'pending'::text) AND (created_at >= '2026-10-02 00:00:00+00'::timestamp with time zone))
--    Index Searches: 1
--    Buffers: shared hit=213

-- Skip scan: no condition on status, with the old index out of the way
BEGIN;
DROP INDEX orders_created_at_customer_id_idx;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, status, created_at FROM orders WHERE created_at >= '2026-10-02';
--  Index Scan using orders_status_created_at_idx on orders (actual rows=559.00 loops=1)
--    Index Cond: (created_at >= '2026-10-02 00:00:00+00'::timestamp with time zone)
--    Index Searches: 6
--    Buffers: shared hit=579
ROLLBACK;
```

## ใช้ตอนไหนดี

- query ที่ filter ด้วยสองหรือสาม column พร้อมกัน ปกติจะเป็น equality บนหนึ่งหรือสอง column และ range หรือ sort บน column สุดท้าย: order ของลูกค้าตามวันที่, event ของ tenant ตามเวลา, job ที่ยังเปิดอยู่ของ queue ตาม priority
- query แบบ top-N และการแบ่งหน้า (`ORDER BY … LIMIT n`) ภายใน parent ตัวเดียว: index คืน row ที่เรียงไว้แล้ว และ scan หยุดหลังได้ n ตัว ส่วน keyset pagination ก็สร้างบนหลักนี้ตรง ๆ
- ใช้แทน single-column index หลายตัวที่ query ใช้คู่กันเสมอ PostgreSQL รวม single-column index ด้วย bitmap AND ได้ก็จริง แต่มันต้อง scan แต่ละตัวตามเงื่อนไขของตัวเอง และเสียลำดับไป ทำให้ `ORDER BY` ต้อง sort แยกอีกรอบ
- ไม่ใช่ตอนที่ query แต่ละ column แยกกัน: index บน (a, b) ไม่ช่วย query บน b อย่างเดียว ยกเว้น skip scan บน leading column ที่มีค่าไม่กี่ค่า ส่วน workload แบบนี้ single-column index สองตัวอาจรองรับได้ดีกว่า
- ไม่ใช่ทำไปตามความเคยชิน เอกสารของ PostgreSQL แนะนำให้ใช้ index หลาย column อย่างประหยัด และ index ที่มีเกินสาม column ไม่ค่อยช่วย เว้นแต่ table นั้นถูกใช้ในรูปแบบที่ตายตัวมาก ๆ

## ได้อะไร เสียอะไร

- **การเขียน** ทุก index ถูก update ทุกครั้งที่ INSERT และทุกครั้งที่ UPDATE เปลี่ยน column ของมัน และการเปลี่ยนแบบนี้ก็ทำให้ row นั้นทำ HOT update ไม่ได้ด้วย การ INSERT หนึ่งครั้งลงใน `orders` เขียน WAL 5 record (380 byte) ตอนมี primary key กับ composite index สามตัว เทียบกับ 2 record (164 byte) ตอนมีแค่ primary key ส่วนการ insert 10,000 row เขียน WAL 4.5 MB เทียบกับ 1.7 MB
- **พื้นที่** composite index สามตัวกินพื้นที่ 49 MB (15, 15 และ 19 MB) ข้าง table ขนาด 40 MB ส่วน partial index `ON orders (created_at) WHERE status = 'pending'` รองรับ dashboard ได้ด้วย 5 page (40 kB) เพราะมันเก็บแค่ order สถานะ pending 990 รายการ มันอ่าน 212 buffer พอ ๆ กับ `(status, created_at)` แต่มีแค่ query ที่มี `status = 'pending'` เท่านั้นที่ใช้มันได้ เรื่อง partial index อยู่ใน [Index types](../index-types/)
- **prefix ที่ซ้ำซ้อน** `(customer_id, created_at)` ตอบทุก lookup ที่ index บน `(customer_id)` อย่างเดียวตอบได้ รวมถึงการเช็ก `orders.customer_id` ตอนลบลูกค้าด้วย ตัว single-column index มีขนาดเล็กกว่า (5.5 MB ที่นี่) การ scan มันเลยถูกกว่านิดหน่อย แต่น้อยครั้งที่จะถูกพอให้คุ้มกับการดูแล index ทั้งสองตัว
- **plan ไปตามค่าประเมิน** order 179 รายการของลูกค้า 42 ทำให้ลูกค้าคนนี้อยู่ในรายการ most common values ของ planner (ประเมินไว้ 217 row) เลยได้ index scan แบบมีลำดับ ส่วนลูกค้า 1012 ที่ประเมินไว้ 9 row ได้ bitmap scan ตามด้วย sort ถึง plan ทั้งสองจะเร็ว แต่บน column ที่ข้อมูลเบ้ การรัน `ANALYZE` รอบใหม่อาจย้ายลูกค้าเข้าหรือออกจากรายการนั้น แล้วทำให้ plan เปลี่ยน ส่วนวิธีอ่านค่าประเมินอยู่ใน [Query execution plans](../query-execution-plans/)
- **ควรมีกี่ index?** ไม่มีตัวเลขตายตัว Use The Index, Luke แสดงให้เห็นว่าเวลา insert โตขึ้นทุกครั้งที่เพิ่ม index โดย index ตัวแรกทำให้กระโดดมากที่สุด ให้เก็บ index ที่ query ใช้ไว้ (`pg_stat_user_indexes.idx_scan` บอกว่าตัวไหนไม่เคยถูก scan) แล้ว drop ที่เหลือ: ที่นี่ skip scan ทำให้ index เก่า `(created_at, customer_id)` ไม่จำเป็นสำหรับ dashboard อีกต่อไป แต่ feed ที่แสดง order ล่าสุดของลูกค้าทุกคนก็ยังต้องการมันอยู่

## ข้อควรรู้ตอนลงมือทำ

- **PostgreSQL 18** index แบบ B-tree, GiST, GIN และ BRIN มี key column ได้หลายตัว สูงสุด 32 ตัวรวม column ใน `INCLUDE` ลำดับ column มีผลกับ B-tree และ GiST (ที่ column แรกเป็นตัวตัดสินว่าต้อง scan มากแค่ไหน) แต่ไม่มีผลกับ GIN หรือ BRIN ส่วน skip scan และบรรทัด `Index Searches` เป็นของใหม่ใน 18 ถ้าเป็น 17 หรือเก่ากว่า query ที่ไม่มีเงื่อนไขบน leading column จะอ่านทั้ง index หรือทั้ง table การตอบ query จาก index อย่างเดียวคือเรื่องของ [covering index](../covering-index/) ส่วนโครงสร้าง page ข้างใต้อยู่ใน [B-tree index](../b-tree-index/) และเรื่อง engine เพิ่มเติมอยู่ที่ [PostgreSQL](../postgresql/)
- **MySQL 8.4 / InnoDB** ใช้กฎ leftmost prefix แบบเดียวกัน กับ index ที่มีได้ถึง 16 column ทุก record ของ secondary index ใน InnoDB ยังพก primary key ไว้ด้วย และ optimizer ก็ใช้ column พวกนั้น (index extensions) ทำให้ `(customer_id, created_at)` ทำตัวเหมือน `(customer_id, created_at, id)` ส่วน `DESC` ใน definition ของ index ถูกเก็บเป็นลำดับจากมากไปน้อยจริง ๆ (เฉพาะ InnoDB) ทำให้ `ORDER BY` แบบทิศผสมอ่านไปข้างหน้าจาก index อย่าง `(customer_id ASC, created_at DESC)` ได้ ตัว access method แบบ Skip Scan range ใช้ได้กับ table เดียวที่ไม่มี `GROUP BY` หรือ `DISTINCT` ตอนที่ query อ้างถึงแค่ column ของ index และมี range บน key part ตัวหลัง ๆ แล้ว EXPLAIN ก็จะแสดง `Using index for skip scan` และ optimizer switch `skip_scan` เปิดอยู่โดย default
- **Oracle Database** ก็มี index skip scan เหมือนกัน: optimizer ของมันจะพิจารณาใช้ตอนที่ query ไม่ได้จำกัด leading column ของ composite index, column นั้นมีค่าที่ต่างกันไม่กี่ค่า และ column ถัดไปมีหลายค่า
- **SQLite** ใช้ skip-scan ก็ต่อเมื่อ `ANALYZE` แสดงแล้วว่า column ซ้ายสุดมีค่าซ้ำเยอะ เฉลี่ยราว 18 ตัวขึ้นไปต่อค่า
- **[MongoDB](../mongodb/)** กำหนดกฎของ compound index ไว้เป็นแนวทาง ESR: field ที่เป็น equality ก่อน ตามด้วย field ที่ใช้ sort แล้วค่อย field ที่ใช้ range ทำให้ sort ได้มาจาก index แต่ range ที่ selective มาก ๆ อาจเอาไปไว้ก่อน field ที่ใช้ sort แทนได้
- **[Amazon DynamoDB](../amazon-dynamodb/)** ฝังกฎนี้ไว้ใน key ของมันเลย: Query ต้องมี equality บน partition key และยอมให้มีเงื่อนไขหนึ่งตัวบน sort key (`=`, `<`, `<=`, `>`, `>=`, `BETWEEN` หรือ `begins_with`) ถ้า table มี partition key เป็น `customer_id` และ sort key เป็น `created_at` ก็จะตอบหน้าจอประวัติได้ด้วย Query ครั้งเดียว
