## ปัญหา

โหลดแทบไม่เคยนิ่ง มันขึ้นลงตามเวลาทำงาน พุ่งขึ้นหลังส่ง marketing email หรือหลังมีข่าวพูดถึง แล้วก็ตกลงตอนกลางคืน fleet ที่ตั้งขนาดไว้รับ peak ต้องจ่ายค่า instance ที่นั่งว่างเกือบตลอดเวลา ส่วน fleet ที่ตั้งขนาดไว้รับค่าเฉลี่ยจะหมด headroom ตอน peak: request ต่อคิว latency สูงขึ้น แล้ว error ก็ตามมา การปรับขนาดด้วยมือช้าและพลาดง่าย และไม่มีใครนั่งดูกราฟตอนตีสาม

## ทำงานยังไง

autoscaling คือ control loop ที่ครอบ group ของ instance ที่เหมือนกันและสลับกันได้ (VM, container หรือ Pod) ที่อยู่หลัง load balancer หรืออ่านงานจาก queue

- **วัดผล** แต่ละ instance รายงาน metric ที่ขึ้นลงตามส่วนแบ่งงานของมัน: CPU เฉลี่ย, request ต่อ instance หรือ backlog ใน queue ต่อ worker
- **ตัดสินใจ** ถ้าใช้ **target tracking** คุณเลือกค่า target (ในที่นี้คือ CPU 60%) autoscaler จะคำนวณ capacity ที่จะดึง metric กลับมาที่ target: *desired = instances × current value ÷ target* ปัดขึ้น แล้วคุมผลให้อยู่ระหว่าง **ค่าต่ำสุด** กับ **ค่าสูงสุด** ตัว Kubernetes Horizontal Pod Autoscaler (HPA) ก็เขียนการคำนวณนี้ไว้ใน documentation ตรง ๆ แบบนี้เลย EC2 Auto Scaling เปรียบ target tracking กับ thermostat และปัดแบบระมัดระวัง: มันยอมเพิ่ม instance เกินไปหนึ่งตัว หรือลดน้อยไปหนึ่งตัว ดีกว่า
- **ลงมือ** instance ใหม่ boot, start แอปพลิเคชันแล้ว warm up โดย load balancer จะส่ง request ไปให้ก็ต่อเมื่อมันผ่าน health check แล้วเท่านั้น instance ที่จะถูกถอดออกจะถูก deregister ก่อน มันเลยไม่ได้ request ใหม่ระหว่างที่ request ที่ค้างอยู่ทำจนเสร็จ (*connection draining*) จากนั้นค่อยถูก terminate
- **หน่วง** scale out ให้เร็ว และ scale in ให้ช้า metric ช่วง start-up ของ instance ใหม่จะไม่ถูกนับรวมในค่าเฉลี่ยอยู่สักพัก: AWS เรียกช่วงนี้ว่า *instance warm-up* ส่วน Google Compute Engine เรียกว่า *initialization period* และ HPA จะไม่นับ CPU sample จาก Pod ที่ยังไม่ ready ส่วน scale-in จะรอให้ผ่าน **stabilisation window** ก่อน ค่า default ของ HPA จะทำตาม recommendation ที่สูงที่สุดใน 5 นาทีล่าสุด และ Compute Engine จะเก็บ capacity ไว้พอสำหรับ peak ใน 10 นาทีล่าสุด ช่วงที่โหลดตกลงแป๊บเดียวเลยไม่ลบ capacity ที่ต้องใช้อีกครั้งในนาทีถัดไป การลบแล้วเพิ่ม capacity กลับวนไปมาแบบนี้เรียกว่า *flapping* ส่วน policy แบบ rule-based มักใช้ *cooldown* ตายตัวแทน คือหยุดพักหลัง scaling action แต่ละครั้ง: ทุก rule ของ Azure autoscale มี cooldown ของตัวเอง ส่วน EC2 Auto Scaling ใช้ default cooldown 300 วินาทีหลัก ๆ กับ simple scaling policy และพึ่ง instance warm-up กับ policy แบบอื่น

policy มีสี่แบบ และมักใช้ร่วมกัน:

- **Target tracking:** metric หนึ่งตัวกับค่า target แล้ว autoscaler กำหนดขนาดของแต่ละ step เอง นี่เป็น default ที่ใช้กันทั่วไป และ AWS แนะนำให้ใช้แทน step scaling ทุกครั้งที่ metric ขยับเป็นสัดส่วนกับ capacity
- **Step scaling:** คุณตั้ง alarm threshold และกำหนดว่าจะเพิ่มหรือลดกี่ instance สำหรับการเกิน threshold แต่ละระดับ คุมได้มากกว่าแต่ต้อง tune มากกว่า เว้นระยะระหว่าง threshold ของ scale-out กับ scale-in ไว้ ไม่อย่างนั้นมันจะ flap
- **Scheduled scaling:** เปลี่ยนค่าต่ำสุด ค่าสูงสุด หรือ desired capacity ตามเวลาที่ตั้งไว้ (cron) สำหรับเวลาทำการ หรืองานที่รู้ล่วงหน้าอย่าง product launch
- **Predictive scaling:** พยากรณ์โหลดจากประวัติ แล้วเพิ่ม capacity ก่อนโหลดจะมา EC2 Auto Scaling ต้องมีข้อมูลอย่างน้อย 24 ชั่วโมง วิเคราะห์ย้อนหลังได้ถึง 14 วัน พยากรณ์ 48 ชั่วโมงข้างหน้าเป็นรายชั่วโมง และ refresh การพยากรณ์ทุก 6 ชั่วโมง มัน scale out อย่างเดียว เลยต้องจับคู่กับ dynamic policy ส่วน managed instance group ของ Compute Engine และ Azure Virtual Machine Scale Sets ก็มี predictive autoscaling เหมือนกัน

เมื่อมีหลาย policy หรือหลาย metric ทำงานอยู่ คำตอบที่มากกว่าจะชนะ EC2 Auto Scaling จะ scale out ถ้ามี target-tracking policy ตัวไหนอยากให้ scale out และจะ scale in ก็ต่อเมื่อทุกตัวอยากให้ลด ส่วน Azure autoscale ก็ทำกับ rule ของมันแบบเดียวกัน และ HPA จะเอาจำนวน replica สูงสุดจากทุก metric

## ใช้ตอนไหนดี

- tier ที่ stateless หรือ tier ที่เก็บ state ไว้ที่อื่น: web server กับ API server และ worker ที่ดึงงานจาก queue (แบบ consumer ใน [Event-Driven Architecture](../event-driven-architecture/))
- โหลดที่เปลี่ยนไปตลอดวันหรือตลอดสัปดาห์ หรือ spike ที่วางตารางล่วงหน้าไม่ได้
- instance ที่เริ่ม serve ได้ภายในไม่กี่นาที ถ้า start-up ใช้เวลานานกว่าที่ spike ก่อตัว ให้เพิ่ม headroom ใช้ warm pool หรือใช้ predictive scaling
- ไม่ใช่ทางแก้คอขวดที่อยู่ที่อื่น web server ที่มากขึ้นหน้าฐานข้อมูลที่เต็มแล้วแค่ย้ายคิวไปอยู่ที่อื่น ให้ scale หรือป้องกันตัวคอขวดแทน (caching, read replica, Queue-Based Load Leveling) และไม่เหมาะกับ singleton ที่มี state หรือ software ที่คิด licence ต่อ instance ด้วย

## ได้อะไร เสียอะไร

- **มันตอบสนองในหลักนาที ไม่ใช่หลักวินาที** metric มาถึงประมาณทุกนาที (EC2 publish basic CPU metric แค่ทุก 5 นาที ถ้าไม่ได้เปิด detailed monitoring) autoscaler ประเมินตามรอบของตัวเอง (ทุก 15 วินาทีสำหรับ HPA, ทุก 30 ถึง 60 วินาทีสำหรับ Azure autoscale) แล้วการ boot, warm up และผ่าน health check ก็ใช้อีกหลายนาที instance ที่มีอยู่แล้วต้องรับไม่กี่นาทีแรกของ spike ให้ได้ และช่องว่างระหว่าง target กับ 100% ก็คือ headroom นั้น target ที่ต่ำลงซื้อ headroom ได้มากขึ้นและแพงขึ้น
- **เลือก metric ที่ตามโหลดต่อ instance** CPU เหมาะกับ service แบบ CPU-bound, request ต่อ instance เหมาะกับ service แบบ I/O-bound และ backlog ต่อ worker เหมาะกับ consumer ของ queue ส่วน AWS เตือนว่าจำนวน request ทั้งหมดของ load balancer, latency ของมัน และความยาว queue ดิบ ๆ ใช้กับ target tracking ไม่ได้ เพราะมันไม่เปลี่ยนเป็นสัดส่วนกับจำนวน instance
- **flap หรือเปลือง** scale-in window ที่ยาวช่วยเลี่ยง flapping แต่ทำให้ instance ที่นั่งว่างอยู่ในบิลนานขึ้น window ที่สั้นประหยัดเงินได้ แต่อาจลบ capacity ที่ต้องใช้อีกครั้งในนาทีถัดไป
- **min กับ max เป็น safety limit** ค่าต่ำสุดคือพื้นของ availability (อย่างน้อยสอง instance กระจายข้าม zone) และคุณต้องจ่ายค่ามันทั้งคืน ค่าสูงสุดคุมบิล และปกป้อง dependency ปลายทางกับ quota รวมถึงกันกรณีที่ bug หรือการโจมตีดัน metric ให้สูงขึ้นด้วย ตั้ง alert เมื่อ group ค้างอยู่ที่ค่าสูงสุด เพราะตั้งแต่ตอนนั้นมันจะ scale ไม่ได้อีกแล้ว
- **scale-in เลือกว่า instance ไหนจะถูกถอด** ปกป้อง instance ที่กำลังทำงานที่ใช้เวลานาน EC2 มี instance scale-in protection และใน Kubernetes annotation `controller.kubernetes.io/pod-deletion-cost` (beta) บอก ReplicaSet ว่าควรเลือกลบ Pod ไหนก่อน ส่วน scale-in protection ไม่ได้กันการแทน instance ที่ health check fail หรือ Spot interruption
- **cold start** instance ใหม่ช้าที่สุดในตอนที่คุณต้องการมันพอดี: cache ว่าง JIT compiler ยังเย็น และ connection pool ยังเติมไม่เต็ม ให้ readiness check รอจน warm up เสร็จ ค่อย ๆ เพิ่ม traffic (Application Load Balancer *slow start*) หรือเตรียม capacity ที่ initialise ไว้แล้วให้พร้อม: EC2 warm pool (instance ที่ stop ไว้เสียค่าแค่ volume กับ Elastic IP address), Lambda provisioned concurrency หรือ Cloud Run minimum instances ถ้าเป็นงานที่รู้ล่วงหน้า ก็ scale out ไว้ก่อนด้วย scheduled action ตัว load balancer เองก็ต้อง scale ด้วย และ Application Load Balancer ให้คุณจอง load balancer capacity unit ไว้สำหรับงานนั้นได้
- **ต้นทุน** คุณจ่ายตามที่รันอยู่ การ scale in เลยเป็นที่มาของเงินที่ประหยัดได้ EC2 คิดเงิน instance Linux และ Windows ส่วนใหญ่เป็นรายวินาที โดยมีขั้นต่ำหนึ่งนาที ทำให้ capacity ที่อยู่สั้น ๆ มีราคาถูก ส่วน headroom, ค่าต่ำสุด, warm pool และ scale-in window ที่ยาวคือราคาของความปลอดภัย

## ข้อควรรู้ตอนลงมือทำ

- **Virtual machine:** Amazon EC2 Auto Scaling group, Azure Virtual Machine Scale Sets คู่กับ Azure Monitor autoscale และ Google Compute Engine managed instance group คู่กับ autoscaler ทั้งสามตัวมี limit ต่ำสุดและสูงสุด, scaling ตาม metric และตามตารางเวลา และ predictive scaling
- **Kubernetes:** HPA (`autoscaling/v2`) scale Pod ตาม CPU, memory หรือ custom และ external metric ค่า default คือประเมินทุก 15 วินาที ไม่สนการเปลี่ยนแปลงที่อยู่ใน tolerance 10% (ปรับได้ต่อ HPA) scale up โดยไม่มี stabilisation window และ scale down ด้วย window 300 วินาที KEDA เพิ่ม event source กว่า 70 แบบ (queue, stream, database, Prometheus, cron) และ scale ไปถึงศูนย์และกลับจากศูนย์ได้ โดยปล่อยช่วงตั้งแต่หนึ่ง replica ขึ้นไปให้ HPA ที่มันจัดการเป็นคนดูแล ตอนนี้ HPA เองก็ scale ไปถึงศูนย์ได้แล้วด้วย object หรือ external metric (beta ตั้งแต่ Kubernetes 1.37) ตัว Pod ต้องมีที่ให้รัน เลยต้องจับคู่ทั้งสองตัวกับ node autoscaler อย่าง Cluster Autoscaler หรือ Karpenter
- **Serverless:** function และ serverless container scale ตาม request โดยไม่ต้องเขียน policy สิ่งที่ปรับได้คือ concurrency limit กับ capacity ที่ pre-warm ไว้ (ดู Serverless)
- **Health check:** readiness ควรหมายถึง *พร้อม serve* คือ warm up แล้วและติดต่อ dependency ของมันได้ (ดู Health Endpoint Monitoring)
- **Graceful shutdown:** เมื่อได้ SIGTERM ให้หยุดรับงานใหม่และทำงานที่ค้างอยู่ให้เสร็จ ตั้ง drain timeout ให้นานกว่า request ที่ช้าที่สุด ส่วน deregistration delay ของ Elastic Load Balancing มี default 300 วินาที และ `terminationGracePeriodSeconds` ของ Kubernetes มี default 30
- **Test และเฝ้าดู:** load test ตัว scaling เอง และวัดว่าต้องใช้เวลาเท่าไรกว่าจะได้ capacity ครบ แล้วตั้ง alert เมื่อ group ชนค่าสูงสุดและเมื่อ scaling fail (ติด quota หรือ capacity limit) อย่าหวังพึ่ง autoscaling กับการเปลี่ยนแปลงใหญ่ ๆ แบบกะทันหัน เช่น region ที่ failover ใน [Multi-Region Active-Active](../multi-region-active-active/): scale out ใช้เวลาหลายนาทีและต้องแย่ง capacity เลยต้องเตรียม headroom ไว้ก่อน
