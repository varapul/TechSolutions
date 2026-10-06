## ปัญหา

ถ้า downstream service ช้าหรือล่ม ฝั่งที่เรียกมันก็ยังส่ง request ไปเรื่อย ๆ แล้วนั่งรอจนกว่าจะ timeout ทำให้ thread และ connection กองพะเนินอยู่หลังการเรียกที่ช้า latency พุ่งขึ้น แล้วความเสียหายก็ลามขึ้นไปข้างบนกลายเป็น **cascading failure** ในขณะเดียวกัน service ที่กำลังแย่อยู่ก็โดน traffic (และ retry) ถล่มใส่ ในจังหวะที่มันต้องการพักที่สุดพอดี

## ทำงานยังไง

circuit breaker ห่อการเรียก dependency ไว้แล้วคอยดูผลของการเรียกแต่ละครั้ง มันเป็น state machine เล็ก ๆ:

- **Closed**: การเรียกผ่านไปได้ตามปกติ ตัว breaker นับจำนวนครั้งที่ fail หรือคำนวณอัตราการ fail ใน sliding window
- **Open**: พอเกิน threshold แล้ว การเรียกจะถูกปฏิเสธทันทีโดยไม่แตะ network เลย แล้วฝั่งที่เรียกก็ไปใช้ fallback
- **Half-open**: หลังผ่าน cooldown ไปแล้ว จะปล่อยให้ลองเรียกผ่านไปได้จำนวนจำกัด ถ้าสำเร็จ breaker ก็ปิด ถ้า fail ก็เปิดอีกรอบแล้วรอ cooldown ใหม่

## ใช้ตอนไหนดี

- การเรียก remote service หรือ shared resource ที่ fail หรือช้าลงได้: HTTP API, database, SaaS ของบุคคลที่สาม
- ตอนที่คำตอบแบบลดคุณภาพแต่เร็ว ดีกว่าการ fail ช้า ๆ: ข้อมูลจาก cache, ค่า default, "ลองใหม่อีกครั้งภายหลัง"
- ไม่ใช่สำหรับการเรียกภายใน process ล้วน ๆ และไม่ใช่ของที่ใช้แทนการแก้ dependency ที่ไม่น่าเชื่อถือ

## ได้อะไร เสียอะไร

- **การ tune สำคัญ** ถ้าไวเกินไปก็ตัดเพราะ noise แต่ถ้าหละหลวมเกินไปก็ตัดช้าเกินไป ใช้*อัตรา*การ fail ที่มีจำนวนการเรียกขั้นต่ำ และมี threshold สำหรับการเรียกที่ช้า ดีกว่าใช้จำนวนครั้งดิบ ๆ
- **ต้องมี fallback จริง ๆ** ถ้าไม่มี fallback ตัว breaker ที่ open ก็แค่ทำให้คุณ fail เร็วขึ้นเท่านั้น
- **แต่ละ instance เรียนรู้เอง** breaker ที่แยกต่อ instance เห็นแค่ traffic ของตัวเอง replica แต่ละตัวเลยตัดวงจรแยกกัน
- **ใช้คู่กับ timeout และ retry ที่ระวัง** การเรียกที่ค้างจะไม่ถูกนับเป็น fail เลยถ้าไม่มี timeout และ retry ควรมอง "breaker open" ว่าเป็นกรณีที่ไม่ควร retry จะได้ไม่ไปถล่มวงจรซ้ำ

## ข้อควรรู้ตอนลงมือทำ

- **Library:** Resilience4j (Java), Polly (.NET), opossum (Node.js), pybreaker (Python), gobreaker (Go)
- **Infrastructure:** service mesh และ proxy ให้แนวคิดเดียวกันโดยไม่ต้องแก้โค้ด ตัวอย่างเช่น outlier detection กับ circuit-breaking threshold ของ Envoy และ `outlierDetection` ใน `DestinationRule` ของ Istio
- **คอยสังเกตมัน:** ปล่อย metric หรือ event ทุกครั้งที่ state เปลี่ยน breaker ที่ open คือ alert ที่ชัดที่สุดตัวหนึ่งที่คุณจะได้
