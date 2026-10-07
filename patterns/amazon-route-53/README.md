<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🟧 AWS Services](../../README.md#aws-services)

# Amazon Route 53

> Managed DNS: hosted zones, routing policies (weighted, latency, failover, geolocation) and health checks.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Amazon Route 53" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/amazon-route-53.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Before any request reaches Acme Shop, the phone's recursive resolver (the ISP's or a public one) asks Route 53's name servers where a name points. In the public hosted zone `shop.example`, the zone apex is an **alias** to the CloudFront distribution and `api.shop.example` leads to the closest healthy Application Load Balancer: the one in Asia Pacific (Thailand), `ap-southeast-7`, for a user in Chiang Mai, with Asia Pacific (Singapore), `ap-southeast-1`, as the alternative. Inside the VPC, the **private hosted zone** `acme.internal` answers `db.acme.internal` with the RDS endpoint through the VPC Resolver at `10.0.0.2`; outside the VPCs it is associated with, the name doesn't resolve. |
| **2 · One lookup, end to end** | With a cold cache, the resolver walks the delegation: the root servers refer it to the `.example` servers, which name the zone's four Route 53 name servers (resolvers usually keep those for two days), and the nearest copy of one of them answers over anycast. The **weighted** records for `api` send 90% of lookups to `stable.api` and 10% to the canary, and the **latency** records under `stable.api` return the ALB in the Region with the lowest latency for this resolver, Thailand. Every record in `shop.example` is an **alias**: Route 53 answers with the target's current addresses, an alias works at the zone apex where a CNAME can't, queries to AWS targets are free, and the TTL is the target's, 60 seconds for a load balancer, so the resolver caches the answer for 60 seconds. |
| **3 · Health checks and failover** | Route 53 **health checkers** in eight AWS Regions send `HTTPS /health` to each ALB every 30 seconds; a check passes when the connection opens within 4 seconds and a 2xx or 3xx status arrives within 2 seconds. A checker counts `api-th` as down after 3 failures in a row, and once 18% or fewer of the checkers still see it healthy, Route 53 marks it **unhealthy** and stops returning it: `stable.api` answers with the next-lowest latency, Singapore, and `status.shop.example` **fails over** from the primary to the static page in S3. The weighted pair still sends 10% of `api` lookups to the canary, and the resolver keeps its cached Thailand answer until the 60-second TTL runs out. |
| **4 · Limits and costs** | DNS failover is only as fast as the caches: up to about 90 seconds to detect the failure (3 checks 30 seconds apart), plus up to 60 seconds of TTL, plus any resolver or app that keeps answers longer than told. Health checkers work from the internet, so they can't probe private IP addresses (a health check can follow a **CloudWatch alarm** instead), and weights split lookups, not requests. Prices (October 2026): $0.50 a month per hosted zone, $0.40 per million standard queries ($0.60 for latency records), nothing for alias queries to AWS resources, for queries to private zones or for health checks on up to 50 AWS endpoints (beyond those, $0.50 a month per check plus $1.00 for HTTPS); for a Region switch you decide yourself, **Amazon Application Recovery Controller** (ARC) routing controls flip failover records, and **DNSSEC** signing lets resolvers verify the answers. |
<!-- END GENERATED: header -->

## The problem

Acme Shop sells to customers across Southeast Asia. The storefront `shop.example` is served by a CloudFront distribution, the API runs behind Application Load Balancers in two Regions, Asia Pacific (Thailand) `ap-southeast-7` and Asia Pacific (Singapore) `ap-southeast-1`, a status page has to stay reachable when the API is down, and a new version of the API should get a small slice of traffic before it gets all of it. Inside the VPC, the application needs a stable name for its database, `db.acme.internal`, that the internet never sees.

Every one of those visits begins with a DNS lookup, so DNS decides where the traffic goes. A user in Chiang Mai should get the Thailand load balancer, and when that load balancer stops answering, new lookups should get Singapore without anyone editing records at night. Running authoritative DNS yourself means a fleet of name servers spread around the world and hardened against DDoS, health checks from several places, and a way to point the bare domain `shop.example` at a CloudFront distribution even though DNS forbids a CNAME there. Amazon Route 53 is AWS's managed DNS service: it hosts the zones on its own name servers, answers with routing decisions based on latency, weights, health and location, checks the health of the endpoints, and also answers private names inside VPCs.

## How it works

### One lookup, from resolver to answer

A phone doesn't ask Route 53 directly. It asks a **recursive resolver**, usually run by the ISP or a public resolver service, and the resolver does the work. With an empty cache it starts at the root servers, which refer it to the servers of the top-level domain, which in turn refer it to the four **authoritative** name servers listed for the zone in its NS records. Only those authoritative servers hold the answer. The resolver then caches every answer for as long as its **TTL** (time to live) says, so most lookups never leave the resolver; Route 53's guide notes that resolvers typically keep the name servers of a domain for two days. These concepts come from RFC 1034 and RFC 1035, the core DNS specifications from 1987.

In the diagram the domain is `shop.example`. The `.example` top-level domain is reserved for documentation by RFC 2606, so in a real lookup the middle step would be the servers of `.com`, `.co.th` or whichever TLD the domain belongs to.

Resolvers also cache answers that say a name doesn't exist (NXDOMAIN) or has no record of the requested type (NODATA). RFC 2308 bounds this **negative caching** by the zone's SOA record, and Route 53 documents it as the lower of the SOA record's own TTL and the minimum TTL inside it. The SOA record's TTL is 900 seconds by default and the guide's example SOA carries a minimum TTL of 86,400 seconds, so a resolver remembers "no such name" for 15 minutes; a record you add right after someone looked it up can take that long to appear for them.

Route 53 can only use the resolver's address to judge where a user is, unless the resolver supports the EDNS Client Subnet extension (RFC 7871) and passes on a shortened version of the user's address. Route 53 uses that value for latency, geolocation, geoproximity and IP-based routing when it's there.

### Hosted zones and name servers

A **public hosted zone** holds the records for a domain on the internet. When you create one, Route 53 assigns it four name servers and writes them into the zone's NS record, together with an SOA record; the guide's example names, `ns-2048.awsdns-64.com`, `ns-2049.awsdns-65.net`, `ns-2050.awsdns-66.org` and `ns-2051.awsdns-67.co.uk`, sit under four different top-level domains. The zone only goes live when the registrar of the domain lists those four servers, which is the delegation step the resolver follows. Route 53 serves the zones from a global **anycast** network, so a query to any of the four names is answered from whichever Route 53 location suits the resolver's network best.

A **private hosted zone** answers only inside the VPCs it is associated with (up to 300 per zone; Route 53 Profiles cover more). The VPC needs both `enableDnsHostnames` and `enableDnsSupport` set to true, and the instances or tasks in it ask the **VPC Resolver** at the base of the VPC's range plus two, `10.0.0.2` for Acme Shop's `10.0.0.0/16` (see [Amazon VPC](../amazon-vpc/)). Acme Shop's private zone is `acme.internal`; ICANN reserved the `.internal` top-level domain in July 2024 for private use, so it can never collide with a public name. Its record `db.acme.internal` is a CNAME to the endpoint name of the [RDS](../amazon-rds-aurora/) database, so code and configuration use one name that survives a database replacement. Queries to private zones are free.

A public and a private zone can share a name, which gives **split-view DNS**: users inside the VPC see the private answers, everyone else the public ones. The VPC Resolver uses the most specific matching zone. If a private zone matches the name but has no record of the requested type, the resolver answers NXDOMAIN and doesn't fall back to the public zone, a frequent surprise when a private zone shadows part of a public domain.

### Records, aliases and the zone apex

Route 53 supports the usual record types, among them A and AAAA (addresses), CNAME (another name), MX (mail servers), TXT (free text, for example domain verification), CAA (which certificate authorities may issue certificates for the domain), NS, SOA, SRV, PTR, DS, HTTPS, SVCB, SSHFP and TLSA.

A CNAME can't sit at the **zone apex** (`shop.example` itself). RFC 1034 says that a name holding a CNAME should hold no other data, and the apex must hold the zone's SOA and NS records. That rules out the obvious way to point a bare domain at a CloudFront distribution or a load balancer, whose addresses change.

Route 53's answer is the **alias record**, an extension of its own. An alias has an ordinary type (A or AAAA) and points at an AWS resource or at another record in the same zone; Route 53 resolves the target itself and answers with its current addresses, so the client sees a plain A record. Alias targets include CloudFront distributions, Elastic Load Balancing load balancers, S3 buckets configured as static websites, API Gateway APIs, VPC interface endpoints, Global Accelerator accelerators, Elastic Beanstalk environments, App Runner services, AppSync domains, [OpenSearch](../elasticsearch/) Service custom domains and VPC Lattice services. Three properties make aliases the default for AWS targets:

- **They work at the apex.** `shop.example` is an alias A record to the distribution.
- **Queries to AWS targets are free.** Route 53 charges nothing for alias queries whose target is one of the supported AWS resources, including a chain of aliases that ends at one, while a CNAME to another Route 53 record is billed as two queries.
- **The TTL is the target's.** You can't set a TTL on an alias to an AWS resource; Route 53 uses the resource's default, which Elastic Load Balancing documents as 60 seconds. An alias to another record in the zone uses that record's TTL.

An alias can also take over the health of its target with **Evaluate Target Health**. For an Application or Network Load Balancer, the load balancer counts as healthy only when every target group that has targets contains at least one healthy target, and a target group with no targets counts as unhealthy. This option isn't available for CloudFront distributions.

### Routing policies

Every record has one routing policy, and all records with the same name and type must share it: you can't create latency records next to weighted records for the same name.

| Policy | Route 53 answers with | In private zones | Acme Shop uses it for |
|---|---|---|---|
| Simple | the record's value or values | yes | `shop.example` (an alias to CloudFront) |
| Weighted | one record, chosen with a probability equal to its weight (0 to 255) divided by the sum of the weights | yes | `api`: 90 to `stable.api`, 10 to the canary ALB |
| Latency | the record in the AWS Region with the lowest latency for the user's network, from AWS's own measurements, which change over time | yes | `stable.api`: Thailand or Singapore |
| Failover | the primary record while it is healthy, otherwise the secondary | yes | `status`: the Thailand ALB, then a static page in S3 |
| Geolocation | the record for the user's continent, country or US state; the most specific match wins, and a default record catches addresses with no known location | yes | |
| Geoproximity | the nearest resource by distance, set as an AWS Region, a Local Zone group or a latitude and longitude, with a bias from −99 to 99 that shrinks or grows its area | yes | |
| IP-based | the record mapped to the CIDR block the query comes from, from CIDR collections you upload (IPv4 prefixes /1 to /24, IPv6 /1 to /48) | no | |
| Multivalue answer | up to eight healthy records, roughly at random, a simple spread that doesn't replace a load balancer | yes | |

Policies combine through aliases. `api.shop.example` has two weighted alias records: weight 90 points at `stable.api.shop.example` and weight 10 at the ALB `api-v2` that runs the new version. `stable.api` has two latency alias records, one per Region, each pointing at that Region's ALB. A weight of 0 stops traffic to a record; if every record in the group has weight 0, Route 53 picks among them with equal probability. A group of weighted, latency, geolocation, multivalue or IP-based records can hold up to 100 records with the same name and type, and a geoproximity group up to 30.

### Health checks

Route 53 health checks come in three kinds:

- **Endpoint checks** send HTTP, HTTPS or TCP requests to an IP address or domain name. For HTTP and HTTPS, a checker has to open the TCP connection within 4 seconds and then receive a status code from 200 to 399 within 2 seconds; HTTPS checks don't validate the certificate. With string matching, the text must appear in the first 5,120 bytes of the body.
- **Calculated checks** combine up to 255 other health checks, for example "healthy if at least two of the three Regions are".
- **[CloudWatch](../amazon-cloudwatch/) alarm checks** follow the data stream of a CloudWatch alarm in the same account. They are the way to cover resources that the checkers can't reach, and `InsufficientDataHealthStatus` decides what happens when the alarm has no data.

For an endpoint check you choose the `RequestInterval`, 30 seconds by default or 10 seconds ("fast", at extra cost, and fixed once the check exists), and the `FailureThreshold`, from 1 to 10 consecutive results (3 by default) that flip the status. The checkers run in eight AWS Regions: `us-east-1`, `us-west-1`, `us-west-2`, `eu-west-1`, `ap-southeast-1`, `ap-southeast-2`, `ap-northeast-1` and `sa-east-1`. You can limit a check to at least three of them. The checkers don't coordinate, so at a 30-second interval the endpoint gets a request about every two seconds on average, sometimes several at once. Route 53 combines their reports and considers the endpoint healthy while more than 18% of the checkers see it healthy, so a network problem between the endpoint and one checking location doesn't fail it. A new health check counts as healthy until enough data has arrived.

The checkers sit on the internet, outside your VPCs: they can't check addresses in private, local or other non-routable ranges. To fail over a record in a private zone, such as a primary and a standby database behind `db.acme.internal`, base the health check on a CloudWatch alarm instead. If the endpoint only admits known addresses, the checkers' ranges are published in `ip-ranges.json` under `ROUTE53_HEALTHCHECKS`.

When Route 53 answers a query, it doesn't run a health check; it looks up the status the checkers keep up to date. For each record it would return, it asks: is the associated health check healthy, or, for an alias with Evaluate Target Health, is the target healthy? If not, it picks again by the same policy among the remaining records. For latency records, that means the record with the next-lowest latency, which is how lookups for `stable.api` move from Thailand to Singapore. A few rules shape the edge cases:

- A record without a health check always counts as healthy.
- If every record in the group is unhealthy, Route 53 treats them all as healthy and answers anyway, because it has to answer something.
- Records with weight 0 are only used when all records with a higher weight are unhealthy.
- Failover returns the primary while it is healthy and the secondary otherwise. If both have health checks and both fail, it returns the primary; a secondary without a health check is always returned once the primary fails.

Route 53 publishes `HealthCheckStatus` (1 or 0) and `HealthCheckPercentageHealthy` to CloudWatch, in US East (N. Virginia) only, so alarms on them live in `us-east-1`.

### How long a failover takes

DNS failover is only as fast as its slowest cache. With Acme Shop's settings, three failed checks 30 seconds apart take up to about 90 seconds; then resolvers that cached the Thailand answer keep it for up to its 60-second TTL, about two and a half minutes in all. Some clients ignore TTLs: AWS's SDK guide for Java notes that some JVM configurations never refresh a DNS lookup until restart, and recommends a TTL of 5 seconds through the `networkaddress.cache.ttl` security property. Clients also resolve a name only when they open a connection, so connections that stay open keep talking to the old Region. Fast checks (10 seconds × 3) and short TTLs cut the time but cost more checks and more queries; the Route 53 FAQ recommends a TTL of 60 seconds or less for records that use DNS failover.

### DNSSEC

Route 53 can **sign** public hosted zones with DNSSEC, so validating resolvers can tell that an answer really came from the zone and wasn't altered on the way. The key-signing key (KSK) is backed by a customer managed key in AWS KMS that must be asymmetric with the `ECC_NIST_P256` key spec and live in US East (N. Virginia); you own its rotation, Route 53 manages the zone-signing key, and a zone can have two KSKs. After signing is on, a DS record in the parent zone, added through the registrar, establishes the chain of trust. While signing is on, Route 53 caps record TTLs at one week, and the zone can't be served by several DNS providers at once. AWS recommends CloudWatch alarms on `DNSSECInternalFailure` and `DNSSECKeySigningKeysNeedingAction`, because a broken signature makes the domain unreachable for validating resolvers. Route 53 charges nothing for signing; the KMS key is billed as usual. On the other side, the VPC Resolver can **validate** DNSSEC for the names your VPCs look up.

### Route 53 VPC Resolver and hybrid DNS

Every VPC has a Route 53 **VPC Resolver** at its base address plus two. It was called Route 53 Resolver until Route 53 Global Resolver arrived. It answers private hosted zones and the VPC's own names and resolves everything else recursively on the internet. For hybrid networks, **inbound endpoints** let DNS servers on premises resolve names in the VPC, and **outbound endpoints** with **forwarding rules** send queries for chosen domains (for example `corp.example`) to DNS servers on premises; rules can be shared with other accounts through AWS RAM, which suits a [hub-and-spoke network](../hub-spoke-network/). Each endpoint uses at least two IP addresses, one network interface each.

**Resolver DNS Firewall** filters the queries that leave a VPC through the VPC Resolver against allow and block lists, mainly to stop data from leaking out through DNS lookups. **Route 53 Profiles** apply one set of private zones, forwarding rules and firewall rule groups to many VPCs and accounts. **Route 53 Global Resolver** is a separate, internet-reachable resolver on anycast addresses for clients on premises and on the road, with encrypted DNS (DNS over HTTPS or TLS) and filtering.

### Domain registration

Route 53 is also a registrar: you can register or transfer a domain, with prices that depend on the TLD, up to 20 domains per account by default. Registering a domain creates a public hosted zone of the same name, and DNSSEC is supported for registered domains.

### Application Recovery Controller

Health-check failover is automatic, which is what you want when a load balancer stops answering, but not always: a Region can be degraded in ways a `/health` endpoint doesn't show, or you may want to move traffic before a planned event. **Amazon Application Recovery Controller** (ARC; the CLI and some pages still call it Route 53 ARC) adds **routing controls**: on and off switches that appear in Route 53 as health checks of a special type and are attached to failover records. You flip them through a cluster of endpoints in five AWS Regions, and safety rules guard against unintended results such as routing that fails open. ARC's **Region switch** orchestrates a whole multi-Region recovery plan, and zonal shift moves traffic away from one Availability Zone. The readiness check feature has been closed to new customers since 30 April 2026.

This matters because Route 53 is a global service with its control plane in `us-east-1`: creating or changing records needs that control plane, while answering queries and running health checks are data-plane work spread across many locations. AWS's fault-isolation guidance is not to depend on control-plane operations such as editing records during a recovery. Health checks, and routing controls, keep working through the data plane.

### Quotas and prices

Defaults and prices as of October 2026 (public AWS Regions):

| Item | Value |
|---|---|
| Hosted zones | 500 per account by default; $0.50 per zone per month for the first 25, $0.10 after that; a zone deleted within 12 hours of its creation isn't charged |
| Records | 10,000 per hosted zone included; each further record $0.0015 a month |
| Queries, per million (first billion a month) | standard $0.40, latency $0.60, geolocation and geoproximity $0.70, IP-based $0.80; above a billion, half these rates |
| Queries that cost nothing | alias queries to supported AWS resources, and every query to a private hosted zone |
| Health checks | 200 active per account by default; basic check $0.50 a month for an AWS endpoint, $0.75 for others; HTTPS, string matching, the 10-second interval and latency measurement $1.00 each a month ($2.00 for non-AWS endpoints); up to 50 checks of AWS endpoints in the same account are free; health of ELB load balancers and S3 website endpoints through Evaluate Target Health costs nothing |
| VPC Resolver endpoints | $0.125 per network interface per hour, plus $0.40 per million queries that pass through them |
| DNS Firewall | $0.60 per million queries inspected (first billion), plus $0.0005 a month per domain in your own lists |
| Traffic Flow | $50 per policy record per month |
| DNSSEC signing | no Route 53 charge; KMS charges for the key |
| ARC routing control | $2.50 per cluster per hour, up to 2 clusters per account |

## Where it fits

- **Solutions.** For a system whose domain is hosted in Route 53, every visit starts there: it points the domain at CloudFront, load balancers, API Gateway or S3 websites, and in private zones it names databases, caches and internal services. In multi-Region designs it is often the first layer of traffic steering.
- **Patterns in this catalog.** Latency records with health checks implement [multi-Region active-active](../multi-region-active-active/); failover records implement [active-passive failover](../active-passive-failover/) and the DNS step of most [disaster recovery strategies](../disaster-recovery-strategies/). Weighted records shift traffic for a [canary release](../canary-release/) or a [blue-green deployment](../blue-green-deployment/) cutover, an alias at the apex puts [CDN and edge caching](../cdn-edge-caching/) in front of the site, and its health checks probe the endpoints described in [health endpoint monitoring](../health-endpoint-monitoring/). Private zones and Resolver rules give [private endpoints](../private-endpoints/) and [hub-and-spoke networks](../hub-spoke-network/) their names.
- **Usual neighbours.** CloudFront, Elastic Load Balancing, [Amazon S3](../amazon-s3/) static website endpoints for status and maintenance pages, API Gateway, [Amazon VPC](../amazon-vpc/) and its VPC Resolver, [Amazon RDS and Aurora](../amazon-rds-aurora/) endpoint names, CloudWatch for health-check alarms, AWS KMS for DNSSEC keys, and AWS Global Accelerator when DNS caching is too slow.
- **Managed offerings.** Route 53 is itself the managed service, with an SLA per hosted zone. Other clouds offer the same building blocks as Azure DNS with Azure Traffic Manager and Google Cloud DNS; Cloudflare offers authoritative DNS with a Load Balancing add-on.

## When to use it

Use Route 53 for the public and private DNS of workloads that run on AWS. Alias records to AWS resources answer at the apex, follow the resources' changing addresses, cost nothing per query and can inherit their health; private zones and the VPC Resolver come with every VPC. Use DNS routing (latency, failover, weighted) when the decision can be made once per lookup and a delay of a few minutes is acceptable.

When failover has to be faster than caches allow, or every request has to land precisely, steer below DNS: a load balancer within a Region, CloudFront origin failover for content, or AWS Global Accelerator, which gives clients two static anycast IPv4 addresses and sends their traffic over the AWS network to endpoints in the nearest Region; because the addresses never change, moving traffic doesn't wait for resolvers to forget an answer.

| | Amazon Route 53 | Cloudflare DNS | Azure DNS + Traffic Manager | Google Cloud DNS |
|---|---|---|---|---|
| Name at the zone apex | alias records to AWS resources or to another record in the zone | CNAME flattening | alias record sets to Azure resources, such as a Traffic Manager profile, a public IP or a CDN endpoint | the ALIAS record type (in preview), at the apex only |
| Steering in DNS | eight routing policies on the records themselves | the Load Balancing add-on: standard (failover or random), geo, dynamic, proximity and least-outstanding-requests steering | Traffic Manager profiles: priority, weighted, performance, geographic, multivalue and subnet | routing policies: weighted round robin, geolocation (optionally fenced) and failover |
| Health checks | from eight AWS Regions; endpoint, calculated or CloudWatch-alarm checks | monitors of the Load Balancing add-on, from regions you pick | Traffic Manager probes every 30 or 10 seconds, with 0 to 9 tolerated failures | for internal load balancers and external endpoints |
| Private DNS | private hosted zones associated with VPCs | Internal DNS, for Enterprise customers with Cloudflare Gateway | Azure Private DNS zones linked to virtual networks | private zones for VPC networks, plus forwarding and peering zones |
| Pricing shape (October 2026) | per zone and per million queries; alias queries to AWS resources free | DNS included on all plans, including Free; Load Balancing is a paid add-on | per zone and per million queries; Traffic Manager per million queries and per monitored endpoint | per zone and per million queries; $0.40 per million, $0.70 with routing policies |

Choose by where the workload runs and where the rest of the edge sits. Cloudflare suits a site already behind Cloudflare's proxy, Azure DNS with Traffic Manager an Azure estate, and Cloud DNS a Google Cloud one; Route 53's integration with AWS resources (aliases, Evaluate Target Health, private zones per VPC) is what you give up by moving AWS workloads' DNS elsewhere.

## Trade-offs

- **Caches set the pace.** Every routing decision is cached for a TTL by resolvers you don't control, and some resolvers and clients keep answers longer. Health-check failover takes minutes, not seconds, and connections that are already open don't move.
- **Splits are per lookup.** A weight of 10 means 10% of lookups. One busy resolver caches one answer for all the users behind it, so with few large resolvers the real split of requests can drift far from 90/10. Gate a canary on its metrics, not on the weight alone.
- **Latency routing sees networks, not users.** It relies on AWS's measurements between users' networks and Regions, and without EDNS Client Subnet it only knows the resolver's address; a user on a distant public resolver can be sent to the wrong Region.
- **Health checks have blind spots.** The checkers only reach public endpoints, they see what `/health` reports rather than what users experience, and when every record is unhealthy Route 53 treats them all as healthy and keeps answering. A shallow `/health` misses broken dependencies; a deep one can take every Region out at once when a shared dependency fails.
- **The control plane lives in one Region.** Changes to records need `us-east-1`, so recovery plans should rely on health checks or routing controls that are already in place, not on editing records during an incident.
- **Aliases are AWS-specific.** Moving DNS to another provider means replacing aliases with that provider's flattening or ALIAS feature, and the free alias queries disappear.
- **Small bills, with exceptions.** A zone costs $0.50 a month and most AWS-targeted queries are free, but latency, geo and IP-based queries cost 1.5 to 2 times a standard query, fast and HTTPS health checks add $1.00 a month each, and Resolver endpoints run around the clock.

## Implementation notes

**Create the health check, then the records that use it.** The JSON goes in files next to the commands; the IDs in angle brackets come from the earlier steps, and an ALB's `CanonicalHostedZoneId` comes from `aws elbv2 describe-load-balancers`:

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

`api-records.json` (the Singapore record and the canary look the same, with their own `SetIdentifier`, `Region` or `Weight`, health check and target):

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

An alias to another record in the same zone uses the zone's own ID as `HostedZoneId`; an alias to a CloudFront distribution always uses `Z2FDTNDATAQYW2`.

- **Keep failover records short-lived and the rest long-lived.** A 60-second TTL suits records that fail over; stable records such as MX or TXT can keep hours, which saves queries. Lower a TTL a day or two before a planned migration, since resolvers keep the old value for the old TTL.
- **Check the path users take.** Evaluate Target Health is free and follows the ALB's own target health; a Route 53 health check on `/health` through the load balancer also catches problems in front of the targets, such as a listener rule that no longer reaches them. Keep `/health` cheap and decide which dependencies it covers (see [health endpoint monitoring](../health-endpoint-monitoring/)).
- **Alarm on the health checks** with the `HealthCheckStatus` metric in `us-east-1`, so someone hears about a failover that DNS handled on its own.
- **Practise the failover.** The *invert health check status* option, or a `/health` that fails on purpose in a test environment, shows the real time to fail over, including the clients' caches.
- **Mind the S3 status page.** An alias to an S3 website endpoint needs a bucket with the same name as the record, `status.shop.example`, configured for website hosting. S3 website endpoints serve HTTP only; for HTTPS, put CloudFront in front of the bucket and point the secondary record at the distribution, whose alternate domain names must include `status.shop.example`.
- **Use the data plane in an incident.** Records changed by hand need the control plane; prepare failover records, health checks or ARC routing controls in advance.
- **Turn on query logging when debugging.** Authoritative query logs go to CloudWatch Logs in `us-east-1` and VPC Resolver query logs to CloudWatch Logs, S3 or Firehose; Route 53 doesn't charge for either, the destinations do.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Multi-Region Active-Active](../multi-region-active-active/) — Serve users from several regions at once and shift traffic away from a region that fails.
- [Active-Passive Failover](../active-passive-failover/) — A warm standby region is promoted when the primary region goes down.
- [Disaster Recovery Strategies](../disaster-recovery-strategies/) — Backup & restore, pilot light, warm standby, active-active: trading cost against RTO and RPO.
- [Canary Release](../canary-release/) — Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back.
- [Blue-Green Deployment](../blue-green-deployment/) — Run the new version beside the old one and switch all traffic in one step.
- [CDN & Edge Caching](../cdn-edge-caching/) — Serve static content from edge locations close to users; only cache misses reach the origin.
- [Health Endpoint Monitoring](../health-endpoint-monitoring/) — Expose liveness and readiness checks that load balancers and monitors probe.
- [Amazon VPC](../amazon-vpc/) — Your private network in AWS: subnets in each Availability Zone, route tables, gateways, security groups and endpoints.
- [Private Endpoints](../private-endpoints/) — Reach managed cloud services over private IPs instead of the public internet.
- [Hub-and-Spoke Network](../hub-spoke-network/) — Shared services and egress in a central hub network; workloads live in peered spokes.
- [Amazon S3](../amazon-s3/) — Object storage: objects in buckets, addressed by key, stored across Availability Zones, with storage classes, versioning and events.
- [Amazon RDS & Aurora](../amazon-rds-aurora/) — Managed relational databases: backups, Multi-AZ failover and read replicas, and Aurora's storage shared across three zones.

## References

- [Amazon Route 53 Developer Guide — How internet traffic is routed to your website or web application](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/welcome-dns-service.html)
- [Amazon Route 53 — NS and SOA records that Route 53 creates for a public hosted zone](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/SOA-NSrecords.html)
- [Amazon Route 53 — Working with private hosted zones](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/hosted-zones-private.html)
- [Amazon Route 53 — Considerations when working with a private hosted zone](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/hosted-zone-private-considerations.html)
- [Amazon Route 53 — Choosing between alias and non-alias records](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-choosing-alias-non-alias.html)
- [Amazon Route 53 — Choosing a routing policy](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy.html)
- [Amazon Route 53 — Latency-based routing](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-latency.html)
- [Amazon Route 53 — Weighted routing](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-weighted.html)
- [Amazon Route 53 — Values specific for weighted records](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-values-weighted.html)
- [Amazon Route 53 — Failover routing](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-failover.html)
- [Amazon Route 53 — Geolocation routing](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-geo.html)
- [Amazon Route 53 — Geoproximity routing](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-geoproximity.html)
- [Amazon Route 53 — IP-based routing](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-ipbased.html)
- [Amazon Route 53 — Multivalue answer routing](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-multivalue.html)
- [Amazon Route 53 — How Route 53 uses EDNS0 to estimate the location of a user](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-edns0.html)
- [Amazon Route 53 — How Route 53 determines whether a health check is healthy](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-failover-determining-health-of-endpoints.html)
- [Amazon Route 53 — Values that you specify when you create or update health checks](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/health-checks-creating-values.html)
- [Amazon Route 53 — How Route 53 chooses records when health checking is configured](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/health-checks-how-route-53-chooses-records.html)
- [Amazon Route 53 — How health checks work in complex Route 53 configurations](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-failover-complex-configs.html)
- [Amazon Route 53 — Configuring failover in a private hosted zone](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-failover-private-hosted-zones.html)
- [Amazon Route 53 — Monitoring health checks using CloudWatch](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/monitoring-health-checks.html)
- [Amazon Route 53 — Configuring DNSSEC signing in Amazon Route 53](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-configuring-dnssec.html)
- [Amazon Route 53 — Working with customer managed keys for DNSSEC](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-configuring-dnssec-cmk-requirements.html)
- [Amazon Route 53 — Enabling DNSSEC signing and establishing a chain of trust](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-configuring-dnssec-enable-signing.html)
- [Amazon Route 53 — What is Route 53 VPC Resolver?](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver.html)
- [Amazon Route 53 — Using DNS Firewall to filter outbound DNS traffic](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver-dns-firewall.html)
- [Amazon Route 53 — What are Amazon Route 53 Profiles?](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/profiles.html)
- [Amazon Route 53 — Quotas](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/DNSLimitations.html)
- [Amazon Route 53 API Reference — HealthCheckConfig](https://docs.aws.amazon.com/Route53/latest/APIReference/API_HealthCheckConfig.html)
- [Amazon Route 53 API Reference — AliasTarget](https://docs.aws.amazon.com/Route53/latest/APIReference/API_AliasTarget.html)
- [Amazon Route 53 API Reference — ResourceRecordSet](https://docs.aws.amazon.com/Route53/latest/APIReference/API_ResourceRecordSet.html)
- [Amazon Route 53 pricing](https://aws.amazon.com/route53/pricing/)
- [Amazon Route 53 FAQs](https://aws.amazon.com/route53/faqs/)
- [Amazon Route 53 Service Level Agreement](https://aws.amazon.com/route53/sla/)
- [Amazon Application Recovery Controller — What is ARC?](https://docs.aws.amazon.com/r53recovery/latest/dg/what-is-route53-recovery.html)
- [Amazon Application Recovery Controller — Routing control in ARC](https://docs.aws.amazon.com/r53recovery/latest/dg/routing-control.html)
- [Amazon Application Recovery Controller — Document history](https://docs.aws.amazon.com/r53recovery/latest/dg/doc-history.html)
- [Amazon Application Recovery Controller pricing](https://aws.amazon.com/application-recovery-controller/pricing/)
- [AWS Whitepaper — AWS Fault Isolation Boundaries: Global services](https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/global-services.html)
- [AWS Regions and Availability Zones — AWS Regions](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html)
- [Elastic Load Balancing — How Elastic Load Balancing works](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/how-elastic-load-balancing-works.html)
- [Amazon S3 — Website endpoints](https://docs.aws.amazon.com/AmazonS3/latest/userguide/WebsiteEndpoints.html)
- [Amazon CloudFront — Optimize high availability with CloudFront origin failover](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/high_availability_origin_failover.html)
- [AWS Global Accelerator — What is AWS Global Accelerator?](https://docs.aws.amazon.com/global-accelerator/latest/dg/what-is-global-accelerator.html)
- [AWS SDK for Java 2.x — Set the JVM TTL for DNS name lookups](https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/jvm-ttl-dns.html)
- [AWS CLI — route53 create-health-check](https://docs.aws.amazon.com/cli/latest/reference/route53/create-health-check.html)
- [AWS CLI — route53 change-resource-record-sets](https://docs.aws.amazon.com/cli/latest/reference/route53/change-resource-record-sets.html)
- [AWS CLI — route53 create-hosted-zone](https://docs.aws.amazon.com/cli/latest/reference/route53/create-hosted-zone.html)
- [AWS CLI — route53-recovery-cluster update-routing-control-state](https://docs.aws.amazon.com/cli/latest/reference/route53-recovery-cluster/update-routing-control-state.html)
- [RFC 1034 — Domain Names: Concepts and Facilities](https://www.rfc-editor.org/rfc/rfc1034)
- [RFC 1035 — Domain Names: Implementation and Specification](https://www.rfc-editor.org/rfc/rfc1035)
- [RFC 2308 — Negative Caching of DNS Queries (DNS NCACHE)](https://www.rfc-editor.org/rfc/rfc2308)
- [RFC 2606 — Reserved Top Level DNS Names](https://www.rfc-editor.org/rfc/rfc2606)
- [RFC 7871 — Client Subnet in DNS Queries](https://www.rfc-editor.org/rfc/rfc7871)
- [ICANN Board — Approved resolutions, 29 July 2024 (reserving .INTERNAL)](https://www.icann.org/en/board-activities-and-meetings/materials/approved-resolutions-special-meeting-of-the-icann-board-29-07-2024-en)
- [Cloudflare DNS documentation](https://developers.cloudflare.com/dns/)
- [Cloudflare DNS — CNAME flattening](https://developers.cloudflare.com/dns/cname-flattening/)
- [Cloudflare DNS — Internal DNS](https://developers.cloudflare.com/dns/internal-dns/)
- [Cloudflare Load Balancing — Global traffic steering policies](https://developers.cloudflare.com/load-balancing/understand-basics/traffic-steering/steering-policies/)
- [Cloudflare Load Balancing — Standard traffic steering policies](https://developers.cloudflare.com/load-balancing/understand-basics/traffic-steering/steering-policies/standard-options/)
- [Cloudflare Load Balancing — Monitors](https://developers.cloudflare.com/load-balancing/monitors/)
- [Cloudflare Load Balancing — Enable Load Balancing](https://developers.cloudflare.com/load-balancing/get-started/enable-load-balancing/)
- [Microsoft Learn — Alias records overview (Azure DNS)](https://learn.microsoft.com/en-us/azure/dns/dns-alias)
- [Microsoft Learn — What is Azure Private DNS?](https://learn.microsoft.com/en-us/azure/dns/private-dns-overview)
- [Microsoft Learn — Traffic Manager routing methods](https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-routing-methods)
- [Microsoft Learn — Traffic Manager endpoint monitoring](https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-monitoring)
- [Google Cloud — DNS routing policies and health checks](https://docs.cloud.google.com/dns/docs/routing-policies-overview)
- [Google Cloud — DNS records overview](https://docs.cloud.google.com/dns/docs/records-overview)
- [Google Cloud — DNS zones overview](https://docs.cloud.google.com/dns/docs/zones/zones-overview)
- [Google Cloud — Cloud DNS pricing](https://cloud.google.com/dns/pricing)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
