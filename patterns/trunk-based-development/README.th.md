## ปัญหา

branch ที่อยู่นานเป็นสัปดาห์ถืองานที่ยังไม่มีใคร integrate เข้าด้วยกัน ระหว่างที่มันยังเปิดอยู่ ตัว mainline และ branch อื่นทุกตัวก็เปลี่ยนไปเรื่อย ๆ การ merge ตอนท้ายเลยใหญ่ขึ้นทุกวันที่รอ ความเสียหายส่วนหนึ่งโผล่มาเป็น conflict ที่ Git แจ้ง ส่วนที่แย่กว่าคือส่วนที่ merge ได้เรียบร้อย: การเปลี่ยนแปลงสองชุดที่ถูกต้องเมื่อดูแยกกัน แต่พังกันเองพอทำงานด้วยกัน อย่าง filter ใหม่กับการ sort แบบใหม่ของ Acme ใน diagram แล้วปัญหาพวกนี้ก็ไม่มีใครเห็นจนกว่าจะได้ test โค้ดที่รวมกันแล้ว และถ้า release ตามรอบเวลา ก็แปลว่าจะเห็นตอนไม่กี่วันก่อน release

branching model ที่สร้างรอบ branch อายุยาวก็มีการ merge เพิ่มของมันเอง ใน GitFlow ตัว feature จะ merge เข้า `develop` แล้ว release branch ก็ถูกตัดจาก `develop` จากนั้น merge เข้า `main` และกลับเข้า `develop` ส่วน hotfix branch ก็ merge เข้าทั้งสองตัว Vincent Driessen ผู้เผยแพร่ model นี้ในปี 2010 เขียนหมายเหตุเพิ่มไว้ในเดือนมีนาคม 2020: เขาเขียน model นี้สำหรับซอฟต์แวร์ที่ระบุ version ชัด ๆ หรือมีหลาย version ใช้งานอยู่ และเขาแนะนำให้ทีมที่ทำ continuous delivery ไปใช้ flow ที่ง่ายกว่า เช่น GitHub flow ส่วนทีมที่กลัววัน merge ก็มักจะเพิ่ม code freeze และช่วง stabilization เข้าไป ทำให้ feedback ยิ่งมาช้าลงไปอีก

## ทำงานยังไง

คำอธิบายที่รู้จักกันมากที่สุดคือ [trunkbaseddevelopment.com](https://trunkbaseddevelopment.com/) ที่ Paul Hammant เขียนร่วมกับ contributor อีกหลายคน ในแนวทางนี้ developer ทำงานร่วมกันบน branch เดียวคือ trunk (`main` ใน Git repository ส่วนใหญ่) และไม่สร้าง development branch อายุยาว โดยมีเทคนิคไม่กี่อย่างที่ทำให้ trunk ยังทำงานได้ระหว่างนั้น เว็บนี้อธิบายไว้สองแบบ:

- **Commit ตรงเข้า trunk** แต่ละ developer จะรัน build ชุดเดียวกับที่ CI รัน แล้ว push เข้า `main` เว็บนี้บอกว่าแบบนี้ใช้ได้กับทีมที่มีคนถึงราว 15 คน
- **Feature branch อายุสั้น** ส่วนทีมที่ใหญ่กว่า จะให้แต่ละ branch เป็นของ developer คนเดียว (หรือคู่เดียว) ผ่านการ review ด้วย pull request และผ่านการตรวจของ CI แล้ว merge และลบทิ้งภายในสองสามวันเป็นอย่างมาก เว็บนี้เตือนว่าถ้าเกินสองวัน มันก็กำลังกลายเป็น branch อายุยาว ส่วนคำอธิบายของ DORA เข้มกว่านั้น: branch ที่ปกติอยู่ได้ไม่เกินไม่กี่ชั่วโมง

**Continuous integration แบบตรงตามตัวอักษร** บทความ [Continuous Integration](https://martinfowler.com/articles/continuousIntegration.html) ของ Martin Fowler (แก้ล่าสุดเดือนมกราคม 2024) ขอให้ developer ทุกคน push commit เข้า mainline อย่างน้อยวันละครั้ง ให้ทุกการ push trigger build และให้แก้ build ที่พังทันที โดย revert commit ที่ผิดถ้าแบบนั้นเร็วกว่า ส่วน build server ที่ test branch ที่แยกกันอยู่เป็นสัปดาห์ ก็ให้ build สีเขียวได้โดยไม่มีการ integrate จริง ในบทความปี 2020 เรื่อง branching pattern ตัว Fowler อธิบายว่าหลายทีมใช้เครื่องมือ CI แค่ build feature branch และความหมายที่ถูกเจือจางแบบนี้ก็เป็นส่วนหนึ่งที่ทำให้บางคนพูดว่า *trunk-based development* แทน *continuous integration* ตัวเขาเองได้ยินสองคำนี้ถูกใช้แทนกันได้เสียส่วนใหญ่ และเลือกใช้คำที่เก่ากว่า

**DORA วัดอะไร** ทาง DORA จัด trunk-based development เป็นหนึ่งใน capability ของตัวเอง และบอกลักษณะของมันไว้ว่า มี active branch ใน repository ไม่เกินสามตัว merge branch เข้า trunk อย่างน้อยวันละครั้ง และไม่มี code freeze หรือช่วง integration ผลวิเคราะห์ข้อมูล survey ปี 2016 และ 2017 ของ DORA พบว่าทีมที่ทำตามแนวทางเหล่านี้มี software delivery performance และ operational performance สูงกว่า นี่เป็นความสัมพันธ์ทางสถิติที่เห็นในหลายองค์กร ไม่ใช่คำสัญญาสำหรับทีมใดทีมหนึ่ง

**งานที่ยังไม่เสร็จ merge เข้าไปแบบ dark** ถึง feature จะใช้เวลาหลายสัปดาห์ ก็ยังเข้าไปทีละชิ้นเล็ก ๆ ตัว behaviour ใหม่อยู่หลัง [feature flag](../feature-flags/) ที่ปิดไว้จนกว่าจะพร้อม เหมือน `filters.v2` ใน diagram ส่วนการ rework ก้อนใหญ่ก็ค่อย ๆ โตอยู่หลัง interface ด้วย [branch by abstraction](../branch-by-abstraction/) และการเปลี่ยน database ก็เข้าไปเป็นขั้น ๆ แบบ backward-compatible ด้วย [expand and contract](../expand-and-contract/) หลังแต่ละขั้น `main` ก็ยัง release ได้

**Release ออกจาก trunk** ทีมที่ทำ [continuous delivery](../continuous-delivery/) จะ release ตรงจาก `main` และแก้ปัญหาแบบ fix forward เหมือนที่ catalog service ทำ ส่วนทีมที่ ship ตามรอบเวลาอย่าง mobile app ของ Acme จะตัด release branch จาก `main` ไม่นานก่อน release ตัว bug ต้อง reproduce และแก้บน `main` ก่อน แล้วค่อย cherry-pick fix ไปที่ release branch ห้ามทำกลับทาง และไม่ merge อะไรกลับเลย พอ release นั้นเลิกใช้แล้วก็ลบ branch ทิ้ง หลังจาก tag commit ที่ release ไว้แล้ว

**ในระดับ scale ใหญ่** ในบทความ *Why Google Stores Billions of Lines of Code in a Single Repository* (Communications of the ACM, กรกฎาคม 2016) ของ Rachel Potvin และ Josh Levenberg ทั้งสองคนอธิบาย trunk-based development บน monolithic repository ของ Google เมื่อเดือนมกราคม 2015 repository นี้มีโค้ดราวสองพันล้านบรรทัดในไฟล์ source เก้าล้านไฟล์ ใช้ร่วมกันโดย developer มากกว่า 25,000 คน ที่ commit การเปลี่ยนแปลงราว 16,000 ครั้งในวันทำงานปกติ ขณะที่ระบบอัตโนมัติ commit อีก 24,000 ครั้ง เกือบทุกคนทำงานที่ head และแทบไม่มีใครพัฒนาบน branch ส่วน release branch จะตัดจาก revision ที่เลือกไว้ แล้วรับ fix ที่พัฒนาบน mainline และ cherry-pick เข้ามา ตัว code path ใหม่อยู่หลัง flag และทุกการเปลี่ยนแปลงต้องผ่าน review ก่อน commit แนวทางนี้ใช้ได้เพราะ Google สร้าง tooling มารองรับ: ระบบ repository ของตัวเองชื่อ Piper รวมถึงระบบสำหรับ testing, code review, static analysis และ large automated change

## ลงมือทำจริงยังไง

1. **วัดก่อนว่าตอนนี้อยู่ตรงไหน** นับจำนวน active branch และอายุของมัน จำนวนครั้งที่ merge เข้า `main` ต่อวัน เวลาที่ pull request รอ review และจำนวน code freeze ที่มี นี่คือตัววัดที่ DORA แนะนำ
2. **ปกป้อง `main` และรักษาให้เขียวไว้** บังคับให้ทุก pull request ต้องผ่าน CI และรัน CI อีกรอบบน `main` หลังทุกการ merge (branch protection rule หรือ ruleset บน GitHub, protected branch บน GitLab) ถ้า build บน `main` พัง การแก้ต้องมาก่อน: แก้ให้ได้ภายในไม่กี่นาที หรือ revert การเปลี่ยนแปลงนั้น และห้ามใคร merge ตอนที่ยังแดงอยู่
3. **ทำให้ CI เร็วและเชื่อถือได้** Fowler ย้ำแนวทางของ Extreme Programming ที่ให้ build เสร็จในสิบนาที ส่วน build ของทีม catalog ใช้ 8 นาที ให้ cache dependency ไว้ รัน test แบบขนาน ย้าย suite ที่ช้าไปไว้ใน stage หลัง ๆ ของ pipeline และแก้หรือ quarantine flaky test เพราะ build ที่ไม่มีใครเชื่อก็จะถูกเมิน
4. **ทำการเปลี่ยนแปลงให้เล็ก** engineering practices ของ Google บอกว่าราว 100 บรรทัดเป็นขนาดที่สมเหตุสมผลสำหรับการเปลี่ยนแปลงหนึ่งครั้ง และ 1,000 บรรทัดมักจะใหญ่เกินไป ให้แบ่งงานเป็น vertical slice บาง ๆ หรือเป็น stacked change และแยก refactoring ออกจากการเปลี่ยน behaviour
5. **Review ให้เสร็จในไม่กี่ชั่วโมง** guide ของ Google กำหนดให้ reviewer ตอบช้าสุดไม่เกินหนึ่งวันทำการ ส่วนเว็บ trunk-based development ตั้งเป้าไว้ที่ระดับนาที ให้หยิบ review request ขึ้นมาก่อนเริ่มงานใหม่ และ pair กันทำการเปลี่ยนแปลงที่ยาก: Fowler ชี้ว่า pair programming ก็คือ code review ที่ไม่ต้องรอเลย ส่วน *Ship / Show / Ask* (Rouan Wilsenach, 2021) ให้การเปลี่ยนแปลงบางตัว merge ก่อนแล้วค่อย review ทีหลังได้ ในจุดที่กฎด้าน compliance ของทีมยอมให้ทำ
6. **ซ่อนสิ่งที่ยังไม่เสร็จ** ให้ flag ใหม่ทุกตัวมีเจ้าของ มี task สำหรับลบ และมีวันหมดอายุ แล้วลบ flag กับ code path ที่กลายเป็น dead code ทิ้งเมื่อ feature release ครบแล้ว
7. **ตัดสินใจว่าจะ release ยังไง** จะ release จาก `main` ผ่าน deployment pipeline หรือตัด release branch อายุสั้นแล้ว cherry-pick fix จาก `main` ก็ได้ ไม่ว่าแบบไหนก็ไม่มีช่วง stabilization บน branch แยก
8. **เพิ่ม merge queue เมื่อ merge ชนกัน** ถ้ามี commit เข้ามาถี่ ๆ pull request สองตัวอาจผ่านเมื่อแยกกัน แต่ทำ `main` พังเมื่อรวมกัน ตัว merge queue จะ test แต่ละตัวกับ `main` ล่าสุดบวก pull request ที่เข้าคิวอยู่ก่อนหน้า ตัวอย่างเช่น merge queue ของ GitHub และ merge train ของ GitLab
9. **ค่อย ๆ เลิกใช้ branch อายุยาวทีละขั้น** หยุดสร้าง branch แบบนี้ตัวใหม่ ปิดงานหรือใส่ flag ให้ branch ที่เปิดค้างอยู่ ทำให้ `main` เป็น branch เดียวที่อยู่ยาว แล้วลดอายุของ branch จากหลายสัปดาห์ เหลือหลายวัน แล้วเหลือหลายชั่วโมง

## อยู่ตรงไหนใน solution

- [Continuous Delivery](../continuous-delivery/) ต้องมี mainline เดียวที่ release ได้ตลอดเวลา ตัว trunk-based development พาทุกการเปลี่ยนแปลงเข้าไปที่นั่น แล้ว deployment pipeline ก็รับช่วงต่อจากตรงนั้น
- [Feature Flags](../feature-flags/) และ [Branch by Abstraction](../branch-by-abstraction/) เป็นเทคนิคที่ทำให้การเปลี่ยนแปลงที่ยังไม่เสร็จและการเปลี่ยนแปลงก้อนใหญ่ merge ได้ทุกวัน ส่วน [Expand and Contract](../expand-and-contract/) ทำแบบเดียวกันกับ database schema หน้านี้พูดถึงว่าโค้ดถูก integrate ที่ไหนและบ่อยแค่ไหน ส่วนหน้าเหล่านั้นพูดถึงวิธีหั่นงานให้ทำแบบนั้นได้
- [Canary Release](../canary-release/) และ [Blue-Green Deployment](../blue-green-deployment/) ช่วยไม่ให้การ deploy ที่ถี่ขึ้นตามมาทำร้ายผู้ใช้
- [DORA Metrics](../dora-metrics/): การ merge เล็ก ๆ บ่อย ๆ ทำให้ lead time for changes สั้นลงและ deployment frequency สูงขึ้น และ DORA ก็ติดตาม trunk-based development ในฐานะ capability ที่ขับตัวเลขเหล่านี้
- [The Three Ways](../three-ways/): batch เล็ก ๆ ที่ไหลผ่าน mainline เดียวคือ First Way (flow) และการ build หลังทุกการ merge คือ Second Way (fast feedback)

## ใช้ตอนไหนดี

- ทีมที่เป็นเจ้าของ service และ deploy บ่อย: merge น้อยลง ได้ feedback เร็วขึ้น และมี `main` ที่ ship ได้ทุกเมื่อ
- ทีมไหนก็ตามที่กลัววัน merge หรือ freeze code ก่อน release
- Monorepo และ shared library ที่ branch อายุยาวทุกตัวทำให้ conflict ทวีคูณ

ปรับใช้ตามบริบทที่ต่างกัน:

- **ขนาดทีม** ทีมเล็กที่ทำ pair กันจะ commit ตรงเข้า `main` ก็ได้ ส่วนทีมที่ใหญ่กว่าใช้ branch อายุสั้นกับ pull request แบบที่ทีม catalog หกคนใน diagram ทำ
- **สภาพแวดล้อมที่อยู่ใต้ regulation** ที่ต้องให้คนที่สอง approve ทุกการเปลี่ยนแปลง: การบังคับ review pull request ก็ตอบโจทย์นี้ได้ ตราบใดที่ review กลับมาภายในไม่กี่ชั่วโมง
- **Legacy code ที่มี test น้อยหรือ build ช้า** ลงทุนกับ build และ test ก่อน แล้วค่อยลดอายุ branch ลงเมื่อความมั่นใจเพิ่มขึ้น
- **ซอฟต์แวร์แบบติดตั้งหรือซอฟต์แวร์ mobile** ที่มีหลาย version ใช้งานอยู่: เก็บ release branch ไว้หนึ่งตัวต่อหนึ่ง version ที่ยัง support แล้ว cherry-pick fix จาก `main`

มันไม่ค่อยเหมาะเมื่อคนที่ contribute ไม่ได้เป็นทีมเดียวกัน อย่างใน open-source project แบบดั้งเดิม: contributor ขาจรจากข้างนอกทำงานใน fork แล้วส่ง pull request ให้ maintainer ไม่กี่คน review ให้ ตัวบทความ CI ของ Fowler ก็แยกเรื่องนี้ไว้แบบเดียวกัน: continuous integration ถือว่ามีทีมที่ทำงานด้วยกันเต็มตัว ส่วน feature branch กับ pull request เหมาะกับอีกบริบทนั้นมากกว่า

## กับดักที่เจอบ่อย

- **Trunk-based แค่ในชื่อ** branch ชื่อ `main` ที่มี pull request เปิดค้างไว้เป็นสัปดาห์ก็ยังเป็น feature branching อยู่ดี ให้ติดตามอายุของ branch กับเวลารอ review และตั้งเป้าให้ merge ได้ภายในวันเดียว
- **Build ที่ช้าหรือ flaky** ถ้าใช้ 45 นาที หรือมี test ที่พังแบบสุ่ม คนก็จะเก็บการเปลี่ยนแปลงไว้รวมเป็นก้อน และเลิกเชื่อสีแดง ให้ build ใช้เวลาราวสิบนาที แก้ flaky test และรัน suite ยาว ๆ หลัง merge
- **`main` ที่แดงแล้วปล่อยไว้แดง** ทุกคน build ต่อบน mainline ที่พัง ให้ revert ภายในไม่กี่นาที แล้วค่อยแก้การเปลี่ยนแปลงนั้นบน branch ของมัน
- **Flag ที่อยู่นานเกิน release ของมัน** flag เก่าแต่ละตัวคือ branch ในโค้ดที่ไม่มีใคร test และใครก็อาจเผลอสับได้ บทความเรื่อง feature toggle ของ Pete Hodgson เล่าถึงทีมที่เพิ่ม task สำหรับลบ flag มาพร้อม release flag ใหม่ทุกตัว ตั้งวันหมดอายุ หรือจำกัดจำนวน flag ที่ระบบหนึ่งมีได้
- **Review ที่ใช้เวลาหลายวัน** pull request ที่รออยู่ก็ใหญ่ขึ้น และคนก็กลับไปทำ branch ใหญ่ ๆ เพื่อเลี่ยงการรอ ให้ review ภายในไม่กี่ชั่วโมง ทำการเปลี่ยนแปลงให้เล็ก และ pair กันทำงานที่ยาก
- **แก้บน release branch แล้ว merge กลับ** fix จะหายไป หรือเข้ามาซ้ำสองรอบ ให้แก้บน `main` ก่อน แล้วค่อย cherry-pick
- **Freeze `main` ก่อน release** การ freeze หยุดการ integrate ของทุกคนพร้อมกัน ให้ตัด release branch หรือ release จาก tag บน `main`
- **ลอก workflow แบบ open-source มาใช้ในทีมเดียว** fork กับ review แบบเฝ้าประตูมีไว้ปกป้อง maintainer จากโค้ดของคนแปลกหน้า แต่ในทีมเดียวกันมันแค่เพิ่มความล่าช้า ให้ทำงานใน repository เดียวที่ใช้ร่วมกันด้วย branch อายุสั้น
