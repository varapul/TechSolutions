## ปัญหา

แอปรูปภาพอยู่ใน AWS account เดียว ตัว function `make-thumbnail` อ่านไฟล์ที่ upload มาจาก bucket `photos-prod` แล้วเขียน thumbnail กลับลงไป ส่วน workflow ของ GitHub Actions ก็ deploy function เวอร์ชันใหม่ และ developer ก็เข้าไปดู log และดู bucket ตอนที่มีอะไรพัง ทุกตัวเข้าถึง AWS ผ่าน public API ชุดเดียวกัน ทำให้ทุก call ต้องตอบสองคำถามให้ได้ก่อนที่อะไรจะเกิดขึ้น: ใครเป็นคนเรียก และ identity นั้นทำสิ่งนี้กับ resource นั้นได้ไหม

คำตอบแบบเร็ว ๆ คือคำตอบที่อันตราย access key ที่แปะไว้ใน configuration ของ function หรือใน secret ของ CI ใช้ได้จากทุกที่จนกว่าจะมีคนลบมัน และ key ก็รั่วผ่านโค้ด, container image และ build log ได้ ส่วน policy แบบ `s3:*` บน `*` ช่วยประหยัดเวลานั่งอ่านเอกสารไปได้ครึ่งวัน แต่ก็ทำให้ bug หรือใครก็ตามที่ถือ key อยู่ลบรูปได้ทุกรูป แล้วคนที่ต้องเข้าถึงก็เปลี่ยนไปทุกเดือน

## ทำงานยังไง

AWS Identity and Access Management (IAM) ทำ authentication และ authorization ให้ request ที่ส่งไป AWS API ของทุก service ใน account ไม่มีอะไรต้อง deploy หรือจ่ายเงิน: IAM, IAM Identity Center และ AWS STS ให้ใช้โดยไม่มีค่าใช้จ่ายเพิ่ม (ตุลาคม 2026)

### Principal: ใครเป็นคนเรียก

- **root user** คือ identity ที่ถูกสร้างมาพร้อม account และเข้าถึงทุกอย่างใน account ได้เต็มที่ AWS แนะนำให้ใช้มันแค่กับงานไม่กี่อย่างที่ต้องใช้มันจริง ๆ และบังคับ MFA ให้มัน ใน AWS Organizations ตัว centralized root access ทำให้เราลบ root credential ของ member account ทิ้งไปเลยได้
- **IAM user** มี credential แบบอายุยาว: password ของ console และ access key ได้ไม่เกินสองตัว โดยที่ ID ของ key ขึ้นต้นด้วย `AKIA` ตัว key ใช้ได้ไปเรื่อย ๆ จนกว่าจะถูก deactivate หรือลบ นี่คือเหตุผลที่ AWS แนะนำให้ใช้ IAM user แค่ตอนที่ federation ช่วยไม่ได้
- **Role** ไม่มี credential แบบอายุยาว ตัว role มี **trust policy** ที่บอกว่าใคร assume มันได้ และ **permissions policy** ที่บอกว่า session ของมันทำอะไรได้ ใครที่ assume มันจะได้ credential แบบชั่วคราวจาก AWS STS ส่วน workload จะได้ role จาก service ที่รันมัน: Lambda execution role, [ECS](../amazon-ecs/) task role, EC2 instance profile ส่วน service-linked role คือ role ที่ AWS service นิยามไว้ล่วงหน้าสำหรับงานของตัวเอง
- **Federated identity** มาจาก identity provider นอก IAM และใช้ role ระหว่างทำงาน: คนเข้ามาผ่าน IAM Identity Center ส่วนระบบ CI และ workload อื่นเข้ามาผ่าน OpenID Connect (`AssumeRoleWithWebIdentity`) หรือ SAML 2.0 (`AssumeRoleWithSAML`) และ end user ของ application เองเข้ามาผ่าน [Amazon Cognito](../amazon-cognito/) identity pool

### Authentication: พิสูจน์ตัวตน

- **Signature Version 4** SDK สร้างรูปแบบ canonical ของ request (method, path, query, header และ hash ของ body) แล้ว sign ด้วย key ที่ derive มาจาก secret access key สำหรับวัน Region และ service นั้น ฝั่ง AWS ก็คำนวณ signature ซ้ำ ทำให้ secret ไม่เคยถูกส่งไปไหน request ที่ถูกแก้ระหว่างทางจะไม่ผ่าน และส่วนใหญ่ request ต้องมาถึงภายในห้านาทีนับจาก timestamp ของมัน ถ้าใช้ credential แบบชั่วคราว request จะแนบ session token ไปด้วยใน `X-Amz-Security-Token` ส่วน SigV4a เป็นแบบ asymmetric ใช้ sign request ที่อาจถูกตอบจากหลาย Region เช่น request ที่ไป S3 Multi-Region Access Point ส่วน call บางตัวก็แนบ token แทน signature: `AssumeRoleWithWebIdentity` ไม่ต้องใช้ AWS credential เพราะ token ของ identity provider คือตัวพิสูจน์
- **MFA** root user และ IAM user ลงทะเบียน passkey หรือ security key (แบบ FIDO และกัน phishing ได้), authenticator app หรือ hardware TOTP token ได้ และ policy ก็บังคับ MFA สำหรับ action ที่อ่อนไหวได้ด้วย condition key `aws:MultiFactorAuthPresent`
- **IAM Identity Center** คือประตูหน้าที่ AWS แนะนำให้คนใช้ ตัว user sign in ครั้งเดียวที่ AWS access portal โดยยืนยันกับ directory ของ Identity Center เอง หรือกับ identity provider ภายนอกผ่าน SAML 2.0 แล้วเลือก account กับ **permission set** ตัว permission set คือ template: Identity Center สร้าง IAM role ที่ตรงกันไว้ในทุก account ที่ permission set ถูก assign ไป แล้วส่ง credential แบบชั่วคราวของ role นั้นให้ user ใช้กับ console หรือ CLI ส่วน session อยู่ได้ 1 ชั่วโมงเป็นค่าตั้งต้น และตั้งได้ถึง 12 ชั่วโมงต่อ permission set

### Policy: อะไรทำได้บ้าง

policy ส่วนใหญ่เป็นเอกสาร JSON ในภาษา policy เวอร์ชัน `2012-10-17` แต่ละ statement มี `Effect` (`Allow` หรือ `Deny`), `Action` ที่มันครอบคลุม (`s3:GetObject` ส่วน wildcard ก็ใช้ได้), `Resource` ที่มันครอบคลุมตาม ARN, `Condition` บน request context ที่จะใส่หรือไม่ก็ได้ (`aws:SecureTransport`, `aws:SourceIp`, `aws:PrincipalTag/team`, `s3:prefix` …) และเฉพาะใน resource-based policy จะมี `Principal` ที่ statement นั้นใช้กับด้วย ส่วน `NotAction`, `NotResource` และ `NotPrincipal` match ทุกอย่างยกเว้นที่อยู่ใน list

IAM User Guide ระบุ policy ไว้เก้าแบบ ณ ตุลาคม 2026 ตัวที่ design ส่วนใหญ่ต้องเจอมีดังนี้:

| แบบ | Attach กับ | ให้สิทธิ์ไหม | ในแอปรูปภาพ |
|---|---|---|---|
| Identity-based แบบ managed หรือ inline | user, group, role | ให้ | `thumbnailer-role` อ่าน `u/*` และเขียน `thumbnails/*` ได้ |
| Resource-based | resource: S3 bucket policy, KMS key policy, SQS queue policy, trust policy ของ role | ให้ และให้กับ account อื่นได้ด้วย | `photos-prod` ปฏิเสธ request ที่ไม่มี TLS |
| Permissions boundary | user หรือ role (เป็น managed policy) | ไม่: ตั้งเพดานให้สิ่งที่ identity-based policy ให้ได้ | ไม่มี |
| Service control policy (SCP) | root, OU หรือ account ของ organization | ไม่: ตั้งเพดานให้สิ่งที่ principal ใน member account ทำได้ | `FullAWSAccess` ที่เป็นค่าตั้งต้น |
| Resource control policy (RCP) มีตั้งแต่พฤศจิกายน 2024 | root, OU หรือ account ของ organization | ไม่: ตั้งเพดานให้สิ่งที่ทำกับ resource ใน member account ได้ | `RCPFullAWSAccess` ที่เป็นค่าตั้งต้น |
| Session policy | role session หรือ federated session ตัวเดียว ส่งเข้าไปตอนเริ่ม | ไม่: ตั้งเพดานให้ session นั้น | ไม่มี |
| Access control list (ACL) | resource ใน S3, VPC และ AWS WAF | ให้ แต่ให้กับ account อื่นเท่านั้น | ปิดไว้ ตามค่าตั้งต้นของ bucket ใหม่ |

VPC endpoint policy และ resource share ของ AWS RAM คือสองแบบที่เหลือให้ครบเก้า managed policy มาจาก AWS (`AWSLambdaBasicExecutionRole`, `AWSLambda_FullAccess`) หรือจากเราเอง ตัว AWS managed policy ช่วยให้เริ่มได้เร็ว แต่มันเขียนมาเผื่อ workload หลายแบบ และส่วนใหญ่ให้สิทธิ์มากกว่าที่ workload ตัวเดียวต้องใช้

### Request หนึ่งถูกประเมินยังไง

สำหรับทุก request ตัว IAM จะประกอบ request context ขึ้นมา (principal, action, resource และข้อเท็จจริงอย่างเวลา, source IP และใช้ TLS หรือเปล่า) แล้วประเมินทุก policy ที่เกี่ยวข้อง ภายใน account เดียว โค้ดที่ AWS ใช้บังคับสิทธิ์ทำงานตามลำดับนี้:

1. **Explicit deny** มันหา statement `Deny` ที่ match ในทุก policy: SCP, RCP, resource-based และ identity-based policy, permissions boundary และ session policy แค่ตัวเดียวก็พอ: ผลคือ Deny ไม่ว่าจะมีอะไรอื่นยอมให้ request นี้ก็ตาม
2. **RCP แล้วตามด้วย SCP** ถ้า account อยู่ใน organization ที่ใช้มัน มันต้องยอมให้ action นั้น แต่มันไม่เคยให้สิทธิ์อะไรด้วยตัวเอง
3. **Resource-based policy** Allow ตรงนี้ตัดสินจบได้เลยภายใน account เดียวกัน ถ้ามันระบุชื่อ role session หรือ IAM user ตรง ๆ ผลจะเป็น Allow แม้ identity-based policy, boundary หรือ session policy จะไม่ได้พูดถึงเลยก็ตาม แต่ถ้ามันระบุ ARN ของ role ตัว boundary และ session policy ก็ยังมีผลอยู่
4. **Identity-based policy** ถ้าไม่มีตัวไหนยอมให้ action นั้น และไม่มี resource-based policy ไหนยอมให้ไปแล้ว request ก็จะถูก implicit deny
5. **Permissions boundary** ถ้า user หรือ role มี ก็ต้องยอมให้ด้วย
6. **Session policy** ถ้า session เริ่มมาพร้อม session policy ก็ต้องยอมให้ด้วย ถึงตอนนั้นผลถึงจะเป็น Allow

ทุกอย่างเริ่มต้นเป็น **implicit deny** ยกเว้น root user ส่วน resource-based policy สองแบบเข้มกว่าแบบอื่น: trust policy ของ role และ KMS key policy ต้องยอมให้ตัว principal เองตรง ๆ แม้จะอยู่ใน account เดียวกัน ส่วน **ข้าม account** ทั้งสองฝั่งต้องเห็นตรงกัน: identity-based policy ของผู้เรียกใน account ของตัวเอง และ resource-based policy (หรือ trust policy ของ role) ในอีก account

สาม call ของ step 3 ที่ `thumbnailer-role` เป็นคนเรียกทั้งหมด:

| Request | อะไรเป็นตัวตัดสิน | ผล |
|---|---|---|
| `GetObject u/9f3c/IMG_0042.jpg` ผ่าน HTTPS | ไม่มี Deny ไหนเข้าเงื่อนไข ส่วน SCP และ RCP ยอมให้ และ identity policy ก็ยอมให้ `photos-prod/u/*` | 200 OK |
| `DeleteObject u/9f3c/IMG_0042.jpg` | ไม่มี Deny ไหนเข้าเงื่อนไข แต่ก็ไม่มี policy ไหนยอมให้ `s3:DeleteObject` | implicit deny: 403 `AccessDenied` |
| `GetObject u/9f3c/IMG_0042.jpg` ผ่าน HTTP ธรรมดา | bucket policy ปฏิเสธ `s3:*` เมื่อ `aws:SecureTransport` เป็น `false` | explicit deny: 403 `AccessDenied` |

สำหรับผู้เรียกใน account หรือ organization เดียวกัน ข้อความ 403 ของ S3 จะบอกว่า policy แบบไหนปฏิเสธ request และเพราะอะไร (สำหรับ call ที่สองคือ ไม่มี identity-based policy ไหนยอมให้ action `s3:DeleteObject`) และถ้าเป็น explicit deny ใน SCP, RCP, identity-based policy, session policy หรือ boundary ข้อความก็จะมี ARN ของ policy นั้นด้วย

### Role และ AWS STS

AWS STS เป็นคนออก credential แบบชั่วคราวทุกชุด: access key ID ที่ขึ้นต้นด้วย `ASIA`, secret access key, session token และเวลาหมดอายุ ส่วน Lambda ก็ assume `thumbnailer-role` เองทุกครั้งที่ function รัน แล้วส่ง credential เข้าไปเป็น `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` และ `AWS_SESSION_TOKEN` ให้ SDK ไปหาเจอเอง โดยที่โค้ดของ function ไม่ได้เรียก STS เอง operation ของ STS มีดังนี้:

- **`AssumeRole`** trust policy ของ role ต้องยอมให้ผู้เรียก ส่วนผู้เรียกที่มาจาก account อื่นก็ต้องมี identity-based policy ของตัวเองที่ยอมให้ `sts:AssumeRole` บน role นั้นด้วย ส่วน `DurationSeconds` ตั้งได้ตั้งแต่ 900 วินาทีไปจนถึง maximum session duration ของ role ที่เราตั้งได้ระหว่าง 1 ถึง 12 ชั่วโมง ถ้าไม่ใส่ session จะอยู่ได้ 1 ชั่วโมง ส่วน role session ที่ไป assume role อีกตัว (role chaining) จะถูกจำกัดไว้ที่ 1 ชั่วโมง และค่าสูงสุดนี้ไม่ได้จำกัด session ที่ AWS service assume เอง
- **`AssumeRoleWithWebIdentity`** แลก token จาก OIDC provider ที่ลงทะเบียนไว้ใน IAM เป็น credential ของ role ส่วน **`AssumeRoleWithSAML`** ทำแบบเดียวกันด้วย SAML assertion โดยที่ trust policy จะเช็ก claim ใน token เช่น audience และ subject
- **Session policy และ session tag** ผู้เรียกส่ง session policy และ managed policy ARN ได้ถึง 10 ตัว รวมกันไม่เกิน 2,048 ตัวอักษร เพื่อบีบ session หนึ่งให้แคบลง และส่ง tag ที่ ABAC policy เอาไปเช็กได้ ทั้งสองอย่างทำให้ session token ใหญ่ขึ้น
- **External ID** vendor ที่ assume role ใน account ของลูกค้าจะให้ external ID ที่ไม่ซ้ำกับลูกค้าแต่ละราย แล้ว trust policy ของลูกค้าก็บังคับให้ต้องมีด้วย condition key `sts:ExternalId` วิธีนี้กันปัญหา confused deputy: ลูกค้าอีกรายของ vendor เดียวกันจะหลอกให้ vendor ไปทำอะไรกับ account ของเราไม่ได้ AWS ไม่ได้ถือว่า external ID เป็นความลับ ส่วนตอนที่ AWS service principal ทำงานแทนเรา การป้องกันแบบเดียวกันก็มาจาก condition `aws:SourceArn`, `aws:SourceAccount` หรือ `aws:SourceOrgID` ใน resource-based policy
- **การเพิกถอน** credential แบบชั่วคราวใช้ได้จนกว่าจะหมดอายุ ถ้าจะตัด session ของ role ก่อนเวลา ปุ่ม *Revoke active sessions* ใน IAM console จะ attach inline policy ชื่อ `AWSRevokeOlderSessions` ที่ปฏิเสธทุกอย่างให้ session ที่ออกก่อนเวลานั้น

### Attribute-based access control

ถ้ามี role หนึ่งตัวต่องานหนึ่งอย่าง (role-based access control) จำนวน role และ policy จะโตขึ้นทุกครั้งที่มีทีมหรือโปรเจกต์ใหม่ ส่วน attribute-based access control (ABAC) จะเขียน statement ที่น้อยกว่าและกว้างกว่า โดยเทียบ tag กัน เช่นยอมให้ทำ action ก็ต่อเมื่อ `aws:ResourceTag/project` ของ resource เท่ากับ `aws:PrincipalTag/project` ของผู้เรียก ส่วน session tag จาก identity provider ก็พาโปรเจกต์หรือ cost centre ของคนคนหนึ่งเข้ามาใน session ได้ ตัว resource ใหม่จะถูกครอบคลุมโดยไม่ต้องแก้ policy แต่ก็ต่อเมื่อ tag ยังเชื่อถือได้เท่านั้น: เรื่องที่ว่าใครตั้งหรือแก้ tag ได้ (`aws:RequestTag`, `aws:TagKeys`) ต้องดูแลให้ดีพอ ๆ กับตัว policy เอง

### Audit และบีบสิทธิ์ให้แคบ: CloudTrail และ IAM Access Analyzer

**AWS CloudTrail** บันทึก API call พร้อม identity ที่เป็นคนเรียก ละเอียดลงไปถึงแต่ละ role session ตัว event history ของมันเก็บ management event ไว้ 90 วันและดูได้ฟรี ส่วน trail เก็บ event ไว้ใน S3 ได้นานกว่านั้น และ data event อย่างการอ่านและเขียน object ใน S3 จะถูกบันทึกก็ต่อเมื่อเราเปิดไว้ โดยคิดเงินเพิ่ม

**IAM Access Analyzer** เปลี่ยนบันทึกนั้นให้เป็น least privilege ในแอปรูปภาพ ตัว `gha-deploy` เริ่มต้นด้วย AWS managed policy `AWSLambda_FullAccess` พอผ่านไป 90 วัน ตัว unused-access finding ก็แสดงว่าส่วนใหญ่ไม่ได้ถูกใช้ แล้ว policy generation ก็ร่าง policy ตัวใหม่มาแทนจาก call ที่ pipeline เรียกจริง เช่น `lambda:UpdateFunctionCode` แล้วเราก็เติม ARN ของ function เข้าไป ส่วน feature ต่าง ๆ มีดังนี้:

- **Policy generation** (ไม่มีค่าใช้จ่ายเพิ่ม) อ่าน activity ใน CloudTrail ของ role หรือ user หนึ่งตัวย้อนหลังได้ถึง 90 วัน แล้วร่าง policy จากตรงนั้น สำหรับ service ที่มันรองรับ มันจะ list action เป็นตัว ๆ ส่วน service อื่นมันจะใส่แค่ชื่อ service และมันมองไม่เห็น action ที่อยู่หลัง data event อย่าง S3 `GetObject` และไม่เคยใส่ `iam:PassRole` เพราะ CloudTrail ไม่ได้ track ตัวนี้
- **Unused access finding** (คิดเงินตามจำนวน IAM role หรือ user ที่ถูกวิเคราะห์ในแต่ละเดือน) รายงาน role ที่ไม่ได้ใช้, access key และ password ที่ไม่ได้ใช้ และ service กับ action ที่ role และ user ที่ active อยู่ไม่ได้ใช้ในช่วงเวลาที่เราเลือกให้ติดตาม ตั้งแต่ 1 ถึง 365 วัน
- **External access finding** (ไม่มีค่าใช้จ่ายเพิ่ม) รายงาน resource ที่ถูกแชร์ออกไปนอก account หรือ organization ของเรา ส่วน **internal access finding** (คิดเงิน) แสดงว่า role และ user ตัวไหนข้างในเข้าถึง resource ที่เรามาร์กไว้ว่าสำคัญได้บ้าง
- **Policy validation** (ไม่มีค่าใช้จ่ายเพิ่ม) เช็กไวยากรณ์และ best practice ระหว่างที่เราเขียน policy ส่วน **custom policy check** (คิดเงินต่อครั้งที่เช็ก) อย่าง `CheckNoNewAccess` และ `CheckAccessNotGranted` ใช้ automated reasoning หยุดการแก้ policy ใน pipeline ไว้ก่อนที่มันจะให้สิทธิ์ใหม่

## อยู่ตรงไหนใน solution

- **Solution** ทุก solution บน AWS เพราะทุก API call ต้องผ่านมัน คำถามเชิง design คือ identity มาจากไหน (Identity Center สำหรับคน, role สำหรับ workload, OIDC สำหรับ CI และ platform อื่น, cross-account role ระหว่าง account และสำหรับ vendor) จะแบ่งสิทธิ์ยังไง (role หนึ่งตัวต่อ workload, ABAC สำหรับ resource ที่คล้ายกันจำนวนมาก) และ organization จะวาง guardrail อะไรไว้เหนือทุก account (SCP และ RCP)
- **Pattern ใน catalog นี้** IAM คือวิธีที่ AWS ใช้ทำ [zero trust access](../zero-trust-access/): identity และ policy ถูกเช็กทุก request ไม่ว่าจะมาจากไหน JSON policy และ evaluation engine ของมันคือระบบ [policy-based authorization](../policy-based-authorization/) ที่มีมาในตัว โดยมี ABAC เป็นแบบที่อิง attribute ส่วนเมื่อใช้คู่กับ IAM Identity Center และ OIDC provider มันก็คือ relying party ใน [federated identity](../federated-identity/) ผ่าน [SAML 2.0](../saml-sso/) หรือ [OpenID Connect](../openid-connect/) ตัว `AssumeRoleWithWebIdentity` เป็น [token exchange](../token-exchange/) รูปแบบหนึ่ง: token จากภายนอกเข้าไป แล้ว credential อายุสั้นของอีก identity หนึ่งก็ออกมา ส่วน S3 presigned URL ก็คือ [valet key](../valet-key/) ของ AWS: URL พาสิทธิ์ของคนที่ sign มันไปด้วย และ URL ที่ sign ด้วย credential แบบชั่วคราวจะใช้ไม่ได้เมื่อ credential นั้นหมดอายุ
- **เพื่อนบ้านที่มักเจอ** AWS STS, IAM Identity Center, AWS Organizations, CloudTrail, IAM Access Analyzer, key policy ของ AWS KMS, Amazon Cognito สำหรับ user ของ application เอง และทุก service ที่มี resource-based policy เช่น [Amazon S3](../amazon-s3/), [Amazon SQS](../amazon-sqs/) และ [AWS Lambda](../aws-lambda/)
- **Managed offering** IAM เป็นส่วนหนึ่งของทุก AWS account ไม่มีอะไรต้องรัน ตัวที่เทียบได้คือ Azure RBAC คู่กับ Microsoft Entra ID และ Google Cloud IAM

## ใช้ตอนไหนดี

บน AWS ตัว IAM ไม่ใช่ของที่จะใช้หรือไม่ใช้ก็ได้ ทางเลือกคือจะใช้กลไกไหนของมัน:

- **คน:** IAM Identity Center พร้อม MFA และ federate มาจาก identity provider ของบริษัทถ้ามี ส่วน IAM user ใช้เฉพาะตรงที่เลี่ยง credential แบบอายุยาวไม่ได้ โดยต้อง rotate key และคอยเฝ้าดูมัน
- **Workload บน AWS:** role หนึ่งตัวต่อ workload ที่ service ที่รันมันเป็นคน attach ให้ และไม่มี access key อยู่ใน configuration
- **Workload ที่อื่น:** OIDC federation ในที่ที่ platform ออก token ให้ (GitHub Actions, GitLab, [Kubernetes](../kubernetes/)) และ IAM Roles Anywhere สำหรับ server ที่ถือ X.509 certificate จาก certificate authority ของเราเอง
- **หลาย account:** AWS Organizations ที่มี SCP และ RCP เป็น guardrail, Identity Center สำหรับคน และ cross-account role ระหว่าง workload
- **User ของ application เรา:** ไม่ใช่ IAM แต่ให้ Amazon Cognito หรือ OpenID Connect provider ตัวอื่นเป็นคน sign in ให้พวกเขา และ Cognito identity pool ก็ map พวกเขาเข้ากับ role ได้ตอนที่ต้องเรียก AWS ตรง ๆ

เทียบกับ cloud ใหญ่อีกสองเจ้า (ตุลาคม 2026):

| | AWS IAM | Azure RBAC กับ Microsoft Entra ID | Google Cloud IAM |
|---|---|---|---|
| คน | IAM Identity Center (directory ของตัวเองหรือ SAML 2.0 federation) | user และ group ของ Microsoft Entra ID | Google account และ group, Cloud Identity, Workforce Identity Federation |
| Workload | role: Lambda execution role, ECS task role, EC2 instance profile | managed identity และ service principal | service account |
| เขียนสิทธิ์เป็น | JSON policy บน identity และบน resource | role definition ที่ assign ให้ principal ที่ scope หนึ่ง | role ที่ grant ให้ principal ใน allow policy บน resource |
| ลำดับชั้น | account ใน OU ของ organization โดยมี SCP และ RCP เป็นเพดาน | management group → subscription → resource group → resource แบบสืบทอด | organization → folder → project → resource แบบสืบทอด |
| Deny | `Deny` แบบ explicit ใน policy ไหนก็ได้ บวก boundary, SCP และ RCP | deny assignment ที่ Azure เป็นคนสร้าง (เช่นผ่าน deployment stack) เราสร้างเองตรง ๆ ไม่ได้ | deny policy ที่ถูกเช็กก่อน allow policy |
| CI โดยไม่เก็บ key | OIDC provider และ `AssumeRoleWithWebIdentity` | workload identity federation เช่นจาก GitHub Actions | Workload Identity Federation (GitHub, GitLab, OIDC หรือ SAML 2.0 provider ตัวไหนก็ได้) |
| ถ้าไม่มี grant | implicit deny (ยกเว้น root user) | ไม่มีสิทธิ์ ส่วน role assignment บวกเพิ่มกันได้ | ไม่มีสิทธิ์ ส่วน role binding บวกเพิ่มกัน และ deny policy หักออก |

## ได้อะไร เสียอะไร

- **ละเอียด แต่อ่านยาก** policy หกแบบมีส่วนร่วมในการตัดสินใจครั้งเดียวได้ และการที่มันทำงานซ้อนกัน เช่น resource-based policy ที่ระบุชื่อ role session แทนที่จะเป็น role ก็ทำให้ engineer ที่มีประสบการณ์ยังงงได้ ข้อความ 403 แบบละเอียดของ S3, policy simulator และ Access Analyzer ช่วยได้ ส่วน simulator ประเมิน identity-based policy และ SCP ได้ แต่ไม่ประเมิน RCP และ simulate resource-based policy ของ role ไม่ได้
- **Least privilege ต้องทำหลายรอบ** ไม่มีใครรู้ทุก action ที่ function จะเรียกก่อนที่มันจะรัน ตัว AWS managed policy ก็กว้าง และ policy ที่ generate มาก็ต้อง review และใส่ ARN ของ resource จริง ให้เริ่มจากแคบแล้วค่อยขยายเมื่อมีหลักฐาน เพราะการบีบ policy ที่กว้างให้แคบลงทีหลัง แปลว่าต้องพิสูจน์ให้ได้ว่าไม่มีอะไรยังต้องใช้สิ่งที่เราจะเอาออก
- **Eventual consistency** IAM replicate การเปลี่ยนแปลงระหว่าง server และ Region และ cache มันไว้ ทำให้ role ใหม่หรือ policy ที่แก้แล้วต้องใช้เวลากว่าจะมีผลทุกที่ คำแนะนำของ AWS คือ อย่าเอาการแก้ IAM ไว้ใน code path ที่สำคัญและต้อง high availability ให้ทำในขั้น setup หรือ deploy และยืนยันให้ได้ว่ามันกระจายไปถึงแล้วก่อนที่ production จะพึ่งมัน
- **Quota** (ตุลาคม 2026): managed policy หนึ่งได้ 6,144 ตัวอักษร และ inline policy ทั้งหมดของ role หนึ่งรวมกันได้ 10,240 (ไม่นับ whitespace), trust policy หนึ่งได้ 2,048 ตัวอักษรเป็นค่าตั้งต้น ขอเพิ่มได้ถึง 8,192, managed policy 20 ตัวต่อ role เป็นค่าตั้งต้น สูงสุด 25, role 1,000 ตัวต่อ account เป็นค่าตั้งต้น สูงสุด 10,000 ส่วนใน AWS Organizations ตัว SCP หนึ่งได้ 10,240 ตัวอักษร และ RCP ได้ 5,120 และ root, OU หรือ account แต่ละตัวรับ SCP ได้ไม่เกิน 10 ตัว และ RCP ไม่เกิน 5 ตัว
- **เรียก credential คืนทีละชุดไม่ได้** session ที่รั่วจะใช้ได้จนกว่าจะหมดอายุ ยกเว้นเราจะ revoke session เก่าทั้งหมดของ role นั้น ส่วน access key ที่รั่วก็ใช้ได้จนกว่าจะมีคน deactivate หรือลบ
- **ค่าใช้จ่าย** IAM, Identity Center และ STS ฟรี ส่วนที่คิดเงินคือ data event ของ CloudTrail, management event ชุดที่ copy เพิ่มนอกจากชุดแรกที่ฟรี และ feature unused-access, internal-access และ custom check ของ Access Analyzer
- **ใช้ได้แค่กับ AWS** ARN, action และ condition key ย้ายไป cloud อื่นไม่ได้ บริษัทที่ใช้หลาย cloud มักมี identity provider ตัวเดียว แล้ว map group ของมันเข้ากับ role ของแต่ละ cloud

## ข้อควรรู้ตอนลงมือทำ

**Execution role** ตัว trust policy ยอมให้ Lambda service assume role นี้ ส่วน permissions policy ครอบคลุมสอง prefix พอดี และ AWS managed policy `AWSLambdaBasicExecutionRole` ก็เพิ่มสิทธิ์ [CloudWatch](../amazon-cloudwatch/) Logs ที่ทุก function ต้องมี:

```sh
aws iam create-role --role-name thumbnailer-role \
  --assume-role-policy-document file://trust.json
aws iam put-role-policy --role-name thumbnailer-role \
  --policy-name photos-prod-access --policy-document file://photos.json
aws iam attach-role-policy --role-name thumbnailer-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```

`trust.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "lambda.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
```

`photos.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "ReadOriginals", "Effect": "Allow", "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::photos-prod/u/*" },
    { "Sid": "WriteThumbnails", "Effect": "Allow", "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::photos-prod/thumbnails/*" }
  ]
}
```

**Bucket policy** ปฏิเสธ HTTP ธรรมดาสำหรับผู้เรียกทุกคน รวมถึง role นี้ด้วย:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "RestrictToTLSRequestsOnly",
    "Effect": "Deny",
    "Principal": "*",
    "Action": "s3:*",
    "Resource": ["arn:aws:s3:::photos-prod", "arn:aws:s3:::photos-prod/*"],
    "Condition": { "Bool": { "aws:SecureTransport": "false" } }
  }]
}
```

**GitHub Actions โดยไม่มี key** ลงทะเบียน `https://token.actions.githubusercontent.com` ใน IAM เป็น OIDC provider ที่มี audience `sts.amazonaws.com` แล้วตรึง trust policy ของ `gha-deploy` ไว้กับ repository และ branch เดียวผ่าน claim `sub` ส่วน account ID และชื่อ repository เป็นแค่ตัวอย่าง:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:photo-co/photo-app:ref:refs/heads/main"
      }
    }
  }]
}
```

workflow ขอ token จาก GitHub ด้วย `permissions: id-token: write` แล้วส่ง ARN ของ role เป็น `role-to-assume` ให้ action `aws-actions/configure-aws-credentials` ที่เป็นคนเรียก STS ถ้า trust policy ที่สร้างใหม่หรือแก้สำหรับ shared provider ของ GitHub ไม่เช็ก `sub` ตัว IAM จะปฏิเสธมัน และถ้า pattern ตรงนั้นหลวมไป เช่น `repo:photo-co/*` ก็ยังทำให้ workflow ใน repository อื่น assume role นี้ได้

**ทดสอบก่อน deploy** policy simulator ประเมิน identity-based policy ของ role (และ SCP ที่อยู่ใน scope) เทียบกับ action และ resource โดยไม่ต้องเรียกจริง:

```sh
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::111122223333:role/thumbnailer-role \
  --action-names s3:GetObject s3:DeleteObject \
  --resource-arns arn:aws:s3:::photos-prod/u/9f3c/IMG_0042.jpg \
  --query 'EvaluationResults[].[EvalActionName,EvalDecision]' --output text
```

```text
s3:GetObject	allowed
s3:DeleteObject	implicitDeny
```

**นิสัยที่ช่วยให้ดูแลมันไหว:**

- สร้าง role และ policy ตอน deploy อย่าสร้างใน request path เพราะเรื่อง eventual consistency
- บีบให้แคบด้วย condition: `aws:SecureTransport` แบบข้างบน, `aws:PrincipalOrgID` เพื่อให้ bucket อยู่ภายใน organization, `aws:SourceArn` หรือ `aws:SourceAccount` ทุกที่ที่ resource-based policy เชื่อ AWS service principal
- ให้ permissions boundary กับ pipeline ของทีมเมื่อมันสร้าง role ได้ เพื่อให้ role ที่มันสร้างไม่เกิน boundary
- ให้คนใช้ permission set ของ Identity Center ที่ session สั้น และเก็บ root user ไว้สำหรับงานที่ต้องใช้ root เท่านั้น พร้อม MFA หรือรวม root access ไว้ที่ศูนย์กลางทั้ง organization
- review unused-access finding เป็นประจำ และลบสิ่งที่ไม่มีใครใช้ทิ้ง
