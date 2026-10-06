## ปัญหา

คำถามเกี่ยวกับระบบซอฟต์แวร์หลายข้อจริง ๆ แล้วเป็นคำถามเรื่องกราฟที่แฝงตัวมา subnet นี้ไปถึง database ตัวนั้นผ่าน routing rule ได้ไหม การอ้างอิงกันระหว่าง cell ใน spreadsheet, Spring bean, Go package หรือ Terraform resource พวกนี้วนกลับมาหาตัวเองหรือเปล่า build step พวกนี้ต้องรันตามลำดับไหน แต่ละข้อต้องการการเดินที่ไปถึงทุกอย่างที่ไปถึงได้จากจุดเริ่มต้นครั้งเดียวพอดี ไม่เดินวนเป็นวงกลม และไม่ลืมกิ่งที่ยังไม่ได้ลอง

Depth-first search (DFS) ทำแบบนั้นได้ด้วยการจดบันทึกนิดเดียว: set ของ node ที่ visit แล้วกับ stack หนึ่งอัน มันเดินตาม path เดียวไปให้ไกลที่สุดเท่าที่ไปได้ และจะถอยกลับไปที่ node ล่าสุดที่ยังมีทางเลือกเหลือ ก็ต่อเมื่อ node หนึ่งไม่มีเพื่อนบ้านที่ยังไม่ได้ visit เหลืออยู่แล้วเท่านั้น ตัว stack จะเป็น call stack ของ function แบบ recursive หรือ list ที่เราจัดการเองก็ได้ มันจำไว้ว่าแต่ละ node ค้างไว้ตรงไหน

## ทำงานยังไง

**เวอร์ชัน recursive** มีกฎข้อเดียว: จดว่า node นี้ visit แล้ว แล้วไล่ดูเพื่อนบ้านของมันตามลำดับ เพื่อนบ้านตัวไหนที่ยังไม่ได้ visit ก็ค้นหาจากตัวนั้นให้จบก่อน แล้วค่อยดูเพื่อนบ้านตัวถัดไป ลำดับของ list เพื่อนบ้านเป็นตัวกำหนดว่า path ไหนถูกลองก่อน animation เลือกเพื่อนบ้านตามลำดับตัวอักษร จาก A เลยไปที่ B ไม่ใช่ C แล้วต่อไปที่ D และ G ส่วน frame ของแต่ละ call จำตำแหน่งของตัวเองใน list เพื่อนบ้านไว้ (คือ caret ใน animation) และตำแหน่งนั้นก็คือ "จุดที่จะกลับมาทำต่อ": พอ `dfs(D)` return ตัว `dfs(B)` ก็ทำต่อที่ E

**Discovery และ finish** สำหรับทุก node มีสองจังหวะที่สำคัญ: ตอนที่ DFS ไปถึงมันครั้งแรก (*discovery* หรือตำแหน่งแบบ preorder) และตอนที่ frame ของมัน pop ออกเพราะจัดการเพื่อนบ้านครบทุกตัวแล้ว (*finish* หรือตำแหน่งแบบ postorder) บนกราฟในไดอะแกรม ลำดับ discovery คือ A B D G E F C H และลำดับ finish คือ G D C H F E B A สองลำดับนี้ซ้อนกันแบบวงเล็บ: ทุก node ที่ถูก discover หลัง B และก่อน B จะ finish (D, G, E, F, C และ H) เป็นลูกหลานของ B ใน DFS tree อัลกอริทึมหลายตัวที่สร้างบน DFS ทำงานจากสองลำดับนี้ เช่น ลำดับ finish แบบกลับด้านคือ topological order ของ directed acyclic graph

**ชนิดของ edge** edge ที่ DFS เดินตามไปถึง node ใหม่ประกอบกันเป็น *DFS tree*: คือ edge เส้นทึบใน animation เป็นสีน้ำเงินตอนที่ frame ของลูกยังอยู่บน stack และเป็นสีเขียวเมื่อมัน finish แล้ว ในกราฟแบบไม่มีทิศทาง edge อื่นทุกเส้นเชื่อม node เข้ากับบรรพบุรุษตัวหนึ่งของมันใน tree นั้น แบบนี้มันเลยเป็น *back edge* และแต่ละเส้นปิด cycle หนึ่งวง: A–C ปิด A–B–E–F–C และ E–H ปิด E–F–H กราฟที่เชื่อมกันและมี 8 node ต้องมี tree edge 7 เส้น edge ทั้ง 9 เส้นของมันเลยเหลือ 2 เส้นพอดีที่ปิด cycle ส่วนกราฟแบบมีทิศทางมี edge สี่ชนิด (edge lemma ที่ Sedgewick กับ Wayne ให้เครดิตกับ Tarjan, section 4.2):

- edge แบบ *tree* ไปยัง node ที่ DFS ไปถึงเป็นครั้งแรก
- edge แบบ *back* ไปยังบรรพบุรุษที่ยังอยู่บน stack
- edge แบบ *forward* ไปยังลูกหลานที่ finish ไปแล้ว
- edge แบบ *cross* ไปยัง node ที่ finish แล้วในกิ่งอื่น

**การหา cycle** ได้มาจากชนิดของ edge

- *กราฟแบบไม่มีทิศทาง:* เพื่อนบ้านที่ visit แล้วตัวไหนก็ตาม ที่ไม่ใช่ node ที่เราเพิ่งเดินมา จะปิด cycle ถ้า node สองตัวเชื่อมกันได้ด้วย edge มากกว่าหนึ่งเส้น ให้เทียบตัว edge เองแทนที่จะเทียบ parent node ไม่อย่างนั้นจะมองไม่เห็น link คู่
- *กราฟแบบมีทิศทาง:* แค่ "visit แล้ว" ไม่พอ ใน run 1 ของตัวอย่าง spreadsheet ตัว A1 ไปถึง C1 สองครั้ง ครั้งหนึ่งผ่าน B1 และอีกครั้งตรง ๆ แบบนี้เป็นรูปข้าวหลามตัด ไม่ใช่ cycle ตัว DFS เก็บสถานะสามแบบ ที่ตำราเรียกว่าขาว (ยังไม่ไปถึง) เทา (อยู่บน stack) และดำ (finish แล้ว) และเฉพาะ edge ที่เข้าไปหา node **สีเทา** หรือ back edge เท่านั้นที่แปลว่ามี cycle ส่วน edge ที่เข้าไปหา node สีดำเป็น forward edge หรือ cross edge และไม่มีพิษภัย พอเจอ back edge ตัว stack ก็เก็บ cycle ไว้อยู่แล้ว: ใน run 2 ตัว cell สีเทา A1, B1 และ C1 บวกกับ edge ที่ย้อนกลับไป A1 คือ circular reference

**Explicit stack** ช่วยเอา recursion ออกไป การแปลงที่ตรงกับต้นฉบับจะเก็บหนึ่ง entry ต่อหนึ่ง frame: คือ node กับ iterator ที่ไล่ไปตามเพื่อนบ้านของมัน แต่ละ entry เลยทำต่อจากจุดที่หยุดไว้ได้ `dfs_iterative` ข้างล่างทำแบบนี้และได้ลำดับเดียวกับเวอร์ชัน recursive ทุกประการ ส่วนเวอร์ชันที่สั้นกว่าก็เจอบ่อย: pop node ออกมา ถ้า visit ไปแล้วก็ข้าม ไม่อย่างนั้นก็จดไว้แล้ว push เพื่อนบ้านทุกตัวทีเดียว เพื่อนบ้านตัวสุดท้ายที่ push จะถูก pop ก่อน บนกราฟนี้มันเลย visit ตามลำดับ A C F H E B D G คือเลือกเพื่อนบ้านกลับด้าน ถ้า push ตามลำดับกลับด้านก็จะได้ A B D G E F C H คืนมา แบบนี้ยังเป็น depth-first search อยู่ แต่ node หนึ่งอาจอยู่บน stack ได้หนึ่งครั้งต่อทุก edge ที่เข้ามาหามัน stack เลยโตได้ถึง O(E) และไม่มีจังหวะที่ node finish ทำให้เสียลำดับ finish ไป ส่วนการจด node ตอนที่ *push* แบบที่ BFS ทำกับ queue ของมัน เป็นอีกเรื่องหนึ่งไปเลย บนกราฟนี้มันจะจด B เป็นลูกของ A ทำให้ edge B–E และ E–H เชื่อม node ที่ไม่มีตัวไหนเป็นบรรพบุรุษของอีกตัว และการเดินแบบ depth-first บนกราฟแบบไม่มีทิศทางไม่มีทางให้ผลแบบนั้น

**ต้นทุน** ทุก node ที่ไปถึงได้ถูกเข้าครั้งเดียว และ adjacency list แต่ละอันถูกสแกนครั้งเดียว งานเลยเป็นสัดส่วนกับ V + E ตรงนี้คือ 8 call และตรวจเพื่อนบ้าน 18 ครั้ง เพราะ edge แบบไม่มีทิศทางทั้ง 9 เส้นถูกเห็นจากปลายทั้งสองข้าง memory คือ visited set บวกกับ stack และแต่ละตัวเก็บไม่เกิน V entry

## โค้ด

```python
def dfs(graph, start):
    """Recursive DFS from start: (discovery order, finish order)."""
    discovered, finished, seen = [], [], set()

    def visit(v):
        seen.add(v)
        discovered.append(v)
        for w in graph[v]:
            if w not in seen:
                visit(w)
        finished.append(v)                 # every neighbour of v is done

    visit(start)
    return discovered, finished


def dfs_iterative(graph, start):
    """The same walk on an explicit stack of (node, neighbour iterator) frames."""
    discovered, finished, seen = [start], [], {start}
    stack = [(start, iter(graph[start]))]
    while stack:
        v, neighbours = stack[-1]
        for w in neighbours:               # resumes where this frame left off
            if w not in seen:
                seen.add(w)
                discovered.append(w)
                stack.append((w, iter(graph[w])))
                break                      # go deep first
        else:                              # nothing new left: v is finished
            stack.pop()
            finished.append(v)
    return discovered, finished


WHITE, GREY, BLACK = 0, 1, 2               # new, on the stack, finished

def find_cycle(graph):
    """Directed graph: return one cycle as a list of nodes, or None."""
    colour = dict.fromkeys(graph, WHITE)
    for root in graph:
        if colour[root] != WHITE:
            continue
        colour[root] = GREY
        stack = [(root, iter(graph[root]))]
        while stack:
            v, targets = stack[-1]
            for w in targets:
                if colour[w] == GREY:      # back edge: w is still on the stack
                    path = [u for u, _ in stack]
                    return path[path.index(w):] + [w]
                if colour[w] == WHITE:
                    colour[w] = GREY
                    stack.append((w, iter(graph[w])))
                    break
            else:
                colour[v] = BLACK          # finished: meeting it again is fine
                stack.pop()
    return None


graph = {"A": ["B", "C"], "B": ["A", "D", "E"], "C": ["A", "F"], "D": ["B", "G"],
         "E": ["B", "F", "H"], "F": ["C", "E", "H"], "G": ["D"], "H": ["E", "F"]}
print(dfs(graph, "A"))       # (['A', 'B', 'D', 'G', 'E', 'F', 'C', 'H'], ['G', 'D', 'C', 'H', 'F', 'E', 'B', 'A'])

sheet = {"A1": ["B1", "C1"], "B1": ["C1"], "C1": []}     # A1 = B1 + C1, B1 = C1 * 2, C1 = 7
print(find_cycle(sheet))     # None
sheet["C1"] = ["A1"]                                     # C1 = A1 - 3
print(find_cycle(sheet))     # ['A1', 'B1', 'C1', 'A1']
```

ทุก node ต้องเป็น key ด้วย โดยใช้ list ว่างถ้ามันไม่มี edge ส่วน `dfs` กับ `dfs_iterative` คืนสองลำดับเดียวกันบนกราฟไหนก็ได้ แล้ว test ที่อยู่เบื้องหลังหน้านี้ก็เทียบทั้งสองตัวบนกราฟสุ่มหลายร้อยอัน และตรวจ `find_cycle` กับการอ้างอิงตัวเอง รูปข้าวหลามตัด cycle ที่ไปถึงได้จาก root ตัวหลัง ๆ เท่านั้น และกราฟสุ่มทั้งแบบมีและไม่มี cycle บน path ที่มี 10,000 node ตัว `dfs_iterative` กับ `find_cycle` จบได้ตามปกติ ส่วน `dfs` จะ raise `RecursionError` เพราะ recursion limit ตั้งต้นของ CPython คือ 1000 frame (ดู [Recursion & the Call Stack](../recursion/))

standard library ก็มีตัวตรวจ cycle ของมันเอง `graphlib.TopologicalSorter` รับ predecessor ของแต่ละ node ถ้าเป็น spreadsheet ก็คือ cell ที่มันอ่านค่า:

```python
from graphlib import TopologicalSorter, CycleError

print(list(TopologicalSorter({"A1": ["B1", "C1"], "B1": ["C1"], "C1": []}).static_order()))
# ['C1', 'B1', 'A1']: the finish order of run 1, an order to calculate in
try:
    TopologicalSorter({"A1": ["B1", "C1"], "B1": ["C1"], "C1": ["A1"]}).prepare()
except CycleError as e:
    print(e.args)            # ('nodes are in a cycle', ['A1', 'C1', 'A1'])
```

มันรายงาน cycle อีกวง: A1 กับ C1 อ่านค่ากันและกันตรง ๆ เป็นวงที่สั้นกว่าวงที่ `find_cycle` เจอก่อน ที่เป็นแบบนี้เพราะ graphlib เดินจากแต่ละ cell ไปยัง cell ที่อ่านมัน ส่วน `find_cycle` ตามการอ้างอิงของแต่ละสูตรไปตามลำดับ cycle ไหนที่การค้นหารายงานขึ้นกับวิธีเดิน แต่มี cycle หรือไม่ไม่ได้ขึ้นกับวิธีเดิน

## Complexity

V กับ E นับ node และ edge ของส่วนของกราฟที่การค้นหาไปถึง ส่วน edge แบบไม่มีทิศทางถูกตรวจจากปลายทั้งสองข้าง

| | Best | Average | Worst | พื้นที่เพิ่ม | ทำไม |
|---|---|---|---|---|---|
| `dfs`, `dfs_iterative` | Θ(V + E) | Θ(V + E) | Θ(V + E) | O(V) | ทุก node ที่ไปถึงได้ถูกเข้าครั้งเดียว และ list เพื่อนบ้านของมันถูกสแกนครั้งเดียว ไม่ว่ากราฟจะหน้าตาแบบไหน visited set เก็บทุก node และ stack เก็บ path ปัจจุบัน ได้ถึง V frame ถ้ากราฟเป็นสายยาวเส้นเดียว |
| `find_cycle` | Θ(V) | O(V + E) | Θ(V + E) | O(V) | การสร้างตารางสีใช้ V ส่วน cycle ที่ผ่าน node แรกอาจเจอได้แทบจะทันที ส่วนกราฟที่ไม่มี cycle จะถูกเดินจนครบก่อนจะได้คำตอบว่าไม่มี |
| stack แบบ push เพื่อนบ้านทุกตัว | Θ(V + E) | Θ(V + E) | Θ(V + E) | O(E) | visit เหมือนกัน แต่ทุก edge จะ push node ที่ปลายอีกข้างของมัน เลยมี entry รออยู่บน stack ได้ถึง O(E) ตัว |

ถ้าใช้ adjacency matrix แทน list การหาเพื่อนบ้านของ node หนึ่งต้องสแกนแถวที่มี V ช่อง DFS เลยใช้ Θ(V²) เรื่อง stable และ in place ไม่เกี่ยวกับการ traverse ส่วน [Big-O Notation](../big-o-notation/) อธิบายสัญลักษณ์เหล่านี้

## ใช้ตอนไหนดี

- **ไปถึงได้ไหม?** การไปถึงได้จาก node เดียวหรือจากหลาย node: root ของ garbage collector หรือ entry point ของโปรแกรม traversal แบบไหนก็ใช้ได้ แต่ DFS เขียนสั้นที่สุด
- **Connected component** เริ่ม DFS ใหม่จากทุก node ที่ยังไม่ได้ visit แต่ละจุดเริ่มจะกวาด component ไปหนึ่งอัน
- **Cycle และลำดับใน dependency graph:** build system, package manager, scheduler, spreadsheet และ dependency-injection container ลำดับ finish แบบกลับด้านให้ topological order และ back edge ก็พิสูจน์ว่าไม่มี order แบบนั้น [Topological Sort](../topological-sort/) แสดงทางเลือกที่ใช้ queue และนับ dependency แทน
- **โครงสร้างของเครือข่าย** Strongly connected component (Tarjan, 1972; อัลกอริทึมสองรอบของ Kosaraju ที่ Sharir ตีพิมพ์ในปี 1981), articulation point และ biconnected component (Hopcroft กับ Tarjan, 1973) และ bridge (Tarjan, 1974) ได้มาจาก DFS รอบเดียวหรือสองรอบทั้งหมด และ articulation point กับ bridge ก็คือ single point of failure ในเครือข่าย
- **เขาวงกต grid และ puzzle** วิธีเดินเขาวงกตของ Trémaux ที่ Édouard Lucas อธิบายไว้ในปี 1882 คือ DFS ที่ทำด้วยมือ โดยทำเครื่องหมายแต่ละทางเดินตอนที่เดินผ่าน ส่วน DFS ที่สุ่มเลือกเพื่อนบ้านจะขุดเขาวงกตที่มีทางเดียวพอดีระหว่างสองช่องใด ๆ เพราะทางเดินที่มันเปิดประกอบกันเป็น tree ส่วน flood fill ในโปรแกรมวาดรูปคือ DFS (หรือ BFS) ไปตาม pixel ข้าง ๆ ที่สีเดียวกัน และการค้นหาแบบ backtracking (permutation, sudoku, N-queens) ก็คือ DFS บนคำตอบที่ยังไม่ครบ
- **ไม่เหมาะกับ shortest path** ตรงนี้ DFS ไปถึง C ด้วยสี่ edge ส่วน [Breadth-First Search](../breadth-first-search/) หา path ที่ใช้ edge เดียวเจอ และ [Dijkstra's Shortest Path](../dijkstra/) รับมือกับ edge ที่มี weight
- **ไม่เหมาะกับการหาของที่อยู่ใกล้ ๆ ในกราฟขนาดมหึมา** DFS อาจหายลงไปในกิ่งลึกกิ่งเดียว ทั้งที่คำตอบอยู่ห่างจากจุดเริ่มแค่สอง edge ให้ค้นหาแบบ breadth-first หรือใช้ iterative deepening (DFS แบบจำกัดความลึกที่ขยายขีดจำกัดขึ้นเรื่อย ๆ) ถ้า frontier ของ BFS ใส่ memory ไม่ได้

## ได้อะไร เสียอะไร

- **Memory ตามความลึก ไม่ใช่ความกว้าง** DFS เก็บ path ปัจจุบันบวกกับ visited set ส่วน BFS เก็บ frontier ทั้งหมด บนกราฟที่กว้างและตื้น DFS ใช้ memory น้อยกว่ามาก แต่บนสายที่ยาว stack ของมันจะเก็บทั้งสาย
- **ความลึกของ recursion คือขีดจำกัดในทางปฏิบัติ** DFS แบบ recursive ต้องใช้หนึ่ง frame ต่อหนึ่งระดับของ path ที่กำลังเดิน CPython หยุดที่ 1000 โดย default และ native stack ของ thread จะล้นที่ความลึกที่ขึ้นกับขนาด stack ของมัน ให้ใช้ explicit stack ทุกครั้งที่ input เป็นตัวกำหนดความลึก: dependency chain, linked structure หรือ column ใน spreadsheet ที่เป็นยอดสะสม โดยแต่ละ cell อ่านค่าจาก cell ข้างบน
- **ผลลัพธ์ขึ้นกับลำดับของเพื่อนบ้าน** ทั้ง tree, หมายเลข discovery และ cycle ที่ถูกรายงานจะเปลี่ยนหมดถ้าเรียง list เพื่อนบ้านใหม่ ให้ sort ไว้ถ้าผลลัพธ์ต้องทำซ้ำได้เหมือนเดิม เช่นใน test และ error message
- **มันหา path เจอ แต่ไม่ใช่เส้นที่ดีที่สุด** ใช้ได้ดีกับ "มีทางไปไหม?" แต่ผิดสำหรับ "ทางที่สั้นที่สุดคือทางไหน?"
- **การค้นหาครั้งหนึ่งตอบคำถามได้ข้อเดียว** ถ้าถามเรื่องการไปถึงได้หลายข้อกับกราฟที่ไม่ค่อยเปลี่ยน ให้คำนวณ component หรือ strongly connected component ไว้ครั้งเดียวแล้วค่อยเปิดดูคำตอบ

## ข้อควรรู้ตอนลงมือทำ

- **Spreadsheet** Excel เตือนครั้งแรกที่เจอ circular reference แล้วใส่ที่อยู่ของ cell ตัวหนึ่งไว้ใน status bar แสดงรายการ cell ไว้ใต้ *Formulas › Error Checking › Circular References* และปล่อยให้สูตรแสดง 0 หรือค่าล่าสุดของมัน ส่วน model ที่ตั้งใจให้วนก็เปิด iterative calculation ได้ โดย default มันจะหยุดหลัง 100 iteration หรือเมื่อค่าเปลี่ยนน้อยกว่า 0.001
- **Dependency injection** Spring ลงทะเบียน singleton bean แต่ละตัวว่า "currently in creation" ก่อนจะสร้างมัน และ throw `BeanCurrentlyInCreationException` ถ้า bean ตัวหนึ่งขอ bean ที่ยังสร้างอยู่ set นั้นก็คือ set สีเทาของการค้นหาแบบสามสี ตั้งแต่ Spring Boot 2.6 เป็นต้นมา circular reference ระหว่าง bean ทำให้ application start ไม่ขึ้น การตั้ง `spring.main.allow-circular-references=true` จะคืนพฤติกรรมเดิม ที่ Spring พยายามตัด cycle เอง
- **ภาษาและ build tool** Go specification ห้าม package import ตัวเอง ไม่ว่าทางตรงหรือทางอ้อม และคำสั่ง go จะรายงาน `import cycle not allowed` พร้อมสาย import ที่ปิดวง `graphlib` ของ Python หา cycle ใน `prepare()` ด้วย DFS แบบ iterative บน stack ของ iterator ที่ไล่เพื่อนบ้าน เหมือน `dfs_iterative` ข้างบน ส่วน graph package ภายในของ Terraform หา dependency cycle ด้วยการคำนวณ strongly connected component ด้วยอัลกอริทึมของ Tarjan
- **Architecture test** `slices().matching("..myapp.(*)..").should().beFreeOfCycles()` ของ ArchUnit ทำให้ test fail และ build fail ตามไปด้วย เมื่อ package พึ่งพากันเป็นวง แบบนี้ช่วยกันไม่ให้ module ของ [modular monolith](../modular-monolith/) พันกันเป็นปม: module ที่ติดอยู่ใน cycle จะเข้าใจ จะ test และจะแยกออกมาได้ก็ต้องทำพร้อมกันทั้งชุดเท่านั้น
- **Garbage collector** mark phase ของ tracing collector คือการค้นหาการไปถึงได้จาก root: Sedgewick กับ Wayne อธิบาย mark-and-sweep ว่าเป็น DFS จาก root และ G1 collector ของ HotSpot เก็บ object ที่ยังต้องสแกนไว้ใน explicit work queue โดยมี mark stack ที่ใช้ร่วมกันไว้รับส่วนที่ล้น แทนที่จะใช้ recursion ตัว collector ก็ใช้คำศัพท์ขาว เทา ดำ ชุดเดียวกัน: tri-colour marking (Dijkstra, Lamport และคณะ, 1978) เรียก object ว่าสีเทาเมื่อไปถึงแล้วแต่ยังไม่ได้สแกน
- **Graph library** traversal ของ NetworkX (`dfs_edges`, `dfs_preorder_nodes`, `dfs_postorder_nodes`) เก็บ explicit stack ของคู่ (node, iterator ที่ไล่เพื่อนบ้าน) แนวคิดเดียวกับ `dfs_iterative` เลยรับมือกับกราฟที่ลึกกว่า recursion limit ของ Python มาก ๆ ได้
- **Tree** ตัว tree ไม่มี cycle เลยไม่ต้องจดอะไร: การเดินแบบ in-order ของ [binary search tree](../binary-search-tree/) คือ DFS และการเดินแบบ pre-order กับ post-order ของ syntax tree หรือ directory ก็เช่นกัน
