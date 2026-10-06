## ปัญหา

เว็บที่ serve จาก region เดียวจะเร็วแค่กับผู้ใช้ที่อยู่ใกล้ region นั้น คนอื่นต้องเสีย round trip ยาว ๆ ทุก request และเสียหลายรอบตอนเปิด connection ใหม่ เพราะ TCP และ TLS handshake ต้องข้ามระยะทางเดียวกันก่อน ในขณะเดียวกัน origin ก็ทำงานเดิมซ้ำไปซ้ำมา: request ส่วนใหญ่ขอไฟล์ที่เหมือนกันสำหรับผู้ใช้ทุกคนและเปลี่ยนแค่ตอน deploy แต่ request แต่ละตัวก็ยังกิน compute และ outbound bandwidth และ traffic spike หรือการโจมตีทุกครั้งก็ลงที่ origin ตรง ๆ

## ทำงานยังไง

content delivery network (CDN) รัน **shared HTTP cache** ไว้ใน **edge location** (points of presence หรือ PoP) จำนวนมากทั่วโลก hostname ของเว็บชี้ไปที่ CDN แล้ว DNS หรือ anycast routing ก็ส่งผู้ใช้แต่ละคนไปที่ edge ที่อยู่ใกล้เขา

- **Miss** edge หา request นั้นด้วย **cache key** ของมัน ถ้าไม่มี response เก็บไว้ ก็ forward request ไปที่ **origin** เก็บคำตอบไว้ถ้า header ของ origin ยอม แล้วส่งกลับไป ผู้ใช้คนแรกนี้เป็นคนจ่ายค่าเดินทางไป origin
- **Hit** request หลังจากนั้นที่ key เดียวกันจะได้คำตอบจาก edge พร้อม header `Age` ที่บอกว่า response มาจาก origin ได้กี่วินาทีแล้ว ตัว origin ไม่เห็น request พวกนี้เลย
- **หมดอายุ** response ที่เก็บไว้จะ *fresh* อยู่ตามอายุที่ origin กำหนดให้ หลังจากนั้นมันจะ *stale* และ edge จะ **revalidate** มันด้วย conditional request ก่อนจะใช้อีกครั้ง
- **เปลี่ยนแปลง** content ใหม่ไปถึงผู้ใช้ได้สองทาง คือผ่าน **URL ใหม่** ที่เป็น cache key ใหม่ หรือผ่านการ **purge** ที่ลบสำเนาเก่าออกจากทุก edge

edge location แต่ละที่เติม cache ของตัวเองแยกกัน: response ที่ cache ไว้ใน Bangkok ก็ยังเป็น miss ใน Frankfurt

diagram ตามดูสองไฟล์: หน้า `/index.html` ที่ทุก edge มีอยู่แล้วตอนเริ่ม loop และ script `/app.9f3c.js` ที่หน้านั้นโหลด และยังไม่มีใครขอเลย ตัวเลข latency เป็น round-trip time ที่ยกมาเป็นตัวอย่าง และนาฬิกาของมันเดินเร็ว: สำเนาที่ cache ไว้จะแก่ขึ้น 20 วินาทีต่อ animation หนึ่งวินาที อายุ 600 วินาทีเลยหมดลงได้ภายใน loop

นี่คือ HTTP caching ในฐานะ infrastructure: ผู้ใช้ทุกคนใช้ร่วมกัน วางตามภูมิศาสตร์ และควบคุมด้วย response header แอปพลิเคชันที่มี cache ของตัวเองอยู่หน้าฐานข้อมูลกำลังทำ [Cache-Aside](../cache-aside/) และ response cache ของ [API Gateway](../api-gateway/) ก็เป็น cache ตัวเดียวที่อยู่ข้าง ๆ service แทนที่จะอยู่ใกล้ผู้ใช้

### อะไรควรอยู่บน CDN

| Content | cache ไว้ที่ edge ไหม |
|---|---|
| asset ที่มี fingerprint: bundle ของ script และ style, font และรูปที่มี content hash อยู่ในชื่อ | ได้ นานเท่าไรก็ได้ content ที่อยู่หลัง URL แบบนี้ไม่มีวันเปลี่ยน |
| media และไฟล์ดาวน์โหลด: video segment, installer, PDF | ได้ ไฟล์พวกนี้ใหญ่ เลยเป็นส่วนใหญ่ของ byte ที่ประหยัดได้ |
| หน้าเว็บสาธารณะและ response ของ API สาธารณะ: `GET` ที่ได้คำตอบเหมือนกันสำหรับทุกคน | ได้ โดยตั้งอายุสั้น ๆ หรือ purge เมื่อมันเปลี่ยน แค่ cache ไว้ไม่กี่วินาทีก็ช่วยรับ spike ได้แล้ว |
| อะไรที่เป็นของส่วนตัว: หน้า account, ตะกร้าสินค้า, response ของ request ที่มี `Authorization` หรือ session cookie, response ที่ set cookie | **ไม่** ให้ส่ง `Cache-Control: private` (browser ของผู้ใช้เก็บไว้ได้) หรือ `no-store` (ห้ามใครเก็บเลย) |

ปกติ HTTP ป้องกันแถวสุดท้ายได้แค่บางส่วน shared cache จะใช้ response ของ request ที่มี `Authorization` ซ้ำไม่ได้ เว้นแต่ response นั้นจะมี `public`, `s-maxage` หรือ `must-revalidate` ส่วน cookie ไม่ได้รับการป้องกันแบบนี้: RFC 9111 ระบุว่า `Set-Cookie` ไม่ได้ห้ามการ cache ส่วนบาง product ก็เพิ่มตัวกันของตัวเอง (Cloudflare จะไม่ cache response ที่ set cookie หรือไม่ก็ตัด cookie ออกก่อน cache แล้วแต่ setting) แต่การติด label ให้ response ที่เป็นของส่วนตัวเป็นหน้าที่ของ origin ไฟล์ที่เป็นของส่วนตัวแต่เหมือนกันสำหรับทุกคนที่มีสิทธิ์เห็น เช่นไฟล์ดาวน์โหลดแบบเสียเงิน ยัง serve จาก edge ได้ ถ้า edge เช็ก signed URL หรือ signed cookie ก่อน นี่คือแนวคิดเบื้องหลัง pattern Valet Key

### Cache key

key เป็นตัวตัดสินว่า request ไหนใช้ response ที่เก็บไว้ร่วมกัน RFC 9111 สร้าง key จากอย่างน้อย method กับ target URI ในทางปฏิบัติก็คือ host, path และ query string ของ `GET` ส่วน response ก็ขยาย key ของตัวเองได้ด้วย `Vary`: `Vary: Accept-Encoding` แยก variant แบบ gzip กับ Brotli ออกจากกัน

แต่ละ product เริ่มจาก default ที่ต่างกัน เลยต้องอ่านของตัวที่คุณใช้ให้ดี key default ของ CloudFront มีแค่ domain name ของ distribution กับ URL path ส่วน query string, header และ cookie จะเข้ามาอยู่ใน key เมื่อ cache policy เพิ่มเข้าไป ส่วน key default ของ Cloudflare คือ URL เต็ม (scheme, host, path และ query string) บวก request header `Origin` กับ forwarding header อีกไม่กี่ตัว และโดย default มันจะสนใจ `Vary` แค่ `Accept-Encoding`

key ผิดได้สองทาง:

- **กว้างเกินไป:** มันรวมสิ่งที่ไม่ได้ทำให้ response เปลี่ยน เช่น tracking parameter (`utm_source`), query parameter ที่เรียงลำดับสุ่ม ๆ หรือ `Vary: User-Agent` ทุก variant กลายเป็น entry ของตัวเอง hit ratio ดิ่งลง และใครก็บังคับให้ miss ได้แค่เติม parameter สุ่มเข้าไป
- **แคบเกินไป:** response ขึ้นกับอะไรที่ไม่อยู่ใน key เช่น header ที่แอปพลิเคชันก็อปลงไปในหน้า (`X-Forwarded-Host` คือตัวอย่างคลาสสิก), cookie หรือประเทศของผู้เข้าชม ทำให้ variant ของผู้ใช้คนหนึ่งถูก serve ให้คนถัดไป ถ้าผู้โจมตีส่ง input นั้นมาโดยตั้งใจ ก็คือ **web cache poisoning**: request ที่ทำขึ้นมาพิเศษตัวเดียวเก็บ response อันตรายไว้ แล้ว edge ก็ยื่นมันให้ทุกคนที่ขอ URL นั้น

**Web cache deception** กลับด้านปัญหา ผู้โจมตีหลอกให้เหยื่อที่ sign in อยู่เปิด URL ที่ origin มองว่าเป็นหน้าส่วนตัว แต่ CDN มองว่าเป็นไฟล์ static เช่น `/account/x.css` บน origin ที่ไม่สนส่วนท้ายของ path แล้ว CDN ก็เก็บหน้าของเหยื่อไว้ จากนั้นผู้โจมตีก็มาดึงไป มันได้ผลเมื่อ cache ตัดสินจากนามสกุลไฟล์หรือ path ในขณะที่ origin ตัดสินจาก routing ของตัวเอง ให้ `Cache-Control` ของ origin เป็นคนตัดสินว่าอะไร cache ได้ ส่ง `private` หรือ `no-store` กับ response ที่เป็นของส่วนตัว และตอบ 404 กับ path ที่ไม่มีอยู่จริง ยกตัวอย่าง Cache Deception Armor ของ Cloudflare จะไม่ยอม cache response ที่ `Content-Type` ไม่ตรงกับนามสกุลใน URL

### Freshness: `Cache-Control` ใน shared cache

| Directive | บอกอะไรกับ edge |
|---|---|
| `max-age=N` | fresh อยู่ N วินาที ในทุก cache: ทั้ง edge และ browser |
| `s-maxage=N` | สำหรับ shared cache เท่านั้น ใช้แทน `max-age` และ `Expires` และยังห้ามไม่ให้ shared cache serve response แบบ stale โดยไม่ revalidate ก่อน |
| `public` | เก็บได้ แม้ในจุดที่ปกติเก็บไม่ได้ เช่น response ของ request ที่มี `Authorization` ส่วน response ทั่วไปที่ cache ได้อยู่แล้วไม่ต้องใช้มัน |
| `private` | มีไว้สำหรับผู้ใช้คนเดียว: shared cache ห้ามเก็บ แต่ browser ของผู้ใช้เก็บได้ |
| `no-store` | ไม่มี cache ไหนเก็บได้ |
| `no-cache` | เก็บได้ แต่ทุกครั้งที่จะใช้ซ้ำต้อง revalidate กับ origin ก่อน มันไม่ได้แปลว่า "ห้าม cache" |
| `must-revalidate` | พอ stale แล้ว ห้ามใช้ซ้ำถ้า revalidate ไม่สำเร็จ แม้จะติดต่อ origin ไม่ได้ก็ตาม |
| `immutable` (RFC 8246) | content จะไม่เปลี่ยนระหว่างที่ยัง fresh ทำให้ browser ข้ามการ revalidate ที่ปกติจะทำตอน reload |
| `stale-while-revalidate=N` (RFC 5861) | ภายใน N วินาทีหลังหมดอายุ ให้ตอบจากสำเนาที่ stale แล้ว refresh อยู่เบื้องหลัง |
| `stale-if-error=N` (RFC 5861) | ภายใน N วินาทีหลังหมดอายุ ให้ตอบจากสำเนาที่ stale ถ้า origin ตอบ 500, 502, 503 หรือ 504 |

directive เหล่านี้นิยามไว้ใน RFC 9111 ที่มาแทน RFC 7234 ในปี 2022 เว้นแต่ในตารางจะระบุ RFC อื่นไว้

- **ลำดับความสำคัญ** shared cache เอาอายุจาก `s-maxage` ก่อน แล้วค่อย `max-age` แล้วค่อย `Expires` ถ้าไม่มีสักตัว มันอาจเดาเอง (*heuristic freshness* ปกติคือหนึ่งในสิบของเวลาตั้งแต่ `Last-Modified`) หรือใช้ default ของ product: default TTL ของ CloudFront คือ 24 ชั่วโมง เว้นแต่ cache policy จะตั้งค่าอื่น และ Cloudflare เก็บ `200` ไว้ 120 นาที แต่เฉพาะนามสกุลไฟล์ที่มัน cache โดย default และนามสกุลพวกนั้นไม่รวม HTML กับ JSON สรุปคือส่ง header แบบ explicit กับทุกอย่าง
- **Serve แบบ stale** cache จะ serve response ที่ stale ได้ก็ต่อเมื่อ directive หรือ configuration ของมันเองยอม หรือเมื่อมันติดต่อ origin ไม่ได้ `s-maxage`, `must-revalidate` และ `no-cache` ห้ามเรื่องนี้ Cloudflare ถึงเขียนไว้ใน documentation ว่า `s-maxage` ปิด `stale-while-revalidate` ถ้าจะแยกอายุของ browser กับ edge *และ* serve แบบ stale ระหว่าง revalidate ให้ใช้ targeted header
- **Targeted cache control (RFC 9213)** `CDN-Cache-Control` ใช้ directive ชุดเดียวกัน แต่มีแค่ CDN cache ที่อ่าน และ CDN cache จะไม่สน `Cache-Control` กับ `Expires` ของ response นั้น ยกตัวอย่าง `Cache-Control: no-cache` คู่กับ `CDN-Cache-Control: max-age=600, stale-while-revalidate=60` ทำให้ browser เช็กทุกครั้ง ในขณะที่ edge เก็บหน้าไว้สิบนาที การรองรับต่างกันไป: Cloudflare อ่าน `CDN-Cache-Control` และ `Cloudflare-CDN-Cache-Control` ของตัวเอง ส่วน Fastly ใช้ `Surrogate-Control` ที่เก่ากว่า และจะตัด header นี้ออกก่อน response ออกจาก network ของมัน
- **`Cache-Status` (RFC 9211)** เป็นวิธีมาตรฐานที่ cache ใช้บอกว่ามันทำอะไรไป cache แต่ละตัวบนเส้นทางจะเพิ่ม entry: `ExampleCDN; hit; ttl=412` สำหรับ hit ที่เหลือ freshness อีก 412 วินาที, `ExampleCDN; fwd=uri-miss; stored` สำหรับ miss ที่ถูกเก็บไว้, `ExampleCDN; fwd=stale; fwd-status=304` สำหรับการ revalidate ส่วน CDN หลายเจ้ายังส่ง header ของตัวเองอยู่ อย่าง `CF-Cache-Status` ของ Cloudflare รายงาน `HIT`, `MISS`, `EXPIRED`, `REVALIDATED` และอื่น ๆ

### Validator และ conditional request

*validator* (RFC 9110) ทำให้ cache ถามได้ว่า "อันนี้เปลี่ยนไหม?" แทนที่จะดาวน์โหลด response ใหม่ทั้งหมด `ETag` เป็นตัวระบุ version แบบ opaque ที่ origin เลือก (strong หรือ weak ถ้าเขียนเป็น `W/"…"`) ส่วน `Last-Modified` เป็น timestamp ที่ละเอียดระดับหนึ่งวินาที edge ส่งพวกนี้กลับไปเป็น `If-None-Match` และ `If-Modified-Since` ถ้ามีทั้งคู่ origin จะยึดตาม `If-None-Match`

ถ้าสำเนาที่เก็บไว้ยังเป็นปัจจุบัน origin จะตอบ **304 Not Modified**: ไม่มี body มีแค่ header อย่าง `Cache-Control`, `ETag` และ `Date` ที่ edge จะ merge เข้าไปใน response ที่เก็บไว้เพื่อให้มัน fresh อีกครั้ง ถ้าไม่ใช่แบบนั้น origin ก็ตอบ 200 พร้อม content ใหม่มาแทนของเดิม

ผลที่ตามมามีสองข้อ การ revalidate ประหยัด byte แต่ไม่ได้ประหยัด round trip: ผู้ใช้ที่ request ของเขาทำให้เกิดการ revalidate ยังต้องรอ origin เว้นแต่ `stale-while-revalidate` จะให้ edge ตอบไปก่อนแล้วค่อยเช็กทีหลัง และถ้าไม่มี validator การหมดอายุทุกครั้งต้องดาวน์โหลดเต็ม ๆ เลยต้องแน่ใจว่า origin server ทุกตัวสร้าง `ETag` เดียวกันสำหรับไฟล์เดียวกัน

### URL ใหม่หรือ purge

**ชื่อไฟล์ที่มี version** คือวิธีเปลี่ยน content ที่ถูกที่สุด ใส่ hash ของ content ลงในชื่อ (`/app.9f3c.js`) แล้วทุก build ที่เปลี่ยนไฟล์ก็จะเปลี่ยน URL ของมันด้วย ไม่มีอะไรต้อง invalidate เลย ส่วนไฟล์เก่ากับใหม่ก็อยู่ด้วยกันได้ หน้าที่เปิดอยู่แล้วเลยยังใช้ได้ rollback ก็แค่กลับไปใช้หน้าเก่า และ URL ใหม่ไปถึง browser และ proxy ระหว่างทางที่ purge ไม่มีทางเข้าไปถึงได้ documentation ของ CloudFront ก็แนะนำให้ใช้ versioning แทน invalidation ด้วยเหตุผลคล้าย ๆ กัน ให้เก็บไฟล์ของ build ก่อนหน้าไว้บน origin สักพัก

หน้าที่อ้างถึงไฟล์พวกนั้นเปลี่ยนชื่อไม่ได้ เลยต้องใช้ **purge** (หรือเรียกว่า invalidation):

- **ตาม URL, prefix หรือ wildcard, ตาม hostname หรือทั้งหมด** purge ให้แคบที่สุดเท่าที่ทำได้ object ทุกตัวที่ถูก purge จะ miss ใน request ถัดไปที่ทุก edge และการ purge ทั้งหมดจะส่ง traffic ของทั้งเว็บไปที่ origin พร้อมกัน
- **ตาม tag** origin ติด label ให้แต่ละ response ตามสิ่งที่มันพึ่ง (`product-42`, `template-home`) แล้วการเรียกครั้งเดียวก็ purge ทุกอย่างที่มี label นั้น Fastly อ่าน label จาก header `Surrogate-Key`, Cloudflare จาก `Cache-Tag` และ CloudFront จาก header ที่คุณตั้งชื่อไว้ใน configuration ของ distribution
- **ใช้เวลานานแค่ไหน** purge เร็วแต่ไม่ atomic ทั่วโลก Fastly ระบุไว้ราว 150 ms สำหรับ purge ตาม URL และ surrogate-key และนานสุด 2 นาทีสำหรับ purge-all ส่วน CloudFront ส่งต่อ invalidation ไปทุก edge location ภายในไม่กี่วินาที และ Cloudflare บอกว่า purge ของมันเกิดขึ้นทันที ลำดับที่ถูกคือ deploy ไปที่ origin ก่อน แล้วค่อย purge ไม่อย่างนั้น edge อาจเติม version เก่ากลับเข้าไป
- **อะไรที่มันเอื้อมไม่ถึง** สำเนาใน browser และใน proxy ที่อยู่เลย CDN ออกไปจะอยู่จนครบ `max-age` ของตัวเอง หน้าเว็บถึงได้อายุฝั่ง browser สั้น ๆ และ asset ถึงใช้ versioning แทนการ purge
- **Soft purge** CDN บางเจ้า mark object ว่า stale แทนที่จะลบทิ้งได้ (soft purge ของ Fastly) ทำให้ `stale-while-revalidate` และ `stale-if-error` ยังมีอะไรให้ serve

### miss น้อยลงและถูกลง

เพราะแต่ละ edge location miss ของมันเอง ไฟล์หนึ่งจะถูกดึงจาก origin หนึ่งครั้งต่อ location และ content ที่มีคนขอนาน ๆ ที อาจไม่เคยค้างอยู่ใน cache ที่ไหนเลย: อายุเป็นแค่ขอบบน และอย่าง CloudFront ก็ evict ไฟล์ที่มีคนขอน้อยออกก่อนมันจะหมดอายุ

- **Tiered caching หรือ origin shield** edge จะถาม parent cache แทนที่จะถาม origin การดึงครั้งเดียวเลยเติมได้หลาย location และ origin ก็คุยกับ cache แค่ไม่กี่ตัวแทนที่จะเป็นหลายร้อยตัว อย่าง CloudFront ก็มี regional edge cache และมี Origin Shield เป็นตัวเลือกแบบเสียเงิน คือ caching layer อีกชั้นหน้า origin ที่ layer อื่น ๆ ต้องดึงผ่าน ส่วน Tiered Cache ของ Cloudflare ให้แค่ data centre ระดับบนติดต่อ origin ได้ และ Smart Tiered Cache ของมันจะเลือก upper tier ที่ใกล้ origin แต่ละตัวที่สุด Fastly เรียกว่า shielding: PoP เดียวที่คุณเลือกเป็นคนส่ง request ไปที่ origin
- **Request collapsing** เมื่อมีหลาย request miss ที่ key เดียวกันในจังหวะเดียวกัน edge จะ forward ไปแค่ตัวเดียว แล้วตอบทุกตัวจาก response นั้น ช่วยหยุด stampede ตอนที่ object ยอดนิยมหมดอายุ CloudFront กับ Fastly ทำแบบนี้โดย default ข้อควรระวัง: ถ้า response นั้นกลายเป็นแบบที่ cache ไม่ได้ ตัว request ที่รออยู่จะถูก forward ทีละตัว เลยต้องทำให้ response ที่เป็นของส่วนตัวดูออกว่าเป็นของส่วนตัว
- **`stale-while-revalidate`** เอา stampede ออกไปจากการหมดอายุ เพราะไม่มีใครต้องรอ refresh

## ใช้ตอนไหนดี

- ผู้ใช้กระจายอยู่หลาย region หรือหลายทวีป และสิ่งที่พวกเขาดาวน์โหลดส่วนใหญ่เหมือนกันสำหรับทุกคน: asset, media, ไฟล์ดาวน์โหลด, หน้าเว็บสาธารณะ, response ของ API สาธารณะ
- traffic มาเป็น spike (เปิดตัว, sale, ข่าว) และ origin ไม่ควรต้องตั้งขนาดไว้รับ peak
- origin ควรถูกกันไว้จาก internet ส่วน edge ก็ยังเป็นที่ที่ TLS, การรับ DDoS, web application firewall และ [Rate Limiting](../rate-limiting/) มักจะอยู่ แนวคิดเดียวกับ Gateway Offloading

CDN นำสำเนาของ response มาไว้ใกล้ผู้ใช้ มันไม่ได้ย้าย origin ทำให้ request ที่ cache ไม่ได้ยังต้องเดินทางไปตลอดทาง ถ้า request พวกนั้นคือตัวที่ช้า คำตอบคือเพิ่ม region ([Multi-Region Active-Active](../multi-region-active-active/)) หลัง [Load Balancing](../load-balancing/) แบบ global และมักมี CDN อยู่ข้างหน้าด้วย

**ตอนไหนไม่ควรใช้:**

- ผู้ใช้ทั้งหมดอยู่ใกล้ origin (ประเทศเดียว เครือข่ายออฟฟิศเดียว) และ traffic ไม่ได้เยอะ ไม่มีระยะทางให้ประหยัดเท่าไร
- response แทบทุกตัวเป็นของส่วนตัว หรือเปลี่ยนทุก request ไม่มีอะไรแชร์ได้ ทุก request เลยเป็น miss ที่มี hop เพิ่มมาอีกหนึ่ง
- content เป็น long tail ที่แทบไม่มีใครขอซ้ำภายในอายุของมัน hit ratio เลยต่ำ และคุณต้องจ่ายทั้ง CDN และ origin สำหรับ byte ชุดเดียวกัน
- ข้อมูลห้ามเก็บไว้นอกเขตอำนาจกฎหมาย หรือห้ามให้ third party เก็บเลย
- client อยู่ในเครือข่ายที่ล็อกไว้แน่นจนติดต่อ address ของ CDN ไม่ได้

## ได้อะไร เสียอะไร

- **content ที่ stale คือราคาของความเร็ว** ระหว่างตอนที่มีการเปลี่ยนแปลงจนถึงตอนหมดอายุหรือตอน purge ในช่วงนั้นผู้ใช้จะเห็น version เก่า และ edge กับ browser แต่ละตัวก็สลับไปในจังหวะต่างกัน เลือกอายุตามว่า content แต่ละแบบ stale ได้แค่ไหน
- **cache key ที่ผิดคือ security incident** key ที่แคบเกินไป หรือ response ส่วนตัวที่บังเอิญ cache ได้ จะแสดงข้อมูลของผู้ใช้คนหนึ่งให้อีกคนเห็น และความผิดพลาดที่ถูก cache ไว้จะอยู่ต่อแม้แก้แล้ว จนกว่าจะถูก purge
- **มีอีกฝ่ายหนึ่งอยู่ใน request path** CDN terminate TLS มันเลยเห็น traffic ของคุณแบบ clear text และเมื่อมันพัง เว็บของคุณก็พังไปด้วย ตัดสินใจไว้ก่อนว่าจะ bypass มันยังไง หรือ failover ไป CDN ตัวที่สองยังไง
- **debug ยากขึ้น** "ผู้ใช้คนนี้ได้อะไรไป จาก edge ไหน และมันเก่าแค่ไหน?" ต้องใช้ `Cache-Status` หรือตัวเทียบเท่าของ vendor, `Age` และ edge log
- **miss ไม่ได้เร็วกว่าเดิม** มันเพิ่ม hop อีกหนึ่ง และ purge หรือ cold start จะทำให้ทุกอย่างกลายเป็น miss พร้อมกัน เว็บที่มี traffic ต่อ edge location น้อยจะเจอแต่ miss เป็นส่วนใหญ่
- **configuration ผูกกับ vendor** cache rule, edge function และ purge API ต่างกันไปในแต่ละ CDN ทางที่ดีคือเก็บ policy ไว้ใน standard response header ให้มากที่สุด

## ข้อควรรู้ตอนลงมือทำ

feature และค่า default ของ vendor เปลี่ยนได้ ตัวอย่างในนี้เช็กกับ documentation ของ vendor เมื่อเดือนตุลาคม 2026

**เลือกอายุ**

| Content | Header | update ยังไง |
|---|---|---|
| asset ที่มี fingerprint | `Cache-Control: max-age=31536000, immutable` | URL ใหม่ทุก build ไม่ต้อง purge เลย |
| HTML และ URL คงที่อื่น ๆ ที่ต้องเปลี่ยนให้ทันเวลา | `Cache-Control: max-age=0, s-maxage=600` หรือ `no-cache` คู่กับ `CDN-Cache-Control: max-age=600` และมี `ETag` | purge ตอน deploy ส่วนอายุสั้น ๆ ฝั่ง browser ครอบคลุมส่วนที่ purge เอื้อมไม่ถึง |
| response ของ API สาธารณะ | `max-age` ระดับวินาทีถึงนาที คู่กับ `stale-while-revalidate` และ `stale-if-error` | หมดอายุเอง บวก purge ตาม tag เมื่อจำเป็น |
| รูปและ media ที่ URL คงที่ | หลักชั่วโมงถึงหลักวัน และมี `ETag` หรือ `Last-Modified` | purge ตาม URL หรือ tag |
| response ส่วนตัว | `Cache-Control: private` หรือ `no-store` | ไม่ cache ที่ edge เลย |

diagram ให้หน้าเว็บใช้ `max-age=600` ธรรมดา เพื่อให้ภาพดูง่าย และนั่นก็ทำให้ browser เก็บหน้าไว้ได้สิบนาทีด้วย เรื่องนี้แถวที่สองเลี่ยงไว้แล้ว

**ปกป้อง origin**

- ต้องมีแค่ CDN ที่เข้าถึงมันได้ ไม่อย่างนั้นใครก็ตามที่หา address ของมันเจอ ก็ข้าม cache, firewall rule และ rate limit ไปได้หมด ตัวเลือกที่ใช้กันคือ private connectivity (CloudFront VPC origins), ยอมเฉพาะ address range ที่ CDN ประกาศไว้ (AWS-managed prefix list สำหรับ CloudFront), secret header ที่ CDN ใส่และ origin เช็ก, mutual TLS จาก CDN (Authenticated Origin Pulls ของ Cloudflare) และสำหรับ object storage ก็ใช้ bucket policy ที่ยอมแค่ CDN (CloudFront origin access control)
- TLS จบที่ edge: CDN แสดง certificate ของคุณ และ handshake เกิดใกล้ผู้ใช้ จากนั้น edge ก็เปิด connection ของตัวเองไปที่ origin เข้ารหัสช่วงนั้นด้วย และให้ CDN validate certificate ของ origin (origin protocol policy แบบ HTTPS-only ของ CloudFront, โหมด *Full (strict)* ของ Cloudflare) โหมดที่คุยกับ origin ด้วย HTTP ธรรมดา อย่างโหมด *Flexible* ของ Cloudflare จะทำให้ช่วงนั้นถูกอ่านได้

**วัดผล**

- **cache hit ratio** คือสัดส่วนของ request ที่ได้คำตอบจาก cache ให้ติดตามตาม byte ด้วย เพราะ byte เป็นตัวกำหนดบิล
- แยกดู **ตาม region หรือ edge location** ตามประเภท content และตาม path ค่าเฉลี่ยทั่วโลกที่ดูดีอาจซ่อน region ที่มีผู้ใช้น้อย ที่ object ถูก evict หรือหมดอายุก่อน request ถัดไปจะมาถึง
- แหล่งข้อมูล: analytics ของ CDN (Cache Analytics ของ Cloudflare, metric *cache hit rate* ที่เป็นตัวเลือกของ CloudFront), edge log (`x-edge-result-type` ของ CloudFront แยก `Hit`, `RefreshHit` และ `Miss` และ `x-edge-location` บอกชื่อ edge) และ header `Cache-Status` กับ `Age` ที่ผู้ใช้จริงหรือ probe เห็น
- ดู request rate และ latency ของ origin คู่กันไป hit ratio ที่ลดลงมักแปลว่า cache key แตกกระจาย อายุสั้นเกินไป หรือมี cookie หรือ header `Vary` แอบเข้ามาใน response

**ต้นทุน**

- CDN คิดเงินตาม data ที่ส่งออกไป และมักคิดต่อ request ด้วย ในอัตราที่ต่างกันตาม region บางเจ้าขายเป็นแพ็กเกจรายเดือนแบบเหมาแทน (CloudFront มีทั้งสองแบบ และ *price class* ของมันตัด region ที่แพงที่สุดออกได้) hit เสียแค่ค่าส่งของ CDN ส่วน miss เสียค่า response ของ origin ด้วย และค่า origin egress เว้นแต่ provider จะยกเว้นให้ระหว่าง service ของตัวเอง แบบที่ AWS ทำระหว่าง origin ของตัวเองกับ CloudFront
- ค่าใช้จ่ายเสริมก็รวมกันได้เยอะ: purge (1,000 invalidation path แรกต่อเดือนของ CloudFront ฟรี และ wildcard หรือ tag นับเป็นหนึ่ง path), origin shield, log และ edge compute

**รายละเอียดที่มักพลาด**

- อย่าตัดสินว่าอะไร cache ได้จากนามสกุลไฟล์อย่างเดียว และอย่า cache response ที่มี `Set-Cookie`
- normalise key: ตัด tracking parameter ทิ้ง เรียงหรือทำ allow-list ของ query parameter และเพิ่ม header เข้าไปใน key ก็ต่อเมื่อ response ขึ้นกับมันจริง ๆ
- ถ้า response ต่างกันตาม `Origin` (CORS) key ต้องรวมมันด้วย ไม่อย่างนั้น CORS header ของเว็บหนึ่งจะถูก serve ให้อีกเว็บ
- ตัดสินใจว่าจะ cache error ไว้นานแค่ไหน ตัว 404 หรือ 5xx ที่ cache ไว้จะยัง fail ต่อไปแม้ origin หายดีแล้ว และ CDN มี setting แยกสำหรับเรื่องนี้
- เช็กด้วย `curl -sI`: `Age`, `Cache-Status` หรือ header ของ vendor และ `Cache-Control` ที่มาถึงจริง
