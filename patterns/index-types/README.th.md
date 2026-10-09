## ปัญหา

developer ของ Acme Shop ให้ทุก column ที่ใช้ค้นหามี index แบบที่ `CREATE INDEX` สร้างให้เป็น default: B-tree แล้ว query สี่ตัวนี้ก็แสดงให้เห็นว่ามันพลาดตรงไหน โดยวัดบน PostgreSQL 18.6 กับข้อมูลตัวอย่างของร้าน (order 500,000 ตัว, customer 100,000 คน, order event 1,500,000 ตัว, product 10,000 ตัว):

- **คิวของ order ที่ยังเปิดอยู่** ขอ order ที่เก่าที่สุด 20 ตัวที่มี status เป็น `pending`, `paid` หรือ `shipped` คือ 3,000 จาก 500,000 ตัว ถึง B-tree บน `status` จะตอบได้ แต่ index มีขนาด 3,464 kB เก็บ pointer ไปที่ order ที่ delivered และ cancelled แล้วทั้ง 497,000 ตัวที่ไม่มีใครมา lookup และคืน order ที่เปิดอยู่เรียงตาม status ทำให้ PostgreSQL ต้องดึงมาทั้ง 3,000 ตัว (2,652 buffer) แล้ว sort เพื่อเก็บไว้แค่ 20 ตัว
- **login ด้วย email** เทียบ `lower(email)` กับ `lower('Customer42@Example.com')` ทำให้ไม่ว่า customer จะพิมพ์ address ยังไงก็ได้ผลเหมือนกัน แต่ unique index บน `email` สร้างจาก expression คนละตัวเลยใช้ไม่ได้: sequential scan ต้องอ่าน `customers` ครบทั้ง 1,136 page แล้วทิ้งไป 99,999 row (76 ms)
- **order event ของหนึ่งวัน** เร็วถ้ามี B-tree บน `happened_at` (27 buffer) แต่ index ตัวนั้นกินที่ 32 MB คิดเป็น 37% ของ table ขนาด 86 MB และทุก event ใหม่ต้องถูก insert เข้าไปในมันด้วย
- **product ตาม attribute** เก็บสีและไซซ์ไว้ใน `jsonb` column ชื่อ `attrs` แล้วถามหา `attrs @> '{"colour": "red", "size": 42}'` ตัว B-tree บน `attrs` (448 kB) เรียงทั้ง document และไม่มี operator สำหรับ containment ทำให้ต้องเช็ค product ทั้ง 10,000 ตัวเพื่อหาแค่ 8 ตัว

B-tree เป็น default ที่ถูกแล้ว และหน้า [B-Tree Index](../b-tree-index/) ก็อธิบายว่าทำไม หน้านี้จะพูดถึง index แบบอื่น ๆ ใน PostgreSQL และสองวิธีที่ทำให้ index แบบไหนก็ได้เข้ากับ query ของมัน: predicate และ expression

## ทำงานยังไง

PostgreSQL 18 มี index method หกแบบ: B-tree, hash, GiST, SP-GiST, GIN และ BRIN แล้วยังมี `bloom` ที่เป็น extension อีกตัว แต่ละแบบใช้กับชุด operator ของตัวเอง โดยมี **operator class** ของแต่ละ column ที่ทำ index เป็นตัวกำหนดว่าชุดไหน มีสอง feature ที่ใช้กับแทบทุกแบบได้: `WHERE` clause ทำให้ index เป็น **partial** และการใส่ expression แทน column ทำให้มันเป็น **expression index**

ตัวเลขในหน้านี้มาจาก `EXPLAIN (ANALYZE, BUFFERS)`, `pageinspect` และ `pgstattuple` ที่รันครั้งเดียวบน laptop กับสำเนาของข้อมูลตัวอย่าง ขนาดเป็นค่าตามที่ `pg_size_pretty` พิมพ์ออกมา (1 kB = 1,024 byte) ส่วนเวลาถูกปัดเศษ: เวลาเปลี่ยนไปในแต่ละรอบที่รัน แต่ plan กับจำนวน row ไม่เปลี่ยน

### Partial index

```sql
CREATE INDEX orders_open_idx ON orders (created_at)
  WHERE status IN ('pending', 'paid', 'shipped');
```

partial index เก็บ entry แค่ของ row ที่ผ่าน predicate ของมัน order ที่เปิดอยู่ 3,000 ตัวใส่ได้พอดีใน leaf page 9 page ใต้ root page หนึ่ง page: รวม 11 page และ 88 kB เทียบกับ 3,464 kB ของ B-tree บน `status` และเพราะ key ของมันคือ `created_at` มันเลยคืน order ที่เปิดอยู่เรียงตามลำดับในคิวไปด้วย plan เลยเป็น `Limit` ที่ครอบ `Index Scan using orders_open_idx` แล้วหยุดหลังได้ 20 row: 22 buffer และ 0.09 ms โดยไม่ต้อง sort เลย แต่ละ order จะมี entry ก็แค่ตอนที่มันยังเปิดอยู่: row version ที่ถูกเขียนตอนมัน delivered หรือ cancelled จะไม่ได้ entry และ vacuum จะลบ entry เก่าออกไป ส่วนการเขียนลง row ที่ไม่เคยตรง predicate ก็ไม่แตะ index นี้เลย

planner จะใช้ partial index ได้ก็ต่อเมื่อพิสูจน์ได้ตอนวาง plan ว่า `WHERE` ของ query ทำให้ predicate ของ index เป็นจริงด้วย มันจัดการกรณีง่าย ๆ ได้: `status = 'paid'` ทำให้ `IN` list เป็นจริง แล้ว query นั้นก็ใช้ index แต่มันไม่มีตัวพิสูจน์ทฤษฎีแบบทั่วไป ทำให้ `status NOT IN ('delivered', 'cancelled')` ที่เลือก row ชุดเดียวกันเป๊ะ 3,000 row ไม่ถูกจับได้ แล้ว plan ก็ถอยกลับไปเป็น parallel sequential scan ทั้ง 5,058 page (27 ms) ด้วยเหตุผลเดียวกัน parameter ก็ match กับ predicate ไม่ได้: ถ้าตั้ง `plan_cache_mode = force_generic_plan` ตัว prepared `WHERE status = $1` จะได้ sequential scan ส่วนโหมด default `auto` จะวาง plan ห้าครั้งแรกด้วยค่าจริง และยังทำแบบนั้นต่อไปตราบที่ generic plan ดูแพงกว่ามาก ในโหมดนั้นมันเลยใช้ index

**partial unique index** บังคับ uniqueness แค่ในกลุ่ม row ที่ตรงกับมัน เช่น customer หนึ่งคนมี cart ที่เปิดอยู่ได้แค่ใบเดียว เอกสารเตือนไม่ให้ใช้แบบกลับด้าน คือสร้าง partial index หลายตัวที่ไม่ทับกันเพื่อแบ่ง table ใหญ่ตัวเดียว: planner ต้องทดสอบทุกตัวในทุก query และงานแบบนั้นควรใช้ partitioning

### Expression index

```sql
CREATE UNIQUE INDEX customers_lower_email_key ON customers (lower(email));
```

expression index เก็บค่าของ expression แทนที่จะเก็บ column และเพราะ query ตอน login ใช้ expression เดียวกัน planner เลยเห็นเป็นการเทียบค่ากับ index ธรรมดา: root page, inner page และ leaf ที่ `customer42@example.com` ชี้ไปที่ heap tuple `(0,42)` รวมเป็น 4 buffer และ 0.06 ms แทน scan ที่ใช้ 76 ms ตัว index มีขนาดเท่ากับตัวที่อยู่บน `email` เป๊ะ (4,880 kB, 610 page) เพราะเก็บ string ชุดเดียวกัน และพอเป็น `UNIQUE` มันก็ทำสิ่งที่ constraint ธรรมดาทำไม่ได้: insert `Customer42@example.com` แล้วเจอ duplicate-key error

- query ต้องใช้ expression เดียวกัน: `upper(email) = …` หรือ `email ILIKE …` ก็ยัง scan table อยู่ดี
- expression ถูกคำนวณตอน insert row และทุกครั้งที่ update แบบที่ไม่ใช่ HOT ไม่เคยคำนวณตอน search ส่วนทุก function ใน expression ต้องเป็น `IMMUTABLE`
- PostgreSQL เก็บ statistics ของ index expression เหมือนเป็น column หนึ่ง ก่อนมี index ตัว planner เดาว่า `lower(email) = …` ได้ 500 row แต่หลัง `ANALYZE` มันคาดไว้ที่ 1

ตัว key เองก็ทำให้ไม่สนตัวพิมพ์เล็กใหญ่ได้โดยไม่ต้องใช้ expression: ถ้าใช้ ICU ตัว nondeterministic collation อย่าง `und-u-ks-level2` จะทำให้ `=` และ unique index ธรรมดามองว่า `Customer42@Example.com` กับ `customer42@example.com` เท่ากัน และตั้งแต่ PostgreSQL 18 ตัว `LIKE` ก็ใช้กับ collation แบบนี้ได้ด้วย

### Hash index

hash index คือ [hash table](../hash-table/) ที่เก็บไว้ใน index page: มันเก็บ hash code ขนาด 32-bit ของแต่ละ key ทำให้ใช้ได้กับ `=` อย่างเดียว บน `lower(email)` มันกินที่ 4,112 kB (514 page) เทียบกับ 4,880 kB ของ B-tree: code ของ `customer42@example.com` คือ `0x22701379` ที่ตกอยู่ใน bucket 377 จาก 512 แล้ว page ของ bucket นั้นก็มี hash code กับ heap tuple id อยู่ และมี `(0,42)` อยู่ในนั้นด้วย (3 buffer) ตัว hash index เป็น `UNIQUE` ไม่ได้ (PostgreSQL ไม่ยอมสร้างให้) ครอบหลาย column ไม่ได้ และช่วยเรื่อง range, `LIKE 'customer42%'` หรือ `ORDER BY` ไม่ได้ ตั้งแต่ PostgreSQL 10 ตัว hash index ถูกเขียนลง WAL ทำให้รอดตอน crash และไปถึง replica ได้ ก่อนหน้านั้น PostgreSQL เตือนไม่ให้ใช้ ที่ประหยัดได้นั้นมีจริงสำหรับ key ยาว ๆ แต่ B-tree ทำได้ทุกอย่างที่ hash index ทำและมากกว่านั้น hash เลยยังเป็นทางเลือกเฉพาะทาง

### BRIN

block range index เก็บสรุปเล็ก ๆ ไว้สำหรับ heap page ที่อยู่ติดกันแต่ละช่วง ถ้าใช้ `minmax` operator class ที่เป็น default และ `pages_per_range = 128` สรุปที่ได้ก็คือ `happened_at` ที่ต่ำสุดและสูงสุดใน 128 page ทำให้ `order_events` ที่มี 11,030 page ต้องใช้สรุป 87 ชุด ใส่ได้ใน 3 page (24 kB เทียบกับ 32 MB ของ B-tree) เวลาหาข้อมูลหนึ่งวัน PostgreSQL จะเช็คทุกสรุป มีแค่ range 82 (page 10,368 ถึง 10,495, ตั้งแต่ 08-25 16:04 ถึง 09-02 02:21) ที่ทับกับวันนั้น ตัว bitmap เลย mark 128 page นั้นเป็นแบบ lossy แล้ว heap scan ก็อ่านทุก page และ recheck ทุก row: เก็บไว้ 2,341 ทิ้งไป 15,067 ใช้ 136 buffer และ 2.3 ms ในขณะที่ B-tree ใช้ 27 buffer และ 0.8 ms

วิธีนี้ใช้ได้ก็เพราะ table ถูกเก็บเรียงตาม `happened_at` และ `pg_stats.correlation` ก็แสดงค่านี้เป็น 1.00 ส่วน table `orders` ถูกโหลดใน transaction เดียวแต่ไม่ได้เรียงตาม `created_at` และมี correlation 0.22 ตัว BRIN index บน `orders.created_at` ก็เล็กพอ ๆ กัน แต่ range ของมัน 37 จาก 40 ช่วงลากจากปี 2024 หรือ 2025 ไปถึงตุลาคม 2026 ก็เลยทับกับวันนั้น ทำให้ query แบบเดียวกันต้องอ่าน 4,674 จาก 5,058 page และ recheck 461,268 row: 60 ms เทียบกับ 26 ms ของ parallel sequential scan ธรรมดา การ update ที่ย้าย row ไป page อื่นก็ค่อย ๆ ทำให้ลำดับเพี้ยนไปแบบเดียวกันเมื่อเวลาผ่านไป

- page ที่เพิ่มเข้ามาหลังการสรุปครั้งล่าสุดจะยังไม่ถูกสรุป จนกว่า `VACUUM` จะประมวลผล table, มีคนเรียก `brin_summarize_new_values()` หรือ index เปิด `autosummarize` ไว้ (default ไม่ได้เปิด) ระหว่างนั้นทุก query ต้องอ่าน page พวกนี้: หลังเพิ่ม event เข้าไป 40,000 ตัว query หนึ่งวันตัวเดิมอ่าน 316 page แทน 128
- operator class `minmax-multi` และ `bloom` (PostgreSQL 14) เก็บหลายช่วงหรือ Bloom filter ต่อหนึ่ง range สำหรับข้อมูลที่เรียงแค่คร่าว ๆ
- BRIN เป็น summarizing index: ตั้งแต่ PostgreSQL 16 การ update ที่เปลี่ยนแค่ column ที่ทำ BRIN index ไว้ก็ยังเป็น HOT update ได้

### GIN

generalized inverted index เก็บแต่ละ key ไว้ครั้งเดียวพร้อม **posting list**: heap tuple id ของ row ที่มี key นั้นแบบเรียงแล้ว (หรือเป็น posting tree ถ้า list ยาว) ถ้าใช้ operator class `jsonb_path_ops` แต่ละ key คือ hash ของ value กับ path ที่พาไปถึงมัน ทำให้ `{"colour": "red", "size": 42}` ได้ key สองตัว PostgreSQL หาทั้งสองตัว เอาสอง list มาหาส่วนที่ตรงกัน (product สีแดง 1,287 ตัว ไซซ์ 42 อีก 72 ตัว) แล้วได้ tuple id 8 ตัว จากนั้น bitmap heap scan ก็ดึงมา recheck: 13 buffer และ 0.09 ms เทียบกับการ scan 125 page ส่วน product 10,000 ตัวสร้าง key ที่ไม่ซ้ำกันแค่ 18 ตัว ทำให้ index มีขนาด 32 kB (4 page) ส่วน class `jsonb_ops` ที่เป็น default ทำ index ทุก key และทุก value แยกกัน และยังใช้กับ operator เช็คว่ามี key ไหม คือ `?`, `?|` และ `?&` ได้ด้วย บนข้อมูลชุดนี้มันมีขนาด 64 kB ส่วน class built-in ตัวอื่น ๆ ทำ index ให้ array (`@>`, `<@`, `=`, `&&`) และ `tsvector` สำหรับ full-text search (`@@`)

ตอนเขียนคือจุดที่ GIN ต้องจ่าย เพราะ row เดียวเพิ่ม key ได้หลายตัว และ text document หนึ่งชิ้นเพิ่ม key หนึ่งตัวต่อคำที่ไม่ซ้ำ ถ้าเปิด `fastupdate` ไว้ (default) GIN จะต่อ entry ใหม่ไว้ใน **pending list** ที่ไม่ได้เรียง แล้วค่อย merge เข้าโครงสร้างหลักทีหลังทีละเยอะ ๆ: ตอนที่ `VACUUM` หรือ autoanalyze ประมวลผล table, ตอนที่มีคนเรียก `gin_clean_pending_list()` หรือตอนที่ list โตเกิน `gin_pending_list_limit` (default 4 MB) ระหว่างนั้นทุก search ต้องอ่านทั้ง list หลัง insert product เข้าไป 10,000 ตัว ใน list ก็มี 10,000 row ใน 50 page และ search ตัวเดิมอ่าน index page 55 page แทน 5 (63 buffer, 1.5 ms) แต่หลัง `gin_clean_pending_list()` มันอ่านแค่ 6 (14 buffer, 0.2 ms) ให้ปิด `fastupdate` ในที่ที่ search latency ที่นิ่งสำคัญกว่าความเร็วตอน insert และถ้าโหลดข้อมูลก้อนใหญ่ ลองสร้าง index ทีหลังโหลดเสร็จ ส่วน PostgreSQL 18 ก็สร้าง GIN index แบบ parallel ได้

### GiST และ SP-GiST

**GiST** หรือ generalized search tree คือ framework สำหรับ tree แบบ balanced ที่ทุก entry ข้างในครอบทุกอย่างที่อยู่ข้างใต้มัน เช่น bounding box หรือ range ที่ครอบอยู่ ทำให้ search ลงไปแค่ใน subtree ที่มีโอกาสตรง ส่วน operator class ของมันใช้กับ geometric type, range และ multirange (overlap `&&`, containment `@>` และ `<@`), `inet` และ `tsvector` และหลายตัวคืน row เรียงตามระยะทางด้วย `<->` ได้ เอาไว้ทำ nearest-neighbour search ตัว GiST ยังบังคับ exclusion constraint ด้วย: ถ้าใช้ extension `btree_gist` ตัว `EXCLUDE USING gist (courier_id WITH =, slot WITH &&)` บน table ของช่วงเวลาส่งของจะปฏิเสธการจองครั้งที่สองที่ทับกับครั้งแรกของ courier คนเดียวกัน

**SP-GiST** หรือ space-partitioned GiST รองรับ tree ที่แบ่งพื้นที่การค้นหาเป็นส่วน ๆ ซ้ำไปเรื่อย ๆ และไม่ต้อง balanced: quad-tree และ k-d tree สำหรับจุด, radix tree สำหรับ text (รวมถึง prefix operator `^@`) และ class สำหรับ `inet`, range, box และ polygon ตัว class ของ point และ polygon รองรับ nearest-neighbour search: `ORDER BY location <-> point '(100.53,13.74)' LIMIT 5` บน table ของจุดรับของ ได้ plan เป็น index scan ที่มีเงื่อนไข `Order By`

### Extension

- **`pg_trgm`** เพิ่ม operator class ของ GIN และ GiST บน trigram คือชิ้นส่วนสามตัวอักษรของ string ใช้กับ `LIKE` และ `ILIKE` ที่มี wildcard ตรงไหนก็ได้, regular expression, `=` และ similarity search ตัว GIN trigram index บน `customers.email` (3,864 kB) ตอบ `email LIKE '%4242%'` ได้ด้วย 26 buffer ใน 0.16 ms ในขณะที่ scan ต้องอ่าน 1,136 page ใน 16 ms ส่วน pattern ที่ดึง trigram ออกมาไม่ได้เลยจะถอยกลับไปเป็น full index scan
- **`btree_gin`** และ **`btree_gist`** ให้ operator ของ B-tree สำหรับ type ธรรมดากับ GIN และ GiST เพื่อใช้ทำ multicolumn index และ exclusion constraint ที่ผสมทั้งสองแบบ
- **`bloom`** สร้าง signature index ตัวเดียวครอบหลาย column สำหรับ query ที่ทดสอบ column พวกนั้นแบบผสมยังไงก็ได้ด้วย `=`

### เทียบกันตรง ๆ

| Index | Operator ที่ใช้ได้ | ขนาดในรอบนี้ | ต้นทุนตอนเขียน | ใช้ทำอะไรบ่อย ๆ |
|---|---|---|---|---|
| **B-tree** (default) | `<` `<=` `=` `>=` `>`, `BETWEEN`, `IN`, `IS NULL`, ผลลัพธ์ที่เรียงแล้ว, `LIKE 'abc%'` ใน C locale หรือกับ pattern operator class | 3,464 kB บน `orders.status`, 32 MB บน `order_events.happened_at` | หนึ่ง entry ต่อ row และต้องรักษาลำดับ | key, foreign key, range, `ORDER BY … LIMIT` |
| **Partial** (method ไหนก็ได้) | operator ของ method นั้น เมื่อ `WHERE` ของ query ทำให้ predicate เป็นจริง | 88 kB สำหรับ order ที่เปิดอยู่ 3,000 ตัว | เฉพาะ row ที่ตรง | คิว, row ที่ active, uniqueness ภายในกลุ่มย่อย |
| **Expression** (method ไหนก็ได้) | operator ของ method นั้นบนค่าที่คำนวณได้ | 4,880 kB บน `lower(email)` | คำนวณ expression ตอน insert และ update ที่ไม่ใช่ HOT | key ที่ไม่สนตัวพิมพ์เล็กใหญ่, lookup ด้วยค่าที่คำนวณ |
| **Hash** | `=` | 4,112 kB บน `lower(email)` | code ขนาด 32-bit หนึ่งตัวต่อ row | เทียบเท่ากันบน key ยาว ๆ |
| **GiST** | ตาม operator class: overlap, containment, ระยะทาง `<->`, exclusion constraint | ไม่ได้วัด | ปานกลาง | range และการจอง, geometry, nearest neighbour |
| **SP-GiST** | ตาม operator class: point, `inet`, text prefix, range, ระยะทาง `<->` | ไม่ได้วัด | ปานกลาง | point, IP network, prefix search |
| **GIN** | `@>` `<@` `&&` บน array, `@>` `?` `@@` บน `jsonb`, `@@` บน `tsvector`, `LIKE '%…%'` กับ `pg_trgm` | 32 kB บน `products.attrs`, trigram index 3,864 kB บน `customers.email` | สูง: หนึ่ง entry ต่อ key โดยมี pending list ช่วยให้เบาลง | `jsonb`, array, full-text search |
| **BRIN** | `<` `<=` `=` `>=` `>` (minmax) เมื่อ column เรียงตามลำดับทางกายภาพ | 24 kB บน `order_events.happened_at` | ต่ำมาก และไม่ขวาง HOT update | table ใหญ่ที่มีแต่ append และ query ตามเวลาหรือ id |

## ลองรันดู

ข้อมูลตัวอย่างมาจาก [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop) คือ script ที่สร้าง template database `acme` บน PostgreSQL 18 ในเวลาประมาณหนึ่งนาที

รันตามนี้ได้เลยบนสำเนาใหม่ของข้อมูลตัวอย่าง ที่สร้างด้วย `CREATE DATABASE index_types TEMPLATE acme STRATEGY FILE_COPY;` ทั้งหมดใช้เวลาประมาณ 3 วินาที ส่วน comment แสดง output ของการรันหนึ่งรอบบน PostgreSQL 18.6

```sql
-- CREATE DATABASE index_types TEMPLATE acme STRATEGY FILE_COPY;  then connect to index_types

-- Products get attributes: a colour each, and a size for shoes
ALTER TABLE products ADD COLUMN attrs jsonb;
UPDATE products SET attrs =
  jsonb_build_object('colour', (ARRAY['black', 'white', 'grey', 'red', 'blue', 'green', 'pink', 'yellow'])
                               [1 + get_byte(decode(md5(sku), 'hex'), 0) % 8])
  || CASE WHEN category = 'shoes'
          THEN jsonb_build_object('size', 36 + get_byte(decode(md5(sku), 'hex'), 1) % 10)
          ELSE '{}' END;
VACUUM FULL products;

-- Plain B-trees, for comparison
CREATE INDEX orders_status_idx ON orders (status);
CREATE INDEX order_events_happened_at_idx ON order_events (happened_at);
SELECT pg_size_pretty(pg_relation_size('orders_status_idx')) AS status_btree,
       pg_size_pretty(pg_relation_size('order_events_happened_at_idx')) AS happened_at_btree;
-- 3464 kB | 32 MB
DROP INDEX orders_status_idx, order_events_happened_at_idx;

-- One kind of index per query
CREATE INDEX orders_open_idx ON orders (created_at)
  WHERE status IN ('pending', 'paid', 'shipped');                           -- partial
CREATE UNIQUE INDEX customers_lower_email_key ON customers (lower(email));  -- expression
CREATE INDEX order_events_happened_at_brin ON order_events
  USING brin (happened_at);                                                 -- BRIN
CREATE INDEX products_attrs_gin ON products
  USING gin (attrs jsonb_path_ops);                                         -- GIN
VACUUM ANALYZE;

SELECT relname, pg_size_pretty(pg_relation_size(oid)) FROM pg_class
WHERE relname IN ('orders_open_idx', 'customers_lower_email_key',
                  'order_events_happened_at_brin', 'products_attrs_gin')
ORDER BY relname;
-- customers_lower_email_key 4880 kB, order_events_happened_at_brin 24 kB,
-- orders_open_idx 88 kB, products_attrs_gin 32 kB

EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM orders
WHERE status IN ('pending', 'paid', 'shipped') ORDER BY created_at LIMIT 20;
-- Limit (rows=20)  Buffers: shared hit=20 read=2
--   ->  Index Scan using orders_open_idx on orders (rows=20)

EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM customers
WHERE lower(email) = lower('Customer42@Example.com');
-- Index Scan using customers_lower_email_key on customers (rows=1)
--   Index Cond: (lower(email) = 'customer42@example.com'::text)
--   Buffers: shared hit=1 read=3

EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM order_events
WHERE happened_at BETWEEN '2026-09-01' AND '2026-09-02';
-- Bitmap Heap Scan on order_events (rows=2341)
--   Rows Removed by Index Recheck: 15067
--   Heap Blocks: lossy=128
--   ->  Bitmap Index Scan on order_events_happened_at_brin

EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM products
WHERE attrs @> '{"colour": "red", "size": 42}';
-- Bitmap Heap Scan on products (rows=8)  Heap Blocks: exact=8  Buffers: shared hit=13
--   ->  Bitmap Index Scan on products_attrs_gin (rows=8)

-- The same open orders asked another way: the predicate can't be proven
EXPLAIN SELECT * FROM orders
WHERE status NOT IN ('delivered', 'cancelled') ORDER BY created_at LIMIT 20;
-- Limit -> Gather Merge -> Sort -> Parallel Seq Scan on orders

-- BRIN needs rows stored in the order of the column
SELECT tablename, attname, round(correlation::numeric, 2) AS correlation FROM pg_stats
WHERE (tablename, attname) IN (('order_events', 'happened_at'), ('orders', 'created_at'));
-- orders created_at 0.22, order_events happened_at 1.00
```

## ใช้ตอนไหนดี

เริ่มจาก query ไม่ใช่จาก column:

- **เทียบเท่ากันและ range บน scalar column, การ sort, `LIMIT`:** ใช้ B-tree ที่เป็น default หน้า [Composite Index](../composite-index/) และ [Covering Index](../covering-index/) แสดงวิธีออกแบบมัน ส่วน [Query Execution Plans](../query-execution-plans/) แสดงวิธีเช็คว่า planner ใช้มันจริง
- **query ที่ต้องการแค่กลุ่มย่อยเล็ก ๆ เสมอ** (คิว, row ที่ยังไม่ได้ประมวลผล, row ที่ยังไม่ถูก soft-delete): ใช้ partial index ที่ query เขียน predicate ซ้ำแบบคำต่อคำ
- **lookup ด้วยค่าที่คำนวณได้** (`lower(email)`, field ที่ดึงออกมาจาก `jsonb`): ใช้ expression index ที่เขียนด้วย expression ตัวเดียวกับที่ query ใช้เป๊ะ
- **table ใหญ่มากที่มีแต่โตขึ้น และ query ตามเวลาหรือ id ที่เพิ่มขึ้นเรื่อย ๆ** (event, log, metric): ใช้ BRIN หลังจากเช็คแล้วว่า `pg_stats.correlation` ของ column นั้นใกล้ 1 หรือ −1
- **containment ภายใน document, array หรือ text** (`@>`, `&&`, `@@`): ใช้ GIN ส่วน `LIKE '%…%'` ใช้ GIN index กับ `pg_trgm`
- **กฎเรื่อง overlap, ระยะทาง และการห้ามทับกัน** (การจอง, แผนที่, IP range): ใช้ GiST หรือ SP-GiST สำหรับ point และ prefix
- **`=` บน key ยาว ๆ ที่ขนาดสำคัญ:** ใช้ hash index หลังจากวัดแล้วว่ามันช่วยได้ ปกติ B-tree ก็พอ

**full-text search ควรย้ายไปอยู่ใน Elasticsearch หรือ OpenSearch เมื่อไหร่** ตัว full-text search ของ PostgreSQL เอง (`tsvector`, `tsquery` และ GIN index) ก็พอสำหรับ search ภายใน application: ภาษาที่ต้องรองรับมีไม่กี่ภาษา, มี stemming, มีผลลัพธ์ที่จัดอันดับ และข้อมูลยังเป็น transactional อยู่ แต่ search จะโตเกินมันเมื่อกลายเป็น product ของตัวเอง:

- **ต้องจูน relevance** ตัว ranking function ของ PostgreSQL ไม่ใช้ข้อมูลเกี่ยวกับ collection ทั้งก้อนเลย ส่วน [Elasticsearch และ OpenSearch](../elasticsearch/) ให้คะแนนด้วย BM25 ที่ถ่วงน้ำหนักว่าแต่ละ term หายากแค่ไหนใน collection
- **มีภาษาที่ต้องใช้ analyzer ที่ PostgreSQL ไม่มี** ตัว PostgreSQL 18.6 มี text search configuration มาให้ 30 ตัวและไม่มีของภาษาไทยเลย ภาษาไทยเขียนโดยไม่เว้นวรรคระหว่างคำ parser ของมันเลยเก็บวลี สั่งรองเท้าสีแดง ("order red shoes") ไว้เป็น token เดียว ตัว tokenizer `thai` ของ Elasticsearch ตัดข้อความภาษาไทยเป็นคำได้ และ OpenSearch ก็มี Thai analyzer
- **facet บนผลลัพธ์จำนวนมาก, fuzzy matching, synonym** และ search traffic ที่ไม่ควรไปลง primary database ถ้าเป็นแบบนี้ search engine จะเก็บสำเนาข้อมูลชุดที่สองที่ป้อนมาจาก database (เช่นด้วย change data capture) แล้วสำเนานี้ก็มาพร้อม lag และงาน operation ของมันเอง

## ได้อะไร เสียอะไร

- **ทุก index ต้องจ่ายในทุกการเขียน** การ insert หนึ่งครั้งเพิ่ม entry ลงในทุก index ของ table ที่ row นั้นตรง predicate และ update ที่เปลี่ยน column ที่มี index จะเป็น HOT ไม่ได้ GIN จ่ายต่อ row มากที่สุด BRIN จ่ายน้อยที่สุด และการเปลี่ยน column ที่มีแค่ BRIN ก็ยังเป็น HOT อยู่ แล้ว index ยังแย่ง memory ใน shared buffer กับ table ด้วย
- **partial index และ expression index ต้องตรงเป๊ะ ไม่งั้นก็ไม่ได้ใช้เลย** query ที่เขียนอีกแบบ, ORM ที่เติม cast เข้าไป หรือ prepared statement ที่ใช้ generic plan จะไม่ใช้มัน ให้เช็ค plan ของ SQL ที่ application ส่งมาจริง ๆ
- **BRIN เป็นแบบ lossy และขึ้นกับลำดับทางกายภาพ** ทุก range ที่ตรงมีต้นทุน 128 page, row ที่มาไม่ตรงลำดับหรือย้ายที่ตอน update จะทำให้ range กว้างขึ้น และ page ใหม่จะยังไม่ถูกสรุปจนกว่าจะ vacuum
- **GIN แลกเวลา search กับเวลา insert** ผ่าน pending list ของมัน และ insert ที่ทำให้ list ล้นต้องจ่ายค่า merge ทั้งหมด ส่วน `fastupdate = off` ให้ search ที่นิ่งกว่าแต่เขียนช้าลง
- **hash ให้แค่ index ที่เล็กกว่าสำหรับ `=`**: ไม่มี uniqueness, ไม่มี range, ไม่มีการ sort และได้แค่ column เดียว
- **index ที่ไม่มีใครใช้มีแต่ต้นทุน** `pg_stat_user_indexes.idx_scan` และ `last_idx_scan` บอกว่า planner เลือกใช้ index ไหนจริง ๆ
- **การสร้าง index บล็อกการเขียน** ลง table จนกว่าจะสร้างเสร็จ ส่วน `CREATE INDEX CONCURRENTLY` ไม่บล็อก แต่แลกกับการ scan table สองรอบ และถ้าสร้างไม่สำเร็จจะทิ้ง invalid index ไว้ และ index ตัวนี้ยังกินต้นทุนการเขียนจนกว่าจะ drop มัน

## ข้อควรรู้ตอนลงมือทำ

- **ดูข้างใน** `pageinspect` แสดงตัว page เอง (`bt_page_items`, `brin_page_items`, `hash_page_items`, `gin_metapage_info`) ส่วน `pgstattuple` สรุปมันออกมา (`pgstatindex`, `pgstatginindex`) ส่วน key, range และ bucket ใน animation ก็มาจากพวกนี้
- **MySQL 8.4 (InnoDB)** ตัว InnoDB เก็บ row ไว้ใน clustered index ที่ปกติคือ primary key และ secondary index ของมันเป็น B-tree ตัว `USING HASH` รองรับแค่ใน engine MEMORY และ NDB ส่วน adaptive hash index ของ InnoDB เองเป็นของภายใน และ 8.4 ปิดมันไว้โดย default ส่วน `CREATE INDEX` ไม่มี `WHERE` clause เลยไม่มี partial index และไม่มีอะไรที่เหมือน BRIN เลย ส่วน **Functional key part** (MySQL 8.0.13 ขึ้นไป) อย่าง `INDEX ((lower(email)))` ทำหน้าที่แทน expression index และถูก implement เป็น virtual generated column ที่ซ่อนไว้ แต่การ login ไม่ต้องใช้มัน: collation default คือ `utf8mb4_0900_ai_ci` ที่เทียบ string แบบไม่สนตัวพิมพ์เล็กใหญ่ ทำให้ index ธรรมดาบน `email` match กับ `Customer42@Example.com` ได้ และ unique index ก็ปฏิเสธ address ที่ต่างกันแค่ตัวพิมพ์ **Multi-valued index** (8.0.17 ขึ้นไป) ทำ index ให้ทุก element ของ JSON array และใช้กับ `MEMBER OF()`, `JSON_CONTAINS()` และ `JSON_OVERLAPS()` ได้ ถือว่าใกล้เคียงกับ GIN บน `jsonb` ที่สุด ส่วน `FULLTEXT` index (inverted list ใน InnoDB สำหรับ `CHAR`, `VARCHAR` และ `TEXT`) และ `SPATIAL` index (R-tree) ดูแลเรื่อง text และ geometry
- **SQL Server** มี filtered index เป็น partial index ของมัน โดยจำกัดอยู่แค่ comparison operator ง่าย ๆ (ไม่มี `LIKE`) และมี index บน computed column แทน expression index
- **SQLite** มี partial index ตั้งแต่ 3.8.0 (2013) และมี index บน expression ที่เรียกได้แค่ deterministic function ตั้งแต่ 3.9.0 (2015)
- **Oracle Database** มี function-based index ที่เป็น B-tree หรือ bitmap index ก็ได้ และมี bitmap index ที่แต่ละ key ถือ bitmap ของ row ที่มี key นั้น
- **[MongoDB](../mongodb/)** มี partial index (`partialFilterExpression`), multikey index ที่ได้ entry หนึ่งตัวต่อ element ของ array และ wildcard index (`$**`) สำหรับ document ที่ field ไม่เหมือนกัน
- **DynamoDB** เขียน item ลง secondary index ก็ต่อเมื่อ item มี key attribute ของ index นั้น ทำให้ sparse index ทำหน้าที่เดียวกับ partial index
- **การตั้งชื่อ** ตั้งชื่อ index ตาม query ที่มันรับใช้ (`orders_open_idx`, `customers_lower_email_key`) เพื่อให้คนที่แก้ query รู้ว่า index ขึ้นกับการเขียน query แบบเป๊ะ ๆ ส่วนหน้า [PostgreSQL](../postgresql/) อธิบายส่วนที่เหลือของ engine
