## ปัญหา

database ของ Acme Shop รันหลาย transaction พร้อมกันตลอด: checkout, refund, update stock, report โดยแต่ละตัวถูกเขียนมาเหมือนว่ามันรันอยู่ตัวเดียว และตอนเทสก็มักจะเป็นแบบนั้นจริง ๆ แต่บน production มันซ้อนทับกัน และ transaction หนึ่งจะเห็นงานของอีกตัวแค่ไหนก็ขึ้นกับ **isolation level** ที่มันรันอยู่ ถ้า transaction ไม่ได้ขอ level ไว้ ก็จะได้ค่า default ของ engine และบน [PostgreSQL](../postgresql/) ค่า default นั้นคือ READ COMMITTED

diagram เล่นการรันสลับกันสามแบบซ้ำบน PostgreSQL 18.6 โดยแต่ละ session เป็น process `psql` แยกกัน และมี script ส่ง statement ตามลำดับที่กำหนดไว้ ทุกค่าที่เห็นเลยเป็นค่าที่ session ได้รับจริง:

- **report การเงิน** session A อ่าน `total_thb` ของ order 495179 (51,179.03) และจำนวน order ของลูกค้า 42 (179) ระหว่างนั้น B refund line 3 ของ order นั้น (3,985.43) แล้ว commit ส่วน C สร้าง order ใหม่ให้ลูกค้า 42 (id 500001) ที่ READ COMMITTED ตัว report ที่ยังอยู่ใน transaction เดียวกันก็อ่านได้ 47,193.60 และ 180: report เดียวกันมียอดรวมสองค่าและจำนวน order สองค่า
- **stock** พนักงานสองคนขาย product 2892 ที่มี stock 10 ชิ้น แต่ละคนอ่าน `qty` แล้วคำนวณ 9 ในแอป แล้วเขียนค่านั้นลงไป ส่วน `UPDATE` ของ B ก็รอ row lock ของ A พอ A commit ตัว B ก็เช็ก row ใหม่อีกรอบแล้วเขียน 9 เหมือนกัน ขายไปสองครั้ง แต่ stock ลดจาก 10 เหลือแค่ 9
- **กฎการอยู่เวร** หัวหน้ากะของคลังสินค้าสองคนคือ Anan กับ Malee ต้องมีอย่างน้อยหนึ่งคนอยู่เวร แต่ละคนลงจากเวรผ่านแอป ที่นับก่อนว่ามีหัวหน้ากะอยู่เวรกี่คน (2 คน เลยลงได้) แล้วค่อย update row ของตัวเอง ทั้งคู่ commit ได้ และไม่เหลือใครอยู่เวรเลย

ไม่มีเคสไหนขึ้น error เลย แต่ละ transaction ถูกต้องเมื่อดูแยกกัน ส่วน bug อยู่ในช่วงที่มันซ้อนกัน มันขึ้นกับจังหวะเวลา และแทบไม่โผล่ตอนเทส

## ทำงานยังไง

**anomaly ต่าง ๆ** แต่ละตัวคือแบบหนึ่งที่ transaction จะเห็นงานของ transaction ที่รันพร้อมกัน หรือโดนมันทำให้เสียหายได้:

| Anomaly | เกิดอะไรขึ้น | ในการรันของ Acme (READ COMMITTED) |
|---|---|---|
| Dirty read | transaction หนึ่งอ่านการเปลี่ยนแปลงที่อีกตัวยังไม่ commit และอาจยัง rollback ได้ | ไม่เกิดเลยใน PostgreSQL: ตอน refund ยังไม่ commit ตัว report ก็ยังอ่านได้ 51,179.03 |
| Non-repeatable read | row เดียวกันที่อ่านสองครั้งเปลี่ยนไป เพราะอีก transaction commit ในระหว่างนั้น | ยอดรวมเปลี่ยนจาก 51,179.03 เป็น 47,193.60 |
| Phantom | การค้นแบบเดียวกันที่รันสองครั้งได้ชุด row ไม่เหมือนกัน เพราะอีก transaction commit row ที่ตรงเงื่อนไขเข้ามา | จำนวน order ของลูกค้า 42 เปลี่ยนจาก 179 เป็น 180 |
| Lost update | สอง transaction อ่านค่าหนึ่ง แล้วต่างก็เขียนค่าที่คำนวณจากค่านั้น ทำให้การเขียนครั้งที่สองลบการเขียนครั้งแรกทิ้ง | ขายสองครั้ง stock 10 → 9 |
| Write skew | สอง transaction อ่านข้อมูลที่ทับซ้อนกัน แล้วต่างคนต่างเขียนคนละ row แต่ละตัวไม่มีปัญหาเมื่อรันเดี่ยว ๆ แต่พอรวมกันกลับทำให้กฎพัง | หัวหน้ากะทั้งคู่ลงจากเวร: อยู่เวร 0 คน |

**มาตรฐาน SQL บังคับอะไร** มาตรฐานนิยาม level ไว้สี่ระดับด้วย anomaly สามตัวแรก (มาตรฐานเรียกมันว่า phenomena) แล้วโยนที่เหลือทั้งหมดให้ SERIALIZABLE ที่ต้องให้ผลที่การรัน transaction ชุดเดียวกันทีละตัวสักลำดับหนึ่งให้ได้ ตัว SERIALIZABLE ยังเป็น level default ของมาตรฐานด้วย

| Level | Dirty read | Non-repeatable read | Phantom | PostgreSQL 18 |
|---|---|---|---|---|
| READ UNCOMMITTED | เกิดได้ | เกิดได้ | เกิดได้ | ทำงานเป็น READ COMMITTED: ไม่มี dirty read |
| READ COMMITTED | ห้าม | เกิดได้ | เกิดได้ | ตามมาตรฐาน |
| REPEATABLE READ | ห้าม | ห้าม | เกิดได้ | phantom ก็เกิดไม่ได้ |
| SERIALIZABLE | ห้าม | ห้าม | ห้าม | กัน anomaly ได้ทุกแบบ |

มาตรฐานกำหนดแค่ขั้นต่ำที่แต่ละ level ต้องกันได้ engine จะทำได้มากกว่านั้นก็ได้ อย่างที่ PostgreSQL ทำที่ READ UNCOMMITTED และ REPEATABLE READ ส่วนใน *A Critique of ANSI SQL Isolation Levels* (SIGMOD 1995) ทาง Berenson, Bernstein, Gray, Melton, O'Neil และ O'Neil แสดงให้เห็นว่า phenomena ถูกเขียนไว้กำกวม และใช้อธิบาย level ที่ระบบจริงใช้กันอยู่ไม่ได้ รวมถึง level แบบ lock คลาสสิกด้วย พวกเขาเสนอให้ตีความแต่ละ phenomenon แบบกว้าง เพิ่มตัวที่มาตรฐานไม่ได้พูดถึง (เช่น dirty write, lost update, read skew และ write skew) และนิยาม **snapshot isolation**: ทุก transaction อ่านจาก snapshot ของข้อมูล ณ ตอนที่มันเริ่ม และถ้าสอง transaction ที่รันพร้อมกันเขียน item เดียวกัน ก็มีแค่ตัวที่ commit ก่อนที่สำเร็จ ตัว snapshot isolation กัน anomaly สามตัวของมาตรฐานได้ถ้าตีความแบบเข้ม แต่มันก็ยังไม่ serializable เพราะมันยอมให้เกิด write skew ตัว paper นี้ยังแสดงด้วยว่า REPEATABLE READ แบบใช้ lock กับ snapshot isolation จัดอันดับกันไม่ได้: ตัวแรกยอมให้เกิด phantom ที่ snapshot isolation กันได้ และกัน write skew ที่ snapshot isolation ยอมให้เกิด นี่คือเหตุผลที่ "REPEATABLE READ" ให้การรับประกันไม่เหมือนกันในแต่ละ engine

**READ COMMITTED** ให้ทุก statement ได้ snapshot ใหม่ของสิ่งที่ commit แล้ว ณ ตอนที่ statement นั้นเริ่ม เรื่องของ report ก็มีแค่นี้: การอ่านยอดรวมครั้งที่สองตอนที่ refund ของ B ยังไม่ commit ยังเห็น 51,179.03 ส่วนการอ่านครั้งที่สามเริ่มหลัง B commit แล้วเลยเห็น 47,193.60 การเขียนที่เจอว่า row เป้าหมายถูก transaction ที่ยังไม่จบเปลี่ยนไปจะรอ transaction นั้น ถ้า transaction นั้น commit ตัว PostgreSQL จะเช็ก `WHERE` clause กับ version ใหม่ของ row อีกรอบ แล้วเขียนลงไปที่ version นั้น นี่คือเหตุผลที่ `UPDATE stock SET qty = 9` ของ B ผ่านไปได้หลัง A commit: row ยังตรงเงื่อนไขอยู่ แล้วเลข 9 ที่ B คำนวณจากการอ่านที่ค้างเก่าก็ไปทับเลข 9 ของ A

**REPEATABLE READ** คือ snapshot isolation ของ PostgreSQL ตัว transaction ถ่าย snapshot ครั้งเดียวตอน statement แรก (ไม่ใช่ตอน `BEGIN`) แล้วอ่านจากมันจนจบ transaction ทำให้ report อ่านได้ 51,179.03 และ 179 ทุกครั้ง ทั้งที่ refund กับ order ใหม่ commit อยู่รอบ ๆ ส่วนการเขียนจะเช็ก row เป้าหมายเทียบกับ snapshot: `UPDATE` ของ B รอ row lock ของ A และพอ A commit การเปลี่ยนแปลงที่ snapshot ของ B มองไม่เห็น ตัว B ก็ fail ด้วย `ERROR: could not serialize access due to concurrent update` ทุก serialization failure มี SQLSTATE `40001` แอปจะ rollback แล้วรันทั้ง transaction ใหม่ ที่คราวนี้อ่านได้ 9 แล้วเขียน 8 ส่วนกฎการอยู่เวรก็ยังพัง: Anan กับ Malee ต่างคน update คนละ row เลยไม่มีการเขียนที่ชนกันให้ตรวจเจอ และทั้งคู่ก็ commit ได้

**SERIALIZABLE** คือ snapshot isolation บวกการเช็ก serialization anomaly ที่เรียกว่า **Serializable Snapshot Isolation** (SSI) เทคนิคนี้เสนอโดย Cahill, Röhm และ Fekete (SIGMOD 2008) แล้ว PostgreSQL 9.1 ก็เป็น release ของ database สำหรับ production ตัวแรกที่ทำมันออกมา ตามที่ Ports และ Grittner อธิบายไว้ (VLDB 2012) แต่ละ serializable transaction บันทึกสิ่งที่มันอ่านไว้เป็น predicate lock ที่ `pg_locks` แสดงด้วย mode `SIReadLock` โดย lock พวกนี้ไม่เคย block ใคร ในการรันเรื่องการอยู่เวร แต่ละ session ถือไว้สองตัว: ตัวหนึ่งบนทั้ง table `shift_leads` เพราะการนับใช้ sequential scan และอีกตัวบน page 1 ของ `shift_leads_pkey` ที่ `UPDATE … WHERE id = …` ของมันอ่าน พอ transaction หนึ่งเขียนข้อมูลที่อีกตัวที่รันพร้อมกันอ่านไป ตัว PostgreSQL ก็บันทึก read/write conflict ระหว่างสองตัวนั้นไว้ ทุก anomaly ที่ snapshot isolation ยอมให้เกิดจะมี "dangerous structure" อยู่ข้างใน: คือ transaction หนึ่งตัวที่เป็น pivot ที่มี read/write conflict ทั้งขาเข้าหนึ่งตัวและขาออกอีกหนึ่งตัว ตรงนี้ B อ่าน row ของ Anan ที่ A เปลี่ยนทีหลัง และ A อ่าน row ของ Malee ที่ B เปลี่ยนทีหลัง ทำให้ B เป็น pivot ตัว A commit ก่อน แล้ว `COMMIT` ของ B ก็ fail ด้วย `could not serialize access due to read/write dependencies among transactions` พร้อม detail `Canceled on identification as a pivot, during commit attempt` พอ retry ตัว B นับได้ว่ามีหัวหน้ากะอยู่เวร 1 คน แอปเลยให้ Malee อยู่เวรต่อ การเช็กนี้อาจรายงาน failure ในจุดที่ไม่มี anomaly จริงก็ได้ แบบนั้นเสียแค่การ retry เพิ่มอีกรอบ แต่ไม่มีทางให้ผลที่ผิด

| สิ่งที่การรันของเราเห็นบน PostgreSQL 18.6 | READ COMMITTED | REPEATABLE READ | SERIALIZABLE |
|---|---|---|---|
| Dirty read | ไม่เกิด | ไม่เกิด | ไม่เกิด |
| Non-repeatable read | เกิด: 47,193.60 | ไม่เกิด | ไม่เกิด |
| Phantom | เกิด: 180 | ไม่เกิด | ไม่เกิด |
| Lost update | เกิด: stock 9 | `40001` แล้ว retry: 8 | `40001` แล้ว retry: 8 |
| Write skew | เกิด: อยู่เวร 0 คน | เกิด: อยู่เวร 0 คน | `40001` แล้ว retry: Malee อยู่ต่อ |

## ลองรันดู

ข้อมูลตัวอย่างมาจาก [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop) ที่เป็น script สร้าง template database `acme` บน PostgreSQL 18 ในเวลาราวหนึ่งนาที

รันใน `psql` โดยต่อเข้าไปเป็น superuser ตัว session ของ `psql` คือ A ส่วน session B และ C คือ connection ที่สองและที่สามที่เปิดด้วย extension `dblink` ที่มากับ PostgreSQL อยู่แล้ว ตัว server เปิด connection พวกนั้นเองผ่าน local socket โดยไม่ใช้ password แบบที่ Docker image ทางการยอมให้ทำได้ ถ้ารันที่อื่นให้เพิ่ม host และ password ลงใน connection string ตัว `dblink_send_query` เริ่ม `UPDATE` ของ B โดยไม่รอให้มันเสร็จ เพื่อให้ A commit ได้ระหว่างที่ B รอ lock ของ A อยู่ ตัว comment แสดงผลของการรันหนึ่งรอบ ส่วน level ที่เขียนไว้ใน comment ตรง `BEGIN` แต่ละตัวจะให้ผลอื่น ๆ ใน table ข้างบน

```sql
CREATE DATABASE isolation_levels_try TEMPLATE acme STRATEGY FILE_COPY;
\c isolation_levels_try
CREATE EXTENSION dblink;
CREATE TABLE stock (product_id bigint PRIMARY KEY REFERENCES products, qty int NOT NULL);
INSERT INTO stock VALUES (2892, 10);
CREATE TABLE shift_leads (id int PRIMARY KEY, name text NOT NULL, on_duty boolean NOT NULL);
INSERT INTO shift_leads VALUES (1, 'Anan', true), (2, 'Malee', true);
SELECT dblink_connect('b', 'dbname=isolation_levels_try');   -- session B
SELECT dblink_connect('c', 'dbname=isolation_levels_try');   -- session C
\set tot 'SELECT total_thb FROM orders WHERE id = 495179'
\set cnt 'SELECT count(*) FROM orders WHERE customer_id = 42'

-- 1. The report (this session, A) while B refunds and C places an order
BEGIN ISOLATION LEVEL READ COMMITTED;   -- then run it again with REPEATABLE READ
:tot;                                                       -- 51179.03
:cnt;                                                       -- 179
SELECT dblink_exec('b', 'BEGIN');
SELECT dblink_exec('b', 'UPDATE orders SET total_thb = total_thb - 3985.43 WHERE id = 495179');
:tot;                                                       -- 51179.03  (B not committed)
SELECT dblink_exec('b', 'COMMIT');
SELECT * FROM dblink('c', $$INSERT INTO orders (customer_id, status, shipping_country, created_at, total_thb)
  VALUES (42, 'pending', 'TH', '2026-10-02 18:00+00', 1290.00) RETURNING id$$) AS t(id bigint);   -- 500001
:tot;                                                       -- 47193.60  REPEATABLE READ: 51179.03
:cnt;                                                       -- 180       REPEATABLE READ: 179
COMMIT;
UPDATE orders SET total_thb = 51179.03 WHERE id = 495179;   -- undo, for the next run
DELETE FROM orders WHERE id > 500000;
SELECT setval(pg_get_serial_sequence('orders', 'id'), 500000);

-- 2. Two staff sell product 2892: read the stock, then write the new value
BEGIN ISOLATION LEVEL REPEATABLE READ;  -- READ COMMITTED: B's UPDATE returns UPDATE 1; committed, it leaves 9
SELECT qty FROM stock WHERE product_id = 2892;              -- 10
SELECT dblink_exec('b', 'BEGIN ISOLATION LEVEL REPEATABLE READ');
SELECT * FROM dblink('b', 'SELECT qty FROM stock WHERE product_id = 2892') AS t(qty int);   -- 10
UPDATE stock SET qty = 9 WHERE product_id = 2892;
SELECT dblink_send_query('b', 'UPDATE stock SET qty = 9 WHERE product_id = 2892');   -- B waits for A
SELECT pg_sleep(0.5);
COMMIT;
SELECT * FROM dblink_get_result('b', false) AS t(status text);
-- NOTICE:  could not serialize access due to concurrent update        (SQLSTATE 40001)
SELECT * FROM dblink_get_result('b') AS t(status text);    -- (0 rows): B's connection is free
SELECT dblink_exec('b', 'ROLLBACK');                        -- B retries in a new transaction
SELECT dblink_exec('b', 'BEGIN ISOLATION LEVEL REPEATABLE READ');
SELECT * FROM dblink('b', 'SELECT qty FROM stock WHERE product_id = 2892') AS t(qty int);   -- 9
SELECT dblink_exec('b', 'UPDATE stock SET qty = 8 WHERE product_id = 2892');
SELECT dblink_exec('b', 'COMMIT');
SELECT qty FROM stock WHERE product_id = 2892;              -- 8

-- 3. Write skew: at least one shift lead must stay on duty
BEGIN ISOLATION LEVEL SERIALIZABLE;     -- with REPEATABLE READ, both commit and 0 stay on duty
SELECT count(*) FROM shift_leads WHERE on_duty;             -- 2
SELECT dblink_exec('b', 'BEGIN ISOLATION LEVEL SERIALIZABLE');
SELECT * FROM dblink('b', 'SELECT count(*) FROM shift_leads WHERE on_duty') AS t(n bigint);   -- 2
UPDATE shift_leads SET on_duty = false WHERE id = 1;
SELECT dblink_exec('b', 'UPDATE shift_leads SET on_duty = false WHERE id = 2');
SELECT mode, locktype, relation::regclass, page FROM pg_locks WHERE mode = 'SIReadLock' ORDER BY pid, 2;
--     mode    | locktype |     relation     | page    (one row like these per session)
--  SIReadLock | page     | shift_leads_pkey |    1
--  SIReadLock | relation | shift_leads      |
COMMIT;
SELECT dblink_exec('b', 'COMMIT');
-- ERROR:  could not serialize access due to read/write dependencies among transactions
-- DETAIL:  Reason code: Canceled on identification as a pivot, during commit attempt.
SELECT name, on_duty FROM shift_leads ORDER BY id;          -- Anan f, Malee t
```

## ใช้ตอนไหนดี

เลือก level ทีละ transaction ตามสิ่งที่ transaction นั้นต้องการ:

- **READ COMMITTED** เหมาะกับ transaction ส่วนใหญ่ที่ทำงานจบใน statement เดียว: `UPDATE stock SET qty = qty - 1 WHERE product_id = 2892 AND qty > 0` อ่านและเขียน row ปัจจุบันในขั้นเดียว การขายที่เกิดพร้อมกันเลยต่อคิวกันที่ row lock และไม่มีตัวไหนหาย แต่มันเป็น level ที่ผิดสำหรับการอ่าน แล้วตัดสินใจในแอป แล้วค่อยเขียนจากผลการอ่านนั้น ยกเว้นการอ่านนั้น lock row ที่มันพึ่งพาไว้ (ดูข้างล่าง)
- **REPEATABLE READ** เหมาะกับ report และ export ที่รันหลาย query แล้วต้องการให้ผลตรงกัน อย่าง report การเงิน ที่ level นี้ transaction ที่อ่านอย่างเดียวจะไม่ fail ด้วย serialization error เลย ส่วน transaction ที่อ่าน ตัดสินใจ แล้วเขียน row เดียวกัน จะได้ `40001` แทนที่จะเกิด lost update และต้อง retry
- **SERIALIZABLE** เหมาะกับกฎที่ครอบหลาย row หรือหลาย table และไม่มี constraint ไหนเขียนแทนได้: มีหัวหน้ากะอยู่เวรอย่างน้อยหนึ่งคน, ไม่จองห้องซ้อนกัน, วงเงินเครดิตที่รวมทุกบัญชีของลูกค้า แต่ละ transaction แค่ต้องถูกต้องเมื่อรันเดี่ยว ๆ แล้ว database จะ rollback ตัวไหนก็ตามที่ผลของการรันพร้อมกันอาจต่างจากการรันทีละตัว ทุก transaction ที่เกี่ยวข้อง รวมถึงตัวที่อ่านอย่างเดียว ต้องมี retry loop
- **lock แบบ explicit** คือทางเลือกที่ READ COMMITTED ถ้ารู้ว่าการตัดสินใจพึ่งพา row ไหน `SELECT qty FROM stock WHERE product_id = 2892 FOR UPDATE` ทำให้ B รอตั้งแต่ตอนอ่าน แล้ว B ก็อ่านได้ 9 และเขียน 8 โดยไม่ต้อง retry ส่วนกฎการอยู่เวร คำสั่ง `SELECT id, name FROM shift_leads WHERE on_duty FOR UPDATE` จะ lock row ของหัวหน้ากะทั้งสองคน: B รอ A แล้วได้แค่ row ของ Malee เพราะ row ของ Anan ไม่ตรงเงื่อนไขอีกต่อไป ส่วน lock ปกป้อง row ที่ยังไม่มีอยู่ไม่ได้ ถ้าเป็น phantom insert ต้องใช้ SERIALIZABLE, unique constraint หรือ exclusion constraint หรือ lock บน row แม่
- **constraint** ดีกว่าทุกตัวข้างบนในจุดที่ใช้ได้: `CHECK (qty >= 0)` คู่กับ `UPDATE` แบบ statement เดียว, unique index, exclusion constraint ที่กันการจองที่ทับซ้อนกัน

## ได้อะไร เสียอะไร

- **retry กิน throughput ตอนที่แย่งกันเยอะ** pgbench แปด session ขาย product 2892 นาน 10 วินาทีต่อแบบ (median ของการรันสามครั้งบน laptop ที่เป็นเครื่องใช้ร่วมกัน ให้มองตัวเลขเป็นค่าคร่าว ๆ):

  | แต่ละการขาย update stock ยังไง | ขายได้ใน 10 s | Retry | ยอมแพ้หลังลอง 10 ครั้ง | stock ที่ลดลง |
  |---|---|---|---|---|
  | READ COMMITTED อ่านแล้วเขียน | 8,537 | 0 | 0 | 1,090 (หายไป 7,447 ครั้ง) |
  | REPEATABLE READ อ่านแล้วเขียน | 2,707 | 17,059 | 1,841 | 2,707 |
  | READ COMMITTED, `SELECT … FOR UPDATE` | 6,902 | 0 | 0 | 6,902 |
  | READ COMMITTED, `UPDATE … SET qty = qty - 1` | 9,718 | 0 | 0 | 9,718 |

  pgbench แค่รัน transaction ที่ fail ซ้ำหลัง rollback ส่วนโค้ดจริงควรรอระหว่างแต่ละรอบด้วย [backoff และ jitter](../retry-with-backoff/) และจำกัดจำนวนรอบไว้ด้วย ส่วน conflict แบบนี้เกิดแค่ระหว่าง transaction ที่เขียน row เดียวกัน row ร้อนตัวเดียวเลยเป็นกรณีที่แย่ที่สุด ถ้ากระจายไปหลาย product โหลดเท่ากันจะชนกันน้อยกว่ามาก
- **retry ทั้ง transaction และเฉพาะตัว transaction เท่านั้น** รันทุกอย่างใหม่ตั้งแต่ `BEGIN` รวมถึงการอ่านและ logic ในแอปที่เลือกค่าต่าง ๆ เพราะข้อมูลที่มันใช้ตัดสินใจเปลี่ยนไปแล้ว ตัว PostgreSQL ไม่ retry ให้เอง ต้อง retry `40001` เสมอ และ error deadlock `40P01` ด้วย (ดู [Locks & Deadlocks](../locks-and-deadlocks/)) เก็บ side effect อย่าง email, payment และ message ไว้นอกส่วนที่ retry หรือทำให้มันรันซ้ำได้อย่างปลอดภัยด้วย idempotency key ([Idempotent Consumer](../idempotent-consumer/))
- **transaction ที่ยาวเจ็บหนักกว่าที่ level สูง** transaction แบบ REPEATABLE READ หรือ SERIALIZABLE เก็บ snapshot ของมันไว้จนจบ ยิ่งรันนาน ก็ยิ่งมีการเปลี่ยนแปลงที่รันพร้อมกันให้ชนได้มากขึ้น ที่ SERIALIZABLE ตัว SIRead lock ของมันมักอยู่นานกว่า commit จนกว่า transaction แบบอ่านเขียนที่รันซ้อนกับมันจะจบ ส่วน snapshot ที่เปิดค้างอยู่ก็ทำให้การเก็บกวาด row version เก่าต้องรอด้วย ([MVCC](../mvcc/)) ให้ transaction สั้นเข้าไว้ รัน report ยาว ๆ เป็น `SERIALIZABLE READ ONLY DEFERRABLE` (มันอาจรอ snapshot ที่ปลอดภัยหนึ่งครั้ง แล้วหลังจากนั้นก็ไม่มีทาง fail และไม่ทำให้ตัวอื่น fail ด้วย serialization error) และตั้ง `idle_in_transaction_session_timeout` หรือ `transaction_timeout` (PostgreSQL 17 ขึ้นไป)
- **SSI ต้องดูแลนิดหน่อย** sequential scan จะถือ predicate lock บนทั้ง table ทำให้มีโอกาสเกิด false-positive failure มากขึ้น ส่วน index ช่วยให้ lock แคบลง พอ table ของ predicate lock มี memory ไม่พอ ตัว PostgreSQL จะรวม lock เป็นตัวที่หยาบขึ้น ทำให้ failure เพิ่มขึ้นอีก (`max_pred_locks_per_transaction` และค่าที่คล้ายกันใช้เพิ่ม limit ได้) ประกาศ transaction ที่อ่านอย่างเดียวเป็น `READ ONLY` ใช้ pool คุมจำนวน connection ที่ active ไว้ให้น้อย และเอา lock แบบ explicit ที่ไม่จำเป็นแล้วเมื่อใช้ SERIALIZABLE ออกไป
- **lock แบบ explicit แลก retry กับการรอ** session ที่รออยู่ก็ถือ connection ไว้ และสอง transaction ที่ lock row ชุดเดียวกันคนละลำดับจะเกิด deadlock
- **isolation จบอยู่ที่ database** business process ที่กระจายไปหลาย service และหลาย database ไม่ได้ isolation ระหว่าง local transaction ของมันเลย [saga](../saga-orchestration/) ต้องออกแบบรับสถานะระหว่างทางและชดเชยแทน ส่วน [optimistic concurrency](../optimistic-concurrency/) ที่ใช้ version column ช่วยปกป้อง record ในช่วงที่ user กำลังคิด ช่วงที่ไม่มี transaction ไหนเปิดค้างไว้ได้

## ข้อควรรู้ตอนลงมือทำ

- **ตั้งค่า level** ใช้ `BEGIN ISOLATION LEVEL …` หรือ `SET TRANSACTION ISOLATION LEVEL …` ก่อน query แรกของ transaction ส่วน `default_transaction_isolation` เปลี่ยนค่า default ของ session, role (`ALTER ROLE … SET`) หรือ database ได้ และ driver ส่วนใหญ่ก็ให้ตั้ง level บน connection หรือ transaction object ให้เช็กว่า driver ของคุณส่งค่านี้ไปจริง อย่าเดาเอา
- **error code** serialization failure มี SQLSTATE `40001` (`serialization_failure`) เสมอ ไม่ว่าข้อความจะเป็นอะไร ส่วน deadlock มี `40P01` ตัว unique violation (`23505`) ก็อาจเป็นปัญหา serialization ที่แฝงมาได้ เช่น สอง transaction ที่ต่างก็เช็กแล้วว่า key ยังว่าง แล้วก็ insert key นั้น เอกสารของ PostgreSQL แนะนำให้ retry เคสพวกนี้เฉพาะตอนที่น่าจะเกิดจากสาเหตุนี้ เพราะมันอาจเป็น error ถาวรได้ด้วย
- **MySQL 8.4 (InnoDB)** ใช้ REPEATABLE READ เป็น default ตัว `SELECT` ธรรมดาเป็น consistent read จาก snapshot ที่ถ่ายไว้ตอนการอ่านครั้งแรกของ transaction ทำให้บน MySQL ตัว report เห็น 51,179.03 ตลอด ส่วน locking read (`FOR SHARE`, `FOR UPDATE`), `UPDATE` และ `DELETE` ทำงานกับ row ล่าสุดที่ commit แล้วแทน: มัน lock สิ่งที่มันเจอ และถ้าเป็น range ก็ lock ช่องว่างระหว่าง index record ด้วย (next-key lock) ทำให้ session อื่น insert เข้ามาใน range นั้นไม่ได้ `SELECT count(*) … FOR SHARE` บนลูกค้า 42 ทำให้ insert ของลูกค้า 42 ที่เกิดพร้อมกันต้องรอ ส่วน InnoDB ต่างจาก REPEATABLE READ ของ PostgreSQL ตรงที่มันไม่ทำให้การเขียน row ที่เปลี่ยนไปหลัง snapshot fail: การขายบน MySQL ทำ update หายไปโดยไม่มี error ตัว `UPDATE` ของ B รายงาน `Rows matched: 1, Changed: 0` และ stock จบที่ 9 แต่ถ้าใส่ `FOR UPDATE` ให้การอ่าน stock ก็จะจบที่ 8 ที่ SERIALIZABLE ตัว InnoDB จะเปลี่ยน `SELECT` ธรรมดาเป็น `SELECT … FOR SHARE` ตอนที่ปิด autocommit ไว้ ทำให้ทั้งสอง session ถือ shared lock ไว้ แล้ว `UPDATE` ของ B ก็เจอ deadlock (`ERROR 1213 (40001)`) และถูก rollback ส่วนการรัน write skew ก็ fail แบบเดียวกัน ส่วน READ UNCOMMITTED บน InnoDB อ่านข้อมูลที่ยังไม่ commit จริง ๆ: report ของเราอ่านได้ 47,193.60 ตอนที่ refund ยังเปิดอยู่
- **SQL Server** ใช้ READ COMMITTED เป็น default ถ้าปิด database option `READ_COMMITTED_SNAPSHOT` ไว้ (ค่า default ของ SQL Server และ Azure SQL Managed Instance) การอ่านจะถือ shared lock และรอ writer ถ้าเปิดไว้ (ค่า default บน Azure SQL Database) แต่ละ statement จะอ่านจาก snapshot ของ row version แทน ไม่ว่าแบบไหนก็เป็นระดับ statement ทั้งนั้น anomaly ของ report, lost update และ write skew เลยยังเกิดได้ ส่วน level `SNAPSHOT` (หลังเปิด `ALLOW_SNAPSHOT_ISOLATION ON`) เป็น snapshot isolation ระดับ transaction ที่จบ transaction ด้วย error 3960 เมื่อ update ชนกัน ส่วน SERIALIZABLE ของมันใช้ key-range lock ที่ถือไว้จนจบ transaction
- **Oracle Database** ใช้ READ COMMITTED เป็น default และมี SERIALIZABLE กับ READ ONLY ให้ใช้ ตัว SERIALIZABLE ของมันอ่านจาก snapshot ที่ถ่ายไว้ตอน transaction เริ่ม แล้ว fail ด้วย `ORA-08177` ตอนพยายามเปลี่ยน row ที่ transaction อื่นเปลี่ยนและ commit หลังจุดนั้น คล้าย REPEATABLE READ ของ PostgreSQL มาก
- **managed service** บน [Amazon RDS & Aurora](../amazon-rds-aurora/) คุณรันตัว engine เองพร้อม level ของมัน มีความต่างหนึ่งข้อที่มีในเอกสาร: writer ของ cluster Aurora MySQL มี level สี่ระดับเหมือน RDS for MySQL แต่ read-only replica ของมันใช้ REPEATABLE READ เสมอและไม่สน `SET TRANSACTION ISOLATION LEVEL` ยกเว้น session จะเปิด `aurora_read_replica_read_committed` เพื่อรัน query ยาว ๆ ที่ READ COMMITTED ส่วน [Amazon DynamoDB](../amazon-dynamodb/) ไม่มี level ให้เลือก: `TransactWriteItems` และ `TransactGetItems` เป็น serializable เมื่อเทียบกับการเขียนอื่นและกับ `GetItem` ส่วน `Query`, `Scan` และ `BatchGetItem` ทั้งก้อนเป็นแค่ read-committed เมื่อเทียบกับ transaction ถ้าเป็นการอ่านแล้วเขียน item เดียว conditional write ที่เช็ก version attribute จะตรวจเจอ conflict แล้วแอปก็ retry ([Optimistic Concurrency Control](../optimistic-concurrency/))
- **การรันใน diagram** ใช้สำเนาของข้อมูลตัวอย่างบน PostgreSQL 18.6 และ server MySQL 8.4.11 แต่ละ session เป็น client process แยกกัน ที่มี script ป้อน statement ให้ตามลำดับที่แสดง โดยหยุดครึ่งวินาทีถึงหนึ่งวินาทีทุกครั้งที่ session หนึ่งต้องรอ lock ของอีกตัว
