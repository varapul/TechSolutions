## ปัญหา

การ sort อยู่เบื้องหลังโค้ดประจำวันหลายอย่าง: เรียงผลของ query, เตรียมข้อมูลสำหรับ binary search, จัดกลุ่มข้อมูลซ้ำ, หา median พวก sort แบบ quadratic ง่าย ๆ ใช้ได้ดีกับของไม่กี่สิบตัว แต่จะพังเมื่อ n โตขึ้น ส่วน merge sort ที่รับประกัน O(n log n) ก็ต้องใช้ buffer ตัวที่สองขนาดเท่า input ด้วย ตัว Quicksort คือวิธีคลาสสิกที่ใช้ sort array ให้เร็วแบบ *in place*: กับข้อมูลทั่วไป มันคือ comparison sort แบบใช้งานทั่วไปที่เร็วที่สุด และนอกจากตัว array แล้ว มันใช้แค่ recursion stack สั้น ๆ

Tony Hoare คิดมันขึ้นมาช่วงปี 1959–60 ตอนเป็นนักศึกษาแลกเปลี่ยนที่ Moscow State University และทำงานด้าน machine translation เขาต้อง sort คำเพื่อจะได้เปิดหาในพจนานุกรมได้อย่างมีประสิทธิภาพ เขาตีพิมพ์มันใน *Communications of the ACM* ปี 1961 เป็น procedure ภาษา ALGOL ชื่อ *Partition*, *Quicksort* และ *Find* (Algorithms 63 ถึง 65) และอธิบายพร้อมวิเคราะห์มันใน paper ปี 1962 ชื่อ *Quicksort* ใน *The Computer Journal*

## ทำงานยังไง

Quicksort คือ divide and conquer ที่ทำงานหนักไว้ตั้งแต่ต้น:

1. **เลือก pivot** ใน diagram ใช้ค่าสุดท้ายของช่วง เป็นกฎที่ง่ายที่สุด
2. **Partition** ช่วงนั้นให้ค่าที่ ≤ pivot มาก่อน และค่าที่ใหญ่กว่าตามหลัง แล้วสลับ pivot เข้าไปไว้ตรงกลาง ตอนนี้ pivot อยู่ในตำแหน่งถาวรแล้ว และจะไม่ย้ายอีก
3. **Recurse** ลงส่วนทางซ้ายและส่วนทางขวาของมัน ส่วนที่มีค่าศูนย์หรือหนึ่งตัวก็เรียงอยู่แล้ว

Merge sort เป็นภาพสะท้อนของมัน: แบ่งโดยไม่ดูค่าเลย แล้วค่อยทำงานทีหลังด้วยการ merge ครึ่งที่เรียงแล้ว ส่วน quicksort ทำงานก่อนจะ recurse พอ call สุดท้าย return ก็เลยไม่เหลืออะไรต้องรวมอีก

**Lomuto partitioning** วิธีที่ใช้ใน diagram จะถือขอบเขต `i` ไว้ แล้วไล่ดูด้วย `j` ทุกครั้งที่ `a[j] ≤ pivot` มันจะสลับ `a[j]` เข้าไปที่ช่อง `i` แล้วขยับ `i` ไปทางขวาหนึ่งขั้น `a[lo:i]` เลยถือค่าเล็ก ๆ ที่เจอมาจนถึงตอนนั้นเสมอ ชื่อนี้ตั้งตาม Nico Lomuto และหนังสือ *Programming Pearls* ของ Jon Bentley กับตำรา *Introduction to Algorithms* ทำให้มันเป็นมาตรฐานในห้องเรียน เพราะมันสั้นและพิสูจน์ว่าถูกต้องได้ง่าย **วิธีดั้งเดิมของ Hoare** เลื่อน index สองตัวเข้าหากันจากปลายทั้งสองข้าง และสลับทุกคู่ที่อยู่ผิดฝั่ง มันสลับน้อยกว่ามาก (ราวหนึ่งในสามของ Lomuto กับ input สุ่ม จากการทดสอบสั้น ๆ) แต่เงื่อนไขขอบเขตของมันละเอียดอ่อนกว่า และ pivot ก็ไม่ได้ไปจบที่จุดแบ่งเสมอไป ทั้งสองวิธีไม่ stable

**รูปร่างของ recursion เป็นตัวกำหนดต้นทุน** recursion แต่ละระดับเทียบค่าในระดับนั้นกับ pivot ของมัน แต่ละระดับเลยเสียการเทียบไม่เกิน n ครั้ง ถ้า pivot แบ่งช่วงได้เท่า ๆ กัน จะมีราว log₂ n ระดับ และ sort ใช้ O(n log n): ค่าสลับลำดับ 8 ตัวใน diagram ใช้ 4 ระดับและเทียบ 15 ครั้ง ถ้า pivot ทุกตัวเป็นค่าที่เล็กที่สุดหรือใหญ่ที่สุดในช่วงของมัน partition แต่ละครั้งก็แยกออกมาได้แค่ตัว pivot: ได้ n − 1 ระดับและเทียบ n(n − 1)/2 ครั้ง คือ 28 ครั้งสำหรับ 8 ค่า การเอาค่าสุดท้ายเป็น pivot ทำแบบนั้นพอดีกับ input ที่เรียงแล้วและเรียงกลับด้าน และโปรแกรมจริงก็สร้าง input แบบนี้ออกมาตลอดเวลา

**การเลือก pivot:**

- *ค่าแรกหรือค่าสุดท้าย:* ไม่เสียอะไร แต่เป็น quadratic กับ input ที่เรียงแล้วหรือเรียงกลับด้าน
- *ค่าสุ่ม:* ต้นทุนที่คาดหวังเป็น O(n log n) กับทุก input การรันแบบ quadratic เกิดได้ แต่ไม่น่าจะเกิดเลย
- *Median of three* (ค่าแรก ค่าตรงกลาง และค่าสุดท้าย): input ที่เรียงแล้วและเรียงกลับด้านแบ่งได้พอดี แลกกับการเทียบเพิ่มสองหรือสามครั้งต่อ partition
- *Tukey's ninther:* median ของ median of three สามชุด รวมเก้าตัวอย่าง ใช้กับช่วงใหญ่ ๆ paper *Engineering a Sort Function* (1993) ของ Bentley กับ McIlroy ใช้มันเมื่อเกิน 40 element และ pdqsort ของ Go ใช้ตั้งแต่ 50

ไม่มีกฎตายตัวไหนกันผู้โจมตีที่ตั้งใจจริงได้ *A Killer Adversary for Quicksort* (1999) ของ McIlroy เลือกค่าของ input แบบ lazy ระหว่างที่ sort กำลังรัน ทำให้ quicksort เกือบทุกตัว รวมถึงตัวที่สุ่มด้วย กลายเป็น quadratic และกับ sort ที่ deterministic ก็เก็บ input ที่มันสร้างไว้แล้วเอามาเล่นซ้ำได้ นี่คือเหตุผลที่ sort ใน library ต้องจำกัด worst case ด้วยทางสำรองที่รับประกันได้ด้วย (ดู hybrid ด้านล่าง)

**Key ที่เท่ากันเยอะ ๆ** เพราะเงื่อนไขคือ `≤` การ partition แบบ Lomuto เลยส่งค่าที่เท่ากับ pivot ทุกตัวไปทางซ้าย array ที่ค่าเหมือนกันหมดก็เลยเป็น quadratic ต่อให้สุ่ม pivot ก็ตาม *Three-way partitioning* แบ่งช่วงเป็นน้อยกว่า เท่ากับ และมากกว่า pivot แล้วไม่กลับไปดูกลุ่มที่เท่ากันอีกเลย นี่คือโจทย์ *Dutch national flag* ของ Dijkstra ถ้าใช้วิธีนี้ ค่าซ้ำจะทำให้ quicksort เร็วขึ้นแทนที่จะช้าลง และ paper ของ Bentley กับ McIlroy ก็ให้วิธีทำที่เร็วไว้

**จำกัดความลึกของ stack** ให้ recurse ลงส่วนที่เล็กกว่า แล้ววน loop กับส่วนที่ใหญ่กว่า แบบนี้ recursive call แต่ละครั้งจะได้ช่วงไม่เกินครึ่งของช่วงของ parent ทำให้ stack มี frame ไม่เกินราว log₂ n อันเสมอ ต่อให้เวลารันเป็น quadratic ก็ตาม เวอร์ชันแบบตรงไปตรงมาต้องใช้หนึ่ง frame ต่อหนึ่งระดับ: ถ้า sort ค่าที่เรียงแล้ว 2,000 ตัวแบบนั้นใน Python จะเกิน recursion limit ค่า default ที่ 1,000

**Hybrid** คือสิ่งที่ library ใช้กันจริง:

- *Introsort* (David Musser, 1997) รัน quicksort แต่สลับไปใช้ heapsort เมื่อ recursion ลึกเกิน limit ที่แปรผันตาม log n ทำให้ worst case ของมันเป็น O(n log n)
- *Dual-pivot quicksort* (Vladimir Yaroslavskiy ร่วมกับ Jon Bentley และ Joshua Bloch) partition รอบ pivot สองตัวออกเป็นสามส่วน
- *pdqsort* หรือ pattern-defeating quicksort ของ Orson Peters เพิ่มทางสำรองเป็น heapsort กระจายค่าบางตัวเมื่อ partition ออกมาไม่สมดุลมาก ลองทำ insertion sort สั้น ๆ กับช่วงที่ดูเหมือนเรียงอยู่แล้ว และ sort input ที่มีค่าต่างกัน k ค่าได้ใน O(nk)

**Quickselect** ให้ partition หนึ่งครั้ง แล้วไปต่อเฉพาะฝั่งที่มี index k: ค่าที่เล็กเป็นอันดับ k (median หรือ percentile) จะออกมาในเวลา O(n) โดยเฉลี่ย และ O(n²) ใน worst case โดยไม่ต้อง sort ส่วนที่เหลือ Hoare ตีพิมพ์มันในชื่อ *Find* คู่กับ quicksort ส่วน C++ มีให้ใช้เป็น [`std::nth_element`](https://en.cppreference.com/cpp/algorithm/nth_element) ที่ปกติ implement เป็น introselect

## โค้ด

```python
import random


def quicksort(a, lo=0, hi=None):
    """Sort the list a in place: Lomuto partition, random pivot."""
    if hi is None:
        hi = len(a) - 1
    while lo < hi:
        p = partition(a, lo, hi)
        # Recurse into the smaller side and loop on the larger one,
        # so the call stack stays O(log n) deep.
        if p - lo < hi - p:
            quicksort(a, lo, p - 1)
            lo = p + 1
        else:
            quicksort(a, p + 1, hi)
            hi = p - 1


def partition(a, lo, hi):
    r = random.randint(lo, hi)        # random pivot, parked at the end
    a[r], a[hi] = a[hi], a[r]
    pivot = a[hi]
    i = lo                            # a[lo:i] holds values <= pivot
    for j in range(lo, hi):
        if a[j] <= pivot:
            a[i], a[j] = a[j], a[i]
            i += 1
    a[i], a[hi] = a[hi], a[i]         # the pivot lands in its final place
    return i


data = [6, 3, 8, 1, 9, 2, 7, 5]
quicksort(data)
print(data)  # [1, 2, 3, 5, 6, 7, 8, 9]
```

loop `while` จะ sort ฝั่งที่ใหญ่กว่าเอง ทำให้ stack ลึกแค่ O(log n) และ pivot แบบสุ่มก็ทำให้ input ที่เรียงแล้วไม่เป็นปัญหา โค้ดนี้ทดสอบเทียบกับ `sorted()` บน list แบบสุ่ม เรียงแล้ว เรียงกลับด้าน ค่าเท่ากันหมด list ว่าง และ list ที่มีตัวเดียว แต่ input ที่ค่าเท่ากันหมดก็ยังใช้เวลา O(n²) กับ partition แบบสองทางนี้ ส่วน three-way partitioning แก้ปัญหานี้ได้

## Complexity

| | ต้นทุน | ทำไม |
|---|---|---|
| Time, best | O(n log n) | pivot ทุกตัวแบ่งช่วงของมันเป็นครึ่ง: ราว log₂ n ระดับ เทียบระดับละไม่เกิน n ครั้ง |
| Time, average | O(n log n) | เทียบราว 2n ln n ≈ 1.39 n log₂ n ครั้งกับ input สุ่ม |
| Time, worst | O(n²) | pivot ทุกตัวเป็นค่าที่เล็กที่สุดหรือใหญ่ที่สุด: n − 1 ระดับ เทียบ n(n − 1)/2 ครั้ง |
| พื้นที่เพิ่ม | O(log n) | recursion stack: ไม่เกินราว log₂ n frame ถ้าทำฝั่งที่เล็กกว่าก่อน และถึง n − 1 ถ้าไม่ใช้เทคนิคนี้ |
| Stable | ไม่ | การสลับกระโดดข้ามค่าอื่น: partition 2a 2b 1 โดยใช้ 1 เป็น pivot จะได้ 1 2b 2a |
| In place | ใช่ | มันแค่สลับค่ากันอยู่ใน array |

## ใช้ตอนไหนดี

- sort array ใน memory ที่ key ที่เท่ากันไม่ต้องรักษาลำดับเดิมของ input: ตัวเลข, string, record ที่มี key ไม่ซ้ำ ตัว sort แบบไม่ stable ใน standard library ก็สร้างขึ้นบนมัน
- ตอนที่ memory ตึง: มันไม่ต้องใช้ buffer ขนาดเท่า input ต่างจาก merge sort
- การเลือกโดยไม่ต้อง sort: median, top k, percentile (quickselect)
- **ไม่ใช่** ตอนที่ลำดับของ key ที่เท่ากันสำคัญ อย่างการ sort ตาม key หนึ่งแล้วตามอีก key หนึ่ง: ให้ใช้ stable sort อย่าง Timsort หรือ merge sort
- **ไม่ใช่** ตอนที่ต้องการ worst case ที่รับประกันได้แต่เพิ่มทางสำรองไม่ได้: heapsort กับ merge sort เป็น O(n log n) กับทุก input
- **ไม่ใช่** สำหรับ linked list: merge sort เรียง list ได้ด้วยการต่อ link ของ node ใหม่ แบบ stable และรับประกัน O(n log n) ส่วนจุดแข็งของ quicksort (สลับแบบ in place, ไล่อ่านแบบเป็นมิตรกับ cache) ต้องใช้ array

## ได้อะไร เสียอะไร

- **เฉลี่ยแล้วเร็ว แต่ worst case เป็น quadratic** quicksort แบบพื้นฐานเป็น O(n²) กับ input ที่เรียงแล้วเมื่อเลือก pivot แบบง่าย ๆ, กับ key ที่เท่ากันเยอะ ๆ เมื่อใช้ partition แบบสองทาง และเมื่อมีผู้โจมตีจงใจทำ ส่วน pivot แบบสุ่มหรือแบบสุ่มตัวอย่าง, three-way partitioning และ depth limit (introsort) ช่วยรักษาความเร็วไว้ได้โดยไม่ต้องเสี่ยง
- **In place แต่ไม่ stable** การสลับระยะไกลที่ทำให้มันประหยัด memory ก็คือตัวเดียวกับที่ทำให้ key ที่เท่ากันสลับลำดับ
- **เป็นมิตรกับ cache** การ partition ไล่ผ่าน memory ที่ต่อเนื่องกัน ส่วน heapsort ที่เป็น in place เหมือนกัน กระโดดไปมาระหว่าง parent กับ child ที่อยู่ห่างกัน นี่เป็นเหตุผลหนึ่งที่มันเป็นทางสำรอง แทนที่จะเป็นตัวหลัก
- **Overhead ของ recursion กับช่วงเล็ก ๆ** กับค่าไม่กี่ตัว การเรียก function เสียมากกว่าที่ประหยัดได้ implementation เลยส่งช่วงที่ต่ำกว่าจุดตัดไปให้ insertion sort (16 element ใน libstdc++)

## ข้อควรรู้ตอนลงมือทำ

- **C++:** standard บังคับให้ `std::sort` เทียบ O(n log n) ครั้งใน worst case (C++98 ขอแค่โดยเฉลี่ย จนมี defect report LWG 713) แต่ quicksort แบบพื้นฐานสัญญาเรื่องนี้ไม่ได้ libstdc++ ใช้ introsort: pivot แบบ median-of-three, สลับไปใช้ heapsort เมื่อ recursion ถึง depth limit 2 log₂ n และใช้ insertion sort กับช่วงสั้น ๆ ส่วน libc++ ทำได้ตามข้อกำหนดนี้ตั้งแต่ LLVM 14 ส่วน `std::nth_element` เป็น O(n) โดยเฉลี่ย
- **Java:** `Arrays.sort` บน array ของ primitive เป็น dual-pivot quicksort มาตั้งแต่ Java 7 และโค้ด OpenJDK ปัจจุบันก็สลับไปใช้ heapsort เมื่อ recursion ลึกเกินไปด้วย ส่วน array ของ object ใช้ TimSort แทน: primitive ที่เท่ากันแยกกันไม่ออก แต่ object ที่เท่ากันแยกกันออก ก็เลยมีแค่การ sort object ที่ต้อง stable
- **Go:** `sort.Sort` ใช้ pattern-defeating quicksort มาตั้งแต่ Go 1.19 และ `slices.Sort` ก็เหมือนกัน ตัวนี้คือที่ `sort.Ints` กับพี่น้องของมันเรียกใช้ตั้งแต่ Go 1.22 ทั้งสองตัวไม่ stable ส่วน `sort.Stable` กับ `slices.SortStableFunc` stable
- **Rust:** `sort_unstable` มีพื้นฐานมาจาก ipnsort (Lukas Bergdoll กับ Orson Peters) ที่เป็น quicksort มีทางสำรองเป็น heapsort และรันในเวลา linear กับ input ที่เรียงแล้วและเรียงกลับด้าน ส่วน `sort` ที่ stable คือ driftsort ที่เป็น hybrid ของ quicksort กับ merge sort
- **Python:** `list.sort()` กับ `sorted()` ใช้ Timsort ที่ stable และใช้ประโยชน์จาก run ที่เรียงอยู่แล้ว
- **Database:** PostgreSQL sort ใน memory ด้วย quicksort ของ Bentley กับ McIlroy ([`sort_template.h`](https://github.com/postgres/postgres/blob/master/src/include/lib/sort_template.h)) ที่ถูกแก้ให้ตรวจหา input ที่เรียงมาแล้ว และให้ recurse ลง partition ที่เล็กกว่า โดย comment ในโค้ดอธิบายว่าที่แก้ก็เพราะเคยเจอ stack overflow ใน production ส่วน `EXPLAIN ANALYZE` รายงาน sort แบบนี้เป็น [`Sort Method: quicksort`](https://www.postgresql.org/docs/current/using-explain.html) และ input ที่ใหญ่เกิน `work_mem` จะถูก sort เป็น run แล้ว merge จากไฟล์ชั่วคราว
- **Percentile:** p99 แบบเป๊ะ ๆ ของ latency sample ชุดหนึ่งเป็นโจทย์การเลือก และ quickselect ก็ตอบได้ใน O(n) โดยเฉลี่ยโดยไม่ต้อง sort ทั้งชุด แต่ระบบ monitoring มักเก็บ histogram หรือ sketch ที่ตอบแบบประมาณได้โดยใช้ memory จำกัดมากกว่า ดู [SLOs & Error Budgets](../slo-error-budgets/)
