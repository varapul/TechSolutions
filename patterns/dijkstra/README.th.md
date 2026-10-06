## ปัญหา

router ที่เลือก next hop แอปแผนที่ที่วางแผนการขับรถ และตัวละครในเกมที่เดินอ้อมกำแพง ต่างก็ถามคำถามเดียวกัน: ทางที่ถูกที่สุดจากตรงนี้ไปทุกที่คือทางไหน เมื่อทุก link มีต้นทุนของตัวเอง (link metric, ระยะทาง, เวลาเดินทาง หรือ delay)? การนับ edge ตอบคำถามนี้ไม่ได้ [Breadth-first search](../breadth-first-search/) หาเส้นทางที่มี edge น้อยที่สุด บนกราฟในไดอะแกรมมันคืน A → B → D → F ที่มีต้นทุน 4 + 1 + 6 = 11 ทั้งที่ A → C → B → D → E → F ใช้ห้า edge แต่มีต้นทุนแค่ 8 การเทียบทุกเส้นทางก็ scale ไม่ได้เหมือนกัน: แม้ในกราฟเล็ก ๆ นี้ก็มี simple route จาก A ไป F ถึง 13 เส้น และจำนวนของมันโตแบบ exponential ตามขนาดของกราฟได้

อัลกอริทึมของ Dijkstra หาระยะที่สั้นที่สุดจาก source หนึ่งไปทุก node และหา shortest path ไปแต่ละ node โดย settle แต่ละ node ที่ไปถึงได้ครั้งเดียวพอดี ตราบใดที่ไม่มี edge ไหน weight ติดลบ

## ทำงานยังไง

**ระยะทางชั่วคราว** ในกราฟที่มี V node และ E edge ทุก node v มีระยะทางชั่วคราว d[v]: เริ่มต้นเป็น ∞ และเป็น 0 สำหรับ source ตัว min-priority queue เก็บ entry แบบ (distance, node) และเริ่มด้วย (0, source) ส่วน node หนึ่งจะ *settle* เมื่อรู้แน่แล้วว่าระยะของมันเป็นค่า final

**Loop** pop entry ที่ระยะน้อยที่สุดออกมา ถ้า node ของมัน settle ไปแล้ว entry นี้ก็ stale: ข้ามไป ไม่อย่างนั้นก็ settle node u แล้ว **relax** edge แต่ละเส้นของมัน: สำหรับเพื่อนบ้าน v ที่ weight w ถ้า d[u] + w < d[v] เส้นทางที่ผ่าน u ก็ดีกว่าทุกเส้นที่รู้มา เลยตั้ง d[v] เป็น d[u] + w จำ u ไว้เป็น node ก่อนหน้าของ v แล้ว push (d[v], v) การรันจบเมื่อ queue ว่าง ส่วน node ที่ไม่เคยไปถึงก็คงเป็น ∞

**ทำไม node ที่ใกล้ที่สุดถึงเป็นค่า final** สมมติว่า u pop ออกมาด้วยระยะที่น้อยที่สุด d แล้วลองดูเส้นทางอื่นจาก source ไป u เส้นไหนก็ได้ มันต้องออกจากกลุ่ม node ที่ settle แล้วที่ไหนสักที่ ผ่าน edge ที่เข้าไปหา node x ที่ยังไม่ settle และต้นทุนของมันจนถึง x ก็อย่างน้อย d[x] เพราะ edge นั้นถูก relax ไปแล้วตอนที่ปลายข้างที่ settle ของมัน settle ส่วน d[x] ก็อย่างน้อย d เพราะ entry ของ u เล็กที่สุดใน queue และส่วนที่เหลือของเส้นทางจาก x ไป u ก็มีแต่จะเพิ่ม weight ถ้าไม่มี weight ติดลบ เลยไม่มีเส้นทางไหนดีกว่า d และ node ก็ถูก settle ตามลำดับระยะ: 0, 1, 3, 4, 7 และ 8 ในไดอะแกรม นี่คือเหตุผลเรื่องความถูกต้องทั้งหมด มันทำให้อัลกอริทึมของ Dijkstra เป็น [greedy algorithm](../greedy-algorithms/) ที่พิสูจน์ได้ว่าการเลือกแบบ greedy ปลอดภัย และนี่ก็คือขั้นที่ edge ติดลบทำให้พังพอดี

**อ่าน path** prev[v] คือเพื่อนบ้านที่ v ได้ระยะ final ผ่านมัน และ link พวกนี้ประกอบกันเป็น shortest-path tree ที่มี source เป็น root ถ้าจะเอา path ไป F ให้ไล่ตามมันย้อนกลับจาก F (F, E, D, B, C, A) แล้วกลับลำดับ list ที่ได้ การมี link เดียวต่อ node ก็พอ เพราะส่วนต้นของ shortest path จนถึง node ไหนก็ตามบน path นั้น ก็เป็น shortest path ไปยัง node นั้นด้วย นี่คือข้อสังเกตที่ paper ของ Dijkstra ใช้เป็นจุดเริ่ม

**Decrease-key หรือ lazy deletion** พอ d[v] ลดลง entry เก่าของ v ใน queue ก็ล้าสมัย ตำราจะลดค่ามันตรงที่เดิมด้วย *decrease-key* แต่วิธีนี้ต้องใช้ heap ที่รู้ว่าแต่ละ node อยู่ตรงไหน (Sedgewick กับ Wayne ใช้ indexed priority queue) `heapq` ของ Python และ `PriorityQueue` ของ Java ไม่มี operation แบบนี้ และ `remove(Object)` ของ Java ก็ใช้เวลาแบบ linear โค้ดส่วนใหญ่เลยทำแบบที่ไดอะแกรมทำ: push entry ใหม่เข้าไป แล้วข้ามตัวที่ stale เมื่อมันโผล่ขึ้นมา เป็นเทคนิคเดียวกับที่เอกสารของ `heapq` แนะนำไว้สำหรับเปลี่ยน priority ของ task ผลคือ queue จะเก็บได้ถึงหนึ่ง entry ต่อ edge แทนที่จะเป็นหนึ่งต่อ node เปลือง memory แต่ไม่เปลืองเวลาในเชิง asymptotic เพราะ log E < 2 log V ส่วนในไดอะแกรมมี 10 entry ผ่าน queue สำหรับ 6 node และ 4 ตัวในนั้นกลายเป็น stale ถ้าอยากรู้ว่า push กับ pop ทำงานข้างในยังไง ดู [Binary Heap](../binary-heap/)

**ค่าที่เท่ากัน** ระยะที่เท่ากันอาจ pop ออกมาลำดับไหนก็ได้ Python เทียบ tuple ทีละตัว ตรงนี้ (4, B) เลย pop ก่อน (4, D) เพราะ "B" < "D" ส่วน node ที่เทียบกันไม่ได้ต้องมี counter คั่นระหว่างระยะกับ node แบบที่ NetworkX ทำ เรื่อง *path* ที่ต้นทุนเท่ากันเป็นอีกการตัดสินใจหนึ่ง: `<` แบบเคร่งจะเก็บเส้นทางแรกที่เจอ ส่วน OSPF เก็บ next hop ทุกตัวที่เสมอกันไว้ เพื่อกระจาย traffic ไปบนพวกมันได้

**หยุดก่อน** ถ้าสนใจแค่เป้าหมายเดียว ให้หยุดทันทีที่มันถูก *pop* ไม่ใช่ตอนที่ไปถึงมันครั้งแรก: F ถูกไปถึงครั้งแรกที่ 10 และค่อยลดลงเหลือ 8 ทีหลัง paper ของ Dijkstra ในปี 1959 ก็เขียนไว้แบบนี้: มันสร้าง shortest path จากจุดเริ่มตามลำดับความยาวจากน้อยไปมาก จนไปถึงเป้าหมาย

**A\*** สำหรับเป้าหมายเดียว A\* (Hart, Nilsson กับ Raphael, 1968) เรียง queue ด้วย d[v] + h(v) โดยที่ h(v) ประมาณระยะที่ยังต้องไปอีก เช่นระยะเส้นตรงบนแผนที่ ถ้า h ไม่เคยประมาณเกิน (มัน *admissible*) ระยะของเป้าหมายจะ optimal ตอนที่เป้าหมายถูก pop และถ้า h(u) ≤ w(u, v) + h(v) สำหรับทุก edge ด้วย (มัน *consistent*) ก็ไม่ต้องเปิด node ไหนใหม่อีกเลย ถ้า h = 0 มันก็คืออัลกอริทึมของ Dijkstra ส่วน h ที่ดีจะดึงการค้นหาเข้าหาเป้าหมาย เลย settle node น้อยลงมาก

**มาจากไหน** Edsger W. Dijkstra ออกแบบอัลกอริทึมนี้ในปี 1956 เพื่อสาธิตคอมพิวเตอร์ ARMAC เครื่องใหม่ในอัมสเตอร์ดัม โดยหาเส้นทางบนแผนที่แบบย่อของเมืองในเนเธอร์แลนด์ 64 เมือง ในบทสัมภาษณ์ปี 2001 เขาเล่าว่าคิดมันออกในราวยี่สิบนาทีที่ระเบียงร้านกาแฟ โดยไม่มีดินสอกับกระดาษ เขาตีพิมพ์มันในปี 1959 ใน paper สามหน้าใน *Numerische Mathematik* ที่แก้ปัญหา minimum spanning tree ด้วย และชอบมันมากกว่าวิธีของ Ford เพราะมันเก็บกิ่งไว้พร้อมกันน้อยกว่า และดูเหมือนจะใช้งานน้อยกว่ามาก ในนั้นไม่มี heap เลย: binary heap เพิ่งถูกตีพิมพ์ในปี 1964

### Weight ติดลบ

เหตุผลข้างบนต้องการให้ทุก weight อย่างน้อยเป็น 0 ใน directed graph ของขั้นที่ 4 ตัว S → A มีต้นทุน 2, S → B มีต้นทุน 3 และ B → A มีต้นทุน −2 ตัว A มีระยะชั่วคราวน้อยกว่า เลย settle ที่ 2 พอ B settle ที่ 3 แล้ว relax B → A ค่า 3 − 2 = 1 จะสั้นกว่า แต่ A เป็นค่า final ไปแล้ว โค้ดข้างล่างเลยปล่อยมันไว้ที่ 2 ส่วน NetworkX จะ raise error ตรงจังหวะนั้นแทน และเวอร์ชันของ Sedgewick กับ Wayne ก็ปฏิเสธ weight ติดลบตั้งแต่ก่อนเริ่ม

- **Bellman–Ford** relax ทุก edge V − 1 รอบ ใช้ O(V·E) และรับมือกับ weight ติดลบได้: หลังรอบที่ k ไม่มีระยะไหนแย่กว่าเส้นทางที่ดีที่สุดที่มีไม่เกิน k edge ทำให้มันเป็น [dynamic programming](../dynamic-programming/) บนจำนวน edge ถ้าทำอีกรอบแล้วยังมีระยะที่ลดลงได้อีก ก็พิสูจน์ได้ว่ามี negative cycle ที่ไปถึงได้จาก source ถ้ามีแบบนั้น ก็ไม่มี shortest path อยู่จริง เพราะวนเพิ่มอีกรอบก็ยิ่งถูกลง ในกราฟแบบไม่มีทิศทาง edge ติดลบเส้นเดียวก็เป็น cycle แบบนั้นแล้ว: ข้ามไปแล้วข้ามกลับ ส่วน distance-vector routing ของ RIP ก็มีพื้นฐานมาจาก Bellman–Ford
- **การบวกค่าคงที่เข้าไปในทุก weight ไม่ได้แก้ปัญหา** เส้นทางที่มี k edge จะเพิ่มขึ้น k เท่าของค่าคงที่ ทำให้เส้นทางที่มี edge น้อยกว่าได้เปรียบ ถ้าบวก 2 เข้าไปใน weight ของขั้นที่ 4 ตัว S → A จะมีต้นทุน 4 ส่วน S → B → A มีต้นทุน 5 + 0 = 5 อัลกอริทึมของ Dijkstra เลยเลือก S → A ที่จริง ๆ มีต้นทุน 2
- **อัลกอริทึมของ Johnson** (1977) ปรับ weight ได้ถูกต้อง โดยรัน Bellman–Ford รอบเดียวเพื่อให้ potential h(v) กับทุก node แล้ว w(u, v) + h(u) − h(v) จะไม่เคยติดลบ และเลื่อนทุกเส้นทางระหว่าง node สองตัวเดิมไปเท่ากัน หลังจากนั้นก็รันอัลกอริทึมของ Dijkstra จากแต่ละ node ได้
- **ใน DAG** ไม่ต้องปรับ weight เลย: relax node ตาม [topological order](../topological-sort/) ใช้ O(V + E) รวม weight ติดลบด้วย

## โค้ด

```python
import heapq
from math import inf


def dijkstra(graph, source):
    """Shortest distances from source. graph maps every node to a list of
    (neighbour, weight) pairs, and no weight may be negative."""
    dist = {node: inf for node in graph}
    prev = {node: None for node in graph}      # the neighbour that gave each distance
    dist[source] = 0
    heap = [(0, source)]
    settled = set()
    while heap:
        d, u = heapq.heappop(heap)             # the closest entry left
        if u in settled:
            continue                           # stale: u was settled with a smaller d
        settled.add(u)                         # d is final
        for v, w in graph[u]:
            if v not in settled and d + w < dist[v]:
                dist[v] = d + w                # relax the edge u-v
                prev[v] = u
                heapq.heappush(heap, (dist[v], v))   # no decrease-key: push again
    return dist, prev


def shortest_path(dist, prev, target):
    """The nodes on a shortest path to target, source first ([] if unreachable)."""
    if dist[target] == inf:
        return []
    path = [target]
    while prev[path[-1]] is not None:
        path.append(prev[path[-1]])
    return path[::-1]


edges = [("A", "B", 4), ("A", "C", 1), ("B", "C", 2), ("B", "D", 1), ("C", "D", 5),
         ("C", "E", 8), ("D", "E", 3), ("D", "F", 6), ("E", "F", 1)]
graph = {node: [] for node in "ABCDEF"}
for u, v, w in edges:                          # undirected: each edge works both ways
    graph[u].append((v, w))
    graph[v].append((u, w))

dist, prev = dijkstra(graph, "A")
print(dist)                                    # {'A': 0, 'B': 3, 'C': 1, 'D': 4, 'E': 7, 'F': 8}
print(shortest_path(dist, prev, "F"))          # ['A', 'C', 'B', 'D', 'E', 'F']
```

set `settled` คือกฎ "ไม่กลับไปดูอีก" ที่เขียนออกมาให้เห็นชัด: ถ้า weight ไม่ติดลบ edge ที่เข้าไปหา node ที่ settle แล้วก็ทำให้มันดีขึ้นไม่ได้อยู่แล้ว และถ้ามี weight ติดลบ ตรงนี้ก็คือจุดที่คำตอบผิดพอดี ทดสอบด้วย assert บนกราฟในไดอะแกรมจากทุก source, node เดียว, node ที่ไปไม่ถึง (∞ และ path ว่าง), ค่าที่เสมอกัน (เก็บเส้นทางแรกที่เจอ), weight เป็นศูนย์, parallel edge และ self-loop และเทียบกับ brute force ที่ไล่ทุก simple path บนกราฟสุ่ม 3,000 อันที่มีไม่เกิน 7 node ทั้งแบบมีทิศทางและไม่มีทิศทาง โดยมี weight ตั้งแต่ 0 ถึง 9 ส่วนบนกราฟของขั้นที่ 4 มันคืน 2 สำหรับ A ตรงที่ Bellman–Ford คืน 1 และหลังจากบวก 2 เข้าไปในทุก weight มันก็เลือก S → A

## Complexity

| | ต้นทุน | ทำไม |
|---|---|---|
| Worst case, binary heap (โค้ดข้างบน) | O((V + E) log V) | การ relax ที่สำเร็จแต่ละครั้ง push หนึ่ง entry ไม่เกินหนึ่งต่อ edge และทุก entry ถูก pop ครั้งเดียว push หรือ pop ใช้ O(log E) ก็คือ O(log V) เพราะ E < V² |
| Worst case, array แทน heap | O(V²) | V รอบ แต่ละรอบสแกนระยะชั่วคราวได้ถึง V ตัวเพื่อหาตัวที่เล็กที่สุด ส่วนการ relax edge เป็น O(1) มันชนะ heap ตอนที่ E ใกล้ V² |
| Worst case, Fibonacci heap | O(E + V log V) | decrease-key ใช้ O(1) แบบ amortized และการ pop แต่ละครั้งจาก V ครั้งใช้ O(log V) แบบ amortized (Fredman กับ Tarjan, 1987) |
| Best case | O(V + E) | ยังต้องตรวจทุก node และ edge ที่ไปถึงได้ แต่งานของ heap จะลดลงถ้า queue ยังเล็กอยู่ เช่นบน path |
| ทั่วไป | ต่ำกว่า worst case มาก | ถ้า weight สุ่ม การ relax หลายครั้งจะไม่สำเร็จ และยิ่งกราฟหนาแน่นก็ยิ่งไม่สำเร็จมาก: บนกราฟสุ่มที่มี 10,000 node และ 500,000 edge ตัว test ของเรา push ไป 41,272 entry หรือราว 4 ตัวต่อ node |
| Extra space | O(V + E) | d, prev และ settled set ใช้ O(V) ถ้าใช้ lazy deletion ตัว heap อาจเก็บได้หนึ่ง entry ต่อ edge (O(V) ถ้าใช้ decrease-key) |

O(E + V log V) คือขีดจำกัดในแง่ [Big-O](../big-o-notation/) หรือเปล่า? สำหรับการไล่ node ตามลำดับระยะ (สิ่งที่อัลกอริทึมของ Dijkstra ทำ) คำตอบโดยพื้นฐานคือใช่: Haeupler, Hladík, Rozhoň, Tarjan และ Tětek พิสูจน์ว่ามัน *universally optimal* สำหรับงานนั้นเมื่อ heap ของมันมี working-set bound แปลว่าบนทุกกราฟ มันเร็วเท่าที่อัลกอริทึมไหนจะเร็วได้ ต่างกันไม่เกินค่าคงที่ เมื่อ weight เป็น worst case ของกราฟนั้น แต่ถ้าเอาแค่ระยะอย่างเดียวก็ถูกกว่านี้ได้ ในปี 2025 Duan, Mao, Mao, Shu และ Yin ให้อัลกอริทึมแบบ deterministic ที่ใช้ O(E log^(2/3) V) สำหรับ directed graph ที่มี weight เป็นจำนวนจริงไม่ติดลบ ที่ทำได้แค่เทียบและบวก เป็นตัวแรกใน model นั้นที่ชนะ O(E + V log V) บนกราฟเบาบาง และ preprint ปี 2026 โดยสี่คนในนั้นลดลงเหลือ O(E √(log V · log log V)) บนกราฟเบาบาง ทั้งสองเป็นผลทางทฤษฎี ส่วน library ข้างล่างรันอัลกอริทึมแบบคลาสสิก

## ใช้ตอนไหนดี

- **Source เดียวและ weight ไม่ติดลบ**: ระยะจาก node หนึ่งไปทุก node หรือ path ไปเป้าหมายเดียว (หยุดเมื่อมัน pop) ระยะทางบนถนนและเวลาเดินทาง ต้นทุนและ delay ของ link และต้นทุนการเดินบนแผนที่เกม เข้าข่ายทั้งหมด
- **ทุก weight เท่ากัน**: ใช้ [breadth-first search](../breadth-first-search/) ที่เป็น O(V + E) กับ queue แบบ first-in, first-out ธรรมดา
- **Weight เป็นจำนวนเต็มเล็ก ๆ**: bucket queue ที่มีหนึ่ง list ต่อค่าระยะหนึ่งค่า ใช้แทน heap ได้ และ specification ของ IS-IS ก็ชี้เรื่องนี้ไว้สำหรับ metric ที่เล็กของมัน
- **เป้าหมายเดียวและมีค่าประมาณระยะที่เหลือที่ดี**: A\*
- **Query จำนวนมากบนกราฟใหญ่ที่ไม่ค่อยเปลี่ยน** เช่นเครือข่ายถนน: ให้ preprocess ไว้ก่อน ยกตัวอย่าง contraction hierarchies จะเพิ่ม shortcut edge ในขั้นที่ทำครั้งเดียว ทำให้แต่ละ query settle แค่ส่วนเล็ก ๆ ของกราฟ และ OSRM ก็มีมันให้ใช้ควบคู่กับอัลกอริทึมของ Dijkstra แบบหลายระดับ
- **ทุกคู่**: ถ้ากราฟเบาบางก็รันมันจากทุก node รวมแล้ว O(V (V + E) log V) ส่วน O(V³) ของ Floyd–Warshall เหมาะกับกราฟหนาแน่น
- **Weight ติดลบ**: Bellman–Ford หรือการปรับ weight ของ Johnson สำหรับทุกคู่ และถ้าเป็น DAG ก็ใช้ topological order

## ได้อะไร เสียอะไร

- **ใช้ได้แค่ weight ที่ไม่ติดลบ และพังแบบเงียบ ๆ** อัลกอริทึมแบบพื้นฐานคืนระยะที่ผิดโดยไม่มี error อะไรเลย ให้ตรวจ weight ก่อนแบบที่ `DijkstraSP` ของ Sedgewick กับ Wayne ทำ หรือใช้ Bellman–Ford
- **Lazy deletion แลก memory กับความเรียบง่าย** heap อาจโตไปถึงหนึ่ง entry ต่อ edge และทุก entry ที่ stale ก็เสียการ pop หนึ่งครั้ง ส่วน decrease-key เก็บหนึ่ง entry ต่อ node แต่ต้องมี index ของตำแหน่งใน heap
- **มันสำรวจไปทุกทิศ** พื้นที่ที่ settle แล้วจะโตรอบ source เป็นวงกลม และ query แบบจุดต่อจุดจะ settle ทุก node ที่อยู่ใกล้กว่าเป้าหมาย บนกราฟถนนขนาดทั้งทวีปอาจเป็นส่วนใหญ่ของกราฟ ตัว A\*, bidirectional search และ preprocessing มีไว้แก้เรื่องนี้
- **ต้นทุนที่เท่ากันต้องตัดสินใจ** `<` แบบเคร่งเก็บ predecessor ตัวเดียวต่อ node ถ้าจะเก็บทุก shortest path ไว้ใช้กับ multipath routing หรือไว้นับ ให้เก็บ list ของ predecessor แล้วเพิ่มเข้าไปเมื่อเสมอกัน แบบที่ OSPF ทำกับ next hop และ NetworkX ทำเมื่อขอ predecessor
- **Weight แบบ floating-point มีการปัดเศษ** ผลรวมของ float อาจต่างกันที่ bit สุดท้ายตามลำดับการบวก ค่าที่เกือบเสมอกันเลยออกได้ทั้งสองทาง และเอกสารของ NetworkX ก็เตือนว่า rounding error ทำให้เกิดปัญหาได้ ต้นทุนแบบจำนวนเต็มอย่าง link metric ของ OSPF เลี่ยงปัญหานี้ได้
- **มีการเปลี่ยนแปลงก็ต้องคำนวณใหม่** เมื่อ weight เปลี่ยน คำตอบง่าย ๆ คือรันใหม่ทั้งหมด เวอร์ชันแบบ incremental มีอยู่ แต่ specification ของ IS-IS เลือกคำนวณใหม่ทั้งหมด โดยบอกว่าแค่ link เปลี่ยนสองสามเส้น การอัปเดตแบบ incremental ก็อาจแพงกว่าแล้ว

## ข้อควรรู้ตอนลงมือทำ

- **Python**: ใช้ `heapq` แบบข้างบน ส่วน `single_source_dijkstra`, `dijkstra_path` และ `bidirectional_dijkstra` ของ NetworkX push entry แบบ (distance, counter, node) เพื่อไม่ให้ต้องเทียบ node กันเลย ข้าม node ที่ settle แล้ว และ raise `ValueError` ("Contradictory paths found") เมื่อ edge จะทำให้ node ที่ settle แล้วสั้นลง แบบนี้เลยจับกราฟของขั้นที่ 4 ได้ ถ้าให้เป้าหมายไว้ การค้นหาแบบ single-source จะหยุดทันทีที่ pop มันออกมา
- **Java และ C++**: ทั้ง `java.util.PriorityQueue` และ `std::priority_queue` ไม่มี decrease-key เลยนิยมใช้ lazy deletion ตัว `std::priority_queue` เก็บตัวที่ใหญ่ที่สุดไว้ด้านบนโดย default ถ้าจะใช้เป็น min-heap ให้ส่ง `std::greater` เข้าไป
- **Database**: `pgr_dijkstra` ของ pgRouting รันอัลกอริทึมนี้ใน PostgreSQL บน SQL query ของ edge โดยใช้ Boost Graph Library และถือว่า edge ที่ต้นทุนติดลบไม่มีอยู่ ทำให้ `reverse_cost` ที่ติดลบเปลี่ยนถนนเป็นทางเดียว Neo4j Graph Data Science มี Dijkstra แบบ source-target และแบบ single-source บน binary heap และใช้ implementation เดียวกันนั้นกับ A\*, k shortest paths ของ Yen และ weighted betweenness centrality
- **Link-state routing**: router OSPF ทุกตัวสร้าง shortest-path tree ที่มีตัวเองเป็น root ด้วยอัลกอริทึมของ Dijkstra (RFC 2328, section 16.1) "candidate list" ของมันคือ priority queue ตัว candidate ที่ใกล้ที่สุดรับประกันว่าสั้นที่สุด ต้นทุนของ interface ต้องมากกว่าศูนย์ และ next hop ที่เสมอกันจะถูกเก็บไว้ทั้งหมดสำหรับ equal-cost multipath ที่เป็น [load balancing](../load-balancing/) ในระดับเครือข่าย IS-IS ก็ทำงานแบบเดียวกัน draft ของ ISO specification ของมัน ที่ถูกตีพิมพ์ซ้ำเป็น RFC 1142 และตอนนี้เป็น historic ให้ต้นทุนเป็นกำลังสองของจำนวน node หรือจำนวน link คูณ log ของจำนวน node สำหรับเครือข่ายที่เบาบาง และบอกว่า metric ดั้งเดิมที่เล็กของมัน (ไม่เกิน 63 ต่อ link และ 1,023 ต่อ path) ทำให้ใช้หนึ่ง list ต่อค่า metric แทนการ sort ได้ ส่วน traffic-engineering extension ที่ตอนนี้คือ RFC 5305 ขยาย link metric ของ IS-IS เป็น 24 bit
- **Path ตาม latency**: IGP Flexible Algorithm (RFC 9350) ให้ router รันการคำนวณ shortest-path-first แบบเดิมบน delay ต่ำสุดของ link ทิศทางเดียว แทน metric ที่ตั้งค่าไว้ ทำให้ traffic ที่ไวต่อ delay ได้ path latency ต่ำเป็นของตัวเอง
- **Route planning**: OSRM หรือ Open Source Routing Machine มี pipeline แบบ contraction hierarchies (CH) และ multi-level Dijkstra (MLD) และแนะนำ MLD เป็นค่าตั้งต้น
- **เกม**: query `findPath` ใน Recast & Detour รัน A\* บน polygon ของ navigation mesh โดยมี open list เป็น binary heap และใช้ระยะเส้นตรง (คูณด้วย 0.999) เป็นค่าประมาณ ตามที่ project บอกไว้ Recast อยู่เบื้องหลังฟีเจอร์ navigation ของ Unity, Unreal, Godot และ O3DE
