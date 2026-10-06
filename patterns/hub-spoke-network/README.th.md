## ปัญหา

ระบบบน cloud มักโตขึ้นทีละ workload และแต่ละ workload team ก็สร้าง network edge ที่ตัวเองต้องใช้: firewall หรือ network virtual appliance (NVA), VPN gateway หรือ dedicated circuit กลับไปที่ data centre, NAT หรือ internet gateway, DNS forwarder สำหรับชื่อฝั่ง on-premises และ jump host ให้ผู้ดูแลระบบ พอถึงชุดที่สาม ต้นทุนก็เริ่มเห็นชัด:

- **ทุกอย่างถูกซื้อและดูแลซ้ำหลายชุด** firewall กับ VPN gateway คิดเงินเป็นรายชั่วโมงไม่ว่าจะมี traffic วิ่งผ่านหรือไม่ แล้วทุกชุดก็ต้อง patch, monitor และตั้งค่า tunnel ฝั่ง on-premises แยกกัน
- **policy ค่อย ๆ เพี้ยนไปคนละทาง** firewall แต่ละตัวมีชุด rule และ log ของตัวเอง เลยไม่มีใครตอบได้จากที่เดียวว่า "อะไรออก internet ได้บ้าง" หรือ "Dev เข้าถึงข้อมูล production ได้ไหม"
- **ช่วง address ชนกัน** แต่ละทีมเลือกช่วง address เอง หรือก็อปจาก template มา สุดท้ายก็มีสอง network ที่ได้ช่วงเดียวกัน Azure, AWS และ Google Cloud ทั้งสามเจ้าไม่ยอมให้ peer network ที่ช่วง address ทับกัน และ AWS ก็บอกไว้ว่า transit gateway ของตัวเอง route ระหว่าง VPC ที่ทับกันไม่ได้เหมือนกัน ทางที่เหลือคือเปลี่ยนเลข address ของ network ที่ใช้งานอยู่ หรือเอาการแปลง address มาคั่นไว้กลางทาง

## ทำงานยังไง

network ที่เป็น **hub** เก็บทุกอย่างที่ใช้ร่วมกัน แล้วแต่ละ workload ก็ได้ network ที่เป็น **spoke** ของตัวเอง ตัว spoke ต่อเข้ากับ hub และไม่ต่อกับอะไรอื่นเลย:

1. **hub** เก็บ edge ที่ใช้ร่วมกัน: firewall, gateway ไป on-premises, DNS resolution และช่องทางเข้าไปดูแลระบบ โดยมี platform team ส่วนกลางเป็นเจ้าของ
2. **spoke แต่ละตัว** เก็บหนึ่ง workload หรือหนึ่ง environment ของ workload นั้น และเป็นของ workload team นั้น ช่วง address มาจาก plan เดียวกัน เลยไม่มีอะไรทับกัน
3. **route ในทุก spoke** ส่ง traffic ที่ออกจาก spoke (ไป internet, ไป spoke อื่น หรือไป on-premises) ไปที่ firewall ของ hub ตัว firewall ใช้ชุด rule ชุดเดียวและเก็บ log ที่เดียว ส่วน spoke ใช้ gateway ของ hub เพื่อไปถึง on-premises และใช้ resolver ของ hub เพื่อ resolve ชื่อ
4. **workload ใหม่** ได้ spoke จาก template และ connection ไปที่ hub หนึ่งเส้น ตัว hub เลยกลายเป็นสิ่งที่ต้อง scale, ป้องกัน และตั้งงบไว้ให้

### topology บนแต่ละ cloud

- **Azure** [hub-spoke reference architecture](https://learn.microsoft.com/en-us/azure/architecture/networking/architecture/hub-spoke) วาง Azure Firewall, VPN หรือ ExpressRoute gateway และ Azure Bastion ไว้ใน hub virtual network แล้ว peer spoke virtual network แต่ละตัวเข้ากับ hub และส่ง log ของ hub ไปที่ Azure Monitor ส่วน Cloud Adoption Framework [อธิบาย topology ไว้สองแบบ](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/define-an-azure-network-topology): hub and spoke แบบ "traditional" นี้ที่เราสร้างและ route เอง กับแบบที่สร้างบน **Azure Virtual WAN** ที่ Microsoft ดูแล hub ให้ ส่วน Azure landing zone แบ่งความเป็นเจ้าของแบบเดียวกับใน diagram: platform team ดูแล hub จาก connectivity subscription ส่วน spoke อยู่ใน subscription ของแต่ละ workload เอง
- **AWS** hub คือ **AWS Transit Gateway** ตัวนี้เป็น router ระดับ region ที่ VPC, VPN connection และ Direct Connect gateway มา attach ด้วย แล้ว route table ของมันก็เป็นตัวตัดสินว่า attachment ไหนคุยกับ attachment ไหนได้ ส่วน whitepaper [*Building a Scalable and Secure Multi-VPC AWS Network Infrastructure*](https://docs.aws.amazon.com/whitepapers/latest/building-scalable-secure-multi-vpc-network-infrastructure/welcome.html) เพิ่ม VPC ส่วนกลางรอบ ๆ มัน: egress VPC ที่มี NAT gateway สำหรับ [การออก internet แบบรวมศูนย์](https://docs.aws.amazon.com/whitepapers/latest/building-scalable-secure-multi-vpc-network-infrastructure/centralized-egress-to-internet.html), inspection VPC ที่มี AWS Network Firewall หรือ Gateway Load Balancer สำหรับ [traffic ระหว่าง VPC และไป on-premises](https://docs.aws.amazon.com/whitepapers/latest/building-scalable-secure-multi-vpc-network-infrastructure/centralized-network-security-for-vpc-to-vpc-and-on-premises-to-vpc-traffic.html) และ Route 53 VPC Resolver endpoint ที่ใช้ร่วมกันสำหรับ hybrid DNS ตอนนี้ transit gateway ยัง [attach AWS Network Firewall ได้โดยตรง](https://docs.aws.amazon.com/vpc/latest/tgw/how-transit-gateways-work.html) ด้วย เลยไม่ต้องสร้าง inspection VPC นั้นเอง ส่วน VPC peering ธรรมดาทำ hub แบบนี้ไม่ได้ เพราะมันไม่ transitive และ VPC หนึ่ง [ใช้ของ VPC ที่ peer อยู่ไม่ได้](https://docs.aws.amazon.com/vpc/latest/peering/vpc-peering-basics.html) ทั้ง internet gateway, NAT gateway, VPN connection และ Direct Connect link
- **Google Cloud** [hub-and-spoke network architecture](https://docs.cloud.google.com/architecture/deploy-hub-spoke-vpc-network-topology) ของ Architecture Center ต่อ workload VPC network (spoke) เข้ากับ routing VPC network (hub) ได้สามวิธี: **Network Connectivity Center** (NCC), **VPC Network Peering** หรือ **Cloud VPN** ถ้า spoke ต้องคุยกันผ่านจุด inspection ก็ใช้ NVA หรือ next-generation firewall ใน routing network เป็น gateway ให้ ส่วน **Shared VPC** แก้ปัญหาบางส่วนด้วยอีกวิธี: host project เป็นเจ้าของ network หนึ่งตัว, project อื่น deploy ลงใน subnet ของมัน แล้วทีมส่วนกลางก็คุม network ได้โดยไม่ต้อง peer เลย ส่วน AWS ก็มีไอเดียเดียวกันในชื่อ VPC sharing

### อะไรอยู่ใน hub และอะไรอยู่ใน spoke

hub เก็บสิ่งที่ใช้ร่วมกันและสิ่งที่ต้องมีเจ้าของคนเดียว:

- **firewall หรือ NVA** สำหรับ internet egress, traffic ระหว่าง spoke, traffic เข้าออก on-premises และ traffic ขาเข้า ถ้าเรา publish service ผ่านมัน
- **gateway ไป on-premises:** VPN gateway และ gateway ของ dedicated circuit (ExpressRoute, Direct Connect, Cloud Interconnect)
- **DNS:** resolver ที่มี inbound และ outbound endpoint, forwarding rule สำหรับชื่อฝั่ง on-premises และ private DNS zone ที่ private endpoint ต้องใช้ โดย link เข้ากับทุก spoke แล้ว [Private Endpoints](../private-endpoints/) ก็อธิบายไว้ว่าทำไม zone พวกนี้มักอยู่ใน hub
- **ช่องทางเข้าไปดูแลระบบ:** managed bastion (Azure Bastion เข้าถึง VM ใน spoke ที่ peer อยู่ได้) หรือ jump host ที่ hardened แล้ว
- **monitoring ที่ใช้ร่วมกัน:** firewall log กับ flow log, connection monitor และ dashboard ของ network team

ส่วน spoke เก็บของที่เป็นของ workload เดียว: subnet และเครื่องของมัน, load balancer และ application gateway, security group และ private endpoint ที่มีแค่ workload นั้นใช้ ส่วน route table บน subnet ของ spoke มักถูกตั้งโดย platform team ผ่าน policy เพราะ route ผิดแค่ตัวเดียวก็พา traffic อ้อม firewall ไปเงียบ ๆ ได้

### peering และ transit แยกตาม provider

| | Azure | AWS | Google Cloud |
|---|---|---|---|
| **การต่อ spoke** | [Virtual network peering](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-network-peering-overview) หรือ connectivity configuration ของ Virtual Network Manager | transit gateway attachment ส่วน VPC peering เป็นแบบหนึ่งต่อหนึ่ง | [VPC Network Peering](https://docs.cloud.google.com/vpc/docs/vpc-peering), NCC VPC spoke หรือ Cloud VPN |
| **transitive ไหม** | ไม่เป็น ตัว traffic ระหว่าง spoke ต้องมี route ไปที่ appliance ใน hub หรือมี peering ของตัวเอง | VPC peering: ไม่เป็น ส่วน transit gateway route ระหว่าง attachment ของมันได้ตามที่ route table อนุญาต | Peering: ไม่เป็น ส่วน [NCC VPC spoke](https://docs.cloud.google.com/network-connectivity/docs/network-connectivity-center/concepts/overview) แลก route กันเอง ยกเว้นตอนใช้ star topology ที่กัน edge spoke ไว้ไม่ให้เจอกัน |
| **การใช้ VPN หรือ circuit ของ hub** | *Gateway transit:* peering ฝั่ง hub อนุญาตให้ทำ, peering ฝั่ง spoke แต่ละตัวใช้ remote gateway และ peering ทั้งหมดอนุญาต forwarded traffic ส่วน network ที่ใช้ remote gateway จะมี gateway ของตัวเองไม่ได้ | VPN connection และ Direct Connect gateway attach เข้ากับ transit gateway โดยตรง | hub export custom route ของตัวเอง (ทั้ง static route และ dynamic route ที่ Cloud Router เรียนมาจาก on-premises) แล้ว spoke ก็ import เข้ามา |
| **ช่วง address ที่ทับกัน** | ใช้ไม่ได้ระหว่าง network ที่ peer กัน | ใช้ไม่ได้กับ peering และ transit gateway ก็ route ระหว่าง VPC ที่ทับกันไม่ได้ | ช่วง subnet ทับกันข้าม peering ไม่ได้ |

Cloud VPN เป็นตัวที่ต่างจากเพื่อนในแบบของ Google: มัน transitive และเลี่ยง quota ของ peering ได้ แต่ bandwidth ระหว่าง network ถูกจำกัดไว้เท่าที่ tunnel รับได้

### Routing

- **ชี้ spoke ไปที่ firewall** subnet ของแต่ละ spoke ได้ route table ที่ส่ง `0.0.0.0/0` และช่วง address ของ spoke อื่น (สรุปรวมไว้ตรงนี้เป็น `10.0.0.0/8`) ไปที่ private address ของ firewall ระบบเลือก route ตาม longest prefix ทำให้ช่วง address ของ hub เองยังวิ่งตาม route ที่ peering สร้างไว้ เพราะ route นั้นเจาะจงกว่า แล้ว DNS query กับ bastion session ก็ไปถึง hub ได้ตรง ๆ ตัว default system route ของ Azure [drop traffic ที่ไป private range](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-udr-overview) นอก network ตัวเองและ network ที่ peer อยู่ แล้วการเพิ่ม user-defined route `0.0.0.0/0` ก็ลบ default พวกนั้นทิ้ง บน Azure เลยมักใช้ default route ตัวเดียวก็พอ ส่วนบน AWS route ของ spoke จะชี้ไปที่ transit gateway แทน แล้ว route table ของ transit gateway ก็ส่ง traffic ผ่าน inspection VPC
- **ให้ทั้งสองทิศผ่าน firewall ตัวเดียวกัน** stateful firewall จะ drop reply ของ connection ที่มันไม่เคยเห็น ส่วน traffic จาก on-premises เข้ามาที่ gateway ทำให้บน Azure ต้องเพิ่ม route บน gateway subnet ที่ส่งช่วง address ของ spoke ไปที่ firewall และให้ spoke ส่ง reply กลับทางเดียวกัน: ปิด gateway route propagation บน route table ของ spoke หรือเพิ่ม route ที่ระบุช่วง address ของ on-premises ไว้ตรง ๆ (แถว `192.168.0.0/16` ใน diagram) แบบใน [hybrid firewall tutorial](https://learn.microsoft.com/en-us/azure/firewall/tutorial-hybrid-portal-policy) ของ Microsoft ห้ามปิด propagation บน gateway subnet เด็ดขาด เพราะ gateway จะหยุดทำงาน ส่วนบน AWS ให้เปิด **appliance mode** บน attachment ของ inspection VPC เพื่อให้ flow หนึ่งกับ reply ของมันอยู่ใน Availability Zone เดียวกัน
- **Forced tunnelling** ส่ง traffic ที่จะไป internet ไปที่ next hop อื่น ปกติคือ firewall ฝั่ง on-premises แทนที่จะออกจาก cloud ตรง ๆ ทั้งบริษัทเลยมีทางออกจุดเดียว แลกกับ latency และ bandwidth ฝั่ง on-premises
- **แบ่ง segment ด้วย route ด้วย ไม่ใช่แค่ rule** การแยก route table ของ transit gateway พร้อม blackhole route กันไม่ให้ Dev กับ Prod มีทางไปหากันเลยได้ บน Azure งานนี้เป็นของ firewall policy และ Virtual Network Manager ก็ push user-defined route และ security admin rule ไปที่ spoke ทั้งกลุ่มได้

### การวาง address

- ทำ plan เดียวที่ครอบทั้ง on-premises และทุก cloud region ไม่มีช่วงไหนทับกัน และเผื่อที่ไว้โต ส่วน block แบบลำดับชั้นก็สรุปรวมได้ดี: หนึ่ง block ต่อ region และ `/16` ต่อ spoke แบบใน diagram ถ้าจะใช้ IPv6 หรือ dual stack ให้วางไว้ตั้งแต่ plan ยังใหม่
- จดการแจก address ไว้ในเครื่องมือ ไม่ใช่ใน spreadsheet: IP address management (IPAM) ใน Azure Virtual Network Manager และ Amazon VPC IP Address Manager ต่างก็แจกช่วง address ที่ไม่ทับกันให้
- สรุปรวม route ที่ advertise ไป on-premises ด้วย โดยปกติ Azure gateway ที่เปิด gateway transit จะ advertise ทั้ง hub และทุก spoke ที่ peer อยู่ ส่วน [advertised gateway prefixes](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-network-peering-overview) แทนที่พวกนั้นด้วยช่วงที่สรุปแล้ว
- ถ้าเลี่ยงการทับกันไม่ได้ (ซื้อกิจการมา หรือเป็น network ของ vendor) ก็แปลง address ที่ขอบ network ตัว AWS เองก็มีเอกสารเรื่อง private NAT gateway ไว้สำหรับกรณีนี้โดยเฉพาะ

### คุม egress และ inspect traffic แนว east-west

- **Egress** traffic ไป internet ออกไปด้วย public address ของ firewall (source NAT) partner ที่ allow-list เราไว้เลยต้อง allow ทุก address พวกนั้น การใช้ public prefix ที่ต่อเนื่องกันช่วยให้ list นั้นสั้น บน Azure การวาง NAT gateway ไว้บน subnet ของ firewall เพิ่ม address และ SNAT port ได้ โดยที่ reply ยังวิ่งผ่าน firewall เหมือนเดิม บน AWS ตัว NAT gateway ของ egress VPC ทำงานเดียวกัน จะวางไว้หลัง Network Firewall ด้วยก็ได้ ส่วนแบบอ้างอิงของ Google ให้ทุก network มี Cloud NAT gateway ของตัวเองแทน
- **DNS ที่ตรงกันสำหรับ rule ที่อิงชื่อ** firewall ที่ allow `*.example.com` ต้อง resolve ชื่อแบบเดียวกับที่ workload resolve ไม่อย่างนั้นสองฝั่งจะเห็น address คนละตัว แล้ว traffic ที่ถูกต้องก็โดน block เพราะแบบนี้ Azure ถึงแนะนำให้ส่ง DNS ของ spoke ผ่าน DNS proxy ของ firewall
- **East-west** traffic ระหว่าง spoke ที่วิ่งผ่าน firewall ทำให้ได้ default deny ระหว่าง environment และได้ log ที่เดียว แต่การข้ามแต่ละครั้งเพิ่ม hop, latency และค่า processing ต่อ GB เพราะฉะนั้นสำหรับคู่ที่ไว้ใจกันและ traffic เยอะ (database replication, การก็อปข้อมูลก้อนใหญ่) Azure แนะนำให้ peer ตรงหรือใช้ Private Link โดยให้อยู่ใน environment และ workload เดียวกัน

### การต่อไป on-premises

- gateway ตัวเดียวใน hub (VPN, dedicated circuit หรือทั้งสองแบบ) รับใช้ทุก spoke มันเลยต้อง redundant จริง ๆ: บน Azure ใช้ ExpressRoute ที่มี VPN เป็น failover, บน AWS ใช้ Direct Connect [จากมากกว่าหนึ่ง location](https://docs.aws.amazon.com/whitepapers/latest/building-scalable-secure-multi-vpc-network-infrastructure/direct-connect.html) และมากกว่าหนึ่ง connection, บน Google Cloud ใช้ HA VPN (SLA 99.99% ใน topology ที่รองรับ)
- gateway ยังเป็นเพดานของ throughput ด้วย: Azure บอกไว้ว่า ExpressRoute gateway ตัวเดียวจำกัด throughput รวมและ throughput ต่อ flow ไม่ว่า circuit จะใหญ่แค่ไหน ถ้าเกินนั้นก็ scale out ด้วยการเพิ่ม hub

### มากกว่าหนึ่ง region

บน Azure และ AWS ตัว hub เป็นของระดับ region ระบบที่อยู่หลาย region เลยมี hub หนึ่งตัวต่อ region ส่วน Azure ก็แนะนำให้ต่อแต่ละ spoke เข้ากับ hub ของ region ตัวเองเท่านั้น hub ที่ล่มจะได้ไม่ลาก routing ของ region อื่นที่ไม่เกี่ยวลงไปด้วย จากนั้นก็ต่อ hub เข้าหากัน: บน Azure ใช้ global peering หรือ [Virtual WAN](https://learn.microsoft.com/en-us/azure/virtual-wan/virtual-wan-about) (ที่ hub แบบ Standard ต่อกันเป็น full mesh) และบน AWS ใช้ transit gateway peering หรือ AWS Cloud WAN ส่วนฝั่ง Google Cloud ตัว VPC network กับ NCC hub เป็น global resource แต่ appliance ใน routing network ยังรันอยู่ใน region และ zone ที่เจาะจง เลยต้องวางทีละ region อยู่ดี ส่วน [Multi-Region Active-Active](../multi-region-active-active/) พูดถึงฝั่ง application ไว้

### Managed hub

การสร้าง hub เองแปลว่าต้องดูแล peering, route table และ appliance เอง ทุก provider มีบริการรัน transit routing ให้:

- hub ของ **Azure Virtual WAN** เป็น virtual network ที่ Microsoft ดูแล มี connectivity แบบ transitive ระหว่าง virtual network, branch, VPN user และ ExpressRoute เรารัน Azure Firewall หรือ NVA ของ partner ไว้ใน hub ได้ แล้ว **routing intent** ก็ส่ง internet traffic, private traffic หรือทั้งสองอย่างผ่านมัน ส่วน Azure Virtual Network Manager เป็นทางสายกลาง: มันสร้างและดูแล peering กับ route ของ hub and spoke ที่เราสร้างเองให้ ได้สูงสุด 1,000 spoke ต่อ hub
- **AWS Transit Gateway** เป็น managed hub อยู่แล้ว ส่วน **AWS Cloud WAN** เพิ่ม global network ที่กำหนดด้วย policy ข้าม region
- **Google NCC** ต่อ VPC spoke แบบ mesh หรือ star topology และต่อ hybrid spoke (HA VPN, Interconnect, router appliance) ผ่าน hub ตัวเดียว

เลือก managed hub ถ้ามี spoke, branch หรือ region เยอะ และไม่อยาก route เองทีละตัว ส่วน hub ที่ดูแลเองเหมาะกับตอนที่ต้องใช้ appliance หรือ feature ที่ managed hub ไม่รองรับ หรือตอนที่ค่าบริการของ managed hub แพงกว่างานที่มันช่วยประหยัด Microsoft ยกเรื่องต้นทุน, ข้อจำกัดของ subscription, การแยก workload และความยืดหยุ่นในการเลือก NVA เป็นเหตุผลที่จะดูแลเองต่อ

## ใช้ตอนไหนดี

- **หลาย workload หรือหลาย environment ต้องใช้ shared service ชุดเดียวกัน:** การต่อไป on-premises, egress ที่ควบคุมและเก็บ log ไว้, DNS และช่องทางเข้าไปดูแลระบบ
- **security team ต้องคุมและ log traffic จากที่เดียว:** ทั้งอะไรที่ออกไป internet และอะไรที่ข้ามระหว่าง environment
- **แต่ละทีมเป็นเจ้าของ network ของตัวเอง แต่มีทีมเดียวที่เป็นเจ้าของ connectivity** แบบใน landing zone
- **Stamp และ cell** [deployment stamp](../deployment-stamps/) หรือ [cell](../cell-based-architecture/) แต่ละตัวเข้ากับ spoke ของตัวเองได้พอดี สร้างจาก template เดียวกันและมี address block ของตัวเอง แต่อย่าลืมว่า hub ของ region จะถูกใช้ร่วมกันโดยทุก cell ใน region นั้น มันเลยต้อง redundant อย่างน้อยเท่ากับ cell ที่มันรับใช้

### ตอนไหนไม่ควรใช้

- **workload เล็ก ๆ ตัวเดียวใน network เดียว** hub เพิ่มค่าชั่วโมงของ firewall และ gateway รวมถึง peering และ route ที่ต้องดูแล โดยไม่มีอะไรให้ใช้ร่วมกันเลย
- **workload ที่ใช้แค่ managed service ผ่าน private endpoint** และไม่ต้องเข้าถึง on-premises หรือมี egress ที่ต้อง inspect แบบนี้ hub เล็ก ๆ ที่มีแค่ DNS กับ endpoint ที่ใช้ร่วมกันก็อาจพอแล้ว
- **มีหลาย region และหลาย branch หรือมี spoke มากเกินกว่าจะ route เองไหว** ใช้ managed hub แทน
- **traffic ระหว่างสอง spoke ที่ไวต่อ latency หรือคุยกันถี่มาก** ให้ peer สอง spoke นั้นตรง ๆ หรือ publish service ผ่าน Private Link แทนที่จะส่งทุก packet ผ่าน firewall

## ได้อะไร เสียอะไร

- **dependency ที่ใช้ร่วมกัน** ตอนนี้ traffic ไป internet, ไป on-premises และข้าม spoke ของทุก spoke ต้องพึ่ง firewall กับ gateway ของ hub ให้กระจายพวกมันไว้หลาย availability zone, scale ไว้ก่อนจะต้องใช้ และทดสอบ failover
- **เพดาน throughput** firewall กับ gateway มีข้อจำกัดต่อ instance และต่อ SKU และ feature อย่าง intrusion detection and prevention ก็ทำให้ throughput ของ firewall ลดลง แม้แต่ transit gateway ก็มีข้อจำกัดต่อ attachment (สูงสุด 100 Gbps ต่อ VPC attachment ต่อ Availability Zone)
- **traffic ที่ผ่าน hub มีค่าใช้จ่าย** Azure คิดเงินต่อ GB ทั้งขาเข้าและขาออกที่ปลายทั้งสองฝั่งของ peering (traffic แบบ gateway transit นับที่ฝั่ง spoke) และคิดค่า Azure Firewall [ต่อชั่วโมงที่ deploy และต่อ GB ที่ process](https://azure.microsoft.com/en-us/pricing/details/azure-firewall/) ส่วน AWS [คิดเงิน](https://aws.amazon.com/transit-gateway/pricing/) ต่อ transit gateway attachment ต่อชั่วโมง และต่อ GB ที่ส่งเข้า transit gateway (คิดกับฝั่งผู้ส่ง) บวกค่า traffic ของ VPC peering ที่ข้าม Availability Zone ส่วน Google คิดค่า traffic ของ peering ตามอัตรา network ปกติ แล้ว log ของ firewall เองก็กลายเป็นบิลก้อนใหญ่ได้
- **Quota** ตอนที่เขียนนี้ Azure ให้มี [650 peering ต่อ virtual network](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/azure-subscription-service-limits) และ 1,000 user-defined route ต่อ route table ส่วน AWS ให้มี [125 active peering ต่อ VPC](https://docs.aws.amazon.com/vpc/latest/peering/vpc-peering-connection-quotas.html) (default คือ 50), 500 static route ต่อ route table (ปรับได้ถึง 1,000) บวก propagated route อีก 100 และ [5,000 attachment ต่อ transit gateway](https://docs.aws.amazon.com/vpc/latest/tgw/transit-gateway-quotas.html) ส่วน Google Cloud มี quota ของ peering ต่อ network และต่อ peering group
- **hop ที่เพิ่มขึ้น** traffic ระหว่าง spoke และไป internet ต้องอ้อมผ่าน firewall ทำให้ latency เพิ่ม
- **เส้นแบ่งระหว่างทีม** ทุก spoke, route หรือ rule ใหม่ต้องผ่าน platform team ถ้าไม่มี template และ self-service ตัว hub ก็กลายเป็นคิว
- **Segmentation ไม่ใช่ identity** network zone จำกัด blast radius และให้จุด choke point แต่มันแยกไม่ออกว่าผู้เรียกที่อยู่ในช่วง address ที่อนุญาตเป็นตัวจริงหรือโดนเจาะมาแล้ว ให้มองมันเป็นหนึ่งชั้นของ [Zero Trust Access](../zero-trust-access/) โดยมี identity ที่ authenticate แล้วในทุก request และใช้ [mutual TLS](../mutual-tls/) ระหว่าง service

## ข้อควรรู้ตอนลงมือทำ

- **สร้าง spoke จาก template** template สร้าง network ตาม address plan และสร้าง peering หรือ attachment, route table, การตั้งค่า DNS server, diagnostic setting และ policy assignment ไปด้วย การได้ spoke ใหม่เลยเป็นแค่ pull request ไม่ใช่การเปิด ticket ส่วนบน AWS ให้ share transit gateway ด้วย AWS Resource Access Manager จาก network account ส่วนกลาง
- **เรื่องเฉพาะของ hub บน Azure** ให้ `GatewaySubnet` และ `AzureFirewallSubnet` อย่างน้อยตัวละ `/26` (firewall subnet ไม่รองรับ network security group) ตั้ง peering สำหรับ gateway transit ตามในตาราง และใช้ availability zone กับทุก service ใน hub ที่รองรับ
- **DNS** ชี้ spoke ไปที่ inbound address ของ resolver ใน hub (หรือ DNS proxy ของ firewall) แล้ว forward zone ของ on-premises ออกไปจากฝั่ง outbound ของมัน บน AWS ให้ share Route 53 VPC Resolver rule ให้ account ของ spoke ส่วนบน Google Cloud ให้ใช้ Cloud DNS peering หรือ forwarding zone เพราะชื่อ DNS ภายในของ network หนึ่ง resolve ข้าม peering ไม่ได้
- **appliance ที่ highly available** ถ้ารัน NVA ของ third-party แทน managed firewall ให้วางหลายตัวไว้หลัง internal load balancer แล้ว route ไปที่ address ของมัน (ดู [Load Balancing](../load-balancing/)) Google Cloud ให้ network ที่ peer กันใช้ internal passthrough Network Load Balancer เป็น next hop ได้
- **traffic ขาเข้า** การ publish service ผ่าน Azure Firewall ด้วย destination NAT ใช้ได้ แต่ backend จะเห็น address ของ firewall เป็น client ถ้า address ของ client สำคัญ ให้วาง reverse proxy หรือ web application firewall ไว้ข้างหน้า ตัวนั้นจะทำหน้าที่เป็นด่านระหว่าง internet กับ spoke ที่ไว้ใจได้
- **คอยดู hub** เปิด diagnostics ให้ firewall, gateway และ bastion รัน connection monitor ระหว่าง spoke กับ on-premises และใช้ flow analytics ดูว่า spoke ไหนส่ง traffic มากที่สุด ก่อนที่ firewall จะกลายเป็นคอขวด
