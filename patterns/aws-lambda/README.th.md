## ปัญหา

แอปรูปมีงานสองแบบ แบบแรกคือ API เล็ก ๆ: `GET /photos/{id}` ต้องตอบให้เร็ว ไม่ว่าจะมีคนเปิดรูปไม่กี่คนตอนกลางคืน หรือเป็นร้อยคนต่อวินาทีตอนหัวค่ำ แบบที่สองคืองานเบื้องหลัง: ทุก upload ต้องมี thumbnail และ upload ก็มาเป็นระลอก ถ้ารัน server สำหรับทั้งสองงาน ก็ต้องกำหนดขนาด fleet ให้รับ peak ตอนหัวค่ำแล้วจ่ายเงินมันทั้งคืน ต้อง patch ระบบปฏิบัติการและ language runtime และต้องเขียนโค้ดที่ดึง message ออกจาก queue, retry และเพิ่ม worker เมื่อ queue ยาวขึ้น ทั้งสองงานไม่ต้องมี server ของตัวเองเลย แต่ละงานเป็นโค้ดสั้น ๆ ที่ควรรันตอนมี request หรือ event เข้ามา และรันหลายชุดเท่ากับจำนวน event ในตอนนั้น

## ทำงานยังไง

AWS Lambda รัน **function** คือ handler ของเราพร้อม dependency ที่ package เป็น .zip archive หรือ container image ทุกครั้งที่มีอะไรมาเรียกมัน ส่วนทุกอย่างที่อยู่ข้างใต้เป็นหน้าที่ของ Lambda: host, ระบบปฏิบัติการ, language runtime, การ scale และการ route แต่ละ request ไปหาโค้ดชุดหนึ่ง แอปรูปมีสอง function: `get-photo` ที่อยู่หลัง API Gateway และ `make-thumbnail` (Python, memory 1,024 MB, timeout 60 วินาที) ที่รับงานจาก SQS queue `thumbnail-jobs`

### สามวิธีเรียก function

วิธีเรียก function เป็นตัวตัดสินว่าใครต้องรอ ใคร retry และ event ที่พังจะไปจบที่ไหน:

| Invocation | ใครใช้ | ใครรอ | ตอน handler พัง |
|---|---|---|---|
| **Synchronous** (`InvocationType` `RequestResponse`) | API Gateway, function URL, SDK และ CLI | ตัวเรียก จนกว่า handler จะ return | error กลับไปหาตัวเรียก โดยที่ Lambda ไม่ retry และ API Gateway ก็ส่ง error ต่อไปให้ client ของมัน |
| **Asynchronous** (`InvocationType` `Event`) | notification ของ S3 และ [SNS](../amazon-sns/), [EventBridge](../amazon-eventbridge/) rule, EventBridge Scheduler | ไม่มีใครรอ: Lambda เอา event เข้า queue ภายในของตัวเองแล้วตอบ 202 ทันที | Lambda retry สองครั้ง รอ 1 นาทีแล้วรออีก 2 นาที จากนั้นก็ส่ง record ไปที่ on-failure destination หรือส่ง event ไปที่ dead-letter queue หรือทิ้งไป |
| **Event source mapping** (polling) | SQS, [Kinesis](../amazon-kinesis-data-streams/), DynamoDB Streams, Amazon MSK และ [Kafka](../kafka/) ที่ดูแลเอง, Amazon MQ, Amazon DocumentDB | poller ของ Lambda ที่อ่าน batch แล้วเรียก function แบบ synchronous พร้อม batch นั้น | ถ้ามาจาก queue ตัว batch จะกลับมามองเห็นได้อีกหลัง visibility timeout และ redrive policy ของ queue ก็ย้ายตัวที่พังซ้ำ ๆ ไปที่ dead-letter queue ของ queue เอง ถ้ามาจาก stream ตัว batch จะถูก retry และทำให้ shard ของมันติดอยู่จนกว่าจะสำเร็จหรือ record หมดอายุ |

S3 เรียก `make-thumbnail` ตรง ๆ แบบ asynchronous ก็ได้ แต่แอปรูปเลือกส่ง event `ObjectCreated` ไปที่ `thumbnail-jobs` แทน ทำให้ queue ช่วยรับ burst และ event source mapping เป็นตัวตัดสินเรื่อง batching, concurrency และ retry

### Execution environment

ทุก invocation รันใน **execution environment**: sandbox ที่มี memory ของ function, runtime ของมัน และ directory `/tmp` ส่วนใน compute type ตั้งต้นของ Lambda แต่ละ environment ถูกแยกออกจากกันด้วย Firecracker microVM คือ virtual machine monitor แบบ open-source ที่ AWS อธิบายไว้ที่ NSDI 2020 แต่ละ environment ผ่านสามช่วง:

- **Init** Lambda start extension ทุกตัวที่มี แล้ว bootstrap runtime และรันโค้ด static ของ function: ทุกอย่างที่อยู่นอก handler อย่าง import, configuration และ SDK client ส่วนสำหรับ function แบบ on-demand ช่วงนี้มีเวลา 10 วินาที ถ้าหมดเวลา Lambda จะลอง Init ใหม่ระหว่าง invocation แรก โดยนับอยู่ใน timeout ของ function
- **Invoke** Lambda รัน handler สำหรับ event หนึ่งตัว โดยมี function timeout เป็นเพดาน (60 s สำหรับ `make-thumbnail` และ 900 s เป็นอย่างมาก)
- **Shutdown** ตอน Lambda ปลด environment ออก extension ที่ลงทะเบียนไว้จะมีเวลาเก็บกวาดได้ถึง 2 วินาที (500 ms ถ้ามีแค่ internal extension ตัวเดียว)

หลังแต่ละ invocation ตัว environment จะถูก **freeze** พอ request ถัดไปของ function เดียวกันมาถึง Lambda ก็ thaw มันแล้วรันแค่ handler ได้: object ที่สร้างไว้ตอน Init ยังอยู่ใน memory ไฟล์ใน `/tmp` ก็ยังอยู่ และงานเบื้องหลังที่ค้างไว้ก็ทำต่อ ตัว Lambda เก็บ environment ที่ว่างไว้สักพัก แต่ไม่สัญญาอะไร มันลบตัวที่ว่างทิ้ง และยังเปลี่ยน environment ใหม่ทุกไม่กี่ชั่วโมงเพื่ออัปเดต runtime และ maintenance แม้แต่กับ function ที่ถูกเรียกตลอดเวลา เพราะฉะนั้นให้มองสิ่งที่รอดมาเป็น cache อย่ามองเป็น state

### Cold start

request ที่หา environment ว่างไม่เจอต้องรอตัวใหม่: Lambda สร้าง environment โหลดโค้ด และรัน Init ก่อนจะรัน handler นี่คือ **cold start** ส่วนการใช้ environment ที่ freeze ไว้ซ้ำคือ **warm start** เอกสารของ AWS บอกว่า cold start ปกติกระทบ invocation ไม่ถึง 1% และกินเวลาตั้งแต่ไม่ถึง 100 ms ไปจนเกินหนึ่งวินาที ขึ้นกับขนาด package, runtime และปริมาณงานที่ Init ทำเป็นหลัก แล้วตั้งแต่ 1 สิงหาคม 2025 ช่วง Init ก็ถูกคิดเงินเป็น duration ในทุก configuration ส่วนทางที่จะทำให้มันสั้นลงหรือเลี่ยงมันมีสามทาง:

- **ทำ Init ให้เบาลง**: package เล็กลง import น้อยลง และโหลด library ตัวหนักเฉพาะตอนที่ต้องใช้
- **Provisioned concurrency** เก็บ environment ไว้ตามจำนวนที่ตั้งและ initialise ไว้ล่วงหน้า สำหรับ `get-photo` คือ 2 ตัว เราตั้งค่ามันบน version หรือ alias และจ่ายเงินตลอดเวลาที่ตั้งไว้ ส่วน request ที่เกินจากนั้นจะล้นไปที่ environment แบบ on-demand ที่อาจ start แบบ cold
- **SnapStart** รัน Init ตอนเรา publish version แล้ว snapshot memory และ disk ของ environment ที่ initialise แล้ว และเริ่ม environment ใหม่จาก snapshot นั้น ณ ตุลาคม 2026 มันรองรับ Java 11 ขึ้นไป, Python 3.12 ขึ้นไป และ .NET 8 ขึ้นไป ตัว SnapStart ใช้ร่วมกับ provisioned concurrency, EFS หรือ `/tmp` ที่เกิน 512 MB ไม่ได้ และอะไรที่ต้องไม่ซ้ำกันที่สร้างไว้ตอน Init (ID, random seed, credential) ต้องสร้างใหม่หลัง restore แล้วถ้าเป็น Java ก็ไม่มีค่าใช้จ่ายเพิ่ม ส่วน function ที่เป็น Python และ .NET ต้องจ่ายค่า caching และค่า restore แต่ละครั้ง

### Concurrency และการ scale

ใน compute type ตั้งต้น environment หนึ่งตัวรับ **ทีละ request เดียว** ทำให้ concurrency หรือจำนวน environment ที่ทำงานพร้อมกัน ประมาณเท่ากับ request ต่อวินาที × duration เฉลี่ย ที่ 50 upload ต่อวินาที และ 0.8 s ต่อ thumbnail ตัว `make-thumbnail` จะมี environment ทำงานอยู่ประมาณ 50 × 0.8 = 40 ตัว ไม่ว่า batch size จะเท่าไร: ถ้า batch เต็ม 10 ทุกครั้ง จะมีประมาณ 5 invocation เริ่มในแต่ละวินาที และแต่ละตัวรันประมาณ 8 s ส่วนตัวควบคุมพร้อมค่าตั้งต้น ณ ตุลาคม 2026 มีดังนี้:

- **Account quota** 1,000 concurrent execution ต่อ Region ใช้ร่วมกันทุก function ใน account และขอเพิ่มได้ถึงหลักหมื่น ส่วน account ใหม่จะเริ่มที่ค่าต่ำกว่านี้ แล้ว AWS ก็เพิ่มให้อัตโนมัติตามการใช้งาน
- **อัตราการ scale** แต่ละ function เพิ่ม environment ได้ถึง 1,000 ตัวทุก 10 วินาที
- **Reserved concurrency** เป็นทั้งเพดานและการรับประกันให้ function หนึ่งตัว: `make-thumbnail` จะไม่รันเกิน 100 environment และมี 100 ตัวกันไว้ให้มัน ส่วน Lambda จะเหลืออย่างน้อย 100 unit ที่ไม่ได้ reserve ไว้ให้ function อื่นเสมอ และ reserved concurrency 0 ทำให้ function หยุดทำงานไปเลย ตัวนี้ไม่มีค่าใช้จ่าย
- **SQS event source mapping** scale poller ของตัวเองแยกต่างหาก มันเริ่มที่ 5 concurrent invocation แล้วเพิ่มได้ถึง 300 ต่อนาที จนถึงสูงสุด 1,250 ต่อ mapping ส่วน **maximum concurrency** (2 ถึง 1,000) จำกัดว่า queue หนึ่งดันได้แค่ไหน ให้ตั้งไว้ไม่เกิน reserved concurrency ของ function ไม่อย่างนั้น message จะโดน throttle อีกทางคือ **provisioned mode** ที่เก็บ poller ไว้ให้พร้อมตามจำนวนขั้นต่ำและสูงสุด โดยมีค่าใช้จ่าย
- **Throttling** ถ้า request มาเร็วกว่าที่ function จะ scale ทัน หรือชน limit ตัว invocation จะพังด้วย HTTP 429 (`TooManyRequestsException`) ตัวเรียกแบบ synchronous จะได้ error ส่วน event แบบ asynchronous นั้น Lambda จะเก็บไว้และ retry ได้นานถึง 6 ชั่วโมง ส่วน event source mapping จะ back off และ message ก็รออยู่ใน queue

### ความล้มเหลวและ at-least-once delivery

ถ้าเปิด `ReportBatchItemFailures` ให้ mapping ไว้ ตัว `make-thumbnail` จะคืน ID ของ message ที่ process ไม่ได้ใน `batchItemFailures` แล้ว Lambda ก็ลบที่เหลือ ถ้าไม่ได้เปิดไว้ ทุก exception จะทำให้ทั้ง batch พัง และ message ที่ดีก็ต้องรันซ้ำ ส่วน message ที่พังจะกลับมามองเห็นได้หลัง visibility timeout ของ queue และพอถูกรับครบ `maxReceiveCount` ครั้ง redrive policy ก็ย้ายมันไปที่ `thumbnail-jobs-dlq` ทาง AWS แนะนำให้ตั้ง visibility timeout อย่างน้อยหกเท่าของ function timeout (ในที่นี้คือ 6 × 60 s = 360 s) และ `maxReceiveCount` อย่างน้อย 5 สังเกตว่า dead-letter queue ตัวนี้เป็นของ SQS queue ส่วน dead-letter queue ของ Lambda เองมีไว้สำหรับ invocation แบบ asynchronous และ on-failure destination ของมันครอบคลุม invocation แบบ asynchronous กับ mapping ของ stream และ Kafka ทั้งสองอย่างเลยใช้กับ SQS event source mapping ไม่ได้

ทุกเส้นทางส่งแบบ **at least once** notification ของ S3 อาจมาถึงมากกว่าหนึ่งครั้ง SQS และ event source mapping อาจส่ง message ซ้ำ และแม้แต่ queue แบบ asynchronous ของ Lambda เองก็อาจส่ง event เดิมให้ function มากกว่าหนึ่งครั้ง handler เลยต้อง idempotent (ดู [idempotent consumer](../idempotent-consumer/)) ตัว `make-thumbnail` ถูกออกแบบให้ idempotent อยู่แล้ว: มันเขียน key เดิมเสมอคือ `thumbnails/u/…` สำหรับ upload เดียวกัน ส่วนตรงไหนที่ทำซ้ำแล้วเสียหาย อย่างการตัดเงินหรือการส่งอีเมล ก็ใช้ Idempotency utility ของ Powertools for AWS Lambda ได้ มันเก็บ key ของแต่ละ event ไว้ใน DynamoDB และคืนผลลัพธ์ที่บันทึกไว้เมื่อ event เดิมกลับมาภายในช่วงเวลาหนึ่ง (ค่าตั้งต้น 1 ชั่วโมง)

## อยู่ตรงไหนใน solution

- **Solution** serverless API (ข้างหน้าเป็น API Gateway หรือ function URL ส่วนข้างหลังเป็น DynamoDB), การ process ไฟล์ทันทีที่มันลงมาใน S3, consumer ของ queue และ stream, โค้ดกาวระหว่าง AWS service ที่ EventBridge rule หรือ SNS topic เป็นตัวเรียก function, งานตามตารางเวลาที่ EventBridge Scheduler เรียกแบบ asynchronous และแต่ละ step ใน workflow ของ [AWS Step Functions](../aws-step-functions/)
- **Pattern ใน catalog นี้** Lambda เป็นวิธีที่ใช้กันทั่วไปในการสร้าง function แบบ [serverless](../serverless/) และ consumer ของ [event-driven architecture](../event-driven-architecture/) ถ้ามี SQS อยู่ข้างหน้า มันก็ให้ [queue-based load leveling](../queue-based-load-leveling/) และ [competing consumers](../competing-consumers/) โดยไม่ต้องดูแล worker เอง ก็คือ [web-queue-worker](../web-queue-worker/) ที่ไม่มี fleet ของ worker แล้ว [dead-letter queue](../dead-letter-queue/) ของ queue กับ handler ที่ [idempotent](../idempotent-consumer/) ก็ทำให้มันครบ ส่วนถ้าอยู่หลัง [API gateway](../api-gateway/) มันก็ให้บริการ API แบบ request และ response
- **ของที่อยู่ข้าง ๆ บ่อย ๆ** API Gateway, [Amazon SQS](../amazon-sqs/), SNS, EventBridge, [Amazon S3](../amazon-s3/), [Amazon DynamoDB](../amazon-dynamodb/), AWS Step Functions, [CloudWatch](../amazon-cloudwatch/) และ X-Ray และ [IAM](../aws-iam/): แต่ละ function รันด้วย execution role ที่ถือสิทธิ์ของมัน
- **Managed offering** Lambda ก็คือ managed service อยู่แล้ว ตัวที่ใกล้เคียงที่สุดคือ Azure Functions และ Google Cloud Run functions

## ใช้ตอนไหนดี

ใช้ Lambda เมื่องานมาเป็น request หรือ event แยกกัน เสร็จในไม่กี่วินาทีหรือไม่กี่นาที และเก็บ state ไว้ที่อื่น: API ที่ traffic ไม่สม่ำเสมอ, ไฟล์ที่ process ทันทีที่มาถึง, consumer ของ queue และ stream, งานตามตารางเวลา และโค้ดกาวระหว่าง AWS service มันเป็นตัวเลือกตั้งต้นที่ดีเมื่อ traffic น้อย พุ่งเป็นช่วง ๆ หรือยังไม่รู้ เพราะเวลาว่างไม่เสียเงิน และไม่มี fleet ให้ต้องกำหนดขนาด

มองหาตัวอื่นสำหรับงานที่รันรวดเดียวนานเกิน 15 นาที (แบ่งเป็น step ใน Step Functions หรือใช้ durable functions ดูข้างล่าง), สำหรับโหลดหนักที่สม่ำเสมอที่ capacity แบบเปิดตลอดถูกกว่า (ดูเรื่องต้นทุนข้างล่าง), สำหรับเส้นทางที่ latency สำคัญมากจนรับ cold start ไม่ได้และไม่ยอมจ่ายค่า provisioned concurrency และสำหรับซอฟต์แวร์ที่ต้องใช้ connection ที่เปิดค้างนาน ๆ หรือ state ใน memory ขนาดใหญ่

| | AWS Lambda | [Amazon ECS](../amazon-ecs/) on Fargate | [Kubernetes](../kubernetes/) Deployment | Azure Functions (Flex Consumption) | Google Cloud Run functions |
|---|---|---|---|---|---|
| สิ่งที่ deploy | function (.zip หรือ container image) | task definition (container) | pod template บน cluster ที่เรารันเอง | function app | function ที่ build เป็น Cloud Run service |
| request ต่อ instance | 1 ต่อ environment (หลายตัวบน Managed Instances) | เท่าที่แอปรับไหว | เท่าที่แอปรับไหว | หลายตัว ตั้งแยกแต่ละ function | ได้ถึง 1,000 |
| request ที่นานที่สุด | 15 นาที | ไม่จำกัด: task รันจนกว่าจะถูกสั่งหยุด | ไม่จำกัด | ค่าตั้งต้น 30 นาที ไม่มีเพดานบังคับ (HTTP response ภายใน 230 s) | ได้ถึง 60 นาทีสำหรับ HTTP function |
| instance ที่ใหญ่ที่สุด | 10,240 MB, CPU ตามสัดส่วน | 32 vCPU, 244 GB | ขนาด node ของเรา | ขึ้นกับ instance memory ที่เลือก | 4 vCPU, 16 GiB |
| การ scale | ตาม request ลงไปได้ถึงศูนย์ | Service Auto Scaling ตาม CloudWatch metric | HorizontalPodAutoscaler ตาม metric บวก node scaling | ต่อ function ลงไปได้ถึงศูนย์ ขึ้นได้ถึง 1,000 instance | ตาม request ลงไปได้ถึงศูนย์ ตั้ง minimum instance ได้ |
| สิ่งที่จ่าย | request + GB-second เป็นขั้นละ 1 ms | vCPU และ memory ต่อวินาที ตั้งแต่ pull image จนหยุด (ขั้นต่ำ 1 นาทีบน Linux) | ค่า node ไม่ว่าจะยุ่งหรือว่าง | จำนวนครั้งที่รัน + memory ระหว่างรัน + always-ready instance ถ้ามี | ราคาของ Cloud Run |

## ได้อะไร เสียอะไร

- **cold start ไปโผล่ที่ tail** มันโดน request แรกหลังช่วงเงียบ, ทุก request ที่บังคับให้สร้าง environment ใหม่ระหว่าง burst และ request แรก ๆ หลัง deploy แต่ละครั้ง ตัว provisioned concurrency เลี่ยงได้เกือบหมด แลกกับเงินที่ต้องจ่ายตลอดที่ตั้งไว้ ส่วน SnapStart ทำให้มันสั้นลง
- **หนึ่ง request ต่อ environment** ทำให้ programming model เรียบง่าย (ไม่มี state ที่ request พร้อมกันใช้ร่วมกัน ไม่มี thread pool) แต่ function ที่เป็นงาน I/O ก็ต้องจ่ายค่า memory ระหว่างนั่งรอ network ในขณะที่ container ใช้ memory เท่ากันรับได้หลาย request ส่วน Lambda Managed Instances (ข้างล่าง) มีไว้สำหรับงานแบบนั้นที่ปริมาณสูงและสม่ำเสมอ
- **ข้อจำกัดตายตัว** (ตุลาคม 2026): 15 นาทีต่อ invocation, payload 6 MB ต่อทางสำหรับ call แบบ synchronous, 1 MB สำหรับแบบ asynchronous และ 200 MB สำหรับ response แบบ stream, package ที่แตก zip แล้วรวม layer ไม่เกิน 250 MB หรือ container image 10 GB, `/tmp` ได้ถึง 10,240 MB และ environment variable 4 KB
- **โหลดสม่ำเสมอแพงกว่า** ใน us-east-1 function ขนาด 1,769 MB (เอกสารบอกว่าเทียบเท่า 1 vCPU) ที่ยุ่งเต็มหนึ่งชั่วโมงเสียค่า duration ประมาณ $0.104 บน x86 ส่วน Fargate task ที่มี 1 vCPU และ 2 GB (Linux, x86) เสียประมาณ $0.049 ต่อชั่วโมง สำหรับงานที่หนัก CPU ตัว Lambda จะคุ้มกว่าก็ต่อเมื่อยุ่งไม่ถึงประมาณครึ่งหนึ่งของเวลา และ container ที่รับ request แบบ I/O หลายตัวพร้อมกันจะดันจุดนั้นออกไปอีก
- **การ scale อาจถล่มของที่อยู่ข้างหลัง** burst ที่เพิ่ม environment เป็นร้อย ๆ ตัวอาจใช้ connection ของ database หรือ rate limit ของ partner จนหมด ให้จำกัด function ด้วย reserved concurrency หรือ maximum concurrency ของ mapping และวาง connection pooler ไว้หน้า relational database
- **quota เดียวทั้ง account** ทุก function ใน Region ดึงจาก pool เดียวกัน function ที่คุมไม่อยู่ตัวเดียวเลยทำให้ตัวอื่นโดน throttle ได้ ส่วน reserved concurrency ช่วยล้อมรั้วตัวที่สำคัญไว้ ตัว recursive loop detection ของ Lambda หยุด loop ที่วิ่งผ่าน SQS, S3, SNS หรือ custom event bus ของ EventBridge หลังผ่านไปประมาณ 16 invocation แต่ไม่หยุด loop ที่วิ่งผ่าน service อื่น
- **retry ทุกชั้น** S3 ส่ง notification แบบ at least once, SQS ส่งซ้ำ และ mapping ก็ retry ทำให้ตัวซ้ำเป็นเรื่องปกติ และ message ที่พังซ้ำ ๆ ต้องใช้หลาย visibility timeout (ในที่นี้คือ 5 × 360 s) กว่าจะไปถึง dead-letter queue
- **lock-in อยู่รอบ ๆ โค้ด** handler เป็นโค้ดธรรมดา ส่วน trigger, รูปแบบ event, IAM role และ service ที่อยู่รอบ ๆ เป็นของ AWS โดยเฉพาะ

## ข้อควรรู้ตอนลงมือทำ

**ต่อ queue เข้ามา** event source mapping สร้างที่ฝั่ง Lambda ส่วน `ReportBatchItemFailures` เปิด partial batch response ตัว queue เองต้องตั้ง `VisibilityTimeout` 360 และ redrive policy ที่ `maxReceiveCount` 5 ชี้ไปที่ `thumbnail-jobs-dlq` ส่วน account ID และ alias เป็นแค่ตัวอย่าง:

```sh
aws lambda create-event-source-mapping \
  --function-name make-thumbnail \
  --event-source-arn arn:aws:sqs:us-east-1:111122223333:thumbnail-jobs \
  --batch-size 10 \
  --function-response-types ReportBatchItemFailures

aws lambda put-function-concurrency --function-name make-thumbnail \
  --reserved-concurrent-executions 100

aws lambda put-provisioned-concurrency-config --function-name get-photo \
  --qualifier live --provisioned-concurrent-executions 2
```

**เก็บ setup ที่แพงไว้ใน Init และรายงานความล้มเหลวทีละ message** S3 client ถูกสร้างครั้งเดียวต่อ environment ส่วน handler รายงานเฉพาะ message ที่พัง แล้ว object key ใน event ของ S3 ก็มาแบบ URL-encoded และ S3 จะส่ง message `s3:TestEvent` ที่ไม่มี `Records` ตอนตั้ง notification ครั้งแรก:

```python
import json
import urllib.parse

import boto3

s3 = boto3.client("s3")  # Init: runs once per execution environment, reused while warm


def make_thumbnail(bucket, key):
    ...  # download u/…, resize it, upload thumbnails/u/… (the same key every time)


def handler(event, context):  # Invoke: one batch of up to 10 SQS messages
    failures = []
    for record in event["Records"]:
        try:
            body = json.loads(record["body"])  # the S3 event notification
            for s3_event in body.get("Records", []):  # s3:TestEvent has no Records
                bucket = s3_event["s3"]["bucket"]["name"]
                key = urllib.parse.unquote_plus(s3_event["s3"]["object"]["key"])
                make_thumbnail(bucket, key)
        except Exception:
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}  # needs ReportBatchItemFailures on the mapping
```

- **memory ก็คือ setting ของ CPU ด้วย** Lambda ให้ CPU ตามสัดส่วนของ memory และ 1,769 MB เทียบเท่า 1 vCPU ตัว `make-thumbnail` ที่ 1,024 MB เลยได้มากกว่าครึ่งของ vCPU นิดหน่อย งานที่หนัก CPU อย่างการ resize รูปมักรันเร็วขึ้นเมื่อให้ memory มากขึ้น และต้นทุนต่อรูปก็อาจออกมาพอ ๆ เดิม ให้วัดก่อนตัดสินใจเลือกขนาด
- **Arm ถูกกว่าต่อ GB-second** function บน architecture `arm64` (AWS Graviton2) ราคา $0.0000133334 ต่อ GB-second ใน us-east-1 เทียบกับ $0.0000166667 บน `x86_64` ถูกกว่า 20% ส่วน native dependency ต้อง build สำหรับ arm64
- **คำนวณบิลดู** Lambda คิด $0.20 ต่อล้าน request บวก duration × memory (us-east-1, pricing tier แรก, ตุลาคม 2026) ถ้าทำ thumbnail ล้านรูปที่ 0.8 s และ 1 GB ก็คือ 800,000 GB-second คิดเป็นประมาณ $13.33 บน x86 หรือ $10.67 บน Arm บวกค่า request $0.02 ถึง $0.20 แล้วแต่ว่า batch เต็มแค่ไหน ตัวเลขนี้ยังไม่หัก free tier รายเดือน (1 ล้าน request และ 400,000 GB-second) และยังไม่รวมค่า SQS กับ S3
- **Networking** ค่าตั้งต้นคือ function เข้าถึง internet และ public AWS endpoint ได้ แต่เข้าถึง resource ส่วนตัวใน VPC ของเราไม่ได้ ถ้าผูกกับ private subnet มันจะเข้าถึงพวกนั้นผ่าน Hyperplane network interface ที่ Lambda สร้างตอนเราตั้งค่า function หนึ่งตัวต่อหนึ่งคู่ของ subnet กับ security group และทุก environment ใช้ร่วมกัน พอผูกแล้ว มันจะออก internet ได้ก็ต่อเมื่อ VPC มี route ออกไป ปกติคือ NAT gateway
- **Layer, extension และ container image** function หนึ่งใช้ layer ได้ถึง 5 ตัว (.zip archive ของ library หรือข้อมูล ใช้ได้แค่กับ function แบบ .zip) ส่วน extension รันใน environment ข้าง ๆ function ใช้กับ monitoring agent หรือ cache ของ secret และมันเพิ่มเวลา Init กับ shutdown ส่วน container image ใหญ่ได้ถึง 10 GB
- **Response streaming** ผ่าน function URL, API `InvokeWithResponseStream` หรือ proxy integration ของ API Gateway ตัว function stream response ได้ถึง 200 MB: 6 MB แรกเต็มความเร็ว ที่เหลือได้ถึง 2 MB/s ส่วน managed Node.js runtime รองรับตรง ๆ และภาษาอื่นต้องใช้ custom runtime หรือ Lambda Web Adapter
- **Observe มัน** ทุก invocation เขียนบรรทัด `REPORT` ลง CloudWatch Logs พร้อม `Duration`, `Billed Duration` และ `Max Memory Used` และมี `Init Duration` เพิ่มหลัง cold start ให้ตั้ง alarm ที่ metric `Errors`, `Throttles` และ `ConcurrentExecutions` และที่ message ใน dead-letter queue แล้วเปิด X-Ray tracing เพื่อตาม request ข้าม service
- **ตัวเลือกใหม่ ๆ** (ตามที่เอกสารอธิบายไว้เมื่อตุลาคม 2026): **Lambda Managed Instances** (พฤศจิกายน 2025) รัน function บน EC2 instance ใน account ของเรา รับได้หลาย invocation ต่อ environment คิดราคา EC2 บวกค่า management 15% และรันได้ถึง 90 นาทีสำหรับ invocation แบบ asynchronous และแบบ poll ส่วนใหญ่ ส่วน **Lambda durable functions** (ธันวาคม 2025) checkpoint ความคืบหน้าไว้ใน function ทำให้ workflow หนึ่งรันได้นานถึงหนึ่งปี และการรอไม่เสียค่า compute ส่วน **Lambda MicroVMs** เป็น primitive อีกตัวที่แยกกัน: environment ที่แยกขาดสำหรับ user หรือ job ทีละหนึ่ง อยู่ได้นานถึง 8 ชั่วโมง ส่วน **Tenant isolation mode** ให้ request ของแต่ละ tenant ไปอยู่บน environment ที่ใช้เฉพาะ tenant นั้น
