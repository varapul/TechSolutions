## ปัญหา

application ของ Acme Shop มีบางส่วนที่ internet ต้องเข้าถึงได้ และบางส่วนที่ internet ต้องเข้าไม่ถึงเด็ดขาด คนซื้อต้องเข้าถึง load balancer ที่ port 443 ได้ ส่วน [ECS](../amazon-ecs/) task ที่อยู่ข้างหลังควรรับ traffic จาก load balancer ตัวนั้นเท่านั้น และ database PostgreSQL ก็ควรรับจาก task เท่านั้น แต่ task ยังต้องออกไปข้างนอกได้: ไปที่ API ของผู้ให้บริการ payment บน internet และไปที่ S3 bucket `acme-invoices` ที่ใช้เก็บ invoice ทุกอย่างต้องทำงานต่อได้ตอน Availability Zone หนึ่งล่ม และวันหลัง network นี้ก็ต้องต่อกับ VPC อื่นและกับออฟฟิศได้โดย address ไม่ชนกัน ถ้าเอา resource ทุกตัวไปไว้ใน network แบน ๆ ผืนเดียวที่มี public address ตัว database ก็จะห่างจาก internet แค่ rule ที่พิมพ์ผิดตัวเดียว และไม่มีทางบอกได้เลยว่า "รับเฉพาะจากชั้นที่อยู่ข้างหน้าฉัน"

## ทำงานยังไง

Amazon VPC คือ virtual network ที่แยกขาดจากคนอื่นในเชิง logical และอยู่ใน AWS Region เดียว เรากำหนดช่วง IP address ให้มัน แบ่งช่วงนั้นเป็น subnet แล้วใช้ route table, gateway และ firewall rule ตัดสินว่าอะไรเข้า ออก และเดินทางข้างในได้บ้าง ตัว VPC เองไม่เสียเงิน ส่วน NAT gateway, endpoint, public IPv4 address และ data transfer มีราคาของตัวเอง (ดูหัวข้อ *ได้อะไร เสียอะไร* ด้านล่าง)

### แผน address

IPv4 block หลักของ VPC มีขนาดได้ตั้งแต่ /16 (65,536 address) ถึง /28 (16) ส่วน Acme Shop ใช้ `10.0.0.0/16` จากช่วง private ของ RFC 1918 ตัว block ที่สร้างแล้วจะเปลี่ยนขนาดไม่ได้ แต่เพิ่ม secondary block ได้: ค่าตั้งต้น 5 block ต่อ VPC รวม block หลักด้วย ขอเพิ่มได้ถึง 50 (quota ณ ตุลาคม 2026) ให้เลือกช่วงที่จะไม่ทับกับ network ที่อาจต่อด้วยในวันหลังเลย (VPC อื่น Region อื่น ออฟฟิศ) เพราะสร้าง VPC peering connection ระหว่าง VPC ที่ช่วงทับกันไม่ได้ และ route table ก็แยกช่วงเดียวกันสองชุดออกจากกันไม่ได้ เอกสารยังเตือนไม่ให้ใช้ `172.17.0.0/16` ด้วย เพราะ AWS service บางตัวใช้ช่วงนี้เอง ส่วน Amazon VPC IP Address Manager (IPAM) แจก block ให้ VPC ใหม่จาก pool กลางตาม rule ที่เราตั้งได้ ข้าม account และ Region ได้ และคอยติดตามว่าพื้นที่ address ถูกใช้ไปยังไง

IPv6 จะใช้หรือไม่ก็ได้ Amazon แจก /56 จาก pool ของตัวเองให้ VPC ได้ (หรือเราเอาช่วงของเราเองมาก็ได้) แล้ว subnet ก็รับ block ขนาดตั้งแต่ /44 ถึง /64 ตัว IPv6 address ไม่ซ้ำกันทั้งโลก เลยไม่ใช้ NAT แต่การออก internet ทางเดียวของ IPv6 จะใช้ **egress-only internet gateway** แทน ตัวนี้ยอมให้ connection ออกไปได้ แต่ไม่ยอมให้อะไรเข้ามาเลย

### Subnet และ Availability Zone

subnet คือช่วงย่อยของช่วง address ของ VPC ที่อยู่ใน Availability Zone เดียวทั้งหมด AWS กัน address ห้าตัวของทุก subnet ไว้ใช้เอง: ใน `10.0.10.0/24` ได้แก่ `.0` (network), `.1` (VPC router), `.2` (DNS), `.3` (กันไว้ใช้ในอนาคต) และ `.255` (broadcast ที่ VPC ไม่รองรับ) ทำให้ /24 แต่ละตัวเหลือ address ที่ใช้ได้ 251 ตัว ส่วน Acme Shop มีสามชั้นในแต่ละ zone จากสอง zone:

| Subnet | Zone a | Zone b | เก็บอะไร | traffic ไป 0.0.0.0/0 ไปที่ |
|---|---|---|---|---|
| public | `10.0.0.0/24` | `10.0.1.0/24` | node ของ ALB, NAT gateway | internet gateway |
| private app | `10.0.10.0/24` | `10.0.11.0/24` | ECS task | NAT gateway ใน zone เดียวกัน |
| private data | `10.0.20.0/24` | `10.0.21.0/24` | [RDS](../amazon-rds-aurora/) primary และ standby | ไม่ไปไหนเลย: มีแค่ traffic ภายใน |

มีแค่ routing เท่านั้นที่ทำให้ subnet เป็น public หรือ private ตัว subnet จะเป็น **public** เมื่อ route table ของมันมี route ไปที่ internet gateway และเป็น **private** เมื่อไม่มี ส่วน private subnet ถ้าจะออก internet ได้ก็ต้องผ่าน NAT device ตัว subnet ที่ไม่มี route ออกนอก VPC เลย อย่าง data subnet สองตัวนี้ AWS เรียกว่า **isolated** ส่วน resource ใน public subnet ก็ยังต้องมี address ของตัวเองที่ internet route มาถึงได้ด้วย คือ public IPv4, Elastic IP address หรือ IPv6 address ถึงจะคุยกับ internet ได้ตรง ๆ

managed service จะวาง network interface ไว้ใน subnet พวกนี้และมี rule ของตัวเอง Application Load Balancer ต้องมี subnet อย่างน้อยสอง Availability Zone โดยแต่ละตัวต้องเป็น /27 หรือใหญ่กว่า และมี address ว่างอย่างน้อยแปดตัวเพื่อให้มัน scale ได้ ส่วน ECS task ที่ใช้ network mode `awsvpc` จะได้ network interface และ private IP address ของตัวเอง ทำให้ security group มีผลราย task และ target group ของ ALB ก็ใช้ target type `ip` ส่วน RDS DB subnet group ต้องมี subnet อย่างน้อยสอง zone

### Route table

subnet แต่ละตัวผูกกับ route table ตัวเดียวพอดี จะเป็น main route table ของ VPC หรือตัวที่สร้างเองก็ได้ และ table หนึ่งใช้กับหลาย subnet ได้ ทุก table มี route **local** สำหรับช่วง address ของ VPC เอง ทำให้ทุก subnet ถึงกันได้หมด แล้ว security group (และ network ACL ถ้ามี) เป็นตัวตัดสินว่าอะไรผ่านได้ สำหรับแต่ละ packet ตัว route ที่ match และเจาะจงที่สุดจะชนะ (longest prefix match) ส่วน Acme Shop ใช้สี่ table:

| Route table | ผูกกับ | Route |
|---|---|---|
| `rt-public` | public subnet ทั้งสองตัว | `10.0.0.0/16` → local, `0.0.0.0/0` → internet gateway |
| `rt-app-a` | private app subnet, zone a | `10.0.0.0/16` → local, `0.0.0.0/0` → `nat-a`, S3 prefix list `pl-…` → gateway endpoint `vpce-s3` |
| `rt-app-b` | private app subnet, zone b | `10.0.0.0/16` → local, `0.0.0.0/0` → `nat-b`, S3 prefix list `pl-…` → gateway endpoint `vpce-s3` |
| `rt-data` | data subnet ทั้งสองตัว | `10.0.0.0/16` → local |

ชั้น app ต้องมี table ต่อ zone เพราะ default route ของแต่ละ zone ชี้ไปที่ NAT gateway ของ zone ตัวเอง route target แบบอื่นก็มี transit gateway, peering connection, virtual private gateway และ network interface (เช่นของ firewall appliance) ส่วน route table ที่ผูกกับตัว internet gateway เอง ที่เรียกว่า gateway route table ใช้ส่ง traffic ขาเข้าผ่าน appliance แบบนี้ก่อนที่มันจะไปถึง subnet ได้

### Internet gateway และ NAT gateway

**internet gateway** ถูก attach กับ VPC (หนึ่งตัวต่อ VPC) AWS บอกว่ามัน scale ในแนวนอน มีตัวสำรอง และ highly available ทำให้มันไม่ใช่ทั้งคอขวดของ bandwidth และไม่ใช่ single point of failure สำหรับ IPv4 มันทำ NAT แบบหนึ่งต่อหนึ่งระหว่าง private address ของ resource กับ public หรือ Elastic IP address ของมัน ตัว gateway ไม่เสียเงิน ส่วน data transfer คิดเงินตามปกติ

**NAT gateway** ให้ resource ใน private subnet เปิด connection ออกไปข้างนอกได้ โดยที่ไม่มีอะไรข้างนอกเปิด connection เข้ามาหามันได้ ตัว public NAT gateway อยู่ใน public subnet และมี Elastic IP address มันเปลี่ยน source address ของ packet ขาออกเป็น private address ของตัวเอง แล้ว internet gateway ก็ map address นั้นเป็น Elastic IP ส่วน reply ก็ถูกแปลงกลับตอนขาเข้า ทำให้ payment API เห็นแค่ Elastic IP ของ nat-b เท่านั้น ขีดจำกัดตามเอกสาร (ตุลาคม 2026): 5 Gbps ที่ scale เองได้ถึง 100 Gbps, 1 ล้าน packet ต่อวินาที scale ได้ถึง 10 ล้าน และ 55,000 connection พร้อมกันไปยังแต่ละปลายทางที่ไม่ซ้ำกัน (address, port และ protocol) ต่อ IP address ถ้าจะเพิ่มก็เพิ่ม address ได้ถึง 8 ตัวต่อ gateway (ค่าตั้งต้นคือ Elastic IP 2 ตัว) มันรองรับ TCP, UDP และ ICMP เรา attach security group ให้มันไม่ได้ แต่ network ACL ของ subnet ที่มันอยู่มีผล ส่วน NAT gateway แบบ **private** ไม่มี Elastic IP: มันแปลง traffic ที่ไป VPC อื่นหรือไป network on-premises ผ่าน transit gateway หรือ virtual private gateway วิธีนี้ช่วยได้ตอนที่ network สองวงที่ช่วง address ทับกันต้องคุยกัน

โดยค่าตั้งต้น NAT gateway เป็นแบบ **zonal**: สร้างแบบมีตัวสำรองไว้ใน Availability Zone เดียว แต่ถ้า zone นั้นล่ม ทุก subnet ที่ route ผ่านมันก็จะออก internet ไม่ได้ เพราะแบบนี้ Acme Shop เลยรัน NAT gateway zone ละหนึ่งตัว โดยมี route table ต่อ zone ที่ชี้ไปหามัน ตอนนี้เอกสารยังพูดถึง availability mode แบบ **regional** (`--availability-mode regional`) ด้วย: NAT gateway ID เดียวที่ขยายไปทุก zone ที่ VPC มี network interface อยู่ (zone ใหม่อาจใช้เวลาถึง 60 นาที) ไม่ต้องมี public subnet มี route table ของตัวเองที่ชี้ไปที่ internet gateway และรองรับได้ถึง 32 IP address ต่อ zone แทนที่จะเป็น 8 ส่วนเรื่องเงิน มันคิดตามแต่ละ zone ที่มันรันอยู่ และทำ private NAT ไม่ได้

ส่วน IPv6 ตัว NAT64 บน NAT gateway ทำงานคู่กับ DNS64 ใน [Route 53](../amazon-route-53/) VPC Resolver ทำให้ workload ที่มีแค่ IPv6 เข้าถึง service ที่เป็น IPv4 ได้

### Security group และ network ACL

firewall สองตัวทำงานกันคนละระดับ:

| | Security group | Network ACL |
|---|---|---|
| ใช้กับ | network interface: instance, task, load balancer, endpoint | subnet ทั้ง subnet ที่ขอบของมัน |
| Rule | allow อย่างเดียว | allow และ deny มีเลขกำกับตั้งแต่ 1 ถึง 32766 |
| การประเมิน | ดูทุก rule | ดูตามลำดับเลข ตัวแรกที่ match เป็นตัวตัดสิน |
| traffic ขากลับ | ผ่านให้เอง (stateful) | ต้องมี rule ของตัวเอง (stateless) |
| rule อ้างถึงได้ | ช่วง address, prefix list, security group อื่น | ช่วง address เท่านั้น |
| ค่าตั้งต้น | group ใหม่ไม่ยอมให้อะไรเข้า และยอมให้ออกได้ทั้งหมด | default ACL ยอมทุกอย่าง ส่วน custom ACL ที่สร้างใหม่ปฏิเสธทุกอย่าง |
| quota ตั้งต้น (ตุลาคม 2026) | rule ขาเข้า 60 และขาออก 60 ตัวต่อ group, 5 group ต่อ network interface (ได้ถึง 16 และผลคูณต้องไม่เกิน 1,000) | rule ขาเข้า 20 และขาออก 20 ตัว (ได้ถึง 40) |

security group ของ Acme Shop ต่อกันเป็นสาย:

| Group | Rule ขาเข้า | Attach กับ |
|---|---|---|
| `alb-sg` | TCP 443 จาก `0.0.0.0/0` | ALB |
| `app-sg` | TCP 8080 จาก `alb-sg` | ECS task |
| `db-sg` | TCP 5432 จาก `app-sg` | RDS instance |

rule ที่ source เป็น security group อื่นจะยอมให้ traffic จากทุก network interface ที่มี group นั้นเข้ามาได้ ทำให้ task ใหม่ผ่านได้ทันทีที่มันเริ่ม โดยไม่ต้องแก้ rule และ database ก็ยังเข้าจาก public subnet ไม่ได้ ถึงแม้ local route จะต่อทุก subnet ไว้ถึงกันก็ตาม security group ยังอ้างถึงได้จาก VPC ที่ peer กันใน Region เดียวกัน ส่วน firewall ทั้งสองตัวไม่กรอง traffic ที่ไปหา Amazon DNS server, DHCP, instance metadata หรือ Amazon Time Sync Service

AWS แนะนำให้ใช้ security group เป็นตัวคุมหลัก และใช้ network ACL เป็นราวกันแบบหยาบ ๆ เช่นปฏิเสธช่วง address หนึ่งทั้ง subnet หรือเป็นชั้นที่สองเผื่อ resource ถูก launch ไปพร้อม group ที่ผิด เพราะ ACL เป็น stateless เลยต้องยอมให้ reply ผ่านด้วย ตัว Elastic Load Balancing ต่อไปหา target จาก port 1024 ถึง 65535 ทำให้ ACL ของ app subnet ต้องยอมให้ traffic ที่ไป port พวกนั้นออกได้ ส่วน NAT gateway ก็ใช้ช่วงเดียวกันนี้กับ connection ที่ออก internet ทำให้ ACL ของ public subnet ที่มันอยู่ต้องยอมให้ reply เข้ามาได้

### VPC endpoint และ AWS PrivateLink

traffic ที่ไป AWS service ไม่ต้องผ่าน NAT gateway ก็ได้:

- **Gateway endpoint** มีแค่สำหรับ S3 และ [DynamoDB](../amazon-dynamodb/) พอสร้างแล้วมันจะเพิ่ม route ลงใน route table ที่เราเลือก โดยมีปลายทางเป็น prefix list ของ service (`pl-…`) และเพราะมันเจาะจงกว่า `0.0.0.0/0` ทำให้ traffic ที่ไป S3 ใน Region เดียวกันไปทาง endpoint แทน NAT gateway ตัว gateway endpoint ไม่เสียเงิน แต่ใช้ได้แค่กับ subnet ของ VPC ตัวเอง: ไม่ใช้กับ VPC ที่ peer กัน, transit gateway, VPN หรือ Direct Connect และไม่ใช้กับ bucket ใน Region อื่น พอเป็นแบบนี้ S3 จะเห็น private address ของ task ทำให้ bucket policy ต้องใช้ `aws:SourceVpce` หรือ `aws:VpcSourceIp` แทน `aws:SourceIp` การสร้างหรือแก้ endpoint จะ reset connection ที่เปิดอยู่กับ S3 ส่วน quota ตั้งต้นคือ 20 gateway endpoint ต่อ Region
- **Interface endpoint** (AWS PrivateLink) วาง network interface ที่มี private IP address ไว้ใน subnet หนึ่งตัวของแต่ละ zone ที่เราเลือก โดยมี security group คุ้มกัน ถ้าเปิด private DNS (ต้องเปิด DNS attribute ทั้งสองตัวของ VPC) ชื่อปกติของ service จะ resolve เป็น address พวกนี้ มันเข้าถึง AWS service ได้เกือบทุกตัว service ของเราเองที่ publish เป็น endpoint service และ SaaS ของ partner และใช้ได้จาก VPC ที่ peer กันและผ่าน VPN กับ Direct Connect ด้วย ใน us-east-1 (ตุลาคม 2026) แต่ละตัวคิด $0.01 ต่อ zone ต่อชั่วโมง บวก $0.01 ต่อ GB ที่ process สำหรับ petabyte แรก ส่วน endpoint แบบใหม่ ๆ เข้าถึง resource ตัวเดียวได้ เช่น database ใน VPC อื่น หรือเข้าถึง VPC Lattice service network

pattern [private endpoints](../private-endpoints/) อธิบายแนวคิดนี้แบบทั่วไป

### ต่อ VPC และ network on-premises

| ตัวเลือก | ต่ออะไร | ควรรู้ (ราคา us-east-1, ตุลาคม 2026) |
|---|---|---|
| VPC peering | VPC สองตัว ข้าม account และ Region ได้ด้วย | ไม่มี transitive routing และช่วง address ห้ามทับกัน สร้างได้ฟรี ส่วน traffic ที่อยู่ใน zone เดียวกันก็ฟรี แต่ข้าม zone หรือข้าม Region คิดเงิน |
| AWS Transit Gateway | VPC หลายตัว, VPN connection, Direct Connect gateway และ transit gateway อื่น | hub ระดับ Region ที่มี route table ของตัวเอง คิด $0.05 ต่อ attachment-hour บวก $0.02 ต่อ GB ที่ process |
| AWS Cloud WAN | VPC และ site ข้าม Region | wide-area network แบบ managed ที่นิยามด้วย policy กลางตัวเดียว (core network ที่มี segment) |
| Amazon VPC Lattice | service และ resource ข้าม VPC และ account | networking ที่ชั้น application: service network ที่มี auth policy และรองรับช่วง address ที่ทับกัน |
| AWS Site-to-Site VPN | ออฟฟิศหรือ data centre ผ่าน internet | IPsec tunnel สองเส้นต่อ connection เพื่อสำรองกัน เส้นละได้ถึง 1.25 Gbps (tunnel แบบ bandwidth สูงได้ถึง 5 Gbps บน Transit Gateway หรือ Cloud WAN) คิด $0.05 ต่อ connection-hour |
| AWS Direct Connect | data centre ผ่านสายส่วนตัว | port เฉพาะขนาด 1, 10, 100 หรือ 400 Gbps ตัว private virtual interface เข้าถึง VPC หรือ Direct Connect gateway ส่วน transit virtual interface เข้าถึง transit gateway |

diagram ของ Acme Shop ต่อ VPC อื่นและออฟฟิศเข้ากับ Transit Gateway ตัวเดียว เป็น layout แบบ [hub-and-spoke](../hub-spoke-network/) ที่ใช้กันทั่วไป คำแนะนำเรื่อง multi-VPC ของ AWS ยังใช้ hub เป็นทางออกร่วมด้วย: NAT gateway ใน egress VPC ตัวเดียวให้บริการทุก spoke ผ่าน Transit Gateway หรือ Cloud WAN วิธีนี้ประหยัด NAT gateway แต่เพิ่มค่า process ต่อ GB ของ hub เข้ามา ส่วน peering connection ทำแบบนี้ไม่ได้ เพราะ route traffic ผ่านมันไปหา NAT gateway ไม่ได้

### DNS ใน VPC

ทุก VPC มี resolver มาให้ คือ **Route 53 VPC Resolver** เดิมมันชื่อ Route 53 Resolver จนกระทั่งมี Route 53 Global Resolver ออกมา มันตอบที่ address ฐานของช่วงหลักของ VPC บวกสอง (ในที่นี้คือ `10.0.0.2`) และที่ `169.254.169.253` สำหรับชื่อ public, hostname ที่ AWS ให้มาภายใน VPC และ Route 53 private hosted zone ที่ผูกกับ VPC แล้วก็มี VPC attribute สองตัวที่คุมมัน: `enableDnsSupport` (เปิดเป็นค่าตั้งต้น) และ `enableDnsHostnames` (ปิดเป็นค่าตั้งต้น ยกเว้นใน default VPC) ส่วน private hosted zone ต้องเปิดทั้งสองตัว ใน hybrid network ตัว Resolver endpoint ขาเข้าและขาออกที่มี forwarding rule จะ resolve ชื่อได้ทั้งสองทางระหว่าง VPC กับออฟฟิศ และ Route 53 Resolver DNS Firewall ก็กรอง query ได้ ส่วน network interface แต่ละตัวส่ง packet ไปหา resolver ได้ไม่เกิน 1,024 packet ต่อวินาที

### VPC Flow Logs

flow log บันทึก metadata ของ IP traffic โดยไม่เคยเก็บ payload ทำได้ทั้ง VPC, subnet หรือ network interface ตัวเดียว record ตั้งต้นมี version, account, interface, address และ port ต้นทางกับปลายทาง, protocol, จำนวน packet, byte, เวลาเริ่มและจบ, action (`ACCEPT` หรือ `REJECT`) และ log status เราเลือกได้ว่าจะเก็บ traffic ที่ accept, ที่ reject หรือทั้งหมด แล้ว publish ไปที่ [CloudWatch](../amazon-cloudwatch/) Logs, Amazon S3 หรือ Amazon Data Firehose ตัว record หนึ่งครอบคลุม aggregation interval ได้ถึง 10 นาทีเป็นค่าตั้งต้น หรือ 1 นาทีถ้าเราเลือก (บน Nitro instance จะเป็น 1 นาทีหรือน้อยกว่าเสมอ) และปกติใช้เวลาส่งราว 5 นาทีไป CloudWatch Logs และราว 10 นาทีไป S3 แบบ best-effort ทำให้ flow log เป็นเครื่องมือสำหรับ troubleshoot และ audit ไม่ใช่สำหรับหยุด traffic ตอนที่มันกำลังเกิด มันถูกเก็บนอกเส้นทางของ traffic เลยไม่ทำให้ traffic ช้าลง ส่วนเราจ่ายค่า vended log ตามปลายทาง ถ้าเห็น record `REJECT` ของ port 5432 ติดกันเป็นชุด ก็แปลว่า security group หรือ ACL กำลังทำงานของมันอยู่

### Block Public Access

VPC Block Public Access (BPA) คือ setting ระดับทั้ง account ต่อ Region ที่มีผลเหนือ route และ security group โหมด **bidirectional** บล็อก traffic ทั้งหมดที่ผ่าน internet gateway และ egress-only internet gateway ส่วนโหมด **ingress-only** บล็อก traffic ที่เข้ามาจาก internet แต่ยังยอมให้ connection ออกไปผ่าน NAT gateway และ egress-only internet gateway ได้ exclusion ใช้ยกเว้น VPC หรือ subnet เป็นตัว ๆ (ค่าตั้งต้น 50 ตัวต่อ account ต่อ Region) ส่วน private connectivity อย่าง transit gateway, Site-to-Site VPN และ Cloud WAN ไม่โดนผลกระทบ ส่วน Acme Shop เปิดโหมด ingress-only แล้วยกเว้น public subnet สองตัวของตัวเองได้ โดย AWS บอกไว้ว่า load balancer ที่มี subnet ถูกยกเว้นแม้แค่ตัวเดียว ก็ยังรับ public traffic และส่งต่อให้ target ใน subnet ที่ไม่ได้ถูกยกเว้นได้

### รอดตอน zone ล่ม

VPC และ route table ของมันครอบคลุมทั้ง Region และ AWS รัน internet gateway เป็น component ที่มีตัวสำรองและ scale ในแนวนอน ส่วน subnet และทุกอย่างที่วางไว้ในมันเป็นของ zone เดียว reliability pillar ของ AWS Well-Architected ขอให้ทุก workload ที่รัน production อยู่ในอย่างน้อยสอง Availability Zone และ VPC ก็คือจุดที่เราวางเรื่องนี้: แต่ละชั้นมี subnet ในทุก zone และแต่ละ zone มี node ของ ALB, NAT gateway และ task เป็นของตัวเอง พอ zone a ล่ม ALB จะส่ง request ไปแค่ target ที่ healthy และโดยค่าตั้งต้นมันก็จะเลิกตอบ DNS ด้วย address ของ zone ที่ไม่เหลือ target ที่ healthy แล้วด้วย ส่วน RDS ก็ failover ไปที่ standby แบบ synchronous ใน zone b ปกติใช้เวลา 60 ถึง 120 วินาที แล้วย้ายชื่อ DNS ของ database ไปที่มัน ทำให้ application ต้อง reconnect และต้องไม่ cache คำตอบ DNS ไว้นาน ตัว ECS service จะเริ่ม task ทดแทนใน zone ที่ยังใช้ได้ และตั้งแต่กันยายน 2025 ECS ก็ rebalance service ที่เข้าเงื่อนไขกระจายข้าม zone ให้ เมื่อ zone ที่ล่มกลับมาแล้ว

## อยู่ตรงไหนใน solution

- **Solution** แทบทุกอย่างบน AWS ที่ไม่ได้เป็นแค่การเรียก API ล้วน ๆ จะรันอยู่ใน VPC: EC2 instance, container ของ ECS และ EKS, database RDS และ Aurora, ElastiCache ([Redis และ Valkey](../redis/)), [OpenSearch](../elasticsearch/) domain ที่เข้าถึงผ่าน VPC, MSK cluster และ Lambda function เมื่อ attach กับ private subnet แล้ว ([AWS Lambda](../aws-lambda/)) layout สามชั้นสอง zone ของ Acme Shop คือจุดเริ่มต้นปกติของ web application
- **Pattern ใน catalog นี้** VPC คือที่ที่เราสร้าง network pattern หลายตัว: [hub-and-spoke network](../hub-spoke-network/) ด้วย Transit Gateway หรือ Cloud WAN, [private endpoints](../private-endpoints/) ด้วย PrivateLink และ gateway endpoint และ [load balancing](../load-balancing/) ข้าม zone ด้วย ALB ส่วน security group, ACL และ Block Public Access เป็นชั้นหนึ่งของ [zero trust access](../zero-trust-access/): มันจำกัดว่า network ไหนคุยกันได้ แต่ identity และ authorisation ก็ยังต้องตรวจทุก request ถ้าข้าม Region ตัว [active-passive failover](../active-passive-failover/) และ [multi-Region active-active](../multi-region-active-active/) ต้องมี VPC ในทุก Region โดยช่วง address ไม่ทับกัน
- **เพื่อนบ้านที่มักเจอ** Elastic Load Balancing, Amazon ECS และ EKS, Amazon RDS ([PostgreSQL](../postgresql/)), [Amazon S3](../amazon-s3/) และ DynamoDB ผ่าน gateway endpoint, Route 53 สำหรับ DNS ทั้ง public และ private, [AWS IAM](../aws-iam/) (ใครแก้ security group และ route ได้บ้าง), CloudWatch สำหรับ flow log และ metric และ AWS Network Firewall ตอนที่ subnet ต้องตรวจละเอียดกว่านั้น
- **Managed offering** Amazon VPC เองก็คือ managed service และทุก AWS account มี default VPC ในทุก Region: มี public subnet ในทุก zone, internet gateway และเปิด DNS ไว้ เหมาะกับการทดลอง ส่วน workload ที่รัน production ปกติจะมี VPC ของตัวเองที่วางแผน address มาอย่างตั้งใจ บน cloud เจ้าอื่นตัวที่เทียบได้คือ Azure Virtual Network และ Google Cloud VPC

## ใช้ตอนไหนดี

workload บน AWS ทุกตัวที่รัน server, container หรือ database ของตัวเองจะใช้ VPC เรื่องที่ต้องตัดสินใจจริง ๆ คือจะมีกี่ VPC และจะวางแต่ละตัวยังไง การมี VPC หนึ่งตัวต่อ application และ environment บ่อยครั้งแยกไว้ใน account ของตัวเอง ทำให้ blast radius เล็ก แล้ว Transit Gateway หรือ Cloud WAN ก็ต่อตัวที่ต้องคุยกันเข้าด้วยกัน ส่วน VPC Lattice หรือ PrivateLink ก็ต่อ service เป็นตัว ๆ ได้โดยไม่ต้องรวม network ทั้งวง ภายใน VPC ให้ใช้ public subnet เฉพาะกับสิ่งที่ internet ต้องเข้าถึง วางทุกชั้นไว้ในทุก zone และตัดสินใจแต่เนิ่น ๆ ว่า network ของบริษัทจะใช้ช่วง address ไหน

service ที่ไม่เคยแตะ network ของเรา (S3, DynamoDB, [SQS](../amazon-sqs/) หรือ Lambda ที่ไม่ได้ attach กับ VPC) ไม่ต้องใช้ VPC ส่วนถ้าจะเข้าถึงมันจากใน VPC ก็ใช้ endpoint

| | Amazon VPC | Azure Virtual Network | Google Cloud VPC |
|---|---|---|---|
| ขอบเขตของ network | Region เดียว | region เดียว | global: network เดียวครอบทุก region |
| ขอบเขตของ subnet | Availability Zone เดียว | ทั้ง region: virtual network และ subnet ครอบทุก zone | region เดียว ข้าม zone ใน region นั้น |
| address ที่ถูกกันไว้ต่อ subnet | 5 | 5 | 4 ในช่วง IPv4 หลัก |
| Firewall | security group (stateful ต่อ interface) และ network ACL (stateless ต่อ subnet) | network security group (stateful บน subnet หรือ network interface) และ application security group | VPC firewall rule และ policy ของ Cloud NGFW (stateful บังคับใช้ที่ VM แต่ละตัว) |
| private subnet ออก internet ผ่าน | NAT gateway (zonal หรือ regional) | NAT Gateway โดย virtual network ใหม่จะได้ private subnet เป็นค่าตั้งต้นเมื่อใช้ API version ที่ออกหลัง 31 มีนาคม 2026 | Cloud NAT |
| เข้าถึง service ของผู้ให้บริการแบบ private | gateway endpoint (S3, DynamoDB) และ interface endpoint (PrivateLink) | service endpoint และ Private Link (private endpoint) | Private Google Access และ Private Service Connect |
| ต่อ network เข้าหากัน | VPC peering, Transit Gateway, Cloud WAN, VPC Lattice | virtual network peering (ข้าม region ได้ด้วย), Virtual WAN | VPC Network Peering, Network Connectivity Center, Shared VPC |

ความต่างเชิงโครงสร้างที่ใหญ่ที่สุดคือขอบเขต Google Cloud VPC เป็น network แบบ global ผืนเดียว ทำให้ application ที่รันหลาย region ไม่ต้อง peer ระหว่าง region เลย ส่วน AWS VPC จบที่ Region และ subnet จบที่ zone ทำให้ต้องระบุ zone ให้ชัดในทุก subnet ที่สร้าง

## ได้อะไร เสียอะไร

- **ค่าใช้จ่ายซ่อนอยู่ในท่อ** (us-east-1, ตุลาคม 2026) VPC ฟรี แต่ NAT gateway คิด $0.045 ต่อชั่วโมง (ราว $32.85 ต่อเดือน ทำให้สอง zone ตกราว $65.70 ก่อนจะมี traffic เลย) บวก $0.045 ต่อ GB ที่ process นอกเหนือจาก data transfer ปกติ ส่วน traffic ระหว่าง zone คิด $0.01 ต่อ GB ในแต่ละทิศ ทำให้ task ที่ใช้ NAT gateway ของอีก zone ต้องจ่ายค่าข้าม zone เพิ่มจากค่า process ของ NAT ส่วน public IPv4 address ทุกตัวคิด $0.005 ต่อชั่วโมง (ราว $3.65 ต่อเดือน) ไม่ว่าจะใช้อยู่หรือว่าง ตัว interface endpoint คิด $0.01 ต่อ zone ต่อชั่วโมง และ attachment ของ Transit Gateway ตัวละ $0.05 ต่อชั่วโมง ส่วน gateway endpoint ของ S3 และ DynamoDB ฟรี และตัดค่า process ของ NAT สำหรับ traffic นั้นออกไป
- **ความทนทานคิดเงินราย zone** NAT gateway zone ละตัวทำให้ค่ารายชั่วโมงเพิ่มเป็นสองเท่า การใช้ตัวเดียวร่วมกันประหยัดเงินได้ แต่ผูกทางออกของทุก zone ไว้กับ zone เดียว และเพิ่มค่าข้าม zone ส่วน regional NAT gateway ตัดงานเรื่อง routing ออกไป แต่ก็ยังคิดเงินราย zone
- **แผน address แก้ยาก** block เปลี่ยนขนาดไม่ได้ ช่วงที่ทับกัน peer กันไม่ได้ และ subnet ที่เล็กเกินไปก็ address หมด: AWS กันไว้ 5 address ต่อ subnet, ALB ต้องมี address ว่าง 8 ตัวเพื่อ scale และทุก task, Lambda network interface และ endpoint ก็กิน address ด้วย secondary block และ IPAM ช่วยได้ แต่การเปลี่ยนเลข address ของ network ที่รันอยู่คืองาน migration
- **Quota กำหนดหน้าตาของ design** 5 VPC ต่อ Region, 200 subnet ต่อ VPC และ security group ที่มี rule ขาเข้า 60 และขาออก 60 ตัวโดยมี 5 group ต่อ interface เป็นค่าตั้งต้นที่ขอเพิ่มได้ แต่จำนวน rule มันคูณกัน: prefix list ที่ rule อ้างถึงนับเป็นจำนวน entry สูงสุดของมัน
- **network rule ไม่ใช่ identity** security group รู้จัก address, port และ group อื่น ไม่รู้จัก user หรือ service มันจำกัดได้ว่าใครต่อเข้ามาได้ แต่ process ไหนก็ได้บน task ที่อยู่ใน `app-sg` ยังเข้าถึง database ได้ ทำให้ authentication และ authorisation ต้องทำในชั้นที่อยู่เหนือ network
- **Stateless ACL พลาดง่าย** ถ้าขาด rule สำหรับ ephemeral port ของ reply ตัว traffic จะพังแค่ทิศเดียว และแบบนี้หาสาเหตุได้ช้า คำแนะนำของ AWS เองให้ security group เป็นตัวคุมหลัก และให้ ACL เป็นชั้นเสริมที่จะมีหรือไม่ก็ได้
- **มองเห็นได้ช้า** flow log มาถึงหลังเกิดเหตุหลายนาทีและไม่มี payload ถ้าจะดูเนื้อใน packet ตัว Traffic Mirroring จะ copy traffic ของ network interface ไปให้ appliance ที่คอย monitor

## ข้อควรรู้ตอนลงมือทำ

**ต่อ security group เป็นสาย และ route แต่ละ zone ไปที่ NAT gateway ของตัวเอง** ID ทั้งหลายเป็น shell variable ที่ต้องใส่ค่าเอง ส่วน S3 endpoint จะถูกสร้างเป็น gateway endpoint โดยค่าตั้งต้น:

```sh
# app-sg admits 8080 only from alb-sg; db-sg admits 5432 only from app-sg
aws ec2 authorize-security-group-ingress --group-id "$APP_SG" \
  --protocol tcp --port 8080 --source-group "$ALB_SG"
aws ec2 authorize-security-group-ingress --group-id "$DB_SG" \
  --protocol tcp --port 5432 --source-group "$APP_SG"

# zone b's app subnet sends internet-bound traffic to the NAT gateway in zone b
aws ec2 create-route --route-table-id "$RT_APP_B" \
  --destination-cidr-block 0.0.0.0/0 --nat-gateway-id "$NAT_B"

# the S3 gateway endpoint adds a prefix-list route to both app route tables
aws ec2 create-vpc-endpoint --vpc-id "$VPC_ID" \
  --service-name com.amazonaws.us-east-1.s3 \
  --route-table-ids "$RT_APP_A" "$RT_APP_B"

# flow logs for the whole VPC, accepted and rejected traffic, to CloudWatch Logs
aws ec2 create-flow-logs --resource-type VPC --resource-ids "$VPC_ID" \
  --traffic-type ALL --log-destination-type cloud-watch-logs \
  --log-group-name acme-shop-vpc-flow-logs \
  --deliver-logs-permission-arn "$FLOW_LOGS_ROLE_ARN"
```

ถ้าใช้ regional NAT gateway ตัว route ราย zone จะยุบเหลือตัวเดียว: `aws ec2 create-nat-gateway --vpc-id "$VPC_ID" --availability-mode regional` สร้างมันขึ้นมา แล้วทุก app subnet ก็ใช้ route table ร่วมกันตัวเดียวที่ชี้ไปที่ ID เดียวของมันได้

- **นิยาม network เป็นโค้ด** CloudFormation, CDK หรือ Terraform ทำให้ subnet, route table และ security group ถูก review ได้ ส่วน route ที่แก้ด้วยมือใน console จะไม่ทิ้งร่องรอยการ review ไว้เลย
- **ตั้งขนาด subnet เผื่อโต** /24 ให้ 251 address ส่วน load balancer, NAT gateway, interface endpoint, ECS task และ Lambda interface ล้วนกิน address จาก subnet ที่มันใช้ เพราะฉะนั้นเผื่อที่ไว้ และเก็บพื้นที่ว่างในช่วงของ VPC ไว้สำหรับ subnet ที่จะเพิ่มทีหลัง
- **ให้ traffic ที่ไป AWS ไม่ผ่าน NAT gateway** เพิ่ม gateway endpoint ฟรีของ S3 และ DynamoDB ก่อน ส่วน service ที่ใช้หนัก ๆ จาก private subnet (container image, log, secret) ให้เทียบ $0.01 ต่อ GB ของ interface endpoint บวกค่ารายชั่วโมงในแต่ละ zone กับ $0.045 ต่อ GB ของ NAT gateway (us-east-1)
- **อ้างถึง group ไม่ใช่ address** rule อย่าง "8080 จาก `alb-sg`" อยู่รอดผ่านการ scale และการ redeploy ส่วน rule ที่ใช้ IP address ของ task ไม่รอด
- **เช็กเส้นทางก่อนไล่ debug packet** Reachability Analyzer ทดสอบจาก configuration อย่างเดียวว่า source ไปถึง destination ได้ไหม และบอกชื่อ component ที่บล็อกอยู่: route, security group หรือ ACL
- **เปิด flow log ตั้งแต่แรก** เพื่อให้มี record อยู่แล้วตอนที่อะไรสักอย่างโดนบล็อก แล้ว Amazon Athena ก็ query มันใน S3 ได้
