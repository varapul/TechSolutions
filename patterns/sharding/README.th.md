## ปัญหา

database server ตัวเดียวมีเพดานของมัน เพิ่ม CPU เพิ่ม memory หรือใช้ disk ที่เร็วขึ้นก็ช่วยยกเพดานได้ แต่ยิ่งเพิ่มก็ยิ่งแพงขึ้นทุกขั้น และถึงจุดหนึ่งก็ไม่มีเครื่องที่ใหญ่กว่านี้ให้ซื้อแล้ว ฝั่ง read ยังข้ามเพดานนี้ไปได้ด้วยการทำสำเนา: replica กับ cache ช่วยรับ query แทน primary แต่ฝั่ง write ทำแบบนั้นไม่ได้ การเขียนทุกครั้งยังต้องไปลงที่ primary ตัวเดียว และ replica ทุกตัวก็ต้อง replay การเขียนนั้นด้วย พอปริมาณการเขียน ขนาดข้อมูล หรือชุดแถวที่ต้องอยู่ใน memory โตเกินที่ server ตัวเดียวรับไหว ก็ต้องแบ่งตัวข้อมูลเองออกเป็นส่วน ๆ

## ทำงานยังไง

Sharding แบ่งข้อมูลชุดเดียวออกเป็น **shard** หลายตัว: แต่ละตัวเป็น database แยกกันที่มี schema เดียวกัน และเก็บแถวเฉพาะส่วนของตัวเอง

1. **เลือก shard key** คือ column (หรือไม่กี่ column) ที่ทุกแถวมี เช่น `customer_id` แถวที่มีค่า key เดียวกันจะอยู่บน shard เดียวกันทั้งหมด
2. **จับคู่ key กับ shard** จะใช้ฟังก์ชันของ key ตารางช่วงของ key หรือ lookup table ก็ได้ เป็นตัวตัดสินว่า key แต่ละตัวอยู่บน shard ไหน
3. **route ทุก query** ตัวแอปพลิเคชัน, database driver ของมัน หรือ proxy จะหา shard จาก key ที่อยู่ใน query แล้วส่ง query ไปที่ shard นั้นที่เดียว ไม่ส่งไปที่อื่น
4. **เก็บแถวที่เกี่ยวกันไว้ด้วยกัน** ตารางลูกมี key ของตารางแม่ติดไปด้วย (order มี `customer_id`) ทำให้ customer หนึ่งรายกับ order ทั้งหมดของเขาอยู่บน shard เดียวกัน และ join กับ transaction ระหว่างกันก็จบอยู่ใน shard นั้น

shard แต่ละตัวรับแค่ส่วนหนึ่งของการเขียน พื้นที่เก็บข้อมูล และ query ทั้งหมด และเพิ่ม shard ก็คือเพิ่มกำลัง ตราบใดที่ key กระจาย load ได้เท่า ๆ กัน และ request ส่วนใหญ่มี key ติดมาด้วย

### Horizontal, vertical และ functional partitioning

แนวทางเรื่อง data partitioning ของ Azure แบ่งวิธีแบ่งข้อมูลไว้สามแบบ และใช้ผสมกันได้

- **Horizontal partitioning** ที่มักเรียกกันว่า sharding: ทุก partition มี schema เดียวกันแต่เก็บคนละแถว ก็คือ pattern นี้
- **Vertical partitioning:** แต่ละ partition เก็บแค่บาง column ของ item เดียวกัน เช่น field ที่อ่านบ่อยอยู่ใน store หนึ่ง ส่วน field ที่แทบไม่ได้ใช้หรือ sensitive อยู่อีก store หนึ่ง
- **Functional partitioning:** แบ่งข้อมูลตามส่วนของระบบที่ใช้มัน เช่น invoice อยู่ใน store หนึ่ง ส่วน inventory อยู่อีก store หนึ่ง [Database per service](../database-per-service/) ก็คือ functional partitioning ตามขอบเขตของ service

### Strategy: key หา shard ของตัวเองยังไง

Sharding pattern ของ Azure Architecture Center อธิบาย strategy ไว้สี่แบบ: lookup (หรือเรียกว่า directory-based), range-based, hash-based และ geographic

| Strategy | router หา shard ยังไง | เก่งเรื่อง | ต้องระวัง |
|---|---|---|---|
| **Lookup** (directory) | มี map จาก key แต่ละตัว หรือกลุ่มของ key ไปที่ shard | คุมได้เต็มที่: ย้าย tenant ทีละราย หรือให้ customer รายใหญ่มี shard เป็นของตัวเอง | map เป็น state สำคัญที่ต้อง highly available และต้อง cache ไว้ แล้วทุก request ก็ต้องเสียเวลา lookup หนึ่งครั้ง |
| **Range** | shard แต่ละตัวดูแลช่วงของ key ที่ต่อเนื่องกัน | range query เช่น order ทั้งหมดในเดือนเดียว จบอยู่บน shard เดียว | key ที่เรียงต่อกัน (timestamp, ID แบบ auto-increment) จะส่งการเขียนใหม่ทุกครั้งไปที่ shard ตัวสุดท้าย |
| **Hash** | ใช้ hash ของ key เลือก shard | กระจาย key และ load ได้เท่า ๆ กัน โดยไม่ต้องดูแล map | range query ต้องไปทุก shard และ `hash(key) % N` จะย้าย key ส่วนใหญ่ทุกครั้งที่ N เปลี่ยน |
| **Geographic** | ใช้ region ของ user หรือ tenant เลือก shard | data residency และ latency ต่ำสำหรับ user ที่อยู่ใกล้ข้อมูลของตัวเอง | region แต่ละที่ไม่ค่อยมีขนาดเท่ากัน เลยควรใช้คู่กับ strategy อื่นภายในแต่ละ region |

ระบบจริงใช้หลายแบบผสมกัน ใน diagram มีการ hash key ให้ตกอยู่ใน **logical shard** หนึ่งจากทั้งหมด 12 ตัว แล้วค่อยเปิดดูว่า server ไหนถือ logical shard นั้นอยู่: hash ช่วยกระจายข้อมูลให้เท่า ๆ กัน ส่วน map เล็ก ๆ นี้ทำให้ย้าย logical shard ทั้งตัวในภายหลังได้

### เลือก shard key

shard key คือการตัดสินใจที่เปลี่ยนทีหลังได้ยากที่สุด เพราะเปลี่ยน key ก็คือต้องย้ายทุกแถว key ที่ดีควร:

- **มีค่าที่ไม่ซ้ำกันเยอะ** (high cardinality) แนวทางของ MongoDB ยก key `continent` เป็นตัวอย่างที่ไม่ดี: มีค่าที่เป็นไปได้แค่เจ็ดค่า เลยมีได้มากสุดเจ็ด chunk ทำให้ข้อมูลกระจายไปได้ไม่เกินเจ็ด shard ตลอดไป
- **กระจายข้อมูลและ traffic ได้เท่า ๆ กัน** ค่าที่โผล่บ่อยมาก ๆ กับค่าที่มีแต่เพิ่มขึ้นเรื่อย ๆ (timestamp, sequence) จะทำให้การเขียนไปกองอยู่ที่ shard เดียว การ hash key แก้ปัญหาที่สองได้ แต่แก้ปัญหาแรกไม่ได้ เพราะทุกแถวที่มีค่าเดียวกันก็ยัง hash ไปตกที่เดิมอยู่ดี
- **อยู่ใน query ที่สำคัญ** query ที่มี key จะไปที่ shard เดียว ส่วน query ที่ไม่มี key ต้องไปทุก shard ให้ลิสต์ query ที่ต้องรองรับให้ครบก่อนเลือก
- **เก็บข้อมูลที่เกี่ยวกันไว้ด้วยกัน** ตารางที่ join กันหรือ update ไปพร้อมกันควรใช้ key เดียวกัน แถวของมันจะได้ไปลงที่ shard เดียวกัน Citus เรียกตารางแบบนี้ว่า co-located ส่วน Spanner เอาแถวลูกไปวางสลับแทรกกับแถวแม่ (interleave) ได้
- **ไม่เปลี่ยนค่า** แถวที่ key เปลี่ยนต้องย้ายไปอยู่ shard อื่น Azure Cosmos DB ไม่ยอมให้ update ค่า partition key ของ item เลย: ต้องสร้าง item ใหม่ด้วยค่าใหม่ แล้วลบตัวเก่าทิ้ง

ในซอฟต์แวร์แบบ multi-tenant คนมักเลือก tenant ID เพราะ request เกือบทุกตัวเกี่ยวกับ tenant เดียว และ tenant ไม่ได้ใช้แถวร่วมกัน แต่ก็ต้องมีแผนรองรับ tenant ที่โตจน shard เดียวไม่พอ ตัวอย่างเช่น Notion shard ข้อมูล Postgres ของตัวเองตาม workspace ID เพราะทุก block เป็นของ workspace เดียวเท่านั้น ส่วน [Cell-based architecture](../cell-based-architecture/) ไปไกลกว่านั้นอีกขั้น คือให้ tenant แต่ละกลุ่มมีสำเนาของทั้ง stack ไม่ใช่แค่ database

### Routing: map อยู่ที่ไหน

- **อยู่ในแอปพลิเคชันหรือ driver ของมัน** library ตัวหนึ่งจะหา shard ให้และเก็บ connection pool ไว้แยกต่อ shard ตัวอย่างเช่น elastic database client library ของ Azure SQL Database ที่ดูแล shard map และ route แต่ละ query ตาม key ของมัน ตรงนี้เป็นจุดเริ่มที่ง่ายที่สุด แต่ทุก service ที่แตะข้อมูลก็ต้องมี logic ชุดเดียวกันและ map ตัวเดียวกัน
- **อยู่ใน proxy หรือ coordinator** แอปพลิเคชันคุยกับอะไรบางอย่างที่ดูเหมือน database ตัวเดียว Vitess วาง VTGate ไว้หน้า MySQL ที่ shard แล้ว: VTGate แปลง shard key เป็น keyspace ID ด้วย *vindex* แล้วส่ง query ไปที่ shard ที่ช่วง key ครอบ ID นั้นอยู่ Citus route query จาก coordinator node ไปที่ PostgreSQL worker node ส่วนใน MongoDB ตัว router `mongos` จะส่งแต่ละ query ไปที่ shard ที่ถูกต้อง โดยใช้ cluster metadata ที่เก็บไว้บน config server

map จะอยู่ที่ไหนก็ตาม มันต้อง highly available และ cache ได้ ถ้า map ผิดหรือติดต่อไม่ได้ ก็ไม่มีใครหาข้อมูลของตัวเองเจอ

### Query ที่ไม่มี key: scatter-gather และ global index

query ที่ไม่มี shard key อย่างการค้นด้วย email ใน step 3 จะตอบได้ทางเดียวคือถามทุก shard แล้วเอาผลมารวมกัน MongoDB เรียกแบบนี้ว่า broadcast operation ส่วน Vitess ก็กระจาย (scatter) query แบบนี้ไปทุก shard ตัว scatter-gather เสีย query หนึ่งตัวต่อ shard ต้องรอ shard ที่ช้าที่สุด และยิ่งเพิ่ม shard ก็ยิ่งแพงขึ้น มีบ้างไม่กี่ตัวก็ไม่เป็นไร แต่ถ้ามีตัวที่เรียกบ่อยแปลว่าการออกแบบมีปัญหา ทางออกมีดังนี้:

- **Global secondary index:** สำเนาอีกชุดของการ lookup ที่ partition ด้วย column อื่น Vitess lookup vindex เป็นตารางที่ map ค่าอย่าง email ไปที่ keyspace ID ของมัน ทำให้ query ไปที่ shard เดียว Amazon DynamoDB update global secondary index แบบ asynchronous และให้อ่านจากมันได้แค่แบบ eventually consistent ส่วน global secondary index ของ Azure Cosmos DB ก็ eventually consistent กับข้อมูลต้นทางเหมือนกัน
- **Read model แยกต่างหาก** ที่สร้างมาเพื่อ query กลุ่มนั้น และรับข้อมูลมาจาก shard: เช่น search index, reporting store หรือ [materialized view](../materialized-view/) ดู [CQRS](../cqrs/) ประกอบด้วย
- **ยอม fan-out** สำหรับ query ที่นาน ๆ ทีจะเรียก แต่ให้ query ทุก shard แบบขนาน และใส่ time limit ให้ทั้ง query

### Join และ transaction ข้าม shard

การเก็บแถวที่เกี่ยวกันไว้บน shard เดียวคือด่านป้องกันหลัก ถ้าทำแบบนั้นไม่ได้:

- **copy ตาราง reference เล็ก ๆ ไปไว้ทุก shard** (ประเทศ, plan, สกุลเงิน) Citus มี reference table ไว้ทำเรื่องนี้โดยตรง
- **Denormalize** เอาเฉพาะไม่กี่ field ที่ต้องใช้จากอีกฝั่งของขอบเขตมาเก็บไว้ และยอมรับว่าสำเนานั้นอาจตามหลังได้
- **ใช้ distributed transaction ถ้า database มีให้ และรู้ราคาของมัน** Spanner commit transaction ที่ครอบหลาย split ด้วย two-phase commit และข้ามขั้นนี้ไปถ้าเกี่ยวกับ split เดียว MongoDB รองรับ transaction ข้าม shard ตั้งแต่ version 4.2 แต่ manual ของมันเตือนว่าแพงกว่าการเขียน document เดียว และใช้แทน schema ที่ทำให้ transaction แบบนี้เกิดไม่บ่อยไม่ได้ Vitess มีโหมด two-phase commit ที่ทำให้ commit ข้าม shard เป็น atomic แต่ไม่ isolated: reader คนอื่นอาจเห็นการเปลี่ยนแปลงของบาง shard ก่อน shard อื่น และ commit ก็ช้าลง ส่วน transaction ของ DynamoDB ครอบได้ถึง 100 item ในหลายตารางภายใน account และ Region เดียวกัน และทุก item จะถูกอ่านหรือเขียนสองรอบ คือรอบ prepare กับรอบ commit
- **เลี่ยง distributed transaction** แล้วประสาน local transaction ด้วย [saga](../saga-orchestration/) โดยมีขั้นตอน compensate ไว้ใช้ตอนที่ขั้นไหนล้มเหลว

### Hot spot

hash ที่กระจายเท่า ๆ กันช่วยกระจาย key ได้ แต่ไม่ได้กระจาย traffic แค่ customer รายเดียวที่ใหญ่มากหรือ active มากก็ยังทำให้ shard ของตัวเองรับไม่ไหวได้ อย่างใน step 3 ส่วนวิธีกระจาย load มีดังนี้:

- **ย้าย customer รายใหญ่** ถ้ามี lookup map ก็ให้ tenant รายใหญ่มี shard เป็นของตัวเองได้ ส่วน tenant เล็ก ๆ ใช้ร่วมกัน
- **แตก key ที่ hot** แนวทางของ DynamoDB คือเติม suffix ต่อท้ายค่า partition key ที่ถูกใช้หนัก จะสุ่มหรือคำนวณจาก attribute อื่นก็ได้ การเขียนของ key นั้นจะได้กระจายไปหลาย partition แต่ทีนี้ถ้าจะอ่านทุกอย่างของ key นั้น ก็ต้อง query ทุก suffix แล้วเอาผลมารวมกัน
- **cache การอ่านที่ hot** ด้วย [cache-aside](../cache-aside/) แถวที่คนอ่านเยอะจะได้ตอบจาก memory แทนที่จะไปที่ shard
- **ให้ database แตกให้เอง** adaptive capacity ของ DynamoDB ให้ item ที่ถูกเข้าถึงบ่อยมี partition เป็นของตัวเองได้ แล้ว partition นั้นก็รับได้ถึงเพดานของ partition คือ 3,000 read unit และ 1,000 write unit ต่อวินาที ส่วน Spanner แตกช่วง key ที่ใช้หนักตาม load

### Reshard โดยไม่ต้องหยุดระบบ

ถ้าใช้ `hash(key) % N` ตัว key จะย้ายทุกครั้งที่เศษของมันเปลี่ยน ตอนเปลี่ยนจาก 3 shard เป็น 4 shard ตัว key จะอยู่ที่เดิมก็ต่อเมื่อ `key % 3` เท่ากับ `key % 4` เท่านั้น key ที่เป็นแบบนี้มีแค่ 3 ใน 12 ตัว ทำให้ข้อมูล 75% ต้องย้าย มีสองวิธีที่เลี่ยงเรื่องนี้ได้:

- **logical shard จำนวนมากบน server จำนวนน้อยกว่า** hash ให้ตกอยู่ใน logical shard ที่มีจำนวนตายตัวและเผื่อไว้เยอะ แล้วเก็บ map เล็ก ๆ จาก logical shard ไปที่ server ทำให้ logical shard ของ key ไม่เปลี่ยนเลย พอเพิ่ม server ก็แค่ย้าย logical shard ทั้งตัวแล้ว update map ส่วน Redis Cluster ก็ hash ทุก key ให้ตกอยู่ใน slot หนึ่งจาก 16,384 slot (CRC16 ของ key หรือของส่วนที่อยู่ใน `{hash tag}` เพื่อให้ key ที่เกี่ยวกันอยู่ slot เดียวกัน แล้ว modulo 16,384) และย้าย slot ระหว่าง node ได้โดยยังให้บริการต่อไปได้ ส่วน Notion แบ่งข้อมูล Postgres เป็น 480 logical shard วางบน database 32 ตัว ตัวละ 15 แล้วต่อมาก็กระจายไปบน database 96 ตัว ตัวละ 5 ตัว จำนวน logical shard เป็นเพดานตายตัวของจำนวน server เลยควรตั้งไว้สูงกว่าที่คาดว่าจะต้องใช้ไปมาก ๆ
- **Consistent hashing** วางทั้ง key และ server ไว้บนวงแหวนของค่า hash แล้วให้แต่ละ key ไปอยู่กับ server ตัวถัดไปบนวงแหวน server ตัวใหม่จะรับไปแค่ key ที่อยู่ระหว่างตัวมันกับ server ตัวก่อนหน้า Karger กับทีมอธิบาย consistent hashing ไว้ในปี 1997 เพื่อกระจาย web cache โดยไม่ให้เกิด hot spot ส่วน Dynamo ของ Amazon ใช้มันคู่กับ *virtual node* คือให้ server แต่ละตัวมีหลายตำแหน่งบนวงแหวน และ paper ของ Dynamo ก็เล่าว่าภายหลังเปลี่ยนไปใช้ partition จำนวนตายตัวที่มีขนาดเท่ากันแล้วแบ่งให้ node ต่าง ๆ ถือ วิธีนี้แยกเรื่อง partitioning ออกจากเรื่อง placement และ balance load ได้ดีที่สุดในบรรดาวิธีที่ทีมลองมา

การย้าย logical shard ระหว่างที่ระบบยังให้บริการอยู่ มีโครงเหมือนกันใน database ส่วนใหญ่ step 4 แสดงการ copy การตามเก็บ และการสลับ ส่วนการย้ายแบบรอบคอบจะ verify ก่อนสลับด้วย:

1. **Copy** แถวไปที่ server ใหม่ ระหว่างที่ server เก่ายังรับ read และ write ตามปกติ
2. **ตามเก็บ** ด้วยการ replay การเปลี่ยนแปลงที่เกิดขึ้นตั้งแต่เริ่ม copy จาก log ของ database ตรงนี้ก็คือ [change data capture](../change-data-capture/)
3. **Verify** ด้วยการเทียบจำนวนหรือ checksum หรือส่ง read เดียวกันไปที่ทั้งสองชุดแล้วเทียบคำตอบ
4. **สลับ** map ระหว่างที่หยุดการเขียนไว้แป๊บเดียว แล้วค่อยลบชุดเก่าทิ้งเมื่อไม่มีใครอ่านมันแล้ว

Reshard workflow ของ Vitess จะ copy ข้อมูล ตาม binary log เทียบสองชุดด้วย VDiff แล้วค่อยย้าย read และ write ด้วย SwitchTraffic โดยเก็บ ReverseTraffic ไว้เป็นทางถอยกลับ `reshardCollection` ของ MongoDB (ตั้งแต่ 5.0) copy และตามเก็บไปโดยที่ collection ยังใช้งานได้ และจะ block การเขียนก็ต่อเมื่อประเมินว่างานที่เหลือใช้เวลาไม่ถึง 500 ms ส่วน Citus ย้าย shard ด้วย logical replication ของ PostgreSQL และต้องใช้ write lock แค่ช่วงสั้น ๆ ตอนสลับ การ re-shard ของ Notion ก็ใช้ logical replication เหมือนกัน ตรวจ database ใหม่ด้วย dark read แล้วสลับที่ connection pooler ของตัวเอง ฝั่ง user เห็นเป็นการรอแค่ราว ๆ หนึ่งวินาทีเป็นอย่างมาก

## ใช้ตอนไหนดี

- ปริมาณการเขียน ขนาดข้อมูล หรือ working set เกินกว่าที่ server ตัวใหญ่ที่สุดที่พอจะรันได้รับไหว
- งานที่ request เกือบทุกตัวมี key เดียวติดมา: tenant, user, device หรือ account
- ข้อมูลที่ต้องอยู่ใน region ที่กำหนด หรือ tenant ที่ต้องแยกออกจากกัน

Sharding ถอยกลับได้ยาก: พอข้อมูลกระจายออกไปแล้ว ทุก query, report, migration และ backup ต้องรับมือกับมัน ลองทางที่ถูกกว่าก่อน:

- **Scale up** แล้ว tune query กับ index ไปด้วย การมี server ตัวเดียวที่ใหญ่ขึ้นทำให้ join, transaction และงาน operation ยังง่ายอยู่
- **เพิ่ม [read replica](../read-replicas/)** ถ้าคอขวดอยู่ที่ read ไม่ใช่ write
- **Cache** ด้วย [cache-aside](../cache-aside/) แล้ว archive หรือลบข้อมูลที่ไม่มีใครอ่านแล้วทิ้ง
- **Partition ตารางภายใน database เดียว** เช่นด้วย declarative partitioning ของ PostgreSQL ถ้าปัญหาคือมีตารางใหญ่มาก ๆ ไม่กี่ตาราง ไม่ใช่ server ทำงานหนัก
- **ใช้ database ที่ shard ให้เอง** (ดูด้านล่าง) ถ้า data model ของมันเข้ากับงาน

## ได้อะไร เสียอะไร

- **key เปลี่ยนยาก** เปลี่ยน key คือต้องย้ายทุกแถว และ key ที่ไม่ดีก็ทำให้เสียค่า scatter query กับ hot spot ไปตลอดเวลาที่ยังใช้มันอยู่
- **query ที่ไม่มี key จะแพง** และยิ่งมี shard มากก็ยิ่งแพงขึ้น
- **join และ transaction ข้าม shard ไม่ได้มาฟรี ๆ** ต้องออกแบบให้มันจบใน shard เดียว จ่ายค่า two-phase commit หรือยอมรับ eventual consistency ด้วย saga
- **load แทบไม่เคยเท่ากัน** tenant รายใหญ่ key ที่คนใช้เยอะ และ key ที่เรียงต่อกัน ทำให้ load ไปกองอยู่ที่ไม่กี่ shard
- **มีของให้ดูแลมากขึ้น** database หลายตัวที่ต้อง backup, patch, monitor และ fail over รวมถึง router กับ map ด้วย
- **การรับประกันระดับทั้ง database หยุดอยู่ที่ขอบ shard** unique constraint หรือ sequence แบบ auto-increment ครอบคลุมแค่ database ของตัวเอง ทำให้สอง shard แจก ID ซ้ำกันได้ ให้ใช้ ID ที่ unique ทั้งระบบ เช่น UUID หรือ ID ที่มีเลข logical shard อยู่ข้างใน

## ข้อควรรู้ตอนลงมือทำ

- **วางแผนเรื่อง reshard ตั้งแต่วันแรก** เริ่มด้วย logical shard ที่มากกว่าจำนวน server เยอะ ๆ ถึงช่วงแรกจะอยู่บน server ตัวเดียวหมดก็ตาม
- **ดูแลทีละ shard** backup ทำแยกต่อ shard และการ restore แบบ point-in-time ของ shard หนึ่งอาจไม่ตรงกับ shard อื่น ให้ตัดสินใจไว้ว่าจะ restore ทุกตัวไปพร้อมกันยังไง การเปลี่ยน schema ต้องไปให้ถึงทุก shard และไม่มีทางลงทุกที่ได้ในจังหวะเดียวกัน เลยต้องทำให้การเปลี่ยนแต่ละครั้ง backward compatible ด้วย [expand and contract](../expand-and-contract/) และ monitor ทุก shard ไม่ใช่ดูแค่ยอดรวม จะได้จับความไม่สมดุลได้เร็ว
- **มอง map เป็น dependency ตัวหนึ่ง** cache มันไว้ใน router ทำ version ให้มัน และทำให้ entry ที่ stale นำไปสู่การ retry แบบที่ Redis Cluster ตอบกลับด้วย redirect `MOVED` ไม่ใช่นำไปสู่การเขียนลงผิด shard
- **Database ที่ partition ให้เอง:**
  - *Amazon DynamoDB* เอา partition key เข้า hash function ภายในเพื่อเลือก partition เพิ่ม partition เมื่อข้อมูลหรือ provisioned throughput โตขึ้น และจำกัดแต่ละ partition ไว้ที่ 3,000 read unit และ 1,000 write unit ต่อวินาที
  - *Azure Cosmos DB* รวม item ทุกตัวที่มีค่า partition key เดียวกันไว้ใน logical partition ขนาดไม่เกิน 20 GB แล้วกระจาย logical partition ด้วย hash ไปบน physical partition ที่รับได้ไม่เกิน 10,000 RU/s และ 50 GB แล้วก็แตก physical partition ออกเมื่อ container โตขึ้น partition key ของ container เปลี่ยนในที่เดิมไม่ได้ ส่วน hierarchical partition key ที่ลึกได้ถึงสามระดับช่วยได้เมื่อค่าเดียวจะโตเกิน 20 GB
  - *Google Cloud Spanner* เก็บแถวเรียงตาม primary key แล้วแบ่งเป็น *split* คือช่วงของแถวที่ต่อเนื่องกัน และเพิ่มหรือลบขอบของ split เองอัตโนมัติเมื่อข้อมูลและ load เปลี่ยน ให้เลี่ยง primary key ที่มีแต่เพิ่มขึ้น เพราะจะส่งทุก insert ไปที่ปลายด้านเดียวกันของช่วง key

  service พวกนี้รับเรื่อง routing การแตก และการ rebalance ไปทำแทน แต่ไม่ได้เลือก key ให้: partition key ที่ไม่ดีก็ยังทำให้เกิด hot partition และ query ข้าม partition อยู่ดี
