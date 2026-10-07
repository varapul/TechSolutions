## ปัญหา

ทีม checkout ของ Acme Shop review ทุก pull request แต่ไม่มีอะไรพิสูจน์ได้ว่า image ที่รันอยู่ใน production ถูก build มาจากโค้ดที่ review แล้วนั้นจริง ๆ ตัว image ออกมาจาก `build-01` ที่เป็น Jenkins VM รันมาตั้งแต่ปี 2019 ถูก patch ด้วยมือ และให้คน 23 คน login เข้าไปได้ บางครั้งก็มีคนไป build บน laptop แทน ส่วน package ก็ดึงตรงจาก npm registry สาธารณะ เลยแค่พิมพ์ผิดไปตัวเดียว (`lodahs` แทน `lodash`) ก็จะติดตั้งอะไรก็ได้ที่ attacker publish ไว้ใต้ชื่อนั้น ตัว cluster deploy `checkout:latest` ที่เป็น tag ที่ใครก็ตามที่มีสิทธิ์ push ย้ายไปชี้ image อื่นได้ และไม่มีใครเก็บรายการว่าในแต่ละ image มีอะไรอยู่บ้าง: ตอนที่มีประกาศช่องโหว่ระดับ critical ใน library ยอดนิยม ต้องใช้เวลาสี่วันในการค้นใน repository ถามเก้าทีม และเปิด shell เข้าไปใน pod ที่รันอยู่ เพื่อหาว่า service ไหนใน 38 ตัวที่ ship มันไป และยังมีสอง image ที่สาวกลับไปหา repository ไหนไม่ได้เลย (ตัวเลขของ Acme ในหน้านี้เป็นของตัวอย่างนี้เอง ไม่ใช่ผลการวิจัย)

ช่องโหว่ทุกข้อนี้เคยถูกใช้ในการโจมตีจริงมาแล้ว:

- **Build** ในเหตุ SolarWinds ที่เปิดเผยในเดือนธันวาคม 2020 ตัว backdoor ถูกใส่เข้าไประหว่าง build บทวิเคราะห์ของ CrowdStrike เกี่ยวกับตัว implant ชื่อ SUNSPOT (มกราคม 2021) อธิบายถึงโปรแกรมบน build server ที่รอ build ของ product Orion แล้วสลับไฟล์ source หนึ่งไฟล์ระหว่าง compile ทำให้ update ที่ ship ออกไปมี backdoor SUNBURST ติดไปด้วย
- **Artifact ที่ถูกแก้หลัง build** ตั้งแต่ 31 มกราคม 2021 attacker แก้ script Bash Uploader ของ Codecov ซ้ำหลายครั้ง โดยใช้ credential ที่ดึงออกมาได้ผ่านข้อผิดพลาดในกระบวนการสร้าง Docker image ของ Codecov แล้วตลอดราวสองเดือน script นี้ก็ส่ง environment variable ของ CI job ของผู้ใช้ไปให้ attacker (security update ของ Codecov, เมษายน 2021)
- **Dependency** ตัว backdoor ใน xz utils (CVE-2024-3094) ที่ Andres Freund รายงานเมื่อ 29 มีนาคม 2024 อยู่ใน release tarball ของ upstream เวอร์ชัน 5.6.0 และ 5.6.1 บางส่วนของมันมีอยู่แค่ใน tarball พวกนั้น ไม่ได้อยู่ใน Git repository ส่วน payload ของมันซ่อนอยู่ในไฟล์ test ที่อยู่ใน repository แล้วรายการตัวอย่างจากโลกจริงของ SLSA เองก็ยังเพิ่ม typosquatting (package อันตรายที่ตั้งชื่อคล้าย package ยอดนิยม) และกรณี event-stream ที่ attacker ที่คุม dependency ที่ดูไม่มีพิษภัยได้ publish เวอร์ชันอันตรายที่ไม่ตรงกับการเปลี่ยนแปลงใด ๆ ใน source code ของมันเลย
- **ไม่มีรายการของในซอฟต์แวร์** Log4Shell (CVE-2021-44228) ที่ถูก exploit กันอย่างกว้างขวางตั้งแต่ธันวาคม 2021 ทำให้องค์กรต่าง ๆ ต้องไล่หาทุก copy ของ library log4j-core เวอร์ชัน 2.0-beta9 ถึง 2.14.1 ที่หลายครั้งก็ฝังอยู่ในซอฟต์แวร์ตัวอื่น

Software supply chain security ปิดช่องโหว่พวกนี้ด้วยการให้ทุก artifact มีหลักฐานที่ verify ได้ว่ามันมาจากไหนและข้างในมีอะไร และตรวจหลักฐานนั้นก่อนที่อะไรจะได้รัน

## ทำงานยังไง

**SLSA** (Supply-chain Levels for Software Artifacts อ่านว่า "salsa") คือ framework จาก Open Source Security Foundation (OpenSSF): เป็นชุดของ requirement ที่นำมาใช้ได้ทีละ level เวอร์ชัน 1.2 ที่ออกเมื่อ 24 พฤศจิกายน 2025 จัด requirement เป็นสอง **track** แต่ละ track มี **level** ของตัวเอง:

- **Build track** (L0 ถึง L3) ว่าด้วยการผลิต artifact ขึ้นมาว่าทำยังไง และเชื่อ provenance ของมันได้แค่ไหน
- **Source track** (L1 ถึง L4) ที่เพิ่งมีในเวอร์ชัน 1.2 ว่าด้วยการผลิต source revision ว่าทำยังไง: L1 คือมี version control, L2 คือมี history ต่อเนื่องที่เก็บไว้พร้อม source provenance, L3 คือมี technical control ที่ระบบ source control บังคับใช้บน protected branch และ L4 คือทุกการเปลี่ยนแปลงต้องผ่าน review จากสองฝ่าย

Threat model ของ SLSA ระบุจุดที่การโจมตีเกิดขึ้น และ diagram ก็ใช้ตัวอักษรตามนั้น Source threat: (A) producer ที่ประสงค์ร้าย (B) contributor ที่ไม่มีสิทธิ์พิเศษเอา change ที่เจ้าของไม่ได้ตั้งใจเข้าไปใน source ได้ เช่น change ที่ข้ามการ review (C) การเจาะระบบ source control ส่วน build threat: (D) build จาก source, branch หรือ parameter ที่ผิด (E) การแก้ไขกระบวนการ build (F) การ publish artifact ที่ไม่ได้ build จาก source ทางการ (G) การเอาของอื่นมาแทนมันใน distribution channel ส่วน usage threat: (H) เลือก package ผิด ผ่าน typosquatting หรือ dependency confusion และ (I) ใช้มันแบบไม่ปลอดภัย เพิ่มเติมจากนั้นยังมี dependency threat (ทุกข้อข้างบนแต่ลงไปอีกชั้นหนึ่ง), availability threat และ verification threat ส่วนตัวอย่างจากโลกจริงของ SLSA ก็จับคู่ SolarWinds กับ (E) Codecov กับ (F) และ typosquatting กับ (H)

กลไกสี่อย่างตอบ threat เหล่านี้ได้เกือบทั้งหมด

**1. Provenance** ตัว build platform บันทึกว่ามัน build artifact ตัวไหน (ตาม digest) builder ตัวไหนเป็นคนรัน จาก source revision ไหน และใช้ top-level parameter อะไร ส่วน SLSA แนะนำ format ของตัวเองคือ **in-toto attestation**: *statement* ผูก *subject* (ในที่นี้คือ `checkout@sha256:9f2c41…`) เข้ากับ *predicate* ชนิด `https://slsa.dev/provenance/v1` ตัว predicate นี้เก็บ `buildDefinition` (ชนิดของ build, external parameter เช่น repository, ref และ workflow และ dependency ที่ resolve แล้ว) และ `runDetails` (ID ของ builder และ metadata ของการรัน) ส่วน *envelope* ที่แนะนำให้ใช้ format DSSE ก็เป็นตัวถือ signature ตัว in-toto attestation framework ที่เป็น CNCF project นิยาม layer เหล่านี้ และ envelope เดียวกันก็ใช้ถือ predicate แบบอื่นได้ด้วย: SBOM ผล test และผล vulnerability scan

Build level ของ SLSA v1.2 บอกว่าเชื่อ provenance ได้แค่ไหน:

| Level | สิ่งที่ build ต้องมี | ป้องกันอะไรได้ |
|---|---|---|
| **L0** | ไม่มี | ไม่มี |
| **L1** | กระบวนการ build ที่สม่ำเสมอ และ platform เป็นคนสร้าง provenance | ความผิดพลาดระหว่าง release แต่ไม่ป้องกันการแก้ไข เพราะ provenance ที่ไม่ได้ sign ปลอมได้ง่าย |
| **L2** | hosted build platform ที่สร้างและ sign provenance | การแก้ไขหลัง build |
| **L3** | platform ที่ hardened แล้ว: build แต่ละครั้งแยกขาดจากกัน มี environment ใหม่ทุกครั้ง ไม่มี cache ที่ build หนึ่งจะวางยาให้อีก build ได้ และ signing secret อยู่พ้นมือของ step ใน build เอง | การแก้ไขระหว่าง build รวมถึงโดยคนใน และโดยใช้ credential ที่ขโมยมา |

**2. SBOM** ตัว software bill of materials ลิสต์ component ของ artifact: ชื่อ เวอร์ชัน package URL (purl) license และการ depend กันระหว่าง component มีสอง format ที่ครองตลาด **SPDX** ที่เป็น project ของ Linux Foundation เป็นมาตรฐานสากล (ISO/IEC 5962:2021) และอยู่ที่เวอร์ชัน 3.0 ส่วน **CycloneDX** ที่เป็น project ของ OWASP ได้รับการรับรองเป็นมาตรฐานโดย Ecma International ในชื่อ ECMA-424 และอยู่ที่เวอร์ชัน 1.7 เครื่องมืออย่าง Syft, Trivy หรือ `docker buildx build --sbom=true` สร้าง SBOM จาก image ได้ ส่วนตัว SBOM เองเป็นแค่รายการของ ไม่ใช่คำตัดสิน: มันจะคุ้มก็ต่อเมื่อมีอะไรมา query มัน เช่น scanner (ทั้ง Grype และ Trivy scan SBOM ได้) หรือ platform อย่าง OWASP Dependency-Track ที่ติดตาม component ของทุก application ใน portfolio และแจ้งตัวที่โดนผลกระทบจากช่องโหว่ที่เพิ่งเป็นที่รู้จัก

**3. Sign โดยไม่ต้องเก็บ key** ตัว **cosign** ของ Sigstore สร้าง key pair ไว้ใน memory แลก OpenID Connect token ของ CI job เป็น certificate จาก **Fulcio** ที่เป็น certificate authority ของ Sigstore แล้ว sign digest ของ image และบันทึก signature ลง **Rekor** ที่เป็น transparency log ส่วน certificate ของ Fulcio ใช้ได้ 10 นาที และ private key ไม่เคยแตะ disk เลยไม่มี key อายุยาวให้ขโมย สำหรับ workload ของ CI ตัว certificate จะระบุ workflow ที่ sign, repository, ref และ commit และบอกว่า runner เป็นแบบ platform-hosted หรือ self-hosted ฝั่ง verifier ก็ตรวจ identity นั้นกับ issuer ของ token เช่น `cosign verify --certificate-identity https://github.com/acme/checkout/.github/workflows/release.yml@refs/heads/main --certificate-oidc-issuer https://token.actions.githubusercontent.com` ส่วน artifact attestation ของ GitHub (action `actions/attest`) ก็สร้างบนชิ้นส่วนเดียวกัน: มันสร้าง SLSA provenance ที่ sign แล้ว และ SBOM attestation จากไฟล์ SPDX หรือ CycloneDX ทาง GitHub เขียนไว้ใน documentation ว่าตัวมันเองเข้าเกณฑ์ SLSA v1.0 Build L2 และเข้าเกณฑ์ Build L3 เมื่อ build รันใน reusable workflow ที่แยกมันออกจาก workflow ที่เรียก

**4. Verify ก่อน deploy** ทั้งหมดนี้ไม่ได้ปกป้องอะไรเลยจนกว่าจะมีคนตรวจ ขั้นตอน verify artifact ของ SLSA (v1.2) มีสองขั้นหลัก: ยืนยันว่า provenance ถูก sign โดย builder ที่เราเชื่อถือ ที่ level ที่เราเชื่อถือ และ subject ของมันตรงกับ digest ของ artifact แล้วเทียบมันกับสิ่งที่เราคาดไว้ เช่น ชนิดของ build, repository, branch และ workflow แล้วปฏิเสธอะไรก็ตามที่ไม่รู้จัก ส่วนขั้นที่สามที่จะทำหรือไม่ก็ได้คือตรวจแบบเดียวกันซ้ำกับ dependency ของ artifact ส่วนบน Kubernetes ตัว admission controller เป็นคนตรวจเรื่องนี้กับทุก pod: Kyverno ที่มี rule `verifyImages` (หรือ type ใหม่กว่าคือ ImageValidatingPolicy) หรือ Sigstore **policy-controller** ที่มี `ClusterImagePolicy` ทั้งสองตัวทำให้แน่ใจว่า image ที่ verify แล้วคือตัวที่ได้รันจริง: setting `mutateDigest` ของ Kyverno ที่เปิดไว้เป็น default จะเติม digest ให้ image reference ที่ระบุแค่ tag ส่วน policy-controller ก็ resolve tag เป็น digest ตอน admission

**Framework ที่เกี่ยวข้อง** ตัว *Secure Software Development Framework* ของ NIST (SSDF, SP 800-218 เวอร์ชัน 1.1 กุมภาพันธ์ 2022) จัด practice ด้านการพัฒนาซอฟต์แวร์ที่ปลอดภัยเป็นสี่กลุ่ม: เตรียมองค์กร ปกป้องซอฟต์แวร์ ผลิตซอฟต์แวร์ที่ปลอดภัย และตอบสนองต่อช่องโหว่ กลุ่ม *Protect the Software* ตรงกับหน้านี้มาก: ปกป้องโค้ดทุกรูปแบบจากการถูกแก้ไข (PS.1) ให้คนที่รับซอฟต์แวร์ของเราไปมีวิธี verify ความถูกต้องของ release (PS.2) และเก็บถาวรแต่ละ release ไว้พร้อมข้อมูล provenance ของทุก component เช่น SBOM (PS.3.2) ส่วน NIST ก็เผยแพร่ initial public draft ของ Revision 1 (SSDF เวอร์ชัน 1.2) ในเดือนธันวาคม 2025 ส่วน dependency ที่เป็น open source ก็มี **OpenSSF Scorecard** ที่ให้คะแนน project ด้วย check อัตโนมัติ เช่น Pinned-Dependencies, Signed-Releases, Code-Review, Branch-Protection, Dangerous-Workflow และ Maintained แต่ละตัวให้คะแนนตั้งแต่ 0 ถึง 10

## ลงมือทำจริงยังไง

1. **เริ่มจากรายการของ** สร้าง SBOM ให้ทุก image ใน pipeline (Syft, Trivy หรือ BuildKit) ผูกไว้กับ digest ของ image แล้วส่งเข้า index ที่คอยเฝ้า advisory ใหม่ ๆ (เช่น Dependency-Track) แค่นี้ก็เปลี่ยนการไล่หาสี่วันของ Acme ให้กลายเป็น query เดียว: ตอนที่ CVE ระดับ critical ตัวถัดไปประกาศตอน 09:00 ตัว index ก็ลิสต์สาม service ที่โดนผลกระทบ คือ checkout, search และ delivery ได้ตอน 09:06
2. **Build บน platform ที่ hosted และใช้แล้วทิ้ง** ตัว GitHub-hosted runner สร้าง VM ใหม่ให้แต่ละ job และทิ้งมันเมื่อ job จบ ทางเลือกอื่นก็มี hosted GitLab runner, Google Cloud Build และ AWS CodeBuild แล้วก็เอา interactive login เข้าเครื่อง build ออก และ build release จาก commit ที่ review แล้วบน protected branch เท่านั้น
3. **ให้ platform เป็นคนเขียน provenance:** ใช้ `actions/attest` ของ GitHub, SLSA GitHub generator หรือ provenance attestation ของ BuildKit (`docker buildx build --provenance=mode=max`) แล้วเก็บไว้ข้าง image ส่วน Acme ถึง Build L1 ก่อน แล้วค่อยถึง L2 เมื่อ hosted platform เป็นคน sign provenance
4. **Sign digest** ใช้ keyless signing ของ cosign จาก release workflow หรือใช้ key ที่อยู่ใน key management service (cosign รับ key reference แบบ `awskms://`, `gcpkms://`, `azurekms://` และ `hashivault://`) ถ้าใช้ Sigstore service สาธารณะไม่ได้
5. **Deploy ด้วย digest และ verify ตอน admission** ให้ pin image ด้วย digest ใน manifest (ถ้าใช้ GitOps ตัว pipeline จะเปิด pull request เพื่ออัปเดต digest) เปิด tag immutability ใน registry (Amazon ECR มี setting ให้) และบังคับใช้ policy ที่ระบุ signer identity, issuer, repository, branch และ builder ที่คาดไว้ (Acme ใช้ Sigstore policy-controller กับ `ClusterImagePolicy`) ให้รันใน audit mode เป็นช่วงสั้น ๆ ที่กำหนดวันจบไว้ แก้สิ่งที่มันรายงาน แล้วค่อย enforce โดยเก็บเส้นทาง break-glass ที่มี log ไว้สำหรับเหตุฉุกเฉิน
6. **Pin และกลั่นกรอง dependency** ให้ commit lockfile ที่มี integrity hash (`package-lock.json` ของ npm บันทึกไว้ให้ทุก package) แล้ว pin base image และ CI action ด้วย digest หรือ commit SHA จากนั้นให้ update bot (Dependabot หรือ Renovate) คอยอัปเดต pin ผ่าน pull request เล็ก ๆ ที่มีคน review เวลาจะรับ dependency ตัวใหม่เข้ามาใช้ก็ดู Scorecard ของมันก่อน และลองพิจารณา proxy registry ที่ serve เฉพาะ package ที่อนุมัติแล้ว
7. **ยก build ขึ้นเป็น L3** ย้ายการสร้าง provenance และการ sign เข้าไปใน reusable workflow หรือ trusted builder ที่ step ใน build ไปยุ่งไม่ได้ แยก cache ของ workflow ที่ไม่น่าเชื่อถือออกจาก release workflow และให้สิทธิ์ขอ identity token (`id-token: write` บน GitHub) เฉพาะ job ที่ sign เท่านั้น
8. **ปกป้อง source** ใช้ branch protection และ required review ส่วน Source L4 ต้องการให้คนที่เชื่อถือได้สองคน เช่น ผู้เขียนกับ reviewer เห็นชอบกับทุกการเปลี่ยนแปลงบน protected branch และ review ต้องครอบคลุมส่วนของโค้ดที่เกี่ยวกับ security
9. **วัดผล:** สัดส่วนของ image ใน production ที่มี provenance และ SBOM, สัดส่วนของ admission ที่ enforce จริงแทนที่จะแค่ audit, จำนวนและอายุของ policy exception และเวลาที่ใช้ตอบคำถาม "image ไหนมี library ตัวนี้อยู่?"

## อยู่ตรงไหนใน solution

- [Continuous Delivery](../continuous-delivery/) build image ครั้งเดียวแล้ว promote digest ตัวเดิมผ่านทุก stage ส่วน supply chain security พิสูจน์ว่า digest นั้นมาจากไหน และตรวจมันก่อน deploy ทุกครั้ง
- [Immutable Infrastructure](../immutable-infrastructure/) เปลี่ยน image ใหม่แทนการ patch ตัวเดิม นี่คือสิ่งที่ทำให้ digest เป็นของที่คงที่พอจะ sign และ verify ได้
- [GitOps](../gitops/) เก็บ digest ไว้ใน Git: pull request ที่ review แล้วเป็นตัวเปลี่ยน digest ตัว agent เป็นคน apply และ admission policy ก็ verify มันระหว่างทางเข้า cluster
- [Docker](../docker/) ผลิต image, layer และ digest และ BuildKit ก็แนบ provenance และ SBOM attestation ไปกับมันได้
- Admission control ของ [Kubernetes](../kubernetes/) คือจุดที่การตรวจตอน deploy ทำงาน
- [Policy as Code](../policy-as-code/) พูดถึงการเขียน การ test และการ roll out กฎแบบ admission policy ส่วนหน้านี้พูดถึงหลักฐานที่กฎพวกนั้นตรวจ
- [Zero Trust Access](../zero-trust-access/) ใช้แนวคิดเดียวกันกับ request: ไม่เชื่ออะไรเพียงเพราะมันมาจากที่ไหน ให้ verify อย่างชัดแจ้ง ในที่นี้ image ก็ไม่ได้รับความเชื่อถือเพียงเพราะมันอยู่ใน registry ของบริษัท
- [Vault](../vault/) หรือ key management service ของ cloud เก็บ signing key ไว้เมื่อใช้ keyless signing ไม่ได้ เพื่อไม่ให้มี key อยู่บนเครื่อง build
- [Golden Paths](../golden-paths/) ทำให้เรื่องนี้เป็นค่า default: pipeline template แบบ paved road ที่สร้าง SBOM และ provenance และ sign ทุก image ไว้ให้อยู่แล้ว

## ใช้ตอนไหนดี

คุ้มสำหรับทุกทีมที่ ship container หรือ package ขึ้น production และพึ่ง open source ก็คือแทบทุกทีม และคุ้มที่สุดกับ shared platform ที่ hosted builder ตัวเดียวและ admission policy ชุดเดียวครอบคลุมทุก service ส่วนอีกสองกลุ่มคือสภาพแวดล้อมที่อยู่ใต้ regulation ที่ต้องแสดงว่าซอฟต์แวร์มาจากไหน (SSDF practice, แบบสอบถามด้าน security จากลูกค้า) และผู้ผลิต open source ที่ผู้ใช้ verify provenance ได้ก่อนติดตั้ง

ปรับให้เข้ากับบริบท:

- **ทีมเล็ก** ได้ value ส่วนใหญ่จาก hosted CI, attestation ของ GitHub หรือของ BuildKit, การ scan SBOM ใน CI และ admission policy หนึ่งชุด ส่วน Build L3 และ Source track มาทีหลังได้
- **โค้ด private กับ log สาธารณะ** ทาง GitHub บอกว่า attestation จาก public repository จะไปที่ Sigstore instance สาธารณะ ที่ใครก็อ่าน transparency log ได้ ส่วน private repository ใช้ Sigstore instance ของ GitHub เอง ที่ไม่มี transparency log เราเลยต้องตัดสินใจว่าชื่อ repository และ workflow ไปโผล่ใน log สาธารณะได้ไหม ถ้าไม่ได้ ก็ใช้ private instance หรือ key ที่อยู่ใน key management service
- **ซอฟต์แวร์ legacy และที่รันบน VM** เริ่มจาก SBOM และ checksum ที่เผยแพร่ไว้ได้ ส่วน provenance และ admission control ค่อยตามมาพร้อม container

มันมีต้นทุนมากกว่าที่ได้คืนสำหรับ prototype ที่ใช้แล้วทิ้ง และ build ที่มีไว้แค่ป้อน automated test: GitHub แนะนำว่าไม่ต้อง sign build สำหรับ test ที่เกิดบ่อยแบบนี้ และมันก็ไม่ได้มาแทน review, testing หรือ vulnerability management: มันทำให้สิ่งเหล่านั้นตามรอยได้

## กับดักที่เจอบ่อย

- **สร้าง SBOM แต่ไม่เคยอ่าน** ไฟล์ที่อยู่ใน registry เฉย ๆ ไม่ได้ตอบคำถามอะไร ให้ index มัน ตั้ง alert เมื่อมี advisory ใหม่ และซ้อมตอบคำถาม "image ไหนมี library ตัวนี้อยู่?" ไว้ก่อนที่ incident จะมาถาม
- **Signature ที่ไม่มีใคร verify** เอกสารของ GitHub บอกไว้ตรง ๆ ว่า attestation ไม่ได้ช่วยด้าน security อะไรเลยจนกว่าจะมีคน verify มัน ให้ enforce ตอน admission และใช้ audit mode เป็นแค่ช่วงเปลี่ยนผ่านที่กำหนดวันจบไว้ เพราะ policy ที่แค่ log ไม่ได้ block อะไร
- **ตรวจว่า "sign หรือยัง?" แทนที่จะตรวจว่า "ใคร sign?"** ใครก็ขอ keyless signature ที่ valid สำหรับ identity ของตัวเองได้ ให้ pin signer ตัวที่แน่นอน (path และ ref ของ workflow) กับ issuer และตรวจ builder และ source ใน provenance
- **ถือว่า provenance คือหลักฐานว่าปลอดภัย** ตัว provenance บันทึกว่า artifact ถูก build ที่ไหนและยังไง ไม่ได้บอกว่าโค้ดของมันดีหรือเปล่า: payload ของ xz อยู่ในไฟล์ test ของ repository เอง และที่ Build L2 มันก็ไม่ได้พิสูจน์ว่าตัว build เองสะอาด เมื่อ 11 พฤษภาคม 2026 attacker publish เวอร์ชันอันตราย 84 เวอร์ชันของ npm package `@tanstack` 42 ตัว โดยมี provenance ที่ valid: pull request ตัวหนึ่งวางยา build cache ไว้ แล้วโค้ดจาก cache นั้นก็อ่าน identity token ของ release workflow ออกมาจาก memory ของ runner (SLSA blog, พฤษภาคม 2026) ให้เก็บ review, test และ scanning ไว้ ขยับไปทาง isolation ระดับ Build L3 และตั้ง alert เมื่อมี release จาก workflow run ที่ fail หรือดูผิดปกติ
- **Verify tag แล้วค่อย pull ทีหลัง** ตัว tag ย้ายได้ในช่วงระหว่างการตรวจกับการ pull ให้ verify digest และรัน digest นั้น
- **Exception ที่ไม่มีวันหมดอายุ และ policy ที่ไม่มีใคร review** ตัว SLSA เองระบุการแก้ไขสิ่งที่ verifier คาดไว้เป็น threat แยกต่างหาก ให้ review การเปลี่ยน policy เหมือนโค้ด และให้ทุก exception มีเจ้าของและวันสิ้นสุด
- **ลืม supply chain ของ dependency เอง** ตอนนี้ SLSA v1.2 ยังไม่ได้รับมือกับ dependency threat โดยตรง คำแนะนำของมันคือใช้ SLSA แบบ recursive ส่วนเราก็ควรเลือก package ที่ publish provenance, pin เวอร์ชันและ hash, กลั่นกรอง dependency ใหม่ด้วย Scorecard และ mirror ของที่ใช้อยู่
- **คาดหวังให้ provenance หยุด typosquat ได้** ตัว SLSA ไม่ได้รับมือกับ typosquatting ส่วนทางที่ใช้ได้คือ review การเปลี่ยนแปลงของ lockfile ทำ allow-list ของ package หรือ serve package ผ่าน proxy registry ที่คัดไว้แล้ว
