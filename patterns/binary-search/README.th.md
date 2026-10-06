## ปัญหา

ถ้าจะหาค่าหนึ่งใน list ที่เราไม่รู้อะไรเกี่ยวกับมันเลย ก็ต้องเอาค่านั้นไปเทียบกับทุกตัวจนกว่าจะเจอตัวที่ตรง นี่คือ linear search และต้นทุนของมันโตไปพร้อมกับ list: ของล้านตัวอาจหมายถึงการเทียบล้านครั้ง และค่าที่ไม่มีอยู่ก็ต้องเทียบครบทุกตัวเสมอ แต่ถ้าของเรียงอยู่แล้ว การเทียบครั้งเดียวบอกอะไรเราได้มากกว่าแค่ "ไม่ใช่ตัวนี้" เยอะ ถ้าตัวตรงกลางเล็กเกินไป ทุกตัวที่อยู่ก่อนหน้ามันก็เล็กเกินไปด้วย ตัดทิ้งได้ครึ่ง list ในทีเดียว

## ทำงานยังไง

Binary search เก็บช่วงของ index `[lo, hi]` ไว้ และมี **invariant** หนึ่งข้อ: ถ้า target อยู่ใน array จริง มันต้องอยู่ใน `a[lo..hi]`

1. เริ่มจากทั้ง array คือ `lo = 0` และ `hi = n - 1` แบบนี้ invariant ก็เป็นจริง
2. ตรวจตัวตรงกลาง `mid = (lo + hi) // 2` ถ้ามันเท่ากับ target ก็จบ
3. ถ้า `a[mid]` เล็กกว่า target ก็แปลว่าทุกตัวทางซ้ายของมันเล็กกว่าด้วย (เพราะ array เรียงอยู่) เลยตั้ง `lo = mid + 1` ถ้ามันใหญ่กว่า ก็ตั้ง `hi = mid - 1` ไม่ว่าทางไหน invariant ก็ยังเป็นจริง และช่วงก็หดลงอย่างน้อยหนึ่งตัว loop เลยจบแน่
4. ถ้าช่วงว่าง (`lo > hi`) ตาม invariant ก็แปลว่า target ไม่มีอยู่ ส่วน `lo` ไปหยุดอยู่ที่ **insertion point** ของมัน คือ index ที่ต้องใส่ target ลงไปให้ array ยังเรียงอยู่: เป็น 11 สำหรับ 50 ในขั้นที่ 3

การตรวจแต่ละครั้งตัดสิ่งที่เหลือทิ้งไปราวครึ่งหนึ่ง ของ n ตัวเลยต้องตรวจไม่เกิน ⌊log₂ n⌋ + 1 ครั้ง ไม่ว่าจะเจอ target หรือไม่ การให้เหตุผลว่าถูกต้องของทุกแบบก็ใช้สามขั้นเดิม: invariant เป็นจริงก่อนเข้า loop ทุกทางแยกรักษามันไว้ และทุกรอบทำให้ช่วงหดลง

### ช่วงแบบปิดหรือครึ่งเปิด

วิธีเขียนขอบเขตที่ใช้กันบ่อยมีสองแบบ แต่ละแบบถูกต้องในตัวเอง และ bug แบบ off-by-one ส่วนใหญ่มาจากการเอาสองแบบมาปนกัน:

| แบบ | เริ่มต้น | วน loop ตราบที่ | target อยู่ทางขวาของ mid | target อยู่ทางซ้ายของ mid | พลาดกันบ่อย |
|---|---|---|---|---|---|
| ปิด `[lo, hi]` | `hi = n - 1` | `lo <= hi` | `lo = mid + 1` | `hi = mid - 1` | `while lo < hi` หยุดก่อนจะได้ตรวจช่วงที่มีตัวเดียว ทำให้ `[5]` หา 5 ไม่เจอ ส่วน `hi = n` ทำให้ `mid` อ่านเลยท้าย array ไปหนึ่งช่อง |
| ครึ่งเปิด `[lo, hi)` | `hi = n` | `lo < hi` | `lo = mid + 1` | `hi = mid` | `hi = mid - 1` ทิ้งตัวที่อาจเป็นคำตอบไป ส่วน `lo = mid` จะหยุดขยับเมื่อ `hi = lo + 1` กลายเป็น loop ไม่รู้จบ |

แบบครึ่งเปิดเหมาะกับ lower bound และ upper bound ด้านล่าง และตรงกับวิธีที่ iterator range ของ C++, slice ของ Python และ `sort.Search` ของ Go ใช้อธิบายช่วง

### Lower bound, upper bound และค่าซ้ำ

ถ้ามีค่าซ้ำ แค่ "index หนึ่งของ x" มักไม่พอ การค้นหาข้างบนคืนตัวไหนก็ได้ที่มันเจอก่อน (หา 2 ใน `[2, 2, 2, 3]` ได้ index 1) มีสองแบบที่ตอบคำถามที่มีประโยชน์กว่า:

- **lower bound** คือ index แรกที่ค่า**ไม่น้อยกว่า** x
- **upper bound** คือ index แรกที่ค่า**มากกว่า** x

สำเนาของ x อยู่ใน `[lower, upper)` เลยนับจำนวนได้ด้วย `upper - lower` และค่าตั้งแต่ x ถึง y (รวมทั้งสองฝั่ง) อยู่ที่ index `lower_bound(x)` ถึง `upper_bound(y) - 1` ถ้าไม่มี x อยู่ ทั้งสองตัวก็คืน insertion point ของมัน ใน standard library:

- **Python:** `bisect.bisect_left(a, x, lo=0, hi=len(a), *, key=None)` คือ lower bound และ `bisect_right` (ชื่ออีกชื่อคือ `bisect`) คือ upper bound ส่วน `insort_left` กับ `insort_right` ใช้แทรกค่าโดยยังรักษาลำดับไว้ parameter `key` มาใน Python 3.10 และ function เหล่านี้เทียบด้วย `__lt__` อย่างเดียว ไม่เคยใช้ `__eq__`
- **C++:** `std::lower_bound` คืน element แรกที่ไม่ได้อยู่ก่อนค่านั้นในลำดับ และ `std::upper_bound` คืน element แรกที่อยู่หลังค่านั้น `std::equal_range` คืนทั้งสองตัว ส่วน `std::binary_search` บอกแค่ว่ามีค่านั้นอยู่หรือไม่ มันต้องการ range ที่ถูก partition เทียบกับค่านั้น (เรียงแล้วก็พอ) และเทียบไม่เกิน log₂ N + O(1) ครั้ง แล้ว C++20 ก็เพิ่มเวอร์ชัน `std::ranges` มาให้
- **Java:** `Arrays.binarySearch` กับ `Collections.binarySearch` คืน index เมื่อเจอ key (ถ้ามีค่าซ้ำ จะเป็นตัวไหนก็ได้) และคืน `-(insertion point) - 1` เมื่อไม่เจอ ผลลัพธ์เลยติดลบก็ต่อเมื่อไม่มี key อยู่เท่านั้น insertion point คือ index ของ element แรกที่มากกว่า key หรือคือความยาวของ array ถ้าไม่มีตัวไหนมากกว่า
- **Go:** `sort.Search(n, f)` คืน index ที่เล็กที่สุดใน `[0, n)` ที่ `f` เป็น true โดยถือว่า `f` เป็น false ก่อนแล้วค่อยเป็น true และคืน `n` ไม่ใช่ -1 เมื่อไม่มีตัวไหนเลย ส่วน `sort.Find` รับการเทียบแบบสามทางแทน ตัว generic `slices.BinarySearch(x, target)` คืนตำแหน่งแรกสุดที่ target อยู่หรือควรจะอยู่ พร้อม boolean ที่บอกว่าเจอหรือไม่ และ `slices.BinarySearchFunc` รับ function สำหรับเทียบ

### Overflow ตอนคำนวณจุดกึ่งกลาง

ในปี 2006 Joshua Bloch เล่าถึง bug ใน binary search ที่เขาเขียนให้ `java.util.Arrays` ของ JDK: มันคำนวณ `(low + high) / 2` พอ array มี element ราว 2³⁰ ตัว (หนึ่งพันล้าน) ขึ้นไป `low + high` ก็อาจเกิน `int` ที่ใหญ่ที่สุดคือ 2³¹ − 1 แล้ววนกลับไปเป็นเลขติดลบ ใน Java ถ้า index ติดลบก็จะโยน `ArrayIndexOutOfBoundsException` ส่วนใน C ตัว signed overflow เป็น undefined behaviour แล้ว bug นี้ก็รอดสายตาไปได้ราวเก้าปี และเวอร์ชันในหนังสือ *Programming Pearls* ของ Jon Bentley ที่พิสูจน์แล้วว่าถูกต้อง ก็คำนวณจุดกึ่งกลางแบบเดียวกัน Bloch บอกว่า mergesort และโค้ด divide-and-conquer อื่น ๆ ก็มีปัญหานี้เหมือนกัน ทางแก้คือเลี่ยงผลบวกก้อนใหญ่: ใช้ `low + (high - low) / 2` หรือใน Java ใช้ `(low + high) >>> 1` ที่อ่านผลบวกเป็น unsigned ส่วน `(lo + hi) // 2` ของ Python ปลอดภัย เพราะ integer ของ Python มีความละเอียดไม่จำกัด

### Binary search บนคำตอบ

จะไม่มี array ก็ได้ Binary search ใช้ได้กับคำถามแบบใช่หรือไม่ใช่ทุกข้อที่เป็น monotonic บนช่วงที่มีลำดับ: เป็น false จนถึงจุดหนึ่ง แล้วเป็น true ตั้งแต่ตรงนั้นไป การหาค่า true ตัวแรกก็คือ lower bound บนคำถาม แทนที่จะเป็นบนข้อมูลที่เก็บไว้

ตัวอย่างเช่น พัสดุที่หนัก `[3, 2, 2, 4, 1, 4]` ต้องส่งตามลำดับนี้ให้เสร็จภายใน D = 3 วัน ความจุต่อวันที่น้อยที่สุดที่ทำได้คือเท่าไร? ถ้าความจุหนึ่งใช้ได้ ทุกค่าที่มากกว่านั้นก็ใช้ได้ด้วย เลยค้นหาความจุตั้งแต่พัสดุที่หนักที่สุด (4) ถึงน้ำหนักรวม (16) การตรวจแต่ละครั้งจำลองการขนของใน O(n) การค้นหาทั้งหมดเลยใช้ O(n log W) สำหรับน้ำหนักรวม W คำตอบคือ 6: `[3, 2]`, `[2, 4]` และ `[1, 4]` ส่วน `sort.Search` ของ Go ก็มีรูปร่างแบบนี้พอดี และใน Python 3.10 ขึ้นไป `lo + bisect_left(range(lo, hi + 1), True, key=fits)` ก็ทำแบบเดียวกันได้โดยไม่ต้องสร้าง list

`git bisect` เอาแนวคิดนี้ไปใช้กับ history: เรา mark commit ที่ bad หนึ่งตัวกับ commit ที่ good ที่เก่ากว่าอีกตัว แล้ว Git ก็ checkout commit ที่อยู่ราวครึ่งทางระหว่างสองตัวนั้น เราทดสอบแล้ว mark มัน ช่วงก็หดลงครึ่งหนึ่งอีกรอบ ตัวอย่างในเอกสารมี 675 revision เหลือให้ทดสอบ และคาดว่าต้องทำอีกราว 10 ขั้น ส่วน `git bisect run <cmd>` ทำ loop นี้ให้อัตโนมัติ: exit code 0 แปลว่า good, 1 ถึง 127 ยกเว้น 125 แปลว่า bad และ 125 แปลว่า commit นั้นทดสอบไม่ได้และควรข้ามไป เงื่อนไขก่อนใช้ก็คือ monotonic อีกเช่นกัน: พอ bug โผล่มาแล้ว มันต้องอยู่ต่อไปตลอด

### Exponential (galloping) search

ถ้าไม่รู้ความยาว (เป็น stream หรือเป็น function ที่ทำได้แค่ลองถาม) หรือ target น่าจะอยู่ใกล้ต้น ให้ลองที่ตำแหน่ง 1, 2, 4, 8, … ไปเรื่อย ๆ จนเจอตำแหน่งที่เลย target แล้วค่อยทำ binary search ในช่องว่างสุดท้าย วิธีนี้ใช้การเทียบราว 2 log₂ i ครั้งสำหรับ target ที่ตำแหน่ง i ไม่ว่าข้อมูลจะยาวแค่ไหน การ merge ของ Timsort ก็ใช้วิธีนี้: เมื่อ run หนึ่งชนะการเทียบติดกันไปเรื่อย ๆ `list.sort` ของ CPython จะสลับไปเป็น *galloping mode* (หลังชนะติดกัน `MIN_GALLOP` = 7 ครั้ง ค่า threshold นี้มันปรับเองไปเรื่อย ๆ ระหว่างทำงาน) แล้วก็อปทั้ง slice ไปในทีเดียว บันทึกของ CPython โยงแนวคิดนี้ไปถึงงานเรื่อง adaptive set intersection และไปถึง "exponential search" ของ Peter McIlroy ส่วน object sort ของ Java ที่ดัดแปลงมาจาก Timsort ก็ gallop แบบเดียวกัน

## โค้ด

```python
def binary_search(a, target):
    """Return an index of target in the sorted list a, or -1 if it is absent."""
    lo, hi = 0, len(a) - 1          # closed range: a[lo..hi] may hold target
    while lo <= hi:                  # empty once lo passes hi
        mid = (lo + hi) // 2         # Python ints never overflow
        if a[mid] == target:
            return mid
        if a[mid] < target:
            lo = mid + 1             # target can only be right of mid
        else:
            hi = mid - 1             # target can only be left of mid
    return -1


def lower_bound(a, target):
    """Return the first index whose value is >= target (len(a) if there is none)."""
    lo, hi = 0, len(a)               # the answer is in lo..hi; len(a) means "none"
    while lo < hi:
        mid = (lo + hi) // 2
        if a[mid] < target:
            lo = mid + 1             # mid and everything left of it are too small
        else:
            hi = mid                 # mid could be the answer; keep it
    return lo


a = [3, 8, 11, 15, 19, 23, 27, 31, 36, 42, 47, 53, 58, 64, 71, 80]
print(binary_search(a, 58), binary_search(a, 50), lower_bound(a, 50))
# 12 -1 11
```

function ทั้งสองตัวถูกตรวจเทียบกับ `bisect.bisect_left` บน list ที่เรียงแล้วและมีค่าซ้ำแบบสุ่ม 20,000 ชุด ด้วย target ที่ต่ำกว่า อยู่ระหว่าง และสูงกว่าค่าใน list รวมถึง list ว่าง list ที่มีตัวเดียว และปลายทั้งสองข้างของ array ข้างบน

## Complexity

| | ต้นทุน | ทำไม |
|---|---|---|
| Best time | O(1) | ตัวตรงกลางตัวแรกคือ target พอดี |
| Average time | O(log n) | เกือบครึ่งหนึ่งของทั้งหมดจะไปถึงได้ก็ตอนตรวจครั้งสุดท้าย การค้นหาที่เจอในของล้านตัวเลยใช้การตรวจเฉลี่ยราว 19 ครั้ง น้อยกว่า worst case หนึ่งครั้ง |
| Worst time | O(log n) | ตรวจไม่เกิน ⌊log₂ n⌋ + 1 ครั้ง ไม่ว่าจะเจอ target หรือไม่ |
| Extra space | O(1) | loop เก็บ index แค่สองตัว ส่วนเวอร์ชัน recursive ใช้ stack frame O(log n) |

Binary search แค่อ่าน array เรื่อง stable กับ in place เลยใช้กับที่นี่ไม่ได้ ส่วนที่แพงคือการรักษาให้ array เรียงอยู่เสมอ: การแทรกค่าหนึ่งตัวต้องเลื่อนของ O(n) ตัว

## ใช้ตอนไหนดี

- lookup ในข้อมูลที่เรียงแล้วและไม่ค่อยเปลี่ยน: lookup table ที่สร้างครั้งเดียว, list ของ ID ที่เรียงแล้ว, time series ที่เรียงตาม timestamp, รายการ version หรือ release
- คำถามที่ hash table ตอบไม่ได้: key ที่ใกล้ที่สุดที่เท่ากับหรือต่ำกว่าค่าหนึ่ง event แรกหลังจากเวลาหนึ่ง ทุก key ในช่วงหนึ่ง อันดับของ key
- คำถามใช่หรือไม่ใช่ที่เป็น monotonic ทุกแบบ: ความจุ, timeout หรือ batch size ที่น้อยที่สุดที่ยังผ่าน และ commit แรกที่ bad
- ไม่ใช่สำหรับ lookup ครั้งเดียวในข้อมูลที่ไม่ได้เรียง เพราะการ sort ก่อนเสีย O(n log n) มากกว่าการไล่ดูหนึ่งรอบที่เป็น O(n) ไม่ใช่สำหรับข้อมูลที่เปลี่ยนตลอด เพราะการแทรกแต่ละครั้งลงใน array ที่เรียงแล้วต้องเลื่อนของ O(n) ตัว ส่วน balanced binary search tree หรือ B-tree รักษาการแทรกไว้ที่ O(log n) ได้ และถ้าต้องการแค่ lookup แบบตรงตัวอย่างเดียว hash table ตอบได้ใน O(1) โดยเฉลี่ย

## ได้อะไร เสียอะไร

- **ข้อมูลที่เรียงแล้วคือราคาที่ต้องจ่าย** การ sort เสีย O(n log n) ครั้งเดียว และการรักษาให้ array เรียงอยู่เสียการย้าย O(n) ครั้งต่อการแทรกหนึ่งครั้ง symbol table แบบ ordered array ของ Sedgewick กับ Wayne ที่สร้างบน binary search ต้องเข้าถึง array ราว 2N ครั้งสำหรับการแทรกหนึ่งครั้งลงใน N key ใน worst case
- **ต้องเข้าถึงด้วย index ได้เร็ว** การตรวจทุกครั้งกระโดดไปที่ตำแหน่งหนึ่ง และจะใช้ O(1) ได้ก็ใน array เท่านั้น ใน linked list การไปถึงตรงกลางต้องเดินผ่านครึ่งหนึ่งของมัน: `Collections.binarySearch` ของ Java เขียนไว้ว่าต้องเดิน link O(n) ครั้งสำหรับ list ขนาดใหญ่ที่ไม่รองรับ random access (แม้จะยังเทียบแค่ O(log n) ครั้ง) และ `std::lower_bound` ของ C++ บน forward iterator ก็เลื่อน iterator เป็นจำนวนครั้งแบบ linear
- **การตรวจกระโดดไปทั่ว memory** การตรวจติดกันใน array ใหญ่ ๆ ตกห่างกันมาก แต่ละครั้งเลยอาจ miss CPU cache หรือ page cache ถ้า array เป็นไฟล์ ส่วน B-tree เก็บหลาย key ไว้ในแต่ละ page การอ่าน page เดียวเลยแคบช่วงค้นหาลงได้เยอะ
- **ค่าซ้ำกับการหาไม่เจอต้องตัดสินใจ** การค้นหาแบบธรรมดาคืน index ที่ตรงตัวไหนก็ได้ ให้ใช้ lower bound หรือ upper bound ถ้าต้องการสำเนาตัวแรกหรือตัวสุดท้าย และตกลงให้ชัดว่า "หาไม่เจอ" จะคืนอะไร: -1, insertion point หรือ `-(insertion point) - 1` แบบของ Java
- **การเทียบต้องตรงกับลำดับที่ sort ไว้** ถ้าค้นหาด้วย key หรือ comparator ที่ต่างจากตอน sort จะได้คำตอบผิดโดยไม่มี error ใด ๆ เอกสารของ Java เรียกผลลัพธ์นี้ว่า undefined

## ข้อควรรู้ตอนลงมือทำ

- **Library ของแต่ละภาษา:** ดู list ด้านบน แล้ว `list.sort` ของ CPython ก็ยัง sort run สั้น ๆ ด้วย binary insertion sort ที่หา insertion point แต่ละจุดด้วย binary search และ gallop ระหว่าง merge ด้วย
- **Page ของ B-tree:** การ lookup ใน B-tree ค้นหา key ที่เรียงอยู่ในแต่ละ page เพื่อเลือก child ที่จะลงไปต่อ ตัวอย่างเช่นโค้ด B-tree ของ PostgreSQL ทำ binary search ในแต่ละ page หา key แรกที่ไม่น้อยกว่า scan key (คือ lower bound) แล้วใน inner page มันก็ตาม key ที่อยู่ก่อนหน้าตัวนั้นไป คือ key ตัวสุดท้ายที่ต่ำกว่า scan key ([`_bt_binsrch` ใน nbtsearch.c](https://github.com/postgres/postgres/blob/master/src/backend/access/nbtree/nbtsearch.c))
- **SSTable ใน LSM store:** ไฟล์ table ของ LevelDB ปิดท้ายด้วย index block ที่มีหนึ่ง entry ต่อหนึ่ง data block โดย key ของแต่ละ entry เป็น string ที่ไม่น้อยกว่า key ตัวสุดท้ายของ block นั้น และน้อยกว่า key ตัวแรกของ block ถัดไป ([table format](https://github.com/google/leveldb/blob/main/doc/table_format.md)) การ lookup จะ seek ใน index block เพื่อหา data block เดียวที่มี key นั้นได้ แล้วค่อย seek ใน block นั้น key ใน block ถูก prefix-compress โดยเก็บ key เต็มไว้ที่ *restart point* เป็นระยะ ๆ การ seek ทำ binary search บน restart point แล้วค่อย scan ไปข้างหน้าอีกไม่กี่ entry ([block.cc](https://github.com/google/leveldb/blob/main/table/block.cc))
- **Log index ของ Kafka:** log segment ทุกอันมี offset index แบบ sparse (จาก offset ไปตำแหน่งในไฟล์) และ time index แบบ sparse (จาก timestamp ไป offset) ทั้งคู่เรียงอยู่แล้วเพราะมีแต่การต่อท้าย และ broker ก็ทำ binary search บนมัน [โค้ดต้นฉบับ](https://github.com/apache/kafka/blob/trunk/storage/src/main/java/org/apache/kafka/storage/internals/log/AbstractIndex.java) อธิบายจุดพลิกไว้: การค้นหาแบบตำราบน index ทั้งก้อนจะแตะ page ที่อาจหลุดออกจาก page cache ไปแล้ว broker เลยค้นหาแค่ entry ช่วง 8 KB ล่าสุดก่อน เพราะ lookup เกือบทั้งหมดจาก consumer และ follower ที่ in-sync ตกอยู่ตรงนั้น
- **Routing ตามช่วงของ key:** [Sharding](../sharding/) แบบแบ่งตามช่วงเก็บขอบเขตระหว่าง shard ไว้ตามลำดับ การ route key หนึ่งก็คือการหาช่วงที่มี key นั้น นี่ก็คือ binary search บนขอบเขตเหล่านั้น ring ของ consistent hashing ก็มักเก็บแบบเดียวกัน คือเป็น array ของตำแหน่งที่เรียงแล้ว แล้วค้นหาตำแหน่งแรกที่เท่ากับหรืออยู่หลัง hash ของ key
- **Bisect อย่างอื่น:** นอกจาก `git bisect` แล้ว extension bisect ของ VS Code ก็ปิด extension ที่ติดตั้งไว้ทีละครึ่ง แล้วถามว่าปัญหายังอยู่ไหม วิธีนี้หา extension ที่มีปัญหาจาก 24 ตัวได้ในสี่หรือห้ารอบ (ดู [Microkernel](../microkernel/))
- **โครงสร้างที่เกี่ยวข้อง:** binary search tree เก็บการแบ่งครึ่งแบบเดียวกันไว้ใน node ที่ link กัน การแทรกเลยยังเป็น O(log n) ตราบที่มัน balanced ส่วน hash table ยอมทิ้งลำดับเพื่อแลกกับ lookup แบบตรงตัวที่ O(1) โดยเฉลี่ย
