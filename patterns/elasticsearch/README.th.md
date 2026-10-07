## ปัญหา

catalogue ของ Acme Shop อยู่ใน PostgreSQL ที่สร้างมาเพื่อ transaction: มันรักษาให้สินค้า สต็อก และ order สอดคล้องกัน แต่มันไม่ใช่ search engine ช่องค้นหาของร้านต้องหา *red mug* ในชื่อและคำอธิบายสินค้าได้ ต้อง match *mugs* ได้เหมือน *mug* ต้องเอาผลที่ตรงที่สุดขึ้นก่อน และต้องโชว์ว่าแต่ละ brand มีกี่ hit และต้องทำแบบนี้กับทุก query ของผู้เข้าชมทุกคน ส่วน `WHERE title ILIKE '%red%mug%'` ใช้ B-tree index ธรรมดาไม่ได้ ไม่รู้เรื่องรูปคำหรือ relevance เลย และ facet count ทุกตัวก็คือ aggregate query เพิ่มอีกหนึ่งตัวที่ยิงใส่ system of record ส่วน full-text search ของ PostgreSQL เอง (`tsvector`, `tsquery` และ GIN index) จัดการเรื่อง match ได้ และมักพอสำหรับ catalogue เล็ก ๆ แต่ ranking function ของมันไม่ใช้สถิติของข้อมูลทั้งชุดเลย และ search traffic ก็ยังไปลงที่ database หรือ replica ของมันอยู่ดี

Elasticsearch และ OpenSearch เก็บข้อมูลอีก copy หนึ่งที่จัดไว้สำหรับการค้นหา: inverted index ต่อ field, การให้คะแนน relevance ด้วย BM25, aggregation สำหรับ facet และ analytics และ cluster ที่กระจายแต่ละ index ไปหลายเครื่อง copy นี้ถูกป้อนมาจาก system of record ในที่นี้ด้วย change data capture แล้วร้านก็ส่งการค้นหาไปที่มัน

## ทำงานยังไง

สองผลิตภัณฑ์นี้ใช้ดีไซน์เดียวกัน: OpenSearch เริ่มในปี 2021 เป็น fork ของ Elasticsearch 7.10.2 และทั้งคู่สร้างบน Apache Lucene (ดู *Elasticsearch หรือ OpenSearch?* ด้านล่าง) เวอร์ชันในหน้านี้คือ Elasticsearch 9.5 (สิงหาคม 2026) และ OpenSearch 3.9 (กันยายน 2026) ทั้งคู่เป็นรุ่นปัจจุบัน ณ ตุลาคม 2026 ตรงไหนที่สองตัวต่างกัน เนื้อหาจะบอกไว้

### Document, mapping และ analysis

**index** เก็บ JSON document ที่แต่ละตัวมี `_id` ส่วน **mapping** ของมันกำหนด type ให้ทุก field และ type เป็นตัวตัดสินว่า field นั้นจะถูก index ยังไง:

- field แบบ `text` จะถูก **analyse** เป็น term สำหรับ full-text search
- field แบบ `keyword` ถูกเก็บทั้งก้อน สำหรับ filter แบบตรงตัว การ sort และ aggregation
- ตัวเลข วันที่ boolean, geo point และ vector มีโครงสร้างเป็นของตัวเอง

ถ้าไม่ได้ตั้ง mapping ไว้ชัด ๆ Elasticsearch จะ map string field ใหม่ (เว้นแต่มันดูเหมือนวันที่ ส่วน numeric detection ปิดเป็นค่าตั้งต้น) เป็น `text` ที่มี sub-field `.keyword` ทำให้มันถูก index ทั้งสำหรับ full-text search และเป็น keyword แบบตรงตัว ถ้าตั้ง `"dynamic": "strict"` ตัว index จะปฏิเสธ document ที่มี field ที่ไม่รู้จักแทน

**analyzer** แปลงข้อความเป็น term: character filter ก่อน แล้วก็ tokenizer แล้วก็ token filter ตัว analyzer `english` ที่ติดมาในตัวและใช้ใน scenario นี้คือ standard tokenizer ตามด้วย possessive stemmer, การแปลงเป็นตัวพิมพ์เล็ก, English stop word, keyword marker และ Porter stemmer มันเปลี่ยน *Red ceramic mug* เป็น `red`, `ceram` และ `mug`: stem ไม่ต้องเป็นคำจริงก็ได้ อย่างที่ตัวอย่างในเอกสารเองแสดงว่า *quickly* กลายเป็น `quickli` แล้ว analyzer ตัวเดียวกันก็รันกับข้อความใน query ด้วย ทำให้ *red mugs* กลายเป็น `red` กับ `mug` และยัง match อยู่ ส่วน `_analyze` API แสดงว่า analyzer ทำอะไรกับ string หนึ่ง (ดู *ข้อควรรู้ตอนลงมือทำ*)

### Inverted index และ relevance

สำหรับแต่ละ field ตัว index เก็บ dictionary ของ term ที่เรียงไว้แล้ว และสำหรับทุก term ก็มี **postings list**: document ที่มี term นั้น พร้อมจำนวนครั้งและตำแหน่ง การหา document ของ `mug` เลยเป็นการ lookup ใน dictionary ไม่ใช่การ scan และ query `red mug` ก็รวม list ของ `red` กับ `mug` เข้าด้วยกัน

ผลที่ match ถูกจัดอันดับด้วย relevance **score** โดย similarity ตั้งต้นคือ **BM25** ที่ `k1` = 1.2 และ `b` = 0.75 ตัว term ที่หายากในข้อมูลทั้งชุดมีน้ำหนักมากกว่า term ที่เจอบ่อย (inverse document frequency) การที่ term ซ้ำในหนึ่ง document ช่วยได้น้อยลงเรื่อย ๆ และ `k1` กำหนดว่าผลนี้จะอิ่มตัวเร็วแค่ไหน ส่วนการ match ใน field ที่สั้นมีน้ำหนักมากกว่าการ match แบบเดียวกันใน field ที่ยาว และ `b` กำหนดว่าความยาวมีผลแรงแค่ไหน ค่าตั้งต้นคือแต่ละ shard ให้คะแนนด้วยสถิติ term ของตัวเอง (`search_type=query_then_fetch`) แบบนี้เร็ว แต่อาจจัดอันดับต่างจาก index ใหญ่ก้อนเดียวไปนิดหน่อย ส่วน `dfs_query_then_fetch` รวบรวมสถิติทั้งหมดก่อน โดยแลกกับ round trip เพิ่มอีกหนึ่งรอบ คะแนนใน animation เป็นตัวเลขที่สมมติขึ้นมาสำหรับตัวอย่าง

### Query, filter และ aggregation

clause หนึ่งใน Query DSL รันใน context ใด context หนึ่งจากสองแบบ ใน **query context** มันตัดสินว่า document match ไหมและ match ดีแค่ไหน แล้วบวกเข้า `_score` ส่วนใน **filter context** มันเป็นการเช็กแบบใช่หรือไม่ใช่โดยไม่มี score: ถูกกว่า และ Elasticsearch ก็ cache filter ที่เจอบ่อยไว้ด้วย ส่วน query แบบ `bool` ผสมสองแบบนี้: clause `must` และ `should` ของมันให้คะแนน ส่วน `filter` และ `must_not` ไม่ให้

**Aggregation** รันกับทุก document ที่ query match ไม่ใช่แค่หน้าของ hit ที่แสดง ตัว bucket aggregation อย่าง `terms`, `histogram`, `date_histogram` และ `range` จัดกลุ่ม document ส่วน metric aggregation อย่าง `avg`, `sum`, `percentiles` และ `cardinality` คำนวณค่าในแต่ละกลุ่ม พวกมันอ่าน doc value แบบ columnar ที่ field แบบ `keyword` และตัวเลขมี ส่วน field แบบ `text` เอามา aggregate ไม่ได้ เว้นแต่จะเปิด `fielddata` ที่ถูกเก็บไว้ใน heap memory ผลบางอย่างที่ข้าม shard เป็นค่าประมาณ: แต่ละ shard ส่ง term อันดับต้น ๆ ตามจำนวน `shard_size` (ค่าตั้งต้นคือ `size * 1.5 + 10`) แล้ว coordinating node ก็รวมมัน ทำให้ term ที่หลุดเส้นตัดไปนิดเดียวในบาง shard อาจถูกนับขาดไป และ `cardinality` ก็นับค่าที่ไม่ซ้ำแบบประมาณด้วย HyperLogLog++

การค้นหาจาก animation:

```json
GET products/_search
{
  "query": {
    "bool": {
      "must":   { "multi_match": { "query": "red mug", "fields": ["title", "description"] } },
      "filter": { "term": { "category": "kitchen" } }
    }
  },
  "aggs": { "brands": { "terms": { "field": "brand" } } },
  "size": 3
}
```

มันคืน 3 อันดับแรกจาก 5 hit (14, 24 และ 63) และ bucket Hearth 3, Clayworks 1 และ Oakline 1 ส่วน document 60 ที่เป็นโคมไฟสีแดงใน shard 1 ก็มี `red` เหมือนกัน แต่ filter `category` ตัดมันออกไป

### Near real time: buffer, translog, refresh และ segment

แต่ละ shard คือ Lucene index ที่ประกอบด้วย **segment** ที่เปลี่ยนไม่ได้ แต่ละ segment ก็เป็น inverted index เล็ก ๆ ของตัวเอง การเขียนจะเข้าไปที่ **indexing buffer** ใน memory และถูกต่อท้ายลง **translog** ของ shard ถ้าใช้ค่าตั้งต้น `index.translog.durability: request` ตัว translog จะถูก fsync และ commit บน primary และบนทุก replica ที่ assign แล้ว ก่อนที่ client จะได้ acknowledgement ทำให้การเขียนที่ acknowledge แล้วรอดจาก crash ถ้าใช้ `async` มันจะถูก fsync ทุก `index.translog.sync_interval` (ค่าตั้งต้น 5 s) แทน แล้ว crash ก็อาจทำให้การเขียนตั้งแต่ fsync ครั้งล่าสุดหายไป

document ที่อยู่ใน buffer ยังค้นหาไม่เจอ **refresh** จะเขียน buffer ออกมาเป็น segment ใหม่ ลงใน filesystem cache ไม่ใช่ลง disk ตรง ๆ แล้วเปิดให้ค้นหาได้ Elasticsearch refresh ทุกหนึ่งวินาทีเป็นค่าตั้งต้น (`index.refresh_interval: 1s` ส่วนบน Elastic Cloud Serverless เป็น 5 s และเป็นค่าต่ำสุดด้วย) แต่ถ้าไม่ได้ตั้ง interval ไว้ชัด ๆ มันจะข้าม shard ที่ไม่มีใครค้นหามา 30 วินาที (`index.search.idle.after`) จนกว่าจะมีการค้นหาครั้งถัดไป ส่วน OpenSearch ก็มีค่าตั้งต้นและกฎเรื่อง idle แบบเดียวกัน นี่คือเหตุผลที่การค้นหาเป็นแบบ *near* real time: การเปลี่ยนแปลงจะมองเห็นได้ภายใน refresh interval ไม่ใช่ทันที ถ้า client ต้องอ่านสิ่งที่ตัวเองเพิ่งเขียน ก็ index ด้วย `refresh=wait_for` ได้ ตัวนี้จะคืนผลก็ต่อเมื่อ refresh ทำให้การเปลี่ยนแปลงมองเห็นได้แล้ว

**flush** ทำให้ segment durable ด้วย Lucene commit หลังจากนั้น translog ก็ไม่ต้องเก็บ operation ที่ commit ครอบคลุมแล้ว ตัว Elasticsearch flush เอง และหลัง crash มันจะ replay translog ต่อจาก commit ล่าสุด segment ไม่เคยถูกแก้ในที่: การ update จะ index document เวอร์ชันใหม่แล้ว mark ตัวเก่าว่าถูกลบ ส่วน **merge** ที่ทำอยู่เบื้องหลังก็รวม segment เล็ก ๆ เป็นตัวที่ใหญ่ขึ้น และทิ้ง document ที่ถูกลบไประหว่างทาง

### Shard, replica และ routing

cluster คือชุดของ **node** และแต่ละ node มี **role**: `master`, data role, `ingest`, `ml`, `transform` และอื่น ๆ node ที่ไม่ได้ตั้ง `node.roles` จะได้ชุดตั้งต้นครบ ที่รวม `master`, data role และ `ingest` ส่วนไม่ว่าจะมี role อะไร node ไหนก็รับ request จาก client แล้ว **coordinate** มันได้

index หนึ่งถูกแบ่งเป็น **primary shard** (`index.number_of_shards` ค่าตั้งต้น 1 และตายตัวตั้งแต่ตอนสร้าง index) และทุก primary มี copy ตาม `index.number_of_replicas` (ค่าตั้งต้น 1 และเปลี่ยนได้ตลอด) replica จะไม่ถูกวางบน node เดียวกับ primary ของมัน ใน animation แต่ละ node จากสามตัวเลยถือ primary หนึ่งตัวและ replica ของอีก shard หนึ่ง ตัว replica กันความเสียหายตอน node พัง และเพิ่ม capacity ในการค้นหา เพราะการค้นหาใช้ copy ไหนก็ได้

shard ของ document มาจากค่า **routing** ของมัน ค่านี้ก็คือ `_id` เว้นแต่ request จะตั้ง `routing` ส่วนสำหรับ index ที่สร้างด้วย Elasticsearch 9.4 ขึ้นไป shard คือ `hash(_routing) % number_of_primary_shards` โดยใช้ hash แบบ Murmur3 ส่วน index ที่เก่ากว่าและ OpenSearch ใช้อีกแบบที่มี `index.number_of_routing_shards` เข้ามาเกี่ยวด้วย โดย setting นี้คือตัวที่ทำให้ split index ได้ในภายหลัง สำหรับ `_id` 14 ทั้งสองแบบได้ shard 1 เหมือนใน animation และไม่ว่าจะแบบไหน การ map document ไปที่ shard ขึ้นกับจำนวน shard นี่คือเหตุผลที่จำนวน shard เปลี่ยนตรง ๆ ไม่ได้: `_split` และ `_shrink` API กับ `_reindex` สร้าง index ใหม่ที่มีจำนวน shard ต่างไป

**การเขียน** ไปจาก node ที่รับ request ไปที่ primary แล้ว primary ก็ validate และ index operation นั้น แล้วส่งต่อแบบขนานไปให้ทุก replica ในชุด **in-sync** พอทุกตัวตอบกลับมาแล้ว primary ก็ acknowledge ส่วน **การค้นหา** รันเป็นสอง phase ใน *query phase* ตัว coordinating node ส่งมันไปที่ active copy หนึ่งตัวของทุก shard โดยเลือกด้วย adaptive replica selection แล้วแต่ละ shard ก็คืน ID และ score ของ hit อันดับต้น ๆ จำนวน `from + size` พร้อมผล aggregation ของตัวเอง แล้ว coordinating node ก็รวมผลพวกนี้ ส่วนใน *fetch phase* มันขอ document ที่ชนะจาก shard ที่ถือมันอยู่

### Master, cluster state และ failover

node ที่เป็น **master-eligible** เลือก **master** หนึ่งตัวด้วย quorum ตัว master ดูแล **cluster state** (มี index อะไรบ้าง mapping และ setting ของมัน และ node ไหนถือ shard copy ไหน) และ publish ทุกการเปลี่ยนแปลงไปที่ทุก node ถ้ามี master-eligible node สามตัว พังได้หนึ่งตัวแล้วอีกสองตัวก็ยังเป็นเสียงข้างมาก แล้ว cluster เล็ก ๆ ก็ให้ node เหล่านี้ถือข้อมูลด้วยได้ อย่างใน animation ส่วน cluster ใหญ่ใช้ **dedicated master-eligible node** (`node.roles: [ master ]`) เพื่อไม่ให้การ index หรือการค้นหาหนัก ๆ ทำให้ master ช้า ส่วน OpenSearch เรียก role นี้ว่า **cluster manager**

master จะเอา node ออกจาก cluster ทันทีที่ connection ของมันหลุด หรือหลัง follower check พลาดติดกัน 3 ครั้งถ้ามันหยุดตอบ (ค่าตั้งต้นคือเช็กวินาทีละครั้ง แต่ละครั้ง timeout 10 วินาที) จากนั้นมันก็เลื่อน replica ขึ้นเป็น primary แทนทุก primary ที่ node ที่หายไปถืออยู่ ส่วน indexing request ของ shard เหล่านั้นจะรอ primary ตัวใหม่ (ค่าตั้งต้นรอได้ถึง 1 นาที) แล้วค่อยทำต่อ ส่วน replica ที่ขาดไปจะถูกสร้างใหม่บน node ที่เหลือเมื่อพ้น `index.unassigned.node_left.delayed_timeout` (ค่าตั้งต้น 1 นาที) การหน่วงนี้ช่วยไม่ต้อง copy ทั้ง shard ถ้า node กลับมาเร็ว ๆ ส่วน `GET _cluster/health` รายงาน **green** เมื่อ shard copy ทุกตัว assign แล้ว **yellow** เมื่อ primary ครบหมดแต่ replica บางตัวยังไม่ได้ assign และ **red** เมื่อ primary หายไป ทำให้ข้อมูลบางส่วนค้นหาหรือเขียนไม่ได้

### Vector search

ทั้งสอง engine index vector สำหรับ k-nearest-neighbour (kNN) search ได้ด้วย แบบที่ใช้ทำ semantic search บน embedding ตัว Elasticsearch เก็บ vector ไว้ใน field แบบ `dense_vector` ได้ถึง 4,096 มิติ approximate kNN search ใช้ graph แบบ **HNSW** ที่เอกสารบอกว่ายอมเสียความแม่นยำไปบ้างเพื่อแลกกับความเร็ว ส่วน kNN แบบ exact ที่ไล่ดูทุกตัวเหมาะกับชุดข้อมูลเล็ก ๆ และ subset ที่ filter มาก่อนแล้ว ส่วน float vector ถูก quantize เป็นค่าตั้งต้น และ index type ตั้งต้นก็เปลี่ยนไปตาม release: `int8_hnsw` ใน 9.0, ตั้งแต่ 9.1 เป็น `bbq_hnsw` สำหรับ vector ที่มี 384 มิติขึ้นไป, ตั้งแต่ 9.4 เป็น `bbq_disk` ถ้า license ครอบคลุม เพราะฉะนั้นให้เช็กหน้า `dense_vector` ของเวอร์ชันที่ใช้ ส่วน OpenSearch ใช้ field แบบ `knn_vector` ที่ index ด้วย HNSW หรือ IVF ผ่าน engine Faiss (ค่าตั้งต้น) หรือด้วย HNSW ผ่าน Lucene และ engine NMSLIB รุ่นเก่าของมันถูก deprecate แล้ว

### ข้อมูลตามเวลา และ snapshot

log และ metric ถูกเขียนครั้งเดียวแล้ว query ตามเวลา ปกติเลยเก็บไว้ใน **data stream**: ชื่อเดียวที่อยู่หน้า backing index หลายตัวเรียงกัน โดยมีแค่ตัวใหม่ที่สุดที่รับการเขียน **Index lifecycle management (ILM)** roll stream ไปที่ backing index ตัวใหม่เมื่อตัวปัจจุบันถึงอายุ ขนาด หรือจำนวน document ที่กำหนด ย้าย index ที่เก่ากว่าไปไว้บน hardware ที่ถูกกว่า (tier hot, warm, cold และ frozen) และลบทิ้งเมื่อหมดช่วง retention ส่วน OpenSearch ทำแบบเดียวกันด้วย policy ของ **Index State Management (ISM)**

**snapshot** คือ backup: copy ของ index และ cluster state ใน repository นอก cluster ปกติเป็น object storage อย่าง [Amazon S3](../amazon-s3/), Google Cloud Storage หรือ Azure Blob Storage โดยถ่ายตามตารางด้วย snapshot lifecycle policy ส่วน segment ไม่เคยเปลี่ยน ทำให้ snapshot copy แค่ segment ที่ repository ยังไม่มี ตัว replica ไม่ใช่ backup เพราะการลบผิดหรือการ update ที่ผิดจะไปถึงทุก copy ในไม่กี่อึดใจ ใน Elasticsearch ตัว searchable snapshot ยังเสิร์ฟ tier cold และ frozen ตรงจาก repository ได้ด้วย

## อยู่ตรงไหนใน solution

- **Solution:** การค้นหาสินค้าและการค้นหาในเว็บที่มี facet และ query ที่ทนคำพิมพ์ผิด (fuzzy), analytics ของ log, metric และ trace ด้วย Kibana หรือ OpenSearch Dashboards, การค้นหาข้อมูลที่ service อื่นเป็นเจ้าของ โดยป้อนด้วย change data capture และ semantic search บน embedding
- **Pattern ใน catalog นี้ที่มัน implement หรือช่วยรองรับ:** read model ใน [CQRS](../cqrs/) และ [materialized view](../materialized-view/) ของข้อมูลที่ที่อื่นเป็นเจ้าของ, ปลายทางฝั่งรับของ [change data capture](../change-data-capture/), store และ query engine ของ [centralized logging](../centralized-logging/) ส่วนภายในตัวมัน index ถูก [shard](../sharding/) ตาม hash ของค่า routing ส่วน replica ทำงานเหมือน [read replica](../read-replicas/) ที่ขึ้นมาเป็น primary แทนได้ด้วย และ master ถูกเลือกด้วย quorum คล้าย ๆ [leader election](../leader-election/)
- **เพื่อนบ้านที่มักเจอ:** system of record อย่าง [PostgreSQL](../postgresql/), change stream จาก Debezium ผ่าน [Kafka](../kafka/) หรือ transactional outbox, indexer ที่เขียนด้วย `_bulk` API, ตัวส่ง log อย่าง Elastic Agent, Beats, Logstash, Fluent Bit หรือ OpenSearch Data Prepper, Kibana หรือ OpenSearch Dashboards และแอปหรือ search API ที่อยู่ด้านหน้า เพราะ browser ไม่ควร query cluster ตรง ๆ
- **Managed offering:** **Amazon OpenSearch Service** รัน domain แบบ managed ด้วย OpenSearch (เวอร์ชันถึง 3.5 ณ ตุลาคม 2026) หรือ Elasticsearch รุ่น legacy (ถึง 7.10) ส่วน **Amazon OpenSearch Serverless** มี collection สามแบบ (search, time series และ vector search) ที่ scale เป็น OpenSearch Compute Unit แยกขนาดกันระหว่างฝั่ง indexing กับฝั่ง search โดยเก็บข้อมูลไว้ใน Amazon S3 แล้ว **Elastic Cloud** ก็รัน Elasticsearch ได้ทั้งแบบ hosted deployment ที่เรากำหนดขนาดเอง หรือแบบ serverless project บน cloud provider และ region ที่เราเลือก

## ใช้ตอนไหนดี

ใช้เมื่อการค้นหาเป็นฟีเจอร์ในตัวมันเอง: full-text query ที่จัดอันดับตาม relevance, facet และ aggregation บน document จำนวนมาก, analytics ของ log และ event ปริมาณสูง หรือ vector search คู่กับข้อความ มันเหมาะกับข้อมูลที่สร้างใหม่จากที่อื่นได้ และเสิร์ฟช้าไปประมาณหนึ่งวินาทีได้ ให้เก็บ system of record ไว้ใน database: index ไม่มี transaction ข้ามหลาย document และมันครบได้แค่เท่าที่ pipeline ที่ป้อนมันครบ

| | Elasticsearch | OpenSearch | Apache Solr | PostgreSQL full-text search | Meilisearch, Typesense |
|---|---|---|---|---|---|
| License | source ภายใต้ AGPLv3, SSPL หรือ Elastic License 2.0 ส่วน binary ของ Elastic ภายใต้ ELv2 | Apache 2.0 อยู่ใน OpenSearch Software Foundation | Apache 2.0 เป็นโปรเจกต์ของ Apache Software Foundation | PostgreSQL Licence | Meilisearch: MIT โดยส่วน Enterprise Edition ใช้ BUSL 1.1 ส่วน Typesense: GPL-3.0 |
| Index และ ranking | Lucene, BM25 เป็นค่าตั้งต้น | Lucene, BM25 เป็นค่าตั้งต้น | Lucene, BM25 เป็นค่าตั้งต้น | `tsvector` กับ GIN หรือ GiST index โดย `ts_rank` ไม่ใช้สถิติของข้อมูลทั้งชุด | engine ของตัวเอง มี typo tolerance ในตัว และ Meilisearch จัดอันดับด้วยกฎที่เรียงลำดับไว้ |
| Scale out | shard และ replica มี master election ในตัว | แบบเดียวกัน และมี segment replication ให้เลือก | SolrCloud: shard และ replica ประสานงานด้วย ZooKeeper | ใช้ของ database เอง: read replica, partitioning | Meilisearch: sharding และ replication ใน Enterprise Edition ส่วน Typesense: Raft cluster ที่เก็บข้อมูลทั้งชุดไว้ใน memory ของทุก node |
| Vector | `dense_vector`, HNSW | `knn_vector`, Faiss หรือ Lucene | `DenseVectorField`, HNSW | extension pgvector: HNSW, IVFFlat | semantic search ด้วย embedding |
| Managed offering | Elastic Cloud บน AWS และ cloud อื่น | Amazon OpenSearch Service และ OpenSearch Serverless | ไม่มี Solr ที่ AWS ดูแลให้ | Amazon RDS, [Amazon Aurora](../amazon-rds-aurora/) | Meilisearch Cloud, Typesense Cloud |
| เลือกเมื่อ | อยากได้ฟีเจอร์และเครื่องมือของ Elastic จะดูแลเองหรือใช้ Elastic Cloud ก็ได้ | อยากได้ Apache 2.0 หรือ service ที่ AWS ดูแลให้ | รัน Solr อยู่แล้วหรือต้องพึ่งฟีเจอร์ของมัน | catalogue ไม่ใหญ่มากและข้อมูลอยู่ใน PostgreSQL อยู่แล้ว | index เล็กถึงกลางตัวเดียวที่ต้องการการค้นหาแบบทันทีและทนคำพิมพ์ผิด โดยแทบไม่ต้องดูแล |

ข้อมูลจากเอกสารของ Elastic, OpenSearch, Solr, PostgreSQL 18, pgvector, Meilisearch และ Typesense เดือนตุลาคม 2026

**Elasticsearch หรือ OpenSearch?** Elasticsearch ใช้ license Apache 2.0 มาจนถึงมกราคม 2021 ตอนนั้น Elastic ประกาศว่าตั้งแต่ 7.11 source ของมันจะใช้ dual license ระหว่าง Server Side Public License (SSPL) กับ Elastic License โดยไม่มีตัวไหนผ่านการรับรองของ OSI แล้ว Elastic ก็อธิบายว่า SSPL มีไว้ป้องกัน cloud provider ที่เอาซอฟต์แวร์ open source ไปขายเป็น service โดยไม่ contribute กลับ หนึ่งสัปดาห์ต่อมา AWS บอกว่าจะ fork โค้ดชุดสุดท้ายที่ยังเป็น Apache license และในเดือนเมษายน 2021 ก็เปิดตัว OpenSearch และ OpenSearch Dashboards ที่แยกมาจาก Elasticsearch และ Kibana 7.10.2 ภายใต้ Apache 2.0 แล้ว 1.0 ก็ตามมาในเดือนกรกฎาคม 2021 ส่วน Amazon Elasticsearch Service ก็กลายเป็น Amazon OpenSearch Service ต่อมาในเดือนสิงหาคม 2024 Elastic ก็ประกาศเพิ่ม AGPLv3 ที่ OSI รับรองเป็นตัวเลือกที่สามสำหรับ source ของ Elasticsearch และ Kibana และใส่เข้าไปใน source ภายใน release 8.16 ส่วน binary distribution ของ Elastic เองยังอยู่ภายใต้ Elastic License 2.0 ส่วนในเดือนกันยายน 2024 AWS ก็ย้าย OpenSearch ไปอยู่ใน OpenSearch Software Foundation ตัวใหม่ภายใต้ Linux Foundation แล้วตั้งแต่ปี 2021 ทั้งสองตัวก็แยกทางกันเรื่อย ๆ: API, ฟีเจอร์, client และเวอร์ชันต่างกัน (การ upgrade ตรงไปเป็น OpenSearch มีเอกสารรองรับแค่จาก Elasticsearch OSS 6.8.0 ถึง 7.10.2) เพราะฉะนั้นให้เลือกตัวเดียว test กับเวอร์ชันที่รันจริง และเช็ก license ให้ตรงกับวิธีที่เราแจกจ่ายหรือ host มัน

## ได้อะไร เสียอะไร

- **มี copy ที่สองที่ต้องคอยให้ตรงกัน** index เป็นข้อมูลที่ derive มา มันช้ากว่า database เท่ากับ delay ของ pipeline บวก refresh interval มันอาจพลาดหรือ replay การเปลี่ยนแปลงซ้ำถ้า pipeline เป็นแบบนั้น และไม่มีอะไรทำให้การเขียนลง PostgreSQL กับลง index เป็น atomic เดียวกัน ให้เก็บ source of truth ไว้ที่อื่น และมั่นใจว่าสร้าง index ใหม่จากมันได้
- **ไม่มี transaction ข้าม document** การเขียน document เดียวเป็น atomic และมีเวอร์ชัน (`if_seq_no` และ `if_primary_term` ให้ optimistic concurrency control) แต่ request `_bulk` อาจพังบางส่วนทีละ item และไม่มี rollback
- **mapping เปลี่ยนยาก** เพิ่ม field ได้ แต่การเปลี่ยน type หรือ analyzer ของ field แปลว่าต้องมี index ใหม่และต้อง reindex ส่วนชื่อ field ที่มาจากข้อมูล (JSON key ที่ user ส่งมา หรือ ID ที่ใช้เป็น key) จะทำให้ mapping โตไปเรื่อย ๆ จนกว่า `index.mapping.total_fields.limit` (ค่าตั้งต้น 1,000) จะปฏิเสธ field ใหม่: นี่คือ **mapping explosion**
- **หน้าลึก ๆ แพง** ทุก shard ต้องโหลด hit จำนวน `from + size` ให้ coordinating node รวม ทำให้หน้า 500 แพงกว่าหน้า 1 มาก และ `index.max_result_window` ก็หยุด `from + size` ไว้ที่ 10,000 ให้ใช้ `search_after` คู่กับ point in time (PIT) เพื่อให้เห็นข้อมูลชุดเดียวกันตลอด เวลาจะไล่หน้าลึก ๆ ส่วน scroll API ไม่แนะนำให้ใช้กับงานนี้แล้ว
- **shard เป็นการตัดสินใจที่ต้องทำตั้งแต่ต้น** ถ้าน้อยไปก็จำกัดว่า index จะกระจายไปได้กี่ node ถ้าเยอะไปก็เปลือง memory และการประสานงาน และทำให้การค้นหาช้า (oversharding) ทาง Elastic แนะนำ shard ขนาด 10 ถึง 50 GB ที่มี document น้อยกว่า 200 ล้านตัวต่อ shard ส่วน AWS แนะนำ 10 ถึง 30 GiB สำหรับงานที่ search latency สำคัญที่สุด และ 30 ถึง 50 GiB สำหรับ workload ที่เขียนหนักอย่าง log analytics
- **คำตอบเป็นค่าประมาณ** aggregation แบบ `terms` ข้าม shard อาจนับขาด ส่วน `cardinality` เป็นค่าประมาณ สถิติต่อ shard อาจทำให้คะแนนขยับ และ approximate kNN อาจพลาดเพื่อนบ้านที่แท้จริงไปบางตัว
- **relevance ต้องลงแรง** BM25 ให้ค่าตั้งต้นที่พอใช้ได้ แต่การค้นหาสินค้าที่ดีมักต้องมี synonym, boost ต่อ field, สัญญาณทางธุรกิจ และการ test กับ query จริง
- **กิน memory** JVM heap เก็บโครงสร้างของ engine เอง ส่วน filesystem cache ของ operating system ที่ต้องใช้ memory อีกเท่าตัว คือสิ่งที่ทำให้ segment เร็ว

## ข้อควรรู้ตอนลงมือทำ

index จาก scenario และสิ่งที่ analyzer ของมันทำกับชื่อสินค้า:

```text
PUT products
{
  "settings": { "number_of_shards": 3, "number_of_replicas": 1, "refresh_interval": "1s" },
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "title":       { "type": "text", "analyzer": "english" },
      "description": { "type": "text", "analyzer": "english" },
      "category":    { "type": "keyword" },
      "brand":       { "type": "keyword" }
    }
  }
}

GET products/_analyze
{ "analyzer": "english", "text": "Red ceramic mug" }
# returns the tokens red, ceram and mug
```

- **index ด้วย key และลำดับของ database** ใช้ primary key ของ row เป็น `_id` เพื่อให้การเปลี่ยนแปลงที่ถูก replay เขียนทับ document เดิมแทนที่จะเพิ่มตัวที่สอง และส่งตัวเลขที่เพิ่มขึ้นทุกครั้งที่ row เปลี่ยน เช่น `lsn` ใน block `source` ของ Debezium event เป็น external version แล้ว Elasticsearch จะรับการเขียนก็ต่อเมื่อเวอร์ชันสูงกว่าตัวที่เก็บไว้ ทำให้การเปลี่ยนแปลงที่เก่ากว่าแต่มาถึงช้าเขียนทับตัวที่ใหม่กว่าไม่ได้ ส่วน version conflict (409) ที่เกิดขึ้นให้ถือว่า apply ไปแล้ว

  ```text
  POST _bulk
  { "index": { "_index": "products", "_id": "14", "version": 48213207, "version_type": "external" } }
  { "title": "Red ceramic mug", "category": "kitchen", "brand": "Clayworks" }
  ```

- **โหลดเป็น bulk** สำหรับการโหลดครั้งแรกหรือการ rebuild ทั้งหมด ให้ตั้ง `refresh_interval` เป็น `-1` และ `number_of_replicas` เป็น `0` แล้วค่อยคืนค่าทั้งสองตัว ระหว่างนั้นถ้าไม่มี replica แล้ว node หายไป ข้อมูลก็อาจหายได้ หาขนาด `_bulk` ด้วยการวัด: เริ่มที่ประมาณ 100 document ต่อ request แล้วเพิ่มเป็นสองเท่าไปเรื่อย ๆ จนกว่า throughput จะไม่ดีขึ้น และส่งจากหลาย worker
- **ค้นหาผ่าน alias ไม่ใช่ index** ให้แอป query alias อย่าง `products` ที่ชี้ไปที่ `products-v1` ถ้าจะเปลี่ยน mapping ให้สร้าง `products-v2` เติมข้อมูลจากต้นทางหรือด้วย `_reindex` แล้วย้าย alias ใน request `_aliases` ครั้งเดียว ที่เป็น atomic
- **กำหนดขนาด heap อย่างระวัง** Elasticsearch ตั้ง JVM heap จาก role และ memory ของ node และ Elastic แนะนำให้ใช้ค่าตั้งต้นนั้น ถ้าจะตั้งเอง ให้ `-Xms` และ `-Xmx` เป็นค่าเดียวกัน ไม่เกิน 50% ของ memory ที่ node มีให้ และต่ำกว่าเส้นของ compressed object pointer (26 GB ปลอดภัยบนระบบส่วนใหญ่) แล้วปล่อยที่เหลือไว้ให้ filesystem cache ส่วน OpenSearch เริ่มด้วย heap 1 GB และเอกสารของมันแนะนำครึ่งหนึ่งของ RAM ของระบบ
- **ระวังลิมิตของ cluster** ค่าตั้งต้นของ Elasticsearch จะไม่ยอมสร้าง shard ที่ไม่ใช่ frozen เกิน 1,000 ตัวต่อ node และกฎคร่าว ๆ ของ Elastic ให้ master-eligible node มี heap 1 GB ต่อ 3,000 index สำหรับข้อมูลตามเวลา ให้ rollover เป็นตัวคุมขนาด shard (`max_primary_shard_size` ของ ILM ที่ 50 GB ตามคำแนะนำของ Elastic)
- **รัน master-eligible node สามตัว** ถ้ามีสองตัว เสียตัวไหนไปก็ไม่เหลือเสียงข้างมากให้เลือก master ส่วนพอ cluster มี node มากกว่าไม่กี่ตัว ก็ให้ย้ายไปใช้ dedicated master-eligible node
- **ทำให้ปลอดภัย** ตอนเริ่มครั้งแรก Elasticsearch สร้าง TLS certificate ให้ทั้ง layer HTTP และ transport และตั้ง password ให้ superuser `elastic` ส่วนการติดตั้งตั้งต้นของ OpenSearch ใช้ security config สำหรับ demo ที่มี certificate แบบ self-signed และ password ที่ใคร ๆ ก็รู้ ต้องเปลี่ยนก่อนขึ้น production แล้วก็ให้แต่ละแอปมี role ที่จำกัดแค่ index ของมัน เก็บ cluster ไว้ใน private network หลังแอป และอย่าให้ browser query มันตรง ๆ
- **คอยดูมัน** cluster health และ shard ที่ยังไม่ได้ assign (`GET _cluster/health`, `GET _cluster/allocation/explain`), การใช้ heap และ garbage collection, latency ของการ index และการค้นหา, request ที่ถูกปฏิเสธใน thread pool, การใช้ disk เทียบกับ allocation watermark และ consumer lag ของ indexer ใน Kafka
