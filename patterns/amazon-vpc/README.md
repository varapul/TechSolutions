<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🟧 AWS Services](../../README.md#aws-services)

# Amazon VPC

> Your private network in AWS: subnets in each Availability Zone, route tables, gateways, security groups and endpoints.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Amazon VPC" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/amazon-vpc.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Acme Shop's VPC `10.0.0.0/16` spans us-east-1, and each of its six subnets sits in one Availability Zone: a public, an app and a data subnet in each of two zones. A subnet is **public** when its route table sends `0.0.0.0/0` to the **internet gateway**; only the ALB nodes and the NAT gateways sit there, the ECS tasks and the RDS database have private addresses only, and the data subnets have no route out of the VPC at all. Other VPCs, and the office over Site-to-Site VPN or Direct Connect, attach through a Transit Gateway (VPC peering links two VPCs directly), and VPC Flow Logs record the traffic in CloudWatch Logs. |
| **2 · A request comes in** | A shopper's request enters through the internet gateway and reaches the ALB node in zone a, whose security group `alb-sg` allows TCP 443 from anywhere. The ALB passes it to a catalog task, whose `app-sg` allows 8080 only from members of `alb-sg`, and the task queries RDS, whose `db-sg` allows 5432 only from `app-sg`: each tier accepts traffic only from the tier in front of it. Security groups are **stateful**, so the replies flow back without rules of their own; **network ACLs** filter whole subnets and are stateless, so they need rules for the return traffic too. |
| **3 · Going out** | An orders task in zone b calls the payment API. Its subnet's route table `rt-app-b` sends `0.0.0.0/0` to **nat-b** in the same zone, which replaces the task's private source address with its own; the internet gateway maps that to nat-b's Elastic IP, the only address the payment API sees. Replies come back, but a connection that starts on the internet is dropped. The invoice upload to S3 matches the more specific prefix-list route to the **gateway endpoint** instead, which costs nothing and never touches the NAT gateway. |
| **4 · A zone fails, the limits** | Availability Zone a fails. Zone b has its own ALB node, NAT gateway and tasks, so it keeps serving: the ALB sends requests only to healthy targets, and RDS promotes the standby in zone b (typically within 60–120 seconds) and points the database's DNS name at it. The limits to plan for (October 2026, us-east-1): a NAT gateway costs $0.045 an hour plus $0.045 per GB processed, AWS reserves 5 addresses in every subnet, CIDR ranges must not overlap with the networks you will connect, and by default a security group holds 60 inbound and 60 outbound rules, with up to 5 groups per network interface. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's application has parts the internet must reach and parts it must never reach. Shoppers have to get to the load balancer on port 443. The [ECS](../amazon-ecs/) tasks behind it should accept traffic only from that load balancer, and the PostgreSQL database only from the tasks. The tasks still need to go out: to a payment provider's API on the internet, and to the S3 bucket `acme-invoices`, where they store invoices. Everything has to keep working when one Availability Zone fails, and later the network has to connect to other VPCs and to the office without address clashes. Put every resource in one flat network with public addresses and the database is a single mistyped rule away from the internet, with no way to say "only from the tier in front of me".

## How it works

An Amazon VPC is a logically isolated virtual network in one AWS Region. You give it an IP address range, divide the range into subnets, and decide with route tables, gateways and firewall rules what may enter, leave and move inside. The VPC itself costs nothing; NAT gateways, endpoints, public IPv4 addresses and data transfer have their own prices (see *Trade-offs* below).

### The address plan

A VPC's primary IPv4 block is between a /16 (65,536 addresses) and a /28 (16). Acme Shop uses `10.0.0.0/16`, from the private ranges of RFC 1918. A block can't be resized once it exists, but you can add secondary blocks: 5 blocks per VPC by default, the primary included, up to 50 (quotas as of October 2026). Pick ranges that will never overlap a network you may connect later (other VPCs, other Regions, the office), because a VPC peering connection can't be created between overlapping VPCs and a route table can't tell two copies of one range apart. The documentation also warns against `172.17.0.0/16`, which some AWS services use themselves. Amazon VPC IP Address Manager (IPAM) can allocate blocks to new VPCs from central pools under rules you set, across accounts and Regions, and track how the space is used.

IPv6 is optional. Amazon can assign the VPC a /56 from its own pool (or you bring your own range), and subnets take blocks between /44 and /64. IPv6 addresses are globally unique, so instead of NAT, outbound-only IPv6 access uses an **egress-only internet gateway**, which lets connections out and none in.

### Subnets and Availability Zones

A subnet is a slice of the VPC's range that lives entirely in one Availability Zone. AWS keeps five addresses of every subnet for itself: in `10.0.10.0/24` those are `.0` (network), `.1` (the VPC router), `.2` (DNS), `.3` (reserved for future use) and `.255` (broadcast, which VPCs don't support), so each /24 leaves 251 usable addresses. Acme Shop has three tiers in each of two zones:

| Subnet | Zone a | Zone b | Holds | Traffic for 0.0.0.0/0 goes to |
|---|---|---|---|---|
| public | `10.0.0.0/24` | `10.0.1.0/24` | ALB nodes, NAT gateways | the internet gateway |
| private app | `10.0.10.0/24` | `10.0.11.0/24` | ECS tasks | the NAT gateway in the same zone |
| private data | `10.0.20.0/24` | `10.0.21.0/24` | [RDS](../amazon-rds-aurora/) primary and standby | nowhere: local traffic only |

Nothing but routing makes a subnet public or private. A subnet is **public** when its route table has a route to an internet gateway and **private** when it doesn't; a private subnet reaches the internet, if at all, through a NAT device. AWS calls a subnet with no route outside the VPC at all, like the two data subnets, **isolated**. A resource in a public subnet also needs an address of its own that the internet can route to, a public IPv4 or Elastic IP address or an IPv6 address, to talk to the internet directly.

Managed services place network interfaces in these subnets and have their own rules. An Application Load Balancer needs subnets in at least two Availability Zones, each a /27 or larger with at least eight free addresses so that it can scale. ECS tasks in `awsvpc` network mode get their own network interface and private IP address, so security groups apply per task and the ALB's target group uses the target type `ip`. An RDS DB subnet group must include subnets in at least two zones.

### Route tables

Each subnet is associated with exactly one route table, either the VPC's main route table or a custom one, and one table can serve several subnets. Every table contains the **local** route for the VPC's own range, so all subnets can reach each other and the security groups (and any network ACLs) decide what is allowed. For each packet the most specific matching route wins (longest prefix match). Acme Shop uses four tables:

| Route table | Associated with | Routes |
|---|---|---|
| `rt-public` | both public subnets | `10.0.0.0/16` → local, `0.0.0.0/0` → internet gateway |
| `rt-app-a` | private app subnet, zone a | `10.0.0.0/16` → local, `0.0.0.0/0` → `nat-a`, S3 prefix list `pl-…` → gateway endpoint `vpce-s3` |
| `rt-app-b` | private app subnet, zone b | `10.0.0.0/16` → local, `0.0.0.0/0` → `nat-b`, S3 prefix list `pl-…` → gateway endpoint `vpce-s3` |
| `rt-data` | both data subnets | `10.0.0.0/16` → local |

The app tier needs one table per zone because each zone's default route points at its own NAT gateway. Other route targets include a transit gateway, a peering connection, a virtual private gateway and a network interface (a firewall appliance, for example). A route table associated with the internet gateway itself, a gateway route table, can send incoming traffic through such an appliance before it reaches a subnet.

### The internet gateway and NAT gateways

The **internet gateway** is attached to the VPC (one per VPC). AWS describes it as horizontally scaled, redundant and highly available, so it is neither a bandwidth limit nor a single point of failure. For IPv4 it performs one-to-one NAT between a resource's private address and its public or Elastic IP address. The gateway costs nothing; data transfer is charged as usual.

A **NAT gateway** lets resources in private subnets open connections outwards, while nothing outside can open a connection to them. A public NAT gateway sits in a public subnet with an Elastic IP address. It replaces the source address of outgoing packets with its own private address, the internet gateway maps that to the Elastic IP, and replies are translated back on the way in, so the payment API only ever sees nat-b's Elastic IP. The documented limits (October 2026): 5 Gbps that scales automatically to 100 Gbps; 1 million packets per second, scaling to 10 million; and 55,000 simultaneous connections to each unique destination (address, port and protocol) per IP address, which you raise by adding addresses, up to 8 per gateway (2 Elastic IPs by default). It handles TCP, UDP and ICMP. You can't attach a security group to it, but the network ACL of its subnet applies. A **private** NAT gateway has no Elastic IP: it translates traffic to other VPCs or to on-premises networks through a transit gateway or a virtual private gateway, which helps when two networks with overlapping ranges must talk.

By default a NAT gateway is **zonal**: built redundantly inside one Availability Zone, but if that zone fails, every subnet that routes through it loses internet access. That is why Acme Shop runs one NAT gateway per zone, with a route table per zone that points at it. The documentation now also describes a **regional** availability mode (`--availability-mode regional`): one NAT gateway ID that expands into every zone where the VPC has network interfaces (a new zone can take up to 60 minutes), needs no public subnet, comes with its own route table pointing at the internet gateway, and supports up to 32 IP addresses per zone instead of 8. It is billed for each zone it runs in, and it doesn't do private NAT.

For IPv6, NAT64 on a NAT gateway together with DNS64 in the [Route 53](../amazon-route-53/) VPC Resolver lets IPv6-only workloads reach IPv4 services.

### Security groups and network ACLs

Two firewalls work at different levels:

| | Security group | Network ACL |
|---|---|---|
| Applies to | network interfaces: instances, tasks, load balancers, endpoints | a whole subnet, at its boundary |
| Rules | allow only | allow and deny, numbered 1 to 32766 |
| Evaluation | every rule is considered | in number order; the first match decides |
| Return traffic | allowed automatically (stateful) | needs its own rule (stateless) |
| A rule can name | address ranges, prefix lists, other security groups | address ranges only |
| By default | a new group allows no inbound and all outbound traffic | the default ACL allows everything; a new custom ACL denies everything |
| Default quotas (October 2026) | 60 inbound and 60 outbound rules per group; 5 groups per network interface (up to 16, and the product may not exceed 1,000) | 20 inbound and 20 outbound rules (up to 40) |

Acme Shop's security groups form a chain:

| Group | Inbound rule | Attached to |
|---|---|---|
| `alb-sg` | TCP 443 from `0.0.0.0/0` | the ALB |
| `app-sg` | TCP 8080 from `alb-sg` | the ECS tasks |
| `db-sg` | TCP 5432 from `app-sg` | the RDS instances |

A rule whose source is another security group admits traffic from any network interface that carries that group. New tasks are allowed as soon as they start, without a rule change, and the database stays unreachable from the public subnets even though the local route connects every subnet. A security group can be referenced from a peered VPC in the same Region. Neither firewall filters traffic to the Amazon DNS server, DHCP, instance metadata or the Amazon Time Sync Service.

AWS recommends security groups as the main control and network ACLs as coarse guard rails, such as denying one address range for a whole subnet, or as a second layer in case a resource is launched with the wrong group. Because ACLs are stateless, they must also allow the replies. Elastic Load Balancing connects to its targets from ports 1024 to 65535, so an ACL on the app subnets has to let traffic to those ports back out; a NAT gateway uses the same range for its connections to the internet, so the ACL of its public subnet has to let the replies in.

### VPC endpoints and AWS PrivateLink

Traffic to AWS services can stay off the NAT gateway:

- **Gateway endpoints** exist only for S3 and [DynamoDB](../amazon-dynamodb/). Creating one adds a route to the route tables you choose: its destination is the service's prefix list (`pl-…`), and since that is more specific than `0.0.0.0/0`, traffic to S3 in the same Region takes the endpoint instead of the NAT gateway. Gateway endpoints cost nothing, but they serve only the VPC's own subnets: not peered VPCs, transit gateways, VPN or Direct Connect, and not buckets in other Regions. S3 then sees the tasks' private addresses, so bucket policies use `aws:SourceVpce` or `aws:VpcSourceIp` instead of `aws:SourceIp`. Creating or changing an endpoint resets open connections to S3. The default quota is 20 gateway endpoints per Region.
- **Interface endpoints** (AWS PrivateLink) place a network interface with a private IP address in one subnet of each zone you choose, protected by a security group. With private DNS on (it needs both DNS attributes of the VPC), the service's usual name resolves to those addresses. They reach most AWS services, your own services published as endpoint services, and partner SaaS, and they work from peered VPCs and over VPN and Direct Connect. In us-east-1 (October 2026) each costs $0.01 per zone per hour plus $0.01 per GB processed for the first petabyte. Newer endpoint types reach a single resource, such as a database in another VPC, or a VPC Lattice service network.

The [private endpoints](../private-endpoints/) pattern describes the idea in general.

### Connecting VPCs and on-premises networks

| Option | Connects | Worth knowing (us-east-1 prices, October 2026) |
|---|---|---|
| VPC peering | two VPCs, also across accounts and Regions | No transitive routing and no overlapping ranges. Free to create; traffic that stays within one zone is free, across zones or Regions it's charged. |
| AWS Transit Gateway | many VPCs, VPN connections, Direct Connect gateways and other transit gateways | A regional hub with its own route tables. $0.05 per attachment-hour plus $0.02 per GB processed. |
| AWS Cloud WAN | VPCs and sites across Regions | A managed wide-area network defined by one central policy (a core network with segments). |
| Amazon VPC Lattice | services and resources across VPCs and accounts | Networking at the application layer: service networks with auth policies, and overlapping address ranges are supported. |
| AWS Site-to-Site VPN | an office or data centre, over the internet | Two IPsec tunnels per connection for redundancy, up to 1.25 Gbps each (large-bandwidth tunnels reach 5 Gbps on Transit Gateway or Cloud WAN). $0.05 per connection-hour. |
| AWS Direct Connect | a data centre, over a private line | Dedicated ports of 1, 10, 100 or 400 Gbps. A private virtual interface reaches a VPC or a Direct Connect gateway; a transit virtual interface reaches transit gateways. |

Acme Shop's diagram attaches other VPCs and the office to one Transit Gateway, the usual [hub-and-spoke](../hub-spoke-network/) layout. AWS's multi-VPC guidance also uses the hub for shared egress: NAT gateways in one egress VPC serve every spoke through Transit Gateway or Cloud WAN, which saves NAT gateways but adds the hub's per-GB processing charge. A peering connection can't do this, because traffic can't be routed to a NAT gateway through one.

### DNS inside the VPC

Every VPC comes with a resolver, the **Route 53 VPC Resolver**. It was called Route 53 Resolver until Route 53 Global Resolver was introduced. It answers at the base of the VPC's primary range plus two (`10.0.0.2` here) and at `169.254.169.253`, for public names, for AWS-provided hostnames inside the VPC, and for Route 53 private hosted zones associated with the VPC. Two VPC attributes control it: `enableDnsSupport` (on by default) and `enableDnsHostnames` (off by default, except in default VPCs); private hosted zones need both on. In a hybrid network, inbound and outbound Resolver endpoints with forwarding rules resolve names in both directions between the VPC and the office, and Route 53 Resolver DNS Firewall can filter queries. Each network interface can send at most 1,024 packets per second to the resolver.

### VPC Flow Logs

Flow logs record metadata about IP traffic, never the payload, for a whole VPC, a subnet or one network interface. The default record holds the version, account, interface, source and destination addresses and ports, protocol, packets, bytes, start and end times, the action (`ACCEPT` or `REJECT`) and a log status. You choose accepted, rejected or all traffic and publish to [CloudWatch](../amazon-cloudwatch/) Logs, Amazon S3 or Amazon Data Firehose. A record covers an aggregation interval of up to 10 minutes by default or 1 minute if you choose (on Nitro instances it is always 1 minute or less), and delivery typically takes about 5 minutes to CloudWatch Logs and about 10 to S3, on a best-effort basis. That makes flow logs a tool for troubleshooting and auditing, not for stopping traffic as it happens. They are collected outside the traffic path, so they don't slow it down; you pay the destination's charges for vended logs. A run of `REJECT` records for port 5432 shows a security group or ACL doing its job.

### Block Public Access

VPC Block Public Access (BPA) is an account-wide setting per Region that overrides routes and security groups. **Bidirectional** mode blocks all traffic through internet gateways and egress-only internet gateways; **ingress-only** mode blocks traffic coming in from the internet but still allows connections out through NAT gateways and egress-only internet gateways. Exclusions exempt single VPCs or subnets (50 per account per Region by default). Private connectivity such as transit gateways, Site-to-Site VPN and Cloud WAN is not affected. Acme Shop could turn on ingress-only mode and exclude its two public subnets; AWS notes that a load balancer with even one excluded subnet still receives public traffic and passes it to targets in subnets that aren't excluded.

### Surviving a zone failure

The VPC and its route tables span the Region, and AWS runs the internet gateway as a redundant, horizontally scaled component; subnets, and everything placed in them, belong to one zone. AWS's Well-Architected reliability pillar asks for every production workload to run in at least two Availability Zones, and the VPC is where that is drawn: each tier has a subnet in each zone, and each zone has its own ALB node, NAT gateway and tasks. When zone a fails, the ALB sends requests only to healthy targets, and by default it also stops answering DNS with the address of a zone that has no healthy target left. RDS fails over to the synchronous standby in zone b, typically in 60 to 120 seconds, and moves the database's DNS name to it, so applications have to reconnect and must not cache DNS answers for long. The ECS service starts replacement tasks in the zone it can still use, and since September 2025 ECS rebalances eligible services across zones once the failed zone is back.

## Where it fits

- **Solutions.** Almost everything on AWS that isn't a pure API call runs in a VPC: EC2 instances, ECS and EKS containers, RDS and Aurora databases, ElastiCache ([Redis and Valkey](../redis/)), [OpenSearch](../elasticsearch/) domains with VPC access, MSK clusters, and Lambda functions once they are attached to private subnets ([AWS Lambda](../aws-lambda/)). The three-tier, two-zone layout of Acme Shop is the usual starting point for a web application.
- **Patterns in this catalog.** The VPC is where several network patterns are built: [hub-and-spoke networks](../hub-spoke-network/) with a Transit Gateway or Cloud WAN, [private endpoints](../private-endpoints/) with PrivateLink and gateway endpoints, and [load balancing](../load-balancing/) across zones with an ALB. Security groups, ACLs and Block Public Access are one layer of [zero trust access](../zero-trust-access/): they limit which networks can talk, while identity and authorisation still have to be checked on every request. Across Regions, [active-passive failover](../active-passive-failover/) and [multi-Region active-active](../multi-region-active-active/) need a VPC in each Region, with ranges that don't overlap.
- **Usual neighbours.** Elastic Load Balancing, Amazon ECS and EKS, Amazon RDS ([PostgreSQL](../postgresql/)), [Amazon S3](../amazon-s3/) and DynamoDB through gateway endpoints, Route 53 for public and private DNS, [AWS IAM](../aws-iam/) (who may change security groups and routes), CloudWatch for flow logs and metrics, and AWS Network Firewall when subnets need deeper inspection.
- **Managed offerings.** Amazon VPC is itself the managed service, and every AWS account has a default VPC in each Region: a public subnet in each zone, an internet gateway and DNS turned on. It is fine for experiments; production workloads normally get their own VPC with a deliberate address plan. Azure Virtual Network and Google Cloud VPC are the equivalents on the other clouds.

## When to use it

Any workload on AWS that runs servers, containers or databases of its own uses a VPC. The real decisions are how many VPCs to have and how to lay each one out. One VPC per application and environment, often in its own account, keeps the blast radius small; a Transit Gateway or Cloud WAN then connects the ones that must talk, and VPC Lattice or PrivateLink can connect individual services without merging whole networks. Within a VPC, use public subnets only for what the internet must reach, put each tier in every zone, and decide early which address ranges the company's networks will use.

Services that never touch your network (S3, DynamoDB, [SQS](../amazon-sqs/) or Lambda without VPC attachment) don't need one; reach them from inside a VPC through endpoints.

| | Amazon VPC | Azure Virtual Network | Google Cloud VPC |
|---|---|---|---|
| Scope of the network | one Region | one region | global: one network spans every region |
| Scope of a subnet | one Availability Zone | the whole region: virtual networks and subnets span all zones | one region, across its zones |
| Addresses reserved per subnet | 5 | 5 | 4 in the primary IPv4 range |
| Firewalls | security groups (stateful, per interface) and network ACLs (stateless, per subnet) | network security groups (stateful, on subnets or network interfaces) and application security groups | VPC firewall rules and policies of Cloud NGFW (stateful, enforced at each VM) |
| Private subnets reach the internet through | NAT gateway (zonal or regional) | NAT Gateway; new virtual networks get private subnets by default with API versions released after 31 March 2026 | Cloud NAT |
| Private access to the provider's services | gateway endpoints (S3, DynamoDB) and interface endpoints (PrivateLink) | service endpoints and Private Link (private endpoints) | Private Google Access and Private Service Connect |
| Connecting networks | VPC peering, Transit Gateway, Cloud WAN, VPC Lattice | virtual network peering (also across regions), Virtual WAN | VPC Network Peering, Network Connectivity Center, Shared VPC |

The biggest structural difference is scope. A Google Cloud VPC is one global network, so a multi-region application needs no peering between regions; an AWS VPC stops at the Region, and subnets stop at the zone, which makes zone placement explicit in every subnet you create.

## Trade-offs

- **The bill hides in the plumbing** (us-east-1, October 2026). The VPC is free, but a NAT gateway costs $0.045 an hour (about $32.85 a month, so two zones cost about $65.70 before any traffic) plus $0.045 per GB processed, on top of normal data transfer. Traffic between zones costs $0.01 per GB in each direction, so a task that uses another zone's NAT gateway pays for the zone crossing on top of the NAT processing. Every public IPv4 address costs $0.005 an hour (about $3.65 a month), whether in use or idle. Interface endpoints cost $0.01 per zone per hour, and Transit Gateway attachments $0.05 an hour each. Gateway endpoints for S3 and DynamoDB are free and remove the NAT processing charge for that traffic.
- **Resilience costs per zone.** One NAT gateway per zone doubles its hourly cost; sharing one saves money but ties every zone's egress to a single zone and adds cross-zone charges. Regional NAT gateways remove the routing work but are still billed per zone.
- **The address plan is hard to change.** Blocks can't be resized, overlapping ranges can't be peered, and subnets that are too small run out: AWS keeps 5 addresses per subnet, an ALB needs 8 free ones to scale, and every task, Lambda network interface and endpoint takes addresses too. Secondary blocks and IPAM help, but renumbering a running network is a migration.
- **Quotas shape the design.** 5 VPCs per Region, 200 subnets per VPC, and security groups of 60 inbound and 60 outbound rules with 5 groups per interface are defaults that can be raised, but rule counts multiply: a prefix list referenced in a rule counts as its maximum number of entries.
- **Network rules aren't identity.** Security groups know addresses, ports and other groups, not users or services. They narrow who can connect, but any process on a task in `app-sg` can still reach the database, so authentication and authorisation have to happen above the network.
- **Stateless ACLs are easy to get wrong.** A missing rule for ephemeral reply ports breaks traffic in one direction only, which is slow to diagnose. AWS's own guidance makes security groups the primary control and ACLs an optional extra layer.
- **Visibility is delayed.** Flow logs arrive minutes later and carry no payload; to inspect packet contents, Traffic Mirroring copies the traffic of a network interface to a monitoring appliance.

## Implementation notes

**Chain the security groups and route each zone to its own NAT gateway.** The IDs are shell variables to fill in; the S3 endpoint is created as a gateway endpoint by default:

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

With a regional NAT gateway the per-zone routes collapse into one: `aws ec2 create-nat-gateway --vpc-id "$VPC_ID" --availability-mode regional` creates it, and every app subnet can share a route table that points at its single ID.

- **Define the network as code.** CloudFormation, the CDK or Terraform keep subnets, route tables and security groups reviewable; a route edited by hand in the console leaves no review trail.
- **Size subnets for growth.** A /24 gives 251 addresses. Load balancers, NAT gateways, interface endpoints, ECS tasks and Lambda interfaces all take addresses from the subnets they use, so leave room, and keep spare space in the VPC's range for subnets you will add later.
- **Send AWS traffic past the NAT gateway.** Add the free gateway endpoints for S3 and DynamoDB first. For heavily used services reached from private subnets (container images, logs, secrets), compare an interface endpoint's $0.01 per GB, plus its hourly charge in each zone, with the NAT gateway's $0.045 per GB (us-east-1).
- **Reference groups, not addresses.** Rules such as "8080 from `alb-sg`" survive scaling and redeployments; rules with task IP addresses don't.
- **Check paths before debugging packets.** Reachability Analyzer tests whether a source can reach a destination from the configuration alone and names the blocking component: a route, a security group or an ACL.
- **Turn on flow logs from the start**, so that the records exist when something is blocked; Amazon Athena can query them in S3.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Hub-and-Spoke Network](../hub-spoke-network/) — Shared services and egress in a central hub network; workloads live in peered spokes.
- [Private Endpoints](../private-endpoints/) — Reach managed cloud services over private IPs instead of the public internet.
- [Zero Trust Access](../zero-trust-access/) — No implicit trust from network location: verify identity, device and context on every request.
- [Load Balancing](../load-balancing/) — Spread requests across healthy instances and stop sending to unhealthy ones.
- [Amazon ECS & Fargate](../amazon-ecs/) — Run containers on AWS: task definitions, services that keep tasks running behind a load balancer, on EC2 or serverless Fargate.
- [Amazon RDS & Aurora](../amazon-rds-aurora/) — Managed relational databases: backups, Multi-AZ failover and read replicas, and Aurora's storage shared across three zones.
- [Amazon Route 53](../amazon-route-53/) — Managed DNS: hosted zones, routing policies (weighted, latency, failover, geolocation) and health checks.
- [AWS IAM](../aws-iam/) — Who may do what in AWS: principals, policies and roles that hand out temporary credentials, and how a request is evaluated.

## References

- [Amazon VPC User Guide — How Amazon VPC works](https://docs.aws.amazon.com/vpc/latest/userguide/how-it-works.html)
- [Amazon VPC — VPC CIDR blocks](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cidr-blocks.html)
- [Amazon VPC — Subnet CIDR blocks](https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html)
- [Amazon VPC — Subnets for your VPC](https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html)
- [Amazon VPC — Route table concepts](https://docs.aws.amazon.com/vpc/latest/userguide/RouteTables.html)
- [Amazon VPC — Enable internet access for a VPC using an internet gateway](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html)
- [Amazon VPC — NAT gateway basics](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html)
- [Amazon VPC — Regional NAT gateways for automatic multi-AZ expansion](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateways-regional.html)
- [Amazon VPC — Control traffic to your AWS resources using security groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html)
- [Amazon VPC — Control subnet traffic with network access control lists](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html)
- [Amazon VPC — Infrastructure security in Amazon VPC (security groups and network ACLs compared)](https://docs.aws.amazon.com/vpc/latest/userguide/infrastructure-security.html)
- [AWS PrivateLink — Gateway endpoints for Amazon S3](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html)
- [AWS PrivateLink — What is AWS PrivateLink?](https://docs.aws.amazon.com/vpc/latest/privatelink/what-is-privatelink.html)
- [Amazon VPC — What is VPC peering?](https://docs.aws.amazon.com/vpc/latest/peering/what-is-vpc-peering.html)
- [Amazon VPC — What is AWS Transit Gateway for Amazon VPC?](https://docs.aws.amazon.com/vpc/latest/tgw/what-is-transit-gateway.html)
- [AWS Cloud WAN — What is AWS Cloud WAN?](https://docs.aws.amazon.com/network-manager/latest/cloudwan/what-is-cloudwan.html)
- [Amazon VPC Lattice — What is Amazon VPC Lattice?](https://docs.aws.amazon.com/vpc-lattice/latest/ug/what-is-vpc-lattice.html)
- [AWS Site-to-Site VPN — What is AWS Site-to-Site VPN?](https://docs.aws.amazon.com/vpn/latest/s2svpn/VPC_VPN.html)
- [AWS Site-to-Site VPN quotas](https://docs.aws.amazon.com/vpn/latest/s2svpn/vpn-limits.html)
- [AWS Direct Connect — What is Direct Connect?](https://docs.aws.amazon.com/directconnect/latest/UserGuide/Welcome.html)
- [AWS Whitepaper — Using the NAT gateway for centralized IPv4 egress](https://docs.aws.amazon.com/whitepapers/latest/building-scalable-secure-multi-vpc-network-infrastructure/using-nat-gateway-for-centralized-egress.html)
- [Amazon Route 53 — What is Route 53 VPC Resolver?](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver.html)
- [Amazon VPC — Understanding Amazon DNS](https://docs.aws.amazon.com/vpc/latest/userguide/AmazonDNS-concepts.html)
- [Amazon VPC — Logging IP traffic using VPC Flow Logs](https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html)
- [Amazon VPC — Flow log records](https://docs.aws.amazon.com/vpc/latest/userguide/flow-log-records.html)
- [Amazon VPC — Block public access to VPCs and subnets](https://docs.aws.amazon.com/vpc/latest/userguide/security-vpc-bpa.html)
- [Amazon VPC quotas](https://docs.aws.amazon.com/vpc/latest/userguide/amazon-vpc-limits.html)
- [Amazon VPC pricing](https://aws.amazon.com/vpc/pricing/)
- [AWS PrivateLink pricing](https://aws.amazon.com/privatelink/pricing/)
- [AWS Transit Gateway pricing](https://aws.amazon.com/transit-gateway/pricing/)
- [AWS VPN pricing](https://aws.amazon.com/vpn/pricing/)
- [Amazon EC2 On-Demand pricing (data transfer within a Region)](https://aws.amazon.com/ec2/pricing/on-demand/)
- [Elastic Load Balancing — Application Load Balancers](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html)
- [Elastic Load Balancing — Target groups for your Application Load Balancers (target group health)](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html)
- [Amazon ECS — Allocate a network interface for an Amazon ECS task](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-networking-awsvpc.html)
- [Amazon ECS — Balancing an Amazon ECS service across Availability Zones](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-rebalancing.html)
- [Amazon RDS — Failing over a Multi-AZ DB instance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.Failover.html)
- [AWS Well-Architected Reliability Pillar — REL10-BP01 Deploy the workload to multiple locations](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_fault_isolation_multiaz_region_system.html)
- [Amazon VPC — What is Reachability Analyzer?](https://docs.aws.amazon.com/vpc/latest/reachability/what-is-reachability-analyzer.html)
- [Amazon VPC — What is Traffic Mirroring?](https://docs.aws.amazon.com/vpc/latest/mirroring/what-is-traffic-mirroring.html)
- [AWS CLI — create-nat-gateway](https://docs.aws.amazon.com/cli/latest/reference/ec2/create-nat-gateway.html)
- [Microsoft Learn — What is Azure Virtual Network?](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-overview)
- [Microsoft Learn — Default outbound access in Azure](https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/default-outbound-access)
- [Google Cloud — VPC networks](https://docs.cloud.google.com/vpc/docs/vpc)
- [Google Cloud — Subnets](https://docs.cloud.google.com/vpc/docs/subnets)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
