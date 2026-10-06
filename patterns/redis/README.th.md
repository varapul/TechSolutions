## ปัญหา

API ของ Acme Shop รันบน app server สามตัว และแทบทุก request ต้องใช้ state ที่แชร์กันนิดหน่อย: สินค้าที่จะแสดง, session ของ user, จำนวนครั้งที่ API key นี้เรียกไปแล้วในนาทีนี้ และสินค้าขายดีสำหรับหน้าแรก ถ้าเก็บ state พวกนี้ไว้ใน memory ของแต่ละ server มันจะพังทันทีที่ load balancer ส่ง request ถัดไปไปที่ server อีกตัว ส่วนถ้าเอาทั้งหมดไปไว้ใน PostgreSQL ตัว database ก็จะเสียเวลาไปกับการอ่านเล็ก ๆ ที่ hot และอยู่ได้ไม่นาน กับ counter ที่แทบไม่ต้องใช้ SQL หรือ durability เต็มรูปแบบ

Redis เก็บ state แบบนี้ไว้ใน memory บน server ตัวเดียวที่ใช้ร่วมกัน: แอปส่ง command ผ่าน TCP connection แล้วได้คำตอบกลับมาจาก RAM โดยไม่ต้องอ่าน disk ระหว่างทาง ส่วน Valkey คือ fork ของ Redis ที่ใช้ license แบบ BSD (ดู *Redis หรือ Valkey* ด้านล่าง) ทุกอย่างในหน้านี้ใช้ได้กับทั้งสองตัว เว้นแต่จะมีเลขเวอร์ชันบอกไว้เป็นอย่างอื่น เวอร์ชันและค่า default ในหน้านี้เป็นของ Redis Open Source 8.10 (กรกฎาคม 2026) และ Valkey 9.1 (พฤษภาคม 2026)

## ทำงานยังไง

**Data structure ไม่ใช่แค่ value** ทุก key ถือ value ที่มี type หนึ่งตัว และแต่ละ type ก็มี command ของตัวเอง ทุก command เป็น atomic:

| Type | ใช้ทำอะไร | Command |
|---|---|---|
| String | JSON ที่ cache ไว้, counter, flag, lock token | `SET … EX`, `GET`, `INCR` |
| Hash | object หรือ session: field กับ value ภายใต้ key เดียว | `HSET`, `HGETALL` |
| List | queue ง่าย ๆ หรือรายการ item ล่าสุด | `LPUSH`, `BRPOP`, `LRANGE` |
| Set | member ที่ไม่ซ้ำกัน: tag, ใครออนไลน์อยู่, ID ที่เห็นแล้ว | `SADD`, `SISMEMBER` |
| Sorted set | member ที่เรียงตาม score: leaderboard, priority, time index | `ZINCRBY`, `ZRANGE … REV` |
| Stream | log แบบ append-only ที่ consumer group อ่าน | `XADD`, `XREADGROUP`, `XACK` |
| Bitmap, bitfield | flag และ counter เล็ก ๆ ที่อัดไว้ใน string | `SETBIT`, `BITCOUNT`, `BITFIELD` |
| HyperLogLog | จำนวน item ที่ไม่ซ้ำกันแบบประมาณ ใช้ที่ไม่เกิน 12 KB | `PFADD`, `PFCOUNT` |
| Geospatial index | หาจุดตามรัศมีหรือกรอบสี่เหลี่ยม | `GEOADD`, `GEOSEARCH` |

Redis 8.0 (พฤษภาคม 2025) รวม module ของ Redis Stack เดิมเข้ามาใน Redis Open Source: JSON, time series, probabilistic type ห้าแบบ (Bloom filter กับ cuckoo filter, count-min sketch, top-k, t-digest) และ Redis Query Engine สำหรับ secondary index และ vector search แถมยังมี type ใหม่คือ vector set ด้วย ส่วน Redis 8.8 เพิ่ม type แบบ array เข้ามา ตัว type ใหม่ ๆ พวกนี้คือจุดที่ Redis กับ Valkey ต่างกันมากที่สุด เลยต้องเช็กว่า server ที่คุณรันมีอะไรจริง ๆ

**มี thread เดียวที่รัน command** Redis multiplex connection ของทุก client ไว้บน event loop เดียว และ main thread ตัวเดียวรัน command ของพวกมันทีละตัวต่อกันไป ตัว diagram วาดตรงนี้เป็นแถวของ command ที่รออยู่หนึ่งแถว ไม่มีอะไรแทรกเข้ามาระหว่างที่ command หนึ่งกำลังรัน ทำให้ `INCR` เป็น read-modify-write ที่ปลอดภัยโดยไม่ต้องมี lock และ command ที่ช้าตัวเดียว (`KEYS *` บน key หลายล้านตัว หรือ `SMEMBERS` บน set ขนาดใหญ่) ก็ทำให้ client ทุกตัวต้องรอ ส่วน I/O thread ที่เปิดใช้ได้ (`io-threads` ปิดไว้โดย default) ช่วยอ่านและ parse request แล้วเขียน reply บน server ที่งานยุ่ง ทั้ง Redis 8.0 และ Valkey 8.0 ทำส่วนนี้ใหม่ แต่ main thread ก็ยังเป็นตัวรันทุก command

**หลาย command พร้อมกัน**
- **Pipelining** ส่ง command เป็นชุดโดยไม่รอ reply ของแต่ละตัว ทั้งชุดเลยเสีย network round trip แค่รอบเดียว แทนที่จะเสียรอบละ command
- **Transaction**: `MULTI` เอา command เข้าคิว แล้ว `EXEC` รันทั้งหมดเป็นก้อนเดียวที่ client อื่นแทรกเข้ามาไม่ได้ ไม่มี rollback: ถ้า command ตัวหนึ่ง fail ตัวอื่นก็ยังรันต่อ ส่วน `WATCH` เพิ่ม optimistic locking ทำให้ `EXEC` ไม่ทำอะไรเลยถ้า key ที่ watch ไว้เปลี่ยนไประหว่างนั้น
- **Lua script** (`EVAL`) และตั้งแต่ Redis 7.0 ก็มี **function** (`FUNCTION LOAD`, `FCALL`) ที่รัน logic ของคุณข้างใน server แบบ atomic เหมาะกับขั้นตอนแบบเช็กแล้วค่อยทำ เช่น "increment แล้วตั้ง expiry ถ้า key ยังใหม่"

**Expiry กับ eviction เป็นคนละเรื่องกัน** key ไหนก็มี TTL ได้ (`SET … EX 300`, `EXPIRE`) โดย key ที่หมดอายุจะถูกเอาออกเมื่อมี client มาแตะมันครั้งถัดไป และยังมี background job ที่สุ่มดู key ที่มี TTL แล้วลบตัวที่หมดอายุที่เจอด้วย ส่วน eviction เกิดขึ้นก็ต่อเมื่อ memory ถึง `maxmemory` แล้ว `maxmemory-policy` เป็นตัวตัดสินว่าจะทิ้งอะไร: `allkeys-lru` หรือ `allkeys-lfu` สำหรับ cache ล้วน ๆ, policy แบบ `volatile-*` สำหรับทิ้งแค่ key ที่มี TTL หรือ `noeviction` ที่เป็น default โดยเก็บทุกอย่างไว้แล้วให้การเขียนใหม่ fail ด้วย error `OOM` ส่วน Redis 8.6 เพิ่ม policy แบบ least-recently-modified (`allkeys-lrm`, `volatile-lrm`) เข้ามา ถ้า `maxmemory` เป็น 0 (ค่า default บนระบบ 64-bit) ตัว Redis จะไม่ตั้ง limit เอง และจะจอง memory ไปเรื่อย ๆ

**Persistence จะเปิดหรือไม่ก็ได้**
- **RDB**: child process ที่ fork ออกมาเขียน snapshot ณ เวลาหนึ่งลงใน `dump.rdb` โดย default จะเกิดหลังผ่านไปหนึ่งชั่วโมงถ้ามี key เปลี่ยนอย่างน้อยหนึ่งตัว หลังห้านาทีถ้ามี 100 การเปลี่ยนแปลง หรือหลังหนึ่งนาทีถ้ามี 10,000 การเปลี่ยนแปลง ตัวไฟล์เล็กและ restart จากมันได้เร็ว แต่ทุกอย่างที่เกิดหลัง snapshot ล่าสุดจะหายไปถ้าเครื่องล่ม
- **AOF** (`appendonly yes` ปิดไว้โดย default): การเขียนทุกครั้งจะถูกต่อท้ายลงใน log ถ้าใช้ `appendfsync everysec` ที่เป็น default ตัว log จะถูก flush ลง disk วินาทีละครั้งอยู่เบื้องหลัง การล่มเลยอาจทำให้การเขียนราว ๆ หนึ่งวินาทีสุดท้ายหายไป ส่วน `always` จะ flush ทุกการเขียนและช้ากว่ามาก ตั้งแต่ 7.0 ตัว AOF เป็นชุดของไฟล์ คือไฟล์ base บวกกับ log แบบ incremental ที่ rewrite อยู่เบื้องหลัง
- **ทั้งสองแบบ**: เอกสารแนะนำให้เปิดทั้งคู่ถ้าคุณอยากได้ความปลอดภัยของข้อมูลใกล้เคียงกับที่ PostgreSQL ให้

**Replication และ failover** primary ส่งการเขียนของมันไปที่ replica แบบ **asynchronous**: มันตอบ client ก่อน และไม่รอ replica ส่วน `WAIT` ให้ client บล็อกรอจนกว่า replica จำนวนหนึ่งจะได้การเขียนก่อนหน้าของมันไปแล้ว (และ `WAITAOF` ที่มีตั้งแต่ 7.2 รอจนการเขียนพวกนั้นลง AOF แล้ว) วิธีนี้ทำให้ช่วงที่การเขียนจะหายแคบลง แต่ไม่ได้ทำให้ Redis เป็น strongly consistent ตัว **Sentinel** คอยดู primary และ replica ของมัน ให้รัน Sentinel อย่างน้อยสามตัวใน failure domain ที่แยกกัน: พอ Sentinel ครบ *quorum* เห็นว่า primary ล่ม ก็จะมี Sentinel ตัวหนึ่งที่เสียงส่วนใหญ่เลือกไว้เป็นคน promote replica ขึ้นมา ชี้ replica ตัวอื่นไปที่ตัวใหม่ และบอก address ใหม่ให้ client ส่วน **Redis Cluster** ทำ shard แทน มันแบ่ง keyspace เป็น 16,384 hash slot ด้วย `CRC16(key) mod 16384` กระจายไปบน primary อย่างน้อยสามตัว (เอกสารแนะนำให้เริ่มที่หก node: primary สามตัว แต่ละตัวมี replica หนึ่งตัว) และ cluster promote replica เองได้โดยไม่ต้องมี Sentinel ไม่ว่าแบบไหนก็พึ่ง asynchronous replication ทั้งคู่ เลยทำการเขียนหายได้ ถ้า primary acknowledge ไปแล้วแต่ยังไม่ได้ส่งต่อ เหมือนในขั้นที่ 3

**Command ที่ใช้หลาย key ใน cluster** ทำงานได้ก็ต่อเมื่อทุก key hash ไปที่ slot เดียวกัน ไม่อย่างนั้นจะได้ error `CROSSSLOT` กลับมา ส่วน hash tag เป็นตัวเลือกว่าจะ hash ส่วนไหนของชื่อ: `{user:42}:cart` กับ `{user:42}:orders` ต่าง hash แค่ `user:42` เลยไปลงที่ slot 15880 ทั้งคู่ แล้ว key ทุกตัวที่ใช้ tag เดียวกันก็จะอยู่บน shard เดียว เพราะฉะนั้นอย่าใส่ tag เดียวกันให้ key เป็นล้านตัว

**Pub/sub หรือ stream** `PUBLISH` ส่ง message ให้ใครก็ตามที่ subscribe อยู่ ณ ตอนนั้น แบบ at most once: subscriber ที่ล่มหรือกำลัง reconnect อยู่จะพลาด message ไป ส่วน **stream** เก็บ message ไว้ แล้ว consumer group ก็แบ่ง message ให้ worker (`XREADGROUP`) จำว่า worker แต่ละตัวได้อะไรไปแล้วแต่ยังไม่ acknowledge (`XACK`) และให้ worker ตัวอื่นมา claim message ของตัวที่ตายไปได้ ทำให้ได้ delivery แบบ at-least-once ตัว stream คือทางเลือกแบบเบา ๆ ที่อยู่ใน Redis ที่คุณรันอยู่แล้ว ส่วน log เฉพาะทางอย่าง [Kafka](../kafka/) เก็บประวัติได้มากกว่าเยอะ และ scale ได้ไกลกว่า

**Distributed lock** lock บน instance เดียวคือ `SET lock:report:42 <random value> NX PX 30000`: จะสำเร็จก็ต่อเมื่อไม่มีใครถือ key นี้อยู่ และ key จะหมดอายุไปเองถ้าคนที่ถืออยู่ตาย ให้ปล่อย lock ก็ต่อเมื่อ value ยังเป็นของคุณอยู่ ด้วย `DELEX lock:report:42 IFEQ <value>` (Redis 8.4+), `DELIFEQ` (Valkey 9.0+) หรือ Lua script สั้น ๆ บนเวอร์ชันเก่า ส่วน Redlock ที่เป็น algorithm ในเอกสารของ Redis สำหรับทำ lock ข้าม primary หลายตัวที่เป็นอิสระต่อกัน ยังเป็นที่ถกเถียงอยู่ ใน [How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html) (2016) Martin Kleppmann แย้งว่ามันพึ่งสมมติฐานเรื่องเวลา (network delay ที่มีขอบเขต, process ที่หยุดชั่วคราว และ clock drift) และไม่แจก fencing token: หนักเกินไปสำหรับ lock แบบ best-effort และไม่ปลอดภัยพอเมื่อความถูกต้องขึ้นอยู่กับ lock สำหรับกรณีหลัง เขาแนะนำให้ใช้ระบบ consensus อย่าง ZooKeeper บวกกับ fencing token ที่ storage เป็นคนเช็ก ส่วน Salvatore Sanfilippo (antirez) ที่ออกแบบ Redlock ตอบกลับใน [Is Redlock safe?](https://antirez.com/news/101) ว่า algorithm นี้ถูกต้องภายใต้สมมติฐานที่มันระบุไว้ และปัญหาเรื่อง process หยุดชั่วคราวก็กระทบ lock ทุกแบบที่หมดอายุไปเอง ไม่ว่ายังไง lock ของ Redis ก็เป็นวิธีที่ดีในการเลี่ยงไม่ให้ทำงานเดียวกันซ้ำสองรอบ ส่วนถ้าความถูกต้องต้องมีคนเขียนได้ทีละคน ให้ดู [Leader Election](../leader-election/) และ fencing token ของมัน

## อยู่ตรงไหนใน solution

- **Solution:** back end ของ web และ mobile (session, cache ของหน้าเว็บและ API), public API (rate limit ต่อ key), ร้านค้าและเกม (leaderboard, ตะกร้าสินค้า, counter), ระบบ job (queue และการกันซ้ำ), ฟีเจอร์ real-time (presence, การ fan-out ด้วย pub/sub)
- **Pattern ใน catalog นี้ที่มัน implement:** [Cache-Aside](../cache-aside/) ด้วย `GET` และ `SET … EX`, session ฝั่ง server จาก [Sessions vs Tokens](../sessions-vs-tokens/), [Rate Limiting](../rate-limiting/) ด้วย `INCR` กับ TTL ต่อ window หรือ log แบบ [sliding window](../sliding-window/) ที่เก็บไว้ใน sorted set, key สำหรับกันซ้ำของ [Idempotent Consumer](../idempotent-consumer/) (`SET msg:<id> 1 NX EX 86400`), [Publish-Subscribe](../publish-subscribe/) และ [Competing Consumers](../competing-consumers/) ด้วย pub/sub และ consumer group ของ stream และ lease สำหรับ [Leader Election](../leader-election/) โดยมีข้อควรระวังตามที่บอกไว้ข้างบน ลึกลงไปข้างใต้ keyspace ก็คือ [hash table](../hash-table/) และ Redis Cluster ก็คือการทำ [sharding](../sharding/) ตาม hash slot
- **เพื่อนบ้านที่มักเจอ:** app server แบบ stateless หรือ function ที่อยู่ข้างหน้า, system of record ที่อยู่ข้างหลัง (ที่นี่คือ [PostgreSQL](../postgresql/)), API gateway หรือ load balancer ที่พึ่ง counter ของมัน และ background worker ที่อ่าน list หรือ stream ของมัน
- **Managed offering:** **Amazon ElastiCache** รัน Valkey, Redis OSS หรือ Memcached ได้ทั้งแบบ serverless (จัดการ capacity ให้) หรือเป็น cluster แบบ node-based ที่คุณกำหนดขนาดเอง ส่วน **Amazon MemoryDB** เป็นรุ่นที่ durable: compatible กับ Valkey และ Redis OSS โดยการเขียนทุกครั้งถูกเก็บไว้ใน transactional log แบบ Multi-AZ มันเลยใช้เป็น primary database ได้ ตัว **Azure Managed Redis** สร้างบน Redis Enterprise ส่วน tier Basic, Standard และ Premium ของ Azure Cache for Redis ตัวเก่าจะเลิกให้บริการวันที่ 30 กันยายน 2028 ส่วน **Google Cloud Memorystore** มี Memorystore for Valkey, for Redis Cluster และ for Redis และ Redis Ltd. เองก็ขาย Redis Cloud

## ใช้ตอนไหนดี

ใช้กับ state ที่เล็ก hot และแชร์กัน ที่ server หลายตัวอ่านและ update ทุก request และเป็นข้อมูลที่สร้างใหม่ได้ หรือยอมเสียไปบ้างได้: cache, session, counter, leaderboard, queue อายุสั้น และ lock อย่าให้มันเป็นสำเนาเดียวของข้อมูลที่เสียไม่ได้ และอย่าใช้มันเป็น database ทั่วไปสำหรับ query ขนาดใหญ่หรือ query แบบ ad-hoc

| | Redis หรือ Valkey | Memcached | database ที่มี buffer cache ใหญ่ ๆ |
|---|---|---|---|
| Data model | value ที่มี type: string, hash, list, set, sorted set, stream… | string (blob) ตาม key | table, SQL, join, index |
| Atomic operation | ครบมาก: `INCR`, `ZINCRBY`, transaction, script | แบบง่าย: get, set, increment, compare-and-set | ACID transaction เต็มรูปแบบ |
| Thread | main thread ตัวเดียวรัน command และเปิด I/O thread เพิ่มได้ | multi-threaded | connection และ worker จำนวนมาก |
| Durability | RDB snapshot และ AOF ที่เปิดใช้ได้ตามต้องการ | ไม่มี: เป็นแค่ cache | durable ตั้งแต่ออกแบบ (write-ahead log) |
| Replica และ failover | replica แบบ asynchronous, Sentinel หรือ Cluster | ไม่มี: server ไม่รู้จักกัน ส่วน client เป็นคน hash key กระจายไปหลายตัว | มี replication ในตัว ส่วน failover ใช้ tooling หรือ managed service |
| เลือกเมื่อ | ต้องการ state ที่แชร์กันและ data structure ไม่ใช่แค่ cache | อยากได้ cache ที่ง่ายที่สุด บน node ใหญ่ ๆ หลาย core | working set ใส่ลงใน memory ได้ และการมีระบบน้อยลงหนึ่งตัวสำคัญกว่าความเร็ว |

**Redis หรือ Valkey?** Redis ใช้ license แบบ BSD มาจนถึง 7.2 แล้วในเดือนมีนาคม 2024 ตัว Redis Ltd. ก็ย้าย Redis 7.4 ขึ้นไปไปใช้ license แบบ source-available ให้เลือกสองตัวคือ RSALv2 หรือ SSPLv1 โดยที่ OSI ไม่ได้รับรองสักตัว อีกหนึ่งสัปดาห์ต่อมาวันที่ 28 มีนาคม 2024 ทาง Linux Foundation ก็ประกาศ Valkey ที่ fork มาจาก Redis 7.2.4 และยังใช้ license แบบ BSD 3-clause อยู่ โดยมี AWS, Google Cloud, Oracle, Ericsson และ Snap รวมถึงรายอื่นหนุนหลัง พอถึง Redis 8.0 (พฤษภาคม 2025) ทาง Redis ก็เพิ่ม AGPLv3 ที่ OSI รับรองเข้ามาเป็นตัวเลือกที่สาม และเปลี่ยนชื่อรุ่นฟรีเป็น Redis Open Source ทั้งสองตัวพูด protocol เดียวกันและมี command ของ Redis 7.2 เหมือนกัน แต่หลังจากนั้นก็ค่อย ๆ แยกทางกัน: Redis 8 รวม JSON, time series, probabilistic type และ query engine ไว้ใน core ส่วน Valkey มี JSON, Bloom filter และ search เป็น module ที่รวมแพ็กไว้ด้วยกันเป็น Valkey Bundle และมีฟีเจอร์ของตัวเองเพิ่มเข้ามา อย่าง `DELIFEQ` และ atomic slot migration ใน 9.0 ส่วนเรื่อง license ให้เช็กเทียบกับวิธีที่คุณแจกจ่ายหรือ host software และเช็กว่า cloud ของคุณมี managed engine ตัวไหนให้บ้าง

## ได้อะไร เสียอะไร

- **Memory คือขีดจำกัด** dataset ทั้งหมดอยู่ใน RAM ขนาดเลยถูกจำกัด และราคาต่อ GB ก็แพงกว่า disk พอ memory เต็ม สิ่งที่คุณจะได้คือ eviction หรือ error `OOM`
- **มีช่วงเวลาเล็ก ๆ ที่ข้อมูลอาจหาย** ทั้ง asynchronous replication และ `appendfsync everysec` ต่างแลกการเสียข้อมูลที่อาจเกิดขึ้นเล็กน้อยกับความเร็ว ตัว Redis เป็นสำเนาของข้อมูลที่ดี แต่ไม่ใช่สำเนาเดียวที่ปลอดภัย เว้นแต่คุณจะใช้รุ่นที่ durable อย่าง MemoryDB
- **command ที่ช้าตัวเดียวทำให้ทุกคนค้าง** execution thread ที่มีตัวเดียวทำให้ command เป็น atomic แต่ก็แปลว่า `KEYS` ที่ใช้เวลานาน, `DEL` ตัวใหญ่ หรือ script ที่หนักจะบล็อก client ทุกตัว ให้ใช้ `SCAN` แทน `KEYS` และใช้ `UNLINK` เพื่อคืน memory ของ value ใหญ่ ๆ อยู่เบื้องหลัง
- **cluster เปลี่ยนวิธีเขียนโปรแกรม** command ที่ใช้หลาย key, transaction และ script ต้องอยู่ภายใน slot เดียว ชื่อ key เลยต้องออกแบบมาเพื่อสิ่งนี้ (hash tag) และ client ต้องรับมือกับการ redirect แบบ `MOVED` และ `ASK` ได้
- **ความ consistent ของ cache เป็นหน้าที่ของคุณ** Redis ไม่รู้ว่า PostgreSQL เปลี่ยนเมื่อไร ตัว TTL และการ invalidate ตอนเขียน (ดู [Cache-Aside](../cache-aside/)) เป็นตัวจำกัดว่าค่าที่ cache ไว้จะ stale ได้นานแค่ไหน

## ข้อควรรู้ตอนลงมือทำ

key ของ scenario นี้ พร้อม reply จาก redis-cli:

```text
> SET product:42 '{"id":42,"name":"Mug"}' EX 300
OK
> HSET session:9f3c user 42 cart 2
(integer) 2
> EXPIRE session:9f3c 1800
(integer) 1
> INCR ratelimit:key-7:1201
(integer) 101
> EXPIRE ratelimit:key-7:1201 60 NX
(integer) 0
> ZINCRBY top-sellers 1 mug
"813"
```

`101` เกิน limit 100 ทำให้แอปตอบ 429 ส่วน `EXPIRE … NX` (Redis 7.0+) จะตั้ง TTL ให้แค่ counter ที่ยังไม่มี TTL มันเลยคืน 0 ในที่นี้: request แรกของนาทีนั้นตั้งไว้แล้ว ถ้ารัน `INCR` กับ `EXPIRE` เป็นสองคำสั่งแยกกัน จะมีช่องว่างสั้น ๆ ที่ถ้าล่มตรงนั้น counter จะค้างอยู่โดยไม่มี TTL ให้ห่อทั้งสองไว้ใน `MULTI`/`EXEC` หรือใน script หรือใช้ `INCREX` (Redis 8.8+) ที่ increment และตั้ง expiry ในคำสั่งเดียว

- **กำหนดขนาด memory ตาม peak** หลังลบ key ไปแล้ว process มักยังถือ memory ไว้ (allocator คืนให้ไม่ได้เสมอไป) เลยต้องวางแผนตามการใช้งานตอน peak และตั้ง `maxmemory` ให้ต่ำกว่า RAM ของเครื่องเพื่อเผื่อที่ให้ buffer ของ replication กับ AOF และให้ copy-on-write ตอน fork แล้วคอยดู `used_memory`, `mem_fragmentation_ratio` และ eviction ใน `INFO` ส่วน active defragmentation (`activedefrag yes`) ช่วยกู้ memory ที่แตกเป็นชิ้น ๆ กลับมาได้
- **เลือก eviction policy แยกตาม instance** `allkeys-lru` เหมาะกับ cache ล้วน ๆ แต่บน instance ที่ถือ session กับ counter ด้วย มันอาจ evict session ทิ้งตอน memory ตึง ให้เก็บข้อมูลที่ต้องอยู่แน่ ๆ ไว้บน instance แยก หรือกำหนดขนาด memory ให้ไม่มีวันเริ่ม evict
- **หา big key และ hot key** `redis-cli --bigkeys` กับ `--memkeys` สแกนหา key ที่ใหญ่ที่สุด และ Redis 8.6 เพิ่มคำสั่ง `HOTKEYS` เข้ามา ถ้ามี hash ที่ใหญ่มากตัวเดียวหรือ hot key ตัวเดียวใน cluster ก็จะทำให้ shard เดียวรับโหลด ขณะที่ shard อื่นว่าง
- **คอยดู latency** `SLOWLOG GET` แสดงรายการ command ที่ช้า ส่วน latency monitor (`CONFIG SET latency-monitor-threshold 100` แล้วตามด้วย `LATENCY DOCTOR`) อธิบาย latency ที่พุ่งขึ้น การ fork เพื่อทำ RDB snapshot และ AOF rewrite เป็นสาเหตุที่เจอบ่อย: main thread ต้องก็อป page table ของ process ที่ใหญ่ราว 48 MB สำหรับ instance ขนาด 24 GB และเอกสารยังแนะนำให้ปิด transparent huge pages ด้วย
- **อย่าเปิดให้ internet เข้าถึงเด็ดขาด** Redis ออกแบบมาสำหรับ client ที่เชื่อถือได้บน network ที่เชื่อถือได้ ให้คง `bind 127.0.0.1 -::1` ที่เป็น default และ protected mode ไว้ เว้นแต่คุณตั้งใจจะเปิด แล้วตอนนั้นให้ใช้ ACL user ที่ได้ command และ key น้อยที่สุดเท่าที่จำเป็น (Redis 6+), TLS (Redis 6+) และ network rule ที่ยอมให้แค่ app server เข้าได้
- **Configuration ของ scenario นี้** (`redis.conf`): `maxmemory 4gb`, `maxmemory-policy allkeys-lru` ถ้า instance นี้ทำแค่ cache, `appendonly yes` คู่กับ `appendfsync everysec` และบน Sentinel ใช้ `sentinel monitor acme-redis 10.0.1.10 6379 2` สำหรับ quorum ที่ 2
