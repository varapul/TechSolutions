## ปัญหา

Acme Shop มี engineer ราว 60 คนช่วยกันสร้าง และหลายปีที่ผ่านมาพวกเขาถูกจัดทีมตาม layer ทางเทคนิค: ทีม front-end เป็นเจ้าของ web UI ทีม back-end ดู business logic ทีม database ดู schema ที่ใช้ร่วมกัน และทีม operations ดู server กับ release รายสัปดาห์ ทุก feature ที่ลูกค้าเห็นต้องข้ามทั้งสี่ทีม พอทีม front-end เริ่มทำ wishlist ก็ต้องใช้ API ใหม่ เลยเปิด ticket ไปที่ทีม back-end แล้วทีม back-end ก็ต้องใช้ table ใหม่ เลยเปิด ticket ไปที่ทีม database จากนั้น change ที่เสร็จแล้วก็ต้องรอ release รอบถัดไปของทีม operations งานเก้าวันเลยใช้เวลา 28 วัน โดย 19 วันในนั้นหมดไปกับการรออยู่ในคิวของทีมอื่น (ตัวเลขเหล่านี้เป็นของตัวอย่างเอง ไม่ใช่ผลวิจัย)

ซอฟต์แวร์มีรูปร่างเดียวกับองค์กร: เป็น layered monolith ที่ทุก feature ต้องแตะทั้ง web UI, business layer และ database ที่ใช้ร่วมกันตัวเดียว Melvin Conway อธิบายผลแบบนี้ไว้ตั้งแต่ปี 1968: องค์กรที่ออกแบบระบบจะได้ design ที่ลอกโครงสร้างการสื่อสารของตัวเองมา ทีมที่ส่วนใหญ่คุยกันแค่ใน layer ของตัวเองก็จะสร้างระบบที่แบ่งตาม layer แล้ว layer พวกนั้นก็ทำให้ handoff กลายเป็นของถาวร

reorganisation รอบก่อนพยายามแก้เรื่องนี้ให้ร้านส่วนหนึ่ง ด้วยการตั้งทีม checkout ที่ build และ run service ของตัวเอง แต่มันเลยเถิดไปอีกทาง ตอนนี้คนแปดคนเป็นเจ้าของ service เจ็ดตัวจากสอง domain คือ checkout flow กับ payments และพร้อมกันนั้นก็ต้องดูแล Kubernetes manifest ของทุก service, Terraform ของ AWS resource ของมัน, alert rule 46 ตัว และ PCI DSS audit ไม่มีใครตัดสินใจว่าทีมนี้ควรแบกขนาดนั้น: หน้าที่ถูกเพิ่มเข้ามาทีละอย่างและไม่เคยมีอะไรถูกเอาออก จนความสนใจส่วนใหญ่ของทีมไปอยู่กับงาน plumbing และหลักฐานสำหรับ audit แทนที่จะเป็น checkout flow

## ทำงานยังไง

*Team Topologies* ของ Matthew Skelton และ Manuel Pais (IT Revolution, 2019; ฉบับที่สองเดือนกันยายน 2025) มองทีมเป็นหน่วยของการส่งมอบงาน และออกแบบองค์กรให้การเปลี่ยนแปลงไหลได้เร็ว หนังสือต่อยอดมาจาก pattern ชุด DevOps Topologies ของผู้เขียน ที่ Skelton วาดครั้งแรกในปี 2013 และอธิบายรูปร่างของทีมแบบคงที่ ส่วนหนังสือเพิ่มเรื่องที่ว่าทีมทำงานร่วมกันยังไง และรูปแบบนั้นเปลี่ยนไปยังไง แก่นของมันตั้งใจให้เล็ก: ทีมสี่ประเภทกับ interaction mode สามแบบ

**ทีมสี่ประเภท**

| ประเภท | ทำอะไร | ที่ Acme |
|---|---|---|
| Stream-aligned | เป็นเจ้าของ flow ของงานสำหรับธุรกิจส่วนหนึ่งแบบครบวงจร ตั้งแต่ไอเดียจนถึง production โดยไม่ส่งงานต่อให้ทีมอื่น เป็นประเภทหลัก ส่วนอีกสามประเภทมีไว้เพื่อลดภาระให้มัน | checkout, payments, catalog, search, delivery และ mobile app |
| Platform | ให้ internal service ที่ทีม stream-aligned ใช้ได้เอง และดูแลมันแบบ product ที่ทีมเหล่านั้นอยากใช้ ทีมพวกนั้นจะได้ไม่ต้องสร้าง plumbing เอง | platform team (engineer 6 คน) และ Launchpad |
| Enabling | ผู้เชี่ยวชาญที่ช่วยทีมอื่นให้ได้ทักษะหรือความสามารถที่ยังขาด แล้วก็ไปต่อ ทีม enabling ไม่ได้เป็นเจ้าของซอฟต์แวร์ | SRE group (engineer 5 คน) |
| Complicated subsystem | เป็นเจ้าของส่วนของระบบที่ต้องใช้ความรู้เฉพาะทางเชิงลึก ในระดับที่คาดหวังให้ทีมส่วนใหญ่มีไม่ได้ | recommendations (engineer 5 คน) ที่ดูแล ML ranking engine |

**Interaction mode สามแบบ**

- **Collaboration:** สองทีมทำงานใกล้ชิดกันในช่วงเวลาที่กำหนด เพื่อค้นหาของใหม่ เช่น API, practice หรือเทคโนโลยี แบบนี้ค้นหาได้เร็วและไม่มี handoff แต่ทั้งสองทีมต้องแบก context มากขึ้นและส่งงานได้น้อยลงตลอดช่วงนั้น หนังสือเลยให้ทีมหนึ่ง collaborate กับทีมอื่นได้ทีละไม่เกินหนึ่งทีม
- **X-as-a-Service:** ทีมหนึ่งให้บางอย่าง (library, API หรือทั้ง platform) แล้วทีมอื่นใช้มันโดยแทบไม่ต้องคุยกัน ความเป็นเจ้าของชัดเจน และ cognitive load ของคนใช้ก็ต่ำ ส่วนราคาที่ต้องจ่ายคือขอบเขตจะเปลี่ยนได้ช้ากว่า ทีมหนึ่งให้หรือใช้หลาย service พร้อมกันได้
- **Facilitating:** ทีมหนึ่งช่วยอีกทีมให้เรียนรู้ หรือเคลียร์อุปสรรคให้พ้นทาง เป็น mode หลักของทีม enabling และควรจบเมื่ออีกทีมดูแลตัวเองได้แล้ว

หนังสือคาดไว้ว่า mode จะเปลี่ยนไปตามเวลา ที่ Acme ทีม catalog กับ recommendations collaborate กันระหว่างที่ช่วยกันออกแบบ ranking API ตัวใหม่ แล้วเปลี่ยนเป็น X-as-a-Service เมื่อมันนิ่ง ส่วน SRE group ก็ facilitate ทีม delivery อยู่หกสัปดาห์แล้วก็ออกไป ทีม Team Topologies เรียก "collaboration" แบบปลายเปิดที่ไม่มีเป้าหมายหรือจุดจบว่า *undefined interaction* และมองว่าเป็นสัญญาณว่าขอบเขตอยู่ผิดที่

**Team-first thinking และ cognitive load** ในหนังสือ ทีมหมายถึงกลุ่มคนเล็ก ๆ ห้าถึงเก้าคนที่อยู่ด้วยกันนานและมีเป้าหมายเดียวกัน ขนาดนี้อิงงานวิจัยของ Dunbar ว่าเรารู้จักและไว้ใจคนได้ดีสักกี่คน หนังสือยืมคำว่า *cognitive load* มาจากนักจิตวิทยา John Sweller ที่อธิบายมันไว้ในปี 1988 และแบ่งเป็นสามแบบ: load แบบ **intrinsic** มาจากพื้นฐานของงาน (ภาษา, framework) load แบบ **extraneous** มาจากสภาพแวดล้อมที่ทำงานนั้น (ขั้นตอนการ deploy, configuration ของแต่ละ environment) และ load แบบ **germane** มาจากส่วนของงานที่ต้องคิดและเรียนรู้จริง ๆ ถึงจะทำได้ดี (ในที่นี้คือ business domain ของร้าน) คำแนะนำคือลด intrinsic load ด้วย training, การเลือกเทคโนโลยีที่ดี และ pairing ตัด extraneous load ทิ้งไปเลย โดยมักจะ automate มันเข้าไปใน platform และเหลือที่ไว้ให้ germane load ขอบเขตและหน้าที่ของทีมควรพอดีกับสิ่งที่ทีมรับไหว heuristic หนึ่งของหนังสือคือให้ทีมดูแล domain ที่ complicated หรือ complex ไม่เกินหนึ่ง domain ส่วนทีม checkout ของ Acme มี domain แบบนั้นอยู่สอง domain แถมยังมี plumbing แบบ extraneous กองอยู่ข้างบนอีก

**Conway's law และ reverse Conway manoeuvre** บทความ *How Do Committees Invent?* ของ Conway ตีพิมพ์ใน Datamation เดือนเมษายน 1968 แล้ว Fred Brooks ก็ตั้งชื่อ thesis ของมันว่า Conway's law ทีหลังใน *The Mythical Man-Month* โครงสร้างทีมจะกำหนดรูปร่างของ architecture อยู่ดี เราเลยใช้มันแบบตั้งใจได้: ตัดสินใจก่อนว่าอยากได้ architecture แบบไหน แล้วจัดทีมและการสื่อสารของทีมให้มีแนวโน้มจะสร้าง architecture แบบนั้นออกมา Jonny LeRoy กับ Matt Simons เรียกสิ่งนี้ว่า inverse Conway maneuver (Cutter IT Journal, ธันวาคม 2010) ส่วนหนังสือเรียกมันว่า reverse Conway maneuver ทาง Acme อยากให้ payments เป็น service ของตัวเองที่มี database ของตัวเอง เลยตั้งทีม payments ขึ้นก่อน แล้วปล่อยให้ขอบเขตของ service ตามมา

**Fracture plane** เวลาจะตัดสินว่าจะแบ่ง monolith หรือทีมที่ภาระล้นตรงไหน หนังสือจะมองหา *fracture plane*: รอยต่อตามธรรมชาติที่แยกส่วนหนึ่งของระบบออกมาได้ โดยเหลือ coupling ข้ามรอยตัดน้อย ส่วนใหญ่ก็คือขอบเขตของ domain (bounded context ในภาษาของ domain-driven design) และหนังสือยังดูความต่างอื่น ๆ ด้วย เช่น แต่ละส่วนเปลี่ยนบ่อยแค่ไหน ที่ Acme ตัว payments ที่มีกฎ ข้อมูล และ audit ของตัวเอง ก็คือรอยต่อแบบนี้

**Thinnest Viable Platform** ตัว platform ควรเป็นสิ่งที่เล็กที่สุดที่ทำให้ทีม stream-aligned เร็วขึ้น ผู้เขียนชี้ว่ามันเล็กได้ถึงขั้นเป็นหน้า wiki หน้าเดียว ที่บอกว่าทีมใช้ cloud service ตัวไหนและใช้ยังไง และควรโตขึ้นก็ต่อเมื่อความต้องการของทีมโตขึ้นเท่านั้น platform ที่สร้างไว้ก่อนมีคนต้องการจะเพิ่ม cognitive load แทนที่จะลด

**Team API** แต่ละทีมอธิบายว่าทีมอื่นทำงานกับตัวเองยังไง: เป็นเจ้าของอะไร ให้ service อะไรและคาดหวังอะไรจาก service พวกนั้นได้ ทำ versioning ยังไง documentation กับช่องทาง chat อยู่ที่ไหน ทำงานแบบไหน และตอนนี้ทำงานร่วมกับทีมไหนอยู่ ใน mode ไหน และนานแค่ไหน ผู้เขียนเผยแพร่ template ของ Team API ไว้บน GitHub

**แผนผังที่ต้องปรับไปเรื่อย ๆ** แผนผังทีมเป็นแค่ภาพ ณ ขณะหนึ่ง พอเป้าหมายเปลี่ยนและทีมได้เรียนรู้ ตัว collaboration ก็กลายเป็น service, facilitation จบลง ทีมแยกหรือรวมกัน และผู้เขียนแนะนำให้ปรับขอบเขตทีมทีละก้าวเล็ก ๆ บ่อย ๆ แทนที่จะ reorganise ครั้งใหญ่ ฉบับที่สอง (2025) เพิ่ม case study จากหลายอุตสาหกรรม และขยายความว่า platform มักเป็น *กลุ่ม* ของทีม (grouping) มากกว่าทีมเดียว: พอองค์กรมีคนเกินราว 40 ถึง 50 คน platform team ทีมเดียวที่มีราวแปดคนก็แทบไม่เคยพอ ส่วน Acme ที่มี engineer ราว 60 คนและ platform team หนึ่งทีมหกคน อยู่ที่ขนาดที่ Launchpad อาจต้องกลายเป็น grouping ของสองทีม

## ลงมือทำจริงยังไง

1. **ทำแผนผังทีมที่มีอยู่และเส้นทางที่งานไหลระหว่างทีม** ไล่ทุกทีมว่าเป็นเจ้าของอะไรและต้องรอใคร ตามรอย change ล่าสุดสักสองสามตัวตั้งแต่ไอเดียจนถึง production แล้วนับ handoff กับเวลาที่รอ แบบที่ Acme ทำกับ wishlist ถ้าทีมไหนยังไม่เข้าประเภทไหน ก็ปล่อยไว้โดยยังไม่ต้องมีประเภท แทนที่จะฝืนแปะป้ายให้
2. **ถามทีมเรื่อง cognitive load** เวลาของทีมหมดไปกับ domain เท่าไหร่ และกับ plumbing เท่าไหร่ ต้องรู้จัก service, domain และ tool กี่ตัว และรู้สึกหลงทางตรงไหน Team Topologies เผยแพร่ template สำหรับประเมิน cognitive load ของทีมไว้บน GitHub แล้วการทำ survey สั้น ๆ ซ้ำทุกไตรมาสก็จะทำให้เห็นแนวโน้ม
3. **เลือก stream และ fracture plane** จัดทีม stream-aligned ให้ตรงกับส่วนของธุรกิจที่ลูกค้าเห็น เช่น product, journey หรือกลุ่มผู้ใช้ และแบ่งทีมที่ภาระล้นตาม fracture plane แบบที่ Acme แยก payments ออกจาก checkout ส่วนขนาดทีมให้อยู่ที่ห้าถึงเก้าคน อยู่ด้วยกันนาน และแต่ละทีมมี domain ที่ complicated ได้ไม่เกินหนึ่ง domain
4. **สร้าง platform ที่บางที่สุดที่ช่วยตัด plumbing ที่ทำซ้ำ ๆ ออกไป** Launchpad ของ Acme รวม developer portal ที่สร้างบน Backstage (ทั้ง Software Catalog, Software Templates และ TechDocs ของมัน), service template, CI/CD pipeline, [Kubernetes](../kubernetes/) cluster ที่ใช้ร่วมกัน, [Prometheus และ Grafana](../prometheus/) และ secret ใน [HashiCorp Vault](../vault/) ไว้ด้วยกัน ทีม delivery ใช้ portal สร้าง returns service ตัวใหม่ แล้วได้ repository, pipeline, deployment และ dashboard ภายในราว 20 นาที แทนที่จะต้องเปิด ticket แล้วรอ 9 วันทำการ ส่วนตัว platform ให้ดูแลแบบ product และวัดมันด้วย adoption กับความพอใจของคนใช้ ไม่ใช่จำนวน feature
5. **ระบุ interaction mode ให้ทุกคู่ทีมที่ทำงานด้วยกัน** พร้อมจุดประสงค์ และถ้าเป็นแบบชั่วคราวก็ใส่ exit criterion กับวันที่ด้วย ทาง SRE group ของ Acme facilitate ทีม delivery อยู่หกสัปดาห์ด้วยเป้าหมายที่ชัด (SLO, alert และ on-call rotation สำหรับ returns service) ส่วน catalog กับ recommendations collaborate กันสามเดือนจน API v2 นิ่ง
6. **เผยแพร่ Team API** ไว้ในที่ที่คนดูอยู่แล้ว เช่นหน้าของทีมใน developer portal แล้วทีมอื่นก็จะได้รู้ว่าแต่ละทีมให้อะไรและติดต่อยังไง
7. **Review แผนผังทุกไตรมาส** ดู handoff, lead time และผล survey เรื่อง cognitive load แล้วปรับ interaction กับขอบเขตทีมทีละก้าวเล็ก ๆ

## อยู่ตรงไหนใน solution

- **[Microservices](../microservices/)** และ **[Database per Service](../database-per-service/)** จะเป็นอิสระต่อกันได้ก็ต่อเมื่อทีมที่เป็นเจ้าของเป็นอิสระด้วย: reverse Conway manoeuvre คือวิธีที่ Acme ทำให้ payments ได้ service และ database ของตัวเอง ส่วน **[Modular Monolith](../modular-monolith/)** ให้ทีม stream-aligned แต่ละทีมมี module ของตัวเองได้ ตอนที่การ deploy แยกกันยังไม่คุ้ม และ **[Layered Architecture](../layered-architecture/)** ก็คือสิ่งที่ทีมแบบแบ่ง layer มักจะสร้างออกมา
- **[You Build It, You Run It](../you-build-it-you-run-it/)** คือวิธีที่ทีม stream-aligned ทำงานในแต่ละวัน: run สิ่งที่ตัวเอง build โดยไม่ส่งต่อให้ทีม operations
- **[Platform as a Product](../platform-as-a-product/)** อธิบายว่า platform team ดูแล Launchpad ยังไง ส่วน **[Golden Paths](../golden-paths/)** อธิบาย template ที่ทำให้การใช้ platform แบบ X-as-a-Service ใช้เวลาเป็นนาทีแทนที่จะเป็นวัน
- **[The Three Ways](../three-ways/)** อธิบายว่าทำไม flow ถึงสำคัญ: ทีมที่จัดตาม flow ของการเปลี่ยนแปลงและมี handoff น้อย ก็คือ First Way ที่เอามาใช้กับองค์กร
- **[SLOs and Error Budgets](../slo-error-budgets/)** คือสิ่งที่ SRE group ของ Acme สอนทีม delivery ระหว่าง facilitate ส่วน **[Eliminating Toil](../eliminating-toil/)** ช่วยให้ platform team และทีม enabling หางานที่ทำซ้ำ ๆ ที่คุ้มจะ automate ทิ้งไป

## ใช้ตอนไหนดี

แนวทางนี้คุ้มเมื่อหลายทีมสร้าง product เดียวกันแล้ว change ต้องรอ handoff หรือเมื่อทีมแบกมากกว่าที่รับไหว สัญญาณที่เจอบ่อยคือ lead time ที่ส่วนใหญ่เป็นเวลารอ ทีมที่แบ่งตาม layer ของเทคโนโลยี และกลุ่ม platform หรือ operations ที่ทำงานผ่านคิวของ ticket แนวทางนี้ยังช่วยตอนเริ่มทำ microservices หรือ platform engineering ด้วย จะได้ออกแบบขอบเขตทีมกับขอบเขต service ไปพร้อมกัน

ส่วนกรณีต่อไปนี้ต้องปรับให้เข้ากับบริบท หรือมีต้นทุนมากกว่าที่ได้คืน:

- **องค์กรเล็ก** ถ้ามีแค่หนึ่งหรือสองทีมก็แทบไม่มีอะไรต้องออกแบบ: ทีม stream-aligned หนึ่งทีมกับ platform บาง ๆ ที่อาจเป็นแค่หน้า wiki กับ managed cloud service ก็พอแล้ว ประเภทของทีมจะเริ่มสำคัญตอนที่ทีมเริ่มต้องรอกัน
- **ระบบ legacy ที่ coupling กันแน่น** ทีม stream-aligned เป็นเจ้าของ flow แบบครบวงจรไม่ได้ ตราบใดที่ทุก change ยังต้องผ่าน codebase และ database ที่ใช้ร่วมกันชุดเดียว ให้แบ่งตาม fracture plane ทีละขั้น ([Strangler Fig](../strangler-fig/) ช่วยได้ตรงนี้) และเผื่อใจไว้ว่าระหว่างนั้นจะยังมี collaboration และ handoff อยู่บ้าง
- **งานที่อยู่ใต้ regulation** separation of duties กับ audit อาจดูเหมือนเหตุผลที่ต้องเก็บ handoff ไว้ บ่อยครั้ง approval step กับ audit trail ใน pipeline ที่ platform จัดให้ ก็ตอบกฎได้โดยไม่ต้องมีทีมแยก และ domain ที่อยู่ใต้ regulation ก็เป็น stream ของตัวเองที่มีงาน compliance ของตัวเองได้ แบบเดียวกับ payments ของ Acme ทั้งนี้ให้ตกลงเรื่อง control กับ auditor ของคุณ
- **ผู้เชี่ยวชาญมีน้อย** ถ้ามี ML engineer หรือผู้เชี่ยวชาญด้าน security แค่คนเดียว การตั้งทีม complicated-subsystem หรือทีม enabling ก็เป็นไปไม่ได้ ให้แบ่งปันความรู้ผ่าน facilitation และ documentation แล้วยอมรับว่าจะมี dependency อยู่บ้าง
- **ไม่ใช่วิธีทำ org chart** ผู้เขียนบอกชัดว่าแนวทางนี้ไม่ได้ให้โครงสร้างสายการรายงาน และการหยิบไปใช้แค่ส่วนเดียว เช่นเปลี่ยนป้ายทีมเป็นสี่ประเภท ก็แทบไม่ได้อะไร

## กับดักที่เจอบ่อย

- **เปลี่ยนชื่อแทนที่จะออกแบบใหม่** การเรียกทีม front-end กับ back-end ว่า "stream-aligned" ไม่ได้เปลี่ยนอะไร ตราบใดที่ feature ยังต้องผ่าน handoff สามครั้ง ให้เปลี่ยนสิ่งที่แต่ละทีมเป็นเจ้าของจนทีม ship change ได้เอง แล้วคอยดู handoff กับ lead time
- **Platform ที่อยู่หลังคิว ticket** พอทีมต้องเปิด ticket แล้วนั่งรอ ตัว X-as-a-Service ก็กลับไปเป็น handoff อีกครั้ง และ service ใหม่ก็ใช้เวลา 9 วันแทนที่จะเป็น 20 นาที ให้ทำงานที่ทำบ่อยเป็น self-service แล้วเก็บ ticket ไว้สำหรับข้อยกเว้นที่นาน ๆ เจอ
- **Collaboration ไม่มีวันจบ** สองทีมที่ "ทำงานใกล้ชิดกัน" โดยไม่มีเป้าหมายและไม่มีจุดจบ จะสร้าง dependency ที่มองไม่เห็นและแบก cognitive load ของกันและกัน ให้ทุก collaboration มีจุดประสงค์, exit criterion และวันที่ แล้วเปลี่ยนผลลัพธ์ของมันให้เป็น service
- **ทีม enabling ที่ไม่ยอมไป** SRE group ที่สุดท้ายมาดูแล on-call ให้ทีม delivery ก็กลับไปเป็นทีม operations อีกครั้ง ให้ตกลงเป้าหมายกันตั้งแต่ต้น แล้วถอยออกมาเมื่อทีมดูแลตัวเองได้
- **ทีมที่ใหญ่เกินไป** ทีม 15 คนจะทำตัวเหมือนสองทีมที่แชร์ backlog เดียวกัน ต้องประสานงานมากขึ้นและไว้ใจกันน้อยลง ให้ทีมมีห้าถึงเก้าคน และแบ่งทีมที่ใหญ่กว่านั้นตาม fracture plane
- **ทีมผู้เชี่ยวชาญไปหมดทุกเรื่อง** การมองทุก component เป็น complicated subsystem ก็คือการพาทีมแบบแบ่ง layer กลับมาในชื่อใหม่ ให้เก็บประเภทนี้ไว้สำหรับความรู้ที่ทีม stream-aligned รับไว้ไม่ได้จริง ๆ
- **Platform หนา ๆ ที่สร้างไว้ก่อนมีคนต้องการ** platform ขนาดใหญ่ที่ไม่มีใครขอจะเพิ่ม cognitive load ของทีมแทนที่จะลด ให้เริ่มแบบบาง ๆ แล้วค่อยขยายตามสิ่งที่ทีม stream-aligned ใช้จริง
- **Reorganise ครั้งเดียวแล้วหยุด** แผนผังทีมเป็นแค่ภาพ ณ ขณะหนึ่ง ควร review interaction และภาระของทีมอย่างสม่ำเสมอ แล้วปรับทีละก้าวเล็ก ๆ
