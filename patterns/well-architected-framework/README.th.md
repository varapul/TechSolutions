## ปัญหา

cloud workload คือผลรวมของการตัดสินใจเล็ก ๆ หลายร้อยเรื่อง: มีกี่ instance อยู่ใน zone ไหน ใครถือ credential อะไร อะไรถูก tag บ้าง และ on-call engineer ทำอะไรตอนตีสอง คนละคนตัดสินใจเรื่องพวกนี้คนละเวลา ส่วนใหญ่ก็ทำภายใต้ deadline และไม่มีใครเช็กมันเทียบกับ list เดียวกัน ช่องโหว่เลยมองไม่เห็นจนกว่ามันจะสร้างความเสียหาย database ของ checkout ของ Acme Shop รันเป็น instance เดียว ทำให้พอ Availability Zone หนึ่งมีปัญหาในเดือนพฤศจิกายน checkout ก็ล่มไป 52 นาทีระหว่างที่มีคนสร้าง instance ใหม่ด้วยมือ ในเดือนธันวาคม audit เจอ access key ของ administrator คนหนึ่งที่ใช้ได้มาสามปีแล้ว และบิลเดือนมกราคมก็ขึ้นไป 18% โดยที่ node ของ cluster 40% ว่างอยู่ทุกคืน

ใครโดนเรื่องไหนก็จัดการเรื่องนั้นไป ทีม database เขียน rebuild script, IT security rotate key (และเลยออก key อายุยาวตัวใหม่มาอีกตัว) และฝ่าย finance ก็ขอให้ทุกทีมลดค่าใช้จ่ายลง 10% ตัว fix ทุกตัวเป็นเรื่องเฉพาะจุด เลยไม่มีใครถามคำถามถัดไป: ใน workload นี้ยังมีอะไรอีกที่หน้าตาแบบนั้น ถ้าไม่มีไม้บรรทัดที่ใช้ร่วมกัน ทีมก็บอกไม่ได้ว่า workload พร้อมแค่ไหน เทียบกับปีที่แล้วหรือกับทีมข้าง ๆ ไม่ได้ และบอกไม่ได้ว่าในห้าสิบ improvement ที่เป็นไปได้ ข้อไหนสำคัญที่สุด ส่วน review ที่มีอยู่ก็ขึ้นอยู่กับว่าใครอยู่ในห้องและบังเอิญรู้อะไร

## ทำงานยังไง

**AWS Well-Architected Framework** คือคำตอบที่ AWS เขียนไว้สำหรับปัญหานี้: design principle, คำถาม และ best practice สำหรับประเมิน workload ที่กลั่นมาจากสิ่งที่ AWS solutions architect เห็นใน review กับลูกค้าจำนวนมาก AWS เผยแพร่มันครั้งแรกเป็น whitepaper ในเดือนตุลาคม 2015 แล้ว operational excellence ก็เข้ามาร่วมกับ pillar ชุดแรกในเดือนพฤศจิกายน 2016 และย้ายขึ้นมาอยู่หน้าสุดในอีกหนึ่งปีต่อมา ส่วน **AWS Well-Architected Tool** ที่ใช้ฟรีก็มาถึงในงาน re:Invent เดือนพฤศจิกายน 2018 เพื่อให้รัน review ได้ใน AWS console และ sustainability pillar ก็ประกาศในงาน re:Invent เดือนธันวาคม 2021 ส่วน version ที่ใช้อยู่ ณ ตุลาคม 2026 ลงวันที่ 6 พฤศจิกายน 2024 และ document history ของ framework ก็ list ทุกการอัปเดตไว้ AWS อธิบายว่า review คือการคุยกันอย่างสร้างสรรค์เรื่องการตัดสินใจด้าน architecture ไม่ใช่ audit และอธิบาย framework ว่าเป็นวิธีมองข้อดีข้อเสียของการตัดสินใจเหล่านั้น

### หก pillar

แต่ละ pillar มี whitepaper, design principle และคำถามของตัวเอง สรุปสั้น ๆ (ถอดความ ส่วนจำนวนคำถามมาจาก version พฤศจิกายน 2024 ที่มีทั้งหมด 57 ข้อ):

| Pillar | ครอบคลุมอะไร | design principle บางข้อ | คำถาม | คำถามของ Acme ในแผนภาพ |
|---|---|---|---|---|
| Operational excellence | รัน workload ให้ดี เห็นว่ามันทำงานยังไง และปรับปรุงวิธีรันมัน | จัดทีมตาม business outcome; ใส่ observability ไว้ตั้งแต่แรก; automate ในจุดที่ปลอดภัย; ทำ change เล็ก ๆ บ่อย ๆ ที่ย้อนกลับได้; คาดไว้ว่าจะมี failure และเรียนรู้จากทุก operational event | 11 | OPS 7 คือทีมพร้อม support workload หรือยัง: ไม่มี runbook |
| Security | ปกป้อง data, ระบบ และ asset | identity foundation ที่แข็งแรง ใช้ least privilege และไม่มี credential อายุยาว; traceability; security ทุก layer แบบ automate; ปกป้อง data ทั้งตอน in transit และตอน at rest; กันคนให้ห่างจาก data; เตรียมพร้อมรับ security event | 11 | SEC 2 คือคนและ machine authenticate ยังไง: access key อายุสามปี |
| Reliability | ทำงานที่ตั้งใจไว้ได้ถูกต้องและสม่ำเสมอตลอด lifecycle | recover จาก failure โดยอัตโนมัติ; test ขั้นตอนการ recover; scale แนวนอนเพื่อให้ failure จุดเดียวมีผลน้อยลง; เลิกเดา capacity; เปลี่ยนแปลงผ่าน automation | 13 | REL 10 คือ fault isolation: database instance เดียวใน zone เดียว |
| Performance efficiency | ใช้ resource อย่างมีประสิทธิภาพเมื่อ demand และเทคโนโลยีเปลี่ยนไป | ใช้เทคโนโลยีขั้นสูงในแบบ service; ขยายไปทั่วโลกได้ในไม่กี่นาที; ใช้ serverless architecture; ทดลองบ่อย ๆ; เลือกเทคโนโลยีที่เข้ากับวิธีที่ workload ใช้มัน (*mechanical sympathy*) | 5 | PERF 1 คือเลือก resource ยังไง: ด้วยการเดา ไม่เคย benchmark |
| Cost optimization | ได้ business value ที่ workload มีไว้เพื่อสร้าง โดยใช้เงินให้น้อยที่สุด | สร้าง cloud financial management ให้เป็น capability; จ่ายแค่สิ่งที่ใช้; วัด output ต่อหน่วยต้นทุน; เลิกจ่ายเงินให้งานที่ไม่สร้างความแตกต่าง; ผูกค่าใช้จ่ายกับเจ้าของ workload | 11 | COST 3 คือ monitor cost และ usage ยังไง: ไม่มี cost allocation tag |
| Sustainability | ลดผลกระทบต่อสิ่งแวดล้อมจากการรัน workload | เข้าใจผลกระทบของตัวเอง; ตั้งเป้า; ใช้ utilization ให้เต็มที่; หันไปใช้ hardware และ software ที่มีประสิทธิภาพกว่า; ใช้ managed service; ลดผลกระทบต่ออุปกรณ์ของลูกค้าและระบบ downstream | 6 | SUS 5 คือเลือก hardware ยังไง: node ที่ CPU เฉลี่ย 18% |

framework ยังเพิ่มหลักการทั่วไปสำหรับการออกแบบบน cloud แบบไหนก็ได้: เลิกเดา capacity, test ที่ production scale, automate ให้การทดลองมีต้นทุนต่ำ, ปล่อยให้ architecture วิวัฒน์ไปได้, ตัดสินใจด้วย data และซ้อม failure ใน game day

### Review ให้อะไรออกมา

แต่ละคำถามมี list ของ best practice ที่ตอบคำถามนั้น รวมราว 300 ข้อทั่วทั้งหก pillar และแต่ละข้อมี ID อย่าง `REL10-BP01` (deploy workload ไปหลาย location) ทุก best practice ระบุ **ระดับความเสี่ยง** ที่ทีมต้องแบกถ้าไม่มีมัน: high, medium หรือ low ตัว Tool เปลี่ยน practice ที่ทีมเลือกให้เป็นระดับความเสี่ยงหนึ่งระดับต่อคำถาม ผ่าน rule ที่ผูกกับคำถามนั้น: พูดกว้าง ๆ คำถามที่ขาด foundational practice จะกลายเป็น **high risk** คำถามที่ขาด enabling practice เป็น **medium risk** ส่วนคำถามที่ไม่ขาดทั้งสองแบบก็ไม่มีความเสี่ยง AWS อธิบาย high risk issue (HRI) ว่าเป็นทางเลือกที่อาจสร้างความเสียหายร้ายแรงให้ธุรกิจ และ medium risk issue (MRI) ว่าเป็นทางเลือกที่เสียหายน้อยกว่า ระดับพวกนี้ต่างกันไปในแต่ละ pillar: การไม่มี load test เป็น low risk ใน performance efficiency pillar (`PERF05-BP04`) ขณะที่การไม่ test requirement ด้าน scalability และ performance เป็น high risk ใน reliability (`REL12-BP03`) ส่วน best practice ที่ไม่เกี่ยวกับ workload ก็ mark ว่า not applicable ได้ ผลลัพธ์ไม่ใช่คะแนน แต่เป็น list: คำถามไหนมีความเสี่ยง และเพราะอะไร

### Review รันยังไง

แนวทางของ AWS คือ review ควรเบา (เป็นชั่วโมง ไม่ใช่เป็นวัน) ไม่โทษกัน และทำโดยคนที่ build และรัน workload นั้นเอง ถ้าให้ดีก็ทำต่อเนื่อง: ทีมอัปเดตคำตอบไปตามที่ architecture เปลี่ยน แทนที่จะจัดประชุมทางการครั้งเดียว จังหวะที่สำคัญคือช่วงต้นของการออกแบบ ก่อนการตัดสินใจที่ย้อนกลับยาก (AWS เรียกมันว่า *one-way doors*) ก่อน go-live และหลัง change ที่สำคัญทุกครั้ง สำหรับ review ครั้งเดียวหรือ review แบบอิสระ AWS แนะนำให้คุยแบบไม่เป็นทางการสักสองสามรอบเพื่อเก็บคำตอบส่วนใหญ่ แล้วตามด้วยประชุมหนึ่งหรือสองครั้งในเรื่องที่ยังไม่ชัดหรือเสี่ยง โดยมีคนที่ใช่อยู่ในห้อง ส่วน AWS solutions architect และสมาชิกของ AWS Well-Architected Partner Program ก็รัน review ร่วมกับลูกค้า

user guide ของ Tool มี section ใหม่เรื่องการรัน Well-Architected Framework Review (WAFR) ในเดือนตุลาคม 2025 คำแนะนำของมันแบบถอดความคือ: ตกลงกันล่วงหน้าว่าใครนำ ใคร share หน้าจอ ใครจดโน้ต pillar ไหนมาก่อนมาหลัง และแต่ละ pillar ได้เวลาเท่าไร; ตอนเริ่มให้ย้ำอีกครั้งว่าไม่มีใครถูกตัดสิน; จดโน้ตพร้อมบริบท เพราะ checkbox ที่ติ๊กไว้แทบไม่มีความหมายกับคนที่เปิด review ใน milestone ถัดไป; เก็บข้อเท็จจริงเกี่ยวกับ workload แทนที่จะออกแบบ fix กันในห้อง; และคุยเรื่อง architecture ไม่ใช่เรื่อง tool

### จากความเสี่ยงสู่การปรับปรุง

Tool จะ list คำถามที่มี high risk และ medium risk ออกมาเป็น **improvement plan** โดยแต่ละข้อลิงก์ไปที่ best practice ที่จะกำจัดความเสี่ยงนั้น AWS แนะนำว่าอย่าจัดการทุกความเสี่ยงพร้อมกัน: ชั่งแต่ละ fix ระหว่างคุณค่าต่อธุรกิจกับแรงที่ต้องใช้ (เช่นบน chart แบบ Eisenhower) ตั้งเป้าที่เจาะจงและวัดได้ ให้มีเจ้าของคนเดียว เลือก solution ที่ง่ายและย้อนกลับได้ และป้อน item เข้า backlog และ retrospective ของทีม และสำหรับเฟสนี้ AWS แนะนำช่วงเวลา 90 ถึง 180 วัน ส่วน connector ที่เพิ่มมาในเดือนเมษายน 2024 ก็ sync improvement item ไปที่ Jira แล้ว **milestone** ก็ save สถานะของ review ณ จุดเวลาหนึ่ง ทีมเลย save หนึ่งตัวตอน review แรกเสร็จ แล้ว save อีกครั้งหลังปรับปรุง แล้วเอามาเทียบกัน

feature อื่น ๆ ช่วยตอนทำในสเกลใหญ่ **profile** บันทึกบริบทและเป้าหมายทางธุรกิจ เพื่อให้ Tool จัดลำดับคำถามและความเสี่ยงที่สำคัญที่สุดได้; **review template** เติมคำตอบที่เหมือนกันในหลาย workload ไว้ให้ก่อน (เช่น shared platform); Trusted Advisor check โผล่ข้างคำถามที่มันให้ข้อมูลได้; และ dashboard ก็แสดง high risk และ medium risk แยกตาม pillar ทั่วทุก workload

### Lens

**lens** เพิ่มคำถาม, best practice และ improvement plan ของตัวเองเข้าไปใน review ตัว Well-Architected Framework lens ใช้กับทุก workload ส่วน Lens Catalog ใน Tool มี AWS lens เหล่านี้ให้ ณ ตุลาคม 2026: Connected Mobility, Container Build, Data Analytics, DevOps, Financial Services Industry, Generative AI, Government, Healthcare Industry, IoT, Machine Learning, Mergers and Acquisitions, Migration, SaaS, SAP และ Serverless Applications องค์กรเขียน **custom lens** เป็น JSON เองได้ด้วย โดยมี pillar, คำถาม, best practice และ risk rule ของตัวเอง แล้ว share ระหว่าง account ได้ ส่วน Acme review checkout ด้วย lens ของ Framework และ Container Build และ platform team ของ Acme ก็มี custom lens สำหรับ standard ของตัวเอง

ในวันที่ 1 ตุลาคม 2026 ทาง AWS เพิ่ม **AWS Well-Architected Agent** แบบ preview มันวิเคราะห์ AWS environment ทุกสัปดาห์ จัดอันดับ recommendation ด้าน cost, security, performance และ resilience เทียบกับเป้าที่ทีมตั้งไว้ แสดง trade-off ของแต่ละ recommendation, generate remediation runbook และตรวจ template ของ CloudFormation และ Terraform ให้เมื่อสั่ง มันต้องใช้ support plan แบบ Business+, Enterprise On-Ramp, Enterprise หรือ Unified Operations มันทำงานจาก resource, template และเป้าที่ได้รับมา และมองไม่เห็นว่าทีม operate ตัดสินใจ และรับมือกับเหตุการณ์ยังไง เพราะฉะนั้นให้ถือว่าสิ่งที่มันเจอเป็น input ของ review ไม่ใช่ตัว review เอง

### Trade-off ระหว่าง pillar

pillar ต่าง ๆ ดึงกันไปคนละทาง และ framework ไม่ได้ตัดสินความขัดแย้งให้: business context เป็นตัวตัดสิน ตัวอย่างของ AWS เองคือ development environment ที่ยอมเสีย reliability บางส่วนเพื่อประหยัด cost และ carbon, workload แบบ mission-critical ที่ยอมจ่ายมากขึ้นเพื่อ reliability และ e-commerce ที่ performance มีผลต่อรายได้ AWS ยังบอกด้วยว่า security กับ operational excellence โดยทั่วไปจะไม่ถูกเอาไปแลกกับ pillar อื่น ในทางปฏิบัติ:

- **Reliability กับ cost และ sustainability** ตัว fix ของ Acme สำหรับ REL 10 คือ Aurora reader ใน zone ที่สอง ถ้ามี reader ตัว Aurora จะ fail over ด้วยการ promote reader ขึ้นมา ปกติภายใน 60 วินาทีและบ่อยครั้งภายใน 30 วินาที ถ้าไม่มี มันจะสร้าง instance ใหม่ ปกติใช้เวลาไม่ถึง 10 นาที และหลัง outage ที่ทั้ง zone ล่ม ก็ต้องมีคนสร้าง instance ใน zone อื่นด้วยมือ ตัว reader คือ `db.r7g.large` ตัวที่สอง: $0.276 ต่อชั่วโมงสำหรับ Aurora [PostgreSQL](../postgresql/) ใน us-east-1 (on-demand, ตุลาคม 2026) ราว $201 ต่อเดือน บวกกับ instance อีกตัวที่เปิดทั้งวัน ทีมยอมรับข้อนี้สำหรับ checkout ใน production และให้ staging ใช้ instance เดียวต่อไป เพราะที่นั่น restore จาก backup ก็เร็วพอ
- **Performance กับ cost** การมี capacity สำรองไว้สำหรับช่วง sale ทำให้ checkout เร็ว แต่ต้องจ่ายทุกชั่วโมงที่มันว่าง ส่วน autoscaling กับ load test ก่อน sale แต่ละครั้งให้ความปลอดภัยแบบเดียวกันในราคาที่ถูกกว่า แลกกับงาน engineering
- **Security กับความสะดวก** การ sign in ผ่าน IAM Identity Center พร้อม MFA และ role session หนึ่งชั่วโมง (เป็นค่า default ของ permission set และตั้งได้ถึง 12 ชั่วโมง) เพิ่มอีกขั้นให้ทุกวันของ administrator ทุกคน นั่นคือต้นทุนของการทำ security ไม่ใช่เหตุผลที่จะเอามันไปแลก ขั้นนี้เลยยังอยู่
- **Cost กับ sustainability มักไปทางเดียวกัน** การ scale in node ตอนกลางคืนและ right-size มันช่วยลดทั้งบิลและ hardware ไปพร้อมกัน นี่คือเหตุผลที่ fix เรื่อง autoscaling ของ Acme โผล่ในทั้งสอง pillar

framework ของ Microsoft อธิบายความตึงพวกนี้ไว้ทีละ pillar เช่นหน้า trade-off ของ reliability บอกว่า redundancy ที่เพิ่มขึ้นก็ขยาย attack surface ที่ security pillar อยากให้เล็กด้วย ไม่ว่าจะตัดสินใจยังไง ให้เขียนไว้ในที่ที่ reviewer คนถัดไปจะหาเจอ: ในโน้ตของ review และถ้าเป็นทางเลือกที่ใช้ยาว ๆ ก็ใน architecture decision record แบบที่ Acme ทำกับ ADR-031 แล้วความเสี่ยงที่ยอมรับอย่างตั้งใจ พร้อมเหตุผลและวันที่จะกลับมาดูอีกครั้ง ก็คือการตัดสินใจ ส่วนความเสี่ยงที่ไม่มีใครดูคือเรื่องไม่คาดฝันที่รอวันเกิด

### Azure และ Google Cloud

cloud รายใหญ่อื่น ๆ ก็ publish framework ที่ชื่อและรูปแบบเดียวกัน (ณ ตุลาคม 2026):

| | AWS Well-Architected Framework | Azure Well-Architected Framework | Google Cloud Well-Architected Framework |
|---|---|---|---|
| Pillar | 6: operational excellence, security, reliability, performance efficiency, cost optimization, sustainability | 5: reliability, security, cost optimization, operational excellence, performance efficiency | 6: operational excellence; security, privacy, and compliance; reliability; cost optimization; performance optimization; sustainability |
| Sustainability | เป็น pillar ตั้งแต่ธันวาคม 2021 | เป็น workload guidance ไม่ใช่ pillar | เป็น pillar เต็มตัวตั้งแต่มกราคม 2026 |
| สิ่งที่ช่วยทำ review | Well-Architected Tool (ฟรี): คำถาม, high risk และ medium risk, improvement plan, milestone | Azure Well-Architected Review (ฟรี): แบบสอบถามที่ผูกกับ checklist ของแต่ละ pillar และให้คะแนนเทียบกันข้ามแต่ละรอบ | recommendation ต่อ pillar ใน documentation |
| นอกเหนือจาก pillar | lens, custom lens, review template, Well-Architected Agent (preview) | design review checklist, หน้า trade-off และ maturity model ต่อ pillar, workload guidance (AI, SaaS, mission-critical, HPC, Microsoft Fabric), service guide | core principle (design for change, document the architecture, simplify, decouple, stay stateless), cross-pillar perspective สำหรับ AI และ ML และสำหรับ financial services, deployment archetype |

framework ของ Google เคยชื่อ Google Cloud Architecture Framework ก่อนจะเปลี่ยนมาใช้ชื่อ Well-Architected ทั้งสามตัวครอบคลุมเรื่องเดียวกันแต่เน้นต่างกัน: Google รวม privacy และ compliance ไว้ใน security pillar และ Microsoft ให้คะแนน review ในขณะที่ AWS นับความเสี่ยง

### บน cloud ไหนก็ได้

คำถามส่วนใหญ่เป็นกลางไม่ผูกกับ provider แม้ best practice จะเอ่ยชื่อ AWS service: fault ถูก isolate ยังไง คนและ machine authenticate ยังไง cost ถูกผูกกับใครยังไง ทีมรู้ได้ยังไงว่าพร้อม operate workload แล้ว ทีมที่อยู่บน cloud อื่น บน on premises หรือข้ามหลายที่ ใช้มันเป็น checklist แบบมีโครงสร้างได้ ให้เก็บหก pillar ไว้ แปล practice ให้เข้ากับที่ตัวเองใช้ (Availability Zone กลายเป็น failure domain อิสระแบบไหนก็ได้ที่ platform มีให้, IAM Identity Center กลายเป็น identity provider ของบริษัทที่ออก credential อายุสั้น) ให้ระดับแต่ละคำถามเป็น high, medium หรือไม่มีความเสี่ยง และเก็บ improvement list ที่มีวันที่กับ milestone ไว้ใน spreadsheet หรือ issue tracker ส่วนทีมที่รันส่วนใหญ่อยู่บน provider เดียว มักจะได้ประโยชน์กว่าจาก framework ของ provider นั้น เพราะ practice ของมันเอ่ยชื่อ service ที่ทีมใช้จริง

## ลงมือทำจริงยังไง

1. **เลือก workload มาหนึ่งตัวกับคนที่รันมัน** workload คือชุดของ component ที่รวมกันส่ง business value เช่น checkout ตั้งแต่ load balancer ไปจนถึง database รวมถึง pipeline และ on-call ของมัน เชิญทีมที่ build และรันมัน, platform team ที่เป็นเจ้าของส่วนที่ใช้ร่วมกัน และ facilitator ที่รู้จัก framework ดี (Acme ขอให้ AWS solutions architect ของตัวเองมาช่วย)
2. **เตรียมตัว** รวบรวม architecture diagram, dashboard, incident ไม่กี่ครั้งล่าสุด และบิลแยกตาม service แล้ว define workload ใน Tool, ใช้ lens ที่เหมาะ และถ้าองค์กรมี ก็ใช้ profile กับ review template ด้วย ส่งคำถามไปให้ล่วงหน้า เพื่อให้คำตอบที่ต้องไปค้นมาก่อน (*backup encrypt ไว้หรือเปล่า?*) ถูกหาเจอก่อนประชุม
3. **รัน review เป็น session** ฝั่ง Acme ใช้สองครึ่งวัน คือ 10 และ 11 มีนาคม 2026 ไล่ทีละ pillar ให้ตอบตามจริง mark ข้อที่ไม่เกี่ยว เขียนโน้ตพร้อมเหตุผล และพักไอเดียเรื่อง fix ไว้ทีหลัง
4. **อ่านความเสี่ยง** checkout ออกมาด้วย high risk 7 ข้อและ medium risk 12 ข้อ จากคำถาม 57 ข้อ
5. **วางแผน** เริ่มจาก high risk ที่แก้ได้ถูก ๆ ให้แต่ละ item มีเจ้าของและเดือนที่ต้องเสร็จ ย้าย item เข้า backlog ของทีม (Acme sync มันไปที่ Jira) และ review ความคืบหน้าใน retrospective
6. **Save milestone และ review ซ้ำ** save หนึ่งตัวหลัง review และหลัง fix แต่ละชุด แล้ว review ใหม่หลัง change ใหญ่ และอย่างน้อยปีละครั้งสำหรับ workload ที่สำคัญ ส่วน review ครั้งถัดไปของ Acme คือมีนาคม 2027
7. **เปลี่ยนคำตอบที่ซ้ำ ๆ ให้เป็นกลไก** เมื่อช่องโหว่เดิมโผล่ใน workload แล้ว workload เล่า ให้แก้มันครั้งเดียวใน platform: tag policy, account structure, pipeline step หรือ golden path เพื่อให้คำตอบถูกต้องโดย default ทาง AWS เองก็อธิบายวิธีของตัวเองแบบเดียวกัน: ทุกทีมเป็นเจ้าของ architecture ของตัวเอง และผู้เชี่ยวชาญกับ automated check คอยรักษามาตรฐาน

high risk ของ Acme ตั้งแต่ review แรกจนถึง milestone วันที่ 15 กันยายน 2026 (เป็นเรื่องของตัวอย่างนี้เอง):

| คำถาม | สิ่งที่เจอในเดือนมีนาคม | การปรับปรุง | เจ้าของ | ณ milestone |
|---|---|---|---|---|
| SEC 2 · authentication | IAM access key ของ administrator อายุสามปี อยู่บน laptop | IAM Identity Center พร้อม MFA และ role session หนึ่งชั่วโมง; ลบ access key ทิ้ง | platform team | เสร็จในเดือนเมษายน |
| REL 10 · fault isolation | Aurora instance ตัวเดียว อยู่แค่ใน AZ a | Aurora reader ใน AZ b อยู่ลำดับแรกของ promotion order (tier 0) | ทีม checkout | เสร็จในเดือนพฤษภาคม |
| REL 13 · disaster recovery | ไม่มี recovery time objective หรือ recovery point objective | objective ที่ตกลงกับฝั่งธุรกิจ และตรวจด้วย restore drill | SRE group | เสร็จในเดือนมิถุนายน |
| REL 12 · testing reliability | ไม่เคย load test | load test ที่สามเท่าของ peak ครั้งล่าสุด ก่อน sale ทุกครั้ง | ทีม checkout | เสร็จในเดือนกรกฎาคม |
| PERF 2 · compute | จำนวน node คงที่ ตั้งขนาดไว้สำหรับ peak | node autoscaling สำหรับ checkout node group | platform team | เสร็จในเดือนสิงหาคม |
| COST 1 · cloud financial management | ไม่มีใครเป็นเจ้าของ cost ของ checkout | มี cost owner ที่ระบุตัวชัด และ cost review รายเดือน | ทีม checkout | ยังเปิดอยู่ |
| SEC 1 · operating securely | production กับ staging อยู่ใน AWS account เดียว | หนึ่ง account ต่อ environment | platform team | วางแผนไว้ Q1 2027 |

จาก medium risk 12 ข้อ มี 7 ข้อที่แก้เสร็จก่อน milestone รวมถึง runbook สำหรับ Aurora failover ที่ซ้อมใน game day (OPS 7), cost allocation tag พร้อม split cost allocation data สำหรับ EKS cluster ที่ใช้ร่วมกัน (COST 3) และ benchmark ใน pipeline (PERF 1) ส่วนการ right-size node (SUS 5) ยังทำอยู่ ตัวเลข high risk ลดจาก 7 เหลือ 2 และ medium risk จาก 12 เหลือ 5

## อยู่ตรงไหนใน solution

- **[Disaster recovery strategies](../disaster-recovery-strategies/)** และ **[multi-region active-active](../multi-region-active-active/)** ตอบ REL 13 และครึ่งที่ยากกว่าของ REL 10: ทำยังไงเมื่อทั้ง Region ล่ม ไม่ใช่แค่ zone และธุรกิจยอมรับ recovery time กับ data loss ได้แค่ไหน
- **[Amazon RDS & Aurora](../amazon-rds-aurora/)** อธิบายกลไกเบื้องหลัง fix หลักของ Acme: reader ใน zone อื่นที่เป็นเป้าหมายของ failover และ cluster volume ที่เก็บ data หก copy กระจายอยู่ในสาม zone
- **[Autoscaling](../autoscaling/)** คือวิธีที่ PERF 2 และคำแนะนำของ sustainability pillar เรื่องจับคู่ resource ให้พอดีกับ demand กลายเป็นของจริง และเป็นเหตุผลที่ node ที่ว่างตอนกลางคืนหายไป
- **[AWS IAM](../aws-iam/)** และ **[zero trust access](../zero-trust-access/)** คือสิ่งที่ SEC 2 และ SEC 3 ถามถึง: identity จาก identity provider, temporary credential และ least privilege ที่ตรวจทุก request
- **[SLOs and error budgets](../slo-error-budgets/)** ให้เป้าที่ reliability pillar ใช้ออกแบบ และ **[Amazon CloudWatch](../amazon-cloudwatch/)** ก็ให้ observability ที่คำถามของ operational excellence และ reliability ถือว่ามีอยู่แล้ว
- **[Chaos engineering](../chaos-engineering/)** คือคำแนะนำของ reliability pillar ที่ให้ test การ recover และจัด game day ส่วน **[incident management](../incident-management/)** และ **[blameless postmortems](../blameless-postmortems/)** คือวิธีที่ operational excellence เรียนรู้จากทุกเหตุการณ์ ด้วยแนวคิดไม่โทษกันแบบเดียวกับที่ review ต้องการ
- **[Cell-based architecture](../cell-based-architecture/)** ไปไกลกว่าการกระจายข้าม zone อีกขั้น: bulkhead practice ของ framework (`REL10-BP03`) จำกัดว่า failure หนึ่งครั้งจะไปถึงลูกค้าได้กี่คน
- **[Infrastructure as code](../infrastructure-as-code/)** และ **[golden paths](../golden-paths/)** คือกลไกที่ทำให้คำตอบที่ดีเป็น default ของทุก workload ใหม่ ส่วน [Policy as code](../policy-as-code/) จะตรวจมันทุกครั้งที่มี change
- **[FinOps](../finops/)** คือ practice ด้าน cost แบบลงลึก: การแบ่งค่าใช้จ่ายไปให้ทีมที่ก่อมัน การติดตาม cost ต่อหน่วยของ value และนิสัยขององค์กรที่ใส่ใจ cost ตัว cost pillar ถามว่านิสัยพวกนี้มีอยู่หรือเปล่า ส่วน FinOps คือวิธีสร้างมันขึ้นมา
- **[DORA metrics](../dora-metrics/)** วัด software delivery โดย framework ครอบคลุมเรื่องนี้หลัก ๆ ในคำถามสองข้อของ operational excellence (OPS 5 เรื่อง flow เข้า production และ OPS 6 เรื่องความเสี่ยงของ deployment) และใน DevOps lens ส่วน framework ของ Google ก็อ้างงานวิจัยของ DORA ไว้ใน core principle ของมัน

## ใช้ตอนไหนดี

- **Workload ที่อยู่ใน production หรือกำลังจะ launch บน AWS** คำถามจะเจอ single point of failure, credential อายุยาว และ cost ที่ไม่มีเจ้าของ ที่ทีมเลิกมองเห็นไปแล้ว และ improvement plan ก็เรียงลำดับ fix ให้ ส่วนช่วงก่อน launch ใหญ่หรือก่อน peak season คือตอนที่ review คุ้มที่สุด
- **ช่วงต้นของการออกแบบ** การเลือก database, account structure หรือ Region strategy ย้อนกลับยาก การถามคำถามที่เกี่ยวข้องก่อน build เลยถูกกว่าไปเจอคำตอบใน production
- **หลาย workload บน platform เดียว** dashboard, profile, review template และ custom lens เปลี่ยน review แต่ละตัวให้กลายเป็นภาพรวมทั้ง portfolio และ finding ที่เจอซ้ำ ๆ ก็บอก platform team ว่าควรแก้อะไรครั้งเดียวให้ทุกคน
- **ภาษากลาง** ชื่อ pillar, question ID และคำศัพท์ high/medium ทำให้ทีมต่าง ๆ, auditor, AWS และ partner ใช้คำเดียวกันกับความเสี่ยงเดียวกัน
- **เบาลงสำหรับระบบเล็กหรือระบบที่อยู่ไม่นาน** prototype หรือ internal tool ที่มีคนใช้ห้าคนไม่ต้องใช้สองครึ่งวัน: เลือกคำถามด้าน security และ data แล้วค่อยกลับมาดูถ้ามันโตขึ้น
- **ไม่ใช่ compliance framework** ตัว review บันทึกความเสี่ยงเทียบกับ best practice ของ AWS มันไม่ใช่ทั้ง audit และ certification เลยไม่ได้แทนที่ control และหลักฐานของ standard อย่าง SOC 2, ISO 27001 หรือ PCI DSS ถึงแม้ finding หลายข้อจะทับซ้อนกับมันก็ตาม ทีมที่อยู่ใต้ regulation จะ map สองอย่างนี้เข้าหากันและเก็บไว้ทั้งคู่
- **ไม่ใช่ design method** ตัว framework ถามว่า workload isolate fault หรือเปล่า แต่มันไม่ได้เลือก pattern ให้ workload ไม่ได้ทำ threat model และไม่ได้ size database ให้ เรื่องพวกนั้นยังเป็นงานออกแบบ ที่มีคำถามของ review คอยให้ข้อมูล
- **Cloud อื่นและ legacy system** ถ้าอยู่นอก AWS ให้ใช้ framework ของ provider นั้นเอง หรือใช้คำถามเป็น checklist กลาง ๆ แบบข้างบน สำหรับ legacy system ที่เปลี่ยนอะไรได้ไม่มาก ผลลัพธ์ที่ตรงไปตรงมาอาจเป็นความเสี่ยงที่ยอมรับไว้พร้อม mitigation และแบบนั้นก็ยังดีกว่าความเสี่ยงที่ไม่มีใครเขียนไว้

## กับดักที่เจอบ่อย

- **Review ครั้งเดียวแล้วไม่ตามต่อ** คำตอบจะเก่าภายในไม่กี่เดือน และ improvement plan ก็กลายเป็นเอกสารที่ไม่มีใครเปิด ให้ทุก item มีเจ้าของและวันที่ ใส่ item ไว้ใน backlog, save milestone และ review ใหม่หลัง change ใหญ่หรือทุกปี
- **มองทุก finding ว่าต้องทำ** ไม่ใช่ทุก best practice จะคุ้มกับต้นทุนสำหรับทุก workload และ AWS เองก็แนะนำว่าอย่าแก้ทุกอย่างพร้อมกัน ให้จัดลำดับตาม business impact และแรงที่ต้องใช้ mark ข้อที่ไม่เกี่ยว และยอมรับความเสี่ยงที่เหลืออย่างตั้งใจ โดยเขียนเหตุผลไว้
- **Review ช้าเกินไป** review หนึ่งสัปดาห์หลัง launch ทำได้แค่ list สิ่งที่เสียดาย ให้จัดครั้งแรกตอนออกแบบ ระหว่างที่ทางเลือกที่ย้อนกลับยากยังเปิดอยู่ แล้วจัดอีกครั้งก่อน go-live
- **Review คนเดียว** architect ที่กรอก Tool จากเอกสารจะตอบว่าระบบควรทำอะไร ไม่ใช่ว่ามันทำอะไรจริง คนที่ build, deploy และโดน page เพราะ workload นั้นรู้ว่า runbook ขาดตรงไหน ให้เชิญพวกเขามา และทำให้ไม่มีการโทษกัน พวกเขาจะได้กล้าพูด
- **ติ๊ก checkbox ไปเรื่อย ๆ** การเลือก best practice โดยไม่มีโน้ต หรือเลือกเพื่อให้ความเสี่ยงหายไป ได้ dashboard ที่สะอาดแต่ workload ไม่เปลี่ยนเลย ให้จดหลักฐานเบื้องหลังแต่ละคำตอบไว้ เพื่อให้ reviewer ใน milestone ถัดไปตรวจมันได้
- **ใช้จำนวนความเสี่ยงเป็นเป้า** การนับ high risk ต่อทีมแล้วจัดอันดับบน slide ชวนให้คนตอบแบบซ่อนความเสี่ยงแทนที่จะกำจัดมัน ให้เทียบ workload กับอดีตของตัวมันเอง และคุยกันที่ตัวความเสี่ยง
- **ลืม trade-off** การแก้ pillar หนึ่งอาจทำให้อีก pillar เสียไปเงียบ ๆ: reader ที่ทำให้ checkout fail over ได้เร็วก็มีค่าใช้จ่าย $201 ต่อเดือนและรันทั้งวัน ให้ดู pillar อื่นก่อนรับ fix มาใช้ และบันทึกการตัดสินใจไว้
- **มองคำตอบของ AWS ว่าใช้ได้ทุกที่** best practice เอ่ยชื่อ service และ feature ของ AWS ถ้าอยู่บน cloud อื่น หรือใช้ operating model ที่ต่างไป ก็ให้แปลเจตนาของแต่ละ practice แทนการ copy ถ้อยคำของมัน
