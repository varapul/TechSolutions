## ปัญหา

request ของผู้ใช้ไม่ค่อยจบแค่ที่ API ตัวแรก Orders API ที่รับ order ของ Ana ไปถาม Inventory API เรื่องสต็อก แล้ว Inventory API ก็ไปถาม Pricing API เรื่องราคา และแต่ละตัวต้องตัดสินว่า call นี้ทำอะไรได้และทำให้ใคร access token ที่มากับ request บอกอยู่แล้วว่าผู้ใช้คือใคร ทางที่ชวนให้ทำที่สุดเลยเป็นการส่งมันต่อไป แต่แบบนั้นพังได้สองทาง

**ถ้า downstream API ทำหน้าที่ของมัน มันจะปฏิเสธ** access token ออกให้ audience หนึ่ง และ resource server ต้องปฏิเสธ token ที่ `aud` ไม่ใช่ชื่อของตัวเอง RFC 9068 §4 ทำให้ข้อนี้เป็น MUST สำหรับ JWT access token และ RFC 9700 §2.3 ขอให้ access token ทุกตัวถูกจำกัดไว้กับ resource server ตัวเดียว (หรือไม่กี่ตัว) และให้ resource server ปฏิเสธ token ที่ไม่ได้ออกให้ตัวเอง token ที่ถูกส่งต่อมาออกให้ `orders-api` เพราะฉะนั้น Inventory API ก็ตอบ 401

**ถ้า downstream API ยอมรับมันอยู่ดี** หรือทุก API register ไว้ใต้ audience เดียวกันเพื่อให้การส่งต่อ "ใช้ได้" ระบบก็มีปัญหาใหญ่กว่าเดิม:

- **Replay** API ไหนที่ได้ token ไปก็เอาไปยื่นกับ API ตัวอื่นทุกตัวที่ยอมรับมันได้ service ที่โดนเจาะแค่ตัวเดียว หรือ token ใน log file แค่ตัวเดียว ก็ไปถึงทุกอย่างได้ พร้อมอำนาจทั้งหมดที่ผู้ใช้ให้ client ตัวแรกไว้ RFC 9700 §4.9 อธิบายการรั่วแบบนี้ที่ resource server และระบุว่า audience restriction เป็นวิธีรับมือ
- **Confused deputy** API ที่ยอมรับ token ที่ไม่เคยออกให้ตัวเอง กำลังใช้อำนาจที่ไม่มีใครให้มัน Ana ตกลงให้ Shop app สั่ง order แทนเธอได้ แต่เธอไม่ได้ตกลงว่าใครก็ตามที่ได้ token นั้นไปถือจะอ่านสต็อกหรือแก้ราคาได้ ทางลัดอีกแบบก็พังจากอีกด้าน: ถ้า Orders API ทิ้งผู้ใช้ไปแล้วเรียก downstream ด้วย service credential ของตัวเอง ฝั่ง Inventory API ก็เห็นแค่ service ที่ไว้ใจได้ตัวหนึ่ง แล้วใครก็ตามที่บังคับทิศทาง Orders API ได้ก็ยืมสิทธิ์ของมันไปใช้ได้
- **มากเกินไป นานเกินไป** token ตัวแรกมีทุก scope ที่ client ได้รับ และอยู่ได้นานเท่าที่ client ต้องใช้ ส่วน hop ที่เพิ่มขึ้นแต่ละตัวที่เห็นมัน ก็ขยายสิ่งที่ token รั่วจะทำได้
- **ไม่มีร่องรอย** log ฝั่ง downstream เห็นแค่ผู้ใช้ ไม่มีอย่างอื่น ไม่มีอะไรบันทึกว่า service ไหนเป็นคนเรียก
- **อาจใช้ไม่ได้ด้วยซ้ำ** sender-constrained token (DPoP หรือที่ผูกกับ client certificate) ผูกไว้กับ key ที่มีแค่ client ตัวแรกถือ ทำให้ service ที่อยู่ตรงกลางยื่นมันไม่ได้

สิ่งที่แต่ละ hop ต้องการคือ token ของตัวเอง: ออกให้ API ตัวนั้นตัวเดียว จำกัดไว้แค่ที่ call นั้นต้องใช้ อายุสั้น ยังพูดถึงผู้ใช้คนเดิม และบอกตรง ๆ ว่า service ไหนกำลังทำแทนเธอ

## ทำงานยังไง

OAuth 2.0 Token Exchange (RFC 8693) เพิ่ม grant type หนึ่งตัวให้ token endpoint: client ยื่น token ที่ตัวเองถือให้ authorization server แล้วได้ token อีกตัวกลับมา RFC ยกกรณีนี้เลยมาเป็นตัวอย่างตอนแนะนำมัน: resource server รับบทเป็น client แล้วเอา access token ที่ใช้เรียกตัวเองไปแลกเป็นตัวที่เหมาะกับการเรียก backend service

**Request** คือ `POST` แบบ form-encoded ไปที่ token endpoint:

| Parameter | บังคับไหม | มีอะไรอยู่ข้างใน |
|---|---|---|
| `grant_type` | บังคับ | `urn:ietf:params:oauth:grant-type:token-exchange` |
| `subject_token` | บังคับ | token ของฝ่ายที่ request นี้ทำแทน ในที่นี้คือ access token ของผู้ใช้ตามที่ Orders API ได้รับมาเป๊ะ ๆ |
| `subject_token_type` | บังคับ | token นั้นเป็นแบบไหน เช่น `urn:ietf:params:oauth:token-type:access_token` |
| `actor_token` | ไม่บังคับ | token ของฝ่ายที่จะลงมือด้วย token ตัวใหม่ ในที่นี้คือ access token ของ Orders API เอง |
| `actor_token_type` | ต้องมีถ้ามี `actor_token` | type ของมัน บังคับเมื่อส่ง `actor_token` และห้ามส่งถ้าไม่มี |
| `audience` | ไม่บังคับ | service เป้าหมายแบบชื่อเชิงตรรกะ ที่ทั้ง client และ server รู้จัก |
| `resource` | ไม่บังคับ | เป้าหมายแบบ absolute URI ที่ไม่มี fragment (resource indicator ของ RFC 8707) |
| `scope` | ไม่บังคับ | scope ที่ต้องการที่เป้าหมาย |
| `requested_token_type` | ไม่บังคับ | token แบบที่อยากได้กลับมา ถ้าไม่ส่ง server จะตัดสินเอง |

นอกจาก `access_token` แล้ว RFC ยังนิยาม type identifier ที่ลงท้ายด้วย `refresh_token`, `id_token`, `saml1` และ `saml2` และนำ `urn:ietf:params:oauth:token-type:jwt` มาใช้ซ้ำ ตัว `audience` กับ `resource` ส่งซ้ำและผสมกันได้ แต่ request ที่ระบุหลายเป้าหมายคือการขอ token ตัวเดียวที่ใช้ได้กับทุกเป้าหมายนั้น และนั่นตรงข้ามกับสิ่งที่ pattern นี้ต้องการ

client authenticate กับ token endpoint เหมือนตอนใช้ grant อื่น RFC 8693 ปล่อยให้ authorization server ตัดสินว่า client ที่ไม่ authenticate จะแลก token ได้ไหม และบอกเหตุผลว่าทำไมไม่ควร: ถ้าไม่มี client authentication ใครที่ถือ token ที่ขโมยมาก็แปลงมันเป็น token อื่นต่อไปได้อีก สำหรับ middle-tier API นี่หมายถึงต้องเป็น confidential client ส่วน [OAuth 2.0 Client Credentials](../oauth2-client-credentials/) แสดงวิธีที่ service ใช้พิสูจน์ว่าตัวเองเป็นใคร และ grant เดียวกันนั้นก็ให้ token ที่ service ส่งไปเป็น `actor_token` ได้ด้วย

**การตัดสินใจ** authorization server validate subject token และ actor token ถ้ามี แต่ละตัวตาม type ของมัน แล้วก็ใช้ policy: client ตัวนี้แลก token ตัวนี้ สำหรับเป้าหมายนี้ ด้วย scope นี้ได้ไหม ถ้า request หรือ token ตัวไหนรับไม่ได้ error คือ `invalid_request` ถ้า server จะไม่ออก token ให้ audience หรือ resource ที่ขอมา error คือ `invalid_target`

**Response** คือ token response ธรรมดาที่เพิ่มมาหนึ่งอย่าง:

- `access_token`: token ตัวใหม่ ชื่อนี้มีที่มาทางประวัติศาสตร์: มันใส่อะไรก็ตามที่ออกมา ถึงจะไม่ใช่ access token ก็ตาม
- `issued_token_type`: ออกอะไรมา เป็น type identifier ตัวหนึ่ง
- `token_type`: วิธียื่นมัน: `Bearer` หรือ `N_A` ถ้าผลลัพธ์ไม่ใช่ access token
- `expires_in`: อายุเป็นวินาที (แนะนำให้ใส่)
- `scope`: บังคับทุกครั้งที่ต่างจาก scope ที่ขอมา
- `refresh_token`: ใส่หรือไม่ใส่ก็ได้ และปกติไม่มี เวลาแลก credential อายุสั้นตัวหนึ่งเป็นอีกตัว

**token ตัวใหม่บอกอะไร** RFC 8693 นิยาม JWT claim ที่ทำให้มองเห็น delegation ไว้ด้วย:

- `act` (actor) บอกว่ามี delegation เกิดขึ้น และระบุฝ่ายที่กำลังลงมือ ค่าของมันเป็น JSON object ที่ member ระบุตัว actor: `sub` คู่กับ `iss` ถ้าต้องใช้แยก actor ออกจากกัน claim อย่าง `exp` หรือ `aud` ไม่มีความหมายอะไรถ้าอยู่ข้างใน
- การซ้อนกันบันทึก chain ไว้ `act` ชั้นนอกสุดคือ actor ปัจจุบัน และ `act` แต่ละตัวที่อยู่ข้างในคือ actor ก่อนหน้า ตัวที่เก่าที่สุดอยู่ในสุด สำหรับการตัดสินสิทธิ์ API ใช้ได้แค่ claim ชั้นบนสุดของ token กับ actor ปัจจุบัน ส่วน actor ก่อนหน้าเป็นประวัติไว้ให้ audit log ไม่ใช่สิ่งที่เอามา authorize
- `may_act` ชี้ไปอีกทาง: ถ้าใส่ไว้ใน token มันจะระบุฝ่ายที่ได้รับอนุญาตให้เป็น actor ที่ทำแทน subject ของ token นั้น authorization server เช็กผู้ขอกับมันได้ตอนที่ token ถูกส่งมาเป็น `subject_token`

token ที่แลกมาใน diagram เลยมีค่า `aud: inventory-api`, `sub: ana`, `scope: inventory:read`, `act: {"sub": "orders-api"}` หลังการแลกครั้งที่สอง มันมีค่า `aud: pricing-api`, `sub: ana`, `scope: pricing:read`, `act: {"sub": "inventory-api", "act": {"sub": "orders-api"}}`

**Delegation หรือ impersonation** สองชื่อนี้คือที่ RFC ใช้เรียกความหมายของ token ตัวใหม่ ถ้าเป็น **delegation** ตัว token จะระบุทั้งสองฝ่าย: subject และ actor ใน `act` ที่ทำงานแทน subject ถ้าเป็น **impersonation** ตัว token ระบุแค่ subject ทำให้ฝั่งที่ได้รับเห็นว่าคนเรียกก็คือผู้ใช้เลย ตัวอย่างใน RFC เองขีดเส้นแบ่งไว้ที่ request: `subject_token` อย่างเดียวได้ impersonation ส่วน delegation ต้องมี `actor_token` ด้วย สุดท้ายแล้ว policy ของ authorization server คือตัวตัดสินว่าจะออก token ที่มีทั้งสองฝ่ายหรือไม่ และ server แต่ละตัวก็เอา actor มาจากคนละที่: บางตัวต้องการ `actor_token` บางตัวใช้ client ที่ authenticate แล้ว ระหว่าง service ให้เลือก delegation แล้วฝั่ง downstream API ก็จะแยก "Ana" ออกจาก "Orders API ที่ทำแทน Ana" ได้ authorize จากทั้งคู่ และ log ทั้งคู่

**ทุก hop ทำซ้ำแบบเดิม** การแลกไม่ได้พิเศษอะไรกับ hop แรก Inventory API ก็แลก token ที่ได้รับมาแบบเดียวกัน แล้ว server ก็ซ้อน actor ก่อนหน้าไว้ข้างใน actor ตัวใหม่ ไม่มี token ตัวไหนใน chain ที่ API มากกว่าหนึ่งตัวยอมรับ และตัวที่แลกมาก็อยู่ได้แค่ไม่กี่นาที

## ใช้ตอนไหนดี

- **service ที่อยู่กลาง request ของผู้ใช้ เรียก API อื่นในนามผู้ใช้คนนั้น:** API ที่เรียก downstream API, chain ของ microservice, worker หรือ AI agent ที่ทำแทนคนที่เริ่มงานนั้น
- **downstream API authorize รายผู้ใช้** (order ของ Ana, ราคาของ Ana) หรือต้องบันทึกว่า call นี้ทำให้ใคร
- **Trust boundary ภายในระบบ:** คนละทีม ความ sensitive ต่างกัน หรือแนวทางแบบ zero-trust ที่ไม่มี API ไหนยอมรับ token แค่เพราะมันมาจากใน network
- **เปลี่ยน token ที่ขอบระบบ:** [API Gateway](../api-gateway/) ที่สลับ token ภายนอกเป็น token ภายใน หรือเปลี่ยน token แบบหนึ่งเป็นอีกแบบ (RFC ครอบคลุม ID token และ SAML assertion ด้วย)
- **ไม่ใช่ตอนที่ไม่มีผู้ใช้อยู่ใน call** service ที่ทำในอำนาจของตัวเองไม่มีอะไรให้แลก: ใช้ [OAuth 2.0 Client Credentials](../oauth2-client-credentials/)
- **ไม่ใช่สำหรับ API ตัวเดียว** ถ้า request จบที่ API ที่มันไปถึง ตัว API นั้นแค่ต้อง validate token ที่ได้มา: ดู [JWT Validation](../jwt-validation/)
- **ไม่ใช่จาก browser หรือ mobile app** ฝ่ายที่แลกควร authenticate กับ token endpoint และนั่นต้องเป็น confidential client ส่วน public client ได้ token ผ่าน [OAuth 2.0 Authorization Code + PKCE](../oauth2-authorization-code-pkce/) แทน

## ได้อะไร เสียอะไร

- **call เพิ่มอีกหนึ่งครั้งบนเส้นทาง request** คู่ผู้ใช้กับเป้าหมายใหม่แต่ละคู่ต้องเสีย round trip ไปที่ token endpoint ก่อนจะเริ่ม downstream call ได้ และ chain ที่มีสาม service ก็ต้องจ่ายทุก hop การ cache (ดูข้างล่าง) ตัดส่วนใหญ่ออกไปได้ แต่ call แรกหลัง token หมดอายุต้องจ่ายเสมอ
- **authorization server กลายเป็น runtime dependency ของทุก hop** ถ้า validate อย่างเดียว API ต้องใช้ issuer แค่ตอน refresh key เป็นครั้งคราว แต่พอใช้ exchange ถ้า token endpoint ล่มหรือติด rate limit ทุก call ที่ไม่มี token ใน cache ก็หยุดหมด ให้วางขนาดและ monitor token endpoint ในฐานะส่วนหนึ่งของเส้นทาง request และตั้ง timeout ให้ exchange call
- **policy ต้องมีคนดูแล และต้องแคบ** client ไหนแลก token แบบไหนได้ สำหรับเป้าหมายและ scope ไหน คือตารางที่ต้องมีคนดูแล ถ้าหลวม ("client ไหนก็ได้ audience ไหนก็ได้") exchange ก็กลายเป็นวิธีแปลง token ที่ขโมยมาตัวเดียวให้เป็น token ที่ใช้ได้กับทุกอย่าง: ปัญหา replay กลับมาอีก คราวนี้ได้ authorization server ช่วยด้วย
- **exchange ไม่ได้ผูก token เข้าด้วยกัน** RFC 8693 มองการแลกแต่ละครั้งเป็นเหตุการณ์ครั้งเดียวจบ การต่ออายุหรือ revoke token ของผู้ใช้ไม่เปลี่ยนอะไรกับ token ที่แลกไปจากมันแล้ว ยกเว้น server จะเพิ่มเรื่องนี้เอง อย่าง Keycloak ก็มีเอกสารบอกว่าการ revoke access token ตัวแรกยังปล่อยให้ access token ที่แลกไปแล้วใช้ได้อยู่ อายุสั้น ๆ คือสิ่งที่จำกัดช่องว่างนี้
- **bearer token ยังใช้ได้กับใครก็ตามที่ถือมัน** audience กับ scope ที่แคบลดสิ่งที่ token รั่วจะทำได้ แต่ไม่ได้หยุดการใช้มันกับ audience เดียวของมันจนกว่าจะหมดอายุ sender-constrained token ปิดช่องนี้ได้ แต่ต้องเช็กว่า server ของเราจัดการ `subject_token` ที่เป็น sender-constrained ยังไง: Keycloak รับแค่จาก client ที่มันออกให้ พร้อม proof of possession
- **Impersonation ซ่อนตัวกลางไว้** token ที่ไม่มี `act` ใช้ง่ายกว่ากับ downstream API ที่เข้าใจแค่ `sub` ราคาที่ต้องจ่ายคือ audit trail ที่แยกผู้ใช้ออกจาก service ที่ทำแทนเธอไม่ได้ และไม่มีทางตั้ง rule ราย service ที่เรียก
- **ขนาด token และความเป็นส่วนตัว** ทุก hop เพิ่มชั้นให้ `act` และทุก claim วิ่งไปกับทุก call และ RFC 8693 ก็ขอให้แต่ละ deployment ใส่แค่ข้อมูลขั้นต่ำที่จำเป็นลงใน token ที่ออก
- **การรองรับยังไม่เท่ากัน** ไม่ใช่ทุก authorization server ที่ implement grant นี้ และตัวที่ implement ก็ต่างกันเรื่อง `actor_token`, `act`, `resource` และ token type ที่รับ เช็กให้ดีก่อนจะออกแบบโดยพึ่ง feature ใด feature หนึ่ง

## ข้อควรรู้ตอนลงมือทำ

- **ตัดสินว่าใครแลกอะไรได้ และให้ default เป็นไม่ได้** authenticate client ที่มาแลก และอนุญาตแค่ confidential client แล้วรับ subject token จากฝ่ายที่มันออกให้เท่านั้น: Microsoft Entra ID บังคับให้ `aud` ของ token ที่เข้ามาต้องเป็น application ที่มาขอ ส่วน Keycloak บังคับให้ client ที่ขอต้องอยู่ใน audience ของ token แล้วก็ทำ allowlist ของเป้าหมายและ scope ราย client อย่าออกเกินกว่าที่ grant ของผู้ใช้เองครอบคลุม และให้แต่ละ hop ได้แค่ที่ downstream call ของมันต้องใช้
- **ขอเป้าหมายเดียว และระบุชื่อ** ส่ง `audience` หรือ `resource` และ scope ที่แคบที่สุดที่ยังใช้งานได้ ไม่ใช่ทุก server ที่รับทั้งสอง parameter: standard token exchange ของ Keycloak ยังไม่รองรับ `resource`
- **Cache token ที่แลกมา** ใช้ token ที่เข้ามา (hash ของมัน) หรือผู้ใช้กับ session คู่กับ audience และ scope เป้าหมายเป็น key ของ cache แล้วใช้ token ซ้ำไปจนก่อน `expires_in` จะหมดไม่นาน และเก็บไว้ใน memory หรือใน shared cache ที่เข้ารหัส ห้ามอยู่ใน log ส่วน library ก็มักทำเรื่องนี้ให้: on-behalf-of call ของ MSAL.NET ดูใน token cache ก่อนออกไปที่ network ห้ามแชร์ entry ข้ามผู้ใช้ และอย่าลืมว่า token ที่ cache ไว้อยู่ได้หลังผู้ใช้ sign out ไปอีกนานสุดเท่าอายุของมัน
- **Validate ฝั่ง downstream ตามปกติ** แบบเดียวกับใน [JWT Validation](../jwt-validation/) ทุกอย่าง: signature, `iss`, `aud`, `exp` แล้วค่อย scope หลังจากนั้นค่อย authorize จาก `sub` และถ้าสำคัญก็ดู actor ปัจจุบันใน `act.sub` ด้วย ("Orders API อ่านสต็อกให้ผู้ใช้คนไหนก็ได้ แต่ Reporting API ทำไม่ได้") อย่า authorize จาก actor ที่ซ้อนอยู่ข้างใน
- **Log subject และ actor** บันทึก `sub`, chain ของ `act` ทั้งหมด, `jti` ของ token และ trace ID ของเราในทุก call นี่คือร่องรอยที่การส่ง token ต่อไม่เคยให้: ผู้ใช้คนไหน ผ่าน service อะไรบ้าง
- **รับมือการปฏิเสธ** `invalid_target` หรือ `invalid_request` จากการแลกแปลว่า policy บอกว่าไม่ได้ อย่า fall back ไปส่ง token ตัวเดิมต่อ หรือไปใช้ credential ของ service เอง ถ้า authorization server ต้องการอะไรที่มีแค่ผู้ใช้ให้ได้ (เช่น Entra ID ตอบ `interaction_required` เมื่อ downstream API ต้องการ MFA) ให้ส่ง challenge นั้นย้อนกลับไปถึง client พร้อม 401
- **ทางเลือกและเรื่องที่ใกล้เคียง** (เช็กสถานะเมื่อตุลาคม 2026):
  - **on-behalf-of flow ของ Microsoft Entra ID** มีเจตนาเดียวกันแต่ใช้ grant คนละตัว: middle tier POST token ที่เข้ามาไปเป็น `assertion` พร้อม `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` และ `requested_token_use=on_behalf_of` มันใช้ได้กับ user token เท่านั้น ได้ delegated scope ไม่ใช่ application role และคืน refresh token ก็ต่อเมื่อขอ `offline_access`
  - **Security token service ของ cloud** ใช้ grant ของ RFC 8693 ทำงานอีกแบบ คือ workload identity federation ตัว Security Token Service ของ Google Cloud รับ credential ภายนอก (OIDC token หรือ SAML token หรือ AWS request ที่ sign แล้ว) เป็น subject token แล้วคืน federated access token กลับมา ไม่มีผู้ใช้และไม่มี call chain มีแค่ workload ที่ข้ามไปอีก trust domain
  - **Transaction token** (draft-ietf-oauth-transaction-tokens) ใช้แนวทางตรงข้ามกับ call chain ภายใน trust domain เดียว: แทนที่จะมี token ต่อ hop ตัว transaction token service จะออก JWT อายุสั้นตัวเดียวให้ทั้ง transaction โดยขอผ่าน profile ของ token exchange และส่งต่อไปโดยไม่แก้ใน header `Txn-Token` ตัว `aud` ของมันคือ trust domain ไม่ใช่ API ตัวเดียว และตั้งใจให้ไม่ใช่ access token ตอนนี้ยังเป็น Internet-Draft: revision 11 ได้ working group consensus แล้วแต่ยังไม่ได้ส่งไปที่ IESG
  - **Identity chaining ข้าม domain** (draft-ietf-oauth-identity-chaining) ครอบคลุม hop ถัดไปที่อยู่ใน trust domain อื่นที่มี authorization server ของตัวเอง: แลก token ที่บ้านเป็น JWT authorization grant แล้วยื่น grant นั้นที่ token endpoint ของ domain อื่นด้วย JWT bearer grant ของ RFC 7523 ตัว draft นี้ approve แล้วและอยู่ในคิวของ RFC Editor แต่ยังไม่ได้ publish เป็น RFC
  - **Service mesh หรือ mutual TLS** authenticate workload ที่เรียก ไม่ใช่ผู้ใช้ ใช้คู่กับ token exchange ไม่ใช่ใช้แทน: ดู [Service Mesh](../service-mesh/) และ [Mutual TLS (mTLS)](../mutual-tls/)
- **ตัวอย่างการรองรับฝั่ง server:** Keycloak มี standard token exchange มาให้ (เปิดเป็น default และเปิดใช้ราย client) ส่วน delegation ด้วย `actor_token` และ claim `act` กับ `may_act` เป็น preview feature ส่วน authorization server ของ Spring Security รับ grant แบบ token-exchange และ OAuth 2.0 client ของมันส่ง token ของ request ปัจจุบันไปเป็น subject token บวก actor token ถ้าเราใส่ resolver ไว้ Okta มี on-behalf-of token exchange บน custom authorization server ส่วน Auth0 มีสอง feature: On-Behalf-Of Token Exchange สำหรับ call ระหว่าง API ของเราเอง ที่ซ้อน client ที่มาแลกไว้ใน `act` และ Custom Token Exchange ที่รัน Action ที่เราเขียนเองเพื่อ validate subject token แบบอื่น และบันทึก actor ได้ด้วย ส่วน Duende IdentityServer ปล่อย grant นี้ไว้ให้ extension grant validator ที่เรา implement เอง ตัวอย่างของมันเอา actor มาจาก client ที่ authenticate แล้ว ไม่ได้เอามาจาก `actor_token`
