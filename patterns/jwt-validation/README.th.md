## ปัญหา

API ที่รับ OAuth 2.0 access token ต้องตัดสินใจในทุก request ว่า token เป็นของจริงไหม ออกให้ตัวเองหรือเปล่า ยังไม่หมดอายุใช่ไหม และให้สิทธิ์พอกับสิ่งที่ขอมาหรือไม่ การถาม authorization server ทุกครั้ง (token introspection) ได้คำตอบที่สดใหม่ แต่เพิ่ม network round trip ให้ทุก call และทำให้ authorization server เป็น runtime dependency ของทุก API: ถ้ามันช้าหรือล่ม ทุกอย่างที่อยู่ข้างหลังมันก็ช้าหรือล่มตาม

JWT ที่ sign แล้วทำให้ API ตอบคำถามนี้ได้เอง อันตรายอยู่ที่การทำแค่ครึ่งเดียว "signature ถูกต้อง" ไม่ได้แปลว่า "token นี้ออกให้เรา": API ที่ตรวจแค่นั้นจะรับ token ที่หมดอายุแล้ว token ที่ออกให้ API อื่น ID token และ token ที่ปลอมโดยใครก็ได้ที่หลอกให้มันใช้ key หรือ algorithm ผิดตัว การโจมตี JWT แบบคลาสสิกอาศัยการตรวจที่ขาดหายไป ไม่ใช่ cryptography ที่พัง

## ทำงานยังไง

**Token** JWT ที่ sign แล้วคือ JWS (RFC 7515) ในรูปแบบ compact: สามส่วนที่ encode เป็น base64url แล้วต่อกันด้วยจุด `header.payload.signature`

- **header** บอกว่า token ถูก sign ยังไง: algorithm (`alg`), ID ของ key (`kid`) และสำหรับ access token ที่ทำตาม RFC 9068 ก็มี type `at+jwt`
- **payload** เก็บ claim: ใครออก token (`iss`) token พูดถึงใคร (`sub`) ออกให้ API ไหน (`aud`) หมดอายุเมื่อไร (`exp`) และอนุญาตให้ทำอะไร (`scope`) ส่วน RFC 9068 ก็บังคับให้มี `client_id`, `iat` และ `jti` ด้วย
- **signature** คำนวณจาก header กับ payload ที่ encode แล้ว เปลี่ยนตัวอักษรตัวเดียวของส่วนไหนก็ทำให้มันพัง

payload แค่ถูก encode ไม่ได้ถูกเข้ารหัส ใครถือ token ก็อ่าน claim ได้ทุกตัว: client, proxy หรือ log file อย่าใส่ secret ลงไป และใส่ข้อมูลส่วนบุคคลแค่เท่าที่ API ต้องใช้ ถ้าตัว claim เองต้องเป็นความลับ ให้ใช้ JWT ที่เข้ารหัส (JWE, RFC 7516) หรือ opaque token

**Key** API ถูกตั้งค่าให้เชื่อ issuer ตัวหนึ่ง แล้วหาทุกอย่างที่เหลือจากตรงนั้น มันอ่าน metadata ของ issuer ที่ `/.well-known/oauth-authorization-server` (RFC 8414) หรือ `/.well-known/openid-configuration` (OpenID Connect Discovery) ตรวจว่า `issuer` ใน document ตรงเป๊ะกับตัวที่มันถามไป แล้วดาวน์โหลด JWK Set (RFC 7517) จาก `jwks_uri` ในชุดนี้มีแค่ public key แต่ละตัวมี `kid` ส่วน private key ที่ใช้ sign อยู่กับ issuer ไม่ไปไหน

**ลำดับการตรวจ** RFC 7519 §7.2 ครอบคลุมการ parse และการ validate signature ส่วน RFC 8725 เพิ่มกฎ hardening และ RFC 9068 §4 list สิ่งที่ resource server ต้องตรวจใน access token ส่วนลำดับนั้น มาตรฐานเปิดไว้ในขั้นที่ไม่ได้พึ่งกัน แต่ library จะ verify signature ก่อนอ่าน claim เพราะจนกว่าจะถึงตอนนั้น payload ก็คือ input ที่ attacker คุมได้:

1. **Header** ปฏิเสธทุกอย่างที่ไม่ใช่สามส่วนที่รูปแบบถูกต้อง `alg` ต้องอยู่ใน allowlist ของ API เองสำหรับ issuer นี้ (เช่น มีแค่ `RS256`) ข้อนี้ตัด `none` ออกไป และกันไม่ให้ token เป็นคนเลือกตระกูลของ algorithm ส่วน token ตาม RFC 9068 ต้องมี `typ` เป็น `at+jwt` หรือ `application/at+jwt` โดยเทียบแบบไม่สนตัวพิมพ์เล็กใหญ่
2. **Key** หยิบ key ที่ `kid` ตรงกันจาก JWKS ที่ cache ไว้ของ issuer นี้ และหยิบจากที่นั่นที่เดียว
3. **Signature** verify จาก header กับ payload ที่ encode แล้ว ด้วย key นั้นและ algorithm นั้น
4. **`iss`** ต้องตรงกับ issuer ที่ตั้งค่าไว้เป๊ะทุกตัวอักษรแบบ string
5. **`aud`** ต้องมี identifier ที่ API นี้ยอมรับว่าเป็นของตัวเอง มันเป็น string ตัวเดียวหรือ array ก็ได้ ส่วน token ที่ไม่มี `aud` หรือมีแค่ audience อื่น จะถูกปฏิเสธ
6. **`exp`** ต้องยังมาไม่ถึง และ `nbf` ถ้ามีต้องผ่านไปแล้ว เผื่อ leeway ไว้นิดหน่อยสำหรับ clock skew
7. **Authorize** ตอนนี้ถึงจะใช้ `scope`, role หรือ claim อื่นตัดสินว่า request นี้ทำได้ไหม

ถ้า fail ขั้นไหนก็ได้ในขั้นที่ 1 ถึง 6 จะได้ **401** พร้อม `WWW-Authenticate: Bearer error="invalid_token"` ส่วน token ที่ valid แต่ไม่มี scope ที่ต้องใช้จะได้ **403** พร้อม `error="insufficient_scope"` และจะบอกชื่อ scope ที่ต้องใช้ด้วยก็ได้ (RFC 6750 §3.1) และ request ที่ไม่มี token เลยจะได้ challenge ธรรมดา `WWW-Authenticate: Bearer realm="…"` โดยไม่มี error code

**Rotation** issuer เปลี่ยน key ด้วยการเพิ่ม key ใหม่ลงใน JWK Set แล้ว sign ด้วยมันภายใต้ `kid` ใหม่ และยัง publish key ที่เพิ่งเลิกใช้ไว้อีกสักพัก (OpenID Connect Core §10.1.1): นานพอให้ครอบ token ที่ key พวกนั้น sign ไว้ ฝั่ง API ก็ cache ชุด key ไว้ และถ้ามี token มาพร้อม `kid` ที่ไม่รู้จัก มันจะดึงชุด key ใหม่ก่อนตัดสินใจ การดึงใหม่นี้ต้องมี rate limit ไม่อย่างนั้นใครก็สั่งให้ API ยิงถล่ม issuer ได้ แค่ส่ง token ที่มีค่า `kid` สุ่ม ๆ มา

## ใช้ตอนไหนดี

- API และ microservice ที่อยู่หลัง authorization server ของ OAuth 2.0 หรือ OpenID Connect ที่ออก JWT access token ส่วน [OAuth 2.0 Authorization Code + PKCE](../oauth2-authorization-code-pkce/) แสดงว่า client ได้ token มายังไง
- request rate สูงและเส้นทางที่ไวต่อ latency ที่การเรียก authorization server ทุก request แพงเกินไป
- หลาย API ใช้ issuer ตัวเดียวกัน: แต่ละตัว verify เองด้วย public key และไม่มีตัวไหนสร้าง token ได้
- ไม่เหมาะกับที่ที่การ revoke ต้องมีผลทันที ให้ใช้ introspection กับ call พวกนั้น (ดูหัวข้อ ได้อะไร เสียอะไร)
- ไม่ใช่ใน client ตัว RFC 9068 บอกว่า client ต้องไม่แกะดู access token: format ของมันเป็นเรื่องระหว่าง issuer กับ API และจะเปลี่ยนหรือกลายเป็น opaque เมื่อไรก็ได้
- ไม่ใช่กับ token ที่ไม่ใช่ของเรา อย่าง token ที่ issuer บางเจ้าออกให้ API ของตัวเองก็ไม่ได้มีไว้ให้คนอื่น validate เช่น token ของ Microsoft Graph ใช้ format เฉพาะของตัวเอง

## ได้อะไร เสียอะไร

- **การ revoke มีผลช้า** token ที่ validate ในเครื่องยังใช้ได้จนถึง `exp` ถึงผู้ใช้จะ sign out หรือ grant ถูก revoke ไปเมื่อนาทีก่อนก็ตาม คำตอบมาตรฐานคือ access token อายุสั้น (เป็นนาที ไม่ใช่เป็นวัน) ที่ต่ออายุด้วย refresh token ถ้าแค่นั้นไม่พอ ให้เรียก introspection endpoint สำหรับ operation ที่ sensitive หรือเก็บ denylist เล็ก ๆ ของค่า `jti` ที่ถูก revoke ไว้ และให้มันหมดอายุไปพร้อมกับ token
- **validate ในเครื่อง, introspection หรือ opaque token** การ validate ในเครื่องไม่ต้องเรียก network แต่มันรู้แค่สิ่งที่เป็นจริงตอนที่ token ถูกออก ส่วน introspection (RFC 7662) ถาม authorization server ว่า token ยัง `active` อยู่ไหม: ได้ข้อมูลล่าสุดเสมอ แลกกับ latency, load และ dependency เพิ่มอีกตัวในทุก request ตัว RFC อนุญาตให้ cache คำตอบได้ แต่นั่นก็พาช่วงที่ข้อมูล stale กลับมา ส่วน opaque token ไม่มี claim เลย ทำให้ไม่มีอะไรรั่ว และ revoke ได้ทันที แต่ทุก API ต้อง introspect
- **bearer token ใช้ได้กับใครก็ตามที่ถือมัน** token ที่ถูกขโมยจาก log, browser หรือ service ที่โดนเจาะ เอาไป replay ได้จนกว่าจะหมดอายุ sender-constrained token ผูก token ไว้กับ key ที่มีแค่ client ตัวจริงถือ: DPoP (RFC 9449) ส่ง proof ที่ sign แล้วไปกับทุก request และใส่ thumbprint ของ key ไว้ใน token (`cnf.jkt`) ส่วน mutual-TLS certificate-bound token (RFC 8705) มี thumbprint ของ client certificate (`cnf.x5t#S256`) แล้ว API ก็ตรวจ proof หรือ certificate คู่กับ token ด้วย และ RFC 9700 ก็แนะนำให้ทำ access token เป็นแบบ sender-constrained
- **sign แบบ asymmetric หรือ symmetric** ถ้าใช้ RS256, ES256 หรือ EdDSA ตัว API จะถือแค่ public key แต่ถ้าใช้ HS256 ทุก verifier จะถือ secret ตัวเดียวกับที่ใช้ sign ทำให้ API ไหนก็ได้ หรือใครก็ตามที่เจาะ API ตัวหนึ่งได้ ก็สร้าง token ให้ API ตัวอื่นทั้งหมดได้ เก็บ HMAC ไว้ใช้กรณีที่ issuer เป็น verifier ตัวเดียว
- **claim คือภาพ ณ ตอนนั้น** role, group และ permission ใน token เก่าเท่ากับตัว token และทุก claim วิ่งไปกับทุก request ใครเห็นก็อ่านได้

## ข้อควรรู้ตอนลงมือทำ

- **ใช้ library ที่ยังมีคนดูแล** และตั้งค่ามันให้ชัดเจนด้วย issuer, audience และ algorithm ที่อนุญาต อย่า parse และ verify token เอง ตัวอย่าง: jose (JavaScript), PyJWT หรือ joserfc (Python), Nimbus JOSE + JWT และ resource server support ของ Spring Security (Java), Microsoft.IdentityModel (.NET), golang-jwt หรือ lestrrat-go/jwx (Go) เช็กด้วยว่า default ข้ามอะไรไปบ้าง: อย่าง JWT filter ของ Envoy ก็ไม่ตรวจ audience ถ้าไม่ list audience ที่รับไว้ ส่วน token ที่ออกให้ audience อื่นก็ควรเป็น test case หนึ่งใน test suite ของเรา
- **การโจมตีแบบคลาสสิก และการตรวจที่กันแต่ละแบบ:**
  - *`alg: none`* attacker ตัด signature ทิ้งแล้วประกาศว่า token ไม่ได้ sign ตัว algorithm allowlist กันเรื่องนี้ได้ ใช้ allowlist ไม่ใช่ blocklist: library ที่ block แค่ string `none` แบบตรงตัว แต่อ่าน `alg` แบบไม่สนตัวพิมพ์เล็กใหญ่ เคยโดน bypass ด้วย `noNE` มาแล้ว
  - *Key confusion จาก RS256 เป็น HS256* attacker sign ด้วย HMAC โดยใช้ public key ของ issuer เป็น secret แล้ว library ที่ปล่อยให้ token เลือก algorithm ก็ verify ผ่าน (CVE-2015-9235) หนึ่ง key หนึ่ง algorithm: ห้ามรับ HMAC กับ key ที่ publish ไว้เป็น RSA หรือ EC
  - *Key ที่ token ระบุเอง* header `jku`, `x5u`, `jwk` และ `x5c` ชี้ไปที่ หรือใส่ key ที่ผู้ส่งเลือกเองไว้ (CVE-2018-0114 คือ `jwk` ที่ฝังมาแล้ว library ก็เชื่อ) และการตาม URL ใน `jku` หรือ `x5u` ก็เป็น server-side request forgery ด้วย ให้เอา key จาก JWKS ของ issuer ที่ตั้งค่าไว้เท่านั้น และมอง `kid` เป็น input ที่ไม่น่าไว้ใจ มีไว้แค่เลือก key ในชุดนั้น ไม่ใช่อย่างอื่น
  - *ไม่ตรวจ audience* token ที่ออกให้ API หนึ่งถูกเอาไป replay กับ API อื่นที่เชื่อ issuer เดียวกัน `aud` กันเรื่องนี้ได้
  - *Issuer สลับกัน* API ที่เชื่อหลาย issuer หรือหลาย tenant แล้วหา `kid` จาก key set ของทุกเจ้ารวมกัน จะรับ token ที่ `iss` บอกชื่อ issuer หนึ่ง แต่ signature มาจากอีกเจ้า ให้เลือก key set จาก issuer ที่ validate แล้ว ห้ามหาจากชุดที่รวมกัน
  - *ใช้ ID token เป็น access token* ทั้งสองตัวเป็น JWT จาก issuer เดียวกัน (ดู [OpenID Connect](../openid-connect/)) ค่า `typ: at+jwt` แยกสองตัวนี้ออกจากกันได้ถ้า issuer ใส่มาให้ ไม่อย่างนั้นก็ใช้ audience คู่กับ claim ที่ ID token ไม่มี เช่น `scope` เป็นตัวแยก เพราะ `aud` ของ ID token คือ ID ของ client
- **RFC 9068 เป็น profile ไม่ใช่สิ่งที่มีให้แน่ ๆ** issuer หลายเจ้ามีมาก่อน RFC นี้หรือไม่ได้ทำตาม อย่าง access token ของ Microsoft Entra ID ก็มี `typ: JWT` และใส่ scope ไว้ใน `scp` ส่วน Auth0 ออก token ใน format ของตัวเองเป็น default และออก token แบบ RFC 9068 เมื่อเราเลือก profile นั้นให้ API ตัวหนึ่ง ทางที่ถูกคืออ่านเอกสารของ issuer ที่ใช้ แล้ว validate ตามสิ่งที่มันออกจริง
- **JWKS caching** cache แยกราย issuer และหา key ด้วย `kid` ให้ refresh เบื้องหลัง เคารพ HTTP cache header ของ endpoint และยังใช้ cache ต่อไปตอนที่ issuer ติดต่อไม่ได้ชั่วคราว จำกัดการดึงใหม่ที่ `kid` แปลกหน้าจะกระตุ้นได้: `createRemoteJWKSet` ของ jose รอ 30 วินาทีระหว่างแต่ละครั้ง และถือว่าชุด key สดอยู่ 10 นาทีเป็น default ส่วนแนวทางของ Microsoft สำหรับ Entra ID คือเก็บ key ไว้ 24 ชั่วโมง refresh ทุกชั่วโมง และ refresh เมื่อเจอ `kid` แปลกหน้าได้ไม่เกินหนึ่งครั้งทุกห้านาที
- **ถ้าเราเป็นคนรัน issuer** ให้ publish key ใหม่ก่อนจะเริ่ม sign ด้วยมัน และเก็บ key เก่าไว้ publish อย่างน้อยนานเท่ากับอายุ token ที่ยาวที่สุดบวกกับ cache ของ verifier ที่นานที่สุด อย่าง Amazon API Gateway ก็ cache key ไว้ได้นานถึงสองชั่วโมง
- **Clock skew** ให้นาฬิกา sync กันไว้และเผื่อ leeway นิดหน่อย RFC 7519 บอกว่าไม่ควรเกินไม่กี่นาที ส่วน Spring Security ตั้ง default ไว้ 60 วินาที
- **validate ที่ไหน** ถ้าทำที่ [API gateway](../api-gateway/) ตัว token ที่เสียจะโดนตีกลับก่อนถึง service และ configuration ก็อยู่ที่เดียว gateway และ proxy ทำเรื่องนี้ได้ทันทีโดยไม่ต้องเขียนเพิ่ม เช่น JWT authorizer ของ Amazon API Gateway, policy `validate-jwt` ของ Azure API Management, JWT authentication filter ของ Envoy และ `RequestAuthentication` ของ Istio ถ้าทำในแต่ละ service ก็ไม่มีอะไรต้องพึ่งตำแหน่งบน network และแต่ละ service ก็ตรวจ audience กับ scope ของตัวเอง การทำทั้งสองที่เป็นเรื่องปกติ: gateway ตีกลับตัวที่เสียชัด ๆ และ service ก็ validate ซ้ำ เพราะมันถูกเรียกจากข้างในได้ด้วย ถ้ามีแค่ gateway ที่ validate แล้วส่ง identity ต่อมาใน header ตัว service ต้องเข้าถึงทางอื่นไม่ได้เลย
- **เรียก API ตัวถัดไป** token ที่ `aud` เป็น API นี้ไม่ควรถูก forward ไปที่ API อื่น: audience check ของ API ตัวนั้นจะปฏิเสธมัน และก็ควรปฏิเสธด้วย ให้แลกเป็น token ที่ออกให้ downstream API (OAuth 2.0 Token Exchange, RFC 8693) หรือเรียกด้วย token ของ service เองจาก client credentials grant
- **Algorithm** RS256 คือตัวที่ RFC 9068 บังคับให้ทุก implementation รองรับ และเป็น default ที่พบบ่อย signature ของ ES256 มีขนาดแค่หนึ่งในสี่ (64 byte เทียบกับ 256 สำหรับ RSA key ขนาด 2048 bit) และ cheat sheet ของ OWASP จัด ECDSA, RSASSA-PSS และ EdDSA เป็นตัวที่แนะนำ ส่วน RSASSA-PKCS1-v1_5 ของ RS256 เป็นตัวที่ไม่แนะนำ ไม่ว่า issuer จะใช้อะไร ตัว allowlist ก็ต้องตรงกับมัน
- **มาตรฐานยังขยับอยู่** RFC 8725 ยังเป็น JWT BCP ฉบับที่ publish อยู่ ตัวที่จะมาแทนคือ draft-ietf-oauth-rfc8725bis ที่ approve แล้วและกำลังรอในคิวของ RFC Editor (ตุลาคม 2026) มันคงกฎข้างบนไว้และเพิ่มอีกนิดหน่อย: ปฏิเสธทุกอย่างที่ไม่ใช่รูปแบบ compact จำกัดจำนวน iteration ของ PBES2 และขนาดของ JWE หลัง decompress และมอง `kid`, `jku` และ `x5u` เป็นค่าที่ attacker คุมได้
- **Error และ log** ส่ง challenge ตาม RFC 6750 เพื่อให้ client รู้ว่าควรขอ token ใหม่ (401) หรือขอตัวที่มี scope มากขึ้น (403) และห้าม log token ทั้งตัว: `jti`, `sub` และ `kid` ก็พอจะตามรอย request แล้ว
