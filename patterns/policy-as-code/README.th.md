## ปัญหา

platform team ของ Acme Shop ให้ความสำคัญกับกฎสี่ข้อนี้มากกว่าข้ออื่น: container image ต้องมาจาก registry ของ Acme เท่านั้นและ pin ด้วย digest, container ต้องไม่รันเป็น root, cloud resource ทุกตัวต้องมี tag `team` และ `cost-centre` และ S3 bucket ต้องไม่เปิด public access เด็ดขาด กฎพวกนี้อยู่ในหน้า wiki ที่มี 20 ข้อ และ change advisory board (CAB) ประจำสัปดาห์ก็เป็นคนบังคับใช้: ทุก infrastructure change ต้องรอประชุมวันพฤหัส ที่ reviewer อ่าน request แล้วเทียบกับรายการด้วยตา

วิธีนี้พังสามทางพร้อมกัน อย่างแรกคือ **ช้า**: request ที่ยื่นวันจันทร์ได้ approve วันพฤหัส สามวันสำหรับ bucket เดียว อย่างที่สองคือ **ไม่สม่ำเสมอ**: ประชุมเดียวกัน reject CR-2211 เพราะขาด tag แต่ approve CR-2207 ที่ก็ไม่มี tag เหมือนกัน อย่างที่สามคือ **ยังหลุดอยู่ดี**: bucket ของ CR-2207 ชื่อ `returns-exports` เปิด public access ไว้ และไม่มีใครสังเกตจนกระทั่ง security scan ของอีกทีมไปเจอในสองเดือนต่อมา ตัว board ยังเห็นแค่สิ่งที่มีคนเอามาเสนอ ส่วน `kubectl`, Helm และการคลิกใน AWS console ไม่เคยไปถึงที่ประชุมเลย engineer เลยได้เรียนรู้ว่า security เป็นด่านที่ต้องฝ่าไปให้ได้ ไม่ใช่สิ่งที่ช่วยพวกเขา (ตัวเลขของ Acme ในหน้านี้เป็นของตัวอย่างนี้เอง ไม่ใช่ผลการวิจัย)

งานวิจัยของ DORA ก็ชี้ไปทางเดียวกัน คู่มือเรื่องการทำ change approval ให้คล่องตัวของ DORA รายงานว่าในงานวิจัย State of DevOps ปี 2019 การ approve โดยหน่วยงานภายนอกอย่าง change advisory board มาคู่กับ software delivery performance ที่ต่ำกว่า และงานวิจัยไม่พบหลักฐานว่าการ approve แบบนั้นทำให้ change failure rate ลดลง DORA แนะนำให้ใช้ peer review ภายใน development workflow ควบคู่กับ automation ที่จับ change ที่ไม่ดีได้ตั้งแต่เนิ่น ๆ

## ทำงานยังไง

**Policy as code** คือการเขียนกฎเป็นภาษาที่เครื่องประเมินได้ เก็บไว้ใน version control ทำ test และ review เหมือนโค้ดอื่น ๆ และรันมันอัตโนมัติในทุกจุดที่ change เข้ามาได้ กฎจะไม่ใช่ประโยคที่ reviewer แต่ละคนตีความเอาเองอีกต่อไป แต่กลายเป็น function: พอได้ Terraform plan หรือ Kubernetes object มา มันก็บอกว่ากฎข้อไหนถูกละเมิด ตรงไหน และแก้ยังไง

### Decision point และ enforcement point

มีสองบทบาทที่ทำให้มันทำงาน เป็นสองบทบาทเดียวกับที่ [policy-based authorization](../policy-based-authorization/) ตั้งชื่อไว้ **policy decision point** ประเมินกฎกับ input ที่มีโครงสร้าง ตัว documentation ของ Open Policy Agent (OPA) อธิบาย OPA ว่าเป็น engine อเนกประสงค์ที่แยกการตัดสินใจเรื่อง policy ออกจากการบังคับใช้ ส่วน **policy enforcement point** เป็นตัวขอคำตัดสินแล้วลงมือตามนั้น: ทำให้ build fail, ปฏิเสธ request หรือบันทึก finding ส่วน Acme ใช้สามจุด ทั้งหมดป้อนกฎมาจาก repository เดียวคือ `acme/policies`:

1. **CI ก่อน merge** ตัว Conftest ประเมิน Terraform plan ของทุก pull request (`terraform show -json` แปลง plan เป็น JSON) และ Kubernetes manifest ของมัน คำตอบมาถึงใน pull request ภายในหนึ่งนาที ตอนที่ผู้เขียนยังจำ change นั้นได้อยู่
2. **Admission ตอนที่มีอะไรถูกสร้าง** Kubernetes API server ถาม admission controller ก่อนจะเก็บ object ทำให้กฎครอบคลุม `kubectl`, การติดตั้งด้วย Helm และ operator ที่ไม่เคยผ่าน CI ด้วย ส่วน Acme รัน OPA Gatekeeper ที่เวลาปฏิเสธจะบอกชื่อ constraint ที่ไม่ผ่าน: `[no-root] container "render" runs as UID 0`
3. **Audit กับสิ่งที่รันอยู่แล้ว** audit ของ Gatekeeper ประเมิน object ที่อยู่ใน cluster อยู่แล้ว (ทุก 60 วินาทีโดย default) และลิสต์ violation ของแต่ละ constraint ส่วน AWS Config rule ก็ทำแบบเดียวกันกับ resource ใน AWS account ตัว audit เจอสิ่งที่มีอยู่ก่อนจะเขียนกฎ และอะไรก็ตามที่หลุดผ่านอีกสองจุดมาได้

แต่ละจุดปิดช่องโหว่ของจุดอื่น: CI เห็นแค่ change ที่ผ่าน CI ส่วน admission เห็นแค่ request ที่เข้ามาที่ cluster ของตัวเอง และ audit ก็เห็นปัญหาได้ก็ต่อเมื่อมันเกิดขึ้นแล้ว ส่วน AWS Control Tower ก็จัดกลุ่ม control ของตัวเองแบบเดียวกัน: control แบบ **proactive** ตรวจ resource ก่อน provision (CloudFormation hook) แบบ **preventive** หยุด action ที่ไม่อนุญาต (service control policy, resource control policy และ declarative policy) และแบบ **detective** หา resource ที่ไม่ compliant หลังเกิดขึ้นแล้ว (AWS Config rule)

engine ส่วนใหญ่ยัง **observe ก่อน block** ได้ด้วย นี่แหละที่ทำให้กฎใหม่เริ่มจากการเป็นแค่คำเตือนได้: Conftest มี rule แบบ `warn` อยู่ข้าง `deny` ส่วน constraint ของ Gatekeeper รับ `enforcementAction: dryrun`, `warn` หรือ `deny` ตัว ValidatingAdmissionPolicy ของ Kubernetes รับ validation action แบบ `Deny`, `Warn` และ `Audit` และ ValidatingPolicy ของ Kyverno ก็ใช้ field เดียวกัน (เช่น `Audit` หรือ `Deny`) ส่วน Pod Security Admission ตั้ง `enforce`, `audit` และ `warn` ได้แยกตาม namespace และ Sentinel ก็มีระดับ advisory, soft-mandatory และ hard-mandatory

**ต่างจาก policy-based authorization ยังไง** หน้านั้นพูดถึง authorization ภายใน application ตอน runtime: Ana approve ค่าใช้จ่าย e-42 ได้ไหม ตัดสินกันทุก request ส่วนหน้านี้พูดถึง guardrail บน infrastructure และ delivery: plan นี้ manifest นี้ หรือ resource ที่รันอยู่ตัวนี้ได้รับอนุญาตไหม ตัว engine ทับซ้อนกันอยู่ (OPA ใช้ได้ทั้งสองงาน) แต่ input จังหวะเวลา และเจ้าของต่างกัน application team เป็นเจ้าของกฎ authorization และประเมินมันทุก request ส่วน platform team และ security team เป็นเจ้าของ guardrail และประเมินมันกับ change และกับสิ่งที่รันอยู่

### กฎหนึ่งข้อกับ test ของมัน

กฎเรื่อง S3 ของ Acme ที่เขียนด้วย Rego ในแบบที่ Conftest รันบน plan JSON ส่วน syntax แบบนี้ที่มี `if` และ `contains` ก็กลายเป็น default ตั้งแต่ OPA 1.0 (ธันวาคม 2024):

```rego
package main

settings := ["block_public_acls", "block_public_policy", "ignore_public_acls", "restrict_public_buckets"]

deny contains msg if {
	some rc in input.resource_changes
	rc.type == "aws_s3_bucket_public_access_block"
	some s in settings
	rc.change.after[s] == false
	msg := sprintf("s3-no-public-access: %s allows public access. Keep all four settings true; share files with presigned URLs.", [rc.address])
}
```

unit test ของมัน ที่ทั้ง `opa test` และ `conftest verify` รันได้:

```rego
package main_test

import data.main

plan_with(v) := {"resource_changes": [{
	"address": "aws_s3_bucket_public_access_block.labels",
	"type": "aws_s3_bucket_public_access_block",
	"change": {"after": {
		"block_public_acls": true,
		"block_public_policy": v,
		"ignore_public_acls": true,
		"restrict_public_buckets": v,
	}},
}]}

test_public_bucket_is_denied if {
	count(main.deny) == 1 with input as plan_with(false)
}

test_private_bucket_passes if {
	count(main.deny) == 0 with input as plan_with(true)
}
```

บน plan ของ pull request #512 ตัว Conftest พิมพ์ `FAIL - plan.json - main - s3-no-public-access: aws_s3_bucket_public_access_block.labels allows public access. …` แล้วจบด้วย exit status ที่ไม่ใช่ศูนย์ ทำให้ check fail พอแก้แล้วมันก็รายงาน `3 tests, 3 passed, 0 warnings, 0 failures, 0 exceptions`

### Engine ต่าง ๆ (ตุลาคม 2026)

| Engine | รันที่ไหน | เขียนกฎด้วย | ควรรู้ |
|---|---|---|---|
| Open Policy Agent (OPA) | ที่ไหนก็ได้: `opa` CLI, server ที่มี REST API, Go library หรือ compile เป็น WebAssembly | Rego | CNCF graduated (มกราคม 2021) มี `opa test` ไว้รัน unit test ส่วนในเดือนสิงหาคม 2025 ผู้สร้าง OPA และเพื่อนร่วมงานหลายคนจาก Styra ย้ายไป Apple ส่วนตัว project ยังเป็น CNCF graduated โดย governance และ license ไม่เปลี่ยน |
| Conftest | CI และ command line บน JSON, YAML, HCL, Dockerfile และ format อื่น ๆ | Rego | เป็น project ของ OPA มี rule แบบ `deny`, `warn` และ `exception` มี `conftest verify` ไว้รัน test และมี output format สำหรับ GitHub Actions, JUnit และ SARIF |
| OPA Gatekeeper | Kubernetes admission webhook, audit และ `gator` CLI สำหรับ pipeline | Rego หรือ CEL | เป็น project ของ OPA ใช้ template คู่กับ constraint โดยแต่ละตัวเป็น `deny`, `dryrun` หรือ `warn` และยังสร้าง ValidatingAdmissionPolicy ได้ (beta ตั้งแต่ v3.20) โดย default ตัว webhook จะ fail open และปล่อยที่เหลือให้ audit |
| Kyverno | Kubernetes admission, background scan และ CLI สำหรับ pipeline | YAML กับ CEL | CNCF graduated (มีนาคม 2026) ส่วน policy type ที่ใช้ CEL (ValidatingPolicy และตัวอื่น ๆ) มาแทน ClusterPolicy ที่ deprecated ตั้งแต่ 1.19 และมี policy report และ policy exception มาให้ในตัว |
| ValidatingAdmissionPolicy | อยู่ใน Kubernetes API server เลย ไม่ต้องมี webhook | CEL | Stable ตั้งแต่ Kubernetes 1.30 มี action แบบ `Deny`, `Warn` และ `Audit` มันตัดสิน request ตอนที่เข้ามา และไม่มี background scan ของ object ที่มีอยู่แล้ว |
| Pod Security Admission | อยู่ใน Kubernetes API server | สามระดับที่กำหนดไว้ตายตัว | Stable ตั้งแต่ Kubernetes 1.25 ระดับ `restricted` บังคับให้ container รันแบบ non-root อยู่แล้ว: ใช้มันก่อนจะเขียนกฎเอง |
| HashiCorp Sentinel | อยู่ใน product ของ HashiCorp: run ของ HCP Terraform และ Terraform Enterprise, [Vault](../vault/), Consul และ Nomad | Sentinel | มีระดับ advisory, soft-mandatory และ hard-mandatory และมี `sentinel test` ส่วน HCP Terraform ก็รัน policy ของ OPA ได้ด้วย และมี policy framework แบบ native ที่ใช้ HCL ใน beta |
| Cedar | อยู่ใน application ผ่าน SDK และใน Amazon Verified Permissions | Cedar | สร้างมาเพื่อ application authorization (principal, action, resource, context) เป็น CNCF sandbox project ตั้งแต่ตุลาคม 2025 มันเป็นของ [policy-based authorization](../policy-based-authorization/) มากกว่าจะเป็น infrastructure guardrail |
| AWS Organizations SCP | ทุก AWS API call ใน member account | IAM policy JSON | กำหนดสิทธิ์สูงสุดของ IAM user และ role แต่ไม่เคยให้สิทธิ์อะไรเลย และไม่มีผลกับ management account เป็นแบบ preventive |
| AWS Config rule | resource ใน AWS account ทุกครั้งที่ configuration เปลี่ยน หรือเป็นรอบ ๆ | managed rule, Guard หรือ [Lambda](../aws-lambda/) | เป็นแบบ detective และมีโหมดประเมินแบบ proactive ส่วน managed rule อย่าง `required-tags` และ `s3-bucket-level-public-access-prohibited` ครอบคลุม check ที่ใช้กันบ่อย |

### Lifecycle ของกฎหนึ่งข้อ

1. **เขียน** จาก incident หรือ requirement จริง พร้อม message ที่บอกชื่อกฎ, resource และวิธีแก้ และมี link ไปหน้าของกฎนั้น
2. **Test** ด้วย input อย่างน้อยหนึ่งตัวที่ต้องผ่าน และหนึ่งตัวที่ต้องไม่ผ่าน (`opa test`, `conftest verify`, `gator verify`, `kyverno test` หรือ `sentinel test`) โดยให้ CI ของ policy repository เป็นคนรัน
3. **Review** เหมือนโค้ด: เปิด pull request เข้า policy repository ให้เจ้าของ approve (ที่ Acme คือ platform team และ security team) และประกาศให้ทีมที่จะโดนผลกระทบรู้
4. **Roll out ในโหมด audit หรือ warn** ให้ audit ลิสต์ว่าวันนี้มันจะ block อะไรบ้าง และส่งแต่ละ finding ไปให้ทีมที่เป็นเจ้าของ กฎ `no-root` ของ Acme เจอ pod 12 จาก 38 ตัว ใน namespace ของ 5 ทีม
5. **Enforce** เมื่อจำนวนใกล้ศูนย์แล้ว โดยให้ exception ที่มีวันหมดอายุกับที่เหลือ Acme เปลี่ยน `no-root` เป็น deny หลังผ่านไปสามสัปดาห์
6. **วัดผล**: violation ต่อกฎและต่อทีม, เวลาที่ใช้แก้ check ที่ fail, จำนวน exception ที่เปิดอยู่และอายุของมัน และกฎที่คนคอยหาทางเลี่ยงอยู่เรื่อย ๆ
7. **ปลดระวาง** เมื่อมีของที่ built in มาทำให้มันไม่จำเป็นแล้ว (ระดับ `restricted` ของ Pod Security Admission ที่ enforce ในทุก namespace ครอบคลุมเรื่อง non-root) หรือเมื่อมันไม่จับอะไรที่คุ้มจะจับอีกแล้ว ค่า default อย่างเดียวไม่พอ: bucket S3 ใหม่ block public access เป็น default ก็จริง แต่ PR #512 ก็ปิดมันได้ในสองบรรทัด

### Exception

กฎที่ไม่มีทางละเมิดได้เลยจะโดนละเมิดแบบเงียบ ๆ ด้วย label ที่เติมเองด้วยมือ หรือ namespace ที่ไม่มีใครตรวจ เลยต้องให้ exception เป็นส่วนหนึ่งของ policy: เป็น entry ในไฟล์ใน policy repository ที่เพิ่มผ่าน pull request พร้อม workload, กฎ, เจ้าของ, เหตุผล และวันหมดอายุ แล้ว engine ก็อ่านมัน: Conftest มี rule แบบ `exception` ส่วน constraint ของ Gatekeeper ก็ยกเว้น namespace ด้วย `excludedNamespaces` หรือรับรายการเป็น parameter ได้ และ Kyverno ก็มี resource PolicyException ส่วน check ที่ไม่สนใจ entry ที่หมดอายุแล้วก็ทำให้วันหมดอายุมีผลจริง:

```yaml
# exceptions.yaml in acme/policies
exceptions:
  - workload: legacy-invoicing
    rule: no-root
    owner: payments team
    reason: vendor binary needs UID 0 until the rebuild
    expires: "2026-12-31T23:59:59Z"
```

```rego
package main

# An exception counts only until its expiry date.
excepted(rule, workload) if {
	some e in data.exceptions
	e.rule == rule
	e.workload == workload
	time.now_ns() < time.parse_rfc3339_ns(e.expires)
}
```

### Compliance ด้วยหลักฐานที่เก็บไปเรื่อย ๆ

กฎที่เป็นโค้ดเปลี่ยนสิ่งที่ compliance audit ดู แทนที่จะเป็นบันทึกการประชุมและ screenshot Acme แสดงกฎแต่ละข้อพร้อม test ของมันได้ รวมถึงประวัติของทุกการเปลี่ยนแปลงที่ review แล้วใน Git ผล check ของทุก pull request การปฏิเสธตอน admission และ audit finding ตามช่วงเวลา (constraint status ของ Gatekeeper และผลการประเมินของ AWS Config) หลักฐานพวกนี้สะสมขึ้นมาเองเป็นผลพลอยได้จากการ ship ส่วน segregation of duties ก็มาจาก peer review ทั้งของโค้ดและของกฎ ที่คู่มือของ DORA บอกว่าตอบ requirement นั้นได้ แต่ policy as code ไม่ได้ทำให้ระบบ compliant ได้เอง: คนยังต้องตัดสินว่า framework ต้องการกฎข้อไหนบ้าง และ auditor ก็ยังต้องตัดสินว่ากฎพวกนั้นพอหรือยัง

## ลงมือทำจริงยังไง

1. **เริ่มจากกฎที่มีอยู่** แปลง wiki เป็นรายการ ตัดทิ้งหรือเขียนใหม่ทุกข้อที่ไม่มีใครอธิบายได้ชัด แล้วเลือกสามถึงห้าข้อที่สำคัญที่สุด Acme เริ่มจาก public bucket, image registry และ tag แล้วค่อยเพิ่ม `no-root` ทีหลัง
2. **สร้าง policy repository** ที่มีเจ้าของชัดเจน มีหน้าสั้น ๆ สำหรับแต่ละกฎ และมี CI ที่รัน test ของทุกกฎในทุก change และติด tag ให้ release เพื่อให้ CI, cluster และ audit แต่ละตัวรันเวอร์ชันที่รู้ว่าเป็นตัวไหน
3. **ใช้สิ่งที่ platform รับประกันไว้อยู่แล้ว** เปิด S3 Block Public Access ไว้ที่ระดับ account ติด label ให้ namespace สำหรับ Pod Security Admission และเขียนกฎเองเฉพาะเรื่องที่ built-in control บอกไม่ได้
4. **ตรวจใน CI ก่อน** เพราะเป็นจุดที่ feedback ถูกที่สุด ให้ประเมิน plan JSON แทนไฟล์ `.tf` เพื่อให้ module และ variable ถูก resolve แล้ว และแสดงผลในที่ที่ผู้เขียนดูอยู่ (`--output github` ของ Conftest เขียน annotation ของ GitHub Actions ให้)
5. **เพิ่ม admission control ในโหมด warn แล้วค่อย deny** ตัดสินใจว่าจะเกิดอะไรขึ้นถ้า webhook ล่ม (โดย default Gatekeeper จะ fail open และพึ่ง audit) และคุม latency ของมันให้อยู่ในระดับที่ API server รับไหว
6. **รัน audit ต่อเนื่องและส่ง finding ไปให้เจ้าของ**: ticket หนึ่งใบต่อทีมที่เป็นเจ้าของแต่ละ namespace หรือ account ไม่ใช่ report ฉบับเดียวส่งให้ platform team
7. **เพิ่ม backstop ระดับ account ไม่กี่ตัว** สำหรับ action ที่ไม่ควรมีใครทำ เช่น service control policy ที่ deny `s3:PutAccountPublicAccessBlock` ใน member account เพื่อไม่ให้ใครปิด S3 Block Public Access ของ account ได้ บวกกับ AWS Config rule ไว้ตรวจจับ
8. **จัดการ exception เป็นโค้ด** แต่ละตัวมีเจ้าของและวันหมดอายุ และ review ตัวที่ยังเปิดอยู่เป็นประจำ
9. **วัดผลลัพธ์**: เวลาตั้งแต่ check fail จนแก้เสร็จ (2 นาทีสำหรับ PR #512), สัดส่วนของ pull request ที่ fail check, ระยะเวลาที่กฎอยู่ในโหมด warn, จำนวน exception ที่เปิดอยู่และอายุของมัน และ audit finding ต่อทีม ถ้าคนต้องรอให้ใครสักคนมาจัดการ check ที่ fail อยู่เป็นประจำ ก็แปลว่าด่านกลับมาแล้ว

## อยู่ตรงไหนใน solution

- [Infrastructure as code](../infrastructure-as-code/) ทำให้ทุก change เป็น plan ที่ review ได้ ส่วน policy as code ตรวจทุก plan อัตโนมัติ โดยใช้ plan JSON เป็น input
- Admission control ของ [Kubernetes](../kubernetes/) คือ enforcement point ของทุกอย่างที่ถูกสร้างใน cluster ไม่ว่าจะมาทางไหน
- [Amazon S3](../amazon-s3/) และ [AWS IAM](../aws-iam/) มี guardrail ของตัวเอง: setting ของ Block Public Access และ service control policy ที่จำกัดเพดานว่า IAM policy ใน member account จะอนุญาตอะไรได้บ้าง
- [Supply chain security](../supply-chain-security/) ต่อยอดกฎเรื่อง image ออกไปอีก: `registry-and-digest` บอกว่า image มาจากไหน ส่วนการตรวจ provenance และ signature ตอน admission ก็แสดงว่ามันถูก build มายังไง
- [Golden paths](../golden-paths/) ทำให้ compliance เป็นค่า default: เมื่อ template ผ่านทุกกฎ ทีมส่วนใหญ่ก็ไม่เคยเจอ check ที่ fail เลย
- [Continuous delivery](../continuous-delivery/) รัน policy check เป็น stage ใน pipeline และเปลี่ยน approval ที่ยังเหลืออยู่ให้เป็นขั้นที่บันทึกไว้แทนการประชุม
- [Policy-based authorization](../policy-based-authorization/) ใช้ engine ชุดเดียวกันกับงานอีกแบบ: ตัดสิน request ของ application ตอน runtime
- [Zero trust access](../zero-trust-access/) ประเมิน access policy ทุก request และ policy นั้นก็เป็นกฎอีกชุดที่ควรเก็บไว้ใน version control พร้อม test

## ใช้ตอนไหนดี

Policy as code คุ้มเมื่อหลายทีมใช้ platform ร่วมกัน และกฎอ่านได้จาก configuration: setting ของ resource, แหล่งที่มาของ image, tag, การเปิดให้เข้าถึงผ่าน network และ encryption และคุ้มที่สุดในที่ที่ change เกิดบ่อย เพราะการ approve สามวันยิ่งแพงขึ้นทุกครั้งที่มี change ส่วนในสภาพแวดล้อมที่อยู่ใต้ regulation ก็คุ้มที่สุดเหมือนกัน เพราะหลักฐานที่มันทิ้งไว้มาแทนการเก็บหลักฐานด้วยมือ

มันมีต้นทุนมากกว่าที่ได้คืน หรือต้องปรับ เมื่อ:

- **ทีมเล็ก** ถ้ามี service แค่หนึ่งหรือสองตัว แค่ platform default, module ที่เป็น private โดย default และ pull request template ก็อาจพอแล้ว ให้เพิ่มกฎเมื่อความผิดพลาดเดิมเกิดซ้ำ
- **กฎต้องใช้วิจารณญาณ** design นี้ดีไหม ข้อมูลนี้ควรเก็บไว้หรือเปล่า threat model สรุปว่าอะไร: ไม่มีข้อไหนอ่านออกมาจาก plan ได้ ให้คนยัง review เรื่องพวกนี้ต่อไป
- **Platform บังคับใช้อยู่แล้ว** built-in control อย่าง S3 Block Public Access, Pod Security Admission และ service control policy รันได้ถูกกว่าโค้ดที่เขียนเอง
- **ระบบเก่า** ระบบ legacy อาจต้องอยู่ในโหมด warn และมี exception ไปอีกนาน ให้วางแผนรับเรื่องนี้ แทนที่จะเปลี่ยนเป็น deny ในวันที่ไม่มีใครทำทัน
- **รันมันให้เสถียรไม่ได้** admission webhook ที่ fail closed ทำให้ทุก request ที่เข้า API server ต้องพึ่งมัน จะรันมันเหมือนเป็นส่วนหนึ่งของ control plane ก็ได้ หรือเลือก fail open (ค่า default ของ Gatekeeper) แล้วพึ่ง audit เป็นตาข่ายรองรับก็ได้

## กับดักที่เจอบ่อย

- **กฎเยอะเกินไปในทีเดียว** กฎหกสิบข้อในสัปดาห์แรกทำให้ทุก build ขึ้นสีแดง แล้วทีมก็หาทางลัด เช่น deploy จาก laptop หรือ copy namespace ที่ได้รับยกเว้น ให้เริ่มจากกฎไม่กี่ข้อที่กัน incident จริงได้ รันแต่ละข้อในโหมด warn ก่อน และประกาศว่าข้อไหนจะมาเป็นลำดับถัดไป
- **กฎที่ไม่มี test** พิมพ์ผิดตัวเดียวในกฎที่ไม่ได้ test ก็ block ทุก deploy หรือปล่อยทุกอย่างผ่านได้ ให้ทุกกฎมีตัวอย่างที่ผ่านและไม่ผ่าน รันใน CI ของ policy repository และ test กับ plan และ manifest จริงด้วย
- **Error message ที่ไม่ชัด** คำว่า `violation` ไม่ได้บอกอะไรผู้เขียนเลย ให้บอกชื่อกฎ, resource, อะไรผิด และแก้ยังไง ใส่ link ไปหน้าของกฎ และแสดง message ใน pull request
- **ไม่มีกระบวนการ exception** ถ้าทางเดียวที่จะผ่านกฎได้คือไปขอใครสักคนในแชต exception ก็จะเกิดขึ้นในที่มืดและไม่มีวันจบ ให้บันทึกเป็นโค้ดที่มีเจ้าของและวันหมดอายุ และให้ audit รายงานเรื่องนี้
- **กฎเดียวกันเขียนไว้ในหลาย engine** ตัว copy ใน Conftest, Gatekeeper และ AWS Config จะค่อย ๆ เพี้ยนจากกัน: copy ของ `no-root` ใน CI ของ Acme ข้าม init container ทำให้ CI ผ่าน แต่ admission ปฏิเสธการ deploy ให้แชร์ Rego library ชุดเดียวระหว่าง Conftest กับ Gatekeeper (constraint template import library module ได้) แชร์ test case และเลือกใช้ built-in control แทนการ copy
- **คิดว่ามันมาแทน design review ได้** กฎตรวจ setting ไม่ได้ตรวจว่า design ดีไหม: bucket ของ label export ผ่านทุก check ในขณะที่มันเก็บที่อยู่ลูกค้าไว้โดยไม่มีกำหนดระยะเวลาเก็บ ให้ยังมี design review และ data review สำหรับระบบใหม่ และให้กฎจัดการ check ที่ทำซ้ำ ๆ
- **สร้างด่านขึ้นมาใหม่** ถ้า check ที่ fail จัดการได้แค่โดยคนที่ review เป็นรอบรายสัปดาห์ ก็คือ CAB กลับมาในชื่อใหม่ ส่วน guardrail ควรให้ feedback ที่เร็วและทำเองได้แบบ self-service เพื่อให้คนเอาเวลา review ไปใช้กับ design และ exception
