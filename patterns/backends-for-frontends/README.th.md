## ปัญหา

API อเนกประสงค์ตัวเดียวแทบไม่เคยเหมาะกับ client ทุกตัว มือถือมีจอเล็ก มี network ที่ช้ากว่าและมักคิดเงินตามปริมาณ แถมต้องประหยัดแบต เลยอยากได้การเรียกน้อยลงและข้อมูลน้อยลง หน้าเว็บที่ซับซ้อนประกอบขึ้นจาก endpoint ย่อย ๆ หลายตัว browser เลยต้องทำหลาย round trip กว่าจะ render ได้ API ที่ส่ง resource เดียวกันให้ทั้งสองฝั่ง ทำให้มือถือดึงข้อมูลเกินที่ใช้ และทำให้ browser ต้องเรียกถี่ ๆ

ฝั่งองค์กรก็รู้สึกเหมือนกัน ทีม client ทุกทีมต้องขอแก้ deployable ตัวเดียวกัน ที่มักมีทีม API แยกเป็นเจ้าของ ทีมนั้นต้องชั่งน้ำหนักความสำคัญของทีม client แต่ละทีมเทียบกัน และการแก้ให้ client หนึ่งก็ต้องตรวจกับ client อื่นทั้งหมด browser app ที่เรียก API ที่ป้องกันด้วย OAuth ยังมีปัญหาเพิ่มอีกข้อ: token ไหนที่ JavaScript ถืออยู่ ก็โดน script ที่ถูก inject เข้ามาในหน้าขโมยไปได้

## ทำงานยังไง

ให้ประสบการณ์ผู้ใช้แต่ละแบบมี backend ของตัวเอง เรียกว่า **Backend for Frontend** โดยทีมที่สร้าง frontend นั้นเป็นเจ้าของ ตัว BFF เป็นส่วนหนึ่งของแอปพลิเคชันที่แค่บังเอิญรันอยู่บน server: มันเปิด API แค่ที่หน้าจอของมันต้องใช้พอดี และ release ไปพร้อมกับหน้าจอพวกนั้น งานที่มันทำบ่อย ๆ:

- **Aggregate** การเรียกครั้งเดียวจาก client กระจายออกไปหลาย service (พร้อมกันถ้าทำได้) แล้ว BFF ก็รวมคำตอบเป็น response เดียว มันยังเป็นคนตัดสินด้วยว่าจะทำยังไงถ้าส่วนที่ไม่บังคับพัง: หน้า product ที่ไม่มีจำนวนสต็อกก็ยังดีกว่าไม่มีหน้าเลย
- **Shape** คืนเฉพาะ field ที่หน้าจอแสดง ในรูปที่หน้าจอต้องใช้: URL ของรูปขนาดสำหรับมือถือ, page model ที่พร้อมใช้สำหรับ web และแบบแบ่งหน้าที่แต่ละ client ชอบ
- **Translate** ซ่อน protocol ภายในและขอบเขตของ service ไว้หลัง API ที่นิ่งหนึ่งตัวต่อ client
- **ถือ session** สำหรับ browser app ตัว BFF เป็น OAuth client ได้ด้วย ทำให้ token ไม่เคยไปถึง JavaScript (ดูข้างล่าง)

ชื่อนี้มาจาก SoundCloud ที่การสร้างทุกแอปบน public API แบบทั่วไปทำให้ต้องเรียกหลายครั้งต่อหน้าจอ และต้องคอยประสานงานกันทุกครั้งที่ endpoint เปลี่ยน Phil Calçado เขียนเล่าวิธีของพวกเขาไว้ในปี 2015 โดยให้เครดิตชื่อนี้กับ Nick Fisher ที่เป็น tech lead ฝั่ง web ของ SoundCloud ส่วนบทความของ Sam Newman ที่เล่าถึงการใช้งานที่ REA ด้วย ทำให้ชื่อนี้เป็นที่รู้จักกว้างขวาง ต้องมี BFF กี่ตัว? กฎที่ Newman ยกมาคือ **หนึ่งประสบการณ์ หนึ่ง BFF**: iOS กับ Android ใช้ BFF ร่วมกันได้ถ้าประสบการณ์ใกล้กันและทีมเดียวเป็นเจ้าของทั้งคู่ และแยกเป็นของตัวเองเมื่อประสบการณ์แตกต่างกัน หรือเป็นของคนละทีม

### กัน token ไม่ให้เข้าไปใน browser

RFC 10017 *OAuth 2.0 for Browser-Based Applications* (เป็น Best Current Practice ตั้งแต่สิงหาคม 2026) เสนอสถาปัตยกรรมสามแบบสำหรับ browser app เรียงจากปลอดภัยมากไปน้อย และ BFF มาเป็นอันดับแรก BFF ในนั้นมีงานสามอย่าง:

1. มันเป็น **confidential OAuth client**: มัน authenticate กับ authorization server และรัน authorization code flow พร้อม PKCE ทำให้ต่อให้ authorization code โดนขโมยไปก็เอาไปแลกไม่ได้ถ้าไม่มี credential ของ BFF
2. มันเก็บ **access token กับ refresh token ไว้ใน session ที่อิงกับ cookie** และไม่เคยให้ browser เห็น
3. มัน **ส่งต่อทุกการเรียก API**: เอา session cookie ออกจาก request แนบ access token ของ user แล้วส่ง request ต่อไปที่ resource server

session cookie ต้องเป็น `Secure` และ `HttpOnly` และควรเป็น `SameSite=Strict` มี `Path=/` ไม่มี attribute `Domain` และมี prefix ของชื่อเช่น `__Host-Http-` ที่บอกว่า cookie นี้ถูกตั้งผ่าน HTTP และกันไม่ให้แชร์กับ subdomain แบบนี้ script ที่ถูก inject เข้ามาในหน้าก็หา token ไปขโมยไม่เจอ แต่มันก็ยังส่ง request ผ่าน BFF ได้ระหว่างที่หน้ายังเปิดอยู่ การป้องกัน XSS แบบปกติ (เขียนโค้ดอย่างปลอดภัย, Content Security Policy) เลยยังสำคัญอยู่ RFC แนะนำสถาปัตยกรรมนี้อย่างยิ่งสำหรับแอปธุรกิจ แอปที่อ่อนไหว และแอปที่จัดการข้อมูลส่วนบุคคล

ส่วน native app จะทำตาม RFC 8252 แทน: ตัวแอปเองเป็น OAuth client (เป็น public client ยกเว้นจะได้ secret ราย instance ผ่าน dynamic registration) และรัน code flow พร้อม PKCE ผ่าน browser ของระบบ แล้วปกติก็ส่ง access token ของตัวเองไปที่ Mobile BFF

## ใช้ตอนไหนดี

- มี client หลายประเภท (web, iOS และ Android, partner, TV) ที่หน้าจอ, network หรือรอบการ release ต่างกัน โดยเฉพาะเมื่ออยู่หน้า microservice จำนวนมาก ที่หน้าจอส่วนใหญ่ต้องใช้ข้อมูลจากหลายตัว
- ทีม frontend ที่ต้องเปลี่ยน API ให้เร็วเท่ากับ UI โดยไม่ต้องไปต่อคิวทีม API กลาง
- browser app ที่เรียก API ที่ป้องกันด้วย OAuth แทน user โดยเฉพาะกับข้อมูลธุรกิจหรือข้อมูลส่วนบุคคล: BFF กัน token ไม่ให้ไปอยู่ใน JavaScript
- ไม่ใช่สำหรับ web client ตัวเดียวที่มีอะไรให้ aggregate น้อย และไม่มี OAuth token ที่ต้องกันออกจาก browser เพราะในกรณีนี้ BFF ก็เป็นแค่อีก hop หนึ่งที่ต้องรัน ส่วน Newman บอกว่าแอปที่มีแค่ web จะต้องมี BFF ก็ต่อเมื่อมีงาน aggregate ฝั่ง server เยอะ คำแนะนำของ Azure ก็บอกว่า pattern นี้ไม่เหมาะเมื่อมีแค่ interface เดียวที่ใช้ backend หรือเมื่อ interface ต่าง ๆ ส่ง request แบบเดียวกันหรือคล้ายกัน
- ถ้า BFF สองตัวมีโค้ดเดียวกันงอกขึ้นเรื่อย ๆ ให้ถือเป็นสัญญาณ: ไม่ประสบการณ์ก็เหมือนกันและ BFF ตัวเดียวก็พอ หรือ logic ที่ใช้ร่วมกันควรไปอยู่ใน service

## ได้อะไร เสียอะไร

- **มีของต้องรันมากขึ้น** BFF ทุกตัวเป็น service ที่มี pipeline, monitoring, เวร on-call และการลง patch ของตัวเอง และทุก request ก็ต้องเพิ่ม network hop อีกหนึ่ง hop เลยควรทำ BFF ให้บาง เป็น stateless ยกเว้น session store และ scale แบบ horizontal
- **โค้ดซ้ำ** โค้ด aggregate ที่คล้ายกันจะโผล่ใน BFF หลายตัว Newman ยอมรับตรงนี้ได้ดีกว่าผูก BFF เข้าหากันด้วย shared library และจะแยกออกมาเป็น shared service (หรือดัน aggregation ลงไปไว้ใน downstream service) เมื่อ logic เดิมกำลังจะถูกเขียนเป็นครั้งที่สาม SoundCloud ก็ทำแบบนั้นเป๊ะ: เปลี่ยนการประกอบหน้า profile ที่ซ้ำกันอยู่ใน BFF หลายตัวให้กลายเป็น UserProfileService
- **business logic ค่อย ๆ ไหลเข้ามา** ราคา กฎเรื่องสิทธิ์ และการตัดสิน authorization ควรอยู่ใน domain service ถ้ามันรั่วเข้ามาใน BFF เมื่อไร web กับ mobile ก็จะค่อย ๆ เห็นไม่ตรงกันเรื่อง order เดียวกัน BFF ควรมีแค่ logic เฉพาะประสบการณ์ของมัน: การประกอบ การจัดรูป การแปลง protocol และการจัดการ session
- **Fan-out พัง** response ของ BFF ขึ้นกับทุก service ที่มันเรียก ให้การเรียก downstream แต่ละครั้งมี timeout ตัดสินว่าส่วนไหนไม่บังคับ และทำให้ client render response ที่ได้มาไม่ครบได้
- **แอป version เก่า** แอปมือถือถูกติดตั้งค้างอยู่เป็นเดือน Mobile BFF เลยต้องรองรับ version เก่า ๆ ต่อไป: ทำการเปลี่ยนแปลงแบบเพิ่มเข้าไปอย่างเดียว หรือทำ version ให้ endpoint
- **BFF เทียบกับ API gateway** [API gateway](../api-gateway/) คือประตูหน้าบ้านที่ใช้ร่วมกันบานเดียวสำหรับ cross-cutting policy (TLS, authentication, quota, routing) ปกติทีม platform เป็นคนรัน ส่วน BFF คือ backend หนึ่งตัวต่อหนึ่งประสบการณ์ ทีม frontend เป็นเจ้าของ และมีการประกอบข้อมูลเฉพาะ client ส่วน Chris Richardson อธิบายว่า BFF เป็นรูปแบบหนึ่งของ gateway pattern คือหนึ่ง gateway ต่อ client หนึ่งประเภท และสองอย่างนี้ใช้ร่วมกันได้ดี: ตัวอย่างอ้างอิงของ Azure วาง gateway ไว้หน้า BFF เพื่อจัดการ authorization, monitoring, caching และ routing
- **BFF เทียบกับ GraphQL** GraphQL ให้ client แต่ละตัวเลือก field ที่ต้องใช้พอดีจาก schema เดียว ปัญหาดึงข้อมูลเกินที่ BFF จะต้องแก้เลยหายไปเยอะ คำแนะนำของ Azure บอกว่าถ้ามี resolver เฉพาะ frontend แล้ว BFF ที่แยกกันอาจช่วยเพิ่มได้ไม่มาก แต่ต้นทุนก็ย้ายไปที่อื่น: schema กลายเป็น contract ที่หลายทีมใช้และดูแลร่วมกัน และ query แบบไหนก็ได้ต้องมี demand control เช่น จำกัดความลึก วิเคราะห์ความซับซ้อนของ query หรือ trusted document นอกจากนี้ GraphQL server ยังเป็น BFF เองก็ได้ และ GraphQL Federation ก็ประกอบ graph เดียวจาก subgraph ของหลาย service ไว้หลัง gateway

## ข้อควรรู้ตอนลงมือทำ

- **สร้างด้วย stack ของทีม frontend** มักเป็นภาษาเดียวกับ client (เช่น TypeScript สำหรับทีม web) และ deploy ไปพร้อมกับ client
- **Fan out แบบขนาน** โดยมี timeout ทุกการเรียก และส่ง trace context (W3C `traceparent`) ไปกับทุกการเรียก downstream เพื่อให้หน้าจอหนึ่งหน้าโผล่เป็น trace เดียว (ดู [Distributed Tracing](../distributed-tracing/))
- **Cache response ที่ aggregate แล้วอย่างระวัง** ตัว reverse proxy ที่อยู่หน้า BFF ก็ cache response พวกนี้ได้ แต่อายุต้องไม่ยาวกว่าที่ข้อมูลชิ้นที่สดที่สุดใน response ยอมให้
- **Web BFF ในฐานะ OAuth client** (RFC 10017 §6.1 และ flow [Authorization Code + PKCE](../oauth2-authorization-code-pkce/) ที่มันรัน):
  - authenticate ที่ token endpoint ด้วย credential แบบ asymmetric ถ้าทำได้ (`private_key_jwt` หรือ mutual TLS ตามที่ RFC 9700 แนะนำ) และให้ access token อายุสั้นและ scope แคบ
  - เลือกว่า session จะอยู่ที่ไหน **Server-side session** เก็บ token ไว้บน server เหมือนใน diagram และ revoke ได้ทันที แต่ต้องมี sticky session, session replication หรือ shared store และเพราะเหตุนี้ RFC ถึงแนะนำแบบนี้เฉพาะ deployment ขนาดเล็ก ส่วน **client-side session** ใส่ token ไว้ใน cookie แบบ `HttpOnly` ที่เข้ารหัสไว้และมีแค่ BFF ที่ถอดรหัสได้ ทำให้ instance ไหนก็ตอบ request ไหนก็ได้ และการ revoke token ก็ตัดการเข้าถึง
  - refresh access token ข้างใน BFF แบบ inline ตอนที่การเรียกต้องใช้ ตั้งอายุ session ให้ตรงกับอายุสูงสุดของ refresh token และจบ session เมื่อ refresh token ใช้ไม่ได้แล้ว
  - ป้องกัน CSRF: `SameSite=Strict` ไม่พอถ้ามีแอปอื่นอยู่บน site เดียวกัน เลยต้องบังคับ custom request header ด้วย (request ข้าม origin ที่มี header นี้ต้องผ่าน CORS preflight) หรือใช้ anti-forgery token ของ framework
  - ส่งต่อการเรียกไปเฉพาะ resource server กับ path ที่อยู่ใน allowlist เท่านั้น BFF จะได้ไม่โดนหลอกให้ส่ง token ของ user ไปที่อื่น
  - บอก resource server ให้รู้เรื่อง BFF: การเรียกของ user ทุกคนตอนนี้มาจาก address ของ BFF ทำให้ rate limit ที่ใช้ IP ของ client เป็น key จะทำงานผิด
- **Library:** Duende.BFF สำหรับ ASP.NET Core, OAuth 2.0 client ของ Spring Security คู่กับ filter `TokenRelay` ของ Spring Cloud Gateway หรือ token handler pattern ของ Curity ที่แบ่งบทบาทเป็น OAuth agent ที่ออก cookie กับ plugin ของ API gateway ที่แลก cookie เป็น access token
