## ปัญหา

OAuth 2.0 ให้แอปเรียก API แทนผู้ใช้ได้ แต่ไม่เคยบอกแอปเลยว่าผู้ใช้คือใคร access token ส่งถึง API และการถือมันไว้ก็พิสูจน์ได้แค่ว่ามีใครสักคน authorize อะไรสักอย่าง แอปที่ "login ด้วย OAuth" โดยเรียก profile API ของ provider สุดท้ายก็ต้องมี integration คนละแบบกับทุก provider แล้ว attacker ก็ sign in เข้าแอปพวกนี้เป็นคนอื่นได้ ด้วยการเอา access token ของคนนั้นจากแอปอื่นมา replay (RFC 6819 เรียกว่า *token substitution*) ขณะเดียวกัน ผู้ใช้ที่มีแอปเป็นสิบตัวก็อยาก sign in ครั้งเดียว และทุกแอปก็ต้องมีวิธีมาตรฐานที่จะรู้ว่าใคร sign in เข้ามา เมื่อไร และยังไง

## ทำงานยังไง

OAuth 2.0 ตอบว่า *แอปนี้เรียกอะไรได้บ้าง* ส่วน OpenID Connect เพิ่มคำถามว่า *ใครเพิ่ง sign in เข้าแอปนี้* มันเป็น identity layer บาง ๆ ที่วางอยู่บน OAuth 2.0: authorization code flow ยังทำงานเหมือนเดิม (รายละเอียดของ protocol ดูที่ [OAuth 2.0 Authorization Code + PKCE](../oauth2-authorization-code-pkce/)) แค่มีของเพิ่มมานิดหน่อย:

- **scope `openid`** เปลี่ยน authorization request ให้เป็น *authentication* request ส่วน scope `profile`, `email`, `address` และ `phone` ขอ claim ชุดมาตรฐานเกี่ยวกับผู้ใช้
- **ID token** คือ JWT ที่ OpenID Provider (OP) sign มา และส่งถึง client ที่ OIDC เรียกว่า relying party (RP) มันบอกว่าใครเป็นคนออก (`iss`) ใคร sign in (`sub`) ออกให้ client ไหน (`aud`) ออกเมื่อไรและหมดอายุเมื่อไร (`iat`, `exp`) และส่ง `nonce` ที่ client ส่งไปกลับมาด้วย ส่วน claim ที่ไม่บังคับใส่จะบอกว่าผู้ใช้ authenticate เมื่อไรและยังไง (`auth_time`, `acr`, `amr`)
- **UserInfo endpoint** คือ API บน provider ที่ป้องกันด้วย OAuth โดยมันคืน claim เกี่ยวกับผู้ใช้ให้ใครก็ตามที่ยื่น access token มา
- **Discovery** publish JSON document ไว้ที่ `{issuer}/.well-known/openid-configuration` ตัว document นี้ list endpoint ของ provider, feature ที่รองรับ และ `jwks_uri` ที่ provider เปิด public signing key ไว้เป็น JWK Set (JWKS)
- spec เรื่อง **Session และ logout** ครอบคลุมสิ่งที่เกิดขึ้นหลัง sign in (ดูข้างล่าง)

**การ validate ID token** OpenID Connect Core §3.1.3.7 list การตรวจไว้ library ของเราทำให้อยู่แล้ว แต่เราก็ควรรู้ว่ามันตรวจอะไรบ้าง:

1. **Signature:** verify ด้วย key ของ provider ที่ `kid` ตรงกันใน JWKS และรับเฉพาะ algorithm ที่เราคาดไว้ (RS256 ยกเว้นจะ register ตัวอื่นไว้ และปฏิเสธ `none` ดู RFC 8725) ใน code flow ตัว ID token มาจาก token endpoint ตรง ๆ ผ่าน TLS ตัว Core เลยอนุญาตให้พึ่ง TLS แทนได้ แต่ library มักจะ verify signature อยู่ดี และเราต้อง verify ทุกครั้งที่ ID token มาถึงเราทางอื่น
2. **`iss`** ต้องตรงเป๊ะกับ issuer จาก discovery document
3. **`aud`** ต้องมี `client_id` ของเรา ปฏิเสธ token ที่มี audience อื่นที่เราไม่ไว้ใจอยู่ด้วย
4. **`exp`** ต้องยังไม่ถึง โดยเผื่อ leeway เล็กน้อยสำหรับ clock skew (ไม่เกินไม่กี่นาที) ส่วน `iat` ใช้ปฏิเสธ token ที่ออกมานานเกินไปแล้ว
5. **`nonce`** ต้องตรงกับค่าที่เราส่งไปกับการ sign in ครั้งนี้ และรับได้ครั้งเดียว
6. ถ้าเราขอ `acr` กับ `auth_time` ไว้ ก็ตรวจสองตัวนี้ด้วย (เช่น หลังส่ง `max_age` ไป)

**`sub` คือ key ของผู้ใช้** `iss` คู่กับ `sub` เป็น identifier เดียวที่คงที่และไม่ซ้ำสำหรับผู้ใช้: `sub` จะไม่ถูกเอาไปให้คนอื่นภายใต้ issuer เดียวกัน (Core §5.7) อีเมล เบอร์โทร username และชื่อเปลี่ยนได้หรือถูกเอาไปใช้ซ้ำได้ และ Core บอกว่าห้ามใช้พวกนี้เป็น unique identifier ถ้าใช้ identifier แบบ *public* ทุกแอปจะได้ `sub` เดียวกัน ถ้าใช้แบบ *pairwise* แต่ละแอปจะได้ค่าของตัวเอง แอปเลยเชื่อมโยงผู้ใช้ข้ามกันไม่ได้ถ้าไม่ได้รับอนุญาต ตัวอย่างเช่น `sub` ของ Microsoft Entra ID เป็นแบบ pairwise ต่อ application และมี `oid` ไว้เป็น ID ระดับทั้ง tenant

**Single sign-on** พอแอป validate ID token แล้ว มันก็รัน session ของตัวเอง ตัว `exp` ของ ID token ไม่เกี่ยวอะไรกับว่าผู้ใช้จะ sign in ค้างไว้ได้นานแค่ไหน (Core §2) ส่วน provider ก็มี session ของตัวเองเก็บไว้ใน cookie บน domain ของมัน cookie ตัวนี้แหละที่ทำให้ SSO ทำงาน: authentication request ของแอปถัดไปจะแนบมันไปด้วย แล้ว provider ก็ตอบกลับด้วย code โดยไม่ต้องโชว์ฟอร์ม login ส่วนแอปก็บังคับให้ login ใหม่ได้ด้วย `prompt=login` หรือ `max_age` หรือเช็กว่ามี session อยู่ไหมโดยไม่มี UI เลยด้วย `prompt=none` ถ้าไม่มี session ตัวนี้จะคืน error (ปกติคือ `login_required`)

## ใช้ตอนไหนดี

- sign in ผู้ใช้เข้า web app, mobile app และ single-page app ผ่าน identity provider ส่วนกลางหรือภายนอก: directory ของพนักงาน, customer identity platform หรือ social login
- single sign-on ข้ามหลายแอป รวมถึง federation ที่ provider ของเราเป็นตัวกลางพา sign in ไปที่ identity provider ขององค์กร partner
- ทุกที่ที่ไม่อย่างนั้นเราต้องเก็บ password เอง
- สำหรับแอปใหม่ โดยเฉพาะ native app และ single-page app ตัว OIDC คือตัวเลือกปกติ ส่วน SAML 2.0 ยังพบบ่อยใน enterprise SaaS และ identity provider ส่วนใหญ่ก็รองรับทั้งสองแบบ
- ไม่เหมาะกับ machine-to-machine call ที่ไม่มีผู้ใช้ (ใช้ OAuth 2.0 client credentials) และไม่ได้มีไว้ authorize API call: นั่นเป็นงานของ access token

## ได้อะไร เสียอะไร

- **Logout คือส่วนที่ยาก** มี session หนึ่งตัวต่อแอปบวกอีกตัวที่ provider และการปิดตัวหนึ่งไม่ได้ปิดตัวอื่น (ดูข้อควรรู้ตอนลงมือทำ)
- **provider เป็น dependency ที่สำคัญมาก** ถ้ามันล่ม ก็ไม่มีใคร sign in ได้ แม้ session ของแอปที่มีอยู่แล้วจะยังใช้ได้ต่อ
- **claim คือภาพ ณ ตอนนั้น** ID token บรรยายผู้ใช้ตอนที่ sign in ถ้า role เปลี่ยนหรือ account ถูกปิด ก็จะเห็นผลแค่ตอน sign in ครั้งถัดไป ยกเว้นแอปจะเรียก UserInfo ใหม่ ตั้ง session ให้สั้นแล้ว re-authenticate แบบเงียบ ๆ หรือรับ back-channel logout
- **ความเป็นส่วนตัว กับ การเชื่อมโยงข้อมูล** ค่า `sub` แบบ public ทำให้แอปของเรา join ข้อมูลกันได้ ส่วนค่าแบบ pairwise ปกป้องผู้ใช้ แต่ต้องมี shared ID แยกต่างหากถ้าอยากเชื่อมโยงจริง ๆ
- **token ใน browser** single-page app ที่เก็บ token ไว้ใน JavaScript เปิดให้ XSS จุดไหนก็ได้เห็น token ส่วน backend-for-frontend เก็บ token ไว้บน server และให้ browser ถือแค่ session cookie

## ข้อควรรู้ตอนลงมือทำ

- **ใช้ library ที่ยังมีคนดูแล** แทนที่จะ parse token เอง (OpenID Foundation มี list ของ [certified implementations](https://openid.net/developers/certified-openid-connect-implementations/)) ตัวที่ใช้กันแพร่หลายมี openid-client (Node.js), MSAL, AppAuth (iOS และ Android), oidc-client-ts และ Spring Security ส่วน identity provider หลัก ๆ ทุกเจ้าเป็น OP: Microsoft Entra ID, Okta, Auth0, Google, Amazon Cognito, Keycloak, Ping Identity และอื่น ๆ
- **ใช้ flow ไหน:** authorization code flow คู่กับ PKCE สำหรับ client ทุกแบบ ตัว OAuth 2.0 Security BCP (RFC 9700) บอกว่า client ไม่ควรใช้ response type ที่คืน access token มาจาก authorization endpoint อย่าง `id_token token` แบบ implicit และควรใช้ `code` แทน (หรือ `code id_token` แบบ hybrid) สำหรับ single-page app ตัว RFC 10017 แนะนำอย่างหนักแน่นให้ใช้ backend-for-frontend กับแอปธุรกิจ แอปที่ sensitive และแอปที่จัดการข้อมูลส่วนบุคคล
- **`nonce`, `state` และ PKCE:** สร้าง `nonce` สุ่มใหม่ทุกครั้งที่ sign in แล้วผูกไว้กับ browser session โดย Core แนะนำให้เก็บค่าสุ่มไว้ใน HttpOnly cookie แล้วส่ง hash ของมันไปเป็น `nonce` ตัว RFC 9700 บังคับให้ public client ใช้ PKCE และแนะนำให้ confidential client ใช้ด้วย ส่วน confidential client จะใช้ `nonce` แทนก็ได้ แต่ต้องมีมาตรการเพิ่ม ส่ง `state` ไปด้วยเช่นกัน
- **Discovery และ key rotation:** ตั้งค่าแค่ issuer URL แล้วอ่านที่เหลือทั้งหมดจาก discovery ค่า `issuer` ใน document ต้องตรงเป๊ะกับ URL นั้น และกับ `iss` ในทุก ID token ให้ cache JWKS ไว้ (ตาม HTTP cache header ของมัน) และถ้ามี token มาพร้อม `kid` ที่ไม่รู้จัก ให้ดึง JWKS ใหม่ก่อนจะปฏิเสธ โดยมี rate limit กำกับ ส่วน provider จะ rotate key ด้วยการ publish key ใหม่ แล้ว sign ด้วยมันภายใต้ `kid` ใหม่ และเก็บ key ที่เพิ่งเลิกใช้ไว้อีกสักพัก (Core §10.1.1)
- **token สองตัว audience สองแบบ:** ID token มีไว้ให้ client ส่วน access token มีไว้ให้ API ห้ามส่ง ID token ไปเป็น bearer token และอย่าให้ client ไปพึ่งสิ่งที่อยู่ใน access token: format ของมันเป็นเรื่องระหว่าง provider กับ API ส่วน API ที่รับ JWT access token ควรตรวจ `aud` และตาม RFC 9068 ก็ตรวจ header `typ` (`at+jwt`) ด้วย แล้ว ID token ปกติจะไม่ผ่านทั้งสองข้อ
- **UserInfo:** เรียกด้วย access token เมื่อต้องการ claim ที่ไม่มีใน ID token หรือต้องการค่าที่ใหม่กว่า และตรวจว่า `sub` ของมันตรงกับของ ID token ใน code flow ตัว Core คืน claim `profile` และ `email` มาจาก UserInfo แต่ provider หลายเจ้าก็ก็อป claim พวกนี้ใส่ ID token ด้วย อย่างที่ Google ทำกับ `email` เมื่อเราขอ scope `email`
- **ทางเลือกในการ logout:**
  - *Local logout* ปิดแค่ session ของแอป ส่วน session ของ provider ยังอยู่ การกด *Sign in* ครั้งถัดไปเลยผ่านไปเงียบ ๆ
  - *RP-Initiated Logout* redirect browser ไปที่ `end_session_endpoint` ของ provider พร้อม `id_token_hint` และ `post_logout_redirect_uri` ที่ register ไว้ ทำให้ provider ปิด session ของตัวเองได้ด้วย ถ้าไม่มี hint ตัว provider ต้องถามผู้ใช้ให้ยืนยันก่อน
  - *Back-Channel Logout* ให้ provider POST **logout token** ที่ sign แล้วไปที่ `backchannel_logout_uri` ของแต่ละแอป: เป็น JWT ที่มี claim `events` และ `sid` หรือ `sub` ที่จะปิด และไม่มี `nonce` มันคุยกันแบบ server ถึง server และไม่ต้องใช้ browser แต่ทุกแอปต้องหาและปิด session จาก `sid` หรือ `sub` ได้
  - *Front-Channel Logout* ให้ provider โหลด `frontchannel_logout_uri` ของแต่ละแอปใน hidden iframe ส่วน browser ที่ block หรือ partition third-party cookie มักทำให้แอปมองไม่เห็น session ของตัวเองใน iframe (Safari block, Firefox partition เป็น default) และตัว spec เองก็เตือนเรื่องนี้ไว้
