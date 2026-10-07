## ปัญหา

ระบบส่วนใหญ่เริ่มจาก service ตัวเดียวที่อยู่หน้า database ตัวเดียว แล้วช่วงหนึ่งก็ต้องการแค่นั้นจริง ๆ จากนั้นแรงกดดันก็เริ่มมา ทีละแบบ: หน้าสินค้าเดิมโดนอ่านซ้ำไปซ้ำมา การส่งอีเมลยืนยันระหว่าง checkout ทำให้ลูกค้าต้องรอ mail service ช่อง search ต้องทนคำพิมพ์ผิดได้ แบบที่ SQL `LIKE` ทำให้ไม่ได้ และรูปภาพต้องเดินทางจาก data centre เดียวไปถึงลูกค้าในทุกทวีป แรงกดดันแต่ละแบบมี component ที่ทุกคนรู้จักไว้รับมือ และแต่ละ component ก็คือ product ที่มีศัพท์ของตัวเอง: Kafka, Redis, API gateway, CDN

ถ้าเรียน product พวกนี้ทีละตัว คำถามที่สำคัญตอนออกแบบจะหายไป: แต่ละตัวอยู่ตรงไหน อะไรคุยกับมัน และพอมีมันแล้ว ส่วนอื่นของระบบเปลี่ยนไปยังไง หน้านี้คือแผนที่ของหน้า *System Components* และ *AWS Services* ใน catalog นี้ มันตามการเปิดดูหน้าหนึ่งครั้งกับการสั่งซื้อหนึ่งครั้งผ่านร้านออนไลน์ธรรมดา ๆ ชื่อ Acme Shop เพื่อให้วางหน้าอื่นทุกหน้าลงบนแผนที่นี้ได้

## ทำงานยังไง

ร้านนี้แบ่งเป็นสองครึ่ง และเส้นประที่คั่นระหว่างสองครึ่งคือสิ่งที่มีประโยชน์ที่สุดบนแผนที่

### ครึ่งที่เป็น synchronous: ลูกค้ารออยู่

ทุกอย่างที่อยู่เหนือเส้นเกิดขึ้นระหว่างที่ลูกค้ารอคำตอบ ทุกกล่องตรงนั้นเลยเพิ่ม latency และทุกกล่องตรงนั้นทำให้ request fail ได้

- **DNS** แปลง `shop.example` เป็น address ส่วนใน Amazon Route 53 ตัว *alias record* ชี้ชื่อหนึ่ง (แม้แต่ zone apex) ไปที่ CloudFront distribution หรือ load balancer ได้ตรง ๆ แล้ว Route 53 ก็ตาม resource นั้นไปเองเมื่อ address ของมันเปลี่ยน
- **CDN** เสิร์ฟรูปกับ script จาก edge location ที่อยู่ใกล้ลูกค้า ตัว CloudFront ส่ง request แต่ละตัวไปที่ edge location ที่ latency ต่ำที่สุด และตอบจาก cache ของมันเมื่อทำได้ มีแค่ตอน miss ที่ request จะวิ่งต่อไปถึง origin ([CDN edge caching](../cdn-edge-caching/))
- **load balancer** กระจาย request ไปยัง instance ที่ healthy ([load balancing](../load-balancing/)) ตัว Application Load Balancer ทำงานที่ layer 7 เลย route ตาม path หรือ host name ได้ ส่วน NGINX ก็ทำงานเดียวกันนี้ถ้าคุณรันมันเอง
- **API gateway** คือประตูหน้าของ API มันเช็ก token ของคนเรียกและใช้ rate limit ก่อนที่ service ตัวไหนจะเห็น request ([API gateway](../api-gateway/)) Amazon API Gateway ตรวจ JWT ได้ด้วย JWT authorizer บน HTTP API และ throttle ด้วย token bucket โดยตอบ `429 Too Many Requests` เมื่อ bucket ว่าง ส่วน Kong ทำงานเดียวกันผ่าน plugin
- **service** เก็บ business logic ไว้ ตัว Catalog เสิร์ฟ `/products` ส่วน Orders เสิร์ฟ `/orders` ทั้งคู่รันเป็น container โดยมี Kubernetes หรือ Amazon ECS เป็นตัว schedule
- **cache** เก็บข้อมูลที่ hot ไว้ใน memory แล้วในขั้นที่ 1 service Catalog ก็เจอสินค้า 42 ใน Redis เลยตอบได้โดยไม่ต้อง query database ([cache-aside](../cache-aside/)) ส่วนเส้นประคือทางที่ request จะไปถ้า miss
- **database** คือ system of record: PostgreSQL ที่คุณรันเอง หรือให้ Amazon RDS หรือ Aurora รันให้

### การสั่งซื้อ: transaction เดียว แล้วค่อยตอบ

การสั่งซื้อในขั้นที่ 2 คือจุดที่สองครึ่งมาเจอกัน service Orders ต้องเก็บ order 1001 *และ* บอกส่วนอื่นของร้านให้รู้ด้วย ถ้าทำเป็นการเขียนสองครั้ง คือเขียน database ก่อนแล้วค่อยเขียน message broker ก็จะมีการเขียนหายไปหนึ่งครั้งทุกครั้งที่ process ตายตรงกลาง มันเลยเขียนทั้งสองอย่างใน **database transaction เดียว** คือแถวของ order กับแถว `OrderPlaced` ในตาราง **outbox** แล้วตอบ `201 Created` ทันทีที่ transaction commit ([transactional outbox](../transactional-outbox/)) ทั้งอีเมลยืนยัน, search index และสำเนาสำหรับ analytics ก็ไม่ได้อยู่บน request path เลย: ลูกค้าได้คำตอบไปก่อนที่งานพวกนี้จะเริ่มสักตัว

### ครึ่งที่เป็น asynchronous: หลัง response

- **outbox relay** อ่านแถวใน outbox ที่ commit แล้ว และ publish ออกไป มันจะ poll ตารางก็ได้ หรือตาม change log ของ database ก็ได้ ส่วน Outbox Event Router ของ Debezium ทำแบบที่สองให้ PostgreSQL ([change data capture](../change-data-capture/))
- **event stream** เก็บ `OrderPlaced` ไว้ใน topic `orders` และให้ consumer ทุกตัวที่สนใจอ่านมันได้ตามจังหวะของตัวเอง ([publish-subscribe](../publish-subscribe/), [event-driven architecture](../event-driven-architecture/)) ถ้าใช้ Kafka แต่ละ consumer group จะเก็บตำแหน่งของตัวเองใน log ส่วนถ้าใช้ Amazon SNS กระจายไปที่ Amazon SQS ตัว subscriber แต่ละตัวจะได้ queue ของตัวเอง ไม่ว่าแบบไหน consumer ที่ช้าหรือพังก็ถ่วงแค่ตัวมันเอง
- **worker** ทำงานที่ตามมา: Email worker (Lambda function) ตัว Search indexer (container) และ analytics loader (Kafka Connect หรือ Amazon Data Firehose) ส่วน worker ตัวเดียวกันหลาย ๆ สำเนาก็แบ่งงานของ group หนึ่งกันทำได้ แบบ [competing consumers](../competing-consumers/)
- **การส่งอีเมล** ไปผ่าน mail service อย่าง Amazon SES หรือ mail server ที่คุณรันเอง อย่าง Postfix
- **Search** (OpenSearch หรือ Elasticsearch) ตอบ query ที่ SQL ทำได้ไม่ดี: full text, คำพิมพ์ผิด, การจัดอันดับตาม relevance และ facet มันเก็บสำเนาของข้อมูลที่ระบบอื่นเป็นเจ้าของ โดยมี indexer คอยทำให้เป็นปัจจุบัน
- **data lake** เก็บทุก event ไว้ใน Amazon S3 สำหรับ analytics

### Observability ทั้งสองครึ่ง

ทุกกล่องส่ง **metric, log และ trace** ไปที่เดียวกัน: Prometheus ดึง metric แล้ว Grafana เอาไปทำกราฟ หรือใช้ Amazon CloudWatch ทั้งหมดนี้คือสิ่งที่ทำให้ความผิดพลาดในขั้นที่ 4 มีคนสังเกตเห็นได้ พอ Search indexer ล่ม ไม่มีอะไรบน request path fail เลย: order 1002 ถึง 1004 สำเร็จ ส่วน event ของ order พวกนี้ก็รออยู่ใน stream แล้วอาการที่เห็นคือ **consumer lag** ของ group `search` ขึ้นไปถึง 3 บน dashboard ระหว่างที่ผล search ตามหลัง database มากขึ้นเรื่อย ๆ ถ้าจะให้ trace ข้าม stream ได้ ต้องพา trace context ไปไว้ใน event ด้วย ([distributed tracing](../distributed-tracing/)) และ log จากทุกกล่องต้องมีที่เก็บที่เดียว ([centralized logging](../centralized-logging/))

## อยู่ตรงไหนใน solution

หน้านี้คือแผนที่ ส่วนหน้าอื่นจะซูมเข้าไปดู แต่ละแถวคือบทบาทหนึ่ง พร้อม product ที่มักใช้ทำบทบาทนั้น และ pattern ใน catalog นี้ที่มัน implement หรือช่วยรองรับ

| บทบาท | ทำอะไรใน Acme Shop | Open source | AWS | Pattern |
|---|---|---|---|---|
| DNS | แปลง `shop.example` เป็น address | ส่วนใหญ่ใช้ managed service | Amazon Route 53 | [Active-passive failover](../active-passive-failover/) |
| CDN | เสิร์ฟรูปกับ script จาก edge | ส่วนใหญ่ใช้ managed service | Amazon CloudFront | [CDN edge caching](../cdn-edge-caching/) |
| Load balancer | กระจาย request ไปยัง instance ที่ healthy | NGINX | Elastic Load Balancing (ALB) | [Load balancing](../load-balancing/), [health endpoint monitoring](../health-endpoint-monitoring/) |
| API gateway | เช็ก token จำกัด rate และ route ไปที่ service | Kong | Amazon API Gateway | [API gateway](../api-gateway/), [rate limiting](../rate-limiting/), [gateway offloading](../gateway-offloading/), [JWT validation](../jwt-validation/) |
| Service | business logic ที่รันเป็น container | Kubernetes | Amazon ECS, Amazon EKS | [Microservices](../microservices/), [autoscaling](../autoscaling/) |
| Cache | เก็บข้อมูลที่อ่านบ่อยไว้ใน memory | Redis, Valkey | Amazon ElastiCache | [Cache-aside](../cache-aside/) |
| Database | เก็บ order โดยใช้หนึ่ง transaction ต่อหนึ่ง order | PostgreSQL | Amazon RDS, Amazon Aurora | [Transactional outbox](../transactional-outbox/), [read replicas](../read-replicas/) |
| Outbox relay | publish แถวใน outbox ที่ commit แล้ว | Debezium | — | [Change data capture](../change-data-capture/) |
| Event stream หรือ queue | เก็บ event ไว้ ให้ consumer แต่ละตัวอ่านตามจังหวะของตัวเอง | Apache Kafka | Amazon MSK; Amazon SNS กับ Amazon SQS | [Publish-subscribe](../publish-subscribe/), [event-driven architecture](../event-driven-architecture/), [queue-based load leveling](../queue-based-load-leveling/) |
| Worker | ทำงานที่ตามมานอก request path | Kafka Connect, container ตัวไหนก็ได้ | AWS Lambda, Amazon Data Firehose | [Competing consumers](../competing-consumers/), [web-queue-worker](../web-queue-worker/), [idempotent consumer](../idempotent-consumer/) |
| Search | query แบบ full text บนสำเนาของข้อมูล | OpenSearch, Elasticsearch | Amazon OpenSearch Service | [CQRS](../cqrs/), [materialized view](../materialized-view/) |
| การส่งอีเมล | ส่งอีเมลยืนยัน | Postfix | Amazon SES | — |
| Data lake | เก็บทุก event ไว้สำหรับ analytics | — | Amazon S3 | [Medallion architecture](../medallion-architecture/) |
| Observability | metric, log, trace และ alert | Prometheus, Grafana, OpenTelemetry | Amazon CloudWatch | [Distributed tracing](../distributed-tracing/), [centralized logging](../centralized-logging/), [telemetry pipeline](../telemetry-pipeline/) |

หน้า component ที่มีแล้วตอนนี้คือ [Apache Kafka](../kafka/), [RabbitMQ](../rabbitmq/), [Redis & Valkey](../redis/), [PostgreSQL](../postgresql/), [MongoDB](../mongodb/), [Elasticsearch & OpenSearch](../elasticsearch/), [NGINX](../nginx/), [Docker & Containers](../docker/), [Kubernetes](../kubernetes/), [etcd](../etcd/), [Prometheus & Grafana](../prometheus/), [HashiCorp Vault](../vault/), [Keycloak](../keycloak/), [Amazon VPC](../amazon-vpc/), [Amazon S3](../amazon-s3/), [Amazon SQS](../amazon-sqs/), [Amazon SNS](../amazon-sns/), [Amazon EventBridge](../amazon-eventbridge/), [Amazon DynamoDB](../amazon-dynamodb/), [Amazon RDS & Aurora](../amazon-rds-aurora/), [AWS Lambda](../aws-lambda/), [Amazon ECS & Fargate](../amazon-ecs/), [AWS IAM](../aws-iam/) และ [Amazon Cognito](../amazon-cognito/) ส่วนที่วางแผนไว้คือ Apache Cassandra, Apache Flink, Amazon Kinesis Data Streams, AWS Step Functions, Amazon Route 53 และ Amazon CloudWatch

ตอนเลือก license ก็สำคัญ และหลายตัวเพิ่งเปลี่ยนไป (เช็กเมื่อตุลาคม 2026):

- **Redis** ตั้งแต่ 8 ขึ้นไปให้เลือก license ได้ระหว่าง RSALv2, SSPLv1 หรือ AGPLv3 ส่วน **Valkey** ที่ fork มาจาก Redis ก่อนที่ Redis จะย้ายไปใช้ license แบบ source-available ไม่นาน และมี Linux Foundation หนุนอยู่ ใช้ license แบบ BSD แล้ว Amazon ElastiCache ก็มีให้ใช้ทั้ง Valkey, Memcached และ Redis OSS
- **Elasticsearch** เพิ่ม AGPLv3 เข้ามาในปี 2024 เป็นตัวเลือกที่สามคู่กับ SSPL และ Elastic License 2.0 ส่วน **OpenSearch** ที่ fork มาจาก Elasticsearch 7.10 ใช้ Apache 2.0 และเป็นโปรเจกต์ของ Linux Foundation ตัว Amazon OpenSearch Service รัน OpenSearch และ Elasticsearch OSS รุ่นเก่าได้ถึง 7.10
- **Grafana** ย้ายไปใช้ AGPLv3 ในปี 2021 ส่วน source ของ **Kong** Gateway ใช้ Apache 2.0 และ **NGINX** ใช้ license แบบ BSD two-clause

## ใช้ตอนไหนดี

เริ่มจาก service ตัวเดียวกับ database ตัวเดียว แล้วค่อยเพิ่มชิ้นส่วนเมื่อแรงกดดันของมันโผล่ให้เห็นในตัวเลขที่วัดได้ ไม่ใช่เพิ่มไว้ล่วงหน้า ร้านที่มี order วันละไม่กี่ร้อยอาจไม่ต้องใช้อะไรจากครึ่งที่เป็น asynchronous เลย: service ตัวเดียว PostgreSQL และ CDN ก็พาไปได้ไกลแล้ว

| เพิ่ม | เมื่อไร | ต้องแลกกับอะไร |
|---|---|---|
| CDN | ไฟล์ static เป็นสัดส่วนใหญ่ของ traffic หรือลูกค้าอยู่ไกลจาก server | มี cache เพิ่มอีกตัวที่ต้อง invalidate: ให้ ship ไฟล์ด้วยชื่อที่มี version |
| Cache | read เป็นส่วนใหญ่ และ item เดิมโดนอ่านซ้ำไปซ้ำมา | การอ่านเจอค่า stale กฎการ invalidate และ database ที่ต้องรอดได้ตอน cache ยัง cold |
| Load balancer และ instance เพิ่ม | instance ตัวเดียวไม่พอแล้ว หรือห้ามเป็น single point of failure | health check และ state ที่ต้องย้ายไปอยู่นอก instance |
| API gateway | หลาย service และหลาย client ใช้ auth, rate limit และ routing ร่วมกัน | มี hop เพิ่มอีกหนึ่งในทุก request และตัวมันเองก็ต้อง highly available |
| Queue | งานรอได้ หรือเข้ามาเป็นช่วง ๆ | delivery แบบ at-least-once, retry และ dead-letter queue ที่ต้องคอยดู |
| Stream | consumer หลายตัวต้องใช้ event เดียวกัน หรือต้อง replay มัน | cluster หรือ service ที่ต้องรัน, lag ที่ต้องคอยดู และ event schema ที่กลายเป็น contract |
| Search | query โตเกินกว่าที่ SQL รับไหว: full text, คำพิมพ์ผิด, การจัดอันดับ, facet | สำเนาข้อมูลชุดที่สองที่ตามหลังอยู่ และการ reindex |

## ได้อะไร เสียอะไร

- **ทุกกล่องคืออีกหนึ่งอย่างที่ต้องรัน** ทุกตัวต้อง patch วางแผน capacity มี backup หรือ replica มี alert และมีบรรทัดในงบประมาณ จะเป็น managed service หรือไม่ก็ตาม
- **ทุก hop คืออีกหนึ่งทางที่จะ fail** ครึ่งที่เป็น synchronous จะ available ได้แค่เท่ากับสายของกล่องที่ลูกค้ารออยู่ ทุกการเรียกตรงนั้นเลยต้องมี timeout และ retry ก็ต้องมีขีดจำกัด
- **ครึ่งที่เป็น asynchronous ตามหลัง** ในขั้นที่ 4 ตัว search ตามหลัง database อยู่ 3 order นี่คือ eventual consistency: หน้าจอต้องบอกว่า "เราจะส่งอีเมลไปหาคุณ" และ search ที่ยังหา order ที่เพิ่งสั่งไม่เจอก็ต้องเป็นเรื่องที่รับได้
- **Delivery เป็นแบบ at least once** broker และ event source mapping ของ Lambda ส่ง event เดียวกันมาสองครั้งได้ ทำให้ consumer ทุกตัวต้อง [idempotent](../idempotent-consumer/)
- **ความผิดพลาดเงียบ** consumer ที่ล่มไม่ทำให้ request ไหนพัง ถ้าไม่มี consumer lag บน dashboard และไม่มี alert ไว้ คนแรกที่แจ้งปัญหาก็จะเป็นลูกค้า

## ข้อควรรู้ตอนลงมือทำ

- **เขียน order กับแถวใน outbox ใน transaction เดียว** ถ้าใช้ชื่อ column ตาม default ของ Debezium การสั่งซื้อในขั้นที่ 2 จะเป็นแบบนี้:

  ```sql
  BEGIN;
  INSERT INTO orders (id, total) VALUES (1001, 59.90);
  INSERT INTO outbox (id, aggregatetype, aggregateid, type, payload)
  VALUES (gen_random_uuid(), 'order', '1001', 'OrderPlaced',
          '{"orderId": 1001, "total": 59.90}');
  COMMIT;
  ```

  ตัว `id` ของ outbox จะติดไปกับ event เป็น header ทำให้ consumer มี key ไว้ทิ้งตัวที่ซ้ำ โดย default ตัว Debezium ตั้งชื่อ topic เป็น `outbox.event.` ต่อด้วยค่าของ `aggregatetype` แต่ถ้าจะ publish ไปที่ topic อื่น อย่าง `orders` ให้ตั้ง `route.topic.replacement`
- **ดู lag แยกตาม consumer group** สำหรับ Kafka ให้ describe group ดู โดยที่ column `LAG` คือ `LOG-END-OFFSET` ลบด้วย `CURRENT-OFFSET` ของแต่ละ partition:

  ```sh
  bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group search
  ```

  Amazon MSK ส่ง metric เรื่อง consumer lag อย่าง `MaxOffsetLag` และ `EstimatedMaxTimeLag` ไปที่ CloudWatch หรือ Prometheus ส่วน SQS มีตัวที่เทียบกันได้คือ `ApproximateNumberOfMessagesVisible` และ `ApproximateAgeOfOldestMessage` ให้ตั้ง alert ตอน lag โตขึ้นเรื่อย ๆ ไม่ใช่ตอนเห็นค่าที่ไม่ใช่ศูนย์แค่ครั้งเดียว
- **ตามให้ทันภายในช่วง retention** event ที่รออยู่จะปลอดภัยก็แค่ตราบที่ stream ยังเก็บมันไว้: default คือ 168 ชั่วโมง (7 วัน) สำหรับ broker ของ Kafka 4.3 (`log.retention.hours`) และ 4 วันสำหรับ queue ของ SQS โดยปรับได้ตั้งแต่ 1 นาทีถึง 14 วัน ตัว consumer ของ Kafka ที่ restart จะทำต่อจาก offset ล่าสุดที่ group ของมัน commit ไว้ ส่วน consumer ของ SQS ก็จะเจอ message ของมันยังรออยู่ ไม่ว่าแบบไหน มันก็ต้องตามให้ทันก่อนที่ช่วงเวลานั้นจะปิด
- **ให้ cache มี TTL และลบตอนเขียน** key ที่หมดอายุไปเองจะจำกัดว่าการอ่านจะ stale ได้นานแค่ไหน แม้การ invalidate จะหายไป
- **throttle ที่ gateway และ back off ที่ client** `429` จาก gateway คือสัญญาณให้ client ช้าลง ไม่ใช่ให้ retry ทันที
- **พา trace context ไปไว้ใน event** ใส่มันไว้ใน message header เพื่อให้ครึ่งที่เป็น asynchronous โผล่ใน trace เดียวกับ request ที่ทำให้มันเกิด ส่วน OpenTelemetry ก็มี convention สำหรับ Kafka, SQS และ SNS
