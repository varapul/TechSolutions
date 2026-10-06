## ปัญหา

business rule ชอบไหลไปอยู่กับเทคโนโลยีอะไรก็ได้ที่อยู่ใกล้ ๆ กฎ "สั่ง order" ไปลงเอยอยู่บางส่วนใน controller ที่อ่าน HTTP request บางส่วนใน service ที่เขียนโดยใช้ ORM entity และบางส่วนใน callback ที่เรียก SDK ของ payment provider ในโค้ดไม่มีอะไรแยก*สิ่งที่ business ตัดสินใจ*ออกจาก*การที่ request เข้ามายังไง*และ*ผลลัพธ์ไปไหนต่อ* แล้วบิลก็มาเก็บทีหลัง

- จะลองรันกฎได้ก็ต้องผ่าน HTTP และต้องเปิด database ไว้ เทสต์เลยช้า เปราะ และมีน้อย
- ทางเข้าทางที่สอง (queue consumer, batch import, command line, API เวอร์ชันใหม่) ต้องก็อป logic มาจากทางแรก เพราะ logic อยู่ใน controller
- การเปลี่ยน database, payment provider หรือ web framework แปลว่าต้องแก้โค้ด business ทำให้การเลือกเทคโนโลยีช่วงแรกกลายเป็นของถาวร

## ทำงานยังไง

ขีดขอบเขตหนึ่งเส้นรอบ business logic และบังคับให้ทุกอย่างที่ข้ามเส้นนี้ต้องผ่าน interface ที่ประกาศไว้ชัดเจน

- **core** (ข้างใน hexagon) เก็บ domain model และ use case เป็นโค้ดธรรมดาที่ใช้ภาษาของ business เอง ไม่มี type ของ HTTP, SQL หรือ framework อยู่ข้างในเลย
- **port** คือ interface ที่อยู่บนขอบเขต และ core เป็นเจ้าของมัน ตัว **driving port** คือสิ่งที่แอปพลิเคชันให้บริการ (`PlaceOrder`) ส่วน **driven port** คือสิ่งที่แอปพลิเคชันต้องใช้จากข้างนอก (`OrderRepository`, `PaymentGateway`, `EventPublisher`)
- **adapter** อยู่ข้างนอก แต่ละตัวต่อเทคโนโลยีหนึ่งเข้ากับ port หนึ่ง **driving adapter** (REST controller, message consumer, command line, เทสต์) แปลง request จากข้างนอกเป็นการเรียกบน driving port ส่วน **driven adapter** (SQL repository, payment client, broker publisher, in-memory fake) implement driven port โดยคุยกับของจริง
- **กฎของ dependency:** adapter พึ่ง core แต่ไม่มีทางกลับกัน ฝั่ง driving เรื่องนี้เป็นไปเองอยู่แล้ว เพราะ controller เป็นคนเรียก port ส่วนฝั่ง driven *การเรียก*ไหลออกไปข้างนอก จาก core ไปหา database แต่ *dependency ระดับ source code* ชี้เข้าข้างใน เพราะ core เป็นคนประกาศ interface และ adapter เป็นคน implement นี่คือ dependency inversion และเป็นสิ่งที่ทำให้ step 3 กับ 4 เกิดขึ้นได้โดยไม่ต้องแตะ core
- **การต่อสาย:** ตอน start up โค้ดชิ้นเล็ก ๆ ที่อยู่นอก core (*composition root* คือ `main` หรือ configuration ของ dependency injection) เลือก adapter แล้วส่งให้ core มันคือที่เดียวที่รู้จัก class จริงทุกตัว

**มาจากไหน** Alistair Cockburn อธิบาย pattern นี้ไว้ใน [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture) (2005) และตั้งชื่อที่บอกความหมายชัดกว่าให้ด้วยว่า *Ports and Adapters* เป้าหมายคือแอปพลิเคชันที่ไม่สนว่าใครเป็นคนขับมัน (คน, โปรแกรมอื่น, batch script หรือเทสต์อัตโนมัติ) และ build กับเทสต์ได้ด้วยตัวเอง โดยไม่ต้องต่อ database หรืออุปกรณ์จริง ต่อมาเขาเขียนบทความนี้ขยายเป็นหนังสือ *Hexagonal Architecture Explained* (2024) ร่วมกับ Juan Manuel Garrido de Paz

**ทำไมเป็นหกเหลี่ยม** เลขหกไม่ได้มีความหมายอะไร รูปทรงนี้แค่ช่วยเลิกนิสัยวาด layer ที่มีบนมีล่าง และด้านแบน ๆ ของมันก็มีที่ให้วาดหลาย port แต่ละ port มีหลาย adapter ส่วนในบทความ Cockburn บอกว่าปกติมีสอง สาม หรือสี่ port ส่วนจะแบ่งละเอียดแค่ไหนเป็นเรื่องของวิจารณญาณระหว่างสองขั้ว คือ port หนึ่งตัวต่อ use case แต่ละตัว หรือ port เดียวต่อแต่ละฝั่ง

**Driving และ driven** Cockburn ใช้คำว่า *primary* กับ *secondary* ตาม primary actor และ secondary actor ของ use case ส่วน driver/driven, inbound/outbound และ input/output ก็หมายถึงการแบ่งแบบเดียวกัน วิธีเช็กคือดูว่าใครเริ่มคุยก่อน driving actor เป็นคนกระตุ้นแอปพลิเคชัน ส่วน driven actor ถูกแอปพลิเคชันกระตุ้น ตามธรรมเนียมจะวาดฝั่ง driving ไว้ทางซ้ายและฝั่ง driven ไว้ทางขวา สองฝั่งต่อสายต่างกัน (driving adapter *เรียก* port ของมัน ส่วน driven adapter *implement* port ของมัน) แต่ dependency ชี้เข้าข้างในทั้งสองฝั่ง

**port พูดภาษาของ core** port มีหน้าตาตามสิ่งที่ core ต้องการ ไม่ใช่ตามสิ่งที่เทคโนโลยีมีให้ เช่น `OrderRepository.save(order)` ไม่ใช่ `execute(sql)` ส่วน `PaymentGateway.charge(total)` ไม่ใช่ `post(url, json)` และ `EventPublisher.publish(event)` ไม่ใช่ `send(topic, bytes)` ความผิดพลาดคลาสสิกคือ port ที่ลอกหน้าตาเทคโนโลยีมา เช่น `KafkaPort`, `HttpClientPort` หรือ repository ที่คืน ORM entity หรือรับชิ้นส่วนของ query เข้ามา ตัว port แบบนี้ทำให้แนวคิดของเทคโนโลยียังอยู่ใน core และมี adapter ตัวจริงได้แค่ตัวเดียวตลอดไป การสลับใน step 3 เลยต้องแก้ core อยู่ดี วิธีเช็กที่ใช้ได้ดีคือถามว่า port นี้ใช้เทคโนโลยีที่ต่างไปเลย หรือใช้ hash map ในเทสต์ implement ได้ไหม โดยไม่ต้องแตะ signature ของมัน

**ญาติ ๆ**

- *Layered architecture* ในสาม layer ที่ใช้กันทั่วไป presentation พึ่ง domain และ domain พึ่ง data access ส่วน hexagonal เก็บ dependency แรกไว้และกลับทิศ dependency ที่สอง ให้ persistence เป็นฝ่ายพึ่ง domain แล้ว Martin Fowler ก็บอกว่าการแบ่ง layer แบบที่แปลงนี้แหละคือสิ่งที่คนมักหมายถึงเวลาพูดว่า hexagonal architecture
- *Onion architecture* (Jeffrey Palermo, 2008) และ *Clean Architecture* (Robert C. Martin, 2012) วาดความคิดเดียวกันเป็นวงซ้อนกัน แล้วเพิ่มโครงสร้างไว้ข้างในขอบเขต แบบแรกมี domain model อยู่ตรงกลางและมี domain service กับ application service อยู่รอบ ๆ แบบหลังมี entity, use case, interface adapter และ framework ทั้งคู่วางกฎเดียวกันว่า dependency ชี้เข้าหาศูนย์กลางเท่านั้น และทั้งคู่ก็นับ hexagonal architecture เป็นญาติใกล้ชิด ส่วน pattern ของ Cockburn เองไม่ได้พูดถึงข้างในเลย มันแยกข้างในออกจากข้างนอกแล้วก็จบแค่นั้น

## ใช้ตอนไหนดี

- แอปพลิเคชันมี business rule จริง ๆ และกฎพวกนี้จะอยู่นานกว่า framework, database หรือ provider ที่ใช้อยู่ตอนนี้
- logic ชุดเดียวกันต้องเข้าถึงได้มากกว่าหนึ่งทาง เช่น API กับ queue consumer, UI กับ batch import หรือ REST วันนี้กับอะไรก็ตามที่จะมาต่อ
- dependency ที่คาดว่าจะเปลี่ยนหรือยังไม่ได้เลือก เช่น store ที่จะตัดสินใจทีหลัง API ของ monolith ที่ service ใหม่จะมาแทน หรือ provider ที่อาจถูกสลับ ตัว port ทำให้การตัดสินใจรอไปก่อนได้
- เทสต์พฤติกรรมทาง business ที่เร็วและเชื่อถือได้เป็นเรื่องสำคัญ เพราะกฎซับซ้อน มีข้อบังคับ หรือเปลี่ยนบ่อย
- ใช้ได้หลายระดับ ทั้งแอปพลิเคชันทั้งตัว, [microservice](../microservices/) ตัวเดียว หรือ module หนึ่งใน modular monolith ก็เป็น hexagon ของตัวเองที่เข้าถึงตัวอื่นผ่าน driven port ได้

**ตอนไหนไม่ควรใช้:**

- **CRUD ง่าย ๆ** ถ้าแอปพลิเคชันเป็นแค่ฟอร์มวางบน table และแทบไม่มีกฎ core ก็เป็นแค่ทางผ่านว่าง ๆ และ port กับ mapper ก็เป็น overhead ล้วน ๆ
- **โค้ดที่อายุสั้น** prototype, migration script ที่ใช้ครั้งเดียว หรือการทดลอง จะถูกทิ้งก่อนที่จะได้สลับ adapter สักตัว
- **ทีมที่จะไม่รักษาขอบเขต** ขอบเขตที่ถูกข้าม "แค่ครั้งนี้ครั้งเดียว" ต้องจ่ายค่า mapping เต็ม ๆ แต่ไม่ได้ประโยชน์อะไรกลับมา ถ้าไม่มีใครจะบังคับมัน การออกแบบแบบ layered ธรรมดาเป็นทางเลือกที่ตรงไปตรงมากว่า

คำแนะนำของ AWS ก็พูดเรื่องเดียวกันจากมุมต้นทุน โค้ด adapter ที่เพิ่มขึ้นจะคุ้มก็ต่อเมื่อ component มี input หรือ output หลายตัวจริง ๆ หรือคาดว่ามันจะเปลี่ยน

## ได้อะไร เสียอะไร

- **Indirection** ทุกการข้ามขอบเขตคือการเรียกผ่าน interface และคนอ่านต้องตามไปหา implementation การไล่โค้ดและ debug เลยใช้เวลานานกว่าโค้ดที่เรียก database ตรง ๆ
- **โค้ด mapping** order ตัวเดียวกันมีอยู่ทั้งในรูป request DTO, domain object, row ใน table และ payload ของ event โดยมี mapper คั่นระหว่างแต่ละคู่ เป็นโค้ดน่าเบื่อ และเป็นที่ที่ bug ระดับ field ชอบไปซ่อน หลายทีมยอมให้มี persistence annotation บน domain class เพื่อเลี่ยงการมี model ที่สอง นั่นคือรูรั่วในขอบเขต เพราะฉะนั้นให้มันเป็นการตัดสินใจ ไม่ใช่เรื่องบังเอิญ
- **type และการต่อสายที่มากขึ้น** port, adapter, command, fake และ composition root ต้องเขียน ตั้งชื่อ และดูแลให้ไปด้วยกันทั้งหมด
- **port ซ่อน API ได้ แต่ซ่อนพฤติกรรมไม่ได้** การสลับ SQL เป็น document store จะง่ายก็ต่อเมื่อ port ไม่เคยสัญญาสิ่งที่มีแค่ SQL ทำได้ เช่น ad-hoc query หรือ transaction เดียวที่คร่อมหลาย aggregate ส่วน consistency, latency และรูปแบบของความล้มเหลวจะโผล่ทะลุ interface ไหนก็ได้
- **Performance** การเรียกผ่าน interface กับการ map object เล็กนิดเดียวเมื่อเทียบกับการเรียก network หรือ disk ที่อยู่ข้างหลัง แต่ก็ไม่ได้ฟรี และ AWS ก็ยก layer ที่เพิ่มเข้ามาเป็นสาเหตุหนึ่งที่อาจเพิ่ม latency เส้นทางอ่านที่ร้อน ๆ บางทีก็ควรมี port ที่แคบลง ให้คืนหน้าตาข้อมูลตรงตามที่ตัวเรียกต้องการเป๊ะ ๆ
- **fake โกหกได้** core ที่ผ่านเทสต์กับ in-memory fake ไม่ได้พิสูจน์อะไรเลยเกี่ยวกับ adapter ตัวจริง เพราะฉะนั้น adapter test ข้างล่างข้ามไม่ได้

## ข้อควรรู้ตอนลงมือทำ

- **mapping อยู่ใน adapter** adapter แต่ละตัวแปลงระหว่างรูปแบบของตัวเอง (request body, row, message schema, response ของ provider) กับ type ของ core ทั้งสองทิศ core ไม่เคย import type ของ adapter
- **validation แบ่งกันทำ** adapter เช็กสิ่งที่เป็นเรื่องของเทคโนโลยีตัวเอง เช่น JSON parse ได้ไหม วันที่เป็นวันที่จริงไหม ตัวเรียก authenticate แล้วหรือยัง ส่วน business rule (วงเงินเครดิต สต็อก การเปลี่ยน state ที่อนุญาต) เช็กใน core เพื่อให้ทุกทางที่เข้ามา รวมทั้งเทสต์ เจอกฎชุดเดียวกัน
- **transaction ห่อรอบ use case** repository adapter ไม่มีทางรู้ว่าการเขียนอื่นไหนเป็นของ business operation เดียวกัน ขอบเขตเลยต้องตั้งรอบ use case โดยใช้ decorator หรือ interceptor ที่ส่งมาจากนอก core หรือใช้ unit-of-work port เล็ก ๆ ตัวหนึ่ง ส่วน database transaction ครอบคลุมแค่ database ทำให้การเรียกสามครั้งใน step 2 ไม่ได้เป็น atomic เพราะฉะนั้นให้ publish event ผ่าน [transactional outbox](../transactional-outbox/) ทำการเรียก payment ให้ idempotent เพื่อไม่ให้ retry ตัดเงินซ้ำ และเตรียมคืนเงินไว้ถ้าบันทึก order ไม่ได้
- **error ก็ต้องแปลด้วย** adapter แปลง timeout, SQL state และ error code ของ provider เป็นความล้มเหลวในภาษาของ core เอง (`PaymentDeclined`, `OrderNotFound`) ส่วน [retry](../retry-with-backoff/), timeout และ [circuit breaker](../circuit-breaker/) อยู่ใน driven adapter และการจัดการ message ที่ถูกส่งซ้ำอยู่ฝั่ง driving (ดู [idempotent consumer](../idempotent-consumer/))
- **กลยุทธ์การเทสต์**
  - *core test* เรียก driving port ตรง ๆ โดยมี fake อยู่หลัง driven port รันเสร็จในระดับมิลลิวินาที ครอบคลุมทุก business rule และเป็นเนื้อหลักของชุดเทสต์ มันเทสต์พฤติกรรมที่ขอบเขตของแอปพลิเคชัน ไม่ใช่เทสต์ทีละ class
  - *adapter integration test* ลองรัน adapter ตัวจริงทีละตัวกับเทคโนโลยีจริง คือ SQL adapter รันกับ database จริง (เช่นใน container), payment adapter รันกับ sandbox ของ provider หรือ contract stub และ REST controller รันกับ HTTP request จริงโดยมี port ที่ stub ไว้
  - *shared contract test* รันชุดเทสต์ชุดเดียวกับทั้ง fake และ adapter ตัวจริงของ port เดียวกัน fake จะได้ไม่ค่อย ๆ เพี้ยนไป
  - *end-to-end test ไม่กี่ตัว* วิ่งผ่านทุกอย่าง เพื่อเช็กการต่อสายและ configuration ไม่ใช่เช็กกฎ
  - ทีม Studio Workflows ของ Netflix เล่าถึงการแบ่งแบบเดียวกัน (business logic เทสต์กับ repository ที่ mock ไว้, integration test สำหรับแต่ละ data source และ spec จำนวนน้อยที่วิ่งผ่านทั้ง stack) และบอกว่าการย้ายการอ่านของ entity หนึ่งจาก JSON API ไปเป็น GraphQL data source ใช้เวลาประมาณสองชั่วโมง
- **บังคับกฎใน build** แบบที่แข็งที่สุดคือขอบเขตของ module วาง core ไว้ใน build module หรือ package ของตัวเอง ที่ไม่พึ่ง library ของ web, persistence หรือ messaging เลย แล้ว compiler ก็จะปฏิเสธ import ที่ผิด ตรงไหนที่ทำแบบนั้นไม่สะดวก ก็เพิ่มการเช็ก dependency ที่ทำให้ build ไม่ผ่าน ได้แก่ ArchUnit สำหรับ Java (กฎ onion-architecture ของมันห้าม dependency จาก core ไปหา adapter และห้ามระหว่าง adapter ด้วยกัน), ArchUnitNET สำหรับ .NET, dependency-cruiser สำหรับ JavaScript และ TypeScript และ Import Linter สำหรับ Python ตอน review ให้มองหา framework import ใน core หรือ type ของเทคโนโลยีใน signature ของ port นั่นคือกลิ่นที่ผิดปกติ
- **ให้ adapter อยู่แยกกัน** adapter คุยกับ core ไม่ใช่คุยกับ adapter อื่น ถ้ามี controller ที่อ่านตรงจาก SQL adapter "แค่เอามาทำ list" ก็คือเจาะรูในขอบเขตไปแล้ว ถ้าการอ่านต้องการทางลัด ให้มันมี query port กับ read model ของตัวเอง (ดู [CQRS](../cqrs/))
- **วางโครงให้เห็นกฎ:**

  ```text
  orders/
    core/        domain model, use cases and ports; no framework imports
    adapters/
      rest/  messaging/  sql/  payments/  broker/
    main         composition root: builds the adapters and injects them
  ```

- **Domain-driven design** hexagonal architecture ไม่ได้เป็นส่วนหนึ่งของ DDD แต่สองอย่างนี้เข้ากันได้ดี hexagon เป็นบ้านที่เหมาะกับ model ของ bounded context หนึ่งตัว และ ubiquitous language ก็ให้ชื่อของ port มา
- **Anti-corruption layer** [anti-corruption layer](../anti-corruption-layer/) คือ driven adapter ที่มีงานยากกว่า ตัว adapter ธรรมดาซ่อนเทคโนโลยี แต่ตัวนี้ซ่อน model ของระบบอื่นด้วย มันเลยต้องแปลทั้งความหมายและรูปแบบ
- **Branch by abstraction** driven port คือ abstraction สำเร็จรูปสำหรับการค่อย ๆ เปลี่ยน implementation โดยเก็บ adapter ตัวเก่ากับตัวใหม่ไว้หลัง port เดียวกัน แล้วสลับกันด้วย configuration
- **Microkernel** ทั้งสองแบบมี core และของที่เสียบเข้ามา แต่ plug-in เพิ่ม feature ให้ product ส่วน adapter ไม่ได้เพิ่มพฤติกรรมทาง business อะไรเลย มันแค่เชื่อมต่อ
- **เป็นตัวอย่าง ไม่ได้บังคับ** dependency-injection container ตัวไหนก็ได้ (Spring, container ที่มากับ ASP.NET Core, NestJS) หรือ `main` ที่เขียนเอง ก็เป็น composition root ได้ ตัวอย่างของ AWS ใช้ pattern นี้ข้างใน Lambda function ตัวเดียวที่อยู่หลัง API Gateway REST API โดยแยก domain logic ออกจากโค้ดที่อ่านและเขียน DynamoDB
