## ปัญหา

ร้านออนไลน์แห่งหนึ่งได้รับรูปสินค้าเข้ามาวินาทีละ 20 รูป แต่ละรูปต้องถูกตรวจ, resize เป็นขนาดต่าง ๆ ที่เว็บใช้, ใส่ watermark, ติด tag แล้ว publish ไปที่ product catalogue และ CDN เวอร์ชันแรกมักเป็น service ตัวเดียวที่มีฟังก์ชันเดียวรันห้าขั้นนี้ไปตามลำดับ

แบบนี้ใช้ได้ จนกระทั่งแต่ละขั้นเริ่มดึงไปคนละทาง:

- **ขั้นที่ช้าที่สุดเป็นตัวกำหนดจังหวะ** การ resize หนักกว่าขั้นอื่นมาก มันทำได้ 5 รูปต่อวินาที เลยกลายเป็นเพดานของ service แต่ละ copy และทุกรูปก็ต้องรอมัน
- **ทุกอย่าง scale ไปด้วยกัน** จะมีตัว resize สี่ตัวก็ต้องมี service ทั้งตัวสี่ copy รวมถึง validation, watermark, tagging และ publishing อย่างละสี่ copy ทั้งที่อย่างละหนึ่งก็พอ
- **ทุกอย่าง ship ไปด้วยกัน** watermark แบบใหม่หมายถึงต้อง build, test และ redeploy ทั้ง service และถ้าพลาดตรงนั้นก็อาจลากขั้นอื่นทั้งหมดล่มไปด้วย
- **ทุกอย่างล้มเหลวไปด้วยกัน** พอ tagging throw error ตัว retry ก็เริ่มใหม่ตั้งแต่ต้น การ resize ที่แพงเลยรันซ้ำอีกรอบ
- **ไม่มีอะไรใช้ซ้ำได้** pipeline วิดีโอที่ต้องใช้ tagging เหมือนกันก็ต้องมีสำเนาโค้ด tagging ของตัวเอง

## ทำงานยังไง

แบ่งการประมวลผลออกเป็นสายของ **filter** ที่ต่อกันด้วย **pipe**:

- **filter** ทำงานอย่างเดียว มันหยิบ item จาก pipe ขาเข้า แปลงมัน แล้วเขียนผลลัพธ์ลง pipe ขาออก มันไม่รู้ว่ามี filter ไหนอยู่ก่อนหรือหลังตัวเอง รู้แค่ format ของสิ่งที่มันอ่านและเขียน
- **pipe** ส่ง item จาก filter หนึ่งไปอีกตัว และเก็บพักไว้ระหว่างทาง ทำให้ตัวที่อยู่ติดกันทำงานด้วยความเร็วต่างกันได้ และไม่ต้องรันอยู่ในเวลาเดียวกัน
- **source** ป้อน pipe แรก (การ upload ใน animation) และ **sink** รับสิ่งที่ filter ตัวสุดท้ายสร้างออกมา (catalogue และ CDN)

filter ไม่ใช้อะไรร่วมกันเลยนอกจาก pipe ทำให้ filter แต่ละตัว deploy, scale, เปลี่ยน หรือใช้ซ้ำได้แยกกัน และคุณเปลี่ยน pipeline ได้ด้วยการต่อ pipe ใหม่ ไม่ต้องแก้ตัว filter เลย อย่างใน step 3 มี filter ตรวจ content safety แทรกเข้ามาระหว่าง Validate กับ Resize: Validate เขียนลง pipe ใหม่ แล้ว Safety ก็อ่านจาก pipe นั้นและเขียนลง pipe ที่ Resize อ่านอยู่แล้ว โดยไม่มี filter ตัวอื่นรู้ตัวเลย

### มาจากไหน

ใน memo ของ Bell Labs ลงวันที่ 11 ตุลาคม 1964 นั้น Doug McIlroy ขอให้มีวิธีต่อโปรแกรมเข้าด้วยกันแบบเดียวกับต่อสายยางรดน้ำ คือขันสายท่อนใหม่เข้าไปทุกครั้งที่ข้อมูลต้องได้รับการจัดการแบบอื่น ตามประวัติ Unix ที่ Dennis Ritchie เขียนไว้ pipe ถูกเพิ่มเข้าไปในระบบเมื่อปี 1972 เพราะ McIlroy ผลักดัน และมาพร้อมกับธรรมเนียมของเครื่องมือเล็ก ๆ ที่อ่าน standard input และเขียน standard output เพื่อให้ shell ต่อพวกมันเป็นสายได้: `cut -d, -f3 orders.csv | sort | uniq -c`

*Pattern-Oriented Software Architecture, Volume 1* (Buschmann, Meunier, Rohnert, Sommerlad และ Stal, 1996) จัด Pipes and Filters ไว้เป็น architectural pattern สำหรับระบบ stream processing และเป็นที่มาของคำศัพท์ส่วนใหญ่ที่ใช้ในบทความนี้:

- **Push หรือ pull** ใน pipeline แบบ push ฝั่งต้นทางจะส่ง item แต่ละตัวต่อไปเอง ส่วนใน pipeline แบบ pull ฝั่งปลายทางจะขอ item ถัดไปเมื่อพร้อม
- **Filter แบบ active หรือ passive** active filter รันใน process หรือ thread ของตัวเอง และขยับข้อมูลเอง คือ pull จากขาเข้าและ push ไปที่ขาออก ส่วน passive filter ถูกตัวข้าง ๆ เรียก โดยตัวข้าง ๆ จะ push item เข้าไป หรือ pull ผลลัพธ์ออกมา

*Enterprise Integration Patterns* (Gregor Hohpe กับ Bobby Woolf, 2003) เอา pattern นี้มาใช้กับ messaging โดย filter ของหนังสือคือ message processor ที่รับจาก inbound channel แล้ว publish ไปที่ outbound channel และ pipe ของหนังสือคือ message channel ถ้ามี queue คั่นระหว่าง active filter อย่างใน animation ก็จะได้ push กับ pull ผสมกัน: filter แต่ละตัว push output ลง queue แล้ว filter ถัดไปก็ pull จาก queue นั้นตามจังหวะของตัวเอง

### เกี่ยวข้องกับ pattern อื่นยังไง

- [Competing Consumers](../competing-consumers/) คือวิธีที่ filter ตัวเดียว scale out และ [Queue-Based Load Leveling](../queue-based-load-leveling/) คือสิ่งที่ pipe แต่ละเส้นทำให้ filter ที่อยู่ข้างหลังมัน
- [Medallion Architecture](../medallion-architecture/) คือแนวคิดเดียวกันใน lakehouse: แต่ละ layer คือ output ของขั้นที่กลั่นข้อมูล เก็บไว้เป็นตารางที่ query และ replay ได้ ไม่ใช่ message ที่กำลังวิ่งอยู่
- [Event-Driven Architecture](../event-driven-architecture/) ใช้ broker แบบเดียวกัน แต่ event จะ fan out ไปหาทุก subscriber ที่สนใจ และไม่มีใครเป็นเจ้าของลำดับ ส่วน pipeline คือสายที่ตั้งใจต่อไว้ และแต่ละ item มีขั้นถัดไปแค่ขั้นเดียว
- [Saga (Orchestration)](../saga-orchestration/) ประสาน business transaction ข้ามหลาย service และย้อนขั้นที่ทำเสร็จแล้วเมื่อขั้นหลังล้มเหลว ส่วน pipeline แปลงข้อมูลและปกติเดินหน้าอย่างเดียว

## ใช้ตอนไหนดี

- งานแบ่งเป็นขั้นที่เป็นอิสระต่อกัน และต่างกันเรื่องต้นทุน ความเร็ว หรือ resource: resize ที่กิน CPU, GPU สำหรับติด tag รูป, validation ที่เร็ว
- แต่ละขั้นเปลี่ยนแปลงด้วยความถี่ต่างกัน มีทีมเจ้าของต่างกัน หรือคุ้มที่จะเอาไปใช้ซ้ำใน pipeline อื่น
- คุณคาดว่าจะเพิ่ม ลบ หรือสลับลำดับขั้น
- stream ปริมาณสูงที่ขั้นที่ช้าหรือล้มเหลวต้องไม่ถ่วงขั้นอื่น และการประมวลผลเบื้องหลังเป็นเรื่องที่รับได้

อย่าใช้เมื่อ:

- ขั้นต่าง ๆ สั้น เร็ว และผูกกันแน่น ฟังก์ชันเดียวทำได้ง่ายกว่า และทุก hop จะเพิ่ม serialisation, latency และชิ้นส่วนที่ต้องดูแล
- ขั้นต่าง ๆ ต้องสำเร็จหรือล้มเหลวไปด้วยกันใน transaction เดียว
- มีผู้เรียกรอผลลัพธ์อยู่ภายใน request เดียวกัน แต่ pipeline ที่ใช้ queue เป็นแบบ asynchronous
- ทุกขั้นต้องใช้ context ร่วมกันเยอะจนการส่งต่อ context มีต้นทุนมากกว่าที่การแบ่งช่วยประหยัดได้

## ได้อะไร เสียอะไร

- **ชิ้นส่วนเยอะขึ้น** filter หกตัวกับ pipe ห้าเส้นที่ต้อง deploy, configure, secure และ monitor แทน service ตัวเดียว
- **Latency ต่อ item** ทุก hop เพิ่ม serialisation, network round trip และเวลาที่รออยู่ใน queue ตัว pipeline แลก latency กับ throughput และ isolation
- **Serialisation และ storage** ทุก hop ต้อง encode ข้อมูล และ broker ก็เก็บมันซ้ำอีกรอบ payload ใหญ่ ๆ ทำให้ต้นทุนนี้คูณขึ้นไป เว้นแต่จะส่ง reference แทน
- **ตัวซ้ำ** การส่งซ้ำหลัง crash หมายถึงการประมวลผลแบบ at-least-once ทำให้ทุก filter ต้อง idempotent
- **ไม่มี transaction ข้าม stage** ถ้า stage หลังล้มเหลว ผลของ stage ก่อนหน้าก็มีอยู่แล้ว และคุณต้องมีแผนว่าจะทำยังไงกับมัน
- **ตามดูยากขึ้น** เรื่องราวของรูปหนึ่งรูปกระจายอยู่ในหลาย service และหลาย log ตัว correlation ID และ dashboard ราย stage เป็นส่วนหนึ่งของราคาที่ต้องจ่าย
- **Contract ระหว่าง filter** message format แต่ละแบบคือ interface การเปลี่ยนสักตัวต้องมี versioning และ rollout อย่างระวัง เหมือน API

## ข้อควรรู้ตอนลงมือทำ

### การออกแบบ filter

- **หน้าที่เดียว** ถ้าอธิบาย filter แล้วต้องใช้คำว่า *และ* ลองพิจารณาแยกเป็นสอง filter แต่ก็อย่าแบ่งละเอียดเกินไป: ขั้นที่ต้นทุนต่ำ, เปลี่ยนไปด้วยกันเสมอ หรือต้อง scale ไปด้วยกัน ใช้ filter ร่วมกันได้ Azure เรียกการรวมพวกนี้ว่า pattern [Compute Resource Consolidation](https://learn.microsoft.com/en-us/azure/architecture/patterns/compute-resource-consolidation)
- **Stateless ถ้าทำได้** เก็บสิ่งที่ filter ต้องใช้ไว้ใน message หรือใน storage ที่ message ชี้ไป ไม่ใช่ใน memory ระหว่าง message แต่ละตัว ทำให้ instance ไหนก็หยิบ message ไหนก็ได้ และ instance ที่ crash ก็เสียแค่ item ที่มันถืออยู่
- **Contract ขาเข้าและขาออกที่ชัดเจน** ให้แต่ละ pipe มี message format เดียวที่มีเอกสารและมี version ตัว filter ควรส่งต่อ field ที่มันไม่ได้ใช้ไปตามเดิมโดยไม่แก้ไข เพื่อให้ field ที่เพิ่มเข้ามาสำหรับ filter ตัวหลังไม่ทำให้ตัวก่อนหน้าพัง
- **Idempotent** ให้ถือว่าทุก message มาถึงสองครั้งได้ อย่างที่ 7f3 เป็นใน step 4 ตั้งชื่อ output แบบ deterministic (`7f3/800w.jpg` ไม่ใช่ชื่อไฟล์สุ่ม) เพื่อให้การทำซ้ำเขียนทับผลลัพธ์ของตัวเอง และบันทึก message ID ไว้ในจุดที่ side effect เกิดซ้ำไม่ได้ เช่น email หรือ payment ดู [Idempotent Consumer](../idempotent-consumer/)

### pipe ในทางปฏิบัติคืออะไร

| Pipe | ตัวอย่าง | เหมาะกับ | ระวัง |
|---|---|---|---|
| stream หรือ channel ภายใน process | Unix pipe, Go channel, Java stream, library ของ Reactive Streams | hop ที่ต้นทุนต่ำ ไม่ต้อง serialise และมี backpressure ในตัว | filter ทุกตัวอยู่และตายไปพร้อมกับ process เดียว |
| Queue | Amazon SQS, Azure Service Bus, Azure Queue Storage, RabbitMQ | service ที่แยกกัน: แต่ละ message ไปหา consumer ตัวเดียว และกลับมาถ้าไม่ถูก acknowledge | ส่งแบบ at-least-once และปกติ replay ไม่ได้ |
| Topic หรือ log | Apache Kafka, Amazon Kinesis Data Streams, Azure Event Hubs, Google Cloud Pub/Sub | stream แบบ durable ที่หลาย pipeline อ่านและ replay ได้ | ลำดับและ parallelism ผูกอยู่กับ partition |

framework ต่าง ๆ สร้าง pipeline จากชิ้นส่วนพวกนี้:

- **[Kafka Streams](https://kafka.apache.org/43/streams/core-concepts/)** สร้าง *processor topology*: graph ของ stream processor ที่ต่อกันด้วย stream โดย source processor อ่านจาก Kafka topic และ sink processor เขียนลง topic ตัว DSL มี operation ทั่วไปให้ (map, filter, join, aggregation) ส่วน Processor API รับ processor ที่เขียนเอง การประมวลผลเป็น at-least-once โดย default (`processing.guarantee`) ถ้าใช้ `exactly_once_v2` ตัว input offset, การ update state store และ output topic จะถูก commit ไปด้วยกัน แบบนี้ครอบสิ่งที่อยู่ภายใน Kafka ได้ แต่ไม่ครอบ call ไปที่ service ภายนอก
- **[Apache Beam](https://beam.apache.org/documentation/programming-guide/)** อธิบาย *pipeline* ของ *PTransform* ที่อ่านและเขียน *PCollection* แล้ว runner อย่าง Dataflow, Flink หรือ Spark ก็เป็นตัวรันมัน ส่วน pipe อาจเป็นแค่ระดับ logical ก็ได้: [Dataflow fuse](https://docs.cloud.google.com/dataflow/docs/pipeline-lifecycle) ขั้นที่ติดกันเข้าด้วยกันเพื่อเลี่ยงต้นทุนการส่งข้อมูลระหว่างขั้น แต่ก็อาจทำให้ parallelism ลดลงด้วย
- **AWS Step Functions** รัน pipeline แบบ orchestrate: output ของแต่ละ state กลายเป็น input ของ state ถัดไป ได้ไม่เกิน [256 KiB](https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html) ส่วน [Standard workflow](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html) รันแต่ละขั้นครั้งเดียวและรันได้นานถึงหนึ่งปี แต่ Express workflow เป็น at-least-once และรันได้ไม่เกินห้านาที
- **Serverless function ที่ต่อกันด้วย queue** เป็นรูปแบบที่พบบ่อยบน cloud และเป็นแบบที่อยู่ในตัวอย่างรูปภาพของ Azure เอง: filter แต่ละตัวคือ function ที่ถูก trigger จาก queue ขาเข้าของมัน แล้วเขียนลง queue ถัดไป เมื่อ AWS Lambda อ่านจาก Amazon SQS ตัว message จะมาเป็น batch เลยต้องใช้ [partial batch response](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html) เพื่อรายงานเฉพาะ message ที่ล้มเหลว แทนที่จะทำทั้ง batch ล้มเหลวแล้วทำตัวที่สำเร็จไปแล้วซ้ำ ดู [Serverless](../serverless/)

### Scale แต่ละ filter, backpressure และ buffer

scale แต่ละ filter ตามสัญญาณของมันเอง: depth ของ pipe ขาเข้า และอายุของ message ที่เก่าที่สุดในนั้น ภายใน filter เดียว instance หลายตัวอ่าน pipe เดียวกันแบบ [competing consumers](../competing-consumers/) และ autoscaler ก็เพิ่มหรือลดจำนวนพวกมัน ([Autoscaling](../autoscaling/)) ใน animation ตัว Resize ต้องใช้ 20 ÷ 5 = 4 instance และไม่มีอะไรอื่นเปลี่ยน การทำได้เท่ากับอัตราที่เข้ามาแค่หยุด backlog ไม่ให้โต ถ้าจะเคลียร์ backlog ต้องรันให้เร็วกว่าอัตราที่เข้ามาไปสักพัก

pipeline ไปได้ไม่เร็วกว่า filter ที่ช้าที่สุด และ pipe เป็นตัวกำหนดว่าผลจะออกมาแบบไหน pipe ภายใน process มี buffer ขนาดตายตัว: [Linux pipe](https://man7.org/linux/man-pages/man7/pipe.7.html) เก็บได้ 16 page โดย default (64 KiB ถ้า page ปกติขนาด 4 KiB) และตัวเขียนที่เขียนจนเต็มจะ block จนกว่าตัวอ่านจะตามทัน ทั้งสายเลยช้าลงตามจังหวะของ command ที่ช้าที่สุด [Reactive Streams](https://www.reactive-streams.org/) ทำแนวคิดเดียวกันนี้ให้เป็นมาตรฐานข้าม thread ทำให้ฝั่งรับไม่เคยถูกบังคับให้ buffer เกินกว่าที่รับไหว ส่วน broker queue แทบจะไม่มีขีดจำกัด ทำให้ filter ที่ช้าไม่ได้ทำให้ producer ของมันช้าลง แต่ backlog จะโตแทน นั่นคือ [load leveling](../queue-based-load-leveling/) และมันแค่เลื่อน load ไปในเวลา ให้แต่ละ pipe มีขีดจำกัด (ความยาว ขนาด หรืออายุของ message) ตั้ง alert ที่ depth และอายุของมัน และตัดสินใจไว้ล่วงหน้าว่าถ้าเต็มจะทำยังไง: ปฏิเสธที่ต้นทาง ทิ้ง load หรือ scale filter

### ลำดับ

ถ้ามี instance เดียวต่อ filter และ pipe เป็นแบบ first-in, first-out ตัว item จะออกไปตามลำดับที่เข้ามา แต่พอ filter มีหลาย instance ตัว item ที่เร็วก็แซงตัวที่ช้าได้ ถ้าลำดับสำคัญแค่ต่อ key เช่นรูปทั้งหมดของสินค้าชิ้นเดียว ให้ item ของแต่ละ key เรียงตามลำดับ [Kafka](https://kafka.apache.org/43/getting-started/introduction/) เขียน record ที่ key เดียวกันลง partition เดียวกัน และ consumer อ่านแต่ละ partition ตามลำดับ ส่วน [Amazon SQS FIFO queue](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-key-terms.html) ประมวลผล message ของ message group เดียวกันทีละตัวตามลำดับ แล้ว parallelism ก็จะมาจากจำนวน key หรือ group แทนจำนวน instance ส่วนรายละเอียดของทางเลือกต่าง ๆ ดูได้ใน [Competing Consumers](../competing-consumers/)

### Payload ใหญ่: ส่ง reference

อย่า push รูปขนาด 12 MB ผ่านทุก pipe ให้เก็บมันไว้ครั้งเดียวใน object storage แล้วใส่แค่ตำแหน่งและ metadata ของมันไว้ใน message นี่คือ pattern [Claim Check](../claim-check/) และเป็นสิ่งที่ตัวอย่าง image-processing ของ Azure ทำอยู่พอดี ตัว broker และ orchestrator เองก็บังคับให้คุณไปทางนี้อยู่แล้ว: [Amazon SQS message](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html) ใหญ่ได้ไม่เกิน 1 MiB (Extended Client Library สำหรับ Java และ Python เก็บ payload ที่ใหญ่กว่านั้นไว้ใน Amazon S3 ได้ถึง 2 GB) และ state ของ Step Functions ส่งต่อได้ไม่เกิน 256 KiB จากนั้น filter แต่ละตัวก็เขียนผลลัพธ์ของตัวเองเป็น object ใหม่ แล้วส่ง reference ใหม่ต่อไป

### Error, retry และ poison message

- **Transient error** เช่น timeout หรือ API ที่โดน throttle: ให้ retry ภายใน filter ด้วย [backoff และ jitter](../retry-with-backoff/) ก่อนจะยอมแพ้กับ message นั้น
- **Crash**: message ที่ไม่เคยถูก acknowledge จะกลับมาเองเมื่อ lease ของมันหมด (visibility timeout ใน Amazon SQS ที่ default 30 วินาที) แล้ว instance อื่นก็ประมวลผลมัน นี่คือสิ่งที่เกิดกับ 7f3 ใน step 4
- **Poison message**: message ที่ล้มเหลวทุกครั้งจะวนกลับมาไม่รู้จบถ้าไม่มีอะไรหยุดมัน broker นับจำนวนการส่ง แล้วพัก message ไว้ใน [dead-letter queue](../dead-letter-queue/) เมื่อถึงขีดจำกัด: [`maxReceiveCount`](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html) ใน redrive policy ของ SQS หรือ [`MaxDeliveryCount`](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-dead-letter-queues) ใน Azure Service Bus (default 10) ให้แต่ละ pipe มี dead-letter queue ของตัวเอง จะได้รู้ว่า stage ไหนล้มเหลว ตั้ง alert ที่ depth ของมัน และวางแผนว่าจะ redrive message ยังไงเมื่อแก้ต้นเหตุแล้ว
- **การปฏิเสธที่คาดไว้แล้วไม่ใช่ error** ไฟล์ที่ validate ไม่ผ่านควรไปอยู่ใน channel สำหรับ input ที่ไม่ถูกต้องพร้อมแนบเหตุผล (*Enterprise Integration Patterns* เรียกมันว่า [Invalid Message Channel](https://www.enterpriseintegrationpatterns.com/patterns/messaging/InvalidMessageChannel.html)) ไม่ใช่ใน dead-letter queue ที่มีไว้สำหรับ bug และ outage

### Observability

- **ราย stage:** depth ของ pipe ขาเข้า, อายุของ message ที่เก่าที่สุด, อัตราการประมวลผล, อัตรา error, depth ของ dead-letter queue และจำนวน instance ตัว depth กับอายุบอกว่าคอขวดอยู่ตรงไหน ส่วนการเทียบอัตราขาเข้ากับขาออกบอกว่ามันแย่ลงหรือเปล่า
- **End to end:** ใส่ correlation ID ไว้ในทุก message ส่งต่อแบบไม่แก้ไข และ log มันในทุก filter เพื่อให้ค้นครั้งเดียวก็เห็นการเดินทางทั้งหมดของรูปหนึ่งรูป ดีกว่านั้นคือส่งต่อ `traceparent` ของ [W3C Trace Context](https://www.w3.org/TR/trace-context/) และบันทึก span ต่อ filter ดู [Distributed Tracing](../distributed-tracing/) วัดเวลาตั้งแต่ upload จนถึง publish ด้วย เพราะทุก stage อาจดูปกติดี ทั้งที่เวลารวมช้าเกินไป

### ทำเสร็จแค่บางส่วน และ compensation

ไม่มี transaction ไหนครอบทุก filter ถ้า filter ช่วงท้ายล้มเหลวถาวร ตัวก่อนหน้าก็ทำงานของตัวเองไปแล้ว: ใน step 4 รูป 9c1 มีไฟล์ที่ resize และใส่ watermark แล้ว มี tag แล้ว แต่ไม่มีรายการใน catalogue เลยต้องตัดสินใจเป็นราย pipeline ว่าเรื่องนี้หมายถึงอะไร:

- **ปล่อยไว้** ถ้าของที่เหลือไม่มีผลเสีย แล้วค่อยเก็บกวาดทีหลัง เช่นด้วย lifecycle rule ของ storage
- **ทำให้เสร็จ** ด้วยการ redrive message เมื่อแก้ต้นเหตุแล้ว และเพราะ filter idempotent เรื่องนี้เลยปลอดภัย
- **ย้อนกลับ** ด้วย [compensating transaction](../compensating-transaction/) ถ้าขั้นก่อนหน้าเปลี่ยนอะไรที่สำคัญ เช่น stock หรือเงิน แนวทางของ Azure แนะนำให้ใช้ Pipes and Filters คู่กับ compensating transaction เป็นทางเลือกแทน distributed transaction ส่วนถ้าขั้นต่าง ๆ รวมกันเป็น business transaction มากกว่าเป็นการแปลงข้อมูล ให้ประสานพวกมันแบบ [saga](../saga-orchestration/)

### Routing ระหว่าง filter

สายที่ตายตัวคือ pipeline ที่ง่ายที่สุด ถ้าขั้นถัดไปขึ้นอยู่กับตัว item เช่นวิดีโอไป Transcode และรูปไป Resize ให้ใส่ [content-based router](https://www.enterpriseintegrationpatterns.com/patterns/messaging/ContentBasedRouter.html) ไว้ระหว่าง filter: มันอ่านแต่ละ message แล้วส่งไปที่ pipe ที่ถูกต้อง ถ้าแต่ละ item ต้องมีรายการขั้นของตัวเอง ก็ใช้ [routing slip](https://www.enterpriseintegrationpatterns.com/patterns/messaging/RoutingTable.html) ที่แนบไปกับ message เพื่อระบุขั้นตามลำดับ แล้ว router ในแต่ละขั้นก็ส่ง message ต่อไปยังขั้นถัดไปในรายการ เก็บการตัดสินใจพวกนี้ไว้ใน router หรือใน message แทนที่จะไว้ข้างใน filter เพื่อให้ filter ยังใช้ซ้ำได้
