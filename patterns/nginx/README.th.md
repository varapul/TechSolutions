## ปัญหา

Acme Shop เสิร์ฟหน้าร้านที่ shop.example: มีทั้ง JavaScript, CSS และรูปที่เปลี่ยนก็ต่อเมื่อ deploy และมี API ที่รันอยู่บน app server สามตัว ทุก browser และแอปมือถือทุกเครื่องต่อเข้ามาผ่าน HTTPS เลยต้องมีอะไรสักอย่างถือ certificate และทำ TLS handshake ต้องมีอะไรสักอย่างกระจาย API call ไปที่ server ทั้งสามและหยุดส่งไปที่ตัวที่พัง ตอบ request สินค้ายอดนิยมตัวเดิมโดยไม่ต้องถาม app server ทุกครั้ง และชะลอ scraper ก่อนที่มันจะทำให้ทุกคนช้าตาม ถ้าสร้างทั้งหมดนี้ไว้ในแต่ละ app server ก็เท่ากับทำงานเดิมซ้ำสามรอบ แถมยังเอาแอปไปวางบน internet ตรง ๆ

NGINX ทำงานพวกนี้ได้ใน process เดียวที่อยู่หน้าแอป: มันเป็นทั้ง web server, reverse proxy, load balancer และ content cache ตัว NGINX Open Source แจกจ่ายภายใต้ license แบบ 2-clause BSD ส่วน F5 ขาย edition เชิงพาณิชย์ชื่อ NGINX Plus ที่มี module เพิ่มและมี support ส่วนเวอร์ชันในหน้านี้เป็นของเดือนตุลาคม 2026: branch **stable** คือ 1.30 (1.30.5 ออกวันที่ 15 กันยายน 2026) ส่วน branch **mainline** ที่ฟีเจอร์ใหม่มาถึงก่อนคือ 1.31 (1.31.6 ออกวันเดียวกัน)

## ทำงานยังไง

**master หนึ่งตัว worker หลายตัว** master process อ่านและเช็ก `nginx.conf` เปิด listening socket แล้วเริ่ม worker process โดยตัวมันเองไม่เคย handle request เลย `worker_processes auto` เริ่ม worker หนึ่งตัวต่อ CPU core (ค่าตั้งต้นที่ติดมาคือ worker ตัวเดียว) ส่วน worker ใช้ listening socket ร่วมกันและ accept connection เองโดยตรง แต่ละ worker เป็น single-threaded และรัน event loop เดียวครอบทุก connection ของตัวเอง ด้วย readiness API ของ operating system (epoll บน Linux, kqueue บน FreeBSD และ macOS): socket ไหนพร้อมก็เสิร์ฟตัวนั้น ขยับ request นั้นไปอีกหนึ่งขั้น และไม่เคยนั่งรอ client ที่ช้าหรือ upstream ที่ช้า connection หนึ่งกินแค่ file descriptor หนึ่งตัวกับ memory นิดหน่อย ไม่ใช่ thread หนึ่งตัว โดย nginx.org บอกว่า keep-alive connection ที่ idle 10,000 ตัวใช้ประมาณ 2.5 MB ส่วน `worker_connections` จำกัดจำนวน connection ของ worker หนึ่งตัว (ค่าตั้งต้น 512) นับรวม connection ไปหา upstream ด้วย และ open-file limit ของ process ก็จำกัดซ้ำอีกชั้น ถ้าตั้ง cache ไว้ ก็จะมี process cache loader และ cache manager รันด้วย

**Context** `nginx.conf` สร้างจาก directive แบบง่าย (`name value;`) และ directive แบบ block (`name { … }`) ที่ซ้อนกันเป็น context ตัว main context มี `worker_processes` กับ block `events` และ `http` ส่วน `http` มีกลุ่ม `upstream` และ block `server` หนึ่งตัวต่อ virtual server แล้ว `server` ก็มี block `location` ที่ซ้อนกันได้ directive ส่วนใหญ่สืบทอดมาจาก context ที่ครอบอยู่ ถ้า context ข้างในไม่ได้ตั้งเอง แต่บางตัวจะสืบทอดก็ต่อเมื่อชั้นข้างในไม่ได้ตั้ง directive ชนิดนั้นเลยสักตัว: `proxy_set_header` ตัวเดียวใน location ทำให้ `proxy_set_header` ทุกตัวที่ควรจะสืบทอดมาหายไปหมด

**server ไหน location ไหน** NGINX เลือก `server` จาก listening address และ port ก่อน แล้วค่อยดู header `Host` ถ้าไม่เจอก็ใช้ `default_server` ของ port นั้น ข้างใน server ตัว location จะถูกเลือกจาก request URI:

1. ถ้า match ตรงตัว (`location = /`) ก็จบการค้นหา
2. ไม่งั้นมันจะจำ prefix ที่ match ยาวที่สุดไว้ ถ้า prefix นั้นมี `^~` การค้นหาก็จบตรงนั้น
3. location แบบ regular expression (`~`, `~*`) ถูกลองตามลำดับที่เขียนไว้ และตัวแรกที่ match ชนะ
4. location แบบ predicate (`location $variable` มาใหม่ใน mainline 1.31.5) ถูกลองต่อจากนั้น
5. ถ้าไม่มีอะไร match เลย ก็ใช้ prefix ที่จำไว้

เพราะฉะนั้น `GET /api/products/42` จะไปลงที่ `location /api/products/` ไม่ใช่ `/api/`: prefix ทั้งสองตัว match แต่ตัวที่ยาวกว่าชนะ

**Load balancing** block `upstream` ตั้งชื่อให้กลุ่มของ server แล้ว `proxy_pass http://catalog` ก็ส่ง request ไปที่กลุ่มนั้น

| วิธี | เลือก server ยังไง | หมายเหตุ |
|---|---|---|
| weighted round robin | วนไปตามลำดับ ตาม `weight` | ค่าตั้งต้น |
| `least_conn` | active connection น้อยที่สุด ถ่วงด้วย weight | เหมาะกับ request ที่ยาวไม่เท่ากัน |
| `ip_hash` | hash ของ address ของ client (สาม octet แรกของ IPv4) | client ได้ server ตัวเดิมตลอด |
| `hash key [consistent]` | hash ของ key อะไรก็ได้ เช่น `$request_uri` | `consistent` (ketama) map key ใหม่แค่ไม่กี่ตัวตอนเพิ่มหรือเอา server ออก |
| `random [two [least_conn]]` | สุ่มตาม weight โดย `two` สุ่มมาสองตัวแล้วเอาตัวที่ว่างกว่า | ตั้งแต่ 1.15.1 |
| `least_time` | response time เฉลี่ยต่ำที่สุดและ active connection น้อยที่สุด | เป็น open source ตั้งแต่ mainline 1.31.0 ก่อนหน้านั้นมีแค่ใน NGINX Plus |

session affinity (directive `sticky` กับวิธี cookie, route และ learn ของมัน บวก parameter `route` และ `drain` ของ server) ย้ายจาก NGINX Plus มาเป็น open source ใน 1.29.6 ทำให้ 1.30 มีฟีเจอร์นี้

**Passive health check และ retry** NGINX แบบ open source รู้ว่า server พังจาก traffic จริง ถ้าตั้ง `max_fails=3 fail_timeout=10s` การพยายามที่ fail สามครั้งภายใน 10 วินาทีจะทำให้ server ใช้ไม่ได้ไปอีก 10 วินาที (ค่าตั้งต้นคือ 1 และ 10 s) ตัว `proxy_next_upstream` กำหนดทั้งว่าอะไรนับเป็น failure และเมื่อไรจะลอง server ถัดไป โดย connection error, timeout และ response ที่ไม่ถูกต้องนับเสมอ ส่วน 500, 502, 503, 504 และ 429 นับก็ต่อเมื่อ list ไว้ แล้ว 403 กับ 404 ไม่นับเลย ค่าตั้งต้นคือ request จะถูกส่งต่อไป server ถัดไปหลังเจอ error หรือ timeout แต่ก็ต่อเมื่อยังไม่ได้ส่งอะไรให้ client เลย และตั้งแต่ 1.9.13 ตัว POST, LOCK หรือ PATCH ที่ไปถึง upstream แล้วจะไม่ถูกส่งซ้ำ เว้นแต่จะเพิ่ม `non_idempotent` ส่วน `proxy_next_upstream_tries` และ `proxy_next_upstream_timeout` จำกัดจำนวน retry ส่วนกลุ่มที่มี server ตัวเดียวจะไม่ mark ตัวนั้นว่าใช้ไม่ได้เลย

**Keep-alive ไปหา upstream** ตั้งแต่ 1.29.7 (เลยรวมถึง 1.30) แต่ละ worker เก็บ idle connection ไว้ได้ถึง 32 ตัวต่อกลุ่ม upstream เป็นค่าตั้งต้น (`keepalive 32 local`) และคุยกับมันด้วย HTTP/1.1 (`proxy_http_version 1.1`) ก่อนหน้านั้นต้องตั้งทั้งสองอย่างเองและล้าง header `Connection` เอง การใช้ connection ซ้ำประหยัด TCP handshake ไปได้ทุก request และประหยัด TLS handshake ด้วยถ้า upstream เป็น HTTPS ส่วนตั้งแต่ 1.29.4 ตัว proxy module ก็คุย HTTP/2 กับ upstream ได้ด้วย ค่าตั้งต้น (`proxy_buffering on`) คือ NGINX อ่าน response ของ upstream ลง buffer เร็วเท่าที่มันส่งมา และถ้าจำเป็นก็ล้นไปลงไฟล์ชั่วคราว ทำให้ app server ว่างอีกครั้ง ระหว่างที่ client ที่ช้ายังดาวน์โหลดอยู่

**TLS, HTTP/2 และ HTTP/3** `listen 443 ssl` พร้อม `ssl_certificate` และ `ssl_certificate_key` ทำให้ NGINX เป็นปลายทางของ TLS: app server จะเห็น HTTP ธรรมดา หรือเห็น TLS connection ใหม่ถ้า `proxy_pass https://…` เข้ารหัสซ้ำ ตั้งแต่ 1.27.3 มีแค่ TLS 1.2 และ 1.3 ที่เปิดเป็นค่าตั้งต้น ส่วน HTTP/2 เปิดทีละ server ด้วย `http2 on;` (ตั้งแต่ 1.25.1 โดย parameter `http2` ของ `listen` ถูก deprecate แล้ว) ส่วน HTTP/3 บน QUIC มีให้ใช้ตั้งแต่ 1.25.0 ด้วย `listen 443 quic reuseport` แต่ nginx.org ยังเรียก `ngx_http_v3_module` ว่า experimental อยู่ มันไม่ถูก build มาเป็นค่าตั้งต้นตอน build จาก source (`--with-http_v3_module`) แต่ Linux package ของ nginx.org มีมันมาด้วย และแนะนำให้ใช้ OpenSSL 3.5.1 ขึ้นไป (OpenSSL รุ่นเก่ากว่าจะไปใช้ compatibility layer ที่ไม่มี 0-RTT) ส่วน `ssl_verify_client` ขอ certificate จาก client สำหรับ [mutual TLS](../mutual-tls/) แล้ว module `ngx_http_acme_module` ที่แยกออกมา ([nginx/nginx-acme](https://github.com/nginx/nginx-acme)) ก็ขอและต่ออายุ certificate ผ่าน ACME

**Proxy caching** `proxy_cache_path` ประกาศ cache หนึ่งตัว โดย response ถูกเก็บเป็นไฟล์บน disk ตั้งชื่อด้วย MD5 ของ cache key ส่วน key และ metadata ของมันอยู่ใน shared memory zone ที่ทุก worker อ่านได้ (ประมาณ 8,000 key ต่อ megabyte) ตัว `proxy_cache` เปิด cache ให้ location หนึ่ง และ `proxy_cache_valid 200 60s` เก็บ response ที่สำเร็จไว้ 60 วินาที key ตั้งต้นคือ `$scheme$proxy_host$request_uri` และจะ cache แค่ response ของ GET กับ HEAD เว้นแต่ `proxy_cache_methods` จะบอกเป็นอย่างอื่น ส่วน upstream ตั้งอายุเองได้ด้วย `X-Accel-Expires`, `Expires` หรือ `Cache-Control` และค่าเหล่านี้มาก่อน `proxy_cache_valid` ส่วน response ที่มี `Set-Cookie` จะไม่ถูก cache และ `Vary` จะแยก entry ตาม request header ตัว `$upstream_cache_status` รายงานเป็น MISS, BYPASS, EXPIRED, STALE, UPDATING, REVALIDATED หรือ HIT ส่วน `proxy_cache_lock on` ให้ request ตัวเดียวไปเติม entry ที่ขาด ระหว่างที่ตัวอื่นรอ แล้ว `proxy_cache_use_stale error timeout updating` ก็เสิร์ฟ copy เก่า ระหว่างที่ upstream ล่มหรือกำลังถูกขอของใหม่

**Rate limit และ connection limit** `limit_req_zone $binary_remote_addr zone=perip:10m rate=10r/s` เก็บ state หนึ่งตัวต่อ address ของ client ไว้ใน shared memory โดย state หนึ่งตัวใช้ 128 byte บน platform 64-bit ทำให้หนึ่ง megabyte เก็บได้ประมาณ 8,000 address ส่วน `limit_req zone=perip burst=20` ให้ request ที่เกิน 10 ต่อวินาทีรอใน queue ได้ถึง 20 ตัว แล้วปล่อยออกตาม rate ที่ตั้งไว้ (module เรียกแบบนี้ว่า leaky bucket) ถ้าเกินจากนั้น request จะโดนปฏิเสธด้วย 503 หรือด้วย status ที่ตั้งใน `limit_req_status` ในที่นี้คือ 429 ตัว `nodelay` เสิร์ฟ burst ทันทีแทนการเว้นระยะ ส่วน `delay=` ผสมสองแบบ แล้ว `limit_req_dry_run on` ก็แค่นับ ส่วน `limit_conn` จำกัด connection ที่เปิดพร้อมกันต่อ key ในแบบเดียวกัน แต่ละ zone เป็นของ NGINX instance เดียว: สอง instance นับแยกกัน และการ sync zone ข้าม cluster (`sync`) เป็นฟีเจอร์ของ NGINX Plus

**Static file และการบีบอัด** `root /var/www` map `/static/app.js` ไปที่ `/var/www/static/app.js` ส่วน `alias` แทนที่ prefix ของ location แทน แล้ว `try_files` ก็ลอง path ตาม list ก่อนจะ fall back ตัว `sendfile on` (ปิดเป็นค่าตั้งต้น) ให้ kernel copy ไฟล์ไปที่ socket เอง การบีบอัดปิดอยู่จนกว่าจะตั้ง `gzip on` และ `gzip_types` มีแค่ `text/html` เป็นค่าตั้งต้น เพราะฉะนั้นให้เพิ่ม JSON, CSS และ JavaScript เอง ส่วน `gzip_static` เสิร์ฟไฟล์ที่บีบอัดไว้ตั้งแต่ตอน build

**WebSocket** `Upgrade` และ `Connection` เป็น header แบบ hop-by-hop ทำให้ location ที่ proxy WebSocket ต้องส่งต่อมันเองอย่างชัดเจน (`proxy_set_header Upgrade $http_upgrade;` และ `proxy_set_header Connection "upgrade";`) พอ upstream ตอบ 101 ตัว NGINX ก็เปลี่ยน request เป็น tunnel สองทาง แบบนี้ใช้ได้มาตั้งแต่ 1.3.13

**Health check: open source กับ NGINX Plus** open source มี passive check ข้างบน ที่ต้องอาศัย request จริงถึงจะเห็นว่าพัง ส่วน NGINX Plus เพิ่ม active check (`health_check` ค่าตั้งต้นทุก 5 วินาที), การค่อย ๆ เพิ่ม traffic แบบ `slow_start` ให้ server ที่เพิ่งฟื้น, API ที่เพิ่มและเอา upstream server ออกได้โดยไม่ต้อง reload และ status dashboard แต่ open source ก็มี `stub_status` สำหรับตัวนับพื้นฐาน (connection ที่ active, reading, writing และ waiting, connection ที่ accept และ handle แล้ว และจำนวน request)

**Reload และ binary upgrade** `nginx -s reload` ส่ง HUP ไปที่ master แล้ว master ก็เช็ก config ใหม่ และเปิด log file กับ listening socket ตัวใหม่ ๆ ถ้าพังมันก็รัน config เก่าต่อไป ถ้าผ่าน มันจะเริ่ม worker ชุดใหม่ด้วย config ใหม่ และขอให้ worker ชุดเก่าปิดตัวอย่างนุ่มนวล: ปิด listening socket ทำ request ที่ถืออยู่ให้เสร็จ แล้ว exit ส่วน connection ที่อยู่ยาวอย่าง WebSocket จะทำให้ worker เก่ายังอยู่จนกว่า connection จะจบ เว้นแต่ `worker_shutdown_timeout` จะปิดมัน การเปลี่ยนตัว binary เองก็ทำแบบเดียวกัน: USR2 เริ่ม master ตัวใหม่ด้วย executable ใหม่ไว้ข้าง ๆ ตัวเก่า ส่วน WINCH บอก worker เก่าให้ทำงานให้เสร็จ แล้ว QUIT ก็ปลด master เก่าเมื่อไว้ใจตัวใหม่ได้แล้ว ส่วน mainline 1.31.5 เพิ่ม Control API คือ REST interface ใน master (build ด้วย `--with-control-api` และเริ่มด้วย `nginx -l unix:/path/to.sock`) ที่ list worker process, คืน config ที่โหลดอยู่ และสั่ง reload ได้ แต่ไม่ได้เปลี่ยน upstream

**ใน Kubernetes** มีสองโปรเจกต์ที่ใช้ชื่อนี้ ตัว controller **ingress-nginx** ของ community ที่ดูแลภายใต้ Kubernetes SIG Network ถูกปลดระวางแล้ว: การดูแลจบในเดือนมีนาคม 2026 repository ถูก archive วันที่ 24 มีนาคม 2026 และจะไม่มี release หรือ security fix อีก ตัวที่ติดตั้งอยู่แล้วก็ยังรันต่อไปได้ และ Kubernetes SIG Network แนะนำให้ย้ายไป Gateway API หรือ ingress controller ตัวอื่น ส่วน **F5 NGINX Ingress Controller** (nginx/kubernetes-ingress, Apache 2.0) เป็น controller แยกที่ F5 ทำ โดยรัน NGINX Open Source หรือ NGINX Plus และ **NGINX Gateway Fabric** implement Gateway API โดยใช้ NGINX เป็น data plane

**License และ fork** NGINX Open Source ใช้ license แบบ 2-clause BSD และ source อยู่บน GitHub (nginx/nginx) ส่วน NGINX Plus เป็นเชิงพาณิชย์ แล้ว freenginx ก็เป็น fork ที่บอกว่าตัวเองพยายามรักษาให้การพัฒนา nginx เป็นอิสระและเปิด ภายใต้ license สไตล์ BSD แบบเดียวกัน

## อยู่ตรงไหนใน solution

- **Solution:** ประตูหน้าของเว็บและ API (TLS, static file, proxy ไปหา app server), origin cache หลัง CDN, internal load balancer ระหว่าง tier, reverse proxy หน้า PHP-FPM, uWSGI หรือ gRPC service และ data plane ของ Kubernetes ingress และ Gateway API controller
- **Pattern ใน catalog นี้ที่มัน implement หรือช่วยรองรับ:** [Load Balancing](../load-balancing/) ด้วยกลุ่ม `upstream` และ passive check, [Gateway Offloading](../gateway-offloading/) ของ TLS การบีบอัด และ caching, [Rate Limiting](../rate-limiting/) ด้วย `limit_req` และ `limit_conn`, tier ฝั่ง origin ของ [CDN & Edge Caching](../cdn-edge-caching/) หรือ cache tier เล็ก ๆ ที่รันเอง, [Mutual TLS](../mutual-tls/) ด้วย `ssl_verify_client`, [Health Endpoint Monitoring](../health-endpoint-monitoring/) แบบ passive ใน open source และแบบ active probe ไปที่ health URL ใน NGINX Plus, [Blue-Green Deployment](../blue-green-deployment/) และ [Canary Release](../canary-release/) ด้วยการสลับหรือถ่วงน้ำหนัก upstream server แล้ว reload และการย้ายระบบแบบ [Strangler Fig](../strangler-fig/) ที่ route ทีละ path ไปหาระบบใหม่ มันทำหน้าที่เป็น [API Gateway](../api-gateway/) แบบง่าย ๆ สำหรับ routing และ limit ได้ ส่วนใน [Kubernetes](../kubernetes/) บทบาทนี้เป็นของ ingress หรือ Gateway API controller
- **เพื่อนบ้านที่มักเจอ:** browser, แอปมือถือ และ CDN อยู่ด้านหน้า หลายครั้งมี network load balancer ของ cloud อยู่หน้า NGINX สองตัวขึ้นไปเพื่อ availability ส่วนด้านหลังคือ app server, PHP-FPM และ gRPC service มี certificate จาก ACME CA หรือ secrets store มี access log ที่ส่งเข้า log pipeline และมีการ scrape `stub_status` เอา metric
- **Managed offering:** AWS ไม่ได้รัน NGINX เป็น managed service ของตัวเอง เราต้องรันเองบน EC2, ECS หรือ EKS หรือซื้อ NGINX Plus เป็น AMI ผ่าน AWS Marketplace ส่วน managed service ของ AWS ที่ทำงานเดียวกันคือ **Application Load Balancer** (routing ระดับ layer 7, health check, TLS ที่ใช้ certificate จาก AWS Certificate Manager), **CloudFront** (caching ที่ edge), rate-based rule ของ **AWS WAF** (rate limiting) และ **Amazon API Gateway** (throttling และ API management) บน Azure มี **F5 NGINXaaS for Azure** เป็น managed service ที่สร้างบน NGINX เชิงพาณิชย์ของ F5

## ใช้ตอนไหนดี

ใช้ NGINX เมื่ออยากให้ process เดียวทำงานฝั่ง edge ให้เว็บหรือ API ที่เรารันเอง: TLS, static file, caching, rate limit และ load balancing ไปที่ชุด server ที่คงที่หรือเปลี่ยนช้า ๆ ให้เลือกตัวอื่นเมื่อ upstream เปลี่ยนทุกนาทีและต้องการ API แทนการ reload เมื่ออยากได้ active health check โดยไม่ต้องจ่ายค่า NGINX Plus หรือเมื่อไม่อยากรัน edge เองเลย

| | NGINX Open Source | HAProxy | Envoy | Caddy, Traefik | AWS ALB |
|---|---|---|---|---|---|
| มันคืออะไร | web server, reverse proxy, load balancer และ cache | reverse proxy และ load balancer สำหรับ TCP และ HTTP | proxy ระดับ layer 7 ที่ออกแบบมาสำหรับระบบ service-oriented ขนาดใหญ่และ service mesh | Caddy: web server ส่วน Traefik: reverse proxy ที่ตั้งค่าตัวเองได้ | load balancer ระดับ layer 7 แบบ managed |
| เปลี่ยน upstream ยังไง | แก้ไฟล์แล้ว reload, ใช้ DNS ด้วย `resolve`, มี API ใน NGINX Plus | runtime API เพิ่มและเอา server ออกได้ และตั้งแต่ 3.4 ทำกับ backend ทั้งตัวได้ด้วย โดยไม่ต้อง reload | dynamic discovery API (xDS) จาก control plane | Caddy: JSON admin API ส่วน Traefik: ตาม [Docker](../docker/), Kubernetes และ provider อื่น | API หรือ console โดย target ถูกลงทะเบียนด้วย Auto Scaling หรือ ECS |
| Health check | passive (active ใน NGINX Plus) | active check | active check บวก outlier detection | active และ passive (Caddy) | active ต่อ target group |
| Response cache | มีในตัว บน disk | cache เล็ก ๆ | cache filter | — | ไม่มี (ใช้ CloudFront ข้างหน้า) |
| Certificate | ไฟล์ หรือ ACME module | ไฟล์ และ ACME ตั้งแต่ 3.2 | ไฟล์ หรือ control plane push มาให้ | HTTPS อัตโนมัติผ่าน ACME | AWS Certificate Manager |
| License | 2-clause BSD | GPLv2, header เป็น LGPL | Apache 2.0 | Apache 2.0 (Caddy), MIT (Traefik) | เป็น managed service |
| เลือกเมื่อ | อยากได้ process เดียวสำหรับ TLS, ไฟล์, caching และ proxy | load balancing คืองานทั้งหมด และอยากได้การเปลี่ยนตอน runtime กับ active check ในแบบ open source | รัน service เยอะ อยากได้ config แบบ dynamic และ telemetry ละเอียด มักใช้คู่กับ mesh | เว็บเล็ก ๆ ที่ควรได้ certificate เอง หรือ container ที่มา ๆ ไป ๆ | อยู่บน AWS และอยากให้เป็น managed พร้อม AWS WAF และ ACM |

## ได้อะไร เสียอะไร

- **config เป็นแบบ static** การเปลี่ยนต้องผ่านไฟล์และการ reload การ reload ไม่ทำ request หลุด แต่ถ้า reload บ่อย worker เก่าจะค้างอยู่ระหว่างที่ connection ยาว ๆ ค่อย ๆ หมดไป และทุกการเปลี่ยนต้องมีขั้น deploy การ resolve DNS ใหม่ (`resolve`) ครอบคลุม server ที่อยู่หลังชื่อที่เปลี่ยนได้ ส่วน API สำหรับเปลี่ยน upstream แบบสด ๆ เป็นฟีเจอร์ของ NGINX Plus
- **health check ของ open source เป็นแบบ passive** ความพังจะถูกเห็นโดย request จริง (ที่จะ retry ไป server อื่นถ้าปลอดภัย) และ server ที่ถูก mark ว่า down จะถูกลองอีกครั้งด้วย traffic จริงเมื่อพ้น `fail_timeout` ส่วน active check, slow start และ status API อยู่ใน NGINX Plus
- **state แยกต่อ instance** cache, rate-limit zone และตัวนับ failure อยู่ใน NGINX ตัวเดียว ถ้ามีสอง instance แต่ละตัวจะยอมให้ 10 r/s ต่อ client และแต่ละตัวก็ต้อง warm cache ของตัวเอง
- **ภาษา config มีมุมคม ๆ** ลำดับการ match location, directive ที่สืบทอดก็ต่อเมื่อชั้นข้างในไม่ได้ตั้งเลยสักตัว และความต่างระหว่าง `root` กับ `alias` ทำให้เจอเรื่องไม่คาดคิดใน production บ่อย ให้ test ด้วย `nginx -t` และเก็บ config ไว้ใน version control
- **instance เดียวคือ single point of failure** รันอย่างน้อยสองตัว หลัง load balancer ของ cloud หรือ floating IP
- **ไม่ใช่ API gateway เต็มตัว** quota ต่อ key, การแปลง request, developer portal และ authorization แบบละเอียดต้องใช้ module, njs script หรือ gateway โดยเฉพาะ ส่วน gateway ที่สร้างบน Envoy เปลี่ยน route ผ่าน API

## ข้อควรรู้ตอนลงมือทำ

config ของ scenario นี้ (เช็กด้วย `nginx -t` บน nginx 1.30.5):

```nginx
# /etc/nginx/nginx.conf for shop.example (nginx 1.30 stable)
worker_processes auto;                 # one worker per CPU core; the default is 1

events {
    worker_connections 4096;           # per worker, upstream connections included; default 512
}

http {
    sendfile on;                       # static files go from disk to socket in the kernel

    limit_req_zone $binary_remote_addr zone=perip:10m rate=10r/s;
    proxy_cache_path /var/cache/nginx/api keys_zone=api_cache:10m
                     max_size=1g inactive=10m;

    upstream catalog {
        least_conn;
        server app-1:8080 max_fails=3 fail_timeout=10s;
        server app-2:8080 max_fails=3 fail_timeout=10s;
        server app-3:8080 max_fails=3 fail_timeout=10s;
        # keepalive 32 local;  is the default since 1.29.7
    }

    server {
        listen 80;
        server_name shop.example;
        return 301 https://$host$request_uri;
    }

    server {
        listen 443 ssl;
        http2 on;
        server_name shop.example;
        ssl_certificate     /etc/nginx/tls/shop.example.crt;
        ssl_certificate_key /etc/nginx/tls/shop.example.key;

        location /static/ {
            root /var/www;             # /static/app.js is /var/www/static/app.js
        }

        location /api/ {
            limit_req zone=perip burst=20;   # past 10 r/s, up to 20 wait
            limit_req_status 429;            # the default is 503
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_pass http://catalog;

            location /api/products/ {        # longest prefix wins
                proxy_cache api_cache;
                proxy_cache_valid 200 60s;
                add_header X-Cache-Status $upstream_cache_status;
                proxy_pass http://catalog;
            }
        }
    }
}
```

`location /api/products/` ที่ซ้อนอยู่สืบทอด rate limit และบรรทัด `proxy_set_header` มาจาก `/api/` แต่ต้องมี `proxy_pass` ของตัวเอง ถ้าไม่มี `proxy_set_header Host $host` ตัว app server จะเห็น `Host: catalog` (ชื่อของกลุ่ม upstream) ส่วน host name ของ upstream อย่าง `app-1` จะถูก resolve แค่ครั้งเดียวตอนโหลด config เว้นแต่กลุ่มนั้นจะมี `zone` มีการตั้ง `resolver` และ server มี `resolve`

- **test แล้วค่อย reload** `nginx -t` เช็ก syntax และไฟล์โดยไม่ไปแตะ server ที่รันอยู่ แล้ว `nginx -s reload` ก็ apply การเปลี่ยน ถ้า reload พัง config เก่าจะยังรันอยู่ เพราะฉะนั้นให้เช็ก error log หลัง reload ทุกครั้ง
- **หา address จริงของ client** ถ้าอยู่หลัง load balancer ของ cloud ทุก connection จะมาจากตัว balancer ทำให้ `$binary_remote_addr` จะเอาทุก client ไปไว้ใน rate-limit bucket เดียวกัน ตัว realip module (`set_real_ip_from` พร้อม address ของ balancer บวก `real_ip_header X-Forwarded-For` หรือ PROXY protocol) คืน address ของ client ให้
- **log ฝั่ง upstream ด้วย** เพิ่ม `$upstream_addr`, `$upstream_status`, `$upstream_response_time` และ `$upstream_cache_status` ลงใน `log_format`: มันบอกได้ว่า server ไหนตอบ ใช้เวลาเท่าไร ความพยายามครั้งไหนพังก่อน retry และ cache ช่วยหรือเปล่า
- **กำหนดขนาด limit** `worker_connections` คูณจำนวน worker คือเพดานของ connection ที่เปิดได้ และ request ที่ proxy แต่ละตัวใช้สอง connection (client และ upstream) ให้เพิ่ม open-file limit (`worker_rlimit_nofile`) ตามไปด้วย
- **เผื่อ connection ที่อยู่ยาว** WebSocket และ streaming response ทำให้ worker เก่ายังอยู่หลัง reload ส่วนถ้า reload บ่อยให้ตั้ง `worker_shutdown_timeout`
- **patch ให้ทันอยู่เสมอ** NGINX parse input ที่ไว้ใจไม่ได้บน edge ของ internet และทั้งสอง branch ก็ออก security fix อยู่เรื่อย ๆ (ปี 2026 fix ไปหลาย CVE) ให้ตาม branch stable เว้นแต่จะต้องใช้ฟีเจอร์ของ mainline
