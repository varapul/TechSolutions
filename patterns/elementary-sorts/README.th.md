## ปัญหา

Bubble sort, selection sort และ insertion sort เรียงของด้วยการเทียบและย้ายมัน แต่ละตัวเขียนได้ในไม่กี่บรรทัดและไม่ต้องใช้ memory เพิ่ม แต่ทุกตัวต้องใช้ราว n² ขั้น ถ้ามีของสักโหลก็ไม่เป็นไร แต่ถ้ามีล้านตัวก็หมดหวัง: insertion sort เทียบเฉลี่ยราว n²/4 ครั้ง คือประมาณ 2.5 × 10¹¹ ครั้งสำหรับของล้านตัวที่เรียงแบบสุ่ม

แต่ก็ยังคุ้มที่จะรู้จักมัน พวกนี้เป็นวิธีที่ชัดที่สุดที่จะเห็น loop invariant, inversion และ stability และมันต่างกันในเรื่องที่ยังสำคัญอยู่: เขียนข้อมูลกี่ครั้ง key ที่เท่ากันรักษาลำดับเดิมไว้ได้หรือไม่ และ input ที่เกือบเรียงแล้วถูกลงหรือไม่ insertion sort ยังเป็นมากกว่าของในห้องเรียนด้วย sort มาตรฐานของ Python, Java, C++, Go และ .NET ส่งช่วงสั้น ๆ ทุกช่วงให้มันจัดการ เพราะกับของไม่กี่สิบตัว inner loop เล็ก ๆ ของมันชนะ algorithm O(n log n) ที่เร็วกว่า

## ทำงานยังไง

ทั้งสามตัวขยายส่วนที่เรียงแล้วทีละหนึ่งตัว สิ่งที่ต่างกันคือส่วนนั้นสัญญาอะไรไว้ หรือก็คือ **loop invariant** ของมัน

- **Bubble sort** กวาดจากซ้ายไปขวา และสลับทุกคู่ที่อยู่ติดกันแต่เรียงผิด พอจบรอบที่ *k* แล้ว ตัวที่ใหญ่ที่สุด *k* ตัวจะอยู่ท้ายสุดในตำแหน่งถาวรของมัน แต่ละรอบเลยหยุดก่อนรอบที่แล้วได้หนึ่งช่อง *Invariant: ส่วนท้ายเรียงแล้วและเป็นตำแหน่งถาวร* รอบที่ไม่มีการสลับเลยสักครั้งพิสูจน์ได้ว่าทั้ง array เรียงแล้ว ตัว sort เลยหยุดก่อนได้
- **Selection sort** ไล่ดูส่วนที่ยังไม่เรียงเพื่อหาตัวที่เล็กที่สุด แล้วสลับมันมาไว้ที่ตำแหน่งถัดไป *Invariant: ส่วนหน้าถือของที่เล็กที่สุดตามลำดับถาวร* มันไล่ดูทุกตัวที่เหลือเสมอ เลยเทียบ n(n − 1)/2 ครั้งกับทุก input แต่ไม่เคยสลับเกิน n − 1 ครั้ง
- **Insertion sort** หยิบตัวถัดไป (key) ออกมา เลื่อนทุกตัวที่ใหญ่กว่าในส่วนหน้าที่เรียงแล้วไปทางขวาหนึ่งช่อง แล้วหย่อน key ลงในช่องว่าง *Invariant: ส่วนหน้าเรียงแล้วแต่ยังไม่ถาวร* เพราะ key ตัวหลัง ๆ ยังอาจลงไปอยู่กลางส่วนนี้ได้

**Inversion** อธิบายตัวเลขใน diagram ได้ inversion คือคู่ของสองตัวที่อยู่ผิดลำดับเมื่อเทียบกันเอง 5 2 4 6 1 3 มีเก้าคู่: 5 มาก่อน 2, 4, 1 และ 3 ส่วน 2 มาก่อน 1 แล้ว 4 มาก่อน 1 และ 3 และ 6 มาก่อน 1 และ 3 การสลับคู่ติดกันที่เรียงผิดกำจัด inversion ได้หนึ่งคู่พอดี และไม่ทำให้คู่อื่นเปลี่ยนเลย bubble sort เลยสลับ 9 ครั้งพอดี การเลื่อนแต่ละครั้งของ insertion sort ย้ายตัวที่ใหญ่กว่าหนึ่งตัวข้าม key ไป และก็กำจัด inversion ได้หนึ่งคู่พอดีเหมือนกัน insertion sort เลยเลื่อน 9 ครั้งพอดี จำนวนการเทียบของมันคือจำนวนการเลื่อนบวกกับการเทียบที่ทำให้หยุดอีกไม่เกินหนึ่งครั้งต่อ key จำนวนเลยอยู่ระหว่าง I ถึง I + n − 1 สำหรับ I inversion ในที่นี้คือ 9 + 3 = 12 เพราะ key 2 และ 1 ไถลไปจนสุดด้านหน้า และไม่ต้องใช้การเทียบที่ทำให้หยุดเลย

ลำดับแบบสุ่มมี inversion เฉลี่ย n(n − 1)/4 คู่ นี่คือเหตุผลที่ bubble sort กับ insertion sort เป็น quadratic โดยเฉลี่ย และเป็นเหตุผลที่ insertion sort เร็วเมื่อไรก็ตามที่ inversion มีน้อย: มันรันใน O(n + I)

**Stability** แปลว่า key ที่เท่ากันยังอยู่ตามลำดับเดิมของ input เรื่องนี้สำคัญเวลาเรา sort record ตาม field หนึ่งแล้วตามอีก field หนึ่ง bubble sort กับ insertion sort ย้ายตัวหนึ่งข้ามตัวที่ใหญ่กว่าเท่านั้น (ไม่ใช่เท่ากัน) มันเลย stable ส่วนการสลับของ selection sort อาจโยนตัวที่อยู่หน้าสุดของส่วนที่ยังไม่เรียงไปไกลทางขวา ข้าม key ที่เท่ากันไปได้: sort 2a 2b 1 จะสลับ 2a กับ 1 แล้วได้ 1 2b 2a ถ้าเลื่อนตัวที่น้อยที่สุดเข้าที่แทนการสลับ selection sort ก็จะ stable แต่ต้องเสียการเขียน O(n) ครั้งต่อรอบ และทิ้งข้อดีอย่างเดียวที่ selection sort มีไป

**Binary insertion sort** หาช่องของ key ด้วย binary search แทนการเดินไปทีละขั้น วิธีนี้ลดการเทียบเหลือ O(n log n) รวมทั้งหมด แต่ตัวที่ใหญ่กว่าก็ยังต้องย้ายอยู่ worst case เลยยังเป็นการย้าย O(n²) ครั้ง มันคุ้มเมื่อการเทียบแพงกว่าการย้ายมาก CPython คือตัวอย่างตามตำรา: การเทียบ object ของ Python สองตัวต้องรันโค้ดทั่วไปที่อาจเป็นโค้ดที่ user เขียนเอง ส่วนการย้ายแค่ก็อป pointer ถ้าจะให้ stable มันต้องแทรกหลัง key ที่เท่ากันทุกตัว (`bisect_right` ไม่ใช่ `bisect_left`)

## โค้ด

```python
def bubble_sort(a):
    """Swap out-of-order neighbours; stop after a pass with no swaps."""
    for end in range(len(a) - 1, 0, -1):   # a[end + 1:] is sorted and final
        swapped = False
        for j in range(end):
            if a[j] > a[j + 1]:
                a[j], a[j + 1] = a[j + 1], a[j]
                swapped = True
        if not swapped:
            break


def selection_sort(a):
    """Swap the smallest remaining item into each position in turn."""
    for i in range(len(a) - 1):            # a[:i] holds the i smallest, in order
        m = i
        for j in range(i + 1, len(a)):
            if a[j] < a[m]:
                m = j
        if m != i:
            a[i], a[m] = a[m], a[i]


def insertion_sort(a):
    """Lift each item out and shift larger ones right until it fits."""
    for i in range(1, len(a)):             # a[:i] is sorted, not yet final
        key = a[i]
        j = i - 1
        while j >= 0 and a[j] > key:
            a[j + 1] = a[j]
            j -= 1
        a[j + 1] = key


data = [5, 2, 4, 6, 1, 3]
for sort in (bubble_sort, selection_sort, insertion_sort):
    a = data.copy()
    sort(a)
    print(f"{sort.__name__:15} {a}")
# bubble_sort     [1, 2, 3, 4, 5, 6]
# selection_sort  [1, 2, 3, 4, 5, 6]
# insertion_sort  [1, 2, 3, 4, 5, 6]
```

ทั้งสามตัว sort แบบ in place และ return `None` เหมือน `list.sort()` มันถูกทดสอบเทียบกับ `sorted()` บน list สุ่ม 2,000 ชุดที่ยาวไม่เกิน 40 ตัวและมีค่าซ้ำเยอะ รวมถึง list ว่าง list ตัวเดียว list ที่ทุกตัวเท่ากัน และ input ที่เรียงแล้วกับที่เรียงกลับด้าน การทดสอบ stability ใช้ record แบบ (key, tag) ที่เทียบกันด้วย key อย่างเดียว: bubble sort กับ insertion sort รักษา tag ไว้ตามลำดับของ input ส่วน selection sort เปลี่ยน 2a 2b 1c เป็น 1c 2b 2a ตัวเลขทุกตัวใน diagram มาจากสำเนาของ function เหล่านี้ที่ใส่ตัวนับไว้

## Complexity

| Algorithm | Best | Average | Worst | พื้นที่เพิ่ม | Stable | Adaptive |
|---|---|---|---|---|---|---|
| Bubble sort (หยุดก่อนได้) | O(n): รอบเดียวและไม่มีการสลับเมื่อ input เรียงแล้ว | O(n²): สลับหนึ่งครั้งต่อหนึ่ง inversion เฉลี่ย n(n − 1)/4 | O(n²): input เรียงกลับด้าน เทียบและสลับ n(n − 1)/2 ครั้ง | O(1): สลับใน array เดิม | ใช่: สลับแค่คู่ติดกันที่เรียงผิด | บางส่วน: การหยุดก่อนช่วยได้ก็ต่อเมื่อไม่มีตัวเล็ก ๆ ที่ต้องเดินทางไปทางซ้ายไกล |
| Selection sort | O(n²): เทียบ n(n − 1)/2 ครั้งกับทุก input | O(n²): ไล่ดูเหมือนเดิมทุกครั้ง | O(n²) แต่ไม่เคยสลับเกิน n − 1 ครั้ง | O(1): สลับใน array เดิม | ไม่: การสลับระยะไกลอาจกระโดดข้าม key ที่เท่ากัน | ไม่: ทุกรอบไล่ดูไปจนสุด |
| Insertion sort | O(n): เทียบ n − 1 ครั้งและไม่มีการเลื่อนเมื่อ input เรียงแล้ว | O(n²): เทียบและเลื่อนราว n²/4 ครั้ง | O(n²): input เรียงกลับด้าน เทียบและเลื่อน n(n − 1)/2 ครั้ง | O(1): ถือ key ไว้ตัวเดียว | ใช่: เลื่อนแค่ตัวที่ใหญ่กว่าจริง ๆ | ใช่: O(n + I) สำหรับ I inversion |

## ใช้ตอนไหนดี

- **เรียกใช้ sort ที่มากับภาษา** มันใช้ insertion sort อยู่แล้วในจุดที่ insertion sort ชนะ: ช่วงสั้น ๆ
- **เขียน insertion sort เอง** สำหรับค่าไม่กี่ตัวใน hot loop สำหรับ input ที่ทุกตัวอยู่ห่างจากที่ของมันไม่เกิน *k* ช่อง (O(nk)) และสำหรับรักษา array เล็ก ๆ ให้เรียงอยู่ในขณะที่ของเข้ามาทีละตัว มันเป็น *online*: ไม่ต้องเห็น input ที่เหลือเลย
- **หยิบ selection sort มาใช้** ก็ต่อเมื่อการเขียนแพงกว่าการเทียบมาก เช่น record ที่ใหญ่มาก ๆ หรือ memory ที่เสื่อมเมื่อเขียนบ่อย เพราะมันสลับไม่เกิน n − 1 ครั้ง แต่การ sort reference หรือ index แล้วค่อยย้ายแต่ละ record ครั้งเดียวมักดีกว่านั้นอีก
- **ใช้ bubble sort สอน** ไม่ใช่เอาไป ship

## ได้อะไร เสียอะไร

- **โตแบบ quadratic** input เพิ่มสองเท่า งานก็เพิ่มสี่เท่า กับของสุ่มล้านตัว insertion sort เทียบราว 2.5 × 10¹¹ ครั้ง ขณะที่ sort แบบ O(n log n) อย่าง merge sort เทียบราว 2 × 10⁷ ครั้ง
- **Bubble sort แพ้ insertion sort ทุกด้าน** มันสลับบ่อยเท่ากับที่ insertion sort เลื่อน แต่การสลับเขียนสองตัว ส่วนการเลื่อนเขียนตัวเดียว และมันมักเทียบมากกว่าด้วย การหยุดก่อนของมันก็เปราะ: ตัวเล็ก ๆ ที่อยู่ใกล้ท้ายขยับไปทางซ้ายได้แค่หนึ่งช่องต่อรอบ ตัวอย่าง 2 3 4 5 6 1 เลยยังต้องใช้ครบห้ารอบและเทียบ 15 ครั้ง ขณะที่ insertion sort เทียบ 9 ครั้ง Owen Astrachan สืบชื่อนี้ไว้ใน paper ของ SIGCSE ปี 2003 ว่าย้อนไปถึงหนังสือ *A Programming Language* (1962) ของ Kenneth Iverson เพราะ paper ก่อนหน้านั้นเรียกมันว่า sorting by exchange เขายังจับเวลาได้ว่ามันช้ากว่า insertion sort เกือบสามเท่า เมื่อ sort string สุ่มใน Java และให้เหตุผลว่าทุกที่ที่ bubble sort ทำได้ดี insertion sort ก็ทำได้ดีอย่างน้อยเท่ากัน
- **Selection sort ไม่สนใจ input ของมันเลย** มันเสียต้นทุนเท่ากันทั้งกับข้อมูลที่เรียงแล้วและข้อมูลสุ่ม และการสลับระยะไกลของมันก็ทำให้ไม่ stable จุดแข็งของมันคือจำนวนการเขียน: สลับไม่เกิน n − 1 ครั้ง ขณะที่อีกสองตัวอาจถึง n(n − 1)/2 ครั้ง
- **Insertion sort คือตัวที่ควรเก็บไว้** มัน stable, in place, online และ adaptive โดยมี inner loop เล็กนิดเดียว แต่ worst case ก็ยังเป็น O(n²) กับ input ที่เรียงกลับด้านหรือสุ่ม ทำให้ library ใช้มันแค่กับขนาดที่ต่ำกว่า threshold

## ข้อควรรู้ตอนลงมือทำ

sort ใน standard library ทุกตัวสลับไปใช้ insertion sort กับช่วงสั้น ๆ threshold เหล่านี้ตรวจกับ source ปัจจุบันของแต่ละ project ในเดือนตุลาคม 2026:

- **Python** (`list.sort()`, `sorted()`) ใช้ Timsort โดย list ที่สั้นกว่า 64 ตัวไม่เคยไปถึงขั้น merge เลย: binary insertion sort อย่างเดียวก็ sort มันเสร็จ ใน list ที่ยาวกว่านั้น natural run ที่สั้นกว่า minimum run length (ระหว่าง 32 ถึง 64) จะถูกขยายให้ถึงความยาวนั้นด้วย binary insertion sort ก่อน merge ตั้งแต่ Python 3.15 ความยาวของ run อาจต่างกันได้หนึ่งจาก run หนึ่งไปอีก run ทำให้ทุกการ merge balanced และ sort นี้รับประกันว่า stable
- **Java** sort object (`Arrays.sort` กับ object, `List.sort`) ด้วย TimSort โดย array ที่สั้นกว่า 32 element ได้ binary insertion sort อย่างเดียว ส่วน array ของ primitive จะใช้ Dual-Pivot Quicksort แล้วช่วงซ้ายสุดจะสลับไปใช้ insertion sort เมื่อต่ำกว่า 44 element ช่วงอื่นสลับเมื่อต่ำกว่า 65 (limit นี้โตตามความลึกของ recursion) ไปเป็น *mixed insertion sort* ที่ใช้ pivot ทางซ้ายของมันเป็น sentinel เลยข้ามการตรวจขอบเขตไปได้ บน Linux x86-64 ตัว JDK รุ่นใหม่ ๆ รัน sort เล็ก ๆ เหล่านี้เป็นโค้ด AVX2 หรือ AVX-512 แบบ vectorised แทนได้
- **C++**: `std::sort` ของ libstdc++ คือ introsort มันรัน quicksort แล้วถอยไปใช้ heapsort เมื่อ recursion ลึกเกิน 2·log₂ n และปล่อยทุกช่วงที่มี 16 element หรือน้อยกว่าไว้โดยไม่ sort จากนั้น insertion sort รอบเดียวบนทั้ง array ก็ปิดงานได้โดยเสียแรงน้อย เพราะทุก element อยู่ใน block ของตัวเองที่มีไม่เกิน 16 ตัวอยู่แล้ว ส่วน `std::stable_sort` ใช้ insertion sort กับ chunk ละ 7 ตัวก่อนจะ merge
- **Go**: `sort.Sort` กับ `sort.Slice` ใช้ pattern-defeating quicksort (pdqsort) มาตั้งแต่ Go 1.19 และ `slices.Sort` (Go 1.21) ก็ใช้ด้วย มันใช้ insertion sort กับทุกช่วงที่มี 12 element หรือน้อยกว่า ส่วน stable sort ใช้ insertion sort กับ block ละ 20 ตัว แล้วค่อย merge แบบ in place
- **.NET**: `Array.Sort` กับ `List<T>.Sort` ใช้ introsort โดย partition ที่มี 16 element หรือน้อยกว่าไปที่ insertion sort หรือไปที่การเทียบแล้วสลับตรง ๆ ถ้ามีแค่สองหรือสามตัว
- **ข้อมูลที่เกือบเรียงแล้วในระบบของเราเอง** ข้อมูลมักมาถึงเกือบตามลำดับ เช่น metric หรือ log line ใน [telemetry pipeline](../telemetry-pipeline/) ที่มีบางจุดมาช้า การแทรกแต่ละตัวลงใน buffer ที่เรียงแล้วเสียรวม O(n + I) ใกล้เคียง linear ตราบที่ความไม่เรียงยังน้อยอยู่
- **Threshold ถูกจูนมา ไม่ได้ใช้ได้ทุกที่** จุดตัดข้างบนที่อยู่ตั้งแต่ 7 ถึงราว 65 element มาจาก benchmark บนแต่ละ runtime มันขึ้นกับต้นทุนการเทียบเมื่อเทียบกับการย้าย เลยควรวัดก่อนจะก็อปตัวไหนไปใช้
