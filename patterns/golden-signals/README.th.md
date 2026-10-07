## ปัญหา

monitoring มักโตจากล่างขึ้นบน ทุก incident ทิ้ง rule ไว้หนึ่งตัวสำหรับต้นเหตุที่มีคนเจอ: CPU เกิน 80%, disk เกิน 80%, garbage-collection pause นานเกิน 200 ms, pod ที่ restart ไปแล้ว ตัว search service ของ Acme Shop (คือช่อง search บนทุกหน้า catalog โดยตอน peak มี 1,200 request ต่อวินาที) สะสม rule แบบนี้ไว้ราว 140 ตัว rule พวกนี้ page หา on-call engineer ทุกคืน และแทบทุกครั้งเป็นเรื่องที่ไม่มีลูกค้าคนไหนสังเกต: pod ที่ CPU 85% ก็แค่ยุ่งอยู่เฉย ๆ หนังสือ SRE ของ Google อธิบายว่าเรื่องแบบนี้จบลงที่ไหน ถ้า page ดังถี่เกินไป คนก็จะอ่านผ่าน ๆ ไม่เชื่อมัน หรือเมินไปเลย แล้ว page ที่สำคัญจริงก็จมหายไปใน noise

อีกครึ่งหนึ่งของปัญหาคือสิ่งที่ rule พลาดไป ตัว rule ที่อิงต้นเหตุจะดังเฉพาะกับความล้มเหลวที่มีคนคาดไว้แล้ว เย็นวันเสาร์หนึ่ง search ช้าลง latency ที่ percentile ที่ 99 ขึ้นไปถึง 2.4 s นาน 40 นาที แต่ไม่มีอะไรดังเลย เพราะไม่มี rule ไหนดูสิ่งที่ผู้ใช้รู้สึก ทีมรู้เรื่องนี้จากลูกค้า ส่วน dashboard ก็มีจุดบอดเดียวกัน: กราฟรายเครื่องหลายสิบอันที่ตอบว่า "เครื่องนี้ยุ่งไหม" แต่ไม่มีอันไหนตอบว่า "search ทำงานอยู่ไหม"

## ทำงานยังไง

### Golden signal ทั้งสี่

แนวคิดนี้มาจากบทที่ 6 ของหนังสือ *Site Reliability Engineering* ของ Google (O'Reilly, 2016) ชื่อบท *Monitoring Distributed Systems* เขียนโดย Rob Ewaschuk และ edit โดย Betsy Beyer บทนี้เลือก signal สี่ตัวเป็นขั้นต่ำที่ต้องดูในทุกระบบที่ผู้ใช้เจอโดยตรง:

- **Latency**: request ใช้เวลานานแค่ไหน ให้แยก request ที่สำเร็จกับที่ fail ออกจากกัน request ที่ fail เพราะ connection ไป database หลุดไปแล้ว อาจตอบ HTTP 500 กลับภายในไม่กี่ millisecond และการเอา failure ที่เร็วมารวมเป็นตัวเลข latency ตัวเดียว ทำให้ service ที่ช้าดูเร็ว แต่ก็อย่าทิ้ง failure ไปด้วย: failure ที่ใช้เวลาหลายวินาทีด้วยจะทำร้ายผู้ใช้สองต่อ เลยให้ failure มี latency ของตัวเอง
- **Traffic**: ความต้องการที่เข้ามาที่ระบบ ในหน่วยที่เหมาะกับระบบนั้น: HTTP request ต่อวินาทีสำหรับ web service (แยกตามชนิดของ request ถ้าเรื่องนั้นสำคัญ), session หรือ bandwidth สำหรับ streaming, transaction ต่อวินาทีสำหรับ data store
- **Errors**: อัตราของ request ที่ fail โดยครอบคลุมทั้ง failure แบบชัดเจน (HTTP 500) แบบแฝง (HTTP 200 ที่เนื้อหาผิด เช่น รายการผลลัพธ์ว่างจาก index ที่พัง) และ failure ตาม policy (request ที่ช้ากว่าที่สัญญาไว้ก็นับว่า fail) ตัว status code ที่ load balancer จับแบบแรกได้ ส่วนแบบที่สองจับได้ก็ต่อเมื่อมีการตรวจที่ดูเนื้อหาเท่านั้น
- **Saturation**: service เต็มแค่ไหน วัดจาก resource ที่จะหมดก่อน: memory สำหรับ service ที่ติดที่ memory, I/O สำหรับ service ที่ติดที่ I/O และ connection pool สำหรับ search ของ Acme ระบบส่วนใหญ่ช้าลงตั้งแต่ก่อนถึง 100% นานแล้ว เลยให้ตั้ง utilisation target ของ resource นั้นไว้ต่ำกว่า 100% แล้ว latency ที่เพิ่มขึ้นก็มักเป็นสัญญาณแรกของ saturation และการคาดการณ์ saturation ไว้ก่อนก็คุ้ม (ตัวอย่างในหนังสือคือ disk ของ database ที่จะเต็มในสี่ชั่วโมง)

สิ่งที่บทนี้สัญญาไว้ไม่ได้ใหญ่โต: ทีมที่ดูครบทั้งสี่ตัว และ page หาคนเมื่อตัวใดตัวหนึ่งมีปัญหา (สำหรับ saturation คือเมื่อใกล้จะมีปัญหา) ก็ครอบคลุม service ของตัวเองได้ดีพอสมควร ใน diagram ตัว dashboard ของ search ที่สร้างใหม่อ่านได้ p50 140 ms และ p99 850 ms สำหรับ request ที่สำเร็จ, 1,200 request ต่อวินาที, error 0.4% (HTTP 5xx 0.3% บวกผลลัพธ์ว่าง 0.1%) และ saturation 92%: connection 46 จาก 50 ตัวใน pool กำลังถูกใช้ เกิน target 80%

### อาการกับต้นเหตุ, black box กับ white box

บทนี้มอง monitoring เป็นสองคำถาม: อะไรพัง และพังเพราะอะไร *อะไร* คืออาการ หรือ symptom (search ช้า) ส่วน *เพราะอะไร* คือต้นเหตุ หรือ cause (pool เต็มเพราะ price query ช้าลง) ให้ page ตามอาการ ตัว rule ที่ดูอาการตัวเดียวครอบคลุมทุกต้นเหตุ รวมถึงต้นเหตุที่ยังไม่มีใครนึกถึงด้วย ส่วน rule ที่ดูต้นเหตุจะ page ทั้งที่ผู้ใช้ยังสบายดี และก็ยังพลาดต้นเหตุใหม่ตัวถัดไปอยู่ดี ต้นเหตุควรอยู่บน dashboard เพราะบน dashboard มันช่วยให้คนที่โดน page หาปัญหาเจอ อะไรเป็นอาการหรือต้นเหตุขึ้นอยู่กับ layer: การอ่าน database ที่ช้าเป็นอาการสำหรับทีม database แต่เป็นต้นเหตุสำหรับทีม search

บทนี้ยังแยก monitoring แบบ **black-box** ที่ test ระบบจากข้างนอกแบบที่ผู้ใช้ทำ (probe ที่ลอง search) ออกจาก monitoring แบบ **white-box** ที่อ่านสิ่งที่ระบบรายงานเกี่ยวกับตัวเอง (latency histogram, pool gauge, log) การเช็กแบบ black-box เห็นแค่ปัญหาที่กำลังทำร้ายผู้ใช้อยู่แล้ว เลยเป็นแหล่ง page ที่ดี แต่ช่วยเตือนล่วงหน้าไม่ได้ ส่วน white-box metric คือสิ่งที่ใช้ debug และเป็นทางเดียวที่จะเห็นปัญหาที่กำลังมา เช่น disk ที่ค่อย ๆ เต็ม ทีมของ Google พึ่ง white-box monitoring เป็นหลัก และใช้ black-box monitoring เฉพาะที่สำคัญจริง ๆ แค่จำนวนน้อย

บทนี้โตมาจาก essay *My Philosophy on Alerting* ของ Rob Ewaschuk ที่เขียนจากช่วงที่เขาเป็น SRE ที่ Google บทสรุปของ essay ขอให้ page เป็นเรื่องที่ด่วน สำคัญ actionable และเป็นเรื่องจริง แนะนำให้ลบ alert ที่ noisy เพราะการมี alert มากเกินไปแก้กลับยากกว่าการมีน้อยเกินไป และเก็บ rule ที่อิงต้นเหตุไว้สำหรับหน้าผาที่เกิดไม่บ่อยและไม่มีอาการให้เห็นก่อน เช่น quota หรือ disk หมด

### RED: view เดียวกันสำหรับทุก service

**RED method** ของ Tom Wilkie ที่เขาคิดขึ้นในปี 2015 และนำเสนอที่ GrafanaCon EU ในปี 2018 เอา signal ฝั่งผู้ใช้มาใช้กับทุก service ที่ขับด้วย request ในระบบ microservice:

- **Rate**: request ต่อวินาที
- **Errors**: request พวกนั้น fail ไปกี่ตัว
- **Duration**: request ใช้เวลานานแค่ไหน ดูเป็น distribution ไม่ใช่ค่าเฉลี่ย

คุณค่าอยู่ที่ความเหมือนกันทุกที่ ทุก service ได้ panel สามอันเดียวกันสำหรับแต่ละ endpoint ทำให้ใครที่อยู่ on-call ก็อ่าน dashboard ของ service ที่ไม่เคยแตะมาก่อนได้ และ alert กับ SLO ก็เขียนแบบเดียวกันทุกที่ ตัว RED ตั้งใจตัด saturation ออก Wilkie สร้าง method นี้จาก golden signal สี่ตัวที่เขาเรียนรู้ตอนเป็น SRE ที่ Google และถือว่า saturation เป็นขั้นที่ advanced กว่า ไว้เพิ่มทีหลังเมื่อ rate, errors และ duration ลงตัวแล้ว ส่วน resource ที่ service รันอยู่ก็มี USE ครอบคลุมเรื่องนี้

### USE: checklist เดียวกันสำหรับทุก resource

**USE method** ของ Brendan Gregg (2012, ตีพิมพ์เป็นบทความใน ACM Queue ชื่อ *Thinking Methodically about Performance* และนำเสนอที่ FISL13) บอกว่า สำหรับทุก resource ให้เช็ก

- **Utilisation**: สัดส่วนเวลาที่ resource ไม่ว่าง
- **Saturation**: งานที่ resource ยังรับไม่ไหว ปกติจะรออยู่ในคิว
- **Errors**: จำนวน error event

resource เริ่มจาก hardware (CPU, memory, storage device, network interface, interconnect) และรวม software resource ได้ด้วย เช่น lock, thread pool และสำหรับ Acme คือ database connection pool: utilisation ของมันคือสัดส่วน connection ที่ใช้อยู่ ส่วน saturation คือจำนวน caller ที่รอ connection อยู่ ข้อสังเกตของ Gregg เรื่องการอ่านตัวเลขควรจำไว้: utilisation 100% มักแปลว่าเป็น bottleneck, resource บางตัวเริ่มต่อคิวให้เห็นชัดเมื่อเกินราว 70%, ค่าเฉลี่ยหลายนาทีบังช่วงไม่กี่วินาทีที่อยู่ที่ 100% ได้, saturation แค่นิดเดียวก็ทำร้ายได้ และ error counter ที่ยังไต่ขึ้นระหว่างที่ระบบช้าก็ควรเข้าไปดู เขายังเผยแพร่ checklist (สำหรับ Linux และระบบอื่น) ที่ระบุเครื่องมือหรือ metric ของแต่ละ resource ด้วย

ระวังคำว่า **saturation** เพราะสอง method ใช้คำนี้ต่างกัน ใน golden signal มันหมายถึง service เต็มแค่ไหน ในทางปฏิบัติก็คือ utilisation ของ resource ที่ตึงที่สุด: connection 46 จาก 50 คือ 92% ส่วนใน USE มันหมายถึงคิวที่อยู่หน้า resource: 12 request ที่รอ connection อยู่ ส่วนบนแต่ละ panel ให้ใส่ label ว่าแสดงความหมายไหน

### วางเทียบกัน

| | Golden signals | RED | USE |
|---|---|---|---|
| ที่มา | หนังสือ SRE ของ Google บทที่ 6 (2016) | Tom Wilkie (2015) | Brendan Gregg (2012) |
| ใช้กับ | service ที่ผู้ใช้เจอโดยตรง | ทุก service ที่ขับด้วย request แยกตาม endpoint | ทุก resource: CPU, memory, disk, network, pool, lock |
| วัด | latency, traffic, errors, saturation | rate, errors, duration | utilisation, saturation, errors |
| ตอบคำถาม | ผู้ใช้ได้คำตอบที่เร็วและถูกไหม และ service ใกล้เต็มแค่ไหน | แต่ละ service ให้บริการ caller ได้ดีไหม | resource ไหนเป็น bottleneck |
| เหมาะกับ | page และส่วนบนสุดของ dashboard ของ service | page, SLO และ layout ของ dashboard แบบเดียวสำหรับทุก service | debug, capacity planning และ ticket |

คำแนะนำเรื่อง dashboard ของ Grafana ก็แบ่งเส้นแบบเดียวกัน: USE อธิบายสุขภาพของเครื่อง ส่วน RED อธิบายประสบการณ์ของผู้ใช้ ตัว alert เลยควรอยู่บน view ของ RED (อาการ) และ view ของ USE คือที่ที่ใช้หาต้นเหตุ

### เชื่อมกับ SLO ยังไง

golden signal และ RED คือที่มาของ service level indicator ตัว SLO เปลี่ยน "p99 latency" ให้เป็นอัตราส่วนของ event ที่ดี (เช่น search ที่ตอบได้ภายใน 800 ms) ต่อ event ที่ valid พร้อม target ในช่วง window หนึ่ง และ error ก็กลายเป็น availability indicator ด้วยวิธีเดียวกัน พอ service มี SLO แล้ว burn-rate alert ([SLOs & Error Budgets](../slo-error-budgets/)) ก็เป็น page ที่ดีกว่า threshold ตายตัวอย่าง "p99 เกิน 800 ms นาน 10 นาที": มันจะ page เร็วเมื่อมี outage ใหญ่ ช้ากว่านั้นเมื่อเป็นการรั่วแบบช้า ๆ และไม่ page เลยกับการสะดุดเล็ก ๆ ที่ budget รับไหว ส่วน threshold ตายตัวก็เป็นก้าวแรกที่สมเหตุสมผลสำหรับทีมที่ยังไม่มี SLO

## ลงมือทำจริงยังไง

1. **ไล่รายการว่าให้บริการอะไรและรันอยู่บนอะไร** สำหรับ service ที่ขับด้วย request แต่ละตัว ให้ไล่ endpoint ของมัน และสำหรับแต่ละ service ให้ไล่ resource ของมัน: CPU และ memory เทียบกับ limit ของ container, connection pool และ thread pool, queue, disk และ downstream service ที่มันเรียก
2. **วัด RED ด้วย histogram** บันทึก request duration เป็น histogram ที่ติด label ตาม endpoint และ outcome ทำให้ request ที่สำเร็จกับที่ fail ถูกจับเวลาแยกกัน และนับ failure ที่ตอบ 200 (ผลลัพธ์ว่างของ query ที่ควรเจอผล หรือหน้า fallback) ด้วย counter แยกของมันเอง ใน Prometheus ให้คำนวณ p99 ด้วย `histogram_quantile()` จาก rate ของ bucket ที่ sum แล้ว เอกสารของ Prometheus ตอนนี้แนะนำ native histogram ถ้า client library รองรับ แต่ยังมีไม่กี่ตัวที่รองรับ ส่วน classic histogram ที่ bucket ตายตัวใช้ได้แทบทุกที่ อย่าใช้ summary ตรงนี้: quantile ของ summary รวมข้าม pod หกตัวของ Acme ไม่ได้ ใน Amazon CloudWatch สถิติ percentile อย่าง p99 ใช้กับ custom metric ที่ publish เป็นค่าดิบได้ และ Application Load Balancer รายงาน `TargetResponseTime` (ที่รองรับ percentile), `RequestCount` และ `HTTPCode_Target_5XX_Count`
3. **วัด USE ของ resource ต่าง ๆ** node_exporter ครอบคลุม node และ collector `pressure` ของมันก็เปิดข้อมูล pressure-stall ของ Linux ออกมา เป็น saturation signal โดยตรง ส่วน cAdvisor ครอบคลุม container โดยที่ limit ของ container ก็เป็น resource เหมือนกัน: `container_cpu_cfs_throttled_seconds_total` (เวลาที่โดน throttle ที่ CPU limit) และ `container_oom_events_total` (การโดน kill เพราะ memory หมด ที่ checklist Linux ของ Gregg นับเป็น memory saturation) แสดงว่า container กำลังชน limit ของตัวเอง ส่วน software resource ก็มี library ครอบคลุม: เช่น HikariCP รายงาน connection ที่ active, maximum และ pending รวมถึง acquisition timeout (`hikaricp.connections.active`, `.max`, `.pending` และ `.timeout` ผ่าน Micrometer) ตัวเลขพวกนี้แมปตรงกับ utilisation, saturation และ errors
4. **รู้ limit ทุกตัว** saturation เป็นเศษส่วน เลยต้องบันทึกตัวหารไว้ข้างค่าที่ใช้อยู่ สำหรับ pool ตัว Little's law ให้ค่า occupancy ที่คาดได้: connection ที่ใช้อยู่ ≈ request ต่อวินาที × จำนวนวินาทีที่แต่ละ request ถือ connection ไว้ ที่ 1,200 request ต่อวินาที ตัว price query ที่ใช้ 30 ms จะทำให้ connection 36 จาก 50 ตัวของ Acme ไม่ว่าง (72%) แต่ที่ 38 ms หลัง deploy วันศุกร์ จะไม่ว่าง 46 ตัว (92%) และ burst ก็เริ่มต่อคิว
5. **วาง dashboard จากบนลงล่าง** หนึ่ง dashboard ต่อหนึ่ง service ที่มี signal สี่ตัวอยู่ด้านบน แถว RED หนึ่งแถวต่อหนึ่ง service เรียงตามลำดับที่ request ไหลผ่าน และ link ลงไปที่ view แบบ USE ของแต่ละ resource คำแนะนำของ Grafana เพิ่มอีกว่าให้ใช้ template variable แทนการ copy dashboard ให้เก็บ dashboard JSON ไว้ใน version control และให้ alert มี link ไปที่ dashboard ที่อธิบายมัน
6. **เขียน alert ใหม่** ให้ page ตามอาการ ให้สูงขึ้นไปใน stack เท่าที่ทำได้ และ page ครั้งเดียวต่อหนึ่ง stack (คู่มือ alerting ของ Prometheus แนะนำให้ page เรื่อง latency ที่จุดเดียวเท่านั้น): p99 ของ search เกิน 800 ms นาน 10 นาที หรือ SLO burn rate แล้วให้ทุก page มี link ไปที่ dashboard และ runbook ของมัน จากนั้นคัดแยก rule เก่าที่ดูต้นเหตุ: ลบทิ้ง ย้ายไปไว้บน dashboard หรือเปลี่ยนเป็น ticket สำหรับเรื่องที่ต้องมีคนจัดการภายในสัปดาห์นี้แต่ไม่ใช่คืนนี้ เก็บ page ที่อิงต้นเหตุไว้เฉพาะหน้าผาที่ไม่มีอาการให้เห็นก่อน เช่น disk ที่จะเต็มภายในไม่กี่ชั่วโมง
7. **เพิ่ม black-box probe** ที่ลอง search จากนอก cluster ให้ failure ของ DNS, CDN และ load balancer โผล่มาให้เห็นด้วย
8. **Review อย่างสม่ำเสมอ** หนังสือ SRE แนะนำให้เอา rule และข้อมูลที่ไม่ค่อยได้ใช้ออก (สำหรับบางทีมของ Google คือใช้น้อยกว่าไตรมาสละครั้ง) รวมถึง signal ที่ไม่มี dashboard หรือ alert ไหนอ่าน นับ page ต่อ on-call shift และถามกับทุก page ว่ามันด่วน actionable และเป็นเรื่องจริงไหม

## อยู่ตรงไหนใน solution

- [SLOs & Error Budgets](../slo-error-budgets/) เปลี่ยน signal ด้าน latency และ error ให้เป็น indicator ที่มี target และเอา burn-rate alert มาแทน threshold ตายตัว
- [Prometheus & Grafana](../prometheus/) และ [Amazon CloudWatch](../amazon-cloudwatch/) เก็บ metric คำนวณ percentile ประเมิน alert rule และวาด dashboard
- [Telemetry Pipeline (OpenTelemetry)](../telemetry-pipeline/) เก็บ metric จากทุก service แล้วส่งไปในรูปแบบเดียวกันให้ backend ตัวไหนก็ได้ที่ใช้อยู่
- [Distributed Tracing](../distributed-tracing/) และ [Centralized Logging](../centralized-logging/) รับช่วงต่อจากจุดที่ RED และ USE หยุด: trace บอกว่า call ไหนใน request ที่ช้าเป็นตัวกินเวลา และ log ก็แสดง error แต่ละตัว
- [Health Endpoint Monitoring](../health-endpoint-monitoring/) กัน instance ที่พังออกจาก rotation ด้วย liveness check และ readiness check ส่วน black-box probe ของ user journey ช่วยเสริม และไม่มีตัวไหนแทน signal สี่ตัวได้
- [Bulkhead](../bulkhead/): pool ที่มีขอบเขตอย่าง connection 50 ตัวของ search service ก็คือ bulkhead และตัวเลข USE ของมันบอกว่ามันกลายเป็นตัวจำกัดตอนไหน
- [Incident Management](../incident-management/): page จาก golden signal มักเป็นจุดเริ่มต้นของ incident

## ใช้ตอนไหนดี

- **ทุก service ที่มีผู้ใช้และมี on-call rotation** รวม internal platform ด้วย ตัว signal สี่ตัวเป็นชุดที่เล็กที่สุดที่ยังมีประโยชน์ และ RED ทำให้ทุกทีมได้ layout ของ dashboard แบบเดียวกัน คุ้มทันทีที่ engineer ต้องอยู่ on-call ให้ service ที่ตัวเองไม่ได้เขียน
- **ตอนที่ page ดังถี่จนน่ารำคาญ** rule ที่ดูอาการไม่กี่ตัวแทน rule ที่ดูต้นเหตุได้หลายตัว ทำให้ page ที่เหลืออยู่คุ้มที่จะรับ
- **สำหรับงาน capacity และการ debug** ที่ USE ให้ checklist ครบ เลยไม่มี resource ไหนถูกข้ามเพราะไม่มีใครนึกถึง

จุดที่ต้องปรับ:

- **Batch job และ pipeline** ไม่มี request rate หรือ latency ต่อ request ให้ดู freshness ความสำเร็จของการรันครั้งล่าสุด และอายุของ item ที่เก่าที่สุดที่ยังไม่ได้ process ส่วนคู่มือ alerting ของ Prometheus แนะนำให้ page เมื่อ batch job ไม่สำเร็จมานานพอจะทำให้ผู้ใช้เห็นปัญหา
- **Queue consumer** อธิบายได้ดีกว่าด้วย consumer lag และอายุของ message ที่เก่าที่สุด มากกว่าด้วย latency
- **Service ที่ traffic น้อย** ให้ percentile ที่ noisy: p99 ของ 50 request ก็คือ request ที่ช้าที่สุดตัวเดียวนั่นเอง ให้ใช้ window ที่ยาวขึ้น นับจำนวน request ที่ช้า หรือใช้ synthetic probe
- **ระบบ legacy ที่ instrument ไม่ได้**: เริ่มจาก metric และ log ของ load balancer บวก black-box probe
- **สภาพแวดล้อมที่อยู่ใต้ regulation** อาจบังคับให้มี alert บนต้นเหตุเฉพาะบางอย่าง (backup ที่ fail, certificate ที่ใกล้หมดอายุ, audit log ที่หยุดเข้ามา) ให้เก็บไว้ โดยทำเป็น ticket ทุกครั้งที่ deadline ยอม
- **มันไม่ได้ฟรี** หนังสือ SRE บอกว่าทีม SRE ของ Google ขนาด 10 ถึง 12 คน ปกติจะมีหนึ่งหรือสองคนที่งานหลักคือสร้างและดูแล monitoring ของทีม ส่วน histogram ก็ทวีจำนวน time series ตาม bucket และ label ด้วย เลยควรจำกัด label ไว้แค่ endpoint กับ outcome

## กับดักที่เจอบ่อย

- **เอา latency มาเฉลี่ย** ค่า mean บัง tail ตัวอย่างในหนังสือ SRE คือ service ที่ latency เฉลี่ย 100 ms ที่ 1,000 request ต่อวินาที โดยที่ 1% ของ request อาจใช้เวลา 5 วินาที ให้อ่าน percentile จาก histogram และห้ามเฉลี่ย percentile ข้าม pod: ให้ sum bucket ก่อน แล้วค่อยคำนวณ percentile
- **Page ตามต้นเหตุ** CPU 85% เป็นแค่ค่าที่อ่านได้ ไม่ใช่ปัญหา ให้ page ตามสิ่งที่ผู้ใช้รู้สึก แล้วเอาต้นเหตุไปไว้บน dashboard และใน ticket
- **นับแค่ 5xx** ตัว error ที่กลับมาเป็น HTTP 200 (ผลลัพธ์ว่าง, เนื้อหา fallback, ราคาที่ผิด) จะไม่โผล่ให้เห็นเลย ให้นับคำตอบที่ผิดด้วย counter ในแอปพลิเคชัน และใช้ black-box check ที่ตรวจเนื้อหา
- **รวม latency ของ request ที่สำเร็จกับที่ fail เป็นตัวเดียว** error ที่เร็วทำให้ service ที่ช้าดูเร็ว ให้ติด label ตาม outcome บน histogram
- **Saturation ที่ไม่มี limit** ตัวเลข connection ที่ใช้อยู่ 46 ตัวไม่บอกอะไรเลยจนกว่าจะรู้ว่ามีทั้งหมด 50 ให้บันทึก limit ไว้ แสดงค่าเป็นเศษส่วน และตั้ง target ไว้ต่ำกว่า 100%
- **Saturation สองความหมาย** panel ของ golden signal กับ panel ของ USE อาจเขียนว่า "saturation" ทั้งคู่ แต่หมายถึงคนละอย่าง ให้ติด label ให้ชัด
- **Dashboard ที่มี 60 กราฟ** ไม่มีใครอ่านมันระหว่าง incident ให้วาง signal สี่ตัวไว้ด้านบน แถว RED หนึ่งแถวต่อ service ไว้ข้างล่าง แล้ว drill down ไปที่ USE และคอยดูจำนวน dashboard ด้วย: คำแนะนำของ Grafana เตือนเรื่อง sprawl คือการที่ dashboard ที่ copy มาและที่ทำไว้ใช้ครั้งเดียวงอกขึ้นมาโดยไม่มีใครคุม
- **Page ที่ไม่มีใครทำอะไรได้** ถ้าสิ่งที่ต้องทำทุกครั้งคือ ack แล้วรอ หรือเป็นขั้นตอนตาม script แบบเดิมทุกครั้ง ก็ไม่ควร page: ทำเป็น ticket, automate มัน หรือลบทิ้ง ทุก page ควรเป็นเรื่องที่ต้องมีคนมาคิดตอนนี้เลย
- **ลืมดู traffic** การที่ request ลดฮวบก็เป็นอาการเหมือนกัน: ผู้ใช้เข้าถึงเราไม่ได้ หนังสือ SRE ที่ปกติเลี่ยง anomaly detection แบบฉลาด ๆ ก็ยังเก็บ rule ง่าย ๆ ไว้จับการเปลี่ยนแปลงที่ไม่คาดคิดของ request rate จาก end user
