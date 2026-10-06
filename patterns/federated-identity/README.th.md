## ปัญหา

ถ้าทุกแอปเก็บบัญชีผู้ใช้ของตัวเอง ทุกแอปก็กลายเป็น identity provider ตัวเล็ก ๆ มันต้องเก็บ password hash รับมือกับ credential stuffing และดูแลเรื่อง lockout, reset password และการลงทะเบียน multi-factor เอง ผู้ใช้ก็ต้องจำ password เพิ่มอีกหนึ่งตัวต่อหนึ่งแอป คนที่ไม่ได้ทำงานให้คุณ อย่างพนักงานของ partner หรือลูกค้าของคุณ ก็ต้องมีบัญชีที่ใครสักคนสร้าง และที่สำคัญกว่าคือใครสักคนลบ ตรงนี้แหละที่พัง: พอมีคนลาออกจากบริษัท partner นายจ้างก็ปิดบัญชีเขาใน directory ของตัวเอง แต่ไม่มีใครบอกแอปของคุณ บัญชีของเขาที่นี่เลยกลายเป็น **orphan** ที่ password เก่าของเขายังเปิดได้

## ทำงานยังไง

Federation แยก *คนนี้คือใคร* ออกจาก *เขาทำอะไรที่นี่ได้บ้าง* แอปเลิกยืนยันตัวตนผู้ใช้เอง แล้วไว้ใจให้ identity provider ทำแทน

- **Identity provider (IdP):** ระบบที่เก็บบัญชีของผู้ใช้และยืนยันตัวตนเขา: directory ของบริษัท, directory ของ partner หรือ social login ใน OpenID Connect เรียกมันว่า OpenID Provider
- **Relying party (RP):** แอปที่รับคำรับรองของ IdP เกี่ยวกับผู้ใช้ ใน SAML เรียกมันว่า **service provider (SP)**
- **Claims:** สิ่งที่ token บอกเกี่ยวกับผู้ใช้: subject identifier, ชื่อและ email, group ที่เป็นสมาชิก และยืนยันตัวตนมายังไงเมื่อไร OpenID Connect ใส่มันไว้ใน **ID token** ที่ sign แล้ว ส่วน SAML เรียกมันว่า attribute และใส่ไว้ใน **assertion** ที่ sign แล้ว
- **Trust:** config ของ relying party ที่บอกว่าเชื่อ issuer ตัวไหน issuer นั้น sign ด้วย key อะไร และ token ต้องระบุว่าส่งถึง relying party ตัวนี้ ตั้งค่าแค่ครั้งเดียวด้วยการแลก **metadata** (issuer identifier, endpoint, signing key) ที่ publish เป็น discovery document ของ OpenID Connect พร้อม JWKS ของมัน หรือเป็นไฟล์ SAML metadata พร้อม signing certificate
- **Federation:** ภาพรวมของทั้งหมดนี้: identity provider กับ relying party ที่มักอยู่คนละองค์กร ตกลงกันว่าจะเชื่อ assertion ของกันและกันภายใต้กฎชุดเดียวกัน
- **Home realm discovery (HRD):** การหาว่าผู้ใช้สังกัด IdP ตัวไหน สัญญาณที่ใช้กันปกติคือ domain ของ email ที่ผู้ใช้พิมพ์, subdomain หรือลิงก์ที่เขาเข้ามา, hint ที่แอปส่งไป หรือ cookie ที่จำตัวเลือกครั้งล่าสุดไว้ ถ้าไม่มีอะไรตรงเลย ผู้ใช้ก็เลือกเองจากรายการ

ตอนเข้าสู่ระบบ relying party จะ redirect browser ไปที่ IdP ของผู้ใช้ แล้ว IdP ก็ยืนยันตัวตนผู้ใช้ตาม policy ของตัวเอง (password, passkey, MFA) และส่ง ID token หรือ assertion ที่ sign แล้วกลับมา จากนั้น relying party ก็ตรวจ signature ด้วย key ที่ IdP publish ไว้ ตรวจ issuer, audience, เวลาหมดอายุ และ nonce (ใน OpenID Connect) แล้วค่อยเริ่ม session ของตัวเอง [OpenID Connect](../openid-connect/) อธิบายการแลกเปลี่ยนนี้ทีละขั้น ส่วน [JWT Validation](../jwt-validation/) อธิบายเรื่องการจัดการ key

**Protocol** OpenID Connect ที่เป็น identity layer บน OAuth 2.0 และใช้ token แบบ JSON เป็นตัวเลือกปกติสำหรับแอปใหม่ รวมถึง mobile และ single-page app ส่วน SAML 2.0 ที่ใช้ assertion แบบ XML และมักส่งด้วยการ POST ผ่าน browser ก็ยังพบบ่อยใน SaaS ขององค์กร และ IdP ส่วนใหญ่ก็พูดได้ทั้งสองแบบ ตัว flow ของ SAML อยู่ใน pattern [SAML 2.0 Single Sign-On](../saml-sso/) ส่วน WS-Federation เป็น protocol รุ่นเก่าที่ Microsoft Entra ID ยังรับอยู่ ให้ใช้มันกับแอป legacy ที่ทำอย่างอื่นไม่ได้เท่านั้น

**Federation broker** อยู่ระหว่างแอปกับ IdP หลายตัว NIST SP 800-63C-4 เรียกมันว่า federation proxy: มันเป็น relying party ต่อ IdP ต้นทางแต่ละตัว และเป็น identity provider ต่อแอป ส่วน assertion ที่มันออกก็ระบุ broker เป็น issuer ตัวแอปเลยมี trust เดียว protocol เดียว และ claim format เดียว ขณะที่ broker จัดการ home realm discovery, การแปลง protocol (รับ SAML เข้า ส่ง OpenID Connect ออก), การ map claim และ trust แยกกับ provider ต้นทางแต่ละตัว ตัวอย่าง ณ ปี 2026:

- **Enterprise identity platform** อย่าง Microsoft Entra ID ที่ B2B collaboration ของมันให้พนักงานของ partner เข้าสู่ระบบด้วยบัญชีขององค์กรตัวเองได้ หรือ Okta ที่ส่งผู้ใช้ไปหา IdP ภายนอกผ่าน routing rule
- **Customer identity service** อย่าง Microsoft Entra External ID, Auth0 หรือ Amazon Cognito user pool ยกตัวอย่าง Cognito ก็ federate กับ Google, Apple, Facebook, Amazon และ provider แบบ OIDC หรือ SAML ตัวไหนก็ได้ แล้วส่ง user pool token แบบเดียวให้ backend
- **Open-source broker** อย่าง Keycloak ที่ identity brokering ของมันครอบคลุม OIDC, SAML และ social provider มี mapper สำหรับ claim และมี organization ที่ส่งผู้ใช้ไปตาม domain ของ email

**สิ่งที่แอปยังต้องดูแลเอง** federation ส่งต่อแค่การยืนยันตัวตน ไม่ใช่ทุกอย่าง:

- **Authorization** IdP บอกว่าผู้ใช้คือใคร และอาจบอกด้วยว่าอยู่ group ไหน ส่วนแอปเป็นคนตัดสินว่านั่นทำอะไรได้บ้าง ให้ map group ภายนอกไปเป็น role ของคุณเองที่ broker หรือตอนเข้าสู่ระบบ และเก็บการตัดสินไว้ในแอป (หรือใน policy engine: ดู [Policy-Based Authorization](../policy-based-authorization/))
- **Local profile ของมัน** record ที่ใช้ federated identifier เป็น key และเก็บสิ่งที่แอปเท่านั้นรู้: settings, role และของที่ผู้ใช้เป็นเจ้าของ
- **Session ของมัน** หลังตรวจ token แล้ว แอปก็ดูแล session ของตัวเอง และอายุของ token ก็ไม่ใช่อายุของ session [Sessions vs Tokens](../sessions-vs-tokens/) เปรียบเทียบทางเลือกต่าง ๆ ไว้

## ใช้ตอนไหนดี

- **แอปสำหรับพนักงาน:** พนักงานเข้าสู่ระบบด้วย IdP ของบริษัท ได้ single sign-on และเสียสิทธิ์เข้าถึงเมื่อ IT ปิดบัญชีในที่เดียว
- **Business to business:** พนักงานของ partner ใช้บัญชีขององค์กรตัวเอง และ partner ก็ดูแลเรื่องคนเข้าคนออกเอง
- **Multi-tenant SaaS:** ลูกค้าธุรกิจแต่ละรายเอา IdP ของตัวเองมา ส่วนผู้ใช้ทั่วไปก็เข้าสู่ระบบด้วยบัญชี social หรือบัญชี local ที่ customer identity service
- **แอปไหนก็ตามที่ถ้าไม่ทำแบบนี้ก็ต้องเก็บ password เอง**

ตอนที่ **ไม่** ควร federate:

- **การเรียกระหว่าง service กับ service** ไม่มีผู้ใช้ให้ส่งไปไหน ส่วน workload ก็ได้ token ของตัวเอง เช่น ด้วย [OAuth 2.0 Client Credentials](../oauth2-client-credentials/) และส่ง context ของผู้ใช้ต่อลงไปด้วย [Token Exchange](../token-exchange/)
- **ผู้ใช้กลุ่มเล็ก ๆ ปิด ๆ ของแอปเดียว** ที่การดูแล trust relationship เสียมากกว่าได้ แต่ถึงอย่างนั้นก็ให้ใช้ managed identity service แทนการเขียนที่เก็บ password เอง
- **IdP ตัวเดียว** ไม่ต้องมี broker: ไว้ใจมันตรง ๆ ไปเลย แล้วค่อยเพิ่ม broker ตอน provider ตัวที่สองหรือสามมา

## ได้อะไร เสียอะไร

- **dependency ที่สำคัญมาก** ถ้า IdP หรือ broker ล่ม ก็ไม่มีใครเข้าสู่ระบบได้ แต่ session ที่มีอยู่แล้วยังใช้ต่อได้ ให้ broker มี availability เท่ากับแอป และถ้าเป็นไปได้ก็อยู่ใน region เดียวกัน
- **trust คือ security boundary** IdP ตัวไหนที่คุณไว้ใจก็พาใครก็ได้ที่มันมีสิทธิ์รับรองเข้าสู่ระบบได้ ให้จำกัด provider แต่ละตัวไว้กับผู้ใช้และ tenant ที่มันเป็นเจ้าของ และมองการเปลี่ยน federation settings แบบเดียวกับการเปลี่ยน firewall rule
- **identity มีสองชุด** ปกติ broker จะเก็บ record ของผู้ใช้แต่ละคนไว้เอง (Keycloak สร้างตอนเข้าสู่ระบบครั้งแรก) การ deprovision เลยต้องไปถึงทั้ง broker และแอป
- **session อยู่สามที่** IdP, broker และแอปต่างก็มี session ของตัวเอง และการจบตัวหนึ่งไม่ได้จบตัวอื่น
- **claim เป็นภาพ ณ ตอนนั้น** การเปลี่ยน group และบัญชีที่ถูกปิดจะเห็นผลตอนเข้าสู่ระบบครั้งถัดไป หรือตอนที่ provider ส่งสัญญาณมา ไม่ใช่ทันที
- **คุมการเข้าสู่ระบบได้น้อยลง** กฎของ password และ MFA เป็นสิ่งที่ partner เลือก คุณขอหลักฐานว่ามีได้ แต่คุณไม่ได้เป็นคนดูแลมัน

## ข้อควรรู้ตอนลงมือทำ

- **ใช้ issuer คู่กับ subject เป็น key ของผู้ใช้ อย่าใช้ email** OpenID Connect Core §5.7 บอกว่า `iss` กับ `sub` รวมกันเป็น identifier ตัวเดียวที่รับประกันว่านิ่งและไม่ซ้ำ และบอกว่า issuer อาจยอมให้ email เปลี่ยน หรือเอาไปให้คนอื่นใช้ได้ NIST SP 800-63C-4 ก็สร้าง federated identifier จาก issuer และ subject เหมือนกัน ในปี 2023 Microsoft เตือนว่า multi-tenant application ที่ใช้ claim `email` ทำ authorization อาจโดนหลอกได้ ถ้ามีผู้ใช้ตั้ง address ของคนอื่นเป็น email ที่ยังไม่ได้ยืนยัน ตอนนี้ Microsoft เลยไม่ใส่ claim แบบนั้นมาให้แอปส่วนใหญ่ และ [แนวทางของมัน](https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation) คืออย่าทำ authorization ด้วย `email`, `preferred_username` หรือ `unique_name` เลย นอกจากนี้ address ยังเปลี่ยนมือได้แบบที่คุณคุมไม่ได้ด้วย: พอบริษัทหนึ่งปล่อยให้ domain หมดอายุ ใครที่จด domain นั้นไปก็สร้าง mailbox เดิมขึ้นมาใหม่ได้
- **เชื่อมบัญชีอย่างตั้งใจ** อย่ารวมการเข้าสู่ระบบแบบ federated เข้ากับบัญชีที่มีอยู่แค่เพราะ email ตรงกัน ให้ผู้ใช้พิสูจน์ว่าคุมได้ทั้งสองบัญชี งานวิจัยปี 2022 พบว่า 35 จาก 75 service ยอดนิยมเปิดช่องให้ [account pre-hijacking](https://www.usenix.org/conference/usenixsecurity22/presentation/sudhodanan) ได้ รวมถึงการโจมตีที่อาศัยการรวมบัญชีแบบนี้
- **Provisioning แบบ just-in-time หรือ SCIM** just-in-time provisioning สร้าง local profile ตอนเข้าสู่ระบบครั้งแรกจาก claim วิธีนี้ทำง่าย แต่แอปจะไม่เคยรู้เรื่องคนที่ลาออก: NIST SP 800-63C-4 เตือนว่าบัญชีแบบนี้จะกองพะเนิน ถ้า IdP ไม่ส่งสัญญาณเรื่องการออกจากงานมา และแนะนำให้ปิดบัญชีที่ไม่ได้ใช้นานเกินช่วงหนึ่ง (ตัวอย่างของมันคือ 120 วันสำหรับแอปที่ใช้ทุกสัปดาห์) ส่วนถ้าใช้ SCIM (RFC 7643 กำหนด schema และ RFC 7644 กำหนด protocol) provisioning service ของ IdP จะ push ผู้ใช้และ group ไปที่ endpoint `/Users` และ `/Groups` ของแอป แล้วก็ปิดใช้งาน (`active: false`) หรือลบพวกเขา ทำให้ profile ของคนที่ลาออกหายไปแม้เขาจะไม่เข้าสู่ระบบอีกเลย แล้วก็กำหนด role ไว้ก่อนการเข้าสู่ระบบครั้งแรกได้ด้วย
- **Single logout มีข้อจำกัด** OpenID Connect Back-Channel Logout ให้ IdP ส่ง logout token ที่ sign แล้วไปให้ relying party แต่ละตัวแบบ server กับ server ส่วน SAML Single Logout รันผ่าน SOAP ได้ แต่ส่วนใหญ่ต้องพึ่งให้ browser เข้าไปหาผู้เกี่ยวข้องทุกตัวทีละตัว และผู้เกี่ยวข้องตัวไหนที่ไม่ตอบก็จะทิ้ง session ค้างไว้ ให้ session ของแอปสั้น และ renew แบบเงียบ ๆ กับ IdP ถ้า provider ของคุณรองรับ spec ของ OpenID Shared Signals (CAEP และ RISC ที่ final ตั้งแต่กันยายน 2025) ก็ใช้ให้ provider บอกคุณเรื่อง session ที่ถูก revoke และบัญชีที่ถูกปิดได้
- **Key rollover และ metadata** IdP rotate signing key ตามรอบ และในกรณีฉุกเฉินก็ rotate ทันที ส่วน Microsoft ไม่ได้สัญญาว่าจะมีรอบที่แน่นอน ให้โหลด key จาก metadata (`jwks_uri` ของ OpenID Connect หรือ SAML metadata URL) refresh เป็นระยะ และทุกครั้งที่ token มาพร้อม key ID ที่ไม่รู้จัก และอย่าแปะ certificate เองด้วยมือ ใน Keycloak ตัว *Use JWKS URL* (OIDC) และ *Use metadata descriptor URL* (SAML) ทำเรื่องนี้ให้ ถ้าปิดไว้ admin ต้อง import key ใหม่ทุกตัวเอง ไม่อย่างนั้นการเข้าสู่ระบบจะพัง
- **Multi-tenant SaaS** เก็บ connection แยกตามลูกค้าธุรกิจแต่ละราย: issuer, metadata URL, domain ของ email ที่ใช้ทำ discovery (หลังลูกค้าพิสูจน์แล้วว่าเป็นเจ้าของ) และการ map claim ของรายนั้น ตรวจ issuer แยกตาม tenant: token ใช้ได้ก็ต่อเมื่อมาจาก issuer ที่ตั้งไว้ให้ tenant นั้น และใช้กับผู้ใช้ของ tenant นั้นเท่านั้น ถ้าใช้ multi-tenant endpoint ของ Microsoft Entra ID ตัว issuer จะระบุ tenant ของผู้ใช้เอง แล้ว Microsoft ก็บอกให้เช็กว่ามันมี tenant ID ของ token (`tid`) อยู่ และตรงกับ issuer ใน metadata และคุณก็ควรรับแค่ tenant ที่ onboard แล้วด้วย
- **ข้อควรระวังของ social login** บัญชี social บอกว่าคนนั้นคือใคร แต่ไม่ได้บอกว่าเขาทำงานที่ไหน: ไม่มี group และไม่มีขั้นตอนตอนลาออก ให้เช็ก `email_verified` เตรียมรับ relay address (Sign in with Apple ซ่อน address จริงไว้หลัง address สุ่มได้) และใช้ `sub` เป็น key โดยที่ Google เองก็เขียนในเอกสารว่าค่านี้ไม่มีวันเปลี่ยน social login บางตัวเป็นแค่ OAuth 2.0 ธรรมดาที่มี profile API ไม่ใช่ OpenID Connect คนยังทำบัญชี social หายได้ด้วย เลยต้องวางทางกู้บัญชีไว้
- **MFA ที่ provider และความแข็งแรงของมัน** ให้ IdP ดูแล MFA แล้วเช็กว่าผู้ใช้ยืนยันตัวตนมายังไง: `acr` (authentication context class) และ `amr` (method ที่ใช้ โดยมีค่าอย่าง `pwd`, `otp` และ `mfa` ที่ลงทะเบียนไว้ใน [RFC 8176](https://www.rfc-editor.org/rfc/rfc8176)) ของ OpenID Connect หรือ `AuthnContextClassRef` ของ SAML ตัว broker ต้องส่งค่าพวกนี้ผ่านหรือ map มัน ห้ามทิ้ง ถ้าเป็น action ที่ sensitive ให้ step up: ขอ `acr_values` ที่แข็งแรงกว่า หรือ `max_age` ที่ใหม่กว่า และให้ API เรียกร้องมันได้ด้วย challenge `insufficient_user_authentication` จาก [RFC 9470](https://www.rfc-editor.org/rfc/rfc9470) ส่วน cross-tenant access settings ของ Microsoft Entra ก็ไว้ใจ MFA ที่ Entra tenant ของ partner ทำมาแล้วได้
- **Federation ในระดับใหญ่** NIST SP 800-63C-4 (กรกฎาคม 2025) กำหนด federation assurance level สามระดับ (FAL1 ถึง FAL3), trust agreement, proxy, provisioning model (just-in-time, pre-provisioning, ephemeral) และ shared signaling ส่วน OpenID Federation 1.0 ที่เป็น final specification ตั้งแต่กุมภาพันธ์ 2026 ทำให้ไม่ต้องแลก metadata กันเป็นคู่ ๆ: แต่ละ entity publish statement ที่ sign แล้ว และมี trust chain ที่ไล่จากมันไปถึง trust anchor ที่ทั้งสองฝั่งยอมรับ ตัวอย่างใน spec เองก็รวมถึง federation ด้านการวิจัยและการศึกษาอย่าง eduGAIN
- **Zero trust** federation ให้ทุก request มี identity ที่ผู้มีอำนาจตัวที่ถูกต้องรับรองไว้ ส่วน [Zero Trust Access](../zero-trust-access/) เพิ่มการเช็ก device และ context ในทุก request
