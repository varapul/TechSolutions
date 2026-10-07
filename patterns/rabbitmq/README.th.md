## ปัญหา

ทุก order ใน Acme Shop มีงานที่ต้องทำตามมา: อีเมลยืนยัน การจองกับคลังสินค้าในไทยเมื่อ order นั้นส่งในประเทศไทย และ audit record สำหรับทุกอย่าง ถ้าทำงานพวกนี้ภายใน request ของ checkout ลูกค้าก็ต้องรอส่วนที่ช้าที่สุด แล้ว mail server หรือ API ของคลังสินค้าที่ช้าก็จะกลายเป็น checkout ที่ fail ส่วนการเรียก worker แต่ละตัวตรง ๆ ก็ไม่ได้ดีกว่า: service Orders ต้องรู้จัก worker ทุกตัว และ order ที่เข้ามาเป็นชุดใหญ่ก็จะไปถึง worker ทุกตัวในเวลาเดียวกัน

message broker มาอยู่ตรงกลาง ตัว Orders ส่ง event แต่ละตัวให้ RabbitMQ แล้วตอบลูกค้าไปเลย ส่วน RabbitMQ เก็บ event ไว้ คิดว่า worker ตัวไหนต้องได้สำเนา แล้วส่งงานให้ worker แต่ละตัวเมื่อ worker พร้อมรับ

## ทำงานยังไง

RabbitMQ implement โมเดลของ AMQP 0-9-1 และ diagram ก็ใช้ศัพท์ของโมเดลนี้:

- **Publisher** ส่ง message ไปที่ **exchange** ไม่เคยส่งตรงไปที่ queue แล้ว message แต่ละตัวก็มี **routing key** ติดไปด้วย ในที่นี้คือคำที่คั่นด้วยจุด อย่าง `order.created.th`
- ประเภทของ exchange เป็นตัวกำหนดว่ามันจะ route ยังไง exchange แบบ **direct** ส่งไปที่ queue ที่ binding key เท่ากับ routing key ส่วนแบบ **topic** จับคู่ตาม pattern โดยที่ `*` แทนหนึ่งคำพอดี และ `#` แทนศูนย์คำขึ้นไป แบบ **fanout** ก็อป message ทุกตัวไปทุก queue ที่ bind ไว้ และแบบ **headers** จับคู่จาก header ของ message แทน key นอกจากนี้ยังมี default exchange ที่ไม่มีชื่อ ตัวนี้ส่งไปที่ queue ที่ชื่อตรงกับ routing key
- **binding** เชื่อม exchange กับ queue ด้วย key หรือ pattern ถ้า message ตรงกับหลาย binding ก็จะถูกก็อปไปลงทุก queue เหล่านั้น ส่วนตัวที่ไม่ตรงกับอะไรเลยจะถูกทิ้ง ถูกส่งไปที่ alternate exchange ถ้าตั้งไว้ หรือถูกส่งคืน publisher ถ้า publish แบบ `mandatory`
- **queue** เก็บ message ตามลำดับไว้จนกว่า consumer จะประมวลผลเสร็จ RabbitMQ 4.x มีสามประเภท: queue แบบ **classic** (สำเนาเดียว บน node เดียว), แบบ **quorum** (replicate ด้วย Raft และเป็นประเภทที่ควรใช้เมื่อข้อมูลสำคัญ) และ **stream** (log แบบ append-only ที่ consumer อ่านได้โดยไม่ลบอะไรออก)
- **Consumer** subscribe แล้ว broker ก็ push message ไปให้ ได้มากสุดเท่าจำนวน message ที่ยังไม่ acknowledge ที่ **prefetch** (`basic.qos`) ของ consumer ยอมให้ถือ พอทำงานเสร็จ consumer ก็ acknowledge ด้วย `basic.ack` แล้ว message ก็ถูกลบ ส่วน `basic.reject` กับ `basic.nack` จะคืน message กลับไป ให้ requeue หรือถ้าปิด requeue ก็ให้ dead-letter หรือทิ้งไป ถ้า channel หรือ connection ปิดตอนที่ยังถือ message ที่ไม่ acknowledge อยู่ RabbitMQ จะ requeue message พวกนั้น แล้วส่งใหม่โดยตั้ง flag `redelivered` ไว้ delivery เลยเป็นแบบ at least once
- **Publisher confirm** (`confirm.select`) ดูแลอีกทิศทางหนึ่ง: broker จะ acknowledge message เมื่อทุก queue ที่ message ถูก route ไปรับมันแล้ว สำหรับ quorum queue หมายถึง replica ส่วนใหญ่ของมัน

quorum queue คือที่มาของพฤติกรรมในขั้นที่ 3 และ 4 แต่ละตัวมี leader กับ follower อยู่คนละ node (default สามสมาชิก ตั้งได้ด้วย `x-quorum-initial-group-size`) ทำให้ queue ที่อยู่บนสาม node ยังทำงานต่อได้ และเก็บทุก message ที่ confirm แล้วไว้ครบ ตอนที่เสีย node ไปหนึ่งตัว ส่วน follower ที่กลับมาจะ replicate ต่อจากจุดที่หยุดไป โดยไม่ต้องไล่ตามแบบที่ classic mirrored queue เคยต้องทำ ตัว mirroring ถูก deprecate ในปี 2021 และถูกเอาออกใน RabbitMQ 4.0 เหลือแค่ quorum queue กับ stream ที่เป็นประเภทที่ replicate ได้

quorum queue ยังนับการส่งที่ fail ไว้ใน header `x-delivery-count` ด้วย ตั้งแต่ RabbitMQ 4.0 ตัว **delivery limit** มี default เป็น 20: พอตัวนับเกินค่านี้ queue ก็จะทิ้ง message หรือ dead-letter มันถ้าตั้ง **dead-letter exchange** (DLX) ไว้ นอกจากนี้ message ยังถูก dead-letter ได้อีกตอนที่ consumer reject มันโดยไม่ requeue ตอนที่ TTL หมด (policy `message-ttl` หรือ property `expiration` ต่อ message) และตอนที่ length limit ดันมันออก ส่วน header `x-death` จะบันทึกว่าเพราะอะไร

ส่วนที่เหลือของโมเดล สั้น ๆ:

- **Priority** ใน classic queue ใช้ได้เมื่อประกาศด้วย `x-max-priority` และเอกสารแนะนำให้มีแค่ไม่กี่ระดับ ส่วน quorum queue ได้ priority มาใน 4.0 และได้ strict priority 32 ระดับ (0 ถึง 31) ใน 4.3 ส่วน stream ไม่มีเลย
- **Request-reply** ฝั่ง client ตั้ง `reply_to` (จะส่งคำตอบไปที่ไหน) และ `correlation_id` (ไว้จับคู่คำตอบกับ request ของมัน) ส่วน Direct Reply-To (`amq.rabbitmq.reply-to`) ทำได้โดยไม่ต้องมี reply queue
- **Protocol** มี AMQP 0-9-1 และ AMQP 1.0 ที่เป็น core protocol และเปิดไว้เสมอตั้งแต่ 4.0 ส่วน MQTT 3.1, 3.1.1 และ 5.0 กับ STOMP 1.0 ถึง 1.2 มาเป็น plugin ที่แถมมากับ server และ stream ก็มี binary protocol ของตัวเองด้วย
- **Cluster** ทุก node แชร์ metadata (virtual host, user, exchange, queue, binding, policy) กันผ่าน metadata store ตัว Khepri ที่ใช้ Raft เป็นฐาน กลายเป็น default สำหรับ cluster ใหม่ใน 4.2 และเป็น store ตัวเดียวใน 4.3 ที่เอา Mnesia ออกไป ตอนนี้ cluster จะ available ได้ก็ต่อเมื่อ node ส่วนใหญ่ยังรันอยู่
- **เวอร์ชันและ license** ซีรีส์ 4.3 เป็นตัวปัจจุบัน (4.3.6 ออกเมื่อกันยายน 2026) ตัว server และ core plugin เป็น open source ภายใต้ Mozilla Public License 2.0

## อยู่ตรงไหนใน solution

- **งานเบื้องหลังที่อยู่หลัง web หรือ API tier** แบบ Acme Shop: request publish แล้ว return ไปเลย ส่วน worker ก็ส่งอีเมล render เอกสาร หรือเรียก partner ที่ช้า นี่คือ [Web-Queue-Worker](../web-queue-worker/) โดยที่ queue รับ traffic ที่มาเป็นชุดเหมือนใน [Queue-Based Load Leveling](../queue-based-load-leveling/) และมี email-1 กับ email-2 แชร์ queue เดียวกันแบบ [Competing Consumers](../competing-consumers/)
- **Route event ตามเนื้อหา** topic exchange หนึ่งตัว กับ queue หนึ่งตัวต่อ service ที่สนใจ โดย bind ไว้กับ key ที่ service นั้นต้องการ: [Publish-Subscribe](../publish-subscribe/) ที่ให้ broker เป็นคน filter และเป็น backbone ที่ใช้กันบ่อยของ [Event-Driven Architecture](../event-driven-architecture/)
- **Request-reply ระหว่าง service** ด้วย `reply_to` และ `correlation_id` ถ้าเป็นงานที่ใช้เวลานานกว่าที่ client ควรรอ ให้ดู [Asynchronous Request-Reply](../asynchronous-request-reply/)
- **Task queue ให้ framework** Celery ใช้ RabbitMQ เป็น default broker และประกาศ quorum queue ได้ (`task_default_queue_type = "quorum"`)
- **อุปกรณ์** ที่ publish ผ่าน plugin MQTT เข้า exchange เดียวกับที่ service อ่านอยู่

มันยัง implement หรือช่วยรองรับ [Dead-Letter Queue](../dead-letter-queue/) (DLX บวกกับ delivery limit), [Priority Queue](../priority-queue/), [Idempotent Consumer](../idempotent-consumer/) (ต้องมีเพราะ delivery เป็นแบบ at least once), [Retry with Backoff](../retry-with-backoff/) (delayed retry ของ quorum queue ใน 4.3), [Claim Check](../claim-check/) สำหรับ payload ที่ใหญ่เกินขนาด message สูงสุด (default 16 MiB ตั้งแต่ 4.0) และ [Transactional Outbox](../transactional-outbox/) สำหรับ publish อย่างเชื่อถือได้จาก database transaction

เพื่อนบ้านที่มักเจอคือ service ที่ publish, worker deployment ที่ consume และมัก scale ตามความยาวของ queue (เช่นใช้ RabbitMQ scaler ของ KEDA บน [Kubernetes](../kubernetes/)), [Prometheus](../prometheus/) กับ Grafana ผ่าน plugin `rabbitmq_prometheus` ที่แถมมากับ server และ load balancer ที่อยู่หน้า node

Managed offering: **Amazon MQ for RabbitMQ** รองรับ RabbitMQ 4.3 และ 4.2 (บน instance mq.m7g) และ 3.13 ณ ตุลาคม 2026 โดยจะเป็น broker แบบ single-instance ใน Availability Zone เดียว หรือ cluster สาม node ข้าม Availability Zone ก็ได้ โดยทั้งสองแบบอยู่หลัง Network Load Balancer และมันไม่รองรับ stream ส่วน **CloudAMQP** เป็น RabbitMQ service แบบ hosted

## ใช้ตอนไหนดี

เลือก RabbitMQ เมื่อ message แต่ละตัวเป็นงานหรือการแจ้งเตือนที่จบเมื่อประมวลผลเสร็จ และคุณอยากให้ broker route มัน ติดตาม acknowledgement ของทุก message และแยกตัวที่ fail ซ้ำ ๆ ออกไปไว้ต่างหาก: background job, event ที่ route ไปหา service ที่ต้องการ และ request-reply

| | RabbitMQ 4.3 | [Apache Kafka](../kafka/) 4.3 | [Amazon SQS](../amazon-sqs/) |
|---|---|---|---|
| โมเดล | exchange route message เข้า queue | log ของ record ที่แบ่ง partition และมี replica | managed queue |
| Consumer | ถูก push ให้ได้ถึง prefetch limit แล้ว ack ทีละ message | pull record และจำตำแหน่งของตัวเอง (offset) | poll แล้วลบ message แต่ละตัวเมื่อเสร็จ |
| หลังประมวลผล | ลบเมื่อ ack (ส่วน stream เก็บไว้) | เก็บไว้จนหมด retention (default 7 วัน) และอ่านซ้ำได้ | consumer เป็นคนลบ |
| Routing | exchange แบบ direct, topic, fanout และ headers | topic และ partition ที่ producer เป็นคนเลือก | ใน queue ไม่มี ต้อง fan out ด้วย [SNS](../amazon-sns/) หรือ [EventBridge](../amazon-eventbridge/) |
| ลำดับ | ต่อ queue จนกว่าจะมี consumer หลายตัวหรือมีการ redeliver | ต่อ partition | best effort (standard) และต่อ message group (FIFO) |
| Poison message | quorum queue: delivery limit (default 20) แล้วไปที่ dead-letter exchange | แล้วแต่แอป ส่วน share group จำกัดจำนวนครั้งที่ลองได้ | `maxReceiveCount` แล้วไปที่ dead-letter queue |
| การรัน | cluster ของคุณเอง, Amazon MQ หรือ CloudAMQP | broker ของคุณเอง หรือ service อย่าง Amazon MSK | AWS ดูแลให้ทั้งหมด |

เลือกอย่างอื่นเมื่อ consumer ต้องอ่านประวัติซ้ำหรือเริ่มใหม่ตั้งแต่ต้น (Kafka หรือ RabbitMQ stream) เมื่อคุณรันบน AWS แล้วอยากได้ queue ธรรมดาที่ไม่ต้องดูแล broker (SQS โดยใช้ SNS หรือ EventBridge ทำ fan out) หรือเมื่อลำดับต้องคงที่แบบเคร่งครัดข้าม consumer หลายตัวที่ทำงานขนาน (Kafka partition หรือ single active consumer หนึ่งตัวต่อ key)

## ได้อะไร เสียอะไร

- **At least once** การล่ม, connection ที่หลุด, timeout และการ requeue ล้วนทำให้เกิดการส่งซ้ำ message เดียวกันเลยอาจถูกประมวลผลสองครั้ง และ consumer ต้อง idempotent ตัว flag `redelivered` บอกแค่ว่า message อาจเคยถูกเห็นมาก่อน ส่วน `x-delivery-count` บอกว่าส่งไม่สำเร็จมาแล้วกี่ครั้ง
- **Replay ไม่ได้** message ที่ acknowledge แล้วจะถูกลบ ส่วน stream เก็บ message ไว้จนหมด retention และให้ consumer เริ่มจาก offset ไหนก็ได้ แต่ classic กับ quorum queue ทำแบบนั้นไม่ได้
- **ลำดับคงที่ต่อ queue ไม่ใช่ต่อ workload** message ที่ publish บน channel เดียวจะเข้า queue ตามลำดับนั้น และ consumer ตัวเดียวก็จะได้รับตามลำดับนั้น ส่วนการมี consumer หลายตัว การ redeliver และ priority ล้วนเปลี่ยนลำดับที่ message ถูกประมวลผล ถ้าลำดับต่อ order ID สำคัญ ให้ใช้ single active consumer หรือแยก message ตาม key ไปหลาย queue (exchange แบบ `x-modulus-hash`) โดยแต่ละ queue มี active consumer ตัวเดียว
- **queue ที่ยาวกิน memory** quorum queue เก็บ metadata อย่างน้อย 32 byte ไว้ใน memory ต่อทุก message ที่มันถืออยู่ ประมาณ 1 MB ต่อ 30,000 message ไม่ว่า message จะใหญ่แค่ไหน พอ memory ที่ node ใช้ไปถึง high watermark (default ราว 60% ของ RAM) หรือพื้นที่ disk ว่างต่ำกว่า limit (default 50 MB) ตัว RabbitMQ จะบล็อก connection ที่ publish อยู่จนกว่า alarm จะหาย การทำให้ queue สั้นอยู่เสมอคือวิธีที่ดีที่สุดในการคุม memory ให้ต่ำ
- **ต้องมีคนดูแล** ขนาด cluster, สมาชิกของ quorum queue, การ upgrade (เฉพาะ cluster 4.2.x เท่านั้นที่ upgrade แบบ in place ไป 4.3 ได้) และ capacity เป็นเรื่องของคุณ เว้นแต่จะมี managed service รับไปทำให้

## ข้อควรรู้ตอนลงมือทำ

- **เก็บ topology ไว้ในโค้ดหรือ definitions และเก็บค่าที่ปรับได้ไว้ใน policy** แอปประกาศ exchange, queue และ binding ของตัวเอง หรือให้ node import ไฟล์ definitions ตอน boot ส่วน setting ที่ operator อาจอยากเปลี่ยน อย่าง dead-letter exchange กับ delivery limit ควรอยู่ใน policy ไม่ใช่ hard-code ไว้เป็น argument `x-` ตัวอย่างสำหรับ Acme Shop:

  ```bash
  rabbitmqctl set_policy orders-qq '^(email|fulfilment-th|audit)$' \
    '{"dead-letter-exchange": "orders.dlx", "delivery-limit": 20}' \
    --apply-to quorum_queues
  ```

- **Consumer** ใน Python ด้วย pika (client ที่ tutorial ของ RabbitMQ ใช้):

  ```python
  import pika

  conn = pika.BlockingConnection(pika.ConnectionParameters("rabbitmq.internal"))
  ch = conn.channel()
  ch.exchange_declare("orders", exchange_type="topic", durable=True)
  ch.queue_declare("email", durable=True, arguments={"x-queue-type": "quorum"})
  ch.queue_bind("email", "orders", routing_key="order.created.*")
  ch.basic_qos(prefetch_count=10)  # at most 10 unacked deliveries to this consumer

  def on_message(ch, method, properties, body):
      try:
          send_email(body)  # may run twice for one order: make it idempotent
      except TemporaryFailure:
          ch.basic_reject(method.delivery_tag, requeue=True)  # counts toward delivery-limit
      else:
          ch.basic_ack(method.delivery_tag)

  ch.basic_consume("email", on_message)
  ch.start_consuming()
  ```

  publisher เรียก `ch.confirm_delivery()` ครั้งเดียว หลังจากนั้น `basic_publish` จะรอ confirm จาก broker และ raise exception ถ้า broker nack message นั้น หรือส่งคืนมาเพราะ publish ด้วย `mandatory=True` แต่ไม่ตรงกับ queue ไหนเลย
- **Reject, nack และ delivery limit** ตั้งแต่ 4.3 มีแค่ความล้มเหลวจริง ๆ ที่นับรวมใน limit: `basic.reject`, consumer ที่ล่ม และ connection ที่หลุด ส่วน `basic.nack` แบบ requeue หรือ consumer timeout จะคืน message โดยไม่เพิ่ม `x-delivery-count` ทำให้ consumer ที่ nack poison message ซ้ำไปเรื่อย ๆ ไม่มีวันถึง limit นอกจากนี้ 4.3 ยังเพิ่ม **delayed retry** ให้ quorum queue ด้วย (`delayed-retry-type`, `delayed-retry-min`, `delayed-retry-max`) ที่กัน message ที่ถูกคืนมาไว้นอกวงจรนานขึ้นเรื่อย ๆ หลังแต่ละครั้งที่ fail
- **Dead-lettering เป็นแบบ at most once โดย default** สำหรับ quorum queue ส่วนถ้าทุก dead letter สำคัญ ให้ตั้ง `dead-letter-strategy` เป็น `at-least-once` และต้องตั้ง `overflow` เป็น `reject-publish` ด้วย
- **Prefetch** ตั้งให้ต่ำสำหรับงานที่ช้า (ที่นี่ใช้ 1 สำหรับ fulfilment worker กับ audit worker ที่งานใช้เวลาหลายวินาที) และสูงขึ้นสำหรับงานที่เร็ว ตัว quorum queue จำกัดไว้ที่ 2,000 และเอกสารบอกว่า prefetch 2,000 ให้ throughput ของ consumer พอ ๆ กับ 300 ส่วน quorum queue ไม่รองรับ prefetch แบบ global (ต่อ channel) เลยต้องตั้งต่อ consumer
- **Consumer timeout** ถ้า delivery ค้างไม่ได้ acknowledge นาน 30 นาที (ค่า default) ก็จะถูกคืนกลับเข้า queue ส่วนตั้งแต่ 4.3 ตัว timeout นี้ใช้กับ quorum queue เท่านั้น และตั้งต่อ queue หรือต่อ consumer ก็ได้
- **ต้องดูอะไรบ้าง** ต่อ queue ให้ดู `messages_ready` (รออยู่) และ `messages_unacknowledged` (ส่งไปแล้วแต่ยังไม่ ack) เช่นด้วย `rabbitmqctl list_queues name messages_ready messages_unacknowledged` หรือ metric ของ Prometheus แล้วก็ดูจำนวน consumer, alarm ของ memory กับ disk และการเปิดปิด connection กับ channel ที่ถี่เกินไป ส่วน connection กับ channel ควรอยู่ได้นาน: เปิดครั้งเดียวแล้วใช้ซ้ำ ไม่ใช่เปิดใหม่ทุก message
- **กำหนดขนาด quorum queue** สามสมาชิกทนการเสีย node ได้หนึ่งตัว ห้าสมาชิกทนได้สองตัว ส่วนสมาชิกตัวที่สี่ไม่ได้ช่วยให้ทนได้มากกว่าสามตัว แล้ว quorum queue ทุกตัวบน node เดียวกันก็แชร์ write-ahead log ที่ default จุได้ 512 MiB (`raft.wal_max_size_bytes`) และเอกสารแนะนำให้แต่ละ node มี memory อย่างน้อยสามถึงสี่เท่าของขนาดนั้น
