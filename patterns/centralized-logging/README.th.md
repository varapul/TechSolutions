## ปัญหา

ในระบบที่มีหลาย service ตัว request หนึ่งตัวทิ้ง log ไว้ไม่กี่บรรทัดในทุก service ที่มันวิ่งผ่าน และแต่ละ service ก็รันอยู่หลาย instance พอ request พัง เรื่องราวของมันก็กระจายอยู่ในไฟล์บนหลายเครื่อง แต่ละ service เขียนด้วย format ของตัวเอง และในบรรทัดก็ไม่มีอะไรบอกเลยว่ามันเป็นของ request เดียวกัน จะหามันเจอก็ต้องเปิดเข้าไปทีละเครื่อง ค้นทีละไฟล์ แล้วเดาจาก timestamp ว่าบรรทัดไหนไปกับบรรทัดไหน

ไฟล์พวกนี้ก็ไม่ได้ปลอดภัยอยู่ที่เดิมด้วย instance ถูกแทนที่ทุกครั้งที่ deploy ถูกลบทุกครั้งที่ scale in และหายไปทุกครั้งที่ node พัง แล้ว log ในเครื่องก็หายไปพร้อมกัน เอกสารของ Kubernetes เขียนไว้ชัดเรื่อง eviction: ถ้า pod ถูก evict ออกจาก node ตัว container ก็หายไป และ log ของมันก็หายตามไปด้วย ถึงตอนที่ pod ยังอยู่ kubelet ก็ rotate log ของ container ที่ 10 MiB และเก็บไว้ห้าไฟล์เป็นค่า default แล้ว `kubectl logs` ก็คืนให้แค่ไฟล์ล่าสุด บรรทัดที่เราต้องการที่สุดมักเป็นบรรทัดท้าย ๆ ที่ instance เขียนไว้ก่อนมันจะหายไป

Centralized logging ย้ายบรรทัดออกจาก instance ทันทีที่เขียน ไปไว้ใน store เดียวที่อยู่ได้นานกว่า instance ทุกตัว และค้นได้ด้วย query เดียว

## ทำงานยังไง

1. **แต่ละ service เขียน event แบบ structured ออก standard output** หนึ่ง event ต่อหนึ่งบรรทัด มี field ที่มีชื่อแทนที่จะเป็นประโยค: เกิดเมื่อไร รุนแรงแค่ไหน service ไหนเขียน เกิดอะไรขึ้น และ ID ของ request ที่มันเกิดขึ้น ตัว service ไม่ต้องเปิดไฟล์ log ไม่ต้อง rotate และไม่ต้องรู้ว่าบรรทัดไปจบที่ไหน
2. **platform เก็บ stream ไว้** container runtime เขียน stdout และ stderr ของแต่ละ container ลงไฟล์บน node
3. **collector ส่งมันออกไป** agent บนทุก node ตามอ่านไฟล์พวกนั้น parse บรรทัด เติมว่ามันมาจากไหน (instance, node, environment) buffer ไว้ แล้วส่งต่อเป็น batch มันเป็น component ตัวเดียวที่คุยกับ store
4. **central store เก็บและทำ index ให้ event** ไว้นานเท่าที่กฎ retention กำหนด และตอบ query ข้ามทุก service ได้ในครั้งเดียว: ทุกบรรทัดของ request หนึ่ง ทุก error ของ service หนึ่ง หรือจำนวนแยกตาม version

### Log, metric และ trace

สัญญาณทั้งสามตอบคำถามคนละแบบ และแต่ละตัวก็เป็นเครื่องมือที่ผิดสำหรับงานของอีกสองตัว

| สัญญาณ | เก็บอะไร | ถามมันว่า | อ่อนตรงไหน |
|---|---|---|---|
| **Log** | event แยกเป็นชิ้น ๆ แต่ละตัวมีรายละเอียดของตัวเอง | เกิดอะไรขึ้นกับ request นี้ order นี้ user คนนี้กันแน่ | แนวโน้มและ rate: จะนับก็ต้องอ่านทุกบรรทัด และปกติเป็นสัญญาณที่มีปริมาณมากที่สุด |
| **Metric** | ตัวเลขที่ aggregate ตามเวลา | กี่ครั้ง เร็วแค่ไหน บ่อยแค่ไหน แย่ลงหรือเปล่า | อธิบายเคสเดียว: รายละเอียดถูก aggregate ทิ้งไปแล้ว |
| **Trace** | การเรียกต่าง ๆ ของ request หนึ่ง พร้อมเวลาและ parent ของมัน | เวลาหายไปที่ไหน และการเรียกไหนพัง | รายละเอียดภายในขั้นหนึ่ง และ request ที่ไม่ได้ถูก sample |

ตั้ง alert จาก metric หาจุดด้วย trace แล้วอ่านเหตุผลใน log เรื่องแรกอยู่ใน [SLO และ error budget](../slo-error-budgets/) ส่วนเรื่องที่สองอยู่ใน [distributed tracing](../distributed-tracing/) สัญญาณพวกนี้เชื่อมกันด้วย identifier ที่ใช้ร่วมกัน โดยเฉพาะ trace ID และนี่คือเหตุผลที่ขั้นที่ 3 log มันไว้

### Structured logging และชื่อ field

บรรทัดแบบ free text ต้องถูกแยกชิ้นด้วย regular expression ก่อนจะเอาไปทำอะไรได้ และทุก format ก็ต้องมี expression ของตัวเอง ส่วน event แบบ structured พา field ไปพร้อมชื่อ:

```json
{"time":"2026-10-02T14:02:07.140Z","level":"ERROR","service":"payments","message":"charge timed out","trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","order_id":8123,"duration_ms":3000}
```

- **หนึ่ง event หนึ่งบรรทัด ปกติเป็น JSON** ให้ message คงที่ (`charge timed out`) แล้วใส่ทุกอย่างที่เปลี่ยนไปเรื่อย ๆ ไว้ใน field (`order_id`, `duration_ms`) ตัว message ที่คงที่จับกลุ่มและนับได้ แต่ประโยคที่มีเลข order อยู่ข้างในทำแบบนั้นไม่ได้
- **JSON อย่างเดียวยังไม่ใช่โครงสร้าง** เอกสารของ OpenTelemetry ขีดเส้นไว้ว่า บรรทัด JSON ที่ไม่มี schema ที่คงที่เป็นแค่ semi-structured ส่วน log จะ query ข้าม service ได้ก็ต่อเมื่อสิ่งเดียวกันมีชื่อและ type เดียวกันในทุกที่
- **ยืม schema มาใช้ แทนที่จะคิดเอง** OpenTelemetry log data model ที่ stable แล้วกำหนด record ไว้เป็น `Timestamp`, `ObservedTimestamp`, `TraceId`, `SpanId`, `TraceFlags`, `SeverityText`, `SeverityNumber`, `Body`, `Resource`, `InstrumentationScope`, `Attributes` และ `EventName` ส่วน semantic convention ตั้งชื่อ attribute ไว้: `service.name`, `service.instance.id`, `deployment.environment.name` ฝั่ง schema ของ vendor ก็ทำแบบเดียวกัน: Elastic Common Schema (ECS) มี `@timestamp`, `log.level`, `message`, `service.name` และ `trace.id` แล้ว Elastic ก็ยก ECS ให้ OpenTelemetry เมื่อเมษายน 2023 โดยประกาศเป้าหมายไว้ว่าจะรวมสองตัวนี้เข้าด้วยกัน
- **ทำให้ level เทียบกันได้** data model นี้ map level ของทุก library ไปเป็น `SeverityNumber` ตั้งแต่ 1 ถึง 24 แบ่งเป็นหกช่วง: TRACE 1–4, DEBUG 5–8, INFO 9–12, WARN 13–16, ERROR 17–20 และ FATAL 21–24 ส่วน Syslog (RFC 5424) นับกลับทาง จาก 0 (emergency) ถึง 7 (debug) ตกลงกันด้วยว่าแต่ละ level หมายถึงอะไร: ERROR ที่ไม่มีใครต้องลงมือทำอะไรก็คือ WARN
- **บังคับใช้ไว้ที่เดียว** logging module ที่ใช้ร่วมกัน ตั้งชื่อ field เติมชื่อ service และ version และอ่าน trace context ให้ ช่วยได้มากกว่าเอกสาร convention

diagram ใช้ชื่อสั้น ๆ (`time`, `level`, `service`, `message`, `order_id`, `trace_id` และ `instance`, `node`, `env` ที่มาจาก agent) จะได้อ่านง่าย ให้ map ไปเป็นชื่อตาม schema ที่เราเลือก

### Log เป็น event stream

กฎเรื่อง log ของ Twelve-Factor App คือ process ไม่ route หรือเก็บ output ของตัวเอง มันเขียน event ออก standard output แบบไม่ buffer แล้ว environment ที่มันรันอยู่ก็เก็บ stream นั้นและส่งไปที่ไหนก็ตามที่ต้องไป ผลที่ตามมามีสามข้อ:

- service ไม่มีไฟล์ log ให้ต้องตั้งชื่อ, rotate หรือทำ disk เต็ม และไม่ต้องมี client library ของ log store
- โค้ดเดียวกัน log ออก terminal บน laptop และ log ไปที่ central store บน production
- log จะไปที่ไหนเป็นเรื่องของการ deploy ตัว store, vendor และกฎ retention เปลี่ยนได้โดยไม่ต้อง release service ตัวไหนเลย

บน Kubernetes การเก็บ stream ทำโดย container runtime ที่เขียน output ของแต่ละ container ลงไฟล์ใต้ `/var/log/pods` บน node ในรูปแบบ CRI logging format (timestamp, ชื่อ stream, tag และบรรทัด) และโดย kubelet ที่ rotate ไฟล์พวกนั้น

### Topology ของการเก็บ log

| Topology | ทำงานยังไง | ทำไมถึงเลือก | ต้องจ่ายอะไร |
|---|---|---|---|
| **Agent ต่อ node** (ใน diagram) | agent หนึ่งตัวบนทุก node (บน Kubernetes คือ DaemonSet) ตามอ่านไฟล์ log ของทุก container บน node นั้น | agent หนึ่งตัวต่อ node และไม่ต้องแก้แอปพลิเคชันเลย | มันเห็นแค่สิ่งที่ออกไปที่ stdout และ stderr และ configuration ของ agent ชุดเดียวต้องใช้กับทุก workload บน node |
| **Sidecar ต่อ instance** | container ตัวที่สองข้างแอปพลิเคชันทำอย่างใดอย่างหนึ่ง: ก็อปไฟล์ log ไปที่ stdout ของตัวเองให้ agent บน node มาเก็บ หรือรัน agent เต็มตัวของตัวเอง | แอปพลิเคชันที่เขียนได้แค่ไฟล์ หรือกฎการ parse และปลายทางที่ต่างกันไปตามแอปพลิเคชัน | agent ในทุก pod ใช้ resource มากกว่าแบบหนึ่งตัวต่อ node เยอะ `kubectl logs` จะมองไม่เห็นบรรทัดที่ sidecar agent ส่งไป และไฟล์ที่ก็อปไปที่ stdout ก็ถูกเก็บสองรอบบน node |
| **ส่งตรงจากแอปพลิเคชัน** | logging library ส่ง event ผ่าน network เช่น เป็น OTLP ไปที่ collector หรือไปที่ store | ไม่ต้อง parse ไฟล์ ได้โครงสร้างเต็มและ trace context ตั้งแต่ต้น แล้วยังใช้ได้ในที่ที่ไม่มี node ให้วาง agent | ตอนนี้แอปพลิเคชันพึ่ง pipeline แล้ว มันต้องมี queue ที่มีขอบเขตและไม่เคย block และอะไรที่ยังอยู่ใน queue ตอน process crash ก็หายไป และนั่นก็คือจังหวะที่บรรทัดพวกนั้นสำคัญที่สุด |
| **Collector tier** | agent หรือแอปพลิเคชันส่งไปที่ pool ของ collector กลางที่ทำงานประมวลผลหนัก ๆ และถือ credential ของ store | ที่เดียวสำหรับ redaction, sampling และ routing ไปหลาย store ส่วน agent ก็ยังเล็กอยู่ | อีกหนึ่ง tier ที่ต้องรันและต้อง scale |

แบบพวกนี้ใช้ร่วมกันได้ layout ที่เจอบ่อยคือ agent บน node ส่งต่อไปที่ collector tier: ก็คือสอง tier ที่อธิบายไว้ใน [telemetry pipeline](../telemetry-pipeline/) ส่วนแถวที่สองก็เป็นตัวอย่างหนึ่งของ pattern [sidecar](../sidecar/)

### Correlation ID และ trace context

- **หนึ่ง ID ต่อหนึ่ง request สร้างที่ edge** component แรกที่เห็น request (ปกติคือ [API gateway](../api-gateway/)) จะต่อ trace context ของ caller หรือเริ่มอันใหม่ แล้วทุก service ก็ส่งมันต่อไปกับทุกการเรียกที่ตัวเองทำ
- **ใช้ trace ID แทน request ID ที่ทำขึ้นเอง** header ของ W3C Trace Context คือ `traceparent: version-traceid-parentid-flags` ตัว trace ID ยาว 32 ตัวอักษรฐานสิบหก และคงเดิมตลอดทั้ง request ส่วน parent ID ยาว 16 และเปลี่ยนทุก hop
- **เขียนมันลงทุกบรรทัด** log record ของ OpenTelemetry มี field `TraceId`, `SpanId` และ `TraceFlags` ส่วน format อื่น specification ให้ใช้ field ระดับบนสุดชื่อ `trace_id`, `span_id` และ `trace_flags` เป็นเลขฐานสิบหกตัวพิมพ์เล็ก integration ของ OpenTelemetry กับ logging library จะเติมค่าให้จาก span ที่ active อยู่ โค้ดของแอปพลิเคชันเลยไม่ต้องส่ง ID ไปมาเอง
- **จากนั้นค่าเดียวก็เชื่อมทุกอย่าง** ค้น trace ID ทีเดียวก็ได้บรรทัดของ request จากทุก service (ขั้นที่ 3) และ ID เดียวกันก็เปิด trace ของมันได้ด้วย ทำให้กระโดดจาก span ที่ช้าไปที่บรรทัดที่เขียนไว้ข้างในมัน แล้วกลับมาได้
- **log identifier ทางธุรกิจเป็น field ด้วย**: order, tenant, job คนจะค้นตามที่ลูกค้าบอก และสิ่งที่ลูกค้าบอกก็แทบไม่เคยเป็น trace ID ส่ง trace ID คืนให้ caller ไปพร้อมกับ error ก็ทำให้ฝ่าย support มีอะไรให้ขอจากลูกค้า
- **พา context ข้าม queue ไปด้วย** สำหรับงานแบบ asynchronous ให้ใส่มันไว้ใน header ของ message บรรทัดของ consumer จะได้เชื่อมเข้ากับ trace เดียวกัน

### Message หลายบรรทัด

stack trace คือ event เดียวที่พิมพ์ออกมาหลายบรรทัด collector ที่อ่านทีละบรรทัดจะทำให้มันกลายเป็น event เป็นสิบ ๆ ตัวที่ไม่มี level และไม่มี trace ID ปนอยู่กับบรรทัดของ request อื่น

- **แก้ที่ต้นทางถ้าทำได้** structured logger เขียน stack trace เป็น field เดียวใน JSON บรรทัดเดียว
- **ไม่งั้นก็รวมบรรทัดใน agent** ด้วยกฎที่จับบรรทัดแรกของ event ได้ Fluent Bit มี multiline parser สำหรับ Go, Java, Python และ Ruby มาให้ และให้นิยามเองได้ด้วย ส่วน filelog receiver ของ OpenTelemetry Collector รับ block `multiline` ที่มี `line_start_pattern` หรือ `line_end_pattern`
- **บรรทัดยาว ๆ ถูก runtime ตัดแบ่ง** CRI format ติด tag ให้ทุกบรรทัดที่เก็บไว้ว่าเป็น partial (`P`) หรือ full (`F`) แล้ว agent ต้องเอาส่วนที่เป็น partial มาต่อกลับ ตัว parser `cri` และ `docker` ที่มีมากับ Fluent Bit ทำเรื่องนี้ให้

### นาฬิกาและ time zone

- **timestamp เป็น UTC ในรูปแบบ RFC 3339** (`2026-10-02T14:02:07.140Z`) ละเอียดอย่างน้อยระดับ millisecond และ service เป็นคนตั้งค่า ณ ตอนที่ event เกิด เวลาท้องถิ่นที่ไม่มี offset เรียงลำดับข้าม region หรือข้ามช่วงเปลี่ยน daylight saving time ไม่ได้
- **ลำดับข้ามเครื่องแม่นได้เท่าที่นาฬิกาแม่น** sync ทุกเครื่อง (แนวทางเรื่อง logging ของ OWASP ก็ขอแบบนี้) แต่ก็ยังอย่าอ่านเหตุและผลจาก timestamp สองค่าที่ห่างกันหนึ่ง millisecond บนคนละเครื่อง ตัว parent span กับ child span ของ trace จะบอกลำดับที่แท้จริง
- **เก็บ timestamp สองค่า** OpenTelemetry แยก `Timestamp` คือตอนที่ event เกิดตามนาฬิกาของต้นทาง ออกจาก `ObservedTimestamp` คือตอนที่ collector เห็นมัน ให้เรียงและค้นด้วยค่าแรก ส่วนผลต่างของสองค่าคือ delay ในการส่ง ตัวเลขนี้แหละที่ต้องดูในขั้นที่ 4: บรรทัดที่ถูก buffer ไว้มาถึงช้าไปหลายนาที แต่ก็ยังต้องอยู่ในตำแหน่งเดิมของมัน

### Store สองแบบ

store ทำ index มากแค่ไหนตอนบรรทัดเข้ามา เป็นตัวตัดสินว่าการ ingest เสียเท่าไรและ query เสียเท่าไร

| | Index ทุกอย่าง | Index แค่ label |
|---|---|---|
| **ตัวอย่าง** | Elasticsearch, OpenSearch | Grafana Loki |
| **ตอน ingest** | field ถูกทำ index และข้อความถูกแยกเป็น term ส่วน field ใหม่จะถูก map และทำ index อัตโนมัติ ถ้าไม่ได้สั่งเป็นอย่างอื่น | label ไม่กี่ตัวระบุ stream: service, environment, level แล้วบรรทัดก็ถูกบีบอัดเป็น chunk แล้วเขียนลง object storage โดยไม่มี index ของเนื้อหา |
| **query หนึ่งครั้ง** | หา term ใน index: field ไหนก็ได้ คำไหนก็ได้ พร้อม aggregation | เลือก stream ตาม label และเวลา แล้วอ่าน chunk ของมันมา filter |
| **เร็วเมื่อ** | แทบทุกครั้ง แลกกับราคาข้างล่าง | label และช่วงเวลาบีบการค้นให้เหลือข้อมูลน้อย ๆ |
| **แพงเมื่อ** | ปริมาณโตขึ้น: index กิน disk, memory และ CPU ตอนเขียน | ค้นค่าหายากค่าเดียวข้ามทุก stream ในช่วงเวลายาว ๆ |
| **กับดัก** | mapping explosion: JSON key ใหม่ทุกตัวคือ field ใหม่ (limit ค่า default คือ 1,000 ต่อ index) และ key เดียวกันที่มีสอง type ก็คือ conflict | label ที่ cardinality สูง: label ต่อ user หรือต่อ request จะสร้าง stream ให้แต่ละค่า ได้ index ใหญ่มากและ chunk จิ๋ว ๆ เป็นพัน ๆ |
| **Lifecycle** | Index lifecycle management ย้าย index ผ่านเฟส hot, warm, cold และ frozen แล้วลบทิ้ง ส่วน OpenSearch มี policy ของ Index State Management | retention ทำโดย compactor ต่อ tenant หรือต่อ stream ค่า default ปิดไว้ บรรทัดเลยถูกเก็บไว้ตลอดไป |

รายละเอียดที่ควรรู้ ตามเอกสารเมื่อตุลาคม 2026:

- **Elasticsearch** map string field ใหม่เป็น `text` ที่มี sub-field `keyword` เป็นค่า default มันเลยถูกทำ index สองรอบ: รอบหนึ่งสำหรับ full-text search อีกรอบสำหรับ exact match และ aggregation โหมด index `logsdb` ของมัน ที่เป็นค่า default ของ data stream `logs-*-*` ใหม่ตั้งแต่ version 9.0 เก็บข้อมูล log ได้กระชับกว่า: Elastic รายงานว่าใน benchmark ของตัวเองใช้ storage น้อยลงได้ถึง 60% แลกกับการทำ index ที่ช้าลง 10–20% ส่วน frozen tier เก็บ searchable snapshot แบบ mount บางส่วน ทำให้ข้อมูลเก่ายังค้นได้ แม้จะช้า โดยไม่ต้องเก็บไว้บน disk ที่เร็ว
- **Loki** มี limit ค่า default อยู่ที่ 15 index label และเอกสารของมันแนะนำว่าไม่ควรเกิน 10 ถึง 15 ตัว โดยค่าต้องมีขอบเขตและอยู่ได้นาน ค่าที่ cardinality สูงแต่ยังอยาก filter อยู่ เช่น ชื่อ pod หรือ trace ID ให้ใส่ไว้ใน structured metadata ที่เก็บไปกับบรรทัดและไม่ถูกทำ index
- **Cloud logging service** ซ่อน index ไว้แล้วขายเป็น tier แทน Amazon CloudWatch Logs มี log class แบบ Standard และแบบ Infrequent Access ที่มี feature แค่บางส่วน ค่า ingest เป็นค่าใช้จ่ายเดียวที่ต่างกันระหว่างสองแบบ และ class ของ log group เปลี่ยนไม่ได้หลังสร้างแล้ว ฝั่ง Azure Monitor Logs มี table plan แบบ Analytics, Basic และ Auxiliary ส่วน Google Cloud Logging ส่งทุก entry ผ่าน sink ที่มี inclusion และ exclusion filter ไปลง log bucket

### ค่าใช้จ่าย และตัวควบคุม

บิลขึ้นกับสามอย่าง: ปริมาณที่ ingest, ทำ index ไปแค่ไหน และเก็บไว้นานแค่ไหน Google Cloud Logging แสดงรูปแบบที่เจอบ่อย (ราคา ณ ตุลาคม 2026): $0.50 ต่อ GiB ที่ stream เข้า log bucket รวม storage 30 วันแล้ว โดย 50 GiB แรกต่อ project ต่อเดือนฟรี และ $0.01 ต่อ GiB ต่อเดือนสำหรับอะไรที่เก็บนานกว่านั้น ค่า ingest กินส่วนใหญ่ และบรรทัดหนึ่งก็ราคาเท่าเดิม ไม่ว่าจะมีใครอ่านมันหรือเปล่า

ตัวควบคุมเลยเน้นที่ปริมาณก่อน:

- **Level** รัน production ที่ INFO แล้วทำให้ DEBUG เป็นสิ่งที่เปิดให้ service ตัวเดียว ในเวลาจำกัด
- **event น้อยลงแต่กว้างขึ้น** หนึ่งบรรทัดต่อ request ต่อ service ที่มียี่สิบ field ถูกกว่าและมีประโยชน์กว่าสิบบรรทัดที่มีบรรทัดละสอง field
- **Sampling** เก็บทุก warning และ error ไว้ และเก็บแค่บางส่วนของงานปกติที่สำเร็จ เช่น health check และ response `200` ส่วน Vector มี transform `sample` และ probabilistic sampler ของ OpenTelemetry Collector (สำหรับ log ยังเป็น alpha) ก็ตัดสินตาม trace ID ได้ ทำให้บรรทัดของ trace ที่ถูก sample อยู่ด้วยกันครบ ต้องบันทึก rate ไว้ด้วย ไม่งั้นทุกตัวเลขที่นับจาก sample จะผิดหมด
- **ทิ้งก่อนส่ง** filter ใน agent หรือ collector ลบบรรทัดที่ไม่มีใคร query: filter processor ของ OpenTelemetry Collector (alpha) ทิ้ง log record ที่ตรงเงื่อนไข เช่น `log.severity_number < SEVERITY_NUMBER_WARN` การทิ้งที่ store เป็นทางสำรอง ยกตัวอย่าง exclusion filter ของ Cloud Logging กัน entry ไม่ให้เข้า bucket ได้ แต่มันทำงานหลังจาก API ได้รับ entry ไปแล้ว ตัว entry นั้นเลยยังนับรวมใน write quota
- **Retention แบบเป็นชั้น** ให้บรรทัดค้นได้เป็นวันหรือเป็นสัปดาห์ archive ไว้ถูก ๆ เป็นเดือน แล้วลบตามกำหนด: ก็คือบันไดใน diagram ส่วน log group ของ CloudWatch Logs เก็บ event ไว้ตลอดไป ถ้าเราไม่ตั้ง retention period โดยตั้งได้ตั้งแต่หนึ่งวันถึงสิบปี Azure Monitor เก็บ table ส่วนใหญ่ให้ query แบบ interactive ได้ 30 วันเป็นค่า default และได้นานสุดสองปี และเก็บใน long-term retention ราคาถูกได้นานสุด 12 ปีรวมทั้งหมด ส่วน bucket `_Default` ของ Cloud Logging เก็บ entry ไว้ 30 วัน และ bucket ใน project ตั้งได้ตั้งแต่ 1 ถึง 3,650 วัน
- **Retention ต่อ stream** stream ที่เยอะแต่มีค่าน้อยได้เป็นวัน ส่วน audit trail ได้เป็นปี (ดูข้างล่าง)
- **งบต่อทีม** เผยแพร่ปริมาณแยกตาม service และ level แล้วตั้ง alert เมื่อพุ่งขึ้นกะทันหัน: retry loop ที่ log stack trace ทุกรอบทำให้ปริมาณของ service คูณขึ้นภายในไม่กี่นาที

### ข้อมูลอ่อนไหว

central store คือสำเนาชุดที่สองของทุกอย่างที่ service log ไว้ และคนที่อ่านมันได้ก็มีมากกว่าคนที่อ่าน production database ได้เยอะ

- **ห้าม log** password, access token, session identifier, encryption key, database connection string, ข้อมูลบัตรชำระเงิน หรือข้อมูลส่วนบุคคลที่อ่อนไหว OWASP Logging Cheat Sheet มีรายการเต็ม และบอกว่าถ้า event ต้องอ้างถึงค่าแบบนั้น ก็ควร remove, mask, sanitise, hash หรือ encrypt มัน
- **Redact ที่ต้นทาง** log เฉพาะ field ที่มีชื่ออยู่ใน allow-list ห้าม log ทั้ง request body, header หรือ object ทั้งก้อน service คือที่เดียวที่รู้ว่าค่านั้นคืออะไร
- **Redact ใน pipeline เป็นตาข่ายรองรับ** เหมือนเลขบัตรที่ถูก mask ในขั้นที่ 4 ตัว redaction processor ของ OpenTelemetry Collector (สำหรับ log ยังเป็น alpha) ลบ attribute ที่ไม่อยู่ใน allow-list และ mask ค่าที่ตรงกับ pattern ต้องห้าม ส่วน data protection policy ของ CloudWatch Logs จะ mask ข้อมูลที่ตรงเงื่อนไขทุกครั้งที่มันออกจาก service และมีแค่ principal ที่มี permission `logs:Unmask` ที่เห็นค่าจริง pattern หาเลขบัตรเจอ แต่หา secret ที่ไม่มีใครเขียน pattern ไว้ไม่เจอ
- **จำกัดและบันทึกการเข้าถึง** กำหนดสิทธิ์อ่านตามทีมและ environment บันทึกว่าใครค้นอะไร และ encrypt บรรทัดทั้งตอนส่งและตอนเก็บ
- **ถือว่าเนื้อหาใน log เป็น input ที่เชื่อถือไม่ได้** ข้อความที่ user ส่งมาและมีการขึ้นบรรทัดใหม่อยู่ข้างในปลอม entry ใน log แบบทีละบรรทัดได้ structured encoding จะ escape ให้ และ OWASP ก็ขอให้ sanitise carriage return กับ line feed
- **Retention ก็เป็นตัวควบคุมด้าน privacy ด้วย** บรรทัดที่ถูกลบตามกำหนดไปแล้วจะรั่วทีหลังไม่ได้

### ความน่าเชื่อถือของ pipeline

บรรทัดต้องรออยู่สี่ที่ระหว่างทางไป store และแต่ละที่ก็มีขีดจำกัด

| ที่ไหน | อะไรถือบรรทัดไว้ | อะไรหายเมื่อมันล่ม |
|---|---|---|
| **ไฟล์ log บน node** | ไฟล์ของ runtime ที่ rotate ตามขนาด: บน Kubernetes ค่า default คือ 10 MiB และห้าไฟล์ต่อ container | ทุกอย่างที่ยังไม่ได้ส่งตอน node ตายหรือ pod ถูกลบ และอะไรที่ถูก rotate ทิ้งไประหว่างที่ agent ล่มหรือตามไม่ทัน |
| **ตำแหน่งของ agent** | checkpoint ว่าแต่ละไฟล์อ่านไปถึงไหนแล้ว | ถ้าไม่มี checkpoint ตัว agent ที่ restart จะอ่านไฟล์ซ้ำหรือข้ามบางไฟล์ไป ส่วน tail input ของ Fluent Bit เก็บ offset ไว้ในไฟล์ database (`db`) ส่วน filelog receiver ของ OpenTelemetry ก็ต้องใช้ storage extension |
| **buffer ของ agent** | memory หรือ memory ที่มี disk รองรับ | buffer ใน memory ตายไปพร้อม agent ส่วน buffer บน disk รอดจากการ restart และมีขนาดจำกัด |
| **ทางเข้าของ store** | rate limit และ queue ของตัวมันเอง | อะไรก็ตามที่ agent ยอมแพ้หลัง retry จนหมด |

- **ตัดสินใจว่าจะทำอะไรเมื่อ buffer เต็ม: block หรือ drop** Fluent Bit หยุด input ที่ถึง `mem_buf_limit` ไว้ก่อน ส่วนถ้าใช้ filesystem buffering ตัว output ที่ถึง `storage.total_limit_size` จะทิ้ง chunk ที่เก่าที่สุด ส่วน buffer ของ Vector จะ block เป็นค่า default (`when_full: block`) ทำให้ดันกลับไปที่อะไรก็ตามที่ป้อนมันอยู่ และตั้งให้ทิ้ง event ที่ใหม่ที่สุดแทนก็ได้
- **back-pressure ต้องไม่ไปถึง request path** ถ้าใช้ agent ที่ตามอ่านไฟล์ พอ store ค้างก็แค่ทำให้ agent หยุดอ่านต่อ (ขั้นที่ 4) และ service ก็ยังเขียนลง stdout ต่อไปได้ ถ้า runtime หรือแอปพลิเคชันส่งบรรทัดเอง ให้ดูว่าใช้ delivery mode แบบไหน ตัว Docker ส่งจาก container ไปที่ logging driver ของมันในโหมด blocking เป็นค่า default ส่วน `mode=non-blocking` จะวาง buffer ต่อ container ไว้ตรงกลาง (1 MB เป็นค่า default) และทิ้ง message เมื่อมันเต็ม สำหรับ log ที่ใช้วินิจฉัยปัญหา การทิ้งมักเป็นวิธีพังที่ถูกต้อง
- **เตรียมรับของซ้ำและของที่มาช้า** retry ทำให้การส่งเป็นแบบ at-least-once และบรรทัดที่ถูก buffer ก็มาถึงแบบไม่เรียงลำดับ
- **เฝ้า pipeline ด้วย metric ไม่ใช่ด้วย log ของมันเอง**: การใช้ buffer, retry, record ที่ถูกทิ้ง และ delay ระหว่างเวลาของ event กับเวลาที่มาถึง แยกตาม agent ส่วน [telemetry pipeline](../telemetry-pipeline/) อธิบายเรื่อง queue, retry และ memory limit ใน collector
- **อย่าเก็บข้อเท็จจริงที่ห้ามหายไว้ใน log** order, billing record และการเปลี่ยน state ควรอยู่ใน database หรือใน event stream ที่มี delivery guarantee

### Alerting: log หรือ metric

- **ตั้ง alert จากอาการด้วย metric** และ SLO burn rate ([SLO และ error budget](../slo-error-budgets/)) แล้วใช้ log อธิบาย alert
- **alert จาก log เหมาะกับ event ที่ไม่มี metric**: error message เฉพาะตัวหนึ่ง, security event หรือบรรทัดที่ต้องไม่โผล่มาเลย ให้แปลง query เป็น metric แล้วตั้ง alert จากตัวนั้น ruler ของ Loki ประเมินทั้ง alerting rule และ recording rule ส่วน Cloud Logging มี log-based metric (counter และ distribution) และ CloudWatch Logs มี metric filter
- **รู้ขีดจำกัด** alert แบบนี้ทันเวลาได้แค่เท่าที่ pipeline ทัน มันมองไม่เห็นบรรทัดที่ถูก sample หรือถูกทิ้งไป และการประเมินทุกครั้งก็คือ query บนข้อมูลที่เก็บไว้
- **ถ้านับบรรทัดเดิมทุกนาที** ให้ส่ง metric ออกมาจากโค้ดแล้วทิ้งบรรทัดนั้นไป

### Audit log เป็นอีก stream หนึ่ง

audit log บันทึกว่าใครทำอะไร กับอะไร และเมื่อไร กฎของมันตรงข้ามกับขั้นที่ 4: ห้าม sample หรือทิ้งอะไรเลย record ต้องตรวจได้ว่าถูกแก้ไขหรือเปล่า retention ถูกกำหนดโดยกฎระเบียบและนับเป็นปี และคนที่อ่านได้ต้องมีน้อย เก็บมันไว้ใน stream แยก ที่มี store, กฎการเข้าถึง และ retention ของตัวเอง

- audit log แบบ Admin Activity ของ Google Cloud ถูกเขียนเสมอ และปิดหรือ exclude ไม่ได้ มันไปลง bucket `_Required` ที่ retention ถูกตั้งตายตัวไว้ 400 วัน
- AWS CloudTrail validate ความสมบูรณ์ของไฟล์ log ได้: มัน hash ไฟล์ log ทุกไฟล์ด้วย SHA-256 และส่ง digest file ทุกชั่วโมง ที่ sign ด้วย RSA ทำให้ตรวจจับไฟล์ที่ถูกแก้หรือถูกลบได้
- แนวทางของ OWASP สำหรับ log ที่เก็บไว้ใช้ได้เต็ม ๆ ตรงนี้: ใส่การตรวจจับการแก้ไขไว้ในตัว ก็อป record ไปลงสื่อแบบ read-only ให้เร็วที่สุด และบันทึกการเข้าถึงทุกครั้ง

## ใช้ตอนไหนดี

- **ทันทีที่ instance เป็นของใช้แล้วทิ้ง หรือมีมากกว่าหนึ่งตัว**: container, autoscaling group, function พูดง่าย ๆ ก็แทบทุกระบบบน production
- **[Microservices](../microservices/)** ที่ไม่มี service ตัวไหนเห็น request ทั้งตัว
- **ตอนที่คนอื่นที่ไม่ใช่คนเขียนต้อง debug** วิศวกร on-call และฝ่าย support ต้องมีที่เดียวให้ดู โดยไม่ต้องมี shell access เข้าเครื่อง production
- **ตอนที่ log ต้องอยู่นานกว่าเครื่อง** สำหรับการสืบสวนด้าน security หรือเพราะกฎระเบียบกำหนด

มันไม่ได้ตอบทุกคำถาม:

- **"เวลาหายไปที่ไหน"** เป็นคำถามของ trace ([distributed tracing](../distributed-tracing/))
- **"service ปกติดีไหม และตั้งแต่เมื่อไร"** เป็นงานของ metric และ health check ([health endpoint monitoring](../health-endpoint-monitoring/))
- **process เดียวบน host เดียวที่อยู่ได้นาน** ใช้ไฟล์ในเครื่องกับ `grep` ก็พอ ตราบที่การเสีย host ไปไม่ได้ทำให้หลักฐานว่าทำไมหายไปด้วย

## ได้อะไร เสียอะไร

- **ค่าใช้จ่ายโตตาม traffic และความละเอียดของ log ไม่ได้โตตามคุณค่า** บรรทัดส่วนใหญ่ไม่เคยถูกอ่าน และทุกบรรทัดก็ถูกคิดเงินตอน ingest
- **มันคือระบบ production อีกระบบหนึ่ง** agent บนทุก node, pipeline และ store ต้องมีการวางแผน capacity, การอัปเกรด และ monitoring ของตัวเอง ไม่งั้นก็ต้องจ่ายให้ vendor ที่คิดเงินตามปริมาณ
- **store กลางคือเป้าหมายกลาง** ทุกอย่างที่ทุก service เคย log ไว้อยู่ในที่เดียว และ secret ในบรรทัดเดียวก็อ่านได้โดยทุกคนที่ค้นได้
- **schema ต้องตกลงกัน** ชื่อ field ช่วยได้ก็ต่อเมื่อทุกทีมใช้มัน และต้องอาศัย library ที่ใช้ร่วมกันกับการ review
- **การส่งเป็นแบบ best-effort และมาช้า** บรรทัดหายได้ทุกขั้น และมาถึงหลัง event ไปหลายวินาทีถึงหลายนาที การตัดสินใจที่ต้องการความแน่นอนไม่ควรอ่านจาก log
- **index น้อยลงแล้วเขียนประหยัดกว่าแต่ค้นช้ากว่า** store สองแบบย้ายต้นทุนไปมาระหว่างตอน ingest กับตอน query แต่ไม่มีแบบไหนทำให้ปริมาณรายวันจำนวนมากถูกลงได้
- **sampling และการทิ้งเปลี่ยนตัวเลข** ตัวเลขที่นับจากบรรทัดที่ถูก sample จะผิดถ้าไม่เอา rate มาคิด และวันหนึ่งบรรทัด DEBUG ที่ถูกทิ้งไปก็จะเป็นบรรทัดที่เราอยากได้

## ข้อควรรู้ตอนลงมือทำ

- **Structured logger** ระบบนิเวศส่วนใหญ่มีอยู่ใน standard library หรือใกล้ ๆ: `log/slog` ใน Go, JSON Template Layout ใน Log4j 2, JSON console formatter ใน .NET (`AddJsonConsole`), `structlog` ใน Python, `pino` ใน Node.js ห่อมันไว้ครั้งเดียว ทุก service จะได้มีชื่อ field ชุดเดียวกัน มีชื่อ service และ version และมี trace context
- **Agent และ collector** Fluent Bit, Vector และ OpenTelemetry Collector ทำได้ครบทั้งตามอ่านไฟล์, parse, เติมข้อมูล, buffer และส่ง บน Kubernetes ให้รัน agent เป็น DaemonSet โดย mount directory log ของ node แบบ read-only ใน OpenTelemetry Collector ชิ้นที่ใช้คือ filelog receiver (beta) และ Kubernetes attributes processor (stable) ที่ไปหา pod ผ่าน Kubernetes API แล้วเติมชื่อ pod, namespace และ label ของมัน ส่วน Kubernetes filter ของ Fluent Bit ก็ทำแบบเดียวกัน ถ้าส่งไป Loki ให้ใช้ Grafana Alloy เพราะ Promtail หมดอายุไปตั้งแต่ 2 มีนาคม 2026
- **ให้แอปพลิเคชันไม่ต้องรู้อะไร** ไม่มี address ของ store, API key หรือ library ของ vendor ในโค้ดของ service นี่แหละที่ทำให้เปลี่ยน store ได้
- **ให้ agent มี checkpoint และ disk buffer** แล้วตั้งขนาด buffer ให้พอกับ outage ที่ตั้งใจจะรอดให้ได้: บรรทัดต่อวินาที × byte ต่อบรรทัด × จำนวนวินาทีของ outage
- **ตัด noise ก่อน**: request จาก probe ([health endpoint monitoring](../health-endpoint-monitoring/)), ping จาก load balancer และบรรทัดต่อ item ข้างใน loop
- **เขียน retention ไว้เป็น configuration** ต่อ stream ไว้ข้าง ๆ configuration ของ pipeline ตัว Elasticsearch มี index lifecycle policy และ data stream lifecycle ที่ง่ายกว่า ฝั่ง OpenSearch มี ISM policy ส่วน Loki มี compactor retention และ cloud service ก็มี retention setting ต่อ log group, bucket หรือ table
- **ซ้อม** ลบ pod แล้วเช็กว่าบรรทัดสุดท้ายของมันไปถึง store บล็อก store แล้วดู buffer เต็มและระบายออก ตาม trace ID หนึ่งตัวจาก gateway ไปถึง service ตัวสุดท้าย ค้นหา pattern ของเลขบัตรและ token ใน store เป็นระยะตามกำหนด

### ข้อผิดพลาดที่เจอบ่อย

- **ทุกอย่างอยู่ level เดียว** ถ้าทุกบรรทัดเป็น INFO ก็ใช้ level ในการ filter หรือทิ้งไม่ได้ และถ้า exception ที่จัดการไปแล้วถูก log เป็น ERROR จำนวน error ก็ไม่มีความหมาย
- **label หรือ index field ที่ cardinality สูง** user ID ที่เป็น label ของ Loki หรือ JSON key ที่ฝัง ID ไว้ใน Elasticsearch ทำร้ายทั้ง store ไม่ใช่แค่ query เดียว ให้ใส่ค่าแบบนี้ไว้ในบรรทัด หรือใน structured metadata
- **ใช้ log ในที่ที่ metric ทำได้** การนับ request, วัด latency หรือติดตาม queue depth ด้วยการ parse บรรทัด ต้องเสียบรรทัดที่เก็บไว้หนึ่งบรรทัดต่อหนึ่ง data point ให้ส่ง counter หรือ histogram ออกมาแทน
- **error เดียวกันถูก log ทุก layer** ความล้มเหลวครั้งเดียวกลายเป็น stack trace ห้าชุด ให้ log ตรงที่จัดการมัน แล้วให้ trace ID เชื่อมส่วนที่เหลือ
- **free text ที่มีข้อมูลอยู่ข้างใน** `payment for order 8123 failed after 3000 ms` จับกลุ่มไม่ได้ ส่วน `payment failed` ที่มี `order_id` และ `duration_ms` จับกลุ่มได้
- **request body และ response body อยู่ใน log** นี่คือทางที่เร็วที่สุดในการเอาข้อมูลส่วนบุคคลและ secret ไปไว้ใน store
- **งานเบื้องหลังไม่มี trace context** job, consumer และ scheduled task ก็ต้องมีเหมือนกัน ไม่งั้นบรรทัดของมันจะเชื่อมกับอะไรไม่ได้เลย
- **ใช้ log store เป็นบันทึกว่าเกิดอะไรขึ้น** audit trail และข้อเท็จจริงทางธุรกิจต้องการ guarantee ที่อธิบายไว้ข้างบน
