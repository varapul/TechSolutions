## ปัญหา

ทีม checkout ของ Acme Shop เคย ship แบบที่หลายทีมยังทำกันอยู่ งานกองอยู่บน release branch สี่สัปดาห์ ราว 140 commit แล้วออกไปเป็น release เดียว build server ทำ build ใหม่ให้แต่ละ environment ทำให้ binary ที่ผ่าน QA ใน test environment, ตัวที่ตรวจใน staging และตัวที่ไปถึง production เป็นสาม build ที่ต่างกัน: "it worked in staging" เลยแทบไม่ได้บอกอะไรเกี่ยวกับ production ส่วนตัว release เองก็คือ runbook 40 ขั้นที่ไล่ทำด้วยมือในคืนวันเสาร์ และ fix ด่วนก็ข้ามทั้งหมดนี้ไปเลย

นิสัยแต่ละอย่างทำให้ release ถัดไปเสี่ยงขึ้น batch ใหญ่เปลี่ยนหลายอย่างพร้อมกัน พอมีอะไรพังก็ไม่มีใครรู้ว่า commit ไหนใน 140 ตัวเป็นต้นเหตุ การ build ใหม่ให้แต่ละ environment แปลว่า test ไม่เคยรันกับของที่ ship ออกไปจริง runbook ที่ทำด้วยมือก็พังในแบบใหม่ทุกครั้ง และเพราะการ release มันเจ็บ ทีมก็เลย release น้อยลง ทุก release เลยใหญ่ขึ้นและเจ็บกว่าเดิม (ตัวเลขของ Acme ในหน้านี้เป็นตัวเลขของตัวอย่างนี้เอง ไม่ใช่ผลวิจัย)

## ทำงานยังไง

**Continuous delivery** ทำให้ software พร้อม release อยู่ตลอดเวลา การเอาเวอร์ชันหนึ่งขึ้น production เลยเป็นแค่การตัดสินใจทางธุรกิจตามปกติ ไม่ใช่ project ใหญ่ Jez Humble กับ David Farley วางแนวทางนี้ไว้ใน *Continuous Delivery: Reliable Software Releases through Build, Test, and Deployment Automation* (Addison-Wesley, 2010) เว็บของ Humble คือ continuousdelivery.com อธิบายว่ามันคือความสามารถในการพา change ทุกแบบ ตั้งแต่ feature ใหม่และ configuration ไปจนถึง bug fix และการทดลอง ขึ้น production ได้อย่างปลอดภัย รวดเร็ว และยั่งยืน Martin Fowler มีวิธีเช็กง่าย ๆ (bliki, 2013): business sponsor ขอให้เอาเวอร์ชันปัจจุบันขึ้น live แบบกะทันหันได้ แล้วก็ไม่มีใครตกใจ

กลไกหลักคือ **deployment pipeline** ที่ Humble สืบย้อนไปได้ถึง project ของ ThoughtWorks และเขียนเป็นบทความครั้งแรกร่วมกับ Dan North และ Chris Read สำหรับงาน Agile 2006 ตัว pipeline นี้รับทุก commit ที่เข้า mainline และมันเป็นทางเดียวที่จะไปถึง production:

1. **Commit stage** compile โค้ด, รัน unit test กับ static analysis แล้ว build artifact ที่ deploy ได้ ในที่นี้คือ container image `checkout:1.42.0` แล้ว stage นี้ก็ถูกจูนให้ใช้เวลาแค่ไม่กี่นาที (ที่ Acme คือ 6 นาที) และถ้ามันไม่ผ่าน การแก้ให้ผ่านต้องมาก่อนงานใหม่ทุกอย่าง
2. **Acceptance stage** deploy artifact ตัวนั้นไปที่ environment ที่เหมือน production แล้วรัน automated acceptance test (14 นาที)
3. **Stage ถัด ๆ ไป** เพิ่มความมั่นใจในส่วนที่ได้มาช้ากว่าหรือแพงกว่า: performance test, exploratory testing, staging environment (ที่ Acme ใช้ 5 นาที) แต่ละ stage จะรันอัตโนมัติหรือรอให้คน approve ก่อนก็ได้
4. **Production** คือ stage สุดท้าย เวอร์ชันไหนที่ผ่านทุกอย่างมาแล้วก็ deploy ได้ด้วย action เดียว ส่วนใหญ่ผ่าน deployment strategy อย่าง canary

บทความเรื่อง deployment pipeline ของ Fowler (bliki, 2013) อธิบายลำดับไว้ว่า: stage แรก ๆ เร็วและจับปัญหาได้เกือบหมด ส่วน stage หลัง ๆ ช้ากว่าแต่ละเอียดกว่า feedback เลยมาเร็วโดยไม่ต้องยอมเสียความลึก นอกจากนี้ pipeline ยังทิ้ง audit trail ไว้ด้วยว่า change ไหนรันอยู่ที่ไหน

practice สี่อย่างที่ continuousdelivery.com แนะนำทำให้ stage พวกนี้น่าเชื่อถือ:

- **Build package แค่ครั้งเดียว** promote artifact ตัวเดิมจาก stage หนึ่งไปอีก stage หนึ่ง เพื่อให้ production รันของที่ผ่านการ test มาเป๊ะ ๆ ถ้าใช้ container ก็ให้ deploy image ด้วย digest ของมัน (`checkout@sha256:5d0c9e…`): tag ย้ายไปชี้ image อื่นได้ แต่ digest ทำแบบนั้นไม่ได้ (Kubernetes documentation, *Images*)
- **Deploy แบบเดียวกันไปทุก environment** ด้วย script ชุดเดียวกัน แบบนี้ตัวการ deploy เองก็ผ่านการซ้อมมาหลายรอบแล้วก่อนจะไปถึง production
- **Smoke test ทุก deployment** เพื่อให้ stage ล้มเร็วเมื่อขาด dependency หรือ setting ตัวไหนไป
- **ทำ environment ให้คล้ายกัน**: ใช้ operating system และ middleware เวอร์ชันเดียวกัน configure แบบเดียวกัน จาก configuration ที่เก็บไว้ใน version control

เบื้องหลังมีหลักการห้าข้อของเว็บนี้: สร้างคุณภาพไว้ในงานตั้งแต่แรก, ทำงานเป็น batch เล็ก ๆ, ให้คอมพิวเตอร์ทำงานซ้ำ ๆ คนจะได้ไปแก้ปัญหา, ปรับปรุงต่อเนื่องแบบไม่ลดละ และให้ทุกคนรับผิดชอบ delivery ทั้งหมดร่วมกัน

**Delivery หรือ deployment?** ถ้าเป็น continuous delivery ทุก build ที่เขียวขึ้น production *ได้* และมีคนเป็นคนตัดสินใจว่าเมื่อไหร่ ส่วน **continuous deployment** จะเอาทุก change ที่ผ่าน pipeline ขึ้น production เองโดยอัตโนมัติ บ่อยครั้งก็หลายรอบต่อวัน และต้องมี continuous delivery ก่อนถึงจะทำแบบนี้ได้ (Fowler, 2013) capability guide ของ DORA เสริมว่า continuous deployment เหมาะกับ web service แต่ไม่เหมาะกับ firmware หรือ mobile app ในขณะที่ continuous delivery ใช้ได้กับ software ทุกแบบ รวมถึง firmware และ mainframe และในอุตสาหกรรมที่มีกฎระเบียบคุมด้วย

**Continuous integration** ต้องมาก่อน: ทุกคน merge เข้า mainline อย่างน้อยวันละครั้ง และมี automated build ตรวจทุกการ merge บทความเรื่องนี้ของ Fowler ที่แก้ล่าสุดเมื่อมกราคม 2024 บอกว่าแนวทางของ Extreme Programming ที่ให้ build เสร็จในสิบนาทีนั้นสมเหตุสมผลสำหรับ project ส่วนใหญ่ แล้ว continuous delivery ก็พาเรื่องนี้ต่อไปจนถึงการ deploy ขึ้น production แต่ DORA เตือนว่า CI เป็นแค่ส่วนผสมเดียว: continuous delivery ยังต้องมี test automation และ deployment automation, trunk-based development, version control สำหรับทุกอย่าง, database change management, monitoring และ loosely coupled team ด้วย

**งานวิจัยว่ายังไง** งานวิจัย State of DevOps ของ DORA ที่สรุปไว้ใน continuous delivery guide พบว่าทีมที่ทำเรื่องนี้ได้ดีมี software delivery performance และ availability สูงกว่า, เสียเวลากับ rework และงานที่ไม่ได้วางแผนน้อยกว่า (รายงานปี 2016 และ 2018) และรายงานว่าเจ็บปวดกับการ deploy น้อยกว่าและ burnout น้อยกว่า ข้อค้นพบพวกนี้มาจากงานวิจัยแบบ survey: ให้อ่านว่าเป็นความสัมพันธ์ที่ชัดและเจอซ้ำ ๆ ไม่ใช่การรับประกัน

## ลงมือทำจริงยังไง

1. **เก็บทุกอย่างที่กำหนด release ไว้ใน version control:** โค้ดของ application และ test, Dockerfile, deployment manifest หรือ Helm chart, infrastructure code (เช่น Terraform หรือ OpenTofu) และตัว pipeline definition เอง (GitHub Actions workflow, `.gitlab-ci.yml`, `Jenkinsfile`)
2. **Model process ปัจจุบันเป็น pipeline ก่อน** ตามที่ Fowler แนะนำ แล้วค่อย ๆ ทำขั้นที่ช้าที่สุดและพลาดบ่อยที่สุดให้เป็นอัตโนมัติทีละขั้น Acme เริ่มจาก build กับ runbook 40 ขั้น
3. **Build ครั้งเดียวแล้ว promote ด้วย digest** commit stage push image ตัวเดียวเข้า registry โดยติด tag เป็นเวอร์ชันกับ commit แล้วทุก stage หลังจากนั้นก็ deploy `checkout@sha256:…` เก็บ setting ที่ผูกกับ environment ไว้นอก image ใน configuration ที่แต่ละ environment ใส่ให้เอง
4. **เรียง stage ให้ได้ feedback เร็ว:** check ที่ถูกและเร็วไว้ก่อน ส่วน test suite ที่ช้าไว้ทีหลังและรันแบบ parallel ทำ commit stage ให้เสร็จภายในราวสิบนาที
5. **ให้ pipeline ที่แดงเป็นเรื่องแรกที่ทีมต้องจัดการ** แก้ให้ได้ในไม่กี่นาทีหรือ revert change นั้นไป และห้ามใครวาง commit ใหม่ทับ build ที่พังอยู่ ที่ Acme ตัว revert ของ `8d41e0` เข้าไป 4 นาทีหลังขึ้นสีแดง
6. **แยก deployment ออกจาก release** ship งานที่ยังไม่เสร็จแบบ dark อยู่หลัง feature flag และทำ production stage ให้เป็น canary หรือ blue-green deployment แบบนี้ทุก deployment จะเล็กและย้อนกลับได้ง่าย
7. **ทำให้การขึ้น production เป็น action เดียว** คือปุ่มที่ deploy build ที่เขียวที่เลือกไว้ แล้วตัดสินใจเป็นราย service ว่าจะให้คนกดปุ่ม หรือให้ทุก build ที่เขียวออกไปเอง
8. **วัด flow** ด้วย software delivery metric ของ DORA: change lead time, deployment frequency, change fail rate, failed deployment recovery time และ deployment rework rate ที่มีตั้งแต่ปี 2024 ส่วน service checkout ของ Acme เปลี่ยนจาก release ทุกสี่สัปดาห์ครั้ง มาเป็นราววันละหก deployment ครั้งละหนึ่งถึงสาม commit

## อยู่ตรงไหนใน solution

- [Trunk-based development](../trunk-based-development/) กับ continuous integration ป้อนงานเข้า pipeline: change เล็ก ๆ ที่ merge ทุกวันทำให้ pipeline แต่ละรอบเล็กไปด้วย
- production stage คือ deployment strategy: [canary release](../canary-release/), [blue-green deployment](../blue-green-deployment/) หรือ [rolling update](../rolling-update/) ส่วน [GitOps](../gitops/) ก็เป็นอีกวิธีที่ใช้ทำขั้นนี้: pipeline เขียน digest ใหม่ลง Git แล้ว agent ใน cluster ก็ apply มัน
- [Feature flags](../feature-flags/) แยกการ deploy โค้ดออกจากการ release feature
- [Expand and contract](../expand-and-contract/) ทำให้ schema change ออกไปพร้อม deployment ปกติได้ ระหว่างที่เวอร์ชันเก่ากับเวอร์ชันใหม่รันคู่กันอยู่
- [Immutable infrastructure](../immutable-infrastructure/) เอาหลัก "build ครั้งเดียว" ไปใช้กับ machine image ส่วน infrastructure as code ก็เก็บตัว environment เองไว้ใน version control
- [DORA metrics](../dora-metrics/) บอกว่า pipeline ทำให้ delivery เร็วขึ้นและปลอดภัยขึ้นจริงไหม
- artifact ส่วนใหญ่เป็น container image ([Docker](../docker/)) ที่ deploy ไปบน platform อย่าง [Kubernetes](../kubernetes/)

## ใช้ตอนไหนดี

Continuous delivery คุ้มค่ากับ software ที่ทีมเปลี่ยนบ่อยและ run เอง: web service, API, data pipeline, internal tool แต่ต้องลงทุนจริง: automated test ที่ทีมไว้ใจ, environment ที่เหมือน production, pipeline ที่มีคนดูแล และหลายครั้งก็ต้องเปลี่ยน architecture เพื่อให้ deploy service หนึ่งได้โดยไม่ต้องประสานกับ service อื่น guide ของ DORA อธิบายเป็น J curve: การเปลี่ยนแปลงแบบนี้มักจะยากขึ้นก่อนที่จะดีขึ้น

บางบริบทต้องปรับ:

- **Mobile app, firmware และ software ที่ติดตั้งที่เครื่องลูกค้า** pipeline ก็ยัง build ครั้งเดียวและทำให้ทุก build พร้อม release อยู่ แต่ stage สุดท้ายเป็นการส่งขึ้น store หรือ staged rollout ไปที่อุปกรณ์ ทำให้ continuous deployment ไม่ค่อยเข้ากัน
- **สภาพแวดล้อมที่มีกฎระเบียบคุม** เก็บ control ไว้ แล้ว implement มันใน pipeline: peer review ทุก change เพื่อแยกหน้าที่ (segregation of duties) และมีขั้น approval ที่บันทึกว่าใคร approve อะไรเมื่อไหร่ (เช่น GitHub environments ที่ตั้ง required reviewers หรือ GitLab deployment approvals) งานวิจัยปี 2019 ของ DORA พบว่าการ approve โดย change board ภายนอกมาคู่กับ delivery performance ที่ต่ำกว่า และไม่พบหลักฐานว่ามันลด change fail rate ได้
- **Legacy system ที่มี test น้อย** เริ่มจากทำ build กับ deployment ให้เป็นอัตโนมัติ เพิ่ม test ตรงที่โค้ดเปลี่ยน แล้วค่อย ๆ ขยาย pipeline ทีละ stage
- **ทีมเล็ก** pipeline อาจต้องการแค่ commit stage กับ production deployment ที่มี canary คั่นไว้ก็พอ หลักการคือการพร้อม release เสมอ ไม่ใช่จำนวน stage

มันได้คืนน้อยลงสำหรับ software ที่นาน ๆ จะเปลี่ยน และสำหรับ prototype ที่อยู่ได้ไม่นาน กรณีแบบนี้แค่มี release ที่เขียน script ไว้และเชื่อถือได้ก็อาจพอแล้ว

## กับดักที่เจอบ่อย

- **ทำขั้น deploy ให้เป็นอัตโนมัติแต่ยังทำ batch ใหญ่** script ที่ deploy release 140 commit ก็ยัง deploy batch ใหญ่อยู่ดี DORA เตือนว่าการ deploy บ่อยขึ้นโดยไม่เปลี่ยน process และ architecture มักทำให้ failure rate สูงขึ้นและทำให้ทีมหมดไฟ ให้ทำ batch ให้เล็กลงแทน: merge ทุกวันและ deploy change เล็ก ๆ
- **Pipeline ที่ช้า** พอแต่ละรอบใช้เวลาเป็นชั่วโมงหรือนานกว่านั้น คนก็เลิกรอ แล้วรวมหลาย commit ไว้ในรอบเดียว พอพังก็ไม่มีใครรู้ว่าจะโทษ commit ไหน ทำ commit stage ให้เสร็จภายในราวสิบนาที ย้าย test suite ที่ช้าไปไว้ทีหลังและรันแบบ parallel และเฝ้าดูเวลาของ pipeline เหมือน metric ตัวอื่น ๆ
- **Flaky test** test ที่พังแบบสุ่มสอนให้ทีมกด re-run แล้วเมินสีแดง ไม่นาน failure จริงก็โดนเมินไปด้วย (Fowler, *Eradicating Non-Determinism in Tests*, 2011) กัก flaky test ไว้ทันที แล้วค่อยแก้หรือลบทิ้ง
- **Build ใหม่ให้แต่ละ environment** การ build ใหม่อาจได้ dependency หรือ setting ที่ต่างไป ให้ build ครั้งเดียวแล้ว promote digest
- **Environment ที่สร้างด้วยมือ** การ patch ด้วยมือทำให้ staging ค่อย ๆ เพี้ยนไปจาก production จน "it worked in staging" ไม่มีความหมายอะไรเลย ให้สร้างทุก environment จากโค้ด และใช้วิธีแทนที่ใหม่แทนการ patch
- **ประตูหลังสำหรับ hotfix** ถ้าเรื่องด่วนข้าม pipeline ได้ change ที่เสี่ยงที่สุดก็จะได้ test น้อยที่สุด DORA ตั้งเป้าให้ใช้ process ปกติกับ change ฉุกเฉินด้วย ทำ pipeline ให้เร็วพอสำหรับเรื่องนี้
- **Schema change ที่ผูกกับ code change** ถ้าโค้ดกับ schema ต้องเปลี่ยนไปพร้อมกัน เวอร์ชันเก่ากับเวอร์ชันใหม่ก็รันคู่กันไม่ได้ แล้ว canary กับ rollback ก็จะพัง ให้ใช้ expand and contract
- **Approval ในรูปแบบการประชุม** change board รายสัปดาห์ทำให้ทุก change กลายเป็นส่วนหนึ่งของ batch ให้บันทึก approval เป็นขั้นใน pipeline แทน
- **มีเครื่องมือแต่ไม่มี practice** ติดตั้ง CI/CD product ไม่ได้ทำให้ deliver แบบต่อเนื่องได้เอง: DORA ชี้ว่าเครื่องมือสมัยใหม่ที่ไม่มี technical practice และการเปลี่ยน process ประกอบ ไม่ได้ให้ประโยชน์อย่างที่คาดไว้
