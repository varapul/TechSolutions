## ปัญหา

ถ้าแต่ละ service มี database ของตัวเอง operation ทางธุรกิจหนึ่งครั้งก็ต้องแตะข้อมูลที่หลาย service เป็นเจ้าของ การสั่ง order หนึ่งครั้งหมายถึงตัดเงินจากบัตรใน Payments จอง stock ใน Inventory และจอง courier ใน Shipping แต่ไม่มี database transaction ไหนครอบทั้งสามได้ คำตอบแบบดั้งเดิมคือ distributed transaction ด้วย **two-phase commit** (2PC เช่นผ่าน XA) มันถือ lock ไว้ในทุก participant จนกว่า coordinator จะตัดสินใจ ถ้า coordinator ล้มผิดจังหวะ participant ก็ค้างอยู่ในสถานะ "in doubt" และมันต้องให้ทุก participant พร้อมใช้งานในเวลาเดียวกัน database, message broker และ third-party API หลายตัวก็ไม่รองรับมันเลย ถ้าไม่มีการประสานงานแบบอื่น ความล้มเหลวกลางทางจะทิ้งระบบไว้ในสภาพไม่ consistent: ลูกค้าโดนตัดเงินสำหรับ order ที่จะไม่มีวันถูกส่ง

## ทำงานยังไง

**saga** แทน transaction ก้อนใหญ่ก้อนเดียวด้วยลำดับของ **local transaction** T1 … Tn แต่ละตัว commit ใน database ของ service ตัวเอง ทุกขั้นที่อาจต้องย้อนกลับจะมี **compensating transaction** ของมัน Garcia-Molina และ Salem ที่เสนอ saga ไว้ในปี 1987 สำหรับ long-lived transaction ภายใน database เดียว ได้ระบุสิ่งที่รับประกันไว้ว่า: T1 … Tn ต้อง commit ครบทุกตัว หรือไม่ก็ T1 … Tj commit แล้วตามด้วย compensation ของมัน Cj … C1 ส่วนใน diagram ตัว T3 ล้มเหลว ทำให้ C2 กับ C1 ถูกรัน อะไรที่ commit ไปแล้วจะไม่มีวันถูก rollback แต่จะถูก compensate แทน

ในแบบ **orchestration** มี coordinator ตัวเดียวเป็นเจ้าของ flow:

- **orchestrator** เป็น state machine ที่รู้ว่ามีขั้นไหนบ้าง เรียงยังไง และ compensation ของแต่ละขั้นคืออะไร มันเป็น component หนึ่งของ service ที่เริ่ม saga ก็ได้ หรือเป็น workflow engine แยกต่างหากก็ได้
- มันบันทึกทุกการเปลี่ยนสถานะลง **saga log** แบบ durable แล้วส่ง **command** ให้แต่ละ participant (ปกติเป็น message แบบ asynchronous) และรอ **reply**
- ถ้าได้ reply ว่าล้มเหลว มันจะหยุดเดินหน้า แล้วส่ง compensating command ของขั้นที่ทำเสร็จแล้ว โดยเริ่มจากขั้นล่าสุดก่อน ส่วนขั้นที่ล้มเหลวเองไม่ต้อง compensate เพราะ local transaction ของมัน rollback ไปแล้ว
- participant แค่รัน local transaction ของตัวเองกับ compensation ของมัน และไม่รู้อะไรเลยเกี่ยวกับ participant ตัวอื่นหรือ flow ทั้งหมด

compensation เป็นแบบ **semantic** ไม่ใช่การ undo: การตัดเงินยังอยู่ใน payments ledger และมีรายการคืนเงินบันทึกไว้ข้าง ๆ ลูกค้าจะเห็นทั้งสองรายการใน statement ของตัวเอง compensation ทำให้ธุรกิจกลับมา consistent แต่ไม่ได้คืนสภาพเดิมเป๊ะ ๆ

## ใช้ตอนไหนดี

- business transaction หนึ่งครอบหลาย service หรือหลาย data store ที่ใช้ ACID transaction เดียวกันไม่ได้ เช่น microservices ที่มี database แยกกัน หรือ third-party API
- ทุกขั้นก่อนถึงจุดที่ย้อนกลับไม่ได้ มีวิธีย้อนทางธุรกิจที่มีความหมาย: คืนเงิน ปล่อย stock ยกเลิก
- flow มีหลายขั้น มีการแตกแขนง หรือมี timeout และคุณอยากให้มันชัดเจนอยู่ในที่เดียว ที่ทำ version, test และ monitor ได้
- ไม่ควรใช้ถ้าข้อมูลอยู่ใน database เดียวได้ (local transaction ง่ายกว่าและแข็งแรงกว่า) หรือถ้าห้ามใครเห็นสถานะระหว่างทางเลย

## ได้อะไร เสียอะไร

- **ไม่มี isolation** saga ให้ atomicity (ในที่สุด) consistency และ durability แต่ไม่ให้ isolation ทำให้ request อื่นเห็นสถานะระหว่างทาง เช่น stock ที่ถูกจองไว้ให้ order ที่กำลังจะถูกยกเลิก เลยเกิด lost update, dirty read และ non-repeatable read ได้ วิธีรับมือมีหลายแบบ: **semantic lock** (flag ระดับ application อย่างสถานะ PENDING ของ order ที่บอก operation อื่นว่า record นี้กำลังเปลี่ยนอยู่), update แบบ commutative, การเรียงขั้นใหม่ให้ update ที่เสี่ยงไปอยู่ในขั้นที่ retry ได้ (*pessimistic view*), การอ่านค่าใหม่อีกรอบก่อนเขียนทับ และการบันทึก operation ที่ใช้กับ record ไว้ เพื่อให้ apply ได้ตามลำดับที่ถูกต้อง (*version file*)
- **Compensation คือ business logic** ทุกขั้นที่ compensate ได้ต้องมี operation ย้อนกลับที่ต้องออกแบบและ test และบาง action (email ที่ส่งไปแล้ว พัสดุที่ส่งออกไปแล้ว) ย้อนกลับไม่ได้เลย compensation ต้องไม่ยอมแพ้: ให้ retry และถ้ายังพังอยู่เรื่อย ๆ ก็ส่งต่อให้คนจัดการ
- **Eventual consistency** จนกว่า saga จะจบ order จะอยู่ในสถานะ PENDING ตัว API และ UI ต้องออกแบบมารองรับเรื่องนี้
- **Orchestration กับ choreography** orchestrator ทำให้ flow ชัดเจนและตามได้ง่าย ทำให้ participant ไม่ผูกกันเอง และเลี่ยง dependency แบบวนระหว่างกัน ต้นทุนคือมี component เพิ่มอีกตัวที่ต้อง highly available และมีแรงล่อให้ย้าย business logic เข้าไปไว้ในนั้น ส่วนใน choreography แต่ละ service ตอบสนองต่อ event ของกันและกันโดยไม่มี coordinator เลย วิธีนี้เหมาะกับ flow สั้น ๆ แต่ flow ยาว ๆ จะตามยากและแก้ยาก

## ข้อควรรู้ตอนลงมือทำ

- **Pivot และ retriable transaction** เรียงขั้นให้เป็น compensatable transaction ก่อน ตามด้วย **pivot** (ขั้นตัดสินว่าไปต่อหรือไม่: พอมัน commit แล้ว saga ต้องรันไปจนจบ) แล้วค่อยเป็น **retriable** transaction ที่ retry ไปจนกว่าจะสำเร็จ ในที่นี้ *Book shipment* คือ pivot: ถ้ามันสำเร็จ ขั้นที่เหลือ (อนุมัติ order) จะถูก retry และไม่มีวันถูก compensate เลย ส่วนการตรวจที่มีโอกาสล้มเหลวสูงสุดให้ไว้ต้น ๆ และเอา action ที่ย้อนกลับยากไว้ที่ pivot หรือหลังจากนั้น เช่นกับบัตร ถ้า authorize ไว้ก่อนแล้วค่อย capture หลัง pivot ตัว compensation ก็จะกลายเป็นการ void hold แทนการคืนเงิน
- **Command และ reply แบบ idempotent** message ถูกส่งแบบ at least once และ orchestrator ก็ retry หลัง timeout ตัว participant เลยต้องตัด command ที่ซ้ำออก (เช่นใช้ saga ID กับขั้น) และ orchestrator ต้องไม่สน reply ที่ซ้ำหรือมาช้า compensation ก็ต้อง idempotent ด้วย และต้องรันได้อย่างปลอดภัยแม้ขั้นเดินหน้าจะไม่เคยมีผลเลย
- **timeout แปลว่า "ไม่รู้" ไม่ใช่ "ล้มเหลว"** ให้ retry command ที่ idempotent หรือถาม participant ถึงผลลัพธ์ก่อนจะ compensate
- **saga state แบบ durable** บันทึก state ของ saga ทุกครั้งที่เปลี่ยนสถานะ เพื่อให้ orchestrator ที่ restart แล้วทำต่อจากจุดที่หยุดไว้ได้ workflow engine อย่าง Temporal, AWS Step Functions (Standard workflow), Azure Durable Functions และ Camunda ทำเรื่องนี้ให้ ส่วนใน orchestrator ที่เขียนเอง ตัว saga log ก็คือตารางใน database ของ orchestrator เอง
- **ไม่มี dual write** service ที่ commit แล้วค่อยส่ง message (reply ของ participant หรือ command ถัดไปของ orchestrator) อาจ crash ระหว่างสองจังหวะนี้ได้ ให้ใช้ transactional outbox หรือการรับประกันของ workflow engine เอง เพื่อให้ message ถูกส่งก็ต่อเมื่อ transaction ของมัน commit เท่านั้น
- **ทำให้ observe ได้** ส่ง saga ID ไปกับ command, reply และ log และตั้ง alert ให้ saga ที่ค้างอยู่ในสถานะที่ยังไม่จบ
