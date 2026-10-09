## ปัญหา

prototype ตัวแรกของ Acme เก็บ order แบบที่ spreadsheet เก็บ: table กว้างตัวเดียวที่เก็บ order line ละหนึ่งแถว โดยเขียน email, ชื่อ และประเทศของ customer กับ SKU, ชื่อ, category และราคาของ product ลงไปในทุกแถว พอสร้างขึ้นใหม่จาก sample data บน PostgreSQL 18.6 ตัว `order_lines_wide` มี 1,250,000 แถวใน 25,280 page (ข้อมูล table 198 MB) ส่วนข้อมูลชุดเดียวกันใน table ที่ normalise แล้วทั้งสี่ตัวใช้ 16,705 page (131 MB) และ table พวกนั้นยังเก็บสิ่งที่ table กว้างเก็บไม่ได้ด้วย: customer 4,120 คนที่ไม่เคยสั่งเลย

ข้อมูลทุกอย่างที่ซ้ำกันอยู่หลายที่ก็ขัดกันเองได้ แล้ว **anomaly** แบบคลาสสิกทั้งสามแบบก็โผล่มาครบ:

- **Update anomaly** พอ customer 1 เปลี่ยน email ตัว email อยู่ใน order line ทั้ง 6,537 line ของเขา ตัว `UPDATE` เลยต้องเขียนใหม่ 6,537 แถว: ใช้ 33 ms และ [WAL](../write-ahead-log/) 2.5 MB (25,425 WAL record) ในการรันแบบ warm ครั้งหนึ่งบน laptop ถ้ารันหลัง checkpoint ทันที statement เดียวกันเขียนไป 38 MB เพราะการเปลี่ยนครั้งแรกของแต่ละ page หลัง checkpoint จะ log ทั้ง page และที่แย่กว่านั้นคือ code path ที่ update แค่ order เดียว (`WHERE order_id = 41`, `UPDATE 2`) จะทำให้ customer 1 มีสอง email คือ email เก่า 6,535 แถวและ email ใหม่ 2 แถว และไม่มีอะไรใน table บอกเลยว่าตัวไหนถูก
- **Insert anomaly** ตัว product มีตัวตนได้แค่ในฐานะส่วนหนึ่งของ order line เท่านั้น product ใหม่ หรือราคาใหม่ของ product เก่า ก็ไม่มีที่ให้ใส่จนกว่าจะมีคนสั่ง: การ insert จะ fail ด้วย `null value in column "order_id" of relation "order_lines_wide" violates not-null constraint` และ customer ที่สมัครแล้วแต่ยังไม่เคยสั่งก็เป็นแบบเดียวกัน
- **Delete anomaly** ตัว order 124446 เป็น order เดียวของ customer 5797 การลบสาม line ของมันก็ลบทุกอย่างที่ร้านรู้เกี่ยวกับ customer 5797 ไปด้วย รวมทั้ง email และประเทศ ใน sample มี customer 11,309 คนที่มี order แค่ตัวเดียวพอดี

## ทำงานยังไง

normalisation เก็บข้อมูลแต่ละอย่างไว้ที่เดียว ใน table ที่ key ของมันเป็นสิ่งที่ข้อมูลนั้นอธิบาย สิ่งที่ตัดสินว่า column ไหนควรอยู่ตรงไหนคือ **functional dependency** ของมัน: column A เป็นตัวกำหนด column B ถ้าสองแถวที่มีค่า A ตรงกันต้องมีค่า B ตรงกันด้วย ใน `order_lines_wide` ที่มี key เป็น `(order_id, line_no)` ตัว order กำหนดวันที่, status และ customer ของมัน ตัว customer กำหนด email, ชื่อ และประเทศ และตัว product กำหนดชื่อ, category และราคาตั้งของมัน ส่วน E. F. Codd เสนอ relational model และ first normal form ของมันในปี 1970 แล้วเสนอ second กับ third normal form ในปี 1971 โดยแต่ละ normal form ก็คือการทดสอบเทียบกับ dependency พวกนั้น:

| Normal form | กฎ แบบภาษาง่าย ๆ | ใน prototype ของ Acme |
|---|---|---|
| **1NF** | ทุก cell มีค่าเดียว: ไม่มี list ซ้อนอยู่ใน column และไม่มีกลุ่ม column ที่ซ้ำกัน | ผ่านอยู่แล้ว: หนึ่งแถวต่อหนึ่ง line ไม่ใช่ column `items` ที่เก็บ "4077 × 2, 6634 × 3" หรือ column `item1`, `item2`, `item3` |
| **2NF** | ไม่มี column ที่ไม่ใช่ key ตัวไหนขึ้นกับแค่บางส่วนของ composite key | `ordered_at`, `status` และ `customer_id` ขึ้นกับ `order_id` อย่างเดียว ที่เป็นแค่ครึ่งหนึ่งของ `(order_id, line_no)` เลยย้ายไปอยู่ใน `orders` |
| **3NF** | ไม่มี column ที่ไม่ใช่ key ตัวไหนขึ้นกับ column อื่นที่ไม่ใช่ key | `email`, `name` และ `country` ขึ้นกับ `customer_id` เลยย้ายไปอยู่ใน `customers` ส่วนชื่อ, category และราคาของ product ขึ้นกับ product เลยย้ายไปอยู่ใน `products` |
| **BCNF** (Boyce และ Codd, 1974) | อะไรก็ตามที่เป็นตัวกำหนด column อื่น ต้องเป็น key หรือมี key อยู่ในตัว | ผ่าน: ใน `customers` ทั้ง `id` และ `email` ไม่ซ้ำกัน แต่ละตัวเลยกำหนดทั้งแถวได้ และทั้งคู่ก็เป็น key ส่วน BCNF จะเข้มกว่า 3NF ก็เฉพาะกับ table ที่มี candidate key หลายตัวซ้อนทับกันเท่านั้น |

ผลที่ได้คือ sample schema: `customers`, `products`, `orders` และ `order_items` ที่ยึดกันไว้ด้วย primary key และ foreign key (`orders.customer_id` อ้างถึง `customers` ส่วน `order_items` อ้างถึง `orders` และ `products`) ตอนนี้ email ใหม่ของ customer 1 เป็นแค่หนึ่งแถว `UPDATE 1` ใน 0.04 ms และ WAL 328 bytes การเพิ่ม product ใหม่ก็คือ `INSERT` ลง `products` และการลบ order ก็ไม่ไปแตะ customer การอ่าน order กลับมาหมายถึงต้อง join table กลับเข้าด้วยกันตาม key ของมัน (ดู [Join Algorithms](../join-algorithms/)) ตัว PostgreSQL ไม่ได้สร้าง index ให้ฝั่งที่อ้างถึงของ foreign key เอง เลยต้องสร้าง index ให้ตัวที่ใช้ join หรือ filter อย่างที่ [B-Tree Index](../b-tree-index/) ทำให้ดูกับ `orders.customer_id`

### ตั้งใจ copy

schema ที่ normalise แล้วก็ยังมี copy ได้ ประเด็นคือต้องเลือกเองว่าจะ copy อะไรและดูแลให้มันถูกอยู่เสมอ schema ของ Acme มีสาม column ที่ดูเหมือน copy ทั้งหมด แต่จริง ๆ แล้วเป็นของสองแบบ:

- `orders.total_thb` เป็น **derived copy**: มันเท่ากับผลรวมของ `qty × price_thb` ของทุก line ใน order เสมอ list ของ order ทั้ง 2,633 ตัวของ customer 1 อ่าน index page 5 page และ heap page 2,080 page ใน 2.6 ms ถ้าใช้ total ที่เก็บไว้ ส่วนถ้าคำนวณ total เอา จะเพิ่ม index lookup ใน `order_items` อีก 2,633 ครั้ง เป็น 12,654 page และ 11 ms (ทั้งสองตัวเลขมาจากการรันแบบ warm โดยเพิ่ม index บน `orders.customer_id` ไว้สำหรับ list)
- `order_items.price_thb` คือ **ราคาที่จ่ายจริง** และ `orders.shipping_country` คือ **ปลายทางที่ส่ง order ไป** ทั้งคู่อธิบาย order line และ order ไม่ได้อธิบาย product หรือ customer มันเลยเป็นข้อมูลแยกต่างหากที่บังเอิญเท่ากับค่าของวันนี้ ในการรันนี้ คำสั่ง `UPDATE products SET price_thb = 2799.00 WHERE id = 4077` เปลี่ยนราคาตั้ง แต่ order 41 กับ 500001 ยังเป็น 2,646.15 อยู่: ถ้าไปเขียนทับมันก็เท่ากับเขียนทับสิ่งที่ customer จ่ายไปแล้ว

copy จะคุ้มที่จะเก็บไว้ก็ต่อเมื่อมีอะไรสักอย่างคอยดูแลให้มันถูกต้อง ตัว diagram ใช้ row trigger ที่รันอยู่ใน transaction ที่เขียน ส่วนทางเลือกอื่นจะย้ายงานนี้ไปทำที่อื่น:

| ทำยังไง | copy ถูกต้องเมื่อไร | ต้องจ่ายอะไร |
|---|---|---|
| **Trigger** (`AFTER INSERT OR UPDATE OR DELETE ON order_items FOR EACH ROW`) | ตอน commit ใน transaction เดียวกัน | ทุกการเขียน line ต้อง update order ของมันด้วย: line ใหม่ 10,000 line เขียน WAL 5.2 MB ใน 0.20 s แทนที่จะเป็น 2.2 MB ใน 0.10 s และสอง session ที่เพิ่ม line ให้ order เดียวกันต้องรอ [row lock](../locks-and-deadlocks/) ของกันและกัน |
| **โค้ดฝั่งแอป** ใน transaction เดียวกัน | ตอน commit ถ้าทุก code path จำได้ว่าต้องทำ | bulk script, admin tool และ migration ทุกตัวก็ต้องทำด้วย |
| **Materialized view** ของยอดรวม | หลัง `REFRESH MATERIALIZED VIEW` ที่รัน query ทั้งหมดใหม่อีกรอบ | ข้อมูลค้างเก่าในช่วงระหว่าง refresh แต่ละรอบ ดู [Materialized View](../materialized-view/) |
| **Change stream** (CDC) กับ consumer | ไม่นานหลัง commit | eventually consistent และมีชิ้นส่วนที่ต้องดูแลเพิ่มอีกหนึ่งชิ้น ดู [Change Data Capture](../change-data-capture/) |

ไม่ว่าจะใช้อะไรดูแล copy ก็ต้องตรวจมันด้วย: ในการรันนี้ไม่มี order ไหนที่ `total_thb` ต่างจากผลรวมของ line ของมัน และการตรวจ order ทั้ง 500,000 ตัวใช้เวลาราวหนึ่งวินาที copy ที่ใหญ่กว่านี้ก็ใช้กฎเดียวกัน อย่าง read model ของ [CQRS](../cqrs/) ก็เก็บ view ที่ denormalise ทั้งก้อนไว้ใน store แยก และถ้าใช้ [Event Sourcing](../event-sourcing/) ทุก table ก็คือ copy ที่สร้างขึ้นใหม่จาก event log

## ลองรันดู

sample data มาจาก [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop) ที่เป็น script สร้าง template database `acme` บน PostgreSQL 18 ในเวลาราวหนึ่งนาที

รันกับ sample data ชุดที่ copy มาใหม่ (`CREATE DATABASE normalization TEMPLATE acme STRATEGY FILE_COPY`) บน PostgreSQL 18.6 เวลาที่เห็นมาจากการรันครั้งเดียว และบนเครื่องของคุณจะไม่เท่ากัน

```sql
-- 1. The prototype: one wide row per order line
CREATE TABLE order_lines_wide AS
SELECT i.order_id, i.line_no, o.created_at AS ordered_at, o.status,
       o.customer_id, c.email, c.name AS customer_name, c.country,
       p.sku, p.name AS product_name, p.category, p.price_thb, i.qty
FROM order_items i
JOIN orders o ON o.id = i.order_id
JOIN customers c ON c.id = o.customer_id
JOIN products p ON p.id = i.product_id
ORDER BY i.order_id, i.line_no;
ALTER TABLE order_lines_wide ADD PRIMARY KEY (order_id, line_no);
CREATE INDEX ON order_lines_wide (customer_id);
CREATE INDEX ON orders (customer_id);
VACUUM ANALYZE order_lines_wide;
ANALYZE orders;

SELECT pg_relation_size('order_lines_wide') / 8192 AS pages,
       pg_size_pretty(pg_relation_size('order_lines_wide')) AS size;
--  25280 | 198 MB
SELECT (sum(pg_relation_size(t)) / 8192)::int AS pages, pg_size_pretty(sum(pg_relation_size(t))) AS size
FROM unnest('{customers,products,orders,order_items}'::regclass[]) AS t;
--  16705 | 131 MB

-- 2. Update anomaly: one new email, thousands of rows
BEGIN;
EXPLAIN (ANALYZE, BUFFERS, WAL, COSTS OFF)
UPDATE order_lines_wide SET email = 'customer1@example.org' WHERE customer_id = 1;
--  Update on order_lines_wide
--    WAL: records=25425 bytes=2495514
--    ->  Bitmap Heap Scan on order_lines_wide (actual ... rows=6537.00 loops=1)
ROLLBACK;
BEGIN;
UPDATE customers SET email = 'customer1@example.org' WHERE id = 1;
--  UPDATE 1
ROLLBACK;

-- 3. Insert and delete anomalies
INSERT INTO order_lines_wide (product_name, price_thb) VALUES ('Product 10001', 990.00);
--  ERROR:  null value in column "order_id" of relation "order_lines_wide" violates not-null constraint
BEGIN;
DELETE FROM order_lines_wide WHERE order_id = 124446;
--  DELETE 3
SELECT count(*) FROM order_lines_wide WHERE customer_id = 5797;
--  0: customer 5797 is gone
ROLLBACK;

-- 4. A deliberate copy: the stored total against the SUM
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, created_at, status, total_thb FROM orders
WHERE customer_id = 1 ORDER BY created_at DESC;
--  ->  Bitmap Heap Scan on orders (actual ... rows=2633.00 loops=1)
--        Heap Blocks: exact=2080
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT o.id, o.created_at, o.status, sum(i.qty * i.price_thb) AS total_thb
FROM orders o JOIN order_items i ON i.order_id = o.id
WHERE o.customer_id = 1 GROUP BY o.id ORDER BY o.created_at DESC;
--  Sort (actual ... rows=2633.00 loops=1)
--    Buffers: shared hit=... read=...        (12654 pages in total)
--    ->  Index Scan using order_items_pkey on order_items i (... loops=2633)

-- 5. Keep the copy right with a row trigger
CREATE FUNCTION order_items_keep_total() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE orders SET total_thb = total_thb - OLD.qty * OLD.price_thb WHERE id = OLD.order_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE orders SET total_thb = total_thb + NEW.qty * NEW.price_thb WHERE id = NEW.order_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER order_items_keep_total
AFTER INSERT OR UPDATE OR DELETE ON order_items
FOR EACH ROW EXECUTE FUNCTION order_items_keep_total();

BEGIN;
INSERT INTO orders (customer_id, status, shipping_country, created_at)
VALUES (1, 'pending', 'MY', '2026-10-09 10:00+07') RETURNING id, total_thb;
--  500001 | 0.00
INSERT INTO order_items VALUES (500001, 1, 4077, 1, 2646.15);
SELECT total_thb FROM orders WHERE id = 500001;
--  2646.15: the trigger added the line
UPDATE products SET price_thb = 2799.00 WHERE id = 4077;
SELECT order_id, line_no, price_thb FROM order_items
WHERE product_id = 4077 AND order_id IN (41, 500001);
--      41 | 1 | 2646.15
--  500001 | 1 | 2646.15     the price paid stays
ROLLBACK;

-- 6. Check that the copy still matches
SELECT count(*) FROM orders o
JOIN (SELECT order_id, sum(qty * price_thb) AS s FROM order_items GROUP BY order_id) t
  ON t.order_id = o.id
WHERE o.total_thb <> t.s;
--  0   (about 1 s)
```

## ใช้ตอนไหนดี

- **normalise ตัว system of record** สำหรับ table ที่ธุรกิจเขียนลงไป (order, customer, payment) ให้เก็บข้อมูลแต่ละอย่างไว้ที่เดียว แล้วให้ key กับ constraint ดูแลให้มันตรงกัน การเขียนแต่ละครั้งก็เล็ก และ update ก็พลาด copy ไม่ได้ ปกติจะตั้งเป้าที่ third normal form และการไปถึงจุดนั้นส่วนใหญ่ก็แค่ถามว่า "column นี้อธิบายอะไร?"
- **ตั้งใจ copy เพื่อ read ที่วัดมาแล้ว** ค่าที่ถูกอ่านบ่อยกว่าถูกเปลี่ยนมาก ๆ บน path ที่การคำนวณมันกินงานจริง (ยอดรวมของ order, counter, status ล่าสุด) คุ้มที่จะเก็บ copy ไว้ โดยมีเจ้าของที่ระบุชัดคอยดูแลให้มันถูก
- **เก็บ snapshot ของสิ่งที่ห้ามเปลี่ยน** ราคาที่จ่ายไป, ที่อยู่ที่ส่งไป, อัตราภาษีที่ใช้: เก็บไว้บน order หรือ line เพราะมันอธิบายช่วงเวลานั้น แบบนี้ไม่ใช่การ denormalise และถ้า normalise มันทิ้งไปเป็น join กับ product หรือ customer ของวันนี้ก็จะกลายเป็น bug
- **ย้ายรูปแบบการอ่านใหญ่ ๆ ออกไปจาก schema ฝั่ง transaction** ตัว search index, dashboard และ read model รายหน้าจอควรอยู่ใน read model ของ [CQRS](../cqrs/) หรือ [Materialized View](../materialized-view/) ที่ป้อนข้อมูลด้วย [Change Data Capture](../change-data-capture/) หรือ event ส่วนถ้าใช้ [Database per Service](../database-per-service/) ตัว service อื่น ๆ ก็เก็บ copy ของข้อมูลที่ตัวเองต้องใช้ไว้เองด้วยวิธีเดียวกัน
- **อย่า denormalise แค่เพื่อเลี่ยง join บน key ที่มี index** การอ่าน order 41 พร้อม email ของ customer และชื่อ product ใช้ index lookup 5 ครั้งใน 4 table, 17 page และ 0.02 ms ส่วน table กว้างใช้ 4 page และ 0.01 ms ความต่างแค่นี้แทบไม่มีผล และ table กว้างก็ต้องจ่ายแทนในทุกการเขียน

## ได้อะไร เสียอะไร

- **join ต้องจ่ายด้วยการอ่าน** การ join แต่ละครั้งคือ page ที่ต้องอ่านเพิ่ม และ join ที่ index ไม่ดีอาจแพงกว่า 17 page ไปไกล ส่วน scan อาจกลับกัน: table กว้างมีขนาด 198 MB เทียบกับ 131 MB ของ table ทั้งสี่ตัว ทำให้ report ที่ scan มันต้องอ่านมากขึ้นอีกครึ่งหนึ่ง
- **copy ต้องจ่ายด้วยการเขียน** ถ้ามี trigger แล้ว order line ใหม่ทุกตัวต้องเขียน version ใหม่ของ order ของมันด้วย: ในการรันนี้ การเขียน 10,000 line สร้าง WAL record 69,553 ตัวแทนที่จะเป็น 30,097 ตัว เป็น 5.2 MB แทน 2.2 MB และใช้ 0.20 s แทน 0.10 s
- **copy ต้องจ่ายด้วย concurrency** `UPDATE` ของ trigger จะ lock แถวของ order ไว้จนกว่าจะ commit ทำให้สอง transaction ที่เพิ่ม line ให้ order เดียวกันต้องรอกัน ตัว counter บนแถวที่มีคนเขียนเยอะก็กลายเป็นคิว
- **copy ต้องจ่ายด้วยความถูกต้อง** copy ถูกได้แค่เท่ากับ path ที่เขียนข้อมูลต้นทางแบบระวังน้อยที่สุด: bulk load ที่ปิด trigger ไว้, `TRUNCATE` (ที่ไม่ยิง trigger `ON DELETE` เลย), script ที่เขียนผ่าน connection อื่น ให้เก็บ check query แบบใน *ลองรันดู* ไว้แล้วรันมันด้วย
- **document database และ key-value database ก็ชั่งเรื่องเดียวกัน** MongoDB เรียก embedded document ว่า denormalised model: order ที่ฝัง line ไว้ข้างในคือการอ่านครั้งเดียวและการเขียนแบบ atomic ครั้งเดียว ส่วน customer ที่อ้างถึงแบบ reference จะมี copy ตัวเดียวแต่ต้องใช้ `$lookup` หรือ query ตัวที่สอง ส่วน DynamoDB ไม่มี join ทำให้ single-table design ของมันเก็บ customer กับ order ของเขาไว้ใต้ partition key เดียว แล้วอ่านด้วย `Query` ครั้งเดียว ข้อมูลไหนที่ copy ไว้ในหลาย item อย่าง email ของ customer ก็ต้อง update ในทุก item นั้น

## ข้อควรรู้ตอนลงมือทำ

- **PostgreSQL 18** ตัว primary key และ unique constraint จะสร้าง index ให้ แต่ foreign key ไม่ได้สร้าง index ให้ column ฝั่งที่อ้างถึง ส่วน generated column คำนวณยอดของ line จากแถวของตัวเองได้ (`qty * price_thb`) แต่รวมยอดจากแถวอื่นไม่ได้ ยอดรวมของ order เลยต้องใช้ trigger, โค้ดฝั่งแอป หรือ materialized view และตั้งแต่ PostgreSQL 18 generated column จะเป็นแบบ virtual ถ้าไม่ได้ระบุ `STORED` ตัว row trigger ยิงหนึ่งครั้งต่อแถว ส่วน statement-level trigger ที่มี transition table (`REFERENCING NEW TABLE AS …`) จะเห็นทุกแถวของ statement หนึ่ง ทำให้เหมาะกับ bulk load มากกว่าการ update ทีละแถว 10,000 ครั้ง ส่วน `REFRESH MATERIALIZED VIEW` รัน query ของ view ใหม่อีกรอบ (ดู [PostgreSQL](../postgresql/))
- **การวัดต้นทุนของ trigger** ในการรันนี้ `EXPLAIN (ANALYZE, WAL)` รายงาน WAL 1.6 MB เท่ากันสำหรับการ insert 10,000 line ทั้งตอนมีและไม่มี trigger ตัวเลขข้างบนเลยมาจาก counter ต่อ backend ของ `pg_stat_get_backend_wal()` ที่เพิ่งมีใน PostgreSQL 18 โดยอ่านก่อนและหลังแต่ละ statement ส่วน full-page image หลัง checkpoint ก็ทำให้ WAL พองขึ้นได้หลายเท่า เลยควรเทียบรันที่ไม่มีมัน
- **MySQL 8.4 (InnoDB)** ตัว trigger เป็น `FOR EACH ROW` เสมอ ไม่มี statement-level trigger ส่วน action ของ foreign key แบบ cascade ก็ไม่ทำให้ trigger ทำงาน ยอดรวมที่ดูแลด้วย trigger บน `order_items` เลยเพี้ยนเมื่อ line หายไปผ่าน `ON DELETE CASCADE` ส่วน generated column เป็น `VIRTUAL` โดย default และมี subquery ไม่ได้
- **SQL Server** ตัว indexed view เก็บ aggregate ไว้เหมือน table และถูก update ไปพร้อมกับทุก insert, update และ delete บน base table ของมัน มันเลยเป็น copy ที่ engine ดูแลให้ มันมีกฎตามมาด้วย (view ที่มี `GROUP BY` ต้องมี `COUNT_BIG(*)`, `SUM` ใช้กับ expression ที่อาจเป็น null ไม่ได้ และห้ามมี `HAVING`) และ Microsoft ก็บอกว่ามันเหมาะกับข้อมูลที่ไม่ค่อยถูก update ส่วนบน Standard edition ตัว query ต้องระบุ view พร้อม `NOEXPAND` ถึงจะใช้มันได้
- **Oracle** ตัว materialized view refresh ได้ตามสั่ง (on demand), ตอน commit (fast refresh จาก materialized view log) หรือตอนรัน statement (ไปพร้อมกับทุก DML) ตาม Oracle AI Database 26ai Data Warehousing Guide
- **MongoDB** คู่มือแนะนำให้ embed ข้อมูลที่อ่านด้วยกันและมีขนาดจำกัด และให้ใช้ reference เมื่อข้อมูลที่ embed เปลี่ยนบ่อย ถูก query แยกต่างหาก หรือจะถูก duplicate โดยไม่ได้ประโยชน์มากพอ ตัว `$lookup` join collection ที่อ้างถึงกันใน database เดียวกัน และ document หนึ่งมีขนาดได้ไม่เกิน 16 MiB (ดู [MongoDB](../mongodb/))
- **DynamoDB** ตัว item ที่มี partition key เดียวกันรวมกันเป็น item collection ที่ single-table design ใช้ตอบ access pattern หนึ่งแบบด้วย `Query` ครั้งเดียว ส่วน copy ข้าม item เป็นงานของแอป และมักขับเคลื่อนด้วย DynamoDB Streams (ดู [Amazon DynamoDB](../amazon-dynamodb/))
