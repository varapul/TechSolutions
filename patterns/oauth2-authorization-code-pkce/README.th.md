## ปัญหา

แอปต้องเรียก API แทนผู้ใช้ แอปต้องไม่แตะ password ของผู้ใช้เลย และ token ที่ได้มาก็ต้องไม่รั่วระหว่างทาง วิธีรุ่นเก่าแต่ละแบบมีรูรั่วของตัวเอง: resource owner password grant ส่ง credential ให้แอปถือ ส่วน implicit grant ส่ง access token กลับมาใน fragment ของ redirect URL ทำให้มันไปค้างอยู่ใน browser history และ script ไหนบนหน้าก็อ่านได้ authorization code grant แบบธรรมดาดีกว่า เพราะมีแค่ **code** อายุสั้นที่ใช้ได้ครั้งเดียววิ่งผ่าน browser ส่วน token กลับมาทาง request ตรง แต่ public client (single-page app, mobile app และ desktop app) เก็บ client secret ไม่ได้ ใครที่ดัก code ได้ก็เลยแลกมันได้เหมือนเป็นตัวแอปเอง: จะเป็นแอปไม่หวังดีที่ register custom URL scheme เดียวกัน header `Referer` หรือ log file ก็ได้

## ทำงานยังไง

PKCE (Proof Key for Code Exchange, RFC 7636 อ่านว่า "pixy") ผูก code ไว้กับ instance ของแอปที่เริ่ม flow:

1. **Authorization request (front channel)** แอปสร้าง `code_verifier` ตัวใหม่ที่ entropy สูง แล้วเก็บไว้กับตัวเอง มันส่งไปแค่ `code_challenge = BASE64URL(SHA-256(code_verifier))` กับ `code_challenge_method=S256` พร้อม `response_type=code`, `client_id`, `redirect_uri`, `scope` และ `state` ตามปกติ
2. **เข้าสู่ระบบและให้ consent** authorization server ยืนยันตัวตนผู้ใช้และขอ consent แล้ว redirect browser กลับมาที่แอปพร้อม `code` (ที่ผูกกับ challenge ที่เก็บไว้) และ `state` ตัวเดิม
3. **แลก code (back channel)** แอปส่ง code กับ `code_verifier` ไปที่ token endpoint ผ่าน HTTPS request ตรง ๆ แล้วฝั่ง server ก็ hash verifier มาเทียบกับ challenge ที่เก็บไว้ มีแค่ instance ที่สร้าง verifier เท่านั้นที่ผ่าน ทำให้ code ที่โดนดักไปไม่มีค่าอะไร
4. **ใช้ token** แอปส่ง access token ไปเป็น bearer token แล้ว API ก็ validate และตอบ request ส่วน refresh token ใช้ขอ access token ใหม่ทีหลังโดยไม่ต้องให้ผู้ใช้ทำอะไร

hash ทำงานได้ทางเดียว การเห็น challenge ในขั้นที่ 1 ไม่ได้เผย verifier และการเห็น code ในขั้นที่ 2 ก็ไม่พอจะเอาไปแลก

## ใช้ตอนไหนดี

- แอปพลิเคชันไหนก็ได้ที่ sign in ผู้ใช้และเรียก API แทนเขา: single-page app, native mobile app กับ desktop app และ server-side web app
- มันคือ default สำหรับงานใหม่ ตัว OAuth 2.0 Security Best Current Practice (RFC 9700) บังคับให้ public client ใช้ PKCE และแนะนำให้ confidential client ใช้ด้วย ส่วน draft ของ OAuth 2.1 ก็ใส่มันไว้ใน authorization code grant เลย
- ถ้าใช้คู่กับ OpenID Connect ตัว flow เดียวกันนี้ก็ sign in ผู้ใช้ไปด้วย: เพิ่ม `openid` ใน scope แล้ว token response ก็จะมี ID token มาด้วย
- ไม่เหมาะกับ service-to-service call ที่ไม่มีผู้ใช้ (ใช้ client credentials) หรืออุปกรณ์ที่ไม่มี browser ให้ใช้ได้จริง เช่น TV และ CLI (ใช้ device authorization grant)

## ได้อะไร เสียอะไร

- **ชิ้นส่วนเยอะกว่า implicit flow** มี redirect สองรอบ, token request, การเก็บ token และการ refresh ทางที่ดีคือใช้ SDK ของ identity provider หรือ library ที่ certified แล้ว แทนที่จะเขียนเอง
- **PKCE ป้องกัน code ไม่ได้ป้องกัน token** bearer token ใช้ได้กับใครก็ตามที่ถือมันอยู่ ให้ access token อายุสั้นและ scope แคบ และพิจารณาใช้ sender-constrained token (DPoP, RFC 9449 หรือ mutual TLS, RFC 8705) กับ API ที่มีมูลค่าสูง
- **browser เป็นที่ที่เก็บ token ยากที่สุด** XSS จุดไหนก็ได้ใน single-page app ทำตัวเป็นแอปและใช้ token ของมันได้ แนวทางของ IETF สำหรับ browser-based app เลยเลือก backend-for-frontend ที่รัน flow นี้เป็น confidential client และให้ browser ถือแค่ HttpOnly session cookie
- **refresh token เป็นความลับอายุยาว** สำหรับ public client ตัว RFC 9700 บังคับให้ refresh token เป็นแบบ sender-constrained หรือ rotate ทุกครั้งที่ใช้
- **JWT แบบ self-contained revoke ทันทีไม่ได้** API เชื่อ JWT จนกว่ามันจะหมดอายุ ถ้าอยากตัดสิทธิ์เร็วกว่านั้น ให้ตั้งอายุสั้น ๆ หรือใช้ token introspection (RFC 7662)

## ข้อควรรู้ตอนลงมือทำ

- **Verifier:** 32 byte จาก random generator ที่ปลอดภัยทาง cryptography แล้ว encode เป็น base64url แบบไม่มี padding (43 ตัวอักษร) ใช้ตัวใหม่ทุก authorization request เก็บไว้คู่กับ `state` และลบทั้งคู่ทิ้งหลังแลกเสร็จ ใช้ `S256` เสมอ: method `plain` ส่งตัว verifier ไปตรง ๆ และมีไว้แค่สำหรับ client ที่คำนวณ SHA-256 ไม่ได้
- **`state` และ `nonce`:** ส่ง `state` ที่เดาไม่ได้ไป แล้วตรวจมันตอน callback ตัว PKCE (เมื่อ server บังคับใช้) และ `nonce` ของ OpenID Connect ก็กัน CSRF ได้เหมือนกัน แต่ `state` ต้นทุนต่ำและพา context ของแอปข้าม redirect ไปได้ด้วย
- **Redirect URI:** register ให้ตรงเป๊ะ server ต้องเทียบแบบ exact string match ยกเว้นว่าต้องยอมรับ port ไหนก็ได้บน loopback redirect URI ของ native app (RFC 9700, RFC 8252 §7.3) ส่วน native app เปิด system browser และไม่ใช้ embedded web view เด็ดขาด แล้วรับ redirect ผ่าน HTTPS link ที่ claim ไว้, private-use URI scheme หรือ loopback address (RFC 8252)
- **Confidential client** (web backend) ต้อง authenticate ที่ token endpoint ด้วย โดยควรใช้ `private_key_jwt` หรือ mutual TLS แทน shared secret แล้วก็ยังใช้ PKCE ซ้อนไปอีกชั้น
- **Authorization server:** ให้ code ใช้ได้ครั้งเดียวและอายุสั้น (RFC 6749 แนะนำไม่เกิน 10 นาที) ผูกมันไว้กับ `client_id`, `redirect_uri` และ challenge และปฏิเสธ token request ที่มี `code_verifier` มาทั้งที่ authorization request ไม่มี challenge (PKCE downgrade)
- **API:** validate JWT access token ในเครื่อง (RFC 9068): ตรวจ signature ด้วย key จาก JWKS ของ issuer (cache ไว้ และดึงใหม่เมื่อเจอ `kid` ที่ไม่รู้จัก) แล้วตรวจ `iss`, `aud`, `exp` และ scope ที่ต้องใช้ ส่วน opaque token ให้ส่งไปที่ introspection endpoint แทน
- **ผลิตภัณฑ์:** identity provider หลัก ๆ ทุกเจ้ารองรับ flow นี้ เช่น Microsoft Entra ID, Amazon Cognito, Google Identity, Okta, Auth0, Keycloak และ Ping Identity ส่วน client library ก็มี MSAL, AppAuth (iOS และ Android), oidc-client-ts, openid-client (Node.js) และ Spring Security
