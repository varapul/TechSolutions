## ปัญหา

monolith เก็บทุก capability ไว้ใน codebase เดียวที่ build, เทสต์ และ deploy เป็นหน่วยเดียว และปกติก็วางอยู่บน database ก้อนเดียวที่ใช้ร่วมกัน สำหรับ product ที่ยังใหม่และทีมเล็ก ๆ นี่คือทางเลือกที่ถูก แต่พอ product และองค์กรโตขึ้น คุณสมบัติเดิมพวกนี้ก็เริ่มทำให้เจ็บ

- **ทุกการแก้ต้องปล่อยไปพร้อมกัน** ทีมต้องต่อคิวรอ release train ขบวนเดียว bug ของทีมหนึ่งกัก release ของทุกคน และ fix แค่บรรทัดเดียวก็ต้อง redeploy ทุกอย่าง
- **ทุกอย่าง scale ไปพร้อมกัน** catalog รับโหลดไปเกือบหมด แต่ทางเดียวที่จะเพิ่ม capacity คือรันทั้งแอปพลิเคชันเพิ่มอีกหลายชุด
- **database ที่ใช้ร่วมกันผูกทุกอย่างไว้ด้วยกัน** module ไหนก็อ่านหรือเขียน table ไหนก็ได้ การเปลี่ยน schema ของทีมหนึ่งเลยทำโค้ดของอีกทีมพังได้ และไม่มีใครแน่ใจว่าใครพึ่งอะไรอยู่บ้าง
- **ความผิดพลาดจุดเดียวล้มได้ทั้งระบบ** memory leak หรือ query ที่วิ่งไม่หยุดใน module หนึ่ง ใช้ process, connection pool และ database ร่วมกับ module อื่นทั้งหมด
- **stack เดียวสำหรับทุกอย่าง** ทุก capability ถูกผูกไว้กับภาษา framework และ database ตัวเดียวกัน จะเหมาะหรือไม่เหมาะก็ตาม

## ทำงานยังไง

James Lewis กับ Martin Fowler อธิบายสไตล์นี้ว่าเป็น "แนวทางการพัฒนาแอปพลิเคชันหนึ่งตัวให้เป็นชุดของ service เล็ก ๆ แต่ละตัวรันใน process ของตัวเอง และคุยกันด้วยกลไกที่เบา บ่อยครั้งก็เป็น HTTP resource API" ในทางปฏิบัติก็คือ

- **หนึ่ง business capability ต่อหนึ่ง service** ขอบเขตตาม domain (catalog, orders, payments, inventory) ปกติคือ bounded context จาก domain-driven design ไม่ใช่ตาม layer ทางเทคนิคอย่าง UI, logic และ data
- **deploy แยกกันได้** แต่ละ service มี codebase, pipeline, version และตาราง release ของตัวเอง และ scale ได้เอง การปล่อย Payments v2 ไม่ต้องรอ release ของใครเลย
- **เป็นเจ้าของข้อมูลตัวเอง** service เก็บข้อมูลไว้เป็นของส่วนตัว (table, schema หรือ database server ของตัวเอง) และ service อื่นเข้าถึงได้ผ่าน API หรือ event ของมันเท่านั้น ไม่มีทาง query table ของมันตรง ๆ แต่ละตัวเลือก storage ที่เหมาะกับตัวเองได้
- **คุยกันอย่างตั้งใจ** การเรียกแบบ synchronous (HTTP หรือ gRPC) เหมาะกับ query ที่ตัวเรียกต้องการคำตอบตอนนี้เลย ส่วนการเปลี่ยน state ที่ service อื่นสนใจ ให้ส่งออกไปเป็น event แบบ asynchronous ผ่าน broker ([Event-Driven Architecture](../event-driven-architecture/)) ฝั่งที่ publish จะได้ไม่ต้องพึ่งว่า consumer ต้องออนไลน์อยู่ หรือแม้แต่ต้องรู้ว่ามี consumer ตัวไหนบ้าง
- **Smart endpoints, dumb pipes** business logic อยู่ใน service ส่วน gateway กับ broker แค่ route และส่ง message ไม่ได้ถือ business rule อะไรไว้
- **ออกแบบเผื่อพัง** remote call ไหนก็พังหรือค้างได้ ตัวเรียกเลยต้องใช้ timeout และ fallback และ service ที่ล่มควรทำให้แค่ feature เดียวทำงานแย่ลง ไม่ใช่ทั้งระบบ

รอบ ๆ service มี infrastructure ที่ใช้ร่วมกัน คือ [API Gateway](../api-gateway/) ที่เป็นทางเข้าเดียวของ client, message broker, container platform ที่จัดตารางรัน restart และ scale แต่ละ service และ observability ที่ตาม request เดียวข้ามทุก service ได้

**ทีมกับ Conway's law** Melvin Conway สังเกตไว้ตั้งแต่ปี 1968 ว่าการออกแบบของระบบจะลงเอยด้วยการลอกโครงสร้างการสื่อสารขององค์กรที่ออกแบบมัน microservices ใช้ข้อนี้ให้เป็นประโยชน์ แต่ละ service เป็นของทีมเดียวที่อยู่ยาว ทีมนั้นสร้างมันและรันมันบน production และขอบเขตของ service ก็ขีดไว้ตรงที่ทีมควรทำงานได้โดยไม่ต้องประสานกัน การจัดทีมใหม่เพื่อให้ได้ architecture ที่ต้องการเรียกว่า *inverse Conway maneuver* มันช่วยได้ แต่อย่างเดียวแก้ architecture ที่แข็งทื่อไม่ได้ service ที่หลายทีมต้องแก้ไปพร้อมกัน หรือ feature ที่ต้องรอ release จากสามทีมทุกครั้ง แปลว่าขอบเขตกับองค์กรไม่ตรงกัน

**service ควรใหญ่แค่ไหน** ขนาดเป็นผลลัพธ์ ไม่ใช่เป้าหมาย ให้เริ่มคิดจาก business capability โดย service ควรเล็กพอที่ทีมเดียวจะเป็นเจ้าของและเข้าใจได้ และใหญ่พอที่การแก้ส่วนใหญ่จะจบอยู่ข้างใน ของที่เปลี่ยนไปด้วยกันควรอยู่ด้วยกัน สอง service ที่ต้อง deploy พร้อมกันทุกครั้ง หรือเรียกกันหลายรอบต่อ request เดียว น่าจะเป็น service เดียวที่ถูกตัดผิดที่ คือ *distributed monolith* ที่แบกต้นทุนทั้งหมดข้างล่างแต่ได้ประโยชน์น้อย การแยก service ที่หยาบไว้ทีหลังตามรอยต่อที่พิสูจน์แล้วว่านิ่ง ปกติถูกกว่าการรวม service ที่ตัดไว้ละเอียดเกินไป

## ใช้ตอนไหนดี

- มีหลายทีมส่งงานบน domain ที่ใหญ่และซับซ้อน และการนัด release พร้อมกันกลายเป็นคอขวด
- ส่วนต่าง ๆ ของระบบมีความต้องการต่างกันชัดเจน ทั้งเรื่อง scale, availability, ความถี่ของ release, security หรือเทคโนโลยี
- เรา provision, deploy และ monitor service ได้อัตโนมัติ และทีมที่สร้าง service ก็พร้อมจะรันมันเอง ถ้าไม่มีข้อนี้ service จำนวนมากก็แค่ทวีงานจุกจิก
- **ไม่**เหมาะกับทีมเล็ก product ช่วงแรกที่ domain ยังเปลี่ยนไปมา หรือระบบที่ไม่ได้ใหญ่ขนาดนั้น Fowler บอกว่า microservices มี premium สูงที่จะคุ้มก็ต่อเมื่อระบบซับซ้อนกว่านั้น และเรื่องสำเร็จของ microservice แทบทั้งหมดเริ่มจาก monolith ที่โตจนใหญ่เกินแล้วถูกแยกออก ให้เริ่มด้วย **modular monolith** แทน คือ deployable ตัวเดียวที่ประกอบจาก module ที่แบ่งขอบเขตเข้มงวด คุยกันผ่าน interface ที่ประกาศชัดเจน และแต่ละตัวเก็บ table ของตัวเอง มันให้ประโยชน์ด้านการออกแบบเกือบทั้งหมดโดยไม่ต้องจ่ายค่า distributed system ทำให้หาขอบเขตที่ถูกได้ตอนที่ยังย้ายได้ถูก ๆ และ module ที่สะอาดก็คือสิ่งที่แยกออกไปทีหลังง่ายที่สุดด้วย pattern [Strangler Fig](../strangler-fig/)

## ได้อะไร เสียอะไร

เราแลกความซับซ้อนใน codebase เดียว กับความซับซ้อนระหว่างหลาย process และแบบหลังแพงกว่า

- **network** การเรียกใน process กลายเป็น remote call ที่ช้ากว่า และ timeout หรือพังกลางทางได้ ทุกการเรียกต้องมี timeout การ retry ต้องใช้ operation ที่ idempotent และ [Circuit Breaker](../circuit-breaker/) ก็กันไม่ให้ dependency ที่ช้าตัวเดียวดึงตัวเรียกค้างไปด้วย chain แบบ synchronous ทบกันขึ้นเรื่อย ๆ ถ้าสาม service ใน chain แต่ละตัว available 99.9% ของเวลา ทั้ง chain จะ available แค่ประมาณ 99.7% ของเวลา
- **consistency** ไม่มี ACID transaction ข้าม service ทำให้ข้อมูลเป็น eventually consistent อย่างใน diagram ตัว order ถูกรับก่อนจะจ่ายเงิน และ UI กับ API ต้องออกแบบเผื่อเรื่องนี้ workflow ที่ข้ามหลาย service ใช้ [Saga](../saga-orchestration/) แทน distributed transaction การ update database แล้ว publish event ให้เชื่อถือได้ต้องใช้ transactional outbox หรือ change data capture ส่วน query ที่ join ข้อมูลของหลาย service ต้องใช้ API composition หรือ read model ที่สร้างจาก event ของ service เหล่านั้น (CQRS)
- **observability** request เดียวของ user ข้ามหลาย process ถ้าไม่มี correlation ID, log ที่รวมไว้ที่เดียว, metric ต่อ service และ [Distributed Tracing](../distributed-tracing/) การหาว่าพังหรือช้าตรงไหนก็เป็นการเดา
- **operation** service หลายสิบตัวแปลว่ามี pipeline, database, configuration, secret, dashboard และเวร on-call หลายสิบชุด ทำได้ก็ต่อเมื่อมี automation หนัก ๆ และปกติ platform team เป็นคนทำให้
- **contract กับการเทสต์** API และ event schema กลายเป็นสัญญาระหว่างทีม เปลี่ยนมันทีละขั้นแบบ backward-compatible ถ้าทำแบบนั้นไม่ได้ก็ทำ version ส่วนการเทสต์ให้ใช้ contract test แทนที่จะพึ่งแค่ environment end-to-end ที่ช้า
- **สิ่งที่ได้กลับมา:** deploy และ scale แยกกันได้ กันความล้มเหลวไม่ให้ลาม (ถ้าออกแบบการสื่อสารไว้รองรับ) ทีมเดินหน้าได้โดยไม่ต้องรอกัน และเลือกเทคโนโลยีต่อ service ได้อิสระ

## ข้อควรรู้ตอนลงมือทำ

- **การเรียกและ event** ใช้ HTTP/REST หรือ gRPC กับ request/response และใช้ broker อย่าง Apache Kafka, RabbitMQ, Amazon SNS คู่กับ SQS, Azure Service Bus หรือ Google Cloud Pub/Sub กับ event แล้วให้ service ที่ consume แต่ละตัวมี durable subscription หรือ consumer group ของตัวเอง consumer ที่ช้าหรือพังจะได้สะสม backlog ของตัวเองโดยไม่กระทบใคร และเก็บ event ไว้นานพอให้ผ่าน outage ที่นานที่สุดที่คาดไว้ได้
- **ความเป็นเจ้าของข้อมูล** table ส่วนตัว schema ส่วนตัว หรือ database server ส่วนตัวต่อ service ใช้ได้หมด ขอแค่ไม่มี service อื่นมาแตะ แยก schema บน server ที่ใช้ร่วมกันเป็นจุดเริ่มที่ถูกกว่า แต่ให้บังคับขอบเขตด้วย credential ไม่ใช่ด้วยข้อตกลง
- **platform** container บน orchestrator (Kubernetes หรือตัว managed อย่าง Azure Container Apps, Amazon ECS และ Google Cloud Run) จัดการเรื่อง placement, health check, restart และ autoscaling ต่อ service เช่น Kubernetes HorizontalPodAutoscaler เพิ่ม replica ให้แค่ service ตัวที่โหลดหนัก
- **traffic** API gateway ที่ขอบระบบจัดการ authentication, rate limit และ routing ส่วนระหว่าง service ก็ใช้ client library หรือ service mesh เพิ่ม mutual TLS, timeout, retry และการย้าย traffic
- **delivery** หนึ่ง pipeline ต่อหนึ่ง service ปล่อย release เล็ก ๆ ทีละน้อย ([Canary Release](../canary-release/), feature flag) และใช้ consumer-driven contract test กับ contract ของ HTTP และ message (เช่นด้วย Pact)
- **observability** ใส่ OpenTelemetry ให้ทุก service และส่ง trace context ไปใน header ของ message ด้วย เพื่อให้ trace ต่อเนื่องผ่าน broker
