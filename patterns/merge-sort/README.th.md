## ปัญหา

การ sort อยู่เบื้องหลังงานประจำวันหลายอย่าง: `ORDER BY`, การสร้าง index, การรวมไฟล์ log ตาม timestamp, การหาข้อมูลซ้ำ [sort แบบง่าย ๆ](../elementary-sorts/) เทียบของทีละคู่ ราว n²/2 ครั้งใน worst case: ของ 20 ตัวก็ยังไหว แต่ของล้านตัวก็หมดหวัง เพราะ n²/2 คือ 5 × 10¹¹ ขณะที่ n log₂ n อยู่แค่ราว 2 × 10⁷ ส่วน [Quicksort](../quicksort/) มักเร็ว แต่ worst case ของมันก็ยังเป็น quadratic และมันสลับลำดับของตัวที่เท่ากัน บางงานต้องการมากกว่าแค่ "มักเร็ว":

- O(n log n) แบบ**รับประกัน** ไม่ว่า input จะมาในลำดับไหน
- ผลลัพธ์ที่ **stable** คือ record ที่ key เท่ากันยังอยู่ตามลำดับเดิมของ input (sort ตามวันที่ แล้ว sort ตามลูกค้า แถวของลูกค้าแต่ละคนก็ยังเรียงตามวันที่อยู่)
- sort ที่อ่าน input **ตามลำดับ**: linked list หรือไฟล์ที่ใหญ่เกินกว่าจะใส่ใน memory

Merge sort ให้ได้ครบทั้งสามอย่าง

## ทำงานยังไง

Merge sort เป็น **divide and conquer**:

1. **แบ่ง** array ตรงกลาง `mid = (lo + hi) // 2` แล้วแบ่งแต่ละครึ่งต่อไปเรื่อย ๆ ชิ้นที่มีตัวเดียวก็เรียงอยู่แล้ว และนั่นคือจุดจบของ [recursion](../recursion/)
2. **Merge** ชิ้นที่เรียงแล้วและอยู่ติดกันให้เป็นชิ้นที่เรียงแล้วที่ยาวขึ้น จนเหลือชิ้นเดียว

งานทั้งหมดอยู่ที่การ merge ให้ถือ index ไว้ที่ head ของแต่ละ run ที่เรียงแล้ว (`i` ทางซ้าย `j` ทางขวา) เทียบ head สองตัว เอาตัวที่เล็กกว่าต่อท้าย output แล้วเลื่อน index ของฝั่งนั้น พอ run หนึ่งหมด ก็ก็อปที่เหลือของอีก run ตามไปเลยโดยไม่ต้องเทียบอีก loop นี้รักษา invariant ไว้หนึ่งข้อ: หลังทำไป k ขั้น output จะถือ k ตัวที่เล็กที่สุดของสอง run เรียงตามลำดับ และ index แต่ละตัวชี้ที่ตัวที่เล็กที่สุดที่ run ของมันยังไม่ได้ส่งออกไป พอทั้งสอง run หมด output ก็เลยเรียงแล้ว การ merge run ขนาด `a` ตัวกับ `b` ตัว จะย้ายของ `a + b` ตัว และเทียบระหว่าง `min(a, b)` ถึง `a + b − 1` ครั้ง

**Stability มาจากกฎตอนเสมอกัน** การ merge จะหยิบจาก run ขวาก็ต่อเมื่อ head ของมันเล็กกว่าจริง ๆ เท่านั้น ถ้าเสมอกัน ตัวทางซ้ายจะได้ไปก่อน แล้ว key ที่เท่ากันก็เลยออกไปตามลำดับที่มันเข้ามา (2a มาก่อน 2b ใน diagram) ถ้าเปลี่ยนไปหยิบจากทางขวาตอนเสมอ sort นี้ก็ไม่ stable อีกต่อไป

**ทำไมเป็น n log n** การ sort ของ n ตัวเสียเท่ากับ sort ของ n/2 ตัวสองครั้ง บวกกับ merge ของ n ตัวหนึ่งครั้ง: T(n) = 2T(n/2) + n การแบ่งครึ่งจะถึงตัวเดี่ยว ๆ หลังผ่านไป log₂ n ระดับ และการ merge แต่ละระดับย้ายของทั้ง n ตัวตัวละหนึ่งครั้ง รวมเลยเป็นการย้าย n log₂ n ครั้ง (3 ระดับ × 8 = 24 ใน diagram) กับทุก input: คือ O(n log n) ในภาษาของ [Big-O](../big-o-notation/) จำนวนการเทียบขึ้นกับ input แต่อยู่ระหว่างราว ½ n log₂ n ถึง n log₂ n ถ้ามีของ 8 ตัวก็ต้องเทียบ 12 ถึง 17 ครั้ง และ input ใน diagram ใช้ 17 ครั้ง

**Top-down หรือ bottom-up** เวอร์ชัน recursive คือ *top-down* ส่วนเวอร์ชัน *bottom-up* ไม่ต้องใช้ recursion: รอบแรก merge run ที่มีตัวเดียวให้เป็นคู่ รอบถัดไป merge คู่ให้เป็นชุดละสี่ แล้วก็ต่อไปเรื่อย ๆ โดยเพิ่มความกว้างเป็นสองเท่าจนเหลือ run เดียว ถ้า n เป็นกำลังของสอง ทั้งสองเวอร์ชันจะ merge เหมือนกันทุกครั้ง แค่ลำดับต่างกัน diagram เลยแสดงมันทีละระดับได้

## โค้ด

```python
def merge(left, right, key=lambda x: x):
    """Merge two sorted lists into a new sorted list."""
    out = []
    i = j = 0
    while i < len(left) and j < len(right):
        if key(right[j]) < key(left[i]):  # strictly smaller, so a tie takes the left item
            out.append(right[j])
            j += 1
        else:
            out.append(left[i])
            i += 1
    out.extend(left[i:])   # one side is used up; copy the rest of the other
    out.extend(right[j:])
    return out


def merge_sort(items, key=lambda x: x):
    """Return a new sorted list; the input list is left unchanged."""
    if len(items) <= 1:
        return list(items)
    mid = len(items) // 2
    return merge(merge_sort(items[:mid], key), merge_sort(items[mid:], key), key)


print(merge_sort([5, 2, 4, 7, 1, 3, 2, 6]))
# [1, 2, 2, 3, 4, 5, 6, 7]
print(merge_sort(['5', '2a', '4', '7', '1', '3', '2b', '6'], key=lambda s: int(s[0])))
# ['1', '2a', '2b', '3', '4', '5', '6', '7']
```

การ slice (`items[:mid]`) ก็อปแต่ละครึ่งออกมา ทำให้โค้ดสั้น แต่ต้อง allocate ทุกครั้งที่เรียก ส่วน implementation แบบ array จะส่ง `lo`, `mid` และ `hi` แทน แล้ว merge ผ่าน buffer ขนาด n ช่องตัวเดียวที่ allocate ไว้ตั้งแต่แรก การแบ่งก็เลยเป็นแค่การคำนวณ index จริง ๆ

## Complexity

| | ต้นทุน | ทำไม |
|---|---|---|
| Best case | O(n log n) | algorithm แบบพื้นฐานแบ่งและ merge ทุกระดับ ต่อให้ input เรียงอยู่แล้วก็ตาม (กรณีนั้นจะเทียบราว ½ n log₂ n ครั้ง) |
| Average case | O(n log n) | merge log₂ n ระดับ และย้ายระดับละ n ครั้ง |
| Worst case | O(n log n) | เทียบไม่เกิน n log₂ n ครั้งกับ input ทุกลำดับ ไม่มี pivot ให้เลือกพลาด |
| พื้นที่เพิ่ม | O(n) | การ merge ต้องใช้ buffer ขนาด n ช่อง ส่วน recursion แบบ top-down เพิ่ม call stack O(log n) |
| Stable | ใช่ | ถ้าเสมอกัน การ merge หยิบตัวทางซ้ายก่อน |
| In place | ไม่ | การ merge โดยไม่มี buffer ทำได้ แต่ซับซ้อนและช้ากว่า (ดูได้อะไร เสียอะไร) |

## ใช้ตอนไหนดี

- **ต้องการ sort ที่ stable**: table ที่ sort ใหม่ตาม column หนึ่ง แต่ต้องรักษาลำดับเดิมในกลุ่มค่าที่เท่ากัน หรือ sort หลาย key ที่ทำเป็นหลายรอบ
- **ต้องการ worst case ที่คาดเดาได้**: input ที่อาจมีคนจงใจสร้างมาโจมตี หรือ latency budget ที่รับการรันแบบ quadratic เป็นครั้งคราวไม่ไหว
- **Linked list**: การ merge แค่ต่อ link ของ node ใหม่ ไม่ต้องใช้ random access และไม่ต้องใช้ buffer ทำให้ merge sort เป็นตัวเลือกปกติตรงนั้น
- **ข้อมูลที่ใหญ่กว่า memory** และแหล่งข้อมูลอื่นที่อ่านได้แค่ตามลำดับ (ดู external merge sort ด้านล่าง)
- **การ sort แบบ parallel และ distributed**: สองครึ่งเป็นอิสระต่อกัน และการ merge ก็ stream output ออกไปได้
- **ไม่ใช่** สำหรับ array ที่เล็กมาก ๆ เพราะ insertion sort ชนะ (sort ใน library สลับไปใช้มันเมื่อต่ำกว่าไม่กี่สิบตัว) และไม่ใช่ตอนที่ memory ตึงและไม่สนเรื่อง stability: heapsort sort แบบ in place ได้ใน O(n log n) และ quicksort ที่จูนมาดีมักเร็วกว่ากับ array ของตัวเลข

## ได้อะไร เสียอะไร

- **Memory** เวอร์ชัน array แบบคลาสสิกต้องใช้ช่องเพิ่ม n ช่อง Timsort ใช้ไม่เกิน n/2 เพราะมันก็อปแค่ run ที่เล็กกว่าในสอง run ที่กำลัง merge การ merge แบบ in place โดยไม่มี buffer ทำได้ แต่ซับซ้อนและช้ากว่า library เลยแทบไม่ทำ: `std::stable_sort` ของ C++ ขอ buffer ชั่วคราว (ครึ่งหนึ่งของ input ใน libstdc++ และ STL ของ Microsoft และเต็มขนาดใน libc++) แล้วจะถอยไปใช้วิธี O(n log² n) ก็ต่อเมื่อขอ buffer ไม่ได้เท่านั้น
- **ย้ายข้อมูลมากกว่า quicksort** ทุกระดับก็อปของทุกตัว ขณะที่ quicksort สลับกันอยู่ใน array เดิม กับ array ของ primitive ตัว quicksort ที่จูนมาดีมักชนะ นี่คือเหตุผลที่ Java sort `int[]` ด้วย Dual-Pivot Quicksort และเก็บ merge sort (TimSort) ไว้ใช้กับ object ที่ key สองตัวที่เท่ากันอาจเป็นของคนละ record และ stability มีความหมาย
- **เทียบกับ [heapsort](../binary-heap/)** ทั้งคู่รับประกัน O(n log n) และ heapsort ไม่ต้องใช้ buffer แต่มันไม่ stable และการกระโดดไปมาระหว่างช่อง parent กับ child ที่อยู่ห่างกันใน array ทำให้ใช้ cache ได้ไม่ดี ส่วน merge sort อ่านและเขียนตามลำดับ
- **ตัวมันเองไม่ adaptive** input ที่เรียงแล้วก็ยังเสียการย้าย n log₂ n ครั้งเท่าเดิม ถ้าข้ามการ merge เมื่อตัวสุดท้ายของ run ซ้าย ≤ ตัวแรกของ run ขวา input ที่เรียงแล้วก็จะเป็น linear ส่วน natural merge sort กับ Timsort ไปไกลกว่านั้น คือเอา run ที่มีอยู่ในข้อมูลแล้วมาใช้ซ้ำ
- **Overhead กับชิ้นเล็ก ๆ** เวอร์ชันที่ใช้ใน production หยุดแบ่งเมื่อเหลือไม่กี่สิบตัว แล้วจบชิ้นเหล่านั้นด้วย insertion sort

## ข้อควรรู้ตอนลงมือทำ

- **Python** sort ด้วย Timsort ที่เป็น natural merge sort ของ Tim Peters ที่อยู่เบื้องหลัง `list.sort()` และ `sorted()` และเอกสารก็รับประกันว่ามัน stable มันหา run ที่เรียงจากน้อยไปมากอยู่แล้ว (หรือเรียงจากมากไปน้อย ที่มันจะกลับด้านให้) ขยาย run สั้น ๆ ให้ถึงความยาวขั้นต่ำ (minrun คือ 32 ถึง 64 ตัวใน list ใหญ่) ด้วย binary insertion sort และ merge แค่ run ที่อยู่ติดกันเท่านั้น ทำให้มันยัง stable เมื่อ run หนึ่งชนะติดกันไปเรื่อย ๆ การ merge จะสลับไปเป็น *galloping*: มันค้นหาล่วงหน้าแบบ exponential แล้วก็อปทั้ง block ไปในทีเดียว (ตอนแรกหลังชนะติดกัน 7 ครั้ง แล้ว threshold ก็ปรับตัวไปเรื่อย ๆ) Python 3.11 เปลี่ยนกฎเดิมที่ใช้เลือกว่าจะ merge run ไหนต่อ ไปใช้ *powersort* ของ Munro กับ Wild และ Python 3.15 เลือกความยาว run ให้ merge tree balanced ที่สุดเท่าที่ทำได้
- **Java** ใช้ TimSort กับ `Arrays.sort(Object[])`, `Collections.sort` และ `List.sort` และใช้ Dual-Pivot Quicksort กับ array ของ primitive ส่วนกับ array ของ object ตัว `Arrays.parallelSort` เป็น sort-merge แบบ parallel บน common pool ของ fork/join: มัน sort sub-array แล้ว merge เข้าด้วยกัน โดยใช้พื้นที่ทำงานไม่เกินขนาดของ array
- **JavaScript และ Rust**: V8 (engine ใน Chrome และ Node.js) เปลี่ยนจาก quicksort ไปใช้ Timsort ใน V8 7.0 / Chrome 70 (2018) และ ES2019 ก็บังคับให้ทุก engine มี `Array.prototype.sort` ที่ stable ส่วน `slice::sort` ที่ stable ของ Rust มีพื้นฐานมาจาก driftsort ที่เป็น hybrid ที่เอา worst case และการตรวจหา run มาจาก merge sort
- **External merge sort** sort ข้อมูลที่ใหญ่กว่า memory ในสองช่วง: sort ทีละก้อนขนาดเท่า memory แล้วเขียนแต่ละก้อนออกไปเป็น run ที่เรียงแล้ว จากนั้น merge run ทั้งหมดแบบ stream โดยเก็บ head ปัจจุบันของทุก run ไว้ใน [min-heap](../binary-heap/) ตัวถัดไปของ output เลยอยู่ห่างแค่การ pop ครั้งเดียวเสมอ PostgreSQL ทำแบบนี้เมื่อการ sort ใหญ่เกิน `work_mem`: มัน sort ข้อมูลทีละก้อนที่ใส่ memory ได้ เขียนลงไฟล์ชั่วคราวเป็น run และตั้งแต่ PostgreSQL 15 ก็ merge run เหล่านั้นด้วย balanced k-way merge (เวอร์ชันก่อนหน้าใช้ polyphase merge) แล้ว `EXPLAIN ANALYZE` ก็จะรายงาน sort method เป็น `external merge` หรือ `external sort` ส่วน Hadoop MapReduce sort output ของ map ลงใน spill file แล้ว merge ทีละ `mapreduce.task.io.sort.factor` stream (ค่า default คือ 10)
- **การ merge stream ที่เรียงแล้ว** เจอบ่อยในระบบ distributed ถ้า query บน database ที่ [shard](../sharding/) แล้วต้องการผลที่เรียงแล้ว ก็จะ sort ในแต่ละ shard แล้ว merge stream ที่ router ตัว Vitess เก็บหนึ่ง row ต่อหนึ่ง shard ไว้ใน heap แล้วดึงตัวที่เล็กที่สุดออกมาเสมอ storage engine แบบ LSM-tree อย่าง LevelDB ทำ compaction ด้วยการ merge ไฟล์ที่เรียงแล้วให้เป็นไฟล์ที่เรียงแล้วไฟล์ใหม่
- **Linked list**: หาตรงกลางด้วย pointer ตัวช้ากับตัวเร็ว sort ทั้งสองครึ่ง แล้ว merge ด้วยการต่อ link ของ node ใหม่ เวอร์ชัน bottom-up เลี่ยง recursion ได้ด้วย พื้นที่เพิ่มเลยลดลงเหลือ O(1)
- **Parallel merge sort** sort สองครึ่งบนคนละ core จากนั้นการ merge ตัวสุดท้ายจะกลายเป็นคอขวด เว้นแต่จะแบ่งมันด้วย โดยใช้ binary search หาว่าตัวตรงกลางของ run หนึ่งตกอยู่ตรงไหนในอีก run แล้ว merge สองส่วนนั้นไปพร้อม ๆ กัน
- **ประวัติ**: Knuth ให้เครดิต John von Neumann ว่าเป็นคนเสนอการ sort แบบ merge ในปี 1945 ทำให้มันเป็นหนึ่งในวิธีแรก ๆ ที่มีคนเสนอไว้สำหรับ sort บนคอมพิวเตอร์
