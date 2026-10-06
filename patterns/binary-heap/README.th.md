## ปัญหา

ซอฟต์แวร์จำนวนมากถามคำถามเดิมซ้ำไปเรื่อย ๆ: ของที่รออยู่ชิ้นไหนต้องมาก่อน? event loop ยิง timer ที่จะหมดเวลาเร็วที่สุด job scheduler เริ่ม task ที่ deadline เร็วที่สุด route planner ขยาย node ที่ใกล้ที่สุดที่ยังไม่ได้สรุป และ query ที่มี `ORDER BY … LIMIT 10` ก็เก็บแค่สิบแถวที่ดีที่สุด ของใหม่เข้ามาเรื่อย ๆ ขณะที่ของเก่าออกไป sort ครั้งเดียวเลยไม่พอ และโครงสร้างที่นึกออกง่าย ๆ ก็เอียงไปข้างเดียว:

- **sorted array** ส่งของที่เล็กที่สุดออกมาได้ใน O(1) แต่การ insert ทุกครั้งต้องเลื่อนของถึง n ตัว
- **unsorted list** insert ได้ใน O(1) แต่การเอาออกทุกครั้งต้องไล่ดูทั้ง n ตัวเพื่อหาตัวที่เล็กที่สุด
- **balanced search tree** ทำได้ทั้งสองอย่างใน O(log n) แต่มันรักษาลำดับที่เรียงครบทั้งหมด ทั้งที่ queue ไม่เคยอ่าน และต้องจ่ายด้วย pointer กับการ rebalance

binary heap รักษาลำดับไว้แค่เท่าที่คำถาม "อะไรมาต่อ?" ต้องใช้: O(log n) สำหรับเพิ่มหรือเอาออก O(1) สำหรับดูตัวที่เล็กที่สุด ทั้งหมดอยู่ใน array ธรรมดาตัวเดียว

## ทำงานยังไง

**กฎสองข้อ** min-heap คือ binary tree ที่มี

- **heap order**: parent ทุกตัวน้อยกว่าหรือเท่ากับ child ของมัน ตัวที่เล็กที่สุดเลยเป็น root เสมอ (*max-heap* กลับการเทียบ แล้วเก็บตัวที่ใหญ่ที่สุดไว้บนสุด)
- **shape**: tree เป็นแบบ *complete*: ทุกระดับเต็ม ยกเว้นระดับสุดท้ายที่เติมจากซ้าย

กฎเรื่อง shape คือสิ่งที่ทำให้ heap ต้นทุนต่ำ ตัว complete tree ไม่มีช่องโหว่ เลยเก็บทีละระดับลงใน array ได้: root อยู่ที่ index 0, child ของมันอยู่ที่ 1 กับ 2, child ของสองตัวนั้นอยู่ที่ 3 ถึง 6 แล้วก็ต่อไปเรื่อย ๆ link เป็นการคำนวณแทนที่จะเป็น pointer: child ของ index `i` อยู่ที่ `2i + 1` กับ `2i + 2` และ parent ของมันอยู่ที่ `(i − 1) // 2` (ตำราที่นับจาก 1 ใช้ `2i`, `2i + 1` และ `i // 2`) tree เตี้ยที่สุดเท่าที่จะเป็นได้เสมอ: ของ n ตัวเติม ⌊log₂ n⌋ + 1 ระดับ คือ 4 ระดับสำหรับของ 8 ตัวใน diagram

**Heap order ไม่ใช่ลำดับแบบ search tree** ตัว [binary search tree](../binary-search-tree/) จัดลำดับทุก node เทียบกับ subtree ทั้งก้อน key ที่เล็กกว่าอยู่ซ้าย ที่ใหญ่กว่าอยู่ขวา lookup เลยเดินตามเส้นทางเดียว และการเดินแบบ in-order ก็ได้ key ที่เรียงแล้ว ส่วน heap จัดลำดับแค่ parent แต่ละตัวเทียบกับ child ของมันเอง ใน diagram ตัว 4 อยู่เหนือ 7 กับ 5 แต่อยู่ข้าง ๆ 2 ที่เล็กกว่า และไม่มีอะไรจัดลำดับ subtree ของ 4 เทียบกับของ 2 เลย heap เลยบอกไม่ได้ว่ามี x อยู่หรือไม่ โดยไม่เสี่ยงต้องไล่ดูทุก node และ list ของตามลำดับไม่ได้ถ้าไม่ pop ออกมา ที่ได้กลับมาคือมัน balanced เสมอ และไม่ต้องใช้อะไรนอกจาก array

**Push: sift up** ต่อของใหม่ไว้ที่ index n คือช่องว่างถัดไป แบบนี้ shape ก็ยังถูกอยู่ ตอนนี้มีคู่เดียวที่อาจผิด heap order ได้ คือของใหม่กับ parent ของมัน ตราบที่ของใหม่ยังเล็กกว่า parent ก็สลับกันแล้วขึ้นไป หยุดเมื่อถึง root หรือเมื่อ parent เล็กกว่าหรือเท่ากัน ทุกขั้น heap ถูกต้องหมด ยกเว้นที่อาจผิดระหว่างตัวที่กำลังขยับกับ parent ของมัน พอ loop หยุด heap ทั้งก้อนก็ถูกต้องอีกครั้ง เป็นการเทียบหนึ่งครั้งและสลับไม่เกินหนึ่งครั้งต่อระดับ: O(log n) ในภาษาของ [Big-O](../big-o-notation/) ใน diagram ตัว 3 เข้ามาที่ index 7 ผ่าน 7 แล้วผ่าน 4 และไปหยุดใต้ 1: เทียบ 3 ครั้ง สลับ 2 ครั้ง

**Pop: sift down** ตัวที่เล็กที่สุดคือ `a[0]` พอเอามันออกก็เหลือช่องว่างข้างบน ให้ย้ายตัวสุดท้ายขึ้นไปที่ root แบบนี้ tree ก็ยัง complete แล้วปล่อยให้มันจมลง: หา child ตัวที่เล็กกว่า ถ้า child ตัวนั้นเล็กกว่าตัวที่จม ก็สลับกันแล้วลงไปต่ออีกหนึ่งระดับ ต้องเป็น child ตัวที่*เล็กกว่า* เพราะถ้าดันตัวที่ใหญ่กว่าขึ้นไป มันจะไปอยู่เหนือพี่น้องที่เล็กกว่ามัน ตอนนี้ heap ถูกต้องหมด ยกเว้นที่อาจผิดระหว่างตัวที่กำลังขยับกับ child ของมัน และ loop หยุดที่ leaf หรือเมื่อ child ทั้งสองตัวใหญ่กว่าหรือเท่ากัน เทียบสองครั้งต่อระดับ รวมแล้วไม่เกินราว 2 log₂ n การ pop ใน diagram คืน 1 ย้าย 7 ขึ้นไปที่ root แล้วให้มันจมผ่าน 2 และ 6 ลงไปที่ index 5 ที่เป็น leaf: เทียบ 4 ครั้ง สลับ 2 ครั้ง

**Peek และ replace** `peek` แค่อ่าน `a[0]` มี operation แบบรวมสองตัวที่ทำงานของ push กับ pop โดย sift แค่ครั้งเดียว *Pushpop* (push x แล้ว pop) คืน x ทันทีถ้ามันไม่ใหญ่กว่า root ไม่อย่างนั้นก็คืน root เอา x ไปไว้แทน แล้ว sift มันลง *Replace* (pop แล้ว push) คืน root เสมอ แล้ว sift ของใหม่ลงจากข้างบน ขนาดเลยไม่เคยเปลี่ยน และของที่คืนออกมาอาจใหญ่กว่าของที่ใส่เข้าไป `heapq` ของ Python เรียกสองตัวนี้ว่า `heappushpop` กับ `heapreplace`

**Heapify ใน O(n)** การสร้าง heap ด้วยการ push n ครั้งเสีย O(n log n) ใน worst case คือตอนที่ของใหม่ทุกตัวเป็นค่าต่ำสุดใหม่และไต่ขึ้นไปถึง root การสร้างแบบ bottom-up ที่รู้จักกันในชื่อวิธีของ Floyd ทำได้ดีกว่า: อ่าน array เป็น complete tree ที่ลำดับยังมั่วอยู่ แล้ว sift down ทุก parent ตั้งแต่ตัวสุดท้าย (index n // 2 − 1) ย้อนกลับไปถึง root พอถึงคิวของ node ไหน subtree ทั้งสองข้างใต้มันก็เป็น heap อยู่แล้ว sift down ครั้งเดียวเลยแก้ subtree ของมันได้ทั้งก้อน งานส่วนใหญ่ถูกเพราะ node ส่วนใหญ่อยู่ใกล้ข้างล่าง: ครึ่งหนึ่งของ node เป็น leaf และไม่ขยับเลย หนึ่งในสี่จมได้ไม่เกินหนึ่งระดับ หนึ่งในแปดได้สองระดับ แล้วก็ต่อไปเรื่อย ๆ รวมแล้วสลับไม่เกิน n · (1/4 + 2/8 + 3/16 + …) = n ครั้ง เพราะอนุกรมนี้รวมได้ 1 และเทียบไม่เกินสองเท่าของนั้น กับของล้านตัวที่เรียงจากมากไปน้อย (worst case ของการ push) การทดสอบของเราพบว่า push n ครั้งสลับ 17,951,445 ครั้ง ส่วน heapify แบบ bottom-up สลับ 999,988 ครั้ง

**Heapsort** การ pop ทุกตัวออกมาจะได้ของตามลำดับ และ heapsort ก็มีแค่นั้นเอง: heapify ใน O(n) แล้ว pop n ครั้ง ครั้งละ O(log n) รวมเป็น O(n log n) กับทุก input J. W. J. Williams ตีพิมพ์มันในปี 1964 พร้อมกับตัว heap แบบใช้ array เอง และ Robert W. Floyd ก็ปรับปรุงมันใน *Treesort 3* ในปีเดียวกัน รูปแบบที่ใช้จริงทำงานแบบ in place ด้วย *max-heap*: heapify array แล้วสลับ root (ตัวที่ใหญ่ที่สุด) กับตัวสุดท้ายของ heap ซ้ำไปเรื่อย ๆ ลดขนาด heap ลงหนึ่ง แล้ว sift root ตัวใหม่ลง ส่วนที่เรียงแล้วโตจากท้าย array ขณะที่ heap หดอยู่ข้างหน้า พื้นที่เพิ่มเลยเป็น O(1) มันไม่ stable: การสลับระยะไกลทำให้ key ที่เท่ากันเปลี่ยนลำดับ

## โค้ด

```python
class MinHeap:
    """A binary min-heap in a plain list: the smallest item is always a[0]."""

    def __init__(self, items=()):
        self.a = list(items)
        for i in reversed(range(len(self.a) // 2)):    # bottom-up heapify: O(n)
            self.sift_down(i)

    def __len__(self):
        return len(self.a)

    def peek(self):
        return self.a[0]                       # O(1); IndexError when empty

    def push(self, x):
        self.a.append(x)                       # the next free slot keeps the tree complete
        self.sift_up(len(self.a) - 1)

    def pop(self):
        last = self.a.pop()                    # IndexError when empty
        if not self.a:
            return last
        top, self.a[0] = self.a[0], last       # the last item takes over the root
        self.sift_down(0)
        return top

    def sift_up(self, i):                      # swap with the parent while smaller
        a = self.a
        while i > 0:
            p = (i - 1) // 2
            if a[p] <= a[i]:
                break
            a[i], a[p] = a[p], a[i]
            i = p

    def sift_down(self, i):                    # swap with the smaller child while larger
        a, n = self.a, len(self.a)
        while 2 * i + 1 < n:
            c = 2 * i + 1
            if c + 1 < n and a[c + 1] < a[c]:
                c += 1
            if a[i] <= a[c]:
                break
            a[i], a[c] = a[c], a[i]
            i = c


h = MinHeap([1, 4, 2, 7, 5, 6, 9])            # already a heap, so heapify moves nothing
h.push(3)
print(h.a)                                     # [1, 3, 2, 4, 5, 6, 9, 7]
print(h.pop(), h.a)                            # 1 [2, 3, 6, 4, 5, 7, 9]
print([h.pop() for _ in range(len(h))])        # [2, 3, 4, 5, 6, 7, 9]

h = MinHeap([5, 9, 1, 7, 3, 8, 2])             # heapsort by popping
print([h.pop() for _ in range(len(h))])        # [1, 2, 3, 5, 7, 8, 9]
```

sift ทั้งสองแบบหยุดเมื่อเสมอกัน (`<=`) ทำให้ประหยัดการสลับ เมื่อทดสอบเทียบกับ `heapq` บนข้อมูลสุ่ม ตัว list จะตรงกับของ `heapq` ทุกตัวหลังการ push, pop และ heapify ถ้า key ไม่ซ้ำกัน ถ้ามี key ซ้ำ การ pop อาจทิ้ง key ที่เท่ากันไว้คนละที่ แต่ทั้งสองตัวก็ pop ค่าเดียวกันออกมาเสมอ heap ที่ว่างโยน `IndexError` เหมือน `heapq` ส่วน sort ข้างบนสร้าง list ตัวที่สอง เวอร์ชัน in place จะเก็บ max-heap ไว้ใน list ของ input เอง ตามที่อธิบายไว้ในหัวข้อทำงานยังไง

## Complexity

| Operation | Time | ทำไม |
|---|---|---|
| `peek` | O(1) | ตัวที่เล็กที่สุดอยู่ที่ `a[0]` เสมอ |
| `push` | O(log n) | เทียบหนึ่งครั้งต่อระดับระหว่างทางขึ้น และของ n ตัวเติมได้แค่ ⌊log₂ n⌋ + 1 ระดับ |
| `pop` | O(log n) | เทียบสองครั้งต่อระดับระหว่างทางลง |
| pushpop, replace | O(log n) | sift ครั้งเดียวแทนสองครั้ง |
| heapify (bottom-up) | O(n) | node ส่วนใหญ่อยู่ใกล้ข้างล่าง และจมได้แค่หนึ่งหรือสองระดับ: สลับน้อยกว่า n ครั้ง |
| push n ครั้ง | O(n log n) | worst case คือตอนที่ของใหม่แต่ละตัวเป็นค่าต่ำสุดใหม่ ส่วน input สุ่มถูกกว่าโดยเฉลี่ย |
| หา x, list ตามลำดับ | O(n), O(n log n) | heap order ไม่ได้บอกอะไรเกี่ยวกับพี่น้อง เลยไม่มีทางลัด |

Heapsort:

| | ต้นทุน | ทำไม |
|---|---|---|
| Best case | O(n log n) | ถ้า key ไม่ซ้ำกัน การ pop ส่วนใหญ่ก็ยังให้ตัวที่ย้ายขึ้นไปจมลงมาเกือบสุด มีแค่ key ที่เท่ากันจำนวนมากที่ช่วยได้: ถ้า key เท่ากันหมดจะใช้ O(n) เมื่อ sift หยุดตอนเสมอ |
| Average case | O(n log n) | เทียบราว 2n log₂ n ครั้ง |
| Worst case | O(n log n) | ไม่มี input ไหนที่แย่สำหรับมัน: เทียบไม่เกินราว 2n log₂ n ครั้ง |
| พื้นที่เพิ่ม | O(1) | เวอร์ชัน in place เก็บ heap ไว้ใน array ของ input และไม่ต้องใช้ recursion ส่วนเวอร์ชัน push แล้ว pop ข้างบนใช้ list ตัวที่สองขนาด n ตัว |
| Stable | ไม่ | การสลับระหว่างช่องที่อยู่ห่างกันทำให้ key ที่เท่ากันเปลี่ยนลำดับ |
| In place | ใช่ | heap อยู่ข้างหน้า ของที่เรียงแล้วโตอยู่ข้างหลัง |

## ใช้ตอนไหนดี

- **ต้องหาตัวที่เล็กที่สุด (หรือใหญ่ที่สุด) ซ้ำ ๆ ในชุดที่เปลี่ยนไปเรื่อย ๆ**: timer, scheduler, simulation แบบ event-driven, job queue ภายใน process เดียว
- **การค้นหาใน graph ที่ขยาย frontier ตามต้นทุน**: shortest path ของ Dijkstra, minimum spanning tree ของ Prim และ A* search ล้วน pop node ใน frontier ที่ถูกที่สุดออกมาเป็นตัวถัดไป
- **Top-k บน stream**: เก็บ min-heap ของ k ตัวที่ใหญ่ที่สุดที่เจอมาจนถึงตอนนี้ แล้ว replace root ของมันทุกครั้งที่มีตัวที่ใหญ่กว่าเข้ามา ใช้เวลา O(n log k) และ memory O(k) ไม่ว่า stream จะยาวแค่ไหน
- **Running median**: max-heap ถือครึ่งล่าง และ min-heap ถือครึ่งบน rebalance ให้ขนาดต่างกันไม่เกินหนึ่ง แล้ว median ก็จะอยู่บนสุดของตัวใดตัวหนึ่งหรือทั้งสองตัว
- **Merge stream ที่เรียงแล้ว k ตัว** (ไฟล์ log, sorted run ของ external sort, ผลลัพธ์จาก shard): heap ของ head ปัจจุบัน k ตัวให้ของตัวถัดไปได้ใน O(log k) และของ N ตัวใน O(N log k)
- **Sort ที่ต้องการขอบเขต O(n log n) แบบตายตัวและพื้นที่เพิ่ม O(1)** ถ้าไม่สนเรื่อง stability
- **ไม่ใช่** สำหรับหาของด้วย key (ใช้ [hash table](../hash-table/)) สำหรับเดินผ่านของตามลำดับหรือตอบ range query (ใช้ search tree หรือ sorted array) หรือสำหรับ priority ระหว่าง service ที่ pattern [Priority Queue](../priority-queue/) พึ่งความสามารถของ broker หรือ queue แยกกัน แทนที่จะเป็น heap ใน memory

## ได้อะไร เสียอะไร

- **Key ที่เท่ากันออกมาแบบไม่มีลำดับแน่นอน** heap ไม่ stable และ queue ใน library ที่สร้างบนมันก็ไม่ stable เหมือนกัน: `PriorityQueue` ของ Java ตัดสินตอนเสมอแบบไหนก็ได้ และ `PriorityQueue` ของ .NET ก็ไม่สัญญาว่า priority ที่เท่ากันจะเข้าก่อนออกก่อน ถ้าลำดับสำคัญ ให้เพิ่มตัวนับการ insert เข้าไปใน key แบบที่เอกสารของ `heapq` ทำด้วย entry `(priority, count, task)`
- **ไม่มีการค้นหา และตัวมันเองไม่มี decrease-key** ถ้าจะเปลี่ยน priority ของของชิ้นหนึ่งต้องรู้ตำแหน่งของมัน: เก็บ map จากของไปหา index แล้ว update ทุกครั้งที่สลับ จากนั้นก็ sift ขึ้นหรือลงหลังเปลี่ยน ใช้ O(log n) ตัว `heap.Fix` ของ Go ก็ทำงานแบบนี้ โดยของแต่ละชิ้นเก็บ index ของตัวเองไว้ และ `ScheduledThreadPoolExecutor` ของ Java ก็เหมือนกัน: task queue ของมันจด heap index ของแต่ละ task ไว้ การยกเลิก task เลยเสียแค่ O(log n) แทนการค้นหาแบบ linear ทางเลือกแบบ lazy คือ push entry ใหม่ที่มี priority ใหม่ แล้ว mark ตัวเก่าว่า stale จากนั้นก็ข้าม entry ที่ stale เมื่อมันขึ้นมาถึงบนสุด วิธีนี้ง่ายกว่า แต่ทำให้ heap โตขึ้นทุกครั้งที่ update: algorithm ของ Dijkstra จะถือ entry ได้ถึงหนึ่งตัวต่อหนึ่ง edge แต่ก็ยังใช้เวลา O(E log V) เพราะ log E ≤ 2 log V
- **Locality** ตัว child ของ node i อยู่ที่ 2i + 1 กับ 2i + 2 พอ heap ใหญ่กว่า cache การ sift ลึก ๆ ก็ไปตกคนละส่วนของ array ในทุกระดับ **d-ary heap** ที่มี child 4 หรือ 8 ตัวต่อ node เตี้ยกว่า: push ถูกลง ส่วน pop ต้องเทียบ child มากขึ้นต่อระดับ และพี่น้องอยู่ใน cache line เดียวกัน runtime ของ Go เก็บ timer ไว้ใน heap แบบ 4-ary และ `PriorityQueue` ของ .NET ก็เป็น heap แบบ 4-ary
- **Heapsort เทียบกับ quicksort และ merge sort** heapsort รับประกัน O(n log n) ด้วยพื้นที่เพิ่ม O(1) แต่มันไม่ stable และมักแพ้ [quicksort](../quicksort/) ที่จูนมาดีบน array เพราะ loop partition ของ quicksort ไล่อ่าน memory ตามลำดับ นี่คือเหตุผลที่ library ใช้มันเป็นตาข่ายรองรับ: introsort รัน quicksort แล้วสลับไปใช้ heapsort เมื่อ recursion ลึกเกินไป [Merge sort](../merge-sort/) stable และอ่านตามลำดับ แต่ต้องใช้พื้นที่เพิ่ม O(n) ส่วน [sort แบบง่าย ๆ](../elementary-sorts/) ชนะได้แค่กับ input เล็ก ๆ
- **heap ที่หรูกว่าแลกกับการทิ้ง array** Fibonacci heap (Fredman กับ Tarjan) ทำ decrease-key ได้ใน O(1) แบบ amortized ทำให้ขอบเขตของ Dijkstra ลดลงเป็น O(E + V log V) แต่มันเชื่อม node ด้วย pointer แทนที่จะอัดไว้ใน array ตัวเดียว

## ข้อควรรู้ตอนลงมือทำ

- **Python**: `heapq` เปลี่ยน list ธรรมดาให้เป็น min-heap: `heappush`, `heappop`, `heappushpop`, `heapreplace` และ `heapify` ที่ใช้เวลา linear โดยมี `heap[0]` เป็นตัวที่เล็กที่สุด Python 3.14 เพิ่มเวอร์ชัน max-heap (`heapify_max`, `heappush_max`, `heappop_max`, `heappushpop_max` และ `heapreplace_max`) ก่อนหน้านั้นเทคนิคที่ใช้กันคือกลับเครื่องหมายของ key ส่วน `merge`, `nsmallest` และ `nlargest` ก็สร้างบน heap เหมือนกัน pop ของมันเป็นอีกแบบ: แทนที่จะหยุดก่อน มันดัน child ตัวที่เล็กกว่าขึ้นไปเรื่อย ๆ จนสุดถึง leaf แล้ววางตัวสุดท้ายไว้ตรงนั้นและ sift มันกลับขึ้นไป เพราะตัวที่ย้ายขึ้นไปที่ root มักใหญ่ comment ใน source ของมันบอกว่าเทียบราว 8,700 ครั้งแทน 15,000 ครั้งสำหรับการ pop 1,000 ครั้งบนข้อมูลสุ่ม `asyncio` เก็บ callback ที่ตั้งเวลาไว้ด้วย `call_later` และ `call_at` ไว้ใน `heapq` ที่เรียงตามเวลาที่ถึงกำหนด
- **Java**: `PriorityQueue` คือ binary heap ที่อยู่บน array และใช้การคำนวณ index แบบเดียวกับข้างบน head คือ element ที่น้อยที่สุดตามลำดับธรรมชาติหรือตาม `Comparator` ตัว `offer` กับ `poll` เป็น O(log n) ส่วน `peek` เป็น O(1) แล้ว `remove(Object)` กับ `contains` เป็น linear และมันไม่ thread-safe (`PriorityBlockingQueue` thread-safe)
- **C++**: `std::priority_queue` ห่อ container (ค่า default คือ `std::vector`) และเก็บตัวที่*ใหญ่ที่สุด*ไว้บนสุด เพราะ comparator ค่า default ของมันคือ `std::less` ถ้าจะได้ min-heap ให้ส่ง `std::greater` เข้าไป algorithm ข้างใต้ใช้กับ random-access range ไหนก็ได้: `std::make_heap` (เทียบไม่เกิน 3n ครั้ง), `push_heap`, `pop_heap` (ไม่เกิน 2 log n) และ `sort_heap` ส่วน decrease-key ไม่มีให้ ส่วน `std::sort` ต้องเป็น O(n log n) ใน worst case ตั้งแต่ C++11 และ library ทำได้ด้วย introsort กับ hybrid แบบเดียวกัน (libc++ ของ LLVM เพิ่งทำได้ตั้งแต่ LLVM 14)
- **Go**: `container/heap` ทำงานบน slice type ของเราเองผ่าน `heap.Interface` (`sort.Interface` บวก `Push` กับ `Pop`) และเก็บตัวที่น้อยที่สุดตาม `Less` ไว้ที่ index 0 ตัว `Init` เป็น O(n) และ `Push`, `Pop`, `Remove` กับ `Fix` เป็น O(log n) ส่วน sort แบบไม่ stable ของ Go (`sort.Sort`, `slices.Sort`) ใช้ pattern-defeating quicksort ที่ถอยไปใช้ heapsort เมื่อ pivot ออกมาไม่ดีหลายครั้งเกินไป
- **.NET**: `PriorityQueue<TElement, TPriority>` คือ min-heap แบบ 4-ary ที่อยู่บน array และ dequeue priority ที่ต่ำที่สุดออกก่อน `Array.Sort` คือ introsort: insertion sort สำหรับ partition ที่มีไม่เกิน 16 ตัว, heapsort เมื่อจำนวน partition เกิน 2 log n, และ quicksort ในกรณีอื่น
- **Event loop และ scheduler**: libuv (event loop ใต้ Node.js) เก็บ timer ไว้ใน binary min-heap และ `ScheduledThreadPoolExecutor` ของ Java เรียง task ที่ถูกหน่วงไว้ใน heap ตามที่อธิบายไว้ในหัวข้อได้อะไร เสียอะไร
- **Database**: เมื่อการ sort ของ PostgreSQL มี `LIMIT` และ input โตเกินสองเท่าของ limit หรือเกินงบ memory มันจะสลับไปใช้ bounded heap ที่เก็บแค่แถวที่ดีที่สุด แล้ว `EXPLAIN ANALYZE` ก็รายงาน sort method เป็น `top-N heapsort` ส่วน external sort จะ merge sorted run ผ่าน heap ของ head ของแต่ละ run ดู [Merge Sort](../merge-sort/)
- **Routing**: protocol แบบ link-state อย่าง OSPF สร้าง shortest-path tree ของแต่ละ router ด้วย algorithm ของ Dijkstra (RFC 2328) และ algorithm นี้ต้องใช้ operation ของ heap พอดี: pop router ที่ใกล้ที่สุดที่ยังไม่ได้สรุป แล้วลดระยะทางชั่วคราวของเพื่อนบ้านของมัน
