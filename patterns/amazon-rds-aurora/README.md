<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🟧 AWS Services](../../README.md#aws-services)

# Amazon RDS & Aurora

> Managed relational databases: backups, Multi-AZ failover and read replicas, and Aurora's storage shared across three zones.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Amazon RDS &amp; Aurora" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/amazon-rds-aurora.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Acme Shop's orders database moves to AWS, and the diagram puts the two managed ways to run it side by side. Both sit in private subnets of the shop's VPC behind DNS endpoints on port 5432: **Orders** and the nightly **reports** job connect directly, while the bursty **pay-webhook** Lambda function goes through **RDS Proxy**, which lets many invocations share a pool of database connections. Option A is **Amazon RDS for PostgreSQL** with a Multi-AZ standby and a read replica, option B an **Amazon Aurora PostgreSQL** cluster with a writer and two readers on one shared volume, and in both AWS provisions the hosts, patches the operating system and the engine, takes the backups and runs the failover. |
| **2 · RDS Multi-AZ** | Orders runs `INSERT o-981`: the primary in AZ a writes it to its own volume and synchronously to the standby's volume in AZ b, and only then does COMMIT return, so a failover loses no committed transaction (the standby serves no reads). The read replica gets the change asynchronously, so a report that reads it a moment too early still sees `o-980`; meanwhile automated backups (a daily snapshot plus transaction logs copied to S3 every 5 minutes, kept 7 days here and up to 35) can restore the database to any second up to about 5 minutes ago. When the primary fails, RDS promotes the standby and points the endpoint's DNS name at it, typically within 60–120 seconds, and clients reconnect to the same name. |
| **3 · Aurora's shared storage** | Aurora sends the same `INSERT o-981` to the cluster volume as log records, never as pages: the volume keeps six copies of each segment, two in each of three AZs, and counts the write as durable once four of them have it (the design in the 2017 SIGMOD paper). The readers use the same volume, so the report through the reader endpoint already sees `o-981`; AWS documents reader lag as usually well under 100 ms. When the writer fails, Aurora promotes a reader and moves the cluster endpoint to it, usually within 60 seconds and often within 30, with no data to copy, and the volume grows by itself up to 128 TiB (256 TiB on recent engine versions). |
| **4 · Choosing, and the limits** | Aurora fails over faster and its readers share the volume, so they lag less and double as failover targets; RDS for PostgreSQL is simpler and costs less per instance-hour (us-east-1, October 2026: a db.r7g.large is $0.239 an hour, or $0.478 as Multi-AZ, against $0.276 per Aurora instance plus I/O charges, or $0.359 with I/O-Optimized and no I/O charges). Both run only the engine versions AWS offers, give no operating-system access, take settings through parameter groups and bill backup storage beyond a free allowance. For spiky loads **Aurora Serverless v2** sizes instances in ACUs (0–256 on recent versions) and can pause at 0, and for active-active writes across Regions **Aurora DSQL** is a separate, distributed PostgreSQL-compatible service. |
<!-- END GENERATED: header -->

## The problem

On the [PostgreSQL](../postgresql/) page, Acme Shop runs its orders database itself. Someone sizes and patches the servers, keeps a hot standby and a tool such as Patroni ready to promote it, archives the WAL to object storage, tests restores, and puts PgBouncer in front of the connections. None of that work is about orders, and all of it has to be right on the night a disk fails.

A managed relational database takes that work over. You choose an engine, an instance size and a deployment option; AWS provisions the hosts, installs and patches the engine, takes the backups and runs the failover. The schema, the queries, the indexes, vacuum tuning and connection handling stay yours. So does the choice between the two families on this page:

- **Amazon RDS** runs a standard engine on DB instances, each with its own block storage. For PostgreSQL that is community PostgreSQL, so `pg_dump` and logical replication take the data out again.
- **Amazon Aurora** keeps a MySQL- or PostgreSQL-compatible engine but replaces its storage with a distributed volume that every instance of the cluster shares. It runs only on AWS.

## How it works

### What AWS runs, and what stays yours

A **DB instance** is a database server that AWS operates on hardware you never see, placed in subnets of your VPC. A DB subnet group needs subnets in at least two Availability Zones, and the instance gets a DNS name such as `orders-db.<id>.us-east-1.rds.amazonaws.com`. RDS gives no shell or host access and blocks some privileged procedures and system tables; RDS Custom, for Oracle and SQL Server only, is the variant that hands back operating-system access.

Engines, as of October 2026: RDS runs IBM Db2, MariaDB, Microsoft SQL Server, MySQL, Oracle Database and PostgreSQL. Aurora comes in a MySQL-compatible and a PostgreSQL-compatible edition. Patches arrive in a weekly maintenance window, and on a Multi-AZ deployment RDS applies operating-system updates to the standby first and then fails over to it, so the interruption is about one failover long.

### Deployment options

| | Single-AZ DB instance | Multi-AZ DB instance | Multi-AZ DB cluster | Aurora DB cluster |
|---|---|---|---|---|
| Instances | one | a primary and one standby in another AZ | a writer and two readable standbys, in three AZs | one writer and up to 15 readers |
| Replication | none; backups only | synchronous | semisynchronous: a commit needs an acknowledgement from at least one reader | one shared cluster volume, six copies in three AZs |
| Does the standby serve reads? | — | no | yes | yes, the readers |
| Failover | no standby: a lost volume means a restore from backup | typically 60–120 s | typically under 35 s | usually under 60 s, often under 30 s |
| Engines | all RDS engines | all RDS engines (SQL Server uses its own mirroring or Always On) | RDS for MySQL and RDS for PostgreSQL | Aurora MySQL and Aurora PostgreSQL |

The diagram compares the second and the last column.

### Storage

RDS stores each instance's data on EBS volumes: General Purpose SSD (`gp2`, `gp3`) or Provisioned IOPS SSD (`io1`, `io2` Block Express). An RDS for PostgreSQL instance holds up to 64 TiB; only Oracle and SQL Server reach 256 TiB, with additional storage volumes. Magnetic storage is deprecated: no new instance can use it, RDS has moved existing magnetic volumes to `gp3`, and since 1 July 2026 a snapshot can no longer be restored onto it. Storage autoscaling (`--max-allocated-storage`) grows the allocated size when free space runs low, up to the ceiling you set. A Multi-AZ instance writes every change twice, so its write I/O doubles; RDS does not charge for the replication traffic between primary and standby.

Aurora has no volume size to choose. The cluster volume grows with the data, up to 128 TiB, or 256 TiB on Aurora PostgreSQL 15.13, 16.9, 17.5 and later (and Aurora MySQL 3.10 and later), and on current versions it gives space back when tables are dropped or truncated. Adding an instance copies no data, because the new instance attaches to the volume that is already there.

### Backups, snapshots and point-in-time recovery

**Automated backups** keep the database restorable for a retention period of 0 to 35 days; 0 turns them off, a Multi-AZ DB cluster needs at least 1, the console proposes 7 and the API defaults to 1. RDS takes a storage snapshot every day in the backup window (the first is full, the later ones incremental) and copies the transaction logs to S3 every five minutes. On a Multi-AZ instance the snapshot is taken from the standby, so the primary's I/O is not paused. Together they let you restore to **any second** of the retention period up to `LatestRestorableTime`, which is typically within the last five minutes. A restore always creates a new DB instance with a new endpoint; the source keeps running.

```sh
# Bring back the orders database as it was at 09:41 UTC, next to the original
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier orders-db \
  --target-db-instance-identifier orders-db-0941 \
  --restore-time 2026-10-07T09:41:00Z
```

**Manual snapshots** stay until you delete them, and you can copy them to another Region or share them with another account, which makes them the simplest disaster-recovery copy. Aurora backs up continuously and incrementally instead, with a retention period of 1 to 35 days and the same restore-to-a-new-cluster model.

Backup storage is free up to a limit: on RDS, up to the total storage provisioned in the Region; on Aurora, up to the size of the cluster volume, and snapshots taken within the retention period cost nothing extra. Longer retention and old manual snapshots are billed per GB-month.

### Read replicas

An **RDS read replica** receives changes through the engine's own asynchronous replication (streaming replication, for PostgreSQL). RDS for PostgreSQL allows up to 15 per source, in the same Region or in another one. Each replica is a full DB instance with its own storage and endpoint, and it lags: `ReplicaLag` in [CloudWatch](../amazon-cloudwatch/) shows how far, and the report in step 2 reads `o-980` because the change has not arrived yet. Replicas are not failover targets for the primary (that is the standby's job). You can promote one into a standalone instance, which ends its replication for good, and RDS for PostgreSQL 14.1 and later supports cascading replicas. The [Read Replicas](../read-replicas/) page covers lag and stale reads in depth.

**Aurora readers** attach to the cluster volume instead of keeping a copy. Up to 15 per cluster serve reads through the **reader endpoint**, which balances connections across them, or through custom endpoints that address a chosen subset, such as one reader reserved for reports. AWS documents the lag of an Aurora reader as usually much less than 100 ms. Every reader is also a failover target.

### Failover and endpoints

Applications should connect by endpoint name, never by IP address.

- **RDS Multi-AZ DB instance.** When the primary's host, storage, network or Availability Zone fails, RDS promotes the standby and changes the instance's DNS record to point at it. That typically takes 60–120 seconds, longer if a large transaction has to be recovered. Open connections break, so clients reconnect to the same name; AWS recommends that Java clients cache DNS answers for no more than 60 seconds.
- **Aurora.** The **cluster endpoint** always points at the writer. When the writer fails, Aurora promotes the reader with the highest priority (promotion tier 0 first, then the largest instance), and service is usually back within 60 seconds and often within 30. A cluster without readers has to create a new writer, which typically takes under 10 minutes, so AWS recommends at least one reader in another AZ.

Rehearse it before you need it:

```sh
aws rds reboot-db-instance --db-instance-identifier orders-db --force-failover   # RDS Multi-AZ
aws rds failover-db-cluster --db-cluster-identifier orders \
  --target-db-instance-identifier orders-reader-1                               # Aurora
```

The same promotion at Region scale is [Active-Passive Failover](../active-passive-failover/): a cross-Region read replica, or an Aurora global database.

### RDS Proxy

Every PostgreSQL connection is a server process, and a Lambda function that scales to hundreds of concurrent invocations can open hundreds of them. **RDS Proxy** sits in between: it keeps a pool of database connections and lends one to a client for the length of a transaction, so many client connections share a few database connections. The pool's ceiling is `MaxConnectionsPercent` of the database's `max_connections`; connections beyond what the pool can serve are queued, and rejected once the limits are reached.

- It runs in the same VPC as the database and is never publicly accessible. Clients can authenticate to it with IAM, and it connects to the database with credentials from Secrets Manager or with IAM database authentication.
- During a failover it keeps the client connections open and sends traffic to the new primary without waiting for DNS; AWS says this cuts failover time by up to 66% for Aurora Multi-AZ databases.
- It works with RDS for MariaDB, MySQL, PostgreSQL and SQL Server and with Aurora MySQL and PostgreSQL, not with Db2 or Oracle.
- **Pinning** undoes the sharing. Session state that other clients must not inherit ties a client to one database connection until it disconnects. For PostgreSQL that includes `SET`, prepared statements, temporary tables, cursors, `LISTEN`, session-level advisory locks and sequence functions such as `nextval`.

For Aurora there is also the **RDS Data API**: an HTTPS endpoint that runs SQL with credentials from Secrets Manager, without the caller holding a connection at all.

### Parameter groups

Engine settings live in **parameter groups**: a DB parameter group for an instance, and a DB cluster parameter group for an Aurora cluster or a Multi-AZ DB cluster. The default groups can't be edited, so create your own before you need to change anything. Dynamic parameters apply at once; static ones wait for a reboot, and the instance shows `pending-reboot` until then. Turning on logical decoding for [Change Data Capture](../change-data-capture/) is an example: set the static parameter `rds.logical_replication` to `1` and reboot.

### Security

- **Network:** keep instances in private subnets and let the security group accept port 5432 only from the application tier, as on the [Amazon VPC](../amazon-vpc/) page.
- **Credentials:** with `--manage-master-user-password`, RDS keeps the master password in Secrets Manager and can rotate it. **IAM database authentication** (MariaDB, MySQL and PostgreSQL, on RDS and Aurora) replaces passwords with a token from `aws rds generate-db-auth-token`, signed with Signature Version 4 and valid for 15 minutes; on PostgreSQL the database user needs the `rds_iam` role.
- **Encryption at rest** uses an AWS KMS key and covers the storage, logs, automated backups, read replicas and snapshots. It is chosen when the instance is created and can't be turned off. To encrypt an existing instance, restore it from an encrypted copy of a snapshot, or use a blue/green deployment. A snapshot copied to another Region needs a KMS key in that Region.

### Monitoring

CloudWatch receives the instance metrics (`CPUUtilization`, `FreeStorageSpace`, `DatabaseConnections`, `ReplicaLag`, `AuroraReplicaLag`), and Enhanced Monitoring adds operating-system metrics at up to one-second granularity. Query-level analysis now lives in **CloudWatch Database Insights**. AWS set the end of life of Performance Insights for 31 July 2026 and moved its users over; Database Insights' Standard mode keeps detailed per-query metrics for 7 days at no charge, and Advanced mode adds analysis of locks and execution plans with longer retention. RDS events, a failover for example, can drive [SNS](../amazon-sns/) notifications or [EventBridge](../amazon-eventbridge/) rules.

### Upgrades: blue/green deployments and Extended Support

Minor versions arrive in the maintenance window. For a major version, a parameter change or a schema change, a **blue/green deployment** copies the production environment into a staging (green) environment and keeps it in sync by replication; for RDS for PostgreSQL that is physical replication, or logical replication for a major-version upgrade. You test green, then switch over, which typically takes under a minute, loses no data and is protected by guardrails. It works for RDS for MariaDB, MySQL and PostgreSQL (11.1 and later) and for Aurora MySQL and PostgreSQL, but not for Db2, Oracle or SQL Server.

When a major version reaches the end of RDS standard support, instances that are still on it are enrolled in **RDS Extended Support**, a paid offering with security and critical fixes for up to three more years for PostgreSQL. To avoid the charge, set `--engine-lifecycle-support open-source-rds-extended-support-disabled` when you create or modify an instance; RDS then upgrades it to the next supported major version when standard support ends.

### Aurora: storage built from the log

The 2017 SIGMOD paper by Verbitski et al. explains the design behind step 3.

- **The log is what crosses the network.** The database instance sends only redo log records to storage and never writes a data page back, whether for a checkpoint or to make room in its cache. The storage nodes apply the records and build the pages in the background.
- **Six copies, a quorum of four.** The volume is split into segments (10 GB each, according to the paper), and each segment is kept six times, two copies in each of three AZs. A write is durable once four copies acknowledge it. The volume can lose a whole AZ and one more copy without losing data, and any two copies, including a whole AZ, without losing the ability to write. Normal reads need no quorum, because the instance knows which copy is up to date; the read quorum of three is used to rebuild state after a crash. A failed segment is copied back quickly (the paper gives 10 seconds for 10 GB over a 10 Gbps link), which keeps the window for a second failure short.
- **Readers share the volume.** The writer also streams its log records to the readers, which update the pages they hold in memory, so their lag stays short and adding one needs no copy of the data.
- **Fast clones** share pages with the source until either side changes them (copy-on-write). The first 15 clones of a source work that way; later ones are full copies.
- **Global databases** add up to 10 read-only secondary Regions, replicated on dedicated infrastructure with a lag that is typically under a second. A switchover moves the writer to a secondary Region without data loss; a failover does it when the primary Region is lost.
- **Aurora Serverless v2** (the instance class `db.serverless`; the current documentation calls it simply Aurora serverless) sizes each instance in Aurora capacity units (ACUs) of about 2 GiB of memory each, with matching CPU and networking. Recent engine and platform versions scale from 0 to 256 ACUs (Aurora PostgreSQL 13.15, 14.12, 15.7, 16.3 and later; Aurora MySQL 3.08 and later), and an instance whose minimum is 0 pauses after 300 seconds to one day without connections (`SecondsUntilAutoPause`). It resumes in about 15 seconds, or 30 seconds or more after a pause of over a day. Serverless and provisioned instances can share a cluster.
- **Aurora Standard or I/O-Optimized.** Standard bills storage plus every million I/O requests; I/O-Optimized charges no I/O but costs more per instance-hour and per GB. AWS recommends I/O-Optimized once I/O is 25% or more of the Aurora bill. You can switch to I/O-Optimized once every 30 days and back at any time.
- **Aurora PostgreSQL Limitless Database** spreads writes over several writer instances, for workloads that outgrow a single writer.

### Aurora DSQL in brief

Aurora DSQL shares the Aurora name but is a different, serverless service: a distributed, PostgreSQL-compatible SQL database without instances to choose, which accepts writes in every Region of a multi-Region cluster and replicates them synchronously, with strong consistency. AWS designs it for 99.99% availability in one Region and 99.999% across Regions. It uses optimistic concurrency control: conflicting transactions fail at commit with SQLSTATE `40001` and must be retried. The isolation level is fixed at repeatable read, and some PostgreSQL features, such as temporary tables and triggers, are missing. Treat it as a new design for active-active workloads, not as a place to move an existing PostgreSQL application unchanged.

### What it costs

Both bill instance-hours per second with a 10-minute minimum, storage per GB-month, and backup storage beyond the free allowance; Aurora Standard adds I/O requests. On-demand prices in us-east-1 from AWS's price list of 1 October 2026:

| | RDS for PostgreSQL, Single-AZ | RDS for PostgreSQL, Multi-AZ (one standby) | Aurora PostgreSQL, Standard | Aurora PostgreSQL, I/O-Optimized |
|---|---|---|---|---|
| `db.r7g.large` per hour | $0.239 | $0.478 | $0.276 per instance | $0.359 per instance |
| Storage per GB-month | $0.115 (`gp3`) | $0.23 (`gp3`) | $0.10 | $0.225 |
| I/O requests | no per-request charge | no per-request charge | $0.20 per million | no charge |

For the diagram's two options, the instances alone cost $0.717 an hour for option A (Multi-AZ plus one replica) and $0.828 for option B (writer plus two readers) on Aurora Standard, before storage and I/O. Prices differ by Region and change; check the pricing pages.

## Where it fits

- **Solutions:** the system of record behind web and mobile back ends, SaaS products, shops and internal business systems, wherever the data is relational and the team would rather not run database servers; and the landing place when a self-managed MySQL, PostgreSQL, Oracle or SQL Server database moves to AWS.
- **Patterns in this catalog:** [Read Replicas](../read-replicas/) (RDS replicas and Aurora readers); [Active-Passive Failover](../active-passive-failover/), at zone scale with Multi-AZ and at Region scale with cross-Region replicas or a global database; [Disaster Recovery Strategies](../disaster-recovery-strategies/), from snapshot copies in another Region (backup and restore) to a running secondary (pilot light, warm standby); [Database per Service](../database-per-service/), with an instance, a cluster or at least a database and credentials per service; [Change Data Capture](../change-data-capture/) through logical replication into AWS DMS or Debezium and on to [Kafka](../kafka/), together with the [Transactional Outbox](../transactional-outbox/); [Blue-Green Deployment](../blue-green-deployment/) for engine upgrades; and [Serverless](../serverless/) back ends on [AWS Lambda](../aws-lambda/) through RDS Proxy or the Data API.
- **Usual neighbours:** an [Amazon VPC](../amazon-vpc/) with private subnets and security groups, RDS Proxy, Secrets Manager, AWS KMS, [AWS IAM](../aws-iam/), CloudWatch, [Amazon S3](../amazon-s3/) for snapshot exports, a cache such as [Redis](../redis/) on ElastiCache, and AWS DMS for migrations.
- **Managed offerings:** RDS and Aurora are AWS's managed services for the engine on the [PostgreSQL](../postgresql/) page and for the other engines listed above; on AWS the alternative is to run PostgreSQL yourself on EC2. Google Cloud (Cloud SQL, AlloyDB) and Azure (Azure Database for PostgreSQL) offer comparable services.

## When to use it

Choose **RDS** when you want a standard engine with backups, patching and failover handled, at the lowest price per hour; Multi-AZ for production, Single-AZ for development and data you can restore. Choose **Aurora** when failover time matters, when reads need several low-lag replicas that are also failover targets, when the data may outgrow 64 TiB, or when you want global databases, fast clones or Serverless v2. Run PostgreSQL yourself on EC2 only when you need what a managed service withholds, and choose [Amazon DynamoDB](../amazon-dynamodb/) when the access patterns are key-based and the write volume has to scale past one primary.

| | RDS Single-AZ | RDS Multi-AZ | Aurora | PostgreSQL on EC2 | [DynamoDB](../amazon-dynamodb/) |
|---|---|---|---|---|---|
| An instance or AZ fails | no standby: a lost volume means a restore, losing up to the last ~5 minutes | standby takes over, typically in 60–120 s, no committed data lost | a reader takes over, usually in under 60 s | whatever you build (streaming replication, Patroni) | handled inside the service; data kept in three AZs |
| Scaling reads | up to 15 async read replicas | the same; the standby serves no reads | up to 15 readers on the shared volume | standbys you run | partitions, eventually consistent reads by default |
| Storage | EBS, up to 64 TiB, size it or autoscale | the same, written twice | grows by itself to 128 or 256 TiB | EBS volumes you manage | grows by itself |
| Who runs it | AWS; no OS access | AWS; no OS access | AWS; no OS access | you | AWS, serverless |
| Cost shape | instance-hours, storage | about twice Single-AZ | higher per instance, plus I/O on Standard | instances, volumes and your time | requests or capacity, and storage |
| Choose it for | development, restorable data | production on a standard engine | fast failover, many readers, big volumes | OS access, unsupported extensions or versions | key-value access at any scale |

## Trade-offs

- **Managed means constrained.** No operating-system access and no full superuser (some privileged procedures and system tables are off limits), only the engine versions and extensions AWS supports, and settings through parameter groups.
- **Failover still drops connections.** Even a 30-second failover breaks open connections and fails in-flight transactions, so clients need retries, short DNS caching and idempotent writes.
- **Replicas lag.** RDS read replicas are asynchronous, and Aurora readers trail by milliseconds; read-your-writes paths belong on the writer.
- **One writer.** Both scale writes only by moving to a bigger instance. Beyond that come sharding, Aurora PostgreSQL Limitless Database or Aurora DSQL, each with its own trade-offs.
- **Cost surprises.** Multi-AZ doubles the instance and storage price, Aurora Standard bills every I/O, long backup retention and old snapshots add up, and a major version left past its standard support date starts paying for Extended Support.
- **Lock-in differs.** RDS for PostgreSQL is community PostgreSQL and leaves with `pg_dump` or logical replication. Aurora's storage, global databases and Serverless v2 exist only on AWS, although the SQL and the drivers stay standard.

## Implementation notes

- **Production setup:** Multi-AZ on RDS, or an Aurora cluster with at least one reader in another AZ; deletion protection on; a final snapshot when deleting; a custom parameter group from day one.
- **Connections:** connect by endpoint name, cache DNS for at most 60 seconds, and retry with backoff after a failover. Put RDS Proxy in front of Lambda and other bursty clients, and keep an eye on pinned connections.
- **Backups:** keep at least 7 days of automated backups, copy snapshots to a second Region (with a KMS key there) if the business needs it, and rehearse a point-in-time restore and a failover every quarter.
- **Security:** private subnets, a security group that admits only the application tier, TLS on every connection, encryption chosen at creation, and passwords in Secrets Manager or IAM database authentication.
- **Monitoring:** alarm on `ReplicaLag` or `AuroraReplicaLag`, `FreeStorageSpace` (RDS), CPU and connection counts; use Database Insights for slow queries; subscribe to failover events.
- **Upgrades:** follow the engine's support calendar, test major upgrades with a blue/green deployment, and decide deliberately whether to pay for Extended Support.
- **Change data capture:** after `rds.logical_replication = 1`, watch replication slots, because a stalled consumer makes the database keep WAL until the disk fills.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [Read Replicas](../read-replicas/) — Send writes to the primary and spread reads across asynchronously updated replicas.
- [Disaster Recovery Strategies](../disaster-recovery-strategies/) — Backup & restore, pilot light, warm standby, active-active: trading cost against RTO and RPO.
- [Active-Passive Failover](../active-passive-failover/) — A warm standby region is promoted when the primary region goes down.
- [Database per Service](../database-per-service/) — Each service owns its data; others go through its API or events, never its tables.
- [Amazon DynamoDB](../amazon-dynamodb/) — A serverless key-value and document database: the partition key spreads items across partitions for single-digit-millisecond reads.
- [Change Data Capture (CDC)](../change-data-capture/) — Stream every committed change from the database log to other systems.
- [Amazon VPC](../amazon-vpc/) — Your private network in AWS: subnets in each Availability Zone, route tables, gateways, security groups and endpoints.
- [AWS Lambda](../aws-lambda/) — Functions as a service: code runs per event in managed execution environments that scale out with concurrency.

## Related principles and frameworks

- [Well-Architected Framework](../well-architected-framework/) — Review a workload against six pillars, from operational excellence to sustainability, and decide on the trade-offs between them.

## Related database topics

- [Query Execution Plans](../query-execution-plans/) — Read EXPLAIN the way the planner thinks: scans, joins, estimated against actual rows, and the statistics behind each choice.

## References

- [Amazon RDS User Guide — What is Amazon Relational Database Service (Amazon RDS)?](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html)
- [Amazon RDS User Guide — Multi-AZ DB instance deployments for Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html)
- [Amazon RDS User Guide — Failing over a Multi-AZ DB instance for Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.Failover.html)
- [Amazon RDS User Guide — Multi-AZ DB cluster deployments for Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/multi-az-db-clusters-concepts.html)
- [Amazon RDS User Guide — Backup retention period](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.BackupRetention.html)
- [Amazon RDS User Guide — Restoring a DB instance to a specified time for Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIT.html)
- [Amazon RDS User Guide — Working with DB instance read replicas](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html)
- [Amazon RDS User Guide — Amazon RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html)
- [Amazon RDS User Guide — Avoiding pinning an RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy-pinning.html)
- [Amazon RDS User Guide — Amazon RDS DB instance storage](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html)
- [Amazon RDS User Guide — Quotas and constraints for Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Limits.html)
- [Amazon RDS User Guide — Parameter groups for Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithParamGroups.html)
- [Amazon RDS User Guide — IAM database authentication for MariaDB, MySQL, and PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.html)
- [Amazon RDS User Guide — Encrypting Amazon RDS resources](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.Encryption.html)
- [Amazon CloudWatch User Guide — CloudWatch Database Insights](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Database-Insights.html)
- [Amazon RDS User Guide — Overview of Amazon RDS Blue/Green Deployments](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/blue-green-deployments-overview.html)
- [Amazon RDS User Guide — Amazon RDS Extended Support with Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/extended-support.html)
- [Amazon Aurora User Guide — Amazon Aurora storage](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Overview.StorageReliability.html)
- [Amazon Aurora User Guide — High availability for Amazon Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.AuroraHighAvailability.html)
- [Amazon Aurora User Guide — Replication with Amazon Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Replication.html)
- [Amazon Aurora User Guide — Amazon Aurora endpoint connections](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Overview.Endpoints.html)
- [Amazon Aurora User Guide — Quotas and constraints for Amazon Aurora (size limits)](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_Limits.html)
- [Amazon Aurora User Guide — Using Aurora serverless](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.html)
- [Amazon Aurora User Guide — Scaling to Zero ACUs with automatic pause and resume for Aurora serverless](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html)
- [Amazon Aurora User Guide — Using Amazon Aurora Global Database](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database.html)
- [Amazon Aurora DSQL User Guide — What is Amazon Aurora DSQL?](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/what-is-aurora-dsql.html)
- [Amazon RDS for PostgreSQL pricing](https://aws.amazon.com/rds/postgresql/pricing/)
- [Amazon Aurora pricing](https://aws.amazon.com/rds/aurora/pricing/)
- [Verbitski et al. — Amazon Aurora: Design Considerations for High Throughput Cloud-Native Relational Databases (SIGMOD 2017)](https://www.amazon.science/publications/amazon-aurora-design-considerations-for-high-throughput-cloud-native-relational-databases)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
