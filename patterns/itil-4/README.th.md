## ปัญหา

ร้านออนไลน์ของ Acme Shop รันอยู่บน AWS แต่ back office ยังรันอยู่ใน data centre ของ Acme เองที่ Bangkok: ราว 120 workload ในนั้นมีระบบ Orders, Inventory และ product catalog ที่ป้อนข้อมูลให้ร้าน โดยมีทีม IT 40 คนดูแลอยู่ สัญญาเช่าจะหมดในอีก 18 เดือน และผู้บริหารอยากได้สามอย่างจากการย้ายครั้งนี้: ออกจาก data centre ให้ทันเวลา, ลดค่า infrastructure ลงราว 20% และ ship การเปลี่ยนแปลงของ back office ให้เร็วขึ้น เป้าข้อสุดท้ายชนเข้ากับวิธีที่ทีม IT จัดการ change ตรง ๆ

ทุก change ต้องไปผ่าน change advisory board (CAB) รายสัปดาห์ที่ประชุมทุกวันพฤหัสบดีเวลา 14:00 ไม่ว่าจะเป็นการแก้ configuration บรรทัดเดียวหรือการ migrate database คนแปดคนไล่ดู change ราวสิบตัวในครึ่งชั่วโมง และเดือนที่แล้วก็ approve 39 จาก 40 change ตามที่ยื่นมา ส่วน change ที่ยื่นวันจันทร์ต้องรอราว 3 วันกว่าจะถึงที่ประชุม และการ review สั้น ๆ โดยคนที่อยู่ห่างจากงานก็จับอะไรได้น้อย: 6 จาก 40 change ที่ approve ไปแล้วนั้นก็ยังพังใน production อยู่ดี (15%) ช่วง sale 11.11 มี freeze สองสัปดาห์ที่หยุดทุก change ทำให้คิวยาวขึ้น และ release แรกหลัง sale ก็เป็น release ที่ใหญ่ที่สุดของฤดูกาล

คนจะหาทางอ้อม process แบบนี้ ทีม catalog ของร้านที่ deploy วันละหลายครั้ง แก้ feed configuration ของ product catalog ใน production ตรง ๆ แทนที่จะรอสามวันเพื่อแก้บรรทัดเดียว และไม่มีใครบันทึก change นั้นไว้ ส่วน incident ก็ถูก log, แก้ แล้วก็ปิด แต่ไม่มีใครหาต้นเหตุของมัน: order export ที่ค้าง INC-5531 ถูกปิดไปแล้วเก้าครั้งในไตรมาสนี้ (ตัวเลขของ Acme ในหน้านี้เป็นตัวเลขของตัวอย่างนี้เอง)

งานวิจัยก็ชี้ไปทางเดียวกัน งานวิจัย State of DevOps ปี 2019 ของ DORA พบว่าการ approve โดยหน่วยงานนอกทีม เช่น CAB หรือผู้บริหารระดับสูง มาคู่กับ software delivery performance ที่ต่ำกว่า และไม่พบหลักฐานว่ามันทำให้ change ที่ล้มเหลวน้อยลง DORA อธิบายว่า approval ที่หนัก ๆ ทำให้ delivery ช้าลง change เลยถูก ship นาน ๆ ครั้งและเป็น batch ที่ใหญ่ขึ้น และ batch ที่ใหญ่ขึ้นก็มีความเสี่ยงมากขึ้น ส่วน pattern เดียวกันนี้ก็โผล่ในฝั่งร้านของ Acme ใน [Policy as Code](../policy-as-code/) และ [The Three Ways](../three-ways/)

## ทำงานยังไง

**ITIL คืออะไร และใครเป็นเจ้าของ** ITIL เป็นชุด guidance สำหรับ IT service management โดย version ล่าสุดขยายไปครอบคลุม digital product และ service ด้วย คนที่เริ่ม ITIL คือ Central Computer and Telecommunications Agency (CCTA) ของรัฐบาลอังกฤษในช่วงทศวรรษ 1980 ส่วน version 3 (2007) จัดมันตาม service lifecycle ของ process และถูกปรับปรุงใน edition ปี 2011 ต่อมา AXELOS บริษัท joint venture ที่ Cabinet Office ของอังกฤษกับ Capita ตั้งขึ้นในปี 2013 ก็ออก ITIL 4 ในปี 2019 และ PeopleCert ก็ซื้อกิจการ AXELOS เสร็จในปี 2021 ตัว ITIL 4 เอา value system ที่สร้างจาก practice มาแทน process model ของ version 3 และรับไอเดียจาก Agile, Lean และ DevOps เข้ามา concept ข้างล่างมาจาก *ITIL Foundation, ITIL 4 Edition* ส่วนเนื้อหาของ ITIL เป็นลิขสิทธิ์ (proprietary) หน้านี้เลยแค่บอกชื่อ concept แล้วอธิบายด้วยคำของตัวเอง

**ITIL 4 กับ ITIL (Version 5)** ต้นปี 2026 PeopleCert เริ่มทยอย release ITIL (Version 5) ที่จัดการ digital product และ service ไปด้วยกัน และออกแบบมาโดยคำนึงถึง AI ฝั่ง PeopleCert วางมันไว้เป็นวิวัฒนาการของ ITIL 4 ไม่ใช่การเริ่มใหม่หมด: มันยังคง service value system และ guiding principles ไว้, ทำ value chain ให้ง่ายขึ้น, เพิ่ม product and service lifecycle แปดขั้น (discover, design, acquire, build, transition, operate, deliver and support) และยังคง management practice 34 ตัวไว้ โดยปรับบางจุด และจัดกลุ่มใหม่เป็น product and service management practices กับ general management practices ตัว change enablement ก็ยังเป็นหนึ่งในนั้น ส่วน certification ของ ITIL 4 ก็ยังสอบได้อยู่ระหว่างช่วงเปลี่ยนผ่าน และแผนปัจจุบันของ PeopleCert คือจะเลิก module ของ ITIL 4 ในวันที่ 31 ธันวาคม 2027 ตัว diagram วาด value chain หกกิจกรรมของ ITIL 4

**Service value system** ตัว ITIL 4 อธิบายว่าองค์กรเปลี่ยน demand ให้เป็น value ยังไง ผ่านระบบที่มีห้าส่วน และ step ที่สองของ diagram ก็วาดระบบนี้รอบ change ตัวเดียว:

- **Guiding principles:** คำแนะนำเจ็ดข้อที่ใช้ได้ไม่ว่าสถานการณ์ไหน เอาไว้ใช้ตัดสินใจและปรับส่วนอื่นของ ITIL ให้เข้ากับงาน (ดูตารางข้างล่าง)
- **Governance:** องค์กรถูกกำหนดทิศทางและควบคุมยังไง ที่ Acme ทีมผู้บริหาร IT เป็นคนกำหนดทิศทาง, change policy และ risk appetite ที่ change model ต้องทำตาม
- **Service value chain:** หกกิจกรรม *plan*, *improve*, *engage*, *design and transition*, *obtain/build* และ *deliver and support* ที่เอามาต่อกันในลำดับไหนก็ได้ ส่วน **value stream** คือการต่อกันแบบหนึ่งสำหรับงานแบบหนึ่ง
- **Practices:** มีทั้งหมด 34 ตัว แต่ละตัวคือการรวมกันของคน, ข้อมูล, เครื่องมือ และ process สำหรับงานแบบหนึ่ง เช่น change enablement, deployment management หรือ service desk ตัว ITIL 4 แบ่งมันเป็น general management practice 14 ตัว, service management practice 17 ตัว และ technical management practice 3 ตัว
- **Continual improvement:** การปรับปรุงในทุกระดับ ตั้งแต่ practice เดียวไปจนถึงทั้งองค์กร โดยทำตาม improvement model ที่ทำซ้ำได้

value stream ของ CHG-2420 (ใส่ bin location ลงใน pick list ของ Inventory) เดินผ่าน chain แบบนี้:

1. *Engage:* หัวหน้าคลังสินค้าแจ้งว่าพนักงานหยิบของเสียเวลาหา bin แล้ว request นี้ก็กลายเป็น CHG-2420
2. *Plan:* ทีม Inventory จัดให้มันอยู่บนสุดของ backlog
3. *Design and transition:* change นี้ถูกออกแบบให้ใช้กับ zone เดียวในคลังก่อน
4. *Obtain/build:* build มันขึ้นมาพร้อม automated test ใน pipeline
5. *Design and transition* อีกรอบ: peer review authorise มันเป็น normal change แล้วมันก็ถูก deploy ส่วน value stream วนกลับมาที่กิจกรรมเดิมได้ ก็เพราะกิจกรรมต่าง ๆ ต่อกันในลำดับไหนก็ได้
6. *Deliver and support:* พนักงานหยิบของใน zone A ใช้งานมัน และ service desk ก็มี guide สำหรับมัน
7. *Improve:* zone A หยิบของได้เร็วขึ้น 18% ขั้นถัดไปเลยเป็นการวางแผน rollout ไปที่ zone B ถึง D

**Guiding principles** แบบเล่าด้วยคำของเราเอง พร้อมวิธีที่ Acme เอาไปใช้:

| Principle | สรุปไอเดียสั้น ๆ | ที่ Acme |
|---|---|---|
| Focus on value | ผูกทุกกิจกรรมเข้ากับผลลัพธ์ที่มีคนเห็นคุณค่า | CHG-2420 เริ่มจากปัญหาของพนักงานหยิบของ: ต้องเดินหา bin |
| Start where you are | ดูว่ามีอะไรอยู่แล้วและอะไรใช้ได้ ก่อนจะเอาของใหม่มาแทน | CAB, change record และเครื่องมือยังอยู่ ที่เปลี่ยนคือใครเป็นคนตัดสินใจเรื่องอะไร |
| Progress iteratively with feedback | ทำทีละก้าวเล็ก ๆ และใช้สิ่งที่แต่ละก้าวสอน | zone A ก่อน แล้วค่อย zone B ถึง D |
| Collaborate and promote visibility | ทำงานข้ามขอบเขต โดยให้งานอยู่ในที่ที่ทุกคนเห็น | หัวหน้าคลังสินค้าเห็น backlog และเข้าร่วม demo |
| Think and work holistically | ไม่มีส่วนไหนสร้าง value ได้เพียงลำพัง เลยต้องมองทั้งระบบ | pick list, เครื่อง scanner แบบมือถือ และ guide ของ service desk เปลี่ยนไปพร้อมกัน |
| Keep it simple and practical | ใช้ขั้นตอนให้น้อยที่สุดที่ยังไปถึงผลลัพธ์ | change สามประเภทแทน board เดียวคุมทุกอย่าง |
| Optimize and automate | ปรับปรุงงานก่อน แล้วค่อยทำให้เป็นอัตโนมัติ | standard change รันและบันทึก record ของตัวเองใน pipeline |

**Four dimensions** ตัว ITIL 4 ให้มองทุก service และ practice จากสี่ด้าน เพื่อไม่ให้ด้านไหนถูกละเลย: organizations and people; information and technology; partners and suppliers; และ value streams and processes สำหรับ CHG-2420 สี่ด้านนั้นคือพนักงานหยิบของกับ service desk, ระบบ Inventory กับเครื่อง scanner, vendor ที่ทำ app ของเครื่อง scanner และตัวเส้นทางการหยิบของเอง

**Change enablement และ change management ที่มาก่อนหน้า** ใน ITIL version 3 ตัว change management เป็น process หนึ่งใน service transition และ CAB ก็เป็นส่วนที่คนรู้จักมากที่สุดของมัน องค์กรอย่าง Acme ก็มักลงเอยด้วยการส่งทุก change ไปให้ CAB ส่วน ITIL 4 ปรับมันใหม่เป็น practice ชื่อ change enablement (ในหนังสือ Foundation ปี 2019 เรียกว่า change control แล้วถูกเปลี่ยนชื่อใน publication ของ ITIL 4 รุ่นหลัง ๆ) ที่มีเป้าหมายให้ change สำเร็จให้ได้มากที่สุด ด้วยการประเมินความเสี่ยง, authorise และดูแลตาราง change (schedule of changes) มันแยก change เป็นสามประเภท และ **change authority** หรือคนหรือกลุ่มที่ authorise change ก็ต่างกันไปในแต่ละประเภทได้:

- **Standard change** มีความเสี่ยงต่ำ เข้าใจกันดี มีเอกสาร และ pre-authorised ไว้แล้ว: พอ procedure ได้รับ approve แล้ว แต่ละครั้งที่ทำก็รันได้เลยโดยไม่ต้องขอใหม่ หลายตัวเริ่มมาจาก service request
- **Normal change** ถูกจัดตาราง, ประเมิน และ authorise โดย authority ที่ change model ของมันระบุไว้ สำหรับ change ที่เสี่ยงต่ำ authority นั้นอาจเป็นคนที่อยู่ใกล้งานและตัดสินใจได้เร็ว โดยมักมี automation ช่วย ส่วน change ที่ใหญ่มาก ๆ ก็อาจเป็นคณะกำกับดูแลระดับสูงสุดขององค์กร
- **Emergency change** ต้องลงให้เร็วที่สุด เช่น เพื่อแก้ incident หรือลง security patch การประเมินและการ authorise มันจะถูกเร่ง บางทีก็โดย change authority ที่แยกออกมาต่างหาก

change model ของ Acme หลังเปลี่ยนแล้ว ตามที่ step ที่สามของ diagram แสดง:

| Change model | ตัวอย่าง | Change authority | Record | Lead time |
|---|---|---|---|---|
| Standard | low-stock threshold (CHG-2417), TLS certificate (CHG-2418), OS patch (CHG-2419) | pre-authorised โดย model และ review เมื่อมีตัวที่พัง | pipeline เป็นคนเขียน | ราว 2 ชั่วโมง |
| Normal | bin location บน pick list (CHG-2420) | ทีม Inventory: peer review บวก automated test | pull request และ pipeline | ราว 1 วัน |
| Normal, high risk | ย้าย Inventory ไปใช้ managed database service (CHG-2421) | CAB ที่ตอนนี้ประชุมเมื่อมี change แบบนี้ต้องใช้ ราวเดือนละครั้ง | change record และการตัดสินใจของ CAB | CAB รอบถัดไป |
| Emergency | hotfix ของ INC-5531 (CHG-2422) | on-call lead แล้ว review ใน CAB รอบถัดไป | pipeline บวกผล review | ทันที |

หนึ่งเดือนหลังเปลี่ยนมาใช้แบบนี้ change ของ Acme 34 จาก 40 ตัว (85%) เป็นแบบ standard และ lead time ของพวกมันลดจากราว 3 วันเหลือ 2 ชั่วโมง

**Incident, problem และ postmortem** ตัว ITIL แยก practice สองตัวออกจากกัน incident management ทำให้ service กลับมาปกติให้เร็วที่สุด ส่วน problem management หาต้นเหตุของ incident ทั้งที่เกิดขึ้นจริงและที่อาจเกิดได้ แล้วจัดการ workaround กับ known error จนกว่าต้นเหตุจะถูกกำจัด ทีม IT ของ Acme ทำแค่อย่างแรก: INC-5531 ถูกกู้กลับมาเก้าครั้ง และไม่เคยกลายเป็น problem record ส่วนฝั่ง SRE ก็มี practice ที่จับคู่กับทั้งสองตัว: [Incident Management](../incident-management/) คือการตอบสนอง ส่วน [blameless postmortem](../blameless-postmortems/) ทำงานของ problem management โดยหาปัจจัยที่มีส่วนทำให้เกิดเหตุแทนการหาคนผิด และติดตาม action จนทำเสร็จ ตัว incident ที่เกิดซ้ำอย่าง INC-5531 คือที่ที่ problem record กับ postmortem ให้ผลคุ้มเป็นที่แรก

**DevOps เข้ามาตรงไหน** ITIL อธิบายว่าองค์กรต้องจัดการอะไรบ้าง ส่วน DevOps, continuous delivery และ SRE เป็นวิธีลงมือทำงานพวกนั้นได้เป็นส่วนใหญ่ ตัว deployment pipeline ที่มี automated test, peer review ใน pull request และ audit trail อัตโนมัติ ก็คือ change enablement ที่ลงมือทำจริง, [metric ของ DORA](../dora-metrics/) วัด value stream และทีม on-call ที่ทำ postmortem ก็คือการทำ incident management กับ problem management แม้แต่บน site ของ PeopleCert เอง บทความปี 2025 ของ Donna Knapp จาก ITSM Academy ก็บอกว่า CAB ถูกเลิกใช้ไปเป็นส่วนใหญ่ในองค์กรที่ทำ DevOps โดย change ถูก authorise โดยคนที่อยู่ใกล้งาน หรือโดย automated control

**DORA พบอะไร** DORA เป็นโครงการวิจัยที่ตอนนี้ Google Cloud ดูแลอยู่ และ DORA ก็รายงานไว้ในงานวิจัย State of DevOps ปี 2019 ว่าการ approve โดยหน่วยงานนอกทีมมาคู่กับ delivery performance ที่ต่ำกว่า และไม่มีหลักฐานว่าทำให้ change ที่ล้มเหลวน้อยลง และแค่ทำให้ process การ approve ที่มีอยู่ชัดเจนสำหรับทีมที่ใช้มัน ก็มาคู่กับ performance ที่ดีขึ้น ใน guide เรื่องการทำ change approval ให้คล่องตัว DORA แนะนำ peer review ระหว่างพัฒนาโดยมี automated testing กับ monitoring คอยหนุน, ตรวจเข้มเป็นพิเศษเฉพาะ change ที่ถูกระบุว่าเสี่ยงสูง และให้ CAB มีบทบาทใหม่: ประสานงานระหว่างทีม, ปรับปรุง process และตัดสินใจเรื่อง trade-off ทางธุรกิจที่ต้องให้ผู้บริหารระดับสูง sign-off มันยังแนะนำให้ทำทาง normal change ให้เร็วและเชื่อถือได้พอที่จะใช้ในเหตุฉุกเฉินได้ด้วย *The DevOps Handbook* (second edition, 2021) ก็พูดแบบเดียวกันในภาคที่ว่าด้วย feedback หรือ Second Way: approval โดยคนที่อยู่ห่างจากงานเพิ่ม delay โดยจับอะไรได้ไม่มาก ส่วน review โดยเพื่อนร่วมทีมที่อยู่ใกล้งานได้ผลดีกว่า

## ลงมือทำจริงยังไง

1. **Start where you are: วัด flow ก่อน** ตลอดหนึ่งเดือน ให้บันทึกประเภทของแต่ละ change, รอ approve นานแค่ไหน, คนที่ approve แก้อะไรไปบ้าง และมันพังหรือเปล่า Acme เจอว่าต้องรอราว 3 วัน, 39 จาก 40 change ได้ approve ตามที่ยื่น และ 15% ก็พังอยู่ดี ตัวเลขพวกนี้ให้เหตุผลได้หนักแน่นกว่า slide ไหน ๆ
2. **เขียน change model โดยเริ่มจาก change ที่ทำเป็นประจำ** ไล่รายการ change ที่เกิดซ้ำ (ค่า configuration, การต่ออายุ certificate, patch) ให้แต่ละตัวมี procedure ที่มีเอกสาร ผ่านการ test และมีทางถอยกลับ แล้วให้ CAB pre-authorise model นั้นครั้งเดียว ทำ procedure ให้เป็นอัตโนมัติใน pipeline และถ้า change ใน model ไหนเริ่มพัง ก็เปลี่ยน model นั้นกลับไปเป็น normal change
3. **มอบ normal change ให้ทีมตัดสินเอง** peer review ใน pull request ที่ repository บังคับไว้ (เช่น protected branch ที่ต้องมี reviewer ใน GitHub หรือ GitLab) บวก automated test คือ change authority และเพราะคนเขียนจะ approve change ของตัวเองไม่ได้ มันก็เลยผ่านข้อกำหนด segregation of duties ที่ใช้กันทั่วไปด้วย ตามที่ guide ของ DORA บอกไว้
4. **เก็บ CAB ไว้สำหรับงานที่ต้องใช้จริง:** change ที่เสี่ยงสูงอย่าง database migration, change ที่แตะหลายทีม และ trade-off ทางธุรกิจ ให้ board รับบทบาทใหม่ตามที่ DORA เสนอ คือประสานงานและปรับปรุง process แทนการอ่านทุก change
5. **กำหนดทางสำหรับเหตุฉุกเฉิน:** ใครมีสิทธิ์ authorise (ที่ Acme คือ on-call lead), change ถูกบันทึกยังไง และจะ review ทีหลังเมื่อไหร่ ตั้งเป้าให้ทาง normal เร็วพอ จนเหตุฉุกเฉินแทบไม่ต้องใช้ทางอื่น
6. **ให้ pipeline เขียน record เอง** pipeline เปิดและปิด change record ใน service management tool (เช่น ServiceNow หรือ Jira Service Management) พร้อมบอกว่าอะไรเปลี่ยน, ใคร review, test ไหนผ่าน และ deploy เมื่อไหร่ นี่เป็นหลักฐานสำหรับ auditor ที่ดีกว่ารายงานการประชุม
7. **เปลี่ยน freeze แบบเหมารวมเป็นกฎตามความเสี่ยง** ช่วง sale 11.11 ตอนนี้ Acme ให้ standard change ไปต่อได้ และพักตัวที่เสี่ยงสูงไว้ แทนที่จะหยุดทุกอย่างแล้วปล่อย batch ใหญ่ทีหลัง
8. **ทำ problem management กับเรื่องที่เกิดซ้ำ** incident ที่กลับมาซ้ำจะได้ problem record และ blameless review แล้ว fix ก็ ship ออกไปเป็น normal change โดย INC-5531 เป็นเรื่องแรกที่ทำแบบนี้
9. **วัดผลลัพธ์:** lead time แยกตามประเภท change, change fail rate, เวลาที่ change รอ approve และสัดส่วนของ change ที่ต้องมีคน approve ด้วยมือ ตามที่ DORA แนะนำ โดยติดตามไปหลาย ๆ เดือน (ดู [DORA Metrics](../dora-metrics/))
10. **ปรับใช้ทีละระบบ** Acme เริ่มจาก Inventory แล้วค่อยย้ายระบบอื่นตามมาทีละตัว

## อยู่ตรงไหนใน solution

- **[Continuous Delivery](../continuous-delivery/)** ให้ deployment pipeline ที่ทำให้ standard change เป็นงานประจำ และเขียน record ที่ change enablement ต้องใช้
- **[Policy as Code](../policy-as-code/)** ย้าย check ที่ CAB เคยอ่านด้วยตาไปเป็น rule อัตโนมัติ ทำให้ change เป็นแบบ standard ได้มากขึ้นโดยไม่เสียการควบคุม
- **[DORA Metrics](../dora-metrics/)** บอกว่า change model ใหม่ทำให้ delivery เร็วขึ้นโดยไม่พังมากขึ้นหรือเปล่า, **[Value Stream Mapping](../value-stream-mapping/)** หาว่า change ไปรออยู่ตรงไหน แบบคิว 3 วันหน้า CAB ในหน้านี้ และ **[The Three Ways](../three-ways/)** อธิบายว่าทำไม change เล็ก ๆ ที่ได้ feedback เร็วถึงปลอดภัยกว่า change ใหญ่ ๆ ที่ผ่าน approve มาแล้ว
- **[Incident Management](../incident-management/)** และ **[Blameless Postmortems](../blameless-postmortems/)** คือคู่ฝั่ง SRE ของ incident management และ problem management ใน ITIL
- **[CALMS](../calms/)** มองเรื่อง culture, automation, lean flow, measurement และ sharing ที่การนำ ITIL มาใช้ต้องมีพอ ๆ กับการนำ DevOps มาใช้
- **[Cloud Migration Strategies](../cloud-migration-strategies/)** พูดถึง back office ตัวเดียวกัน: การย้าย Inventory ไปใช้ managed database service เป็น change เสี่ยงสูงแบบที่ยังต้องไปผ่าน CAB
- **[Feature Flags](../feature-flags/)** และ **[Canary Release](../canary-release/)** ลดความเสี่ยงของแต่ละ change ทำให้ change เป็นแบบ standard หรือ normal ได้มากขึ้น

## ใช้ตอนไหนดี

**ตรงไหนที่คุ้ม** องค์กรที่รันหลาย service ให้ผู้ใช้จำนวนมาก โดยเฉพาะแผนก IT ภายในและ service provider, ที่ที่ regulator, auditor หรือสัญญา outsourcing คาดหวังให้มี change management, incident management และ problem management ที่มีเอกสาร และ estate ที่ผสมกันหลายแบบอย่าง back office ของ Acme ที่ต้องรัน mainframe, VMware cluster และ cloud service ด้วยคำศัพท์ชุดเดียวกัน ตัว ITIL ให้ภาษากลางกับ IT, supplier และฝั่งธุรกิจ และคนทำงาน IT จำนวนมากก็รู้จักมันอยู่แล้ว: PeopleCert รายงานว่ามี ITIL certification มากกว่าสามล้านใบ

**ตรงไหนที่ลงทุนมากกว่าที่ได้คืน** product team เล็ก ๆ ที่ deploy ผ่าน pipeline ที่มี peer review, on-call และ postmortem อยู่แล้ว ก็ทำส่วนที่จำเป็นครบแล้ว การเอา practice 34 ตัวมาซ้อนอีกจะเพิ่ม overhead โดยไม่ได้ประโยชน์ ตัว ITIL ยังแพงขึ้นเมื่อถูกรันเป็น project ที่ต้องทำให้จบ: training, consultant และการ rollout tool ใหญ่ ๆ อาจใช้งบที่ตั้งใจไว้สำหรับ automation จนหมด

**ปรับใช้ยังไง** ธุรกิจที่มีกฎระเบียบคุมยังคงมี segregation of duties และ audit trail ไว้ โดยทำผ่าน peer review และ record ของ pipeline แทนรายงานการประชุม ส่วน legacy system ที่ deploy ผ่าน pipeline ไม่ได้ เช่น mainframe ของ Acme ก็ยังใช้ normal change model แบบ manual พร้อม runbook ที่ test แล้ว ถ้า supplier เป็นคนทำ change ตัวสัญญาก็ระบุ change authority ไว้ เพื่อให้ change ของ supplier ไปถึงคนที่ถูกต้อง องค์กรเล็ก ๆ หยิบ guiding principles มาใช้ พร้อม practice สองสามตัว แล้วก็หยุดแค่นั้น

## กับดักที่เจอบ่อย

- **ใช้ ITIL เป็น rulebook ให้ลอกตาม** การเอาทุก process และทุกแบบฟอร์มมาใช้เพราะหนังสือเขียนไว้ สร้างขั้นตอนแบบราชการและชวนให้คนหาทางอ้อม *ควรทำแทน:* keep it simple and practical และหยิบเฉพาะส่วนที่แก้ปัญหาที่มีอยู่จริง
- **รับมาใช้ แต่ไม่ปรับ** เอา process ตามตำรามาวางทับของเดิม แล้วทิ้งสิ่งที่เคยใช้ได้ดีไปด้วย *ควรทำแทน:* start where you are: วัด flow ปัจจุบัน แล้วแก้ constraint ที่แย่ที่สุดก่อน
- **CMDB ที่กลายเป็นเป้าหมายในตัวเอง** ใช้เวลาหลายปีเติม configuration management database ที่ไม่มีการตัดสินใจไหนใช้มันเลย *ควรทำแทน:* focus on value: บันทึกเฉพาะ configuration item และความสัมพันธ์ที่การประเมิน change, การรับมือ incident หรือ audit ใช้จริง และอัปเดตมันให้เป็นปัจจุบันอัตโนมัติจาก cloud และ deployment tool
- **มอง ITIL กับ DevOps เป็นคู่แข่ง** pipeline ถูกมองเป็นทางอ้อมการควบคุม หรือ ITIL ถูกมองเป็นศัตรูของความเร็ว *ควรทำแทน:* ให้ pipeline, peer review และ automated test เป็นตัวควบคุมเอง แล้วบันทึกมันในฐานะตัวควบคุม
- **Certificate แทนการเปลี่ยนแปลง** ทุกคนสอบผ่าน ITIL Foundation และ CAB ก็ยังเห็นทุก change อยู่ดี *ควรทำแทน:* ตัดสินการนำมาใช้จากผลลัพธ์: lead time และ change ที่ล้มเหลว
- **ปฏิบัติกับทุก change เหมือนกันหมด** process เดียวสำหรับทั้งค่า configuration และ database migration ทำให้เปลืองความใส่ใจไปกับทั้งสองอย่าง และ DORA ก็จัดเรื่องนี้ไว้ในกับดักที่เจอบ่อยของ change approval *ควรทำแทน:* แยก change model ตามความเสี่ยง
- **แก้ความล้มเหลวด้วย approval ที่มากขึ้น** หลัง change ที่พัง การเพิ่ม sign-off อีกขั้นให้ความรู้สึกปลอดภัย แต่มันทำให้ lead time ยาวขึ้นและ batch ใหญ่ขึ้น และผลวิเคราะห์ของ DORA ก็ชี้ว่านั่นทำให้แย่ลง *ควรทำแทน:* ทำ change ให้เล็กลงและทำ check ให้เร็วขึ้น
- **ใช้ freeze เป็นมาตรการความปลอดภัยตั้งต้น** freeze แบบเหมารวมสะสม batch ใหญ่ไว้รอวันที่ freeze จบ *ควรทำแทน:* freeze ตามความเสี่ยง และให้ standard change ไหลต่อไปได้
