## ปัญหา

managed service หลายตัว (database, storage account, key vault, queue และ API ของ cloud เอง) เข้าถึงผ่าน **public endpoint**: ชื่อที่ resolve ได้เป็น internet address ที่ provider รันไว้ให้ แบบนี้สะดวกและมักเป็นจุดเริ่มต้น แต่ก็มีผลตามมาสามข้อ

- **ใครก็มาเคาะประตูได้** หน้า sign-in ของ database เราเข้าถึงได้จากทั้ง internet สิ่งเดียวที่กั้นระหว่างมันกับโลกภายนอกคือ credential กับ IP allow-list เพราะฉะนั้นแค่ password หลุดหนึ่งตัว, firewall rule ที่กว้างเกินหนึ่งข้อ หรือช่องโหว่ authentication ที่ยังไม่ patch หนึ่งจุดก็พอแล้ว
- **workload ที่อยู่ใน private network ต้องมีทางออก** server ใน private subnet จะไปถึง public address ได้ก็ต้องผ่าน internet route หรือ NAT gateway และนี่คือเส้นทาง egress ที่ security team หลายทีมอยากปิดหรืออยาก inspect พอดี
- **ทางไปหา resource ของเราก็เป็นทางไปหา resource ของคนอื่นด้วย** firewall rule ที่ให้ subnet หนึ่งไปถึง public address ของ service ได้ มักให้มันไปถึง resource ของลูกค้ารายอื่นทุกรายบน service นั้นได้ด้วย server ที่โดนเจาะ หรือคนในเอง ก็เลยก็อปข้อมูลไปใส่ storage account ของตัวเองได้ network rule แยกไม่ออกว่า account ไหนเป็นของเราและ account ไหนเป็นของเขา

security baseline ต้องการตรงกันข้าม control *NS-2: Secure cloud native services with network controls* ของ Microsoft cloud security benchmark บอกให้ทุก service มีจุดเข้าถึงแบบ private และให้ปิดหรือจำกัด public network access เท่าที่ทำได้ หลายองค์กรก็เขียน rule เดียวกันนี้ไว้ใน policy ของตัวเองสำหรับทุกอย่างที่เก็บข้อมูลลูกค้า

## ทำงานยังไง

**private endpoint** ให้ managed resource หนึ่งตัวมี address อยู่ใน network ของเรา diagram เดินตามลำดับการ rollout ที่ทำกันปกติ:

1. **จุดเริ่มต้น** แอป resolve `orders.db.cloud.example` ได้ `203.0.113.10` แล้วออกไปทาง NAT ส่วน attacker ก็มาถึงประตูหน้าบานเดียวกัน และมีแค่หน้า sign-in ที่หยุดเขาไว้
2. **เพิ่ม endpoint** platform สร้าง network interface ใน subnet ที่เราเลือก และให้ private address (`10.1.2.5`) ที่ไม่เปลี่ยนตลอดอายุของ endpoint ตัว interface นี้ผูกกับ **resource ตัวเดียว** (และบาง service ผูกกับ sub-resource ตัวเดียว: storage account ของ Azure ต้องมี endpoint แยกสำหรับ Blob และสำหรับ Files) **private DNS zone** ที่ link กับ network จะตอบชื่อปกติของ service ด้วย address นั้น connection string, SDK และ TLS certificate เลยใช้ได้เหมือนเดิมโดยไม่ต้องแก้อะไร ส่วน connection เปิดได้จากฝั่งเราเท่านั้น: provider ไม่มี route ย้อนกลับเข้ามาใน network เราผ่าน endpoint
3. **ปิดประตูฝั่ง public** endpoint เพิ่มทาง private เข้ามา แต่ไม่ได้ลบทาง public ออก เราต้องปิด public network access ที่ตัว resource เอง หลังจากนั้นก็จะเหลือแค่ทาง private ที่ใช้ได้ network ที่ต่อเข้ามาผ่าน VPN หรือ dedicated circuit (Azure ExpressRoute, AWS Direct Connect, Google Cloud Interconnect) ก็ไปถึง private address เดียวกันได้ ถ้า DNS ของมันถาม resolver ถูกตัว
4. **อยู่กับข้อจำกัดให้ได้**: DNS, ตำแหน่งที่วาง, ต้นทุน และการที่ endpoint แต่ละตัวรับใช้ resource ได้แค่ตัวเดียวพอดี

resource ไม่ได้ย้ายไปไหน และข้อมูลของมันก็ไม่ได้เปลี่ยน: ที่เปลี่ยนมีแค่เส้นทาง network กับคำตอบของ DNS

### แต่ละ cloud ทำยังไง

- **Azure: Private Link และ private endpoint** private endpoint คือ network interface แบบ read-only ใน subnet ของเรา ต่ออยู่กับ *private-link resource* (Azure SQL Database, storage account, Key Vault, Cosmos DB และอีกหลายสิบตัว หรือ service ของใครสักคนเอง) ถ้าเรามี permission ที่ถูกต้องบน resource ตัว connection จะถูก approve อัตโนมัติ ไม่อย่างนั้นมันจะรออยู่ในสถานะ *Pending* จนกว่าเจ้าของ resource จะ approve และมีแค่ endpoint ที่ approve แล้วเท่านั้นที่รับ traffic พอ resource มี private endpoint แล้ว public DNS ของ Azure จะชี้ชื่อของมันไปที่ alias `privatelink` เช่น `orders.database.windows.net` → `orders.privatelink.database.windows.net` แล้ว private DNS zone ชื่อ `privatelink.database.windows.net` (หรือ `privatelink.blob.core.windows.net` สำหรับ Blob storage) ที่ link กับ virtual network ของเรา จะตอบ alias นั้นด้วย private address ส่วนคนอื่นทั้งหมดจะไล่ chain ฝั่ง public ไปจนได้ public address ตัว *DNS zone group* บน endpoint คอยให้ A record ตรงกับ endpoint อยู่เสมอ resource แต่ละตัวมีการตั้งค่า **public network access** ของตัวเอง: ถ้าตั้งเป็น *Disabled* ตัว Azure SQL Database จะปฏิเสธ public connection ด้วย error 47073 และไม่ให้แก้ IP firewall rule ของมันอีก
- **AWS: PrivateLink interface endpoint** interface VPC endpoint วาง network interface ไว้ใน subnet หนึ่งตัวต่อแต่ละ Availability Zone ที่เราเลือก โดยมี security group คุ้มกันอยู่ ถ้าเปิด **private DNS** (VPC ต้องเปิด DNS hostnames และ DNS resolution ไว้) AWS จะผูก private hosted zone ที่ซ่อนอยู่เข้ากับ VPC ทำให้ชื่อปกติของ service อย่าง `sqs.us-east-1.amazonaws.com` resolve ได้เป็น address ของ endpoint แล้ว endpoint ทุกตัวยังได้ชื่อ `vpce` แบบ Regional และแบบ zonal ด้วย interface endpoint ไปถึง AWS service และ *endpoint service* ที่ account อื่น publish ไว้ ส่วน **resource endpoint** ไปถึง resource ตัวเดียว เช่น database หนึ่งตัว ที่ account หนึ่ง share ไว้เป็น resource configuration ตัว interface endpoint ของ AWS service ไปถึงทั้ง service ใน region ไม่ใช่แค่ bucket เดียวหรือ queue เดียว เพราะแบบนี้ endpoint policy ถึงสำคัญตรงนั้น (ดูข้างล่าง)
- **AWS: gateway endpoint สำหรับ S3 และ DynamoDB** ตัวนี้ไม่ใช่ PrivateLink โดย gateway endpoint จะเพิ่ม route ที่มีปลายทางเป็น prefix list ของ service เข้าไปใน route table ที่เราเลือก แล้ว traffic ก็ยังไปที่ address **public** ของ service โดยไม่ต้องมี internet gateway หรือ NAT มันฟรี แต่ใช้ได้จากใน VPC นั้นเท่านั้น: ใช้จาก on premises ไม่ได้ และใช้จาก Region อื่นก็ไม่ได้ ทั้งสอง service ก็มี interface endpoint ให้ใช้ด้วยสำหรับกรณีที่ต้องใช้
- **Google Cloud: Private Service Connect** endpoint คือ forwarding rule ที่ถือ internal IP address ใน VPC network ของเรา มันชี้ไปที่ **Google APIs** (internal address ระดับ global ตัวเดียวที่ให้บริการ bundle `all-apis` หรือ `vpc-sc` และมีชื่อ DNS อย่าง `storage-xyz.p.googleapis.com`) หรือชี้ไปที่ **published service** ผ่าน service attachment ของมัน เช่น managed database หรือ SaaS ของ partner ส่วน endpoint ของ published service เป็นแบบ regional ยกเว้นจะเปิด *global access* นอกจากนี้ Private Service Connect ยังมี *backend* (load balancer ที่วางหน้า service เพื่อใช้ certificate และ control ของเราเอง) และ *interface* (สำหรับ producer ที่ต้องเปิด connection เข้ามาใน network เรา) ส่วน Private Google Access เป็นการตั้งค่าราย subnet ที่ให้ instance ที่ไม่มี external address ไปถึง Google APIs ได้ โดยที่ API พวกนั้นยังใช้ public address ของตัวเอง: มันเปลี่ยนวิธีไปถึง ไม่ได้เปลี่ยนที่ที่เราต่อไป

บาง service เลี่ยงคำถามนี้ไปเลยด้วยการรันอยู่ใน network ของเราตั้งแต่แรก: Amazon RDS วาง network interface ของ database ไว้ใน subnet ของ VPC เรา และ Azure service หลายตัวก็ deploy ลงใน subnet ของ virtual network ได้ ส่วน **service endpoint** ของ Azure อยู่ตรงกลาง: service ยังมี public address และคำตอบ DNS ฝั่ง public เหมือนเดิม แต่ traffic จาก subnet ที่เปิดไว้จะวิ่งผ่าน route ที่ optimise แล้วบน backbone ของ Microsoft ด้วย private source address ของเรา ทำให้ firewall ของ resource allow subnet นั้นได้ ตัว service endpoint ไม่มีค่าใช้จ่าย ใช้จาก on premises ไม่ได้ และ Microsoft แนะนำให้ใช้ private endpoint สำหรับการเข้าถึงแบบ private

### เปิด service ของเราเองแบบ private

ทุก provider ใช้กลไกเดียวกันแบบกลับด้าน SaaS vendor หรือ platform team เลยเปิด service ให้ network อื่นใช้ได้โดยไม่ต้อง peer network ทั้งก้อนเข้าหากัน:

- **Azure Private Link service:** วาง service ไว้หลัง Standard Load Balancer แล้วสร้าง Private Link service ส่วนฝั่ง consumer ก็สร้าง private endpoint มาหามันด้วย resource ID หรือด้วย alias ที่เราแชร์ให้ ข้าม subscription และข้าม tenant ได้ แล้วเราก็ approve ทีละ connection (หรือ auto-approve subscription ที่อยู่ใน list) ตัว Private Link service เองไม่มีค่าใช้จ่าย ส่วน consumer จ่ายค่า endpoint ของตัวเอง
- **AWS endpoint service:** วาง Network Load Balancer ไว้หน้า service, allow AWS principal ที่อนุญาตให้ต่อเข้ามา แล้ว accept connection request ของเขา ฝั่ง consumer สร้าง interface endpoint มาหามัน เราแนบ private DNS name ได้ เพื่อให้ consumer ใช้ hostname เดิมของเราต่อ และเปิด cross-Region access ได้ เพื่อให้ consumer ใน Region อื่นต่อเข้ามาได้ ให้กระจาย load balancer ไว้อย่างน้อยสอง Availability Zone
- **Google Cloud published service:** สร้าง service attachment ที่ชี้ไปที่ internal load balancer ของ service พร้อม accept list ของ consumer project หรือ network และ NAT subnet สำหรับ traffic ที่แปลง address แล้ว ฝั่ง consumer ต่อเข้ามาด้วย endpoint หรือ backend

traffic มาถึง producer จาก address ที่ platform แปลงไว้เอง ไม่ได้มาจาก network ของ consumer ทำให้สองฝั่งไม่ต้อง route หากันเลย ถ้า service ต้องรู้ว่า client ต้นทางเป็นใคร ให้หาวิธีที่ platform ส่งข้อมูลนั้นต่อมา เช่น header Proxy Protocol v2 จาก AWS Network Load Balancer

### การออกแบบ DNS

endpoint เป็นส่วนที่ง่าย ส่วน DNS เป็นตัวตัดสินว่าจะมีใครได้ใช้มันจริงไหม

- **private zone ที่ link กับ network** private zone ตอบแค่ให้ network ที่ link กับมันไว้ ใน network แบบ hub-and-spoke ให้สร้างแต่ละ zone ครั้งเดียวไว้ที่ส่วนกลาง แล้ว link กับ hub และทุก spoke ที่มี client ส่วน Azure เตือนไว้ว่าถ้ามี zone ชื่อเดียวกันแยกกันอยู่ในหลาย network ก็ต้อง merge เองด้วยมือ
- **หนึ่งชื่อ หนึ่งคำตอบ** network ที่ใช้ DNS configuration ชุดเดียวกันควรมี endpoint แค่ตัวเดียวต่อ resource โดยบน Azure นี่คือแนวทางที่แนะนำ เพราะ endpoint สองตัวของ resource เดียวกันจะแย่ง record ตัวเดียวกัน ส่วนบน AWS การสร้าง interface endpoint ตัวที่สองของ service เดียวกันใน VPC จะ fail ด้วย error conflicting DNS domain ถ้ามันขอ private DNS ด้วย
- **resolver ที่มี inbound และ outbound endpoint** DNS server ฝั่ง on-premises ถาม resolver ที่ติดมากับ cloud ตรง ๆ ไม่ได้ ทุก cloud เลยให้ address สำหรับ forward ไปหา: **inbound endpoint** ของ Azure DNS Private Resolver, inbound endpoint ของ Route 53 VPC Resolver (เปลี่ยนชื่อมาจาก Route 53 Resolver) หรือ entry point ของ Cloud DNS *inbound server policy* ส่วนทางกลับกัน **outbound endpoint** ที่มี forwarding rule ให้ workload บน cloud resolve ชื่อฝั่ง on-premises ได้
- **conditional forwarder ฝั่ง on premises** forward zone ของ service ไปที่ inbound address นั้น บน Azure ให้ forward zone ฝั่ง public (`database.windows.net`) ไม่ใช่ zone `privatelink`: CNAME chain จะได้เริ่มที่ resolver ของ cloud ตัวที่มองเห็น private zone
- **หลุมของ split-horizon** ชื่อเดียวกันมีสองคำตอบ และ client จะได้คำตอบไหนก็ขึ้นกับว่ามันไปถามใคร ระวังเรื่องพวกนี้:
  - **zone ที่บังของจริง** อย่าสร้าง private zone ให้ทั้ง public domain (`blob.core.windows.net`): ทุกชื่อใน domain นั้นที่ไม่มี record จะ fail หมด
  - **endpoint ของคนอื่น** ถ้าเรา link `privatelink.blob.core.windows.net` ไว้ แล้วไปต่อ storage account ขององค์กรอื่นที่มี private endpoint ของตัวเอง zone ของเราจะไม่มี record ของมันและตอบ *NXDOMAIN* การตั้งค่า *fallback to internet* บน network link ของ zone ใน Azure จะ retry ชื่อแบบนั้นทาง public
  - **fallback ไป public แบบเงียบ ๆ** client ที่ DNS ไม่ได้ forward (client B) จะได้ public address แล้วถ้า public access ยังเปิดอยู่ มันก็ต่อผ่าน internet ไปโดยไม่มีใครสังเกต นี่เป็นอีกเหตุผลที่ต้องปิด public access: ความผิดพลาดจะกลายเป็น error ให้เห็น
  - **Caching** resolver cache คำตอบไว้ รวมถึงคำตอบแบบ negative ด้วย ทำให้ record ที่แก้แล้วอาจใช้เวลาสักพักกว่าจะถึง client

### ปิด public access และพิสูจน์ว่าปิดจริง

- **ปิดที่ตัว resource:** บน Azure ใช้การตั้งค่า *public network access* ส่วน AWS service ที่ยังมี public endpoint ระดับ region อยู่ ให้ใช้ resource policy เช่น S3 bucket policy ที่ deny request ที่ไม่ได้มาทาง endpoint ของเรา (`aws:SourceVpce`) และบน Google Cloud ใช้ perimeter ของ VPC Service Controls ที่ block การเข้าถึง Google APIs และ resource จากนอก perimeter ยกเว้นจะมี rule อนุญาต ระวังผลข้างเคียงด้วย: AWS บอกไว้ว่า bucket policy แบบนั้นจะ block S3 console ไปด้วย เพราะ console ไม่ได้มาทาง endpoint ของเรา
- **เช็ก default แล้วตั้งของเราเอง** default ต่างกันไปตาม service: public network access ของ Azure SQL Database เป็น disabled ตั้งแต่ต้น และ Azure App Configuration มีโหมด *Automatic* ที่ปิด public access ทันทีที่ store มี private endpoint อย่าพึ่งทั้งสองอย่างนี้: ใช้ policy as code (Azure Policy มี built-in definition อย่าง *Storage accounts should disable public network access* และ *Azure Key Vault should disable public network access*) จะได้สร้าง resource ใหม่แบบเปิดไว้ไม่ได้ และตั้ง alert เมื่อมีการเปลี่ยน
- **ทดสอบจากทั้งสองฝั่ง:** จากข้างนอก connection ต้องโดนปฏิเสธ จาก client network แต่ละตัว ชื่อต้อง resolve ได้เป็น private address และ connection ต้องใช้ได้ อีกเรื่องคือ public DNS ยังตอบชื่อนี้อยู่แม้จะปิดประตูไปแล้ว แล้ว Azure ก็บอกไว้ว่าสิ่งนี้เผยแค่ว่า resource มีอยู่ ไม่ได้บอกว่ามันเข้าถึงได้

### Endpoint policy และ resource policy

- **AWS endpoint policy** จำกัดสิ่งที่ทำได้ *ผ่าน* endpoint: เช่น ทำได้แค่ `s3:GetObject` กับ `s3:PutObject` และทำได้แค่กับ bucket ใน account ของเราเอง นี่คือวิธีกันไม่ให้ interface หรือ gateway endpoint ของ S3 กลายเป็นทางไปหา bucket ของคนอื่น
- **Resource policy** จำกัดว่าใครเข้าถึง resource ได้: S3 bucket policy ที่ใช้ `aws:SourceVpce` รับแค่ request ที่มาทาง endpoint ของเรา
- **Network rule** ยังมีผลอยู่: security group บน AWS interface endpoint ส่วนบน Azure คือ network security group และ route table บน endpoint subnet หลังจากเปิด network policy ให้ private endpoint แล้ว
- **Azure service endpoint policy** ทำให้ service endpoint ในแบบเดียวกับที่การผูกกับ resource เดียวทำให้ private endpoint: มันให้ service endpoint ของ subnet ไปถึงได้แค่ resource ที่เรา list ไว้

### Availability

- **AWS:** เลือก subnet ไว้อย่างน้อยสอง Availability Zone ชื่อแบบ Regional จะกระจาย client ไปที่ endpoint interface ที่ยัง healthy ส่วนชื่อแบบ zonal เก็บ traffic ไว้ใน zone เดียว (มีประโยชน์ตอนอยากแยก zone และเลี่ยงค่า transfer ข้าม zone)
- **Azure:** private endpoint และ virtual network ครอบหลาย availability zone ตัว endpoint เลย zone resilient อยู่แล้ว แต่ต้องดูให้ resource ข้างหลังมัน zone resilient ด้วย ส่วน endpoint ก็ต่อกับ resource ใน region อื่นได้ และสำหรับ disaster recovery เราต้องมี endpoint กับ DNS record ของ resource ใน secondary region เตรียมไว้ก่อน fail over
- **Google Cloud:** endpoint ของ published service เป็นแบบ regional ให้เปิด global access ถ้า client ใน region อื่นต้องใช้มัน

### ต้นทุน

- **Azure:** คิดเงินรายชั่วโมงต่อ private endpoint บวกค่าต่อ GB ของข้อมูลที่ process ในแต่ละทิศ ส่วน traffic ที่ไป private endpoint ผ่าน regional virtual network peering ไม่เสียค่า peering
- **AWS:** คิดเงินรายชั่วโมงต่อ interface endpoint *ต่อ Availability Zone* บวกค่า processing ต่อ GB ที่ลดลงเป็นขั้นเมื่อปริมาณใหญ่มาก ๆ resource endpoint มีค่ารายชั่วโมงของตัวเอง ส่วน gateway endpoint ฟรี
- **Google Cloud:** คิดเงินรายชั่วโมงต่อ endpoint ส่วน endpoint ของ published service จ่ายค่าต่อ GiB ที่ process ด้วย ขณะที่ endpoint ของ Google APIs ไม่มีค่า data

endpoint รวมกันแล้วก็เยอะ: หนึ่งตัวต่อ resource ต่อ sub-resource ต่อ zone และต่อ network ที่ต้องใช้ กลายเป็นรายการค่าใช้จ่ายจริงจัง และเป็นอีกเหตุผลที่ควรแชร์มันจาก hub

## ใช้ตอนไหนดี

- database, storage และ secret ที่เก็บข้อมูลที่ห้ามเปิดออกไป โดยเฉพาะเมื่อมี policy หรือกฎระเบียบที่ไม่ให้ใช้ public network access
- workload ใน network ที่ไม่มี internet egress หรือที่ egress ต้องผ่าน firewall ที่ inspect traffic
- เข้าถึง cloud service จาก on premises ผ่าน VPN หรือ private circuit ด้วย private address แทนที่จะวิ่งผ่าน internet
- จำกัด **data exfiltration**: subnet ที่ไปถึงได้แค่ resource *ของเรา* เอาไปใช้ผิดทางได้ยากกว่า subnet ที่ไปถึงทั้ง service มาก
- เปิด service ของเราเองแบบ private ให้ทีมอื่นหรือลูกค้าใช้ ในฐานะ producer

**ตอนไหนไม่ควรใช้:**

- **public API ที่เราไม่ได้คุม** เราสร้าง endpoint ได้แค่กับสิ่งที่ provider เปิดให้เป็น private service ส่วน API ของ third-party ที่ไม่มีแบบ private ก็ยังอยู่บน internet: ให้ป้องกัน call พวกนั้นด้วย egress control และ authentication
- **client ที่อยู่บน internet อยู่แล้ว** browser กับ mobile app ใช้ private endpoint ของเราไม่ได้: ที่ของพวกมันคือ public edge ([API gateway](../api-gateway/), CDN, web application firewall)
- **environment เล็ก ๆ หรือความเสี่ยงต่ำ** ที่ค่า endpoint แต่ละตัวกับงาน DNS มากกว่าความเสี่ยง หรือที่ทางเลือกแบบเปลี่ยนแค่ route ที่ฟรี (service endpoint, gateway endpoint, Private Google Access) ก็ตอบโจทย์อยู่แล้ว

## ได้อะไร เสียอะไร

- **DNS กลายเป็น infrastructure ที่สำคัญมาก** ทุก client network ต้องมี zone หรือ forwarder ที่ถูกต้อง และ outage ส่วนใหญ่หลัง rollout ก็เป็นปัญหา name resolution ที่มักเกิดกับ client แค่บางตัว
- **มีของให้ดูแลมากขึ้น:** endpoint subnet และ address space ของมัน, การ approve, zone link, forwarder และ quota ของจำนวน endpoint
- **ต้นทุนโตตามจำนวน resource, zone และ network** บวกทุก gigabyte ที่วิ่งผ่าน
- **เครื่องมือบางตัวจะใช้ไม่ได้** อะไรก็ตามที่เข้าถึง resource จากนอก network ของเรา (data browser ใน cloud console, SaaS integration, build agent บน internet) จะเข้าไม่ได้ทันทีที่ปิดประตูฝั่ง public
- **private ไม่ได้แปลว่าไว้ใจได้** endpoint จำกัดว่า connection มาจาก*ที่ไหน*ได้บ้าง แต่ไม่ได้ตัดสินว่า*ใคร*ทำ*อะไร*ได้ server ที่โดนเจาะใน network ก็ยังไปถึงหน้า sign-in ของ database ได้อยู่ดี

## ข้อควรรู้ตอนลงมือทำ

- **ไล่ปัญหาจากฝั่ง client โดยเริ่มที่ DNS** resolve ชื่อ*บน client ตัวที่มีปัญหา* ด้วย `nslookup` หรือ `dig` และต้องได้ private address ถ้าได้คำตอบเป็น public แปลว่าเส้นทาง DNS ผิด: ไม่มี zone link, ไม่มี forwarder, zone ผิดตัว หรือ client ไปใช้ resolver ตัวอื่น จากนั้นทดสอบ TCP port ไปที่ private address แล้วดู security group หรือ network security group บน endpoint และ route ขากลับจาก on premises แล้วดูสถานะ connection ของ endpoint (endpoint ของ Azure ที่ค้างอยู่ใน *Pending* ไม่รับ traffic) แล้วค่อยไปดู credential เป็นอย่างสุดท้าย
- **ต่อด้วยชื่อเสมอ** ต่อด้วย hostname ปกติของ service ไม่ใช่ IP address และไม่ใช่ internal alias: TLS certificate ของ server ถูกเช็กกับ hostname นั้น
- **ให้ endpoint มี subnet ของตัวเอง** ขนาดเผื่อโต พร้อม network rule ที่ให้เข้าได้แค่ client ที่ต้องใช้ resource แต่ละตัว
- **ใช้ชื่อ zone ตามที่แนะนำ** Azure จะสร้าง DNS record ให้อัตโนมัติก็ต่อเมื่อ private zone ใช้ชื่อที่แนะนำสำหรับ service นั้น
- **คอยดู traffic** Azure Monitor แสดงข้อมูลที่ private endpoint แต่ละตัว process และ AWS ก็ตั้ง alert จาก endpoint event ได้ ส่วน NSG flow log ของ Azure ไม่เก็บ traffic ขาเข้าที่ไป private endpoint เลยต้อง log ที่ resource ด้วย
- **ใช้คู่กับ identity** มองทาง private เป็นหนึ่งชั้น: ยังต้องมี authentication และ authorisation ที่แข็งแรงต่อทุก request บน resource แบบใน [zero trust access](../zero-trust-access/) การอยู่ใน network จะได้ไม่ให้ความไว้ใจด้วยตัวมันเอง
- **ยังต้องเข้ารหัส** private address ไม่ใช่เหตุผลที่จะเลิกใช้ TLS ถ้าทั้งสองฝั่งต้องพิสูจน์ตัวตน ให้ใช้ [mutual TLS](../mutual-tls/) ซ้อนไปอีกชั้น
- **วางแผนเรื่อง region** สำหรับ [multi-region active-active](../multi-region-active-active/) หรือ disaster recovery ให้สร้าง endpoint และ DNS record ของ resource ในแต่ละ region ไว้ล่วงหน้า และทดสอบ failover โดยมี endpoint อยู่ครบ
