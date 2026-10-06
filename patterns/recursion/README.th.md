## ปัญหา

บางปัญหามีสำเนาที่เล็กกว่าของตัวเองซ่อนอยู่ข้างใน factorial คือ n คูณกับ factorial ที่เล็กกว่า ส่วน folder หนึ่งก็มีทั้งไฟล์และ folder อื่นอยู่ข้างใน ค่า JSON หนึ่งค่าก็มีค่า JSON อื่นอยู่ข้างในได้ และ subtree ทุกอันของ tree ก็เป็น tree เหมือนกัน ถ้าใช้ loop เดินบนโครงสร้างแบบนี้ เราต้องจำเองว่าตอนนี้อยู่ตรงไหนและเหลืออะไรต้องทำอีก recursion ยกงานจดบันทึกนี้ให้ภาษาจัดการแทน: function ตอบกรณีที่เล็กที่สุดเองเลย ส่วนกรณีอื่นก็ส่งต่อให้ call ของตัวเองด้วย input ที่เล็กลง แล้ว runtime ก็เก็บแต่ละ call ที่ยังไม่เสร็จไว้บน **call stack** จนกว่าคำตอบของมันจะกลับมา

งานจดบันทึกนี้มีราคาที่ต้องจ่าย call ที่ยังค้างอยู่ทุกตัวถือ stack frame ไว้หนึ่ง frame ตัว stack มีขนาดจำกัด และ function ที่เรียกตัวเองมากกว่าหนึ่งครั้งอาจต้องแก้ subproblem เดิมซ้ำแล้วซ้ำอีก

## ทำงานยังไง

recursive function ทุกตัวต้องมีสองส่วน:

- **base case** ที่ return คำตอบโดยไม่เรียกตัวเองต่อ (`if n <= 1: return 1`) และ
- **recursive case** ที่เรียก function ด้วย input ที่ใกล้ base case เข้าไปอีก (`fact(n - 1)`) แล้วเอาผลที่ได้มาสร้างคำตอบของตัวเอง (`n * fact(n - 1)`)

เวลาตรวจ recursive function ไม่ต้องไล่ทุกชั้น ให้ตรวจว่า base case ถูก แล้ว*เชื่อใจ call ที่เล็กกว่า*: สมมติว่า `fact(n - 1)` return ค่าที่ถูก แล้วตรวจว่าถ้าเป็นอย่างนั้น `n * fact(n - 1)` ก็ถูกสำหรับ n นี่คือการพิสูจน์แบบ induction และก็เป็นวิธีเขียน function นี้ตั้งแต่แรกด้วย อีกครึ่งหนึ่งของเหตุผลคือความคืบหน้า: ทุก call ต้องขยับเข้าใกล้ base case ถ้าลืมใส่ base case หรือก้าวข้ามมันไป (นับถอยหลังทีละ 2 จากเลขคี่ เข้าหา base case ที่ต้องเป็น 0 พอดี) call ก็จะไม่มีวันจบ

ตอนรัน แต่ละ call จะ push **stack frame** หนึ่งอัน frame นี้ถือ argument กับตัวแปร local ของ call นั้น งานที่ยังต้องทำต่อหลังจาก call ข้างในกลับมา (`4 × ?` ที่ค้างอยู่ใน animation) และจุดที่ต้อง return กลับไป คือจุดใน caller ที่จะทำงานต่อด้วยผลลัพธ์นั้น มีแค่ frame ใหม่ที่สุดที่รันอยู่ ส่วน frame ทุกอันข้างล่างหยุดรอ พอ base case return แล้ว stack ก็ **unwind**: frame ถูก pop ออกในลำดับย้อนกลับ แต่ละ frame ก็ทำขั้นของตัวเองให้เสร็จด้วยค่าที่ได้กลับมา

recursion เข้ากับ **ข้อมูลที่เป็น recursive** function ที่เดินบน tree, list ซ้อนกัน, เอกสาร JSON, directory หรือ syntax tree จะมีรูปร่างเหมือนข้อมูล และความลึกของมันก็เท่ากับความลึกของการซ้อนในข้อมูล **Divide and conquer** เรียกตัวเองบนชิ้นส่วนของ input: [merge sort](../merge-sort/) กับ [quicksort](../quicksort/) เรียกตัวเองบนสองส่วน ส่วน [binary search](../binary-search/) เรียกบนครึ่งเดียว ความลึกของมันเลยโตตาม log n ไม่ใช่ n (สำหรับ quicksort คือโดยเฉลี่ย)

**recursion หรือ loop?** อะไรที่เป็น recursive ก็เขียนเป็น loop ได้ และกลับกันก็ได้ recursion แบบ *linear* อย่าง `fact` ที่เรียกครั้งเดียวต่อหนึ่งขั้น อ่านง่ายพอ ๆ กับ loop แต่ loop ใช้แค่ frame เดียวแทนที่จะเป็น n frame หนังสือ *Structure and Interpretation of Computer Programs* (หัวข้อ 1.2.1) เทียบรูปร่างสองแบบนี้ให้เห็น: process แบบ recursive สร้างสายของการคูณที่รอไว้ทำทีหลัง ส่วนแบบ iterative ถือ state ทั้งหมดไว้ในตัวแปรชุดเดียวที่มีจำนวนคงที่ recursion แบบ *branching* อย่างการเดินบน tree หรือการลองตัวเลือกต่าง ๆ แล้วถอยกลับออกมา คือจุดที่ recursion อ่านง่ายกว่ามาก ถ้าจะเอา recursion ออก ให้ถือ stack ของตัวเองไว้ คือ list ที่เรา push เข้าและ pop ออก:

```python
def total(items):                 # recursive: lists nested to any depth
    return sum(total(x) if isinstance(x, list) else x for x in items)

def total_iter(items):            # the same walk with an explicit stack
    result, stack = 0, [items]
    while stack:
        for x in stack.pop():
            if isinstance(x, list):
                stack.append(x)   # visit it later instead of recursing now
            else:
                result += x
    return result

print(total([1, [2, [3, 4]], 5]), total_iter([1, [2, [3, 4]], 5]))   # 15 15
```

explicit stack อยู่บน heap มันเลยโตได้เท่าที่ memory ยังมี กับ list ที่ซ้อนลึก 10,000 ชั้น `total_iter` return ได้ ส่วน `total` โยน `RecursionError` ออกมา `os.walk` ของ Python เองก็เปลี่ยนแบบเดียวกันใน 3.12 เพื่อให้ directory tree ที่ลึกมาก ๆ ไม่ชน recursion limit อีก ([CPython issue 89727](https://github.com/python/cpython/issues/89727))

**Tail call** เราเรียก call หนึ่งว่า *tail call* เมื่อมันเป็นสิ่งสุดท้ายที่ function ทำ (`return f(x)`) ตัว caller ไม่เหลืองานต้องทำแล้ว frame ของมันเลยเอากลับมาใช้ซ้ำได้ และ recursion ที่มีแต่ tail call ก็รันโดยใช้ stack คงที่ได้ จะเกิดแบบนั้นจริงหรือไม่ขึ้นกับภาษา:

- **Scheme** บังคับให้ทำ: รายงาน R7RS (หัวข้อ 3.5) บอกว่า implementation ต้องเป็น properly tail-recursive และนี่คือสิ่งที่ทำให้โปรแกรม Scheme เขียน loop เป็น recursion ได้
- **JavaScript** กำหนด proper tail call ไว้ใน ECMAScript 2015 สำหรับโค้ด strict mode เท่านั้น ใน engine หลัก ๆ มีแค่ JavaScriptCore ของ Safari ที่ทำให้ใช้ได้จริง ส่วน Chrome, Edge, Firefox และ Node.js ไม่ทำ ([ตารางความเข้ากันได้](https://compat-table.github.io/compat-table/es6/))
- **Kotlin** ทำเมื่อเราขอ: function ที่ติด `tailrec` และเรียกตัวเองในตำแหน่ง tail จะถูก compile เป็น loop ([เอกสารของ Kotlin](https://kotlinlang.org/docs/functions.html))
- **Python** ไม่ทำ และตั้งใจไม่ทำ Guido van Rossum ให้เหตุผลว่าการกำจัด tail call ทิ้ง frame ที่ traceback ต้องใช้ไป และโค้ดที่พึ่งมันจะพังบน implementation ไหนก็ตามที่ไม่มีมัน ส่วน tail-calling interpreter ตัวใหม่ของ CPython 3.14 เป็นคนละเรื่องกัน มันเปลี่ยนวิธีที่โค้ด C ของตัว interpreter เองย้ายไปมาระหว่าง bytecode handler และ [release notes](https://docs.python.org/3/whatsnew/3.14.html#a-new-type-of-interpreter) ก็บอกว่า tail call ใน function ของ Python ยังไม่ถูก optimize

`fact` ตามที่เขียนไว้ไม่ใช่ tail call อยู่แล้ว เพราะการคูณเกิดหลังจาก call ข้างใน return ถ้าส่งผลคูณสะสมลงไปด้วย (`fact(n - 1, acc * n)`) มันก็จะเป็น tail call แต่ใน Python เวอร์ชันนั้นก็ยังใช้หนึ่ง frame ต่อหนึ่ง call ทางแก้จริงใน Python เลยคือ loop

**Memoization** ตัว Fibonacci แบบ naive เรียกตัวเองสองครั้งต่อหนึ่ง call และสองกิ่งนั้นซ้อนทับกัน: `fib(5)` คำนวณ `fib(3)` สองครั้ง และ `fib(2)` สามครั้ง การ cache ผลแต่ละตัวไว้ตั้งแต่ครั้งแรกที่คำนวณ ทำให้ 242,785 call ของ `fib(25)` เหลือแค่การคำนวณที่ไม่ซ้ำกัน 26 ครั้ง ใน Python ตัว `functools.cache` (3.9 ขึ้นไป) เป็น cache ที่ไม่จำกัดขนาด เหมือนกับ `functools.lru_cache(maxsize=None)` ส่วน `lru_cache` เฉย ๆ จะเก็บผลล่าสุด 128 ตัวเป็นค่า default การเติมตารางเดียวกันแบบ bottom-up โดยเริ่มจาก subproblem ที่เล็กที่สุดก่อน คือ dynamic programming และมันก็เอา recursion ออกไปด้วย

## โค้ด

```python
import functools

def fact(n):                      # n >= 0
    if n <= 1:                    # base case: answer directly
        return 1
    return n * fact(n - 1)        # recursive case: a smaller n

def fact_loop(n):                 # same result in one frame: O(1) extra space
    result = 1
    for k in range(2, n + 1):
        result *= k
    return result

calls = 0

def fib(n):                       # naive: every call makes two more
    global calls
    calls += 1
    if n <= 1:
        return n
    return fib(n - 1) + fib(n - 2)

@functools.cache                  # remembers each answer the first time
def fib_memo(n):
    if n <= 1:
        return n
    return fib_memo(n - 1) + fib_memo(n - 2)

print(fact(4), fact_loop(4))                        # 24 24
print(fib(25), calls)                               # 75025 242785
print(fib_memo(25), fib_memo.cache_info().misses)   # 75025 26
```

`cache_info().misses` นับ call ที่ต้องคำนวณค่าเอง คือหนึ่งครั้งต่อ n แต่ละตัวตั้งแต่ 0 ถึง 25 แล้ว `fact_loop(5000)` ก็ return ตัวเลขที่ยาว 16,326 หลักได้ ส่วน `fact(5000)` โยน `RecursionError: maximum recursion depth exceeded` ถ้ารันเป็น script บน CPython 3.11 มันจะไปได้ถึง `fact(4002)`: frame ของ `fact` 999 frame บวก frame ของตัว module เองรวมเป็น 1000 เท่ากับ limit ค่า default พอดี ส่วน REPL, test runner หรือ debugger จะวาง frame ของตัวเองไว้ใต้โค้ดของเรา ความลึกที่ได้จริงเลยไม่เท่ากัน

## Complexity

| | Time (best = average = worst) | พื้นที่เพิ่ม | ทำไม |
|---|---|---|---|
| `fact` | O(n) | O(n) | มี n call และตอนที่ลึกที่สุด frame ทั้ง n อันอยู่บน stack พร้อมกัน |
| `fact_loop` | O(n) | O(1) | คูณ n − 1 ครั้งเท่าเดิม แต่อยู่ใน frame เดียว และใช้ accumulator ตัวเดียว |
| `fib` (naive) | Θ(φⁿ), φ ≈ 1.618 | O(n) | มันเรียกทั้งหมด 2·F(n+1) − 1 ครั้ง (15 ครั้งเมื่อ n = 5 และ 242,785 ครั้งเมื่อ n = 25) คือเพิ่มขึ้นราว 1.6 เท่าทุกครั้งที่ n เพิ่มหนึ่ง stack ถือแค่เส้นทางปัจจุบันจาก call แรก มากสุด n frame |
| `fib_memo` | O(n) | O(n) | ค่าแต่ละตัวตั้งแต่ 0 ถึง n ถูกคำนวณครั้งเดียว แล้วอ่านจาก cache หลังจากนั้น cache ถือผล n + 1 ตัว และการดิ่งลงครั้งแรกก็ยังลึก n frame |

แต่ละ function ทำงานเท่ากันกับทุก input ที่มีขนาดเท่ากัน best, average และ worst case ของมันเลยเท่ากัน ส่วนเรื่อง stable กับ in place ใช้กับที่นี่ไม่ได้ [Big-O Notation](../big-o-notation/) อธิบายสัญลักษณ์เหล่านี้ไว้ ตารางนับการคูณหรือการบวกแต่ละครั้งเป็นหนึ่งขั้น integer ของ Python โตได้ไม่จำกัด (`5000!` ยาว 16,326 หลัก) พอ n ใหญ่มาก ๆ ตัวการคำนวณเองก็เลยช้าลง

## ใช้ตอนไหนดี

- **ข้อมูลเป็น recursive** (tree, list หรือ JSON ที่ซ้อนกัน, file system, syntax tree, grammar) และความลึกไม่มากหรือมีขอบเขต binary tree ที่ balanced และมีล้าน node ลึกแค่ราว 20 ชั้นเท่านั้น
- **Divide and conquer** ที่แต่ละ call ทำงานกับแค่ส่วนหนึ่งของ input ความลึกเลยโตตาม log n: merge sort, binary search และ quicksort โดยเฉลี่ย
- **การค้นหาบนตัวเลือก** (permutation, puzzle, parsing): stack จำไว้ให้ว่าต้องย้อนตัวเลือกไหนเป็นตัวถัดไป ตรงนี้คือหัวใจของ backtracking
- **ไม่ใช่กับสายยาว ๆ แบบ linear** ในภาษาที่ไม่มี tail-call elimination การประมวลผล list ล้านตัวทีละตัวต่อหนึ่ง call ต้องใช้ล้าน frame ให้ใช้ loop แทน
- **ไม่ใช่ตอนที่ input ที่ไว้ใจไม่ได้เป็นตัวกำหนดความลึก** เว้นแต่เราจะตั้งเพดานไว้ body ของ JSON หรือ GraphQL query ที่ซ้อนลึกมาก ๆ ทำให้ stack หมดได้ (ดูข้อควรรู้ตอนลงมือทำ)

## ได้อะไร เสียอะไร

- **ความชัดเจนแลกกับ frame** โค้ด recursive มักสะท้อนนิยามของปัญหาตรง ๆ และเขียนให้ถูกได้ง่ายกว่า แต่ทุก call เสียค่า function call กับหนึ่ง frame และ recursion ที่ลึกก็ถือ frame ทั้งหมดไว้พร้อมกัน
- **ขีดจำกัดความลึก** CPython โยน `RecursionError` เมื่อ stack ของ interpreter ถึง `sys.getrecursionlimit()` (ค่า default คือ 1000) ส่วน `sys.setrecursionlimit()` ใช้ยก limit ขึ้น และเอกสารเตือนว่าตั้งสูงเกินไปอาจทำให้ Python crash ได้: limit มีไว้เพื่อให้ recursion ที่หลุดควบคุมหยุดด้วย exception ก่อนจะล้น stack จริงของ process เพราะถ้าล้นแบบนั้น process จะจบไปเลยแทน ตั้งแต่ 3.11 call ส่วนใหญ่จากโค้ด Python ไปหา function ของ Python ไม่ใช้ C stack แล้ว limit เลยตั้งได้สูงกว่าเดิมมาก และตั้งแต่ 3.12 recursion ใน built-in function มีกลไกแยกคอยกันไว้ แต่ทุก frame ก็ยังกิน memory อยู่ดี JVM โยน `StackOverflowError` ตัวนี้เป็น `Error` ไม่ใช่ `Exception` ขนาด stack ของ thread ตั้งด้วย `-Xss` โดยค่า default คือ 1024 KB บน Linux และ macOS สำหรับ x64 และ 2048 KB สำหรับ AArch64 ส่วนบน Windows ขึ้นกับ virtual memory ([java command](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html)) ส่วน JavaScript engine โยน `RangeError: Maximum call stack size exceeded` (Chrome, Safari) หรือ `InternalError: too much recursion` (Firefox) ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Too_much_recursion))
- **ลืม base case แล้วพังช้า** recursion ไม่รู้จบไม่ได้ค้าง มันเติม stack จนเต็มแล้วโยน `RecursionError` ตัวเดียวกันไม่ว่า limit จะเป็นเท่าไร หลังจาก traceback ยาว ๆ ที่ Python ย่อให้เหลือ "Previous line repeated … more times"
- **งานซ้ำ** branching recursion บน subproblem ที่ซ้อนทับกันใช้เวลาแบบ exponential ตัว memoization แก้เรื่องเวลาได้ แต่ไม่ได้แก้เรื่องความลึก: `fib_memo(5000)` ที่ cache ยังว่างก็ยังโยน `RecursionError` ที่ limit ค่า default ตารางใหญ่ ๆ เลยควรคำนวณแบบ bottom-up
- **tail call พกไปใช้ข้ามภาษาไม่ได้** โค้ดที่พึ่ง tail-call elimination รันได้ใน Scheme และใน Safari แต่ล้น stack แทบทุกที่อื่น

## ข้อควรรู้ตอนลงมือทำ

- **Python:** `sys.getrecursionlimit()` กับ `sys.setrecursionlimit()` ใช้อ่านและตั้ง limit ส่วน `RecursionError` (subclass ของ `RuntimeError` ที่เพิ่มมาใน 3.5) คือ exception ที่ต้อง catch ส่วน `threading.stack_size()` ตั้งขนาด native stack ของ thread ที่เริ่มหลังจากเรียกมัน ตัว `functools.cache` กับ `functools.lru_cache` ใช้ทำ memoization และ `math.factorial` คือ factorial ที่ควรใช้ในโค้ดจริง
- **parser กับ serializer จำกัดการซ้อน** module `json` ของ Python โยน `RecursionError` เมื่อ input ซ้อนลึกเกินกว่าที่ stack รับไหว (ลอง `json.loads("[" * 100_000 + "]" * 100_000)` ดู) ส่วน `System.Text.Json` ของ .NET หยุดที่ความลึก 64 ถ้าเราไม่ยก `JsonSerializerOptions.MaxDepth` ขึ้น ([เอกสาร](https://learn.microsoft.com/en-us/dotnet/api/system.text.json.jsonserializeroptions.maxdepth))
- **API:** GraphQL query คือ tree ที่ server resolve ทีละ field [คำแนะนำด้าน security ของ GraphQL](https://graphql.org/learn/security/) เลยแนะนำให้จำกัดว่า operation หนึ่งซ้อนได้ลึกแค่ไหน ใน federated graph ตัว router คือที่ที่ควรบังคับเรื่องนี้ ([GraphQL Federation](../graphql-federation/))
- **Database:** `WITH RECURSIVE` ของ SQL ใช้เดินบนลำดับชั้นอย่างผังองค์กร, bill of materials และ edge ของ graph ถึงชื่อจะเป็นแบบนั้น PostgreSQL ก็ประเมินมันแบบ iterative โดยรันส่วน recursive ซ้ำบน working table จนไม่ได้ row ใหม่ ([เอกสารของ PostgreSQL](https://www.postgresql.org/docs/current/queries-with.html))
- **วัดความลึก ไม่ใช่ขนาด input** stack โตตามสายที่ยาวที่สุดของ call ที่ยังค้างอยู่ tree ที่มีล้าน node เลยไม่มีปัญหาถ้ามัน balanced แต่จะพังถ้ามันเสื่อมจนกลายเป็น list
