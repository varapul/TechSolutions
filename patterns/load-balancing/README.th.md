## ปัญหา

instance เดียวของ service เป็นทั้งเพดานและ single point of failure มันรับ traffic ได้แค่จำกัด และถ้ามัน crash, ค้าง หรือถูก redeploy ทุกอย่างที่พึ่งมันก็ล่มไปด้วย การรันหลาย instance ที่เหมือนกันแก้ได้ทั้งสองปัญหา แต่ต้องมีอะไรสักอย่างคอยตัดสินว่า request แต่ละตัวจะไปที่ไหน คอยสังเกตเมื่อ instance หยุดทำงาน และซ่อนเรื่องทั้งหมดนี้จาก client ถ้า client รู้จัก instance ด้วย address การ scale out การเปลี่ยนตัว และความล้มเหลวทุกครั้งก็จะกลายเป็นปัญหาของ client

## ทำงานยังไง

load balancer วาง **address เดียวที่คงที่** (DNS name หรือ virtual IP) ไว้หน้า pool ของ instance ที่สลับกันได้ ที่บางทีก็เรียกว่า target, backend หรือ upstream สำหรับทุก request หรือทุก connection มันทำสามอย่าง:

- **เลือก target** ด้วย balancing algorithm
- **ข้าม target ที่ไม่ healthy** มันหาตัวพวกนี้ด้วยการ probe (active health check) หรือด้วยการดู traffic จริง (passive check, outlier detection)
- **เพิ่มและถอด target อย่างนุ่มนวล** ตัวใหม่ค่อย ๆ เพิ่มส่วนแบ่ง (*slow start*) ส่วนตัวที่กำลังออกจะไม่ได้งานใหม่ และทำงานที่ถืออยู่ให้เสร็จ (*connection draining*)

### Layer 4 หรือ layer 7

| | Layer 4 (transport) | Layer 7 (application) |
|---|---|---|
| กระจายอะไร | TCP connection และ UDP flow | HTTP request และ gRPC call ทีละตัว |
| เห็นอะไร | address, port, protocol | method, host, path, header, cookie, status code |
| ทำอะไรได้ | forward ได้ทุก protocol ด้วยต้นทุนต่ำมาก ถ้าเป็น proxy ก็ terminate TLS ได้ด้วย | route ตาม host หรือ path, retry, ปัก session ด้วย cookie, กระจายทีละ request |
| ตัวอย่าง | AWS Network Load Balancer, Azure Load Balancer, Google Cloud Network Load Balancers | AWS Application Load Balancer, Azure Application Gateway, Google Cloud Application Load Balancers, NGINX, HAProxy และ Envoy ในโหมด HTTP |

balancer แบบ layer 4 เลือก **ครั้งเดียวต่อ connection**: ยกตัวอย่าง AWS Network Load Balancer จะ hash flow แล้วให้ TCP connection อยู่กับ target เดิมตลอดอายุของมัน วิธีนี้ใช้ได้ดีเมื่อ connection มีเยอะและสั้น แต่จะพังกับ **HTTP/2 และ gRPC** ที่ multiplex หลาย request ไว้บน connection เดียวที่เปิดค้างไว้: ทุก request จาก client หนึ่งจะไปลงที่ instance ที่ connection ไปถึงเป็นตัวแรก ถ้า client ไหนยุ่งมาก instance ตัวนั้นก็รับ load เกิน และ instance ที่เพิ่มเข้ามาทีหลังจะไม่ได้อะไรเลยจนกว่า client จะ reconnect ส่วน Kubernetes Service ก็กระจายแบบนี้เหมือนกัน: kube-proxy เลือก backend Pod ให้แต่ละ connection ใหม่ ถ้า connection อยู่นานและ multiplex ก็ต้องใช้ **การกระจายระดับ request**: layer-7 proxy, sidecar ของ service mesh หรือ client ที่กระจายเอง

### Algorithm

- **Round robin:** target ตัวถัดไปในรายการ กระจายเท่า ๆ กันและเดาได้ เมื่อ request และ instance หน้าตาเหมือนกัน และเป็น default ใน NGINX และบน AWS Application Load Balancer
- variant แบบ **weighted** ให้ส่วนแบ่งมากขึ้นกับ instance ที่ใหญ่กว่า การขยับ weight ก็เป็นวิธีที่ slow start และ canary release ใช้ค่อย ๆ ย้าย traffic
- **Least connections** ที่ HTTP balancer เรียกว่า *least outstanding requests* หรือ *least request*: target ที่มี request in flight น้อยที่สุด มันปรับตัวได้เมื่อ request มีต้นทุนต่างกัน หรือ instance ตัวหนึ่งช้าลง มันมีกับดักสองข้อ ข้อแรกคือ instance ที่ **fail เร็ว** แทบไม่มีอะไร in flight เลยดูเหมือนว่างแล้วดึง traffic เข้าไปอีก (*black hole*) และอีกข้อคือ instance ใหม่เอี่ยมเริ่มที่ศูนย์ แล้วจะโดนถล่มถ้าไม่ได้ slow start
- **Power of two choices:** สุ่ม target มาสองตัวแล้วใช้ตัวที่ load น้อยกว่า Mitzenmacher แสดงว่าการเลือกจากสองตัวดีขึ้นแบบ exponential เมื่อเทียบกับการสุ่มเลือกตัวเดียว ส่วนการเพิ่มเป็นสามตัวดีขึ้นแค่ระดับ constant factor วิธีนี้ไม่ต้องมีมุมมองร่วมของ pool เลยเหมาะกับ balancer หลายตัวที่ทำงานแยกกัน least-request balancer ของ Envoy ทำงานแบบนี้เมื่อ weight เท่ากัน, NGINX มี `random two least_conn` และ `random` ของ HAProxy ก็สุ่มสอง server เป็นค่า default
- **Hashing:** hash key (client address, header, cookie, URL) เพื่อให้ key เดิมไปถึง target เดิมเสมอ วิธีนี้ทำให้ cache อุ่นอยู่ และได้ affinity โดยไม่ต้องเก็บ session ของทุก client ส่วน **Consistent hashing** (ring แบบ ketama หรือ lookup table ของ Maglev) ย้ายแค่ key ส่วนน้อยเมื่อมี target เข้าหรือออก

### Health check

- check แบบ **active** จะ probe ทุก target ตามรอบเวลา ไม่ว่าจะมี traffic หรือไม่ แล้วนับผลที่ติดกัน: fail ติดกันกี่ครั้งถึงจะถอด target ออก ผ่านกี่ครั้งถึงจะใส่กลับ ส่วน check แบบ **passive** ดู response จริงแทน อย่าง NGINX จะ mark server ว่าใช้ไม่ได้หลังพยายามแล้ว fail `max_fails` ครั้งภายใน `fail_timeout` และ *outlier detection* ของ Envoy จะ eject host ที่ตอบ error ติดกัน หรือมี success rate ตามหลังตัวอื่น passive check ตอบสนองต่อสิ่งที่ผู้ใช้เห็นจริงพอดี แต่ทำได้แค่กับ target ที่กำลังได้ traffic อยู่ ทั้งสองแบบเลยเสริมกัน อย่าง Envoy ก็ให้เปิดทั้งสองแบบพร้อมกันได้
- **ตื้นหรือลึก** check แบบตื้น (liveness) พิสูจน์ว่า process ยังอยู่และตอบได้ ส่วน check แบบลึกจะลองเรียกสิ่งที่ instance ต้องใช้ด้วย เช่นฐานข้อมูลหรือ service ปลายทาง check แบบลึกจับได้มากกว่า แต่ถ้า dependency ที่แชร์กันสะดุด **ทุก instance จะ fail พร้อมกัน** และ balancer ก็ไม่เหลือที่ให้ส่ง traffic
- **Fail open** เพื่อให้รอดกรณีนั้น balancer หลายตัวจะเลิกสนใจ health เมื่อ target ที่ผ่าน check เหลือน้อยเกินไป Application Load Balancer จะ route ไปทุก target ใน group เมื่อทุกตัว unhealthy และ Envoy จะเข้า *panic mode* เมื่อสัดส่วนที่ healthy ของ cluster ต่ำกว่า panic threshold (default 50%) แล้วกระจายไปทุก host โดยไม่สน health เลย คุณต้องตัดสินใจให้ชัดว่าอยากได้แบบไหน: ได้คำตอบบ้างจาก instance ที่อาจพัง หรือไม่ได้อะไรเลย
- **threshold และ interval** แลกกันระหว่างเวลาตรวจจับกับ **flapping** การตรวจจับใช้เวลาราว *interval × unhealthy threshold* และทุก request ที่ส่งไปในช่วงนั้นมีความเสี่ยง interval สั้นกับ threshold ต่ำเลยเจอความล้มเหลวได้เร็ว ส่วนการให้ต้องผ่านหลายครั้งก่อนที่ target จะกลับมา ก็กันไม่ให้ instance ที่กำลังแย่เด้งเข้าเด้งออก

### balancer อยู่ตรงไหน

- **Zone** กระจาย target ข้าม availability zone เพื่อให้การเสีย zone หนึ่งทำให้เสียแค่ capacity บางส่วน ไม่ใช่เสียทั้ง service ถ้าเปิด *cross-zone* balancing แต่ละ node ของ balancer จะกระจายไปที่ target ในทุก zone ถ้าไม่เปิด แต่ละ node จะใช้แค่ target ใน zone ของตัวเอง ทำให้ traffic อยู่ในพื้นที่ แต่ zone ที่มี target น้อยกว่าจะรับ load เกิน
- **availability ของ balancer เอง** load balancer ที่อยู่หน้าทุกอย่างคือ single point of failure เว้นแต่ตัวมันเองจะ redundant ด้วย ตัว managed balancer รัน node ที่ redundant ข้ามหลาย zone อยู่หลัง DNS name หรือ anycast address ส่วนแบบที่ดูแลเองใช้คู่ active-standby ที่แชร์ virtual IP (VRRP) หรือ node ที่เท่ากันหลายตัวอยู่หลัง anycast หรือ ECMP routing ตัว Maglev ของ Google สร้างแบบที่สอง และใช้ consistent hashing กับ connection tracking เพื่อให้ connection ที่ตั้งไว้แล้วรอดจากความล้มเหลว
- **Client-side balancing และ service mesh** logic ของการกระจายไปอยู่ที่ฝั่งผู้เรียกได้ แทนที่จะอยู่ในกล่องตรงกลาง: gRPC client ที่ใช้ policy `round_robin` หรือ xDS control plane หรือ sidecar proxy จาก service mesh ที่กระจายทีละ request และเพิ่ม retry กับ outlier detection ให้ด้วย วิธีนี้ตัด hop กับคอขวดระหว่าง service ออกไปหนึ่งจุด และทำให้ logic ไปอยู่ในทุก client หรือทุก sidecar
- **Regional หรือ global** regional balancer กระจาย request ไปที่ instance และ zone ใน region เดียว ส่วน global balancer ที่สร้างบน anycast หรือ DNS จะเลือก region ก่อน แบบใน [Multi-Region Active-Active](../multi-region-active-active/)

## ใช้ตอนไหนดี

- หน้า service ใด ๆ ที่รันมากกว่าหนึ่ง instance หรือก็คือทุก service ที่ต้องอยู่รอดผ่านความล้มเหลวหรือการ deploy
- เพื่อ scale tier ที่ stateless ในแนวนอน เมื่อใช้คู่กับ [Autoscaling](../autoscaling/) ตัว pool จะเปลี่ยนขนาดเอง: health check ของ balancer ตัดสินว่า instance ใหม่จะเริ่มได้ traffic เมื่อไร draining ให้ตัวที่กำลังออกทำงานให้เสร็จ และ request ต่อ target ก็เป็นสัญญาณที่ดีสำหรับการ scale
- เพื่อ deploy โดยไม่มี downtime: rolling update, [Blue-Green Deployment](../blue-green-deployment/) และ [Canary Release](../canary-release/) ทำงานด้วยการเปลี่ยนว่า balancer ส่งไปที่ target ไหน และส่งมากแค่ไหน
- ระบบที่มี state ต้องคิดมากขึ้น database primary, leader หรือ shard owner สลับกับตัวอื่นไม่ได้ ตรงนั้นเลยต้องใช้ routing ที่รู้ role หรือ consistent hashing ไม่ใช่ round robin ธรรมดา

## ได้อะไร เสียอะไร

- **เพิ่มอีกหนึ่ง hop และอีกหนึ่งอย่างที่พังได้** balancer แบบ proxy เพิ่ม latency นิดหน่อย และต้อง available อย่างน้อยเท่ากับ service ที่อยู่ข้างหลัง
- **request เท่ากันไม่ได้แปลว่า load เท่ากัน** round robin นับ request แต่ไม่สนว่าแต่ละตัวแพงแค่ไหน policy แบบ least-loaded ปรับตัวได้ แต่มีกับดัก black hole กับ cold start ที่พูดถึงด้านบน และ balancer เห็นแค่ traffic ของตัวเอง ไม่เห็นว่า balancer ตัวอื่นส่งอะไรไปบ้าง
- **stateless หรือ sticky** *session affinity* (sticky session ด้วย cookie หรือ client address) ให้ผู้ใช้อยู่กับ instance เดียว state ใน memory เลยใช้ได้ แต่มันก็ทำให้ load เบี้ยว ทำให้ session ค้างเมื่อ instance ตาย และขวางการ scale in ทางที่ดีกว่าคือใช้ instance ที่ stateless และเก็บ session ไว้ใน shared store หรือ token แล้วเก็บ affinity ไว้ใช้กับสิ่งที่ย้ายไม่ได้
- **health check มีดาบสองคม** ตื้นเกินไป instance ที่พังก็ยังอยู่ใน rotation ลึกเกินไป dependency ตัวเดียวก็ถอดทุก instance ออกพร้อมกัน ช้าเกินไป ผู้ใช้ก็เจอความล้มเหลวนาน ไวเกินไป instance ที่ healthy ก็ flap
- **ความล้มเหลวยังมีราคา** request ที่ค้างอยู่บน instance ที่พังจะหายไป เว้นแต่มีอะไร retry มัน และ retry ปลอดภัยแค่กับ request ที่ idempotent (ดู [Retry with Backoff & Jitter](../retry-with-backoff/)) ส่วน instance ที่รอดต้องรับ load แทน เลยต้องตั้งขนาด pool ให้เสีย instance หนึ่งตัว หรือหนึ่ง zone แล้วยังรับไหว
- **การกระจายระดับ connection เข้ากันไม่ดีกับ connection ที่อยู่นาน** HTTP/2, gRPC, WebSockets และ database connection จะอยู่ที่เดิมที่มันลงครั้งแรก ให้กระจายทีละ request ถ้า protocol ยอม หรือให้ server ปิด connection หลังผ่านไปสักพัก (`MAX_CONNECTION_AGE` ของ gRPC) เพื่อให้ client reconnect แล้วกระจายตัวออกไป

## ข้อควรรู้ตอนลงมือทำ

พฤติกรรมและค่า default ของ vendor เปลี่ยนได้ ให้ถือว่าสิ่งเหล่านี้เป็นตัวอย่าง และเช็ก documentation ฉบับปัจจุบัน

- **AWS Application Load Balancer:** routing เป็น round robin โดย default มี *least outstanding requests* และ *weighted random* เป็นทางเลือก ส่วน target แบบ instance หรือ IP จะถูก check ทุก 30 วินาที timeout 5 วินาที ถูกถอดออกหลัง fail ติดกัน 2 ครั้ง และกลับมาหลังผ่านติดกัน 5 ครั้ง ถ้าใช้ default ก็จะรู้ว่า target ตายหลังผ่านไปราวหนึ่งนาที target group ที่ไม่มี target ที่ healthy เลยจะ fail open การ deregister (draining) รอได้นานสุด 300 วินาทีโดย default ส่วน slow start ปิดอยู่โดย default ถ้าเปิดจะนาน 30 ถึง 900 วินาที และใช้กับ algorithm ทางเลือกสองตัวนั้นไม่ได้ ด้าน cross-zone balancing เปิดเสมอในระดับ load balancer และปิดได้ต่อ target group ส่วนบน Network และ Gateway Load Balancer มันปิดโดย default
- **NGINX:** round robin เป็น default บวกกับ `least_conn`, `ip_hash`, `hash` (คู่กับ `consistent`), `random` (คู่กับ `two`) และ `least_time` ค่า default ของ passive check คือ `max_fails=1` และ `fail_timeout=10s` ส่วน probe แบบ active `health_check` กับ `slow_start` มีเฉพาะใน commercial subscription
- **HAProxy:** `balance roundrobin`, `leastconn`, `random`, `source`, `uri`, `hdr` และอื่น ๆ เวอร์ชัน 3.4 ใช้ `random` เมื่อไม่ได้ตั้งอะไร (ใน 3.2 เป็น `roundrobin`) ส่วน health check (`check`) มี default คือ check ทุก 2 วินาที (`inter`) fail 3 ครั้งถึงจะ mark ว่า server down (`fall`) และผ่าน 2 ครั้งถึงจะกลับมา (`rise`) และ `slowstart` จะค่อย ๆ เพิ่ม weight ของ server ที่กลับมาแบบเส้นตรง
- **Envoy และ service mesh:** weighted round robin, weighted least request, ring hash, Maglev และ random นอกจากนี้ยังมี active health checking, outlier detection, panic threshold และโหมด slow-start สำหรับ round robin กับ least request ส่วน Linkerd กระจาย HTTP, HTTP/2 และ gRPC request ทีละตัว และให้น้ำหนักกับ endpoint ที่ตอบเร็วที่สุดในช่วงที่ผ่านมา (exponentially weighted moving average)
- **gRPC:** client policy ที่เป็น default คือ `pick_first` จะส่งทุก call ไปที่ address เดียว ให้ใช้ `round_robin`, xDS control plane หรือ layer-7 proxy เพื่อกระจาย call
- **health endpoint:** probe สัญญาณ readiness ที่แปลว่า *instance นี้ serve ได้ตอนนี้* และทำให้มันถูก เร็ว และไม่มี side effect ถ้าเป็น Kubernetes ตัว Pod ที่ fail readiness probe จะถูกถอดออกจาก endpoint ของ Service ส่วน instance ที่ยุ่งอยู่ก็ต้องยังตอบ health check ได้ ไม่อย่างนั้น pool ที่ load เกินจะ eject ตัวเองทิ้งหมด ปล่อย check ของ shared dependency ให้ระบบ monitoring ดูแล หรือไม่ก็ทำให้แน่ใจว่า balancer จะ fail open
- **Draining:** ตอน shutdown instance ควร fail readiness check หรือถูก deregister แล้วทำ request ที่ in flight ให้เสร็จ จากนั้นค่อย exit หนังสือ SRE ของ Google เรียกสถานะนี้ว่า *lame duck* ตั้งเวลา drain ให้นานกว่า request ที่ช้าที่สุด
- **รู้ว่า client เป็นใคร:** หลัง layer-7 proxy ตัว instance จะเห็น address ของ balancer ส่วน client ตัวจริงจะมากับ `X-Forwarded-For` (หรือ PROXY protocol ที่ layer 4)
- **คอยดู:** จำนวน target ที่ healthy, request และ error ต่อ target, latency ต่อ target และ connection ที่ balancer ปฏิเสธเอง pool ที่ค้างอยู่ที่จำนวน healthy ขั้นต่ำไม่เหลือ margin แล้ว
