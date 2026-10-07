## ปัญหา

ทีม checkout ของ Acme Shop ทำ gift wrapping เสร็จได้ในสามวัน แต่ลูกค้ากลับต้องรอ 47 วัน การเปลี่ยนแปลงนี้ต้องผ่านสี่กลุ่ม และแต่ละกลุ่มก็มีคิวของตัวเอง: product backlog, รอบ test ของทีม QA, change advisory board (CAB) ที่ประชุมเดือนละครั้ง และ release weekend ของทีม operations ทุกกลุ่มรวมงานเป็น batch เพื่อให้ขั้นของตัวเองทำงานได้คุ้ม และทุก batch ก็แปลว่าต้องรอ: ในตัวอย่างนี้ 41 จาก 47 วันหมดไปกับการรอในคิวที่ไม่มีใครเป็นเจ้าของ (ตัวเลขของ Acme เป็นตัวเลขของตัวอย่างนี้เอง ไม่ใช่ผลวิจัย)

ปัญหาไหลย้อนกลับมาช้ากว่านั้นอีก คนแรกที่เจอ query ที่ช้าคือลูกค้า ตามด้วยทีม operations และไม่มีใครในสองกลุ่มนี้เป็นคนเขียนมัน ทีม operations patch แก้ไป ไม่มีใครบอกทีม checkout แล้ว release ถัดไปก็ ship ความผิดพลาดแบบเดิมออกไปอีก ประเด็นของ Gene Kim คือ defect มักจะกลับมาซ้ำ ถ้าคนที่สร้างมันไม่เคยเห็นผลของมันเลย การเพิ่ม process เพื่อกันไม่ให้พลาด (approval อีกขั้น, test phase อีกรอบ, freeze ที่นานขึ้น) ยิ่งทำให้ batch ใหญ่ขึ้นและ feedback ช้าลงไปอีก

## ทำงานยังไง

Gene Kim อธิบาย Three Ways ไว้ในบทความปี 2012 บน IT Revolution ว่าเป็นหลักการที่ DevOps pattern ทั้งหมดต่อยอดออกมาได้ หลักการนี้เป็นโครงของ *The Phoenix Project* (Gene Kim, Kevin Behr และ George Spafford, 2013) นิยายเกี่ยวกับแผนก IT ที่กำลังเจอวิกฤต และของ *The DevOps Handbook* (Gene Kim, Jez Humble, Patrick Debois และ John Willis, 2016 ส่วน second edition ปี 2021 มี Nicole Forsgren เพิ่มเข้ามา) Handbook ฉบับ first edition แยก technical practice ของแต่ละ Way ไว้เป็นภาคของตัวเอง ไอเดียพวกนี้มาจากโลกการผลิต: Lean กับ Toyota Production System, Theory of Constraints ของ Eliyahu Goldratt และ systems thinking ของ W. Edwards Deming

### First Way: flow และ systems thinking

งานไหลจากซ้ายไปขวา จากฝั่งธุรกิจไปถึงลูกค้า แล้ว First Way ก็ปรับปรุง flow ทั้งเส้นนั้น ไม่ใช่แค่ส่วนของแผนกเดียวหรือคนคนเดียว ผลลัพธ์ที่ Kim ระบุไว้คือ: ไม่ส่ง defect ที่รู้อยู่แล้วต่อไปขั้นถัดไปเด็ดขาด, ไม่ยอมให้การ optimize เฉพาะจุดทำให้ภาพรวมแย่ลง, เพิ่ม flow ต่อไปเรื่อย ๆ และเข้าใจระบบทั้งระบบ

- **Map value stream** Value stream mapping ที่แพร่หลายจาก workbook *Learning to See* ของ Mike Rother กับ John Shook (Lean Enterprise Institute) วาดทุกขั้นตั้งแต่ request จนถึงส่งมอบเป็น current-state map แล้วค่อยวาด future-state map ที่จะมุ่งไปให้ถึง ในแต่ละขั้นให้จดเวลาที่มีคนลงมือทำงานชิ้นนั้นจริง (process time) และเวลาที่มันรอ ส่วน lead time คือการเดินทางทั้งหมดตั้งแต่ต้นจนจบ ใน diagram มี process time 6 วันอยู่ใน lead time 47 วัน
- **ทำให้งานมองเห็นได้และจำกัด work in progress** board ที่แสดงงานทั้งหมดของทีม (feature, defect, งาน operations) พร้อม WIP limit จะทำให้เห็นคิว และกันไม่ให้ทีมเริ่มงานมากกว่าที่ทำเสร็จ
- **ทำ batch ให้เล็กลง** บทความเรื่อง First Way ของ Kim ไล่เครื่องมือที่ได้มาจาก Lean, Toyota Production System และ Theory of Constraints: ขยายคอขวด, ลด work in process และขนาด batch, ปล่อยงานตามจังหวะของ demand, ตัด waste ทิ้ง และทำให้ความผันผวนเรียบลง ส่วน gift wrapping ก็ ship เป็นสี่ slice แทนที่จะไปรอขึ้น release รายเดือน
- **ปรับปรุงที่ constraint** ใน *The Goal* (1984) Goldratt บอกว่าระบบจะไปได้เร็วแค่เท่ากับ constraint ของมัน five focusing steps ของเขาคือ: หา constraint ให้เจอ, ใช้มันให้เต็มที่, ให้ทุกอย่างที่เหลือเดินตามมัน, ขยายมัน แล้วเริ่มใหม่ เพื่อไม่ให้ความเฉื่อยกลายเป็น constraint ตัวถัดไป ชั่วโมงที่ประหยัดได้ที่จุดอื่นไม่ใช่ชั่วโมงที่ลูกค้าได้คืน
- **ทำ handoff ให้เป็นอัตโนมัติ** deployment pipeline ที่ test ทุกการเปลี่ยนแปลงและ deploy ได้ด้วยปุ่มเดียว เข้ามาแทนคิวที่รออยู่หน้าทีม QA และทีม operations

### Second Way: feedback

สร้าง feedback ที่เร็วจากขวาไปซ้ายในทุกขั้น เพื่อให้เห็นปัญหาตรงที่และตอนที่มันเกิด แล้วขยายมันให้ดังพอจะไปถึงคนที่ลงมือแก้ได้ ผลลัพธ์ที่ Kim ระบุไว้คือ: เข้าใจและตอบสนองลูกค้าทุกคน ทั้งภายในและภายนอก, ทำให้ feedback loop ทุกวงสั้นลงและดังขึ้น และเอาความรู้ไปไว้ตรงที่ต้องใช้

- **หยุดไลน์** หนึ่งในสองเสาหลักของ Toyota Production System คือ *jidoka*: หยุดทันทีที่มีอะไรผิดปกติ ในสายการผลิต การดึง andon cord จะทำให้ป้ายสัญญาณสว่างขึ้นและเรียกคนมาช่วย ส่วนในงาน software เทียบได้กับ: พอ test ไม่ผ่านหรือ pipeline เป็นสีแดง ทีมก็หยุดเริ่มงานใหม่ แล้วรุมกันแก้ปัญหาจนเสร็จ
- **Telemetry สำหรับคนที่ทำการเปลี่ยนแปลง** metric, log และ trace, deploy marker บน dashboard และ alert ที่ส่งตรงไปหาทีมที่เป็นเจ้าของ service แบบนี้ regression จะโผล่ให้เห็นภายในไม่กี่นาทีหลัง deploy ที่เป็นต้นเหตุ
- **Review ใกล้ ๆ ตัวงาน** ในงานวิจัยปี 2019 ของ DORA การให้หน่วยงานภายนอกอย่าง CAB เป็นคน approve ทำให้ software delivery performance แย่ลง และไม่มีหลักฐานว่ามันช่วยให้ change ที่ล้มเหลวน้อยลงเลย DORA แนะนำให้ทำ peer review ระหว่างพัฒนา โดยมี automated check คอยหนุน ส่วน The DevOps Handbook จัดเรื่อง review และการประสานงานไว้ใต้ Second Way

### Third Way: เรียนรู้และทดลองอย่างต่อเนื่อง

สร้างวัฒนธรรมที่กล้าทดลอง กล้าเสี่ยง และเรียนรู้จากความล้มเหลว และมองว่าการทำซ้ำกับการฝึกฝนคือทางไปสู่ความเชี่ยวชาญ ผลลัพธ์ที่ Kim ระบุไว้คือ: มีเวลาที่กันไว้ปรับปรุงงานประจำวัน, มีธรรมเนียมที่ให้รางวัลทีมเมื่อกล้าเสี่ยง และมีการใส่ fault เข้าไปในระบบเพื่อให้มัน resilient ขึ้น Handbook ฉบับ first edition พูดเรื่องนี้ไว้สามบท: ใส่การเรียนรู้เข้าไปในงานประจำวัน, เปลี่ยนสิ่งที่ค้นพบในทีมเดียวให้เป็นการปรับปรุงของทั้งองค์กร และกันเวลาไว้ให้องค์กรได้เรียนรู้และปรับปรุง

- **เรียนรู้จากความล้มเหลวโดยไม่โทษใคร** blameless postmortem มองหาสาเหตุที่มีส่วนทำให้เกิด incident โดยไม่โทษคนหรือทีมไหน (SRE book ของ Google บทที่ 15) โพสต์ปี 2012 ของ John Allspaw เรื่อง blameless postmortem ที่ Etsy ผูกแนวทางนี้เข้ากับ just culture
- **ซ้อมพังแบบตั้งใจ** game day กับ chaos experiment จะใส่ fault เข้าไป (ในที่นี้คือ delay 3 s ใน gift-wrap lookup) เพื่อตรวจว่ากลไกป้องกันใช้ได้จริง ก่อนที่ incident จริงจะมาทดสอบมัน
- **กระจายสิ่งที่ค้นพบในทีมออกไป** fix ในโค้ดของทีมเดียวก็ปกป้องได้แค่ทีมเดียว แต่ถ้าย้ายมันไปไว้ใน shared library, service template หรือค่า default ของ platform (ในที่นี้คือ timeout 1 s ใน HTTP client ที่ใช้ร่วมกัน) ก็จะปกป้องได้ทุกทีม
- **กันเวลาไว้** งานปรับปรุงต้องแย่งเวลากับงาน feature และจะแพ้ ถ้าไม่มี capacity ที่กันไว้ให้มัน Acme กันไว้ 20% ของแต่ละ sprint ส่วนจะกันไว้เท่าไหร่ดี ให้ทีมตัดสินใจเอง

### กรอบคิดที่เกี่ยวข้อง

- **CALMS** ในปี 2010 John Willis สรุป DevOps ไว้เป็น CAMS: culture, automation, measurement และ sharing ส่วน CALMS ที่ Atlassian ให้เครดิตกับ Jez Humble เพิ่ม Lean เข้ามา มันเป็นรายการของสิ่งที่ต้องดู ส่วน Three Ways บอกทิศทางของการปรับปรุง
- **DORA และ *Accelerate*** DORA เป็นโครงการวิจัยที่ตอนนี้ Google Cloud ดูแลอยู่ ออกรายงานมาตั้งแต่ปี 2014 แล้ว *Accelerate* (Nicole Forsgren, Jez Humble และ Gene Kim, 2018) ก็สรุปงานวิจัยนั้นสี่ปี DORA วัด software delivery ด้วย metric ห้าตัว: change lead time, deployment frequency, failed deployment recovery time, change fail rate และ deployment rework rate (ดู [DORA Metrics](../dora-metrics/)) ตัว change lead time ของ DORA นับจาก commit ถึง production เลยครอบคลุมแค่ปลายฝั่งขวาของ value stream ใน diagram ส่วน 47 วันกับ 4 วันในที่นี้นับจากไอเดียจนถึงลูกค้า DORA พบว่าสำหรับทีมส่วนใหญ่ ความเร็วกับความเสถียรมาด้วยกัน ไม่ได้ต้องแลกกัน และบอกว่า batch ที่เล็กลงเป็นวิธีที่ใช้กันบ่อยในการปรับปรุงทั้งสองอย่าง

## ลงมือทำจริงยังไง

1. **Map value stream สักหนึ่งเส้น** เลือก product มาหนึ่งตัว แล้วตามงานจริงตั้งแต่ไอเดียจนถึงลูกค้า โดยทำไปพร้อมกับคนที่ทำงานนั้น จด process time กับเวลารอของแต่ละขั้น และ lead time ทั้งหมด แค่ whiteboard กับ spreadsheet ก็เริ่มได้แล้ว
2. **ทำให้งานมองเห็นได้** หนึ่ง board ต่อหนึ่งทีม รวมงานที่ไม่ได้วางแผนไว้และงาน operations ด้วย และตั้ง WIP limit ไว้ที่ column ที่งานกองสุมกัน
3. **จัดการคิวที่ใหญ่ที่สุดก่อน** ส่วนใหญ่มันคือ approval, test phase หรือ release window ไม่ใช่ความเร็วในการทำงานของใคร map ใหม่ทุกครั้งที่เปลี่ยนอะไรไป เพราะ constraint จะย้ายที่
4. **ทำ batch ให้เล็กลง** หั่น feature เป็น slice ที่ ship ได้ด้วยตัวเอง, merge เข้า main branch อย่างน้อยวันละครั้ง ([Trunk-Based Development](../trunk-based-development/)) และซ่อนงานที่ยังไม่เสร็จไว้หลัง [Feature Flags](../feature-flags/)
5. **ทำทางไป production ให้เป็นอัตโนมัติ** มี pipeline เดียวที่ build, test และ deploy ทุกการเปลี่ยนแปลงด้วยวิธีเดียวกัน ([Continuous Delivery](../continuous-delivery/)) และใช้ [Canary Release](../canary-release/) จำกัดจำนวนผู้ใช้ที่ change ที่มีปัญหาจะไปถึง
6. **ตกลงกันว่าจะหยุดไลน์** พอ main branch หรือ pipeline เป็นสีแดง การแก้ให้กลับมาเขียวต้องมาก่อนการเริ่มงานใหม่
7. **ต่อ feedback ให้ถึงทีม** ส่ง telemetry ผ่าน [Telemetry Pipeline](../telemetry-pipeline/), ใส่ deploy marker บน dashboard, ตั้ง alert ตามสิ่งที่ผู้ใช้รู้สึกได้ ([SLOs & Error Budgets](../slo-error-budgets/)) และให้ทีมที่เป็นเจ้าของ service อยู่เวร on-call เอง ([You Build It, You Run It](../you-build-it-you-run-it/))
8. **เปลี่ยน approval จากภายนอกเป็น peer review กับ automated check** และเก็บ record ของพวกมันไว้เป็นหลักฐานสำหรับ audit ในที่ที่กฎระเบียบบังคับให้แยกหน้าที่ (segregation of duties)
9. **เรียนรู้ตามตารางที่วางไว้** ทำ [Blameless Postmortems](../blameless-postmortems/) ที่ action item ทุกข้อมีเจ้าของและกำหนดเสร็จ, จัด game day กับ experiment แบบ [Chaos Engineering](../chaos-engineering/) เป็นประจำ, กันสัดส่วน capacity ที่แน่นอนไว้ให้งานปรับปรุง และใช้ shared library กับ template ส่งต่อสิ่งที่ทีมหนึ่งได้เรียนรู้
10. **วัดผลลัพธ์ ไม่ใช่กิจกรรม:** lead time, deployment frequency, change fail rate และ recovery time โดยติดตามไปหลาย ๆ เดือน

## อยู่ตรงไหนใน solution

Three Ways เป็นเหตุผลเบื้องหลังหลายหน้าใน catalog นี้:

| Way | หน้าที่เกี่ยวข้อง |
|---|---|
| First Way: flow | [Continuous Delivery](../continuous-delivery/), [Trunk-Based Development](../trunk-based-development/), [Feature Flags](../feature-flags/), [Canary Release](../canary-release/), [Blue-Green Deployment](../blue-green-deployment/), [Rolling Update](../rolling-update/), [Immutable Infrastructure](../immutable-infrastructure/), [GitOps](../gitops/) |
| Second Way: feedback | [Telemetry Pipeline](../telemetry-pipeline/), [Distributed Tracing](../distributed-tracing/), [Centralized Logging](../centralized-logging/), [Health Endpoint Monitoring](../health-endpoint-monitoring/), [SLOs & Error Budgets](../slo-error-budgets/), [You Build It, You Run It](../you-build-it-you-run-it/) |
| Third Way: learning | [Blameless Postmortems](../blameless-postmortems/), [Chaos Engineering](../chaos-engineering/), [Timeout & Fallback](../timeout-and-fallback/) (ค่า default ที่ปลอดภัยแบบที่ควรแชร์ต่อ) |
| วัดผลลัพธ์ | [DORA Metrics](../dora-metrics/) |

Team Topologies เอาแนวคิดเดียวกันไปใช้กับองค์กร: stream-aligned team เดินตาม flow ของงานหนึ่งสาย ส่วน platform team ก็ทำ product ภายใน เช่น shared library ที่มีค่า default ปลอดภัย เพื่อให้ทีมพวกนั้นไปได้เร็วขึ้น

## ใช้ตอนไหนดี

Three Ways คุ้มค่าในทุกที่ที่ software เปลี่ยนบ่อย และมีหลายกลุ่มที่ต้องมีส่วนในการพา change ไปถึง production: lead time ยาวที่ส่วนใหญ่เป็นเวลารอ, incident แบบเดิมกลับมาซ้ำ, ทีมที่รู้เรื่องใน production ก็ต่อเมื่อมี ticket มาเท่านั้น มันบอกทิศทาง ไม่ใช่ maturity model เลยเหมาะกับการค่อย ๆ ขยับทีละก้าว: ทีละ value stream ทีละ pipeline ทีละ postmortem

ปรับใช้ให้เข้ากับบริบทที่ต่างออกไป:

- **สภาพแวดล้อมที่มีกฎระเบียบคุม** ยังต้องมี segregation of duties และ audit trail อยู่ peer review, automated check และ record ของ pipeline เองให้ได้ทั้งสองอย่าง ตามที่ guidance เรื่อง change approval ของ DORA อธิบายไว้ และควรดึง auditor เข้ามาตั้งแต่เนิ่น ๆ
- **Legacy system** ที่ deploy ด้วยมือและ test ช้า ย้ายมาใช้ batch เล็กข้ามคืนไม่ได้ ให้เริ่มจาก value stream map กับคิวที่ใหญ่ที่สุด แล้วค่อย ๆ แยกชิ้นออกมาด้วย pattern [Strangler Fig](../strangler-fig/)
- **ทีมเล็ก** มี handoff ให้ตัดน้อย สำหรับทีมแบบนี้ Second Way กับ Third Way (telemetry, postmortem, เวลาที่กันไว้) สำคัญกว่างานด้าน flow
- **Hardware, firmware และ mobile app** ship ตามรอบที่มาจากภายนอก (รอบการผลิต, app store review) ให้ทำ batch ภายในรอบให้เล็กลง และดึง feedback ให้มาเร็วขึ้นด้วย simulator, staged rollout และ telemetry

มันลงทุนมากกว่าที่ได้คืน สำหรับระบบที่นาน ๆ จะเปลี่ยนและนาน ๆ จะพัง: internal tool ที่ release ปีละสองครั้งไม่ต้องมี pipeline ที่ทำ canary analysis แต่พอระบบล่มครั้งหน้า ก็ยังคุ้มที่จะเขียน postmortem อยู่ดี

## กับดักที่เจอบ่อย

- **"DevOps team" ที่กลายเป็น silo ใหม่** ทีมที่สามที่มาคั่นระหว่าง development กับ operations เพิ่ม handoff เข้ามาแทนที่จะตัดออก ตามที่ Jez Humble ชี้ไว้ในปี 2012 ให้ทีมที่ build service มีเครื่องมือและความรับผิดชอบในการ run มันเอง และให้ platform team ทำแบบ self-service แทนการรับ ticket
- **ซื้อเครื่องมือโดยไม่เปลี่ยน flow** CI server ที่ยังต้องผ่าน change board รายเดือนก็ยัง ship เดือนละครั้งอยู่ดี map value stream ก่อน แล้วให้คิวที่ใหญ่ที่สุดเป็นตัวตัดสินว่าจะเปลี่ยนอะไร
- **เอา process ที่พังมาทำเป็นอัตโนมัติ** release ที่ต้องมีห้า approval พอเขียน script แล้วก็รันเร็วขึ้น แต่ก็ยังต้องรอห้า approval อยู่ดี ตัดขั้นที่ไม่เพิ่มคุณค่าทิ้งก่อน แล้วค่อยทำส่วนที่เหลือให้เป็นอัตโนมัติ
- **Optimize ขั้นที่ไม่ใช่ constraint** การลดเวลา build ลงครึ่งหนึ่งประหยัดได้แค่ไม่กี่นาที ถ้าหลังจากนั้น change ยังต้องรอประชุม board อีก 12 วัน ให้วัดเวลารอด้วย ไม่ใช่วัดแค่เวลาทำงาน
- **Alert ที่ไม่มีใครทำอะไรกับมัน** alert ทุกครั้งที่ CPU พุ่งจะสอนให้คนเมินมัน ให้ alert ตามอาการที่ผู้ใช้รู้สึกได้, ส่งแต่ละ alert ไปหาทีมที่เป็นเจ้าของ service และลบตัวที่ไม่มีใครทำอะไรด้วยทิ้งไป
- **Postmortem ที่ไม่มีการตามต่อ** postmortem ที่เขียนไว้ดี แต่ action item ไม่เคยถูกทำ ก็คือการปูทางให้ incident ครั้งถัดไป ให้ทุก action มีเจ้าของและกำหนดเสร็จ, ติดตามมันเหมือนงานอื่น ๆ และแชร์บทเรียนออกไปนอกทีม
- **มอง Ways เป็นขั้น ๆ** diagram เล่าทีละ Way ต่อกัน แต่จริง ๆ แล้วมันพึ่งพากัน: flow ที่ไม่มี feedback ก็แค่ ship ปัญหาออกไปเร็วขึ้น ส่วน feedback ที่ไม่มีเวลาให้เรียนรู้ก็แค่เจอปัญหาเดิมเร็วขึ้น ให้ทำทั้งสามอย่างไปพร้อมกันทีละก้าวเล็ก ๆ
- **เปลี่ยนตัวเลขผลลัพธ์ให้เป็นเป้า** ทีมที่ถูกสั่งให้ deploy บ่อยขึ้นก็แค่แตก deploy ออกเป็นหลายครั้งได้โดยไม่มีอะไรดีขึ้นเลย ให้ใช้ lead time และตัววัดอื่น ๆ เพื่อหา constraint ตัวถัดไป ไม่ใช่เพื่อจัดอันดับทีม
