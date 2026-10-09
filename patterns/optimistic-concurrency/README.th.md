## ปัญหา

หน้าจอ back-office โหลด record ขึ้นมา คนแก้มันอยู่สักพัก แล้วหน้าจอก็บันทึก การโหลดกับการบันทึกเป็น request คนละตัว เลยเป็น database transaction คนละตัวด้วย: ไม่มีอะไรผูกการบันทึกไว้กับสิ่งที่อ่านมา ถ้ามีสองคนแก้ record เดียวกันในช่วงนั้น การบันทึกครั้งที่สองจะสร้างจากสำเนาที่เก่าไปแล้ว และมันจะเขียนทับครั้งแรกไปเงียบ ๆ นี่คือ **lost update**

ที่ Acme Shop ตัว agent A กับ B เปิด order 499996 ทั้งคู่ ตัว order นี้จ่ายเงินแล้วแต่ยังไม่ได้ส่ง และที่อยู่จัดส่งของมันเขียนว่า `88 Sukhumvit 11, Bangkok` ลูกค้าโทรหา A เพื่อแก้บ้านเลขที่ แล้ว A ก็บันทึก `88/5 Sukhumvit 11, Bangkok` อีกหนึ่งนาทีต่อมา B ที่โหลด order มาก่อน A บันทึก ก็เติมรหัสไปรษณีย์จาก email ของลูกค้าแล้วบันทึก `88 Sukhumvit 11, Bangkok 10110` ในการรันที่อยู่เบื้องหลังหน้านี้ ([PostgreSQL](../postgresql/) 18.6 ใน Docker บน laptop, script Node.js ที่ใช้ connection แยกให้ agent แต่ละคน และย่อเวลาแก้หลายนาทีให้เหลือหนึ่งวินาที) statement ทั้งสองตัวตอบ `UPDATE 1` ตัว row จบที่ข้อความของ B ส่วน `/5` ก็หายไป และไม่มี agent คนไหนรู้เรื่องเลย: พัสดุจะถูกส่งไปที่บ้านเลขที่ 88

isolation level ที่เข้มขึ้นก็ไม่ช่วย เพราะ isolation level คุมแค่สิ่งที่เกิดขึ้นข้างใน transaction เดียว (ดู [Transaction Isolation Levels](../isolation-levels/)) การอ่านของ B รันอยู่ใน transaction ที่จบไปหลายนาทีก่อนที่ B จะเริ่มบันทึก ในการรันเดียวกัน การบันทึกแต่ละครั้งที่ครอบด้วย `BEGIN ISOLATION LEVEL SERIALIZABLE … COMMIT` ก็ยัง commit ได้ และได้ผลเหมือนเดิม ตัว database ไม่มีทางรู้ว่าค่าใหม่ของ B มาจากการอ่านที่เก่าแล้ว ถ้าการบันทึกไม่ได้บอกว่ามันอ่านอะไรมา

## ทำงานยังไง

**แนวคิด** paper ปี 1981 ของ H. T. Kung กับ John T. Robinson ชื่อ *On Optimistic Methods for Concurrency Control* เสนอให้คุม concurrency โดยไม่ใช้ lock ตัว transaction อ่านได้อย่างอิสระ และเก็บสิ่งที่จะเขียนไว้ในสำเนาส่วนตัว (read phase) จากนั้นเช็กว่าไม่มีอะไรที่มันพึ่งพาถูกคนอื่นเปลี่ยนไปในระหว่างนั้น (validation) แล้วค่อยทำให้สิ่งที่เขียนมองเห็นได้ (write phase) ส่วน transaction ที่ validation ไม่ผ่านจะถูกถอยกลับแล้วรันใหม่ วิธีนี้คุ้มเมื่อการชนกันเกิดไม่บ่อย จนการเช็กตอนท้ายถูกกว่าการ lock ทุกอย่างไว้ล่วงหน้า แอปพลิเคชันก็เดิมพันแบบเดียวกันข้าม request: หนังสือ *Patterns of Enterprise Application Architecture* ของ Martin Fowler เรียกมันว่า **Optimistic Offline Lock** (pattern ที่ David Rice เขียน) โดยที่ business transaction หนึ่งตัวกินเวลาข้ามหลาย system transaction และการเช็กจะรันใน transaction ที่บันทึก

**version column** ให้ row มี counter แล้วส่งมันออกไปกับทุกการอ่าน:

```sql
ALTER TABLE orders ADD COLUMN version integer NOT NULL DEFAULT 1;
```

PostgreSQL เก็บค่า default ที่ไม่ volatile แบบนี้ไว้ใน metadata ของ table แทนการเขียน table ใหม่ statement นี้เลยใช้เวลาแค่ 4 ms บน order 500,000 รายการ และทุก row ที่มีอยู่ก็อ่านได้เป็น version 1 จากนั้นการบันทึกแต่ละครั้งจะบอก version ที่มันเริ่มต้นมา แล้วขยับมันไปข้างหน้า ใน statement เดียว:

```sql
UPDATE orders SET shipping_address = $3, version = version + 1
WHERE id = $1 AND version = $2
RETURNING version;
```

การบันทึกของ A ถือ version 1 มา ตรงกับ row และคืน 2 การบันทึกของ B ก็ถือ version 1 มาเหมือนกัน แต่ตอนนั้น row เป็น version 2 แล้ว statement เลยไม่ตรงกับอะไรเลย: ไม่มี row กลับมา และ command tag เป็น `UPDATE 0` แล้ว PostgreSQL ก็ไม่ถือว่าจำนวน 0 เป็น error แอปพลิเคชันเลยต้องเช็กจำนวนเองแล้วรายงานว่าชนกัน เพราะไม่มีอะไรถูกเขียน เครื่องมือของ B เลยโหลด order ใหม่ได้ (version 2 ที่มี `/5` ของ A) แสดงการแก้ทั้งสองฝั่งให้ B ดู แล้วบันทึกผลที่รวมกันโดยเทียบกับ version 2 แล้วได้ 3 กลับมา

**ทำไมการเช็กถึงไม่ race** การเทียบกับการเขียนเกิดใน statement เดียว และ database ก็จัดให้ writer ที่เขียน row เดียวกันพร้อมกันทำทีละตัว ถ้าการบันทึกทั้งสองมาถึงในจังหวะเดียวกัน `UPDATE` ตัวแรกจะได้ row lock ไป ส่วนตัวที่สองต้องรอ ในการรัน ตอนที่การบันทึกของ A ยังไม่ commit ตัว `pg_locks` แสดงว่า backend ของ B กำลังรอ `ShareLock` บน transaction id ของ A (148865) โดย `granted = false` พอ A commit แล้ว PostgreSQL ก็ประเมิน `WHERE` clause ของ B ใหม่กับ row version ที่ A เพิ่งเขียน เพราะ READ COMMITTED ทำแบบนี้กับทุก `UPDATE` ที่ต้องรอ writer ตัวอื่น มันเจอ version 2 แล้ว statement ของ B ก็จบด้วย `UPDATE 0` ถ้า transaction ของ B เป็น REPEATABLE READ แทน มันจะ fail ด้วย `ERROR: could not serialize access due to concurrent update` (SQLSTATE 40001) ที่ก็แปลว่า "โหลดใหม่แล้วลองอีกครั้ง" เหมือนกัน ส่วน `SELECT version` ที่ตามด้วย `UPDATE` แยกอีกตัวที่ไม่มีเงื่อนไข ไม่ได้รับการป้องกันแบบนี้เลย เพราะการบันทึกอื่นแทรกเข้ามาระหว่างสองตัวนั้นได้ เรื่อง row lock และการรอที่มันทำให้เกิด อยู่ใน [Locks & Deadlocks](../locks-and-deadlocks/) ส่วน row version ที่ update เขียนอยู่ใน [MVCC](../mvcc/)

**ผ่าน HTTP** version ควรอยู่ใน API และ HTTP ก็มี header สำหรับเรื่องนี้อยู่แล้ว ([RFC 9110](https://www.rfc-editor.org/rfc/rfc9110)):

- `GET` คืน representation พร้อม entity tag ที่เปลี่ยนทุกครั้งที่ข้อมูลเปลี่ยน: `ETag: "1"`
- การบันทึกส่ง tag กลับมาเป็น precondition: `PUT /orders/499996` พร้อม `If-Match: "1"` ตัว server ต้องประเมินมันก่อนทำ method และต้องไม่ทำ method ถ้ามันเป็นเท็จ แล้วค่อยตอบ `412 Precondition Failed` ได้
- `If-Match` ใช้การเทียบแบบ **strong**: tag แบบ weak อย่าง `W/"1"` ไม่มีวันตรง แม้แต่กับตัวมันเอง RFC 9110 อธิบายว่า If-Match คือตัวกันที่ใช้กันทั่วไปเพื่อป้องกัน lost update เวลาที่หลาย client ทำงานกับ resource เดียวกัน
- server ปฏิเสธการบันทึกที่ไม่มีเงื่อนไขได้ด้วย `428 Precondition Required` ([RFC 6585](https://www.rfc-editor.org/rfc/rfc6585#section-3)) ทำให้ client ที่ลืมใส่ header ถอยกลับไปใช้แบบใครเขียนทีหลังก็ชนะไม่ได้

API ของ Acme แปลง `If-Match` เป็นการเช็ก version ส่วนในการรัน ตัว `PUT` ของ A ที่มี `If-Match: "1"` ได้ `200 OK` กับ `ETag: "2"` ส่วน `PUT` ของ B ที่มี `If-Match: "1"` รัน `UPDATE … AND version = 1` ไม่ตรงกับ row ไหน แล้วได้ `412` เครื่องมือของ B โหลด order ใหม่ (`ETag: "2"`) แล้วบันทึกผลที่รวมกันด้วย `If-Match: "2"`: ได้ `200 OK` กับ `ETag: "3"` และ row ก็อ่านได้ว่า `88/5 Sukhumvit 11, Bangkok 10110` การส่ง request เก่าของ B ซ้ำอีกครั้งได้ `412` อีกและไม่เปลี่ยนอะไร ส่วน `PUT` ที่ไม่มี `If-Match` ได้ `428` และตัวที่มี `If-Match: W/"3"` ได้ `412`

**จัดการการชนกันใน UI** การชนกันคือสิ่งที่ต้องถามผู้ใช้ ไม่ใช่การพัง ให้ agent เห็นค่าปัจจุบันข้างร่างของตัวเอง ให้เขารวมเอง แล้วบันทึกโดยเทียบกับ version ใหม่ การส่ง request เดิมซ้ำไม่มีพิษภัย (มันแค่ fail อีกรอบ) แต่การส่งร่างเดิมซ้ำด้วย ETag ใหม่โดยไม่รวม ก็คือใครเขียนทีหลังก็ชนะที่แค่มีขั้นตอนเพิ่ม บางฟอร์มรวมให้เองได้เมื่อการแก้สองครั้งแตะคนละ field ส่วน field ที่อยู่จัดส่งตัวเดียวกันแบบในตัวอย่างนี้ต้องให้คนตัดสิน

**ORM ทำงานจุกจิกนี้ให้** มันเพิ่ม version เข้าไปใน `WHERE` clause ของทุก update และ delete แล้วแปลงจำนวน 0 เป็น exception:

| Framework | Version | การบันทึกที่ค้างเก่าจะ raise |
|---|---|---|
| Hibernate 7.4 (Jakarta Persistence) | attribute `@Version`: เป็น integer type หรือ timestamp | `OptimisticLockException` |
| EF Core | property `[ConcurrencyCheck]` ที่แอปเปลี่ยนทุกครั้งที่บันทึก หรือ `[Timestamp]` (`rowversion` ของ SQL Server ส่วนบน Npgsql เป็น `uint` ที่ map กับ `xmin`) | `DbUpdateConcurrencyException` |
| Rails 8.1 (Active Record) | integer column ชื่อ `lock_version` | `ActiveRecord::StaleObjectError` |
| SQLAlchemy 2.0 | `version_id_col` ใน `__mapper_args__` | `StaleDataError` |

Hibernate ยังเช็กแบบ optimistic ได้โดยไม่ต้องมี version column: `@OptimisticLocking` เทียบทุก field หรือเฉพาะ field ที่เปลี่ยน ใน `WHERE` clause

**DynamoDB และ store อื่น ๆ** [Amazon DynamoDB](../amazon-dynamodb/) ไม่มี `WHERE` clause ตอนเขียน แต่มี primitive แบบเดียวกัน คือ conditional write ถ้าสั่ง `UpdateItem` ที่มีเงื่อนไข `version = :read` และ update `SET version = version + :one` มันจะสำเร็จก็ต่อเมื่อ item ยังมี version ที่เราอ่านมา ไม่อย่างนั้นมันจะ fail ด้วย `ConditionalCheckFailedException` (HTTP 400) และไม่เปลี่ยนอะไร แต่การเขียนที่ fail ก็ยังกิน write capacity การตั้ง `ReturnValuesOnConditionCheckFailure` เป็น `ALL_OLD` จะคืน item ปัจจุบันมาพร้อม error ทำให้ไม่ต้องอ่านอีกรอบก่อนรวม ใน AWS SDK for Java 2.x ตัว `VersionedRecordExtension` ของ enhanced client (คู่กับ `@DynamoDbVersionAttribute`) เพิ่มเงื่อนไขและการบวก version ให้เอง คู่มือของ DynamoDB แนะนำ optimistic locking สำหรับ item เดี่ยวที่ชนกันไม่บ่อย แนะนำ transaction สำหรับ update ที่ครอบหลาย item และเตือนว่า global table ตัดสินการเขียนพร้อมกันใน Region ต่างกันแบบ last writer wins การเช็ก version ใน Region หนึ่งเลยหยุดการเขียนในอีก Region ไม่ได้ ส่วน Amazon S3 รับ `If-Match` บน `PutObject` และตอบ `412` เมื่อ ETag ของ object เปลี่ยนไปแล้ว (ดู [Amazon S3](../amazon-s3/)) และ Kubernetes ปฏิเสธ update ที่มี `resourceVersion` เก่าด้วย `409 Conflict` ตัว [Event Sourcing](../event-sourcing/) ก็กันแต่ละ stream ด้วยวิธีเดียวกัน คือใส่ expected version ไปกับทุก append

## ลองรันดู

ข้อมูลตัวอย่างมาจาก [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop) ที่เป็น script สร้าง template database `acme` บน PostgreSQL 18 ในเวลาราวหนึ่งนาที

รันใน `psql` กับสำเนาใหม่ของข้อมูล โดยให้ `psql` session เดียวเล่นเป็น agent ทั้งสองคน: แต่ละ statement commit ของตัวเอง เหมือนที่ request ของเครื่องมือทำ และ `\gset` เก็บ version ที่ agent แต่ละคนอ่านไว้ ส่วนที่ 4 เปิด connection ที่สองด้วย extension `dblink` ที่มากับ PostgreSQL อยู่แล้ว เพื่อแสดงการบันทึกสองครั้งที่ race กัน connection นี้ server เปิดเอง ผ่าน local socket ของมันและไม่ใช้ password แบบที่ Docker image ทางการอนุญาต ถ้าเป็นที่อื่นให้เพิ่ม host กับ password ลงใน connection string ส่วน transaction id บนเครื่องของคุณจะไม่ตรงกับที่นี่

```sql
CREATE DATABASE optimistic_concurrency TEMPLATE acme STRATEGY FILE_COPY;
\c optimistic_concurrency
ALTER TABLE orders ADD COLUMN shipping_address text;
UPDATE orders SET shipping_address = '88 Sukhumvit 11, Bangkok' WHERE id = 499996;

-- 1. Last write wins. Agents A and B both read the address (not shown), then save
--    in turn. Each statement is a transaction of its own, as in the back-office tool.
UPDATE orders SET shipping_address = '88/5 Sukhumvit 11, Bangkok' WHERE id = 499996;      -- A
UPDATE orders SET shipping_address = '88 Sukhumvit 11, Bangkok 10110' WHERE id = 499996;  -- B
SELECT shipping_address FROM orders WHERE id = 499996;
--  88 Sukhumvit 11, Bangkok 10110          A's /5 is gone, and both saves said UPDATE 1

-- 2. A version column. With a constant default this changes only the table's metadata:
--    no table rewrite, every existing row reads as version 1.
UPDATE orders SET shipping_address = '88 Sukhumvit 11, Bangkok' WHERE id = 499996;
ALTER TABLE orders ADD COLUMN version integer NOT NULL DEFAULT 1;
SELECT shipping_address, version FROM orders WHERE id = 499996 \gset a_
SELECT shipping_address, version FROM orders WHERE id = 499996 \gset b_
UPDATE orders SET shipping_address = '88/5 Sukhumvit 11, Bangkok', version = version + 1
WHERE id = 499996 AND version = :a_version RETURNING version;
--  version
--        2
--  UPDATE 1
UPDATE orders SET shipping_address = '88 Sukhumvit 11, Bangkok 10110', version = version + 1
WHERE id = 499996 AND version = :b_version RETURNING version;
--  (0 rows)
--  UPDATE 0                                 the conflict: nothing was written

-- 3. B reloads (version 2), merges both edits and saves again
SELECT shipping_address, version FROM orders WHERE id = 499996 \gset b_
UPDATE orders SET shipping_address = '88/5 Sukhumvit 11, Bangkok 10110', version = version + 1
WHERE id = 499996 AND version = :b_version RETURNING version;
--  version
--        3

-- 4. Both saves at the same instant. A's save is still open; B's goes through a
--    second connection (dblink), waits for A's row lock, then re-checks its WHERE
--    clause against the row A committed.
CREATE EXTENSION dblink;
SELECT dblink_connect('agent_b', 'dbname=optimistic_concurrency');
BEGIN;
UPDATE orders SET shipping_address = '88/5 Sukhumvit 11, Bangkok 10110', version = version + 1
WHERE id = 499996 AND version = 3;
SELECT dblink_send_query('agent_b', $$UPDATE orders SET shipping_address = '88 Sukhumvit 11, Bangkok 10110',
  version = version + 1 WHERE id = 499996 AND version = 3$$);
SELECT pg_sleep(0.5);
SELECT l.locktype, l.mode, l.granted, l.transactionid = pg_current_xact_id()::xid AS on_a
FROM pg_locks l WHERE l.locktype = 'transactionid' AND NOT l.granted;
--     locktype    |   mode    | granted | on_a
--  transactionid  | ShareLock | f       | t       B waits for A's transaction to end
COMMIT;
SELECT * FROM dblink_get_result('agent_b') AS t(status text);
--   status
--  UPDATE 0                                 version is 4 now, so B's check fails
SELECT dblink_disconnect('agent_b');

-- 5. xmin, the row version's inserting transaction, changes on every update,
--    even one that changes nothing
SELECT xmin, version FROM orders WHERE id = 499996;
UPDATE orders SET shipping_address = shipping_address WHERE id = 499996;
SELECT xmin, version FROM orders WHERE id = 499996;
--  xmin is a new transaction id; version is still 4
```

## ใช้ตอนไหนดี

- **อ่าน หยุดไปพัก แล้วค่อยบันทึก** ฟอร์ม, admin tool, REST API และแอปมือถือที่ sync ทีหลัง ต่างก็อ่าน record ใน request หนึ่งแล้วเขียนมันในอีก request หนึ่ง เราถือ transaction เปิดค้างไว้ระหว่างที่คนพิมพ์ไม่ได้ และการชนกันบน record ใด record หนึ่งก็เกิดน้อย การเช็กตอนบันทึกเลยถูก
- **record เยอะ แต่ละตัวมี writer น้อย** ในการรัน มี 8 session บันทึกคนละ 100 ครั้งลงบน 8 row ที่ต่างกัน และพยายามไปพอดี 800 ครั้ง: ไม่ชนกันเลย และใช้เวลารวม 0.16 s

เลือกวิธีอื่นเมื่อ:

- **database คำนวณค่าใหม่เองได้** `UPDATE stock SET qty = qty - 1 WHERE product_id = $1 AND qty > 0` ไม่ได้อ่านอะไรก่อน เลยไม่มี version ให้เทียบ แค่ row lock อย่างเดียวก็ทำให้ update ที่เกิดพร้อมกันถูกต้องแล้ว ในการรันมันบันทึก 800 ครั้งลง row เดียวในเวลา 0.19 s
- **row ตัวหนึ่ง hot** เมื่อมี 8 session บันทึก row stock ของ product 7689 คนละ 100 ครั้ง วิธีอ่าน-แล้วเช็ก-แล้ว retry ต้องพยายาม **5,019 ครั้ง** เพื่อให้ได้ 800 การบันทึก (ชนกัน 4,219 ครั้ง หรือ 84 %) และใช้เวลา 1.1 s ส่วน `SELECT … FOR UPDATE` ที่ตามด้วย `UPDATE` ใช้แค่ 800 ครั้งและ 0.7 s เพราะ session ต่อคิวกันที่ row lock แทนการทำงานซ้ำ การเว้นช่วงระหว่าง retry ([Retry with Backoff](../retry-with-backoff/)) ช่วยกระจายการพยายามออกไป แต่ไม่ได้ทำให้การแย่งกันหายไป ให้ส่งการเขียนผ่าน consumer ตัวเดียวแทน ([Queue-Based Load Leveling](../queue-based-load-leveling/)) หรือแยก row ที่ hot ออกเป็นหลายส่วน
- **การชนกันทำให้งานที่แพงต้องทิ้งไป** ถ้าการทำใหม่ต้องเสียเวลาแก้เป็นชั่วโมง ให้คน check out record ไปแทน (*Pessimistic Offline Lock* ของ Fowler): เป็น lock ที่แอปพลิเคชันบันทึกไว้เอง มีเจ้าของและเวลาหมดอายุ เพื่อให้การแก้ที่ถูกทิ้งค้างไว้ไม่ block record ไปตลอด และมันก็ยังไม่ใช่ database lock

อย่าถือ database lock ไว้ข้ามช่วงที่คนกำลังคิด ในการรัน เครื่องมือของ A เปิด transaction แล้วรัน `SELECT … FOR UPDATE` ระหว่างที่ A แก้ จากนั้น `SELECT … FOR UPDATE` ของ B ก็รอจนกว่า `lock_timeout = '5s'` จะยกเลิกมันด้วย `ERROR: canceling statement due to lock timeout` (SQLSTATE 55P03) ค่า default ของ `lock_timeout` คือ 0 ที่แปลว่าปิดไว้ ถ้าไม่ได้ตั้งไว้ ตัว B ก็จะรอไปจนกว่า transaction ของ A จะจบ ระหว่างนั้น session ของ A ก็ค้างอยู่ในสถานะ `idle in transaction` กิน connection ไว้ตัวหนึ่ง และกันไม่ให้ vacuum ลบ row version ที่อาจมีแค่มันที่ยังต้องใช้ ตัว `idle_in_transaction_session_timeout` ที่ค่า default เป็น 0 เหมือนกัน ใช้จบ session แบบนี้ได้

## ได้อะไร เสียอะไร

- **รู้ว่าชนกันช้า** agent รู้ตัวหลังจากทำงานเสร็จไปแล้ว หน้าจอแจ้งการชนกันเลยสำคัญพอ ๆ กับตัวการเช็ก ทำช่วงเวลานั้นให้สั้น และทำให้การรวมง่าย
- **writer ทุกตัวต้องร่วมด้วย** batch job หรือ `UPDATE` ที่สั่งด้วยมือโดยไม่ได้เพิ่ม version จะหลุดผ่านทุกการเช็ก ให้ส่งการเขียนทั้งหมดผ่านโค้ดที่เพิ่ม version หรือทำ trigger `BEFORE UPDATE` ให้ตั้ง `NEW.version := OLD.version + 1` (และห้ามแอปพลิเคชันเพิ่มมันเองซ้ำอีก) หรือใช้ version ที่ database ดูแลให้ อย่าง `rowversion` ของ SQL Server
- **timestamp เป็น version ที่อ่อนกว่า counter** มันเปลี่ยนก็ต่อเมื่อนาฬิกาเปลี่ยน `DATETIME` และ `TIMESTAMP` ของ MySQL เก็บแค่วินาทีเต็ม ถ้าไม่ได้ประกาศให้มีหลักทศนิยม และในการรันบน MySQL 8.4 การแก้ที่บันทึกในวินาทีเดียวกับที่ B อ่าน row ไม่ได้ทำให้ `updated_at` เปลี่ยน: `WHERE updated_at = …` ของ B เลยยังตรง และ `/5` ของ A ก็หายไป คู่มือของ Hibernate บอกว่า timestamp เป็นวิธี lock แบบ optimistic ที่เชื่อถือได้น้อยกว่า version number และ HTTP ก็ถือว่าวันที่ใน `Last-Modified` เป็น weak validator ถ้าไม่มีอะไรยืนยันเป็นอย่างอื่น ด้วยเหตุผลเดียวกัน: มันขยับทีละหนึ่งวินาที ส่วน `timestamptz` ของ PostgreSQL เก็บได้ถึง microsecond แต่ `now()` คืนเวลาเริ่มต้นของ transaction ไม่ใช่จังหวะที่เขียน
- **`xmin` ใช้ได้ แต่มีข้อแม้** row version ทุกตัวใน PostgreSQL บันทึก id ของ transaction ที่เขียนมันไว้ใน column ที่ซ่อนอยู่ชื่อ `xmin` มันเลยเปลี่ยนทุกครั้งที่ `UPDATE` แล้วในการรัน ตัว `UPDATE` ที่ตั้งที่อยู่ให้เท่ากับค่าเดิมทำให้ `xmin` ขยับจาก 148870 เป็น 148878 ขณะที่ `version` ยังเป็น 1: `xmin` ไม่เคยพลาดการเปลี่ยน แต่มันก็รายงานการเขียนที่ไม่ได้เปลี่ยนอะไรด้วย ส่วน transaction id เป็น 32-bit และวนกลับได้ และเอกสารก็แนะนำว่าอย่าพึ่งความ unique ของมันในช่วงที่เกินราวหนึ่งพันล้าน transaction การ dump แล้ว restore หรือ logical replica จะให้ `xmin` ใหม่กับทุก row และโค้ดที่พึ่งมันก็รันได้แค่บน PostgreSQL ทั้ง EF Core ที่ใช้ Npgsql และ SQLAlchemy ใช้มันได้
- **version เดียวต่อ row แปลว่าชนกันระดับ row** ถ้า A แก้ที่อยู่ส่วน B แก้เบอร์โทร version ตัวเดียวก็จะปฏิเสธ B ทั้งที่การแก้ไม่ได้ทับกัน ให้รวม field ที่ไม่ทับกันให้เองอัตโนมัติ หรือแยก version ให้ส่วนที่เล็กลง
- **strong ETag อาจหายระหว่างทาง** If-Match ต้องใช้ tag แบบ strong แต่ proxy ที่แก้ response อาจทำให้มันกลายเป็น weak: ตั้งแต่ 1.7.3 เป็นต้นมา [NGINX](../nginx/) เปลี่ยน strong entity tag เป็น weak เมื่อมันแก้ response เช่นตอนบีบอัด แล้ว client ก็จะส่ง `W/"…"` มา ทำให้ทุกการบันทึก fail ด้วย 412 ให้เช็กว่าอะไรไปถึง client บ้าง ผ่าน [API Gateway](../api-gateway/), proxy และ CDN ทุกตัวที่อยู่หน้า service
- **retry ต้องเสียงานจริง** ทุกการชนกันคือการอ่านใหม่และทำใหม่ของผู้ใช้หรือ service และใน DynamoDB การ conditional write ที่ fail ก็ยังกิน write capacity

## ข้อควรรู้ตอนลงมือทำ

- **PostgreSQL 18** `UPDATE … RETURNING` ส่ง version ใหม่กลับมาใน round trip เดียวกัน และ PostgreSQL 18 คืนได้ทั้งสองฝั่งด้วย `RETURNING old.version, new.version` จำนวนใน tag ของ `UPDATE` รวม row ที่ตรงเงื่อนไขแต่ค่าไม่ได้เปลี่ยนด้วย มันเลยวัดจำนวนที่ตรง ไม่ใช่จำนวนที่เปลี่ยน การเช็กใหม่หลังรอ lock ใช้กับ `UPDATE`, `DELETE` และ `SELECT … FOR UPDATE` ใน READ COMMITTED ส่วน REPEATABLE READ และ SERIALIZABLE จะ raise SQLSTATE 40001 ที่เอกสารบอกให้ retry ด้วยการรันทั้ง transaction ใหม่ รวมถึง logic ที่เลือกค่าด้วย ตัว `NOWAIT` ทำให้ `SELECT … FOR UPDATE` fail ทันทีแทนการรอ
- **MySQL 8.4 (InnoDB)** `UPDATE … WHERE id = ? AND version = ?` แบบเดียวกันก็ใช้ได้ และ client รายงาน `Rows matched: 0  Changed: 0` โดย default จำนวน affected rows ของ `UPDATE` คือจำนวน row ที่เปลี่ยนจริง เว้นแต่ client จะ connect ด้วย `CLIENT_FOUND_ROWS` ที่ทำให้นับ row ที่ตรงเงื่อนไขแทน ตัว `version = version + 1` ทำให้ทุก row ที่ตรงเงื่อนไขเปลี่ยน ตัวเลขทั้งสองเลยตรงกัน การ race จบต่างจาก PostgreSQL ภายใต้ REPEATABLE READ ที่เป็น default ของ InnoDB: ในการรัน `UPDATE` ของ B รอ record lock ของ A (`performance_schema.data_locks` แสดง `X,REC_NOT_GAP` `WAITING`) แล้วอ่าน row ล่าสุดที่ commit แล้ว ไม่ตรงกับอะไร และไม่คืน error ขณะที่ `SELECT` ธรรมดาใน transaction ของ B ยังเห็น version 1 จาก snapshot ของมัน ตัว snapshot ของ InnoDB ครอบแค่ `SELECT` ธรรมดา ส่วน `UPDATE` และ `DELETE` ทำงานกับ row ล่าสุดที่ commit แล้ว การรอ lock จะจบหลัง `innodb_lock_wait_timeout` (default 50 วินาที) ด้วย `ERROR 1205 (HY000): Lock wait timeout exceeded` และ `FOR UPDATE NOWAIT` จะ fail ทันทีด้วย error 3572
- **SQL Server** column `rowversion` (8 byte) ได้ค่าใหม่ที่เพิ่มขึ้นเรื่อย ๆ ทั้ง database ทุกครั้งที่ insert และ update และการบันทึกเช็กมันด้วย `UPDATE … WHERE id = @id AND rv = @rv` กับ `@@ROWCOUNT` ส่วน `timestamp` เป็นชื่อพ้องที่ deprecated แล้ว และ `[Timestamp]` ของ EF Core ก็ map กับ `rowversion`
- **SQLite** ไม่มี column ที่ update ตัวเองได้ เอกสารของ EF Core เลยแนะนำให้ใช้ token ที่แอปพลิเคชันดูแลเองแทน เช่น GUID ที่แอปเปลี่ยนใหม่ทุกครั้งที่บันทึก
- **Amazon DynamoDB** ใส่ version ไว้ใน condition expression แบบที่อธิบายไว้ข้างบน ส่วน `DynamoDBMapper` ของ AWS SDK for Java 1.x ที่ใช้คู่กับ `@DynamoDBVersionAttribute` ก็ทำแบบเดียวกันก่อนจะมี enhanced client ของ 2.x การ conditional write บน attribute ที่กำลัง update เป็น idempotent ทำให้ request ที่ retry หลัง network error ไม่มีทางมีผลซ้ำสองครั้ง เป็นการรับประกันแบบเดียวกับที่ [Idempotent Consumer](../idempotent-consumer/) ได้จาก table ของ message ที่ประมวลผลแล้ว
