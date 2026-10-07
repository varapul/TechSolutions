## ปัญหา

ที่ Acme Shop พอ developer ฝั่ง payments ทำ release เสร็จ ก็ส่งต่อให้ operations team ส่วนกลาง ทีมนี้เป็นคน deploy และดูแล service ของทุก product team ตัว release 2.8.0 มี memory leak ทำให้ทุกคืน memory ใน pod ของ payments ไต่ขึ้นเรื่อย ๆ จน container ชน limit แล้วโดน kill (`OOMKilled`) จากนั้น payment ก็ล้มเหลว operations engineer ที่อยู่ on-call โดน page แล้ว restart pod ด้วยมือตอน 02:10 ให้เริ่มใหม่แบบสะอาด แล้วเปิด ticket OPS-4127 ส่วน developer ที่หา leak เจอได้ก็มาเห็น ticket สี่วันต่อมา reproduce ปัญหาบน staging ไม่ได้ แล้วขอ log กับ heap dump ที่ operations หามาให้ได้ไม่ง่าย ผ่านไปสามสัปดาห์กับการ restart 21 ครั้ง ตัว leak ก็ยังอยู่ใน production

ไม่มีใครในเรื่องนี้ทำงานชุ่ย โครงสร้างต่างหากที่แบ่งงานผิดที่: ทีมที่แก้โค้ดไม่เคยเห็นว่าโค้ดทำงานยังไงใน production ส่วนทีมที่เห็นก็แก้โค้ดไม่ได้ แล้ว feedback ก็ต้องเดินทางผ่านคิวของ ticket เลยมาถึงช้าไปหลายวันและรายละเอียดหายไประหว่างทาง แล้วสองทีมก็ดึงไปคนละทาง หนังสือ *Site Reliability Engineering* ของ Google (2016) อธิบายความตึงแบบเดียวกันไว้ในบทนำ: developer อยาก launch feature ส่วน operations ไม่อยากให้อะไรพังระหว่างที่ตัวเองถือ pager และเพราะ outage ส่วนใหญ่เกิดตามหลังการเปลี่ยนแปลง สองเป้าหมายนี้เลยขัดกัน

## ทำงานยังไง

วลีนี้มาจากบทสัมภาษณ์ปี 2006 ที่ Jim Gray สัมภาษณ์ Werner Vogels ที่เป็น CTO ของ Amazon ให้ ACM Queue: **"you build it, you run it."** ตัว Vogels เทียบมันกับ model แบบดั้งเดิม ที่ซอฟต์แวร์ถูกโยนข้ามกำแพงจาก development ไปให้ operations ตามที่เขาเล่า การให้ developer รับผิดชอบงาน operations ทำให้คุณภาพ service ของ Amazon ดีขึ้น เพราะมันทำให้ developer ได้เจอทุกวันว่าซอฟต์แวร์ของตัวเองทำงานยังไงใน production และได้เจอลูกค้าของมัน เป็น feedback loop ที่เขาบอกว่าขาดไม่ได้

ทีมที่สร้าง service เป็นเจ้าของมันใน production แบบครบวงจร:

- **เส้นทางของการเปลี่ยนแปลง:** โค้ดและ deployment pipeline การ deploy การ rollback และการหยุด release ชั่วคราว เป็นการตัดสินใจของทีมเอง
- **การมองเห็น:** dashboard, alert rule และ runbook ที่เก็บไว้ข้างโค้ดและเปลี่ยนไปพร้อมกับโค้ด
- **Pager:** on-call rotation ของ engineer ในทีมเอง พอ service page ก็จะ page หาคนที่แก้มันได้
- **อำนาจ:** สิทธิ์เข้าไปแก้ production และสิทธิ์เอางานแก้ขึ้นไปไว้บนสุดของ sprint ถัดไป

แนวทางนี้ได้ผลเพราะทำให้ feedback loop สั้นลง *The Three Ways* ของ Gene Kim (IT Revolution, 2012) ยกการขยาย feedback loop จาก operations และลูกค้ากลับไปหาคนที่ทำงาน ให้เป็น Second Way ของ DevOps พอ engineer ที่ทำการเปลี่ยนแปลงเป็นคนโดน page ต้นทุนของการเปลี่ยนแปลงที่เปราะบางก็ตกอยู่กับพวกเขาเอง และการแก้ที่ต้นเหตุก็กลายเป็นทางที่ต้นทุนต่ำที่สุดที่จะได้นอนหลับสบายทั้งคืน นั่นคือสิ่งที่ขั้นที่สองแสดงให้เห็น: on-call engineer จำ deploy 2.8.0 ได้จาก dashboard ของทีมเอง แล้ว rollback ภายในสิบเอ็ดนาที และทีมก็แก้ leak ในเช้าวันต่อมา

**เทียบกับ SRE แบบที่ Google อธิบาย** หนังสือ SRE ของ Google (2016) อธิบายการแบ่งงานอีกแบบ ที่มีหลักการเดียวกันอยู่ข้างใต้ ทีม SRE โดยเฉพาะจะรับ pager ของ service ไปก็ต่อเมื่อผ่าน production readiness review แล้ว หนังสือเรียกขั้นนี้ว่าเงื่อนไขที่ต้องมีก่อน SRE จะรับ service (บทที่ 32) ส่วน developer ก็ยังต้องรับผิดชอบอยู่: SRE จำกัดงาน operations ของตัวเองไว้ที่ 50% แล้วส่งส่วนที่เกินกลับไปให้ product team รวมถึงการเอา developer กลับเข้า pager rotation (บทที่ 1) ทีม developer ของ service ที่ SRE ดูแลมักจะยังมี rotation 24/7 ไว้รับ escalation (บทที่ 11) และ SRE ก็ส่ง service คืนให้ developer ได้เมื่อแบบนั้นสมเหตุสมผลกว่า (*The Site Reliability Workbook* บทที่ 18) ถ้าไม่มีทีม SRE รับ service ไป คนที่สร้างก็เป็นคนดูแลเอง

**ในมุมของทีม** *[Team Topologies](../team-topologies/)* ของ Matthew Skelton และ Manuel Pais (2019; ฉบับที่สองปี 2025) เรียกทีมที่เป็นเจ้าของส่วนหนึ่งของธุรกิจแบบครบวงจรว่า *stream-aligned* team และสรุป key concept ของหนังสือที่ผู้เขียนทำไว้ก็อธิบายทีมพวกนี้ว่าเป็นทีมแบบ you-build-it-you-run-it ที่ไม่มีการส่งงานต่อให้ทีมอื่น ส่วน platform team ให้ internal service ที่ทีมเหล่านี้ใช้ได้เองแบบ self-service (interaction mode แบบ *X-as-a-Service*) และ complicated-subsystem team ก็ถือความรู้เฉพาะทางเชิงลึกไว้ ทาง AWS ก็อธิบาย operating model เดียวกัน: operational excellence pillar ของ [Well-Architected Framework](../well-architected-framework/) (พฤศจิกายน 2024) เรียกมันว่า *decentralized DevOps* เป็นรูปแบบหนึ่งของ you build it, you run it และ DevOps Guidance ของ AWS ก็แนะนำให้ทีมเป็นเจ้าของ value stream ทั้งหมดของตัวเอง (OA.STD.6)

## ลงมือทำจริงยังไง

1. **ตั้งเจ้าของหนึ่งทีมต่อหนึ่ง service** บันทึกทีมเจ้าของไว้ใน service catalog (เช่น field `spec.owner` ใน Backstage) แล้ว route alert ของ service ไปที่ rotation ของทีมนั้น เช่นใช้ route ของ [Alertmanager](../prometheus/) ส่งไปที่ PagerDuty หรือเครื่องมือที่คล้ายกัน ถ้า page ของ service ยังไปถึงคนนอกทีมได้ ความเป็นเจ้าของก็ยังไม่ใช่ของจริง
2. **ส่งกุญแจไปพร้อมกับ pager** ทีมได้ทั้ง pipeline สิทธิ์ deploy และ rollback สิทธิ์อ่าน log และ metric ของ production และเส้นทางสำหรับเหตุฉุกเฉินที่มี audit: elevated access แบบ just-in-time ที่ต้องขอ ต้องได้ approve มีเวลาจำกัด และถูก log ไว้ (AWS DevOps Guidance AG.SAD.4 อธิบาย pattern นี้) การ page หาทีมที่แก้ production ไม่ได้ก็แค่ย้ายความเจ็บปวดไปที่อื่น
3. **ผ่าน readiness review ก่อนรับ pager** ก่อน go-live ให้ตรวจว่า service มี SLO มี dashboard ของ SLO นั้น มี alert บนอาการที่ผู้ใช้รู้สึกได้ โดยมี runbook ของแต่ละตัว มี rollback ที่ทดสอบแล้ว และรู้ capacity กับ dependency ของมัน ทีม SRE ของ Google ทำ review นี้ก่อนรับ service และ checklist เดียวกันก็ใช้ได้เมื่อคนสร้างจะเป็นคนดูแลเอง
4. **กำหนดขนาด rotation** หนังสือ SRE ให้ on-call กินเวลาไม่เกิน 25% ของเวลาของ engineer และคำนวณว่า rotation 24/7 ที่มี primary และ secondary ในไซต์เดียวต้องใช้ engineer อย่างน้อยแปดคน แต่ละคนอยู่ on-call หนึ่งสัปดาห์ต่อเดือน หรือหกคนต่อไซต์ถ้ามีสองไซต์แชร์กัน (บทที่ 11) หนังสือยังให้ response time ทั่วไปไว้ด้วย: 5 นาทีสำหรับ service ที่ผู้ใช้เจอโดยตรง และ 30 นาทีสำหรับ service ที่ด่วนน้อยกว่า ส่วน payments team ของ Acme มี engineer 7 คน เลยรับ primary shift รายสัปดาห์ (หนึ่งสัปดาห์ในเจ็ด) และแชร์ secondary กับ engineer 7 คนของทีม checkout (หนึ่งสัปดาห์ใน 14): engineer แต่ละคนเลยอยู่ on-call ราว 21% ของสัปดาห์ทั้งหมด
5. **วัดภาระงานแล้วลงมือแก้** นับ page ต่อ shift และ review ทุกสัปดาห์ หนังสือ SRE ประเมินว่างานต่อหนึ่ง incident รวม follow-up แล้วอยู่ราวหกชั่วโมง เลยตั้งเพดานไว้ที่สอง incident ต่อ shift 12 ชั่วโมง ส่วน Workbook ตั้งเป้าไว้ไม่เกินสองครั้งต่อ shift (บทที่ 8) ทุก alert ที่ page ควร actionable และผูกกับอาการที่คุกคาม [SLO](../slo-error-budgets/) ส่วน alert ที่เหลือให้เปลี่ยนเป็น ticket หรือลบทิ้ง แล้ว [golden signals](../golden-signals/) ก็เป็นจุดเริ่มต้นที่ดีว่าควร alert เรื่องอะไร
6. **จ่ายให้คุ้ม ทั้งเวลาและเงิน** ชดเชยงานนอกเวลา (หนังสือ SRE พูดถึงการให้วันหยุดชดเชยหรือจ่ายเป็นเงิน โดยมีเพดานเป็นสัดส่วนของเงินเดือน) และกันเวลาไว้ในทุก sprint สำหรับงานแก้ที่ page เผยให้เห็น ทาง Acme กันไว้ 20% ของแต่ละ sprint (เป็นตัวเลขของ Acme เอง) page เดิมจะได้ไม่กลับมาอีก
7. **เรียนรู้โดยไม่โทษใคร** เขียน blameless postmortem ให้ทุก incident ที่สำคัญ และติดตาม action item ของมันจนเสร็จ ฝึกคนใหม่ด้วย shadow shift และ incident ซ้อม (ทีม SRE ของ Google เรียกของตัวเองว่า Wheel of Misfortune)
8. **ให้ platform team ปูถนนไว้ให้** product team หกทีมไม่ควรต้องสร้าง pipeline หกชุดและ monitoring stack หกชุด ตัว platform team ของ Acme ดูแล [Kubernetes](../kubernetes/) cluster ที่ใช้ร่วมกัน, CI/CD และ observability stack และให้ deploy pipeline, dashboard, runbook template และ on-call tooling เป็น product แบบ self-service ที่ทำให้การดูแล service มีต้นทุนต่ำสำหรับทุกทีม

## อยู่ตรงไหนใน solution

- **[SLOs and Error Budgets](../slo-error-budgets/)** ตัดสินว่าอะไรจะ page หาทีม และทีม ship ได้เร็วแค่ไหน ตัว error budget เปลี่ยน reliability ให้เป็น trade-off ที่ทีมเจ้าของตัดสินใจเอง
- **[Golden Signals, RED & USE](../golden-signals/)** บอกว่าควรวัดและ alert เรื่องอะไร ส่วน **[Prometheus](../prometheus/)** กับ Alertmanager ก็เป็นวิธีที่นิยมในการ route alert พวกนั้นไปที่ rotation ของทีมเจ้าของ
- **[Canary Release](../canary-release/)** และ **[Health Endpoint Monitoring](../health-endpoint-monitoring/)** ทำให้การ deploy ของทีมเองปลอดภัยขึ้นและ rollback ได้เร็ว นี่แหละที่ทำให้ page ตอน 02:10 จบได้สั้น ๆ
- **[Incident Management](../incident-management/)** พูดถึงวิธีจัดการ incident ที่กำลังเกิดอยู่หลัง page มาถึง ส่วนหน้านี้พูดถึงว่าใครเป็นเจ้าของ service ในแต่ละวัน **[Blameless Postmortems](../blameless-postmortems/)** และ **[Eliminating Toil](../eliminating-toil/)** คือสิ่งที่ทีมทำกับบทเรียนที่ page สอน
- **[The Three Ways](../three-ways/)** อธิบายว่าทำไม feedback ถึงสำคัญ ส่วน **Team Topologies** และ **Platform as a Product** อธิบายโครงสร้างทีมรอบ ๆ แนวทางนี้: stream-aligned team ที่เป็นเจ้าของ service และ platform team ที่ทำให้การเป็นเจ้าของ service มีต้นทุนต่ำ

## ใช้ตอนไหนดี

แนวทางนี้คุ้มกับ service ที่เปลี่ยนบ่อยและมี product team ที่อยู่ยาวเป็นเจ้าของ: microservice ที่มีเจ้าของชัดเจน service ที่ลูกค้าใช้โดยตรงที่เวลาตั้งแต่เห็นอาการจนแก้เสร็จมีความสำคัญ และ service ไหนก็ตามที่ปัญหาเด้งไปมาระหว่างทีมไม่หยุด ส่วนกรณีต่อไปนี้มีต้นทุนสูงกว่า หรือต้องปรับให้เข้ากับบริบท:

- **ทีมเล็ก** ถ้ามี engineer น้อยกว่าราวแปดคนในไซต์เดียว ก็จัด rotation แบบ primary และ secondary 24/7 ให้อยู่ในเพดานของหนังสือ SRE ไม่ได้ ให้รวม rotation กับทีมใกล้เคียงแบบที่ Acme ทำ หรือ page นอกเวลาเฉพาะ service ที่ต้องการจริง ๆ
- **Shared infrastructure และความเชี่ยวชาญเชิงลึก** Kubernetes cluster, network และ database เป็นของ platform team และทีมผู้เชี่ยวชาญที่สร้างมัน และทีมเหล่านั้นก็ดูแลสิ่งที่ตัวเองสร้างเหมือนกัน ส่วน product team ใช้ของพวกนี้เป็น service
- **ระบบ legacy** ถ้า service ไม่มี telemetry ไม่มี test และไม่มี rollback เจ้าของใหม่ก็จะได้ page ที่ทำอะไรกับมันไม่ได้ ให้ทำให้มัน operable ก่อน: มี metric มี runbook มี deployment pipeline
- **สภาพแวดล้อมที่อยู่ใต้ regulation** กฎ separation of duties ต้องการให้ไม่มีใครคนเดียวที่เปลี่ยน production ได้โดยไม่มีการตรวจ แล้วการเปลี่ยนแปลงที่ผ่าน review และ approve ใน pipeline ที่มี audit พร้อม access control บน production ก็ตอบโจทย์นี้ได้โดยไม่ต้องส่งงานต่อให้อีกทีม ให้ตกลงเรื่อง control กับ auditor ตั้งแต่เนิ่น ๆ
- **Service ที่ใหญ่และสำคัญมาก** ทีม SRE โดยเฉพาะแบบที่ Google มีอาจคุ้มค่า เมื่อ service ใหญ่พอจะคุ้มกับการมีทีมแบบนี้ โดย developer ยังอยู่ใน escalation path

## กับดักที่เจอบ่อย

- **On-call โดยไม่มีคนช่วย** การ page หาคนที่ไม่มีเวลาแก้ต้นเหตุและไม่มีคนสำรอง เปลี่ยนความเป็นเจ้าของให้กลายเป็น burnout ให้จำกัดภาระ (ไม่เกินสอง incident ต่อ shift 12 ชั่วโมง) จ่ายค่าตอบแทน มี secondary ไว้ และกันเวลาใน sprint ไว้แก้ปัญหา
- **Alert ที่ noisy** การ alert ทุกครั้งที่ CPU พุ่งสอนให้คนเมิน pager ทางที่ดีคือ page เฉพาะอาการที่คุกคาม SLO แล้วส่งที่เหลือไปเป็น ticket หรือขึ้น dashboard และลบ alert ที่ไม่เคยนำไปสู่การลงมือทำอะไรเลย
- **Pager ที่ไม่มีกุญแจ** ความเป็นเจ้าของที่ไม่มีสิทธิ์เข้า production หรือไม่มีอำนาจแก้ ก็คือการแบ่งงานแบบเดิมที่แค่เปลี่ยนชื่อ ให้ทีมมีสิทธิ์ deploy และ rollback ผ่าน pipeline มีสิทธิ์อ่าน telemetry ของ production มีเส้นทางฉุกเฉินที่มี audit และมีสิทธิ์ตัดสินใจเรื่อง backlog ของตัวเอง
- **เล็กเกินกว่าจะผลัดกัน** ทีม 3 คนต้องอยู่ on-call ทุก ๆ สามสัปดาห์ และทุกครั้งที่มีคนลาหยุดก็เหลือสองคนแบ่ง pager กัน ให้รวม rotation กับทีมที่เกี่ยวข้อง หรือจำกัดการ page นอกเวลาไว้แค่เรื่องที่รอไม่ได้จริง ๆ
- **เงียบเกินจนไม่คม** ทีมที่แทบไม่เคยโดน page จะลืมว่า production ทำงานยังไง หนังสือ SRE แนะนำให้ทุกคนอยู่ on-call อย่างน้อยไตรมาสละหนึ่งถึงสองครั้ง บวกกับ incident ซ้อม
- **ทุกอย่างเป็นงานของ product team** การบังคับให้ทุกทีมดูแล cluster, network และ database ของตัวเองทำให้ทีมรับภาระหนักเกินไป ส่วน shared infrastructure และความเชี่ยวชาญเชิงลึกยังอยู่กับ platform team และทีมผู้เชี่ยวชาญที่ให้บริการพวกนี้เป็น service
- **การส่งต่องานที่แต่งตัวเป็น compliance** การทำ separation of duties ด้วยการส่งทุก release ให้อีกทีม ก็คือเอากำแพงกลับมา ให้ใส่ control ไว้ใน pipeline แทน: approver คนที่สอง audit log และ access แบบ least-privilege
- **กำแพงที่เปลี่ยนชื่อใหม่** "DevOps team" ที่แยกออกมาต่างหาก คอย deploy service ของทีมอื่นทั้งหมดและโดน page แทน ก็คือ operations team ในขั้นแรกที่แค่ติดป้ายใหม่ ให้ย้าย pager ไปที่ทีมที่แก้โค้ด
