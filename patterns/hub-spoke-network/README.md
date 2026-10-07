<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [☁️ Cloud Infrastructure](../../README.md#cloud-infrastructure)

# Hub-and-Spoke Network

> Shared services and egress in a central hub network; workloads live in peered spokes.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Hub-and-Spoke Network" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/hub-spoke-network.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Every network, own edge** | Without a shared hub, every workload network builds its own edge: its own **firewall**, its own **VPN** to on-premises, its own internet exit and its own DNS. That is three times the cost and the configuration, and the firewall rule sets drift apart. Prod and Data were both given `10.1.0.0/16`, and networks with overlapping ranges can't be peered or routed to each other without renumbering one of them (or translating addresses). |
| **2 · A hub of shared services** | A **hub** network holds the shared services: one firewall, one gateway to on-premises (VPN or a dedicated circuit), a DNS resolver and a bastion host. Each workload lives in a **spoke** that is peered to the hub only; a central platform team owns the hub, and each workload team owns its spoke. One address plan keeps every range unique, so Data is renumbered to `10.3.0.0/16`. |
| **3 · Traffic through the hub** | Peering is **not transitive**: Prod and Data are each peered to the hub but not to each other, so Prod has no route to Data. A route table in every spoke sends internet traffic (`0.0.0.0/0`), other spokes (`10.0.0.0/8`) and on-premises (`192.168.0.0/16`) to the firewall's private address `10.0.1.4`, which allows Prod → Data, denies Dev → Data and logs every decision. On-premises traffic comes in through the hub's gateway (**gateway transit**), and a route on the gateway subnet sends it through the same firewall; the spokes resolve names with the hub's DNS resolver. |
| **4 · Grow, know the limits** | Adding the Analytics spoke takes a template and one peering. The limits show up in the hub: the firewall is now a shared dependency and a throughput bottleneck (scale it and make it zone-redundant), every network has quotas on peerings and routes, and traffic through the hub adds per-GB charges for peering or transit and for the firewall. Managed hubs such as **Azure Virtual WAN**, **AWS Transit Gateway** and **Google Network Connectivity Center** do the transit routing for you, and a multi-region estate usually gets one hub per region. |
<!-- END GENERATED: header -->

## The problem

Cloud estates usually grow one workload at a time, and each workload team builds the network edge it needs: a firewall or network virtual appliance (NVA), a VPN gateway or dedicated circuit back to the data centre, a NAT or internet gateway, DNS forwarders for on-premises names and a jump host for administrators. By the third copy the costs show:

- **Everything is bought and run several times.** Firewalls and VPN gateways are billed by the hour whether they carry traffic or not, and every copy needs its own patching, monitoring and tunnel configuration on the on-premises side.
- **Policy drifts apart.** Each firewall grows its own rule set and its own logs, so nobody can answer "what can reach the internet?" or "can Dev reach production data?" in one place.
- **Address ranges collide.** Teams pick ranges on their own, or copy a template, and two networks end up with the same range. Azure, AWS and Google Cloud all refuse to peer overlapping networks, and AWS points out that its transit gateways can't route between overlapping VPCs either. What's left is renumbering a live network or putting address translation in the path.

## How it works

A **hub** network holds everything that is shared, and each workload gets its own **spoke** network that connects to the hub and to nothing else:

1. **The hub** holds the shared edge: the firewall, the gateway to on-premises, DNS resolution and administrative access. A central platform team owns it.
2. **Each spoke** holds one workload, or one environment of it, and belongs to that workload's team. Address ranges come from one plan, so nothing overlaps.
3. **Routes in every spoke** send traffic that leaves the spoke (for the internet, another spoke or on-premises) to the hub firewall, which applies one rule set and keeps one log. The spokes use the hub's gateway to reach on-premises and the hub's resolver for names.
4. **A new workload** gets a spoke from a template and one connection to the hub. The hub becomes the thing to scale, protect and budget for.

### The topology in each cloud

- **Azure.** The [hub-spoke reference architecture](https://learn.microsoft.com/en-us/azure/architecture/networking/architecture/hub-spoke) puts Azure Firewall, a VPN or ExpressRoute gateway and Azure Bastion in a hub virtual network, peers each spoke virtual network to it and sends the hub's logs to Azure Monitor. The Cloud Adoption Framework [describes two topologies](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/define-an-azure-network-topology): this "traditional" hub and spoke, which you build and route yourself, and one built on **Azure Virtual WAN**, whose hubs Microsoft manages. Azure landing zones split ownership the way the diagram does: the platform team runs the hubs from a connectivity subscription, and the spokes live in each workload's own subscription.
- **AWS.** The hub is an **AWS Transit Gateway**, a regional router that VPCs, VPN connections and Direct Connect gateways attach to; its route tables decide which attachments can reach each other. The whitepaper [*Building a Scalable and Secure Multi-VPC AWS Network Infrastructure*](https://docs.aws.amazon.com/whitepapers/latest/building-scalable-secure-multi-vpc-network-infrastructure/welcome.html) adds central VPCs around it: an egress VPC with NAT gateways for [centralised internet access](https://docs.aws.amazon.com/whitepapers/latest/building-scalable-secure-multi-vpc-network-infrastructure/centralized-egress-to-internet.html), an inspection VPC with AWS Network Firewall or a Gateway Load Balancer for [traffic between VPCs and to on-premises](https://docs.aws.amazon.com/whitepapers/latest/building-scalable-secure-multi-vpc-network-infrastructure/centralized-network-security-for-vpc-to-vpc-and-on-premises-to-vpc-traffic.html), and shared Route 53 VPC Resolver endpoints for hybrid DNS. A transit gateway can now also [attach AWS Network Firewall directly](https://docs.aws.amazon.com/vpc/latest/tgw/how-transit-gateways-work.html), which saves you building that inspection VPC. Plain VPC peering can't form this kind of hub: it isn't transitive, and a VPC [can't use its peer's](https://docs.aws.amazon.com/vpc/latest/peering/vpc-peering-basics.html) internet gateway, NAT gateway, VPN connection or Direct Connect link.
- **Google Cloud.** The Architecture Center's [hub-and-spoke network architecture](https://docs.cloud.google.com/architecture/deploy-hub-spoke-vpc-network-topology) connects workload (spoke) VPC networks to a routing (hub) VPC network in one of three ways: **Network Connectivity Center** (NCC), **VPC Network Peering** or **Cloud VPN**. When spokes must reach each other through an inspection point, an NVA or next-generation firewall in the routing network acts as their gateway. **Shared VPC** solves part of the problem differently: a host project owns one network, other projects deploy into its subnets, and a central team controls the network without any peering. AWS offers the same idea as VPC sharing.

### What goes in the hub, and what stays in the spokes

The hub holds what is shared and what needs one owner:

- **A firewall or NVA** for internet egress, traffic between spokes, traffic to and from on-premises and, if you publish services through it, inbound traffic.
- **The gateways to on-premises:** VPN gateways and the gateways for dedicated circuits (ExpressRoute, Direct Connect, Cloud Interconnect).
- **DNS:** a resolver with inbound and outbound endpoints, forwarding rules for on-premises names, and the private DNS zones that private endpoints depend on, linked to every spoke. [Private Endpoints](../private-endpoints/) explains why those zones usually live in the hub.
- **Administrative access:** a managed bastion (Azure Bastion reaches VMs in the peered spokes) or hardened jump hosts.
- **Shared monitoring:** firewall and flow logs, connection monitors and the network team's dashboards.

The spokes keep what belongs to one workload: its subnets and machines, load balancers and application gateways, security groups, and the private endpoints only that workload uses. The route tables on spoke subnets are often set by the platform team through policy, because one wrong route quietly bypasses the firewall.

### Peering and transit, provider by provider

| | Azure | AWS | Google Cloud |
|---|---|---|---|
| **Spoke connection** | [Virtual network peering](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-network-peering-overview), or a Virtual Network Manager connectivity configuration | A transit gateway attachment; VPC peering is one-to-one | [VPC Network Peering](https://docs.cloud.google.com/vpc/docs/vpc-peering), an NCC VPC spoke or Cloud VPN |
| **Transitive?** | No. Spoke-to-spoke traffic needs a route to an appliance in the hub, or a peering of its own | VPC peering: no. A transit gateway routes between its attachments as its route tables allow | Peering: no. [NCC VPC spokes](https://docs.cloud.google.com/network-connectivity/docs/network-connectivity-center/concepts/overview) exchange routes with each other, unless a star topology keeps the edge spokes apart |
| **Using the hub's VPN or circuit** | *Gateway transit:* the hub's peering allows it, each spoke's peering uses the remote gateway, and the peerings allow forwarded traffic. A network that uses a remote gateway can't have its own | The VPN connections and the Direct Connect gateway attach to the transit gateway itself | The hub exports its custom routes (static ones, and the dynamic ones Cloud Router learns from on-premises) and the spokes import them |
| **Overlapping ranges** | Not allowed between peered networks | Not allowed for peering, and a transit gateway can't route between overlapping VPCs | Subnet ranges can't overlap across a peering |

Cloud VPN is the odd one out in Google's design: it is transitive and gets around the peering quotas, but the bandwidth between networks is limited to what the tunnels carry.

### Routing

- **Point the spokes at the firewall.** Each spoke subnet gets a route table that sends `0.0.0.0/0` and the other spokes' ranges (summarised here as `10.0.0.0/8`) to the firewall's private address. Routes are chosen by longest prefix, so the hub's own range keeps the more specific route the peering creates, and DNS queries and bastion sessions reach the hub directly. Azure's default system routes [drop traffic to private ranges](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-udr-overview) outside the network and its peers, and adding a user-defined `0.0.0.0/0` route removes those defaults, which is why a single default route is often enough there. On AWS the spoke routes point at the transit gateway instead, and its route tables send the traffic through the inspection VPC.
- **Keep both directions on the same firewall.** A stateful firewall drops replies to connections it never saw. Traffic from on-premises arrives at the gateway, so on Azure you add a route on the gateway subnet that sends the spoke ranges to the firewall, and make the spokes send their replies back the same way: switch off gateway route propagation on the spoke's route table, or add explicit routes for the on-premises ranges (the diagram's `192.168.0.0/16` row), as in Microsoft's [hybrid firewall tutorial](https://learn.microsoft.com/en-us/azure/firewall/tutorial-hybrid-portal-policy). Never switch propagation off on the gateway subnet itself: the gateway stops working. On AWS, enable **appliance mode** on the inspection VPC's attachment so that a flow and its replies stay in the same Availability Zone.
- **Forced tunnelling** sends internet-bound traffic to another next hop, typically a firewall on premises, instead of straight out of the cloud. It keeps one egress point for the whole company, at the cost of latency and on-premises bandwidth.
- **Segment with routes as well as rules.** Separate transit gateway route tables, with blackhole routes, can stop Dev and Prod from having any path to each other. On Azure the firewall policy does that job, and Virtual Network Manager can push user-defined routes and security admin rules to whole groups of spokes.

### Address planning

- Give on-premises and every cloud region one plan, with no overlaps and with room to grow. Hierarchical blocks summarise well: one block per region, a `/16` per spoke, as in the diagram. Plan IPv6 or dual stack while the plan is young.
- Track allocations in a tool rather than a spreadsheet: IP address management (IPAM) in Azure Virtual Network Manager and Amazon VPC IP Address Manager both hand out ranges that don't overlap.
- Summarise what you advertise to on-premises. An Azure gateway with gateway transit advertises the hub and every peered spoke by default; [advertised gateway prefixes](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-network-peering-overview) replace them with summaries.
- When an overlap can't be avoided (an acquisition, a vendor's network), translate addresses at the boundary; AWS documents a private NAT gateway for exactly this case.

### Egress control and east-west inspection

- **Egress.** Internet traffic leaves with the firewall's public addresses (source NAT), so partners that allow-list you must allow all of them; a contiguous public prefix keeps that list short. On Azure, a NAT gateway on the firewall's subnet adds addresses and SNAT ports while replies still pass the firewall. On AWS, the egress VPC's NAT gateways do the same job, optionally behind Network Firewall. Google's reference design gives every network its own Cloud NAT gateway instead.
- **Consistent DNS for name-based rules.** A firewall that allows `*.example.com` must resolve names the same way the workloads do, or the two see different addresses and legitimate traffic is blocked. Azure recommends sending the spokes' DNS through the firewall's DNS proxy for that reason.
- **East-west.** Spoke-to-spoke traffic through the firewall gives a default deny between environments and one log. Each crossing adds a hop, latency and per-GB processing, though, so for trusted, high-volume pairs (database replication, bulk copies) Azure suggests a direct peering or Private Link, kept within one environment and workload.

### On-premises connectivity

- One gateway in the hub (VPN, a dedicated circuit or both) serves every spoke, so it needs real redundancy: ExpressRoute with VPN failover on Azure, Direct Connect [from more than one location](https://docs.aws.amazon.com/whitepapers/latest/building-scalable-secure-multi-vpc-network-infrastructure/direct-connect.html) and with more than one connection on AWS, HA VPN on Google Cloud (a 99.99% SLA in the supported topologies).
- A gateway also caps throughput: Azure notes that one ExpressRoute gateway limits aggregate and per-flow throughput whatever the circuit size. Beyond that, scale out with more hubs.

### More than one region

On Azure and AWS the hub is regional, so a multi-region estate gets one hub per region. Azure recommends connecting each spoke only to its own region's hub, so a failing hub doesn't take routing down in unrelated regions. The hubs are then connected to each other: with global peering or [Virtual WAN](https://learn.microsoft.com/en-us/azure/virtual-wan/virtual-wan-about) (whose Standard hubs are fully meshed) on Azure, and with transit gateway peering or AWS Cloud WAN on AWS. On Google Cloud, VPC networks and NCC hubs are global resources, but the appliances in the routing network still run in particular regions and zones, so plan them region by region. [Multi-Region Active-Active](../multi-region-active-active/) covers the application side.

### Managed hubs

Building your own hub means maintaining peerings, route tables and appliances. Each provider will run the transit routing for you:

- **Azure Virtual WAN** hubs are virtual networks that Microsoft manages, with transitive connectivity between virtual networks, branches, VPN users and ExpressRoute. You can run Azure Firewall or a partner NVA inside a hub, and **routing intent** sends internet traffic, private traffic or both through it. Azure Virtual Network Manager is a middle way: it builds and maintains the peerings and routes of your own hub and spoke, for up to 1,000 spokes per hub.
- **AWS Transit Gateway** is already a managed hub; **AWS Cloud WAN** adds a global network defined by policy across regions.
- **Google NCC** connects VPC spokes, in a mesh or a star topology, and hybrid spokes (HA VPN, Interconnect, router appliances) through one hub.

Choose a managed hub when you have many spokes, branches or regions and would rather not route them by hand. Keep a customer-managed hub when you need appliances or features the managed hub doesn't support or when the managed hub's own charges outweigh the work it saves; Microsoft lists cost, subscription limits, workload isolation and NVA flexibility as reasons to stay customer-managed.

## When to use it

- **Several workloads or environments need the same shared services:** connectivity to on-premises, controlled and logged egress, DNS, administrative access.
- **A security team must control and log traffic in one place:** what leaves for the internet, and what crosses between environments.
- **Teams own their networks, but one team owns connectivity**, as in a landing zone.
- **Stamps and cells.** Each [deployment stamp](../deployment-stamps/) or [cell](../cell-based-architecture/) fits naturally into its own spoke, built from the same template with its own address block. Keep in mind that the regional hub is then shared by every cell in the region, so it has to be at least as redundant as the cells it serves.

### When not to use it

- **One small workload in one network.** A hub adds firewall and gateway hours, peerings and routes to maintain, with nothing to share.
- **Workloads that only use managed services through private endpoints** and need neither on-premises access nor inspected egress. A small hub with DNS and the shared endpoints may be all you need.
- **Many regions and branches, or more spokes than you want to route by hand.** Use a managed hub instead.
- **Latency-sensitive or very chatty traffic between two spokes.** Peer those spokes directly or publish the service through Private Link instead of sending every packet through the firewall.

## Trade-offs

- **A shared dependency.** Internet, on-premises and cross-spoke traffic for every spoke now depends on the hub's firewall and gateway. Spread them across availability zones, scale them before you need to and test failover.
- **A throughput ceiling.** Firewalls and gateways have per-instance and per-SKU limits, and features such as intrusion detection and prevention lower a firewall's throughput. Even a transit gateway has per-attachment limits (up to 100 Gbps per VPC attachment per Availability Zone).
- **Traffic through the hub is billed.** Azure charges per GB in and out at both ends of a peering (gateway transit traffic counts on the spoke side) and charges Azure Firewall [per deployment hour and per GB processed](https://azure.microsoft.com/en-us/pricing/details/azure-firewall/). AWS [charges](https://aws.amazon.com/transit-gateway/pricing/) for each transit gateway attachment per hour and for each GB sent into the transit gateway (billed to the sender), plus VPC peering traffic that crosses Availability Zones. Google bills peering traffic at normal network rates. Firewall logs can become a large bill of their own.
- **Quotas.** At the time of writing Azure allows [650 peerings per virtual network](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/azure-subscription-service-limits) and 1,000 user-defined routes per route table. AWS allows [125 active peerings per VPC](https://docs.aws.amazon.com/vpc/latest/peering/vpc-peering-connection-quotas.html) (50 by default), 500 static routes per route table (adjustable to 1,000) plus 100 propagated ones, and [5,000 attachments per transit gateway](https://docs.aws.amazon.com/vpc/latest/tgw/transit-gateway-quotas.html). Google Cloud has quotas on peerings per network and per peering group.
- **An extra hop.** Traffic between spokes and to the internet takes a detour through the firewall, which adds latency.
- **A team boundary.** Every new spoke, route or rule involves the platform team. Without templates and self-service the hub becomes a queue.
- **Segmentation isn't identity.** Network zones limit the blast radius and give you a choke point, but they can't tell a legitimate caller from a compromised one inside an allowed range. Treat them as one layer of [Zero Trust Access](../zero-trust-access/), with authenticated identities on every request and [mutual TLS](../mutual-tls/) between services.

## Implementation notes

- **Build spokes from a template.** The template creates the network from the address plan, the peering or attachment, the route tables, the DNS server setting, diagnostic settings and policy assignments, so a new spoke is a pull request, not a ticket. On AWS, share the transit gateway with AWS Resource Access Manager from a central network account.
- **Azure hub specifics.** Give `GatewaySubnet` and `AzureFirewallSubnet` at least a `/26` each (the firewall subnet doesn't support network security groups). Set the peerings for gateway transit as shown in the table, and use availability zones for every hub service that supports them.
- **DNS.** Point the spokes at the hub resolver's inbound address (or the firewall's DNS proxy) and forward on-premises zones from its outbound side. On AWS, share Route 53 VPC Resolver rules with the spoke accounts; on Google Cloud, use Cloud DNS peering or forwarding zones, because a network's internal DNS names don't resolve across a peering.
- **Highly available appliances.** If you run third-party NVAs instead of a managed firewall, put several behind an internal load balancer and route to its address (see [Load Balancing](../load-balancing/)). Google Cloud lets peered networks use an internal passthrough Network Load Balancer as a next hop.
- **Inbound traffic.** Publishing a service through Azure Firewall with destination NAT works, but the backend then sees the firewall's address as the client. When the client's address matters, put a reverse proxy or web application firewall in front, which then plays the role of a gatekeeper between the internet and the trusted spokes.
- **Watch the hub.** Turn on diagnostics for the firewall, gateways and bastion, run connection monitors between spokes and on-premises, and use flow analytics to see which spokes send the most traffic before the firewall becomes the bottleneck.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Private Endpoints](../private-endpoints/) — Reach managed cloud services over private IPs instead of the public internet.
- [Zero Trust Access](../zero-trust-access/) — No implicit trust from network location: verify identity, device and context on every request.
- [Gatekeeper](../gatekeeper/) — A hardened broker validates and sanitises requests before they reach trusted hosts.
- [Multi-Region Active-Active](../multi-region-active-active/) — Serve users from several regions at once and shift traffic away from a region that fails.
- [Deployment Stamps](../deployment-stamps/) — Deploy many independent copies of the whole stack, each serving a subset of tenants.
- [Cell-Based Architecture](../cell-based-architecture/) — Many isolated, identical cells behind a thin router contain the blast radius of any failure.
- [Mutual TLS (mTLS)](../mutual-tls/) — Client and server both present certificates, so every connection is authenticated both ways.
- [Load Balancing](../load-balancing/) — Spread requests across healthy instances and stop sending to unhealthy ones.

## Related components and services

- [Amazon VPC](../amazon-vpc/) — Your private network in AWS: subnets in each Availability Zone, route tables, gateways, security groups and endpoints.
- [Amazon Route 53](../amazon-route-53/) — Managed DNS: hosted zones, routing policies (weighted, latency, failover, geolocation) and health checks.

## References

- [Azure Architecture Center — Hub-spoke network topology in Azure](https://learn.microsoft.com/en-us/azure/architecture/networking/architecture/hub-spoke)
- [Cloud Adoption Framework — Define an Azure network topology](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/define-an-azure-network-topology)
- [Microsoft Learn — Azure Virtual Network peering](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-network-peering-overview)
- [Microsoft Learn — Azure virtual network traffic routing](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-udr-overview)
- [Microsoft Learn — Azure Virtual WAN overview](https://learn.microsoft.com/en-us/azure/virtual-wan/virtual-wan-about)
- [AWS Whitepaper — Building a Scalable and Secure Multi-VPC AWS Network Infrastructure](https://docs.aws.amazon.com/whitepapers/latest/building-scalable-secure-multi-vpc-network-infrastructure/welcome.html)
- [AWS Whitepaper — Centralized network security for VPC-to-VPC and on-premises to VPC traffic](https://docs.aws.amazon.com/whitepapers/latest/building-scalable-secure-multi-vpc-network-infrastructure/centralized-network-security-for-vpc-to-vpc-and-on-premises-to-vpc-traffic.html)
- [Amazon VPC — How AWS Transit Gateway works](https://docs.aws.amazon.com/vpc/latest/tgw/how-transit-gateways-work.html)
- [Amazon VPC — How VPC peering connections work](https://docs.aws.amazon.com/vpc/latest/peering/vpc-peering-basics.html)
- [Google Cloud Architecture Center — Hub-and-spoke network architecture](https://docs.cloud.google.com/architecture/deploy-hub-spoke-vpc-network-topology)
- [Google Cloud — VPC Network Peering](https://docs.cloud.google.com/vpc/docs/vpc-peering)
- [Google Cloud — Network Connectivity Center overview](https://docs.cloud.google.com/network-connectivity/docs/network-connectivity-center/concepts/overview)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
