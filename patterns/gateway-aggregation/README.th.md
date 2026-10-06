## ปัญหา

หน้า product หนึ่งหน้าในระบบ [microservices](../microservices/) ต้องใช้ข้อมูลที่หลาย service เป็นเจ้าของ: ตัว product จาก Product, rating จาก Reviews และจำนวนสต็อกจาก Inventory ถ้าแอปดึงทุกส่วนเอง มันก็ต้องจ่ายค่าการเรียกแต่ละครั้งผ่านเส้นทางที่ช้าที่สุดที่มันมี คือ mobile network

diagram ใช้ตัวเลขตัวอย่าง: round trip ระหว่างมือถือกับ data centre ใช้เวลาประมาณ 150 ms, hop ใน data centre ประมาณ 5 ms และ Product, Reviews กับ Inventory ใช้เวลา 40, 80 และ 30 ms การเรียกสามครั้งต่อกันทีละครั้งทำให้ user ต้องรอ (150 + 40) + (150 + 80) + (150 + 30) = 600 ms และในนั้นเป็นงานจริงแค่ 150 ms ส่วนอีก 450 ms คือ network

ถ้าส่งทั้งสามการเรียกพร้อมกัน เวลารอก็จะสั้นลง แต่ต้นทุนอื่นยังอยู่ แอปยังต้องส่ง request สามตัว ต้อง authenticate และรอทั้งสามตัว และแต่ละตัวก็พังได้ตอนสัญญาณอ่อน คำแนะนำของ Azure ก็พูดเรื่องเดียวกันนี้เกี่ยวกับ request ที่แยกกันบน cellular network แถมการเรียกบางตัวก็ส่งพร้อมกันไม่ได้อยู่ดี เพราะตัวหนึ่งต้องใช้ผลของอีกตัว

client ที่คุยหลายรอบยังผูกติดกับวิธีที่ service ถูกแบ่งด้วย:

- **แอปรู้จักทุก endpoint** การแยก รวม หรือย้าย service กลายเป็นการ release แอป และแอป version เก่า ๆ ก็ยังถูกใช้อยู่อีกนานหลังจากนั้น
- **ทุก service หันหน้าออก internet** แต่ละตัวต้องมี TLS, authentication, rate limit และ security review ของตัวเอง
- **ทุก feature ใหม่เพิ่มการเรียก** หน้ามีส่วนใหม่เพิ่มขึ้นหนึ่งส่วน ก็แปลว่า client ทุกตัวต้องส่ง request เพิ่มอีกหนึ่งตัว

## ทำงานยังไง

วาง **aggregation endpoint** ไว้หน้า service ในที่นี้คือ `GET /product-page/42` บน gateway โดยในแต่ละ request มันจะ:

1. **รับ request เดียว** และทำงานที่ขอบระบบแค่ครั้งเดียว: TLS, authentication, rate limit
2. **กระจายออกไป**: เรียก Product, Reviews และ Inventory **พร้อมกัน** ผ่าน network ใน data centre ที่แต่ละ hop ใช้เวลาแค่ไม่กี่มิลลิวินาที
3. **รอ** คำตอบทุกตัวที่ต้องใช้ หรือจนกว่า deadline จะหมด
4. **รวมและจัดรูป** คำตอบเป็น response เดียวที่มีหนึ่ง section ต่อหนึ่งส่วน แล้วส่งกลับไป

client จ่ายแค่ round trip เดียวบวกกับการเรียกที่ช้าที่สุด: 150 + 5 + 80 = ประมาณ **235 ms** ในตัวอย่างนี้ เทียบสามวิธีโหลดหน้าเดียวกันได้แบบนี้:

| | Request ที่วิ่งผ่าน mobile network | เวลารอในตัวอย่าง |
|---|---|---|
| เรียกสามครั้ง ทีละครั้งต่อกัน | 3 | (150 + 40) + (150 + 80) + (150 + 30) = 600 ms |
| แอปเรียกสามครั้งในจังหวะเดียวกัน | 3 | round trip ที่ช้าที่สุด 150 + 80 = 230 ms |
| เรียกแบบ aggregate ครั้งเดียว | 1 | 150 + 5 + 80 = 235 ms |

ถ้าเทียบกับการเรียกที่แอปส่งพร้อมกันอยู่แล้ว aggregation ประหยัดจำนวน request มากกว่าประหยัดมิลลิวินาที: request เดียวที่ต้องส่ง, authenticate และ retry ผ่านสัญญาณอ่อน แทนที่จะเป็นสามตัว มี endpoint เดียวที่แอปต้องรู้จัก และไม่มี service ไหนต้องหันหน้าออก internet ส่วนถ้าเทียบกับการเรียกที่ต้องรันต่อกันเป็นลำดับ มันยังประหยัด round trip ไปได้ทั้งรอบด้วย เพราะลำดับนั้นตอนนี้รันอยู่ใน data centre (ดู *การเรียกแบบขนานและแบบที่พึ่งกัน* ข้างล่าง)

Chris Richardson อธิบายแนวคิดเดียวกันนี้ว่า **API composition**: composer จะ query แต่ละ service ที่เป็นเจ้าของข้อมูลส่วนหนึ่ง แล้ว join ผลลัพธ์ใน memory และ API gateway ก็เป็นที่ที่นิยมทำเรื่องนี้

## ใช้ตอนไหนดี

- **client ที่ latency สูง:** มือถือบน cellular network, user ที่อยู่ไกลจาก region ที่ host service อยู่ หรือเส้นทางไหนก็ตามที่ round trip กินเวลามากกว่างานที่อยู่ข้างหลัง
- **หน้าจอที่ประกอบจากการเรียกเล็ก ๆ หลายครั้ง:** หน้าที่ต้องใช้ข้อมูลจากหลาย service ที่ถ้าไม่ทำแบบนี้ client ก็ต้องเรียกหนึ่งครั้งต่อหนึ่ง section
- **การเรียกที่พึ่งกัน:** ย้ายสายการเรียกเข้าไปใน data centre ทำให้ round trip ช้า ๆ กลายเป็น hop เร็ว ๆ
- **service ที่ไม่ควรเปิดสู่สาธารณะ:** มี aggregation endpoint ตัวเดียวที่ขอบ ส่วน service ก็อยู่บน internal network ต่อไป

มันไม่เหมาะเมื่อ:

- **ผู้เรียกอยู่ข้าง ๆ service** service อีกตัวใน data centre เดียวกันจ่ายแค่ไม่กี่มิลลิวินาทีต่อการเรียก ทำให้ layer ที่เพิ่มมาเพิ่มทั้ง hop และ component แต่ได้ประโยชน์น้อย คำแนะนำของ Azure ก็บอกแบบเดียวกัน
- **ทุกการเรียกไปที่ service ตัวเดียว** ให้ service นั้นมี operation แบบ batch หรือ composite ตามที่คำแนะนำของ Azure เสนอ แทนที่จะมี layer ที่แค่วนเรียกมัน
- **แต่ละส่วนต้องใช้ในเวลาต่างกัน** response ที่รวมแล้วช้าเท่ากับส่วนที่ช้าที่สุด ถ้าหน้าจอควรแสดง product ทันทีแล้วค่อยแสดง review ตอนที่มา ก็ให้โหลดส่วนที่ช้าและไม่บังคับนั้นด้วย request ของมันเอง

## ได้อะไร เสียอะไร

- **การเรียกที่ช้าที่สุดเป็นตัวกำหนดจังหวะ และการกระจายออกไปทำให้เจอการเรียกที่ช้าบ่อยขึ้น** ถ้าแต่ละ service ช้า 1 ใน 100 request หน้าที่ต้องใช้ทั้งสามตัวจะช้าประมาณ 3% ของเวลา (1 − 0.99³) Dean กับ Barroso แสดงให้เห็นว่ามันโตเร็วแค่ไหน: request ที่ต้องได้คำตอบจาก server 100 ตัวด้วยโอกาสเท่านี้จะช้า 63% ของเวลา
- **component เพิ่มอีกตัวบนเส้นทางของทุกหน้า** aggregator อาจกลายเป็น single point of failure และคอขวดได้ เลยต้องมีหลาย instance ทำ load test และ monitoring แบบเดียวกับ service และหน้าหนึ่งหน้าก็ available ได้ไม่เกิน service ที่มันต้องใช้
- **logic ค่อย ๆ ไหลเข้ามา** การรวม การเปลี่ยนชื่อ และการตัด field ควรอยู่ตรงนี้ แต่ราคา กฎเรื่องสิทธิ์ และการตัดสิน authorization ไม่ควร พอ business rule ย้ายเข้ามาใน aggregator มันก็กลายเป็นเจ้าของ domain คนที่สองที่ซ่อนอยู่ และทีม service ก็แก้ rule ของตัวเองคนเดียวไม่ได้อีกแล้ว คำแนะนำของ Azure ก็เตือนไม่ให้ปล่อยให้ gateway ผูก service เข้าหากัน
- **traffic ภายในเพิ่มขึ้น** การเปิดดูหน้าทุกครั้งกลายเป็นการเรียกภายในสามครั้ง และทุก retry หรือ request ที่ซ้ำก็เพิ่มเข้าไปอีก
- **ผลลัพธ์ที่ไม่ครบเป็นส่วนหนึ่งของ contract** aggregation endpoint ทุกตัวต้องบอกว่าส่วนไหนบังคับ และ client ทุกตัวต้องรับมือกับ response ที่หาย section ไปได้
- **ความเป็นเจ้าของ** ถ้าทีม platform เป็นเจ้าของ gateway หน้าจอใหม่ทุกหน้าก็ต้องไปรอคิวทีมนั้น ถ้า aggregation รับใช้ประสบการณ์ของ client แบบเดียว ตัว [Backend for Frontend](../backends-for-frontends/) ที่ทีมของ client นั้นเป็นเจ้าของมักเป็นที่ที่เหมาะกว่า

## ข้อควรรู้ตอนลงมือทำ

### จะสร้างไว้ตรงไหน

- **ใน gateway ด้วย configuration** gateway บางตัวรวม response ของหลาย service ได้โดยไม่ต้องเขียนโค้ด ใน KrakenD ตัว endpoint ที่มี backend มากกว่าหนึ่งตัวจะเรียกพวกมันพร้อมกันแล้วรวมผล ส่วน setting `group` จะวางคำตอบของแต่ละ backend ไว้ใต้ key ของมันเอง ถ้า backend บางตัวพังหรือไม่ทัน timeout ของ endpoint ตัว KrakenD ก็ยังตอบ 200 ด้วยเท่าที่มี และแปะ `X-KrakenD-Completed: false` ไว้ใน response ส่วนถ้าไม่มีตัวไหนสำเร็จเลย client จะได้ 500 ส่วนใน Azure API Management ตัว policy `send-request` เรียก service แล้วเก็บ response ไว้ในตัวแปร และ `return-response` ก็สร้าง body ที่รวมแล้วได้ ให้ห่อ policy `send-request` ไว้ใน policy `wait` เพื่อให้รันพร้อมกัน (`for="all"` รอทุกตัว ส่วน `for="any"` รอตัวแรก) ถ้าไม่ห่อ มันจะรันต่อกันทีละตัว ตามที่ตัวอย่าง dashboard ของ Microsoft ชี้ไว้
- **ใน aggregation service ตัวเล็ก ๆ หลัง gateway** เมื่อการประกอบต้องใช้โค้ด: เรียกตามเงื่อนไข จัดรูปใหม่ หรือ fallback ราย section คำแนะนำของ Azure เสนอให้แยกแบบนี้ เพราะ aggregation ต้องใช้ resource ต่างจากงาน routing และ offloading ของ gateway และอาจไปกระทบงานพวกนั้นได้ ให้ใช้ I/O แบบ asynchronous เพื่อให้การรอ service สามตัวไม่ต้องกิน thread สามตัว Chris Richardson ก็แนะนำ framework แบบ non-blocking และ reactive สำหรับ gateway ด้วยเหตุผลเดียวกัน
- **ใน [Backend for Frontend](../backends-for-frontends/)** เมื่อประสบการณ์ของ client แบบหนึ่งต้องการหน้าตาของหน้าในแบบของตัวเอง บทความของ Sam Newman แนะนำให้เรียก downstream แบบขนานให้มากที่สุดเท่าที่ทำได้ และลดระดับ response ลงเมื่อ service ที่ไม่บังคับล่ม
- **เป็น GraphQL server** เมื่อ client ต่างกันต้องการข้อมูลเดียวกันคนละส่วน (ดูข้างล่าง)

### การเรียกแบบขนานและแบบที่พึ่งกัน

การเรียกที่ไม่พึ่งกันควรเริ่มพร้อมกัน เวลารอจะได้เท่ากับตัวที่ช้าที่สุด การเรียกที่ต้องใช้ผลของอีกการเรียกจะเริ่มได้ก็ต่อเมื่อผลนั้นมาถึง และเวลาของมันก็บวกกัน ถ้า Reviews ต้องใช้ ID ที่มีแค่ในคำตอบของ Product หน้านี้จะใช้เวลา 150 + 45 + 85 = **280 ms**: ช้ากว่า 235 ms แต่ยังเร็วกว่าแอปที่เรียกสองตัวเดียวกันนี้ทีละตัวเยอะ ที่ (150 + 40) + (150 + 80) = 420 ms

- เขียนการเรียกออกมาเป็น dependency graph เล็ก ๆ เริ่มแต่ละตัวทันทีที่ input พร้อม และรันอย่างอื่นทั้งหมดขนานไปกับสายนั้น
- ทำสายให้สั้นลงตรงไหนที่ทำได้: ให้ service รับ key ที่ client มีอยู่แล้ว แทนที่จะเป็น key ที่มีแค่อีก service รู้
- KrakenD รองรับสายการเรียกด้วย sequential proxy strategy ที่ URL ของ backend ตัวหลังใช้ field จาก response ตัวก่อนหน้าได้ แต่ documentation ของมันเรียกการเรียกต่อกันเป็นสายว่า anti-pattern: ทุกข้อต่อเพิ่ม latency และเพิ่มโอกาสพังอีกหนึ่งครั้ง

### ออกแบบ response ที่ไม่ครบ

ตัดสินทีละ section ว่าถ้าไม่มีมันแล้วหน้านั้นยังมีประโยชน์ไหม

- **ส่วนที่บังคับพัง request ก็พัง** ไม่มี product ก็ไม่มีหน้า เลยให้คืน error: RFC 9110 กำหนด **502 Bad Gateway** ไว้สำหรับ gateway ที่ได้ response ที่ไม่ถูกต้องจาก server ข้างหลัง และ **504 Gateway Timeout** สำหรับ gateway ที่ไม่ได้คำตอบทันเวลา
- **ส่วนที่ไม่บังคับก็แค่ลดระดับ** คืน **200** พร้อม status ของทุก section แล้ว client ก็ render ส่วนที่เหลือและแสดง placeholder ได้:

  ```json
  {
    "product":   { "status": "ok", "data": { "id": 42, "name": "Sneaker", "price": 89 } },
    "reviews":   { "status": "unavailable", "error": { "title": "Reviews did not answer in time" } },
    "inventory": { "status": "ok", "data": { "inStock": 12 } }
  }
  ```

- **ไม่ใช่ 206** RFC 9110 กำหนด 206 Partial Content ไว้เป็นคำตอบที่สำเร็จของ *range request* ที่ client ขอแค่บาง byte range ของ representation เดียว หน้าที่หาย section ไปเป็นคนละเรื่องกัน
- **ให้ section ที่พังแต่ละตัวมี error ของตัวเอง** member ของ problem details ใน RFC 9457 (`type`, `title`, `status`, `detail`) ใช้ใน section ได้เหมือนกัน และ RFC ก็อธิบายการฝัง problem details ไว้ใน format อื่นด้วย
- **แปะป้ายว่า response ไม่ครบไว้ข้างบนสุดด้วย** สำหรับ client และ cache ที่ไม่ได้อ่านทุก section ตัว KrakenD ตั้ง `X-KrakenD-Completed: false` และไม่ใส่ cache header เพื่อให้หน้าที่ไม่ครบไม่ถูก cache ไว้เหมือนเป็นหน้าที่ครบ
- **test client กับทุกส่วนที่อาจหายไป** ไม่ใช่แค่ happy path

GraphQL สร้างเรื่องนี้ไว้ใน protocol เลย ใน specification ฉบับกันยายน 2025 ตัว field ที่พังจะ resolve เป็น null และ error ของมันจะไปอยู่ใน list `errors` ของ response ข้าง ๆ `data` ที่ไม่ครบ ถ้า field นั้นเป็น Non-Null ค่า null ก็จะลอยขึ้นไปถึง field ที่ใกล้ที่สุดที่เป็น null ได้ ส่วนตัว nullability ของ schema ก็คือการตัดสินว่าส่วนไหนบังคับหรือไม่บังคับนั่นเอง

### Timeout, deadline เดียว, circuit breaker และ fallback

- **ให้การเรียกแต่ละตัวมี timeout ของตัวเองภายใน deadline เดียว** ของทั้ง request และส่งแต่ละการเรียกไปด้วยค่าที่น้อยกว่าระหว่าง timeout ของมันกับเวลาที่เหลือ (ดู [Timeout & Fallback](../timeout-and-fallback/)) ใน diagram ตัว deadline คือ 200 ms: Product ที่บังคับใช้เวลาได้ถึง 150 ms ส่วน Reviews กับ Inventory ที่ไม่บังคับได้ตัวละ 100 ms
- **หยุดงานที่ถูกทิ้ง** ตอน gateway เลิกรอ Reviews ให้ cancel การเรียกนั้น เพื่อให้ Reviews หยุดทำคำตอบที่ไม่มีใครอ่าน
- **วาง [circuit breaker](../circuit-breaker/) ไว้หน้าแต่ละ service** ระหว่างที่ Reviews ยังพังอยู่เรื่อย ๆ ตัว breaker จะตอบทันที และ section นั้นก็ถูกแปะว่า unavailable โดยไม่ต้องรอ 100 ms ทุกหน้า ส่วน Azure API Management ก็ผูก circuit breaker ไว้กับ backend entity ได้: พอมัน trip แล้ว gateway ก็หยุดส่ง request ไปที่ backend นั้นตามเวลาที่ตั้งไว้ และตอบ 503 แทน (ไม่มีใน Consumption tier)
- **เลือก fallback ราย section:** สำเนาจาก cache (คำแนะนำของ Azure เสนอข้อมูลใน cache เป็น failover) ค่า default หรือไม่มีอะไรเลยนอกจาก status ที่ชัดเจน
- **retry อย่างระวัง** retry คุ้มก็ต่อเมื่อเป็นการอ่านแบบ idempotent ที่ยังเหลือ deadline มากพอ และทุก retry ก็เพิ่ม load ภายใน

### Caching

- **Cache รายส่วน** หน้าที่รวมแล้วสดได้แค่เท่ากับส่วนที่เปลี่ยนบ่อยที่สุด การ cache ทั้ง response เลยทำให้ทุกอย่างมีอายุสั้นที่สุด เก็บส่วนที่นิ่งอย่างรายละเอียด product ไว้เป็นนาทีใน aggregator โดย lookup แบบ [cache-aside](../cache-aside/) ก่อนเรียก และดึงส่วนที่เปลี่ยนบ่อยอย่างสต็อกใหม่ทุก request
- **อย่าเก็บ response ที่ไม่ครบเหมือนเป็น response ที่ครบ** และอย่าเอา section ที่ personalise ไปไว้ใน shared cache
- ใน Azure API Management ตัว `cache-lookup-value` อยู่ใน block `wait` เดียวกับการเรียก `send-request` ได้ ทำให้การ lookup cache กับการเรียก service รันพร้อมกัน

### Trace การกระจายออกไป

ตอนนี้หน้าหนึ่งหน้าเป็น request เดียวที่ขอบ แต่เป็นหลายตัวข้างหลัง และ trace ก็คือวิธีหาส่วนที่ช้า ส่งต่อ header W3C `traceparent` ไปกับทุกการเรียก downstream เพื่อให้แต่ละการเรียกกลายเป็น child span ของ span ของ gateway ใน trace เดียวกัน (ดู [Distributed Tracing](../distributed-tracing/)) ในหน้าดู trace จะเห็นการเรียกแบบขนานซ้อนทับกัน ส่วนการเรียกที่เริ่มต่อกันเป็นขั้นบันไดก็บอกว่ามีลำดับที่ไม่มีใครตั้งใจให้เกิด บันทึก latency กับ error ของการเรียก downstream ทุกตัว และนับ response ที่ไม่ครบไว้ด้วย: สัดส่วนของหน้าที่ไม่มี review ที่สูงขึ้นเรื่อย ๆ ก็คือ incident ต่อให้ทุก request คืน 200 ก็ตาม คำแนะนำของ Azure ยังแนะนำให้ดู metric ของ request และขนาดของ response ด้วย

### เรียก service ด้วย identity ของ user

service ยังเป็นคนตัดสินว่าใครเห็นอะไรได้ เลยต้องรู้ว่าใครเป็นคนขอ: อย่าเรียกมันด้วย credential ของ gateway ตัวเดียวที่มีสิทธิ์สูง ให้ส่ง identity ของ user ไปใน token ที่แต่ละ service รับได้ มีสองทาง: ใช้ access token ของ user เองถ้า audience ของมันรวม service นั้นไว้ หรือขอ token ใหม่ต่อ service จาก OAuth 2.0 Token Exchange (RFC 8693) ที่ parameter `audience` ระบุ service ปลายทาง (ดู [Token Exchange](../token-exchange/)) ถ้าใช้ token ตัวเดียวที่ service ทั้งสามรับได้ ตัวไหนในสามตัวก็เอามันไป replay กับทั้งสามตัวได้ การแลก token ก็คือการเรียกเพิ่มอีกหนึ่งครั้งไปที่ authorization server เลยควรใช้ token ที่แลกมาแต่ละตัวซ้ำจนกว่าจะหมดอายุ

### load ภายในที่เพิ่มขึ้นจากการกระจายออกไป

- request เดียวที่ขอบกลายเป็นสามตัวข้างใน: การเปิดดูหน้า 1,000 ครั้งต่อวินาทีกลายเป็นการเรียกภายใน 3,000 ครั้งต่อวินาทีก่อนจะมี retry ใด ๆ กำหนดขนาดของ service, connection pool และ internal rate limit ตาม fan-out ไม่ใช่ตาม traffic ที่ขอบ
- **request ที่ซ้ำจะคูณมันขึ้นไปอีก** Hedging คือการส่งสำเนาที่สองไปเมื่อตัวแรกช้า มันลด tail latency ได้ แต่ก็มีราคาที่ต้องจ่าย ส่วน Dean กับ Barroso คุม load ที่เพิ่มไว้ที่ประมาณ 5% โดยส่ง backup ก็ต่อเมื่อ request แรกค้างอยู่นานกว่า latency ที่ percentile ที่ 95 ส่วน `concurrent_calls` ของ KrakenD ส่ง request ไปที่ backend ได้สูงสุด N สำเนาต่อครั้ง แล้วเก็บคำตอบดีตัวแรกไว้ ทำให้ backend นั้นอาจเจอ load สูงถึง N เท่า
- **Caching ช่วยกดตัวคูณลง** โดยเฉพาะกับหน้าที่คนเข้าเยอะและส่วนที่นิ่ง

### GraphQL: aggregation ที่ query เป็นตัวกำหนด

GraphQL server คือ aggregator ที่ client เลือกหน้าตาของ response เอง: query ระบุ field แล้ว resolver ก็ไปดึงจาก service ที่เป็นเจ้าของ หน้าจอต่าง ๆ ได้ข้อมูลคนละส่วนจาก endpoint เดียว แทนที่จะมี aggregation endpoint ที่เขียนเองหนึ่งตัวต่อหนึ่งหน้าจอ และผลลัพธ์ที่ไม่ครบก็มากับ protocol (ดูข้างบน) ต้นทุนย้ายไปอยู่ที่ server: query ที่ client เขียนเองต้องมี cost limit และ resolver ที่เรียก service หนึ่งครั้งต่อหนึ่ง item ต้องทำ batching ส่วน GraphQL Federation ก็ไปไกลกว่านั้นอีก: router ประกอบ graph เดียวจาก subgraph ของหลาย service แล้ววางแผนแต่ละ query ข้าม subgraph พวกนั้น

### Routing, offloading และ aggregation ใน gateway เดียว

[API gateway](../api-gateway/) route แต่ละ request ไปที่ service ตัวเดียวและใช้ edge policy แค่ครั้งเดียว ส่วน [gateway offloading](../gateway-offloading/) ย้ายงานที่ใช้ร่วมกันอย่าง TLS กับการตรวจ token เข้าไปไว้ในนั้น aggregation เป็นงานคนละแบบ: request เดียวกลายเป็นหลายตัว ตัว gateway ต้องถือ request เปิดค้างไว้ระหว่างรอ และ memory ที่ใช้ก็โตตามขนาดของคำตอบ เพราะแบบนี้คำแนะนำของ Azure ถึงเสนอให้พิจารณา aggregation service ไว้หลัง gateway การแบ่งที่เจอบ่อยคือ gateway ทำ authenticate, rate limit และ route `/product-page/*` ไปที่ aggregation service หรือ BFF แล้ว service นั้นก็ทำ fan-out
