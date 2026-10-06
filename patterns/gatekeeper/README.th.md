## ปัญหา

service ที่รับ request จาก internet มักทำงานสองอย่างที่ต่างกันมากใน process เดียวกัน:

- **มัน parse input ที่เชื่อไม่ได้** header, query string, JSON body, multipart upload, ชื่อไฟล์ และหลายครั้งก็ทั้ง format ของไฟล์อย่าง PDF หรือรูปภาพ ผ่าน framework และ library ตัวใหญ่ ๆ ตรงนี้แหละที่ bug ที่ถูก exploit ได้ส่วนใหญ่อยู่: path traversal, injection, unsafe deserialisation และ parser ที่ memory หมด
- **มันถือ key ไว้** connection string, storage account key หรือ identity ที่มีสิทธิ์อ่านและเขียนข้อมูลที่อยู่ข้างหลัง

พอรวมกันแบบนี้ bug แค่ตัวเดียวในงานแรกก็ยกงานที่สองให้ไปเลย Azure Architecture Center วาง Gatekeeper pattern ไว้รอบความเสี่ยงนี้พอดี: ใครที่เจาะ hosting environment ของแอปได้ ก็ได้ credential, storage key และ service ที่แอปใช้ไปด้วย ถึงตอนนั้นการไม่ให้ data store ต่อกับ internet ก็ไม่ช่วยอะไร เพราะ attacker กำลังรันโค้ดอยู่บน host ที่มีสิทธิ์ต่อไปหามันได้อยู่แล้ว

ใน diagram ตัว claims service ของ portal ประกันภัยเปิดรับ internet ที่ port 443, parse ทุก document upload เอง และถือ credential ของ claims database กับ document store ไว้ พอมี upload ที่จงใจตั้งชื่อไฟล์ว่า `../../config` ไฟล์นั้นก็ไปตกอยู่นอกโฟลเดอร์ upload แล้ว attacker ก็ได้รันโค้ดบน host และ key ที่เปิดเข้าถึงกรมธรรม์ เคลม และเอกสารทุกชิ้นก็ติดมาด้วย

## ทำงานยังไง

แยกสองงานนี้ไปไว้บน host สองตัวที่ได้รับความไว้ใจไม่เท่ากัน โดยมีช่องทางแคบ ๆ ช่องทางเดียวเชื่อมกัน:

- **Gatekeeper** เป็นส่วนเดียวที่ internet เข้าถึงได้ มันรับทุก request ยืนยันตัวตนคนที่เรียกมา validate และ sanitise request ปฏิเสธอะไรที่ไม่ตรงตามที่กำหนด แล้วส่งที่เหลือต่อไป มันรันด้วย **สิทธิ์ที่จำกัด** และ **ไม่ถือ credential หรือ key ของ data store** หรือ service อื่นเลย ทำให้ gatekeeper ที่โดนเจาะไม่มีอะไรน่าขโมย Azure ยังบอกด้วยว่ามันไม่ควรทำ application processing หรือแตะข้อมูลเลย: งานเดียวของมันคือ validate และ sanitise
- **Trusted host** (diagram ของ Azure เรียกมันว่า *key master* ด้วย) ทำงานทางธุรกิจและถือ credential ไว้ มันเปิดแค่ **internal endpoint** ที่ gatekeeper เท่านั้นเป็นคนเรียก และไม่เปิดอะไรออกไปข้างนอกเลย
- **ช่องทางเดียว** ที่เชื่อมสองตัวนี้: internal endpoint ผ่าน TLS หรือ queue หรือ broker ส่วน network rule ก็ไม่ยอมให้มีทางอื่น

Azure เปรียบ gatekeeper ว่าเป็น firewall ที่เข้าใจแอป: แทนที่จะ filter ตาม address และ port มันมองเข้าไปในแต่ละ request แล้วตัดสินในระดับแอปว่าจะส่งต่อหรือไม่

1. **host เดียวที่เปิดรับ internet (แบบเดิม)** claims service เปิดรับ internet และถือ key ไว้ bug ในการ parse แค่ตัวเดียว ในที่นี้คือชื่อไฟล์ `../../config` ก็ทำให้ attacker ได้ host ไปพร้อมกับ key
2. **แยกหน้าที่กัน** gatekeeper ใน perimeter zone รับทุก request มันยืนยันตัวตนคนที่เรียกมา ตรวจขนาดก่อนอ่าน body แล้ว decode request ครั้งเดียว validate ผลที่ได้กับ contract (เฉพาะ field ที่รู้จัก, content type ที่อนุญาตและตรงกับ byte จริง, ชื่อไฟล์ที่มีแต่อักขระปลอดภัย) แล้วส่ง request ที่สร้างใหม่ต่อผ่าน internal endpoint ช่องทางเดียว: port 8443 กับ [mutual TLS](../mutual-tls/) ฝั่ง trusted host ก็ validate อีกรอบ เช็กว่าเคลม 4471 เป็นของคนที่เรียกมาจริง แล้วเก็บ record กับไฟล์
3. **โดนหยุดไว้ที่ประตู** `../../config` ไม่ผ่านกฎเรื่องชื่อไฟล์ เลยได้ `400 Bad Request` ส่วน body ขนาด 48 MB เกิน limit 10 MB ก็ได้ `413 Content Too Large` ตั้งแต่ยังไม่ได้อ่าน body ทั้งสองกรณีลง log ไว้ และ trusted host ไม่เห็นสักอัน จากนั้นตัว gatekeeper เองก็โดนเจาะ: attacker ไม่เจอ key หรือ connection string อะไรที่นั่น network rule ก็ไม่ยอมให้มันไปถึง store และ request ปลอมที่มันส่งผ่าน endpoint ช่องเดียวก็ไม่ผ่านการ validate ของ trusted host เอง
4. **ต้นทุน** มี hop เพิ่มในทุก request มี tier เพิ่มอีกชั้นที่ต้อง scale และดูแลให้พร้อมใช้งาน มีกฎที่ต้องตาม contract ของ service ให้ทัน และมีแรงล่อใจให้ใส่ business logic ไว้ใน gatekeeper ส่วน [valet key](../valet-key/) เลือกแลกในทางตรงข้าม

### ต้อง validate และ sanitise อะไรบ้าง

cheat sheet เรื่อง Input Validation และ File Upload ของ OWASP ให้ checklist ไว้ เรียงคร่าว ๆ ตามลำดับที่ gatekeeper ทำ:

- **ยืนยันตัวตนคนที่เรียกมาก่อน** traffic ที่ไม่ระบุตัวตนจะได้ไม่ไปถึงการเช็กที่แพง การตรวจ token ที่ sign แล้วใช้แค่ public key ของ identity provider (ดู [JWT validation](../jwt-validation/)) และ key พวกนี้ก็ไม่ใช่ credential ของ data store ส่วน authorisation แบบละเอียด ("ผู้ใช้ 1182 เพิ่มเอกสารเข้าเคลม 4471 ได้ไหม") ต้องใช้ข้อมูล เลยต้องอยู่ที่ trusted host และ OWASP เองก็มอง authorisation เป็นการเช็กคนละเรื่องกับ validation
- **จำกัดขนาดก่อน parse** จำกัดขนาด body, header และ URL ก่อนจะ buffer หรือ parse อะไรทั้งนั้น และตั้ง limit ของ parser อย่างความลึกของการซ้อน: การเช็ก schema ที่รันหลัง parse ปกป้อง parser ที่ memory หมดไปแล้วไม่ได้ ให้ตอบ body ที่ใหญ่เกินด้วย `413 Content Too Large` (RFC 9110) อย่าง `client_max_body_size` ของ NGINX ก็มีค่า default 1 MB และตอบ 413 ถ้าเกินนั้น ถ้า upload จะถูก decompress หรือแตกไฟล์ทีหลัง limit ก็ต้องใช้กับขนาดหลังขยายด้วย
- **Canonicalise ก่อน แล้วค่อย validate** decode ครั้งเดียวตามที่ protocol กำหนด (percent-encoding, character encoding และ Unicode normalisation ถ้า field นั้นต้องใช้) validate รูปที่ decode แล้ว และส่งรูปนั้นต่อไป จะได้ไม่มีใครข้างหลัง decode ซ้ำอีก การเช็กรูปหนึ่งแต่ไปใช้อีกรูปหนึ่งคือวิธีที่ `..%2F..%2Fconfig` เล็ดลอดการเช็กหา `../` ไปได้
- **Validate กับ contract ด้วย allowlist** ใช้ schema: field ที่บังคับ, type, ความยาว, ช่วงค่า, ค่าที่อนุญาต และจำนวน item ของ array โดยใช้กับ object ที่ซ้อนอยู่ข้างในด้วย ใน JSON Schema ต้องตัดสินให้ชัดว่าจะทำยังไงกับ field ที่ไม่รู้จัก (`additionalProperties`) เพราะการ list property ไว้ไม่ได้บังคับว่าต้องมี และก็ไม่ได้ปฏิเสธตัวอื่น ให้กำหนดว่ารับอะไร แล้วปฏิเสธที่เหลือทั้งหมด แทนที่จะพยายามจำหน้าตาการโจมตี
- **ปฏิเสธ อย่าซ่อม** OWASP จัดการ "ทำความสะอาด" input (ตัดอักขระที่ดูอันตรายออก) ไว้เป็นหลุมพราง: มันเปลี่ยนความหมายของค่าได้ และก็ยังไม่ได้ทำให้ปลอดภัยอยู่ดี ให้ตอบ error ที่ชัดเจนแทนที่จะทำต่อด้วยข้อมูลที่ validate ไปแค่บางส่วน
- **Sanitise ด้วยการสร้างใหม่** ส่ง request ที่สร้างจาก field ของ contract ที่ validate แล้วต่อไป ไม่ใช่ส่ง byte ดิบของ client ทำให้ field และ header ที่ไม่ได้คาดไว้ถูกทิ้ง มีแค่ field ที่ตั้งใจไว้ที่ไปถึง business object (วิธีป้องกัน mass assignment ของ OWASP) และ gatekeeper กับ trusted host ก็จะอ่าน byte ชุดเดียวกันไม่ตรงกันไม่ได้อีก การอ่านไม่ตรงกันแบบนี้แหละคือสิ่งที่ HTTP request smuggling ใช้โจมตี (RFC 9112, section 11.2)
- **File upload** มองชื่อไฟล์และ `Content-Type` ที่ประกาศมาเป็น metadata ที่เชื่อไม่ได้ รับแค่ type ที่อยู่ใน allowlist (ในที่นี้คือ PDF กับ JPEG) และเช็ก signature จริงของไฟล์เทียบกับ type ที่ประกาศ การเช็กแค่อย่างใดอย่างหนึ่งไม่พอ ให้ validate นามสกุลหลัง decode ชื่อแล้ว และระวังนามสกุลซ้อน, null byte, ลูกเล่นเรื่องตัวพิมพ์เล็กใหญ่ และ NTFS alternate data stream ปฏิเสธชื่อที่มีตัวคั่น path, ลำดับ `..` หรือขึ้นต้นด้วยจุด ที่ดีกว่านั้นคือเก็บไฟล์ด้วยชื่อที่ server generate เอง แล้วเก็บชื่อของ client ไว้แค่ใช้แสดงผล แล้วก็ scan เนื้อหาหา malware และสำหรับไฟล์เอกสารก็ลองพิจารณา **content disarm and reconstruction** (CDR) ที่สร้างไฟล์ขึ้นใหม่โดยไม่มี active content อย่าง macro และ script
- **Injection ต้องใช้มากกว่า validation** validation ทำให้ attack surface เล็กลง แต่ตัวมันเองไม่ได้กัน SQL injection หรือ cross-site scripting: trusted host ยังต้องใช้ parameterised query และ output encoding ที่ดู context ส่วน injection rule ของ WAF เป็นแค่อีกชั้นหนึ่ง ไม่ใช่ทางแก้

### Deploy แบบแยกส่วน

เส้นแบ่งจะจริงได้แค่เท่ากับการแยกที่อยู่เบื้องหลังมัน:

- **แยก compute** แนวทางของ Azure คือให้รัน gatekeeper กับ trusted back end บน compute boundary แยกกัน process สองตัวบนเครื่องเดียวกันใช้อะไรร่วมกันเยอะเกินไป: privilege escalation ในเครื่องแค่ครั้งเดียว attacker ก็ได้ทั้งสองตัว
- **แยก identity ที่ไม่มีสิทธิ์ใน data plane** ให้ gatekeeper มี workload identity ของตัวเอง (managed identity, IAM role, Kubernetes service account) ที่มีสิทธิ์อย่างเดียวคือเรียก trusted host และให้ role ที่อ่านและเขียน database กับ blob container ไว้กับ identity ของ trusted host เท่านั้น ถ้าใช้ managed identity ก็อาจไม่มี secret อยู่บน trusted host เลยด้วยซ้ำ แต่หลักการไม่เปลี่ยน: ใครที่ได้รันโค้ดบนนั้นก็ทำตัวเป็นมันได้ host นั้นเลยต้องไม่หันหน้าไปหา internet
- **แยก network zone** วาง gatekeeper ไว้ใน perimeter subnet และวาง trusted host ไว้ใน subnet ภายใน ที่ไม่มี public IP address และไม่มี route จาก internet แล้วที่ trusted host ให้รับ inbound traffic จาก gatekeeper เท่านั้น และแค่ port เดียว: ทำได้ด้วย network security group rule (application security group ของ Azure ทำให้ rule ระบุเครื่องของ gatekeeper เป็น source ได้), rule ใน security group ของ AWS ที่อ้างถึง security group ของ gatekeeper หรือ `NetworkPolicy` ของ Kubernetes ที่ต้องมี network plugin คอยบังคับใช้ (ถ้าไม่มี plugin ตัว object นี้ก็ไม่มีผลอะไร) ถ้าเป็น network แบบ hub-and-spoke ตัว perimeter zone กับ workload จะอยู่คนละ spoke หรืออยู่ใน hub กับ spoke ก็ได้ โดยใช้ rule แบบเดียวกันคั่นไว้
- **เชื่อมต่อกับข้อมูลแบบ private** ทำให้ store เข้าถึงได้แค่ทาง private เช่น ผ่าน [private endpoint](../private-endpoints/) และอนุญาตแค่ network กับ identity ของ trusted host
- **ยืนยันตัวตนใน hop นี้** ใช้ TLS ระหว่าง gatekeeper กับ trusted host โดยเฉพาะ [mutual TLS](../mutual-tls/) ยิ่งดี เพราะ trusted host จะได้แยก gatekeeper ออกจากอะไรก็ตามที่ต่อมาถึง port นี้ได้ Azure บอกว่า hosting environment บางตัวไม่รองรับ HTTPS บน internal endpoint และนอกจาก internal endpoint แล้ว Azure ก็ยอมให้ใช้ queue หรือ broker เป็นช่องทางระหว่างสอง tier ได้ด้วย

### Defence in depth: trusted host ยังต้อง validate

gatekeeper ต้องไม่กลายเป็นด่านเดียว trusted host ควร:

- รับการเรียกจาก gatekeeper เท่านั้น โดยยืนยันตัวตนด้วย mutual TLS หรือ token
- validate ทุก request อีกรอบกับ contract ตัวเดียวกัน Azure คาดว่า gatekeeper จะทำ validation หลัก และยอมรับว่า trusted host อาจต้องทำเพิ่ม ส่วน OWASP ก็จัดการเชื่อข้อมูลเพียงเพราะมันมาทาง transport ภายในไว้เป็นความผิดพลาดที่เจอบ่อย
- ตรวจสิทธิ์กับข้อมูลของตัวเอง: เคลม 4471 เป็นของผู้ใช้ 1182 หรือเปล่า
- ใช้ parameterised query และ output encoding และเก็บไฟล์ด้วยชื่อที่ server generate ไว้นอก web root ทุกตัว (OWASP ถึงกับแนะนำให้แยก host สำหรับเก็บไฟล์)

แบบนี้ gatekeeper ที่โดนเจาะก็ส่งได้แค่สิ่งที่ client ที่ทำตัวดี ๆ ส่งได้อยู่แล้ว และเพราะ gatekeeper ควรปฏิเสธอะไรที่ไม่ valid ไปก่อนแล้ว การ validate ไม่ผ่านที่ trusted host เลยเป็นสัญญาณที่ชัดมาก: gatekeeper ถูกอ้อม ถูก config ผิด หรือโดนเจาะ

### อะไรเป็น gatekeeper ได้บ้าง

ตัวอย่างที่เช็กเมื่อตุลาคม 2026 ไม่ใช่ข้อบังคับ:

- **Web application firewall ที่อยู่หน้าแอป** Azure Application Gateway v2 (v1 ปลดระวางไปเมื่อ 28 เมษายน 2026) กับ Azure Web Application Firewall ใช้ managed rule ที่อิง OWASP Core Rule Set, custom rule, bot protection และ geo-filtering ตรวจ body แบบ JSON และ XML และบังคับ limit ขนาดของ request body และ file upload ในโหมด prevention มันจะบล็อก request ที่ rule ตีธงไว้ โดยตอบ 403 แล้วลง log ไว้ และ Microsoft แนะนำให้รัน WAF ตัวใหม่ในโหมด detection ไปสักพักก่อนเพื่อจูน exclusion ส่วน AWS WAF ปกป้อง Application Load Balancer, Amazon CloudFront distribution, Amazon API Gateway REST API และ resource อีกหลายประเภทได้ และตอบ request ที่ถูกบล็อกด้วย 403 หรือ custom response
- **ระวังข้อจำกัดของการตรวจ** AWS WAF ตรวจแค่ 8 KB แรกของ body เมื่ออยู่หลัง Application Load Balancer (บน CloudFront และ API Gateway คือ 16 KB โดย default และตั้งได้ถึง 64 KB) และ rule แต่ละตัวที่ตรวจ body ต้องตัดสินเองว่าจะทำยังไงกับ body ที่ใหญ่เกิน: ตรวจเท่าที่ใส่ได้ ถือว่า match หรือถือว่าไม่ match ส่วน Azure WAF ให้ตั้งได้ว่าจะตรวจลึกเข้าไปใน body แค่ไหน และถ้าตั้งไว้ต่ำก็อาจปล่อย content ที่ไม่ได้ตรวจผ่านไปได้ ตัว WAF อย่างเดียวเลยรับรอง PDF ขนาด 2 MB ไม่ได้: ไฟล์ต้องมีการเช็กของมันเอง
- **API management tier** ตัวอย่าง pattern นี้ของ Azure ซ้อน gatekeeper ไว้สองชั้น: Application Gateway กับ WAF เป็นชั้นนอก และ Azure API Management เป็นชั้นใน อยู่หน้า back end ที่เข้าถึงได้ผ่าน private endpoint เท่านั้น ส่วน policy ของ API Management ใช้ validate JWT, ทำ rate limit และ validate request body กับ schema ของ API (`validate-content` ที่จำกัดขนาด body ได้ด้วย สูงสุด 4 MB และปฏิเสธ property ที่เกินมาได้)
- **Reverse proxy** อย่าง NGINX หรือ Envoy ที่มี limit เรื่องขนาด, header normalisation และ upstream ตัวเดียว บวกกับ validation service หรือ plugin ของคุณเองสำหรับ contract
- **Service สำหรับ scan หรือทำ CDR กับไฟล์** จะอยู่ inline ใน gatekeeper tier หรือเป็นจุดแรกที่ upload ต้องผ่านก่อน trusted host จะเก็บก็ได้
- **Service เล็ก ๆ ของคุณเอง** ที่แค่ validate contract แล้วส่งต่อ: มักเป็นวิธีที่ง่ายที่สุดในการบังคับกฎอย่าง "PDF หรือ JPEG เท่านั้น ไม่เกิน 10 MB สำหรับเอกสารหมวดนี้"

### Availability, scaling และ throttling

ตอนนี้ทุก request พึ่ง gatekeeper ถ้ามี instance เดียวก็เป็น single point of failure และ Azure ก็แนะนำให้มี instance สำรองและทำ autoscaling แนวทางคือรัน replica หลายตัวหลัง [load balancer](../load-balancing/) ที่คอย probe health ของพวกมัน ([health endpoint monitoring](../health-endpoint-monitoring/)) กระจายไปหลาย zone และ scale ตาม request rate และ CPU: การ parse และเช็ก body ใหญ่ ๆ เป็นงานจริงจัง ตัว gatekeeper ยังเป็นที่ที่เหมาะที่จะ [rate-limit](../rate-limiting/) client ที่ใช้งานผิด ๆ ด้วย โดย Azure ชี้ว่าการ throttle ตรงนั้นช่วยให้ไม่ต้องประสาน rate counter ข้าม back-end node ทุกตัว แล้วก็จำกัดจำนวน upload ที่ทำพร้อมกันต่อ client ด้วย เพราะ upload ใหญ่ ๆ ที่ช้าจะถือ connection ค้างไว้

### Logging และ alerting

การปฏิเสธเป็นสัญญาณด้าน security เลยต้องเก็บไว้:

- log การปฏิเสธแต่ละครั้งพร้อม rule ที่ทำงาน, status code, คนที่เรียก, address ของ client, ขนาด และ correlation ID แล้วก็ทำตาม OWASP: อย่าเก็บ body ทั้งก้อนหรือ secret และ escape ค่าที่เชื่อไม่ได้ทุกตัวที่เก็บไว้ จะได้ปลอม log line ไม่ได้
- ส่ง log ของ WAF, gatekeeper และ trusted host ไปไว้ที่เดียว ([centralized logging](../centralized-logging/)) และสร้างหรือส่งต่อ correlation ID ที่ edge จะได้ตาม request หนึ่งข้ามทุก layer ได้ ([distributed tracing](../distributed-tracing/)) ตามที่ตัวอย่างของ Azure แนะนำ
- ตั้ง alert เมื่อการปฏิเสธพุ่งขึ้น เมื่อ client ตัวเดียวโดนปฏิเสธเยอะ ๆ (แล้วค่อย throttle หรือบล็อกมัน) และเมื่อมีการ validate ไม่ผ่านที่ trusted host แม้แต่ครั้งเดียว

### อยู่ตรงไหนเมื่อเทียบกับ pattern อื่น

- **[Valet key](../valet-key/)** เลือกแลกในทางตรงข้าม มันเอาแอปออกจาก data path: client ได้ key อายุสั้นที่ขอบเขตแคบ แล้วคุยกับ storage ตรง ๆ ส่วน gatekeeper ตั้งใจอยู่บนเส้นทาง เพื่อให้ทุก request ถูกตรวจก่อนไปถึงข้อมูล แนวทางเรื่อง valet key ของ Azure บอกกรณีที่ valet key ไม่ค่อยเหมาะไว้ เช่น ข้อมูลที่ต้อง validate ก่อนเก็บ หรือ upload ที่ต้องจำกัดขนาด กรณีพวกนั้นคือพื้นที่ของ gatekeeper แล้วสอง pattern นี้ก็ใช้ร่วมกันได้ด้วย: gatekeeper เป็นที่ที่ client มาขอ valet key ได้
- **[API gateway](../api-gateway/) และ [gateway offloading](../gateway-offloading/)** API gateway มักรับบทเป็น gatekeeper และ Azure ก็ใส่ gateway offloading กับ gateway routing ไว้ใน pattern ที่เกี่ยวข้อง แต่เจตนาต่างกัน: offloading ย้ายเรื่องที่ใช้ร่วมกันอย่าง TLS, authentication และ logging ไปไว้ที่ edge เพื่อความสม่ำเสมอ ส่วน gatekeeper คือ security boundary ตัว gateway จะเป็น gatekeeper ได้ก็ต่อเมื่อมันไม่ถือ credential ของ data store, service ข้างหลังมันเข้าถึงทางอื่นไม่ได้ และมัน validate เนื้อหาของ request ไม่ใช่แค่ header กับ token
- **[Zero trust access](../zero-trust-access/)** บอกว่าตำแหน่งใน network ไม่ได้ให้ความไว้ใจอะไร ตัว gatekeeper เข้ากับโมเดลนี้ได้ ตราบใดที่ไม่มีใครเอามันมาเป็นเหตุผลให้ไว้ใจทุกอย่างที่อยู่ข้างหลัง: trusted host ยังต้องยืนยันตัวตน gatekeeper และ validate ทุก request อีกรอบ
- **[Federated identity](../federated-identity/)** ที่อยู่ในรายการของ Azure ด้วย ทำให้ credential ของผู้ใช้ไม่ต้องมาอยู่ที่ gatekeeper: gatekeeper แค่ตรวจ token ที่ identity provider ออกให้แทน

## ใช้ตอนไหนดี

- ข้อมูลที่ sensitive หรือ operation ที่สำคัญมากที่อยู่หลัง endpoint ที่เปิดรับ internet: เคลม การชำระเงิน เวชระเบียน และ administrative API
- service ที่ parse input ซับซ้อนที่เชื่อไม่ได้ โดยเฉพาะ file upload ที่ bug ใน parser มีโอกาสเกิดได้จริง
- เมื่อ back-end service ต้องไม่ถูกเปิดออกไปตรง ๆ เด็ดขาด และการ validate request ควรมีเจ้าของและถูก review แยกจากโค้ดทางธุรกิจ

**ตอนไหนไม่ควรใช้:**

- **ข้างหลังไม่มีอะไร sensitive** เว็บ public ที่อ่านได้อย่างเดียว หรือ stateless service ที่ไม่ถือ secret อะไรเลย ได้ประโยชน์น้อยมากจาก tier ที่เพิ่มมา
- **path ที่ latency สำคัญมาก** ที่ hop ที่เพิ่มมากับเวลาที่ใช้ validate ทำให้เกิน latency budget กรณีนี้ Azure ก็ระบุไว้
- **แพลตฟอร์มมีเส้นแบ่งให้อยู่แล้ว** เมื่อ control ที่มีมาในตัวของ back-end service ตอบโจทย์เรื่อง security และ validation ได้โดยไม่ต้องมี tier แยก (ข้อยกเว้นอีกข้อของ Azure) เช่น managed API platform ที่ validate schema และเก็บ back end ไว้เป็น private
- **Bulk transfer ที่เช็กทีหลังได้ตอนมาถึงแล้ว** [valet key](../valet-key/) ทำให้ byte ไม่ต้องผ่าน tier ของคุณเลย แล้วค่อย scan และ quarantine ทีหลัง

## ได้อะไร เสียอะไร

- **Latency และค่าใช้จ่าย** มี network hop เพิ่ม และต้อง parse ทุก request เต็ม ๆ ส่วน body ใหญ่ ๆ ก็อาจถูก buffer สองรอบ
- **Availability** มี tier ใหม่บน critical path ที่ต้องทำ replica, monitor และ scale ตาม traffic
- **Contract drift** กฎของ gatekeeper ซ้ำกับ contract ของ service พอสองอย่างนี้เริ่มไม่ตรงกัน มันก็จะปฏิเสธ request ที่ valid (release พัง) หรือปล่อยสิ่งที่ service ไม่ได้คาดไว้ผ่านไป
- **Scope creep** business rule ("เคลมที่อยู่ระหว่างพิจารณาเท่านั้นที่รับ upload") ชวนให้ใส่เพิ่มเข้าไป แต่มันต้องใช้ข้อมูล และ gatekeeper ต้องไม่มีข้อมูล ส่วน Azure ก็บอกชัดเจนว่ามันแค่ validate และ sanitise
- **ความมั่นใจที่ผิด ๆ** gatekeeper ทำให้ attack surface เล็กลง แต่ไม่ได้ทำให้โค้ดของ trusted host ปลอดภัย
- **Debug ยากขึ้น** request หนึ่งวิ่งผ่านสอง component ความล้มเหลวเลยอาจอยู่ที่ตัวไหนก็ได้ ส่วน correlation ID กับ error code ที่สม่ำเสมอช่วยได้

## ข้อควรรู้ตอนลงมือทำ

- **contract เดียว ผู้บังคับใช้สองตัว** เก็บ schema (OpenAPI, JSON Schema) ไว้ที่เดียว generate validation ของ gatekeeper จากมัน validate เวอร์ชันเดียวกันที่ trusted host และ release ทั้งสองตัวพร้อมกัน
- **เริ่มจากโหมด detection** รัน WAF rule ในโหมด detection อ่าน log เพิ่ม exclusion แล้วค่อยเปลี่ยนไปเป็น prevention ให้ rule ของคุณเองมีสวิตช์ log-only ไว้ด้วยเหตุผลเดียวกัน
- **Fail closed** เมื่อ gatekeeper ประเมิน request ไม่ได้ (parser error, timeout หรือ body ที่เกิน limit ของการตรวจ) ให้ปฏิเสธไป บน AWS WAF ให้ตั้งใจเลือกวิธีจัดการ body ที่ใหญ่เกินให้ทุก rule ที่ตรวจ body เพราะถ้าตั้งนอก console ค่า default คือทำต่อด้วยส่วนที่ใส่ได้
- **ให้มันเล็กและน่าเบื่อ** image ขนาดเล็กที่สุด ไม่มี shell หรือ package manager, ใช้ file system แบบ read-only, ไม่มี outbound internet access และ patch ให้ไว: มันคือส่วนของระบบที่ attacker เข้าถึงได้
- **ตอบกลับให้น้อย** ตอบด้วย status code (`400`, `413`, `415 Unsupported Media Type`) กับ correlation ID ไม่ใช่บอกว่า rule ไหนทำงาน รายละเอียดควรอยู่ใน log
- **Test เส้นแบ่ง** จาก internet ให้เช็กว่า trusted host และ store ไม่ตอบ จาก gatekeeper ให้เช็กว่ามีแค่ port เดียวบน trusted host ที่ตอบ และเช็กว่า trusted host ปฏิเสธ request ที่ข้ามการ validate มา ทำซ้ำหลังเปลี่ยน network ทุกครั้ง
