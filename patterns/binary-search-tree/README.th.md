## ปัญหา

หลายโปรแกรมเก็บ collection ไว้แบบเรียงลำดับในขณะที่มันเปลี่ยนไปเรื่อย ๆ: timer เรียงตาม deadline, order เรียงตามราคา, session เรียงตามเวลาหมดอายุ, row เรียงตาม key โปรแกรมพวกนี้ถามทั้งคำถามแบบตรงตัว ("มี 42 อยู่ไหม?") และคำถามแบบมีลำดับ: key ที่เล็กที่สุด, key ถัดไปหลัง 42, ทุก key ตั้งแต่ 35 ถึง 62

โครงสร้างง่าย ๆ แต่ละแบบพลาดไปอย่างใดอย่างหนึ่ง sorted array ตอบได้ทุกข้อด้วย [Binary Search](../binary-search/) ใน O(log n) แต่การ insert หรือ delete ทุกครั้งต้องเลื่อนของ O(n) ตัวเพื่อให้ array ยังเรียงอยู่ linked list ต่อ node เข้าไปได้ใน O(1) แต่การหาตำแหน่งใช้ O(n) ส่วน [Hash Table](../hash-table/) หา key แบบตรงตัวได้ใน O(1) โดยเฉลี่ย แต่มันไม่เก็บลำดับไว้ "ถัดไป" กับ "ระหว่าง" เลยต้องดูทุก key

binary search tree เก็บ key ไว้ใน node ที่ link กัน โดยจัดให้การเทียบแต่ละครั้งยังตัดส่วนหนึ่งของ collection ทิ้งไปได้ทั้งก้อน เหมือนที่ binary search ทำบน array ขณะที่การ insert แค่ต้อง link node ใหม่เข้าไปหนึ่งตัว

## ทำงานยังไง

แต่ละ node ถือ key หนึ่งตัวกับ link สองเส้น คือซ้ายและขวา child ที่ไม่มีก็คือ link ที่ว่าง tree รักษากฎหนึ่งข้อไว้ที่ทุก node เรียกว่า **BST property**: ทุก key ใน left subtree ของ node เล็กกว่า key ของ node นั้น และทุก key ใน right subtree ใหญ่กว่า

### Search และ insert

- **Search** เริ่มที่ root ถ้า key เท่ากับ key ของ node ก็เจอแล้ว ถ้าเล็กกว่า ก็ค้นต่อใน left subtree ถ้าใหญ่กว่า ก็ค้นต่อใน right subtree การเทียบแต่ละครั้งทิ้ง subtree อีกข้างไป การ search เลยเทียบไม่เกินหนึ่งครั้งต่อระดับ ถ้าไปถึง link ที่ว่าง ก็แปลว่า key ไม่อยู่ใน tree
- **Insert** ทำการ search แบบเดียวกัน พอการ search หลุดออกจาก tree ตัว link ว่างที่มันหยุดอยู่คือที่เดียวที่ใส่ key ได้โดยไม่ทำให้ property เสีย node ใหม่เลยถูกเกาะไว้ตรงนั้น และไม่มีอะไรอื่นต้องขยับ ในขั้นที่ 2 ตัว 65 ใหญ่กว่า 50 เล็กกว่า 70 และใหญ่กว่า 60 มันเลยกลายเป็น right child ของ 60
- **ค่าซ้ำ** ต้องมีนโยบาย: set จะไม่สนใจมัน (โค้ดด้านล่าง return `False`) map จะแทนที่ value (`TreeMap.put` ของ Java ทำแบบนี้) ส่วน tree ที่ต้องเก็บสำเนาไว้จะส่ง key ที่เท่ากันไปข้างเดียวกันทุกครั้ง หรือเก็บตัวนับไว้ใน node

### Min, max และ key ถัดไป

key ที่เล็กที่สุดอยู่ปลายทางของ link ซ้ายที่ไล่ลงมาจาก root และ key ที่ใหญ่ที่สุดอยู่ปลายทางของ link ขวา **successor** ของ key หนึ่ง คือ key ที่เล็กที่สุดที่ใหญ่กว่ามัน จะเป็นค่าต่ำสุดของ right subtree ของ node นั้นถ้ามี ไม่อย่างนั้นก็คือ ancestor ตัวที่ต่ำที่สุดที่มี key นั้นอยู่ใน left subtree การ search จาก root หามันเจอได้ด้วยการจำ node สุดท้ายที่เลี้ยวซ้าย *Floor* กับ *ceiling* (key ที่ใกล้ที่สุดที่ไม่เกิน หรือไม่น้อยกว่า ค่าที่กำหนด) ทำงานแบบเดียวกัน **range query** เดินบน tree ตามลำดับ แต่ข้ามทุก subtree ที่อยู่นอกช่วงทั้งก้อน มันเลยเสีย O(h + k) สำหรับผลลัพธ์ k ตัวใน tree ที่สูง h

### การลบ: สามกรณี

1. **Leaf:** ตัด link ทิ้ง
2. **มี child ตัวเดียว:** link parent ไปหา child ตัวนั้นตรง ๆ subtree ของ child ขยับขึ้นมาหนึ่งระดับ และ key ของมันก็ยังอยู่ถูกฝั่งของ ancestor ทุกตัว
3. **มี child สองตัว:** ก็อป key ของ **in-order successor** ของ node นั้น คือค่าต่ำสุดของ right subtree ของมัน มาใส่แทน แล้วไปลบ node ของ successor แทน ตัว node นั้นไม่มี left child การลบมันเลยเป็นกรณีที่ 1 หรือ 2 ถ้าใช้ predecessor คือค่าสูงสุดของ left subtree ก็ได้ผลดีเท่ากัน

Sedgewick กับ Wayne ให้เครดิตวิธีนี้กับ T. Hibbard (1962) และชี้ว่าการใช้ successor ตลอดทำให้เอียงข้าง: หลังจาก insert และ delete แบบสุ่มไปนาน ๆ tree จะเอียงไปทางซ้าย

### Traversal และทำไม in-order ถึงเรียง

วิธีมาตรฐานในการไปเยี่ยมทุก node มีสี่แบบ แต่ละแบบใช้ O(n):

| Traversal | ลำดับ | ใช้ทำอะไร |
|---|---|---|
| Pre-order | node, left subtree, right subtree | ก็อปหรือ serialize tree: insert key ตามลำดับ pre-order ลงใน BST ว่างจะได้รูปร่างเดิมกลับมา |
| In-order | left subtree, node, right subtree | output ที่เรียงแล้ว เหมือนในขั้นที่ 3 |
| Post-order | left subtree, right subtree, node | คืน memory ของ tree (child ก่อน parent) ประเมิน expression tree (operand ก่อน operator) คำนวณขนาดและความสูงของ subtree |
| Level-order | ทีละระดับ จากซ้ายไปขวา โดยใช้ queue | พิมพ์หรือ serialize ทีละระดับ หา node ที่ตรงเงื่อนไขและอยู่ตื้นที่สุด |

output แบบ in-order เรียงก็เพราะ property นี้: ที่ node ไหนก็ตาม การเดินจะปล่อย left subtree ทั้งก้อนออกมาก่อน โดย key ในนั้นเล็กกว่าทั้งหมด และออกมาเรียงกัน (ใช้เหตุผลเดียวกันกับ tree ที่เล็กกว่า) แล้วตามด้วย key ของ node เอง แล้วก็ right subtree ที่ key ใหญ่กว่าทั้งหมด สำหรับ tree ในขั้นที่ 3 ตัว pre-order ได้ 50 30 20 40 70 60 65 80 สามแบบแรกเป็น traversal แบบ depth-first ส่วน level-order เป็น breadth-first และ [Depth-First Search](../depth-first-search/) กับ [Breadth-First Search](../breadth-first-search/) ก็อธิบายทั้งสองแบบไว้บน graph

### ความสูงและความสมดุล

ทุก operation ข้างบนเดินตามเส้นทางเดียวจาก root มันเลยเสีย O(h) โดย h คือความสูง ส่วน tree ที่มี n key มีอย่างน้อย ⌊log₂ n⌋ + 1 ระดับ และมากสุด n ระดับ จะได้แบบไหนขึ้นกับลำดับของการ insert อย่างเดียว

- **ลำดับสุ่มไม่มีปัญหา** ถ้าทุกลำดับมีโอกาสเท่ากัน search ที่เจอจะเทียบเฉลี่ยราว 2 ln n ≈ 1.39 log₂ n ครั้ง (Sedgewick กับ Wayne) และ Luc Devroye พิสูจน์ไว้ในปี 1986 ว่าความสูงโตประมาณ 4.311 ln n หรือราว 3 log₂ n: ยังเป็น O(log n) อยู่ ส่วน tree ที่สร้างด้วยโค้ดด้านล่างจาก key ที่สับลำดับแล้ว ลึก 18 ถึง 29 ระดับสำหรับ 1,000 key (เฉลี่ย 22 ขณะที่ tree สมบูรณ์แบบต้องใช้ 10) และ 27 ถึง 38 ระดับสำหรับ 10,000 key (เฉลี่ย 31.5 เทียบกับ 14)
- **ลำดับที่เรียงแล้วคือ worst case และเจอบ่อยด้วย** timestamp, ID แบบ auto-increment และไฟล์ที่เรียงตามตัวอักษรอยู่แล้ว ล้วนมาแบบเรียงแล้ว key ใหม่แต่ละตัวใหญ่กว่าทุกตัวที่มาก่อน มันเลยไปทางขวาทุกครั้ง และ tree ก็กลายเป็น chain ลึก n ระดับ คือ linked list ที่มี pointer เกินมา (ขั้นที่ 4) input ที่เรียงกลับด้านก็สร้าง chain แบบเดียวกันไปทางซ้าย

### Rotation และ balanced tree

**rotation** ยก child ขึ้นไปอยู่เหนือ parent: parent กลายเป็น child ของ child ตัวนั้น และ subtree ด้านในของ child ที่มี key อยู่ระหว่างสองตัวนั้น ก็ย้ายข้ามไปอยู่กับ parent มี link เปลี่ยนสามเส้นใน O(1) และลำดับ in-order ของ key ยังเหมือนเดิม BST property เลยยังอยู่ variant แบบ balanced เก็บข้อมูลเพิ่มนิดหน่อยไว้ในแต่ละ node แล้ว rotate หลัง insert และ delete เพื่อให้ h ยังเป็น O(log n) ไม่ว่า input จะเป็นแบบไหน:

- **AVL tree** (Adelson-Velsky กับ Landis, 1962) รักษาความสูงของ subtree สองข้างของทุก node ให้ต่างกันไม่เกินหนึ่ง
- **Red-black tree** (Guibas กับ Sedgewick, 1978) ระบายสี node แต่ละตัวเป็นแดงหรือดำ ไม่เคยวาง node แดงไว้ใต้ parent ที่แดง และให้ทุกเส้นทางจาก node หนึ่งลงไปถึง link ว่างมี node ดำจำนวนเท่ากัน ทำให้ความสูงไม่เกินราว 2 log₂ n เอกสารของ Linux kernel เทียบมันกับ AVL tree ไว้: insert ต้อง rotate ไม่เกินสองครั้ง และ delete ไม่เกินสามครั้ง แลกกับ lookup ที่ช้าลงเล็กน้อย
- **Treap** (Aragon กับ Seidel, 1989) ให้ priority แบบสุ่มกับแต่ละ node แล้วรักษาให้ tree เป็น heap ตาม priority และเป็น BST ตาม key ไปพร้อมกัน tree เลยมีรูปร่างแบบที่ลำดับการ insert แบบสุ่มจะสร้างขึ้นมา ไม่ว่าลำดับจริงจะเป็นยังไง operation เลยใช้เวลา O(log n) แบบ expected
- **Splay tree** (Sleator กับ Tarjan, 1985) ไม่เก็บข้อมูลความสมดุลเลย การเข้าถึงทุกครั้งจะ rotate node ที่ไปถึงขึ้นไปเป็น root ทำให้ต้นทุนของลำดับ operation ใด ๆ ถูกจำกัดไว้ที่ O(log n) amortized ต่อ operation และเก็บ key ที่เพิ่งใช้ไว้ใกล้ด้านบน

### B-tree: node กว้าง ๆ สำหรับ disk และ cache

node แบบ binary ถือ key แค่ตัวเดียว lookup ใน key หนึ่งพันล้านตัวเลยต้องเดินตาม link ราว 30 เส้น และ link แต่ละเส้นอาจเป็นการอ่าน disk หรือ cache miss หนึ่งครั้ง **B-tree** (Bayer กับ McCreight, 1972) เก็บ key ที่เรียงแล้วหลายตัวไว้ในแต่ละ node โดยมี child link อยู่ทั้งสองข้างของทุก key ทำให้ node แต่ละตัวที่ไปเยี่ยมแคบการค้นหาลงได้เป็นร้อยทาง แทนที่จะเป็นสองทาง node มีขนาดพอดีกับ disk page หนึ่ง page และ tree โตด้วยการแยก node ที่เต็ม: การแยกเลื่อนขึ้นไปข้างบน การแยก root จะเพิ่มระดับหนึ่งระดับ และ leaf ทุกตัวก็อยู่ที่ความลึกเดียวกันเสมอ ไม่ว่าลำดับของการ insert จะเป็นยังไง index ของ database ส่วนใหญ่เป็น **B+ tree**: inner node ถือแค่ separator key กับ child link, ทุก entry อยู่ใน leaf และ page ในแต่ละระดับ link กันไว้ ทำให้ range scan เดินไปตาม leaf ได้

ลองคิดเลขดู: ถ้า page หนึ่งถือได้ 300 entry สี่ระดับก็ไปถึง 300⁴ ≈ 8 พันล้าน entry ทำให้ lookup อ่านแค่สี่ page (และระดับบน ๆ มักอยู่ใน cache อยู่แล้ว) ขณะที่ balanced binary tree บน key ชุดเดียวกันลึก 33 ระดับ

## โค้ด

```python
class Node:
    def __init__(self, key):
        self.key, self.left, self.right = key, None, None


class BST:
    """A set of keys in binary-search-tree order. Inserting a key twice keeps one copy."""

    def __init__(self):
        self.root = None

    def insert(self, key):
        """Add key and return True, or return False if it is already there."""
        parent, node = None, self.root
        while node is not None:                  # walk down, as a search would
            if key == node.key:
                return False                     # a duplicate: keep the tree a set
            parent, node = node, (node.left if key < node.key else node.right)
        if parent is None:
            self.root = Node(key)
        elif key < parent.key:
            parent.left = Node(key)              # attach at the empty spot the walk reached
        else:
            parent.right = Node(key)
        return True

    def __contains__(self, key):
        node = self.root
        while node is not None and key != node.key:
            node = node.left if key < node.key else node.right
        return node is not None

    def __iter__(self):
        """Yield the keys in sorted order: left subtree, node, right subtree."""
        stack, node = [], self.root
        while stack or node is not None:
            while node is not None:              # go left as far as possible
                stack.append(node)
                node = node.left
            node = stack.pop()
            yield node.key                       # its left subtree is done
            node = node.right                    # now its right subtree


tree = BST()
for key in [50, 30, 70, 20, 40, 60, 80, 65]:
    tree.insert(key)
print(list(tree), 65 in tree, 35 in tree, tree.insert(40))
# [20, 30, 40, 50, 60, 65, 70, 80] True False False
```

search กับ insert เป็น loop และ in-order generator ก็ถือ stack ของตัวเองแทนการ recurse เลยไม่มี operation ไหนที่ความลึกถูกจำกัดโดย interpreter การทดสอบเทียบ `list(tree)` กับ `sorted(set(keys))` และตรวจความเป็นสมาชิกบน list สุ่ม 3,000 ชุด ที่มี key ไม่เกิน 59 ตัวที่สุ่มมาจาก 40 ค่า ทำให้ list ส่วนใหญ่มีค่าซ้ำ และยังครอบคลุม tree ว่าง, key ตัวเดียว และ key ที่เป็น string ด้วย การรัน key ที่เรียงแล้วและเรียงกลับด้าน 2,000 ตัวสร้าง chain ที่ลึก 2,000 ระดับพอดี โค้ดนี้เดินผ่านได้โดยไม่มีปัญหา ขณะที่ in-order generator แบบ recursive โยน `RecursionError` บน chain เดียวกัน

## Complexity

| | ต้นทุน | ทำไม |
|---|---|---|
| Best time | O(1) | key อยู่ที่ root หรือที่ว่างของมันอยู่ใต้ root พอดี |
| Average time | O(log n) | ถ้า insert key ในลำดับสุ่ม search ที่เจอจะเทียบราว 1.39 log₂ n ครั้ง และความสูงที่คาดหวังเป็น O(log n) insert กับ delete ก็เหมือนกัน เพราะเดินตามเส้นทางเดียว |
| Worst time | O(n) | input ที่เรียงแล้วสร้าง chain ลึก n ระดับ variant แบบ balanced รับประกัน O(log n) สำหรับ search, insert และ delete: red-black tree ลึกไม่เกินราว 2 log₂ n ระดับ |
| Traversal | O(n) | ไปเยี่ยมทุก node ครั้งเดียว range query เสีย O(h + k) สำหรับผลลัพธ์ k ตัว |
| พื้นที่เพิ่ม | O(n) | หนึ่ง node ต่อหนึ่ง key พร้อม link สองเส้น (tree ใน library มักเพิ่ม link ไปหา parent และสีหรือความสูง) search กับ insert ใช้เพิ่มอีกแค่ O(1) ส่วน stack ของ in-order generator ถือ node ไม่เกิน h ตัว |

เรื่อง stable กับ in place ใช้กับ search tree ไม่ได้ การ sort ด้วยการ insert ของทุกชิ้นลงใน BST แล้วอ่านกลับออกมาตามลำดับ (*tree sort*) ใช้ O(n log n) โดยเฉลี่ย และ O(n²) กับ input ที่เรียงแล้ว เว้นแต่ tree จะ balanced

## ใช้ตอนไหนดี

- set หรือ map ใน memory ที่เปลี่ยนบ่อยและต้องตอบคำถามแบบมีลำดับ: deadline ถัดไป, ราคาที่ดีที่สุด, key ที่ใกล้ที่สุดที่เท่ากับหรือต่ำกว่าค่าหนึ่ง, ทุก key ในช่วงหนึ่ง, การวนตามลำดับของ key
- หยิบ balanced tree ที่มากับภาษามาใช้ (`TreeMap`, `std::map`, `SortedDictionary`) ดีกว่าเขียน BST ธรรมดาเอง เพราะ BST ธรรมดาปลอดภัยก็ต่อเมื่อลำดับการ insert สุ่มเท่านั้น และ input จริงแทบไม่เคยสุ่ม
- ถ้าต้องการแค่ lookup แบบตรงตัว [Hash Table](../hash-table/) เร็วกว่าโดยเฉลี่ย ถ้าต้องการหยิบตัวที่เล็กที่สุดซ้ำแล้วซ้ำอีก [Binary Heap](../binary-heap/) ง่ายกว่าและกะทัดรัดกว่า สำหรับข้อมูลที่ไม่ค่อยเปลี่ยน sorted array ที่ค้นด้วย [Binary Search](../binary-search/) ใช้ memory น้อยกว่าและไล่ pointer น้อยกว่า บน disk ให้ใช้ B-tree

## ได้อะไร เสียอะไร

- **รูปร่างขึ้นกับลำดับการ insert** BST ธรรมดาเร็วกับ input สุ่ม กลายเป็น list กับ input ที่เรียงแล้ว และไม่เตือนอะไรเลย ใครคุมลำดับของ key ได้ ก็คุม worst case ได้
- **ความสมดุลต้องแลกกับการจดบันทึก** balanced tree เก็บสีหรือความสูงไว้ในทุก node และ rotate ตอน update และกฎการลบของมันก็ซับซ้อน นี่คือเหตุผลที่ tree ใน library เป็นตัวเลือกที่ปลอดภัยกว่า และเป็นเหตุผลที่โค้ดข้างบนหยุดอยู่แค่ insert กับ search
- **Pointer กิน memory และทำให้ cache miss** ทุก key ต้องมี node ของตัวเองที่มี pointer สองหรือสามตัว และแต่ละระดับของการ search ก็ตาม pointer ไปที่ memory ที่อาจไม่อยู่ใน cache ทาง standard library ของ Rust ก็อธิบายว่า `BTreeMap` ของมันเป็น B-tree ก็เพราะเหตุผลนี้: แต่ละ node ถือหลาย key ไว้ใน array ที่ต่อเนื่องกัน การ search เลยเทียบมากขึ้นนิดหน่อย แต่ allocate และ cache miss น้อยลงมาก
- **ความลึกของ recursion ตามความสูง** insert, search และ traversal แบบ recursive เขียนได้สั้นที่สุด แต่บน tree ที่เสื่อมแล้วมันจะ recurse ลึก n ชั้น บน CPython 3.11 ที่ limit ค่า default การ insert แบบ recursive ของ key 0, 1, 2 ไปเรื่อย ๆ โยน `RecursionError` ที่ key 997 (ดู [Recursion](../recursion/)) การใช้ loop สำหรับ search และ insert และใช้ explicit stack สำหรับ traversal เลี่ยง limit นี้ได้
- **ไม่มี lookup แบบ O(1)** ต่อให้ tree balanced สมบูรณ์แบบก็ยังเทียบราว log₂ n ครั้งต่อ lookup คือ 20 ครั้งสำหรับล้าน key และการเทียบ string หรือ key แบบ composite ก็ไม่ได้ฟรี
- **การเทียบคือสัญญา** tree ถือว่า key สองตัวที่เทียบแล้วเท่ากันคือ key เดียวกัน `TreeMap` ของ Java เขียนไว้ว่าลำดับที่ไม่สอดคล้องกับ `equals` ก็ยังได้ tree ที่ทำงานได้ แต่เป็น tree ที่ผิด general contract ของ `Map`
- **update พร้อมกันหลายทางทำยาก** การ rebalance แตะหลาย node ในทีเดียว ทำให้ล็อกแบบละเอียดทำได้ยาก `TreeMap` ของ Java ไม่ synchronized และ sorted map แบบ concurrent ของ Java คือ `ConcurrentSkipListMap` ก็เป็น skip list ไม่ใช่ tree

## ข้อควรรู้ตอนลงมือทำ

- **Library ของแต่ละภาษา:** `TreeMap` ของ Java เป็น red-black tree ที่รับประกัน O(log n) สำหรับ `containsKey`, `get`, `put` และ `remove` และมี `floorKey`, `ceilingKey`, `higherKey` กับ `subMap` สำหรับคำถามแบบมีลำดับ `std::map` ของ C++ มี search, insert และ remove แบบ logarithmic วนตามลำดับของ key และมักเป็น red-black tree ส่วน .NET เขียนไว้ว่า `SortedDictionary` เป็น binary search tree ที่ดึงข้อมูลได้ใน O(log n) และเทียบมันกับ `SortedList` ที่ใช้ memory น้อยกว่า แต่ insert ข้อมูลที่ไม่เรียงใน O(n) ([เอกสาร](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.sorteddictionary-2)) `BTreeMap` ของ Rust เป็น B-tree ส่วน Python ไม่มี search tree ใน standard library: [`bisect`](https://docs.python.org/3/library/bisect.html) รักษา list ให้เรียงอยู่ แต่ `insort` แต่ละครั้งเป็น O(n) เพราะการ insert ลง list และเอกสารแนะนำให้ไปใช้ package ภายนอกชื่อ Sorted Collections ถ้าใช้หนัก ๆ
- **Linux kernel** มี library ของ red-black tree คือ `lib/rbtree.c` ที่ปล่อยการ search ให้ผู้เรียกทำเอง: เราเขียนการเดินในขั้นที่ 1 กับ 2 เอง โดยเทียบ key ลงไปจนถึง link ที่ว่าง แล้วเรียก `rb_link_node()` เพื่อเกาะ node และเรียก `rb_insert_color()` เพื่อ rebalance ตัวที่ใช้มันก็มี epoll ที่เก็บ file descriptor ที่มัน monitor ไว้ใน tree แบบนี้ ([eventpoll.c](https://github.com/torvalds/linux/blob/master/fs/eventpoll.c)) และ fair scheduler ที่เก็บ task ที่พร้อมรันไว้ใน tree ที่เรียงตาม deadline ([fair.c](https://github.com/torvalds/linux/blob/master/kernel/sched/fair.c))
- **PostgreSQL** สร้าง B-tree เมื่อ `CREATE INDEX` ไม่ได้ระบุ method ตัว B-tree index รองรับ `=`, `<`, `<=`, `>`, `>=`, `BETWEEN`, `IN` และ `IS NULL` และคืน row ที่เรียงลำดับอยู่แล้วได้ ใน implementation ของมัน แต่ละระดับของ tree เป็น doubly linked list ของ page และปกติมากกว่า 99% ของ page เป็น leaf ที่ชี้ไปหา row ใน table
- **InnoDB ของ MySQL** เก็บตัว table เองเป็น B-tree เรียกว่า *clustered index* ที่ใช้ primary key เป็น key (หรือ index `UNIQUE` ตัวแรกที่ทุก column เป็น `NOT NULL` หรือไม่อย่างนั้นก็ใช้ row ID ที่ซ่อนไว้) โดยมี row อยู่ใน leaf page (ค่า default คือ 16 KB) ส่วน entry ของ secondary index แต่ละตัวพก primary key ไว้ด้วย ทำให้ lookup ผ่าน secondary index จบด้วยการ search รอบที่สองใน clustered index และ primary key ที่ยาวก็ทำให้ secondary index ทุกตัวใหญ่ขึ้น
- **input ที่เรียงแล้วไม่เป็นปัญหาสำหรับ B-tree** มันโตที่ root เลยต่อให้ key เรียงจากน้อยไปมาก leaf ทุกตัวก็ยังอยู่ที่ความลึกเดียวกัน และ InnoDB ยังเติม page ให้เต็มกว่าสำหรับการ insert แบบ sequential (ราว 15/16) เทียบกับแบบสุ่ม (ระหว่าง 1/2 ถึง 15/16) ต้นทุนไปตกที่อื่นแทน: ใน store ที่แบ่ง partition ตามช่วงของ key ตัว key ที่เพิ่มขึ้นเรื่อย ๆ จะส่งทุก insert ไปที่ช่วงสุดท้าย กลายเป็น hot spot ที่อธิบายไว้ใน [Sharding](../sharding/)
- **Ordered map ใช้ route request** router ที่แบ่ง key เป็นช่วงจะเก็บขอบเขตของช่วงไว้ใน ordered map แล้วหาเจ้าของ key ด้วย floor lookup คือขอบเขตที่ใหญ่ที่สุดที่เท่ากับหรือต่ำกว่า key (`TreeMap.floorEntry` ใน Java) ring ของ consistent hashing ก็ใส่ในโครงสร้างเดียวกันได้โดยใช้ ceiling lookup: ตำแหน่งแรกที่เท่ากับหรืออยู่หลัง hash ของ key
- **Hash table ยืมลำดับมาใช้** `HashMap` ของ Java เขียนไว้ว่า เมื่อมีหลาย key ที่ hash code เหมือนกันและ key เป็น `Comparable` มันอาจใช้ลำดับการเทียบของ key มาช่วยตัดสินตอนเสมอ
