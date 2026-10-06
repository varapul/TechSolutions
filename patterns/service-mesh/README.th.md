## ปัญหา

ทุก service ที่เรียก service อื่นผ่าน network ต้องมีงานเดินท่อแบบเดียวกัน: หา instance ที่ยัง healthy, กระจายการเรียกไปให้ทั่ว, เข้ารหัส connection และพิสูจน์ว่าใครเป็นคนเรียก, เลิกรอเมื่อถึง timeout, retry สิ่งที่คุ้มจะ retry, เลิกส่งไปหา instance ที่พังซ้ำ ๆ และบันทึกว่าเกิดอะไรขึ้น ถ้าเขียนงานพวกนี้ไว้ในแต่ละแอปพลิเคชัน มันก็จะมีหนึ่งชุดต่อหนึ่งภาษาและ framework ค่อย ๆ ต่างกันไปทีละทีม และจะเปลี่ยนได้ก็ต่อเมื่อ build และ deploy ทุก service ใหม่

shared library แก้เรื่องนี้ได้ตราบที่ทุกคนใช้ภาษาเดียวและ upgrade ตรงเวลา ระบบ microservice ขนาดใหญ่รุ่นแรก ๆ ก็ทำแบบนั้น (Finagle ของ Twitter คือตัวอย่างที่ยกกันบ่อย) แต่พอมีหลายภาษาและหลายสิบทีม ก็ไม่มีใครบอกได้ว่า service ไหนเข้ารหัสการเรียก ตัวไหน retry หรือตัวไหนยังไม่ได้ตัวแก้ของเดือนที่แล้ว ระหว่างนั้นการเรียกภายใน network ก็มักเป็น plaintext และไม่ได้ authenticate: อะไรก็ตามที่เข้ามาใน network ได้ ก็เรียกอะไรก็ได้

## ทำงานยังไง

service mesh เอางานเดินท่อพวกนั้นออกจาก process ไปไว้ใน **proxy ที่อยู่ข้างทุก instance** แล้วเพิ่ม **control plane** ที่ตั้งค่า proxy ทั้งหมดจากที่เดียว มันก็คือ Sidecar pattern ที่เอามาใช้กับ networking และทำซ้ำกับทุก workload ส่วนครึ่งขาออกของแต่ละ proxy ก็คือสิ่งที่ Ambassador pattern อธิบายไว้

### Data plane: ตัว proxy

ในดีไซน์แบบคลาสสิก ทุก pod จะได้ **sidecar proxy**: Envoy ใน Istio และ mesh อื่นส่วนใหญ่ หรือ proxy ที่เขียนด้วย Rust ขึ้นมาเฉพาะใน Linkerd มันถูก inject ตอนสร้าง pod และ redirect rule ใน network namespace ของ pod (iptables rule ที่ init container หรือ CNI plugin เขียนไว้) จะส่งทุกอย่างที่เข้าหรือออกจากแอปให้วิ่งผ่านมัน แอปยังเรียก `http://payments` ด้วย plain HTTP หรือ gRPC เหมือนเดิม และไม่มีโค้ดของ mesh อยู่เลย การเรียกครั้งเดียวตอนนี้มีสาม hop: จากแอปไป sidecar ของตัวเองใน pod, จาก sidecar ไป sidecar ข้าม network และจาก sidecar ฝั่งไกลไปแอปปลายทาง

เพราะ proxy เห็นทุก request มันเลยทำสิ่งเดียวกันให้ทุก request ได้:

- **เข้ารหัสและระบุตัวตน** proxy สองตัวตั้ง mutual TLS ด้วย workload certificate ของตัวเอง แต่ละฝั่งเลยรู้ว่า *service* ไหนอยู่อีกฝั่ง ไม่ว่า IP address ของมันจะเป็นอะไร
- **Authorize** ตัว proxy ฝั่งรับตรวจ identity ของผู้เรียก (และสำหรับ HTTP ก็ตรวจ method กับ path ด้วย) เทียบกับ policy ก่อนที่แอปจะเห็น request ทั้ง RBAC filter ของ Envoy และ proxy ของ Linkerd ตอบ HTTP request ที่โดนปฏิเสธด้วย `403` ส่วน TCP connection ที่โดนปฏิเสธจะถูกปิดหรือถูก refuse
- **Route และกระจาย load ทุก request** ตัว proxy ฝั่งเรียกเลือก endpoint ทีละ request ไม่ใช่ครั้งเดียวต่อ connection แบบนี้แหละที่ connection แบบ HTTP/2 กับ gRPC ที่อยู่ยาว ๆ ต้องการ (ดู [Load Balancing](../load-balancing/)) ส่วน route ก็แบ่ง traffic ตามน้ำหนักได้ match ตาม header ได้ หรือ mirror request ไปที่ version ใหม่ได้
- **ป้องกัน** timeout, retry, จำกัด connection และเอา instance ที่พังซ้ำ ๆ ออกจากวง: เป็น [Circuit Breaker](../circuit-breaker/) โดยไม่ต้องเขียนโค้ด
- **สังเกตการณ์** ตัวเลข request rate, error rate และ latency แบบเดียวกันของ service ทุกคู่ บวกกับ access log และ trace span โดยทั้งหมดอยู่ใน format เดียว

### Control plane: ดูแล configuration ไม่เคยแตะ traffic

control plane มีงานสามอย่าง และการส่งต่อ request ไม่ใช่หนึ่งในนั้น:

- **Service discovery** มันคอยดู registry ของ platform (Kubernetes Service กับ endpoint ของพวกมัน) แล้วบอก proxy ทุกตัวว่าตอนนี้มี instance ไหนอยู่บ้าง
- **Configuration และ policy** มันแปลง routing rule กับ policy ที่เราประกาศไว้เป็น configuration ของ proxy แล้ว stream ออกไป ส่วน mesh ที่สร้างบน Envoy ใช้ xDS API ทำเรื่องนี้ ตัว xDS ส่ง listener, route, cluster, endpoint และ secret ผ่าน gRPC
- **Certificate authority** มัน sign certificate อายุสั้นให้ทุก workload

ถ้า control plane ล่ม proxy ก็ทำงานต่อด้วยสิ่งที่มีอยู่: Envoy เก็บ configuration ล่าสุดที่ได้รับไว้ และ proxy ของ Linkerd ก็ใช้ endpoint ที่รู้ล่าสุดต่อไป สิ่งที่หยุดคือการเปลี่ยนแปลง: rule ใหม่ไม่มาถึง ส่วน proxy ที่ start ระหว่างที่ล่มก็ไม่มีอะไรให้ทำงาน และ certificate ก็ต่ออายุไม่ได้ ทำให้ถ้าการล่มกินเวลานานกว่าอายุที่เหลือของ certificate ตัว mutual TLS ก็จะเริ่มพัง ให้รัน control plane หลาย replica และตั้ง alert ให้มันเหมือน service สำคัญตัวอื่น ๆ

### Identity

ทุก workload ได้ identity ของตัวเอง ปกติได้มาจาก service account ใน Kubernetes ของมัน และพกไปใน X.509 certificate ส่วน SPIFFE ทำให้ทั้งชื่อและเอกสารเป็นมาตรฐาน: SPIFFE ID คือ URI ในรูป `spiffe://<trust domain>/<path>` (Istio ใช้ `spiffe://<trust-domain>/ns/<namespace>/sa/<service-account>`) และ certificate ที่พก ID นี้เรียกว่า X.509-SVID ตัว proxy หรือ agent ที่อยู่ข้าง ๆ จะสร้าง private key กับ signing request เอง แล้ว CA ตรวจ credential ระดับ platform ของ workload และคืน certificate กลับมา ทำให้ key ไม่เคยถูกส่งไปไหน ส่วน workload certificate หมดอายุหลัง 24 ชั่วโมงโดย default ทั้งใน Istio และ Linkerd และต่ออายุอัตโนมัติ ทำให้ certificate ที่โดนขโมยไปใช้ได้แค่ช่วงสั้น ๆ

**trust domain** คือชุดของ workload ที่ใช้ root of trust เดียวกัน cluster ที่ควรคุยกันได้ต้องใช้ root เดียวกัน หรือแลก (federate) trust bundle กัน ส่วน root certificate กับ issuer certificate คือส่วนที่*ไม่*หมุนเวียนเอง: เช่น trust anchor ที่คำสั่ง install ของ Linkerd สร้างให้ จะหมดอายุหลังหนึ่งปี

### อะไรยังอยู่ในแอปพลิเคชัน

- **การเรียกนั้นทำซ้ำได้อย่างปลอดภัยไหม** proxy เห็น `POST` ไม่ได้เห็นการจ่ายเงิน เรื่อง idempotency key, compensation และ retry ระดับ business เป็นงานของ service
- **Fallback** พอใช้ retry หมดแล้ว proxy ก็คืน error ส่วนการลดระดับอย่างนุ่มนวลเป็น logic ของแอปพลิเคชัน
- **Trace context** proxy แต่ละตัวปล่อย span ได้ แต่บอกไม่ได้ว่าการเรียกขาออกตัวไหนเป็นของ request ขาเข้าตัวไหน แอปต้องก็อป trace header (W3C `traceparent` กับ `tracestate` หรือ B3) จาก request ที่ได้รับไปใส่ในการเรียกที่มันทำ ไม่อย่างนั้น trace จะแตกเป็น span ที่ไม่ต่อกัน (ดู [Distributed Tracing](../distributed-tracing/))
- **Authorization ของ end user** mesh พิสูจน์ได้ว่า workload ไหนเป็นคนเรียก แต่ user คนนี้ดู order นั้นได้ไหม ยังเป็นการตัดสินของ service

### Mesh, API gateway หรือ library?

| | Library ในแต่ละ service | API gateway | Service mesh |
|---|---|---|---|
| รันที่ | ใน process | เป็น tier เดียวที่ edge | ข้างทุก instance หรือบนทุก node |
| Traffic | อะไรก็ตามที่โค้ดเรียก | north-south: client เข้าสู่ระบบ | east-west: service ไป service |
| ภาษา | หนึ่ง implementation ต่อหนึ่งภาษา | ภาษาไหนก็ได้ | ภาษาไหนก็ได้ |
| รู้อะไร | business operation เลยตัดสินได้ว่าอะไร retry ได้ปลอดภัย | client ภายนอก: API key, user token, quota | workload ที่อยู่ปลายแต่ละฝั่ง |
| เปลี่ยนด้วย | build และ deploy ทุก service ใหม่ | configuration ของ gateway | configuration ของ mesh |

สามอย่างนี้ทำงานร่วมกัน: [API Gateway](../api-gateway/) สำหรับ client ที่ edge, mesh ระหว่าง service และโค้ด library นิดหน่อยตรงที่ความหมายทาง business สำคัญ

### ไม่ใช้ sidecar

proxy ในทุก pod คือส่วนที่แพง data plane รุ่นใหม่ ๆ เลยย้ายมันไปไว้ที่อื่น:

- **proxy หนึ่งตัวต่อ node** ใน ambient mode ของ Istio ตัว `ztunnel` บนทุก node ให้ mutual TLS, identity และ layer-4 policy กับทุก pod บน node นั้น ส่วน proxy แบบ *waypoint* ที่เลือกใช้ได้ (เป็น Envoy และปกติมีหนึ่งตัวต่อ namespace) จะเพิ่ม feature ระดับ layer 7 เฉพาะตรงที่ต้องการ
- **eBPF** ตัว Cilium จัดการระดับ connection ใน kernel ด้วย eBPF และส่ง traffic ระดับ layer 7 ไปให้ Envoy บนแต่ละ node
- **Proxyless gRPC** gRPC client กับ server ดึง configuration ตรงจาก xDS control plane ได้ (routing, load balancing, retry, mutual TLS) โดยไม่ต้องมี proxy เลย มันกลับไปเป็น library อีกครั้ง แต่เป็น library ที่ตั้งค่าจากส่วนกลาง

ดีไซน์ระดับ node ถูกกว่า และ workload เข้าร่วมได้โดยไม่ต้อง restart ราคาที่ต้องจ่ายคือการแยกที่หยาบกว่า: proxy ระดับ node ถือ key ของทุก workload บน node ของมัน และ proxy layer 7 ที่ใช้ร่วมกันก็ถูกใช้ร่วมกันโดยทุกอย่างที่อยู่ข้างหลังมัน

## ใช้ตอนไหนดี

- มีหลาย service ในหลายภาษา ที่หลายทีมเป็นเจ้าของ และทุกตัวควรได้การเข้ารหัส, identity, timeout และ telemetry แบบเดียวกัน
- มีข้อกำหนดให้เข้ารหัส traffic ระหว่างส่งทุกที่ และคุมว่า service ไหนเรียก service ไหนได้ (zero-trust network) โดยไม่ต้องแก้ทุก codebase
- Progressive delivery: ย้าย traffic เป็นเปอร์เซ็นต์ หรือย้าย request ที่มี header บางตัวไปที่ version ใหม่ (ดู [Canary Release](../canary-release/))
- ใช้ gRPC หรือ HTTP/2 ระหว่าง service ที่การกระจาย load ราย connection ทำให้บาง instance ว่างและบางตัว overload
- มีทีม platform ที่รันมันได้ ค่อย ๆ นำมาใช้เป็นขั้น: mutual TLS กับ metrics ก่อน แล้วค่อยใช้ layer-7 routing เฉพาะตรงที่ service ต้องการ

**ตอนไหนไม่ควรใช้:**

- **มี service แค่ไม่กี่ตัว** ingress หรือ gateway, TLS และ configuration เรื่อง timeout กับ retry ไม่กี่บรรทัด ถูกกว่า mesh มาก
- **ภาษาเดียวที่มี library ดี ๆ** deadline, retry และ load balancing ของ gRPC เอง หรือ resilience library ครอบคลุมความต้องการส่วนใหญ่ได้ และเข้าใจ business operation ได้ดีกว่าที่ proxy จะทำได้
- **ยังไม่มีใครดูแลมัน** mesh อยู่บนเส้นทางของทุกการเรียก ถ้าไม่มีใคร upgrade มัน หมุนเวียน root certificate ของมัน และ debug มันตอนเกิด incident ได้ มันจะเพิ่มความเสี่ยงมากกว่าที่ลดลง ส่วน managed mesh ช่วยลดงานนี้ได้แต่ไม่ได้ทำให้หายไป
- **latency budget ที่ตึงมาก ๆ** ที่ proxy เพิ่มอีกสองตัวในทุกการเรียกก็เกินไปสองตัวแล้ว

## ได้อะไร เสียอะไร

- **proxy หนึ่งตัวต่อ pod กิน CPU กับ memory** ใน benchmark ของ Istio เอง (version 1.24, 1,000 request ต่อวินาที payload 1 KB) ตัว sidecar หนึ่งตัวที่มี worker thread สองตัวใช้ประมาณ 0.20 vCPU กับ 60 MB เอาไปคูณกับทุก pod ส่วน `ztunnel` ราย node ของ ambient mode ใช้ประมาณ 0.06 vCPU กับ 12 MB ใน test เดียวกัน นอกจากนี้ memory ของ proxy ยังโตตาม configuration ที่มันถือด้วย เลยต้องจำกัดสิ่งที่ proxy แต่ละตัวต้องรู้ใน mesh ขนาดใหญ่
- **latency ทุก hop** ตอนนี้ทุกการเรียกต้องผ่าน proxy สองตัว documentation ของ Istio บอกว่า latency ที่เพิ่มขึ้นอยู่ที่ 0.63 ถึง 0.88 ms (p90 ถึง p99) ใน sidecar mode และ 0.16 ถึง 0.20 ms สำหรับ ambient mode ที่ layer 4 แต่ควรวัด tail latency ของตัวเอง อย่าไปเชื่อ benchmark ของใคร
- **upgrade ทีกระทบทุกอย่าง** การ upgrade แปลว่าต้องทำ control plane ก่อน แล้วค่อยทำ proxy ทุกตัว สำหรับ sidecar ก็คือ rolling restart ทุก workload และมี version ปนกันอยู่ระหว่างนั้น
- **debug มีชั้นเพิ่มมาอีกชั้น** `503` ตอนนี้อาจมาจากแอป จาก proxy ฝั่งไหนก็ได้ หรือจาก policy ก็ได้ ให้เรียนรู้เครื่องมือของ mesh ที่แสดงว่า proxy ได้รับคำสั่งอะไรและทำอะไรไป ก่อนที่จะต้องใช้ตอนเกิด incident
- **Lifecycle ของ sidecar** sidecar ที่ start หลังแอป หรืออยู่นานกว่า Job ที่จบไปแล้ว เคยทำให้เกิด race ตอน startup และ pod ที่ไม่มีวันเสร็จ ตอนนี้ native sidecar container ของ Kubernetes (init container ที่มี `restartPolicy: Always`, stable ตั้งแต่ v1.33) start ก่อนแอปและหยุดหลังแอป ส่วน Istio (ตั้งแต่ 1.27) กับ Linkerd (ตั้งแต่ 2.20) ใช้มันโดย default
- **retry สองชั้นจะคูณกัน** ถ้าแอปหรือ SDK ของมัน retry และ proxy ก็ retry ด้วย การลองสามครั้งในแต่ละชั้นทำให้การเรียกครั้งเดียวกลายเป็นเก้าครั้ง พุ่งไปที่ dependency ที่กำลังแย่อยู่แล้ว: เกิดเป็น retry storm วิธีแก้คือ retry ชั้นเดียว จำกัดยอดรวมด้วย retry budget และอ่าน [Retry with Backoff & Jitter](../retry-with-backoff/) ก่อน นอกจากนี้ proxy ยังรู้ไม่ได้ว่า request ไหนทำซ้ำได้อย่างปลอดภัย เลยต้องอนุญาต retry ทีละ route และเฉพาะ request ที่เป็น idempotent (rule ใน animation retry แค่การเรียก `GET`) และ Istio ก็เลิก retry response `503` โดย default ใน version 1.24 ด้วยเหตุผลนี้เอง
- **"Permissive" ไม่ได้แปลว่าปลอดภัย** เพื่อให้ย้ายระบบได้ ช่วงแรก mesh จะรับ plaintext ควบคู่ไปกับ mutual TLS: โหมด default ทั้ง mesh ของ Istio คือ `PERMISSIVE` และ default policy ของ Linkerd ก็ยอมรับ client ที่ไม่ได้ authenticate การเข้ารหัสกับ authorization จะถูกบังคับก็ต่อเมื่อเปลี่ยนไปใช้ strict mode และ policy แบบ default-deny แล้วเท่านั้น
- **pod คือ trust boundary** traffic ระหว่างแอปกับ sidecar ของมันเป็น plaintext อยู่ใน pod และผู้โจมตีที่ยึดแอปได้ก็เรียกออกไปด้วย identity ของ pod ได้ ตัว mesh จำกัดว่าผู้โจมตีจะไปต่อที่ไหนได้ แต่ไม่ได้ทำให้แอปปลอดภัย

## ข้อควรรู้ตอนลงมือทำ

- **Product ณ ตุลาคม 2026** *Istio* (CNCF graduated) มีทั้ง sidecar mode และ ambient mode ตัว ambient เป็น generally available ตั้งแต่ Istio 1.24 (พฤศจิกายน 2024) แต่การรองรับ multi-cluster ของมันยังเป็น beta อยู่ใน Istio 1.31 ส่วน *Linkerd* (CNCF graduated) ใช้ sidecar อย่างเดียว และเปิด mutual TLS ไว้โดย default และตั้งแต่กุมภาพันธ์ 2024 ตัว project open-source เองปล่อยแค่ edge release ส่วน artifact ของ stable release มาจาก vendor อย่าง Buoyant ส่วน *Cilium* มี mesh แบบไม่ใช้ sidecar โดยทั้ง mutual authentication ที่อิง SPIFFE และการเข้ารหัสที่อิง ztunnel ของมันยังถูกระบุเป็น beta ทั้งคู่ใน Cilium 1.20 ตัวเลือกแบบ managed ก็มี Google Cloud Service Mesh (ที่รวม Anthos Service Mesh กับ Traffic Director เข้าด้วยกัน) และ add-on ที่อิง Istio สำหรับ AKS
- **ปลดระวางแล้ว อย่าสร้างระบบบนพวกนี้** *AWS App Mesh* หมด support ไปเมื่อ 30 กันยายน 2026 และ AWS ชี้ให้ผู้ใช้ไปใช้ Amazon ECS Service Connect กับ Amazon VPC Lattice ส่วน *Open Service Mesh* ถูก CNCF archive ไปในปี 2023 และ AKS add-on ของมันได้รับ support ถึงแค่ 30 กันยายน 2027 และ specification *Service Mesh Interface* (SMI) ถูก archive ไปเมื่อตุลาคม 2023
- **ใช้ Gateway API ถ้ามันพอ** Kubernetes Gateway API ครอบคลุม traffic ใน mesh ด้วย ผ่าน GAMMA initiative: ผูก route อย่าง `HTTPRoute` ไว้กับ `Service` แทน `Gateway` แล้ว route นั้นก็คุมการเรียกไปที่ service ตัวนั้น เรื่องนี้อยู่ใน Standard channel ตั้งแต่ v1.1 และ project ก็ระบุว่า Istio กับ Cilium เป็น mesh implementation ที่ conformant ส่วน Linkerd ตั้งค่า routing, policy และ timeout ด้วย `HTTPRoute` กับ `GRPCRoute` แต่ API เฉพาะของแต่ละ mesh ก็ยังทำได้มากกว่า และ retry ใน `HTTPRoute` ก็ยังเป็น experimental อยู่
- **roll out mutual TLS เป็นขั้น** เริ่มจาก permissive แล้วใช้ telemetry ของ mesh หาว่าอะไรยังคุยกันเป็น plaintext อยู่ เปลี่ยนเป็น strict ทีละ namespace แล้วค่อยเพิ่ม authorization: deny เป็น default และอนุญาตเฉพาะ service identity ที่ระบุชื่อ
- **รู้ค่า default ของ timeout กับ retry** Istio ไม่ได้ตั้ง request timeout ไว้โดย default และ retry HTTP request สองครั้ง ส่วน Linkerd ไม่ retry อะไรเลยจนกว่าจะตั้งค่า ให้ตั้ง timeout รวมราย route ที่ครอบคลุมทุกครั้งที่ลอง จำกัดจำนวนครั้ง และตรวจว่า client ของแอปเองทำอะไรอยู่แล้วบ้าง
- **รู้ว่าการแบ่ง traffic ถูกใช้ที่ไหน** ใน sidecar mode ตัว sidecar ของ service ฝั่งเรียกเป็นคนใช้น้ำหนัก ส่วนใน ambient mode ของ Istio ตัว waypoint ของปลายทางเป็นคนใช้ ไม่ว่าแบบไหน การเรียกจากนอก mesh ก็ไม่ถูกแบ่ง ให้ rollout controller อย่าง Argo Rollouts หรือ Flagger เป็นคนขยับน้ำหนักและตัดสินจาก metrics
- **Certificate** ตัว workload certificate หมุนเวียนเอง แต่ root กับ issuer ไม่ คอยดูวันหมดอายุของพวกมัน ซ้อมการหมุนเวียน และลองพิจารณาออกจาก CA ภายนอก (cert-manager, private CA ของ cloud หรือ SPIRE)
- **ส่งต่อ trace header** ในทุก service ไม่อย่างนั้น span ของ mesh จะไม่ต่อกัน
