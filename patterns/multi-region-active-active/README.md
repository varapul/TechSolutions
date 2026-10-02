<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [☁️ Cloud Infrastructure](../../README.md#cloud-infrastructure)

# Multi-Region Active-Active

> Serve users from several regions at once and shift traffic away from a region that fails.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Multi-Region Active-Active" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/multi-region-active-active.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Both regions serve** | A **global load balancer** (anycast, or DNS with latency-based routing) sends Europe to Region A and the Americas to Region B, the lowest-latency region for each. Both regions are **active**: each runs the full stack and serves real traffic, and the load balancer health-checks both of them all the time. |
| **2 · Replicate data** | Each region holds a writable copy of the data. A write **commits in the local region** and the user gets an answer straight away; the change then ships to the other region **asynchronously**, usually within a second (the **replication lag**). Reads are served from the local copy, so no request waits on a cross-region round trip. |
| **3 · Region B fails** | Region B has an outage. Americas users see errors until the load balancer notices: after a few consecutive failed probes it marks B **unhealthy** and stops routing traffic there. Writes that B had committed but not yet replicated are lost, or stranded until B returns, so the replication lag is your effective **RPO**. |
| **4 · Fail over** | The load balancer now sends Americas users to Region A. Their requests travel further (roughly 110 ms instead of 20 ms), but they are served. Region A's load doubles, so it needs **headroom** or has to **scale out**. When B recovers, it catches up on replication before traffic fails back. |
<!-- END GENERATED: header -->

## The problem

A single region is a single failure domain. Spreading instances across availability zones survives the loss of a data centre, but not a regional event such as a networking or power incident, a bad change to a regional service, or a natural disaster. Serving a global audience from one region also makes distant users pay a cross-continent round trip on every request. An active-passive standby helps with recovery but not with latency. It sits idle most of the time, and its failover path runs so rarely that it is hard to trust.

## How it works

- **Every region runs the whole stack** (the app tier and a writable copy of the data) and **serves production traffic all the time**. There is no standby to promote.
- A **global load balancer** sends each user to the nearest healthy region. It is either **DNS-based** (latency, geolocation or geoproximity routing: the answer to a name lookup points at a region) or **anycast-based** (one IP address announced from many edge locations, which proxy each connection to the nearest healthy region).
- It **health-checks** every region, ideally through an endpoint that exercises the region's critical dependencies, and stops routing to a region after a few consecutive failed probes.
- **Reads are served locally.** Writes **commit locally** and replicate **asynchronously** to the other regions, so no request waits for a cross-region round trip.
- When a region fails, its users are routed to the survivors. Those regions were already serving production traffic, so failover is a routing change, not a promotion.

## When to use it

- Availability targets that can't absorb a regional outage, or even the minutes an active-passive promotion takes (RTO near zero).
- User bases spread across continents, where serving from the nearest region noticeably cuts latency.
- Data that tolerates eventual consistency between regions, or that can be partitioned so each record has one home region.
- Not when a warm standby already meets your RTO and RPO. Active-active roughly doubles the infrastructure bill and makes data consistency part of every feature.

## Trade-offs

- **Asynchronous replication means RPO > 0.** Writes that Region B committed but had not yet shipped to A when it failed are lost, or stranded until B comes back and they can be reconciled. The window is the replication lag. It is usually under a second, but it grows under load or when the link between regions degrades, so measure it. Synchronous replication across regions (a quorum write) gives RPO = 0, but every write then pays a cross-region round trip, and writes stop when a quorum can't be reached.
- **Concurrent writes conflict.** Two regions can update the same record within the lag. *Last-writer-wins* on a timestamp is simple but silently discards one update. *Merging* (CRDTs, application-level resolution) keeps both intents, but only for data that can be merged. The alternative is to avoid conflicts: give each key a **single writer**. That can be one global write region ("write global"), or a home region per partition such as the user's own region ("write partitioned"), while reads stay local. Many systems mix these, using a single writer for balances and inventory and last-writer-wins for preferences.
- **Each region needs headroom for its neighbours' load.** When one of *N* equal regions fails, each survivor has to carry *N/(N−1)* times its normal load. With two regions that is double, so each normally runs at 50% utilisation or less. Scaling out during the event is a gamble: it takes minutes, depends on a control plane, and competes for capacity with everyone else who is failing over. Pre-provisioned capacity (*static stability*) is safer, and adding regions shrinks the headroom each one needs.
- **Failover speed depends on the routing layer.** Detecting the failure takes roughly the probe interval times the failure threshold. With DNS you then wait for the record's TTL, and some resolvers and clients cache answers for longer than that. Long-lived connections (HTTP/2, gRPC, WebSockets) don't re-resolve until they reconnect. Anycast keeps the same IP address, so the shift happens inside the provider's network as soon as health checks mark the region down, with no help from clients.
- **Data residency.** Replicating everything everywhere may conflict with data-protection and localisation rules, for example GDPR's restrictions on transfers outside the EEA. Keep regulated records in their home region and replicate only what may leave it, or run active-active only between regions in the same jurisdiction.
- **Cost and operational load.** You pay for full copies of the stack and for cross-region data transfer, and every deployment, schema change and incident now spans regions.

## Implementation notes

- **Global routing.** DNS-based examples are Amazon Route 53 latency or geoproximity records with health checks, Azure Traffic Manager, Google Cloud DNS routing policies and NS1. Anycast edge examples are AWS Global Accelerator, Azure Front Door, Google Cloud's global external Application Load Balancer and Cloudflare.
- **Multi-writer data.** Amazon DynamoDB global tables (in their default multi-region eventual consistency mode) and Azure Cosmos DB with multi-region writes replicate asynchronously and resolve conflicts with last-writer-wins by default (Cosmos DB can also run a custom merge procedure). DynamoDB's multi-region strong consistency mode instead replicates each write synchronously to at least one other region before acknowledging it (RPO = 0, exactly three regions, higher write latency). Cassandra and ScyllaDB replicate between data centres with per-request consistency levels such as `LOCAL_QUORUM`. Spanner and CockroachDB use synchronous consensus instead (RPO = 0, higher write latency), and CockroachDB's `REGIONAL BY ROW` tables give each row a home region.
- **Keep users in one region.** Route each user consistently to one region so they read their own writes. Keep the app tier stateless (sessions in signed tokens or a replicated store), and make writes idempotent so that a request retried in another region after failover has no extra effect.
- **Watch the lag.** Export replication lag as a metric and alert well before it exceeds your RPO budget. Design health checks to catch a broken dependency, but make sure one shared dependency can't mark every region unhealthy at once.
- **Rehearse evacuation.** Regularly drain a region on purpose (game days, chaos experiments) to prove the others can take the load. When a failed region returns, let it catch up on replication and warm up, then shift traffic back gradually.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- Active-Passive Failover *(planned)* — A warm standby region is promoted when the primary region goes down.
- Disaster Recovery Strategies *(planned)* — Backup & restore, pilot light, warm standby, active-active: trading cost against RTO and RPO.
- [Load Balancing](../load-balancing/) — Spread requests across healthy instances and stop sending to unhealthy ones.
- [Health Endpoint Monitoring](../health-endpoint-monitoring/) — Expose liveness and readiness checks that load balancers and monitors probe.
- [Autoscaling](../autoscaling/) — Add and remove instances automatically as load rises and falls.
- Deployment Stamps *(planned)* — Deploy many independent copies of the whole stack, each serving a subset of tenants.
- Cell-Based Architecture *(planned)* — Many isolated, identical cells behind a thin router contain the blast radius of any failure.
- Read Replicas *(planned)* — Send writes to the primary and spread reads across asynchronously updated replicas.

## References

- [AWS whitepaper — Disaster recovery options in the cloud (multi-site active/active)](https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html)
- [AWS Well-Architected Framework — Reliability Pillar](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html)
- [Azure Architecture Center — Geode pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/geodes)
- [Azure Well-Architected Framework — Mission-critical workloads](https://learn.microsoft.com/en-us/azure/well-architected/mission-critical/mission-critical-overview)
- [Google Cloud Well-Architected Framework — Reliability pillar](https://docs.cloud.google.com/architecture/framework/reliability)
- [Google SRE Book — Load Balancing at the Frontend (DNS and virtual IP load balancing)](https://sre.google/sre-book/load-balancing-frontend/)
- [Martin Kleppmann — Designing Data-Intensive Applications (multi-leader replication)](https://dataintensive.net/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
