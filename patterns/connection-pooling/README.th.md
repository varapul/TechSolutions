## ปัญหา

checkout service ของ Acme Shop รันบน [Kubernetes](../kubernetes/) และช่วง peak ตัว [autoscaler](../autoscaling/) จะขยายมันไปถึง **40 pod** แต่ละ pod เก็บ pool ฝั่ง application ขนาด **20 connection** ไปที่ [PostgreSQL](../postgresql/) ทำให้ service นี้ต้องการ 800 connection แต่ `max_connections` ของ PostgreSQL มีค่า default เป็น 100 และ `superuser_reserved_connections` ก็กัน 3 ตัวสุดท้ายในนั้นไว้ให้ superuser เหลือให้ role `checkout` ใช้ได้ 97 ตัว

เพื่อดูว่าจะเกิดอะไรขึ้น เราให้ pgbench process หนึ่งตัวที่ถือ 20 connection เล่นเป็นหนึ่ง pod แล้วเริ่มทั้ง 40 ตัวพร้อมกันกับ PostgreSQL 18.6 ที่ใช้ค่า default มีแค่ pod 26, 29 และ 31 ที่ได้ connection ครบ 20 ตัว รวม 60 backend ส่วนอีก 37 pod fail ตั้งแต่ตอนเริ่ม โดย 25 pod ในนั้นได้ `FATAL: remaining connection slots are reserved for roles with the SUPERUSER attribute` ที่เป็นข้อความที่ user ที่ไม่ใช่ superuser จะได้เมื่อเหลือแต่ slot ที่กันไว้ อีก 12 pod ได้ `FATAL: sorry, too many clients already` ที่ backend ใหม่จะได้เมื่อไม่เหลือ slot ว่างเลย: connection จะจอง slot ของตัวเองก่อนเช็ก reserved slot ทำให้มีช่วงสั้น ๆ ที่ทั้ง 100 slot ถูกถือไว้หมด ส่วนหนึ่งโดย connection ที่จะ fail การเช็กนั้นในเสี้ยววินาทีถัดมา ถ้าเป็น pod จริงก็จะ retry และ pod ที่ retry ก็ทำให้พายุนี้ไม่จบสักที

ทางแก้สองทางที่ดูน่าลองกลับทำให้แย่ลง การเพิ่ม `max_connections` เป็น 800 ทำให้ทุก connection ได้ process, memory และส่วนแบ่งของ CPU และ PostgreSQL ยังใช้ setting นี้กำหนดขนาด shared memory บางส่วนด้วย ส่วนการทิ้ง pool แล้วต่อใหม่ทุก request ก็ย้ายต้นทุนไปไว้ที่ทุก request: pgbench ที่มี client 8 ตัวรัน checkout transaction ได้ **15,103** ครั้งต่อวินาทีตอนเปิด connection ค้างไว้ และ **353** ครั้งตอนใช้ `-C` ที่ต่อ connection ใหม่ทุก transaction โดยเสียเวลาต่อ connection 10.5 ms ก่อนทุกครั้ง ส่วน [serverless function](../serverless/) ก็ดันไปทางเดียวกัน: [AWS Lambda](../aws-lambda/) รันแต่ละ request ที่เข้ามาพร้อมกันใน execution environment ของตัวเอง ทำให้ function ที่เก็บ connection ไว้ถือหนึ่ง connection ต่อ environment และ traffic ที่พุ่งขึ้นมาทีเดียวก็ทำให้จำนวนมันทวีคูณ

## ทำงานยังไง

**connection หนึ่งตัวมีต้นทุนเท่าไรใน PostgreSQL** postmaster fork **backend process** หนึ่งตัวต่อหนึ่ง connection และ `ps` แสดงแต่ละตัวภายใต้ title ของมันเอง คือ `postgres: checkout acme_shop 172.18.0.3(44996) idle` ตัวเลขที่วัดได้มาจากการรันชุดเดียวบน laptop: PostgreSQL 18.6 ใน container ที่ใช้ค่า default ทั้งหมด ยกเว้นเปิด TLS และ connection logging ไว้ และถูก pin ไว้กับ CPU 4 core, สำเนาของ `orders` และ `order_items` ของ Acme Shop, PgBouncer 1.26.0 ใน container ที่สอง และ pgbench 18.6 ใน container ที่สาม ตัว checkout transaction อ่าน order หนึ่งรายการกับ item ของมันตาม primary key:

```sql
BEGIN;
SELECT status, total_thb FROM orders WHERE id = :id;
SELECT product_id, qty, price_thb FROM order_items WHERE order_id = :id;
END;
```

- **เวลาตั้ง connection** PostgreSQL 18 เปลี่ยน `log_connections` ให้เป็น list ของ aspect ต่าง ๆ และ `setup_durations` จะ log ว่าแต่ละ connection ใช้เวลาเท่าไรกว่าจะพร้อม สำหรับ client ตัวเดียวที่ต่อใหม่ซ้ำ ๆ ผ่าน TLS 1.3 ค่า median คือ 6.4 ms: fork 0.2 ms, authentication แบบ SCRAM-SHA-256 3.2 ms และที่เหลือเป็น TLS handshake กับการ start backend ถ้าไม่ใช้ TLS ยอดรวมเป็น 4.2 ms แปลว่า handshake ใช้ราว 2.1 ms ส่วนฝั่ง client วัดได้ 7.0 ms (4.7 ms ถ้าไม่ใช้ TLS) ตัว authentication ช้าแบบตั้งใจ: client สร้าง proof ของตัวเองด้วยการ hash password ซ้ำ `scram_iterations` รอบ (ค่า default 4,096) และ role ทดสอบที่สร้างด้วย 512 iteration ก็ login ได้โดยใช้เวลา authentication 0.65 ms แทน 3.1 ส่วนจำนวนรอบนี้มีไว้ป้องกัน password hash ที่เก็บไว้จากการ brute force เพราะฉะนั้นให้คงไว้ แล้ว reuse connection แทน
- **memory** `ps` รายงาน resident memory ราว 22 MB ต่อ backend ที่ idle แต่ส่วนใหญ่เป็นของที่ใช้ร่วมกัน: shared buffer ที่มันเคยแตะ, program code และ page ที่มันยังใช้ร่วมกับ postmaster ส่วน `/proc/<pid>/smaps_rollup` บอกว่าส่วนที่เป็นของตัวเองเฉลี่ย 1.7 MB จาก backend ที่ idle 40 ตัว แปลว่า backend 800 ตัวจะถือ private memory ราว 1.3 GB ก่อนจะรัน query สักตัว นอกจากนี้ แต่ละขั้น sort หรือ hash ของ query อาจใช้ได้ถึง `work_mem` (ค่า default 4 MB) และ catalog cache ต่อ backend ก็โตตามจำนวน table และ index ที่ session แตะ (`CacheMemoryContext` มีขนาด 1 MB ใน session ใหม่) การวิเคราะห์ของ Andres Freund ในปี 2020 พบว่า private overhead ต่ำกว่า 2 MiB ต่อ connection เมื่อใช้ huge page และสรุปว่า memory ไม่ใช่ข้อจำกัดหลัก
- **CPU และ snapshot** ทุก transaction ต้องสร้าง snapshot อย่างน้อยหนึ่งตัวว่า transaction ไหนยังรันอยู่ และการสร้างมันก็ต้องไล่ดู entry ของทุก connection ที่ต่ออยู่ ไม่ว่าจะ idle หรือไม่ การแก้ของ Freund ใน PostgreSQL 14 อัด entry พวกนั้นเป็น array แน่น ๆ ตัดงานที่ทุก snapshot เคยต้องทำซ้ำออกไป และ reuse snapshot ถ้ายังไม่มี transaction ไหนจบตั้งแต่ตัวล่าสุด ทำให้ตอนนี้ connection ที่ idle มีต้นทุนน้อยมาก: ใน setup นี้ connection ที่ idle 85 ตัวไม่ทำให้ connection ที่ busy 8 ตัวต่างไปแบบวัดได้เลย แต่ connection ที่ busy เป็นอีกเรื่อง ตอนที่ทุก client รัน checkout กันเต็มที่ ใช้ 32 connection ได้ 24,206 transaction ต่อวินาทีที่ 1.3 ms, 64 connection ได้ 24,553 ที่ 2.6 ms และ 90 connection ได้ 21,436 ที่ 4.2 ms: พอเกินที่ 4 core รันไหว connection ที่เพิ่มมาก็แค่ไปต่อคิวอยู่ใน database

**pool ฝั่ง client และ pooler ฝั่ง server** pool ฝั่ง application (HikariCP ใน Java หรือ pool ใน pgx, node-postgres และ SQLAlchemy) เปิด connection ชุดหนึ่งค้างไว้และให้แต่ละ request ยืมไปใช้ทีละตัว request เลยไม่ต้องจ่ายต้นทุนการตั้ง connection อีก แต่มันจำกัดยอดรวมไม่ได้: database ยังเห็นหนึ่ง connection ต่อหนึ่ง slot ของ pool ในทุก process ส่วน pooler ฝั่ง server อย่าง PgBouncer อยู่ตรงกลาง รับ client connection จำนวนมาก แล้วรัน query ผ่าน server connection ไม่กี่ตัวของมันเอง มันไม่ได้ทำให้การต่อ connection ถูกลง: connection ใหม่ไปที่ PgBouncer ยังต้องใช้ TCP, TLS และ SCRAM และที่นี่ใช้เวลาราว 5 ms เทียบกับ 7.0 ms ตอนต่อตรงไป PostgreSQL ตัวที่ตัดต้นทุนการตั้ง connection ออกไปจริง ๆ ก็เลยเป็น pool ฝั่ง application ส่วน PgBouncer มีสาม mode:

| `pool_mode` | client ถือ server connection | อะไรที่ยังใช้ได้ |
|---|---|---|
| `session` (ค่า default) | ตั้งแต่ connect จน disconnect | ทุกอย่าง ช่วยประหยัดการ fork และการ start backend แต่ต้องมี server connection เท่ากับจำนวน client ที่ต่ออยู่ |
| `transaction` | ตลอดหนึ่ง transaction | application ส่วนใหญ่ ส่วน session state ไม่ถูกส่งต่อ (ดู *ได้อะไร เสียอะไร*) |
| `statement` | ตลอดหนึ่ง statement | autocommit เท่านั้น: transaction ที่มีหลาย statement จะถูกปฏิเสธ |

ในการรัน ทั้ง 40 pod ยังมี pool ขนาด 20 เหมือนเดิม แต่ต่อเข้า PgBouncer ใน transaction mode ที่ตั้ง `default_pool_size = 20` ถ้าแต่ละ pod ส่ง checkout 100 ครั้งต่อวินาที ทั้ง 40 pod ก็รันได้หมด: 4,007 transaction ต่อวินาทีที่ 1.7 ms โดยเฉลี่ย เทียบกับแค่ 3 pod ที่ start ได้ตอนไม่มี pooler ผลของ `SHOW POOLS` ใน admin console ของ PgBouncer ที่เก็บตัวอย่างไว้กลางการรันคือ `cl_active 800, cl_waiting 0, sv_active 0, sv_idle 20, maxwait 0` และ `pg_stat_activity` แสดง backend ของ `checkout` 20 ตัวพอดี ที่ idle อยู่ระหว่าง transaction

**การกำหนดขนาด** PostgreSQL wiki ให้ rule of thumb ที่ benchmark สนับสนุนมานาน: ถ้าอยากได้ throughput ดีที่สุด ให้ตั้งเป้า active connection ไว้ราว `(core_count × 2) + effective_spindle_count` โดย spindle count เป็น 0 เมื่อ working set อยู่ใน cache หมด หน้า *About Pool Sizing* ของ HikariCP ก็ยกสูตรนี้มาเป็นจุดเริ่มต้นไว้ทดสอบต่อ ไม่ใช่คำตอบ สำหรับ server 4 core นี้ได้ 8 และ pool ขนาด 8 ก็รับ checkout 4,000 ครั้งต่อวินาทีเท่าเดิมได้ที่ 1.5 ms ส่วนการรันเต็มที่ข้างบนชี้ว่าจุดหักโค้งที่นี่อยู่ใกล้ 32 มากกว่า เพราะแต่ละ checkout ใช้เวลาส่วนหนึ่งไปกับการรอ statement ถัดไปจาก client เพราะฉะนั้นให้วัดด้วย transaction ของคุณเอง แล้วเช็ก budget: ถ้าไม่มี pooler จำนวน pod × ขนาด pool ต้องต่ำกว่า `max_connections` ลบ slot ที่กันไว้ และลบสิ่งที่ monitoring, migration และ replication ต้องใช้ ถ้ามี PgBouncer จำนวนฝั่ง server ก็คือ `default_pool_size` ต่อหนึ่งคู่ database กับ user บวก `reserve_pool_size`

**timeout และการเข้าคิว** ถ้า server connection ทุกตัว busy อยู่ PgBouncer จะให้ client เข้าคิว และ `SHOW POOLS` รายงานคิวนี้เป็น `cl_waiting` ส่วน `maxwait` บอกว่าตัวที่รอนานที่สุดรอมานานเท่าไร ตัว `query_wait_timeout` (ค่า default 120 s) จะตัด client ที่รอนานเกินไป และ pool ฝั่ง application ก็มี limit ของตัวเอง (`connectionTimeout` ของ HikariCP ค่า default 30 s) ให้ตั้งทั้งสองตัวให้ต่ำกว่าเวลาที่ผู้ใช้ยอมรอได้มาก ๆ ส่วนตอนรันเต็มที่ client 800 ตัวท่วม core เดียวของ PgBouncer: 778 ตัวต้องรอ, server connection 16 จาก 20 ตัวค้างอยู่ใน `idle in transaction` เพื่อรอ statement ถัดไปจาก client และ latency เฉลี่ยพุ่งไปถึง 73 ms ส่วนฝั่ง server ตัว `idle_in_transaction_session_timeout` และ `transaction_timeout` (PostgreSQL 17 ขึ้นไป) จะจบ transaction ที่ client เปิดทิ้งไว้ ไม่งั้นมันจะถือ pooled connection ไว้ ส่วน documentation เตือนไม่ให้ใช้ `idle_session_timeout` กับ connection ที่มาผ่าน pooler

**การ monitor** ฝั่ง PostgreSQL ใช้ `pg_stat_activity` ที่ group ตาม `state`, `usename` และ `application_name` เพื่อดูว่าใครถือ connection อยู่ และถ้าหลาย row มี `backend_start` ที่เพิ่งเกิดไม่นาน แปลว่า client ต่อเข้าออกบ่อย ฝั่ง PgBouncer ให้ดู `SHOW POOLS` (client ที่รอ, `maxwait`), `SHOW STATS` (จำนวน transaction, เวลา query และเวลารอ และตั้งแต่ 1.26 มี `client_login_count` ที่ทำให้เห็น client ที่ reconnect ตลอดเวลา) และ `SHOW CLIENTS` กับ `SHOW SERVERS` สำหรับดูทีละ connection ให้ตั้ง alert บน `cl_waiting` และ `maxwait` ไม่ใช่บนจำนวน client

## ลองรันดู

ข้อมูลตัวอย่างมาจาก [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop) ที่เป็น script สร้าง template database `acme` บน PostgreSQL 18 ในเวลาราวหนึ่งนาที

รัน SQL ใน `psql` ในฐานะ superuser บนสำเนาใหม่ แล้วรัน pgbench สองรอบจาก shell ที่ตั้ง `PGHOST`, `PGPORT` และ `PGUSER` ให้ชี้ไปที่ server เดียวกัน ตัว comment แสดงบรรทัดสำคัญของการรันหนึ่งรอบบน laptop ที่ pgbench ต่อเข้า server ผ่าน port forwarding ของ Docker โดยไม่ใช้ TLS

```sql
-- CREATE DATABASE connection_pooling TEMPLATE acme STRATEGY FILE_COPY;  then connect to it
SHOW max_connections;                 -- 100 by default (this run's server was set to 200)
SHOW superuser_reserved_connections;  -- 3

-- every connection is a process, and so is every background worker
SELECT backend_type, count(*) FROM pg_stat_activity GROUP BY 1 ORDER BY 2 DESC, 1;
--  io worker                    |     3
--  autovacuum launcher          |     1
--  background writer            |     1
--  checkpointer                 |     1
--  client backend               |     1      <- this psql session
--  logical replication launcher |     1
--  walwriter                    |     1

-- this backend's own memory (superusers and pg_read_all_stats members can read it)
SELECT pg_size_pretty(sum(total_bytes)) AS this_backend FROM pg_backend_memory_contexts;
--  2139 kB
SELECT name, pg_size_pretty(total_bytes) FROM pg_backend_memory_contexts
ORDER BY total_bytes DESC LIMIT 1;
--  CacheMemoryContext | 1024 kB
```

```sh
cat > checkout.sql <<'EOF'
\set id random(1, 500000)
BEGIN;
SELECT status, total_thb FROM orders WHERE id = :id;
SELECT product_id, qty, price_thb FROM order_items WHERE order_id = :id;
END;
EOF
pgbench -n -f checkout.sql -c 4 -j 2 -T 5 connection_pooling       # connections kept open
#  latency average = 2.317 ms
#  tps = 1726.581115 (without initial connection time)
pgbench -n -f checkout.sql -c 4 -j 2 -T 5 -C connection_pooling    # a new connection per transaction
#  latency average = 18.638 ms
#  average connection time = 8.170 ms
#  tps = 214.619540 (including reconnection times)

# PostgreSQL 18: log how long one connection took to set up (as a superuser)
PGOPTIONS='-c log_connections=setup_durations' psql -c 'SELECT 1' connection_pooling
#  server log: connection ready: setup total=6.560 ms, fork=0.242 ms, authentication=4.813 ms
```

ตรงนี้ส่วนต่างเป็น 8× ไม่ใช่ 43× แบบใน diagram: ทุก round trip ที่ผ่าน port forwarding ใช้เวลาราวครึ่ง millisecond ทำให้การรันแบบเปิด connection ค้างไว้ช้าลงด้วย

## ใช้ตอนไหนดี

- **ใช้ pool เสมอใน service ที่รันยาว ๆ** pool ฝั่ง application หนึ่งตัวต่อ process มีต้นทุนต่ำ และตัดต้นทุนการตั้ง connection ออกจากทุก request ให้กำหนดขนาดจากมุมของ database: ยอดรวมของทุก instance คือสิ่งที่ server รู้สึก
- **เพิ่ม pooler ฝั่ง server ใน transaction mode** เมื่อ client connection รวมกันแล้วมากกว่าที่ database ควรรัน: มี pod หรือ process เยอะ, มี autoscaling หรือมี connection ที่มาแล้วก็ไป เช่น function, process ที่เกิดต่อ request และ batch job แบบนี้ทำให้การ scale out ของ application ไม่ผูกกับสิ่งที่ database รันไหว
- **session mode** เหมาะกับ client ที่ต้องใช้ feature ของ session แต่ connect และ disconnect บ่อย: ช่วยประหยัดการ fork และการ start backend ของแต่ละ connection ใหม่ แต่ client ทุกตัวที่ต่ออยู่ก็ยังถือ server connection หนึ่งตัว
- **แยก pool ตาม workload** reporting job ที่ถือ connection นานเป็นนาทีไม่ควรสูบ pool ที่ checkout ต้องพึ่งจนหมด การให้แต่ละงานมี pool ของตัวเองก็คือ pattern [Bulkhead](../bulkhead/) ที่ใช้กับ connection
- **ไม่จำเป็น** เมื่อมี instance ไม่กี่ตัวที่มี pool เล็ก ๆ อยู่ใต้ `max_connections` ได้สบาย ๆ และยังมีที่เหลือ ตัว pooler ก็คืออีกหนึ่งอย่างที่ต้องรัน

## ได้อะไร เสียอะไร

- **session state อยู่ไม่รอดใน transaction pooling** server connection กลับเข้า pool หลังทุก transaction โดยไม่ถูก reset เพราะ `server_reset_query` รันแค่ใน session mode บน pool ทดสอบที่มี server connection ตัวเดียว ทำให้แน่ใจว่าจะถูก reuse ตัว `SET statement_timeout = '5ms'` ของ pod 7 ค้างอยู่บน server pid 6715 และพอ pod 12 ต่อเข้ามาถัดไปแล้วได้ server ตัวเดิม คำสั่ง `SELECT count(*) FROM order_items` ของมันก็ fail ด้วย `canceling statement due to statement timeout` ส่วน advisory lock ระดับ session ที่เอาผ่าน PgBouncer ก็อยู่นานกว่า client ที่เอามันไป: session ที่ต่อตรงเอา lock 42 ไม่ได้หลัง pod 7 disconnect ไปแล้ว และ pod 12 ก็ปล่อยมันได้ทั้งที่ไม่เคยเอามันไปเลย ตาราง feature ของ PgBouncer ระบุว่า `SET`/`RESET`, `LISTEN`, cursor แบบ `WITH HOLD`, `PREPARE` ระดับ SQL, temporary table ที่อยู่นานกว่าหนึ่ง transaction, `LOAD` และ advisory lock ระดับ session ไม่รองรับใน transaction mode ให้ใช้ `SET LOCAL` ข้างใน transaction หรือผูก setting ไว้กับ role หรือ database (`ALTER ROLE checkout SET statement_timeout = '2s'`) ตัว PgBouncer เองก็ track parameter ที่ PostgreSQL รายงานให้ client อยู่แล้ว คือ `application_name`, `TimeZone` และตั้งแต่ 1.26 ก็มี `search_path` บน PostgreSQL 18 ด้วย ค่าพวกนี้เลยถูกคืนให้ถูกต้องต่อ client
- **prepared statement ต้องใช้ PgBouncer รุ่นใหม่** prepared statement ระดับ protocol แบบที่ driver ส่งมา ใช้ได้ใน transaction mode ตั้งแต่ PgBouncer 1.21 และเปิดไว้เป็นค่า default ตั้งแต่ 1.24 (`max_prepared_statements = 200`) ถ้าตั้งค่านี้เป็น 0 ตัว pgbench ใน prepared mode จะ fail ทันทีด้วย `prepared statement "P_0" already exists` เพราะ client สองตัว prepare ชื่อเดียวกันบน server connection ตัวเดียว
- **เพิ่มมาอีกหนึ่ง hop** ที่ client ตัวเดียว checkout ที่มีสี่ statement ใช้ 0.33 ms ตอนต่อตรง และ 0.59 ms ตอนผ่าน PgBouncer ตัว pooler เองก็ต้องทำให้ปลอดภัย (TLS ทั้งสองฝั่ง, `auth_file` หรือ `auth_query` ของมันเอง), ต้อง monitor และต้อง upgrade ด้วย
- **single point of failure บน core เดียว** PgBouncer เป็น single-threaded: ตอนรันเต็มที่ core เดียวของมันจำกัด client 800 ตัวไว้ที่ 10,943 transaction ต่อวินาที ให้รันสอง instance ขึ้นไปหลัง load balancer หรือ Kubernetes Service หรือรันหลาย process บน host เดียวด้วย `so_reuseport` วิธีนี้ก็เป็นวิธีที่ PgBouncer 1.26 คาดหวังให้ใช้ทำ rolling restart ด้วย เพราะมันเลิกรองรับ online restart ไปแล้ว
- **การเข้าคิวซ่อน overload ไว้** pooler เปลี่ยน load ที่มากเกินให้กลายเป็น client ที่รอ แทนที่จะเป็น error แบบนี้ช่วยปกป้อง database แต่ถ้าไม่มี `query_wait_timeout`, timeout ฝั่ง application และ alert บน `maxwait` ผู้ใช้ก็แค่รอไปเรื่อย ๆ (ดู [Timeout & Fallback](../timeout-and-fallback/))
- **pool deadlock** client ที่ถือ connection ไว้ระหว่างรออีกตัวจาก pool เดียวกัน ทำให้ทุกคนค้างได้ ในการรันครั้งหนึ่ง prepared mode ของ pgbench ที่ thread จะ block ระหว่าง prepare statement มี client 40 ตัวบน 2 thread กับ server connection 20 ตัว: ทั้ง 20 ตัวค้างอยู่ใน `idle in transaction` จนกระทั่ง `query_wait_timeout` ตัด client ที่รออยู่ออกไปใน 120 s ต่อมา หน้าเรื่อง sizing ของ HikariCP ก็อธิบายปัญหา pool-locking แบบเดียวกันนี้

## ข้อควรรู้ตอนลงมือทำ

**setup ของ PgBouncer ที่ใช้ที่นี่** คือบรรทัดหลัก ๆ ของ `pgbouncer.ini`:

```ini
[databases]
acme_shop = host=postgres port=5432 dbname=acme_shop

[pgbouncer]
; only whole lines can be comments, and without listen_addr only Unix sockets are open
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = scram-sha-256
; "checkout" "SCRAM-SHA-256$4096:…", copied from pg_authid
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
; server connections per database and user
default_pool_size = 20
; the default of 100 would refuse the 800 pods' connections
max_client_conn = 1000
client_tls_sslmode = require
client_tls_key_file = /etc/pgbouncer/server.key
client_tls_cert_file = /etc/pgbouncer/server.crt
server_tls_sslmode = require
; for SHOW POOLS on the pgbouncer admin database
admin_users = checkout
```

ให้ตั้ง `maxLifetime` ของ application pool (ค่า default ใน HikariCP คือ 30 นาที) ให้สั้นกว่าอะไรก็ตามที่ปิด connection อยู่ข้างใต้มันเล็กน้อย เช่น idle timeout ของ load balancer การ recycle connection เป็นระยะ ๆ ด้วย `maxLifetime` ของ pool หรือด้วย `server_lifetime` ของ PgBouncer (ค่า default 3,600 s) สำหรับ server connection ของมัน ยังช่วยคืน catalog cache ที่โตขึ้นใน session ยาว ๆ ด้วย ส่วน [Locks and Deadlocks](../locks-and-deadlocks/) อธิบายว่า transaction ยาว ๆ ถืออะไรไว้บ้างระหว่างที่มันครอง pooled connection อยู่

**Amazon RDS Proxy** คือตัวที่ทำหน้าที่เดียวกันแบบ managed สำหรับ RDS และ [Aurora](../amazon-rds-aurora/) มันเก็บ pool แยกต่อ writer endpoint และ reader endpoint และ multiplex ที่ระดับ transaction เป็นค่า default เมื่อมันเห็น session state มันจะ *pin* client ไว้กับ database connection ของมันจนกว่า client จะ disconnect: สำหรับ PostgreSQL รวมถึง `SET`, `PREPARE`, `DISCARD` และ `DEALLOCATE`, temporary table, cursor, `LISTEN`, `LOAD`, `nextval` และ `setval`, advisory lock ระดับ session, `set_config` และ statement ใด ๆ ที่ใหญ่กว่า 16 KB ให้ดู CloudWatch metric `DatabaseConnectionsCurrentlySessionPinned` และย้าย statement `SET` ที่ทุก connection ต้องใช้ไปไว้ใน initialization query ของ proxy ตัว `MaxConnectionsPercent` จำกัดส่วนแบ่งของ proxy ใน `max_connections` ของ database ส่วน `ConnectionBorrowTimeout` (ค่า default 120 s) คือตัวที่เทียบเท่า `query_wait_timeout` และ client connection ที่ idle จะถูกปิดหลัง 30 นาทีโดย default มันยังเปิด client connection ส่วนใหญ่ค้างไว้ได้ตลอด failover และ documentation ของ RDS ก็แนะนำให้ Lambda function ชี้ไปที่ proxy endpoint เพื่อให้ connection ของพวกมันใช้ pool ของ proxy ร่วมกัน

**MySQL (8.4) ใช้ thread ไม่ใช่ process** โดย default (`thread_handling = one-thread-per-connection`) ทุก connection ได้ server thread หนึ่งตัว และ client ที่ disconnect ไปแล้วจะทิ้ง thread ไว้ใน thread cache (`thread_cache_size` ที่กำหนดขนาดให้อัตโนมัติ เป็น 9 บน server 8.4.11 ที่ใช้ค่า default) ให้ connection ถัดไปใช้ การต่อ connection เลยถูกกว่าการ fork ของ PostgreSQL ส่วน limit ทำงานแบบเดียวกัน: `max_connections` มีค่า default 151 และ server ยอมให้มีอีกหนึ่ง connection สำหรับ account ที่มี `CONNECTION_ADMIN` ทำให้ administrator ยังเข้าได้ ส่วนคนอื่นได้ `Too many connections` ตัว thread pool ที่จำกัดจำนวน statement ที่รันพร้อมกันเป็น plugin ของ MySQL Enterprise Edition ทำให้บน Community server คำแนะนำก็เหมือนกับ PostgreSQL: ให้จำนวน connection ที่ busy อยู่ใกล้กับที่ core รันไหว โดยใช้ application pool และถ้ามี client เยอะก็ใช้ proxy (RDS Proxy รองรับ MySQL ด้วย)
