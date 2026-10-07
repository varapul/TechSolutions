## ปัญหา

Acme Shop รันอยู่บน AWS ตัว Application Load Balancer ส่ง request ของคนซื้อไปที่ Catalog service ที่เป็นสาม task บน [Amazon ECS](../amazon-ecs/) กับ Fargate ส่วน function ของ [AWS Lambda](../aws-lambda/) อย่าง `make-thumbnail` ก็ทำงานอยู่เบื้องหลัง พอหน้าสินค้าเริ่มช้าตอน 10:45 ทีมก็ต้องได้คำตอบเร็ว ๆ: ทุก request ช้าหรือแค่ไม่กี่ตัวที่ช้าที่สุด ช้ามาตั้งแต่เมื่อไร service คืน error ด้วยหรือเปล่า และควรปลุกใคร ไม่มี server ให้ login เข้าไปดู ตัว Fargate task และ Lambda execution environment มาแล้วก็ไป และ disk ในเครื่องก็หายไปพร้อมกับมัน เพราะฉะนั้นตัวเลข (จำนวน request, latency, CPU) และบรรทัด log ต้องออกจากแต่ละ component ทันทีที่เกิดขึ้น แล้วไปลงที่ที่เก็บมันไว้ ตอบคำถามเกี่ยวกับมันได้ และลงมือทำอะไรสักอย่างเมื่อมันข้ามเส้นที่ตั้งไว้

Amazon CloudWatch คือ monitoring service ของ AWS สำหรับงานนี้ AWS service แทบทุกตัวส่ง metric ของตัวเองไปที่นั่นอยู่แล้วโดยไม่ต้องตั้งค่าอะไร แอปก็เพิ่ม metric และ log ของตัวเองเข้าไป ส่วน alarm เปลี่ยน threshold ให้เป็นการแจ้งเตือนและการ scale แล้ว dashboard กับ query ก็ให้คนเข้ามาดูได้ งานจริงอยู่ที่การใช้มันให้ดี: เลือก statistic และ setting ของ alarm ที่จับปัญหาจริงได้โดยไม่ page เพราะ noise และคอยดูค่าใช้จ่ายของ custom metric กับ log

## ทำงานยังไง

### Metric

**metric** คือ time series ที่ระบุด้วย **namespace** (`AWS/ApplicationELB`, `AWS/Lambda`, `AWS/ECS` หรือของเราเอง อย่าง `AcmeShop`), **name** (`TargetResponseTime`) และ **dimension** ได้ถึง 30 ตัว ที่เป็นคู่ name/value อย่าง `LoadBalancer=app/acme-shop/50dc6c495c0c9188` ชุดค่า dimension ที่ไม่ซ้ำกันแต่ละชุดคือ metric แยกกัน และเราอ่านกลับได้แค่ชุดที่ถูก publish ไว้ แล้ว metric ก็มีอยู่แค่ใน Region ที่มันถูกส่งไป มันลบไม่ได้ แต่จะหมดอายุไปเองเมื่อไม่ได้รับข้อมูลเลย 15 เดือน

- **AWS service publish เอง** ALB รายงานทุก 60 วินาทีระหว่างที่มี request วิ่งผ่าน และไม่รายงานอะไรเลยถ้าไม่มี traffic ตัว `TargetResponseTime` ของมันคือเวลาเป็นวินาที นับจากตอนที่ request ออกจาก load balancer จนถึงตอนที่ target เริ่มส่ง response header ส่วน `HTTPCode_Target_5XX_Count` นับ 5xx response ที่ target คืนมา (ไม่นับตัวที่ load balancer สร้างเอง) ด้าน Lambda ก็ publish `Invocations`, `Errors`, `Throttles` และ `Duration` ของแต่ละ function ส่วน ECS publish `CPUUtilization` และ `MemoryUtilization` ของแต่ละ cluster และ service นาทีละครั้ง EC2 ส่ง basic monitoring ทุก 5 นาทีแบบไม่เสียเงิน และส่ง detailed monitoring ทุกนาทีในราคาของ custom metric
- **Statistic** สรุป data point ของ period หนึ่ง: `SampleCount`, `Sum`, `Average`, `Minimum`, `Maximum`, percentile อย่าง `p99` รวมถึง trimmed mean และ winsorized mean, trimmed count และ trimmed sum, percentile rank และ interquartile mean เวลาดู latency นั้น ค่าเฉลี่ยจะซ่อนหางที่ช้าไว้ ส่วน `p99` แสดงว่า request ที่ช้าที่สุด 1% ต้องรอนานแค่ไหน percentile ต้องใช้ค่าดิบ เพราะฉะนั้น custom metric ที่ส่งมาเป็น statistic set ที่ aggregate ไว้แล้วอย่างเดียวจะไม่มี percentile (มีข้อยกเว้นแคบ ๆ อยู่ข้อหนึ่ง) และ metric ที่มีค่าติดลบก็ไม่มี percentile เลย
- **Period และ resolution** period คือ 1, 5, 10 หรือ 30 วินาที หรือผลคูณของ 60 และค่าตั้งต้นคือ 60 ส่วน AWS service publish ที่ standard resolution ละเอียดระดับหนึ่งนาที แต่ metric ของเราเองเป็นแบบ high-resolution ได้ด้วย คือเก็บเป็นรายวินาที และอ่านด้วย period ที่สั้นกว่าหนึ่งนาที
- **Retention และ roll-up** data point ที่ period ต่ำกว่าหนึ่งนาทีเก็บไว้ 3 ชั่วโมง ข้อมูลรายนาทีเก็บ 15 วัน ข้อมูลรายห้านาทีเก็บ 63 วัน และข้อมูลรายชั่วโมงเก็บ 455 วัน (15 เดือน) ข้อมูลที่เก่ากว่านั้นถูก roll up แทนที่จะถูกทิ้ง: ข้อมูลรายนาทียังอยู่หลัง 15 วันแต่ที่ resolution ห้านาที และหลัง 63 วันก็อยู่ที่ resolution หนึ่งชั่วโมง

### Custom metric: PutMetricData และ embedded metric format

แอป publish metric ของตัวเองได้สองวิธี

- **`PutMetricData`** ส่ง data point ตรง ๆ: ได้ถึง 1,000 metric ที่ต่างกันและ 1 MB ต่อ request (ใช้ gzip ได้) และได้ถึง 150 ค่าต่อ metric ใน request เดียวถ้าส่ง `Values` คู่กับ `Counts` แบบนี้ยังใช้ percentile ได้อยู่ time stamp ย้อนหลังได้ถึงสองสัปดาห์และล่วงหน้าได้ถึงสองชั่วโมง ส่วน `StorageResolution` 1 ทำให้ metric เป็นแบบ high-resolution
- **embedded metric format (EMF)** ใส่ metric ไว้ในบรรทัด log แบบ structured ตัว JSON event มี object `_aws` ที่มี `Timestamp` เป็น millisecond และ list `CloudWatchMetrics` โดยแต่ละ entry ระบุ `Namespace`, `Dimensions` (ชุดของ key ไม่เกิน 30 key ต่อชุด) และ `Metrics` (ชื่อ พร้อม `Unit` และ `StorageResolution` ที่ใส่หรือไม่ใส่ก็ได้) ส่วนค่าของ metric เองเป็น member ธรรมดาที่ระดับบนสุดของบรรทัด เมื่อบรรทัดนี้มาถึง CloudWatch Logs ตัว CloudWatch จะดึง metric ออกมาแบบ asynchronous และเก็บบรรทัดนั้นไว้ด้วย ทำให้ event เดียวกันเอาไปทำ graph ตั้ง alarm และ search ได้ บรรทัดของ Catalog ใน diagram ประกาศ `OrderLatency` ใน `AcmeShop` พร้อม dimension `Service` แล้ว member ของมันคือ `"Service": "catalog"` และ `"OrderLatency": 182` ก็กลายเป็น data point หนึ่งตัวของ metric `AcmeShop` › `OrderLatency` › `Service=catalog`
- EMF เหมาะกับ Lambda function และ container ตัวโค้ดแค่เขียนลง stdout: Lambda ส่ง stdout ไปที่ CloudWatch Logs ส่วนบน ECS ก็เป็นหน้าที่ของ log driver `awslogs` เพราะฉะนั้น function หรือ task ต้องมี `logs:PutLogEvents` ไม่ใช่ `cloudwatch:PutMetricData` ทาง AWS ก็ publish client library แบบ open-source สำหรับ Node.js, Python, Java และ C# ไว้ด้วย ส่วน log event หนึ่งตัวนิยาม metric ได้ไม่เกิน 100 ตัว การดึงค่าส่งแต่ละค่าอย่างน้อยหนึ่งครั้ง (บางทีอาจมีค่าซ้ำโผล่มา) และเราจ่ายทั้งค่า ingest log และค่า custom metric ทุกตัวที่บรรทัด log สร้างขึ้น ค่า dimension ที่ต่างกันแต่ละค่าจะสร้าง metric ใหม่ เพราะฉะนั้น request ID หรือ user ID ควรอยู่ใน member ธรรมดาของบรรทัด ที่ Logs Insights ยังหาเจอได้ และห้ามอยู่ใน `Dimensions`

### การ query metric

- **Metric math** รวม metric ใน graph หรือ alarm: `100 * m1 / m2` เปลี่ยน `Errors` และ `Invocations` ของ Lambda ให้เป็น error rate ส่วน function อย่าง `FILL`, `RATE`, `IF`, `METRICS()` และ `ANOMALY_DETECTION_BAND` ใช้เติมช่องว่าง และคำนวณ rate, เงื่อนไข และช่วงค่าที่คาดไว้ ส่วน alarm ที่อิงกับ expression จะโดนคิดเงินตามทุก metric ที่อยู่ในนั้น
- **Metrics Insights** คือภาษา SQL แบบหนึ่งสำหรับ metric ที่มีข้อมูลได้ถึงสองสัปดาห์ `SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/ECS", ClusterName, ServiceName) GROUP BY ServiceName ORDER BY AVG() DESC LIMIT 10` หา service ที่ยุ่งที่สุดสิบตัวได้ใน query เดียว และ alarm ที่อิงกับ query แบบนี้ก็ตามทั้ง fleet ได้แม้ service จะเพิ่มหรือหายไป ส่วน query ใน query editor ของ console ไม่เสียเงิน
- **PromQL สำหรับ OpenTelemetry metric** ตอนนี้เอกสารเรียกทุกอย่างข้างบนว่า metric แบบ *classic* ส่วน *OpenTelemetry metric* เข้ามาทาง OTLP endpoint `https://monitoring.<region>.amazonaws.com/v1/metrics` เก็บชื่อ metric แบบ open-source ไว้ตามเดิม มี label ได้ถึง 150 ตัวต่อ data point และ query ด้วย PromQL ใน Query Studio (generally available ตั้งแต่มิถุนายน 2026) หรือผ่าน API ที่เข้ากันได้กับ Prometheus ตัว metric ของ AWS service ก็ copy เข้าเส้นทางนี้ได้ โดยมี resource tag ของมันเป็น label และเอกสารเรียกการทำแบบนี้ว่า OTel enrichment

### Alarm

**metric alarm** เฝ้าดู metric ตัวเดียวหรือ math expression ตัวเดียว และอยู่ในหนึ่งในสาม state เสมอ: `OK`, `ALARM` หรือ `INSUFFICIENT_DATA` มีสาม setting ที่กำหนดว่ามันจะเปลี่ยน state เมื่อไร:

- **Period** คือความยาวของแต่ละ data point: 60 วินาทีสำหรับ `latency`
- **EvaluationPeriods** (N) คือจำนวน data point ล่าสุดที่จะดู: 5
- **DatapointsToAlarm** (M) คือจำนวนในนั้นที่ต้องเกิน threshold: 3 และไม่ต้องติดกัน กฎ *M out of N* นี้ทำให้ `latency` ไม่สนนาทีที่ช้าแค่นาทีเดียว แต่ยัง fire เมื่อ 1.12, 1.31 และ 1.40 s ตกอยู่ในห้านาทีเดียวกัน

alarm ที่ period ตั้งแต่หนึ่งนาทีขึ้นไปจะถูก evaluate ทุกนาทีบน sliding window ที่จะเปลี่ยนไปให้ตรงกับเวลานาฬิกาใน time zone ที่เลือกก็ได้ ส่วน alarm แบบ high-resolution ที่ period 10, 20 หรือ 30 วินาทีจะถูก evaluate ทุก 10 วินาทีและแพงกว่า ส่วน setting และประเภทอื่น ๆ มีดังนี้:

- **`TreatMissingData`** บอกว่า data point ที่หายไปมีความหมายยังไง: `missing` (ค่าตั้งต้น: เมื่อทุก point ใน window หายหมด alarm จะไปที่ `INSUFFICIENT_DATA`), `notBreaching`, `breaching` หรือ `ignore` (คง state ปัจจุบันไว้) ตัว ALB ไม่รายงานอะไรเลยในนาทีที่ไม่มี traffic เพราะฉะนั้น ALB alarm ทั้งสองตัวของ Acme Shop เลยถือว่าข้อมูลที่หายไปเป็น `notBreaching`
- **`EvaluateLowSampleCountPercentile`** กำหนดว่า percentile alarm จะตัดสิน period ที่มี sample น้อยเกินกว่าจะมีความหมายทางสถิติ (`evaluate` คือค่าตั้งต้น) หรือจะคง state เดิมไว้ (`ignore`)
- **Anomaly detection** เอา band ของค่าที่คาดไว้มาแทน threshold ตายตัว CloudWatch train model สำหรับ metric และ statistic หนึ่งชุดจากประวัติได้ถึงสองสัปดาห์ โดยตาม trend และ pattern รายชั่วโมง รายวัน และรายสัปดาห์ เราเลือกความกว้างของ band เอง (เลข `2` ใน `ANOMALY_DETECTION_BAND(m1, 2)`) แล้ว alarm ก็ fire เมื่อค่าอยู่เหนือ band ใต้ band หรือนอก band ด้านไหนก็ได้ alarm แบบนี้คิดเงินเป็นสาม metric: ตัว metric เองและขอบสองข้างของ band
- **Composite alarm** รวม state ของ alarm อื่นด้วย `AND`, `OR` และ `NOT` กับ function `ALARM()`, `OK()` และ `INSUFFICIENT_DATA()` และตั้งแต่พฤศจิกายน 2025 ก็มี `AT_LEAST` สำหรับกฎอย่าง volume สองในสี่ตัวที่พื้นที่ใกล้หมด ตัว `impact` คือ `ALARM("latency") AND ALARM("errors")` ทำให้หน้าเว็บที่ช้าแต่ไม่มี error หรือ error ไม่กี่ตัวที่ความเร็วปกติ จะไม่ page ใครเลย rule หนึ่งอ้างถึง alarm ได้ถึง 100 ตัว และ *actions suppressor* จะกัก action ของ composite alarm ไว้ระหว่างที่ alarm อีกตัว เช่นตัวที่บอกว่ากำลัง deploy อยู่ อยู่ใน `ALARM`
- **Query alarm**: alarm ที่อิงกับ Metrics Insights query ครอบคลุมได้ทั้ง fleet และตามแต่ละ time series ที่ match ได้แยกกัน ส่วน PromQL alarm ทำแบบเดียวกันกับ OpenTelemetry metric และ log alarm ก็รัน Logs Insights query ตาม schedule แล้วใช้กฎ M out of N กับผลลัพธ์

**Action** จะรันตอนที่ alarm เปลี่ยน state ไม่ใช่ระหว่างที่มันค้างอยู่ใน state นั้น: แจ้ง Amazon SNS topic, invoke Lambda function, stop, terminate, reboot หรือ recover EC2 instance, รัน Auto Scaling policy, สร้าง OpsItem ของ Systems Manager หรือ incident ของ Incident Manager หรือเริ่ม CloudWatch investigation ส่วน action ของ Auto Scaling เป็นข้อยกเว้น เพราะมันทำซ้ำทุกนาทีระหว่างที่ alarm ยังอยู่ใน state นั้น composite alarm แจ้งเตือน invoke Lambda และเปิด OpsItem, incident และ investigation ได้ แต่ทำ action ของ EC2 หรือ Auto Scaling ไม่ได้ ทุกการเปลี่ยน state ยังเป็น event บน [Amazon EventBridge](../amazon-eventbridge/) ด้วย และ CloudWatch เก็บ alarm history ไว้ 30 วัน ใน diagram ตัว CPU alarm เป็นของ policy **target tracking** ของ ECS service: Application Auto Scaling สร้างและดูแล alarm สองตัวให้มัน คือตัวสูงและตัวต่ำ (ตัวสูงชื่อ `TargetTracking-service/acme-shop/catalog-AlarmHigh-…` ส่วนใน diagram คือ `cpu-high`) แล้วเมื่อ CPU อยู่ที่ 85% เทียบกับ target 60% มันก็เพิ่ม desired count จาก 3 เป็น 5 (3 × 85 ÷ 60 = 4.25 แล้วปัดขึ้น ดู [autoscaling](../autoscaling/))

### Log

- **Log group, stream และ event** log event คือ time stamp กับ message ขนาดไม่เกิน 1 MB ส่วน log stream เก็บ event ของแหล่งเดียว: container หนึ่งตัวของ ECS task ที่ชื่อ `catalog/catalog/<task ID>` โดยมี stream prefix ของ `awslogs` เป็น `catalog` หรือ Lambda execution environment หนึ่งตัว ที่ตั้งชื่อตามวันที่, version ของ function และ ID ส่วน log group เก็บ stream ที่ใช้ retention, permission และ setting ร่วมกัน: `/ecs/catalog` และ `/aws/lambda/make-thumbnail` ที่เป็น group ที่ Lambda ใช้โดยค่าตั้งต้น
- **Retention** log group เก็บ event ไว้ตลอดไป ถ้าเราไม่ตั้ง retention เป็น 1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1,096, 1,827, 2,192, 2,557, 2,922, 3,288 หรือ 3,653 วัน event ที่หมดอายุแล้วอาจใช้เวลาถึง 72 ชั่วโมงกว่าจะหายไป
- **Log class** คลาส *Standard* มีครบทุกฟีเจอร์ ส่วน *Infrequent Access* ค่า ingest ถูกลงครึ่งหนึ่ง แต่ไม่มี metric filter, subscription filter, การดึง EMF, Live Tail และฟีเจอร์อื่นอีกไม่กี่ตัว และ event ของมันอ่านได้ผ่าน Logs Insights เท่านั้น เหมาะกับ log ที่เก็บไว้สำหรับ audit และการสืบสวนทีหลัง class ของ group ถูกกำหนดตอนสร้างแล้วเปลี่ยนไม่ได้ ส่วนคลาส *Delivery* แค่ส่ง Lambda log ต่อไปที่ Amazon S3 หรือ Amazon Data Firehose และเก็บไว้สองวัน แยกจากนี้ยังมี **Intelligent Tiering** ที่เปิดต่อ account และ Region มันย้ายข้อมูลที่เก็บไว้และไม่ได้ถูกอ่านมา 30 วันไปที่ storage tier แบบ Infrequent Access และหลัง 90 วันก็ไปที่ Archive Instant Access ด้วยราคา storage ที่ถูกลง และ query ได้เหมือนเดิม
- **Metric filter** เปลี่ยนบรรทัด log ที่ match ให้เป็น metric โดยตั้ง filter ได้ถึง 100 ตัวต่อ log group สำหรับ log ที่เปลี่ยนไปใช้ EMF ไม่ได้
- **Subscription filter** stream event ที่ match ทันทีที่มันมาถึง ไปที่ [Kinesis Data Streams](../amazon-kinesis-data-streams/), Amazon Data Firehose, Lambda function หรือ Amazon OpenSearch Service โดยตั้ง filter ได้ถึงห้าตัวต่อ log group: นี่คือทางป้อนข้อมูลปกติของ pipeline แบบ [centralized logging](../centralized-logging/) หรือ pipeline ด้าน security และ log ยัง export ไปที่ S3 ได้ด้วย
- **Logs Insights** query log group ด้วยภาษา pipe ของมันเอง, OpenSearch PPL หรือ OpenSearch SQL มันหา field ของบรรทัด JSON ได้เอง และใช้ field index เพื่อข้าม event ที่ไม่มี field ที่ทำ index ไว้ได้ ส่วน account หนึ่งรัน Logs Insights QL query ได้พร้อมกันถึง 100 ตัว แต่ละ query จะหยุดหลัง 60 นาที ผลลัพธ์เก็บไว้ 7 วัน และเราจ่ายเงินต่อ GB ที่ scan
- **Live Tail** stream event ใหม่จาก log group ได้ถึง 10 ตัวทันทีที่มันมาถึง พร้อม filter และ highlight ไว้ดูตอน deploy หรือตอนเกิด incident มันใช้ได้กับ Standard log group เท่านั้น และคิดเงินเป็นนาที

### Trace และ application monitoring

- **AWS X-Ray** เก็บ trace คือเส้นทางของ request หนึ่งตัวผ่าน service ที่มันแตะ พร้อมเวลาที่ใช้ในแต่ละ call แล้ววาดออกมาเป็น trace map (ดู [distributed tracing](../distributed-tracing/)) ตัว X-Ray SDK และ daemon เข้าสู่ maintenance mode ตั้งแต่ 25 กุมภาพันธ์ 2026 โดยออก release แค่สำหรับแก้ security แล้ว AWS ก็แนะนำให้ instrument ด้วย OpenTelemetry แทน ผ่าน AWS Distro for OpenTelemetry (ADOT) หรือส่ง span ไปที่ OTLP endpoint สำหรับ trace ของ CloudWatch
- **Transaction Search** เก็บทุก span เป็น structured log event ใน log group `aws/spans` ทำให้ search และวิเคราะห์ได้ทุก span ไม่ใช่แค่ sample
- **Application Signals** instrument service ที่เขียนด้วย Java, Python, Node.js และ .NET บน EKS, ECS, EC2 และ Lambda แสดงปริมาณ call, availability, latency, fault และ error ของแต่ละ service พร้อม map ของ dependency และตาม service level objective ด้วย burn-rate alarm (ดู [SLO และ error budget](../slo-error-budgets/))

### Synthetics, RUM, Container Insights และ Lambda Insights

- **Synthetics canary** คือ script ที่เขียนด้วย Node.js, Python หรือ Java ที่รันตาม schedule เป็น Lambda function แล้วเรียก API หรือขับ headless browser (Playwright, Puppeteer หรือ Selenium) แล้วบันทึกว่ามันทำงานได้หรือเปล่า: เป็น [health endpoint monitoring](../health-endpoint-monitoring/) จากข้างนอกเข้ามา
- **RUM** (real user monitoring) เก็บเวลาโหลดหน้า, error ฝั่ง client และพฤติกรรมผู้ใช้จาก browser session จริง และเก็บเวลาโหลดหน้าจอ, การเปิดแอป, crash และ network error จาก mobile app
- **Container Insights** เก็บ metric ของ CPU, memory, disk และ network รวมถึงข้อมูลวินิจฉัยอย่างการ restart ของ container สำหรับ ECS, EKS, Red Hat OpenShift on AWS และ [Kubernetes](../kubernetes/) บน EC2 รวมถึง Fargate ด้วย มันเขียน performance event เป็น EMF แล้ว metric ก็ถูกดึงออกมาจาก event พวกนั้น
- **Lambda Insights** เพิ่ม CloudWatch extension ที่มาเป็น Lambda layer คอยรายงาน CPU time, การใช้ memory, disk และ network รวมถึงข้อมูลวินิจฉัยอย่าง cold start ของทุก invocation เป็น EMF เหมือนกัน

### Dashboard, account และ Region

- **Dashboard** คือหน้าที่มี widget (graph, ตัวเลขเดี่ยว, state ของ alarm, ผลของ Logs Insights, ข้อความ) ที่ผสมข้อมูลจากหลาย Region ได้ และถ้ามี cross-account observability ก็ผสมจากหลาย account ได้ด้วย ส่วน CloudWatch เองก็สร้าง **automatic dashboard** ให้แต่ละ service แบบไม่เสียเงิน
- **Cross-account observability** เชื่อม source account เข้ากับ monitoring account ใน Region เดียวกัน โดยมี sink ใน monitoring account และ link ในแต่ละ source account ที่ Observability Access Manager ดูแล จากนั้น monitoring account ก็ค้น metric, log group, trace และข้อมูล Application Signals ของทุก account ที่เชื่อมไว้ได้โดยไม่ต้อง copy ส่วน **centralization** ของ log และ metric จะ copy ข้อมูลเข้า account เดียวจริง ๆ ข้าม account และข้าม Region
- **Metric stream** ส่ง metric ออกไปอย่างต่อเนื่องผ่าน Amazon Data Firehose ไปที่ S3 หรือเครื่องมือของ third party เป็น JSON หรือ format ของ OpenTelemetry

### Pricing

ราคาใน us-east-1 จาก AWS Price List ตุลาคม 2026 ส่วน Region อื่นราคาต่างไป

| รายการ | ราคา |
|---|---|
| Custom metric (classic) ต่อเดือน | ตัวละ $0.30 สำหรับ 10,000 ตัวแรก $0.10 สำหรับ 240,000 ตัวถัดไป $0.05 สำหรับ 750,000 ตัวถัดไป และ $0.02 เมื่อเกิน 1,000,000 ตัว คิดตามสัดส่วนเป็นรายชั่วโมง |
| API request | $0.01 ต่อ 1,000 ส่วน `GetMetricData`: $0.01 ต่อ 1,000 metric ที่ขอ |
| OpenTelemetry metric | $0.50 ต่อ GB ที่ ingest รวม storage 15 เดือนแล้ว ส่วน PromQL ผ่าน API $0.01 ต่อล้าน sample ที่ scan และฟรีใน console |
| Alarm ต่อเดือน | $0.10 ต่อ metric ที่ standard resolution, $0.30 ที่ high resolution และ composite $0.50 |
| Dashboard ต่อเดือน | $3 |
| Log ที่ ingest | $0.50 ต่อ GB (คลาส Standard), $0.25 ต่อ GB (Infrequent Access) ส่วน log ที่ AWS service ส่งมาให้ (vended log) คิดเป็นขั้น ตั้งแต่ $0.50 ต่อ GB ลงไปถึง $0.05 |
| Log ที่เก็บ | $0.03 ต่อ GB-month แบบบีบอัดแล้ว ส่วนถ้าใช้ Intelligent Tiering คือ $0.018 ใน tier Infrequent Access และ $0.006 ใน Archive Instant Access |
| Logs Insights | $0.005 ต่อ GB ที่ scan |
| Live Tail | $0.01 ต่อนาที |

free tier ครอบคลุม basic monitoring metric ของ AWS service, custom metric หรือ detailed-monitoring metric 10 ตัว, API request 1 ล้านครั้ง (ไม่รวม `GetMetricData`), dashboard 3 ตัวที่มีได้ถึง 50 metric, alarm metric 10 ตัว, log data 5 GB และ Live Tail 1,800 นาทีต่อเดือน ใน diagram ตัว `OrderLatency` ที่มีแค่ `Service` คือ metric หนึ่งตัว ราคา $0.30 ต่อเดือน แต่ถ้าเพิ่ม `userId` ของผู้ใช้ 50,000 คนเข้าไป มันจะกลายเป็น metric ได้ถึง 50,000 ตัว คือ 10,000 × $0.30 + 40,000 × $0.10 = $7,000 ต่อเดือน ถ้า series ของผู้ใช้ทุกคนได้ข้อมูลทุกชั่วโมง เพราะ metric คิดเงินตามชั่วโมงที่มันได้รับข้อมูล

## อยู่ตรงไหนใน solution

- **Solution** workload บน AWS แทบทุกตัวใช้มันในทางใดทางหนึ่ง: web application และ API ที่อยู่หลัง load balancer, container บน ECS และ EKS, serverless application บน Lambda, data pipeline และ batch job มันรับ log ของ AWS service หลายตัว (VPC Flow Logs ก็ใช่) และ alarm ของมันก็คือสิ่งที่ scale fleet และ page หาคน
- **Pattern ใน catalog นี้** alarm บน metric ของ load balancer และ canary คือการ implement [health endpoint monitoring](../health-endpoint-monitoring/), SLO ของ Application Signals ที่มี burn-rate alarm คือการ implement [SLO และ error budget](../slo-error-budgets/), log group ที่มี subscription filter ป้อนข้อมูลให้ [centralized logging](../centralized-logging/), X-Ray และ Transaction Search ให้ [distributed tracing](../distributed-tracing/), CloudWatch agent, OTLP endpoint และ CloudWatch pipelines ทำให้มันเป็นปลายทางของ [telemetry pipeline](../telemetry-pipeline/) และ alarm ของมันขับเคลื่อน [autoscaling](../autoscaling/) รวมถึง target tracking ของ service บน [Amazon ECS](../amazon-ecs/)
- **เพื่อนบ้านที่มักเจอ** [Amazon SNS](../amazon-sns/) สำหรับการแจ้งเตือน (และผ่านมันไปถึงอีเมล SMS และ HTTPS endpoint ของเครื่องมือจัดการ incident), [AWS Lambda](../aws-lambda/) สำหรับการตอบสนองแบบอัตโนมัติ, Amazon EventBridge สำหรับการเปลี่ยน state ของ alarm, Application Auto Scaling และ EC2 Auto Scaling, Kinesis Data Streams, Data Firehose และ [OpenSearch](../elasticsearch/) สำหรับ log pipeline, [Amazon S3](../amazon-s3/) สำหรับ archive, Systems Manager สำหรับ OpsItem และ incident และ Amazon Managed Grafana สำหรับ dashboard ที่ดึงจาก CloudWatch และแหล่งอื่น
- **Managed offering** CloudWatch เองก็คือ managed service อยู่แล้ว มีในทุก Region และไม่ต้องรันอะไรเอง ทีมที่ชอบ stack แบบ open-source บน AWS ใช้ Amazon Managed Service for Prometheus คู่กับ Amazon Managed Grafana (ดู [Prometheus](../prometheus/)) ส่วน Azure Monitor และ Cloud Monitoring กับ Cloud Logging ของ Google Cloud ก็ทำหน้าที่เดียวกันบน cloud อื่น

## ใช้ตอนไหนดี

ใช้ CloudWatch กับอะไรก็ตามที่รันบน AWS: metric ของ service มีอยู่แล้ว Auto Scaling ทำงานตาม alarm ของมัน และ EMF, driver `awslogs` กับ CloudWatch agent ก็เพิ่ม metric และ log ของเราเองได้ด้วยโค้ดนิดเดียว ให้เอา Prometheus กับ Grafana หรือ SaaS อย่าง Datadog เข้ามา เมื่ออยากได้ PromQL บน metric ที่ติด label จากหลายทีมไว้ในที่เดียว อยากได้เครื่องมือเดียวที่ใช้ข้ามหลาย cloud และ data centre หรืออยากได้ฟีเจอร์ที่ CloudWatch ไม่มี หลายทีมใช้ร่วมกัน: metric ของ AWS อยู่ใน CloudWatch ต่อไป แล้ว Grafana หรือ SaaS ก็อ่านมันผ่าน API หรือ metric stream

| | Amazon CloudWatch | Prometheus กับ Grafana | Datadog |
|---|---|---|---|
| คืออะไร | monitoring service ของ AWS: metric, log, alarm, dashboard, trace | metrics server และ alert router แบบ open-source ใช้ Grafana ทำ dashboard | SaaS เชิงพาณิชย์สำหรับ metric, log, trace และอื่น ๆ |
| metric ของ AWS service | publish ให้อัตโนมัติ ไม่ต้องตั้งค่า | ผ่าน exporter หรือ CloudWatch data source ของ Grafana | ผ่าน AWS integration ของมัน |
| metric ของเรา | `PutMetricData`, บรรทัด log แบบ EMF, CloudWatch agent, OTLP | scrape จาก endpoint `/metrics` และเปิด remote write กับ OTLP receiver ได้ | Datadog Agent และ DogStatsD, OpenTelemetry |
| Query | Metric math, Metrics Insights (SQL), Logs Insights และ PromQL สำหรับ OpenTelemetry metric | PromQL | query editor ของ Datadog เอง |
| เก็บ metric | 15 เดือน โดย roll up ตามอายุ | ค่าตั้งต้น 15 วันบน disk ของ server ส่วน Amazon Managed Service for Prometheus ค่าตั้งต้น 150 วัน ได้ถึง 1,095 | 15 เดือน |
| ตัวที่ทำให้เสียเงิน | classic custom metric ต่อชุดค่า dimension, log ต่อ GB, alarm, dashboard | server ของเราเอง ส่วนบน managed service คือ sample ที่ ingest, storage และ sample ที่ query | host, custom metric (ต่อชุดของชื่อ metric กับค่า tag), log |
| รันที่ไหน | เป็น AWS service เท่านั้น ต่อ account และ Region | ที่ไหนก็ได้ที่เรารัน หรือแบบ managed (Amazon Managed Service for Prometheus, Grafana Cloud) | SaaS ของ Datadog |

ตัวเลขจากเอกสารและหน้าราคาของ Amazon CloudWatch, Prometheus, Amazon Managed Service for Prometheus และ Datadog ตุลาคม 2026

## ได้อะไร เสียอะไร

- **cardinality ต้องจ่ายเงิน** ใน classic metric ทุกชุดค่า dimension คือ metric ที่โดนคิดเงิน เพราะฉะนั้น dimension อย่าง `userId`, `requestId` หรือ `podName` จะคูณบิลขึ้นไป ส่วน OpenTelemetry metric คิดเงินต่อ GB แทน ทำให้ label ที่เพิ่มมาเสียแค่ค่า byte ที่มันเพิ่มเข้าไป
- **log มักเป็นรายการที่แพงที่สุด** ingest คิดเงินต่อ GB, Logs Insights คิดต่อ GB ที่ scan และ storage ก็โตขึ้นทุกเดือนสำหรับ group ที่ไม่มีวันหมดอายุ ให้ตั้ง retention ทุก group, ส่ง debug log ที่พูดมากไปที่ Infrequent Access หรือไม่ต้องส่งเลย และคอยดู `IncomingBytes` ใน namespace `AWS/Logs` ของแต่ละ log group
- **มองเห็นเป็นรายนาที** AWS service รายงานที่ความละเอียดหนึ่งนาที (EC2 basic monitoring ทุกห้านาที) ส่วน alarm evaluate นาทีละครั้ง และ alarm แบบ M out of N ต้องมีนาทีที่แย่ M นาที เพราะฉะนั้น `latency` จะ fire เร็วที่สุดก็สามนาทีหลังเริ่มช้า ส่วน high resolution ทำให้สั้นลงได้แต่แพงกว่า
- **การ query แคบกว่า PromQL หรือเครื่องมือเฉพาะทาง** สำหรับ classic metric: metric math และ Metrics Insights รับมือ dashboard และ alarm ได้เกือบหมด แต่การ join series ข้ามชุด label, การวิเคราะห์แบบ ad-hoc ที่ยาว ๆ และการหาความสัมพันธ์ข้าม signal ทำที่อื่นง่ายกว่า ส่วน PromQL บน OpenTelemetry metric ก็ช่วยปิดช่องว่างนี้ได้บางส่วน
- **ผูกอยู่กับ account และ Region** metric อยู่ใน Region ของมัน cross-account observability ทำงานภายใน Region เดียว และการรวมข้อมูลข้าม Region ก็คือการ copy ที่มีค่าใช้จ่าย
- **ใช้ได้แค่บน AWS** alarm, dashboard, query และ configuration ของ agent เป็น AWS resource ทั้งหมด ถ้าย้ายไป platform อื่นก็ต้องสร้างใหม่หมด การ instrument ด้วย OpenTelemetry ช่วยให้ฝั่งแอปยังย้ายไปที่อื่นได้
- **ข้อมูลที่บางต้องระวัง** metric ที่ไม่รายงานอะไรเลยตอนว่างจะทำให้ alarm ของมันไปที่ `INSUFFICIENT_DATA` ภายใต้ setting `missing` ที่เป็นค่าตั้งต้น เพราะฉะนั้นให้เลือก `TreatMissingData` อย่างตั้งใจ และ percentile ที่คิดจาก request ตอนกลางคืนแค่ไม่กี่ตัวก็แกว่งได้มาก

## ข้อควรรู้ตอนลงมือทำ

**บรรทัด EMF ของ Catalog** ที่ print เป็นบรรทัดเดียวลง stdout ตัว `orderId` ยัง search ได้โดยไม่ต้องกลายเป็น dimension:

```json
{
  "_aws": {
    "Timestamp": 1791369690000,
    "CloudWatchMetrics": [
      {
        "Namespace": "AcmeShop",
        "Dimensions": [["Service"]],
        "Metrics": [{ "Name": "OrderLatency", "Unit": "Milliseconds" }]
      }
    ]
  },
  "Service": "catalog",
  "OrderLatency": 182,
  "orderId": "o-1042",
  "level": "INFO"
}
```

**metric alarm สองตัว** ไม่มีตัวไหนมี action ของตัวเอง ตัวที่ page คือ composite alarm ส่วน account ID และ ID ของ load balancer เป็นแค่ตัวอย่าง:

```sh
aws cloudwatch put-metric-alarm \
  --alarm-name latency \
  --namespace AWS/ApplicationELB --metric-name TargetResponseTime \
  --dimensions Name=LoadBalancer,Value=app/acme-shop/50dc6c495c0c9188 \
  --extended-statistic p99 --period 60 \
  --evaluation-periods 5 --datapoints-to-alarm 3 \
  --threshold 1 --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching

aws cloudwatch put-metric-alarm \
  --alarm-name errors \
  --namespace AWS/ApplicationELB --metric-name HTTPCode_Target_5XX_Count \
  --dimensions Name=LoadBalancer,Value=app/acme-shop/50dc6c495c0c9188 \
  --statistic Sum --period 60 \
  --evaluation-periods 5 --datapoints-to-alarm 3 \
  --threshold 50 --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching
```

**composite alarm ที่ page:**

```sh
aws cloudwatch put-composite-alarm \
  --alarm-name impact \
  --alarm-rule 'ALARM("latency") AND ALARM("errors")' \
  --alarm-actions arn:aws:sns:us-east-1:111122223333:acme-oncall
```

**Logs Insights query** จาก diagram ครอบช่วง 5 นาทีห้าช่วงตั้งแต่ 10:15 ถึง 10:40 UTC ของวันที่ 7 ตุลาคม 2026 (เวลาเป็น epoch second):

```sh
aws logs start-query \
  --log-group-name /ecs/catalog \
  --start-time 1791368100 --end-time 1791369600 \
  --query-string 'filter @message like /ERROR/ | stats count(*) as errors by bin(5m)'
```

**Retention** ให้ตั้งตรงที่สร้าง log group เพราะ Lambda สร้าง group ของมันตอนใช้ครั้งแรกโดยไม่มี retention:

```sh
aws logs put-retention-policy --log-group-name /ecs/catalog --retention-in-days 30
```

- **page ตามอาการ ส่วนที่เหลือให้เปิด ticket** page ตามสิ่งที่ผู้ใช้รู้สึก (`impact`, burn rate ของ SLO, canary ที่พัง) แล้วส่ง alarm ที่เป็นสาเหตุอย่าง CPU, ความลึกของ queue หรือ disk ไปที่ ticket หรือ chat topic ทำให้ on-call engineer ถูกปลุกแค่ครั้งเดียวต่อ incident
- **เลือก statistic ให้ตรงกับคำถาม** `p99` หรือ `p95` สำหรับ latency, `Sum` สำหรับการนับ, `Maximum` สำหรับ saturation ส่วน percentile alarm บน service ที่เงียบ ๆ อาจต้องตั้ง `EvaluateLowSampleCountPercentile` เป็น `ignore`
- **บน hot path ให้ใช้ EMF มากกว่า `PutMetricData`** บรรทัด log ไม่เสีย API call เพิ่ม และเก็บ context ไว้ให้ query ทีหลัง ส่วน `PutMetricData` ให้ส่งจาก batch job หรือตอนที่อยากได้ metric โดยไม่ต้องมีบรรทัด log
- **ให้ dimension มีน้อยและมีขอบเขตชัด:** service, operation, status class, Availability Zone ส่วนอะไรก็ตามที่มีค่าเป็นพัน ๆ ควรอยู่ในบรรทัด log
- **ดูแล alarm และ dashboard เป็นโค้ด** (CloudFormation, CDK หรือ Terraform) ไว้ข้าง ๆ service ที่มันเฝ้าดู และทดสอบมันด้วย `SetAlarmState` ที่ตั้ง state ไว้จนถึงการ evaluate ครั้งถัดไป
- **ดูก่อนค่อย scan** บีบช่วงเวลาและ log group ให้แคบลงก่อนรัน Logs Insights query บน group ใหญ่ ๆ และใช้ field index กับ field ที่ filter บ่อย ทั้งสองอย่างลดจำนวน byte ที่ scan ที่เราต้องจ่ายเงินให้
