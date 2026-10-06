## ปัญหา

มีเรื่องเกิดขึ้นในระบบขององค์กรอื่น แล้วระบบของเราต้องตอบสนอง: payment สำเร็จที่ payment platform, มีคน push commit เข้า repository ที่ host ไว้ หรือมีคนสั่งของในร้านค้า ระบบของเขารู้ทันที ส่วนระบบของเราจะรู้ก็ต่อเมื่อถามเอง เว้นแต่เขาจะบอกมา

การถามก็คือ **polling**: เรียก API ของ provider ทุกไม่กี่วินาทีแล้วดูว่ามีอะไรใหม่ไหม คำตอบส่วนใหญ่ว่างเปล่า ข่าวมาช้าได้ถึงหนึ่งรอบ interval แล้ว provider ก็ต้องรับ request ว่าง ๆ พวกนั้นทั้งหมด ส่วน **long-lived connection** (WebSocket, Server-Sent Events) ส่งข่าวได้ทันที แต่ทั้งสองฝั่งต้องเปิด connection ค้างไว้หนึ่งเส้นต่อ subscriber หนึ่งราย ส่วน **message queue** ที่ใช้ร่วมกันก็ให้ delivery semantics ที่เราอยากได้ แต่สององค์กรแทบไม่เคยใช้ broker, credential และ client library ร่วมกัน

**webhook** กลับทิศของ API: subscriber ลงทะเบียน URL ไว้ แล้ว provider ส่ง HTTP `POST` มาที่ URL นั้นเมื่อมีเรื่องเกิดขึ้น ทุก platform รับ HTTP request ได้ ทำให้ webhook กลายเป็นวิธีปกติที่ระบบของบริษัทหนึ่งใช้แจ้งระบบของอีกบริษัท ส่วนที่ยากคือเส้นทางที่ call นั้นต้องข้าม: public internet ระหว่างสององค์กร โดยไม่มี broker อยู่ตรงกลาง ฝั่งรับต้องรู้ให้ได้ว่าใครเป็นคนเรียกมา ฝั่งส่งต้องรับมือกับฝั่งรับที่ช้าหรือล่ม แล้วทั้งสองฝั่งต้องยอมรับว่า notification หนึ่งอาจมาถึงสองครั้ง มาช้า หรือมาหลังอันที่ใหม่กว่า

## ทำงานยังไง

1. **Subscribe** subscriber ลงทะเบียน HTTPS URL กับประเภท event ที่อยากได้ หลังจากนั้น provider กับ subscriber ก็ถือ **signing secret** ร่วมกันสำหรับ endpoint นั้น
2. **Deliver** เมื่อมี event เกิดขึ้น provider สร้าง payload (ปกติเป็น JSON) เซ็นมัน แล้วส่งเป็น HTTP `POST` ไปทุก endpoint ที่ subscribe ประเภทนั้นไว้ ทุก event มี ID ไม่ซ้ำกัน
3. **Verify** ฝั่งรับคำนวณ signature ใหม่จาก raw request body แล้วปฏิเสธทุกอย่างที่ไม่ตรงหรือเก่าเกินไป
4. **Acknowledge** ฝั่งรับเก็บ event ไว้แบบ durable ใน queue ของตัวเอง แล้วตอบ `2xx` ทันที สำหรับ provider ตัว `2xx` แปลว่าส่งถึงแล้ว ส่วน status อื่น หรือไม่ได้คำตอบภายใน timeout ของมัน แปลว่าส่งไม่สำเร็จ
5. **Retry** provider ส่งรอบที่ล้มเหลวซ้ำ โดยเว้นระยะยาวขึ้นเรื่อย ๆ และจดทุกครั้งที่ลองลงใน delivery log หลังลองครั้งสุดท้าย มันจะตั้งสถานะการส่งนั้นเป็น failed แล้ว subscriber สั่งส่งใหม่ได้ด้วยมือหรือผ่าน API
6. **Process** worker หยิบ event ออกจาก queue เช็กว่า ID นั้นเคยทำไปแล้วหรือยัง แล้วค่อยทำงาน

### Webhook เทียบกับทางเลือกอื่น

| | ใครเริ่มแต่ละรอบ | ความหน่วง | ฝั่ง subscriber ต้องมี | ฝั่ง provider ต้องมี |
|---|---|---|---|---|
| **Polling** | subscriber ตามรอบเวลา | ได้ถึงหนึ่งรอบ interval | API client | capacity สำหรับ request ที่ส่วนใหญ่ไม่ได้อะไรกลับไป |
| **Long-lived connection** (WebSocket, Server-Sent Events) | subscriber ต่อเข้ามา แล้ว provider push ให้ | ต่ำ | client ที่ reconnect แล้วทำต่อจาก cursor ได้ | connection ที่เปิดไว้หนึ่งเส้นต่อ subscriber หนึ่งราย |
| **Webhook** | provider ครั้งละหนึ่ง event | ต่ำ | public HTTPS endpoint ที่แทบไม่เคยล่ม | ระบบส่งที่มี retry และ log |
| **Queue หรือ event bus ที่ใช้ร่วมกัน** | provider publish ส่วน subscriber consume | ต่ำ | สิทธิ์เข้าถึง broker ตัวเดียวกัน | เหมือนกัน |

ใช้ร่วมกันได้ integration ที่ทำอย่างรอบคอบจะใช้ webhook เพื่อความเร็ว แล้วยังคอย poll เป็นระยะเพื่อเก็บสิ่งที่ webhook พลาดไป provider บางรายยัง publish เข้าไปใน cloud account ของ subscriber เองแทนการเรียก URL ได้ด้วย: Stripe ส่ง event เข้า Amazon EventBridge หรือ Azure Event Grid ได้ ส่วน Shopify ส่งเข้า Google Cloud Pub/Sub หรือ Amazon EventBridge ได้

### รู้ให้ได้ว่าใครเรียกมา

webhook endpoint คือ public URL ที่รับ `POST` request ถ้าไม่มีการตรวจ ใครก็ตามที่รู้ URL ก็บอกระบบของเราได้ว่า payment สำเร็จแล้ว

- **HTTPS เท่านั้น** TLS ทำให้ payload เป็นความลับ และทำให้ provider เช็กได้ว่ากำลังคุยกับ server ของเราจริง แต่ถ้าไม่ได้ใช้ mutual TLS มันก็ไม่บอกอะไรเลยเกี่ยวกับคนที่เรียกมา ส่วน signature ก็ไม่ได้เข้ารหัสอะไร เลยต้องมีทั้งสองอย่าง
- **signature ที่คำนวณจาก raw body** provider คำนวณ HMAC (RFC 2104) ที่ในทางปฏิบัติก็คือ HMAC-SHA256 จาก request body และปกติก็รวม metadata บางส่วนด้วย โดยใช้ secret ของ endpoint เป็น key แล้วส่งมาใน header ส่วนฝั่งรับก็คำนวณค่าเดียวกันแล้วเทียบ ต้องใช้ byte ตามที่มาถึงเป๊ะ ๆ: framework ที่ parse JSON แล้ว serialise กลับใหม่จะเปลี่ยน whitespace หรือลำดับ key ทำให้ signature ไม่ตรงอีกต่อไป ให้เทียบด้วยฟังก์ชันแบบ constant time (`hmac.compare_digest`, `crypto.timingSafeEqual`): การเทียบ string แบบธรรมดาจะหยุดที่ตัวอักษรแรกที่ต่างกัน แล้วเวลาที่ใช้ก็บอกได้ว่าที่เดามาถูกไปแค่ไหน
- **timestamp อยู่ใน signature** request ที่ถูกดักไว้จะยังใช้ได้ตราบที่ secret ยังใช้ได้ ถ้าเซ็น timestamp ไปพร้อมกับ body ฝั่งรับก็ปฏิเสธทุกอย่างที่เก่ากว่าค่า tolerance ได้ การ replay เลยทำได้แค่ในช่วงเวลานั้น ห้านาทีเป็นค่า default ใน library ของ Stripe และใน reference library ของ Standard Webhooks ส่วน provider ที่เซ็น timestamp จะสร้าง timestamp ใหม่ทุกครั้งที่ลอง ทำให้ retry ที่มาถึงช้าไปหลายชั่วโมงก็ยังผ่าน ส่วนนาฬิกาของฝั่งรับต้องตรง
- **Rotation แบบมีช่วงซ้อน** ถ้าจะเปลี่ยน secret โดยไม่ให้การส่งหลุด provider จะเซ็นแต่ละ request ด้วยทั้ง secret เก่าและใหม่อยู่ช่วงหนึ่ง แล้วส่ง signature ทั้งสองมา ส่วนฝั่งรับยอมรับ request ถ้ามีตัวไหนตรงสักตัว Stripe ให้ secret เก่าใช้ต่อได้ถึง 24 ชั่วโมงตอนที่เรา roll มัน แต่ถ้าสงสัยว่า secret รั่ว ให้ข้ามช่วงซ้อนไปเลย: ช่วงซ้อนจะทำให้ secret ที่รั่วยังใช้ได้อยู่
- **IP allowlist เป็นด่านที่สอง ไม่ใช่ด่านแรก** provider อย่าง Stripe และ GitHub ประกาศ address ที่การส่งของเขาออกมา แล้ว firewall rule ก็ช่วยลด noise ได้ แต่ช่วง address เปลี่ยนได้ (GitHub บอกให้ refresh list เป็นระยะ) address ชุดเดียวกันยังส่ง webhook ของลูกค้าทุกรายของ provider นั้น รวมถึงคนร้ายที่เอา URL ของเราไปลงทะเบียนใน account ของตัวเองด้วย และ address ก็ไม่ได้บอกเลยว่า body ถูกแก้หรือเปล่า
- **Asymmetric signature** ถ้าใช้ HMAC ใครที่ verify ได้ก็ปลอมได้ด้วย แล้ว provider ก็ต้องเก็บ secret ไว้หนึ่งตัวต่อทุก endpoint อีกทางคือให้ provider เซ็นด้วย private key แล้วประกาศ public key ออกมา ส่วน Standard Webhooks ก็กำหนดแบบนี้ไว้เป็นอีก variant หนึ่งที่ใช้ Ed25519

### ข้อตกลงเดียวสำหรับ header

provider แต่ละรายต่างคิดชื่อ header และกติกาการเซ็นของตัวเองขึ้นมา **Standard Webhooks** คือ open specification ที่ตกลงเรื่องพวกนี้ให้เป็นแบบเดียว ฝั่งส่งที่ทำตามมันจะใส่ header สามตัว และเป็นสามตัวเดียวกับใน diagram:

| Header | เนื้อหา |
|---|---|
| `webhook-id` | ID ไม่ซ้ำกันของ event ค่านี้เหมือนเดิมทุกครั้งที่ retry เลยใช้เป็น idempotency key ไปในตัว |
| `webhook-timestamp` | เวลาที่ส่งรอบนี้ เป็นวินาทีนับจาก Unix epoch ค่านี้เปลี่ยนทุกครั้งที่ลอง |
| `webhook-signature` | `v1,` ตามด้วย HMAC-SHA256 แบบ base64 ของ `id.timestamp.body` ระหว่าง rotation จะมีหลาย signature คั่นด้วยช่องว่าง |

secret คือ random byte ยาว 24 ถึง 64 byte เขียนเป็น base64 มี prefix `whsec_` ส่วน variant แบบ asymmetric ใช้ prefix `v1a,` ใน header แล้ว specification นี้ยังแนะนำรูปแบบ payload (`type`, `timestamp`, `data`) ให้ payload เล็กกว่า 20 KB ให้มีตาราง retry แบบ exponential backoff กับ jitter ที่ลากยาวหลายวัน และกำหนดความหมายให้ status code บางตัว: `410 Gone` บอกฝั่งส่งให้ปิด endpoint นั้น ส่วน `429`, `502` และ `504` บอกให้ส่งช้าลง

**CloudEvents** เป็น CNCF project ระดับ graduated ตัวนี้กำหนดมาตรฐานของ envelope แทน: ทุก event มี `id`, `source`, `type` และ `specversion` ตัว specification คู่กันของมัน *HTTP 1.1 Web Hooks for Event Delivery* บังคับให้ใช้ HTTPS กับ `POST` ให้ฝั่งส่งยืนยันตัวด้วย token (ใน header `Authorization` หรือ query parameter `access_token`) และเพิ่ม handshake ไว้กันการใช้ในทางที่ผิด: ฝั่งส่งต้องส่ง `OPTIONS` request ที่มี `WebHook-Request-Origin` ไปก่อน แล้วต้องเป็นปลายทางที่ตอบกลับด้วย `WebHook-Allowed-Origin` เท่านั้นถึงจะนับว่ายอมให้เรียก มันไม่ได้กำหนด signature ของ payload ไว้ เพราะฉะนั้น provider ที่อยากได้ทั้งสองอย่างก็ส่ง envelope แบบ CloudEvents แล้วเซ็นแบบ Standard Webhooks ได้

### payload พกอะไรมา

- payload แบบ **fat** (เรียกอีกอย่างว่า full หรือ snapshot) พก object ในสภาพตอนที่ event เกิดขึ้นมาด้วย ฝั่งรับไม่ต้องเรียกรอบสอง แต่ข้อมูลที่ก็อปมาอาจ stale ไปแล้วตอนที่ถูก process แล้วมันยังเปิดข้อมูลให้ทุกคนที่อ่าน request ได้เห็น แล้วรูปร่างของมันก็กลายเป็นสัญญา
- payload แบบ **thin** พกแค่ประเภท event กับ ID ที่เกี่ยวข้อง แล้วฝั่งรับไปดึง object จาก API เอง สิ่งที่อ่านได้จะเป็นค่าปัจจุบันเสมอ และมี access control ของ API คุ้มครองอยู่ ราคาที่ต้องจ่ายคือต้องเรียก API หนึ่งครั้งต่อ event หนึ่งตัว แต่ละครั้งต้องใช้ credential, นับรวมใน rate limit และล้มเหลวเมื่อ API ล่ม

Stripe มีให้ทั้งสองแบบ เรียกว่า *snapshot events* กับ *thin events* ส่วน provider หลายรายเลือกทางสายกลาง: ID กับประเภท บวก field ไม่กี่ตัวที่ฝั่งรับเกือบทุกรายต้องการ

payload แบบ fat คือ API response ที่เรา push ออกไป มันเลยต้องมี **versioning** เหมือน API ทั่วไป เพิ่ม field ได้ แต่อย่าเปลี่ยนหรือลบ field ภายใน version เดียวกัน ให้แต่ละ endpoint เลือก version ของตัวเอง และบอกใน payload ว่าเป็น version ไหน ตัว snapshot event ของ Stripe ทำ version ตาม API version ส่วน thin event ของมันไม่มี version ทำให้ integration ขยับไปใช้ API version ที่ใหม่กว่าได้โดยไม่ต้องตั้งค่า endpoint ใหม่ ส่วนฝั่งรับให้เมิน field ที่ไม่รู้จัก และตอบ `2xx` ให้ประเภท event ที่ไม่ได้จัดการ provider จะได้หยุด retry มัน

### การส่งรับประกันอะไรบ้าง

- **At least once** provider แยกไม่ออกระหว่าง "ไม่ได้รับ" กับ "ได้รับแล้ว แต่ `2xx` หายไประหว่างทาง" มันเลยส่งซ้ำ ทำให้ event ID เดียวกันมาถึงได้มากกว่าหนึ่งครั้ง และฝั่งรับต้องเป็น [idempotent consumer](../idempotent-consumer/)
- **ไม่มีลำดับ** การส่งวิ่งแบบขนานกัน แล้ว retry ก็มาถึงช้า ทำให้ `payment.refunded` แซง `payment.succeeded` ที่มันควรตามหลังได้ ทั้ง Stripe และ Shopify บอกไว้ชัดว่าไม่รับประกันลำดับ
- **ไม่ได้ส่งไปตลอดกาล** retry หยุดหลังผ่านไปหลายชั่วโมงหรือหลายวัน endpoint ที่ล่มนานกว่านั้นจะเสีย event ไปถาวร เว้นแต่จะไปดึงมาด้วยวิธีอื่น

### specification เทียบกับ provider สามราย

ตามเอกสาร ณ วันที่ 2 ตุลาคม 2026 รายละเอียดพวกนี้เปลี่ยนได้ ก่อนจะพึ่งมันให้เช็กเอกสารของ provider ก่อน

| | Standard Webhooks (specification) | Stripe | GitHub | Shopify (ส่งผ่าน HTTPS) |
|---|---|---|---|---|
| **Signature header** | `webhook-signature: v1,<base64>` | `Stripe-Signature: t=<time>,v1=<hex>` | `X-Hub-Signature-256: sha256=<hex>` | `X-Shopify-Hmac-SHA256: <base64>` |
| **HMAC-SHA256 คำนวณจาก** | `id.timestamp.body` | `timestamp.body` | body | body |
| **Key** | secret หนึ่งตัวต่อ endpoint | secret หนึ่งตัวต่อ endpoint, `whsec_…` | secret ที่เราเลือกเองตอนสร้าง webhook | client secret ของแอป |
| **กัน replay** | ฝั่งรับเช็ก `webhook-timestamp` เทียบกับค่า tolerance | timestamp ที่เซ็นไว้ ค่า default ใน library ของ Stripe คือ 5 นาที | ไม่มี timestamp ที่เซ็นไว้ | ไม่มี timestamp ที่เซ็นไว้ |
| **ID ที่ใช้ตัดตัวซ้ำ** | `webhook-id` | `id` ของ event | `X-GitHub-Delivery` ที่ไม่เปลี่ยนตอน redeliver | `X-Shopify-Webhook-Id` |
| **เวลาที่ให้ตอบ** | แนะนำให้ฝั่งส่งรอ 15 ถึง 30 s | ไม่ได้ให้ตัวเลข: ให้คืน `2xx` ก่อนทำ logic ที่ซับซ้อน | 10 s | 1 s สำหรับการต่อ connection และ 5 s สำหรับทั้ง request |
| **Retry อัตโนมัติ** | แนะนำ backoff กับ jitter ตลอดหลายวัน ตัวอย่างของมันลอง 10 ครั้งในเวลามากกว่า 3 วันนิดหน่อย | live mode: นานสูงสุด 3 วัน แบบ exponential backoff ส่วน sandbox: 3 ครั้งในไม่กี่ชั่วโมง | ไม่มี | retry 8 ครั้งใน 4 ชั่วโมง ถ้าล้มเหลวติดกัน 8 ครั้ง subscription ที่สร้างผ่าน Admin API จะถูกลบ |

GitHub ปล่อยเรื่องการกู้คืนให้ subscriber จัดการเอง: การส่งที่ล้มเหลวจะล้มเหลวอยู่อย่างนั้นจนกว่าจะมีคน redeliver ด้วยมือหรือผ่าน REST API และเอกสารของ GitHub ก็มีตัวอย่าง script ที่ตั้งเวลาไว้ทำเรื่องนี้ ส่วน Stripe ให้ส่ง event ซ้ำจาก Dashboard ได้ภายใน 15 วันหลังสร้าง และผ่าน Stripe CLI ได้ภายใน 30 วัน

## ใช้ตอนไหนดี

- ระบบขององค์กรหนึ่งต้องแจ้งระบบของอีกองค์กร แบบ server ถึง server: payment, source control, commerce, messaging, identity provider
- platform อยากให้ระบบของลูกค้าตอบสนองต่อสิ่งที่เกิดขึ้นข้างใน โดยไม่ต้องให้เข้าถึงไส้ในของตัวเอง
- event ของ subscriber แต่ละรายมีนาน ๆ ครั้งถึงบ่อยปานกลาง และหน่วงเป็นวินาทีได้ไม่มีปัญหา
- **ไม่เหมาะกับ stream ปริมาณสูง** HTTP request หนึ่งครั้งต่อ event หนึ่งตัว แต่ละครั้งมี signature, state ของ retry และ log entry ของตัวเอง เป็นวิธีที่แพงมากถ้าต้องย้าย event หลักพันตัวต่อวินาที ให้ใช้ log หรือ event bus ที่มี batching กับ cursor แทน
- **ไม่เหมาะเมื่อเรียกฝั่งรับไม่ได้** browser, mobile app, desktop app, command-line tool และ server ที่อยู่หลัง firewall ไม่มี public endpoint พวกนี้ต้อง poll, เปิด connection ค้างไว้ หรือใช้ relay ที่ทำแบบนั้นให้ ตอน develop บนเครื่องตัวเอง ก็มี tunnel หรือ tooling ของ provider ช่วยปิดช่องนี้ได้ (Stripe CLI forward event ไปที่ `localhost` ได้)
- **ไม่เหมาะเมื่อฝั่งเรียกต้องการคำตอบ** response ของ webhook บอกแค่ว่า "ได้รับแล้ว" ถ้า provider ต้องการผลลัพธ์ นั่นคือ API call ธรรมดา
- **ไม่เหมาะภายในระบบเดียว** ถ้าทั้งสองฝั่งใช้ broker ร่วมกันได้ ให้ [publish event เข้าไปที่ broker](../event-driven-architecture/) แล้วได้ retention กับ replay จากมันไปเลย

## ได้อะไร เสียอะไร

- **ฝั่งรับต้องเป็น public และแทบไม่เคยล่ม** มันคือ endpoint ที่หันหน้าเข้า internet เพิ่มมาอีกตัวที่ต้องดูแลเรื่อง security และ operate และตอนที่มันล่มก็จะกลายเป็น retry แล้วกลายเป็น event ที่หายไป
- **ไม่มี back-pressure** provider เป็นคนกำหนดจังหวะ burst (ทุก subscription ต่ออายุพร้อมกันวันที่หนึ่งของเดือน) ก็มาถึงเป็น burst แล้วเบรกเดียวที่ฝั่งรับมีคือ queue ของตัวเอง กับ `429` หรือ `503` ที่ provider อาจทำตามหรือไม่ก็ได้
- **event ซ้ำและผิดลำดับเป็นปัญหาของฝั่งรับ** handler ต้องมีบันทึก ID ที่ process ไปแล้ว และมีกติกาสำหรับ event ที่ stale ถ้าเป็น log ที่มีลำดับและอ่านด้วย cursor ก็จะทำงานส่วนใหญ่นี้ให้แล้ว
- **งาน security ทั้งสองฝั่ง** ฝั่งรับต้อง verify ทุก request และเฝ้า secret ไว้ ฝั่ง provider ต้องยิง request ไปที่ URL ที่ user เลือกเอง นี่คือช่องโหว่ตามตำราของ server-side request forgery
- **provider แต่ละรายไม่เหมือนกัน** ชื่อ header, สิ่งที่เซ็น, timeout, ตาราง retry และการ redeliver ต่างกันไปหมด integration แต่ละตัวเลยต้องเขียนและ test แยกกัน Standard Webhooks มีขึ้นมาเพื่อลดเรื่องนี้
- **มองภาพตั้งแต่ต้นจนจบได้ยาก** webhook ที่หายไปอาจเป็น event ที่ไม่เคยถูกยิง, subscription ที่ไม่ครอบคลุมประเภทนั้น, การส่งที่ล้มเหลว หรือ handler ที่ throw ออกมา ถ้าไม่มี delivery log ฝั่งหนึ่งกับ request log อีกฝั่ง ก็ไม่มีใครบอกได้ว่าเป็นอันไหน

## ข้อควรรู้ตอนลงมือทำ

### ฝั่งรับ

- **Verify ก่อน บน raw byte** อ่าน body ก่อนที่ JSON middleware ตัวไหนจะไปแตะมัน ใน Express คือใช้ `express.raw()` บน route ของ webhook ส่วน framework อื่นก็มีของที่เทียบเท่ากัน เช็ก timestamp คำนวณ HMAC เทียบแบบ constant time และใช้ library ของ provider ถ้ามี สำหรับฝั่งส่งที่ทำตาม Standard Webhooks การเช็กจะหน้าตาแบบนี้:

  ```python
  import base64, hashlib, hmac, time

  def verify(secret: str, headers: dict, raw_body: bytes, tolerance: int = 300) -> bool:
      key = base64.b64decode(secret.removeprefix("whsec_"))
      msg_id, sent_at = headers["webhook-id"], headers["webhook-timestamp"]
      if abs(time.time() - int(sent_at)) > tolerance:      # too old or too far ahead: a replay
          return False
      signed = f"{msg_id}.{sent_at}.".encode() + raw_body  # the bytes as received
      expected = hmac.new(key, signed, hashlib.sha256).digest()
      for candidate in headers["webhook-signature"].split(" "):  # several during a rotation
          version, _, signature = candidate.partition(",")
          if version == "v1" and hmac.compare_digest(expected, base64.b64decode(signature)):
              return True
      return False
  ```

- **ปฏิเสธโดยไม่ต้องอธิบาย** ตอบ signature ที่ผิดด้วย `4xx` เช่น `401` กับ body ว่าง และรับเฉพาะ signature scheme ที่เราคาดไว้ ยกเว้น route นี้จากการเช็ก CSRF ที่ framework ใช้กับ form post: provider ไม่มี token จะส่งมา และ signature ก็คือตัวควบคุมที่มาแทนมัน
- **ลง queue ก่อน แล้วค่อยตอบ** เขียน event ที่ verify แล้วลง durable queue หรือ table แล้วคืน `2xx` ต้องคืนหลังจากเขียนสำเร็จแล้วเท่านั้น ไม่งั้นถ้า crash ก็จะเสีย event ที่ provider เชื่อว่าส่งถึงแล้ว queue นี้ยังให้ [load levelling](../queue-based-load-leveling/) ตอนที่ burst มาถึงด้วย
- **ตัดตัวซ้ำด้วย event ID** บันทึก ID ด้วย unique key ใน transaction เดียวกับงาน ตามที่ pattern [idempotent consumer](../idempotent-consumer/) อธิบายไว้ และเก็บ ID ไว้นานกว่าช่วงที่ provider ยังส่ง event นั้นได้: ช่วง retry ของมัน บวกเวลาที่อาจมีคน redeliver ด้วยมือ Stripe บอกว่าบางครั้งการเปลี่ยนแปลงหนึ่งครั้งก็สร้าง event สองตัวที่ ID ต่างกัน มีแค่การเช็กที่ตัว object กับประเภท event เท่านั้นที่จับพวกนี้ได้
- **อย่าเชื่อลำดับที่มาถึง** กติกาที่ทนทานคือถือว่า event เป็นแค่คำใบ้ แล้วไปดึง state ปัจจุบันของ object จาก API ถ้าจะใช้ payload ตรง ๆ ให้ใช้ก็ต่อเมื่อมันใหม่กว่าของที่ถืออยู่ โดยใช้ version หรือ sequence number ถ้า provider มีระบุไว้ ส่วน timestamp นั้นอ่อนกว่า: Shopify แนะนำ header `X-Shopify-Triggered-At` หรือ `updated_at` ใน payload ส่วน Stripe เตือนว่า field `created` ของมันละเอียดแค่หนึ่งวินาที และไม่ควรใช้เรียงลำดับ event ไม่ว่ายังไงก็ให้เทียบเวลาที่ event *เกิดขึ้น* ห้ามใช้ timestamp ของการส่ง เพราะค่านั้นใหม่ทุกครั้งที่ลอง
- **Reconcile และ subscribe ให้แคบ** ตั้ง job ที่รันเป็นระยะ ไล่ดู object หรือ event ล่าสุดจาก API แล้วซ่อมสิ่งที่ webhook พลาดไป เอกสารของ Shopify บอกตรง ๆ ว่าแอปไม่ควรพึ่ง webhook อย่างเดียว ขอเฉพาะประเภท event ที่จัดการจริง: ที่เหลือเป็นแค่ load และเป็นข้อมูลที่เราไม่มีเหตุผลต้องถือไว้
- **พักสิ่งที่ล้มเหลวซ้ำ ๆ ไว้** event ที่ worker process ไม่ได้หลังลองไปหลายครั้ง ควรไปอยู่ใน dead-letter queue พร้อม alert ไม่ใช่ส่งกลับไปให้ provider เป็น `500`: provider ทำอะไรกับ bug ของเราไม่ได้
- **คอยเฝ้าดู** ตั้ง alert เมื่อ signature ไม่ผ่าน (มีคนกำลังลองเจาะ) เมื่ออายุของ event ที่เก่าที่สุดใน queue สูงขึ้น และเมื่อเงียบผิดปกติ: endpoint ที่ปกติได้ยินอะไรสักอย่างทุกนาทีแต่เงียบไปหนึ่งชั่วโมง น่าจะถูกปิดไปแล้ว
- **ระวังสิ่งที่วางอยู่ข้างหน้า** ปกติ endpoint จะอยู่หลัง [API gateway](../api-gateway/) หรือ load balancer ต้องแน่ใจว่าไม่มีอะไรตรงนั้นเขียน body ใหม่ และ [rate limit](../rate-limiting/) ของมันเผื่อที่ไว้สำหรับ burst จาก provider

### ฝั่งส่ง

- **อย่าทำ event หายก่อนมันจะออกไป** เขียน event ใน transaction เดียวกับการเปลี่ยนแปลงทาง business แบบที่ [transactional outbox](../transactional-outbox/) ทำ แล้วให้ระบบส่งอ่านจากตรงนั้น
- **หนึ่ง queue ต่อ endpoint** endpoint ที่ตายแล้วจะถือทุก request ไว้จนถึง timeout ถ้าการส่งใช้ worker pool ร่วมกัน subscriber รายเดียวล่มก็ทำให้ event ของทุกคนช้าไปด้วย ให้แยก queue และจำกัด concurrency ต่อ endpoint แบบนี้ subscriber ที่ช้าจะได้ทำให้ช้าแค่ตัวเอง
- **Back off พร้อม jitter เป็นวัน ๆ** ทำตาม [retry with backoff](../retry-with-backoff/): ระยะเว้นที่ยาวขึ้นจากหลักวินาทีไปจนถึงหลักชั่วโมง สุ่มให้กระจาย retry จะได้ไม่มาเป็นระลอกพร้อมกัน และเคารพ header `Retry-After` ถ้าฝั่งรับส่งมา เซ็นทุกครั้งที่ลองใหม่ด้วย timestamp ใหม่ และคง event ID เดิมไว้
- **เลิกเรียก endpoint ที่ล้มเหลวไม่หยุด** หลังล้มเหลวมาหลายวัน ให้ปิด endpoint แล้วแจ้งเจ้าของผ่านช่องทางอื่นอย่าง email ถือว่า `410 Gone` คือการ unsubscribe นี่คือ [circuit breaker](../circuit-breaker/) ที่มีคนอยู่ใน loop
- **เปิด log ให้ดู** ให้ subscriber เห็นทุกครั้งที่ลอง พร้อมเวลา, status code และระยะเวลา และมีทาง replay การส่งครั้งเดียวหรือทั้งหมดในช่วงเวลาหนึ่ง ทั้งใน UI และผ่าน API
- **ป้องกัน server-side request forgery** URL ที่ subscriber ให้มาอาจชี้เข้า network ของเราเอง หรือชี้ไปที่ cloud metadata service รับเฉพาะ URL ที่เป็น `https` แล้ว resolve hostname แล้วปฏิเสธ address ที่เป็น loopback, private, link-local และ address อื่นที่ไม่ใช่ public ทั้ง IPv4 และ IPv6 จากนั้นต่อไปที่ address ที่เช็กแล้ว เพื่อให้ DNS lookup รอบที่สองสลับมันไม่ได้ อย่า follow redirect แล้วให้ส่งออกจาก network segment ที่แยกไว้ หรือผ่าน egress proxy ที่บังคับกติกาเดียวกัน (Smokescreen ที่เป็น open source ของ Stripe ก็เป็นตัวหนึ่ง) และตัด response body ใน delivery log ให้สั้นลง ช่องโหว่ในการเช็กพวกนี้จะได้ไม่กลายเป็นทางอ่าน response ภายใน
- **พิสูจน์ว่า subscriber เป็นเจ้าของ URL จริง** ก่อนส่งข้อมูลจริง ด้วย challenge ที่มันต้องสะท้อนกลับมา หรือด้วย handshake `OPTIONS` ของ CloudEvents ไม่งั้นใครก็ชี้ระบบส่งของเราไปที่เว็บของคนอื่นได้
- **secret หนึ่งตัวต่อ endpoint** สุ่มและยาว (Standard Webhooks ขอ 24 ถึง 64 byte) และ rotate แบบมีช่วงซ้อนได้ ระหว่างช่วงซ้อนให้เซ็นด้วยทุก secret ที่ยัง active
- **ให้ payload เล็กเข้าไว้** และบอกว่ามันคืออะไร: ประเภท event, ID, เวลาที่ event เกิดขึ้น และ version
