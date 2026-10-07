## ปัญหา

Acme Shop ขายสินค้าที่ต่างกันมาก แก้วมีสีและความจุ เสื้อยืดมีไซซ์ e-book มี format และจำนวนหน้า แล้วซีซันหน้าก็จะมีโคมไฟตั้งโต๊ะที่มีค่ากำลังวัตต์ ใน relational schema ความหลากหลายแบบนี้จะกลายเป็นตารางกว้าง ๆ ที่ column ส่วนใหญ่ว่าง หรือตาราง entity–attribute–value ที่ query ยาก หรือไม่ก็ตารางแยกต่อประเภทสินค้า ที่ต้อง migrate ทุกครั้งที่มีประเภทใหม่ ส่วนหน้าร้านอ่านหน้าสินค้าเป็นก้อนเดียว: ชื่อ ราคา attribute และ tag มาด้วยกัน

MongoDB เก็บสินค้าแต่ละตัวเป็น **document** หนึ่งตัว คือ record แบบคล้าย JSON ที่ซ้อนกันได้ และมีแค่ field ที่สินค้าตัวนั้นต้องใช้ โดยอยู่ใน **collection** ที่ไม่บังคับให้ document ทุกตัวมีรูปแบบเดียวกัน อะไรที่แอปอ่านด้วยกันก็เก็บไว้ด้วยกัน หน้าสินค้าหนึ่งหน้าเลยเป็นการอ่านครั้งเดียว ตัว server เก็บ copy ของข้อมูลไว้บนสมาชิกของ **replica set** ที่เลือก primary ตัวใหม่กันเองเมื่อตัวปัจจุบันพัง และ **sharded cluster** ก็กระจาย collection ที่โตเกิน replica set เดียวไปไว้บนหลายชุด

## ทำงานยังไง

### Document, collection และ BSON

document คือชุดของ field ที่เรียงลำดับไว้ โดยค่าของ field เป็น document หรือ array ได้อีก ซ้อนกันได้ลึกถึง 100 ชั้น MongoDB เก็บและส่ง document เป็น **BSON** ที่เป็น binary encoding ที่มี type มากกว่า JSON: integer แบบ 32 และ 64 bit, double, `Decimal128` สำหรับจำนวนทศนิยมแบบแม่นยำ, วันที่, binary data และ `ObjectId` ขนาด 12 byte ทุก document มี `_id` ที่ไม่ซ้ำกัน ถ้าแอปไม่ได้ตั้งให้ ระบบก็จะสร้าง ObjectId ให้ ส่วน document หนึ่งตัวใหญ่ได้ไม่เกิน **16 MiB** (ลิมิตของ MongoDB 9.0)

```js
// mongosh, database catalog
db.products.insertOne({
  sku: "MUG-1",
  title: "Red ceramic mug",
  brand: "Acme Home",
  price: 12,
  attributes: { colour: "red", capacity_ml: 350 },
  tags: ["kitchen", "gift"]
})
```

`insertOne` สร้าง collection ให้ถ้ายังไม่มี ส่วนสินค้าตัวถัดไปจะมี `attributes: { colour: "red", size: "M" }` หรือ `{ format: "ebook", pages: 212 }` ก็ได้ โดยไม่ต้องประกาศอะไรไว้ก่อน

### Modelling: embed หรือ reference

แนวทางของ MongoDB เองคือข้อมูลที่ถูกอ่านด้วยกันควรเก็บไว้ด้วยกัน schema เลยตามรูปแบบ query ของแอป ไม่ได้ตามรูปร่างของ entity

- **Embed** ข้อมูลที่อ่านพร้อม parent เป็นของ parent และมีขนาดจำกัด: attribute และ tag ของสินค้า หรือ review ล่าสุดไม่กี่ตัวที่โชว์บนหน้าสินค้า อ่านครั้งเดียวได้ทุกอย่าง และเขียนครั้งเดียวก็เปลี่ยนทั้งหมดแบบ atomic
- **Reference** ข้อมูลที่ใหญ่หรือโตได้ไม่จำกัด ใช้ร่วมกันหลาย parent หรืออัปเดตตามจังหวะของตัวเอง: review ทุกตัวของสินค้า หน้าของ brand เอง ระดับสต็อกที่คลังสินค้าอัปเดตทั้งวัน ให้เก็บ `_id` ของ document อีกตัวไว้แล้วอ่านแยก หรือ join ด้วย `$lookup`
- **เลี่ยง array ที่โตไม่จำกัด** array ที่โตไปเรื่อย ๆ ดัน document ให้เข้าใกล้ลิมิต 16 MiB และ multikey index บน array นั้นก็มีหนึ่ง entry ต่อ element

คู่มือรวบรวมดีไซน์ที่เจอซ้ำ ๆ ไว้เป็น schema design pattern: computed value, การจัดกลุ่มข้อมูล (attribute, bucket, outlier และ subset pattern), polymorphic และ inheritance pattern, การทำ versioning ของ document และ schema, archiving และ single-collection pattern ตัว catalog คือกรณีตัวอย่างในตำราของ **attribute pattern**: attribute ที่หลากหลายเก็บเป็น array ของ sub-document แบบ key–value แล้วใช้ compound index ตัวเดียวบน field key และ value ได้ แทนที่จะมี index ต่อ attribute ทางเลือกอีกแบบสำหรับ sub-document อย่าง `attributes` คือ **wildcard index** `{ "attributes.$**": 1 }` ที่ index ทุก field ข้างใต้ คู่มือบอกว่า wildcard index ทำงานได้ไม่ดีเท่า index บน field ที่รู้ชื่อ เพราะฉะนั้นเก็บไว้ใช้กับ field ที่ list ล่วงหน้าไม่ได้

### Index

index คือ B-tree บน field หนึ่งตัวหรือมากกว่า ทุก collection มี unique index บน `_id` ถ้าไม่มี index ที่ใช้ได้ ตัว query จะ scan ทั้ง collection (`COLLSCAN` ใน `explain()`)

- **Type:** single field, **compound** (ได้ถึง 32 field), **multikey** ที่สร้างให้อัตโนมัติเมื่อ field ที่ index เก็บ array โดยมีหนึ่ง entry ต่อ element, text index บน deployment ที่ดูแลเอง (MongoDB แนะนำให้ใช้ MongoDB Search แทน), geospatial, **hashed** ที่ใช้กับ hashed sharding, **wildcard** และ clustered
- **Property:** unique, **partial** ที่ index แค่ document ที่ตรงกับ filter และแนะนำให้ใช้แทน sparse, sparse, **TTL** ที่มี background task คอยลบ document ที่หมดอายุ รันทุก 60 วินาที, hidden ที่ planner ไม่สนใจแต่ index ยังถูกดูแลอยู่ เป็นวิธีที่ปลอดภัยในการลองว่าถ้า drop แล้วจะเป็นยังไง และ case-insensitive
- collection หนึ่งมี index ได้ไม่เกิน 64 ตัว และทุก index ทำให้การเขียนแต่ละครั้งมีงานเพิ่ม

เรียง field ของ compound index ตาม **ESR guideline**: field แบบ equality ก่อน แล้ว field ที่ใช้ sort แล้วค่อย field แบบ range (range ที่ selective มาก ๆ ไว้ก่อน sort ได้) ตัว index ใน step 2 เอา field แบบ equality `attributes.colour` ไว้ก่อน field แบบ range `price` ทำให้ key ที่ match อยู่ติดกัน และ query ก็อ่าน index แค่ช่วงสั้น ๆ ช่วงเดียว:

```js
db.products.createIndex({ "attributes.colour": 1, price: 1 })
db.products.find({ "attributes.colour": "red", price: { $lt: 20 } })  // MUG-1 and TEE-7
db.products.find({ "attributes.colour": "red", price: { $lt: 20 } }).explain("executionStats")
```

document ที่ไม่มี `attributes.colour` (ตัว e-book) ก็ยังอยู่ใน index ภายใต้ค่า `null` มีแค่ sparse หรือ partial index ที่ตัดมันออก

### Query และ aggregation pipeline

`find` filter field ที่ซ้อนอยู่ด้วย dot notation และ match array ทีละ element (`{ tags: "gift" }` หาทุก document ที่ tag มี `"gift"`) พร้อม projection, sort และ limit ส่วนอะไรที่มากกว่านั้นต้องผ่าน **aggregation pipeline**: list ของ stage ที่ server รันตามลำดับ โดยแต่ละ stage ส่งผลลัพธ์ต่อให้ stage ถัดไป ส่วน stage ที่ใช้บ่อยคือ `$match`, `$group`, `$sort`, `$project`, `$unwind`, `$lookup` และ `$facet` ส่วน `$merge` และ `$out` เขียนผลลัพธ์ลง collection นี่คือวิธีที่ MongoDB สร้าง materialized view แบบ on-demand

```js
db.products.aggregate([
  { $match: { tags: "gift" } },                                   // MUG-1, TEE-7, VASE-2
  { $group: { _id: "$brand", products: { $sum: 1 }, avgPrice: { $avg: "$price" } } },
  { $sort: { products: -1 } }
])
// { _id: "Acme Home", products: 2, avgPrice: 21 }
// { _id: "Acme Wear", products: 1, avgPrice: 18 }
```

`$lookup` คือ join ของ MongoDB: left outer join ไปที่อีก collection **ใน database เดียวกัน** เขียนเป็น stage หนึ่งใน pipeline ส่วนตั้งแต่ 5.1 collection ที่ถูก join จะเป็นแบบ sharded ก็ได้ และตั้งแต่ 8.0 ตัว `$lookup` บน sharded collection ก็ใช้ภายใน transaction ได้ด้วย ความเร็วของมันขึ้นกับ index บน field ที่ join และคู่มือแนะนำให้ embed ถ้าต้องใช้ข้อมูลที่ join มาทุกครั้ง ส่วน MongoDB 9.0 ก็ยังจำกัด memory ที่ query operation หนึ่งตัวใช้ได้ไว้ที่ 1 GB หรือ 20% ของ memory ของ server แล้วแต่อย่างไหนมากกว่า

### Atomicity และ transaction

การเขียน **document เดียวเป็น atomic** รวมถึงทุก field และ array ที่ embed อยู่ในนั้น update ด้านล่างเปลี่ยนราคาและเพิ่ม tag พร้อมกัน หรือไม่ก็ไม่ทำเลยสักอย่าง และ filter บนราคาปัจจุบันก็ทำให้มันเป็น update แบบ optimistic compare-and-set:

```js
db.products.updateOne({ sku: "MUG-1", price: 12 }, { $set: { price: 11 }, $push: { tags: "sale" } })
```

**Multi-document ACID transaction** ใช้ได้บน replica set (ตั้งแต่ 4.0) และ sharded cluster (ตั้งแต่ 4.2) ค่าตั้งต้นคือ transaction ต้องเสร็จภายในหนึ่งนาที (`transactionLifetimeLimitSeconds`) และใน 9.0 server รับ transaction ที่เปิดพร้อมกันได้ไม่เกิน 10,000 ตัวเป็นค่าตั้งต้น (`maxConcurrentMultiDocumentTransactions`) แล้วปฏิเสธตัวใหม่ด้วย `TooManyOpenTransactions` คู่มือพูดเรื่องต้นทุนไว้ตรง ๆ: distributed transaction ปกติแพงกว่าการเขียน document เดียว และใช้แทน schema ที่เก็บข้อมูลที่เกี่ยวข้องไว้ด้วยกันไม่ได้

### Replica set, oplog และ election

**replica set** คือกลุ่มของ process `mongod` ที่ถือข้อมูลชุดเดียวกัน สมาชิกตัวหนึ่งเป็น **primary** และรับทุกการเขียน ส่วน **secondary** replicate มัน และ **arbiter** ที่จะมีหรือไม่มีก็ได้ก็โหวตใน election โดยไม่ถือข้อมูล set หนึ่งมีสมาชิกได้ถึง 50 ตัว โดยโหวตได้ไม่เกิน 7 ตัว

primary apply การเขียนแต่ละครั้งแล้วบันทึกลง **oplog** ของมัน คือ capped collection `local.oplog.rs` ส่วน secondary copy oplog แล้ว apply entry แบบ **asynchronous** แต่ละ entry เป็น idempotent ทำให้ apply สองครั้งก็ได้ผลเหมือนเดิม และ secondary อาจ sync จาก secondary ตัวอื่นแทน primary ก็ได้ ถ้าใช้ WiredTiger ตัว oplog มีขนาดตั้งต้นที่ 5% ของ disk ที่ว่าง ระหว่าง 990 MB ถึง 50 GB และ `replSetResizeOplog` เปลี่ยนขนาดได้บนสมาชิกที่รันอยู่ ช่วงเวลาระหว่าง entry ที่เก่าที่สุดกับใหม่ที่สุดคือ **oplog window**: secondary หยุด copy ได้นานแค่ไหนแล้วยังตามทัน ส่วนสมาชิกที่ใหม่เอี่ยมจะรัน **initial sync** แทน คือ copy ข้อมูลทั้งหมด

พอสมาชิกอื่นไม่ได้ยินจาก primary ครบ `electionTimeoutMillis` (ค่าตั้งต้น 10 วินาที) secondary ที่มีสิทธิ์ก็จะเรียก **election** คู่มือบอกว่าถ้าใช้ค่าตั้งต้น เวลามัธยฐานกว่าจะเลือก primary ตัวใหม่ได้ปกติไม่ควรเกิน 12 วินาที รวมเวลาตรวจจับแล้ว ส่วน priority ของสมาชิกเป็นตัวกำหนดผล และสมาชิกที่ priority เป็น 0 จะไม่มีวันได้เป็น primary ส่วนระหว่าง election จะไม่มี primary ให้รับการเขียน แต่การอ่านก็ยังทำต่อบน secondary ได้ถ้า read preference ยอม

**Retryable write** ซ่อนช่องว่างส่วนใหญ่นั้นจากแอป driver ที่รองรับ MongoDB 4.2 ขึ้นไปเปิดมันเป็นค่าตั้งต้น (`retryWrites=true`): หลังเจอ network error หรือเมื่อหา primary ที่ปกติไม่เจอ driver จะรอ primary ตัวใหม่ได้นานถึง `serverSelectionTimeoutMS` แล้ว retry การเขียนหนึ่งครั้ง การเขียน document เดียวอย่าง `insertOne`, `updateOne` และ `deleteOne` retry ได้ ส่วนการเขียนที่ใช้ `w: 0` และ update หลาย document (`updateMany`) retry ไม่ได้

### Write concern, read concern และ read preference

**write concern** กำหนดว่าเมื่อไรการเขียนถึงนับว่าเสร็จ:

- `w: 1`: primary apply แล้ว การเขียนแบบนี้ยังอาจถูก **rollback** ได้ ถ้า primary พังก่อนที่ secondary จะได้มันไป
- `w: "majority"`: เสียงข้างมากที่คำนวณจากสมาชิกที่ถือข้อมูลและโหวตได้มีมันอยู่ใน oplog แล้ว โดยเขียนลง journal บน disk เป็นค่าตั้งต้น (`writeConcernMajorityJournalDefault`) สำหรับ primary หนึ่งตัวกับ secondary สองตัว เสียงข้างมากคือ 2 เหมือนใน step 3 การเขียนแบบนี้รอดจาก failover
- `j: true` ขอให้เขียน journal อย่างชัดเจน และ `wtimeout` จำกัดเวลารอ

`w: "majority"` เป็นค่าตั้งต้นโดยปริยาย ยกเว้นกรณีเดียว: ใน set ที่มี arbiter และสมาชิกที่ถือข้อมูลและโหวตได้มีไม่เกินเสียงข้างมากของการโหวต เช่น set แบบ primary-secondary-arbiter ค่าตั้งต้นจะถอยไปเป็น `w: 1`

**read concern** กำหนดว่าการอ่านจะเห็นอะไรได้บ้าง: `"local"` (ค่าตั้งต้น: ข้อมูลใหม่ที่สุดของสมาชิกตัวนั้น ที่อาจถูก rollback ได้), `"available"`, `"majority"` (แค่ข้อมูลที่ commit กับเสียงข้างมากแล้ว), `"linearizable"` (เฉพาะ primary สำหรับ document เดียว) และ `"snapshot"` (ณ จุดเวลาเดียว ใช้ใน transaction) ส่วน **read preference** เลือกสมาชิก: `primary` (ค่าตั้งต้น), `primaryPreferred`, `secondary`, `secondaryPreferred` หรือ `nearest` โดยจำกัดด้วย tag หรือ `maxStalenessSeconds` ได้ การอ่านจาก secondary ช่วยลดโหลดของ primary แบบเดียวกับ [read replica](../read-replicas/) แต่อาจได้ข้อมูลที่เก่าไปนิด **causally consistent session** ที่ใช้ read และ write concern แบบ majority ทำให้ได้ read-your-own-writes และ monotonic read กลับมา แม้การอ่านจะไปที่ secondary

### Sharding

**sharded cluster** มีสามส่วน:

- **Shard** แต่ละตัวเป็น replica set ที่ถือข้อมูลส่วนหนึ่ง
- **router `mongos`** ที่แอปต่อเข้าไปแทนการต่อกับ shard ตรง ๆ
- **Config server** คือ replica set ที่ถือ metadata ของ cluster รวมถึงว่า shard ไหนเป็นเจ้าของช่วงไหนของ shard key ส่วนตั้งแต่ 8.0 *config shard* ถือข้อมูลของแอปได้ด้วย ช่วยประหยัด replica set ไปหนึ่งชุดใน cluster เล็ก ๆ

sharded collection แต่ละตัวมี **shard key**: field หนึ่งตัวหรือมากกว่า แบบ ranged หรือ hashed (field แบบ hashed หนึ่งตัว จะอยู่ใน compound key ก็ได้) key ที่ดีมีค่าที่ไม่ซ้ำกันเยอะ ไม่มีค่าไหนที่ครองส่วนใหญ่ และไม่เพิ่มขึ้นเรื่อย ๆ: key ที่โตตามเวลาอย่าง timestamp จะส่งทุก insert ไปที่ chunk เดียวกัน และเท่ากับไปที่ shard เดียว การ hash กระจาย key แบบนี้ได้เท่า ๆ กัน แต่แลกกับการที่ range query บน key จะไปถึงทุก shard

ข้อมูลถูกแบ่งเป็น **chunk** คือช่วงต่อเนื่องของค่า shard key (รวมขอบล่าง ไม่รวมขอบบน) ขนาดช่วงตั้งต้นคือ 128 MB และ **balancer** จะย้ายช่วงระหว่าง shard เมื่อข้อมูลของ collection บนสอง shard ต่างกันถึงสามเท่าของขนาดนั้น คือ 384 MB เป็นค่าตั้งต้น การ shard collection ที่มีข้อมูลอยู่แล้วจะเริ่มจาก chunk ใหญ่ก้อนเดียว แล้ว balancer ก็ค่อย ๆ ย้ายช่วงออกไป เพราะแต่ละ shard ร่วม migration ได้ทีละครั้งเท่านั้น สำหรับ collection ที่มีอยู่แล้ว ตั้งแต่ 8.0 แนะนำให้ใช้ `sh.shardAndDistributeCollection()` ที่ shard แล้วกระจายข้อมูลใหม่ทันทีโดยไม่ต้องรอ balancer ถ้า cluster มี resource พอ ส่วน collection ว่างที่ใช้ hashed key จะได้หนึ่ง chunk ต่อ shard (ตั้งแต่ 8.0)

```js
// mongosh connected to mongos; since 6.0 sh.enableSharding() is no longer needed first
sh.shardCollection("catalog.products", { sku: "hashed" })
sh.getShardedDataDistribution()   // how much of each collection sits on each shard
```

`mongos` cache แผนที่ของ chunk ไว้จาก config server ส่วน query ที่มี shard key (หรือ prefix ของ compound key) จะถูก **target** ไปที่ shard ที่เป็นเจ้าของค่าเหล่านั้น ถ้าเป็น hashed key ก็คือ match แบบ equality ส่วน query อื่น ๆ จะถูก **broadcast** ไปทุก shard แล้ว mongos ก็รวมผล (scatter-gather) ตัว `insertOne` target ไปที่ shard เดียวเสมอ ส่วนตั้งแต่ 7.1 ตัว `updateOne` และ `deleteOne` ไม่ต้องมี shard key หรือ `_id` ใน filter แล้ว แต่ถ้าไม่มีทั้งสองอย่าง mongos ก็ต้องค้นหา document ในทุก shard

key เปลี่ยนทีหลังได้: `reshardCollection` (ตั้งแต่ 5.0) เขียน collection ใหม่ภายใต้ key ใหม่ ต้องมีพื้นที่ว่างประมาณสองเท่าของ collection บวก index หารด้วยจำนวน shard บล็อกการเขียนลง collection ประมาณสองวินาที และใช้เวลาอย่างน้อยห้านาทีเสมอ ส่วน `refineCollectionShardKey` เพิ่ม field ต่อท้ายแทน และตั้งแต่ 8.0 การ reshard ไปที่ key เดิมจะกระจายข้อมูลไปลง shard ใหม่

### Change stream

`watch()` เปิด **change stream** บน collection, database หรือทั้ง deployment มันอ่าน oplog ให้ แอปเลยตอบสนองต่อ insert, update, replace และ delete ได้โดยไม่ต้อง tail oplog เอง และมันรับ pipeline ไว้ filter หรือปรับรูปของ event ได้ ตัว change stream รายงานแค่การเปลี่ยนแปลงที่ commit กับสมาชิกเสียงข้างมากแล้ว ทำให้ event ไม่มีทางอธิบายการเขียนที่ failover จะ rollback ทีหลัง `_id` ของแต่ละ event คือ **resume token**: เก็บมันไว้หลัง process แล้วส่งให้ `resumeAfter` เพื่อทำต่อจากจุดที่หยุด ตราบใดที่ oplog ยังมีจุดนั้นอยู่ และตั้งแต่ 6.0 event ก็พา pre-image และ post-image ของ document มาด้วยได้ ส่วน change stream ต้องใช้ replica set หรือ sharded cluster (เปิดบน `mongos`) และไม่ครอบคลุม time series collection

```js
const stream = db.products.watch(
  [{ $match: { operationType: { $in: ["insert", "update", "replace"] } } }],
  { fullDocument: "updateLookup" }
)
```

### Schema validation

schema ที่ยืดหยุ่นก็ยังเป็น schema อยู่ดี และมันจะอยู่ในแอป เว้นแต่ database จะเช็กให้ ส่วน collection หนึ่งก็มี validator แบบ `$jsonSchema` ได้:

```js
db.runCommand({
  collMod: "products",
  validator: { $jsonSchema: {
    bsonType: "object",
    required: ["sku", "title", "price"],
    properties: {
      sku: { bsonType: "string" },
      price: { bsonType: ["int", "double", "decimal"], minimum: 0 },
      tags: { bsonType: "array", items: { bsonType: "string" } }
    }
  } },
  validationLevel: "strict",
  validationAction: "error"
})
```

`validationLevel` เป็นได้ทั้ง `strict` (ค่าตั้งต้น: เช็กทุก insert และ update), `moderate` (ไม่เช็ก update ของ document ที่ไม่ผ่านอยู่แล้ว มีประโยชน์ตอน migrate) หรือ `constraint` ที่มาใหม่ใน 9.0 ตัวนี้รับประกันว่าทุก document ใน collection ผ่านกฎ และไม่ยอมให้เปลี่ยนกฎระหว่างที่ตั้งค่านี้อยู่ ส่วน `validationAction` เป็น `error` (ค่าตั้งต้น), `warn` (รับไว้แล้ว log) หรือ `errorAndLog` (ตั้งแต่ 8.1)

### Storage, เวอร์ชัน และ license

storage engine **WiredTiger** ใช้ concurrency control ระดับ document สำหรับการเขียน บีบอัด collection ด้วย snappy และบีบอัด index ด้วย prefix compression เป็นค่าตั้งต้น และเขียน checkpoint ทุก 60 วินาที พร้อม journal ไว้ replay สิ่งที่เกิดหลังจากนั้น

**MongoDB 9.0** ออกวันที่ 28 กันยายน 2026 และได้ support ถึง 31 ตุลาคม 2031 ส่วน 8.0 (ตุลาคม 2024) ได้ support ถึง 31 ตุลาคม 2029 ส่วน release ที่อยู่ระหว่าง major อย่าง 8.2 (กันยายน 2025) และ 8.3 (พฤษภาคม 2026) อยู่ในตาราง lifecycle เดียวกันสำหรับ Atlas และ Enterprise Advanced

**License** MongoDB Community Server ทุก release ตั้งแต่ 16 ตุลาคม 2018 ใช้ **Server Side Public License (SSPL)** ส่วน release ที่เก่ากว่ายังอยู่ภายใต้ GNU AGPL v3.0 ตัว SSPL มีฐานมาจาก GPL v3 โดยเขียน section 13 ใหม่: การให้บริการ MongoDB แก่บุคคลที่สามในรูปแบบ service บังคับให้ต้องเปิด source ของ service stack ทั้งหมดภายใต้ SSPL แต่แอปที่แค่ใช้ MongoDB เป็น database ไม่ได้รับผลกระทบ ทาง OSI ไม่ได้รับรอง SSPL ทำให้มันไม่ใช่ license แบบ open source ตามความหมายของ OSI ส่วน driver ทางการอยู่ภายใต้ Apache License 2.0 แล้ว Enterprise Advanced ขายภายใต้ license เชิงพาณิชย์ และคนที่ใช้ Atlas ก็ไม่ได้รันซอฟต์แวร์ server เอง

## อยู่ตรงไหนใน solution

- **Solution** product catalog และ content management ที่ record รูปร่างต่างกันถูกอ่านเป็นก้อนเดียว, user profile และ preference, operational database หลัง back end ของ web และ mobile และฟีเจอร์ AI ที่เก็บ vector embedding ไว้ข้าง ๆ document ที่มันอธิบาย
- **Pattern ที่มัน implement หรือช่วยรองรับ** [Database per Service](../database-per-service/): service Catalog เป็นเจ้าของ database `catalog` และไม่มีใครอื่นอ่านมันตรง ๆ ส่วน [Change Data Capture](../change-data-capture/) ทำผ่าน change stream หรือส่งเข้า Kafka ด้วย source connector ของ MongoDB Kafka Connector แล้ว [Materialized View](../materialized-view/) ก็ทำด้วย `$merge` หรือ consumer ของ change stream ที่ดูแล read model ไว้ ส่วน [Sharding](../sharding/) และ [Read Replicas](../read-replicas/) มีมาในตัว และ election ของ replica set ก็เป็น [Leader Election](../leader-election/) แบบหนึ่ง
- **เพื่อนบ้านที่มักเจอ** service ที่ใช้ driver ทางการ, search index ที่ป้อนด้วย change stream หรือ MongoDB Search ภายใน cluster, [Kafka](../kafka/) ผ่าน connector, cache อย่าง [Redis](../redis/) ที่อยู่หน้าการอ่านที่ร้อน ([Cache-Aside](../cache-aside/)) และ warehouse ที่โหลดจาก change stream ไว้ทำรายงาน
- **Managed offering**
  - **MongoDB Atlas** รัน MongoDB บน AWS, Azure และ Google Cloud มีสอง edition: Atlas Core ที่ compute และ storage อยู่บน node เดียวกัน และ Atlas Infinite (public preview) ที่แยกสองอย่างนี้ออกจากกัน Atlas เพิ่ม **MongoDB Search** (full-text search ที่สร้างบน Apache Lucene และ query ด้วย `$search`) และ **MongoDB Vector Search** (`$vectorSearch`, การค้นหา nearest neighbour แบบ approximate หรือ exact, hybrid search และ Automated Embedding ด้วย model ของ Voyage AI) ทั้งคู่รันใน process `mongot` แยกต่างหาก ที่ sync อยู่ตลอดผ่าน change stream ส่วนตั้งแต่มิถุนายน 2026 ตัว `mongot` ก็เป็น generally available สำหรับ deployment แบบ Community และ Enterprise Advanced ที่ดูแลเองด้วย หลัง public preview ที่เริ่มเดือนตุลาคม 2025
  - **Amazon DocumentDB (with MongoDB compatibility)** คือ document database แบบ managed ของ AWS มัน implement API ของ MongoDB 3.6, 4.0, 5.0 และ 8.0 บน engine อีกตัวที่สร้างมาโดยเฉพาะ: storage ถูก replicate หกชุดข้ามสาม Availability Zone และ replica ได้ถึง 15 ตัวใช้ storage นั้นร่วมกัน โดย replica lag ปกติต่ำกว่า 100 ms ส่วน developer guide ก็ list ความต่างด้านการทำงานไว้: ไม่มี database `admin` หรือ `local`, retryable write ใช้ได้ตั้งแต่ engine version 8.0.2 เท่านั้น (เวอร์ชันก่อนหน้าให้ปิดไว้), vector search ใช้ได้แค่ผ่าน `$search` แทน `$vectorSearch` และผลของ `explain()` ต่างจากของ MongoDB ส่วน sharding ใช้ elastic cluster ที่ shard ตาม hash ของ field เดียว และใช้ไม่ได้บน DocumentDB 8.0 ให้ test แอปกับมันจริง อย่าเหมาว่าเข้ากันได้ทั้งหมด

## ใช้ตอนไหนดี

เลือก MongoDB เมื่อแต่ละ record เป็น document ที่ซ้อนกันโดยธรรมชาติ และแอปอ่านเขียนมันทั้งก้อน เมื่อ field ต่างกันไปในแต่ละ record หรือเปลี่ยนบ่อย และเมื่ออยากได้ผลิตภัณฑ์ตัวเดียวที่ให้ replication พร้อม automatic failover ตอนนี้ และ sharding ทีหลังเมื่อ replica set เดียวไม่พอแล้ว ให้มองหาตัวอื่นเมื่อข้อมูลเป็น relational มาก ๆ และถูก query แบบ ad hoc ข้ามหลายตาราง เมื่อการเปลี่ยนแปลงส่วนใหญ่กินหลาย record ที่ต้อง commit พร้อมกัน หรือเมื่อทุกการเข้าถึงเป็นการ lookup ด้วย key ในระดับที่ใหญ่มาก

| | MongoDB | [PostgreSQL](../postgresql/) กับ JSONB | [Amazon DynamoDB](../amazon-dynamodb/) | Apache Cassandra |
|---|---|---|---|---|
| Data model | BSON document ที่มี field ซ้อนและ array ใหญ่ได้ถึง 16 MiB ต่อตัว | row ในตาราง โดย column แบบ `jsonb` เก็บส่วนที่ยืดหยุ่น | item ขนาดไม่เกิน 400 KB อ่านด้วย partition key (และ sort key) | row ในตารางที่แบ่ง partition ด้วย partition key (wide-column) |
| Query ส่วนที่ยืดหยุ่น | compound, multikey และ wildcard index บน path ที่ซ้อน และ aggregation pipeline | GIN index บน `jsonb` (`jsonb_ops`, `jsonb_path_ops`) คู่กับ SQL, join และ constraint | เข้าถึงด้วย key และมี secondary index บน attribute | CQL ตาม partition key และมี secondary index |
| Transaction | atomic ระดับ document เดียว และมี multi-document ACID transaction | ACID transaction บน row ไหนก็ได้ | `TransactWriteItems`: ได้ถึง 100 action สำเร็จหมดหรือไม่ก็ไม่ทำเลย | conditional write (`IF NOT EXISTS`) ที่รันผ่าน Paxos โดยมีต้นทุนเพิ่ม |
| Scale การเขียน | sharding ตาม shard key ข้ามหลาย replica set | primary ตัวเดียว ต้อง shard ด้วย Citus หรือในแอป | อัตโนมัติ ตาม partition key | ทุก node รับการเขียน ใช้ consistent hashing บน token ring |
| Consistency | ปรับได้ด้วย read และ write concern อ่านจาก primary เป็นค่าตั้งต้น | strong บน primary และ replica เป็น asynchronous เป็นค่าตั้งต้น | อ่านแบบ eventually consistent เป็นค่าตั้งต้น และขอแบบ strongly consistent ได้ | ปรับได้ต่อ operation ด้วย consistency level (`ONE`, `QUORUM`, `ALL` …) |
| รันที่ไหน | ที่ไหนก็ได้ Community ใช้ SSPL มี MongoDB Atlas และ Amazon DocumentDB implement API ของมัน | ที่ไหนก็ได้ ใช้ PostgreSQL License มี RDS และ Aurora บน AWS | บน AWS เท่านั้น | ที่ไหนก็ได้ ใช้ Apache License 2.0 และ Amazon Keyspaces เป็น service ของ AWS ที่เข้ากันได้ |

ตัวเลขและคำศัพท์จากเอกสารของ MongoDB 9.0, PostgreSQL 18, Amazon DynamoDB และ Apache Cassandra 5.0 เดือนตุลาคม 2026

## ได้อะไร เสียอะไร

- **schema ย้ายไปอยู่ในแอป** ไม่มีอะไรห้าม `colour` กับ `color` ไม่ให้อยู่ด้วยกัน จนกว่า validator หรือโค้ดจะห้าม ให้ใช้ validation แบบ `$jsonSchema` และทำ versioning ให้รูปร่างของ document
- **การทำข้อมูลซ้ำเป็นการตัดสินใจเชิงดีไซน์** การ embed ชื่อ brand ลงในสินค้าทุกตัวทำให้อ่านถูก แต่การเปลี่ยนชื่อ brand จะกลายเป็น update หลาย document ให้ตัดสินเป็นราย field ว่า copy ไหนคือ source of truth
- **join ทำได้แต่เป็นพลเมืองชั้นสอง** `$lookup` ใช้ได้ภายใน database เดียวและขึ้นกับ index ส่วนการทำรายงานแบบ relational แบบ ad hoc ทำใน SQL ง่ายกว่า ให้ป้อน warehouse จาก change stream แทนการทำรายงานบน operational cluster
- **ขนาดและการโตของ document** 16 MiB ต่อ document และ array ที่โตไม่จำกัดทำให้ document กับ multikey index โตไม่มีที่สิ้นสุด
- **replication แบบ asynchronous** การอ่านจาก secondary อาจได้ข้อมูลเก่า และการเขียนที่ acknowledge ด้วย `w: 1` อาจถูก rollback หลัง failover ส่วน `w: "majority"` ที่เป็นค่าตั้งต้นต้องเสีย round trip ไปหา secondary ทุกครั้งที่เขียน
- **shard key ตัดสินอะไรหลายอย่าง** key ที่ไม่ดีทำให้เกิด shard ที่ร้อน หรือ jumbo chunk ที่ split ไม่ได้ ส่วน query ที่ไม่มี key จะไปถึงทุก shard และการ reshard ก็เป็นงานหนัก
- **License** SSPL จำกัดการเอา MongoDB เองไปให้บริการเป็น service ส่วน Amazon DocumentDB implement API แต่เป็นคนละ engine ที่มีความต่างตามที่เอกสารระบุ การสลับไปมาระหว่างสองตัวเลยต้อง test

## ข้อควรรู้ตอนลงมือทำ

- **รันสมาชิกที่ถือข้อมูลสามตัว** ใน failure domain ที่ต่างกันอย่าง Availability Zone แทนการใช้สองตัวบวก arbiter: ใน set แบบ primary-secondary-arbiter ค่าตั้งต้นของ write concern จะตกลงไปเป็น `w: 1` และถ้า set แบบนี้เป็น shard มันอาจเสีย availability ตอนที่สมาชิกที่ถือข้อมูลตัวหนึ่ง down เพราะ shard รันบาง operation ด้วย `w: "majority"`
- **ต่อกับ replica set ทั้งชุด** (`mongodb://m1,m2,m3/?replicaSet=rs0` หรือ address แบบ `mongodb+srv://`) เพื่อให้ driver หา primary ตัวใหม่เจอ และใช้ค่าตั้งต้น `retryWrites=true` กับ `w: "majority"` ไว้
- **ออกแบบจาก query** list access pattern ออกมา embed สิ่งที่อ่านด้วยกัน reference สิ่งที่โตไม่จำกัด และเก็บเงินเป็น `Decimal128`
- **สร้าง index อย่างตั้งใจ** ทำตาม ESR guideline ใช้ `explain("executionStats")` ยืนยันว่า query ใช้ index, เลือกใช้ partial index แทน sparse และ hide index ก่อน drop เพื่อดูว่าอะไรพัง
- **Validate** เพิ่ม validator แบบ `$jsonSchema` แต่เนิ่น ๆ ใช้ `moderate` ระหว่าง migrate document เก่า และพิจารณา `constraint` บน 9.0 เมื่อข้อมูลสะอาดแล้ว
- **กำหนดขนาด oplog ให้พอกับ maintenance window** oplog window คือเวลาที่ secondary หายไปได้แล้วยังตามทัน ส่วน `storage.oplogMinRetentionHours` เก็บ entry ไว้อย่างน้อยตามเวลาที่ตั้ง
- **เลือก shard key จาก query pattern** ก่อนจะ shard: cardinality สูง ความถี่สม่ำเสมอ ไม่เพิ่มขึ้นเรื่อย ๆ บน 8.0 ขึ้นไปให้ shard collection ที่มีข้อมูลแล้วด้วย `sh.shardAndDistributeCollection()` ถ้า cluster มี resource พอ และคอยดูการกระจายด้วย `sh.getShardedDataDistribution()`
- **consume change stream แบบ idempotent** เก็บ resume token หลัง process แต่ละ event และทำ consumer ให้ [idempotent](../idempotent-consumer/) เพราะการ restart อาจส่ง event ซ้ำ
- **ทำ transaction ให้สั้น** แตะ document ให้น้อย ให้เสร็จก่อนค่าตั้งต้นหนึ่งนาทีแบบเหลือเผื่อ และ retry เมื่อเจอ transient error
