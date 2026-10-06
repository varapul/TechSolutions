## ปัญหา

Authentication กับ authorization ตอบคำถามคนละข้อ **Authentication** ยืนยันว่าใครเป็นคนเรียก: ผู้ใช้เข้าสู่ระบบที่ identity provider แล้วแอปก็ได้หลักฐานมาใน token หรือ assertion ([OpenID Connect](../openid-connect/), [SAML 2.0 Single Sign-On](../saml-sso/)) ส่วน **Authorization** ตัดสินว่าคนที่เรียกมาทำอะไรได้บ้าง และ protocol สำหรับเข้าสู่ระบบก็ปล่อยเรื่องนี้ให้แอปจัดการเอง ทุก service เลยเขียนการเช็กของตัวเอง ส่วนใหญ่เป็น `if` statement ใน handler แล้วผลที่ได้ก็หน้าตาแบบ step 1:

- **แต่ละสำเนาค่อย ๆ เพี้ยนไปคนละทาง** Expenses API ให้ manager อนุมัติได้ถึง $5,000 ตัว Reports เขียนขึ้นตอนที่วงเงินยังเป็น $2,000 ส่วน Payouts ไม่เคยมีวงเงินเลย แต่ละสำเนาถูกต้องในตอนที่มีคนเขียนมัน ส่วน broken access control ที่รวมถึงการเช็กที่หายไปและการเช็กที่ไม่ตรงกัน อยู่อันดับหนึ่งของ OWASP Top 10:2025
- **การเปลี่ยนกฎกลายเป็นขบวน release** การขึ้นวงเงินหมายถึงต้องตามหาทุกสำเนาในสาม codebase สามภาษา แล้วแก้ ทดสอบ และ redeploy ทีละ service แล้วก็ได้แต่หวังว่าจะไม่มีตัวไหนตกหล่น
- **ไม่มีใครบอกได้ว่าใครทำอะไรได้บ้าง** auditor ที่ถามว่าใครอนุมัติค่าใช้จ่าย $4,000 ของ Sales ได้บ้าง จะได้คำตอบก็ต่อเมื่อมีคนไล่อ่านครบทั้งสาม codebase แล้ว และไม่มีอะไรบันทึกไว้เลยว่ามีการตัดสินอะไรไปบ้าง หรือตัดสินแบบนั้นเพราะอะไร

role และ scope ใน token ไม่ได้ปิดช่องนี้ token บอกได้ว่าคนที่เรียกเป็น manager หรือบอกว่า client เรียก `expenses:approve` ได้ และ [JWT Validation](../jwt-validation/) ก็เช็ก claim **แบบหยาบ** พวกนี้ในทุก request แต่ Ana จะอนุมัติค่าใช้จ่าย *รายการนี้* ได้หรือไม่ ขึ้นอยู่กับตัวรายการ: ใครเป็นคนส่ง อยู่แผนกไหน และมียอดเท่าไร การตัดสิน **แบบละเอียด** ราย object แบบนี้ต้องใช้ข้อมูลที่ token ไม่ได้พกมา และนี่คือการตัดสินที่ pattern นี้ดึงออกมาจากโค้ด

## ทำงานยังไง

### สี่ส่วน

งานนี้ถูกแบ่งเป็นสี่ส่วน ชื่อมาจาก XACML 3.0 ที่เป็น OASIS Standard ตั้งแต่มกราคม 2013 และ NIST SP 800-162 ที่เป็นคู่มือ attribute-based access control (2014 อัปเดตล่าสุดปี 2019) ก็อธิบายสี่ส่วนเดียวกันนี้:

| ส่วน | ทำอะไร | ใน diagram |
|---|---|---|
| **PEP**, policy enforcement point | อยู่บนเส้นทางของ request: อธิบาย request ให้ PDP ฟัง รอคำตอบ แล้วบังคับใช้ตามนั้น | middleware หรือการเรียก SDK ที่อยู่หน้าทุก operation ของ Expenses API |
| **PDP**, policy decision point | ประเมิน policy ที่เกี่ยวกับ request แล้วตอบคำตัดสินกลับไป | policy engine |
| **PAP**, policy administration point | ที่ที่ policy ถูกเขียน จัดการ และทดสอบ และเป็นที่ที่ publish policy ออกไป | policy repository ใน Git ที่มี review และ test |
| **PIP**, policy information point | ส่งค่า attribute ที่ PDP ต้องใช้ให้ | directory, ข้อมูลค่าใช้จ่าย และ relationship store |

XACML เพิ่ม *context handler* ที่แปลงระหว่าง format ของ request ฝั่งแอปกับฝั่ง PDP และไปเก็บ attribute จาก PIP ต่าง ๆ มาให้ NIST มองว่ามันจะมีหรือไม่มีก็ได้ และบอกว่ามันดึงหรือ cache attribute ไว้ก่อน request จะมาก็ได้ NIST ยังเน้นด้วยว่าพวกนี้เป็น function เชิงตรรกะ: PEP กับ PDP จะเป็น service ส่วนกลางตัวเดียว หรือกระจายไปทั่วระบบก็ได้ และนี่คือทางเลือกที่ step 4 ตัดสิน

### คำถามเดียว คำตอบเดียว

PEP ถามคำถามที่มีสี่ส่วน:

- **Subject:** ใครเป็นคนถาม (`ana`) พร้อม attribute อย่าง role และแผนก
- **Action:** เขาอยากทำอะไร (`approve`)
- **Resource:** เขาอยากทำกับอะไร (`e-42`) พร้อม attribute อย่างเจ้าของ แผนก และยอดเงิน
- **Context:** อะไรก็ตามที่ policy อาจเอามาชั่งด้วย: เวลา, network, device, ผู้ใช้เข้าสู่ระบบมายังไง

PDP ตอบ *allow* หรือ *deny* และหลายครั้งก็บอกชื่อ rule ที่เป็นตัวตัดสินด้วย ฝั่ง service ไม่เคยเห็นตัว rule เห็นแค่คำตอบ ทุก service ที่ถามคำถามเดียวกันเลยได้คำตอบเดียวกัน **AuthZEN Authorization API 1.0** ของ OpenID Foundation ที่เป็น Final Specification ตั้งแต่มกราคม 2026 ทำให้การแลกเปลี่ยนนี้เป็นมาตรฐาน ในรูปของ JSON ผ่าน HTTPS:

```http
POST /access/v1/evaluation
Content-Type: application/json

{
  "subject":  { "type": "user", "id": "ana" },
  "action":   { "name": "approve" },
  "resource": { "type": "expense", "id": "e-42" },
  "context":  { "time": "2026-10-04T09:41:07Z" }
}
```

```json
{ "decision": true }
```

response ใส่ object `context` เพิ่มเพื่อบอกเหตุผลหรือ obligation ได้ spec นี้ยังกำหนด batch endpoint (`/access/v1/evaluations`), search endpoint ที่ตอบกลับเป็น subject, resource หรือ action ที่ request นั้นจะได้รับอนุญาต และ discovery metadata ที่ `/.well-known/authzen-configuration` ไว้ด้วย ทำให้ PEP ที่เขียนตาม spec นี้ทำงานกับ PDP ตัวไหนก็ได้ที่ implement มัน

### Policy as code

policy กลายเป็นไฟล์ใน repository แทนที่จะเป็น `if` statement ที่กระจายอยู่ทั่ว service นี่คือ policy ของค่าใช้จ่ายทั้งหมดที่เขียนด้วย Rego ภาษาของ Open Policy Agent (OPA):

```rego
package expenses

default allow := false

# Everyone may view their own expenses.
allow if {
	input.action == "view"
	input.resource.owner == input.subject.id
}

# A manager may approve expenses from their own department, up to $5,000.
allow if {
	input.action == "approve"
	input.subject.role == "manager"
	input.subject.department == input.resource.department
	input.resource.amount <= 5000
}

# Finance may approve any amount.
allow if {
	input.action == "approve"
	input.subject.department == "Finance"
}
```

ตอนนี้การเปลี่ยนวงเงินก็เหลือแค่ pull request บรรทัดเดียว คน review เห็นชัดเลยว่าอะไรเปลี่ยน แล้ว unit test ของ policy (`opa test`) ก็รันใน CI จากนั้น version ใหม่ (v12 ใน diagram) ก็ถูก build และส่งไปที่ PDP และทุกคำตัดสินก็บันทึก version ที่เป็นคนตัดสินไว้

### สามวิธีเขียนกฎ

**Role-based access control (RBAC)** ผูก permission ไว้กับ role แล้วให้ role กับผู้ใช้ David Ferraiolo กับ Rick Kuhn วางรูปแบบมันไว้ที่ NIST ในปี 1992 แล้วโมเดลรวมของ NIST ที่เขียนร่วมกับ Ravi Sandhu ในปี 2000 ก็กลายเป็นมาตรฐาน ANSI/INCITS 359-2004 และแก้ไขเป็น INCITS 359-2012 ส่วน reference model ของมันมีสี่ส่วน: core RBAC, role hierarchy และ separation of duty แบบ static กับแบบ dynamic ตัว RBAC ดูแลง่ายและ review ง่าย (list ดูว่าใครมี role นั้น) และเป็นจุดเริ่มต้นที่ถูกสำหรับแอปส่วนใหญ่ ข้อจำกัดของมันเห็นได้ใน step 3: role ไม่รู้อะไรเลยเกี่ยวกับรายการค่าใช้จ่าย "manager" เลยทำให้ Cara อนุมัติค่าใช้จ่ายของ Sales ได้ และทำให้ใครก็ตามที่มี role นี้อนุมัติได้ทุกจำนวน การยัดแผนกกับวงเงินเข้าไปในชื่อ role (`sales-manager-5k`) จะนำไปสู่สิ่งที่มักเรียกกันว่า *role explosion* และนี่ก็เป็นหนึ่งในเหตุผลที่ NIST SP 800-162 ยกมาสนับสนุน ABAC

**Attribute-based access control (ABAC)** ตามนิยามของ NIST SP 800-162 ตัดสินจาก attribute ของ subject, attribute ของ object, เงื่อนไขของ environment และ policy ที่เขียนด้วยสิ่งเหล่านั้น กฎข้อเดียว ("manager อนุมัติค่าใช้จ่ายของแผนกตัวเองได้ ไม่เกิน $5,000") ครอบคลุมทุกแผนกและทุกยอดเงิน: Ana อนุมัติ e-42 ได้ แต่อนุมัติ e-43 ที่ $7,000 ไม่ได้ และ Cara ก็อนุมัติ e-42 ไม่ได้ ส่วนกฎข้อ 3 ไม่ต้องใช้ role เลย: Dev ที่อยู่ Finance อนุมัติ e-43 ได้ ราคาที่ต้องจ่ายคือ คำตัดสินจะดีได้แค่เท่ากับ attribute ของมัน และ attribute ต้องเชื่อถือได้และเป็นปัจจุบัน และคำถาม "ใครอนุมัติ e-42 ได้บ้าง" ก็ไม่ใช่การ lookup อีกต่อไป: ต้องประเมิน policy กับ attribute ของทุกคน

**Relationship-based access control (ReBAC)** หา permission จาก relationship ระหว่าง object: Ana เป็นหัวหน้าของ Bo และ Bo เป็นเจ้าของ e-42 ทำให้ Ana อนุมัติ e-42 ได้ ตัว relationship ถูกเก็บเป็น tuple และการเช็กก็คือการเดินไปตาม graph ที่ tuple พวกนั้นสร้างขึ้น Google อธิบายระบบของตัวเองสำหรับงานนี้ไว้ใน paper **Zanzibar** (Pang et al., USENIX ATC 2019): authorization service ตัวเดียวที่อยู่เบื้องหลัง Calendar, Cloud, Drive, Maps, Photos, YouTube และ product อื่นอีกมาก มันเก็บ relation tuple มากกว่าสองล้านล้านตัว รับการเช็กได้หลายล้านครั้งต่อวินาที โดยมี latency ที่ percentile 95 ต่ำกว่า 10 ms และรักษา availability ไว้เกิน 99.999% ตลอดสามปี ส่วน tuple ของมันเขียนในรูป `object#relation@user` ข้อเท็จจริงสองข้อใน diagram เลยเป็น `expense:e-42#owner@user:bo` และ `user:bo#manager@user:ana` (ใน diagram เขียนแบบย่อ) ReBAC เหมาะกับการแชร์และโครงสร้างแบบลำดับชั้น อย่าง folder, project, ทีม และองค์กร ที่สิทธิ์เข้าถึงไหลไปตามโครงสร้าง ในภาษาสำหรับเขียนโมเดลของ OpenFGA กฎการอนุมัติเหลือบรรทัดเดียวคือ `approver: manager from owner`:

```
model
  schema 1.1

type user
  relations
    define manager: [user]

type expense
  relations
    define owner: [user]
    define approver: manager from owner
    define viewer: owner or approver
```

ความ consistent คือส่วนที่ยากของ relationship store และ paper ของ Zanzibar เรียกความล้มเหลวนี้ว่า **ปัญหา "new enemy"** สมมติว่า Alice เอา Bob ออกจาก folder หนึ่ง แล้วค่อยให้ย้ายเอกสารใหม่เข้าไปใน folder นั้น การเช็กที่เห็นการเปลี่ยนครั้งที่สองแต่ไม่เห็นครั้งแรกจะปล่อยให้ Bob อ่านเอกสารที่ไม่ได้ตั้งใจให้เขาเห็นเลย Zanzibar เก็บ tuple ไว้ใน Spanner ที่นาฬิกา TrueTime ของมันให้ timestamp กับทุกการเขียนโดยเคารพลำดับเหตุและผล และประเมินการเช็กแต่ละครั้งที่ snapshot เดียว พอแอปบันทึก content ใหม่ มันจะขอ **zookie** มา zookie คือ token ที่อ่านความหมายไม่ออกและ encode timestamp ไว้ แอปเก็บมันไว้คู่กับ content และส่งมันไปกับการเช็กครั้งหลัง ๆ การเช็กพวกนั้นเลยถูกประเมินกับข้อมูลที่ใหม่อย่างน้อยเท่านั้น SpiceDB เรียก token แบบเดียวกันนี้ว่า ZedToken และให้แต่ละ request เลือกได้ระหว่างความเร็ว (`minimize_latency`) กับความสดใหม่ (`at_least_as_fresh`, `at_exact_snapshot`, `fully_consistent`)

โมเดลพวกนี้ใช้ร่วมกันได้: role เป็นแค่ attribute อีกตัวหนึ่งสำหรับ ABAC policy ส่วนโมเดลแบบ relationship ก็แสดง role เป็น relationship (เป็นสมาชิกของ group) แล้ว OpenFGA ก็เพิ่ม *condition* และ SpiceDB เพิ่ม *caveat* (expression ของ CEL ที่ทำงานกับ attribute) ให้การเช็ก relationship ส่วน Cedar ก็ออกแบบมาให้ครอบคลุมทั้งสามแบบ

### Engine และภาษา

ณ เดือนตุลาคม 2026:

- **Open Policy Agent (OPA)** เป็น engine อเนกประสงค์ที่มีภาษาของตัวเองคือ Rego และถูกใช้ไกลเกินกว่าแค่ในแอป เช่น ใช้ทำ admission control ของ Kubernetes มันรันเป็น daemon หรือ sidecar หลัง REST API, ฝังในโปรแกรม Go เป็น library หรือ compile policy เป็น WebAssembly ก็ได้ ตั้งแต่ OPA 1.0 (ธันวาคม 2024) ตัว Rego บังคับให้ใส่ keyword `if` หน้า body ของ rule ตัว OPA เป็น graduated project ของ CNCF ตั้งแต่มกราคม 2021 ในเดือนสิงหาคม 2025 ผู้สร้างมันกับ engineer หลายคนจาก Styra บริษัทที่เคยหนุนหลังมัน ได้ย้ายไปอยู่กับ Apple ส่วน governance และ licence ของ project ไม่ได้เปลี่ยน และเครื่องมือของ Styra อย่าง OPA Control Plane และ linter ชื่อ Regal ก็ย้ายเข้ามาอยู่ใน project ของ OPA
- **Cedar** เป็นภาษาและ engine สำหรับ policy ที่สร้างขึ้นที่ AWS เขียนด้วย Rust และคุณสมบัติสำคัญของการออกแบบถูกพิสูจน์ไว้ใน Lean proof assistant ตัว policy จะ `permit` หรือ `forbid` อย่างใดอย่างหนึ่ง: ไม่มีอะไรได้รับอนุญาตถ้าไม่มี `permit` ที่ match และ `forbid` ตัวไหนที่ match ก็ชนะเสมอ แล้วคำตอบก็จะบอกรายชื่อ policy ที่เป็นตัวตัดสิน ส่วน schema ก็ทำให้ validate policy ได้ก่อน deploy แล้ว Cedar ก็เข้า CNCF Sandbox ในเดือนตุลาคม 2025 ส่วน **Amazon Verified Permissions** เป็น PDP ของ Cedar แบบ managed: `IsAuthorized` ประเมิน request และ `IsAuthorizedWithToken` ดึง principal มาจาก ID token หรือ access token ที่ออกโดย identity source ของ policy store ได้ตรง ๆ จะเป็น Amazon Cognito user pool หรือ OpenID Connect provider ตัวอื่นก็ได้ และทั้งสองตัวก็มีเวอร์ชัน batch ด้วย นี่คือกฎการอนุมัติที่เขียนด้วย Cedar:

  ```cedar
  permit (
    principal,
    action == Action::"approve",
    resource
  )
  when
  {
    principal.role == "manager" &&
    principal.department == resource.department &&
    resource.amount <= 5000
  };
  ```

- **OpenFGA** เป็น relationship store ที่ได้แรงบันดาลใจจาก Zanzibar และเป็น incubating project ของ CNCF ตั้งแต่ตุลาคม 2025 มันตอบ `Check`, `BatchCheck`, `ListObjects` และ `ListUsers`
- **SpiceDB** ที่เป็น open source (Apache 2.0) จาก AuthZed เป็น database ที่ทำตามแบบ Zanzibar อย่างใกล้ชิด มี `CheckPermission`, `LookupResources` และ `LookupSubjects`
- **Casbin** เป็น library ไม่ใช่ service แล้วไฟล์ config เล็ก ๆ ที่สร้างบน PERM metamodel ของมัน (policy, effect, request, matchers) จะเลือกว่าใช้ ACL, RBAC, ABAC หรือผสมกัน และ policy ก็อยู่ในไฟล์หรือใน database ตัว library ภาษา Go เข้า Apache Incubator ในเดือนกุมภาพันธ์ 2026 และมี port สำหรับ Java, Node.js, PHP, Python, .NET, C++ และ Rust

## ใช้ตอนไหนดี

- มีหลาย service หลายทีม หรือหลายภาษา ที่บังคับใช้ business rule ชุดเดียวกัน และต้องตัดสินให้ตรงกัน
- คำตัดสินขึ้นอยู่กับ object (เจ้าของ แผนก ยอดเงิน แชร์ให้ใครบ้าง) ไม่ใช่แค่ role ใน token
- กฎเปลี่ยนบ่อยกว่า service ที่บังคับใช้มัน หรือกฎเป็นของคนอื่นที่ไม่ใช่ทีม service: ทีม security, compliance หรือ product owner
- auditor หรือลูกค้าถามว่าใครทำอะไรได้บ้าง และทำไม request หนึ่ง ๆ ถึงได้รับอนุญาต
- ผู้ใช้แชร์ของให้กันและกัน (เอกสาร, project, workspace) นั่นคือโมเดลแบบ relationship และ ReBAC store ก็เดินตาม graph ให้คุณ

**ตอนไหนไม่ควรใช้** service ตัวเดียวที่มี role ไม่กี่ตัวไม่ต้องใช้ policy engine ให้เก็บการเช็กไว้ในโค้ดไปเลย แต่ให้อยู่ในที่เดียว: authorization module ตัวเดียวที่ทุก handler เรียก ที่ deny เป็น default และมี test ของตัวเอง module นั้นก็คือ PEP กับ PDP ขนาดย่อม และทีหลังก็ชี้มันไปที่ PDP ตัวจริงได้โดยไม่ต้องแตะ handler เลย

## ได้อะไร เสียอะไร

- **Dependency ในทุก request** ถ้า PEP ไม่ได้คำตอบ ตัว operation ก็ล้มเหลว ตามที่ออกแบบไว้ แล้ว PDP ก็ต้องพร้อมใช้งานเท่ากับ service ที่สำคัญที่สุดที่เรียกมัน การรันมันข้าง ๆ แต่ละ service (step 4) เอา network ออกจากเส้นทางได้ แต่ไม่ได้เอา dependency ออก
- **Latency** PDP ส่วนกลางเพิ่ม network round trip ให้ทุกการเช็ก และหน้าที่ต้องเช็กหลายอย่างก็จ่ายค่านี้หลายรอบ ส่วน engine ที่อยู่ในเครื่องเร็วกว่ามาก: เอกสารของ OPA ถือว่าราวหนึ่งมิลลิวินาทีคืองบสำหรับ API authorization และ benchmark ใน paper ของ Cedar วัดค่ามัธยฐานของการประเมินได้ 4 ถึง 11 µs สำหรับ Cedar และราว 76 ถึง 750 µs สำหรับ Rego กับ OpenFGA โดยส่วนหางเกินหนึ่งมิลลิวินาทีเมื่อข้อมูลโตขึ้น ให้วัดด้วย policy และข้อมูลของคุณเอง
- **ความสดใหม่ของข้อมูล** PDP ในเครื่องตัดสินจากสำเนาของ policy และข้อมูลที่มันถืออยู่ พอ Ana เลิกเป็นหัวหน้าของ Bo หรือรายการค่าใช้จ่ายย้ายไปอยู่แผนกอื่น คำตัดสินก็จะเปลี่ยนตอนที่ข้อมูลใหม่มาถึงเท่านั้น นี่คือการแลกระหว่าง attribute ที่ cache ไว้กับ security ที่ NIST SP 800-162 อธิบายไว้ ส่วน attribute ที่เอามาจาก token ก็จะคงค่าเดิมไว้จนกว่า token จะหมดอายุ
- **ข้อเท็จจริงเดียวกันอยู่สองที่** relationship store และ data bundle ก็อปสิ่งที่แอปรู้อยู่แล้ว (ใครเป็นเจ้าของ e-42) และต้องทำให้สำเนาตรงกันตลอด ปกติจะเขียน tuple ใน workflow เดียวกับข้อมูลของแอป หรือ stream การเปลี่ยนแปลงของแอปออกมา
- **มีภาษาใหม่ให้เรียน** Rego, Cedar และโมเดลแบบ relationship ตัวเล็กก็จริง แต่มันคือโค้ด: ต้องมี test, review และคนที่อ่านมันออกตอนเกิด incident
- **"ใครทำอะไรได้บ้าง" ยังต้องออกแรง** ถ้าเป็น ABAC คำถามนี้หมายถึงต้องประเมิน policy กับ subject จำนวนมาก ส่วน relationship store ตอบได้ตรง ๆ (`ListUsers`, `LookupSubjects`) นี่คือเหตุผลหนึ่งที่ product ต่าง ๆ ใช้หลายโมเดลร่วมกัน

## ข้อควรรู้ตอนลงมือทำ

- **PDP รันที่ไหน**
  - *Service ส่วนกลาง:* deployment เดียวให้อัปเดตและเฝ้าดู แต่ทุกการเช็กต้องมี network hop และทุกคนที่เรียกก็พึ่ง dependency ตัวเดียวกัน PDP แบบ managed อย่าง Amazon Verified Permissions ทำงานแบบนี้
  - *Sidecar หรือ host daemon:* engine รันอยู่ข้าง service แต่ละตัวและถูกเรียกผ่าน localhost (ดู [Sidecar](../sidecar/)) ขณะที่ control plane กระจาย policy และข้อมูลออกไป ตัว OPA จะ poll bundle server (รองรับ long polling) ตรวจ bundle ที่ sign แล้วได้ เก็บ bundle ล่าสุดไว้บน disk ได้ จะได้ start ได้แม้ server ล่ม และ health endpoint ของมันที่ใช้ option `bundles` จะรายงานว่า healthy ก็ต่อเมื่อโหลด bundle ครบทุกตัวแล้ว เลยใช้เป็น readiness probe ได้ดี ส่วน OPA Control Plane ก็ build bundle จาก Git repository และ data source แล้ว publish ไปที่ object storage
  - *Embedded library:* Cedar ใน process หรือ OPA ในรูป Go library หรือ WebAssembly module ไม่มี hop เลย แต่การอัปเกรด engine ต้องไปพร้อมกับ release ของแอป
- **attribute มาจากไหน** attribute ของ subject เดินทางมาใน token ได้: role, group หรือแผนก ในรูป claim ใน ID token หรือ access token ของ [OpenID Connect](../openid-connect/) หรือใน SAML assertion จาก identity provider (ดู [Federated Identity](../federated-identity/)) ตัว claim อ่านได้ฟรี แต่จะคงค่าที่มีตอนออก token ไว้ อย่าง Amazon Verified Permissions ก็บอกไว้ว่า token ยังใช้ได้จนกว่าจะหมดอายุแม้จะถูก revoke ไปแล้ว ส่วน attribute ของ resource ปกติมาจาก service ที่เพิ่งโหลด e-42 มา และส่งเจ้าของ แผนก และยอดเงินของมันไปใน request ได้ นอกเหนือจากนั้น PDP ก็ไป lookup เอาจาก PIP ตอนตัดสิน แบบนี้ข้อมูลสดกว่า แต่เพิ่ม latency และ dependency อีกตัว
- **List และ filter** อย่าโหลดมาพันแถวแล้วเช็กทีละแถว ให้ขอ filter หรือ list แทน:
  - *Partial evaluation* OPA ประเมิน policy โดยรู้ subject แต่ไม่รู้ resource แล้วตอบเงื่อนไขที่เหลือกลับมา สำหรับ Ana ก็คือ `department = "Sales"` และ `amount <= 5000` ตัว Compile API ของมันตอบกลับเป็น SQL `WHERE` clause หรือเป็น UCAST สำหรับ ORM ได้ ทำให้ database เป็นคน filter
  - *List query* `ListObjects` ของ OpenFGA, `LookupResources` ของ SpiceDB และ resource search ของ AuthZEN ตอบกลับเป็น object ที่ subject ทำ action ได้ ส่วน OpenFGA จำกัด `ListObjects` ไว้ที่ 1,000 ผลลัพธ์และ 3 วินาทีโดย default และสำหรับ collection ใหญ่ ๆ ก็แนะนำให้ search ก่อนแล้วเช็กทีละหน้าด้วย `BatchCheck`
- **Policy as code** เก็บ policy ไว้ใน Git คู่กับ test ของมัน (`opa test`, validator ของ Cedar ที่ใช้ schema, `fga model test`) review ทุกการเปลี่ยนแปลง แล้ว build bundle ที่มี version และ sign แล้ว ทยอย roll out ทีละขั้น และบันทึก version ไว้ในทุกคำตัดสิน จะได้อธิบายคำตอบได้ทีหลัง [GitOps](../gitops/) ที่ใช้ policy repository เป็น source of truth ให้ deployment คอย reconcile ตาม ก็เข้ากันได้อย่างเป็นธรรมชาติ
- **Decision log** log ทุกคำตัดสินพร้อม ID, input, ผลลัพธ์, rule ที่ match และ version ของ policy แล้วส่ง log ไปที่ [Centralized Logging](../centralized-logging/) ตัว decision log ของ OPA บันทึก decision ID, input, ผลลัพธ์ และ revision ของ bundle แล้วยังปิดบังหรือตัด input ที่ sensitive ทิ้งได้ก่อนออกจาก host และถูก upload เป็นชุดที่บีบอัดแล้ว พอมี input บันทึกไว้ คำถาม "ทำไมอันนี้ถึงได้รับอนุญาต" ก็มีคำตอบ และ request ที่บันทึกไว้ก็เป็น test case ที่ดีสำหรับการเปลี่ยน policy ครั้งถัดไป
- **Fail closed** ให้ถือว่า timeout, error หรือคำตอบที่ไม่รู้จักคือ *deny* อย่าง external authorization filter ของ Envoy ก็ทำแบบนี้โดย default (`failure_mode_allow` เป็น `false`) และ OWASP Authorization Cheat Sheet ก็แนะนำให้ deny เป็น default
- **Cache อย่างระวัง** ถ้า cache คำตัดสิน ตัว key ของ cache ต้องรวมทุกอย่างที่มีผลต่อคำตัดสิน รวมถึง version ของ policy ด้วย ส่วน entry ก็ควรหมดอายุเร็ว และ bundle ใหม่ควร flush มันทิ้ง การ cache input (attribute, tuple) ปกติปลอดภัยกว่าการ cache คำตอบ
- **หยาบที่ edge ละเอียดใน service** ให้ [API Gateway](../api-gateway/) ปฏิเสธ request ที่ไม่มี token ที่ valid หรือไม่มี scope ที่ถูก: ต้นทุนต่ำ และหยุด traffic แย่ ๆ ส่วนใหญ่ได้ก่อนถึง service ส่วนการตัดสินเรื่องค่าใช้จ่ายรายการหนึ่งควรอยู่ใน PEP ของ service ที่มี object อยู่ในมือ ตัว proxy ที่อยู่หน้า service (เช่น Envoy ที่เรียก OPA) เห็น method, path และ token แต่ไม่เห็นว่าใครเป็นเจ้าของ e-42
- **Zero trust ลงลึกไปอีกชั้น** [Zero Trust Access](../zero-trust-access/) ใช้การแยก PDP กับ PEP แบบเดียวกัน เพื่อตัดสินว่าผู้ใช้บน device หนึ่งจะเข้าถึงแอปได้หรือเปล่าตั้งแต่แรก ส่วน policy-based authorization เอาไอเดียนี้มาใช้ข้างในแอป กับ object และ action แต่ละตัว และทั้งสองแบบก็มักใช้ identity provider และ decision log ร่วมกัน
- **Test การปฏิเสธ** test ที่สำคัญที่สุดคือ test ที่พิสูจน์ว่า Cara อนุมัติ e-42 ไม่ได้ และ Ana อนุมัติ e-43 ไม่ได้ policy ของจริงยังเพิ่ม separation of duty ด้วย เช่น ห้ามอนุมัติค่าใช้จ่ายของตัวเอง พอ policy อยู่ในที่เดียว เรื่องนี้ก็เป็นแค่เงื่อนไขเพิ่มอีกข้อ แทนที่จะต้องแก้สาม service
