## ปัญหา

function หนึ่งใช้เวลา 40 ms กับข้อมูลหนึ่งพัน record บน laptop ของเรา ถ้าเป็นหนึ่งล้านจะใช้เวลาเท่าไร นาฬิกาจับเวลาตอบไม่ได้: มันวัดได้แค่เครื่องเดียว ภาษาเดียว และ input ขนาดเดียว โค้ดที่เสร็จในพริบตาใน unit test อาจใช้เวลาเป็นนาทีบน production ถ้างานของมันโตตามกำลังสองของ input และเราอยากเห็นเรื่องนี้ล่วงหน้าก่อนข้อมูลจะมาถึง โดยไม่ต้อง benchmark ทุกขนาดบนทุกเครื่อง

Big-O notation อธิบายว่า**จำนวนขั้นพื้นฐาน**เพิ่มขึ้นยังไงเมื่อขนาดของ input **n** โตขึ้น มันตั้งใจไม่สนสิ่งที่ไม่ได้เปลี่ยนรูปร่างของการเติบโตนั้น: ความเร็วของ hardware ภาษา และ overhead ที่คงที่

## ทำงานยังไง

**นับขั้นเป็น function ของ n** เลือกหน่วยของงานที่ใช้เวลาคงที่ เช่น อ่าน array หนึ่งช่อง เทียบสองค่า หรือย้าย item หนึ่งตัว แล้วนับว่าอัลกอริทึมต้องใช้กี่หน่วยกับ input ขนาด n จากนั้นเก็บไว้แค่รูปร่างของจำนวนที่นับได้:

- **ตัดตัวคูณที่เป็นค่าคงที่ทิ้ง** 3n + 5 ขั้นกับ n ขั้นโตแบบเดียวกัน ทั้งสองแบบเลยเป็น O(n) ค่าคงที่ขึ้นกับเครื่องและ implementation ไม่ได้ขึ้นกับอัลกอริทึม
- **เก็บพจน์ที่โตเร็วที่สุดไว้** n² + n คือ O(n²): พอ n ใหญ่แล้ว พจน์ n² ก็แทบจะเป็นทั้งหมด
- **ไม่ต้องสนฐานของ log** log₁₀ n คือ log₂ n หารด้วยราว 3.32 ก็แค่ตัวคูณคงที่อีกตัว หน้านี้ใช้ฐาน 2 ตลอด เพราะเป็นฐานที่เป็นธรรมชาติของการแบ่งครึ่ง: log₂ 16 = 4

**นิยาม** f(n) เป็น O(g(n)) เมื่อมีค่าคงที่ c และจุดเริ่ม n₀ ที่ทำให้ f(n) ≤ c·g(n) สำหรับทุก n ≥ n₀ ([dictionary ของ NIST](https://xlinux.nist.gov/dads/HTML/bigOnotation.html) มีเวอร์ชันที่เป็นทางการ) ยกตัวอย่าง 3n + 5 ≤ 4n สำหรับทุก n ≥ 5 เพราะฉะนั้น 3n + 5 เป็น O(n) มันคือ**ขอบบน**ของการเติบโต และต้องจริงแค่ตั้งแต่จุดหนึ่งเป็นต้นไป input เล็ก ๆ เลยไม่นับ

**O, Ω และ Θ** Ω(g(n)) คือ**ขอบล่าง**ที่คู่กัน: f(n) ≥ c·g(n) สำหรับทุก n ตั้งแต่ n₀ บางค่าเป็นต้นไป ส่วน Θ(g(n)) หมายถึงทั้งสองอย่างพร้อมกัน คือขอบเขตแบบ**แนบสนิท** การ scan แบบเส้นตรงเป็น Θ(n) และเป็น O(n²) ด้วย แบบนั้นก็ถูก แต่บอกอะไรเราได้น้อย จดหมายของ Donald Knuth ถึง SIGACT News ในปี 1976 เสนอ Ω และ Θ ที่นักวิทยาการคอมพิวเตอร์ใช้คู่กับ O กันทุกวันนี้ ในการใช้งานทั่วไป O มักถูกใช้แทน Θ: "merge sort เป็น O(n log n)" หมายถึง "ใช้ราว n log n ขั้น" ไม่ใช่แค่ "ไม่เกิน"

**Best case, average case และ worst case** เป็นการเลือกที่แยกจาก O, Ω และ Θ: เลือกก่อนว่ากำลังพูดถึง input แบบไหน แล้วค่อยหาขอบเขตของต้นทุนบน input นั้น การค้นใน list ที่ยังไม่เรียงใช้ 1 ขั้นถ้าเป้าหมายอยู่ตัวแรก ใช้ n ขั้นถ้าไม่มีเป้าหมาย และใช้ราว n/2 ขั้นโดยเฉลี่ยถ้ามีอยู่ในตำแหน่งสุ่ม [Quicksort](../quicksort/) ใช้เวลา Θ(n log n) โดยเฉลี่ย และ Θ(n²) ใน worst case บอกให้ชัดว่าหมายถึง case ไหน: O(1) ของ hash table คือค่าเฉลี่ย ส่วน O(n log n) ของ merge sort จริงแม้ใน worst case

**Amortized cost** กระจายต้นทุนของ operation ที่แพงแต่เกิดนาน ๆ ครั้งไปบน operation ถูก ๆ รอบข้าง การ append ลง list ของ Python ปกติก็แค่เขียน pointer หนึ่งตัวลงในที่ว่างที่เผื่อไว้ พอที่ว่างหมด CPython จะขยาย array ของ list โดยจองเผื่อเกินไว้ตามสัดส่วนของขนาด และการขยายอาจหมายถึงการก็อป pointer ของทุก element ไปที่ block ใหม่: append ครั้งนั้นเป็น O(n) ทีนี้การ resize แต่ละครั้งเผื่อที่ให้ append ได้มากขึ้นตามสัดส่วน การ append n ครั้งเลยใช้ O(n) รวมทั้งหมด แต่ละครั้งก็เลยเป็น **amortized O(1)** ส่วน [Python wiki](https://wiki.python.org/moin/TimeComplexity) ก็ระบุ append ไว้แบบนั้น และเตือนว่าการเรียกครั้งเดียวก็ยังอาจนานจนน่าแปลกใจได้

**Space complexity** ใช้ notation เดียวกันกับ memory: พื้นที่เพิ่มที่อัลกอริทึมต้องใช้นอกเหนือจาก input ของมัน ตัว merge sort ต้องใช้พื้นที่เพิ่ม O(n) สำหรับการ merge ส่วน [heapsort](../binary-heap/) ใช้ O(1) และ function แบบ recursive ถือ stack frame หนึ่งตัวต่อการ recurse หนึ่งระดับ เวลากับพื้นที่มักแลกกัน: set ที่มี n item ใช้ memory O(n) และเปลี่ยนการเช็ก membership แต่ละครั้งจาก O(n) เป็น O(1) โดยเฉลี่ย

**ดู class จากรูปร่างของโค้ด:**

| รูปร่างของโค้ด | Class | ตัวอย่าง |
|---|---|---|
| งานจำนวนคงที่ ไม่มี loop วนบน input | O(1) | `items[i]`, `d[key]` (โดยเฉลี่ย) |
| แบ่งที่เหลือออกครึ่งหนึ่งทุกขั้น | O(log n) | binary search, การ lookup ใน balanced tree |
| ไล่ผ่าน input หนึ่งรอบ | O(n) | `sum(items)`, `x in items` |
| แบ่งครึ่ง recurse ทั้งสองครึ่ง แล้วรวมกันในรอบเดียว | O(n log n) | merge sort |
| loop สองชั้นซ้อนกันบน input | O(n²) | เทียบทุกคู่ |
| ลองทุก subset (มี 2ⁿ แบบ) | O(2ⁿ) | knapsack แบบ brute force |
| ลองทุกลำดับ (มี n! แบบ) | O(n!) | travelling salesman แบบ brute force |

**input หลายตัวก็ใช้ตัวแปรหลายตัว** การจับคู่ list สองตัวขนาด n และ m ด้วย nested loop เป็น O(n·m) ส่วนการเอา list หนึ่งใส่ set ก่อน แล้วค่อยเช็กแต่ละ item ของอีก list เป็น O(n + m) โดยเฉลี่ย เก็บตัวอักษรไว้ทั้งสองตัว: O(n·m) แสดงว่าต้นทุนขึ้นกับทั้งสองขนาด ถ้าเขียนเป็น O(n²) ตัวเดียวก็จะซ่อนเรื่องนี้ไว้ตอนที่ list ตัวหนึ่งเล็ก

## โค้ด

function เล็ก ๆ ห้าตัว หนึ่งตัวต่อหนึ่ง class แต่ละตัวนับขั้นของตัวเอง และมี loop ที่พิมพ์จำนวนขั้นสำหรับ n = 10, 100 และ 1,000 สำหรับ merge sort ขั้นคือจำนวน item ที่การ merge ย้าย: เท่ากับ n log₂ n พอดีเมื่อ n เป็นกำลังของสอง (64 สำหรับ 16 item ใน diagram) และมากกว่านิดหน่อยในกรณีอื่น (ตรงนี้ n log₂ n คือ 33, 664 และ 9,966) ตัว `halve` ต้องการ input ที่เรียงแล้ว และคืน -1 เมื่อไม่เจอเป้าหมาย ส่วน `get` จะ raise `IndexError` กับ list ว่าง แบบเดียวกับการ index ปกติ

```python
def get(items, i):                  # O(1): one read, however long the list is
    return items[i], 1


def halve(items, target):           # O(log n): keep the half that can hold target
    lo, hi, steps = 0, len(items), 0
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if target < items[mid]:
            hi = mid
        else:
            lo = mid
        steps += 1
    found = bool(items) and items[lo] == target
    return (lo if found else -1), steps


def scan(items, target):            # O(n): look at items until target turns up
    for steps, item in enumerate(items, 1):
        if item == target:
            return steps - 1, steps
    return -1, len(items)


def merge_sort(items):              # O(n log n): about log2 n levels, n moves each
    if len(items) < 2:
        return list(items), 0
    left, a = merge_sort(items[:len(items) // 2])
    right, b = merge_sort(items[len(items) // 2:])
    out, i, j = [], 0, 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            out.append(left[i]); i += 1
        else:
            out.append(right[j]); j += 1
    out += left[i:] + right[j:]
    return out, a + b + len(out)    # this merge moved len(out) items


def ranks(items):                   # O(n²): every item against every item
    out, steps = [], 0
    for a in items:
        smaller = 0
        for b in items:
            steps += 1
            if b < a:
                smaller += 1
        out.append(smaller)
    return out, steps


print("      n   O(1)  O(log n)    O(n)  O(n log n)      O(n²)")
for n in (10, 100, 1_000):
    items = list(range(n))
    counts = (get(items, n // 2)[1], halve(items, n - 1)[1], scan(items, -1)[1],
              merge_sort(items[::-1])[1], ranks(items)[1])
    print(f"{n:>7,}" + "".join(f"{c:>{w},}" for c, w in zip(counts, (7, 10, 8, 12, 11))))

# Output:
#       n   O(1)  O(log n)    O(n)  O(n log n)      O(n²)
#      10      1         4      10          34        100
#     100      1         7     100         672     10,000
#   1,000      1        10   1,000       9,976  1,000,000
```

## Complexity

หัวข้อของหน้านี้คือ Big-O ไม่ใช่อัลกอริทึมตัวใดตัวหนึ่ง ตารางนี้เลยสรุป class ต่าง ๆ แทน โดยให้ตัวคูณคงที่ทุกตัวเป็น 1:

| Class | ชื่อ | ตัวอย่างที่เจอบ่อย | จำนวนขั้นที่ n = 1,000 | จำนวนขั้นที่ n = 1,000,000 |
|---|---|---|---|---|
| O(1) | constant | `items[i]`; `d[key]` โดยเฉลี่ย | 1 | 1 |
| O(log n) | logarithmic | binary search และการ lookup ใน balanced tree | ≈ 10 | ≈ 20 |
| O(n) | linear | ไล่หนึ่งรอบ: `sum(items)`, `x in items` | 1,000 | 1,000,000 |
| O(n log n) | linearithmic | merge sort, heapsort, `sorted()` | ≈ 10,000 | ≈ 20 ล้าน |
| O(n²) | quadratic | ทุกคู่ใน nested loop และ insertion sort ใน worst case | 1,000,000 | 10¹² |
| O(2ⁿ) | exponential | ทุก subset | ≈ 1.07 × 10³⁰¹ | ตัวเลขที่มี 301,030 หลัก |
| O(n!) | factorial | ทุกลำดับ | ≈ 4.02 × 10²⁵⁶⁷ | ตัวเลขที่มี 5,565,709 หลัก |

## ใช้ตอนไหนดี

- **เลือก data structure หรืออัลกอริทึมสำหรับข้อมูลที่จะโตขึ้น:** ใช้ set แทน list สำหรับเช็ก membership ใช้ sort หรือ hash join แทน nested loop
- **review โค้ดเพื่อหางานแบบกำลังสองที่ซ่อนอยู่:** `x in some_list` หรือ `some_list.pop(0)` ใน loop หรือการ query database แยกทีละ item ของผลลัพธ์
- **วางแผน capacity:** ดูว่าข้อมูล 10× หรือ 100× จะเป็นยังไงก่อนมันจะมาถึง งาน O(n log n) โตเร็วกว่าข้อมูลนิดหน่อย ส่วนงาน O(n²) โต 100× เมื่อข้อมูลโต 10×
- **อย่าใช้มันอย่างเดียวกับ input ที่เล็กหรือมีขนาดตายตัว** ตรงนั้นตัวคูณคงที่และการจัดวาง memory เป็นตัวตัดสิน ให้วัดเอา

## ได้อะไร เสียอะไร

- **มันซ่อนตัวคูณคงที่** อัลกอริทึม O(n log n) ที่มีงานจัดการเยอะอาจแพ้อัลกอริทึม O(n²) บน input เล็ก ๆ แล้ว sort ใน library ก็ใช้ประโยชน์จากเรื่องนี้ด้วยการส่ง run สั้น ๆ ให้ insertion sort (ดูข้างล่าง)
- **มันไม่สน memory hierarchy** การไล่ array กับการไล่ linked list เป็น O(n) ทั้งคู่ แต่การอ่าน memory ที่ต่อเนื่องกันตามลำดับได้ประโยชน์จาก CPU cache และ prefetching เต็มที่ ส่วน node ที่กระจายอยู่ทั่ว memory อาจ miss cache ทุกขั้น ([Ulrich Drepper, *Memory part 2: CPU caches*](https://lwn.net/Articles/252125/))
- **หน่วยของงานสำคัญ** การเทียบ, การย้าย item, disk page และ network round trip อาจจัดอันดับอัลกอริทึมชุดเดียวกันต่างกันได้ index ของ database อัด key ไว้หลายตัวในแต่ละ page ทำให้การ lookup แตะแค่ไม่กี่ page ส่วนระหว่าง service จำนวน round trip มักสำคัญกว่างานของ CPU
- **ค่าเฉลี่ยโดนเอาชนะได้** O(1) ของ hash table สมมติว่า key กระจายตัวเท่า ๆ กัน ถ้า key ชนกันเยอะ การ lookup ใน dict หรือ set จะแย่ลงไปทาง worst case O(n) ที่ Python wiki ระบุไว้ ส่วน O(n log n) โดยเฉลี่ยของ Quicksort ก็ซ่อน worst case O(n²) ที่ input บางแบบกระตุ้นให้เกิดได้
- **Amortized ไม่ได้หมายถึงต่อ operation** append ที่เป็น amortized O(1) ก็ยังเสีย O(n) เป็นครั้งคราว และ latency ที่พุ่งขึ้นแบบนั้นมีผลใน loop แบบ real-time

## ข้อควรรู้ตอนลงมือทำ

**Python cheat sheet** (CPython, จาก[หน้า TimeComplexity ของ Python wiki](https://wiki.python.org/moin/TimeComplexity)):

| Operation | เวลา |
|---|---|
| `items[i]`, `items[i] = x`, `len(items)` | O(1) |
| `items.append(x)`, `items.pop()` | O(1) โดย append เป็นแบบ amortized |
| `items.insert(0, x)`, `items.pop(0)` | O(n): ทุก element หลังช่องนั้นต้องเลื่อน |
| `x in items` บน list | O(n) |
| `x in s` บน set, `d[key]` บน dict | O(1) โดยเฉลี่ย, O(n) ใน worst case |
| `items.sort()`, `sorted(items)` | O(n log n) |
| `appendleft(x)`, `popleft()` บน `collections.deque` | O(1) เพราะฉะนั้นใช้ deque เป็น queue |

**sort ใน library เปลี่ยนไปใช้ insertion sort กับ run สั้น ๆ** เพราะ overhead ที่ต่ำของมันชนะ O(n²) ของมันเอง:

- `list.sort` ของ CPython ที่เป็น adaptive merge sort ตามที่อธิบายไว้ใน [listsort.txt](https://github.com/python/cpython/blob/main/Objects/listsort.txt) เรียง list ที่สั้นกว่า 64 item ด้วย binary insertion sort และใช้มันขยาย run สั้น ๆ ให้ยาวถึงขั้นต่ำที่ไม่เกิน 64 ก่อน merge
- `Arrays.sort` ของ Java สำหรับ object เป็น TimSort และเรียง array ที่สั้นกว่า 32 ด้วยวิธีเดียวกัน ([ComparableTimSort](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/ComparableTimSort.java))
- `std::sort` ของ GCC ที่เป็น introsort หยุด partition ที่ 16 element แล้วปิดท้ายด้วย insertion sort รอบเดียวบนทั้งช่วง ([stl_algo.h](https://github.com/gcc-mirror/gcc/blob/master/libstdc%2B%2B-v3/include/bits/stl_algo.h))

**database ก็เลือกแบบเดียวกัน** การ lookup ด้วย index ไล่ลง B-tree ที่ความสูงโตตาม log n ส่วน sequential scan อ่านทุกแถว: O(log n) เทียบกับ O(n) ตัว PostgreSQL สร้าง B-tree ถ้าไม่ได้ขอ [index type](https://www.postgresql.org/docs/current/indexes-types.html) แบบอื่น และ `EXPLAIN` จะบอกว่า query ได้แบบไหน (`Index Scan` หรือ `Seq Scan`) ฝั่ง join ก็มีรูปร่างแบบเดียวกัน: nested-loop join จะ scan ตารางด้านในหนึ่งรอบต่อแถวของตารางด้านนอกทุกแถว เป็น O(n·m) ถ้าไม่มี index ส่วน hash join โหลดฝั่งหนึ่งเข้า hash table แล้วใช้อีกฝั่ง probe เป็น O(n + m) โดยเฉลี่ย ([PostgreSQL planner](https://www.postgresql.org/docs/current/planner-optimizer.html))

**เลขชุดเดียวกันโผล่มาใน architecture ด้วย:**

- **N+1 query** โหลด n item แล้ว query หนึ่งครั้งต่อหนึ่ง item ทำให้ต้องเสีย n + 1 round trip ถ้าทำเป็น batch ก็เหลือสองครั้ง ตัว subgraph ของ GraphQL ใช้ DataLoader เพื่อเรื่องนี้โดยเฉพาะ ([GraphQL Federation](../graphql-federation/))
- **Rebalancing** ถ้าใช้ `hash(key) % N` การเพิ่มจาก 3 เป็น 4 shard จะย้าย key ไป 75% ส่วน logical shard หรือ consistent hashing ย้ายแค่ราวหนึ่งในสี่ ([Sharding](../sharding/))
- **Connection** การ peer ทุกคู่ของ network n วงต้องใช้ n(n−1)/2 link เป็น O(n²) ส่วน hub ใช้แค่หนึ่ง link ต่อหนึ่ง spoke เป็น O(n) ([Hub-and-Spoke Network](../hub-spoke-network/))
- **Memory ต่อ client** sliding-window log เก็บ timestamp หนึ่งตัวต่อหนึ่ง request ทำให้ memory ของมันโตตาม limit ส่วน sliding-window counter เก็บตัวเลขแค่สองตัวต่อ key ([Rate Limiting & Throttling](../rate-limiting/))
- **คำนวณไว้ล่วงหน้า** materialized view จ่ายค่า aggregation ที่แพงครั้งเดียวต่อการ refresh แทนที่จะจ่ายทุกครั้งที่อ่าน ([Materialized View](../materialized-view/))

**วัดด้วย** จับเวลาโค้ดที่ n และที่ 2n: อัตราส่วนใกล้ 2 ชี้ไปที่การโตแบบเส้นตรง ใกล้ 4 คือกำลังสอง ใกล้ 8 คือกำลังสาม นี่คือ doubling experiment ใน [section 1.4](https://algs4.cs.princeton.edu/14analysis/) ของ Sedgewick และ Wayne แล้วก่อนจะเขียนอะไรใหม่ ก็ให้ profile ด้วยข้อมูลที่สมจริงผ่าน `cProfile` หรือ `timeit`
