## ปัญหา

server ที่ถูกแก้บนเครื่องเดิมจะสะสมประวัติไปเรื่อย ๆ มันถูก patch อัปเกรด และจูนอยู่หลายเดือนหรือหลายปี ทั้งจากคนที่นั่งพิมพ์ใน terminal และจาก script ทีละเครื่อง การแก้บางอย่างไปถึงทุกเครื่อง บางอย่างไปถึงแค่เครื่องเดียว script บางตัวหยุดไปกลางทาง การแก้บางอย่างทำกลาง incident แล้วไม่เคยมีใครจดไว้ server ที่เคยสร้างมาเหมือนกันเป๊ะก็เลิกเหมือนกัน Martin Fowler เรียกการแก้เฉพาะหน้าที่ไม่มีบันทึกพวกนี้ว่า **configuration drift** และเรียกปลายทางของมันว่า **snowflake server**: เครื่องที่มี configuration เป็นของตัวเอง ไม่มีใครสร้างซ้ำได้ และทุกคนกลัวที่จะไปแตะ

drift กลายเป็นปัญหาที่จับต้องได้

- **bug ที่อยู่บน host เดียว** instance หนึ่งในสามตัวพัง และความต่างที่ทำให้พังก็เป็นแค่หนึ่งในหลายร้อยจุดที่ต่างกันระหว่างเครื่อง
- **ไม่มีทางย้อนกลับ** พอดิสก์ของ snowflake เสีย หรือ region ของมันหายไป ก็ไม่มีใครสร้างอีกเครื่องให้เหมือนเดิมเป๊ะได้ คำอธิบายที่ครบที่สุดของ server ก็คือตัว server เอง
- **เทสต์ที่พิสูจน์อะไรได้น้อย** test environment ที่ถูกคนอื่นแก้มาตลอดหลายเดือนที่ผ่านมาไม่ใช่ production environment ทำให้การเปลี่ยนแปลงที่ผ่านเทสต์ตรงนั้นยังทำ production พังได้
- **patch ต้องรอ** การอัปเกรดบนเครื่องเดิมแต่ละครั้งคือการทดลองเล็ก ๆ บนเครื่องที่ไม่มีใครเข้าใจครบ security fix เลยถูกเลื่อนออกไป และช่องโหว่ก็เปิดนานขึ้นเรื่อย ๆ

เครื่องมือ configuration management ที่ apply desired state ซ้ำตามตาราง (Puppet, Chef, Ansible) ลด drift ได้ แต่ไม่ได้ทำให้มันหมดไป อย่างที่ Fowler ชี้ไว้ในบทความ *PhoenixServer* ของเขา การ apply configuration ซ้ำแก้ได้แค่ส่วนของระบบที่บอกให้เครื่องมือจัดการไว้ อะไรที่อยู่นอกนั้นก็ยัง drift ได้ตามใจ

## ทำงานยังไง

กฎสั้น ๆ คือ **พอ server รันแล้ว ห้ามใครแก้มัน** ทุกการเปลี่ยนแปลงจะได้ image ใหม่ออกมา แล้ว server ใหม่ที่ launch จาก image นั้นก็เข้าไปแทนเครื่องเก่า

1. **นิยาม server เป็นโค้ด** image recipe (Packer template, Dockerfile, EC2 Image Builder recipe) อยู่ใน version control ข้าง ๆ แอปพลิเคชัน มันระบุ base image และรายการของที่ใส่ทับลงไป: package และ patch ของระบบปฏิบัติการ, runtime, build ของแอปพลิเคชัน, agent อย่าง log shipper และ configuration ตั้งต้นที่เหมือนกันทุก environment
2. **pipeline bake image** ทุกครั้งที่มีการเปลี่ยนแปลง มันจะ build image, boot และเทสต์มัน, สแกน แล้ว publish ขึ้น registry ภายใต้เวอร์ชันใหม่ (v42) พร้อมตัวระบุที่ผูกกับ byte ชุดนั้นพอดี: content digest สำหรับ container image และ image ID สำหรับ machine image ตัว image ถูก build และเทสต์ครั้งเดียว จากนั้นก็ถูก promote จาก test ไป production โดยไม่เปลี่ยนอะไรเลย
3. **ทุก server ถูก launch จาก image เวอร์ชันหนึ่ง** launch template, instance group หรือ deployment manifest ระบุ image ไว้ ทุก instance เลยเหมือนกัน และการเพิ่มเครื่องหนึ่งเครื่องก็เป็นขั้นตอนเดียวกับการเพิ่มร้อยเครื่อง นี่คือสิ่งที่ทำให้ [autoscaling](../autoscaling/) ปลอดภัย
4. **เปลี่ยนอะไรก็คือ image ใหม่และ server ใหม่** release ของแอปพลิเคชัน security patch หรือค่า default ใหม่ ล้วนต้องผ่าน pipeline และออกมาเป็น v43 แล้ว server ที่ launch จาก v43 ก็จะเข้าไปแทนเครื่อง v42 ด้วย [rolling update](../rolling-update/), [การสลับแบบ blue-green](../blue-green-deployment/) หรือ [canary release](../canary-release/) จะ rollback ก็คือ launch v42 อีกครั้ง: มันยังอยู่ใน registry และไม่ได้เปลี่ยนไปเลย
5. **ปิดประตู** พอไม่มีอะไรต้องทำบน server ที่รันอยู่แล้ว สิทธิ์ login ก็ถูกถอดออก หรือเก็บไว้ใช้แค่ตอนฉุกเฉินและมีการ audit นี่คือสิ่งที่กันไม่ให้ drift แอบกลับเข้ามา
6. **อะไรที่ต้องอยู่รอดก็ไปอยู่ที่อื่น** ข้อมูลไปอยู่ใน database และ storage ที่อยู่นานกว่า instance ไหน ๆ การตั้งค่าและ secret ถูกดึงมาตอน server เริ่มทำงาน ส่วน log, metric และ trace ก็ออกจาก server ไปทันทีที่เกิดขึ้น การเปลี่ยน server เลยไม่ทำให้อะไรหาย

| | Mutable server | Immutable server |
|---|---|---|
| **การเปลี่ยนแปลงมาถึงยังไง** | apply ใส่ server ที่รันอยู่: shell session, script, การรัน configuration management | bake ลงใน image ใหม่ แล้ว server ที่ launch จากมันเข้าไปแทนเครื่องเก่า |
| **สภาพของ fleet** | drift ไปเรื่อย ๆ server ที่เริ่มมาเหมือนกันค่อย ๆ ต่างกันออกไป | ทุก server ตรงกับ image เวอร์ชันเดียว |
| **Rollback** | ย้อนการแก้บนแต่ละเครื่อง ถ้ามีใครรู้ว่าต้องทำยังไง | launch image เวอร์ชันก่อนหน้าอีกครั้ง |
| **อายุปกติของ server** | หลายเดือนถึงหลายปี | หลายชั่วโมงถึงหลายสัปดาห์ |
| **สิทธิ์ login** | ใช้เป็นเรื่องปกติ | ไม่มี หรือมีแค่ตอนฉุกเฉินที่ถูก audit |

### ชื่อพวกนี้มาจากไหน

- **Snowflake server** และ **phoenix server** เป็นสองบทความที่ Martin Fowler เผยแพร่บน bliki ของเขาเมื่อวันที่ 10 กรกฎาคม 2012 ตัว snowflake คือ server ที่ไม่เหมือนใครและถูกจูนด้วยมืออย่างที่อธิบายไว้ด้านบน ส่วน phoenix server คือเครื่องที่ถูกเผาทิ้งเป็นประจำแล้วสร้างใหม่ตั้งแต่ศูนย์ drift เลยไม่มีเวลาสะสม Fowler ให้เครดิตชื่อนี้กับ Kornelis Sietsma เพื่อนร่วมงานของเขา
- **Immutable server** คือก้าวถัดไปที่สมเหตุสมผล Kief Morris เขียนถึงมันบน bliki เดียวกันเมื่อวันที่ 13 มิถุนายน 2013: server ที่ไม่เคยถูกแก้เลยหลัง deploy ไปแล้ว มีแต่จะถูกแทนด้วย instance ใหม่ Morris ให้เครดิตคำนี้กับ Ben Butler-Cole เพื่อนร่วมงานที่ Thoughtworks ส่วนอีกสิบวันต่อมา โพสต์ของ Chad Fowler ชื่อ *Trash Your Servers and Burn Your Code: Immutable Infrastructure and Disposable Components* ก็สนับสนุนแนวทางเดียวกัน โดยเปรียบกับ immutable value ใน functional programming ส่วนทุกวันนี้ practice REL08-BP04 ของ AWS Well-Architected Framework อธิบาย **immutable infrastructure** ว่าเป็นโมเดลที่ production workload ไม่ได้รับการอัปเดต patch หรือการเปลี่ยน configuration บนเครื่องเดิมเลยแม้แต่อย่างเดียว
- **Pets versus cattle** คือคำย่อของการเปลี่ยนทัศนคติแบบเดียวกัน pet มีชื่อ และพอมันป่วยทุกคนก็ช่วยกันรักษา ส่วน cattle มีแค่หมายเลข และตัวที่ป่วยก็ถูกเปลี่ยนตัว Randy Bias ที่เริ่มใช้การเปรียบเทียบนี้กับ cloud computing ราวปี 2011 และ 2012 ให้เครดิตมันกับการนำเสนอของ Bill Baker เรื่องการ scale SQL Server ที่ใช้มันเปรียบ scaling up กับ scaling out แล้ว Bias ก็ย้ายจุดเน้นไปที่ว่า server ถูกทำลายและแทนที่ได้ทุกเมื่อหรือเปล่า บทความ *SnowflakeServer* ของ Fowler ก็พูดถึงอุปมานี้ไว้ในเชิงอรรถเหมือนกัน

### Machine image และ container image

หลักการเหมือนกันทั้ง virtual machine และ container ต่างกันแค่หน่วย

- **Machine image** (Amazon Machine Images, Azure images, Google Compute Engine images) เก็บดิสก์ทั้งก้อน: ระบบปฏิบัติการ package และแอปพลิเคชัน ส่วน machine image ที่ build แบบนี้มักถูกเรียกว่า *golden image* ตัว HashiCorp **Packer** build มันให้หลาย platform จาก template เดียว และรันเครื่องมืออย่าง Chef หรือ Puppet เป็น build step ได้ ทำให้ recipe ของ configuration ที่มีอยู่แล้วรันแค่ครั้งเดียวตอน build แทนที่จะรันซ้ำไปซ้ำมาบน server ที่ live อยู่ ฝั่ง cloud เองก็มี builder แบบ managed ให้: **EC2 Image Builder** รัน pipeline ที่มี component สำหรับ build และเทสต์ตามตาราง แล้วกระจายผลลัพธ์ไปที่ Region และ account อื่น ๆ ส่วน **Azure VM Image Builder** ที่สร้างบน Packer ก็ publish ไปที่ Azure Compute Gallery ได้
- **Container image** ทำตาม **OCI image specification** (เวอร์ชัน 1.1 ตั้งแต่กุมภาพันธ์ 2024): manifest ที่ระบุรายการ layer โดยอ้างถึงด้วยเนื้อหาของมัน container image เป็น immutable มาตั้งแต่โครงสร้าง ตัว container ที่รันอยู่จะเขียนลง writable layer บาง ๆ ของตัวเอง ที่จะถูกลบไปพร้อม container ส่วน image ก็ยังเหมือนเดิม และ orchestrator อย่าง Kubernetes ก็แทนที่ container แทนที่จะ patch มัน การตั้ง `readOnlyRootFilesystem` ใน security context ของ container จะ mount root filesystem เป็น read-only เลยไม่มีอะไรถูกแก้บนที่เดิมได้แม้แต่โดยบังเอิญ ส่วนพื้นที่สำหรับเขียนชั่วคราวก็มาจาก volume ที่ประกาศไว้ชัด ๆ

### เวอร์ชัน digest และ provenance

image จะมีประโยชน์ในฐานะหน่วยของการเปลี่ยนแปลงก็ต่อเมื่อคุณรู้ชัด ๆ ว่าตัวไหนรันอยู่ และข้างในมีอะไร

- **ปัก digest ไม่ใช่แค่ tag** tag อย่าง `v42` หรือ `latest` ถูกย้ายไปชี้ image อื่นได้ ส่วน digest คือ hash ของเนื้อหา image และเปลี่ยนไม่ได้เลย เอกสารของ Kubernetes เรื่อง image อธิบายความต่างนี้ไว้ชัด deploy ด้วย digest หรือทำให้ tag เป็น immutable ถ้า registry ของคุณรองรับ แบบนี้ image ที่คุณเทสต์จะได้เป็น image ที่คุณรัน ส่วน machine image ก็ใช้ image ID ทำหน้าที่เดียวกัน
- **บันทึกว่าอะไรอยู่ข้างใน** software bill of materials (SBOM) ระบุทุก package ใน image เป็นรูปแบบ SPDX (มาตรฐานสากล ISO/IEC 5962:2021) หรือรูปแบบ CycloneDX (Ecma ทำเป็นมาตรฐานในชื่อ ECMA-424) ส่วน provenance บันทึกว่า image ถูก build ยังไงและจาก source ไหน BuildKit ของ Docker แนบ provenance attestation แบบขั้นต่ำมาให้เป็น default และเพิ่ม SBOM ให้ถ้าขอ ส่วน SLSA specification ก็อธิบายว่า provenance ควรมีอะไรบ้าง
- **Sign มัน และเช็ก signature ก่อน launch** `cosign` ของ Sigstore และ `notation` ของ Notary Project ใช้ sign image ใน registry แล้ว admission policy หรือ deployment step ก็ปฏิเสธ image ที่ไม่ได้ sign หรือมาจากที่อื่น ตั้งแต่ OCI specifications เวอร์ชัน 1.1 เป็นต้นมา registry ก็เก็บ signature, SBOM และ attestation ได้ โดยวางไว้ข้าง ๆ image ที่มันอธิบาย และแสดงรายการผ่าน referrers API
- **สแกนมัน และสแกนต่อไปเรื่อย ๆ** สแกนทุก image ใน pipeline และหยุด release ถ้าเจอปัญหาร้ายแรง จากนั้นก็สแกน image ที่เก็บไว้ซ้ำ เพราะช่องโหว่ใหม่ ๆ ของ package ที่คุณ bake ไว้เมื่อหลายเดือนก่อนยังถูกเผยแพร่ออกมาเรื่อย ๆ EC2 Image Builder validate image ด้วย Amazon Inspector ได้ ส่วนเครื่องมือสแกนแบบ open source อย่าง Trivy และ Grype ก็รันได้ในทุก pipeline

### อะไรอยู่ใน image และอะไรมาตอนเริ่มทำงาน

ถามสองคำถามกับทุกอย่าง: มันต่างกันระหว่าง environment ไหม และมันเปลี่ยนได้โดยไม่ต้อง release ไหม

| อะไร | ตัวอย่าง | อยู่ที่ไหน |
|---|---|---|
| **เหมือนกันทุกที่ เปลี่ยนพร้อม release** | package และ patch ของ OS, runtime, build ของแอปพลิเคชัน, agent, configuration ตั้งต้น | bake ลงใน image |
| **ต่างกันในแต่ละ environment** | endpoint, ขนาด pool, ค่า default ของ feature สำหรับ staging และ production | ดึงมาหรือฉีดเข้าไปตอน server เริ่มทำงาน |
| **Secret** | password, API key, private key | ดึงมาตอนเริ่มจาก secrets manager โดยใช้ identity ของ server เอง |
| **เกิดขึ้นระหว่างรัน** | ข้อมูล, ไฟล์ที่อัปโหลด, session, log, metric | เขียนไปที่ service นอก server |

นี่คือกฎของ twelve-factor เรื่อง configuration *The Twelve-Factor App* นิยาม config ว่าเป็นทุกอย่างที่น่าจะต่างกันในแต่ละ deploy (handle ไปหา backing service, credential, ค่าเฉพาะของแต่ละ deploy อย่าง hostname) และกำหนดให้แยก config ออกจากโค้ดอย่างเคร่งครัด บททดสอบของมันคือ codebase นั้นเผยแพร่ออกไปได้ทุกเมื่อโดยไม่ทำ credential หลุดหรือเปล่า การเชื่อมต่อภายในที่เหมือนกันทุก deploy อย่าง routing table ไม่นับเป็น config ในความหมายนี้ และควรอยู่ใน image

ผลตอบแทนคือ **image เดียวรันได้ทุกที่**: byte ที่คุณเทสต์ใน staging ก็คือ byte ที่รันใน production มีแค่การตั้งค่าที่ฉีดเข้าไปที่ต่างกัน ตัว twelve-factor app เก็บ config ไว้ใน environment variable แต่หลายทีมเลือกอ่านการตั้งค่าตอนเริ่มทำงานจาก external configuration store (AWS Systems Manager Parameter Store หรือ AWS AppConfig, Azure App Configuration, Kubernetes ConfigMaps) และอ่าน secret จาก secrets manager (AWS Secrets Manager, Azure Key Vault, HashiCorp Vault, Kubernetes Secrets) แทน อย่าเอา secret ใส่ไว้ใน image เพราะ image ถูกคัดลอกไปทั่วและเก็บไว้นาน และอย่าใส่ใน launch script ด้วย: AWS เตือนไว้ว่า EC2 user data ไม่ได้ถูกป้องกันด้วย authentication หรือ cryptography เลยไม่ใช่ที่สำหรับ password หรือ key ที่ใช้ยาว ๆ

### Bake ทุกอย่าง หรือตั้งค่าตอน boot

whitepaper ของ AWS เรื่องทางเลือกในการ deploy เรียกปลายสองข้างว่า **prebaking** และ **bootstrapping** image ที่ bake ครบจะ boot ขึ้นมาเป็น server ที่ใช้งานได้ทันที การ launch เลยเร็ว และทุก instance ก็เหมือนกัน ส่วน image บาง ๆ ที่ติดตั้งแอปพลิเคชันและ dependency ตอน boot (จาก cloud-init user data หรือการรัน configuration management) ต้อง build image น้อยกว่า แต่ทุกการ launch จะช้ากว่า โดยเฉพาะถ้าของที่ต้องดาวน์โหลดใหญ่ และ server สองเครื่องที่ launch ห่างกันหนึ่งชั่วโมงก็อาจได้ package คนละเวอร์ชันจาก mirror: นี่คือ drift ตอน launch นั่นเอง ทีมส่วนใหญ่เลือกทางสายกลาง คือ bake ทุกอย่างที่กำหนดพฤติกรรม แล้วเหลือไว้แค่ขั้นตอนเฉพาะของ environment ให้ทำตอน boot ส่วนเวลา boot ก็สำคัญกว่าที่คิด เพราะ fleet จะ scale out หรือแทน instance ที่หายไปได้เร็วแค่ไหน ก็ขึ้นกับว่า server ใหม่พร้อมเร็วแค่ไหน

### เปลี่ยน server โดยไม่มี downtime

การที่ server เก่าหลีกทางให้ server ใหม่ยังไง เป็น deployment pattern ในตัวมันเอง [rolling update](../rolling-update/) สลับทีละไม่กี่เครื่อง [blue-green](../blue-green-deployment/) สลับระหว่าง fleet สองชุดเต็ม ๆ และ [canary release](../canary-release/) ลอง image ใหม่กับ traffic ส่วนน้อยก่อน ส่วน cloud platform ก็มีพวกนี้สำเร็จรูปให้ เช่น **instance refresh** ของ EC2 Auto Scaling จะแทนที่ instance ของ group หลังจากคุณชี้ launch template ของมันไปที่ AMI ใหม่ และ rollback ได้ หรือข้าม instance ที่ตรงกับ configuration ใหม่อยู่แล้วก็ได้ ไม่ว่าจะใช้กลไกไหน server ต้อง **disposable** ในความหมายของ twelve-factor: เริ่มเร็ว ปิดตัวอย่างเรียบร้อยเมื่อได้รับ SIGTERM และไม่พังเสียหายเวลาตายไปโดยไม่มีสัญญาณเตือน

### Infrastructure as code และ GitOps

immutable server ต้องให้ทุกอย่างรอบตัวมันสร้างซ้ำได้ด้วย: network, load balancer, security rule, DNS record และตัว launch template เอง นิยามพวกนี้เป็นโค้ด (Terraform หรือ OpenTofu, AWS CloudFormation, Azure Bicep, Pulumi) review การเปลี่ยนแปลงเหมือนโค้ดแอปพลิเคชัน และ apply จาก pipeline แล้วเวอร์ชันของ image ก็กลายเป็นอีกค่าหนึ่งในโค้ดนั้น ที่เปลี่ยนได้ใน commit ตัว practice ของ Well-Architected แนะนำให้ใช้ automation คู่กับ infrastructure as code แบบนี้สำหรับ immutable deployment ส่วนหนังสือ *Infrastructure as Code* ของ Kief Morris ก็ครอบคลุมศาสตร์นี้ในภาพกว้าง

**GitOps** ไปไกลอีกขั้น: desired state อยู่ใน Git และ agent ภายใน environment จะ pull มันมา แล้วคอย reconcile ระบบจริงให้เข้าหามันไปเรื่อย ๆ หลักการของ OpenGitOps (เวอร์ชัน 1.0.0) ระบุคุณสมบัติสี่ข้อ: declarative, versioned and immutable, pulled automatically และ continuously reconciled พอใช้แบบนี้ การเปลี่ยน image digest ใน Git ก็กลายเป็นการ deploy และการแก้ด้วยมือบนระบบที่รันอยู่ก็จะโผล่มาเป็นความต่าง ที่รอบ reconcile ถัดไปพยายามย้อนกลับ

### Rebuild ตามตาราง และทุกครั้งที่ base เปลี่ยน

image ถูกแช่แข็งไว้ในวันที่มันถูก build และช่องโหว่ของมันก็เช่นกัน rebuild มันแม้โค้ดของคุณเองจะไม่ได้เปลี่ยน

- **ตอนที่ base image เปลี่ยน** โดย default แล้ว EC2 Image Builder pipeline ที่ตั้งตารางไว้จะ build image ใหม่ก็ต่อเมื่อ base image หรือ component ตัวใดตัวหนึ่งมีเวอร์ชันใหม่กว่าที่ตรงกับ version filter ของ recipe ส่วนฝั่ง container ก็ใช้ bot อย่าง Dependabot เปิด pull request ได้เมื่อมี base image ใหม่กว่าถูก publish ออกมา
- **ตามจังหวะที่ตายตัว** เพื่อให้ไม่มี image ไหนใน production เก่าเกินอายุที่ตกลงกันไว้ และไม่มี server ไหนด้วย เช่น EC2 Auto Scaling แทนที่ทุก instance ที่อายุถึงค่าสูงสุดได้ (อย่างน้อยหนึ่งวัน) และเครื่องที่มาแทนแต่ละตัวก็ถูก launch จาก launch template ปัจจุบันของ group นี่ก็คือ phoenix server ของ Fowler ในแบบอัตโนมัติ

### ตรวจหา drift

การปิด SSH เอาแหล่งหลักของ drift ออกไป แต่ไม่ใช่ทุกแหล่ง session แบบ break-glass ก็ยังเกิดขึ้น process ก็เขียนลงดิสก์ในเครื่อง และ rollout ก็อาจพลาด server บางเครื่อง ให้หา drift ในสองที่

- **ทุก server รัน image ที่ควรรันอยู่หรือเปล่า** เทียบ image ID หรือ digest ของแต่ละ instance ที่รันอยู่กับตัวที่อนุมัติไว้ ตัว AWS Config managed rule `approved-amis-by-id` จะ flag instance ที่ launch จาก AMI ไหนก็ตามที่ไม่อยู่ในรายการของคุณ และ Kubernetes admission policy ก็ปฏิเสธ pod ที่ image ไม่ได้ปักด้วย digest หรือไม่ได้มาจาก registry ของคุณได้
- **infrastructure รอบ ๆ ยังตรงกับโค้ดของมันอยู่หรือเปล่า** drift detection ของ AWS CloudFormation เทียบ resource ที่ deploy อยู่กับ template ของมัน โหมด refresh-only ของ Terraform แสดงรายการว่าอะไรเปลี่ยนไปนอก Terraform ตั้งแต่ apply ครั้งล่าสุด และ GitOps agent ก็รายงานทุกอย่างที่ out of sync

กฎข้อเดียวที่ทำให้ fleet ซื่อตรง: server ที่มีใครเคย login เข้าไป จะถูกแทนที่หลังจากนั้น

### Debug โดยไม่ต้อง login

การสืบสวนย้ายออกไปทำนอก server ตัว log, metric และ trace ออกจากแต่ละ server ไปทันทีที่เกิดขึ้น ([centralized logging](../centralized-logging/), [distributed tracing](../distributed-tracing/)) หลักฐานเลยอยู่ได้นานกว่า instance และเพราะ server เหมือนกันหมด ปัญหาที่เห็นใน production ปกติก็สร้างซ้ำได้ด้วยการ launch image เวอร์ชันเดียวกันที่อื่น ถ้าต้องดูข้างในจริง ๆ

- **Kubernetes ephemeral container** ที่ stable ตั้งแต่ Kubernetes 1.25 ทำให้ `kubectl debug` เพิ่ม container ชั่วคราวที่มีเครื่องมือ debug เข้าไปใน Pod ที่รันอยู่ได้ ช่วยได้มากที่สุดกับ image แบบ minimal ที่ไม่มี shell มาให้ ส่วนตัว ephemeral container เองจะไม่ถูก restart และไม่ได้มีไว้รันแอปพลิเคชัน
- **ฝั่ง virtual machine** security pillar ของ Well-Architected จัดให้การเข้า instance แบบ interactive ผ่าน SSH หรือ RDP เป็น anti-pattern ถ้าต้องเข้าแบบ interactive จริง ๆ มันแนะนำ AWS Systems Manager Session Manager โดยบันทึกกิจกรรมใน session ไว้ที่ Amazon CloudWatch Logs หรือ Amazon S3 เป็น audit trail
- **ระบบปฏิบัติการที่ออกแบบมาสำหรับ container** มีกฎนี้ฝังมาในตัว Bottlerocket ไม่มี SSH server มาให้ ไม่มีแม้แต่ shell ปิด administrative container (ตัวที่มี SSH server) ไว้เป็น default และอัปเดตด้วยการสลับ partition แทนการ patch package

เสร็จแล้วก็แทนที่ server ที่คุณเข้าไปดู

### ระบบที่มี state

immutability ทำง่ายที่สุดกับ tier ที่ stateless ส่วน state ต้องมีบ้านที่อายุไม่ผูกกับ instance

- **Managed service** เอา state ออกจาก server ของคุณไปทั้งหมด: managed database, object storage, managed cache และ queue บทความ *ImmutableServer* ของ Kief Morris ก็แนะนำแบบเดียวกัน: ตัดสินใจว่าข้อมูลไหนต้องอยู่ต่อขณะที่ server มา ๆ ไป ๆ ส่งข้อมูลอย่าง log file ออกจาก instance และถ้าทำได้ก็ยก database ให้ service ที่คนอื่นดูแล
- **Volume ที่อยู่นานกว่า instance** network volume ถอดออกจาก server ที่ถูก terminate แล้วไปต่อกับเครื่องที่มาแทนได้ เช็กว่าเกิดอะไรขึ้นตอน terminate: บน EC2 แต่ละ EBS volume มี attribute `DeleteOnTermination` และ root volume ที่ต่อไว้ตอน launch จะถูกลบไปพร้อม instance โดย default ส่วนใน Kubernetes ตัว PersistentVolume มี lifecycle ที่ไม่ขึ้นกับ Pod ไหน และ StatefulSet ก็ให้แต่ละ replica มี storage ที่ถาวร คงที่ และอยู่รอดแม้ถูก reschedule
- **Replication** ทำให้ node ที่มี state ถูกแทนที่ได้เหมือนตัวอื่น: member ใหม่เข้ามา คัดลอกข้อมูลจาก peer แล้วรับงานต่อ เลยไม่ต้องมีดิสก์ตัวไหนรอดเป็นการเฉพาะ

### Disaster recovery

ถ้าทุก server สร้างใหม่จาก image ได้ และทุก environment สร้างใหม่จากโค้ดได้ การกู้จาก region ที่หายไปก็คือการรันโค้ดเดิมกับอีก region ที่มี image คัดลอกไปรอไว้แล้ว เช่น EC2 Image Builder กระจาย image ใหม่แต่ละตัวไปที่ Region อื่นเป็นส่วนหนึ่งของ pipeline ได้ เส้นทางการ rebuild ถูกใช้จริงในทุกการ deploy เลยรู้ว่ามันใช้ได้ ต่างจาก runbook สำหรับ restore ที่แทบไม่เคยรู้แบบนั้นได้ แต่ข้อมูลก็ยังต้องมี backup หรือ replication ของตัวเอง เพราะ image เก็บ software ไม่ได้เก็บ state ดู [disaster recovery strategies](../disaster-recovery-strategies/)

## ใช้ตอนไหนดี

- **Fleet ของ server ที่สลับกันได้:** web tier และ API tier หลัง load balancer, worker, container host และอะไรก็ตามที่ scale out
- **Patch บ่อย หรือ compliance เข้มงวด** ที่ต้องแสดงได้ว่าอะไรรันอยู่ที่ไหน: ทุก server ย้อนกลับไปหา image ที่มีเวอร์ชัน ผ่านการสแกน และ sign แล้วได้
- **Autoscaling และ self-healing** ที่ทำงานได้ก็ต่อเมื่อ instance ใหม่เหมือนตัวอื่นทุกอย่างและพร้อมเร็ว
- **Container และ Kubernetes** ที่แนวทางนี้เป็น default อยู่แล้ว: image เป็น immutable และ pod ถูกแทนที่แทนที่จะถูก patch

**เริ่มจากตรงไหน** เริ่มจาก tier ที่ stateless สักหนึ่ง tier เขียน image recipe ของมัน build ใน pipeline แล้วแทนที่ server ของมันด้วย rolling update จากนั้นย้าย log ออกจาก instance ย้ายการตั้งค่าไปไว้ใน store ที่อ่านตอนเริ่มทำงาน แล้วปิด SSH ระหว่างนั้นก็ใช้ configuration management พร้อม drift detection กับส่วนที่เหลือของระบบต่อไป แล้วค่อยย้าย tier ถัดไปเมื่อ tier แรกน่าเบื่อแล้ว

**ตอนไหนไม่ควรใช้ หรือยังไม่ควรใช้:**

- **Host ที่สร้างใหม่ไม่ได้** ระบบ legacy ที่ติดตั้งด้วยมือมานานแล้ว appliance ของ vendor และ software ที่ license ผูกกับเครื่องเดียว เอาพวกนี้เข้า configuration management และ drift detection ก่อน แล้วเก็บวิธี build มันเป็นโค้ดให้ได้ก่อนจะลองแทนที่
- **State ที่ยังแยกออกไม่ได้** database server ตัวเดียวที่ข้อมูลอยู่บนดิสก์ในเครื่อง ต้องย้ายข้อมูลนั้นไปที่ volume แยก, replica set หรือ managed service ก่อน
- **Environment เล็ก ๆ ที่อยู่ไม่นาน** ที่ image pipeline เต็มรูปแบบจะแพงกว่า drift ที่มันกันได้

## ได้อะไร เสียอะไร

- **Pipeline คือการลงทุน** การ build image, เทสต์ boot, สแกน, sign, registry และการกระจายไปทุก region ต้องมีอยู่และเร็วพอ ก่อนที่ประโยชน์แรกจะโผล่มา
- **การแก้เล็ก ๆ ช้าลง** แก้บรรทัดเดียวใน image ก็ต้อง build ใหม่และ rollout ทั้ง fleet: ใช้เวลาเป็นนาที จากที่ SSH session ใช้แค่วินาที เอาการตั้งค่าที่เปลี่ยนบ่อยออกจาก image และทำ pipeline ให้เร็ว
- **เวลา boot แลกกับความยืดหยุ่น** image ที่ bake ครบเริ่มเร็ว แต่ต้อง rebuild ทุกครั้งที่เปลี่ยน ส่วน image บาง ๆ เปลี่ยนได้ถูก แต่ boot ช้าและเสี่ยง drift ตอน launch
- **Image งอกเต็มไปหมด** ทุกการ build คือเวอร์ชันใหม่ที่กิน storage จนกว่าจะมีคนลบ และ image เก่าที่มีช่องโหว่ที่รู้แล้วก็ยัง launch ได้ เก็บไว้ไม่กี่ตัวล่าสุดสำหรับ rollback แล้วให้ที่เหลือหมดอายุด้วย lifecycle policy ที่ทั้ง EC2 Image Builder และ Amazon ECR มีให้ใช้
- **Image ที่เสียจะไปอยู่ทุกที่พร้อมกัน** server ที่เหมือนกันก็พังเหมือนกัน health check, canary และ rollback ที่เร็วไปเวอร์ชันก่อนหน้า คือสิ่งที่ทำให้รับได้
- **Debug ต้องมี observability ก่อน** ถ้าไม่มี log, metric และ trace ที่ดี การปิด SSH ก็แค่ทำให้ทีมตาบอด
- **State ย้ายไปที่อื่น** ปกติก็ไปอยู่ใน managed service ที่มีค่าใช้จ่าย หรือไปอยู่กับการจัดการ volume และ replication ที่คุณต้องทำ automation เอง

## ข้อควรรู้ตอนลงมือทำ

- **Build ครั้งเดียว promote artifact ตัวเดิม** ย้าย image ตัวเดียว (digest หรือ AMI ID เดียว) จาก test ไป production แล้วฉีดแค่การตั้งค่าของแต่ละ environment การ rebuild ใหม่ทุก environment จะพาความต่างที่คุณตั้งใจจะกำจัดกลับมา
- **ทำให้เห็นเวอร์ชัน** ใส่เวอร์ชันของ image, commit ต้นทาง และเวลา build ไว้ใน metadata ของ image, tag ของ instance และ health endpoint ของแอปพลิเคชัน คนอื่นจะได้ดูได้ว่า server รันอะไรอยู่โดยไม่ต้อง login
- **Bake agent เข้าไปด้วย** log shipper, metrics agent และ security agent เป็นส่วนหนึ่งของ image และเริ่มพร้อม server ส่วน server ที่ต้องตามแก้หลัง launch ก็ไม่ใช่ immutable
- **พังให้เร็วตอน boot** ถ้าตอนเริ่มทำงานดึงการตั้งค่าหรือ secret ที่จำเป็นมาไม่ได้ ตัว server ควร fail health check แล้วถูกแทนที่ ไม่ใช่รันไปทั้งที่ตั้งค่าได้แค่ครึ่งเดียว
- **ปิดประตู** เอา SSH key และ port สำหรับจัดการที่รับ traffic ขาเข้าออกจาก image และ security rule เก็บทาง break-glass ที่มีการบันทึกและ review ไว้ และแทนที่ server ทุกเครื่องที่ใช้ทางนั้น
- **ทำให้ rollback น่าเบื่อ** image เวอร์ชันก่อนหน้ายังต้อง launch ได้และผ่านการเทสต์ การ rollback คือการ deploy เวอร์ชันเก่ากว่าแบบธรรมดา ไม่ใช่การ restore
