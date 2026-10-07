## ปัญหา

Acme Shop มี engineer ราว 60 คน แบ่งเป็น product team หกทีมที่แต่ละทีมเป็นเจ้าของส่วนหนึ่งของร้าน (checkout, catalog, search, payments, delivery และ mobile app) มี SRE group เล็ก ๆ ดูแล production และมี platform team ที่มี engineer หกคน ดูแลของที่ทุกคนใช้ร่วมกัน: Kubernetes cluster บน AWS, CI/CD pipeline และ observability stack ถ้าดูแค่บนกระดาษ product team ก็เป็นอิสระ แต่ในความเป็นจริง ทุกอย่างที่ต้องได้จาก platform เริ่มต้นด้วย ticket ไม่ว่าจะเป็น namespace, database, DNS record, pipeline หรือ secret ต่างก็ต้องรอในคิวของ platform team ที่ตอนนี้มี ticket เปิดค้างอยู่ 140 ใบ ค่า median ของเวลารอคือสองวันทำการสำหรับ namespace สามวันสำหรับ database หนึ่งวันสำหรับ DNS record สามวันสำหรับ pipeline และสองวันสำหรับ secret และ service ใหม่ต้องใช้สี่อย่างแรกต่อกันทีละอย่าง: 9 วันทำการกว่าจะได้ deploy ครั้งแรกบน staging (ตัวเลขของ Acme เป็นของตัวอย่างเอง ไม่ใช่ผลวิจัย)

ทีมต่าง ๆ ปรับตัวแบบที่คนมักปรับตัวกับด่านที่ช้า ทีม checkout deploy ด้วย script ของตัวเอง ทีม mobile app ก็มี script ของตัวเองไว้อ้อม platform และ pipeline ของแต่ละทีมก็ค่อย ๆ ห่างจากทีมอื่นไปเรื่อย ๆ ในระหว่างนั้น platform team ที่จมอยู่กับ ticket ก็ยังหาเวลาได้หนึ่งไตรมาสไปทำ project ที่ตัวเองเลือก: service mesh ที่ไม่มี product team ไหนขอและไม่มีใครใช้ แล้วยังมี cluster federation กับ custom autoscaler รอคิวถัดไปบน roadmap ตัว platform ไม่มี service level objective ของตัวเอง ไม่มีใครเคยถาม developer ว่าคิดยังไงกับมัน และทีมก็รายงานจำนวน ticket ที่ปิดกับ feature ที่ ship ส่วนสำหรับ product team แล้ว platform คือด่านกั้น ไม่ใช่ตัวช่วย

เรื่องพวกนี้ไม่ได้แปลกอะไร guide เรื่อง platform engineering ของ DORA ก็ยกความล้มเหลวแบบเดียวกันไว้ในกับดักที่เจอบ่อย: platform ที่สร้างจากการเดาโดยไม่มี user research ("build it and they will come") ทีมส่วนกลางที่สั่งมาตรฐานลงมาจนบีบให้ developer ต้องหาทางอ้อม ("ivory tower") และทีมที่ทำตัวเป็นตู้กดสำหรับ ticket ด้าน infrastructure ("ticket-ops")

## ทำงานยังไง

**Platform คือ product ภายใน** ใน *What I Talk About When I Talk About Platforms* (martinfowler.com, 2018) Evan Bottcher อธิบายว่า digital platform คือ self-service API, tool และ service รวมกับความรู้และ support รอบ ๆ มัน ที่มอบให้ทีมที่ส่งมอบซอฟต์แวร์ในรูป internal product เพื่อให้ทีมที่เป็นอิสระ ship feature ได้เร็วขึ้นและต้องประสานงานกันน้อยลง มีสองไอเดียที่แบกน้ำหนักส่วนใหญ่ไว้ ไอเดียแรกคือ self-service: Bottcher เรียกความล่าช้าจากการรอ backlog ของทีมอื่นว่า *backlog coupling* และ platform ที่ยังต้องเปิด ticket สำหรับงานประจำก็ยังไม่ได้ตัดมันออก ไอเดียที่สองคือทีมต้องอยากใช้มัน การบังคับอย่างเดียวไม่ทำให้มันสำเร็จ ทีมควรรู้สึกว่าใช้มันเหนื่อยน้อยกว่าสร้างและดูแลของตัวเอง และฝั่งคนก็เป็นส่วนหนึ่งของ product พอ ๆ กับโค้ด: documentation, คำแนะนำและ support, template และ guideline และคนที่คอยโปรโมตมัน เขายังเตือนด้วยว่าอย่าเอา virtual-machine hosting เดิมกับ tool ที่ควบคุมจากส่วนกลางมาเปลี่ยนชื่อเป็น "the platform"

**Platform ให้อะไรบ้าง** *CNCF Platforms White Paper* ที่เขียนโดย Platforms Working Group ของ TAG App Delivery ใน CNCF (version 1 เสร็จเดือนมีนาคม 2023 และมี revision หลังจากนั้นเผยแพร่ออนไลน์) นิยาม platform สำหรับ cloud-native computing ว่าเป็นชุด capability ที่ผสานเข้ากันและออกแบบตามสิ่งที่ผู้ใช้ต้องการ: เป็น layer ที่คร่อมหลาย application และให้วิธีเดียวที่สม่ำเสมอในการขอและประกอบ service ที่ใช้กันทั่วไป ตัว white paper ระบุ attribute ของ platform ที่ประสบความสำเร็จไว้เจ็ดข้อ: platform as a product, user experience, documentation และ onboarding, self-service, ลด cognitive load ของผู้ใช้, optional และ composable (ทีมใช้บางส่วนได้ และ run capability ของตัวเองได้เมื่อจำเป็น) และ secure by default รายการ capability ทั่วไปของมันมีสิบสามข้อ: web portal; API และ CLI; golden-path template และ documentation; build และ test automation; delivery และ verification automation; development environment; observability; infrastructure service; data service; messaging และ event service; identity และ secret management; security service; และ artifact storage ส่วนตัว white paper คาดว่า platform team จะเป็นเจ้าของ interface และ experience และพึ่ง managed service กับทีมภายในอื่น ๆ สำหรับ implementation ทุกที่ที่ทำได้ (TAG App Delivery ถูกปิดไปตอนที่ CNCF จัดโครงสร้าง technical advisory group ใหม่ในปี 2025 แต่ paper ของมันยังเผยแพร่อยู่บนเว็บไซต์)

**Internal developer platform กับ developer portal** ตัว platform คือทุกอย่างที่ product team ได้จากมัน: ทั้ง capability (cluster, pipeline, database, secret, observability) และช่องทางที่ใช้มัน developer portal เป็นหนึ่งในช่องทางเหล่านั้น Backstage เป็น open-source framework สำหรับสร้าง developer portal ที่ Spotify สร้างขึ้น (เป็น CNCF incubating project ตั้งแต่มีนาคม 2022) และเป็นตัวเลือกที่นิยม: **Software Catalog** ของมันบันทึกว่าใครเป็นเจ้าของ service ไหน **Software Templates** ของมันสร้าง component ใหม่ที่มีมาตรฐานขององค์กรติดมาในตัว และ **TechDocs** เผยแพร่ documentation ที่เขียนไว้ข้างโค้ด ตัว white paper ขอให้ platform ไปหาผู้ใช้ในที่ที่พวกเขาอยู่ ที่อาจเป็น portal สำหรับงานหนึ่ง และเป็น API, CLI หรือ IDE สำหรับอีกงาน ส่วน portal ที่วางอยู่หน้า ticket ที่ทำด้วยมือก็ยังเป็นคิว ticket อยู่ดี เพราะงั้นให้สร้าง capability แบบ self-service ก่อน แล้วค่อยเอา portal ไปวางไว้ข้างหน้า

**Product management สำหรับ internal product** การดูแล platform แบบ product หมายถึงทำแบบที่ product team ทำ:

- **ผู้ใช้และ persona** developer ไม่ได้เป็นกลุ่มเดียว: backend team, data team และ mobile team ต้องการของต่างกัน และ SRE กับ security engineer ก็ใช้ platform ด้วย
- **Discovery** ตัว white paper แนะนำ user interview, hackathon, issue tracker, survey และการดูว่าคนใช้ platform จริง ๆ ยังไง
- **Roadmap** ที่เรียงตามปัญหาของผู้ใช้และเผยแพร่ให้เห็น ทีมจะได้วางแผนรอบ ๆ มันได้
- **Documentation, onboarding และ support** เป็นส่วนหนึ่งของ product: getting-started guide, ตัวอย่าง, office hours และ support channel
- **Internal marketing** ตัว white paper นับ advocacy เป็นหนึ่งในงานของ platform team: demo, การประกาศ และ feedback session ที่จัดสม่ำเสมอ
- **Deprecation** ใน *Mind the platform execution gap* (martinfowler.com, 2021) Cristóbal García García กับ Chris Ford มองการปลด capability ออกเป็นเรื่องปกติของ product lifecycle ของ platform และ maturity model ของ CNCF ก็นับการเอา feature ออกเป็นส่วนหนึ่งของการดูแล platform แบบ product

ตัว white paper แนะนำให้ดึง product manager เข้ามาตั้งแต่แรก และคาดว่า platform ที่สร้างโดยไม่มี feedback หรือถูกยัดเยียดให้ผู้ใช้ด้วยคำสั่งจากบนลงล่าง จะเจอความไม่พอใจและให้ผลน้อยกว่าที่สัญญาไว้มาก García García กับ Ford ก็แนะนำว่าอย่าใช้การบังคับเป็นวิธีหาผู้ใช้

**Thinnest viable platform** ใน *Team Topologies* (IT Revolution; ฉบับแรก 2019, ฉบับที่สองเดือนกันยายน 2025) Matthew Skelton กับ Manuel Pais มอง platform เป็นกลุ่มของทีม ที่มี internal product ช่วยเร่งการส่งมอบให้ทีม stream-aligned ที่สร้าง product ของธุรกิจ โดยส่วนใหญ่ทำผ่าน interaction mode แบบ *X-as-a-Service* ทีมพวกนั้นจะได้แบก cognitive load น้อยลง ผู้เขียนสนับสนุน **thinnest viable platform** (TVP): หนาไม่เกินที่จำเป็น สำหรับบางองค์กรมันคือหน้า wiki ที่บอกว่าใช้ cloud service ตัวไหนและใช้ยังไง และจะเพิ่มอะไรก็ต่อเมื่อมันทำให้ทีมเร็วขึ้น เวอร์ชันแรกของ Acme คือ documentation กับ self-service API สามตัว ส่วน [Team Topologies](../team-topologies/) พูดถึงการออกแบบทีมรอบ ๆ platform และหน้านี้พูดถึงการดูแล platform team ให้ทำงานแบบ product team

**Maturity** ตัว *Platform Engineering Maturity Model* ของ CNCF (TAG App Delivery, version 1 เสร็จเดือนตุลาคม 2023) อธิบายห้าด้าน แต่ละด้านมีสี่ระดับ:

| ด้าน | Provisional | Operational | Scalable | Optimizing |
|---|---|---|---|---|
| Investment | อาสาทำหรือชั่วคราว | มีทีมเฉพาะ | ลงทุนแบบ product | ecosystem ที่เปิดให้คนอื่นร่วมสร้าง |
| Adoption | ไม่สม่ำเสมอ | Extrinsic push | Intrinsic pull | มีส่วนร่วม |
| Interfaces | process ที่ทำขึ้นเอง | tooling มาตรฐาน | solution แบบ self-service | service ที่ผสานกัน |
| Operations | ตามคำขอ | ติดตามจากส่วนกลาง | ส่วนกลางเปิดให้ทำเอง | managed service |
| Measurement | เฉพาะกิจ | เก็บข้อมูลสม่ำเสมอ | insight | ทั้งเชิงปริมาณและเชิงคุณภาพ |

Acme เริ่มต้นที่สองคอลัมน์แรก: มีทีมเฉพาะ, operations ตามคำขอ, script และ process ที่ทำขึ้นเอง และ adoption ที่เกิดขึ้นแค่เพราะไม่มีทางอื่นให้เข้า หนึ่งปีต่อมา ด้าน investment, adoption และ interface ของมันดูเหมือนคอลัมน์ที่สาม ตัว model บอกชัดว่าแต่ละระดับใช้เงินและเวลามากขึ้น และการไปถึงระดับบนสุดไม่ใช่เป้าหมายในตัวเอง แต่ละด้านประเมินแยกกัน และผลที่มีประโยชน์คือรายการสิ่งที่ต้องปรับปรุงต่อไป

**การวัดผล platform** ตัว white paper แบ่ง metric เป็นสามกลุ่ม: ความพอใจและ productivity ของผู้ใช้ (active user และ retention, survey ความพอใจอย่าง NPS, ตัววัด developer productivity อย่าง SPACE), ประสิทธิภาพขององค์กร (เวลาตั้งแต่ request จนได้ capability ที่ใช้งานได้, เวลาที่ใช้เอา service ใหม่เอี่ยมขึ้น production, เวลาจนถึง change แรกของ developer คนใหม่) และการส่งมอบของ product ที่สร้างบน platform (metric ของ DORA) ส่วน guide เรื่อง platform engineering ของ DORA เองแนะนำ balanced scorecard: software delivery metric ห้าตัว (change lead time, deployment frequency, failed deployment recovery time, change fail rate และ deployment rework rate; ดู [DORA Metrics](../dora-metrics/)), survey ความพอใจของ developer (CSAT หรือ NPS), adoption และ retention ที่วัดด้วย HEART framework ของ Google และ task success คือ developer ทำ workflow สำคัญบน platform ได้สำเร็จแค่ไหน งาน SPACE (Forsgren, Storey และคณะ, 2021) กับ DevEx (Noda, Storey, Forsgren และ Greiler, 2023) ครอบคลุมฝั่ง developer experience และบทความปี 2025 ของ DORA เรื่อง measurement framework แนะนำให้เลือกตัวที่เข้ากับการตัดสินใจที่ตัวเลขต้องรองรับ ส่วน reliability ของ platform เองก็มี [SLO](../slo-error-budgets/) เหมือน service อื่น ๆ

**งานวิจัยว่ายังไง** รายงานปี 2024 ของ DORA พบว่าผู้ตอบที่ใช้ internal developer platform รายงานว่ามี productivity ส่วนบุคคล ผลงานของทีม และผลงานขององค์กรสูงขึ้น แต่ throughput กับ change stability ต่ำลง การทำงานได้โดยไม่ต้องรอทีม enabling ไปด้วยกันกับ productivity ที่ดีขึ้น 5% ทั้งสำหรับทีมและสำหรับรายบุคคล ในงานวิจัยปี 2025 ของ DORA องค์กร 90% รายงานว่าใช้ internal developer platform และ 76% มี platform team เฉพาะ ถ้าคุณภาพของ platform สูง การนำ AI มาใช้ก็ไปด้วยกันกับผลงานขององค์กรที่ดีขึ้นชัดเจน แต่ถ้าคุณภาพต่ำ ผลก็แทบไม่มีเลย ส่วน capability ของ platform ที่ผูกกับ user experience ที่ดีมากที่สุดคือ feedback ที่ชัดเจนเรื่องผลลัพธ์ของงาน ทาง DORA ยังบอกด้วยว่าโครงการ platform มักเดินตาม J-curve: ได้ผลดีช่วงแรก แล้วตกลงตอนความซับซ้อนเพิ่มขึ้น จากนั้นก็ขึ้นไปอยู่ที่ระดับที่สูงกว่าเดิม ทั้งหมดนี้เป็น correlation จาก survey ไม่ใช่คำสัญญาสำหรับองค์กรใดองค์กรหนึ่ง

**เงินทุนและคน** ด้าน investment ของ maturity model ไล่ตั้งแต่อาสาสมัครที่สร้าง shared tool เป็นงานเสริม ไปถึงทีมเฉพาะที่ได้งบแบบ cost centre โดยไม่มีใครวัดว่าส่งผลกับ product team ยังไง ไปจนถึงการให้ทุน platform แบบเดียวกับที่บริษัทให้ทุน product ภายนอก: ตามคุณค่าที่คาดว่าจะส่งมอบได้ มี product management กับ user-experience role, roadmap ที่เผยแพร่ และบางทีก็มีระบบ chargeback ด้วย ตัว white paper เตือนว่าผู้บริหารที่มอง platform เป็นค่าใช้จ่ายของ IT มักให้งบไม่พอ platform team เลยต้องแสดงให้เห็นว่ามันส่งผลกับงานของ product team ยังไง เพื่อรักษาการสนับสนุนไว้ ตัว white paper ยังขอให้จัดคนใน platform team ให้พอกับ domain และจำนวนผู้ใช้ของมัน ทาง Acme เพิ่ม product manager หนึ่งคนเข้ามาร่วมกับ platform engineer หกคน

## ลงมือทำจริงยังไง

platform team ของ Acme เปลี่ยนวิธีทำงานภายในหนึ่งปี:

1. **หาให้เจอว่าใครคือลูกค้าและอะไรที่เจ็บ** product manager คนใหม่สัมภาษณ์ product team ครบหกทีม, นั่งดูทีม delivery ตอนตั้ง service, ส่ง survey สั้น ๆ ให้ developer ทุกคน (ได้คำตอบ 44 ชุด ความพอใจ 2.4 จาก 5) และจัดกลุ่ม ticket ที่เปิดค้าง 140 ใบตามประเภทและเวลารอ ปัญหาสามอันดับแรกที่ออกมาคือ environment ใหม่ใช้เวลา 9 วัน (ทั้งหกทีม) secret ได้มาทาง ticket เท่านั้น (ห้าทีม) และ pipeline ของแต่ละทีมไม่เหมือนกัน (สี่ทีม)
2. **ให้ roadmap มีเจ้าของ และเผยแพร่มัน** product manager เป็นเจ้าของปัญหาและลำดับของงาน ส่วน engineer เป็นเจ้าของ solution ไตรมาสละหนึ่งปัญหา: documentation กับ self-service API สามตัวสำหรับ namespace, database และ DNS record จากนั้นเป็น self-service secret ใน Vault ต่อด้วย pipeline template ตัวเดียว แล้วค่อยเป็น portal บน Backstage ส่วน service mesh ถูกพักไว้ แล้วก็ถูก deprecate โดยแจ้งล่วงหน้าและถูกเอาออก เพราะไม่มีใครใช้
3. **เริ่มบาง ๆ กับ partner team** Launchpad v0 คือ documentation กับ API สามตัว ที่สร้างร่วมกับทีม delivery สำหรับ service ตัวถัดไปของทีมนั้น ส่วน portal มาทีหลังสุด โดยวางไว้หน้า capability ที่ใช้งานได้อยู่แล้ว ข้างหลัง API อาจเป็น Kubernetes operator หรือ pipeline ที่ apply infrastructure code ที่ผ่าน review แล้วก็ได้ สิ่งที่สำคัญสำหรับผู้ใช้คือ request เป็น self-service และเร็ว
4. **ทำให้ support เป็นส่วนหนึ่งของ product** หน้า TechDocs ข้างโค้ด, office hours ทุกสัปดาห์, channel `#launchpad-help` และ release note กับ deprecation notice สำหรับทุกการเปลี่ยนแปลง
5. **ดูแล platform แบบ production** Acme เลือก SLO สองตัว: CI/CD pipeline มี availability 99.5% ของเวลาในรอบ 30 วัน และ 95% ของ provisioning request เสร็จภายใน 15 นาที ตัว platform team อยู่ on-call สำหรับ SLO พวกนี้เหมือน service team ทั่วไป และ product team ก็ดู SLO เหล่านี้ได้
6. **วัดผลลัพธ์ทุกไตรมาส** และลงมือตามสิ่งที่มันบอก:

| ตัววัด | ก่อนหน้า | Baseline (ช่วง discovery) | หนึ่งปีต่อมา |
|---|---|---|---|
| Adoption | ไม่มีทางเลือก: มีแต่ ticket | 0 จาก 6 ทีม | 5 จาก 6 ทีม โดยเลือกเอง |
| เวลาจนถึง deploy แรกบน staging | 9 วันทำการ | 9 วันทำการ | 20 นาที |
| ความพอใจของ developer (survey, 1 ถึง 5) | ไม่เคยถาม | 2.4 | 4.1 |
| ticket ของ platform ที่เปิดค้าง | 140 | 140 | 20 สำหรับความต้องการที่ไม่ธรรมดา |
| Pipeline availability ในรอบ 30 วัน (เป้า 99.5%) | ไม่มี SLO | ร่างไว้ | 99.8% |
| Provisioning time ที่ percentile ที่ 95 (เป้า 15 นาที) | ไม่มี SLO | ร่างไว้ | 6 นาที |

7. **ให้มันเป็นทางเลือก แล้วชนะใจทีมสุดท้ายให้ได้** ทีม mobile app ยังใช้ pipeline ของตัวเอง: แอป iOS ต้อง build ด้วย Xcode ที่ run บน macOS ส่วน build runner ของ Launchpad เป็น Linux container บน Kubernetes ทีมขอ macOS build runner และมันก็เป็นงานถัดไปบน roadmap ส่วนทีมที่ต้องการบางอย่างที่ platform ไม่มีให้ก็ run เองได้ โดยมี documentation บอกว่าทีมจะต้องเป็นเจ้าของอะไรบ้างหลังจากนั้น

## อยู่ตรงไหนใน solution

- [Team Topologies](../team-topologies/) คือการออกแบบทีมรอบ ๆ platform: ทีม stream-aligned, platform grouping, interaction mode แบบ X-as-a-Service และ thinnest viable platform ส่วนหน้านี้พูดถึงว่า platform team ทำงานยังไง
- [Golden Paths](../golden-paths/) คือเส้นทางที่ปูไว้ให้แล้วผ่าน platform เช่น template ที่พา returns service ไปถึง deploy แรกบน staging ใน 20 นาที
- [You Build It, You Run It](../you-build-it-you-run-it/): product team ที่ดูแล service ของตัวเองต้องมี platform ที่ทำให้ pipeline, dashboard และ on-call มีต้นทุนต่ำ ส่วน platform team ที่ไปดูแล service ของทุกทีมแทน ก็จะกลายเป็นทีม operations อีกครั้ง
- [Eliminating Toil](../eliminating-toil/): ticket สำหรับ request ประจำเป็น toil ของ platform team และเป็นเวลารอของคนอื่นทุกคน ส่วน self-service ก็ตัดได้ทั้งสองอย่าง
- [Infrastructure as Code](../infrastructure-as-code/) และ [GitOps](../gitops/): self-service API และ template มักมี infrastructure code ที่ผ่าน review และ agent ที่ reconcile cluster อยู่ข้างหลัง
- [Kubernetes](../kubernetes/), [HashiCorp Vault](../vault/) และ [Prometheus & Grafana](../prometheus/) คือ capability ที่อยู่ใต้ Launchpad และให้บริการผ่าน interface ของมันแทนที่จะผ่าน ticket
- [DORA Metrics](../dora-metrics/) และ [SLOs & Error Budgets](../slo-error-budgets/) วัดผลลัพธ์ที่ product team ได้ และ reliability ของ platform เอง
- [Service Mesh](../service-mesh/) เป็น component ที่มีประโยชน์เมื่อทีมต้องการสิ่งที่มันให้ เช่น mutual TLS และ traffic policy ข้ามหลาย service ส่วนกับดักในเรื่องนี้คือการสร้างมันก่อนที่ใครจะขอ

## ใช้ตอนไหนดี

- **คุ้มเมื่อ** product team หลายทีมทำงาน infrastructure แบบเดียวกันซ้ำ ๆ เมื่อ request ประจำต้องรอในคิว เมื่อ pipeline ของแต่ละทีมไม่เหมือนกัน หรือเมื่อ developer ใช้เวลาไปมากในแต่ละสัปดาห์กับ infrastructure แทนที่จะเป็น product ของตัวเอง ทาง Acme มี product team หกทีมและ ticket เปิดค้าง 140 ใบ
- **องค์กรเล็ก** ถ้ามี product team แค่หนึ่งหรือสองทีม การมี platform team เฉพาะกับ product manager จะมีต้นทุนมากกว่าที่ประหยัดได้ ตัว thinnest viable platform อาจเป็นแค่หน้า wiki, pipeline template ที่ใช้ร่วมกัน และ managed cloud service ที่ทีมดูแลกันเอง
- **Product management เป็น role ก่อนจะเป็นการจ้างคน** platform team เล็ก ๆ ให้ engineer คนหนึ่งรับ role นี้แบบ part-time ได้ สิ่งที่สำคัญคือต้องมีใครสักคนเป็นเจ้าของ discovery, roadmap และ feedback loop
- **สภาพแวดล้อมที่อยู่ใต้ regulation** บาง control ไม่ใช่ทางเลือก: audit trail, approval, separation of duties ให้ใส่มันไว้ในเส้นทางของ platform ทางที่ compliant จะได้เป็นทางที่ง่ายที่สุดด้วย และให้บังคับที่ control ไม่ใช่บังคับที่ tool เพื่อให้ทีมที่ออกนอก paved road ยังต้องทำตาม control นั้น
- **ระบบ legacy** ที่ไม่เข้ากับ platform เช่น mainframe หรือ vendor appliance ก็อยู่นอก platform ได้ การบังคับให้มันเข้ามามีต้นทุนมากกว่าที่ได้คืน
- **ต้นทุน** คือทีม, product manager และงบประมาณที่ต่อเนื่อง และ maturity model ก็ชี้ว่าแต่ละระดับมีต้นทุนสูงขึ้น ส่วน J-curve ของ DORA ก็เป็นเหตุผลที่ควรคาดไว้ว่าจะมีช่วงตกก่อนที่ผลดีจะนิ่ง

## กับดักที่เจอบ่อย

- **บังคับให้ใช้แทนที่จะทำให้คนอยากใช้** การบังคับทำให้ตัวเลข adoption ขึ้นไปถึง 6 จาก 6 แต่ทีมที่ platform ไม่เหมาะด้วยก็ลำบากและยังเก็บทางอ้อมของตัวเองไว้ และ platform team ก็เสียสัญญาณที่บอกว่าต้องแก้อะไร ให้ platform เป็นทางเลือกและ composable วัด adoption แบบสมัครใจ และถามทีมที่ไม่มาใช้ว่าอะไรจะดึงพวกเขาเข้ามาได้ ตัว maturity model เรียก adoption ที่มาจากการบังคับหรือแรงจูงใจว่า *extrinsic push* และวาง *intrinsic pull* ที่ทีมเลือก platform เพราะคุณค่าของมัน ไว้สูงกว่าหนึ่งระดับ
- **สร้างเพื่อความต้องการที่คิดไปเอง** หนึ่งไตรมาสที่หมดไปกับ service mesh ที่ไม่มีใครขอ คือหนึ่งไตรมาสที่ไม่ได้ใช้แก้การรอ 9 วัน ให้เริ่มจาก discovery กับข้อมูล ticket แล้วสร้างเวอร์ชันที่บางที่สุดกับ partner team และปลดสิ่งที่ไม่มีคนใช้ออก
- **ไม่มี product manager และไม่มี feedback loop** ถ้าไม่มีใครเป็นเจ้าของ discovery และ roadmap ตัว roadmap ก็จะไหลกลับไปตามความสนใจของ platform team เอง ให้มีคนรับ role นี้ เผยแพร่ roadmap และทำ interview, survey และเก็บข้อมูลการใช้งานเป็นจังหวะสม่ำเสมอ
- **Golden cage หรือ platform ที่บางเกินจะช่วยได้** platform ที่ซ่อนทุกอย่างไว้ไม่เหลือทางออกเมื่อทีมต้องการอะไรแปลก ๆ ทาง DORA เรียกแนวทาง one-size-fits-all แบบนี้ว่า "golden cage" ส่วน platform ที่มีแค่ wiki กับ script ไม่กี่ตัวก็ปล่อยให้ทุกทีมต้องต่อชิ้นส่วนกันเอง ให้มีชิ้นส่วนที่ composable แล้วเขียน documentation บอกว่าจะออกจาก paved road ยังไงและทีมต้องเป็นเจ้าของอะไรหลังจากนั้น แล้วเพิ่ม capability เมื่อความต้องการโผล่ขึ้นมาใน ticket และ feedback
- **นับ feature ที่ ship** "34 feature ในปีนี้" ไม่ได้บอกอะไรเลยว่ามีใครใช้มันไหม หรือการส่งมอบเร็วขึ้นหรือเปล่า ให้ติดตาม adoption กับ retention, เวลาจนถึง deploy แรก, ความพอใจ, task success และ DORA metric ของทีมที่อยู่บน platform
- **ทีม operations ที่เปลี่ยนชื่อเป็น platform team** ถ้าคนกลุ่มเดิมยังทำงานผ่านคิว ticket เดิม ก็มีแค่ป้ายชื่อหน้าประตูที่เปลี่ยน ทั้ง Bottcher และ Thoughtworks Technology Radar ต่างเตือนว่าอย่าเอา hosting กับ operations ที่มีอยู่มาติดป้ายใหม่ว่าเป็น platform ให้ทำ request ประจำให้เป็น self-service และมอง ticket แต่ละใบที่เหลือเป็นสัญญาณว่ามี feature ที่ยังขาด
- **Portal แบบ big-bang** การเปิดตัว portal ก่อนที่ capability ข้างหลังมันจะเป็น self-service ก็คือคิวเดิมในกรอบที่สวยขึ้น และ DORA ก็เตือนว่ากว่า platform ที่สร้างครบทุกอย่างจะได้ปล่อยออกมา ความต้องการก็เปลี่ยนไปแล้ว ให้สร้าง capability แบบ self-service ก่อน แล้วค่อยทำ interface
