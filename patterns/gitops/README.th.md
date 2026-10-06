## ปัญหา

ในหลายทีม pipeline เป็นทางเดียวที่ software จะไปถึง production และมันไปถึงด้วยการ push: stage สุดท้ายรัน `kubectl apply` หรือ `helm upgrade` ใส่ cluster โดยใช้ credential ที่เก็บไว้ในระบบ CI ปกติ credential พวกนี้มีสิทธิ์ระดับ administrator เพราะ pipeline ต้องสร้างอะไรก็ได้ที่ manifest บอกไว้ ส่วนรอบ ๆ pipeline นั้น คนก็ยังแก้ cluster ตรง ๆ กันอยู่เรื่อย ๆ ตอนเกิด incident มีคน scale deployment เพิ่มค่า timeout หรือ patch ConfigMap จาก terminal แล้วไม่มีใครเขียนการเปลี่ยนแปลงนั้นกลับไปที่ manifest

สองอย่างนี้รวมกันแล้วพังแบบเงียบ ๆ

- **fix หายไปเฉย ๆ** pipeline รอบถัดไป apply manifest ใหม่อีกครั้ง ทุก field ที่ manifest กำหนดไว้ ตัว `kubectl apply` จะเอาค่าเดิมกลับมา ทำให้ fix ที่ทำตอน incident หายไป และ incident ก็กลับมาได้อีก ส่วน field ที่ manifest ไม่ได้พูดถึงก็ยังเป็นค่าที่แก้ด้วยมือ ทำให้ cluster กลายเป็นของผสมระหว่างสองแบบ
- **ไม่มีใครรู้ว่าอะไรรันอยู่** บันทึกที่ครบที่สุดของ cluster ก็คือตัว cluster เอง จะตอบว่า "เวอร์ชันไหน live อยู่ ใช้ setting อะไร และตั้งแต่เมื่อไร" ก็ต้องไล่ดู object ทีละตัว ส่วนจะตอบว่า "ทำไม" ปกติก็ต้องไปถามคนที่ on call คืนนั้น
- **rollback คือการเดา** จะย้อนกลับก็ต้องรัน pipeline เก่าซ้ำ แล้วหวังว่า environment รอบ ๆ มันจะไม่เปลี่ยนไปในระหว่างนั้น
- **pipeline คือกุญแจผี** ระบบ CI, runner และ plugin ทุกตัวที่เห็น credential สำหรับ deploy ได้ ก็เปลี่ยน production ได้ ส่วน token ที่รั่วหรือ build step ที่โดนเจาะ ก็ไปถึงได้ทุก cluster ที่ pipeline ไปถึง

## ทำงานยังไง

GitOps กลับทิศของ flow นี้ desired state ของแต่ละ environment ถูกประกาศไว้ใน Git แล้วมี agent ที่รันอยู่ใน cluster คอย pull มา และดูแลให้ cluster ตรงกับมันอยู่เสมอ

1. **ประกาศ desired state** configuration repository เก็บ manifest ของทุก environment ในตัวอย่างนี้มีโฟลเดอร์ `envs/prod/` ที่ปักไว้ที่ `image: shop:v42` กับ `replicas: 3` และอีกโฟลเดอร์สำหรับ staging
2. **CI build แต่ไม่ deploy** pipeline build และเทสต์โค้ด แล้ว push image **v43** ขึ้น registry แล้วเสนอการเปลี่ยนแปลง: เปิด pull request เข้า configuration repository (หรือให้ bot เปิดแทน ดูเรื่อง image automation ด้านล่าง) ตัว pipeline ไม่ได้ถือ credential ของ cluster เลย
3. **review แล้ว merge คือการอนุมัติ** pull request แสดงให้เห็นชัด ๆ ว่าอะไรใน production จะเปลี่ยน (`v42 → v43`, `3 → 4`) พอ review และ merge แล้ว commit ใหม่ก็คือ desired state ใหม่ และประวัติ commit ก็กลายเป็น log ของการ deploy
4. **agent pull มาแล้ว apply ส่วนที่ต่าง** agent ใน cluster เห็น commit ใหม่ ด้วยการ poll หรือผ่าน webhook แล้ว render manifest เอาไปเทียบกับ object ที่ live อยู่ และ apply เฉพาะส่วนที่ต่าง ระหว่างที่สองฝั่งยังไม่ตรงกัน แอปพลิเคชันจะถูกรายงานว่า **OutOfSync** พอตรงกันแล้วก็เป็น **Synced**
5. **reconcile ไปเรื่อย ๆ** การเทียบไม่ได้หยุดหลัง deploy เสร็จ พอมีคน scale deployment เป็น 10 ด้วยมือ agent ก็เห็นว่า live state เริ่มเพี้ยนไปจาก Git แล้วถ้าเปิด self-healing ไว้ มันจะปรับจำนวนกลับเป็น 4 แต่ถ้าปิด self-healing ไว้ มันจะรายงาน drift และให้ alert ยิงได้ การเปลี่ยนแปลงไหนที่ควรอยู่ต่อต้องผ่าน Git
6. **rollback และ promote ก็คือ commit** การ revert commit ที่เอา v43 เข้ามาก็คือ pull request ธรรมดาตัวหนึ่ง พอ merge แล้ว agent ก็พา cluster กลับไปที่ v42 ส่วนการ promote เวอร์ชันจาก staging ไป production ก็คือ pull request ที่คัดลอก tag จากโฟลเดอร์ของ environment หนึ่งไปอีกโฟลเดอร์

| | Push-based delivery | Pull-based GitOps |
|---|---|---|
| **ใครเปลี่ยน cluster** | pipeline จากข้างนอก บวกใครก็ได้ที่มี credential | agent ที่รันอยู่ใน cluster |
| **credential ของ cluster อยู่ที่ไหน** | ใน CI บ่อยครั้งมีสิทธิ์ระดับ administrator | ใน cluster อยู่กับ agent |
| **cluster ถูกเทียบกับต้นทางตอนไหน** | เฉพาะตอนที่ pipeline รัน | ตลอดเวลา ทุก ๆ ไม่กี่นาที หรือทุกครั้งที่มี commit |
| **การแก้ด้วยมือ** | ค้างอยู่โดยไม่มีใครเห็น จนกว่า deploy รอบหน้าจะทับ | ถูกรายงานทันที และถูกย้อนกลับถ้าเปิด self-healing ไว้ |
| **Rollback** | รัน pipeline เก่าซ้ำ | revert commit |
| **บันทึกว่าอะไรรันอยู่และทำไม** | log ของ pipeline ถ้าเก็บไว้ | ประวัติ Git และการ review pull request |

### หลักการสี่ข้อ

โปรเจกต์ OpenGitOps ที่เป็น CNCF Sandbox project ตั้งแต่มกราคม 2021 เผยแพร่ **GitOps Principles v1.0.0** โดยอธิบาย desired state ของระบบที่จัดการด้วย GitOps ไว้ว่า

1. **Declarative** desired state ของระบบถูกเขียนเป็นคำอธิบายว่าอะไรควรมีอยู่ ไม่ใช่เป็นขั้นตอนว่าจะไปถึงตรงนั้นยังไง
2. **Versioned and Immutable** คำอธิบายนั้นถูกเก็บไว้ในที่ที่เก็บทุกเวอร์ชัน ไม่แก้เวอร์ชันไหนทับที่เดิม และเก็บประวัติไว้ครบ
3. **Pulled Automatically** software agent ไปดึง desired state จากที่เก็บนั้นมาเอง ไม่มีใคร push ไปให้
4. **Continuously Reconciled** agent คอยดู actual state อยู่ตลอด และพยายามทำให้มันตรงกับ desired state อยู่ตลอด

หลักการพวกนี้ไม่ได้พูดถึง "Git" เลย ที่ Git เป็นที่เก็บที่ใช้กันปกติก็เพราะมันมีเวอร์ชัน ประวัติ review และ access control อยู่แล้ว แต่อย่าง Flux ก็ reconcile จาก OCI artifact ใน container registry หรือจาก bucket ที่เข้ากันได้กับ S3 ได้ด้วย และเอกสารของมันก็อธิบายโมเดล "Gitless GitOps" ที่คนยังแก้ใน Git อยู่ ส่วน cluster ไป pull configuration artifact จาก registry

### ชื่อนี้มาจากไหน

คำนี้มาจาก Weaveworks ในปี 2017 บริษัทเปิดตัวคำนี้ในบล็อกโพสต์ *GitOps — Operations by Pull Request* ที่เล่าว่าบริษัทรัน service ของตัวเองบน Kubernetes ยังไง: ทุกอย่างประกาศไว้ใน Git ทุกการเปลี่ยนแปลงด้าน operation ทำผ่าน pull request และมี operator ใน cluster (ตอนนั้นชื่อ Weave Flux) คอยดูแลให้ระบบที่รันอยู่ตรงกับ repository ต่อมา Alexis Richardson ที่เป็น CEO ของบริษัท ก็นำเสนอไอเดียนี้คู่กับ William Denniss จาก Google ที่ KubeCon North America วันที่ 7 ธันวาคม 2017 (session นี้อยู่ใน references) แล้วอีกหนึ่งปีต่อมาก็มองย้อนกลับไปในโพสต์ชื่อ *What Is GitOps Really?* ตอนนี้โพสต์ต้นฉบับไม่อยู่ที่ address เดิมแล้ว ส่วน agent ที่ดังที่สุดสองตัวในวันนี้คือ Flux ที่โตมาจาก operator ตัวนั้น และ Argo CD ที่เป็นส่วนหนึ่งของโปรเจกต์ Argo ที่ Applatix เปิดเป็น open source ในปี 2017 ก่อนที่ Intuit จะซื้อบริษัทไป

### Push กับ pull: ทำไมทีม security ถึงสนใจ

- **Credential** ใน push-based delivery ตัว pipeline ต้องมี credential ที่เปลี่ยน cluster ได้ และ runner, plugin และ secret store ทุกตัวที่เกี่ยวข้องก็ต้องมีด้วย ส่วนใน pull-based delivery ตัว agent ใช้ service account ของตัวเองใน cluster แล้ว CI ก็ต้องการแค่สิทธิ์ push image กับเปิด pull request
- **ความเสียหายถ้า pipeline โดนเจาะ** คนร้ายที่คุม push pipeline ได้จะ deploy อะไรก็ได้ไปทุก cluster ที่มันไปถึง ส่วนคนร้ายที่คุม pipeline แบบ pull-based ได้ทำได้แค่ push image หรือเปิด pull request และทั้งสองอย่างยังต้องผ่าน review กับ branch protection ก่อนจะมีอะไรรัน ส่วน attack surface ก็ย้ายไปอยู่ที่ configuration repository ตัว repository นี้เลยต้องป้องกันให้จริงจัง (ดูด้านล่าง)
- **ทิศทางของ network** agent ต่อออกไปหา Git และ registry เอง ไม่มีอะไรจากข้างนอกต้องมี route เข้ามาหา API server ของ cluster เรื่องนี้ช่วยได้เวลา cluster อยู่ใน private network
- **ข้อควรระวังของแบบ hub-and-spoke** Argo CD instance ตัวเดียวจัดการ remote cluster ได้หลายตัว แต่แบบนั้นมันจะเก็บ credential ของแต่ละ cluster ไว้เป็น Kubernetes Secret และสั่งงาน cluster พวกนั้นจากข้างนอก แบบนี้ก็คือ push อีกแล้ว แค่มาจากที่ที่ป้องกันดีกว่า การรัน agent ในทุก cluster ทำให้ credential อยู่แค่ใน cluster ของตัวเอง ส่วน instance กลางตัวเดียวดูแลง่ายกว่า เลือกให้ชัดว่าจะเอาแบบไหน และป้องกัน instance กลางให้ดีเท่ากับ cluster ที่มันคุมอยู่

### วางโครง repository

- **แยกโค้ดแอปพลิเคชันกับ configuration** best-practice guide ของ Argo CD แนะนำให้แยก repository: การเปลี่ยนจำนวน replica ไม่ควรไป trigger build, ประวัติของ configuration จะกลายเป็น audit log ที่สะอาดว่าอะไรเปลี่ยนในแต่ละ environment, แต่ละ repository ต้องให้สิทธิ์เขียนกับคนต่างกลุ่มกัน และ pipeline ที่ commit เข้า repository ที่มันใช้ build ก็อาจ trigger ตัวเองวนไม่จบ
- **หนึ่งโฟลเดอร์ต่อ environment ไม่ใช่หนึ่ง branch ต่อ environment** เก็บทุก environment ไว้ใน branch เดียว แยกโฟลเดอร์ละ environment (`envs/staging/`, `envs/prod/`) อย่างที่ repository-structure guide ของ Flux แสดงไว้ การ promote ก็จะเป็น pull request เล็ก ๆ ที่คัดลอก tag หรือ digest ข้ามโฟลเดอร์ และ diff ระหว่างโฟลเดอร์ก็บอกได้ชัด ๆ ว่า environment ต่างกันตรงไหน ส่วน branch ที่อยู่ยาวแยกตาม environment มักค่อย ๆ ห่างกันออกไป และทุกการ merge ระหว่างกันก็อาจพาการเปลี่ยนแปลงที่ไม่เกี่ยวข้องติดไปด้วย
- **Templating** มีไม่กี่ทีมที่เขียน manifest ทุกตัวด้วยมือให้ทุก environment ตัว **Kustomize** เก็บ base ที่ใช้ร่วมกัน กับ overlay เล็ก ๆ ต่อ environment ที่ patch เฉพาะส่วนที่ต่าง ส่วน **Helm** render chart ด้วย values file ของแต่ละ environment ทั้ง Argo CD และ Flux render พวกนี้ใน cluster ส่วนบางทีมเลือก commit manifest ที่ render เสร็จแล้วแทน เพื่อให้คน review เห็น object ตัวจริงที่จะถูก apply
- **การอัปเดต image** ต้องมีใครสักคนเปลี่ยน tag ใน Git ตอนที่มี image ใหม่ ตัว CI เปิด pull request เองได้ อย่างในไดอะแกรม ส่วน image automation ของ Flux ทำจากฝั่ง cluster: `ImageRepository` สแกน registry, `ImagePolicy` เลือก tag ใหม่สุดที่ตรงกับกฎ เช่นช่วงของ semantic version และ `ImageUpdateAutomation` commit การเปลี่ยนแปลงเข้า Git โดยดูจาก marker ใน YAML มัน commit ตรงเข้า branch ที่ cluster ตามอยู่ก็ได้ หรือ push ไปอีก branch แล้วให้ CI เปิด pull request จากตรงนั้นก็ได้ เพื่อให้มีคนอนุมัติทุกการอัปเดตก่อน ฝั่ง Argo CD มีโปรเจกต์แยกชื่อ Argo CD Image Updater ที่ทำงานเดียวกัน และเขียนการเปลี่ยนแปลงกลับเข้า Git ได้
- **ปักสิ่งที่ deploy ให้แน่น** tag ถูกย้ายไปชี้ image อื่นได้ แต่ digest ย้ายไม่ได้ การปักด้วย digest หรือใช้ registry ที่ทำให้ tag เป็น immutable ทำให้ commit เป็นบันทึกที่แม่นยำว่าอะไรรันอยู่ ดู [immutable infrastructure](../immutable-infrastructure/)

### เครื่องมือ

ทั้งสองโปรเจกต์ด้านล่าง graduate ใน Cloud Native Computing Foundation ในปี 2022: Flux วันที่ 30 พฤศจิกายน ส่วน Argo ที่รวม Argo CD ไว้ด้วย วันที่ 6 ธันวาคม

- **Argo CD** มองแต่ละ deployment เป็น *Application*: มี source (Git path, Helm chart หรือ Kustomize overlay) กับ cluster และ namespace ปลายทาง มันแสดงสถานะ sync และ health ของทุก resource ใน web UI และ CLI
  - **Automated sync** apply commit ใหม่ให้โดยไม่ต้องกดอะไร มีสวิตช์ความปลอดภัยสองตัวที่ปิดไว้เป็น default: **prune** (ลบ resource ที่ live อยู่แต่ถูกเอาออกจาก Git แล้ว) และ **self-heal** (sync ใหม่เมื่อ live state เพี้ยนไปทั้งที่ Git ไม่ได้เปลี่ยน) ถ้าเปิด self-heal ไว้ Argo CD จะ retry หลัง timeout สั้น ๆ ที่ default คือ 5 วินาที
  - **Health check** ประเมินแต่ละ resource ว่าเป็น Healthy, Progressing, Degraded, Suspended, Missing หรือ Unknown มีกฎในตัวสำหรับ kind ที่ใช้กันบ่อย และกฎ custom สำหรับที่เหลือ
  - **ApplicationSets** ที่มากับ Argo CD ตั้งแต่เวอร์ชัน 2.3 สร้าง Application หลาย ๆ ตัวจาก template เดียว ขับด้วย generator อย่าง list, cluster ที่ลงทะเบียนไว้, directory ใน Git repository หรือ pull request ที่เปิดอยู่
  - คำสั่ง rollback ของมันเองจะถูกปิดไว้ระหว่างที่เปิด automated sync เพราะฉะนั้นถ้าใช้ automation การ rollback ก็คือ Git revert และนั่นแหละคือประเด็น
- **Flux** เป็นชุดของ controller ที่เรียกว่า GitOps Toolkit แต่ละตัว reconcile custom resource ของตัวเอง:
  - **source controller** ดึง source แบบ `GitRepository`, `OCIRepository`, `Bucket` และ Helm repository แล้วแปลงเป็น artifact ที่มีเวอร์ชัน
  - **kustomize controller** apply `Kustomization`: build manifest, apply ด้วย server-side apply, prune object ที่ถูกเอาออกจาก source, รอ health check, จัดลำดับตัวเองให้ตามหลัง Kustomization อื่นด้วย `dependsOn` และถอดรหัส secret ที่เข้ารหัสด้วย SOPS
  - **helm controller** จัดการ object `HelmRelease` และตรวจจับ drift จาก release ที่มันติดตั้งไว้ได้ แล้วจะแก้ให้ด้วยหรือไม่ก็เลือกได้
  - **notification controller** ส่ง alert ไปที่ chat และระบบอื่น ๆ รายงานสถานะกลับไปที่ Git provider เป็น commit status และรับ webhook ที่ trigger ให้ reconcile ทันที
  - controller **image reflector** กับ **image automation** เป็นของเสริมที่ใส่หรือไม่ใส่ก็ได้ ใช้ทำการอัปเดต image ที่อธิบายไว้ด้านบน

### Interval, ลำดับ และ health

- **การเปลี่ยนแปลงมาถึงเร็วแค่ไหน** Argo CD poll แต่ละ repository ทุก 3 นาทีเป็น default: 120 วินาที บวก random jitter อีกไม่เกิน 60 วินาที เพื่อให้แอปพลิเคชันไม่ poll พร้อมกันหมด ส่วน object ของ Flux แต่ละตัวมี `interval` ของตัวเอง ทุก interval ตัว Kustomization จะ apply source ของมันใหม่และแก้ drift ทั้งสองตัวรับ webhook จาก Git host ได้ด้วย ทำให้ merge ถูก apply ได้ในไม่กี่วินาที โดยที่ polling ยังเป็นตาข่ายรองรับอยู่ ส่วน interval ของ polling ก็เป็นตัวกำหนดด้วยว่า drift จะหลุดรอดสายตาได้นานสุดแค่ไหน
- **ลำดับ** object บางตัวต้องมีอยู่ก่อนตัวอื่น: namespace และ custom resource definition ต้องมาก่อน resource ที่ใช้มัน, database migration ต้องมาก่อนเวอร์ชันใหม่ ส่วน Argo CD รัน sync เป็น phase (PreSync, Sync, PostSync และ SyncFail สำหรับเก็บกวาด) และในแต่ละ phase ก็แบ่งเป็น **sync wave**: annotation ที่เป็นจำนวนเต็มชื่อ `argocd.argoproj.io/sync-wave` โดย wave ที่เลขต่ำกว่าถูก apply ก่อน ใช้ค่าติดลบได้ และ wave ถัดไปจะเริ่มก็ต่อเมื่อ wave ก่อนหน้า sync และ healthy แล้ว ส่วน Flux จัดลำดับ Kustomization ทั้งก้อนด้วย `dependsOn` และรอให้ health check ของมันผ่านก่อนจะเริ่มตัวที่พึ่งมันอยู่ได้
- **Synced ไม่ได้แปลว่าใช้งานได้** สถานะ sync บอกว่า cluster ตรงกับ Git ส่วน health บอกว่า object ของ Kubernetes อยู่ในสภาพดี แอปพลิเคชันที่ synced แล้วอาจ degraded อยู่ก็ได้ และตัวที่ healthy ก็อาจยังคืน error ที่มีแค่ monitoring ของคุณที่เห็น ต้องดูทั้งสองอย่าง บวกกับ [health endpoint](../health-endpoint-monitoring/) และ error rate ของแอปพลิเคชันเองด้วย อย่างใน step 4 ของไดอะแกรม

### Drift: ตรวจให้เจอ แล้วตัดสินใจว่าจะ heal อะไร

self-healing คือสิ่งที่ทำให้ไว้ใจ cluster ได้ แต่ไม่ใช่ทุกความต่างจาก Git จะเป็นความผิดพลาด

- **autoscaler เป็นเจ้าของจำนวน replica** ถ้า Horizontal Pod Autoscaler จัดการ deployment อยู่ เอกสารของ Kubernetes แนะนำให้เอา `spec.replicas` ออกจาก manifest ไม่อย่างนั้นทุกครั้งที่ apply จำนวนจะถูกรีเซ็ตกลับเป็นค่าใน manifest ถ้า field นี้ต้องอยู่ต่อ ก็บอก agent ให้ปล่อยมันไว้: ใช้ `ignoreDifferences` ของ Argo CD บน `/spec/replicas` คู่กับ sync option `RespectIgnoreDifferences=true` เพื่อไม่ให้ sync ไปทับมันด้วย หรือใช้กฎ `spec.ignore` บน `Kustomization` ของ Flux (`driftDetection.ignore` บน `HelmRelease`) best-practice guide ของ Argo CD เรียกสิ่งนี้ว่าการเว้นที่ไว้ให้ imperativeness ดู [autoscaling](../autoscaling/)
- **controller อื่นก็เขียน field ด้วย** admission webhook ฉีด sidecar และค่า default เข้าไป operator ใส่ annotation ให้ object และ controller บางตัวก็สลับลำดับใน list ส่วน **server-side apply** ของ Kubernetes บันทึกว่า *field manager* ตัวไหนเป็นเจ้าของแต่ละ field และรายงาน conflict เมื่อมีตัว apply พยายามเปลี่ยน field ที่ manager ตัวอื่นเป็นเจ้าของ ยกเว้นตัว apply จะ force การเปลี่ยนนั้น ตัว Flux apply ด้วย server-side apply ส่วน Argo CD ก็ทำได้ด้วย sync option `ServerSideApply=true` และ option นี้จะ force conflict ไปเลย ส่วนตรงไหนที่ controller อื่นเป็นเจ้าของ field นั้นอย่างถูกต้อง ให้เพิ่มกฎ ignore แทนที่จะปล่อยให้ agent กับ controller ผลัดกันเขียนทับ
- **incident ต้องมีทาง break-glass** ระหว่างที่ระบบล่ม คนที่แก้ปัญหาอาจต้องเปลี่ยนอะไรเร็วกว่าที่ review จะทันได้ ให้ทำเป็นขั้นตอนที่เขียนไว้: suspend การ reconcile ของแอปพลิเคชันที่โดน (`suspend` ของ Flux หรือปิด automated sync ของ Argo CD) แก้ บันทึกไว้ แล้วตามด้วย pull request ก่อนจะเปิด reconcile กลับ ไม่อย่างนั้น agent จะย้อน fix นั้นแบบเงียบ ๆ ก็เป็นความล้มเหลวแบบเดียวกับใน step 1 แค่เร็วกว่า
- **prune อย่างระวัง** พอเปิด pruning แล้ว การลบไฟล์ออกจาก Git จะลบ object ที่ live อยู่ด้วย รวมถึงของที่มี state ด้วย ปิด prune ไว้จนกว่าจะไว้ใจ repository ได้ และป้องกัน object ที่ห้ามถูกลบอัตโนมัติ เช่นด้วย sync option `Prune=false` ของ Argo CD หรือ label หรือ annotation `kustomize.toolkit.fluxcd.io/prune: disabled` ของ Flux

### Secret

Git repository ถูกคัดลอกไปทุก laptop และ CI runner ที่ clone มัน และประวัติของมันก็อยู่ตลอดไป เพราะฉะนั้นห้าม commit secret เป็น plain text เด็ดขาด ทางเลือกที่ใช้กันปกติคือ

- **Sealed Secrets** (Bitnami): `kubeseal` เข้ารหัส Secret ด้วย public key ของ controller ที่รันอยู่ใน cluster ปลายทาง `SealedSecret` ที่ได้ออกมาวางไว้ใน public repository ได้เลย เพราะมีแค่ controller ตัวนั้นที่ถอดรหัสและแปลงมันกลับเป็น Secret ได้
- **SOPS** ที่เป็น CNCF Sandbox project: เข้ารหัสแค่ value ในไฟล์ YAML, JSON, INI หรือ dotenv ด้วย AES-256 ในโหมด GCM และปล่อย key ไว้ให้อ่านได้ คน review เลยยังเห็นว่า setting ไหนเปลี่ยน ส่วน data key ถูกป้องกันด้วย key ของ age หรือ PGP หรือด้วย cloud KMS หรือ HashiCorp Vault ตัว kustomize controller ของ Flux ถอดรหัสไฟล์ SOPS ระหว่าง reconcile ภายใน cluster ส่วนไดอะแกรมแสดงค่าแบบนี้เป็น `ENC[AES256…]`
- **reference ไปที่ external secret store** **External Secrets Operator** เก็บแค่ reference แบบ `ExternalSecret` ไว้ใน Git แล้วคัดลอกค่าจาก AWS Secrets Manager, Azure Key Vault, HashiCorp Vault และ store อื่น ๆ มาใส่ใน Kubernetes Secret และดูแลให้สองฝั่ง sync กันอยู่ แบบนี้ secret ก็จะมีบ้านเดียวนอก Git ที่มี access control และการ rotate ของตัวเอง ดู [external configuration store](../external-configuration-store/)

คำแนะนำของ Argo CD เองให้น้ำหนักอย่างมากกับการสร้าง secret ใน cluster ปลายทางด้วยวิธีพวกนี้มากกว่าการฉีด secret เข้าไปตอนที่มัน generate manifest ส่วนหนึ่งเพราะมันเก็บ manifest ที่ generate แล้วเป็น plain text ไว้ใน Redis cache ของมัน

### Progressive delivery

GitOps ตัดสินว่า *อะไร* ควรรัน แต่ไม่ได้ตัดสินว่า traffic จะย้ายไปหามันยังไง โดย default แล้ว Kubernetes Deployment จะแทนที่ pod ด้วย [rolling update](../rolling-update/) ถ้าอยากคุมได้มากกว่านั้น ก็มี controller สำหรับ progressive delivery นั่งอยู่ใน cluster ข้าง ๆ agent และ resource ของมันเองก็ประกาศไว้ใน Git เหมือนทุกอย่าง

- **Argo Rollouts** แทนที่ Deployment ด้วย resource `Rollout` ที่รองรับกลยุทธ์ [blue-green](../blue-green-deployment/) และ [canary](../canary-release/) ย้าย traffic ผ่าน ingress controller หรือ service mesh และรันการวิเคราะห์อัตโนมัติกับ metric เพื่อ promote หรือ abort
- **Flagger** ที่อยู่ในตระกูล Flux และ graduate ไปพร้อมกัน ทำ canary, A/B และ blue-green release ให้ Deployment ที่มีอยู่แล้วแบบอัตโนมัติ บน service mesh, ingress controller และ Gateway API โดยเช็ก metric ทุกขั้น

commit บอกว่า "v43 คือเวอร์ชันนี้" ส่วน controller ตัดสินว่า user จะได้รับมันเร็วแค่ไหน และ rollback เองถ้า metric แย่ลง โดยไม่ต้องมี commit ส่วนการบันทึกผลนั้นกลับลง Git ด้วยการ revert tag ทำให้สองฝั่งยังตรงกัน

### Feature flag ไม่ใช่การ deploy

การ deploy เอาโค้ดขึ้น production ส่วน [feature flag](../feature-flags/) ตัดสินว่าใครจะเห็นมัน GitOps เก่งเรื่องแรก: การเปลี่ยนแปลงสิ่งที่รันแบบช้า ผ่าน review และมีเวอร์ชัน การเปลี่ยน flag ต้องมีผลในไม่กี่วินาที บ่อยครั้งกับ user แค่บางส่วน และปกติก็ทำใน flag service ตอน runtime บางทีมก็เก็บนิยามของ flag ไว้ใน Git ด้วย แต่การให้ทุกการพลิก flag ต้องผ่าน pull request และ reconciliation loop จะทำให้คุณสมบัติที่มีประโยชน์ที่สุดของ flag อย่างการย้อนกลับทันที ช้าลง

### หลาย cluster หลาย environment

repository เดียวกันอธิบาย cluster ได้หลายตัว ApplicationSets ของ Argo CD ปั๊ม Application ออกมาหนึ่งตัวต่อ cluster หรือต่อ directory ส่วน Flux เก็บโฟลเดอร์ละ cluster (`clusters/production`, `clusters/staging`) ที่ชี้ไปที่นิยามของแอปและ infrastructure ที่ใช้ร่วมกัน โดยมี agent ในทุก cluster การเพิ่ม cluster ก็กลายเป็นการเพิ่มโฟลเดอร์หรือลงทะเบียน cluster และนี่คือสิ่งที่ [deployment stamps](../deployment-stamps/) ต้องการ: สำเนาที่เหมือนกันของหน่วยหนึ่งหลาย ๆ ชุด แต่ละชุด pull คำอธิบายเดียวกันไปพร้อม overlay เล็ก ๆ ของตัวเอง ทยอยปล่อยการเปลี่ยนแปลงข้าม cluster เป็นระลอก ผ่าน pull request สำหรับ promote แทนที่จะปล่อยไปทุกตัวพร้อมกัน

### นอกเหนือจาก Kubernetes

Kubernetes เป็นบ้านตามธรรมชาติของ GitOps เพราะ API ของมันเป็น declarative และมี controller คอย reconcile อยู่แล้ว loop เดียวกันนี้จัดการ resource นอก cluster ได้ด้วยถ้ามี controller คอยแปลงให้: **Crossplane** ที่ graduate ใน CNCF เมื่อตุลาคม 2025 ขยาย Kubernetes control plane ด้วย provider ที่สร้างและ reconcile cloud resource อย่าง database, bucket และ network จาก custom resource อยู่ตลอด แล้ว GitOps agent ก็ apply resource พวกนั้นเหมือนตัวอื่น ๆ ส่วน [immutable infrastructure](../immutable-infrastructure/) แบบดั้งเดิมและ infrastructure as code ก็ใช้คู่กันได้: Terraform หรือ OpenTofu ก็อธิบาย infrastructure เป็นโค้ดเหมือนกัน แต่ปกติ apply จาก pipeline นั่นก็คือ push-based delivery ที่มี plan step และจะตรวจเจอ drift ก็ต่อเมื่อมีการรัน plan ด้วยมือหรือตามตาราง

### ตอนนี้ Git เป็นส่วนหนึ่งของ production แล้ว

ใครที่ merge เข้า configuration repository ได้ก็เปลี่ยน production ได้ เพราะฉะนั้นป้องกันมันให้สมกัน

- **Branch protection และ required review** บน main branch โดยมี code owner ของแต่ละโฟลเดอร์ environment การเปลี่ยน production เลยต้องได้คนอนุมัติที่ถูกต้องและ check ที่ผ่าน ไม่มีใครรวมถึง CI push ตรงเข้าไปได้
- **Signed commit** บังคับใช้บน Git host และให้ agent ตรวจสอบ: `GitRepository` ของ Flux ปฏิเสธ commit หรือ tag ที่ไม่ได้ sign ด้วย OpenPGP หรือ SSH key ที่เชื่อถือได้ และ Argo CD ก็ปฏิเสธการ sync commit ที่ไม่มี GnuPG signature ที่เชื่อถือได้ (ในเวอร์ชันปัจจุบันตั้งค่าเป็น source integrity rule บน project ส่วน setting เก่า `signatureKeys` ถูก deprecate แล้ว)
- **Least privilege สำหรับ agent** agent ที่มีสิทธิ์ cluster-admin ทำให้ commit ที่ผิดตัวเดียวกลายเป็นการเปลี่ยนแปลงทั้ง cluster *AppProjects* ของ Argo CD จำกัดว่าแอปพลิเคชันใช้ repository ไหนได้ deploy ไป cluster และ namespace ไหนได้ และสร้าง object kind ไหนได้ ส่วน Flux ทำ impersonate เป็น service account แยกต่อ Kustomization หรือ HelmRelease ได้ ทำให้ source ของแต่ละทีมทำได้แค่สิ่งที่ account นั้นอนุญาต
- **Least privilege สำหรับ CI** ให้ token กับ pipeline ที่เปิด pull request บน configuration repository ได้ แต่ merge ไม่ได้
- **Validate ก่อน merge** render manifest ใน CI (`kustomize build`, `helm template`) แล้วเช็กกับ schema และ policy การ review จะได้ครอบคลุม object ที่จะถูก apply จริง ๆ

### เฝ้าดู

สถานะของ agent เป็นสัญญาณด้าน operation ในตัวมันเอง Argo CD เปิดสถานะ sync และ health ของแต่ละแอปพลิเคชันเป็น Prometheus metric และใน UI ของมัน และ Argo CD Notifications ก็มี trigger มาให้ เช่น `on-sync-failed` และ `on-health-degraded` ส่วน trigger แบบ custom ก็ยิงตอน OutOfSync ได้ ส่วน Flux บันทึก condition และ event ไว้บนทุก object และ notification controller ของมันก็โพสต์ alert ไปที่ chat และตั้ง commit status บน Git provider ได้ ทำให้ commit บอกได้ว่ามันไปถึง cluster แล้วหรือยัง ตั้ง alert ไว้กับแอปพลิเคชันที่ค้างอยู่ใน OutOfSync, การ reconcile ที่ล้มเหลวหรือค้าง และ drift ที่กลับมาซ้ำ ๆ อย่างหลังนี้ปกติแปลว่ายังมี process หรือ controller ที่แอบเปลี่ยน cluster ลับหลัง Git อยู่

## ใช้ตอนไหนดี

- **Kubernetes หรือ platform ไหนก็ได้ที่มี declarative API และ controller** โดยเฉพาะถ้ามีหลาย cluster หรือหลาย environment ที่ต้องให้ตรงกัน
- **ทีมที่ทำงานผ่าน pull request อยู่แล้ว** และอยากให้การเปลี่ยน production ใช้กฎเรื่อง review ประวัติ และสิทธิ์การเข้าถึงแบบเดียวกับโค้ด
- **ข้อกำหนดด้าน audit และ compliance** ที่คำถาม "ใครเปลี่ยนอะไร เมื่อไร และใครอนุมัติ" ต้องตอบได้จากบันทึก ไม่ใช่จากความจำ
- **Environment ที่ต้องสร้างใหม่ได้เร็ว** เพราะ cluster ใหม่ชี้ไปที่ repository แล้วก็เข้าสู่ state ที่ประกาศไว้ได้เลย

**ตอนไหนไม่ควรใช้:**

- **ระบบที่ไม่มี declarative API** server รุ่นเก่า appliance และ SaaS product ที่ตั้งค่าผ่านการเรียกแบบ imperative หรือผ่าน console ไม่มีอะไรให้ agent reconcile ด้วย เว้นแต่จะมีคนเขียน controller ขึ้นมา
- **State ที่ออกแบบมาให้เปลี่ยนตลอดเวลา** จำนวน replica ที่ autoscaler คุม, job ต่อ request, ข้อมูล และอะไรก็ตามที่ operator หรือตัวแอปพลิเคชันจัดการเอง ควรอยู่นอก Git หรือไม่ก็ ignore ไว้ให้ชัด
- **ระบบเล็ก ๆ** service ตัวเดียวใน cluster เดียว ที่ทีมเล็ก ๆ deploy อาจเหมาะกับ pipeline ธรรมดาที่มี deploy step และดูแล credential ให้ดีมากกว่า ส่วนตัว agent กฎการเข้าถึงของมัน การเข้ารหัส secret และ repository ตัวที่สอง ล้วนเป็นภาระที่มีจริง

## ได้อะไร เสียอะไร

- **ได้ component ที่มีสิทธิ์สูงเพิ่มมาอีกตัว** agent เปลี่ยนทุกอย่างที่มันจัดการได้ เลยต้องดูแลเรื่อง security, อัปเกรด และ monitor เหมือนส่วนอื่น ๆ ของ control plane
- **Git กลายเป็นของสำคัญระดับ production** security ของ repository สำคัญพอ ๆ กับของ cluster ส่วน availability ของมันสำคัญน้อยกว่า: cluster ยังรันต่อได้ตอน Git ล่ม แต่ deploy การเปลี่ยนแปลงอะไรไม่ได้
- **การแก้ฉุกเฉินช้าลง** review ที่ปกป้อง production ก็ทำให้ fix ตอนตีสามช้าไปด้วย เว้นแต่จะมีทาง break-glass
- **คำว่า "deploy แล้ว" มีสองความหมาย** "merge แล้ว" ไม่ได้แปลว่า "รันอยู่": sync อาจล้มเหลว รออยู่ใน wave หลัง ๆ หรือโดน health check บล็อกไว้ developer ต้องดูสถานะ sync ด้วย ไม่ใช่ดูแค่ merge
- **Templating ซ่อนผลลัพธ์** พอใช้ Helm และ Kustomize แล้ว diff ใน pull request ก็ไม่ใช่ diff ใน cluster การ render ใน CI หรือ commit manifest ที่ render แล้ว ช่วยปิดช่องว่างนี้ได้ แลกกับไฟล์ที่มากขึ้น
- **Secret ต้องมีกลไกเพิ่ม** Sealed Secrets, key ของ SOPS หรือ external secret store ล้วนเพิ่ม component และงานจัดการ key
- **Pull request รก** image automation และ environment จำนวนมากสร้าง pull request และ commit เล็ก ๆ ออกมาเยอะ ให้จับกลุ่มหรือทำ automation กับตัวที่เป็นงานประจำ

## ข้อควรรู้ตอนลงมือทำ

- **ค่อย ๆ นำมาใช้เป็นขั้น** เริ่มจากแอปพลิเคชันเดียว ถ้า agent ทำได้ (เช่น Argo CD ที่ปิด automated sync ไว้) ให้มันแค่รายงานความต่างก่อน แล้วแก้ drift ที่มันเจอ จากนั้นค่อยเปิด automated sync แล้วค่อย self-healing และเปิด pruning เป็นอย่างสุดท้าย
- **หนึ่ง source of truth ต่อหนึ่ง object** object ที่ live อยู่ทุกตัวควรถูกจัดการโดย Application หรือ Kustomization แค่ตัวเดียวเท่านั้น ถ้ามี agent สองตัว หรือ agent กับ pipeline apply object ตัวเดียวกัน ก็จะตีกันเอง
- **ทำให้เห็นเวอร์ชันที่ deploy อยู่** แสดง commit และ image digest ในสถานะ sync, เป็น commit status บน Git provider และใน health endpoint ของแอปพลิเคชันเอง
- **เขียน runbook สำหรับ break-glass ไว้ก่อนจะต้องใช้** ใครมีสิทธิ์ suspend การ reconcile จะบันทึกการเปลี่ยนแปลงยังไง และหลังจากนั้นจะพา cluster กลับมาอยู่ใต้ Git ยังไง
- **ซ้อม rollback** revert commit ใน staging แล้วดู agent apply มัน การ revert ครั้งแรกใน production จะได้ไม่ใช่ครั้งแรกในชีวิต
- **กัน secret ออกจากประวัติตั้งแต่วันแรก** secret ที่เคย commit เป็น plain text แม้แค่ครั้งเดียวก็ค้างอยู่ในประวัติ: ต้อง rotate มัน ไม่ใช่แค่ลบไฟล์
