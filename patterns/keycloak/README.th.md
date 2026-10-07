## ปัญหา

Acme Shop มีผู้ใช้สองแบบและแอปสามตัว ลูกค้าสมัครที่ shop.example ส่วนพนักงานมี account อยู่ใน Active Directory ของบริษัทแล้ว ถ้าไม่มี identity provider ที่ใช้ร่วมกัน ตัว shop-web และ back-office ก็จะต่างคนต่างเก็บ password และทำ MFA, session และการ reset password ของตัวเอง แล้ว orders-api ก็ต้องเชื่อตามที่แต่ละแอปบอกว่าใครเป็นคนเรียก แอปใหม่ทุกตัวก็ต้องทำงานนี้ซ้ำ และ account ของพนักงานที่ควรปิดไปแล้ว ก็ยังเปิดอยู่ในแอปไหนก็ตามที่มีคนลืม

identity provider ดึงงานนี้ออกจากแอป แอปส่งคนไปที่ sign-in service ตัวเดียว ตัวนี้ยืนยันตัวตนคนแล้วคืน token ที่เซ็นแล้วกลับมา แล้ว API ก็เช็ก signature ส่วน Keycloak เป็น identity and access management server แบบ open source ภายใต้ Apache License 2.0 ที่พูด OpenID Connect, OAuth 2.0 และ SAML 2.0 ได้ และ Acme ก็รันมันเอง มันเข้าร่วม CNCF ในระดับ incubating เมื่อเมษายน 2023 และ Red Hat ก็ขาย distribution ที่มี support ชื่อ Red Hat build of Keycloak ส่วนเวอร์ชันและค่า default ในหน้านี้เป็นของ Keycloak 26.8.0 (1 ตุลาคม 2026)

## ทำงานยังไง

**Realm** realm คือพื้นที่แยกที่มี user, credential, role, group, client, sign-in flow, signing key และ setting เป็นของตัวเอง และมี issuer ของตัวเอง สำหรับ realm `acme` issuer คือ `https://id.shop.example/realms/acme` และ OpenID Connect endpoint ของมันอยู่ข้างใต้นั้นใน `/protocol/openid-connect/`: `auth`, `token`, `certs`, `userinfo`, `logout`, `token/introspect`, `revoke` และ `auth/device` ตัว discovery document ที่ `/.well-known/openid-configuration` มีรายการ endpoint ทั้งหมด ส่วนหน้านี้เรียกสั้น ๆ ว่า `/auth`, `/token` และ `/certs` ตัว realm `master` ที่มีมาในตัวมีไว้ดูแล Keycloak เอง ส่วนแอปต่าง ๆ จะได้ realm ของตัวเอง

**Client** แต่ละแอปเป็น client ของ realm และใช้ OpenID Connect หรือ SAML ตัว client ที่ปิด *Client authentication* ไว้คือ **public**: มันเก็บ secret ไม่ได้ แบบใน single-page app หรือ mobile app มันเลยพึ่ง redirect URI ที่ตรงเป๊ะ และ PKCE ตัว shop-web เป็นแบบนี้ โดยตั้ง *PKCE method* เป็น `S256` ถ้าเปิด *Client authentication* ตัว client จะเป็น **confidential** และพิสูจน์ตัวเองที่ token endpoint ด้วย secret, JWT ที่เซ็นแล้ว หรือ client certificate โดยที่ back-office ใช้ secret สวิตช์บน client แต่ละตัวกำหนดว่ามันใช้ grant ไหนได้บ้าง: *Standard flow* (authorization code), *Direct access grants* (password grant ที่ [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700) บอกว่าห้ามใช้), *Service account roles* (client credentials), *Standard Token Exchange*, *OAuth 2.0 Device Authorization Grant* และ *OIDC CIBA Grant* ส่วน resource server อย่าง orders-api ก็เป็น client ด้วย ปกติจะปิดทุก flow ไว้ เพราะมันแค่รับ token

**User, role และ claim ใน token** user อยู่ใน database ของ realm หรือใน directory ที่ federate ไว้ (ดู *User federation* ข้างล่าง) role มีทั้ง realm role เช่น `customer` และ client role ที่เป็นของ client ตัวเดียว ส่วน group ถือ role mapping ที่สมาชิกจะได้สืบทอดไป อะไรที่จะลงไปใน token เป็นเรื่องของ configuration ไม่ใช่โค้ด: **client scope** (`profile`, `email`, `roles`, `offline_access` และที่คุณสร้างเอง) รวม **protocol mapper** ไว้เป็นชุด แล้ว mapper แต่ละตัวก็เขียน claim หนึ่งตัว โดย default realm role จะลงที่ `realm_access.roles` และ client role ลงที่ `resource_access.<client>.roles` และ token จะมีแค่ role ที่ user มี *และ* scope ของ client อนุญาต ตัว mapper แบบ *Audience* ใส่ `orders-api` ลงใน `aud` ทำให้ API ปฏิเสธ token ที่ตั้งใจออกให้คนอื่นได้

**Authentication flow** การ sign in คือ flow ของขั้นตอนต่าง ๆ ที่คุณจัดเรียงใหม่ได้ ตัว flow *browser* ที่มีมาในตัวจะลอง **Cookie** ก่อน และถ้ามี SSO session อยู่แล้ว flow ก็จบตรงนั้น ถัดไปคือ *Kerberos* (ปิดอยู่โดย default) และ *Identity Provider Redirector* ที่กระโดดไปหา provider ที่เป็น default หรือที่มี hint มาเลย แล้วค่อยเป็นฟอร์ม: *Username Password Form* ตามด้วย sub-flow *Browser - Conditional 2FA* ที่จะขอ one-time code ก็ต่อเมื่อ user ตั้งค่ามันไว้แล้ว OTP policy แบบ default คือ TOTP 6 หลักทุก 30 วินาที ส่วน WebAuthn security key และ recovery code อยู่ใน sub-flow เดียวกันและปิดไว้โดย default **Passkey** รองรับตั้งแต่ 26.4 ถ้าเปิด *Enable Passkeys* (Realm settings แท็บ Login) ฟอร์ม username จะเสนอ passkey ผ่าน autofill ของ browser หรือปุ่ม *Sign in with Passkey* และขั้น 2FA จะถูกข้ามหลังใช้ passkey ส่วน flow ต่าง ๆ ก็ copy แล้วแก้ได้: condition, sub-flow, step-up ตาม authentication level, required action อย่าง `CONFIGURE_TOTP` และ `UPDATE_PASSWORD` และ custom authenticator ส่วน brute-force detection ปิดอยู่ใน realm ใหม่

**Session และ single sign-on** การ sign in ที่สำเร็จจะสร้าง user session หรือ SSO session ที่มี client session หนึ่งตัวต่อแอป แล้วตั้ง cookie `KEYCLOAK_IDENTITY` ไว้บน host ของ Keycloak แอปถัดไปที่ส่ง browser มาที่นั่นจะได้คำตอบจาก session นั้นโดยไม่ต้องกรอกฟอร์ม *SSO Session Idle* (default 30 นาที) จบ session ที่ไม่มีใครใช้ *SSO Session Max* (10 ชั่วโมง) จบมันไม่ว่ายังไงก็ตาม และ *Client Session Idle* กับ *Client Session Max* ทำให้ทั้งสองค่าสั้นลงสำหรับ client ตัวเดียวได้ ตั้งแต่ 26.0 user session ถูกเก็บใน database โดย default และ cache ไว้ใน memory ทำให้มันรอดจากการ restart และ upgrade การ sign out ที่ logout endpoint ของ realm จะจบ SSO session แล้ว Keycloak ก็บอก client ตัวอื่นด้วย logout แบบ **front-channel** (browser เรียก logout URL ของแต่ละ client) หรือแบบ **back-channel** (Keycloak post logout token ไปที่ back end ของ client) ส่วน offline token (`scope=offline_access`) อยู่ได้นานกว่า session เพื่องานเบื้องหลัง และหมดอายุหลังไม่ได้ใช้ 30 วัน

**Token และ key** access token เป็น JWT ที่เซ็นด้วย active key ของ realm เป็น RS256 ถ้าไม่ได้เปลี่ยน *Default Signature Algorithm* ส่วนอายุของมันคือ 5 นาที (*Access Token Lifespan*) refresh token หมดอายุตอนที่ client session ของมันจะ idle (default คือ 30 นาทีหลังจากออก) และไม่มีวันช้ากว่า *SSO Session Max* การ refresh แต่ละครั้งได้ตัวใหม่กลับมา *Revoke Refresh Token* ปิดอยู่โดย default ทำให้ refresh token ตัวเก่ายังใช้ได้จนหมดอายุ ถ้าเปิดมัน refresh token ทุกตัวจะใช้ได้ครั้งเดียว แบบใน [Refresh Token Rotation](../refresh-token-rotation/) ส่วน public key ของ realm ถูก publish เป็น JWKS ที่ `/certs` ตัว realm เซ็นด้วย active key pair หนึ่งคู่ และเก็บ passive key ที่ใช้แค่ verify ไว้ได้ ทำให้การ rotate คือการเพิ่ม key ใหม่ที่ priority สูงกว่า แล้วปล่อย key เก่าเป็น passive ไว้จนกว่า token ที่มันเซ็นจะหมดอายุ

**Grant และ protocol** (สถานะใน 26.8):

| What | Status | Notes |
|---|---|---|
| Authorization code with PKCE | supported | บังคับ `S256` ได้ราย client |
| Client credentials | supported | *Service account roles* บน confidential client |
| Device authorization grant ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)) | supported | เปิดราย client |
| Standard token exchange ([RFC 8693](https://www.rfc-editor.org/rfc/rfc8693)) | supported ตั้งแต่ 26.2 | แลก Keycloak token เป็น Keycloak token เท่านั้น และเฉพาะ confidential client |
| Legacy token exchange (V1) | preview, deprecated | token จากภายนอก และ impersonation |
| Token exchange delegation | preview | claim `act` และปิดอยู่โดย default |
| JWT authorization grant (RFC 7523) | supported ตั้งแต่ 26.6 | |
| DPoP, FAPI 2.0 | supported ตั้งแต่ 26.4 | sender-constrained token |
| SAML 2.0 | supported | Keycloak เป็น identity provider ให้แอป SAML |

SAML client ใช้ user, flow และ SSO session ร่วมกับ OpenID Connect client ทำให้แอป SAML รุ่นเก่ากับแอป OIDC ตัวใหม่ sign in แค่ครั้งเดียว

**User federation** LDAP หรือ Active Directory provider ทำให้ user ใน directory ใช้งานใน realm ได้ Keycloak ไม่เคย import password: directory เป็นคนเช็กเอง มัน import user เข้า database ของตัวเองได้ตอนที่ user โผล่มาครั้งแรก แล้วอัปเดตให้ทันสมัยด้วยการ sync เป็นระยะ ทั้งแบบเต็มหรือแบบเฉพาะ user ที่เปลี่ยน หรือถ้าปิด *Import Users* ไว้ มันก็อ่านจาก directory ทุกครั้ง *Edit mode* กำหนดว่าการเปลี่ยนแปลงไปที่ไหน: `READ_ONLY`, `WRITABLE` (เขียนกลับไปที่ LDAP) หรือ `UNSYNCED` (เก็บไว้ใน Keycloak) mapper ดึง attribute, group และ role เข้ามา และ mapper *MSAD User Account* ส่งสถานะ account ของ Active Directory ข้ามมาด้วย: `userAccountControl` ค่า 514 ที่แปลว่า account ถูก disable จะทำให้ user ใน Keycloak ถูก disable ตามไปด้วย ส่วน Kerberos (SPNEGO) ให้ single sign-on กับ desktop ที่ join domain แล้ว และ User Storage SPI ก็ต่อกับ user database อื่นได้ทุกแบบ

**Identity brokering** Keycloak เป็น client ของ identity provider ตัวอื่นได้ด้วย: OpenID Connect หรือ SAML 2.0 provider ตัวไหนก็ได้ หรือ social provider ที่มีมาในตัวอย่าง Google, GitHub, Facebook, Microsoft และ LinkedIn ตัว provider จะโผล่เป็นปุ่มบนหน้า login หรือเลือกตรง ๆ ด้วย `kc_idp_hint` หลัง sign in ครั้งแรก *first login flow* จะสร้าง local user หรือ link กับ user ที่มีอยู่ แล้ว mapper ก็ copy claim ลงไปที่ user นั้น แอปต่าง ๆ ไม่เคยคุยกับ Google: มันยังได้ token ของ Keycloak เหมือนเดิม

**Administration และ auditing** ทุกอย่างใน admin console มีอยู่ใน Admin REST API (`/admin/realms/{realm}/…`) และเครื่องมือ command-line `kcadm.sh` ด้วย ทำให้เขียน script จัดการ realm และ export หรือ import เป็น JSON ได้ SCIM API ที่รองรับตั้งแต่ 26.8 ให้ระบบ provisioning จัดการ user และ group ของ realm ได้ ส่วน fine-grained admin permission (version 2 รองรับตั้งแต่ 26.2) แบ่งบางส่วนของ realm ให้ help desk ดูแลได้ ตัว user event (`LOGIN`, `LOGIN_ERROR`, `CODE_TO_TOKEN`, `REFRESH_TOKEN` …) และ admin event ไม่ได้ถูกเก็บโดย default นอกจาก error ที่เขียนลง log จนกว่าคุณจะเปิด *Save events* พร้อมกำหนดวันหมดอายุ ส่วน event listener ส่งต่อ event ไปที่อื่นได้

**Theme และ extension** หน้า login, account console, admin console, email และหน้า welcome เป็น theme ทั้งหมด: FreeMarker template, message bundle, stylesheet และรูป เลือกได้ราย realm ตัว theme login แบบ default เป็น `keycloak.v2` ตั้งแต่ 26.0 และ custom theme ก็ extend จาก theme ที่มีมาในตัว ส่วน extension อย่าง authenticator, user store, event listener และ protocol mapper เป็น Java provider (SPI) ที่วางไว้ใน `providers/` แล้ว build เข้า server ด้วย `kc.sh build`

**การรัน** Keycloak เป็นแอป Quarkus ตั้งแต่เวอร์ชัน 17 และ distribution เก่าที่ใช้ WildFly ถูกเอาออกไปในเวอร์ชัน 20 คำสั่ง `kc.sh start-dev` รัน development server ด้วย database `dev-file` และ local cache เท่านั้น ส่วน `kc.sh start` คือ production mode ที่ต้องมี hostname, TLS (หรือ proxy ที่ terminate TLS ให้) และ database จริง: [PostgreSQL](../postgresql/), MySQL, MariaDB, Microsoft SQL Server หรือ Oracle รวมถึง [Amazon Aurora](../amazon-rds-aurora/) PostgreSQL และ Azure SQL ส่วน node ต่าง ๆ รวมเป็น cluster กันเอง โดยหากันเจอผ่าน database (`jdbc-ping` เป็น default ตั้งแต่ 26.1) และใช้ Infinispan cache แบบ embedded ร่วมกัน: local cache สำหรับ realm, user และ key บนแต่ละ node และ distributed cache สำหรับ authentication session, user session และ action token ส่วน health endpoint กับ metrics endpoint อยู่บน management port แยกคือ 9000 ส่วนบน [Kubernetes](../kubernetes/) ตัว Keycloak Operator รัน server จาก resource `Keycloak` และ import realm จาก resource `KeycloakRealmImport`

## อยู่ตรงไหนใน solution

- **Solution:** sign-in ของลูกค้าสำหรับ web app และ mobile app, single sign-on สำหรับแอปของพนักงาน, B2B portal ที่บริษัท partner แต่ละรายใช้ identity provider ของตัวเอง sign in (Organizations รองรับตั้งแต่ 26.0), API และ microservice platform ที่ตรวจ JWT, multi-tenant SaaS ที่มี realm หรือ organization หนึ่งตัวต่อ tenant และ SAML สำหรับแอป enterprise รุ่นเก่า
- **Pattern ใน catalog นี้ที่มัน implement:** sign-in แบบ [OpenID Connect](../openid-connect/), [authorization code flow with PKCE](../oauth2-authorization-code-pkce/) สำหรับ public client, [SAML SSO](../saml-sso/) ในฐานะ identity provider, [Federated Identity](../federated-identity/) ผ่าน brokering และ LDAP, [Client Credentials](../oauth2-client-credentials/) สำหรับ service account, [Token Exchange](../token-exchange/), [Device Authorization Grant](../device-authorization-grant/), [Refresh Token Rotation](../refresh-token-rotation/) เมื่อเปิด *Revoke Refresh Token* และครึ่งฝั่ง server ของ [Sessions vs Tokens](../sessions-vs-tokens/): SSO session ที่อยู่หลัง token อายุสั้น ตัว API ทำ [JWT Validation](../jwt-validation/) ด้วย key ของมัน หรือให้ [API Gateway](../api-gateway/) ทำแทน ส่วน browser app ที่ไม่ควรถือ token เลยจะวาง [Backends for Frontends](../backends-for-frontends/) ไว้ข้างหน้า โดยลงทะเบียนเป็น confidential client
- **เพื่อนบ้านที่มักเจอ:** reverse proxy หรือ load balancer ข้างหน้า (TLS, forwarded header), PostgreSQL ข้างหลัง, SMTP server สำหรับ email ยืนยันตัวตนและ reset password, LDAP หรือ Active Directory, identity provider ภายนอก, แอปและ API ที่ใช้ token ของมัน และ metrics กับ log pipeline ของคุณ
- **Managed offering:** AWS ไม่มี Keycloak แบบ managed ทีมต่าง ๆ รันมันบน Amazon EKS หรือ [Amazon ECS](../amazon-ecs/) คู่กับ Aurora PostgreSQL ส่วนการทดสอบ high availability ของโปรเจกต์ Keycloak เองรันบน Red Hat OpenShift Service on AWS กับ Aurora PostgreSQL และ multi-cluster setup ของมันวาง AWS Global Accelerator ไว้ข้างหน้า ส่วนตัว identity provider แบบ managed ของ AWS คือ **[Amazon Cognito](../amazon-cognito/)** ส่วน Red Hat ให้ support กับ Red Hat build of Keycloak ที่เอกสารอยู่ที่ 26.6 ในเดือนตุลาคม 2026 และ Auth0 (Okta) กับ Microsoft Entra ID เป็นทางเลือกแบบ hosted

## ใช้ตอนไหนดี

ใช้ Keycloak เมื่อคุณอยากได้ identity provider ที่รันและคุมเอง: บน server ของคุณเองหรือใน cloud account ของคุณเอง ใช้ protocol มาตรฐาน มี LDAP, Active Directory และ Kerberos สำหรับพนักงาน broker ไปหา social provider และ enterprise provider ได้ ปรับ sign-in flow และหน้าเว็บต่าง ๆ ได้ และไม่มีค่า license ต่อ user เลือก managed service เมื่อไม่ควรมีใครในทีมต้อง on call ให้หน้า login หรือเมื่อผู้ใช้ของคุณอยู่ใน identity platform ของ vendor รายใดรายหนึ่งอยู่แล้ว

| | Keycloak | Amazon Cognito | Auth0 (Okta) | Microsoft Entra ID |
|---|---|---|---|---|
| Who runs it | คุณเอง จะมี support จาก Red Hat ด้วยก็ได้ | AWS | Okta ในรูป service | Microsoft |
| Cost model | ไม่มีค่า license (Apache 2.0) คุณจ่ายค่า server, database และงาน operation | ต่อ monthly active user ตาม feature plan (Lite, Essentials, Plus) | subscription plan ที่คิดราคาตาม monthly active user | license ต่อ user (Free, P1, P2) สำหรับพนักงาน ส่วน External ID คิดตาม monthly active user |
| Protocols for your apps | OpenID Connect, OAuth 2.0, SAML 2.0 | OpenID Connect, OAuth 2.0 | OpenID Connect, OAuth 2.0, SAML, WS-Federation | OpenID Connect, OAuth 2.0, SAML 2.0 |
| Users from elsewhere | LDAP และ AD, Kerberos, OIDC provider และ SAML provider, social login | SAML provider และ OIDC provider รวมถึง Google, Facebook, Apple, Amazon | AD และ LDAP ผ่าน connector ใน network ของคุณ รวมถึง SAML, OIDC, social | AD แบบ on-premises ผ่าน Microsoft Entra Connect และ social provider กับ enterprise provider ใน External ID |
| Custom logic | Java provider (SPI) และ flow | [Lambda](../aws-lambda/) trigger | Actions (Node.js) | custom authentication extension (เรียก REST API ของคุณ) |
| Default access-token lifetime | 5 นาที | 1 ชั่วโมง (ได้ถึง 1 วัน) | 24 ชั่วโมงสำหรับ custom API | สุ่ม 60 ถึง 90 นาที |
| Choose it when | คุณต้องการควบคุมเอง, self-hosting หรือ directory แบบ on-premises | แอปของคุณรันบน AWS และไม่อยากมี server | อยากได้ hosted service ที่มี integration สำเร็จรูปเยอะ | พนักงานของคุณ sign in ด้วย Microsoft อยู่แล้ว |

## ได้อะไร เสียอะไร

- **คุณต้องรัน service ระดับ tier-0** ถ้า Keycloak หรือ database ของมันล่ม ก็ไม่มีใคร sign in ได้ และไม่มี token ไหน refresh ได้ วางแผนรับมือเหมือนเป็น database: หลาย node กระจายข้าม availability zone, database ที่ highly available, backup, monitoring และมีคน on call
- **การเพิกถอนช้าไปหนึ่ง access token** การ disable user หรือจบ session จะหยุดการ refresh ทันที แต่ API ที่เช็ก signature เองในเครื่องจะยังรับ access token ที่มันถืออยู่ต่อไปจนถึง `exp` อายุ token ที่สั้นช่วยจำกัดช่วงนี้ ส่วน introspection ปิดช่วงนี้ได้เลย แต่ต้องแลกด้วยการเรียกหนึ่งครั้งต่อ request ([RFC 7662](https://www.rfc-editor.org/rfc/rfc7662))
- **การ upgrade เป็นงานประจำ** minor release ออกประมาณทุกสามเดือน (26.6 ในเมษายน, 26.7 ในกรกฎาคม และ 26.8 ในตุลาคม 2026) และมี patch release คั่นระหว่างนั้น custom theme และ provider ต้องทดสอบกับทุก release และตั้งแต่ 26.6 patch release ภายใน minor version เดียวกันก็ทยอย roll ผ่าน cluster ได้โดยไม่มี downtime
- **session ทำให้ database ทำงานหนักขึ้น** เมื่อเก็บ session ใน database การ sign in และการ refresh ทุกครั้งจะเขียนลงไป และตามเอกสาร setup แบบ multi-cluster v2 ทำให้ CPU และ write load ของ database เพิ่มขึ้นราวเท่าตัว โปรเจกต์รายงานว่าทดสอบ cluster เดียวกับ user 1,000,000 คนที่ 300 request ต่อวินาที และ scale ไปถึง 30 ล้าน user ด้วย 1,000 login และ 20,000 token refresh ต่อวินาทีบน pod ขนาดใหญ่หกตัวกับ Aurora cluster ให้กำหนดขนาด deployment ของคุณเองด้วย load test
- **multi-site มีข้อจำกัด** Multi-cluster v2 ที่รองรับตั้งแต่ 26.8 และเปิดด้วย `--features=stateless` เก็บ session state ทั้งหมดไว้ใน database ที่ replicate แบบ synchronous และต้องมี commit latency ต่ำกว่า 10 ms (แนะนำ 5 ms) มันเลยเหมาะกับ availability zone หรือ data centre ที่อยู่ใกล้กันใน region เดียว ไม่เหมาะกับ region ที่อยู่ไกลกัน ส่วน Multi-cluster v1 ที่เป็น setup แบบเก่าที่ใช้ Infinispan cluster ภายนอก ถูก deprecate แล้ว
- **สวิตช์เยอะ และมี default บางตัวที่ต้องเปลี่ยน** ความสามารถในการปรับ flow และ claim ได้ตามใจก็เปิดช่องให้พลาดได้ด้วย: redirect URI แบบ wildcard, *Direct access grants* ที่ปล่อยเปิดค้างไว้, brute-force detection และการเก็บ event ที่ปิดอยู่

## ข้อควรรู้ตอนลงมือทำ

realm ของสถานการณ์นี้ในรูปไฟล์ import (ตัดให้สั้นลง และ timeout ทั้งสามตัวเป็นค่า default ที่เขียนไว้ให้เห็นชัด ๆ):

```json
{
  "realm": "acme",
  "enabled": true,
  "accessTokenLifespan": 300,
  "ssoSessionIdleTimeout": 1800,
  "ssoSessionMaxLifespan": 36000,
  "roles": { "realm": [ { "name": "customer" } ] },
  "clients": [
    {
      "clientId": "shop-web",
      "publicClient": true,
      "standardFlowEnabled": true,
      "directAccessGrantsEnabled": false,
      "redirectUris": [ "https://shop.example/callback" ],
      "webOrigins": [ "https://shop.example" ],
      "attributes": { "pkce.code.challenge.method": "S256" },
      "protocolMappers": [
        {
          "name": "orders-api audience",
          "protocol": "openid-connect",
          "protocolMapper": "oidc-audience-mapper",
          "config": { "included.client.audience": "orders-api", "access.token.claim": "true" }
        }
      ]
    },
    { "clientId": "back-office", "publicClient": false, "standardFlowEnabled": true,
      "redirectUris": [ "https://backoffice.shop.example/callback" ] },
    { "clientId": "orders-api", "publicClient": false, "standardFlowEnabled": false,
      "directAccessGrantsEnabled": false }
  ]
}
```

- **เก็บ configuration เป็นโค้ด** export realm เป็น JSON แล้ว import ด้วย `KeycloakRealmImport`, `kcadm.sh` หรือ Admin REST API ทำให้การเปลี่ยนแปลงผ่านการ review แทนที่จะเป็นการคลิกใน console เก็บ `master` ไว้ให้ administrator ใช้เท่านั้น
- **Start แบบ production** รัน `kc.sh build` พร้อม provider และ option ของคุณ แล้วค่อย `kc.sh start --optimized` โดยตั้ง hostname (`--hostname https://id.shop.example`) ตั้ง proxy header ที่ load balancer ของคุณส่งมา (`--proxy-headers xforwarded`) และเปิด TLS ที่ Keycloak หรือที่ proxy ส่วนบน Kubernetes ตัว resource `Keycloak` ของ Operator ถือ setting ชุดเดียวกันนี้:

```yaml
apiVersion: k8s.keycloak.org/v2beta1
kind: Keycloak
metadata:
  name: acme-id
spec:
  instances: 3
  db:
    vendor: postgres
    host: acme-id-db
    usernameSecret: { name: acme-id-db, key: username }
    passwordSecret: { name: acme-id-db, key: password }
  http:
    tlsSecret: acme-id-tls
  hostname:
    hostname: id.shop.example
  proxy:
    headers: xforwarded
```

- **ทำให้ API เข้มงวด** เช็ก `iss`, `aud`, `exp` และ algorithm ของทุก token, cache JWKS ไว้แต่ดึงใหม่เมื่อ token ระบุ `kid` ที่ไม่รู้จัก และอ่าน role จาก `realm_access.roles` หรือ `resource_access` ตัว API ที่เช็กแค่ signature จะรับ token ที่ออกให้ client ตัวไหนก็ได้ของ realm ส่วน audience mapper บวกกับการเช็ก `aud` จะกันเรื่องนี้ได้
- **เปลี่ยน default ที่เสี่ยง** เปิด brute-force detection, *Save events* (พร้อมวันหมดอายุ) และ *Revoke Refresh Token* ที่เป็น realm setting ที่ทำให้ refresh token แต่ละตัวใช้ได้ครั้งเดียว ข้อนี้สำคัญที่สุดสำหรับ public client อย่าง shop-web ปิด *Direct access grants* และ implicit flow ในที่ที่ไม่มีใครใช้ และลงทะเบียน redirect URI แบบตรงเป๊ะ
- **ทำให้ช่วงเวลาของ token สั้นไว้** ปล่อย access token ไว้ที่ไม่กี่นาที ถ้า API ต้องรู้ว่า user ถูก disable หรือ logout เร็วกว่า `exp` ให้ API ตัวนั้นเรียก introspection endpoint แทนการเช็กแค่ signature
- **backup database** ตั้งแต่ 26.0 มันเก็บ session ด้วย นอกจาก realm, user และ credential และการ restore ก็คือวิธีกู้คืนจากการเปลี่ยนแปลงที่ผิดพลาด
- **การเปลี่ยนแปลงใน directory มาถึง Keycloak ตามตารางเวลา** ถ้า import LDAP user ไว้ ให้ตั้ง sync แบบเฉพาะ user ที่เปลี่ยน ทำให้ attribute และสถานะ account จาก Active Directory มาถึงทันเวลา ส่วน password จะถูกเช็กกับ directory แบบสด ๆ เสมอ
