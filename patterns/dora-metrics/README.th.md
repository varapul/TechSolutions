## ปัญหา

ถามว่าทีมเร็วขึ้นหรือเปล่า ส่วนใหญ่ก็จะได้แค่ความเห็น ตัวเลขที่มีอยู่ในมือนับแต่กิจกรรม: story point, ticket ที่ปิดไป, จำนวนบรรทัดโค้ด ตัวเลขพวกนี้ขึ้นเวลาคนยุ่ง ปั่นให้สูงได้ง่าย และไม่ได้บอกเลยว่า change ไปถึงผู้ใช้หรือเปล่า หรือพอไปถึงแล้วเกิดอะไรขึ้น ในขณะเดียวกัน delivery process เองก็ซ่อนต้นทุนของมันไว้ อย่าง release train รายเดือนก็รวบงานหลายสัปดาห์เป็น batch ใหญ่ก้อนเดียว change หนึ่งตัวเลยต้องรอเป็นวันหรือเป็นสัปดาห์กว่าจะถึง release ถัดไป ทุก release มีความเสี่ยง และพอพังก็ต้องไล่หาใน change เป็นสิบ ๆ ตัวระหว่างที่ลูกค้ารออยู่ ถ้าไม่มีตัวเลขเรื่องผลลัพธ์ที่ใช้ร่วมกัน ทีมก็บอกไม่ได้ว่า practice ใหม่ช่วยได้จริงไหม แล้วการคุยกับฝ่ายบริหารก็ยังเป็นเรื่องของความเชื่ออยู่ดี

## ทำงานยังไง

**DORA** เป็นโครงการวิจัยเรื่อง software delivery ที่ทำมายาวนาน มันเริ่มมาจาก State of DevOps report ที่ทำร่วมกับ Puppet จนถึงปี 2018 ส่วน Nicole Forsgren, Jez Humble และ Gene Kim ตั้งมันขึ้นเป็นบริษัทชื่อ DevOps Research and Assessment แล้วเขียนงานวิจัยเบื้องหลังไว้ใน *Accelerate: The Science of Lean Software and DevOps* (IT Revolution, 2018) แล้ว Google ก็ซื้อ DORA ไปในปี 2018 และตอนนี้โครงการนี้อยู่ที่ Google Cloud ส่วนในปี 2025 DORA ก็เลิกเขียนชื่อเต็มของตัวย่อ และเปลี่ยนชื่อรายงานประจำปีจาก *Accelerate State of DevOps* เป็น *State of AI-assisted Software Development*

metric ของ DORA วัดผลลัพธ์ของ delivery process สำหรับ application หรือ service ทีละตัว ชุดปัจจุบันมี metric ห้าตัวในสองกลุ่ม (นิยามจาก dora.dev เรียบเรียงใหม่):

| กลุ่ม | Metric | วัดอะไร | Acme checkout, กันยายน |
|---|---|---|---|
| Throughput | **Change lead time** | เวลาตั้งแต่ change ถูก commit เข้า version control จนรันอยู่ใน production | 26 h (median) |
| Throughput | **Deployment frequency** | จำนวน production deployment ในช่วงเวลาหนึ่ง หรือระยะห่างระหว่างแต่ละครั้ง | 20 |
| Throughput | **Failed deployment recovery time** | เวลาที่ใช้กู้คืนจาก deployment ที่ล้มเหลวและต้องมีคนเข้าไปจัดการทันที | 45 min (median) |
| Instability | **Change fail rate** | สัดส่วนของ deployment ที่ต้องมีคนเข้าไปจัดการทันทีหลัง deploy เช่น rollback หรือ hotfix | 15% (3 จาก 20) |
| Instability | **Deployment rework rate** | สัดส่วนของ deployment ที่ไม่ได้วางแผนไว้ และทำเพราะมี incident ใน production | 10% (2 จาก 20) |

ชุด metric นี้เปลี่ยนไปเรื่อย ๆ ตามปี (DORA เผยแพร่ประวัติของ metric ตัวเองไว้เมื่อมกราคม 2026) งานวิจัยปี 2014 เริ่มจากตัววัดสี่ตัว แล้วพอถึงปี 2015 ก็ลงตัวเป็นคู่ throughput กับ stability ที่ภายหลังเรียกว่า four keys ต่อมาในปี 2023 *mean time to recover* (หรือ *time to restore service*) กลายเป็น **failed deployment recovery time** ที่นับเฉพาะความล้มเหลวที่เกิดจาก change ไม่นับ outage จากภายนอก เช่น data centre ล่ม แล้วในปี 2024 DORA ก็เพิ่ม **rework rate** เข้ามา แล้วจัดทั้งห้าตัวใหม่เป็นสองปัจจัย คือ throughput กับ stability (เอกสารปัจจุบันเรียกตัวที่สองว่า instability) โดยย้าย recovery time ไปอยู่ฝั่ง throughput ทุกวันนี้เครื่องมือและบทความหลายตัวก็ยังใช้ชื่อเดิมกันอยู่

ข้อค้นพบที่ดังที่สุดคือเรื่องความสัมพันธ์ของสองกลุ่มนี้ ปีแล้วปีเล่าที่ DORA พบว่าความเร็วกับความเสถียรไม่ได้ต้องแลกกัน: สำหรับทีมส่วนใหญ่ metric พวกนี้ขยับไปด้วยกัน และทีมที่ทำได้ดีที่สุดก็ทำได้ดีในทุกตัว แต่นี่คือ correlation จากคำตอบ survey เป็นพัน ๆ ชุด ไม่ใช่กฎที่ใช้ได้กับทุกทีม ในรายงานปี 2024 กลุ่ม medium มี change fail rate ต่ำกว่ากลุ่ม high และรายงานปี 2025 ก็พบว่าการใช้ AI ตอนนี้มาพร้อมกับ throughput ที่สูงขึ้น แต่ก็ยังมาพร้อม instability ที่มากขึ้นด้วย สองกลุ่มนี้เลยต้องอ่านไปด้วยกัน

benchmark ก็เปลี่ยนเหมือนกัน จนถึงปี 2024 รายงานแต่ละปีจะแบ่งผู้ตอบออกเป็น performance cluster ในรายงานปี 2024 กลุ่ม elite (19% ของผู้ตอบ) deploy ได้ตามต้องการ มี lead time ไม่ถึงหนึ่งวัน, change fail rate 5% และกู้คืนได้ในไม่ถึงหนึ่งชั่วโมง ส่วนกลุ่ม low (25%) deploy ตั้งแต่เดือนละครั้งไปจนถึงหกเดือนครั้ง และมี change fail rate 40% รายงานปี 2025 เลิกแบ่งระดับแบบนี้ แล้วแสดงการกระจายของคำตอบในแต่ละ metric แทน (ผู้ตอบ 16.2% deploy ได้ตามต้องการ ส่วน lead time ที่เจอบ่อยที่สุดคือระหว่างหนึ่งวันถึงหนึ่งสัปดาห์ โดยมี 31.9% ตอบแบบนี้) และอธิบาย team profile เจ็ดแบบที่ได้จาก cluster analysis ที่ดู burnout, friction และ product performance ด้วย ตั้งแต่ *harmonious high-achievers* ไปจนถึง *legacy bottleneck* ตัว DORA Quick Check ที่อัปเดตเมื่อเมษายน 2026 ให้รวม rework rate ด้วย ให้คะแนน service เทียบกับข้อมูลปี 2025 แต่ DORA เองก็บอกว่าการเทียบที่มีประโยชน์ที่สุดคือเทียบ service เดิมข้ามช่วงเวลา

metric พวกนี้เป็นผลลัพธ์: มันบอกว่าเกิดอะไรขึ้น แต่ไม่ได้บอกว่าทำไม สำหรับคำถามว่าทำไม DORA มี **capability catalog** อยู่บน dora.dev เป็นรายการ capability ด้าน technical, process และวัฒนธรรมที่งานวิจัยของ DORA ผูกไว้กับ delivery และผลงานขององค์กรที่ดีขึ้น ตัวอย่างเช่น continuous integration, trunk-based development, test automation, deployment automation, loosely coupled team (architecture ที่ให้ทีมหนึ่ง test และ deploy ได้โดยไม่ต้องรอทีมอื่น), การทำงานเป็น batch เล็ก ๆ และ change approval ที่กระชับ วัฒนธรรมก็เป็นหนึ่งในนั้น DORA ใช้ typology ของวัฒนธรรมองค์กรของ Ron Westrum (2004) ที่แบ่งองค์กรตามการไหลของข้อมูลภายใน: *pathological* (ยึดอำนาจเป็นหลัก คนที่นำข่าวร้ายมาบอกจะโดนลงโทษ), *bureaucratic* (ยึดกฎเป็นหลัก คนที่นำข่าวร้ายมาบอกจะถูกเมิน) และ *generative* (ยึดผลงานเป็นหลัก คนที่นำข่าวร้ายมาบอกจะได้รับการฝึก และความล้มเหลวนำไปสู่การสืบหาสาเหตุ) ในงานวิจัยของ DORA วัฒนธรรมแบบ generative ที่คนไว้ใจกันสูงช่วยทำนายได้ว่า software delivery และผลงานขององค์กรจะดีกว่า

## ลงมือทำจริงยังไง

1. **เลือก service มาหนึ่งตัวพร้อมทีมที่เป็นเจ้าของ** metric ของ DORA ออกแบบมาให้ใช้กับ application หรือ service ทีละตัว Acme เริ่มจาก checkout โดยวัดให้ทีม checkout
2. **เขียนกติกาไว้ก่อนเริ่มเก็บข้อมูล** ตัดสินใจว่า deployment คืออะไร (สำหรับ Acme คือการ rollout service checkout ขึ้น production สำเร็จ: hotfix นับด้วย ส่วน rollback เป็นส่วนหนึ่งของการกู้คืน ไม่นับเป็น deployment), failure คืออะไร (deployment ที่ต้องมีคนเข้าไปจัดการทันที: rollback, hotfix, fix forward หรือ patch), นาฬิกาของ recovery เริ่มและหยุดเมื่อไหร่ (ตั้งแต่ deployment ที่ล้มเหลวจนถึงตอนที่ service กลับมาปกติ) และ rework คืออะไร (unplanned deployment ที่ทำเพื่อแก้ bug ที่ผู้ใช้เจอ) เครื่องมือแต่ละตัวนับรายละเอียดพวกนี้ไม่ตรงกัน: GitLab วัด time to restore เป็นเวลาที่ incident เปิดค้างอยู่ ส่วน Apache DevLake วัดตั้งแต่ deployment จบจนถึงตอนที่ incident ถูก resolve เลือกกติกามาหนึ่งแบบแล้วยึดไว้
3. **เก็บจาก systems of record ไม่ใช่ถามจากคน** deployment event แต่ละตัวจาก CI/CD มี Git SHA ที่มันพาออกไป, Git ให้เวลา commit ของทุก change ในนั้น และ incident tool บันทึกว่า deployment ไหนทำให้เกิด incident และ service กลับมาเมื่อไหร่ project open-source Four Keys ของ Google (2020, ตอนนี้ archive แล้ว) แสดงโครงให้เห็น: สามตาราง คือ *changes*, *deployments* และ *incidents* ที่ join กันด้วย commit ตัว GitLab (Ultimate tier) กับ Apache DevLake คำนวณ metric ได้สี่จากห้าตัว ทุกตัวยกเว้น rework rate จากข้อมูลของตัวเอง หรือจะใช้ SQL query ไม่กี่ตัวกับ event ที่ export ออกมาก็ได้เหมือนกัน
4. **รายงานเป็น median และดูการกระจายด้วย** lead time กับ recovery time กระจายแบบเบ้ เลยอย่าให้ change ที่ค้างอยู่ตัวเดียวมาบังภาพว่า change ส่วนใหญ่ออกไปได้ภายในวันเดียว ใช้รอบเดือนหรือรอบไตรมาสเป็นช่วงเวลา และจำไว้ว่าถ้า deployment มีน้อย เปอร์เซ็นต์จะกระโดด: พังหนึ่งครั้งใน deployment สี่ครั้งก็คือ 25%
5. **เทียบกับอดีตของตัวเอง ทีละไตรมาส** ตารางข้างล่างคือแนวโน้มของทีม checkout
6. **ปรับปรุง capability ไม่ใช่ปรับตัวเลข** หา constraint ที่ใหญ่ที่สุด (สำหรับ checkout เมื่อมกราคมคือ release train), เปลี่ยนวิธีทำงานของทีม แล้วดูว่าตัวเลขขยับตามไหม guide ของ DORA อธิบาย loop เดียวกันนี้ไว้: มี baseline, คุยกันเรื่อง friction, เลือกการปรับปรุงหนึ่งอย่างที่ทั้งทีมรับปาก แล้วตรวจผล ระหว่างทาง leading indicator ก็ช่วยได้ เช่น เวลาที่ใช้ review, flaky test หรือเวลาที่ change รอ deploy: change a91f ใช้เวลา 20 จาก 26 ชั่วโมงไปกับการรอ deploy รอบ 11:00 ของวันอังคาร การทดลองถัดไปเลยเป็นการ deploy ทันทีที่ merge
7. **Review ตัวเลขกับทีม** เอาตัวเลขห้าตัวนี้ไปไว้ใน retrospective คู่กับสิ่งที่เกิดขึ้นในไตรมาสนั้น (migration, เดือนที่ on-call หนัก) และสภาพของทีม

ไตรมาสต่าง ๆ ของทีม checkout เป็นตัวเลขของตัวอย่างนี้เอง (ไม่ใช่ผลวิจัย):

| | ก่อนหน้า (10 release ล่าสุด) | Q1 2026 | Q2 2026 | Q3 2026 |
|---|---|---|---|---|
| Deployment ต่อเดือน | 1 บวก hotfix | 3 | 8 | 20 |
| Change ต่อ deployment | ราว 40 | 15 | 6 | 2 |
| Change lead time (median) | 18 วัน | 9 วัน | 4 วัน | 26 ชั่วโมง |
| Change fail rate | 40% | 33% | 21% | 15% |
| Failed deployment recovery time (median) | 6 ชั่วโมง | 4 ชั่วโมง | 2 ชั่วโมง | 45 นาที |
| สิ่งที่ทีมเปลี่ยน | release train รายเดือน | trunk-based development และ CI | test automation | service ที่ loosely coupled, deploy รายวัน |

## อยู่ตรงไหนใน solution

- **[Continuous delivery](../continuous-delivery/)** กับ **[trunk-based development](../trunk-based-development/)** เป็น capability ที่ขยับตัวเลขพวกนี้ได้ตรงที่สุด: change เล็ก ๆ ที่ merge ทุกวัน กับ pipeline ที่ deploy ตัวไหนก็ได้ ส่วน DORA metric คือวิธีดูว่ามันได้ผลไหม
- **Release pattern ทำให้ความล้มเหลวเล็กลงและกู้คืนได้เร็วขึ้น** [canary release](../canary-release/) หรือ [blue-green deployment](../blue-green-deployment/) เปลี่ยนความล้มเหลวหลายแบบให้เป็นแค่การ rollback เร็ว ๆ ทำให้ recovery สั้นลง ส่วน [feature flags](../feature-flags/) แยกการ deploy ออกจากการ release งานที่ยังไม่เสร็จเลย ship เป็น batch เล็ก ๆ ได้
- **[SLOs and error budgets](../slo-error-budgets/)** วัดอีกเรื่องหนึ่ง: service เชื่อถือได้แค่ไหนในมุมของผู้ใช้ ส่วน metric ของ DORA วัด delivery process ของทีม ทีมหนึ่งอาจ deploy ทุกวันด้วย change fail rate ต่ำ แต่ก็ยังพลาด SLO ได้เพราะเรื่อง capacity หรือ dependency ทำให้ทีมส่วนใหญ่ดูทั้งสองอย่าง DORA เองก็ถือว่า reliability เป็น operational performance แยกจาก delivery performance
- **[Incident management](../incident-management/)** กับ **[blameless postmortems](../blameless-postmortems/)** สร้างข้อมูลที่ change fail rate กับ recovery time ต้องใช้ (incident แต่ละตัวผูกกับ deployment ที่เป็นต้นเหตุ พร้อมเวลาที่ service กลับมา) และ postmortem ก็อธิบายสิ่งที่ตัวเลขอธิบายไม่ได้
- **[The Three Ways](../three-ways/)** อธิบาย DevOps ว่าเป็น flow, feedback และการเรียนรู้ไม่หยุด metric กลุ่ม throughput วัด flow ส่วน metric กลุ่ม instability วัดสิ่งที่ย้อนกลับมา
- ถ้าใช้ **[GitOps](../gitops/)** deploy log ก็มีอยู่แล้ว: ประวัติของ environment repository กับ sync event ของ controller
- framework อื่นครอบคลุมสิ่งที่ metric พวกนี้ไม่ได้ดู SPACE (Forsgren, Storey และคณะ, ACM Queue, 2021) ดู developer productivity ในหลายมิติ ทั้ง satisfaction และ well-being, performance, activity, communication และ collaboration, efficiency และ flow แล้วบอกว่าไม่มีตัวเลขตัวเดียวที่จับมันได้ครบ ส่วน DevEx (Noda, Storey, Forsgren และ Greiler, ACM Queue, 2023) เน้นที่ประสบการณ์ทำงานของ developer ผ่าน feedback loop, cognitive load และ flow state คำแนะนำของ DORA เองคือให้เลือก framework ที่เข้ากับการตัดสินใจที่ต้องทำ และใช้หลาย framework ร่วมกันถ้าตัวเดียวตอบคำถามไม่ได้

## ใช้ตอนไหนดี

- **ทีมที่เป็นเจ้าของ service และ deploy ผ่าน pipeline ที่ตัวเองคุมได้** ข้อมูลมีอยู่แล้วใน Git, CI/CD และ incident tool พอตั้งกติกาเสร็จ ตัวเลขก็แทบไม่มีต้นทุน และมันเปลี่ยนการเถียงกันเรื่องความเร็วให้กลายเป็น baseline ที่ใช้ร่วมกัน
- **ก่อนและหลังเปลี่ยนวิธีทำงาน** เลิก release train, หันมาใช้ trunk-based development หรือแยก monolith: metric จะบอกว่า delivery ดีขึ้นจริงไหม และต้องแลกด้วยความเสถียรหรือเปล่า
- **มีประโยชน์น้อยลงถ้า deploy น้อยมาก** service ที่เปลี่ยนแค่ไม่กี่ครั้งต่อปีให้เปอร์เซ็นต์ที่กระโดดทุกครั้งที่พัง ให้ดู lead time และดูความล้มเหลวทีละครั้งแทน
- **ปรับใช้เมื่อคุม release เองไม่ได้** mobile app ต้องผ่าน store review และ staged rollout, software แบบ on-premises และ embedded ship ตามตารางของลูกค้า และ change ที่มีกฎระเบียบคุมอาจต้องมี approval ในเคสแบบนี้ให้วัดจนถึงตอนที่ release ถึงผู้ใช้, เก็บเวลารอ approval ไว้ใน lead time ให้ทุกคนเห็น (การทำ change approval ให้กระชับก็เป็น capability หนึ่งของ DORA) และเทียบ service แบบนี้กับอดีตของตัวเองเท่านั้น
- **ไม่คุ้มที่จะเริ่มด้วย integration project ตั้งแต่แรก** guide ของ DORA เตือนไม่ให้ลงแรงกับการวัดให้แม่นมากกว่าการปรับปรุง: แค่คุยกันในทีมหรือทำ Quick Check ก็ได้ baseline แรกแล้ว ส่วน automation ค่อยตามมาทีหลังได้

## กับดักที่เจอบ่อย

- **เปลี่ยน metric ให้เป็นเป้า** เป้าที่ผูกกับตัวเลขชวนให้คนขยับตัวเลขแทนที่จะขยับงาน (Goodhart's law): change ถูกแยกเป็น deployment เพิ่ม, failure ถูกบันทึกเป็น maintenance, fix ถูกรีบปล่อยออกไปเพื่อดันตัวเลข guide ของ DORA ยกคำสั่งแบบเหมารวม ว่าทุก application ต้อง deploy หลายครั้งต่อวันภายในสิ้นปี เป็นตัวอย่างของเป้าที่ชวนให้เล่นตัวเลข ให้ใช้ metric หา constraint ตัวถัดไป ตั้งเป้าที่ capability และอ่านทั้งห้าตัวไปด้วยกัน: deployment frequency เพิ่มเป็นสองเท่าแต่ lead time ไม่ขยับเลย แบบใน step 4 นี่แหละคือสัญญาณ
- **จัดอันดับทีมเทียบกัน** metric พวกนี้อธิบาย delivery ของ service ตัวเดียว และแต่ละ service ก็ต่างกัน: mobile app ของ Acme ต้อง ship ผ่าน app store review ทำให้การ deploy 2 ครั้งต่อเดือนของมันไม่ได้บอกอะไรแย่ ๆ เกี่ยวกับทีม mobile เลย ให้เทียบแต่ละ service กับอดีตของตัวเอง และแชร์สิ่งที่ได้ผลแทนการประกาศ leaderboard
- **วัดเป็นรายคน** deployment กับ incident เป็นของระบบของทีม ไม่ใช่ของ engineer คนใดคนหนึ่ง การนับรายคนให้รางวัลกับการแตกงานและการหลบ fix ที่เสี่ยง และกัดกร่อนความไว้ใจที่วัฒนธรรมแบบ generative ต้องพึ่ง ให้เก็บ metric ไว้ที่ระดับทีมและระดับ service
- **metric ตัวเดียวคุมทุกอย่าง** ดูแค่ deployment frequency ก็ให้รางวัลกับการแตก deploy ส่วนดูแค่ change fail rate ก็ให้รางวัลกับการ deploy น้อยลง guide ของ DORA แนะนำให้ใช้ตัววัดหลายตัวที่ดึงกันเองอยู่บ้าง และห้าตัวนี้ก็ให้แบบนั้นพอดี
- **วัดแต่ไม่ลงมือทำ** dashboard ที่ไม่มีใครคุยถึงก็ไม่เปลี่ยนอะไร review ตัวเลขใน retrospective รับปากการปรับปรุงหนึ่งอย่าง แล้วตรวจอีกรอบในไตรมาสหน้า
- **อ่านตัวเลขโดยไม่ดูบริบท** ไตรมาสที่หมดไปกับ database migration, การหยุดรับคนเพิ่ม หรือโดน page กลางคืนติด ๆ กัน จะสะท้อนออกมาในตัวเลข ให้อ่านคู่กับงานที่ทำและสภาพของทีม (survey ของ DORA เองก็วัด burnout ไปพร้อมกับ delivery) dashboard ที่ดูดีแต่ทีมหมดแรงไม่ใช่ความสำเร็จ
- **เปลี่ยนกติกากลางทาง** ถ้านิยามของ deployment หรือ failure เปลี่ยนไประหว่างไตรมาส แนวโน้มก็ไม่มีความหมาย เก็บนิยามไว้ใน version control คู่กับ query ที่ใช้มัน
- **อ้างอุตสาหกรรมเป็นข้ออ้าง** สภาพแวดล้อมที่มีกฎระเบียบคุมและระบบ legacy ทำให้ตัวเลขบางตัวขยับยากกว่า แต่ guide ของ DORA บอกว่า metric พวกนี้ใช้ได้กับระบบทุกแบบ รวมถึง mainframe ด้วย ให้เริ่มจากขั้นที่ช้าที่สุดที่ทีมคุมได้
