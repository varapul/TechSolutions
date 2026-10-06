## ปัญหา

โปรแกรมหาของด้วย key อยู่ตลอดเวลา: หา user จาก ID หา session จาก token นับจำนวนครั้งของคำแต่ละคำ หาชื่อใน symbol table ของ compiler การไล่ดู list ต้องเทียบ key กับทุก entry เป็น O(n) ถ้าเก็บ entry ไว้แบบเรียงแล้วก็ใช้ [binary search](../binary-search/) ได้ใน O(log n) แต่การ insert ทุกครั้งต้องเลื่อน entry เพื่อรักษาลำดับ ส่วน hash table ข้ามการค้นหาไปเลย: **hash function** เปลี่ยน key ให้เป็น index ของ array การหา entry เลยเสียต้นทุนพอ ๆ กัน ไม่ว่าจะมีสิบ key หรือสิบล้าน key นี่คือเหตุผลที่ภาษาหลัก ๆ ใช้มันเป็น map และ set ตั้งต้น: `dict` กับ `set` ใน Python, `HashMap` กับ `HashSet` ใน Java และ Rust, `map` ใน Go

## ทำงานยังไง

hash table คือ array ของ **bucket** จำนวน `m` ช่อง ถ้าจะเก็บ key กับ value ของมัน:

1. คำนวณ `hash(key)` คือตัวเลขขนาดคงที่ที่ได้จาก byte ของ key
2. ย่อมันให้เหลือเป็น index ของ bucket ในที่นี้ใช้ `hash mod m`
3. ใส่ entry ทั้ง key และ value ไว้ด้วยกันใน bucket นั้น ถ้ามี key นี้อยู่แล้ว ก็แทนที่ value ของมันแทน

lookup ทำขั้น 1 กับ 2 ซ้ำ แล้วค้นหาแค่ใน bucket นั้น key ที่ต่างกันอาจตกที่ bucket เดียวกันได้ (เรียกว่า **collision** เหมือน alice กับ dave ในขั้นที่ 2) bucket เลยต้องเทียบ key ที่เก็บไว้กับ key ที่ถูกขอ ตัว hash แค่ช่วยแคบการค้นหาลง ส่วนการเท่ากันของ key คือตัวตัดสิน

### Hash function

hash function ของ table ต้อง **deterministic** (key เดิมได้ hash เดิมเสมอ อย่างน้อยก็ภายใน process เดียว) ต้อง **เร็ว** และต้อง **กระจายดี**: key ที่คล้ายกันอย่าง `user1` กับ `user2` ควรได้ hash ที่ไม่เกี่ยวกันเลย จะได้ไม่ไปเบียดกันอยู่ใน bucket เดียวกัน

- **Hash แบบ non-cryptographic** อย่าง FNV-1a ที่ใช้ใน diagram เสียแค่ไม่กี่ instruction ต่อ byte ตัว FNV-1a เริ่มจาก offset basis ค่าคงที่ (`0x811C9DC5` สำหรับ 32 bit) และในแต่ละ byte จะ XOR byte นั้นเข้าไปใน hash แล้วคูณด้วย FNV prime (16,777,619) โดยเก็บไว้แค่ 32 bit ส่วน spec ของมันกลายเป็น [RFC 9923](https://www.rfc-editor.org/rfc/rfc9923.html) ในเดือนกุมภาพันธ์ 2026 เป็น Informational RFC บน Independent Submission stream พอไม่มีความลับอยู่ในนั้น ใครก็คำนวณ collision แบบ offline ได้ ตัว RFC เองก็ชี้ความเสี่ยงนี้ไว้: key ห้าตัวในขั้นที่ 4 ใช้เวลาค้นหาแค่ไม่กี่วินาทีบน laptop
- **Keyed hash** ผสม secret key เข้าไปในผลลัพธ์ ผู้โจมตีที่ไม่รู้ key เลยเดาไม่ได้ว่า input ไหนจะชนกัน SipHash ที่ Jean-Philippe Aumasson กับ Daniel J. Bernstein ตีพิมพ์ในปี 2012 ในฐานะ pseudorandom function ที่เร็วสำหรับ input สั้น ๆ คือตัวเลือกปกติ: Python ใช้มัน hash `str` กับ `bytes` ภายใต้ key สุ่มที่เลือกใหม่ทุก process และ `HashMap` ของ Rust ใช้ SipHash 1-3 กับ seed แบบสุ่ม
- **Cryptographic hash** อย่าง SHA-256 แทบไม่มีใครใช้กับ table เพราะขั้น setup กับ finalization ของมันกินต้นทุนส่วนใหญ่ตอน hash key สั้น ๆ นี่คือเหตุผลที่ [PEP 456](https://peps.python.org/pep-0456/) ตัดมันทิ้งสำหรับ Python และถ้าไม่มีความลับ มันก็กัน flooding ไม่ได้ด้วย: table ใช้แค่ไม่กี่ bit ล่างของ hash ผู้โจมตีเลยยังค้นหา key ที่มี bit เหล่านั้นตรงกันแบบ offline ได้อยู่ดี

### จาก hash ไป bucket

`hash mod m` คือวิธีย่อที่ง่ายที่สุด ถ้า `m` เป็นกำลังของสอง อย่างใน `HashMap` ของ Java และ `dict` ของ CPython ค่า `hash mod m` จะเท่ากับ `hash & (m - 1)` คือ AND ครั้งเดียวที่เก็บ bit ล่างไว้ เลขฐานสิบหกทำให้เห็นเรื่องนี้ง่าย: หลักสุดท้ายของ hash ในฐานสิบหก*ก็คือ* hash mod 16 และ bit ล่างสาม bit ของหลักนั้นก็คือ hash mod 8 ตัว alice (`0x872213E7`) กับ dave (`0xD06CC5DF`) ลงท้ายด้วย `7` กับ `F` ที่มี bit ล่างสาม bit ตรงกัน ถ้ามี 8 bucket ทั้งคู่ก็ไปที่ bucket 7 แต่ถ้ามี 16 bucket ตัว bit ที่สี่จะแยกมันออกเป็น 7 กับ 15 นี่คือเหตุผลที่การ resize ในขั้นที่ 3 แยกแต่ละ chain ออกเป็นสอง: ทุก entry จะอยู่ที่ index `i` เหมือนเดิม หรือย้ายไปที่ `i + 8` ส่วน `HashMap` ของ Java ก็อาศัยข้อเท็จจริงเดียวกันนี้ตอนขยายสองเท่า โดยแยกแต่ละ bucket เป็น entry ที่อยู่ที่เดิม กับ entry ที่ย้ายขึ้นไปเท่ากับ capacity เดิม

การ mask ใช้ได้ก็ต่อเมื่อ bit ล่างผสมกันดี เพราะ hash ที่ต่างกันแค่ bit บนจะชนกันหมด `HashMap` ของ Java เลย XOR 16 bit บนของ `hashCode()` เข้าไปใน 16 bit ล่าง (`h ^ (h >>> 16)`) ก่อน mask และมันเริ่มที่ 16 bucket ส่วน diagram เริ่มที่ 8 เพื่อให้เล็ก ฝั่ง CPython ไปอีกทาง: hash ของ integer ใน CPython สม่ำเสมอมาก มันเลยเริ่มจาก bit ล่าง แล้วปล่อยให้ probe sequence ดึง bit ที่เหลือของ hash เข้ามา ส่วน table ที่มีจำนวน bucket เป็นจำนวนเฉพาะและใช้ `mod` จริง ๆ (ตัวเลือกตามตำราของ modular hashing) ทนต่อ bit ล่างที่อ่อนได้ดีกว่า แต่ต้องเสียค่าการหาร

### Collision: chaining หรือ open addressing

**Separate chaining** วิธีที่ใช้ใน diagram จะเก็บ list ไว้หนึ่งอันต่อ bucket แล้วต่อ entry ที่ชนกันไว้ท้าย list และ `HashMap` ของ Java ก็ทำงานแบบนี้ ถ้า hash ดี chain ก็จะสั้น: source ของ `HashMap` ประเมินว่า ถ้า hash code สุ่มและใช้ load factor ค่า default เกือบ 99% ของ bucket จะมี entry ไม่เกินสองตัว

**Open addressing** เก็บทุก entry ไว้ใน array เลย และเมื่อชนกัน ก็ probe ช่องอื่นตามลำดับที่กำหนดไว้ จนกว่าจะเจอ key หรือเจอช่องว่าง:

- **Linear probing** ลองช่องถัดไป แล้วก็ช่องถัดไปอีก มันเป็นมิตรกับ cache แต่ช่องที่มีของจะจับกลุ่มกันเป็นแถวยาว ทำให้ probe ยาวขึ้นเมื่อ table เต็มขึ้น
- **Robin Hood hashing** เพิ่มกฎหนึ่งข้อให้ linear probing: เมื่อ key ที่กำลัง insert เจอช่องที่มีของแล้ว key ตัวไหนในสองตัวที่เดินทางห่างจากช่องบ้านของมันมากกว่าจะได้ช่องนั้น อีกตัวก็เดินต่อไป ความยาวของ probe เลยเฉลี่ยกันมากขึ้น
- **Swiss table** เก็บ metadata หนึ่ง byte ต่อช่อง ที่ถือ 7 bit ของ hash กับ control bit หนึ่งตัว และตรวจทั้งกลุ่มของช่องในขั้นเดียว (Abseil ใช้คำสั่ง SSE) lookup เลยแทบไม่ต้องเทียบ key ที่ไม่ตรงเลย Google นำเสนอการออกแบบนี้ในปี 2017 และเปิด source ไว้ใน Abseil C++ library ในปี 2018 ส่วน `HashMap` ของ Rust ใช้ตัวที่ port มา (crate hashbrown) ตั้งแต่ Rust 1.36 และ map ที่ติดมากับ Go ก็เปลี่ยนมาใช้ใน Go 1.24

การลบต้องระวังเมื่อใช้ open addressing ถ้าทำให้ช่องว่างไปเลย จะตัดเส้นทาง probe ไปหา key ที่เก็บอยู่เลยช่องนั้นไป เลยต้อง mark ช่องนั้นว่าถูกลบแทน: เรียกว่า **tombstone** ที่ lookup จะข้ามไป และ insert เอาไปใช้ซ้ำได้ `dict` ของ CPython เรียกมันว่า dummy entry ส่วน Swiss table mark มันด้วย control byte แบบ "deleted" แล้ว tombstone ก็ทำให้ probe ยาวขึ้นเรื่อย ๆ จนกว่าการ resize จะเคลียร์มันทิ้ง

`dict` ของ CPython ใช้ open addressing กับ probe sequence แบบ perturbed (`j = 5j + 1 + perturb` โดย `perturb` เริ่มจาก hash เต็ม ๆ แล้วเสียไป 5 bit ทุกขั้น) สุดท้ายแล้วทุก bit ของ hash ก็ได้มีส่วนกำหนดทางของ probe ตั้งแต่ 3.6 มันเก็บ entry ไว้ใน array แบบแน่นตามลำดับการ insert อยู่หลัง index table แบบ sparse และลำดับการ insert ก็กลายเป็นสิ่งที่ภาษารับประกันใน Python 3.7

### Load factor และการ resize

**load factor** คือจำนวน entry หารด้วยจำนวน bucket ถ้าใช้ chaining มันก็คือความยาวเฉลี่ยของ chain และต้นทุนที่คาดหวังของ lookup ก็โตตามมัน table เลยตั้งเพดานไว้ และขยายตัวเมื่อเกินเพดาน `HashMap` ของ Java จะ rehash ไปยัง bucket ที่มากขึ้นราวสองเท่าเมื่อจำนวน entry เกิน capacity × load factor (ค่า default คือ 0.75): 16 bucket รับได้ 12 entry และตัวที่ 13 จะทำให้ขยายเป็น 32 ส่วน diagram ใช้กฎเดียวกันกับ 8 bucket ทำให้ entry ตัวที่ 7 เป็นตัวที่ทำให้ขยาย ฝั่ง `dict` ของ CPython รักษา index table ไว้ให้เต็มไม่เกินสองในสาม ส่วน Swiss table รันได้เต็มกว่านั้นเพราะ probe ของมันต้นทุนต่ำ

การ resize จะ allocate array ใหม่แล้ว insert ทุก entry ใหม่: O(n) การขยายเป็นสองเท่าทำให้ resize นาน ๆ ครั้ง หลังขยายเป็น `2m` bucket แล้ว table จะรับ entry ได้อีกราว `0.75m` ตัวก่อนจะ resize ครั้งถัดไป การก็อปทั้งหมดสำหรับการ insert `n` ครั้งเลยรวมแล้วย้าย entry น้อยกว่า `2n` ครั้ง และการ insert แต่ละครั้งก็เสีย **O(1) amortized** ราคาที่ต้องจ่ายคือการ insert ที่ช้าเป็นบางครั้ง ถ้ารู้ขนาดสุดท้ายอยู่แล้ว ให้กำหนดขนาด table ไว้ก่อน: `HashMap.newHashMap(n)` ของ Java (Java 19 ขึ้นไป) ตั้งขนาด table ให้ใส่ `n` mapping ได้โดยไม่ต้อง resize และ `HashMap::with_capacity(n)` ของ Rust ถือ entry ได้อย่างน้อย `n` ตัวโดยไม่ต้อง allocate ใหม่

### สัญญาของการ hash

hash table พึ่งกฎสองข้อที่ type ของ key ต้องทำตาม:

- **key ที่เท่ากันต้องมี hash เท่ากัน** ไม่อย่างนั้น key ที่เท่ากันสองตัวจะตกคนละ bucket แล้ว table ก็เก็บไว้ทั้งคู่ glossary ของ Python และ `Object.hashCode` ของ Java ต่างก็บังคับข้อนี้ แต่กลับด้านไม่ได้บังคับ นี่คือเหตุผลที่ lookup ยังต้องเทียบ key ส่วน Python ใช้กฎนี้ข้าม type ด้วย: `1`, `1.0` และ `True` เทียบแล้วเท่ากัน ได้ hash เดียวกัน และชี้ไปที่ entry เดียวกันใน `dict`
- **hash ของ key ต้องไม่เปลี่ยนระหว่างที่มันอยู่ใน table** ถ้าแก้ key หลัง insert ไปแล้ว hash ของมันก็เปลี่ยน ทำให้ lookup ไปค้นผิด bucket และ entry นั้นก็เหมือนหายไป นี่คือเหตุผลที่ container แบบ mutable ที่ติดมากับ Python (`list`, `dict`, `set`) hash ไม่ได้ ขณะที่ tuple ของของที่ hash ได้ก็ hash ได้ และเป็นเหตุผลที่เอกสารของ `Map` ใน Java เตือนเรื่อง key ที่ mutable

สำหรับ type ของ key ที่เขียนเอง ให้สร้างทั้งการเทียบเท่ากันและ hash จาก field ชุดเดียวกันที่ immutable: `@dataclass(frozen=True)` ของ Python และ `record` ของ Java สร้างทั้งสองอย่างให้เอง

### Hash flooding

การ insert ทุกครั้งต้องไล่ chain ของ bucket เพื่อหา key ที่มีอยู่แล้ว ถ้าผู้โจมตีเลือก key ที่ชนกันหมดได้ การ insert `n` ครั้งจะเสียการเทียบ key 0 + 1 + … + (n − 1) ครั้ง คือ O(n²): 10 ครั้งสำหรับ key ห้าตัวในขั้นที่ 4 และราว 50 ล้านครั้งสำหรับ 10,000 ตัว Scott Crosby กับ Dan Wallach สาธิตการโจมตีแบบนี้ไว้ในปี 2003 กับ Perl สองเวอร์ชัน, web proxy อย่าง Squid และระบบตรวจจับการบุกรุกอย่าง Bro วันที่ 28 ธันวาคม 2011 ในงาน 28th Chaos Communication Congress ตัว Alexander Klink กับ Julian Wälde แสดงให้เห็นว่า web platform parse parameter ของ request ลงใน hash table ที่ใช้ hash function ที่เดาได้ แค่ POST request เดียวที่อัดชื่อ parameter ที่ชนกันไว้เต็มเลยทำให้ CPU ยุ่งอยู่ได้เป็นนาทีหรือเป็นชั่วโมง advisory [oCERT-2011-003](https://ocert.org/advisories/ocert-2011-003.html) ที่ออกวันเดียวกันระบุ Java, JRuby, PHP, Python, Rubinius และ Ruby รวมถึง server อย่าง Apache Tomcat, Jetty และ GlassFish, interface ของ Rack และ V8 JavaScript engine

ทางแก้มาเป็นสามชั้น ตรงกับป้ายการป้องกันในขั้นที่ 4:

- **จำกัด input** ตัว framework จำกัดจำนวน parameter ที่ request หนึ่งมีได้ `max_input_vars` ของ PHP ที่ค่า default คือ 1000 มีไว้เพื่อกันการโจมตีนี้โดยตรง
- **ซ่อน hash** สุ่ม hash ต่อ process เพื่อไม่ให้คำนวณ collision ไว้ล่วงหน้าได้ ตอนแรก Python ใส่ salt ให้ string hash แบบ FNV ของมันด้วย prefix กับ suffix แบบสุ่ม (เปิดเป็นค่า default ตั้งแต่ 3.3) แต่ Aumasson กับ Bernstein แสดงให้เห็นว่ากู้ความลับนั้นคืนมาได้ PEP 456 เลยย้าย `str` กับ `bytes` ไปใช้ SipHash ใน Python 3.4 และ Python 3.11 ก็เปลี่ยนไปใช้ SipHash-1-3 ที่เร็วกว่า
- **จำกัดความเสียหาย** ตั้งแต่ Java 8 ([JEP 180](https://openjdk.org/jeps/180)) bucket ของ `HashMap` ที่โตเกิน 8 entry จะกลายเป็น balanced tree ที่เรียงตาม hash และสำหรับ key ที่เป็น `Comparable` อย่าง `String` ก็เรียงตาม `compareTo` ด้วย ทำให้ worst case ต่อ lookup ลดจาก O(n) เป็น O(log n) ส่วน table ที่มีน้อยกว่า 64 bucket จะ resize แทน และเพราะ `String.hashCode()` เป็นสูตรตายตัวที่เขียนไว้ในเอกสาร ตัว Java เลยพึ่ง tree แทนที่จะพึ่งความลับ

### Set และ ordered map

hash set คือ hash table ของ key ที่ไม่มี value เพราะแบบนี้ `set` กับ `frozenset` ของ Python ถึงต้องการสมาชิกที่ hash ได้ และ `HashSet` ของ Java ก็อยู่บน `HashMap` การเพิ่ม การลบ และการตรวจว่าเป็นสมาชิกหรือไม่ เสีย O(1) โดยเฉลี่ยเหมือนใน map

hash table ไม่มีลำดับที่มีประโยชน์ให้: `HashMap` ของ Java ไม่สัญญาลำดับอะไรเลย และ `dict` ของ Python จำลำดับการ insert แต่ไม่ได้เรียงให้ ถ้าต้องการ key ตามลำดับที่เรียงแล้ว, range query ("ทุก key ตั้งแต่ `carol` ถึง `frank`") หรือ key ที่ใกล้ที่สุดที่อยู่เหนือหรือใต้ค่าหนึ่ง ให้ใช้ ordered map: [binary search tree](../binary-search-tree/) แบบ balanced อย่าง `TreeMap` ของ Java (red-black tree ที่รับประกัน operation O(log n)) หรือ B-tree ใน database ตัวอย่างเช่น hash index ของ PostgreSQL รองรับแค่ `=` เงื่อนไขแบบช่วงเลยต้องใช้ B-tree index

### เมื่อ hashing ไปถึงระดับ architecture

- **Shard และ cache cluster** การกระจาย key ไปบน server `N` ตัวด้วย `hash(key) mod N` ก็คือการย่อแบบเดียวกัน และมีจุดอ่อนเดียวกับที่เห็นในขั้นที่ 3: ถ้าเปลี่ยน `N` ก็จะมี key จำนวนมากที่ต้องย้าย ภายใน hash table นั่นเป็นแค่การก็อป memory เร็ว ๆ แต่ข้าม server มันหมายถึงการย้ายข้อมูล ทำให้ database ที่ shard แล้วและ cache cluster ใช้ consistent hashing, rendezvous hashing หรือ slot ชุดตายตัว ตัวอย่างเช่น Redis Cluster map แต่ละ key ไปที่หนึ่งใน 16,384 slot ด้วย `CRC16(key) mod 16384` แล้วย้ายทั้ง slot ระหว่าง node ดู [Sharding](../sharding/) และ [Cache-Aside](../cache-aside/)
- **Rendezvous hashing** (highest random weight) ให้คะแนน server ทุกตัวด้วย hash ของ key กับ ID ของ server แล้วเลือกตัวที่ได้สูงสุด เมื่อ server ตัวหนึ่งออกไป ก็มีแค่ key ของมันที่ย้าย แต่ละ key ไปที่ server ที่ได้คะแนนสูงรองลงมา เครือข่าย EVPN ใช้มันเลือก designated forwarder ([RFC 8584](https://www.rfc-editor.org/rfc/rfc8584.html))
- **Bloom filter** จะ set bit ไม่กี่ตัวใน bit array ให้กับแต่ละ key โดยเลือก bit ด้วย hash function หลายตัว ถ้ามี bit ตัวไหนของ key ที่ยังเป็น 0 ก็แปลว่า key นั้นไม่มีอยู่แน่นอน ทำให้ [RocksDB](https://github.com/facebook/rocksdb/wiki/RocksDB-Bloom-Filter) ข้าม SST file ที่ไม่มีทางมี key นั้นได้
- **Content addressing** ตั้งชื่อข้อมูลด้วย cryptographic hash ของ byte ของมัน [Git](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects) เก็บทุก object ไว้ภายใต้ SHA-1 ของเนื้อหา หรือ SHA-256 ใน repository ที่สร้างด้วย `--object-format=sha256` เนื้อหาที่เหมือนกันเลยถูกเก็บครั้งเดียว และการเปลี่ยนอะไรก็ตามก็ได้ชื่อใหม่ ตรงนี้ความทนต่อ collision สำคัญกว่าความเร็ว กลับด้านกับที่ hash table แลกกัน

## โค้ด

hash map แบบ chaining ที่ใช้ `hash()` ที่ติดมากับ Python โดยสร้างแบบเดียวกับ table ใน diagram: เริ่มที่ 8 bucket, ต่อ entry ใหม่ไว้ท้าย chain และขยายสองเท่าเมื่อจำนวน entry เกิน 0.75 × bucket

```python
class HashMap:
    """Separate chaining: each bucket is a list of (key, value) pairs."""

    def __init__(self, buckets=8):
        self.buckets = [[] for _ in range(buckets)]
        self.size = 0

    def _chain(self, key):
        return self.buckets[hash(key) % len(self.buckets)]

    def get(self, key, default=None):
        for k, v in self._chain(key):
            if k == key:                  # same bucket is not enough: compare keys
                return v
        return default

    def put(self, key, value):
        chain = self._chain(key)
        for i, (k, _) in enumerate(chain):
            if k == key:
                chain[i] = (key, value)   # existing key: replace the value
                return
        chain.append((key, value))
        self.size += 1
        if self.size > 0.75 * len(self.buckets):
            self._resize(2 * len(self.buckets))

    def delete(self, key):
        chain = self._chain(key)
        for i, (k, _) in enumerate(chain):
            if k == key:
                del chain[i]
                self.size -= 1
                return True
        return False

    def _resize(self, n):
        old, self.buckets = self.buckets, [[] for _ in range(n)]
        for chain in old:                 # rehash every entry into the new array
            for k, v in chain:
                self._chain(k).append((k, v))


m = HashMap()
for key, value in [("alice", 31), ("bob", 27), ("carol", 45), ("dave", 38),
                   ("erin", 29), ("frank", 52), ("grace", 41)]:
    m.put(key, value)
print(m.get("dave"), m.size, len(m.buckets))   # 38 7 16
m.delete("bob")
print(m.get("bob"), m.size)                     # None 6
```

class นี้ตรวจเทียบกับ `dict` บนการรันแบบสุ่ม 300 รอบ ที่มีทั้ง put, get และ delete บน key แบบ integer และ string (รวมการ resize ภายใต้ hash seed หลายค่า) บวกกับ map ว่าง, key ตัวเดียว, การแทนที่ value, การลบ key ที่ไม่มีอยู่, `1`, `1.0` และ `True` ในฐานะ key เดียวกัน และ `-1` กับ `-2` ที่มี hash เดียวกันใน CPython ส่วน Python ใส่ salt ให้ string hash ต่อ process ตัว bucket เลยต่างกันไปในแต่ละรอบ แต่ผลลัพธ์ไม่ต่าง

การรันใน diagram คือ class เดียวกันนี้ที่ใช้ FNV-1a แทน `hash()`:

```python
def fnv1a_32(key):
    h = 0x811C9DC5                          # 32-bit offset basis
    for byte in key.encode("utf-8"):
        h ^= byte                           # mix in the next byte,
        h = (h * 0x01000193) & 0xFFFFFFFF   # multiply by the FNV prime, keep 32 bits
    return h

for key in ["alice", "bob", "carol", "dave", "erin", "frank", "grace"]:
    h = fnv1a_32(key)
    print(f"{key:<6} 0x{h:08X}  mod 8 = {h % 8}  mod 16 = {h % 16}")
print({f"0x{fnv1a_32(k):08X}" for k in ["hbM9J", "wmEna", "wA2zj", "HLqZ9", "S6VAj"]})
# alice  0x872213E7  mod 8 = 7  mod 16 = 7
# bob    0x86C6A0D4  mod 8 = 4  mod 16 = 4
# carol  0x67088F12  mod 8 = 2  mod 16 = 2
# dave   0xD06CC5DF  mod 8 = 7  mod 16 = 15
# erin   0x36AD59F9  mod 8 = 1  mod 16 = 9
# frank  0xF40CE5C3  mod 8 = 3  mod 16 = 3
# grace  0x9C487A6B  mod 8 = 3  mod 16 = 11
# {'0x91AB64A5'}
```

บรรทัดสุดท้ายคือขั้นที่ 4: key ห้าตัวที่ต่างกัน ได้ hash เดียวกัน

## Complexity

| | ต้นทุน | ทำไม |
|---|---|---|
| Best time | O(1) | bucket ของ key ว่างหรือมีแค่ key นั้น: hash ครั้งเดียวและเทียบไม่เกินหนึ่งครั้ง |
| Average time | O(1) | ถ้า hash กระจายดีและ load factor ถูกจำกัดไว้ที่ 0.75 แต่ละ chain จะมี entry ไม่ถึงหนึ่งตัวโดยเฉลี่ย `get`, `put` และ `delete` เลย hash ครั้งเดียวและเทียบ key จำนวนคงที่ |
| Worst time | O(n) | key ทุกตัวอยู่ใน bucket เดียว: ทุก operation ไล่ทั้ง chain และการ insert n ครั้งเสีย O(n²) (ขั้นที่ 4) tree bin ของ Java ลด lookup เหลือ O(log n) สำหรับ key ที่เทียบลำดับได้ |
| Resize | O(n), O(1) amortized | การ resize ก็อปทุก entry แต่การขยายสองเท่าทำให้ยอดรวมย้ายน้อยกว่า 2n ครั้งสำหรับการ insert n ครั้ง |
| พื้นที่เพิ่ม | O(n) | array ของ bucket (อย่างน้อย n / 0.75 ช่อง) บวกกับ entry ใน list หนึ่งตัวต่อหนึ่ง key |

เรื่อง stable กับ in place ใช้กับ map ไม่ได้ โดยทั่วไปลำดับการวนไม่ได้รับประกัน: มันตามลำดับของ bucket เลยขึ้นกับค่า hash และเปลี่ยนหลัง resize ส่วน `dict` ของ Python เป็นข้อยกเว้น เพราะมันวนตามลำดับการ insert

## ใช้ตอนไหนดี

- lookup, insert และ delete ด้วย key แบบตรงตัวเมื่อไม่สนลำดับ: index กับ cache ใน memory, การนับและการจัดกลุ่ม, การตัดของซ้ำ, memoization
- การตรวจความเป็นสมาชิก แบบ set: "เคยเห็น ID นี้มาก่อนไหม?"
- การ join สอง collection ด้วย key ใน memory: สร้าง table จากตัวที่เล็กกว่า แล้ว probe มันด้วยของแต่ละชิ้นของตัวที่ใหญ่กว่า
- ไม่ใช่สำหรับ output ที่เรียงแล้ว, การหาตามช่วง หรือ query หา key ที่ใกล้ที่สุด (ใช้ ordered map หรือ B-tree) ไม่ใช่ตอนที่ key เป็น integer เล็ก ๆ ที่เรียงติดกันแน่น (ใช้เป็น index ของ array ตรง ๆ) และไม่ใช่สำหรับ key ที่ผู้โจมตีควบคุมได้ เว้นแต่ hash จะเป็นแบบ keyed หรือ table จำกัดความยาวของ chain ไว้

## ได้อะไร เสียอะไร

- **เป็นค่าเฉลี่ย ไม่ใช่การรับประกัน** O(1) ขึ้นกับ hash ที่กระจายดีและ load factor ที่ถูกจำกัดไว้ hash ที่ไม่ดีหรือ key ที่ถูกเลือกมาทำให้มันแย่ลงเป็น O(n) เว้นแต่ table จะป้องกันตัวเอง
- **ใช้ memory แลกความเร็ว** bucket ที่ว่างและ overhead ต่อ entry กินพื้นที่ และ load factor ที่ต่ำกว่าก็แลก memory ที่มากขึ้นกับ chain หรือ probe ที่สั้นลง
- **การ resize ทำให้สะดุด** การ insert ส่วนใหญ่เร็ว แต่ตัวที่ทำให้เกิด resize ต้องก็อปทุกอย่าง ถ้ารู้ขนาดก็กำหนดไว้ก่อน
- **ไม่มีลำดับ** range query และการวนแบบเรียงลำดับต้องใช้โครงสร้างอื่น
- **การ hash ไม่ได้ฟรี** key ยาว ๆ ถูก hash ทุก operation ส่วน key ที่เป็น integer เล็ก ๆ ใช้ array ตรง ๆ จะเร็วกว่า
- **Bug แบบเงียบ** type ของ key ที่การเทียบเท่ากันกับ hash ไม่ตรงกัน หรือ key ที่ถูกแก้แบบ in place ทำให้ entry หายไปโดยไม่มี error ใด ๆ

## ข้อควรรู้ตอนลงมือทำ

| Library | Collision | ค่า default ที่ควรรู้ |
|---|---|---|
| Java `HashMap` | Chaining โดย chain ที่ยาวจะกลายเป็น tree bin แบบ balanced (red-black) | 16 bucket และ load factor 0.75; bucket จะกลายเป็น tree เมื่อเกิน 8 entry ใน table ที่มีอย่างน้อย 64 bucket; ผสม `h ^ (h >>> 16)` ก่อน mask; ไม่ synchronized |
| Python `dict` | Open addressing, probing แบบ perturbed | รับประกันลำดับการ insert ตั้งแต่ 3.7; index table เต็มไม่เกินสองในสาม; `str` กับ `bytes` hash ด้วย SipHash-1-3 ภายใต้ key สุ่มต่อ process |
| Go `map` | Swiss table ตั้งแต่ Go 1.24 | ลำดับการวนไม่ได้กำหนดไว้ และอาจต่างกันในแต่ละ loop |
| Rust `HashMap` | Swiss table (port จาก hashbrown) | SipHash 1-3 ที่ seed แบบสุ่ม; เสียบ hasher ตัวอื่นแยกต่อ map ได้ |
| Abseil `absl::flat_hash_map` (C++) | Swiss table | การออกแบบต้นฉบับที่เวอร์ชันของ Rust และ Go ทำตาม |

- **เลือก hasher ตาม threat model** ถ้า key มาจากข้างนอก (HTTP parameter, ชื่อ field ใน JSON, input ของ user) ให้ใช้ keyed hash หรือ table ที่จำกัดความยาวของ chain และจำกัดขนาดของ request ด้วย ส่วน key แบบ integer ที่ไว้ใจได้บน hot path จะใช้ hasher แบบไม่มี key ที่เร็วกว่าก็ได้
- **ใช้ `hash()` แค่ภายใน process** เพราะ string hash ของ Python เปลี่ยนไปในแต่ละรอบที่รัน (ตั้ง `PYTHONHASHSEED` เป็น integer ถ้าต้องการรันซ้ำให้เหมือนเดิมตอน debug) อย่าเก็บมันไว้ หรือเอาไปใช้เลือก shard หรือ cache node ส่วนอะไรก็ตามที่ข้าม process ให้ใช้ hash ที่คงที่และมีเอกสารกำกับ แบบที่ Redis Cluster ใช้ CRC16
- **อย่าพึ่งลำดับการวน** ของ `HashMap` ใน Java, map ใน Go หรือ set ใน Python ถ้าลำดับสำคัญให้ sort ก่อน เช่นใน test, log และ diff
- **กำหนดขนาด table ใหญ่ ๆ ไว้ก่อน** และสร้างมันครั้งเดียวถ้าทำได้ เพื่อเลี่ยงการ resize ซ้ำ ๆ
- **hash แต่ละแบบเหมาะกับงานต่างกัน** table ต้องการความเร็วบวกกับความลับ (SipHash) shard ต้องการความคงที่ข้ามเครื่อง (CRC16, consistent hashing หรือ rendezvous hashing) และ content addressing ต้องการความทนต่อ collision (SHA-256)
