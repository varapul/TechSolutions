## ปัญหา

TLS ปกติตอบคำถามเดียว: นี่คือ server ที่ตั้งใจจะต่อจริงหรือเปล่า server ยื่น certificate แล้วฝั่ง client ก็ตรวจ แล้วช่องทางก็ถูกเข้ารหัสตั้งแต่ตรงนั้น แต่ server ไม่รู้อะไรเลยว่าใครอยู่อีกฝั่ง ที่ layer ของ TLS นั้น client ทุกตัวไม่มีตัวตน

service ต่าง ๆ เลยอุดช่องนี้ด้วยวิธีที่ยิ่งนานยิ่งแย่ บางตัวไว้ใจ network: อะไรก็ตามที่ต่อถึง port ได้ หรือมาจาก subnet ที่ถูก ก็ถือว่าเป็นพวกเดียวกัน นี่คือ implicit trust ที่ zero trust architecture (NIST SP 800-207) ตั้งใจจะเอาออก และ host ที่โดนเจาะแค่ตัวเดียวใน perimeter ก็ได้ trust นั้นไปทั้งหมด บางตัวก็ให้ shared secret กับคนที่เรียกแต่ละราย เป็น API key หรือ password ใน header มันเป็น string เดิมในทุก request ไปโผล่อยู่ในไฟล์ configuration และ log และใครที่ก็อปมันไปได้ก็ใช้มันจากที่ไหนก็ได้ จนกว่าจะมีคนสังเกตเห็น

Mutual TLS ให้ server มั่นใจได้แบบเดียวกับที่ client มั่นใจอยู่แล้ว ทั้งสองฝั่งพิสูจน์ว่าตัวเองเป็นใครด้วย certificate และ private key ระหว่าง handshake ก่อนจะมีการแลกข้อมูลของแอปใด ๆ ไม่มี secret วิ่งผ่านสาย และ identity ก็ผูกอยู่กับ connection แทนที่จะผูกกับ string ที่เอาไป replay ได้

## ทำงานยังไง

**handshake เพิ่มอะไรเข้ามา** ชื่อ message ด้านล่างเป็นของ TLS 1.3 ตามที่กำหนดใน RFC 9846 ที่เป็นฉบับแก้ไขแบบ backward-compatible และมาแทน RFC 8446 ในเดือนกรกฎาคม 2026 ตัว handshake แบบทางเดียวมี `Certificate`, `CertificateVerify` และ `Finished` ของ server อยู่แล้ว ส่วน mutual TLS เพิ่ม message อีกสามตัว:

- **`CertificateRequest`** ที่ server ส่งต่อจาก `EncryptedExtensions` ทันที มันบอกว่าต้องการ client certificate และรับ signature algorithm ตัวไหนได้บ้าง มันยังบอกรายชื่อ CA ที่ server ยอมรับได้ด้วย (extension `certificate_authorities`) ช่วยให้ client ที่มี certificate หลายใบเลือกใบที่ถูกได้
- **`Certificate`** จาก client: certificate ของมัน บวก intermediate ถ้ามี ส่วน client ที่ไม่มีใบที่เหมาะเลยก็ยังต้องตอบ โดยส่งรายการว่างมา
- **`CertificateVerify`** จาก client: signature ที่ sign ทับ transcript ของ handshake จนถึงตอนนั้น ด้วย private key ที่คู่กับ certificate นี่คือการพิสูจน์ว่าถือ key อยู่จริง ตัว certificate เป็นของ public การยื่นมันอย่างเดียวเลยพิสูจน์อะไรไม่ได้ คนที่ถือ key เท่านั้นที่สร้าง signature นี้ได้ และเพราะมันครอบคลุม transcript ของ handshake รอบนี้ มันเลยใช้กับ connection อื่นไม่ได้เลย

แต่ละฝั่งปิดท้ายด้วย `Finished` ใน TLS 1.3 ทุกอย่างหลัง `ServerHello` ถูกเข้ารหัส ทำให้ certificate และ identity ที่อยู่ในนั้นถูกซ่อนจากคนที่ดู network อยู่ ส่วนใน TLS 1.2 ของพวกนี้วิ่งผ่านแบบไม่เข้ารหัส

การขอ certificate กับการบังคับว่าต้องมี เป็นการตัดสินใจคนละเรื่องกัน และ TLS ก็ปล่อยเรื่องที่สองให้ server ตัดสิน: ถ้าเจอรายการว่างหรือ chain ที่ไม่ยอมรับ server จะ abort handshake ก็ได้ หรือจะทำต่อแล้วมอง client ว่ายังไม่ได้ยืนยันตัวตนก็ได้ software ฝั่ง server เลยเปิดเรื่องนี้ให้ตั้งค่าได้ อย่าง `ssl_verify_client` ของ nginx รับค่า `on` หรือ `optional` ส่วน `tls.Config` ของ Go แยก `RequestClientCert` กับ `RequireAndVerifyClientCert` ออกจากกัน และ Envoy ก็มี `require_client_certificate` ส่วน server ใน diagram บังคับว่าต้องมี

**Trust** certificate ได้รับความเชื่อถือเพราะ CA ที่อยู่ใน trust store ของฝั่งที่ตรวจเป็นคน sign ให้ สำหรับ mutual TLS ตัวนั้นควรเป็น CA ของคุณเอง จะเป็น private CA หรือ internal PKI ก็ได้ และ trust store สำหรับ client certificate ก็ไม่ควรมีอย่างอื่นอยู่เลย:

- *trust store เป็นตัวกำหนดว่าใครเข้ามาได้* server จะรับ client ตัวไหนก็ได้ที่ chain จบที่ CA ที่มันเชื่อถือ ถ้ามี root ของ public web อยู่ในนั้นด้วย ใครที่ขอ certificate จาก public CA เจ้าไหนก็ได้ก็จะผ่านการตรวจ chain ไป ถ้าใช้ private CA คนที่เรียกเข้ามาได้ก็คือ certificate ที่คุณออกให้เท่านั้น
- *Public CA กำลังเลิกทำ client authentication* root program ของ Chrome บังคับให้ hierarchy ที่มันเชื่อถือต้องใช้กับ TLS server authentication อย่างเดียว และ certificate ที่ออกภายใต้ hierarchy พวกนั้นตั้งแต่ 15 มีนาคม 2027 จะระบุได้แค่ extended key usage (EKU) แบบ server authentication ส่วน CA ต่าง ๆ ก็ทำล่วงหน้าไปก่อนวันนั้นแล้ว: Let's Encrypt เอา EKU แบบ client authentication ออกจาก profile ตัว default ในเดือนกุมภาพันธ์ 2026 และปิด profile สุดท้ายที่ยังมีมันอยู่เมื่อ 8 กรกฎาคม 2026 เลยคาดหวังไม่ได้อีกแล้วว่า certificate ที่ public เชื่อถือจะใช้เป็น client certificate ได้

**Identity** ฝั่งที่ตรวจจะอ่านว่าอีกฝั่งเป็นใครจาก **subject alternative name** (SAN) ของ certificate ไม่ได้ใช้ common name: กฎปัจจุบันสำหรับการตรวจ identity ของ service ใน TLS (RFC 9525) ห้ามใช้มัน ตัว SAN ของ server มักเป็น DNS name ส่วนของ workload มักเป็น URI และ **SPIFFE** ก็ทำรูปแบบนั้นให้เป็นมาตรฐาน: SPIFFE ID อย่าง `spiffe://example.org/orders` ประกอบด้วย trust domain กับ path และ X.509-SVID คือ certificate ที่มี SPIFFE ID อยู่ตัวเดียวพอดี เป็น URI SAN ตัวเดียวของมัน ส่วน SVID ที่ตั้ง EKU ไว้จะระบุทั้ง server และ client authentication เลยเหมาะกับ service ที่เป็น client ใน connection หนึ่ง และเป็น server ใน connection ถัดไป

**Validation** แต่ละฝั่งตรวจ certificate ของอีกฝั่งด้วยเช็กชุดเดียวกัน และถ้าอันไหนไม่ผ่าน handshake ก็จบด้วย alert สามข้อแรกคือ path validation ของ RFC 5280:

1. **Chain** signature ทุกตัวตรวจผ่าน ตั้งแต่ certificate ของอีกฝั่ง ผ่าน intermediate ที่มี ไปจนถึง CA ใน trust store
2. **วันที่ใช้ได้** เวลาปัจจุบันอยู่ในช่วง `notBefore` ถึง `notAfter` ของทุก certificate ใน chain
3. **Revocation** ไม่มี certificate ไหนใน chain ที่ issuer ถอนคืนไปแล้ว ตามที่ certificate revocation list (CRL) หรือ OCSP response (RFC 6960) บอก
4. **การถือ key** signature ใน `CertificateVerify` ตรวจผ่านด้วย public key ของ certificate
5. **Identity** SAN ตรงกับที่ endpoint นี้คาดไว้ (กรณี client ตรวจ server) หรือถูกส่งต่อให้ layer ของ authorization (กรณี server ตรวจ client)

step 3 ของ diagram แสดงสามทางที่พังได้: ไม่มี certificate เลย (`certificate_required`), certificate ที่เลย `notAfter` ไปแล้ว (`certificate_expired`) และ chain ที่จบที่ CA นอก trust store (`unknown_ca`)

Revocation เป็นจุดอ่อน ทั้งสองกลไกต้องให้ฝั่งที่ตรวจมีข้อมูลใหม่ ๆ จาก CA อยู่ในมือตอน handshake ข้อมูลนี้เลยเป็นอีกอย่างที่ต้องกระจายออกไป และเป็นอีกอย่างที่พังได้ แนวทางปัจจุบันคือปล่อยให้ certificate หมดอายุไปก่อนที่ revocation จะมีความหมาย RFC 9608 อธิบายแบบนั้นเป๊ะ: CA ที่ออก certificate อายุสั้นจะไม่เผยแพร่ข้อมูล revocation ของมัน เพราะ certificate แบบนี้หมดอายุก่อนข่าวการ revoke จะไปถึงฝั่งที่ตรวจ และ RFC ก็กำหนด extension (`noRevAvail`) ที่บอกฝั่งที่ตรวจให้ข้ามการเช็กนี้ไป ฝั่ง public web เองก็กำลังไปทางเดียวกัน: Let's Encrypt ปิด OCSP responder ไปในเดือนสิงหาคม 2025 และมี certificate อายุหกวันให้ใช้ตั้งแต่มกราคม 2026 ส่วนภายในแพลตฟอร์ม อายุระหว่างหนึ่งชั่วโมงถึงหนึ่งวันถือเป็นเรื่องปกติ

**การออกและ rotate** อายุสั้นจะใช้ได้จริงก็ต่อเมื่อไม่มีใครต้องทำอะไรเอง issuer อัตโนมัติจะให้ certificate กับทุก workload และเปลี่ยนใบใหม่ให้ล่วงหน้าก่อนหมดอายุพอสมควร:

- **SPIRE** attest ตัว node และ workload แล้วส่ง X.509-SVID ให้ผ่าน local API ส่วนอายุ default คือหนึ่งชั่วโมง และ agent จะ renew ตอนผ่านไปครึ่งหนึ่ง
- **cert-manager** ออก certificate จาก resource `Certificate` ใน Kubernetes และโดย default จะ renew ตอนผ่านไปสองในสามของอายุ ตัว SPIFFE CSI driver ของมัน mount certificate อายุหนึ่งชั่วโมงที่ private key ไม่เคยออกจาก node
- **ACME** (RFC 8555) คือ protocol ที่ Let's Encrypt ทำให้แพร่หลาย และ private CA ก็พูดมันได้ด้วย (step-ca ก็ตัวหนึ่ง) ทำให้ ACME client ทั่วไป renew certificate ภายในได้
- **[service mesh](../service-mesh/)** ทำทั้งหมดนี้แทนแอป ใน Istio ตัว agent ที่อยู่ข้าง proxy แต่ละตัวจะสร้าง key กับ signing request แล้ว control plane ก็ sign ให้ และ certificate มีอายุ 24 ชั่วโมงโดย default ส่วน proxy ของ Linkerd ก็ได้ certificate อายุ 24 ชั่วโมงเหมือนกัน

certificate อายุหนึ่งชั่วโมงใน diagram ที่ถูกเปลี่ยนตอนผ่านไปสองในสามของอายุ ก็คือ config แบบหนึ่งในนี้ การ renew ควรได้ key pair ใหม่ ไม่ใช่ได้ certificate ใหม่สำหรับ key เดิม ไม่อย่างนั้น key ที่โดนขโมยไปก็จะมีอายุยืนกว่า certificate ที่โดนขโมยไปพร้อมกัน ส่วน cert-manager ก็ rotate key ให้โดย default ตั้งแต่ v1.18

## ใช้ตอนไหนดี

- **Service กับ service ภายในแพลตฟอร์ม** ทั้งสองฝั่งเป็น software ที่คุณ deploy เอง เลยแจก certificate ให้ทั้งสองฝั่งแบบอัตโนมัติได้ ตรงนี้คือที่ที่ mutual TLS เก่งที่สุด และ service mesh ก็เปิดมันให้โดย default
- **Device และ agent:** gateway, อุปกรณ์ IoT, build runner, อะไรก็ตามที่มีที่เก็บ key และไม่มีคนมาพิมพ์ password
- **API สำหรับ partner และ business-to-business** ที่ partner แต่ละรายได้ certificate หรือลงทะเบียน certificate ของตัวเอง แทนการใช้ API key ร่วมกัน
- **OAuth client** (RFC 8705) ตัว confidential client ยืนยันตัวตนกับ token endpoint ด้วย certificate แทน client secret ได้ โดยตรวจผ่าน PKI (`tls_client_auth`) หรือลงทะเบียนเป็น self-signed certificate (`self_signed_tls_client_auth`) RFC เดียวกันนี้ยังกำหนด **certificate-bound access token** ไว้ด้วย: authorization server เขียน SHA-256 thumbprint ของ certificate ลงใน token (`cnf.x5t#S256`) และ API จะรับ token ก็ต่อเมื่อมาทาง connection ที่ทำด้วย certificate ใบนั้น token ที่โดนขโมยไปเลยไม่มีค่าถ้าไม่มี key ส่วน FAPI 2.0 Security Profile ที่เขียนขึ้นสำหรับ API การเงินก่อน บังคับให้ access token ทุกตัวเป็น sender-constrained ด้วย mutual TLS หรือ DPoP ส่วน grant ที่มักใช้คู่กับเรื่องนี้คือ OAuth 2.0 Client Credentials และ [JWT Validation](../jwt-validation/) ก็อธิบายส่วนที่เหลือที่ API ต้องตรวจ
- **ไม่ใช่สำหรับคนที่ใช้ browser** browser รองรับ client certificate ก็จริง แต่การใส่ certificate กับ key ลงในทุกอุปกรณ์ที่คนคนหนึ่งใช้เป็นปัญหาเรื่อง provisioning หน้าถาม certificate ก็ทำให้คนงง และไม่มีทาง sign out ได้เลย RFC 8705 เลยไม่ให้ใช้ certificate-bound token ใน implicit flow ที่ใช้ผ่าน browser: มันบอกว่า client certificate ใน browser ของผู้ใช้สร้างปัญหาทั้งเรื่อง operation และ usability ส่วน HTTP/2 ก็เพิ่มข้อจำกัดเด็ดขาดอีกข้อ: server ขอ certificate กลางทางระหว่าง connection ไม่ได้ เพราะ RFC 9113 ห้ามทั้ง post-handshake authentication ของ TLS 1.3 และ renegotiation ของ TLS 1.2 เลยต้องเลือกว่าจะขอหรือไม่ขอทั้ง connection ไปเลย ให้คนเข้าสู่ระบบด้วย [OpenID Connect](../openid-connect/) ข้อยกเว้นคือเครื่องที่องค์กรจัดการ: certificate ที่ระบบ device management ติดตั้งให้จะระบุตัว laptop ส่วนคนก็ยังต้องเข้าสู่ระบบเหมือนเดิม

## ได้อะไร เสียอะไร

- **คุณต้องดูแล PKI เองแล้ว** ต้องมีคนคอยเฝ้า key ของ CA คอยออก certificate ให้ทุก workload คอยส่ง trust bundle ไปให้ทุกฝั่งที่ตรวจ และวางแผน rotate ตัว CA เอง งานนี้ยากกว่า rotate leaf มาก: root เก่ากับ root ใหม่ต้องถูกเชื่อถือคู่กันไปจนกว่าจะออก certificate ใหม่ให้ครบทุกใบ
- **การหมดอายุคือสาเหตุระบบล่มแบบคลาสสิก** certificate ที่หมดอายุทำให้ทุก connection ที่พึ่งมันพังพร้อมกันในวินาทีเดียว automation ตัดงาน renew ด้วยมือออกไปได้ แต่ไม่ได้ตัดความเสี่ยง: issuer อาจใช้งานไม่ได้นานกว่าอายุที่เหลือ, process อาจยังใช้ certificate ที่โหลดไว้ตอน start-up อยู่ทั้งที่ใบใหม่วางอยู่บน disk แล้ว และ CA certificate ก็หมดอายุเหมือนกัน ในรอบเวลาที่นานพอให้ทุกคนลืม อย่าง trust anchor กับ issuer certificate ตัว default ของ Linkerd ก็หมดอายุในหนึ่งปี และต้อง rotate ด้วยมือถ้าคุณไม่ได้ทำให้มันอัตโนมัติ ให้ตั้ง alert ตามเวลาที่เหลือก่อนหมดอายุในทุกระดับของ chain
- **นาฬิกาสำคัญ** ความ valid ตัดสินด้วยนาฬิกาของฝั่งที่ตรวจเอง ถ้า certificate อายุหนึ่งชั่วโมง นาฬิกาที่คลาดไปไม่กี่นาทีก็จะปฏิเสธ certificate ที่เพิ่งออกมาว่ายังไม่ถึงเวลาใช้ หรือไปรับ certificate ที่หมดอายุแล้วต่อ
- **ความล้มเหลวอ่านยาก** handshake ที่พังจะจบด้วย TLS alert สั้น ๆ อย่าง `certificate_required`, `certificate_expired` หรือ `unknown_ca` และสิ่งที่ไปถึงแอปมักน้อยกว่านั้นอีก: เป็นแค่ handshake error ทั่ว ๆ ไป หรือ connection ที่ถูกปิด ใน TLS 1.3 ตัว certificate ของ client วิ่งไปในชุด message ชุดสุดท้ายของ handshake ทำให้ client ทำฝั่งของตัวเองเสร็จไปแล้วก่อนที่ server จะตัดสิน การถูกปฏิเสธเลยมักโผล่ตอน read หรือ write ครั้งแรก ไม่ใช่ตอน connect ให้ log validation error ตัวจริงไว้ที่ฝั่งที่ปฏิเสธ
- **TLS termination ซ่อน certificate ไว้** identity เป็นของ TLS connection และจบตรงที่ TLS จบ ถ้าอยู่หลัง load balancer หรือ gateway ที่ terminate TLS แอปจะเห็น connection ใหม่จาก proxy และไม่เห็น client certificate เลย (ดูข้อควรรู้ตอนลงมือทำ)
- **บอกว่าใคร ไม่ได้บอกว่าทำอะไรได้** certificate ที่ valid พิสูจน์ว่า workload ตัวไหนเป็นคนเรียก แต่ไม่ได้บอกว่า workload นั้นอ่าน record นี้ได้หรือเปล่า และไม่ได้บอกอะไรเลยเกี่ยวกับ end user ที่การเรียกนี้ทำแทน ตัว mutual TLS คือ authentication ไม่ใช่ authorization: ต้องมี policy อยู่ข้างบน และมักต้องมี token อยู่ข้าง ๆ
- **ตรวจแค่ครั้งเดียวต่อ connection** validation เกิดตอน handshake และ TLS ไม่ทำซ้ำทีหลัง connection ที่เปิดอยู่แล้วเลยมักใช้ต่อได้ แม้ certificate ของมันจะหมดอายุหรือถูก revoke ไปแล้ว

## ข้อควรรู้ตอนลงมือทำ

- **เชื่อถือแค่ CA ของคุณเอง** สำหรับ client certificate และแยก trust store นั้นออกจากตัวที่ใช้ตรวจ public server
- **Authorize ด้วย identity** แปลง SAN ให้เป็นคำตัดสิน เช่น "`spiffe://example.org/orders` เรียก `POST /payments` ได้" ใน mesh เรื่องนี้เขียนแบบ declarative (`AuthorizationPolicy` ของ Istio จับคู่ด้วย principal ของอีกฝั่ง) ส่วนในโค้ดของแอปก็คือการเช็ก certificate ของอีกฝั่งที่ตรวจแล้ว ถ้าไม่มีขั้นนี้ certificate จาก CA ที่ถูกก็คือทั้งหมดที่ใครก็ตามต้องมี และทุก workload ใน trust domain ก็เรียกหากันได้หมด
- **Roll out เป็นสองขั้น** ช่วงแรกรับทั้ง mutual TLS และ connection แบบธรรมดา แล้วดูว่าใครยังต่อเข้ามาโดยไม่มี certificate จากนั้นค่อยบังคับ ตัว Istio เรียกสองโหมดนี้ว่า `PERMISSIVE` ที่เป็น default ของมัน กับ `STRICT`
- **TLS terminate ที่ไหน** ถ้ามี proxy อยู่ข้างหน้าจะมีสามทางเลือก:
  - *Pass through* load balancer ระดับ layer 4 ส่งต่อ TCP connection ไปแบบไม่แตะอะไร แล้วแอปก็ terminate TLS เอง
  - *ตรวจที่ edge แล้วส่ง identity ต่อ* proxy ตรวจ client certificate แล้วส่งมันต่อใน request header ส่วน RFC 9440 ก็กำหนด header field `Client-Cert` กับ `Client-Cert-Chain` ไว้สำหรับเรื่องนี้ ของเก่าที่ผูกกับแต่ละ product ก็มี `x-forwarded-client-cert` ของ Envoy, header `X-Amzn-Mtls-*` ของ AWS Application Load Balancer และ header อะไรก็ตามที่คุณเติมจาก `$ssl_client_escaped_cert` ของ nginx ตัว header มีค่าเท่ากับ hop ที่มันเดินทางมาพอดี: proxy ต้องลบ header ตัวที่ client ส่งมาเองทิ้ง backend ต้องรับมันจาก proxy ตัวนั้นเท่านั้น และ connection ระหว่างสองตัวต้องได้รับการปกป้อง ถ้าลืมลบ header จะเป็น fail open: ทุกอย่างยังทำงานปกติ ขณะที่ client ตัวไหนก็อ้างเป็น identity อะไรก็ได้
  - *Mutual TLS ทั้งสอง hop* proxy ยืนยันตัวตน client แล้วเปิด connection แบบยืนยันตัวตนทั้งสองฝั่งของตัวเองไปหา backend ตอนนี้ backend รู้จัก proxy และรู้เรื่อง client ตัวจริงแค่เท่าที่ proxy บอก

  การ terminate TLS และตรวจ client certificate ไว้ที่เดียวคือ gateway offloading และเป็นหนึ่งในงานของ [API gateway](../api-gateway/)
- **Reload โดยไม่ต้อง restart** process ต้องรับ certificate และ key ที่ renew แล้วได้ระหว่างที่มันรันอยู่ proxy กับ mesh ทำได้ ส่วนแอปที่อ่านไฟล์แค่ครั้งเดียวตอน start-up จะจบที่การใช้ certificate ที่หมดอายุไปแล้ว
- **จำกัดอายุของ connection** ที่ server หรือ proxy เพื่อให้ทุก connection ถูกสร้างใหม่ และ certificate ของมันถูกตรวจใหม่ ภายในเวลาที่กำหนด
- **Certificate-bound token กับการ rotate** token ที่ผูกกับ certificate จะตายไปพร้อมกับมัน: หลัง rotate certificate แล้ว client ต้องไปขอ token ใหม่ (RFC 8705 §6.3) ถ้า rotate ทุกชั่วโมงก็หมายถึงต้องขอ token อย่างน้อยชั่วโมงละครั้ง ส่วน DPoP (RFC 9449) ผูก token ไว้กับ key อีกตัวแยกต่างหากแทน
- **ให้นาฬิกาตรงกัน** ด้วย NTP บนทุก node
- **เฝ้า key ไว้ให้ดี** สร้าง key ตรงที่จะใช้ และอย่าก็อปมันไปไหน: เก็บไว้ใน memory, ใน volume ที่ไม่เคยเขียนลง disk หรือใน hardware อย่าง TPM หรือ HSM ส่วน certificate เป็นของ public ได้ แต่ key คือ identity
