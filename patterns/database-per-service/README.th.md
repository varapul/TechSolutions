## ปัญหา

ถ้าหลาย service ใช้ database ตัวเดียวกัน พวกมันก็ผูกกันผ่าน schema ของ database นั้น ทุกตารางกลายเป็น public interface และไม่มีใครจดไว้ว่าใครพึ่งพามันบ้าง Martin Fowler เรียกแบบนี้ว่า *integration database* และบอกว่า architect ส่วนใหญ่ที่เขานับถือแนะนำให้เลี่ยง ในทางปฏิบัติ:

- **ทุกการเปลี่ยนแปลงต้องนัดประชุม** การเปลี่ยนชื่อ column การแยกตาราง หรือการเปลี่ยน type ทำให้ query ในโค้ดของอีกทีมพังได้ การเปลี่ยน schema ต้องประสานกันข้ามทีม แล้วการ deploy ก็ไถลกลับไปต้องทำพร้อมกันทีละขั้นเหมือนเดิม
- **service ต้องล้มด้วยกัน** report หนัก ๆ หรือ transaction ยาว ๆ ใน service หนึ่ง แย่ง CPU, I/O, lock และ connection ชุดเดียวกันกับการเขียนของทุก service ส่วน migration ที่พลาด หรือ database ที่ล่ม ก็ทำให้ทุกตัวล่มไปพร้อมกัน
- **ไม่มีใครเป็นเจ้าของข้อมูล** พอไม่มีบันทึกว่า service ไหนอ่านตารางไหน ก็ไม่มีใครแก้หรือเก็บกวาดตารางได้อย่างปลอดภัย และ business rule ของข้อมูลชุดเดียวกันก็กระจายอยู่ในหลาย codebase
- **engine เดียวต้องรองรับทุกงาน** customer profile, payment ledger และ session store อยู่ใน database ชนิดเดียวกันหมด ไม่ว่ามันจะเหมาะหรือไม่

ผลที่ได้บางทีก็ถูกเรียกว่า distributed monolith: service ที่ deploy แยกกัน แต่ยังต้องเปลี่ยนไปพร้อมกัน

## ทำงานยังไง

**แต่ละ service เป็นเจ้าของข้อมูลของตัวเอง** มีแค่ service เจ้าของที่อ่านและเขียนตารางของมัน service อื่นทั้งหมดต้องถามผ่าน API ของเจ้าของ หรือฟัง event ที่เจ้าของ publish ตอนข้อมูลเปลี่ยน local transaction จะแตะแค่ store ของเจ้าของเท่านั้น

แบบนี้ได้คืนสิ่งที่ database ที่ใช้ร่วมกันเคยเอาไป:

- **เปลี่ยนได้อย่างอิสระ** service เปลี่ยนชื่อ column จัดโครงตารางใหม่ หรือย้ายไปใช้ engine อื่นได้โดยไม่ต้องถามใคร ตราบใดที่ API และ event ของมันยัง compatible
- **scale ได้อย่างอิสระ** แต่ละ store ถูกกำหนดขนาด replicate หรือ shard ตาม load ของ service ตัวเอง
- **แยก failure ออกจากกัน** query ที่วิ่งไม่หยุดหรือการล่มใน store หนึ่งจะอยู่แค่ใน service เดียว
- **เลือก store ได้อิสระ** แต่ละ service เลือกชนิดของ store ที่เหมาะกับข้อมูลของตัวเอง: document store สำหรับ customer profile, relational database สำหรับ payment ledger, key-value store สำหรับ session ส่วน Fowler เรียกแบบนี้ว่า *polyglot persistence* แต่เทคโนโลยีที่เพิ่มขึ้นแต่ละตัวก็คือของอีกตัวที่ต้องเรียนรู้ ทำให้ปลอดภัย และดูแล เลยควรใช้อิสระนี้เมื่อมันคุ้ม

Private หมายถึงความเป็นเจ้าของ ไม่ได้แปลว่าต้องแยก hardware เสมอไป ระดับการแยกที่ใช้กันทั่วไป เรียงจากถูกที่สุดไปจนแยกขาดที่สุด:

| ระดับ | แต่ละ service ได้อะไร | การแยกและต้นทุน |
|---|---|---|
| Private table | ตารางของตัวเองใน schema ที่ใช้ร่วมกัน โดย grant ให้แค่ database user ของตัวเอง | ถูกที่สุด ขอบเขตเป็นแค่ชุดของ grant ที่ตั้งผิดได้ง่าย และ service ก็ยังแย่ง server ตัวเดียวกันอยู่ |
| Schema per service | schema และ database role ของตัวเอง ไม่ grant ให้ role อื่นเข้าถึง | ถูก และขอบเขตชัด แต่ทุกคนก็ยังใช้ CPU, memory, I/O, version และ maintenance window ของ server ตัวเดียวกัน |
| Database per service | database ของตัวเองบน server ที่ใช้ร่วมกัน | connection ของ PostgreSQL เห็นแค่ database เดียว การ join ข้าม service เลยต้องใช้ extension อย่าง `postgres_fdw` และไม่มีทางเกิดขึ้นโดยบังเอิญ แต่ก็ยังมี server ตัวเดียวที่อาจรับไม่ไหวหรือล่มได้ |
| Server per service | database server หรือ managed instance ของตัวเอง | scale, ล้ม, upgrade และเลือก engine ได้อิสระ แต่มีของต้องดูแลและต้องจ่ายมากที่สุด |

ใน MySQL ตัว schema *ก็คือ* database (`CREATE SCHEMA` เป็นคำพ้องของ `CREATE DATABASE`) สองระดับตรงกลางเลยเป็นอันเดียวกันใน MySQL ส่วน Chris Richardson ชี้ว่า private table กับ schema per service มี overhead ต่ำที่สุด และแนวทางของ Azure ก็บอกว่า service ใช้ physical server ร่วมกันได้อย่างปลอดภัย: ปัญหาเริ่มตอนที่ใช้ schema ร่วมกัน หรือใช้ตารางเดียวกัน

## ใช้ตอนไหนดี

- service ที่คนละทีมเป็นเจ้าของ และต้อง deploy, scale และล้มได้อย่างอิสระ คำสัญญาของ [microservices](../microservices/) ตั้งอยู่บนเรื่องนี้: service ที่ใช้ตารางร่วมกันเปลี่ยนแยกกันไม่ได้
- service ที่ต้องการ storage ต่างกันจริง ๆ: data model, scale, availability หรือ (ตามที่แนวทางของ AWS ลิสต์ไว้) ข้อกำหนดด้าน compliance และ security ที่ต่างกัน
- **ไม่ใช่** สำหรับทีมเดียวที่ ship deployable ตัวเดียว [modular monolith](../modular-monolith/) ที่มี schema ต่อ module และมี grant กันไม่ให้แต่ละ module เข้า schema ของ module อื่น ได้ความเป็นเจ้าของที่ชัดเจน โดยยังมี local ACID transaction, join และ database ตัวเดียวให้ดูแล ให้ module มี store ของตัวเองเมื่อมันกลายเป็น service แยกจริง ๆ
- **ไม่ใช่** ตอนที่สอง service ทำอะไรไม่ได้เลยถ้าไม่มีข้อมูลของอีกฝั่งใน transaction เดียวกัน แบบนั้นมักแปลว่าวางขอบเขตผิดที่ และสองตัวนั้นควรอยู่ด้วยกัน

## ได้อะไร เสียอะไร

- **Query ที่ข้าม service** join ข้าม store ไม่ได้ วิธีแรกคือ *API composition* (ทำในตัวผู้เรียก ใน [API gateway](../api-gateway/) หรือใน [backend for frontend](../backends-for-frontends/)) ทำง่าย แต่คำตอบต้องรอ call ที่ช้าที่สุด ทำงานแย่ลงหรือล้มเหลวเมื่อมี service ล่มสักตัว และการ join result set ใหญ่ ๆ ใน memory ก็ไม่มีประสิทธิภาพ ส่วน *read model ที่ป้อนด้วย event* ([CQRS](../cqrs/), [materialized view](../materialized-view/)) เร็ว และยังทำงานได้ตอนต้นทางล่ม แลกกับ eventual consistency และชิ้นส่วนที่ขยับได้มากขึ้น report และ analytics ควรอยู่ใน store แยกที่ป้อนด้วย [change data capture](../change-data-capture/) หรือ event ไม่ใช่ใช้ query เฉพาะกิจยิงไปที่ database ของทุก service
- **ข้อมูลซ้ำ** การมีสำเนาเป็นเรื่องปกติ ตราบใดที่ทุก fact มี source of truth เดียวพอดี คือ service เจ้าของ สำเนาเป็นแบบ read-only, eventually consistent และมีแค่ field ที่ service ของมันต้องใช้ ถ้า service เริ่มเขียนลงสำเนาของตัวเอง ก็จะมี source of truth สองที่ขึ้นมาทันที
- **ไม่มี foreign key ข้าม service** เก็บ ID ของ service อื่นไว้ ไม่ใช่ constraint ทำให้ database ห้าม order ไม่ให้ชี้ไปที่ customer ที่ถูกลบไปแล้วไม่ได้อีกต่อไป เลยต้องตอบสนองต่อ event ของเจ้าของ (เช่น `CustomerDeleted`) และตัดสินใจว่า ID ที่ห้อยค้างอยู่หมายถึงอะไร: ซ่อน ทำให้เป็น anonymous หรือเก็บไว้เป็นประวัติ
- **ไม่มี distributed transaction** การทำ two-phase commit ข้าม store มักใช้ไม่ได้: NoSQL database และ message broker หลายตัวไม่รองรับ และมันผูก availability ของทุกผู้เข้าร่วมเข้าด้วยกัน business transaction เลยกลายเป็น saga: สาย local transaction ที่เชื่อมกันด้วย event ([choreography](../saga-choreography/)) หรือถูกขับโดย [orchestrator](../saga-orchestration/) ถ้าขั้นไหนล้มเหลว ขั้นที่ commit ไปแล้วจะถูกย้อนด้วย [compensating transaction](../compensating-transaction/) เช่นการคืนเงินหรือการยกเลิก พวกนี้เป็น business operation ใหม่ ไม่ใช่ rollback และ saga ไม่มี isolation: request อื่นเห็น state ระหว่างทางของมันได้ (order ที่ยัง `PENDING` อยู่) การออกแบบเลยต้องเผื่อเรื่องนี้ไว้
- **ต้นทุนการดูแล** มี store ให้ provision, patch, backup, ทดสอบ restore, monitor, ทำให้ปลอดภัย และจ่ายเงินมากขึ้น backup ของแต่ละ store ก็ไม่ consistent กันอีกแล้วด้วย: restore store หนึ่งกลับไปเมื่อคืน แล้ว store อื่นอาจชี้ไปที่ข้อมูลที่ store นั้นไม่มีแล้ว

## ข้อควรรู้ตอนลงมือทำ

- **บังคับความเป็นเจ้าของใน database ไม่ใช่แค่ตกลงกันปากเปล่า** ให้ทุก service มี database user หรือ role ของตัวเอง และเก็บ credential ไว้ใน secret ของ service นั้นเอง อย่าใช้ admin account หรือ application account ร่วมกันระหว่าง service ส่วนใน PostgreSQL ตัว role จะใช้ object ใน schema ที่ไม่ได้เป็นเจ้าของไม่ได้ จนกว่าเจ้าของจะ grant `USAGE` ให้ และตั้งแต่ PostgreSQL 15 เป็นต้นมา role ธรรมดาก็สร้าง object ใน schema `public` ของ database ใหม่โดย default ไม่ได้แล้ว บน cloud ให้จำกัด identity ของแต่ละ service (IAM role, managed identity) ไว้ที่ store ของตัวเอง และให้ network rule ยอมแค่ workload ของเจ้าของ
- **มี review และ tooling คอยช่วย** ปฏิเสธการเปลี่ยนแปลงที่เพิ่ม connection string หรือชื่อตารางของ service อื่นเข้ามา ก่อนย้ายตาราง ให้เช็ก audit log หรือ query statistics ดูว่ายังมีใครอ่านมันอยู่
- **ย้ายออกจาก database ที่ใช้ร่วมกัน** ขั้นแรก ตัดสินว่า service ไหนเป็นเจ้าของแต่ละตาราง และแยกตารางที่มีเจ้าของปนกันสองราย แล้วให้ service อื่นวิ่งผ่าน API หรือ event ของเจ้าของ ระหว่างที่ข้อมูลยังอยู่ใน database ที่ใช้ร่วมกัน หลังจากนั้นถึงค่อยย้ายข้อมูลไปที่ private store ของเจ้าของทีละตาราง: ย้ายผู้เรียกไปทีละน้อย ([strangler fig](../strangler-fig/)) เปลี่ยน schema เป็นขั้นที่ backward compatible ([expand and contract](../expand-and-contract/)) และ sync สำเนาเก่ากับใหม่ไว้ด้วย [change data capture](../change-data-capture/) จนกว่า reader และ writer ทุกตัวจะย้ายไปหมด สุดท้ายก็ revoke grant เก่าแล้ว drop ตารางเก่า หนังสือ *Monolith to Microservices* ของ Sam Newman อธิบายการย้ายพวกนี้ไว้ละเอียด
- **Publish event ให้เชื่อถือได้** บันทึก event แต่ละตัวใน local transaction เดียวกับการเปลี่ยนแปลง ([transactional outbox](../transactional-outbox/)) หรือสร้าง event จาก log ของ database ด้วย change data capture ตัว broker ส่งซ้ำได้ ทำให้ consumer ต้อง [idempotent](../idempotent-consumer/)
- **ให้สำเนาเล็กและสร้างใหม่ได้** read model ควรเก็บแค่ field ที่ service ของมันต้องใช้ บันทึกว่าข้อมูลมาจากไหน และสร้างใหม่ได้จาก event หรือ API ของเจ้าของ
