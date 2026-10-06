## ปัญหา

โค้ด backend ส่วนใหญ่ใช้ชีวิตไปกับการรอเฉย ๆ ตัว server ที่ตั้งขนาดไว้รับช่วง peak นั่งว่างทั้งคืน แต่เราก็ยังต้อง patch ต้องจ่ายเงิน และต้องวางแผน capacity ให้มันอยู่ดี สำหรับงานที่มีหน้าตาเป็น event (request, ไฟล์ที่อัปโหลด, message, timer) อายุของ server แทบไม่เกี่ยวอะไรกับตัวงานเลย สิ่งที่เราอยากได้คือให้โค้ดรันตอนมีเรื่องเกิดขึ้น รันหลายชุดเท่ากับจำนวน event และไม่เสียเงินเลยตอนไม่มีอะไรเกิดขึ้น

## ทำงานยังไง

"Serverless" เป็นคำร่มที่ครอบหลายอย่าง Mike Roberts แบ่งมันเป็น **Backend as a Service** (BaaS: service ของ third-party อย่าง database และ authentication ที่เราเรียกใช้แทนที่จะรันเอง) กับ **Functions as a Service** (FaaS: โค้ดของเราเอง ที่ platform รันใน container แบบ stateless และอยู่แค่ชั่วคราว) ตอนนี้คำร่มนี้ยังครอบไปถึง container และ database ที่ scale to zero ได้และคิดเงินตามการใช้ (Cloud Run, Aurora Serverless, serverless tier ของ Azure SQL Database) แต่ pattern นี้พูดถึง FaaS ส่วน managed service ทางขวาของ diagram ก็คือ BaaS ที่มันพึ่งอยู่

เรา deploy **function** คือ handler พร้อม dependency ของมัน ที่ผูกไว้กับ event source หนึ่งตัวหรือมากกว่า แล้ว platform ก็จัดการที่เหลือ ต่างจาก [autoscaling](../autoscaling/) กลุ่ม server ตรงที่ไม่มีขนาดขั้นต่ำ และไม่มี scaling policy ให้จูน หน่วยของมันคือ instance เดียวที่มีอยู่แค่ตอนที่มีงาน

- **Cold start** ถ้าตอน event มาถึงไม่มี instance ว่าง platform จะสร้าง execution environment ขึ้นมา โดยดึงโค้ด เปิด runtime และรันโค้ด initialisation ของเรา (ทุกอย่างที่อยู่นอก handler) เสร็จแล้วถึงจะรัน handler
- **Warm start** instance ที่ทำงานเสร็จแล้วจะถูกเก็บไว้สักพัก event ถัดไปใช้มันซ้ำแล้วเข้า handler ได้เลย ทำให้ client, connection และ cache ที่สร้างไว้ตอน initialisation ได้ใช้ซ้ำ แต่ไม่มีอะไรรับประกันว่า instance จะอยู่รอด ให้มองเรื่องนี้เป็นของแถม
- **Scale out** ในโมเดลดั้งเดิม instance หนึ่งตัวรับได้ทีละ invocation เดียว concurrency เลยเท่ากับจำนวน instance คร่าว ๆ คือ *request ต่อวินาที × ระยะเวลาเฉลี่ย* พอ event มาพร้อมกันมากขึ้น instance ก็มากขึ้นตาม จนถึง concurrency limit ถ้าเกินจากนั้น ตัวเรียกแบบ synchronous จะโดน throttle ส่วน event ที่อยู่ใน queue ก็ต้องรอ
- **Scale to zero** instance ที่ว่างอยู่จะถูกเก็บคืนหลังผ่านไปช่วงเวลาหนึ่งที่ platform เป็นคนเลือก ถ้าไม่มี traffic ก็ไม่มี instance และไม่มีค่า compute

การจัดการความล้มเหลวขึ้นกับว่า function ถูกเรียกแบบไหน

| Invocation | source ที่เจอบ่อย | ตอน handler พัง |
|---|---|---|
| **Synchronous** | HTTP ผ่าน [API gateway](../api-gateway/), การเรียกตรง | ตัวเรียกได้ error (หรือโดน throttle) แล้วตัดสินใจเองว่าจะ retry ไหม platform ไม่ retry ให้ |
| **Asynchronous** | notification จาก object storage, topic, schedule | platform เอา event เข้า queue แล้ว retry invocation อีกไม่กี่ครั้งโดยเว้นระยะ จากนั้นก็ทิ้ง event หรือส่งไปที่ dead-letter queue หรือ failure destination |
| **Polling** | queue และ stream | platform คอย poll แล้วเรียกพร้อม batch ถ้า message ใน queue พัง มันจะกลับมาให้เห็นอีกและถูกส่งซ้ำ จนกว่ากฎ dead-letter ของ queue เองจะเอามันออก ถ้า batch ของ stream พัง มันจะถูก retry ตามลำดับ ทำให้ shard หรือ partition นั้นติดอยู่จนกว่าจะสำเร็จหรือ record หมดอายุ |

## ใช้ตอนไหนดี

- งานที่มีหน้าตาเป็น event มาเป็นพัก ๆ หรือคาดเดาไม่ได้ เช่น API ที่ traffic ไม่สม่ำเสมอ, webhook, การประมวลผลไฟล์และ stream, งานตามตารางเวลา และโค้ดกาวระหว่าง managed service
- product ใหม่และเครื่องมือภายใน ที่ยังไม่รู้ว่า traffic จะเป็นยังไง และการไม่เสียเงินเลยตอนว่างสำคัญกว่าราคาต่อ request
- งานชิ้นเล็กที่เสร็จในไม่กี่วินาที และเก็บ state ไว้ที่อื่น function คือ consumer ที่เข้ากันโดยธรรมชาติกับ [event-driven architecture](../event-driven-architecture/)

**ตอนไหนไม่ควรใช้:**

- งานที่รันนานหรือหนักจนเกิน timeout ของ platform เว้นแต่จะมี workflow แบ่งมันเป็นขั้น ๆ ได้
- เส้นทางที่ latency สำคัญมากจนรับ cold start ไม่ได้ เว้นแต่จะยอมจ่ายเงินจอง instance ไว้
- throughput ที่หนักและสม่ำเสมอ ที่ compute แบบเปิดตลอดมีต้นทุนต่อ request ถูกกว่า
- งานที่ต้องใช้ state ใน memory ขนาดใหญ่, sticky session หรือ connection ที่เปิดค้างนาน ๆ

## ได้อะไร เสียอะไร

- **Cold start** มันโดน request แรกหลังช่วงว่าง และทุก request ที่ทำให้ต้องสร้าง instance ใหม่ เลยไปโผล่ใน tail latency ส่วนขนาด package, runtime และปริมาณโค้ด initialisation ล้วนทำให้มันนานขึ้น AWS รายงานว่า cold start ปกติกระทบ invocation ของ Lambda ไม่ถึง 1% และกินเวลาตั้งแต่ไม่ถึง 100 ms ไปจนเกินหนึ่งวินาที
- **ข้อจำกัดตายตัว** ระยะเวลา ขนาด payload, memory และ concurrency มีเพดาน ส่วน concurrency quota ที่หลาย function ใช้ร่วมกัน เปิดช่องให้ function ที่ยุ่งตัวเดียวทำให้ตัวอื่นโดน throttle ได้
- **แรงกดดันต่อปลายทาง** function scale out ได้เร็วกว่าสิ่งที่มันเรียกเกือบทุกอย่าง ช่วงที่ traffic พุ่งอาจใช้ connection ของ relational database หรือ rate limit ของ partner จนหมด เพราะฉะนั้นให้จำกัด concurrency ของ function หรือวาง queue ไว้ข้างหน้า (queue-based load leveling)
- **At-least-once delivery** event แบบ asynchronous และแบบ poll อาจมาถึงมากกว่าหนึ่งครั้ง และ retry อาจตามหลังการทำงานที่สำเร็จไปแค่บางส่วน handler เลยต้อง idempotent (pattern idempotent consumer)
- **ต้นทุนตอนใหญ่ขึ้น** เราจ่ายต่อ request และจ่ายค่าระยะเวลาคูณกับ memory ที่ตั้งไว้ และไม่จ่ายอะไรเลยตอนว่าง แต่ต่อหน่วย compute แล้วแพงกว่า server ที่เราใช้งานเต็มตลอด โมเดลนี้เลยชนะตอนที่ utilisation ต่ำหรือขึ้นลงแรง และแพ้ตอนโหลดหนักสม่ำเสมอ ถ้าจะหาจุดคุ้มทุน ให้เทียบ *request × (ราคาต่อ request + ระยะเวลา × memory × rate)* กับ capacity แบบเปิดตลอดที่ traffic เดียวกันต้องใช้
- **observe และเทสต์ยากขึ้น** ไม่มี host ให้ login เข้าไป และ request เดียวก็วิ่งข้ามหลาย managed service
- **Lock-in** handler เป็นโค้ดธรรมดา ส่วน lock-in อยู่ที่ event source, permission และ managed service ที่อยู่รอบ ๆ มัน

## ข้อควรรู้ตอนลงมือทำ

- **ลด cold start** ก่อนจะจ่ายเงินเพื่อเลี่ยงมัน ส่ง package ให้เล็ก โหลด dependency ตัวหนักแบบ lazy และให้ initialisation ทำแค่สิ่งที่ทุก invocation ต้องใช้ แล้วค่อยพิจารณา snapshot (AWS Lambda SnapStart restore function ของ Java, Python และ .NET จาก snapshot ของ environment ที่ initialise แล้ว) หรือ capacity ที่ warm ไว้ตลอด (Lambda provisioned concurrency, always-ready instance ของ Azure Functions, minimum instance ของ Cloud Run) แบบหลังนี้ต้องจ่ายเงินแม้ตอนว่าง
- **เก็บ state ไว้ข้างนอก** ใช้ memory กับ local disk เป็นแค่ cache แล้วสร้าง client และ database connection ตอน initialisation เพื่อให้ invocation ที่ warm ได้ใช้ซ้ำ
- **ปกป้อง relational database** ทุก instance ถือ connection ของตัวเอง 500 instance เลยอาจแปลว่า 500 connection เพราะฉะนั้นให้ pool เล็กมาก ๆ (connection เดียว ถ้า instance รับทีละ request) แล้วจะวาง pooler หรือ proxy คั่นไว้ (PgBouncer, Amazon RDS Proxy) หรือจะจำกัด concurrency ของ function ให้ต่ำกว่า limit ของ database ก็ได้
- **ทำ handler ให้ idempotent** สร้าง idempotency key จาก event บันทึกมันไว้คู่กับผลลัพธ์ และคืนผลลัพธ์ที่เก็บไว้เมื่อ key เดิมโผล่มาอีก ให้ทุก source แบบ asynchronous มี dead-letter queue และตั้ง alert ไว้ที่มัน
- **orchestrate ด้วย workflow service** ไม่ใช่ด้วย function ที่เรียก function แล้วนั่งรอ ส่วน AWS Step Functions, Azure Durable Functions และ Google Cloud Workflows ถือ state ของ process หลายขั้น และจัดการ retry กับการรอให้ (ดู [saga orchestration](../saga-orchestration/) สำหรับการย้อนขั้นที่ทำเสร็จไปแล้ว) ส่วน Lambda durable functions ก็ checkpoint ความคืบหน้าของ function เดียวในแบบคล้ายกัน
- **observe จากข้างนอก** เขียน structured log พร้อม correlation ID แล้วส่งต่อ trace context ไปกับ event ([distributed tracing](../distributed-tracing/)) และคอยดูระยะเวลา, error, throttle, concurrency, อัตรา cold start และอายุของ event ที่ค้างใน queue
- **เทสต์สองชั้น** unit test handler เป็น function ธรรมดาด้วย event ที่บันทึกไว้ ส่วน emulator (`sam local` ของ AWS SAM CLI, Azure Functions Core Tools, Functions Framework ของ Google) รันมันบนเครื่องเราได้ แต่ permission, trigger, timeout และการ scale จะทำตัวตามจริงก็ต่อเมื่ออยู่ใน test environment ที่ deploy แล้วเท่านั้น
- **จำกัด lock-in** ด้วยการเก็บ business logic ไว้หลัง adapter บาง ๆ ที่แปล event ของ platform เป็น type ของเราเอง [CloudEvents](https://cloudevents.io/) ให้ event มีซองมาตรฐานร่วมกัน และการ package function เป็น container ก็ทำให้ยังย้ายไปที่อื่นได้

**ตัวอย่างจาก platform** (เช็กเมื่อตุลาคม 2026 รายละเอียดพวกนี้เปลี่ยนบ่อย):

- **AWS Lambda** หนึ่ง invocation ต่อหนึ่ง execution environment ใน compute type ตั้งต้น ส่วน Lambda Managed Instances รับได้หลายตัว แล้ว timeout สูงสุดคือ 15 นาที (90 นาทีสำหรับ invocation แบบ asynchronous และแบบ poll ส่วนใหญ่บน Managed Instances) ส่วน quota ตั้งต้นคือ 1,000 concurrent execution ต่อ Region และแต่ละ function เพิ่ม environment ได้ 1,000 ตัวทุก 10 วินาที invocation แบบ asynchronous ที่พังจะถูก retry สองครั้ง แล้ว event ก็ถูกทิ้ง เว้นแต่จะตั้ง dead-letter queue หรือ on-failure destination ไว้ คิดเงินต่อ request บวกระยะเวลาเป็นขั้นละ 1 ms และโค้ด initialisation ก็นับเป็นระยะเวลาด้วย
- **Azure Functions** instance หนึ่งตัวประมวลผลหลาย event พร้อมกัน โดยตั้ง concurrency แยกตาม trigger ส่วน Flex Consumption คือ plan ที่แนะนำสำหรับแอป serverless ใหม่ มัน scale to zero และ scale out ได้ถึง 1,000 instance คิดเงิน instance แบบ on-demand เฉพาะตอนที่รัน function และมี always-ready instance ให้ ส่วน Premium เก็บ instance ที่ warm ไว้ล่วงหน้า plan Consumption แบบเดิมตอนนี้เป็น legacy แล้ว และตัว Linux จะเลิกใช้วันที่ 30 กันยายน 2028 ส่วน timeout ตั้งต้นคือ 30 นาที และไม่มีเพดานบังคับบน Flex Consumption กับ Premium (บน Consumption คือ 5 นาที สูงสุด 10) และ HTTP trigger ต้องตอบภายใน 230 วินาที พฤติกรรม retry ขึ้นกับ trigger
- **Google Cloud** Cloud Functions ถูกเปลี่ยนชื่อเป็น Cloud Run functions และตอนนี้ function ก็ deploy เป็น Cloud Run service ตัว concurrency สูงสุดตั้งต้นของ Cloud Run คือ 80 request ต่อ instance (80 ต่อ vCPU ถ้า deploy ด้วย CLI) ปรับได้ถึง 1,000 ส่วน function รุ่น 1st gen รับทีละ request แล้ว request timeout ตั้งต้นคือ 5 นาที และเพิ่มได้ถึง 60 นาที ตัว service scale to zero เป็นค่าตั้งต้น instance ที่ว่างอยู่ต่อได้ถึง 15 นาที และ minimum instance ก็เก็บไว้ warm บางส่วน ด้าน billing แบบ request-based จะคิดเงิน instance ตอนที่มัน start, รับ request และ shut down
- **Kubernetes** Knative Serving scale revision ลงจนเหลือศูนย์ตอนไม่มี traffic และ scale กลับขึ้นมาเมื่อมี request ถัดไป KEDA scale workload ธรรมดาตาม event source อย่าง queue ลงไปได้จนถึงศูนย์ แต่เราก็ยังต้องรันและจ่ายเงินค่า cluster ข้างใต้อยู่ดี
