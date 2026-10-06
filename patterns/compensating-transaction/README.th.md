## ปัญหา

การจองทริปหนึ่งครั้งไปแตะสามบริษัท: สายการบิน โรงแรม และบริษัทรถเช่า แต่ละเจ้า commit การจองในระบบของตัวเอง และไม่มีเจ้าไหนยอมเข้าร่วม transaction ที่เราคุมอยู่ พอการจองตัวที่สามล้มเหลว สองตัวแรกก็เกิดขึ้นจริงไปแล้ว: ที่นั่งกับห้องพักปิดขายให้คนอื่นแล้ว และเงินก็อาจโดนตัดไปแล้วด้วย ไม่มี transaction ไหนให้ rollback

แม้จะอยู่ใน database เดียวกัน step ที่ commit ไปเมื่อหลายนาทีก่อนก็ใส่คืนกลับง่าย ๆ ไม่ได้: ระหว่างนั้นอาจมีงานอื่นอ่านข้อมูลนั้นแล้วต่อยอดไปแล้ว การเขียนค่าเก่ากลับลงไปจะทับการเปลี่ยนแปลงพวกนั้น การย้อนเลยต้องเป็น business operation ที่ตั้งใจทำ

## ทำงานยังไง

**compensating transaction** ย้อน step ที่ทำเสร็จแล้วด้วย operation ใหม่ที่กลับผลทางธุรกิจของมัน: การยกเลิกสำหรับการจอง การคืนเงินสำหรับการเรียกเก็บเงิน รายการแก้ไขสำหรับการลงบัญชี paper เรื่อง saga ของ Garcia-Molina กับ Salem ในปี 1987 วางกรอบไว้แบบนี้ตั้งแต่แรก: compensation ย้อนผลของ step ในเชิงความหมาย โดยไม่ได้สัญญาว่าจะใส่ข้อมูลกลับไปให้เหมือนเดิมเป๊ะ เพราะแบบนี้ compensation เลยขึ้นกับแต่ละแอปพลิเคชัน การยกเลิกอาจมีค่าธรรมเนียม การคืนเงินอาจคืนแค่บางส่วน และ record เดิมก็ยังอยู่ในประวัติข้าง ๆ record ที่กลับผลของมัน

- **บันทึกความคืบหน้าให้ durable** ก่อนรัน step ถัดไป ให้จดไว้ว่า step ไหนเสร็จแล้วบ้าง และอะไรใช้ย้อนแต่ละ step ถ้า worker crash ตัวที่มาแทนก็อ่าน record นั้นแล้วรู้ว่าเหลืออะไรต้องทำ workflow engine เก็บ record นี้ไว้ให้: durable execution ของ Temporal ทำให้ compensation รันต่อไปได้แม้ worker ล้ม, Azure Durable Functions เก็บประวัติของแต่ละ orchestration ไว้ใน store แบบ append-only ที่เป็น event-sourced แล้ว replay มันหลัง restart และ workflow แบบ Standard ของ AWS Step Functions ก็เก็บ execution state ไว้ระหว่าง step (ส่วน workflow แบบ Express ไม่เก็บ)
- **เลือกลำดับ** การย้อน step ล่าสุดก่อนเป็นค่า default ที่ใช้กันทั่วไป และ saga helper ของ Temporal ก็รัน compensation ย้อนลำดับกับที่ register ไว้ guidance ของ Microsoft เสริมว่าลำดับไม่ต้องย้อนกลับเป๊ะก็ได้: ย้อนอะไรที่อ่อนไหวกับความไม่สอดคล้องที่สุดก่อน และรัน step ย้อนที่ไม่ได้พึ่งกันแบบ parallel
- **คาดไว้เลยว่า compensation ก็ล้มได้** การเรียก cancel ก็ timeout ได้เหมือนการเรียกอื่น ๆ ให้ retry มัน (ดู [Retry with Backoff & Jitter](../retry-with-backoff/)) แต่จะปลอดภัยก็ต่อเมื่อ compensation เป็น idempotent: ส่ง idempotency key เดิมไปทุกครั้งที่ลอง ยกเลิกสองรอบก็ยังเหลือการยกเลิกครั้งเดียว (ดู [Idempotent Consumer](../idempotent-consumer/))
- **ส่งต่อสิ่งที่ทำให้จบไม่ได้** พอ retry หมดแล้ว ให้ส่ง alert และเอาเคสเข้า queue ให้คนจัดการ พร้อมข้อมูลทริป เลขอ้างอิงการจอง สิ่งที่ย้อนไปแล้ว และ error ล่าสุด operation ที่ย้อนไปครึ่งเดียวโดยไม่มีใครรู้แย่กว่าตัวที่รออยู่ใน queue มาก

## ใช้ตอนไหนดี

- operation ครอบคลุมหลาย service, data store หรือ API ของ third party ที่ใช้ transaction แบบ atomic ร่วมกันไม่ได้ และ step ที่ทำเสร็จแล้วต้องย้อนเมื่อ step ทีหลังล้มเหลว saga ทุกตัวต้องมีสิ่งนี้: ดู [Saga (Orchestration)](../saga-orchestration/) และ [Saga (Choreography)](../saga-choreography/) มันยังเป็นราคาที่ต้องจ่ายของ [Database per Service](../database-per-service/) ด้วย: พอแต่ละ service เป็นเจ้าของข้อมูลของตัวเอง ก็ไม่มี transaction เดียวที่คลุม business operation ที่ข้ามหลาย service ได้
- การย้อนต้องใช้ business rule (ค่าธรรมเนียม การคืนเงินบางส่วน ข้อความถึงลูกค้า) ไม่ใช่แค่กู้ข้อมูลเก่ากลับมา
- workflow ที่รันนาน ๆ ที่ถือ lock ไว้ตลอดทั้งช่วงไม่ได้

อย่าใช้ถ้าทุกอย่างอยู่ใน database เดียว: local transaction ให้ rollback จริงมาฟรี ๆ ถ้าความล้มเหลวเป็นแบบชั่วคราวและ step จะสำเร็จในที่สุด ให้ใช้ retry ธรรมดาดีกว่า และถ้าธุรกิจทนความไม่สอดคล้องชั่วคราวไม่ได้ ก็ให้ใช้ atomic transaction ดีกว่า ก่อน compensate ให้ถามด้วยว่าเดินหน้าต่อจะดีกว่าไหม: ตัวอย่างทริปใน guidance ของ Azure เองเสนอโรงแรมอื่นให้ลูกค้าแทนการยกเลิกเที่ยวบิน และให้ลูกค้าเป็นคนเลือก

## ได้อะไร เสียอะไร

- **คนอื่นเห็น state ระหว่างทาง** จนกว่า compensation จะรัน ที่นั่งก็เต็มสำหรับผู้เดินทางคนอื่น และยอดเงินก็ค้างอยู่บนบัตร saga ไม่มี isolation ทีมต่าง ๆ เลยเพิ่มมาตรการรับมือ: *semantic lock* ที่ mark ว่า record กำลังอยู่ระหว่างทำ (ตัวอย่าง saga ของ Richardson สร้าง order ไว้ใน state PENDING), *pessimistic view* ที่จัดลำดับ saga ใหม่ให้การ update ไปตกอยู่ใน step ที่ retry ได้ตอนท้าย, การอ่านค่าใหม่อีกรอบก่อนเขียนทับ และการ update ที่สลับลำดับกันได้ หนังสือ *Microservices Patterns* ของ Chris Richardson อธิบายเรื่องพวกนี้ไว้ละเอียด
- **การย้อนแทบไม่เคยสมบูรณ์** ค่าธรรมเนียมยังอยู่ อีเมลถูกอ่านไปแล้ว เงินจ่ายออกไปแล้ว พัสดุส่งไปแล้ว สำหรับพวกนี้ compensation คือการแก้ไข: คำขอโทษ การคืนเงิน หรือใบลดหนี้
- **Logic เป็นสองเท่า** ทุก step ที่ย้อนได้ต้องมีตัวย้อนที่มีคนเขียน review และคอยดูแลให้ตรงกับโค้ดขาไปเสมอ แถมต้องเก็บข้อมูลไว้พอให้รันมันได้
- **Compensation รันไม่บ่อย เลยพังโดยไม่มีใครเห็น** ให้ตั้งใจทดสอบมัน: ทำให้แต่ละ step ล้มทีละตัวใน integration test แล้วตรวจว่าเหลืออะไรค้างอยู่ และ inject fault ใน test environment (ดู [Chaos Engineering](../chaos-engineering/))
- **ต้องมี observability** เชื่อมแต่ละ operation กับ compensation ของมันตั้งแต่ต้นจนจบ alert เมื่อ compensation ล้มเหลว และมี dashboard ของ instance ที่ค้างอยู่หรือรอคนมาจัดการ

## ข้อควรรู้ตอนลงมือทำ

- **เอา step ที่ย้อนยากที่สุดไว้ท้ายสุด** Chris Richardson แบ่ง step ของ saga เป็น step แบบ *compensatable* ที่ย้อนได้, *pivot* ที่เป็นจุดที่ย้อนกลับไม่ได้แล้ว และ step แบบ *retriable* ที่อยู่หลังจากนั้น โดย step แบบนี้ทำผิด business rule ไม่ได้ และแค่ retry ไปจนกว่าจะสำเร็จ (guidance เรื่อง saga ของ Microsoft เรียกว่า compensable, pivot และ retryable) ในทริปนี้ การกันที่ไว้เป็นแบบ compensatable การเก็บเงินและออกตั๋วคือ pivot ส่วนการส่งอีเมลยืนยันเป็นแบบ retriable
- **กันไว้ก่อน แล้วค่อยยืนยัน** การกันที่ที่หมดเวลาไปเองเปลี่ยนความล้มเหลวให้กลายเป็นการไม่ทำอะไรเลย Microsoft แนะนำ lock ระยะสั้นที่มี timeout บนแต่ละ resource ยึดไว้ก่อนทำงานจริงและยืนยันให้เสร็จก่อนมันหมดเวลา Pat Helland อธิบาย operation แบบ tentative ที่จบด้วยการยืนยันหรือการยกเลิกอย่างใดอย่างหนึ่งเสมอ ส่วนแบบ Try-Cancel/Confirm (TCC) ของ Guy Pardon กับ Cesare Pautasso สำหรับ REST API ให้ผู้ร่วมแต่ละรายยกเลิกเองถ้าไม่ได้ยินอะไรเลยก่อนถึง timeout ของตัวเอง
- **เก็บสิ่งที่การย้อนต้องใช้ไว้กับ step:** เลขอ้างอิงการจอง จำนวนเงิน และ idempotency key ส่วน Temporal ให้ register compensation ได้ก่อน step ของมันจะรัน ทำให้ step ที่ตายไปครึ่งทางก็ยังมี compensation คุ้มครองอยู่ แต่แบบนี้ compensation ก็ต้องรับมือกับ step ที่ไม่เคยเกิดขึ้นได้ด้วย
- **ตั้ง retry policy ให้ compensation** ใน AWS Step Functions ตัว block `Retry` (ค่า default คือ retry สามครั้ง ครั้งแรกหลังหนึ่งวินาที แล้ว interval ก็เพิ่มเป็นสองเท่าทุกครั้ง) จะรันก่อนที่ `Catch` จะส่ง error ไปที่ state ถัดไป เช่น compensation หรือการ escalate ส่วน Temporal แนะนำว่าอย่าตั้ง timeout ระดับ workflow เพื่อให้ compensation retry ต่อไปจนกว่าจะสำเร็จ ขณะที่ตัวอย่างของ Azure จำกัดจำนวน retry แล้วย้าย message ไป [dead-letter queue](../dead-letter-queue/) พร้อม alert ไม่ว่าจะแบบไหน ต้องมีคนรู้เรื่อง
- **Ledger กับ event store ไม่เคยลบ** งานบัญชีแก้การลงบัญชีที่ผิดด้วยรายการแก้ไข และระบบที่เป็น event-sourced ก็ append compensating event (เช่น *ReservationCanceled*) แทนการลบตัวเดิม: ดู [Event Sourcing](../event-sourcing/)
- **ส่งคำสั่งย้อนให้ไว้ใจได้** ถ้า compensation publish message ให้เขียนผ่าน [transactional outbox](../transactional-outbox/) การย้อนจะได้ไม่หายไประหว่าง database กับ broker
