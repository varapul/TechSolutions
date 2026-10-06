## ปัญหา

คำถามบางข้อถามหาวิธีที่ดีที่สุดในการสร้างคำตอบจากทางเลือกต่าง ๆ: จำนวนเหรียญน้อยที่สุดที่รวมได้ยอดหนึ่ง จำนวนการแก้น้อยที่สุดที่เปลี่ยน string หนึ่งให้เป็นอีกตัว หรือลำดับที่ถูกที่สุดในการ join table ห้าตัว วิธีที่คิดออกเป็นธรรมชาติคือ recursion: ลองทางเลือกสุดท้ายทุกแบบ แก้ส่วนที่เหลือ แล้วเก็บตัวที่ดีที่สุด วิธีนี้ถูก แต่อาจช้าจนใช้ไม่ได้ เพราะลำดับทางเลือกที่ต่างกันพาไปเจอปัญหาที่เหลือตัวเดียวกัน ถ้ามีเหรียญ 1, 3 และ 4 แล้ว `best(6)` ก็จะลอง 6 − 1, 6 − 3 และ 6 − 4 แต่ละตัวก็ลองต่ออีกได้ถึงสามแบบ และจำนวนเงินเดิม ๆ ก็วนกลับมาเรื่อย ๆ: recursion เรียก 24 ครั้งเพื่อตอบคำถามที่ต่างกันแค่ 7 ข้อ ทุกหน่วยที่เพิ่มขึ้นของจำนวนเงินจะคูณจำนวน call ราว 1.6 เท่า `best(30)` เลยเรียก 2,550,408 ครั้ง และ `best(60)` เรียกเกิน 4.7 ล้านล้านครั้ง

การหยิบเหรียญที่ใหญ่ที่สุดที่ยังใส่ได้ (ทางลัดแบบ [greedy](../greedy-algorithms/)) นั้นเร็ว แต่ตรงนี้ผิด: มันจ่าย 6 เป็น 4 + 1 + 1 สามเหรียญ ทั้งที่ 3 + 3 ใช้แค่สองเหรียญ

Dynamic programming ตัดงานที่ทำซ้ำออก และยังได้คำตอบที่แม่นยำ มีสัญญาณสองอย่างที่บอกว่าใช้ได้:

- **Optimal substructure:** คำตอบ optimal สร้างจากคำตอบ optimal ของ subproblem ที่เล็กกว่า ถ้าวิธีที่ดีที่สุดในการรวมให้ได้ 6 จบด้วยเหรียญ 3 แล้ว เหรียญที่อยู่ก่อนหน้ามันก็ต้องเป็นวิธีที่ดีที่สุดในการรวมให้ได้ 3
- **Overlapping subproblems:** recursion เจอ subproblem เดิมซ้ำแล้วซ้ำอีก การแก้แต่ละตัวแค่ครั้งเดียวแล้วเอาคำตอบกลับมาใช้ซ้ำเลยคุ้ม

นี่คือสิ่งที่ทำให้มันต่างจากเทคนิคข้างเคียง:

- **Divide and conquer** ([merge sort](../merge-sort/), [quicksort](../quicksort/)) ก็แบ่งปัญหาเหมือนกัน แต่แบ่งเป็นชิ้นที่ไม่ขึ้นกับกันและไม่เคยทับกัน เลยไม่มีอะไรให้ใช้ซ้ำ
- **Greedy algorithm** เลือกทางเดียวต่อหนึ่งก้าวและไม่เคยกลับไปดูอีก แบบนี้จะถูกก็ต่อเมื่อมีบทพิสูจน์ว่าทางเลือกนั้นปลอดภัย ส่วน dynamic programming ลองทุกทางเลือก ครั้งเดียวต่อหนึ่ง subproblem
- **[Backtracking](../backtracking/)** ก็ลองทุกทางเลือกเหมือนกัน โดยสร้าง candidate ทีละก้าวและย้อนกลับเมื่อเจอทางตัน ถ้าการค้นหาที่เหลือขึ้นกับแค่ state เล็ก ๆ ที่วนกลับมาซ้ำ การจำผลลัพธ์ของแต่ละ state ไว้ก็เปลี่ยนการค้นหานั้นให้เป็น dynamic programming

## ทำงานยังไง

มีสองวิธีที่ทำให้แน่ใจว่าแต่ละ subproblem ถูกแก้แค่ครั้งเดียว

**Top-down: memoization** เก็บ recursion ไว้แล้วเพิ่ม memo: เปิดดู subproblem ก่อนจะแก้ และเก็บคำตอบของมันไว้หลังแก้เสร็จ memo เป็น dictionary ที่ใช้ parameter ของ subproblem เป็น key มันเลยเป็น [hash table](../hash-table/) ใน Python ตัว `@functools.cache` (3.9 ขึ้นไป) ทำแบบนี้พอดี: มันเป็น cache ที่ไม่จำกัดขนาด เหมือนกับ `functools.lru_cache(maxsize=None)` และ argument ของ function ต้อง hash ได้ บนปัญหาเหรียญ มันเปลี่ยน 24 call ให้เหลือ 14: คำนวณ 7 ครั้ง หนึ่งครั้งต่อหนึ่งจำนวนเงิน และอีก 7 call ได้คำตอบจาก memo (`cache_info()` รายงาน hit 7 ครั้งและ miss 7 ครั้ง) จะมีแค่ subproblem ที่คำตอบต้องใช้เท่านั้นที่ถูกคำนวณ แต่ recursion ยังอยู่: ถ้ามีเหรียญ 1 อยู่ด้วย `best(n)` ก็ยังลงลึก n call จำนวนเงินที่ใหญ่เลยชน recursion limit 1000 frame ของ CPython (ดู [Recursion](../recursion/))

**Bottom-up: tabulation** เรียง subproblem ให้แต่ละตัวมาหลังตัวที่มันต้องอ่าน แล้วเติมตารางตามลำดับนั้นด้วย loop ธรรมดา สำหรับเหรียญก็คือ `dp[0]`, `dp[1]` … `dp[n]` และแต่ละช่องอ่านไม่เกินหนึ่งช่องต่อเหรียญ และทุกช่องที่อ่านอยู่ทางซ้ายของมัน ไม่มี recursion เลยไม่มีขีดจำกัดความลึกและไม่มี overhead ของ call และหลายครั้งก็เก็บไว้แค่ส่วนของตารางที่ช่องถัด ๆ ไปยังต้องอ่านได้: edit distance ต้องใช้แค่แถวก่อนหน้า Fibonacci ต้องใช้แค่สองตัวสุดท้าย ราคาที่ต้องจ่ายคือทุกช่องถูกเติม ไม่ว่าคำตอบสุดท้ายจะต้องใช้หรือไม่

สูตรเหมือนกันทุกปัญหา:

1. **กำหนด state:** parameter ไม่กี่ตัวที่อธิบาย subproblem หนึ่งข้อ เช่น `best(n)` คือจำนวนเหรียญน้อยที่สุดสำหรับจำนวนเงิน n ส่วน `d(i, j)` คือจำนวนการแก้น้อยที่สุดที่เปลี่ยนตัวอักษร i ตัวแรกของ string หนึ่งให้เป็น j ตัวแรกของอีกตัว
2. **เขียน recurrence:** คำตอบของ state หนึ่งได้มาจาก state ที่เล็กกว่ายังไง ปกติคือลองก้าวสุดท้ายที่เป็นไปได้ทุกแบบ แล้วเอาค่าน้อยที่สุด มากที่สุด หรือผลรวม ก้าวสุดท้ายที่เข้า `d(i, j)` คือ delete (จาก `d(i − 1, j)`), insert (จาก `d(i, j − 1)`) หรือ substitution (จาก `d(i − 1, j − 1)` ฟรีถ้าตัวอักษรสองตัวตรงกัน)
3. **ตั้ง base case:** `best(0) = 0` ส่วน `d(i, 0) = i` และ `d(0, j) = j` ทำเครื่องหมาย state ที่ไปไม่ถึง เช่นด้วย infinity
4. **เลือก fill order:** ลำดับไหนก็ได้ที่ input ของแต่ละ state มาก่อน เช่น n จากน้อยไปมากสำหรับเหรียญ และทีละแถวสำหรับ grid ตัว state กับ dependency ของมันประกอบกันเป็น directed acyclic graph และ fill order ก็คือ [topological order](../topological-sort/) ของกราฟนั้น
5. **อ่านคำตอบ** จาก state ที่ถามคำถามตั้งต้น: `dp[6]` หรือ `d(6, 7)` สำหรับ *kitten* กับ *sitting*
6. **สร้างคำตอบกลับขึ้นมา** ถ้าต้องการมากกว่าแค่ค่าของมัน: จดว่าทางเลือกไหนชนะในแต่ละ state แล้วเดินย้อนจากคำตอบ ตรงนี้ `dp[6]` มาจาก 3 และ `dp[3]` ก็มาจาก 3 เหมือนกัน ได้เป็น 3 + 3 ส่วนถ้าสองทางเลือกเสมอกัน ทางไหนก็พาไปถึงคำตอบ optimal ได้ โค้ดข้างล่างเก็บเหรียญตัวแรกที่ได้ค่าน้อยที่สุด

**ปัญหาคลาสสิก**

- **Coin change** มีสองแบบ: จำนวนเหรียญน้อยที่สุด (ค่าน้อยที่สุดตามเหรียญสุดท้าย แบบที่นี่) และจำนวนวิธีที่รวมได้ยอดหนึ่ง (ผลรวม) ถ้าจะนับ combination แทนที่จะนับลำดับ ให้วาง loop ของเหรียญไว้นอก loop ของจำนวนเงิน: 1, 3 และ 4 รวมเป็น 6 ได้ 4 วิธี (1 หกเหรียญ, 3 + 1 + 1 + 1, 4 + 1 + 1 และ 3 + 3)
- **0/1 knapsack:** ของที่มีน้ำหนักและมูลค่า กับความจุ W ตัว state คือพิจารณาของไปแล้วกี่ชิ้น และความจุเหลือเท่าไร ได้เวลา O(n·W) ขอบเขตนี้เป็น **pseudo-polynomial**: เป็น polynomial ตามค่าของ W แต่การเขียน W ใช้แค่ราว log₂ W bit ทำให้เวลาที่ใช้เป็น exponential ตามขนาดของ input ตามที่คาดได้สำหรับปัญหา NP-hard
- **Longest common subsequence และ edit distance** เติม grid บน prefix ของ string สองตัว edit distance ที่มี insert, delete และ substitution คือ Levenshtein distance ตัว Wagner กับ Fischer ตีพิมพ์อัลกอริทึมแบบตารางในปี 1974 และ Needleman กับ Wunsch ก็ใช้ grid แบบเดียวกันมาแล้วในปี 1970 เพื่อเทียบลำดับโปรตีน
- **Longest increasing subsequence:** เวอร์ชัน O(n²) ตั้ง `L[i]` เป็น 1 บวก `L[j]` ที่มากที่สุดที่ j < i และ `a[j] < a[i]` ส่วนวิธี O(n log n) ที่เร็วกว่าจะเก็บค่าที่เล็กที่สุดที่ปิดท้าย increasing subsequence ของแต่ละความยาวไว้ แล้ววาง element ใหม่แต่ละตัวด้วย [binary search](../binary-search/)
- **Shortest path:** Bellman–Ford relax ทุก edge V − 1 รอบ หลังรอบที่ k ไม่มีระยะไหนแย่กว่า path ที่ดีที่สุดที่มีไม่เกิน k edge มันเลยเป็น dynamic programming บนจำนวน edge ใช้ O(V·E) และต่างจาก [อัลกอริทึมของ Dijkstra](../dijkstra/) ตรงที่รับมือกับ weight ติดลบได้ ส่วน Floyd–Warshall หา shortest path ระหว่างทุกคู่ใน O(V³) โดยยอมให้มี vertex ตรงกลางเพิ่มขึ้นอีกหนึ่งตัวในแต่ละรอบ

**ชื่อนี้มาจากไหน** Richard Bellman พัฒนาวิธีนี้ที่ RAND Corporation ในช่วงต้นทศวรรษ 1950 และตีพิมพ์ ["On the Theory of Dynamic Programming"](https://pmc.ncbi.nlm.nih.gov/articles/PMC1063639/) ในปี 1952 กับบทสำรวจ "The theory of dynamic programming" ในปี 1954 ในอัตชีวประวัติของเขาที่ Stuart Dreyfus ยกมาบางตอน (2002) Bellman เล่าว่าเขาเลือกชื่อนี้ในฤดูใบไม้ร่วงปี 1950 ส่วนหนึ่งก็เพื่อพรางตัว: รัฐมนตรีกลาโหม Wilson ทนคำว่า *research* ไม่ได้ และ RAND ก็ทำงานให้กองทัพอากาศ *Programming* หมายถึงการวางแผนและการตัดสินใจ ไม่ใช่การเขียนโค้ด และ *dynamic* บอกว่าปัญหาค่อย ๆ คลี่ออกเป็นขั้น ๆ ตามเวลา Bellman ยังชอบที่ไม่มีใครใช้คำว่า *dynamic* เป็นคำด่าได้

## โค้ด

```python
import math
from functools import cache

def fewest_naive(coins, n):            # exponential: solves the same amounts again and again
    if n == 0:
        return 0
    return 1 + min((fewest_naive(coins, n - c) for c in coins if c <= n), default=math.inf)

def fewest_memo(coins, n):             # top-down: each amount is solved once, then cached
    @cache
    def best(m):
        if m == 0:
            return 0
        return 1 + min((best(m - c) for c in coins if c <= m), default=math.inf)
    return best(n)

def min_coins(coins, amount):          # bottom-up, with the coins of one best answer
    dp = [0] + [math.inf] * amount     # dp[n] = fewest coins that make n
    last = [0] * (amount + 1)          # last[n] = the coin that achieved dp[n]
    for n in range(1, amount + 1):
        for c in coins:
            if c <= n and dp[n - c] + 1 < dp[n]:
                dp[n], last[n] = dp[n - c] + 1, c
    if dp[amount] == math.inf:
        return None                    # this amount cannot be made
    picked = []
    while amount:                      # follow the stored choices back to 0
        picked.append(last[amount])
        amount -= last[amount]
    return picked

def edit_distance(a, b):               # Levenshtein distance, keeping two rows
    if len(a) < len(b):
        a, b = b, a                    # the shorter string sets the row length
    prev = list(range(len(b) + 1))     # from "" to b[:j] takes j inserts
    for i, x in enumerate(a, 1):
        cur = [i]                      # from a[:i] to "" takes i deletes
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1,              # delete x
                           cur[j - 1] + 1,           # insert y
                           prev[j - 1] + (x != y)))  # substitute, free if equal
        prev = cur
    return prev[-1]

print(min_coins([1, 3, 4], 6))              # [3, 3]
print(min_coins([3, 4], 2))                 # None
print(edit_distance("kitten", "sitting"))   # 3
```

`fewest_naive` กับ `fewest_memo` คืนจำนวนเหรียญ หรือ `math.inf` ถ้ารวมให้ได้ยอดนั้นไม่ได้ ส่วน `min_coins` คืนตัวเหรียญเลย คืน `[]` สำหรับจำนวนเงิน 0 และคืน `None` ถ้าไม่มี combination ไหนใช้ได้ เช่น 2 หรือ 5 จากเหรียญ 3 กับ 4 ส่วน memo ใน `fewest_memo` อยู่ภายใน call เดียว เพราะ `coins` เป็น list และ list ใช้เป็น cache key ไม่ได้ แล้ว function เหรียญทั้งสามตัวก็ให้ผลตรงกันทุกจำนวนเงินตั้งแต่ 0 ถึง 60 สำหรับระบบเหรียญสิบสองระบบ (ตัว naive แค่ถึงจำนวนเงินที่มันยังเรียกไม่เกินราว 300,000 ครั้ง คือ 25 สำหรับเหรียญ 1, 3 และ 4) และตรงกับการค้นหาแบบ brute force จนถึง 24 ส่วน `edit_distance` ตรงกับเวอร์ชันที่ใช้ grid เต็มบน string สุ่ม 3,000 ตัว และให้ 0 สำหรับ string ว่างสองตัว และ 3 สำหรับ *kitten* กับ *sitting* ไม่ว่าจะสลับลำดับไหน

## Complexity

ถ้ามีเหรียญ k ค่า จำนวนเงิน A และ string ยาว m กับ n:

| | Time (best = average = worst) | พื้นที่เพิ่ม | ทำไม |
|---|---|---|---|
| `fewest_naive` | exponential ตาม A | O(A) | ไม่มีอะไรถูกจำไว้ ทุก call เลยลองทุกเหรียญใหม่ สำหรับเหรียญ 1, 3 และ 4 จำนวน call c(A) = 1 + c(A − 1) + c(A − 3) + c(A − 4) โตขึ้น φ ≈ 1.618 เท่าต่อหน่วย: 24 call สำหรับ 6 และ 2,550,408 สำหรับ 30 ส่วน stack เก็บสาย call ไว้หนึ่งสาย ลึกไม่เกิน A |
| `fewest_memo` | O(A·k) | O(A) | จำนวนเงินทั้ง A + 1 ค่าถูกคำนวณค่าละครั้งและลอง k เหรียญ ส่วน call อื่นเป็นการเปิดดู dictionary ตัว memo เก็บคำตอบ A + 1 ตัว และการลงลึกรอบแรกลึกได้ถึง A frame |
| `min_coins` | O(A·k) | O(A) | loop ซ้อนสองชั้น จำนวนเงินอยู่ข้างนอก เหรียญอยู่ข้างใน `dp` กับ `last` เก็บตัวละ A + 1 entry และการเดินย้อนใช้หนึ่งก้าวต่อเหรียญในคำตอบ |
| `edit_distance` | O(m·n) | O(min(m, n)) | หาค่าน้อยที่สุดในเวลาคงที่หนึ่งครั้งต่อช่องของ grid เก็บไว้แค่แถวก่อนหน้ากับแถวปัจจุบัน แต่ละแถวยาว min(m, n) + 1 |

แต่ละ function ทำงานเท่ากันกับทุก input ที่ขนาดเท่ากัน best, average และ worst case เลยตรงกัน ส่วนเรื่อง stable และ in place ไม่เกี่ยว [Big-O Notation](../big-o-notation/) อธิบายสัญลักษณ์เหล่านี้ สองแถวให้ระยะได้ แต่ไม่ได้ให้การแก้แต่ละครั้ง: ถ้าจะไล่ย้อนหามันแบบที่ animation ทำ ต้องใช้ grid ทั้งหมด

## ใช้ตอนไหนดี

- คำถามถามหาค่า optimum หรือการนับบนชุดทางเลือกจำนวนมาก (น้อยที่สุด ถูกที่สุด ยาวที่สุด มีค่าที่สุด จำนวนวิธี) และทางเลือกส่งผลต่อกัน เลยไม่มีกฎง่าย ๆ ที่พิสูจน์ได้ว่าปลอดภัย
- subproblem อธิบายได้ด้วย parameter เล็ก ๆ ไม่กี่ตัว เช่นจำนวนเงิน ความยาว prefix สองตัว หรือ index กับความจุที่เหลือ ตารางเลยใส่ memory ได้
- วิธีแบบ recursive วนกลับมาเจอ state เดิม: ลองวาด call tree เล็ก ๆ แบบในขั้นที่ 1 แล้วมองหาตัวที่ซ้ำ
- ไม่เหมาะเมื่อ subproblem ไม่ทับกัน: divide and conquer ธรรมดาก็พอ
- ไม่เหมาะเมื่อมีกฎแบบ greedy ที่พิสูจน์แล้วว่า optimal สำหรับปัญหานั้น (เช่น การทอนเงินในระบบเหรียญแบบ canonical): greedy ง่ายกว่าและเร็วกว่า
- ไม่เหมาะเมื่อ state space ใหญ่มหาศาล เช่นความจุระดับพันล้าน หรือ state ที่ต้องจดว่าของ n ชิ้นไหนถูกใช้ไปแล้ว (2ⁿ subset) ตรงนั้นใช้การประมาณค่า, branch and bound หรือ heuristic จะเหมาะกว่า

## ได้อะไร เสียอะไร

- **แลก memory กับเวลา** ตารางเปลี่ยนเวลาแบบ exponential ให้เป็นหนึ่งช่องต่อหนึ่ง state: O(A) ช่องสำหรับเหรียญ และ O(m·n) สำหรับ string สองตัว การเก็บไว้แค่แถวที่ยังต้องใช้ช่วยประหยัด memory แต่จะเสียข้อมูลที่ต้องใช้สร้างคำตอบกลับขึ้นมา
- **Top-down หรือ bottom-up** memoization เปลี่ยนโค้ด recursive ที่มีอยู่น้อยที่สุด และคำนวณแค่ state ที่คำตอบต้องใช้ แต่ต้องจ่ายค่า function call กับการ hash และยังมีความลึกของ recursion อยู่ ส่วน tabulation ต้องมีลำดับที่ชัดเจนและเติมทุกช่อง แต่รันเป็น loop แน่น ๆ บน array และทิ้งแถวที่ไม่ใช้แล้วได้
- **Cache ที่ไม่จำกัดขนาดจะโตไปเรื่อย ๆ** `functools.cache` ไม่เคย evict เลย ถ้าเป็น process ที่รันนาน ๆ การ memoize function บนชุด argument ที่ไม่มีขอบเขตจะทำให้ memory รั่ว `functools.lru_cache(maxsize=...)` จำกัดขนาด cache ได้ และ `cache_clear()` ก็ล้างมันได้
- **Pseudo-polynomial ไม่ใช่ polynomial** knapsack แบบ O(n·W) เร็วตราบที่ W ยังเล็ก ตารางโตตามค่าของ W ไม่ได้โตตามจำนวนหลักที่ใช้เขียนมัน
- **ส่วนที่ยากคือ state** ถ้าตกหล่นอะไรที่คำตอบต้องพึ่งไป recurrence ก็จะให้ผลผิด ถ้าใส่มากเกินไป ตารางก็จะระเบิด

## ข้อควรรู้ตอนลงมือทำ

- **Python:** `@functools.cache` และ `@functools.lru_cache` ทำ memoize ให้ และ `cache_info()` แสดง hit กับ miss (7 กับ 7 ในขั้นที่ 2) ส่วนตารางแบบ bottom-up ใช้ list ธรรมดาที่ index ด้วย state ก็พอ และ recursion แบบ memoize ที่ลึกเกินไปจะพังด้วย `RecursionError` ตารางใหญ่ ๆ เลยควรเติมแบบ bottom-up แทน
- **Diff:** การเทียบไฟล์สองไฟล์ทีละบรรทัดคือปัญหา longest common subsequence ส่วน diff ตั้งต้นของ Git (`--diff-algorithm=myers` คู่กับ `minimal`, `patience` และ `histogram`) คืออัลกอริทึมของ Myers ปี 1986 มันหา edit script ที่สั้นที่สุดที่ประกอบด้วยการ insert และ delete (คู่ตรงข้ามของ longest common subsequence) ในรูปของ shortest path บน *edit graph* ที่ตาราง DP จะต้องเติม แต่มันสำรวจกราฟนั้นตามลำดับจำนวนการแก้ D แทนที่จะเติมทุกช่อง ทำให้เป็น O(N·D) โดยที่ N คือความยาวรวม และเร็วเมื่อสองเวอร์ชันต่างกันนิดเดียว
- **คำแนะนำการสะกดและ fuzzy search** จัดอันดับตัวเลือกตาม edit distance ตัว extension `fuzzystrmatch` ของ PostgreSQL มี `levenshtein()` ที่กำหนดต้นทุนของ insert, delete และ substitution ได้ สำหรับ string ยาวไม่เกิน 255 ตัวอักษร และ `levenshtein_less_equal()` ที่เป็นแบบเร็วกว่าสำหรับตอนที่สนใจแค่ระยะเล็ก ๆ ส่วน query `fuzzy` ของ Elasticsearch จับคู่ term ที่ห่างกันไม่เกิน 2 edit และโดย default นับการสลับตัวอักษรสองตัวที่อยู่ติดกันเป็น edit เดียว
- **Bioinformatics:** Needleman–Wunsch (1970) จัดเรียงลำดับสองลำดับทั้งเส้นบน grid แบบเดียวกัน โดยใช้ substitution score และ gap penalty แทนต้นทุนหนึ่งหน่วย ส่วน Smith–Waterman (1981) ดัดแปลงมันไว้หาบริเวณย่อยที่ตรงกันดีที่สุด
- **Query planner:** optimizer ของ System R (Selinger และคณะ, 1979) เลือกลำดับการ join ด้วยการหา plan ที่ถูกที่สุดสำหรับแต่ละชุดของ table สร้างชุดที่ใหญ่ขึ้นจากชุดที่เล็กกว่า และเก็บ plan ไว้หนึ่งตัวต่อชุดและต่อ *interesting order* คือ sort order ที่ query เอาไปใช้ต่อได้ เช่นลำดับที่ ORDER BY หรือ GROUP BY ต้องการ ส่วน planner ของ PostgreSQL ก็ join สอง relation แล้วสาม แล้วต่อไปเรื่อย ๆ แบบเดียวกัน และ source ของมันก็เรียกสิ่งนี้ว่า dynamic programming เอกสารของมันบอกว่าการค้นหาที่เกือบจะครบทุกแบบนี้ (เริ่มใช้ครั้งแรกใน System R) จะช้าและกิน memory มากขึ้นเมื่อจำนวน join เพิ่มขึ้น พอมี FROM item ถึง `geqo_threshold` (ค่าตั้งต้น 12) PostgreSQL เลยเปลี่ยนไปใช้ genetic query optimizer ที่ยอมรับ plan ที่พอใช้ได้แทน plan ที่ดีที่สุด
- **เสียงพูดและ sequence labelling:** อัลกอริทึม Viterbi หาลำดับ hidden state ที่น่าจะเป็นที่สุดใน hidden Markov model ด้วยการเติม trellis ของ time step คูณ state โดยเก็บ path ที่ดีที่สุดที่จบที่แต่ละ state ไว้ [บทเรื่อง hidden Markov model](https://web.stanford.edu/~jurafsky/slp3/A.pdf) ของ Jurafsky กับ Martin ชี้ว่ามันคล้าย minimum edit distance มากแค่ไหน
- **การจัดเรียงพิมพ์:** TeX ตัดย่อหน้าเป็นบรรทัดด้วยอัลกอริทึม Knuth–Plass ที่มองการตัดบรรทัดเป็น shortest path ผ่านเครือข่ายแบบ acyclic ของจุดตัดที่เป็นไปได้ และเก็บ demerit รวมที่น้อยที่สุดของทุกทางที่ไปถึงจุดตัดแต่ละจุดไว้ บรรทัดที่หลวมนิดหน่อยตอนต้นอาจแลกได้บรรทัดที่ดีกว่าในภายหลัง และวิธีที่ทำทีละบรรทัดไม่มีวันเห็นจุดนี้
- **Memoization ก็คือ caching:** memo คือ cache ที่ entry ไม่เคยเก่า เพราะ pure function คืนคำตอบเดิมสำหรับ argument เดิม การ cache ข้อมูลจาก service แบบใน [Cache-Aside](../cache-aside/) ต้องจัดการเรื่อง expiry, eviction และ invalidation ที่ memo ไม่ต้องสนใจ และการ memoize function ที่มี side effect หรือให้ผลที่ขึ้นกับเวลาถือเป็น bug
