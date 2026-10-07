## ปัญหา

Acme Shop อยากมีบัญชีลูกค้า ผู้ใช้ sign up ด้วยอีเมล sign in ด้วย password บวก factor ที่สอง หรือด้วยบัญชี Google ของตัวเอง reset password ที่ลืม และอยู่ในสถานะ sign in บน browser ของตัวเองได้เป็นสัปดาห์ ตัว orders API ต้องรู้ว่าใครเรียกมา โดยไม่ต้องถาม session store ทุก request และ feature รูปภาพควรให้ browser อัปโหลดตรงไปที่ S3 แทนที่จะ stream ทุก byte ผ่าน server

ถ้าทำเองทั้งหมด ก็ต้องเก็บ password hash และเลือกวิธี hash ให้ดี ส่งและตรวจ verification code ทำให้การเดา password ช้าลง รัน server ของ OAuth 2.0 และ OpenID Connect ที่มี signing key แบบ rotate ได้ และตามให้ทันความแปลกของ social provider แต่ละเจ้า แถมยังต้องตัดสินใจว่า browser ที่เก็บความลับไม่ได้ จะได้ AWS credential ที่เขียนได้แค่รูปของลูกค้าคนนั้นคนเดียวได้ยังไง

## ทำงานยังไง

Amazon Cognito คือ identity service ของ AWS สำหรับ user ของแอปเอง อย่างลูกค้าและ partner ส่วนคนและ workload ที่รัน AWS account เป็นเรื่องของ [AWS IAM](../aws-iam/) และ IAM Identity Center ไม่ใช่ของ Cognito ตัว Cognito มีสองส่วนที่ชื่อคล้ายกันแต่ทำงานต่างกัน

### User pool และ identity pool

| | User pool | Identity pool |
|---|---|---|
| คืออะไร | user directory บวก OAuth 2.0 authorization server และ OpenID Connect provider | ตัวกลางที่เปลี่ยนหลักฐานการ sign in ให้เป็น AWS credential แบบชั่วคราว |
| รับอะไร | password, passkey, one-time code หรือการ sign in ที่ Google, Apple, Facebook, Amazon, SAML 2.0 หรือ OIDC provider | ID token จาก user pool หรือ OIDC provider อื่น, SAML assertion, token ของ social provider หรือไม่มีอะไรเลยสำหรับ guest |
| ให้อะไร | JSON Web Token: ID token, access token และ refresh token | identity ID ที่คงที่ และ credential ของ IAM role ที่ AWS STS ออกให้ |
| ราคา | ต่อ monthly active user ตาม feature plan | ไม่คิดเงิน (AWS call ที่ใช้ credential เหล่านั้นคิดเงินตามปกติ) |
| ใน Acme Shop | `acme-customers` | `acme-shop` |

แต่ละตัวทำงานได้โดยไม่ต้องมีอีกตัว: แอปจำนวนมากต้องการแค่ user pool และ identity pool ก็ trust identity provider อื่นได้ ส่วน Amazon Cognito Sync (service เก่าของ identity pool สำหรับ sync ข้อมูลของอุปกรณ์) หยุดรับลูกค้าใหม่ไปตั้งแต่กรกฎาคม 2026 และ AWS แนะนำให้ใช้ AppSync และ [DynamoDB](../amazon-dynamodb/) แทน

### App client และ OAuth 2.0 flow

app client คือ setting ของ user pool สำหรับแอปหนึ่งตัว: sign-in method และ OAuth grant ที่มันใช้ได้, scope ที่มันขอได้, callback URL, อายุของ token และมี client secret หรือไม่

- **Public client และ confidential client** `shop-web` ที่เป็น single-page app คือ **public client** ที่ไม่มี secret เพราะอะไรก็ตามที่ส่งไปอยู่บน browser หรือโทรศัพท์ถูกอ่านได้ ส่วน **confidential client** รันบน server และยืนยันตัวตนที่ token endpoint ด้วย client secret (`client_secret_basic` หรือ `client_secret_post`) ตั้งแต่มกราคม 2026 เป็นต้นมา app client หนึ่งตัวถือ secret ได้สองตัวพร้อมกัน ทำให้ rotate secret ได้โดยไม่มี downtime
- **Authorization code with PKCE** คือ flow สำหรับคน แอปส่ง browser ไปที่ `/oauth2/authorize` พร้อม `code_challenge` (Cognito รองรับแค่ method `S256`) จากนั้น user ก็ sign in แล้ว browser กลับมาพร้อม code และแอปก็เอา code กับ `code_verifier` ของมันไปแลกที่ `/oauth2/token` เป็น ID token, access token และ refresh token ส่วนสำหรับ public client นั้น เอกสารของ Cognito แนะนำให้เปิดแค่ grant นี้ และใช้ PKCE เสมอ
- **Client credentials** คือ flow สำหรับเครื่อง: app client แบบ confidential ขอ access token ที่มี custom scope ที่นิยามไว้บน resource server ผ่าน token endpoint หรือตั้งแต่กรกฎาคม 2026 ผ่าน API `GetClientToken` ที่ไม่ต้องมี user pool domain ตัว flow นี้คิดเงินต่อ token request ไม่ใช่ต่อ user (US East, ตุลาคม 2026: $2.25 ต่อ 1,000 request สำหรับ 250,000 ตัวแรกในเดือน ลดลงเหลือ $1.125 ต่อ 1,000 เมื่อเกินห้าล้าน และไม่คิดค่า app client) ส่วน quota category ของมันคือ `ClientAuthentication` ที่รับได้ 150 request ต่อวินาทีและเพิ่มไม่ได้ ฝั่งที่เรียกเลยควร cache token แต่ละตัวไว้จนกว่าจะหมดอายุ
- **Implicit** คืน ID token และ access token มาตรง ๆ ใน redirect URL: ไม่มี refresh token ไม่มี PKCE และ token ก็โผล่อยู่ใน history ของ browser และกับอะไรก็ตามที่อ่าน URL ได้ ตัว RFC 9700 (OAuth 2.0 security best practice ฉบับปัจจุบันของ IETF) บอกว่าห้ามใช้ ให้ปิดไว้

แอปที่วาดหน้า sign-in เองจะข้าม browser redirect แล้วเรียก user pool API ผ่าน AWS SDK: `InitiateAuth` ด้วย `USER_AUTH` (choice-based sign-in ด้วย password, passkey หรือ one-time code), `USER_SRP_AUTH` (protocol Secure Remote Password ทำให้ password ไม่เคยวิ่งข้าม network), `USER_PASSWORD_AUTH` หรือ custom challenge flow ที่สร้างจาก Lambda trigger

### Managed login และ custom domain

user pool domain ให้บริการ OAuth 2.0 endpoint (`/oauth2/authorize`, `/oauth2/token`, `/oauth2/userInfo`, `/oauth2/revoke`, `/oauth2/idpresponse`) และหน้า sign-in ที่ host ไว้ให้ มันเป็นได้ทั้ง prefix domain อย่าง `acme.auth.us-east-1.amazoncognito.com` หรือ custom domain อย่าง `auth.shop.example` ตัว custom domain ต้องมี public certificate ใน AWS Certificate Manager ที่ US East (N. Virginia) เพราะ Cognito ให้บริการมันผ่าน CloudFront distribution และ parent domain ของมัน (`shop.example`) ต้อง resolve ได้ใน DNS ถ้ามี domain ทั้งสองแบบ ตัว OpenID Connect discovery document จะถูก publish บน custom domain เท่านั้น

หน้าเหล่านี้มีสองรุ่น:

- **Managed login** (พฤศจิกายน 2024, แผน Essentials และ Plus) รองรับ passkey, one-time code และหน้าหลายภาษา และมี visual branding editor สำหรับโลโก้, ภาพพื้นหลัง, สี, light mode และ dark mode และ layout ของ form
- **Classic hosted UI** เป็นทางเลือกเดียวบนแผน Lite และรับโลโก้กับ CSS property ชุดหนึ่งที่ตายตัว

ทั้งสองแบบไม่ให้เปลี่ยนข้อความบนหน้า โดย managed login ทำได้แค่สลับไปเป็นภาษาอื่นที่รองรับ ทั้งสองแบบไม่จัดการการแก้ profile เช่นอีเมลใหม่หรือการตั้งค่า MFA (ส่วนนี้แอปต้องสร้างเองบน user pool API) และ managed login ไม่รัน custom authentication challenge ส่วนหลัง sign in แล้ว ตัว session cookie ทำให้ browser เดิม sign in ซ้ำได้โดยไม่ต้องใส่ credential อีกเป็นเวลาหนึ่งชั่วโมง

### Federation

user pool ส่งต่อการ sign in ไปให้ Google, Facebook, Login with Amazon, Sign in with Apple, SAML 2.0 identity provider ตัวไหนก็ได้ หรือ OpenID Connect provider ตัวไหนก็ได้ แล้วค่อยออก token ของตัวเองตามปกติ Acme Shop register OAuth client กับ Google โดยให้ `https://auth.shop.example/oauth2/idpresponse` เป็น redirect URI และขอ scope `openid email profile` แล้ว attribute mapping ก็ copy อีเมลจาก Google ไปใส่ใน profile ที่ Cognito เก็บไว้ให้ federated user แต่ละคน ส่วนหน้า managed login จะแสดงปุ่ม Continue with Google และแอปข้ามหน้านี้ได้ด้วยการใส่ `identity_provider=Google` ใน authorize request

pre sign-up trigger ก็รันตอน federated user sign in ครั้งแรกด้วย และตั้งแต่มกราคม 2026 ก็มี inbound federation trigger ที่ปรับรูป attribute ของ provider ระหว่างทางเข้ามาได้ ตัว federated user ทำ MFA ที่ provider ของตัวเอง โดย Cognito ไม่เพิ่ม factor อะไรเข้าไป ส่วน user จาก social provider คิดราคาเหมือน user ของ pool เอง และ user จาก SAML 2.0 หรือ OIDC provider คิดอีกอัตราหนึ่ง

### MFA และ passkey

MFA ปิด เป็นแบบ optional หรือบังคับก็ได้ โดยมี factor ที่สองสามแบบ: TOTP code จาก authenticator app (Cognito รับ code ที่เหลื่อมได้ 30 วินาทีทั้งก่อนและหลัง เผื่อนาฬิกาคลาด), ข้อความ SMS และบน Essentials หรือ Plus ก็มีอีเมลด้วย ตัว SMS ส่งออกผ่าน [Amazon SNS](../amazon-sns/) ส่วนอีเมลผ่าน Amazon SES และแต่ละตัวคิดเงินแยก

**Passkey** (Essentials หรือ Plus) คือ WebAuthn credential ที่อยู่ในโทรศัพท์, laptop หรือ security key ส่วนใน Cognito นั้น passkey เป็น **first factor** ที่เสนอผ่าน choice-based sign-in และ managed login และไม่เคยเป็นขั้นที่สองหลัง password ใน pool ที่บังคับ MFA การ sign in ด้วย passkey จะนับเป็น MFA ก็ต่อเมื่อ authenticator verify ตัว user (ด้วย PIN หรือ biometric) และ WebAuthn setting `FactorConfiguration` ของ pool เป็น `MULTI_FACTOR_WITH_USER_VERIFICATION` นี่คือวิธีที่ Acme Shop ให้ลูกค้าเลือกระหว่าง TOTP code กับ passkey โดย user หนึ่งคน register passkey ได้ถึง 20 ตัว และทำได้หลัง sign in ครั้งแรกแล้วเท่านั้น ส่วน relying party ID มีค่า default เป็น custom domain (`auth.shop.example`) และถ้าเปลี่ยนทีหลังทุกคนต้อง register ใหม่ การ sign in ด้วย one-time code เป็น first factor ใช้ร่วมกับ MFA แบบบังคับไม่ได้

### Threat protection

บนแผน Plus ตัว threat protection (ชื่อเดิมคือ advanced security features) เทียบ password ที่ใช้ตอน sign in, sign up และตอนเปลี่ยน password กับ credential ที่รั่วออกไป ให้คะแนนความเสี่ยงของการ sign in แต่ละครั้งจาก signal อย่างอุปกรณ์หรือสถานที่ที่ไม่คุ้น (adaptive authentication) และเลือกได้ว่าจะยอมให้ผ่าน บังคับ MFA หรือ block ในแต่ละระดับความเสี่ยง มันเริ่มที่ audit mode ที่แค่ log และ publish metric โดย AWS แนะนำให้อยู่ตรงนั้นสองสัปดาห์ขึ้นไปก่อนเปิด full-function mode การเช็ก leaked password ต้องใช้ตัว password เอง เลยไม่ครอบคลุม SRP หรือ custom authentication และ threat protection ไม่มีผลกับ federated sign-in เลย

### Lambda trigger

trigger เรียก Lambda function ของเราที่จุดตายตัวในชีวิตของ user:

| Trigger | รันเมื่อ | ใน Acme Shop |
|---|---|---|
| Pre sign-up | ก่อนสร้าง user: sign-up แบบ self-service, การสร้างโดย admin, การ sign in ครั้งแรกของ federated user | ปฏิเสธ domain อีเมลแบบใช้แล้วทิ้ง |
| Post confirmation | หลัง user ยืนยันบัญชี | (อีเมลต้อนรับ, record ของลูกค้า) |
| Pre และ post authentication | ก่อนและหลัง sign in | (block user, log การ sign in) |
| Pre token generation | ก่อนออก token รวมถึงตอน refresh | เพิ่ม `tier: gold` |
| Migrate user | เมื่อ user ที่ไม่รู้จัก sign in ด้วย password หรือขอ reset | (ย้าย user จากระบบเก่า) |
| Custom message, custom sender | เมื่อ Cognito ส่ง code หรือ link | (template ของตัวเอง, provider อีเมลหรือ SMS เจ้าอื่น) |
| Define, create และ verify auth challenge | ใน custom authentication flow | — |
| Inbound federation | เมื่อ federated user sign in | — |

ยกเว้น custom sender trigger แล้ว Cognito เรียก function แบบ synchronous และรอได้มากสุด 5 วินาที (ค่านี้เปลี่ยนไม่ได้) และอาจ retry call ที่ timeout ด้วย ส่วน function ที่คืน error จะหยุดขั้นนั้นของ flow: managed login แสดงข้อความของ error ไว้เหนือ form sign in และ API คืนมันเป็น `PreSignUp failed with error …` ตัว pre token generation มี event version สามแบบ: `V1_0` เปลี่ยนได้แค่ ID token และใช้ได้ทุกแผน ส่วน `V2_0` เปลี่ยน claim และ scope ของ access token ได้ด้วย และ `V3_0` ทำแบบเดียวกันกับ token แบบ machine-to-machine โดยสองแบบหลังต้องใช้ Essentials หรือ Plus

### Token: อายุ, refresh และ revocation

Cognito sign JWT ของมันด้วย RS256 โดยใช้ key หนึ่งตัวสำหรับ ID token และอีกตัวสำหรับ access token และ publish public key ไว้ที่ `https://cognito-idp.us-east-1.amazonaws.com/<user pool ID>/.well-known/jwks.json` ส่วน `kid` ใน header ของ token บอกว่าใช้ key ตัวไหน

- **ID token** บอกว่า user เป็นใคร (`sub`, `email`, `cognito:username`, group และ custom claim อย่าง `tier`) และมีไว้ให้แอปใช้ ค่า `aud` ของมันคือ app client ID
- **access token** บอกว่าคนที่เรียกทำอะไรได้บ้าง: `scope` ของมัน (`openid email orders/read`), `cognito:groups` และ app client ใน `client_id` มันจะมี `aud` ก็ต่อเมื่อแอปขอ resource binding (RFC 8707 รองรับตั้งแต่ตุลาคม 2025)
- **refresh token** เป็น opaque สำหรับแอป คือแอปมองไม่เห็นข้างใน มันใช้แลก ID token และ access token ใหม่ที่ token endpoint (`grant_type=refresh_token`) หรือผ่าน API `GetTokensFromRefreshToken`

app client แต่ละตัวตั้งอายุของ token เอง ค่า default ของ ID token และ access token คือ 1 ชั่วโมง (ตั้งได้ตั้งแต่ 5 นาทีถึง 1 วัน) และ refresh token คือ 30 วัน (60 นาทีถึง 10 ปี) เพราะ cookie ของ managed login ทำให้ browser sign in ค้างอยู่หนึ่งชั่วโมงอยู่แล้ว AWS เลยไม่แนะนำให้ตั้ง ID token หรือ access token สั้นกว่าหนึ่งชั่วโมงเมื่อใช้ managed login ส่วน **Refresh token rotation** (Essentials หรือ Plus) คืน refresh token ตัวใหม่ทุกครั้งที่ refresh และทำให้ตัวเก่าใช้ไม่ได้ หลัง grace period ที่ตั้งได้ถึง 60 วินาทีถ้าตั้งไว้ และ token ตัวใหม่ก็ยังหมดอายุตอนเดียวกับที่ตัวแรกจะหมด

การ revoke ทำกับ refresh token: `RevokeToken` และ `/oauth2/revoke` ปิด refresh token หนึ่งตัว พร้อม access token และ ID token ที่ออกจากมัน ส่วน `GlobalSignOut` และ `AdminUserGlobalSignOut` ปิด token ทั้งหมดของ user หนึ่งคน หลังจากนั้น API ของ Cognito เองจะปฏิเสธ access token พวกนั้น แต่ตัว token เองยัง sign ถูกต้องและยังไม่หมดอายุ ทำให้ API ที่ verify token เองยังรับมันจนถึง `exp` ตัว revocation เปิดเป็นค่า default สำหรับ app client ใหม่ และมันเพิ่ม claim `jti` กับ `origin_jti` ลงใน token

### Group และ role mapping

user อยู่ใน group ได้ โดย group จะถูก list ไว้ใน `cognito:groups` ของ token ทั้งสองตัว และ API กับ AppSync ใช้ค่านี้ authorize ได้ นอกจากนี้ group ยังระบุ IAM role และ precedence ได้ด้วย แล้ว ID token จะ list role ไว้ใน `cognito:roles` และเมื่อมี group หนึ่งชนะ ก็ระบุ role นั้นไว้ใน `cognito:preferred_role` แล้ว identity pool ก็ใช้ค่านี้เลือก role ได้

### Identity pool

ใน **enhanced flow** แอปเรียก `GetId` พร้อม ID token ใน logins map ภายใต้ key `cognito-idp.us-east-1.amazonaws.com/<user pool ID>` แล้วได้ identity ID อย่าง `us-east-1:9f3c…` ที่เป็นค่าเดียวกันสำหรับ user คนนั้นในทุกอุปกรณ์ จากนั้นแอปเรียก `GetCredentialsForIdentity`: Cognito เรียก `AssumeRoleWithWebIdentity` เองแล้วคืน credential ที่มีอายุหนึ่งชั่วโมง ส่วนใน **basic flow** แอปเรียก `GetOpenIdToken` แล้วเรียก STS เอง ทำให้มันเลือก role และความยาวของ session ได้ แต่ basic flow ใช้ไม่ได้ใน pool ที่มี role mapping

identity pool เป็นคนเลือก role:

- **Default role** มี role หนึ่งตัวสำหรับ identity ที่ authenticate แล้ว (`photo-uploader`) และถ้าเปิด guest access ก็มีอีกตัวสำหรับ identity ที่ยังไม่ authenticate โดยที่ Acme Shop ปิด guest ไว้ ส่วน guest ใน enhanced flow จะได้ session policy แบบ scope-down ที่จำกัดให้ใช้ได้แค่ service ในรายการ
- **Rule และ token-based mapping** ตัว rule จับคู่ claim ใน token (เช่น `tier` เท่ากับ `gold`) กับ role ตามลำดับ และ token-based mapping เอา `cognito:preferred_role` มาจาก group ของ user pool ส่วนกรณีที่ไม่มีอะไร match จะมี setting ตัดสินว่าให้ใช้ default role หรือปฏิเสธ
- **Attribute สำหรับ access control** ตัว pool จะ copy claim ไปเป็น session tag ทำให้ policy ของ role ตัวเดียวเทียบ `aws:PrincipalTag/tier` กับ tag บน resource ได้ แล้ว trust policy ของ role ก็ต้องอนุญาต `sts:TagSession` ด้วย และ user ต้องแก้ attribute ที่กลายเป็น tag ไม่ได้: ให้เช็ก write permission ของทุก app client

trust policy ของแต่ละ role ระบุ federated principal `cognito-identity.amazonaws.com` และจำกัด `cognito-identity.amazonaws.com:aud` ไว้ที่ identity pool ID ของเรา และตั้งแต่สิงหาคม 2025 เป็นต้นมา IAM จะไม่ยอม save trust policy ใหม่หรือที่แก้แล้วสำหรับ principal นี้ ถ้าไม่มี condition นั้น ส่วนใน permissions policy ตัวแปร `${cognito-identity.amazonaws.com:sub}` คือ identity ID (ไม่ใช่ `sub` ของ user pool) และนี่คือวิธีที่ `photo-uploader` กันลูกค้าแต่ละคนไว้ใน `photos-prod/u/<identity ID>/` เพราะ browser เรียก S3 ตรง ๆ ตัว bucket เลยต้องมี CORS rule สำหรับ origin ของร้านด้วย

### Integration: API Gateway, ALB, AppSync และ Amplify

- **API Gateway REST API** มี authorizer แบบ `COGNITO_USER_POOLS` โดยบน method ที่ไม่มี OAuth scope มันจะถือว่า token เป็น ID token ส่วนบน method ที่มี scope มันต้องการ access token ที่มี scope ตัวใดตัวหนึ่งในนั้น ถ้าไม่มีก็ตอบ 401 ส่วน mapping template ส่ง claim ต่อไปให้ backend เป็น `$context.authorizer.claims` ได้
- **API Gateway HTTP API** ใช้ JWT authorizer โดยมี user pool เป็น issuer และ app client ID เป็น audience มันเช็ก `kid` และ signature กับ JWKS ของ issuer (cache key ไว้ได้นานถึงสองชั่วโมง) แล้วเช็ก `iss`, `aud` หรือ `client_id`, `exp`, `nbf`, `iat` และ scope ของ route ตามที่อธิบายไว้ใน [JWT validation](../jwt-validation/)
- **Application Load Balancer** มี listener action `authenticate-cognito`: load balancer ทำการ sign in ให้ เก็บ session ไว้ใน cookie และส่ง claim ของ user ไปให้ target ใน header `x-amzn-oidc-*` และในนั้นมัน sign ตัว `x-amzn-oidc-data`
- **AppSync** GraphQL API รับ token ของ user pool (`AMAZON_COGNITO_USER_POOLS`) และจำกัด field ให้บาง group ได้ด้วย `@aws_auth(cognito_groups: [...])`
- **Amplify** สร้าง Auth category ของมันบน Cognito user pool และ identity pool

### ราคาและ quota

ราคาใน US East (N. Virginia) ตุลาคม 2026:

| แผน | ราคาต่อ monthly active user (MAU) | ฟรีทุกเดือน | สิ่งที่เพิ่มมา |
|---|---|---|---|
| Lite | $0.0055 ตั้งแต่ 10,001 ถึง 100,000 MAU แล้วลดลงเป็นขั้นจนเหลือ $0.0025 เมื่อเกิน 10 ล้าน | 10,000 MAU | sign-up และ sign-in, federation แบบ social, SAML และ OIDC, MFA แบบ TOTP และ SMS, Lambda trigger, classic hosted UI |
| Essentials (ค่า default ของ pool ใหม่) | $0.015 | 10,000 MAU | managed login และ branding editor ของมัน, passkey และ one-time code, MFA ทางอีเมล, การปรับแต่ง access token, refresh token rotation, password history |
| Plus | $0.02 | ไม่มี | threat protection และ log ของกิจกรรมและความเสี่ยงของ user ที่ export ได้ |

user นับว่า active ในเดือนนั้นถ้ามี identity operation อะไรก็ได้: sign-up, sign-in, token refresh, เปลี่ยน password, admin lookup ส่วน user ที่ federate ผ่าน SAML 2.0 หรือ OIDC คิดคนละ $0.015 หลัง 50 คนแรก ไม่ว่าจะแผนไหน ตัว user pool ที่สร้างในหรือก่อนวันที่ 22 พฤศจิกายน 2024 ยังได้ free tier แบบเดิมคือ 50,000 MAU บน Lite ส่วน add-on ต้องจ่ายเพิ่ม: token แบบ machine-to-machine (ต่อ request ตามด้านบน), multi-Region replication ($0.0045 ต่อ MAU บน Essentials, $0.006 บน Plus) และ request rate ที่สูงขึ้น ($20 ต่อหนึ่ง request ต่อวินาทีที่เพิ่ม ถ้าใช้หนึ่งเดือนขึ้นไป, $45 ถ้าน้อยกว่านั้น และต้องได้รับอนุมัติ) ตัว identity pool ไม่มีค่าใช้จ่าย ส่วน SMS และอีเมลคิดเงินโดย SNS และ SES

quota ของ request rate (ณ ตุลาคม 2026 เช่นกัน) คิดแยกตาม category และทุก user pool ของ account ใน Region เดียวกันใช้ร่วมกัน:

| Category | ตัวอย่างสิ่งที่ครอบคลุม | Default (request ต่อวินาที) | ปรับได้ |
|---|---|---|---|
| `UserAuthentication` | `InitiateAuth`, `RespondToAuthChallenge`, token refresh, การ sign in ผ่าน managed login | 120 | ได้ |
| `UserCreation` | `SignUp`, `ConfirmSignUp`, `AdminCreateUser` | 50 | ได้ |
| `UserFederation` | การ sign in ผ่าน provider ภายนอก | 25 | ได้ |
| `UserAccountRecovery` | `ForgotPassword`, `ChangePassword` | 30 | ไม่ได้ |
| `UserRead` | `GetUser`, `AdminGetUser` | 120 | ได้ |
| `UserUpdate` | `AdminUpdateUserAttributes`, `GlobalSignOut` | 25 | ไม่ได้ |
| `UserToken` | `RevokeToken` | 120 | ได้ |
| `ClientAuthentication` | client credentials grant, `GetClientToken` | 150 | ไม่ได้ |

ทุกขั้นของการ sign in ผ่าน managed login ถูกนับ ทำให้การ sign in ที่มี MFA code นับเป็นสอง request นอกจาก category แล้ว user หนึ่งคนอ่านได้มากสุด 10 ครั้งและเขียนได้ 10 ครั้งต่อวินาที และ user pool domain หนึ่งตัวรับได้มากสุด 500 request ต่อวินาที (300 จาก IP address เดียว, 300 สำหรับ app client ตัวเดียว) ส่วน identity pool มี quota แยกตาม operation แทน เช่น 25 ต่อวินาทีสำหรับ `GetId` และ 200 สำหรับ `GetCredentialsForIdentity` ค่า default คือ account หนึ่งมี user pool ได้ 1,000 ตัวต่อ Region และ pool หนึ่งมี app client ได้ 1,000 ตัวและ user ได้ 40 ล้านคน ทั้งสามค่าขอเพิ่มได้

## อยู่ตรงไหนใน solution

- **Solution:** sign-in สำหรับ web และ mobile app ที่ลูกค้าใช้บน AWS, SaaS แบบ business-to-business ที่แต่ละบริษัทลูกค้า sign in ผ่าน SAML 2.0 หรือ OIDC provider ของตัวเอง, token แบบ machine-to-machine สำหรับ API ภายในและ API ของ partner และ browser หรือ mobile app ที่เรียก AWS service ตรง ๆ เช่นอัปโหลดไป S3 หรือ item ใน DynamoDB ที่ใช้ user เป็น key โดยผ่าน identity pool
- **Pattern ใน catalog นี้:** user pool คือ [OpenID Connect](../openid-connect/) provider และ OAuth 2.0 authorization server: มันรัน [authorization code flow with PKCE](../oauth2-authorization-code-pkce/) ให้แอป และ flow [client credentials](../oauth2-client-credentials/) ให้ service ส่วน refresh token rotation ที่เปิดได้ตามต้องการจะเลิกใช้ refresh token แต่ละตัวทันทีที่ถูกใช้ แบบใน [refresh token rotation](../refresh-token-rotation/) แต่เอกสารไม่ได้พูดถึง reuse detection ส่วนเมื่อตั้ง Google, Apple, SAML 2.0 หรือ OIDC provider ไว้ มันคือ broker ใน [federated identity](../federated-identity/) และคือ service provider ใน [SAML single sign-on](../saml-sso/) ส่วน API ที่ trust token ของมันก็ทำ [JWT validation](../jwt-validation/) และ API gateway ที่เช็ก token ให้ทุก service ก็คือ [gateway offloading](../gateway-offloading/) ส่วน identity pool คือ [token exchange](../token-exchange/): ID token เข้าไป แล้ว AWS credential ของ IAM role ก็ออกมา ถ้าจำกัด credential เหล่านั้นไว้ที่ prefix เดียวด้วย `${cognito-identity.amazonaws.com:sub}` มันก็ทำงานเหมือน [valet key](../valet-key/) ที่ไขได้แค่มุมของลูกค้าแต่ละคนใน bucket
- **ของที่อยู่ข้าง ๆ บ่อย ๆ:** [API Gateway](../api-gateway/), Application Load Balancer, AppSync และ Amplify อยู่ข้างหน้า, [AWS Lambda](../aws-lambda/) สำหรับ trigger, [AWS IAM](../aws-iam/) และ STS อยู่หลัง identity pool, [Amazon S3](../amazon-s3/) สำหรับอัปโหลดตรง (หน้า S3 แสดงทางเลือกแบบ presigned URL), Amazon SES และ SNS สำหรับอีเมลและ SMS, AWS WAF หน้า managed login, CloudTrail สำหรับ audit trail และ Amazon Verified Permissions สำหรับการตัดสิน authorization จาก token ของ Cognito
- **Managed offering:** Cognito เป็น AWS service แบบ managed และ Regional อยู่แล้ว ของที่ใกล้เคียงที่สุดคือ Microsoft Entra External ID (Azure AD B2C หยุดขายให้ลูกค้าใหม่ตั้งแต่ 1 พฤษภาคม 2025) และ Auth0 ในรูป service และ [Keycloak](../keycloak/) ที่เป็นตัวเลือกยอดนิยมแบบ self-hosted

## ใช้ตอนไหนดี

เลือก Cognito เมื่อแอปรันบน AWS, user เป็นลูกค้าหรือ partner และ flow มาตรฐานครอบคลุมสิ่งที่ต้องการ: sign-in ที่คิดราคาต่อ active user, ไม่มีอะไรต้องดูแล และมี integration ในตัวกับ API Gateway, AppSync, load balancer และผ่าน identity pool ก็ต่อกับส่วนอื่นของ AWS ได้ ให้มองหาตัวอื่นเมื่อต้องคุมข้อความบนหน้า sign-in และทุกขั้นของ flow เอง ต้องการ identity system เดียวข้ามหลาย cloud หรืออยากเก็บทางเลือกที่จะเอา password hash ติดตัวไปทีหลัง

ณ ตุลาคม 2026:

| | Amazon Cognito | Keycloak | Auth0 (Okta) | Microsoft Entra External ID |
|---|---|---|---|---|
| รันแบบ | AWS service, หนึ่ง Region ต่อ user pool | server ของเราเอง: open source (Apache 2.0), 26.8.0 ออกเมื่อ 1 ตุลาคม 2026 | SaaS | SaaS |
| ราคา | ต่อ monthly active user ตามแผน, Essentials $0.015 หลังฟรี 10,000 (US East) | ไม่มีค่า licence แต่จ่ายค่า server, database และการดูแล | Free plan ได้ถึง 25,000 MAU, แผนเสียเงินคิดตาม MAU | 50,000 MAU แรกฟรีบน Basic tier จากนั้นคิดต่อ MAU บวก add-on อย่าง SMS และ M2M |
| หน้า sign-in | managed login: branding editor แต่แก้ข้อความไม่ได้ หรือทำ UI เองบน API | theme: FreeMarker template, CSS และ message bundle ปรับได้ไกลเท่าที่อยากไป | Universal Login พร้อม Liquid page template เมื่อมี custom domain | company branding: พื้นหลัง, โลโก้, layout, header, footer และข้อความ custom |
| Logic เฉพาะ | Lambda trigger | Java service provider interface (SPI) และ authentication flow ที่ตั้งค่าได้ | Actions: Node.js function ที่รันตาม trigger | custom authentication extension ที่เรียก REST API ของเรา |
| Integration กับ AWS | ในตัว: API Gateway, ALB, AppSync, Amplify, identity pool | OIDC และ SAML มาตรฐาน | OIDC และ SAML มาตรฐาน | OIDC และ SAML มาตรฐาน |

OIDC provider ตัวไหนในตารางนี้ก็ป้อนให้ identity pool หรือ IAM OIDC provider ได้ เมื่อ user ของมันต้องใช้ AWS credential

## ได้อะไร เสียอะไร

- **คิดราคาต่อ active user** ตัว free tier ทำให้แอปเล็ก ๆ ถูก และค่าใช้จ่ายโตตามจำนวน user ไม่ใช่ตามจำนวน server ส่วนใน US East ถ้ามี monthly active user 200,000 คน จะตก (200,000 − 10,000) × $0.015 = $2,850 ต่อเดือนบน Essentials และ 200,000 × $0.02 = $4,000 บน Plus ยังไม่รวม SMS, อีเมล และ add-on
- **Quota เป็นตัวกำหนด design** เพดาน 120 sign-in request ต่อวินาทีที่ทุก user pool ใน account และ Region ใช้ร่วมกัน ก็พอสำหรับแอปส่วนใหญ่ แต่ไม่พอสำหรับ sale ที่เริ่มตอน 9:00 ตรง: ต้องวางแผนรับ peak คอยดู `CallCount` และ `ThrottleCount` ราย category ใน CloudWatch และซื้อหรือขอ capacity ไว้ล่วงหน้า ส่วน `UserUpdate` (25 ต่อวินาที) และ `UserAccountRecovery` (30) เพิ่มไม่ได้ เลยควรเอา admin call ออกจาก path ที่ยุ่ง
- **หน้าที่แต่งได้ แต่เขียนใหม่ไม่ได้** managed login เปลี่ยนหน้าตาได้ แต่เปลี่ยนข้อความหรือ flow ไม่ได้ อะไรที่เกินกว่านั้นแปลว่าต้องทำ UI เองบน user pool API พร้อมงาน security ที่มาด้วยกัน
- **ย้ายเข้าง่ายกว่าย้ายออก** ขาเข้า: migrate user trigger ย้าย user ทีละคนตอนที่เขา sign in ด้วย password เดิม และ CSV import ตอนนี้ก็พา password hash มาด้วยได้ (bcrypt, scrypt, Argon2id หรือ PBKDF2-SHA256 โดยใช้ได้ตั้งแต่กรกฎาคม 2026 บน user pool ที่รันบน infrastructure รุ่นใหม่ของ Cognito) แล้ว Cognito ก็แปลงมันตอน user แต่ละคน sign in ครั้งแรก ขาออก: ไม่มี API ไหนคืน password hash ทำให้ถ้าจะย้ายทีหลัง ก็ต้องให้ทุกคน reset password หรือทำ migration ในระบบใหม่ที่เช็ก password กับ Cognito ตอน user sign in
- **Setting ที่ตายตัวตั้งแต่ตอนสร้าง** จะให้ user sign in ด้วยอีเมลหรือเบอร์โทรเป็น username, attribute ไหนเป็น required และ custom attribute ทุกตัวที่เพิ่มเข้าไป เปลี่ยนทีหลังไม่ได้ ตัดสินใจให้เสร็จก่อน launch
- **Regional และมี replica แบบจำกัด** user pool อยู่ใน Region เดียว ส่วน multi-Region replication (พฤษภาคม 2026, Essentials และ Plus, เป็น add-on) เพิ่ม replica หนึ่งตัวใน Region ที่สอง ต้องใช้ multi-Region KMS key และ fail over managed login ผ่าน Route 53 health check ตัว replica sign in user และออก token ได้ แต่สร้าง user, reset password หรือแก้ profile ไม่ได้ ไม่รองรับ TOTP MFA และให้บริการ federated user ได้เฉพาะคนที่เคย sign in กับ primary มาก่อน สำหรับ Acme Shop ที่ลูกค้าใช้ TOTP เรื่องนี้สำคัญ
- **Revocation ไปได้ไม่เกินตอนที่ token หมดอายุ** การ revoke refresh token หรือ sign out user แบบ global ไม่ได้เรียก access token ที่ API verify เองกลับมา ให้ตั้งอายุให้สั้น และเช็ก action ที่อ่อนไหวต่อ revocation กับ Cognito

## ข้อควรรู้ตอนลงมือทำ

**Resource server และ app client** ตัว scope `orders/read` มาจาก resource server ส่วน `shop-web` เป็น public client (ไม่มี secret) ที่ใช้ authorization code grant, user ของ pool เองกับ Google และ choice-based sign-in สำหรับ passkey ได้ ส่วน `us-east-1_EXAMPLE` แทน ID ของ pool:

```sh
aws cognito-idp create-resource-server \
  --user-pool-id us-east-1_EXAMPLE \
  --identifier orders --name "Orders API" \
  --scopes '[{"ScopeName": "read", "ScopeDescription": "Read your own orders"}]'

aws cognito-idp create-user-pool-client \
  --user-pool-id us-east-1_EXAMPLE \
  --client-name shop-web --no-generate-secret \
  --allowed-o-auth-flows code --allowed-o-auth-flows-user-pool-client \
  --allowed-o-auth-scopes openid email orders/read \
  --supported-identity-providers COGNITO Google \
  --callback-urls https://shop.example/callback \
  --explicit-auth-flows ALLOW_USER_AUTH ALLOW_REFRESH_TOKEN_AUTH
```

**แลก code** หลัง redirect แล้ว shop-web ก็ post code และ verifier ไปที่ token endpoint ตัว public client ส่ง `client_id` ใน body และไม่ส่ง header `Authorization`:

```http
POST /oauth2/token HTTP/1.1
Host: auth.shop.example
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&client_id=<shop-web client ID>&code=<code>&code_verifier=<code_verifier>&redirect_uri=https://shop.example/callback
```

**trigger สองตัว** ในรูป Node.js function ส่วน domain ที่ใช้แล้วทิ้งในโค้ดเป็นแค่ตัวอย่าง และ `loyaltyTier` แทน lookup ของเราเอง ตัว pre token generation ต้องตั้งเป็น event version `V2_0` ถึงจะเปลี่ยน access token ได้:

```js
const DISPOSABLE = new Set(['tempinbox.example', 'throwaway.example']);

export const preSignUp = async (event) => {
  const domain = event.request.userAttributes.email.split('@').pop().toLowerCase();
  if (DISPOSABLE.has(domain)) throw new Error('Please sign up with a permanent email address.');
  return event;
};

export const preTokenGeneration = async (event) => {
  const tier = await loyaltyTier(event.request.userAttributes.sub); // 'gold' for Ana
  event.response = {
    claimsAndScopeOverrideDetails: {
      idTokenGeneration: { claimsToAddOrOverride: { tier } },
      accessTokenGeneration: { claimsToAddOrOverride: { tier } },
    },
  };
  return event;
};
```

**Role ที่อยู่หลัง identity pool** ตัว trust policy ยอมให้แค่ identity ที่ sign in แล้วของ identity pool นี้ assume `photo-uploader` ได้ (`us-east-1:<identity pool ID>` แทน ID ของ pool):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "cognito-identity.amazonaws.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "cognito-identity.amazonaws.com:aud": "us-east-1:<identity pool ID>" },
      "ForAnyValue:StringLike": { "cognito-identity.amazonaws.com:amr": "authenticated" }
    }
  }]
}
```

และ permissions policy ยอมให้ลูกค้าแต่ละคนเขียนได้แค่ใต้ identity ID ของตัวเอง:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "s3:PutObject",
    "Resource": "arn:aws:s3:::photos-prod/u/${cognito-identity.amazonaws.com:sub}/*"
  }]
}
```

ใน browser ตัว credential provider `fromCognitoIdentityPool` ของ AWS SDK for JavaScript รับ identity pool ID และ logins map จาก `cognito-idp.us-east-1.amazonaws.com/<user pool ID>` ไปยัง ID token ส่วน S3 client ที่ได้ provider นี้ไป จะ sign request ของมันด้วย credential ที่ provider ดึงมา

**นิสัยที่ช่วยให้ดูแลง่าย:**

- เลือก username attribute, required attribute และ custom attribute ก่อน launch เพราะเปลี่ยนทีหลังไม่ได้
- public client ให้เปิดแค่ authorization code grant กับ PKCE และปิด implicit ไว้
- verify token ด้วย library ที่มีคนดูแล (AWS แนะนำ `aws-jwt-verify` สำหรับ Node.js) และเช็ก `token_use`, `client_id` หรือ `aud` และ scope ไม่ใช่แค่ signature
- ตั้ง access token ให้อายุสั้น และเมื่อ session ที่ถูก revoke ต้องทำอะไรไม่ได้อีก ให้ถาม Cognito ไม่ใช่เชื่อ token
- บน Plus ให้รัน threat protection ใน audit mode ก่อน แล้วดู risk score ของมันก่อนบังคับใช้
- cache token แบบ machine-to-machine ไว้จนกว่าจะหมดอายุ: ทุก request เสียเงิน และนับรวมใน quota ที่เพิ่มไม่ได้
- load-test sign-in และ sign-up ก่อน launch และคอยดู `ThrottleCount` ราย category
