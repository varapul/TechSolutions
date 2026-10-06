## ปัญหา

SaaS product ส่วนใหญ่เริ่มจาก deployment เดียว: app server ชุดเดียว ฐานข้อมูลตัวเดียว storage account เดียว และ cache ตัวเดียวใน region เดียว ที่ tenant ทุกรายใช้ร่วมกัน วิธีนี้ใช้ได้จนกว่าจะเจอเรื่องใดเรื่องหนึ่งต่อไปนี้:

- **limit ที่จะขยับขึ้นง่าย ๆ ไม่ได้** การ scale up ไปหยุดที่ tier ฐานข้อมูลที่ใหญ่ที่สุดที่ provider ขาย การ scale out ไปชนกับ quota เช่น vCPU quota ของ Azure subscription ใน region หนึ่ง หรือ AWS service quota (ที่หลายตัวมีผลต่อ account และต่อ Region) และชน service limit เรื่อง connection, host name หรือ socket บาง component ก็ช้าลงหรือแพงขึ้นเกินสัดส่วนไปนานก่อนจะถึงเพดานจริง ๆ
- **tenant ที่เกะกะกันเอง** batch job ของ tenant รายใหญ่รายเดียว (ใน diagram คือการรัน payroll สิ้นเดือน) ใช้ฐานข้อมูลที่แชร์กันจนหมด แล้ว tenant รายอื่นทุกรายก็ช้าลง: นี่คือปัญหา *noisy neighbour* ลูกค้ารายใหญ่หรือลูกค้าที่อยู่ใต้กฎระเบียบบางรายก็อยากได้ infrastructure ที่ไม่มีใครอื่นใช้ด้วย
- **ข้อมูลที่ต้องอยู่ในที่ที่กำหนด** ลูกค้าใน EU อาจกำหนดให้ข้อมูลของตัวเองต้องอยู่ใน EU และอีกรายต้องการ latency ต่ำใน Australia ส่วน deployment ใน region เดียวของ US ไม่ตอบโจทย์ทั้งสองราย

นอกจากนั้น ทุก release การเปลี่ยน configuration และ migration ที่พลาด ก็ไปถึง tenant ทุกรายในเวลาเดียวกัน

## ทำงานยังไง

นิยาม stack ทั้งชุดเป็นโค้ดไว้ครั้งเดียว แล้ว deploy หลาย ๆ รอบ Microsoft เรียกแต่ละสำเนาว่า **stamp** ชื่ออื่นก็มี *scale unit*, *service unit* และ *cell* ตัว stamp ครบในตัว มี app instance, ฐานข้อมูล, storage, cache และ queue ของตัวเอง และไม่แชร์ข้อมูลหรือ infrastructure กับ stamp ไหนเลย แต่ละ stamp ดูแล tenant ชุดหนึ่งและเก็บข้อมูลของพวกเขา stamp เลยแบ่ง shard ข้อมูลตาม tenant ไปในตัว โดยไม่ต้องมี sharding layer แยกต่างหาก ส่วน region หนึ่งจะมี stamp เดียวหรือหลายตัวก็ได้

layer ระดับ global เล็ก ๆ ครอบ stamp ไว้:

- **tenant catalog** (Microsoft เรียกว่า tenant list database ด้วย) จดไว้ว่า tenant แต่ละรายอยู่ stamp ไหน region ไหน และอะไรก็ตามที่งาน operation ต้องใช้ เช่น version ที่ stamp นั้นรันอยู่
- **router** ส่งแต่ละ request ไปที่ stamp ของ tenant มันหา tenant จาก host name (`contoso.hr.example`), claim ใน token, API key หรือ header แล้วเปิดดูใน catalog จากนั้นก็ forward request ไป
- **control plane** onboard tenant (เลือก stamp, สร้าง resource ของ tenant ที่นั่น, เขียน entry ใน catalog), deploy stamp ใหม่เมื่อ capacity ใกล้หมด, rollout release และย้าย tenant
- service ที่โดยธรรมชาติครอบคลุมทุก tenant อย่าง **sign-in** (identity provider) และ **billing** ก็มักอยู่ระดับ global ด้วย

การโตหมายถึงการเพิ่ม stamp ไม่ใช่การขยาย deployment เดียว พอ stamp ใน region หนึ่งใกล้เต็ม control plane ก็ deploy stamp ใหม่จาก template เดียวกัน แล้วส่ง tenant รายถัดไปไปที่นั่น เพราะ stamp ไม่รู้จักกัน capacity เลยโตแทบเป็นเส้นตรงตามจำนวน stamp

### อะไรอยู่ใน stamp และอะไรอยู่ระดับ global

ใส่ทุกอย่างที่ request ของ tenant ต้องใช้ไว้ใน stamp: compute, data store, cache, queue, background worker และ monitoring ของ stamp เอง ยิ่ง stamp ครบเท่าไร ก็ยิ่งกัน tenant ของมันออกจากของคนอื่นได้ดี feature ที่ต้องใช้ข้อมูลของทุก tenant (report ข้ามทุก tenant, global search, เครื่องมือ support ที่หาว่า tenant อยู่ stamp ไหน) จะทำงานได้ดีกว่าถ้าแต่ละ stamp publish สิ่งที่ feature ต้องใช้ไปที่ central store อย่าง data warehouse แทนที่จะ query ทุก stamp

ทำ global layer ให้เล็ก เพราะมันเป็นของที่แชร์กันอีกแล้ว: router หรือ catalog ล่มครั้งเดียวก็กระทบทุก tenant ไม่ว่าจะมีกี่ stamp

- **ทำส่วนที่เป็น global ให้ available อย่างน้อยเท่า stamp ตัวไหน ๆ** รัน router ในหลาย region ดีที่สุดคือทุก region ที่มี stamp อยู่ หลัง global entry point ที่มี health probe และ replicate catalog ไปไว้ทุก region นั้น ตัวอย่างอ้างอิงของ Microsoft ก็ทำแบบนี้เป๊ะ
- **cache catalog ไว้** stamp ของ tenant แทบไม่เปลี่ยน ทำให้ router เก็บ mapping ไว้ใน memory ได้ หรือคำนวณครั้งเดียวต่อ session แล้วเก็บไว้ใน cookie และ route ต่อจากสำเนานั้นได้ตอนที่ store ของ catalog ใช้ไม่ได้
- **ให้ stamp รันได้โดยไม่ต้องมี control plane** ถ้า control plane ล่ม ก็ควรแค่ทำให้ onboarding การย้าย และการ deploy หยุด ไม่ใช่ทำให้ traffic หยุด คำแนะนำของ Microsoft เรื่อง control plane ระบุสิ่งที่ outage แบบนี้ขวางไว้: การ onboard tenant ใหม่, การจัดการ tenant ที่มีอยู่, metering และ billing และการรับมือกับ security incident
- **serve static content ที่ใช้ร่วมกันแค่ครั้งเดียว** single-page front end ที่เหมือนกันทุก tenant มาจาก origin เดียวผ่าน CDN ได้ แทนที่จะมาจากทุก stamp

### ตั้งขนาด stamp

stamp มี capacity ที่ตายตัวและ test แล้ว ให้กำหนดเป็นหน่วยที่ใช้วาง tenant ได้: จำนวน tenant สูงสุด (50 ใน diagram) หรือถ้า tenant ขนาดต่างกันมาก ก็ใช้ load budget เช่น request ต่อวินาที จำนวนผู้ใช้ หรือ storage จากนั้น load test stamp เต็มชุดจนประสิทธิภาพเริ่มตก แล้วตั้ง placement limit ให้ต่ำกว่าจุดนั้นโดยเผื่อ headroom ไว้ เพื่อให้ tenant เดิมโตต่อได้ และย้าย tenant เข้ามาได้ระหว่างเกิด incident วัด capacity ที่ใช้ไปและที่ว่างของแต่ละ stamp อยู่ตลอด และ deploy stamp ถัดไปก่อนที่ stamp สุดท้ายจะเต็ม เพราะการสร้าง stamp ใช้เวลา

ขนาดเป็นการประนีประนอม ใหญ่พอที่จะรับ tenant รายใหญ่ที่สุดที่อยู่ใน stamp ร่วมกับคนอื่น และกระจาย overhead ตายตัวของแต่ละ stamp ไปบน tenant ได้มากพอ เล็กพอที่จะอยู่ใต้ quota ทุกตัวแบบสบาย ๆ ให้ load test ได้ที่ขนาดเต็ม และจำกัดจำนวน tenant ที่ incident ครั้งเดียวหรือ release พลาดครั้งเดียวจะไปถึง

### วาง tenant

ขั้นตอน onboarding ตัดสินว่า tenant ใหม่แต่ละรายจะไปอยู่ไหน จาก requirement ของ tenant และ capacity ที่ว่างของแต่ละ stamp:

- **Region** tenant ที่ข้อมูลต้องอยู่ใน EU ไปได้แค่ stamp ใน EU และโดยทั่วไป tenant จะไปอยู่ stamp ที่ใกล้ผู้ใช้ของตัวเอง
- **ขนาดและ tier** tenant เล็ก ๆ แชร์ stamp กัน โดยเติม stamp หนึ่งให้เต็มก่อนค่อยเริ่มตัวถัดไป Microsoft เรียกแบบนี้ว่า *bin packing* ส่วน tenant ที่ใหญ่มาก หรือที่จ่ายเงินเพื่อให้แยกขาด จะได้ **dedicated stamp** ที่ deploy จาก template เดียวกัน
- **จังหวะการ update** tenant ที่อยากได้ feature ใหม่ก่อนใครก็แชร์ stamp ที่ได้ release ก่อนได้ ส่วนรายที่ระมัดระวังก็อยู่บน stamp ที่ update ทีหลัง
- **รูปแบบการใช้งาน** tenant ที่ peak ตรงกันควรกระจายไปคนละ stamp ส่วน tenant ที่กลายเป็นตัวกินส่วนใหญ่ของ stamp ก็เป็นตัวเลือกที่ควรย้าย นี่เป็นหนึ่งในทางแก้ที่ antipattern *Noisy Neighbor* ของ Microsoft ระบุไว้ คู่กับการ throttle tenant ที่ใช้หนัก ([Rate Limiting](../rate-limiting/)) และการเพิ่ม stamp

### route request ไปที่ stamp

router แปลงอะไรบางอย่างใน request ให้เป็น tenant แล้วแปลง tenant ให้เป็น stamp ลองดูวิธีสร้างด้วย service ที่มีในวันนี้:

- **DNS record ต่อ tenant หรือต่อ stamp** tenant แต่ละรายได้ host name ของตัวเอง ที่ record ชี้ไปที่ stamp ของมัน เก็บไว้ใน DNS service อย่าง Amazon Route 53 หรือ Azure DNS ทาง whitepaper ของ AWS เรื่อง cell-based architecture อธิบาย setup แบบนี้ด้วย Route 53 ส่วน stamp pattern ของ Microsoft แสดงแบบต่อ stamp (`unit1.eu.myapi.contoso.com`) ที่ client ต้องรับผิดชอบเรียก stamp ให้ถูกตัวเอง การย้าย tenant คือการเปลี่ยน record ของมัน และ client จะรู้ก็ต่อเมื่อคำตอบที่ cache ไว้หมดอายุ (TTL ของ record)
- **global front door** Azure Front Door จับคู่แต่ละ request เข้ากับ route ตาม protocol, domain และ path แล้วส่งไปที่ origin group ของ route นั้น และ rule set ก็ override origin group ได้ ถ้ามี origin group หนึ่งกลุ่มต่อ stamp การมี route ต่อ tenant domain ใช้ได้กับ tenant จำนวนไม่มาก แต่ตอนนี้ profile หนึ่งมี custom domain ได้ 100 ตัวใน tier Standard และ 500 ตัวใน Premium ถ้ามี tenant เยอะ การใช้ wildcard domain (`*.hr.example`) กับการ lookup ที่อยู่หลัง Front Door จะ scale ได้ดีกว่า
- **gateway ที่เปิดดู catalog** reverse proxy หรือ [API gateway](../api-gateway/) ในแต่ละ region อ่านว่าเป็น tenant ไหน หา stamp ของมัน แล้ว forward request หรือตอบด้วย redirect (HTTP 302) ไปที่ address ของ stamp เอง ในตัวอย่างอ้างอิงของ Microsoft ตัว Azure API Management ในแต่ละ region ตั้ง back-end URL จากการ lookup tenant-to-stamp ใน Azure Cosmos DB ที่ replicate ไปทุก region และ Azure Front Door ส่ง client แต่ละตัวไปที่ gateway ที่ healthy และใกล้ที่สุด
- **anycast entry point** AWS Global Accelerator ให้แอปพลิเคชันมี static anycast IP address และ standard accelerator จะส่ง client แต่ละตัวไปที่ endpoint ใน Region ที่ healthy และใกล้ที่สุด มันไม่รู้อะไรเรื่อง tenant เลย เลยใช้วางหน้า regional router (หรือ stamp เดียว) แทนที่จะทำ mapping เอง ส่วน custom routing accelerator ของมันจะ map ผู้ใช้ไปที่ EC2 instance และ port ที่ระบุ สำหรับแอปพลิเคชันที่ตัดสินเรื่องนั้นเอง

ภายในแต่ละ stamp จะมี [load balancer](../load-balancing/) ธรรมดาคอยกระจาย request ไปที่ instance ของ stamp นั้น และไม่ว่าใครจะเป็นคน route ตัว stamp ก็ยังต้องเช็กว่าผู้เรียกมีสิทธิ์ทำแทน tenant นั้นจริง: host name บอกแค่ว่า request นี้เป็นของ tenant ไหน

### deploy stamp จากโค้ด

stamp จะเหมือนกันอยู่ได้ก็ต่อเมื่อไม่มีใครสร้างหรือแก้มันด้วยมือ อธิบาย stamp เป็น infrastructure-as-code module เดียว (Bicep และ Terraform คือตัวอย่างของ Microsoft ส่วน AWS CloudFormation และ AWS CDK ก็ใช้ได้แบบเดียวกัน) โดยมีชื่อ, region และขนาดของ stamp เป็น parameter แล้วสร้าง, update และแทนที่ stamp ผ่าน pipeline เท่านั้น แบบใน [Immutable Infrastructure](../immutable-infrastructure/) ส่วน [GitOps](../gitops/) ไปไกลกว่านั้น: รายการ stamp และ version ที่แต่ละตัวควรรันอยู่ใน Git และมี agent คอย reconcile ทุก stamp ให้ตรงกัน เมื่อจำนวน stamp เพิ่มขึ้น ให้เช็ก configuration drift ด้วย policy as code อย่าง Azure Policy ทาง Microsoft แนะนำให้ deploy อย่างน้อยสอง stamp เพราะถ้ามีแค่ตัวเดียว โค้ดและ configuration จะค่อย ๆ สมมติเอาเองแบบเงียบ ๆ ว่ามีแค่ตัวเดียว

### ทยอย rollout เป็น ring

stamp ทำให้ทุก release มีหน่วยของการ expose ที่เป็นธรรมชาติ จัดกลุ่ม stamp เป็น **deployment ring** แล้ว release ทีละ ring: เริ่มจาก stamp ภายในที่มี test tenant ของคุณเองก่อน แล้วไป ring เล็ก ๆ แล้วไปที่เหลือ โดยหยุดหลังแต่ละ ring เพื่อดู error rate และ latency ก่อนไปต่อ คำแนะนำเรื่อง multitenant ของ Microsoft ตั้งชื่อ ring ที่ใช้กันบ่อยไว้สามแบบ: *canary* (test tenant ของคุณและลูกค้าที่อยากได้ update เร็วที่สุด), *early adopter* และ *users* ส่วนภายใน stamp การ update เองก็ยังทำเป็น [rolling update](../rolling-update/) หรือ [canary release](../canary-release/) ได้

ระหว่างที่ rollout อยู่ stamp แต่ละตัวจะรัน version ต่างกัน จด version ของแต่ละ stamp ไว้ใน catalog หรือ control plane เพื่อให้ทีม support รู้ว่า tenant รันอะไรอยู่ เพื่อให้ hotfix ไปถึงทุก version ที่ยังอยู่บน production และเพื่อให้ย้าย tenant เฉพาะระหว่าง stamp ที่ version เข้ากันได้ ให้มีจำนวน version บน production น้อย ๆ

### ย้าย tenant ระหว่าง stamp

tenant ย้ายเพื่อ rebalance load, เพื่ออัปเกรดไปใช้ dedicated stamp, เพื่อเปลี่ยน region (หลังการซื้อกิจการหรือกฎหมายเปลี่ยน) หรือเพราะ stamp กำลังจะถูกปลด ข้อมูลของ tenant อยู่ใน stamp ของมัน การย้ายทุกครั้งเลยเป็น data migration ปกติมีสามขั้น:

1. **ก็อป** ข้อมูลของ tenant ไปที่ stamp ใหม่เป็นสำเนาที่ยังไม่มีอะไรอ่าน และ sync ให้ตรงกันอยู่เรื่อย ๆ ระหว่างที่ tenant ยังทำงานต่อ เช่นด้วย [change data capture](../change-data-capture/)
2. **สลับ** entry ใน catalog ของ tenant ไปที่ stamp ใหม่หลังไล่ข้อมูลรอบสุดท้ายเสร็จ เพื่อให้ router ส่ง request ของมันไปที่นั่น ถ้า route ด้วย DNS นี่คือการเปลี่ยน record ที่จะมีผลเมื่อ cache หมดอายุ ถ้าใช้การ lookup catalog ก็มีผลทันทีที่ router เห็น entry ใหม่
3. **drain** stamp เก่า: ปล่อยให้ request ที่ค้างอยู่ทำจนเสร็จ redirect request ที่หลงมาทีหลัง แล้วลบสำเนาเก่า

มันเป็นปัญหาเดียวกับการย้ายข้อมูลระหว่าง shard ([Sharding](../sharding/)) และจังหวะที่ต้องระวังคือตอนสลับ สร้างเครื่องมือและซ้อมไว้แต่เนิ่น ๆ วันที่ tenant รายหนึ่งโตเกิน stamp ขึ้นมากะทันหัน ไม่ใช่วันที่เหมาะจะมานั่งเขียนมัน

### monitor ราย stamp และราย tenant

ติด tag stamp และ tenant ให้ทุก metric, log line และ trace แล้วตั้ง alert ราย stamp: ค่าเฉลี่ยของทุก stamp จะซ่อน stamp ที่ล่มอยู่ ติดตาม capacity ราย stamp (จำนวน tenant ที่วางไว้, load เทียบกับ budget, การใช้ quota) และส่วนแบ่งของแต่ละ tenant ใน stamp ของมัน นี่แหละคือวิธีที่ noisy neighbour จะโผล่ให้เห็นก่อนจะทำร้ายใคร objective ราย stamp หรือราย tier ของ tenant ([SLOs & Error Budgets](../slo-error-budgets/)) ทำให้เห็นชัดเมื่อ stamp หนึ่งกำลังเผา error budget ในขณะที่ตัวอื่นยังปกติ

## ใช้ตอนไหนดี

- **service แบบ multitenant ที่ใกล้ชน limit ของ deployment เดียว:** tier ฐานข้อมูลที่ใหญ่ที่สุด, quota ของ subscription หรือ account, limit ของ connection หรือ host name
- **tenant ที่มี requirement เรื่อง data residency หรือ latency** ใน region เฉพาะ
- **tenant ที่ต้องแยกขาด:** dedicated stamp สำหรับลูกค้ารายใหญ่หรือลูกค้าที่อยู่ใต้กฎระเบียบ หรือกัน tenant ที่ใช้หนักออกจากรายอื่น
- **จังหวะการ update ที่ต่างกัน** สำหรับ tenant แต่ละกลุ่ม หรือ release ที่ควรไปถึง tenant ไม่กี่รายก่อน
- **จำกัดจำนวน tenant ที่ความล้มเหลวครั้งเดียวจะไปถึง** และนี่คือเป้าหมายหลักของ [Cell-Based Architecture](../cell-based-architecture/)

ตอนไหนไม่ควรใช้:

- **region เดียว tenant ไม่กี่ราย และยังไม่เห็น limit** ทุก stamp คืออีกหนึ่ง deployment ที่ต้อง patch, monitor, ทำให้เหมือนกัน และจ่ายเงิน บวกกับ router, catalog และ control plane จนกว่าจะเจอ limit หรือ requirement จริง ให้ scale deployment เดียวขึ้นหรือออกไปก่อน
- **มีแค่ component เดียวที่ชน limit** ให้ scale component นั้นแทน เช่นทำ sharding ฐานข้อมูล
- **ทุก instance ต้อง serve ผู้ใช้ได้ทุกคน** จากข้อมูลชุดเดียวกัน ให้ replicate ข้อมูลไปทุก instance แทน แบบที่ Geode pattern ของ Azure ทำ
- **content เป็น static** ให้ serve จาก CDN

## ได้อะไร เสียอะไร

- **ต้นทุน** ทุก stamp มี overhead ตายตัว (ฐานข้อมูลขนาดขั้นต่ำ, load balancer, cache, monitoring) และแต่ละตัวเก็บ spare capacity ของตัวเอง ทำให้ utilisation รวมต่ำกว่า pool เดียวที่แชร์กัน Microsoft บอกว่าต้นทุนที่เพิ่มขึ้นนั้นสูงมาก stamp ที่เล็กลงทำให้ overhead ต่อ tenant สูงขึ้น ส่วน stamp ที่ใหญ่ขึ้นก็ทำให้มี tenant อยู่หลังแต่ละความล้มเหลวมากขึ้น
- **งาน operation ทวีคูณ** สิบ stamp คือสิบ deployment ที่ต้อง rollout, เฝ้าดู, patch, ต่ออายุ certificate และคุมให้อยู่ใน quota ถ้าไม่มี automation เต็มรูปแบบ มันจะค่อย ๆ ต่างกันไปเรื่อย ๆ
- **global layer เป็นของที่แชร์กัน** router, catalog และ sign-in ยังล้มทุก tenant ได้ เลยต้อง redundant มากกว่า stamp ตัวไหน ๆ
- **การย้าย tenant คือ migration** ไม่เคยเป็นแค่การเปลี่ยน configuration
- **feature ข้าม tenant ทำยากขึ้น** อะไรที่เคยเป็น query เดียวบนฐานข้อมูลเดียว จะกลายเป็นการ fan out ไปทุก stamp หรือ central store แยกต่างหาก
- **stamp ไม่ failover เอง** stamp อยู่ใน region เดียว ถ้า region นั้นล่ม tenant ของมันก็ต้องรอ region กลับมา หรือรอให้คุณ restore พวกเขาที่อื่น ให้ backup ทุก stamp, วางแผนกู้คืนของมัน ([Disaster Recovery Strategies](../disaster-recovery-strategies/)) และพิจารณาการวางแบบ geo-redundant ให้ tenant ที่สำคัญ
- **version แตกต่างกันระหว่าง rollout** และทุกเครื่องมือที่แตะมากกว่าหนึ่ง stamp ต้องรับมือกับเรื่องนี้ได้

## ข้อควรรู้ตอนลงมือทำ

**เริ่มจากของที่มีอยู่** ให้ถือ deployment เดิมเป็น stamp 1 วาง catalog กับ router ไว้ข้างหน้า แล้ว deploy stamp ที่สองตั้งแต่เนิ่น ๆ ถึงตอนแรกจะมีแค่ tenant ภายในก็ตาม stamp นั้นจะกลายเป็น ring 0 ของทุก rollout

**มันเกี่ยวกับ pattern ใกล้เคียงยังไง:**

- [Cell-Based Architecture](../cell-based-architecture/) ใช้กลไกเดียวกัน: สำเนาของ stack ทั้งชุดที่เหมือนกันและเป็นอิสระต่อกัน แต่ละชุดดูแลลูกค้ากลุ่มย่อยอยู่หลัง router บาง ๆ และ Microsoft ก็นับ *cell* เป็นหนึ่งในชื่ออื่นของ stamp แต่จุดเน้นต่างกัน ปกติคนเริ่มใช้ stamp เพราะขีดจำกัดด้าน scale การวาง tenant (region, data residency, dedicated stamp) และจังหวะการ update ส่วน cell เริ่มใช้เพื่อจำกัด blast radius ของความล้มเหลว และสุดท้ายดีไซน์เดียวก็มักตอบได้ทั้งสองเป้าหมาย ส่วน whitepaper เรื่อง cell-based ของ AWS ก็เป็นคู่มือประกอบที่มีประโยชน์เรื่อง routing, sizing และ migration
- **Geode** (Geode pattern ของ Azure) เลือกทางตรงข้ามเรื่องข้อมูล: geode ทุกตัว serve ผู้ใช้คนไหนก็ได้ จาก data store ที่ replicate ไปทุกตัว ส่วน stamp serve แค่ tenant ของตัวเอง และไม่ replicate อะไรระหว่างกัน Microsoft บอกว่าทั้งสองแบบใช้ร่วมกันได้: global routing layer ที่อยู่หน้า stamp ก็สร้างเป็น geode ได้
- [Multi-Region Active-Active](../multi-region-active-active/) รันแอปพลิเคชันเดียวในหลาย region บนข้อมูลที่ replicate กัน ทำให้ region ไหนก็ serve ผู้ใช้ได้ทุกคน และ traffic ก็ย้ายออกจาก region ที่พังได้ ส่วน stamp ปัก tenant แต่ละรายไว้กับ region เดียวและไม่ replicate อะไรเลย ทำให้เรื่อง data residency ง่าย แต่ปล่อยเรื่อง regional failover ให้เป็นหน้าที่ของคุณ
- [Sharding](../sharding/) แบ่งแค่ข้อมูลและเก็บ application tier ไว้ชุดเดียวที่แชร์กัน ส่วน stamp แบ่งทุกอย่าง ข้อมูลเลยถูก shard ตาม tenant ไปในตัว และ stamp เดียวก็ยัง shard ข้างในได้อีก
- [Autoscaling](../autoscaling/) ทำงานภายใน stamp ได้จนถึงขนาดสูงสุดที่ test ไว้ของ stamp เกินจากนั้นก็เพิ่ม stamp
