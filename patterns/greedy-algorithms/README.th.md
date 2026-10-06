## ปัญหา

ปัญหา optimization หลายข้อคือการตัดสินใจต่อกันเป็นทอด ๆ: จะยื่นเหรียญไหนต่อ จะรับนัดประชุมไหน จะต่อ subtree คู่ไหนเข้าด้วยกัน การลองทุกชุดของการตัดสินใจจะได้คำตอบที่ดีที่สุด แต่จำนวนชุดโตแบบ exponential ตัว **greedy algorithm** เลือกทางที่ดูดีที่สุดตอนนี้ ยึดตามนั้น แล้วไปต่อ มันไม่เคยย้อนกลับ เลยมักจะสั้นและเร็ว บ่อยครั้งก็แค่ sort หนึ่งครั้งตามด้วยการเดินรอบเดียว

ความเสี่ยงซ่อนอยู่ในคำว่า "ดูดีที่สุดตอนนี้" กฎที่จ่าย 63 เซนต์ด้วยเหรียญน้อยที่สุด จะจ่าย 6 ได้แย่ถ้าเหรียญคือ 1, 3 และ 4 และทั้งสองกรณีอัลกอริทึมก็ไม่รู้ตัวอะไรเลย greedy algorithm ดีได้แค่เท่ากับเหตุผลที่บอกว่ากฎของมันจะไม่ต้อนตัวเองเข้ามุม งานส่วนใหญ่เลยอยู่ที่การรู้ว่าปัญหาไหนมีเหตุผลแบบนั้น

## ทำงานยังไง

greedy algorithm ทุกตัวรัน loop เดียวกัน:

1. **เลือก** ตามกฎที่ตายตัว: เหรียญใหญ่ที่สุดที่ยังใส่ได้ นัดที่จบก่อน หรือ symbol สองตัวที่ความถี่น้อยที่สุด
2. **ยึดตามนั้น:** ทางเลือกนั้นเข้าไปอยู่ในคำตอบและไม่ถูกเอาออกอีก
3. **ย่อ** ปัญหาให้เล็กลง: เงินที่ต้องจ่ายน้อยลง นัดที่ยังใส่ได้น้อยลง tree น้อยลงหนึ่งต้น

เพื่อให้หา "ทางเลือกที่ดีที่สุดตอนนี้" ได้ถูก ๆ อัลกอริทึมจะ sort input ครั้งเดียวตามกฎ (เหรียญตามมูลค่า นัดตามเวลาจบ) หรือเก็บตัวเลือกไว้ใน priority queue ถ้าทางเลือกที่ดีที่สุดเปลี่ยนไประหว่างทาง (tree ที่รวมกันของ Huffman, ระยะชั่วคราวของ Dijkstra, edge ที่ออกจาก tree ของ Prim) ตัว sort หรือ queue มักเป็นตัวกำหนดเวลาที่ใช้

### Greedy ได้คำตอบ optimal เมื่อไร

greedy algorithm คืนคำตอบที่ optimal เมื่อปัญหามีคุณสมบัติสองข้อ ตามคำที่ *Introduction to Algorithms* ของ Cormen, Leiserson, Rivest และ Stein ใช้:

- **Greedy-choice property:** มีคำตอบ optimal สักแบบที่เริ่มด้วยทางเลือกแบบ greedy การยึดตามมันเลยไม่ตัดคำตอบที่ดีที่สุดทิ้ง
- **Optimal substructure:** สิ่งที่เหลือหลังเลือกเป็นปัญหาแบบเดียวกันที่เล็กลง และทางเลือกแบบ greedy บวกคำตอบ optimal ของปัญหาที่เล็กลงนั้น ก็ optimal สำหรับทั้งหมด

[Dynamic Programming](../dynamic-programming/) ก็พึ่ง optimal substructure เหมือนกัน แต่มันไม่รู้ว่าทางเลือกแรกไหนปลอดภัย เลยแก้ subproblem ที่อยู่หลังทุกทางเลือกแล้วเก็บตัวที่ดีที่สุดไว้ มันจ่าย 6 ด้วย 3 + 3 ได้แบบนี้ ส่วน [Backtracking](../backtracking/) ก็ลองหลายทางเลือกเหมือนกัน และย้อนทางที่ไปไม่ถึงไหนกลับ Greedy เดินตามทางเลือกเดียว เลยเร็วกว่า และทางเลือกเดียวนั้นก็คือส่วนที่ต้องพิสูจน์

รูปแบบการพิสูจน์สองแบบครอบคลุม greedy algorithm ส่วนใหญ่:

- **Greedy stays ahead** เลือกตัววัดความคืบหน้า แล้วแสดงว่าหลังทุกก้าว คำตอบบางส่วนของ greedy ดีอย่างน้อยเท่ากับส่วนที่ตรงกันของคำตอบที่ใช้ได้แบบอื่นทุกแบบ ใน interval scheduling นัดที่ k ของ greedy จบไม่ช้ากว่านัดที่ k ของตารางแบบอื่นใด เลยแปลว่าเมื่อไรที่ตารางอื่นยังมีที่ว่างให้นัดหนึ่ง greedy ก็มีที่ให้นัดนั้นเหมือนกัน
- **Exchange argument** เอาคำตอบ optimal ที่ต่างจากของ greedy มา หาจุดแรกที่ต่างกัน แล้วสลับเอาทางเลือกของ greedy เข้าไปแทนโดยไม่ทำให้คำตอบแย่ลง ทำการสลับซ้ำไปเรื่อย ๆ คำตอบ optimal ก็จะกลายเป็นของ greedy แปลว่าคำตอบของ greedy ก็ optimal ด้วย บทเรื่อง greedy algorithm ของ Jeff Erickson ใช้วิธีนี้พิสูจน์การเรียงไฟล์บน tape ตามความยาวและการจัดตารางเรียน

counterexample ตัวเดียวก็พอจะปัดตกกฎข้อหนึ่ง และการหามันก็มักเป็นการทดสอบที่เร็วที่สุด: รันกฎเทียบกับการค้นหาแบบ brute force บน input เล็ก ๆ แบบในขั้นที่ 2

### ระบบเหรียญ

ระบบเหรียญจะเป็น **canonical** เมื่อ greedy ให้จำนวนเหรียญน้อยที่สุดกับทุกจำนวนเงิน เหรียญ 25, 10, 5 และ 1 ในขั้นที่ 1 เป็น canonical และเหรียญสหรัฐตั้งแต่ 1 เซนต์ถึงหนึ่งดอลลาร์ (1, 5, 10, 25, 50, 100) กับเหรียญยูโร (1, 2, 5, 10, 20 และ 50 เซนต์ กับ 1 และ 2 ยูโร) ก็เช่นกัน: เทียบ greedy กับคำตอบที่แม่นยำจาก dynamic programming ทุกจำนวนเงินจนถึง 5,000 เซนต์ ไม่เจอความต่างเลย และตามขอบเขตของ Kozen–Zaks ข้างล่าง การเช็กนี้ก็ถือว่าสรุปได้แล้ว ส่วนระบบอื่นก็พังได้:

- **1, 3, 4** พังครั้งแรกที่ 6 แบบในขั้นที่ 2: 4 + 1 + 1 เทียบกับ 3 + 3
- **แสตมป์ไปรษณีย์สหรัฐ** สไลด์ของ Kevin Wayne สำหรับหนังสือของ Kleinberg กับ Tardos ใช้แสตมป์ราคา 1, 10, 21, 34, 70, 100, 350, 1225 และ 1500 เซนต์: greedy จ่าย 140 เซนต์ด้วยแสตมป์แปดดวง (100, 34 และ 1 อีกหกดวง) ทั้งที่ 70 สองดวงก็พอ มันพังตั้งแต่ 30 เซนต์แล้ว โดยใช้ 21 กับ 1 อีกเก้าดวง เทียบกับ 10 สามดวง
- **ไม่มีเหรียญ 1 เซนต์** greedy อาจติดค้างได้ ทั้งที่มีวิธีทอนอยู่: ถ้ามี 7, 8 และ 9 มันจะหยิบ 9 จาก 15 แล้ว 6 ที่เหลือก็จ่ายไม่ได้ ทั้งที่ 7 + 8 ใช้ได้

การเช็กระบบเหรียญไม่ต้องลองทุกจำนวนเงิน Dexter Kozen กับ Shmuel Zaks พิสูจน์ไว้ในปี 1994 ว่าถ้ามีจำนวนเงินไหนที่ greedy พัง จำนวนเงินที่น้อยที่สุดที่พัง x จะอยู่ในช่วง c₃ + 1 < x < cₘ + cₘ₋₁ สำหรับเหรียญมูลค่า 1 = c₁ < c₂ < … < cₘ: คือต่ำกว่าผลรวมของเหรียญที่ใหญ่ที่สุดสองเหรียญ การทดสอบของพวกเขาต้องใช้แค่จำนวนเหรียญของ greedy และใช้เวลา O(m·cₘ) ส่วนอัลกอริทึมของ David Pearson (2005) ใช้เวลา O(m³) เป็น polynomial ตามจำนวนชนิดเหรียญไม่ว่ามูลค่าจะเป็นเท่าไร โดยบีบ counterexample ที่เล็กที่สุดให้เหลือตัวเลือกแค่ O(m²) ตัว

### การจัดตาราง

- **Interval scheduling** (ขั้นที่ 3): ถ้าจะใส่นัดให้ได้มากที่สุดในห้องเดียว ให้ sort ตามเวลาจบ แล้วรับทุกนัดที่เริ่มไม่ก่อนเวลาจบของนัดล่าสุดที่รับไว้ กฎเริ่มก่อนสุดพัง (workshop ทั้งวันในขั้นที่ 3) และกฎนัดที่สั้นที่สุดก่อนก็พังด้วย: นัดสั้น ๆ นัดเดียวอาจทับนัดที่ยาวกว่าสองนัดที่ใส่ด้วยกันได้ ตัว sort ใช้ O(n log n) และการสแกนใช้ O(n)
- **Interval partitioning:** ถ้าจะรับ *ทุก* นัดโดยใช้ห้องให้น้อยที่สุด ให้ไล่นัดตามลำดับเวลาเริ่ม แล้วใส่แต่ละนัดลงห้องไหนก็ได้ที่ว่างแล้วตอนนั้น และเปิดห้องใหม่ก็ต่อเมื่อไม่มีห้องว่างเลย จำนวนห้องจะเท่ากับ **depth** คือจำนวนนัดที่เกิดขึ้นพร้อมกันมากที่สุดในจังหวะไหนก็ตาม และไม่มีตารางไหนใช้ห้องน้อยกว่านั้นได้ มันเลย optimal ถ้าเก็บเวลาจบของห้องไว้ใน min-heap ก็จะรันใน O(n log n) นัดทั้งเก้าในขั้นที่ 3 มี depth 3 และใส่ได้ในสามห้อง: ห้องแรกมี Workshop ห้องที่สองมี A, C, E กับ G และห้องที่สามมี B, D, F กับ H
- **Weighted interval scheduling:** ถ้านัดมีค่าไม่เท่ากัน กฎจบก่อนสุดอาจแพ้ เพราะนัดเล็ก ๆ ที่จบก่อนอาจขวางนัดที่มีค่ามากกว่า คำตอบที่แม่นยำต้องใช้ [dynamic programming](../dynamic-programming/): sort ตามเวลาจบ แล้วสำหรับแต่ละนัด เลือกทางที่ดีกว่าระหว่างข้ามมันไป กับรับมันบวกตารางที่ดีที่สุดในบรรดานัดที่จบก่อนมันเริ่ม รวมแล้ว O(n log n) ถ้าใช้ [binary search](../binary-search/)
- **Shortest job first:** บนเครื่องเดียว การรันงานเรียงจากสั้นไปยาวจะทำให้เวลาเสร็จเฉลี่ยน้อยที่สุด งาน 3, 1 และ 2 นาทีจะเสร็จที่ 3, 4 และ 6 ถ้ารันตามลำดับนั้น (เฉลี่ย 4.33) แต่เสร็จที่ 1, 3 และ 6 ถ้ารันตัวสั้นก่อน (3.33) การพิสูจน์จะสลับงานที่ยาวกว่าที่รันอยู่ก่อนงานที่สั้นกว่าพอดี การสลับแบบนี้ทำให้ผลรวมลดลง เป็นเหตุผลเดียวกับที่ Erickson ใช้กับไฟล์บน tape วิธีนี้ต้องรู้ความยาวล่วงหน้า และถ้ามีงานสั้น ๆ เข้ามาไม่หยุด งานยาวก็อาจต้องรอไปตลอด
- Kleinberg กับ Tardos เพิ่มตัวคลาสสิกอีกสองตัว: **earliest deadline first** ทำให้ความช้าสูงสุดน้อยที่สุด และการ evict แบบ **farthest-in-future** optimal สำหรับ cache ถ้ารู้ลำดับ request ทั้งหมดล่วงหน้า ส่วน cache จริงมองไม่เห็นอนาคต eviction policy ของมันเลยเป็นแค่ heuristic

### Huffman coding

paper ปี 1952 ของ David Huffman สร้าง **minimum-redundancy code**: โค้ดแบบ prefix-free (ไม่มี codeword ไหนเป็นส่วนต้นของอีกตัว decoder เลยแบ่ง bit stream ได้โดยไม่ต้องมีตัวคั่น) ที่ให้ความยาวรวมสั้นที่สุดสำหรับจำนวนของ symbol ที่ให้มา ขั้นแบบ greedy คือ:

1. ใส่ทุก symbol ลงใน priority queue โดยใช้จำนวนของมันเป็น key
2. เอา tree สองต้นที่จำนวนน้อยที่สุดออกมา ทำให้เป็นลูกของ node ใหม่ที่มีจำนวนเท่ากับผลรวมของมัน แล้วใส่ node นั้นกลับเข้าไป
3. ทำซ้ำจนเหลือ tree ต้นเดียว แล้วอ่านแต่ละโค้ดจาก root: 0 สำหรับกิ่งซ้าย 1 สำหรับกิ่งขวา

สำหรับ abracadabra (a 5, b 2, r 2, c 1, d 1) การรวมคือ c + d = 2, b + r = 4, 2 + 4 = 6 และ a + 6 = 11 และ `a` ที่เจอบ่อยก็ได้โค้ดยาว 1 bit ผลรวม 23 bit ก็เท่ากับผลรวมของจำนวนบน node ที่รวมกันด้วย: 2 + 4 + 6 + 11 ค่าที่เสมอกันเจอบ่อย: ถ้ารวม tree (c d) กับ b ก่อนจะรวม b กับ r จะได้ความยาวโค้ด 1, 2, 3, 4, 4 (a, r, b, c, d) แทน 1, 3, 3, 3, 3 และก็ได้ 23 bit อีก วิธีตัดสินค่าที่เสมอกันเปลี่ยนโค้ดได้ แต่ไม่เคยเปลี่ยนผลรวม ทำให้ format ต่าง ๆ ไม่ให้ decoder สร้าง tree ขึ้นมาใหม่: DEFLATE ส่งความยาวโค้ด แล้วทั้งสองฝั่งก็สร้าง canonical code ตัวเดียวกันจากมัน

Huffman code เป็นโค้ดที่ optimal ในบรรดาโค้ดที่ให้แต่ละ symbol มีจำนวน bit เป็นจำนวนเต็มของมันเอง ตัว symbol ที่เป็น 99 % ของข้อมูลมีข้อมูลอยู่แค่ราว 0.015 bit (−log₂ 0.99) แต่ยังต้องจ่ายเต็ม bit ทุกครั้ง นี่คือเหตุผลที่ coder ที่ไม่ได้ถูกจำกัดอยู่ที่ bit เต็ม ๆ อย่าง arithmetic coding ที่ JPEG ให้เลือกใช้ได้ บีบอัดข้อมูลที่เบ้ได้มากกว่า

### Minimum spanning tree และ shortest path

- **Kruskal (1956)** sort edge ตาม weight แล้วเพิ่มแต่ละเส้น เว้นแต่มันจะปิด cycle โดยใช้โครงสร้าง union-find ตรวจเรื่องนี้ได้ในเวลาเกือบคงที่: O(E log E) โดยมี sort เป็นตัวหลัก
- **Prim (1957)** ที่ Vojtěch Jarník ตีพิมพ์ไว้ก่อนในปี 1930 ปลูก tree ต้นเดียวจาก vertex เริ่มต้น และเพิ่ม edge ที่เบาที่สุดที่ออกจาก tree นั้นเสมอ: O(E log V) ถ้าใช้ binary heap
- ทั้งสองถูกต้องเพราะ **cut property**: ถ้าแบ่ง vertex เป็นสองกลุ่มแบบไหนก็ตาม edge ที่เบาที่สุดที่ข้ามรอยแบ่งจะอยู่ใน minimum spanning tree (โดยสมมติว่า weight ไม่ซ้ำกัน) Sedgewick กับ Wayne นำเสนอทั้งคู่เป็นกรณีพิเศษของ greedy algorithm ทั่วไปตัวเดียวที่สร้างบน property นี้
- [อัลกอริทึมของ Dijkstra](../dijkstra/) ก็เป็น greedy เหมือนกัน: มัน settle node ที่ใกล้ที่สุดที่ยังไม่ settle และไม่กลับไปดูอีก ทางเลือกนี้พิสูจน์ได้ว่าปลอดภัยก็ต่อเมื่อไม่มี edge ไหน weight ติดลบ

### Greedy ในฐานะ heuristic

สำหรับปัญหายากหลายข้อ กฎแบบ greedy หาค่า optimum ไม่เจอ แต่ก็ยังมีการรับประกันมาด้วย:

- **Set cover:** หยิบ set ที่ครอบคลุม element ที่ยังไม่ถูกครอบคลุมได้มากที่สุดซ้ำไปเรื่อย ๆ ตำราของ Williamson กับ Shmoys พิสูจน์ว่าวิธีนี้อยู่ในระยะไม่เกิน Hₙ = 1 + 1/2 + … + 1/n ≈ ln n เท่าของค่า optimum สำหรับ n element และให้ผลเรื่องความยากที่คู่กัน: สำหรับค่าคงที่ c > 0 บางค่า อัลกอริทึมแบบ polynomial-time ที่รับประกัน c·ln n ได้จะหมายความว่า P = NP
- **กระจายงานไปหลายเครื่อง:** ให้แต่ละงานไปลงเครื่องที่ load น้อยที่สุดจนถึงตอนนั้น Graham แสดงไว้ในปี 1966 ว่าเวลาที่เครื่องสุดท้ายทำเสร็จ (makespan) ไม่เคยเกินสองเท่าของค่าที่ดีที่สุดที่เป็นไปได้ และสไลด์สำหรับหนังสือของ Kleinberg กับ Tardos ก็ให้ input ที่เข้าใกล้ขีดนั้น: 10 เครื่อง งานยาว 1 จำนวน 90 งาน และงานสุดท้ายยาว 10 ทำให้งานทั้งหมดเสร็จที่เวลา 19 ทั้งที่ทำได้ที่ 10 การ sort งานให้ตัวยาวมาก่อนทำให้การรับประกันดีขึ้นเป็น 3/2 ตามการพิสูจน์ในสไลด์ และเป็น 4/3 ตามการวิเคราะห์ของ Graham ในปี 1969
- Least-connections ใน [load balancer](../load-balancing/) คือเวอร์ชัน online: แต่ละ request ไปที่ backend ที่มี active connection น้อยที่สุด โดยไม่รู้ว่า request จะใช้เวลานานแค่ไหน มันเป็น heuristic ที่ปรับตัวตาม request ที่ไม่สม่ำเสมอ โดยไม่มีการรับประกันว่า optimal

### Fractional knapsack และ 0/1 knapsack

ถ้าความจุคือ 10 และมีของสามชิ้น A (น้ำหนัก 6 มูลค่า 30), B (5, 20) และ C (5, 20) การ sort ตามมูลค่าต่อหน่วยน้ำหนักจะหยิบ A ก่อน (5 ต่อหน่วย) ถ้าแบ่งของได้ (knapsack แบบ **fractional**) greedy จะเติม 4 หน่วยสุดท้ายด้วย B สี่ในห้าส่วน ได้รวม 46 และนี่คือค่า optimal: exchange argument แสดงว่าการเติมแบบอื่นทุกแบบสลับน้ำหนักไปหามูลค่าต่อหน่วยที่สูงกว่าได้ ถ้าของต้องเอาทั้งชิ้นหรือไม่เอาเลย (knapsack แบบ **0/1**) greedy จะหยุดที่ 30 เพราะ B ใส่ไม่ลงแล้ว ทั้งที่ B + C ได้ 40 เวอร์ชัน 0/1 ต้องใช้ dynamic programming

### Priority queue ที่อยู่ข้างใต้

Huffman coding, Prim, Dijkstra และการแจกงานให้ตัวที่ load น้อยที่สุด ล้วนทำ "เอาตัวที่เล็กที่สุดจนถึงตอนนี้มาให้หน่อย" ซ้ำ ๆ และนี่ก็คือสิ่งที่ [binary heap](../binary-heap/) ทำได้ใน O(log n) ต่อการ push หรือ pop หนึ่งครั้ง `heapq` ของ Python มีให้ใช้บน list ธรรมดา และเอกสารของมันแนะนำให้เก็บตัวนับลำดับ entry ไว้ข้าง priority เพื่อใช้ตัดสินค่าที่เสมอกัน priority ที่เท่ากันจะได้ออกมาตามลำดับที่ใส่ และไม่ต้องเทียบตัว item เองเลย โค้ดข้างล่างก็ทำแบบเดียวกัน

## โค้ด

```python
import heapq
from itertools import count


def greedy_change(amount, coins):
    """Pay amount with as many of the largest coin as fit, then the next, and so on."""
    picked = []
    for coin in sorted(coins, reverse=True):
        n, amount = divmod(amount, coin)      # how many of this coin still fit
        picked += [coin] * n
    return picked if amount == 0 else None    # None: greedy is stuck (no 1-coin)


def schedule(meetings):
    """Book the most non-overlapping (name, start, end) meetings: earliest end first."""
    booked, free_at = [], float("-inf")
    for name, start, end in sorted(meetings, key=lambda m: m[2]):
        if start >= free_at:                  # back to back is allowed
            booked.append(name)
            free_at = end
    return booked


def huffman_codes(freq):
    """Prefix-free codes for {symbol: count}: keep merging the two rarest trees."""
    if not freq:
        return {}
    tick = count()                            # breaks ties, so trees are never compared
    heap = [(f, next(tick), sym) for sym, f in freq.items()]
    heapq.heapify(heap)
    while len(heap) > 1:
        f1, _, left = heapq.heappop(heap)
        f2, _, right = heapq.heappop(heap)
        heapq.heappush(heap, (f1 + f2, next(tick), (left, right)))
    codes, stack = {}, [(heap[0][2], "")]
    while stack:
        node, code = stack.pop()
        if isinstance(node, tuple):           # inner node: 0 to the left, 1 to the right
            stack += [(node[1], code + "1"), (node[0], code + "0")]
        else:
            codes[node] = code or "0"         # a lone symbol still needs one bit
    return codes


meetings = [("Workshop", 8.5, 16), ("A", 9, 10), ("B", 9.5, 11), ("C", 10, 11.5), ("D", 11, 12),
            ("E", 11.5, 13), ("F", 13, 14), ("G", 13.5, 15), ("H", 14, 15.5)]
print(greedy_change(63, [25, 10, 5, 1]), greedy_change(6, [1, 3, 4]))
print(schedule(meetings))
print(huffman_codes({"a": 5, "b": 2, "r": 2, "c": 1, "d": 1}))
# [25, 25, 10, 1, 1, 1] [4, 1, 1]
# ['A', 'C', 'E', 'F', 'H']
# {'a': '0', 'c': '100', 'd': '101', 'b': '110', 'r': '111'}
```

ตรงนี้ symbol เป็น string ธรรมดา และ inner node เป็น tuple แล้วทั้งสาม function ก็ถูกตรวจเทียบกับ brute force: `greedy_change` เทียบกับ dynamic programming แบบแม่นยำ (รวมราคาแสตมป์สหรัฐข้างบนและกรณีติดค้าง 7, 8, 9) ช่วงของ Kozen–Zaks บนระบบเหรียญสุ่ม 3,000 ระบบ `schedule` เทียบกับทุก subset ของชุดนัดสุ่ม 2,000 ชุดที่มีไม่เกิน 10 นัด (รวมกรณีไม่มีนัด นัดเดียว นัดซ้ำ และนัดที่ต่อกันติด ๆ) และ `huffman_codes` เทียบกับความยาวโค้ดที่ดีที่สุดที่ Kraft inequality ยอมให้ บน alphabet สุ่ม 400 ชุดที่มีไม่เกินหก symbol ส่วนโค้ดของ abracadabra เป็น prefix-free และรวมได้ 23 bit

## Complexity

| อัลกอริทึม | Best | Average | Worst | พื้นที่เพิ่ม | ทำไม |
|---|---|---|---|---|---|
| `greedy_change` | O(d log d + k) | O(d log d + k) | O(d log d + k) | O(d + k) | sort ชนิดเหรียญ d ชนิด หารหนึ่งครั้งต่อชนิด และมี k เหรียญที่ต้องใส่ในคำตอบ |
| `schedule` | O(n) | O(n log n) | O(n log n) | O(n) | sort เป็นตัวหลัก ส่วนการสแกนเป็นรอบเดียว ถ้านัดเรียงตามเวลาจบมาอยู่แล้วก็ข้าม sort ได้ เหลือ O(n) |
| `huffman_codes` | O(n log n) | O(n log n) | O(n²) | O(n²) | การสร้าง heap เป็น O(n) การรวม n − 1 ครั้งแต่ละครั้ง pop สองครั้งและ push หนึ่งครั้ง ครั้งละ O(log n) การเขียนโค้ดออกมามีต้นทุนเท่าความยาวรวมของมัน: ราว n log n สำหรับจำนวนทั่วไป แต่ราว n²/2 เมื่อจำนวนโตแบบเลข Fibonacci จน tree กลายเป็น path การนับ symbol ของข้อความยาว L เพิ่มอีก O(L) |

เรื่อง stable และ in place ไม่เกี่ยว: แต่ละ function สร้างคำตอบใหม่ greedy algorithm เร็วเพราะมันไม่เคยย้อนอะไร ต้นทุนของมันเลยมักเป็น sort หนึ่งครั้งหรือ heap หนึ่งรอบ ต้นทุนของกฎที่ผิดไม่ได้โผล่ในตารางนี้: มันโผล่ในคำตอบ

## ใช้ตอนไหนดี

- เมื่อปัญหามีบทพิสูจน์ว่า greedy optimal: interval scheduling และ partitioning, minimum spanning tree, Huffman code, shortest path ที่ weight ไม่ติดลบ, fractional knapsack, การจัดตารางตาม deadline หรือตามความยาวงาน และการทอนเงินในระบบเหรียญแบบ canonical
- เมื่อคำตอบที่เร็วและมีขอบเขตที่รู้แน่ ดีกว่าคำตอบที่แม่นยำแต่ใช้เวลาแบบ exponential: set cover การแจกงานให้เครื่อง
- เมื่อต้องตัดสินใจแบบ online ทีละครั้งและแก้ไม่ได้: เลือก backend ให้ request วาง pod รับนัดเข้าปฏิทิน
- ไม่เหมาะเมื่อทางเลือกแรก ๆ อาจขวางชุดที่ดีกว่ามากในภายหลัง: การทอนเงินในระบบเหรียญแบบไหนก็ได้ 0/1 knapsack และ weighted interval scheduling ให้ใช้ dynamic programming หรือค้นหาด้วย [backtracking](../backtracking/) ถ้า input เล็ก

## ได้อะไร เสียอะไร

- **เร็ว แต่จะถูกก็ต่อเมื่อมีบทพิสูจน์** greedy algorithm ที่ผิดก็ยังคืนคำตอบอย่างมั่นใจ ให้ทดสอบกฎเทียบกับ brute force บน input เล็ก ๆ ก่อนจะเชื่อมัน
- **บทพิสูจน์ผูกกับ input พอ ๆ กับโค้ด** greedy change optimal สำหรับ 25, 10, 5, 1 และผิดสำหรับ 4, 3, 1 ด้วยโค้ดเดียวกัน การเพิ่มชนิดเหรียญ attribute ของงาน หรือ weight อาจเปลี่ยน greedy algorithm ที่ถูกให้กลายเป็น heuristic แบบเงียบ ๆ
- **ค่าที่เสมอกันเป็นตัวตัดสิน output** key ที่เท่ากันอาจให้คำตอบที่ต่างกันแต่ดีพอกัน (Huffman code แบบอื่น ชุดนัดอีกชุด) ถ้า output ต้องทำซ้ำได้ ให้ตัดสินค่าเสมออย่างตั้งใจด้วย index หรือตัวนับลำดับการใส่ และอย่าให้สองฝ่ายต่างคนต่างสร้าง tree เดียวกันขึ้นมาเอง
- **ไม่มีโอกาสแก้ตัว** การตัดสินใจแบบ greedy ที่เป็น online อย่าง least-connections ทำตาม snapshot ถ้า snapshot ชวนให้เข้าใจผิด (backend ที่ fail เร็วจะมี connection ค้างอยู่น้อย) การตัดสินใจก็ค้างอยู่อย่างนั้นจนถึงครั้งถัดไป
- **ขอบเขตของ heuristic คือ worst case** ค่า factor 2 หรือ ln n เป็นเพดาน ไม่ใช่ผลลัพธ์ทั่วไป และไม่ได้บอกอะไรเกี่ยวกับ input ตัวใดตัวหนึ่ง

## ข้อควรรู้ตอนลงมือทำ

- **Compression format:** DEFLATE ([RFC 1951](https://www.rfc-editor.org/rfc/rfc1951)) แบ่งข้อมูลเป็น block ที่เก็บไว้เฉย ๆ เข้ารหัสด้วย Huffman code แบบตายตัว หรือเข้ารหัสด้วย Huffman code ที่สร้างขึ้นสำหรับ block นั้น บน LZ77 match อีกที โค้ดพวกนี้เป็นแบบ canonical: โค้ดที่ยาวเท่ากันเป็นค่าที่เรียงต่อกันตามลำดับ symbol และโค้ดที่สั้นกว่ามาก่อน block หนึ่งเลยต้องส่งแค่ความยาวโค้ด แต่ละตัวตั้งแต่ 1 ถึง 15 bit โดยใช้ 0 บอกว่า symbol นั้นไม่ได้ใช้ ตัว RFC นิยาม format โดยไม่ได้กำหนดอัลกอริทึมการบีบอัด ทำให้ compressor เป็นคนเลือกโค้ดเอง ส่วน zlib สร้าง tree ด้วย heap ใน [`trees.c`](https://github.com/madler/zlib/blob/develop/trees.c) และถ้าโค้ดไหนจะยาวเกินขีดจำกัด ก็ย่อมันให้สั้นลงแล้วปรับสมดุลตัวที่เหลือ DEFLATE คือวิธีที่อยู่เบื้องหลัง gzip (compression method 8 ใน [RFC 1952](https://www.rfc-editor.org/rfc/rfc1952)), ZIP (method 8 "Deflated" ใน [APPNOTE ของ PKWARE](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)) และ PNG ที่ compression method 0 ของมันคือ zlib stream ที่มี window ไม่เกิน 32,768 byte ([PNG specification](https://www.w3.org/TR/png-3/))
- **Format ที่ใหม่กว่า:** Brotli ([RFC 7932](https://www.rfc-editor.org/rfc/rfc7932)) รวม LZ77 กับ prefix code แบบ Huffman ส่วน Zstandard ([RFC 8878](https://www.rfc-editor.org/rfc/rfc8878)) เข้ารหัส literal ด้วย Huffman และเข้ารหัส literal length, match length และ offset ด้วยตาราง FSE (finite state entropy) ส่วน baseline JPEG ทำ entropy coding กับ coefficient ด้วยตาราง Huffman ได้ไม่เกินสองตารางสำหรับ DC และสองตารางสำหรับ AC coefficient และโหมดแบบขยายก็ใช้ arithmetic coding แทนได้ ([ITU-T T.81](https://www.w3.org/Graphics/JPEG/itu-t81.pdf))
- **HTTP header:** HPACK ที่เป็น header compression ของ HTTP/2 มี Huffman code แบบตายตัวหนึ่งชุดใน specification ของมัน สร้างจากสถิติของตัวอย่าง HTTP header ชุดใหญ่ ([RFC 7541](https://www.rfc-editor.org/rfc/rfc7541), Appendix B) และ QPACK ของ HTTP/3 ก็ใช้ตารางเดียวกันโดยไม่เปลี่ยนเลย ([RFC 9204](https://www.rfc-editor.org/rfc/rfc9204)) อัลกอริทึมของ Huffman รันแค่ครั้งเดียวแบบ offline ส่วน endpoint แค่เปิดหาโค้ด
- **Routing:** link-state protocol อย่าง OSPF ([RFC 2328](https://www.rfc-editor.org/rfc/rfc2328), section 16.1) สร้าง shortest-path tree ของมันด้วย [อัลกอริทึมของ Dijkstra](../dijkstra/)
- **การจัดตารางและการวาง:** kube-scheduler กรอง node ที่รัน pod ได้ ให้คะแนนตัวที่เหลือ แล้ว bind pod เข้ากับ node ที่คะแนนสูงที่สุด โดยสุ่มเลือกถ้าคะแนนเท่ากัน ([Kubernetes Scheduler](https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/)) pod ถูกวางทีละตัวตามคะแนนที่ดีที่สุดในตอนนั้น เป็นการเลือกแบบ greedy ไม่ใช่การจัดวางแบบ global ส่วน scoring strategy `MostAllocated` จะเลือก node ที่เต็มที่สุดก่อน ทำให้มันกลายเป็น bin packing แบบ greedy ([Resource Bin Packing](https://kubernetes.io/docs/concepts/scheduling-eviction/resource-bin-packing/))
- **Load balancer:** `least_conn` ของ NGINX ส่งแต่ละ request ไปที่ server ที่มี active connection น้อยที่สุด โดยคิด weight ของ server ด้วย และถ้าเสมอกันก็ถอยไปใช้ weighted round robin ([ngx_http_upstream_module](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#least_conn)) ดู [Load Balancing](../load-balancing/) สำหรับกับดักของมันและเรื่อง power of two choices
- **Compiler:** register allocator ตั้งต้นของ LLVM ชื่อ Greedy มันเป็นเวอร์ชันที่จูนแล้วของ basic allocator ที่ assign live range ให้ register ทีละตัวตามลำดับที่ heuristic กำหนด และเพิ่ม global live-range splitting เพื่อให้ spill code ยังถูกอยู่ ([LLVM code generator](https://llvm.org/docs/CodeGenerator.html#register-allocator))
- **การจัดวางข้อความ:** แต่เดิม browser ตัดบรรทัดแบบ greedy คือเติมแต่ละบรรทัดให้ไปได้ไกลที่สุดก่อนจะขึ้นบรรทัดใหม่ CSS Text Module Level 4 บอกว่าวิธี first-fit แบบนี้มักให้ผลที่ไม่ดีที่สุด และเสนอ `text-wrap-style: pretty` (หรือ `text-wrap: pretty`) เป็นตัวเลือกที่ช้ากว่าให้เปิดใช้เอง ([CSS Text Level 4](https://drafts.csswg.org/css-text-4/#text-wrap-style)) Chrome 117 ปล่อย `pretty` ที่เน้นเลี่ยงคำโดด ๆ คำเดียวในบรรทัดสุดท้าย ([Chrome for Developers](https://developer.chrome.com/blog/css-text-wrap-pretty)) ส่วนเวอร์ชันของ WebKit ประเมินทั้งย่อหน้า คล้ายที่ LaTeX และ InDesign ชั่งน้ำหนักหลายบรรทัดพร้อมกัน ([WebKit blog](https://webkit.org/blog/16547/better-typography-with-text-wrap-pretty/))
- **Priority queue ในการใช้งานจริง:** `heapq` ของ Python ทำงานบน list, Java มี `java.util.PriorityQueue` และ C++ มี `std::priority_queue` ให้เก็บ entry แบบ (key, counter, item) เพื่อไม่ให้ค่าที่เสมอกันตกไปถึงการเทียบตัว item และสำหรับ cost model ดู [Big-O Notation](../big-o-notation/)
