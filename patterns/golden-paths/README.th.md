## ปัญหา

Acme Shop โตจนมี 40 service และทุกตัวถูกตั้งขึ้นด้วยมือ service ใหม่มักเริ่มจากการก๊อป repository เก่า: อะไรที่ต้นฉบับมีก็ติดมาด้วย (base image, Jenkinsfile, Helm values) และอะไรที่ต้นฉบับไม่มีก็ยังขาดอยู่ต่อไป ไม่มีใครเลือกผลลัพธ์ที่ได้ พอมีคนนับดู ทั้ง 40 service ก็ run อยู่บน base image ต่างกัน 12 ตัว มี 7 ตัวที่ไม่มีเจ้าของที่ใครบอกชื่อได้ และทุกทีมก็แก้ plumbing เรื่องเดียวกัน (pipeline, namespace, database credential, dashboard) ในแบบของตัวเอง แล้วก็ต้องดูแล version ของตัวเองต่อไป

service ใหม่ **returns** ของทีม delivery แสดงให้เห็นว่าเรื่องนี้มีต้นทุนแค่ไหน ทีมนี้ (engineer 8 คน) clone `carrier-sync` มาแล้วเปลี่ยนชื่อ สิ่งที่ติดมากับ copy ก็คือ base image `openjdk:11` ที่ [Docker](../docker/) Hub ทำเครื่องหมายว่า deprecated อย่างเป็นทางการ และผล scan เจอ critical CVE 3 ตัว กับ Jenkinsfile ที่ถูกแก้ด้วยมือและข้าม image scan ไป ไม่มีอะไรให้ dashboard หรือ alert กับ returns และไม่มีอะไร register มันไว้ที่ไหนเลย ส่วนที่เหลือต้องใช้ ticket: namespace จาก platform team (OPS-1412), database จาก DBA (DBA-318), queue กับ Vault secret จาก platform team อีกรอบ (OPS-1419) แต่ละใบรออยู่ในคิวของทีมอื่น และพอรวมกับสองวันที่ใช้ก๊อปและแก้จุดต่าง ๆ ทำให้ deploy แรกไปถึง staging หลังผ่านไป 9 วันทำการ ในสัปดาห์เดียวกัน `gift-cards` page หา on-call engineer ตอน 02:14 และไม่มีใครหาได้ว่าทีมไหนเป็นเจ้าของมัน

Spotify อธิบายการ drift แบบเดียวกันไว้ในปี 2020 พอมีทีมอิสระหลายทีม developer tooling ของบริษัทก็แตกกระจายไปจนวิธีเดียวที่จะรู้ว่าทำอะไรยังไงคือถามเพื่อนร่วมงาน เป็นนิสัยที่ engineer ของบริษัทเรียกว่า "rumour-driven development" ทุกทีมที่หาวิธีทำ plumbing เอาเองต้องเสียเวลา ที่ทีมถัดไปก็จะต้องเสียซ้ำอีก แล้วแต่ละ copy ก็เก่าลงไปตามทางของมันเอง

## ทำงานยังไง

### Golden path และ paved road

**golden path** คือเส้นทางที่มีคน support และมีความเห็นชัดเจน (opinionated) สำหรับงานที่ทำบ่อย เช่นการสร้าง backend service: tool, ค่า default และขั้นตอนที่ platform team แนะนำและดูแลให้ใช้งานได้อยู่เสมอ ชื่อนี้มาจาก Spotify โดยบทความ *How We Use Golden Paths to Solve Fragmentation in Our Software Ecosystem* ของ Gary Niemen (Spotify Engineering, สิงหาคม 2020) เล่าว่ามันมีที่มาจาก tutorial สำหรับ backend engineer ที่เริ่มเป็น project ใน Hack Week ราวหกปีก่อนหน้านั้น จากนั้นก็มี path สำหรับ client development, data engineering, data science, machine learning, web และ audio processing ตามมา ส่วน tool ที่แนะนำถูกระบุไว้ใน developer portal ของ Spotify คือ Backstage และ engineer ใหม่จะทำ tutorial ของสายงานตัวเองในสองสัปดาห์แรก เป้าหมายของ Spotify คือลดการแตกกระจาย: มี variant ให้ดูแลน้อยลง และมีโอกาสมากขึ้นที่จะ upgrade หลายทีมแบบอัตโนมัติ engineer ยังออกนอก path ได้ แต่จะเสีย support ที่มากับมันไป

Netflix ใช้ชื่อ **paved road** ส่วนโพสต์ปี 2018 ของ Netflix เรื่อง full-cycle developer (Philip Fisher-Ogden, Greg Burrell และ Dianne Marsh) อธิบายชุด tool และ practice ที่ทีมส่วนกลาง support อย่างเป็นทางการ Netflix ไม่ได้บังคับให้ทีมใช้ แต่พยายามทำให้การ build และ operate บน paved road ดีกว่าการทำแบบอื่นอย่างชัดเจน

*Platforms White Paper* ของ CNCF (TAG App Delivery, version 1 เสร็จเดือนมีนาคม 2023) จัด golden path ไว้ในรายการ capability ของ internal platform: template เริ่มต้นสำหรับ project พร้อม documentation เพื่อให้ทีมเริ่มงานโดยมี capability ของ platform ต่อสายไว้ให้แล้ว

### อะไรอยู่ใน path บ้าง

path สำหรับ HTTP service ของ Acme รวมของเหล่านี้ไว้ด้วยกัน:

- **Template** ที่ generate repository: code skeleton พร้อม test, Dockerfile บน image `java-base` ที่ platform ดูแล และ `catalog-info.yaml` ของ service
- **Documentation**: site TechDocs ใน repository ใหม่ และ guide ของตัว path เอง
- **Pipeline**: shared CI/CD pipeline ของ Launchpad ที่อ้างถึงตาม version ทำหน้าที่ build, test, scan image และ deploy
- **Deployment**: namespace กับ Helm chart `acme-service` ของ platform ที่มี health probe, resource limit และ replica สองตัวบน staging
- **Infrastructure module**: Terraform module ที่สร้าง database [Amazon RDS](../amazon-rds-aurora/) for [PostgreSQL](../postgresql/) และ queue [Amazon SQS](../amazon-sqs/) โดย Vault เป็นคนออก database credential ให้
- **Observability**: Grafana dashboard บน golden signal สี่ตัว และ Prometheus alert rule ที่ page หา on-call ของทีมเจ้าของ
- **Security default**: base image ที่มีคนดูแล, image scan ใน pipeline และ secret ที่มาจาก Vault แทนที่จะวางอยู่ใน repository
- **Support**: เจ้าของ path (platform team, engineer 6 คน), channel สำหรับถามคำถาม และ changelog ของทุก template version

template ตัวนี้ทำงานที่ ticket ใช้เวลา 9 วันให้เสร็จในการรันครั้งเดียว และทำแบบเดียวกันทุกครั้ง ใน diagram ฟอร์มถูกส่งตอน 10:02 แล้ว repository กับ catalog entry ก็เกิดขึ้นในอีกหนึ่งนาที จากนั้น build แรกเขียวตอน 10:11 ส่วน database กับ queue พร้อมตอน 10:17 และ deploy แรกของ `returns` 0.1.0 ไปถึง staging ตอน 10:22 คือ 20 นาทีหลังส่งฟอร์ม การสร้าง database ใช้เวลานานที่สุด อย่างอื่นพร้อมภายในไม่กี่นาที

### Developer portal และ Backstage

path ต้องมีประตูหน้า ประตูของ Acme คือ developer portal ชื่อ **Launchpad** ที่สร้างบน **Backstage** ตัว open-source framework สำหรับ developer portal ที่ Spotify ปล่อยออกมาเมื่อมีนาคม 2020 ตัว Backstage ได้รับเข้า CNCF เมื่อกันยายน 2020 และเป็น incubating project ตั้งแต่มีนาคม 2022 ส่วน core feature สามตัวของมันที่แบก golden path ไว้คือ:

- **Software Templates** ตัว template เป็นไฟล์ YAML (`apiVersion: scaffolder.backstage.io/v1beta3`, `kind: Template`) ส่วน `parameters` ของมันเป็น JSON Schema ที่ portal render ออกมาเป็นฟอร์ม และ `steps` ของมันรัน action อย่าง `fetch:template` (render skeleton ด้วยค่าจากฟอร์ม), `publish:github` (สร้าง repository) และ `catalog:register` ซอฟต์แวร์ที่สร้างผ่าน template จะถูก register ใน catalog โดยอัตโนมัติ
- **Software Catalog** ทุก component ถูกอธิบายด้วยไฟล์ metadata ที่เก็บไว้กับโค้ด ปกติชื่อ `catalog-info.yaml` และมี field อย่าง `spec.type`, `spec.lifecycle` และ `spec.owner` ตัว catalog รวบรวมไฟล์เหล่านี้แล้วแสดงว่าใครเป็นเจ้าของอะไร นี่คือคำถามที่ on-call engineer ตอบไม่ได้สำหรับ `gift-cards`
- **TechDocs** ให้เขียน documentation เป็น Markdown ไว้ข้างโค้ด แล้วเผยแพร่ใน portal ตามแนวทาง docs-like-code โดย build ด้วย MkDocs

Backstage เป็น framework ไม่ใช่ product สำเร็จรูป: คุณต้อง run มันเอง เลือกหรือเขียน plugin ของมัน และคอย upgrade ให้ทัน องค์กรที่ไม่อยาก run เองก็ซื้อ portal แทน เช่น Port, Cortex หรือ OpsLevel หรือ Backstage distribution ที่มี support อย่าง Red Hat Developer Hub ไม่ว่าจะเลือกอะไร portal ก็เป็นแค่ประตูหน้า ตัว path คือ automation ที่อยู่หลังฟอร์ม

### ทำให้ path ทันสมัยอยู่เสมอ

template รันแค่ครั้งเดียว ตัว scaffolder render skeleton, publish repository และ register มัน หลังจากนั้นก็ไม่มีอะไรผูก repository ไว้กับ template version ถัด ๆ ไปเลย Backstage บันทึกไว้จริงว่า template ไหนสร้าง entity ไหน ใน annotation `backstage.io/source-template` (เพิ่มให้อัตโนมัติเมื่อ template เขียน `catalog-info.yaml` ด้วย action `catalog:write`) ข้อมูลนี้บอกได้ว่า template ถูกใช้ที่ไหน แต่ไม่บอกว่า version ไหน และไม่ได้เปลี่ยนอะไรใน repository การทำให้ service 32 ตัวบน path ของ Acme ทันสมัยอยู่เสมอต้องใช้ tool อื่น แบ่งเป็นสามชั้น:

1. **อ้างถึง อย่าก๊อป** อะไรที่เปลี่ยนบ่อยให้อยู่นอก repository ที่ generate และถูกอ้างถึงตาม version: base image, shared pipeline, Helm chart, Terraform module, dashboard และ alert rule แล้ว template release ก็จะกลายเป็นแค่ชุดของการ bump version เป็นส่วนใหญ่
2. **ให้ bot เป็นคน bump** Renovate (Dependabot ทำได้บางส่วนของงานเดียวกัน) เปิด pull request เมื่อมี base image, chart, module หรือ pipeline version ใหม่ออกมา ตัว Renovate รวม update ที่เกี่ยวข้องกันไว้ใน pull request เดียวได้ (`groupName`) และ update version string ในไฟล์ไหนก็ได้ด้วย custom regex manager ทาง Acme ใช้ความสามารถนี้ bump template-version annotation ของตัวเองใน `catalog-info.yaml` ใน pull request เดียวกัน ทำให้ catalog แสดงได้ว่า service ไหนตามหลังอยู่ แล้ว pipeline ของแต่ละ service ก็ test pull request ของมัน จากนั้นทีมเจ้าของก็ merge มัน ส่วนรอบของ template v4 ที่มี base image ใหม่ (`java-base:21-2026.10`) และ chart `acme-service` 4.0 ที่เพิ่ม injection annotation ของ OpenTelemetry Operator เพื่อให้ Java agent ถูก inject เข้าไปในทุก pod ตัว Renovate เปิด pull request 32 ตัว (PR #31 สำหรับ returns) และ 27 ตัวถูก merge ภายใน 7 วัน
3. **Re-apply template กับส่วนที่เหลือ** การเปลี่ยนไฟล์ที่ generate ออกมาเองต้องใช้ template tool ที่ update project ได้ `copier update` ของ Copier จะ re-apply template version ที่ใหม่กว่าและติด tag ไว้กับ project ที่มัน generate (Renovate มี manager ที่เปิด update พวกนี้ให้) และ cruft ก็ทำแบบเดียวกันสำหรับ Cookiecutter template ส่วน Backstage template ก็เปิด pull request ไปที่ repository ที่มีอยู่แล้วได้ด้วย `publish:github:pull-request` ครั้งละหนึ่ง repository ต่อการรัน องค์กรที่ใหญ่กว่าจะสร้าง tool สำหรับเปลี่ยนทั้ง fleet: Fleetshift ที่ Spotify ทำใช้เองจะรัน code transformation ที่ pack เป็น container image ในรูป Kubernetes job กับทุก repository ที่เป็นเป้า ทาง Spotify รายงานในปี 2023 ว่าหลังลงทุนเรื่อง fleet management การ update internal service framework ไปถึง backend service 70% ในราว 7 วัน แทนที่จะเป็นราว 200 วัน

### เป็นทางเลือก และต้องรับผิดชอบเองเมื่อออกไป

path คือค่า default ไม่ใช่กฎ ทีมที่มีความจำเป็นจริงออกจาก path ได้ แบบที่ทีม payments ทำกับ `payments-ledger` เพราะกฎ PCI แต่ทีมก็ต้องเป็นเจ้าของสิ่งที่ path จะทำให้: pipeline, การ patch base image, upgrade และ alert ส่วน catalog entry กับ owner ที่ระบุชื่อยังบังคับสำหรับทุก service ไม่ว่าจะอยู่บน path หรือนอก path ทั้งนี้จาก 40 service ของ Acme มี 32 ตัวที่อยู่บน path

## ลงมือทำจริงยังไง

1. **เริ่มจาก journey ที่เจอบ่อยที่สุด** ดูว่าทีมสร้างอะไรบ่อยที่สุดและรอนานที่สุดตรงไหน คำแนะนำของ DORA เรื่อง platform engineering คือเริ่มจาก minimum viable platform: หา golden path ของ workflow ที่เจอบ่อยที่สุด แล้วสร้างแค่พอจะพิสูจน์มันก่อนค่อยเพิ่มอย่างอื่น ที่ Acme นั่นคือ HTTP service ที่มี database และ queue
2. **เขียน path ออกมาก่อน แล้วค่อย automate** ตัว golden path แรก ๆ ของ Spotify ก็คือ tutorial แล้ว walkthrough ที่เขียนออกมาก็บังคับให้ต้องตัดสินใจ (base image ตัวไหน pipeline ตัวไหน alert threshold เท่าไหร่) ก่อนจะ encode มัน และมันยังมีประโยชน์ต่อในฐานะ documentation ของ path
3. **ทำ template ให้บาง** generate เฉพาะสิ่งที่ทีมจะเป็นเจ้าของและแก้: code skeleton, test, configuration และ `catalog-info.yaml` ส่วนอย่างอื่นเป็น reference ที่มี version
4. **ใส่ค่า default ไว้ในตัว** ด้าน security: base image ที่มีคนดูแล, image scan ใน pipeline, secret จาก Vault และ access แบบ least-privilege ด้าน operations: dashboard บน golden signal, alert ที่ route ไปหา on-call ของ owner, owner ใน catalog และ docs ใน TechDocs
5. **ทำ version ให้ path และวางแผน upgrade** ออก template version พร้อม changelog แล้วบันทึก version ไว้ที่ทุก service และให้ Renovate หรือ template-update tool เป็นคนเปิด pull request ส่วนแต่ละ release ให้ลองกับ service ไม่กี่ตัวก่อนจะปล่อยให้ทั้ง fleet
6. **ให้ path มีเจ้าของ** platform team เป็นเจ้าของมันแบบ product: มี channel สำหรับถามคำถาม, response time, deprecation policy สำหรับ version เก่า และช่องทางให้ developer ขอเปลี่ยนแปลง
7. **ปูทางสำหรับ day two ด้วย** ครอบคลุมสิ่งที่เกิดหลัง deploy แรก: upgrade, การทำเครื่องหมาย service หรือ template version ว่า `deprecated` ใน catalog และ decommission path ที่ลบ database, queue, dashboard, alert และ catalog entry ตอนที่ service ถูกปลด
8. **วัดผลลัพธ์** เวลาจนถึง deploy แรกบน staging (จาก 9 วันทำการเหลือ 20 นาทีที่ Acme), service ตามหลัง template ปัจจุบันแค่ไหน, incident และ change failure rate ทั้งบนและนอก path และสิ่งที่ developer พูดใน survey ส่วนงานวิจัยปี 2024 ของ DORA ผูก developer independence คือการทำงานได้โดยไม่ต้องรอทีมอื่น เข้ากับ productivity ที่สูงขึ้นราว 5% ทั้งรายบุคคลและทีม และงานวิจัยปี 2025 ก็พบว่า capability ของ platform ที่ผูกกับ developer experience ที่ดีมากที่สุดคือ feedback ที่ชัดเจนเรื่องผลลัพธ์ของงาน พอ template run หรือ pipeline fail ก็ให้บอกว่าทำไม
9. **เพิ่ม path เมื่อ journey เดิมเกิดซ้ำ ๆ** พอทีมที่สามสร้าง data pipeline ด้วยมือ path สำหรับ data pipeline ก็คุ้มกับการดูแล แต่ความชอบของทีมเดียวไม่คุ้ม ส่วน path ใหม่ทุกตัวต้องมีเจ้าของที่ยอมดูแลให้ทันสมัยอยู่เสมอ

## อยู่ตรงไหนใน solution

- [Platform as a Product](../platform-as-a-product/): platform team ดูแล Launchpad แบบ product โดยมี developer เป็นลูกค้า และ adoption ต้องได้มาจากการที่ทีมเลือกใช้เอง หน้านี้ตามเส้นทางหนึ่งเส้นผ่าน platform นั้นตั้งแต่ต้นจนจบ
- [Team Topologies](../team-topologies/): Skelton กับ Pais (ฉบับที่สอง, 2025) ใช้ cognitive load เป็นหลักการออกแบบ ส่วน platform team มีไว้เพื่อลดภาระให้ทีม stream-aligned อย่าง delivery และ golden path ก็เป็นหนึ่งในวิธีที่เห็นชัดที่สุดที่มันทำแบบนั้น
- [Kubernetes](../kubernetes/) เป็นตัว run ทุก service บน path โดย template สร้าง namespace และ deploy ผ่าน Helm chart ที่ใช้ร่วมกัน
- [GitOps](../gitops/) รับขั้น deploy ไปทำได้: pipeline เปลี่ยน desired state ใน Git แล้ว agent ใน cluster ก็ apply มัน
- [Continuous Delivery](../continuous-delivery/): ตัว shared pipeline จะ build image แต่ละตัวครั้งเดียว แล้ว promote มันผ่าน stage เดียวกันสำหรับทุก service บน path
- [Infrastructure as Code](../infrastructure-as-code/): database และ queue มาจาก Terraform module ที่ผ่าน review และมี version โดยใช้ชุดเดียวกันทุก service
- [HashiCorp Vault](../vault/) ออก database credential ตอน run time ทำให้ไม่มี secret ไหนถูกก๊อปเข้าไปใน repository
- [Prometheus & Grafana](../prometheus/) และ [Golden Signals, RED & USE](../golden-signals/) ให้ dashboard แบบเดียวกันและ alert ตามอาการ (symptom-based) กับทุก service ใหม่ตั้งแต่ deploy แรก
- [Eliminating Toil](../eliminating-toil/): ticket ขอ namespace, database และ secret คือ toil และ path ก็เป็นวิธีหนึ่งที่จะตัดมันออก
- [The Twelve-Factor App](../twelve-factor-app/): template เป็นที่ที่ดีในการใส่กฎของมันไว้ เช่น configuration ใน environment และ log ที่เขียนออก standard output
- [You Build It, You Run It](../you-build-it-you-run-it/): owner ที่ catalog ระบุคือทีมที่โดน page
- [Policy as Code](../policy-as-code/) ตรวจ guardrail ใน CI และตอน deploy ทั้งกับ service บน path และนอก path

## ใช้ตอนไหนดี

- **หลายทีมสร้าง service ที่คล้ายกัน** ด้วย engineer 60 คนกับ 40 service ของ Acme ทำให้ plumbing เดิมถูกสร้างและดูแลซ้ำแล้วซ้ำอีก ส่วน path จะคุ้มกับต้นทุนดูแลเมื่อมี service ใหม่บ่อย ๆ หรือเมื่อ service เดิมหลายตัวต้อง upgrade แบบเดียวกัน
- **เมื่อ security และ operations ต้องสม่ำเสมอ** base image, scanning, การจัดการ secret และ alert routing ทำให้ถูกต้องได้ง่ายกว่าเมื่ออยู่ในที่เดียวที่มีคนดูแล มากกว่าเมื่อกระจายอยู่ใน 40 copy
- **Onboarding** ทั้ง engineer ใหม่ หรือทีมที่เพิ่งทำ service ประเภทนั้นเป็นครั้งแรก ก็ได้ service ที่ใช้งานได้พร้อม documentation ตั้งแต่วันแรก

ส่วนตรงที่ไม่เหมาะ หรือต้องปรับ:

- **ทีมน้อยและ service น้อย** path ต้องมีเจ้าของ, upgrade และ support ส่วนถ้ามีแค่หนึ่งหรือสองทีม checklist ที่เขียนไว้กับ example repository ที่ดูแลดี ๆ ก็อาจพอแล้ว
- **ระบบ legacy** ที่ rebuild จาก template ไม่ได้ ก็ register มันใน catalog พร้อม owner ไว้อยู่ดี แล้วค่อยพามันเข้า path ตอน rebuild รอบหน้า
- **Workload ที่อยู่ใต้ regulation** ตัว path สร้างหลักฐานที่ auditor ขอได้ (ผล scan, approval ที่บันทึกไว้ใน pipeline) แต่บาง service อย่าง `payments-ledger` ต้องใช้ variant ที่เข้มกว่า หรือเส้นทางของตัวเอง
- **งานต่างประเภท** data pipeline, machine-learning job และ mobile app ต้องมี path ของตัวเอง การยืด service template ตัวเดียวให้ครอบคลุมทั้งหมดจะได้ template ที่ไม่มีใครทำตามได้
- **เผื่อช่วงตกไว้** DORA บอกว่า platform engineering มักเดินตาม J-curve: ได้ผลดีช่วงแรก แล้วตกลงตอนความซับซ้อนเพิ่มขึ้น จากนั้น performance ก็ขึ้นไปอยู่ที่ระดับที่สูงกว่าเดิมเมื่อ platform โตเต็มที่

## กับดักที่เจอบ่อย

- **Golden cage** การทำให้ path เป็นของบังคับโดยไม่มีทางออก จะดันให้ทีมที่มีความจำเป็นจริงไปหาทางอ้อมที่ไม่มีใครเห็น เช่น `kubectl apply` ที่รันด้วยมือ ควรให้ path เป็นทางเลือกและทำให้มันเป็นวิธีที่ง่ายที่สุด ให้ทีมออกไปได้เมื่อมีเหตุผล และบอกให้ชัดว่าทีมต้องเป็นเจ้าของงานที่เพิ่มขึ้นเอง ส่วน catalog entry กับ owner ที่ระบุชื่อยังบังคับสำหรับทุกคน
- **Template ที่ scaffold ครั้งเดียว แล้วปล่อยให้เน่า** template ที่ก๊อปไปแล้วจะไม่เปลี่ยนอีก ทุก service เลยใช้ base image, pipeline และ alert rule ของ version ที่มันเริ่มต้นไปตลอด ให้ส่วนที่เปลี่ยนบ่อยเป็น reference ที่มี version, เปิด upgrade pull request, บันทึก template version ไว้ที่แต่ละ service และคอยดู service ที่ตามหลัง
- **Path เยอะเกินไป** template สิบสี่ตัวสำหรับ journey ไม่กี่แบบเดิม ๆ ที่มีแค่สามตัวที่อัปเดตอยู่ ทำให้ทีมต้องเดาว่า platform team support ตัวไหน และทำให้ทีมเล็ก ๆ ต้องกระจายตัวบางเกินไป ให้มี path ไม่กี่ตัวสำหรับ journey ที่เจอบ่อย ให้แต่ละตัวมีเจ้าของ และปลดที่เหลือทิ้ง
- **มีแค่ day one** ตัว path ที่จบแค่ deploy แรกจะทิ้ง upgrade, deprecation และ decommissioning ไว้ให้ทุกทีม และ service ที่ถูกปลดก็ทิ้ง database, queue และ alert ไว้ข้างหลัง ให้ปูทางสำหรับ day two ด้วย
- **นับจำนวนครั้งที่รัน template** การรัน 120 ครั้งต่อไตรมาสบอกว่า template ถูกใช้ ไม่ได้บอกว่า service ดีขึ้น ให้วัดผลลัพธ์: เวลาจนถึง deploy แรก, upgrade lag, incident กับ change failure rate และความพอใจของ developer
- **Portal ที่ไม่มี platform** การติดตั้ง Backstage แล้วลิสต์ service ไว้ในนั้นไม่ได้ปูทางอะไรเลย คุณค่าอยู่ที่ automation หลังฟอร์ม และคนที่คอยดูแลให้มันใช้งานได้
- **ซ่อนมากเกินไป** template ที่ซ่อนสิ่งที่ตัวเองสร้างไว้ ทำให้ทีม debug มันไม่ได้ตอน 02:14 ให้ generate configuration ที่อ่านเข้าใจได้ ลิงก์แต่ละ service ไปที่ documentation ของชิ้นส่วนที่มันใช้ และทำให้ failure อธิบายตัวเองได้
