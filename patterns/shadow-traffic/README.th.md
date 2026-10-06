## ปัญหา

เวอร์ชันใหม่อาจผ่าน test ทุกตัวแต่ก็ยังพังใน production ได้ เพราะ production คือที่ที่ input, ปริมาณ และช่วงเวลาเป็นของจริง test suite ครอบคลุมกรณีที่มีคนนึกถึง แต่ traffic จริงยังพากรณีที่ไม่มีใครนึกถึงมาด้วย: ช่องค้นหาที่ว่างเปล่า, locale ที่ไม่มีใครลอง, เลขหน้าที่เลยหน้าสุดท้ายไปไกล, client ที่ส่ง header มาในรูปที่ไม่คาดคิด load test เล่นซ้ำ traffic ผสมแบบในอุดมคติ ส่วนการรันบน staging ก็ใช้เวลาแค่ไม่กี่นาที ไม่ใช่หลายชั่วโมงที่ memory leak แบบช้า ๆ ต้องใช้กว่าจะโผล่ออกมา

วิธีปกติที่จะได้เจอ traffic จริงคือให้ user จริงไปเจอเวอร์ชันใหม่ [canary release](../canary-release/) ส่ง request ส่วนเล็ก ๆ ไปให้มันแล้วเฝ้าดู metric ของมัน วิธีนี้ก็ใช้ได้ แต่ user ในส่วนนั้นจะได้อะไรก็ตามที่เวอร์ชันใหม่ตอบ รวมถึง error ด้วย สำหรับการเขียนใหม่ทั้งหมด, runtime หรือ framework ใหม่, data access layer ใหม่ หรือการเปลี่ยนเรื่อง performance การได้เห็นเวอร์ชันใหม่ภายใต้โหลดเต็มของ production ก่อนที่ user สักคนจะต้องพึ่งมันนั้นคุ้มค่า

## ทำงานยังไง

proxy ที่อยู่หน้า service ส่งทุก request ไปที่เวอร์ชันที่ live อยู่คือ **v1** และส่ง response ของ v1 กลับไปให้ผู้เรียกเหมือนเดิมทุกอย่าง ในแต่ละ request มันยังส่งสำเนาไปที่เวอร์ชันใหม่คือ **v2** ด้วย ตัว v2 รันข้าง ๆ v1 ในฐานะ *shadow* ส่วน proxy ไม่รอ v2 และทิ้ง response ของมันไป Istio เรียกแบบนี้ว่า "fire and forget": สำเนาวิ่งอยู่นอก critical path ของ request ต้นฉบับ

1. **Mirror สำเนาของ traffic จริง** rule ใน proxy เขียนว่า route ไป v1, mirror ไป v2, 100% จากนั้น request ของ user ก็ไปถึง v1 แล้ว v1 ก็ตอบใน 90 ms ส่วนสำเนาไปถึง v2 ที่ใช้เวลา 1.2 s แล้วคำตอบของมันก็ถูกทิ้งที่ proxy ไม่มีใครรอ v2 และไม่มีใครเห็นว่ามันตอบอะไร
2. **ดู v2 ภายใต้โหลดจริง** ตอนนี้ v2 เห็น request คละแบบตามจริงในปริมาณเท่า production และ metric ของมันเองที่วางเทียบกับของ v1 สำหรับ traffic เดียวกันคือสิ่งที่ต้องเฝ้าดู การค้นหาด้วย query ว่าง (`GET /search?q=`) ทำให้ v2 คืน 500 ขณะที่ user ได้ 200 จาก v1 และไม่รู้อะไรเลย p99 latency ของ v2 ตอนเจอ request คละแบบจริงสูงกว่าตอน load test และ memory ของมันก็ไต่ขึ้นเรื่อย ๆ ตลอดหกชั่วโมง: leak ที่ test สิบนาทีไม่มีวันเห็น
3. **เทียบ response** mirror อย่างเดียวบอกได้ว่า v2 รับไหว แต่ไม่ได้บอกว่ามันตอบถูก เพราะ proxy ทิ้งคำตอบพวกนั้นไป ถ้าจะตรวจความถูกต้อง สำเนาต้องไปที่ comparator แทน ตัว comparator จะส่งสำเนาแต่ละชุดไปที่ v2 และไปที่ v1 สอง instance แล้ว diff คำตอบทั้งสามชุด ตัว field ที่ต่างกันแม้แต่ระหว่าง v1 สอง instance (`served_at`, `request_id`) เป็น noise และถูกตัดออก ส่วน field ที่ต่างเฉพาะใน v2 จะถูกรายงาน: `price` เปลี่ยนจาก string `"12.50"` เป็น number `12.5` แบบนี้จะทำให้ client ที่ parse มันเป็น string พัง
4. **ทำให้ shadow ไม่มีพิษภัย** request ที่ถูก copy แล้วเขียนข้อมูลก็จะเขียนสองรอบ ตอนนี้ rule เลย copy แค่ request `GET` กับ `HEAD` สุ่มเอาแค่ 10% และมีโน้ตเตือนให้ลบมันทิ้ง ส่วน `POST` ไปที่ v1 อย่างเดียว Envoy กับ Istio ติดป้ายให้สำเนาแต่ละชุดด้วยการต่อท้าย Host header ด้วย `-shadow` ตัว v2 เลยเห็นเป็น `catalog-shadow` อะไรก็ตามที่ v2 ยังเรียกหรือเขียนจะไปที่ stub และ store ของตัวเอง พอแก้สิ่งที่ shadow เจอครบแล้ว และ v2 นิ่งมานานพอ ก็เอา mirror rule ออก แล้ว release v2 ตามวิธีปกติ คือผ่าน canary

### Mirror อยู่ตรงไหน

mirroring เป็นฟีเจอร์ของ layer-7 proxy ที่อยู่หน้า service ส่วนใหญ่อยู่แล้ว ปกติเลยแค่ตั้งค่า ไม่ต้องเขียนโค้ด

- **Istio** route ใน `VirtualService` รับปลายทาง `mirror` ได้ข้าง ๆ `route` ปกติของมัน และ `mirrorPercentage` ตั้งสัดส่วนของ request ที่จะ copy (ถ้าไม่ใส่ก็ copy ทั้งหมด สูงสุด 100) ส่วน list `mirrors` ที่ใหม่กว่าให้มีปลายทาง mirror ได้หลายตัว แต่ละตัวมี `percentage` ของตัวเอง เอกสารอ้างอิงระบุว่า sidecar หรือ gateway จะคืน response ต้นฉบับโดยไม่รอ mirror และจะสร้าง statistics ให้ปลายทางที่ถูก mirror ด้วย และ Istio ก็รับรูปแบบของ Gateway API ข้างล่างได้เหมือนกัน
- **Envoy** route และ virtual host มี `request_mirror_policies` แต่ละ policy ระบุ `cluster` (หรือเอามาจาก request header) สุ่มด้วย `runtime_fraction` ได้ และเพิ่มหรือแก้ header ของสำเนาด้วย `request_headers_mutations` ได้ Envoy ไม่รอ shadow cluster และเก็บ statistics ตามปกติให้มันด้วย มันไม่ shadow request `CONNECT` หรือ connection ที่ upgrade แล้วอย่าง WebSocket
- **NGINX** directive `mirror` ของ `ngx_http_mirror_module` (มีตั้งแต่ 1.13.4) สร้าง subrequest เบื้องหลังให้ทุก request ต้นฉบับ แล้วไม่สน response ของมัน ส่วน `mirror_request_body` ตัดสินว่าจะ copy request body ไปด้วยหรือไม่ module นี้ไม่มีค่าตั้งสำหรับการสุ่ม
- **Kubernetes Gateway API** rule ใน `HTTPRoute` รับ filter `RequestMirror` ที่ชี้ไปที่ `backendRef` ได้ spec กำหนดให้ gateway ไม่สน response ของ mirror และส่งสำเนาแต่ละชุดไปที่ endpoint เดียวของ backend นั้น mirroring เป็นฟีเจอร์ระดับ *Extended* เลยต้องเช็กว่า implementation ที่ใช้รองรับหรือเปล่า ส่วน field `percent` กับ `fraction` สำหรับการสุ่ม ([GEP-3171](https://gateway-api.sigs.k8s.io/geps/gep-3171/)) ขึ้นเป็น Standard ใน v1.3
- **Mirroring ระดับ packet เป็นอีก layer หนึ่ง** AWS VPC Traffic Mirroring copy network traffic ของ elastic network interface ไปที่ target เช่น interface อื่น หรือ load balancer ที่อยู่หน้า fleet ของ appliance โดยห่อไว้ใน VXLAN มันสร้างมาสำหรับ content inspection, threat monitoring และ troubleshooting มัน copy packet ไม่ใช่ request: ถ้าจะใช้มันขับเวอร์ชันที่สอง ต้องมีอะไรสักอย่างฝั่งรับคอยประกอบ HTTP request ขึ้นมาใหม่แล้วส่งต่อ และ traffic ที่เข้ารหัสไว้บนสายก็จะมาถึงแบบยังเข้ารหัสอยู่ [GoReplay](https://github.com/probelabs/goreplay) ใช้วิธีคล้าย ๆ กันบนตัว host เอง: แทนที่จะอยู่บนเส้นทางของ request ในฐานะ proxy มันคอยฟังที่ network interface แล้วส่ง HTTP request ที่ประกอบขึ้นมาใหม่ต่อไปที่อีก environment

### สำเนาถูกติดป้ายยังไง

v2 และทุกอย่างที่ v2 เรียก ควรแยกสำเนาออกจาก request จริงได้ จะได้กันมันออกจาก side effect จริง ติดป้ายให้ log กับ metric ของมัน และหยุดมันไว้ที่ขอบเขตไหนก็ตามที่ห้ามเห็นสำเนาเด็ดขาด

- **Envoy** ต่อท้าย Host header (`:authority`) ของทุกสำเนาด้วย `-shadow` ตัว `cluster1` เลยกลายเป็น `cluster1-shadow` ส่วน `disable_shadow_host_suffix_append` ใช้ปิดพฤติกรรมนี้ `host_rewrite_literal` ใช้ตั้ง host ที่เราเลือกเองแทน และ `request_headers_mutations` ใช้เพิ่ม header ของเราเองได้ เช่น `x-shadow: true`
- **Istio** ใน mirroring task ของมันอธิบาย suffix `-shadow` แบบเดียวกันทั้งสำหรับ API ของตัวเองและสำหรับ Gateway API เพราะ proxy ของ Istio ก็คือ Envoy
- **NGINX** ไม่ติดป้ายอะไรเลย ต้องตั้ง header เองใน mirror location ด้วย `proxy_set_header` แบบที่ตัวอย่างของ module ทำกับ `X-Original-URI`
- **Gateway API** filter mirror ของมันไม่มีค่าตั้งสำหรับติดป้ายสำเนา เลยต้องเช็กว่า implementation ที่ใช้ส่งอะไรไป

ให้ถือว่าป้ายเป็นแค่ตัวช่วยบอกใบ้ ไม่ใช่การป้องกัน ถ้ามีคนลืมใส่ check สักจุด ก็คือการตัดบัตรซ้ำอีกรอบ สิ่งที่ทำให้สำเนาไม่มีพิษภัยจริง ๆ คือการแยกให้ขาดตามที่อธิบายไว้ในหัวข้อ side effect ข้างล่าง

### Fire and forget, timeout และต้นทุนที่ proxy ต้องจ่าย

การไม่รอ shadow คือสิ่งที่ทำให้ user ปลอดภัยจากมัน แต่ proxy ก็ยังต้องทำงานทั้งหมดของ request ตัวที่สองอยู่ดี

- **Envoy** ให้สำเนาแต่ละชุดใช้ timeout ของ route และทิ้ง body ของ response จาก shadow ไป ([router source](https://github.com/envoyproxy/envoy/blob/main/source/common/router/router.cc)) ตั้งแต่ [Envoy 1.33](https://www.envoyproxy.io/docs/envoy/latest/version_history/v1.33/v1.33.0) สำเนาจะถูก stream ไปพร้อม ๆ กับ request ต้นฉบับ แทนที่จะส่งหลังจาก request ต้นฉบับมาถึงครบแล้ว ตอนนี้ request ที่ใหญ่กว่า buffer limit ก็ mirror ได้แล้ว และสำเนาก็อาจถูกส่งออกไปให้ request ที่ client ยกเลิกกลางทาง
- **v2 ที่ช้าหรือค้างจะผูก proxy ไว้**: connection, stream และ buffer ถูกใช้อยู่จนกว่า shadow จะตอบหรือ timeout จะทำงาน ให้จำกัดมันด้วย route timeout, limit ของ connection และ request บน upstream ของ shadow (threshold แบบ [circuit-breaking](../circuit-breaker/) ต่อ cluster ของ Envoy) และ alert ที่ CPU กับ memory ของ proxy เอง
- **NGINX เป็นข้อยกเว้นของ fire and forget** developer ของ NGINX [อธิบายไว้ใน mailing list](https://mailman.nginx.org/pipermail/nginx/2018-August/056751.html) ว่า request ถัดไปบน client connection เดียวกันจะยังไม่ถูกประมวลผลจนกว่า mirror subrequest ทั้งหมดของ request ก่อนหน้าจะเสร็จ ถ้าใช้ keep-alive connection ตัว mirror ที่ช้าเลยทำให้ user จริงต้องรอ ต่อมาใน thread เดียวกันก็มีคนบอกว่านี่คือ side effect ที่รู้กันอยู่แล้วจากวิธี implement mirroring และไม่น่าจะเปลี่ยน และ changelog ของ NGINX ก็ไม่มีการเปลี่ยนแปลง module นี้เลยตั้งแต่มันมาใน 1.13.4 ถ้าเปิด `mirror_request_body` ไว้ (ค่า default คือเปิด) ตัว NGINX ก็จะอ่าน request body ทั้งหมดก่อนสร้าง mirror subrequest และ unbuffered request-body proxying ก็จะถูกปิดไป
- **ทุกสำเนามีต้นทุน:** upstream stream ตัวที่สอง, การเข้ารหัสสำหรับ hop ที่สอง, header กับ body ที่ copy มา และ network traffic ของ request ตัวที่สอง ให้วัด latency กับ CPU ของ proxy ก่อนและหลังเปิด mirroring

### การสุ่ม

การ copy ทุก request ทำให้โหลดหลัง proxy เป็นสองเท่า บ่อยครั้งแค่บางส่วนก็พอจะเจอ error และวัด latency ได้แล้ว และค่อยเพิ่มได้เมื่อมั่นใจมากขึ้น

- **Istio:** `mirrorPercentage` บน route หรือ `percentage` บนแต่ละ entry ของ `mirrors`
- **Envoy:** `runtime_fraction` บน mirror policy ค่านี้เปลี่ยนได้ตอน runtime
- **Gateway API:** `percent` หรือ `fraction` บน filter `RequestMirror`
- **NGINX:** ไม่มีมาในตัว ตัวแปรจาก `split_clients` ที่ hash key อย่าง client address หรือ session cookie ลงเป็น bucket ใช้เป็นตัวสุ่มได้ เช่นให้ return ออกจาก mirror location ก่อนเลยสำหรับ request ที่อยู่นอกกลุ่มตัวอย่าง

การสุ่มแบบ random จะ copy request ทีละตัว ไม่ใช่ทั้ง journey ถ้า v2 ต้องใช้ request ก่อนหน้าใน flow (การ login, ตะกร้าที่ใส่ของไว้เมื่อนาทีก่อน) request ที่สุ่มได้ส่วนใหญ่ก็จะอ้างถึง state ที่มันไม่เคยเห็น แล้ว error ที่ตามมาก็มาจากการสุ่ม ไม่ได้มาจากโค้ด ถ้าเรื่องนี้สำคัญ ให้สุ่มตาม user หรือตาม session แทน: mirror เฉพาะบน route ที่ match header หรือ cookie หรือ hash session key

### วัดอะไร

เทียบ v2 กับ v1 บน traffic เดียวกัน ทีละ endpoint

- **Error:** response 5xx, exception และ timeout ใน log ของ v2 ส่วน input แปลก ๆ ที่ fail ทุกครั้งจะจมหายไปใน error rate รวม เลยต้องดูแยกตาม endpoint และอ่าน request ที่ fail
- **Latency:** p99 ขึ้นไป แยกตาม endpoint เทียบกับ v1 บน traffic คละแบบเดียวกัน ให้ถือว่าเป็นค่าประมาณ: stub มักตอบเร็วกว่า dependency จริง และ cache กับ pool ของ v2 ก็เก็บข้อมูลต่างกัน
- **Saturation ตามเวลา:** CPU, memory, thread, connection pool, garbage collection, disk ส่วน leak กับการโตช้า ๆ ต้องใช้เวลาเป็นชั่วโมงหรือเป็นวันกว่าจะเห็น เลยต้องปล่อยให้ shadow รันผ่าน peak ประจำวันอย่างน้อยหนึ่งรอบ
- **ตัว proxy เอง:** latency, CPU และ memory ของมัน เพราะตอนนี้มันทำงานเพิ่มให้ทุกสำเนา

แยก telemetry ของ shadow ออกจาก service จริง: มี label, dashboard และเส้นทาง alert ของตัวเอง และไม่เอา error ของมันไปนับใน [SLO และ error budget](../slo-error-budgets/) ของ v1 ส่วน Envoy บันทึก trace span ให้แต่ละสำเนาได้ โดย `trace_sampled` บน mirror policy ตัดสินว่าจะ sample มันหรือไม่ และค่า default คือทำตามการตัดสินของ request ต้นฉบับ

### เทียบ response

proxy ทิ้งคำตอบของ v2 ไป ตัว mirroring เลยเจอ crash, error และความช้า แต่ไม่เจอคำตอบที่ผิด v2 ที่คืนราคาเป็น number แทน string, ทำ field หาย หรือปัดเศษต่างไป จะดูปกติดีทุกอย่าง การตรวจความถูกต้องต้องมีขั้น diff ซ้อนบน mirror อีกชั้น และขั้นนั้นก็คือ [parallel run](../parallel-run/) ในรูปของ proxy

**Diffy** เป็นเครื่องมือที่ดังที่สุดสำหรับเรื่องนี้ และตัวมันเองก็เป็น proxy ด้วย request แต่ละตัวที่มันได้รับ เช่นสำเนาที่ถูก mirror มา จะถูกส่งไปสาม instance: *candidate* ที่รันโค้ดใหม่, *primary* ที่รันโค้ดล่าสุดที่รู้ว่าดี และ *secondary* ที่รันโค้ดที่ดีตัวเดียวกันนั้น ความต่างระหว่าง primary กับ secondary มาจากความไม่ deterministic ของ service เอง เช่น timestamp, ID ที่ระบบสร้าง และลำดับ ตัว Diffy เลยเทียบว่า primary กับ secondary เห็นไม่ตรงกันบ่อยแค่ไหน กับ primary กับ candidate เห็นไม่ตรงกันบ่อยแค่ไหน ถือว่าความต่างที่ไม่ได้เกิดบ่อยกว่าพื้นหลังนั้นเป็น noise แล้วรายงานส่วนที่เหลือ Twitter ที่เป็นต้นกำเนิดของ Diffy [archive](https://github.com/twitter-archive/diffy) repository ที่ใช้ license แบบ Apache ไปแล้ว เวอร์ชันที่ยังมีคนดูแลอยู่ถูกเผยแพร่เป็น [Opendiffy](https://github.com/opendiffy/diffy) ภายใต้ license แบบ Creative Commons (BY-NC-ND 4.0) ที่อนุญาตให้แชร์ได้เฉพาะแบบไม่แก้ไขและไม่ใช่เพื่อการค้า เลยต้องอ่านเงื่อนไขก่อนจะเอามาต่อยอด

มีทางเลือกอีกสองทางที่ไม่ต้องใช้ proxy ที่คอยเทียบ:

- **Log คำตอบทั้งสองฝั่งแล้ว diff แบบ offline** v1 กับ v2 log response ของตัวเองไว้ภายใต้ correlation ID ที่สำเนาทั้งสองชุดถือไว้ แล้วมี job มา join และเทียบ log กัน วิธีนี้ไม่มี hop เพิ่ม แต่ก็ยังต้องจัดการ noise แบบเดียวกัน และตอนนี้ log ทั้งสองฝั่งก็มีข้อมูล production อยู่ด้วย
- **อัดแล้วเล่นซ้ำแทนการ mirror สด** เก็บ traffic ของ production ไว้ แล้วเล่นซ้ำกับ v1 และ v2 ใน test environment ตัว GoReplay บันทึก request ที่จับได้ลง file แล้วเล่นซ้ำทีหลังได้ ทั้งด้วยจังหวะเวลาระหว่าง request ตามต้นฉบับ เร็วขึ้นหรือช้าลง หรือวนซ้ำ ไฟล์ที่อัดไว้เล่นซ้ำได้บ่อยเท่าที่ต้องการโดยไม่ต้องแตะ proxy ของ production แต่มันก็เก่าลงเรื่อย ๆ ขาด state ที่เปลี่ยนไปตั้งแต่ตอนอัด และเป็นสำเนาข้อมูล production ที่เก็บไว้ และต้องปกป้องเหมือนข้อมูล production

ไม่ว่าอะไรจะเป็นตัวเทียบ ให้ normalise ก่อน diff (sort list ที่จริง ๆ เป็น set, ตัด timestamp กับ ID ที่ระบบสร้างทิ้ง, เทียบเงินเป็นทศนิยมแบบตรงเป๊ะ) และทำให้ list ของ field ที่ข้ามไปสั้นและผ่านการ review ส่วน pattern [parallel run](../parallel-run/) อธิบายเรื่อง noise ไว้ละเอียด

### ความเป็นส่วนตัว

สำเนาของ request ใน production ก็คือข้อมูล production: ชื่อ ที่อยู่ ข้อมูลการชำระเงิน และ cookie กับ access token ของ user การส่งมันไปที่ shadow ไม่ได้ทำให้มันกลายเป็นข้อมูลทดสอบ

- **ให้ v2 ทำตามกฎเดียวกับ v1:** access control, log retention, region และการเข้ารหัสแบบเดียวกัน ถ้า shadow รันอยู่ในที่ที่ไว้ใจได้น้อยกว่า สำเนาต้องไม่ไปถึงมันแบบที่ยังไม่ได้ mask
- **ตัดสิ่งที่ v2 ไม่ต้องใช้ทิ้งก่อนสำเนาจะออกจาก proxy** ด้วย header mutation บน mirror policy ใน Envoy หรือ header rewrite ใน mirror location ของ NGINX ตัว header `Authorization` หรือ session cookie ที่ถูก copy มาคือ credential ที่ใช้งานได้จริง และ v2 ที่เอามันไปเรียก service อื่นก็กำลังทำตัวเป็น user คนนั้น
- **ตามดูสำเนาให้ทั่ว:** log, error report, trace และ request dump ของ v2 ต่างเก็บสิ่งที่ได้รับไว้ทั้งหมด ไฟล์ที่อัดไว้เล่นซ้ำคือสำเนาข้อมูลส่วนบุคคลที่เก็บไว้ พร้อมภาระหน้าที่ที่ตามมาด้วย
- **ข้อมูลบางอย่างอาจ copy ไม่ได้เลย** ด้วยเหตุผลทางกฎหมายหรือสัญญา ถ้าอย่างนั้น route พวกนั้นก็ mirror ไม่ได้

### Side effect และข้อมูลที่ค่อย ๆ เพี้ยน

mirroring ง่ายสำหรับ request ที่แค่อ่าน แต่อันตรายสำหรับอย่างอื่นทั้งหมด การเขียนที่ถูก copy จะรันสองรอบ: บัตรโดนตัดเงินสองรอบ อีเมลถูกส่งสองฉบับ ข้อมูลที่ใช้ร่วมกันเปลี่ยนสองรอบ

- **Copy แค่ method ที่ปลอดภัย** คือ `GET` กับ `HEAD` ด้วยการเอา mirror ไปไว้บน route ที่ match มันเท่านั้น แล้วเช็กว่าการอ่านของเราอ่านอย่างเดียวจริง ๆ: ตัวนับยอดวิว, list "ดูล่าสุด", การ refresh session, cache ที่ถูกเติมตอน miss และ audit log ล้วนเขียนข้อมูลทั้งนั้น
- **แยกทุกอย่างที่ v2 ยังทำอยู่ให้ขาด** ชี้การเรียกออกไปข้างนอกของมัน (ผู้ให้บริการชำระเงิน, gateway ของอีเมลและ SMS, API ของ partner) ไปที่ stub ที่คอยบันทึกว่าโดนขออะไรบ้าง และชี้การเขียนของมันไปที่ store ของตัวเอง และ block egress ของมันไปหา third party ตัวจริงที่ระดับ network ด้วย แบบนี้ stub ที่มีคนลืมจะได้กลายเป็นการเรียกที่ล้มเหลว แทนที่จะเป็นการเรียกจริง
- **ระวัง layer กลางที่ใช้ร่วมกัน** v2 อาจเติม shared cache ด้วย entry ใน format ใหม่ แล้ว v1 ก็ไปอ่านมัน event ที่ v2 publish ลง broker ตัวจริงจะถูก consumer ตัวจริงกิน ส่วน rate limit กับ quota ของ third party ก็นับการเรียกของ v2 ด้วย ให้ v2 มี cache กับ topic ของตัวเอง หรือปิดเส้นทางพวกนั้นใน shadow
- **คาดไว้เลยว่าข้อมูลจะเพี้ยน** store ที่มีแค่ v2 เขียนจะไม่ตรงกับตัวที่ live อยู่: มันขาดทุกการเขียนที่ไม่ได้ถูก mirror ไม่ว่าจะเพราะ method filter หรือเพราะการสุ่ม และมันก็มีอะไรก็ตามที่ v2 ทำต่างไป การอ่านที่ serve จากมันก็เพี้ยนตามไปด้วย แล้วความต่างก็จะบอกอะไรบางอย่างเกี่ยวกับข้อมูล ไม่ใช่เกี่ยวกับโค้ด ให้ seed มันจาก snapshot แล้วคอยให้มันตามทันด้วย [change data capture](../change-data-capture/) จาก store ที่ live อยู่ หรือให้ v2 อ่านจาก replica ของข้อมูลจริงแล้วเขียนลง store ของตัวเองอย่างเดียว

### ต้นทุน

การ mirror traffic ทั้งหมดต้องใช้ fleet ชุดที่สองที่รับโหลดของ production ได้ บวก stub กับ store ของมัน บวกงานที่เพิ่มขึ้นของ proxy และ network traffic ของทุกสำเนา ให้สุ่ม, รัน shadow เฉพาะตอนที่มันยังสอนอะไรเราอยู่ และลบ mirror rule ทิ้งเมื่อเสร็จ: mirror ที่ถูกลืมจะกินเงินต่อไปเรื่อย ๆ และ copy ข้อมูลของ user ต่อไปเรื่อย ๆ

### Shadow แล้วไป canary แล้วค่อยทุกคน

mirroring แสดงว่า v2 รับ traffic จริงไหว แต่บอกไม่ได้ว่า user จะตอบสนองกับคำตอบของ v2 ยังไง หรือระบบจะทำตัวยังไงเมื่อคำตอบพวกนั้นมีผลจริง: client ที่ retry เมื่อเจอ error ของ v2 หรือ cache ที่เก็บ response ของ v2 มันเป็นขั้นก่อน release ไม่ใช่ตัว release

1. **Shadow** v2 ไปจนกว่า error, latency และการใช้ resource ของมันจะเท่ากับของ v1 และจนกว่า comparator (ถ้าใช้) จะไม่เหลือความต่างที่อธิบายไม่ได้
2. **Canary:** ให้ v2 รับ user จริงส่วนเล็ก ๆ แล้วขยายออกไปตราบที่ metric ยังปกติดี ([canary release](../canary-release/)) ถ้าเป็นการเปลี่ยนภายใน deployment เดียว [feature flag](../feature-flags/) ก็ทำงานเดียวกันได้ และการสลับแบบ [blue-green](../blue-green-deployment/) ก็ย้ายทุกคนไปทีเดียวโดยเก็บ environment เก่าไว้เป็นทางกลับ
3. **Rollout เต็ม** แล้วค่อยเอา v1 ออก

ใน [service mesh](../service-mesh/) ตัว `VirtualService` หรือ `HTTPRoute` ที่ mirror ไป v2 ในขั้นแรก ก็แบ่ง traffic ตามน้ำหนักในขั้นที่สองได้ การย้ายจาก shadow ไป canary เลยเป็นแค่การเปลี่ยน configuration

### ไม่ใช่สิ่งเดียวกับ parallel run

ทั้งสองแบบรันเวอร์ชันใหม่ข้าง ๆ เวอร์ชันเก่าโดยไม่ให้ user ต้องพึ่งมัน ขั้นการเทียบคือจุดที่ทั้งสองมาบรรจบกัน

| | Shadow traffic | [Parallel run](../parallel-run/) |
|---|---|---|
| การเรียกครั้งที่สองเกิดที่ไหน | ใน proxy ในรูปสำเนาของ HTTP request | ในแอปพลิเคชัน หรือใน proxy ที่คอยเทียบ สำหรับทุก input |
| คำตอบของเวอร์ชันใหม่ไปไหน | ถูกทิ้ง ถ้าไม่ได้เพิ่ม comparator | ถูกเทียบกับของเวอร์ชันเก่าเสมอ |
| ตอบคำถามอะไร | v2 รับ traffic จริงไหวไหม: error, latency, การใช้ resource | v2 ให้คำตอบเหมือนเดิมไหม ทีละ input |
| จบเมื่อ | v2 ทำงานดีมานานพอ | อธิบาย mismatch ได้ครบทุกตัว |
| ขั้นต่อไป | canary release ของ v2 | สลับบทบาทกัน แล้วโค้ดใหม่ก็กลายเป็น source of truth |

## ใช้ตอนไหนดี

- **การเปลี่ยนแปลงที่ผู้เรียกไม่ควรรู้สึก แต่อาจพังภายใต้โหลดจริง:** การเขียน service ที่อ่านหนักใหม่ทั้งหมด, framework, runtime หรือ language version ใหม่, database driver หรือ query layer ใหม่, cache ใหม่, การเปลี่ยนเรื่อง performance
- **สงสัยเรื่อง input ไม่ใช่เรื่อง logic:** request, client และรูปร่างข้อมูลที่คละกันตามจริงคือสิ่งที่ไม่มี test environment ไหนจำลองได้
- **คำถามเรื่อง capacity:** v2 ต้องใช้กี่ instance สำหรับ traffic คละแบบจริง ตัว mirror ที่ 100% ตอบคำถามนี้ได้ก่อนที่ user จะต้องพึ่งมัน
- **ก่อนทำ canary** กับอะไรก็ตามที่รับโหลดจริง เพื่อจับความล้มเหลวที่เห็นชัด ๆ โดยไม่ให้ user สักคนโดน

[dark launching](https://martinfowler.com/bliki/DarkLaunching.html) ของ Martin Fowler คือแนวปฏิบัติที่กว้างกว่า คือเรียกพฤติกรรม back-end ใหม่จาก request ของ user ที่มีอยู่โดยไม่ให้ user เห็นผล ปกติเพื่อวัดโหลดของมันก่อนประกาศ feature ส่วน mirroring ใน proxy ก็เป็นวิธีหนึ่งที่ทำแบบนั้น เขาแนะนำให้ใช้ canary release แทนถ้าสิ่งที่ทดสอบขึ้นกับการตัดสินใจของ user

**ตอนไหนไม่ควรใช้**

- **Flow ที่เขียนหนักและแยก side effect ให้ขาดไม่ได้:** การชำระเงินที่ไม่มี sandbox, message ถึง partner, ledger ถ้าสำเนารันโดยไม่มีผลตามมาไม่ได้ ก็อย่า copy มัน
- **ข้อมูลที่ copy ไม่ได้:** ข้อมูลส่วนบุคคลหรือข้อมูลที่มีกฎหมายคุมที่ห้ามออกจากระบบของมัน หรือห้ามไปถึง environment ที่ไว้ใจได้น้อยกว่า
- **พฤติกรรมที่ขึ้นกับการที่ user เห็นคำตอบ:** หน้าจอใหม่, recommendation ที่ต้องมีคนคลิก คำตอบของ shadow ไม่ได้บอกเลยว่า user จะตอบสนองยังไง งานนั้นเป็นหน้าที่ของ canary หรือ A/B test
- **Connection ที่อยู่นานและ streaming:** Envoy mirror request `CONNECT` หรือ connection ที่ upgrade แล้วอย่าง WebSocket ไม่ได้ และบทสนทนาแบบ stateful ก็แทบไม่มีความหมายถ้า copy ทีละ request
- **Traffic น้อยมาก:** request ไม่กี่ตัวต่อชั่วโมงทดสอบได้น้อยกว่า test suite ที่ดี

## ได้อะไร เสียอะไร

- **Fleet ชุดที่สอง** (หรือส่วนที่สุ่มมาจากมัน) และงานเพิ่มใน proxy ตลอดที่ shadow ยังรันอยู่
- **มันแสดงว่า v2 รับไหว ไม่ใช่ว่ามันถูก** เว้นแต่จะเพิ่ม comparator และพอเพิ่มแล้ว การจัดการ noise ก็เป็นงานที่เราต้องสร้างและดูแลเอง
- **Shadow ไม่ใช่ production เสียทีเดียว:** stub ตอบเร็วกว่า dependency จริง, cache เก็บข้อมูลต่างกัน และ store ที่แยกไว้ก็ค่อย ๆ เพี้ยน latency กับ error rate ของมันเป็นแค่ค่าประมาณ
- **การแยกให้ขาดไม่เคยสมบูรณ์เองโดย default** ทุก side effect ต้องถูกหาเจอและ block และตัวที่หลุดไปก็จะเกิดสองรอบ
- **มัน copy ข้อมูลส่วนบุคคล** เข้าไปในอีกระบบหนึ่ง พร้อมภาระหน้าที่ที่ตามมา
- **Fire and forget ไม่ได้ฟรี:** proxy ต้องแบกทุกสำเนา และใน NGINX ตัว mirror ที่ช้าอาจกั้น request ถัดไปบน keep-alive connection
- **Mirror ที่ถูกลืม** กินเงินและ copy ข้อมูลต่อไปเรื่อย ๆ แม้จะไม่มีใครดู shadow มานานแล้ว

## ข้อควรรู้ตอนลงมือทำ

- **Rule จาก diagram ใน Istio** (copy แค่การอ่าน และแค่ 10% ของมัน) match block ใน list เป็นทางเลือกแบบใดแบบหนึ่ง route แรกเลยจับ `GET` หรือ `HEAD` ส่วนอย่างอื่นทั้งหมดรวมถึงการเขียน จะตกไปที่ route ที่สองแล้วไปที่ v1 อย่างเดียว ตัว subset `v1` กับ `v2` มาจาก `DestinationRule` ที่เลือก pod ตาม version label แบบใน mirroring task ของ Istio

  ```yaml
  apiVersion: networking.istio.io/v1
  kind: VirtualService
  metadata:
    name: catalog
  spec:
    hosts:
    - catalog
    http:
    - match:
      - method:
          exact: GET
      - method:
          exact: HEAD
      route:
      - destination:
          host: catalog
          subset: v1
      mirror:
        host: catalog
        subset: v2
      mirrorPercentage:
        value: 10.0
    - route:
      - destination:
          host: catalog
          subset: v1
  ```

- **ถ้าใช้ Gateway API** รูปเดียวกันนี้คือ `HTTPRoute` ที่มี rule หนึ่งตัวที่ match method และมี filter `RequestMirror` พร้อม `percent: 10` และมี rule ตัวที่สองสำหรับที่เหลือ
- **จำกัดส่วนแบ่งของ shadow ใน proxy:** route timeout, limit ของ connection และ request บน upstream ของ shadow และ alert ที่ resource ของ proxy เอง
- **รัน v2 ให้เหมือน production:** instance type, configuration และจำนวน replica เท่ากันสำหรับส่วนที่ถูก mirror ไม่งั้นตัวเลข latency กับ capacity ของมันก็แทบไม่มีความหมาย
- **ตัดสินทางออกไว้ก่อน:** "ทำงานดีมานานพอ" หมายถึงอะไร (ไม่มี error แบบใหม่ตลอด peak ประจำวันหลายรอบ, p99 กับ memory อยู่ใน limit ที่ตั้งไว้, comparator สะอาด) และวันที่ต้องลบ mirror rule, stub และ store ที่แยกไว้
- **สำหรับ route ที่ mirror ไม่ได้** ให้เล่นซ้ำ request ที่อัดไว้และ mask แล้วเข้าไปใน environment ที่แยกไว้แทน
