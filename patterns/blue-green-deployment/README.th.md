## ปัญหา

deploy แบบ in-place จะหยุดเวอร์ชันเก่าแล้วติดตั้งเวอร์ชันใหม่ลงบน server ชุดเดิม user จะเจอ downtime หรือเจอ fleet ที่รันทั้งสองเวอร์ชันปนกันระหว่างที่กำลัง update และจังหวะที่เสี่ยงที่สุด คือตอนที่ build เจอ traffic, configuration และข้อมูลจริงเป็นครั้งแรก ก็เกิดกับทุกคนพร้อมกัน ถ้ามีอะไรผิดพลาด การ rollback ก็คือการ deploy เวอร์ชันเก่าอีกรอบ ใช้เวลาพอ ๆ กับการ release หนึ่งครั้ง ระหว่างนั้น user ก็ต้องรอ

## ทำงานยังไง

มี production environment สองชุดที่เหมือนกันมากที่สุดเท่าที่ทำได้ เรียกว่า **Blue** กับ **Green** ในแต่ละช่วงเวลา ชุดหนึ่ง live อยู่ ส่วนอีกชุด idle

- **Deploy** เวอร์ชันใหม่ลง environment ที่ idle แล้วรัน test รอบสุดท้ายที่นั่น: infrastructure, configuration และ dependency ของ production จริง แต่ไม่มี user ส่วน test เข้าไปถึงมันผ่าน test endpoint ที่เป็น private เช่น preview service, test listener หรือ URL ที่ติด tag
- **สลับ** router ให้ request ที่เข้ามาทั้งหมดไปที่ environment ใหม่ ตัว router อาจเป็น listener หรือ target group ของ load balancer, selector ของ Kubernetes Service, route ของ ingress หรือ service mesh หรือ DNS record ก็ได้
- **ปล่อย environment เก่ารันไว้** สักพัก ถ้าเวอร์ชันใหม่ทำตัวผิดปกติ ก็สลับกลับ: rollback เป็น operation ขั้นเดียวเหมือนกับการ release
- **ปลด** environment เก่าเมื่อเวอร์ชันใหม่พิสูจน์ตัวเองได้แล้ว มันจะกลายเป็น environment ที่ idle ไว้ลง release ถัดไป

สีเป็นแค่ชื่อของสองช่องนี้ environment แต่ละชุดจะวนไปเป็นตัวที่ live, ตัวที่ standby ไว้ rollback และตัวที่ใช้ stage เวอร์ชันถัดไป และชื่อก็ติดอยู่กับช่อง ไม่ได้ติดกับเวอร์ชัน ส่วน Spinnaker ที่เป็น delivery platform ที่สร้างขึ้นที่ Netflix เคยเรียก strategy เดียวกันนี้ว่า *red/black* จนกระทั่ง version 1.30 เปลี่ยนชื่อเป็น blue/green ส่วน Martin Fowler ก็ชี้ไว้ว่าการสลับนี้คือกลไกเดียวกับที่ hot standby ต้องใช้ ทุกการ release เลยเป็นการซ้อมขั้นตอน disaster recovery ไปส่วนหนึ่งด้วย

## ใช้ตอนไหนดี

- release ที่ต้องไม่มี downtime และต้องการ rollback ที่วัดกันเป็นวินาที ไม่ใช่ต้อง deploy อีกรอบ
- การเปลี่ยนแปลงที่อยากตรวจบน production stack จริงก่อนที่ user คนไหนจะเห็น: smoke test, warm-up, configuration และการเชื่อมต่อไปยัง dependency
- stack ที่ทำซ้ำได้ถูก: stateless service, container, autoscaling group, deployment slot ของ platform
- service ที่ traffic น้อยเกินกว่าที่ canary จะเก็บสัญญาณได้เร็ว blue-green ไม่ต้องแบ่ง traffic แค่ต้องมี test ที่ดีกับช่วงเวลาคอยเฝ้าดู
- มันไม่ค่อยเหมาะตอนที่สองเวอร์ชันใช้ database ร่วมกันไม่ได้ (schema change ที่ทำให้ backward compatible ไม่ได้) ตอนที่ environment ทำซ้ำได้แพงหรือช้า และกับซอฟต์แวร์ของ vendor ที่มีขั้นตอน upgrade ของตัวเองมาให้

## ได้อะไร เสียอะไร

- **ทุกคนย้ายพร้อมกัน** ปัญหาที่ smoke test พลาดไปจะไปถึง user 100% จนกว่าจะสลับกลับ ให้เฝ้าดู environment ใหม่ใกล้ ๆ ทันทีหลังสลับ และใช้ [canary release](../canary-release/) ถ้าความเสี่ยงอยู่ที่พฤติกรรมตอน runtime ที่มีแค่ traffic จริงเท่านั้นที่เผยออกมา การย้าย traffic ของ blue-green เป็นขั้น ๆ ตามน้ำหนักแทนที่จะกระโดดทีเดียว ก็คือการเปลี่ยนมันเป็น canary
- **การเปลี่ยน database ต้องใช้ได้กับทั้งสองเวอร์ชัน** ปกติทั้งสอง environment ใช้ database ตัวเดียวกัน schema เลยต้องใช้ได้กับ v1 และ v2 ในเวลาเดียวกัน และ rollback ก็ต้องรับมือกับข้อมูลที่ v2 เขียนไปแล้วได้ ให้เปลี่ยน schema ด้วย **expand and contract** ([parallel change](https://martinfowler.com/bliki/ParallelChange.html)): ทำการเปลี่ยนแบบเพิ่มอย่างเดียวที่ v1 รับได้ก่อน release แล้ว ship v2 และค่อยลบ column เก่าหลังจากปลด Blue ไปแล้วเท่านั้น rollback โค้ดไม่ได้ rollback ข้อมูลไปด้วย ถ้าให้แต่ละ environment มี database ของตัวเองแทน ก็แปลว่าต้อง sync ข้อมูลระหว่างกันทั้งสองทาง และเรื่องนี้ทำให้ไว้ใจได้ยาก
- **Session และ request ที่วิ่งอยู่** session ที่เก็บใน memory ของ Blue จะหายไปเมื่อ user ของมันไปตกที่ Green เลยต้องเก็บไว้ใน shared store หรือใน token ที่ sign ไว้ ส่วน request ใหม่จะไปที่ Green ขณะที่ตัวที่วิ่งอยู่แล้วก็ทำจนจบบน Blue และ instance ของ Blue ควร drain ก่อนจะถูกเอาออก (deregistration delay ของ AWS Application Load Balancer รอได้นานสุด 300 วินาทีเป็นค่า default) connection ที่อยู่นานอย่าง WebSocket จะค้างอยู่บน Blue จนกว่าจะปิด เลยต้องปิดมันอย่างนุ่มนวลแล้วให้ client ต่อใหม่ ส่วนตัว router ย้ายแค่ request traffic: queue consumer กับ scheduled job ใน environment ที่ idle ยังรันต่อไป ถ้าไม่ได้สั่งหยุด
- **DNS กับ load balancer** การสลับด้วย DNS (weighted record หรือ *Swap environment URLs* ของ Elastic Beanstalk ที่เป็นการสลับ CNAME) ง่ายและใช้ข้าม region ได้ แต่ resolver กับ client จะ cache คำตอบไว้ตาม TTL และบางตัวก็เก็บไว้นานกว่านั้น traffic เลยค่อย ๆ ไหลไป Blue อยู่สักพัก และการ rollback ก็ช้าพอ ๆ กัน การสลับที่ load balancer, proxy, ingress หรือ Kubernetes Service ทำให้ไม่ต้องสน DNS cache ฝั่ง client และปกติก็มีผลกับ request ใหม่ภายในไม่กี่วินาที ตัว rollback เร็วได้แค่เท่าที่การสลับเร็ว
- **Infrastructure สองเท่า** ระหว่าง release ต้องจ่ายค่า production environment เต็ม ๆ สองชุด ให้สร้าง Green เฉพาะตอน release แล้วรื้อ Blue ทิ้งหลังช่วงเฝ้าดู (ถ้าใช้ immutable infrastructure ก็เป็นแบบนี้อยู่แล้ว) ใช้ data tier ร่วมกัน หรือรัน preview ที่เล็กกว่าไว้ test แล้ว scale ให้เต็มขนาดก่อนสลับ เก็บ Blue ไว้เต็มขนาดตราบที่ยังอยากได้ rollback แบบขั้นเดียว: พอ scale มันลงไปแล้ว rollback ก็กลับไปเป็นการ deploy อีกรอบ

**จะเลือก blue-green, canary หรือ rolling update**

| | Blue-green deployment | Canary release | Rolling update |
|---|---|---|---|
| traffic ย้ายยังไง | ทั้งหมดทีเดียว ไปยัง environment ชุดที่สอง | สัดส่วนที่ค่อย ๆ เพิ่มขึ้น โดยมี metric คุมแต่ละขั้น | ทีละ batch ตามที่ instance เก่าถูกแทนที่ |
| Rollback | สลับกลับตอนที่ environment เก่ายังรันอยู่ | ตั้งน้ำหนักของ canary เป็น 0% | rollout เวอร์ชันเก่าออกไปอีกรอบ |
| Capacity ที่ต้องเพิ่ม | environment ชุดที่สองเต็ม ๆ ระหว่าง release | instance ของ canary | surge instance ไม่กี่ตัว (25% เป็นค่า default ใน Kubernetes) |
| user ที่โดน build เสีย | ทุกคน จนกว่าจะสลับกลับ | แค่ส่วนที่ไป canary | สัดส่วนที่ค่อย ๆ เพิ่มขึ้นทีละ batch |
| เก่งเรื่อง | ตัดเปลี่ยนแบบสะอาด ทดสอบบน stack จริง และมีทางกลับทันที | ความเสี่ยงตอน runtime ที่มีแค่ traffic จริงเผยออกมา | update ง่าย ๆ ที่มี capacity เหลือไม่มาก |

## ข้อควรรู้ตอนลงมือทำ

- **Kubernetes:** รัน Deployment หนึ่งตัวต่อหนึ่งสี แล้วพลิก selector ของ Service จาก `version: blue` เป็น `version: green` ส่วน Argo Rollouts ทำทั้ง cycle ให้อัตโนมัติ: `activeService` รับ traffic ของ production, `previewService` ให้ test endpoint กับ ReplicaSet ใหม่, `prePromotionAnalysis` คุมการสลับ, `postPromotionAnalysis` สลับกลับให้อัตโนมัติเมื่อมัน fail และ `autoPromotionEnabled: false` รอให้คนกด promote เอง ReplicaSet เก่าจะถูก scale ลงหลัง `scaleDownDelaySeconds` (30 s เป็นค่า default เพื่อให้ทุก node update routing rule ก่อน) ให้เพิ่มค่านี้ถ้าอยากได้ช่วง rollback ที่ยาวขึ้น
- **AWS:** Amazon ECS มี blue/green deployment มาในตัว โดย test traffic จะไปถึง green revision ผ่าน listener rule ส่วน production traffic ย้ายทีเดียวทั้งหมด และทั้งสอง revision จะรันต่อไปตลอด bake time ที่ตั้งค่าได้ โดยที่ CloudWatch alarm สั่ง rollback อัตโนมัติได้ ตอนนี้ AWS แนะนำตัวนี้มากกว่า blue/green ที่ CodeDeploy จัดการสำหรับ ECS ส่วน weighted target group บน Application Load Balancer, weighted record ของ Route 53 และ URL swap ของ Elastic Beanstalk ครอบคลุม setup แบบอื่น
- **Azure:** deployment slot ของ App Service โดย deploy ลง staging slot ก่อน ให้ App Service warm มันขึ้นมา แล้ว swap เข้าไปเป็น production (จะใช้ *swap with preview* เพื่อตรวจกับ production setting ก่อนก็ได้) และ swap สอง slot เดิมอีกรอบเพื่อ rollback
- **Google Cloud:** Cloud Run คำสั่ง `gcloud run deploy SERVICE --image IMAGE --no-traffic --tag green` ให้ revision ใหม่มี test URL ของตัวเอง ส่วน `gcloud run services update-traffic SERVICE --to-tags green=100` ย้าย traffic ไปหามัน และการส่ง traffic กลับไปที่ revision ก่อนหน้าก็คือการ rollback
- **Cloud Foundry:** push Green ไว้ใต้ route ชั่วคราว แล้ว map production route ไปที่มัน จากนั้นก็ unmap route นั้นออกจาก Blue
- **Database มีแบบของตัวเอง** Amazon RDS Blue/Green Deployments เก็บ staging copy ของ database ที่ sync กันไว้สำหรับ engine upgrade และการเปลี่ยน parameter แล้วค่อยสลับ ปกติใช้เวลาไม่ถึงนาที นั่นคือการ upgrade ตัว database เอง ไม่ได้มาแทน expand and contract สำหรับการ release แอปพลิเคชัน
- **ทำการสลับและทางกลับให้เป็นอัตโนมัติ** smoke test, การสลับ, ช่วงเฝ้าดู และตัวสั่ง rollback ควรอยู่ใน pipeline ไม่ใช่ใน runbook ที่มีคนทำตามด้วยมือ
