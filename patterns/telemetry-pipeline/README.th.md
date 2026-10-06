## ปัญหา

เมื่อก่อน observability backend แต่ละตัวมาพร้อม stack สำหรับเก็บข้อมูลของตัวเอง: tracing library และ agent จาก vendor หนึ่ง, metrics client และ scraper จากอีกเจ้า และ log shipper จากเจ้าที่สาม instrumentation ถูกเขียนผูกกับ API ของ vendor การเปลี่ยน vendor เลยแปลว่าต้องแก้และ redeploy ทุก service และการรันสอง vendor คู่กันระหว่าง migrate ก็แปลว่าต้องทำ instrumentation สองรอบ policy อยู่ที่ไหนก็ตามที่ setting ของ SDK อยู่ แล้วเรื่องอย่าง attribute ไหนนับเป็นข้อมูลส่วนบุคคล จะ sample มากแค่ไหน และ telemetry ออกนอก network ได้ทางไหน ก็ถูกตัดสินแยกกันในหลายสิบ repository

telemetry ยังต้องรอดในวันที่แย่ด้วย ระบบที่มีปัญหาจะสร้าง telemetry มากกว่าปกติ ในจังหวะที่ backend มีโอกาสช้าหรือติดต่อไม่ได้มากที่สุด ถ้าระหว่างแอปพลิเคชันกับ backend ไม่มีอะไรที่ buffer, retry และลดโหลดได้ ก็มีแค่สองทาง: เสียข้อมูลที่อธิบาย incident ไป หรือปล่อยให้ exporter ค้างคั่งอยู่ข้างในแอปพลิเคชัน

## ทำงานยังไง

telemetry pipeline วาง process หนึ่งตัวที่ไม่ผูกกับ vendor ไว้ระหว่างแอปพลิเคชันกับ backend นั่นคือ **OpenTelemetry Collector** ส่วนแอปพลิเคชันก็ทำ instrumentation ครั้งเดียวด้วย API และ SDK ของ OpenTelemetry และพูด protocol เดียว ทุกอย่างที่เฉพาะกับ backend ตัวใดตัวหนึ่งย้ายไปอยู่ใน configuration ของ Collector

### Signal และ OTLP

OpenTelemetry เรียก telemetry แต่ละประเภทว่า **signal**

| Signal | อะไรที่ส่งไป | สถานะเมื่อ 2 ตุลาคม 2026 |
|---|---|---|
| Traces | span | API, SDK และ protocol stable แล้ว |
| Metrics | metric data point | API และ protocol stable แล้ว ส่วน specification ของ SDK ถูกระบุไว้ว่า *mixed* |
| Logs | log record | Bridge API, SDK และ protocol stable แล้ว |
| Profiles | profiling sample | เป็น public alpha ตั้งแต่ 26 มีนาคม 2026 ส่วนของมันใน OTLP ยังถูกระบุว่า *Development* |

Baggage ก็มี specification และ stable แล้วเหมือนกัน แต่มันคือ request context ที่แอปพลิเคชันอ่าน ไม่ใช่ telemetry ที่ pipeline ส่งต่อ

signal ทั้งหมดใช้ wire format เดียวกัน คือ **OpenTelemetry Protocol (OTLP)**: message แบบ Protobuf ที่ส่งเป็น gRPC call (port default **4317**) หรือเป็น HTTP request แบบ `POST` (port default **4318**, path `/v1/traces`, `/v1/metrics` และ `/v1/logs` โดย body เป็น Protobuf แบบ binary หรือ JSON) OTLP stable แล้วสำหรับ trace, metric และ log และ backend หลายตัวก็ ingest มันได้โดยตรง

ทุก OTLP request ได้คำตอบเสมอ คำตอบเป็นได้ทั้งสำเร็จ, *สำเร็จบางส่วน* ที่บอกว่ามีกี่ item ถูกปฏิเสธ หรือ error และ specification ก็ระบุ error ที่ client ควร retry ด้วย exponential backoff ไว้ เช่น gRPC `UNAVAILABLE` และ HTTP 429, 502, 503 และ 504 สัญญาข้อนี้แหละที่ทำให้ receiver ดันกลับไปที่ผู้ส่งได้ในขั้นที่ 4 ส่วน SDK จะ export ไปที่ `http://localhost:4318` เป็นค่า default (`:4317` สำหรับ gRPC) ทำให้แอปพลิเคชันที่ไม่ได้ตั้งค่า exporter อะไรเลยก็เจอ Collector ที่รันอยู่ข้าง ๆ

### ข้างใน Collector

Collector เป็น binary ตัวเดียวที่ขับด้วยไฟล์ YAML ไฟล์นี้ประกาศ component แล้วต่อพวกมันเข้าเป็น **pipeline** แต่ละ pipeline พา signal หนึ่งแบบ

- **Receiver** นำข้อมูลเข้ามา ใน diagram ใช้ `otlp` ส่วนตัวอื่นรับ format ที่เก่ากว่า (Zipkin, Jaeger) อ่านจาก Kafka หรือไปดึงข้อมูลมาเอง (ดู *เก็บของที่มีอยู่แล้ว*) ตัว receiver instance เดียวป้อนข้อมูลให้หลาย pipeline ได้
- **Processor** รันตามลำดับที่ pipeline เขียนไว้ และแต่ละ pipeline ได้ instance ของตัวเอง หน้าที่ของมันคือเติมข้อมูล, filter, sample, redact และ batch
- **Exporter** ส่งข้อมูลออกไป pipeline หนึ่งใส่ไว้หลายตัวได้ และแต่ละตัวได้สำเนาของตัวเอง ขั้นที่ 3 ส่งให้ tracing backend สองตัวพร้อมกันได้ก็ด้วยวิธีนี้
- **Connector** เชื่อมสอง pipeline เข้าด้วยกัน: มันเป็น exporter ของ pipeline หนึ่ง และเป็น receiver ของ pipeline ถัดไป ตัว `span_metrics` แปลง span เป็น metric ของ request, error และ duration ส่วน `routing` ส่งข้อมูลไปคนละ pipeline ตาม attribute
- **Extension** อยู่ข้าง ๆ เส้นทางของข้อมูล: health check, `pprof` และ zPages สำหรับ debug, authenticator และ `file_storage` สำหรับ queue ที่รอดจากการ restart

pipeline ของ trace ใน diagram ประกาศไว้แบบนี้:

```yaml
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, k8s_attributes, tail_sampling, redaction, batch]
      exporters: [otlp_grpc/current, otlp_grpc/new]
```

**ลำดับของ processor สำคัญ** แนวทางของโปรเจกต์คือให้ `memory_limiter` อยู่ตัวแรก ตามด้วยอะไรก็ตามที่ทิ้งข้อมูล (sampling, filtering) ขั้นถัด ๆ ไปจะได้ทำงานน้อยลง แล้วตามด้วย processor ที่ต้องใช้ context ของ request อย่าง `k8s_attributes` แล้วค่อยเป็นการแปลงและการเติมข้อมูล และ batch ไว้ท้ายสุด tail sampling เป็นข้อยกเว้นของกฎ *ทิ้งให้เร็ว* ที่มีเขียนไว้ในเอกสาร: มันจัดกลุ่ม span ใหม่เป็น batch ใหม่ แล้ว context นั้นก็หายไป มันเลยต้องมาหลัง `k8s_attributes` แบบที่เห็นในตัวอย่างนี้

### การเติมข้อมูล

telemetry มีประโยชน์ก็ต่อเมื่อมันบอกได้ว่ามาจากไหน SDK ตั้งค่า `service.name` ให้ แล้ว pipeline ก็เติมสิ่งที่แอปพลิเคชันไม่รู้ หรือไม่ควรต้องรู้ ตัว processor `k8s_attributes` หา pod ที่ส่งข้อมูลมา (ด้วย source IP ของ connection ถ้าไม่ได้สั่งเป็นอย่างอื่น) แล้วเติม resource attribute อย่าง `k8s.namespace.name`, `k8s.pod.name`, `k8s.pod.uid`, `k8s.deployment.name` และ `k8s.node.name` มันก็อป label และ annotation ของ pod มาได้ด้วย นี่เป็นวิธีหนึ่งในการตั้ง `deployment.environment.name` ส่วน processor `resource` ตั้งค่าคงที่ และ `resource_detection` อ่าน metadata ของ host และ cloud ทั้งนี้ให้ใช้ชื่อ attribute ตาม semantic convention และใช้ค่ามาตรฐานที่รู้จักกันถ้ามี (`production`, `staging`, `test` และ `development` สำหรับ environment) ทุก backend, dashboard และ alert จะได้พึ่ง key ชุดเดียวกันได้

### Head sampling หรือ tail sampling

**Head sampling** ตัดสินตอนที่ trace เริ่ม ใน SDK: เก็บ 10% ตาม trace ID แล้วบอก service ข้างล่างผ่าน flag sampled วิธีนี้ประหยัดและไม่มี state แต่มันตัดสินก่อนที่ใครจะรู้ว่า request จะพังหรือเปล่า

**Tail sampling** ตัดสินใน Collector หลังจาก span มาถึงแล้ว processor `tail_sampling` เก็บทุก trace ไว้ใน memory ตลอด decision window (`decision_wait` ค่า default 30 วินาที) แล้วค่อยใช้ policy ตัดสิน ส่วนสอง policy ใน diagram ก็เก็บทุก trace ที่มี error และหนึ่งในสี่ของที่เหลือ:

```yaml
tail_sampling:
  policies:
    - { name: errors, type: status_code, status_code: { status_codes: [ERROR] } }
    - { name: the-rest, type: probabilistic, probabilistic: { sampling_percentage: 25 } }
```

ราคาที่ต้องจ่ายคือการตัดสินต้องใช้ trace ทั้งเส้น ทำให้ span ทุกตัวของ trace เดียวกันต้องไปถึง Collector instance ตัวเดียวกัน ถ้ามี Collector ตัวเดียวก็เป็นแบบนั้นอยู่แล้ว แต่ถ้ามีหลายตัว [load balancer](../load-balancing/) ธรรมดาไม่พอ เพราะมันกระจาย span ของ trace เดียวไปหลาย instance ทางที่ใช้กันคือให้ Collector ชั้นแรกใช้ exporter `load_balancing` ที่ hash trace ID เพื่อเลือก sampling Collector หนึ่งตัว และมันหา Collector พวกนั้นจาก static list, DNS, Kubernetes API หรือ AWS Cloud Map

### Redaction และภาษาสำหรับ transform

มี processor สามตัวที่เอาข้อมูลออก ตัว `redaction` ทำงานจาก allow-list ของ attribute key (key ที่ไม่อยู่ในรายการจะถูกลบ มันเลย fail closed) และ mask ค่าที่ตรงกับ pattern อย่างเลขบัตร ตัว `attributes` ลบ, hash หรือเขียนใหม่ทีละ key ส่วน `transform` รัน statement ในภาษา **OpenTelemetry Transformation Language (OTTL)** ที่เป็นภาษาเล็ก ๆ สำหรับแก้ span, metric และ log แบบมีเงื่อนไข:

```yaml
transform:
  trace_statements:
    - delete_key(span.attributes, "user.email")
    - replace_pattern(span.attributes["url.query"], "token=[^&]*", "token=***")
```

processor `filter` ใช้เงื่อนไข OTTL ทิ้ง span, data point หรือ log record ทั้งตัว

### ความน่าเชื่อถือเมื่อเจอ back-pressure

มีสี่กลไกที่ตัดสินว่าจะเกิดอะไรขึ้นเมื่อ backend ช้าหรือล่ม พวกมันทำงานคนละอย่าง และแยกให้ออกจะช่วยได้มาก

| กลไก | อยู่ที่ไหน | เมื่อเจอ back-pressure |
|---|---|---|
| **Sending queue** | ใน exporter และเปิดเป็นค่า default ใน OTLP exporter | เก็บ batch ไว้ใน memory (1,000 request เป็นค่า default) ระหว่างที่ backend ใช้ไม่ได้ พอเต็มแล้วก็ปฏิเสธ batch ใหม่ของ exporter ตัวนั้น และ batch พวกนั้นก็ถูกทิ้ง เว้นแต่ `block_on_overflow` จะทำให้ pipeline รอ |
| **Retry on failure** | ใน exporter และเปิดเป็นค่า default ใน OTLP exporter | ส่ง batch ที่ fail ซ้ำหลังผ่านไปราว 5 s แล้วรอนานขึ้น 1.5 เท่าทุกครั้งจนถึง 30 s โดยการรอแต่ละครั้งสุ่มบวกลบครึ่งหนึ่ง มันยอมแพ้หลัง 5 นาที (`max_elapsed_time` ถ้าเป็น 0 คือไม่ยอมแพ้เลย) แล้วทิ้ง batch นั้น |
| **Persistent queue** | ต้องเปิดเอง และต้องมี storage extension | เก็บ queue ไว้บน disk ผ่าน `file_storage` ทำให้ batch ที่อยู่ใน queue รอดจากการ crash หรือ restart ของ Collector มันก็ยังมีขอบเขตอยู่ดี ทั้งจากขนาดของ queue และจาก disk |
| **Memory limiter** | processor ตัวแรกของทุก pipeline | ถ้าเกิน soft limit จะปฏิเสธข้อมูลที่เข้ามา ถ้าเกิน hard limit ก็บังคับให้ทำ garbage collection ด้วย มันปกป้อง process ไม่ได้ปกป้องข้อมูล |

ข้อมูลที่ memory limiter ปฏิเสธ จะไม่ได้ถูก Collector รับไว้และไม่ได้ถูกทิ้ง: error จะวิ่งกลับไปที่ receiver แล้ว receiver ก็รายงานไปที่ผู้ส่ง ตัว receiver `otlp` ตอบด้วย gRPC `UNAVAILABLE` หรือ HTTP 503 ที่ retry ได้ทั้งคู่ ผู้ส่งเลยเก็บ batch ไว้แล้วลองใหม่ทีหลัง ผู้ส่งตัวนั้นคือ SDK หรือ agent Collector ที่มี queue ของตัวเอง ข้อมูลจะหายก็ต่อเมื่อ buffer ของผู้ส่งล้น หรือ retry จนหมดแล้ว ยกตัวอย่าง batch span processor ของ SDK จะ queue span ได้ 2,048 ตัวเป็นค่า default และทิ้ง span เมื่อมันเต็ม ส่วน receiver ที่ดึงข้อมูลเองไม่มีผู้ส่งให้ดันกลับ มันต้องถือข้อมูลไว้หรืออ่านซ้ำเอง: อย่าง `file_log` จะหยุดรอแล้ว retry ก็ต่อเมื่อเปิด option `retry_on_failure` ไว้เท่านั้น

exporter แต่ละตัวมี queue ของตัวเอง ใน diagram ตัว tracing backend กับ metrics store เลยยังได้รับข้อมูลต่อไประหว่างที่ log store ล่ม แต่ก็แค่จนกว่า limiter จะทำงาน: มันดู memory ของทั้ง process พอมันปฏิเสธข้อมูล ก็ปฏิเสธทุก signal

### เก็บของที่มีอยู่แล้ว

ไม่ใช่ทุกอย่างพูด OTLP ตัว receiver `prometheus` scrape metrics endpoint ที่มีอยู่แล้วด้วย scrape configuration ปกติของ Prometheus ส่วน receiver `file_log` ตามอ่านและ parse ไฟล์ log เช่น container log บน node แล้ว `host_metrics` กับ `kubelet_stats` ก็อ่านจากเครื่องและจาก kubelet ตัว receiver แบบ *pull* พวกนี้ต่างจาก OTLP ในเรื่องสำคัญข้อหนึ่ง: replica สองตัวที่ configuration เหมือนกันจะเก็บทุกอย่างซ้ำสองรอบ ให้รัน instance เดียวต่อ node หรือให้มีอะไรสักอย่างแจก target ให้ (ดูหมายเหตุเรื่อง Kubernetes ข้างล่าง)

### Agent, gateway หรือทั้งสองแบบ

- **ไม่มี Collector** SDK export OTLP ตรงไปที่ backend
- **Agent** Collector ที่อยู่ข้าง workload โดยเป็น sidecar ใน pod หรือหนึ่งตัวต่อ node แอปพลิเคชันส่งข้อมูลให้เพื่อนบ้าน แล้ว agent ก็ติด metadata ของเครื่องให้ และเก็บ host metric กับไฟล์ log ได้ด้วย
- **Gateway** pool ของ Collector ที่เหมือนกันทุกตัวอยู่หลัง load balancer มีหนึ่ง endpoint ต่อ cluster หรือต่อ region ทำให้ policy, credential ของ backend และ egress อยู่ในที่เดียว
- **Agent ไป gateway** มีทั้งสอง tier แบบแถบข้างใต้ขั้นที่ 4

เพิ่ม tier ที่สองเมื่อมีอะไรที่ต้องทำจากศูนย์กลาง: tail sampling บน trace ที่ครบเส้น, กฎ redaction ที่ต้องใช้กับทุกทีม, credential ของ backend ที่ไม่ควรอยู่บนทุก node หรือ network ที่ยอมให้ออกข้างนอกได้แค่ไม่กี่จุด มันต้องแลกกับอีกหนึ่ง hop และอีกหนึ่งกลุ่มเครื่องที่ต้องดูแล เพราะฉะนั้น deployment ที่ไม่ต้องการเรื่องพวกนี้เลยจะเหมาะกับ agent อย่างเดียว หรือ gateway อย่างเดียวมากกว่า

## ใช้ตอนไหนดี

- เราส่ง telemetry ไปมากกว่าหนึ่ง backend หรือคาดว่าจะเปลี่ยน vendor การ migrate จะกลายเป็นช่วงเวลาที่ Collector export ไปทั้งสองที่
- policy ต้องใช้ได้ข้ามทีม: redaction, sampling rate, resource attribute ที่ต้องมี
- ยังไงก็ต้องเก็บ host metric, container log และ Prometheus endpoint อยู่แล้ว และอยากรัน agent ตัวเดียวมากกว่าสามตัว
- แอปพลิเคชันควรส่ง telemetry ออกไปให้เร็ว แล้วปล่อยเรื่อง batching, retry, compression และ credential ให้อย่างอื่นจัดการ
- network มีแค่ไม่กี่จุดที่คุยกับข้างนอกได้

**ตอนที่ไม่ควรเพิ่ม** ระบบเล็กที่ SDK export OTLP ไปที่ backend ตัวเดียวที่รับ OTLP ได้ ยังไม่ต้องมี Collector ตัว SDK ก็ batch และ retry ให้อยู่แล้ว และการ export ตรงก็เป็น deployment pattern ที่มีในเอกสาร ให้เพิ่ม Collector เมื่อความต้องการแบบ cross-cutting ตัวแรกโผล่มา: backend ตัวที่สอง, redaction, tail sampling หรือ telemetry ของ host เพราะแอปพลิเคชันพูด OTLP อยู่แล้วไม่ว่าทางไหน การเพิ่มมันทีหลังก็แค่เปลี่ยน endpoint ไม่ต้องแก้ instrumentation

## ได้อะไร เสียอะไร

- **มันคือระบบ production อีกระบบหนึ่ง** Collector ต้องมีการวางแผน capacity, การอัปเกรด (มี release ทุกสองสัปดาห์), การจัดการ configuration และ monitoring ของตัวเอง ถ้ามันป่วย เราก็มองไม่เห็นอะไรเลย ตรงจังหวะที่อยากเห็นที่สุดพอดี
- **ค่า default ไม่ durable** sending queue อยู่ใน memory พอ crash ก็เสียทุกอย่างที่อยู่ใน queue และ outage ที่นานก็ทำให้มันล้น ส่วน persistent queue หรือ broker ระหว่าง tier (Kafka topic ที่ใช้ exporter และ receiver `kafka` ตามแนวคิดเบื้องหลัง [queue-based load leveling](../queue-based-load-leveling/)) ช่วยลดช่องว่างได้แต่ปิดไม่ได้ telemetry pipeline ถูกสร้างมาให้ยอมเสียข้อมูลก่อนจะไปทำร้าย workload เพราะฉะนั้นให้ตัดสินใจไว้ว่าข้อมูลไหนหายได้
- **Tail sampling มี state และแพง** memory โตตามจำนวน trace ที่กำลังวิ่งอยู่และตาม decision window การ scale ต้อง route ตาม trace ID การเปลี่ยนจำนวน sampling instance ทำให้ trace ที่กำลังวิ่งอยู่ถูก map ใหม่ และ span ที่มาถึงหลังการตัดสินก็อาจพลาดไป
- **Sampling บิดเบือนทุกอย่างที่คำนวณทีหลัง** request rate และ latency percentile ที่คิดจาก span ที่ถูก sample แล้วจะผิด ให้คำนวณ metric พวกนี้ก่อนถึง sampler เช่น ใช้ `span_metrics` ใน pipeline ที่ยังเห็นทุก span หรือเอามาจาก metric จริง
- **pipeline กลางก็มี blast radius กลาง** filter หรือกฎ redaction ที่ผิดตัวเดียวทิ้งหรือทำ telemetry เสียหายให้ทุกคนพร้อมกัน เก็บ configuration ไว้ใน version control เช็กด้วย `otelcol validate` แล้ว roll out เป็นขั้น ๆ
- **การเติมข้อมูลขึ้นกับว่ามันรันอยู่ที่ไหน** gateway เห็น IP address ของ agent ไม่ใช่ของ pod ตัว `k8s_attributes` เลยควรอยู่ใน agent ไม่งั้น agent ก็ต้องส่ง IP ของ pod ต่อไปด้วย (โหมด `passthrough` ของมันทำแบบนี้)
- **ความ mature ไม่เท่ากัน** component ของ OTLP stable แล้ว แต่ที่เหลือส่วนใหญ่เป็น beta หรือ alpha และชื่อกับค่า default ก็ยังเปลี่ยนไปมาระหว่าง release

## ข้อควรรู้ตอนลงมือทำ

- **โปรเจกต์อยู่ตรงไหนแล้ว (เช็กเมื่อ 2 ตุลาคม 2026)** OpenTelemetry graduate ใน CNCF เมื่อ 11 พฤษภาคม 2026 หลังเข้าร่วมในปี 2019 และขึ้นเป็น incubation ในปี 2021 ตัว Collector ยังอยู่ที่ release 0.x (v0.162.0 ของวันที่ 28 กันยายน 2026) และเอกสารของมันเรียก stability ของมันว่า *mixed* เพราะทุก component ประกาศระดับของตัวเองแยกตาม signal ใน v0.162.0 ตัว receiver `otlp` และ exporter `otlp_grpc` กับ `otlp_http` stable แล้วสำหรับ trace, metric และ log และเป็น alpha สำหรับ profile ส่วน `k8s_attributes` stable แล้ว ตัว `memory_limiter`, `batch`, `tail_sampling`, `transform`, `resource` และ `file_storage` เป็น beta เช่นเดียวกับ `load_balancing` สำหรับ trace และ log ส่วน `redaction` เป็น beta สำหรับ trace และเป็น alpha สำหรับ metric และ log ส่วน `filter` กับ connector `span_metrics` และ `routing` เป็น alpha
- **ชื่อ component เพิ่งเปลี่ยน** component กำลังถูกเปลี่ยนชื่อเป็น snake_case และชื่อเก่ายังอยู่เป็น alias ที่ deprecated แล้ว: exporter `otlp` และ `otlphttp` กลายเป็น `otlp_grpc` และ `otlp_http` (v0.144.0), `k8sattributes` กลายเป็น `k8s_attributes` (v0.146.0), `filelog` กลายเป็น `file_log` (v0.149.0) และ `hostmetrics` กลายเป็น `host_metrics` (v0.151.0) ส่วน `load_balancing`, `span_metrics` และ `resource_detection` ก็ถูกเปลี่ยนชื่อแบบเดียวกัน ตัวอย่างส่วนใหญ่ที่หาเจอยังใช้ชื่อเก่าอยู่
- **Batching กำลังย้ายเข้าไปอยู่ใน exporter** `batch` ยังเป็นตัวสุดท้ายในลำดับที่แนะนำ แต่ตอนนี้แนวทางชอบให้ใช้ batching ของ exporter เองมากกว่าถ้ามี (`sending_queue::batch` ปิดไว้เป็นค่า default) ส่วน processor `queue_batch` ที่ตั้งใจมาแทน `batch` มาใน v0.158.0 ที่ stability ระดับ *development* และยังไม่อยู่ใน distribution ไหนเลย
- **Distribution** โปรเจกต์เผยแพร่ `otelcol` (core มี component ชุดเล็ก ๆ), `otelcol-contrib` (ทุกอย่าง ราว 240 component), `otelcol-k8s`, `otelcol-otlp` (OTLP เข้าและออก ไม่มีอย่างอื่น), `otelcol-ebpf-profiler` และตัวใหม่ใน v0.162.0 ที่ยังเป็น experimental คือ `otelcol-prometheus` (Prometheus exporter ไม่กี่ตัวที่ฝังไว้เป็น metrics receiver) ตัว pipeline ใน diagram ต้องใช้ contrib หรือ k8s เพราะ `tail_sampling`, `k8s_attributes` และ `redaction` ไม่อยู่ใน core สำหรับ production ให้ build เองด้วย OpenTelemetry Collector Builder (`ocb`): manifest ระบุ component แล้วผลที่ได้คือ binary ที่เล็กกว่าและมี attack surface เล็กกว่า ส่วน vendor หลายเจ้าก็ ship distribution ของตัวเองด้วย
- **การตั้งค่า memory limiter** ให้เช็กทุกวินาที (`check_interval: 1s`) ตั้ง hard limit ไว้ต่ำกว่า limit ของ container เป็น MiB หรือเป็นเปอร์เซ็นต์ และปล่อยค่าเผื่อ spike ไว้ใกล้ค่า default ที่ 20% เอกสารของ limiter ยังแนะนำให้ตั้ง `GOMEMLIMIT` ไว้ที่ 80% ของ hard memory limit ของ Collector ทำให้ Go runtime เก็บ garbage หนักขึ้นก่อนที่ process จะไปถึงจุดนั้น
- **Kubernetes เป็นตัวอย่าง** OpenTelemetry Operator จัดการ Collector ผ่าน resource `OpenTelemetryCollector` ที่มี `mode` เป็น `deployment` (ค่า default), `daemonset`, `statefulset` หรือ `sidecar` รูปแบบที่เจอบ่อยคือ DaemonSet ของ agent สำหรับ log ของ node, metric ของ kubelet และของ host และ OTLP ภายในเครื่อง, Deployment ของ gateway หลัง Service และ StatefulSet สำหรับ scrape Prometheus โดยมี Target Allocator ของ operator คอยกระจาย scrape target ไปตาม replica โหมด sidecar จะ inject Collector เข้าไปใน pod ที่มี annotation `sidecar.opentelemetry.io/inject` โหมดนี้เหมาะกับ platform ที่รัน agent ต่อ node ไม่ได้ ตัว operator ยัง inject auto-instrumentation ได้ด้วย และมี Helm chart ทั้งสำหรับ Collector และ operator
- **Security** ตั้งแต่ v0.110.0 server ของ Collector bind กับ `localhost` เป็นค่า default ถ้าอยู่ใน pod ให้ bind receiver กับ IP ของ pod แทน `0.0.0.0` เปิด TLS ให้ receiver และ exporter (`client_ca_file` บน receiver ทำให้มันเป็นแบบ mutual) แล้ว authenticate ด้วย authenticator extension: bearer token และ basic auth ใช้ได้ทั้งสองฝั่ง, OIDC สำหรับ receiver และ OAuth2 client credentials สำหรับ exporter ส่วน API key ของ backend ให้เอาออกจากไฟล์ด้วย `${env:NAME}` และเอาออกจาก agent ด้วยการเก็บไว้ที่ gateway แล้วรันด้วย user ที่ไม่ใช่ root และให้ RBAC แคบที่สุดเท่าที่ processor ต้องใช้
- **อย่าให้ secret หลุดเข้าไปใน telemetry** ด่านแรกคืออย่าบันทึกมันตั้งแต่ต้น: ไม่มี token, password หรือ request body ทั้งก้อนใน span attribute และบรรทัด log ส่วน pipeline คือด่านที่สอง allow-list จับสิ่งที่ developer จะเพิ่มเข้ามาเดือนหน้าได้ แต่ block-list จับได้แค่สิ่งที่เราคิดถึงไว้แล้ว
- **คุมค่าใช้จ่าย** ปริมาณคือตัวบิล ให้ sample trace (head sampling เพื่อลดปริมาณ ส่วน tail sampling เพื่อเก็บ trace ที่ควรเก็บ) ทิ้ง log และ span ที่ไม่มีใครอ่านด้วย `filter` และเอา attribute ที่ cardinality สูงออกจาก metric เพราะทุกชุดค่าของ attribute ที่ไม่ซ้ำกันคือ time series แยกหนึ่งเส้น user ID ที่เป็น metric attribute จะคูณทุก series ด้วยจำนวน user
- **เฝ้าตัว Collector เองด้วย** มันเปิด metric ของตัวเองในรูปแบบ Prometheus ที่ port 8888 และ push ผ่าน OTLP ได้ ตั้ง alert เมื่อ `otelcol_exporter_queue_size` เข้าใกล้ `otelcol_exporter_queue_capacity` และเมื่อเจอ `otelcol_exporter_send_failed_*`, `otelcol_exporter_enqueue_failed_*` และ `otelcol_receiver_refused_*` ให้ scale gateway ที่ stateless ออกตามสัญญาณพวกนี้ด้วย [autoscaler](../autoscaling/) แต่อย่าทำตอนที่ backend เป็นคอขวด: Collector ที่มากขึ้นก็แค่ดันหนักขึ้นใส่ backend ที่ช้าอยู่แล้ว
- **ทางเลือกอื่น ยกตัวอย่าง** agent ของ vendor เองเก็บข้อมูลให้ backend ตัวเดียว และเป็นตัวเลือกที่ง่ายที่สุดถ้าจะอยู่กับ vendor นั้นไปเลย และ vendor หลายเจ้าก็เผยแพร่ distribution ของ Collector ของตัวเองด้วย เครื่องมือ pipeline อเนกประสงค์อย่าง Fluent Bit และ Vector ก็มี input และ output แบบ OpenTelemetry เหมือนกัน Collector เป็นตัวเลือกที่เป็นธรรมชาติที่สุดเมื่อแอปพลิเคชันพูด OTLP อยู่แล้ว และเราอยากได้ทั้งสาม signal ใน process เดียวที่ไม่มี backend vendor เจ้าไหนเป็นเจ้าของ
- **Pattern ที่เกี่ยวข้อง** [Distributed tracing](../distributed-tracing/) อธิบาย span ที่ pipeline นี้ส่งต่อ ส่วน [SLO และ error budget](../slo-error-budgets/) อธิบายว่าจะทำอะไรกับ metric แล้ว [service mesh](../service-mesh/) ก็เป็นแหล่งข้อมูลอีกแหล่ง: proxy ของมันส่ง trace, metric และ access log ออกมาให้ Collector รับได้
