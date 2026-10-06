## ปัญหา

พอระบบถูกแบ่งเป็นหลาย service แล้ว ถ้าปล่อยให้ client ทุกตัวเรียก service ทุกตัวได้ตรง ๆ โครงสร้างข้างในก็จะโผล่ออกไปข้างนอก client ทั้ง web, mobile และ partner แต่ละตัวต้องคอยจำรายการ endpoint และทุกครั้งที่ refactor (แยก Orders หรือย้าย Catalog) ก็กลายเป็น breaking change ในแอปของคนอื่น หน้าจอเดียวอาจต้องเรียกหลาย round trip ส่วน service ที่เปิดสู่สาธารณะทุกตัวก็ยังต้องเขียนเรื่องที่ขอบระบบเดิม ๆ ซ้ำเอง (TLS certificate, การตรวจ token, quota ราย client, access log) และแต่ละตัวก็เป็นช่องโจมตีที่หันหน้าออก internet ที่ต้องทำให้แน่นหนาแยกกันเอง

## ทำงานยังไง

API gateway คือ reverse proxy ระดับ layer 7 ที่กลายเป็นทางเข้าสาธารณะทางเดียว ทุก request ผ่าน pipeline ของ policy ชุดเดียวกันตามลำดับ:

1. **Terminate TLS** public certificate อยู่ที่ gateway แล้ว gateway ก็เปิด TLS connection ใหม่ไปหา backend ถ้าให้ดีควรเป็นแบบ mutual
2. **Authenticate** ตรวจ bearer token (signature เทียบกับ key ที่ identity provider เผยแพร่ไว้, วันหมดอายุ, issuer และ audience) หรือ API key ถ้าไม่มี credential หรือ credential ไม่ถูกต้องก็ได้ `401` ก่อนจะไปแตะ backend ตัวไหน ส่วน identity ที่ตรวจแล้วก็ถูกส่งต่อไปข้างหลัง
3. **Rate limit** หา token bucket ของคนที่เรียก: การเรียกแต่ละครั้งใช้ token หนึ่งตัว และ token เติมกลับในอัตราคงที่ ทำให้ burst ที่ไม่เกินขนาด bucket ผ่านได้ แต่การยิงถล่มต่อเนื่องผ่านไม่ได้ ส่วนที่เกินจะได้ `429 Too Many Requests`
4. **Route** จับคู่ path, host หรือ header กับ backend แล้วกระจาย load ไปตาม instance ของมัน หรือตอบ request ที่ cache ได้จาก cache ของ gateway เอง
5. **ขากลับ** แปลง response ถ้าต้องทำ แล้ว log, วัดการใช้งาน และ trace การเรียกนั้น

การ authenticate ก่อนทำให้ใช้ identity ที่*ตรวจแล้ว*เป็นตัวกำหนด quota กับ cache key ได้ ส่วน limit หยาบ ๆ ราย IP หรือ web application firewall ที่อยู่ข้างหน้าก็ยังรับการยิงถล่มแบบไม่ระบุตัวตนไว้ได้ งานอื่นที่มักย้ายมาไว้ที่นี่คือ CORS, compression และ IP allow list ส่วน request CORS preflight (`OPTIONS`) ให้ตอบก่อนขั้น authenticate: browser ไม่เคยส่ง credential มากับ preflight และ `401` ตรงนั้นจะบล็อกการเรียกจริง

**แบบอื่น ๆ และ pattern ข้างเคียง:**

- **Backends for Frontends (BFF)** แทนที่จะมี gateway อเนกประสงค์ตัวเดียว ก็รันหนึ่งตัวต่อ client แต่ละประเภท (web, mobile, partner) แต่ละตัวเปิด API แค่ที่ client ของมันต้องใช้พอดี และทีมที่สร้าง client นั้นเป็นเจ้าของ ส่วน edge gateway ที่ใช้ร่วมกันก็ยังรับเรื่อง TLS, authentication และ quota ไว้ข้างหน้าได้
- **Gateway aggregation** gateway (หรือ BFF) กระจาย request เดียวออกไปหลาย service แล้วรวมคำตอบเข้าด้วยกัน client ที่ช่างคุยเลยเรียกแค่ round trip เดียวแทนที่จะหลายรอบ
- **Gateway เทียบกับ service mesh** gateway ดูแล traffic แบบ **north-south** ที่มาจาก client เข้าสู่ระบบ: public TLS, API key, quota, versioning ส่วน service mesh ดูแล traffic แบบ **east-west** ระหว่าง service: mutual TLS, retry, timeout และการย้าย traffic ผ่าน proxy แบบ sidecar หรือระดับ node สองอย่างนี้เสริมกัน และ mesh หลายตัวก็มี ingress gateway มาให้ ที่ใช้เป็น edge แบบง่าย ๆ ได้

## ใช้ตอนไหนดี

- มีหลาย service ที่เปิดให้ client ภายนอกใช้ และอยากได้ endpoint เดียวที่นิ่ง ๆ ทำให้ backend แยก รวม หรือย้ายอยู่ข้างหลังได้โดยไม่ทำให้ใครพัง (facade ในการย้ายแบบ [Strangler Fig](../strangler-fig/) ก็มักเป็น gateway)
- client ต่างประเภทต้องใช้ credential, quota หรือ payload ต่างกัน
- security ที่ขอบระบบและ traffic policy ควรถูกใช้อย่างสม่ำเสมอในที่เดียว โดยทีมที่เป็นเจ้าของเรื่องนี้
- เปิด API ให้ partner หรือลูกค้าใช้ และต้องมี API key, usage plan และ analytics ราย consumer
- ไม่ใช่สำหรับ service ตัวเดียวหรือแอปเล็ก ๆ ที่ load balancer หรือ ingress ที่มี TLS ก็พอแล้ว และปกติก็ไม่ควรอยู่บนเส้นทางการเรียกระหว่าง service ที่ service mesh หรือ client library จัดการได้ดีกว่า

## ได้อะไร เสียอะไร

- **Single point of failure** ทุกการเรียกต้องผ่านมัน availability ของมันเลยเป็นเพดานของทั้งระบบ รัน instance แบบ stateless หลายตัวกระจายหลาย zone อยู่หลัง load balancer, drain connection ตอน deploy และ roll out การเปลี่ยน configuration อย่างระวังเท่ากับโค้ด
- **คอขวดและ hop ที่เพิ่มมา** ทุก request ต้องจ่ายค่า network hop อีกหนึ่ง hop บวกกับทุก policy ที่รัน เลยต้อง scale มันแบบ horizontal ทำ policy ให้เบา และทำ load test ด้วย burst ที่ใกล้เคียง production
- **business logic ค่อย ๆ ไหลเข้ามา** orchestration, การ map ข้อมูล และ feature rule น่าใส่เข้ามา แต่มันจะเปลี่ยน gateway ให้กลายเป็น monolith ที่ใช้ร่วมกัน ที่ทุกทีมต้องแก้และ redeploy เลยควรให้มันทำแค่ cross-cutting concern ส่วนการปรับรูปข้อมูลเฉพาะ client ควรอยู่ใน BFF หรือ service
- **เป้าที่มีค่าสูง** มันถือ public certificate และบังคับ authentication ให้ทุกคน ทำให้มันแน่นหนา ล็อก admin API ของมันไว้ และทำให้ service เข้าถึงไม่ได้ยกเว้นผ่านมัน (private networking, mutual TLS หรือทั้งสองอย่าง) ไม่อย่างนั้นก็อ้อม policy ของมันไปได้ง่าย ๆ
- **identity ที่ส่งต่อมาต้องเชื่อถือได้** service อาจเชื่อ identity header แค่เพราะ gateway เป็นคนใส่ เลยต้องลบ header ชื่อเดียวกันที่ client ส่งมาเองทิ้งที่ขอบ ดีไซน์แบบ zero-trust จะส่ง token ตัวจริงต่อไป หรือแลกเป็น token ที่แคบกว่า แล้วให้แต่ละ service validate ใหม่อีกรอบ
- **cache อย่างระวัง** cache เฉพาะ response สาธารณะที่ปลอดภัย โดยใช้ key ที่รวมทุกอย่างที่ทำให้ response เปลี่ยน (path, query, header ที่เกี่ยวข้อง) อย่าส่ง response ของ user คนหนึ่งให้อีกคนจาก cache ที่ใช้ร่วมกันเด็ดขาด และตั้ง TTL ให้สั้น หรือ invalidate เมื่อข้อมูลเปลี่ยน

## ข้อควรรู้ตอนลงมือทำ

- **Product:** managed service อย่าง Amazon API Gateway, Azure API Management และ Apigee หรือ gateway ที่ host เองอย่าง Kong, Tyk, KrakenD, NGINX, Traefik และ gateway ที่สร้างบน Envoy ส่วนบน Kubernetes ตัว Gateway API (`Gateway`, `HTTPRoute`) คือวิธีมาตรฐานในการประกาศ route
- **Token:** สำหรับ JWT ให้ cache signing key ของ identity provider (JWKS) แล้วตรวจ signature, algorithm, `iss`, `aud` และ `exp` ในเครื่องเอง ไม่ต้องเรียก IdP ทุก request ส่วน opaque token ต้องเรียก introspection (RFC 7662) เลยควร cache ผลไว้สั้น ๆ ถ้าไม่มี token หรือ token เสีย ให้ตอบ `401` พร้อม header `WWW-Authenticate` และถ้า token ถูกต้องแต่ไม่มี scope ที่ต้องใช้ ให้ตอบ `403`
- **Rate limit:** ใช้ key เป็น client ที่ authenticate แล้ว ไม่ใช่แค่ IP address เพราะ NAT กับ mobile network ใช้ address ร่วมกัน และส่ง `Retry-After` ไปกับ `429` ทุกครั้ง ถ้ามี gateway หลาย instance ก็แชร์ตัวนับกัน (เช่นใน Redis หรือผ่าน global rate-limit service) หรือแบ่ง quota แต่ละก้อนไปตาม instance แล้วยอมรับว่าตัวเลขจะคลาดกันบ้าง
- **Observability:** gateway เห็นทุกการเรียก เลยควรให้มันเริ่มหรือส่งต่อ trace context (W3C `traceparent`) และปล่อย metric ของ rate, error และ latency ราย route ราย client
- **Configuration as code:** เก็บ route กับ policy ไว้ใน version control และให้ทีม service เป็นเจ้าของ route ของตัวเองผ่านการ review ไม่ใช่ผ่าน ticket ไปหาทีมกลาง
