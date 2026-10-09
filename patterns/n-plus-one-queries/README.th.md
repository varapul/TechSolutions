## ปัญหา

หน้าที่แสดง list ของ record พร้อมข้อมูลที่เกี่ยวข้อง เขียนง่าย ๆ ได้ว่า "โหลด list มาก่อน แล้วค่อยวนดูทีละตัว" แต่ถ้า ORM ใช้ lazy loading แล้ว relation ทุกตัวที่ loop แตะเป็นครั้งแรกก็จะส่ง query ของตัวเองออกไป ที่ Acme Shop ตัว endpoint **My orders** โหลด order ล่าสุด 20 รายการของ customer 42 แล้วโหลด item ของแต่ละ order แล้วก็โหลด product ของแต่ละ item: **1 + 20 + 52 = 73 query** ต่อการเปิดหน้าหนึ่งครั้ง ชื่อของมันบอกรูปร่างไว้แล้ว: query หนึ่งตัวดึง list ของ parent N ตัว แล้วอีก N ตัวดึง child ของพวกมัน ตรงนี้มันเกิดสองชั้น ชั้นหนึ่งซ้อนอยู่ในอีกชั้น

ไม่มี query ไหนใน 73 ตัวที่ช้าเลย ในการรันที่อยู่เบื้องหลังหน้านี้ (PostgreSQL 18.6 ใน Docker container บน laptop ส่วนแอปเป็น script Node.js สั้น ๆ บน connection เดียว แบบที่ ORM ใช้) ตัว pg_stat_statements รายงานเวลารัน 0.007 ถึง 0.034 ms ต่อ call ต่ำกว่าเกณฑ์ที่ slow-query log จะจับได้ไปไกล ตัวที่สะสมจนเยอะคือการรอ: แอปส่ง query แล้วรอแถวกลับมา จากนั้นถึงจะส่งตัวถัดไป จากการเปิดหน้า 100 ครั้ง ค่า median อยู่ที่ **33 ms** ที่ฝั่งแอป และในนั้น PostgreSQL ใช้ไปกับการวางแผนและรันแค่ **1.9 ms** ส่วนที่เหลือหมดไปกับ round trip 73 รอบ รอบละราว 0.4 ms รวมงานที่ driver และ server ต้องทำในทุก statement ด้วย พอข้าม network จริง ตัว round trip แต่ละรอบก็แพงขึ้น หน้าเลยช้าลงทั้งที่ไม่มี query ไหนช้าลงเลย จำนวน query ยังโตตามข้อมูลด้วย (item ต่อ order ยิ่งเยอะ query ของ product ก็ยิ่งเยอะ) และโตตาม traffic: ถ้าสมมติว่ามี page view 100 ครั้งต่อวินาที endpoint นี้จะส่ง 7,300 query ต่อวินาที ทั้งที่ 300 ตัวก็พอ

## ทำงานยังไง

**ทำไมถึงเกิด** ORM คืน object ที่ relation ของมันเป็นแค่ตัวแทน (placeholder) จนกว่าเราจะแตะมัน: proxy, related manager หรือ lazy collection การเข้าถึง `order.items` ครั้งแรกจะรัน `SELECT … FROM order_items WHERE order_id = $1` ให้ order ตัวนั้นตัวเดียว และการเข้าถึง `item.product` ครั้งแรกจะรัน `SELECT … FROM products WHERE id = $1` ให้ item ตัวนั้นตัวเดียว ถ้าอยู่ใน loop ตัวโค้ดก็ยังดูเหมือน fetch ครั้งเดียว แต่ ORM ส่ง statement ออกไปทุกรอบของ loop

**จับมันได้ยังไง**

- **pg_stat_statements** รวม statement ที่ต่างกันแค่ค่าคงที่หรือ parameter ไว้ด้วยกัน ทำให้ N+1 โผล่มาเป็น statement ตัวเดียวที่มี `calls` สูงมาก เวลาเฉลี่ยน้อยนิด และได้แถวแค่ไม่กี่แถวต่อ call หลังเปิดหน้า 100 ครั้งในแต่ละเวอร์ชัน (แบบ lazy, แบบ batch และแบบ join) ด้านบนของ view ออกมาหน้าตาแบบนี้ โดยที่ query ของ orders รันทั้งในเวอร์ชัน lazy และเวอร์ชัน batch ส่วน `mean_plan_time` ต้องเปิด `pg_stat_statements.track_planning = on` ที่ปิดไว้โดย default:

```sql
SELECT calls, rows, round(mean_exec_time::numeric, 3) AS exec_ms,
       round(mean_plan_time::numeric, 3) AS plan_ms, query
FROM pg_stat_statements ORDER BY calls DESC LIMIT 3;
--  calls | rows | exec_ms | plan_ms | query
--   5200 | 5200 |   0.007 |   0.018 | SELECT id, sku, name, price_thb FROM products WHERE id = $1
--   2000 | 5200 |   0.009 |   0.018 | SELECT order_id, line_no, product_id, qty, price_thb FROM order_items WHERE order_id = $1
--    200 | 4000 |   0.034 |   0.033 | SELECT id, status, created_at, total_thb FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT $2
```

- **server log** ถ้าตั้ง `log_min_duration_statement = 0` ให้ session เดียวหรือ role เดียวแทนที่จะตั้งทั้ง server ตัว PostgreSQL จะ log ทุก statement พร้อมเวลาและ parameter ของมัน ถ้าใช้ extended query protocol แต่ละ statement จะโผล่เป็นบรรทัด parse, bind และ execute การเปิดหน้าครั้งเดียวได้บรรทัด `execute` 73 บรรทัด ที่มี statement ต่างกันแค่ 3 แบบ:

```
LOG:  duration: 0.013 ms  execute <unnamed>: SELECT order_id, line_no, product_id, qty, price_thb FROM order_items WHERE order_id = $1
DETAIL:  Parameters: $1 = '495179'
LOG:  duration: 0.009 ms  execute <unnamed>: SELECT id, sku, name, price_thb FROM products WHERE id = $1
DETAIL:  Parameters: $1 = '7689'
LOG:  duration: 0.008 ms  execute <unnamed>: SELECT id, sku, name, price_thb FROM products WHERE id = $1
DETAIL:  Parameters: $1 = '2892'
```

- **trace และ log ของ ORM เอง** ใน trace ของ request (ดู [Distributed Tracing](../distributed-tracing/)) จะเห็น span ของ database สั้น ๆ หน้าตาเหมือนกันเรียงต่อกันเป็นขั้นบันได ORM ส่วนใหญ่ log SQL ที่ส่งออกไปได้ และ test ก็ล็อกจำนวน query ที่หน้าหนึ่งรันได้ (เช่น `assertNumQueries` ของ Django) ทำให้ถ้ามี regression ก็ build fail แทนที่จะหลุดไปถึง production

**แก้ใน SQL** ขอ child ทั้งหมดของชั้นหนึ่งใน statement เดียว

- **Batch ตาม key** เก็บ key ของ parent มารวมกัน แล้วส่งไปเป็น array parameter ตัวเดียว: `SELECT … FROM order_items WHERE order_id = ANY($1)` พร้อม id ของ order 20 ตัว แล้วตามด้วย `SELECT … FROM products WHERE id = ANY($1)` พร้อม id ของ product 52 ตัว จากนั้นจับคู่แถวใน memory ตาม key รวมแล้วทั้งหน้าใช้ 3 round trip ไม่ว่า N จะโตแค่ไหน และข้อความของ statement ก็เหมือนเดิมไม่ว่าจะมีกี่ key แต่ database ก็ยังต้อง lookup ทุก key: `EXPLAIN ANALYZE` ใน PostgreSQL 18 แสดง Index Scan หนึ่งตัวที่มี `Index Searches: 19` สำหรับ id ของ order 20 ตัว (order 475685 กับ 475698 อยู่ใน leaf page เดียวกันของ `order_items_pkey` ทำให้ไล่ลงครั้งเดียวก็เจอทั้งคู่) และ search 22 ครั้งสำหรับ id ของ product 52 ตัว วัดที่ฝั่งแอปได้ **3 query, 1.9 ms** ต่อการเปิดหน้า (median ของ 100 ครั้ง) โดยเป็นการวางแผนและรัน 0.3 ms
- **Join แล้ว aggregate** ใช้ statement เดียว join orders, items และ products แล้วพับ item ของแต่ละ order เป็น JSON array ด้วย `json_agg(… ORDER BY i.line_no)` ได้ order ละหนึ่งแถว ข้างใน server ตัว plan เป็น nested loop ที่ search `order_items_pkey` 20 ครั้งและ `products_pkey` 52 ครั้ง: lookup ชุดเดียวกับเวอร์ชัน N+1 แต่ไม่มี round trip คั่นระหว่างกัน ([Join Algorithms](../join-algorithms/) อธิบายว่า database รัน join แบบนี้ยังไง ส่วน [Query Execution Plans](../query-execution-plans/) อธิบายวิธีอ่าน plan) วัดได้ **1 query, 1.2 ms** โดยเป็นการวางแผนและรัน 0.47 ms ตัว server ทำงานมากกว่าแบบสาม batch นิดหน่อย ส่วนแอปประหยัดไปสอง round trip
- **LATERAL** ถ้า parent แต่ละตัวต้องมี subquery ของตัวเอง (เช่น event ล่าสุดสามตัวของมัน) `CROSS JOIN LATERAL (SELECT … WHERE e.order_id = o.id ORDER BY … LIMIT 3)` จะรันมันให้ทุกแถวของ parent ใน statement เดียว แทนที่แอปจะส่งมาแถวละครั้ง

**แก้ใน ORM** ตัว ORM หลัก ๆ ทุกตัวโหลด relation ล่วงหน้าได้ ต่างกันแค่ชื่อ ตัว batch query มักส่ง key ไปเป็น `IN` list (เอกสารของ SQLAlchemy บอกไว้แบบนั้นสำหรับ `selectinload()`) ส่วนตัวอย่างใน guide ของ Hibernate ใช้ `= any (?)` กับ array

| ORM | query เพิ่มหนึ่งตัวต่อ relation พร้อม key | query เดียวที่มี join | ทำให้ lazy load fail ให้เห็นชัด ๆ |
|---|---|---|---|
| Django 6.1 | `prefetch_related()` | `select_related()` (เฉพาะ foreign key และ one-to-one) | `fetch_mode(models.FETCH_RAISE)` |
| Rails (Active Record) | `preload` | `eager_load` (เป็น `LEFT OUTER JOIN`) ส่วน `includes` เลือกหนึ่งในสองแบบนี้ให้ | `strict_loading` |
| Hibernate 7 / JPA | `@BatchSize` หรือ `hibernate.default_batch_fetch_size` | `join fetch` ใน HQL หรือ `EntityGraph` | `StatelessSession` ที่ทุก fetch ต้องสั่งเองชัด ๆ |
| SQLAlchemy 2.0 | `selectinload()` | `joinedload()` | `raiseload()` หรือ `lazy="raise"` |
| EF Core | `Include()` คู่กับ `AsSplitQuery()` | `Include()` และ `ThenInclude()` | ไม่มีอะไรโหลดแบบ lazy ถ้าไม่เปิดเอง (proxy หรือ `ILazyLoader`) |

Django 6.1 ยังเพิ่ม fetch mode เข้ามาด้วย: ถ้าใช้ `FETCH_PEERS` การเข้าถึง foreign key ครั้งแรกบน instance หนึ่งจะโหลดมันให้ทุก instance ที่มาจาก QuerySet เดียวกัน แต่ `order.items.all()` ของแต่ละ order ก็เป็น QuerySet ของตัวเอง ทำให้ `item.product` เสีย query หนึ่งตัวต่อ order แทนที่จะเป็นหนึ่งตัวต่อ item (ตรงนี้คือ 20 แทน 52) ส่วน fetch mode ไม่ได้เปลี่ยน query ของ related manager อย่าง `order.items.all()` ตัวนี้เลยยังต้องใช้ `prefetch_related()` อยู่

**GraphQL** ตัว resolver รันทีละ field ทำให้ `Order.items` ถูก resolve หนึ่งครั้งต่อทุก order ในผลลัพธ์ ก็คือ N+1 อีกแล้ว [DataLoader](https://github.com/graphql/dataloader) แก้มันที่ชั้นของ resolver: เราสร้าง loader หนึ่งตัวต่อ request แล้ว resolver แต่ละตัวก็เรียก `load(key)` ตัว loader จะเก็บ key ที่ถูกขอภายใน tick เดียวของ event loop แล้วเรียก batch function ของเราครั้งเดียวพร้อม key ทั้งหมด ในนั้นเราก็รัน query `= ANY($1)` ตัวเดียว มันยัง cache แต่ละ key ไว้ตลอดช่วงที่เหลือของ request ด้วย ดู [GraphQL Federation](../graphql-federation/) สำหรับเรื่องเดียวกันนี้ข้าม service

## ลองรันดู

sample data มาจาก [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop) ที่เป็น script สร้าง template database `acme` บน PostgreSQL 18 ในเวลาราวหนึ่งนาที

รันใน `psql` บน PostgreSQL 18 กับ sample data ของ Acme Shop ชุดที่ copy มาใหม่ (template database `acme`) ตัว query ของ orders ต้องใช้ index `(customer_id, created_at)` ที่ [Composite Index](../composite-index/) สร้างไว้ ถ้าไม่มี การเปิดหน้าทุกครั้งก็จะต้อง scan order ทั้ง 500,000 ตัวด้วย เวลาที่เห็นมาจากการรันครั้งหนึ่งบน laptop และบนเครื่องของคุณจะไม่เท่ากัน

```sql
CREATE DATABASE n_plus_one TEMPLATE acme STRATEGY FILE_COPY;
\c n_plus_one
CREATE INDEX orders_customer_id_created_at_idx ON orders (customer_id, created_at);

-- The list: customer 42's 20 latest orders, kept in a psql variable
SELECT array_agg(id ORDER BY created_at DESC) AS ids
FROM (SELECT id, created_at FROM orders WHERE customer_id = 42
      ORDER BY created_at DESC LIMIT 20) latest \gset
\echo :ids
-- {495179,493709,485504,481174,475698,475685,473551,471860,471274,465759,462606,461749,459786,457379,456248,455805,454178,451508,450897,447059}

-- N+1: \gexec sends every generated statement as a query of its own
\timing on
SELECT format('SELECT order_id, count(*) FROM order_items WHERE order_id = %s GROUP BY 1', id)
FROM unnest(:'ids'::bigint[]) AS id \gexec
--  order_id | count
--    495179 |     4
--  Time: 0.627 ms
--  ... 19 more result sets (493709: 2, 485504: 1, 481174: 3 ...), 52 items in all,
--  each after a round trip of its own; \timing printed a few tenths of a ms for each
\timing off

-- Batched by keys: one statement, the 20 ids as one array parameter
EXPLAIN (ANALYZE, COSTS OFF)
SELECT order_id, line_no, product_id, qty, price_thb
FROM order_items WHERE order_id = ANY (:'ids'::bigint[]);
--  Index Scan using order_items_pkey on order_items (actual rows=52.00 loops=1)
--    Index Cond: (order_id = ANY ('{495179,493709,...,447059}'::bigint[]))
--    Index Searches: 19
--    Buffers: shared hit=76

-- ... and the products of all 52 items at once
SELECT array_agg(DISTINCT product_id) AS pids
FROM order_items WHERE order_id = ANY (:'ids'::bigint[]) \gset
EXPLAIN (ANALYZE, COSTS OFF)
SELECT id, sku, name, price_thb FROM products WHERE id = ANY (:'pids'::bigint[]);
--  Index Scan using products_pkey on products (actual rows=52.00 loops=1)
--    Index Cond: (id = ANY ('{9,11,22,...,9779}'::bigint[]))
--    Index Searches: 22
--    Buffers: shared hit=21 read=58

-- One statement: join, then nest each order's items with json_agg
-- (LIMIT 2 only keeps the output short)
SELECT o.id, json_agg(json_build_object('qty', i.qty, 'sku', p.sku, 'name', p.name)
                      ORDER BY i.line_no) AS items
FROM (SELECT id, created_at FROM orders WHERE customer_id = 42
      ORDER BY created_at DESC LIMIT 20) o
JOIN order_items i ON i.order_id = o.id
JOIN products p ON p.id = i.product_id
GROUP BY o.id, o.created_at
ORDER BY o.created_at DESC
LIMIT 2;
--    id   | items
--  495179 | [{"qty" : 3, "sku" : "SKU-007689", "name" : "Product 7689"}, {"qty" : 3, "sku" : "SKU-002892", ...}, ...]
--  493709 | [{"qty" : 1, "sku" : "SKU-005003", "name" : "Product 5003"}, {"qty" : 2, "sku" : "SKU-001172", "name" : "Product 1172"}]

-- Two child collections in one join multiply: items x events per order
WITH o AS (SELECT id FROM orders WHERE customer_id = 42 ORDER BY created_at DESC LIMIT 20)
SELECT (SELECT count(*) FROM order_items i JOIN o ON i.order_id = o.id) AS items,
       (SELECT count(*) FROM order_events e JOIN o ON e.order_id = o.id) AS events,
       (SELECT count(*) FROM o JOIN order_items i ON i.order_id = o.id
                               JOIN order_events e ON e.order_id = o.id) AS joined_rows;
--  items | events | joined_rows
--     52 |     60 |         156
```

## ใช้ตอนไหนดี

**N+1 ไม่เป็นไรถ้า loop ยังเล็กและเกิดไม่บ่อย** หน้ารายละเอียดที่แสดงแถวที่เกี่ยวข้องแค่สองสามแถวเสมอ งาน export ฝั่ง admin ที่รันคืนละครั้ง หรือ relation ที่เกือบทุกครั้งมาจาก cache ที่อุ่นอยู่แล้ว (ดู [Cache-Aside](../cache-aside/)) ไม่ต้องมีโค้ดเพิ่ม ส่วน N+1 ก็ยังถูกด้วยถ้าไม่มี round trip เลย: SQLite รันอยู่ใน process ของแอป และเอกสารของมันก็บอกว่า query เล็ก ๆ จำนวนมากมีประสิทธิภาพตรงนั้นก็เพราะเหตุผลนี้เอง ก่อนจะพึ่ง cache ให้วัด path ตอน miss ก่อน และจำไว้ว่า N โตตามข้อมูล

**Batch ตาม key** ใช้ตอนที่ child มีเยอะ ต้อง filter หรือแบ่งหน้าของมันเอง หรือมาจาก store หรือ service อื่น: ได้ query ง่าย ๆ สองสามตัวที่ cache ได้และหน้าตาเหมือนกันทุกหน้า ส่วน **Join** (แบบแบน หรือใช้ `json_agg`) ใช้ตอนที่หน้ามีรูปร่างตายตัวและอยากได้ round trip เดียว แล้วใช้ lateral subquery กับโจทย์ "top N ต่อ parent" ส่วนถ้าข้าม service ตัว pattern เดียวกันจะโผล่มาเป็น API call หนึ่งครั้งต่อ item และทางแก้ในระดับนั้นคือ batch endpoint หรือ [Gateway Aggregation](../gateway-aggregation/)

## ได้อะไร เสียอะไร

- **Round trip แลกกับงานของ database** ตัว batching เสียหนึ่ง round trip ต่อชั้น และแอปต้องจับคู่แถวเองใน memory ส่วน join ที่ใช้ `json_agg` เสียแค่ round trip เดียว แต่ server ต้องจัดรูปข้อมูลเอง: ตรงนี้ใช้การวางแผนและรัน 0.47 ms เทียบกับ 0.29 ms ของ statement แบบ batch สามตัว ถือว่าคุ้มตอนที่ round trip เป็นต้นทุนหลัก แต่ไม่คุ้มเท่าตอนที่ database เป็นคอขวด นอกจากนี้ JSON ยังข้ามการ map object ของ ORM ไปด้วย
- **list ของ key ต้องมีขอบเขต** PostgreSQL รับ parameter ได้ไม่เกิน 65,535 ตัวใน statement เดียว และ `IN` list ที่มี placeholder หนึ่งตัวต่อ key จะเป็นคนละ statement ทุกครั้งที่ความยาวของ list เปลี่ยน ทำให้ driver ที่ prepare statement ต้องเก็บไว้หนึ่งตัวต่อหนึ่งความยาว ให้ส่ง array ตัวเดียวแทน แบ่ง list ที่ยาวมาก ๆ เป็นชิ้น ๆ หรือปล่อยให้ database หา key เองด้วย subquery (`WHERE order_id IN (SELECT id FROM orders WHERE …)`) แบบที่ subselect fetching ของ Hibernate ทำ
- **eager เป็น default ก็ดึงเกิน** การโหลดทุก relation ในทุก query ทำให้ต้องจ่ายค่าข้อมูลที่หน้าส่วนใหญ่ไม่เคยแสดง (ถ้า preload `order_events` ตรงนี้ก็จะได้เพิ่มมา 60 แถวทุกครั้งที่เปิดหน้า) JPA ตั้ง `@ManyToOne` เป็น eager โดย default และ guide ของ Hibernate ก็เตือนเรื่องนี้ไว้ ให้ map relation เป็น lazy แล้ว fetch ตาม use case
- **collection สองชุดใน join เดียวทำให้แถวคูณกัน** item กับ event ของ order 20 ตัวชุดเดียวกันเป็น 52 + 60 แถวถ้าแยกสอง query แต่เป็น 156 แถวถ้า join รวมกัน เพราะ item ทุกตัวซ้ำไปตาม event ทุกตัวของ order นั้น ส่วน EF Core เรียกปัญหานี้ว่า cartesian explosion และแยก query แบบนี้ด้วย `AsSplitQuery()`
- **cache ซ่อนมันไว้** หน้าที่ cache ไว้ไม่ส่ง query เลยสักตัว ทำให้ N+1 ที่อยู่ข้างหลังดูเหมือนไม่เสียอะไรจนกว่า entry จะหมดอายุหรือ cache restart แล้วทุกครั้งที่ miss ก็ต้องจ่าย round trip ครบ 73 รอบอีกครั้ง
- **pipelining ช่วยได้น้อยกว่า batching** ตัว pipeline mode ของ libpq (ตั้งแต่ PostgreSQL 14) ให้ client ส่ง query ได้โดยไม่ต้องรอผลของแต่ละตัว มันลดการรอ แต่ไม่ลดจำนวน statement และต้องมี driver กับโค้ดที่เขียนมารองรับ

## ข้อควรรู้ตอนลงมือทำ

- **pg_stat_statements** มากับ PostgreSQL และ Docker image ทางการ `postgres:18` ก็มีให้ แต่มันจะทำงานก็ต่อเมื่อใส่ไว้ใน `shared_preload_libraries` ที่ต้อง restart server แล้วตามด้วย `CREATE EXTENSION pg_stat_statements` ใน database เพื่อให้ได้ view มา ถ้าใช้ `compute_query_id = auto` ที่เป็น default การโหลด module ก็จะเปิด query id ไปด้วย มันติดตามทุก database บน server แทนค่าคงที่ด้วย `$1`, `$2` … และตั้งแต่ PostgreSQL 18 ก็รวม `IN` list ของค่าคงที่ที่ต่างกันแค่ความยาวไว้เป็น entry เดียวด้วย การรันของหน้านี้ใช้ container ของตัวเองที่เริ่มด้วย `-c shared_preload_libraries=pg_stat_statements -c pg_stat_statements.track_planning=on`
- **Index Searches** เป็นของใหม่ใน `EXPLAIN ANALYZE` ของ PostgreSQL 18: มันนับจำนวนครั้งที่ scan node ไล่ลง index ทำให้เทียบ scan แบบ batch ที่ใช้ `= ANY` (search 19 ครั้งสำหรับ 20 key) กับ nested loop (`loops=20`, search 20 ครั้ง) ได้ง่าย
- **MySQL 8.4 (InnoDB)** ไม่มี array type ทำให้ batch มักส่งไปเป็น `IN` list ที่มี placeholder หนึ่งตัวต่อ key ตัวที่เทียบเท่า pg_stat_statements คือ table `events_statements_summary_by_digest` ใน Performance Schema ที่มีหนึ่งแถวต่อ statement ที่ normalize แล้ว โดยมี `COUNT_STAR` เป็นจำนวน call หรือจะใช้ view `sys.statement_analysis` ที่อ่านง่ายกว่า (`exec_count`) ก็ได้ การซ้อนข้อมูลทำได้ด้วย `JSON_ARRAYAGG(JSON_OBJECT(…))` แต่ MySQL ไม่ได้กำหนดลำดับของ element ที่ aggregate มา ส่วน lateral derived table ก็รองรับ
- **SQL Server** รายงาน `execution_count` ต่อ plan ที่ cache ไว้ใน `sys.dm_exec_query_stats` ทำให้ statement N+1 ที่ parameterize แล้วโผล่มาเป็น plan เดียวที่มี count สูงมาก
- **SQLite** รันอยู่ใน process ของแอป ทำให้ query หนึ่งตัวเสียแค่การเรียก function แทนที่จะเป็น network round trip นี่คือเหตุผลที่เอกสารของมันบอกว่า query เล็ก ๆ จำนวนมากมีประสิทธิภาพ
- **DynamoDB** ไม่มี join: การดึง item ทีละตัวด้วย `GetItem` ใน loop คือ N+1 เวอร์ชัน key-value ส่วน `BatchGetItem` อ่าน item ได้สูงสุด 100 ตัว (ไม่เกิน 16 MB) ตาม key ใน call เดียว มันอาจคืนผลลัพธ์มาไม่ครบ เลยต้อง retry key ที่มันทิ้งไว้แบบ unprocessed
- **[connection pool](../connection-pooling/) แก้ไม่ได้** pooling ประหยัดต้นทุนการเปิด connection แต่ไม่ได้ประหยัด round trip ของแต่ละ statement ตัว query 73 ตัวในการรันนี้ก็วิ่งผ่าน connection ที่เปิดอยู่ตัวเดียวทั้งหมด
