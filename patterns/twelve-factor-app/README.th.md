## ปัญหา

catalog service ของ Acme Shop คอย serve หน้าสินค้า, filter และรูปภาพให้ร้าน มันเคยรันอยู่บน **catalog-01** virtual machine ที่ทีม catalog สร้างเองด้วยมือ แล้วก็ patch ผ่าน SSH มาตลอด พอจะย้ายมันไปที่ Kubernetes cluster ที่ใช้ร่วมกันของ platform team ก็เห็นเลยว่า service นี้พึ่งเครื่องนี้เครื่องเดียวอยู่มากแค่ไหน:

- **Secret อยู่ในโค้ด** password ของ database production อยู่ใน `config/prod.yml` ใน Git ทำให้ทุกคนที่เข้า repository ได้อ่านมันได้ และมันก็ถูก copy เข้าไปในทุก build
- **Build แยกต่อ environment** staging กับ production ต่างก็ได้ build ของตัวเอง (#88 และ #91) ที่ฝัง configuration ไว้ข้างใน ทำให้ staging ไม่เคย test ของที่ production รันจริง
- **State อยู่บน server** session ของลูกค้า 1,800 คนที่ login อยู่เก็บอยู่ใน memory ของ process ส่วน log อยู่ใน `/var/log/catalog/app.log` แล้วก็โดน cron rotate ทิ้งไป จะอ่านทีก็ต้อง SSH เข้าไปแล้ว grep
- **ไม่มี instance ที่สอง** พอทีมเอา catalog-02 ไปไว้หลัง load balancer ลูกค้าคนไหนที่ request ถัดไปไปตกที่เครื่องนั้นก็ไม่มี session แล้วก็โดน logout
- **Operation ด้วยมือ** schema migration ต้องรันผ่าน SSH ด้วย `psql` ก่อน release และทางเดียวที่จะ scale ได้คือใช้ server ที่ใหญ่ขึ้น: catalog-01 โตจาก 8 เป็น 32 vCPU

ไม่มีข้อไหนเป็น bug ในโค้ด แต่ละข้อแค่ assume ว่า app จะรันอยู่บนเครื่องเดียวที่รู้จักตลอดไป และแต่ละข้อก็พังบน platform ที่ start ย้าย และ stop copy ของ app เองตามจังหวะของมัน (ตัวเลขของ Acme ในหน้านี้เป็นตัวเลขของตัวอย่างนี้เอง)

## ทำงานยังไง

**The Twelve-Factor App** คือ methodology สำหรับสร้าง app แบบ software-as-a-service ที่ deploy ไปบน cloud platform สมัยใหม่ตัวไหนก็ได้ และ scale out ได้โดยไม่ต้องเปลี่ยน tooling หรือ architecture มากนัก Adam Wiggins ผู้ร่วมก่อตั้ง Heroku เผยแพร่มันไว้ที่ 12factor.net ในปี 2011 โดยดึงจากสิ่งที่ทีม Heroku ได้เรียนรู้จาก app ที่พวกเขาสร้างเอง และจาก app อีกหลายแสนตัวที่ platform ของพวกเขารันอยู่ ส่วนเว็บนี้อัปเดตครั้งล่าสุดในปี 2017 ทีม maintainer ของ revision ปัจจุบันอธิบาย factor เหล่านี้ว่าเป็นสัญญาระหว่าง app กับ platform ที่มันรันอยู่: app ทำให้โค้ด dependency และพฤติกรรมของมันคาดเดาได้ แลกกับการที่ platform build, configure, start, scale และ stop มันได้โดยไม่ต้องรู้อะไรอื่นเกี่ยวกับมันเลย ชื่อ factor ข้างล่างเป็นชื่อของ 12factor.net ส่วนคำอธิบายเป็นการสรุปด้วยคำพูดของเราเอง

| Factor | ขอให้ทำอะไร | ใน catalog service ของ Acme |
|---|---|---|
| **I. Codebase** | หนึ่ง codebase ต่อหนึ่ง app อยู่ใน version control และ deploy หลายครั้ง ส่วนโค้ดที่หลาย app ใช้ร่วมกันก็แยกออกมาเป็น library | Git repository `catalog` ที่ทั้ง staging, production และ laptop ของ developer ต่างก็รัน build ของมัน |
| **II. Dependencies** | ประกาศทุก dependency ให้ชัด และแยก app ออกจากอะไรก็ตามที่บังเอิญติดตั้งอยู่บน host รวมถึง system tool ด้วย | ปัก version ไว้ใน `requirements.txt` แล้วติดตั้งเข้าไปใน container image โดยไม่คาดหวังว่าจะมีอะไรอยู่บน node |
| **III. Config** | เก็บทุกอย่างที่ต่างกันไปในแต่ละ deploy (credential, resource handle, hostname) ไว้นอกโค้ด ใน environment variable ที่จัดการแยกต่อ deploy | `DATABASE_URL`, `REDIS_URL`, `S3_BUCKET` และ `PORT` ที่ inject เข้ามาแยกต่อ environment จาก ConfigMap กับ Secret |
| **IV. Backing services** | มอง database, cache, queue และ API ของ third party เป็น attached resource ที่หาเจอผ่าน config ทำให้สลับตัวไหนก็ได้โดยไม่ต้องแก้โค้ด | PostgreSQL บน [Amazon RDS](../amazon-rds-aurora/), Redis และ S3 ที่แต่ละตัวเข้าถึงผ่าน URL ตอนย้ายจาก db01 ไป RDS ก็แค่เปลี่ยน `DATABASE_URL` |
| **V. Build, release, run** | แยกสาม stage ออกจากกัน: build เปลี่ยนโค้ดเป็น artifact, release เอา artifact นั้นมารวมกับ config ของ deploy หนึ่งภายใต้ ID ที่ไม่ซ้ำและไม่มีใครแก้มันอีก ส่วน run stage ก็ start process จาก release | `catalog:2.3.0` build แค่ครั้งเดียว ส่วน `v41-staging` กับ `v41-prod` ใส่ config ของแต่ละ environment เพิ่มเข้าไป และ setting ใหม่ก็แปลว่า release ใหม่คือ v42 |
| **VI. Processes** | รัน app เป็น process แบบ stateless ที่ไม่แชร์อะไรกันเลย อะไรที่ต้องอยู่นานกว่าหนึ่ง request ให้ไปอยู่ที่ backing service และห้ามใช้ sticky session | session อยู่ใน Redis โดยหมดอายุใน 30 นาที ส่วนรูปสินค้าอยู่ใน S3 |
| **VII. Port binding** | ทำ app ให้ครบในตัวเอง: มัน serve HTTP เองบน port ที่ได้รับมา แล้ว routing layer ที่อยู่ข้างหน้าก็ส่ง traffic มาให้ | web process listen อยู่บน `PORT` (8080) แล้ว Kubernetes Service ก็ map port 80 มาที่มัน |
| **VIII. Concurrency** | scale out ด้วยการรัน process เพิ่ม โดยมี process type สำหรับงานแต่ละแบบ และปล่อยให้ process manager ของ platform เป็นคนรันมัน | Deployment สองตัวจาก image เดียว: web ×6 สำหรับ HTTP และ worker ×2 สำหรับ background job |
| **IX. Disposability** | start ได้ในไม่กี่วินาที shut down อย่างเรียบร้อยเมื่อได้ SIGTERM และรอดได้แม้จะโดน kill แบบไม่มีการเตือน | pod พร้อมใช้ 2 s หลัง start พอได้ SIGTERM ตัว web pod จะทำ request ที่ค้างอยู่ให้เสร็จ ส่วน worker ก็คืน job ที่ยังไม่เสร็จกลับเข้า queue |
| **X. Dev/prod parity** | ทำให้ development, staging และ production ใกล้กัน: ช่วงเวลาระหว่างเขียนโค้ดกับ deploy สั้น คนที่เขียนกับคนที่รันเป็นคนเดียวกัน และใช้ tool กับ backing service ตัวเดียวกัน | developer รัน PostgreSQL 16 กับ Redis ใน container โดยเป็น version เดียวกับ production |
| **XI. Logs** | เขียน log เป็น stream ของ event แบบไม่ buffer ออก stdout แล้วปล่อยเรื่อง routing กับการเก็บให้ environment จัดการ | ทุก pod เขียนออก stdout แล้ว log agent บนทุก node ก็ส่ง stream ไปที่ log search |
| **XII. Admin processes** | รันงานครั้งเดียวอย่าง migration หรือ console เป็น process แยกบน release ตัวเดียวกัน ด้วยโค้ดและ config ชุดเดียวกัน | `migrate-v41` เป็น Kubernetes Job ที่รัน `alembic upgrade head` จาก `catalog:2.3.0` ด้วย config ของ v41-prod |

**Container กับ Kubernetes** ทำให้หลาย factor กลายเป็นค่า default ไปแล้ว ตัว container image คือ build artifact และพก dependency ของมันไปด้วย (II, V) แล้ว ConfigMap กับ Secret ก็ป้อน environment variable หรือไฟล์เข้าไปใน pod (III) process แต่ละ type กลายเป็น Deployment ที่มีจำนวน replica ของตัวเอง (VIII) และอยู่หลัง Service ที่ forward ไปที่ port ของ container (VII) ส่วน pod ก็ถูกออกแบบมาให้ทิ้งได้อยู่แล้ว: ตอนจะ stop pod หนึ่ง kubelet จะรัน preStop hook ถ้ามี ส่ง SIGTERM ไปที่ main process ของแต่ละ container แล้ว kill อะไรที่เหลืออยู่ตอนหมด grace period ที่ default อยู่ที่ 30 วินาที (IX) Kubernetes documentation บอกว่าการเขียนออก stdout และ stderr เป็นวิธีที่ง่ายที่สุดและใช้กันมากที่สุดที่ app ใน container จะเขียน log แล้ว agent ระดับ node ก็เก็บ stream พวกนั้นไป (XI) ส่วน Job ก็รันงานครั้งเดียวจนจบ (XII)

ยังมีสอง factor ที่ต้องอาศัยวินัย ข้อแรกคือ ConfigMap แก้ทับได้ ทำให้ configuration ของ release ที่รันอยู่เปลี่ยนไปแบบเงียบ ๆ และ pod ที่อ่านมันเป็น environment variable จะเห็นการเปลี่ยนแปลงก็ต่อเมื่อ restart ทีละตัว ส่วน ConfigMap ที่มี version และตั้งเป็น immutable (stable ตั้งแต่ Kubernetes 1.21) ทำให้แต่ละ release คงที่ (V) อีกข้อคือ Service ปักแต่ละ client ไว้กับ pod ตัวเดียวได้ด้วย `sessionAffinity: ClientIP` และนั่นก็คือ sticky session แบบเดียวกับที่ factor VI ห้ามไว้เป๊ะ ๆ

**ตั้งแต่ปี 2011** ตัว factor พวกนี้มีมาก่อน Docker และ Kubernetes และหลาย practice ก็เปลี่ยนไปแล้ว:

- **Secrets** ตอนนี้ environment variable ถูกมองว่าเป็นที่ที่อ่อนแอสำหรับเก็บ credential: ทุก process ใน container อ่านมันได้ child process ก็สืบทอดมันไป และมันก็โผล่ใน log และ system dump ด้วย ส่วน *Secrets Management Cheat Sheet* ของ OWASP ก็แนะนำว่าอย่าใช้มันถ้ามีทางอื่น ทีมต่าง ๆ mount secret เป็นไฟล์จาก manager อย่าง Vault หรือ AWS Secrets Manager หันไปใช้ credential อายุสั้น และให้แต่ละ workload มี identity ของตัวเองแทน key ที่แชร์กัน
- **Sidecars** พวก helper ที่รันข้าง app ใน pod เดียวกัน อย่าง log shipper และ service-mesh proxy รับงานที่ไม่อย่างนั้น app ต้องทำเองไปทำแทน แล้ว Kubernetes ก็ทำให้ native sidecar container เป็น stable ใน version 1.33
- **Observability** ตัว methodology ครอบคลุมแค่ log ส่วน metric กับ trace ทุกวันนี้เป็นสิ่งที่ production service ทุกตัวต้องมี
- **Beyond the Twelve-Factor App** หนังสือเล่มสั้นของ Kevin Hoffman (O'Reilly, 2016) กลับมาดูรายการนี้ใหม่สำหรับ cloud-native app และขยายเป็นสิบห้าข้อ โดยเพิ่ม *API first*, *telemetry* และ *authentication and authorization*
- **Revision แบบ open source** ในเดือนพฤศจิกายน 2024 ทาง Heroku เปิด text เป็น open source ภายใต้ license ของ Creative Commons แล้วกลุ่ม maintainer จาก Heroku และ Salesforce, AWS, Intuit และบริษัทอื่น ๆ ก็เริ่ม revise มันบน GitHub พวกเขาตั้งใจจะคงไว้ที่สิบสอง factor, เริ่มจาก app แบบ stateless ที่ขับเคลื่อนด้วย request ก่อน workload แบบอื่น และอัปเดตตัวอย่างให้ทันสมัย โดยมี observability และ security อยู่ในหัวข้อที่จะพูดถึง พอถึงมีนาคม 2025 ทุก factor บน branch `next` ของ repository ก็ถูกแยกเป็น concept, example และ guidance เรียบร้อย ส่วน ณ ตุลาคม 2026 ตัว revision ก็ยังไม่เสร็จ: proposal อย่าง factor สำหรับ workload identity ยังเปิดอยู่ และ 12factor.net ก็ยังแสดง text ของปี 2017

## ลงมือทำจริงยังไง

1. **ให้คะแนน app เทียบกับสิบสอง factor** แล้วแก้ข้อที่ทำให้รันสอง copy ไม่ได้ก่อน: config กับ secret, session, ไฟล์ในเครื่อง ส่วน 12factor.net ก็เสนอ test ง่าย ๆ สำหรับ config ไว้ว่า: เปิด repository เป็น public ตอนนี้เลยได้ไหม โดยไม่มี credential หลุดออกไปแม้แต่ตัวเดียว
2. **ย้าย configuration ไปไว้ใน environment** ไล่ list ทุก setting ที่ต่างกันในแต่ละ deploy อ่านแต่ละตัวจาก environment variable ตอน start-up และ fail fast พร้อม message ที่ชัดเจนเมื่อมีตัวไหนหายไปหรือผิดรูปแบบ ส่วน setting ที่ไม่เคยต่างกันระหว่าง deploy อย่าง route หรือวิธีต่อ module เข้าด้วยกัน ให้อยู่ในโค้ดต่อไป แล้วใส่ค่าแยกต่อ environment จาก ConfigMap กับ Secret หรือจาก [external configuration store](../external-configuration-store/)
3. **เอา secret ออกจาก Git และออกจาก variable ธรรมดา** rotate ทุก credential ที่เคยถูก commit เพราะมันยังอยู่ใน history แล้วเก็บ secret ไว้ใน manager อย่าง [Vault](../vault/) หรือ AWS Secrets Manager แล้ว mount เป็นไฟล์ หรือให้ workload มี identity ของตัวเอง จะได้ไม่ต้องใช้ static key เลย
4. **Build ครั้งเดียวแล้วให้ทุก release มี ID** ให้ pin dependency ไว้ใน lock file, build image เดียวต่อ version ใน CI แล้ว promote ด้วย digest (ดู [continuous delivery](../continuous-delivery/)) มอง image บวก config เป็น release: ตั้งชื่อ ConfigMap ให้มี version (`catalog-config-v41`) และตั้งเป็น immutable หรือใส่ hash ของ config ไว้ใน pod template เพื่อให้ config change rollout ออกไปเป็น release ใหม่ และ release ก่อนหน้าก็ยังอยู่ให้ rollback กลับไปได้
5. **ย้าย state ไปไว้ที่ backing service** ให้ session ไปอยู่ที่ [Redis](../redis/) โดยมี expiry ส่วนไฟล์ที่ upload ไปอยู่ที่ object storage อย่าง [Amazon S3](../amazon-s3/) แล้วมอง local disk และ memory เป็นแค่ที่ทดสำหรับ request เดียว และคาดไว้เลยว่าพอถึง request ถัดไปมันจะหายไปแล้ว
6. **ให้งานแต่ละแบบมี process type ของตัวเอง** รัน web กับ worker เป็น Deployment แยกกันจาก image เดียวกันแต่ใช้ command ต่างกัน โดย web process listen บน port ที่อยู่ใน `PORT` แล้ว scale แต่ละตัวตาม signal ของมันเอง เช่นด้วย HorizontalPodAutoscaler (ดู [autoscaling](../autoscaling/))
7. **ทำให้การ start และ stop มีต้นทุนต่ำ** ทำ start-up ให้เสร็จในไม่กี่วินาที และรายงานว่า ready ก็ต่อเมื่อ app พร้อม serve จริง ([health endpoint monitoring](../health-endpoint-monitoring/)) พอได้ SIGTERM ให้หยุดรับงานใหม่ ทำงานที่ค้างอยู่ให้เสร็จแล้ว exit และทำ job ให้เป็น idempotent เพื่อให้ job ที่ค้างครึ่ง ๆ กลาง ๆ เพราะ worker ตายไปรันซ้ำได้อย่างปลอดภัย Kubernetes เริ่ม shutdown พร้อมกับตอนที่เอา pod ออกจาก endpoint ของ Service ทำให้ยังมี request บางตัวมาถึงหลัง SIGTERM ได้ ส่วน sleep สั้น ๆ ใน preStop hook ก็ช่วยปิดช่องนี้ แล้วให้ใช้ exec form ของ `ENTRYPOINT` หรือ `CMD` เพื่อให้ตัว app เป็นคนรับ signal ไม่ใช่ shell
8. **ทำ development ให้ใกล้กับ production** รัน image ตัวเดียวกันในเครื่องด้วย Docker Compose คู่กับ PostgreSQL และ Redis ที่ major version เดียวกับ production แทนที่จะใช้ SQLite หรือตัวแทนแบบ in-memory
9. **เขียน log ออก stdout** หนึ่ง structured event ต่อบรรทัด แล้วให้ node agent อย่าง Fluent Bit ส่ง stream ไปที่ [centralized logging](../centralized-logging/) และห้ามเขียนไฟล์ log ไว้ใน container
10. **รัน admin task จาก release** ตัว migration คือ Kubernetes Job หรือ step ใน pipeline ที่ใช้ image และ config ของ release นั้น และรันครั้งเดียวต่อ release โดยไม่มีใครรันมันด้วย `kubectl exec` ใน pod ที่กำลัง serve อยู่ หรือผ่าน SSH

## อยู่ตรงไหนใน solution

- [Continuous delivery](../continuous-delivery/) พึ่ง factor V: artifact ตัวเดียวที่ build ครั้งเดียวแล้ว promote จาก stage หนึ่งไปอีก stage หนึ่งด้วย config ที่ต่างกัน
- [External configuration store](../external-configuration-store/) เก็บค่าของ factor III ตอนที่ environment variable อย่างเดียวเริ่มจัดการยาก: เป็นที่เดียวที่มี version และ audit ได้ และอ่านตอน start-up ส่วน [Vault](../vault/) หรือ secrets manager ของ cloud ก็เก็บ secret และออก database credential อายุสั้นให้ได้
- [Immutable infrastructure](../immutable-infrastructure/) เอาแนวคิดเดียวกันไปใช้กับเครื่อง: อย่า patch server ที่รันอยู่ ให้แทนที่มันไปเลย
- image ของ [Docker](../docker/) พก dependency และ build ไว้ (II, V) ส่วน [Kubernetes](../kubernetes/) ก็มี ConfigMap, Secret, Deployment, Service และ Job ที่ implement III, VII, VIII และ XII
- [Redis](../redis/) เป็นที่ที่ใช้กันทั่วไปสำหรับ session ที่ factor VI ย้ายออกมาจาก process ส่วน [PostgreSQL](../postgresql/) กับ [Amazon S3](../amazon-s3/) เป็น attached resource ตัวอื่น ๆ ในตัวอย่างนี้
- [Health endpoint monitoring](../health-endpoint-monitoring/) ให้ readiness check กับ liveness check ที่ทำให้ disposability ปลอดภัย และ [autoscaling](../autoscaling/) ก็ต่อยอดจาก factor VIII
- [Centralized logging](../centralized-logging/) คืออีกครึ่งหนึ่งของ factor XI: app เขียน stream ส่วน platform รวบรวม ทำ index และเก็บมันไว้ แล้ว [telemetry pipeline](../telemetry-pipeline/) กับ [distributed tracing](../distributed-tracing/) ก็เติม metric และ trace ที่สิบสอง factor ไม่ได้พูดถึง
- pattern [sidecar](../sidecar/) รัน helper อย่าง log shipper และ proxy ไว้ข้าง ๆ app
- ใน platform team ตัว [golden paths](../golden-paths/) กับ [infrastructure as code](../infrastructure-as-code/) (หน้าอื่นในหมวดนี้) ฝัง factor พวกนี้ไว้ใน template ที่ทุก service ใหม่ใช้เป็นจุดเริ่มต้น

## ใช้ตอนไหนดี

factor พวกนี้คุ้มกับงานที่มันถูกเขียนขึ้นมาให้: web app, API และ background worker ที่รันเป็นหลาย copy เหมือน ๆ กันบน platform ที่ start และ stop มันเอง ไม่ว่าจะเป็น Kubernetes, platform อย่าง Heroku หรือ Google Cloud Run หรือ virtual machine หลัง load balancer ส่วนใน service ใหม่ factor ส่วนใหญ่มีต้นทุนไม่มาก และมันทำให้ทุกขั้นหลังจากนั้น ตั้งแต่ continuous delivery ไปจนถึง autoscaling ง่ายขึ้น

ส่วนที่อื่นต้องปรับ:

- **Database, message broker และระบบ stateful อื่น ๆ** เป็น backing service ใน model นี้ ไม่ใช่ twelve-factor app พวกมันต้องมี identity กับ storage ที่คงที่ ต้อง upgrade อย่างระมัดระวังและต้องมี backup: ใช้ StatefulSet, operator หรือ managed service
- **Batch job และ data pipeline** ได้ประโยชน์จาก config ใน environment, log บน stdout และการ build ครั้งเดียว แต่ job ที่รันเป็นชั่วโมงทิ้งไม่ได้ง่าย ๆ เลยให้ออกแบบให้มัน checkpoint แล้ว resume ต่อได้แทน
- **Connection ที่อยู่นาน** อย่าง WebSocket และ stream ทำให้ shutdown แบบเร็วและเรียบร้อยยากขึ้น: client ต้อง reconnect และการ drain อาจใช้เวลานานกว่า grace period ที่เป็น default
- **Legacy app** รับ factor มาใช้ทีละข้อได้ ตามลำดับขั้นข้างบน และข้อที่ทำให้รัน copy ที่สองได้สำคัญที่สุด
- **Software บน desktop, mobile และ embedded** ไม่ได้ deploy เป็น service และ factor ส่วนใหญ่ก็ใช้ไม่ได้

## กับดักที่เจอบ่อย

- **Secret ใน environment variable ธรรมดา** ทุก process ใน container อ่านมันได้ และมันรั่วไปอยู่ใน crash report, debug page และ system dump ให้ mount secret เป็นไฟล์จาก secrets manager กันมันไว้นอก log และ error page แล้วก็ rotate มัน
- **Config บานปลาย** variable เป็นร้อยตัวที่ชื่อไม่ชัดและไม่มีค่า default ทำให้ทุก deploy กลายเป็นการเดา ให้ใส่ไว้ใน environment แค่สิ่งที่ต่างกันระหว่าง deploy จริง ๆ validate มันตอน start-up เขียนอธิบายแต่ละ variable ไว้ข้างโค้ดที่อ่านมัน และเก็บ setting ภายในไว้ในโค้ด
- **อ่าน "stateless" ว่า "ไม่มี state ที่ไหนเลย"** process เป็น stateless แต่ทั้งระบบไม่ได้ stateless ตัว state ย้ายไปอยู่ที่ backing service แล้ว backing service ก็ต้องมี design ของตัวเองเรื่อง backup, replication และ capacity
- **ไฟล์และ cache ในเครื่องที่หายไป** cache ใน memory หรือไฟล์บน disk ของ container หายไปทุกครั้งที่ restart, deploy หรือย้าย และต่างกันไปในแต่ละ pod เลยให้ใช้ local storage แค่เป็นที่ทดต่อ request หรือเป็น cache ที่เริ่มแบบ cold ได้ และเก็บอะไรที่ต้องแชร์ไว้ใน Redis หรือ object storage
- **แก้ config ทับของเดิม** การเปลี่ยน ConfigMap หรือ variable ของ deployment ที่รันอยู่ทำให้เกิด release ที่ไม่มีใครบันทึกไว้ และ pod จะเห็นมันก็ต่อเมื่อ restart ให้ทำทุก change เป็น release ใหม่แทน ด้วย ConfigMap ที่มี version และเป็น immutable หรือด้วย config hash ใน pod template
- **ไม่สนใจ SIGTERM** ถ้า shell เป็น main process ของ container อย่างตอนใช้ shell form ของ `ENTRYPOINT` ตัว signal จะไม่เคยไปถึง app แล้ว app ก็โดน kill ตอนหมด grace period ทั้งที่ยังมี request ค้างอยู่ ให้ใช้ exec form และจัดการ signal
- **ใช้เป็น checklist กับทุกอย่าง** การบังคับให้ database, broker หรือ batch job ทำตามสิบสอง factor ให้ได้ setup ที่เปราะบาง ให้ใช้ factor ที่เข้ากัน อย่าง config, log และการ build ครั้งเดียว แล้วใช้เครื่องมือที่ถูกต้องกับส่วนที่เหลือ
- **หยุดอยู่แค่ log** สิบสอง factor ไม่ได้พูดถึง metric, trace, identity หรือ security เลย ให้เพิ่ม telemetry และ authentication อย่างตั้งใจ ส่วนสิบห้า factor ของ *Beyond the Twelve-Factor App* ก็เป็น checklist ที่มีประโยชน์
