## ปัญหา

ระบบหนึ่งถูกแบ่งสองครั้ง ครั้งแรกแบ่งเป็นชิ้นของ**โค้ด**ที่คนเข้าใจและแก้ได้ อีกครั้งแบ่งเป็นชิ้นที่**ถูก deploy** มีการออกแบบสองแบบที่เจอบ่อยที่มองสองเรื่องนี้เป็นการตัดสินใจเดียวกัน และแต่ละแบบก็พลาดไปครึ่งหนึ่ง

- **monolith ที่ไม่มีขอบเขตข้างในเลย** ทุกอย่างปล่อยออกไปพร้อมกัน ข้อนี้ง่ายดี แต่ไม่มีอะไรกั้นโค้ดส่วนหนึ่งออกจากอีกส่วน class ไหนก็เรียก class ไหนได้ query ไหนก็ join table ไหนได้ ไม่ช้าก็เร็วทางลัดทุกทางก็ถูกใช้ แก้เรื่องราคาแล้ว checkout พัง ไม่มีใครบอกได้ว่า interface ของ catalog คืออะไร ทีมต้องรอการแก้ของกันและกัน แล้ว build กับชุดเทสต์ก็โตตามทั้งระบบ นี่คือ "big ball of mud"
- **ใช้ microservices เพื่อให้ได้ขอบเขต** network ที่คั่นระหว่างส่วนต่าง ๆ บังคับให้แยกกันได้จริง แต่เป็นวิธีซื้อความเป็น module ที่แพง ทุกการเรียกพังหรือช้าได้ ไม่มี transaction ไหนคร่อมสอง service ได้ แต่ละ service ต้องมี pipeline, monitoring และ on-call ของตัวเอง และขอบเขตที่ขีดผิดที่ก็ย้ายยาก Martin Fowler เรียกต้นทุนนี้ว่า [microservice premium](https://martinfowler.com/bliki/MicroservicePremium.html) และแนะนำว่าอย่าใช้ microservices เว้นแต่ระบบซับซ้อนเกินกว่าจะดูแลแบบ monolith ได้ ใน [Monolith First](https://martinfowler.com/bliki/MonolithFirst.html) เขาเล่าว่าเรื่องสำเร็จของ microservice แทบทั้งหมดที่เขาได้ยินมา เริ่มจาก monolith ที่โตจนใหญ่เกินไป ส่วนระบบที่สร้างเป็น microservices ตั้งแต่แรก แทบทุกตัวที่เขารู้จักล้วนเจอปัญหาหนัก

การกระจายระบบก็ไม่ได้รักษาโครงสร้างที่แย่ให้หาย [คำพูดที่คนรู้จักกันดี](https://simonbrown.je/modular-monolith/) ของ Simon Brown ตั้งแต่ปี 2015 บอกว่าทีมที่สร้าง monolith ให้ดีไม่ได้ microservices ก็ช่วยอะไรไม่ได้ ความยุ่งเหยิงแบบเดิมที่กระจายไปบน network ก็แค่แก้ยากขึ้น

## ทำงานยังไง

modular monolith แยกสองการตัดสินใจนี้ออกจากกัน มันคง**หน่วย deploy ไว้หน่วยเดียว** และใส่ขอบเขตที่เข้มงวดไว้*ข้างใน* [primer](https://www.kamilgrzybek.com/blog/posts/modular-monolith-primer) ของ Kamil Grzybek นิยามคำเหล่านี้แบบนี้เป๊ะ ๆ monolith คือระบบที่มีหน่วย deploy หน่วยเดียวพอดี แค่นั้นเอง ส่วน "modular" บอกว่าข้างในถูกออกแบบมายังไง

**อะไรทำให้ monolith เป็น modular**

- **module ที่เกาะกลุ่มกันตาม business capability** Orders, Catalog, Shipping และ Payments เป็น slice แนวตั้ง แต่ละตัวเก็บทุกอย่างที่ capability ของมันต้องใช้ ตั้งแต่ API ลงไปจนถึง table ในภาษาของ domain-driven design หนึ่ง module มักเป็นหนึ่ง bounded context ส่วน "package by component" ของ Simon Brown ก็คือความคิดเดียวกันที่ใช้กับการจัดโค้ด ทุกอย่างที่ component ขนาดใหญ่ตัวหนึ่งรับผิดชอบอยู่ใน package เดียวหลัง public interface แทนที่จะกระจายอยู่ตาม layer ทางเทคนิค
- **public API เล็ก ๆ ของใครของมัน** module หนึ่งเปิดให้ส่วนอื่นของแอปพลิเคชันเห็นแค่ interface ไม่กี่ตัว data type ที่ interface พวกนั้นรับส่ง และ event ที่มันประกาศออกไป ที่เหลือ (domain class, persistence, helper) เป็น internal และใน diagram ก็อยู่หลังแม่กุญแจ
- **ข้อมูลส่วนตัว** table ของ module เป็นของ module นั้น ไม่มี module อื่นอ่าน เขียน join หรือถือ foreign key ชี้เข้าไป จะเอาข้อมูลก็ต้องถามผ่าน API ของเจ้าของหรือฟัง event ของมัน
- **ไม่มีทางลัด** dependency ระหว่าง module ต้องประกาศไว้ มีน้อย และไม่มี cycle และจะใช้ module ไหนก็ต้องผ่าน API ของมันเท่านั้น กฎข้อนี้คือข้อที่พังก่อนเพื่อน มันเลยต้องให้เครื่องเป็นคนเช็ก (step 2)

ข้างในขอบเขตของตัวเอง module จะจัดตัวเองยังไงก็ได้ ตัวเล็ก ๆ อาจมีแค่ไม่กี่ class ตัวที่ซับซ้อนอาจเป็น [hexagon](../hexagonal-architecture/) ของตัวเองเลยก็ได้

**บังคับขอบเขตยังไง**

ข้อตกลงที่อยู่แค่ใน wiki ไม่รอดพ้น deadline การเช็กต้องอยู่ใน build และควรอยู่ใกล้ compiler ที่สุดเท่าที่ stack จะยอม เครื่องมือข้างล่างเป็นแค่ตัวอย่าง ไม่ได้บังคับ

- **module system ของภาษา** Java module (`module-info.java`) export แค่ package ที่ระบุชื่อไว้ ส่วน package ที่เหลือก็ถูกซ่อนจาก module อื่นทั้งตอน compile และตอนรัน ถ้าไม่ใช้ Java module ตัว class แบบ package-private ก็ซ่อน implementation ของ module จาก package อื่นได้อยู่แล้ว ใน Go ตัว package ที่อยู่ใต้ directory ชื่อ `internal` ถูก import ได้จากข้างใน tree ที่มี directory นั้นเท่านั้น และคำสั่ง `go` ก็ปฏิเสธที่เหลือทั้งหมด `internal` ใน C# จำกัด type ไว้ใน assembly ของมัน และ `internal` ใน Kotlin จำกัดไว้ใน compilation module ของมัน การมีหนึ่ง project ต่อหนึ่ง module เลยได้ขอบเขตที่ compiler เช็กให้
- **กฎ dependency ระดับ build** ถ้าแต่ละ module เป็นหน่วย build ของตัวเอง (Gradle subproject, Maven module, .NET project, Bazel package) มันก็เห็นได้แค่ module ที่มันประกาศไว้ ส่วน configuration `implementation` ของ Gradle กัน dependency ของ module ไม่ให้ไปอยู่ใน compile classpath ของคนที่ใช้มัน ต่างจาก `api` ส่วน Bazel target ก็เป็นของส่วนตัวใน package ของมัน เว้นแต่จะขยาย `visibility` ให้กว้างขึ้น แล้ว Nx ก็มี lint rule `@nx/enforce-module-boundaries` ที่ทำงานตาม tag บน project
- **architecture test** ตรงไหนที่ภาษาเขียนกฎไม่ได้ เทสต์ที่ทำให้ build ไม่ผ่านก็ทำแทนได้ ได้แก่ ArchUnit สำหรับ Java (slice ที่ต้องไม่มี cycle, module ที่ประกาศ dependency ที่อนุญาตและ package ที่เปิดออก), ArchUnitNET กับ NetArchTest สำหรับ .NET, dependency-cruiser สำหรับ JavaScript และ TypeScript, Import Linter สำหรับ Python, Packwerk สำหรับ Ruby on Rails และ Deptrac สำหรับ PHP
- **การรองรับ module ของ framework** [Spring Modulith](https://docs.spring.io/spring-modulith/reference/) มอง sub-package ชั้นแรกแต่ละตัวของ main package ในแอปพลิเคชันเป็นหนึ่ง module ตัว base package ของ module คือ API ของมัน และ sub-package ข้างในเป็น internal การเรียก `ApplicationModules.of(Application.class).verify()` ในเทสต์จะ fail ถ้ามี cycle ระหว่าง module หรือมีการอ้างอิงเข้าไปใน internal package ของ module อื่น และ module หนึ่งก็ระบุได้ว่าพึ่งได้แค่ module ไหนบ้าง

ถ้าเป็น codebase เดิมที่มี violation เป็นร้อย ให้บันทึกไว้เป็น baseline แล้ว fail เฉพาะตัวใหม่ (`FreezingArchRule` ของ ArchUnit, ไฟล์ `package_todo.yml` ของ Packwerk) จากนั้นค่อย ๆ ลด baseline ลง

**database**

ข้อมูลก็แยกด้วยแนวคิดเดียวกัน และปกติไล่เป็นสามขั้นที่เข้มขึ้นเรื่อย ๆ

1. **แยก table** แต่ละ table มี module เจ้าของตัวเดียว ตามข้อตกลงเรื่องการตั้งชื่อ ต้นทุนต่ำ และบังคับได้แค่ด้วยการ review
2. **แยก schema** แบบใน diagram แต่ละ module ได้ schema ของตัวเองใน database ที่ใช้ร่วมกัน และต่อเข้ามาด้วย database role ของตัวเอง ที่มีสิทธิ์แค่บน schema นั้น ใน PostgreSQL ตัว role คือสิ่งที่ทำให้การแยกนี้เป็นของจริง เพราะ schema ใน database เดียวกันไม่ได้มีกำแพงกั้นกัน role เข้าถึง object ของ schema ไหนก็ได้ที่มันมีสิทธิ์ (เริ่มจาก `USAGE` บนตัว schema เอง) ส่วนใน MySQL ตัว schema กับ database คือสิ่งเดียวกัน ขั้นนี้เลยแปลว่าหนึ่ง database ต่อหนึ่ง module บน server ที่ใช้ร่วมกันไปแล้ว
3. **แยก database** ที่แอปพลิเคชันตัวเดียวยังใช้อยู่ นี่คือป้ายสุดท้ายก่อนที่ module จะย้ายออกไปได้

ทุกขั้นมีกฎเหมือนกัน คือ**ไม่มี join และไม่มี foreign key ข้าม module** การอ้างถึง row ของ module อื่นเก็บเป็น identifier ธรรมดา หน้าจอหรือรายงานที่ต้องใช้ข้อมูลจากหลาย module จะประกอบเอาจาก API ของ module เหล่านั้น หรืออ่านจาก model ที่สร้างจาก event ของมัน (ดู [CQRS](../cqrs/))

ทางลัดของข้อมูลถูกจับได้ต่างจากทางลัดของโค้ด ตัวเช็ก dependency เห็น join ก็ต่อเมื่อ join นั้นเขียนผ่าน entity class ของ module อื่น (type แบบ internal) ส่วน join ใน SQL string มันมองไม่เห็นเลย ตัว database role ที่แยกต่อ module ก็ปิดช่องนี้ได้ query จะ fail เพราะไม่มีสิทธิ์ตั้งแต่ครั้งแรกที่เทสต์ของ module รันมัน ใน build เดียวกัน

**Transaction**

- **หนึ่ง module หนึ่ง transaction** use case แก้ table ของ module ตัวเองแล้ว commit
- **event ระหว่าง module** สิ่งที่ module อื่นต้องทำตาม ส่งไปเป็น event และรันใน transaction ของ module นั้นเอง module ต่าง ๆ เลย consistent กัน*ในที่สุด* (eventually) ส่วน event ที่ประกาศใน memory หลัง commit จะหายไปถ้า process ตายตรงจังหวะนั้นพอดี เพราะฉะนั้นให้บันทึกมันไว้ใน transaction เดียวกับการเปลี่ยนแปลง ([transactional outbox](../transactional-outbox/)) และทำ handler ให้ [idempotent](../idempotent-consumer/)
- **in-process ไม่ได้แปลว่า asynchronous** เช็กดูว่ากลไก event ของเราทำอะไรจริง ๆ ใน Spring ตัว event listener ธรรมดารันแบบ synchronous ใน thread ของคนประกาศ และอยู่ใน transaction ของคนประกาศ ส่วน `@TransactionalEventListener` รันหลัง commit เป็นค่าตั้งต้น `@ApplicationModuleListener` ของ Spring Modulith รวม listener แบบ asynchronous, transaction ของตัวเอง และการส่งหลัง commit ไว้ด้วยกัน และ event publication registry ของมันก็เขียน entry ของแต่ละ listener ไว้ใน transaction ต้นทาง แล้ว mark ว่าเสร็จเมื่อ listener ทำสำเร็จ การส่งที่ยังไม่เสร็จเลยส่งซ้ำได้
- **transaction ร่วมกันเป็นข้อยกเว้นที่ตั้งใจ** เพราะ module ใช้ process และ database ร่วมกัน use case หนึ่ง*ทำได้*ที่จะ update สอง module ใน database transaction เดียว นี่เป็นข้อได้เปรียบจริง ๆ เหนือ service ที่ความต้องการเดียวกันต้องใช้ [saga](../saga-orchestration/) แต่ให้ใช้มันน้อย ๆ และตั้งใจใช้ เพราะมันผูก lock และความล้มเหลวของสอง module เข้าด้วยกัน และคู่นี้จะแยกกันทีหลังไม่ได้จนกว่าจะออกแบบ flow ใหม่

**การเรียกกับ event ชี้ไปคนละทาง** ตอน Orders เรียก API ของ Catalog ตัว Orders พึ่ง Catalog แต่ตอน Orders ประกาศ `OrderPlaced` ตัว Shipping กับ Payments พึ่ง event type ที่ Orders เป็นเจ้าของ ส่วน Orders ไม่ได้พึ่งใครเลย การเลือกระหว่างสองแบบนี้คือวิธีรักษา dependency graph ระหว่าง module ไม่ให้มี cycle

## ใช้ตอนไหนดี

- **เป็นจุดเริ่มต้นตั้งต้น** สำหรับ product ใหม่ หรือ domain ที่ยังเรียนรู้อยู่ ขอบเขตของ module ใน codebase เดียวย้ายได้ถูก ๆ เป็นแค่ refactoring หนึ่ง commit ที่ compiler เช็กให้ ส่วนการเปลี่ยนแบบเดียวกันระหว่าง service คือการ migrate
- **ทีมเดียวหรือไม่กี่ทีม** ที่ไม่ต้อง release แยกรอบกัน
- **monolith เดิมที่เริ่มเจ็บ** การแบ่ง module ในที่เดิมเสี่ยงน้อยกว่าการเขียนใหม่ และเป็นการเตรียมตัวที่การแยกออกไปทีหลังก็ต้องทำอยู่ดี
- **ตอนที่งาน operation ควรง่ายไว้:** pipeline เดียว artefact เดียว มีของแค่ชิ้นเดียวให้รัน monitor และ debug

แต่มันอย่างเดียวไม่พอ ถ้าระบบมีบางส่วนที่ต้องการต่างออกไปชัด ๆ เช่น load หรือการใช้ resource ต่างกันมาก ข้อกำหนดเรื่อง availability หรือ security ต่างกัน เทคโนโลยีต่างกัน หรือมีทีมเยอะจน release train ขบวนเดียวกลายเป็นคอขวด step 4 มีไว้สำหรับกรณีนี้

## ได้อะไร เสียอะไร

**สิ่งที่ยังได้จาก monolith**

- **deploy ง่าย** build เดียว release เดียว ไม่ต้องเทสต์ชุดเวอร์ชันข้าม service
- **เรียกกันใน process** การเรียกระหว่าง module คือ method call เร็ว มี type ไม่ต้อง serialise ไม่ต้องเลือก timeout ไม่มี partial failure และมี stack trace เดียวตอนมีอะไรพัง
- **transaction เดียวได้ถ้าต้องการ** (ดูข้างบน)
- **refactor ข้าม module ได้ง่าย** การย้ายหน้าที่ เปลี่ยนชื่อ API หรือขีดขอบเขตใหม่ แก้ทั้งสองฝั่งได้ใน commit เดียว

**สิ่งที่ไม่ได้**

- **scale แยกกัน** ทั้งก้อน scale ไปด้วยกัน รันแอปพลิเคชันเพิ่มได้หลายชุด แต่จะรันเพิ่มแค่ Payments ไม่ได้
- **release แยกกัน** ทุกการแก้ไปกับ release เดียวกัน และการแก้ที่พังของ module หนึ่งก็ทำให้ของทุกคนถูกกักหรือถูก rollback ได้
- **กันความเสียหายไม่ให้ลาม** module ใช้ process, memory, thread และ connection pool ร่วมกัน memory leak, crash หรือ query ที่วิ่งไม่หยุดใน module หนึ่งก็ทำให้ทุก module เจ็บ
- **เทคโนโลยีต่างกันในแต่ละ module** ภาษาเดียว runtime เดียว framework เวอร์ชันเดียว และการ upgrade ก็เกิดกับทุกคนพร้อมกัน

**ต้นทุน**

- **วินัย ที่มีเครื่องมือหนุน** ขอบเขตใน process ข้ามได้ง่าย และการเช็กต้องเปิดไว้ตลอด บทความของ Fowler ก็ให้น้ำหนักกับข้อโต้แย้งอีกฝั่งอย่างยุติธรรม วินัยที่ต้องใช้รักษา monolith ให้แยกส่วนได้สะอาด อาจมากเกินกว่าที่ทีมส่วนใหญ่จะรักษาไว้ได้
- **build และเทสต์ที่โตขึ้น** ตาม codebase เว้นแต่จะทำ build ให้เป็นแบบ incremental (ดูข้างล่าง)
- **งานออกแบบตั้งแต่ต้น** public API, event และความเป็นเจ้าของข้อมูลต้องคิดให้ดี และขอบเขตของ module ที่ขีดผิดที่ก็ไม่ช่วยอะไรเหมือนที่อื่น ๆ แค่แก้ได้ถูกกว่า

## ข้อควรรู้ตอนลงมือทำ

- **วางโครงให้เห็นกฎ** ระดับบนสุดของ codebase ตั้งชื่อตาม business capability และแต่ละ module แยกสิ่งที่มันให้ออกจากสิ่งที่มันซ่อน:

  ```text
  shop/
    orders/
      api/         interfaces, data types and events: all that other modules may import
      internal/    domain logic, persistence, event handlers
      migrations/  the orders schema, owned here
    catalog/   shipping/   payments/     the same shape
    main           wires the modules together and starts the one process
  ```

- **ทีมเจ้าของต่อ module** ให้ทุก module มีทีมเจ้าของทีมเดียว และเขียนไว้ในที่ที่เครื่องมือเอาไปใช้ได้ เช่นไฟล์ code owners (บน GitHub เจ้าของจะถูกขอให้ review อัตโนมัติเมื่อ pull request แตะ path ของพวกเขา) การส่ง alert และ error ไปตาม module และให้เจ้าของ review public API ของ module ส่วน Shopify เล่าว่าการระบุเจ้าของของแต่ละ component ชัด ๆ ทำให้ส่ง exception ไปหาทีมที่ถูกต้องได้อัตโนมัติ
- **build ที่นาน และ release train ขบวนเดียว** นี่คือราคาของการมี deployable ตัวเดียว และทีมใหญ่ ๆ ก็จัดการมันแทนที่จะหนีมัน
  - *build และเทสต์เฉพาะสิ่งที่การแก้กระทบ* module ที่แยกเป็นหน่วย build ทำให้เครื่องมือ build ข้ามหรือ cache ตัวที่ไม่ถูกแตะได้ และ dependency graph ที่สะอาดก็ทำให้เลือกเทสต์ได้ Shopify [ลดเวลา CI ที่ percentile ที่ 95](https://shopify.engineering/faster-shopify-ci) ของ monolith หลักจากประมาณ 45 นาทีเหลือ 18 นาที ด้วยการทำให้ container start เร็วขึ้น ใช้ caching รันขั้นตอนแบบขนาน และรันเฉพาะเทสต์ที่เกี่ยวกับการแก้นั้น
  - *ให้ main branch พร้อม release เสมอ* merge queue รัน CI กับการแก้แต่ละอันก่อนจะเข้าไป [กฎของ queue](https://shopify.engineering/successfully-merging-work-1000-developers) ของ Shopify คือ main branch ต้องเขียวตลอด อยู่ใกล้ production และยังให้ fix ฉุกเฉินผ่านไปได้เร็ว
  - *แยก release ออกจาก deployment* deploy การแก้เล็ก ๆ บ่อย ๆ แล้วเปิด feature ด้วย [feature flag](../feature-flags/) เพื่อให้ feature ที่ยังไม่เสร็จใน module หนึ่งไม่ถ่วง module อื่น และจำกัดวงความเสียหายของแต่ละ deployment ด้วย [canary](../canary-release/)
  - *เทสต์ module แยกเดี่ยว ๆ* start แค่ module เดียว แล้ว stub ตัวที่มันทำงานด้วยไว้ที่ API (`@ApplicationModuleTest` ของ Spring Modulith ทำแบบนี้) และเก็บชุดเทสต์ end-to-end เล็ก ๆ ไว้สำหรับทั้งแอปพลิเคชัน
- **พังกันแบบไหนบ่อย**
  - *shared module ที่โตขึ้นเรื่อย ๆ* `common`, `core` หรือ `utils` ดูดแนวคิดทาง business เข้ามาจนทุก module พึ่งมัน และมันเปลี่ยนทุกครั้งที่มี feature ใหม่ ให้โค้ดที่ใช้ร่วมกันเล็ก เป็นเรื่องเทคนิค และนิ่ง Shopify พบว่าช่วงแรก component ทุกตัวพึ่ง component อื่นเกินครึ่ง และ graph ก็เต็มไปด้วย cycle ทำให้คิดถึงแต่ละ component แยกกันไม่ได้เลย
  - *ล้วงเข้าไปใน table ของ module อื่น:* join, foreign key, ORM entity ที่ใช้ร่วมกัน หรือ query สำหรับรายงานที่ข้ามหัวเจ้าของ
  - *ขีดขอบเขตตาม layer ทางเทคนิค* "module" ที่ชื่อ controllers, services และ repositories ก็คือ layer และทุก feature ก็ต้องแตะทุกตัว
  - *public API ที่กว้างเกินไป* ถ้าทุกอย่างเป็น public ตัว package ก็เป็นแค่ folder บทมองย้อนหลังเรื่อง Packwerk ของ Shopify พูดเรื่องที่ใกล้กัน การเช็กว่าใช้ public API หรือเปล่ายังไม่พอ ถ้าไม่มีใครถามว่า dependency นั้นควรมีอยู่ตั้งแต่แรกไหม และการเช็ก privacy ของเครื่องมือนี้ก็ถูกถอดออกในเวอร์ชัน 3.0 (ไปอยู่ใน extension แยก) เพื่อดึงความสนใจกลับมาที่ dependency graph
  - *baseline ของ violation ที่ไม่เคยลดลง* หรือการเช็กที่มีคนปิดไป
  - *API ที่คุยกันถี่ ๆ* การเรียกเล็ก ๆ เป็นพันครั้งไม่เป็นไรตอนอยู่ใน process แต่พังยับหลังแยกออกไป เพราะฉะนั้นออกแบบ API ของ module ให้รอบ business operation ทั้งก้อน
- **เมื่อไหร่ควรแยก module ออก** ต้องมีเหตุผลที่วัดได้ เช่น load ที่ต้อง scale เอง จังหวะ release ที่ train ร่วมกันรองรับไม่ได้ ข้อกำหนดเรื่อง isolation หรือ compliance หรือเทคโนโลยีที่ส่วนอื่นไม่ควรรับไปใช้ "มันใหญ่" กับ "microservices ทันสมัย" ไม่ใช่เหตุผล module ส่วนใหญ่อยู่ที่เดิม
- **แยกออกยังไง** งานส่วนใหญ่เสร็จไปแล้วก่อนจะย้าย นี่แหละคือประเด็นของ pattern นี้
  1. ทำให้ขอบเขตสะอาดจริง ๆ ไม่มี join ข้าม module ไม่มี transaction ร่วมกัน และตัวเรียกทุกตัวผ่าน API
  2. วาง API ไว้หลัง interface ที่มีสอง implementation คือ module แบบ in-process กับ remote client แล้วสลับกันด้วย configuration (branch by abstraction)
  3. ย้ายข้อมูล โดยให้ schema ของ module กลายเป็น database ของตัวเอง (database per service) โดยที่แอปพลิเคชันยังเข้าถึงมันผ่าน API เท่านั้น
  4. deploy module เป็น service แล้วค่อย ๆ ย้าย traffic ไปหามัน แบบใน migration ด้วย [Strangler Fig](../strangler-fig/)
  5. เปลี่ยน event แบบ in-process เป็น message บน broker (ดู [Event-Driven Architecture](../event-driven-architecture/)) และให้ remote call ตัวใหม่มีสิ่งที่ local call ไม่เคยต้องใช้ คือ timeout, [retry](../retry-with-backoff/) ที่ทำซ้ำได้อย่างปลอดภัย และ [circuit breaker](../circuit-breaker/)

  จากนั้นเป็นต้นไป ข้อแลกเปลี่ยนของ [microservices](../microservices/) ก็ใช้กับ module นั้น หนังสือ *Monolith to Microservices* ของ Sam Newman พูดถึงขั้นตอน migration เหล่านี้และการแยก database ไว้ละเอียด
- **ตัวอย่างจริง: Shopify** ในปี 2019 Shopify [เล่า](https://shopify.engineering/deconstructing-monolith-designing-software-maximizes-developer-productivity) ว่าเลือก modular monolith แทน microservices สำหรับ Rails application หลัก คือ codebase เดียวและ deployment เดียว โดยจัดโค้ดใหม่ตาม business domain เป็น component ที่มีขอบเขตบังคับจริง [บทความต่อในปี 2020](https://shopify.engineering/shopify-monolith) บอกว่า monolith มี Ruby เกิน 2.8 ล้านบรรทัดใน 37 component และเล่าบทเรียนอย่างตรงไปตรงมา การขัดเกลา public interface ก่อนโดยไม่สนใจ dependency graph ส่วนใหญ่แค่เพิ่มชั้นของ indirection และเครื่องมือ call-graph ที่รันครั้งหนึ่งนานกว่าชั่วโมงก็ถูกแทนด้วย Packwerk ตัว static analysis ที่รันเสร็จในไม่กี่นาทีใน workflow ของ pull request [บทมองย้อนหลังปี 2024](https://shopify.engineering/a-packwerk-retrospective) ทบทวนว่าเครื่องมือนี้ทำอะไรสำเร็จและไม่สำเร็จบ้าง
- **ทิศทางงานวิจัย: ให้ runtime เลือกการ deploy** paper ของ Google ที่ HotOS 2023 ชื่อ *Towards Modern Development of Cloud Applications* เสนอให้เขียนแอปพลิเคชันเป็น monolith เชิงตรรกะที่ประกอบจาก component ให้ runtime ตัดสินว่า component ไหนอยู่ process เดียวกัน และ roll out ทั้งแอปพลิเคชันแบบ atomic เสมอ ตัว prototype ลด latency ได้สูงสุด 15 เท่าและลดต้นทุนได้สูงสุด 9 เท่าเมื่อเทียบกับแบบที่ใช้กันอยู่ implementation แบบ open-source ชื่อ [Service Weaver](https://github.com/ServiceWeaver/weaver) หยุดพัฒนาไปตั้งแต่ธันวาคม 2024 และ repository ก็ถูก archive แล้ว ให้มองเป็นความคิดมากกว่าเป็น product
