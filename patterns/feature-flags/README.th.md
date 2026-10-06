## ปัญหา

ถ้าไม่มี flag การ deploy โค้ดกับการเปิด feature ให้คนเห็นก็คือเหตุการณ์เดียวกัน งานที่ยังไม่เสร็จก็ต้องรออยู่บน branch ที่อยู่นาน ๆ จนห่างจาก mainline ไปเรื่อย ๆ หรือไม่ก็ไปถึง user ทุกคนทันทีที่ deploy ถ้า feature ทำตัวผิดปกติใน production ทางกลับมีทางเดียวคือ deploy อีกรอบ เร็วสุดก็ใช้เวลาหลายนาที และยังพาการเปลี่ยนแปลงอื่นที่ไม่เกี่ยวกันทั้งหมดใน build นั้นออกไปด้วย แล้วก็ไม่มีทางให้ staff, ลูกค้ารายเดียว หรือ user 10% เห็น feature ก่อนเลย

## ทำงานยังไง

feature flag (หรือ feature toggle) คือจุดตัดสินใจในโค้ดที่คำตอบมาจาก configuration ที่เปลี่ยนได้ระหว่างที่โปรแกรมรันอยู่: `if (flags.enabled("new-checkout", user))` รัน checkout แบบใหม่ ส่วน `else` รันแบบเดิม

- **Build เดียว มีทั้งสองเส้นทาง** โค้ดใหม่ ship ไปถึงทุก instance โดยอยู่หลัง flag ที่ **off**: มันถูก *deploy แบบ dark* การ deploy เลยกลายเป็นเรื่องทางเทคนิค ส่วนการ release ก็กลายเป็นการตัดสินใจแยกต่างหากที่ทำทีหลังได้ และทำแยกตาม user ได้
- **Rule อยู่ใน flag service แต่การตัดสินใจทำในเครื่อง** control plane เก็บ state ของแต่ละ flag, targeting rule (staff, tenant รายเดียว, ประเทศ) และ percentage rollout ของมัน ส่วน server-side SDK ในทุก instance เก็บสำเนา rule พวกนั้นไว้ใน memory แล้ว evaluate ใน process เลย การตรวจ flag เลยไม่ต้องเสีย network call การเปลี่ยนแปลงไปถึง SDK ผ่าน streaming connection หรือด้วยการ poll
- **เปอร์เซ็นต์เป็นแบบ deterministic** SDK เอา flag key กับ user ID มา hash รวมกันเป็น bucket แล้วเทียบกับเปอร์เซ็นต์ของ rollout แบบนี้ user คนเดิมจะได้คำตอบเดิมในทุก instance และทุก request, แต่ละ flag แบ่ง user ไม่เหมือนกัน และการเพิ่มเปอร์เซ็นต์ก็มีแต่จะเพิ่ม user เข้าไป diagram ใช้ 100 bucket ส่วนแต่ละ product ก็ใช้ hash และความละเอียดต่างกันไป
- **ปิดได้ด้วย switch เดียว** การปิด flag ไปถึงทุก instance ภายในไม่กี่วินาที (ช้าสุดก็หนึ่งรอบ polling) โดยไม่ต้อง deploy ส่วนถ้าติดต่อ flag service ไม่ได้ SDK ก็ evaluate ด้วย rule ชุดล่าสุดที่ได้มาต่อไป ส่วน SDK ที่ไม่เคยได้อะไรมาเลยจะคืนค่า default ที่ส่งไว้ในโค้ด ค่า default นั้นเลยต้องเป็นเส้นทางที่ปลอดภัย
- **ตอนจบต้องลบ flag ออก** พอถึง 100% ตัวตรวจ flag กับเส้นทางเดิมก็ถูกลบออกจากโค้ด แล้ว flag ก็ถูก archive

ใน [canary release](../canary-release/) หรือ [blue-green deployment](../blue-green-deployment/) router จะย้าย traffic ระหว่างสองเวอร์ชันที่ deploy ไว้ ส่วนตรงนี้มีเวอร์ชันเดียว และการเลือกเกิดในโค้ด แยกตาม user ตอน runtime สองแบบนี้ใช้ร่วมกันได้ดี: rollout ตัว *build* ด้วย canary แล้วค่อย release ตัว *feature* ด้วย flag

### Flag สี่แบบ

Pete Hodgson แบ่ง flag (เขาเรียกว่า toggle) ตามสองแกน คือ flag อยู่นานแค่ไหน และการตัดสินใจของมันเปลี่ยนแปลงได้แค่ไหน แล้วให้เหตุผลว่าแต่ละกลุ่มต้องจัดการต่างกัน แม้จะใช้เครื่องมือตัวเดียวกันก็ตาม

| แบบ | มีไว้ทำอะไร | อยู่นานแค่ไหน | การตัดสินใจ |
|---|---|---|---|
| **Release** | ซ่อนโค้ดที่ยังไม่เสร็จหรือยังไม่ประกาศที่อยู่บน mainline แล้ว | ไม่กี่วันถึงไม่กี่สัปดาห์ | ส่วนใหญ่คงที่: ทุกคนได้เหมือนกันจนกว่าจะเริ่ม rollout |
| **Experiment** | A/B test และ multivariate test | นานเท่าที่ test ต้องการ: หลายชั่วโมงถึงหลายสัปดาห์ | ต่อ request ตาม cohort และไม่เปลี่ยนระหว่างที่ test รันอยู่ |
| **Ops** | kill switch และ load shedding | ส่วนใหญ่สั้น แต่ kill switch บางตัวอยู่เป็นปี | ต้องเปลี่ยนได้ภายในไม่กี่วินาที โดยไม่ต้อง deploy |
| **Permission** | feature สำหรับ user บางกลุ่มเท่านั้น: แพ็กเกจ, โปรแกรม beta, user ภายใน | หลายปี | ต่อ request ตาม user |

วิธีจัดการตามมาจากตารางนี้: release flag ควรมีวันหมดอายุ และเป็นแค่ `if` ธรรมดาก็ได้ permission flag อยู่เป็นปีเลยควรมี abstraction ที่ดีในโค้ด ส่วน ops flag ต้องให้คนที่ on-call อยู่เปลี่ยนได้ภายในไม่กี่วินาที

flag ใน diagram เป็น release flag ที่ยืมวิธี rollout มาจากแบบอื่น "staff ก่อน" คือ rule แบบ permission, เปอร์เซ็นต์คือ canary cohort ส่วนปุ่มปิดก็ทำหน้าที่เป็น kill switch ตลอดช่วง rollout

## ใช้ตอนไหนดี

- **Trunk-based development และ continuous delivery** งานที่ยังไม่เสร็จ merge เข้า mainline ได้ทุกวันโดยอยู่หลัง flag แทนที่จะรอบน branch ที่อยู่นาน ๆ และ mainline ก็ยังพร้อม release อยู่เสมอ
- **ทยอยปล่อยการเปลี่ยนแปลงที่เสี่ยง:** staff ก่อน แล้วค่อย user ไม่กี่เปอร์เซ็นต์ โดยเฝ้าดู metric ทุกขั้น
- **วันเปิดตัวที่ไม่ใช่วัน deploy:** แคมเปญการตลาด, ลูกค้า early access, ทีละ region
- **Switch สำหรับงาน operation:** ปิด feature ที่แพงหรือไม่สำคัญตอนโหลดหนัก เหมือนเป็น [circuit breaker](../circuit-breaker/) แบบ manual
- **Experiment** พร้อมกับการวัดผลที่มันต้องใช้ (ดูข้อควรรู้ตอนลงมือทำ)

**ตอนไหนไม่ควรใช้** คำแนะนำของ Martin Fowler คือ release flag ควรเป็นทางเลือกสุดท้าย ให้ลองแบ่ง feature เป็นชิ้นเล็ก ๆ ที่ release ได้ตามสภาพก่อน หรือสร้างทุกอย่างยกเว้นทางเข้าที่ user เห็น แล้วค่อยเพิ่มตัวนั้นเป็นอย่างสุดท้าย flag ยังเป็นเครื่องมือที่ผิดถ้าเอามาใช้แทนการออกแบบ: `if` ถาวรหนึ่งตัวต่อลูกค้าคือ configuration model หรือ entitlement model ที่ไม่มีใครออกแบบไว้ และอย่าให้ flag ซ่อน migration ที่ไม่มีใครทำให้เสร็จ เพราะเส้นทางเก่า, schema เก่า และ test เก่าก็จะยังอยู่ตราบที่ flag ยังอยู่

## ได้อะไร เสียอะไร

- **ทุก flag ทำให้ code path เพิ่มเป็นสองเท่า** ทั้งสองฝั่งต้องใช้ได้ เลยต้องทดสอบทั้งคู่ การทดสอบทุก combination เป็นไปไม่ได้ (flag แบบเปิด/ปิด 20 ตัวได้ combination ราวหนึ่งล้านแบบ) และก็ไม่จำเป็นด้วย ธรรมเนียมของ Hodgson คือทดสอบ configuration ที่กำลังจะขึ้น production, fallback ที่ปิด flag พวกนั้นไว้ และหลายครั้งก็ทดสอบแบบเปิดทุกตัวด้วย
- **Flag ที่ค้างอยู่คือหนี้และความเสี่ยง** flag ที่ถูกทิ้งไว้คือ dead code, branch ที่ไม่มีใครทดสอบ และ switch ที่ใครสักคนอาจเผลอสับได้ ในปี 2012 Knight Capital เอา flag ที่เคยใช้เปิด function ที่เลิกใช้ไปตั้งแต่ปี 2003 มาใช้ใหม่ โค้ดใหม่ไปถึง server เจ็ดในแปดเครื่อง ส่วนเครื่องที่แปด ตัว flag กลับไปเปิด function เก่า ในราว 45 นาที บริษัททำรายการซื้อขายที่ไม่ได้ตั้งใจไปมากกว่า 4 ล้านครั้ง และเสียเงินไปกว่า $460 ล้าน
- **ความสอดคล้องข้าม service** request ที่วิ่งผ่านหลาย service ต้องไม่เห็น feature เปิดใน service หนึ่งแล้วปิดใน service ถัดไป ทางหนึ่งคือ evaluate ครั้งเดียวที่ edge แล้วส่งผลการตัดสินใจไปพร้อม request อีกทางคือให้ทุก service evaluate flag ตัวเดียวกันด้วย key เดียวกัน hash จะได้ให้ bucket เดียวกันทุกที่ นอกจากนี้ rule ยังไปถึง SDK แต่ละตัวในจังหวะที่ต่างกันนิดหน่อย ในช่วงไม่กี่วินาทีหลังเปลี่ยน instance สองตัวเลยอาจเห็นไม่ตรงกันได้
- **ช่องทางใหม่ในการเปลี่ยน production** flag service เปลี่ยนพฤติกรรมได้เร็วกว่า deploy ไหน ๆ และปกติก็ผ่านการตรวจน้อยกว่าด้วย มันต้องมี access control, audit trail และสำหรับ flag ที่เสี่ยงก็ต้องมีขั้น review ด้วย และให้ถือว่าการเปลี่ยน flag เป็น release แบบหนึ่ง: ค่อย ๆ เปลี่ยนและเฝ้าดู metric
- **Flag ไม่ได้ย้อนข้อมูล** การปิด flag หยุดโค้ดใหม่ได้ แต่ไม่ได้ย้อน row ที่มันเขียนไปแล้ว ให้ใช้ flag คู่กับ **expand and contract** ([parallel change](https://martinfowler.com/bliki/ParallelChange.html)) แต่ละเส้นทางจะได้อ่านสิ่งที่อีกฝั่งเขียนไว้ได้

## ข้อควรรู้ตอนลงมือทำ

- **Evaluate ฝั่ง server หรือฝั่ง client** server-side SDK รับ rule set ไปทั้งชุดแล้ว evaluate เองในเครื่อง แต่ SDK บน browser หรือมือถือต้องไม่ทำแบบนั้น: rule อาจมี ID ของ user คนอื่น นิยามของ segment และชื่อ feature ที่ยังไม่ release และอะไรก็ตามที่ส่งไปถึง client ก็ถูกอ่านได้ ตัว client-side SDK เลยส่ง context ของ user คนเดียวไป แล้วได้แค่ผลที่ evaluate สำหรับ context นั้นกลับมา และมันใช้ client-side key ไม่ใช่ server-side SDK key เด็ดขาด ให้บังคับการตัดสินใจที่ฝั่ง server ด้วย: ปุ่มที่ซ่อนไว้ไม่ใช่ access control
- **Flag, configuration และ entitlement** release flag เป็นของชั่วคราวและเป็นของทีมที่ ship การเปลี่ยนแปลงนั้น ส่วน configuration (timeout, endpoint, limit) เป็นของถาวรและควรอยู่ใน external configuration store สิ่งที่ลูกค้าจ่ายเงินซื้อคือ entitlement: เป็นข้อมูล product ที่มี source of truth ของตัวเอง แม้ permission flag จะอ่านมันก็ตาม ถ้า flag ไม่เคยต้องเปลี่ยนตอน runtime เลย Hodgson ชอบเก็บ configuration ของมันไว้ใน source control มากกว่า ตรงนั้นมันจะได้ review, history และ pipeline เดียวกับโค้ด
- **ความสะอาด** ให้ทุก flag มีเจ้าของ มีแบบ และมีวันหมดอายุตั้งแต่ตอนสร้าง และให้การลบมันเป็นส่วนหนึ่งของคำว่า "done" บางทีมเพิ่ม task ลบ flag ไปพร้อมกับตอนเพิ่ม flag, จำกัดจำนวน flag ที่ live อยู่ หรือทำให้ test fail เมื่อ flag อยู่เกินวันหมดอายุ เครื่องมือก็ช่วยได้: Unleash จะ mark flag ว่า *potentially stale* เมื่อมันอยู่เกินอายุที่คาดไว้ (40 วันสำหรับ release flag เป็นค่า default) อย่าเอา flag key กลับมาใช้กับจุดประสงค์ใหม่เด็ดขาด
- **มี toggle point ให้น้อย** ตรวจ flag ที่ทางเข้าของ feature ไม่ใช่ทุกบรรทัดที่ต่างกัน และห่อมันไว้ใน function เดียว (`features.useNewCheckout(user)`) key จะได้โผล่แค่ที่เดียว และการเก็บกวาดก็เป็นการแก้เล็ก ๆ ถ้าเป็นการเปลี่ยนที่อยู่ลึกในโค้ด ให้ flag เลือกระหว่างสอง implementation ของ interface เดียวกัน (branch by abstraction)
- **Experiment ต้องมีมากกว่า flag** A/B test ยังต้องมี exposure event ทุกครั้งที่ user ได้ variant ไป, outcome metric และ sample size กับ statistical test ที่ตัดสินไว้ล่วงหน้า การจัดสรรของมันต้องคงที่ตลอดที่รันอยู่ ส่วน tracking API ของ OpenFeature และฟีเจอร์ experimentation ของ vendor ต่าง ๆ มีท่อให้ใช้ แต่ไม่ได้มาแทนสถิติ
- **OpenFeature** เป็นโปรเจกต์ CNCF ระดับ incubating ที่กำหนด evaluation API แบบไม่ผูกกับ vendor โค้ดของแอปพลิเคชันจะได้ไม่ต้องพึ่ง SDK ของ vendor เจ้าใดเจ้าหนึ่ง แอปพลิเคชันขอ flag key จาก client พร้อมค่า default และ *evaluation context* (ตัว *targeting key* ใน context ใช้ระบุ user) ส่วน *provider* เชื่อม client เข้ากับระบบจัดการ flag และค่า default ก็จะกลับมาทุกครั้งที่ evaluate ล้มเหลว
- **ตัวอย่าง product** server-side SDK ของ LaunchDarkly ถือ streaming connection ไว้และ evaluate จาก rule set ที่ cache ไว้ ตัว backend SDK ของ Unleash evaluate ในเครื่องและ poll ทุก 15 วินาทีเป็นค่า default ส่วน AWS AppConfig Agent poll และ cache ข้อมูล flag ไว้ข้าง ๆ แอปพลิเคชัน และ AppConfig ก็ deploy การเปลี่ยนแปลงแบบค่อยเป็นค่อยไป แล้ว rollback ตาม CloudWatch alarm ได้ Azure App Configuration มี targeting filter กับ time-window filter และ percentage rollout ให้ใช้
- **เฝ้าดูและทำให้อัตโนมัติ** ใส่ flag key กับ variant ที่ให้ไปไว้ใน trace, log และ error report ไม่งั้นจะโยง regression กลับไปหา flag ที่เป็นต้นเหตุไม่ได้ OpenTelemetry กำหนด event `feature_flag.evaluation` ไว้สำหรับเรื่องนี้ แต่ยังไม่ stable ส่วน flag ที่คุม critical path ก็ให้ alert ของ error rate หรือ latency ปิด flag ได้เอง แบบเดียวกับที่ canary analysis สั่ง rollback
