## ปัญหา

ทีม checkout ของ Acme Shop test service ของตัวเองแบบที่หลายทีมลงเอย เวลาที่ check ส่วนใหญ่ถูกเพิ่มเข้ามาทีหลังด้วยการกดใช้ product ที่ทำเสร็จแล้ว checkout service มี end-to-end test 640 ตัวที่คลิกไปทั่วร้านใน browser จริง รันโดย nightly job ที่ใช้เวลา 95 นาที ถัดลงมามี integration test 40 ตัว (6 นาที รันตอนกลางคืนเหมือนกัน) ที่ใช้ test database ตัวเดียวร่วมกันหมด และมี unit test แค่ 120 ตัว (15 วินาที) เป็น test ชุดเดียวที่รันก่อน merge ส่วน contract test กับ service ที่ checkout เรียกใช้ก็ไม่มีเลย (ตัวเลขของ Acme ในหน้านี้เป็นตัวเลขของตัวอย่างนี้เอง ไม่ใช่ผลวิจัย)

รูปทรงแบบนี้ ที่บนกว้างล่างบาง คือ **ice-cream cone** ชื่อที่ Alister Scott ตั้งให้ anti-pattern นี้ใน testing blog ของเขาเมื่อปี 2012 มันสร้างปัญหาสามทาง:

- **Feedback ช้า** developer ที่ merge ตอนบ่าย จะรู้ว่า browser test พังก็ตอนเช้าวันถัดไป หลังจากที่มี change อื่นลงมาทับอยู่ข้างบนแล้ว
- **ผลลัพธ์ที่ flaky** browser test ต้องรอหน้าเว็บ, พึ่ง test data และใช้ environment ร่วมกัน ทำให้ 7% ของ nightly run เป็นสีแดงทั้งที่โค้ดไม่ได้เปลี่ยนเลย ทีมก็เลยเรียนรู้ว่าสีแดงส่วนใหญ่แปลว่า "รันใหม่อีกรอบ"
- **Failure ที่ไม่ชัด** browser test ที่ fail รายงานแค่ว่า checkout fail แล้วแนบ screenshot ของหน้า error มาให้ มันไม่ได้บอกว่าต้นเหตุคือโค้ดคำนวณภาษี, database, payments service หรือตัว test เอง

สามข้อนี้รวมกันทำให้ suite ทั้งแพงและไม่มีใครเชื่อ ใน diagram ตัว PR #4182 ที่ merge ตอนบ่ายวันจันทร์ เปลี่ยนวิธีคำนวณภาษีต่อบรรทัด และตัดตัวเลขที่เกินทิ้งแทนที่จะปัดเศษ: ภาษี 8.25% ของ $19.99 คือ 1.649175 ที่ควรปัดเป็น 1.65 แต่กลับกลายเป็น 1.64 ส่วน unit test ทั้ง 120 ตัวก็ไม่มีตัวไหน test การปัดเศษ, ไม่มี integration test ตัวไหนเช็กยอดรวม และ browser test ก็เช็กแค่ว่า checkout ทำจนจบได้ ไม่ได้เช็กว่าเก็บเงินไปเท่าไหร่ รอบที่รันคืนนั้นเป็นสีแดงด้วยเหตุผลที่ไม่เกี่ยวกันและ flaky ("checkout failed") แล้วก็ผ่านตอนรันซ้ำเช้าวันถัดไป change นี้เลยไปถึง staging แล้วเซนต์ที่หายไปก็ถูกเจอที่นั่นในวันพฤหัสบดี

## ทำงานยังไง

**test pyramid** เป็นวิธีจัดสมดุลของ test ทั้งชุด: test ที่เร็วและแคบจำนวนมากอยู่ข้างล่าง, test ที่กว้างขึ้นแต่น้อยลงอยู่สูงขึ้นไป และมี test แค่ไม่กี่ตัวที่ขับทั้งระบบผ่าน user interface ตัว Mike Cohn ทำให้มันเป็นที่รู้จักในชื่อ *test automation pyramid* ในหนังสือ *Succeeding with Agile* (Addison-Wesley, 2009) ส่วน bliki entry *TestPyramid* (2012) ของ Martin Fowler เล่าเพิ่มว่า Cohn วาดมันครั้งแรกตอนคุยกับ Lisa Crispin ในปี 2003–04 และ Jason Huggins ก็คิดแบบเดียวกันได้เองราวปี 2006 ส่วนใน pyramid ของ Cohn มี unit test อยู่ที่ฐาน, service test อยู่ตรงกลาง และ user-interface test อยู่ที่ยอด บทความ *The Practical Test Pyramid* ของ Ham Vocke (martinfowler.com, 2018) สรุปไว้เป็น rule of thumb สองข้อ: test ในรายละเอียดมากกว่าหนึ่งระดับ และยิ่งขึ้นไปสูงก็ยิ่งมี test น้อยลง

เหตุผลเบื้องหลังคือเรื่องต้นทุนกับข้อมูล Fowler ชี้ว่า test ที่ขับผ่าน user interface พังง่าย เขียนแพง และรันนาน: เปลี่ยนหน้าเว็บทีเดียวก็ทำให้มันพังได้เป็นสิบ ๆ ตัว ส่วนโพสต์ปี 2015 ของ Mike Wacker บน testing blog ของ Google เพิ่มมุมของข้อมูล: end-to-end test ที่ fail อาจต้องใช้เวลานานกว่าจะตามไปถึงต้นเหตุ ขณะที่ unit test แยก failure ออกมาให้เห็นได้เลย ตัว test ที่แคบรันในระดับ millisecond และ fail ด้วยเหตุผลเดียว ทำให้ failure ของมันบอกชื่อต้นเหตุได้ ตัว pyramid ไม่ได้ห้าม test ที่กว้าง มันแค่วาง check แต่ละอย่างไว้ที่ระดับต่ำสุดที่ทำ check นั้นได้ และเก็บ test ที่กว้างไว้ไม่กี่ตัว เพื่อยืนยันว่าส่วนต่าง ๆ ต่อกันถูกต้อง

หลังเปลี่ยนแล้ว test suite ของ checkout ที่ Acme มีสี่ layer:

| Layer | จำนวน test | รันบน | เวลา | failure บอกอะไร |
|---|---|---|---|---|
| **Unit** | 2,400 | CI runner ใน process เดียว ไม่มี network | 40 s | function และ case ที่พัง: `TaxCalculator.round()` คืนค่า 1.64 สำหรับ 1.649175 |
| **Integration** | 310 | CI runner กับ PostgreSQL และ Redis ตัวจริงใน container แบบใช้แล้วทิ้ง | 4 min | query, transaction หรือ cache entry ที่ทำงานผิด |
| **Contract** | 90 | CI runner โดยแชร์ contract ผ่าน Pact Broker | 1 min | request หรือ field ของ API ของ payments หรือ catalog ที่ไม่ตรงกันแล้ว |
| **End-to-end** | 18 | browser ที่รันกับ staging | 6 min | บอกว่า critical journey (pay by card, guest checkout) พัง |

- **Unit test** เช็กพฤติกรรมทีละอย่าง จะเป็น function หรือ class กลุ่มเล็ก ๆ ก็ได้ โดยรันใน memory ตัว *UnitTest* (bliki, 2014) ของ Fowler แยก test แบบ **solitary** ที่เอา test double มาแทน collaborator ของ unit ออกจาก test แบบ **sociable** ที่ใช้ collaborator ตัวจริง (คำเหล่านี้มาจาก Jay Fields) จะแบบไหนก็ได้ทั้งนั้น ที่สำคัญคือ test ต้องเร็ว และแต่ละตัว fail ด้วยเหตุผลเดียว กฎเรื่องภาษี, ส่วนลด และการปัดเศษของ checkout ถูก test ที่ layer นี้ โดยแต่ละกฎมี case เล็ก ๆ หลายตัว
- **Integration test** เช็กโค้ดที่คุยกับอะไรบางอย่างนอก process: SQL query, transaction, lock, cache expiry ตัว *IntegrationTest* (bliki, 2018) ของ Fowler สนับสนุน integration test แบบ **narrow** ที่ test แค่โค้ดที่คุยกับ dependency ภายนอกตัวเดียว มากกว่าแบบกว้างที่ต้องเปิดทุก service ไว้ ถ้าทดสอบกับ service อื่น Fowler จะรัน test กับ test double แล้วเช็ก double นั้นด้วย contract test ส่วนถ้าเป็น database บทความของ Vocke แนะนำให้รัน database ตัวจริงบนเครื่อง ฝั่ง Acme เปิด PostgreSQL และ Redis ตัวจริงใน container ทุกรอบที่รัน และ test แต่ละตัวก็เก็บกวาดข้อมูลของตัวเอง เลยไม่มี test ไหนต้องพึ่งข้อมูลที่ test อื่นทิ้งไว้
- **Contract test** เช็กข้อตกลงระหว่าง service โดยไม่ต้อง deploy มันด้วยกัน ใน **consumer-driven contracts** (Ian Robinson, martinfowler.com, 2006) ฝั่ง consumer แต่ละตัวระบุว่าต้องการอะไรจาก provider แล้ว provider ก็เช็กทุกครั้งที่เปลี่ยนว่ายังให้สิ่งนั้นได้อยู่ ใน Pact ตัว test ของ checkout รันกับ mock ของ payments ที่บันทึกแต่ละ request และ response ที่ checkout คาดหวังลงใน contract file ที่เรียกว่า *pact* จากนั้น Pact Broker ก็แชร์ pact ออกไป, payments เอา interaction เหล่านั้นไป replay กับ service ตัวจริงใน pipeline ของตัวเอง และคำสั่ง `can-i-deploy` ก็เช็กผล verification เหล่านั้นก่อนที่ฝั่งไหนจะ deploy
- **End-to-end test** ขับระบบที่ deploy แล้วแบบเดียวกับที่ลูกค้าใช้ ที่ Acme มันคือ smoke test 18 ตัวสำหรับ journey ที่ทำเงิน รันใน browser บน staging หลังทุก deployment

**Test double** ใช้แทน collaborator คำศัพท์ชุดนี้มาจาก *xUnit Test Patterns* ของ Gerard Meszaros (Addison-Wesley, 2007) ที่ *TestDouble* (bliki, 2006) ของ Fowler สรุปไว้: **dummy** แค่เติมช่อง parameter ให้ครบ, **fake** เป็นทางลัดที่ทำงานได้จริง เช่น repository ใน memory, **stub** ตอบคำตอบที่เตรียมไว้แล้ว, **spy** คือ stub ที่บันทึกด้วยว่าถูกเรียกยังไง และ **mock** ถูกตั้งค่าไว้ด้วย call ที่มันคาดว่าจะได้รับ แล้วทำให้ test fail ถ้า call พวกนั้นไม่เกิดขึ้น

**รูปทรงแบบอื่น** pyramid เป็นแค่หนึ่งในหลายรูปทรง และที่เถียงกันระหว่างรูปทรงพวกนี้ ส่วนหนึ่งก็เป็นเรื่องของคำ:

| รูปทรง | ตั้งชื่อโดย | กลุ่มที่ใหญ่ที่สุด | เหมาะกับ |
|---|---|---|---|
| Pyramid | Mike Cohn (2009) | unit test | software ทั่วไป |
| Ice-cream cone | Alister Scott (2012) ในฐานะ anti-pattern | browser test และ manual test | ไม่เหมาะกับอะไรเลย: เป็นรูปทรงที่ต้องเลี่ยง |
| Hourglass | testing blog ของ Google (2015) และ *Software Engineering at Google* (2020) ในฐานะ anti-pattern | unit test และ end-to-end test โดยมี integration test อยู่ตรงกลางไม่กี่ตัว | ไม่เหมาะกับอะไรเลย: เป็นรูปทรงที่ต้องเลี่ยง |
| Testing trophy | Kent C. Dodds (2018) | integration test บนฐานของ static analysis (type และ linting) | JavaScript application |
| Honeycomb | André Schaffer และ Rickard Dybeck, Spotify Engineering (2018) | integration test ที่ test แต่ละ service ผ่าน API ของมัน | microservices |

สัดส่วนก็มีคนยกมาพูดถึงเหมือนกัน โพสต์ปี 2015 ของ Mike Wacker บน testing blog ของ Google เสนอ unit test 70%, integration test 20% และ end-to-end test 10% เป็นตัวเลขตั้งต้น ส่วน *Software Engineering at Google* (O'Reilly, 2020, บทที่ 11) ให้เป้าคร่าว ๆ ไว้ที่ 80%, 15% และ 5% บทความ *On the Diverse And Fantastical Shapes of Testing* (2021) ของ Fowler บอกว่าที่เถียงกันส่วนใหญ่มาจากความหมายของคำว่า "unit test" ที่ต่างกัน: คนที่ชอบ honeycomb หรือ trophy มักนึกถึง unit test แบบ solitary ที่ใช้ mock เยอะ ขณะที่คนใช้ pyramid หลายคนเขียนแบบ sociable ตอนท้าย Fowler เห็นด้วยกับประเด็นของ Justin Searls ว่ารูปทรงสำคัญน้อยกว่าเรื่องที่ว่า test ชัดเจน เร็ว และเชื่อถือได้หรือเปล่า และ fail ก็ต่อเมื่อมีอะไรผิดจริง ๆ เท่านั้น

## ลงมือทำจริงยังไง

1. **ไล่รายการความเสี่ยง แล้ว test แต่ละข้อที่ layer ต่ำสุดที่จับมันได้** สำหรับ checkout: กฎเรื่องภาษี, ส่วนลด และการปัดเศษ (unit); SQL, locking และ cache expiry (integration); API ของ payments และ catalog (contract); การจ่ายด้วยบัตรและการ checkout แบบ guest (end-to-end) พอ test ที่กว้างเจอ bug ให้เขียน test แคบ ๆ ที่จะจับ bug นั้นได้ตั้งแต่แรกก่อน แล้วค่อยแก้โค้ดโดยใช้ test ตัวนั้นเช็ก ตามที่ทั้ง Fowler (2012) และ Vocke (2018) แนะนำ
2. **รัน layer ที่ถูกก่อน** pipeline ของ Acme รันทุก change จากฐานขึ้นไป: unit test (40 s), integration test (4 min), contract test (1 min) แล้วค่อย deploy ไป staging และรัน smoke test (6 min) กฎการปัดเศษที่พังจะหยุดรอบนั้นหลัง 40 วินาที แทนที่จะเป็น 12 นาที พอรวมการ build image กับการ deploy เข้าไปด้วย commit หนึ่งก็จะเขียวภายในราว 12 นาที หน้า [Continuous Delivery](../continuous-delivery/) พูดถึง pipeline ทั้งเส้น ส่วนหน้านี้พูดถึงรูปทรงของ test ที่อยู่ข้างใน
3. **ให้แต่ละ layer มี time budget แล้วคอยดูมัน** budget ของ Acme คือ 1, 5, 2 และ 8 นาที (เป็นตัวเลขของตัวอย่างนี้เอง) layer ไหนที่เกิน budget ก็เป็นสัญญาณให้ย้าย test ลงไป layer ล่าง, รันแบบ parallel หรือลบตัวที่ซ้ำทิ้ง ก่อนที่ stage ที่ช้าจะกลายเป็นเหตุผลที่คนรวม change ไว้ส่งทีเดียว guide ของ DORA เรื่อง capability test automation บอกว่า developer ควรได้ผลจาก automated test ภายในสิบนาที ทั้งบนเครื่องตัวเองและใน CI ส่วนรอบเต็มของ Acme ใช้ราว 12 นาที เรื่องถัดไปในลิสต์ของทีมเลยเป็นการรัน stage integration กับ contract คู่กันไป
4. **ใช้ dependency ตัวจริงใน container สำหรับ integration test** อย่างเช่น Testcontainers มี library สำหรับ Java, Go, .NET, Node.js, Python, Rust และภาษาอื่น ๆ พร้อม module สำเร็จรูปสำหรับ PostgreSQL, Redis และอีกมากมาย: แต่ละรอบจะเปิด database แบบใช้แล้วทิ้งที่เป็น version เดียวกับ production ทำให้ไม่มีสองรอบไหนใช้ข้อมูลร่วมกัน (ภายในรอบเดียว test แต่ละตัวก็เก็บกวาดของตัวเอง) ตัวแทนแบบ in-memory เปิดได้เร็วกว่า แต่อาจต่างจาก database ตัวจริงในเรื่อง SQL dialect, type และ locking
5. **เพิ่ม consumer-driven contract test ระหว่าง service** ให้ pact แต่ละตัวมีแค่ request และ field ที่ consumer ใช้จริง เอกสารของ Pact เตือนไม่ให้ใส่ business rule ของ provider หรือ validation rule ทุกข้อลงใน contract โดยให้ของพวกนั้นไปอยู่ใน test ของ provider เอง รัน `can-i-deploy` ก่อนทุก deployment เพื่อให้ checkout กับ payments release แยกกันได้
6. **ให้ end-to-end test มีน้อยและเน้นที่ journey** ทำ smoke test กับเส้นทางที่ทำเงินหลังทุก deployment และอย่ายอมเพิ่ม browser test ให้ทุก bug
7. **Quarantine test ที่ flaky โดยมีเจ้าของและวันที่ต้องแก้เสร็จ** บทความ *Eradicating Non-Determinism in Tests* (2011) ของ Fowler แนะนำให้ย้าย test ที่ fail แบบสุ่มออกจาก main pipeline ทันที และจำกัด quarantine ไว้ ไม่ว่าจะด้วยจำนวน test หรือระยะเวลาที่ test หนึ่งอยู่ในนั้นได้ เพื่อไม่ให้มันกลายเป็นสุสาน ฝั่ง Acme ยอมให้มี test ใน quarantine ได้มากสุดห้าตัว แต่ละตัวมีทีมที่เป็นเจ้าของและวันที่ต้องแก้เสร็จภายในหนึ่งสัปดาห์: ใน diagram ตัว smoke test ของ guest checkout เป็นของทีม checkout และกำหนดเสร็จวันที่ 16 ตุลาคม จากนั้นก็แก้ที่ต้นเหตุ โดย Fowler ไล่สาเหตุที่เจอบ่อยไว้ว่า: state ที่ test ใช้ร่วมกัน, การรอด้วย sleep แบบตายตัวแทนที่จะรอ condition, remote service, system clock และ resource ที่รั่ว
8. **วัด suite เหมือนวัด product** ติดตามเวลาตั้งแต่ commit จนได้ feedback, สัดส่วนของรอบที่ fail แล้วผ่านเมื่อรันซ้ำโดยไม่ได้เปลี่ยนอะไร (Acme ลดจาก 7% เหลือต่ำกว่า 0.5%) และ layer ไหนจับ bug แบบไหนได้ หนังสือ *Software Engineering at Google* รายงานว่า test เริ่มเสียคุณค่าเมื่อ flaky rate เข้าใกล้ 1% และระบุว่า rate ของ Google เองอยู่ที่ราว 0.15%
9. **อ่าน coverage แต่อย่าตั้งเป็นเป้า** coverage บอกว่าโค้ดส่วนไหนไม่มี test ไหนรันเลย แต่บอกไม่ได้ว่า test เช็กอะไรจริงหรือเปล่า ตัว *TestCoverage* (bliki, 2012) ของ Fowler เตือนว่าทีมทำตัวเลขสูง ๆ ได้ด้วย test ที่อ่อน และมอง coverage เป็นวิธีหาโค้ดที่ยังไม่มี test ไม่ใช่เป้าหมาย ถ้าจะ test ตัว test เอง ให้ลอง mutation testing (PIT สำหรับ JVM, Stryker สำหรับ JavaScript, C# และ Scala): มันจะแก้โค้ดทีละนิด แล้วรายงานจุดที่ไม่มี test ไหนสังเกตเห็น
10. **Shift left และคอยดู production ต่อไป** *Shift-left testing* เป็นคำจากบทความปี 2001 ของ Larry Smith ใน Dr. Dobb's Journal หมายถึงการ test ให้เร็วขึ้น ทำไปพร้อมกับการพัฒนา แทนที่จะรอไปทำใน phase ท้ายสุด และ pyramid ก็เป็นวิธีหนึ่งที่ทำแบบนั้นได้ แต่ production ก็ยังต้องมี check ของตัวเอง: [canary release](../canary-release/) เทียบ metric ของ version ใหม่กับของ version เดิมบน traffic จริงส่วนหนึ่ง และ synthetic check ก็รัน customer journey ตาม script กับ production ตามตารางเวลา (canary ของ Amazon CloudWatch Synthetics เป็นตัวอย่างหนึ่ง)

## อยู่ตรงไหนใน solution

- [Continuous Delivery](../continuous-delivery/): deployment pipeline เป็นตัวรัน pyramid โดย commit stage คือฐาน และ stage หลัง ๆ คือ test ที่กว้างขึ้น ส่วน suite ที่ช้าหรือ flaky ก็คือเหตุผลที่เจอบ่อยที่สุดที่ทำให้ทีมเลิกเชื่อ pipeline
- [Trunk-Based Development](../trunk-based-development/): การ merge เข้า main ทุกวันจะไปได้ก็ต่อเมื่อ test ตอบกลับภายในไม่กี่นาที และ build ที่เป็นสีแดงมีความหมายจริง
- [Feature Flags](../feature-flags/): โค้ดที่อยู่หลัง flag ถูก ship แบบปิดไว้ (dark) เลยต้อง test flag ทั้งสองสถานะที่ layer ต่ำสุดที่ทำได้ แทนที่จะเพิ่ม browser suite เป็นสองเท่า
- [Canary Release](../canary-release/) และ synthetic check ใน [Amazon CloudWatch](../amazon-cloudwatch/) test ใน production ที่ traffic และข้อมูลจริงเจอสิ่งที่ test environment ไหนก็ทำซ้ำไม่ได้ มันเป็นส่วนเสริมของ pyramid ไม่ได้มาแทนมัน
- [DORA Metrics](../dora-metrics/): test automation เป็นหนึ่งใน core capability ของ DORA และงานวิจัยของ DORA ก็เชื่อมมันเข้ากับ delivery performance ที่ดีขึ้น เมื่อ developer เป็นเจ้าของและดูแล test เอง ตัว suite ที่เร็วและเชื่อถือได้จะสะท้อนออกมาใน change lead time และ change fail rate
- [PostgreSQL](../postgresql/) และ [Redis](../redis/) ที่เปิดเป็น container ของ [Docker](../docker/) คือ dependency ตัวจริงของ integration test ของ Acme
- [The Three Ways](../three-ways/): Second Way หรือ feedback ที่เร็วจากขวาไปซ้าย คือสิ่งที่ suite ทรงดี ๆ ให้ developer ทุกคนในทุก change
- [Microservices](../microservices/): ระบบที่มี service เล็ก ๆ จำนวนมากคือที่ที่ contract test คุ้มค่า และเป็นที่ที่ honeycomb ของ Spotify อาจเหมาะกว่า pyramid

## ใช้ตอนไหนดี

pyramid คุ้มค่าในทุกที่ที่ทีมแก้โค้ดบ่อยและต้องการ feedback ที่เร็วและแม่นยำ: service ที่มี business logic จริง ๆ, library, back end ที่มีคนทำงานด้วยกันเยอะ มันตั้งอยู่บนสมมติฐานข้อเดียวที่ Fowler พูดไว้ชัด: test ที่กว้างช้ากว่า แพงกว่า และเปราะกว่า test ที่แคบ ถ้า test ที่กว้างของทีมบังเอิญเร็ว เสถียร และแก้ง่าย เหตุผลที่ต้องมี test แคบ ๆ จำนวนมากก็จะอ่อนลง

บางบริบทต้องปรับให้เข้ากัน:

- **Service ที่บาง** microservice ที่ส่วนใหญ่แค่ย้ายข้อมูลระหว่าง API กับ database มี logic ของตัวเองให้ unit test น้อย ตรงนี้ honeycomb ของ Spotify ที่ test ส่วนใหญ่เรียก API ของ service กับ database ตัวจริง จะเหมาะกว่า
- **JavaScript front end** ตัว static type กับ linting จับความผิดพลาดได้ทั้งกลุ่มด้วยต้นทุนต่ำ และ test ที่ render component แบบที่ผู้ใช้เห็น ให้ความมั่นใจมากกว่า test ที่เช็กข้างในของมัน: trophy สะท้อนเรื่องนี้
- **Legacy system ที่มี test น้อย** เริ่มจาก test ที่กว้างไม่กี่ตัวที่ตรึงพฤติกรรมในวันนี้ไว้ แล้วเพิ่ม test ที่แคบทุกจุดที่แก้โค้ด ตัว pyramid คือปลายทาง ไม่ใช่จุดเริ่มต้น
- **Software ที่มีกฎระเบียบคุม** auditor อาจขอ validation ระดับระบบที่มีเอกสาร ให้เก็บส่วนนั้นไว้เป็นชุด test ที่ตั้งใจทำแยกพร้อมหลักฐานของตัวเอง และใช้ pyramid สำหรับ feedback ประจำวัน
- **ทีมเล็กและ product ที่ยังใหม่** test ไม่กี่ตัวในแต่ละ layer อาจเป็นทั้งหมดที่ต้องมี สัดส่วนอย่าง 70/20/10 เป็นแค่การเดาเบื้องต้น ไม่ใช่เป้า

มันให้ผลคืนมาน้อย สำหรับโค้ดที่อีกไม่นานจะถูกทิ้ง เช่น spike หรือ prototype และสำหรับ unit ที่ง่ายมากจน test ของมันแค่เขียน implementation ซ้ำอีกรอบ

## กับดักที่เจอบ่อย

- **Mock ที่เพี้ยนไปจากของจริง** test ที่ stub API ของ payments จะยังผ่านอยู่ หลังจากที่ payments เปลี่ยนชื่อ status ไปแล้ว ความพังเลยไปโผล่ที่ staging หรือ production ให้มี stub น้อย ๆ และเช็กมันกับ provider ตัวจริง: *ContractTest* (bliki, 2011) ของ Fowler เสนอแบบนั้นเป๊ะ ๆ สำหรับ test double ของ external service และใน Pact ตัว mock ของ consumer กับ contract ก็มาจาก interaction ชุดเดียวกัน แล้ว provider ก็เป็นคน verify interaction พวกนั้น
- **Contract test ที่เช็กแค่ shape** ตัว pact เช็กว่า `amount` เป็นตัวเลข ค่า 21.63 ที่ผิดแต่ format ถูกเลยผ่าน ตั้งใจออกแบบมาแบบนี้ เพราะ contract ไม่ได้ใส่ business rule ไว้ ส่วนความหมายให้ test ใน unit test และ integration test ของแต่ละฝั่ง
- **End-to-end suite ที่โตกลับมา** ทุก incident ได้ browser test ใหม่หนึ่งตัว จน suite ช้าและ flaky อีกครั้ง: หนึ่งปีผ่านไป smoke test 18 ตัวของ Acme กลายเป็น 70 ตัว และ stage นี้ใช้เวลา 25 นาที เทียบกับ budget 8 นาที ทำให้ทั้งรอบเกินครึ่งชั่วโมง สำหรับ test ใหม่ทุกตัว ให้ถามว่า layer ต่ำสุดที่จับ bug นี้ได้คือ layer ไหน และลบ test ที่กว้างที่ check ของมันมีอยู่ใน layer ล่างแล้วทิ้งไป
- **เป้า coverage ที่โดนเล่นตัวเลข** ทีมที่ถูกสั่งให้ถึง 90% ทำได้ด้วย test ที่รันโค้ดแต่ไม่ assert อะไรเลย ให้ใช้ coverage หาโค้ดที่ยังไม่มี test, review test ให้ละเอียดเท่ากับ review โค้ด และใช้ mutation testing ดูว่า test จะสังเกตเห็นหรือเปล่าถ้าโค้ดเปลี่ยน
- **Unit test ที่ผูกติดกับ implementation** test ที่ลอกโครงสร้างของโค้ด, mock ทุก collaborator และ assert การเรียกภายใน จะพังทุกครั้งที่ refactor และแทบไม่ได้ปกป้องอะไร ให้ test พฤติกรรมผ่าน public interface ของ unit และเลือก test แบบ sociable เมื่อ collaborator มีต้นทุนต่ำ
- **ทรง hourglass** มี unit test เยอะและ end-to-end test เยอะ แต่ตรงกลางมีน้อย ทำให้ database query กับ service boundary ถูก test ผ่าน browser เท่านั้น ให้เพิ่ม integration test แบบแคบและ contract test
- **ใช้สัดส่วนเป็นเป้า** 70/20/10 หรือ 80/15/5 อธิบายว่า suite มักจะลงเอยแบบไหน ไม่ใช่โควตา ให้ดู feedback time, รอบที่ flaky และ bug ถูกจับได้ที่ไหนแทน
- **รันซ้ำแทนที่จะแก้** retry อัตโนมัติซ่อนความ flaky ไว้ ถ้าจะ retry ให้บันทึกทุกครั้งที่ retry และถือว่า test ที่ต้อง retry คือ test ที่ flaky: quarantine มัน, ให้มันมีเจ้าของและวันที่ และแก้ที่ต้นเหตุ
- **คิดว่า pipeline ที่เขียวคือ production ที่ใช้งานได้** ไม่มี test environment ไหนมี traffic, ข้อมูล และ configuration แบบ production ให้เพิ่ม canary กับ synthetic check เป็นส่วนเสริมของ pyramid ไม่ใช่ตัวแทน
