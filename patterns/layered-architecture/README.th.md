## ปัญหา

ถ้าปล่อยไว้เฉย ๆ โค้ดจะถูกจัดตามความสะดวก controller ยิง SQL query เองเพราะ connection อยู่ใกล้มือ กฎการคิดราคาไปอยู่ใน view template เพราะเป็นที่ที่แสดงราคา แล้ว stored procedure ก็ค่อย ๆ มีการคิดส่วนลดงอกขึ้นมาเงียบ ๆ ทางลัดแต่ละอันก็เล็กนิดเดียว แต่พอรวมกันแล้วทุกการแก้ก็เสี่ยงหมด ไม่มีใครบอกได้ว่า logic ชิ้นไหนควรอยู่ตรงไหน การแก้หน้าจอหรือ table หนึ่งก็ลามไปถึงโค้ดที่ไม่เกี่ยวข้อง และจะลองรัน business rule ได้ก็ต้องเปิด browser กับ database ไว้ด้วย คู่มือ architecture ของ .NET จาก Microsoft เล่าว่าแอปพลิเคชันที่เป็น project เดียวค่อย ๆ ไหลไปทางนี้ยังไง business logic กระจายอยู่ทั่วหลาย folder และไม่มีกฎชัด ๆ ว่า class ไหนพึ่ง class ไหนได้ จนสุดท้ายก็กลายเป็น spaghetti code

## ทำงานยังไง

แบ่งโค้ดตามหน้าที่ออกเป็น **layer** แนวนอนซ้อนกันเป็นชั้น ๆ แต่ละ layer ให้บริการ layer ที่อยู่ข้างบน และใช้แค่ layer ที่อยู่ข้างล่างเท่านั้น

**layer ที่เจอกันบ่อย**

- **Presentation** แปลงสิ่งที่เข้ามาจากโลกภายนอกให้เป็นการเรียก แล้วแปลงผลลัพธ์กลับเป็นสิ่งที่คนหรือโปรแกรมอ่านได้ ได้แก่ controller, view, API endpoint, การ parse input และการ render คำตอบ
- **Business** (หรือ domain) เก็บสิ่งที่แอปพลิเคชันมีไว้ทำ คือกฎ การคำนวณ และ workflow ใน diagram ตัวนี้เช็กสต็อกและคิดส่วนลดตามกฎ
- **Data access** (persistence) ซ่อนว่าข้อมูลถูกเก็บยังไง ได้แก่ repository, data mapper, SQL และ ORM
- **database** อยู่ล่างสุด บางตำรานับเป็น layer ที่สี่ บางตำรามองเป็น resource ภายนอกที่ layer data access คุยด้วย

คู่มือของ Microsoft ย่อสาม layer แบบคลาสสิกว่า UI, BLL (business logic layer) และ DAL (data access layer) ส่วน [Martin Fowler](https://martinfowler.com/bliki/PresentationDomainDataLayering.html) เรียกว่า presentation, domain และ data source ส่วน framework หลายตัวก็ใส่การแบ่งนี้ไว้ในศัพท์ของมันเลย อย่าง Spring ก็เขียนไว้ว่า stereotype `@Controller`, `@Service` และ `@Repository` ใช้ทำเครื่องหมายให้ layer presentation, service และ persistence

แบบสี่ layer ที่ใช้กันบ่อยมาจาก domain-driven design โดยแบ่งชั้นกลางออกเป็นสองชั้น layer **application** บาง ๆ รัน use case ทีละอันและประสานงาน ส่วน layer **domain** เก็บแนวคิดและกฎทาง business แล้ว infrastructure (persistence, messaging, ระบบอื่น) ก็อยู่ข้างล่าง นิยามของ Eric Evans ที่คู่มือ DDD ของ Microsoft ยกมา กันไม่ให้มี business rule อยู่ใน layer application เลยสักข้อ ตัว layer นี้แค่สั่งงาน domain object แล้วปล่อยให้มันเป็นคนตัดสินใจ

**layer แบบ closed และ open** [Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/n-tier) ให้นิยามไว้สองแบบ ใน architecture ที่ layer เป็นแบบ *closed* แต่ละ layer เรียกได้แค่ layer ที่อยู่ถัดลงไปชั้นเดียว ส่วนแบบ *open* เรียก layer ไหนก็ได้ที่อยู่ข้างล่าง closed เป็นค่าตั้งต้นและปลอดภัยกว่า Presentation ต้องผ่าน Business แม้แค่จะอ่านอะไรสักอย่าง และ Business ก็ต้องผ่าน Data access ส่วน open layer คือ layer ที่ตัวเรียกข้างบนข้ามไปได้ ควรเป็นข้อยกเว้นที่ตั้งใจและมีชื่อชัดเจน เช่นยอมให้การอ่านง่าย ๆ วิ่งจาก Presentation ตรงไปที่ Data access และทุกข้อยกเว้นก็เพิ่ม dependency ที่กระโดดข้าม layer อีกหนึ่งเส้น

**layer ที่กันกันไว้** สิ่งที่ได้จาก layer แบบ closed คือสิ่งที่ Mark Richards เรียกว่า *layers of isolation* ตราบใดที่ layer หนึ่งยังคง interface เดิมไว้ layer ข้างบนก็ไม่รู้เลยว่ามันเปลี่ยนไปยังไง นี่คือ step 2 ของ diagram ส่วนคู่มือของ Microsoft ก็ใช้ตัวอย่างเดียวกัน ถ้าแอปพลิเคชันเก็บ persistence ของ SQL Server ไว้ใน layer เดียว ต่อไปก็เปลี่ยน layer นั้นเป็นตัวที่ใช้ cloud store หรือ web API ได้ ขอแค่ implement public interface เดียวกัน และ layer ที่เปลี่ยนได้ก็เปลี่ยนได้ *ในเทสต์* ด้วย data access layer ปลอมที่ให้คำตอบที่รู้อยู่แล้วทำให้เทสต์ business layer ได้โดยไม่ต้องมี database และเทสต์แบบนี้ก็เขียนง่ายกว่าและรันเร็วกว่า

**dependency ชี้ไปทางไหน** ในแบบคลาสสิก dependency ของ source code จะตามทิศของการเรียก Presentation พึ่ง Business และ Business พึ่ง Data access คู่มือของ Microsoft บอกราคาที่ต้องจ่ายไว้ ปกติ business layer เก็บ logic ที่สำคัญที่สุด แต่มันจะไปพึ่งรายละเอียดของ data access และหลายครั้งก็พึ่งว่าต้องมี database อยู่จริง ๆ การเทสต์มันเลยมักต้องใช้ database สำหรับเทสต์ มีสองนิสัยที่ช่วยให้เบาลง

- Business เรียก Data access ผ่าน interface (`OrderRepository`) และรับ implementation มาจากข้างนอกผ่าน dependency injection เทสต์เลยส่ง fake เข้าไปได้ แต่ในแบบคลาสสิก Business ยังต้อง import package ของ data access อยู่ดี เพราะ interface อยู่ในนั้น
- interface พูดภาษาของ business (`save(order)`) ไม่ใช่ภาษาของ database (`execute(sql)`) การเปลี่ยนยี่ห้อ database เลยจบอยู่ข้างล่าง interface

ถ้าย้าย interface นั้นขึ้นไปไว้ใน business layer ให้ data access เป็นฝ่าย implement interface ที่ business เป็นเจ้าของ dependency ตัวสุดท้ายก็จะกลับทิศ นี่คือก้าวจาก layering แบบคลาสสิกไปสู่ [hexagonal architecture](../hexagonal-architecture/) และญาติ ๆ ของมัน (ดูข้างล่าง)

**layer ไม่ใช่ tier** layer คือการจัดกลุ่มโค้ดในเชิงตรรกะ ส่วน tier คือที่ที่โค้ดไปรันจริง ๆ อย่าง process, server หรือกลุ่มของ server คู่มือของ Microsoft บอกว่าการ deploy แอปพลิเคชันแบบ N-layer ไว้บน tier เดียวเป็นเรื่องปกติมาก และ Azure เสริมว่า tier เดียวก็รับหลาย layer ได้ การ deploy แบบ **three-tier** คลาสสิก (สไตล์ N-tier) วาง Presentation ไว้บน web server วาง Business กับ Data access ไว้บน application server และวาง database ไว้บน database server

- **แต่ละ tier scale ได้เอง** ใน reference deployment ของ Azure ทุก tier เป็นกลุ่ม VM ตั้งแต่สองตัวขึ้นไปอยู่หลัง load balancer ของตัวเอง และ tier ของ web กับ business เป็นแบบ stateless ทำให้ instance ไหนก็รับ request ไหนได้
- **แต่ละ tier ดูแลความปลอดภัยแยกกัน** แต่ละ tier ได้ subnet ของตัวเองไว้เป็นขอบเขตด้านความปลอดภัย และ data tier รับ request จาก tier กลางเท่านั้น มี web application firewall หรือ perimeter network คั่นระหว่าง internet กับ front end [ตัวอย่างสำหรับ web server และ database server](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-example-web-database-servers.html) ของ AWS วาง web server ไว้ใน public subnet หลัง load balancer และวาง database server ไว้ใน private subnet ที่ยอมให้แค่ security group ของ web server เข้ามา ส่วน[ตัวอย่างที่มี server อยู่ใน private subnet](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-example-private-subnets-nat.html) ไปไกลกว่านั้น โดยเหลือไว้ใน public subnet แค่ load balancer กับ NAT gateway
- **ทุก hop มีราคา** การเรียกข้าม tier คือ network call มันเพิ่ม latency และอาจ timeout หรือพังในแบบที่การเรียกใน process เดียวกันไม่มีทางเจอ Azure มองเป็นการแลกกัน การแยกกันทางกายภาพช่วยเรื่อง scalability และ resiliency แต่ก็เพิ่ม latency นอกจากนี้ Azure ยังแยก tier แบบ *strict* ที่ request ต้องผ่านทุก tier ตามลำดับ (latency และ overhead มากขึ้น) ออกจากแบบ *relaxed* ที่ข้าม tier ได้ (coupling มากขึ้น แก้ยากขึ้น) best practice ของ Azure ยังแนะนำให้ใช้ asynchronous messaging เพื่อลด coupling ระหว่าง tier และใช้ caching กับข้อมูลที่ไม่ค่อยเปลี่ยน

## ใช้ตอนไหนดี

- **แอปพลิเคชันเรียบง่ายที่เน้นข้อมูล:** ฟอร์มที่วางบนข้อมูล เครื่องมือของงาน business และระบบหลังบ้านสำหรับ admin ที่ logic ไม่เยอะ และงานหลักคือย้ายข้อมูลไปมาระหว่างหน้าจอกับ table
- **ทีมเล็กและเวอร์ชันแรก** developer แทบทุกคนรู้จักรูปแบบนี้ framework และ template ก็ generate ให้ได้ และมันให้ที่ที่ชัดเจนกับทุกอย่างในแอปพลิเคชันใหม่ Azure ยกเรื่องเรียนรู้ง่ายเป็นหนึ่งในข้อดีของสไตล์นี้
- **ระบบ N-tier เดิมที่กำลังย้ายขึ้น cloud** Azure แนะนำสไตล์นี้สำหรับการย้ายแอปพลิเคชัน on-premises โดยแก้ให้น้อยที่สุด และสำหรับแอปพลิเคชันที่คร่อมทั้ง on-premises และ cloud
- **อยู่ข้างในของที่ใหญ่กว่า** module หนึ่งใน [modular monolith](../modular-monolith/) หรือ [microservice](../microservices/) ตัวเดียว มักเป็นแอปพลิเคชันแบบ layered ขนาดเล็ก

**ตอนไหนไม่ควรใช้:**

- **เป็นโครงสร้างระดับบนสุดของแอปพลิเคชันใหญ่** Fowler แย้งว่า presentation, domain และ data ไม่ควรเป็น module ระดับบนสุดของระบบใหญ่ ระดับบนสุดควรตาม business domain แล้วค่อยมี layer อยู่ข้างในแต่ละส่วน
- **domain ที่ซับซ้อนและเปลี่ยนเร็ว** ถ้ากฎคือส่วนที่มีค่า การมี business layer ที่พึ่ง data access ก็คือกลับด้านผิด ให้กลับทิศ dependency ([hexagonal](../hexagonal-architecture/))
- **ส่วนที่ต้อง release หรือ scale ต่างกัน** Azure บอกว่าการออกแบบแบบ monolith ทำให้ deploy feature แยกกันไม่ได้ ถ้าความสามารถไหนต้องมีรอบ release หรือการ scale ของตัวเอง ให้แบ่งตามความสามารถแทนการแบ่งตาม layer
- **request ส่วนใหญ่แค่ส่งผ่าน** ถ้า request แทบทุกตัวไหลลงไปแล้วกลับขึ้นมาโดยไม่มี logic ระหว่างทาง layer ก็เป็นแค่พิธีกรรม การออกแบบที่ง่ายกว่า หรือเส้นทางอ่านที่แยกไว้ชัดเจน จะเหมาะกว่า

## ได้อะไร เสียอะไร

ข้อดี:

- **คุ้นเคย** รูปแบบนี้คนรู้จักกันกว้างมาก คนใหม่หา controller, service และ repository เจอได้ตั้งแต่วันแรก
- **แยกหน้าที่กันชัด** แต่ละ layer ทำความเข้าใจแยกกันได้ Fowler ชี้ว่าแบบนี้ทำให้คิดทีละเรื่องได้ และเปิดทางให้มีหลาย presentation (web app, mobile app, API, command line) วางอยู่บน domain layer ตัวเดียว
- **เทสต์ layer แยกเดี่ยว ๆ ได้** layer คือรอยต่อ พอมี interface คั่น data access layer ปลอมก็ทำให้เทสต์ business เร็วและไม่ต้องพึ่ง database ไหนเลย
- **แบ่งตามทักษะได้ตาม layer** ผู้เชี่ยวชาญ front-end, back-end และ database ทำงานใน layer ที่ตรงกับทักษะของตัวเองได้ ข้อเตือนของ Fowler พูดถึงทีม ไม่ใช่ตัวคน แต่ละคนเชี่ยวชาญเฉพาะทางได้ แต่ทีมที่จัดตาม layer จะเพิ่มแรงเสียดทานระหว่างกลุ่มที่ต้องทำงานร่วมกันในทุก feature และทำให้ developer อยู่ห่างจาก user มากขึ้น แต่ละทีมเลยควรครอบคลุมทุก layer

จุดที่เจ็บ (step 4):

- **Sinkhole** request ที่ผ่านทุก layer โดยไม่มี layer ไหนเพิ่มอะไรเลย เสียทั้ง latency และโค้ดไปเปล่า ๆ Richards เรียกแบบนี้ว่า anti-pattern *architecture sinkhole* และ Azure ก็ยกรูปแบบเดียวกันในระดับ tier คือ tier กลางที่ทำแค่ create, read, update และ delete พื้น ๆ เป็นหนึ่งในความท้าทายของ N-tier การส่งผ่านบ้างเป็นเรื่องปกติในระบบ layered ทุกระบบ แต่ถ้า request ส่วนใหญ่เป็นแบบนี้ layer ก็มีต้นทุนมากกว่าที่ให้
- **แบ่งตามเทคนิคแทนที่จะแบ่งตาม domain** layer แบ่งโค้ดตามหน้าที่ทางเทคนิค ความสามารถทาง business หนึ่งอย่าง เช่นการสั่งซื้อ เลยกระจายอยู่ในทุก layer แค่เพิ่ม field เดียวให้ order ก็ต้องแตะฟอร์ม, request object, กฎ, mapping และ column คือทุก layer ส่วน [vertical slice architecture](https://www.jimmybogard.com/vertical-slice-architecture/) ของ Jimmy Bogard ก็เริ่มจากข้อสังเกตนี้เป๊ะ ๆ
- **ทุก feature แตะทุก layer** การแก้เลยกว้าง merge ชนกัน และถ้าทีมแบ่งตาม layer ตัว feature เดียวก็ต้องใช้ทุกทีม
- **deployable ตัวเดียวที่ scale ไปทั้งก้อน** ต่อให้โค้ดแบ่ง layer ไว้สะอาดแค่ไหน การ deploy แบบ tier เดียวก็ปล่อยและ scale ทุกอย่างไปพร้อมกัน คู่มือของ Microsoft บอกว่าการ scale out แอปพลิเคชันแบบนี้หมายถึงต้องก็อปทั้งก้อนไปลง server เพิ่ม ถึงจะมีแค่ส่วนเดียวที่โหลดหนักก็ตาม
- **ไหลออกนอกกรอบถ้าไม่มีอะไรบังคับ** ถ้า build ไม่ได้เช็กให้ กฎก็อยู่แค่ในหัวคน ทางลัดจาก controller ไปหา repository ก็ compile ผ่านสบาย ๆ พอมีแบบนี้มากพอ layer ก็เหลือแค่ชื่อ folder
- **open layer ลามได้** ทุกข้อยกเว้นเพิ่ม dependency ที่ข้าม layer และตัวเรียกที่ใช้มันก็เสีย isolation ที่ step 2 ต้องพึ่ง

## ข้อควรรู้ตอนลงมือทำ

- **ทำให้กฎเช็กได้**
  - *ข้อตกลงเรื่อง package:* หนึ่ง package, namespace หรือ folder ต่อหนึ่ง layer ตั้งชื่อให้บอกชัด (`web`, `service`, `repository`) และ import ไปทางเดียว
  - *build module:* แยกแต่ละ layer เป็น build module ของตัวเอง ให้พึ่งแค่ layer ที่อยู่ถัดลงไปตรง ๆ ถ้าใช้ plugin `java-library` ของ Gradle ให้ประกาศ dependency นั้นเป็น `implementation` แทน `api` เพราะ implementation dependency จะไม่ไปอยู่ใน compile classpath ของคนที่ใช้ module นั้น Presentation เลย compile โดยเรียกใช้ Data access ไม่ได้เลยด้วยซ้ำ
  - *architecture test:* ArchUnit (Java) มีกฎสำหรับ layered architecture ตัวอย่างนี้ทำให้ทั้งสาม layer เป็น closed และทุกการเรียกชี้ลงล่าง:

    ```java
    @ArchTest
    static final ArchRule layers = layeredArchitecture()
        .consideringAllDependencies()
        .layer("Presentation").definedBy("..web..")
        .layer("Business").definedBy("..service..")
        .layer("DataAccess").definedBy("..repository..")
        .whereLayer("Presentation").mayNotBeAccessedByAnyLayer()
        .whereLayer("Business").mayOnlyBeAccessedByLayers("Presentation")
        .whereLayer("DataAccess").mayOnlyBeAccessedByLayers("Business");
    ```

    พอจะเปิด Business ให้การอ่านข้ามได้ ก็กลายเป็นการแก้บรรทัดเดียวที่เห็นชัดและผ่านการ review: `.whereLayer("DataAccess").mayOnlyBeAccessedByLayers("Business", "Presentation")`
  - *stack อื่น:* สำหรับ Python ตัว layers contract ของ Import Linter กันไม่ให้ layer ล่าง import layer บน ไม่ว่าจะตรง ๆ หรือผ่าน module อื่น แต่ยอมให้ layer บน import อะไรก็ได้ที่อยู่ข้างล่าง แบบนี้คือ layering แบบ open ถ้าจะทำให้ layer เป็น closed ให้เพิ่ม forbidden contract ระหว่าง layer ด้านนอกทั้งสองโดยตั้ง `allow_indirect_imports` ไว้ เส้นทางที่ถูกต้องผ่าน layer ตรงกลางจะได้ยังผ่านอยู่
- **ให้ type ของแต่ละ layer อยู่ในบ้านตัวเอง** Presentation ใช้ view model กับ request และ response object ส่วน Business ใช้ object ของตัวเอง และ Data access ใช้ row หรือ ORM entity คู่มือ DDD ของ Microsoft กัน domain entity ออกจาก presentation layer ก็ด้วยเหตุผลนี้ การ map ต้องเขียนโค้ดเพิ่มบ้าง แต่มันคือสิ่งที่กันไม่ให้การเปลี่ยน database ลามไปถึงหน้าจอ
- **validate ให้ถูกที่** การเช็กรูปแบบ (มี field นี้ไหม วันที่เป็นวันที่จริงไหม) อยู่ใน Presentation ส่วน business rule (มีสต็อกไหม ส่วนลดใช้ได้ไหม) อยู่ใน Business ทุกทางที่เข้ามา (HTML, JSON, batch job, เทสต์) จะได้เจอกฎชุดเดียวกัน ปกติ business layer ยังเป็นตัวกำหนดขอบเขต transaction ของ use case ด้วย เพราะ repository ไม่มีทางรู้ว่าการเขียนไหนต้องไปด้วยกัน
- **เปิด layer อย่างตั้งใจ ไม่ใช่เผลอเปิด** ถ้าการอ่านจำนวนมากเป็น sinkhole ก็เลือกเอา จะยอมรับมันไป จะเปิด Business ให้ query แบบอ่านอย่างเดียวชุดที่ตั้งชื่อไว้ หรือจะให้การอ่านมีเส้นทางและ model ของตัวเอง ([CQRS](../cqrs/)) แล้วบันทึกการตัดสินใจไว้ใน architecture test
- **Tier:** ให้ web tier กับ application tier เป็น stateless เพื่อให้ load balancer ส่ง request ไหนไปที่ instance ไหนก็ได้ ให้แต่ละ tier มี subnet ของตัวเองและรับ traffic จาก tier ข้างบนเท่านั้น วาง firewall ไว้หน้า web tier ตั้ง timeout ให้ทุกการเรียกข้าม tier และลองพิจารณาใส่ queue ระหว่าง web tier กับ worker สำหรับงานที่ช้า (สไตล์ Web-Queue-Worker)

**ญาติ ๆ**

- **[Hexagonal](../hexagonal-architecture/), onion และ clean architecture** ยังใช้ความคิดเรื่อง layer แต่กลับทิศ dependency ชั้นล่างสุด โดย core ของ business เป็นคนกำหนด interface ที่ตัวเองต้องการ แล้ว data access ก็ implement ตาม ทำให้ dependency ชี้เข้าหา domain แทนที่จะชี้ไปหา database ส่วน Fowler บอกว่าการวาง mapper ไว้ระหว่าง domain กับ data source ทำให้ domain ไม่ต้องพึ่ง data source อีก นี่ก็คือแนวทาง hexagonal และคู่มือของ Microsoft ก็เสนอ clean architecture คือการใช้ dependency inversion principle เป็นคำตอบของปัญหาการเทสต์ในแอปพลิเคชันแบบ N-layer
- **Vertical slice และ [modular monolith](../modular-monolith/)** หมุนการแบ่งไปเก้าสิบองศา หน่วยระดับบนสุดคือ feature หรือความสามารถทาง business แต่ละหน่วยมี layer ของตัวเองอยู่ข้างใน และ layer พวกนี้มักบาง ๆ ทำให้ field ใหม่แก้แค่ slice เดียว แทนที่จะแก้ทุก layer ของทั้งแอปพลิเคชัน
- **[Microservices](../microservices/)** microservice หนึ่งตัวมักเป็นแอปพลิเคชันแบบ layered ขนาดเล็กที่มีขอบเขตตามความสามารถทาง business การแบ่งระบบเป็น service *ตาม layer* (web service, business service, data service) ก็คือการสร้าง N-tier ขึ้นมาใหม่บน network ทุก feature ก็ยังต้องข้ามทุก service อยู่ดี
- **Microkernel (plug-in)** เป็นอีกรูปแบบคลาสสิกของ deployable ตัวเดียว คือ core เล็ก ๆ ที่ขยายด้วย plug-in แทนที่จะเป็น layer ซ้อนกัน
- **[Anti-corruption layer](../anti-corruption-layer/)** ใช้คำว่า layer ในอีกความหมาย มันคือขอบเขตการแปลไปหา model ของระบบอื่น ไม่ใช่ชั้นแนวนอนของโค้ดเราเอง
- **ที่มา** pattern นี้เก่าแล้ว Buschmann และผู้เขียนร่วมจัดไว้ในชื่อ Layers ในหนังสือ *Pattern-Oriented Software Architecture, Volume 1* (1996) และ *Software Architecture Patterns* ของ Richards ก็อธิบายมันในชื่อ layered architecture style
