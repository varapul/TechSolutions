## ปัญหา

ระบบส่วนใหญ่อ่านมากกว่าเขียนเยอะ และอ่าน record เดิมซ้ำไปซ้ำมา: profile ของ user ที่ sign in อยู่ หน้าสินค้า รายการราคา ถ้าส่ง read ทุกครั้งไปที่ database ก็ต้องเสีย network round trip กับ query หนึ่งรอบทุกครั้ง แล้ว database ก็กลายเป็นคอขวด และเป็นส่วนที่ scale แพงที่สุด ทั้งที่คำตอบแทบไม่เคยเปลี่ยน ส่วน cache ใน memory ตอบได้ในเวลาต่ำกว่าหนึ่งมิลลิวินาทีไปมาก แต่ต้องมีใครสักคนตัดสินว่าจะเก็บอะไรลงไป และคอยทิ้ง entry เมื่อข้อมูลที่มันก็อปมาเปลี่ยน

## ทำงานยังไง

cache อยู่*ข้าง ๆ* เส้นทางของข้อมูล ไม่ได้อยู่บนเส้นทางนั้น แอปพลิเคชันคุยกับ store ทั้งสองตัว ส่วน cache ไม่เคยคุยกับ database เลย

- **อ่าน:** หา key ใน cache ก่อน ถ้า **hit** ก็ใช้ค่าที่อยู่ใน cache ได้เลย ถ้า **miss** ก็อ่านจาก database แล้วเก็บผลลง cache พร้อม **TTL** จากนั้นคืนค่ากลับไป ตัว cache จะเก็บแค่ข้อมูลที่มีคนขอจริง ๆ เพราะแบบนี้ AWS ถึงเรียกวิธีนี้ว่า *lazy loading*
- **เขียน:** update database ที่ยังเป็น system of record อยู่ **แล้วค่อยลบ key ใน cache** ทำให้การอ่านครั้งถัดไป miss แล้วโหลดค่าใหม่ขึ้นมา
- **หมดอายุ:** ทุก entry มี TTL ติดอยู่ อะไรที่การ invalidate พลาดไป (ลบไม่สำเร็จ หรือมีระบบอื่นมาแก้ข้อมูล) ก็จะหมดอายุไปเอง

ตัวเลข ~1 ms กับ ~20 ms ใน diagram เป็นแค่ตัวอย่าง ที่สำคัญคือภาพรวม ตอน hit มีแค่การ lookup ใน memory ครั้งเดียว ส่วนตอน miss ต้องเสีย round trip สามรอบ (cache, database, cache) มันเลยช้ากว่าไม่มี cache เลยด้วยซ้ำ

### เทียบกับ read-through, write-through และ write-behind

| วิธี | ใครเติม cache | การเขียนทำอะไร | ความเสี่ยงหลัก |
|---|---|---|---|
| **Cache-aside** | แอปพลิเคชัน หลังเจอ miss | แอปพลิเคชัน update database แล้วลบ key | มีช่วงที่ข้อมูล stale หลังการเขียน และต้นทุนตอน miss |
| **Read-through** | ตัว cache เอง ผ่าน loader ที่เรา register ไว้ หลังเจอ miss | ขึ้นกับ write strategy ที่จับคู่ด้วย | stale ได้เท่ากับ cache-aside และต้องใช้ cache ที่รองรับ loader |
| **Write-through** | การเขียนแต่ละครั้ง (ตอน miss ก็ยังต้องใช้ read strategy แบบใดแบบหนึ่ง) | update database กับ cache ไปพร้อมกันแบบ synchronous | เขียนช้าลง และ cache ข้อมูลที่อาจไม่มีใครอ่านเลย |
| **Write-behind** (write-back) | การเขียนแต่ละครั้ง | update cache ทันที แล้วค่อย update database ทีหลัง มักทำเป็น batch | การเขียนที่ acknowledge ไปแล้วจะหายไป ถ้า cache ล่มก่อนได้ flush |

Read-through กับ write-through ย้าย logic เดียวกันนี้ไปไว้ใน cache layer เช่น JCache `CacheLoader`/`CacheWriter`, Hazelcast `MapLoader`/`MapStore` หรือ Amazon DynamoDB Accelerator ที่วางอยู่หน้า DynamoDB ส่วน cache-aside ต้องการจาก cache แค่ get, set, delete กับ expiry ไม่มีอะไรมากกว่านั้น เลยใช้กับ key-value store ตัวไหนก็ได้

## ใช้ตอนไหนดี

- ข้อมูลที่เน้นอ่าน มีคนอ่านหลายรอบกว่าจะเปลี่ยนสักครั้ง และยอม stale ได้บ้างแบบมีขอบเขต: profile, catalog, configuration, reference data, ชิ้นส่วนหน้าที่ render ไว้แล้ว
- cache ไม่มี integration แบบ read-through หรือ write-through กับ database ของคุณ หรือแอปพลิเคชันควรเป็นคนคุม key, serialization และ TTL เองตามประเภทข้อมูล
- access pattern เดาได้ยาก ตัว lazy loading จะเก็บอะไรก็ตามที่กลายเป็นของ hot ไว้เอง โดยไม่ต้องตัดสินใจล่วงหน้า

ถ้าข้อมูลทั้งชุดเล็กและแทบไม่เปลี่ยน ก็ข้าม lazy loading ไปเลย: โหลดทั้งหมดตอน startup แล้วปล่อยไว้โดยไม่ต้องหมดอายุ

**อะไรที่ไม่ควร cache** (หรือ cache ได้แต่ต้องระวังมาก ๆ):

- ข้อมูลที่ต้อง strongly consistent หรือต้อง read-your-writes: ยอดเงินกับจำนวนสินค้าคงคลังที่ใช้ตัดสินใจ รวมถึง permission และการ revoke ที่ต้องมีผลทันที
- ข้อมูลที่แทบไม่มีใครอ่านซ้ำ: key กลุ่ม long-tail, report ที่ทำครั้งเดียว, query ที่ personalize มาก ๆ ข้อมูลพวกนี้แค่เปลือง memory แล้วยังดึง hit ratio ให้ต่ำลง
- ข้อมูลที่เปลี่ยนบ่อยกว่าที่มีคนอ่าน การเขียนแต่ละครั้งจะลบ entry ทิ้งก่อนที่ใครจะได้ประโยชน์จากมัน
- secret และข้อมูลส่วนบุคคลที่ sensitive ใน cache ที่หลาย service ใช้ร่วมกัน เว้นแต่ข้อมูลจะถูกเข้ารหัส มี access control และหมดอายุตามกฎ retention ของคุณ
- object ขนาดใหญ่ที่ควรไปอยู่ใน object storage หรือ CDN

## ได้อะไร เสียอะไร

- **การอ่านเจอค่า stale เกิดได้อยู่แล้วตามที่ออกแบบไว้** cache เก็บแค่สำเนา การอ่านเลยอาจตามหลังการเขียนอยู่ช่วงหนึ่ง
  - *ทำไมต้องลบ และทำไมต้องลบหลังเขียน* ถ้า writer สองตัวต่างก็ update database แล้วตามด้วย `SET` ค่าใหม่ของตัวเอง ตัว `SET` ทั้งสองครั้งอาจมาถึงสลับลำดับกับตอน commit ทำให้ค่าที่เก่ากว่าค้างอยู่ใน cache จนกว่า TTL จะหมด ส่วนการลบเป็น idempotent ลำดับเลยไม่สำคัญ memcache ของ Facebook ถึงใช้การลบแทนการ update และต้องลบ*หลัง* commit เพราะถ้าลบก่อน ก็เปิดช่องให้ reader ที่อ่านพร้อมกันโหลดแถวเก่ากลับเข้า cache ก่อนที่การเขียนจะลงไป
  - *race ที่ยังเหลืออยู่* reader ตัวหนึ่ง miss แล้วอ่านแถวเก่าไป จากนั้น writer commit แล้วลบ key ต่อมา `SET` ที่มาช้าของ reader ก็ใส่ค่าเก่ากลับเข้าไป ช่องนี้แคบแต่มีอยู่จริง วิธีลดผลกระทบ: ตั้ง TTL ให้สั้นพอที่จะจำกัดความเสียหาย ใช้ **versioned key** (`user:42:v8` ที่ได้มาจาก version ของแถว) เพื่อให้ `SET` ข้อมูลเก่าที่มาช้าไปลงที่ key ที่ไม่มี reader ขอแล้ว ใช้ **lease** โดยที่ cache จะปฏิเสธ `SET` ถ้า key โดนลบไปหลังตอน miss ที่ได้ lease นั้นมา (วิธีของ memcache) หรือลบซ้ำอีกรอบหลังเขียนไม่นาน เป็น heuristic ที่ทำได้ถูก ๆ
  - การเขียนที่ไม่ผ่านแอปพลิเคชัน (batch job, service อื่น, การแก้ด้วยมือ) ไม่เคยลบอะไรเลย ให้ใช้ change stream ของ database ผ่าน change data capture มาสั่ง invalidate หรือยอมรับว่าข้อมูลจะ stale ได้นานสุดเท่า TTL
- **Cache stampede หรือที่เรียกว่า thundering herd หรือ dog-piling** พอ key ที่ hot หมดอายุหรือโดนลบ ทุก request ที่เข้ามาพร้อมกันจะ miss พร้อมกันแล้วรัน query เดียวกันหมด วิธีลดผลกระทบ:
  - **Request coalescing:** ให้ request เดียวต่อ key โหลดจาก database ส่วนตัวอื่นรอผลจากมัน ภายใน process เดียวใช้ single-flight ส่วนข้าม process ใช้ lock สั้น ๆ อย่าง `SET lock:user:42 <token> NX PX 3000` แล้ว memcache ของ Facebook ก็ใช้ lease ของมันทำเรื่องนี้ด้วย: server จะแจก lease ได้ไม่เกินหนึ่งอันต่อ key ทุก 10 วินาที ส่วน client อื่นรอสักพักแล้ว retry
  - **Early refresh:** คำนวณ key ที่ hot ใหม่ก่อนมันหมดอายุ จะทำตามรอบเวลา (refresh-ahead) หรือทำตามความน่าจะเป็นที่สูงขึ้นเรื่อย ๆ เมื่อใกล้หมดอายุ (XFetch) ก็ได้
  - **Serve stale while revalidating:** soft TTL เป็นตัวสั่ง refresh ส่วน hard TTL ที่ยาวกว่าจะเก็บค่าเก่าไว้ให้ใช้ได้จนกว่า refresh จะเสร็จ
  - **Jittered TTLs:** ใส่ความสุ่มเข้าไป (สัก ±10%) เพื่อให้ key ที่เขียนลงไปพร้อมกัน เช่นตอน warm-up ไม่หมดอายุพร้อมกัน
- **Cold start** พอ cache ว่างเปล่า (node ใหม่ การ flush หรือ failover) read ทุกตัวก็จะวิ่งไปที่ database พร้อมกัน ดู *Warming* ด้านล่าง
- **มี dependency ให้ต้องดูแลเพิ่มอีกตัว** ใส่ timeout ให้การเรียก cache และตัดสินใจไว้ก่อนว่าถ้า cache ล่มจะทำยังไง การ fallback ไปที่ database จะใช้ได้ก็ต่อเมื่อ database รับ read load ทั้งหมดได้ไหวสักพัก

## ข้อควรรู้ตอนลงมือทำ

- **เลือก TTL ยังไง** เริ่มจากว่าข้อมูลแต่ละแบบ stale ได้แค่ไหนในมุมธุรกิจ ไม่ใช่เริ่มจาก hit ratio: ข้อมูลที่เปลี่ยนเร็วใช้หลักวินาที reference data ใช้หลักชั่วโมง ตั้ง TTL ไว้เสมอ แม้จะมีการ invalidate แบบ explicit แล้วก็ตาม เพื่อเป็น safety net ให้สิ่งที่การ invalidate พลาดไป TTL ที่ยาวขึ้นทำให้ hit ratio สูงขึ้น แต่ก็ใช้ memory มากขึ้น และความเสียหายตอน invalidate พลาดก็มากขึ้นด้วย ปรับแยกตามประเภท key ไปพร้อมกับดู hit ratio และ eviction
- **Key และ value** ตั้ง namespace ให้ key (`user:42`) ใส่ schema version ไว้ใน key เมื่อ format ที่ cache ไว้เปลี่ยน (`user:v2:42`) เพื่อให้โค้ดเก่ากับใหม่รันคู่กันได้ระหว่าง deploy และเก็บ value ให้เล็ก
- **Warming** ก่อนส่ง traffic ไปที่ cache ใหม่หรือ cache ที่เพิ่งล้างทิ้ง ให้ preload key ที่รู้อยู่แล้วว่า hot (จาก access log หรือการ replay traffic ช่วงหลัง) แล้วค่อย ๆ ย้าย traffic ไป ส่วนอะไรที่ warm-up ตกหล่น cache-aside ก็จะเติมให้เอง
- **Negative caching** เก็บผล "not found" ลง cache ด้วย TTL สั้น ๆ เพื่อไม่ให้การ lookup key ที่ไม่มีอยู่ซ้ำ ๆ วิ่งไปถึง database ทั้งหมด
- **Local cache** ตัว cache ใน process ของแต่ละ instance คือชั้นที่เร็วที่สุด แต่การลบบน instance หนึ่งไม่ไปถึง instance อื่น ทางแก้คือตั้ง TTL ของ local cache ให้สั้น หรือ broadcast การ invalidate เช่นผ่าน pub/sub
- **Eviction** กำหนดขนาด memory ให้พอกับ hot set แล้วเลือก eviction policy ถ้าเป็น Redis หรือ Valkey ที่ใช้เป็น cache โดยเฉพาะ ส่วนใหญ่จะรัน `allkeys-lru` หรือ `allkeys-lfu` ส่วนบนระบบ 64-bit ตัว Redis และ Valkey ที่ self-host เองไม่มี memory limit เป็นค่า default (`maxmemory 0`) เลยไม่มีอะไรโดน evict จนกว่าจะตั้ง `maxmemory` ส่วน policy ตั้งต้นของมันคือ `noeviction` ที่จะคืน error ให้การเขียนทันทีที่ใช้ถึง limit นั้น ฝั่ง Amazon ElastiCache, Azure Managed Redis และ Google Cloud Memorystore ใช้ default เป็น `volatile-lru` ที่ evict เฉพาะ key ที่มี TTL
- **วัดผล** ติดตาม hit ratio, miss latency, eviction และโหลดของ database ถ้า hit ratio ตกลง ก็มักเป็นสัญญาณแรกว่า TTL ไม่ดี มี bug เรื่องตั้งชื่อ key หรือ cache เล็กเกินไป
- **Product และ library** บริการ managed ที่ compatible กับ Redis, Valkey หรือ Memcached (Amazon ElastiCache, Azure Managed Redis, Google Cloud Memorystore) หรือ Redis, Valkey หรือ Memcached ที่ self-host เอง ส่วน library ที่ทำบางส่วนของ pattern นี้ไว้ให้: `@Cacheable` ของ Spring (ใส่ `sync = true` เพื่อ coalesce การโหลดภายใน JVM เดียว) `HybridCache` ของ .NET (coalesce ต่อ instance) และ `singleflight` ของ Go
