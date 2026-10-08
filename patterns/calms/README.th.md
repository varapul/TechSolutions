## ปัญหา

ฝ่าย IT ฝั่ง back-office ของ Acme Shop มี 40 คน: developer 22 คนที่เขียนโค้ด ERP กับระบบคลังสินค้า, operations engineer 12 คนที่ดูแล server ใน data centre ของบริษัทเอง และ release group ที่เป็น engineer หกคนที่มาจากฝั่ง operations หลังจาก product team ของฝั่ง shop เปลี่ยนมา deploy ทีละน้อยแต่บ่อย ฝ่ายนี้ก็อยากได้ผลแบบเดียวกัน เดือนมกราคมเลยซื้อ pipeline tool มา และเปลี่ยนชื่อ release group เป็น DevOps team (ตัวเลขของ Acme เป็นตัวเลขของตัวอย่างนี้เอง ไม่ใช่ผลวิจัย)

เก้าเดือนต่อมา ทุก commit ถูก build และ test ใน 12 นาที แล้วก็ต้องรอต่อ ตัว change ยังเดินทางจาก development ไป DevOps team แล้วไป operations ในรูปของ ticket และทุกอย่าง ship ใน release รายเดือนรอบเดียว: Release 2026.09 ออกไปวันเสาร์ที่ 26 กันยายน พร้อม change 41 ตัว สองวันต่อมา picking ของคลังสินค้าล่มไป 3 ชั่วโมง 20 นาที (INC-0917) การ review เริ่มด้วยการถามว่าใครเป็นคน deploy change นั้น ฝั่ง developer โทษ configuration change ของ operations ส่วน operations โทษ build เสีย ๆ จาก development และ note ก็อยู่แค่ใน wiki ของ operations ส่วนรายงาน IT รายเดือนแสดง server uptime กับจำนวน ticket ที่ปิด เลยไม่มีใครบอกได้ว่า delivery ดีขึ้นหรือเปล่า

ฝ่ายนี้เอาส่วนของ DevOps ที่ซื้อได้หรือเปลี่ยนชื่อได้มาใช้ แล้วปล่อยส่วนที่เหลือไว้เฉย ๆ ยังไม่มีใครดูทุกส่วนไปพร้อมกัน เลยไม่มีใครบอกได้ว่าส่วนไหนที่ฉุดส่วนอื่นไว้

## ทำงานยังไง

### CALMS มาจากไหน

John Willis อธิบาย DevOps ไว้ในโพสต์ *What Devops Means to Me* เมื่อเดือนกรกฎาคม 2010 ว่าเป็น CAMS: culture, automation, measurement และ sharing เขาให้คนกับ process มาก่อน และบอกว่า automation จะล้มเหลวถ้าไม่มี culture คอยหนุน เขาเรียกร้องให้วัด performance, process และคน และเรียก sharing ว่าเป็น feedback loop ที่ปิดวงจร แล้ว Willis ก็เขียนไว้บน IT Revolution ในปี 2012 ว่าเขากับ Damon Edwards คิดคำว่า CAMS ขึ้นหลังงาน DevOpsDays ครั้งแรกในสหรัฐฯ ที่จัดที่ Mountain View ในปี 2010 และต่อมา Jez Humble ก็เติม L สำหรับ Lean เข้าไป หน้า CALMS ของ Atlassian ก็ให้เครดิตตัวย่อนี้กับ Humble เหมือนกัน ในบทความของ *Cutter IT Journal* เดือนสิงหาคม 2011 เรื่องทำไมองค์กรใหญ่ต้องใช้ DevOps เพื่อ deliver อย่างต่อเนื่อง Humble กับ Joanne Molesky ยังไล่ไปตามสี่ dimension ของ CAMS อยู่ โดยอ้างอิง Willis

CALMS เป็นตัวช่วยจำ (mnemonic) ไม่ใช่มาตรฐาน ทั้งโพสต์ของ Willis และหน้าของ Atlassian ไม่ได้นิยามระดับ แบบสอบถาม หรือสเกลให้คะแนนไว้ ทุกองค์กรที่ให้คะแนน CALMS เลยต้องคิดสเกลของตัวเองขึ้นมา สเกล 1 ถึง 5 ของ Acme ใน diagram เป็นของตัวอย่างนี้เอง

### ห้า dimension

| Dimension | ครอบคลุมอะไร | หลักฐานที่ควรดู | Acme, ตุลาคม 2026 |
|---|---|---|---|
| **Culture** | ความรับผิดชอบร่วมกันระหว่างคนที่ build ระบบกับคนที่ run มัน, ความไว้ใจ, องค์กรตอบสนองยังไงเมื่อมีอะไรพัง | incident review (มองหาสาเหตุหรือหาคนผิด?), ใครอยู่เวร on-call, ใครตัดสินใจเรื่อง release | **2**: review ของ INC-0917 มองหาคนที่ deploy change นั้น |
| **Automation** | build, test, deployment, infrastructure และ configuration ที่เป็นขั้นตอนอัตโนมัติที่ทำซ้ำได้ | pipeline run, ขั้นตอน manual ที่ยังเหลืออยู่, server หรือ environment ถูกสร้างขึ้นยังไง | **4**: ทุก commit ถูก build และ test ใน 12 นาที, deploy ใช้ script แต่มีแค่ DevOps team ที่รันมัน |
| **Lean** | flow: batch เล็ก, จำกัด work in progress, งานที่มองเห็นได้, การรอและ rework ที่น้อยลง | จำนวน change ต่อ release, งานที่กำลังทำอยู่, งานรอระหว่างขั้นนานแค่ไหน | **2**: 41 change ใน release เดียว, งานระหว่างทำ 38 ชิ้น, ไม่มี WIP limit |
| **Measurement** | วัด flow ของงานและผลลัพธ์ของมัน ไม่ใช่วัดแค่ server | รายงานแสดงอะไรและใครอ่าน, รู้ lead time, deployment frequency, change fail rate และ recovery time หรือเปล่า | **3**: uptime กับจำนวน ticket ที่ปิด ไม่มีตัวเลขด้าน delivery |
| **Sharing** | ความรู้ เครื่องมือ ผลลัพธ์ และความรับผิดชอบที่แชร์ข้ามเส้นแบ่งของทีม | channel ที่ใช้ร่วมกัน, postmortem ที่เผยแพร่, dashboard ที่ใช้ร่วมกัน, on-call ร่วมกัน, internal talk และ documentation | **1**: chat channel แยกกันสามช่อง ไม่มี postmortem ที่แชร์กัน |

Dimension ต่าง ๆ พึ่งพากัน automation ที่สร้างโดยทีมที่โทษกันไปมาก็กลายเป็นกำแพงอีกชั้น, การวัดที่ไม่มีใครแชร์ก็ไม่ได้เปลี่ยนอะไร และ batch เล็ก ๆ ต้องมีความไว้ใจถึงจะกล้า release มัน นี่เลยเป็นเหตุผลที่ผลลัพธ์ที่มีประโยชน์ของการประเมินคือรูปร่างของคะแนน และที่สำคัญที่สุดคือจุดต่ำสุดของมัน ไม่ใช่ค่าเฉลี่ย

### เป็นมุมมอง ไม่ใช่ model

CALMS บอกว่าควรดูตรงไหน มันไม่ใช่เครื่องมือวิจัย และคะแนนของมันก็เป็นการตัดสินของกลุ่มเอง มีสองหน้าใน catalog นี้ที่มักถูกใช้คู่กับมัน:

| | CALMS | The Three Ways | DORA capabilities |
|---|---|---|---|
| มันคืออะไร | ห้าด้านที่ต้องตรวจดูตอนนำ DevOps มาใช้ | สามหลักการที่กำหนดทิศทางของการปรับปรุง: flow, feedback, การเรียนรู้อย่างต่อเนื่อง | catalog ของ practice ที่แต่ละตัวมี guidance ว่าจะ implement และวัดยังไง |
| ที่มา | Willis กับ Edwards (CAMS, 2010) โดย Humble เติม Lean เข้ามา | essay ปี 2012 ของ Gene Kim ตามด้วย *The Phoenix Project* และ *The DevOps Handbook* | research program ของ DORA ที่ตอนนี้ Google Cloud ดูแลอยู่ |
| หลักฐานรองรับ | ประสบการณ์ของคนทำงานจริง | Lean manufacturing และประสบการณ์ของคนทำงานจริง | งานวิจัยแบบ survey ที่รายงานมาตั้งแต่ปี 2014 ที่เชื่อม capability เข้ากับ delivery performance และ organisational performance ที่ดีขึ้น (เป็น correlation ไม่ใช่กฎ) |
| เหมาะใช้ทำอะไร | เปิดวงคุยและหาด้านที่อ่อนที่สุด | ตัดสินใจว่าจะผลักไปทางไหน | เลือกและวัด practice ตัวถัดไป |

ตัวอย่างเช่น capability *generative organizational culture* ของ DORA ต่อยอดจาก typology ของวัฒนธรรมองค์กรของนักสังคมวิทยา Ron Westrum และ DORA รายงานว่า culture ที่ไว้ใจกันสูงและมี information flow ที่ดี ทำนาย software delivery performance และ organisational performance ได้ catalog ของ DORA ยังครอบคลุม work in process limits, visibility of work in the value stream, visual management และ streamlining change approval ที่ตรงกับ lean, measurement และ sharing ส่วนหน้า [Three Ways](../three-ways/) กับ [DORA Metrics](../dora-metrics/) อธิบายสองเรื่องนั้นอย่างละเอียด

## ลงมือทำจริงยังไง

1. **ให้ทั้งสองฝั่งอยู่ในห้อง** developer, operations และ DevOps team หรือ platform team ถ้ามี บวกคนที่เป็นเจ้าของ business process ที่ระบบเหล่านี้รองรับ เลือก facilitator ที่ไม่ได้เป็นคนถูกให้คะแนน ส่วน Acme ยืม facilitator มาจากกลุ่ม SRE ของฝั่ง shop
2. **ตกลงสเกลก่อนให้คะแนน** เขียนไว้ว่าแต่ละระดับของแต่ละ dimension หมายถึงอะไร สเกลของ Acme เริ่มจาก 1 (ไม่มีใครทำ) ถึง 5 (ทุกคนทำและยังปรับปรุงต่อเรื่อย ๆ)
3. **เอาหลักฐานมา ไม่ใช่ความเห็น** incident review ไม่กี่ครั้งล่าสุด, pipeline run หนึ่งสัปดาห์, release log, board ของทีม, รายงานรายเดือน, chat channel ส่วนคะแนนที่ไม่มีหลักฐานจะไม่ถูกบันทึก
4. **ให้คะแนนทีละ dimension** ตรงที่ development กับ operations เห็นไม่ตรงกัน ให้จดทั้งสองมุมมองและหลักฐานเบื้องหลัง: การเห็นไม่ตรงกันนั้นก็เป็นสิ่งที่ค้นพบอย่างหนึ่ง
5. **หาว่าอะไรฉุดส่วนที่เหลือไว้** มักเป็น dimension ที่ต่ำที่สุด ที่ Acme คะแนน sharing (1) กับ culture (2) อธิบายว่าทำไม pipeline ที่ดี (4) ยังต้องป้อนงานเข้า release รายเดือนอยู่
6. **เลือก action ไม่กี่อย่างตรงนั้น แต่ละอย่างมีเจ้าของและกำหนดเสร็จ** ของ Acme คือ: blameless postmortem ที่แชร์ให้ทั้ง 40 คน (ตุลาคม), on-call rota เดียวสำหรับ developer และ operations (พฤศจิกายน), WIP limit บน board ของทุกทีม (ธันวาคม) และ delivery metric ของ DORA บน dashboard ที่ทุกคนเห็น (มกราคม)
7. **ประเมินใหม่ตามรอบ ด้วยคนกลุ่มเดิมและสเกลเดิม** แล้วเทียบฝ่ายกับอดีตของตัวเอง การประเมินครั้งที่สองของ Acme เมื่อ 8 เมษายน 2027 ได้ culture 3, automation 4, lean 3, measurement 4 และ sharing 3: ตอนนี้ review ถามว่าอะไรพัง ไม่ใช่ใครทำ, งานระหว่างทำลดจาก 38 เหลือ 15, delivery metric ถูกอ่านทุกสัปดาห์ และมี postmortem เจ็ดฉบับที่แชร์ไว้ใน incident channel เดียว
8. **ขุดลึกลงไปตรงที่คะแนนต่ำ** CALMS ชี้ไปที่ด้านหนึ่ง แล้วเครื่องมืออื่นก็ตรวจดูด้านนั้น [value stream map](../value-stream-mapping/) แสดงว่างานรออยู่ตรงไหน, Quick Check ของ DORA กับ [delivery metric ห้าตัว](../dora-metrics/) ของมันให้ baseline กับ measurement และคู่มือ *How to transform* ของ DORA ก็อธิบาย loop ที่ตามมา: เข้าใจสภาพปัจจุบัน ตั้งเป้าที่วัดได้ ทดลอง แล้วเช็กอีกรอบ โดยอิงจาก improvement kata ของ Mike Rother

## อยู่ตรงไหนใน solution

| Dimension | หน้าที่เกี่ยวข้อง |
|---|---|
| Culture | [Blameless Postmortems](../blameless-postmortems/), [Incident Management](../incident-management/), [You Build It, You Run It](../you-build-it-you-run-it/) |
| Automation | [Continuous Delivery](../continuous-delivery/), [Trunk-Based Development](../trunk-based-development/), [Infrastructure as Code](../infrastructure-as-code/), [GitOps](../gitops/) |
| Lean | [Value Stream Mapping](../value-stream-mapping/), [The Three Ways](../three-ways/) (First Way: flow), [Feature Flags](../feature-flags/) |
| Measurement | [DORA Metrics](../dora-metrics/), [SPACE & DevEx](../space-devex/), [SLOs & Error Budgets](../slo-error-budgets/), [Golden Signals](../golden-signals/) |
| Sharing | [Blameless Postmortems](../blameless-postmortems/), [Platform as a Product](../platform-as-a-product/), [Golden Paths](../golden-paths/) |

[Team Topologies](../team-topologies/) ให้ทางออกจาก org chart แบบของ Acme: stream-aligned team ที่ build และ run ระบบของตัวเอง และ platform team ที่ให้ pipeline เป็น product แบบ self-service แทนที่จะเป็นคิว ticket ส่วนถ้า IT service management ทำตาม ITIL ก็มีหน้า [ITIL 4](../itil-4/) ที่แสดงว่า change enablement ทำงานไปกับ DevOps ได้ยังไง แทนที่จะสวนทางกัน

## ใช้ตอนไหนดี

CALMS คุ้มค่าในที่ที่องค์กรเริ่มนำ DevOps มาใช้แล้ว แต่บอกไม่ได้ว่าทำไมมันไม่ได้ผล มักเป็นหลังจากซื้อเครื่องมือหรือปรับโครงสร้างองค์กร ตอนที่ส่วนที่ซื้อได้ง่ายทำเสร็จไปแล้ว มันให้ development กับ operations มีคำศัพท์ชุดเดียวกัน ใช้เวลาไม่เกินหนึ่งวัน และไม่ต้องใช้เครื่องมืออะไร มันเหมาะกับฝ่าย IT ขนาดใหญ่และแบบดั้งเดิม ที่บทสนทนาระหว่างสองฝั่งมักเป็นผลลัพธ์หลัก

ปรับใช้ให้เข้ากับบริบทที่ต่างออกไป:

- **สภาพแวดล้อมที่มีกฎระเบียบคุม** ต้องมี segregation of duties และ audit trail ให้คะแนนว่า control ถูกทำให้ครบยังไง (automated check, peer review, record ของ pipeline) แทนการดูว่ามี manual approval อยู่หรือเปล่า
- **Legacy system และระบบของ vendor** อย่าง ERP จำกัดว่า automation จะไปได้ไกลแค่ไหน และ release จะเล็กได้แค่ไหน ให้คะแนนเทียบกับสิ่งที่ platform นั้นยอมให้ทำ แล้วมองหาก้าวถัดไป ไม่ใช่เทียบกับทีม cloud-native
- **ทีมเล็ก** ไม่ต้องใช้ทั้งวัน: แค่ชั่วโมงเดียวคุยไล่ห้าตัวอักษรกับ incident ไม่กี่ครั้งล่าสุดก็พอ

มันลงทุนมากกว่าที่ได้คืน ถ้าเอาไปใช้เป็น benchmark ระหว่างทีมหรือระหว่างบริษัท (สเกลที่ทำขึ้นเองเทียบกันไม่ได้), เป็น certification หรือใช้แทนการวัด delivery พอทีมติดตาม metric ของ DORA และทำ postmortem แล้ว value stream map หรือ capability catalog ของ DORA จะบอกอะไรได้มากกว่าการให้คะแนนอีกรอบ

## กับดักที่เจอบ่อย

- **ใช้ CALMS เป็น maturity score เพื่อจัดอันดับทีม** league table ของคะแนนที่ประเมินตัวเองจะสอนให้ทีมเถียงเพื่อดันตัวเลขขึ้นและซ่อนปัญหา เก็บคะแนนไว้ในกลุ่มที่ให้คะแนนนั้น และเทียบกลุ่มกับอดีตของตัวเอง
- **Automation ก่อน และมีแค่ automation** เครื่องมือเป็นส่วนที่ซื้อง่ายที่สุด และมันก็แค่เร่ง culture ที่มีอยู่แล้ว ไม่ว่าจะเป็นแบบไหน: pipeline ของ Acme เป็น dimension ที่แข็งที่สุด แต่ตัวมันเองเปลี่ยนอะไรได้น้อย ให้เริ่มจาก dimension ที่อ่อนที่สุด Willis ให้ culture มาก่อน เพราะถ้าไม่มี culture ตัว automation ก็ทำอะไรได้น้อย
- **DevOps team ที่กลายเป็น silo ใหม่** Jez Humble บอกไว้ในปี 2012 ว่า DevOps team แยกที่คั่นอยู่ระหว่าง development กับ operations เป็นวิธีที่ไม่ดีในการแก้ปัญหาที่ silo สร้างขึ้น และ DevOps Topologies ของ Matthew Skelton กับ Manuel Pais ก็จัดมันเป็น anti-type (DevOps Team Silo) อยู่คู่กับทีม operations ที่แค่จ้างคนหรือเปลี่ยนชื่อคนเป็น "DevOps engineer" (Rebranded SysAdmin) ให้ development กับ operations แชร์งานและ on-call กัน และให้ platform team ให้บริการแบบ self-service แทนคิว ticket ([Platform as a Product](../platform-as-a-product/))
- **วัดแต่ไม่แชร์ผล** dashboard ที่มีแค่ manager เห็นไม่ได้เปลี่ยนงานของใครเลย เอาตัวเลขไปไว้ตรงที่ทีมมองเห็น review มันด้วยกัน และใช้มันหาปัญหาถัดไป ไม่ใช่หาคนผิด
- **เฉลี่ยห้าคะแนน** ค่าเฉลี่ยของ Acme ขึ้นจาก 2.4 เป็น 3.4 ทำให้ไม่เห็นว่า sharing ขึ้นจาก 1 เป็น 3 ขณะที่ automation ไม่ขยับเลย ให้อ่านรูปร่างของคะแนนและจุดต่ำสุดของมัน
- **ให้คะแนนจากความเห็น** ถ้าไม่มีหลักฐาน คะแนนก็สะท้อนเสียงที่ดังที่สุดในห้อง ไม่มีหลักฐาน ก็ไม่มีคะแนน
- **ประเมินครั้งเดียวแล้วไม่ตามต่อ** การประเมินครั้งเดียวเป็นแค่ภาพถ่ายช่วงเวลาหนึ่ง: slide ถูกเก็บเข้าแฟ้ม และไม่มีอะไรบอกว่า action ได้ผลหรือเปล่า ให้ทุก action มีเจ้าของและกำหนดเสร็จ และนัดวันประเมินใหม่ไว้ก่อนจบวัน
