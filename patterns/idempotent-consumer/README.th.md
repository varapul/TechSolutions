## ปัญหา

message broker มองเข้าไปข้างใน consumer ไม่ได้ มันรู้ว่า message ถูก handle แล้วก็ต่อเมื่อ consumer acknowledge เท่านั้น broker ที่ต้องไม่ทำ message หายเลยเก็บแต่ละตัวไว้จนกว่า acknowledgement จะมาถึง และส่งซ้ำถ้ามันไม่มา นี่คือ **at-least-once delivery** และ acknowledgement ก็หายได้ด้วยเหตุผลธรรมดา ๆ: consumer crash หรือถูก redeploy หลัง commit งานแต่ก่อน ack, network ทำ ack หาย หรือ handler ทำงานนานเกิน lease ของ message (visibility timeout ใน Amazon SQS, message lock ใน Azure Service Bus, acknowledgement deadline ใน Google Cloud Pub/Sub) แล้ว broker ก็ส่ง message นั้นให้ instance อื่น

จากฝั่ง broker "handle แล้วแต่ ack หาย" ดูเหมือน "ยังไม่เคย handle" ทุกประการ มันเลือกได้ว่าจะยอมแพ้ แล้ว message ก็หาย (at-most-once) หรือจะส่งอีกรอบ แล้ว message ก็ซ้ำ (at-least-once) มันต้องเลือกอย่างใดอย่างหนึ่ง นี่คือเหตุผลที่โดยทั่วไปไม่มี **exactly-once delivery** ให้ใช้ สิ่งที่คุณสร้างได้คือ*ผล*แบบ exactly-once: ปล่อยให้ message มาถึงกี่ครั้งก็ได้ แล้วทำให้แน่ใจว่าตัวที่ซ้ำไม่เปลี่ยนอะไรเลย

producer ก็สร้างตัวซ้ำของตัวเองได้เหมือนกัน publisher ที่ timeout ระหว่างรอการยืนยันจาก broker จะส่ง message ซ้ำ และ relay ของ [transactional outbox](../transactional-outbox/) ก็ publish ซ้ำหลัง crash ทำให้ queue หนึ่งมีสำเนาของข้อเท็จจริงเดียวกันสองชุดได้

handler ที่ไม่ได้เตรียมรับมือเรื่องนี้จะทำ side effect ซ้ำ: ลูกค้าโดนตัดเงินสองครั้ง, email ถูกส่งสองครั้ง, stock ถูกจองสองครั้ง

## ทำงานยังไง

**idempotent consumer** ทิ้งระบบไว้ในสถานะเดียวกัน ไม่ว่ามันจะ handle message หนึ่งครั้งหรือห้าครั้ง ถ้างานไม่ได้ idempotent โดยธรรมชาติ มันก็ทำได้ด้วยการจำว่า handle อะไรไปแล้วบ้าง:

1. **ทุก message มี ID ที่คงที่** เหมือนเดิมทุกครั้งที่ส่ง
2. **handler บันทึก ID ใน transaction เดียวกับงานของมัน** มันเปิด transaction แล้ว insert ID ลงตาราง `processed_messages` ที่มี unique key บน ID นั้น จากนั้น apply การเปลี่ยนแปลงของตัวเองแล้ว commit ตัว marker กับผลของงานจะถูกบันทึกไปด้วยกัน หรือไม่ก็ไม่บันทึกเลยทั้งคู่
3. **ตัวซ้ำ insert ไม่ผ่าน** unique key ปฏิเสธการ insert ครั้งที่สอง ทำให้ handler รู้ว่างานนี้ commit ไปแล้ว มันเลยข้ามงานนั้นไป
4. **handler acknowledge หลัง commit** ไม่ใช่ก่อน ถ้า acknowledgement นั้นหาย message ก็จะกลับมา แล้วการเช็กตัวซ้ำก็ดูดซับมันไว้
5. **อะไรที่ transaction ครอบไม่ถึงก็ได้ ID ไปด้วย** call ไปที่ service อื่นหรือ payment provider จะส่ง message ID ไปเป็น idempotency key เพื่อให้ฝั่งผู้รับใช้กฎเดียวกันได้ที่ฝั่งของตัวเอง

การ commit marker ไปพร้อมกับผลของงานคือหัวใจของ pattern นี้ ถ้าบันทึก ID ก่อนแล้วค่อยทำงาน การ crash ระหว่างนั้นจะทิ้ง message ที่ถูก mark ว่าเสร็จแล้ว ทั้งที่งานไม่เคยเกิดขึ้น: การส่งซ้ำจะถูกข้าม และการตัดเงินก็หายไป ถ้าทำงานก่อนแล้วค่อยบันทึก ID การ crash ระหว่างนั้นจะทิ้งงานที่ทำเสร็จแล้วแต่ไม่ได้ mark: การส่งซ้ำก็จะทำมันซ้ำอีกรอบ

### การเลือก ID

| ID | คงที่ข้าม | จับได้ |
|---|---|---|
| **กำหนดโดย producer**: business key (*order 1042, payment requested*), event ID ใน outbox ของ producer หรือ idempotency key ของ client request ต้นทาง | การส่งซ้ำ, retry ของ producer, relay และ replay | ตัวซ้ำทุกแบบ |
| **กำหนดโดย broker** ตอนรับ message เข้ามา | การส่งซ้ำของ message ที่เก็บไว้ตัวนั้นตัวเดียว | การส่งซ้ำเท่านั้น ส่วน producer ที่ retry การ publish จะสร้าง message ตัวที่สองที่มี ID ที่สอง |
| **hash ของเนื้อหา** | อะไรก็ตามที่ byte เหมือนกัน | มากเกินไป: message สองตัวที่แยกกันแต่บังเอิญเหมือนกันทุกอย่างจะยุบรวมเป็นตัวเดียว |

เพราะฉะนั้นให้เลือก ID ที่ producer สร้างขึ้นมาพร้อมกับข้อเท็จจริงทางธุรกิจ ส่วน ID ที่ broker กำหนด จะพอใช้ก็ต่อเมื่อไม่มีอะไรต้นทางส่งข้อเท็จจริงเดียวกันได้สองครั้ง

### จะจำ ID ไว้ที่ไหน

| Store | Atomic ไปกับงานไหม | หมายเหตุ |
|---|---|---|
| ตาราง `processed_messages` ใน database เดียวกัน เขียนใน transaction เดียวกัน | ใช่ | pattern ตามที่ทำเป็น animation ถ้ามีหลาย consumer ใช้ตารางร่วมกัน ให้ใส่ชื่อ consumer ลงใน key ด้วย |
| ตัวแถวข้อมูลธุรกิจเอง | ใช่ | เก็บ message ID ล่าสุดหรือ version number ไว้บนแถว แล้วทำให้การ update มีเงื่อนไขตามค่านั้น ไม่ต้องมีตารางเพิ่ม แต่จำได้แค่ message ล่าสุดของแต่ละแถว |
| conditional write ใน key-value store | สำหรับ item เดียว หรือหลาย item ถ้าใช้ transaction ของ store | ใน DynamoDB ตัว `PutItem` ที่มีเงื่อนไข `attribute_not_exists(...)` จะถูกปฏิเสธเมื่อมี key อยู่แล้ว และ `TransactWriteItems` เขียน marker กับ business item แบบ all-or-nothing |
| cache แยกต่างหากที่มี time-to-live เช่น Redis `SET key value NX EX seconds` | ไม่ | เร็วและเก็บกวาดตัวเองได้ แต่สองระบบ commit ไปด้วยกันไม่ได้ ถ้าจอง ID ก่อน แล้ว crash ก่อนทำงาน message ก็หาย ถ้าทำงานก่อน แล้ว crash ก่อนจอง งานก็ซ้ำ ใช้มันเพื่อตัดตัวซ้ำส่วนใหญ่ออกตั้งแต่ต้น ไม่ใช่เป็นด่านเดียวสำหรับผลที่สำคัญ |

### สิ่งที่ broker เรียกว่า exactly-once

broker หลายตัวตัดตัวซ้ำบางส่วนออกเอง แล้วเรียกสิ่งนี้ว่า exactly-once แต่ไม่ว่ากรณีไหน มันก็หมายถึง at-least-once delivery บวกกับการตัดตัวซ้ำภายในขอบเขตหนึ่ง:

| Feature | ตัดอะไรออก | หยุดตรงไหน |
|---|---|---|
| **Amazon SQS FIFO queues**, message deduplication ID | การ send ซ้ำด้วย deduplication ID เดิม (หรือถ้าใช้ content-based deduplication ก็คือ body เดิม) จะถูกรับไว้แต่ไม่ถูกส่งเป็นครั้งที่สอง | เฉพาะภายใน deduplication interval 5 นาที และเฉพาะขาเข้า ส่วน message ที่ไม่ถูกลบก่อน visibility timeout หมดจะถูกรับอีกครั้ง |
| **Azure Service Bus**, duplicate detection | การ send ซ้ำด้วย `MessageId` เดิมภายใน detection window จะถูกรับไว้แล้วทิ้ง | window เป็น 10 นาทีโดย default และตั้งได้ตั้งแต่ 20 วินาทีถึง 7 วัน ส่วน Basic tier ไม่มีฟีเจอร์นี้ ส่วนที่ฝั่งรับ ถ้า lock ของ message แบบ peek-lock หมดอายุ message ก็จะถูกส่งอีกครั้ง |
| **Google Cloud Pub/Sub**, exactly-once delivery | ไม่มีการส่งซ้ำเมื่อ message ถูก acknowledge สำเร็จแล้ว และไม่มีระหว่างที่ acknowledgement deadline ยังไม่หมด | เฉพาะ pull subscription และเฉพาะ subscriber ที่เชื่อมต่อใน region เดียว ส่วน publisher ที่ retry จะสร้าง message ที่ ID ต่างกัน และพวกนี้จะไม่ถูกตัดตัวซ้ำ และ message ที่ deadline หมดก็ยังถูกส่งซ้ำ |
| **Apache Kafka**, idempotent producer (`enable.idempotence` เปิดไว้โดย default) | ตัวซ้ำที่เขียนจาก retry ของ producer เอง: broker ให้ ID กับ producer แต่ละตัว และใช้ sequence number ทิ้งตัวที่ซ้ำ | ฝั่ง producer เท่านั้น ส่วน consumer ที่ crash หลัง process record แต่ก่อน commit offset จะอ่าน record นั้นอีกครั้ง |
| **Apache Kafka**, transactions | loop แบบ consume-process-produce จะ commit output record และ input offset ไปพร้อมกันแบบ atomic | ผลภายใน Kafka เท่านั้น สำหรับ output ที่เขียนไปที่อื่น เอกสารของ Kafka แนะนำให้เก็บ offset ไว้ที่เดียวกับ output |

ทั้งหมดทำงานภายในขอบเขตของ broker เอง ไม่มีตัวไหนรู้ได้ว่าการเขียน database, email หรือ call ไปที่ payment provider ของ handler คุณเกิดขึ้นแล้วหรือยัง consumer เลยยังต้องมีด่านของตัวเองสำหรับเรื่องพวกนั้น

### แนวคิดเดียวกันสำหรับ HTTP API

API แบบ synchronous ก็มีปัญหาเดียวกัน แค่เป็น client ที่ retry `POST` แทน broker ที่ส่ง message ซ้ำ client ส่ง key ที่ไม่ซ้ำกันไปกับ request แล้ว server ก็เก็บ key ไว้พร้อมผลลัพธ์ ตัวที่ซ้ำจะได้ผลลัพธ์ที่เก็บไว้แทนการรันครั้งที่สอง นี่คือสิ่งที่ payment provider ทำใน step 4 ของ diagram

ตัวที่ใช้กันทั่วไปคือ request header `Idempotency-Key` มันเป็นธรรมเนียมที่ใช้กันแพร่หลาย ไม่ใช่มาตรฐาน: draft ของ IETF HTTPAPI working group ชื่อ *The Idempotency-Key HTTP Header Field* ไปถึง version 07 ในเดือนตุลาคม 2025 แล้วก็หมดอายุในเดือนเมษายน 2026 โดยไม่ได้เป็น RFC ตัว draft เล็งไปที่ `POST` และ `PATCH` (HTTP นิยาม `PUT` และ `DELETE` ว่า idempotent อยู่แล้ว) และแนะนำ `400` เมื่อไม่มี key ที่ต้องมี, `409` เมื่อ retry มาถึงตอนที่ request แรกยังทำอยู่ และ `422` เมื่อใช้ key ซ้ำกับ payload ที่ต่างไป

API ของ Stripe คือ implementation ที่ถูกลอกตามกันเยอะ v1 API ของมันรับ header นี้บน `POST` request แล้วเก็บ status code และ body ของ request แรกที่ใช้ key นั้นไว้ แล้วคืนค่าเหล่านั้นให้ทุก request หลังจากนั้นที่ใช้ key เดียวกัน แม้ผลลัพธ์แรกจะเป็น error ก็ตาม มันปฏิเสธ key ที่กลับมาพร้อม parameter ที่ต่างไป และอาจลบ key ทิ้งเมื่ออายุครบ 24 ชั่วโมง ส่วน v2 API ของมันจำ replay ได้ 30 วัน และรัน request ใหม่ถ้าครั้งแรกล้มเหลว AWS อธิบาย contract แบบเดียวกันสำหรับ API ของตัวเองใน Amazon Builders' Library: request identifier ที่ผู้เรียกเป็นคนให้, response ที่เทียบเท่ากันสำหรับตัวที่ซ้ำ และ error เมื่อใช้ identifier ซ้ำกับ parameter ที่ต่างไป

## ใช้ตอนไหนดี

- consumer ทุกตัวบน channel แบบ at-least-once ที่ผลของมันไม่ idempotent โดยธรรมชาติ: ตัดเงิน ส่ง เพิ่มค่า ต่อท้าย หรือเรียก API ที่สร้างอะไรบางอย่าง
- ปลายทางของ [transactional outbox](../transactional-outbox/) หรือ change data capture ที่เลี่ยงการทำ event หายด้วยการยอมให้ event ซ้ำ
- participant ใน [saga](../saga-orchestration/) ที่ command, reply และ compensation ถูก retry ทั้งหมด
- function ที่ถูก trigger จาก queue และ stream ([serverless](../serverless/)) เช่น event source mapping ของ AWS Lambda ประมวลผลแต่ละ event แบบ at least once
- ตัวรับ webhook และ HTTP API ที่ client [retry](../retry-with-backoff/)
- **ไม่ต้องใช้** ถ้า handler เป็น idempotent โดยธรรมชาติ: มัน set ค่า, upsert ด้วย business key หรือ delete และ message แซงกันไม่ได้ หรือเมื่อตัวซ้ำที่โผล่มาบ้างเป็นครั้งคราวไม่มีผลเสีย อย่าง metric หรือ cache warming

## ได้อะไร เสียอะไร

- **ทุก message ต้องมีหนึ่งแถวและการเขียนหนึ่งครั้ง** ตารางโตตาม traffic และต้องตัดทิ้งเป็นระยะ และแต่ละ message ต้องเสีย insert และ index update เพิ่มอีกหนึ่งครั้งภายใน transaction
- **ความจำมีขอบเขต** พอ ID ถูกลบไปแล้ว ตัวซ้ำที่มาช้าจะถูกประมวลผลอีกรอบ retention เลยต้องครอบการส่งซ้ำหรือ replay ที่นานที่สุดที่ยังเกิดขึ้นได้
- **มันพึ่ง atomicity** สิ่งที่รับประกันจะเป็นจริงก็ต่อเมื่อ marker commit ไปพร้อมกับผลของงาน ส่วน store สำหรับตัดตัวซ้ำที่อยู่นอก transaction (cache, database อีกตัว) จะเปิดช่องให้งานหายหรือซ้ำได้ถ้าเกิด crash
- **มันหยุดที่ database ของคุณ** ผลในระบบอื่นจะถูกครอบก็ต่อเมื่อระบบนั้นรองรับ idempotency key หรือ operation นั้น idempotent อยู่แล้ว
- **มันไม่ได้เรียง message ตามลำดับ** และไม่ช่วยอะไรกับ message ที่ล้มเหลวทุกครั้ง: นั่นเป็นหน้าที่ของ dead-letter queue
- **มันเชื่อ ID** producer ที่ใช้ ID ซ้ำกับ message คนละตัว จะทำให้ message นั้นถูกทิ้งไปเงียบ ๆ ส่วน producer ที่สร้าง ID ใหม่ทุกครั้งที่ retry ก็ทำให้การเช็กไร้ผล

## ข้อควรรู้ตอนลงมือทำ

- **การ insert** ใน PostgreSQL ตัว `ON CONFLICT DO NOTHING` เปลี่ยนตัวซ้ำให้เป็น "insert ได้ศูนย์แถว" แทนที่จะเป็น error ทำให้ handler แยกทางตามจำนวนแถวได้:

  ```sql
  BEGIN;
  INSERT INTO processed_messages (message_id) VALUES ('m-7f3')
    ON CONFLICT DO NOTHING;
  -- 0 rows inserted: a duplicate. Commit, acknowledge and stop.
  -- 1 row inserted: the first delivery. Do the work in the same transaction:
  INSERT INTO payments (order_id, amount) VALUES (1042, 40);
  COMMIT;  -- acknowledge only after this
  ```

- **Race ไม่ต้องเขียนโค้ดเพิ่ม** ถ้ามีหลาย instance ดึงจาก queue เดียวกัน (competing consumers) สองตัวอาจถือ message เดียวกันอยู่พร้อมกันได้ตอน lease ของ handler ที่ช้าหมดเวลา ถ้า marker กับงานอยู่ใน transaction เดียวกัน ตัว database จะเป็นคนตัดสิน race นั้นเอง ใน PostgreSQL การ insert ครั้งที่สองจะรอให้ transaction แรกจบก่อน: ถ้าตัวแรก commit ได้ ตัวที่สองก็จะเจอ conflict แต่ถ้าตัวแรก rollback ไป ตัวที่สองก็ทำต่อและทำงานนั้นเอง
- **สถานะ in-progress สำหรับงานที่ยาว** ถ้างานใช้เวลานาน หรือมี call ที่อยู่ใน transaction ไม่ได้ ให้บันทึกสถานะแทนที่จะเป็นแค่ ID: insert ID เป็น `in progress` พร้อม deadline แล้ว commit จากนั้นทำงาน แล้วค่อย mark เป็น `completed` และเก็บผลลัพธ์ไว้ การส่งครั้งที่สองที่เจอ `in progress` จะ back off ส่วนตัวที่เจอว่า deadline ผ่านไปแล้วจะรับงานต่อ และตัวที่เจอ `completed` จะคืนผลลัพธ์ที่เก็บไว้ idempotency utility ของ Powertools for AWS Lambda ทำงานแบบนี้ โดยใช้ DynamoDB หรือ cache ที่เข้ากันได้กับ Redis เป็น store และ record จะหมดอายุหลังหนึ่งชั่วโมงโดย default และเพราะการรับงานต่อทำให้งานถูกทำซ้ำ แต่ละขั้นข้างในเลยยังต้องทำซ้ำได้อย่างปลอดภัย
- **เก็บ ID ไว้นานแค่ไหน** อย่างน้อยก็นานเท่าที่ตัวซ้ำยังมาถึงได้: retention period ของ queue (ใน SQS default 4 วัน สูงสุด 14) บวก dead-letter queue ที่คุณอาจ replay บวกช่วงเวลา retry ของ producer เอง ลบแถวที่เก่ากว่านั้นเป็น batch หรือแบ่ง partition ตารางตามวันแล้ว drop ทั้ง partition ไปเลย ส่วน store ที่มี time-to-live ทำเรื่องนี้ให้ แต่ต้องเช็กว่ามันตรงเวลาแค่ไหน: DynamoDB ลบ item ที่หมดอายุภายในไม่กี่วัน ไม่ใช่วินาทีที่มันหมดอายุ
- **ลำดับเป็นอีกปัญหาหนึ่ง** ตัวซ้ำของ message เก่าอาจมาถึงหลังตัวที่ใหม่กว่า ตัว ID ที่เก็บไว้ยังจับมันได้ แต่ handler ที่พึ่งการเขียนที่ idempotent โดยธรรมชาติ (`SET status = 'PAID'`) จะเขียนทับ state ที่ใหม่กว่าด้วยของเก่า ให้การเขียนแบบนี้มี version หรือ sequence number และ apply message ก็ต่อเมื่อมันใหม่กว่าที่แถวนั้นเคยเห็น บน log ที่เรียงลำดับอย่าง Kafka partition จะใช้ตำแหน่งแทนตาราง ID ก็ได้: เก็บ offset ของ record ล่าสุดที่ apply ไว้ข้าง ๆ output แล้วข้ามทุกอย่างที่อยู่ที่ offset นั้นหรือต่ำกว่า ส่วน projection ใน [event sourcing](../event-sourcing/) ก็ทำแบบเดียวกัน
- **Remote call** สร้าง key ปลายทางจาก message ID แยก key ต่อ call (`m-7f3:charge`) เพื่อให้ทุกครั้งที่ retry ใช้ key เดิม ส่วน call ที่ทำข้างใน database transaction ที่เปิดอยู่จะถือ connection ไว้นานเท่ากับที่อีกฝั่งใช้เวลา ถ้าแบบนั้นเป็นปัญหา ให้ทำ call ก่อนแล้วค่อยเปิด transaction ทีหลัง: การส่งซ้ำก็จะทำ call ซ้ำ แต่ key ทำให้มันไม่มีผลเสีย
- **เลือก operation ที่ idempotent โดยธรรมชาติ** `UPDATE orders SET status = 'PAID'` รันสองครั้งได้ แต่ `UPDATE accounts SET balance = balance - 40` ไม่ได้ ส่วน upsert ที่ set ค่า (`INSERT ... ON CONFLICT DO UPDATE` ใน PostgreSQL) เป็น atomic และรันสองครั้งได้อย่างปลอดภัย เก็บตาราง processed-ID ไว้ใช้กับงานที่เขียนแบบนั้นไม่ได้
- **Acknowledge เป็นอย่างสุดท้าย** ถ้า acknowledge ทันทีที่ได้รับ ก่อน commit จะทำให้ consumer กลายเป็น at-most-once: crash ใน handler จะทำ message หาย
- **Redelivery flag เป็นแค่คำใบ้** RabbitMQ ตั้ง redelivery flag บนการส่งซ้ำ และ broker อื่นก็มี delivery count ให้ดู ทั้งสองอย่างไม่ได้บอกว่าความพยายามครั้งก่อน commit ไปหรือยัง มันเลยเป็นแค่ตัวกระตุ้นให้เช็ก แต่ใช้แทนการเช็กไม่ได้
- **Library** messaging framework มักมีเรื่องนี้มาให้ในรูปของ *inbox* ข้าง ๆ outbox ของมัน ตัว Eventuate framework ทำตารางตามที่ microservices.io อธิบายไว้ ใน .NET ตัว NServiceBus Outbox เก็บ ID ของ message ขาเข้าแต่ละตัวไว้ใน transaction เดียวกับข้อมูลธุรกิจ และข้าม handler เมื่อ ID นั้นกลับมาอีก ส่วน consumer outbox ใน MassTransit ก็เก็บ inbox ของ message ที่ได้รับไว้เพื่อจุดประสงค์เดียวกัน
- **Test และคอยดู** ส่งทุก message สองครั้งใน integration test ส่วนใน production ให้นับตัวซ้ำที่ข้ามไป: ถ้าจู่ ๆ เพิ่มขึ้น มักแปลว่ามี handler ที่ช้ากว่า visibility timeout หรือ lock ของมันไปแล้ว
