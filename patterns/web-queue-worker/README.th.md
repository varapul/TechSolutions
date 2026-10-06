## ปัญหา

web request มีงบ latency เป็นมิลลิวินาที แต่งานบางอย่างใช้เวลานานกว่านั้นมาก เช่น render PDF ที่พร้อมส่งพิมพ์ ย่อขนาดรูปเป็นพันรูป ทำรายงานประจำเดือน หรือรอ API ของ partner ที่ช้า ถ้าทำงานพวกนี้ใน request ผู้ใช้ก็ต้องรอ ส่วน thread กับ connection ก็กองพะเนินอยู่หลังการเรียกที่ช้า platform อาจตัด request ทิ้งด้วย เช่น [router ของ Heroku](https://devcenter.heroku.com/articles/request-timeout) จะยอมแพ้ถ้ายังไม่เริ่มส่ง response ภายใน 30 วินาที (error H12) แล้วกำลังในการ render ก็เพิ่มได้ทางเดียวคือเพิ่ม web server ที่ทุกตัวต้องตั้งขนาดไว้รับ job ที่หนักที่สุด การเปิด background thread ใน web process ก็แก้ไม่ได้เหมือนกัน งานจะตายไปพร้อมกับ instance และไม่มีอะไรห้าม instance ที่ยุ่งอยู่ไม่ให้รับงานเกินกว่าที่ทำไหว

## ทำงานยังไง

[Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/web-queue-worker) อธิบายสไตล์นี้ว่าเป็นสองบทบาทที่มี message queue คั่นกลาง

- **web front end** รับ request จาก client มัน validate input ทำการอ่านและเขียนง่าย ๆ เอง วาง message ลงใน **queue** สำหรับอะไรก็ตามที่ช้า แล้วตอบกลับทันที
- **worker** หยิบ message จาก queue ไปทำงานที่กิน resource เยอะ รันนาน หรือเป็น batch มันยังรันตามตารางเวลาได้ด้วย โดยไม่ต้องมี request ไหนมาเกี่ยว
- รอบ ๆ สองบทบาทนี้มี service ที่มักมากับสไตล์นี้ คือ **database** หนึ่งตัวหรือมากกว่า, **cache** สำหรับ hot read และ session state, **CDN** สำหรับไฟล์ static, **blob storage** สำหรับไฟล์, identity provider และ **remote service** อย่าง provider ของ email หรือ SMS

ทั้งสองบทบาทเป็นแบบ stateless อะไรที่ต้องอยู่นานกว่า instance (session, order, ไฟล์) ไปอยู่ใน store ที่ใช้ร่วมกัน นี่คือสิ่งที่ทำให้แต่ละบทบาท deploy, scale, เลือกขนาด และถูกแทนที่ได้เอง ส่วน queue ก็แยกสองบทบาทออกจากกันในแง่เวลา worker เลยช้ากว่า ยุ่งอยู่ หรือล่มไปสักพักได้ ในขณะที่ web tier ยังรับ order ต่อไป

| อยู่ใน request (web front end) | ส่งไปให้ worker |
|---|---|
| validation, authorization, การอ่านและเขียนง่าย ๆ | งานที่กิน CPU หรือ memory หนัก เช่น rendering, ประมวลผลรูปและวิดีโอ, archive |
| อะไรก็ตามที่ผู้ใช้ต้องเห็นใน response นี้ | การเรียก partner ที่ช้าหรือไม่น่าเชื่อถือ เช่น บริการพิมพ์, gateway ของ email และ SMS |
| บันทึก job แล้ววางลงใน queue | งานตามตารางเวลาและงาน batch เช่น clean-up, import, รายงาน |

ไม่ใช่ทุกอย่างต้องผ่าน queue คำแนะนำของ Azure บอกว่า front end จัดการการอ่านและเขียนง่าย ๆ เองได้ และ worker ก็ไม่จำเป็นถ้าแอปพลิเคชันไม่มีงานที่รันนาน

## ใช้ตอนไหนดี

- domain ที่ค่อนข้างเรียบง่าย แต่มี workflow ที่รันนานหรือ batch operation อยู่บ้าง เช่น ร้านที่ render photo book หรือแอป SaaS ที่ import spreadsheet และทำรายงานประจำเดือน
- ทีมที่ชอบใช้ managed platform service (App Service, Elastic Beanstalk, Cloud Run, Heroku) มากกว่ารัน infrastructure เอง
- งานที่ทำเสร็จหลัง response ได้ เพราะบอกผลให้ผู้ใช้รู้ทีหลังได้

ตอนไหนไม่ควรใช้:

- **ไม่มีงานช้าเลย** web application ธรรมดาง่ายกว่า ส่วน queue กับ deployable ตัวที่สองก็แค่เพิ่มชิ้นส่วนที่ต้องดูแล
- **domain ใหญ่และเปลี่ยนเร็ว** ถ้ามีหลายทีมและหลาย feature ทั้งสองบทบาทจะกลายเป็น codebase ใหญ่ที่ใช้ร่วมกัน ให้วางแผนไปทาง [modular monolith](../modular-monolith/) หรือ [microservices](../microservices/) แทน
- **ตัวเรียกต้องได้ผลลัพธ์ใน response เดียวกัน** queue ทำให้ request เร็วขึ้น แต่ไม่ได้ทำให้งานเร็วขึ้น

## ได้อะไร เสียอะไร

- **message คือสัญญาระหว่างสอง deployable** สองบทบาท release แยกกัน ตอน rolling deployment เวอร์ชันเก่าและใหม่ของแต่ละบทบาทเลยรันคู่กันอยู่ message ที่โค้ด web ตัวเก่าเขียนไว้ยังรออยู่ตอนที่ worker ตัวใหม่ start เพราะฉะนั้นให้ทำ version ของ message เลือกการเปลี่ยนแบบเพิ่มเข้าไป ให้ worker ข้าม field ที่มันไม่รู้จัก และเปลี่ยนหน้าตาของ message เป็นขั้น ๆ แบบ [expand-and-contract](../expand-and-contract/)
- **การส่งเป็นแบบ at least once** queue ซ่อน message ไว้ระหว่างที่ worker ประมวลผล และทำให้มันกลับมาให้เห็นอีกถ้า worker ไม่ลบมันทันเวลา ทำให้ crash ครั้งเดียวแปลว่า job รันสองรอบ เช่น ใน [Azure Functions บน Storage queue](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-storage-queue-trigger) ถ้า host crash ตัว message จะถูกซ่อนไว้ตาม timeout ตายตัว 10 นาทีของ storage service ก่อนจะโผล่กลับมา ทำ job ให้ [idempotent](../idempotent-consumer/) เขียนผลลัพธ์ด้วยชื่อที่กำหนดแน่นอน (`1043.pdf`) เปลี่ยน state ด้วย conditional update และส่ง order ID ไปเป็น idempotency key ให้ partner เพื่อให้การรันซ้ำไม่พิมพ์หนังสือสองเล่ม
- **Poison message** message ที่พังทุกครั้งต้องไม่วนไปตลอดกาล ให้จำกัดจำนวนครั้งที่ลอง แล้วจอดมันไว้ใน [dead-letter queue](../dead-letter-queue/) ค่าตั้งต้นของ Azure Functions คือย้าย message ของ Storage queue ไปที่ `<queue>-poison` หลังลองพลาดห้าครั้ง ส่วน worker environment ของ Elastic Beanstalk retry ได้ถึง `MaxRetries` ครั้ง (ค่าตั้งต้นคือ 10) ก่อนจะส่ง message ไป dead-letter
- **ช่องว่างของ dual write** web tier บันทึก order แล้วค่อยส่ง message ถ้าพังตรงกลางพอดี order ก็จะรอไปตลอดกาล คำแนะนำของ Azure ชี้ไปที่ [transactional outbox](../transactional-outbox/)
- **coupling ที่ซ่อนอยู่** ปกติสองบทบาทใช้ database schema เดียวกันและ code library ร่วมกัน column ที่เปลี่ยนชื่อเพื่อ worker ทำให้ web tier ที่ยังอ่านมันอยู่พัง เพราะฉะนั้นให้มองการเปลี่ยน schema เป็น migration แบบ expand-and-contract ด้วยเหมือนกัน
- **worker กลายเป็น monolith** ทุก feature เบื้องหลังที่เพิ่มเข้ามา (rendering, email, import, report) ไปลงที่ worker ตัวเดียวกัน ที่มี release cycle เดียวและ scaling setting เดียว import ที่ช้าเลยทำให้งาน render ค้างไปด้วยได้
- **ผลลัพธ์มาทีหลัง** ผู้ใช้ได้ข้อความ "กำลังเตรียม" ไม่ใช่ได้ PDF เพราะฉะนั้นทั้ง UI และ API ต้องมีวิธีรายงานความคืบหน้าและผลลัพธ์

## ข้อควรรู้ตอนลงมือทำ

- **บอกผลให้ผู้ใช้รู้** browser หรือ API client จะ poll status endpoint ([asynchronous request-reply](../asynchronous-request-reply/)) หรือฟังผ่าน WebSocket ก็ได้ ส่วนระบบอื่นรับ [webhook](../webhooks/) ได้ และคนก็ได้ email หรือ push notification
- **scale แต่ละบทบาทตามสัญญาณของตัวเอง** scale web tier ตาม request rate, CPU หรือ latency และ scale worker tier ตามความยาวของ queue [คำแนะนำเรื่อง EC2 Auto Scaling](https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-using-sqs-queue.html) ของ AWS ใช้ backlog ต่อ instance (ความยาวของ queue หารด้วยจำนวน instance ที่รันอยู่) แล้วเทียบกับปริมาณที่ instance หนึ่งตัวเคลียร์ได้ในเวลาที่รับได้ เลือกขนาดของสองบทบาทแยกกันด้วย คือ web ใช้ instance เล็ก ๆ ส่วน worker เน้น CPU ดู [autoscaling](../autoscaling/), [competing consumers](../competing-consumers/) และ [queue-based load leveling](../queue-based-load-leveling/)
- **job ด่วนมาก่อน** ให้ job ด่วน (ลูกค้าที่รออยู่หน้า checkout) มี queue และ worker ของตัวเอง เป็น [priority queue](../priority-queue/) เพื่อให้ import ตอนกลางคืนไม่ทำให้มันช้า
- **เก็บ state ไว้นอกบทบาท** เก็บ session กับ hot data ไว้ใน distributed cache ([cache-aside](../cache-aside/)) ส่วน [The Twelve-Factor App](https://12factor.net/processes) มองว่า sticky session เป็นการละเมิดกฎ และแนะนำ store ที่หมดอายุตามเวลาอย่าง Memcached หรือ Redis เสิร์ฟไฟล์ static จาก CDN ([CDN edge caching](../cdn-edge-caching/)) และส่งไฟล์อัปโหลดขนาดใหญ่ตรงไปที่ blob storage ด้วย signed URL อายุสั้น ([valet key](../valet-key/)) แทนที่จะส่งผ่าน web tier
- **ตัวอย่างจาก platform** (เช็กเมื่อตุลาคม 2026):
  - **Azure:** เวอร์ชัน App Service ของ Architecture Center ใช้ App Service web app เป็น front end และใช้ Azure Functions app เป็น worker แล้วเพิ่ม Service Bus หรือ Storage queue, Azure Managed Redis สำหรับ session state, CDN สำหรับไฟล์ static และ data store อีกหลายตัว มันยังแนะนำให้แยก App Service plan เพื่อให้สองบทบาท scale แยกกันได้ [WebJobs](https://learn.microsoft.com/en-us/azure/app-service/webjobs-create) รันโปรแกรมเบื้องหลังข้างใน App Service app จะรันต่อเนื่องหรือสั่งรันเองหรือตาม CRON schedule ก็ได้ แต่มันใช้ instance ร่วมกับแอปนั้น ถ้า worker ควร scale แยกจาก web tier ก็ให้ host มันไว้ในแอปของตัวเอง
  - **AWS:** worker environment ของ Elastic Beanstalk จัดการ Amazon SQS queue ให้และรัน daemon บนทุก instance แล้ว daemon จะ POST ทุก message ไปที่แอปพลิเคชันของเราบน `localhost` ถ้าตอบ `200 OK` message จะถูกลบ ถ้าตอบอย่างอื่น message จะกลับเข้า queue ไฟล์ `cron.yaml` ใช้เพิ่มงานที่รันเป็นรอบ ๆ ส่วน platform .NET on Windows Server ไม่รองรับ worker environment
  - **Google Cloud:** Cloud Tasks เข้า queue งานแล้วส่งแต่ละงานไปให้ HTTP handler บน Cloud Run, App Engine หรือ HTTP endpoint ไหนก็ได้ พร้อม rate limit และ retry การส่งเป็นแบบ at least once ทำให้ handler ต้อง idempotent
  - **Heroku:** `Procfile` ประกาศ process type `web` และ `worker` ที่ scale แยกกัน (`heroku ps:scale web=2 worker=4`) งานตามตารางเวลารันผ่าน Heroku Scheduler หรือ clock process แล้ว Heroku ก็[เปลี่ยนไปใช้โมเดล sustaining engineering](https://www.heroku.com/blog/an-update-on-heroku/) ในเดือนกุมภาพันธ์ 2026 คือยังได้รับการ support แต่ไม่มี feature ใหม่
  - **The Twelve-Factor App** ([VIII. Concurrency](https://12factor.net/concurrency)) ทำให้เรื่องนี้เป็น process model ทั่วไป web process รับ HTTP request ส่วน worker process รัน background job และชุดของ process type พร้อมจำนวนของแต่ละตัวเรียกว่า *process formation*
- **แบบ serverless** ทั้งสองบทบาทเป็น function ได้ คือ front end ที่ trigger ด้วย HTTP และ worker ที่ trigger ด้วย queue โดยที่ platform scale out ตัว worker ตาม backlog และบน plan แบบ consumption มันจะ scale กลับลงไปเหลือศูนย์ตอน queue ว่าง ดู [serverless](../serverless/)
- **ไปไกลกว่าสไตล์นี้** ถ้า worker โตจนกลายเป็นกองงานที่ไม่เกี่ยวกัน ให้แยกเป็นหนึ่ง queue กับหนึ่ง worker ต่อประเภท job โดยแต่ละคู่ deploy และ scale เอง ถ้าตัว domain โตเกินสไตล์นี้ ก็ย้ายไปเป็น module ที่มีขอบเขตชัดเจน ([modular monolith](../modular-monolith/)) หรือเป็น service ที่เป็นเจ้าของข้อมูลของตัวเอง ([microservices](../microservices/), [database per service](../database-per-service/))
