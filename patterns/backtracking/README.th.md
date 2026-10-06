## ปัญหา

ปัญหาหลายข้อถามหาการจัดวางที่ทำตามกฎชุดหนึ่ง: queen ที่ไม่โจมตีกัน ตาราง sudoku ที่เติมครบ ของที่รวมกันได้พอดีงบ หรือตารางเวลาที่ไม่ชนกัน คำตอบที่เป็นไปได้ทุกตัวคือลำดับของตัวเลือกเล็ก ๆ และจำนวนคำตอบที่เป็นไปได้ก็คูณเพิ่มขึ้นทุกครั้งที่เลือก: การวาง queen แถวละตัวบนกระดาน 4 × 4 มี 4⁴ = 256 แบบ และบนกระดานหมากรุกมี 8⁸ = 16,777,216 แบบ การสร้างคำตอบที่สมบูรณ์ทุกตัวแล้วค่อยทดสอบทีหลัง (generate-and-test) เสียเวลาเกือบทั้งหมดไปกับคำตอบที่พังไปตั้งแต่ตัวเลือกแรก ๆ สองสามตัวแล้ว

## ทำงานยังไง

Backtracking ขยายคำตอบบางส่วนทีละตัวเลือก และทดสอบกฎหลังทุกตัวเลือก แทนที่จะรอทดสอบตอนจบ:

1. **เลือก** การตัดสินใจถัดไป (ตรงนี้คือคอลัมน์ของ queen ในแถวถัดไป) แล้วหยิบตัวเลือกของมันมาหนึ่งตัว
2. **ตรวจ** คำตอบบางส่วนกับ constraint ถ้ามันผิดกฎไปแล้ว ก็ทิ้งตัวเลือกนั้น: ทุกคำตอบที่จะงอกออกมาจากมันถูกตัดทิ้งในก้าวเดียว
3. **ลงลึก**: ถ้าตรวจผ่าน ก็เก็บตัวเลือกนั้นไว้แล้วไปที่การตัดสินใจถัดไป คำตอบบางส่วนที่ตัดสินใจครบทุกข้อแล้วก็คือคำตอบ
4. **Undo**: ถ้าการตัดสินใจไหนไม่เหลือตัวเลือกแล้ว ให้กลับไปที่การตัดสินใจก่อนหน้า ถอนตัวเลือกนั้น แล้วลองตัวเลือกถัดไปของมัน

ตัวเลือกประกอบกันเป็น tree ที่ไม่เคยถูกเก็บไว้ ตัว root ของมันคือกระดานเปล่า แต่ละชั้นคือการตัดสินใจหนึ่งข้อ และลูกแต่ละตัวคือตัวเลือกหนึ่งตัว Backtracking เดินไปบนมันแบบ depth first สร้างมันไปพร้อมกับที่เดิน และเก็บไว้แค่ path ปัจจุบัน คือ choice stack นี่คือสิ่งที่แยกมันออกจาก [Depth-First Search](../depth-first-search/) ที่เดินบนกราฟที่มีอยู่แล้ว และแยกจาก [Dynamic Programming](../dynamic-programming/) ที่คุ้มเมื่อ subproblem เดิมโผล่มาซ้ำแล้วซ้ำอีก: path สองเส้นที่ต่างกันใน tree ของ backtracking แทบไม่เคยไปถึงคำตอบบางส่วนตัวเดียวกัน ส่วน recursion ที่มักใช้ implement มันอธิบายไว้ใน [Recursion & the Call Stack](../recursion/)

ไดอะแกรมรัน 4-Queens โดยไล่แถวจากบนลงล่าง และคอลัมน์จากซ้ายไปขวา แล้วหยุดที่คำตอบแรก มันลองไป 26 ช่อง วาง queen 8 ครั้ง และ undo 4 ครั้ง ก่อนจะได้คอลัมน์ 1, 3, 0, 2 ส่วนคำตอบอีกตัวเดียวที่มีคือภาพสะท้อนของมัน คือ 2, 0, 3, 1 ส่วนช่องที่โดนโจมตี 18 ช่องตัดกระดานแบบแถวละหนึ่ง queen ไป 114 แบบจาก 256 แบบ โดยไม่ต้องสร้างสักแบบ และคำตอบก็คือกระดานแบบที่ 115 ตามลำดับการค้นหา

**ทำให้ tree เล็กลง** การตรวจและลำดับของตัวเลือกเป็นตัวตัดสินว่าการค้นหาจะจบในหนึ่งมิลลิวินาที หรือไม่จบเลย:

- **ตรวจแต่เนิ่น ๆ และให้ต้นทุนต่ำ** `n_queens` ข้างล่างเก็บ set ของคอลัมน์และแนวทแยงที่โดนโจมตีไว้ การทดสอบช่องหนึ่งเลยเป็นแค่การเปิดดู set สามครั้ง ไม่ต้องสแกนทั้งกระดาน
- **แตกกิ่งที่การตัดสินใจที่ถูกจำกัดมากที่สุดก่อน** Golomb กับ Baumert เสนอไว้ในปี 1965 ให้เลือกตัวแปรที่เหลือตัวเลือกน้อยที่สุด (minimum remaining values หรือ "fail first") ทางตันจะได้โผล่ใกล้ root ที่การตัดทิ้งช่วยประหยัดได้มากที่สุด ภายในการตัดสินใจหนึ่งข้อ ให้ลองค่าที่น่าจะใช้ได้ที่สุดก่อน เช่น *least constraining value* คือค่าที่ตัดตัวเลือกของตัวอื่นไปน้อยที่สุด
- **กระจาย constraint** forward checking ลบตัวเลือกที่ตัวเลือกใหม่ตัดทิ้งไปออกจากการตัดสินใจที่ยังเปิดอยู่ และถอยกลับทันทีที่มีตัวไหนไม่เหลือตัวเลือก ตัวแก้ sudoku ของ Peter Norvig ใช้กฎกระจาย constraint สองข้อร่วมกับ depth-first search ที่เติมช่องที่มีตัวเลือกน้อยที่สุดก่อน เฉลี่ยแล้วใช้หนึ่งในร้อยวินาทีต่อ puzzle สุ่มหนึ่งข้อ
- **คำตอบแรกหรือทุกคำตอบ** generator ให้ได้ทั้งสองแบบจากโค้ดเดียวกัน: `next()` หยุดที่คำตอบแรก และ loop ก็เก็บมาได้ทั้งหมด การหาทุกคำตอบใช้งานมากกว่ากันเยอะ: N-Queens มี 2 คำตอบสำหรับ n = 4 มี 92 สำหรับ n = 8 และ 14,200 สำหรับ n = 12

**ญาติ ๆ**

- **Permutation, subset และ combination** มาจาก template เดียวกัน โดยตัดกิ่งน้อยหรือไม่ตัดเลย `backtrack` แบบทั่วไปข้างล่างสร้างได้ทั้งสองแบบ ถ้าแค่ต้องการไล่รายการพวกนี้ `itertools.permutations`, `combinations` และ `product` เป็นทางเลือกที่ง่ายกว่า
- ปัญหา **exact cover** (การปู polyomino, N-Queens, sudoku) เหมาะกับ Algorithm X ของ Knuth ส่วน *Dancing Links* ของเขาเก็บตัวเลือกไว้ใน doubly linked list การเอาตัวเลือกออกและใส่กลับ (ก็คือขั้น undo) เลยใช้แค่การอัปเดต pointer ไม่กี่ตัวต่อครั้ง
- **SAT solver** โตมาจาก backtracking ขั้นตอน DPLL (Davis, Logemann กับ Loveland, 1962) กำหนดค่าตัวแปร Boolean ทีละตัว และกระจาย clause ที่เหลือ literal ตัวเดียว ส่วน solver แบบ conflict-driven clause learning (CDCL) ในวันนี้ก็ยังค้นหาแบบนี้ แต่เรียนรู้ clause ใหม่จากทุก conflict และกระโดดย้อนข้ามการตัดสินใจหลายข้อได้ในทีเดียว
- **Constraint programming** รันการค้นหาแบบเดียวกันแต่กระจาย constraint ได้แรงกว่า สำหรับการจัดเวร การจัดตารางเวลา และ job-shop scheduling ส่วน CP-SAT solver ของ Google OR-Tools ก็เป็นตัวอย่างที่รวม constraint programming เข้ากับเทคนิคของ SAT

**ประวัติ** ตามที่ Knuth เล่า Gauss อธิบายไว้ในจดหมายปี 1850 ว่าจะหาทุกคำตอบของ puzzle แปด queen ด้วยการลองอย่างเป็นระบบแบบนี้ได้ยังไง และ R. J. Walker ตั้งชื่อวิธีนี้ว่า "backtrack" ในทศวรรษ 1950 (แหล่งอื่น รวมถึง Wikipedia ให้เครดิตกับ D. H. Lehmer) Walker อธิบายมันเป็นเทคนิคทั่วไปในปี 1960 และ paper *Backtrack Programming* ปี 1965 ของ Solomon Golomb กับ Leonard Baumert ก็ระบุปัญหาแบบทั่วไปไว้ และไล่ดูการประยุกต์ใช้หลายแบบ

**เมื่อ tree ระเบิด: catastrophic regex backtracking** regex engine ในสาย Perl ได้แก่ Perl, PCRE, `re` ของ Python, `java.util.regex` ของ Java และ engine ตั้งต้นของ .NET ทำ match ด้วย backtracking: ที่แต่ละจุดที่ต้องเลือก (ซ้ำอีกรอบหรือหยุด ใช้ทางเลือกนี้หรือตัวถัดไป) มันจะเลือกกิ่งหนึ่ง แล้วกลับมาลองกิ่งอื่นเมื่อ pattern ส่วนที่เหลือ match ไม่ผ่าน ตัว quantifier ที่ซ้อนกันทำให้กลายเป็นการค้นหาแบบ exponential ถ้า match `(a+)+b` กับ a จำนวน n ตัวที่ไม่มี b เลย engine แบ่ง a ระหว่าง `+` ตัวในกับตัวนอกได้ 2ⁿ⁻¹ แบบ และมันลองทุกแบบ พร้อมกับทุกการแบ่งของ prefix ที่สั้นกว่าทุกตัว ก่อนจะรายงานว่าไม่ match ตัวอย่างเช่นบน CPython 3.11 ตัว `re.match(r'(a+)+b', 'a' * n)` ใช้เวลาราว 60 ms สำหรับ n = 20 บนเครื่องที่ใช้ทำหน้านี้ และเพิ่มขึ้นราวเท่าตัวทุกครั้งที่เพิ่ม a อีกหนึ่งตัว ทำให้ a 30 ตัวจะใช้เวลาราวหนึ่งนาที ถ้าผู้ใช้เป็นคนป้อน input เอง นี่คือช่องโหว่ denial-of-service หรือ **ReDoS** หน้าของ OWASP แสดงรูปแบบที่เจอบ่อย คือ group ที่ซ้ำ และข้างในก็มีการซ้ำอีก หรือทางเลือกที่ match ข้อความเดียวกันได้

เหตุการณ์ที่รู้จักกันมากที่สุดคือ Cloudflare ล่มเมื่อวันที่ 2 กรกฎาคม 2019 ตอนนั้น rule ใหม่ใน web application firewall ของบริษัทมี regular expression ที่มีส่วน `.*(?:.*=.*)` แล้ว regex นี้ก็ backtrack หนักมากจน CPU ทุก core ที่รับ traffic HTTP และ HTTPS ทั่วทั้งเครือข่ายถูกใช้จนหมด การล่มกินเวลา 27 นาที จนกระทั่งปิด managed rule ทั่วโลก ต้นทุนของ pattern นั้นโตตาม input แบบ polynomial ไม่ใช่ exponential แต่ที่ scale ระดับนั้น แค่ super-linear ก็พอแล้ว สิ่งที่ Cloudflare ทำต่อจากนั้นมีทั้งการเอาระบบป้องกันการใช้ CPU ที่หายไปตอน refactor กลับมา การย้ายไปใช้ regex engine ที่รับประกันเวลารัน (RE2 หรือ regex ของ Rust) และการ roll out การเปลี่ยน rule เป็นขั้น ๆ แบบที่ซอฟต์แวร์ทำอยู่แล้ว

วิธีป้องกัน:

- **Engine แบบ linear-time** RE2, `regexp` ของ Go และ `regex` ของ Rust compile pattern เป็น automata และรับประกันเวลา match ที่เป็น linear ตาม input (O(m × n) สำหรับ pattern ขนาด m ตามเอกสารของ Rust) แลกกับการตัด backreference และ look-around ออก บทความปี 2007 ของ Russ Cox อธิบายแนวทางนี้ ที่ย้อนไปถึงวิธีสร้างของ Ken Thompson ปี 1968 และอธิบายว่ามันนำหน้า backtracking ไปไกลแค่ไหนบน pattern แบบนี้ ตั้งแต่ .NET 7 ตัว `RegexOptions.NonBacktracking` ก็ให้การรับประกันแบบเดียวกันใน .NET
- **จำกัดเวลา** .NET รับ match timeout ใน constructor ของ `Regex` และใน static method หรือเป็นค่าตั้งต้นของทั้ง process (`REGEX_DEFAULT_MATCH_TIMEOUT`) และ throw `RegexMatchTimeoutException` เมื่อหมดเวลา ถ้าไม่ได้ตั้งไว้ timeout จะเป็นอนันต์ ส่วน `re` ของ Python และ `Pattern` ของ Java ไม่มี timeout เลยควรจำกัดความยาว input หรือรัน match ที่เสี่ยงในที่ที่หยุดมันได้ แนวคิดเดียวกับ [Timeout & Fallback](../timeout-and-fallback/)
- **ห้าม backtrack เข้าไปใน group** atomic group `(?>…)` และ possessive quantifier (`*+`, `++`, `?+`) ทิ้งจุดที่ต้องเลือกข้างในไปเมื่อ match แล้ว Java รองรับทั้งสองแบบ และ `re` ของ Python ก็มีตั้งแต่ 3.11 แล้วถ้าลองกับ a 20 ตัวชุดเดิม `(?>a+)+b` กับ `(a+)++b` จะ fail ภายในหนึ่งในสิบมิลลิวินาทีหรือน้อยกว่า หลายครั้งวิธีแก้ที่ง่ายที่สุดคือเขียนใหม่: `(a+)+b` match string ชุดเดียวกับ `a+b` ทุกตัว

## โค้ด

```python
def n_queens(n):
    """Yield (columns, squares_tried) for each solution; columns[row] = queen's column."""
    queens = []                                   # the choice stack
    cols, diag, anti = set(), set(), set()        # attacked columns and diagonals
    tried = 0

    def place(row):
        nonlocal tried
        if row == n:                              # every row has a queen
            yield queens.copy(), tried
            return
        for col in range(n):                      # choose a square in this row
            tried += 1
            if col in cols or row - col in diag or row + col in anti:
                continue                          # check failed: prune this branch
            queens.append(col)
            cols.add(col); diag.add(row - col); anti.add(row + col)
            yield from place(row + 1)             # go deeper
            queens.pop()                          # undo, then try the next column
            cols.remove(col); diag.remove(row - col); anti.remove(row + col)

    yield from place(0)


def backtrack(partial, options, ok, done):
    """The bare template: extend partial with each option that passes ok(), then undo."""
    if done(partial):
        yield partial.copy()
        return
    for x in options(partial):
        if ok(partial, x):
            partial.append(x)                     # choose
            yield from backtrack(partial, options, ok, done)
            partial.pop()                         # undo


print(next(n_queens(4)))                          # ([1, 3, 0, 2], 26)
print([cols for cols, _ in n_queens(4)])          # [[1, 3, 0, 2], [2, 0, 3, 1]]
print(sum(1 for _ in n_queens(8)))                # 92

word = 'abc'                                      # permutations: each letter once
perms = backtrack([], lambda p: word, lambda p, x: x not in p, lambda p: len(p) == len(word))
print([''.join(p) for p in perms])                # ['abc', 'acb', 'bac', 'bca', 'cab', 'cba']

nums = [2, 3, 5, 6, 8]                            # increasing subsets that add up to 11
sums = backtrack([], lambda p: [x for x in nums if not p or x > p[-1]],
                 lambda p, x: sum(p) + x <= 11, lambda p: sum(p) == 11)
print(list(sums))                                 # [[2, 3, 6], [3, 8], [5, 6]]
```

`n_queens` เป็น generator ตัว `next()` เลยหยุดที่คำตอบแรกหลังลองไป 26 ช่อง (ก็คือการรันในไดอะแกรม) ส่วน loop จะหาได้ทั้งหมด แนวทแยงระบุได้ด้วย `row - col` ในทิศหนึ่ง และ `row + col` ในอีกทิศ การตรวจความปลอดภัยเลยเป็นการเปิดดู set สามครั้ง และ undo ก็เอาออกเฉพาะสิ่งที่ตัวเลือกใส่เข้าไปพอดี สำหรับ n = 8 คำตอบแรกคือ 0 4 7 5 2 6 1 3 มาหลังลองไป 876 ช่อง `backtrack` คือ template เปล่า ๆ: เราให้ตัวเลือก การตรวจ และการทดสอบว่าคำตอบเสร็จแล้วเอง โค้ดถูกตรวจเทียบกับ brute force บนทุก permutation สำหรับ n ไม่เกิน 7 เทียบกับจำนวนที่รู้กันสำหรับ n = 0 ถึง 10 (1, 1, 0, 0, 2, 10, 4, 40, 92, 352, 724) และกับ edge case n = 0 (การวางแบบว่างหนึ่งแบบ), n = 1, n = 2 และ 3 (ไม่มีคำตอบ), คำว่าง และ target ที่ไม่มี subset ไหนรวมได้

## Complexity

ถ้ามีการตัดสินใจ d ข้อ ตัวเลือกไม่เกิน b ตัวต่อการตัดสินใจ และการตรวจเป็น O(1):

| | Time | พื้นที่เพิ่ม | ทำไม |
|---|---|---|---|
| Best case | ตรวจ O(b · d) ครั้ง | O(d) | ตัวเลือกแรกที่ตรวจผ่านในทุกชั้นพาไปถึงคำตอบตรง ๆ: ตรวจไม่เกิน b ตัวเลือกต่อชั้น และไม่มีอะไรต้อง undo |
| Average case | ไม่มีขอบเขตแบบทั่วไป | O(d) | ขึ้นกับว่าการตรวจ fail เร็วแค่ไหน และลำดับของตัวเลือก ตัวแก้ sudoku ของ Norvig เฉลี่ย 0.01 s ต่อ puzzle สุ่มหนึ่งข้อ แต่ราวหนึ่งในล้าน puzzle ใช้เวลาเกิน 100 s |
| Worst case | O(bᵈ) node | O(d) | ถ้าไม่มีอะไร fail จนถึงชั้นสุดท้าย การค้นหาก็ต้องไปทั้ง tree |
| `n_queens(n)` ทุกคำตอบ | ลอง O(n · n!) ช่อง | O(n) | การตรวจคอลัมน์อย่างเดียวก็เหลือการวาง queen k ตัวไม่เกิน n!/(n − k)! แบบ และแต่ละแบบลอง n ช่อง การตรวจแนวทแยงตัดทิ้งได้มากกว่านั้นเยอะ: ทั้ง 92 คำตอบสำหรับ n = 8 ลองไป 15,720 ช่อง เทียบกับกระดานแบบแถวละหนึ่ง queen 8⁸ = 16,777,216 แบบ และ permutation 8! = 40,320 แบบ พื้นที่คือ list ของ queen, set สามตัวที่มีไม่เกิน n entry และ generator frame n อัน |

พื้นที่เพิ่มคือ choice stack บวกกับ state อะไรก็ตามที่การตรวจเก็บไว้ ไม่เคยเป็นตัว tree เรื่อง stable และ in place ไม่เกี่ยว [Big-O Notation](../big-o-notation/) อธิบายสัญลักษณ์เหล่านี้

## ใช้ตอนไหนดี

- ปัญหา constraint ที่ปัดตก candidate บางส่วนได้ตั้งแต่ยังไม่ครบ: puzzle (sudoku, N-Queens, crossword, การปูกระเบื้อง) configuration การออกแบบเชิง combinatorial และตารางเวลาเล็ก ๆ
- ไล่รายการการจัดวางทุกแบบที่ทำตามกฎ หรือแบบแรกตามลำดับที่กำหนดไว้
- ใช้ทางอ้อมผ่านเครื่องมือที่สร้างบนมัน: SAT solver, constraint solver และ parser ที่ลองทางเลือกหลายทาง
- ไม่เหมาะเมื่อมีวิธีที่ถูกกว่า: ถ้า subproblem เดิมซ้ำกัน ให้ใช้ dynamic programming ถ้าการเลือกแบบ greedy พิสูจน์ได้ว่าปลอดภัย ก็เลือกแบบนั้น ([Greedy Algorithms](../greedy-algorithms/)) ส่วน shortest path, matching และ flow มีอัลกอริทึมแบบ polynomial อยู่แล้ว
- ไม่เหมาะกับ regular expression บน input ที่ไม่น่าไว้ใจ ใน engine แบบ backtracking ที่ไม่มีการจำกัดเวลา

## ได้อะไร เสียอะไร

- **Worst case เป็น exponential** pruning การเรียงลำดับ และการกระจาย constraint ช่วยย่อ tree บน input ทั่วไป แต่ instance ที่ยากก็ยังใช้เวลาไม่รู้จบได้ และบอกล่วงหน้าได้ยากว่า input ไหนยาก
- **เวลารันแบบ heavy-tailed** ในการทดลองของ Norvig มี puzzle หนึ่งข้อใช้เวลา 188.79 s พอสลับลำดับค่าแบบสุ่ม ก็มี 27 จาก 30 รอบที่จบในเวลาไม่ถึง 0.02 s ส่วนอีก 3 รอบใช้ราว 190 s การเรียงลำดับแบบสุ่มร่วมกับการ restart เป็นวิธีแก้มาตรฐาน ที่ survey ของ van Beek พูดถึงไว้
- **ใช้ memory น้อย** เก็บแค่ path ปัจจุบัน O(depth) ทั้งที่ [breadth-first search](../breadth-first-search/) จะต้องเก็บทั้งชั้นของ tree ไว้พร้อมกัน
- **Undo ต้องเป๊ะ** ทุกอย่างที่ตัวเลือกหนึ่งเปลี่ยนไป (set, counter, กระดาน) ต้องถูกคืนค่า ปกติจะคืนในลำดับกลับด้าน ไม่อย่างนั้นการตรวจครั้งหลัง ๆ จะรันบน state ที่ผิด และคำตอบก็ผิดแบบเงียบ ๆ การ copy state ทุก node ง่ายกว่าแต่ช้ากว่า
- **ความลึกของ recursion** backtracker แบบ recursive ต้องใช้หนึ่ง frame ต่อการตัดสินใจหนึ่งข้อ สำหรับ N-Queens ไม่เป็นปัญหาเลย แต่ถ้ามีการตัดสินใจหลายพันข้อใน Python ที่มี recursion limit ตั้งต้นที่ 1000 ให้ใช้ explicit stack

## ข้อควรรู้ตอนลงมือทำ

- **Python:** เขียนการค้นหาเป็น generator (`yield`, `yield from`) ให้คนเรียกเลือกเองว่าจะเอาคำตอบแรกหรือทุกคำตอบ เก็บ state ของ constraint ไว้ใน set หรือ bit mask เพื่อให้ตรวจได้ใน O(1) และหยิบ `itertools` มาใช้ถ้าไม่มีอะไรต้องตัดกิ่ง
- **Regex engine:** Perl, PCRE, `re` ของ Python, Java และ .NET (โดย default) ใช้ backtracking ส่วน RE2 (C++ มี binding ให้หลายภาษา), `regexp` ของ Go, `regex` ของ Rust และ option `NonBacktracking` ของ .NET รันใน linear time ให้ถือว่า regex ที่รันทุก request ไม่ว่าจะใน gateway, WAF หรือ input validation เป็นโค้ด: ทดสอบมันกับ input ที่เกือบ match ตั้งขอบเขตเวลาให้มัน และ roll out การเปลี่ยนแปลงเป็นขั้น ๆ ([Canary Release](../canary-release/))
- **Solver:** สำหรับปัญหาการจัดตาราง การจัดเวร หรือ configuration ของจริง ให้อธิบาย constraint ให้ constraint solver หรือ SAT solver (เช่น OR-Tools CP-SAT) แทนที่จะเขียนการค้นหาเอง มันมาพร้อมการกระจาย constraint ที่แรง และการเรียนรู้แบบที่ SAT solver มี
- **Exact cover:** Dancing Links รับมือกับ sudoku การปู polyomino และปัญหา exact cover อื่น ๆ ด้วย undo ที่ใช้แค่การอัปเดต pointer ไม่กี่ตัว
- **Parser:** PEG parser ลองทางเลือกของ rule ตามลำดับ และ backtrack เมื่อทางหนึ่ง fail ส่วน parser ของ CPython เองก็เป็น PEG parser ตั้งแต่ 3.9 และ PEP 617 อธิบายว่าการ memoize rule ที่ match ไปแล้วในแต่ละตำแหน่ง (packrat parsing) ทำให้ backtracking นั้นยังถูกอยู่ แลกกับ memory ที่เพิ่มขึ้นนิดหน่อย
