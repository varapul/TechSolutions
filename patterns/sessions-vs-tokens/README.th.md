## ปัญหา

HTTP ลืมว่าใครเป็นคนเรียกตั้งแต่ request หนึ่งไปอีก request หนึ่ง พอ Ana sign in แล้ว ทุก request หลังจากนั้นก็ยังต้องตอบสองคำถาม: นี่คือใคร และเขาทำอะไรได้บ้าง ต้องมีอะไรสักอย่างพาคำตอบนั้นจาก request หนึ่งไปอีก request หนึ่ง และมีที่เก็บได้สองที่

- **เก็บบน server** server เก็บ session record ไว้ แล้วให้ client ถือ pointer ที่ไม่มีความหมายอะไรชี้ไปหา record นั้น server ยังคุมทุก session ได้ และทุก request เริ่มด้วยการ lookup
- **เก็บใน credential** issuer sign ข้อเท็จจริงลงไปใน token แล้วใครที่ได้ token ไปก็ตรวจมันได้เองโดยไม่ต้องถามใคร ไม่ต้อง lookup อะไร และก็ดึงอะไรคืนไม่ได้

การเลือกนี้ตัดสินว่า state อยู่ที่ไหน แต่ละ request มีต้นทุนเท่าไร server ต้องแชร์อะไรกันเมื่อ scale out และเราตัดสิทธิ์ใครสักคนได้เร็วแค่ไหน: นี่คือสี่ขั้นใน diagram แต่จริง ๆ มันก็ไม่ได้เป็นการเลือกขนาดที่ดูเหมือน เพราะระบบจริงส่วนใหญ่สุดท้ายก็ใช้ทั้งสองแบบ

## ทำงานยังไง

**Server-side session** ตอน sign in ตัว app server สร้าง record ใน session store (ผู้ใช้คือใคร role ของเขา session จบเมื่อไร และอะไรอื่นที่แอปอยากจำไว้) แล้วส่ง key ของ record ให้ browser: เป็น **session ID** สุ่มยาว ๆ อยู่ใน cookie แล้ว browser ก็ส่ง cookie นั้นกลับมากับทุก request ที่ไปหาเว็บนั้น โดยไม่ต้องมีโค้ดอะไรมาเกี่ยว ฝั่ง server อ่าน record ตาม ID แล้ว request ก็ authenticate เรียบร้อย ID ไม่มีข้อมูลอะไรอยู่ข้างใน เลยไม่มีอะไรให้อ่านหรือให้ปลอม แค่ต้องเดาไม่ได้ก็พอ การจบ session ก็คือการลบ record

**Self-contained token** ตอน sign in ตัว issuer (ปกติคือ OAuth 2.0 authorization server) ใส่ข้อเท็จจริงชุดเดียวกันลงไปเป็นชุด **claim** (`sub`, role หรือ `scope`, `exp`) sign ด้วย private key ของตัวเอง แล้วส่งผลลัพธ์ให้ client โดยปกติจะอยู่ในรูป JWT (RFC 7519 และ RFC 9068 คือ profile สำหรับ OAuth access token) จากนั้น client ก็ส่ง token ไปกับแต่ละ request ใน header `Authorization: Bearer` แล้ว API ไหนก็ตามที่มี public key ของ issuer ก็ตรวจ signature และ claim ได้เอง โดยไม่ต้องเรียก issuer หรือ database เลย [JWT Validation](../jwt-validation/) ไล่การตรวจพวกนี้ให้ดู ส่วน API ไม่ต้องเก็บอะไรรายผู้ใช้ ราคาที่ต้องจ่ายคือ token ยัง valid อยู่จนถึง `exp` ไม่ว่าระหว่างนั้นจะเกิดอะไรขึ้น

| | Server-side session | Self-contained token |
|---|---|---|
| state อยู่ที่ | ใน session store | ใน token ที่ client ถืออยู่ |
| client ถือ | ID สุ่มแบบ opaque | claim ที่ sign แล้ว ใครถือก็อ่านได้ |
| ต้นทุนต่อ request | lookup ใน store หนึ่งครั้ง เป็น network round trip | ตรวจ signature หนึ่งครั้ง ใช้แค่ CPU |
| server ต้องแชร์ | store หรือใช้ sticky session | public key ของ issuer |
| sign out หรือ role ที่เปลี่ยนมีผล | ใน request ถัดไป | ตอน token หมดอายุ |
| ส่งไปในรูป | cookie ที่ browser แนบให้ | header ที่โค้ดของ client แนบ |
| ขนาดในทุก request | ไม่กี่สิบ byte | หลายร้อย byte บางทีเป็น kilobyte |

### ไม่ใช่ต้องเลือกอย่างใดอย่างหนึ่ง

สองแบบนี้เป็นปลายสองข้างของช่วงเดียวกัน และระบบจริงก็ผสมกัน:

- **session สำหรับ browser และ token ระหว่าง service** [backend for frontend](../backends-for-frontends/) เก็บ OAuth token ไว้บน server ให้ browser ถือแค่ session cookie แล้วเติม access token ฝั่ง server ตอน forward call ไปที่ API ตัว RFC 10017 ที่เป็น best current practice ของ IETF สำหรับ browser-based app แนะนำแบบนี้อย่างหนักแน่นสำหรับแอปธุรกิจ แอปที่ sensitive และแอปไหนก็ตามที่จัดการข้อมูลส่วนบุคคล การ sign in ด้วย [OpenID Connect](../openid-connect/) ก็มีหน้าตาแบบเดียวกัน: แอป validate ID token ครั้งเดียวแล้วรัน session ของตัวเองต่อ
- **Opaque token คู่กับ introspection** access token ไม่ต้องเป็นแบบ self-contained ก็ได้ ตัว issuer แจก handle สุ่ม ๆ ไปก็ได้ แล้วให้แต่ละ API ถามที่ introspection endpoint (RFC 7662) ว่ามันหมายถึงอะไร นี่ก็คือ session ในชื่ออื่น: ไม่มีอะไรรั่วไปถึง client, revoke ได้ทันที และทุก request ต้องเสีย lookup หนึ่งครั้ง แบบที่ใช้กันบ่อยคือให้ [API gateway](../api-gateway/) เป็นคน lookup แล้ว forward JWT ไปให้ service ข้างหลัง ทำให้ client ถือแค่ reference ส่วน service ก็ยัง verify เองในเครื่องได้ (Curity เรียกว่า phantom token approach)
- **ข้อมูล session ใน cookie ที่ sign หรือเข้ารหัสไว้** server อัด session ลงไปใน cookie แล้วป้องกันด้วย key ที่มีแค่ตัวเองถือ แบบนี้ไม่ต้องมี store และก็ revoke ยากพอ ๆ กับ token (ดูหัวข้อ ได้อะไร เสียอะไร)

## ใช้ตอนไหนดี

**Session เหมาะกับ**

- web application ตัวเดียวที่มี backend ของตัวเองบนเว็บของตัวเอง: แอปที่ render ฝั่ง server หรือ single-page app ที่คุยกับ API ของตัวเองเท่านั้น RFC 10017 พูดเรื่องนี้จากฝั่ง OAuth: แอปแบบนี้มักไม่ต้องใช้ access token ระหว่าง frontend กับ backend เลยด้วยซ้ำ และ cookie session ฝั่ง server ก็ทำงานนี้ได้ (มันยังส่งตัว login ไปให้ OpenID Connect provider ทำได้อยู่)
- อะไรก็ตามที่การ sign out, account ที่ถูกล็อก หรือ permission ที่เปลี่ยน ต้องมีผลตั้งแต่ request ถัดไปทันที: admin console, ธนาคาร, เวชระเบียน
- ตอนที่อยากเห็นและจัดการ session ได้: ดูว่าผู้ใช้ sign in อยู่ที่ไหนบ้าง sign out เขาออกจากทุกที่ จำกัดจำนวน session ที่เปิดพร้อมกัน

**Token เหมาะกับ**

- API ที่ถูกเรียกจากหลาย service, จาก mobile app หรือจาก third party โดยที่ API แชร์ session store กับใครก็ตามที่ authenticate caller มาไม่ได้
- call ที่ข้ามเส้นแบ่งระหว่างทีม บริษัท หรือ region สิ่งเดียวที่ทั้งสองฝั่งต้องมีคือ public key ของ issuer
- request rate หรืองบ latency ที่ network round trip เพิ่มอีกหนึ่งรอบในทุก call มากเกินไป และการ revoke ที่ช้าไปไม่กี่นาทีรับได้

**ใช้ทั้งคู่** เมื่อ browser app วางอยู่หน้า API ที่ป้องกันด้วย token: ใช้ session cookie ระหว่าง browser กับ backend ของมัน แล้วใช้ token จากตรงนั้นเป็นต้นไป

**คิดให้ดีก่อน** จะเอา JWT มาแทน session ใน web app ตัวเดียวเพียงเพื่อให้ stateless เราจะแลก store lookup หนึ่งครั้งกับปัญหาการ revoke, request ที่ใหญ่ขึ้น และคำถามว่า browser จะเก็บ token ไว้ที่ไหน JWT cheat sheet ของ OWASP ก็ให้เหตุผลแบบเดียวกัน: พอเพิ่ม denylist เพื่อ invalidate session มันก็ไม่ stateless อีกต่อไป และ session system ธรรมดาอาจเป็นตัวเลือกที่ดีกว่า

## ได้อะไร เสียอะไร

- **ความต่างจริง ๆ อยู่ที่การ revoke** การลบแถว session ตัดสิทธิ์ได้ตั้งแต่ request ถัดไป แต่ self-contained token ยกเลิกการออกไม่ได้: RFC 7009 บังคับให้ authorization server รองรับการ revoke refresh token แต่แค่แนะนำสำหรับ access token และบอกไว้ว่าการดึง self-contained access token คืนทันทีต้องมีการสื่อสารกับ API เพิ่มเติมแบบที่ไม่เป็นมาตรฐาน ตัดสินใจก่อนว่า credential ที่ถูก revoke แล้วจะยังใช้ได้อีกนานแค่ไหน แล้วค่อยเลือกกลไกที่ถูกที่สุดที่ทำได้ตามนั้น ทุกกลไกพาระบบที่ใช้ token ถอยกลับไปทาง session:
  - *อายุสั้นบวก refresh token* ตัว access token อยู่ได้หลักนาที และ issuer ปฏิเสธการ refresh ครั้งถัดไปได้ ช่วงเวลานั้นหดลงแต่ไม่เคยปิดสนิท แล้ว refresh token ก็กลายเป็นความลับอายุยาวที่ต้องปกป้อง (ดู refresh token rotation) ตัวอย่างใน RFC 10017 จับคู่ access token อายุ 10 นาทีกับ refresh token อายุ 8 ชั่วโมง
  - *Denylist* ของ token ID ที่ถูก revoke เก็บไว้แค่จนถึงเวลาที่ token พวกนั้นจะหมดอายุอยู่แล้ว มันเล็ก แต่ทุก API ต้องเช็กมันทุก request ตัว shared store เลยกลับมาอีก OWASP บอกให้ใช้ `jti` กับ `iss` เป็น key ห้ามใช้ token ดิบหรือ hash ของมัน
  - *Introspection* (RFC 7662): แต่ละ API ถาม issuer ว่า token ยัง active อยู่ไหม คำตอบเป็นปัจจุบันเสมอ แลกกับ latency, load และ runtime dependency แบบแข็งกับ issuer การ cache คำตอบ (RFC อนุญาตให้ทำได้) จะเปิดช่วงเวลานั้นกลับมาอีก
  - *Status list:* token ชี้ไปที่ list ที่บีบอัดไว้ โดย issuer เป็นคน publish แล้ว verifier ดึงไป cache ส่วน Token Status List draft ของ IETF approve แล้วและกำลังรอในคิวของ RFC Editor (ตุลาคม 2026)
  - *Pushed event:* issuer บอก API ที่ subscribe ไว้ให้เลิกรับ token ของผู้ใช้คนหนึ่ง OpenID Shared Signals Framework กับ CAEP ที่เป็น final specification ตั้งแต่กันยายน 2025 ทำเรื่องนี้ให้เป็นมาตรฐาน ส่วน continuous access evaluation ของ Microsoft Entra คือตัวอย่างหนึ่งที่ใช้จริง: token อยู่ได้นานถึง 28 ชั่วโมง เพราะ account ที่ถูก disable หรือ password ที่เปลี่ยนไปถึง service ที่ร่วมโครงการได้เกือบ real time (Microsoft บอกว่าไม่เกิน 15 นาที)
- **การขโมย** ทั้ง session ID และ bearer token ใช้ได้กับใครก็ตามที่ถืออยู่ session ที่โดนขโมยลบทิ้งได้ทันทีที่รู้ตัว แต่ token ที่โดนขโมยต้องรอให้หมดอายุ ยกเว้นจะผูกไว้กับผู้ส่งตั้งแต่แรก (DPoP หรือ mutual TLS ดู [JWT Validation](../jwt-validation/))
- **Claim ที่ stale** token คือภาพ ณ ตอนนั้น ถ้า role ของ Ana เปลี่ยนจาก editor เป็น viewer แถว session แก้ได้ทันที แต่ token ของเธอจะยังบอกว่า `editor` ไปจนกว่าจะออกตัวใหม่ ใส่ข้อเท็จจริงที่ไม่ค่อยเปลี่ยนไว้ใน token และ lookup อะไรก็ตามที่เปลี่ยนเร็ว
- **session store คือ dependency ที่อยู่บน hot path** latency ของมันบวกเข้าไปในทุก request ถ้ามันล่มทุกคนก็เข้าไม่ได้ ถ้า store ทำข้อมูลหายทุกคนก็โดน sign out ส่วน memory ของมันโตตามจำนวน session ที่ยังมีชีวิต และ deployment แบบหลาย region ต้อง replicate มัน หรือผูกผู้ใช้ไว้กับ region เดียว แลกกับการที่มันเป็นที่เดียวที่รู้จักทุก session ที่ยังมีชีวิตอยู่
- **Sticky session แทน shared store** การเก็บ session ไว้ใน memory ของแต่ละ server แล้วผูกผู้ใช้ด้วย affinity ของ [load balancer](../load-balancing/) เลี่ยงการมี store ได้ แต่ทำให้ load ไม่สมดุล session หายเมื่อ instance ตาย และ scale in ยากขึ้น RFC 10017 ระบุว่า sticky session และ session replication คือต้นทุนในการ scale ของ server-side session และเพราะแบบนี้ถึงแนะนำให้ใช้กับ BFF เฉพาะตอน scale เล็กเท่านั้น
- **ขนาด token ในทุก request** session ID มีขนาดไม่กี่สิบ byte ส่วน JWT ที่ sign แล้วปกติก็หลายร้อย byte เป็นอย่างน้อย (แค่ signature แบบ RS256 จาก key ขนาด 2048 bit ก็ 256 byte ก่อน encode แล้ว) และโตขึ้นตามทุก role และ group ที่เพิ่มเข้าไป ส่วน issuer ก็ตั้งเพดานไว้: อย่าง Microsoft Entra ID ใส่ group ใน JWT ได้ไม่เกิน 200 ตัว ถ้าเกินก็ตัดทิ้งแล้วตั้ง overage marker ไว้ ทำให้ API ต้องไปถาม Microsoft Graph แทน ฝั่ง transport ก็มีข้อจำกัด: server หลายตัวจำกัด header field ไว้ราว 8 KB เป็น default และ cookie ตัวหนึ่งก็ได้สูงสุดราว 4 KB
- **คนถืออ่านได้** claim ของ JWT แค่ถูก encode ไม่ได้ถูกเข้ารหัส ทำให้ client และใครก็ตามที่เห็น token ก็อ่านได้ RFC 9068 บอก client ว่าอย่าพึ่งเนื้อหาข้างใน และบอก issuer ให้ถือว่ามันมองเห็นได้ ส่วน session ID ไม่เผยอะไรเลย
- **Cookie พา CSRF มาด้วย ส่วน token ที่ script ถือก็เสี่ยงโดน XSS ขโมย** browser แนบ cookie ไปเอง ทำให้ cross-site request forgery เกิดขึ้นได้ และก็เป็นสิ่งเดียวกันที่ทำให้ `HttpOnly` กัน credential ไว้ให้พ้นจาก script ได้ ส่วน bearer token ใน header ไม่เคยถูกส่งไปตามความคิดของ browser เอง เลยรอดจาก CSRF แต่ต้องมีโค้ดถือมันไว้ แล้ว script ที่ถูก inject ก็อ่านมันได้จากทุกที่ที่โค้ดนั้นเก็บไว้ ถ้าใช้ cookie แบบ `HttpOnly` ตัว script ที่ถูก inject ยังส่ง request จากหน้าที่เปิดอยู่ได้ แต่ขน session ออกไปไม่ได้
- **cookie session แบบ sign หรือเข้ารหัสอยู่ตรงกลาง** cookie store ที่เป็น default ของ Rails, signed-cookie backend ของ Django, default session ของ Flask และ cookie authentication ของ ASP.NET Core เก็บข้อมูล session ไว้ใน cookie เลย ไม่มี store ให้ต้องรัน และ server ไหนที่มี key ก็รับ request ไหนก็ได้ ต้นทุนคือ: ราว 4 KB ต่อ cookie, sign ไม่ได้แปลว่าเข้ารหัส (cookie ของ Django และ Flask ผู้ใช้อ่านได้ ส่วนของ Rails และ ASP.NET Core เข้ารหัสไว้) และ cookie ที่โดนก็อปไปยังใช้ได้หลัง sign out จนกว่าจะหมดอายุ อย่างที่เอกสารของ Django บอกไว้ ส่วนเอกสารของ ASP.NET Core เสริมว่า account ที่ถูก disable จะยัง sign in อยู่ ยกเว้นจะเช็กทุก request กับ user database และนั่นก็เสีย performance

## ข้อควรรู้ตอนลงมือทำ

- **Session ID** ใช้ session manager ของ framework แทนการเขียนเอง Session Management Cheat Sheet ของ OWASP ขอ entropy อย่างน้อย 64 bit จาก generator ที่ปลอดภัยทาง cryptography (อย่างน้อยที่สุด 16 ตัวอักษรฐานสิบหก) และอย่างน้อย 128 bit ถ้าเรา generate ID เอง ส่วนตัว ID ต้องไม่มีความหมายอะไร ไม่ควรวิ่งไปใน URL และ server ควรรับแค่ ID ที่ตัวเองออกให้
- **เปลี่ยน ID ใหม่ตอน sign in** และทุกครั้งที่สิทธิ์เปลี่ยน ไม่อย่างนั้น attacker ที่ฝัง ID ที่ตัวเองรู้ไว้ใน browser ของเหยื่อก่อน login จะได้ session นั้นไปหลังจากนั้น (session fixation)
- **Timeout** ที่บังคับใช้ฝั่ง server: มีทั้ง idle timeout และ absolute timeout ช่วงที่ OWASP ใช้กันทั่วไปคือ idle 2 ถึง 5 นาทีสำหรับแอปที่มีมูลค่าสูง และ 15 ถึง 30 นาทีสำหรับแอปที่ความเสี่ยงต่ำ โดยมี absolute limit 4 ถึง 8 ชั่วโมงสำหรับแอปที่ใช้ตลอดวันทำงาน ใน diagram Ana sign in ตอนเที่ยง: แถว session ของเธอหมดอายุตอน 20:00 ขณะที่ `exp` ของ token คือ 12:15
- **Cookie attribute** ใส่ `Secure` และ `HttpOnly` เสมอ ตั้ง `SameSite` ให้ชัดเจน เพราะ browser แต่ละตัวเห็นไม่ตรงกันว่า default คืออะไร (browser ที่ใช้ Chromium ถือว่าไม่มี attribute คือ `Lax` แต่ตอนนี้ Firefox กับ Safari ไม่ได้ทำแบบนั้น) ค่า `Strict` ไม่ส่ง cookie ไปกับทุก cross-site request รวมถึงตอนกด link มาจากเว็บอื่น ผู้ใช้เลยมาถึงในสภาพที่ดูเหมือนยังไม่ได้ sign in ส่วน `Lax` ส่ง cookie ไปกับ top-level navigation ที่ใช้ safe method แล้วก็ใส่ name prefix `__Host-` ด้วย: browser จะไม่รับ cookie ถ้ามันไม่ได้เป็น `Secure`, ไม่มี `Path=/` หรือมี `Domain` ทำให้มันผูกกับ host เดียว OWASP แนะนำ prefix นี้สำหรับ session ID ส่วน RFC 10017 แนะนำ `__Host-Http-` สำหรับ cookie ของ BFF เป็น prefix รุ่นใหม่ที่บังคับ `HttpOnly` ด้วย ตอนนี้ Chrome กับ Firefox รุ่นปัจจุบันบังคับใช้แล้ว แต่ Safari ยัง
- **มาตรฐาน cookie กำลังเปลี่ยนผ่าน** RFC 6265 (2011) ยังเป็น specification ที่ publish อยู่ ฉบับแก้ไขคือ draft-ietf-httpbis-rfc6265bis ที่กำหนด `SameSite` และ prefix `__Secure-` กับ `__Host-` ไว้ ตอนนี้ approve แล้วและกำลังรอในคิวของ RFC Editor (ตุลาคม 2026) ส่วน prefix `__Http-` มาจาก working-group draft ที่ออกมาทีหลัง
- **การป้องกัน CSRF** OWASP มอง `SameSite` เป็น defence in depth เป็นหลัก ไม่ใช่คำตอบทั้งหมด ใช้การป้องกันที่ติดมากับ framework ถ้ามี ไม่อย่างนั้นก็เพิ่ม synchronizer token (หรือ signed double-submit cookie ถ้าไม่เก็บ state ฝั่ง server) หรือเช็ก request header ของ Fetch Metadata หรือบังคับ custom header กับ endpoint แบบ API และห้ามเปลี่ยน state ใน `GET` เด็ดขาด script ที่ถูก inject ชนะวิธีพวกนี้ได้ทั้งหมด เพราะฉะนั้นมันใช้แทนการป้องกัน XSS ไม่ได้
- **Token ใน browser** RFC 10017 ไล่ดูทางเลือกต่าง ๆ: `localStorage`, `sessionStorage` และ IndexedDB ถูกอ่านได้จากทุก script ที่รันใน origin ของหน้านั้น การเก็บ token ไว้ใน memory จำกัดการเปิดเผยได้ แต่ไม่รอดจากการ reload และไม่มีเทคนิคการเก็บแบบไหนกัน script ที่ถูก inject ไม่ให้ขอ token ใหม่จาก issuer ได้ มันเลยจัดอันดับ architecture ตามนั้น: backend for frontend มาก่อน ตามด้วย backend ที่แค่ไปเอา token มา แล้วค่อยเป็น OAuth client ที่อยู่ใน browser ล้วน ๆ และแบบสุดท้ายนี้มันไม่แนะนำให้ใช้ในทุกที่ที่มีข้อมูลธุรกิจ ข้อมูล sensitive หรือข้อมูลส่วนบุคคลเกี่ยวข้อง
- **อายุของ token** ให้ access token อายุสั้น และเช็กว่า issuer ของเราทำอะไรเป็น default: เช่น Microsoft Entra ID ออก access token ที่อยู่ได้ 60 ถึง 90 นาที สำหรับ public client ตัว RFC 9700 บังคับให้ refresh token ต้อง rotate ทุกครั้งที่ใช้ หรือผูกไว้กับผู้ส่ง
- **Audience** การที่ service ไหนก็*ตรวจ* token ได้ ไม่ได้แปลว่าทุก service ควรรับมัน RFC 9700 แนะนำให้จำกัด access token แต่ละตัวไว้กับ API เดียว หรือกลุ่ม API เล็ก ๆ และบังคับให้ API ปฏิเสธ token ที่ไม่ได้ออกให้ตัวเอง ถ้าจะเรียก API ตัวถัดไป ให้แลก token เป็นตัวที่ออกให้ API นั้น (token exchange) แทนที่จะส่งตัวเดิมต่อไป
- **Session store** ตัวเลือกปกติคือ Redis หรือ Valkey, Memcached หรือ table ใน database ให้แต่ละ entry มี time to live ตรงกับ session timeout ด้วย แล้ว framework ส่วนใหญ่ก็รองรับพวกนี้: Django เก็บ session ใน database เป็น default และวาง cache ไว้ข้างหน้าได้ ส่วน Spring Session ใช้ Redis หรือ JDBC เป็นที่เก็บ servlet session เช็ก default ก่อนขึ้น production: อย่าง express-session มาพร้อม in-memory store ที่เอกสารของมันเองบอกว่าไม่ได้มีไว้ใช้ใน production และปล่อย attribute `Secure` ของ cookie ไว้แบบปิด
- **Sign-out** สำหรับ session: ลบ record แล้วล้าง cookie สำหรับ token: revoke refresh token ที่ issuer (RFC 7009) ทิ้ง token ฝั่ง client และยอมรับว่า access token ที่ออกไปแล้วจะใช้ได้จนถึง `exp` ยกเว้นจะมีกลไกข้างบนตัวใดตัวหนึ่งอยู่ ถ้าใช้ single sign-on ก็ยังมีอีก session หนึ่งที่ identity provider ส่วน [OpenID Connect](../openid-connect/) อธิบายว่าการ logout ถูกส่งต่อกันยังไง
