## ปัญหา

platform ที่รัน service หลาย instance ต้องคอยตัดสินสามเรื่องเกี่ยวกับแต่ละตัวอยู่ตลอด: มัน start เสร็จหรือยัง มันยังทำงานอยู่ไหม และตอนนี้ควรส่ง traffic ไปให้มันหรือเปล่า ถ้าปล่อยให้ platform ทำเอง มันก็ได้แค่เดาจากข้างนอก: process ยังอยู่ และ port ยังรับ connection การเดาแบบนี้ผิดบ่อย process อาจรันอยู่แต่ใช้การไม่ได้: ยัง warm cache ไม่เสร็จ connection ไปยัง database หมด ติด deadlock หรือกำลังจะ shut down อยู่แล้ว

เดาผิดแต่ละแบบก็เสียต่างกัน traffic ที่ส่งไปให้ instance ที่ยังไม่พร้อมกลายเป็น error ที่ user เห็น การ restart instance ที่แค่ยุ่งอยู่ทำให้ state ที่ warm แล้วหายไป และโยนโหลดของมันไปให้ตัวอื่น และถ้าทุก instance รายงานว่าตัวเองสบายดี ก็อาจไม่มีใครสังเกตเลยว่า user เข้า service ไม่ได้เลย เพราะสิ่งที่พังคือ DNS record, certificate หรือ load balancer ที่อยู่ข้างหน้า

## ทำงานยังไง

service รายงาน state ของตัวเองผ่าน endpoint เล็ก ๆ ที่ต้นทุนต่ำ หนึ่งตัวต่อหนึ่งคำถาม และคำตอบแต่ละตัวก็มีผู้ใช้คนละรายที่เอาไปตัดสินใจ

| Check | คำถาม | ใครถาม | ถ้า fail แปลว่า | ควรดูอะไร |
|---|---|---|---|---|
| **Startup** | boot เสร็จหรือยัง | orchestrator | รอต่อไป ถ้าหมดเวลาที่ให้ไว้ก็ restart | การ initialise: โหลด configuration แล้ว warm cache แล้ว apply migration แล้ว |
| **Liveness** | process ยังทำงานคืบหน้าได้อยู่ไหม | orchestrator ที่ restart มันได้ | restart instance | ตัว process เองเท่านั้น ไม่ดูอย่างอื่นเลย |
| **Readiness** | instance นี้รับ request ได้เลยตอนนี้ไหม | load balancer ที่เป็นคน route | ไม่ส่ง traffic ใหม่มา และไม่ restart | resource ของ instance เอง |
| **Outside-in** | user ใช้ service ได้ไหม | external monitor | แจ้งคน และ fail over ไปอีก region | public endpoint แบบ end to end |

ที่ต้องแยกก็เพราะวิธีแก้ต่างกัน การเอา instance ออกจาก rotation ต้นทุนต่ำและย้อนกลับได้ readiness เลยตอบสนองเร็วได้ ส่วนการ restart เป็นเรื่องใหญ่และไม่ได้ซ่อมอะไรนอก process เลย liveness เลยควรตัดสินใจช้า ๆ และไม่ดูอะไรเลยนอกจากตัว process ส่วน endpoint ใน diagram คือ `/startupz`, `/livez` และ `/readyz` สองตัวหลังเป็นธรรมเนียมที่ใช้กันทั่วไป ส่วนชื่อแรก diagram นี้ตั้งเอง

*ใครถาม* ขึ้นกับ platform ใน Kubernetes ตัว kubelet รัน probe ทั้งสามตัวบน node มันจะยังไม่รัน liveness probe กับ readiness probe จนกว่า startup probe จะผ่าน และ readiness probe ที่ fail จะเอา Pod ออกจาก endpoint ของ Service ที่ select มันอยู่ ส่วน load balancer ที่ probe ตามรอบของตัวเองไม่รู้เรื่อง startup check เลย: มันแค่ได้คำตอบ *not ready* ไปเรื่อย ๆ จนกว่า instance จะ start เสร็จ

### Check แบบ shallow กับ deep และกับดักเรื่อง dependency

check แบบ **shallow** ตอบจากสิ่งที่ process รู้อยู่แล้ว: มันรันอยู่ worker ยังหมุนงานอยู่ และ pool ยังถือ connection อยู่ ส่วน check แบบ **deep** ออกไปลองใช้ dependency จริง เช่นรัน query หรือเรียก API ที่อยู่ปลายทาง

check แบบ deep เจอปัญหาได้มากกว่า แต่ก็ fail ในแบบที่อันตราย ถ้า dependency นั้น**ใช้ร่วมกัน** check ของทุก instance ก็จะ fail ในวินาทีเดียวกัน:

- ถ้าอยู่ใน **liveness** check ตัว orchestrator ก็ restart ทุก instance พร้อมกัน ไม่มีการ restart ไหนซ่อม database ได้ แล้ว service ก็กลับมาแบบ cold เข้าสู่ outage เดิม
- ถ้าอยู่ใน **readiness** check ตัว load balancer ก็เสีย target ไปหมดและไม่มีที่ให้ส่ง traffic ไป request ที่ไม่เคยต้องใช้ database เลย (การอ่านจาก cache, static content, endpoint อื่น ๆ) ก็ fail ไปด้วย ปัญหาแค่บางส่วนเลยกลายเป็นล่มทั้งหมด

ฉะนั้นให้ตัดสินทีละ check:

- **Readiness ดู resource ของ instance เองได้:** connection pool ต่อเรียบร้อยแล้ว cache warm แล้ว configuration กับ secret ที่ต้องใช้โหลดแล้ว request queue หรือ thread pool ยังไม่เต็ม และยังไม่ได้เริ่ม shut down ถ้ามีข้อไหนผิดปกติ instance ตัวอื่นก็ทำได้ดีกว่าจริง ๆ และนั่นก็คือสิ่งที่การเอาตัวนี้ออกจาก rotation สมมติไว้พอดี
- **อย่าใส่ dependency ที่ทุก instance ใช้ร่วมกัน** เช่น database หลักหรือ message broker การเอา instance ออกจะช่วยก็ต่อเมื่อตัวที่เหลืออยู่ในสภาพดีกว่า ให้ fail เฉพาะ request ที่ต้องใช้ dependency นั้น ส่วนอะไรที่ยังทำงานได้ก็ให้บริการต่อไป แล้วปล่อยให้ alarm ของ dependency นั้นรายงานเอง
- **อย่าใส่ downstream service** ที่มี health check และ alarm ของตัวเองอยู่แล้ว ให้คุมการเรียกพวกนั้นด้วย timeout และ [Circuit Breaker](../circuit-breaker/) แล้วลดความสามารถของ feature นั้นลง ไม่ใช่ของทั้ง instance
- **Liveness ไม่ใส่อะไรพวกนี้เลย**

เรื่องนี้ต้องใช้วิจารณญาณ และแหล่งข้อมูลดี ๆ ก็ขีดเส้นไว้ต่างกันเล็กน้อย เอกสาร Kubernetes ยอมให้ readiness probe ตรวจ back-end service ที่แอปพลิเคชันต้องพึ่งจริง ๆ ได้ traffic จะได้ไม่ไปที่ Pod ที่ตอบได้แต่ error ส่วนเอกสาร Spring Boot บอกว่าต้องเลือกอย่างระวัง และยก dependency ที่ทุก instance ใช้ร่วมกันเป็นกรณีที่ยาก ถ้าจะใส่ dependency ที่ใช้ร่วมกันจริง ๆ ก็ต้องมีอะไรสักอย่างคอยจำกัดความเสียหาย: balancer ที่ **fail open** ตอนที่ทุก target ไม่ healthy หรือเพดานว่าเอา target ออกได้มากสุดกี่ส่วน

step 2 กับ step 4 ของ diagram คือสองฝั่งของเส้นนี้ ใน step 2 ตัว instance A เสีย connection *ของตัวเอง* ไป ขณะที่ database กับ instance อื่นยังปกติดี การเอา A ออกจาก rotation เลยช่วยได้ ส่วนใน step 4 ตัว database ช้าสำหรับทุกคน การเอา instance ออกเลยไม่ช่วยใครเลย แต่เส้นนี้ก็ไม่ได้ชัดแบบนี้เสมอ: ถ้า database ที่ใช้ร่วมกันล่มไปเลย pool ของทุก instance ก็ว่าง แล้วแม้แต่ check แบบ shallow ที่ดู pool ก็ fail ทุกตัว กรณีนี้แหละที่ต้องมี fail open

### คำตอบ

- **ดู status code ก่อน:** `200` แปลว่า healthy และ `503 Service Unavailable` แปลว่าไม่ healthy เครื่องควรอ่านแค่นี้ Kubernetes นับ status ตั้งแต่ 200 ถึง 399 ว่าผ่าน
- **body เล็ก ๆ ไว้ให้คนอ่าน:** status รวม และอย่างมากก็ชื่อกับ state ของแต่ละ check ติดป้ายให้ response นี้ห้าม cache ด้วย จะได้ไม่มี proxy ไหนตอบแทน instance ส่วน body ก็ไม่มี format มาตรฐาน มี Internet-Draft ฉบับหนึ่งที่เสนอไว้ แต่ก็หมดอายุไปในปี 2022 โดยไม่ได้เป็น RFC
- **ห้ามมี secret** connection string, ชื่อ host ภายใน, เลข version และ stack trace ช่วยผู้โจมตีได้มากกว่าช่วยคนดูแลระบบ ให้รายละเอียดเฉพาะกับผู้เรียกที่ authenticate แล้วหรือบน port ภายใน และทำ endpoint ที่ balancer probe ให้เล็กที่สุด path ที่เดายากไม่ใช่ access control
- service ที่เป็น **gRPC** ใช้ health service มาตรฐานแทน path: `grpc.health.v1.Health` การเรียก `Check` ของมันคืน `SERVING` หรือ `NOT_SERVING` ของ service ที่ระบุชื่อ (ชื่อว่างหมายถึงทั้ง server) ส่วนการเรียก `Watch` ก็ stream การเปลี่ยนแปลงมาให้

### Interval, timeout และ threshold

- การตรวจเจอใช้เวลาประมาณ *interval × failure threshold* บวก timeout ของ probe ตัวสุดท้าย ถ้าใช้ค่า default ของ Kubernetes (probe ทุก 10 วินาที, timeout 1 วินาที, fail 3 ครั้งติดกัน) ก็ราว ๆ ครึ่งนาที
- probe ที่ fail ครั้งเดียวแทบไม่ควรตัดสินอะไรเลย การให้ fail หลายครั้งติดกัน และให้ผ่านหลายครั้งก่อน instance จะกลับมา ช่วยกันไม่ให้ instance ที่กำลังลำบาก**กระพริบ** เข้า ๆ ออก ๆ rotation
- ให้ liveness ใจเย็นกว่า readiness instance จะได้อยู่นอก rotation สักพักก่อนจะมีอะไรมา kill มัน เอกสาร Kubernetes อธิบายการใช้ endpoint ราคาถูกตัวเดียวสำหรับทั้งสองอย่าง โดยตั้ง failure threshold ของ liveness probe ให้สูงกว่า
- boot ช้าไม่ได้แปลว่าค้าง startup check ที่มี budget เผื่อไว้เยอะของตัวเอง (failure threshold × period) ครอบคลุมช่วง initialise ทำให้ liveness check ตั้งไว้แน่น ๆ ได้หลังจากนั้น
- ตัวเลขใน diagram แค่ยกตัวอย่าง: คำตอบเดียวก็ย้าย instance เข้าหรือออกจาก rotation และ probe ที่พลาดสามครั้งก็ restart มัน

### ทำ check ให้ต้นทุนต่ำ

- ตอบจาก state ที่ process ถืออยู่แล้วและคอยอัปเดตให้สดอยู่เบื้องหลัง ไม่ใช่ทำงานจริงทุกครั้งที่มี probe เข้ามา probe มาจากทุก node ของ balancer จาก orchestrator และจากทุก monitor อยู่ตลอดเวลา check ที่รัน query หนึ่งครั้งต่อ probe จะยิง query ไม่หยุดใส่ database ที่อาจกำลังลำบากอยู่แล้ว
- ถ้า check ต้องเรียกอะไรสักอย่าง ให้ตั้ง timeout สั้น ๆ ให้การเรียกนั้น และลอง cache ผลไว้สักไม่กี่วินาที cache แลกโหลดกับความ stale เลยต้องตั้งขนาดตามว่าต้องการตรวจเจอความล้มเหลวเร็วแค่ไหน
- ตอนโหลดเกิน health endpoint ก็ยังต้องตอบได้ ถ้า instance ที่ยุ่งอยู่ตอบ probe ไม่ทัน timeout ตัว balancer ก็จะเตะมันออก โหลดของมันก็ไปตกที่ตัวที่เหลือ แล้วตัวพวกนั้นก็ล้มตาม: การ health check เองกลายเป็นตัวกระจายความล้มเหลว ให้กัน capacity ไว้ให้ health endpoint และตัด request จริงทิ้งก่อนที่ probe จะเริ่ม timeout
- ถ้าทำได้ ให้ serve check บน port เดียวกันและผ่าน server stack เดียวกับ traffic จริง check บน management port แยกอาจผ่านได้ทั้งที่ listener หลักปฏิเสธ connection อยู่

### ตอน shut down

instance ที่กำลังจะหยุดควร **fail readiness ก่อน** แล้วให้บริการ request ที่มีอยู่และที่ยังเข้ามาอีกไม่กี่ตัวต่อไป รอจนกว่า balancer จะรู้ตัว แล้วค่อย exit ระหว่างนั้น liveness ผ่านตลอด เพราะ process กำลังทำสิ่งที่ควรทำพอดี หนังสือ SRE ของ Google เรียก state นี้ว่า *lame duck* เวลาที่รอต้องครอบคลุมเวลาที่ balancer ใช้ตรวจเจอหรือ deregistration delay ของมัน: ดู [Load Balancing](../load-balancing/) เรื่องการ drain และ [Rolling Update](../rolling-update/) ว่า rollout พึ่งเรื่องนี้ยังไง บน Kubernetes การลบ Pod จะ mark endpoint ของมันว่า not ready ให้อยู่แล้ว readiness endpoint เลยไม่ต้องพลิกเองในกรณีนี้ แต่ process ก็ยังต้องให้บริการต่ออีกสักพักหลังได้ `SIGTERM`

### มองจากข้างนอกเข้ามา

ทุก instance อาจ healthy หมดทั้งที่ user เจอ error: certificate หมดอายุ DNS record ผิด balancer ตั้งค่าผิด หรือเส้นทาง network ที่ probe ภายในไม่เคยวิ่งผ่าน **external monitor** เรียก public endpoint แบบเดียวกับที่ user เรียก จาก**หลายที่** เส้นทาง network ที่เสียเส้นเดียวจะได้ไม่ถูกเข้าใจผิดว่าเป็น outage มันตรวจทั้งเนื้อหาและ response time ไม่ใช่แค่ status code ผลของมันเอาไปใช้ส่ง alert ใช้ทำ failover ข้าม region ในระบบแบบ [Multi-Region Active-Active](../multi-region-active-active/) และเป็นตัวเลข availability เบื้องหลัง [SLOs & Error Budgets](../slo-error-budgets/) แต่ probe ก็เป็นแค่ตัวอย่างส่วนหนึ่ง ถ้ามี traffic มากพอ ให้วัด SLI จาก request จริงที่ load balancer แล้วใช้ synthetic probe สำหรับช่วงที่เงียบและสำหรับเส้นทางที่ user ไม่ค่อยใช้

### ใน autoscaling group

autoscaling group จะ**แทนที่** instance ที่มันถือว่าไม่ healthy ถ้ามันใช้ health check ของ load balancer เป็นสัญญาณนั้น readiness check ที่ fail ก็จะเลิกแปลว่า *ยังไม่ต้องส่ง traffic มา* แล้วกลายเป็น *terminate*: เป็น readiness ที่มีผลแรงเท่า liveness แล้ว check แบบ deep ที่ fail ทุกตัวก็จะทำให้ group แทนที่ทั้ง fleet ให้ใช้สัญญาณแยกที่ระวังกว่าสำหรับการแทนที่ ไม่ใช่ตัวเดียวกับที่ใช้ route และให้ instance ใหม่มีช่วงผ่อนผันไว้ start ส่วนที่เหลือของ loop นี้อยู่ใน [Autoscaling](../autoscaling/)

### ตอนที่ health check โกหก

health check คือ model ของ service และ model ก็ผิดได้ทั้งสองทาง

- **มันผ่านทั้งที่ user ใช้ไม่ได้** check วิ่งคนละเส้นทางกับ request จริง: port อื่น ไม่มี authentication ไม่มี database หรือ release ที่พังอาจคืน error ทุก endpoint จริง แต่คืน `200` ที่ `/readyz` ส่วน instance ที่ fail เร็วก็ถึงขั้นดูเหมือนเป็นตัวที่โหลดน้อยที่สุดได้ แล้วดึง traffic เข้ามามากขึ้นอีก
- **มัน fail ทั้งที่ user ใช้ได้ปกติ** check ตรวจสิ่งที่ request ส่วนใหญ่ไม่ได้ต้องใช้ หรือมัน timeout เพราะ instance ยุ่งอยู่กับงานที่มีประโยชน์

จับได้ทั้งสองแบบด้วยสัญญาณจาก **traffic จริง**: error rate และ latency ของแต่ละ instance เทียบกับตัวอื่น, passive health check (outlier detection) ใน load balancer หรือ [Service Mesh](../service-mesh/), alert ตาม burn rate ของ SLO และ external monitor ถ้าสัญญาณพวกนี้เอา instance ที่ผ่าน check อยู่ออกไป ให้ถือว่าช่องว่างนั้นเป็น bug ของ check

## ใช้ตอนไหนดี

- ทุก service ที่รันอยู่หลัง load balancer หรือใต้ orchestrator: อย่างน้อยต้องมี liveness endpoint กับ readiness endpoint แยกกัน แม้ตอนเริ่มจะเหมือนกันก็ตาม
- เพิ่ม startup check ถ้า boot นานเกินกว่าที่ liveness check จะทนได้: cache ใหญ่ JIT warm-up หรือ migration
- เพิ่ม monitoring แบบ outside-in ให้อะไรก็ตามที่ user หรือทีมอื่นพึ่งอยู่ และอะไรก็ตามที่มี SLO
- queue consumer กับ batch worker ไม่มี load balancer ให้แจ้ง ตัว readiness เลยไม่ค่อยสำคัญสำหรับพวกมัน แต่ liveness ยังสำคัญอยู่: เปิดเป็น HTTP endpoint เล็ก ๆ หรือให้ orchestrator รันคำสั่งที่ตรวจ heartbeat
- health endpoint เป็นสัญญาณใช่หรือไม่ใช่ให้ automation ใช้ มันไม่ได้มาแทน metric, log และ trace ที่บอกว่า*ทำไม*

## ได้อะไร เสียอะไร

- **Shallow หรือ deep** check แบบ shallow พลาดความล้มเหลวใน dependency ส่วนแบบ deep ทำให้ความล้มเหลวของ dependency กลายเป็นของเราเอง ไม่ว่าจะเลือกลึกแค่ไหน ต้องรู้ว่าจะเกิดอะไรขึ้นถ้าทุก instance fail check พร้อมกัน
- **เร็วหรือนิ่ง** interval สั้นและ threshold ต่ำเจอปัญหาเร็วกว่าแต่ก็กระพริบบ่อยกว่า และ probe ทุกตัวก็มีต้นทุนกับทุก instance
- **Fail open หรือ fail closed** balancer ที่ fail open ยังให้บริการต่อได้ผ่าน check ที่พัง แต่ก็อาจส่ง traffic ไปให้ instance ที่พังจริง ๆ ส่วนตัวที่ fail closed ปกป้อง user จาก instance ที่พัง แต่ก็ทำให้ check ที่พังกลายเป็น outage
- **Restart ซ่อนปัญหา** liveness check ที่ restart process ที่ memory รั่วหรือติด deadlock ทำให้ service ยังอยู่ แต่ bug ก็ยังอยู่ด้วย ให้นับจำนวน restart และตั้ง alert ไว้
- **ช่องโหว่เพิ่มอีกจุด** health endpoint ที่ละเอียดก็รั่วข้อมูล และตัวที่ทำงานจริงทุก request ก็เป็นเป้าราคาถูกของการโจมตีแบบ denial-of-service

## ข้อควรรู้ตอนลงมือทำ

product เปลี่ยนค่า default ได้ ให้ถือว่าพวกนี้เป็นตัวอย่างที่ตรวจไว้เมื่อเดือนตุลาคม 2026 และอ่านเอกสารฉบับปัจจุบันด้วย

- **Kubernetes probe:** `startupProbe`, `livenessProbe` และ `readinessProbe` ที่ kubelet รันเป็น HTTP GET, TCP connect, คำสั่ง หรือ gRPC health call ค่า default คือ `periodSeconds: 10`, `timeoutSeconds: 1`, `failureThreshold: 3`, `successThreshold: 1` และ `initialDelaySeconds: 0` ส่วน liveness probe กับ readiness probe จะไม่รันจนกว่า startup probe จะสำเร็จ ถ้า liveness probe หรือ startup probe fail ตัว container ก็โดน kill แล้ว restart ตาม restart policy ของ Pod ส่วน readiness probe ที่ fail จะเอา address ของ Pod ออกจาก EndpointSlice ของ Service ที่ select มันอยู่ Pod ที่โดนลบได้ grace period 30 วินาทีเป็นค่า default
- **Kubernetes API server** ก็ใช้ pattern นี้เองด้วย `/livez` และ `/readyz` (ตัว `/healthz` แบบเก่า deprecated ไปตั้งแต่ v1.16) ตั้งใจให้เครื่องอ่านแค่ status code ส่วน `?verbose` แสดง check แต่ละตัวให้คนอ่าน และ `exclude=` ใช้ตัด check ออกหนึ่งตัว ถ้าตั้ง `--shutdown-delay-duration` ไว้ `/readyz` จะ fail ทันทีที่เริ่ม shut down ขณะที่ `/livez` ยังผ่านต่อไป ก็คือลำดับ lame duck ที่อธิบายไว้ข้างบน
- **gRPC:** health checking protocol มากับ library ของ gRPC อยู่แล้ว gRPC probe ของ kubelet ก็พูด protocol นี้ และตั้งค่าให้ gRPC client คอย watch มันแล้วเลิกส่ง call ไปให้ backend ที่รายงานว่า `NOT_SERVING` ได้
- **Spring Boot Actuator:** health group `/actuator/health/liveness` และ `/actuator/health/readiness` รายงาน availability state ของแอปพลิเคชัน และ `management.endpoint.health.probes.add-additional-paths=true` ก็ serve มันเป็น `/livez` และ `/readyz` บน port หลักด้วย ส่วน `DOWN` กับ `OUT_OF_SERVICE` map ไปเป็น 503 และรายละเอียดถูกซ่อนไว้เป็นค่า default (`show-details` เป็น `never`)
- **ASP.NET Core:** `MapHealthChecks` เปิด endpoint ให้ ค่า default คือ `Healthy` กับ `Degraded` คืน 200 ส่วน `Unhealthy` คืน 503 ตัว body เป็น status แบบ plain text และปิด caching ไว้ ใส่ tag ให้ check แล้ว filter ตาม tag ก็จะได้ liveness endpoint กับ readiness endpoint แยกกัน ส่วน `RequireHost` และ `RequireAuthorization` ใช้จำกัดว่าใครเรียกได้
- **ตอนที่ทุก target ไม่ healthy:** AWS Application Load Balancer และ Network Load Balancer จะ fail open แล้ว route ไปทุก target ตัว Envoy จะไม่สน health เลยเมื่อสัดส่วนที่ healthy ของ cluster ต่ำกว่า *panic threshold* (50% เป็นค่า default) หรือจะตั้งให้ fail traffic แทนก็ได้ HAProxy ตอบ 503 ตอนที่ไม่มี server ว่างเลย ส่วน Azure Load Balancer ไม่ส่ง flow ใหม่ไปให้ pool ที่ probe แล้วล่มทุก instance
- **การแทนที่ใน group:** Amazon EC2 Auto Scaling แทนที่ instance ที่ไม่ผ่าน EC2 status check ที่มีมาในตัว และพอพ้น grace period แล้วก็แทนที่ตัวที่ไม่ผ่าน check เสริมที่เปิดไว้ด้วย เช่นของ load balancer ส่วน Google Cloud แนะนำให้ใช้ health check แยกที่ระวังกว่าสำหรับ autohealing ของ managed instance group ไม่ใช้ตัวเดียวกับ load balancing
- **บริการแบบ outside-in:** uptime check ของ Google Cloud Monitoring (checker อย่างน้อยสามตัว) และ availability test ของ Azure Application Insights (แนะนำห้าที่ขึ้นไป) ต่าง probe จากหลายที่ ให้ alert ตอนที่หลายที่เห็นตรงกัน ไม่ใช่ตอน probe fail แค่ครั้งเดียว
- **คอยดูระบบ health เองด้วย:** จำนวน instance ที่ ready เทียบกับจำนวนที่ควรมี จำนวน restart ต่อ instance, instance เปลี่ยน state บ่อยแค่ไหน และเวลาตั้งแต่เกิดความล้มเหลวจนถูกเอาออก alert แบบ *ready น้อยกว่า N ตัว* จับ step 4 ได้ก่อนที่ instance ตัวสุดท้ายจะหลุดไป
