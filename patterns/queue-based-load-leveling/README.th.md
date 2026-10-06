## ปัญหา

front end รับงานได้เร็วกว่าที่ service ข้างหลังจะทำเสร็จมาก ตราบใดที่มันเรียก service นั้นตรง ๆ แล้วรอ ตัว service ก็ต้องตามทุก burst ให้ทัน: เปิด sale, batch job เริ่มรัน, partner replay webhook ของทั้งวัน backend ที่ทำเสร็จได้ 5 request ต่อวินาที อยู่ ๆ ก็โดนยิงมา 15 มันทำงานเร็วขึ้นไม่ได้ request เลยไปรออยู่ข้างใน ผู้เรียกก็ชน timeout ของตัวเอง และหลายตัวก็ retry ทำให้กองงานยิ่งสูงขึ้น service ยังคงทำ request ที่ผู้เรียกเลิกรอไปแล้ว งานนั้นเลยเสียเปล่า และ database ข้างหลังก็เห็น burst เดียวกันในรูปของการแย่ง connection กับ lock

วิธีแก้แบบคลาสสิกคือตั้งขนาด backend ให้รับ peak ได้ วิธีนี้ก็ใช้ได้ แต่ capacity ส่วนใหญ่ก็จะนั่งว่างอยู่เกือบทั้งวัน

## ทำงานยังไง

วาง durable queue ไว้ระหว่าง component ที่รับงานกับ component ที่ทำงาน แล้วให้แต่ละฝั่งทำงานตามจังหวะของตัวเอง

- **producer** (ในที่นี้คือ web tier หรือ API tier) validate request, เขียน message ลง queue แล้วตอบกลับทันทีที่ queue acknowledge ส่วนถ้าเป็น HTTP คำตอบนั้นปกติคือ `202 Accepted` เป็น status ที่บอกแค่ว่ารับ request ไว้แล้ว ไม่ได้บอกว่างานเสร็จ
- **queue** เก็บ message ไว้จนกว่า consumer จะหยิบไป depth ของมันโตขึ้นเมื่องานเข้ามาเร็วกว่าที่ทำได้ และหดลงเมื่อการ process ตามทัน
- **worker** ดึง message ในอัตราที่ backend และ database ของมันรับไหว และเอา message ออกจาก queue หลังทำงานสำเร็จแล้วเท่านั้น

สิ่งที่ backend เห็นตอนนี้ถูกกำหนดโดยจังหวะของ worker ไม่ใช่ของผู้เรียก spike ไม่ได้กลายเป็น error อีกต่อไป มันกลายเป็น backlog แล้ว backlog ก็กลายเป็นเวลารอ

**ผู้เรียกได้อะไรกลับไป** ได้ acknowledgement ตอนนี้ และได้ผลลัพธ์ทีหลัง acknowledgement แปลว่า *เก็บไว้อย่างปลอดภัยแล้ว* ไม่ได้แปลว่า *เสร็จแล้ว* ผู้เรียกเลยต้องมีอีกทางเพื่อรู้ผล: status URL ให้ poll (ส่งมาใน header `Location` ของ 202 พร้อมคำใบ้ `Retry-After`), webhook, การ push ผ่าน connection ที่เปิดอยู่ หรือแค่ email ที่บอกว่า order ส่งออกไปแล้ว นี่คือ pattern Asynchronous Request-Reply และเป็นต้นทุนจริงส่วนหนึ่งของการเอา queue มาใช้ ให้ validate ก่อนใส่ queue: request ที่ผิดรูปแบบควรได้ 4xx ตอนที่ผู้เรียกยังอยู่อ่านมัน

**คำนวณขนาด** ตัวเลขสามตัวอธิบายพฤติกรรมของมัน: อัตราที่งานเข้า อัตราที่ทำได้ (สิ่งที่ worker ทำเสร็จต่อวินาที) และ backlog ส่วนใน animation มี worker ตัวเดียวที่ทำเสร็จได้ 5 message ต่อวินาที โหลดปกติ 3 ต่อวินาที และ spike 15 ต่อวินาทีที่นาน 2 วินาที

| คำถาม | กฎ | ใน animation |
|---|---|---|
| backlog โตได้แค่ไหน | (อัตราที่งานเข้า − อัตราที่ทำได้) × ความยาวของ spike | (15 − 5) × 2 s = 20 message |
| message ใหม่ต้องรอนานแค่ไหน | backlog ÷ อัตราที่ทำได้ | 20 ÷ 5 = 4 s |
| นานแค่ไหนกว่า queue จะว่างอีกครั้ง | backlog ÷ (อัตราที่ทำได้ − อัตราที่งานเข้าหลัง spike) | 20 ÷ (5 − 3) = 10 s |

แถวสุดท้ายคือแถวที่ต้องจับตา backlog ระบายได้แค่ด้วย capacity *ที่เหลือ* ทำให้ worker ที่ปกติทำงานใกล้ขีดจำกัดใช้เวลานานกว่าจะฟื้น: ถ้างานเข้า 4.5 ต่อวินาที message 20 ตัวเดิมจะใช้เวลา 40 วินาที และถ้าเข้า 5 ขึ้นไปก็จะไม่มีวันหมด queue เกลี่ยโหลดได้ก็ต่อเมื่ออัตราที่งานเข้าโดยเฉลี่ยยังต่ำกว่าอัตราที่ทำได้ chart ใน diagram แสดงเรื่องนี้เป็นสองพื้นที่ที่ขนาดเท่ากัน: ก้อนที่อยู่เหนือเส้น capacity ระหว่าง spike คืองานที่ต้องรอ และแถบบาง ๆ หลังจากนั้นคืองานเดียวกันที่ถูกทำทีหลัง

**Depth และอายุ** depth บอกว่ามีงานรออยู่เท่าไร ส่วนอายุของ message ที่เก่าที่สุดบอกว่างานช้าไปแค่ไหน ใน animation ตัว message ที่เก่าที่สุดมีอายุ 1.3 วินาทีตอน spike จบ และยังแก่ขึ้นเรื่อย ๆ ขณะที่ queue เริ่มระบายแล้ว จนกระทั่ง message ตัวสุดท้ายของ spike ถูกหยิบไป 4 วินาทีหลังจากที่มันมาถึง ตอนนั้นอายุถึงจะลดลง

## ใช้ตอนไหนดี

- โหลดที่มาเป็น burst หรือเดาไม่ได้ ที่อยู่หน้า service, database หรือ third-party API ที่ capacity ตายตัว แพง หรือโดน rate limit
- งานที่ไม่ต้องใช้ผลลัพธ์ใน request เดียวกัน: สั่ง order, ส่ง email, render เอกสาร, ทำ index, ส่ง webhook, import ไฟล์
- เมื่ออยากตั้งขนาดและจ่ายเงินให้ backend ตามโหลดเฉลี่ย แทนที่จะตาม peak
- เมื่อ front end ควรรับงานต่อไปได้ ขณะที่ backend ช้า กำลัง deploy หรือล่มอยู่
- ไม่เหมาะเมื่อผู้เรียกต้องการคำตอบใน request เดียวกัน เช่น login, การดูราคา หรือการค้นหา ตรงนั้น queue แค่เพิ่มความหน่วง ให้ปกป้องเส้นทางพวกนั้นด้วย caching, capacity ที่มากขึ้น หรือ [rate limiting](../rate-limiting/)
- ไม่เหมาะเมื่อโหลดคงที่และต่ำกว่า capacity อยู่มาก queue แค่เพิ่มชิ้นส่วนที่ต้องดูแล โดยไม่ได้อะไรกลับมา

## ได้อะไร เสียอะไร

- **ได้ latency แทน error** นี่คือข้อตกลงทั้งหมด เพราะฉะนั้นต้องหาให้ได้ว่าธุรกิจยอมรอได้แค่ไหน ระบบที่ใช้ queue มีสองโหมด: ถ้าไม่มี backlog ก็เร็ว ถ้ามี backlog ทุก message ก็ต้องรอหลังตัวที่อยู่ข้างหน้า Builders' Library ของ Amazon เรียกสิ่งนี้ว่า *bimodal behaviour* และเตือนว่าเมื่อความล้มเหลวหรือการพุ่งขึ้นของโหลดผลักระบบเข้าโหมดช้าไปแล้ว อาจใช้เวลานานกว่าจะกลับออกมาได้
- **มันเลื่อนโหลดไปตามเวลา ไม่ได้ทำให้หายไป** ถ้างานเข้ายังสูงกว่า capacity ไปเรื่อย ๆ backlog ก็จะโตไม่มีที่สิ้นสุด และ queue ที่ไม่มีขอบเขตจะซ่อนเรื่องนี้ไว้จน message มีอายุเป็นชั่วโมง
- **สัญญากับผู้เรียกเปลี่ยนไป** ไม่มีผลลัพธ์ใน response, error โผล่ขึ้นมาทีหลัง และต้องมีคนสร้างและดูแล status resource
- **ตัวซ้ำ** queue service ส่วนใหญ่ส่งแบบ *at least once* โดย worker หยิบ message ไปภายใต้ lease ที่เรียกว่า visibility timeout ใน Amazon SQS (default 30 วินาที) และเรียกว่า lock ใน Azure Service Bus (default 1 นาที) ถ้า worker crash หรือแค่ช้ากว่า lease ตัว message จะถูกส่งอีกรอบ ขณะที่ความพยายามครั้งแรกอาจยังทำเสร็จได้อยู่ SQS standard queue ยังส่งตัวซ้ำออกมาเองได้เป็นครั้งคราวด้วย ทำให้ worker ต้อง idempotent: ดู [Idempotent Consumer](../idempotent-consumer/)
- **Poison message** message ที่ไม่มีวัน process ได้จะกลับมาทุกครั้งที่ลองแล้วล้ม มันเผา capacity และใน queue ที่มีลำดับก็ block ทุกอย่างที่อยู่ข้างหลัง ให้ย้ายมันไปที่ dead-letter queue หลังลองไม่กี่ครั้ง และตั้ง alert ที่ queue นั้น
- **ลำดับ** consumer ตัวเดียวบน queue แบบ first-in, first-out รักษาลำดับไว้ได้ แต่ worker หลายตัวบน queue เดียวกัน (Competing Consumers) และการส่งซ้ำทุกแบบรักษาไม่ได้ ตรงที่ลำดับสำคัญ ปกติก็สำคัญแค่ต่อลูกค้าหรือต่อ order เลยให้รักษาลำดับต่อ key: message group ID ใน SQS FIFO queue, session ใน Service Bus, partition key ใน Kafka อีกทางคือออกแบบ handler ให้ไม่สนลำดับ
- **มีของให้รันและเฝ้ามากขึ้น** queue เป็น dependency เพิ่มอีกตัว ที่มี quota ของตัวเองเรื่องขนาด message และ retention ความล้มเหลวก็เงียบลงด้วย: แทนที่จะเป็น error บน dashboard ก็กลายเป็น message ที่มาช้า

## ข้อควรรู้ตอนลงมือทำ

- **เฝ้าตัวเลขสองตัวของทุก queue: depth กับอายุ** ใน SQS คือ `ApproximateNumberOfMessagesVisible` กับ `ApproximateAgeOfOldestMessage` ส่วน Google Cloud Pub/Sub ให้จำนวน message ที่ยังไม่ acknowledge และอายุของตัวที่เก่าที่สุดของแต่ละ subscription แต่ Azure Service Bus มี metric สำหรับ active message แต่ไม่มีของอายุ เลยต้องให้ worker รายงานเองว่าแต่ละ message รอนานแค่ไหน (broker ประทับเวลาที่เข้า queue ไว้ในทุก message) ตั้ง alert ที่อายุเทียบกับ latency ที่สัญญาไว้ คู่มือ monitoring ของ Pub/Sub ของ Google อ่านสองค่านี้แบบนี้: backlog กับอายุที่โตไปด้วยกันแปลว่า consumer ตามไม่ทัน ส่วน backlog เล็ก ๆ ที่คงที่แต่อายุโตขึ้น ชี้ว่ามี message ที่ติดอยู่
- **scale worker ตาม backlog ไม่ใช่ตาม CPU** worker ที่รอ I/O อาจนั่งอยู่หลัง backlog ก้อนใหญ่ทั้งที่ CPU ว่าง ความยาว queue ดิบ ๆ ก็เป็นเป้าที่ไม่ดีเหมือนกัน เพราะมันไม่ได้เปลี่ยนตามสัดส่วนของจำนวน worker ให้ใช้ *backlog ต่อ worker* คู่มือ EC2 Auto Scaling หาเป้าจาก latency ที่ยอมรับได้หารด้วยเวลาที่ message หนึ่งตัวใช้ (10 s ÷ 0.1 s = 100 message ต่อ instance) แล้วติดตามความยาว queue หารด้วยจำนวน instance ที่รันอยู่เทียบกับเป้านั้น ปัจจุบันทำเป็น metric-math expression ตัว queue scaler ของ KEDA ทำแบบเดียวกันสำหรับ Kubernetes ด้วยเป้าจำนวน message ต่อ replica (`queueLength` สำหรับ SQS และ `messageCount` สำหรับ Service Bus ทั้งคู่ default 5) ส่วน Azure Functions คำนวณจำนวน instance จากความยาว queue หารด้วยจำนวน execution เป้าหมายต่อ instance ดู [Autoscaling](../autoscaling/)
- **ตั้งเพดานให้การ scale out** worker ที่มากขึ้นระบาย backlog ได้เร็วขึ้น แต่ก็พาโหลดที่ queue ซ่อนไว้กลับมาด้วย คำอธิบาย pattern นี้ของ Microsoft เตือนว่าการ autoscale consumer โดยไม่จำกัดสิ่งที่มันทำรวมกันทั้งหมด ก็แค่ย้าย overload ไปไว้ปลายทาง ให้ตั้งค่าสูงสุดที่ database รับไหว: replica limit, concurrency limit ต่อ worker หรือสำหรับ AWS Lambda ที่อ่านจาก SQS ก็คือ maximum concurrency ของ event source mapping (2 ถึง 1,000)
- **จำกัดขนาด queue** ตัดสินว่า backlog ที่ใหญ่ที่สุดที่ยังคุ้มจะทำคือเท่าไร (latency budget × อัตราที่ทำได้) แล้วปฏิเสธงานที่เกินจากนั้น RabbitMQ บังคับ `max-length` ได้ โดย default มันจะทิ้ง (หรือส่งเข้า dead-letter) message ที่เก่าที่สุด และถ้าตั้ง `overflow: reject-publish` มันจะปฏิเสธ message ใหม่ แล้วแจ้งให้ publisher ที่ใช้ confirm รู้ ตัว Service Bus ปฏิเสธการส่งเมื่อ queue ถึง size quota ส่วน SQS ไม่มีขีดจำกัดเรื่อง depth มีแค่ retention period (default 4 วัน สูงสุด 14) ตรงนั้น producer เลยต้องเช็ก depth หรืออายุเอง เมื่อ queue เต็ม ให้บอกความจริงกับผู้เรียกด้วย `429` หรือ `503` พร้อม `Retry-After` นั่นคือ throttling และมันเสริมกับการเกลี่ยโหลด: [Rate Limiting & Throttling](../rate-limiting/) คุมอัตราที่งานเข้า*โดยเฉลี่ย*ให้อยู่ในระดับที่ worker ระบายทัน ส่วน queue ก็เกลี่ย burst ที่อยู่ต่ำกว่าเส้นนั้น
- **ปล่อยให้งานที่ stale หมดอายุ** email reset password ที่มาช้าสองชั่วโมงแย่กว่าไม่มาเลย ให้ message มี time to live (ต่อ message หรือต่อ queue ใน RabbitMQ และ Service Bus หรือ retention period ใน SQS) และตัดสินว่าตัวที่หมดอายุจะทิ้งหรือส่งเข้า dead-letter สำหรับงานที่ความสดสำคัญ Builders' Library อธิบายไว้อีกสองวิธี: ให้บริการ message ใหม่ก่อน ขณะที่ค่อย ๆ ทำ backlog เก่าแยกไว้ด้านข้าง และดันกลับไปที่ producer
- **ให้ lease พอดีกับงาน** ตั้ง visibility timeout หรือ lock ให้มากกว่าเวลา process ปกติที่ช้าที่สุดเล็กน้อย และให้ worker ต่อเวลาระหว่างงานที่ยาว SQS ให้รวมได้ถึง 12 ชั่วโมง ส่วน lock ของ Service Bus อยู่ได้สูงสุด 5 นาทีและต่ออายุได้ ถ้า lease สั้นเกินไป message ที่ช้าจะถูก process สองรอบ ถ้ายาวเกินไป message ของ worker ที่ crash ก็จะถูกซ่อนไว้นานเท่านั้น ให้ delete หรือ complete message หลังจาก commit งานแล้วเท่านั้น
- **ส่งเข้า dead-letter หลังลองไม่กี่ครั้ง** ใน SQS ให้ตั้ง redrive policy พร้อม `maxReceiveCount` ส่วน Service Bus ส่ง message เข้า dead-letter หลังส่งไป 10 ครั้งเป็นค่า default และ RabbitMQ quorum queue เลิกพยายามหลังส่งไม่สำเร็จ 20 ครั้งเป็นค่า default (ตั้งแต่ 4.0) แล้วก็ทิ้ง message ไป เว้นแต่จะตั้ง dead-letter exchange ไว้ ตั้ง alarm กับทุกอย่างที่ตกลงไปใน dead-letter queue และมีทาง replay มันเมื่อแก้ bug แล้ว
- **อย่าสับสนกับ request queue ข้างใน server** ตรงนั้นผู้เรียกยังต่ออยู่และรออยู่ ทำให้ queue ที่ยาวมีแต่ request ที่ไม่มีใครรออีกแล้ว หนังสือ SRE ของ Google แนะนำให้ queue แบบนั้นสั้นเมื่อเทียบกับ thread pool และให้ปฏิเสธตั้งแต่เนิ่น ๆ load leveling ได้ผลก็เพราะผู้เรียกถูกปล่อยไปแล้ว
- **queue service ตรงนี้ใช้แทนกันได้:** Amazon SQS, Azure Service Bus หรือ Queue Storage, Google Cloud Pub/Sub หรือ Cloud Tasks, RabbitMQ หรือ Kafka topic ที่อ่านโดย consumer group เดียว โดยที่ depth ก็คือ consumer lag ให้เลือกตาม delivery guarantee, ลำดับ, ขนาด message และวิธีที่อยาก scale consumer แล้วซ่อนตัวเลือกนั้นไว้หลัง interface เล็ก ๆ
- **เพื่อนบ้าน** Competing Consumers เพิ่ม worker ให้ queue เดียวกัน, Priority Queue ให้งานด่วนแซงได้, Dead-Letter Queue พัก message ที่ล้มซ้ำ ๆ ไว้ และ Web-Queue-Worker คือรูปแบบแอปพลิเคชันที่สร้างรอบ pattern นี้ [Event-Driven Architecture](../event-driven-architecture/) พึ่ง buffering แบบเดียวกัน แต่กระจาย event แต่ละตัวไปให้ subscriber หลายตัว ส่วน [Retry with Backoff & Jitter](../retry-with-backoff/) คือสิ่งที่ producer ที่ถูกปฏิเสธควรทำเมื่อ queue ที่มีขอบเขตเต็ม
