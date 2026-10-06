## ปัญหา

แอปแชร์รูปเก็บไฟล์เป็นล้าน ๆ ไฟล์ ที่เขียนครั้งเดียว อ่านหลายครั้ง และต้องไม่หายเด็ดขาด ถ้าเก็บไว้บน disk ของ app server ไฟล์ก็อยู่ที่เดียว disk เต็มได้ และพังไปพร้อม server ส่วนการให้ทุก upload วิ่งผ่าน API ก็ทำให้ instance ถูกจองไว้ตลอดเวลาที่แต่ละไฟล์กำลังส่ง แถมรูปก็ยังต้องไปถึง CDN, งานทำ thumbnail และระบบ analytics อีก แอปเลยต้องการ storage ที่เก็บทุกไฟล์ไว้ได้แม้มีส่วนไหนพัง โตได้โดยไม่ต้องวางแผน capacity และอะไรก็ตามที่มีสิทธิ์ถูกต้องก็อ่านเขียนผ่าน HTTP ได้ โดยที่ API ไม่ต้องอยู่ในเส้นทางของข้อมูล

## ทำงานยังไง

Amazon S3 คือ object storage ที่อยู่หลัง HTTPS API ข้อมูลข้างล่างนี้มาจาก Amazon S3 User Guide และ AWS Price List ณ ตุลาคม 2026

### Bucket, key และ object

- **bucket** ถูกสร้างใน Region เดียว และเก็บ object ได้ไม่จำกัดจำนวน ขนาดและจำนวน object ใน bucket ไม่มีเพดาน ส่วน account หนึ่งสร้าง general purpose bucket ได้ 10,000 ตัวเป็นค่าตั้งต้น ชื่อ bucket ใช้ namespace ร่วมกันทั้งโลก (ภายใน partition เดียวกัน เช่นกลุ่ม Region เชิงพาณิชย์) ชื่อ `photos-prod` เลยต้องยังไม่มีใครใช้ นอกจากนี้ S3 ยังสร้าง bucket ใน [account regional namespace](https://docs.aws.amazon.com/AmazonS3/latest/userguide/gpbucketnamespaces.html) ของเราได้ด้วย โดยชื่อจะลงท้ายด้วย account ID, Region และ `-an`
- **object** ประกอบด้วย key, byte ของมัน (0 B ถึง 50 TB) และ metadata ตัว metadata มีทั้ง system metadata อย่าง `Content-Type`, `Content-Length`, `ETag` และ storage class, header `x-amz-meta-*` ที่เรากำหนดเองได้ถึง 2 KB และแก้ไม่ได้หลังอัปโหลด และ tag ได้ถึง 10 ตัว ที่ policy และ lifecycle rule ใช้ match ได้
- **key** คือ string แบบ UTF-8 ยาวได้ถึง 1,024 byte ส่วน general purpose bucket มี namespace แบบแบน: `u/9f3c/IMG_0042.jpg` คือ key เดียว และ slash มีไว้แค่ให้ `ListObjectsV2` ที่ใส่ `prefix=u/9f3c/` กับ `delimiter=/` แสดง key ออกมาเหมือนเป็น folder (ข้อยกเว้นคือ directory bucket ที่ S3 Express One Zone ใช้ ตัวนี้เก็บ directory จริง ๆ)
- ถ้าเปิด versioning ไว้ การเขียนแต่ละครั้งจะได้ **version ID** เป็น string ที่อ่านความหมายไม่ได้ ส่วน v1, v2 และ v3 ใน diagram เป็นแค่ป้ายให้อ่านง่าย ไม่ใช่ค่าที่ S3 ส่งกลับมา

### Request และ consistency

client เรียก `PutObject`, `GetObject`, `HeadObject`, `DeleteObject`, `CopyObject` และ `ListObjectsV2` โดยที่ request ที่ยืนยันตัวตนแล้วจะเซ็นด้วย AWS Signature Version 4 (SigV4) แล้ว S3 ก็ให้ **strong read-after-write consistency** กับทุก PUT และ DELETE ในทุก Region มาตั้งแต่ธันวาคม 2020: หลังเขียนสำเร็จ GET หรือ LIST ที่เริ่มทีหลังจะเห็นของใหม่เสมอ ก่อนจะรายงานว่าอัปโหลดสำเร็จ S3 จะเช็กว่าข้อมูลถูกเก็บไว้หลายชุดบนหลายอุปกรณ์แล้ว และ `ETag` ที่ส่งกลับมาคือ MD5 ของ byte ถ้าเป็นการอัปโหลดแบบ part เดียวที่ใช้ SSE-S3 ส่วนการอัปเดต key เดียวกันเป็น atomic คนอ่านเลยได้ object เก่าหรือใหม่ไปเลย ไม่มีทางได้ของผสม แต่มีสองเรื่องที่ไม่อยู่ในการรับประกันนี้:

- **คนเขียนพร้อมกัน** ถ้ามี PUT สองตัวไปที่ key เดียวกันในเวลาที่ทับกัน ตัวที่ timestamp ทีหลังจะชนะ ส่วน conditional write กันไม่ให้การอัปเดตหายได้: `If-None-Match: *` (ตั้งแต่สิงหาคม 2024) จะไม่ยอมเขียนทับ key ที่มีอยู่แล้ว และ `If-Match: <etag>` (ตั้งแต่พฤศจิกายน 2024) จะเขียนทับเฉพาะ version ที่เราอ่านมา ถ้าเงื่อนไขไม่ผ่านจะได้ `412 Precondition Failed`
- **การตั้งค่า bucket** เป็นแบบ eventually consistent ตัว user guide แนะนำให้รอ 15 นาทีหลังเปิด versioning ครั้งแรก แล้วค่อยเริ่มเขียน

### Durability และ availability

S3 ออกแบบมาให้มี durability 99.999999999 % (eleven nines) ต่อปี ตัว S3 Standard, Intelligent-Tiering, Standard-IA และ Glacier ทั้งสาม class เก็บแต่ละ object ไว้บนหลายอุปกรณ์ข้าม Availability Zone อย่างน้อยสาม zone และออกแบบมาให้รอดแม้ zone ทั้ง zone หายไป ส่วน S3 One Zone-IA กับ S3 Express One Zone เก็บข้อมูลไว้ใน zone เดียว เลยไม่มีการป้องกันแบบนั้น: AWS บอกไว้ว่าข้อมูลใน One Zone-IA ไม่รอดถ้า zone ของมันเสียหายทางกายภาพ ส่วน availability เป็นเป้าการออกแบบอีกตัวที่แยกกันในแต่ละ class ตั้งแต่ 99.99 % ของ S3 Standard ไปจนถึง 99.5 % ของ One Zone-IA แล้ว AWS ก็ไม่ได้เปิดเผยว่าข้อมูลที่เก็บซ้ำถูกวางไว้ยังไงภายในและข้าม zone ตัว chip ใน diagram แค่แสดงว่าแต่ละ zone มีข้อมูลของทุก version ที่เก็บไว้

### Storage class

storage class เลือกแยกได้ทีละ object ตอนอัปโหลด หรือให้ lifecycle rule เปลี่ยนทีหลัง ราคาเก็บข้อมูลเป็นราคาตั้งของ us-east-1 ต่อ GB-month (AWS Price List, กันยายน 2026) ส่วน Region อื่นราคาไม่เท่ากัน

| Class (ชื่อใน API) | ออกแบบมาสำหรับ | Zone | ระยะเวลาขั้นต่ำ | ขนาดขั้นต่ำที่คิดเงิน | การอ่าน | ค่าเก็บ |
|---|---|---|---|---|---|---|
| S3 Standard (`STANDARD`) | ข้อมูลที่อ่านบ่อย | ≥ 3 | ไม่มี | ไม่มี | ระดับ millisecond ไม่มีค่า retrieval | $0.023 (50 TB แรก) |
| S3 Intelligent-Tiering (`INTELLIGENT_TIERING`) | การเข้าถึงที่ไม่รู้หรือเปลี่ยนไปเรื่อย ๆ | ≥ 3 | ไม่มี | ไม่มี ส่วน object ที่เล็กกว่า 128 KB จะไม่ถูก monitor และอยู่ใน tier ที่ใช้บ่อยตลอด | ระดับ millisecond (archive tier ที่เปิดเพิ่มได้ต้อง restore ก่อน) | ตาม tier บวก $0.0025 ต่อ 1,000 object ที่ถูก monitor |
| S3 Standard-IA (`STANDARD_IA`) | ข้อมูลที่อ่านราว ๆ เดือนละครั้ง | ≥ 3 | 30 วัน | 128 KB | ระดับ millisecond, $0.01 ต่อ GB | $0.0125 |
| S3 One Zone-IA (`ONEZONE_IA`) | ข้อมูลที่สร้างใหม่ได้และใช้ไม่บ่อย | 1 | 30 วัน | 128 KB | ระดับ millisecond, $0.01 ต่อ GB | $0.01 |
| S3 Express One Zone (`EXPRESS_ONEZONE`) | งานที่ไวต่อ latency ใน zone เดียว ใน directory bucket | 1 | ไม่มี | ไม่มี | millisecond หลักเดียว | $0.11 |
| S3 Glacier Instant Retrieval (`GLACIER_IR`) | archive ที่อ่านราว ๆ ไตรมาสละครั้ง | ≥ 3 | 90 วัน | 128 KB | ระดับ millisecond, $0.03 ต่อ GB | $0.004 |
| S3 Glacier Flexible Retrieval (`GLACIER`) | archive ที่อ่านราว ๆ ปีละครั้ง | ≥ 3 | 90 วัน | overhead 40 KB ต่อ object | ต้อง restore ก่อน: 1–5 นาที (Expedited) ถึง 5–12 ชั่วโมง (Bulk) | $0.0036 |
| S3 Glacier Deep Archive (`DEEP_ARCHIVE`) | ข้อมูลที่อ่านไม่ถึงปีละครั้ง | ≥ 3 | 180 วัน | overhead 40 KB ต่อ object | ต้อง restore ก่อน: ภายใน 12 ชั่วโมง (Standard) หรือ 48 ชั่วโมง (Bulk) | $0.00099 |

Intelligent-Tiering ย้าย object ไปที่ tier Infrequent Access หลังไม่มีใครเข้าถึง 30 วัน และไปที่ Archive Instant Access หลัง 90 วัน โดยไม่มีค่า retrieval ถ้าลบหรือย้าย object ก่อนครบระยะเวลาขั้นต่ำของ class ก็จะโดนคิดเงินส่วนที่เหลือของระยะขั้นต่ำนั้น ส่วน Reduced Redundancy Storage ยังมีอยู่ แต่ AWS ไม่แนะนำให้ใช้

### Versioning, Object Lock, lifecycle และ replication

- **Versioning** ปิดอยู่ใน bucket ใหม่ พอเปิดแล้วจะ suspend ได้ แต่ปิดไม่ได้อีกเลย PUT ไปที่ key ที่มีอยู่แล้วจะเพิ่ม version ใหม่ ส่วน DELETE ธรรมดาจะเพิ่ม **delete marker** คือ version ที่ไม่มีข้อมูล ทำให้ GET ที่ไม่ระบุ version ID ได้ `404` ถ้าลบ marker ทิ้ง object ก็กลับมา และทุก version ยังอ่านได้ด้วย `?versionId=` แต่ละ version คือ object เต็มก้อน และคิดเงินเป็นหนึ่ง object
- **Object Lock** เก็บ version แบบ write-once-read-many: retention period (ในโหมด governance หรือ compliance) หรือ legal hold จะกันไม่ให้ version ถูกลบหรือเขียนทับ ตัวนี้ต้องเปิด versioning ด้วย
- **Lifecycle rule** match object ตาม prefix, tag หรือขนาด แล้วย้ายไปที่ class ที่เย็นกว่า (ย้ายได้แค่ลง "น้ำตก" จากอุ่นไปเย็น) ทำให้ version ปัจจุบันหรือ noncurrent version หมดอายุ และยกเลิก multipart upload ที่ค้างไม่เสร็จ ตั้งแต่กันยายน 2024 เป็นต้นมา object ที่เล็กกว่า 128 KB จะไม่ถูกย้าย เว้นแต่ rule จะสั่งไว้ ทำให้ thumbnail ขนาด 24 KB ยังอยู่ใน S3 Standard ถึงแม้ rule จะไม่ได้ระบุ prefix ก็ตาม
- **Replication** copy object ใหม่แบบ asynchronous ไปที่ bucket ใน Region อื่น (CRR) หรือใน Region เดียวกัน (SRR) โดยที่ bucket ทั้งสองฝั่งต้องเปิด versioning ส่วน S3 Replication Time Control จะ replicate 99.9 % ของ object ภายใน 15 นาที และรายงานตัวที่ใช้เวลานานกว่านั้น ส่วน S3 Batch Replication จะ copy object ที่มีอยู่ก่อนตั้ง rule

### การอัปโหลด: presigned URL และ multipart

**presigned URL** มี SigV4 signature, access key ของคนเซ็น และเวลาหมดอายุอยู่ใน query string ใครถือ URL ก็ทำ request นั้น request เดียวได้โดยไม่ต้องมี AWS credential มันทำได้แค่สิ่งที่คนเซ็นมีสิทธิ์ทำ URL ที่สร้างใน console อยู่ได้ตั้งแต่ 1 นาทีถึง 12 ชั่วโมง ส่วน CLI และ SDK ให้ได้ถึง 7 วันถ้าใช้ credential ระยะยาวของ IAM user แต่ URL ที่เซ็นด้วย credential ชั่วคราว อย่าง role ของ Lambda function จะใช้ไม่ได้ทันทีที่ credential นั้นหมดอายุ ไม่ว่า URL จะเขียนเวลาหมดอายุไว้เท่าไร ส่วน S3 เช็กเวลาหมดอายุตอน request เริ่ม การส่งไฟล์ที่กำลังวิ่งอยู่เลยไม่ถูกตัดกลางทาง ตัว API Lambda เซ็น URL สำหรับอัปโหลดแบบนี้ (boto3 1.43 โค้ดนี้แค่คำนวณ signature และไม่ได้เรียกอะไรออกไป):

```python
import boto3
from botocore.config import Config

# Sign with SigV4. Without this setting, boto3 1.43 produced a legacy
# Signature Version 2 URL for a us-east-1 client in our test.
s3 = boto3.client("s3", region_name="us-east-1",
                  config=Config(signature_version="s3v4"))

def handler(event, context):
    # The caller is already authenticated; the API picks the key, not the client.
    url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": "photos-prod", "Key": "u/9f3c/IMG_0042.jpg"},
        ExpiresIn=900,  # 15 minutes
    )
    return {"uploadUrl": url}
```

URL ที่ได้กลับมาจะลงท้ายด้วย `?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=…&X-Amz-Date=…&X-Amz-Expires=900&X-Amz-SignedHeaders=host&X-Amz-Security-Token=…&X-Amz-Signature=…` แล้วมือถือก็อัปโหลดด้วย HTTP PUT ธรรมดา เช่น `curl -X PUT -T IMG_0042.jpg "$UPLOAD_URL"` ส่วนคำสั่ง `aws s3 presign` ของ CLI สร้างได้แค่ GET URL

PUT ครั้งเดียวรับได้ถึง 5 GB ไฟล์ที่ใหญ่กว่านั้นต้องอัปโหลดแบบ **multipart upload**: แบ่งได้ถึง 10,000 part ขนาด part ละ 5 MiB ถึง 5 GiB (part สุดท้ายเล็กกว่านั้นได้) ส่งลำดับไหนก็ได้และส่งพร้อมกันได้ แล้ว `CompleteMultipartUpload` ก็ประกอบเป็น object เดียวขนาดได้ถึง 50 TB เพดานนี้ใช้มาตั้งแต่ธันวาคม 2025 (ก่อนหน้านั้นคือ 5 TB) ส่วน AWS แนะนำให้ใช้ multipart เมื่อ object ใหญ่ราว ๆ 100 MB ขึ้นไป ส่วน GET ครั้งเดียวคืนได้มากสุด 5 TB ทำให้ object ที่ใหญ่กว่านั้นต้องอ่านเป็นช่วง ๆ

### Event

**event notification** ส่ง message ไปที่ SNS topic หรือ SQS queue ใน Region เดียวกับ bucket หรือไปที่ Lambda function ตอนที่ object ถูกสร้าง ลบ restore ย้าย class หรือ replicate โดยกรองตามประเภท event และตาม prefix กับ suffix ของ key ได้ message มี bucket, key (แบบ URL-encoded), ขนาด, ETag, version ID และ `sequencer` ไว้เรียงลำดับ event ของ key เดียวกัน การส่งเป็นแบบ at least once ปกติถึงในไม่กี่วินาที แต่บางทีก็นานเป็นนาทีหรือมากกว่า และไม่เรียงลำดับ ส่วน SQS FIFO queue กับ SNS FIFO topic ใช้เป็นปลายทางไม่ได้ ถ้า consumer เขียนกลับไปที่ bucket เดิม ให้จำกัด notification ไว้ที่ prefix ขาเข้า (ในที่นี้คือ `u/`) ไม่อย่างนั้นมันจะปลุกตัวเองซ้ำ

อีกทางคือเปิด **Amazon EventBridge** ให้ bucket แทน แบบนี้ S3 จะส่ง event ทุกประเภทไปที่ EventBridge แล้ว rule ก็ match ตาม field ของ event และส่งต่อไปที่ target ได้หลายแบบ รวมถึง SQS FIFO queue ด้วย

### Security

- สิทธิ์เข้าถึงตัดสินด้วย **IAM policy** ที่ผูกกับ principal และ **bucket policy** ที่ผูกกับ bucket ส่วน bucket ใหม่ที่สร้างตั้งแต่เมษายน 2023 จะเปิด **S3 Block Public Access** และ **ปิด ACL** (Object Ownership: bucket owner enforced) ไว้ เพราะฉะนั้นจะไม่มีอะไรเป็น public เว้นแต่มีคนตั้งใจปิดสองอย่างนี้
- object ใหม่ทุกตัวถูกเข้ารหัสตอนเก็บมาตั้งแต่ 5 มกราคม 2023 โดยใช้ SSE-S3 (key ที่ S3 จัดการให้) เป็นค่าตั้งต้น ส่วน SSE-KMS และ DSSE-KMS ใช้ key ของ AWS KMS ส่วน bucket ใหม่ที่สร้างตั้งแต่เมษายน 2026 ก็ไม่รับ SSE-C (key ที่ลูกค้าให้มาเอง) [เว้นแต่เราจะเปิดมัน](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ServerSideEncryptionCustomerKeys.html)
- **Access point** คือ endpoint ที่มีชื่อและผูกกับ bucket แต่ละตัวมี policy ของตัวเอง ช่วยได้มากตอนที่หลายทีมใช้ dataset เดียวกัน
- **CloudFront origin access control (OAC)** เซ็น request ที่ CloudFront ส่งไปหา S3 โดยที่ bucket policy อนุญาตให้ principal `cloudfront.amazonaws.com` ทำ `s3:GetObject` ได้เฉพาะตอนที่ `AWS:SourceArn` เป็น distribution ตัวนี้

### Performance

S3 scale ความจุของ request แยกตาม **partitioned prefix**: อย่างน้อย 3,500 PUT/COPY/POST/DELETE และ 5,500 GET/HEAD request ต่อวินาทีต่อ prefix และไม่จำกัดจำนวน prefix การ scale ขึ้นค่อยเป็นค่อยไป และระหว่างนั้น S3 อาจตอบ `503 Slow Down` ที่ SDK จะ retry ให้ การกระจาย key ไปหลาย prefix (ในที่นี้คือหนึ่ง prefix ต่อ user) ทำให้เพดานคูณขึ้นไป ถ้าอยากได้ throughput ให้ส่ง request พร้อมกันหลายตัว: ใช้ multipart ตอนอัปโหลด และใช้ GET แบบ byte-range (`Range: bytes=…`) หรือ `?partNumber=` ตอนดาวน์โหลด ส่วน object เล็ก ๆ ตัว user guide บอกว่า median latency อยู่ที่ระดับหลายสิบ millisecond

### Cost

บิลมีสี่ส่วน: ค่าเก็บต่อ GB-month (ข้างบน), **request** (ใน S3 Standard ที่ us-east-1 คือ $0.005 ต่อ PUT, COPY, POST หรือ LIST 1,000 ครั้ง และ $0.0004 ต่อ GET 1,000 ครั้ง), **retrieval** จาก class กลุ่ม IA และ Glacier และ **data transfer out**: $0.09 ต่อ GB สำหรับ 10 TB แรกต่อเดือนที่ส่งออก internet หลังพ้น free tier ส่วนระยะเวลาและขนาดขั้นต่ำ, noncurrent version และ delete marker ล้วนเพิ่มเข้าไปในบิล และถ้ามี object เล็ก ๆ เยอะ ค่า request ก็จะสำคัญกว่าค่าเก็บ

## อยู่ตรงไหนใน solution

- **Solution** user upload ของเว็บและแอปมือถือ (อย่างตัวอย่างนี้), static site และ media ที่อยู่หลัง CDN, ชั้น storage ของ data lake ที่ Athena, EMR หรือ Redshift query ได้ตรงที่ข้อมูลอยู่, backup และ archive (ใช้ Object Lock ทำสำเนาที่แก้ไม่ได้), archive ของ log และ payload ที่ใหญ่เกินจะใส่ใน message
- **Pattern ใน catalog นี้** presigned URL คือ [Valet Key](../valet-key/) ในแบบของ S3 ส่วน S3 ก็มักเป็นที่เก็บ payload ของ [Claim Check](../claim-check/) เป็นชั้น bronze, silver และ gold ของ [Medallion Architecture](../medallion-architecture/) และเป็น origin ใน [CDN edge caching](../cdn-edge-caching/) ด้าน versioning กับ cross-Region replication ใช้ทำ [disaster recovery](../disaster-recovery-strategies/) และ event notification ก็เป็นตัวเริ่ม pipeline แบบ [event-driven](../event-driven-architecture/) และ [web-queue-worker](../web-queue-worker/)
- **ของที่อยู่ข้าง ๆ** CloudFront อยู่ข้างหน้า, [AWS Lambda](../aws-lambda/), [Amazon SQS](../amazon-sqs/), SNS และ EventBridge สำหรับ event, Athena และ AWS Glue สำหรับ analytics, KMS สำหรับ key และ IAM สำหรับสิทธิ์ ถ้าเป็นตาราง **S3 Tables** (ธันวาคม 2024) เก็บตาราง Apache Iceberg ไว้ใน table bucket และจัดการงาน maintenance อย่าง compaction ให้
- **Managed offering** S3 ก็คือ managed service อยู่แล้ว ส่วน cloud อื่นก็มีโมเดลเดียวกัน (ดูข้างล่าง) และ RADOS Gateway ของ Ceph ก็ implement S3 API ส่วนใหญ่ไว้ให้ cluster ที่ host เอง

## ใช้ตอนไหนดี

ใช้ S3 เมื่อข้อมูลเป็นไฟล์หรือ blob ที่เขียนทีเดียวทั้งก้อน แล้วอ่านหลายครั้งโดยคนอ่านหลายคนผ่าน HTTP: content ของ user, media, backup, ไฟล์ใน data lake และ build artefact ส่วนถ้าต้อง query, อัปเดตทีละนิด หรือทำ transaction ข้ามหลาย item ให้เลือก database และถ้าซอฟต์แวร์ต้องเปิดไฟล์แล้วแก้ตรงนั้นเลย ให้เลือก file system

| | Amazon S3 | Azure Blob Storage | Google Cloud Storage | S3-compatible store ที่ host เอง | Amazon EFS |
|---|---|---|---|---|---|
| โมเดล | object ใน bucket, HTTPS API | blob ใน container, HTTPS API | object ใน bucket, HTTPS API | S3 API หรือส่วนใหญ่ของมัน (Ceph RGW) | ไฟล์และ directory ผ่าน NFS v4.0 และ v4.1 |
| ตัวเลือก redundancy | ≥ 3 zone หรือ zone เดียว, replicate ข้าม Region | LRS (datacenter เดียว), ZRS (สาม zone ขึ้นไป), GRS และ GZRS แบบ geo-redundant | bucket แบบ region, dual-region หรือ multi-region | แล้วแต่ cluster ของเรา | Regional (หลาย zone) หรือ One Zone |
| tier ที่เย็นกว่า (ระยะเวลาขั้นต่ำ) | Standard-IA 30 d, Glacier IR และ Flexible 90 d, Deep Archive 180 d | Cool 30 d, Cold 90 d, Archive 180 d (offline อ่านทีเป็นชั่วโมง) | Nearline 30 d, Coldline 90 d, Archive 365 d | ฮาร์ดแวร์ของเรา | ไม่ได้เทียบในที่นี้ |
| Event เมื่อมีการเปลี่ยนแปลง | SNS, SQS, Lambda, EventBridge | Event Grid | Pub/Sub notification | แล้วแต่ product | ไม่ได้เทียบในที่นี้ |
| ลิงก์อายุสั้น | presigned URL ได้ถึง 7 วัน | shared access signature (SAS) | signed URL ได้ถึง 7 วัน | แล้วแต่ product | ไม่มี: client mount file system เอา |
| ใครเป็นคนรัน | AWS | Microsoft | Google | เราเอง ส่วน repository AGPLv3 ของ MinIO ถูก [archive และไม่มีคนดูแลแล้ว](https://github.com/minio/minio) (ตุลาคม 2026) ตอนนี้ vendor ขาย AIStor แทน มีทั้ง standalone edition แบบฟรี และแบบเชิงพาณิชย์ | AWS |

feature ใหม่ ๆ ทำให้เส้นแบ่งกับ file system เลือนลง: directory bucket ของ S3 Express One Zone ต่อท้าย object และเปลี่ยนชื่อมันได้ แล้ว S3 FAQ ก็พูดถึง [Amazon S3 Files](https://aws.amazon.com/s3/faqs/) คือ shared file system ที่สร้างบน EFS และแสดง bucket ออกมาเป็นไฟล์

## ได้อะไร เสียอะไร

- **ทั้งก้อนเท่านั้น** ใน general purpose bucket เราแก้ object ต่อท้าย หรือเปลี่ยนชื่อไม่ได้: การเปลี่ยนคือ PUT ใหม่ทั้งก้อน และการเปลี่ยนชื่อคือ copy แล้วลบ
- **Latency** หลายสิบ millisecond ต่อ request เล็ก ๆ เหมาะกับไฟล์ที่ดึงมาเป็นครั้งคราว ไม่เหมาะกับการใช้แบบถี่ ๆ เหมือน database: อ่านเขียนชิ้นเล็กเยอะ ๆ เสียทั้งเวลาและค่า request
- **ค่าใช้จ่ายมีหลายมิเตอร์** ค่า retrieval, ระยะเวลาขั้นต่ำ, ค่า request ต่อครั้ง และค่า egress อาจแพงกว่าค่าเก็บข้อมูลเสียอีก lifecycle rule ที่ส่ง object เล็ก ๆ หรืออายุสั้นไปที่ class กลุ่ม Glacier อาจเสียมากกว่าที่ประหยัดได้
- **Event มาถึงแบบ eventual** notification อาจมาช้า มาซ้ำสองครั้ง หรือมาไม่เรียงลำดับ consumer เลยต้อง idempotent และใช้ `sequencer` หรือ version ID
- **เพดาน request rate ต่อ prefix** ถ้า traffic พุ่งขึ้นทันทีที่ prefix เดียว จะเจอ `503 Slow Down` จนกว่า S3 จะ scale เสร็จ ตอน rate สูง ๆ การออกแบบ key เลยสำคัญ
- **ผูกกับ Region** bucket อยู่ใน Region เดียว ถ้าจะใช้ใน Region อื่นต้อง replicate และยอมรับต้นทุนกับความล่าช้าของมัน

## ข้อควรรู้ตอนลงมือทำ

- ให้ API เป็นคนเลือก key และเซ็น URL อายุสั้นสำหรับ key เดียวเท่านั้น อย่าให้ client ตั้งชื่อ key เองตามใจ แล้วตรวจไฟล์ที่อัปโหลดทีหลัง (ประเภท, ขนาด, malware) ใน event consumer ก่อนที่อย่างอื่นจะเอาไปใช้
- จำกัด notification และ lifecycle rule ด้วย prefix เพื่อให้การเขียนลง `thumbnails/` ไม่ไปปลุก Thumbnailer ซ้ำ และไม่ถูกย้ายไป archive นี่คือ lifecycle configuration ของ bucket นี้ ตั้งค่าด้วย `aws s3api put-bucket-lifecycle-configuration --bucket photos-prod --lifecycle-configuration file://lifecycle.json`:

  ```json
  {
    "Rules": [
      {
        "ID": "originals-to-glacier-ir",
        "Filter": { "Prefix": "u/" },
        "Status": "Enabled",
        "Transitions": [{ "Days": 90, "StorageClass": "GLACIER_IR" }],
        "NoncurrentVersionExpiration": { "NoncurrentDays": 30 },
        "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
      }
    ]
  }
  ```

  และ event notification ตั้งค่าด้วย `aws s3api put-bucket-notification-configuration --bucket photos-prod --notification-configuration file://notify.json` (access policy ของ queue ต้องอนุญาตให้ S3 ส่งเข้าไปได้):

  ```json
  {
    "QueueConfigurations": [
      {
        "QueueArn": "arn:aws:sqs:us-east-1:111122223333:thumbnail-jobs",
        "Events": ["s3:ObjectCreated:*"],
        "Filter": { "Key": { "FilterRules": [{ "Name": "prefix", "Value": "u/" }] } }
      }
    ]
  }
  ```

- ทำ consumer ให้เป็น [idempotent consumer](../idempotent-consumer/): เขียน thumbnail เดิมซ้ำสองครั้งไม่เป็นไร แต่ส่ง notification สองครั้งไปหา user ไม่ได้ แล้ววาง [dead-letter queue](../dead-letter-queue/) ไว้หลัง SQS queue สำหรับไฟล์ที่พังซ้ำ ๆ
- ถ้าเปิด versioning ให้ใส่ `NoncurrentVersionExpiration` ด้วย เว้นแต่ตั้งใจจะเก็บทุก version ไม่อย่างนั้นทุกการเขียนทับและทุกการลบจะเก็บสำเนาเต็มไว้ และคิดเงินไปตลอดกาล
- เสิร์ฟการดาวน์โหลดผ่าน CloudFront ที่ใช้ OAC และเปิด Block Public Access ไว้ ส่วนไฟล์ส่วนตัวที่ไม่ควรถูก cache ให้ใช้ presigned GET URL
- ใช้ `If-None-Match: *` เมื่อ key ต้องถูกเขียนแค่ครั้งเดียว และคอยดูจำนวน `503` (S3 Storage Lens หรือ server access log) เพื่อหา prefix ที่ร้อน
