## ปัญหา

online shop ของ Acme Shop รันอยู่บน AWS แล้ว เป็น container บน Kubernetes ที่ product team สร้าง และรันอยู่บน Launchpad ของ platform team แต่ back office ยังไม่ได้รันบน AWS ระบบจัดการ order, inventory, product catalog ที่ป้อนข้อมูลให้ shop, CRM ที่ host เอง, VMware cluster, mainframe และเครื่องมือออกรายงานที่ไม่มีใครใช้ ยังอยู่ใน data centre ของ Acme เองที่ Bangkok: ราว 120 workload ที่ทีม IT 40 คนดูแลอยู่ สัญญาเช่าตึกจะหมดในอีก 18 เดือน ผู้บริหารตั้งเป้าไว้สามข้อ: ออกจาก data centre ให้ได้ก่อนสัญญาเช่าหมด, ลดค่า infrastructure ลงราว 20% และ ship การเปลี่ยนแปลงของ back office ให้เร็วขึ้น (ตัวเลขของ Acme ในหน้านี้เป็นตัวเลขของตัวอย่างนี้เอง ไม่ใช่ผลวิจัย)

แผนแรกมาจากทีม infrastructure และเป็นเรื่องเทคนิคล้วน ๆ: ทำ inventory ของ server, ตั้ง VPN กับ AWS account, ก็อป virtual machine ข้ามไป แล้ว cutover และปิด data centre ให้ได้ภายใน Q4 แผนนี้ตอบเป้าข้อแรก แต่ไม่ตอบอีกสองข้อเลย และยังปล่อยให้ของส่วนใหญ่ที่การย้ายต้องใช้ไม่มีเจ้าของ:

- ไม่มีใครเป็นเจ้าของ business case เลยไม่มีใครบอกได้ว่าการย้ายครั้งนี้ใช้เงินเท่าไร หรือ 20% นั้นทำได้จริงไหม
- คนในทีม IT 40 คนมีแค่สามคนที่รู้ AWS แล้วก็ไม่มีแผน training และยังไม่มีใครตัดสินใจว่างานของพวกเขาจะเปลี่ยนไปยังไง เมื่อไม่มี hardware ให้ดูแลแล้ว
- ไม่มี budget ไม่มี cost allocation tag และจะไม่มีใครเอาบิลมาเทียบกับเป้า
- server ทุกตัวไปอยู่ใน AWS account เดียว ที่มี administrator login ตัวเดียวใช้ร่วมกัน และไม่มี multi-factor authentication
- monitoring กับ on-call ยังเหมือนเดิม ทำให้ alert จากระบบที่ย้ายไปแล้วยังไป page ทีม data centre ทั้งที่ทีมนี้แตะ hardware ที่ระบบนั้นรันอยู่ไม่ได้อีกแล้ว

ไม่มีข้อไหนเป็นปัญหาเรื่องเทคโนโลยี แผนที่มองแค่เทคโนโลยีเลยหามันไม่เจอ **AWS Cloud Adoption Framework** (AWS CAF) คือแผนที่ของ AWS ที่ครอบทุกอย่างที่เหลือ: องค์กรต้องทำอะไรให้เป็นบ้าง นอกจากการย้าย server เพื่อให้ได้คุณค่าที่หวังไว้จาก cloud

## ทำงานยังไง

**framework นี้คืออะไร** เวอร์ชันปัจจุบันที่มักเรียกกันว่า CAF 3.0 คือ whitepaper ของ AWS ชื่อ *An Overview of the AWS Cloud Adoption Framework* ที่ publish เมื่อ 22 พฤศจิกายน 2021 เป็น edition ที่สามของ framework (สอง edition แรกออกในปี 2015 และ 2017) AWS review มันอีกรอบในเดือนกุมภาพันธ์ 2023 และไม่ได้เปลี่ยนอะไร edition ปี 2021 ขยาย capability ออกไป และเพิ่ม transformation domain กับเฟสของ journey ที่อธิบายไว้ข้างล่าง AWS เสนอมันไว้สำหรับงานสามอย่าง: หาและจัดลำดับโอกาสในการ transform, วัดและปรับปรุง cloud readiness ขององค์กร และค่อย ๆ พัฒนา transformation roadmap ไปทีละขั้น

**จาก capability ไปสู่ outcome** framework วาด value chain จากซ้ายไปขวา foundational capability ทำให้การเปลี่ยนแปลงเกิดขึ้นได้ในสี่ *transformation domain* และแต่ละ domain ก็เปิดทางให้ domain ถัดไป:

- **Technology**: ย้ายและ modernise infrastructure, แอปพลิเคชัน และ data and analytics platform
- **Process**: ทำให้วิธีทำงานของธุรกิจเป็นดิจิทัล เป็นอัตโนมัติ และดีขึ้น
- **Organization**: เปลี่ยน operating model เช่น ทีมที่จัดตาม product และ value stream ที่ทำงานเป็นรอบสั้น ๆ
- **Product**: value proposition และ revenue model ใหม่ ๆ

การเปลี่ยนแปลงเหล่านี้นำไปสู่ *business outcome* สี่อย่าง: ความเสี่ยงทางธุรกิจต่ำลง, ผลงานด้าน environmental, social and governance (ESG) ดีขึ้น, รายได้มากขึ้น และ operational efficiency สูงขึ้น เป้าหมายของ Acme เข้ากับ chain นี้พอดี การออกจาก data centre คือการเปลี่ยนแปลงด้าน technology ที่ตัดความเสี่ยงเรื่องสัญญาเช่าหมด ส่วนการประหยัด 20% คือ operational efficiency และการเปลี่ยน back office ให้เร็วขึ้นก็ต้องเปลี่ยนทั้ง process และ organisation นอกเหนือจาก infrastructure ใหม่

**หก perspective, foundational capability 47 ตัว** ในภาษาของ CAF ตัว capability คือความสามารถขององค์กรในการใช้ process และทรัพยากร (คน เทคโนโลยี และ asset อื่น ๆ) ไปให้ถึง outcome ที่ต้องการ ตัว framework จัด capability 47 ตัวไว้ในหก *perspective* และ capability ในแต่ละ perspective ก็เป็นของ stakeholder กลุ่มหนึ่งที่เกี่ยวข้องกัน คนกลุ่มนี้เป็นเจ้าของหรือดูแลมัน edition ปี 2017 บอกว่า perspective business, people และ governance ส่วนใหญ่เกี่ยวกับ capability ด้านธุรกิจ ส่วน platform, security และ operations เกี่ยวกับ capability ด้านเทคนิค แล้ว edition ปี 2021 ก็ยังใช้หก perspective เดิม และรายชื่อ stakeholder ของมันก็แบ่งแบบเดียวกัน

| Perspective | ดูแลเรื่องอะไร | Stakeholder ที่พบบ่อย | จำนวน capability | ตัวอย่างบางส่วนแบบสั้น ๆ |
|---|---|---|---|---|
| **Business** | ให้เงินที่ใช้กับ cloud รับใช้ strategy ของธุรกิจและ outcome ของมัน | CEO, CFO, COO, CIO, CTO | 8 | *Strategy management*: cloud ช่วยเป้าหมายระยะยาวยังไง *Portfolio management*: จัดลำดับ cloud initiative และใช้เครื่องมือ discovery กับ 7 Rs เพื่อจัดกลุ่ม application portfolio และสร้าง business case จากข้อมูล นอกจากนี้ยังมี product management, innovation management, strategic partnership, data monetisation, business insights และ data science |
| **People** | วัฒนธรรม โครงสร้างองค์กร leadership และ workforce | CIO, COO, CTO, cloud director, ผู้นำข้ามสายงาน | 7 | *Cloud fluency*: ประเมินทักษะที่มีตอนนี้ แล้ว train ปิด gap ด้วย certification และ community of practice ส่วน *Workforce transformation*: ออกแบบ role ใหม่ ปิด skill gap และดึง partner เข้ามาเมื่อจำเป็น *Transformational leadership*: sponsor ที่เห็นตัวชัด ๆ ทั้งฝั่งธุรกิจและฝั่งเทคโนโลยี และ transformation office หรือ cloud centre of excellence (CCoE) นอกจากนี้ยังมี culture evolution, change acceleration, organisation design และ organisational alignment |
| **Governance** | ประสานงานให้ได้ประโยชน์ตามที่หวัง และให้ความเสี่ยงของการ transform อยู่ในระดับต่ำ | Chief transformation officer, CIO, CTO, CFO, chief data officer, chief risk officer | 7 | *Cloud financial management*: account และ tag ที่ผูกค่าใช้จ่ายเข้ากับทีม, budget และ forecast, showback หรือ chargeback และ guardrail เรื่องการใช้งาน *Benefits management*: เขียนประโยชน์ที่คาดไว้เป็น metric วัดมันเป็นประจำ แล้วปรับตาม นอกจากนี้ยังมี program and project management, risk management, application portfolio management, data governance และ data curation |
| **Platform** | cloud environment แบบ hybrid ที่ scale ได้และใช้ได้ระดับองค์กร รวมถึง workload ที่ modernise หรือสร้างขึ้นบนมัน | CTO, ผู้นำด้านเทคโนโลยี, architect, engineer | 7 | *Platform architecture*: standard, blueprint และ guardrail ส่วน *Platform engineering*: environment แบบ multi-account ที่ผ่าน compliance มี account provisioning อัตโนมัติ, guardrail แบบ preventive และ detective, federation กับ identity provider ที่มีอยู่, connectivity, central logging และ infrastructure as code ส่วน *Provisioning and orchestration*: catalogue แบบ self-service ของ product ที่อนุมัติแล้ว นอกจากนี้ยังมี data architecture, data engineering, modern application development และ CI/CD |
| **Security** | confidentiality, integrity และ availability ของข้อมูลและ workload | CISO, chief compliance officer, internal audit, security architect และ engineer | 9 | *Identity and access management*: identity provider กลาง, group และ attribute สำหรับให้สิทธิ์ในวงกว้าง, temporary credential และ multi-factor authentication ส่วน *Security governance*: role, ความรับผิดชอบ และ policy รวมถึงกฎที่ใช้กับอุตสาหกรรมนั้น นอกจากนี้ยังมี security assurance, threat detection, vulnerability management, infrastructure protection, data protection, application security และ incident response |
| **Operations** | ส่ง cloud service ได้ตามระดับที่ตกลงไว้กับธุรกิจ | ผู้นำด้าน infrastructure และ operations, site reliability engineer, IT service manager | 9 | *Observability*: log, metric และ trace พร้อม alert เมื่อค่าที่วัดข้าม threshold ส่วน *Incident and problem management*: escalation path ใน runbook, game day และ post-incident review แบบ blameless นอกจากนี้ยังมี event management (AIOps), change and release management, performance and capacity, configuration, patching, availability and continuity และ application management |

**Journey** ตัว CAF เสนอสี่เฟส ที่ทำเป็นรอบเล็ก ๆ หลายรอบ ไม่ใช่ทำครั้งเดียว:

1. **Envision**: แสดงให้เห็นว่า cloud จะเร่ง business outcome ได้ยังไง หาและจัดลำดับโอกาสในสี่ domain แล้วให้แต่ละโอกาสมี stakeholder ระดับอาวุโสหนึ่งคนกับ outcome ที่วัดได้
2. **Align**: หา capability gap ในหก perspective, dependency ระหว่างแผนก และข้อกังวลของ stakeholder ผลที่ได้คือแผนยกระดับ readiness ที่ stakeholder เห็นตรงกัน พร้อม organisational change management ที่แผนนั้นต้องใช้
3. **Launch**: เอา pilot ขึ้น production ให้เห็นคุณค่าเร็ว ๆ และเรียนรู้จากมันก่อนไปต่อ
4. **Scale**: ขยาย pilot ไปถึง scale ที่ตั้งใจไว้ และทำให้แน่ใจว่าประโยชน์ที่คาดไว้มาถึงจริงและอยู่ยาว

whitepaper บอกไว้ชัดว่าองค์กรไม่ต้องทำทุก foundational capability พร้อมกัน: capability จะค่อย ๆ โตไปตาม journey และตัว whitepaper ก็ร่างลำดับทั่วไปไว้ให้เอาไปปรับใช้

**เอกสารประกอบ** AWS publish whitepaper ที่ยาวกว่าสำหรับ perspective business, people, governance, security และ operations (เอกสาร operations กับ security มีมาตั้งแต่ปี 2016 แล้วถูกเขียนใหม่ในปี 2022 และ 2023 ส่วนเอกสาร business, governance และ people ออกในปี 2022 และ 2023) และยังมี *CAF for artificial intelligence, machine learning and generative AI* (ปี 2023 อัปเดตเดือนกุมภาพันธ์ 2024) ที่เอาหก perspective มาใช้กับการนำ AI มาใช้ ตอนนี้ AWS ระบุว่าเอกสารเหล่านี้ทั้งหมดเก็บไว้เป็นข้อมูลอ้างอิงเชิงประวัติ เลยต้องเช็กชื่อ service และคำแนะนำในนั้นกับเอกสารปัจจุบัน ส่วน overview ปี 2021 คือคำอธิบาย framework ฉบับปัจจุบัน

**CAF ไม่ใช่อะไร**

- **ไม่ใช่ design review** ตัว [AWS Well-Architected Framework](../well-architected-framework/) จะ review workload หนึ่งตัวเทียบกับหก pillar แล้ว list ความเสี่ยงของ workload นั้น ส่วน CAF ทำงานสูงขึ้นไปอีกระดับ และถามว่าองค์กรรัน cloud estate ได้หรือเปล่าเลย ทั้งสองมาเจอกันตรงกลาง: cloud financial management ของ CAF ต้องการ workload ที่ Well-Architected และ landing zone ที่สร้างภายใต้ platform perspective ก็คือที่ที่ workload เหล่านั้นลงไปอยู่
- **ไม่ใช่วิธีย้ายระบบ** AWS Prescriptive Guidance แบ่งการย้ายระบบขนาดใหญ่ออกเป็นสามเฟส: *assess* (business case และ readiness), *mobilize* (ปิด gap สร้าง landing zone และ operating model แล้วเตรียมทีม) และ *migrate and modernize* ตัว AWS Migration Acceleration Program (MAP) ใช้สามเฟสเดียวกัน และหน้า [AWS Migration Process](../aws-migration-process/) ก็พาไล่ดูทั้งสามเฟส ทั้งสองเชื่อมกันตรงจุดเริ่มต้น: ในเฟส assess ตัว *Migration Readiness Assessment* ของ AWS ตั้งคำถามตามหก perspective ของ CAF เพื่อหาจุดแข็ง จุดอ่อน และ action plan แล้วเฟส mobilize ก็ปิด gap เหล่านั้นก่อน wave จะเริ่ม ส่วนจะทำอะไรกับแต่ละ workload (retire, retain, relocate, rehost, repurchase, replatform หรือ refactor) ก็ตัดสินใจแบบในหน้า [Cloud Migration Strategies](../cloud-migration-strategies/) โดยที่ capability portfolio management ของ CAF ก็ใช้ชื่อ 7 Rs ชุดเดียวกัน

**adoption framework ของ cloud อื่น** (เช็กเมื่อตุลาคม 2026) อีกสอง provider รายใหญ่ก็ publish ของตัวเอง โดยมีโครงสร้างต่างกัน ให้เทียบที่สิ่งที่แต่ละตัวครอบ ไม่ใช่ที่ชื่อ

| | AWS Cloud Adoption Framework | Microsoft Cloud Adoption Framework for Azure | Google Cloud Adoption Framework |
|---|---|---|---|
| รูปแบบ | whitepaper overview ฉบับเดียว คือ CAF 3.0 (พฤศจิกายน 2021, review อีกรอบกุมภาพันธ์ 2023) | คำแนะนำบน Microsoft Learn ที่อัปเดตตลอด | whitepaper (PDF ที่ Google ลิงก์ไว้ลงวันที่พฤศจิกายน 2018) และหน้า overview |
| แกนหลัก | หก perspective ที่มี foundational capability 47 ตัว | เฟสของการนำ Azure มาใช้: strategy, plan, ready, adopt (migrate, modernize, cloud-native), govern, secure และ manage | สี่ theme (learn, lead, scale, secure) ที่แต่ละตัวถูกให้คะแนนว่าอยู่ในเฟสไหนจากสามเฟส (tactical, strategic, transformational): นี่คือ cloud maturity scale |
| เส้นทาง | Envision, align, launch, scale แล้ววนซ้ำ | strategy และ plan แล้วค่อยมี landing zone ใน *ready* จากนั้น adopt ส่วน govern, secure และ manage ครอบทั้ง environment | หาตำแหน่งตัวเองบน maturity scale แล้วรัน *epic* (workstream อย่าง upskilling, sponsorship, identity and access, infrastructure as code, cost control และ incident management) ที่จัดกลุ่มไว้ใต้ people, process และ technology |
| Readiness check | capability gap ที่เจอในเฟส align และ Migration Readiness Assessment ของ AWS สำหรับการย้ายระบบ | discovery และ assessment ของ estate ในเฟส plan | self-assessment บน maturity scale หรือทำร่วมกับ technical account manager ของ Google |
| ส่วนขยาย | CAF for AI (ปี 2024 ตอนนี้เป็นเอกสารเชิงประวัติแล้ว) | scenario สำหรับ data platform, AI adoption, AI agent, sovereignty และ Azure VMware Solution | Google บอกว่า scale และ epic ใช้ได้กับ cloud provider ทุกเจ้า |

## ลงมือทำจริงยังไง

Acme เดินตาม journey และคุม assessment ให้เล็กพอจะทำเสร็จ:

1. **เริ่มจาก outcome และ sponsor (envision)** โครงการนี้มี COO เป็น sponsor และเป็นเจ้าของ business case เป้าหมายกลายเป็น outcome ที่มีวันที่และตัววัด: ทุก workload ออกจาก data centre ที่ Bangkok ก่อนสัญญาเช่าหมด, ค่า infrastructure ต่ำกว่าวันนี้ราว 20% โดยเช็กทุกเดือน และ lead time ของการเปลี่ยนแปลงใน back office ที่สั้นลง วัดด้วย [DORA metrics](../dora-metrics/) ชุดเดียวกับที่ทีมของ shop ใช้ ถ้ามองตาม value chain ของ CAF นี่คือการเปลี่ยนแปลงด้าน technology, process และ organisation ที่มุ่งไปที่ความเสี่ยงที่ต่ำลงและ efficiency ที่สูงขึ้น
2. **เลือก capability ที่การออกจาก data centre ต้องพึ่ง** การให้คะแนนครบ 47 ตัวทีเดียวจะกินเวลาเป็นเดือน COO กับหัวหน้าทีม IT เลยเลือก perspective ละสองตัว รวมสิบสองตัว แล้วเก็บที่เหลือ (data monetisation, data science และอื่น ๆ) ไว้ทำใน iteration ถัด ๆ ไป
3. **จัด workshop หนึ่งครั้งต่อ perspective (align)** แต่ละครั้งพา stakeholder ของ perspective นั้นมาอยู่ในห้องเดียวกัน: CFO กับหัวหน้า IT finance สำหรับ governance, CISO กับ internal audit สำหรับ security, หัวหน้า IT operations กับ SRE หนึ่งคนจากฝั่ง shop สำหรับ operations พวกเขาให้คะแนนแต่ละ capability ระบุ gap และตกลง action กัน CAF ไม่ได้กำหนดสเกลการให้คะแนน Acme เลยใช้ห้าระดับที่ตั้งเอง (not started, ad hoc, defined, managed, optimised) จะใช้สเกลไหนก็ได้ ถ้าใช้สเกลเดียวกันทุกครั้ง
4. **เปลี่ยน gap ให้เป็น action ที่มีเจ้าของ** workshop ทั้งหกครั้งได้ action ออกมา 24 ข้อ แต่ละข้อมีเจ้าของหนึ่งคนจาก stakeholder ของ perspective นั้นและมีวันที่ อยู่ใน backlog เดียวที่ sponsor review ทุกเดือน ตัวอย่างบางส่วน: business case ของ COO ที่สร้างจาก portfolio และ 7 Rs, แผน training ของ CIO สำหรับคนทั้ง 40 คน และการตัดสินใจเรื่อง role ใหม่ (cloud operations, FinOps, platform engineering), budget และ cost allocation tag ของ CFO ที่มีเป้า 20% อยู่ในรายงานรายเดือน (ดู [FinOps](../finops/)), landing zone ของ CTO, กฎการ sign-in ของ CISO และ on-call ราย workload ที่ย้ายไปแล้ว แทน on-call ตามตึก
5. **สร้างรากฐาน แล้วค่อย pilot (launch)** เริ่มจาก cloud centre of excellence ขนาดเล็ก: คนจาก IT ของ back office, engineer สองคนจาก platform team ที่รัน Launchpad ให้ shop, security engineer หนึ่งคน และคนจากฝั่ง finance หนึ่งคน ต่อด้วย landing zone ใน organisation ที่ shop ใช้อยู่แล้ว: แยก account ตาม environment และกลุ่ม workload ตั้งด้วย AWS Control Tower, guardrail เป็น service control policy และ Control Tower control ที่เก็บไว้ใน version control และ test เหมือน [policy as code](../policy-as-code/) ทั่วไป, sign-in ผ่าน IAM Identity Center ที่ต่อกับ directory ของบริษัท มี multi-factor authentication และไม่มี login ที่ใช้ร่วมกัน (ดู [AWS IAM](../aws-iam/)), central logging, budget และ tag ที่บังคับใส่ จากนั้น pilot ห้า workload ที่ความเสี่ยงต่ำใน production ก็พิสูจน์ landing zone, runbook, การ route alert และรายงานค่าใช้จ่าย แล้วบทเรียนจาก pilot ก็กลับเข้าไปใน backlog
6. **ให้คะแนนอีกรอบ แล้วค่อย scale** หลัง pilot แล้ว capability สิบสองตัวเดิมได้ค่าเฉลี่ย 3.1 แทน 1.5 ส่วน workload ที่เหลือก็ย้ายเป็น wave ตามที่หน้า [AWS Migration Process](../aws-migration-process/) เล่าไว้ และ CCoE ก็ให้คะแนนสิบสองตัวนี้ใหม่ทุกไตรมาส แล้วเพิ่ม capability เข้าไปเมื่อตัวถัดไปเริ่มสำคัญ

| Perspective | Capability | ก่อน | หลัง launch | อะไรเปลี่ยนไป |
|---|---|---|---|---|
| Business | Strategy management | 3 | 4 | เป้าหมายที่มีวันที่และตัววัดรายเดือน |
| Business | Portfolio management | 1 | 3 | business case ที่ COO เป็นเจ้าของ และ R หนึ่งตัวต่อ workload |
| People | Cloud fluency | 1 | 3 | แผน training สำหรับทั้ง 40 คน และ certification ชุดแรก |
| People | Workforce transformation | 1 | 2 | ตกลง role ใหม่กันแล้ว และเริ่มย้ายคนเข้า role แล้ว |
| Governance | Cloud financial management | 1 | 3 | budget, tag ที่บังคับใส่ และรายงานค่าใช้จ่ายรายเดือน |
| Governance | Benefits management | 1 | 3 | วัดเป้า 20% ทุกเดือน |
| Platform | Platform architecture | 2 | 3 | เขียนโครงสร้าง account และ guardrail ไว้เป็นลายลักษณ์อักษร |
| Platform | Platform engineering | 2 | 4 | landing zone ที่สร้าง account และ guardrail อัตโนมัติ |
| Security | Identity and access management | 1 | 3 | sign-in ผ่าน directory พร้อม MFA และไม่มี login ที่ใช้ร่วมกัน |
| Security | Security governance | 2 | 3 | เจ้าของและ policy สำหรับ account ใหม่ |
| Operations | Observability | 2 | 3 | metric, log และ alert สำหรับ workload ใน pilot |
| Operations | Incident and problem management | 1 | 3 | on-call และ runbook ราย workload ไม่ใช่รายตึก |
| | **ค่าเฉลี่ย** | **1.5** | **3.1** | |

## อยู่ตรงไหนใน solution

- [Cloud Migration Strategies](../cloud-migration-strategies/) คือการตัดสินใจราย workload ตัว capability portfolio management ของ CAF ใช้ 7 Rs ชุดเดียวกันในการสร้าง business case
- [AWS Migration Process](../aws-migration-process/) (assess, mobilize, migrate and modernize) คือการลงมือย้ายจริง readiness assessment ของมันจัดตามหก perspective ของ CAF และเฟส mobilize ของมันก็ปิด gap ที่ CAF เจอ
- [Well-Architected Framework](../well-architected-framework/) จะ review workload ทีละตัว ส่วน CAF review องค์กรที่รัน workload เหล่านั้น
- [FinOps](../finops/) คือ cloud financial management ในทางปฏิบัติ: allocation, showback, budget และ unit cost
- [Team Topologies](../team-topologies/) และ [Platform as a Product](../platform-as-a-product/): ในภาษาของ Team Topologies ตัว CCoE ที่ coach ทีมผ่านการย้ายช่วงแรก ๆ แล้วถอยออกมา ทำหน้าที่เป็น enabling team ส่วน CCoE ที่ยังรัน landing zone ต่อไปเรื่อย ๆ ก็กลายเป็น platform team ไปแล้ว และควรมอง landing zone เป็น product ที่มี user
- [AWS IAM](../aws-iam/), [Policy as Code](../policy-as-code/) และ [Infrastructure as Code](../infrastructure-as-code/) คือชิ้นส่วนพื้นฐานของ perspective platform และ security: federated sign-in, guardrail และ account ที่สร้างจากโค้ดที่ review แล้ว
- [Incident Management](../incident-management/) และ [Golden Signals](../golden-signals/) ครอบ perspective operations: ใครถูก page และ page เพราะอะไร
- [DORA Metrics](../dora-metrics/) วัดเป้าหมาย "เปลี่ยนแปลงได้เร็วขึ้น"

## ใช้ตอนไหนดี

- **คุ้มค่า** เมื่อทั้งองค์กรต้องเปลี่ยนไปด้วยกัน: ออกจาก data centre, การย้ายระบบขนาดใหญ่ หรือการขยับจาก account ทดลองไม่กี่ตัวไปเป็น cloud estate ที่ finance, security และ audit จะต้องพึ่ง มันมีประโยชน์ที่สุดตอนต้น ๆ ก่อน wave แรก ตอนที่การขาดเจ้าของทำให้เสียแค่การประชุมหนึ่งครั้ง ไม่ใช่ outage
- **องค์กรขนาดเล็ก** ใช้หก perspective เป็น checklist หน้าเดียวได้ startup ที่เกิดบน cloud หรือทีมยี่สิบคนไม่ต้องจัด workshop ทีละ perspective แต่คำถามก็ยังใช้ได้: ใครเป็นเจ้าของค่าใช้จ่าย ใคร sign-in ได้ ใครถูก page
- **workload ตัวเดียว** ต้องใช้ Well-Architected review ไม่ใช่ CAF assessment
- **องค์กรที่มี regulation** ได้ประโยชน์มากที่สุดจาก perspective governance และ security ให้ดึง audit และ risk เข้ามาในเฟส align ตั้งแต่แรก guardrail จะได้ตกลงกันเสร็จก่อนที่ account แรกจะเกิด
- **ระบบ legacy** ยังอยู่ในภาพ Acme เก็บ mainframe ไว้ on premises ไปก่อน capability ด้าน operations และ security เลยต้องครอบ estate แบบ hybrid ไปอีกหลายปี ไม่ใช่แค่ฝั่ง cloud
- **หลาย cloud**: perspective เทียบกับ framework ของ provider อื่นได้ดี แต่ service และคำศัพท์เทียบกันไม่ได้ ให้เลือกโครงสร้างเดียวสำหรับทั้งองค์กร แล้วแปลที่เหลือเข้ามาในโครงสร้างนั้น
- **ต้นทุน** คือเวลาของคนระดับอาวุโส และ assessment จะคุ้มเวลานั้นก็ต่อเมื่อ action มีเจ้าของและมีคนตามต่อ คะแนน readiness ที่ไม่มีใครเอาไปทำอะไรต่อ เสียมากกว่าได้

## กับดักที่เจอบ่อย

- **Checklist ที่ไม่มีเจ้าของ** workshop ได้รายงานออกมา รายงานถูกเก็บเข้าแฟ้ม แล้วปีหน้าก็เจอ gap เดิมอีก ให้ทุก action มีเจ้าของหนึ่งคนจาก stakeholder ของ perspective นั้นและมีวันที่ รวมไว้ใน backlog เดียว แล้วให้ sponsor review ทุกเดือน
- **ข้าม perspective people กับ governance** แผนที่นำด้วยเทคโนโลยีย้าย server ไปได้ แต่แล้วทีมก็ operate สิ่งที่ย้ายไปไม่เป็น และไม่มีใครคอยดูบิล ตกลงแผน training, role ใหม่ และ budget กันให้เสร็จก่อน wave แรก ไม่ใช่หลังใบแจ้งหนี้ใบแรก
- **ให้คะแนนครบ 47 capability ก่อนย้ายอะไรสักอย่าง** assessment เต็มรูปแบบใช้เวลาเป็นเดือน และเก่าไปแล้วระหว่างที่ยังเขียนอยู่ ให้คะแนนเฉพาะ capability ที่เฟสถัดไปต้องพึ่ง แล้วเพิ่มตัวอื่นเมื่อมันเริ่มสำคัญ ตัว framework เองก็บอกว่าองค์กรอาจไม่ต้องทำครบทุกตัวพร้อมกัน
- **เข้าใจว่า CAF เป็นวิธีออกแบบหรือแผนย้ายระบบ** มันหา gap ระดับองค์กร มันไม่ได้ review architecture ของ workload (นั่นคือ Well-Architected Framework) และไม่ได้จัดลำดับ wave, cutover และ rollback (นั่นคือขั้นตอนการย้ายระบบ) ใช้ทั้งสามตัว แต่ละตัวทำงานของมันเอง
- **assessment ครั้งเดียวจบ** readiness เปลี่ยนไปเมื่อ estate โตขึ้นและคนย้ายออกไป ให้คะแนนใหม่ทุกไตรมาสหรือหลังแต่ละ wave ตามที่รอบของ journey ตั้งใจไว้
- **ถือคะแนนเป็นเป้าหมาย** ระดับ 5 ทุกช่องไม่ใช่ประเด็น outcome ต่างหากที่ใช่ ยก capability ขึ้นไปเท่าที่ outcome ต้องการก็พอ
- **พึ่งรายละเอียดในเอกสารประกอบ** เอกสาร perspective ต่าง ๆ และ CAF for AI ตอนนี้เป็นเอกสารเชิงประวัติแล้ว หลักการของมันยังใช้ได้ แต่ให้เช็กชื่อ service, feature และ limit ในเอกสารปัจจุบัน
