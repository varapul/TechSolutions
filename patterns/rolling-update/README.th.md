## ปัญหา

เวอร์ชันใหม่ต้องเข้าไปแทนเวอร์ชันเก่าในทุก instance ของ service ที่รันอยู่ การหยุดทุกอย่าง upgrade แล้วเริ่มใหม่นั้นง่าย แต่ user จะเจอ downtime การสร้าง fleet ชุดที่สองเต็ม ๆ ไว้ข้าง ๆ ชุดแรกเลี่ยงปัญหานี้ได้ แต่ก็ต้องใช้ capacity สองเท่าตลอดช่วง release แต่ service ส่วนใหญ่ต้องการอะไรที่อยู่ตรงกลาง: มี instance มากพอที่ยังตอบอยู่ระหว่างที่ตัวอื่นกำลังถูกแทนที่ และ build ที่ start ไม่ขึ้นก็ต้องไม่มีวันได้เข้าไปแทนตัวที่ยังปกติดี

## ทำงานยังไง

controller (Deployment controller ของ Kubernetes, service scheduler ของ Amazon ECS, ตัวจัดการ instance group หรือ scale set) แทนที่ fleet แบบ in-place ทีละ batch ในแต่ละ batch มันจะ:

1. เริ่ม instance เวอร์ชันใหม่ ได้มากเท่าที่ surge limit ยอม
2. รอจน **readiness check** ของพวกมันผ่าน แล้วค่อยให้ load balancer ส่ง traffic ไปให้
3. **drain** instance เก่าจำนวนเท่ากัน (ไม่รับ request ใหม่ ปล่อยตัวที่ทำอยู่ให้จบ) แล้วถอดออก
4. ทำซ้ำจนทุก instance รันเวอร์ชันใหม่

มีปุ่มหมุนสองตัวที่คุมจังหวะ:

- **Max surge**: มี instance *เกิน* จำนวนที่ต้องการได้กี่ตัว surge มากขึ้นแปลว่า batch ใหญ่ขึ้นและ rollout เร็วขึ้น แลกกับ capacity ส่วนเกิน (และ quota) ระหว่างที่รันอยู่
- **Max unavailable**: ขาด*ต่ำกว่า*จำนวนที่ต้องการได้กี่ตัว ค่านี้ก็ทำให้เร็วขึ้นโดยไม่ต้องจ่ายเพิ่ม แต่ instance ที่เหลือต้องแบกโหลดไว้ เลยใช้ได้แค่ตอนที่มี headroom

สำหรับ fleet สี่ตัว ค่าต่าง ๆ จะออกมาแบบนี้:

| Max surge | Max unavailable | Instance ระหว่าง rollout | พร้อมน้อยสุด | แลกอะไร |
|:-:|:-:|:-:|:-:|---|
| 1 | 0 | 4 ถึง 5 | 4 | แบบใน diagram: มี instance สำรองหนึ่งตัว, capacity ไม่หาย, สลับทีละตัว |
| 0 | 1 | 3 ถึง 4 | 3 | ไม่ต้องเพิ่ม capacity แต่ให้บริการได้น้อยลงหนึ่งในสี่ระหว่างที่รัน |
| 25% | 25% | 3 ถึง 5 | 3 | ค่า default ของ Kubernetes ถ้ามีสี่ instance ก็คือ 1 กับ 1 แบบนี้ตัวใหม่จะเริ่มขึ้นขณะที่ตัวเก่ากำลังออกไปแล้ว |
| 100% | 0 | 4 ถึง 8 | 4 | ค่า default ของ Amazon ECS (minimum healthy 100%, maximum 200%): เริ่มชุดใหม่ทั้งชุดก่อนชุดเก่าจะหยุด เร็วที่สุด แต่ใช้ capacity สองเท่า |

ปุ่มทั้งสองตัวเป็นศูนย์พร้อมกันไม่ได้ ไม่งั้นก็จะขยับอะไรไม่ได้เลย

ด่านเดียวที่คั่นระหว่าง batch คือ readiness ถ้าใช้ค่าแบบใน diagram ตัว instance ใหม่ที่ไม่เคยพร้อมเลยจะยึด surge slot ไว้ instance เก่าตัวไหนก็ออกไม่ได้ถ้ายังไม่มีตัวแทนที่พร้อม แล้ว rollout ก็หยุดโดยที่ capacity เต็มยังให้บริการอยู่ ถ้า unavailability มากกว่าศูนย์ instance ที่ถูกถอดออกไปแล้วก็ยังอยู่ข้างนอก ตัว service เลยขาด capacity อยู่จนกว่าจะมีคนลงมือ จากนั้นจะเกิดอะไรขึ้นก็ขึ้นกับ platform: บางตัวแค่รายงานว่าค้างแล้วรอ บางตัวตั้งให้ rollback เองได้

## ใช้ตอนไหนดี

- ใช้เป็นค่า default ของ stateless service ที่อยู่หลัง load balancer ตอนที่เวอร์ชันเก่ากับใหม่รันข้างกันได้
- ตอนที่ไม่อยากมี downtime แต่จ่ายค่า fleet ชุดที่สองเต็ม ๆ ไม่ได้หรือไม่อยากจ่าย
- การเปลี่ยนแปลงตามปกติแบบไหนก็ตามที่ต้องแทนที่ instance: build ใหม่, configuration ใหม่, base image ใหม่ หรือ instance type ใหม่
- **ไม่ใช่**ตอนที่สองเวอร์ชันให้บริการข้างกันไม่ได้ เช่น breaking change ของ API, message format หรือ schema ที่ทำในขั้นเดียว user ทุกคนจะเจอทั้งสองเวอร์ชันปนกันตลอด rollout ให้แบ่งการเปลี่ยนเป็นขั้นที่เข้ากันได้ (expand and contract) หรือย้าย traffic ทั้งหมดทีเดียวด้วย [blue-green deployment](../blue-green-deployment/) โดยที่ database ที่ใช้ร่วมกันก็ยังต้องใช้ได้กับทั้งสองเวอร์ชันอยู่ดี
- **ไม่ใช่**ตอนที่ต้องการทางกลับทันที การย้อน rolling update ก็คือ rolling update อีกรอบ ให้เก็บ fleet เก่าไว้ให้อุ่นอยู่ (blue-green) หรือ ship โค้ดที่เสี่ยงโดยปิดไว้หลัง [feature flag](../feature-flags/)
- **ไม่ใช่**วิธีลองเวอร์ชันกับ user ไม่กี่คนก่อน อันนั้นคือ [canary release](../canary-release/)

## ได้อะไร เสียอะไร

- **Version skew เป็นส่วนหนึ่งของข้อตกลง** ตลอดช่วง rollout และช่วง rollback ใด ๆ เวอร์ชันเก่ากับใหม่ให้บริการ user ชุดเดียวกัน อ่าน database ตัวเดียวกัน และกิน message ของกันและกัน user อาจได้คำตอบจาก v2 ใน request หนึ่ง แล้วได้จาก v1 ใน request ถัดไป API, schema, cache entry และ message format เลยต้องเข้ากันได้ข้ามเวอร์ชันหนึ่งขั้นทั้งสองทิศทาง
- **ปลอดภัยได้แค่เท่าที่ readiness check ดี** controller จะ promote อะไรก็ตามที่รายงานว่าพร้อม check ที่พิสูจน์แค่ว่า process รันอยู่จะปล่อยผ่าน build ที่ fail ทุก request จริง แล้ว rollout ก็จะเอามันไปแทนทั้ง fleet ฉะนั้นให้ check หมายถึง "ให้บริการ traffic จริงได้" และแยกมันออกจาก **liveness**: instance ที่ fail readiness จะถูกเอาออกจาก rotation แล้วปล่อยให้รันต่อ ส่วนตัวที่ fail liveness จะถูก restart ส่วน readiness check ที่ทดสอบ dependency ที่ใช้ร่วมกันด้วยจะกัน traffic ไม่ให้ไปหา instance ที่ตอบได้แค่ error แต่พอ dependency นั้นสะดุดนิดเดียว ทุก instance ก็จะกลายเป็นไม่พร้อมพร้อมกันหมด
- **คุมไม่ได้ว่าใครโดน และไม่มีการเทียบ** สัดส่วน traffic ที่ไปเวอร์ชันใหม่ก็คือสัดส่วน instance ที่ถูกแทนที่ไปแล้ว และมันก็เพิ่มขึ้นไปเอง ไม่มีอะไรเทียบ error rate หรือ latency ของเวอร์ชันใหม่กับของเวอร์ชันเก่า ถ้าต้องการให้ user ส่วนเล็ก ๆ ที่ตายตัวได้ก่อนพร้อม metric คุมด่าน ให้ใช้ [canary release](../canary-release/) ถ้าต้องการเวอร์ชันที่ทดสอบบน stack จริงก่อน user คนไหนจะเห็น ให้ใช้ [blue-green deployment](../blue-green-deployment/)
- **Rollback ไม่ได้เกิดทันที** มันวิ่งผ่าน batch, drain และการรอ readiness แบบเดียวกันในทิศกลับ และเวอร์ชันที่เสียก็ยังตอบ traffic บางส่วนอยู่จนกว่าจะเสร็จ ส่วนการ rollback โค้ดก็ไม่ได้ rollback ข้อมูลที่เวอร์ชันใหม่เขียนไปแล้ว
- **ความเร็วแลกกับ capacity สำรอง** batch เล็กปลอดภัยแต่ช้า: fleet ใหญ่ที่ start และ drain นานอาจใช้เวลาหลายชั่วโมง surge ที่มากขึ้นต้องมี capacity และ quota ส่วน unavailability ที่มากขึ้นต้องมี headroom และ service ที่ยุ่งอาจไม่มีตอน peak
- **Drain ให้ดี ไม่งั้น request หลุด** การถอด instance ที่ยังถือ request ค้างอยู่ทำให้ rollout แบบ zero-downtime กลายเป็น error พุ่งเป็นช่วง ๆ instance ต้องออกจาก rotation ก่อน ทำงานให้จบ แล้วค่อย exit ส่วน connection ที่อยู่นานต้องมี deadline [Load Balancing](../load-balancing/) อธิบายเรื่อง connection draining ไว้
- **Workload แบบ stateful ต้องระวังมากขึ้น** replica ที่มี identity และข้อมูลของตัวเองถูกแทนที่ตามลำดับตายตัว ทีละตัว รอให้แต่ละตัวกลับเข้ามาก่อนตัวถัดไปจะออก และปกติ primary จะเป็นตัวสุดท้าย

## ข้อควรรู้ตอนลงมือทำ

ชื่อเรียกต่างกันไปตาม platform แต่ปุ่มหมุนสองตัว ด่าน readiness และการ drain เหมือนกันทุกที่

- **Kubernetes Deployment** `RollingUpdate` เป็น strategy ที่เป็นค่า default ส่วน `maxSurge` กับ `maxUnavailable` มีค่า default 25% ทั้งคู่ (surge ปัดขึ้น unavailable ปัดลง และเป็นศูนย์พร้อมกันไม่ได้) `minReadySeconds` (default 0) บังคับให้ Pod ใหม่พร้อมอยู่นานเท่านั้นก่อนจะนับว่า available ส่วน `progressDeadlineSeconds` (default 600) แค่ตั้ง condition `Progressing` เป็น false พร้อม reason `ProgressDeadlineExceeded`: Kubernetes ยังพยายามต่อไปและไม่ rollback ให้ เลยต้อง alert ไว้หรือให้ pipeline เป็นคนลงมือ ReplicaSet เก่าคือ revision history (`revisionHistoryLimit`, default 10): `kubectl rollout undo` กลับไปตัวก่อนหน้า, `--to-revision` กลับไปตัวที่เลือก ส่วน `kubectl rollout status`, `pause` และ `resume` ใช้เฝ้าดูและพัก rollout การเปลี่ยน Pod template อีกครั้งระหว่างที่ rollout กำลังรันจะเริ่ม revision ใหม่ทันที และ scale ตัวที่ roll ไปครึ่งทางลงไปพร้อมกับตัวเก่า
- **Graceful shutdown บน Kubernetes** พอ Pod ถูกลบ endpoint ของมันจะถูก mark ว่า not ready ตัว Service เลยเลิกส่ง traffic ใหม่ไปให้ ในเวลาเดียวกัน hook `preStop` ของมันก็รัน แล้ว container ก็ได้ `SIGTERM` (หรือ stop signal ของ image นั้น) หลัง `terminationGracePeriodSeconds` (default 30 รวมเวลาของ hook ด้วย) อะไรที่ยังเหลือจะโดน kill ไป ส่วนการ update endpoint กับการส่ง signal นั้นแข่งกันอยู่ การใส่ `preStop` ให้ sleep สั้น ๆ เลยเป็นวิธีที่ใช้กันบ่อยเพื่อให้ยังให้บริการต่อไปจนกว่า load balancer จะตามทัน จากนั้นแอปพลิเคชันต้องทำ request ที่ค้างอยู่ให้จบแล้ว exit เมื่อได้ `SIGTERM` ส่วน Pod ที่กำลัง terminate จะไม่ถูกนับแล้ว ตัวแทนของมันเลยเริ่มได้ขณะที่มันยังกำลัง shut down อยู่ ช่วงหนึ่งเลยมี Pod รันอยู่มากกว่า `replicas` บวก `maxSurge`
- **Probe บน Kubernetes** readiness probe ที่ fail จะเอา Pod ออกจาก endpoint ของ Service และพัก rollout ไว้ liveness probe ที่ fail จะ restart container ส่วน startup probe จะกันทั้งสองตัวไว้จนกว่าตัวที่ start ช้าจะขึ้นมาได้
- **Amazon ECS** (deployment type แบบ rolling update) `minimumHealthyPercent` (default 100) กับ `maximumPercent` (default 200) ก็คือปุ่มหมุนสองตัวเดียวกัน แค่เป็นเปอร์เซ็นต์ของจำนวน task ที่ต้องการ ตัว deployment circuit breaker นับ task ที่ start ไม่ขึ้นหรือไม่ผ่าน health check และพอเกิน threshold (ค่า default คือครึ่งหนึ่งของจำนวนที่ต้องการ โดยอยู่ระหว่าง 3 ถึง 200) ก็จะ mark deployment ว่า failed และ rollback ไปตัวล่าสุดที่เสร็จสมบูรณ์ได้ ส่วน CloudWatch alarm ก็ทำให้ deployment fail แล้ว rollback ตาม metric ของแอปพลิเคชันได้
- **Amazon EC2 Auto Scaling instance refresh** minimum healthy percentage มีค่า default 90 และ maximum เป็น 100 ค่า default เลยเอา group ออกไปหนึ่งในสิบแล้วค่อยแทนที่ ถ้าตั้ง minimum เป็น 100 มันจะ launch instance ใหม่ก่อน terminate ตัวเก่า ตัว instance warm-up, checkpoint และ bake time คุมจังหวะ ส่วน skip matching จะไม่แตะ instance ที่ตรงอยู่แล้ว instance ใหม่ที่ไม่ผ่าน health check จะถูกแทนที่ และถ้ายังเป็นแบบนี้ต่อไปนานหนึ่งชั่วโมง refresh ก็จะ fail ส่วน automatic rollback ปิดอยู่จนกว่าจะเปิดเอง
- **Azure Virtual Machine Scale Sets** upgrade policy mode แบบ *rolling* (แบบอื่นคือ automatic กับ manual) จะ upgrade เป็น batch ตามเปอร์เซ็นต์ที่ตั้งไว้ พักระหว่าง batch ได้ หยุดเมื่อมี instance ไม่ healthy มากเกินไป และต้องมี health probe หรือ Application Health extension ไว้ให้รู้สถานะ ถ้าเปิด `MaxSurge` มันจะสร้าง instance ใหม่ก่อนลบตัวเก่า ถ้าไม่เปิด ตัว instance จะถูก upgrade แบบ in-place และ capacity อาจตกลงในแต่ละ batch
- **Google Cloud managed instance group** `maxSurge` กับ `maxUnavailable` มีค่า default เป็น 1 สำหรับ zonal group และเท่ากับจำนวน zone สำหรับ regional group ไม่มีคำสั่ง rollback: จะ rollback ก็ต้องเริ่ม update อีกรอบด้วย instance template ตัวเก่า
- **Stateful set** StatefulSet ของ Kubernetes update Pod ทีละตัว จาก ordinal สูงสุดไปต่ำสุด และรอจนแต่ละตัว Running และ Ready ส่วน `partition` เก็บ ordinal ที่ต่ำกว่าไว้ที่เวอร์ชันเก่าเพื่อ rollout เป็นขั้น ๆ
- **Autoscaling ระหว่าง rollout** จำนวนที่ต้องการอาจเปลี่ยนระหว่างที่ instance กำลังถูกแทนที่ ตอนนั้น Kubernetes จะกระจาย replica ที่เพิ่มมาไปที่ ReplicaSet เก่าและใหม่ตามสัดส่วน ให้เช็กว่า platform ของเราทำยังไงก่อนเอา rollout ช้า ๆ มาใช้ร่วมกับ [Autoscaling](../autoscaling/)
- **อย่าปล่อยให้มันจบไปโดยไม่มีใครดู** เฝ้าดู error rate กับ latency แยกตามเวอร์ชันระหว่าง rollout ตั้ง alert ให้ rollout ที่เลย deadline และใส่การพักหรือ bake time หลัง batch แรกถ้าการเปลี่ยนแปลงนั้นเสี่ยง
