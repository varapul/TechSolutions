## ปัญหา

region หนึ่งดับได้ทั้ง region และข้อมูลก็ถูกทำลายได้: ปัญหา network หรือไฟฟ้าระดับ region การเปลี่ยนแปลงผิด ๆ ที่ rollout ไปทั้ง region การ drop table ผิด หรือ ransomware ตัว redundancy ภายใน region เดียวไม่ครอบคลุมเรื่องพวกนี้ workload เลยต้องมีบ้านหลังที่สองที่อื่น คำถามคือจะให้บ้านหลังที่สองรันอยู่มากแค่ไหนตอนที่ยังไม่มีอะไรผิดปกติ เพราะความพร้อมทุกส่วนต้องจ่ายตลอดทั้งปี เพื่อวันที่อาจไม่มีวันมาถึง

ตัวเลขสองตัวที่เป็นกรอบของการตัดสินใจ:

- **RTO (recovery time objective):** เวลานานที่สุดที่ธุรกิจยอมให้ service ใช้ไม่ได้หลังเกิดเหตุ การตรวจเจอปัญหา การตัดสินใจ failover และงานกู้คืน ต้องอยู่ในเวลานี้ทั้งหมด
- **RPO (recovery point objective):** ข้อมูลที่กู้คืนมาเก่าย้อนหลังไปได้ไกลแค่ไหน พูดอีกแบบคือช่วงเวลาของการเปลี่ยนแปลงล่าสุดที่ยาวที่สุดที่ธุรกิจยอมเสียไป มันเป็นความยาวของเวลา ไม่ใช่ปริมาณข้อมูล

ทั้งสองตัวเป็นการตัดสินใจทางธุรกิจที่ทำแยกตาม workload ไม่ใช่คุณสมบัติของเทคโนโลยี มันได้มาจาก **business impact analysis**: ระบบนี้หายไปหนึ่งชั่วโมงทำให้เสียรายได้ ค่าปรับ ความปลอดภัย หรือความเชื่อใจเท่าไร และข้อมูลของมันหายไปหนึ่งชั่วโมงทำให้เสียเท่าไร NIST SP 800-34 หาค่าเหล่านี้จากตรงนั้นพร้อมกับ **maximum tolerable downtime** (MTD) คือการหยุดชะงักทั้งหมดที่ business process หนึ่งทนได้ และบอกว่าปกติ RTO ต้องสั้นกว่า MTD เพราะงานที่กองไว้ระหว่าง outage ยังต้องตามเคลียร์หลังระบบกลับมา คำตอบต่างกันได้แม้ในบริษัทเดียว (ระบบจ่ายเงินกับ wiki ภายในไม่ควรได้งบเท่ากัน) และต่างกันตามเวลาด้วย ตัวอย่างของ AWS คือระบบ payroll ที่ล่มก่อนวันเงินเดือนออกจะเจ็บกว่าล่มหลังวันเงินเดือนออกมาก ต้องรู้ objective ก่อนถึงจะเลือก strategy ได้อย่างมีเหตุผล และ strategy ต่าง ๆ ก็เรียงกันเป็นบันได ทุกขั้นที่ลด RTO และ RPO ลงจะแพงขึ้นอีก

**High availability ไม่ใช่ disaster recovery** availability ทำให้ service ยังทำงานอยู่ระหว่างที่ *component* พัง: instance มากขึ้น หลาย zone failover อัตโนมัติภายใน region ส่วน disaster recovery กู้ *ทั้ง workload* ขึ้นมาที่อื่นหลังเกิดเหตุที่ availability ไม่ได้ออกแบบมารับ มันยังต้องครอบคลุมภัยที่เกิดในข้อมูลด้วย เพราะ redundancy จะก็อปภัยแบบนี้ไปทุก replica อย่างครบถ้วน ให้ทำ workload ให้ highly available ก่อนเป็นอย่างแรก แค่ deployment แบบ multi-zone ก็รอดความล้มเหลวที่น่าจะเกิดที่สุดแล้ว และนั่นเป็นตัวตัดสินว่ายังคุ้มที่จะซื้อ disaster recovery เพิ่มอีกแค่ไหน

## ทำงานยังไง

strategy ทั้งสี่ใช้ชื่อตาม whitepaper เรื่อง disaster recovery ของ AWS ยิ่งไปทางขวาก็ยิ่งมี workload รันอยู่ใน recovery region มากขึ้น งานที่เหลือให้ทำในวันเกิดภัยก็เลยน้อยลง สามแบบแรกเป็น **active/passive**: region หนึ่ง serve ส่วนอีก region รอ (ตัวการสลับเองเป็นเรื่องของ pattern active-passive failover) ส่วนแบบสุดท้ายเป็น **active/active** เส้นขอบประใน diagram คือสิ่งที่ยังไม่มีหรือยังไม่รัน และเส้นขอบสีเขียวคือสิ่งที่ต้องสร้างหรือเปลี่ยนหลังเกิดภัย

| | Backup and restore | Pilot light | Warm standby | Multi-site active/active |
|---|---|---|---|---|
| รันอยู่ใน recovery region | ไม่มีอะไรเลย เก็บไว้แค่สำเนา backup กับ template และ image ที่ต้องใช้ rebuild | data store ที่ replicate อยู่ตลอด กับ infrastructure หลัก (network, load balancer) ไม่มี app server | สำเนาของ workload ที่ครบและใช้งานได้ในขนาดที่ลดลง ไม่รับ production traffic | สำเนาขนาดเต็มที่รับ production traffic ตลอดเวลา |
| งานหลังเกิดภัย | provision infrastructure, restore ข้อมูล, deploy แอป, redirect ผู้ใช้ | start และ scale app tier, promote data store, redirect ผู้ใช้ | scale ให้เต็มขนาด, promote data store, ย้าย traffic | ย้าย traffic ออกจาก region ที่พัง |
| RPO | หลักชั่วโมง: ทุกอย่างตั้งแต่ backup ครั้งล่าสุด | ไม่กี่นาทีหรือน้อยกว่า: replication lag | ไม่กี่นาทีหรือน้อยกว่า: replication แบบเดียวกัน | เกือบศูนย์: replication lag หรือเป็นศูนย์ถ้าใช้ synchronous replication |
| RTO | หลักชั่วโมง | หลักสิบนาที | หลักนาที | เกือบศูนย์ |
| ต้นทุนประจำ | `$` ค่าเก็บ backup | `$$` บวก data store ที่เปิดอยู่ตลอด | `$$$` บวก fleet เล็ก ๆ ที่ส่วนใหญ่นั่งว่าง | `$$$$` สอง site ขนาดเต็ม |
| ความซับซ้อน | ต่ำ: backup และ infrastructure as code | กลาง: replication และทุก release ต้องไปสอง region | สูงขึ้น: environment ที่ live อีกชุดที่ต้อง deploy, patch และ monitor | สูงที่สุด: การเขียนในหลาย region, conflict, global routing |
| ใช้กับอะไร | workload ที่ priority ต่ำกว่า ล่มได้สักวัน | ระบบที่การเสียข้อมูลเจ็บกว่า downtime หนึ่งชั่วโมง | service ที่สำคัญต่อธุรกิจ | service ระดับ mission-critical ที่ต้องไม่หยุด |

อ่านตัวเลขยังไง:

- **มันคือลำดับขนาด ไม่ใช่คำสัญญา** รูปใน whitepaper ของ AWS ให้ label เดียวต่อ strategy สำหรับทั้งสอง objective: หลักชั่วโมง หลักสิบนาที หลักนาที และ real time โดยต้นทุนไล่จาก `$` ถึง `$$$$` ส่วน Reliability Pillar ของ Well-Architected Framework แยกสองตัวออกจากกัน: RPO เป็นหลักชั่วโมง หลักนาที หลักวินาที และเกือบศูนย์ ส่วน RTO ภายใน 24 ชั่วโมง หลักสิบนาที หลักนาที และอาจเป็นศูนย์ ตัวเลขของคุณเองได้มาจากการจับเวลาตอนซ้อม ไม่ได้มาจากชื่อของ strategy
- **RPO ลดลงตอนเริ่ม replicate ส่วน RTO ลดลงทุกขั้น** ตั้งแต่ pilot light เป็นต้นไป ข้อมูลมาถึงผ่าน replication ที่ต่อเนื่อง ปกติเป็นแบบ asynchronous ทำให้ RPO เท่ากับ replication lag ไม่ว่าจะเลือกแบบไหนในสามแบบนั้น นี่เป็นเหตุผลที่เกจ RPO ใน diagram ไม่ขยับในขั้นที่ 3: สิ่งที่ warm standby กับ active/active ซื้อได้คือเวลา มีแค่ synchronous replication ที่ทำให้ RPO เป็นศูนย์ และมันทำให้การเขียนทุกครั้งต้องรออีก region
- **Backup and restore ทำ RPO ได้ดีกว่าหลักชั่วโมง** continuous backup ที่มี point-in-time recovery ลดมันลงเหลือไม่กี่นาทีได้ในบางกรณี ส่วน RTO ยังยาวอยู่ เพราะทุกอย่างยังต้อง rebuild ก่อน
- **Pilot light หรือ warm standby?** AWS ขีดเส้นตรงที่ว่า recovery region ตอบ request ได้ไหมโดยไม่ต้องเปิดอะไรก่อน pilot light ทำไม่ได้ warm standby ทำได้ใน capacity ที่ลดลง และแปลว่ามัน test ด้วย request จริงได้ทุกวันด้วย
- **Hot standby** คือชื่อที่ AWS ใช้เรียก warm standby ที่ขยายเต็มขนาดอยู่แล้ว แต่ยังไม่รับ traffic มันไม่ต้อง scale ระหว่างเกิดภัย แลกกับต้นทุนเกือบเท่า active/active เพราะแบบนี้ทีมส่วนใหญ่ที่จ่ายค่า site ที่สองขนาดเต็มถึงปล่อยให้มัน serve ไปด้วยเลย
- **backup เป็นส่วนหนึ่งของทุก strategy** ไม่ใช่แค่แบบแรก (ดูหัวข้อได้อะไร เสียอะไร) diagram เลยเก็บ backup store ไว้ในทั้งสี่ขั้นด้วยเหตุผลนี้

### บันไดเดียวกันในชื่ออื่น

แนวคิดเหมือนกันทุกที่ แต่ชื่อเรียกไม่เหมือน (เช็กเมื่อเดือนตุลาคม 2026)

- Well-Architected Framework ของ **Azure** มี backup and restore, *active-passive cold standby* (environment สำรองไม่ได้รันอยู่ และจะเปิดขึ้นมาตอนต้องใช้), *active-passive warm standby* (provision ไว้บางส่วนและ scale up ตอน failover) และ *active-active* ที่เป็นได้ทั้ง *at capacity* (แต่ละ region scale out ตอนที่อีก region พัง) หรือ *overprovisioned* (แต่ละ region รับ load เต็มได้อยู่แล้ว) มันยังจัด workload เป็น criticality tier แล้วจับคู่กับ strategy เหล่านี้ ตั้งแต่ active-active สำหรับระบบ mission-critical ไปจนถึง backup and restore สำหรับระบบงานธุรการ
- คู่มือวางแผน disaster recovery ของ **Google Cloud** พูดถึง pattern แบบ *cold*, *warm* และ *hot* ตามว่าระบบพร้อมกู้คืนแค่ไหน ใน application scenario ของคู่มือ pattern แบบ cold เก็บไว้แค่ขั้นต่ำที่ต้องใช้ rebuild ส่วนแบบ warm ให้ stack บางส่วนรันอยู่ (ปกติคือฐานข้อมูล) และแบบ hot มีทั้งสอง site serve production
- ระวังคำว่า **"hot standby"**: ใน paper ของ AWS มันเป็น passive site แต่คู่มือวางแผนของ Azure ใช้คำนี้กับ active-active ให้เทียบว่าอะไรรันอยู่ใน region ที่สอง ไม่ใช่เทียบที่ชื่อ

## ใช้ตอนไหนดี

เลือกแยกตาม workload โดยเริ่มจาก RTO และ RPO ของมัน แล้วเอา strategy ที่ถูกที่สุดที่ผ่านทั้งสองตัว ปกติทั้ง portfolio จะมีหลายแบบผสมกัน และแม้แต่แอปพลิเคชันเดียวก็ผสมได้: เส้นทาง checkout อาจต้องใช้ warm standby ส่วนงาน reporting ที่อยู่เบื้องหลังต้องการแค่ backup

- **Backup and restore** เป็นคำตอบที่ถูกบ่อยกว่าที่รู้สึก มันเหมาะเมื่อธุรกิจอยู่ได้กับ outage หนึ่งวันและข้อมูลที่หายไปไม่กี่ชั่วโมง (เครื่องมือภายใน, งาน batch และ analytics, development environment, archive) เมื่อข้อมูลสร้างใหม่ได้จากแหล่งอื่น หรือเมื่อภัยที่คุณวางแผนรับคือการเสีย data centre หนึ่งแห่ง และ workload ก็รันข้ามหลาย zone อยู่แล้ว AWS เองก็พูดแบบนี้: deployment แบบ multi-zone อาจครอบคลุมความเสี่ยงไปมากแล้ว และไม่ควรสร้าง recovery strategy ที่แพงกว่าความเสียหายที่มันป้องกัน เว้นแต่มีอย่างอื่นบังคับ เช่นกฎระเบียบ มันจะใช้ได้ก็ต่อเมื่อ rebuild เป็นอัตโนมัติและ restore ผ่านการ test แล้ว ไม่อย่างนั้น "หลักชั่วโมง" จะกลายเป็นหลายวันแบบเงียบ ๆ
- **Pilot light** เมื่อการเสียข้อมูลเป็นส่วนที่แพง และ downtime หนึ่งชั่วโมงยังพอรอดได้ ตัว data store ที่ live อยู่ซื้อ RPO ได้เกือบทั้งหมดด้วยต้นทุนแค่เศษเสี้ยวของการรันแอปพลิเคชันสองชุด
- **Warm standby** เมื่อ RTO เป็นหลักนาที หรือเมื่ออยากได้หลักฐานทุกวันว่า recovery region ใช้ได้ เพราะมันรับ test traffic และ release จริงได้
- **Multi-site active/active** เมื่อแม้แต่ไม่กี่นาทีก็ยังนานเกินไป หรือเมื่อยังไงก็อยากมีหลาย region อยู่แล้วเพื่อให้ใกล้ผู้ใช้ มันจะคุ้มก็ต่อเมื่อ data model รับการเขียนในหลาย region ได้ ส่วน [Multi-Region Active-Active](../multi-region-active-active/) อธิบาย strategy นี้อย่างละเอียด
- **region ที่สองไม่ใช่คำตอบของทุกภัย** มันไม่ช่วยกับ deployment ผิด ๆ ที่ไปถึงทั้งสอง region พร้อมกัน และ replication มากแค่ไหนก็แทน backup ไม่ได้

## ได้อะไร เสียอะไร

- **คุณจ่ายทุกวันให้สิ่งที่หวังว่าจะไม่ต้องใช้** ทุกขั้นที่ลงบันไดไปเพิ่มต้นทุนประจำ และเพิ่ม environment ที่สองที่ต้อง deploy, patch, monitor และทำให้ตรงกับชุดแรกเสมอ เงินที่ประหยัดได้จาก strategy ที่ถูกกว่าจะมีจริงก็ต่อเมื่อการกู้คืนยังใช้ได้ ต้นทุนของการ test เลยต้องนับรวมในการเปรียบเทียบด้วย
- **replication ก็อปความผิดพลาดไปด้วย** table ที่ถูก drop, bug ที่ทำข้อมูลเสีย หรือ ransomware ไปถึงทุก replica ภายในไม่กี่วินาที ไม่ว่าจะใช้ strategy ไหนในสี่แบบ ถ้าเจอภัยแบบนี้ recovery point คือ backup ล่าสุดที่ยังดีอยู่ และ backup นั้นจะอยู่ก่อนตอนที่มีคนเห็นความเสียหายไปช่วงหนึ่งเสมอ ส่วน recovery time ก็ไม่มีวันเป็นศูนย์ แม้จะใช้ active/active ก็ตาม ทุกขั้นของบันไดต้องมี point-in-time backup
- **failover อัตโนมัติหรือด้วยมือ** การ failover ทำให้เสียข้อมูลเท่ากับ replication lag และมีช่วงที่ระบบสะดุด false alarm เลยมีราคาแพง AWS แนะนำให้ระวัง failover ข้าม region ที่เริ่มเองอัตโนมัติ และอธิบายทางสายกลางที่ใช้กันทั่วไป: ให้คนเป็นคนตัดสินใจ และทุกอย่างหลังจากนั้นเป็นอัตโนมัติ การเริ่มเลยเป็นแค่ action เดียว ส่วน failover อัตโนมัติมีไว้สำหรับ RTO ที่ตึงที่สุด โดยใช้ health check ที่สะท้อนสิ่งที่ผู้ใช้เจอจริง ไม่ว่าแบบไหน เวลาที่ใช้ตรวจเจอ escalate และตัดสินใจก็นับรวมใน RTO
- **standby ที่ต้อง scale ระหว่างเกิดภัย ต้องพึ่งสิ่งที่ต้องทำงานได้ระหว่างเกิดภัย** การ launch instance ต้องใช้ control plane ของ provider และ capacity ที่ว่างอยู่ใน recovery region ในจังหวะที่ลูกค้าทุกรายของ region ที่พังก็ต้องการแบบเดียวกัน ส่วน capacity ที่รันอยู่แล้วปลอดภัยกว่าแต่แพงกว่า นี่คือความต่างที่แท้จริงระหว่าง warm standby ตัวเล็กกับ hot standby
- **recovery region ที่ไม่ได้ใช้จะ drift** image, configuration, secret, certificate และ service quota จะเก่าไป เว้นแต่ทุกการเปลี่ยนแปลงจะ rollout ไปทั้งสอง region เส้นทางกู้คืนที่นาน ๆ ได้ใช้ทีมักจะใช้ไม่ได้ตอนที่ต้องใช้
- **active/active ย้ายความซับซ้อนไปไว้ในข้อมูล** การเขียนพร้อมกัน การ resolve conflict และ consistency ระหว่าง region กลายเป็นส่วนหนึ่งของทุก feature
- **dependency ที่ช้าที่สุดเป็นตัวกำหนด RTO จริง** ฐานข้อมูลที่กลับมาในสิบนาทีก็ไม่ช่วยอะไร ถ้าไม่มีใคร sign in ได้ ถ้า DNS ยังชี้ไป region เก่า หรือถ้า firewall ของ partner ยอมให้แค่ address เก่า

## ข้อควรรู้ตอนลงมือทำ

- **backup ที่ restore ได้จริง**
  - restore ตามตารางเวลา ไม่ใช่แค่ตอนที่ต้องใช้: ทำ restore อัตโนมัติเป็นระยะลงใน environment ทดลอง เช็กข้อมูลและจับเวลา เวลานั้นเป็นก้อนใหญ่ของ RTO จริงของคุณ AWS ชี้ประโยชน์ข้อที่สองไว้: ถ้าตัว restore service เองใช้ไม่ได้ระหว่างเกิดภัย ก็มีสำเนาที่ใช้ได้จาก backup ล่าสุดอยู่แล้ว
  - เก็บสำเนาไว้ใน region อื่น *และ* ใน account หรือ subscription อื่น เพื่อไม่ให้ทั้ง outage ระดับ region และ administrator ที่ถูก compromise เข้าถึงมันได้
  - ทำให้มันลบไม่ได้ระหว่าง retention period ด้วย write-once vault หรือ object lock เพื่อไม่ให้ทั้ง ransomware และ credential ของ administrator ที่ถูกขโมยลบมันได้ ตัวอย่างเช่น AWS Backup Vault Lock และ S3 Object Lock, immutable vault ใน Azure Backup และ backup vault ใน Backup and DR service ของ Google Cloud
  - ใช้ point-in-time recovery กับฐานข้อมูล และ versioning กับ object store โดยตั้ง retention ให้นานพอจะย้อนกลับไปก่อนที่ความเสียหายจะถูก *สังเกตเห็น* ไม่ใช่แค่ก่อนที่มันจะเกิด
  - backup สิ่งที่ต้องใช้ rebuild ด้วย: infrastructure code, machine image, configuration
- **ตัว failover เอง** คือ runbook ที่มีห้าส่วนเหมือนกันในทุก strategy ต่างกันแค่ความยาวของแต่ละส่วน
  1. *ตรวจจับ:* alarm ที่ดูจากสิ่งที่ผู้ใช้เจอ (ดู [Health Endpoint Monitoring](../health-endpoint-monitoring/)) บวกกับ status feed ของ provider
  2. *ตัดสินใจ:* เกณฑ์ที่เขียนไว้สำหรับการประกาศภัยพิบัติ และชื่อคนที่มีสิทธิ์ประกาศตอนตีสาม
  3. *เพิ่ม capacity:* start หรือ scale app tier ([Autoscaling](../autoscaling/)) จาก image ที่อยู่ใน region อยู่แล้ว ตรงนี้แหละที่ immutable infrastructure ให้ผลคุ้ม
  4. *Promote ข้อมูล:* ทำให้ replica เขียนได้ และ fence primary ตัวเก่าไว้ เพื่อไม่ให้มันรับการเขียนได้อีกถ้ามันกลับมา การ promote ใช้เวลาตั้งแต่ไม่ถึงนาทีไปจนถึงไม่กี่นาที แล้วแต่ engine และรันไปพร้อมกับตอนที่ capacity กำลังขึ้นมาได้ pattern read replicas อธิบายเรื่อง replication และ lag ไว้
  5. *Redirect traffic:* DNS failover record, global load balancer หรือ anycast ([Load Balancing](../load-balancing/)) คำตอบ DNS ถูก cache ไว้ตาม TTL ของ record เลยควรตั้งให้สั้นกับชื่อที่อาจต้องย้าย

  เขียน script ให้แต่ละส่วน ทำทุกขั้นให้ชัดพอที่จะทำตามได้ตอนเครียด และเก็บ runbook, script และ credential ไว้ในที่ที่ไม่ได้พึ่ง region ที่พัง
- **ใช้ operation ของ data plane ระหว่าง failover** provider แบ่งแต่ละ service เป็น data plane ที่ทำงานประจำวัน (ตอบ DNS query, route request, serve การอ่านและเขียน) กับ control plane ที่สร้างและแก้ resource ส่วน AWS บอกว่า data plane ของตัวเองออกแบบมาให้ availability สูงกว่า control plane และแนะนำให้ใช้ operation ของ control plane บนเส้นทางกู้คืนให้น้อยที่สุด ในทางปฏิบัติ: สร้าง load balancer, DNS record, role และ bucket ไว้ล่วงหน้า เลือกใช้ capacity ที่รันอยู่แล้วแทนการ launch ใหม่ และสลับ traffic ด้วยกลไกที่อยู่ใน data plane เช่น DNS failover ที่ขับด้วย health check หรือ routing control ของ Amazon Application Recovery Controller การแก้ DNS record เป็นการเรียก control plane และ control plane ของ Route 53 ก็ host อยู่ใน region เดียว
- **dependency ต้อง failover ด้วย** ไล่รายการทุกอย่างที่ workload และ operator ต้องใช้ แล้วเช็กว่าแต่ละอย่างทำงานได้เมื่อ primary region หายไป: identity และ single sign-on (บวก break-glass account ที่ไม่พึ่งพวกนั้น), DNS, secret, encryption key และ certificate, container registry และ deployment pipeline, monitoring และ alerting, software licence, private network link และ third party ที่ allow-list address ของคุณหรือเรียก webhook ของคุณ เพิ่ม service quota ใน recovery region ไว้ล่วงหน้า หรือจอง capacity ไว้ที่นั่น
- **fail back คือ migration รอบที่สอง** หลัง failover ข้อมูลล่าสุดมีอยู่ใน recovery region ที่เดียว การกลับไปหมายถึงต้อง replicate ในทิศกลับกัน ให้ region เก่าตามทัน แล้ว switch over ในช่วงที่เงียบ ๆ เป็น operation ที่วางแผนไว้และมี runbook ของตัวเอง คำแนะนำของ Azure คือให้ถือว่า failback เป็นอีก process แยกต่างหาก ที่อาจเกิดทันทีหรืออีกหลายสัปดาห์ต่อมาก็ได้ บางครั้งคำตอบที่ถูกคือไม่ต้องกลับ
- **test แผน** จัด game day: restore backup, failover จริง, serve production จาก recovery region ไปสักพัก แล้ว fail back วัด recovery time และ recovery point ที่ทำได้จริง แล้วเทียบกับ objective ทาง AWS ถือว่าการไม่เคยทดลอง failover บน production เป็น anti-pattern และ chaos engineering ก็ขยายแนวคิดเดียวกันไปถึงความล้มเหลวที่เล็กกว่า ให้เส้นทางกู้คืนแบบต่าง ๆ มีจำนวนน้อยเข้าไว้ เพราะแต่ละเส้นทางต้องถูกซ้อม
- **building block แบบ managed** ตัวอย่างเช่น: cross-region database replica และ global database สำหรับข้อมูล, AWS Elastic Disaster Recovery และ Azure Site Recovery ที่ replicate ทั้ง server อยู่ตลอดและ launch ขึ้นมาตอน failover (pilot light สำหรับ workload ที่รันบน server) และเครื่องมือ infrastructure-as-code ที่ใช้สร้าง stack ชุดเดียวกันใน region ที่สอง
