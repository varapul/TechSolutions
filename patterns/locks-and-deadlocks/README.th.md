## ปัญหา

ลูกค้า 1050 ขอให้ Acme Shop cancel order ที่จ่ายเงินแล้วทั้งสองตัวของเขา คือ 497003 และ 499846 แล้ว operator ก็เปิด psql แล้วรัน back-office script ด้วยมือ: `BEGIN`, UPDATE ของ 497003 แล้วก็มีโทรศัพท์เข้ามา ทั้งที่ transaction ยังเปิดอยู่ ใน [PostgreSQL](../postgresql/) ไม่มีอะไร timeout โดย default ทำให้ row lock ที่ UPDATE นั้นถือไว้ยังอยู่ จนกว่า session จะ commit, rollback หรือหลุด connection นี่คือการรันหนึ่งรอบบน PostgreSQL 18.6 โดยนับเวลาเป็นวินาทีจาก statement แรกของ script (รันหนึ่งรอบบน laptop):

| t (s) | A · back-office script | B · warehouse job | C · shop app | D · หน้าจอ support |
|---|---|---|---|---|
| 0.0 | `BEGIN; UPDATE orders SET status = 'cancelled' WHERE id = 497003;` → `UPDATE 1` แล้วก็ไม่ทำอะไรต่อ | | | |
| 1.0 | | `BEGIN; UPDATE orders SET status = 'shipped' WHERE id = 499846;` → `UPDATE 1` แล้วสั่งแบบเดียวกันกับ 497003 ที่ต้องรอ | | |
| 2.0 | | | `UPDATE orders SET shipping_country = 'TH' WHERE id = 497003;` รอ | |
| 3.0 | | | | `SELECT id, status FROM orders WHERE id = 497003;` → `paid` ใน 3 ms |
| 20.0 | `UPDATE orders SET status = 'cancelled' WHERE id = 499846;` รอ | | | |
| 21.0 | `ERROR: deadlock detected` (SQLSTATE 40P01) | `UPDATE 1` หลัง 20.0 s แล้ว `COMMIT` | `UPDATE 1` หลัง 19.0 s | |

ไม่มี statement ไหนช้าในความหมายปกติเลย แต่ละตัวใช้แค่ไม่กี่ millisecond และที่ 10 s ตัว `pg_stat_activity` แสดงว่า script อยู่ในสถานะ `idle in transaction` ส่วน writer อีกสองตัวอยู่ใน `Lock` wait ไม่ได้ใช้ CPU หรือ I/O: เวลาหมดไปกับการรอ session ที่ไม่ได้ทำอะไรเลย บน production ตัวที่รอคือ web request ที่แต่ละตัวถือ connection ของ pool ไว้ ฝั่งที่เรียกก็ timeout แล้ว retry และทุกการ retry ก็ไปต่อคิวเดียวกัน พอ operator กลับมา ตัว UPDATE ถัดไปของ script ขอ order 499846 ที่ warehouse job lock ไว้ก่อนแล้ว ทำให้ตอนนี้แต่ละ transaction รอกันและกัน PostgreSQL แก้ deadlock นี้ในอีกหนึ่งวินาทีต่อมาด้วยการ abort transaction ของ script: การ cancel ถูก rollback และ order ทั้งสองตัวก็ถูกส่งออกไป

## ทำงานยังไง

**lock สองระดับ** ทุก statement ถือ lock ระดับ table บน table ที่มันใช้ และ statement ที่เปลี่ยน row ก็ lock row พวกนั้นด้วย ตัว PostgreSQL มี mode ระดับ table แปดแบบ ถึงจะมีชื่ออย่าง ROW EXCLUSIVE แต่ทุกตัวก็ lock ทั้ง table และต่างกันแค่ว่ามันชนกับ mode ไหนบ้าง ตัวที่สำคัญในงานประจำวัน (เอกสารมี conflict table แบบเต็มที่มี SHARE ROW EXCLUSIVE และ EXCLUSIVE ด้วย):

| Table lock mode | ใครถือ | ชนกับ |
|---|---|---|
| `ACCESS SHARE` | `SELECT` | `ACCESS EXCLUSIVE` เท่านั้น |
| `ROW SHARE` | `SELECT … FOR UPDATE` และ locking read อื่น ๆ | `EXCLUSIVE`, `ACCESS EXCLUSIVE` |
| `ROW EXCLUSIVE` | `INSERT`, `UPDATE`, `DELETE`, `MERGE` | `SHARE`, `SHARE ROW EXCLUSIVE`, `EXCLUSIVE`, `ACCESS EXCLUSIVE` |
| `SHARE UPDATE EXCLUSIVE` | `VACUUM` (ไม่ใช่ `FULL`), `ANALYZE`, `CREATE INDEX CONCURRENTLY`, `VALIDATE CONSTRAINT` | ตัวเอง และทุก mode ตั้งแต่ `SHARE` ขึ้นไป |
| `SHARE` | `CREATE INDEX` | `ROW EXCLUSIVE`, `SHARE UPDATE EXCLUSIVE` และทุก mode ที่สูงกว่า `SHARE` |
| `ACCESS EXCLUSIVE` | `DROP TABLE`, `TRUNCATE`, `VACUUM FULL`, `ALTER TABLE` หลายรูปแบบ, `LOCK TABLE` | ทั้งแปด mode รวมถึง `SELECT` ธรรมดา |

`ROW EXCLUSIVE` ไม่ชนกับตัวเอง ทำให้ writer ที่แตะคนละ row ไม่ต้องรอกันที่ระดับ table เลย การชนกันของมันเกิดที่ row ที่มี lock mode ของตัวเองอีกสี่แบบ:

| Row lock mode | ใครถือ | block อะไร |
|---|---|---|
| `FOR KEY SHARE` | `SELECT … FOR KEY SHARE`, การเช็ก foreign key | `FOR UPDATE` เท่านั้น |
| `FOR SHARE` | `SELECT … FOR SHARE` | `FOR NO KEY UPDATE`, `FOR UPDATE` |
| `FOR NO KEY UPDATE` | `UPDATE` ที่ไม่เปลี่ยน key column, `SELECT … FOR NO KEY UPDATE` | `FOR SHARE`, `FOR NO KEY UPDATE`, `FOR UPDATE` |
| `FOR UPDATE` | `SELECT … FOR UPDATE`, `DELETE`, `UPDATE` ที่เปลี่ยน key column | ทั้งสี่ mode |

key column ตรงนี้คือ column ที่มี unique index ที่ foreign key ใช้ได้ ส่วน lock แบบอ่อนของการเช็ก foreign key ก็คือเหตุผลที่ยังเพิ่ม order item ให้ order ที่ถูก lock อยู่ได้: ตอนที่ A ถือ 497003 อยู่ คำสั่ง `INSERT INTO order_items (order_id, …) VALUES (497003, …)` ก็ผ่านไปได้ใน 3 ms เพราะ `FOR KEY SHARE` ของมันไม่ชนกับ `FOR NO KEY UPDATE` ของ A ส่วน `SELECT` ธรรมดาไม่ถือ row lock เลย

**row lock ถูกเขียนลงไปใน row** transaction หนึ่งอาจ lock row เป็นล้าน ๆ row ได้ PostgreSQL เลยไม่เก็บ row lock ไว้ใน shared memory แต่เก็บ ID ของ transaction ที่ lock ไว้ใน `xmax` ของ row version พร้อม flag bit ที่บอกความแรงของ lock ตามที่ [README.tuplock](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/access/heap/README.tuplock) ของ heap อธิบายไว้ หลัง UPDATE ของ A ตัว version ของ 497003 ที่ ctid (774,54) มี `xmax = 165763` ที่เป็น transaction ID ของ A และ `pgrowlocks` รายงานว่ามันเป็น lock แบบ `No Key Update` ที่ pid 14562 ถืออยู่ นี่คือเหตุผลที่จำนวน row ที่ lock ได้ไม่มีขีดจำกัด ที่ `SELECT … FOR UPDATE` ต้องเขียนลง table และที่ปกติ `pg_locks` ไม่แสดง row lock เลย

**คิว** transaction ที่เปลี่ยนข้อมูลจะถือ exclusive lock บน transaction ID ของตัวเองไว้จนจบ และการรอ transaction อื่นก็คือการขอ share lock บน ID นั้น ตัว writer ที่เจอ row ที่ถูก lock จะรอเป็นสองขั้น: ขั้นแรกมันถือ heavyweight `tuple` lock บน row version นั้น ที่ใช้ตัดสินว่าใครได้ไปต่อ แล้วค่อยรอ transaction ID ของตัวที่ถือ lock อยู่ ตัว `pg_locks` ที่ 20.5 s แสดงแบบนั้นเป๊ะ ๆ ใน row ของ `transactionid` และ `tuple`:

| application_name | locktype | xid / tuple | mode | granted |
|---|---|---|---|---|
| back-office | transactionid | 165763 | ExclusiveLock | t |
| warehouse | transactionid | 165764 | ExclusiveLock | t |
| shop-app | transactionid | 165765 | ExclusiveLock | t |
| warehouse | tuple | (774,54) | ExclusiveLock | t |
| warehouse | transactionid | 165763 | ShareLock | **f** |
| shop-app | tuple | (774,54) | ExclusiveLock | **f** |
| back-office | tuple | (2194,90) | ExclusiveLock | t |
| back-office | transactionid | 165764 | ShareLock | **f** |

warehouse job อยู่หัวคิวของ row (774,54) และรอ transaction 165763 ส่วน shop app รอ tuple lock อยู่ข้างหลังมัน ส่วน `pg_stat_activity` รายงานเรื่องเดียวกันเป็น wait event คือ `Lock: transactionid` สำหรับตัวที่อยู่หัวคิว และ `Lock: tuple` สำหรับตัวที่เหลือ พอ transaction ของ A จบ ตัว B ก็ได้ row ไป แล้ว C ก็ตาม B ไปตามลำดับที่มาถึง ส่วน reader ไม่ได้อยู่ในคิวนี้: หน้าจอ support อ่าน version ล่าสุดที่ commit แล้วคือ `paid` ได้ใน 3 ms เพราะภายใต้ [MVCC](../mvcc/) ตัว SELECT ธรรมดาไม่เคยรอ row lock

**การตรวจหา deadlock** การหา deadlock ต้องเสียเวลา ตัว PostgreSQL เลยไม่หาตั้งแต่ตอนที่เริ่มรอ โดย process ที่รออยู่จะตั้ง timer ไว้เท่ากับ `deadlock_timeout` ที่ default เป็น 1 s และจะค้น wait-for graph ก็ต่อเมื่อ timer ดังแล้วมันยังรออยู่ ปกติมันจะไม่เจออะไรแล้วก็กลับไปหลับต่อ แบบเดียวกับที่การเช็กของ B และ C น่าจะทำไปตอนรอได้หนึ่งวินาที การเช็กของ A รันที่ 21.0 s หนึ่งวินาทีหลัง UPDATE ตัวที่สองของมันเริ่มรอ แล้วก็เจอ A → B → A และแก้ด้วยการ abort transaction ของ A เอง ตาม [README ของ lock manager](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/storage/lmgr/README) ผลแบบนี้คือแบบที่เกิดบ่อยที่สุด ส่วนเอกสารเตือนว่าอย่าไปพึ่งว่า transaction ไหนจะถูกเลือก ตัว psql แสดงผลแบบนี้:

```
ERROR:  deadlock detected
DETAIL:  Process 14562 waits for ShareLock on transaction 165764; blocked by process 14564.
Process 14564 waits for ShareLock on transaction 165763; blocked by process 14562.
HINT:  See server log for query details.
CONTEXT:  while updating tuple (2194,90) in relation "orders"
```

server log จะมี statement ของทั้งสอง process เพิ่มเข้ามา ส่วน SQLSTATE 40P01 บอกแอปให้ rollback แล้วรันทั้ง transaction ใหม่ พอ lock ของ A หายไป ตัว B ก็เสร็จหลัง 20.0 s และ C หลัง 19.0 s

**ใคร block ใคร** `pg_blocking_pids(pid)` คืน session ที่ process หนึ่งกำลังรอ: ทั้งตัวที่ถือ lock ที่ชนกัน และตัวที่ต่อคิวอยู่ข้างหน้าด้วยคำขอที่ชนกัน ที่ 20.5 s มันคืน `{14564}` สำหรับ A, `{14562}` สำหรับ B และ `{14564}` สำหรับ C ได้เป็น wait-for graph พร้อม cycle ของมัน ส่วน query ข้างล่างนี้ควรเก็บไว้ใกล้มือ (แต่ละครั้งที่เรียกต้องเข้าถึง shared state ของ lock manager แบบ exclusive ช่วงสั้น ๆ เลยอย่ารันมันใน loop ถี่ ๆ):

```sql
SELECT pid, application_name, state, wait_event_type, wait_event,
       pg_blocking_pids(pid) AS blocked_by,
       now() - state_change AS in_state, left(query, 60) AS query
FROM pg_stat_activity
WHERE cardinality(pg_blocking_pids(pid)) > 0 OR state = 'idle in transaction';
```

`log_lock_waits` ที่ปิดอยู่โดย default จะ log ทุกการรอที่นานกว่า `deadlock_timeout` และ PostgreSQL 18 เพิ่ม `log_lock_failures` สำหรับ lock ที่ `NOWAIT` ขอไม่สำเร็จ

## ลองรันดู

ข้อมูลตัวอย่างมาจาก [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop) ที่เป็น script สร้าง template database `acme` บน PostgreSQL 18 ในเวลาราวหนึ่งนาที

script นี้เล่นสอง session พร้อมกัน: มันเปิด session ที่สองด้วย extension `dblink` ที่มากับ PostgreSQL อยู่แล้ว ให้รันเป็น `postgres` เพราะ dblink ต่อแบบไม่ใช้ password ได้แค่กับ superuser ส่วน comment แสดง output ที่สำคัญ และ ID ของ process กับ transaction จะต่างกันทุกครั้งที่รัน

```sql
-- CREATE DATABASE locks_try TEMPLATE acme;   -- then connect to locks_try as postgres
CREATE EXTENSION IF NOT EXISTS dblink;        -- opens a second session from this one
SELECT dblink_connect('warehouse', 'dbname=' || current_database());

BEGIN;                                        -- this session plays the back-office script
UPDATE orders SET status = 'cancelled' WHERE id = 497003;
SELECT dblink_exec('warehouse', 'BEGIN');
SELECT dblink_exec('warehouse', $$UPDATE orders SET status = 'shipped' WHERE id = 499846$$);
SELECT dblink_send_query('warehouse', $$UPDATE orders SET status = 'shipped' WHERE id = 497003$$);
SELECT pg_sleep(1.5);                         -- the warehouse now waits for this session

SELECT wait_event_type, wait_event, pg_blocking_pids(pid) = ARRAY[pg_backend_pid()] AS blocked_by_me
FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();
-- Lock | transactionid | t

SELECT locktype, page, tuple, mode, granted FROM pg_locks
WHERE locktype IN ('transactionid', 'tuple') ORDER BY granted, locktype;
-- transactionid |     |    | ShareLock     | f    the warehouse waits for this transaction
-- transactionid |     |    | ExclusiveLock | t    each transaction holds its own ID
-- transactionid |     |    | ExclusiveLock | t
-- tuple         | 774 | 54 | ExclusiveLock | t    the warehouse is first in line for 497003

UPDATE orders SET status = 'cancelled' WHERE id = 499846;   -- closes the cycle
-- ERROR:  deadlock detected                    (after deadlock_timeout, 1 s)
-- DETAIL:  Process … waits for ShareLock on transaction …; blocked by process ….
ROLLBACK;
SELECT * FROM dblink_get_result('warehouse') AS r(status text);  -- UPDATE 1: it got 497003
SELECT * FROM dblink_get_result('warehouse') AS r(status text);  -- (0 rows): all results read
SELECT dblink_exec('warehouse', 'COMMIT');

-- A job queue: the warehouse holds the first paid order, so SKIP LOCKED moves on
SELECT dblink_exec('warehouse', 'BEGIN');
SELECT * FROM dblink('warehouse', $$SELECT id FROM orders WHERE status = 'paid'
  ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED$$) AS t(id bigint);                    -- 497001
SELECT id FROM orders WHERE status = 'paid' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED; -- 497005
SELECT id FROM orders WHERE status = 'paid' ORDER BY id LIMIT 1 FOR UPDATE NOWAIT;
-- ERROR:  could not obtain lock on row in relation "orders"
SELECT dblink_exec('warehouse', 'ROLLBACK');
```

## ใช้ตอนไหนดี

PostgreSQL ถือ lock ที่มันต้องใช้ให้เอง การถือเพิ่มเองจะคุ้มในไม่กี่กรณี:

- **อ่าน ตัดสินใจ แล้วเขียน** ใน transaction สั้น ๆ ตัวเดียว: `SELECT … FOR UPDATE` บน row ที่กำลังจะเปลี่ยน (stock ก่อนรับ order, ยอดเงินก่อนโอน) กัน writer ตัวอื่นไม่ให้เปลี่ยนมันระหว่างที่คุณอ่านกับเขียน อย่ารอคนใน transaction แบบนี้เด็ดขาด สำหรับการแก้ที่คนใช้เวลาเป็นนาที ให้เช็ก version column ตอนเขียนแทน ([optimistic concurrency](../optimistic-concurrency/)) และดู [isolation levels](../isolation-levels/) ว่าแต่ละ level เพิ่มอะไรให้เองบ้าง
- **หลาย row ใน transaction เดียว:** lock มันตามลำดับเดียวกันทุกที่ เช่น ใช้ `SELECT … WHERE id IN (…) ORDER BY id FOR UPDATE` ก่อนเปลี่ยน ในการรันรอบที่สอง warehouse job ทำแบบนี้แล้วรอ script อยู่ 5.5 s โดยไม่ได้ถืออะไรไว้เลย cycle เลยเกิดขึ้นไม่ได้
- **fail แทนการรอ:** `NOWAIT` ขึ้น 55P03 ทันที เหมาะกับหน้าจอแก้ข้อมูลที่ควรบอกว่า "มีคนอื่นกำลังแก้ order นี้อยู่" แทนที่จะค้าง
- **table ที่ใช้เป็น job queue:** `FOR UPDATE SKIP LOCKED` ส่ง row ถัดไปที่ไม่มีใครถือให้ worker แต่ละตัว ทำให้ worker หลายตัวใช้ table เดียวร่วมกันแบบ [competing consumers](../competing-consumers/) ได้ และถ้าเรียงการ claim ด้วย column priority ก่อน table ก็จะกลายเป็น [priority queue](../priority-queue/) อย่าลืมทำ index ให้เงื่อนไขของ queue: ถ้าไม่มี index แต่ละการ claim ต้องไล่ primary key ผ่าน 497,004 row (302 ms) ส่วนถ้ามี `CREATE INDEX ON orders (id) WHERE status = 'paid'` การ claim แต่ละครั้งอ่านแค่ 12 buffer ใน 0.1 ms
- **สิ่งที่ไม่ใช่ row** เช่น ให้ invoice run รันได้ทีละรอบ: advisory lock ให้แอปมี lock ที่ตั้งชื่อเองได้ ตัว `pg_advisory_xact_lock(key)` รอเหมือนคำขอ lock อื่น ๆ โผล่ใน `pg_locks` และถูกปล่อยเมื่อ transaction จบ

## ได้อะไร เสียอะไร

- **การรอดูเหมือนความช้า** statement ที่ถูก block ไม่ได้ใช้ CPU ทำให้ปัญหา lock โผล่มาเป็น latency, connection pool ที่เต็ม และ timeout ฝั่งที่เรียก ให้เฝ้าดู `wait_event_type = 'Lock'` และ `idle in transaction` ไม่ใช่ดูแค่ CPU
- **timeout เปลี่ยนการรอให้เป็น error** `lock_timeout`, `statement_timeout` และการ abort ด้วย 40P01 ล้วนส่ง error กลับไปให้ฝั่งที่เรียก ฝั่งที่เรียกต้อง rollback แล้วรัน transaction ใหม่พร้อม backoff ([retry with backoff](../retry-with-backoff/)) ทำให้ transaction ต้องรันซ้ำได้อย่างปลอดภัย
- **`deadlock_timeout` คือการชั่งน้ำหนัก** ค่าที่สูงขึ้นช่วยประหยัดการเช็กที่ไม่จำเป็นตอนโหลดหนัก แต่ก็ทำให้ deadlock จริงค้างอยู่นานขึ้น เอกสารแนะนำให้ตั้งค่าให้สูงกว่าเวลาของ transaction ทั่วไปของคุณ และบอกว่า 1 s คือค่าที่ต่ำที่สุดที่ยังคุ้มจะใช้
- **SKIP LOCKED ให้ภาพที่ไม่ consistent** มันเหมาะกับ queue ที่ row ว่างตัวไหนก็ได้ และไม่เหมาะกับอะไรที่ต้องเห็นทุก row
- **การ lock row คือการเขียน** `SELECT … FOR UPDATE` ตั้ง `xmax` บนทุก row ที่มัน lock ทำให้ page สกปรก (dirty) แม้จะไม่มีอะไรอื่นเปลี่ยนเลย
- **transaction ที่ยาวมีต้นทุนมากกว่าแค่ lock ของมัน** transaction ที่เปิดค้างยังทำให้ VACUUM ลบ row version ที่ตายแล้วไม่ได้ด้วย ([MVCC](../mvcc/)) นี่เป็นอีกเหตุผลที่ควรตั้ง `idle_in_transaction_session_timeout`

## ข้อควรรู้ตอนลงมือทำ

**การป้องกันที่วัดผลแล้ว** จากการรันเพิ่มเติมบนข้อมูลชุดเดียวกัน:

| เทคนิค | เกิดอะไรขึ้น |
|---|---|
| lock ทั้งสอง order ตามลำดับ id: `SELECT id, status FROM orders WHERE id IN (499846, 497003) ORDER BY id FOR UPDATE` | B รอ A อยู่ 5.5 s โดยไม่ได้ถือ lock อะไรไว้ ส่วน UPDATE ตัวที่สองของ A ผ่านไปใน 5 ms โดยไม่เกิด deadlock แล้ว B ก็เจอว่า order ทั้งสองถูก cancel ไปแล้ว ตัว `UPDATE … AND status = 'paid'` ของมันเลยไม่ได้เปลี่ยนอะไร |
| `SET lock_timeout = '2s'` | C หยุดหลัง 2.0 s: `ERROR: canceling statement due to lock timeout` (55P03) |
| `SET statement_timeout = '3s'` | C หยุดหลัง 3.0 s: `ERROR: canceling statement due to statement timeout` (57014) |
| `SET idle_in_transaction_session_timeout = '5s'` | server ตัด session ของ A หลัง idle ครบ 5 s (`FATAL: terminating connection due to idle-in-transaction timeout`) ทำให้ B รอแค่ 4.0 s |
| `FOR UPDATE NOWAIT` | `ERROR: could not obtain lock on row in relation "orders"` (55P03) โดยไม่ต้องรอ |
| `FOR UPDATE SKIP LOCKED` | packer สามคนได้ 497001, 497005 และ 497008 ระหว่างที่ A ถือ 497003 อยู่ |

ตั้ง timeout ต่อ session, ต่อ transaction (`SET LOCAL`) หรือต่อ role (`ALTER ROLE shop_app SET lock_timeout = '2s'`) เอกสารแนะนำว่าอย่าตั้ง `lock_timeout` หรือ `statement_timeout` ใน `postgresql.conf` เพราะมันจะไปโดนทุก session ส่วน `transaction_timeout` ที่เพิ่มเข้ามาใน PostgreSQL 17 จำกัดเวลาของทั้ง transaction รวมเวลาที่ idle ด้วย

**เปลี่ยน schema โดยไม่ล่ม** `ADD COLUMN` ที่ไม่มี default หรือมี default ที่ไม่ volatile แค่เปลี่ยน catalog: การ retry หลัง report จบใช้ 2.6 ms ตัวอันตรายคือ ACCESS EXCLUSIVE lock ที่มันต้องรอ ตัว lock manager จะให้ lock ก็ต่อเมื่อคำขอนั้นไม่ชนทั้งกับ lock ที่ถืออยู่และกับคำขอที่รออยู่ก่อนแล้ว ทำให้ ALTER ที่อยู่หลัง transaction ที่เปิดค้างของ report ต้องรอ 7.0 s และทุกการอ่านที่เข้ามาระหว่างนั้นก็ต้องรอต่อหลังมัน ตรงนี้คือ 6.0 s และ 5.0 s ทั้งที่ตัว report เองไม่ได้ block reader ตัวไหนเลย ให้ครอบ DDL ด้วย `SET lock_timeout` แล้ว retry ใน loop ที่มีช่วงพัก: ถ้า timeout 2 s ตัว ALTER จะยอมแพ้หลัง 2.0 s (55P03) และการอ่านรอนานสุดแค่ 1.0 s ให้สร้าง index ด้วย `CREATE INDEX CONCURRENTLY` และเพิ่ม constraint เป็น `NOT VALID` แล้วตามด้วย `VALIDATE CONSTRAINT` โดยทั้งคู่ถือ SHARE UPDATE EXCLUSIVE ที่ยังให้อ่านและเขียนต่อไปได้ ส่วนการเปลี่ยนที่ใหญ่กว่านั้นให้แยกเป็นขั้น [expand and contract](../expand-and-contract/) ตัว `NOWAIT` และ `SKIP LOCKED` ไม่ช่วยอะไรตรงนี้: มันใช้ได้แค่กับ row lock ส่วน table lock ก็ยังถูกขอแบบปกติ

**MySQL 8.4 (InnoDB)** lock index record แทนที่จะ lock row version และ `performance_schema.data_locks` แสดงทุก lock ที่มันถืออยู่: ในการรันสลับแบบเดียวกัน B และ C รอ lock แบบ `X,REC_NOT_GAP` บน primary key 497003 การตรวจหา deadlock เปิดอยู่โดย default (`innodb_deadlock_detect`) และตั้งแต่ MySQL 8.0.18 ก็มี background thread คอยค้นหา cycle ทำให้ A ได้ `ERROR 1213 (40001): Deadlock found when trying to get lock; try restarting transaction` ภายใน 5 ms หลังมันปิด cycle โดยไม่ต้องรอหนึ่งวินาที ตัว InnoDB จะ rollback transaction ที่มันมองว่าเล็กกว่า โดยดูจากจำนวน row ที่ insert, update หรือ delete ถ้าปิดการตรวจหาไว้ การรอจะจบหลัง `innodb_lock_wait_timeout` (50 s โดย default) ด้วย error 1205 ที่ rollback แค่ statement นั้น ยกเว้นจะตั้ง `innodb_rollback_on_timeout` ไว้ ความต่างที่ใหญ่กว่าคือ gap locking: ภายใต้ REPEATABLE READ ที่เป็น default ของ InnoDB การ scan แบบ locking จะถือ next-key lock: lock บนแต่ละ index record บวกช่องว่างก่อนหน้ามัน ตัว `UPDATE orders SET status = 'cancelled' WHERE customer_id = 1050 AND status = 'paid'` เปลี่ยนแค่ 2 row แต่ lock entry ทั้ง 27 ตัวของลูกค้า 1050 ใน index `customer_id` รวมถึงช่องว่างหลัง entry พวกนั้น และ primary-key record อีก 27 ตัว หลังจากนั้น order ใหม่ของลูกค้า 1050 ต้องรอ 4.0 s ส่วน order ของลูกค้า 1049 รอ 3.5 s เพราะ entry ของมันตกอยู่ในช่องว่างก่อน entry ตัวแรกของ 1050 และ order ของลูกค้า 1051 ผ่านไปได้ใน 10 ms ส่วน PostgreSQL ไม่มี gap lock และ insert สองตัวเดียวกันที่นั่นใช้ไม่ถึง 8 ms ส่วนใน InnoDB ตัว READ COMMITTED จะปิด gap locking สำหรับการค้นหาและ index scan และ locking statement ที่ใช้ index ไม่ได้จะ lock ทุก row ที่มัน scan ผ่าน ตัว `NOWAIT` และ `SKIP LOCKED` ก็มีใน InnoDB เหมือนกัน การเปลี่ยน schema ก็ต่อคิวแบบเดียวกัน: `ALTER TABLE` ที่รอ metadata lock อยู่หลัง transaction ที่เปิดค้าง ทำให้ SELECT ธรรมดาต้องรอ 3.0 s เพราะคำขอ metadata lock แบบ exclusive ที่รออยู่จะได้ไปก่อนคำขอแบบ shared และ `lock_wait_timeout` มีค่า default เป็นหนึ่งปี เลยควรตั้งให้ต่ำตอนทำ migration

**SQL Server** หา deadlock ด้วย lock monitor thread ที่ค้นทุก 5 วินาทีโดย default และค้นถี่ขึ้นได้ถึงทุก 100 ms ระหว่างที่ยังเจอ deadlock อยู่เรื่อย ๆ มันจะ rollback session ที่มี `DEADLOCK_PRIORITY` ต่ำกว่า หรือถ้าไม่ต่างกันก็เลือก transaction ที่ rollback ได้ถูกกว่า แล้วคืน error 1205 ส่วนการรอ lock ไม่มีขีดจำกัดเวลา ยกเว้น session จะตั้ง `LOCK_TIMEOUT` ไว้ ส่วน READ COMMITTED ของมันถือ shared lock ตอนอ่านเมื่อ `READ_COMMITTED_SNAPSHOT` ปิดอยู่ (ค่า default ใน SQL Server) ทำให้ที่นั่น reader อาจต้องรอ writer ส่วน Azure SQL Database เปิด option นี้ไว้โดย default
