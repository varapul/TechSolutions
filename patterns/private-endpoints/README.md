<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [☁️ Cloud Infrastructure](../../README.md#cloud-infrastructure)

# Private Endpoints

> Reach managed cloud services over private IPs instead of the public internet.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Private Endpoints" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/private-endpoints.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Public endpoint** | Many managed services start out with a **public endpoint**. The app resolves `orders.db.cloud.example` to the public address `203.0.113.10` and needs a route to the internet (or a NAT gateway) to get there. Anyone else on the internet can reach the same door: only credentials and IP firewall rules keep them out, so the attacker's connection gets as far as the sign-in. |
| **2 · Add a private endpoint** | A **private endpoint** is a network interface with a private address (`10.1.2.5`) in the endpoint subnet, bound to this one database. A **private DNS zone** linked to the network answers the same name with `10.1.2.5`, so the connection string doesn't change, and the app's traffic stays on private addresses without a route to the internet. The database still checks credentials, and its public endpoint is still open. |
| **3 · Close the public door** | With **public network access disabled**, the service refuses every connection that arrives at its public address, so the attacker is turned away at the door. Clients on premises reach `10.1.2.5` over the VPN or dedicated circuit, but only if their DNS sends the name to the cloud's resolver: a **conditional forwarder** for `db.cloud.example` pointing at its inbound endpoint. Client B's DNS has no such rule, so it still gets the public address and its connection is refused. |
| **4 · The catches** | Most failures are **DNS**: which resolver answers, with which address, for which client. A network should have one endpoint per resource, so endpoints usually sit in a shared **hub** network that the spokes and on-premises sites reach. Each endpoint is **billed per hour and per GB** it processes. It is **bound to one resource**, so it can't be used to reach (or copy data to) another database on the same service; an endpoint for a whole cloud API, such as an AWS interface endpoint for S3, needs an endpoint policy for that. Service endpoints and gateway endpoints are a different thing: they keep the service's public address and only change the route. |
<!-- END GENERATED: header -->

## The problem

Many managed services (databases, storage accounts, key vaults, queues, the cloud's own APIs) are reached through a **public endpoint**: a name that resolves to an internet address the provider runs for you. That is convenient and often the starting point, and it has three consequences.

- **Anyone can knock.** Your database's sign-in is reachable from the whole internet. Credentials and IP allow-lists are all that stand between it and the world, so one leaked password, one over-broad firewall rule or one unpatched authentication flaw is enough.
- **Your private workloads need a way out.** A server in a private subnet can only reach a public address through an internet route or a NAT gateway, which is exactly the egress path many security teams want to close or inspect.
- **The path to your resource is also the path to everyone else's.** A firewall rule that lets a subnet reach a service's public addresses usually lets it reach every other customer's resources on that service too, so a compromised server, or an insider, can copy data into a storage account they own. Network rules can't tell your account from theirs.

Security baselines ask for the opposite. The Microsoft cloud security benchmark's control *NS-2: Secure cloud native services with network controls* tells you to give each service a private access point and to disable or restrict public network access where you can, and many organisations write the same rule into their own policies for anything that holds customer data.

## How it works

A **private endpoint** gives one managed resource an address inside your network. The diagram follows the usual rollout:

1. **The starting point.** The app resolves `orders.db.cloud.example` to `203.0.113.10` and leaves through NAT. The attacker reaches the same front door and is stopped only by the sign-in.
2. **Add the endpoint.** The platform creates a network interface in a subnet you choose and gives it a private address (`10.1.2.5`) that stays the same for the endpoint's lifetime. The interface is mapped to **one resource** (and on some services one sub-resource: an Azure storage account needs separate endpoints for Blob and for Files). A **private DNS zone** linked to the network answers the service's normal name with that address, so connection strings, SDKs and TLS certificates keep working unchanged. Connections can only be opened from your side: the provider has no route back into your network through the endpoint.
3. **Close the public door.** The endpoint adds a private path; it does not remove the public one. You turn public network access off on the resource itself, after which only the private path works. Networks connected over a VPN or a dedicated circuit (Azure ExpressRoute, AWS Direct Connect, Google Cloud Interconnect) reach the same private address, provided their DNS asks the right resolver.
4. **Live with the catches**: DNS, placement, cost, and the fact that each endpoint serves exactly one resource.

The resource doesn't move and its data doesn't change: only the network path and the DNS answer do.

### How each cloud does it

- **Azure: Private Link and private endpoints.** A private endpoint is a read-only network interface in your subnet, connected to a *private-link resource* (Azure SQL Database, a storage account, Key Vault, Cosmos DB and dozens more, or someone's own service). If you hold the right permission on the resource, the connection is approved automatically; otherwise it waits in *Pending* until the resource owner approves it, and only approved endpoints carry traffic. Once a resource has a private endpoint, Azure's public DNS points its name at a `privatelink` alias, for example `orders.database.windows.net` → `orders.privatelink.database.windows.net`. A private DNS zone named `privatelink.database.windows.net` (or `privatelink.blob.core.windows.net` for Blob storage), linked to your virtual networks, answers that alias with the private address; everyone else follows the public chain to the public address. A *DNS zone group* on the endpoint keeps the A record in step with the endpoint. Each resource has its own **public network access** setting: with it set to *Disabled*, Azure SQL Database refuses public connections with error 47073 and won't let you edit its IP firewall rules any more.
- **AWS: PrivateLink interface endpoints.** An interface VPC endpoint puts a network interface in one subnet per Availability Zone you select, protected by security groups. With **private DNS** enabled (the VPC needs DNS hostnames and DNS resolution turned on), AWS associates a hidden private hosted zone with the VPC, so the service's usual name, such as `sqs.us-east-1.amazonaws.com`, resolves to the endpoint's addresses; every endpoint also gets Regional and zonal `vpce` names. Interface endpoints reach AWS services and the *endpoint services* that other accounts publish; a **resource endpoint** reaches a single resource, such as one database, that an account shares as a resource configuration. An interface endpoint for an AWS service reaches the whole regional service, not one bucket or one queue, which is why endpoint policies matter there (see below).
- **AWS: gateway endpoints for S3 and DynamoDB.** These are not PrivateLink. A gateway endpoint adds a route, whose destination is the service's prefix list, to the route tables you choose, and traffic still goes to the service's **public** addresses, without an internet gateway or NAT. They are free, but they only work from inside that VPC: not from on premises, and not from another Region. Both services also offer interface endpoints for the cases that need them.
- **Google Cloud: Private Service Connect.** An endpoint is a forwarding rule holding an internal IP address in your VPC network. It points either at **Google APIs** (a single global internal address that serves the `all-apis` or `vpc-sc` bundle, with DNS names such as `storage-xyz.p.googleapis.com`) or at a **published service** through its service attachment, such as a managed database or a partner's SaaS. Endpoints for published services are regional unless you enable *global access*. Private Service Connect also offers *backends* (a load balancer in front of the service, for your own certificates and controls) and *interfaces* (for a producer that needs to open connections into your network). Private Google Access, a per-subnet setting, lets instances without external addresses reach Google APIs while those APIs keep their public addresses: it changes how you get there, not where you connect.

Some services avoid the question by running inside your network in the first place: Amazon RDS places a database's network interfaces in your VPC's subnets, and several Azure services can be deployed into a virtual network subnet. Azure's **service endpoints** sit in between: the service keeps its public address and its public DNS answers, but traffic from the enabled subnet takes an optimised route over the Microsoft backbone with your private source address, so the resource's firewall can allow that subnet. They cost nothing, can't be used from on premises, and Microsoft recommends private endpoints for private access.

### Offering your own service privately

Every provider runs the same mechanism in reverse, so a SaaS vendor or a platform team can offer a service to other networks without peering whole networks together:

- **Azure Private Link service:** put the service behind a Standard Load Balancer and create a Private Link service. Consumers create private endpoints to it by resource ID or by an alias you share, across subscriptions and tenants, and you approve each connection (or auto-approve listed subscriptions). The Private Link service itself has no charge; consumers pay for their endpoints.
- **AWS endpoint service:** put a Network Load Balancer in front of the service, allow the AWS principals who may connect, and accept their connection requests. Consumers create interface endpoints to it. You can attach a private DNS name so consumers keep using your usual hostname, and enable cross-Region access so consumers in other Regions can connect. Spread the load balancer over at least two Availability Zones.
- **Google Cloud published service:** create a service attachment that targets the service's internal load balancer, with an accept list of consumer projects or networks and a NAT subnet for the translated traffic. Consumers connect with endpoints or backends.

Traffic reaches the producer from the platform's own translated addresses, not from the consumer's network, so the two sides never need to route to each other. If the service needs to know the original client, look for the platform's way of passing it on, such as the Proxy Protocol v2 header from an AWS Network Load Balancer.

### DNS design

The endpoint is the easy part; DNS decides whether anyone uses it.

- **Private zones linked to networks.** A private zone answers only for the networks it is linked to. In a hub-and-spoke network, create each zone once, centrally, and link it to the hub and every spoke that has clients. Azure warns that separate zones with the same name in different networks have to be merged by hand.
- **One answer per name.** A network that shares one DNS configuration should have one endpoint per resource. On Azure that is the recommended practice, because two endpoints for the same resource fight over the same record; on AWS, a second interface endpoint for the same service in a VPC fails with a conflicting-DNS-domain error if it also asks for private DNS.
- **Resolvers with inbound and outbound endpoints.** On-premises DNS servers can't query the cloud's built-in resolver directly. Each cloud gives you an address to forward to: an **inbound endpoint** of Azure DNS Private Resolver, an inbound endpoint of Route 53 VPC Resolver (renamed from Route 53 Resolver), or the entry points of a Cloud DNS *inbound server policy*. Going the other way, **outbound endpoints** with forwarding rules let cloud workloads resolve on-premises names.
- **Conditional forwarders on premises.** Forward the service's zone to that inbound address. On Azure, forward the public zone (`database.windows.net`), not the `privatelink` one: the CNAME chain then starts at the cloud resolver, which can see the private zone.
- **Split-horizon pitfalls.** The same name has two answers, and which one a client gets depends on whom it asks. Watch for:
  - **Shadowed zones.** Don't create a private zone for a whole public domain (`blob.core.windows.net`): every name in it that has no record then fails.
  - **Someone else's endpoint.** If you link `privatelink.blob.core.windows.net` and then reach another organisation's storage account that has its own private endpoint, your zone has no record for it and answers *NXDOMAIN*. Azure's *fallback to internet* setting on the zone's network link retries such names publicly.
  - **Silent public fallbacks.** A client whose DNS doesn't forward (client B) gets the public address. With public access still enabled it connects over the internet without anyone noticing, which is one more reason to turn public access off: the mistake becomes an error.
  - **Caching.** Resolvers cache answers, including negative ones, so a fixed record can take a while to reach clients.

### Disabling public access, and proving it

- **Turn it off on the resource:** Azure's *public network access* setting; for AWS services, which keep their public regional endpoints, a resource policy such as an S3 bucket policy that denies requests that don't arrive through your endpoint (`aws:SourceVpce`); on Google Cloud, a VPC Service Controls perimeter, which blocks access to Google APIs and resources from outside it unless a rule allows it. Mind the side effects: AWS points out that such a bucket policy also blocks the S3 console, which doesn't come through your endpoint.
- **Check the defaults, then make your own.** They differ by service: Azure SQL Database's public network access defaults to disabled, and Azure App Configuration has an *Automatic* mode that closes public access as soon as the store has a private endpoint. Don't rely on either: use policy as code (Azure Policy has built-in definitions such as *Storage accounts should disable public network access* and *Azure Key Vault should disable public network access*) so a new resource can't be created open, and alert on changes.
- **Test it from both sides:** from outside, a connection must be refused; from each client network, the name must resolve to the private address and the connection must work. Public DNS still answers for the name after you close the door. Azure points out that this reveals only that the resource exists, not that it is reachable.

### Endpoint and resource policies

- **AWS endpoint policies** limit what can be done *through* an endpoint: for example, only `s3:GetObject` and `s3:PutObject`, and only on buckets in your own account. This is how you stop an interface or gateway endpoint for S3 from becoming a path to someone else's bucket.
- **Resource policies** limit who can reach the resource: an S3 bucket policy with `aws:SourceVpce` admits only requests that come through your endpoint.
- **Network rules** still apply: security groups on AWS interface endpoints; on Azure, network security groups and route tables on the endpoint subnet once network policies are enabled for private endpoints.
- **Azure service endpoint policies** do for service endpoints what the one-resource binding does for private endpoints: they let a subnet's service endpoint reach only the resources you list.

### Availability

- **AWS:** select a subnet in at least two Availability Zones. The Regional name spreads clients across healthy endpoint interfaces; a zonal name keeps traffic in one zone (useful for zone isolation and to avoid cross-zone transfer).
- **Azure:** private endpoints and virtual networks span availability zones, so the endpoint itself is zone resilient; make sure the resource behind it is too. An endpoint can connect to a resource in another region, and for disaster recovery you want endpoints, and DNS records, ready for the secondary region's resources before you fail over.
- **Google Cloud:** endpoints for published services are regional; enable global access when clients in other regions must use them.

### Cost

- **Azure:** an hourly charge per private endpoint, plus a per-GB charge for data processed in each direction. Traffic to private endpoints over regional virtual network peering carries no peering fee.
- **AWS:** an hourly charge per interface endpoint *per Availability Zone*, plus a per-GB processing charge that steps down at very large volumes. Resource endpoints have their own hourly charge. Gateway endpoints are free.
- **Google Cloud:** an hourly charge per endpoint; endpoints for published services also pay per GiB processed, while endpoints for Google APIs have no data charge.

Endpoints add up: one per resource, per sub-resource, per zone and per network that needs one is a real line item, and another reason to share them from a hub.

## When to use it

- Databases, storage and secrets that hold data you must not expose, especially under a policy or regulation that rules out public network access.
- Workloads in networks without internet egress, or where egress must go through an inspecting firewall.
- Reaching cloud services from on premises over VPN or a private circuit with private addresses, instead of over the internet.
- Limiting **data exfiltration**: a subnet that can reach only *your* resources is much harder to misuse than one that can reach the whole service.
- Offering your own service privately to other teams or to customers, as a producer.

**When not to use it:**

- **Public APIs you don't control.** You can only create an endpoint to something the provider offers as a private service. Third-party APIs without a private offering stay on the internet: protect those calls with egress controls and authentication.
- **Clients that live on the internet anyway.** Browsers and mobile apps can't use your private endpoint: the public edge (an [API gateway](../api-gateway/), a CDN, a web application firewall) is where they belong.
- **Small or low-risk environments** where the per-endpoint cost and the DNS work outweigh the risk, or where a free route-only option (service endpoints, gateway endpoints, Private Google Access) already meets the requirement.

## Trade-offs

- **DNS becomes critical infrastructure.** Every client network needs the right zone or forwarder, and most outages after a rollout are name-resolution problems, often only for some clients.
- **More things to run:** endpoint subnets and their address space, approvals, zone links, forwarders, and quotas on the number of endpoints.
- **Cost scales with the number of resources, zones and networks**, plus every gigabyte that flows through.
- **Some tools stop working.** Anything that reaches the resource from outside your networks (a cloud console's data browser, a SaaS integration, a build agent on the internet) loses access once the public door is closed.
- **Private is not the same as trusted.** The endpoint narrows *where* connections can come from; it doesn't decide *who* may do *what*. A compromised server inside the network still reaches the database's sign-in.

## Implementation notes

- **Troubleshoot from the client, starting with DNS.** Resolve the name *on the client that fails*, with `nslookup` or `dig`, and expect the private address. A public answer means the DNS path is wrong: a missing zone link, a missing forwarder, the wrong zone, or a client that uses another resolver. Then test the TCP port to the private address, then the security group or network security group on the endpoint and the route back from on premises, then the endpoint's connection state (an Azure endpoint stuck in *Pending* carries no traffic), and only then credentials.
- **Keep connecting by name.** Connect with the service's usual hostname, not the IP address and not an internal alias: the hostname is what the server's TLS certificate is checked against.
- **Give endpoints their own subnet**, sized for growth, with network rules that admit only the clients that need each resource.
- **Use the recommended zone names.** Azure only creates the DNS records for you when the private zone has the recommended name for the service.
- **Watch the traffic.** Azure Monitor shows the data each private endpoint processes, and AWS can alert on endpoint events. Azure's NSG flow logs don't capture inbound traffic to private endpoints, so log at the resource as well.
- **Combine it with identity.** Treat the private path as one layer: keep strong, per-request authentication and authorisation on the resource, as in [zero trust access](../zero-trust-access/), so being inside the network never grants trust on its own.
- **Keep encrypting.** Private addresses are not a reason to drop TLS. If both ends must prove who they are, use [mutual TLS](../mutual-tls/) on top.
- **Plan for regions.** For [multi-region active-active](../multi-region-active-active/) or disaster recovery, create endpoints and DNS records for each region's resources in advance, and test the failover with the endpoints in place.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- Hub-and-Spoke Network *(planned)* — Shared services and egress in a central hub network; workloads live in peered spokes.
- [Zero Trust Access](../zero-trust-access/) — No implicit trust from network location: verify identity, device and context on every request.
- [Mutual TLS (mTLS)](../mutual-tls/) — Client and server both present certificates, so every connection is authenticated both ways.
- Gatekeeper *(planned)* — A hardened broker validates and sanitises requests before they reach trusted hosts.
- [Valet Key](../valet-key/) — Give clients a short-lived, narrowly scoped URL to read or write storage directly.
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- [Multi-Region Active-Active](../multi-region-active-active/) — Serve users from several regions at once and shift traffic away from a region that fails.

## References

- [Microsoft Learn — What is a private endpoint?](https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-overview)
- [Microsoft Learn — What is Azure Private Link?](https://learn.microsoft.com/en-us/azure/private-link/private-link-overview)
- [Microsoft Learn — Azure Private Endpoint DNS integration scenarios](https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns-integration)
- [Microsoft Learn — Azure Private Endpoint private DNS zone values](https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns)
- [Azure Architecture Center — Azure Private Link in a hub-and-spoke network](https://learn.microsoft.com/en-us/azure/architecture/networking/guide/private-link-hub-spoke-network)
- [Microsoft Learn — Azure SQL Database connectivity settings (public network access)](https://learn.microsoft.com/en-us/azure/azure-sql/database/connectivity-settings)
- [Microsoft Learn — Azure virtual network service endpoints](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-network-service-endpoints-overview)
- [AWS PrivateLink — Access AWS services through AWS PrivateLink (interface endpoints)](https://docs.aws.amazon.com/vpc/latest/privatelink/privatelink-access-aws-services.html)
- [AWS PrivateLink — Gateway endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html)
- [AWS PrivateLink — Share your services through AWS PrivateLink](https://docs.aws.amazon.com/vpc/latest/privatelink/privatelink-share-your-services.html)
- [Amazon Route 53 — What is Route 53 VPC Resolver? (inbound and outbound endpoints)](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver.html)
- [Google Cloud — Private Service Connect](https://docs.cloud.google.com/vpc/docs/private-service-connect)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
