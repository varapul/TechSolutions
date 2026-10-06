## ปัญหา

โมเดลแบบ perimeter ตอบคำถามแค่ข้อเดียว และตอบครั้งเดียว: *connection นี้มาจากข้างในหรือเปล่า* firewall กันคนข้างนอกไว้ข้างนอก ส่วน VPN พาพนักงานที่อยู่ไกล "เข้ามา" ข้างใน แล้วระบบหลังกำแพงก็ยอมรับกันเองส่วนใหญ่เพราะ address ที่ connection นั้นมาจาก ดีไซน์แบบนี้พังได้สามทาง

- **ตรวจครั้งเดียว แล้วก็ไม่ตรวจอีกเลย** password VPN ที่โดนขโมย session ที่โดน phishing หรือ laptop ที่มี malware อยู่ ก็อยู่ข้างในทันทีที่ connect เข้ามา จากตรงนั้นผู้บุกรุกก็ลามไปด้านข้างได้ (*lateral movement*): เริ่มจากอะไรที่ไม่สำคัญ แล้วค่อย ๆ กระโดดทีละ hop ไปถึงอะไรที่สำคัญ เพราะไม่มีอะไรข้างในที่ถูกสร้างมาให้ถามว่าใครเป็นคนเรียก
- **ไม่มี "ข้างใน" อีกแล้ว** คนทำงานจากบ้านและจากมือถือ แอปพลิเคชันรันเป็น SaaS และอยู่บนหลาย cloud ส่วน contractor กับ partner ก็ต้องได้สิทธิ์เข้าถึงบางส่วน ไม่มีเส้นไหนเส้นเดียวที่ล้อมทั้งหมดนี้ไว้ได้ การบังคับให้ทุก connection วนกลับผ่าน VPN concentrator เพื่อทำเหมือนว่ามีเส้นนั้นอยู่ ทำให้ latency เพิ่ม และทำให้อุปกรณ์ทุกเครื่องที่ connect เข้ามามีเส้นทางไปถึงอะไรต่ออะไรมากกว่าที่ต้องใช้เยอะ
- **ไม่มีใครตรวจความเชื่อใจนั้นเลย** IP address ไม่ได้บอกอะไรเลยว่าใครนั่งอยู่หน้าคีย์บอร์ด อุปกรณ์ลง patch แล้วหรือยัง หรือ request นี้แปลกไปสำหรับคนคนนี้หรือเปล่า ความเชื่อใจที่แจกให้ตรงขอบเป็นแบบ *โดยปริยาย* (implicit): ไม่มีใครตัดสินจากหลักฐานสำหรับ request นี้ และไม่มีใครเอาคืนตอนที่หลักฐานเปลี่ยน

NIST เรียกพื้นที่หลังด่านตรวจว่า **implicit trust zone** และเทียบกับสนามบิน: พอผ่านด่าน security มาแล้ว ทุกคนในโซนขึ้นเครื่องก็ได้รับความเชื่อใจเท่ากันหมด internal network แบบ flat ก็คือโซนขึ้นเครื่องที่ใหญ่มาก ๆ เป้าหมายคือหดโซนนั้นให้เล็กที่สุดเท่าที่ทำได้ ถ้าให้ดีก็เหลือแค่ resource เดียว

## ทำงานยังไง

**คำพวกนี้หมายถึงอะไร** *Zero trust* คือวิธีตัดสินเรื่องการเข้าถึงที่ไม่เชื่อ request ไหนเพียงเพราะมันมาจากที่ไหน ไม่ว่าจะเป็น LAN ในออฟฟิศ data centre หรือ VPN ก็ตาม ทุก request ไปยังทุก resource ต้องผ่านการ authenticate และ authorize จากหลักฐานปัจจุบัน และได้สิทธิ์น้อยที่สุดที่พอให้งานเสร็จ ในภาษาของ NIST ตัว zero trust คือชุดของแนวคิด ส่วน *zero trust architecture* คือแผนขององค์กรหนึ่งที่จะเอาแนวคิดพวกนั้นมาใช้ มันเป็นกลยุทธ์และ architecture ไม่ใช่ product: ไม่มีการซื้ออะไรครั้งเดียวที่ได้มันมา และส่วนประกอบส่วนใหญ่ (identity provider, การจัดการอุปกรณ์, gateway, log) ก็เป็นของที่องค์กรรันอยู่แล้ว มันไม่ได้แปลว่าไม่เชื่ออะไรเลยด้วย ความเชื่อใจยังถูกให้อยู่ตลอดทั้งวัน สิ่งที่หายไปคือความเชื่อใจที่เป็นแบบโดยปริยาย ถาวร และได้มาจากตำแหน่งใน network

**มาจากไหน**

- **De-perimeterisation** ตัว Jericho Forum เป็นกลุ่ม CISO ของบริษัทต่าง ๆ ที่เริ่มเจอกันแบบไม่เป็นทางการตั้งแต่ปี 2003 และก่อตั้งขึ้นใต้ The Open Group ในเดือนมกราคม 2004 กลุ่มนี้เสนอว่า network perimeter กำลังสึกกร่อน และการป้องกันต้องย้ายไปอยู่ที่ระบบและข้อมูล "commandments" ของกลุ่ม (version 1.2 ลงวันที่พฤษภาคม 2007) ก็กำหนดไว้แล้วว่าอุปกรณ์ทุกเครื่องต้องรักษาความปลอดภัยของตัวเองได้บน network ที่เชื่อไม่ได้
- **ชื่อเรียก** John Kindervag ที่ตอนนั้นเป็น analyst ของ Forrester ก็ตั้งชื่อโมเดลนี้ว่า *zero trust* ในรายงานที่ตีพิมพ์วันที่ 14 กันยายน 2010 ชื่อ *No More Chewy Centers: Introducing the Zero Trust Model of Information Security*
- **BeyondCorp** ตั้งแต่เดือนธันวาคม 2014 ทาง Google เล่าไว้ในบทความชุดหนึ่งใน *;login:* ว่าย้ายพนักงานของตัวเองออกจาก intranet ที่มีสิทธิ์พิเศษยังไง แอปพลิเคชันภายในเข้าถึงได้ผ่าน access proxy ที่หันหน้าออก internet การเข้าถึงขึ้นกับ user และอุปกรณ์ที่ managed โดยอุปกรณ์นั้นต้องถูกบันทึกอยู่ใน device inventory และระบุตัวด้วย certificate ส่วน network ในออฟฟิศก็กลายเป็น network ที่ไม่มีสิทธิ์พิเศษ และไม่มีใครต้องใช้ VPN
- **NIST SP 800-207** (สิงหาคม 2020) ทำให้โมเดลนี้เป็นกลางไม่ผูกกับ vendor: มี tenet เจ็ดข้อ และมีส่วนประกอบเชิงตรรกะที่ diagram นี้ใช้ ส่วน SP 800-207A (กันยายน 2023) ขยายไปถึงแอปพลิเคชันแบบ cloud-native ที่กระจายอยู่บนหลาย cloud โดยเขียน policy ด้วย service identity ไม่ใช่แค่ network address ส่วน SP 1800-35 (มิถุนายน 2025) บันทึกตัวอย่าง implementation 19 แบบที่ NCCoE ของ NIST สร้างจาก product เชิงพาณิชย์ร่วมกับผู้ร่วมงาน 24 ราย

**ส่วนประกอบ** diagram นี้ใช้คำศัพท์ตาม NIST:

- **subject** คือผู้ขอเข้าถึง: คนบนอุปกรณ์เครื่องหนึ่ง หรือ workload
- **policy enforcement point (PEP)** ยืนขวางทางไปยัง resource มันเปิด คอยดู และปิด connection และไม่ปล่อยอะไรผ่านจนกว่าจะได้รับคำสั่ง มันเป็น component เดียวก็ได้ (proxy หรือ portal ที่อยู่หน้า resource) หรือเป็นสองตัวก็ได้ (agent บนอุปกรณ์ กับ gateway ที่อยู่หน้า resource)
- **policy decision point (PDP)** มีสองส่วน ตัว **policy engine** ตัดสินว่าจะให้ ปฏิเสธ หรือ revoke การเข้าถึง โดยเอา policy ขององค์กรมาใช้กับสัญญาณที่มี แล้วบันทึกคำตัดสินนั้นไว้ ส่วน **policy administrator** ทำตามคำตัดสิน: สั่งให้ PEP เปิดหรือปิดเส้นทาง และออก credential เฉพาะ session ที่ client ต้องใช้ ส่วน product หลายตัวมักรวมสองส่วนนี้เป็นอันเดียว
- PDP กับ PEP คุยกันผ่าน **control plane** ที่แยกจาก **data plane** ที่ส่ง traffic ของแอปพลิเคชัน
- รอบ ๆ มีแหล่งข้อมูลที่ engine อ่าน: ระบบ identity, การจัดการอุปกรณ์, threat intelligence, log ของกิจกรรม, PKI และตัว access policy เอง

ชื่อ PDP กับ PEP มีมาก่อน zero trust: NIST เอามาจาก XACML สิ่งที่ใหม่คือตำแหน่งที่วาง (หน้า resource ทุกตัว แทนที่จะอยู่ที่ขอบจุดเดียว) และความถี่ที่ถูกถาม (ทุก request)

**สัญญาณ** คำตัดสินจะดีได้แค่ไหนก็ขึ้นกับสิ่งที่ใช้ตัดสิน:

| สัญญาณ | ตอบคำถามอะไร | แหล่งที่มาทั่วไป |
|---|---|---|
| Identity | ใครเป็นคนขอ และพิสูจน์ตัวตนมาแน่นหนาแค่ไหน | identity provider: account, group และ role, วิธี authenticate และใช้ไปนานแค่ไหนแล้ว |
| อุปกรณ์ | เป็นอุปกรณ์ที่เรารู้จักไหม และอยู่ในสภาพดีหรือเปล่า | device inventory และการจัดการอุปกรณ์: managed หรือไม่, OS และระดับ patch, การเข้ารหัสดิสก์, การล็อกหน้าจอ, endpoint protection |
| Context | request นี้ปกติไหม | ตำแหน่ง, เวลา, network ที่ request มา (เป็นแค่ข้อมูลหนึ่ง ไม่ใช่สิทธิ์), risk score จากการ sign-in และ behaviour analytics, threat intelligence |
| Resource | มีอะไรเสี่ยงอยู่แค่ไหน | การจัดระดับของแอปพลิเคชันหรือข้อมูล และ action ที่ขอ: อ่าน เขียน หรือ administer |

**ตรวจอะไรบ้าง**

- **User:** ด้วยการ authenticate ที่หน้า sign-in ปลอมเอาไป relay ต่อไม่ได้ แปลว่าใช้ passkey (FIDO2/WebAuthn) หรือ smart card ไม่ใช่ password กับรหัสที่พิมพ์เอง การ sign-in วิ่งผ่าน identity provider ด้วย [OpenID Connect](../openid-connect/) แล้ว claim `acr` กับ `amr` ใน ID token ก็บอกแอปพลิเคชันว่า user authenticate มายังไง
- **อุปกรณ์:** เราตัดสินได้แค่อุปกรณ์ที่เรารู้จัก เลยต้องมี inventory มี identity ของอุปกรณ์แต่ละเครื่อง (certificate ที่ key อยู่ใน TPM หรือ secure enclave) และมีสถานะ (posture) ที่ระบบจัดการอุปกรณ์รายงานมา อุปกรณ์ส่วนตัวไม่ต้องโดนกันออกไป แค่ได้สิทธิ์น้อยกว่า
- **Workload:** service ก็เป็น subject เหมือนกัน และ address ใน data centre ไม่ใช่ identity ส่วน workload แต่ละตัวได้ credential อายุสั้นของตัวเอง: certificate ที่ยื่นใน [Mutual TLS](../mutual-tls/) โดยมี [Service Mesh](../service-mesh/) หรือระบบ workload identity อย่าง SPIFFE เป็นตัวออกให้และหมุนเวียนให้อัตโนมัติ หรือ access token จาก [OAuth 2.0 Client Credentials](../oauth2-client-credentials/)
- **ทุก request:** token ของทุก call ถูกตรวจที่ปลายทางที่มันไปถึง ([JWT Validation](../jwt-validation/)) และควรใช้ได้กับ API ตัวนั้นตัวเดียว ส่วน service ที่เรียกต่อไปข้างหน้าจะขอ token ใหม่ที่แคบกว่าสำหรับ hop ถัดไป ([Token Exchange](../token-exchange/)) ไม่ส่ง token ที่ได้มาต่อไปตรง ๆ

**สิทธิ์น้อยที่สุด ทีละ session** tenet ข้อที่สามของ NIST บอกว่าการเข้าถึงให้ทีละ resource ทีละ session และการได้เข้า resource หนึ่งไม่ได้ให้สิทธิ์อะไรเลยที่ resource ถัดไป policy ยังไล่ระดับการเข้าถึงได้ด้วย ไม่ใช่แค่อนุญาตหรือปฏิเสธ: อ่านอย่างเดียวจากอุปกรณ์ที่ไม่ managed ห้ามดาวน์โหลด หรือให้ sign in ใหม่ก่อนทำ action ระดับ administrator การเข้าถึงแบบ *just-in-time* ใช้แนวคิดเดียวกันกับสิทธิ์: สิทธิ์ administrator ต้องขอเป็นงาน ๆ ไป ต้องมีคนอนุมัติ มีเวลาจำกัด และหายไปหลังงานเสร็จ เลยไม่มีสิทธิ์ค้างอยู่ให้ขโมย

**enforcement point อยู่ตรงไหน**

- **Identity-aware proxy:** reverse proxy ที่อยู่หน้าเว็บแอปพลิเคชัน คอย authenticate user และตรวจอุปกรณ์กับ context ก่อนจะ forward อะไรต่อ ส่วนตัวแอปพลิเคชันเปิดอยู่บน internet ได้ แต่ถ้าไม่ผ่าน proxy ก็ยังเข้าไม่ถึง ตัวอย่างคือ Identity-Aware Proxy ของ Google Cloud และ AWS Verified Access ส่วน [API Gateway](../api-gateway/) ก็ทำหน้าที่เดียวกันสำหรับ API
- **Network access broker** (ขายในชื่อ *zero trust network access* หรือ ZTNA): สำหรับ traffic ที่ไม่ใช่ HTTP ตัว agent บนอุปกรณ์กับ connector ที่อยู่ข้างแอปพลิเคชันจะเปิด connection ไปยังแอปพลิเคชันตัวนั้นตัวเดียวหลังผ่านการตรวจแบบเดียวกัน มันมาแทน VPN โดยไม่ต้องแจก network ให้ ตัวอย่างคือ Microsoft Entra Private Access
- **Micro-segmentation:** สำหรับ traffic ระหว่าง workload แต่ละ resource หรือกลุ่มเล็ก ๆ จะอยู่ใน segment ของตัวเอง หลัง gateway, host firewall หรือ sidecar proxy ที่ยอมให้เข้าเฉพาะผู้เรียกที่ระบุตัวได้และได้รับอนุญาต

NIST อธิบายแนวทางแบบนี้ไว้สามแบบ (ขับเคลื่อนด้วย identity governance, ด้วย micro-segmentation และด้วย network infrastructure กับ software-defined perimeter) และคาดว่า solution ที่ครบต้องมีองค์ประกอบของทั้งสามแบบ

**ประเมินไปเรื่อย ๆ** token ที่ออกไปแล้วมักถูก validate แบบ offline ทำให้คำตัดสินอยู่นานกว่าสัญญาณที่ใช้ตัดสิน มีสี่เทคนิคที่ช่วยหดช่องว่างนี้ และใช้ร่วมกันได้:

1. **Token อายุสั้น** ให้ access token อยู่แค่ไม่กี่นาที การ refresh แต่ละครั้งเลยเป็นคำตัดสินใหม่ ([Refresh Token Rotation](../refresh-token-rotation/)) ช่องว่างจะยาวไม่เกินอายุของ token
2. **ถามทุกครั้ง** PEP เรียก decision point หรือ introspect token (RFC 7662) ทุก request ไม่มีช่องว่างเลย แต่ต้องแลกกับ network call หนึ่งครั้งต่อ request
3. **Push การเปลี่ยนแปลง** ระบบที่เห็นการเปลี่ยนแปลงจะบอกทุกฝ่ายที่พึ่ง session นั้นอยู่ OpenID Shared Signals Framework กับ Continuous Access Evaluation Profile (CAEP) ที่เป็น specification final ทั้งคู่ตั้งแต่กันยายน 2025 กำหนดเรื่องนี้ไว้เป็น security event token ที่ sign แล้ว (RFC 8417) โดย transmitter push ไปให้ receiver หรือ receiver มา poll เอง มี event type เช่น session ถูก revoke, credential เปลี่ยน และ device compliance เปลี่ยน ส่วน product หลายตัวทำแนวคิดนี้ไปก่อน specification จะ final ด้วยซ้ำ ใน continuous access evaluation ของ Microsoft Entra ตัว service ที่เข้าร่วมจะบังคับใช้เรื่อง account ที่ถูก disable, การเปลี่ยน password, refresh token ที่ถูก revoke, user risk สูง และ location policy แทบจะ real time: มันปฏิเสธ token ที่ยังไม่หมดอายุด้วย claims challenge ที่ส่ง client กลับไปหา identity provider ส่วนสิ่งที่ได้กลับมาคือ token ใน session พวกนั้นอยู่ได้นานถึง 28 ชั่วโมง
4. **Step up** ไม่ใช่ทุกข้อสงสัยต้องหยุดเด็ดขาด API ตอบได้ว่าการ authenticate ที่อยู่เบื้องหลัง token อ่อนเกินไปหรือเก่าเกินไป (RFC 9470, error `insufficient_user_authentication`) แล้ว client ก็ส่ง user ไป sign in ใหม่ นี่คือสิ่งที่เกิดกับ tablet ใน step 4

**policy อยู่ที่เดียว** rule อยู่ใน policy engine กลาง ไม่ได้กระจายอยู่ในโค้ดแอปพลิเคชันกับตาราง firewall พอเขียนเป็นโค้ด (Rego ของ Open Policy Agent กับ Cedar คือภาษา policy สองตัว) ก็ review, test และทำ version ได้เหมือนของอย่างอื่น แล้ว OpenID AuthZEN Authorization API 1.0 ที่ final ตั้งแต่มกราคม 2026 ก็ทำให้คำถามที่ PEP ถาม PDP เป็นมาตรฐาน ส่วน catalog นี้ถือว่าเรื่องนั้นเป็น pattern ของมันเอง คือ policy-based authorization

**log ทุกคำตัดสิน** policy engine บันทึกทุกคำตัดสิน: subject, อุปกรณ์, resource, ผลการตัดสิน และสัญญาณที่อยู่เบื้องหลัง พอส่งไปที่ [Centralized Logging](../centralized-logging/) แล้ว record พวกนี้คือวิธีหาการใช้ในทางที่ผิด (session เดียวโผล่จากสองประเทศ หรือ workload ตัวหนึ่งโดนปฏิเสธรัว ๆ) เป็นวิธีปะติดปะต่อ incident ย้อนหลัง และเป็นวิธีปรับ policy ให้ดีขึ้น: rule ที่ไม่เคย match เลยก็เอาออกได้ ส่วน rule ที่ match ทุกอย่างก็กว้างเกินไป

## ใช้ตอนไหนดี

- **คนทำงานกับแอปพลิเคชันไม่ได้อยู่ที่เดียวกันอีกแล้ว:** ทำงานแบบ remote และ hybrid, SaaS, หลาย cloud
- **เอามาแทน VPN** ที่ให้อุปกรณ์ทุกเครื่องที่ connect เข้ามามีเส้นทางไปทั้ง network
- **Contractor, partner และอุปกรณ์ส่วนตัว** ที่ต้องการสิทธิ์แค่ส่วนเล็ก ๆ และไม่ควรเห็นส่วนที่เหลือเลย
- **ระบบภายในที่มีมูลค่าสูง:** admin console, ข้อมูล production, pipeline สำหรับ build และ deploy ที่ password ที่โดนขโมยไปต้องไม่พอจะเข้าได้
- **Platform ที่หลายทีมใช้ร่วมกัน** ที่ service ไม่ควรเชื่อกันเองแค่เพราะอยู่บน cluster หรือ subnet เดียวกัน
- **ค่อย ๆ ทำ** NIST คาดว่า workflow แบบ zero trust กับแบบ perimeter จะอยู่ด้วยกันไปอีกนานแบบไม่มีกำหนด และแนะนำให้ย้ายทีละ business process
- **ไม่ใช่สำหรับ traffic สาธารณะที่ไม่ระบุตัวตน** โมเดลนี้มีไว้สำหรับคน อุปกรณ์ และ workload ที่องค์กรระบุตัวได้และบังคับให้ทำตาม policy ได้ เว็บไซต์สาธารณะก็ยัง authenticate และ authorize ลูกค้าของมันอยู่ แต่จะไปเรียกร้องให้ลูกค้าใช้อุปกรณ์ที่ managed ไม่ได้

## ได้อะไร เสียอะไร

- **decision point กับ enforcement point กลายเป็น dependency สำคัญ** ถ้า policy engine หรือ PEP ล่ม อะไรที่อยู่ข้างหลังก็เข้าไม่ถึงเลย และใครคุม policy ก็คุมการเข้าถึงทั้งหมด เลยต้องมี redundancy ต้องคุมการเปลี่ยนแปลงอย่างระวัง และต้องมีทางฉุกเฉินที่ audit ได้ แล้ว NIST ก็จัดทั้ง denial of service และการบ่อนทำลายกระบวนการตัดสินไว้ในภัยคุกคามต่อ architecture นี้
- **ความยุ่งยาก** prompt มากขึ้น ต้องลงทะเบียนอุปกรณ์ และ tablet ส่วนตัวที่จู่ ๆ ก็เปิดบางอย่างไม่ได้ ถ้ามากเกินไป คนก็จะหาทางเลี่ยงการควบคุม เลือกวิธี sign-in ที่กัน phishing ได้และเร็ว และ step up เฉพาะตอนที่ความเสี่ยงหรือ resource ต้องการ
- **protocol เก่า ๆ พา identity ไปด้วยไม่ได้** connection ตรงไปที่ database, file share หรือ protocol อุตสาหกรรม ไม่มีที่ให้ใส่ token ระบบแบบนี้ต้องถูกห่อไว้: เข้าถึงได้ผ่าน gateway หรือ broker ที่ authenticate ก่อนเท่านั้น และแบ่ง segment ไว้แน่น ๆ ข้างหลัง
- **rule กว้าง ๆ พาความเชื่อใจโดยปริยายกลับมา** "พนักงานทุกคนเข้าแอปพลิเคชันภายในได้ทุกตัว" ก็คือ perimeter ที่มีขั้นตอนเพิ่มขึ้นมา ส่วน session ที่อยู่ได้หลายสัปดาห์ service account ที่ workload สิบตัวใช้ร่วมกัน หรือรายการข้อยกเว้นที่ไม่มีใคร review ก็เหมือนกัน
- **สัญญาณอาจเก่าหรือผิด** posture ที่รายงานมาเมื่อชั่วโมงที่แล้ว ตำแหน่งที่เดาจาก IP address ที่อยู่หลัง proxy ที่ใช้ร่วมกัน หรือ risk score ที่ร้องเตือนพร่ำเพรื่อ ล้วนทำให้ตัดสินผิด policy ต้องบอกว่าจะทำยังไงถ้าไม่มีสัญญาณ
- **ต้องรู้ว่ามีอะไรอยู่บ้าง** policy ราย resource ต้องมี inventory ของ user, service account, อุปกรณ์ แอปพลิเคชัน และ flow ระหว่างพวกมัน สำหรับองค์กรส่วนใหญ่ การสร้าง inventory นี้คืองานก้อนใหญ่ที่สุด
- **ยังต้องมีการควบคุมระดับ network อยู่** zero trust เอา*ความเชื่อใจ*ออกจาก network ไม่ได้เอาการควบคุม network ออก segmentation, firewall, การป้องกัน DDoS และการเข้ารหัสระหว่างส่งยังอยู่ เป็นชั้นหนึ่งในหลาย ๆ ชั้น tenet ข้อที่สองของ NIST ขอให้การสื่อสารทั้งหมดปลอดภัย ไม่ว่าจะวิ่งอยู่ที่ไหน
- **ความเป็นส่วนตัวและ lock-in** สัญญาณของอุปกรณ์และพฤติกรรมเป็นข้อมูลส่วนบุคคล และต้องมีขอบเขตของมันเอง ส่วน decision point ที่พูดได้แค่ format ของ vendor เจ้าเดียวก็เปลี่ยนออกยาก

## ข้อควรรู้ตอนลงมือทำ

**เส้นทางการย้ายที่ใช้ได้จริง**

1. **ทำ inventory** ลิสต์ user กับ service account, อุปกรณ์, แอปพลิเคชันและข้อมูล และใครต้องใช้อะไร ขั้นตอนการย้ายของ NIST เองก็เริ่มแบบเดียวกัน: ระบุ actor ก่อน แล้วค่อย asset แล้วค่อย business process
2. **identity ที่แน่นหนามาก่อน** identity provider ตัวเดียว, single sign-on, การ authenticate ที่กัน phishing ได้ และอุปกรณ์ที่ลงทะเบียนเข้าระบบจัดการแล้ว ถ้าไม่มีพวกนี้ decision point ก็ไม่มีอะไรให้ตัดสิน
3. **ทีละแอปพลิเคชัน** เลือกแอปพลิเคชันที่มีเจ้าของชัดเจน เอาไปไว้หลัง enforcement point แล้วรัน policy แบบ log อย่างเดียวก่อน (Microsoft Entra Conditional Access เรียกว่า report-only) เพื่อดูว่าใครจะโดนปฏิเสธบ้าง จากนั้นค่อยบังคับใช้จริงและเอาแอปพลิเคชันออกจาก VPN
4. **ทำซ้ำ แล้วค่อยลงลึก** แอปพลิเคชันเพิ่มขึ้น แล้วต่อด้วย traffic ระหว่าง workload ด้วย workload identity แล้วค่อยแบ่ง segment ให้แน่นขึ้นเมื่อ network แบบ flat ว่างลง
5. **รันทั้งสองโมเดลคู่กันไป** ระหว่างนั้น identity การจัดการอุปกรณ์ และ logging ต้องรองรับทั้งเส้นทางเก่าและเส้นทางใหม่ไปพร้อมกัน

**เรื่องอื่น ๆ**

- **Default deny** และมี rule ที่ชัดเจนรายแอปพลิเคชัน เริ่มจาก role กับ group ที่มีอยู่แล้ว แล้วค่อยแคบลงจากตรงนั้น
- **ปิดประตูข้าง** PEP ไม่ได้ป้องกันอะไรเลยถ้ายังอ้อมไปถึงแอปพลิเคชันได้ ให้รับ connection จาก proxy เท่านั้น และให้แอปพลิเคชันตรวจ assertion ที่ proxy sign มา (Identity-Aware Proxy sign header ไว้เพื่อการนี้) แทนที่จะเชื่อ header เปล่า ๆ
- **ตัดสินไว้ก่อนว่าไม่มีสัญญาณแปลว่าอะไร** อุปกรณ์ที่รายงาน posture ไม่ได้ ไม่เหมือนกับอุปกรณ์ที่สภาพดี ให้ fail closed สำหรับ resource ที่อ่อนไหว และบอกให้ชัดสำหรับส่วนที่เหลือ
- **ป้องกันตัว decision point เอง:** administrator น้อยคน การเปลี่ยนแปลงต้อง review และ log ไว้ policy ต้อง test ก่อน ship และ account แบบ break-glass ต้องเฝ้าดูใกล้ชิด
- **ให้อายุ token เหมาะกับความเสี่ยง** ไม่กี่นาทีสำหรับ API ที่อ่อนไหว และยาวกว่านั้นเฉพาะตรงที่ revocation event ตัด session ก่อนเวลาได้
- **วัดความคืบหน้า** Zero Trust Maturity Model ของ CISA (version 2.0, เมษายน 2023) ให้คะแนนห้า pillar (identity, อุปกรณ์, network, แอปพลิเคชันและ workload, ข้อมูล) และความสามารถที่ตัดข้ามทุก pillar สามข้อ (visibility และ analytics, automation และ orchestration, governance) ในสี่ระดับตั้งแต่ traditional ไปจนถึง optimal ส่วน zero trust architecture design principles ของ UK NCSC (review ล่าสุดเมื่อมกราคม 2026) ครอบคลุมเรื่องเดียวกันในรูปคำแนะนำด้านดีไซน์ และข้อหนึ่งในนั้นคืออย่าเชื่อ network ไหนเลย รวมถึง network ของตัวเองด้วย ในสหรัฐฯ memorandum M-22-09 ของ OMB (มกราคม 2022) ตั้งเป้าหมายให้หน่วยงานรัฐบาลกลางตามห้า pillar ของ CISA ภายในสิ้นปีงบประมาณ 2024 หนึ่งในนั้นคือ multi-factor authentication ที่กัน phishing ได้สำหรับพนักงาน โดยบังคับใช้ที่ application layer แทน network layer
