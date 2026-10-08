## ปัญหา

online shop ของ Acme Shop รันอยู่บน AWS แล้ว เป็น container บน Kubernetes บน Launchpad ของ platform team แต่ back office ยังไม่ได้รันบน AWS ระบบจัดการ order, inventory, product catalog ที่ป้อนข้อมูลให้ shop, CRM ที่ host เอง, VMware cluster, mainframe และเครื่องมือออกรายงานที่ไม่มีใครใช้ ยังรันอยู่ใน data centre ของ Acme เองที่ Bangkok: ราว 120 workload บน server 310 ตัว ที่ทีม IT 40 คนดูแลอยู่ สัญญาเช่าตึกจะหมดในอีก 18 เดือน และผู้บริหารอยากได้สามอย่าง: ออกจาก data centre ให้ได้ก่อนวันนั้น, ค่า infrastructure ต่ำลงราว 20% และเปลี่ยนแปลง back office ได้เร็วขึ้น (ตัวเลขของ Acme ในหน้านี้เป็นตัวเลขของตัวอย่างนี้เอง ไม่ใช่ผลวิจัย)

แผนแรกมองการย้ายเป็นแค่งานก็อปของ: ใช้ spreadsheet จด server ไว้ ตั้ง VPN กับ AWS account ตัวเดียว ก็อป virtual machine ข้ามไป แล้วสลับ workload ทั้ง 120 ตัวในสุดสัปดาห์เดียว แผนนี้ไม่ได้บอกเลยว่า server ไหนต้องไปด้วยกัน การย้ายจะใช้เงินเท่าไร หรือจะกลับยังไง แล้วสุดสัปดาห์นั้นก็เผยให้เห็น:

- Orders ขึ้นมาบน AWS ทั้งที่ database ของมันยังอยู่ที่ Bangkok โดยไม่มีใครเคยผูก database ตัวนี้ไว้กับ Orders ตัว Orders ส่ง query ราว 200 ครั้งต่อ order และตอนนี้ทุกครั้งต้องข้าม VPN: ครั้งละ 25 ms รวมเป็น 5 วินาทีต่อ order
- ไม่มีใครคิดราคา licence ไว้ เงื่อนไขของ licence เป็นตัวตัดสินว่า software บางตัวรันที่ไหนได้ และถูกนับยังไงบน cloud ทำให้บิลแรกกลายเป็นตัวเลขประมาณการตัวแรก
- เช้าวันจันทร์มี 31 workload พังอยู่ และไม่มีแผน rollback: ไม่มีเกณฑ์ว่าเมื่อไรควรยอมแพ้ ไม่มีทางกลับที่ตกลงกันไว้ และทีมก็ไม่เหลือเวลาจะคิดทางกลับขึ้นมาเองสด ๆ

การย้าย portfolio คือโครงการ ไม่ใช่งานสุดสัปดาห์เดียว มันต้องมีข้อเท็จจริงเรื่อง estate ก่อนที่ใครจะ commit วันที่ ต้องมีรากฐานบน cloud ก่อนที่ workload แรกจะลงไป และต้องมีวิธีย้าย workload ที่ทำซ้ำได้ เป็น batch เล็ก ๆ ที่ test และย้อนกลับได้

## ทำงานยังไง

AWS อธิบายการย้ายระบบขนาดใหญ่ว่าเป็นสามเฟสที่ทำตามลำดับ ใน *Guide for AWS large migrations* ของ AWS Prescriptive Guidance (โดย Wally Lu, Tuhin Mukherjee, Damien Renner และ Senay Swinney จาก AWS) และคู่มือคู่กันชื่อ *Mobilize your organization to accelerate large-scale migrations* คู่มือนี้นับ server ตั้งแต่ 300 ตัวขึ้นไปว่าเป็นการย้ายขนาดใหญ่ ทำให้ server 310 ตัวของ Acme เข้าเกณฑ์แบบพอดี ๆ

1. **Assess: สร้าง business case** ดูว่าองค์กรพร้อมแค่ไหน ดู portfolio รอบแรก และทำให้ stakeholder หลัก ๆ เห็นด้วยกับเป้าหมายชุดเดียวกัน ส่วนเรื่อง readiness คือ **Migration Readiness Assessment** (MRA) ของ AWS: ชุดคำถามที่จัดตามหก perspective ของ [AWS Cloud Adoption Framework](../aws-cloud-adoption-framework/) (business, people, governance, platform, security และ operations) ที่จบด้วยรายการจุดแข็ง gap และ action ส่วน discovery ของ estate แบบเร็ว ๆ กับการประมาณ total cost of ownership คร่าว ๆ ก็ทำให้ business case ครบ และ business case นี้ก็คือสิ่งที่จะจ่ายเงินให้งานที่เหลือทั้งหมด
2. **Mobilize: ปิด gap และวางรากฐาน** คู่มือ mobilize แบ่งงานเป็นแปด workstream ที่ส่วนใหญ่รันคู่กันไป: business case แบบละเอียด, portfolio discovery แบบละเอียด, application migration, migration governance, landing zone, security, risk and compliance, operations และ people (ทักษะ วัฒนธรรม การเปลี่ยนแปลง และ leadership พร้อม cloud centre of excellence) วิธีของ AWS เองส่งมอบทั้งหมดนี้ใน sprint สองสัปดาห์แปดรอบ ตัว portfolio discovery บันทึกทุกแอปพลิเคชันพร้อม infrastructure และ dependency ของมัน ให้ R กับแต่ละตัว (ดู [Cloud Migration Strategies](../cloud-migration-strategies/)) แล้วจัดกลุ่มเป็นตารางเวลาที่เรียงลำดับความสำคัญแล้ว ส่วน workstream application migration ย้ายแอปพลิเคชันธุรกิจจริงชุดแรก (workstream governance แนะนำให้เลือก 10 ถึง 30 ตัว) เพื่อพิสูจน์ landing zone, operating model และ security playbook และเพื่อ train คนด้วยงานจริง
3. **Migrate and modernize: ย้ายในวงกว้าง แล้วค่อยปรับปรุง** AWS แนะนำให้ migrate ก่อนแล้วค่อย modernise ทีหลัง การย้ายมีสองช่วง ช่วง **Initialize** ปกติใช้เวลาหนึ่งถึงสามเดือน คอยเช็กว่า landing zone และ network รับโหลดไหว train ทีม และเขียน **runbook** สำหรับ migration pattern แต่ละแบบ (rehost ไป Amazon EC2, replatform ไป Amazon RDS และอื่น ๆ) แต่ละ runbook มี task ก่อนย้าย ระหว่างย้าย และตอน cutover ส่วน **Implement** รัน runbook เหล่านั้นทีละ wave ใน **migration factory** ติดตามความคืบหน้าด้วย health-check matrix และปรับปรุง runbook หลังทุก cutover

workstream หลักสี่ตัวรองรับทั้งสองช่วง: foundation (people และ platform), project governance (scope, schedule, budget และ communication), portfolio (metadata, prioritisation และ wave planning) และ migration (replication, testing และ cutover)

### migration factory และ wave ของมัน

migration factory คือชุดของทีม runbook และ automation ที่ย้าย workload เป็นชุด ๆ ที่เรียกว่า **wave** เหมือนสายการผลิตที่ส่งชิ้นส่วนไปตามสาย คำแนะนำของ AWS (เช็กเมื่อตุลาคม 2026) วางรูปแบบไว้แบบนี้:

- **งานที่ทำซ้ำได้ส่งเข้า factory** AWS ประเมินว่า 20 ถึง 50 เปอร์เซ็นต์ของ portfolio ระดับ enterprise เป็น pattern ซ้ำ ๆ ที่ factory จัดการได้ดี ส่วนใหญ่คือ rehost และ replatform แบบเบา ๆ ทีม factory เล็กและข้ามสายงาน มีห้าถึงหก role (operations, business analyst และ owner, migration engineer, developer และ DevOps) แอปพลิเคชันซับซ้อนที่กำลัง refactor จะถูกย้ายโดยทีมของมันเอง ตามรอบ release ของมันเอง
- **move group ตัดสินว่าอะไรย้ายไปด้วยกัน** แอปพลิเคชันที่ใช้ database ร่วมกัน มี owner คนเดียวกัน หรือมี patch window เดียวกัน จะอยู่ใน move group เดียว และ wave หนึ่งก็คือ move group หนึ่งกลุ่มหรือมากกว่า ส่วน dependency ที่ทุกแอปพลิเคชันมี เช่น directory service จะถูกสร้างบน cloud ก่อน แทนที่จะเอามาใช้จัดกลุ่มอะไร
- **เริ่มเล็ก และวางแผนล่วงหน้า** portfolio playbook แนะนำให้ wave แรก ๆ มี server น้อยกว่า 10 ตัวต่อ wave, ย้าย environment development และ test ก่อน production และวางแผน wave ล่วงหน้าสี่ถึงห้า wave ไม่ใช่วางทั้งหมดทีเดียว มันคุมแต่ละ wave ไว้ไม่เกินราว 50 server และบอกว่า architect สี่คน rehost ได้ถึง 50 server ต่อสัปดาห์ ตัวอย่างของมันสำหรับช่วง implementation ย้าย 1,000 server ในหกเดือน เริ่มที่ 5 server ต่อสัปดาห์ แล้วโตขึ้นเป็น 50 ถึง 100
- **wave ซ้อนกัน** พอใช้ sprint สองสัปดาห์ แต่ละ wave ก็กินอย่างน้อยสอง sprint และปกติใช้เวลาสามถึงหกสัปดาห์ ในตัวอย่างของช่วง implementation งาน portfolio ของ wave หนึ่งใช้หนึ่งถึงสองสัปดาห์ และงาน migration ใช้สามถึงสี่สัปดาห์ ส่วนทีม portfolio ก็อยู่ล่วงหน้าราวห้า wave เพื่อให้ทีม migration ไม่มีวันขาดงาน

### Cutover, rollback และการ decommission

ทุก runbook จบที่ cutover: ช่วงเวลาที่วางแผนไว้ ที่ sync การเปลี่ยนแปลงสุดท้าย ย้าย traffic ไปที่สำเนาใหม่ และให้ application owner test แล้วยอมรับมัน ถ้าใช้ AWS Transform MGN ทาง AWS แนะนำให้ test launch อย่างน้อยสองสัปดาห์ก่อนวัน cutover แล้วระหว่าง cutover ตัว source server ยังรันอยู่ และ MGN ก็ยัง replicate มันต่อไปจนกว่า cutover จะถูก **finalise** ส่วนก่อนถึงตอนนั้น cutover ที่ไม่ผ่านยัง **revert** แล้วลองใหม่ทีหลังได้ โดยที่ user ยังใช้ source อยู่ ส่วนการ finalise จะหยุด replication และทิ้งข้อมูลที่ replicate ไว้ จากนั้น source server ก็ถูก archive

แผน rollback ต้องมีเกณฑ์ที่เขียนไว้ก่อนถึงช่วง cutover (check ที่ไม่ผ่าน, error rate, response time), คนหนึ่งคนที่มีอำนาจตัดสินใจ rollback และทางกลับที่ test มาแล้ว ต้องวางแผนเรื่องข้อมูลใหม่ด้วย: พอ user เขียนข้อมูลลงสำเนาใหม่แล้ว การกลับไปหมายถึงต้องเอาข้อมูลที่เขียนเหล่านั้นกลับไปด้วย ทีมเลยตัดสินใจ go หรือ no-go หลัง smoke test และก่อนที่ user จะกลับมาใช้งาน หรือเปิด reverse replication ทิ้งไว้สำหรับ database สำคัญ ๆ ส่วน Cloud Adoption Framework ของ Microsoft ก็ขอแบบเดียวกันในแผนการย้าย: กำหนดว่าอะไรนับเป็น deployment ที่ล้มเหลว test rollback และให้ rollback ได้รับอนุมัติไปพร้อมกับแผน

การ decommission ปิดแต่ละ wave: ปิดและล้าง source server ยกเลิกสัญญา support และ licence ของมัน อัปเดต inventory แล้วเทียบค่ารันจริงกับ business case

### Migration Acceleration Program

AWS รวมสามเฟสเดียวกันนี้ไว้เป็น **Migration Acceleration Program** (MAP) ที่ยังมีให้ใช้ในตุลาคม 2026: assess (readiness ตาม perspective ของ CAF และ model ของ total cost of ownership), mobilize (ปิด gap สร้างรากฐานด้าน operation และเลือกกลยุทธ์การย้าย) และ migrate and modernize (ด้วย migration service ของ AWS, AWS Professional Services และ partner) ตัว MAP ยังเพิ่มเครื่องมือ, training, ความเชี่ยวชาญจาก AWS Migration Competency Partners และเงินลงทุน พร้อมแนวทางเฉพาะสำหรับ workload ของ Microsoft, VMware, SAP และ mainframe

### เครื่องมือ ตอนตุลาคม 2026

| งาน | เครื่องมือของ AWS | ทำอะไร |
|---|---|---|
| Discovery, dependency และ wave planning | **AWS Transform** | AI service แบบ agentic ที่เปิดตัวเดือนพฤษภาคม 2025 โดย migration job ของมันครอบ discovery (server inventory จากหลายแหล่ง), planning (application group, dependency และ wave ที่เรียงลำดับความสำคัญแล้ว), การสร้าง landing zone และ network และการ rehost server แล้ว AWS ก็แนะนำให้ใช้มันแทน AWS Application Discovery Service และ AWS Migration Hub ที่หยุดรับลูกค้าใหม่ตั้งแต่ 7 พฤศจิกายน 2025 ส่วนลูกค้าเดิมยังทำโปรเจกต์ของตัวเองให้เสร็จได้ |
| Business case | **Migration Evaluator** | เทียบค่าใช้จ่ายวันนี้กับตัวเลือกบน AWS ที่ right-size แล้ว รวม licensing ทั้งแบบ bring-your-own และ licence-included โดยเก็บข้อมูลจาก collector แบบ agentless หรือจาก inventory ที่ import เข้ามา |
| Landing zone | **AWS Control Tower** | ตั้ง multi-account environment บน AWS Organizations พร้อม control แบบ preventive, detective และ proactive, Account Factory และ IAM Identity Center ส่วนใน landing zone version 3.3 ลงไป มันจะสร้าง Security OU ที่มี account log archive และ audit แต่ตั้งแต่ version 4.0 ไม่ต้องมี OU นี้แล้ว และเราออกแบบโครงสร้างเองได้ |
| Server rehost | **AWS Transform MGN** | ใช้ชื่อ AWS Application Migration Service จนถึง 8 มิถุนายน 2026 มัน replicate source server ต่อเนื่องในระดับ block แล้ว launch บน Amazon EC2 ปกติช่วง cutover ใช้แค่ไม่กี่นาที และมันจัดกลุ่ม server เป็นแอปพลิเคชัน และจัดแอปพลิเคชันเป็น wave |
| Database | **AWS Database Migration Service** | ย้ายครั้งเดียว หรือ ongoing replication ที่คอย sync source กับ target ไว้จนถึง cutover ส่วน DMS Schema Conversion จัดการเรื่องการเปลี่ยน database engine |
| Factory automation | **Cloud Migration Factory on AWS** | AWS Solution ที่เชื่อมเครื่องมือ discovery, migration และ CMDB เข้าด้วยกัน และทำงาน manual เล็ก ๆ จำนวนมากของ factory ให้เป็นอัตโนมัติ |
| VMware relocation | **Amazon Elastic VMware Service** | รัน VMware Cloud Foundation บน EC2 bare metal ใน VPC ของเรา และขยาย network ของ data centre ออกไปได้ virtual machine เลยใช้ IP address เดิมได้ โดย virtual machine พวกนี้ย้ายข้ามไปด้วย VMware HCX ไม่ใช่ MGN ส่วนเรื่อง licensing อยู่ในหน้า [Cloud Migration Strategies](../cloud-migration-strategies/) |

### ขั้นตอนเดียวกันบน Azure และ Google Cloud

provider อื่นอธิบาย journey เดียวกันด้วยชื่ออื่น (เช็กเมื่อตุลาคม 2026):

| | AWS | Microsoft Azure | Google Cloud |
|---|---|---|---|
| เฟส | Assess, mobilize, migrate and modernize | Cloud Adoption Framework: *plan* และ *ready* (Azure landing zone) มาก่อน แล้วคำแนะนำ *migrate* ของมันก็ไล่ไปตาม plan the migration, prepare workloads, execute, optimize, decommission | Assess, plan (รวม foundation: identity, organization structure และ network), deploy, optimize |
| Discovery และ business case | AWS Transform, Migration Evaluator | Azure Migrate (appliance หรือ collector, dependency analysis, business case) | Migration Center (discovery, TCO report, dependency, wave planning) |
| Server | AWS Transform MGN | Azure Migrate (เครื่องมือ Migrate and Modernize ของมัน) | Migrate to Virtual Machines |
| Database | AWS DMS | Azure Database Migration Service | Database Migration Service |
| โครงการที่มีเงินทุนให้ | Migration Acceleration Program | Frontier Accelerate for Azure (ตอนนี้หน้า Azure Accelerate redirect ไปที่นี่แล้ว) | Rapid Migration and Modernization Program (RaMP) |

## ลงมือทำจริงยังไง

แผนที่สองของ Acme เดินตามสามเฟสภายใน 18 เดือนที่มี เครื่องมือในนี้คือตัวที่ Acme เลือก ตัวอื่นก็ทำงานเดียวกันได้

1. **Assess เดือนที่ 1 ถึง 3** โครงการนี้มี COO เป็น sponsor และเป็นเจ้าของ business case เหมือนใน[หน้า CAF](../aws-cloud-adoption-framework/) ส่วน AWS Transform เก็บ inventory และ traffic ระหว่าง server แล้ว application owner ก็ยืนยันสิ่งที่ไม่มีเครื่องมือไหนเห็น: ใครใช้แต่ละระบบ และมีสัญญาอะไรติดมากับมันบ้าง server 310 ตัวกลายเป็น 120 workload และ dependency map ก็แสดงว่า Orders คุยกับ database ของมันตลอดเวลา และ Inventory ก็อ่าน database ตัวเดียวกัน ทั้งสามเลยรวมเป็น move group เดียว ใน business case ค่ารันรายปีวันนี้คิดเป็น 100: ถ้าก็อปไปแบบเดิม ๆ โดยใช้ server ที่ตั้งขนาดไว้รับ peak เก่า ๆ ด้วยราคา on-demand บน AWS จะเป็น 106 ส่วนถ้า right-size ใช้ Savings Plans และคิดราคา licence ทุกตัว (bring-your-own หรือ licence-included) จะเป็น 78 เลยผ่านเป้า 20% แล้ว workload แต่ละตัวก็ได้ R ตัวเดียว: rehost 45 (รวม Orders), replatform 19 (Inventory), relocate 24 (workload บน VMware cluster), repurchase 6 (CRM ย้ายไป SaaS), refactor 3 (product catalog), retire 14 (เครื่องมือออกรายงานที่ไม่มีใครใช้) และ retain 9 (mainframe) ส่วน readiness assessment ที่ให้คะแนนด้วยสเกล 1 ถึง 5 ที่ Acme ตั้งเอง ได้ค่าเฉลี่ย 1.5
2. **Mobilize เดือนที่ 4 ถึง 7** ทำเป็น sprint สองสัปดาห์แปดรอบ ตัว landing zone ที่ตั้งด้วย AWS Control Tower ใน organisation ที่ shop มีอยู่แล้วใน AWS Organizations เพิ่ม account production และ non-production ของ back office ไว้ข้าง ๆ account ของ shop และ security account (log archive และ audit) ส่วน guardrail เป็น service control policy และ Control Tower control ที่เขียนเป็น[โค้ด](../infrastructure-as-code/), sign-in ผ่าน IAM Identity Center พร้อม MFA และ network link ไปที่ Bangkok ก็ตั้งขนาดไว้รองรับ replication ตัว cloud centre of excellence (IT ของ back office, engineer สองคนจาก platform team, security engineer หนึ่งคน และคนจากฝั่ง finance หนึ่งคน) เริ่ม train คนทั้ง 40 คนในทีม IT จากนั้น pilot ห้า workload ที่ความเสี่ยงต่ำก็ขึ้น production แล้วระหว่างทาง runbook ก็ไปถึง version 3, alert ไปถึง on-call rota ที่ถูกต้อง และรายงานค่าใช้จ่ายตรงกับ tag แล้ว readiness ก็ขึ้นไปเป็น 3.1 จากนั้น wave plan ก็จัดอีก 92 workload ที่เหลือลงแปด wave ขนาด 6, 8, 10, 12, 12, 14, 15 และ 15 โดยจับกลุ่มตาม move group: VMware cluster อยู่ใน wave 4 และ 5 (relocate ไป Amazon EVS), move group ของ Orders อยู่ใน wave 6 และ workload สามตัวที่ refactor อยู่ท้ายสุด หลังจากทีมของมันสร้างใหม่บนเส้นทางของตัวเองเสร็จแล้ว
3. **Initialize และรัน factory เดือนที่ 8 ถึง 12** ตัว pilot เขียน runbook ไว้แล้ว ขั้น initialize เลยใช้แค่หนึ่งเดือน: ทีม factory (migration engineer สองคน, application analyst, operations engineer, platform engineer และ project lead อย่างละหนึ่งคน) โหลด wave plan เข้า AWS Transform MGN หลังจากนั้นก็เริ่ม wave ใหม่ทุกสองสัปดาห์ และแต่ละ wave ใช้เวลาราวสี่สัปดาห์ เลยมีสองหรือสาม wave ทำงานซ้อนกันอยู่เสมอ: server replicate ด้วย MGN (ใน wave 4 และ 5 ใช้ VMware HCX ย้าย virtual machine ของ cluster ไปที่ Amazon EVS แทน), database ใช้ AWS DMS แบบ ongoing replication, test launch รันสองสัปดาห์ก่อนแต่ละ cutover และทุก cutover เกิดคืนวันเสาร์ ตามเกณฑ์ go/no-go และ rollback ที่เขียนไว้ พอถึง wave 3 ก็มี service พิมพ์ label ตัวหนึ่งที่ smoke test ไม่ผ่าน เพราะ printer ของมันถูกอ้างถึงด้วย IP address ที่ hard-code ไว้ ตัว cutover เลยถูก revert ภายในช่วงเวลานั้น ส่วน user ก็ยังอยู่บน source และ service ตัวนี้ย้ายใน wave 6 หลังแก้เสร็จ
4. **ออกจาก data centre เดือนที่ 13 และ 14** แต่ละ wave ถูก finalise หลัง support ไปหนึ่งสัปดาห์ แล้ว source server ก็ถูก archive ปิด และล้างข้อมูลทิ้ง ส่วน workload 14 ตัวที่ retire ก็ถูกปิด และข้อมูลของมันถูก archive ไว้ถ้ากฎเรื่อง retention บังคับ ส่วน workload ที่ retain ไว้ก็ยังต้องมีที่อยู่เมื่อสัญญาเช่าหมด ตัวที่ retain ไว้ทั้งเก้าตัว (รวมถึง mainframe) เลยย้ายไปอยู่ใน rack ที่เช่าใน co-location โดยมีวัน review อีกหนึ่งปีข้างหน้า พอถึงเดือนที่ 14 data centre ก็ว่างแล้ว ก่อนสัญญาเช่าหมดสี่เดือน และ buffer นี้ก็ตั้งใจเผื่อไว้
5. **Optimise แล้วค่อย modernise ตั้งแต่เดือนที่ 12** การ right-size จากการใช้งานจริงและ Savings Plans ทำให้ค่ารันต่ำกว่าวันนี้ 21% ภายในเดือนที่ 18 ใกล้กับ business case จากนั้น modernisation ก็ทำทีละ workload เริ่มจาก Orders ที่ย้ายจาก virtual machine ที่ rehost ไว้ไปอยู่บน container บน Launchpad ที่เป็น platform ที่ทีมของ shop ใช้อยู่แล้ว

## อยู่ตรงไหนใน solution

- [Cloud Migration Strategies](../cloud-migration-strategies/) คือการตัดสินใจของแต่ละ workload ส่วนหน้านี้คือโครงการที่ลงมือทำตามการตัดสินใจเหล่านั้นทั่วทั้ง portfolio ตามลำดับและด้วยความเร็วที่องค์กรรับไหวในระยะยาว
- [AWS Cloud Adoption Framework](../aws-cloud-adoption-framework/) คือฝั่งองค์กร หก perspective ของมันเป็นโครงของ readiness assessment ในเฟส assess และ gap ที่มันเจอก็คือสิ่งที่ mobilize ปิด
- [Well-Architected Framework](../well-architected-framework/) จะ review target design ของแต่ละ workload ที่ replatform หรือ refactor ทีละตัว
- [Strangler Fig](../strangler-fig/) คือวิธีที่ refactor ที่วางแผนไว้ อย่าง product catalog ค่อย ๆ แทนที่ระบบ legacy ทีละส่วน แทนที่จะทำใน cutover ครั้งเดียว
- [Parallel Run](../parallel-run/) และ [Blue-Green Deployment](../blue-green-deployment/) ทำให้ cutover ปลอดภัยขึ้น: เทียบของเก่ากับของใหม่ด้วย input เดียวกัน และเก็บ environment เก่าไว้ครบจนกว่าตัวใหม่จะพิสูจน์ตัวเองได้
- [Change Data Capture](../change-data-capture/) คือสิ่งที่ ongoing replication ทำระหว่างการย้าย database: ก็อปข้อมูลที่มีอยู่ แล้ว stream ทุกการเปลี่ยนแปลงไปจนถึง cutover
- [Disaster Recovery Strategies](../disaster-recovery-strategies/): workload ที่ย้ายแล้วทุกตัวต้องมี recovery objective และ recovery strategy ในที่อยู่ใหม่ และการย้ายก็เป็นจังหวะที่ดีที่จะตั้งค่าพวกนี้
- [Infrastructure as Code](../infrastructure-as-code/), [Amazon VPC](../amazon-vpc/) และ [AWS IAM](../aws-iam/) คือชิ้นส่วนพื้นฐานของ landing zone: account และ guardrail จากโค้ดที่ review แล้ว, network design และ identity ที่มี single sign-on
- [FinOps](../finops/) ทำให้เห็นค่ารันเทียบกับ business case ได้ตลอด ทีละ wave
- [Platform as a Product](../platform-as-a-product/) และ [Incident Management](../incident-management/) รับช่วงต่อหลังย้ายเสร็จ: workload ที่ modernise แล้วลงไปอยู่บน internal platform และ workload ที่ย้ายแล้วทุกตัวมี owner ที่อยู่ on-call

## ใช้ตอนไหนดี

- **คุ้มค่า** กับ portfolio มากกว่ากับระบบเดียว: ออกจาก data centre, สัญญา hosting หรือ outsourcing หมด, เปลี่ยน hardware ตามรอบให้แอปพลิเคชันจำนวนมาก หรือการควบรวมกิจการ โดยเฉพาะเมื่อมีวันที่ตายตัว เฟสต่าง ๆ ทำให้ผู้บริหารได้ business case ก่อนจ่ายเงิน ทำให้ทีมได้รากฐานก่อนการย้ายครั้งแรก และทำให้การย้ายแต่ละครั้งเล็กพอจะ test และย้อนกลับได้
- **ย่อขนาดลง** สำหรับ workload ไม่กี่สิบตัว: assess กับ mobilize อาจใช้เวลาเป็นสัปดาห์แทนที่จะเป็นเดือน และ factory อาจเป็นทีมเดียวที่มี runbook เดียว แต่ให้คงลำดับไว้ เพราะการย้ายเล็ก ๆ ก็ยังพังได้จาก dependency ที่ตกหล่นและ rollback ที่ไม่มี
- **ไม่เหมาะ** กับแอปพลิเคชันตัวเดียว (เลือก R ของมันแล้วเขียน runbook เดียว) หรือ product ใหม่ที่ไม่มีอะไรต้องย้าย (เริ่มจาก landing zone และ [Well-Architected Framework](../well-architected-framework/)) ถ้ากฎระเบียบ, data residency หรืออุปกรณ์ในพื้นที่ทำให้ estate ส่วนใหญ่ต้องอยู่ที่เดิม ให้ลงทุนกับการรัน estate แบบ hybrid ให้ดีแทนโครงการย้ายระบบ
- **ปรับให้เข้า** กับองค์กร อุตสาหกรรมที่มี regulation เพิ่มการอนุมัติจาก change board, หลักฐานสำหรับ audit และกฎ data residency เข้าไปใน runbook และ landing zone ส่วนทีม IT เล็ก ๆ ก็พึ่ง partner และโครงการอย่าง MAP ก็ออกเงินให้ส่วนนี้ ส่วนเส้นตายที่ขยับไม่ได้จะดัน portfolio ไปทาง rehost และ relocate ให้ห่างจาก refactor และต้องมี buffer ก่อนถึงวันนั้น
- **ต้นทุน** คือเวลาของคนระดับอาวุโส และการรันสอง estate คู่กัน: จนกว่า data centre จะว่าง Acme ต้องจ่ายทั้งสองฝั่ง การย้ายที่ช้าเลยกัดกิน business case

## กับดักที่เจอบ่อย

- **ข้าม mobilize** การกระโดดจาก business case ไป wave เลย หมายความว่า wave แรกจะลงไปใน account ที่ไม่มี guardrail, network ที่ไม่ได้ตั้งขนาดไว้รองรับ replication, ไม่มี runbook และไม่มีใครถูก train ให้รันมัน ให้สร้าง landing zone, cloud centre of excellence และ operating model ก่อน แล้วพิสูจน์ด้วย pilot ที่ใช้ workload จริง
- **ไม่มี dependency map** การย้ายทีละ server แยกแอปพลิเคชันที่คุยถี่ออกจาก database ของมัน และทำให้ nightly job, file system ที่ใช้ร่วมกัน และ licence server พัง ให้ map dependency ด้วยเครื่องมือ discovery ยืนยันกับ application owner แล้วย้ายแต่ละ move group ใน wave เดียว
- **ไม่มีแผน rollback** ถ้าไม่มีเกณฑ์ที่เขียนไว้ คนที่มีอำนาจตัดสินใจ และทางกลับที่ test มาแล้ว พอ cutover ไม่ผ่าน มันก็จะกลายเป็นคืนที่ยาวนานกับการแก้แบบจำใจ ใส่เกณฑ์ไว้ใน runbook เก็บ source ไว้ครบจนกว่า cutover จะถูก finalise และซ้อม rollback ระหว่าง pilot
- **modernise กลางการย้าย** "ไหน ๆ ก็ย้ายแล้ว แยกมันเป็น service ไปเลยดีกว่า" ทำให้ wave สองสัปดาห์กลายเป็นโปรเจกต์ที่ไม่มีวันจบ และสัญญาเช่าก็ไม่รอ ให้ย้ายก่อนแล้วค่อย modernise ส่วน refactor ไม่กี่ตัวที่วางแผนไว้ก็ให้อยู่บนเส้นทางของมันเอง
- **ลืมเรื่อง licence** เงื่อนไขของ licence อาจตัดปลายทางบางแบบทิ้ง และเปลี่ยนต้นทุนของแบบอื่น และมันทำให้ business case ล่มได้หลังย้ายไปแล้ว ให้คิดราคาทุก operating system, database และ product สำเร็จรูประหว่าง assess แล้วเทียบตัวเลือก bring-your-own กับ licence-included ก่อนเลือก R
- **หลัง cutover แล้ว server ยังเปิดทิ้งไว้** workload ที่ย้ายแล้วแต่ source ยังรันอยู่ คือการจ่ายสองรอบ และสำเนาที่ไม่ได้ optimise อาจแพงกว่าตอนอยู่ใน data centre ด้วยซ้ำ ให้ finalise ทุก cutover, archive และปิด source, ยกเลิกสัญญาของมัน และ right-size สำเนาใหม่จากการใช้งานจริง
- **wave แรกใหญ่ หรือวางแผนทุก wave ตั้งแต่ต้น** wave แรก ๆ ที่ใหญ่จะพังก่อนที่ runbook จะได้ test และแผนที่ครอบทุก wave ก็เก่าไปเมื่อเจอ dependency ใหม่ ๆ ให้เริ่มจาก wave เล็ก ๆ ที่ง่าย ใน environment ที่ไม่ใช่ production วางแผนล่วงหน้าไว้แค่ไม่กี่ wave และให้แต่ละ wave ช่วยปรับปรุง runbook
