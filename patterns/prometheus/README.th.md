## ปัญหา

service Catalog ของ Acme Shop รันเป็นสาม pod บน Kubernetes ทีมอยากรู้แบบนาทีต่อนาทีว่ามันรับ request ไปกี่ตัว พังไปกี่ตัว และตัวที่ช้าที่สุดช้าแค่ไหน และอยากให้มีคนถูก page เมื่อ failure rate สูงค้างอยู่ ไม่ใช่เมื่อ request ตัวเดียวพัง ตัวเลขพวกนี้ต้องมาจากทุก pod รวมถึงตัวที่เพิ่ง start เมื่อห้านาทีก่อน และต้องรวมข้าม pod กันได้ ส่วน log ตอบคำถามพวกนี้ได้แค่ด้วยการนับบรรทัดย้อนหลัง ทำให้ช้าและแพงขึ้นเรื่อย ๆ ตาม traffic ที่โตขึ้น

Prometheus เก็บตัวเลข ไม่ได้เก็บ event ตัว process ทุกตัวถือ counter, gauge และ histogram ไม่กี่ตัวไว้ใน memory แล้วให้ค่าปัจจุบันของมันผ่าน HTTP ตัว Prometheus ไปดึงค่าพวกนี้ตามรอบเวลาที่ตายตัว เก็บเป็น time series ใน database ของตัวเอง query ด้วยภาษาที่ออกแบบมาเพื่อ time series (PromQL) และเปลี่ยนผล query ให้เป็น alert ส่วน Alertmanager ตัดสินว่าใครจะได้รู้เรื่อง alert และ Grafana วาด dashboard จาก query ชุดเดียวกัน

## ทำงานยังไง

### Pull, store, evaluate

Prometheus เป็นฝ่าย **pull** ตัว service discovery บอกมันว่ามี target อะไรบ้าง แล้ว scraper ของมันก็ส่ง `GET /metrics` ไปหาแต่ละตัวทุก `scrape_interval` (default 1 นาที ที่นี่ใช้ 15 วินาที) แต่ละ response กลายเป็น sample ชุดหนึ่งใน time-series database (TSDB) ที่อยู่ในเครื่อง แล้วทุก `evaluation_interval` ตัว rule engine ก็จะรัน PromQL expression บนข้อมูลที่เก็บไว้: recording rule เก็บผลลัพธ์เป็น series ใหม่ ส่วน alerting rule ส่ง alert ที่กำลัง firing ไปให้ Alertmanager ทั้ง Grafana และใครก็ตามอ่านผ่าน HTTP API เช่น `/api/v1/query` ตัว Prometheus server หนึ่งตัวคือ binary ตัวเดียวที่มีทุกส่วนนี้อยู่ข้างใน และ local storage ของมันไม่ได้เป็น cluster หรือ replicate

การ pull มีข้อดีในทางปฏิบัติตามที่ Prometheus FAQ ไล่ไว้: การ scrape ที่ล้มเหลวก็เป็นสัญญาณในตัวมันเอง (series `up` จะกลายเป็น 0) คุณเปิด `/metrics` ของ target ใน browser ได้ และชี้ Prometheus ตัวที่สองไปที่ target ชุดเดิมได้โดยไม่ต้องแก้อะไรที่ target

### Data model: ชื่อ, label และ sample

**time series** หนึ่งเส้นระบุด้วยชื่อ metric กับชุดของ label เช่น `http_requests_total{job="catalog", instance="10.1.4.7:8080", pod="catalog-7d9", service="catalog", status="200"}` ถ้าเปลี่ยนค่า label ตัวไหนก็ตาม ก็จะได้ series อีกเส้น ตัว series เก็บ **sample**: ค่า float64 (หรือ native histogram) พร้อม timestamp ระดับ millisecond ตัว label เป็นสิ่งที่ทำให้ model นี้มีหลายมิติ: PromQL filter ด้วย label ไหนก็ได้ แล้ว aggregate ข้าม label ที่เหลือ ทำให้ metric ตัวเดียวอ่านได้ทั้งราย pod ราย status code หรือทั้ง service

ตั้งแต่ Prometheus 3.0 ชื่อ metric และชื่อ label ใช้ตัวอักษร UTF-8 อะไรก็ได้ ชื่อที่อยู่นอกชุดตัวอักษรแบบเดิม (ตัวอักษร, ตัวเลข, `_` และ `:`) ต้องใส่ quote ใน PromQL และหน้า data model ก็เตือนว่าบางส่วนของ ecosystem ยังตามไม่ทัน

### ประเภทของ metric

client library มีให้สี่ประเภท นอกจาก native histogram แล้ว server ไม่ได้ใช้ประเภทเลย: มันเก็บทุกอย่างเป็น float series ธรรมดา

- **Counter** ยอดสะสมที่ขึ้นอย่างเดียว หรือกลับไปเป็นศูนย์ตอน process restart: `http_requests_total` คุณอ่านมันผ่าน `rate()` หรือ `increase()`
- **Gauge** ค่าที่ขึ้นและลงได้: memory ที่ใช้อยู่, ความยาว queue, request ที่กำลังทำอยู่
- **Histogram** นับค่าที่วัดได้ เช่นระยะเวลาของ request ลงใน bucket ตัว histogram แบบ **classic** มีหลาย series: counter สะสมต่อ bucket โดย `_bucket{le="0.5"}` แปลว่า "ไม่เกิน 0.5 s" บวกกับ `_sum` และ `_count` ส่วน histogram แบบ **native** เป็น series เดียวที่ sample แต่ละตัวมี layout ของ bucket ทั้งหมดอยู่ในนั้น ขอบของ bucket โตแบบ exponential ตาม schema ที่ตายตัว ทำให้ไม่ต้องมีใครเลือกเอง และมันก็ถูกกว่า ละเอียดกว่า และบวกกับ native histogram ตัวอื่นได้เสมอ ส่วน native histogram เป็น feature ที่ stable แล้วใน Prometheus 3.8 (พฤศจิกายน 2025) แต่เป็นตัวเลือก: scrape config เปิดมันด้วย `scrape_native_histograms: true` ทำให้ Prometheus ขอ format แบบ protobuf ก่อนด้วย หน้า metric types ระบุว่า client library ของ Go และ Java คือตัวที่รองรับ
- **Summary** client คำนวณ quantile บน sliding time window แล้วให้ออกมาพร้อม `_sum` และ `_count` แต่ quantile จาก pod ต่างกันเอามารวมกันไม่ได้ service ที่มีหลาย replica เลยมักเหมาะกับ histogram มากกว่า

### Exposition format และ OTLP

target ให้ plain text บรรทัดละหนึ่ง sample ตามหลังบรรทัด `# HELP` และ `# TYPE` ที่จะมีหรือไม่มีก็ได้:

```text
# TYPE http_requests_total counter
http_requests_total{service="catalog",status="200"} 18420
http_requests_total{service="catalog",status="500"} 1176
```

Prometheus ตกลง format กันผ่าน header `Accept` โดย default มันขอ OpenMetrics 1.0 ก่อน แล้วค่อยขอ text format ของ Prometheus แต่ถ้าเปิด native histogram ไว้ มันจะขอ format แบบ protobuf ก่อน ส่วน OpenMetrics 2.0 ยังเป็น release candidate แบบ experimental อยู่ โดยที่ 3.15 scrape มันได้เมื่อเปิด `--enable-feature=openmetrics2` และตั้งแต่ 3.0 เป็นต้นมา response ที่ไม่มี `Content-Type` ที่ถูกต้องจะทำให้การ scrape ล้มเหลว เว้นแต่ scrape config จะระบุ `fallback_scrape_protocol` ไว้

Prometheus ยังรับข้อมูลแบบ push ได้ด้วย ตัว `--web.enable-otlp-receiver` เปิด OTLP endpoint ที่ `/api/v1/otlp/v1/metrics` ทำให้ OpenTelemetry SDK หรือ OpenTelemetry Collector ส่ง metric ตรงมาหามันได้ ส่วน `--web.enable-remote-write-receiver` รับ remote write ที่ `/api/v1/write` ทั้งคู่ปิดอยู่โดย default: Prometheus รันได้โดยไม่มี authentication ใด ๆ OpenTelemetry guide เลยเตือนว่าการรับข้อมูลขาเข้าจะปลอดภัยก็ต่อเมื่อตั้งค่ามันอย่างตั้งใจแล้วเท่านั้น

### Service discovery และ relabeling

pod เกิดและหายไปตลอด list ของ target แบบตายตัวเลยใช้ไม่ได้ ตัว `kubernetes_sd_configs` watch Kubernetes API ในหนึ่งในหก role (`node`, `service`, `pod`, `endpoints`, `endpointslice`, `ingress`) แล้วเปลี่ยนแต่ละ object เป็น target ที่มี metadata label เช่น `__meta_kubernetes_pod_name` จากนั้น `relabel_configs` ก็เก็บหรือทิ้ง target และ copy metadata ไปเป็น label จริง ส่วน label ที่ยังขึ้นต้นด้วย `__` จะถูกลบทิ้งทีหลัง Prometheus เติม `job` และ `instance` ให้ทุกอย่างที่มัน scrape และเขียน series ของตัวเองไม่กี่เส้นต่อการ scrape แต่ละครั้ง เช่น `up` (1 ถ้า scrape ได้ 0 ถ้าไม่ได้), `scrape_duration_seconds` และ `scrape_samples_scraped` ส่วน role `endpoints` อ่าน Endpoints API ที่ Kubernetes deprecate ไปใน v1.33 เอกสารของ Prometheus เลยแนะนำให้ใช้ `endpointslice` แทน

scrape configuration สำหรับ pod ของ catalog:

```yaml
global:
  scrape_interval: 15s       # the default is 1m
  evaluation_interval: 15s   # the default is 1m

scrape_configs:
  - job_name: catalog
    kubernetes_sd_configs:
      - role: pod
        namespaces:
          names: [shop]
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_label_app]
        regex: catalog
        action: keep                  # only the catalog pods
      - source_labels: [__meta_kubernetes_pod_name]
        target_label: pod             # keep the pod name as a label
```

ใน cluster หลายแห่ง Prometheus Operator จะเขียน configuration นี้ให้จาก resource `ServiceMonitor` และ `PodMonitor`

### TSDB: head, WAL, block และ retention

- **Head** sample ใหม่ไปลงที่ head ที่เป็นส่วนที่ใหม่ที่สุดของ database และอยู่ใน memory (chunk ที่เต็มแล้วจะถูก memory-map จาก `chunks_head/`) ก่อนจะเพิ่มเข้า head ตัว sample แต่ละชุดจะถูกเขียนลง **write-ahead log** ใน `wal/` เป็น segment ละ 128 MB ทำให้ตอน restart replay สิ่งที่ยังไม่ถึง disk ได้
- **Block** พอ head ครอบช่วงเวลาเกิน 3 ชั่วโมง ข้อมูล 2 ชั่วโมงที่เก่าที่สุดของมันจะถูกเขียนลง disk เป็น **block**: directory ที่มี chunk แบบบีบอัด, index จาก label ไป series, `meta.json` และไฟล์ tombstones สำหรับการลบ ส่วนตัว block ไม่เคยถูกเขียนทับที่เดิม
- **Compaction** block จะถูกรวมเป็น block ที่ยาวขึ้นใน background โดย block 2 ชั่วโมงสามก้อนเป็น block 6 ชั่วโมงหนึ่งก้อน แล้วก็ต่อไปเรื่อย ๆ จนถึง 10% ของ retention time หรือ 31 วัน แล้วแต่ว่าค่าไหนน้อยกว่า
- **Retention** block ทั้งก้อนจะถูกลบเมื่อหลุดออกนอกช่วง retention: 15 วันถ้าไม่ได้ตั้งขีดจำกัดเวลาหรือขนาดไว้เลย ใน Prometheus 3.15 ขีดจำกัดทั้งสองอยู่ในไฟล์ configuration และ flag `--storage.tsdb.retention.time` กับ `--storage.tsdb.retention.size` ถูก deprecate แล้ว:

```yaml
storage:
  tsdb:
    retention:
      time: 15d       # also the default when no time or size is set
```

เอกสาร storage บอกต้นทุนเฉลี่ยไว้ที่ 1 ถึง 2 byte ต่อ sample แล้ว disk ที่ต้องใช้ก็เลยประมาณ retention × sample ที่รับเข้าต่อวินาที × byte ต่อ sample ส่วนจำนวน series ที่ active เป็นตัวกำหนด memory และ local storage ก็เป็น database แบบ single-node: ไม่ได้เป็น cluster หรือ replicate และไม่รองรับ network file system อย่าง NFS รวมถึง Amazon EFS

### พื้นฐาน PromQL

- `rate(http_requests_total[5m])`: ค่าเฉลี่ยที่เพิ่มขึ้นต่อวินาทีในช่วง 5 นาทีล่าสุด มันถือว่าทุกครั้งที่ counter ลดลงคือการ restart แล้วบวกยอดที่หายไปกลับเข้ามา และ extrapolate ไปถึงขอบของ window ให้ทำ `rate()` ก่อนแล้วค่อย aggregate ไม่อย่างนั้นจะมองไม่เห็นการ reset
- `increase(http_requests_total[1h])`: การคำนวณแบบเดียวกัน แต่แสดงเป็นยอดรวมของ window
- `sum by (service) (…)` และ `sum without (pod) (…)`: aggregate ข้าม label ที่ทิ้งไป
- `histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))`: เปอร์เซ็นไทล์ที่ 99 จาก bucket ของ classic histogram มันหา bucket ที่มีเปอร์เซ็นไทล์ที่ 99 อยู่ แล้ว interpolate แบบเส้นตรงข้างในนั้น ถ้าเป็น native histogram ให้ตัด `_bucket` และ `le` ออก
- `… offset 1w`: expression เดียวกันเมื่อหนึ่งสัปดาห์ก่อน เอาไว้เทียบกับสัปดาห์ที่แล้ว

ตัวเลขใน animation คิดออกมาแบบนี้ ในทั้งสาม pod ตัว counter ของ 5xx โตตัวละ 2.4 ต่อวินาที และ request ทั้งหมดโต 120 ต่อวินาที ทำให้ `sum(rate(…{status=~"5.."}[5m])) / sum(rate(…[5m]))` ได้ 7.2 / 120 = 6% ตอน catalog-x2m restart ตัว counter ของมันตกจาก 1226 เหลือ 36 แล้ว `rate()` ก็นับ 36 นั้นเป็น request ใหม่ แทนที่จะนับเป็นการลดลง 1190 ทำให้ pod นี้ยังอ่านได้ 2.4 errors ต่อวินาที ส่วน latency bucket ต่อวินาทีมี 114 request ที่ไม่เกิน 0.25 s, 118.2 ที่ไม่เกิน 0.5 s และ 120 ที่ไม่เกิน 1 s เปอร์เซ็นไทล์ที่ 99 คือ request ตัวที่ 118.8 จาก 120 โดยที่ตำแหน่งนี้อยู่ที่หนึ่งในสามของ bucket 0.5–1 s: 0.5 + 0.5 × (118.8 − 118.2) / (120 − 118.2) ≈ 0.67 s

### Recording rule และ alerting rule

rule อยู่ใน rule group และถูก evaluate ตามลำดับทุก `evaluation_interval` **recording rule** รัน expression แล้วเก็บผลเป็น series ใหม่ ทำให้ dashboard และ alert อ่าน series ราคาถูกเส้นเดียว แทนที่จะคำนวณ query ราคาแพงใหม่ทุกครั้ง โดยมีธรรมเนียมการตั้งชื่อเป็น `level:metric:operations` ส่วน **alerting rule** จะ active ตราบใดที่ expression ของมันคืน series ออกมาอย่างน้อยหนึ่งเส้น: ถ้ามี clause `for` ตัว alert จะเป็น **pending** จนกว่าเงื่อนไขจะเป็นจริงนานพอในทุกการ evaluate แล้วค่อยเป็น **firing** ส่วน `keep_firing_for` ที่ใส่หรือไม่ใส่ก็ได้ จะคงสถานะ firing ไว้อีกพักหนึ่งหลังเงื่อนไขหายไป ช่วยกันการกะพริบไปมา Prometheus ส่ง alert ที่ firing ไปให้ Alertmanager ทุกตัวที่มันรู้จัก และส่งซ้ำไปเรื่อย ๆ ตราบที่ alert ยังอยู่ โดย default ไม่ถี่กว่านาทีละครั้ง (`--rules.alert.resend-delay`)

```yaml
groups:
  - name: catalog
    rules:
      - record: service:http_errors_per_request:ratio_rate5m
        expr: |
          sum by (service) (rate(http_requests_total{status=~"5.."}[5m]))
            /
          sum by (service) (rate(http_requests_total[5m]))
      - record: service:http_request_duration_seconds:p99_rate5m
        expr: |
          histogram_quantile(0.99,
            sum by (service, le) (rate(http_request_duration_seconds_bucket[5m])))
      - alert: CatalogHighErrorRate
        expr: service:http_errors_per_request:ratio_rate5m{service="catalog"} > 0.05
        for: 10m
        labels:
          severity: page
        annotations:
          summary: "Catalog 5xx ratio is {{ $value | humanizePercentage }}"
```

`promtool check rules` ตรวจไฟล์แบบนี้ได้ ส่วน `promtool test rules` รันมันกับ series สังเคราะห์ ถ้าป้อนตัวเลขของ animation ให้ group นี้จะคำนวณได้ 0.5% ก่อน incident และ 6% ระหว่าง incident คืนค่า 2.4 errors ต่อวินาทีให้ catalog-x2m ตลอดช่วงที่มัน restart และ 0.67 s สำหรับ p99 แล้ว alert ก็เป็น pending ประมาณ 4 นาทีหลัง error เริ่ม (window 5 นาทีต้องเต็มก่อน) และ firing อีก 10 นาทีหลังจากนั้น

### Alertmanager

Alertmanager เป็นโปรแกรมแยกที่รับ alert จาก Prometheus server หนึ่งตัวหรือมากกว่า แล้วตัดสินว่าจะทำอะไรกับมัน:

- **Grouping** alert ที่มีค่าของ label ใน `group_by` เหมือนกันจะรวมเป็น notification เดียว group ใหม่จะรอ `group_wait` (default 30 s) เผื่อมี alert ที่เกี่ยวข้อง การเปลี่ยนแปลงหลังจากนั้นถูกส่งออกไม่ถี่กว่าทุก `group_interval` (5 min) และ notification ที่ไม่เปลี่ยนจะถูกส่งซ้ำทุก `repeat_interval` (4 h)
- **Routing** tree ของ route จับคู่ label ของ alert กับ receiver: email, PagerDuty, Opsgenie, Slack, webhook และอื่น ๆ
- **Inhibition และ silence** inhibition rule ปิดเสียง alert ระหว่างที่ alert ที่เกี่ยวข้องและใหญ่กว่ากำลัง firing (ไม่มี page ว่า "pod down" ตอนที่ทั้ง cluster ล่ม) ส่วน silence ปิดเสียง alert ที่ match ไว้ตามเวลาที่กำหนด โดยสร้างจาก web interface ของ Alertmanager
- **High availability และ de-duplication** Alertmanager หลายตัวรวมเป็น cluster แบบ highly available ได้ด้วย flag `--cluster.*` ส่วน Prometheus แต่ละตัวควรส่ง alert ไปให้ทุกตัวโดยตรง ไม่ใช่ผ่าน load balancer แล้ว alert ที่เหมือนกันก็จะถูกตัดตัวซ้ำออก แม้จะมาจาก Prometheus server สองตัวก็ตาม

```yaml
route:
  receiver: catalog-oncall
  group_by: [alertname, service]
  group_wait: 30s          # the defaults: 30s, 5m and 4h
  group_interval: 5m
  repeat_interval: 4h

receivers:
  - name: catalog-oncall
    pagerduty_configs:
      - routing_key_file: /etc/alertmanager/pagerduty-key
```

`amtool check-config` ตรวจมันได้ ตัว Alertmanager อยู่ที่เวอร์ชัน 0.34 (กันยายน 2026)

### Grafana

Grafana เป็นโปรเจกต์แยกของ Grafana Labs ที่วาด dashboard จาก **data source**: Prometheus และอะไรก็ตามที่พูด query API ของมันได้ เช่น Grafana Mimir และ Thanos รวมถึง log, trace, SQL database และ cloud service ตัว Prometheus data source ติดตั้งมาให้แล้ว และรองรับ PromQL query, alerting, annotation และ exemplar **dashboard** คือชุดของ panel แต่ละ panel รัน query หนึ่งตัวหรือมากกว่าบนช่วงเวลาที่แสดงบนจอ แล้ววาดผลออกมา Grafana ยังมี alerting ของตัวเอง ที่ evaluate query จากหลาย data source ได้ ทำให้ทีมเก็บ alert rule ไว้ใน Prometheus, ใน Grafana หรือทั้งสองที่ก็ได้ major version ปัจจุบันคือ Grafana 13 อยู่ที่ 13.2.3 เมื่อ 29 กันยายน 2026 ส่วนใน Grafana 13 ตัว Prometheus data source หลักไม่จัดการ authentication แบบ AWS SigV4 หรือ Azure AD แล้ว และ Amazon Managed Service for Prometheus ก็มี data source plugin ของตัวเอง

### Exporter

software ที่ใส่ instrumentation ตรง ๆ ไม่ได้จะใช้ **exporter**: process เล็ก ๆ ที่อ่านสถิติของ software นั้นเองแล้วให้ออกมาเป็น `/metrics` ตัว `node_exporter` ให้ metric ของ hardware และ operating system จาก Linux และ Unix kernel อื่น ๆ ส่วน `kube-state-metrics` watch Kubernetes API แล้วเปลี่ยน state ของ object (deployment, pod, node) เป็น metric และ `blackbox_exporter` probe endpoint จากข้างนอกผ่าน HTTP, HTTPS, DNS, TCP, ICMP และ gRPC เว็บของ Prometheus มีรายชื่อ exporter สำหรับ database, message broker, proxy และ hardware

### Federation, remote_write และ high availability

- **Federation** Prometheus ตัวหนึ่ง scrape series ที่เลือกไว้จากอีกตัวได้ที่ `/federate` รูปแบบปกติเป็นลำดับชั้น: server หนึ่งตัวต่อ cluster หรือ data centre เก็บรายละเอียดไว้ แล้ว server ระดับ global ก็ดึง series ที่ aggregate แล้วจากพวกมัน
- **remote_write** ปลายทางแต่ละตัวที่ตั้งค่าไว้จะได้ queue ของตัวเอง ที่อ่าน sample จาก WAL แบ่งเป็น shard แล้วส่งต่อไป ถ้าปลายทางติดต่อไม่ได้ Prometheus จะ retry โดยไม่เสียข้อมูลได้นานประมาณ 2 ชั่วโมง หลังจากนั้น WAL จะถูกตัดทิ้ง และ sample ที่ยังไม่ได้ส่งก็หายไป protocol Remote Write 1.0 stable แล้ว ส่วน 2.0 ที่เพิ่ม metadata, exemplar, created timestamp และ native histogram และทำให้ payload เล็กลงด้วยการ intern string ที่ซ้ำกัน ยังเป็น experimental อยู่
- **Agent mode** `prometheus --agent` (stable ตั้งแต่ 3.0) ทำแค่ discover, scrape และ remote-write: ไม่มี query, rule หรือ alert ในเครื่อง และมีแค่ buffer สั้น ๆ ในเครื่อง
- **High availability** server ตัวเดียวคือ single point of failure และคำตอบของ FAQ คือให้รัน server ที่เหมือนกันบนเครื่องสองเครื่องหรือมากกว่า ทั้งคู่ scrape target ชุดเดียวกันและ evaluate rule ชุดเดียวกัน แล้ว Alertmanager ก็ตัด alert ที่เหมือนกันของทั้งคู่ออก ส่วน Thanos หรือ remote store ก็ตัดข้อมูลที่ซ้ำออกได้ ให้ replica แต่ละตัวมีค่า `external_labels` ของตัวเอง (เช่น `replica: a` และ `replica: b`) แล้วทิ้ง label นั้นใน `alert_relabel_configs` ตามที่เอกสารอธิบายไว้สำหรับกรณีนี้พอดี ทำให้ทั้งคู่ส่ง alert ที่เหมือนกันเป๊ะ

### Storage ระยะยาวและแบบ global

- **Thanos** (Apache 2.0 เป็นโปรเจกต์ CNCF ระดับ incubating) เพิ่ม component รอบ ๆ server ที่มีอยู่: sidecar ข้าง Prometheus แต่ละตัว upload block 2 ชั่วโมงของมันขึ้น object storage, querier ตอบ PromQL ข้าม server ทุกตัวและ bucket แล้วตัดข้อมูลซ้ำของคู่ HA และ compactor ทำ downsample ข้อมูลเก่า
- **Grafana Mimir** (AGPLv3) เป็น store ระยะยาวแบบ multi-tenant ที่ scale แนวนอนได้ สำหรับ metric ของ Prometheus และ OpenTelemetry โดยรับข้อมูลผ่าน remote write หรือ OTLP
- **VictoriaMetrics** (Apache 2.0) เป็น time-series database ที่รันได้ทั้งแบบ single node และ cluster ตัวมัน scrape target เองหรือผ่าน `vmagent` ได้ รับข้อมูล remote write, OTLP, InfluxDB และ Graphite แล้วตอบ query ด้วย MetricsQL ที่เอกสารของมันบอกว่า backwards-compatible กับ PromQL มันเก็บข้อมูล 1 เดือนโดย default

### Prometheus 3 และรอบการ release (ตุลาคม 2026)

Prometheus 3.0 (14 พฤศจิกายน 2024) เป็น major version แรกในรอบเจ็ดปี มันมาพร้อม web UI ใหม่ ชื่อ metric และ label แบบ UTF-8 เป็น default, OTLP receiver ที่อยู่หลัง `--web.enable-otlp-receiver`, Remote Write 2.0 เป็น protocol แบบ experimental และ agent mode เป็น feature ที่ stable มันยังเปลี่ยนพฤติกรรมด้วย: range selector และ lookback window ไม่นับ sample ที่ตกตรงจุดเริ่มต้นพอดี, การ scrape ที่ไม่มี `Content-Type` ที่ถูกต้องจะล้มเหลว, `holt_winters` กลายเป็น `double_exponential_smoothing` ที่อยู่หลัง feature flag และ v1 API ของ Alertmanager ที่ deprecated มานานก็ตั้งค่าไม่ได้อีกแล้ว ส่วน native histogram ตามมาเป็น feature ที่ stable ใน 3.8 (พฤศจิกายน 2025)

minor version ใหม่ออกทุกหกสัปดาห์ และบาง release เป็น long-term-support (LTS) ที่ได้ fix สำหรับ bug ร้ายแรงนานหนึ่งปี ในเดือนตุลาคม 2026 release ล่าสุดคือ **3.15** (24 กันยายน 2026) และ LTS release ที่ยังรองรับคือ **3.13** (1 กรกฎาคม 2026 รองรับถึง 31 กรกฎาคม 2027)

## อยู่ตรงไหนใน solution

- **Solution** monitor Kubernetes cluster และ service ที่อยู่บนนั้น อย่าง catalog ของ Acme Shop, dashboard ด้านสุขภาพของ service และ capacity, [SLO และ error budget](../slo-error-budgets/) ด้วย alert แบบ multiwindow, multi-burn-rate ที่ Google SRE Workbook เขียนเป็น Prometheus rule, [autoscaling](../autoscaling/) ตาม metric ของแอป ผ่าน Prometheus Adapter ที่ให้ผล Prometheus query ผ่าน custom และ external metrics API ของ Kubernetes สำหรับ Horizontal Pod Autoscaler หรือผ่าน Prometheus scaler ของ KEDA และ [telemetry pipeline](../telemetry-pipeline/) ที่ OpenTelemetry Collector ส่ง metric ไปให้ Prometheus ผ่าน OTLP หรือด้วย Prometheus remote write exporter ของมัน
- **Pattern ที่มัน implement หรือช่วยรองรับ** [Health endpoint monitoring](../health-endpoint-monitoring/) ผ่าน series `up` ของทุกการ scrape และ probe ของ `blackbox_exporter`, [SLO และ error budget](../slo-error-budgets/) ที่สร้างจาก recording rule และส่วน metric ของ observability ข้าง ๆ [centralized logging](../centralized-logging/) และ [distributed tracing](../distributed-tracing/) ส่วน exemplar ที่เก็บด้วย `--enable-feature=exemplar-storage` จะแนบ trace ID ไว้กับ sample ทำให้ Grafana กระโดดจาก bucket ที่ช้าไปที่ trace ตัวอย่างได้
- **เพื่อนบ้านที่มักเจอ** [Kubernetes](../kubernetes/) และ service discovery ของมัน, exporter อย่าง `node_exporter` และ `kube-state-metrics`, Alertmanager ที่มี PagerDuty, Slack หรือ e-mail อยู่ข้างหลัง, Grafana อยู่ข้างหน้า, store ระยะยาวอยู่ข้างหลัง และ OpenTelemetry Collector อยู่ที่ขอบ
- **Managed offering** **Amazon Managed Service for Prometheus** เป็น service แบบ serverless ที่ compatible กับ Prometheus: คุณส่งข้อมูลด้วย remote write (หรือให้ AWS managed collector ของมัน scrape Amazon EKS cluster โดยไม่ต้องมี agent) query ด้วย PromQL และรัน recording rule กับ alerting rule ด้วย alert manager ที่ส่งต่อไปที่ [Amazon SNS](../amazon-sns/) ข้อมูลถูก replicate ข้ามสาม Availability Zone และเก็บไว้ 150 วันโดย default ปรับได้ถึง 1,095 วัน **Amazon Managed Grafana** รัน Grafana workspace ที่มี single sign-on และมี data source ในตัวสำหรับ AWS service รวมถึง CloudWatch และ Amazon Managed Service for Prometheus ส่วน **Grafana Cloud** คือ Grafana แบบ hosted ของ Grafana Labs ที่มี metrics store ของตัวเองที่ compatible กับ Prometheus
- **License** Prometheus และ Alertmanager เป็น open source ภายใต้ Apache License 2.0 ตัว Prometheus เข้าร่วม Cloud Native Computing Foundation ในปี 2016 เป็นโปรเจกต์ที่สองต่อจาก Kubernetes ส่วน Grafana ย้ายจาก Apache 2.0 ไปเป็น AGPLv3 ในเดือนเมษายน 2021 โดยยังเก็บ plugin, agent และ library บางตัวไว้ใต้ Apache 2.0

## ใช้ตอนไหนดี

เลือก Prometheus กับ Grafana เมื่อ service ของคุณรันบน Kubernetes หรือ infrastructure แบบ dynamic อื่น ๆ เมื่อคุณอยากได้ metric ที่มี label ที่คุณเลือกเองและมีภาษา query ไว้หั่นมัน และเมื่ออยากให้ monitoring stack เป็น open source และย้ายข้าม cloud ได้ รันเองได้สำหรับ cluster หนึ่งหรือสองตัว แล้วค่อยเพิ่ม Thanos, Mimir, VictoriaMetrics หรือ managed service เมื่อต้องการ retention ยาว ๆ มุมมองแบบ global หรือข้อมูลของหลายทีมไว้ที่เดียว Prometheus ไม่เหมาะกับงานที่ต้องนับทุก event ให้ตรงเป๊ะ: เอกสารของมันเองยกตัวอย่างการคิดเงินราย request ว่าเป็นงานของระบบอื่น ส่วน log และ trace คุณต้องใช้เครื่องมืออื่นข้าง ๆ มัน

| | Prometheus with Grafana | Amazon CloudWatch | Datadog | VictoriaMetrics |
|---|---|---|---|---|
| What it is | metrics server, alert router และ dashboard แบบ open source | monitoring service ของ AWS: metric, log, alarm และ dashboard | SaaS เชิงพาณิชย์สำหรับ metric, log, trace และอื่น ๆ | time-series database แบบ open source ที่ compatible กับ Prometheus |
| How data gets in | pull: scrape `/metrics` และเปิด OTLP receiver กับ remote write receiver ได้ | AWS service publish metric ของตัวเองให้อัตโนมัติ ส่วน metric ของคุณมาจาก API, CloudWatch agent หรือ OTLP | Datadog Agent เป็นคนส่ง และ OpenMetrics check ของมัน scrape Prometheus endpoint ได้ | ได้ทั้งสองแบบ: scrape target หรือรับ remote write, OTLP, InfluxDB และ Graphite |
| Queries | PromQL | Metrics Insights ที่เป็น SQL dialect หนึ่ง สำหรับ classic metric และ PromQL สำหรับ OpenTelemetry metric | query editor ของ Datadog เอง | MetricsQL ที่ backwards-compatible กับ PromQL |
| Keeps data | 15 วันโดย default บน disk ของ server ตัวเดียว นานกว่านั้นได้ผ่าน remote storage | 15 เดือน โดยความละเอียดหยาบลงเมื่อข้อมูลเก่าขึ้น | 15 เดือนบน paid plan | 1 เดือนโดย default |
| Cost driver | server ของคุณเอง: series ที่ active เป็นตัวกำหนด memory | classic custom metric คิดต่อ metric ส่วน OpenTelemetry metric คิดต่อ GB ที่รับเข้า โดยรวม storage 15 เดือนไว้แล้ว | host และ custom metric: ทุกชุดของชื่อ metric กับค่า tag นับแยกกัน | server ของคุณเอง หรือ VictoriaMetrics Cloud |
| Who runs it | คุณเอง หรือ Amazon Managed Service for Prometheus กับ Amazon Managed Grafana หรือ Grafana Cloud | AWS | Datadog | คุณเอง หรือ VictoriaMetrics Cloud |
| Licence | Prometheus เป็น Apache 2.0 ส่วน Grafana เป็น AGPLv3 | proprietary service | proprietary service | Apache 2.0 |

ตัวเลขจากเอกสารของ Prometheus 3.15, Amazon CloudWatch, Datadog และ VictoriaMetrics และหน้า pricing ของ CloudWatch ตุลาคม 2026

## ได้อะไร เสียอะไร

- **label value ทุกค่าคือหนึ่ง series** memory, disk และเวลา query โตตามจำนวน series ที่ active และ label ที่ค่าไม่มีขอบเขตจะคูณจำนวนมันขึ้นไป: `user_id` บน request series 12 เส้นของ catalog (3 pod × 4 status code) แปลว่าได้ถึง 600,000 เส้นถ้ามีผู้ใช้ 50,000 คน แนวทางการตั้งชื่อห้ามใช้ user ID, e-mail address และค่าอื่นที่ไม่มีขอบเขตเป็น label
- **server เดียว disk เดียว** ข้อมูลในเครื่องเก็บไว้ 15 วันโดย default และไม่ได้ replicate ถ้าจะได้ high availability ก็ต้องรัน server ที่เหมือนกันสองตัว ส่วน retention ยาว ๆ หรือมุมมองแบบ global ต้องใช้ remote storage
- **การ pull ต้องเข้าถึง target ได้** Prometheus ต้องต่อถึง target ทุกตัวผ่าน network ทำให้ลำบากถ้าต้องข้าม NAT หรือ firewall และเป็นไปไม่ได้สำหรับ job ที่จบก่อนการ scrape รอบถัดไป ส่วน Pushgateway มีไว้สำหรับ batch job ระดับ service แต่เอกสารเตือนว่ามันเป็น single point of failure, series ของมันเสียสัญญาณสุขภาพ `up` ไป และมันจะให้ series ที่ถูก push มาไปเรื่อย ๆ จนกว่าจะถูกลบ
- **เป็น sample ไม่ใช่ event** counter ไม่เสียอะไรระหว่างการ scrape เพราะมันบวกเพิ่มอย่างเดียว แต่ gauge ถูกเห็นแค่ตอน scrape: spike ที่มาแล้วหายไปภายใน 15 วินาทีอาจหลุดไป และ metric ก็ไม่มีรายละเอียดราย request ส่วนเรื่องที่ว่า request ไหนพังและพังเพราะอะไร เป็นคำถามของ [log](../centralized-logging/) และ [trace](../distributed-tracing/)
- **มีหลายชิ้นต้องดูแล** Prometheus, Alertmanager, Grafana, exporter และอาจมี store ระยะยาว เป็นระบบแยกกันที่ต้อง config, upgrade และ monitor แต่ละตัวมีไฟล์ configuration ของตัวเอง
- **license ไม่เหมือนกัน** Prometheus เป็น Apache 2.0 แต่ Grafana กับ Mimir เป็น AGPLv3 ที่เงื่อนไขของมันมีผลถ้าคุณแก้มันแล้วเปิดให้คนอื่นใช้เป็น service

## ข้อควรรู้ตอนลงมือทำ

- **ใส่ instrumentation ด้วย counter และ histogram** นับ request และ error ด้วย counter วัด latency ด้วย histogram และทำตามแนวทางการตั้งชื่อ: ใช้หน่วยฐาน (วินาที, byte) ต่อท้าย counter ด้วย `_total` และต่อท้ายด้วยหน่วยอย่าง `_seconds`
- **คุม cardinality** ตั้ง `sample_limit` และ `label_limit` ใน scrape config ทำให้ deploy ที่พังหนึ่งครั้งทำให้แค่การ scrape ของมันเองล้มเหลว แทนที่จะกิน memory ของ server จนเต็ม ทิ้ง label ที่ไม่ต้องใช้ด้วย `metric_relabel_configs` และคอยดู `prometheus_tsdb_head_series`
- **กำหนดขนาด storage อย่างตั้งใจ** ประมาณ disk จาก retention, sample ต่อวินาที และ 1 ถึง 2 byte ต่อ sample ตั้ง `retention.size` (ถ้าใช้) ไว้ไม่เกิน 80–85% ของ volume ตามที่เอกสาร storage แนะนำ และเก็บข้อมูลบน local disk ห้ามใช้ NFS
- **alert ตามอาการ และใส่ `for`** page ตามสิ่งที่ผู้ใช้รู้สึกได้ (error ratio, latency, saturation) ไม่ใช่ทุกครั้งที่ pod restart ใช้ `for` เพื่อไม่ให้ spike สั้น ๆ ไป page ใคร แล้วใช้ `keep_firing_for` กันการกะพริบไปมา และใช้ burn-rate alert สำหรับ SLO ทดสอบ rule ด้วย `promtool test rules` และ configuration ด้วย `promtool check config` ก่อน deploy
- **รันคู่ HA ให้ถูก** server ที่เหมือนกันสองตัวที่มี external label `replica` แล้วเอามันออกอีกทีด้วย `alert_relabel_configs` แล้ว server ทุกตัวส่งไปที่ Alertmanager ทุกตัว และ Alertmanager รวมกันเป็น cluster
- **ป้องกัน endpoint** Prometheus และ exporter ของมันรองรับ TLS และ basic authentication ผ่านไฟล์ web configuration (`--web.config.file` ที่ยังติดป้าย experimental อยู่) อย่าให้ `/metrics`, HTTP API และโดยเฉพาะ OTLP receiver กับ remote write receiver อยู่บน public internet
- **บน Amazon EKS** ลองพิจารณา AWS managed collector และ Amazon Managed Service for Prometheus แทนการรัน server เอง และใช้ Amazon Managed Grafana ไว้ข้างหน้า
