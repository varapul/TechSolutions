## ปัญหา

ตอนนี้ request เดียวของ user วิ่งผ่าน gateway, service หลายตัว, database และอาจมี queue อีกตัว พอมันช้าหรือพัง log กับ metric ของแต่ละ component ก็เล่าได้แค่ส่วนของตัวเอง: gateway รายงานว่า 240 ms ตัว Orders ดูช้า ส่วน Payments ดูยุ่ง แล้วก็ไม่มีใครบอกได้ว่าเวลาหายไปที่ไหนจริง ๆ จะมานั่งจับคู่ timestamp ข้ามเครื่องเองก็ไม่ scale แถม clock skew ก็ทำให้มันเชื่อถือไม่ได้อยู่ดี

## ทำงานยังไง

**trace** บันทึก request หนึ่งตัวเป็น tree ของ **span** โดย span หนึ่งตัวคือ operation หนึ่งอย่างที่จับเวลาไว้ (HTTP handler, การเรียกออกไปข้างนอก, query) มีชื่อ, เวลาเริ่มและเวลาจบ, status, attribute และ ID ของ parent span ตัว model นี้มาจาก paper Dapper ของ Google (2010) และเป็นพื้นฐานของ Zipkin, Jaeger และ OpenTelemetry การทำ tracing มีสองส่วน:

1. **ส่งต่อ context ไปกับ request (in band)** component แรกที่ติด instrumentation และเจอ request ที่ไม่มี context จะเริ่ม trace ใหม่ การเรียกออกไปข้างนอกทุกครั้งจะพา context ไปด้วย และตัวที่รับทุกตัวก็ต่อ trace นั้นไป รูปแบบมาตรฐานบนสายคือ W3C Trace Context:

   ```text
   traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
                │  │                                │                └ trace-flags: 01 = sampled
                │  │                                └ parent-id: the caller's span ID (8 bytes)
                │  └ trace-id: shared by every span in the trace (16 bytes)
                └ version
   tracestate:  rojo=00f067aa0ba902b7,congo=t61rcWkgMzE
   ```

   `traceparent` คือส่วนที่ tracer ทุกตัวที่ทำตามมาตรฐานเข้าใจ ส่วน `tracestate` พา entry เฉพาะของแต่ละ vendor ไปด้วยกัน ทำให้ระบบ tracing หลายตัวตาม request เดียวกันได้ ในทางปฏิบัติ SDK ยังเปิด span ฝั่ง *client* ให้การเรียกออกไปแต่ละครั้งด้วย ทำให้ parent ของตัวที่ถูกเรียกเป็น client span นั้น ส่วนใน diagram รวม client span กับ server span ไว้เป็นแท่งเดียวต่อหนึ่ง service

2. **Export span แยกออกไปต่างหาก (out of band)** tracing SDK ของแต่ละ service เก็บ span ที่ยังเปิดอยู่ไว้ใน memory พอ span จบก็เข้า queue แล้ว batch processor ก็ส่ง queue ออกไปเบื้องหลัง ส่วนใหญ่ผ่าน OTLP (OpenTelemetry protocol) ไปที่ **collector** ตัว collector จะ batch, filter, ปิดบังข้อมูล และ sample span แล้วส่งต่อไปที่ backend หนึ่งตัวหรือมากกว่า จากนั้น backend ก็เอา span มาต่อกันตาม trace ID และ parent ID ให้เป็น waterfall

## ใช้ตอนไหนดี

- request ไหนก็ตามที่ข้ามมากกว่าหนึ่ง process: microservices, serverless ที่เรียกต่อกันเป็นทอด ๆ, service mesh, flow แบบ event-driven
- งานด้าน latency (hop ไหนเป็นเจ้าของ p99), การหา root cause (การเรียกไหนพังก่อน) และการทำแผนที่ dependency เพราะ backend ส่วนใหญ่สร้าง service graph จาก span ได้
- มีคุณค่าน้อยลงถ้าเป็น process เดียวที่มี database ตัวเดียว ตรงนั้น profiler กับ log ดี ๆ ช่วยได้มากกว่า แต่ span ของ database ก็ยังมีประโยชน์อยู่
- ไม่ได้มาแทน metric: trace ที่ถูก sample ให้ rate หรือยอดรวมที่แม่นไม่ได้ เพราะฉะนั้นให้ตั้ง alert จาก metric แล้วใช้ trace อธิบายมัน

## ได้อะไร เสียอะไร

- **ช่องโหว่ทำให้ trace ขาด** hop ไหนก็ตามที่ทิ้ง header ไป (service ที่ไม่ได้ติด instrumentation, proxy ที่ตัด header ที่ไม่รู้จักทิ้ง, queue ที่ไม่มี message header) จะทำให้ trace เดียวแตกเป็นสอง ครอบคลุมให้กว้างสำคัญกว่าครอบคลุมให้ลึก
- **trace ทุกอย่างแพง** span ทุกตัวกิน CPU และ memory ใน service, network egress, capacity ของ collector รวมถึง ingest และ storage ของ backend โดยที่ vendor มักคิดเงินต่อ span หรือต่อ GB ถ้า request rate สูง trace ก็อาจกลายเป็นบิล telemetry ก้อนใหญ่ที่สุด
- **Head sampling หรือ tail sampling** *Head sampling* ตัดสินที่ root (เช่น sampler แบบ parent-based และ trace-ID-ratio ที่เก็บไว้ 10%) แล้วส่งผลการตัดสินลงไปข้างล่างผ่าน flag sampled วิธีนี้ประหยัดและสม่ำเสมอ แต่มองไม่เห็นผลลัพธ์ มันเลยทิ้ง error ไป 90% ด้วย ส่วน *tail sampling* ตัดสินใน collector หลัง trace ครบแล้ว (เก็บทุก error, ทุก trace ที่เกิน 500 ms และ 1% ของที่เหลือ) ราคาที่ต้องจ่ายคือ tier แบบ stateful ที่ต้อง buffer trace ทั้งก้อน และต้องได้รับทุก span ของ trace นั้น ตัว span เลยต้องถูก route ไปหามันตาม trace ID
- **Clock skew** timestamp ของ span มาจากคนละเครื่อง span ลูกเลยอาจดูเหมือนเริ่มก่อน parent ระยะเวลาที่วัดใน process เดียวกันเชื่อถือได้ ส่วนระยะห่างระหว่างเครื่องเป็นแค่ค่าประมาณ
- **Context ที่เชื่อถือไม่ได้** caller ที่ตั้ง flag sampled ให้ทุก request ทำให้เราต้องบันทึกทุกอย่างได้ spec ของ W3C แนะนำให้แยกจัดการ request ที่ authenticate แล้วกับที่ยังไม่ได้ authenticate และจำกัด rate ของสิ่งที่บันทึก ตรง edge หลายที่ก็เริ่ม trace ใหม่ให้ traffic จากข้างนอก

## ข้อควรรู้ตอนลงมือทำ

- **OpenTelemetry คือค่า default ที่ไม่ผูกกับ vendor** แต่ละ service ใช้ API และ SDK ของ OpenTelemetry กับ propagator `tracecontext` และ `baggage` ของ W3C (เป็นค่า default) แล้ว export OTLP ไปที่ OpenTelemetry Collector ตัว collector นี้ deploy ได้ทั้งแบบ agent ข้าง workload, แบบ gateway tier กลาง หรือทั้งสองแบบ จากนั้นการเพิ่มหรือเปลี่ยน backend (Jaeger, Grafana Tempo, Zipkin, AWS X-Ray, Google Cloud Trace, Azure Monitor หรือ APM เชิงพาณิชย์) ก็แค่แก้ configuration ของ collector ไม่ต้องแก้โค้ด
- **Instrumentation แบบอัตโนมัติกับแบบเขียนเอง** agent แบบ zero-code และ instrumentation library จัดการงานเดินท่อให้: HTTP และ gRPC ทั้งขาเข้าและขาออก, database driver, messaging client รวมถึงการ inject และ extract header ส่วน instrumentation ที่เขียนเองเพิ่มสิ่งที่มีแต่โค้ดของเรารู้: span ครอบขั้นตอนทางธุรกิจ, **attribute** ที่จะใช้ filter (`order.id`, `payment.provider` โดยใช้ semantic convention ถ้ามี), **event** สำหรับจังหวะต่าง ๆ ข้างใน span (retry, cache miss, exception) และ error status ตอนพัง ส่วน OpenTelemetry กำลังจะ deprecate API ของ span event (`AddEvent`, `RecordException`) โค้ดใหม่เลยควรส่ง event และ exception ผ่าน Logs API โดยผูกไว้กับ span ปัจจุบัน ส่วน span event ที่มีอยู่แล้วก็ยังใช้ได้ต่อ
- **เชื่อม log กับ metric** ประทับ `trace_id` และ `span_id` ลงทุกบรรทัดของ log (logging integration ของ OpenTelemetry ทำให้) จะได้กระโดดจาก log ไปที่ trace ของมันและกลับมาได้ ฝั่ง metric มี **exemplar** ที่แปะ trace ID ของค่าตัวอย่างไว้กับ bucket ของ histogram ทำให้ p99 ที่พุ่งขึ้นบน dashboard ลิงก์ตรงไปที่ trace ที่ช้าได้
- **ข้ามขอบเขตแบบ async** สำหรับ queue และ topic ให้ inject context ลงใน message header: record header ของ Kafka, header ของ AMQP, message attribute ของ SQS หรือ distributed-tracing extension ของ CloudEvents แล้ว consumer ก็ extract ออกมาและ link span ของตัวเองกับ span ของ producer ถ้า span เดียวประมวลผล message เป็น batch ก็ต้องใช้ span link แทน parent เพราะเป็นทางเดียวที่ทำได้ ภายใน process ต้องดูให้ thread pool และ callback พา context ไปด้วย (ปกติ instrumentation จะครอบ executor ไว้ให้)
- **baggage ต้องเล็กและไม่มีพิษภัย** `baggage` ของ W3C ส่งคู่ key-value ไปทุก hop ข้างล่าง รวมถึง API ของ third party ที่เราเรียกด้วย และมันจะไม่ถูกเพิ่มลงใน span ถ้าเราไม่ก็อปไปใส่เอง ห้ามใส่ secret, token หรือข้อมูลส่วนบุคคลลงไปเด็ดขาด และตัดทิ้งที่ trust boundary ส่วน attribute ของ span ก็ต้องระวังแบบเดียวกัน: ปิดบัง PII ในโค้ดหรือใน collector
- **Service mesh** (Envoy, Istio, Linkerd) สร้าง span ให้ทุก hop ได้โดยไม่ต้องแก้โค้ด แต่แอปพลิเคชันก็ยังต้องก็อป trace header จาก request ขาเข้าแต่ละตัวไปใส่การเรียกขาออกเอง proxy ต่อสองฝั่งนี้ให้เราไม่ได้
