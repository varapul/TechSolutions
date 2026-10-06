## ปัญหา

remote call ไม่ได้ fail เสมอไปเวลามีอะไรผิดปกติ หลายครั้งมันแค่ไม่ตอบ: dependency รับโหลดเกิน มีคนถือ lock อยู่ packet หล่นหาย หรือเครื่องปลายทางหายไปเฉย ๆ โดยไม่ได้ปิด connection ผู้เรียกที่ไม่ได้ตั้งเวลาจำกัดไว้ก็จะรอไปนานเท่าที่ dependency ค้าง และ operating system ก็ไม่ได้รีบจบการรอนั้นเลย ถ้าใช้ค่า default ของ Linux ข้อมูลที่ยังไม่ได้ acknowledge จะถูกส่งซ้ำไปราว 13 ถึง 30 นาทีกว่าจะยอมทิ้ง connection และ connection ที่ว่างอยู่กับปลายทางที่หายไปแล้วจะถูก probe ก็ต่อเมื่อผ่านไปแล้วสองชั่วโมง และก็เฉพาะถ้าเปิด keep-alive ไว้เท่านั้น

ระหว่างที่รอ ผู้เรียกก็ถือทุกอย่างที่ request ต้องใช้ไว้: thread หรือ task, connection จาก pool, memory และ request ของ user ที่ยังเปิดค้างอยู่ ทุกอย่างนี้มีจำกัด พอการเรียกที่ช้ายึดไปหมด request ใหม่ก็ต้องต่อคิวอยู่ข้างหลัง ผู้เรียกของ service *นี้* ก็เริ่มต้องรอบ้าง แล้ว dependency ที่ช้าตัวเดียวก็กลายเป็น **cascading failure** ส่วน user ก็เลิกรอไปนานแล้ว

การรอไปตลอดกาล หรือเกือบตลอดกาล เป็น default ที่เจอบ่อย:

| Client | ค่าตั้งต้น |
|---|---|
| Python `requests` | ไม่มี timeout ถ้าไม่ได้ส่งค่าเข้าไป |
| Go `net/http` | `http.Client.Timeout` เป็นศูนย์ แปลว่าไม่มี timeout ส่วน default transport จำกัดเวลา dial (30 s) และ TLS handshake (10 s) แต่ไม่จำกัดเวลารอ response |
| Java `java.net.http.HttpClient` | request ที่ไม่มี `timeout()` จะ block ไปตลอด |
| axios | `timeout` เป็น `0` แปลว่าไม่มี |
| gRPC | ไม่มี deadline ถ้า client ไม่ได้ตั้ง |
| .NET `HttpClient` | 100 วินาที |
| Node.js `fetch` (สร้างบน undici) | 300 วินาทีสำหรับ response header แล้วก็ 300 วินาทีระหว่าง body chunk แต่ละชิ้น |

timeout แก้เรื่องค้างได้ แต่ไม่ได้แก้ผลลัพธ์: ตอนนี้ request แค่ fail เร็วแทนที่จะ fail ช้า การเปลี่ยน failure นั้นให้เป็นอะไรที่มีประโยชน์คือครึ่งหลังของ pattern นี้

## ทำงานยังไง

1. **จำกัดเวลาทุกการเรียก** remote call แต่ละตัวได้ time limit ที่เลือกจาก latency ที่วัดได้ของ dependency อย่างใน diagram ตัว Recommendations ปกติจะตอบในราว 100 ms และ p99 อยู่ที่ 120 ms เลยตั้ง timeout ไว้ 300 ms ส่วน Catalog (p99 200 ms) ได้ 500 ms และ Reviews (p99 300 ms) ได้ 750 ms
2. **เลิกรอเมื่อหมดเวลา** ผู้เรียกทิ้งการเรียกนั้นแล้วคืน thread กับ connection ถ้ามีแค่ timeout อย่างเดียว หน้าเว็บจะ fail หลัง 380 ms (80 ms ของ Catalog บวก limit 300 ms) แทนที่จะค้าง
3. **ตัดสินว่าแต่ละการเรียกมีค่าแค่ไหน** Catalog เป็นส่วนที่ *required*: ไม่มีสินค้าก็ไม่มีหน้า ทำให้ failure ของมันก็คือ failure ของหน้า ส่วน Reviews กับ Recommendations เป็น *optional*: ถ้าตัวไหน timeout หรือ fail หน้าเว็บก็ใช้ **fallback** แทน สำหรับ Recommendations คือรายการสินค้ายอดนิยมจาก cache ที่ติดป้ายว่าเป็น fallback ส่วน Reviews คือไม่แสดงส่วนนั้นเลย
4. **ให้ทั้ง request มี deadline เดียว** request ใช้เวลารวมได้ 1,000 ms และแต่ละการเรียกจะถูกส่งไปพร้อมค่าที่น้อยกว่าระหว่าง timeout ของตัวเองกับเวลาที่เหลือ การเรียกที่ไม่มีทางเสร็จทันในเวลาที่เหลือจะไม่ถูกเริ่มเลย พอเลย limit หรือ client ตัดการเชื่อมต่อ ผู้เรียกก็จะ **cancel** การเรียกที่ยังรออยู่ แล้วการ cancel ก็ส่งต่อลงไปตามสาย

step 4 ของ diagram ใช้ 1,000 ms ไปแบบนี้:

| การเรียก | Latency ปกติ | Timeout ของตัวเอง | เกิดอะไรขึ้น |
|---|---|---|---|
| Catalog (required) | p99 200 ms | 500 ms | วันนี้ช้า: ตอบหลัง 400 ms เลยเหลือ 600 ms |
| Reviews (optional) | p99 300 ms | 750 ms | ถูกจำกัดไว้ที่ 600 ms ที่เหลืออยู่ ตอบหลัง 150 ms |
| Recommendations (optional) | ราว 100 ms, p99 120 ms | 300 ms | ค้าง: ถูกตัดหลัง 300 ms ถูก cancel แล้วใช้รายการจาก cache แทน |

หน้าเว็บออกไปหลัง request มาถึง 700 ms (400 ms บวก 300 ms) เหลือเวลาอีก 300 ms

"timeout" จริง ๆ แล้วคือ limit หลายตัวที่ต่างกัน และ client ที่ตั้งไว้แค่ตัวเดียวก็ยังค้างที่ตัวอื่นได้:

| Limit | จำกัดอะไร | ตัวอย่าง |
|---|---|---|
| Connect | การเปิด TCP connection | 30 s ใน default transport ของ Go, `connect_timeout` ของ cluster ใน Envoy (default 5 s), `proxy_connect_timeout` ของ nginx (60 s) |
| TLS handshake | การตกลง TLS บน connection ใหม่ | 10 s ใน default transport ของ Go ส่วนใน Envoy เป็นส่วนหนึ่งของ connect timeout สำหรับ upstream TLS connection |
| Response หรือ read | การรอ response header หรือรอ byte ถัดไป | `ResponseHeaderTimeout` ของ Go, read timeout ของ `requests`, `proxy_read_timeout` ของ nginx (60 s ระหว่างการอ่านสองครั้ง) |
| Idle | connection หรือ stream ที่ไม่มีอะไรเกิดขึ้น | default transport ของ Go ปิด idle connection หลัง 90 s ส่วน Envoy มี stream idle timeout 5 นาที และ connection idle timeout หนึ่งชั่วโมง |
| Overall deadline | ทั้งการเรียก หรือทั้ง request ตั้งแต่เริ่มจนถึง byte สุดท้าย | `Client.Timeout` หรือ context deadline ของ Go, route timeout ของ Envoy (default 15 s), gRPC deadline |

read timeout ไม่ใช่ limit ของทั้งหมด มันเริ่มนับใหม่ทุกครั้งที่มี byte มาถึง ทำให้ server ที่คอยส่งข้อมูลมาทีละหยดไม่มีวันทำให้มันทำงาน เอกสารของ `requests` ก็บอกว่า timeout ของมันไม่ใช่ limit ของการ download ทั้งหมด มีแค่ overall deadline ที่จำกัดได้จริงว่าผู้เรียกจะรอนานแค่ไหน

## ใช้ตอนไหนดี

- **Timeout: ทุก remote call เสมอ** การเรียก HTTP และ RPC, database query, cache lookup, operation ของ queue, การขอ lock, DNS และการเรียก process อื่นบนเครื่องเดียวกัน
- **Deadline: เมื่อไหร่ก็ตามที่ request หนึ่งเรียกมากกว่าหนึ่งครั้ง** หรือผ่านมากกว่าหนึ่ง service
- **Fallback: เฉพาะตรงที่คำตอบแบบลดระดับยังตรงไปตรงมาและมีประโยชน์** ส่วนเสริมของหน้า, recommendations, personalisation, counter และ badge, ข้อมูลเสริมที่ user ไม่มีก็ได้
- **อย่า fallback ตรงที่ข้อมูลต้องถูกต้อง** ยอดเงินในบัญชี ราคาตอน checkout สต็อก ณ ตอนซื้อ การตัดสินเรื่อง authorisation: ค่าที่ stale ค่า default หรือค่าที่เดาเอาในจุดพวกนี้แย่กว่า error เพราะจะมีคนเอาไปใช้ตัดสินใจ ให้ fail อย่างชัดเจนแทน และปฏิเสธการเข้าถึงเมื่อเช็ก authorisation ไม่ได้

## ได้อะไร เสียอะไร

- **สั้นไปหรือยาวไป** timeout ที่สั้นเกินไปจะตัดการเรียกที่จริง ๆ จะสำเร็จ งานที่ทำไปก็เสียเปล่า และถ้าผู้เรียก retry ตัว dependency ก็ได้โหลดเพิ่มในจังหวะที่มันช้าอยู่พอดี latency ที่ขึ้นนิดเดียวเลยกลายเป็น outage ได้ ส่วน timeout ที่ยาวเกินไปก็ไม่ได้ปกป้องอะไร เพราะทรัพยากรยังถูกถือไว้ระหว่างที่ผู้เรียกรอ
- **timeout ไม่ได้บอกว่างานเกิดขึ้นหรือยัง** request อาจไปไม่ถึงเลย อาจยังรันอยู่ หรืออาจเสร็จไปแล้วแต่แค่คำตอบหาย ถ้าเป็น read ก็ทำซ้ำได้เลย แต่ถ้าเป็น write จะไม่รู้ว่าผลเป็นยังไง เลยทำซ้ำได้เฉพาะถ้า operation idempotent หรือส่ง idempotency key ไปให้ server รู้ว่าเป็นการทำซ้ำ (ดู [Idempotent Consumer](../idempotent-consumer/) และ [Retry with Backoff & Jitter](../retry-with-backoff/))
- **dependency ยังทำงานต่อจนกว่าจะมีคนบอกให้หยุด** การเลิกรอปลดปล่อยแค่ผู้เรียก ไม่ใช่ฝั่งที่ถูกเรียก ฝั่งนั้นอาจใช้เวลาอีกหลายวินาทีทำคำตอบที่ไม่มีใครอ่าน deadline propagation และ cancellation มีไว้แก้เรื่องนี้
- **fallback คือเส้นทางโค้ดที่สองที่แทบไม่เคยได้รัน** บทความ *Avoiding fallback in distributed systems* ใน Amazon Builders' Library อธิบายว่าทำไม Amazon แทบไม่เคยใช้ fallback รับมือกับ failure ที่ critical: เส้นทางแบบนี้ทดสอบยาก ตัวมันเองก็ fail ได้ ซ่อน bug ไว้ได้เป็นเดือน ๆ และมักทำให้ outage กว้างขึ้นแทนที่จะเล็กลง ตัวอย่างในบทความคือ feature หนึ่งของเว็บ Amazon retail ช่วงราวปี 2001 ตอนนั้น cache บน web server แต่ละตัวมี fallback ไป query database ตรง ๆ พอ cache พังพร้อมกัน web server ทุกตัวก็ยิงไปที่ database แล้วรายละเอียดเล็ก ๆ ที่ขาดไปบนหน้าเว็บก็กลายเป็น outage ของทั้งเว็บและของ fulfilment center ด้วย ทางเลือกที่บทความชอบมากกว่าคือทำให้เส้นทางหลักเชื่อถือได้มากขึ้น ให้ผู้เรียกจัดการ error เอง ส่งข้อมูลไปไว้ล่วงหน้าตรงที่ต้องใช้ และเปลี่ยน fallback ให้เป็น failover ที่รันอยู่ตลอดเวลา ส่วน fallback ที่เลี่ยงไม่ได้ก็ควรถูกใช้งานจริงใน production ให้บ่อยที่สุดเท่าที่ทำได้
- **การลดระดับเบากว่า แต่ไม่ได้รับการยกเว้น** บทความนั้นพูดถึง fallback ที่พยายามให้ผลลัพธ์เดิมผ่านเส้นทางอื่น ส่วนการตัดส่วนที่เป็น optional ออกขออะไรน้อยกว่านั้น แต่คำเตือนก็ยังใช้กับโค้ดอะไรก็ตามที่รันแค่ตอนเกิด outage และ SRE book ของ Google ก็พูดแบบเดียวกันถึง graceful degradation: เส้นทางที่ไม่เคยถูกใช้มักจะใช้ไม่ได้ เลยควรทำให้เรียบง่ายแล้วรันมันเป็นประจำ
- **fallback ซ่อน outage ได้** ถ้าหน้าเว็บยังดูปกติดี ก็ไม่มีใครรู้ว่า Recommendations ล่มมาหลายวันแล้ว เว้นแต่จะนับ response ที่ลดระดับและมี alert ส่งถึงใครสักคน

## ข้อควรรู้ตอนลงมือทำ

- **เลือกค่าจาก latency percentile** วัด latency ของ dependency จากฝั่งผู้เรียก ตัดสินว่ายอมรับ false timeout ได้ในอัตราเท่าไหร่ แล้วใช้ percentile ที่ตรงกัน: ตัวอย่างใน Builders' Library ยอมรับ 0.1% เลยใช้ p99.9 ให้เผื่อเพิ่มเมื่อ distribution แคบ (p99.9 ใกล้กับ median) เพราะแค่ช้าลงนิดเดียวก็จะทำให้การเรียกจำนวนมาก timeout และบวกเวลา network เพิ่มให้ผู้เรียกที่อยู่ไกล ค่า 300 ms เทียบกับ p99 ที่ 120 ms ใน diagram แสดงให้เห็นการเผื่อแบบใจกว้าง ไม่ใช่สูตร
- **เช็กว่า timer ครอบคลุมอะไร** ใช้ timeout ที่มากับ client ที่ผ่านการทดสอบมาดีแล้ว ดีกว่าตัวที่สร้างจาก socket option ดิบ ๆ และหาให้รู้ว่ามันรวม DNS, การ connect และ TLS handshake ไว้หรือเปล่า Builders' Library เล่าถึง timeout 20 ms ที่ทำงานหลัง deploy ทุกครั้ง เพราะ timer รวมเวลาตั้ง secure connection ใหม่ไว้ด้วย วิธีแก้ที่ยั่งยืนคือเปิด connection ไว้ก่อนเริ่มรับ traffic
- **ส่ง deadline ต่อ แทนที่จะคิด timeout ใหม่** ตั้ง deadline ครั้งเดียวตรงที่ request เข้ามา แล้วส่งเวลาที่เหลือให้ทุกการเรียกปลายน้ำ หักเผื่อเล็กน้อยไว้สำหรับ network และงานที่เหลือของตัวเอง ในตัวอย่างของ SRE book ตัว server ที่เลือก 30 วินาทีแล้วใช้ไป 7 วินาทีก่อนเรียกตัวถัดไป ก็จะส่งต่อ 23 วินาที เช็กเวลาที่เหลือก่อนแต่ละขั้น และอย่าเริ่มงานที่ไม่มีทางเสร็จ
- **gRPC มีเรื่องนี้ในตัว แต่ HTTP ธรรมดาไม่มี** gRPC deadline เดินทางไปเป็น header `grpc-timeout` ที่ถูกแปลงเป็นเวลาที่เหลือ ความต่างของนาฬิกาแต่ละเครื่องเลยไม่มีผล Java กับ Go ส่ง deadline ที่เข้ามาต่อให้การเรียกขาออกโดยอัตโนมัติ ส่วน C++ ทำเฉพาะเมื่อสั่ง และ server จะ cancel การเรียกที่เลย deadline ไปแล้ว ส่วน HTTP ไม่มี header มาตรฐานที่พา deadline ไปทีละ hop สิ่งที่มีให้ใช้คือ `Prefer: wait=N` (RFC 7240) ที่เป็นเพดานเวลาประมวลผลเป็นวินาทีจากฝั่ง client และ server จะไม่สนก็ได้, `x-envoy-expected-rq-timeout-ms` ของ Envoy ที่บอก upstream service ว่า proxy คาดว่า request จะใช้เวลากี่มิลลิวินาที เพื่อให้มันออกก่อนได้ และ `Connect-Timeout-Ms` ใน Connect RPC protocol นอกนั้นก็ต้องกำหนด header ของตัวเองแล้วทำตามมันในทุก service
- **Cancel สิ่งที่ไม่มีใครรออยู่แล้ว** บน HTTP/1.1 ตัว client ทิ้ง request ได้ทางเดียวคือปิด connection ส่วน HTTP/2 reset แค่ stream เดียวด้วย `RST_STREAM` และ code `CANCEL` ด้าน gRPC ส่งการ cancel ต่อให้การเรียกขาออกของ handler อัตโนมัติใน Java, Go และ C++ แต่ทั้งหมดนี้ไม่ช่วยอะไรถ้าโค้ดไม่ฟัง: ส่ง `CancellationToken` ต่อไปเรื่อย ๆ ใน .NET (`HttpContext.RequestAborted` ของ ASP.NET Core จะถูก signal เมื่อ connection ของ client ถูกตัด) และส่ง `AbortSignal` ใน JavaScript ที่ `fetch` ไม่มี option timeout ของตัวเอง แต่รับ `AbortSignal.timeout(ms)` เป็น `signal` ได้ Python 3.11 เพิ่ม `asyncio.timeout()` เข้ามา ส่วนการคำนวณที่ยาว ๆ ควรเช็กการ cancel ระหว่างแต่ละขั้น
- **ใน Go ตัว context ทำได้ทั้งสองงาน** context ที่ได้มาจาก `WithTimeout` ไม่มีทางอยู่นานเกิน deadline ของ parent ทำให้ timeout ต่อการเรียกถูกจำกัดด้วย deadline ของ request อัตโนมัติ และ context ของ server request ก็จะถูก cancel เมื่อ connection ของ client ปิด:

  ```go
  // One deadline for the whole request; r.Context() ends if the client disconnects.
  ctx, cancel := context.WithTimeout(r.Context(), 1000*time.Millisecond)
  defer cancel()

  product, err := catalog.Get(ctx, id) // required: on error the page fails
  if err != nil {
      http.Error(w, "product unavailable", http.StatusServiceUnavailable)
      return
  }

  // Optional: at most 300 ms, and never past the request's deadline.
  rctx, rcancel := context.WithTimeout(ctx, 300*time.Millisecond)
  defer rcancel()
  recs, err := recommendations.For(rctx, product)
  if err != nil {
      recs = popular.Cached() // fallback: mark it in the response and count it
  }
  ```

- **ซ้อน limit อย่างตั้งใจ** ถ้าจะให้การลองทุกครั้งได้เวลาเต็ม limit ชั้นนอกต้องมากกว่า timeout ต่อการลองคูณจำนวนครั้ง บวกเวลารอระหว่างแต่ละครั้ง ไม่อย่างนั้น limit ชั้นนอกจะตัดการลองท้าย ๆ ให้สั้นลง หรือไม่ได้เริ่มเลย ใน diagram การลองเรียก Recommendations ครั้งที่สองจะต้องใช้อีกถึง 300 ms เท่ากับเวลาที่เหลือของ deadline ทั้งหมดพอดี เลยไม่เริ่ม แล้วใช้ fallback ทันที library แสดงการซ้อนแบบนี้ให้เห็น: Spring annotation ของ Resilience4j วาง `TimeLimiter` ไว้ข้างใน `Retry` การลองแต่ละครั้งเลยถูกจับเวลาแยกกัน ส่วน standard resilience handler ของ .NET ห่อ attempt timeout 10 วินาทีและ retry ได้ถึงสามครั้งไว้ใน total timeout 30 วินาที ตัว total timeout เลยจบ request ก่อนที่จะลองครบสี่ครั้งเต็ม ๆ ได้ ถ้าข้ามชั้น ให้ผู้เรียกแต่ละตัวมี limit ยาวกว่า service ที่มันเรียกนิดหน่อย เพื่อให้ชั้นที่รู้ว่าเกิดอะไรขึ้นเป็นคนรายงานก่อน
- **เลือก fallback ที่ทำงานน้อยกว่า** เรียงคร่าว ๆ จากปลอดภัยที่สุดไปเสี่ยงที่สุด: ตัด feature ออก คืนค่า default อย่าง list ว่างหรือ ranking ทั่วไป ตอบด้วยสำเนาจาก cache หรือสำเนาที่ stale (ดู [Cache-Aside](../cache-aside/) ส่วน `stale-if-error` จาก RFC 5861 ให้ HTTP cache ทำแบบนี้ได้) รับ write ไว้แล้วเข้า queue ไปทำทีหลังถ้ามันรอได้ (ดู [Queue-Based Load Leveling](../queue-based-load-leveling/)) สลับไปใช้ provider อื่น หรือคืน error ที่ชัดเจน แบบแรก ๆ ไม่ต้องพึ่งอะไรที่อาจล่มไปพร้อมกัน provider หรือ data store ตัวที่สองจริง ๆ แล้วคือ failover: มันใช้ได้ก็ต่อเมื่อรับ traffic จริงอยู่ตลอดเวลาและมี capacity พอจะรับทั้งหมด ระวัง fallback ที่แพงกว่าเส้นทางที่ fail ไป รายการจาก cache ใน diagram ปลอดภัยเพราะถูก refresh อยู่เบื้องหลังและอยู่ใน memory แล้ว การใช้มันเลยไม่เพิ่ม remote call ในจังหวะที่ของกำลังพัง
- **ติดป้ายและนับ response ที่ลดระดับ** บอกใน response ว่าส่วนไหนเป็นของแทน ผ่าน field หรือ header เพื่อให้ client ติดป้ายหรือซ่อนมันได้ และ cache ไม่เก็บมันไว้เหมือนเป็นของจริง นับ timeout และ fallback แยกต่อ dependency ตั้ง alert ตามอัตรา และแยก response ที่ลดระดับออกจาก response ที่ดีเวลาวัดผล service แล้วทดสอบด้วยการใส่ latency เข้าไป ไม่ใช่แค่ใส่ error
- **ใช้ร่วมกับ limit อื่น** ตัว timeout จำกัดว่าการเรียกหนึ่งครั้งรอนานแค่ไหน ส่วน [Bulkhead](../bulkhead/) จำกัดว่ารอพร้อมกันได้กี่การเรียก [Circuit Breaker](../circuit-breaker/) นับ timeout เป็น failure และพอ open แล้วก็ข้ามการรอไปใช้ fallback เลย ส่วน retry ต้องมี timeout ต่อการลองแต่ละครั้งและ deadline เดียวครอบทั้งหมด และ load shedding บน server (ดู [Rate Limiting & Throttling](../rate-limiting/)) ปฏิเสธงานที่ไม่มีทางเสร็จทันตั้งแต่เนิ่น ๆ และ [Health Endpoint Monitoring](../health-endpoint-monitoring/) เอา instance ที่ timeout ซ้ำ ๆ ออกจาก load balancer เรื่องนี้ limit ต่อการเรียกทำไม่ได้
- **จำกัดฝั่ง server ด้วย** ตัว server ไม่ควรทำงานนานกว่าที่ผู้เรียกรอ `http.Server` ของ Go ไม่มี read timeout หรือ write timeout จนกว่าจะตั้ง (`ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`, `IdleTimeout`) และ `http.TimeoutHandler` จะตอบ 503 เมื่อ handler ใช้เวลาเกิน ส่วน HTTP server ของ Node.js ให้เวลารับ request 300 วินาทีโดย default และ `statement_timeout` ของ PostgreSQL ปิดไว้โดย default ให้ทิ้ง request ที่เลย deadline ไปแล้วระหว่างนั่งรอใน queue (ตัวอย่างใน SRE book คือ deadline 10 วินาทีแต่ไปนั่งต่อคิวอยู่ 11 วินาที) และเมื่อ gateway ยอมแพ้กับ upstream ก็ให้บอกด้วย 504 (Gateway Timeout)
- **Library และ proxy** ฝั่ง Resilience4j มี `TimeLimiter` (default 1 วินาที) และ `fallbackMethod` บน annotation ส่วน Polly มี timeout strategy (default 30 วินาที โยน `TimeoutRejectedException` และ cancel ผ่าน token ที่ callback ต้องฟัง) และ fallback strategy ส่วน proxy อย่าง Envoy ใช้ route timeout และ per-try timeout ได้โดยไม่ต้องแก้โค้ด แต่มีแค่แอปพลิเคชันที่สร้าง fallback ได้
