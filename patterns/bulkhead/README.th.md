## ปัญหา

service ที่เรียกหลาย dependency มักจ่ายค่าการเรียกทั้งหมดจาก budget ก้อนเดียวที่ใช้ร่วมกัน: pool ของ request thread, connection pool, เพดานจำนวน socket ที่เปิดได้ หรือแค่ memory แล้วตราบใดที่ทุก dependency ตอบเร็ว ก็ไม่มีใครสังเกตเรื่องการใช้ร่วมกันนี้ เพราะการเรียกแต่ละครั้งยืม budget ไปนิดเดียวในเวลาสั้นมาก ๆ

ปัญหาเริ่มตอนที่ dependency ตัวหนึ่ง**ช้าแทนที่จะ fail** การเรียกที่ fail จะคืน thread ทันที แต่การเรียกที่ค้างจะถือมันไว้ จำนวนการเรียกที่ in flight เท่ากับอัตราที่การเรียกเข้ามาคูณเวลาที่แต่ละการเรียกใช้ (Little's law) ทำให้ dependency ที่รับ 10 การเรียกต่อวินาทีแล้วตอบใน 0.1 s กิน worker ราว ๆ หนึ่งตัว แต่ traffic เท่าเดิมจะต้องใช้ 300 worker ทันทีที่คำตอบใช้เวลา 30 s ก่อนจะถึงจุดนั้นนานแล้ว pool ที่ใช้ร่วมกันก็เต็มไปด้วย request ที่รอ dependency ตัวเดียวนั้น request อื่นทั้งหมดต้องต่อคิวอยู่ข้างหลังแล้ว timeout ไป รวมถึงตัวที่ไม่เคยแตะ dependency นั้นเลยด้วย ใน animation แผง recommendations ที่หน้าเว็บไม่มีก็ได้ ทำให้ทั้ง browse และ checkout หยุด ทั้งที่ Catalog กับ Payments ปกติดีตลอดเวลา แต่ก็ไม่เหลืออะไรไว้ใช้เรียกพวกมันแล้ว

SRE book ของ Google อธิบายห่วงโซ่เดียวกันนี้ว่าเป็นเส้นทางคลาสสิกที่พาไปสู่ cascading failure: response ที่ช้าลงแปลว่ามี request in flight มากขึ้น thread หมด health check ไม่ถูกตอบ และโหลดของ server ที่ยอมแพ้ไปก็ไปตกอยู่กับตัวที่ยังเหลืออยู่

animation ใช้ 12 slot เพื่อให้นับได้ ส่วน pool จริงใหญ่กว่านั้น (connector ของ Tomcat ยอมให้มี request thread ได้ถึง 200 ตัวโดย default) แต่นั่นก็แค่เลื่อนจังหวะที่มันเต็มออกไป

## ทำงานยังไง

bulkhead จำกัดว่า**งานแต่ละประเภทถือทรัพยากรที่ใช้ร่วมกันได้มากแค่ไหนในเวลาเดียวกัน** ชื่อนี้มาจากผนังกันน้ำที่แบ่งตัวเรือเป็นห้อง ๆ: ถ้าเรือรั่ว น้ำจะท่วมแค่ห้องเดียวและเรือก็ยังลอยอยู่ Michael Nygard อธิบายมันไว้ว่าเป็น stability pattern สำหรับซอฟต์แวร์ในหนังสือ *Release It!* คู่กับ timeout และ circuit breaker ส่วน slot ใน animation แทนอะไรก็ตามที่มีจำกัด: worker thread, connection ใน pool หรือ permit ของ semaphore

ในรูปแบบที่เจอบ่อยที่สุด dependency แต่ละตัวจะได้ห้องที่จำกัดขนาดไว้เป็นของตัวเอง ใน animation ตัว worker 12 ตัวถูกแบ่งเป็น 5 สำหรับ Catalog, 5 สำหรับ Payments และ 2 สำหรับ Recommendations พอ Recommendations ค้าง สอง slot ของมันก็เต็มแล้วเต็มค้างอยู่อย่างนั้น การเรียกครั้งที่สามไม่ต้องรอ: มันโดนปฏิเสธทันที หน้าเว็บ render ได้โดยไม่มีแผงนั้น และอีกสิบ slot ไม่รู้สึกอะไรเลย failure ยังเกิดขึ้นอยู่ แต่มันใหญ่แค่เท่ากับ feature ที่พัง

**สองวิธีสร้างห้อง**

| | Thread-pool isolation | Semaphore (concurrency limit) isolation |
|---|---|---|
| กลไก | การเรียกถูกส่งต่อให้ pool เล็ก ๆ ของ thread ที่กันไว้ให้ dependency นั้น โดยมี queue สั้น ๆ อยู่ด้านหน้าหรือไม่มีเลย | การเรียกรันบน thread ของผู้เรียกเองหลังได้ permit หนึ่งใน *n* อัน |
| การเรียกที่ค้างจะถือ | thread ของ pool ของ dependency นั้น ผู้เรียกเลิกรอแล้วไปทำอย่างอื่นต่อได้ | thread ของผู้เรียก จนกว่า timeout ของ client เองจะทำงาน |
| ต้นทุน | thread ที่เพิ่มขึ้น การส่งต่องาน และ context switch ต่อการเรียก อะไรก็ตามที่อยู่ใน thread-local (trace และ log context, security context, transaction) ต้องถูกส่งข้ามไปด้วย | counter หนึ่งตัว ไม่มีการส่งต่องานและไม่มีอะไรถูกกันไว้ |
| เหมาะกับ | blocking client ที่คุณไม่ไว้ใจ timeout ของมัน | การเรียกที่เร็ว โค้ดแบบ non-blocking และ reactive, virtual thread |

Hystrix ใช้ thread pool เป็น default และเผยแพร่ตัวเลขว่ามันมีต้นทุนเท่าไหร่: สำหรับ command ตัวหนึ่งที่ถูกเรียก 60 ครั้งต่อวินาที ที่ median วัดไม่เห็นอะไร ที่ percentile 90 คือ 3 ms และที่ percentile 99 คือ 9 ms มันเก็บ semaphore ไว้ใช้กับการเรียกที่ถี่มาก หรือเร็วมาก จน overhead นี้มีผล library รุ่นใหม่ ๆ กลับ default: ใน Resilience4j และ MicroProfile Fault Tolerance ตัว bulkhead เป็น semaphore เว้นแต่จะขอ thread pool

มีความต่างข้อหนึ่งที่มองข้ามได้ง่าย thread pool **จองไว้**: thread ของมันมีไว้ให้ dependency นั้นเท่านั้น อย่างอื่นใช้ไม่ได้ ส่วน semaphore แค่**จำกัดเพดาน**: permit ของมันถูกนับเทียบกับ thread ที่ผู้เรียกทุกคนใช้ร่วมกัน limit ของ semaphore จะแยกได้จริงก็ต่อเมื่อผลรวมของมันน้อยกว่า pool ที่ใช้ร่วมกัน ถ้าผลรวมมากกว่านั้น dependency ที่ช้าหลายตัวรวมกันก็ยังทำให้ pool เต็มได้

**การกำหนดขนาด** ห้องหนึ่งต้องรับการเรียกที่ in flight ตอน peak ได้ บวกส่วนเผื่ออีกนิด:

> slot ≈ จำนวนการเรียกต่อวินาทีตอน peak × latency เป็นวินาที + ส่วนเผื่อ

| ห้อง | อัตราตอน peak | Latency | การเรียกที่ in flight | Slot |
|---|---|---|---|---|
| Catalog | 40 ต่อวินาที | 0.1 s | 4 | 5 |
| Payments | 8 ต่อวินาที | 0.5 s | 4 | 5 |
| Recommendations | 10 ต่อวินาที | 0.1 s | 1 | 2 |

นี่คือตัวเลขของ animation ที่เลือกมาให้สามห้องรวมกันได้ 12 เท่าเดิม สำหรับ latency ให้ใช้ percentile สูง ๆ ของ dependency ตอนที่ยังปกติ ไม่ใช่ค่าเฉลี่ย เอกสารของ Hystrix ก็วางกฎไว้แบบเดียวกัน (อัตรา request ตอน peak ของ dependency ที่ปกติ × latency ที่ percentile 99 ของมัน บวกส่วนเผื่ออีกนิด) และให้เหตุผลว่าทำไมควรตั้งไว้เล็ก: limit นี้คือสิ่งที่ทิ้งโหลดออกเมื่อ latency พุ่งขึ้น คู่มือของ AWS Lambda ประเมิน concurrency ที่ function ต้องใช้ด้วยผลคูณแบบเดียวกัน แต่ที่นั่นใช้ค่าเฉลี่ย

จากนั้นให้เช็กผลกับค่าที่วัดได้จริง เพราะการเรียกมาเป็นช่วง ๆ เลข 4 ในแถวของ Catalog เป็นตัวเลขแบบมองโลกในแง่ร้าย: การเรียกส่วนใหญ่เร็วกว่า percentile ที่ใช้คำนวณมาก ค่าเฉลี่ยของจำนวนที่ in flight เลยต่ำกว่านั้นเยอะ ส่วนเผื่อนี้จำเป็น ถ้าการเรียกมาแบบสุ่มและมี in flight อยู่ 4 ตัว*โดยเฉลี่ย* ห้องขนาดห้าจะปฏิเสธการเรียกราว ๆ หนึ่งในห้า ทั้งที่ไม่มีอะไรผิดปกติเลย การใช้งานสูงสุดของห้องและตัวนับการปฏิเสธภายใต้ traffic จริงจะบอกได้ว่าส่วนเผื่อพอหรือเปล่า

**ทำอะไรกับส่วนที่ล้น** ห้องที่เต็มตอบได้สามแบบ:

- **ปฏิเสธทันที** ผู้เรียกได้ error ทันที (`BulkheadFullException` ใน Resilience4j) แล้วตัดสินใจเองว่าจะทำอะไร วิธีนี้คุม latency ให้มีขอบเขต และเป็น default ที่ถูกต้องสำหรับ traffic แบบ interactive
- **ต่อคิวสั้น ๆ** เวลารอสูงสุดสั้น ๆ หรือ queue เล็ก ๆ ที่มีขอบเขต ช่วยรับ burst ได้ แลกกับ latency ที่เพิ่มขึ้นนิดหน่อย ให้สั้นไว้: ทุกตัวที่รออยู่ก็ถือบางอย่างไว้เหมือนกัน (ใน semaphore bulkhead คือ thread ของตัวเอง) queue ที่ยาวเลยสร้างปัญหาเดิมขึ้นมาใหม่ในระดับที่สูงขึ้นไปอีกขั้น สำหรับ traffic ที่สม่ำเสมอ หลักง่าย ๆ ของ SRE book สำหรับ queue หน้า thread pool คือครึ่งหนึ่งของขนาด pool หรือน้อยกว่า
- **Fall back** นี่คือสิ่งที่ user ได้หลังโดนปฏิเสธ: ข้อมูลจาก cache หรือค่า default หรือหน้าเว็บที่ไม่มีแผงนั้น ถ้าไม่มี fallback ตัว bulkhead ก็แค่เปลี่ยน failure ที่ช้าให้กลายเป็น failure ที่เร็ว

**แบ่งตามอะไร** diagram แบ่งตาม dependency วิธีนี้ปกป้องผู้เรียกจาก downstream ที่ช้าตัวเดียว แต่ limit แบบเดียวกันใช้ key อื่นได้:

- **ตาม tenant หรือ client** เพื่อไม่ให้ burst ของ customer รายเดียวยึด worker ไปหมด SRE book แนะนำให้จำกัดสัดส่วน thread ของ server ที่ client รายใดรายหนึ่งถือได้ โดยยกตัวอย่างไว้ที่หนึ่งในสี่
- **ตาม priority** เพื่อไม่ให้งาน batch หรือ reporting เบียดงาน checkout ออกไป คำอธิบาย pattern นี้ของ Azure แยก consumer ที่ critical ออกจาก consumer ทั่วไปด้วยวิธีนี้
- **ตาม endpoint หรือ operation** เพื่อให้ export หรือ search ที่ช้ามี limit เล็ก ๆ ของตัวเอง และไม่แย่งทรัพยากรจนการเรียกที่ถูก ๆ อดตาย

ให้เลือก key ตามแนวที่ failure เกิดขึ้นจริง และให้จำนวนห้องน้อยพอที่แต่ละห้องจะยังใหญ่พอรับ burst ปกติได้

**แนวคิดเดียวกันในระดับอื่น** slot ใน pool คือ bulkhead ที่เล็กที่สุด ตัวที่ใหญ่กว่าก็ใช้เหตุผลแบบเดียวกัน:

- **Connection pool:** pool แยกต่อ dependency หรือต่อ workload แทนที่จะมี pool เดียวสำหรับทุกอย่าง
- **Queue:** queue แยกที่มี consumer ของตัวเอง เพื่อไม่ให้ message ที่ค้างของประเภทหนึ่งไปถ่วงประเภทอื่น
- **Process และ container:** service แต่ละตัวอยู่ใน container ของตัวเองที่มี CPU limit และ memory limit ตัว Kubernetes บังคับ CPU limit ด้วยการ throttle และบังคับ memory limit ด้วยการ kill แบบ out-of-memory
- **Node pool:** node เฉพาะสำหรับ workload หรือ tenant เดียว แยกออกมาด้วย taint และ toleration
- **Instance ต่อ consumer:** deployment แยกของ service ตัวเดียวกัน สำหรับผู้เรียกคนละกลุ่ม
- **Cell:** สำเนาเต็มของทั้ง stack แต่ละชุดรับ customer กลุ่มย่อยที่ตายตัวอยู่หลัง router บาง ๆ เพื่อให้ deployment ที่พังหรือ request ที่เป็นพิษอยู่แค่ใน cell เดียว AWS Well-Architected Framework ลิสต์เรื่องนี้ไว้เป็น reliability best practice ในชื่อ bulkhead architecture ส่วน shuffle sharding ตามที่ Amazon Builders' Library อธิบาย ก็ขัดเกลามันขึ้นไปอีก ถ้ามี worker แปดตัวแบ่งเป็นสี่คู่ตายตัว tenant ที่มีปัญหาหนึ่งรายจะทำให้ customer หนึ่งในสี่ล่มไปด้วย แต่ถ้าให้ customer แต่ละรายได้คู่ของตัวเองจาก 28 คู่ที่เป็นไปได้ tenant รายนั้นจะทับซ้อนเต็ม ๆ กับ customer แค่หนึ่งใน 28 ราย
- **Zone และ region:** ห้องที่ใหญ่ที่สุดที่ cloud provider มีให้

**ต่างจากเพื่อนบ้านยังไง** rate limit นับ request ต่อหน่วยเวลา และ dependency ที่ช้าไม่ได้เปลี่ยนอัตรา request ตัว rate limiter เลยไม่เห็นว่ามีอะไรผิด ส่วน circuit breaker ตอบสนองต่อผลลัพธ์: failure หรือการเรียกที่ช้าต้องสะสมก่อนมันถึงจะ open แต่ bulkhead นับการเรียกที่ in flight และนี่ก็คือตัวเลขที่โตขึ้นพอดีตอน latency โต และมันลงมือตั้งแต่การเรียกตัวแรกที่เกิน limit

## ใช้ตอนไหนดี

- service เรียกหลาย dependency ที่สำคัญไม่เท่ากันผ่าน thread หรือ connection ที่ใช้ร่วมกัน อย่างน้อยก็ให้ตัวที่ไม่จำเป็น (recommendations, rating, โฆษณา, analytics) มีห้องของตัวเอง
- หลาย tenant หรือ client ใช้ worker ชุดเดียวกัน และต้องไม่ให้รายใดรายหนึ่งแย่งจนรายอื่นอดได้
- งาน interactive กับงาน batch หรือ endpoint ที่ถูกกับที่แพง รันอยู่ใน process เดียวกัน
- client library ที่ block และไม่มี timeout หรือมีแต่ไว้ใจไม่ได้ thread-pool isolation คือแบบที่ยังให้ผู้เรียกเดินจากไปได้

ไม่ควรใช้เมื่อ:

- **ไม่มีอะไรให้แยก** ถ้าทุก request ต้องใช้ dependency ตัวเดียวกันตัวเดียว ห้องของมันก็ไม่ได้ปกป้องใคร ให้ใช้ timeout แล้วทิ้งโหลดแทน
- **pool เล็กเกินกว่าจะแบ่ง** สิบสอง slot ในสามห้องเป็นแค่ภาพประกอบ การแบ่ง pool เล็ก ๆ เป็นหลายห้องทำให้แต่ละห้องเล็กเกินกว่าจะรับ burst ปกติได้ แล้ว traffic ที่ปกติดีก็โดนปฏิเสธ
- **งานรอได้** ถ้าผู้เรียกไม่ต้องการคำตอบตอนนี้ ก็เอางานไปใส่ queue ([Queue-Based Load Leveling](../queue-based-load-leveling/)) แล้วทำทีหลัง แทนที่จะปฏิเสธ
- **จ่ายค่า capacity ที่ว่างไม่ไหว** หรือ configuration ที่เพิ่มขึ้นไม่คุ้มกับความเสี่ยง แนวทางของ Azure ระบุทั้งสองข้อนี้ว่าเป็นเหตุผลที่ไม่ใช้ pattern นี้

## ได้อะไร เสียอะไร

- **capacity ที่จองไว้นั่งว่าง** ห้าช่องของ Catalog ช่วยอะไรไม่ได้ตอน Payments มี burst และ capacity ที่แบ่งห้องแล้วต้องรวมกันได้มากกว่าที่ pool ร่วมจะต้องใช้ และบางส่วนก็ไม่ได้ใช้อยู่เสมอ บาง platform บรรเทาเรื่องนี้ด้วยการให้ยืม: API server ของ Kubernetes ยอมให้ priority level ที่ยุ่งอยู่ยืม concurrency ที่ level อื่นไม่ได้ใช้
- **มีค่าที่ต้องตั้งมากขึ้น และมันเก่าลง** limit ทุกตัวเป็นการเดาที่คลาดไปเรื่อย ๆ เมื่อ traffic และ latency เปลี่ยน เล็กไปก็ปฏิเสธการเรียกที่ปกติ ใหญ่ไปห้องก็ไม่ได้ปกป้องอะไร นี่คือเหตุผลที่ Netflix เลิกใช้ขนาด pool ตายตัวของ Hystrix แล้วหันไปใช้ concurrency limit ที่ปรับตาม latency ที่วัดได้ และเป็นเหตุผลที่ Envoy มี adaptive concurrency filter อยู่ข้าง ๆ static limit
- **มันจำกัด concurrency ไม่ได้จำกัด latency** การเรียกสองตัวที่ค้างก็ยังค้างอยู่ ถ้าไม่มี timeout ห้องก็จะเต็มไปตลอดเวลาที่ dependency ยังช้า และ queue ที่อยู่หน้าห้องก็เพิ่มเวลารอของมันเองเข้าไปอีก
- **การปฏิเสธคือ error ที่ต้องมีคนจัดการ** ทุกการเรียกที่ถูกป้องกันต้องมี fallback หรือ error ที่บอกตามจริง และผู้เรียกต้องไม่ตอบการปฏิเสธด้วยการ retry ทันที
- **limit เป็นแบบต่อ instance** ตั้ง limit ไว้ 2 บน 20 instance ก็ยังยอมให้มีการเรียกไปที่ dependency พร้อมกันได้ 40 ตัว และการ scale out ฝั่งผู้เรียกก็ดันตัวเลขนี้ขึ้นไปอีก bulkhead ปกป้องผู้เรียก ถ้าจะปกป้อง dependency ต้องมี limit ที่บังคับใช้ตรงจุดที่ผู้เรียกทุกตัวมาเจอกัน: ในตัว dependency เอง หรือใน proxy ที่อยู่หน้ามัน
- **thread pool กิน thread และ context** ยิ่งมี pool มาก ก็ยิ่งมี thread มาก มี context switch มาก และมีจุดที่ trace ID หรือ security context จะหล่นหายมากขึ้น

## ข้อควรรู้ตอนลงมือทำ

- **timeout ต้องมาก่อน** ทุกการเรียกในห้องต้องมี timeout ที่สั้นกว่าความอดทนของผู้เรียกมัน (Timeout & Fallback) ตัว timeout กำหนดว่า slot จะกลับมาเร็วแค่ไหน ส่วน bulkhead กำหนดว่าระหว่างนั้นจะเสีย slot ไปได้กี่ช่อง Hystrix มาพร้อม default คือ timeout 1 วินาที และ pool ขนาด 10 thread
- **ระวังลำดับของ wrapper** ตัว Spring integration ของ Resilience4j ซ้อนพวกมันไว้แบบนี้โดย default: Retry ( CircuitBreaker ( RateLimiter ( TimeLimiter ( Bulkhead ( call ) ) ) ) ) ตัว bulkhead อยู่ในสุด retry แต่ละครั้งเลยต้องขอ permit ใหม่ และการปฏิเสธก็ผ่าน circuit breaker ตอนวิ่งออกมา ให้ตัดสินใจให้ชัดว่าห้องเต็มนับเป็น failure ที่ breaker หรือเปล่า [Circuit Breaker](../circuit-breaker/) ที่ open หลัง timeout ซ้ำ ๆ ช่วยไม่ให้แม้แต่สอง slot นั้นเสียไปเปล่า ๆ และคอยลองเช็กว่าฟื้นแล้วหรือยัง การ retry การเรียกที่โดนปฏิเสธควร back off หรือไม่ทำเลย ([Retry with Backoff & Jitter](../retry-with-backoff/)) ส่วน [rate limit](../rate-limiting/) ที่ทางเข้าช่วยกันไม่ให้ client รายเดียวยิงจนห้องเต็มด้วยปริมาณล้วน ๆ
- **Resilience4j (Java)** ที่ version 2.4.0 ณ เดือนตุลาคม 2026 ตัว `Bulkhead` แบบ semaphore มี `maxConcurrentCalls` (default 25) และ `maxWaitDuration` (default 0 คือปฏิเสธทันที) ส่วน `ThreadPoolBulkhead` วาง queue ที่มีขอบเขต (`queueCapacity` default 100) ไว้หน้า pool ขนาดตายตัวที่คิดจากจำนวน processor และส่ง context ที่อยู่ใน thread-local ข้ามไปได้ด้วย `ContextPropagator` ถ้าใช้ annotation ตัว semaphore คือ default และ `@Bulkhead(type = Bulkhead.Type.THREADPOOL)` ใช้เลือก pool สำหรับ method ที่คืน `CompletableFuture` ฝั่ง Micrometer ได้ gauge ของจำนวน concurrent call ที่ยังว่างและจำนวนสูงสุด และทุกการปฏิเสธจะถูก publish เป็น event
- **Library อื่น** Polly v8 (.NET) เปลี่ยนจาก Bulkhead policy ไปเป็น concurrency limiter คือ `AddConcurrencyLimiter(permitLimit, queueLimit)` ที่สร้างบน `System.Threading.RateLimiting` ส่วน MicroProfile Fault Tolerance มี `@Bulkhead`: ใช้เดี่ยว ๆ เป็น semaphore แต่ถ้าใช้คู่กับ `@Asynchronous` จะเป็น thread pool ที่มี waiting queue และ cockatiel มี `bulkhead(limit, queue)` ให้ใช้กับ Node.js
- **Hystrix** คือที่ที่หลายทีมรู้จัก pattern นี้เป็นครั้งแรก และ wiki ของมันก็ยังอธิบายเรื่อง thread pool เทียบกับ semaphore ได้ชัดที่สุด แต่ตัว library อยู่ใน maintenance mode ตั้งแต่ release สุดท้ายคือ 1.5.18 ในเดือนพฤศจิกายน 2018 และ README ของมันก็บอกว่า Netflix ใช้ Resilience4j กับ project ใหม่ อย่าเริ่มจากมัน
- **ใน service proxy** สิ่งที่ Envoy เรียกว่า circuit breaking ก็คือ bulkhead ชุดหนึ่ง: เพดานของ connection, pending request และ active request ที่ไปหา upstream cluster แยกต่อ cluster และต่อ priority ค่า default คือตัวละ 1,024 มากเกินกว่าที่ service เล็ก ๆ จะยอมให้ค้างได้ไหวไปเยอะ เลยต้องตั้งเอง ส่วน request ที่ล้นจะ fail fast พร้อม header `x-envoy-overloaded` และถูกนับใน `upstream_rq_pending_overflow` (เพดานของ pending) และตั้งแต่ Envoy 1.38 ก็นับใน `upstream_rq_active_overflow` ด้วย (เพดานของ active request ที่ version เก่านับรวมไว้ในตัวแรก) ส่วน limit พวกนี้ใช้ร่วมกันระหว่าง worker thread แบบคร่าว ๆ เท่านั้น Istio เปิดค่าเดียวกันนี้ให้ตั้งเป็น `connectionPool` ใน `DestinationRule` (`tcp.maxConnections`, `http.http1MaxPendingRequests`, `http.http2MaxRequests`) และทุกค่าก็แทบไม่มีเพดานจนกว่าจะตั้ง ดู [Service Mesh](../service-mesh/)
- **Event loop และ asynchronous runtime** ใน Node.js, asyncio, Go หรือ reactive Java ตัว dependency ที่ช้าไม่ได้ block thread ไหน เลยไม่มี pool ไหนเต็มให้เห็น แต่การเรียกที่ค้างอยู่ก็ยังถือ memory, socket และส่วนแบ่ง capacity ของ dependency ไว้ แล้ว failure ก็มาในรูป memory ที่โตขึ้น socket ที่หมด หรือ timeout ไปทั่ว bulkhead เลยกลายเป็น counter: semaphore (`asyncio.Semaphore` ใน Python, `golang.org/x/sync/semaphore` หรือ buffered channel ใน Go) หรือ connection limit ต่อ host (`http.Agent` ของ Node ยอมให้มี socket ไม่จำกัดต่อ origin จนกว่าจะตั้ง `maxSockets`) ส่วน virtual thread ของ Java ก็เหมือนกัน: JEP 444 บอกว่าอย่าเอามันไปทำ pool และให้ใช้ semaphore เฝ้าทรัพยากรที่มีจำกัดแทน
- **บน platform** ตัว reserved concurrency ของ AWS Lambda เป็น bulkhead ทั้งสองทาง: มันรับประกันส่วนแบ่ง concurrency ของ account ให้ function และจำกัดเพดานไว้ที่นั่นด้วย โดยไม่มีค่าใช้จ่ายเพิ่ม ส่วน resource limit ของ Kubernetes, dedicated node pool และ API Priority and Fairness ของ API server เอง (stable ตั้งแต่ v1.29) ก็ใช้ pattern นี้กับ CPU, memory, node และ API request
- **วัดทุกห้อง** export จำนวน slot ที่ใช้อยู่เทียบกับ limit เป็น gauge และการปฏิเสธกับ timeout เป็น counter แยกต่อห้อง ตั้ง alert เมื่อห้องเต็มค้างอยู่ และเมื่อมีการปฏิเสธแม้แต่ครั้งเดียวในห้องที่ critical ห้องที่ไม่เคยเข้าใกล้ limit เลยก็ลดขนาดลงได้
- **เอา health check ไว้ข้างนอก** readiness probe ที่ต้องรอ slot ในห้องที่เต็ม หรือที่รายงานว่า instance ไม่ healthy เพราะ dependency ที่ไม่จำเป็นช้า จะเปลี่ยน failure ที่ถูกกักไว้แล้วให้กลับมาเป็น outage ([Health Endpoint Monitoring](../health-endpoint-monitoring/))
- **ทดสอบตอนพัง ไม่ใช่ทดสอบแค่ตอนทุกอย่างราบรื่น** ใส่ latency ให้ dependency ตัวหนึ่งระหว่างมีโหลด แล้วเช็กว่าตัวอื่นยังรักษา response time ไว้ได้ bulkhead ที่ไม่เคยเต็มเลยก็คือ bulkhead ที่ไม่เคยถูกทดสอบ
