<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧱 System Components](../../README.md#system-components)

# etcd

> A strongly consistent key-value store on Raft that clusters use for configuration, service discovery, locks and leader election.

<p align="center"><img src="diagram.svg" alt="Animated diagram: etcd" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/etcd.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Acme Shop's Kubernetes control plane keeps all of its state in an **etcd** cluster of three members, **etcd-1**, **etcd-2** and **etcd-3**, one per Availability Zone. Every object the API server stores (the catalog Deployment, its Pods, the scheduler's Lease) is a key under `/registry/`, and only **kube-apiserver** talks to etcd: the controller manager, the schedulers, the kubelets and `kubectl` all go through the API server. Three members keep working with one of them down, and the Kubernetes documentation recommends five in production; other systems that use etcd for configuration, service discovery and locks, such as Patroni, CoreDNS and Apache APISIX, should run their own clusters. |
| **2 · A write through Raft** | `kubectl apply` moves the catalog Deployment to image `catalog:1.4.3`, and the API server writes `/registry/deployments/default/catalog` in a **transaction**: put the new value only if the key's `mod_revision` is still 41250. The Raft leader **etcd-1** appends the request to its log as entry **52340 in term 7**, writes it to disk and sends it to etcd-2 and etcd-3. Once **2 of 3** members have it on disk the entry is committed: etcd-1 applies it to its key-value store as **revision 41872** and answers, and the followers apply it when the leader's next message carries the new commit index. Reads are linearizable by default: the leader first confirms with a majority that it is still the leader (Raft's ReadIndex), while a serializable read skips that round and may return stale data. |
| **3 · Watches and leases** | Nothing polls. The API server holds a **watch** on the prefix `/registry/deployments/`, opened from a revision, so etcd streams the change at revision 41872 as an event, and the API server's watch cache passes it on to the **controller manager**, whose Deployment controller starts a new ReplicaSet. The schedulers elect their leader with a Kubernetes **Lease** object, which the API server stores as an ordinary key. scheduler-a stops renewing it, and 15 s (`leaseDurationSeconds`) after the last renewal it saw, scheduler-b updates the Lease; the API server sends that as a Txn that succeeds only if `mod_revision` is still 41880, and it commits as revision 41903, after other writes such as node heartbeats. Programs that use etcd directly attach such a key to an etcd **lease** with a TTL instead: etcd deletes the key when the keepalives stop, and the next candidate's create-if-absent Txn wins. |
| **4 · Failure and limits** | **etcd-1** fails. The followers stop receiving its heartbeats (sent every 100 ms by default), and when **etcd-2**'s election timeout (1,000 ms by default, randomized up to twice that) runs out, it starts **term 8**, gets etcd-3's vote and becomes the leader. It appends an empty entry for its term, the API server's etcd client switches to a working member, and writes commit with **2 of 3**; lose a second member and there is no majority, so writes stop until one is back. The limits: the store is small (a 2 GiB quota by default, 8 GiB suggested as the maximum), a request may be at most 1.5 MiB, every write waits for disk fsyncs, old revisions must be compacted and the database defragmented, and member counts should be odd, 3 or 5. |
<!-- END GENERATED: header -->

## The problem

Acme Shop runs on Kubernetes, and Kubernetes is a crowd of independent control loops: the scheduler places pods, controllers keep Deployments and ReplicaSets at the right size, kubelets start containers. They coordinate through one shared record of what should exist and what does exist. That record has to be right in a strong sense. If two schedulers both believed they were in charge, or a controller acted on a Deployment that had already been replaced, the cluster would place a pod twice or undo a rollout. The record must also survive the loss of a machine or a whole Availability Zone, and it must tell the loops when something changes, because thousands of objects can't be re-read every second.

**etcd** keeps that record. It is a small key-value store whose members replicate every write with the **Raft** consensus protocol: a write is acknowledged only once a majority of members has stored it, and every member applies the same writes in the same order, so the members never disagree about what was written. On top of that it offers the tools coordination needs: a **revision** that orders every change, **watches** that stream changes from any recent revision, **transactions** that compare before they write, and **leases** that let keys disappear with the client that wrote them. Kubernetes keeps every object in it; other systems use it for configuration, service discovery, locks and leader election.

## How it works

### Raft: a leader, terms and a replicated log

An etcd cluster is a fixed set of **members**, usually three or five, that know each other's addresses. One member is the **leader** and the others are **followers**. Time is divided into numbered **terms**, each starting with an election and having at most one leader, and every change is an entry in a replicated **log**, identified by its index and by the term of the leader that created it: entry 52340 of term 7 in the animation.

A write takes the path of step 2:

1. The client sends it to any member. A follower passes requests that need consensus on to the leader; the FAQ notes that clients don't need to know which member leads.
2. The leader appends the entry to its log, writes it to its write-ahead log on disk and sends it to the followers.
3. Each follower writes the entry to disk and acknowledges it.
4. Once a **majority** of members, the leader included, has the entry on disk, it is **committed** and can no longer be lost, even if the leader fails a moment later. With three members that is two, so one slow member never holds up a write.
5. Every member **applies** committed entries, in log order, to its own copy of the key-value store, and the leader answers the client. Followers learn the new commit index from the leader's next message, an append or a heartbeat.

The leader sends heartbeats every **100 ms** by default (`--heartbeat-interval`). A follower that hears nothing for its **election timeout**, **1,000 ms** by default (`--election-timeout`), becomes a **candidate**: it starts a new term and asks the others for their votes. etcd's Raft library randomizes the timeout between one and two times the configured value, so followers rarely start an election at the same moment. A member votes once per term and only for a candidate whose log is at least as complete as its own, so the winner holds every committed entry; it then appends an empty entry in its new term (52373 in step 4), which lets it commit whatever earlier terms left behind. etcd also runs Raft's **pre-vote** round by default (`--pre-vote=true`): a would-be candidate first checks that it could win, so a member that was cut off by a network partition doesn't disrupt a working cluster with higher terms when it returns. The tuning guide suggests a heartbeat interval close to the round-trip time between members and an election timeout of at least ten times that round trip.

A cluster accepts writes as long as a majority of its members is up, which is why sizes are odd:

| Members | Majority | Failures tolerated |
|---|---|---|
| 1 | 1 | 0 |
| 3 | 2 | 1 |
| 5 | 3 | 2 |
| 7 | 4 | 3 |

A fourth member raises the majority to three without surviving a second failure, and every member added makes each write wait for more acknowledgements. The etcd FAQ suggests no more than seven members and considers five, which survive two failures, enough in most cases; the Kubernetes documentation recommends a five-member cluster in production and advises against autoscaling etcd. A new member can join as a non-voting **learner** (`etcdctl member add --learner`), copy the data, and be promoted with `etcdctl member promote` once it has caught up, so it doesn't count towards the majority before it can help.

Raft was introduced by Diego Ongaro and John Ousterhout in *In Search of an Understandable Consensus Algorithm* (USENIX ATC 2014). etcd's implementation is the Go library `go.etcd.io/raft`, which CockroachDB forked for its own Raft code. [Kafka](../kafka/)'s KRaft controllers replicate cluster metadata with a Raft-based protocol, and [MongoDB](../mongodb/) replica sets elect their primary by a majority vote as well.

### Revisions and the multi-version store

The key space is flat and sorted: keys are byte strings, and what looks like a directory, such as `/registry/deployments/`, is just a prefix that a range or a watch can cover. Every change to the key space, a put, a delete or a whole transaction, increments one cluster-wide 64-bit counter, the **revision**, which serves as a logical clock: revision 41872 came after 41871 on every member. The store is **multi-version** (MVCC): an update adds a new version instead of overwriting the old one, so a read can ask for the key space as it was at an earlier revision.

Each key carries three numbers:

- `create_revision`, the revision at which the key was last created;
- `mod_revision`, the revision of its last change (41872 for the catalog Deployment after step 2);
- `version`, the number of changes since it was created; a delete resets it to zero.

On disk each member keeps the versions in a B+tree file (bbolt), with an in-memory index from keys to revisions. Old versions stay until a **compaction** discards everything superseded before a given revision; a read or watch at an older revision then fails with `required revision has been compacted`. Compaction frees space inside the database file, and **defragmentation** returns it to the file system.

Kubernetes builds its optimistic concurrency on these numbers. kube-apiserver stores each object under `/registry/<resource>/<namespace>/<name>` (the prefix comes from `--etcd-prefix`, `/registry` by default), and in its etcd storage code an object's `resourceVersion` is the `mod_revision` of its key.

### Linearizable and serializable reads

By default a read is **linearizable**: it reflects every write that completed before the read started. etcd does this without adding the read to the log. The member that serves it gets the leader's commit index, the leader confirms that it is still the leader by exchanging heartbeats with a majority (Raft's ReadIndex), and the member answers once it has applied everything up to that index. A **serializable** read (`etcdctl get --consistency=s`) skips that round and is answered from the member's own store: it is faster and still works when the cluster has lost its majority, but it may return stale data.

### Watches

A **watch** subscribes to a key or a prefix and receives each change as an event, a `PUT` with the new key-value or a `DELETE`, in revision order. The API guarantees say that events arrive in order, never twice, with all the events of one revision together, and without gaps within the retained history. A watch can start at a past revision, so a client that remembers the last revision it saw can reconnect, even to another member, and resume exactly where it stopped, as long as that history hasn't been compacted.

That is how every Kubernetes controller avoids polling. kube-apiserver lists a resource, then watches its prefix from the list's revision and keeps the result in its **watch cache**, which serves the list and watch requests of controllers, schedulers and kubelets from memory, so etcd sees one watch per resource from each API server rather than one per client. The API server also compacts etcd every 5 minutes by default (`--etcd-compaction-interval`), and the Kubernetes documentation says that clusters keep about 5 minutes of change history: a client whose watch falls further behind receives `410 Gone` and lists again.

```sh
# Acme's own etcd cluster for its services, not the Kubernetes one
export ETCDCTL_ENDPOINTS=https://etcd-a:2379,https://etcd-b:2379,https://etcd-c:2379
etcdctl endpoint status --cluster -w table           # leader, Raft term and index, database size per member
etcdctl get --prefix /acme/config/                   # linearizable read (the default)
etcdctl get --prefix --consistency=s /acme/config/   # serializable: local, possibly stale
etcdctl get --prefix --rev=9120 /acme/config/        # the keys as they were at revision 9120
etcdctl watch --prefix --rev=9121 /acme/config/      # every change after 9120, then the live ones
```

### Transactions

A **transaction** (`Txn`) is an atomic *if, then, else*: a list of comparisons on keys (a key's value, `version`, `create_revision`, `mod_revision` or lease), a list of operations to run if every comparison holds, and a list to run otherwise. It is one Raft entry and, if it changes anything, one revision. Two shapes cover most uses:

- **Create if absent**: compare `create_revision = 0`, meaning the key doesn't exist, then put. Of several clients racing, exactly one succeeds.
- **Compare and swap**: compare `mod_revision` with the revision read earlier, then put. If another writer got there first, the comparison fails, and the client reads again and retries.

kube-apiserver uses both: it creates objects with create-if-absent, and updates and deletes compare `mod_revision`. In step 2 the API server writes the catalog Deployment with "if `mod_revision` = 41250, then put", and in step 3 scheduler-b's Lease update becomes "if `mod_revision` = 41880, then put". A client that sends an update carrying an outdated `resourceVersion` gets `409 Conflict` instead of silently overwriting someone else's change.

### Leases

A **lease** is a timer that the cluster keeps on a client's behalf. The client grants one with a time to live (TTL), attaches keys to it and renews it with **keepalives**; the Go client sends them every third of the TTL. When the keepalives stop for longer than the TTL, the lease expires, etcd deletes every key attached to it, and each deletion reaches watchers as a `DELETE` event. A lease isn't tied to a connection, so a client can switch members and keep it, and a newly elected leader extends every lease when it takes over, so leases don't expire because of the cluster's own election.

Kubernetes attaches **Events** to etcd leases, which is how they disappear after `--event-ttl` (1 hour by default). Its **Lease objects** in the `coordination.k8s.io` API are something else: ordinary keys that the holder rewrites to renew, used for node heartbeats and for the leader election of kube-scheduler and kube-controller-manager. A standby takes over when it has seen no renewal for `leaseDurationSeconds`, 15 s by default for kube-scheduler (`--leader-elect-lease-duration`, renewed every 2 s), which is the takeover of step 3.

### Locks and leader election

Leases, transactions and watches combine into the coordination recipes etcd is known for. A client that wants to lead:

1. grants a lease, 15 s here, and keeps it alive;
2. creates the leader key in a transaction that succeeds only if the key doesn't exist, attached to its lease;
3. if the transaction fails, watches the key and tries again once it is deleted.

When the leader dies, its keepalives stop, the lease expires, etcd deletes the key, the waiting candidates see the `DELETE`, and the next transaction wins:

```sh
etcdctl lease grant 15
# lease 694d71ddacfda227 granted with TTL(15s)

etcdctl txn <<'EOF'
create("/acme/report-runner/leader") = "0"

put --lease=694d71ddacfda227 /acme/report-runner/leader runner-a

get /acme/report-runner/leader

EOF
# SUCCESS: runner-a leads (a candidate that loses sees FAILURE and the current leader's value)

etcdctl lease keep-alive 694d71ddacfda227   # keeps runner-a's lease, and its key, alive
etcdctl watch /acme/report-runner/leader     # what the other candidates wait on
```

etcd packages the pattern in its election and lock services (`etcdctl elect`, `etcdctl lock` and the Go `concurrency` package). There each candidate creates its own key under a shared prefix, attached to a session lease (60 s by default in the Go package and `etcdctl elect`, 10 s for `etcdctl lock`), and the key with the lowest `create_revision` leads, so candidates queue in order instead of all retrying at once.

A lease alone doesn't guarantee mutual exclusion. A leader can stall, in a long garbage-collection pause or on a slow disk, after its lease has run out, and then carry on as if it still led. etcd's notes on locks point to the key's revision as the **fencing token** that the protected resource should check, the idea Martin Kleppmann describes in *How to do distributed locking*; `etcdctl lock` hands that revision to the command it runs as `ETCD_LOCK_REV`. [Leader election](../leader-election/) follows the whole story, and [Redis](../redis/) locks make the opposite trade: a single primary with asynchronous replication, faster but with weaker guarantees.

### Disk, network and size

Every write waits until a majority of members has written it to disk with `fsync`, so **disk write latency** usually sets etcd's speed. The hardware guide asks for about 50 sequential IOPS for a light cluster and 500 for a busy one, recommends SSDs, and notes that typical clusters need two to four CPU cores and about 8 GB of memory. A slow or shared disk can make the leader miss its heartbeats, which the followers can't tell from a failure, so it costs a leader election; the FAQ explains why that is deliberate. The network adds a round trip to every write: members in the Availability Zones of one region work well, while members in different regions need much longer timeouts (the election timeout can go up to 50 s) and pay that latency on every write.

etcd holds metadata, not bulk data. A request may be at most 1.5 MiB (`--max-request-bytes`), and the database is limited to 2 GiB by default (`--quota-backend-bytes`), with 8 GiB as the suggested maximum. When a member exceeds its quota, etcd raises a `NOSPACE` alarm and the whole cluster accepts only reads and deletes until space has been freed, the database defragmented and the alarm cleared with `etcdctl alarm disarm`. Kubernetes can spread its data over several etcd clusters with `--etcd-servers-overrides`, for example to keep Events apart.

### Security

etcd listens on two ports: **2379** for clients and **2380** for the other members. Both should use TLS with client certificates: `--cert-file`, `--key-file`, `--trusted-ca-file` and `--client-cert-auth` for clients, and the `--peer-*` versions of the same flags between members. On top of TLS, etcd has users and roles with permissions on keys or prefixes (`etcdctl role grant-permission acme-config --prefix=true readwrite /acme/config/`, then `etcdctl auth enable`), and a user can be identified by the common name of its client certificate. For Kubernetes, access to etcd amounts to full control of the cluster, so the documentation advises letting only the API server reach it; Secrets should also be encrypted by the API server before they are stored, because by default it writes every resource to etcd in plain text.

### Backups, membership and upgrades

`etcdctl snapshot save` writes a point-in-time copy of a member's database, and `etcdutl snapshot restore` creates new data directories from it; every member of the restored cluster must start from the same snapshot. A restore takes the revision back to the snapshot's, which confuses clients that have seen later revisions, so for Kubernetes the disaster-recovery guide recommends restoring with `--bump-revision` and `--mark-compacted`: revisions keep increasing and every existing watch is cancelled.

Membership changes go through Raft as well. Replace a failed member by removing it first and then adding the new one, ideally as a learner: adding first would raise the majority while the cluster can't yet count on the newcomer. Upgrades are rolling, one member and one minor version at a time; to move to 3.7, every member must run 3.6.11 or later. Take a snapshot first: once all members run the new version, the way back is that snapshot or the documented downgrade procedure.

### Versions and licence

etcd is a Cloud Native Computing Foundation project, graduated in November 2020, under the Apache License 2.0. The current line is **3.7**: 3.7.0 was released on 8 July 2026 and 3.7.2 on 22 September 2026, the same day as patch releases 3.6.15 and 3.5.34 of the older lines. Version 3.7 removed the remaining v2 code and the deprecated experimental flags, added `RangeStream` for reading large ranges in chunks, and sped up lease operations and key-only reads. In Kubernetes 1.37, kubeadm installs etcd 3.7.0, and the API server reads large lists from etcd 3.7 as a stream when its `EtcdRangeStream` feature gate is on (beta, and on by default).

## Where it fits

- **Solutions.** The backing store of every Kubernetes cluster ([Kubernetes](../kubernetes/)): Deployments, Pods, Secrets, Leases and custom resources all live in etcd, behind kube-apiserver. Outside Kubernetes: Patroni, which runs [PostgreSQL](../postgresql/) high availability with etcd, ZooKeeper or Consul as its coordination store; CoreDNS's `etcd` plugin, which serves DNS records for service discovery from etcd; Apache APISIX, which keeps its routes and configuration in etcd.
- **Patterns it implements or supports.** [Leader election](../leader-election/) with leases and transactions; distributed locks with fencing by revision; an [external configuration store](../external-configuration-store/) that services watch instead of polling; service discovery with registrations that expire with their lease; and the watch-driven control loops of [Kubernetes](../kubernetes/).
- **Usual neighbours.** In Kubernetes, kube-apiserver as its only client. Elsewhere, client libraries over its gRPC API, [Prometheus](../prometheus/) scraping each member's metrics (`etcd_server_has_leader`, `etcd_server_leader_changes_seen_total`, `etcd_disk_wal_fsync_duration_seconds`, `etcd_mvcc_db_total_size_in_use_in_bytes`), and a scheduled job that takes snapshots.
- **Managed offerings (October 2026).** etcd usually comes inside a managed Kubernetes control plane rather than as a service on its own. **Amazon EKS** runs at least two API server instances and three etcd instances across three Availability Zones for each cluster, and reports the database usage in [CloudWatch](../amazon-cloudwatch/) (`etcd_mvcc_db_total_size_in_use_in_bytes`); past the quota, the cluster turns read-only. For its ultra-scale clusters (up to 100,000 nodes, announced in July 2025), AWS describes replacing etcd's Raft replication with an internal journal service, keeping the bbolt database in memory and splitting resource types across etcd clusters; those changes apply only to new clusters created with ultra-scale enabled. **Azure AKS** lists etcd among the control-plane components that Azure operates, in both AKS Automatic and AKS Standard. **Google GKE** stores cluster state either in etcd on every control-plane VM or in Spanner, and serves the etcd API to the API server either way. Outside Kubernetes you run etcd yourself, on virtual machines or in a cluster of its own.

## When to use it

Choose etcd when a group of services needs a small amount of shared state that must be **correct** rather than merely fast: configuration that every instance must read the same way, membership and service discovery with entries that vanish when their owner dies, locks, leader election, and anything that must never show two different values to two readers. It suits megabytes of metadata changed at the pace of control decisions, not user data written at the pace of user traffic. For bulk data use a database; for caches and short-lived locks where speed matters more than strict guarantees, [Redis](../redis/) is the usual choice. Apache ZooKeeper solves the same problem with a tree of znodes and ephemeral nodes bound to client sessions; Kafka relied on it until KRaft replaced it in Kafka 4.0. HashiCorp Consul is a service-networking product first, with a key/value store beside its service catalog, health checks and DNS. The etcd documentation has its own comparison, written, as it says, by the etcd team; the table below sticks to what each project documents.

| | etcd | Apache ZooKeeper | HashiCorp Consul |
|---|---|---|---|
| Replication | Raft | Zab, ZooKeeper's atomic broadcast protocol | Raft among the servers; Serf gossip for membership and failure detection |
| Data model | Flat, sorted key space; every key versioned (MVCC) | Tree of znodes, each with data (under 1 MB) and children | Key/value store (values up to 512 KB) next to a service catalog with health checks and DNS |
| Reads | Linearizable by default; serializable on request | Served by the connected server and possibly stale; `sync` catches up first | Modes `default`, `consistent` and `stale`; DNS uses `stale` by default |
| Change notification | Watches on keys or prefixes, from any retained revision | One-time watches; persistent and recursive watches since 3.6 | Blocking queries (long polling) |
| Liveness | Leases with a TTL and keepalives; keys deleted on expiry | Ephemeral znodes, deleted when the session ends | Sessions tied to health checks or a TTL; a lock-delay (15 s by default) before a lock can be retaken |
| Locks and election | Transactions; election and lock services | Recipes with sequential ephemeral znodes | Sessions on KV keys; `consul lock` |
| Licence | Apache 2.0 (CNCF) | Apache 2.0 (Apache Software Foundation) | Business Source License 1.1 since 1.17 (IBM) |
| Current release | 3.7.2 | 3.9.6 current, 3.8.7 stable | 2.0.4 |

Figures from each project's documentation and releases, October 2026.

## Trade-offs

- **Correctness costs latency and availability.** Every write waits for a majority's disks, and without a majority the cluster stops taking writes and linearizable reads. That is the intended trade: etcd refuses to answer rather than answer wrongly.
- **It doesn't scale out.** Every member holds all of the data and the leader orders every write, so more members add fault tolerance, not capacity, and slow writes down. The data must fit the quota; bigger systems split their data over separate clusters.
- **History needs housekeeping.** MVCC keeps every version until a compaction, and compaction leaves free pages that only defragmentation, which blocks the member while it runs, gives back to the file system.
- **Sensitive to slow disks.** A member that can't fsync in time misses heartbeats and looks failed, which costs leader elections. The hardware guide calls fast disks the most critical factor, and few deployments need much CPU.
- **Leases are not locks on their own.** A paused leader can act after its lease has expired; resources outside etcd need a fencing token, such as the key's revision, to reject it.
- **An operational job of its own.** Snapshots, defragmentation, certificate rotation, membership changes and upgrades one minor version at a time all need care. Managed Kubernetes takes all of that over for the cluster's own etcd.

## Implementation notes

- **Run three or five members**, one per failure domain such as an Availability Zone, on SSDs with low-latency links between them, on dedicated machines or at least away from disk-hungry neighbours, as the Kubernetes guide advises.
- **Tune the timeouts to the network**: a heartbeat interval near the round-trip time between members and an election timeout of at least ten times that, the same on every member.
- **Watch the health signals**: whether each member has a leader, how often leaders change, WAL fsync and backend commit durations, and database size against the quota. The FAQ says applying a request should normally take under 50 ms, and etcd warns when the average exceeds 100 ms.
- **Compact and defragment on a schedule.** The Kubernetes API server compacts every 5 minutes; for other uses, set `--auto-compaction-retention`, which is off by default. Defragment one member at a time, at a quiet moment; the Kubernetes guide points to `etcd-defrag`, which can run as a CronJob.
- **Take snapshots and practise restores**, including `--bump-revision` and `--mark-compacted` for Kubernetes, before an incident forces you to.
- **Change membership one member at a time**: remove a dead member before adding its replacement, and add newcomers as learners.
- **Secure both ports** with TLS and client certificates, allow only the API server (or your own services) to reach port 2379, and turn on etcd authentication for direct clients.
- **Keep keys structured and values small**: prefixes such as `/acme/config/` make watches and permissions simple; keep large blobs in an object store and only their references in etcd.
- **Use the provided recipes** (`concurrency.Election`, `concurrency.Mutex`, `etcdctl lock`) instead of hand-written locks, and pass the key's revision downstream as a fencing token.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Kubernetes](../kubernetes/) — A container orchestrator: you declare the desired state, and controllers keep pods scheduled, healthy and reachable.
- [Leader Election](../leader-election/) — Instances elect one coordinator; another takes over when its lease expires.
- [External Configuration Store](../external-configuration-store/) — Keep configuration out of the deployment package, in a central store read at runtime.
- [Apache Kafka](../kafka/) — A partitioned, replicated commit log: producers append events, consumer groups read at their own pace and can replay history.
- [Redis & Valkey](../redis/) — An in-memory data-structure server: cache, session store, rate limiter, leaderboard and lightweight queue in one process.
- [MongoDB](../mongodb/) — A document database: JSON-like documents with flexible schemas, replica sets for failover and sharding to scale out.

## References

- [etcd v3.7 documentation — etcd API](https://etcd.io/docs/v3.7/learning/api/)
- [etcd v3.7 documentation — etcd API guarantees](https://etcd.io/docs/v3.7/learning/api_guarantees/)
- [etcd v3.7 documentation — Data model](https://etcd.io/docs/v3.7/learning/data_model/)
- [etcd v3.7 documentation — FAQ](https://etcd.io/docs/v3.7/faq/)
- [etcd v3.7 documentation — Tuning](https://etcd.io/docs/v3.7/tuning/)
- [etcd v3.7 documentation — System limits](https://etcd.io/docs/v3.7/dev-guide/limit/)
- [etcd v3.7 documentation — Configuration options](https://etcd.io/docs/v3.7/op-guide/configuration/)
- [etcd v3.7 documentation — Hardware recommendations](https://etcd.io/docs/v3.7/op-guide/hardware/)
- [etcd v3.7 documentation — Failure modes](https://etcd.io/docs/v3.7/op-guide/failures/)
- [etcd v3.7 documentation — Maintenance](https://etcd.io/docs/v3.7/op-guide/maintenance/)
- [etcd v3.7 documentation — Disaster recovery](https://etcd.io/docs/v3.7/op-guide/recovery/)
- [etcd v3.7 documentation — Runtime reconfiguration](https://etcd.io/docs/v3.7/op-guide/runtime-configuration/)
- [etcd v3.7 documentation — etcd learner design](https://etcd.io/docs/v3.7/learning/design-learner/)
- [etcd v3.7 documentation — Transport security model](https://etcd.io/docs/v3.7/op-guide/security/)
- [etcd v3.7 documentation — Role-based access control](https://etcd.io/docs/v3.7/op-guide/authentication/rbac/)
- [etcd v3.7 documentation — Monitoring etcd](https://etcd.io/docs/v3.7/op-guide/monitoring/)
- [etcd v3.7 documentation — Interacting with etcd](https://etcd.io/docs/v3.7/dev-guide/interacting_v3/)
- [etcd v3.7 documentation — API reference: concurrency](https://etcd.io/docs/v3.7/dev-guide/api_concurrency_reference_v3/)
- [etcd v3.7 documentation — etcd versus other key-value stores](https://etcd.io/docs/v3.7/learning/why/)
- [etcd v3.7 documentation — Upgrade etcd from v3.6 to v3.7](https://etcd.io/docs/v3.7/upgrades/upgrade_3_7/)
- [etcd blog — Announcing etcd v3.7.0 (July 2026)](https://etcd.io/blog/2026/announcing-etcd-3.7/)
- [etcd-io/etcd — Releases](https://github.com/etcd-io/etcd/releases)
- [etcd-io/etcd — etcdctl README (release-3.7)](https://github.com/etcd-io/etcd/blob/release-3.7/etcdctl/README.md)
- [etcd-io/raft — Raft library for maintaining a replicated state machine](https://github.com/etcd-io/raft)
- [Diego Ongaro and John Ousterhout — In Search of an Understandable Consensus Algorithm (USENIX ATC 2014)](https://www.usenix.org/conference/atc14/technical-sessions/presentation/ongaro)
- [The Raft Consensus Algorithm](https://raft.github.io/)
- [CNCF — etcd project](https://www.cncf.io/projects/etcd/)
- [Kubernetes documentation — Operating etcd clusters for Kubernetes](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/)
- [Kubernetes documentation — Options for Highly Available Topology](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/ha-topology/)
- [Kubernetes documentation — kube-apiserver](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/)
- [Kubernetes documentation — kube-scheduler](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-scheduler/)
- [Kubernetes documentation — Leases](https://kubernetes.io/docs/concepts/architecture/leases/)
- [Kubernetes documentation — Kubernetes API Concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/)
- [Kubernetes source — apiserver etcd3 storage (store.go, release-1.37)](https://github.com/kubernetes/kubernetes/blob/release-1.37/staging/src/k8s.io/apiserver/pkg/storage/etcd3/store.go)
- [Martin Kleppmann — How to do distributed locking (2016)](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)
- [Apache ZooKeeper — Programmer's Guide](https://zookeeper.apache.org/doc/current/zookeeperProgrammers.html)
- [Apache ZooKeeper — Internals](https://zookeeper.apache.org/doc/current/zookeeperInternals.html)
- [Apache ZooKeeper — Recipes and Solutions](https://zookeeper.apache.org/doc/current/recipes.html)
- [Apache ZooKeeper wiki — Zab 1.0](https://cwiki.apache.org/confluence/display/ZOOKEEPER/Zab1.0)
- [Apache ZooKeeper — Releases](https://zookeeper.apache.org/releases.html)
- [HashiCorp Consul — What is Consul?](https://developer.hashicorp.com/consul/docs/intro)
- [HashiCorp Consul — Consensus](https://developer.hashicorp.com/consul/docs/concept/consensus)
- [HashiCorp Consul — Consistency Modes](https://developer.hashicorp.com/consul/api-docs/features/consistency)
- [HashiCorp Consul — Blocking Queries](https://developer.hashicorp.com/consul/api-docs/features/blocking)
- [HashiCorp Consul — Sessions and distributed locks overview](https://developer.hashicorp.com/consul/docs/automate/session)
- [HashiCorp Consul — Key/value (KV) store overview](https://developer.hashicorp.com/consul/docs/automate/kv)
- [hashicorp/consul — LICENSE (Business Source License 1.1)](https://github.com/hashicorp/consul/blob/main/LICENSE)
- [Amazon EKS User Guide — Amazon EKS architecture](https://docs.aws.amazon.com/eks/latest/userguide/eks-architecture.html)
- [Amazon EKS Best Practices Guide — EKS Control Plane](https://docs.aws.amazon.com/eks/latest/best-practices/control-plane.html)
- [AWS Containers blog — Under the hood: Amazon EKS ultra scale clusters (July 2025)](https://aws.amazon.com/blogs/containers/under-the-hood-amazon-eks-ultra-scale-clusters/)
- [Microsoft Learn — Azure Kubernetes Service (AKS) core concepts](https://learn.microsoft.com/en-us/azure/aks/core-aks-concepts)
- [Google Kubernetes Engine — GKE cluster architecture](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/cluster-architecture)
- [Patroni documentation — A Template for PostgreSQL HA with ZooKeeper, etcd or Consul](https://patroni.readthedocs.io/en/latest/)
- [CoreDNS — etcd plugin](https://coredns.io/plugins/etcd/)
- [Apache APISIX — Getting Started](https://apisix.apache.org/docs/apisix/getting-started/README/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
