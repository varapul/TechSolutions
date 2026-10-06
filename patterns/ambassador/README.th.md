## ปัญหา

ระบบส่วนใหญ่มี client แบบแอป billing ใน animation อยู่สักตัว: เป็น product ของ vendor หรือโค้ดที่คนเขียนลาออกไปหลายปีแล้ว มันทำงานของมันได้ และไม่มีใครแก้มันได้หรือได้รับอนุญาตให้แก้ มันเรียก remote service ด้วยวิธีที่ง่ายที่สุด: address ตายตัวตัวเดียว, plain HTTP, ไม่มี timeout, ไม่มี retry, ไม่มี metrics

แบบนี้ใช้ได้จนกว่าฝั่ง remote จะเปลี่ยน และ remote service ก็เปลี่ยนอยู่ตลอด:

- **ย้ายที่** host ใหม่, address ใหม่, instance เพิ่มขึ้นหลังชื่อใน DNS หรือ service registry ทำให้ client ที่รู้จักแค่ address ตายตัวตัวเดียวเรียกตัวเก่าต่อไป
- **ยกระดับ security** HTTPS อย่างเดียว, mutual TLS พร้อม client certificate, OAuth 2.0 access token ในทุก request ส่วน client ที่ build ใหม่ไม่ได้ก็เรียนรู้อะไรพวกนี้ไม่ได้เลย
- **ช้าลงหรือพัง** ถ้าไม่มี timeout การเรียกที่ช้าทุกครั้งจะถือ thread หรือ connection ไว้จน client ไม่เหลือให้ใช้แล้วค้างไป ถ้าไม่มี retry อาการสะดุดนิดเดียวก็กลายเป็น error ส่วนถ้าไม่มี circuit breaker ตัว client ก็จะรุมเรียก service ที่กำลังแย่อยู่แล้วต่อไปเรื่อย ๆ
- **ไม่มีใครเห็นว่าเกิดอะไรขึ้น** ถ้าไม่มี metrics หรือ trace ตอนที่ billing ช้า ก็ไม่มีใครบอกได้ว่าเป็นความผิดของ billing หรือของ tax API

ทางแก้ปกติคือ client library: HTTP client ที่มี timeout, retry, TLS และ telemetry ฝังอยู่ในโค้ด แต่นั่นแหละคือสิ่งที่ทำไม่ได้ในกรณีนี้ ต่อให้ทำได้ ระบบที่เขียนด้วยห้าภาษาก็ต้องมีห้า library ที่ทำงานเหมือนกัน และต้อง upgrade แต่ละตัวในทุก service ทุกรอบ release

## ทำงานยังไง

วาง proxy ตัวเล็ก ๆ ที่เรียกว่า **ambassador** ไว้ข้าง client แล้วให้การเรียกขาออกของ client วิ่งผ่านมัน Azure Architecture Center อธิบายว่ามันเป็น proxy แบบ out-of-process ที่อยู่ร่วมที่กับ client: รันบน host เดียวกัน หรือใน Kubernetes ก็อยู่ใน pod เดียวกัน client เลยเข้าถึงมันได้ผ่าน `localhost`

1. **client เรียก localhost** สิ่งเดียวที่เปลี่ยนใน billing คือ setting ตัวเดียว: tax endpoint ของมันกลายเป็น `http://localhost:9000` ตัว billing ยังพูด plain HTTP อยู่ แต่ตอนนี้พูดแค่ผ่าน loopback interface
2. **ambassador หา service** มัน resolve `tax-api.internal` ผ่าน DNS หรือ service registry และคอยทำรายการ instance ให้เป็นปัจจุบัน ทำให้ API ย้ายหรือ scale ได้โดยที่ billing ไม่รู้ตัว
3. **ทำให้การเรียกปลอดภัย** มันเปิด TLS connection ไปหา instance หนึ่ง ยื่น client certificate (mutual TLS) เติม access token ที่ API ต้องการ แล้วส่ง request ต่อไป
4. **จำกัดขอบเขตของการเรียก** แต่ละครั้งที่ลองมี timeout ส่วนการเรียกแบบ idempotent ที่พังจะถูก retry หลังรอ backoff แบบมี jitter และ circuit breaker จะหยุดเรียก API ที่พังซ้ำ ๆ แล้วตอบ error กลับไปทันทีแทน
5. **บันทึกการเรียก** ทุก request ทิ้ง metrics (latency, error, timeout, retry, สถานะของ breaker) และ trace span ไว้
6. **response กลับมาทางเดิม** สำหรับ billing ตอนนี้ tax API ดูเหมือน service ที่รันอยู่ในเครื่องของมันเอง

client แยกไม่ออกว่าอันไหนคือ ambassador อันไหนคือ remote service และนั่นแหละคือประเด็น feature เรื่องการเชื่อมต่ออยู่ใน process แยกที่มีรอบ release ของตัวเอง และมักมีทีม platform, network หรือ security เป็นเจ้าของ ไม่ใช่ทีมของแอปพลิเคชัน

### ที่มาของชื่อ

Brendan Burns อธิบายวิธีรวม container บนเครื่องเดียวไว้สามแบบ ในบล็อกโพสต์ของ Kubernetes ปี 2015 และอีกครั้งร่วมกับ David Oppenheimer ใน paper ที่ HotCloud ปี 2016 ตัว container แบบ **ambassador** ทำหน้าที่ proxy การสื่อสารของ container หลักกับโลกภายนอก ตัวอย่างในบล็อกคือ Redis ambassador ที่ส่งการเขียนไปที่ primary และส่งการอ่านไปที่ replica ส่วนตัวอย่างใน paper คือ twemproxy ที่อยู่หน้า memcache แบบ shard: แอปพลิเคชันเชื่อว่ามันคุยกับ memcache server ตัวเดียวบน `localhost` ขณะที่ ambassador กระจาย key ไปตาม server หลายตัวที่อยู่ที่อื่นใน cluster ส่วน paper ก็บอกประโยชน์ไว้สามข้อ: developer เขียนโปรแกรมกับ server ในเครื่องตัวเดียว แอปพลิเคชัน test กับ server ในเครื่องตัวจริงแทน ambassador ได้ และ ambassador ตัวเดียวกันก็ใช้ซ้ำกับแอปพลิเคชันที่เขียนด้วยภาษาอื่นได้ ที่ทำแบบนี้ได้เพราะ container ที่จัดกลุ่มไว้ด้วยกัน อย่าง container ใน pod เดียวกัน ใช้ network namespace เดียวกัน เลยมี `localhost` เดียวกัน

Azure Architecture Center จัดให้มันเป็นหนึ่งใน cloud design pattern และขยายความให้กว้างกว่าเรื่อง container: เป็น helper service ที่ส่ง network request แทน client และรันอยู่บน host เดียวกัน มีประโยชน์ที่สุดกับ legacy application และแอปอื่นที่แก้ยาก

[Sidecar](../sidecar/) คือชื่อของกลไกการ deploy คือ process ตัวช่วยที่ deploy และรันอยู่ข้างแอปพลิเคชัน ส่วน ambassador คือ sidecar ที่มีงานเฉพาะอย่างหนึ่ง: connection ขาออกของ client

อย่าสับสนกับ Emissary-ingress ที่เคยชื่อ *Ambassador API Gateway* ถึงจะมีชื่อเก่าแบบนั้น แต่มันคือ API gateway ที่สร้างบน Envoy สำหรับ traffic ที่วิ่งเข้า Kubernetes cluster: เป็น edge ขาเข้า ไม่ใช่ pattern นี้

### ambassador ทำอะไรบ้าง

| งาน | ambassador ทำอะไร | ดูเพิ่ม |
|---|---|---|
| Discovery และ routing | resolve ชื่อเชิงตรรกะเป็น instance ปัจจุบัน กระจาย load ไปตาม instance พวกนั้น route ตาม path หรือ header และตาม service ไปเมื่อมันย้าย | |
| Sharding ให้ client ของ cache หรือ database | hash แต่ละ key ไปที่ shard ที่ถูกต้อง client เลยเห็นเป็น server ตัวเดียว ส่วน twemproxy ก็ทำแบบนี้ให้ memcached กับ Redis | [Sharding](../sharding/) |
| TLS และ mutual TLS | เริ่ม TLS ไปหา service, ตรวจ certificate ของ service และยื่น certificate ของ client เอง | [Mutual TLS (mTLS)](../mutual-tls/) |
| Credential | ขอ access token (เช่นด้วย client credentials grant) cache ไว้ ต่ออายุก่อนหมด และเติมลงในทุก request | [OAuth 2.0 Client Credentials](../oauth2-client-credentials/) |
| Timeout | จำกัดเวลาของแต่ละครั้งที่ลอง และของการเรียกทั้งหมด | [Timeout & Fallback](../timeout-and-fallback/) |
| Retry | retry ความล้มเหลวชั่วคราวของการเรียกแบบ idempotent ด้วย exponential backoff กับ jitter ภายใน retry budget | [Retry with Backoff & Jitter](../retry-with-backoff/) |
| Circuit breaking | หยุดเรียก service ที่กำลังพัง และ fail ทันทีจนกว่ามันจะกลับมา | [Circuit Breaker](../circuit-breaker/) |
| Telemetry | ปล่อย metrics, access log และ trace span ให้ทุกการเรียก | [Distributed Tracing](../distributed-tracing/) |
| เชื่อม protocol | ให้ client ใช้ protocol ง่าย ๆ ต่อไป (HTTP/1.1, plain TCP) ขณะที่ ambassador พูด HTTP/2 หรือ TLS กับ service | |

### deploy ยังไง

- **เป็น sidecar container** ใน pod หรือ task ของ client ตัว container ใน pod ใช้ network namespace ของ pod ร่วมกัน `localhost` เลยเข้าถึง ambassador ได้จาก client และไม่ได้จากที่อื่นเลย ใน Kubernetes ให้ประกาศเป็น native sidecar container (init container ที่มี `restartPolicy: Always`, stable ตั้งแต่ v1.33): มันจะ start ก่อน container ของแอปพลิเคชัน และตอน shutdown ตัว kubelet จะรอให้แอปพลิเคชันหยุดก่อนค่อยหยุดมัน ดู [Sidecar](../sidecar/)
- **เป็น process บน virtual machine เดียวกัน** เป็น daemon หรือ Windows service สำหรับ client ที่ไม่ได้รันใน container อย่าง binary จาก vendor ส่วนใหญ่
- **หนึ่งตัวต่อ client หรือใช้ร่วมกัน** ambassador หนึ่งตัวต่อ client ทำให้ configuration, credential, ความล้มเหลว และการ upgrade แยกจากกัน ถ้าใช้ตัวเดียวร่วมกันหลาย process บน host หนึ่ง ก็มีสำเนาที่ต้องรันน้อยลง แต่ก็ได้ configuration ชุดเดียวและ identity เดียวสำหรับทุกตัว และพังทีเดียวก็ตัดทุกตัวออกหมด ส่วน pattern ของ Azure อธิบายไว้ทั้งสองแบบ: sidecar ที่มีวงจรชีวิตตาม client ของมัน หรือ daemon ที่ process บน host ใช้ร่วมกัน

**ต้นทุนของการรัน** ทุกการเรียกตอนนี้ต้องข้ามอีกหนึ่ง process บน loopback interface ไม่มี network จริงมาขวาง แต่ request ก็ยังต้องถูก parse อาจถูกเข้ารหัสใหม่ และถูก log ทำให้การเรียกทุกครั้งช้าลงนิดหน่อย และเส้นทางที่คุยถี่จะรู้สึกมากที่สุด ambassador ทุกตัวยังต้องใช้ CPU กับ memory ของตัวเอง คูณด้วยจำนวน client หรือ host ที่รันมัน

### proxy ที่เป็น ambassador ได้ดี

แทบไม่มีเหตุผลที่ต้องเขียนเองตั้งแต่ศูนย์ proxy อเนกประสงค์ทำงานนี้ได้เมื่อตั้งค่าให้รับ traffic ขาออกของ client ตัวเดียว ตัวอย่างพวกนี้ตรวจกับ documentation ของแต่ละ project เมื่อตุลาคม 2026:

- **Envoy** ถูกออกแบบมาเป็น proxy แบบ out-of-process ที่รันข้างทุกแอปพลิเคชัน และใช้กับภาษาไหนก็ได้ documentation ของมันอธิบาย deployment แบบนี้ไว้ตรง ๆ: แอปพลิเคชันส่งการเรียกระหว่าง service ไปที่ egress listener บน `localhost` (`http://localhost:9001` ใน docs) และ external service แต่ละตัวก็ได้ local port ของตัวเอง (`localhost:9250` สำหรับ DynamoDB ในตัวอย่างของเขา) ตัว Envoy จัดการ discovery (ชื่อ DNS ที่มันคอย resolve ใหม่ หรือ endpoint จาก control plane), load balancing, การเริ่ม TLS พร้อม client certificate, retry ด้วย exponential backoff แบบ full jitter (ค่า default คือ base interval 25 ms และเพดาน 250 ms), timeout ต่อครั้งที่ลอง, circuit breaking และ outlier detection ส่วน circuit breaking ของมันจำกัดจำนวน connection, pending request และ retry ต่อ cluster และ outlier detection ก็เอา host ที่พังออกจาก pool ไปสักพัก ตัว breaker ที่เปิดและปิดใน animation คือรูปแบบคลาสสิกของ pattern circuit breaker ที่ library เป็นคน implement นอกจากนี้ setup ใน documentation ของมันยังให้แอปพลิเคชันพูด HTTP/1.1 กับ Envoy ในเครื่อง ขณะที่ Envoy ด้วยกันใช้ HTTP/2
- **HAProxy** เข้ารหัส connection ไปหา server ด้วย `ssl` บนบรรทัด `server` และยื่น client certificate ด้วย `crt` เมื่อ server ขอ ส่วน `timeout connect` กับ `timeout server` ก็จำกัดเวลารอ และ `retries` จะ retry การพยายาม connect ที่ล้มเหลวโดย default และมี `retry-on` สำหรับความล้มเหลวแบบอื่น
- **NGINX** ยื่น client certificate ให้ upstream ด้วย `proxy_ssl_certificate` ส่ง request ที่ล้มเหลวไปให้ server ตัวถัดไปด้วย `proxy_next_upstream` และใน build แบบ open-source ตั้งแต่ 1.27.3 ก็คอย resolve ชื่อของ upstream server ใหม่ด้วย parameter `resolve`
- **twemproxy** (nutcracker) ตัวอย่างใน paper เป็น proxy น้ำหนักเบาสำหรับ protocol ของ memcached กับ Redis มัน shard key ไปตาม pool ของ server และถือ persistent connection ไปหาพวกมันไว้ ทำให้จำนวน connection ที่ cache server แต่ละตัวต้องถือลดลงด้วย
- **proxy ของ service mesh** ใน mesh แบบ sidecar ตัว proxy ที่อยู่ข้างแต่ละ workload ก็ทำหน้าที่ ambassador ให้การเรียกขาออกทั้งหมดของ workload นั้นอยู่แล้ว ยกตัวอย่างเช่น Istio รับ plain HTTP จากแอปพลิเคชันแล้วเริ่ม TLS ไปหา HTTPS service ภายนอกได้ ดู [Service Mesh](../service-mesh/)

## ใช้ตอนไหนดี

- **client แก้ไม่ได้**: binary จาก vendor, แอปเก่าที่ไม่มีใครดูแล หรือโค้ดที่รอบ release ช้ากว่าที่เรื่อง network ต้องการมาก ตัว ambassador เติมสิ่งที่มันขาดจากข้างนอก
- **client หลายภาษาต้องการ feature การเชื่อมต่อแบบเดียวกัน** proxy ตัวเดียวทำงานเหมือนกันไม่ว่าจะอยู่ข้าง Java, Go, Python หรือ COBOL ขณะที่ library ต้องมีหนึ่ง implementation ต่อหนึ่งภาษา
- **มีทีมเฉพาะทางเป็นเจ้าของเรื่องการเชื่อมต่อ** engineer ฝั่ง security, network หรือ platform เปลี่ยน TLS setting, credential และ retry policy ได้เองโดยไม่ต้องรอ release ของแอปพลิเคชัน
- **ความต้องการเรื่องการเชื่อมต่อไม่เข้ากับเครื่องมือของ platform**: protocol หรือ authentication scheme แบบเก่าที่ gateway หรือ mesh ไม่รองรับ หรือ dependency ที่อยู่นอก mesh
- **ปรับปรุงระบบ legacy** ambassador ทำให้ client เก่ายังทำงานได้และมองเห็นได้ ระหว่างที่สร้างตัวใหม่มาแทน มักเป็นส่วนหนึ่งของการย้ายแบบ [Strangler Fig](../strangler-fig/) พอ client ใหม่ขึ้นใช้งานจริง ambassador ก็ปลดระวางไปพร้อมกับตัวเก่า

### ตอนไหนไม่ควรใช้

- **เส้นทางที่ latency สำคัญมาก** ที่แม้แต่ hop ในเครื่องในทุกการเรียกก็แพงเกินไป
- **ระบบภาษาเดียวที่มี library ดี ๆ** ถ้า client ทุกตัวเขียนด้วยภาษาเดียว client library ที่ดูแลดีก็ง่ายกว่าการเพิ่ม process อีกตัวต่อ client
- **feature ที่ต้อง integrate กับ client แบบลึก**: retry ที่ขึ้นกับ business rule, fallback ที่ต้องใช้ข้อมูลของแอปพลิเคชัน, การตัดสินที่ขึ้นกับ user ตัว proxy เห็นแค่ request กับ response ไม่เห็นเจตนาของ client
- **เมื่อ platform มีให้อยู่แล้ว** ถ้า service รันอยู่ใน service mesh ที่ให้ mutual TLS, retry และ telemetry อยู่แล้ว ก็ไปตั้งค่า mesh แทนการสร้าง ambassador เอง

### Ambassador, client library, service mesh หรือ API gateway?

| | Client library | Ambassador | Service mesh | API gateway, gateway offloading |
|---|---|---|---|---|
| รันที่ไหน | ใน client | ข้าง client ตัวเดียว | ข้างทุก service บวก control plane | ที่ edge |
| traffic แบบไหน | ขาออก client ตัวเดียว | ขาออก client ตัวเดียว (หรือไม่กี่ตัวบน host เดียว) | ทั้งขาเข้าและขาออก ทุก service | ขาเข้า จากหลาย client |
| ต้องแก้ client แค่ไหน | แก้โค้ดและ build ใหม่ | setting endpoint ตัวเดียว | ปกติไม่ต้องแก้ | ไม่ต้องแก้ |
| ภาษา | หนึ่ง library ต่อหนึ่งภาษา | ภาษาไหนก็ได้ | ภาษาไหนก็ได้ | ภาษาไหนก็ได้ |
| ต้นทุนหลัก | แก้อะไรทีก็ต้อง build client ใหม่ทุกตัว | hop กับ process หนึ่งชุดต่อ client | proxy หนึ่งตัวต่อ workload ใน sidecar mode และ control plane | hop ที่ edge |

[API Gateway](../api-gateway/) กับ [Gateway Offloading](../gateway-offloading/) ย้ายเรื่องขาเข้าของหลาย service ไปไว้ที่ edge ที่ใช้ร่วมกันจุดเดียว ที่ทุก client ต้องผ่าน ส่วน ambassador ย้ายเรื่องขาออกของ client ตัวเดียวไปไว้ใน process ที่อยู่ข้าง ๆ มัน ส่วน [Service Mesh](../service-mesh/) คือรูปแบบที่ขยายออกไปทั่ว: มี proxy อยู่ข้างทุก service ตั้งค่าจาก control plane เดียว และครอบคลุมทั้งสองทิศทาง

## ได้อะไร เสียอะไร

- **ทุกการเรียกมี hop เพิ่มอีกหนึ่ง** บน loopback ก็เล็กน้อย แต่ต้องจ่ายทุก request พอเป็นเส้นทางที่คุยถี่และอ่อนไหวกับ latency ก็จะสะสมขึ้นมา
- **มีชิ้นส่วนที่ต้องดูแลเพิ่มอีกหนึ่งชิ้นต่อ client** เป็นอีก process ที่ต้อง deploy, ตั้งค่า, patch, ทำให้ปลอดภัย และ monitor และมันอยู่บน critical path: ถ้ามัน crash หรือตั้งค่าผิด client ก็เสียการเชื่อมต่อขาออกทั้งหมด คุมมัน ตรวจ health ของมัน และตั้ง alert ให้มันแบบเดียวกับที่ทำให้แอปพลิเคชัน
- **retry ปลอดภัยแค่กับการเรียกที่เป็น idempotent** HTTP กำหนดให้ `GET`, `HEAD`, `OPTIONS`, `TRACE`, `PUT` และ `DELETE` เป็น idempotent และ RFC 9110 แนะนำว่า client ไม่ควรส่ง request แบบอื่นซ้ำเองอัตโนมัติ ยกเว้นจะรู้ว่า request นั้น idempotent อยู่แล้ว หรือรู้ว่าครั้งแรกไม่ได้มีผลอะไร ส่วน proxy เห็นแค่ method กับ path แต่ไม่เห็นผลข้างเคียง: มันไม่รู้ว่า `POST` ทำอะไร ยกตัวอย่าง NGINX โดย default จะไม่ส่ง request `POST`, `LOCK` หรือ `PATCH` ที่ส่งออกไปแล้วต่อให้ server ตัวถัดไป เพราะงั้นให้ตัดสินราย route ว่าอะไร retry ได้ และให้ client ส่ง context มาถ้าทำได้ pattern ของ Azure แนะนำ request header ที่ขอไม่ให้ retry หรือจำกัดจำนวน retry ส่วน Envoy อ่าน hint อย่าง `x-envoy-retry-on`, `x-envoy-max-retries` และ `x-envoy-upstream-rq-timeout-ms` จาก request แล้วก็มี header `Idempotency-Key` (ที่ API อย่างของ Stripe ใช้ ส่วน IETF draft ที่จะทำให้มันเป็นมาตรฐานก็หมดอายุไปแล้ว) ที่ทำให้ server จำ request ที่ส่งซ้ำได้ ส่วน client แบบ legacy ไม่ส่ง hint อะไรมา ทำให้ ambassador ของมัน retry แค่ route ที่รู้ว่าปลอดภัย: lookup `GET /rates` ได้ แต่ `POST /transactions` ไม่มีวัน
- **timeout ต้องสอดคล้องกับของ client** งบเวลาทั้งหมดของ ambassador ทั้งทุกครั้งที่ลองและทุก backoff ต้องจบก่อนที่ client จะเลิกรอ ไม่อย่างนั้น client จะ timeout ไปก่อน และอาจ retry เอง ระหว่างที่ ambassador ยัง retry อยู่ แล้ว load ก็จะทวีคูณ ตัว billing ไม่มี timeout ของตัวเองเลย ทำให้ limit ของ ambassador เป็น limit เดียวที่มันมี
- **client ยังต้องรับมือกับ error เอง** breaker ที่เปิดอยู่เปลี่ยนการค้างเป็น `503` ที่มาเร็ว แต่ client เป็นคนตัดสินว่าจะทำอะไรต่อ การเรียกบางแบบ ตัว ambassador ตอบด้วยคำตอบจาก cache หรือค่า default แทนได้ ส่วนที่เหลือ client ต้องรอดจาก error ให้ได้
- **มันเห็นการเรียก แต่ไม่เห็น context** ambassador วัดได้ทุกการเรียกและปล่อย span ได้ แต่ผูก span นั้นเข้ากับ trace ของ client เองไม่ได้ ยกเว้น client จะส่งต่อ trace context ที่ตัวเองได้รับมา และ documentation ของ Envoy ก็ปล่อยให้ service เป็นคนส่งต่อเรื่องนี้ ส่วน client แบบ legacy ไม่ได้ส่งต่อ ทำให้ trace ของมันเริ่มที่ ambassador
- **plain text บน localhost และ secret อยู่ใน proxy** hop ระหว่าง client กับ ambassador ไม่ได้เข้ารหัส เลยต้อง bind ambassador ไว้กับ loopback address ห้าม bind กับทุก interface และใน pod ทุก container ใช้ loopback เดียวกัน ทำให้ container ไหนก็ใช้ ambassador และ credential ที่มันเติมให้ได้ ตอนนี้ client certificate กับ token อยู่ใน ambassador: ป้องกัน หมุนเวียน และ audit มันที่นั่น แบบนี้ก็ยังดีกว่าปล่อยให้กระจายอยู่ใน configuration ของแอปพลิเคชัน

## ข้อควรรู้ตอนลงมือทำ

- **ชี้ client มาที่มัน** เปลี่ยน endpoint ที่ตั้งค่าไว้คือกรณีง่าย ถ้า address ถูก compile ฝังไว้ ก็ใช้ hosts file หรือ DNS entry ชี้ชื่อนั้นไปที่ loopback address หรือใช้ network rule redirect traffic มาก็ได้ ตัว service mesh ก็ดักจับ traffic ของ pod ด้วยวิธีนี้: Istio ตั้ง redirection ด้วย init container หรือด้วย CNI node agent
- **ตั้งค่าราย route ไม่ใช่ราย service** timeout, retry policy และ idempotency ของ `GET /rates` กับ `POST /transactions` ไม่เหมือนกัน และคำตอบที่ถูกตอน breaker เปิดก็ต่างกันด้วย จำกัด retry ด้วย budget (retry เป็นสัดส่วนของ request ที่กำลังวิ่งอยู่) แทนการกำหนดจำนวนตายตัวต่อ request เพื่อให้ retry ไม่ทวีคูณ load ตอนระบบล่ม โดย documentation ของ Envoy ก็แนะนำ retry budget ด้วยเหตุผลนี้
- **เอางานที่ช้าออกจากเส้นทางของ request** resolve ชื่อใน background แล้ว cache ผลไว้ ทำ pool และใช้ TLS connection ซ้ำ และต่ออายุ certificate กับ token ก่อนหมดอายุ animation แสดง discovery lookup กับ handshake ในการเรียกครั้งแรก ส่วนการเรียกครั้งต่อ ๆ ไปใช้ทั้งสองอย่างซ้ำ
- **start ก่อน stop ทีหลัง** client เรียกออกไปไม่ได้ก่อนที่ ambassador จะ listen และการเรียกที่ค้างอยู่จะพังถ้ามันหยุดก่อน ใช้การจัดลำดับของ platform (native sidecar ของ Kubernetes, service dependency บน VM) และ readiness check
- **ทำ version และ upgrade แยกกัน** ambassador มี image หรือ package, configuration และรอบ release ของตัวเอง ช่องโหว่ใน TLS library ของมันเลย patch ได้โดยไม่ต้องแตะ client ส่วนการ roll out version ใหม่ให้ทำทีละน้อย เริ่มจากไม่กี่ host ก่อน เก็บ configuration ไว้ใน version control และคอยดู metrics ของ ambassador เองระหว่างทำ
- **test กับของจริง** อย่างที่ paper ของ HotCloud ชี้ไว้ ตัว client test กับ server ในเครื่องตัวจริงแทน ambassador ได้: contract ระหว่างสองตัวมีแค่ protocol บน `localhost`
- **วางแผนการปลดระวาง** ในงานปรับปรุงระบบ ambassador ช่วยซื้อเวลา พอ client ถูกแทนที่แล้ว ก็ใส่ timeout, retry และ telemetry ลงใน client ใหม่ หรือยกให้ platform ทำ แล้วปลด ambassador ไปพร้อมกับ client เก่า
