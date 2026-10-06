## ปัญหา

แอปพลิเคชันส่วนใหญ่อ่านมากกว่าเขียนเยอะมาก หน้าสินค้า timeline หรือ dashboard ถูกดึงไปเป็นพันครั้งต่อการเปลี่ยนแถวข้างหลังมันแค่ครั้งเดียว และ query ทั้งหมดนั้นก็ไปลงที่ server ตัวเดียวกับที่รับการเขียน server ที่ใหญ่ขึ้นช่วยขยับเพดานออกไปได้ แต่ไม่ได้ทำให้เพดานหายไป และตราบใดที่ข้อมูลมีอยู่ชุดเดียว ทุก report และทุก export ก็ต้องแย่ง CPU, memory และ disk ชุดเดียวกันกับ user

database มีกลไกที่ช่วยได้อยู่แล้ว คือ replication มันมีไว้ให้ server ตัวที่สองรับช่วงต่อหลังเกิด failure แต่สำเนาที่ update ตามทันอยู่เสมอก็ตอบ query ได้ด้วย Read replicas ใช้กลไกนี้เพื่อเพิ่มกำลัง: server ตัวหนึ่งรับการเขียนต่อไป ส่วนสำเนารับการอ่าน ราคาที่ต้องจ่ายคือสำเนาจะตามหลังอยู่นิดหน่อยเสมอ และเนื้อหาส่วนใหญ่ของ pattern นี้ก็คือความล่าช้านั้นส่งผลกับ user ยังไง และต้องรับมือกับมันยังไง

## ทำงานยังไง

1. **primary ตัวเดียวรับการเขียนทุกครั้ง** มันบันทึกทุกการเปลี่ยนแปลงที่ commit แล้วตามลำดับการ commit ลงใน log: คือ write-ahead log (WAL) ใน PostgreSQL และ binary log ใน MySQL
2. **replica replay log นั้น** replica แต่ละตัวถือ connection ไปที่ primary รับ log มาเป็น stream แล้วเอาไปใช้กับสำเนาของตัวเอง สุดท้ายก็มีตาราง แถว และ index ชุดเดียวกัน และรับ query แบบ read-only ได้ (PostgreSQL เรียกแบบนี้ว่า hot standby) และ replica ยังส่งต่อ log ให้ replica ตัวอื่นเป็นทอด ๆ (cascade) ได้ด้วย ช่วยลด connection และ network traffic ที่ primary
3. **router แยก traffic** การเขียนและการอ่านที่ต้องได้ข้อมูลล่าสุดไปที่ primary ส่วนที่เหลือทั้งหมดไปที่ reader endpoint: จะเป็น proxy, load balancer หรือชื่อ DNS ที่กระจายการอ่านไปที่ replica ที่พร้อมให้บริการก็ได้
4. **replication เป็นแบบ asynchronous ถ้าไม่ได้สั่งเป็นอย่างอื่น** primary จะ acknowledge การ commit ทันทีที่มัน durable ในเครื่องตัวเอง แล้วค่อยส่ง log ตามไปทีหลัง replica เลยตามหลังอยู่เสมอ: ระบบที่ว่าง ๆ ก็หลักมิลลิวินาที แต่ตอน load สูงก็เป็นวินาทีหรือมากกว่านั้น ระยะห่างนี้คือ **replication lag**

replica แต่ละตัวช่วยเพิ่มกำลังการอ่าน แต่กำลังการเขียนไม่ได้เพิ่ม: ยังมี primary แค่ตัวเดียว และ replica ทุกตัวต้อง replay การเขียนทุกครั้งนอกเหนือจากการตอบ read ของตัวเอง

### Asynchronous, semi-synchronous, synchronous

การ commit รอ replica นานแค่ไหน เป็นตัวตัดสินว่า replica จะสัญญาอะไรได้บ้าง

| | การ commit คืนผลเมื่อ | ต้องจ่าย | ได้อะไร |
|---|---|---|---|
| **Asynchronous** | primary ทำให้มัน durable ในเครื่องตัวเองแล้ว | ไม่เสียอะไรต่อการ commit | ไม่ได้อะไร: การอ่านอาจ stale และ failover ทำให้ commit ที่ replica ยังไม่ได้รับหายไป |
| **Semi-synchronous** | replica อย่างน้อยหนึ่งตัว*ได้รับ*การเปลี่ยนแปลงและเก็บลงไปแล้ว แต่ยังไม่ได้ apply | network round trip หนึ่งรอบต่อการ commit และค้างถ้าไม่มี replica ตัวไหนตอบ | commit ที่ acknowledge แล้วจะไม่หายไปพร้อม primary แต่การอ่านบน replica ก็ยัง stale ได้ |
| **Synchronous** | replica ที่เลือกไว้ *apply* แล้ว | round trip บวกเวลา replay บน replica ตัวที่ช้าที่สุดในกลุ่มที่ต้องรอ ถ้า replica ตัวไหนช้าหรือตายก็จะดึงการเขียนทุกครั้งไว้ | การอ่านบน replica เหล่านั้นจะเห็นทุก commit ที่ acknowledge แล้ว |

- **Asynchronous** เป็นค่า default ของ streaming replication ใน PostgreSQL และของ replication ใน MySQL และเป็นแบบที่ managed read replica อย่างของ Amazon RDS ใช้
- **Semi-synchronous** เป็นคำของ MySQL: source จะรอจนกว่า replica อย่างน้อยหนึ่งตัวยืนยันว่า event ของ transaction เขียนลง relay log และ flush ลง disk แล้ว ถ้าไม่มีใครยืนยันภายใน `rpl_semi_sync_source_timeout` (default 10 วินาที) ตัว source ก็จะถอยกลับไปใช้ asynchronous replication แบบเงียบ ๆ PostgreSQL ก็มีทางสายกลางแบบเดียวกันแต่เรียกอีกชื่อ: ถ้าตั้ง `synchronous_standby_names` ไว้ ตัว `synchronous_commit = on` จะรอจนกว่า standby จะ flush WAL ของการ commit นั้นแล้ว
- **Synchronous** ในความหมายเคร่ง ๆ ที่ replica ต้อง apply การเปลี่ยนแปลงแล้วด้วย ก็คือ `synchronous_commit = remote_apply` ใน PostgreSQL ในโหมดนี้การ commit จะรอจนกว่า synchronous standby จะ replay มันเสร็จ และจะรอต่อไปเรื่อย ๆ ถ้ามีตัวใดตัวหนึ่งหายไป เลยควรระบุตัวเลือกไว้มากกว่าจำนวนที่ต้องการ: `FIRST 1 (a, b)` เลือกตามลำดับความสำคัญ ส่วน `ANY 1 (a, b)` เอาตัวที่ตอบก่อน

ค่าพวกนี้ไม่ได้มีแค่เปิดหมดหรือปิดหมด แบบที่เจอบ่อยคือมี synchronous standby หนึ่งตัวไว้เรื่อง durability บวก asynchronous replica อีกหลายตัวไว้รับการอ่าน และ PostgreSQL ก็ให้ transaction แต่ละตัวเลือกระดับ `synchronous_commit` ของตัวเองได้

### lag มาจากไหน และวัดยังไง

lag คือเวลาตั้งแต่ commit บน primary จนถึงตอนที่ replica replay มันเสร็จ lag จะโตขึ้นเมื่อ:

- **primary เขียนเป็นช่วง ๆ ทีละเยอะ** bulk update หรือ transaction ใหญ่มาก ๆ ตัวเดียว ทำให้ replica ต้องใช้เวลาสักพักในการรับและ replay
- **มี query ยาว ๆ รันอยู่บน replica** ถ้า query ที่กำลังรันอยู่ยังมองเห็น row version ไหน การ replay ก็ลบ row version นั้นไม่ได้ และถ้า query กำลังอ่านตารางไหนอยู่ การ replay ก็ lock ตารางนั้นแบบ exclusive ไม่ได้ PostgreSQL ยอมให้การ replay ตามหลังได้ถึง `max_standby_streaming_delay` (default 30 วินาที) ระหว่างรอ query แบบนี้ แล้วค่อย cancel มัน ระหว่างที่รอ ก็ไม่มีอะไรถูก replay เลย: นี่คือ report ใน step 4
- **replica เล็กกว่าหรือยุ่งกว่า primary** มันต้องทำการเขียนทั้งหมดของ primary บวกการอ่านของตัวเองด้วย
- **การ replay ขนานกันน้อยกว่าตอนเขียนจริง** primary commit จากหลาย connection พร้อมกัน ส่วน MySQL replica apply ด้วย thread จำนวน `replica_parallel_workers` (default 4 ใน 8.4)
- **replica อยู่ไกล** replica ที่อยู่อีก region มักตามหลังมากกว่าตัวที่อยู่ข้าง ๆ primary

ตัวอย่างสองแบบว่าอ่านค่า lag ได้จากไหน:

- **PostgreSQL** บน primary ตัว `pg_stat_replication` มีหนึ่งแถวต่อ standby ที่ต่ออยู่ บอก position ที่ standby ไปถึงแล้ว (`sent_lsn`, `write_lsn`, `flush_lsn`, `replay_lsn`) และค่าเดียวกันในรูปเวลา (`write_lag`, `flush_lag`, `replay_lag`) ส่วนบน standby ตัว `pg_last_wal_receive_lsn()` กับ `pg_last_wal_replay_lsn()` คืนค่าที่มันรับและ replay ไปแล้ว และ `pg_last_xact_replay_timestamp()` คืนเวลา commit ของ transaction ล่าสุดที่มัน replay
- **MySQL** คำสั่ง `SHOW REPLICA STATUS` รายงานค่า `Seconds_Behind_Source` ค่านี้เทียบ applier กับสิ่งที่ replica รับมาแล้ว เลยอาจขึ้น 0 บน replica ที่ตัวรับเองก็ตามหลังอยู่บน network ที่ช้า Performance Schema แม่นกว่า: สำหรับ transaction ล่าสุดที่ worker แต่ละตัว apply ไป ตาราง `replication_applier_status_by_worker` เก็บเวลา commit บน source ต้นทาง (`LAST_APPLIED_TRANSACTION_ORIGINAL_COMMIT_TIMESTAMP`) และเวลาที่ replica apply เสร็จ (`LAST_APPLIED_TRANSACTION_END_APPLY_TIMESTAMP`)

managed service เผยแพร่ lag เป็น metric: `ReplicaLag` ใน Amazon RDS, `AuroraReplicaLag` ใน Aurora, `database/replication/replica_lag` ใน Cloud SQL ต้องรู้ว่าตัวเลขของคุณหมายถึงอะไร "เวลาตั้งแต่ commit ล่าสุดที่ replay" จะโตขึ้นเรื่อย ๆ ตอนที่ primary ว่าง ทั้งที่ไม่มีอะไรขาดหายไปเลย: RDS for PostgreSQL คำนวณ metric แบบนี้ และเขียนไว้ในเอกสารว่ามันอาจขึ้นได้ถึงห้านาทีบน source ที่ไม่มี transaction ส่วนระยะห่างของ log position หรือแถว heartbeat ที่เขียนทุกวินาที ไม่มีจุดอ่อนนี้

### replica ที่ stale ทำอะไรกับ user

| ความผิดปกติ | user เห็นอะไร | ทำไม | การรับประกันที่แก้มันได้ |
|---|---|---|---|
| **อ่านเจอค่า stale หลังเขียน** | "ฉันกดบันทึกแล้ว reload ใหม่ แต่สิ่งที่แก้หายไป" | การอ่านไปถึง replica ก่อนการเปลี่ยนแปลง (step 2) | Read-your-writes |
| **เวลาเดินถอยหลัง** | comment ใหม่โผล่มาแล้ว แต่ refresh แล้วหายไป | การอ่านสองครั้งติดกันไปเจอ replica ที่ lag ไม่เท่ากัน | Monotonic reads |

วิธีแก้ เรียงจากหยาบที่สุดไปจนแม่นที่สุด:

- **อ่านจาก primary สักพักหลังเขียน** จำไว้ใน session ว่า user เขียนครั้งล่าสุดตอนไหน แล้วส่งการอ่านของเขาไปที่ primary ในช่วงเวลาที่ยาวกว่า lag ปกติ Rails มีให้ในตัว: ถ้าตั้ง `config.active_record.database_selector = { delay: 2.seconds }` ไว้ request แบบ `GET` หรือ `HEAD` ที่ตามหลังการเขียนของ session เดียวกันภายในสองวินาทีจะถูกส่งไปที่ writer วิธีนี้ง่าย แต่ก็เป็นการเดา ถ้า lag ยาวกว่าช่วงเวลานั้นก็ยังหลุดออกมาให้เห็นได้ และ writer ทุกคนก็เพิ่มการอ่านให้ primary
- **รอ position** นี่คือ step 3 และแม่นยำ การเขียนคืน log position หรือ transaction ID ของมันกลับมา แล้วการอ่านจะยังไม่รันจนกว่า replica จะไปถึงตรงนั้น
  - *MySQL:* ถ้าตั้ง `session_track_gtids = OWN_GTID` ไว้ server จะคืน GTID ของทุก transaction ที่ session commit ส่วนบน replica ตัว `WAIT_FOR_EXECUTED_GTID_SET(gtid_set, timeout)` จะ block จนกว่า GTID นั้นถูก apply แล้วคืนค่า 0 หรือคืน 1 ถ้า timeout หมดก่อน ส่วน read/write splitting ของ MySQL Router ก็ทำแบบเดียวกันได้โดยไม่ต้องเขียนโค้ดในแอปพลิเคชัน: ถ้าใช้ `wait_for_my_writes` การอ่านจะรอการเขียนล่าสุดของ session และพอเลย `wait_for_my_writes_timeout` (default 1 วินาที) ก็จะไปที่ primary แทน
  - *PostgreSQL:* อ่าน `pg_current_wal_insert_lsn()` บน primary หลัง commit แล้วเทียบกับ `pg_last_wal_replay_lsn()` บน standby ส่วน PostgreSQL 19 ที่ยังเป็น beta อยู่ ณ เดือนตุลาคม 2026 เพิ่มคำสั่ง `WAIT FOR LSN` ที่มี option `TIMEOUT` มาให้รอบน standby ได้เลย
  - *MongoDB:* causally consistent session ที่ใช้ read concern และ write concern เป็น `"majority"` รับประกันทั้ง read-your-writes และ monotonic reads ข้าม member ของ replica set
  - รอโดยมี timeout เสมอ และถอยกลับไปที่ primary เมื่อ timeout หมด
- **ผูก session ไว้กับ replica ตัวเดียว** replica ตัวเดียวไม่มีทางถอยหลัง การส่งการอ่านทั้งหมดของ user คนหนึ่งไปที่ replica ตัวเดิม (เลือกจาก hash ของ user ID หรือ session ID) เลยได้ monotonic reads โดยไม่ต้องรออะไรเลย ถ้า replica ตัวนั้นหลุดออกไป user ของมันจะถูกย้าย และอาจเห็นข้อมูลถอยหลังหนึ่งครั้ง
- **synchronous replica สำหรับการอ่านไม่กี่ตัวที่ต้องใช้** ถ้าการเปลี่ยนแปลงบางอย่างต้องเห็นบน replica ทันทีที่ acknowledge ก็ให้ commit transaction นั้นด้วย `synchronous_commit = remote_apply` กับ synchronous standby แล้วอ่านจาก standby ตัวนั้น
- **หรืออ่าน query พวกนั้นจาก primary** ยอดเงินก่อนถอน สต็อกก่อนสั่งซื้อ การเช็ก permission: อะไรก็ตามที่อ่านไปเพื่อตัดสินใจเขียน ควรอยู่บน primary

### Route การอ่าน

- **ในแอปพลิเคชัน** มี connection pool สองชุด ชุดหนึ่งไปที่ primary อีกชุดไปที่ replica แล้วให้โค้ดหรือ framework เลือกทีละ query อย่าง Rails ก็ประกาศ role ไว้ (`connects_to database: { writing: :primary, reading: :primary_replica }`) แล้วสลับด้วย `connected_to(role: :reading)` ส่วน Django ถาม database router ของมัน (`db_for_read`, `db_for_write`) ส่วน driver ก็ช่วยหา node: libpq รับ list ของ host แล้วกรองด้วย `target_session_attrs` (`read-write`, `read-only`, `primary`, `standby`, `prefer-standby`) และสลับลำดับด้วย `load_balance_hosts=random` ส่วน pgJDBC มี `targetServerType` กับ `loadBalanceHosts` และ Azure SQL Database ส่ง connection ที่ประกาศ `ApplicationIntent=ReadOnly` ไปที่ read-only replica ใน service tier ที่มี replica แบบนี้
- **ใน proxy** MySQL Router (`access_mode=auto`), router `readwritesplit` ของ MariaDB MaxScale และ Pgpool-II จะจัดประเภทแต่ละ statement ส่งการเขียนไปที่ primary และกระจาย `SELECT` ไปที่ replica แอปพลิเคชันเลยใช้ connection string แค่ตัวเดียว
- **ผ่าน reader endpoint** managed service วางชื่อเดียวไว้หน้า replica: reader endpoint ของ Aurora กระจาย connection ไปที่ replica ของ cluster และ read pool ของ Cloud SQL มี endpoint เดียววางอยู่หน้า node ได้ถึง 20 ตัว พวกนี้กระจาย*connection* ไม่ใช่ query: query จะไปที่ไหนก็ตามที่ connection ของมันชี้อยู่แล้ว ทำให้ connection ที่อยู่ใน pool นาน ๆ ไม่ย้ายไปไหนตอนเพิ่ม replica

จะใช้แบบไหนก็ตาม ส่วนใหญ่แอปพลิเคชันก็ยังต้องเลือกทีละ query มีแต่แอปพลิเคชันที่รู้ว่าการอ่านไหน stale ได้ การอ่านไหนตามหลังการเขียนของ user คนนั้นเอง และการอ่านไหนอยู่ใน transaction ที่กำลังจะเขียน proxy ที่แยกตามประเภท statement ให้ค่า default ที่ดี แต่ส่วนที่เหลือต้องมีทาง override (ใน MySQL Router ใช้ `ROUTER SET access_mode='read_write'` สำหรับ session)

### Failover, promotion และ standby

ถ้า primary ล่ม replica ตัวหนึ่งจะถูก **promote**: มันหยุด replay แล้วเริ่มรับการเขียน (`pg_ctl promote` หรือ `pg_promote()` ใน PostgreSQL) จากนั้นต้องเกิดอีกสามเรื่อง:

- **client ต้องหา primary ตัวใหม่ให้เจอ** ผ่าน writer endpoint ที่ถูกชี้ใหม่ หรือ driver ที่คอยหา node ที่เขียนได้
- **replica ตัวอื่นต้องตามตัวใหม่** ถ้าใช้ GTID ของ MySQL ตัว replica จะต่อไปที่ source ตัวใหม่แล้วหาตำแหน่งของตัวเองได้ (`SOURCE_AUTO_POSITION`) ส่วนใน Amazon RDS การ promote replica ตัวหนึ่งจะทิ้งตัวอื่นไว้กับ source ตัวเก่า เลยต้องสร้าง replica ใหม่จาก instance ที่ถูก promote
- **primary ตัวเก่าต้องไม่กลับมาเป็น writer ตัวที่สอง**

ถ้าใช้ asynchronous replication ตัว commit ที่ replica ที่ถูก promote ยังไม่ได้รับจะหายไป: ปริมาณที่หายเท่ากับ lag ของมันตอนเกิด failure ให้ promote ตัวที่ตามมาไกลที่สุด และถือว่า lag ที่ยอมรับได้คือ recovery point objective ของคุณ

read replica ไม่ใช่สิ่งเดียวกับ **standby ที่มีไว้เรื่อง availability** ถึงทั้งสองตัวจะรับ log ชุดเดียวกันก็ตาม:

| | Read replica | Standby |
|---|---|---|
| **มีไว้เพื่อ** | กำลังการอ่าน | รับช่วงต่อเมื่อ primary ล่ม |
| **Replication** | ส่วนใหญ่เป็น asynchronous | ส่วนใหญ่เป็น synchronous เพื่อไม่ให้สิ่งที่ acknowledge แล้วหายไป |
| **ตอบ query** | ตอบ | หลายครั้งไม่ตอบ |
| **ขนาดเผื่อไว้สำหรับ** | ส่วนแบ่งการอ่านของตัวเอง | load ทั้งหมดของ primary |
| **Failover** | promote เองด้วยมือ หรือแบบ managed ที่อาจเสียข้อมูลเท่ากับ lag | อัตโนมัติ อยู่หลัง endpoint เดิม |

Amazon RDS แสดงความต่างนี้ได้ชัด: standby ของ Multi-AZ DB instance deployment replicate แบบ synchronous และไม่รับ traffic เลย ส่วน read replica เป็น asynchronous และอ่านได้ และ Multi-AZ DB cluster ก็มี standby สองตัวที่รับการอ่านด้วย ใน Aurora ตัว instance ชุดเดียวกันทำทั้งสองหน้าที่: writer กับ replica อีกได้ถึง 15 ตัวใช้ storage volume ร่วมกัน และถ้า writer ล่ม Aurora ก็จะ promote reader ตัวหนึ่งขึ้นมา

## ใช้ตอนไหนดี

- **งานที่เน้นอ่าน** ที่ CPU หรือ I/O ของ primary หมดไปกับ query และ query พวกนั้นยอมรับข้อมูลที่เก่าไปนิดเดียวได้: รายการสินค้า ผลการค้นหา timeline หน้า profile
- **report, export และ analytics** ที่ไม่อย่างนั้นจะทำให้ transaction ช้าลง ให้ replica เป็นของมันเองไปเลย (ดูข้อควรรู้ตอนลงมือทำ)
- **ผู้อ่านที่อยู่ไกลจาก primary** replica ในอีก region ตอบ user ที่อยู่ใกล้ได้เร็ว ส่วนการเขียนของพวกเขาก็ยังต้องเดินทางไปที่ primary
- **ลด load ของ primary** สำหรับ backup การดู schema หรือ query เฉพาะกิจ
- **ได้สำเนาไว้ promote** ตอนเกิดเหตุร้ายแรงเป็นผลพลอยได้ ถ้าเป้าหมายคือ availability ก็เพิ่ม standby ที่ทำมาเพื่อเรื่องนี้จริง ๆ ด้วย

เป็นเครื่องมือที่ผิดงานเมื่อ:

- **คอขวดอยู่ที่การเขียน** replica ไม่ได้เพิ่มกำลังการเขียน ทุกตัวต้องทำการเขียนทุกครั้งซ้ำ เรื่องนี้ต้องใช้ sharding หรือเขียนให้น้อยลง
- **การอ่าน stale ไม่ได้** ถ้า query ส่วนใหญ่ต้องการข้อมูลที่ commit ล่าสุด สุดท้ายก็ไปลงที่ primary หมด แล้ว replica ก็นั่งว่าง
- **ปัญหาอยู่ที่ query แพง ๆ ไม่กี่ตัว** replica รัน query ช้า ๆ ตัวเดิมบน schema เดิม ให้แก้ query หรือ index, cache ผลไว้ด้วย [cache-aside](../cache-aside/) หรือคำนวณ view ที่มีรูปตรงกับหน้าจอนั้นไว้ล่วงหน้า แบบที่ [CQRS](../cqrs/) และ materialised view ทำ
- **primary ยังมีที่เหลืออยู่** replica set ทำให้มีของต้องดูแลเพิ่ม: lag ที่ต้องเฝ้า, routing ที่ต้องดูแล และ failover ที่ต้องซ้อม
- **writer ในหลาย region ต้องการ latency ต่ำ** การเขียนของพวกเขายังต้องข้ามโลกไปที่ primary ตัวเดียว นั่นคือปัญหาที่ [multi-region active-active](../multi-region-active-active/) รับไปแก้ โดยแลกกับ write conflict

## ได้อะไร เสียอะไร

- **eventual consistency เข้ามาอยู่ใน relational database** โค้ดที่อ่านทันทีหลังเขียน โค้ดที่รันใน web request แล้ว redirect หรือโค้ดที่ส่ง ID ไปให้ background job ที่อ่านทันที จะเห็นข้อมูลเก่าเป็นครั้งคราว bug พวกนี้เกิดไม่บ่อย ขึ้นกับ load และ reproduce ยาก
- **แอปพลิเคชันต้องรู้เรื่องนี้** read/write splitting ไม่ได้โปร่งใส: ต้องมีคนตัดสินทีละ query ว่ามันรันที่ไหนได้
- **lag ไม่มีขอบเขตบน** ตัวเลขปกติอยู่ที่หลักมิลลิวินาที แต่กรณีแย่ที่สุดยาวได้เท่ากับการ replay ที่ค้างนานที่สุด ให้วางแผนรองรับ replica ที่ตามหลังเป็นนาที เพราะสักวันก็จะมีสักตัวเป็นแบบนั้น
- **กำลังต้องเหลือพอตอนเสียไปหนึ่งตัว** พอ replica ตัวหนึ่งออกจาก rotation ส่วนแบ่งการอ่านของมันก็ย้ายไปที่ตัวอื่น (step 4) ถ้ามีสาม replica ที่แต่ละตัวทำงานอยู่ที่ 70 % การเสียไปหนึ่งตัวจะทำให้อีกสองตัวรับไม่ไหว แล้วพวกมันก็จะ lag จนหลุดออกจาก rotation ตามกันไป และผลัก load ทั้งหมดไปที่ primary
- **ต้นทุนโตตามข้อมูล ไม่ใช่ตาม traffic** replica ทุกตัวเก็บข้อมูลทั้งชุดและ replay การเขียนทุกครั้ง ไม่ว่ามันจะตอบ query เยอะหรือไม่
- **replica ก็ถ่วง primary ได้เหมือนกัน** ถ้ามี replication slot ตัว PostgreSQL replica ที่หยุดอ่าน log จะทำให้ primary ต้องเก็บ log นั้นไว้ และ standby ที่เปิด `hot_standby_feedback` ไว้จะห้ามไม่ให้ primary เก็บกวาดแถวที่ query บน standby ยังต้องใช้ ทำให้ตารางบน primary บวม
- **สำเนาที่ซื่อตรงก็ copy ความผิดพลาดไปด้วย** ตารางที่โดน drop จะโดน drop บนทุก replica ในอีกไม่กี่อึดใจ replica ไม่ใช่ backup

## ข้อควรรู้ตอนลงมือทำ

- **ให้ replica เป็น read-only** PostgreSQL standby เขียนไม่ได้อยู่แล้ว แต่ MySQL replica เขียนได้ ถ้าไม่ได้ตั้ง `read_only` และ `super_read_only` เพื่อคุม account ที่มีสิทธิ์สูงด้วย การเขียนหลงเข้าไปที่นั่นทำให้สำเนาเริ่มไม่ตรงกัน
- **replica เฉพาะสำหรับ analytics** อย่าเอา replica ที่ใช้ทำ report ไปไว้หลัง reader endpoint ให้มันมีชื่อของตัวเอง ปล่อยให้ query ยาว ๆ รันที่นั่น และยอมรับว่ามันจะ lag ถ้าเป็น PostgreSQL ก็แปลว่าตั้ง `max_standby_streaming_delay` ให้สูงบน replica ตัวนั้น (`-1` คือรอ query แบบไม่จำกัด) และตั้งต่ำบน replica ที่ให้บริการ user เพราะที่นั่น query ที่โดน cancel ยังดีกว่าหน้าที่ stale ส่วน custom endpoint ของ Aurora ที่ชี้ไปที่ instance บางกลุ่มที่เลือกไว้ใน cluster เหมาะกับการแยกแบบนี้ และเอกสารของ Cloud SQL ของ Google ก็แนะนำแบบเดียวกัน: แยก replica สำหรับ query แบบ transactional กับแบบ analytical
- **เอา replica ที่ lag ออกจาก rotation** step 4 ต้องใช้ router ที่ดู lag ไม่ใช่ดูแค่ว่ายังมีชีวิตอยู่ไหม Pgpool-II หยุดส่ง `SELECT` ไปที่ standby ที่ตามหลังเกิน `delay_threshold`, MaxScale ข้าม replica ที่เกิน `max_replication_lag` และ driver ของ MongoDB ตัด secondary ที่ stale เกิน `maxStalenessSeconds` ทิ้ง (ค่าต่ำสุดที่ตั้งได้คือ 90 วินาที) แต่ไม่ใช่ reader endpoint ทุกตัวที่ดู lag เลยต้องหาให้รู้ว่าของคุณเป็นแบบไหน ถ้าของคุณเช็กแค่ว่า replica ตอบหรือเปล่า ก็ทำให้ health check ของแต่ละ replica fail เมื่อ lag เกิน limit: [health endpoint monitoring](../health-endpoint-monitoring/) และ [load balancing](../load-balancing/) อธิบายกลไกไว้แล้ว
- **ตัดสินใจไว้ว่าถ้าไม่มี replica ตัวไหนผ่านเกณฑ์จะทำยังไง** การถอยกลับไปที่ primary ทำให้หน้าเว็บยังถูกต้อง แต่อาจทำให้ primary รับไม่ไหวในจังหวะที่แย่ที่สุด การตอบด้วยข้อมูล stale ทำให้ primary ปลอดภัย ให้เลือกแยกตามกลุ่ม query ไว้ก่อนเกิดเหตุ
- **ให้ replica มีขนาดเท่า primary** มันต้อง apply การเขียนชุดเดียวกัน และตัวใดตัวหนึ่งอาจต้องขึ้นมาเป็น primary AWS แนะนำให้ RDS for MySQL read replica มี compute และ storage เท่ากับ source ของมัน
- **Limit ตามเอกสาร ณ เดือนตุลาคม 2026**
  - *Amazon RDS:* read replica ได้ถึง 15 ตัวต่อ source instance หนึ่งตัว จะอยู่ Region เดียวกันหรือคนละ Region ก็ได้
  - *Amazon Aurora:* replica ได้ถึง 15 ตัวใน cluster และปกติ replica พวกนี้ lag น้อยกว่า 100 ms มาก เพราะมันอ่านจาก storage ชุดเดียวกัน ส่วน global database เพิ่ม secondary Region แบบ read-only ได้อีกถึง 10 Region ที่ปกติตามหลังไม่ถึงหนึ่งวินาที
  - *Azure Database for PostgreSQL:* replica ได้ถึงห้าตัวต่อ primary จะอยู่ region เดียวกันหรือ region อื่นก็ได้ virtual endpoint ของมันให้ชื่อ writer หนึ่งชื่อและชื่อ read-only หนึ่งชื่อที่ยังใช้ได้หลัง promote แต่ชื่อ read-only ชี้ไปที่ server ตัวเดียวและไม่กระจาย load
  - *Google Cloud SQL:* Google แนะนำให้มี direct replica ไม่เกิน 10 ตัวต่อ primary และถ้าเกินนั้นให้ใช้ cascading replica ส่วน cross-region replica ก็ใช้ได้ และ read pool หนึ่งชุดมีได้ 1 ถึง 20 node
- **Cross-region replica** ตอบการอ่านในพื้นที่ได้ และใช้เป็นสำเนาสำหรับ disaster recovery ไปด้วย แต่ให้คาดไว้ว่า lag จะมากกว่าใน region เดียวกัน และจำไว้ว่าการเขียนของ user พวกนั้นยังไปที่ region ของ primary
- **ตั้ง alert เรื่อง lag แยกต่อ replica** ไม่ใช่ดูค่าเฉลี่ย และตั้ง alert เมื่อ replica ออกจาก rotation ค่าเฉลี่ยของทั้งกลุ่มจะซ่อน replica ตัวที่ตามหลังอยู่สิบนาทีแต่ยังให้บริการอยู่
- **ทดสอบเส้นทางที่ stale** ใส่ delay ปลอม ๆ ให้ replica ใน test environment แล้วลองคลิกไล่ดูทั้ง product หน้าจอที่พังคือหน้าที่ต้องใช้วิธีแก้แบบ read-your-writes สักแบบ
- **ผู้ใช้ log ชุดเดียวกันรายอื่น** [Change data capture](../change-data-capture/) อ่าน log ที่ replica ตามอยู่ แล้วเอาไปป้อนให้ cache, search index และ warehouse นี่คือทางที่ควรใช้ถ้าสำเนาต้องมีรูปต่างจากต้นทาง
