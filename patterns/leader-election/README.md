<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🛡️ Resilience & Reliability](../../README.md#resilience--reliability)

# Leader Election

> Instances elect one coordinator; another takes over when its lease expires.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Leader Election" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/leader-election.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · All three run it, or none** | Three identical instances of a scheduler service can each start the nightly billing run. With no coordination all three do, and every customer is charged three times. Switching the job off on two of them is no better: when the one chosen instance dies, the run doesn't happen at all. Exactly one instance should do the job at any time, and it must not be a fixed one. |
| **2 · Win the lease** | Each instance tries to take the lease in the coordination store with an atomic **compare-and-set**: write my name only if the lease is free or has expired. A's write lands first, so A becomes the **leader** with a 15-second lease and **token 33**, a number that goes up with every new leader. B and C find the lease held and stay **followers**, watching it. A renews every 5 seconds while it is healthy and starts the billing run, sending its token with every write. All the numbers are examples. |
| **3 · Leader fails, B takes over** | A stops renewing: it crashed, lost its network or stalled, and from the outside these look the same. Nothing happens until the lease **expires**, 15 seconds after the last renewal; then B's compare-and-set succeeds, and B leads with **token 34** and resumes the run. The work paused for up to one lease duration, and that is the trade-off: a short lease means a fast takeover, but also false takeovers when a busy leader renews late. |
| **4 · Old leader returns: fenced** | A wasn't dead, only stalled by a long garbage-collection pause. It wakes up still believing it leads and writes with token 33, but the billing database has already seen 34 and rejects the stale token: this check is called **fencing**. A lease alone can't prevent the overlap, because pauses and clock drift break its timing assumptions, so the protected resource has to check the token. A then sees B in the lease and rejoins as a follower. Often the best leader election is none at all: idempotent or partitioned work can be done by any instance. |
<!-- END GENERATED: header -->

## The problem

Some work has to be done by one instance at a time. A nightly billing run must run once, not once per replica. Some resources accept only one writer at a time. A set of partitions needs exactly one owner each, and a replicated database needs one primary to order its writes. Yet the service that does this work runs several identical instances, because a single instance is a single point of failure.

The two obvious fixes both fail. Enable the job on every instance and every instance runs it: customers are charged once per replica. Enable it on one instance only and that instance is now a fixed point of failure: when it dies, nothing runs until somebody notices. What you need is a way for identical peers to agree on one of them, and to hand the role to another one automatically when the holder stops, without ever letting two of them act at once.

## How it works

The instances share one small record in a strongly consistent **coordination store**: a lease that says who holds the role, for how long, when it was last renewed, and a **fencing token**, a number that goes up every time the role changes hands.

1. **Campaign.** Every instance tries to write its own name into the lease with an atomic compare-and-set that succeeds only if the lease is free or has expired. The store applies the attempts one at a time, so exactly one succeeds. That instance is the **leader**; the others become **followers** and keep watching the lease.
2. **Renew.** The leader rewrites the lease well before it runs out (every 5 seconds for a 15-second lease in the diagram). While it keeps doing that, nobody else can take it. If it can't renew in time, it must stop acting as leader on its own initiative.
3. **Expire and take over.** If renewals stop, because the leader crashed, lost its network or stalled, the lease runs out and the next follower's compare-and-set succeeds. The new leader gets a higher token. Between the last renewal and the takeover, the work waits for up to one lease duration.
4. **Fence.** The leader sends its token with everything it does to a shared resource, and the resource refuses any token lower than the highest one it has accepted. A deposed leader that hasn't noticed is stopped there, at the resource.

A leader that shuts down cleanly should release the lease, so that a follower can take over at once instead of waiting for it to expire, but only after its own work has stopped.

### A lease alone is not enough: fencing tokens

A lease grants a period of time, but nothing forces a process to notice that its time is up. A long garbage-collection pause, a virtual machine that is frozen and resumed, a slow disk or a delayed network packet can stall the leader between checking its lease and acting on it. When it resumes, the lease may belong to someone else, and the old leader carries on regardless. Clocks add to this, because a lease is a promise about elapsed time, and a clock that runs fast or jumps lets a process believe it still has time. The [Amazon Builders' Library article on leader election](https://builder.aws.com/content/3Ev0vH0hfkcUizISUWYTvHibtcp/leader-election-in-distributed-systems) singles out exactly these cases, pauses between checking a lock and doing the work and leaders on slow or lossy networks, as the hardest part to get right.

Martin Kleppmann's essay [How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html) describes the fix used in the diagram. Each grant comes with a token that increases monotonically. The client sends its token with every request, and the storage service rejects any request whose token is lower than one it has already processed. The resource has to take part: the check must happen in the same atomic operation as the write, for example a conditional update that compares the incoming token with the highest one stored. The essay also separates two reasons for wanting a lock. With a lock for **efficiency**, an occasional duplicate only wastes some work. With a lock for **correctness**, a duplicate corrupts data or charges a customer twice, and only fencing makes that safe.

Where the token comes from depends on the store:

- **etcd:** the revision of the election or lock key. etcd's own [notes on lock and lease](https://etcd.io/docs/v3.6/learning/why/#notes-on-the-usage-of-lock-and-lease) point out that a lease by itself doesn't give mutual exclusion and suggest the revision as the fencing token.
- **ZooKeeper:** the zxid or the znode version, which are Kleppmann's examples.
- **Consul:** the key's `LockIndex`, which goes up on every acquisition. Together with the key and the session it forms what Consul calls a sequencer, an idea it borrows from Google's Chubby.
- **Kubernetes:** a Lease counts changes of holder in `leaseTransitions`, but client-go doesn't hand that to your code as a token, and its [package documentation](https://pkg.go.dev/k8s.io/client-go/tools/leaderelection) says plainly that it doesn't guarantee that only one client acts as leader. Fencing is up to you.
- **A database row:** a generation column that every takeover increments.

When the resource can't check a token (a third-party API, an email provider), make the operation idempotent instead: for example, give each billing run an idempotency key such as the customer and the billing period, so a second attempt changes nothing.

### Timing: lease duration, renew deadline, retry period

Three settings decide how quickly leadership moves, and how often it moves by mistake:

- **Lease duration:** how long followers wait after the last renewal they saw before they try to take over. It caps how long the work stops when a leader dies silently.
- **Renew deadline:** how long the leader keeps retrying a failed renewal before it gives up and stops leading. It must be shorter than the lease duration, so the old leader stops before anyone else may start; the difference is the margin for clocks that run at slightly different rates.
- **Retry period:** how often candidates try to acquire the lease and the leader tries to renew it.

The Kubernetes control plane is a good reference: [kube-controller-manager](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/) defaults to a 15-second lease duration, a 10-second renew deadline and a 2-second retry period, stored in a Lease object. client-go refuses settings in the wrong order: the lease duration must be longer than the renew deadline, and the renew deadline longer than 1.2 retry periods. By default, kube-controller-manager exits as soon as it loses leadership, so a deposed controller can't keep working.

Shorter leases fail over faster, but expire more often under a long pause or CPU starvation, which causes needless changes of leader. Longer leases are calmer, but the work stops for longer when a leader really dies.

Leases depend on measuring elapsed time, not on agreeing what time it is. client-go followers time the lease from the moment they saw the record change, using their own clock, and treat the timestamps in the record only as a sign that it changed. Clocks that disagree about the time therefore don't matter, but clocks that run at different speeds do. The [DynamoDB lock client](https://github.com/awslabs/amazon-dynamodb-lock-client) stores no absolute times at all: a waiting client starts a timer and treats the lock as stale if its record version number hasn't changed after a whole lease duration. Inside the leader, measure the lease with a monotonic clock, so that a clock correction or a leap second can't stretch it.

### Mechanisms

| Store | Taking the lead | Detecting a dead leader | Fencing token |
|---|---|---|---|
| Kubernetes Lease with client-go `leaderelection` | Update the Lease, guarded by optimistic concurrency | Followers wait out the lease duration after the last renewal they saw | None provided; `leaseTransitions` counts holder changes |
| etcd | `Campaign` in the election API, or a transaction that creates a key attached to a lease | Keep-alives stop, the lease's TTL lapses and its keys are deleted | The key's revision |
| ZooKeeper | Create an ephemeral sequential znode; the lowest number leads | The session times out and its ephemeral znodes disappear | zxid or znode version |
| Consul | Acquire a key-value entry with a session | The session's health checks fail or its TTL lapses | `LockIndex` |
| Database row | A conditional `UPDATE` that succeeds only if the lease is free or expired | The expiry time stored in the row passes | A generation column |
| PostgreSQL advisory lock | `pg_try_advisory_lock` | The holder's database session ends | None |
| Azure Blob Storage lease | Acquire a lease of 15 to 60 seconds on a blob | The lease isn't renewed in time | The lease ID, which guards writes to that blob only |
| DynamoDB lock client | A conditional write to a lock item | The record version number stays the same for a whole lease duration | None: the version number is a random identifier |

- **Kubernetes:** kube-controller-manager and kube-scheduler use [Leases](https://kubernetes.io/docs/concepts/architecture/leases/) so that only one replica of each is active, and your own controllers can do the same through client-go's `leaderelection` package (callbacks `OnStartedLeading`, `OnStoppedLeading` and `OnNewLeader`, and `ReleaseOnCancel` to give the lease up on shutdown). Coordinated leader election, beta since Kubernetes 1.33 and off by default, adds `LeaseCandidate` objects so that the control plane can pick the leader deliberately, for example the oldest version during an upgrade; it is aimed at control-plane components.
- **etcd:** a [lease](https://etcd.io/docs/v3.6/learning/api/) has a TTL and must be kept alive; when it expires or is revoked, every key attached to it is deleted. The [election service](https://etcd.io/docs/v3.6/dev-guide/api_concurrency_reference_v3/) offers `Campaign`, `Proclaim`, `Leader`, `Observe` and `Resign` on top of that.
- **ZooKeeper:** the [leader election recipe](https://zookeeper.apache.org/doc/current/recipes.html#sc_leaderElection) has every candidate create an ephemeral sequential znode under one path; the smallest sequence number leads. If every follower watched the leader's node, all of them would wake up and query ZooKeeper on every change, a burst called the **herd effect**, so each one watches only the next node below its own. Apache Curator packages this as `LeaderLatch` and `LeaderSelector`.
- **Consul:** a [session](https://developer.hashicorp.com/consul/docs/automate/session) ties a lock to node health checks or to a TTL of 10 seconds to 24 hours, and Consul may wait up to twice the TTL before it invalidates the session. After an invalidation, Consul keeps the lock from being taken for a lock-delay (15 seconds by default, at most 60) so that a leader that is still running has time to notice and stop. Consul's documentation itself says this is not bulletproof.
- **A database you already run:** a lease row with holder, expiry time and generation, updated with a conditional `UPDATE`, needs no extra infrastructure, and because the database's clock decides expiry, the instances' clocks don't matter. PostgreSQL [advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS) are simpler still: a session-level lock is held until it is released or the session ends, so leadership lasts exactly as long as one database connection. That breaks behind a pooler in transaction mode, which hands each transaction a different server connection; [PgBouncer](https://www.pgbouncer.org/features.html) lists session-level advisory locks as unsupported in that mode.
- **Blob leases:** the Azure pattern's [sample](https://learn.microsoft.com/en-us/azure/architecture/patterns/leader-election) elects a leader by taking a [lease on a blob](https://learn.microsoft.com/en-us/rest/api/storageservices/lease-blob), renews it in a loop, and cancels the leader's work when a renewal fails. Writes to a leased blob must carry the lease ID, so the blob itself is protected; anything else the leader writes is not.
- **DynamoDB:** the [DynamoDB lock client](https://github.com/awslabs/amazon-dynamodb-lock-client) keeps a lock item with a lease duration and a record version number that every heartbeat changes. The Builders' Library article names it, along with ZooKeeper, as the well-tested option Amazon teams prefer over writing their own election code.

### Consensus inside a cluster, leases outside it

Replicated systems elect their own leaders with a consensus protocol. In Raft ([Ongaro and Ousterhout, USENIX ATC 2014](https://www.usenix.org/conference/atc14/technical-sessions/presentation/ongaro)), time is divided into numbered **terms**. A candidate needs votes from a majority, and each server votes at most once per term, so there is at most one leader per term. Election timeouts are randomized (150 to 300 milliseconds in the paper's example) so that candidates rarely split the vote. The term is a built-in fencing token: servers reject requests that carry an older term, and a leader that sees a newer one steps down. Raft stays correct however slow the clocks or messages are; timing affects only how quickly it elects a leader. etcd works this way, and so does Kafka's KRaft mode, where a quorum of controllers (typically 3 or 5) keeps one active controller and hot standbys. Unmesh Joshi's *Patterns of Distributed Systems* describes the pieces as [Leader and Followers](https://martinfowler.com/articles/patterns-of-distributed-systems/leader-follower.html), [Lease](https://martinfowler.com/articles/patterns-of-distributed-systems/lease.html) and [Generation Clock](https://martinfowler.com/articles/patterns-of-distributed-systems/generation-clock.html) (also called term or epoch).

The difference matters when you build on top of such a system. Consensus protects the data inside the cluster, because the replicas themselves check the term. An application that takes a lease from etcd or ZooKeeper only borrows that guarantee for the lease record: whatever it then writes somewhere else is outside the protection and needs fencing or idempotence. For application code, leader election should almost always mean borrowing consensus from a store that already has it, not implementing Raft yourself.

## When to use it

- **Scheduled and singleton jobs** that must run once per period across a fleet: billing runs, reports, clean-up tasks, a polling relay.
- **Single-writer resources**: a file, a ledger or a downstream system that can't take concurrent writers, or a stream that must be written in order.
- **Assigning work**: one coordinator hands partitions, shards or tenants to the other instances and rebalances them when instances come and go.
- **The primary of a replicated store**, which orders every write; this is usually built into the database through consensus.
- **Controllers and operators**, where only one replica should act on the cluster's state at a time.

### When not to use it

Leader election brings a new dependency, a failover pause and subtle failure modes. The Builders' Library article describes Amazon looking at other options first, such as workflow services like AWS Step Functions and idempotent APIs or optimistic locking that make a single leader unnecessary. Often the best leader election is none:

- **Make the work idempotent**, so that any instance may do it and a duplicate has no effect: see [Idempotent Consumer](../idempotent-consumer/).
- **Partition the work**, so that every instance owns a slice and no global leader is needed: [Sharding](../sharding/) for data, [Competing Consumers](../competing-consumers/) for messages on a queue.
- **Let a broker assign partitions.** In a Kafka consumer group, the group coordinator assigns each partition to exactly one consumer and reassigns it when a consumer fails.
- **Use a managed scheduler**, such as a Kubernetes CronJob, Amazon EventBridge Scheduler or an Azure Functions timer trigger; the last runs a single instance of the function even when the app has scaled out. Schedulers don't promise exactly once either: a [CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/) creates a Job only approximately once per scheduled time, sometimes two or none, and [EventBridge Scheduler](https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html) delivers at least once. The job still has to be idempotent.
- **Use plain locking** when instances only need to take turns with a shared resource: the Azure pattern recommends optimistic or pessimistic locking for that case.
- **Keep a fixed leader that is restarted quickly** if a short outage while it restarts is acceptable; the Azure pattern lists a natural leader or dedicated process as a reason not to use election at all.

## Trade-offs

- **The coordination store becomes critical.** While it is unavailable nobody can be elected and the leader can't renew, so the Azure pattern calls the mutex service a single point of failure. Run it highly available, and make sure a leader that can't reach it stops by its renew deadline.
- **Failover is not instant.** Work stops for up to a lease duration, plus a retry period, after the leader's last renewal. A shorter lease cuts that pause but brings more false takeovers when a healthy leader is merely slow.
- **There can be zero or two leaders for a moment.** The Builders' Library article is explicit that no distributed system can guarantee exactly one leader: during failures there may be none, or two. Design for both: a pause you can tolerate for none, fencing or idempotence for two.
- **One leader is one bottleneck and one blast radius.** All coordinated work goes through a single instance, which limits throughput, and a faulty leader affects everything it coordinates. The usual answer is to shard leadership: one lease per partition, so that each partition has its own leader, as in Amazon DynamoDB, EBS and EFS, or the Kinesis Client Library's lease per shard.
- **Partial deployments get harder.** With one active instance there is no fraction of traffic on which to try a new version first, a cost the Builders' Library article also points out.
- **A leader can hold the lease but not do the work.** If renewal runs in a background thread while the work loop hangs, the leader keeps the lease and nobody takes over; the Azure sample notes the same risk. Renew from the loop that does the work, or tie renewal to a check that the work is progressing.

## Implementation notes

- **Use a library.** client-go `leaderelection`, etcd's election API or its Go `concurrency` package, Apache Curator, the DynamoDB lock client, or the equivalent on your platform. Election code that looks simple is easy to get subtly wrong.
- **Check before every side effect.** Check the remaining lease time right before any operation with effects outside the leader, and leave a margin for pauses, as the Builders' Library article advises.
- **Stop at once when leadership is lost.** Cancel all leader work when renewal fails or the library reports the loss. Exiting the process, as kube-controller-manager does, is the bluntest and safest way.
- **Fence in the resource.** Send the token with every write and check it in the same atomic operation, for example `UPDATE … SET …, fence_token = :token WHERE … AND fence_token <= :token`. A write that matches no row came from a stale leader.
- **Make takeover safe.** A new leader may find half-finished work. Make each step durable before telling others it is done, and make it idempotent, so that the new leader can safely redo whatever the old one may have started.
- **Make leadership visible.** Expose who leads: the Kubernetes component-base library defines a `leader_election_master_status` gauge per lease (1 for the leader, 0 for a standby), and client-go can record a `LeaderElection` event whenever an instance becomes or stops being leader. Keep a history of leadership changes, and alert on flapping: several changes in a short time usually mean a lease that is too short or a leader that is starved.
- **Test pauses and partitions.** Freeze the leader for longer than the lease (`SIGSTOP`, then `SIGCONT`), cut it off from the store, skew its clock, and check that the resource rejects the stale writes: see [Chaos Engineering](../chaos-engineering/). The Builders' Library article also recommends modelling the protocol formally, for example in TLA+.
- **Know the neighbouring patterns.** [Active-Passive Failover](../active-passive-failover/) applies the same idea to a whole region, with its own detection, promotion and fencing of the old primary. [Health Endpoint Monitoring](../health-endpoint-monitoring/) is how load balancers and orchestrators judge an instance, but passing a health check doesn't make an instance the leader. The message relay of a [Transactional Outbox](../transactional-outbox/) is a common case for one active instance, when the events for each key must be published in order.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Active-Passive Failover](../active-passive-failover/) — A warm standby region is promoted when the primary region goes down.
- [Health Endpoint Monitoring](../health-endpoint-monitoring/) — Expose liveness and readiness checks that load balancers and monitors probe.
- [Sharding](../sharding/) — Split data horizontally across databases using a shard key.
- [Chaos Engineering](../chaos-engineering/) — Inject failures on purpose to prove the system degrades the way you expect.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.
- [Competing Consumers](../competing-consumers/) — Several workers pull from one queue, so work is shared and throughput scales out.
- [Transactional Outbox](../transactional-outbox/) — Save the event in the same database transaction as the data, then relay it: no dual-write gap.
- [Cell-Based Architecture](../cell-based-architecture/) — Many isolated, identical cells behind a thin router contain the blast radius of any failure.

## References

- [Azure Architecture Center — Leader Election pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/leader-election)
- [AWS Builder Center — Leader election in distributed systems (first published in the Amazon Builders' Library)](https://builder.aws.com/content/3Ev0vH0hfkcUizISUWYTvHibtcp/leader-election-in-distributed-systems)
- [Kubernetes documentation — Leases](https://kubernetes.io/docs/concepts/architecture/leases/)
- [client-go — package leaderelection](https://pkg.go.dev/k8s.io/client-go/tools/leaderelection)
- [etcd — API reference: concurrency (election and lock services)](https://etcd.io/docs/v3.6/dev-guide/api_concurrency_reference_v3/)
- [etcd — Notes on the usage of lock and lease](https://etcd.io/docs/v3.6/learning/why/#notes-on-the-usage-of-lock-and-lease)
- [Apache ZooKeeper — Recipes and Solutions: Leader Election](https://zookeeper.apache.org/doc/current/recipes.html#sc_leaderElection)
- [HashiCorp Consul — Sessions and distributed locks overview](https://developer.hashicorp.com/consul/docs/automate/session)
- [Martin Kleppmann — How to do distributed locking (2016)](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)
- [Diego Ongaro and John Ousterhout — In Search of an Understandable Consensus Algorithm (USENIX ATC 2014)](https://www.usenix.org/conference/atc14/technical-sessions/presentation/ongaro)
- [Unmesh Joshi — Patterns of Distributed Systems: Leader and Followers](https://martinfowler.com/articles/patterns-of-distributed-systems/leader-follower.html)
- [Unmesh Joshi — Patterns of Distributed Systems: Lease](https://martinfowler.com/articles/patterns-of-distributed-systems/lease.html)
- [Unmesh Joshi — Patterns of Distributed Systems: Generation Clock](https://martinfowler.com/articles/patterns-of-distributed-systems/generation-clock.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
