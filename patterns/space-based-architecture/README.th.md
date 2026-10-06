## ปัญหา

ตั๋วคอนเสิร์ตใหญ่เปิดขายตอน 10:00 ภายในนาทีเดียวมีคน 200,000 คนเข้ามาเช็กและแย่งที่นั่ง 50,000 ที่ชุดเดียวกัน และทุก request ก็อ่านหรือเขียน row ไม่กี่ row ใน table เดียว web server กับ application server เพิ่มได้ในไม่กี่นาที แต่ทุกตัวก็ไหลไปรวมที่ database ตัวเดียวกัน การเช็กที่นั่งแต่ละครั้งคือ query การจองแต่ละครั้งต้องถือ row lock และ lock wait ก็กองพะเนินขึ้นเรื่อย ๆ database คือ tier ที่ scale ได้ช้าที่สุดและแพงที่สุด การเพิ่ม server ไว้ข้างหน้ามันเลยแค่ย้ายคอขวดลงไปที่มัน Mark Richards ก็เปิดเรื่องสไตล์นี้ด้วยเหตุผลนี้ cache ที่วางไว้หน้า database ช่วยเรื่องการอ่านได้ แต่การจองทุกครั้งก็ยังต้องไปถึง database ระหว่างที่ลูกค้ารออยู่

## ทำงานยังไง

Space-based architecture เอา database ออกจาก request path โดย processing unit แต่ละตัวเก็บข้อมูลที่ต้องใช้ไว้ใน memory แล้ว unit ต่าง ๆ ก็คอยอัปเดตสำเนาของกันและกันให้ตรงกัน แล้ว database ค่อยถูกอัปเดตทีหลังแบบ asynchronous ชื่อของส่วนต่าง ๆ มาจาก Mark Richards ใน *Software Architecture Patterns* และใน *Fundamentals of Software Architecture* ที่เขียนร่วมกับ Neal Ford

- **Processing unit** รันโค้ดของแอปพลิเคชัน (ทั้งหมด หรือแค่ส่วนหนึ่ง) พร้อมกับสำเนาข้อมูลใน memory และ replication engine ที่ส่งการเปลี่ยนแปลงของ unit ไปให้ unit อื่น
- **Virtualized middleware** ประสานงานระหว่าง unit
  - **messaging grid** รับ request แล้วส่งต่อแต่ละตัวไปให้ unit ที่ว่าง ใช้ตั้งแต่ round-robin ง่าย ๆ ไปจนถึงการติดตามว่า unit ไหนว่างอยู่ ในทางปฏิบัติ load balancer หรือ reverse proxy มักเล่นบทนี้
  - **data grid** ทำให้สำเนาใน memory ตรงกันอยู่เสมอ ด้วยการ replicate ทุกการเปลี่ยนแปลงระหว่าง unit
  - **processing grid** (optional ไม่ได้วาดไว้) orchestrate request ที่ต้องใช้ unit มากกว่าหนึ่งแบบ เช่น order unit กับ payment unit
  - **deployment manager** คอยดู response time และโหลดของผู้ใช้ แล้ว start หรือ stop unit
- **Data pump** พาการเปลี่ยนแปลงแต่ละอันจาก unit ที่ทำมัน ไปหา database แบบ asynchronous โดยปกติ pump เป็น message queue และ unit ที่ทำการ update เป็นตัวที่ส่งมันออกไป
- **Data writer** หยิบการเปลี่ยนแปลงออกจาก pump แล้วเขียนลง database
- **Data reader** ไปอีกทาง มันโหลดข้อมูลจาก database เข้า unit ผ่าน reverse pump ต้องใช้มันก็แค่ตอนที่ไม่มี unit ไหนถือข้อมูลอยู่เลย คือตอนที่ทุก unit ของ cache เริ่มแบบ cold หรือถูก redeploy หรือตอนที่ request ต้องใช้ข้อมูลเก่าที่ archive ไว้และไม่ได้เก็บใน memory ส่วน unit ที่เข้ามาร่วม grid ที่รันอยู่แล้ว จะก็อปข้อมูลมาจาก peer แทน เหมือนที่ unit ใหม่ทำใน step 4

ใน animation พอ unit start แล้ว data reader ก็โหลดผังที่นั่ง แล้ว messaging grid ก็ส่ง request แต่ละตัวไปให้ unit ตัวหนึ่งที่ตอบจาก memory การขายที่นั่ง A-12 ของ unit 1 ถูก replicate ไปที่ unit 2 แล้วก็เดินทางผ่าน data pump ไปที่ data writer และลง database พอคนแห่มาตอน 10:00 ตัว deployment manager ก็ขยาย grid จาก 2 เป็น 8 unit แล้วหดกลับลงมาทีหลัง Richards บอกว่าบางทีก็เรียกมันว่า *cloud architecture pattern* ถึง unit จะไม่ต้องรันบน cloud ก็ตาม

### ชื่อนี้มาจากไหน

space ในที่นี้คือ tuple space ในภาษา Linda ที่ David Gelernter อธิบายไว้ใน [Generative Communication in Linda](https://www.cs.unc.edu/~stotts/COMP590-059-f21/slides/lindaGenerative.pdf) (ACM Transactions on Programming Languages and Systems, มกราคม 1985) ตัว process ไม่เคยเรียกหากันตรง ๆ ตัวหนึ่งเพิ่ม tuple ลงใน space ที่ใช้ร่วมกันด้วย `out()` แล้วอีกตัวก็ดึง tuple ที่ตรงกันออกไปด้วย `in()` หรือก็อปมันด้วย `read()` ส่วน spec JavaSpaces ของ Sun ([revision 1.0](https://edoras.sdsu.edu/doc/jini/doc/specs/js-spec/js.pdf), มกราคม 1999 เป็นส่วนหนึ่งของ Jini) เอาโมเดลนี้มาใช้กับ Java object โดยมี operation `write`, `read`, `take` และ `notify` บน entry ที่จับคู่ด้วย template และ[เนื้อหาฉบับปัจจุบัน](https://river.apache.org/release-doc/current/specs/html/js-spec.html) ก็บอกว่าการออกแบบได้รับอิทธิพลอย่างมากจาก Linda ส่วน Jini ก็ไปต่อเป็น Apache River ที่[ปลดระวางไปในปี 2022](https://attic.apache.org/projects/river.html) แล้ว GigaSpaces ก็สร้าง platform เชิงพาณิชย์บน JavaSpaces และขายมันในชื่อ space-based architecture ตั้งแต่ปี 2006 แล้ว ([press release ของ McObject, ธันวาคม 2006](https://www.mcobject.com/press/december11-2006/)) [เอกสารฉบับปัจจุบัน](https://docs.gigaspaces.com/latest/overview/space-based-architecture.html) ของมันอธิบายสไตล์นี้ว่าเป็นชุดของ processing unit ที่แต่ละตัว host partition หนึ่งของ space และ service ที่ตอบสนองต่อข้อมูลของ partition นั้น และ primary partition แต่ละตัวจะมี standby backup ก็ได้

### ข้อมูลแบบ replicated หรือ partitioned

animation ใช้ grid แบบ **replicated** ที่ทุก unit ถือทุกที่นั่ง นี่คือแบบที่ง่ายที่สุด แต่ไม่ใช่แบบเดียว

| | Replicated | Partitioned (distributed) |
|---|---|---|
| แต่ละ unit ถืออะไร | สำเนาข้อมูลเต็มชุด | key ที่ตัวเองเป็นเจ้าของ บวกสำเนา backup ของ key ของ unit อื่น |
| การอ่าน | local เสมอ | local แค่กับ key ที่ unit เป็นเจ้าของ ส่วน key อื่นต้องเสีย network hop |
| การเขียน | ส่งไปทุก unit | ส่งไปที่เจ้าของ key และ backup ของมัน |
| Capacity | จำกัดด้วย memory ของ unit เดียว | โตขึ้นเมื่อเพิ่ม unit |
| Data collision | เกิดได้ แบบใน step 4 | เลี่ยงได้ เพราะเจ้าของคนเดียวเรียงลำดับการเขียนทุกครั้งของ key |
| ตัวอย่าง | Hazelcast Replicated Map, Ignite `REPLICATED` cache, Infinispan replicated cache | Hazelcast `IMap`, Ignite `PARTITIONED` cache, distributed cache ของ Infinispan และ Coherence |

รายละเอียดของ product บางตัวจากเอกสารฉบับปัจจุบัน

- Hazelcast ก็อป [Replicated Map](https://docs.hazelcast.com/hazelcast/latest/data-structures/replicated-map) ไปไว้ที่ทุก member และ replicate การ update แบบ asynchronous เอกสารของมันเลยแนะนำให้ใช้ back pressure เมื่อ update บ่อย และ map นี้ไม่มี operation แบบ atomic ของ `ConcurrentMap` ให้เลย ส่วน `IMap` แบบ partitioned กระจาย entry ไปบน [271 partition](https://docs.hazelcast.com/hazelcast/latest/architecture/data-partitioning) เป็นค่าตั้งต้น แต่ละ partition มี primary replica และ backup
- Apache Ignite [แบ่ง partitioned cache](https://ignite.apache.org/docs/ignite2/latest/data-modeling/data-partitioning) เป็น 1,024 partition เป็นค่าตั้งต้น และ rebalance เมื่อมี node เข้าหรือออก มันแนะนำ partitioned cache สำหรับข้อมูลชุดใหญ่ที่ update บ่อย เพราะทุก update ของ replicated cache ต้องไปถึงทุก node
- Infinispan แนะนำ [replicated cache](https://infinispan.org/docs/stable/titles/configuring/configuring.html) เฉพาะ cluster ที่มีไม่ถึงสิบ node เพราะ traffic ของการ replicate โตขึ้นทุกครั้งที่เพิ่ม node ส่วน distributed cache เก็บสำเนาของแต่ละ entry ตามจำนวนที่ตั้งไว้ (`numOwners`) และรอดได้ถ้าเสีย node ไปไม่เกินจำนวนนั้นลบหนึ่ง

**near cache** คือ cache เล็ก ๆ ในเครื่องที่วางไว้หน้า partitioned cache หรือ remote cache ตัวนี้เก็บ entry ที่เพิ่งใช้หรือใช้บ่อย การอ่าน hot key เลยไม่ต้องข้าม network ([Ignite](https://ignite.apache.org/docs/ignite2/latest/configuring-caches/near-cache), [Coherence](https://docs.oracle.com/en/middleware/standalone/coherence/15.1.1/develop-applications/introduction-coherence-caches.html), [Hazelcast](https://docs.hazelcast.com/hazelcast/latest/cluster-performance/near-cache)) ตัว Hazelcast อธิบาย near cache ของมันว่าเป็น eventually consistent มันคืนข้อมูล stale ได้ และถ้า invalidation rate สูง ประโยชน์ก็อาจหายไปหมด near cache เลยเหมาะกับ reference data ที่ส่วนใหญ่แค่อ่าน อย่างผังสถานที่และราคา แต่ไม่เหมาะกับสถานะว่างของที่นั่ง ที่เปลี่ยนทุกครั้งที่ขายได้

การแบ่งข้อมูลระหว่าง unit คือความคิดเดียวกับการทำ [sharding](../sharding/) ใน database โดยเลือก key (ในที่นี้คือ event กับ section) ที่ทำให้ request ส่วนใหญ่แตะแค่ partition เดียว GigaSpaces เรียกสิ่งนี้ว่า data affinity ถ้าแบ่งข้อมูลให้งานที่ request หนึ่งก่อขึ้นอยู่ใน partition เดียว ทุกการอ่านและเขียนก็จะ local อยู่กับ unit ที่เป็นเจ้าของ

### Data collision

ถ้าข้อมูลเป็นแบบ replicated ตัว unit ไหนก็ update ที่นั่งไหนก็ได้ ใน step 4 ทั้ง unit 1 และ unit 2 ขายที่นั่ง B-7 ไปทั้งคู่ภายใน replication window เดียวกัน แต่ละตัวยืนยันการขายกับลูกค้าของตัวเอง แล้วก็ได้รับ update ของอีกตัวสำหรับที่นั่งเดียวกัน Richards เรียกแบบนี้ว่า [data collision](https://www.developertoarchitect.com/lessons/lesson174.html) ใน *Fundamentals of Software Architecture* เขากับ Neal Ford ประเมินว่า collision เกิดบ่อยแค่ไหน อัตรานี้เพิ่มตามสัดส่วนของจำนวน unit ที่ใช้ cache ร่วมกันและของ replication latency ส่วนกับ update rate จะเพิ่มตามกำลังสอง และอัตราจะลดลงเมื่อ cache ถือ row มากขึ้น เพราะ update สองตัวที่เกิดพร้อมกันก็มีโอกาสชน row เดียวกันน้อยลง hot spot อย่างแถวหน้าตอนเปิดขายวินาทีแรก คือกรณีที่แย่ที่สุด

วิธีรับมือ

- **ให้แต่ละ item มีเจ้าของคนเดียว** partition ตาม section แล้วให้ messaging grid ส่งทุก request ของ section ไปที่ unit ที่เป็นเจ้าของ หรือใช้ partitioned grid ที่ทำแบบนี้ให้อยู่แล้ว เจ้าของคนเดียวเรียงลำดับการเขียนของแต่ละ key และ check-and-set แบบ atomic บนเจ้าของ (`putIfAbsent` หรือ `replace` พร้อมค่าเก่าที่คาดไว้) ทำให้ "ขายก็ต่อเมื่อที่นั่งยังว่าง" ปลอดภัย
- **ตรวจจับแล้ว resolve** ทำ version ให้ทุก entry แล้วปฏิเสธหรือ merge การเขียนที่อิงกับ version ที่เก่ากว่า ถ้าการขายสองครั้งถูกยืนยันไปแล้ว ก็ต้อง resolve ใน business process เช่นเสนอที่นั่งอื่นหรือคืนเงิน ดู [compensating transaction](../compensating-transaction/)
- **ทำ window ให้แคบลง** unit ที่ใช้ replicated cache ร่วมกันน้อยลง และ replication latency ที่ต่ำลง ช่วยลดอัตราได้ แต่ไม่มีทางเป็นศูนย์

### Durability และ consistency

การเอา database ออกจาก request path แปลว่า unit acknowledge การเปลี่ยนแปลงก่อนที่ database จะได้มัน product ที่เป็น grid เรียกแบบนี้ว่า write-behind

- Hazelcast เปลี่ยน `MapStore` ให้เป็น write-behind เมื่อ `write-delay-seconds` มากกว่าศูนย์ ส่วนศูนย์ (ค่าตั้งต้น) แปลว่า write-through ถ้าเปิด write-coalescing มันจะเก็บแค่การเปลี่ยนแปลงล่าสุดของแต่ละ key ภายใน delay นั้น ([MapStore configuration](https://docs.hazelcast.com/hazelcast/latest/mapstore/configuration-guide))
- Apache Ignite เก็บ update แบบ write-behind ไว้แล้ว flush เป็นก้อนเมื่อถึงเวลาที่กำหนดหรือ queue ถึงขนาดที่กำหนด เอกสารของมันเตือนว่า update บางตัวอาจหายถ้า node พัง และมีแค่ update ล่าสุดของ entry เท่านั้นที่ไปถึง store ([external storage](https://ignite.apache.org/docs/ignite2/latest/persistence/external-storage))
- Oracle Coherence เขียน entry ที่เปลี่ยนหลัง delay ที่ตั้งไว้ database เลยไม่มีทางตามหลังเกิน delay นั้น และมัน re-queue การเขียนที่พังได้ มันรองรับโหมดพวกนี้บน partitioned (distributed) cache ไม่ใช่บน replicated cache ([caching data sources](https://docs.oracle.com/en/middleware/standalone/coherence/15.1.1/develop-applications/caching-data-sources.html))
- write-behind cache store ของ Infinispan เอาการเปลี่ยนแปลงไปใส่ใน modification queue แล้วเขียนแบบ asynchronous การเขียนที่ค้างอยู่ใน queue อาจหายถ้า Infinispan restart ([configuring caches](https://infinispan.org/docs/stable/titles/configuring/configuring.html))
- GigaSpaces ใช้ [Mirror Service](https://docs.gigaspaces.com/latest/dev-java/asynchronous-persistency-with-the-mirror.html) แยกต่างหาก ที่รับ operation ที่ replicate มาจาก primary partition แล้วเขียนลง database ระหว่างที่ยังเขียนไม่เสร็จ primary และ backup ของมันจะเก็บ operation ไว้ใน redo log ที่ล้นลง disk ได้

วิธีทำให้ช่องว่างนี้ปลอดภัย

- **ทำ pump ให้ durable** ใช้ queue ที่ persistent และ replicated และนับว่าการเปลี่ยนแปลงถูกรับแล้วก็ต่อเมื่อมันอยู่ใน queue นั้น หรืออยู่ใน write-behind queue ของ grid ที่มี backup ไว้ ส่วน unit ที่ crash หลัง update memory แต่ก่อนส่งการเปลี่ยนแปลงต่อ ถือว่าทำมันหายในมุมของ database ถึง unit อื่นจะยังถือมันอยู่ก็ตาม [transactional outbox](../transactional-outbox/) แก้ปัญหาเดียวกันนี้ให้ service ที่เป็นเจ้าของ database คือบันทึกการเปลี่ยนแปลงกับ message ไปด้วยกัน แล้วค่อย relay message
- **ทำ writer ให้ idempotent** ปกติ pump ส่งแบบ at least once และ retry ก็อาจทำให้ message สลับลำดับ ให้แต่ละการเปลี่ยนแปลงมี ID และ version ต่อ key แล้วให้ writer ข้ามตัวซ้ำและ version ที่เก่ากว่า ([idempotent consumer](../idempotent-consumer/))
- **ตัดสินใจว่า lag หมายถึงอะไร** อะไรก็ตามที่อ่าน database ตรง ๆ (รายงาน ระบบอื่น data reader หลัง cold start) จะเห็น state ล่าสุดที่ writer เก็บไว้ ไม่ใช่ state ปัจจุบันของ grid ความลึกของ pump คือ lag ของ database ให้คอยดูไว้ write-coalescing ยังทิ้ง state ระหว่างทางไปด้วย เรื่องนี้สำคัญถ้า database ป้อนข้อมูลให้ audit trail

### Scaling และ routing

ปกติ deployment manager ก็คือ [autoscaling](../autoscaling/) ของ platform ที่ทำงานร่วมกับ membership ของ grid เอง autoscaler เพิ่ม unit แล้ว unit ก็เข้าร่วม grid จากนั้น grid ก็ replicate หรือ rebalance ข้อมูลไปให้มันก่อนจะรับงานได้ การก็อปนี้ใช้เวลา ถ้าใช้ setting ตั้งต้นของ Hazelcast ตัว Replicated Map บน member ใหม่จะตอบการอ่านก่อนการก็อปรอบแรกเสร็จ และอาจคืน null ให้ entry ที่ยังไม่ได้รับ ถ้าปิด `async-fillup` การอ่านจะถูกบล็อกไว้จนกว่าการก็อปจะเสร็จ ให้กั้น traffic ไว้ด้วย readiness check ที่รอการก็อป และถ้าเป็นการขายที่รู้เวลาล่วงหน้า ก็ scale out ก่อน 10:00 แทนที่จะรอให้คิวเกิดก่อน

messaging grid คือ [load balancer](../load-balancing/) ที่มีงานเพิ่มอีกหนึ่งอย่าง ถ้าข้อมูลเป็นแบบ partitioned หรือมีเจ้าของต่อ section มันควร route ตาม key เพื่อให้แต่ละ request ไปลงที่ unit ที่เป็นเจ้าของข้อมูลของมัน

### เทียบกับ pattern ที่คล้ายกัน

| Pattern | การอ่านถูกตอบจากที่ไหน | การเขียนไปที่ไหนก่อน | บทบาทของ database |
|---|---|---|---|
| **Space-based** | memory ของแต่ละ unit | memory ของแต่ละ unit แล้วค่อย replicate และเข้า queue | ถูกเขียนแบบ asynchronous และถูกอ่านแค่ตอนโหลด unit |
| [Cache-aside](../cache-aside/) | cache ที่เติมตามความต้องการ หรือ database | database แล้วค่อยลบ entry ใน cache | system of record ที่อยู่บน request path |
| [Read replicas](../read-replicas/) | สำเนาของ database | primary database | อยู่บนทุกเส้นทางการเขียน |
| [CQRS](../cqrs/) | read model ที่มีหน้าตาตาม query | write model (ปกติเป็น database) | อยู่บน command path |
| [Event-driven architecture](../event-driven-architecture/) | store ของแต่ละ service เอง | store ของแต่ละ service เอง แล้วค่อยเป็น event | หนึ่งตัวต่อ service |

Space-based architecture ยืมของมาจากการออกแบบแบบ event-driven (data pump คือ queue) และใช้ร่วมกับ CQRS ได้ดี (data writer update read model ไปพร้อมกับ database หลักได้) สิ่งที่ทำให้มันต่างคือ in-memory grid เป็น store หลักที่ใช้ทำงานทั้งการอ่านและการเขียน และเพิ่มหรือลด unit ได้ตามโหลดที่เปลี่ยน

## ใช้ตอนไหนดี

- workload ที่พุ่งเป็นช่วง ๆ และมี concurrency สูง บนข้อมูลชุดที่ร้อนและมีขอบเขตจำกัด เช่น ขายตั๋ว ประมูลและเสนอราคาออนไลน์ flash sale และการปล่อยสินค้าจำนวนจำกัด
- database รับ write contention แบบ synchronous ไม่ไหว และ business ยอมรับ database ที่ตามหลังอยู่ได้
- โหลดแกว่งมากพอที่ unit แบบ elastic จะคุ้มกับเวลา warm-up

เลี่ยงมันถ้า

- ข้อมูลใส่ใน memory ไม่พอ หรือการเก็บมันไว้ตรงนั้น (บนทุก unit ถ้าเป็น replicated grid) แพงกว่าที่ประหยัดได้
- งานพึ่ง relational query ที่ซับซ้อน, join หรือรายงานบนข้อมูลชุดใหญ่ Richards บอกว่าสไตล์นี้ไม่ค่อยเหมาะกับ relational application ขนาดใหญ่ที่มี operational data เยอะ
- traffic สม่ำเสมอและไม่หนักมาก แบบนี้ database, cache และ application server ไม่กี่ตัวง่ายกว่าเยอะ
- ทุกการเปลี่ยนแปลงต้อง durable หรือ consistent อย่างเข้มงวดทุกที่ก่อนจะ acknowledge (ledger, ยอดเงินในบัญชี, สต็อกที่ห้ามขายเกินเด็ดขาด) เว้นแต่จะออกแบบเรื่องเจ้าของข้อมูลและ pump ที่ durable ไว้ตั้งแต่แรก

## ได้อะไร เสียอะไร

- **ความเร็วและความยืดหยุ่นมาจาก memory และการทำงานแบบ asynchronous** การอ่านและเขียนอยู่ใน memory และ unit มาและไปตามโหลด
- **consistency กลายเป็นปัญหาของเรา** ข้อมูลแบบ replicated ทำให้เกิด collision ได้ ข้อมูลแบบ partitioned ทำให้การอ่านบางครั้งต้องกลับไปเสีย network hop และ database ก็ตามหลัง grid
- **durability ต้องตั้งใจทำ** การเปลี่ยนแปลงที่ acknowledge ไปแล้วอยู่ใน memory และใน pump จนกว่า writer จะเก็บมัน
- **memory คือเพดานของ capacity และเป็นต้นทุนก้อนใหญ่** ข้อมูลแบบ replicated ต้องจ่ายค่ามันบนทุก unit และใน grid ที่รันบน JVM ตัว heap ขนาดใหญ่ก็พางานจูน garbage collection มาด้วย
- **cold start ช้าและหนัก** หลัง restart ทั้งหมด data reader ต้องโหลดทุกอย่างใหม่ เป็นการอ่านก้อนใหญ่ที่ database ต้องรับให้รอด
- **ซับซ้อนและเทสต์ยาก** Richards ให้คะแนนสไตล์นี้ต่ำเรื่องความเทสต์ได้และความง่ายในการพัฒนา การจำลองโหลด peak ใน test environment แพง และ product ที่เป็น grid ก็ต้องใช้เวลาเรียนรู้ ให้ซ้อมความล้มเหลว (ฆ่า unit, pump, writer) ไปพร้อมกับซ้อมโหลด ดู [chaos engineering](../chaos-engineering/)
- **ต้นทุนและ lock-in** edition เชิงพาณิชย์ ค่า support เครื่องที่ใช้ memory เยอะ และ API ของตัว grid เอง รวมกันแล้วก็เยอะ

## ข้อควรรู้ตอนลงมือทำ

- **Product** (ตุลาคม 2026): [Hazelcast Platform](https://hazelcast.com/) 5.7 มีทั้ง Community และ Enterprise edition, [Apache Ignite](https://ignite.apache.org/download.cgi) ที่ 3.1 คือ release ล่าสุดของ Ignite 3 และ 2.17 คือตัวล่าสุดของสาย 2.x (เอกสารที่ลิงก์ไว้ข้างบนเป็นของสายนี้), [Infinispan](https://infinispan.org/) 16.2, [Oracle Coherence](https://github.com/oracle/coherence) ที่ Community Edition เป็น open source และ [GigaSpaces](https://www.gigaspaces.com/) XAP
- **ให้ชุดข้อมูลใน memory เล็กไว้:** ถือแค่สิ่งที่ hot path ต้องใช้ (สถานะที่นั่งของ event ที่กำลังขาย) แล้วทิ้งประวัติและ event ที่ผ่านไปแล้วไว้ใน database ที่ data reader ไปดึงมาได้ถ้าจำเป็น
- **ตัดสินเรื่องเจ้าของข้อมูลก่อน:** ข้อมูลแต่ละแบบให้เลือกว่าจะ replicated (เล็กและส่วนใหญ่แค่อ่าน), partitioned ตาม key หรือมีเจ้าของต่อ section แล้ว route request ให้ตรงกัน
- **ทำ version ให้ทุก entry** และส่ง version ไปตลอดทางผ่าน pump เพื่อให้ writer กับการตรวจจับ conflict เรียงลำดับการเปลี่ยนแปลงได้
- **วัด** replication latency, collision หรือ conflict, ความลึกของ pump และอายุของ message ที่เก่าที่สุดในนั้น (lag ของ database), memory ที่เหลือต่อ unit, เวลา warm-up ของ unit ใหม่ และเวลาโหลดใหม่ทั้งหมดตอน cold start
- **ซ้อม restart ทั้งหมด:** จับเวลาว่า data reader ใช้เวลาโหลดทุกอย่างใหม่นานแค่ไหน และเช็กว่า database รับการอ่านก้อนใหญ่นั้นได้รอด
