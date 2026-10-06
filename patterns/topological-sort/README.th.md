## ปัญหา

build ต้อง compile library ก่อนโค้ดที่ import มัน package manager ต้องติดตั้ง dependency ก่อน package ที่ต้องใช้มัน และ migration ที่เพิ่ม foreign key ต้องรันหลังตัวที่สร้าง table ที่ key นั้นชี้ไป เครื่องมือแต่ละตัวได้กฎ "A ก่อน B" มากองหนึ่ง ที่หลายคนมักประกาศไว้ทีละข้อ แล้วต้องหาลำดับเดียวที่ผ่านกฎทุกข้อพร้อมกัน มันยังต้องรู้ด้วยว่ากฎขัดกันเองเมื่อไร เพราะถ้าขัดกันก็ไม่มีลำดับแบบนั้นอยู่เลย

การลองลำดับไปเรื่อย ๆ จนกว่าจะเจอตัวที่ใช้ได้ไม่มีทางเวิร์ก: module 8 ตัวเรียงได้ 8! = 40,320 แบบ และ module 20 ตัวเรียงได้ราว 2.4 × 10¹⁸ แบบ ส่วน topological sort หาลำดับที่ใช้ได้ หรือพิสูจน์ว่าไม่มี ในเวลาที่เป็นสัดส่วนกับจำนวน module บวกจำนวน dependency

## ทำงานยังไง

วาดงานแต่ละอันเป็น node และกฎ "A ต้องมาก่อน B" แต่ละข้อเป็นลูกศร A → B ใน build มันอ่านว่า *build A ก่อน B* ตัว **topological order** คือการเรียงทุก node ให้ลูกศรทุกเส้นชี้ไปข้างหน้า จากตัวที่อยู่ก่อนใน list ไปตัวที่อยู่หลัง มันมีอยู่ก็ต่อเมื่อกราฟไม่มี directed cycle คือเมื่อกราฟเป็น DAG (directed acyclic graph):

- ถ้ามี cycle ตัว node ของมันที่มาก่อนสุดในลำดับที่เสนอมา จะมีลูกศรเข้ามาจาก node ที่วางไว้ข้างหลังมัน เลยไม่มีลำดับไหนใช้ได้
- ถ้าไม่มี cycle ก็ต้องมี node สักตัวที่ไม่มีลูกศรเข้า: การเดินถอยหลังไปตามลูกศรจาก node ไหนก็ได้ต้องหยุดสักที่ เพราะถ้าวนกลับมาที่ node เดิมก็จะปิด cycle วาง node แบบนั้นไว้ก่อน เอามันออก แล้วทำซ้ำกับที่เหลือ เหตุผลนี้ก็เป็นอัลกอริทึมอยู่แล้วในตัว

### อัลกอริทึมของ Kahn

A. B. Kahn ตีพิมพ์ขั้นตอนนี้ในปี 1962 ไว้เรียงลำดับ project network แบบ PERT เขาอธิบายมันสำหรับ IBM 7090 และรายงานว่า network ที่มี 30,000 activity เรียงได้ในเวลาเครื่องไม่ถึงชั่วโมง

1. นับลูกศรที่เข้ามาหาแต่ละ node: คือ **in-degree** ของมัน หรือ badge ในไดอะแกรม ตรงนี้ค่าเริ่มต้นคือ utils 0, config 1, logging 1, db 1, cache 1, users 2, orders 2 และ api 3
2. ใส่ทุก node ที่นับได้ 0 ลงใน queue มีแค่ utils ที่เข้าเกณฑ์
3. ทำจน queue ว่าง: หยิบ node ที่อยู่หน้า queue มาต่อท้าย output แล้วลบ 1 ออกจากตัวนับของทุก node ที่ลูกศรของมันชี้ไป node ไหนที่ตัวนับลดถึง 0 ก็ไม่มี prerequisite ที่ยังไม่เสร็จเหลืออยู่แล้ว เลยไปต่อท้าย queue

ตัวนับคือจำนวน prerequisite ของ node ที่ยังไม่อยู่ใน output node หนึ่งเลยเข้า queue ได้ก็ต่อเมื่อ prerequisite ทุกตัวของมันออกไปใน output แล้ว และสุดท้ายลูกศรทุกเส้นก็ชี้ไปข้างหน้า ในไดอะแกรม การ output config ทำให้ db กับ cache พร้อม การ output db แค่ลด users กับ orders ลงเหลือ 1 พอ cache ออกไปแล้ว users ก็พร้อม และการ output users ทำให้ orders พร้อม และลด api ลงเหลือ 1 การรันนี้ได้ utils, config, logging, db, cache, users, orders, api

### Node ที่พร้อมตัวไหนไปก่อน

จะใช้กฎไหนเลือกระหว่าง node ที่พร้อมก็ได้ลำดับที่ใช้ได้ทั้งนั้น ตัว container เลยเป็นการเลือกออกแบบ:

- **FIFO queue** แบบในไดอะแกรม จะ output กราฟออกมาทีละรอบ: ทุก node ที่พร้อมในรอบหนึ่งจะออกมาก่อนอะไรก็ตามที่รอบนั้นปลดล็อก คล้ายกับที่ [Breadth-First Search](../breadth-first-search/) visit กราฟทีละชั้น
- **Stack** ก็ถูกต้องพอกัน และมักจะเดินตาม chain หนึ่งไปไกลกว่าก่อนจะกลับไปทำตัวอื่น
- **Priority queue** ([binary heap](../binary-heap/) ที่ใช้ชื่อ, priority หรือ ID เป็น key) จะหยิบ key ที่เล็กที่สุดในบรรดาตัวที่พร้อมเสมอ ถ้าใช้ชื่อเป็น key ก็จะได้ลำดับที่ใช้ได้ที่มาก่อนตามตัวอักษร output ก็จะขึ้นกับตัวกราฟอย่างเดียว ไม่ขึ้นกับลำดับที่ใส่ node และลูกศรไว้ แลกกับต้นทุน O(log V) ต่อ node

กราฟหนึ่งไม่ค่อยมีลำดับที่ใช้ได้แค่แบบเดียว ตรงนี้ config กับ logging สลับกันได้ db กับ cache สลับกันได้ และ logging จะไปอยู่ตรงไหนระหว่าง utils กับ api ก็ได้ Sedgewick กับ Wayne ชี้ว่าลำดับจะมีแบบเดียวก็ต่อเมื่อทุกคู่ที่อยู่ติดกันในลำดับมีลูกศรเชื่อมกัน ลำดับนั้นเลยเป็น path ที่ผ่านทุก node ถ้าให้ 11 คู่ชุดเดิม ตัว `tsort` ที่มากับ macOS พิมพ์ utils, logging, config, cache, db, users, orders, api ออกมา: เป็นอีกลำดับหนึ่ง และใช้ได้เหมือนกัน

### ได้การตรวจ cycle มาฟรี ๆ

ถ้า queue ว่างก่อนที่ทุก node จะถูก output ตัวที่เหลือแต่ละตัวก็ยังมี prerequisite อยู่ในกลุ่มที่เหลือ เลยไม่มีตัวไหนลดถึง 0 ได้เลย: กราฟมี cycle และทุก node ที่เหลือก็อยู่บน cycle นั้นหรืออยู่ปลายน้ำของมัน ในขั้นที่ 4 ตัว users กับ orders ประกอบกันเป็น cycle ส่วน api แค่ติดอยู่ข้างหลังพวกมัน set ที่เหลือเลยเป็น error message ที่ไม่ดี ถ้าจะบอกชื่อ cycle จริง ๆ ให้เริ่มที่ node ที่เหลือตัวไหนก็ได้ แล้วถอยกลับไปหา prerequisite ที่เหลือตัวหนึ่งของมันไปเรื่อย ๆ จนเจอ node ซ้ำ: จาก api ไปถึง users แล้ว orders แล้ว users อีกครั้ง cycle เลยคือ users → orders → users ตัว `graphlib` ของ Python ก็รายงาน cycle ของกราฟนี้ในรูปเดียวกัน คือ `['users', 'orders', 'users']`

### ทางเลือกแบบ depth-first

[Depth-First Search](../depth-first-search/) ให้ topological order ได้เหมือนกัน รันมันจากทุก node ที่ยังไม่ได้ visit แล้วจด node แต่ละตัวตอนที่ call ของมัน finish คือตอนที่ทุกอย่างที่ไปถึงได้จากมันเสร็จหมดแล้ว ตามลูกศร A → B ไหนก็ตาม B จะ finish ก่อน A การกลับลำดับ finish (reverse postorder) เลยวาง prerequisite ทุกตัวไว้ก่อนตัวที่พึ่งมัน Sedgewick กับ Wayne ระบุทั้งข้อนี้และเวลาที่ใช้ (เป็นสัดส่วนกับ V + E) ไว้เป็น proposition ส่วน cycle จะโผล่มาเป็นลูกศรที่ไปหา node ที่ call ของมันยังอยู่บน stack คือ back edge ตัวเวอร์ชัน DFS ไม่ต้องใช้ตัวนับ แต่ chain ของ dependency ที่ยาวหมายถึง [recursion](../recursion/) ที่ลึก ถ้าการค้นหาไม่ได้เก็บ stack เอง และมันไม่ได้ให้รอบแบบในขั้นที่ 3

### ระลอก การ build แบบขนาน และ critical path

ให้รอบกับแต่ละ node: 1 สำหรับ node ที่ไม่มี prerequisite ไม่อย่างนั้นก็มากกว่ารอบล่าสุดในบรรดา prerequisite ของมันหนึ่ง ตรงนี้จะได้ {utils}, {config, logging}, {db, cache}, {users}, {orders} และ {api} ไม่มีลูกศรไหนเชื่อมสอง node ในรอบเดียวกันได้ เพราะปลายทางของมันจะไปตกอยู่ในรอบที่หลังกว่าอย่างน้อยหนึ่งรอบ ทำให้ build tool ที่มี worker พอ build แต่ละรอบพร้อมกันได้หมด: 6 รอบแทนการ build ต่อกัน 8 ครั้ง ตรงนี้ใช้ worker สองตัวก็พอ เพราะไม่มีรอบไหนมี module เกินสองตัว

จำนวนรอบเท่ากับจำนวน node บน path ที่ยาวที่สุด ตรงนี้คือ utils → config → db → users → orders → api (หรือ chain เดียวกันที่ผ่าน cache) เรียกว่า **critical path** ถ้างานแต่ละอันใช้เวลาไม่เท่ากัน การเดินผ่าน topological order รอบเดียวก็คำนวณมันได้: earliest finish ของงานหนึ่งคือระยะเวลาของตัวมันเอง บวก earliest finish ที่ช้าที่สุดในบรรดา prerequisite ของมัน และค่าที่มากที่สุดในนี้ก็คือเวลารวมที่สั้นที่สุดที่เป็นไปได้ถ้ามี worker พอ แบบนี้คือ dynamic programming บน DAG ที่ [Dynamic Programming](../dynamic-programming/) อธิบายแบบทั่วไปไว้ scheduler จริงยังทำได้ดีกว่ารอบแบบเคร่ง ๆ ด้วย: แทนที่จะรอสมาชิกที่ช้าที่สุดของรอบ มันเริ่มงานแต่ละอันทันทีที่ prerequisite ของงานนั้นเสร็จ `graphlib` ของ Python แจกงานแบบนี้ และ Terraform ก็ทำแบบเดียวกันตอนเดินไปตาม resource graph ของมัน

## โค้ด

`graph` map แต่ละ node ไปยัง node ที่ต้องใช้มัน คือลูกศรตามทิศของ build (ส่วน `graphlib` ของ Python รับแบบตรงข้าม: map แต่ละ node ไปยัง predecessor ของมัน)

```python
from collections import deque


def kahn(graph):
    """Return all nodes, each one after its prerequisites.

    graph maps every node to the nodes that need it (its outgoing arrows).
    """
    count = dict.fromkeys(graph, 0)              # in-degree: prerequisites not output yet
    for node in graph:
        for after in graph[node]:
            count[after] = count.get(after, 0) + 1
    ready = deque(node for node, n in count.items() if n == 0)
    order = []
    while ready:
        node = ready.popleft()                   # FIFO: the oldest ready node
        order.append(node)
        for after in graph.get(node, ()):
            count[after] -= 1
            if count[after] == 0:                # its last prerequisite is done
                ready.append(after)
    if len(order) < len(count):                  # someone never became ready
        stuck = [node for node, n in count.items() if n > 0]
        raise ValueError(f"cycle: {stuck} never became ready")
    return order


def waves(graph):
    """Group the nodes into rounds; nothing in a round needs anything else in it."""
    order = kahn(graph)                          # raises on a cycle
    level = dict.fromkeys(order, 0)
    for node in order:                           # prerequisites come first, so
        for after in graph.get(node, ()):        # level[node] is already final
            level[after] = max(level[after], level[node] + 1)
    rounds = [[] for _ in range(max(level.values(), default=-1) + 1)]
    for node in order:
        rounds[level[node]].append(node)
    return rounds


deps = {
    "utils": ["config", "logging"], "config": ["db", "cache"], "logging": ["api"],
    "db": ["users", "orders"], "cache": ["users"], "users": ["orders", "api"],
    "orders": ["api"], "api": [],
}
print(kahn(deps))
# ['utils', 'config', 'logging', 'db', 'cache', 'users', 'orders', 'api']
print(waves(deps))
# [['utils'], ['config', 'logging'], ['db', 'cache'], ['users'], ['orders'], ['api']]
deps["orders"].append("users")                   # a new import: users needs orders too
kahn(deps)
# ValueError: cycle: ['users', 'orders', 'api'] never became ready
```

`waves` คือการคำนวณ critical path ที่ทุกงานใช้เวลาหนึ่งหน่วย: มันเดินไปตาม topological order แล้วดันรอบของแต่ละ node ให้เลยรอบของ prerequisite ของมัน ส่วน test ก็รันทั้งสอง function บนกราฟในไดอะแกรมและแบบที่มี cycle, กราฟว่าง, node เดียว, node ที่อยู่โดดเดี่ยว, node ที่โผล่มาแค่เป็นปลายทาง, ลูกศรซ้ำ, self-loop, cycle ของสองและสาม node, chain ที่มี 1,001 node และกราฟสุ่ม 3,000 อันที่มีไม่เกิน 9 node ทั้งแบบมีและไม่มี cycle ทุกผลลัพธ์ถูกตรวจเทียบกับตัวหา cycle แบบ brute force และตรวจหาลูกศรที่ชี้ถอยหลัง ส่วน `static_order()` ของ `graphlib` ก็ให้ลำดับที่ใช้ได้บนทุกกราฟที่ไม่มี cycle แล้วบนกราฟในไดอะแกรม มันก็บังเอิญคืนลำดับเดียวกับ `kahn` และชุดที่ได้จาก `get_ready()` ก็ตรงกับ `waves` แต่โดยทั่วไปไม่มีอะไรรับประกันแบบนั้น

## Complexity

| | ต้นทุน | ทำไม |
|---|---|---|
| Best time | O(V + E) | ต่อให้กราฟเรียงตามลำดับอยู่แล้วก็ยังต้องอ่าน: การนับ in-degree ต้องแตะทุกลูกศร |
| Average time | O(V + E) | ทุก node เข้า queue และเข้า output ครั้งเดียว และทุกลูกศรลดตัวนับหนึ่งตัวครั้งเดียว |
| Worst time | O(V + E) | ขอบเขตเดียวกันนี้ใช้ได้กับทุก input ส่วน cycle แค่ทำให้ loop จบเร็วขึ้น ถ้าใช้ priority queue แทน FIFO จะเป็น O(V log V + E) |
| Extra space | O(V) | ตัวนับหนึ่งตัวต่อ node บวกกับ queue และ output ที่แต่ละตัวยาวไม่เกิน V ส่วนตัวกราฟเองถ้าเก็บเป็น adjacency list ก็ใช้ O(V + E) |

`waves` เดินผ่าน node และลูกศรเพิ่มอีกรอบ เลยเป็น O(V + E) เหมือนกัน (ดู [Big-O Notation](../big-o-notation/)) เรื่อง stable และ in place ไม่เกี่ยวกับกราฟ เวอร์ชัน FIFO ให้ผลแน่นอนสำหรับ input เดียวกัน แต่ถ้าใส่ node หรือลูกศรชุดเดิมในลำดับอื่น output ก็อาจเปลี่ยน

## ใช้ตอนไหนดี

- อะไรก็ตามที่มี prerequisite: build step, การติดตั้ง package, database migration, การ start service, task ใน data pipeline, schema object (table ก่อน view และ foreign key ที่อ้างถึงมัน)
- รันงานที่ไม่ขึ้นกับกันแบบขนาน: แจกงานทีละรอบ หรือดีกว่านั้นคือแจกทันทีที่ prerequisite ของงานนั้นเสร็จ แล้วดู critical path ว่า chain ไหนเป็นตัวกำหนดเวลารวม
- ตรวจ architecture หา cycle: sort dependency graph ของ module หรือ service ใน CI แล้วให้ fail ถ้ามีอะไรเหลือ แบบนี้จะจับ import แบบในขั้นที่ 4 ได้ตั้งแต่วันที่มันถูกเพิ่มเข้ามา
- ถ้า cycle เป็นเรื่องปกติ (mutual recursion, feedback ระหว่าง component) ให้ยุบแต่ละ strongly connected component ให้เป็น node เดียวก่อน (section 4.2 ของ Sedgewick กับ Wayne พูดถึง strong component) กราฟที่ยุบแล้วจะเป็น DAG และ sort ได้
- มันแค่วางแผนลำดับ ไม่ได้รันอะไรหรือจัดการ failure การรัน business workflow หลายขั้นที่มี retry และ compensation เป็นงานของ orchestrator แบบใน [Saga Orchestration](../saga-orchestration/)

## ได้อะไร เสียอะไร

- **มันรู้แค่ลูกศรที่เราประกาศ** dependency ที่ไม่มีใครเขียนไว้จะมองไม่เห็น งานเลยสำเร็จในลำดับที่ใช้ได้แบบหนึ่ง แต่พังในอีกแบบหนึ่ง build มักพังแบบนี้ตอนที่การรันแบบขนาน (`make -j`) เริ่มรันของในลำดับใหม่
- **ลำดับที่ใช้ได้มีมากกว่าหนึ่งแบบ** output อาจเปลี่ยนถ้าใส่ input ในลำดับอื่น ทำให้ build และ deployment ทำซ้ำให้เหมือนเดิมได้ยาก ถ้าลำดับต้องคงที่ ให้เลือก node ที่พร้อมด้วย priority queue
- **list เส้นเดียวซ่อนความขนานไว้** การ build ต่อกันแปดครั้งใช้เวลานานกว่าหกรอบ และรอบก็ยังต้องรอสมาชิกที่ช้าที่สุดของมัน การเริ่มงานแต่ละอันเมื่อ prerequisite ของงานนั้นเสร็จจะทำได้ดีกว่า
- **set ที่เหลือไม่ใช่ตัว cycle** มันรวมทุกอย่างที่อยู่ปลายน้ำของ cycle ด้วย (ตรงนี้คือ api) เลยควรรายงาน path ของ cycle แบบที่ `graphlib` ทำ
- **บางเครื่องมืออ้อม cycle ไปแทนที่จะ fail** GNU make รายงาน loop เป็น `Circular xxx <- yyy dependency dropped.` แล้วไปต่อโดยไม่มี dependency นั้น pip เขียนไว้ในเอกสารว่าถ้าเจอ dependency cycle มันจะติดตั้งสมาชิกตัวแรกที่เจอเป็นตัวสุดท้าย (และพฤติกรรมนี้อาจเปลี่ยน) ส่วน `tsort` ของ BSD ที่มากับ macOS ก็ข้ามลูกศรเส้นหนึ่งของ cycle แล้วไปต่อ แต่ละตัวยังได้ลำดับออกมา แต่มี dependency อย่างน้อยหนึ่งตัวในนั้นที่พัง เลยควรถือว่า warning พวกนั้นเป็น error
- **ต้องรู้กราฟล่วงหน้า** อัลกอริทึมของ Kahn เริ่มจาก in-degree ที่นับครบแล้ว และตัว sorter ของ `graphlib` ไม่รับ node ใหม่หลังจากเรียก `prepare()` ไปแล้ว dependency ที่เพิ่งเจอตอนงานกำลังรันเลยต้องใช้การออกแบบอีกแบบ

## ข้อควรรู้ตอนลงมือทำ

- **Python:** [`graphlib.TopologicalSorter`](https://docs.python.org/3/library/graphlib.html) (Python 3.9 ขึ้นไป) รับ mapping จากแต่ละ node ไปยัง predecessor ของมัน `static_order()` ให้ลำดับที่ใช้ได้หนึ่งแบบ สำหรับงานแบบขนานให้เรียก `prepare()` แล้วใช้ `get_ready()` แจกทุก node ที่พร้อม และเรียก `done()` เมื่อแต่ละตัวเสร็จ แบบนี้ node ที่เสร็จแล้วจะได้ปลดล็อก successor ของมัน ถ้ามี cycle ตัว `prepare()` จะ raise `CycleError` ที่เป็น subclass ของ `ValueError` โดยมี cycle เป็นตัวที่สองใน `args` และ node แรกของมันซ้ำอยู่ท้ายสุด สำหรับกราฟในขั้นที่ 4 ตัว Python 3.11 รายงาน `['users', 'orders', 'users']`
- **Build tool:** ก่อนที่ make จะทำ target หนึ่งให้เสร็จ มันประมวลผล rule ของไฟล์ที่ target นั้นพึ่งอยู่ก่อน และ `-j` ก็รัน recipe ที่ไม่ขึ้นกับกันไปพร้อมกัน Bazel เรียกกราฟแบบไม่มี cycle ของความสัมพันธ์ "depends upon" ระหว่าง target ว่า dependency graph ส่วน reactor ของ Maven รวบรวม module ของ project แบบหลาย module มา sort เป็นลำดับการ build แล้ว build ตามลำดับนั้น
- **Package manager:** ตั้งแต่ version 6.1.0 ตัว pip ติดตั้ง dependency ก่อนตัวที่พึ่งมัน "in topological order" และเขียนไว้ในเอกสารว่านั่นคือสัญญาเดียวที่มันให้เรื่องลำดับ (ไม่ครอบคลุม build dependency)
- **Infrastructure as code:** Terraform สร้าง dependency graph ของ resource ตรวจว่าไม่มี cycle แล้วเดินไปตามมันแบบขนาน: node หนึ่งถูกประมวลผลทันทีที่ dependency ทุกตัวของมันเสร็จ ทำพร้อมกันได้ถึง 10 ตัวโดย default (`-parallelism` บน `plan`, `apply` และ `destroy`) ส่วน `terraform graph` พิมพ์กราฟออกมาในรูปแบบ DOT
- **Scheduler:** Dag ของ Airflow (ชื่อมาจาก directed acyclic graph) ประกาศ dependency ระหว่าง task ด้วย `>>` และ `<<` และโดย default task หนึ่งจะรันก็ต่อเมื่อ upstream task ทุกตัวของมันสำเร็จแล้ว (trigger rule `all_success`) ส่วน systemd เรียงลำดับ unit ด้วย `Before=` และ `After=`: unit ที่ไม่มีลำดับระหว่างกันจะ start และ stop พร้อมกัน ตอน shutdown จะกลับลำดับของตอน start และการเรียงลำดับก็แยกจาก requirement dependency อย่าง `Requires=` และ `Wants=`
- **Database migration:** Django จด dependency ระหว่าง migration ไว้ การเพิ่ม `ForeignKey` จาก app books ไปที่ app authors จะทำให้ migration ใหม่พึ่ง migration ตัวหนึ่งใน authors ทำให้ table authors ถูกสร้างก่อน column ที่อ้างถึงมัน
- **Spreadsheet:** Excel เก็บ dependency tree ของ cell และ calculation chain ที่เรียงสูตรตามลำดับที่ควรคำนวณ ถ้าปรากฏว่าสูตรหนึ่งพึ่ง cell ที่ยังไม่ได้คำนวณ Excel จะย้ายมันกับตัวที่พึ่งมันลงไปใน chain ทำให้ลำดับแก้ตัวเองได้ระหว่าง recalculation ส่วน cell ที่พึ่งตัวเอง ไม่ว่าทางตรงหรือทางอ้อม คือ circular reference ที่ Excel จะเตือน และ iterative calculation ก็มีไว้สำหรับ model ที่ตั้งใจให้วน
- **Circular dependency เป็นกลิ่นไม่ดีของ architecture** Go ทำให้มันผิดกฎไปเลย: package import ตัวเองไม่ได้ ไม่ว่าทางตรงหรือทางอ้อม Python ยอมให้ import วนกันได้ แต่อาจพังตอน import ตัวอย่างเช่นบน CPython 3.11 ถ้า module สองตัว import ชื่อจากกันและกันที่ top level จะพังด้วย `ImportError: cannot import name 'f' from partially initialized module 'a' (most likely due to a circular import)` ใน [Modular Monolith](../modular-monolith/) cycle ระหว่าง module หมายความว่าไม่มีตัวไหนที่เปลี่ยนได้เอง test ได้เอง หรือแยกออกมาได้เอง ส่วนระหว่าง [Microservices](../microservices/) cycle ของ call แบบ synchronous ผูก deployment และ failure ของพวกมันไว้ด้วยกัน ตัด cycle ได้ด้วยการย้ายส่วนที่ใช้ร่วมกันไปไว้ใน module ที่ทั้งคู่พึ่งได้ ด้วยการกลับทิศ dependency หนึ่งตัวไว้หลัง interface หรือด้วยการเปลี่ยน call เป็น event
