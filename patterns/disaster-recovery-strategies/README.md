<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [☁️ Cloud Infrastructure](../../README.md#cloud-infrastructure)

# Disaster Recovery Strategies

> Backup & restore, pilot light, warm standby, active-active: trading cost against RTO and RPO.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Disaster Recovery Strategies" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/disaster-recovery-strategies.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Backup and restore** | Only **backups** are copied to the recovery region; nothing else runs there. After a disaster the workload is rebuilt from nothing: provision the infrastructure from code, restore the data from the last backup, deploy the application, then redirect users. **RPO** (everything since the last backup) and **RTO** are both measured in hours, and the standing cost is the lowest of the four. |
| **2 · Pilot light** | The data is replicated continuously to a **live database** in the recovery region and the core infrastructure is in place, but no application servers run there; only their images and templates are ready. Recovery starts and scales the app tier, promotes the database and redirects users. RPO falls to the replication lag (minutes or less) and RTO to tens of minutes. |
| **3 · Warm standby** | A **scaled-down but complete** copy of the workload runs in the recovery region all the time and can take test traffic. Recovery scales the fleet to full size, promotes the database and shifts the traffic, so RTO falls to minutes. RPO stays at the replication lag: what you pay for at this step is time, not data. |
| **4 · Multi-site active/active** | Both regions run at full size and **serve users all the time**, so there is nothing to rebuild or promote: when a region fails, its traffic shifts to the other one and RTO is near zero. RPO depends on how the data is replicated (the lag if asynchronous, zero only if synchronous). Cost and complexity are the highest of the four. |
<!-- END GENERATED: header -->

## The problem

A region can go dark, and data can be destroyed: a regional network or power incident, a bad change rolled out to a whole region, a dropped table, ransomware. Redundancy inside one region does not cover these, so the workload needs a second home somewhere else. The question is how much of that second home to keep running while nothing is wrong, because every bit of readiness is paid for all year, for a day that may never come.

Two numbers frame the decision:

- **RTO (recovery time objective):** the longest the business accepts the service being unavailable after a disruption. Detecting the problem, deciding to fail over and doing the recovery work all have to fit inside it.
- **RPO (recovery point objective):** how far back in time the recovered data may be, in other words the longest window of recent changes the business accepts losing. It is a length of time, not an amount of data.

Both are business decisions made per workload, not properties of a technology. They come out of a **business impact analysis**: what an hour without this system costs in revenue, penalties, safety or trust, and what losing an hour of its data costs. NIST SP 800-34 derives them there together with the **maximum tolerable downtime** (MTD), the total disruption a business process can stand, and notes that the RTO normally has to be shorter than the MTD, because the work that piled up during the outage still has to be caught up once the system is back. The answers differ inside one company (the payment system and the internal wiki do not deserve the same budget) and even over time: AWS's example is a payroll system, which hurts far more just before payday than just after. Only when the objectives are known does it make sense to pick a strategy, and the strategies form a ladder on which every step down in RTO and RPO costs more.

**High availability is not disaster recovery.** Availability keeps the service up while *components* fail: more instances, several zones, automatic failover within a region. Disaster recovery restores the *whole workload* somewhere else after an event that availability was not designed for. It also has to cover disasters in the data, which redundancy copies faithfully to every replica. Make the workload highly available first. A multi-zone deployment already survives the most likely failures, and that decides how much disaster recovery is still worth buying on top.

## How it works

The four strategies use the names from AWS's disaster recovery whitepaper. From left to right, more of the workload is kept running in the recovery region, so less work is left for the day of the disaster. The first three are **active/passive**: one region serves and the other waits (the switch itself is the subject of the active-passive failover pattern). The last is **active/active**. In the diagram, dashed outlines are things that do not exist or run yet, and a green outline marks what had to be built or changed after the disaster.

| | Backup and restore | Pilot light | Warm standby | Multi-site active/active |
|---|---|---|---|---|
| Runs in the recovery region | Nothing. Only backup copies are kept there, plus the templates and images needed to rebuild | The data stores, replicated continuously, and the core infrastructure (network, load balancer). No app servers | A complete, working copy of the workload at reduced size, taking no production traffic | A full-size copy that serves production traffic all the time |
| Work after a disaster | Provision the infrastructure, restore the data, deploy the app, redirect users | Start and scale the app tier, promote the data stores, redirect users | Scale to full size, promote the data stores, shift the traffic | Shift traffic away from the failed region |
| RPO | Hours: everything since the last backup | Minutes or less: the replication lag | Minutes or less: the same replication | Near zero: the replication lag, or zero with synchronous replication |
| RTO | Hours | Tens of minutes | Minutes | Near zero |
| Standing cost | `$` backup storage | `$$` plus data stores that are always on | `$$$` plus a small fleet that mostly idles | `$$$$` two full-size sites |
| Complexity | Low: backups and infrastructure as code | Medium: replication, and every release goes to two regions | Higher: a second live environment to deploy, patch and monitor | Highest: writes in several regions, conflicts, global routing |
| Typical use | Lower-priority workloads that can be down for a day | Systems where losing data hurts more than an hour of downtime | Business-critical services | Mission-critical services that must not stop |

How to read the numbers:

- **They are orders of magnitude, not promises.** The figure in AWS's whitepaper gives one label per strategy for both objectives: hours, tens of minutes, minutes and real time, at a cost from `$` to `$$$$`. The Reliability Pillar of the Well-Architected Framework splits them: RPO in hours, minutes, seconds and near zero, and RTO within 24 hours, in tens of minutes, in minutes and possibly zero. Your own numbers come from timing a drill, not from the name of the strategy.
- **RPO falls when replication starts, RTO at every step.** From pilot light onwards the data arrives by continuous, usually asynchronous replication, so the RPO is the replication lag whichever of the three you choose. That is why the RPO gauge in the diagram does not move in step 3: what warm standby and active/active buy is time. Only synchronous replication takes the RPO to zero, and it makes every write wait for another region.
- **Backup and restore can do better than hours on RPO.** Continuous backup with point-in-time recovery brings it down to a few minutes in some cases. The RTO stays long, because everything still has to be rebuilt first.
- **Pilot light or warm standby?** AWS draws the line at whether the recovery region can answer a request without anything being switched on first. A pilot light cannot. A warm standby can, at reduced capacity, which also means it can be tested with real requests on any day.
- **Hot standby** is AWS's name for a warm standby that is already at full size and still takes no traffic. It needs no scaling during the disaster, at nearly the cost of active/active, which is why most teams that pay for a full second site let it serve.
- **Backups are part of every strategy,** not only the first (see the trade-offs). The diagram keeps the backup store in all four steps for that reason.

### The same ladder under other names

The idea is the same everywhere; the labels are not (checked in October 2026).

- **Azure's** Well-Architected Framework lists backup and restore, *active-passive cold standby* (the secondary environment is not running and is brought up when needed), *active-passive warm standby* (partly provisioned and scaled up on failover) and *active-active*, either *at capacity* (each region scales out when another fails) or *overprovisioned* (each region can already carry the full load). It also sorts workloads into criticality tiers and pairs them with these strategies, from active-active for mission-critical systems down to backup and restore for administrative ones.
- **Google Cloud's** disaster recovery planning guide speaks of *cold*, *warm* and *hot* patterns, by how readily the system can recover. In its application scenarios the cold pattern keeps only the minimum needed to rebuild, the warm pattern keeps part of the stack running (typically the database), and the hot pattern has both sites serving production.
- Watch out for **"hot standby"**: in AWS's paper it is a passive site, while Azure's planning guide uses the term for active-active. Compare what runs in the second region, not the label.

## When to use it

Choose per workload, starting from its RTO and RPO, and take the cheapest strategy that meets both. A portfolio normally mixes them, and so can one application: the checkout path may need a warm standby while the reporting jobs behind it only need backups.

- **Backup and restore** is the right answer more often than it feels. It fits when the business can live with a day's outage and a few hours of lost data (internal tools, batch and analytics jobs, development environments, archives), when the data can be re-created from another source, or when the disaster you plan for is the loss of one data centre and the workload already runs across several zones. AWS says as much: a multi-zone deployment may already cover much of the risk, and a recovery strategy that costs more than the loss it prevents should not be built unless something else, such as a regulation, requires it. It only works if the rebuild is automated and the restore is tested. Otherwise "hours" quietly turn into days.
- **Pilot light** when losing data is the expensive part and an hour of downtime is survivable. The live data stores buy most of the RPO for a fraction of the cost of running the application twice.
- **Warm standby** when the RTO is minutes, or when you want proof every day that the recovery region works, because it can take test traffic and real releases.
- **Multi-site active/active** when even minutes are too long, or when you want several regions anyway to be close to your users. It only pays off if the data model can live with writes in more than one region. [Multi-Region Active-Active](../multi-region-active-active/) shows that strategy in detail.
- **A second region is not the answer to every disaster.** It does not help against a bad deployment that reaches both regions at once, and no amount of replication replaces backups.

## Trade-offs

- **You pay every day for something you hope never to use.** Each step down the ladder adds standing cost and a second environment that has to be deployed, patched, monitored and kept in step with the first. The savings of a cheaper strategy are real only if the recovery still works, so the cost of testing belongs in the comparison.
- **Replication also copies mistakes.** A dropped table, a corrupting bug or ransomware reaches every replica within seconds, in all four strategies. For that kind of disaster the recovery point is the last good backup, which is always some time before the damage was noticed, and the recovery time is never zero, even with active/active. Point-in-time backups are needed on every rung.
- **Automatic or manual failover.** Failing over costs the data in the replication lag and a period of disruption, so a false alarm is expensive. AWS advises caution with automatically initiated failover between regions and describes the common compromise: a person takes the decision, and everything after it is automated so that starting it is a single action. Automatic failover is for the tightest RTOs, with health checks that reflect what users actually experience. Either way, the time to detect, escalate and decide counts against the RTO.
- **A standby that has to be scaled during the disaster depends on things working during the disaster.** Launching instances needs the provider's control plane and spare capacity in the recovery region, at the moment when every other customer of the failed region wants the same. Capacity that is already running is safer and costs more. That is the real difference between a small warm standby and a hot one.
- **An unused recovery region drifts.** Images, configuration, secrets, certificates and service quotas go stale unless every change is rolled out to both regions. Recovery paths that are rarely exercised tend not to work when they are needed.
- **Active/active moves the complexity into the data.** Concurrent writes, conflict resolution and consistency between regions become part of every feature.
- **The slowest dependency sets the real RTO.** A database that is back in ten minutes does not help if nobody can sign in, DNS still points at the old region, or a partner's firewall only allows the old addresses.

## Implementation notes

- **Backups that actually restore.**
  - Restore on a schedule, not only when it matters: automate a periodic restore into a scratch environment, check the data and time it. That time is a large part of your real RTO. AWS points out a second benefit: if the restore service itself is unavailable during the disaster, a usable copy from a recent backup already exists.
  - Keep copies in another region *and* in another account or subscription, so that neither a regional outage nor a compromised administrator can reach them.
  - Make them impossible to delete during their retention period, with write-once vaults or object locks, so that neither ransomware nor a stolen administrator credential can erase them. Examples are AWS Backup Vault Lock and S3 Object Lock, immutable vaults in Azure Backup, and backup vaults in Google Cloud's Backup and DR service.
  - Use point-in-time recovery for databases and versioning for object stores, with retention long enough to go back to before a corruption was *noticed*, not just before it happened.
  - Back up what is needed to rebuild as well: infrastructure code, machine images, configuration.
- **The failover itself** is a runbook with the same five parts in every strategy; only their length changes.
  1. *Detect:* alarms on what users experience (see [Health Endpoint Monitoring](../health-endpoint-monitoring/)), plus the provider's status feeds.
  2. *Decide:* written criteria for declaring a disaster, and a named person who may do it at 3 a.m.
  3. *Bring up capacity:* start or scale the app tier ([Autoscaling](../autoscaling/)) from images that are already in the region, which is where immutable infrastructure pays off.
  4. *Promote the data:* make the replica writable, and fence the old primary so that it cannot accept writes again if it comes back. Depending on the engine, promotion takes from under a minute to a few minutes, and it can run while the capacity comes up. The read replicas pattern covers the replication and its lag.
  5. *Redirect traffic:* DNS failover records, a global load balancer or anycast ([Load Balancing](../load-balancing/)). DNS answers are cached for the record's TTL, so keep it short on names that may have to move.

  Script each part, make every step concrete enough to follow under stress, and keep the runbook, the scripts and the credentials somewhere that does not depend on the failed region.
- **Prefer data-plane operations during a failover.** Providers split each service into a data plane, which does the day-to-day work (answering DNS queries, routing requests, serving reads and writes), and a control plane, which creates and changes resources. AWS states that its data planes are designed for higher availability than its control planes, and advises using as few control-plane operations as possible on a recovery path. In practice: create the load balancers, DNS records, roles and buckets in advance, prefer capacity that is already running over launching it, and switch traffic with mechanisms that live in the data plane, such as DNS failover driven by health checks or the routing controls of Amazon Application Recovery Controller. Editing DNS records is a control-plane call, and for Route 53 that control plane is hosted in a single region.
- **Dependencies have to fail over too.** List everything the workload and its operators need, and check that each item works with the primary region gone: identity and single sign-on (plus a break-glass account that does not depend on them), DNS, secrets, encryption keys and certificates, the container registry and the deployment pipeline, monitoring and alerting, software licences, private network links, and third parties that allow-list your addresses or call your webhooks. Raise service quotas in the recovery region ahead of time, or reserve capacity there.
- **Failing back is a second migration.** After a failover the recovery region holds the only current data. Going back means replicating in the other direction, letting the old region catch up and switching over in a quiet period, as a planned operation with its own runbook. Azure's guidance is to treat failback as a separate process that may happen at once or weeks later. Sometimes the right answer is to stay.
- **Test the plan.** Run game days: restore the backups, fail over for real, serve production from the recovery region for a while and fail back. Measure the recovery time and recovery point you actually achieve and compare them with the objectives. AWS lists never exercising a failover in production as an anti-pattern, and chaos engineering extends the same idea to smaller failures. Keep the number of distinct recovery paths small, because each one has to be exercised.
- **Managed building blocks,** as examples: cross-region database replicas and global databases for the data; AWS Elastic Disaster Recovery and Azure Site Recovery, which replicate whole servers continuously and launch them on failover (a pilot light for server-based workloads); and infrastructure-as-code tools to stand up the same stack in a second region.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Multi-Region Active-Active](../multi-region-active-active/) — Serve users from several regions at once and shift traffic away from a region that fails.
- [Active-Passive Failover](../active-passive-failover/) — A warm standby region is promoted when the primary region goes down.
- [Read Replicas](../read-replicas/) — Send writes to the primary and spread reads across asynchronously updated replicas.
- [Autoscaling](../autoscaling/) — Add and remove instances automatically as load rises and falls.
- [Load Balancing](../load-balancing/) — Spread requests across healthy instances and stop sending to unhealthy ones.
- Chaos Engineering *(planned)* — Inject failures on purpose to prove the system degrades the way you expect.
- [Immutable Infrastructure](../immutable-infrastructure/) — Never patch servers in place: bake a new image and replace them.
- [Health Endpoint Monitoring](../health-endpoint-monitoring/) — Expose liveness and readiness checks that load balancers and monitors probe.

## References

- [AWS whitepaper — Disaster Recovery of Workloads on AWS: disaster recovery options in the cloud](https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html)
- [AWS whitepaper — Disaster Recovery of Workloads on AWS: business continuity plan (RTO and RPO)](https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/business-continuity-plan-bcp.html)
- [AWS Well-Architected Framework, Reliability Pillar — REL13-BP02 Use defined recovery strategies to meet the recovery objectives](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_planning_for_recovery_disaster_recovery.html)
- [AWS Well-Architected Framework, Reliability Pillar — REL11-BP04 Rely on the data plane and not the control plane during recovery](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_withstand_component_failures_avoid_control_plane.html)
- [AWS whitepaper — AWS Fault Isolation Boundaries: global services](https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/global-services.html)
- [Azure Well-Architected Framework — Architecture strategies for disaster recovery](https://learn.microsoft.com/en-us/azure/well-architected/reliability/disaster-recovery)
- [Azure Well-Architected Framework — Develop a disaster recovery plan for multi-region deployments](https://learn.microsoft.com/en-us/azure/well-architected/design-guides/disaster-recovery)
- [Google Cloud Architecture Center — Disaster recovery planning guide](https://docs.cloud.google.com/architecture/dr-scenarios-planning-guide)
- [Google Cloud Architecture Center — Disaster recovery scenarios for applications](https://docs.cloud.google.com/architecture/dr-scenarios-for-applications)
- [NIST SP 800-34 Rev. 1 — Contingency Planning Guide for Federal Information Systems](https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
