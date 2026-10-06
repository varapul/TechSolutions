## ปัญหา

ทุก API มี capacity จำกัด และคุมไม่ได้ว่าใครจะเรียกเข้ามา client ตัวเดียวที่ติดอยู่ใน retry loop งาน batch ตอนกลางคืนของ partner ตัว scraper หรือ bot ที่ลองยัด credential ก็กินส่วนแบ่งไปมากกว่าที่ควรได้เยอะ แล้ว client อื่นทุกตัวก็ช้าตามไปด้วย นี่คือปัญหา **noisy neighbour** เพิ่ม server ก็แก้ไม่ได้ การ scale out ใช้เวลาเป็นนาทีและเสียเงิน ตัว database หรือ API ของ third party ที่อยู่หลัง service ก็ไม่ได้ scale ตามไปด้วย ส่วน capacity ที่เพิ่มมาก็ตกไปอยู่กับคนที่ส่งมามากที่สุดอยู่ดี และยังมีเหตุผลอื่นที่ต้องนับ request โดยไม่เกี่ยวกับโหลดเกินเลย: แพ็กเกจราคา การแบ่งส่วนให้ tenant แต่ละรายอย่างยุติธรรม และ operation ที่แพง (login, search, export) ที่ต้องให้ budget น้อยกว่าการอ่านถูก ๆ

## ทำงานยังไง

rate limiter อยู่หน้างานจริง แล้วถามคำถามเดียวต่อ request: *คนเรียกคนนี้ยังมี budget เหลือไหม* มันต้องมี **key** ที่บอกว่าคนเรียกเป็นใคร มี **algorithm** ที่คอยนับ และมี **response** ที่บอก client ที่โดนปฏิเสธว่าต้องทำอะไรต่อ

**Token bucket** คือ algorithm ใน diagram แต่ละ key มีถังที่จุ token ได้มากสุด *b* ตัว และได้ token เติมเข้ามา *r* ตัวต่อวินาที request หนึ่งตัวใช้ token หนึ่งตัว (หรือหลายตัวถ้าเป็น operation ที่แพง) และจะโดนปฏิเสธถ้าถังว่าง ตัวเลขสองตัวนี้คือ policy ทั้งหมด: *b* คือ burst ใหญ่สุดที่ client ส่งมาได้ในทีเดียว ส่วน *r* คืออัตราที่ส่งได้ต่อเนื่อง ถังที่เต็มแล้วจะทิ้ง token ใหม่ไป ทำให้ client ที่ว่างอยู่เก็บสะสมได้ไม่เกินหนึ่ง burst ในความจริงไม่มีอะไรหยดลงถังหรอก implementation เก็บแค่จำนวน token กับเวลาที่ update ล่าสุด แล้วพอมี request เข้ามาก็บวก token เพิ่ม `elapsed × r` ตัว โดยไม่ให้เกิน *b*

**Algorithm อื่น ๆ** ได้อย่างเสียอย่างต่างกันไปเรื่องความแม่นยำ memory และการรับมือกับ burst:

| Algorithm | นับยังไง | ได้อะไร เสียอะไร |
|---|---|---|
| Token bucket | token เติมในอัตราคงที่จนเต็ม capacity แต่ละ request ใช้หนึ่งตัว | ยอมให้ burst ได้จนเต็ม capacity แล้วจากนั้นก็ได้แค่ตามอัตราเติม เก็บสองค่าต่อ key |
| Leaky bucket | ถ้าใช้เป็น *meter* ก็เหมือน token bucket กลับด้าน: มีระดับที่สูงขึ้นทุก request และไหลออกในอัตราคงที่ ถ้าใช้เป็น *queue* ตัว request ต้องรอแล้วออกไปในอัตราคงที่ | แบบ queue ทำให้ traffic เรียบเป็นอัตราไหลออกคงที่ แต่ต้องแลกกับ latency ที่เพิ่มขึ้นและ queue ที่อาจเต็มได้ |
| Fixed window | มีตัวนับหนึ่งตัวต่อ key ต่อ window (เช่นต่อนาที) แล้ว reset ตอนขึ้น window ใหม่ | ง่ายและถูกที่สุด แต่ client ใช้ quota หนึ่งชุดตอนท้าย window แล้วใช้อีกชุดตอนต้น window ถัดไปได้ เลยได้มากถึงสองเท่าของ limit ในช่วงเวลาสั้น ๆ |
| Sliding window log | เก็บ timestamp ของทุก request แล้วนับตัวที่อยู่ใน window ล่าสุด | แม่นยำเป๊ะ แต่ memory และงานที่ต้องทำโตตาม limit |
| Sliding window counter | เอาจำนวนของ window ปัจจุบันมาบวกกับจำนวนของ window ก่อนหน้า โดยถ่วงน้ำหนักตามส่วนของ window นั้นที่ยังซ้อนทับอยู่ | เก็บสองค่าต่อ key และเกือบแม่นยำ แต่ก็สมมติว่า request ใน window ก่อนหน้ากระจายตัวเท่า ๆ กัน Cloudflare วัดได้ว่ามีแค่ 0.003% จาก 400 ล้าน request ที่ปล่อยผ่านหรือ limit ผิด |
| GCRA | เก็บ timestamp หนึ่งค่าต่อ key: คือ *theoretical arrival time* ของ request ถัดไปที่ยังอยู่ในอัตรา | ทำงานเหมือน token bucket แต่เก็บค่าเดียวและไม่ต้องมีขั้นเติม token แค่อธิบายยากกว่า มันมาจาก network แบบ ATM (generic cell rate algorithm) |

**ใช้อะไรเป็น key** ให้ใช้ identity ที่ authenticate แล้วก่อน: API key, OAuth client, user หรือ tenant สำหรับ traffic ที่ไม่ระบุตัวตน (sign-up, login, หน้า public) IP address มักเป็น key เดียวที่มี และเป็น key ที่หยาบ ทั้งออฟฟิศ ทั้งมหาวิทยาลัย หรือทั้งเครือข่ายมือถืออาจอยู่หลัง NAT address เดียวกัน limit ต่อ IP ที่เข้มเลยลงโทษทุกคนพร้อมกัน ส่วนผู้โจมตีก็กระจายไปใช้หลาย address ถ้าอยู่หลัง CDN หรือ load balancer ให้เอา address ของ client จาก forwarding header ที่ infrastructure ของเราเองเป็นคนใส่เท่านั้น

**Limit หลายชั้น** policy จริงมี limit ซ้อนกันหลายตัว และ request ต้องผ่านทุกตัว: ต่อ key มี limit ระยะสั้นไว้คุม burst (ต่อวินาที) กับ limit ระยะยาวไว้คุมปริมาณ (quota ต่อวันหรือต่อเดือน) endpoint ที่แพงได้ limit ที่เข้มกว่าหรือคิด token แพงกว่า endpoint ที่ช้าได้เพดานจำนวน request ที่ทำพร้อมกัน และมี global limit ที่ปกป้อง service ไม่ว่าตัวเลขต่อ client จะรวมกันได้เท่าไร (step 4)

**สัญญาของ response** บอก client ที่โดนปฏิเสธว่าเกิดอะไรขึ้นและกลับมาได้เมื่อไร แล้วก็ต้องรู้ว่าส่วนไหนเป็นมาตรฐาน:

- **`429 Too Many Requests` เป็นมาตรฐาน** RFC 6585 นิยามไว้สำหรับ user ที่ "has sent too many requests in a given amount of time" response นี้ใส่ `Retry-After` มาด้วยได้ และ cache ต้องไม่เก็บมันไว้
- **`Retry-After` เป็นมาตรฐาน** (RFC 9110): เป็นจำนวนวินาทีหรือ HTTP date ก็ได้ ส่งมันไปกับทุก 429 และกับ `503 Service Unavailable` ที่ตอบกลับตอนตัดโหลดด้วย
- **`RateLimit-Policy` กับ `RateLimit` ยังไม่เป็นมาตรฐาน** มันให้ server ประกาศ policy ของ quota และบอกว่าเหลืออีกเท่าไร client จะได้ชะลอลง*ก่อน*โดนปฏิเสธ ณ เดือนตุลาคม 2026 เอกสารของ IETF HTTPAPI working group (draft-ietf-httpapi-ratelimit-headers, revision 11, พฤษภาคม 2026) ยังเป็น Internet-Draft อยู่ และ syntax ก็เปลี่ยนมาเรื่อย ๆ รูปแบบปัจจุบันคือ `RateLimit-Policy: "default";q=100;w=60` (quota 100 ต่อ window 60 วินาที) และ `RateLimit: "default";r=50;t=30` (เหลือ 50 ใช้ไปอีก 30 วินาทีข้างหน้า) revision ถึง -06 ใช้ field แยกกันคือ `RateLimit-Limit`, `RateLimit-Remaining` และ `RateLimit-Reset` และบาง library ก็ยังส่งแบบนี้อยู่ ถ้า response มีทั้งสองแบบ ตัว draft บอกว่าให้ `Retry-After` มาก่อน
- **`X-RateLimit-Limit`, `X-RateLimit-Remaining` และ `X-RateLimit-Reset` เป็นแค่ธรรมเนียม** ใช้กันแพร่หลายแต่ไม่เคยเป็นมาตรฐาน และความหมายก็ไม่ตรงกัน: ค่า reset ในบาง API คือจำนวนวินาทีที่เหลือ แต่ในบาง API คือ Unix timestamp (ของ GitHub เป็น UTC epoch seconds) ส่งแบบไหนก็เขียนเอกสารบอกไว้ด้วย

**Limit เดียวข้ามหลาย instance** (step 3) limiter ที่นับใน memory ถูกต้องแค่ตอนมี instance เดียว ถ้าอยู่หลัง load balancer ทุก instance ก็จะปล่อยได้เต็ม limit ทางเลือกมีดังนี้:

- *Store กลางที่มี operation แบบ atomic* ทุก instance ถาม store เดียวกัน ปกติคือ Redis ส่วน fixed window ใช้แค่ `INCR` หนึ่งครั้งพร้อม expiry ส่วน token bucket ต้องอ่าน ตัดสินใจ แล้วเขียน เลยต้องรันเป็น Lua script (หรือ operation เดียวที่เทียบเท่ากัน) เพื่อไม่ให้ request สองตัวที่มาพร้อมกันใช้ token ตัวสุดท้ายได้ทั้งคู่ ที่ต้องแลกคือ network round trip หนึ่งรอบต่อ request และ dependency ใหม่หนึ่งตัว เลยต้องตั้ง timeout สั้น ๆ ให้การเรียกนี้ และตัดสินไว้ก่อนว่าถ้ามันล้มจะทำยังไง: **fail open** (ปล่อย traffic ผ่านไปโดยไม่มีอะไรปกป้อง แบบที่ Stripe ทำ) หรือ **fail closed** (ปฏิเสธ เป็นทางที่ปลอดภัยกว่าสำหรับ login หรืออะไรที่เสียเงินทุกครั้งที่เรียก)
- *ประมาณเอาในเครื่อง* แบ่ง limit แต่ละตัวด้วยจำนวน instance แล้วนับในเครื่อง วิธีนี้สมมติว่า load balancer กระจาย client ทุกตัวเท่า ๆ กัน หรือนับในเครื่องแล้วแลกยอดรวมกันเป็นระยะ โดยยอมให้เกินไปบ้าง Envoy รันได้ทั้งสองขั้น: token bucket ในเครื่องรับ burst ใหญ่ ๆ ไว้ก่อน แล้วค่อยให้ global rate limit service ตัดสินแบบแม่นยำ
- *ยอมรับว่ามันเป็นค่าประมาณ* ตัวนับที่ update แบบ asynchronous หรือ replicate ข้าม region จะช้ากว่าความจริงไปไม่กี่ request ส่วน Amazon API Gateway ก็เขียนไว้ในเอกสารว่า throttle และ quota ของมันเป็นเป้าแบบ best-effort ไม่ใช่เพดานที่รับประกัน

**Rate limiting, throttling, load shedding, backpressure** คำพวกนี้ความหมายซ้อนกัน และแต่ละ vendor ก็ใช้ไม่เหมือนกัน:

- *Rate limiting* บังคับ budget **ต่อคนเรียก** มันตอบ 429 ตอนที่คนเรียกนั้นใช้เกิน quota แม้ service จะว่างอยู่ก็ตาม
- *Throttling* มักใช้เป็นคำพ้อง: Builders' Library ของ Amazon ถือว่า "throttling" กับ "admission control" เป็นอีกชื่อของ API rate limiting แต่บางที่ใช้คำนี้หมายถึงการทำให้ request ช้าลง ด้วยการหน่วงหรือเข้า queue แทนการปฏิเสธ
- *Load shedding* ปกป้อง **ตัว service** พอ capacity หมดมันก็ปฏิเสธงานแบบต้นทุนต่ำ ปกติตอบ 503 และถ้าให้ดีก็ตัดงานที่สำคัญน้อยที่สุดก่อน ไม่ว่าคนเรียกจะยังอยู่ใน quota หรือไม่ (step 4)
- *Backpressure* ทำให้ **ฝั่งส่งช้าลง** แทนที่จะทิ้งงานของมัน: queue ที่มีขนาดจำกัดแล้ว block producer, flow-control window หรือ client ที่ทำตาม `Retry-After`
- Azure Architecture Center แยกสองฝั่งออกจากกัน pattern *Throttling* ของมันคือ service ปกป้องตัวเองด้วยการจำกัดว่า consumer แต่ละรายใช้ได้เท่าไร ก็คือสิ่งที่หน้านี้แสดง ส่วน pattern *Rate Limiting* ของมันเป็นฝั่ง client: คุมจังหวะการเรียกของเราเอง มักทำผ่าน queue เพื่อให้อยู่ใต้ limit ของคนอื่น

ตัวเลขใน animation ตั้งไว้เล็ก ๆ จะได้นับตามได้: 5 token ได้คืนมาหนึ่งตัวทุกครึ่งวินาที ส่วน 429 บอก `Retry-After: 1` เพราะ header นี้นับเป็นวินาทีเต็ม และถังที่ว่างจะมี token กลับมาภายในครึ่งวินาที ตัว service ถือว่า request ที่ทำอยู่ 8 ตัวคือเต็ม และกัน 2 ช่องสุดท้ายไว้ให้การเรียกที่สำคัญ

## ใช้ตอนไหนดี

- API ไหนก็ตามที่เราคุมคนเรียกไม่ได้: public, partner หรือ internal platform ที่หลายทีมใช้ร่วมกัน
- ใช้บังคับแพ็กเกจและ quota ปกป้อง endpoint ที่แพงหรือโดนใช้ในทางที่ผิดง่าย (login, search, export) และกัน client ที่คุมไม่อยู่ไว้ก่อนมันจะทำร้ายตัวอื่น
- ใช้กับการเรียกออกไปข้างนอกของเราเอง เพื่อให้อยู่ใต้ limit ของ dependency แทนที่จะคอยเก็บ 429 ของมัน
- เพิ่ม load shedding ถ้า service โหลดเกินได้แม้ทุก client จะอยู่ใน quota ของตัวเอง และนี่เป็นเรื่องปกติ: quota มักขายเกิน capacity จริงโดยพนันว่าไม่ใช่ทุกคนจะใช้พร้อมกัน และ traffic ก็มักมาพร้อม ๆ กันตอนมีเซลหรือมี incident
- อย่าใช้แทน capacity: ถ้า traffic ปกติชน limit ก็ให้เพิ่ม capacity หรือขยับ limit ขึ้น และอย่าใช้เป็นตัวกัน DDoS: การโจมตีแบบ volumetric ต้องรับไว้ที่ network edge ก่อนจะมาถึง limiter ของเรา

## ได้อะไร เสียอะไร

- **Limit เป็นการเดา** ต่ำไปก็ปฏิเสธ burst ที่ถูกต้อง เช่นหน้าเว็บที่แตกออกเป็นสิบการเรียก หรืองานที่เริ่มตรงต้นชั่วโมง สูงไปก็ไม่ได้ปกป้องอะไร ให้รัน limit ใหม่ใน shadow mode ก่อน โดย log ไว้ว่ามันจะปฏิเสธอะไรบ้าง (Stripe เรียกว่า dark launch ส่วน NGINX มี `limit_req_dry_run`) แล้วค่อยจูนกับ traffic จริง
- **Retry ทำให้โหลดทวีคูณ** request ที่โดนปฏิเสธมักกลับมาอีก client ที่ไม่สน `Retry-After` แล้ว retry ทันทีจะเปลี่ยนทุก 429 ให้กลายเป็น traffic ที่มากขึ้น และหนังสือ SRE ของ Google ก็ชี้ไว้ว่า backend โหลดเกินได้แม้ตอนที่ CPU ส่วนใหญ่หมดไปกับการปฏิเสธ request การปฏิเสธต้องถูกกว่าการให้บริการมาก และต้องทำตั้งแต่เนิ่น ๆ
- **Identity ที่ใช้ร่วมกัน** limit ต่อ IP โดนทุกคนที่อยู่หลัง NAT ส่วน API key ตัวเดียวที่เครื่องทั้งหมดของลูกค้าใช้ร่วมกันก็ทำให้งาน batch ของเขาแย่ง budget จน checkout ของเขาเองไม่มีเหลือ
- **Dependency ใหม่** shared store เพิ่ม latency ให้ทุก request และมีแบบที่ล้มได้ของมันเอง
- **ประมาณเอาโดยธรรมชาติ** race ระหว่าง instance และ replication lag ทำให้ผ่านเกิน limit ไปนิดหน่อย ให้ตั้ง limit โดยเผื่อส่วนนี้ไว้แทนที่จะพยายามให้แม่นเป๊ะ
- **ความยุติธรรมกับการใช้ capacity ให้คุ้ม** limit ต่อ client แบบตายตัวทำให้ capacity ว่างทิ้งไว้ตอนที่คนอื่นเงียบ การให้ client burst เข้าไปใช้ capacity ที่ว่างอยู่ก็ทำให้มันได้ใช้งาน แต่จากนั้นก็ต้องมี priority ไว้ตัดสินว่าใครโดนตัดก่อนตอนที่มันหมด
- **Priority ต้องเชื่อถือได้** ถ้าคนเรียกติดป้ายให้ request ตัวเองว่าสำคัญได้ ทุกอย่างก็จะกลายเป็นสำคัญหมด ให้จัดกลุ่มที่ฝั่ง server ตาม endpoint หรือตามแพ็กเกจที่ authenticate แล้ว

## ข้อควรรู้ตอนลงมือทำ

- **บังคับเป็นชั้น ๆ เริ่มจากชั้นที่ถูกที่สุด** ที่ edge ให้ CDN หรือ WAF (Cloudflare rate limiting rules, AWS WAF rate-based rules) ทิ้ง traffic ท่วม ๆ ตาม IP address หรือ fingerprint ก่อนมาถึงเรา ที่ [API Gateway](../api-gateway/) ใช้ limit ต่อ key และแพ็กเกจ: usage plan ของ Amazon API Gateway คือ token bucket (*rate* คืออัตราเติม *burst* คือขนาดถัง) บวก quota ต่อวัน สัปดาห์ หรือเดือน ส่วน `limit_req` ของ NGINX เป็น leaky bucket ต่อ key ที่มี `burst` เผื่อไว้ ใน service mesh ตัว Envoy มี filter แบบ local และโหมด global ที่ใช้ rate limit service ภายนอก ในตัว process ใช้ library จำกัด instance เดียวหรือคุมจังหวะการเรียกออกไปข้างนอก: Resilience4j `RateLimiter` (Java), `golang.org/x/time/rate` (Go), ASP.NET Core rate limiting middleware (.NET)
- **เช็ก status code ที่เป็นค่า default** ทั้ง NGINX และ ASP.NET Core ตอบ request ที่โดนปฏิเสธด้วย `503` ถ้าไม่ได้ตั้ง `limit_req_status 429` หรือ `RejectionStatusCode` ไว้ ให้ใช้ 429 สำหรับ "คุณใช้เกิน quota แล้ว" เก็บ 503 ไว้สำหรับ "service ไม่มี capacity เหลือ" และส่ง `Retry-After` ไปกับทั้งสองแบบ
- **ถ้าใช้ Redis** `INCR` บวก expiry ก็ได้ fixed window ส่วน token bucket ให้เก็บจำนวน token กับเวลาเติมล่าสุดไว้ใน hash แล้ว update ทั้งคู่ใน script `EVAL` ตัวเดียว ใส่ TTL ให้ทุก key ด้วย client ที่ไม่ใช้งานจะได้ไม่กองสะสม
- **พฤติกรรมของ client** client ที่ทำตัวดีจะรออย่างน้อยเท่าที่ `Retry-After` บอก ถ้าไม่มีก็ back off แบบ exponential พร้อม jitter ([Retry with Backoff & Jitter](../retry-with-backoff/)) และจำกัดจำนวน retry ด้วย budget หนังสือ SRE ของ Google อธิบายถึง client ที่ throttle ตัวเองเมื่อ request ล่าสุดของมันโดนปฏิเสธมากเกินไป client ที่เป็นงาน batch ควรคุมจังหวะตัวเองให้อยู่ใต้ limit นิดหนึ่ง แทนที่จะไปรู้ limit จาก error
- **ตัดโหลดตามสิ่งที่อิ่มตัวจริง:** จำนวน request ที่ทำอยู่พร้อมกัน เวลาที่รอใน queue หรือ CPU ไม่ใช่ request ต่อวินาที ตัดสินลำดับ priority ไว้ล่วงหน้า Stripe กัน capacity ส่วนหนึ่งไว้ให้ method ที่สำคัญ แล้วตอบ 503 กับ request ที่ไม่สำคัญเมื่อเกินส่วนที่เหลือ ส่วน Google ให้ request ทุกตัวมี criticality หนึ่งในสี่ระดับ แล้วปฏิเสธระดับต่ำสุดก่อน ตัว load shedding ซื้อเวลาให้ [Autoscaling](../autoscaling/) เพิ่ม capacity ได้ แต่ไม่ได้มาแทนมัน
- **เพื่อนบ้าน** [Circuit Breaker](../circuit-breaker/) คือคู่ของมันฝั่งคนเรียก: มันหยุดเรียก dependency ที่ล้มอยู่เรื่อย ๆ ส่วน bulkhead จำกัด concurrency ที่ dependency หรือ tenant แต่ละรายถือได้ (Bulkhead) ส่วน queue รับ burst ที่รอได้ไว้ (Queue-Based Load Leveling) และ priority queue ทำงานที่สำคัญก่อน (Priority Queue)
- **ดูแลมันตอนใช้งานจริง** นับ request ที่ปล่อยผ่านและที่ปฏิเสธต่อ key และต่อ rule แจ้งเตือนเมื่อ client ที่ปกติเงียบ ๆ เริ่มโดน limit ให้ลูกค้าเห็นการใช้งานและ quota ที่เหลือ และทำให้เปลี่ยน limit ได้ตอน runtime พร้อม override ต่อ key จะได้ไม่ต้อง deploy ตอนเกิด incident
