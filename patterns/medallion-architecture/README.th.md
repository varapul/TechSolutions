## ปัญหา

ข้อมูล analytics มาจากหลายที่: change event จาก operational database, clickstream และไฟล์ที่ partner ส่งมาวันละครั้ง ถ้าทุก report และทุก model อ่าน feed พวกนี้ตรง ๆ แต่ละทีมก็ต้องเขียน parsing, deduplication และ business rule ของตัวเอง แล้วตัวเลขของแต่ละทีมก็ไม่ตรงกัน แต่ถ้าทำความสะอาดข้อมูลตอนรับเข้า แล้วเก็บไว้แค่สำเนาที่ทำความสะอาดแล้ว rule แต่ละข้อก็ถูกใช้ครั้งเดียวแล้วจบเลย: พอรู้ทีหลังว่า transformation ผิด (อัตราแลกเปลี่ยนผิด หรือ parser ที่ทำวันที่เพี้ยน) record ต้นฉบับก็หายไปแล้ว และสร้างประวัติขึ้นมาใหม่ไม่ได้ record ที่ถูกปฏิเสธก็หายไปโดยไม่ทิ้งร่องรอย และไม่มีใครบอกได้ว่า dashboard ไหนสร้างจาก input ไหน

## ทำงานยังไง

Medallion architecture ที่บางทีก็เรียกว่า *multi-hop* architecture จัด lakehouse เป็นชั้น ๆ ที่คุณภาพสูงขึ้นเรื่อย ๆ แต่ละ hop คือ job ที่อ่านชั้นหนึ่งแล้วเขียนชั้นถัดไป และแต่ละชั้นให้คำสัญญาข้อเดียว:

| ชั้น | เก็บอะไร | สัญญาอะไร | ใครอ่าน |
|---|---|---|---|
| **Bronze** (raw) | ทุก record ตามที่ source ส่งมาเป๊ะ ๆ แบบ append พร้อม ingestion metadata | ประวัติที่ครบถ้วนและ replay ได้: ไม่แก้อะไร ไม่ลบอะไร | pipeline ที่สร้าง silver รวมถึง engineer และ auditor |
| **Silver** (validated) | record ที่ใส่ type แล้ว ลบ duplicate แล้ว และจัดรูปให้ตรงกันแล้ว ส่วน record ที่ถูกปฏิเสธแยกไว้ใน quarantine | มี record ทุกตัวอย่างน้อยหนึ่งเวอร์ชันที่ผ่านการตรวจแล้วและยังไม่ถูก aggregate | engineer, analyst, data scientist |
| **Gold** (business-ready) | aggregate, dimensional model และ feature table ที่ตั้งชื่อด้วยคำทางธุรกิจ | จัดรูปและมี governance สำหรับผู้ใช้กลุ่มเดียว อ่านได้เร็ว | dashboard, ML model, แอปพลิเคชัน |

- **Bronze** เก็บข้อมูลของแต่ละ source ในรูปเดิม และมีแต่จะโตขึ้น [Databricks](https://docs.databricks.com/aws/en/lakehouse/medallion) แนะนำให้ validate ที่ชั้นนี้ให้น้อยที่สุด โดยเก็บ field ส่วนใหญ่เป็น string, `VARIANT` หรือ binary เพื่อให้การเปลี่ยน schema ที่ไม่คาดคิดทำข้อมูลหายไม่ได้ และมอง bronze เป็น input ของ pipeline มากกว่าเป็นที่ให้ analyst query ส่วน [Microsoft Fabric](https://learn.microsoft.com/en-us/fabric/onelake/onelake-medallion-lakehouse-architecture) ก็เก็บ bronze ในรูปแบบของ source เท่าที่ทำได้เหมือนกัน และแนะนำให้ใช้ *shortcut* แทนการ copy ถ้าไฟล์อยู่ใน OneLake, ADLS Gen2, Amazon S3 หรือ Google Cloud Storage อยู่แล้ว
- **Silver** เป็นที่ที่ record ถูกทำความสะอาดและจัดรูปให้ตรงกัน: บังคับ schema แปลง type จัดการค่า null ลบ duplicate รับมือ record ที่มาช้าหรือมาผิดลำดับ ตรวจคุณภาพ และ join ส่วน Databricks แนะนำว่าอย่าโหลด silver ตรงจาก source เพราะถ้าทำแบบนั้น การเปลี่ยน schema หรือ record ที่เสียจะทำให้การโหลดพัง แทนที่จะแค่ไปลงใน bronze เฉย ๆ
- **Gold** เก็บ data product: dimensional model, aggregate และ feature table สำหรับผู้ใช้เฉพาะกลุ่ม เพราะ gold สะท้อน business domain บางองค์กรเลยมี gold หลายชั้น เช่นชั้นละหนึ่งสำหรับ finance, HR และ IT

ทั้งสามชั้นอยู่ใน **lakehouse** เดียว: ตารางที่เก็บเป็นไฟล์ open format (ส่วนใหญ่เป็น Parquet) ใน object storage โดยมี **open table format** อย่าง Delta Lake, Apache Iceberg หรือ Apache Hudi คอยเก็บ transaction log ไว้ข้าง ๆ ไฟล์พวกนั้น และ log ตัวนี้แหละที่ทำให้ hop ปลอดภัย ข้อแรก commit เป็น atomic ทำให้ reader ไม่มีทางเห็นผลลัพธ์ของ job แค่ครึ่งเดียว การเขียนถูกตรวจกับ schema ของตาราง: Delta Lake ปฏิเสธการเขียนที่ column หรือ type ไม่ตรง และจะเพิ่ม column ใหม่ก็ต่อเมื่อเราอนุญาตให้ schema evolve และทุก commit สร้างเวอร์ชันใหม่ของตาราง ทำให้ใน Delta Lake และ Iceberg เรา query ตารางตามสภาพที่มันเป็นในเวอร์ชันก่อนหน้าได้ (*time travel*) การออกแบบนี้ คือการจัดการแบบ warehouse บน open storage ราคาถูก มาจาก Armbrust, Ghodsi, Xin และ Zaharia ที่เสนอไว้ใน [paper ของ CIDR 2021](https://www.cidrdb.org/cidr2021/papers/cidr2021_paper17.pdf) ที่วางหลักของ lakehouse architecture

## ใช้ตอนไหนดี

- มีหลาย source (database change feed, event stream, ไฟล์จาก partner) ป้อนข้อมูลให้ผู้ใช้หลายแบบ: BI, machine learning, data API
- ต้องสร้าง derived data ใหม่ได้หลังเจอ bug หรือหลังเปลี่ยน rule หรือต้องแสดงได้ทีหลังว่า source ส่งอะไรมาบ้างแบบเป๊ะ ๆ
- ข้อมูล batch กับ streaming มาเจอกันบน platform เดียว และคนละทีมเป็นเจ้าของคนละขั้น

ตอนไหน**ไม่**ควรใช้:

- ข้อมูลเล็กที่อยู่ใน database ตัวเดียวได้สบาย ๆ: แค่ view ไม่กี่ตัวบนตาราง raw ก็พอ
- warehouse ตัวเดียวที่มี staged model แยกข้อมูล raw, ข้อมูลที่ทำความสะอาดแล้ว และข้อมูลที่พร้อมใช้ทางธุรกิจไว้แล้ว การแบ่งชั้นของ dbt (ดูด้านล่าง) ก็คือแนวคิดเดียวกันโดยไม่ต้องมี lake
- การตอบหน้าจอของแอปพลิเคชันเองแบบ latency ต่ำ อันนั้นคือ read model ในแอปพลิเคชัน (ดู [CQRS](../cqrs/)) ไม่ใช่ analytics pipeline

## ได้อะไร เสียอะไร

- **สำเนาและ hop มีราคา** record ชุดเดียวกันถูกเก็บใน bronze ใน silver และหลายครั้งก็เก็บอีกรอบใน gold และทุก hop ก็คือ job ที่ต้องรัน ต้อง monitor และต้องจ่ายเงิน
- **ทุก hop เพิ่ม latency** เว้นแต่จะรัน hop แบบ stream
- **ชื่อชั้นเป็นแค่ธรรมเนียม ไม่ใช่การรับประกัน** "Silver" หมายถึงอะไรก็ตามที่ check ของคุณบังคับไว้ ถ้าไม่มี expectation และเจ้าของที่ชัดเจน ชั้นต่าง ๆ ก็จะเพี้ยนไปเป็นสำเนาสามชุดของความยุ่งเหยิงเดียวกัน
- **ข้อมูลส่วนบุคคลเพิ่มจำนวน** สำเนาแต่ละชุดต้องอยู่ใต้กฎ retention และคำขอลบข้อมูลชุดเดียวกัน (ดู *Governance* ด้านล่าง)
- **มันเป็นคำแนะนำ ไม่ใช่กฎหมาย** Databricks เรียก pattern นี้ว่า best practice แต่ไม่ใช่ข้อบังคับ การดันทุก dataset ผ่านสามชั้นเพราะเป็นกฎ อาจเป็นแค่พิธีกรรมล้วน ๆ

## ข้อควรรู้ตอนลงมือทำ

**Ingestion**

- เอา batch file, stream และ feed จาก [change data capture](../change-data-capture/) มาลงที่ bronze และบันทึก source, load time และชื่อ batch หรือชื่อไฟล์ไว้กับทุกแถว
- ทำให้การโหลด **idempotent และ replay ได้** ในแบบเดียวกับ [idempotent consumer](../idempotent-consumer/): batch ที่ retry ต้องไม่ append แถวเดิมซ้ำสองรอบ ยกตัวอย่าง Delta Lake จะไม่สนการเขียนที่ใช้ application ID กับ transaction version ซ้ำกับที่มัน commit ไปแล้ว
- เตรียมรับ **ข้อมูลที่มาช้าและมาผิดลำดับ** ให้แก้มันใน silver (merge ตาม key, event-time window) ห้ามแก้ด้วยการไปแก้ bronze

**Data quality**

- ประกาศ check ไว้เป็น **expectation** อย่างใน [Lakeflow pipelines](https://docs.databricks.com/aws/en/ldp/expectations) ของ Databricks (ชื่อเดิม Delta Live Tables) แต่ละ expectation จะเลือกได้ว่าเก็บ record ที่เสียไว้แล้วนับจำนวน ทิ้งมัน หรือทำให้ update ล้มเหลว ส่วน materialized lake view ของ Fabric ก็มี data quality rule เหมือนกัน
- ส่ง record ที่ถูกปฏิเสธไปที่ **quarantine table** พร้อมเหตุผลและ batch ID แทนที่จะทิ้ง มันคือ [dead-letter queue](../dead-letter-queue/) ของ data pipeline และต้องมีคนรับผิดชอบคอย review แล้ว replay มัน
- ตกลง **data contract** กับทีมเจ้าของ source (schema, ความหมาย, ความสดใหม่) เพื่อให้จับ breaking change ได้ตั้งแต่ที่ขอบ ไม่ใช่ไปเจอใน dashboard

**Deduplication, merge และประวัติ**

- ลบ duplicate ตาม business key ด้วย merge: [เอกสารของ Delta Lake](https://docs.delta.io/delta-update/) แสดง `MERGE` แบบ insert-only ที่ข้าม record ที่มีอยู่ในตารางแล้ว
- apply CDC feed ลง silver เป็น upsert และ delete ด้วย `MERGE` เหมือนกัน
- เก็บประวัติไว้ในที่ที่ผู้ใช้ต้องการ อย่าง slowly changing dimension แบบ type 2 จะเก็บทุกเวอร์ชันของข้อมูล เช่นที่อยู่ของ customer พร้อมช่วงวันที่ที่มันใช้ได้ และก็เขียนด้วย `MERGE` เหมือนกัน

**Model ชั้น gold**

- star schema (fact และ dimension) สำหรับ BI, ตารางที่ aggregate ไว้ล่วงหน้าสำหรับ query ที่ hot (หลายครั้งก็คือ [materialized view](../materialized-view/)) และ feature table ที่มีหนึ่งแถวต่อ entity สำหรับ ML
- เขียนเอกสารบอก grain ของแต่ละตาราง ("หนึ่งแถวต่อ region ต่อวัน") และตั้งชื่อด้วยคำทางธุรกิจ

**Incremental processing และ backfill**

- งานประจำวัน ย้ายแค่ของใหม่: streaming read จากตาราง bronze ที่เป็น append-only, [change data feed](https://docs.delta.io/delta-change-data-feed/) ของ Delta Lake (การเปลี่ยนแปลงระดับแถวระหว่างเวอร์ชันของตาราง) หรือ incremental read ของ Iceberg ที่อ่านข้อมูลที่ append เข้ามาระหว่างสอง snapshot
- backfill ก็คือการ replay: แก้ job สร้างตาราง silver และ gold ที่ได้รับผลกระทบใหม่จาก bronze แล้วเทียบเวอร์ชันเก่ากับใหม่ด้วย time travel ก่อนที่ผู้ใช้จะสลับไปใช้

**Governance**

- register ทุกตารางไว้ใน **catalog** และเก็บ **lineage** ยกตัวอย่าง [Unity Catalog](https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-lineage) บันทึก lineage ให้อัตโนมัติลงไปถึงระดับ column และ Fabric ก็แสดง lineage ข้ามชั้นสำหรับ materialized lake view ถ้ามี lineage คำถามว่า "bug นี้ไปโดนอะไรบ้าง" ก็กลายเป็นแค่การเปิดดู แทนที่จะต้องสืบสวน
- ให้ **สิทธิ์เข้าถึงแยกตามชั้น**: bronze ให้ pipeline กับ engineer, silver ให้ analyst กับ data scientist, gold แยกตามกลุ่มผู้ใช้ Microsoft แนะนำให้ใช้ Fabric workspace แยกต่อชั้นด้วยเหตุผลนี้
- **ข้อมูลส่วนบุคคล**: mask หรือ tokenise มันใน silver และ gold คำขอลบข้อมูลต้องไปให้ถึง bronze ด้วย และแถวที่ถูกลบยังอยู่ในเวอร์ชันเก่าของตารางจนกว่าจะเก็บกวาดเวอร์ชันพวกนั้น: Delta Lake ลบ data file เก่าก็ต่อเมื่อรัน [`VACUUM`](https://docs.delta.io/delta-batch/) (โดย default มันเก็บไฟล์ที่ถูกลบในเจ็ดวันล่าสุดไว้) ส่วน Iceberg ลบตอนที่ [snapshot ถูก expire](https://iceberg.apache.org/docs/latest/maintenance/)

**ต้นทุน**

- สามชั้นอาจหมายถึงสามสำเนา บีบอัด bronze ไว้ และเก็บมันนานเท่าที่อาจต้อง replay ไม่ใช่เก็บตลอดไปเป็นค่าตั้งต้น
- compact ไฟล์เล็ก ๆ ที่ hop แบบ streaming สร้างขึ้น (`OPTIMIZE` ของ Delta Lake, `rewriteDataFiles` ของ Iceberg) และ expire เวอร์ชันเก่าตามรอบเวลา Fabric บอกว่าไฟล์เล็กยอมรับได้ใน bronze ส่วน gold ที่ query ส่วนใหญ่รันอยู่จะได้ประโยชน์จากไฟล์ที่ใหญ่กว่า

**รูปแบบอื่น ๆ**

- ชั้นมากขึ้นหรือน้อยลง: มี landing zone ก่อน bronze มี gold หลายชั้นสำหรับคนละ domain หรือรวม silver กับ gold เป็นชั้นเดียวสำหรับ dataset เล็ก ๆ
- แนวคิดเดียวกันใน warehouse: [dbt](https://docs.getdbt.com/best-practices/how-we-structure/1-guide-overview) จัดโครงสร้าง project เป็น *staging* (ชิ้นส่วนพื้นฐานที่ทำความสะอาดแล้ว สร้างตรงจาก source), *intermediate* (ขั้น transformation ที่สร้างมาเพื่องานเฉพาะ) และ *marts* (business entity ที่ผู้ใช้ query)

**เกี่ยวกับ pattern อื่นยังไง**

- gold aggregate หลายครั้งก็คือ [materialized view](../materialized-view/) ส่วน medallion architecture คือ pipeline แบบแบ่งชั้นที่อยู่รอบตารางแบบนั้น
- read model ของ [CQRS](../cqrs/) ตอบ query ของแอปพลิเคชันเดียว ส่วนตาราง gold รองรับงาน analytics ของหลายทีม
- [Event sourcing](../event-sourcing/) เก็บ event ของแอปพลิเคชันเป็น source of truth และสร้าง state ใหม่ด้วยการ replay ส่วน bronze ก็ทำหน้าที่เดียวกันในฝั่ง analytics
- แต่ละ hop คือ filter ตัวหนึ่งใน pipeline แบบ pipes and filters ที่ pipe เป็นตารางแบบ durable
