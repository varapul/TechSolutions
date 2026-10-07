## ปัญหา

delivery team ของ Acme Shop ต้องใช้สามอย่างสำหรับ returns service ตัวใหม่: database [PostgreSQL](../postgresql/) บน Amazon RDS, SQS queue และ S3 bucket สำหรับ return label โดยต้องมีทั้งใน staging และใน production รอบแรกพวกเขาทำแบบที่คุ้นเคย มีคนหนึ่งทำตาม wiki page ของทีมเรื่องการตั้ง environment ที่มี 31 ขั้นและแก้ล่าสุดเมื่อ 14 เดือนก่อน แล้วคลิกไล่ไปใน AWS console: staging ทำวันจันทร์ ส่วน production ทำวันพฤหัสบดี

สอง environment ออกมาไม่เหมือนกัน database ของ staging encrypt ไว้และเก็บ automated backup เจ็ดวัน ส่วนใน production ช่อง encryption ไม่ได้ถูกติ๊ก และ backup retention ถูกตั้งเป็น 0 ทำให้ automated backup ถูกปิดไป ทั้งสองเรื่องแก้เร็ว ๆ ไม่ได้: RDS encrypt instance ได้แค่ตอนสร้าง การเพิ่ม encryption ทีหลังเลยแปลว่าต้อง restore จาก encrypted snapshot copy (หรือสลับไปด้วย RDS blue/green deployment) และ RDS documentation ก็เตือนว่าการเปลี่ยน retention จาก 0 เป็นค่าที่ไม่ใช่ 0 จะทำให้เกิด outage ส่วนเช้าวันต่อมา security group ของ production ก็ได้ inbound rule เพิ่มมาอีกตัวสำหรับ port 5432 จาก 198.51.100.0/24 ไม่มีใครจำได้ว่ามันมาอยู่ตรงนั้นทำไม เลยไม่มีใครกล้าลบมัน

ไม่มี change ไหนผ่านการ review ไม่มีอะไรบันทึกว่าทำไปเพราะอะไร และทางเดียวที่จะ rebuild production หลังเกิด disaster ก็คือไล่ทำตาม wiki ด้วยมือ และจะใช้เวลาราวสามวัน เรื่องเดิมก็เกิดซ้ำกับทุก service และทุก environment ใหม่ (ตัวเลขของ Acme ในหน้านี้เป็นตัวเลขของตัวอย่างนี้เอง ไม่ใช่ผลวิจัย)

## ทำงานยังไง

**Infrastructure as code** (IaC) คือการ define infrastructure อย่าง network, database, queue, bucket และ permission ไว้ใน source file ที่อยู่ใน version control และดูแลมันเหมือน software ตัวอื่น ๆ: ผ่านการ review, test และ deliver ผ่าน pipeline บทความใน bliki ของ Martin Fowler เรื่องนี้ (2016) สรุป practice ไว้ว่า: ใช้ definition file แทนการ login เข้าไปเปลี่ยนเอง, ให้โค้ดเป็นเอกสารของระบบแทนคำสั่งที่เขียนไว้ให้คนอ่าน, version ทุกอย่าง, test อย่างต่อเนื่อง, เลือก change เล็ก ๆ แทน batch ใหญ่ และทำให้ service ยังใช้งานได้ระหว่างที่มันเปลี่ยน

ตำรามาตรฐานคือ *Infrastructure as Code* ของ Kief Morris โดยฉบับที่สาม (O'Reilly, 2025) ให้น้ำหนักกับประเภทของเครื่องมือน้อยกว่าฉบับที่สอง (2020) และให้น้ำหนักมากขึ้นกับการออกแบบและ deliver infrastructure code ให้รับใช้องค์กร เล่มนี้ยังคง core practice สามข้อไว้: **define ทุกอย่างเป็นโค้ด**, **test และ deliver งานที่ทำอยู่ทั้งหมดอย่างต่อเนื่อง** และ **สร้างชิ้นเล็ก ๆ ที่เรียบง่ายและเปลี่ยนแยกกันได้** หลักการของ cloud infrastructure ในเล่มรวมถึง: assume ว่าระบบไม่น่าเชื่อถือ, ทำให้ทุกอย่าง reproduce ได้, หลีกเลี่ยง snowflake system, สร้างของที่ทิ้งได้, ลด variation ให้น้อยที่สุด (minimize variation) และทำให้ทุก procedure ทำซ้ำได้ บทที่ว่าด้วย delivery เอา continuous delivery มาใช้กับ infrastructure: เปลี่ยนแปลงผ่าน automated process เท่านั้น และทำให้โค้ดกับ resource ที่ deploy อยู่ตรงกันเสมอ

### Declare, plan, apply

provisioning tool ส่วนใหญ่เป็นแบบ **declarative**: โค้ดบอกว่าควรมีอะไรอยู่ (database ที่มี setting แบบนี้, queue หนึ่งตัว, bucket หนึ่งตัว) แล้ว tool ก็หาขั้นตอนเอง Terraform กับ OpenTofu เทียบสามอย่าง: configuration, **state** (บันทึกของมันว่า resource แต่ละตัวในโค้ดตรงกับ object จริงตัวไหน) และ infrastructure จริงที่มัน refresh ผ่าน API ของ cloud ตัว `plan` พิมพ์ส่วนต่างออกมาเป็นรายการ action (`+` create, `~` update in place, `-/+` replace, `-` destroy) ที่จบด้วยสรุปอย่าง `Plan: 10 to add, 0 to change, 0 to destroy.` แล้ว `apply` ก็ทำตามนั้น ถ้ารัน `apply` อีกรอบโดยไม่มีอะไรเปลี่ยน มันก็ไม่ทำอะไรเลย **idempotence** ตรงนี้แหละที่ทำให้ apply โค้ดชุดเดิมซ้ำแล้วซ้ำอีกในทุก environment ได้อย่างปลอดภัย

script แบบ **imperative** อย่างชุดคำสั่ง `aws` CLI จะอธิบายขั้นตอนแทน และถ้ารันสองรอบก็อาจพยายามสร้างทุกอย่างสองรอบ ส่วน tool ที่ให้เขียน infrastructure ด้วยภาษา general-purpose ก็ยังมีแกนแบบ declarative: AWS CDK app จะ generate CloudFormation template ออกมา และ Pulumi program ก็ register resource ที่มันต้องการกับ engine ของ Pulumi แล้ว engine ก็หา change เอง ด้าน configuration-management tool อย่าง Ansible ก็เอาแนวคิดนี้ไปใช้กับสิ่งที่รันอยู่บน server โดย documentation ของ Ansible นิยาม idempotent operation ว่าเป็น operation ที่ให้ผลเหมือนเดิมไม่ว่าจะรันครั้งเดียวหรือหลายครั้ง

### State กับ locking

state file คือวิธีที่ Terraform รู้ว่า `module.db.aws_db_instance.this` คือ production database `returns-db` และควรเก็บ state file ไว้ใน **remote backend** ที่ทุกคนและ pipeline ใช้ร่วมกัน ฝั่ง Acme ใช้ S3 bucket ที่มี state file หนึ่งไฟล์ต่อ service และ environment (`returns/staging.tfstate`, `returns/production.tfstate`) และเปิด versioning ไว้เพื่อให้กู้ state ที่เสียกลับมาได้ ตัว **lock** กันไม่ให้สอง run เปลี่ยน state เดียวกันพร้อมกัน โดย default แล้ว run ที่เจอ state ถูก lock อยู่จะ fail ทันที แต่ pipeline ของ Acme ส่ง `-lock-timeout` ไปด้วย ทำให้ run #58 คอย retry และรอ run #57 แทนที่จะ fail ส่วน S3 backend ของ Terraform เพิ่ม native locking ด้วย lock file ที่อยู่ข้าง state (`use_lockfile = true`) ใน version 1.10 (พฤศจิกายน 2024) แล้วมันก็ generally available ใน 1.11 (กุมภาพันธ์ 2025) โดย version นี้ deprecate locking แบบเก่าที่ใช้ DynamoDB ส่วน OpenTofu เพิ่ม S3-native locking ใน 1.10 และรองรับทั้งสองวิธี โดยไม่มีแผนจะ deprecate วิธีไหนเลย

### Module กับ environment

platform team ของ Acme publish **module** ที่มี version: `rds-postgres` เปิด encryption, backup อย่างน้อยเจ็ดวัน, deletion protection และ `prevent_destroy` ตัว `sqs-queue` เพิ่ม dead-letter queue ส่วน `s3-bucket` ก็เปิด versioning และ block public access ทำให้ product team ได้ setting พวกนี้ไปโดยไม่ต้องจำเอง ตัว `returns.tf` เรียกแต่ละ module ครั้งเดียว และแต่ละ environment ต่างกันแค่ใน variables file เล็ก ๆ ของมัน: instance class, Multi-AZ และ backup retention นี่แหละคือ *minimize variation* ของ Morris ในทางปฏิบัติ: staging กับ production สร้างจากโค้ดชุดเดียวกัน ความต่างระหว่างสองตัวเลยเป็นค่าในไฟล์ที่ตั้งใจใส่เสมอ module ยังอธิบายตัวเลขใน plan ด้วย: module สามตัวสร้าง resource 10 ตัว เพราะมันเพิ่ม subnet group, security group กับ rule ของมัน, dead-letter queue, versioning และ public access block

### การ test

- **Static check** ทุก commit: `terraform fmt -check`, `terraform validate` และ scanner อย่าง Checkov หรือ Trivy (ที่รวม tfsec เข้าไปแล้ว)
- **ใช้ plan เป็นของที่ review** CI รัน plan ให้แต่ละ environment แล้ว post มันไว้บน pull request (Atlantis และ Terraform service แบบ hosted ทำแบบนี้) ทำให้ reviewer approve ตัว action ไม่ใช่แค่ diff ของโค้ด
- **Policy check บน plan** ตัว `terraform show -json` เปลี่ยน plan เป็นข้อมูลที่ rule ตรวจได้: rule ของ Open Policy Agent ผ่าน Conftest, Checkov หรือ HashiCorp Sentinel ใน HCP Terraform ส่วน rule 12 ข้อของ Acme ก็ reject หลายอย่าง เช่น database ที่ไม่ encrypt, backup ที่น้อยกว่าเจ็ดวัน, ingress จาก `0.0.0.0/0` และ bucket ที่เป็น public นี่คือ [policy as code](../policy-as-code/) ที่เอามาใช้กับ infrastructure
- **Module test** ตัว `terraform test` (generally available ตั้งแต่ Terraform 1.6) รันไฟล์ `.tftest.hcl` ที่ plan หรือ apply module แล้วเช็ก condition บนผลลัพธ์ ส่วน Terratest ก็ทำแบบเดียวกันด้วย Go
- **Smoke test และ integration test** กับ environment จริงหลัง apply แต่ละครั้ง ก่อนที่ pipeline จะไปต่อที่ production

### Drift

**Drift** คือความต่างใด ๆ ระหว่างโค้ดกับของจริง ส่วนใหญ่มาจาก change ที่ทำนอกโค้ด ตัว `terraform plan -detailed-exitcode` ที่รันตามตารางจะเจอมัน (exit code 2 แปลว่า plan มี change) และ `-refresh-only` จะแสดงแค่สิ่งที่เปลี่ยนนอก Terraform ส่วน health assessment ของ HCP Terraform (edition Standard และ Premium) ก็รัน drift detection เป็นระยะ, CloudFormation ตรวจ drift บน stack ได้ และ CDK CLI ก็มี `cdk drift` มีข้อจำกัดสองข้อที่สำคัญ ข้อแรก plan เห็นแค่สิ่งที่โค้ดจัดการอยู่: security group rule ที่เพิ่มด้วยมือเป็น object แยก ทำให้ Terraform มองไม่เห็นมัน เว้นแต่มีอะไรสักอย่างเป็นเจ้าของ rule set ทั้งชุด ตัว module ของ Acme ใช้ resource `aws_vpc_security_group_rules_exclusive` ของ AWS provider (provider 6.29, มกราคม 2026) ที่ลบ rule ไหนก็ตามที่ไม่อยู่ในโค้ด ข้อสอง drift check แค่รายงาน: ยังต้องมีคนตัดสินใจว่าจะ revert change นั้นหรือเขียนมันลงโค้ด

### เครื่องมือในตอนนี้ (ตุลาคม 2026)

- **Terraform** (HashiCorp เป็นส่วนหนึ่งของ IBM ตั้งแต่ IBM ซื้อกิจการเสร็จเมื่อ 27 กุมภาพันธ์ 2025) เป็น declarative tool ที่ใช้กันแพร่หลาย มี provider สำหรับ cloud ส่วนใหญ่และ SaaS product หลายตัว เมื่อ 10 สิงหาคม 2023 ทาง HashiCorp ย้ายมันจาก MPL 2.0 ที่เป็น open source ไปเป็น Business Source License 1.1 โดย license ใหม่ครอบคลุม Terraform 1.6.0 ขึ้นไป
- **OpenTofu** คือ fork ของ Terraform ตัวสุดท้ายที่ใช้ license MPL โดยเริ่มขึ้นเพื่อตอบโต้การเปลี่ยนแปลงนั้น มันเป็น project ของ Linux Foundation, stable ตั้งแต่ 1.6.0 (มกราคม 2024), ถูกรับเข้า CNCF เป็น sandbox project ในเดือนเมษายน 2025 และยังเป็น MPL 2.0 อยู่ มันเริ่มต้นเป็น drop-in replacement และใช้ provider ชุดเดียวกัน แต่หลังจากนั้นทั้งสองตัวก็เพิ่ม feature คนละแบบ ฝั่ง OpenTofu มีของตัวเองรวมถึง client-side state และ plan encryption (1.7)
- **AWS CloudFormation** คือ declarative service ของ AWS เอง ใช้ template เป็น JSON หรือ YAML มี change set ไว้ preview การ update, drift detection และ IaC generator ที่ร่าง template จาก resource ที่มีอยู่แล้ว ส่วน **AWS CDK** ก็ generate CloudFormation จาก TypeScript, JavaScript, Python, Java, C#/.NET หรือ Go
- **Pulumi** define infrastructure ด้วย TypeScript หรือ JavaScript, Python, Go, .NET, Java หรือ YAML โดย engine ของมันเป็น open source ภายใต้ Apache 2.0
- **Crossplane** จัดการ cloud resource เป็น custom resource ของ [Kubernetes](../kubernetes/) และ reconcile มันอยู่ตลอดเหมือน GitOps agent แล้วมันก็ graduate ใน CNCF เมื่อตุลาคม 2025
- **Ansible** (Red Hat ที่เป็นของ IBM เหมือนกัน) เป็น automation แบบ agentless ที่ใช้ส่วนใหญ่เพื่อ configure สิ่งที่รันอยู่บน server และ network device โดยมักใช้คู่กับ provisioning tool

**GitOps** เอาแนวคิดเดียวกันไปใช้กับ Kubernetes โดยต่างกันอยู่ข้อเดียว: แทนที่ pipeline จะ push plan ออกไป ตัว agent ที่อยู่ใน cluster จะ pull desired state จาก Git และ reconcile มันอยู่ตลอด ทำให้ drift ถูกแก้อย่างต่อเนื่อง แทนที่จะไปเจอตอน plan ครั้งถัดไป ดู [GitOps](../gitops/)

### Secret

Terraform เขียน attribute ของ resource ลงใน state file และ plan file รวมถึง secret อย่าง database password ตั้งต้นที่ตั้งไว้ใน configuration ให้เก็บ secret ไว้นอก state เท่าที่ทำได้: ให้ RDS จัดการ master password ใน AWS Secrets Manager (`manage_master_user_password`) และใช้ write-only argument อย่าง `password_wo` (Terraform 1.11 ขึ้นไป) ที่ไม่เคยถูกเก็บ หรือ ephemeral value (1.10 ขึ้นไป) แต่ยังไงก็ให้ถือว่า state เป็นข้อมูล sensitive: encrypt มัน (server-side encryption ด้วย KMS key บน S3 backend หรือ state encryption ของ OpenTofu) จำกัดคนที่อ่านมันได้ และห้าม commit มันเข้า Git

## ลงมือทำจริงยังไง

1. **เลือก tool และตั้ง state ก่อน** ทีมที่ใช้แค่ AWS ใช้ CloudFormation หรือ CDK ได้ และไม่ต้องรัน state backend เลย ส่วนทีมที่ใช้หลาย cloud และ SaaS product มักเลือก Terraform หรือ OpenTofu แล้วให้สร้าง state bucket ที่มี versioning, encryption, lock และ access ที่รัดกุมก่อน resource ตัวแรก
2. **เอา resource ที่มีอยู่แล้วเข้ามาอยู่ใต้โค้ด** ด้วย `import` block (Terraform 1.5 ขึ้นไป และ OpenTofu ก็มี) แทนการสร้างใหม่ แล้วปรับโค้ดจน plan ไม่แสดง change อะไรเลย ส่วนสิ่งที่ import เผยออกมาก็ให้แก้อย่างตั้งใจ: กับ database ที่ import เข้ามาและถูกสร้างแบบไม่ encrypt อย่าง production database ที่ Acme สร้างด้วยมือ การตั้ง `storage_encrypted = true` จะบังคับให้ต้อง replace แล้วการแก้เรื่อง encryption เลยต้องเป็น migration ที่วางแผนไว้จาก encrypted snapshot copy
3. **ใส่ guardrail ไว้ใน shared module** (encryption, backup, deletion protection, tag, logging) และทำ version ด้วย Git tag หรือ private registry ทำให้ทีมต่าง ๆ upgrade อย่างตั้งใจ แล้ว template ของ golden path ก็เริ่มทุก service ใหม่ด้วย module พวกนี้ได้
4. **ให้แต่ละ service มี configuration เดียว และแต่ละ environment มี state กับ variables file ของตัวเอง** การ copy folder แยกต่อ environment จะพา drift ที่พยายามกำจัดกลับมา แค่คราวนี้อยู่ในโค้ด
5. **ทำให้ pipeline เป็นทางเดียวที่จะเปลี่ยน infrastructure:** plan สำหรับทุก environment ในทุก pull request, policy check บน plan, review ที่อ่าน plan จริง แล้วค่อย apply หลัง merge โดยทำ staging ก่อน production ให้ role ของ pipeline มีสิทธิ์ write (ผ่าน OpenID Connect แทน key อายุยาว) และให้คนมีแค่สิทธิ์ read-only ใน production พร้อม break-glass procedure ที่บันทึกไว้สำหรับเหตุฉุกเฉิน
6. **Pin provider และ module** และ commit `.terraform.lock.hcl` เพื่อให้การ upgrade provider มาเป็น change ที่ผ่าน review ของมันเอง แทนที่จะโผล่มาเป็นเรื่องเซอร์ไพรส์ใน plan ของใครสักคน
7. **ตรวจ drift ตามตาราง** แล้วส่งผลไปให้ทีมที่เป็นเจ้าของโค้ด ที่ Acme รัน plan ทุกคืนตอน 02:00
8. **ซ้อม rebuild** ทาง Acme จะ apply configuration ของ production ใน us-west-2 ไตรมาสละครั้ง: infrastructure ใช้เวลา 40 นาที แล้วก็ restore data จาก cross-region snapshot copy ตัวล่าสุด โค้ด rebuild resource ได้ แต่ไม่ได้ rebuild data เพราะฉะนั้น backup ก็ยังเป็นตัวกำหนด RPO ของคุณอยู่ดี

## อยู่ตรงไหนใน solution

- [Immutable infrastructure](../immutable-infrastructure/) แทนที่ server ด้วย image ที่ bake ไว้แทนการ patch ส่วน infrastructure as code ก็ define ทุกอย่างที่อยู่รอบ ๆ server พวกนั้น และ image version ก็กลายเป็นอีกค่าหนึ่งในโค้ด
- [GitOps](../gitops/) คือแนวคิดเดียวกันในแบบ pull-based สำหรับ Kubernetes: agent ทำให้ cluster sync กับ Git อยู่ตลอด
- [Continuous delivery](../continuous-delivery/): infrastructure code ผ่าน deployment pipeline เหมือนโค้ดของ application และโค้ดชุดเดียวกันก็ถูก test และ apply ที่ staging ก่อน production
- [Golden paths](../golden-paths/) เริ่ม service ใหม่โดยมี infrastructure code และ module ของ platform วางไว้ให้แล้ว ส่วน policy as code ก็ตรวจทุก plan เทียบกับกฎขององค์กร
- [Disaster recovery strategies](../disaster-recovery-strategies/): backup and restore จะ rebuild infrastructure จากโค้ดใน region อื่น ส่วน pilot light ก็ใช้โค้ดชุดเดียวกัน scale region ที่ใช้ recover ขึ้นมา
- [Eliminating toil](../eliminating-toil/): module บวก pull request เปลี่ยน ticket ("ขอสร้าง database user", "ขอ bucket หน่อย") ให้กลายเป็น self-service
- [Expand and contract](../expand-and-contract/) กับ [blue-green deployment](../blue-green-deployment/) คือวิธีเปลี่ยน stateful resource ที่ live อยู่โดยไม่ต้อง replace: เพิ่มตัวใหม่ ย้าย traffic หรือ data ไป แล้วค่อยลบตัวเก่า
- [You build it, you run it](../you-build-it-you-run-it/): product team เป็นเจ้าของ infrastructure code ของตัวเอง ส่วน platform team เป็นเจ้าของ module และ pipeline
- resource ในหน้านี้: [Amazon RDS and Aurora](../amazon-rds-aurora/), [Amazon SQS](../amazon-sqs/), [Amazon S3](../amazon-s3/), security group ใน [Amazon VPC](../amazon-vpc/), role ของ pipeline ใน [AWS IAM](../aws-iam/) และ secret ใน AWS Secrets Manager หรือ [Vault](../vault/)

## ใช้ตอนไหนดี

Infrastructure as code คุ้มกับอะไรก็ตามที่จะอยู่นานกว่าการทดลอง มีมากกว่าหนึ่ง environment หรือต้อง rebuild, review หรือ audit ได้: production system, shared platform ที่หลายทีมใช้ และ regulated workload ที่ทุก change กลายเป็น commit ที่ผ่าน review พร้อม plan, ผล policy และผู้ approve ที่บันทึกไว้

แต่มันก็มีต้นทุนจริง ทีมต้องเรียนรู้ tool และ state model ของมัน ดูแล state ให้ปลอดภัย อัปเดต provider และ module ให้ทันอยู่เสมอ และยอมรับว่า change ครั้งเดียวจบตอนนี้ต้องผ่าน pull request และ pipeline run ให้ปรับตามสถานการณ์:

- **ทีมเล็กหรือมี environment เดียว:** configuration เดียว, remote state และ plan บน pull request ก็พอ เขียน module ตอนที่เริ่มเห็นการทำซ้ำ ไม่ใช่ก่อนหน้านั้น
- **ช่วงสำรวจ:** คลิกเล่นใน sandbox account ก็ไม่เป็นไรถ้าเพื่อเรียนรู้ service ตัวหนึ่ง แต่ให้เปลี่ยนผลลัพธ์เป็นโค้ดหรือลบทิ้ง ก่อนที่จะมีอะไรมาพึ่งมัน ทั้ง `import` block ที่ใช้คู่กับ option ทดลอง `-generate-config-out` และ IaC generator ของ CloudFormation ช่วยร่างโค้ด version แรกให้ได้
- **Legacy และ on-premises estate:** เริ่มจากส่วนที่เปลี่ยนบ่อยที่สุดหรือ rebuild แล้วเจ็บที่สุด และใช้ import แทนการสร้างใหม่
- **Regulated environment:** เก็บ plan output, ผล policy และ approval ของแต่ละ change ไว้ เพราะนี่คือ audit trail

มันไม่ใช่ tool สำหรับ data ที่อยู่ใน resource โค้ดสร้าง database แต่ไม่ได้สร้าง row ในนั้น: schema migration เป็นงานของ pipeline ของ application ส่วน backup และ restore เป็นงานของ disaster recovery plan

## กับดักที่เจอบ่อย

- **Apply plan ที่ไม่มีใครอ่าน** plan ที่บอกว่า `must be replaced` บน database แปลว่า destroy แล้วสร้างใหม่: ได้ database ใหม่ที่ว่างเปล่า บาง argument บังคับแบบนี้เสมอ เช่น `kms_key_id` หรือ `storage_encrypted` บน `aws_db_instance` การ rename resource ก็ให้ผลแบบเดียวกัน คือ destroy ที่ address เดิมแล้ว create ที่ address ใหม่ เว้นแต่จะมี `moved` block (Terraform 1.1 ขึ้นไป) บันทึกการ rename ไว้ ให้อ่านทุก plan และป้องกัน stateful resource สองชั้น: `prevent_destroy` ทำให้ Terraform ปฏิเสธ plan ไหนก็ตามที่จะ destroy resource นั้น (แต่ไม่รวมกรณีที่ลบ resource block ทิ้งไปเอง) และ RDS deletion protection ก็ทำให้ AWS ปฏิเสธการลบ ถ้า change นั้นจำเป็นจริง ๆ ก็ให้ migrate data อย่างตั้งใจ
- **Secret ใน state file** password ที่ตั้งไว้ใน configuration จะไปอยู่ใน state file และ plan file เป็น plain text ใครที่อ่าน bucket ได้ก็อ่านมันได้ ให้ encrypt และจำกัดสิทธิ์ของ state แล้วเก็บ secret ไว้นอก state ด้วย password ที่ RDS จัดการ, write-only argument หรือ ephemeral value
- **State ก้อนใหญ่ก้อนเดียวสำหรับทุกอย่าง** ถ้าใส่ resource ทั้ง 2,300 ตัวของ Acme ไว้ใน state เดียว ทุก plan จะใช้เวลา 9 นาที lock ตัวเดียวจะบล็อกทุกทีม และความผิดพลาดครั้งเดียวก็ลามไปถึงอะไรก็ได้ ให้แยก state ตาม service และ environment เพื่อให้แต่ละ change มี blast radius เล็ก
- **Hotfix ด้วยมือที่ไม่เคยเขียนกลับลงโค้ด** fix ที่ทำใน console ระหว่าง incident คือ drift ถ้าไม่มีใครเขียนมันลงโค้ด ตัว apply ครั้งถัดไปก็จะ undo มันไปเงียบ ๆ หรือไม่ drift ก็ค้างอยู่ และไม่มีใครรู้ว่า version ไหนถูก ให้เขียนกลับลงโค้ดภายในวันเดียวกัน และทำ console ให้ read-only นอกเหนือจากตอน break-glass
- **Environment ที่ copy-paste กัน** folder `staging/` กับ `production/` ที่ copy โค้ดกันมาจะค่อย ๆ ต่างกันในโค้ด แบบเดียวกับ environment ที่สร้างด้วย click-ops ให้ใช้ configuration เดียวคู่กับ variables file ต่อ environment หรือใช้ root บาง ๆ แยกต่อ environment ที่เรียก module ชุดเดียวกัน
- **Drift ที่ plan มองไม่เห็น** resource ที่สร้างด้วยมือ หรือ rule ที่ผูกไว้เป็น object แยก จะไม่เคยโผล่ใน plan ให้ import มันเข้ามา หรือเป็นเจ้าของทั้ง set แบบที่ `aws_vpc_security_group_rules_exclusive` ทำกับ security group rule และเสริม plan ด้วย detective control อย่าง AWS Config rule
- **Admin key อายุยาวใน CI** ตัว pipeline ที่เปลี่ยนได้ทุกอย่างคือเป้าหมายชั้นดี ให้ role ที่มัน assume ผ่าน OpenID Connect แยกหนึ่งตัวต่อ environment เพื่อให้ run ของ staging แตะ production ไม่ได้
