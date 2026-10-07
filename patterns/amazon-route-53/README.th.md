## ปัญหา

Acme Shop ขายของให้ลูกค้าทั่วเอเชียตะวันออกเฉียงใต้ หน้าร้าน `shop.example` เสิร์ฟผ่าน CloudFront distribution ส่วน API รันอยู่หลัง Application Load Balancer ในสอง Region คือ Asia Pacific (Thailand) `ap-southeast-7` และ Asia Pacific (Singapore) `ap-southeast-1` แล้วหน้า status ก็ต้องเข้าได้ตอนที่ API ล่ม และ API version ใหม่ควรได้ traffic ส่วนเล็ก ๆ ก่อนจะได้ทั้งหมด ส่วนใน VPC ตัวแอปต้องมีชื่อที่ไม่เปลี่ยนสำหรับ database คือ `db.acme.internal` ที่ internet ไม่มีวันเห็น

ทุกการเข้าเว็บแบบนี้เริ่มจาก DNS lookup เพราะฉะนั้น DNS เป็นตัวตัดสินว่า traffic จะไปที่ไหน ผู้ใช้ในเชียงใหม่ควรได้ load balancer ที่ Thailand และเมื่อ load balancer ตัวนั้นเลิกตอบ lookup ใหม่ ๆ ก็ควรได้ Singapore โดยไม่ต้องมีใครมาแก้ record ตอนกลางคืน ถ้ารัน authoritative DNS เอง ก็ต้องมีฝูง name server กระจายอยู่ทั่วโลกที่ทนทาน DDoS ต้องมี health check จากหลายที่ และต้องมีวิธีชี้ domain เปล่า `shop.example` ไปที่ CloudFront distribution ทั้งที่ DNS ห้ามใช้ CNAME ตรงนั้น Amazon Route 53 คือ DNS service แบบ managed ของ AWS: มัน host zone บน name server ของตัวเอง ตอบด้วยการตัดสินใจเรื่อง routing ตาม latency, weight, health และตำแหน่ง ตรวจ health ของ endpoint และยังตอบชื่อ private ภายใน VPC ด้วย

## ทำงานยังไง

### lookup หนึ่งครั้ง จาก resolver ถึงคำตอบ

มือถือไม่ได้ถาม Route 53 ตรง ๆ แต่ถาม **recursive resolver** ที่ส่วนใหญ่ ISP เป็นคนรัน หรือเป็นบริการ resolver สาธารณะ แล้ว resolver ก็ทำงานที่เหลือให้ ถ้า cache ว่าง มันจะเริ่มที่ root server ที่ส่งต่อไปหา server ของ top-level domain แล้ว server พวกนั้นก็ส่งต่อไปหา name server แบบ **authoritative** สี่ตัวที่อยู่ใน NS record ของ zone มีแค่ authoritative server พวกนี้ที่ถือคำตอบ จากนั้น resolver ก็ cache ทุกคำตอบไว้นานเท่าที่ **TTL** (time to live) บอก ทำให้ lookup ส่วนใหญ่ไม่เคยออกไปไกลกว่า resolver ส่วน guide ของ Route 53 ก็บอกว่าโดยทั่วไป resolver จะเก็บ name server ของ domain ไว้สองวัน แนวคิดพวกนี้มาจาก RFC 1034 และ RFC 1035 ที่เป็น spec หลักของ DNS ตั้งแต่ปี 1987

ใน diagram ตัว domain คือ `shop.example` ส่วน top-level domain `.example` ถูกจองไว้ใช้ในเอกสารตาม RFC 2606 ทำให้ใน lookup จริง ขั้นตรงกลางจะเป็น server ของ `.com`, `.co.th` หรือ TLD ไหนก็ตามที่ domain นั้นสังกัด

resolver ยัง cache คำตอบที่บอกว่าไม่มีชื่อนี้ (NXDOMAIN) หรือไม่มี record ประเภทที่ขอ (NODATA) ด้วย แล้ว RFC 2308 ก็กำหนดขอบเขตของ **negative caching** นี้ด้วย SOA record ของ zone และ Route 53 ระบุว่ามันคือค่าที่ต่ำกว่าระหว่าง TTL ของ SOA record เองกับ minimum TTL ที่อยู่ข้างใน ค่าตั้งต้นของ TTL ของ SOA record คือ 900 วินาที และ SOA ตัวอย่างใน guide มี minimum TTL 86,400 วินาที ทำให้ resolver จำว่า "ไม่มีชื่อนี้" ไว้ 15 นาที แล้ว record ที่เพิ่มเข้าไปหลังจากมีคน lookup ไปไม่นานก็เลยอาจใช้เวลานานขนาดนั้นกว่าคนคนนั้นจะเห็น

Route 53 ใช้ได้แค่ address ของ resolver ในการเดาว่าผู้ใช้อยู่ที่ไหน ยกเว้น resolver จะรองรับ extension EDNS Client Subnet (RFC 7871) และส่ง address ของผู้ใช้แบบย่อต่อมาให้ ถ้ามีค่านี้ Route 53 ก็จะใช้มันกับ routing แบบ latency, geolocation, geoproximity และ IP-based

### Hosted zone และ name server

**public hosted zone** เก็บ record ของ domain บน internet พอสร้าง zone ขึ้นมา Route 53 จะให้ name server สี่ตัวกับมัน แล้วเขียนลงใน NS record ของ zone พร้อมกับ SOA record ส่วนชื่อตัวอย่างใน guide อย่าง `ns-2048.awsdns-64.com`, `ns-2049.awsdns-65.net`, `ns-2050.awsdns-66.org` และ `ns-2051.awsdns-67.co.uk` ก็อยู่ใต้ top-level domain สี่ตัวที่ต่างกัน แล้ว zone จะเริ่มใช้งานได้ก็ต่อเมื่อ registrar ของ domain ใส่ server สี่ตัวนี้ไว้ นี่แหละคือขั้น delegation ที่ resolver เดินตาม ส่วน Route 53 เองเสิร์ฟ zone จากเครือข่าย **anycast** ทั่วโลก ทำให้ query ไปหาชื่อไหนในสี่ตัวก็ตาม จะได้คำตอบจาก location ของ Route 53 ที่เหมาะกับเครือข่ายของ resolver ที่สุด

**private hosted zone** ตอบเฉพาะใน VPC ที่ผูกกับมันไว้ (ได้ถึง 300 ตัวต่อ zone ถ้ามากกว่านั้นใช้ Route 53 Profiles) ตัว VPC ต้องตั้งทั้ง `enableDnsHostnames` และ `enableDnsSupport` เป็น true แล้ว instance หรือ task ข้างในก็จะถาม **VPC Resolver** ที่อยู่ตรง address ฐานของช่วง VPC บวกสอง คือ `10.0.0.2` สำหรับ `10.0.0.0/16` ของ Acme Shop (ดู [Amazon VPC](../amazon-vpc/)) ส่วน private zone ของ Acme Shop คือ `acme.internal` โดย ICANN จอง top-level domain `.internal` ไว้ใช้แบบ private ตั้งแต่กรกฎาคม 2024 ทำให้มันไม่มีวันชนกับชื่อ public ตัว record `db.acme.internal` ของมันเป็น CNAME ไปหาชื่อ endpoint ของ database บน [RDS](../amazon-rds-aurora/) ทำให้โค้ดและ configuration ใช้ชื่อเดียวที่ยังใช้ได้แม้จะเปลี่ยน database ใหม่ ส่วน query ไปหา private zone ไม่เสียเงิน

public zone กับ private zone ใช้ชื่อเดียวกันได้ ทำให้เกิด **split-view DNS**: ผู้ใช้ใน VPC เห็นคำตอบแบบ private ส่วนคนอื่นเห็นแบบ public ตัว VPC Resolver ใช้ zone ที่ match ได้เจาะจงที่สุด แต่ถ้า private zone match ชื่อนั้นแต่ไม่มี record ประเภทที่ขอ ตัว resolver จะตอบ NXDOMAIN และไม่ถอยไปถาม public zone เรื่องนี้ทำให้คนแปลกใจบ่อยเวลาที่ private zone บังบางส่วนของ public domain ไว้

### Record, alias และ zone apex

Route 53 รองรับ record type ที่ใช้กันทั่วไป เช่น A และ AAAA (address), CNAME (ชื่ออื่น), MX (mail server), TXT (ข้อความอิสระ เช่นใช้ยืนยัน domain), CAA (certificate authority ไหนออก certificate ให้ domain ได้บ้าง), NS, SOA, SRV, PTR, DS, HTTPS, SVCB, SSHFP และ TLSA

CNAME อยู่ที่ **zone apex** (ตัว `shop.example` เอง) ไม่ได้ เพราะ RFC 1034 บอกว่าชื่อที่มี CNAME ไม่ควรมีข้อมูลอื่น แต่ apex ต้องมี SOA และ NS record ของ zone เลยตัดวิธีที่คิดออกก่อนสำหรับชี้ domain เปล่าไปที่ CloudFront distribution หรือ load balancer ที่ address เปลี่ยนไปเรื่อย ๆ ทิ้งไป

คำตอบของ Route 53 คือ **alias record** ที่เป็น extension ของมันเอง alias มี type ธรรมดา (A หรือ AAAA) และชี้ไปที่ AWS resource หรือ record อื่นใน zone เดียวกัน Route 53 resolve target เองแล้วตอบด้วย address ปัจจุบันของมัน ทำให้ client เห็นแค่ A record ธรรมดา ส่วน target ของ alias มีทั้ง CloudFront distribution, load balancer ของ Elastic Load Balancing, S3 bucket ที่ตั้งเป็น static website, API ของ API Gateway, VPC interface endpoint, accelerator ของ Global Accelerator, environment ของ Elastic Beanstalk, service ของ App Runner, domain ของ AppSync, custom domain ของ [OpenSearch](../elasticsearch/) Service และ service ของ VPC Lattice คุณสมบัติสามข้อทำให้ alias เป็นตัวเลือกหลักสำหรับ target บน AWS:

- **ใช้ที่ apex ได้** `shop.example` เป็น alias A record ไปหา distribution
- **query ไปหา target บน AWS ไม่เสียเงิน** Route 53 ไม่คิดเงินกับ alias query ที่ target เป็น AWS resource ตัวที่รองรับ รวมถึง alias ที่ต่อกันเป็นทอด ๆ แล้วไปจบที่ resource แบบนั้น ส่วน CNAME ที่ชี้ไปหา Route 53 record อื่นจะโดนคิดเป็นสอง query
- **TTL เป็นของ target** เราตั้ง TTL ให้ alias ที่ชี้ไปหา AWS resource ไม่ได้ Route 53 จะใช้ค่าตั้งต้นของ resource นั้น ที่ Elastic Load Balancing ระบุไว้ว่า 60 วินาที ส่วน alias ที่ชี้ไปหา record อื่นใน zone จะใช้ TTL ของ record นั้น

alias ยังรับ health ของ target มาใช้ได้ด้วย **Evaluate Target Health** ส่วนถ้าเป็น Application หรือ Network Load Balancer ตัว load balancer จะนับว่า healthy ก็ต่อเมื่อทุก target group ที่มี target มี target ที่ healthy อย่างน้อยหนึ่งตัว และ target group ที่ไม่มี target เลยจะนับว่า unhealthy ตัวเลือกนี้ใช้กับ CloudFront distribution ไม่ได้

### Routing policy

ทุก record มี routing policy ได้แบบเดียว และทุก record ที่มีชื่อและ type เดียวกันต้องใช้ policy เดียวกัน: สร้าง latency record ไว้ข้าง ๆ weighted record ของชื่อเดียวกันไม่ได้

| Policy | Route 53 ตอบด้วย | ใน private zone | Acme Shop ใช้กับ |
|---|---|---|---|
| Simple | ค่าเดียวหรือหลายค่าของ record | ได้ | `shop.example` (alias ไปหา CloudFront) |
| Weighted | record หนึ่งตัว ที่เลือกด้วยความน่าจะเป็นเท่ากับ weight ของมัน (0 ถึง 255) หารด้วยผลรวมของ weight | ได้ | `api`: 90 ไปที่ `stable.api` และ 10 ไปที่ canary ALB |
| Latency | record ใน AWS Region ที่ latency ต่ำที่สุดสำหรับเครือข่ายของผู้ใช้ จากการวัดของ AWS เองที่เปลี่ยนไปตามเวลา | ได้ | `stable.api`: Thailand หรือ Singapore |
| Failover | primary record ระหว่างที่มันยัง healthy ไม่อย่างนั้นก็ secondary | ได้ | `status`: Thailand ALB แล้วถัดไปเป็นหน้า static ใน S3 |
| Geolocation | record ของทวีป ประเทศ หรือรัฐในสหรัฐฯ ของผู้ใช้ ตัวที่ match เจาะจงที่สุดชนะ และ default record รับ address ที่ไม่รู้ตำแหน่ง | ได้ | |
| Geoproximity | resource ที่ใกล้ที่สุดตามระยะทาง ตั้งเป็น AWS Region, Local Zone group หรือ latitude และ longitude โดยมี bias ตั้งแต่ −99 ถึง 99 ที่ย่อหรือขยายพื้นที่ของมัน | ได้ | |
| IP-based | record ที่ map ไว้กับ CIDR block ที่ query มาจาก โดยใช้ CIDR collection ที่เรา upload (IPv4 prefix /1 ถึง /24, IPv6 /1 ถึง /48) | ไม่ได้ | |
| Multivalue answer | record ที่ healthy ได้ถึงแปดตัว แบบสุ่มคร่าว ๆ เป็นการกระจายง่าย ๆ ที่ไม่ได้มาแทน load balancer | ได้ | |

policy ใช้ร่วมกันได้ผ่าน alias ตัว `api.shop.example` มี weighted alias record สองตัว: weight 90 ชี้ไปที่ `stable.api.shop.example` และ weight 10 ชี้ไปที่ ALB `api-v2` ที่รัน version ใหม่ ส่วน `stable.api` มี latency alias record สองตัว Region ละตัว แต่ละตัวชี้ไปที่ ALB ของ Region นั้น ส่วน weight 0 ทำให้ record นั้นไม่ได้ traffic แต่ถ้าทุก record ในกลุ่มมี weight 0 หมด Route 53 จะเลือกจากพวกมันด้วยความน่าจะเป็นเท่า ๆ กัน กลุ่มของ record แบบ weighted, latency, geolocation, multivalue หรือ IP-based มี record ที่ชื่อและ type เดียวกันได้ถึง 100 ตัว ส่วนกลุ่ม geoproximity ได้ถึง 30 ตัว

### Health check

health check ของ Route 53 มีสามแบบ:

- **Endpoint check** ส่ง request แบบ HTTP, HTTPS หรือ TCP ไปที่ IP address หรือ domain name สำหรับ HTTP และ HTTPS ตัว checker ต้องเปิด TCP connection ได้ภายใน 4 วินาที แล้วได้ status code ตั้งแต่ 200 ถึง 399 ภายใน 2 วินาที โดยที่ HTTPS check ไม่ได้ validate certificate ส่วนถ้าใช้ string matching ข้อความนั้นต้องอยู่ใน 5,120 byte แรกของ body
- **Calculated check** รวม health check อื่นได้ถึง 255 ตัว เช่น "healthy ถ้ามีอย่างน้อยสองในสาม Region ที่ healthy"
- **[CloudWatch](../amazon-cloudwatch/) alarm check** ตามดู data stream ของ CloudWatch alarm ใน account เดียวกัน นี่คือวิธีครอบคลุม resource ที่ checker เข้าไม่ถึง ส่วน `InsufficientDataHealthStatus` ใช้กำหนดว่าจะเกิดอะไรขึ้นเมื่อ alarm ไม่มีข้อมูล

สำหรับ endpoint check เราเลือก `RequestInterval` ได้ คือ 30 วินาทีที่เป็นค่าตั้งต้น หรือ 10 วินาที ("fast" มีค่าใช้จ่ายเพิ่ม และเปลี่ยนไม่ได้หลังสร้าง check แล้ว) และเลือก `FailureThreshold` ได้ตั้งแต่ 1 ถึง 10 ผลติดกัน (ค่าตั้งต้น 3) ที่จะพลิก status แล้วตัว checker ก็รันอยู่ในแปด AWS Region: `us-east-1`, `us-west-1`, `us-west-2`, `eu-west-1`, `ap-southeast-1`, `ap-southeast-2`, `ap-northeast-1` และ `sa-east-1` เราจำกัดให้ check ใช้แค่บาง Region ได้ แต่ต้องอย่างน้อยสาม Region ส่วน checker เองก็ไม่ได้ประสานงานกัน ทำให้ที่ interval 30 วินาที endpoint จะโดน request เฉลี่ยประมาณทุกสองวินาที บางทีก็มาหลายตัวพร้อมกัน Route 53 รวมรายงานจาก checker ทั้งหมด แล้วถือว่า endpoint healthy ตราบที่ checker มากกว่า 18% ยังเห็นว่ามัน healthy ทำให้ปัญหาเครือข่ายระหว่าง endpoint กับ location ที่ check แค่ที่เดียวไม่ทำให้มันพัง ส่วน health check ที่สร้างใหม่จะนับว่า healthy จนกว่าจะมีข้อมูลมาพอ

checker อยู่บน internet นอก VPC ของเรา: มัน check ไม่ได้กับ address ในช่วง private, local หรือช่วงอื่นที่ route ไม่ได้ ส่วนถ้าจะ fail over record ใน private zone เช่น primary database กับ standby database ที่อยู่หลัง `db.acme.internal` ให้ใช้ health check ที่อิงกับ CloudWatch alarm แทน ส่วนถ้า endpoint ยอมให้เข้าแค่ address ที่รู้จัก ช่วง address ของ checker ก็มีประกาศไว้ใน `ip-ranges.json` ใต้ `ROUTE53_HEALTHCHECKS`

ตอน Route 53 ตอบ query มันไม่ได้รัน health check แต่จะดู status ที่ checker คอยอัปเดตไว้ สำหรับแต่ละ record ที่มันจะส่งกลับไป มันถามว่า: health check ที่ผูกไว้ healthy ไหม หรือถ้าเป็น alias ที่เปิด Evaluate Target Health ไว้ ตัว target healthy ไหม ถ้าไม่ มันจะเลือกใหม่ด้วย policy เดิมจาก record ที่เหลือ สำหรับ latency record นั่นก็คือ record ที่ latency ต่ำรองลงมา แบบนี้เองที่ lookup ของ `stable.api` ย้ายจาก Thailand ไปที่ Singapore มีกฎอีกไม่กี่ข้อที่กำหนดกรณีขอบ ๆ:

- record ที่ไม่มี health check นับว่า healthy เสมอ
- ถ้าทุก record ในกลุ่ม unhealthy หมด Route 53 จะถือว่าทุกตัว healthy แล้วตอบไปอยู่ดี เพราะยังไงมันก็ต้องตอบอะไรสักอย่าง
- record ที่มี weight 0 จะถูกใช้ก็ต่อเมื่อ record ทุกตัวที่ weight สูงกว่า unhealthy หมด
- failover ส่ง primary ระหว่างที่มันยัง healthy ไม่อย่างนั้นก็ส่ง secondary แต่ถ้าทั้งสองตัวมี health check และพังทั้งคู่ มันจะส่ง primary ส่วน secondary ที่ไม่มี health check จะถูกส่งเสมอเมื่อ primary พัง

Route 53 publish `HealthCheckStatus` (1 หรือ 0) และ `HealthCheckPercentageHealthy` ไปที่ CloudWatch เฉพาะใน US East (N. Virginia) เท่านั้น alarm ที่อิงกับ metric พวกนี้เลยต้องอยู่ใน `us-east-1`

### failover ใช้เวลานานแค่ไหน

DNS failover เร็วได้แค่เท่ากับ cache ตัวที่ช้าที่สุด ด้วย setting ของ Acme Shop การ check ที่พังสามครั้งห่างกัน 30 วินาทีใช้เวลาได้ถึงประมาณ 90 วินาที จากนั้น resolver ที่ cache คำตอบ Thailand ไว้ก็เก็บมันต่อได้ถึง TTL 60 วินาทีของมัน รวมแล้วประมาณสองนาทีครึ่ง client บางตัวไม่สน TTL: guide ของ AWS SDK สำหรับ Java บอกว่า JVM บาง configuration ไม่เคย refresh DNS lookup เลยจนกว่าจะ restart และแนะนำให้ตั้ง TTL 5 วินาทีผ่าน security property `networkaddress.cache.ttl` นอกจากนี้ client ยัง resolve ชื่อแค่ตอนเปิด connection ทำให้ connection ที่เปิดค้างไว้ยังคุยกับ Region เดิมอยู่ ส่วน fast check (10 วินาที × 3) และ TTL สั้น ๆ ช่วยลดเวลาได้ แต่ต้องจ่ายค่า check และค่า query มากขึ้น ตัว FAQ ของ Route 53 แนะนำ TTL ไม่เกิน 60 วินาทีสำหรับ record ที่ใช้ DNS failover

### DNSSEC

Route 53 **sign** public hosted zone ด้วย DNSSEC ได้ ทำให้ resolver ที่ validate รู้ได้ว่าคำตอบมาจาก zone จริง ๆ และไม่ถูกแก้ระหว่างทาง ตัว key-signing key (KSK) อิงกับ customer managed key ใน AWS KMS ที่ต้องเป็นแบบ asymmetric ใช้ key spec `ECC_NIST_P256` และอยู่ใน US East (N. Virginia) เราเป็นคนดูแลการ rotate มันเอง ส่วน Route 53 ดูแล zone-signing key ให้ และ zone หนึ่งมี KSK ได้สองตัว หลังเปิด signing แล้ว DS record ใน parent zone ที่เพิ่มผ่าน registrar จะสร้าง chain of trust ขึ้นมา ระหว่างที่เปิด signing อยู่ Route 53 จะจำกัด TTL ของ record ไว้ไม่เกินหนึ่งสัปดาห์ และ zone จะเสิร์ฟจาก DNS provider หลายเจ้าพร้อมกันไม่ได้ AWS แนะนำให้ตั้ง CloudWatch alarm บน `DNSSECInternalFailure` และ `DNSSECKeySigningKeysNeedingAction` เพราะ signature ที่พังจะทำให้ resolver ที่ validate เข้า domain ไม่ได้เลย Route 53 ไม่คิดเงินค่า signing แต่ KMS key ก็ยังคิดเงินตามปกติ ส่วนอีกฝั่ง VPC Resolver ก็ **validate** DNSSEC ได้ สำหรับชื่อที่ VPC ของเรา lookup

### Route 53 VPC Resolver และ hybrid DNS

ทุก VPC มี Route 53 **VPC Resolver** อยู่ที่ address ฐานบวกสอง เดิมมันชื่อ Route 53 Resolver จนกระทั่ง Route 53 Global Resolver ออกมา มันตอบ private hosted zone และชื่อของ VPC เอง และ resolve อย่างอื่นทั้งหมดแบบ recursive บน internet ส่วนเครือข่ายแบบ hybrid ก็มี **inbound endpoint** ที่ทำให้ DNS server ใน on-premises resolve ชื่อใน VPC ได้ ส่วน **outbound endpoint** ที่มี **forwarding rule** จะส่ง query ของ domain ที่เลือก (เช่น `corp.example`) ไปที่ DNS server ใน on-premises โดยที่ rule แชร์ให้ account อื่นผ่าน AWS RAM ได้ เหมาะกับ [hub-and-spoke network](../hub-spoke-network/) ส่วน endpoint แต่ละตัวใช้ IP address อย่างน้อยสองตัว ตัวละหนึ่ง network interface

**Resolver DNS Firewall** กรอง query ที่ออกจาก VPC ผ่าน VPC Resolver ด้วย allow list และ block list เป้าหมายหลักคือกันไม่ให้ข้อมูลรั่วออกไปผ่าน DNS lookup ส่วน **Route 53 Profiles** เอา private zone, forwarding rule และ firewall rule group ชุดเดียวไปใช้กับ VPC และ account จำนวนมาก แล้ว **Route 53 Global Resolver** ก็เป็น resolver แยกอีกตัวที่เข้าจาก internet ได้ บน anycast address สำหรับ client ใน on-premises และ client ที่อยู่นอกสถานที่ มี encrypted DNS (DNS over HTTPS หรือ TLS) และการกรองด้วย

### การจด domain

Route 53 เป็น registrar ด้วย: เราจดหรือย้าย domain มาได้ ราคาขึ้นกับ TLD และโดยค่าตั้งต้นได้ถึง 20 domain ต่อ account การจด domain จะสร้าง public hosted zone ชื่อเดียวกันให้ และ domain ที่จดไว้ก็รองรับ DNSSEC

### Application Recovery Controller

failover ด้วย health check ทำงานอัตโนมัติ และนั่นก็คือสิ่งที่อยากได้ตอน load balancer เลิกตอบ แต่ก็ไม่ใช่ทุกครั้ง: Region อาจเสื่อมในแบบที่ endpoint `/health` ไม่แสดงออกมา หรือเราอาจอยากย้าย traffic ก่อนเหตุการณ์ที่วางแผนไว้ **Amazon Application Recovery Controller** (ARC ที่ CLI และบางหน้ายังเรียกว่า Route 53 ARC) เพิ่ม **routing control** เข้ามา: สวิตช์เปิดปิดที่โผล่ใน Route 53 เป็น health check ประเภทพิเศษ และผูกไว้กับ failover record เราพลิกมันผ่าน cluster ของ endpoint ในห้า AWS Region และมี safety rule คอยกันผลที่ไม่ได้ตั้งใจ เช่น routing ที่ fail open ส่วน **Region switch** ของ ARC จัดการแผนกู้คืนแบบ multi-Region ทั้งแผน และ zonal shift ย้าย traffic ออกจาก Availability Zone ตัวเดียว ส่วนฟีเจอร์ readiness check ปิดรับลูกค้าใหม่ไปแล้วตั้งแต่ 30 เมษายน 2026

เรื่องนี้สำคัญเพราะ Route 53 เป็น global service ที่ control plane อยู่ใน `us-east-1`: การสร้างหรือแก้ record ต้องใช้ control plane ตัวนั้น ในขณะที่การตอบ query และการรัน health check เป็นงานของ data plane ที่กระจายอยู่หลาย location คำแนะนำเรื่อง fault isolation ของ AWS คืออย่าพึ่ง operation ของ control plane อย่างการแก้ record ระหว่างกู้ระบบ ส่วน health check และ routing control ยังทำงานต่อได้ผ่าน data plane

### Quota และราคา

ค่าตั้งต้นและราคา ณ ตุลาคม 2026 (AWS Region สาธารณะ):

| รายการ | ค่า |
|---|---|
| Hosted zone | ค่าตั้งต้น 500 ต่อ account, $0.50 ต่อ zone ต่อเดือนสำหรับ 25 ตัวแรก หลังจากนั้น $0.10 และ zone ที่ลบภายใน 12 ชั่วโมงหลังสร้างจะไม่คิดเงิน |
| Record | รวม 10,000 ต่อ hosted zone แล้ว record ที่เกินมาตัวละ $0.0015 ต่อเดือน |
| Query ต่อล้าน (พันล้านแรกของเดือน) | standard $0.40, latency $0.60, geolocation และ geoproximity $0.70, IP-based $0.80 ส่วนถ้าเกินพันล้านคิดครึ่งราคานี้ |
| Query ที่ไม่เสียเงิน | alias query ไปหา AWS resource ที่รองรับ และทุก query ไปหา private hosted zone |
| Health check | ค่าตั้งต้น 200 ตัวที่ active ต่อ account, basic check $0.50 ต่อเดือนสำหรับ AWS endpoint และ $0.75 สำหรับที่อื่น, HTTPS, string matching, interval 10 วินาที และการวัด latency อย่างละ $1.00 ต่อเดือน ($2.00 สำหรับ endpoint ที่ไม่ใช่ AWS), check ของ AWS endpoint ใน account เดียวกันได้ฟรีถึง 50 ตัว และ health ของ ELB load balancer กับ S3 website endpoint ผ่าน Evaluate Target Health ไม่เสียเงิน |
| VPC Resolver endpoint | $0.125 ต่อ network interface ต่อชั่วโมง บวก $0.40 ต่อล้าน query ที่ผ่านมัน |
| DNS Firewall | $0.60 ต่อล้าน query ที่ตรวจ (พันล้านแรก) บวก $0.0005 ต่อเดือนต่อ domain ใน list ของเราเอง |
| Traffic Flow | $50 ต่อ policy record ต่อเดือน |
| DNSSEC signing | Route 53 ไม่คิดเงิน แต่ KMS คิดค่า key |
| ARC routing control | $2.50 ต่อ cluster ต่อชั่วโมง ได้ถึง 2 cluster ต่อ account |

## อยู่ตรงไหนใน solution

- **Solution** สำหรับระบบที่ host domain ไว้ใน Route 53 ทุกการเข้าเว็บเริ่มที่นี่: มันชี้ domain ไปที่ CloudFront, load balancer, API Gateway หรือ S3 website และใน private zone ก็ตั้งชื่อให้ database, cache และ service ภายใน ส่วนใน design แบบ multi-Region มันมักเป็นชั้นแรกของการบังคับทิศทาง traffic
- **Pattern ใน catalog นี้** latency record ที่มี health check คือการ implement [multi-Region active-active](../multi-region-active-active/) ส่วน failover record คือการ implement [active-passive failover](../active-passive-failover/) และขั้น DNS ของ [disaster recovery strategy](../disaster-recovery-strategies/) ส่วนใหญ่ แล้ว weighted record ก็ใช้ย้าย traffic สำหรับ [canary release](../canary-release/) หรือการสลับใน [blue-green deployment](../blue-green-deployment/) ตัว alias ที่ apex เอา [CDN และ edge caching](../cdn-edge-caching/) มาไว้หน้าเว็บ และ health check ของมันก็ probe endpoint แบบที่อธิบายไว้ใน [health endpoint monitoring](../health-endpoint-monitoring/) ส่วน private zone และ Resolver rule ก็ให้ชื่อกับ [private endpoint](../private-endpoints/) และ [hub-and-spoke network](../hub-spoke-network/)
- **เพื่อนบ้านที่มักเจอ** CloudFront, Elastic Load Balancing, static website endpoint ของ [Amazon S3](../amazon-s3/) สำหรับหน้า status และหน้า maintenance, API Gateway, [Amazon VPC](../amazon-vpc/) และ VPC Resolver ของมัน, ชื่อ endpoint ของ [Amazon RDS และ Aurora](../amazon-rds-aurora/), CloudWatch สำหรับ alarm ของ health check, AWS KMS สำหรับ key ของ DNSSEC และ AWS Global Accelerator เมื่อ DNS caching ช้าเกินไป
- **Managed offering** Route 53 เองก็คือ managed service อยู่แล้ว และมี SLA ต่อ hosted zone ส่วน cloud อื่นมีชิ้นส่วนแบบเดียวกันในชื่อ Azure DNS คู่กับ Azure Traffic Manager และ Google Cloud DNS ส่วน Cloudflare มี authoritative DNS พร้อม add-on Load Balancing

## ใช้ตอนไหนดี

ใช้ Route 53 เป็น DNS ทั้งแบบ public และ private ของ workload ที่รันบน AWS ตัว alias record ที่ชี้ไปหา AWS resource ตอบที่ apex ได้, ตามทัน address ที่เปลี่ยนไปของ resource, ไม่เสียเงินต่อ query และรับ health ของ resource มาใช้ได้ ส่วน private zone และ VPC Resolver ก็มาพร้อมทุก VPC อยู่แล้ว ใช้ DNS routing (latency, failover, weighted) เมื่อตัดสินใจครั้งเดียวต่อ lookup ได้ และรับความล่าช้าสักไม่กี่นาทีได้

ถ้า failover ต้องเร็วกว่าที่ cache ยอม หรือทุก request ต้องไปลงที่ที่ถูกต้องแม่นยำ ให้คุมทิศทางที่ชั้นใต้ DNS: ใช้ load balancer ภายใน Region, CloudFront origin failover สำหรับ content หรือ AWS Global Accelerator ที่ให้ static anycast IPv4 address สองตัวกับ client แล้วส่ง traffic ไปบนเครือข่ายของ AWS ถึง endpoint ใน Region ที่ใกล้ที่สุด และเพราะ address ไม่มีวันเปลี่ยน การย้าย traffic เลยไม่ต้องรอให้ resolver ลืมคำตอบเก่า

| | Amazon Route 53 | Cloudflare DNS | Azure DNS + Traffic Manager | Google Cloud DNS |
|---|---|---|---|---|
| ชื่อที่ zone apex | alias record ที่ชี้ไปหา AWS resource หรือ record อื่นใน zone | CNAME flattening | alias record set ที่ชี้ไปหา Azure resource เช่น Traffic Manager profile, public IP หรือ CDN endpoint | record type ALIAS (ยังเป็น preview) ใช้ได้แค่ที่ apex |
| การคุมทิศทางใน DNS | routing policy แปดแบบบนตัว record เอง | add-on Load Balancing: steering แบบ standard (failover หรือ random), geo, dynamic, proximity และ least-outstanding-requests | Traffic Manager profile: priority, weighted, performance, geographic, multivalue และ subnet | routing policy: weighted round robin, geolocation (เลือก fence ได้) และ failover |
| Health check | จากแปด AWS Region แบบ endpoint, calculated หรือ CloudWatch alarm check | monitor ของ add-on Load Balancing จาก region ที่เราเลือก | Traffic Manager probe ทุก 30 หรือ 10 วินาที ยอมให้พังได้ 0 ถึง 9 ครั้ง | สำหรับ internal load balancer และ external endpoint |
| Private DNS | private hosted zone ที่ผูกกับ VPC | Internal DNS สำหรับลูกค้า Enterprise ที่ใช้ Cloudflare Gateway | Azure Private DNS zone ที่ link กับ virtual network | private zone สำหรับ VPC network รวมถึง forwarding zone และ peering zone |
| รูปแบบราคา (ตุลาคม 2026) | ต่อ zone และต่อล้าน query โดย alias query ไปหา AWS resource ฟรี | DNS รวมอยู่ในทุก plan รวมถึง Free ส่วน Load Balancing เป็น add-on ที่ต้องจ่ายเงิน | ต่อ zone และต่อล้าน query ส่วน Traffic Manager คิดต่อล้าน query และต่อ endpoint ที่ monitor | ต่อ zone และต่อล้าน query คือ $0.40 ต่อล้าน และ $0.70 ถ้าใช้ routing policy |

ให้เลือกตามว่า workload รันอยู่ที่ไหน และ edge ส่วนที่เหลืออยู่ที่ไหน Cloudflare เหมาะกับเว็บที่อยู่หลัง proxy ของ Cloudflare อยู่แล้ว Azure DNS คู่กับ Traffic Manager เหมาะกับระบบบน Azure และ Cloud DNS เหมาะกับระบบบน Google Cloud ส่วนการ integrate กับ AWS resource ของ Route 53 (alias, Evaluate Target Health, private zone ต่อ VPC) ก็คือสิ่งที่ต้องยอมเสียถ้าย้าย DNS ของ workload บน AWS ไปที่อื่น

## ได้อะไร เสียอะไร

- **cache เป็นตัวกำหนดจังหวะ** ทุกการตัดสินใจเรื่อง routing จะถูก cache ไว้ตาม TTL โดย resolver ที่เราคุมไม่ได้ และ resolver กับ client บางตัวก็เก็บคำตอบไว้นานกว่านั้น failover ด้วย health check ใช้เวลาเป็นนาที ไม่ใช่เป็นวินาที และ connection ที่เปิดอยู่แล้วก็ไม่ย้ายตาม
- **การแบ่งเป็นแบบต่อ lookup** weight 10 แปลว่า 10% ของ lookup แต่ resolver ที่ยุ่งตัวหนึ่งจะ cache คำตอบเดียวไว้ให้ผู้ใช้ทุกคนที่อยู่หลังมัน ถ้ามี resolver ใหญ่ ๆ อยู่ไม่กี่ตัว สัดส่วนจริงของ request ก็อาจเพี้ยนไปจาก 90/10 ได้มาก ให้ตัดสิน canary จาก metric ของมัน ไม่ใช่จาก weight อย่างเดียว
- **latency routing เห็นเครือข่าย ไม่ได้เห็นผู้ใช้** มันพึ่งการวัดของ AWS ระหว่างเครือข่ายของผู้ใช้กับ Region และถ้าไม่มี EDNS Client Subnet มันก็รู้แค่ address ของ resolver เลยทำให้ผู้ใช้ที่ใช้ public resolver ที่อยู่ไกลอาจถูกส่งไปผิด Region
- **health check มีจุดบอด** checker เข้าถึงได้แค่ public endpoint และเห็นสิ่งที่ `/health` รายงาน ไม่ใช่สิ่งที่ผู้ใช้เจอจริง และเมื่อทุก record unhealthy หมด Route 53 จะถือว่าทุกตัว healthy แล้วตอบต่อไป ส่วน `/health` แบบตื้นจะไม่เห็น dependency ที่พัง ส่วนแบบลึกก็อาจเอาทุก Region ออกพร้อมกันเมื่อ dependency ที่ใช้ร่วมกันพัง
- **control plane อยู่ใน Region เดียว** การแก้ record ต้องใช้ `us-east-1` เพราะฉะนั้นแผนกู้ระบบควรพึ่ง health check หรือ routing control ที่ตั้งไว้แล้ว ไม่ใช่การแก้ record ระหว่างเกิด incident
- **alias ใช้ได้แค่กับ AWS** การย้าย DNS ไป provider อื่นแปลว่าต้องเปลี่ยน alias เป็นฟีเจอร์ flattening หรือ ALIAS ของ provider นั้น และ alias query ที่ฟรีก็จะหายไป
- **บิลเล็ก แต่มีข้อยกเว้น** zone หนึ่งราคา $0.50 ต่อเดือน และ query ส่วนใหญ่ที่ไปหา AWS ก็ฟรี แต่ query แบบ latency, geo และ IP-based แพงกว่า standard query 1.5 ถึง 2 เท่า ส่วน fast health check และ HTTPS health check เพิ่มอย่างละ $1.00 ต่อเดือน และ Resolver endpoint ก็รันตลอด 24 ชั่วโมง

## ข้อควรรู้ตอนลงมือทำ

**สร้าง health check ก่อน แล้วค่อยสร้าง record ที่ใช้มัน** JSON อยู่ในไฟล์ข้าง ๆ command ส่วน ID ในวงเล็บมุมมาจาก step ก่อนหน้า และ `CanonicalHostedZoneId` ของ ALB ได้มาจาก `aws elbv2 describe-load-balancers`:

```sh
# HTTPS /health on the Thailand ALB, every 30 s, 3 results in a row to change state
aws route53 create-health-check --caller-reference api-th-2026-10-07 \
  --health-check-config file://hc-api-th.json

# the latency alias for Thailand under stable.api, plus the weighted 90/10 split for api
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" \
  --change-batch file://api-records.json

# the private zone, associated with the VPC in ap-southeast-7
aws route53 create-hosted-zone --name acme.internal \
  --vpc VPCRegion=ap-southeast-7,VPCId="$VPC_ID" \
  --caller-reference acme-internal-2026-10-07
```

`hc-api-th.json`:

```json
{
  "Type": "HTTPS",
  "FullyQualifiedDomainName": "api-th-1234567890.ap-southeast-7.elb.amazonaws.com",
  "Port": 443,
  "ResourcePath": "/health",
  "RequestInterval": 30,
  "FailureThreshold": 3,
  "EnableSNI": true
}
```

`api-records.json` (record ของ Singapore และ canary หน้าตาเหมือนกัน แค่มี `SetIdentifier`, `Region` หรือ `Weight`, health check และ target ของตัวเอง):

```json
{
  "Changes": [
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "stable.api.shop.example",
        "Type": "A",
        "SetIdentifier": "th",
        "Region": "ap-southeast-7",
        "HealthCheckId": "<ID returned by create-health-check>",
        "AliasTarget": {
          "HostedZoneId": "<CanonicalHostedZoneId of the ALB>",
          "DNSName": "api-th-1234567890.ap-southeast-7.elb.amazonaws.com",
          "EvaluateTargetHealth": true
        }
      }
    },
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "api.shop.example",
        "Type": "A",
        "SetIdentifier": "stable",
        "Weight": 90,
        "AliasTarget": {
          "HostedZoneId": "<ID of the shop.example zone>",
          "DNSName": "stable.api.shop.example",
          "EvaluateTargetHealth": true
        }
      }
    }
  ]
}
```

alias ที่ชี้ไปหา record อื่นใน zone เดียวกันใช้ ID ของ zone นั้นเองเป็น `HostedZoneId` ส่วน alias ที่ชี้ไปหา CloudFront distribution ใช้ `Z2FDTNDATAQYW2` เสมอ

- **ให้ failover record มีอายุสั้น และ record อื่นมีอายุยาว** TTL 60 วินาทีเหมาะกับ record ที่ fail over ส่วน record ที่ไม่ค่อยเปลี่ยนอย่าง MX หรือ TXT เก็บไว้เป็นชั่วโมงได้ ช่วยประหยัด query ได้ และควรลด TTL ลงสักวันสองวันก่อน migration ที่วางแผนไว้ เพราะ resolver จะเก็บค่าเก่าไว้ตาม TTL เก่า
- **check เส้นทางที่ผู้ใช้ใช้จริง** Evaluate Target Health ฟรีและตาม target health ของ ALB เอง ส่วน Route 53 health check บน `/health` ที่ผ่าน load balancer ก็จับปัญหาที่อยู่หน้า target ได้ด้วย เช่น listener rule ที่ไม่ไปถึง target แล้ว ส่วน `/health` ก็ทำให้เบา ๆ ไว้ และตัดสินใจว่าจะครอบคลุม dependency ไหนบ้าง (ดู [health endpoint monitoring](../health-endpoint-monitoring/))
- **ตั้ง alarm บน health check** ด้วย metric `HealthCheckStatus` ใน `us-east-1` จะได้มีคนรู้เรื่อง failover ที่ DNS จัดการไปเอง
- **ซ้อม failover** ตัวเลือก *invert health check status* หรือ `/health` ที่ตั้งใจให้พังใน test environment จะแสดงเวลา failover จริง รวมถึง cache ของ client ด้วย
- **ระวังหน้า status บน S3** alias ที่ชี้ไปหา S3 website endpoint ต้องใช้ bucket ชื่อเดียวกับ record คือ `status.shop.example` ที่ตั้งไว้สำหรับ website hosting ตัว S3 website endpoint เสิร์ฟได้แค่ HTTP ส่วนถ้าจะใช้ HTTPS ให้เอา CloudFront ไว้หน้า bucket แล้วชี้ secondary record ไปที่ distribution โดยที่ alternate domain name ของ distribution ต้องมี `status.shop.example` อยู่ด้วย
- **ใช้ data plane ตอนเกิด incident** การแก้ record ด้วยมือต้องใช้ control plane เพราะฉะนั้นให้เตรียม failover record, health check หรือ ARC routing control ไว้ล่วงหน้า
- **เปิด query logging ตอน debug** authoritative query log ไปที่ CloudWatch Logs ใน `us-east-1` ส่วน VPC Resolver query log ไปที่ CloudWatch Logs, S3 หรือ Firehose ได้ Route 53 ไม่คิดเงินทั้งสองแบบ แต่ปลายทางคิด
