## ปัญหา

แบ่งระบบเป็นหลาย service แล้วเปิดแต่ละตัวให้ client ใช้ ทุก service ก็กลายเป็น edge ของตัวเอง ก่อนจะรัน business logic ได้สักบรรทัด มันต้องทำงานเดียวกับเพื่อนบ้านทุกตัว:

- ถือ **TLS certificate** กับ private key ของมัน เลือก protocol version กับ cipher suite และต่ออายุ certificate ก่อนหมดอายุ
- **ตรวจ token ของผู้เรียก**: ดึง key ของ issuer แล้วตรวจ signature, issuer, audience และวันหมดอายุ
- **compress** response, ตอบ CORS preflight และจำกัด request rate
- เขียน **access log** และนับ request, error และ latency

ไม่มีงานไหนในนี้ที่ต่างกันระหว่าง service แต่ทุกทีมก็ยังสร้างใหม่เองด้วยอะไรก็ตามที่ภาษาของตัวเองมีให้ สามภาษาแปลว่ามี TLS stack สามชุด token library สามตัว และ configuration สามชุดที่ควรจะทำงานเหมือนกันแต่ไม่เคยเหมือนกันจริง ๆ: service หนึ่งยังรับ protocol version เก่าอยู่ อีกตัวลืมตรวจ audience ของ token ส่วนตัวที่สามเขียน log ใน format ที่คนอื่น parse ไม่ได้

สำเนาพวกนี้ยังต้อง*คอยรักษา*ให้เหมือนกันด้วย และตรงนี้แหละที่เจ็บ:

- **Certificate หมดอายุ** สำเนา certificate ทุกใบคือการต่ออายุที่อาจมีคนพลาด และ certificate ที่หมดอายุก็คือระบบล่ม เพราะ client จะปฏิเสธ connection ส่วนแรงกดดันก็มากขึ้นเรื่อย ๆ ตาม Baseline Requirements ของ CA/Browser Forum ตัว TLS certificate ที่เชื่อถือได้แบบสาธารณะที่ออกตั้งแต่ 15 มีนาคม 2026 มีอายุได้ไม่เกิน 200 วัน และเพดานนี้จะลดเหลือ 100 วันในวันที่ 15 มีนาคม 2027 และเหลือ 47 วันในวันที่ 15 มีนาคม 2029 การต่ออายุด้วยมือทีละ service รับตารางแบบนี้ไม่ไหว
- **ช่องโหว่ต้อง patch ทุกที่** ช่องโหว่ใน TLS หรือ token library ต้องแก้ในทุก service ที่ฝัง library นั้นไว้ แต่ละตัวก็มีรอบ release ของตัวเอง และไม่มีใครบอกได้ว่า service ไหนแก้เสร็จแล้วบ้าง
- **ต้องใช้ความรู้เฉพาะทาง** cipher suite, key rotation และการตรวจ token เป็นเรื่องที่พลาดแบบเนียน ๆ ได้ง่าย และทุกทีม product ก็ต้องทำให้ถูกเอง

## ทำงานยังไง

**Gateway offloading** ย้ายงานที่เหมือนกันในทุก service ออกจาก service ไปไว้ที่ gateway ที่ยืนอยู่ระหว่าง service กับ client: reverse proxy, load balancer หรือ API gateway ตัว gateway ทำงานนี้ครั้งเดียวให้ทุกคน ส่วน service ก็เก็บไว้แค่งานที่มีแต่มันทำได้

animation แสดงการย้ายนี้ ใน step 1 ตัว Orders (Java), Catalog (Go) และ Search (Python) ต่างถือป้ายสี่อันเหมือนกัน ใน step 2 ป้ายเลื่อนเข้าไปใน gateway และแต่ละชุดสามอันก็รวมเหลืออันเดียว: certificate ใบเดียวที่ต้องต่ออายุ, authentication configuration ชุดเดียว, compression setting ค่าเดียว, log format แบบเดียว และจุดเดียวที่ต้อง patch ต่อมา step 3 ตามดู request หนึ่งตัวที่วิ่งผ่านผลลัพธ์นี้ ส่วน step 4 ชี้ว่าอะไรที่ gateway รับไปทำแทนไม่ได้ ชื่อ ขนาด และ header ใน animation เป็นแค่ตัวอย่าง

การย้ายนี้ได้อะไรมา:

- **ความสม่ำเสมอ** TLS policy ชุดเดียว token rule ชุดเดียว และ log format แบบเดียว ใช้กับทุก service ไม่ว่าทีมของ service นั้นจะได้ทำหรือยัง
- **patch ที่เดียว** การแก้ TLS stack หรือการตรวจ token เป็นการ rollout ครั้งเดียว ไม่ใช่ครั้งละ service
- **service เรียบง่ายขึ้น** service ถือแค่ business logic ไม่ต้องถือ certificate กับ key set และ service ใหม่ก็ได้ edge ครบตั้งแต่วันแรก
- **ทีมเฉพาะทาง** คนที่เข้าใจ cipher suite กับการตรวจ token เป็นเจ้าของเรื่องนี้ ทีม product ไม่ต้องทำเองอีกแล้ว

### อะไรย้าย อะไรอยู่ที่เดิม

| ที่มักย้ายไป | gateway ทำอะไร |
|---|---|
| **TLS termination และวงจรชีวิตของ certificate** | ถือ public certificate กับ key, ต่อรอง protocol version กับ cipher, ต่ออายุและหมุนเวียนที่จุดเดียว |
| **Authentication** | ตรวจ bearer token (signature, issuer, audience, วันหมดอายุ), พาไป login แบบ redirect สำหรับ browser application ([OpenID Connect](../openid-connect/)) หรือตรวจ client certificate และตอบอย่างอื่นทั้งหมดด้วย `401` |
| **Authorisation แบบหยาบ** | การตัดสินที่ใช้แค่ request กับ token: route นี้ต้องมี scope หรือ role นี้, API key นี้เรียก product นี้ได้ |
| **Rate limiting และ quota** | นับราย client แล้วตอบส่วนที่เกินด้วย `429` ([Rate Limiting & Throttling](../rate-limiting/)) |
| **IP filtering และ web application firewall** | allow list กับ deny list และชุด rule สำเร็จรูปที่กันการโจมตีทั่วไป |
| **Compression** | ต่อรอง `Accept-Encoding` แล้ว compress response ด้วย gzip, Brotli หรือ Zstandard |
| **Caching** | ตอบ `GET` ที่ซ้ำได้โดยไม่ต้องเรียก service ([API Gateway](../api-gateway/) แสดงเรื่องนี้ ส่วน [CDN & Edge Caching](../cdn-edge-caching/) พาออกไปไกลกว่านั้นอีก) |
| **Logging, metric และ trace header** | access log format เดียว, metric ของ request, error และ latency ราย route และ request ID กับ trace context ในทุกการเรียก |
| **CORS** | ตอบ preflight request และเพิ่ม response header |
| **Protocol translation** | HTTP/2 หรือ HTTP/3 ฝั่ง client และอะไรก็ได้ที่ service พูดอยู่ข้างหลัง, JSON over HTTP ไปเป็น gRPC |

| ที่ไม่ย้าย | ทำไมยังอยู่ใน service |
|---|---|
| **Business logic** | มันคือเหตุผลที่ service มีอยู่ ถ้าไปอยู่ใน gateway การ release service ทุกครั้งก็จะผูกกับการ release gateway |
| **การแปลงข้อมูลเฉพาะ domain** | การ map, เติมข้อมูล หรือ validate payload ต้องใช้ data model ของ service |
| **Authorisation แบบละเอียด** | "ผู้เรียกคนนี้ยกเลิก order *นี้* ได้ไหม" ขึ้นกับว่าใครเป็นเจ้าของ order และมีแค่ข้อมูลของ service ที่ตอบได้ |

ตัววัดคือ งานนั้นต้องรู้อะไรเกี่ยวกับ domain ไหม การ terminate TLS การตรวจ signature และการ compress byte เหมือนกันเป๊ะทั้งใน Orders และ Search เลยย้ายได้ แต่การตัดสินว่าใครยกเลิก order ได้ไม่เหมือนกัน เลยย้ายไม่ได้ OWASP API Security Top 10 จัดให้การขาดการตรวจระดับ object อยู่อันดับแรก (API1:2023, broken object level authorization) และขอให้มีการตรวจนี้ในทุก function ที่เข้าถึง record ผ่าน ID ที่ client ส่งมา แต่ gateway ที่อยู่หน้า service มองไม่เห็นเรื่องนี้

### request หนึ่งตัวที่ edge

1. **Terminate TLS** ตัว TLS connection ของ client มาจบที่ gateway ที่ถือ certificate ของชื่อสาธารณะ จากตรงนี้ไป gateway ก็อ่าน request ได้
2. **Authenticate** gateway ตรวจ token ถ้าไม่มี หมดอายุ หรือปลอมมา ก็ตอบด้วย `401 Unauthorized` พร้อม header `WWW-Authenticate` และไม่เรียก service ไหนเลย ส่วน token ที่ถูกต้องแต่ไม่มี scope ที่ต้องใช้จะได้ `403`
3. **ส่งต่อพร้อมแนบ identity** gateway เปิด (หรือใช้ซ้ำ) connection ของตัวเองไปหา service แล้วส่งต่อว่าผู้เรียกคือใคร ใน animation ส่งเป็น header `X-User-Id`
4. **Log** หนึ่งบรรทัดต่อหนึ่ง request ใน format เดียว ไม่ว่า service ไหนจะเป็นคนรับ รวมถึง request ที่ไม่เคยไปถึง service ด้วย
5. **Compress response** ถ้า `Accept-Encoding` ของ client ยอม gateway ก็ compress body ตั้ง `Content-Encoding` และเพิ่ม `Vary: Accept-Encoding`

ใน step 3 ของ animation ตัว connection หลัง gateway ยังเป็น plain HTTP อยู่ (จุดที่ไม่มีวง) ส่วน step 4 เล่าว่าทำไมไม่ควรหยุดแค่ตรงนั้น

### hop ที่อยู่หลัง gateway

offloading ย้ายการตรวจเข้าไปไว้ใน gateway ตอนนี้ทุกอย่างเลยขึ้นกับว่า request ผ่าน gateway จริงหรือเปล่า และขึ้นกับสิ่งที่เกิดบน connection หลัง gateway

**TLS ที่ gateway มีสามแบบ:**

| | Terminate | Terminate แล้ว re-encrypt | Passthrough |
|---|---|---|---|
| TLS session ของ client จบที่ | gateway | gateway | service |
| จาก gateway ไป service | plain HTTP | TLS connection ใหม่ | TLS session ของ client เอง |
| gateway อ่าน request ได้ไหม | ได้ | ได้ | ไม่ได้: เห็นแค่ชื่อ server (SNI) กับ address |
| certificate ที่ต้องดูแล | ใบสาธารณะ | ใบสาธารณะ บวกใบภายในหนึ่งใบต่อ service | ใบสาธารณะหนึ่งใบต่อ service |
| offload อะไรได้บ้าง | ทุกอย่าง | ทุกอย่าง | connection limit, IP filtering, routing ตามชื่อ server |

การ terminate แล้วส่งต่อเป็น plain HTTP คือ *TLS offloading* แบบคลาสสิก และยังใช้กันเยอะใน network ที่ทั้งวงถือว่าเชื่อถือได้ แต่คำแนะนำปัจจุบันไม่ได้คิดแบบนั้น: คำอธิบาย pattern นี้ใน Azure Architecture Center ตอนนี้บอกให้สร้าง TLS ไปหา backend ใหม่หลัง terminate แล้ว และไม่ให้ส่งต่อผ่าน HTTP ที่ไม่เข้ารหัส แบบนี้ทุก service ก็กลับมามี certificate อีก ฟังดูเหมือนปัญหาเดิมกลับมา แต่มันเป็น certificate คนละแบบ: เป็นใบภายใน ออกโดย private CA หรือ platform อายุสั้น และต่ออายุด้วย automation มักทำโดย sidecar หรือ mesh ไม่ใช่โค้ดของแอปพลิเคชัน ส่วน public certificate ใบที่ client เห็น และพาระบบล่มไปด้วยตอนมันหมดอายุ ก็ยังอยู่ที่เดียว การ re-encrypt จะช่วยได้ก็ต่อเมื่อ gateway *ตรวจ* certificate ของ service ด้วย การเข้ารหัสไปหาใครก็ได้ที่ตอบกลับมานั้นไม่พอ

**ปิดประตูข้าง** client ที่เข้าถึง service ได้ตรง ๆ จะข้าม authentication, rate limiting, firewall rule และ access log ไปทั้งหมดในทีเดียว ให้ service อยู่บน private network ยอมรับ inbound connection จาก gateway เท่านั้น (security group, firewall rule, network policy) และตรงไหนที่ network อย่างเดียวไม่พอ ก็ให้แต่ละ service บังคับให้ใช้ client certificate ของ gateway ([Mutual TLS](../mutual-tls/))

**ส่ง identity ไปในรูปที่ service เชื่อถือได้** ตัวเลือกต่าง ๆ เรียงคร่าว ๆ จากอ่อนสุดไปแข็งสุด:

- **header ธรรมดา** เช่น `X-User-Id` ง่าย และปลอดภัยก็ต่อเมื่อมีแค่ gateway ที่เข้าถึง service ได้ *และ* gateway ลบ header ชื่อนั้นที่มาจากข้างนอกทิ้งทุกครั้ง ไม่อย่างนั้นใครก็อ้างเป็นใครก็ได้
- **token ที่ gateway sign** AWS Application Load Balancer ใส่ claim ของ user ไว้ใน `x-amzn-oidc-data` ที่เป็น JWT ที่มัน sign ด้วย ES256 ส่วน Identity-Aware Proxy ของ Google ส่ง `x-goog-iap-jwt-assertion` ทั้งคู่บอกให้แอปพลิเคชันตรวจ signature เพราะ header ที่ sign แล้วยังปลอดภัยแม้ firewall จะตั้งผิด แต่ header ที่ไม่ได้ sign ไม่รอด
- **access token ของผู้เรียกเอง** ส่งต่อไปให้ service ตรวจเอง ([JWT Validation](../jwt-validation/)) แบบนี้ service ต้องเป็น audience ของ token นั้น
- **token ใหม่สำหรับ downstream service** ที่ได้จาก [Token Exchange](../token-exchange/) ใช้ตอนที่ token ตัวจริงไม่ควรเดินทางต่อไปอีก

**ส่งข้อมูลของ connection ไปด้วย** หลัง terminate แล้ว service จะเห็น address กับ connection ของ gateway ไม่ใช่ของ client ตัว gateway เลยส่งต่อสิ่งที่มันรู้: address, scheme และ host ของ client ใน `Forwarded` (RFC 7239) หรือในตัวเก่า `X-Forwarded-For`, `X-Forwarded-Proto` และ `X-Forwarded-Host` และ client certificate ใน `Client-Cert` (RFC 9440) กฎเดียวกับเรื่อง identity ก็ใช้ตรงนี้ด้วย service จะเชื่อ header พวกนี้ได้ก็ต่อเมื่อมันมาจาก gateway ของตัวเอง และ gateway ต้องเขียนทับหรือลบอะไรก็ตามที่ client ส่งมาในชื่อเดียวกัน แล้ว RFC 9440 ก็กำหนดให้เรื่องนี้เป็นข้อบังคับสำหรับ `Client-Cert`

### เมื่อไรที่ service ควรตรวจซ้ำ

service ที่เชื่อ gateway เต็มร้อยมีการป้องกันอยู่ชั้นเดียว ให้ตรวจ token ซ้ำใน service ([JWT Validation](../jwt-validation/)) เมื่อ:

- มีอย่างอื่นใน network ที่เข้าถึงมันได้: service อื่น, batch job หรือเพื่อนบ้านที่โดนเจาะ
- ดีไซน์เป็นแบบ zero trust ที่ไม่เชื่อผู้เรียกคนไหนเพราะตำแหน่งใน network
- service ต้องใช้ claim อยู่แล้วสำหรับการตัดสิน authorisation ของตัวเอง

การตรวจรอบที่สองไม่แพง: signature, issuer, audience และวันหมดอายุ เทียบกับ key ที่ cache ไว้ ตรวจด้วยว่า gateway validate อะไรจริง ๆ บ้าง เพราะมันยืนยันแค่สิ่งที่ถูกตั้งค่าให้ยืนยัน ยกตัวอย่างเช่น การตรวจ JWT บน Application Load Balancer บังคับ claim `iss` กับ `exp` ตรวจ `nbf` กับ `iat` ถ้ามี และ validate claim อื่นก็ต่อเมื่อตั้งค่าไว้เป็น additional claim เท่านั้น audience ไม่ได้อยู่ในค่า default

### End-to-end encryption และ TLS passthrough

ข้อกำหนดบางอย่างไม่ยอมให้ตัวกลางไหนเห็น plaintext เลย การ re-encrypt ไม่ผ่านข้อกำหนดพวกนี้ เพราะ gateway ยังถอดรหัสทุก request อยู่ (ถึงอย่างนั้น vendor ก็ยังเรียกโหมด terminate แล้ว re-encrypt ว่า "end-to-end TLS" อย่างใน documentation ของ Azure Application Gateway) มีแค่ **passthrough** ที่กัน gateway ออกไปได้: มันส่งต่อ byte ที่เข้ารหัสอยู่ และ route ตามชื่อ server ใน TLS handshake

ราคาที่ต้องจ่ายคือตัว pattern เอง gateway ที่อ่าน request ไม่ได้ก็ authenticate, compress, cache, ตรวจเนื้อหา หรือ log path ของมันไม่ได้ service เลยกลับมาต้องทำทั้งหมดนั้นเอง และ address ของ client ต้องเดินทางนอก HTTP เช่นใน PROXY protocol เพราะเพิ่ม header ไม่ได้ ทางสายกลางที่เจอบ่อยคือใช้ passthrough กับไม่กี่ route ที่ต้องใช้ และ terminate กับที่เหลือ

### Observability ที่ edge

gateway เห็นทุก request ที่มาจากข้างนอก มันเลยให้ baseline เดียวกันกับทุก service โดยไม่ต้องมีโค้ดใน service เลย: access log ใน format เดียว, request rate, error rate และ latency ราย route ราย client และ request ID มันยังเป็นจุดเริ่ม trace ด้วย: สร้าง request ID และสร้างหรือส่งต่อ header W3C `traceparent` เพื่อให้ span ของ service ต่าง ๆ ต่อกันเป็น trace เดียว ([Distributed Tracing](../distributed-tracing/))

มีข้อจำกัดสองข้อ สิ่งที่ gateway เห็นจบอยู่แค่ connection ของตัวเอง: มันรู้ว่า Orders ใช้เวลา 300 ms แต่ไม่รู้ว่าทำไม และการเรียกระหว่าง service ไม่เคยผ่าน edge ทำให้ log ที่ edge ไม่ได้เล่าเรื่องทั้งหมด

### Offloading ที่ edge เทียบกับ offloading ราย instance

gateway ไม่ใช่ทางเดียวที่จะเอางานเดินท่อออกจากโค้ดแอปพลิเคชัน สิ่งที่ต่างกันคือ implementation ที่ใช้ร่วมกันไปรันอยู่ตรงไหน:

| | Gateway (pattern นี้) | [Sidecar](../sidecar/) | [Service Mesh](../service-mesh/) |
|---|---|---|---|
| รันที่ | ครั้งเดียว ที่ edge | ข้าง ๆ ทุก instance | proxy หนึ่งตัวต่อ instance หรือต่อ node บวก control plane |
| Traffic | จาก client เข้าสู่ระบบ (north-south) | อะไรก็ตามที่ instance หนึ่งส่งและรับ | ระหว่าง service (east-west) |
| งานที่ทำบ่อย | public certificate, authentication ของ user, firewall rule, quota, compression | ตัวช่วยของแอปพลิเคชันหนึ่งตัว: proxy, log shipper, config agent | mutual TLS ระหว่าง service, retry, timeout, การย้าย traffic |
| ต้นทุนโตตาม | traffic ที่ edge | จำนวน instance | จำนวน instance หรือ node |

สามอย่างนี้ใช้ร่วมกันได้ ไม่ได้แข่งกัน gateway จัดการสิ่งที่เป็นของ public edge ส่วน mesh ดูแลความปลอดภัยและคอยสังเกตการเรียกที่อยู่ข้างหลัง (รวมถึง hop จาก gateway ไป service ตัวแรก เมื่อ gateway เป็นส่วนหนึ่งของ mesh แล้ว) และ ingress gateway ของ mesh เองก็เป็น edge ได้ถ้า feature ของมันพอ

### ใช้คู่กับ routing และ aggregation

offloading เป็นหนึ่งในสามงานที่ gateway ทำได้ อีกสองงานคือ routing (ประตูหน้าบ้านบานเดียวที่ส่งแต่ละ path ไปหา service ของมัน ดู [API Gateway](../api-gateway/)) และ gateway aggregation (request เดียวของ client กระจายไปหลาย service แล้วรวมกลับ) product ตัวเดียวมักทำได้ทั้งสามอย่าง แต่ทั้งสามต่างกันตรงที่ gateway ต้องรู้มากแค่ไหน offloading ไม่ต้องรู้อะไรเกี่ยวกับ API เลย routing ต้องรู้รายชื่อ service ส่วน aggregation ต้องรู้ว่า response หมายถึงอะไร เพราะแบบนี้มันถึงเป็นตัวแรกที่ไหลไปเป็น business logic และมักไปอยู่ใน [Backend for Frontend](../backends-for-frontends/) ที่ทีมของ client เป็นเจ้าของ

edge ที่ซ้อนกันเป็นชั้นเป็นเรื่องปกติ: load balancer หรือ CDN ที่ terminate TLS และกรอง traffic, ข้างหลังเป็น API gateway ที่ authenticate และใช้ quota, แล้วข้างหลังนั้นอีกทีก็เป็น BFF

## ใช้ตอนไหนดี

- มีหลาย service ที่เปิดให้ client ใช้และทำงานที่ edge ซ้ำกัน: certificate, การตรวจ token, compression, logging
- ทีมเดียวที่มีความเชี่ยวชาญตรงนี้ควรเป็นเจ้าของ public TLS, authentication policy และความปลอดภัยของขอบ network
- ต้องการ baseline (TLS version, token rule, log format) ที่ไม่ขึ้นกับความขยันของทุกทีม หรือขึ้นกับว่าทุก service ใส่ instrumentation แล้วหรือยัง
- service เขียนด้วยหลายภาษา ทำให้ shared library ต้องมีหลายชุด
- feature ของ platform มาแทนโค้ดของเราได้ทั้งหมด: managed certificate, managed authentication, managed firewall

### ตอนไหนไม่ควรใช้

- **service เดียว ทีมเดียว ภาษาเดียว** library กับ load balancer ของ platform ดูแลง่ายกว่า gateway tier
- **ข้อกำหนดที่ห้ามตัวกลางอ่าน traffic** ใช้ passthrough กับ route พวกนั้น และยอมรับว่า route พวกนั้นไม่มีอะไรถูก offload เลย
- **เรื่องที่ไม่ได้ใช้ร่วมกันจริง ๆ** rule เฉพาะ service ใน gateway ผูกสองฝั่งเข้าด้วยกัน แล้วการเปลี่ยน service ทุกครั้งก็ต้องเปลี่ยน gateway ด้วย
- **การเรียกระหว่าง service** การเรียกพวกนี้ไม่ได้ผ่าน edge และการส่งออกไปทาง gateway แล้ววนกลับเข้ามาก็เพิ่ม hop กับ dependency อีกตัว นั่นเป็นงานของ mesh หรือ library
- **latency budget ที่รับ hop เพิ่มไม่ไหว** ถ้างานที่ offload ไปเป็นแค่งานเล็กน้อย
- **ทีม gateway ช้ากว่าทีม service** ถ้าการเปลี่ยน certificate หรือ policy ต้องไปรอคิวใครสักคน การรวมศูนย์ก็ทำให้แย่ลง

## ได้อะไร เสียอะไร

- **Single point of failure** ทุก request ผ่าน gateway ทำให้ availability ของมันเป็นเพดานของทุกคน รันหลาย instance กระจายหลาย zone อยู่หลัง load balancer มี health check และ drain connection ก่อนจะถอด instance ออก ([Load Balancing](../load-balancing/), [Health Endpoint Monitoring](../health-endpoint-monitoring/))
- **คอขวด** TLS handshake, การตรวจ token และ compression เป็นงานที่กิน CPU ที่เคยกระจายอยู่ทุก service กำหนดขนาด gateway ตาม traffic ช่วง peak ไม่ใช่ค่าเฉลี่ย และ scale out มัน ([Autoscaling](../autoscaling/))
- **เปลี่ยนจุดเดียว กระทบทุกอย่าง** cipher list ที่ผิด certificate ที่หมดอายุ หรือ rule ที่เสีย ตอนนี้ทำให้ทุก service พังพร้อมกัน เก็บ configuration ไว้ใน version control, review และ roll out ทีละขั้น ([Canary Release](../canary-release/))
- **gateway ที่สะสม logic จะกลายเป็น monolith ที่อยู่หน้า service** rule "เล็ก ๆ" ทุกข้อที่เพิ่มเพื่อ service ตัวเดียว ทำให้ gateway เป็นของที่ทุกทีมต้องแก้ด้วยกัน ก็คือ enterprise service bus กลับมาอีกรอบ คำแนะนำของ James Lewis กับ Martin Fowler สำหรับ microservices คือ "smart endpoints and dumb pipes" ตัว gateway ที่ทำ offloading ก็ควรเป็นแค่ท่อ
- **เป้าที่มีค่าสูง** มันถือ private key ของ public certificate และตัดสิน authentication ให้ทุกคน ทำให้มันแน่นหนา จำกัดการเข้า admin interface และ patch มันก่อนอย่างอื่น
- **hop เพิ่มอีกหนึ่ง** ทุก request ต้องข้าม proxy อีกตัว ส่วน keep-alive connection ไปหา service กับการใช้ TLS session ซ้ำช่วยดึงต้นทุนกลับมาได้บางส่วน
- **มั่นใจผิด ๆ** "gateway authenticate ให้แล้ว" ทำให้ service อยากไม่ตรวจอะไรเลย ถ้าไม่มีการป้องกัน hop ที่อยู่ข้างหลัง สิ่งที่ gateway รับประกันก็จบอยู่แค่ประตูหลังของมันเอง
- **Compression มีผลข้างเคียง** มันกิน CPU และ response ที่ compress แล้ว ถ้ามีทั้งความลับและ input ที่ผู้โจมตีควบคุมได้อยู่ด้วยกัน ก็โดนโจมตีแบบ BREACH (2013) ได้ ไม่ว่าจะใช้ TLS version ไหน compress เนื้อหา static กับเนื้อหาสาธารณะได้ตามสบาย แต่ให้คิดก่อนจะ compress หน้าที่สะท้อน input ไว้ข้าง ๆ session secret

## ข้อควรรู้ตอนลงมือทำ

- **ทำ certificate ให้เป็นอัตโนมัติ** ออกและต่ออายุด้วย ACME (RFC 8555) หรือ managed certificate ของ platform และตั้ง alert จำนวนวันก่อนหมดอายุไว้ด้วยอยู่ดี certificate default ของ Let's Encrypt ทุกวันนี้อยู่ได้ 90 วัน จะเหลือ 64 วันตั้งแต่ 10 กุมภาพันธ์ 2027 และ 45 วันตั้งแต่ 16 กุมภาพันธ์ 2028 ทำให้ job ต่ออายุที่ตั้งรอบตายตัวทุก 60 วันจะใช้ไม่ได้อีกต่อไป
- **ตรวจ backend เมื่อ re-encrypt** ใน NGINX ตัว `proxy_pass https://…` เข้ารหัส hop นั้นก็จริง แต่ `proxy_ssl_verify` กับ `proxy_ssl_server_name` ปิดอยู่ทั้งคู่โดย default ให้เปิดทั้งสองตัวและตั้ง `proxy_ssl_trusted_certificate` ไม่อย่างนั้น gateway จะรับ certificate อะไรก็ได้
- **ตอบ token ที่ไม่ผ่านให้ถูก** `401` พร้อม `WWW-Authenticate: Bearer` สำหรับ token ที่ไม่มีหรือไม่ถูกต้อง และ `403` สำหรับ token ที่ถูกต้องแต่ไม่มี scope (RFC 6750) และให้ตอบ CORS preflight ก่อน authentication เพราะ browser ส่ง preflight มาโดยไม่มี credential
- **ทำความสะอาดที่ edge** ลบหรือเขียนทับ identity header กับ forwarding header ที่มาจากข้างนอกก่อนจะใส่ของตัวเอง Envoy จะเลิกรับ header แบบนี้จากข้างนอกเมื่อตั้ง `use_remote_address` แล้ว และคู่มือสำหรับ deploy ที่ edge ของมันก็แนะนำเพิ่มอีก: ปฏิเสธชื่อ header ที่มี underscore, normalise path, จำกัด stream กับ buffer และเปิด overload manager
- **Compress แบบเลือก** เฉพาะ content type ที่เป็นข้อความและใหญ่กว่าขนาดขั้นต่ำ ไม่ compress ของที่ compress มาแล้ว และใส่ `Vary: Accept-Encoding` ทุกครั้ง ค่า default ของ NGINX แคบกว่าที่คนส่วนใหญ่คิด: `gzip` ปิดอยู่ มีแค่ `text/html` ที่ถูก compress จนกว่า `gzip_types` จะบอกเป็นอย่างอื่น, `gzip_vary` ปิดอยู่ และ request ที่มาผ่าน proxy อีกตัว (มี header `Via` ติดมา) จะไม่ถูก compress (`gzip_proxied off`)
- **ให้ทุก request มี ID** ที่ edge แล้ว log และส่งต่อไป บรรทัดใน log ของ gateway จะได้จับคู่กับบรรทัดใน log ของ service ได้
- **ทำ gateway ให้ stateless** instance จะได้สลับกันได้ และทำ configuration ให้เป็นแบบ declarative ทีม service จะได้แก้ route ของตัวเองผ่านการ review แทนที่จะผ่าน ticket

**ตัวอย่าง ตรวจสอบเมื่อตุลาคม 2026:**

- **cloud load balancer ที่ authenticate user** AWS Application Load Balancer terminate TLS บน HTTPS listener ด้วย certificate จาก AWS Certificate Manager ที่ต่ออายุ certificate แบบ DNS-validated ที่มันออกเอง (ไม่ใช่ใบที่ import เข้ามา) ให้ระหว่างที่ยังใช้อยู่ ส่วน listener rule ที่มี action `authenticate-oidc` หรือ `authenticate-cognito` จะทำ login แล้วส่ง claim ต่อไปใน `x-amzn-oidc-data` แอปพลิเคชันต้องตรวจ signature และตรวจว่า field `signer` ระบุ load balancer ของตัวเอง เพราะ header เก่าอีกสองตัว (`x-amzn-oidc-identity`, `x-amzn-oidc-accesstoken`) ไม่ได้ sign ส่วน action `jwt-validation` ตรวจ bearer token จาก machine client (RS256 เท่านั้น) ทาง documentation แนะนำให้ security group ของ target รับเฉพาะ security group ของ load balancer ส่วนถ้าต้องการ passthrough ทาง AWS แนะนำ Network Load Balancer ที่มี TCP listener ส่วน Identity-Aware Proxy ของ Google Cloud ก็ทำหน้าที่เดียวกันบน Google Cloud: มันลบ header `x-goog-*` ที่ client ส่งมา แล้วเพิ่ม `x-goog-iap-jwt-assertion` ที่ sign แล้วของตัวเอง
- **managed API gateway** JWT authorizer บน HTTP API ของ Amazon API Gateway ตรวจ signature เทียบกับ `jwks_uri` ของ issuer (เฉพาะ algorithm แบบ RSA และ cache key ไว้ได้ถึงสองชั่วโมง) แล้วตรวจ `iss`, `aud` หรือ `client_id`, `exp`, `nbf`, `iat` และ scope ของ route แล้วส่ง claim ต่อไปให้ integration ส่วน policy `validate-jwt` ของ Azure API Management ก็ทำแบบเดียวกันจาก OpenID configuration URL, ตอบ `401` โดย default และ refresh key ทุกชั่วโมง
- **NGINX** (1.30 stable, 1.31 mainline) terminate TLS ด้วย `ssl_certificate` และรองรับแค่ TLS 1.2 กับ 1.3 โดย default ตั้งแต่ 1.27.3 สำหรับ authentication ตัว server แบบ open-source จะโยนการตัดสินไปให้ subrequest ผ่าน `auth_request` (เป็น module ที่ไม่อยู่ใน build default: `2xx` อนุญาต ส่วน `401` กับ `403` ปฏิเสธ) การตรวจ JWT ในตัว (`auth_jwt`) เป็นส่วนหนึ่งของ NGINX Plus ที่เป็นเชิงพาณิชย์ ส่วน `ngx_http_acme_module` ที่แยก package ต่างหาก ทำหน้าที่ออกและต่ออายุ certificate ผ่าน ACME
- **Envoy** (1.39) terminate TLS บน listener และเริ่ม TLS ไปหา upstream cluster ส่วน filter `jwt_authn` ตรวจ signature, issuer, audience และเวลา ลบ token ทิ้งถ้าไม่ได้ตั้ง `forward` และส่ง payload ต่อไป upstream ใน header ที่เราเลือกได้ ตัว `ext_authz` ถาม service ภายนอกและตอบ `403` เมื่อโดนปฏิเสธ ส่วน compressor filter รองรับ gzip, Brotli และ Zstandard ส่วน `x-forwarded-client-cert` จะไม่ถูกส่งต่อถ้าไม่ได้ตั้งค่าไว้
- **Kubernetes Gateway API** (v1.6) listener terminate TLS (`tls.mode: Terminate` ที่เป็น default ของ HTTPS) โดยมี `certificateRefs` ชี้ไปที่ Secret ตัว `BackendTLSPolicy` (อยู่ใน standard channel ตั้งแต่ v1.4) re-encrypt ไปหา Service และตรวจ certificate ของมัน ส่วน `TLSRoute` แบบ `Passthrough` (standard ตั้งแต่ v1.5) ปล่อย session ไว้ตามเดิม และ client certificate ก็ validate บน Gateway ได้ (standard ตั้งแต่ v1.5) ส่วน HTTP authentication ยังเป็น filter แบบ experimental (GEP-1494) ทำให้ implementation ต่าง ๆ เสนอผ่าน policy resource ของตัวเอง ถ้าทุกวันนี้ offload อยู่ที่ Ingress ให้รู้ไว้ว่า controller ingress-nginx ของ community ถูกปลดระวางไปเมื่อมีนาคม 2026: repository ถูก archive แล้ว และจะไม่มี release หรือ security fix อีก
- **ออก certificate แบบอัตโนมัติ** cert-manager ออกและต่ออายุ certificate ของ `Gateway` จาก annotation บน resource นั้น ส่วนตัวอย่างของ pattern นี้ที่ Azure ยกเองคือ Application Gateway ที่ใช้ listener certificate จาก Key Vault และตั้ง backend เป็น HTTPS และนี่ก็คือโหมด terminate แล้ว re-encrypt ที่เล่าไว้ข้างบน
