## ปัญหา

ตารางที่ normalise แล้วมีรูปร่างเหมาะกับการเขียน ทุก fact เก็บไว้ที่เดียว order line เลยรู้จัก product ของมันแค่ผ่าน id และคำถามอย่าง *revenue per product* ก็ต้องประกอบขึ้นมาตอนอ่าน: join `order_items` กับ `products` แล้ว aggregate ทุก order line และ database ก็ต้องทำงานนี้ซ้ำให้คนดู dashboard ทุกคน ถึงแทบไม่มีอะไรเปลี่ยนตั้งแต่ครั้งที่แล้วก็ตาม และงานก็โตตามขนาดตาราง ถ้ารันบน system of record มันยังแย่งทรัพยากรกับ transaction ที่กำลังเขียนตารางพวกนั้นอยู่ด้วย

วิธีแก้แรก ๆ ที่คนมักใช้ไม่ได้ทำให้งานหายไป index ช่วยให้ query หาแถวไม่กี่แถวเจอ แต่ไม่ได้ทำให้ aggregation ที่ต้องไล่ทุกแถวถูกลง [read replica](../read-replicas/) ย้าย query ไปอีก server แต่ที่นั่นก็แพงเท่าเดิม ถ้าคำตอบแพง ๆ ตัวเดิมถูกขอซ้ำแล้วซ้ำอีก ทางที่เหลือก็คือคำนวณมันไว้ก่อนที่ใครจะถาม

## ทำงานยังไง

**materialized view** คือผลลัพธ์ของ query ที่เก็บไว้ ในรูปที่คำถามหนึ่งต้องการ มันมีสามส่วน:

1. **definition**: ตัว query ในที่นี้คือ join และ aggregation ของ dashboard
2. **แถวที่เก็บไว้**: ผลลัพธ์ของมัน ในที่นี้คือ `sales_by_product` ที่มีหนึ่งแถวต่อ product ฝั่งที่อ่านจะดึงแถวพวกนี้ตาม key และไม่เคยเขียนลงไป
3. **การดูแลให้ทันสมัย** (maintenance): process ที่ทำให้แถวพวกนี้ตามทันหลังต้นทางเปลี่ยน

view นี้เป็น *derived data* มันไม่มีอะไรที่ drop ทิ้งแล้วสร้างใหม่จากต้นทางไม่ได้ เพราะแบบนี้มันถึงเปลี่ยนรูป ย้ายไป store อื่น หรือทิ้งไปได้โดยไม่เสียอะไรเลย

### มันไม่ใช่อะไร

- **view ธรรมดา** เก็บแค่ข้อความของ query แล้วรันมันทุกครั้งที่อ่าน ประหยัดการพิมพ์ ไม่ได้ประหยัดงาน
- **index** ก็เป็น derived data ที่ database คอย update ให้ทุกครั้งที่เขียน แต่ช่วยได้แค่หาแถวของตารางเดียว ส่วน materialized view เก็บ*ผลลัพธ์*ของ join และ aggregation และมี index ของตัวเองได้ด้วย
- **cache** ([Cache-Aside](../cache-aside/)) ถูกเติมตามความต้องการทีละ key และ entry ก็หมดอายุ การอ่านเลยอาจ miss แล้วต้องจ่ายราคาเต็ม ส่วน materialized view มีครบทุก key สร้างไว้ก่อนการอ่าน และถูกดูแลให้ทันสมัยแทนที่จะหมดอายุ
- **read replica** ([Read Replicas](../read-replicas/)) คือสำเนาเต็มที่มี schema เดียวกัน มันเพิ่มกำลังให้ query แพง ๆ แต่ไม่ได้ทำให้ query ถูกลง
- **CQRS read model** ([CQRS](../cqrs/)) เป็นแนวคิดที่ใหญ่กว่า: model แยกสำหรับการอ่านทั้งหมดของแอปพลิเคชัน โดยรับข้อมูลจากการเขียน materialized view เป็นวิธีหนึ่งในการสร้างมัน

### สามวิธีทำให้ view สดใหม่อยู่เสมอ

| | ทำยังไง | stale ได้แค่ไหน | ต้องจ่ายอะไร |
|---|---|---|---|
| **Full refresh** | รัน query ใหม่แล้วแทนที่ข้อมูลทั้งหมด ตามตารางเวลาหรือเมื่อสั่ง | ได้ถึงหนึ่งช่วงเวลา บวกเวลาที่ refresh ใช้ | scan ต้นทางทุกครั้ง ไม่ว่าจะเปลี่ยนไปน้อยแค่ไหน |
| **Incremental maintenance** | apply แค่ส่วนที่เปลี่ยนตั้งแต่ refresh ครั้งล่าสุด โดยอ่านจาก change log หรือ stream | หลักวินาที หรือเท่ากับช่วงห่างระหว่างการรัน incremental สองรอบ | งานเป็นสัดส่วนกับการเปลี่ยนแปลง บวกกลไกที่จับทุกการเปลี่ยนแปลงแล้ว apply มันแค่ครั้งเดียวพอดี และไม่ใช่ทุก query ที่ดูแลแบบนี้ได้ |
| **Synchronous maintenance** | update view ภายใน transaction ที่เปลี่ยนแถวต้นทาง | ไม่ stale เลย | การเขียนทุกครั้งช้าลง และ writer ที่แตะแถวสรุปเดียวกันต้องต่อคิวกัน |

ใน diagram มี order ใหม่เพิ่มแถวหนึ่งแถวใน `order_items` ถ้าทำ full refresh ตอน 09:15 ก็ต้องอ่านทุก order line ใหม่หมดถึงจะได้ 14 Mugs และ $280 ส่วน incremental maintenance ไปถึงตรงนั้นได้ด้วยการเขียนเล็ก ๆ ครั้งเดียว:

```sql
UPDATE sales_by_product SET units = units + 2, revenue = revenue + 40 WHERE product = 'Mug';
```

statement นี้ก็แสดงให้เห็นความยากด้วย: การเปลี่ยนแปลงที่ถูก apply สองครั้งจะถูกนับสองครั้ง และการเปลี่ยนแปลงที่หายไปจะไม่ถูกนับเลย incremental maintenance รันได้ถูก แต่ทำให้ถูกต้องได้ยากกว่า

### view อยู่ที่ไหน

**อยู่ใน database** ที่ engine เก็บและดูแลมันให้:

- **PostgreSQL** คำสั่ง `CREATE MATERIALIZED VIEW` เก็บผลลัพธ์ไว้ มันจะเปลี่ยนก็ต่อเมื่อรัน `REFRESH MATERIALIZED VIEW` และการ refresh จะคำนวณใหม่แล้วแทนที่ข้อมูลทั้งหมด การ refresh แบบธรรมดาจะกันไม่ให้ใครอ่าน view ได้จนกว่าจะเสร็จ ส่วน `REFRESH MATERIALIZED VIEW CONCURRENTLY` ปล่อยให้ฝั่งที่อ่านใช้ข้อมูลเก่าไปพลาง ๆ แต่ต้องมี unique index บน column ธรรมดาที่ครอบทุกแถว และ view ต้องมีข้อมูลอยู่แล้ว และจะช้ากว่าถ้าแถวส่วนใหญ่เปลี่ยน view หนึ่งตัวรัน refresh ได้ทีละครั้งเท่านั้น incremental maintenance ไม่ได้มีมาในตัว แต่ extension `pg_ivm` เพิ่ม view ที่ trigger คอย update ให้ภายใน transaction ที่เขียน
- **SQL Server** *indexed view* คือ view ที่มี unique clustered index: ผลลัพธ์ถูกเก็บเหมือนตาราง และ engine จะ update มันเป็นส่วนหนึ่งของทุก insert, update และ delete บนตารางต้นทาง มันไม่เคย stale แต่การเขียนทุกครั้งต้องจ่ายราคา ทำให้ Microsoft แนะนำว่าไม่ควรใช้กับข้อมูลที่ update บ่อย definition ก็มีข้อจำกัด: ต้อง schema-bound และ deterministic ห้ามมี outer join, subquery, `DISTINCT`, `MIN` หรือ `MAX` และต้องมี `COUNT_BIG(*)` ทุกครั้งที่ group
- **Oracle Database** *fast refresh* จะ apply แค่การเปลี่ยนแปลงที่ materialized view log บนตารางต้นทางบันทึกไว้ จะทำเมื่อสั่ง หรือทำเป็นส่วนหนึ่งของแต่ละ commit ก็ได้ (`REFRESH FAST ON COMMIT` แบบนี้ commit จะใช้เวลานานขึ้น) ส่วน *complete refresh* จะรัน query ใหม่
- **Cloud data warehouse** refresh ให้เอง แต่มีข้อจำกัด *BigQuery* refresh materialized view อยู่เบื้องหลัง (default คือภายใน 5 ถึง 30 นาทีหลังมีการเปลี่ยนแปลง และไม่ถี่กว่าทุก 30 นาที) และตอน query ก็เอาแถวที่เก็บไว้มารวมกับอะไรก็ตามที่เปลี่ยนในตารางต้นทางหลังจากนั้น คำตอบเลยเป็นปัจจุบันเสมอ เว้นแต่จะยอมให้ stale ได้ด้วย `max_staleness` วิธีนี้ใช้ได้แค่กับ SQL บางส่วนที่จำกัดไว้ ส่วน definition แบบอื่นประกาศเป็น non-incremental ได้ แล้วจะถูกคำนวณใหม่ทั้งหมดทุกครั้งที่ refresh ส่วน *Snowflake* ดูแล materialized view ด้วย background service และคืนผลที่เป็นปัจจุบันเสมอ แต่ view แบบนี้อ่านได้แค่ตารางเดียว (ไม่มี join) และต้องใช้ Enterprise Edition ส่วน *dynamic table* ของมันรับ join ได้ และถูก refresh แบบ incremental หรือแบบเต็ม เพื่อให้อยู่ในระดับ target lag ที่ตั้งไว้ *Amazon Redshift* refresh แบบ incremental ถ้า definition เปิดให้ทำได้ ไม่อย่างนั้นก็ refresh แบบเต็ม: outer join, set operation, window function และ subquery ทำให้ใช้ทาง incremental ไม่ได้

**อยู่ใน store แยก โดยโค้ดของคุณเองเป็นคนดูแล** consumer ของ [change data capture](../change-data-capture/) หรือของ domain event ([Event-Driven Architecture](../event-driven-architecture/)) คอย update ตาราง, document หรือ search index ให้ทันสมัย view จะอยู่ใน store ไหนก็ได้ที่เหมาะกับการอ่าน และรวมข้อมูลจากหลายต้นทางได้ แลกกับการที่คุณต้องดูแลเรื่องลำดับ การ retry การ backfill และการ rebuild เอง คู่มือด้าน architecture มักหมายถึงความหมายกว้างแบบนี้เวลาพูดชื่อ pattern นี้: projection แบบ read-only อะไรก็ได้ที่ pipeline คอยดูแล โดยที่ object ใน database เป็นแค่ implementation แบบหนึ่ง

**อยู่ใน stream processor** ตัว engine ที่สร้างมาเพื่อ incremental view maintenance รับ definition เป็น SQL แล้ว update ผลลัพธ์ทุกครั้งที่มีการเปลี่ยนแปลงเข้ามา Materialize ดูแล materialized view ให้ทันสมัยแบบ incremental และเก็บผลลัพธ์แบบ durable ส่วนใน Apache Flink ตัว continuous query บนตารางที่เปลี่ยนไปเรื่อย ๆ จะให้ result table ที่ถูก update ต่อเนื่อง gold table ของ medallion architecture ก็เป็นญาติใกล้ ๆ: มีรูปตาม query เป็น derived data และ rebuild ได้

## ใช้ตอนไหนดี

- **query ที่ทั้งแพงและเรียกบ่อย** และมีรูปร่างคงที่: dashboard, report, leaderboard, counter, หน้า list ที่มียอดรวม ให้ชั่งต้นทุนของ query คูณจำนวนครั้งที่รัน เทียบกับต้นทุนการดูแล view คูณจำนวนครั้งที่ข้อมูลเปลี่ยน
- **ข้อมูลที่ถูกอ่านบ่อยกว่าเปลี่ยนมาก ๆ** และคนอ่านรับคำตอบที่ตามหลังนิดหน่อยได้
- **การอ่านที่รวมข้อมูลจากหลาย service** แต่ละ service publish การเปลี่ยนแปลงของตัวเอง แล้วฝั่งที่อ่านเก็บสำเนาที่ join ไว้แล้วเป็นของตัวเอง ทำให้ไม่มี service ไหนต้อง query ตารางของ service อื่น: นี่คือกฎเบื้องหลัง [microservices](../microservices/) ที่แยก database ต่อ service
- **ต้นทางที่ตอบคำถามไม่ได้ถ้าไม่อ่านทุกอย่าง** เช่น event store ([Event Sourcing](../event-sourcing/)) หรือ key-value store

เป็นเครื่องมือที่ผิดงานสำหรับ:

- **query เฉพาะกิจที่ไม่มีรูปร่างคงที่** view ตอบได้แค่คำถามที่มันถูกสร้างมาให้ตอบ การสำรวจข้อมูลควรไปทำบน replica หรือใน warehouse
- **ข้อมูลที่เปลี่ยนบ่อยกว่าถูกอ่านมาก ๆ** ค่าดูแลจะแพงกว่าการอ่านที่มันช่วยประหยัด
- **คำตอบที่ต้องเป็นปัจจุบันเป๊ะ ๆ** เช่นยอดเงินที่เช็กก่อนจ่าย ให้อ่านจากต้นทาง หรือยอมจ่ายค่าเขียนของ synchronous maintenance

## ได้อะไร เสียอะไร

- **Staleness** ตัว view ที่ refresh หรือรับข้อมูลแบบ asynchronous จะตามหลังต้นทางเท่ากับช่วง refresh หรือ processing lag ของมัน ตัดสินใจก่อนว่าคนอ่านแต่ละกลุ่มรับ lag ได้แค่ไหน แล้วค่อยเลือกวิธี maintenance และแสดงเวลา as-of ไว้ข้าง ๆ ตัวเลข
- **คนอ่านที่คาดว่าจะเห็นสิ่งที่ตัวเองเพิ่งเขียน** คนที่เพิ่งสั่ง order แล้วเปิด dashboard อาจหามันไม่เจอ ให้ส่งการอ่านนั้นไปที่ต้นทาง พักมันไว้จนกว่า view จะ apply position ของการเขียนนั้นแล้ว (เทคนิคที่อธิบายไว้ใน [Read Replicas](../read-replicas/) และ [CQRS](../cqrs/)) หรือแสดงการเปลี่ยนแปลงของ user เองแบบ optimistic
- **มีงานทุกครั้งที่เขียนหรือ refresh** synchronous maintenance ทำให้การเขียนแต่ละครั้งช้าลง full refresh ทำให้ต้นทางต้องรับการ scan หนัก ๆ ทุกรอบ incremental maintenance ทำงานน้อยกว่า แต่ต้องมี change capture และถ้ามีสิบ view ก็คูณสิบไม่ว่าจะเลือกแบบไหน
- **Storage** สำหรับทุกสำเนา และสำหรับ change log ที่ incremental maintenance อ่าน
- **มีของให้ดูแลเพิ่มอีกชิ้น** refresh job ล้มเหลวได้ stream ก็ตามหลังได้ และ view ที่หยุด refresh ไปแล้วก็ยังตอบอยู่ ด้วยตัวเลขเก่า
- **definition มีข้อจำกัด** engine ที่ดูแล view แบบ incremental หรือ synchronous รับ SQL ได้แค่บางส่วน definition ที่อยู่นอกขอบเขตนั้นจะถูกปฏิเสธ หรือถอยไปใช้ full refresh
- **view เริ่มไม่ตรงกัน** view สองตัวที่ refresh คนละจังหวะอาจตอบไม่ตรงกันเอง และไม่ตรงกับต้นทาง จนกว่าทั้งสองตัวจะตามทัน

## ข้อควรรู้ตอนลงมือทำ

- **เริ่มจาก query ของฝั่งที่อ่าน** เก็บผลลัพธ์ที่มันต้องการพอดี โดยมี key และ index ตามการ lookup ของมัน view ละหนึ่งคำถามจะยังเรียบง่าย ส่วน view ที่รับใช้ห้าหน้าจอจะกลายเป็น schema ชุดที่สอง
- **เลือกว่าจะ materialize อะไรด้วยตัวเลข** ลิสต์ query เรียงตามเวลารวม (ต้นทุนคูณความถี่) แล้วดูว่า input ของมันเปลี่ยนบ่อยแค่ไหน query ที่ช้าแต่นาน ๆ เรียกที หรือเรียกบ่อยแต่ถูก ส่วนใหญ่ปล่อยไว้แบบเดิมดีกว่า
- **บันทึกเวลา as-of** เก็บเวลา หรือ log position ของต้นทางที่ข้อมูลใน view ตรงกับมัน แล้วคืนไปพร้อมกับข้อมูลด้วย ส่วน catalog ของ PostgreSQL ไม่ได้บันทึกว่า materialized view ถูก refresh ครั้งล่าสุดตอนไหน เลยต้องเก็บเอง
- **อย่า block ฝั่งที่อ่านระหว่าง refresh** ใช้รูปแบบที่ไม่ block ของ engine หรือสร้างไว้ข้าง ๆ แล้วสลับ ตามที่อธิบายในข้อถัดไป ใน PostgreSQL:

  ```sql
  CREATE UNIQUE INDEX ON sales_by_product (product);        -- CONCURRENTLY needs it
  REFRESH MATERIALIZED VIEW CONCURRENTLY sales_by_product;
  ```

- **สร้างใหม่ไว้ข้าง ๆ แล้วค่อยสลับ** ถ้าเป็น definition ใหม่ หรือ view ที่เริ่มไม่ตรงกับต้นทาง ก็สร้างเวอร์ชันใหม่ด้วยชื่ออื่น ตรวจมัน สลับฝั่งที่อ่านไปในขั้นเดียว แล้ว drop เวอร์ชันเก่าเมื่อตัวใหม่รับการอ่านจริงไปแล้ว ภายใน database เดียว ถ้า DDL เป็น transactional การสลับก็ทำได้ด้วยการ rename ทั้งสองเวอร์ชันใน transaction เดียว อีกทางคือใช้ view ธรรมดาที่ฝั่งที่อ่าน query แล้วเปลี่ยนให้มันชี้ไปที่ตัวใหม่ out-of-place refresh ของ Oracle ทำแบบเดียวกันภายใน engine: มันสร้างข้อมูลใหม่ในตารางภายนอกแล้วสลับเข้ามา
- **Backfill incremental view จาก snapshot** โหลด snapshot ของต้นทางที่ consistent แล้ว apply การเปลี่ยนแปลงที่มาหลัง position ของ snapshot นั้น ขั้นตอนเดียวกันนี้ก็คือการ rebuild เลยควรซ้อมไว้
- **Apply การเปลี่ยนแปลงตามลำดับและแค่ครั้งเดียว** stream ส่งซ้ำได้ และ delta ที่ apply สองครั้งจะถูกนับสองครั้ง บันทึก position ล่าสุดที่ apply ไปแล้วไว้ใน transaction เดียวกับการ update แล้วข้ามทุกอย่างที่อยู่ตรงหรือก่อน position นั้น ([Idempotent Consumer](../idempotent-consumer/)) และจัดการ update กับ delete ด้วย ไม่ใช่แค่ insert: aggregate ต้องลบออกได้ด้วย
- **ให้ optimizer ใช้ view ได้ในที่ที่ใช้ได้** บาง engine จะ rewrite query ที่ยิงไปที่ตารางต้นทาง ให้ไปอ่านจาก view ที่ตรงกันแทน: query rewrite ของ Oracle, smart tuning ของ BigQuery, automatic query rewriting ของ Redshift และ SQL Server ใน edition ที่จับคู่ indexed view ให้อัตโนมัติ (บน Standard edition ตัว query ต้องระบุชื่อ view พร้อม hint `NOEXPAND`) ส่วนใน PostgreSQL มีแค่ query ที่ระบุชื่อ view เท่านั้นที่ได้ใช้มัน
- **Monitor มันเหมือน pipeline** ติดตามเวลาที่ refresh ใช้เทียบกับช่วงเวลา refresh (refresh ที่ใช้เวลานานกว่าช่วงของมันจะไม่มีวันตามทัน) อายุของ view (เวลาปัจจุบันลบเวลา as-of หรือจำนวนการเปลี่ยนแปลงที่ยังไม่ได้ apply) โดยมี alert ที่ระดับ staleness ที่สัญญาไว้กับคนอ่าน และ refresh ที่ล้มเหลวหรือถูกข้าม แล้วสุ่มเทียบ view กับต้นทางเป็นระยะ
- **เอากฎของต้นทางติดไปด้วย** access control และข้อกำหนดเรื่องการลบข้อมูลใช้กับสำเนาด้วย: แถวที่ถูกลบออกจากต้นทางด้วยเหตุผลเรื่อง privacy ต้องหายไปจากทุก view ที่สร้างจากมัน
