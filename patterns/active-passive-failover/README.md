<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [☁️ Cloud Infrastructure](../../README.md#cloud-infrastructure)

# Active-Passive Failover

> A warm standby region is promoted when the primary region goes down.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Active-Passive Failover" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/active-passive-failover.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One serves, one stands by** | All traffic goes to the **active** region, because that is the answer the traffic manager gives to every DNS lookup. Each change committed there reaches the **passive** region a few seconds later through asynchronous replication (5 seconds in this example), so the standby is always slightly behind. Its app tier is deployed and healthy but serves nothing, and health checks probe both regions. |
| **2 · Detect, then decide** | The active region fails. One failed check is not enough: with a check every 10 seconds, the region is declared unhealthy only after **three failures in a row**, 30 seconds after it went down, so that a blip does not trigger a failover. Many organisations put a **human decision** here, because failing over a region costs data and carries risk. |
| **3 · Promote, fence, redirect** | The replica is **promoted** and starts accepting writes, and the old primary is **fenced**: marked so that it cannot accept writes if it comes back, because two primaries would diverge (**split brain**). The traffic manager now answers with the passive region and clients follow as their cached DNS answers expire (60 seconds here): promoted at +90 s, traffic moved by about +150 s, a recovery time of roughly 2.5 minutes. The last 5 seconds of writes never reached the replica and are lost. All of these numbers are examples. |
| **4 · Fail back on purpose** | The failed region returns, but it does not take the traffic back by itself: it rejoins as the **new standby** and catches up through replication in the other direction. Returning to the original layout is a **planned switchover**: pause writes, let the replica catch up fully, swap the roles. Nothing is lost this time, and the two regions end in the arrangement they started in. |
<!-- END GENERATED: header -->

## The problem

A region is a single failure domain. Spreading a workload over several availability zones survives the loss of a data centre, but not a regional event: a network or power incident, a bad change to a regional service, a natural disaster. If the business cannot wait for the region to come back, the workload needs a second region that can take over.

The cheapest second region that still recovers in minutes is one that **does nothing until it is needed**: the application is deployed there, the data is kept almost up to date, and no user is sent to it. That much is easy to draw. The hard part is the takeover, because "fail over to the standby" is not one action but a chain of them, and each link has its own way of going wrong:

- **Noticing** takes time, and noticing too eagerly turns a network blip into an outage of your own making.
- **Deciding** is expensive in both directions: failing over throws away the writes the standby had not received yet, and hesitating costs downtime.
- **Promoting** the standby's database creates a second writable copy. If the old one is still alive, or comes back, the two diverge (**split brain**).
- **Redirecting** users depends on caches that you do not control.
- **Going back** afterwards is a second migration, not an undo.

This pattern is that chain, link by link: what each one costs, and what keeps it from failing on the day it is needed.

## How it works

- The **active region** runs the app tier and the **primary** database, and takes all the traffic.
- The **passive region** (the standby) runs the same app tier, deployed and healthy but serving nobody, and a **replica** of the database. The replica is fed by **asynchronous replication**, so it is always behind the primary by the replication lag.
- A **global traffic manager** tells clients where to go and health-checks both regions. In the diagram it is a DNS name with a **failover record**: a primary answer, a secondary answer and a health check that chooses between them. Clients cache the answer for its TTL and send their requests straight to that region, so the traffic manager is not in the request path. That detail decides how fast traffic can be moved later.

A failover goes through the same stages every time. The times below are the **example from the diagram**, picked to be easy to add up. They are not recommendations, and yours will differ at every stage.

| Stage | What happens | In the example | What sets the time |
|---|---|---|---|
| **Detect** | Health checks start failing. The region is declared unhealthy only after several failures in a row | +30 s: three checks, 10 s apart | Check interval × failure threshold, plus the timeout of a probe |
| **Decide** | Something, or someone, commits to the failover | At once: the example is automatic | With a person in the loop: paging, judging and approving, which can take longer than every other stage together |
| **Promote and fence** | The replica stops following and becomes writable. The old primary is fenced, so that it cannot accept writes if it comes back | +90 s | The database engine, and how much of the replicated log is still to be applied |
| **Redirect** | The traffic manager answers with the passive region. Clients follow as their cached answers expire | By about +150 s, with a TTL of 60 s | The TTL, plus every cache and open connection that outlives it |
| **Recovery time** | From the failure until the last client has moved | **About 2.5 minutes** | The sum of the stages. The RTO has to cover it |
| **Data lost** | Writes that the old primary committed and had not shipped yet | **The last 5 s of writes** | The replication lag at the moment of failure. The RPO has to cover it |

Two things about the order:

- **Fence before clients reach the new primary.** A promotion without a fence only works for as long as the old primary stays dead.
- **Redirect after the promotion,** as the example does. Clients sent to a region whose database is still read-only only get a different error. If your traffic manager moves by itself the moment the health check fails, the standby's app tier has to cope with a database that is not writable yet.

Afterwards the failed region comes back. It must not take the traffic back by itself: its data is stale, and it may still hold the writes that never left. It **rejoins as the new standby**, is rewound or rebuilt to follow the new primary, and catches up. Going back to the original layout is a separate, planned operation, a **switchover**: stop writes for a moment, let the replica catch up completely, swap the roles. Nothing is lost, because nothing is left in flight.

### How warm the standby is

Active-passive says who serves, not how much is running in the passive region. That is a separate choice, usually described as a temperature: cold, warm or hot. [Disaster Recovery Strategies](../disaster-recovery-strategies/) compares the options by cost, recovery time and data loss. From coldest to hottest, under the names AWS uses:

- **Backup and restore** (a cold standby): only backups are kept in the second region. There is nothing to fail over to until it has been built.
- **Pilot light:** the data is replicated and the core infrastructure exists, but the app tier has to be started before it can answer a request.
- **Warm standby:** a complete copy runs at reduced size. It can answer requests at once, and has to be scaled up to carry the full load.
- **Hot standby:** a full-size copy that takes no traffic.

The colder the standby, the more stages come between *decide* and *redirect* (restore, start, scale), and the more the recovery depends on things that have to work during the disaster. The diagram leaves those stages out: it assumes that the passive app tier can take the traffic as it is. For a warm standby that runs at reduced size, add the time to scale up to the timeline (see *Standby capacity* below).

### The same pattern at a smaller scale

A primary and a standby that swap roles is not only a multi-region design. The same stages appear wherever exactly one node may write:

- **A database across zones.** Amazon RDS Multi-AZ keeps a standby in another availability zone, replicated synchronously, and fails over to it automatically, typically in 60 to 120 seconds, by repointing the instance's DNS name.
- **Cluster managers** that automate detection, promotion and fencing. Patroni runs PostgreSQL around a leader key in etcd, Consul, ZooKeeper or Kubernetes: the primary has to keep renewing the key, and when it expires a replica takes it and is promoted. A MongoDB replica set elects a new primary once the old one has been unreachable for 10 seconds (the default), and a primary that can see only a minority of the members steps down. Pacemaker does the same for arbitrary services, and fences a node it cannot reach before it starts that node's services elsewhere.

The ingredients are the ones in the diagram: a heartbeat, one authority that says who the primary is (a lease or a quorum), a fence, and a stable name that moves. The leader election pattern is the general form, and *Designing Data-Intensive Applications* by Martin Kleppmann and Chris Riccomini treats the single-database case, leader failover, in its chapter on replication.

What changes between regions is the distance. Synchronous replication becomes expensive, so losing data enters the picture. The link between the sites is the least reliable part of the system, so false alarms and split brain become more likely. And the clients are on the public internet, so redirecting them runs into DNS caches.

## When to use it

- **The business can live with minutes of downtime and seconds of lost writes** in a regional disaster, and cannot live with waiting for the region to return. That is the gap between restoring from backups and serving from several regions at once.
- **The data has one writer.** A relational database with transactions, constraints and sequences keeps working exactly as it does today, because only one region accepts writes at any time and there are no conflicts to resolve.
- **The second region is for recovery, not for latency.** Users everywhere are served from one place most of the time, and that is acceptable.
- **Why this and not active-active?** [Multi-Region Active-Active](../multi-region-active-active/) recovers faster, because the surviving regions are already serving, and its failover path is exercised by every request. It pays with writes in several regions (conflicts, or a data model partitioned to avoid them), with headroom in every region, and with every feature having to work under eventual consistency between regions. Active-passive keeps the application simple and moves the difficulty into one procedure that is rarely used. Choose it when that procedure meets the objectives, and then practise the procedure.

When not to use it:

- **The recovery time has to be near zero.** Detection, promotion and redirection add up to minutes at best. Serve from both regions instead.
- **No acknowledged write may be lost.** With asynchronous replication something is always in flight. Losing nothing takes synchronous replication, which is practical between zones and expensive between distant regions, or a database that commits through consensus across regions.
- **A day of downtime is acceptable.** Then a second region that is always running is money spent on nothing: backups in another region and a tested rebuild are enough.
- **The workload is not yet highly available inside one region.** Most failures are smaller than a region. Several zones, a database standby in another zone and working health checks come first, and they cover far more incidents than a second region does.
- **The disaster you fear is in the data.** A dropped table or a corrupting bug is replicated to the standby within seconds. Only backups with point-in-time recovery help against that.
- **Nobody will rehearse it.** A failover that has never been run is a plan, not a capability.

## Trade-offs

- **You pay for a region that does nothing, and trust it without evidence.** Its images, configuration, secrets, certificates and quotas drift unless every change goes to both regions, and its failover path runs so rarely that it is the least tested thing you operate.
- **Fast detection or few false alarms.** A short interval and a low threshold find a real outage sooner, and also fire on a slow minute or a few lost probes. Every false positive costs a real failover: the writes in flight, cold caches in the new region and a second migration to get back.
- **Automatic or human decision.** Automation is fast and never asleep, and it will fail over with complete confidence for the wrong reason. A person is slower and sees context: a deployment in progress, a monitoring fault, an incident the provider is already fixing. GitHub's incident report of September 2012 is the well-known case. Health checks that failed under heavy load triggered an automatic database failover onto a node with a cold cache, which then failed its own checks, so the role failed back. A day later a partition in the cluster promoted a node that was out of date, and because record IDs generated by the database were also used as keys in another data store, some private data was briefly visible to the wrong users. Their conclusion was that this failover should only ever be started by an operator.
- **Asynchronous replication loses the lag.** Whatever the primary acknowledged and had not shipped is missing from the new primary, and the users who made those changes were told they had succeeded. Synchronous replication closes the gap, makes every commit wait for another region, and stops commits when that region cannot be reached.
- **Fencing is the step most likely to be skipped, and the one that corrupts data.** A region that is down cannot be told to stand down, so the fence has to hold whenever it returns. Even managed services only promise their best effort here.
- **DNS moves traffic slowly and never completely.** The TTL only governs the caches that honour it: some resolvers and runtimes keep an answer for longer, and connections that are already open never look the name up again.
- **The standby inherits the full load cold.** Empty caches, unopened connection pools and a fleet that may still be scaling meet all the traffic at once, plus the retries of everyone who was failing.
- **The return is a second outage window.** A switchover is short and loses nothing, and it still stops writes and moves every client again. Budget for it, or decide to stay where you are.

## Implementation notes

Managed services are named as examples; their behaviour was checked against the vendors' documentation in October 2026.

- **Detection.**
  - *What to probe:* an endpoint reached through the region's public entry point that says whether the region can do its job, not only that a port is open. Keep it cheap, and be careful how deep it goes: a dependency that both regions share must not make both look dead at once. [Health Endpoint Monitoring](../health-endpoint-monitoring/) covers the endpoint itself.
  - *From where:* from several vantage points outside both regions. One observer cannot tell a dead region from a broken path to it. Amazon Route 53 probes from health checkers in many locations and treats an endpoint as healthy while more than 18% of them report it healthy, and Azure Traffic Manager also probes from multiple locations. Two regions that only watch each other have this problem in its worst form: each sees silence and concludes that the other has gone. A third location that both can reach (a witness, or one vote in a quorum of three) breaks the tie.
  - *Thresholds:* the time to detect is about interval × threshold, plus a probe timeout. Route 53 checks every 30 seconds, or every 10 at extra cost, and changes an endpoint's status after 1 to 10 consecutive results (3 by default). Traffic Manager probes every 30 or 10 seconds and tolerates 0 to 9 failures (3 by default), so with the defaults the fourth failure in a row marks the endpoint as degraded.
  - *When both regions look unhealthy:* know what your traffic manager does. A Route 53 failover record answers with the primary again when both of its records are unhealthy.
- **Decision.**
  - AWS's disaster recovery whitepaper advises caution with failover that starts automatically from health checks or alarms, because a false alarm costs the same downtime and data as a real one. It describes the usual compromise: a person takes the decision, and everything after it is automated so that starting it is a single action.
  - Azure SQL Database draws the same line for its failover groups. It recommends the customer-managed policy, where you start the failover, and keeps the Microsoft-managed one for outages that affect a whole region, where a forced failover happens only after a grace period that cannot be shorter than one hour.
  - Write the criteria down before the incident: which signals, for how long, and who may declare a failover at 3 a.m. The time to page, judge and approve counts against the RTO.
  - Whoever decides, the action should be one switch. Amazon Application Recovery Controller, for example, offers routing controls (on/off switches that Route 53 health checks follow, changed through an API that is served from five regions) and Region switch plans (ordered steps that are run by hand or started by a CloudWatch alarm).
- **Promotion and fencing.**
  - *Promotion* turns the replica into a primary: `pg_ctl promote` or `pg_promote()` in PostgreSQL. PostgreSQL itself neither detects that the primary has failed nor tells the standby, so a cluster manager or a runbook has to. Managed equivalents are a managed failover in Amazon Aurora Global Database (the chosen secondary typically takes over within a few minutes), a forced failover of an Azure SQL failover group, and the promotion of a cross-region replica in Cloud SQL (a *replica failover* to the designated DR replica in the Enterprise Plus edition).
  - *Fencing* makes sure the old primary can never accept a write again by accident. There are four ways to do it:
    - **Switch it off.** This is where the name STONITH ("shoot the other node in the head") comes from: the cluster manager cuts the node's power, or stops the instance, before it starts the service elsewhere. It is the most common method in a Pacemaker cluster.
    - **Cut it off.** Fabric fencing takes away what the node needs to do harm: its network path or its storage, and in a cloud also its credentials or its place behind the endpoint.
    - **Make it stand down by itself.** The primary holds a lease that it has to keep renewing, and stops accepting writes when it cannot. Patroni does this with its leader key (which lasts 30 seconds by default), and can arm a watchdog that resets the machine if Patroni itself hangs.
    - **Make everyone else ignore it.** Each promotion raises a generation number (an epoch or a term; a fencing token is the same idea), and storage, replicas and clients refuse anything that carries an older one.
  - A region that cannot be reached cannot be switched off or cut off from the outside, so only the last two kinds of fence, or an endpoint that no longer points at it, still hold when it returns. Managed services promise no more than that. Aurora calls its mechanism *write fencing* and documents it as a best effort, with a short window in which the old primary might still accept writes. Google's guidance for Cloud SQL is to make the old primary inaccessible before clients start using the new one, and then to delete it.
  - *What split brain does:* two primaries accept different writes under the same keys, sequences and constraints. A single-leader database has no way to merge them, so one of the two histories is thrown away when they are reconciled.
- **Redirecting traffic.**
  - *DNS failover* is the simplest way: a record with a primary and a secondary answer and a health check, as in Route 53 failover routing, Azure Traffic Manager priority routing or a Cloud DNS failover routing policy (which can also send a small share of the traffic to the backup all the time, to prove that it works). The switch then happens in the data plane of the DNS service. AWS warns against recovery plans that depend on *editing* DNS records instead: that is a control-plane operation, and the control plane of Route 53 runs in a single region.
  - *Its limits.* The TTL bounds how fast well-behaved clients move, and AWS describes 60 or 120 seconds as a common choice for records that take part in a failover. Not every cache is well behaved. Google's SRE book points out that an authoritative server cannot flush the resolvers' caches and that some resolvers do not respect the TTL. Runtimes keep caches of their own: the JVM holds a lookup for a period set by `networkaddress.cache.ttl`, and AWS warns that on some configurations the default is never to look again until the process restarts. Connections that are already open keep going to the old address until they are closed, which is why AWS suggests limiting how long clients may stay connected. And a resolver that cannot reach the authoritative servers at all may keep serving the expired answer (RFC 8767), so the DNS service itself must not depend on the failed region.
  - *It fails back by itself.* Route 53 and Traffic Manager both go back to answering with the primary once its health check is healthy again. Left alone, the returning region gets the traffic back before its data has caught up. Hold it out until the switchover: with a health check that is really a switch (a routing control), by disabling the endpoint, or by having the health endpoint report the region's role and not only its health. The diagram shows this state as *healthy · on hold*.
  - *A global load balancer* avoids the client caches. The address stays the same (anycast) and the shift happens inside the provider's network. AWS Global Accelerator sends traffic to the healthy endpoint and is not affected by the DNS caching described above, and Azure Front Door routes to the healthy origins with the best priority (1 to 5). The price is a component in the path of every request. [Load Balancing](../load-balancing/) covers the mechanics.
  - *Clients that know both endpoints* need no redirect at all. A PostgreSQL connection string can list several hosts with `target_session_attrs=read-write`, and the driver connects to the one that accepts writes. Managed writer endpoints do the same job with a name that follows the primary (the global writer endpoint of an Aurora global database, the listener of an Azure SQL failover group). They are DNS records again: the Azure listener has a TTL of 30 seconds.
- **Data.**
  - *Asynchronous or synchronous.* Between regions, replication is almost always asynchronous: a commit returns once the primary has it, and the standby follows a little later. That lag is the data a failover loses. Synchronous replication makes each commit wait until the standby has confirmed it, which costs a round trip between regions on every write, and PostgreSQL's documentation is plain about the other cost: when the synchronous standby is gone, commits wait. That is why it is common between zones (the standby of an RDS Multi-AZ instance is synchronous) and rare between distant regions.
  - *A bound on the loss.* Some systems let you cap the lag instead. Aurora PostgreSQL, for example, can hold back commits on the primary while every secondary region is further behind than a configured RPO, which trades write availability for a limit on what a failover can lose.
  - *The writes that never left* still exist on the old primary, on a branch of history that nobody else has. What happens to them is a decision, and each engine has a default. `pg_rewind` brings a PostgreSQL primary back as a standby by overwriting whatever diverged. MongoDB writes the documents it rolls back to files for someone to inspect. Aurora tries to take a snapshot of the old volume as it was at the failure before it rebuilds the region as a secondary. Decide in advance who looks at that data, and remember that its side effects (the confirmation e-mail, the call to a payment provider) have already happened.
  - Measure the lag all the time and alert well below the RPO. [Read Replicas](../read-replicas/) covers replication, lag and promotion in detail.
- **Standby capacity.**
  - A scaled-down standby has to grow before it can take the load, and that time belongs on the timeline. So does everything that is slow on a cold start: empty caches, connection pools, load balancers that have never seen this traffic. Warm them ahead of time where you can: a steady trickle of synthetic or real requests keeps the standby's whole path exercised.
  - A failover should not need anything that may itself be failing. Launching instances is a control-plane operation, and AWS's guidance is to rely on the data plane during recovery and to use as few control-plane operations as possible. That applies most of all to anything hosted in the failed region, including a global control plane that happens to live there. AWS calls a workload **statically stable** when it keeps working through a failure without having to change anything, such as launching instances, and names the full-size version of this pattern *hot standby* for that reason.
  - If the standby is smaller, shorten the list of things that can refuse you. Raise the service quotas of the standby region to production size ahead of time. Reserve capacity where the provider lets you: EC2 On-Demand Capacity Reservations hold instance capacity in a chosen zone, and an Application Load Balancer can be given a reserved minimum capacity. Then let [Autoscaling](../autoscaling/) do the rest from images that are already in the region.
  - If the standby cannot take everything at once, decide beforehand what is shed first.
- **Dependencies fail over together.** The database is one of many things the application needs. List them all and check that each works with the active region gone: identity and sign-in, secrets and encryption keys, certificates, queues and caches, object storage, the container registry and the deployment pipeline, monitoring and paging, and third parties that allow-list your addresses. The runbook, the scripts and the credentials to run them must not depend on the failed region either.
- **Failback and switchover.**
  - A *failover* is forced and may lose data. A *switchover* is planned and loses none, because the primary stops taking writes and waits for the replica before the roles change. Vendors name the pair differently: Aurora Global Database has *failover* and *switchover*, Azure SQL failover groups have *forced failover* and *failover*, and Cloud SQL (Enterprise Plus) has *replica failover* and *switchover*.
  - The old region first has to become a replica of the new primary. Managed services do this once the region is back: Aurora adds the old primary region back as a secondary, an old Azure SQL primary reconnects as the new secondary, and Cloud SQL's advanced disaster recovery turns the old primary into a replica. With plain PostgreSQL you rewind it with `pg_rewind` or rebuild it from the new primary.
  - Then choose the moment. Wait until the region has been healthy for a while and the replica has caught up, pick a quiet period, and run the switchover from the same runbook as a drill. Staying in the new region is a legitimate outcome if the two regions are equivalent.
- **Drills.**
  - A failover that is never practised does not work. AWS lists never exercising a failover in production as an anti-pattern, and the reason is drift: capacity, configuration and assumptions that were right at the last test no longer are.
  - A switchover is the cheap drill. It loses no data, so it can run in production on a schedule: Azure SQL lists drills in production among the uses of a planned failover of the failover group, Cloud SQL suggests its switchover for routine drills, and Aurora lists the regular rotation between regions that some regulators require as a use of switchover. PostgreSQL's documentation makes the same point for a single pair of servers: switching regularly is also a test of the mechanism.
  - A switchover does not exercise detection, fencing or a promotion with the primary gone. Rehearse those as well, by cutting a region off on purpose in a game day, which is where chaos engineering comes in. Measure the recovery time and the lost writes you actually get, and compare them with the objectives.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Disaster Recovery Strategies](../disaster-recovery-strategies/) — Backup & restore, pilot light, warm standby, active-active: trading cost against RTO and RPO.
- [Multi-Region Active-Active](../multi-region-active-active/) — Serve users from several regions at once and shift traffic away from a region that fails.
- [Read Replicas](../read-replicas/) — Send writes to the primary and spread reads across asynchronously updated replicas.
- [Load Balancing](../load-balancing/) — Spread requests across healthy instances and stop sending to unhealthy ones.
- [Health Endpoint Monitoring](../health-endpoint-monitoring/) — Expose liveness and readiness checks that load balancers and monitors probe.
- Leader Election *(planned)* — Instances elect one coordinator; another takes over when its lease expires.
- [Autoscaling](../autoscaling/) — Add and remove instances automatically as load rises and falls.
- [Chaos Engineering](../chaos-engineering/) — Inject failures on purpose to prove the system degrades the way you expect.

## References

- [AWS whitepaper — Disaster Recovery of Workloads on AWS: disaster recovery options in the cloud (pilot light, warm standby, failover)](https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html)
- [AWS Well-Architected Framework, Reliability Pillar — REL11-BP04 Rely on the data plane and not the control plane during recovery](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_withstand_component_failures_avoid_control_plane.html)
- [AWS Well-Architected Framework, Reliability Pillar — REL11-BP05 Use static stability to prevent bimodal behavior](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_withstand_component_failures_static_stability.html)
- [AWS Well-Architected Framework, Reliability Pillar — REL13-BP03 Test disaster recovery implementation to validate the implementation](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_planning_for_recovery_dr_tested.html)
- [Amazon Builders' Library — Static stability using Availability Zones](https://aws.amazon.com/builders-library/static-stability-using-availability-zones/)
- [Amazon Route 53 Developer Guide — Active-active and active-passive failover](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-failover-types.html)
- [Amazon Route 53 Developer Guide — How Amazon Route 53 chooses records when health checking is configured](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/health-checks-how-route-53-chooses-records.html)
- [Amazon Route 53 Developer Guide — How Amazon Route 53 determines whether a health check is healthy](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-failover-determining-health-of-endpoints.html)
- [Amazon Route 53 API Reference — HealthCheckConfig (request interval, failure threshold)](https://docs.aws.amazon.com/Route53/latest/APIReference/API_HealthCheckConfig.html)
- [Amazon Application Recovery Controller Developer Guide — Routing control in ARC](https://docs.aws.amazon.com/r53recovery/latest/dg/routing-control.html)
- [Amazon Application Recovery Controller Developer Guide — Best practices for routing control in ARC (TTLs, connection lifetime)](https://docs.aws.amazon.com/r53recovery/latest/dg/route53-arc-best-practices.regional.html)
- [Amazon Application Recovery Controller Developer Guide — Region switch in ARC](https://docs.aws.amazon.com/r53recovery/latest/dg/region-switch.html)
- [Amazon Aurora User Guide — Using switchover or failover in Amazon Aurora Global Database](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database-disaster-recovery.html)
- [Amazon RDS User Guide — Failing over a Multi-AZ DB instance for Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.Failover.html)
- [AWS SDK for Java Developer Guide — Set the JVM TTL for DNS name lookups](https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/jvm-ttl-dns.html)
- [Microsoft Learn — Azure Traffic Manager routing methods (priority)](https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-routing-methods)
- [Microsoft Learn — Azure Traffic Manager endpoint monitoring](https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-monitoring)
- [Microsoft Learn — Failover groups overview and best practices (Azure SQL Database)](https://learn.microsoft.com/en-us/azure/azure-sql/database/failover-group-sql-db)
- [Microsoft Learn — Traffic routing methods for origins (Azure Front Door)](https://learn.microsoft.com/en-us/azure/frontdoor/routing-methods)
- [Google Cloud — About disaster recovery (DR) in Cloud SQL](https://docs.cloud.google.com/sql/docs/postgres/intro-to-cloud-sql-disaster-recovery)
- [Google Cloud — Cloud DNS: DNS routing policies and health checks](https://docs.cloud.google.com/dns/docs/routing-policies-overview)
- [Google SRE Book — Load Balancing at the Frontend (load balancing using DNS)](https://sre.google/sre-book/load-balancing-frontend/)
- [PostgreSQL documentation — Failover](https://www.postgresql.org/docs/current/warm-standby-failover.html)
- [PostgreSQL documentation — Log-Shipping Standby Servers (synchronous replication)](https://www.postgresql.org/docs/current/warm-standby.html)
- [PostgreSQL documentation — pg_rewind](https://www.postgresql.org/docs/current/app-pgrewind.html)
- [PostgreSQL documentation — Database Connection Control Functions (multiple hosts, target_session_attrs)](https://www.postgresql.org/docs/current/libpq-connect.html)
- [Patroni documentation — Watchdog support (leader key and split-brain protection)](https://patroni.readthedocs.io/en/latest/watchdog.html)
- [Pacemaker Explained — Fencing](https://clusterlabs.org/projects/pacemaker/doc/3.0/Pacemaker_Explained/html/fencing.html)
- [MongoDB Manual — Replica Set Elections](https://www.mongodb.com/docs/manual/core/replica-set-elections/)
- [MongoDB Manual — Rollbacks During Replica Set Failover](https://www.mongodb.com/docs/manual/core/replica-set-rollbacks/)
- [Martin Kleppmann — How to do distributed locking (fencing tokens)](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)
- [RFC 8767 — Serving Stale Data to Improve DNS Resiliency](https://www.rfc-editor.org/rfc/rfc8767.html)
- [GitHub Blog — GitHub availability this week (incident report, September 2012)](https://github.blog/news-insights/the-library/github-availability-this-week/)
- [Martin Kleppmann & Chris Riccomini — Designing Data-Intensive Applications, 2nd Edition (O'Reilly, 2026): leader failover, in the chapter on replication](https://martin.kleppmann.com/2026/03/24/designing-data-intensive-applications-2e.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
