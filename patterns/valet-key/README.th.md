## ปัญหา

แอปที่รับหรือส่งไฟล์ใหญ่ ๆ (วิดีโอ รูป เอกสาร backup ชุดข้อมูล) มักเริ่มจากการเอา API ไปไว้ตรงกลาง ตัว client upload ไปที่ API แล้ว API ก็เขียน byte ลง object storage ด้วย credential ของตัวเอง ส่วน download ก็ใช้ทางเดียวกันแต่กลับทิศ วิธีนี้ใช้ได้ แต่มันทำให้แอปไปอยู่บน **data path**:

- **ทุก byte วิ่งผ่านแอปสองรอบ** ขาเข้าจาก client แล้วขาออกไปที่ storage (หรือกลับกันสำหรับ download) คุณต้องจ่ายค่า compute ที่ทำแค่ก็อป byte และค่า network ทุก hop ที่อยู่ระหว่างทาง: load balancer, gateway, NAT
- **request ที่กินเวลาหลายนาที** การ upload 2 GB ผ่านเน็ตบ้านใช้เวลาหลายนาที ตลอดเวลานั้น request ก็ถือ connection, worker และ buffer ใน memory หรือ disk ไว้ และทุก layer ที่อยู่ข้างหน้ามัน (load balancer, API gateway, serverless platform) ก็ต้องตั้ง timeout และขนาด body ไว้กว้างพอให้มันผ่านไปได้ gateway และ function platform แบบ managed หลายตัวก็จำกัดทั้งสองอย่างไว้
- **scale ผิดเรื่อง** API tier ต้องถูกกำหนดขนาดตาม bandwidth และจำนวน transfer ที่เกิดพร้อมกัน แทนที่จะกำหนดตามงานที่มีแค่มันทำได้ และพอ upload เข้ามาเป็นชุด ๆ การเรียก API อื่นทุกตัวก็ช้าลงตาม
- **transfer พังง่าย** พอ connection หลุด การ upload ก็ต้องเริ่มใหม่ผ่าน API แล้ว API ก็ต้อง stream ทั้งหมดอีกรอบ

ทางลัดที่เห็นชัด ๆ คือให้ storage credential กับ client ไปเลย แต่แบบนั้นแย่กว่าเดิม เพราะ credential พวกนั้นมักทำ operation อะไรก็ได้กับ object ตัวไหนก็ได้ จำกัดให้เหลือแค่ไฟล์ของผู้ใช้คนเดียวไม่ได้ และดึงคืนจากอุปกรณ์ไม่ได้ถ้าไม่ rotate ให้ทุกคน

## ทำงานยังไง

เหมือน valet key ของรถที่สตาร์ทเครื่องได้แต่เปิดท้ายรถไม่ได้ **valet key** ให้สิทธิ์แค่พอดีกับงาน และในที่นี้ให้แค่ช่วงสั้น ๆ แอปยังเป็นคนตัดสินว่า *ใครทำอะไรได้* แต่ถอยออกจาก *data path*: มันส่ง token ที่อายุสั้นและขอบเขตแคบให้ client ในทางปฏิบัติก็คือ signed URL ที่ storage service ตรวจเองได้ จากนั้น client ก็ส่ง byte ตรงไปหรือดึงตรงมาจาก storage

1. **API อยู่บน data path (แบบเดิม)** Ana upload `video-981.mp4` ขนาด 2 GB ของเธอไปที่ API แล้ว API ก็ stream ต่อไปที่ storage ตัว API instance ไม่ว่างไปหลายนาที และทุก byte ก็วิ่งผ่านมันสองรอบ
2. **ขอ key ไม่ใช่ขอส่งข้อมูล** client ขอสิทธิ์จาก API เพื่อ upload `video-981.mp4` ตัว API ยืนยันตัวตน Ana (เช่น ด้วยการ [ตรวจ access token ของเธอ](../jwt-validation/)) ตรวจว่าเธอเพิ่มวิดีโอเข้าอัลบั้มนี้ได้ เลือกชื่อ object และ sign URL ที่ทำได้ **operation เดียว** (เขียน) กับ **object เดียว** (`albums/ana/video-981.mp4`) ใช้ได้ **15 นาที** ผ่าน **HTTPS** และจะจำกัดขนาดกับ content type ด้วยก็ได้ ตัว credential ที่ใช้ sign ไม่เคยออกจาก server ส่วน client ได้ไปแค่ URL
3. **ตรงไปที่ storage** client upload ด้วย URL นั้น แล้ว storage ก็ตรวจ signature และเช็กเวลาหมดอายุ ชื่อ object และ operation (รวมถึงเงื่อนไขอื่นที่ sign ไว้) ก่อนจะรับ byte โดยที่ API ไม่ต้องยุ่งเลย พอ object ถูก commit แล้ว storage ก็ส่ง event ออกมา และการประมวลผลก็เริ่ม: scanner ตรวจไฟล์และ scan หา malware ก่อนที่อะไรจะเอามันไปใช้ ถ้าไม่ผ่านก็ย้ายไป quarantine ส่วนไฟล์นี้สะอาด ตัว thumbnail worker เลยหยิบไปทำต่อ การประมวลผลส่วนนี้ก็คือ [event-driven architecture](../event-driven-architecture/) ธรรมดา ๆ
4. **key หลุดไปก็ทำอะไรได้น้อย** URL ที่ถูกก็อปไปทำได้แค่สิ่งที่มันเขียนไว้: เขียน object ตัวนั้นตัวเดียวจนกว่าจะหมดอายุ เอาไปอ่านหรือลบก็โดนปฏิเสธ และพ้น 15 นาทีไปแล้วก็โดนปฏิเสธหมดทุกอย่าง ส่วนที่ยากคือการดึง key คืนก่อนหมดอายุ (ดู *Revocation และการรั่วไหล* ด้านล่าง) ฝั่ง download ก็ทำแบบเดียวกัน ด้วย URL อายุสั้นที่อ่านได้อย่างเดียว

การออก key เป็นแค่งาน cryptography เล็ก ๆ ไม่ใช่การเรียกที่ย้ายข้อมูล ทำให้ API instance ตัวเดียวแจก key ให้ transfer หลายตัวพร้อมกันได้

### แต่ละ provider ทำยังไง

**Azure Storage: shared access signature (SAS)** SAS คือชุด query parameter ที่ต่อท้าย URL ของ resource: resource ที่ sign (blob, container หรือ directory), permission (เช่น *create*, *write*, *read* และ *delete*), เวลาเริ่มและเวลาหมดอายุ, ช่วง IP และ protocol ที่อนุญาต (จะใส่หรือไม่ใส่ก็ได้) และ signature แล้ว SAS ก็แบ่งได้เป็นสามแบบ:

- **User delegation SAS** sign ด้วย *user delegation key* ที่แอปขอมาด้วย Microsoft Entra identity ของตัวเอง (ปกติคือ managed identity) เลยไม่มี account key มาเกี่ยวเลย และ Microsoft ก็แนะนำให้ใช้แบบนี้ทุกครั้งที่ใช้ SAS มันใช้ได้กับ Blob Storage (รวมถึง Data Lake Storage), Queue Storage, Table Storage และ Azure Files ตัว key และ SAS ทุกตัวที่ sign ด้วยมันใช้ได้นานสุดเจ็ดวัน และตอนที่มีการใช้ SAS ตัว Azure ก็เช็กด้วยว่า identity ที่อยู่เบื้องหลัง key ยังมี permission ที่ delegate ออกไปอยู่หรือเปล่า
- **Service SAS** sign ด้วย storage account key สำหรับ resource ใน service เดียว
- **Account SAS** sign ด้วย account key เหมือนกัน แต่ครอบคลุมได้หลาย service และทำ operation บางอย่างที่ service SAS ทำไม่ได้

**Stored access policy** บน container, table, queue หรือ share เก็บเวลาเริ่ม เวลาหมดอายุ และ permission ไว้ให้ทุก service SAS ที่อ้างถึงมัน (สูงสุดห้า policy ต่อ container) การแก้หรือลบ policy เลยเปลี่ยนหรือ revoke SAS พวกนั้นได้ในทีเดียว แต่การเปลี่ยนอาจใช้เวลาถึง 30 วินาทีกว่าจะมีผล ส่วน user delegation SAS กับ account SAS ใช้ stored access policy ไม่ได้ ตั้งแต่ service version 2025-07-05 ตัว user delegation SAS ยังผูกกับ Microsoft Entra user คนเดียวได้ด้วย (field `sduoid`) แล้วผู้ใช้คนนั้นต้องส่ง bearer token ของตัวเองมาด้วย แบบนี้เหมาะกับแอปสำหรับพนักงานมากกว่าแอปสำหรับผู้บริโภค มี guardrail ระดับ account สองตัวที่ช่วยได้: **SAS expiration policy** จะ log (ค่า default) หรือบล็อก SAS ตัวไหนก็ตามที่มีอายุนานกว่าที่คุณยอม และ **การปิด Shared Key authorization** ทำให้ Blob Storage ปฏิเสธ service SAS กับ account SAS ขณะที่ user delegation SAS ยังใช้ได้ตามปกติ

**Amazon S3: presigned URL และ presigned POST** ตัว presigned URL มี signature แบบ AWS Signature Version 4 สำหรับ request หนึ่งตัว เช่น `PutObject` หรือ `GetObject` กับ key เดียว พร้อมเวลาหมดอายุ มันทำงานด้วย permission ของคนที่ sign มัน และเป็น bearer token: ใครถือไว้ก็ใช้ได้ กี่ครั้งก็ได้ จนกว่าจะหมดอายุ

- **อายุขึ้นกับ credential ที่ใช้ sign** ถ้า sign ด้วย access key ของ IAM user ผ่าน AWS CLI หรือ SDK ตัว URL จะอยู่ได้นานสุดเจ็ดวัน (ใน console ได้ตั้งแต่ 1 นาทีถึง 12 ชั่วโมง) ถ้า sign ด้วย temporary credential (IAM role session, role credential ของ EC2 instance ที่ปกติอยู่ได้หกชั่วโมง หรือ AWS STS credential แบบอื่น) ตัว URL จะอยู่นานกว่า credential นั้นไม่ได้ ตัว URL ยังหยุดทำงานด้วยถ้า credential ที่ sign มันถูก revoke ลบ หรือปิดใช้งาน ไม่ว่าเวลาหมดอายุที่ใส่ไว้จะเป็นเท่าไร
- **เวลาหมดอายุถูกเช็กตอน request เริ่ม** download ที่เริ่มทันเวลาจะได้ทำต่อจนเสร็จ แต่ retry หลังหมดอายุจะไม่ผ่าน
- **presigned PUT เขียนทับ** object ที่มี key เดียวกันอยู่แล้ว ส่วน conditional write (`If-None-Match: *`) กันเรื่องนี้ได้ และ bucket policy ก็บังคับให้ต้องใช้มันได้
- **Presigned POST** มีไว้สำหรับ upload ผ่าน HTML form จาก browser โดย server จะ sign *POST policy* ที่มีเวลาหมดอายุและเงื่อนไข: bucket กับ key ที่ระบุตรงตัว, prefix แบบ `starts-with` สำหรับ key หรือ content type และ `content-length-range` สำหรับขนาดต่ำสุดและสูงสุด
- **bucket policy เพิ่ม guardrail** ที่ใช้กับ presigned request ด้วย: `s3:signatureAge` ปฏิเสธ signature ที่เก่ากว่าที่คุณยอม แล้ว `aws:SourceIp`, `aws:SourceVpc` และ `aws:SourceVpce` ก็จำกัดเส้นทาง network ส่วน `aws:SecureTransport` ปฏิเสธ HTTP ธรรมดา

**Google Cloud Storage: V4 signed URL และ signed policy document** ตัว V4 signed URL ให้สิทธิ์ request แบบเดียว (method, object และ header ที่ sign ไว้) ได้นานสุดเจ็ดวัน (604,800 วินาที) ปกติจะ sign ในนามของ service account จะใช้ private key ของ account นั้น หรือใช้ผ่าน method `signBlob` ของ IAM โดยไม่ต้องจับ key เลยก็ได้ แล้ว HMAC key ก็ใช้ได้เหมือนกัน ตัว account ที่ sign ต้องมีสิทธิ์ทำ request นั้นเองด้วย และใครที่ถือ URL ไว้ก็ใช้มันได้จนกว่าจะหมดอายุ ตัว client ต้องส่ง header ที่ sign ไว้ให้ตรงตามที่ sign ไว้ ทำให้ URL ล็อก `Content-Type` ไว้ได้ หรือล็อก header `x-goog-content-length-range` ที่จำกัดขนาดของ PUT ก็ได้ สำหรับการ upload ผ่าน form ของ browser ตัว **policy document** ทำหน้าที่แบบเดียวกับ POST policy ของ S3 ด้วยเงื่อนไข `eq`, `starts-with` และ `content-length-range` ส่วนถ้าเป็นไฟล์ใหญ่ ตัว server ก็เริ่ม **resumable upload** แล้วส่ง session URI ให้ client ได้ โดยที่ session URI นั้นทำหน้าที่เป็น bearer credential ได้นานสุดหนึ่งสัปดาห์

### กำหนดขอบเขตของ key

ให้ key แต่ละตัวได้สิทธิ์น้อยที่สุดเท่าที่ต้องใช้:

- **object เดียว ที่ server เป็นคนตั้งชื่อ** generate ชื่อ object เอง (`albums/ana/video-981.mp4` หรือ ID แบบสุ่ม) แทนการใช้ชื่อไฟล์ของ client ตามที่ OWASP File Upload Cheat Sheet แนะนำ ส่วน key ที่ครอบทั้ง prefix (SAS ระดับ container หรือ directory ของ Azure หรือ form policy ของ S3 หรือ Cloud Storage ที่ใช้ `starts-with` กับ key) ให้ใช้กับงานแบบ batch ที่จำเป็นจริง ๆ เท่านั้น
- **operation เดียว** write (หรือ create) สำหรับ upload, read สำหรับ download และอย่าให้ list หรือ delete ถ้างานไม่ได้ต้องใช้
- **อายุสั้น** หลักนาที: นานพอให้เริ่ม transfer และ retry ได้หนึ่งครั้ง แต่สั้นเกินกว่าจะคุ้มให้ขโมย ให้ออก key ใหม่สำหรับรอบถัดไป แทนการใช้ key อายุยาวตัวเดียว
- **HTTPS เท่านั้น** SAS ของ Azure รับทั้ง HTTP และ HTTPS ถ้าคุณไม่ตั้ง field protocol ไว้ให้เป็น HTTPS อย่างเดียว (`spr=https`) ส่วน storage account ใหม่ก็บังคับ secure transfer โดย default อยู่แล้ว บน S3 ให้ใช้ bucket policy กับ `aws:SecureTransport`
- **ขนาดและประเภท ถ้า service บังคับได้** presigned POST ของ S3 (`content-length-range`), policy document ของ Cloud Storage และ header `x-goog-content-length-range` จำกัดขนาดตอน upload ได้ และ presigned PUT ก็ล็อก `Content-Type` ได้ ส่วน SAS ไม่มีเงื่อนไขเรื่องขนาด บน Azure เลยต้องเช็กขนาดทีหลัง Azure Architecture Center เองก็บอกว่ากลไก key ส่วนใหญ่จำกัดขนาดของการ upload ไม่ได้ ไม่ว่าแบบไหน content type ที่ประกาศมาก็ไม่ได้พิสูจน์อะไรเกี่ยวกับ byte จริงเลย (ดู *ตรวจสิ่งที่ส่งมาถึง*)
- **ห้ามเขียนทับ** conditional write ของ S3 และ permission *create* ของ Azure กันไม่ให้ key เอาไปแทน object ที่มีอยู่แล้ว บน Azure ตัว *create* ยอมให้สร้าง blob ใหม่ได้ใน Put Blob request เดียว ส่วนการ upload ทีละ block ต้องใช้ *write*
- **ช่วง IP ของ client ถ้ารองรับ** SAS ของ Azure ใส่ช่วง IPv4 ได้ (`sip`) และ bucket policy ของ S3 ก็เช็ก `aws:SourceIp` ได้ แต่สองอย่างนี้ไม่ค่อยช่วยกับ client บนมือถือและที่บ้าน เพราะ address ของพวกนี้เปลี่ยนไปเรื่อย ๆ

### การออก key

- **ยืนยันตัวตนและตรวจสิทธิ์ก่อน** endpoint ที่ออก key ก็คือ API call ธรรมดา: ตรวจ token ของคนที่เรียกมา ([JWT validation](../jwt-validation/)) แล้วใช้กฎของคุณเอง: Ana เพิ่มวิดีโอเข้าอัลบั้ม *นี้* ได้ ภายใน quota ของเธอ และไม่เกินขนาดสูงสุด ตัว key จะแคบได้แค่เท่ากับการตัดสินที่อยู่เบื้องหลังมัน
- **sign ด้วย identity ไม่ใช่ secret ที่เก็บไว้** ใช้ managed identity กับ user delegation SAS บน Azure, IAM role บน AWS และ service account ผ่าน `signBlob` บน Google Cloud ให้ identity ที่ใช้ sign มีแค่ permission ที่ key ควรจะให้ได้เท่านั้น: ทั้งสาม service ไม่ยอมให้ key ทำได้มากกว่าคนที่ sign มัน
- **ส่งผ่าน HTTPS และอย่าให้ไปอยู่ใน log** ส่ง URL กลับไปใน response body การ redirect ไปที่ signed URL จะทำให้มันไปอยู่ใน history ของ browser แบบนี้รับได้สำหรับลิงก์ download แต่ไม่ใช่สำหรับ key ที่ใช้ upload
- **บันทึกว่าออกอะไรไปบ้าง**: ให้ใคร object ไหน operation อะไร และหมดอายุเมื่อไร จะได้จับคู่ storage log กับการตัดสินที่ยอมให้เกิด request พวกนั้นได้ Azure แนะนำให้ทำ field ของ SAS อย่างเวลาหมดอายุให้ไม่ซ้ำกันในแต่ละ client ด้วยเหตุผลเดียวกัน
- **ระวังนาฬิกาคลาดกัน** Azure แนะนำให้ไม่ใส่เวลาเริ่มใน SAS หรือตั้งไว้ย้อนหลังอย่างน้อย 15 นาที แต่ถ้ามี SAS expiration policy ให้ใส่: policy จะนับ SAS ที่ไม่มีเวลาเริ่มว่าผิด policy และ action *block* ของมันก็จะปฏิเสธ SAS ตัวนั้น ส่วน Cloud Storage รับ V4 signature ได้ตั้งแต่ 15 นาทีก่อน `X-Goog-Date` ของมัน

### ตรวจสิ่งที่ส่งมาถึง

valet key คุมได้ว่า *ใครเขียนที่ไหนได้* แต่ไม่ได้คุมว่า *เขาเขียนอะไร* ให้ถือว่าทุก upload ไม่น่าไว้ใจจนกว่าจะตรวจแล้ว:

- **ประมวลผลตาม storage event** S3 Event Notifications (ไปที่ Amazon SQS, Amazon SNS หรือ AWS Lambda หรือผ่าน Amazon EventBridge), event `BlobCreated` ของ Azure Event Grid (filter ให้เหลือ `PutBlob`, `PutBlockList`, `CopyBlob` และ `FlushWithClose` จะได้ trigger เฉพาะ blob ที่ commit เสร็จแล้ว) หรือ Pub/Sub notification ของ Cloud Storage (`OBJECT_FINALIZE` ที่ upload ที่ล้มเหลวจะไม่ trigger) ทั้งสามแบบส่ง event อย่างน้อยหนึ่งครั้ง เลยต้องทำการประมวลผลให้เป็น idempotent ([idempotent consumer](../idempotent-consumer/))
- **ตรวจไฟล์ตัวจริง** เช็กขนาดและ format จริงของไฟล์ (signature byte ของมัน) ไม่ใช่ `Content-Type` ที่ประกาศมา เพราะ client เป็นคนคุมค่านั้น OWASP File Upload Cheat Sheet อธิบายเรื่องนี้ไว้ รวมถึงการ scan malware และ content disarm and reconstruction สำหรับไฟล์เอกสาร
- **Scan หา malware** ตัวเลือกแบบ managed ก็มี on-upload malware scanning ของ Microsoft Defender for Storage และ Amazon GuardDuty Malware Protection for S3 ที่ใส่ tag ผล scan ให้แต่ละ object ได้ ถ้าใช้ที่อื่นก็รัน scanner ของคุณเองจาก event
- **Quarantine จนกว่าจะสะอาด** upload เข้า container หรือ prefix *incoming* ที่ไม่มีอะไรอื่นมาอ่าน แล้ว promote ไฟล์ที่สะอาด (หรือเปลี่ยน status ใน database ของคุณ) และย้ายไฟล์ที่ไม่ผ่านไป quarantine คนที่อ่านไฟล์ต้องไม่มีวันเห็นไฟล์ที่ยังไม่ได้ scan
- **ปิดวงจรกับ API** client รายงานว่าเสร็จแล้ว หรือ API รู้เองจาก event ทำให้ API บันทึกการ upload ได้ หยุดออก key สำหรับ object นั้น และแสดงวิดีโอให้ Ana ดู

### Revocation และการรั่วไหล

signed URL เป็น bearer credential เลยต้องดูแลมันเหมือน password ที่มีตัวจับเวลา

- **มันรั่วจากไหนบ้าง:** access log ของ server, proxy และ CDN (query string เป็นส่วนหนึ่งของ URL), history ของ browser, เครื่องมือ analytics และ error reporting, ข้อความแชตและ support ticket และ header `Referer` แม้โดย default browser จะส่งแค่ origin ไปที่เว็บอื่น (`strict-origin-when-cross-origin`) แต่ URL เต็ม ๆ ก็ยังติดไปกับ request ที่เป็น same-origin และกับ policy ที่หลวมกว่านี้ เลยต้องเสิร์ฟ `Referrer-Policy: no-referrer` ในหน้าที่จัดการ signed URL
- **อย่าให้มันไปอยู่ใน log** ตัด query string หรือ signature ออกก่อนที่ log จะออกจาก host หรือ pipeline ([centralized logging](../centralized-logging/)) และจำกัดคนที่อ่าน storage access log ได้
- **การ revoke ก่อนหมดอายุขึ้นกับว่า key ถูก sign ยังไง** และทำได้แค่ในระดับที่หยาบกว่า URL ตัวเดียวเสมอ:
  - *Azure:* ลบ เปลี่ยนชื่อ หรือทำให้ stored access policy ที่อยู่เบื้องหลัง service SAS หมดอายุ ถ้าเป็น user delegation SAS ให้ revoke user delegation key ของ account หรือเอา role ของ identity ที่ใช้ sign ออก ทั้งสองอย่างถูก cache ไว้ การเปลี่ยนเลยมีผลหลังจากหน่วงไปช่วงหนึ่ง ถ้าเป็น SAS ที่ sign ด้วย account key ให้ rotate key แล้ว SAS ทุกตัวที่ sign ด้วยมันก็จะใช้ไม่ได้
  - *AWS:* ปิดใช้งานหรือลบ access key ที่ sign URL หรือ sign ด้วย IAM role ที่ใช้เฉพาะงานนี้ แล้ว revoke session ที่ยัง active ของ role นั้น วิธีนี้จะปฏิเสธ session credential ทุกตัวที่ออกก่อนวินาทีนั้น และ URL ที่ credential พวกนั้น sign ไว้ก็ใช้ไม่ได้ไปด้วย ส่วน bucket policy ที่ deny request ก็ใช้ได้เหมือนกัน
  - *Google Cloud:* ลบ key ที่ sign URL: service account key หรือ HMAC key ที่จะหยุดทำงานทันที ส่วน URL ที่ sign ผ่าน `signBlob` ใช้ key ที่ Google ถือและ rotate เอง สำหรับ URL พวกนั้นเลยต้องพึ่งอายุที่สั้นแทน
- **revocation หยาบ เลยต้องแยกตัวที่ sign** identity หรือ policy สำหรับ sign ที่แยกตามจุดประสงค์ (upload กับ download หรือหนึ่งตัวต่อหนึ่ง tenant) ทำให้ตัดตัวหนึ่งได้โดยไม่ทำให้ตัวอื่นพัง

### ไฟล์ใหญ่

- **Amazon S3** PUT ครั้งเดียวรับได้ถึง 5 GB และ AWS แนะนำให้พิจารณา multipart upload ตั้งแต่ประมาณ 100 MB ส่วน multipart upload หนึ่งตัวมีได้ถึง 10,000 part ขนาด 5 MiB ถึง 5 GiB ต่อ part สำหรับ object ขนาดถึง 50 TB ขั้นตอนคือ server เริ่ม upload แล้ว presign URL ให้ part ละหนึ่งตัว จากนั้น client ก็ upload ทุก part พร้อมกันแล้วส่ง ETag ของแต่ละ part กลับมา แล้ว server ก็ complete การ upload และอย่าลืมเพิ่ม lifecycle rule ที่ลบ multipart upload ที่ทำไม่เสร็จด้วย
- **Azure Blob Storage** client library ส่ง blob ใหญ่เป็น block (Put Block แล้วตามด้วย Put Block List) และ SAS ที่มี permission *write* ก็ทำแบบนี้ได้ ส่วน event `BlobCreated` จะ fire เมื่อ block list ถูก commit แล้ว
- **Google Cloud Storage** ใช้ resumable upload: server เริ่ม session แล้วส่ง session URI ให้ client ตัว session URI รอดผ่าน connection ที่หลุดได้นานสุดหนึ่งสัปดาห์ และ session จะผูกอยู่กับ region ที่มันเริ่ม
- **อายุของ key เทียบกับเวลา transfer** key ต้องใช้ได้ตลอดทั้ง transfer รวมถึงการ retry part แต่ละ part แทนที่จะใช้ key อายุยาวตัวเดียว ให้ออก URL แยกต่อ part หรือให้ client ขอ key ใหม่ได้

### Upload จาก browser และ CORS

หน้าเว็บที่เสิร์ฟจาก `app.example` แล้วส่ง PUT ไปที่ endpoint ของ storage คือการทำ cross-origin request เลยต้องมี CORS rule บน bucket หรือ storage account ให้อนุญาต origin ของแอป, method (PUT หรือ POST) และ request header ที่การ upload ส่งไป (`Content-Type` บวก `x-ms-blob-type` สำหรับ Put Blob request ของ Azure) และ expose `ETag` ถ้า browser ต้องอ่าน ETag ของ part ใน multipart ส่วนการ upload ผ่าน HTML form (presigned POST ของ S3, policy document ของ Cloud Storage) ทำให้ form ธรรมดาใน browser POST ตรงไปที่ storage ได้เลย

### Download

- **ไอเดียเดียวกันแต่กลับทิศ** หลังเช็กว่าผู้ใช้ดู object นั้นได้ ให้ส่ง URL แบบอ่านอย่างเดียวที่อายุสั้นสำหรับ object นั้นกลับไป หรือ redirect browser ไปที่ URL นั้น
- **ตั้ง response header ผ่าน key** ถ้า service รองรับ: `response-content-disposition` และ parameter อื่น ๆ ที่คล้ายกันของ S3 (ใช้ได้แค่ใน request ที่ sign แล้ว) หรือ field ใน SAS ที่ override header อย่าง `Content-Disposition` และ `Cache-Control` บน Azure ไฟล์ที่ควรถูกบันทึกเลยถูก download แทนที่จะถูกเปิดแสดง
- **ผ่าน CDN** สำหรับ content ที่เสิร์ฟปริมาณมาก ให้เอา CDN ไปไว้ข้างหน้าแล้วเช็ก signature ที่ edge: signed URL (สำหรับไฟล์เดียว) หรือ signed cookie (สำหรับหลายไฟล์ เช่น ทุก segment ของวิดีโอ HLS) ของ Amazon CloudFront และ signed URL กับ signed cookie ของ Google Cloud CDN แล้วให้ bucket เป็น private ไว้ ผู้ใช้จะได้อ้อมการเช็กของ CDN ไม่ได้ CloudFront แนะนำให้บังคับใช้ URL ของมันก็ด้วยเหตุผลนี้แหละ ดู [CDN & edge caching](../cdn-edge-caching/)

### การเข้าถึงทาง network

key ให้สิทธิ์ทำ request แต่ไม่ได้เปิดเส้นทาง network ตัว Azure Storage ก็ใช้ firewall และ virtual network rule ของมันกับ SAS request ด้วย (ช่วง IP ของ SAS ทำให้การเข้าถึงแคบลงได้ แต่ไม่เคยขยายเกิน network rule) และ bucket policy ของ S3 ที่ใช้ `aws:SourceIp`, `aws:SourceVpc` หรือ `aws:SourceVpce` ก็มีผลกับ presigned request ถ้า storage account หรือ bucket รับ traffic ผ่าน [private endpoint](../private-endpoints/) เท่านั้น ตัว client บน internet ก็ใช้ valet key กับมันไม่ได้: ต้องมี public endpoint หรือมี CDN อยู่ข้างหน้า ส่วน client ภายในก็ใช้เส้นทาง private ต่อไปได้

### อยู่ตรงไหนเมื่อเทียบกับ pattern อื่น

- **[Gatekeeper](../gatekeeper/)** แลกในทางตรงข้าม: broker ที่ถูก harden แล้วจะอยู่บนเส้นทาง และตรวจกับ sanitize ทุก request ก่อนจะไปถึง storage ที่เชื่อถือได้ เลือกมันเมื่อข้อมูลต้องถูกตรวจก่อนเก็บ และเลือก valet key เมื่อ store บังคับข้อจำกัดได้เอง และการตรวจทำทีหลังได้
- **Token สำหรับ API** [JWT validation](../jwt-validation/) และ [OAuth 2.0 client credentials](../oauth2-client-credentials/) เป็นเรื่องการเรียก API ในฐานะผู้ใช้หรือในฐานะ service ส่วน valet key แคบกว่านั้น: เป็นสิทธิ์ทำ storage operation หนึ่งตัว ที่ store ตรวจได้โดยไม่ต้องรู้ว่า Ana เป็นใคร
- **[Zero trust access](../zero-trust-access/)** แต่ละ request พกหลักฐานที่อายุสั้นและสิทธิ์น้อยที่สุดของตัวเองมา และ resource ก็ตรวจมันทุกครั้ง แบบนี้เข้ากับการออกแบบแบบ zero trust แต่ storage ไม่เห็น context ของผู้ใช้หรือ device เลย access policy เลยต้องอยู่ตรงที่ออก key
- **งานเบื้องหลัง** event ที่เริ่มการ scan มักป้อนเข้า queue และกลุ่ม worker แบบเดียวกับใน Web-Queue-Worker และ [competing consumers](../competing-consumers/)

## ใช้ตอนไหนดี

- upload และ download ที่ใหญ่หรือมีจำนวนมาก: media, เอกสาร, backup, ชุดข้อมูล, build artefact
- client บน browser และมือถือที่ควรคุยกับ storage ตรง ๆ โดยเฉพาะเมื่อ API รันบน serverless หรือ gateway platform ที่จำกัดขนาดหรือระยะเวลาของ request
- แชร์ไฟล์แบบมีเวลาจำกัดให้คนที่ไม่มีบัญชีบน storage ของคุณ เช่น partner หรือ support engineer
- traffic ของการ upload ที่พุ่งขึ้นเป็นช่วง ๆ และถ้าไม่ใช้ pattern นี้ก็จะบังคับให้คุณต้อง scale API tier

**ตอนไหนไม่ควรใช้:**

- **แอปต้องแปลงข้อมูลอยู่แล้ว** เช่น re-encode, เข้ารหัสด้วย key ที่มีแค่แอปถือ หรือรวมกับข้อมูลอื่นก่อนเก็บ ยังไงแอปก็อยู่บน data path อยู่ดี
- **ข้อมูลต้องถูกตรวจก่อนเก็บ** เช่น เมื่อ policy ห้ามเก็บ content ที่ยังไม่ได้ scan แม้แต่ใน quarantine ให้เอา gatekeeper ไปไว้บนเส้นทางแทน
- **คุณต้องคุมแต่ละ transfer ได้แบบเป๊ะ ๆ** เช่น ใช้ได้ครั้งเดียว หรือนับจำนวน download ได้แม่นยำ และ store บังคับเรื่องนั้นไม่ได้
- **client เข้าถึง storage ไม่ได้** เช่น เมื่อ storage รับแค่ traffic จาก private network
- **payload เล็ก ๆ** ที่ round trip เพิ่มเพื่อขอ key แพงกว่าการ stream ผ่าน API

## ได้อะไร เสียอะไร

- **คุมได้น้อยลงระหว่าง transfer** key ใช้ซ้ำได้เรื่อย ๆ จนกว่าจะหมดอายุ และบาง service ก็จำกัดขนาดของการ upload ไม่ได้
- **revocation หยาบ** ปกติทำได้แค่ตัด key ทุกตัวที่ sign ด้วย credential หรือ policy เดียวกัน
- **client มีงานเพิ่ม:** ขอ key, upload, retry, renew, รายงานว่าเสร็จ และ CORS สำหรับ browser
- **การตรวจย้ายไปอยู่หลัง upload** ต้องมี quarantine, การ scan และการประมวลผล event และต้องมีวิธีแสดงสถานะ "กำลังประมวลผล" ให้ผู้ใช้เห็น
- **audit ต้องดูสองระบบ:** record ของ key ที่ API ออกไป กับ storage access log โดยจับคู่ด้วยชื่อ object และเวลา
- **storage ต้องหันหน้าไปหา client** มันต้องเข้าถึงได้จากที่ที่ client อยู่ และ config ของมัน (CORS rule, public access settings, network rule) ก็กลายเป็นส่วนหนึ่งของ attack surface ของคุณ

## ข้อควรรู้ตอนลงมือทำ

- **ใช้ helper ใน SDK** แทนการเขียน signature เอง: presigner ใน AWS SDK, SAS builder ใน client library ของ Azure Storage และฟังก์ชัน signed URL ใน client library ของ Cloud Storage หรือ `gcloud storage sign-url`
- **ส่ง key กลับไปพร้อมทุกอย่างที่ client ต้องส่ง**: method, header ที่ sign ไว้ (content type, ช่วงขนาด) และเวลาหมดอายุ client จะได้แยกออกว่าเป็น key หมดอายุ หรือพังจริง ๆ
- **อย่าเปิด public access ให้ bucket** สำหรับ client ทางเข้าทางเดียวควรเป็น key
- **เฝ้าดู storage log** หา request ที่ถูกปฏิเสธรัว ๆ บน object เดียว การ upload ที่ไม่มี key ที่ออกไว้ตรงกัน และ key ที่ถูกใช้จากที่ที่ไม่คาดคิด บน Azure ถ้าเปิด diagnostic logging ไว้ SAS expiration policy ก็จะบันทึกทุกครั้งที่มีการใช้ SAS ที่เกิน policy ด้วย
- **Test เวลาหมดอายุ นาฬิกาคลาด และการ retry** ความล้มเหลวที่ผู้ใช้สังเกตเห็นคือการ upload ที่หยุดไปกลางทาง ไม่ใช่ "access denied" ตั้งแต่ request แรก
