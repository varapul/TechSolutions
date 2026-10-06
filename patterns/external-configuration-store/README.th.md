## ปัญหา

แอปพลิเคชันส่วนใหญ่เริ่มต้นด้วยการเก็บการตั้งค่าไว้ในไฟล์ที่มากับโค้ด: `appsettings.json`, `application.yml` หรือไฟล์ `.env` ที่ถูกคัดลอกเข้าไปใน image แบบนี้ใช้ได้ถ้ามี environment เดียว แต่พอมีตั้งแต่สองตัวขึ้นไปก็เริ่มเจ็บ

- **หนึ่ง build ต่อหนึ่ง environment** staging กับ production ต้องใช้ database host, ขนาด pool และรหัสผ่านต่างกัน pipeline เลยผลิต `57-staging` กับ `57-prod` ออกมา สองตัวนี้คือ artifact สองชิ้นที่เทสต์แยกกัน และตัวที่รันใน production ก็ไม่ใช่ตัวที่ผ่านเทสต์ใน staging
- **ทุกการเปลี่ยนคือ release** จะเพิ่มค่า timeout ระหว่าง incident ก็ต้องแก้ไฟล์ rebuild รอ pipeline แล้ว redeploy ทุก instance บทความเรื่อง pattern นี้ของ Azure Architecture Center ก็พูดไว้แบบเดียวกัน: ถ้า configuration มากับ package การเปลี่ยนมันก็คือการ redeploy แอปพลิเคชัน พร้อม downtime และแรงที่ต้องใช้ตามมา
- **Secret อยู่ทุกที่** รหัสผ่านอยู่ใน repository และประวัติของมัน ในทุก image ใน registry, ใน image cache ของทุก node และในทุก backup ของพวกนั้น ใครที่ pull image ได้ก็อ่านมันได้ และการเปลี่ยนรหัสผ่านก็เป็นอีกหนึ่ง release
- **Instance เห็นไม่ตรงกัน** ระหว่าง rollout บาง instance รันการตั้งค่าเก่า บางตัวรันการตั้งค่าใหม่ และไม่มีใครบอกได้ในแวบเดียวว่าค่าไหน live อยู่ที่ไหน หรือใครเป็นคนตั้ง
- **ไม่มีอะไรใช้ร่วมกัน** service ที่ต้องใช้ queue URL หรือ limit เดียวกันต่างก็เก็บสำเนาของตัวเอง แล้วสำเนาพวกนั้นก็ค่อย ๆ ไม่ตรงกัน

## ทำงานยังไง

เอา configuration ออกจาก deployment package ไปไว้ใน store ที่สร้างมาเพื่อมันโดยเฉพาะ แล้วให้แอปพลิเคชันอ่านตอน runtime

1. **Artifact เดียวสำหรับทุก environment** pipeline build image ตัวเดียวคือ build 57 แล้ว promote จาก staging ไป production โดยไม่เปลี่ยนอะไร ไม่มีอะไรที่ต่างกันระหว่าง environment ถูก bake ลงไปในนั้น นี่คือกฎเดียวกับใน [immutable infrastructure](../immutable-infrastructure/): byte ที่คุณเทสต์ก็คือ byte ที่คุณรัน
2. **การตั้งค่าอยู่ใน configuration store** จัดตาม key และตาม environment ในแอนิเมชัน key เดียวกันเก็บค่าหนึ่งไว้ใต้ label `staging` และอีกค่าใต้ `production` แต่ละ instance รู้แค่ว่าตัวเองอยู่ environment ไหน (จาก platform ปกติเป็น environment variable) แล้วอ่านค่าของ environment นั้นตอนเริ่มทำงาน
3. **Secret อยู่ใน secret store** ไม่ได้อยู่ใน configuration store ส่วนตัว configuration store ก็เก็บอย่างมากแค่ reference ที่ชี้ไปหา secret แล้วแอปพลิเคชันก็ไปอ่านตัว secret เองจาก secret store
4. **Instance sign in ในนามตัวเอง** แต่ละ workload อ่านทั้งสอง store ด้วย identity ที่ platform ให้มา (managed identity, IAM role, Kubernetes service account) เลยไม่มี bootstrap password ที่ต้องซ่อน ส่วน [OAuth 2.0 client credentials](../oauth2-client-credentials/) แสดงให้เห็นว่า workload identity แบบนี้มาแทน client secret ที่เก็บไว้ได้ยังไง
5. **การเปลี่ยนทำใน store ไม่ได้ทำในโค้ด** ทุกการเปลี่ยนกลายเป็นเวอร์ชันใหม่ที่บันทึกว่าใครทำและทำเมื่อไร instance ที่รันอยู่รับไปใช้ในไม่กี่วินาทีหรือในรอบ refresh ถัดไป และการ rollback ก็คือการกู้เวอร์ชันก่อนหน้ากลับมา
6. **แต่ละ instance เก็บสำเนาไว้ในเครื่อง** เป็น configuration ชุดล่าสุดที่โหลดสำเร็จ มันเลยยังทำงานต่อได้ และถึงขั้นเริ่มทำงานใหม่ได้ด้วย ตอนที่ติดต่อ store ไม่ได้

### อะไรนับเป็น configuration

*The Twelve-Factor App* (factor III, Config) ขีดเส้นไว้ configuration คืออะไรก็ตามที่น่าจะต่างกันในแต่ละ deploy ของโค้ดชุดเดียวกัน: handle ไปหา database และ backing service อื่น ๆ, credential ของ service ภายนอก และค่าอย่าง hostname ของ deploy นั้น ๆ ส่วนการเชื่อมต่อที่เหมือนกันทุก deploy อย่าง route table ของ framework หรือการต่อ module เข้าหากัน ไม่ใช่ configuration ในความหมายนี้ และควรอยู่ในโค้ด บททดสอบของมันคือ: วันนี้คุณเผยแพร่ codebase ออกไปได้ไหม โดยไม่ทำ credential หลุดแม้แต่ตัวเดียว

twelve-factor เก็บ configuration ไว้ใน **environment variable** มันเปลี่ยนได้ในแต่ละ deploy โดยไม่ต้องแก้โค้ด มีโอกาสถูก commit โดยไม่ตั้งใจน้อยกว่าไฟล์ config และทุกภาษาทุกระบบปฏิบัติการก็อ่านมันได้ twelve-factor ยังแนะนำไม่ให้มัดการตั้งค่ารวมกันเป็น environment ที่มีชื่อ อย่าง `development`, `test` และ `production` ของ Rails เพราะมัดพวกนี้จะงอกเพิ่มตามจำนวน deploy ที่เพิ่มขึ้น ตัวแปรแต่ละตัวควรเป็นการตั้งค่าที่เป็นอิสระต่อกัน

store กลางไม่ได้ขัดกับเรื่องนี้ มันยังกัน configuration ออกจากโค้ดอย่างเคร่งครัดไม่แพ้กัน แต่เอาไปไว้ในที่ที่มีประวัติ, access control และเครื่องมือ ทีมส่วนใหญ่ใช้สองแบบรวมกัน: platform ฉีด environment variable ให้ไม่กี่ตัว (นี่คือ environment ไหน, store อยู่ที่ไหน, ใช้ identity ตัวไหน) แล้วแอปพลิเคชันก็อ่านที่เหลือทั้งหมดจาก store ส่วน environment ที่มีชื่อก็กลับมาใน store ในรูปของ label หรือ path และก็ไม่เป็นไร ตราบใดที่แต่ละค่ายังตั้งแยกได้

### Environment variable, ไฟล์ และ store กลาง

| | Environment variable | ไฟล์ที่ bake ไว้ใน image | Store กลาง |
|---|---|---|---|
| **Artifact เดียวกันทุกที่** | ใช่ | ไม่: หนึ่ง build ต่อหนึ่ง environment | ใช่ |
| **เปลี่ยนได้โดยไม่ต้อง redeploy** | ไม่: อ่านครั้งเดียวตอน process เริ่ม | ไม่ | ได้: poll, watch หรือ push |
| **ประวัติและ audit** | มีแค่ในเครื่องมือ deploy | ประวัติ Git ของไฟล์ | เวอร์ชันพร้อมว่าใคร อะไร เมื่อไร |
| **Access control** | ใครก็ได้ที่ deploy ได้ | ใครก็ได้ที่อ่าน repository หรือ pull image ได้ | แยกตาม key หรือตาม path |
| **Validation และการปล่อยทีละขั้น** | อยู่ใน pipeline ของคุณ | อยู่ใน pipeline ของคุณ | บาง store มีมาในตัว |
| **Secret** | ทำได้ แต่ OWASP เตือนว่าโดยทั่วไป process อื่นอ่านมันได้ และอาจไปโผล่ใน log และ crash dump | ไม่ได้ | เป็น reference ไปที่ secret store |
| **Runtime dependency** | ไม่มี | ไม่มี | ตัว store เว้นแต่แอปพลิเคชันจะ cache ไว้ |

Kubernetes อยู่ตรงกลาง ตัว ConfigMap กันการตั้งค่าออกจาก image ได้ แต่ environment variable ที่เอามาจาก ConfigMap จะไม่มีวันเปลี่ยนใน container ที่รันอยู่: pod ต้อง restart ส่วนถ้า mount ConfigMap เป็น volume ไฟล์จะถูกอัปเดตในที่สุด (หลัง sync period ของ kubelet บวก cache delay ของมัน) ยกเว้น mount แบบ `subPath` ที่ไม่เคยเห็นการอัปเดตเลย และแอปพลิเคชันก็ยังต้องอ่านไฟล์ใหม่เองอยู่ดี

### จัดระเบียบ key

- **ตาม environment** store ต้องมีวิธีเก็บ key เดียวกันให้มีค่าต่างกันในแต่ละ environment อย่าง Azure App Configuration ก็ใช้ **label** สำหรับเรื่องนี้ ก็คือคอลัมน์ `staging` และ `production` ในแอนิเมชัน และให้แอปพลิเคชันโหลดค่า default ที่ไม่มี label ก่อน แล้วค่อยโหลดค่าที่มี label มาทับ ส่วน AWS AppConfig จัด configuration ตาม application, environment และ configuration profile แล้ว Parameter Store ก็ใช้ path อย่าง `/myapp/prod/db/host` และ IAM policy ก็ให้สิทธิ์ role กับ `/myapp/prod/*` แต่ไม่ให้ `/myapp/dev/*` ได้ ส่วนใน Spring Cloud Config ตัวไฟล์ถูกตั้งชื่อตาม application และ profile และ `{label}` ของมันก็คือ Git branch, tag หรือ commit
- **ตาม region และ tenant** เฉพาะที่ค่าต่างกันจริง ๆ: มิติ region สำหรับ endpoint ของแต่ละ region และ key ของ tenant สำหรับ limit ของลูกค้าแต่ละราย ทุกมิติจะคูณจำนวน combination ที่ต้องมีคนเข้าใจและเทสต์
- **ตามเจ้าของ** ใส่ชื่อ service หรือทีมที่เป็นเจ้าของไว้ใน prefix ของ key (`payments/…`) แบบนี้ access policy, การ review และ alert จะได้ตามความเป็นเจ้าของไปด้วย และไม่มีใครต้องถือ key ที่ไม่มีเจ้าของ
- **ตั้งชื่อ key ให้นิ่ง** โค้ดอ้างถึง key ด้วยชื่อ การเปลี่ยนชื่อ key เลยเป็นการแก้โค้ด อย่าง provider ของ Azure ตัด prefix ออกได้ตอนโหลด key ทำให้โค้ดไม่ต้องพิมพ์ prefix ซ้ำ

### ส่งการเปลี่ยนแปลงไปถึง instance ที่รันอยู่

ค่าใหม่ใน store ไม่มีผลอะไรเลยจนกว่าแอปพลิเคชันจะอ่านมันอีกรอบ เรียงจากง่ายสุดไปถึงซับซ้อนสุด

- **อ่านครั้งเดียวตอนเริ่ม** ง่ายและสม่ำเสมอ แต่ทุกการเปลี่ยนต้อง restart ก็เท่ากับ rolling deploy ที่ไม่มี build ใหม่ ค่าที่ platform ฉีดให้ทำงานแบบนี้: Amazon ECS resolve environment variable จาก Parameter Store ตอน task เริ่ม และ task ที่รันอยู่ต้องมี deployment ใหม่ถึงจะเห็นการเปลี่ยนแปลง
- **Polling** client ถามหาการเปลี่ยนแปลงตาม interval แล้ว reload ส่วนที่เปลี่ยน ตัว provider ของ Azure App Configuration เช็กไม่บ่อยกว่าทุก 30 วินาทีเป็น default และใน ASP.NET Core จะเช็กเฉพาะตอนที่มี request เข้ามา ส่วน AWS AppConfig Agent poll ทุก 45 วินาทีเป็น default การ poll เสีย request และเพิ่ม delay ได้สูงสุดหนึ่ง interval เพราะฉะนั้นค่าที่นาน ๆ เปลี่ยนทีก็ให้ยืด interval ออกไป
- **Sentinel key** client เฝ้าดู key ตัวเดียว แล้ว reload ทุกอย่างเมื่อ key นั้นเปลี่ยน เขียนการเปลี่ยนแปลงที่เกี่ยวข้องทั้งหมดก่อน แล้วค่อยเพิ่มค่า sentinel เป็นอย่างสุดท้าย จะได้ไม่มี instance ไหนโหลดการอัปเดตไปแค่ครึ่งเดียว Azure App Configuration รองรับทั้งแบบนี้และแบบเฝ้าดูทุก key ที่เลือกไว้
- **Push notification** store publish event เมื่อค่าเปลี่ยน แล้ว instance ก็ refresh เมื่อได้รับ event ตัว Azure App Configuration publish ผ่าน Event Grid ส่วน Parameter Store ผ่าน Amazon EventBridge และ Spring Cloud Config แปลง Git webhook ที่ endpoint `/monitor` ของมันให้เป็นการ broadcast สั่ง refresh ผ่าน Spring Cloud Bus ให้กระจายการ refresh ออกไป: หลังได้ notification ตัว .NET provider ของ Azure จะรอ delay แบบสุ่มนานสุด 30 วินาทีเป็น default เพื่อไม่ให้ instance เป็นพัน ๆ ตัวยิงเข้า store พร้อมกัน และให้มี poll ช้า ๆ ไว้ด้วย เผื่อ notification หาย
- **Agent ข้างแอปพลิเคชัน** [sidecar](../sidecar/) หรือ host agent ทำหน้าที่ดึงค่า cache และ authentication ให้ แล้วแอปพลิเคชันก็อ่านไฟล์ในเครื่องหรือ HTTP endpoint ในเครื่อง อย่าง AWS AppConfig Agent ก็เสิร์ฟ configuration จาก cache ของมันที่ `localhost:2772` ส่วน Vault Agent และ Consul Template render ค่าลงไฟล์ และรันคำสั่งอย่าง reload ได้เมื่อ output เปลี่ยน ส่วน Azure App Configuration Kubernetes provider เขียน ConfigMap และ Secret ให้ pod ใช้โดยไม่ต้องแก้โค้ด

แอปพลิเคชันยังต้องนำค่าใหม่ไปใช้เองด้วย framework ช่วยได้: Spring สร้าง bean ที่เป็น `@RefreshScope` ใหม่หลัง refresh และใน ASP.NET Core ตัว `IOptionsSnapshot<T>` เห็นค่าที่ reload แล้ว ในขณะที่ `IOptions<T>` ไม่เห็น การตั้งค่าบางตัวเปลี่ยนสด ๆ ไม่ได้เลย เพราะถูกอ่านครั้งเดียวตอนเริ่ม: ขนาด connection pool, port ที่ listen, จำนวน thread ตัว key พวกนี้ให้ติดป้ายว่า **ต้อง restart** อย่าง `db.pool.size` ในแอนิเมชัน และไล่ restart ทีละ instance เมื่อมันเปลี่ยน

### เวอร์ชัน snapshot และ audit

ให้มองทุกการเปลี่ยนเป็น release ที่คุณอาจต้องย้อนกลับ

- **เวอร์ชัน** Parameter Store เก็บ 100 เวอร์ชันล่าสุดของแต่ละ parameter ส่วน Azure App Configuration บันทึกทุกการเปลี่ยนของ key-value เก็บประวัตินั้นไว้ 7 วันใน tier Free และ Developer และ 30 วันใน Standard และ Premium และกู้ทั้ง store หรือ key ตัวเดียวกลับไปที่จุดเวลาหนึ่งได้ ส่วน AWS AppConfig deploy configuration เป็นเวอร์ชันที่ระบุชัด เลยรู้เสมอว่าเวอร์ชันไหน live อยู่
- **Snapshot** snapshot ของ Azure App Configuration คือชุด key-value ที่มีชื่อและเป็น immutable เลือกด้วย filter ของ key และ label ตัวแอปพลิเคชันโหลด snapshot ตามชื่อได้: การย้ายไป snapshot ถัดไปคือ release และการย้ายกลับไปตัวล่าสุดที่รู้ว่าดีคือ rollback
- **Audit** บันทึกว่าใครอ่านและใครเปลี่ยน key ไหน เมื่อไร คำแนะนำของ Azure Architecture Center ขอให้มี audit log ทั้งการอ่านและการเขียน ส่งมันไปที่เดียวกับ log อื่น ๆ ของคุณ ([centralized logging](../centralized-logging/)) เพราะ "อะไรเปลี่ยนไปก่อนเกิด incident" คือหนึ่งในคำถามแรก ๆ ของทุก incident review ส่วนเวอร์ชันของ configuration ที่แต่ละ instance รันอยู่ ก็บันทึกไว้ด้วย

### Deploy configuration อย่างปลอดภัย

การเปลี่ยน configuration ไปถึงทุก instance เร็วกว่าการเปลี่ยนโค้ด นี่คือจุดประสงค์ของ pattern นี้และก็เป็นอันตรายหลักของมันด้วย งานวิจัยใน SOSP 2015 ที่ศึกษา incident ร้ายแรงช่วงสามเดือนของ Facebook พบว่า 16% เกี่ยวกับ configuration management ส่วนเมื่อวันที่ 18 พฤศจิกายน 2025 มี feature file ของ Cloudflare สำหรับ bot management ที่ถูก generate ใหม่พร้อมแถวซ้ำหลังการเปลี่ยนสิทธิ์ใน database แล้วไฟล์นี้ก็ใหญ่ขึ้นราวสองเท่า มันไปถึงทั้ง network ในไม่กี่นาที เกิน limit ใน software ของ proxy และทำให้ระบบล่มเป็นวงกว้างราวสามชั่วโมง สิ่งที่ Cloudflare ทำต่อจากนั้นรวมถึงการระแวงไฟล์ที่ตัวเอง generate เองให้เท่ากับ input จาก user

ปล่อย configuration แบบเดียวกับที่ปล่อยโค้ด

- **Validate ก่อน live** เช็ก type, ช่วงของค่า และกฎที่ข้ามหลาย key ด้วย schema หรือ function ฝั่ง AWS AppConfig รัน validator แบบ JSON Schema หรือ Lambda ตอนที่ deployment เริ่ม และถ้าตัวไหนไม่ผ่าน deployment ก็หยุดก่อนที่ target ไหนจะเห็นการเปลี่ยนแปลง ในระบบที่ Facebook อธิบายไว้ในปี 2015 ตัว configuration compiler รัน validator กับทุกการเปลี่ยน
- **Review มัน** pull request บน configuration repository หรือขั้นอนุมัติใน store จับความผิดพลาดที่ schema ปล่อยผ่านได้
- **ทยอยปล่อย** เหมือน [canary release](../canary-release/): staging ก่อน แล้วค่อย production ส่วนเล็ก ๆ แล้วค่อยที่เหลือ โดยดู error rate ทุกขั้น ส่วน deployment strategy ของ AWS AppConfig ทำแบบนี้เป็นขั้นแบบ linear หรือ exponential ในช่วงเวลาที่กำหนด ตามด้วย bake time โดย strategy ที่ AWS แนะนำสำหรับ production คือ `AppConfig.Linear20PercentEvery6Minutes` ที่เพิ่ม target ทีละ 20% ทุกหกนาทีเป็นเวลา 30 นาที แล้วเฝ้าดู alarm ต่ออีก 30 นาที ส่วนกับ Azure App Configuration ไอเดียเดียวกันก็ประกอบขึ้นจาก snapshot: build และเทสต์ snapshot แล้วค่อย ๆ ย้าย instance ไปใช้มันทีละขั้น
- **Rollback อัตโนมัติ** ถ้า CloudWatch alarm ที่ผูกกับ environment เข้าสถานะ alarm (หรือรายงานว่าข้อมูลไม่พอ) ระหว่าง deployment ของ AWS AppConfig ตัว AppConfig จะ rollback configuration กลับไปเวอร์ชันก่อนหน้า ส่วน canary service ของ Facebook ในงานวิจัยเดียวกันก็ปล่อยการเปลี่ยนเป็นช่วง ๆ และ rollback เองเมื่อ health check ไม่ผ่าน
- **อย่าแก้ production ด้วยมือ** คำแนะนำเรื่อง App Configuration ของ Azure ให้เลี่ยงการแก้ production ตรง ๆ เช่นจาก portal เก็บทาง break-glass ไว้สำหรับ incident และบันทึกทุกครั้งที่ใช้

### ตอนที่ store ล่ม

ตอนนี้ store เป็น runtime dependency ของทุก service ที่อ่านมันแล้ว วางแผนเผื่อตอนมันพังด้วย

- **Cache ไว้ใน memory** และเสิร์ฟค่าล่าสุดต่อไปเมื่อ refresh ไม่สำเร็จ อย่าง provider ของ Azure สำหรับ ASP.NET Core ก็ใช้ configuration ที่ cache ไว้ต่อเมื่อเช็กการเปลี่ยนไม่สำเร็จ แล้วลองใหม่ทีหลัง
- **เก็บสำเนา last known good ไว้นอก process** instance จะได้เริ่มทำงานได้ด้วยตอนที่ติดต่อ store ไม่ได้ ตัว AWS AppConfig Agent บันทึก backup ของแต่ละ configuration ไว้ใน directory (`BACKUP_DIRECTORY`) ได้ และจะโหลดมันเมื่อติดต่อ service ไม่ได้ ใน Configerator ของ Facebook มี proxy บนทุก server เก็บ configuration ไว้ใน cache บนดิสก์ และแอปพลิเคชันอ่าน cache นั้นตรง ๆ ถ้าตัว proxy เองพัง ส่วน Azure Architecture Center ชี้ว่า cache ใน memory ไม่ช่วย instance ที่เริ่มทำงานระหว่างระบบล่ม และแนะนำให้ส่งค่าล่าสุดที่รู้ไปพร้อม deployment สำหรับกรณีนั้น สำเนาบนดิสก์ปกติไม่ได้เข้ารหัส เพราะฉะนั้นอย่าให้มี secret อยู่ในนั้น หรือไม่ก็ล็อกไฟล์ให้แน่น
- **ตัดสินใจว่าจะเกิดอะไรขึ้นถ้าไม่มี configuration เลย** จะ fail fast พร้อม error ที่ชัดเจนและ readiness check ที่ไม่ผ่าน หรือจะเริ่มด้วยค่า default ที่ปลอดภัยก็ได้ แต่ห้ามเริ่มทำงานทั้งที่ตั้งค่าได้แค่ครึ่งเดียวโดยไม่บอกใคร อย่าง client ของ Spring Cloud Config จะเริ่มทำงานต่อไปเมื่อติดต่อ server ไม่ได้ เว้นแต่จะตั้ง `spring.cloud.config.fail-fast` ไว้
- **ทำให้ store มี high availability** ใช้ zone redundancy และ replica แล้วอ่านจาก replica ที่ใกล้ที่สุด provider ของ Azure App Configuration ค้นหา replica และ fail over ระหว่างกันได้
- **กระจายโหลด** fleet ที่ restart พร้อมกันทั้งหมดอาจทำให้ store โดน throttle ได้ ให้ใช้ cache, กระจายจังหวะ refresh และใช้ interval ที่ยาวขึ้น ส่วนใน Azure แต่ละ geo-replica มี request quota ของตัวเอง

### Secret: store แยก เข้าถึงด้วย identity

configuration store สร้างมาสำหรับค่าที่หลายคนอาจอ่านได้ ส่วน secret ต้องมีการเข้ารหัส การเข้าถึงที่เข้มกว่า การ rotate และ audit ของทุกการอ่าน แยกมันออกจากกัน

- **อ้างถึง อย่าคัดลอก** Key Vault reference ของ Azure App Configuration เก็บแค่ URI ของ secret ตัวแอปพลิเคชันไป resolve มันใน Key Vault ด้วย credential ของตัวเอง และสอง service นี้ไม่เคยคุยกันเลย Parameter Store อ้างถึง secret ของ Secrets Manager ได้ใต้ `/aws/reference/secretsmanager/` และ Spring Cloud Config ก็เสิร์ฟค่าจาก Vault หรือ cloud secret manager ได้
- **Authenticate ด้วย identity ของ workload** ไม่ใช่ด้วยรหัสผ่านที่เก็บไว้ข้างโค้ด best practice ของ Azure ชี้ว่า connection string ไปหา configuration store ก็เป็น secret ในตัวมันเอง และแนะนำให้ใช้ Microsoft Entra ID กับ managed identity แทน
- **Rotate** AWS Secrets Manager rotate secret หลายแบบได้เอง ส่วนที่เหลือทำผ่าน Lambda function ส่วน Google Secret Manager ส่ง Pub/Sub notification ตามตารางที่คุณตั้ง (ไม่บ่อยกว่าทุกชั่วโมง) แล้วโค้ดของคุณก็สร้างเวอร์ชันใหม่ ส่วน Vault ไปไกลกว่านั้นด้วย dynamic secret: แต่ละตัวมี lease ที่มี time to live และ Vault จะเพิกถอน credential เมื่อ lease หมดอายุ แอปพลิเคชันต้องรับค่าใหม่ไปใช้: provider ของ Azure reload secret จาก Key Vault ตาม interval ได้ และ Vault Agent ก็ต่ออายุหรือดึง secret ใหม่ก่อนมันหมดอายุ
- **Kubernetes Secret ต้องระวัง** ค่าของมันเข้ารหัสแบบ base64 และ base64 เป็นแค่ encoding ไม่ใช่ encryption โดย default แล้วมันถูกเก็บใน etcd แบบไม่เข้ารหัส และใครที่สร้าง Pod ใน namespace ได้ก็อ่าน Secret ทุกตัวใน namespace นั้นได้ เปิด encryption at rest, ให้สิทธิ์ด้วย RBAC แบบ least privilege หรือเก็บ secret ไว้ใน external store แล้ว sync เข้ามา
- **ห้าม log secret** การ dump configuration ตอนเริ่มทำงาน debug endpoint และ error message คือจุดรั่วที่เจอบ่อย log ชื่อ key และเวอร์ชันได้ แต่ห้าม log ค่า อย่าง provider ของ Azure ก็ log ว่าอัปเดต key ไหนบ้าง แต่ไม่ log ค่าของมัน [Centralized logging](../centralized-logging/) พูดถึงการ redact ใน pipeline ไว้เป็นแนวป้องกันชั้นที่สอง

### Configuration หรือ feature flag?

ทั้งคู่เป็นค่าที่อ่านตอน runtime และบาง store ก็เสิร์ฟทั้งสองอย่าง: Azure App Configuration และ AWS AppConfig มี feature flag มาในตัว สองอย่างนี้ต่างกันที่สิ่งที่มันตัดสินและอายุของมัน

- **Configuration** ปรับวิธีที่ระบบทำงาน (timeout, endpoint, limit, ขนาด pool) มันเหมือนกันสำหรับ user ทุกคนใน environment หนึ่ง และอยู่ถาวร
- **[Feature flag](../feature-flags/)** ตัดสินว่า code path ไหนจะรัน บ่อยครั้งแยกตาม user หรือตาม segment พร้อม targeting rule และการปล่อยตามเปอร์เซ็นต์ ส่วน release flag อยู่แค่ชั่วคราว และถูกลบเมื่อ feature ปล่อยออกไปแล้ว

ถ้าค่าไหนต้องมี targeting rule ค่านั้นคือ flag ส่วนถ้ามันต่างกันตาม environment และอยู่ถาวร ก็คือ configuration

### Configuration ใน Git

หลายทีมเก็บ configuration ไว้ใน Git repository แล้วให้ pipeline หรือ agent apply มัน การเปลี่ยนแปลงก็จะได้ pull-request review, ประวัติ และการ revert มาฟรี ๆ Spring Cloud Config ใช้ Git repository เป็น backend โดย default ส่วน Azure App Configuration นำเข้าไฟล์ configuration จาก repository ได้ด้วย GitHub Actions หรือ pipeline task และบน Kubernetes เครื่องมือ GitOps ก็ดูแลให้ ConfigMap ใน cluster ตรงกับ repository ตัว ConfigMap generator ของ Kustomize เติม hash ของเนื้อหาลงในชื่อที่ generate และเขียน reference ที่ชี้ไปหามันใหม่ ค่าที่เปลี่ยนเลยได้ ConfigMap ตัวใหม่ และ Deployment ที่ใช้มันก็ roll out เหมือนการเปลี่ยนแปลงอื่น ๆ repository ไม่ใช่ secret store: อย่าใส่ secret ไว้ในนั้น หรือถ้าจะ commit ก็ต้องเข้ารหัสเท่านั้น

## ใช้ตอนไหนดี

- หลาย environment หลาย region หรือหลาย tenant รัน build เดียวกันด้วยการตั้งค่าต่างกัน
- operator ต้องเปลี่ยนการตั้งค่าโดยไม่ต้อง release: timeout, limit, endpoint ระหว่าง failover
- service หรือ instance จำนวนมากใช้การตั้งค่าร่วมกัน อย่าง queue URL หรือ rate limit และต้องเห็นตรงกัน
- คุณต้องแสดงได้ว่าใครเปลี่ยนอะไรเมื่อไร เพื่อ compliance หรือเพื่อ incident review

**ตอนไหนไม่ควรใช้:**

- **ค่าที่ไม่เคยต่างกันระหว่าง environment ควรอยู่ในโค้ด** ถูก review และเทสต์ไปพร้อมโค้ด: route table, retry policy ตั้งต้น, การเลือก algorithm ส่วนการย้ายพวกนี้เข้า store ก็แค่เพิ่มช่องทางเปลี่ยน production โดยไม่ผ่าน review
- **แอปพลิเคชันเดียว environment เดียว** ที่การตั้งค่าเปลี่ยนแค่ตอน release: Azure Architecture Center ชี้ว่าแบบนี้ store จะเพิ่มความซับซ้อนโดยได้ประโยชน์น้อย
- **สิ่งที่แอปพลิเคชันต้องใช้เพื่อไปถึง store** (endpoint ของมัน ชื่อ environment และ identity ที่ใช้) ต้องมาจาก platform ปกติก็เป็น environment variable

## ได้อะไร เสียอะไร

- **ได้ runtime dependency เพิ่มมาอีกตัว** ตอนนี้ทุก service ต้องมี store ถึงจะเริ่มทำงานได้ เว้นแต่จะเก็บสำเนาไว้ ส่วน availability, latency และ quota ของ store ก็กลายเป็นส่วนหนึ่งของระบบคุณไปด้วย
- **เปลี่ยนเร็ว ผิดก็เร็ว** การเปลี่ยน configuration ข้าม pipeline ของโค้ดไป เว้นแต่คุณจะบังคับให้มันผ่าน pipeline และมันไปถึงทั้ง fleet ในไม่กี่วินาที
- **สร้างความล้มเหลวซ้ำได้ยากขึ้น** จะตอบว่า "ตอนที่ request นี้พัง ค่าไหน live อยู่บ้าง" ก็ต้องมีเวอร์ชันของ configuration ใน log, trace และบันทึกการ deploy
- **Environment ค่อย ๆ ต่างกัน** ค่าที่แก้ด้วยมือใน production ไม่เคยถูกเอากลับไปที่ staging จัดการเนื้อหาใน store เป็นโค้ด หรืออย่างน้อยก็เทียบ environment กันเป็นประจำ
- **เวอร์ชันปนกันระหว่างเปลี่ยน** instance refresh กันคนละจังหวะ ช่วงหนึ่งเลยมีบางตัวรันค่าเก่า บางตัวรันค่าใหม่ ใช้ sentinel key หรือ snapshot ให้ค่าที่เกี่ยวข้องกันสลับไปพร้อมกัน และทำให้ระบบทำงานได้ตอนที่ทั้งสองเวอร์ชัน live อยู่ด้วยกันช่วงสั้น ๆ
- **ค่าใช้จ่ายและ limit** AWS AppConfig คิดเงินต่อ configuration request ส่วน throughput ที่สูงขึ้นของ Parameter Store ก็มีค่าใช้จ่ายเพิ่ม และ Azure App Configuration ก็ throttle store ที่ส่ง request มากเกินไป

## ข้อควรรู้ตอนลงมือทำ

- **ตัวอย่าง product:**
  - **Azure App Configuration** ใช้คู่กับ Key Vault reference สำหรับ secret, snapshot สำหรับ release และ Kubernetes provider ที่เขียน ConfigMap และ Secret
  - **AWS AppConfig** ที่ deploy configuration ที่เก็บไว้ใน hosted store ของตัวเอง, ใน Parameter Store, Secrets Manager หรือ Amazon S3 พร้อม validator, deployment strategy และ rollback ตาม alarm ส่วน **AWS Systems Manager Parameter Store** ตัวเดียวเหมาะกับกรณีที่ง่ายกว่า: การอัปเดตมีผลตอนอ่านครั้งถัดไป ไม่มี validation นอกจาก regular expression ที่จะใส่หรือไม่ใส่ก็ได้ และไม่มีการปล่อยทีละขั้นหรือการ revert อัตโนมัติ และ **AWS Secrets Manager** เก็บ secret
  - **Google Cloud Secret Manager** และ Parameter Manager ที่เป็นส่วนขยายของมัน สำหรับ configuration แบบ YAML, JSON หรือ plain text ที่มีเวอร์ชัน และอ้างถึง secret ได้
  - key/value store ของ **HashiCorp Consul** (ค่าสูงสุด 512 KB) สำหรับการตั้งค่า คู่กับ **Vault** สำหรับ secret
  - **Kubernetes ConfigMap และ Secret** (จำกัดตัวละ 1 MiB) ที่บ่อยครั้งถูกเติมด้วยเครื่องมือตัวใดตัวหนึ่งด้านบน ตั้งเป็น `immutable` ถ้ามันไม่ควรถูกแก้บนที่เดิมเลย: ฟีเจอร์นี้ stable ตั้งแต่ Kubernetes 1.21 และใน cluster ที่มี ConfigMap เยอะ ๆ ก็ช่วยลดโหลดของ API server ด้วย
  - **Spring Cloud Config Server** ที่มี backend เป็น Git, Vault, database หรือ cloud store
- **Bootstrap ด้วยของน้อยที่สุด** ชื่อ environment, endpoint ของ store และ identity มาจาก platform ส่วนที่เหลือทั้งหมดมาจาก store
- **Bind และ validate ตอนโหลด** bind configuration เข้ากับ object ที่มี type แล้ว validate ตอนเริ่มและทุกครั้งที่ reload ถ้า reload แล้ว validation ไม่ผ่าน ให้ใช้ค่าก่อนหน้าต่อแล้วยิง alert
- **แสดงเวอร์ชัน ห้ามแสดงค่า** เปิดเวอร์ชันของ configuration ไว้ที่ info endpoint และใน log คนอื่นจะได้ดูได้ว่า instance รันอะไรอยู่
- **ให้ทุก key มีเจ้าของ** ผ่าน prefix ของแต่ละ service หรือทีม และลบ key ที่ไม่มีใครอ่านแล้ว
- **เทสต์ตอนพัง** ใน staging ให้บล็อกการเข้าถึง store แล้ว restart instance: มันควรเริ่มทำงานจากสำเนา last known good หรือไม่ก็พังแบบที่คุณออกแบบไว้
