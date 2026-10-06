## ปัญหา

region หนึ่งก็คือ failure domain เดียว การกระจาย workload ไปหลาย availability zone ช่วยให้รอดตอนเสีย data centre ไปทั้งศูนย์ แต่ไม่รอดเหตุการณ์ระดับ region: ปัญหา network หรือไฟฟ้า การแก้ regional service ผิด หรือภัยธรรมชาติ ถ้าธุรกิจรอให้ region กลับมาไม่ได้ workload ก็ต้องมี region ที่สองที่มารับช่วงต่อได้

region ที่สองที่ถูกที่สุดแต่ยังกู้คืนได้ในหลักนาที คือ region ที่ **ไม่ทำอะไรเลยจนกว่าจะต้องใช้**: แอปพลิเคชัน deploy ไว้ที่นั่นแล้ว ข้อมูลก็อัปเดตเกือบทันตลอด และไม่มีผู้ใช้คนไหนถูกส่งไปที่นั่น แค่นี้วาดออกมาได้ง่าย ส่วนที่ยากคือตอนรับช่วงต่อ เพราะ "fail over ไปที่ standby" ไม่ใช่ action เดียว แต่เป็นห่วงโซ่ของหลาย action และแต่ละข้อต่อก็มีทางพังของมันเอง:

- **การรู้ตัว** ใช้เวลา และถ้ารู้ตัวไวเกินไป network สะดุดแป๊บเดียวก็กลายเป็น outage ที่คุณสร้างขึ้นเอง
- **การตัดสินใจ** แพงทั้งสองทาง: failover ก็ต้องทิ้งการเขียนที่ standby ยังไม่ได้รับ ส่วนลังเลก็เสีย downtime
- **การ promote** ฐานข้อมูลของ standby ทำให้เกิดสำเนาที่เขียนได้ตัวที่สอง ถ้าตัวเก่ายังไม่ตาย หรือกลับมา สองตัวนี้ก็จะแยกทางกัน (**split brain**)
- **การ redirect** ผู้ใช้ต้องพึ่ง cache ที่คุณคุมไม่ได้
- **การย้ายกลับ** ทีหลังคือ migration รอบที่สอง ไม่ใช่การ undo

pattern นี้ก็คือห่วงโซ่นั้น ไล่ทีละข้อต่อ: แต่ละข้อต่อมีต้นทุนเท่าไร และอะไรช่วยไม่ให้มันพังในวันที่ต้องใช้จริง

## ทำงานยังไง

- **active region** รัน app tier กับฐานข้อมูล **primary** และรับ traffic ทั้งหมด
- **passive region** (standby) รัน app tier ชุดเดียวกัน deploy ไว้และ healthy แต่ไม่ได้ serve ใคร และมี **replica** ของฐานข้อมูล ตัว replica ได้ข้อมูลผ่าน **asynchronous replication** มันเลยตามหลัง primary อยู่เสมอเท่ากับ replication lag
- **global traffic manager** บอก client ว่าต้องไปที่ไหน และคอย health check ทั้งสอง region ส่วนใน diagram มันคือชื่อ DNS ที่มี **failover record**: คำตอบ primary คำตอบ secondary และ health check ที่เลือกระหว่างสองคำตอบนั้น client จะ cache คำตอบไว้ตาม TTL ของมัน แล้วส่ง request ตรงไปที่ region นั้น traffic manager เลยไม่ได้อยู่ใน request path รายละเอียดนี้เป็นตัวกำหนดว่าทีหลังจะย้าย traffic ได้เร็วแค่ไหน

การ failover ผ่านขั้นตอนเดียวกันทุกครั้ง เวลาด้านล่างเป็น **ตัวอย่างจาก diagram** ที่เลือกมาให้บวกง่าย ๆ ไม่ใช่คำแนะนำ และของคุณจะต่างไปในทุกขั้น

| ขั้น | เกิดอะไรขึ้น | ในตัวอย่าง | อะไรกำหนดเวลา |
|---|---|---|---|
| **ตรวจจับ** | health check เริ่ม fail แต่จะประกาศว่า region unhealthy ก็ต่อเมื่อ fail ติดกันหลายครั้ง | +30 s: สาม check ห่างกัน 10 s | check interval × failure threshold บวก timeout ของ probe |
| **ตัดสินใจ** | มีอะไรสักอย่าง หรือใครสักคน ตัดสินใจ failover | ทันที: ตัวอย่างนี้เป็นแบบอัตโนมัติ | ถ้ามีคนอยู่ใน loop: เวลา page ประเมิน และอนุมัติ อาจนานกว่าขั้นอื่นทั้งหมดรวมกัน |
| **Promote และ fence** | replica เลิกตาม primary แล้วกลายเป็นตัวที่เขียนได้ ส่วน primary ตัวเก่าถูก fence ไว้ เพื่อไม่ให้รับการเขียนได้ถ้ามันกลับมา | +90 s | database engine และ replicated log ที่ยังเหลือต้อง apply อีกเท่าไร |
| **Redirect** | traffic manager ตอบด้วย passive region แล้ว client ก็ย้ายตามเมื่อคำตอบที่ cache ไว้หมดอายุ | ภายในราว +150 s เมื่อ TTL เป็น 60 s | TTL บวกกับทุก cache และ connection ที่เปิดอยู่ที่อยู่ได้นานกว่ามัน |
| **เวลากู้คืน** | ตั้งแต่พังจนถึงตอนที่ client ตัวสุดท้ายย้ายเสร็จ | **ราว 2.5 นาที** | ผลรวมของทุกขั้น และ RTO ต้องครอบคลุมเวลานี้ |
| **ข้อมูลที่หาย** | การเขียนที่ primary ตัวเก่า commit แล้วแต่ยังไม่ได้ส่งออกไป | **การเขียนใน 5 s สุดท้าย** | replication lag ณ ตอนที่พัง และ RPO ต้องครอบคลุมส่วนนี้ |

สองเรื่องเกี่ยวกับลำดับ:

- **fence ก่อนที่ client จะไปถึง primary ตัวใหม่** การ promote ที่ไม่มี fence จะใช้ได้ก็แค่ตราบที่ primary ตัวเก่ายังตายอยู่
- **redirect หลังการ promote** อย่างที่ตัวอย่างนี้ทำ ถ้าส่ง client ไป region ที่ฐานข้อมูลยังเป็น read-only อยู่ เขาก็แค่ได้ error อีกแบบ ถ้า traffic manager ของคุณย้ายเองทันทีที่ health check fail ตัว app tier ของ standby ก็ต้องรับมือกับฐานข้อมูลที่ยังเขียนไม่ได้ให้ไหว

หลังจากนั้น region ที่พังก็กลับมา มันต้องไม่ดึง traffic กลับไปเอง: ข้อมูลของมัน stale และมันอาจยังเก็บการเขียนที่ไม่เคยส่งออกไปไว้ มัน **กลับเข้ามาเป็น standby ตัวใหม่** ถูก rewind หรือสร้างใหม่ให้ตาม primary ตัวใหม่ แล้วไล่ตามให้ทัน การกลับไปใช้ layout เดิมเป็นอีก operation หนึ่งที่วางแผนไว้แยกกัน เรียกว่า **switchover**: หยุดการเขียนสักครู่ ให้ replica ตามทันจนครบ แล้วสลับบทบาท ไม่มีอะไรหาย เพราะไม่มีอะไรค้างอยู่กลางทาง

### standby อุ่นแค่ไหน

active-passive บอกแค่ว่าใครเป็นฝ่าย serve แต่ไม่ได้บอกว่าใน passive region มีอะไรรันอยู่มากแค่ไหน นั่นเป็นอีกเรื่องที่ต้องเลือก ปกติจะพูดกันเป็นอุณหภูมิ: cold, warm หรือ hot ส่วน [Disaster Recovery Strategies](../disaster-recovery-strategies/) เทียบตัวเลือกเหล่านี้ตามต้นทุน เวลากู้คืน และข้อมูลที่หาย เรียงจากเย็นที่สุดไปร้อนที่สุด ตามชื่อที่ AWS ใช้:

- **Backup and restore** (cold standby): ใน region ที่สองมีแค่ backup ไม่มีอะไรให้ failover ไปจนกว่าจะสร้างขึ้นมา
- **Pilot light:** ข้อมูลถูก replicate และ infrastructure หลักก็มีอยู่ แต่ต้อง start app tier ก่อนถึงจะตอบ request ได้
- **Warm standby:** สำเนาที่ครบทุกส่วนรันอยู่ในขนาดเล็กลง ตอบ request ได้ทันที แต่ต้อง scale up ก่อนถึงจะรับ load เต็มได้
- **Hot standby:** สำเนาขนาดเต็มที่ไม่รับ traffic เลย

ยิ่ง standby เย็นเท่าไร ก็ยิ่งมีขั้นแทรกระหว่าง *ตัดสินใจ* กับ *redirect* มากขึ้น (restore, start, scale) และการกู้คืนก็ยิ่งพึ่งสิ่งที่ต้องทำงานได้ระหว่างเกิดภัยมากขึ้น diagram ไม่ได้ใส่ขั้นพวกนั้น: มันสมมติว่า app tier ฝั่ง passive รับ traffic ได้ทันทีตามที่เป็นอยู่ ถ้าเป็น warm standby ที่รันขนาดเล็กลง ให้บวกเวลา scale up เข้าไปใน timeline ด้วย (ดู *Capacity ของ standby* ด้านล่าง)

### pattern เดียวกันในสเกลที่เล็กลง

primary กับ standby ที่สลับบทบาทกันไม่ได้มีแค่ในดีไซน์แบบ multi-region ขั้นตอนเดียวกันนี้โผล่มาทุกที่ที่มี node ที่เขียนได้แค่ตัวเดียว:

- **ฐานข้อมูลข้าม zone** Amazon RDS Multi-AZ เก็บ standby ไว้ใน availability zone อื่น โดย replicate แบบ synchronous และ failover ไปหามันโดยอัตโนมัติ ปกติใช้เวลา 60 ถึง 120 วินาที ด้วยการเปลี่ยน DNS name ของ instance ให้ชี้ไปที่ตัวใหม่
- **cluster manager** ที่ทำการตรวจจับ การ promote และการ fence ให้อัตโนมัติ Patroni รัน PostgreSQL โดยมี leader key อยู่ใน etcd, Consul, ZooKeeper หรือ Kubernetes: primary ต้องคอย renew key อยู่เรื่อย ๆ และพอ key หมดอายุ replica ตัวหนึ่งก็จะเอา key ไปแล้วก็ถูก promote ส่วน replica set ของ MongoDB จะเลือก primary ตัวใหม่เมื่อติดต่อตัวเก่าไม่ได้นาน 10 วินาที (ค่า default) และ primary ที่มองเห็นสมาชิกได้แค่ส่วนน้อยก็จะ step down เอง Pacemaker ก็ทำแบบเดียวกันกับ service ใดก็ได้ และจะ fence node ที่ติดต่อไม่ได้ก่อนเริ่ม service ของ node นั้นที่อื่น

ส่วนผสมก็เหมือนใน diagram: heartbeat, ผู้มีอำนาจหนึ่งเดียวที่บอกว่าใครเป็น primary (lease หรือ quorum), fence และชื่อที่คงที่แต่ย้ายที่ชี้ได้ pattern leader election คือรูปทั่วไปของเรื่องนี้ และ *Designing Data-Intensive Applications* ของ Martin Kleppmann และ Chris Riccomini ก็พูดถึงกรณีฐานข้อมูลเดียว คือ leader failover ไว้ในบทเรื่อง replication

ที่ต่างกันเมื่อข้าม region คือระยะทาง replication แบบ synchronous จะแพง การเสียข้อมูลเลยกลายเป็นเรื่องที่ต้องคิด ตัว link ระหว่างสองที่เป็นส่วนที่เชื่อถือได้น้อยที่สุดของระบบ ทำให้ false alarm กับ split brain เกิดได้ง่ายขึ้น และ client อยู่บน internet สาธารณะ การ redirect เลยไปชนกับ DNS cache

## ใช้ตอนไหนดี

- **ธุรกิจรับ downtime หลักนาทีและการเขียนที่หายหลักวินาทีได้** ตอนเกิดภัยระดับ region แต่รับไม่ได้ถ้าต้องรอให้ region กลับมา นี่คือช่องว่างระหว่างการ restore จาก backup กับการ serve จากหลาย region พร้อมกัน
- **ข้อมูลมี writer ตัวเดียว** ฐานข้อมูล relational ที่มี transaction, constraint และ sequence ยังทำงานได้เหมือนทุกวันนี้ทุกอย่าง เพราะมีแค่ region เดียวที่รับการเขียนในแต่ละช่วงเวลา และไม่มี conflict ให้ต้อง resolve
- **region ที่สองมีไว้กู้คืน ไม่ได้มีไว้ลด latency** ผู้ใช้ทุกที่ได้รับ service จากที่เดียวเป็นส่วนใหญ่ และนั่นก็รับได้
- **ทำไมเลือกแบบนี้ ไม่เลือก active-active?** [Multi-Region Active-Active](../multi-region-active-active/) กู้คืนได้เร็วกว่า เพราะ region ที่รอดก็ serve อยู่แล้ว และเส้นทาง failover ของมันก็ถูกใช้ในทุก request แต่มันต้องแลกกับการเขียนในหลาย region (conflict หรือ data model ที่แบ่ง partition เพื่อเลี่ยง conflict) headroom ในทุก region และการที่ทุก feature ต้องทำงานได้ภายใต้ eventual consistency ระหว่าง region ส่วน active-passive ทำให้แอปพลิเคชันเรียบง่าย และย้ายความยากไปไว้ใน procedure เดียวที่นาน ๆ ใช้ที เลือกแบบนี้เมื่อ procedure นั้นทำได้ตาม objective แล้วก็ต้องซ้อม procedure นั้นด้วย

ตอนไหนไม่ควรใช้:

- **เวลากู้คืนต้องเกือบเป็นศูนย์** การตรวจจับ การ promote และการ redirect รวมกันแล้ว ดีที่สุดก็ยังหลายนาที ให้ serve จากทั้งสอง region แทน
- **การเขียนที่ acknowledge แล้วต้องไม่หายเลยสักตัว** ถ้าใช้ asynchronous replication จะมีอะไรค้างกลางทางอยู่เสมอ จะไม่ให้อะไรหายเลยต้องใช้ synchronous replication ที่ใช้ได้จริงระหว่าง zone แต่แพงระหว่าง region ที่อยู่ไกลกัน หรือไม่ก็ใช้ฐานข้อมูลที่ commit ผ่าน consensus ข้าม region
- **downtime หนึ่งวันรับได้** ถ้าอย่างนั้น region ที่สองที่รันอยู่ตลอดก็คือเงินที่เสียไปเปล่า ๆ: backup ใน region อื่นกับการ rebuild ที่ test แล้วก็พอ
- **workload ยังไม่ highly available ภายใน region เดียวเลย** ความล้มเหลวส่วนใหญ่เล็กกว่าระดับ region สิ่งที่ต้องมาก่อนคือหลาย zone, standby ของฐานข้อมูลใน zone อื่น และ health check ที่ใช้ได้จริง และของพวกนี้ครอบคลุม incident ได้มากกว่า region ที่สองเยอะ
- **ภัยที่คุณกลัวอยู่ในข้อมูล** table ที่ถูก drop หรือ bug ที่ทำข้อมูลเสียจะถูก replicate ไป standby ภายในไม่กี่วินาที มีแค่ backup ที่ทำ point-in-time recovery ได้ที่ช่วยเรื่องนี้ได้
- **ไม่มีใครจะซ้อมมัน** failover ที่ไม่เคยรันจริงเป็นแค่แผน ไม่ใช่ความสามารถ

## ได้อะไร เสียอะไร

- **คุณจ่ายเงินให้ region ที่ไม่ทำอะไร และไว้ใจมันโดยไม่มีหลักฐาน** image, configuration, secret, certificate และ quota ของมันจะค่อย ๆ drift ไป เว้นแต่ทุกการเปลี่ยนแปลงจะไปที่ทั้งสอง region และเส้นทาง failover ของมันก็ได้รันน้อยมาก จนเป็นสิ่งที่ถูก test น้อยที่สุดในบรรดาทุกอย่างที่คุณดูแลอยู่
- **ตรวจจับเร็ว หรือ false alarm น้อย** interval สั้นและ threshold ต่ำจะเจอ outage จริงได้เร็วขึ้น แต่ก็จะ fire ตอนระบบช้าไปสักนาทีหรือตอน probe หายไปไม่กี่ตัวเหมือนกัน แล้ว false positive แต่ละครั้งก็ทำให้ต้องเสียการ failover จริงหนึ่งรอบ: การเขียนที่ค้างกลางทาง, cache ที่เย็นใน region ใหม่ และ migration รอบที่สองเพื่อย้ายกลับ
- **ให้ระบบอัตโนมัติหรือคนตัดสินใจ** automation เร็วและไม่เคยหลับ และมันก็จะ failover อย่างมั่นใจเต็มที่ด้วยเหตุผลที่ผิดได้ คนช้ากว่าแต่เห็น context: deployment ที่กำลังทำอยู่ monitoring ที่เสีย หรือ incident ที่ provider กำลังแก้อยู่แล้ว incident report ของ GitHub เดือนกันยายน 2012 คือกรณีที่รู้จักกันดี health check ที่ fail ตอน load หนักได้ trigger การ failover ฐานข้อมูลอัตโนมัติไปที่ node ที่ cache ยังเย็น node นั้นเลย fail check ของตัวเองบ้าง บทบาทก็เลย fail back กลับ หนึ่งวันต่อมา partition ใน cluster ไป promote node ที่ข้อมูลไม่เป็นปัจจุบัน และเพราะ record ID ที่ฐานข้อมูลสร้างถูกใช้เป็น key ใน data store อีกตัวด้วย ข้อมูลส่วนตัวบางส่วนเลยไปโผล่ให้ผู้ใช้ผิดคนเห็นอยู่ช่วงสั้น ๆ ข้อสรุปของพวกเขาคือ failover แบบนี้ควรเริ่มโดย operator เท่านั้น
- **asynchronous replication ทำให้เสียข้อมูลเท่ากับ lag** อะไรที่ primary acknowledge แล้วแต่ยังไม่ได้ส่งออกไป จะไม่มีใน primary ตัวใหม่ และผู้ใช้ที่ทำการเปลี่ยนแปลงพวกนั้นก็ได้รับแจ้งไปแล้วว่าสำเร็จ synchronous replication ปิดช่องนี้ได้ แต่ก็ทำให้ทุก commit ต้องรออีก region และ commit จะหยุดเมื่อติดต่อ region นั้นไม่ได้
- **fencing เป็นขั้นที่มักถูกข้ามมากที่สุด และเป็นขั้นที่ทำข้อมูลเสีย** region ที่ล่มอยู่สั่งให้ถอยไม่ได้ ตัว fence เลยต้องยังได้ผลไม่ว่ามันจะกลับมาเมื่อไร แม้แต่ managed service ก็สัญญาแค่ best effort ในเรื่องนี้
- **DNS ย้าย traffic ช้าและย้ายได้ไม่หมด** TTL คุมได้แค่ cache ที่เคารพมัน: resolver กับ runtime บางตัวเก็บคำตอบไว้นานกว่านั้น และ connection ที่เปิดอยู่แล้วก็ไม่เคย lookup ชื่อใหม่อีกเลย
- **standby ต้องรับ load เต็มตอนที่ยังเย็น** cache ว่าง connection pool ที่ยังไม่ได้เปิด และ fleet ที่อาจยัง scale ไม่เสร็จ ต้องเจอ traffic ทั้งหมดพร้อมกัน บวก retry ของทุกคนที่เพิ่ง fail มา
- **การย้ายกลับคือ outage window รอบที่สอง** switchover ใช้เวลาสั้นและไม่เสียอะไร แต่ก็ยังต้องหยุดการเขียนและย้าย client ทุกตัวอีกรอบ ให้เผื่องบไว้ หรือตัดสินใจอยู่ที่เดิมไปเลย

## ข้อควรรู้ตอนลงมือทำ

managed service ที่ยกชื่อมาเป็นแค่ตัวอย่าง พฤติกรรมของแต่ละตัวเช็กกับ documentation ของ vendor เมื่อเดือนตุลาคม 2026

- **การตรวจจับ**
  - *probe อะไร:* endpoint ที่เข้าผ่าน public entry point ของ region และบอกได้ว่า region ทำงานของมันได้ไหม ไม่ใช่แค่ว่า port เปิดอยู่ ทำให้มันเบา ๆ และระวังว่าจะเช็กลึกแค่ไหน: dependency ที่ทั้งสอง region ใช้ร่วมกันต้องไม่ทำให้ทั้งสองฝั่งดูเหมือนตายพร้อมกัน ส่วนตัว endpoint เอง [Health Endpoint Monitoring](../health-endpoint-monitoring/) อธิบายไว้
  - *probe จากที่ไหน:* จากหลายจุดที่อยู่นอกทั้งสอง region ผู้สังเกตคนเดียวแยกไม่ออกว่า region ตายหรือแค่เส้นทางไปหามันเสีย Amazon Route 53 probe จาก health checker ในหลาย location และถือว่า endpoint healthy ตราบที่ checker มากกว่า 18% ยังรายงานว่า healthy ส่วน Azure Traffic Manager ก็ probe จากหลาย location เหมือนกัน สอง region ที่เฝ้าดูกันเองแค่สองฝั่งจะเจอปัญหานี้แบบหนักที่สุด: แต่ละฝั่งเห็นแต่ความเงียบแล้วสรุปว่าอีกฝั่งหายไป ที่ที่สามที่ทั้งสองฝั่งติดต่อได้ (witness หรือหนึ่งเสียงใน quorum สามเสียง) จะช่วยตัดสินตอนผลออกมาเสมอกัน
  - *threshold:* เวลาในการตรวจเจอคือราว interval × threshold บวก timeout ของ probe ด้าน Route 53 จะ check ทุก 30 วินาที หรือทุก 10 วินาทีถ้ายอมจ่ายเพิ่ม และเปลี่ยนสถานะของ endpoint หลังได้ผลติดกัน 1 ถึง 10 ครั้ง (default คือ 3) ส่วน Traffic Manager probe ทุก 30 หรือ 10 วินาที และยอมให้ fail ได้ 0 ถึง 9 ครั้ง (default คือ 3) ถ้าใช้ค่า default การ fail ครั้งที่สี่ติดกันก็เลยจะ mark endpoint เป็น degraded
  - *ตอนที่ทั้งสอง region ดู unhealthy:* ให้รู้ไว้ว่า traffic manager ของคุณจะทำอะไร อย่าง failover record ของ Route 53 จะกลับไปตอบด้วย primary เมื่อ record ทั้งสองตัว unhealthy
- **การตัดสินใจ**
  - whitepaper เรื่อง disaster recovery ของ AWS แนะนำให้ระวัง failover ที่เริ่มเองอัตโนมัติจาก health check หรือ alarm เพราะ false alarm ทำให้เสีย downtime และข้อมูลเท่ากับเหตุจริง มันอธิบายทางสายกลางที่ใช้กันทั่วไป: ให้คนเป็นคนตัดสินใจ และทุกอย่างหลังจากนั้นเป็นอัตโนมัติ การเริ่มเลยเป็นแค่ action เดียว
  - Azure SQL Database ขีดเส้นเดียวกันสำหรับ failover group ของมัน มันแนะนำ policy แบบ customer-managed ที่คุณเป็นคนเริ่ม failover เอง และเก็บแบบ Microsoft-managed ไว้สำหรับ outage ที่กระทบทั้ง region ในแบบนั้น forced failover จะเกิดก็ต่อเมื่อผ่าน grace period ไปแล้ว และ grace period นี้ตั้งสั้นกว่าหนึ่งชั่วโมงไม่ได้
  - เขียนเกณฑ์ไว้ก่อนเกิด incident: ดู signal ไหน นานเท่าไร และใครมีสิทธิ์ประกาศ failover ตอนตีสาม เวลาที่ใช้ page ประเมิน และอนุมัติ นับรวมใน RTO ด้วย
  - ไม่ว่าใครเป็นคนตัดสินใจ ตัว action ก็ควรเป็นสวิตช์เดียว ยกตัวอย่าง Amazon Application Recovery Controller มี routing control (สวิตช์เปิด/ปิดที่ health check ของ Route 53 ทำตาม แก้ผ่าน API ที่ serve จากห้า region) และ Region switch plan (ขั้นตอนเรียงลำดับที่รันด้วยมือ หรือเริ่มจาก CloudWatch alarm)
- **การ promote และการ fence**
  - *การ promote* เปลี่ยน replica ให้เป็น primary: `pg_ctl promote` หรือ `pg_promote()` ใน PostgreSQL ตัว PostgreSQL เองไม่ได้ตรวจว่า primary พัง และไม่ได้บอก standby ทำให้ cluster manager หรือ runbook ต้องทำส่วนนี้แทน ตัวที่เป็น managed ได้แก่ managed failover ใน Amazon Aurora Global Database (secondary ที่เลือกไว้ปกติจะรับช่วงต่อภายในไม่กี่นาที) forced failover ของ Azure SQL failover group และการ promote cross-region replica ใน Cloud SQL (*replica failover* ไปที่ DR replica ที่กำหนดไว้ ใน edition Enterprise Plus)
  - *การ fence* ทำให้แน่ใจว่า primary ตัวเก่าจะไม่มีทางรับการเขียนได้อีกโดยบังเอิญ มีสี่วิธี:
    - **ปิดมัน** ชื่อ STONITH ("shoot the other node in the head") มาจากตรงนี้: cluster manager ตัดไฟของ node หรือ stop instance ก่อนจะเริ่ม service ที่อื่น นี่เป็นวิธีที่ใช้บ่อยที่สุดใน cluster ของ Pacemaker
    - **ตัดมันออก** fabric fencing เอาสิ่งที่ node ต้องใช้ในการก่อความเสียหายออกไป: เส้นทาง network หรือ storage ของมัน และบน cloud ก็รวมถึง credential หรือตำแหน่งของมันหลัง endpoint
    - **ให้มันถอยเอง** primary ถือ lease ที่ต้องคอย renew อยู่เรื่อย ๆ และจะหยุดรับการเขียนเมื่อ renew ไม่ได้ Patroni ทำแบบนี้ด้วย leader key ของมัน (ที่อยู่ได้ 30 วินาทีเป็นค่า default) และตั้ง watchdog ไว้ได้ ให้ reset เครื่องถ้าตัว Patroni เองค้าง
    - **ให้คนอื่นเมินมัน** การ promote แต่ละครั้งจะเพิ่ม generation number (epoch หรือ term ส่วน fencing token ก็คือแนวคิดเดียวกัน) แล้ว storage, replica และ client จะปฏิเสธอะไรก็ตามที่ถือเลขที่เก่ากว่า
  - region ที่ติดต่อไม่ได้ ก็ปิดหรือตัดออกจากภายนอกไม่ได้ เพราะฉะนั้นมีแค่ fence สองแบบหลัง หรือ endpoint ที่เลิกชี้ไปหามันแล้ว ที่ยังได้ผลตอนมันกลับมา managed service ก็สัญญาได้ไม่มากกว่านั้น Aurora เรียกกลไกของมันว่า *write fencing* และเขียนไว้ใน documentation ว่าเป็น best effort โดยมีช่วงสั้น ๆ ที่ primary ตัวเก่าอาจยังรับการเขียนได้ คำแนะนำของ Google สำหรับ Cloud SQL คือทำให้ primary ตัวเก่าเข้าถึงไม่ได้ก่อนที่ client จะเริ่มใช้ตัวใหม่ แล้วค่อยลบมันทิ้ง
  - *split brain ทำอะไร:* primary สองตัวรับการเขียนที่ต่างกันภายใต้ key, sequence และ constraint ชุดเดียวกัน ฐานข้อมูลแบบ single-leader ไม่มีทาง merge มันได้ ประวัติหนึ่งในสองชุดเลยถูกทิ้งตอน reconcile
- **การ redirect traffic**
  - *DNS failover* เป็นวิธีที่ง่ายที่สุด: record ที่มีคำตอบ primary คำตอบ secondary และ health check แบบใน Route 53 failover routing, Azure Traffic Manager priority routing หรือ Cloud DNS failover routing policy (ที่ส่ง traffic ส่วนเล็ก ๆ ไปที่ backup ตลอดเวลาได้ด้วย เพื่อพิสูจน์ว่ามันใช้ได้) การสลับก็เกิดใน data plane ของ DNS service ส่วน AWS เตือนไม่ให้ทำแผนกู้คืนที่ต้องพึ่งการ *แก้* DNS record แทน: นั่นเป็น operation ของ control plane และ control plane ของ Route 53 รันอยู่ใน region เดียว
  - *ข้อจำกัดของมัน* TTL เป็นตัวจำกัดว่า client ที่ทำตัวดีจะย้ายได้เร็วแค่ไหน และ AWS บอกว่า 60 หรือ 120 วินาทีเป็นค่าที่ใช้กันบ่อยสำหรับ record ที่มีส่วนใน failover แต่ไม่ใช่ทุก cache จะทำตัวดี หนังสือ SRE ของ Google ชี้ว่า authoritative server flush cache ของ resolver ไม่ได้ และ resolver บางตัวก็ไม่เคารพ TTL ส่วน runtime ก็มี cache ของตัวเอง: JVM เก็บผล lookup ไว้นานตามที่ตั้งใน `networkaddress.cache.ttl` และ AWS เตือนว่าใน configuration บางแบบ default คือไม่ lookup ใหม่เลยจนกว่า process จะ restart ด้าน connection ที่เปิดอยู่แล้วจะยังวิ่งไปที่ address เดิมจนกว่าจะถูกปิด AWS เลยแนะนำให้จำกัดเวลาที่ client ต่อค้างไว้ได้ และ resolver ที่ติดต่อ authoritative server ไม่ได้เลยอาจ serve คำตอบที่หมดอายุแล้วต่อไป (RFC 8767) ตัว DNS service เองเลยต้องไม่พึ่ง region ที่พัง
  - *มัน fail back เอง* ทั้ง Route 53 และ Traffic Manager จะกลับไปตอบด้วย primary ทันทีที่ health check ของมัน healthy อีกครั้ง ถ้าปล่อยไว้ region ที่กลับมาจะได้ traffic คืนก่อนข้อมูลจะตามทัน ให้กันมันไว้จนกว่าจะ switchover: ใช้ health check ที่จริง ๆ แล้วเป็นสวิตช์ (routing control) หรือปิด endpoint ไว้ หรือให้ health endpoint รายงาน role ของ region ด้วย ไม่ใช่แค่ว่า healthy ไหม ส่วน diagram แสดงสถานะนี้ไว้ว่า *healthy · on hold*
  - *global load balancer* ช่วยเลี่ยง cache ฝั่ง client เพราะ address ยังเหมือนเดิม (anycast) และการย้ายเกิดภายใน network ของ provider อย่าง AWS Global Accelerator ก็ส่ง traffic ไปที่ endpoint ที่ healthy และไม่โดนผลจาก DNS caching ที่พูดถึงด้านบน ส่วน Azure Front Door route ไปที่ origin ที่ healthy และมี priority ดีที่สุด (1 ถึง 5) ราคาที่ต้องจ่ายคือมี component อยู่ในเส้นทางของทุก request ส่วนกลไกต่าง ๆ [Load Balancing](../load-balancing/) อธิบายไว้
  - *client ที่รู้จักทั้งสอง endpoint* ไม่ต้อง redirect อะไรเลย ยกตัวอย่าง connection string ของ PostgreSQL ใส่ได้หลาย host พร้อม `target_session_attrs=read-write` แล้ว driver จะ connect ไปที่ตัวที่รับการเขียน ส่วน managed writer endpoint ก็ทำงานเดียวกันด้วยชื่อที่ตาม primary ไป (global writer endpoint ของ Aurora global database, listener ของ Azure SQL failover group) พวกนี้ก็เป็น DNS record อีกเหมือนกัน: listener ของ Azure มี TTL 30 วินาที
- **ข้อมูล**
  - *asynchronous หรือ synchronous* ระหว่าง region การ replicate แทบจะเป็น asynchronous เสมอ: commit จะ return ทันทีที่ primary ได้รับ แล้ว standby ค่อยตามมาทีหลังนิดหน่อย lag ตรงนี้คือข้อมูลที่ failover ทำหาย synchronous replication ทำให้แต่ละ commit ต้องรอจน standby ยืนยัน ต้องเสีย round trip ระหว่าง region ทุกครั้งที่เขียน และ documentation ของ PostgreSQL ก็บอกตรง ๆ ถึงต้นทุนอีกอย่าง: ถ้า synchronous standby หายไป commit จะรอ เพราะแบบนี้มันถึงใช้กันบ่อยระหว่าง zone (standby ของ RDS Multi-AZ instance เป็นแบบ synchronous) แต่หายากระหว่าง region ที่ไกลกัน
  - *จำกัดการสูญเสีย* บางระบบให้คุณตั้งเพดานของ lag แทนได้ เช่น Aurora PostgreSQL หน่วง commit บน primary ไว้ได้ ตอนที่ secondary region ทุกตัวตามหลังเกิน RPO ที่ตั้งไว้ เป็นการแลก write availability กับขอบเขตของสิ่งที่ failover จะทำหายได้
  - *การเขียนที่ไม่เคยส่งออกไป* ยังอยู่บน primary ตัวเก่า บนกิ่งของประวัติที่ไม่มีใครอื่นมี จะทำอะไรกับมันเป็นเรื่องที่ต้องตัดสินใจ และแต่ละ engine ก็มี default ของตัวเอง `pg_rewind` เอา primary ของ PostgreSQL กลับมาเป็น standby โดยเขียนทับทุกอย่างที่แยกทางไป MongoDB เขียน document ที่มัน roll back ลงไฟล์ให้คนมาตรวจดู Aurora พยายาม snapshot volume เก่าตามสภาพ ณ ตอนที่พังไว้ ก่อน rebuild region นั้นให้เป็น secondary เรื่องใครจะเป็นคนดูข้อมูลนั้น ให้ตัดสินใจไว้ล่วงหน้า และจำไว้ว่า side effect ของมัน (e-mail ยืนยัน หรือการเรียก payment provider) เกิดขึ้นไปแล้ว
  - วัด lag ตลอดเวลา และตั้ง alert ไว้ต่ำกว่า RPO เยอะ ๆ ส่วน [Read Replicas](../read-replicas/) อธิบาย replication, lag และ promotion ไว้ละเอียด
- **Capacity ของ standby**
  - standby ที่ลดขนาดไว้ต้องขยายก่อนถึงจะรับ load ได้ และเวลานั้นต้องใส่ไว้ใน timeline ด้วย ทุกอย่างที่ช้าตอน cold start ก็เช่นกัน: cache ที่ว่าง, connection pool และ load balancer ที่ไม่เคยเจอ traffic แบบนี้ ให้ warm ของพวกนี้ไว้ล่วงหน้าเท่าที่ทำได้: request สังเคราะห์หรือ request จริงที่ไหลเข้ามาเรื่อย ๆ ทีละนิด จะทำให้ทั้งเส้นทางของ standby ได้ทำงานอยู่เสมอ
  - failover ไม่ควรต้องพึ่งอะไรที่อาจกำลังพังอยู่เหมือนกัน การ launch instance เป็น operation ของ control plane และ AWS แนะนำให้พึ่ง data plane ระหว่างกู้คืน และใช้ operation ของ control plane ให้น้อยที่สุด ข้อนี้สำคัญที่สุดกับทุกอย่างที่ host อยู่ใน region ที่พัง รวมถึง global control plane ที่บังเอิญอยู่ที่นั่นด้วย AWS เรียก workload ว่า **statically stable** เมื่อมันทำงานต่อได้ตลอดช่วงที่เกิดความล้มเหลวโดยไม่ต้องเปลี่ยนอะไร เช่น launch instance และเพราะแบบนี้ AWS ถึงเรียก pattern นี้เวอร์ชันขนาดเต็มว่า *hot standby*
  - ถ้า standby เล็กกว่า ก็ลดรายการสิ่งที่อาจปฏิเสธคุณให้สั้นลง เพิ่ม service quota ของ standby region ให้เท่าขนาด production ไว้ล่วงหน้า จอง capacity ไว้เท่าที่ provider ให้จอง: EC2 On-Demand Capacity Reservations กัน instance capacity ไว้ใน zone ที่เลือก และ Application Load Balancer ตั้ง reserved minimum capacity ได้ จากนั้นปล่อยให้ [Autoscaling](../autoscaling/) ทำส่วนที่เหลือจาก image ที่อยู่ใน region อยู่แล้ว
  - ถ้า standby รับทุกอย่างพร้อมกันไม่ไหว ให้ตัดสินใจไว้ก่อนว่าจะ shed อะไรทิ้งก่อน
- **dependency ต้อง failover ไปด้วยกัน** ฐานข้อมูลเป็นแค่หนึ่งในหลายอย่างที่แอปพลิเคชันต้องใช้ ไล่รายการทั้งหมดแล้วเช็กว่าแต่ละอย่างยังทำงานได้เมื่อไม่มี active region: identity และ sign-in, secret และ encryption key, certificate, queue และ cache, object storage, container registry และ deployment pipeline, monitoring และ paging และ third party ที่ allow-list address ของคุณไว้ ตัว runbook, script และ credential ที่ใช้รันมันก็ต้องไม่พึ่ง region ที่พังด้วย
- **Failback และ switchover**
  - *failover* เป็นแบบบังคับและอาจเสียข้อมูล ส่วน *switchover* วางแผนไว้และไม่เสียอะไรเลย เพราะ primary หยุดรับการเขียนแล้วรอ replica ก่อนสลับบทบาท แต่ละ vendor ตั้งชื่อคู่นี้ต่างกัน: Aurora Global Database มี *failover* กับ *switchover*, failover group ของ Azure SQL มี *forced failover* กับ *failover* และ Cloud SQL (Enterprise Plus) มี *replica failover* กับ *switchover*
  - region เก่าต้องกลายเป็น replica ของ primary ตัวใหม่ก่อน managed service ทำส่วนนี้ให้เมื่อ region กลับมา: Aurora เพิ่ม region ที่เคยเป็น primary กลับเข้ามาเป็น secondary, primary เก่าของ Azure SQL ต่อกลับเข้ามาเป็น secondary ตัวใหม่ และ advanced disaster recovery ของ Cloud SQL เปลี่ยน primary เก่าให้เป็น replica ถ้าเป็น PostgreSQL เปล่า ๆ ก็ rewind มันด้วย `pg_rewind` หรือ rebuild จาก primary ตัวใหม่
  - จากนั้นเลือกจังหวะ รอจน region healthy มาสักพักและ replica ตามทันแล้ว เลือกช่วงที่เงียบ ๆ แล้วรัน switchover จาก runbook เดียวกันให้เหมือนเป็นการซ้อม การอยู่ใน region ใหม่ต่อไปก็เป็นผลลัพธ์ที่ใช้ได้ ถ้าสอง region เทียบเท่ากัน
- **การซ้อม**
  - failover ที่ไม่เคยซ้อมใช้ไม่ได้ AWS ถือว่าการไม่เคยทดลอง failover บน production เป็น anti-pattern และเหตุผลคือ drift: capacity, configuration และสมมติฐานที่ถูกตอน test ครั้งล่าสุด ตอนนี้ไม่ถูกแล้ว
  - switchover คือการซ้อมแบบราคาถูก มันไม่เสียข้อมูล เลยรันบน production ตามตารางได้: Azure SQL ระบุว่าการซ้อมบน production เป็นหนึ่งในการใช้ planned failover ของ failover group, Cloud SQL แนะนำให้ใช้ switchover ของมันกับการซ้อมประจำ และ Aurora ระบุว่าการสลับ region เป็นประจำที่ regulator บางแห่งกำหนดเป็นหนึ่งในการใช้ switchover ส่วน documentation ของ PostgreSQL ก็พูดเรื่องเดียวกันสำหรับ server คู่เดียว: การสลับเป็นประจำก็คือการ test กลไกไปในตัว
  - switchover ไม่ได้ทดสอบการตรวจจับ การ fence หรือการ promote ตอนที่ primary หายไปแล้ว ให้ซ้อมพวกนั้นด้วย โดยตัด region ทิ้งโดยตั้งใจใน game day ตรงนี้แหละที่ chaos engineering เข้ามา วัดเวลากู้คืนและการเขียนที่หายไปที่คุณได้จริง แล้วเทียบกับ objective
