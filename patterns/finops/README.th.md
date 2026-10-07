## ปัญหา

บน cloud การซื้อ capacity เป็นส่วนหนึ่งของงาน engineering ใครก็ตามที่ merge Terraform change หรือ scale deployment ได้ก็ใช้เงินได้ บิลมาถึงหลังจากนั้นหลายสัปดาห์ และบิลก็จัดกลุ่มตาม account, service และ usage type ไม่ใช่ตามทีมหรือ product แล้วก็มีสามเรื่องที่พังพร้อมกัน เรื่องแรก ไม่มีใครบอกได้ว่าใครทำให้เกิดต้นทุนก้อนไหน เพราะ resource ไม่มี tag เจ้าของ หรือมีแต่เป็นค่าที่พิมพ์กันอิสระ ส่วน cluster, logging และ network ที่ใช้ร่วมกันก็บังไว้ว่า workload ไหนใช้อะไรไป เรื่องที่สอง ไม่มีใครเทียบค่าใช้จ่ายกับสิ่งที่ธุรกิจได้กลับมา บิลที่โตตามธุรกิจเลยดูไม่ต่างจากบิลที่โตเพราะของเหลือทิ้ง เรื่องที่สาม คนที่เกี่ยวข้องพูดถึงเงินก้อนเดียวกันด้วยภาษาคนละแบบ: finance พูดเรื่อง budget, forecast และ cost centre ส่วน engineering พูดเรื่อง node, pod และ CPU ทางแก้ที่เห็นกันบ่อยคือการสั่งลดต้นทุนจากข้างบน ที่ประหยัดได้ครั้งเดียวจนบิลค่อย ๆ กลับขึ้นมาอีก หรือไม่ก็ไม่ทำอะไรเลยจนกว่า finance จะเริ่มถาม

ฉบับของ Acme Shop ด้วยตัวเลขของตัวอย่างนี้เอง: บิล AWS รายเดือนโตจาก $80,000 ในเดือนมกราคม เป็น $130,000 ในเดือนมิถุนายน ใน Cost Explorer ค่าใช้จ่าย 35% ของเดือนมิถุนายนไม่มี tag `team` ส่วนที่เหลือก็กระจายอยู่ในตัวสะกดหลายแบบ เช่น `Checkout` และ `checkout` ตัว EKS cluster ที่ใช้ร่วมกันเป็นแค่บรรทัดเดียวในบิล ส่วน load-test cluster ชื่อ `loadtest-2` ถูกปล่อยว่างมาตั้งแต่เดือนเมษายน แล้ว staging ก็รันทั้งสัปดาห์ node ของ production ใช้ CPU เฉลี่ย 12% และทุกชั่วโมงก็จ่ายในราคา on-demand

## ทำงานยังไง

**FinOps** คือ practice ที่ FinOps Foundation อธิบายไว้ ตัว Foundation เป็น project ของ Linux Foundation มาตั้งแต่มิถุนายน 2020 นิยามของมันถูกปรับไปพร้อมกับ framework ปี 2026 ในเดือนมีนาคม 2026 และมีสามส่วน: FinOps เป็นทั้งวิธีทำงานและวัฒนธรรม เป้าหมายคือได้ business value มากที่สุดจากเงินที่องค์กรจ่ายไปกับเทคโนโลยี และทำได้ด้วยการให้ข้อมูลที่ทันเวลากับคนที่ต้องตัดสินใจ กับการให้ engineering, finance และฝั่งธุรกิจรับผิดชอบเรื่องเงินร่วมกัน ชื่อนี้มาจากการรวม *finance* กับ *DevOps* เข้าด้วยกัน ส่วน Foundation ก็แนะนำว่าไม่ควรขยายชื่อเป็น "cloud financial operations" เพราะสับสนง่ายกับงาน operations ของฝ่ายการเงินเอง เป้าหมายคือ value ไม่ใช่บิลที่ต่ำที่สุด และบางครั้งการตัดสินใจที่ถูกก็คือจ่ายมากขึ้น

**FinOps Framework** (finops.org เผยแพร่ภายใต้ CC BY 4.0) วาง **principle** ไว้หกข้อ โดยไม่ได้เรียงตามลำดับความสำคัญ:

1. **Teams need to collaborate.** finance, ฝั่งเทคโนโลยี, product และผู้บริหารดูแลต้นทุนด้วยกัน ด้วยความเร็วและระดับรายละเอียดที่เทคโนโลยีแต่ละแบบต้องการ
2. **Business value drives technology decisions.** unit metric บอกอะไรได้มากกว่ายอดรวม และการแลกกันระหว่างต้นทุน คุณภาพ และความเร็ว ก็ต้องเป็นการเลือกอย่างตั้งใจ
3. **Everyone takes ownership for their technology usage.** ความรับผิดชอบอยู่กับ engineer ที่ออกแบบและรันระบบ และต้นทุนก็เป็น metric ชั้นหนึ่งตั้งแต่ต้น lifecycle
4. **FinOps data should be accessible, timely, and accurate.** แชร์ข้อมูลต้นทุนทันทีที่ได้มา เพราะ feedback ที่เร็วทำให้พฤติกรรมเปลี่ยน
5. **FinOps should be enabled centrally.** ทีมกลางกระจาย good practice ออกไป และรับงานที่ทำในสเกลใหญ่แล้วคุ้มกว่าไว้เอง เช่น commitment discount เพื่อให้ engineer โฟกัสที่ usage ของตัวเองได้
6. **Take advantage of the variable cost model of the cloud.** วางแผนและซื้อ capacity แบบ just in time และปรับทีละน้อยอย่างต่อเนื่อง ดีกว่านาน ๆ ทีค่อยมาเก็บกวาดครั้งใหญ่

งานเดินผ่านสาม **phase** ที่วนทำซ้ำ ไม่ได้ทำครั้งเดียวจบ และคนละคนก็ทำงานอยู่คนละ phase ในเวลาเดียวกันได้:

- **Inform:** เก็บข้อมูลต้นทุน, usage และ efficiency แล้ว allocate ไปให้เจ้าของ ทำ report และ forecast และผูกค่าใช้จ่ายเข้ากับ business value
- **Optimize:** ใช้ภาพนั้นหาทางเลือกในการปรับปรุงแล้วจัดลำดับ ทั้ง **usage optimisation** (ใช้ resource น้อยลงโดยยังได้ผลที่รับได้ ส่วนใหญ่เป็นงานของ engineering) และ **rate optimisation** (จ่ายราคาต่ำลงสำหรับ resource ที่ยังต้องใช้ ทำร่วมกับฝ่ายจัดซื้อและผู้บริหาร)
- **Operate:** ลงมือทำการเปลี่ยนแปลงที่เลือกไว้และปรับปรุงตัว practice เอง ด้วย policy, automation, budget และการ review แล้วกลับไปที่ Inform เพื่อเช็กผล

Building block อื่น ๆ ของ framework:

- **Domain และ capability** มีสี่ domain ที่อธิบายผลลัพธ์ และ 22 capability ที่อธิบายงาน ได้แก่ *Understand Usage & Cost* มี Data Ingestion, Allocation, Reporting & Analytics, Anomaly Management ส่วน *Quantify Business Value* มี Planning & Estimating, Forecasting, Budgeting, KPIs & Benchmarking, Unit Economics ส่วน *Optimize Usage & Cost* มี Architecting & Workload Placement, Usage Optimization, Rate Optimization, Licensing & SaaS, Sustainability และ *Manage the FinOps Practice* มี FinOps Practice Operations; Governance, Policy & Risk; FinOps Assessment; Automation, Tools & Services; FinOps Education & Enablement; Invoicing & Chargeback; Intersecting Disciplines; Executive Strategy Alignment ส่วนฉบับปรับปรุงปี 2026 ก็เพิ่ม Executive Strategy Alignment เข้ามา และอัปเดต capability หลายตัว บางตัวได้ชื่อใหม่: Workload Optimization ตอนนี้คือ Usage Optimization, Policy & Governance ตอนนี้คือ Governance, Policy & Risk, Architecting for Cloud ตอนนี้คือ Architecting & Workload Placement และ Cloud Sustainability ตอนนี้คือ Sustainability บทความเก่า ๆ เลยยังใช้ชื่อเดิมอยู่
- **Scope** (เริ่มมีในปี 2025 และปรับให้ชัดขึ้นในปี 2026) scope คือก้อนของค่าใช้จ่ายที่ข้ามหมวดเทคโนโลยี ผูกกับโครงสร้างทางธุรกิจ เช่น product, cost centre หรือ environment และเป็นตัวตัดสินว่า persona, capability และเป้าหมายไหนบ้างที่ใช้กับมัน หลาย practice เริ่มจาก scope เดียวสำหรับค่าใช้จ่าย public cloud ส่วน SaaS, license, data centre และค่าใช้จ่ายด้าน AI ก็เป็น scope อื่นได้ ส่วน framework แนะนำให้สร้าง scope ใหม่ก็ต่อเมื่อมันทำให้ตัดสินใจได้ดีขึ้น ในที่นี้ scope ของ Acme คือค่าใช้จ่าย AWS ของร้าน
- **Persona** persona หลักคือ FinOps practitioner, engineering, finance, product, ฝ่ายจัดซื้อ และผู้บริหาร ส่วน allied persona มาจาก IT asset management, IT financial management, IT service management, security และ sustainability
- **Maturity** แต่ละ capability ถูกประเมินแยกกันเป็น Crawl, Walk หรือ Run เป้าหมายตัวอย่างของ framework ช่วยให้เห็นภาพของแต่ละระดับ: ที่ Crawl ต้นทุนอย่างน้อย 70% allocate ไปให้เจ้าของได้ commitment coverage อยู่ราว 60% และ forecast คลาดจากของจริงไม่เกิน 20% ที่ Walk คือ 85%, มากกว่า 75% และไม่เกิน 10% ที่ Run คือมากกว่า 90%, มากกว่า 80% และไม่เกิน 5% ส่วนตัว framework ก็บอกไว้ตรง ๆ ว่าเป้าหมายไม่ใช่การเป็น Run ทุกเรื่อง: ให้พัฒนา capability ที่คืน value ได้มากที่สุด

**FOCUS** หรือ FinOps Open Cost and Usage Specification คือ format เปิดของ Foundation สำหรับข้อมูล billing เพื่อให้อ่านต้นทุนและ usage จาก cloud provider, SaaS vendor และ data centre ด้วย column ชุดเดียวกันได้ เวอร์ชัน 1.4 ได้รับการรับรองในเดือนมิถุนายน 2026 และเพิ่ม dataset ของ invoice และ billing period พร้อมรายละเอียดเรื่อง commitment อีกมาก provider แต่ละเจ้าก็ตามมาด้วยความเร็วของตัวเอง: ตอนนี้ AWS Data Exports ส่ง FOCUS 1.2 (และ 1.0) โดยมี column เฉพาะของ AWS อีกไม่กี่ตัว

**Unit economics** ผูกค่าใช้จ่ายเข้ากับ value ที่มันสร้าง ตัว capability Unit Economics ของ framework แยก metric ด้าน resource efficiency (ต้นทุนต่อ GB ที่เก็บ ต่อ vCPU ต่อ token) ออกจาก business metric (ต้นทุนต่อ transaction ต่อลูกค้า) และบอกว่าแนวโน้มภายใน scope ตามเวลามักมีประโยชน์กว่าตัวเลขตัวใดตัวหนึ่ง Acme ใช้ **ต้นทุนต่อ 1,000 order**: บิล AWS รายเดือนหารด้วยจำนวน order ของเดือนนั้นเป็นหลักพัน ระหว่างมกราคมถึงกรกฎาคมมันขึ้นจาก $3.25 เป็น $4.10 ทำให้เห็นว่าต้นทุนโตเร็วกว่าธุรกิจ ตั้งแต่ก่อนที่ใครจะไปดู resource สักตัว

หนังสือมาตรฐานคือ *Cloud FinOps* ของ J.R. Storment และ Mike Fuller ผู้นำของ FinOps Foundation (O'Reilly, ฉบับที่ 2, 2023) ส่วนต่าง ๆ ของหนังสือเรียงตาม phase Inform, Optimize และ Operate

## ลงมือทำจริงยังไง

ลำดับที่ Acme ทำ โดยยกเครื่องมือของ AWS เป็นตัวอย่าง ส่วน cloud อื่นและ platform ของ third party ก็มีของที่ใช้แทนกันได้

1. **ตกลง allocation model ให้ได้ก่อน** ตัดสินใจว่าจะ allocate ต้นทุนไปให้ใคร (สำหรับ Acme คือ product team หกทีมกับ platform team) และ tag ไหนที่บอกเรื่องนี้: `team`, `service` และ `env` ส่วน AWS account เป็นขอบเขตที่หยาบที่สุดแต่เชื่อถือได้ที่สุด ทำให้ production, staging และ sandbox อยู่แยก account กัน
2. **บังคับ tag ตรงจุดที่สร้าง resource** tag policy ของ AWS Organizations ทำให้ key และ value ของ tag เป็นมาตรฐานเดียวกัน (ไม่มี `Checkout` อยู่ข้าง `checkout` อีกแล้ว) และ *required tag keys* ของมันก็เตือนหรือ block deployment ของ CloudFormation, Terraform และ Pulumi ที่ลืมใส่ tag ได้ แต่ tag policy ไม่ได้รายงานว่า resource ที่ไม่มี tag เลยสักตัวเป็น non-compliant (AWS Resource Explorer ลิสต์ resource พวกนี้ได้ด้วย query `tag:none`) การตรวจเลยควรอยู่ใน deployment path ส่วนใน Kubernetes ก็ใช้ admission policy เช่น require-labels policy ของ Kyverno หรือ OPA Gatekeeper ปฏิเสธ pod ที่ไม่มี label `team` และ template ของ platform กับ shared infrastructure module ควรตั้ง tag ให้เป็นค่า default เพื่อให้ทีมส่วนใหญ่ไม่ต้องคิดเรื่องนี้เลย
3. **Activate tag สำหรับ billing** ตัว tag ที่ผู้ใช้กำหนดเองจะโผล่ใน Cost Explorer และข้อมูล cost and usage ก็ต่อเมื่อ activate เป็น cost allocation tag ใน management account แล้วเท่านั้น ส่วน key ใหม่อาจใช้เวลาถึง 24 ชั่วโมงกว่าจะโผล่ และอีกไม่เกิน 24 ชั่วโมงกว่าจะ activate เสร็จ ตัว backfill ใช้การ activate ย้อนหลังได้ถึง 12 เดือนก่อนหน้า แต่เฉพาะเดือนที่ resource มี tag นั้นอยู่จริง ทำให้ tag ที่เพิ่มในเดือนกรกฎาคมอธิบายเดือนมิถุนายนไม่ได้ นี่คือเหตุผลที่ showback แรกของ Acme เป็นของเดือนกรกฎาคม
4. **แบ่งของที่ใช้ร่วมกัน** สำหรับ EKS ตัว split cost allocation data จะแบ่งต้นทุนของแต่ละ node ให้ pod ตาม CPU และ memory ที่ pod จองไว้หรือใช้จริง เอาค่าที่สูงกว่า แล้วกระจาย capacity ที่ว่างอยู่ของ node ไปให้ pod ตามสัดส่วน และยัง import Kubernetes label มาเป็น cost allocation tag ได้ด้วย ส่วน OpenCost ที่เป็น CNCF incubating project มาตั้งแต่ตุลาคม 2024 ก็ allocate แบบคล้ายกันได้ใน Kubernetes cluster ไหนก็ได้ ส่วนบิลที่ใช้ร่วมกันที่เหลือ (observability, CI/CD, support, data transfer) AWS Cost Categories แบ่งก้อนที่ใช้ร่วมกันได้ตามสัดส่วน ตามเปอร์เซ็นต์ที่ตั้งไว้ หรือแบ่งเท่า ๆ กัน Acme แบ่ง $38,800 ของ platform ตามสัดส่วนต้นทุนตรงของแต่ละทีม เป็นกติกาที่เขียนไว้ร่วมกับ finance
5. **Show back ทุกวัน ในที่ที่คนดูอยู่แล้ว** แต่ละทีมเห็นต้นทุนของตัวเองทุกวัน ผ่าน view ใน Cost Explorer หรือ dashboard ที่สร้างบน export ของ CUR 2.0 หรือ FOCUS ตัว **showback** รายงานต้นทุน ส่วน **chargeback** ลงบัญชีต้นทุนนั้นกับ budget ของทีมในระบบบัญชี framework บอกว่าความต่างอยู่ที่ความเป็นทางการของการลงบัญชี และหลายองค์กรก็เริ่มจาก showback แล้วค่อยเพิ่ม chargeback เมื่อ finance ต้องการ
6. **ติดตาม unit cost** เลือกตัววัด value ที่ธุรกิจนับอยู่แล้ว เช่นจำนวน order แล้วคำนวณต้นทุนต่อหน่วยทุกเดือน และอ่านมันเป็นแนวโน้มคู่กับบิล
7. **เฝ้าดู anomaly** ตัว AWS Cost Anomaly Detection เรียนรู้รูปแบบการใช้จ่ายด้วย machine learning แล้ว alert ทางอีเมลหรือผ่าน [SNS](../amazon-sns/) topic ที่ส่งต่อเข้า chat channel ได้ ส่วน monitor หนึ่งตัวเฝ้าดู service, member account, cost allocation tag หรือ cost category ได้ แต่ละทีมเลยมี monitor ของตัวเองได้ มันรันราววันละสามครั้งบนข้อมูลที่อาจเก่าได้ถึง 24 ชั่วโมง เลยจับต้นทุนที่พุ่งไม่หยุดได้ภายในหนึ่งวัน ไม่ใช่ภายในไม่กี่นาที: ทีม search ของ Acme รู้ตอนเช้าวันต่อมาว่ามี debug logging ที่เปิดค้างไว้หลัง release และกินเงินวันละ $480
8. **Optimize usage ก่อน** เอาของเหลือทิ้งออก (cluster ที่ว่าง, volume ที่ไม่ได้ attach, snapshot เก่า) ตั้งเวลาเปิดปิด environment ที่ไม่ใช่ production (ตัวอย่างของ cost pillar ใน Well-Architected เองคือ development environment ที่ใช้ 40 จาก 168 ชั่วโมงของสัปดาห์ ที่จะประหยัดได้ราว 75% ถ้าปิดไว้ในเวลาที่เหลือ) rightsize โดยใช้ AWS Compute Optimizer กับ instance, volume และ Lambda function และใน Kubernetes ก็ตั้ง pod request จาก usage ที่เห็นจริง และใช้ node autoscaler เช่น Karpenter ที่รวม node ที่ใช้ไม่เต็มเข้าด้วยกัน แล้วย้ายข้อมูลที่ไม่ค่อยมีคนอ่านไปไว้ใน storage class ที่ถูกกว่าด้วย S3 Lifecycle rule หรือ S3 Intelligent-Tiering การย้ายด้วย Lifecycle คิดเงินต่อ object และโดย default จะข้าม object ที่เล็กกว่า 128 KB ส่วน Glacier class ก็คิดเงินขั้นต่ำตามระยะเวลาเก็บ (90 วันสำหรับ Glacier Flexible Retrieval) เลยควรรวมไฟล์ log เล็ก ๆ เป็นก้อนก่อนจะย้าย tier
9. **แล้วค่อย optimize rate** ตัว **Savings Plans** คือการ commit ยอดใช้จ่ายต่อชั่วโมงที่คงที่เป็นเวลาหนึ่งหรือสามปี: Compute Savings Plans ให้ส่วนลดได้ถึง 66% จากราคา on-demand และครอบคลุม Fargate กับ Lambda ด้วย ส่วน EC2 Instance Savings Plans ให้ได้ถึง 72% สำหรับ instance family เดียวใน Region เดียว แล้ว Database และ SageMaker AI Savings Plans ก็ครอบคลุม service พวกนั้น เงื่อนไขเปลี่ยนไม่ได้หลังซื้อแล้ว นี่คือเหตุผลที่มันต้องมาหลัง rightsize ส่วน **Spot** capacity ขาย EC2 capacity ที่เหลืออยู่ในราคาลดได้ถึง 90% จาก on-demand โดยเตือนล่วงหน้าสองนาทีก่อนโดน interrupt เหมาะกับ CI runner และ batch job ที่ restart ได้ ส่วน FinOps practitioner ของ Acme ก็ซื้อ commitment จากส่วนกลางร่วมกับ finance ตามที่ framework แนะนำ
10. **ทำให้ loop เดินต่อไป** ให้แต่ละทีมมี AWS budget ที่ alert ทั้งค่าใช้จ่ายจริงและค่าที่ forecast ไว้ (budget refresh ได้ถึงวันละสามครั้ง) จัด review รายเดือนกับ engineering, finance และ product และขอประมาณการต้นทุนในทุก design review ติดตามตัว practice ด้วยตัวเลขไม่กี่ตัว: สัดส่วนที่ allocate ได้ commitment coverage และ utilisation ความแม่นของ forecast และ unit cost

ตัวเลือกที่ Acme ใช้ คิดเป็นเงินที่ประหยัดได้ต่อเดือนที่ volume ของเดือนกรกฎาคม (เป็นตัวเลขของตัวอย่างนี้เอง):

| ตัวเลือก | ประเภท | เจ้าของ | ประหยัดได้ต่อเดือน |
|---|---|---|---|
| ลบ cluster `loadtest-2` ที่ว่างอยู่ | usage: ของเหลือทิ้ง | ทีม checkout | $7,400 |
| Rightsize node ของ production จาก 8 → 5 ตัวที่เล็กลง และ CPU เฉลี่ยจาก 12% → 40% | usage: rightsizing | platform team | $12,600 |
| รัน staging แค่ 07:00–19:00 วันธรรมดา 60 จาก 168 ชั่วโมง | usage: ตั้งเวลา | platform team | $5,800 |
| S3 Lifecycle: ย้าย log ไป S3 Glacier Flexible Retrieval หลัง 30 วัน และลบหลังหนึ่งปี | usage: storage class | platform team | $2,200 |
| Compute Savings Plan หนึ่งปี ตามขนาดของ baseline ที่เล็กลงแล้ว | rate: commitment | FinOps practitioner และ finance | $10,000 |
| Spot สำหรับ CI runner และงาน import catalog ตอนกลางคืน | rate: capacity ที่ interrupt ได้ | platform team และทีม catalog | $3,000 |
| **รวม** | | | **$41,000** |

บิลและ unit cost เป็นตัวเลขของตัวอย่างนี้เองเหมือนกัน:

| | มกราคม | มิถุนายน | กรกฎาคม | กันยายน | พฤศจิกายน (forecast) |
|---|---|---|---|---|---|
| บิล AWS | $80,000 | $130,000 | $132,800 | $98,600 | $121,000 |
| Order | 24.6 M | 31.7 M | 32.4 M | 34.0 M | 43.2 M |
| ต้นทุนต่อ 1,000 order | $3.25 | $4.10 | $4.10 | $2.90 | $2.80 |

## อยู่ตรงไหนใน solution

- **[Well-Architected Framework](../well-architected-framework/)** ตัว design principle ของ cost optimisation pillar (implement cloud financial management, adopt a consumption model, measure overall efficiency, stop spending money on undifferentiated heavy lifting, analyse and attribute expenditure) ถามว่าต้นทุนของ workload มีคนเข้าใจและเป็นเจ้าของหรือเปล่า การ review หนึ่งครั้งเจอช่องโหว่ใน workload หนึ่งตัว ส่วน FinOps คือ practice ต่อเนื่องทั้งองค์กรที่คอยปิดช่องโหว่พวกนั้นไว้
- **[Policy as code](../policy-as-code/)** คือวิธีบังคับใช้กฎเรื่อง tag: เป็น check ใน pipeline และ admission policy ใน cluster แทนที่จะไล่ติด tag กันทุกไตรมาส
- **[Platform as a product](../platform-as-a-product/)**, **[golden paths](../golden-paths/)** และ **[infrastructure as code](../infrastructure-as-code/)** ตัว platform team เป็นเจ้าของต้นทุนที่ใช้ร่วมกันและกติกาที่ใช้แบ่งมัน template และ module ของทีมนี้เป็นตัวใส่ tag และ golden path ของทีมก็แสดงต้นทุนที่คาดไว้ของ service ใหม่ได้ก่อนจะ ship
- **[Kubernetes](../kubernetes/)** และ **[autoscaling](../autoscaling/)** ตัว pod request ตัดสินทั้งเรื่อง scheduling และ (เมื่อใช้ split cost allocation data) สัดส่วนของ node ที่แต่ละทีมต้องจ่าย ทำให้ request ที่ตั้งไว้สูงเกินจริงไปโผล่ใน showback ของทีม ส่วน autoscaling ก็คือ consumption model ที่ทำงานอยู่จริง: scale in เมื่อ demand ลดลง
- **[Serverless](../serverless/)** และ **[AWS Lambda](../aws-lambda/)** เปลี่ยนต้นทุนเป็นราคาต่อ request ทำให้คำนวณ unit cost ได้ง่าย แต่ก็ทำให้ function ที่ยุ่งหรือรันไม่หยุดดันบิลให้โตได้โดยไม่ต้องมีใคร provision อะไรเลย Compute Savings Plans ก็ใช้กับ Lambda ได้ด้วย
- **[Amazon S3](../amazon-s3/)**: storage class และ lifecycle rule คือตัวเลือกฝั่ง storage และ bucket ของ log หรือ backup ที่ไม่มีขอบเขตก็เป็นการรั่วช้า ๆ แบบคลาสสิก
- **[Amazon CloudWatch](../amazon-cloudwatch/)**: การ ingest log และ custom metric โตเงียบ ๆ ได้ แบบที่ log ของทีม search ของ Acme เป็น และค่า log retention ก็เป็นตัวเลือกฝั่ง usage
- **[SLOs and error budgets](../slo-error-budgets/)** กำหนดขอบเขตที่การลดต้นทุนต้องเคารพ: การประหยัดที่ไปกิน error budget ไม่ใช่การประหยัด
- **[You build it, you run it](../you-build-it-you-run-it/)** ขยายไปเป็น *you pay for it* ได้อย่างเป็นธรรมชาติ: ทีมที่เป็นเจ้าของ service ก็เห็นและดูแลต้นทุนของมันด้วย

## ใช้ตอนไหนดี

- **คุ้มเมื่อค่าใช้จ่าย cloud สูง กำลังโต และมีหลายทีมเป็นคนกำหนด** ถ้ามี engineer 60 คนและบิลเดือนละ $130,000 ของเหลือทิ้งแค่ไม่กี่เปอร์เซ็นต์ก็จ่ายค่า practice นี้ได้แล้ว และมีแค่ทีมเองที่แก้ usage ของตัวเองได้ ตัวที่ได้ประโยชน์มากที่สุดคือ shared platform อย่าง Kubernetes ที่ต้นทุนถูกซ่อนไว้จนกว่าจะแบ่ง และ service ที่คิดราคาตามการใช้ (serverless, data platform, AI API)
- **เริ่มที่ Crawl เมื่อองค์กรยังเล็ก** ทีมเดียวที่บิลไม่สูงต้องการแค่ tag เจ้าของ, budget alert และการดูบิลเดือนละครั้ง ไม่ต้องมี FinOps team หรือซื้อเครื่องมือ ตัว framework เองก็บอกให้พัฒนาเฉพาะ capability ที่คืน value
- **ปรับให้เข้ากับ budget ที่ตายตัวและการบัญชีแบบเป็นทางการ** องค์กรภาครัฐและองค์กรที่อยู่ใต้ regulation มักวางแผนล่วงหน้าหนึ่งปี และต้องมี chargeback ที่ทำตามกฎการบัญชี ที่นั่น forecasting และ budgeting สำคัญกว่า และ commitment ก็ต้องผ่านฝ่ายจัดซื้อ
- **คาดไว้ว่าจะได้ผลน้อยลงกับต้นทุนที่ส่วนใหญ่คงที่** data centre, enterprise license และสัญญาระยะยาวไม่ได้ scale ลงรายชั่วโมง scope ของ framework ครอบคลุมพวกนี้ แต่ตัวเลือกที่ใช้ได้คือสัญญาและการวางตำแหน่ง workload ไม่ใช่ rightsizing
- **การจ่ายมากขึ้นอาจเป็นทางที่ถูก** product ช่วงแรกที่กำลังเร่งหาตลาดอาจเลือกความเร็วมากกว่า efficiency ได้อย่างมีเหตุผล FinOps ทำให้เรื่องนี้เป็นการตัดสินใจที่บันทึกไว้ ไม่ใช่เรื่องบังเอิญ
- **ตัวมันเองก็มีต้นทุน:** การดูแล tag และกติกาการ allocate ให้ถูกต้อง, data pipeline และ dashboard, ค่า FinOps practitioner และเวลาของทุกคนในการ review

## กับดักที่เจอบ่อย

- **ลดต้นทุนจนเสีย reliability หรือ value** การย้าย pod ของ checkout ไปใช้ Spot การเอา database replica ออก หรือการทิ้ง log ที่ incident ต้องใช้ ประหยัดเงินได้จนถึง outage ครั้งถัดไป ให้ถือว่า SLO และ product requirement เป็นข้อจำกัด และให้ทีมที่เป็นเจ้าของ service ตัดสินใจเรื่อง trade-off โดยมีตัวเลขอยู่ตรงหน้า
- **ไล่ดูยอดบิลรวมแทน unit cost** บิลเดือนพฤศจิกายนของ Acme คาดว่าจะสูงกว่ากันยายน 23% เพราะเป็นช่วงพีค ในขณะที่ต้นทุนต่อ 1,000 order ลดลงเหลือ $2.80 ยอดรวมที่โตตามธุรกิจไม่ใช่ปัญหา ให้ตัดสิน efficiency จาก unit cost และอธิบายส่วนต่างเทียบกับ forecast
- **ทีมกลางทำ FinOps *ใส่* engineer แทนที่จะทำ *ร่วมกับ* พวกเขา** spreadsheet ที่ส่งอีเมลมาเดือนละครั้งกับ ticket "ลด 20% ภายในวันศุกร์" สอนให้ทีมเถียงแทนที่จะลงมือทำ ให้เอาข้อมูลของแต่ละทีมไปไว้ในเครื่องมือที่ทีมใช้อยู่แล้ว ให้เจ้าของเป็นคนตัดสินใจเรื่องการเปลี่ยน usage และให้ทีมกลางดูแลเรื่อง enablement กติกาที่ใช้ร่วมกัน และการตัดสินใจเรื่อง rate
- **Commit ส่วนลดมากเกินไป** plan สามปีที่ซื้อตามช่วงพีคของเดือนมิถุนายนก่อน rightsize จะทำให้มี commitment เหลือใช้ไม่หมด และเงื่อนไขของ Savings Plan ก็เปลี่ยนไม่ได้หลังซื้อ ให้ optimize usage ก่อน แล้ว commit แค่ระดับฐานที่ใช้อยู่คงที่ ไม่ใช่ค่าเฉลี่ย ซื้อเป็นก้อนเล็ก ๆ ทยอยไปตามเวลา และตั้ง alert เมื่อ utilisation และ coverage ลดลง (AWS Budgets ทำได้ทั้งสองอย่าง)
- **ต้นทุนกลางที่ไม่มีใคร allocate** ตอนที่ data platform ใหม่ของ Acme เปิดใช้โดยไม่มีกติกาการแบ่ง ค่าใช้จ่ายที่ยังไม่ได้ allocate ก็กลับจาก 4% ขึ้นไปเป็น 9% ให้ตกลงกติกาก่อนที่ shared service จะ go live และติดตามสัดส่วนที่ allocate ได้เป็น KPI: เป้าหมายตัวอย่างของ framework คืออย่างน้อย 70% ที่ Crawl, 85% ที่ Walk และมากกว่า 90% ที่ Run
- **ติด tag ทีหลัง** แคมเปญไล่ติด tag ให้ resource เก่าแทบไม่เคยจบ และ tag ก็อธิบายเดือนก่อนที่มันจะมีอยู่ไม่ได้ ให้บังคับ tag ตั้งแต่ตอนสร้าง และแก้ค่า default ใน template
- **มอง FinOps เป็น project** การเก็บกวาดครั้งเดียวประหยัดได้ครั้งเดียว ถ้าไม่มี budget, alert และ review รายเดือน บิลก็ค่อย ๆ กลับขึ้นมาอีก ให้วน loop นี้ทุกเดือน
- **นับเงินที่ประหยัดได้แทน value** ตัว dashboard ของเงินที่ประหยัดได้ให้รางวัลกับการตัด ไม่ใช่กับการตัดสินใจที่ดี ให้รายงาน unit cost และผลลัพธ์ทางธุรกิจไว้ข้างตัวเลขเงินที่ประหยัดได้
