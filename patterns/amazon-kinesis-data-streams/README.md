<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🟧 AWS Services](../../README.md#aws-services)

# Amazon Kinesis Data Streams

> Managed streaming: records go to shards by partition key, and consumers read each shard in order and can replay it.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Amazon Kinesis Data Streams" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/amazon-kinesis-data-streams.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Acme Shop's web servers and mobile API call `PutRecords` for every click, about 2,000 a second, and the session ID is the partition key. The stream **clicks** runs in provisioned mode with **4 shards**; AWS runs the servers and replicates every record synchronously across three Availability Zones. Three applications read the same records independently: the Lambda function **live-metrics** computes live metrics, **Amazon Data Firehose** writes files to the S3 data lake, and a **Managed Service for Apache Flink** app builds sessions. Reading doesn't remove anything, and the retention period, raised from the default 24 hours to 7 days, lets any reader replay the last week. |
| **2 · Shards and partition keys** | Kinesis hashes the partition key with **MD5** into a 128-bit **hash key**, and each shard owns a contiguous range of hash keys, a quarter each here. `s-41` hashes to `6e19676a…` (hex), inside shard 1's range `40…`–`7f…`, so every click of that session lands in **shard 1**. The shard gives the record a **sequence number**, 842 here (shortened), after the session's earlier 837, and the reply names the shard and the sequence number; order holds within a shard. Each shard takes up to **1 MB/s or 1,000 records/s** of writes and serves **2 MB/s** of reads. |
| **3 · Two kinds of consumers** | Lambda's event source mapping and Firehose poll every shard with `GetRecords` and **share** its 2 MB/s and 5 calls a second. The Flink app reads through an **enhanced fan-out** consumer: Kinesis pushes records to it over HTTP/2 (`SubscribeToShard`) with **its own** 2 MB/s per shard. When live-metrics fails on a batch, `BisectBatchOnFunctionError` splits it in two and retries the halves, and the mapping moves its position only past records that succeeded; `ParallelizationFactor` (1 to 10) can run several batches per shard at once. Firehose buffers 5 MiB or 300 s (its defaults for S3), whichever comes first, then writes a file to S3. Each reader keeps its own position: the mapping and Firehose track theirs, Flink stores its in its checkpoints, and an application built with the KCL keeps its in a DynamoDB lease table. |
| **4 · Hot shards and limits** | A scraper in session **s-90** adds 600 clicks a second, and all of them hash to shard 2, which now needs 1,100 records/s against its limit of 1,000. `PutRecords` returns the extra records with `ProvisionedThroughputExceededException` while shards 0, 1 and 3 use half their capacity. Fixes: change the key or stop the bot, split shard 2 (`SplitShard`, or `UpdateShardCount` for every shard), or switch to on-demand mode, which splits busy shards by itself; no fix lets a single key go past one shard's limit. The limits: order only within a shard, at-least-once delivery (producer retries write duplicates), 1 MiB per record by default (up to 10 MiB if you raise it), retention beyond 24 hours costs extra, and provisioned shards are billed by the hour, used or not. |
<!-- END GENERATED: header -->

## The problem

Acme Shop wants to see what shoppers do while they are still doing it. Every page view, search and add-to-cart in the web shop and the mobile app becomes a click event, about 2,000 a second at busy times and around 1 KB each. Several teams want the same events: a live dashboard needs conversion and error rates within seconds, the data team wants every click in the S3 data lake, and a stream-processing job groups clicks into sessions to spot bots and abandoned carts. When that job gets a bug fix, its team will want to run it over last week's clicks again.

Calling each consumer from the web servers ties the shop to every consumer's speed and uptime. A queue hands each message to one consumer and deletes it, so every reader would need its own copy and nobody could go back in time. Writing the clicks into a database table, only to scan them out again, costs more than it should at this rate. What fits is a log: write each event once, let every reader work through it at its own pace, and keep it for a while.

Amazon Kinesis Data Streams is AWS's managed log of that kind. A stream is divided into shards; producers add records over an HTTPS API, consumers read each shard in order, and records stay for the retention period, 24 hours by default and up to 365 days, whether anyone has read them or not. AWS runs the servers and replicates every record synchronously across three Availability Zones. Acme still decides how much capacity to buy, which key to partition by and how long to keep the data.

## How it works

### Streams, shards and records

- A **stream** is a set of **shards**, and a shard is both an ordered sequence of records and a unit of capacity. In provisioned mode each shard accepts up to **1 MB/s or 1,000 records a second** of writes, partition keys included, and serves up to **2 MB/s** of reads through at most **5 `GetRecords` calls a second**. Acme's stream `clicks` has 4 shards: 4 MB/s or 4,000 records a second in and 8 MB/s out, and its 2,000 clicks a second use half of that.
- A **record** is a partition key, a data blob and a sequence number. Kinesis never looks inside the blob. A record can be at most 1 MiB by default; since October 2025 a stream can be configured for records of up to 10 MiB (`UpdateMaxRecordSize`). Large records borrow burst capacity from their shard, whose limits stay the same, so AWS means them for occasional payloads and suggests keeping them under 2% of the traffic.
- Shards have IDs such as `shardId-000000000001`; the diagram calls Acme's four shards 0 to 3. A record can typically be read less than a second after it was written.

### Partition keys, hash keys and sequence numbers

Every record carries a **partition key**, a Unicode string of up to 256 characters. Kinesis computes the MD5 digest of the key and reads it as a 128-bit unsigned integer, the **hash key**. Each open shard owns a contiguous **hash key range**, and together the ranges cover every value from 0 to 2^128 − 1. A new stream divides that space evenly, so each of Acme's 4 shards owns a quarter, and a record goes to the shard whose range holds its hash key. Every record with the same key therefore lands in the same shard. A producer that wants to pick the shard itself sends an `ExplicitHashKey` instead.

The numbers in the animation are real. The MD5 of `s-41` starts with `6e19676a`, which is in the second quarter, so session s-41 always lands in shard 1; the scraper's session `s-90` (`b772d1fa…`) lands in shard 2:

```python
import hashlib

def hash_key(partition_key: str) -> int:
    # Kinesis reads the MD5 digest of the key as a 128-bit unsigned integer
    return int.from_bytes(hashlib.md5(partition_key.encode("utf-8")).digest(), "big")

def shard_of(partition_key: str, shards: int = 4) -> int:
    # valid while the shards split the key space evenly, as after CreateStream
    return hash_key(partition_key) * shards >> 128

for key in ["s-41", "s-90"]:
    print(key, f"{hash_key(key):032x}"[:8], shard_of(key))
# s-41 6e19676a 1
# s-90 b772d1fa 2
```

`list-shards` reports the ranges in decimal:

```sh
aws kinesis list-shards --stream-name clicks --output text \
  --query 'Shards[].[ShardId, HashKeyRange.StartingHashKey, HashKeyRange.EndingHashKey]'
# shardId-000000000000  0                                        85070591730234615865843651857942052863
# shardId-000000000001  85070591730234615865843651857942052864   170141183460469231731687303715884105727
# shardId-000000000002  170141183460469231731687303715884105728  255211775190703847597530955573826158591
# shardId-000000000003  255211775190703847597530955573826158592  340282366920938463463374607431768211455
```

When a shard stores a record it assigns a **sequence number**, a long decimal string that grows over time within the shard, and the reply to `PutRecord` or `PutRecords` returns it with the shard ID. Unlike Kafka offsets, sequence numbers are not consecutive: they work as positions ("start after this record"), not as a count of records. The diagram shortens them to three digits.

### Capacity modes

- **Provisioned.** You choose the number of shards and pay for each shard-hour whether the shard is busy or not, plus a charge per 25 KB of data written. You scale with `UpdateShardCount` or by splitting and merging single shards (see below). AWS suggests this mode for predictable traffic and when you want control over which hash keys go to which shard; its sizing rule is the larger of the write rate divided by 1 MB/s and the read rate of all consumers together divided by 2 MB/s.
- **On-demand Standard.** You set no shard count. A new stream takes 4 MB/s of writes; Kinesis then adds shards so that a stream can absorb twice the highest write rate of the previous 30 days, and splits a shard within about 15 minutes once it receives more than 500 KB/s. Traffic that more than doubles the previous peak within 15 minutes can still be throttled until the stream catches up. A stream can grow to 10 GB/s of writes and 20 GB/s of reads in US East (N. Virginia), US West (Oregon) and Europe (Ireland), and to 200 MB/s and 400 MB/s in other Regions unless AWS Support raises it, and an account can have 50 on-demand streams by default. You pay per GB written and read, plus a fixed charge per stream-hour.
- **On-demand Advantage** (November 2025) is a setting for all the on-demand streams of an account in one Region. It drops the per-stream charge, makes writes, reads and longer retention at least 60% cheaper per GB, charges enhanced fan-out reads like ordinary ones, raises the number of enhanced fan-out consumers per stream from 20 to 50 (in the Regions the documentation lists), and lets you set **warm throughput** so that a stream is ready for a burst before it arrives; since July 2026 warm throughput can also shrink a stream again. In return the account commits to at least 25 MB/s of writes and 25 MB/s of reads across its on-demand streams, billed as a shortfall when it uses less, and the setting can't be turned off for 24 hours after it is turned on. AWS positions it for accounts that write at least 10 MB/s, fan out to more than two consumer applications or run many streams.
- A stream can switch between provisioned and on-demand twice in 24 hours without interrupting producers or consumers. It keeps its shards, and from then on either you or Kinesis manages them.
- **Service-managed partition keys** (September 2026) are a setting for on-demand streams: with the record distribution strategy `AUTO` instead of the default `USER_PARTITION_KEY`, Kinesis ignores partition keys and spreads records over the shards itself, at no extra charge. Hot keys go away, and so does ordering. AWS suggests it for logs, metrics, telemetry and clickstreams that don't need order, and keeps partition keys for change data capture, per-account transactions and session analytics; Acme's Flink job builds sessions, so it keeps the session ID as its key.

### Writing records

- `PutRecord` writes one record. `PutRecords` writes up to 500 records in a request of up to 10 MiB including partition keys (5 MiB before October 2025), and the records can go to different shards.
- `PutRecords` is not all-or-nothing. The reply lists every record in request order, each with either its `ShardId` and `SequenceNumber` or an `ErrorCode` (`ProvisionedThroughputExceededException` or `InternalFailure`), and `FailedRecordCount` says how many failed. A producer that doesn't resend the failed records, with exponential backoff, loses them. Because each record is handled on its own, `PutRecords` doesn't promise to keep the order of a request; a producer that needs strict order for a key sends one `PutRecord` at a time and passes the previous record's sequence number in `SequenceNumberForOrdering`.
- Retries write duplicates. If a call times out after Kinesis stored the record, the retry stores it again under a new sequence number. Acme gives every click a `clickId`, so readers can drop the copy.
- The **Kinesis Producer Library (KPL)**, a Java library, batches, retries and rate-limits for you. It can also **aggregate** many small user records into one Kinesis record, which matters when records are smaller than 1 KB, since then the 1,000 records a second per shard is the limit reached first. Readers have to unpack them again: the KCL does it, Firehose does it automatically, and Lambda functions use AWS's de-aggregation modules. KPL 1.x (December 2024) is built on the AWS SDK for Java 2.x, KPL 0.x reached end of support on 30 January 2026, and aggregation doesn't work with service-managed partition keys.
- AWS services write to streams too: the Kinesis Agent tails log files, and [CloudWatch](../amazon-cloudwatch/) Logs, AWS IoT Core, EventBridge, CloudFront real-time logs and DynamoDB (see Where it fits) can deliver into a stream.

From the CLI, with the records in a file (`raw-in-base64-out` sends the data as written instead of expecting base64):

```sh
aws kinesis put-records --stream-name clicks \
  --cli-binary-format raw-in-base64-out --records file://clicks.json
```

```json
[
  { "Data": "{\"clickId\":\"c-90211\",\"page\":\"/cart\"}", "PartitionKey": "s-41" }
]
```

### Reading: shared throughput or enhanced fan-out

- A **shared-throughput** consumer, the default kind, asks `GetShardIterator` for a starting point: the oldest retained record (`TRIM_HORIZON`), the newest (`LATEST`), a sequence number (`AT_SEQUENCE_NUMBER`, `AFTER_SEQUENCE_NUMBER`) or a time (`AT_TIMESTAMP`). It then calls `GetRecords` in a loop; one call returns up to 10,000 records or 10 MB, and an iterator expires after 5 minutes. All such consumers of a shard share its 5 calls and 2 MB a second, and after a call that returns 10 MB the calls in the next 5 seconds are throttled. AWS gives an average delay of about 200 ms from write to read with one consumer, rising to about 1 second with five.
- An **enhanced fan-out** (EFO) consumer is registered on the stream with `RegisterStreamConsumer`. It calls `SubscribeToShard`, and Kinesis then pushes records to it over an HTTP/2 connection for up to 5 minutes, after which the consumer subscribes again. Each registered consumer gets its own 2 MB/s per shard, whatever the others do, with a typical delay of about 70 ms. A stream can have 20 registered consumers, or 50 under On-demand Advantage. In provisioned mode EFO adds a charge per consumer-shard hour and per GB read.
- For on-demand streams AWS recommends a single shared-throughput application, so that it has room to catch up after an outage, and enhanced fan-out for every other one.

### The usual consumers

- **AWS Lambda.** An event source mapping polls each shard about once a second (sharing it with the other pollers) or reads through an EFO consumer, and invokes the function synchronously with a batch from one shard: 100 records by default and up to 10,000, collected for up to `MaximumBatchingWindowInSeconds` (300 at most) and up to a 6 MB payload. It works on one batch per shard at a time, in order; `ParallelizationFactor` (1 to 10) runs several batches of a shard at once and still keeps the records of each partition key in order. Start new mappings at `TRIM_HORIZON`: with `LATEST`, a mapping can miss records written while it is being created or updated.
- When the function fails, Lambda by default retries the batch until its records expire from the stream, and the rest of the shard waits behind it. Bound that with `MaximumRetryAttempts` and `MaximumRecordAgeInSeconds`; let `BisectBatchOnFunctionError` split a failing batch in two, which doesn't count against the retries, to corner the bad record; and send what is finally given up to an on-failure destination, an SQS queue, SNS topic or S3 bucket. With `ReportBatchItemFailures` the function returns the sequence number of the first record it couldn't process, and Lambda retries from there instead of from the start of the batch. Delivery is at least once, so the function must be idempotent.

```sh
aws lambda create-event-source-mapping --function-name live-metrics \
  --event-source-arn arn:aws:kinesis:us-east-1:111122223333:stream/clicks \
  --starting-position TRIM_HORIZON --batch-size 100 --parallelization-factor 2 \
  --bisect-batch-on-function-error --maximum-retry-attempts 3 \
  --maximum-record-age-in-seconds 3600 --function-response-types ReportBatchItemFailures \
  --destination-config '{"OnFailure":{"Destination":"arn:aws:sqs:us-east-1:111122223333:live-metrics-failed"}}'
```

- **Amazon Data Firehose**, called Kinesis Data Firehose until February 2024, reads a stream from `LATEST` with `GetRecords`, once a second per shard (twice with full backup turned on), and counts against the shard's shared limits like any other poller. It de-aggregates KPL records, buffers them per destination (for S3, 1 to 128 MiB and 0 to 900 seconds, 5 MiB and 300 s by default, whichever is reached first) and then writes an object; it can also convert records to Parquet or ORC and partition them by content. With a stream as its source, Firehose retries a failed S3 delivery for as long as the stream still holds the records.
- **Amazon Managed Service for Apache Flink**, called Kinesis Data Analytics until August 2023, runs [Apache Flink](../flink/) applications. Flink's Kinesis source polls by default; set its reader type to `EFO` and give it a consumer name, and the connector registers that consumer and reads through it. Flink keeps its shard positions in its own checkpoints rather than in Kinesis or DynamoDB, so it restores its state and its positions together after a failure, and it reads a parent shard to the end before its children.
- **Kinesis Client Library (KCL)** applications run on EC2, ECS, EKS or anywhere else. The KCL is a Java library (other languages go through its MultiLangDaemon) that gives each shard to one worker under a **lease** and stores each lease's **checkpoint**, the position of the last record processed, in a DynamoDB **lease table** named after the application. KCL 3.x (November 2024) adds a worker-metrics table and a coordinator-state table and moves leases away from workers whose CPU is busiest; since KCL 3.5 all three can live in one table. Consumers built with KCL 2.0 or later use enhanced fan-out by default. KCL 1.x reached end of support on 30 January 2026.
- Since August 2026 Kinesis can also deliver a stream by itself, with no consumer to run, to a general-purpose S3 bucket in the source format or to Apache Iceberg tables in Amazon S3 Tables (*streaming tables*). Both need an on-demand stream and are billed per GB delivered. EventBridge Pipes, AWS Glue streaming jobs, Spark on Amazon EMR, Amazon Redshift streaming ingestion and Amazon OpenSearch Ingestion read streams as well.

### Order and duplicates

- **Order holds within a shard.** Records with the same partition key go to the same shard, and every reader sees a shard's records in sequence-number order; across shards there is no order. Order can still be lost on the way in: `PutRecords` doesn't keep the order of a request, and a retried record lands after the ones sent in the meantime.
- **Resharding keeps order only if readers cooperate.** After a split or a merge the old (parent) shard stops taking writes but keeps its records, so a reader has to finish the parent before it starts on the children. The KCL, Lambda and Flink's connector do this.
- **Delivery is at least once on both sides.** Producer retries store the same data twice under two sequence numbers, and consumers see records again after a restart, a deployment, a lease moving to another worker, a reshard or a retried batch; AWS notes that consumer retries cause most duplicates. Carry a unique ID in each record and make consumers [idempotent](../idempotent-consumer/).
- Item changes that DynamoDB writes to a stream can also arrive out of order and more than once; their `ApproximateCreationDateTime` attribute tells the real order and exposes duplicates.

### Resharding, hot shards and hot keys

- `SplitShard` divides one shard's hash key range in two at a hash key you choose, and `MergeShards` joins two shards whose ranges are adjacent; each operation takes one or two shards. The parent shard becomes `CLOSED` (no new records, the old ones still readable) and then `EXPIRED` once the retention period has passed, and the children get new shard IDs.
- `UpdateShardCount` resizes a provisioned stream evenly (`UNIFORM_SCALING`) by doing the splits and merges for you. By default a stream can be scaled 10 times in a rolling 24 hours, to at most double or at least half of its current shard count per call and to at most 10,000 shards; AWS recommends targets in steps of 25% of the current count, which complete faster.
- A **hot shard** receives more than its share. AWS suggests finding it with shard-level metrics or by logging the shard ID that every put returns, then splitting just that shard. Acme splits shard 2 in the middle of its range, so the bot's key ends up in a child shard with half of shard 2's normal traffic: 250 + 600 = 850 records a second, under the limit.

```sh
aws kinesis split-shard --stream-name clicks \
  --shard-to-split shardId-000000000002 \
  --new-starting-hash-key 212676479325586539664609129644855132160   # 2^127 + 2^125, hex a000…
```

- A **hot key** can't be split. One key has one hash key and so lives in one shard, which never takes more than 1 MB/s or 1,000 records a second, in any capacity mode; on-demand splits busy shards, but it doesn't separate the keys inside them. The cures are a different key (for example the session ID plus a suffix for known heavy senders, giving up their order), stopping the source, or service-managed partition keys for a stream that doesn't need order.

### Retention

- Records stay 24 hours by default. `IncreaseStreamRetentionPeriod` raises the period to at most 8,760 hours (365 days), and records that hadn't expired yet stay; `DecreaseStreamRetentionPeriod` lowers it to no less than 24 hours and makes older records unreadable almost at once.
- Acme keeps 7 days, so a fixed Flink job can replay last week:

```sh
aws kinesis increase-stream-retention-period --stream-name clicks --retention-period-hours 168
```

- The retention period is also the deadline for a stalled reader: whatever it hasn't read by then is gone. AWS suggests an alarm on the maximum of `GetRecords.IteratorAgeMilliseconds` that fires well before it reaches half the retention period.

### Encryption and access

- Server-side encryption uses an AWS KMS key: either the AWS managed key `aws/kinesis`, which costs nothing although Kinesis's calls to KMS are billed, or a customer managed key, which producers and consumers need permission to use. It applies to records written after you turn it on (`StartStreamEncryption`); records already in the stream stay unencrypted.
- Clients connect over TLS (1.2 required, 1.3 recommended). [IAM](../aws-iam/) policies separate producers (`kinesis:PutRecord`, `kinesis:PutRecords`), consumers and the operators who reshard. A resource-based policy on a stream or a consumer shares it with another account, for example with a Lambda function there; sharing an encrypted stream that way needs a customer managed key. Interface VPC endpoints keep the traffic inside AWS's network (see [Private Endpoints](../private-endpoints/)).

### Metrics to watch

- `IncomingBytes` and `IncomingRecords` against the shard limits; `WriteProvisionedThroughputExceeded` and `PutRecords.ThrottledRecords` for throttled writes.
- `GetRecords.IteratorAgeMilliseconds`, the age of the last record read through `GetRecords`, which shows how far the slowest polling reader is behind (Lambda reports its own `IteratorAge` per function); `SubscribeToShardEvent.MillisBehindLatest` does the same for enhanced fan-out readers; `ReadProvisionedThroughputExceeded` counts throttled reads.
- Stream-level metrics are free. Shard-level metrics, which name the hot shard, cost extra and are switched on per stream with `EnableEnhancedMonitoring`.

### Pricing

Prices in US East (N. Virginia), from the AWS price list of September 2026:

| | Provisioned | On-demand Standard | On-demand Advantage |
|---|---|---|---|
| Fixed | $0.015 per shard-hour | $0.04 per stream-hour | none, but at least 25 MB/s in and out are billed per account |
| Writes | $0.014 per million 25 KB payload units | $0.08 per GB, each record rounded up to 1 KB | $0.032 per GB |
| Shared reads | included up to 7 days of age | $0.04 per GB | $0.016 per GB |
| Enhanced fan-out reads | $0.015 per consumer-shard hour + $0.013 per GB | $0.05 per GB | $0.016 per GB |
| Retention, 24 h to 7 days | $0.020 per shard-hour | $0.10 per GB-month | $0.023 per GB-month |
| Retention past 7 days | $0.023 per GB-month, + $0.021 per GB read with `GetRecords` | $0.023 per GB-month | $0.023 per GB-month |

For Acme's stream in a 30-day month: $43.20 for 4 shards, $72.58 for 5,184 million payload units (2,000 records a second, each under 25 KB), $57.60 for 7 days of retention and, for Flink's enhanced fan-out, $43.20 of consumer-shard hours plus about $64 for 4,944 GB read. That is about $281, before Lambda, Firehose and Flink charge for their own work. The same traffic in On-demand Standard would cost about $1,166 ($396 to write, $396 for the two polling readers, $247 for Flink, $29 for the stream and $99 for retention), and On-demand Advantage would bill its minimum, about $3,040 a month. Steady, predictable traffic is where provisioned shards pay off.

Data between Kinesis and producers or consumers in the same Region is not charged, and Kinesis isn't part of the AWS Free Tier. Kinesis's own S3 delivery is billed on top of the stream: in US East (N. Virginia), $0.0275 per GB delivered from an On-demand Standard stream and $0.011 under On-demand Advantage.

## Where it fits

- **Solutions:** clickstream and product analytics, as here; [telemetry pipelines](../telemetry-pipeline/) that collect logs, metrics and IoT readings; [change data capture](../change-data-capture/) from DynamoDB tables, or from relational databases through AWS DMS or Debezium; live dashboards, fraud and anomaly detection; landing raw events in an S3 data lake, the bronze layer of a [medallion architecture](../medallion-architecture/).
- **Patterns it implements or supports:** [Publish-Subscribe](../publish-subscribe/) with replay, since every reader gets every record; the event backbone of an [event-driven architecture](../event-driven-architecture/); [sharding](../sharding/) by hash range, with the same hot-key problem; [competing consumers](../competing-consumers/) at the granularity of a shard, as KCL workers divide a stream's shards between them; [idempotent consumers](../idempotent-consumer/) to absorb redelivery; [CQRS](../cqrs/) read models and [materialized views](../materialized-view/) kept current by consumers.
- **Usual neighbours:** producers on [ECS](../amazon-ecs/), EC2 or [Lambda](../aws-lambda/), the Kinesis Agent, CloudFront real-time logs, IoT Core and [DynamoDB](../amazon-dynamodb/); consumers such as Lambda, Data Firehose, Managed Service for Apache Flink, KCL applications and Redshift streaming ingestion; [S3](../amazon-s3/), Glue and Athena downstream; CloudWatch, KMS and [IAM](../aws-iam/) around it.
- **Managed offerings:** Kinesis Data Streams is itself the managed service, and it exists only on AWS. AWS's other managed log is Amazon MSK, which runs Apache [Kafka](../kafka/). On other clouds the closest services are Azure Event Hubs and Google Cloud Pub/Sub.

## When to use it

Choose Kinesis Data Streams when several applications on AWS need the same events, in order per key, and may need to read them again; when the volume needs partitioning but nobody wants to run brokers; and when the readers are AWS services that consume streams directly, such as Lambda, Data Firehose and Managed Service for Apache Flink. Look elsewhere when each message should go to one worker ([SQS](../amazon-sqs/)), when a message must reach many endpoints at once ([SNS](../amazon-sns/)), when events should be routed by their content ([EventBridge](../amazon-eventbridge/)), when the data only has to land in storage (Data Firehose with direct puts, or Kinesis's own S3 delivery), or when the team wants Kafka's protocol, connectors and stream-processing libraries (Amazon MSK).

| | Kinesis Data Streams | Amazon MSK (Kafka) | [Amazon SQS](../amazon-sqs/) | [Amazon SNS](../amazon-sns/) | [Amazon EventBridge](../amazon-eventbridge/) | Amazon Data Firehose |
|---|---|---|---|---|---|---|
| What it is | a managed log split into shards | managed Kafka clusters: a log split into partitions | a managed queue | managed publish-subscribe | an event bus with rules | managed delivery into storage and analytics services |
| Who reads a message | every application, by position | every consumer group, by offset | one consumer, which deletes it | every subscription, pushed | each matching target, pushed | nobody: it writes to a destination |
| Order | per shard, chosen by partition key | per partition, chosen by key | FIFO queues: per message group | FIFO topics: per message group | none on classic buses; per event group on the newer Custom Event Bus | — |
| Keeps data | 24 hours by default, up to 365 days | per topic; Kafka's default is 7 days | 4 days by default, 1 minute to 14 days | no; FIFO topics can archive for up to 365 days | classic buses: only in an optional archive; Custom Event Bus: 1 to 365 days | only while buffering and retrying |
| Capacity | shards, or on-demand | brokers and partitions, or MSK Serverless | scales by itself | scales by itself | scales by itself | scales by itself |
| Choose it for | ordered, replayable streams read by several AWS services | the same with the Kafka ecosystem | work queues and buffering | fan-out to many endpoints | routing by content across services and accounts | loading S3, Redshift, [OpenSearch](../elasticsearch/) and others |

Figures from the AWS documentation in October 2026 and from the pages of this catalog that the table links to.

## Trade-offs

- **Capacity comes per shard, and per key.** A shard's 1 MB/s and 1,000 records a second are hard limits, and a single key can never use more than one shard. A skewed key throttles writes while the stream as a whole has room, as in step 4: one shard can't lend its spare capacity to another.
- **Order only within a shard, delivery at least once.** Producers and consumers both create duplicates, and keeping order across shards, or through retries, is the application's job.
- **Polling readers share 2 MB/s per shard.** Two or three polling applications fill a shard's read capacity, so each further reader usually needs enhanced fan-out, which costs extra outside On-demand Advantage.
- **Resharding is coarse.** Splits and merges handle one or two shards at a time, `UpdateShardCount` allows 10 changes a day of at most double or half, and readers have to drain parent shards first.
- **Small records, short memory by default.** 1 MiB per record (10 MiB if raised, for occasional use) and 24 hours of retention; every extra day costs money.
- **You pay for capacity, not only for use,** per shard-hour in provisioned mode and per stream-hour in On-demand Standard; On-demand Advantage swaps those for an account-wide minimum.
- **AWS only.** The API and the client libraries are Kinesis's own; moving to Kafka or another cloud means new producer and consumer code.

## Implementation notes

- **Choose the partition key for order and spread.** It should keep together what must stay in order (a session, an account, a device) and have far more values than there are shards, none much busier than the rest. Look out for keys that can turn hot: a bot, a very large merchant, a default value such as `unknown`.
- **Size provisioned streams for the peak, with headroom:** the larger of writes ÷ 1 MB/s (or records ÷ 1,000) and polling reads ÷ 2 MB/s, rounded up, plus room for bursts and for readers catching up. When traffic is unpredictable, start on-demand and switch once the pattern is known.
- **Handle partial failures in producers.** Check `FailedRecordCount` on every `PutRecords` reply and resend only the failed records with exponential backoff and jitter, or let the KPL do it.
- **Make every consumer idempotent** with an ID carried in the record, and checkpoint only after the work is done.
- **Give Lambda mappings a failure policy:** bounded `MaximumRetryAttempts` and `MaximumRecordAgeInSeconds`, `BisectBatchOnFunctionError` or `ReportBatchItemFailures`, and an on-failure destination, so one bad record can't stall its shard until it expires.
- **Alarm on lag and throttling:** the maximum of `GetRecords.IteratorAgeMilliseconds` (and Lambda's `IteratorAge`) well before half the retention period, `WriteProvisionedThroughputExceeded` and `ReadProvisionedThroughputExceeded`.
- **Keep KCL applications tidy.** Give each application a unique name, because its lease table is named after it, and delete its DynamoDB tables when you retire it; the KCL leaves them behind.
- **Encrypt from the start and split permissions.** Turn on server-side encryption before the first record is written, since older records stay unencrypted, and give resharding rights to an operator role rather than to producers and consumers.
- **Rehearse throttling.** Since October 2025, AWS Fault Injection Service has Kinesis actions that inject `ProvisionedThroughputExceededException` and `ExpiredIteratorException` errors, so you can see how producers and consumers cope before a real hot shard shows you.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Apache Kafka](../kafka/) — A partitioned, replicated commit log: producers append events, consumer groups read at their own pace and can replay history.
- [Apache Flink](../flink/) — A stream processor: stateful operators over unbounded streams, with event time, windows and exactly-once checkpoints.
- [AWS Lambda](../aws-lambda/) — Functions as a service: code runs per event in managed execution environments that scale out with concurrency.
- [Amazon DynamoDB](../amazon-dynamodb/) — A serverless key-value and document database: the partition key spreads items across partitions for single-digit-millisecond reads.
- [Telemetry Pipeline (OpenTelemetry)](../telemetry-pipeline/) — Receive, process and export traces, metrics and logs through one vendor-neutral collector.
- [Publish-Subscribe](../publish-subscribe/) — Broadcast each message to every interested subscriber through a topic.
- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.
- [Amazon SQS](../amazon-sqs/) — A managed message queue: consumers poll, a visibility timeout hides messages in flight, and repeated failures go to a dead-letter queue.

## References

- [Amazon Kinesis Data Streams Developer Guide — What is Amazon Kinesis Data Streams?](https://docs.aws.amazon.com/streams/latest/dev/introduction.html)
- [Amazon Kinesis Data Streams — Terminology and concepts](https://docs.aws.amazon.com/streams/latest/dev/key-concepts.html)
- [Amazon Kinesis Data Streams — Quotas and limits](https://docs.aws.amazon.com/streams/latest/dev/service-sizes-and-limits.html)
- [Amazon Kinesis Data Streams — Choose the right mode to stream in (provisioned, On-demand Standard, On-demand Advantage)](https://docs.aws.amazon.com/streams/latest/dev/how-do-i-size-a-stream.html)
- [Amazon Kinesis Data Streams — How service-managed record distribution works](https://docs.aws.amazon.com/streams/latest/dev/service-managed-pk-overview.html)
- [Amazon Kinesis Data Streams — When to use service-managed record distribution](https://docs.aws.amazon.com/streams/latest/dev/service-managed-pk-when-to-use.html)
- [Amazon Kinesis Data Streams — Handle large records](https://docs.aws.amazon.com/streams/latest/dev/large-records.html)
- [Amazon Kinesis Data Streams — Develop enhanced fan-out consumers with dedicated throughput](https://docs.aws.amazon.com/streams/latest/dev/enhanced-consumers.html)
- [Amazon Kinesis Data Streams — Use Kinesis Client Library](https://docs.aws.amazon.com/streams/latest/dev/kcl.html)
- [Amazon Kinesis Data Streams — KCL concepts](https://docs.aws.amazon.com/streams/latest/dev/kcl-concepts.html)
- [Amazon Kinesis Data Streams — DynamoDB metadata tables and load balancing in KCL](https://docs.aws.amazon.com/streams/latest/dev/kcl-dynamoDB.html)
- [Amazon Kinesis Data Streams — KCL version lifecycle policy](https://docs.aws.amazon.com/streams/latest/dev/kcl-version-lifecycle-policy.html)
- [Amazon Kinesis Data Streams — KPL key concepts](https://docs.aws.amazon.com/streams/latest/dev/kinesis-kpl-concepts.html)
- [Amazon Kinesis Data Streams — KPL version lifecycle policy](https://docs.aws.amazon.com/streams/latest/dev/kpl-version-lifecycle-policy.html)
- [Amazon Kinesis Data Streams — Process serialized data using AWS Lambda with the KPL](https://docs.aws.amazon.com/streams/latest/dev/kinesis-record-deaggregation.html)
- [Amazon Kinesis Data Streams — Reshard a stream](https://docs.aws.amazon.com/streams/latest/dev/kinesis-using-sdk-java-resharding.html)
- [Amazon Kinesis Data Streams — Decide on a strategy for resharding](https://docs.aws.amazon.com/streams/latest/dev/kinesis-using-sdk-java-resharding-strategies.html)
- [Amazon Kinesis Data Streams — Complete the resharding action](https://docs.aws.amazon.com/streams/latest/dev/kinesis-using-sdk-java-after-resharding.html)
- [Amazon Kinesis Data Streams — Change the data retention period](https://docs.aws.amazon.com/streams/latest/dev/kinesis-extended-retention.html)
- [Amazon Kinesis Data Streams — Handle duplicate records](https://docs.aws.amazon.com/streams/latest/dev/kinesis-record-processor-duplicates.html)
- [Amazon Kinesis Data Streams — Monitor the Kinesis Data Streams service with Amazon CloudWatch](https://docs.aws.amazon.com/streams/latest/dev/monitoring-with-cloudwatch.html)
- [Amazon Kinesis Data Streams — What is server-side encryption for Kinesis Data Streams?](https://docs.aws.amazon.com/streams/latest/dev/what-is-sse.html)
- [Amazon Kinesis Data Streams — How do I get started with server-side encryption?](https://docs.aws.amazon.com/streams/latest/dev/getting-started-with-sse.html)
- [Amazon Kinesis Data Streams — Share access using resource-based policies](https://docs.aws.amazon.com/streams/latest/dev/resource-based-policy-examples.html)
- [Amazon Kinesis Data Streams — Use Kinesis Data Streams with interface VPC endpoints](https://docs.aws.amazon.com/streams/latest/dev/vpc.html)
- [Amazon Kinesis Data Streams — Infrastructure security](https://docs.aws.amazon.com/streams/latest/dev/infrastructure-security.html)
- [Amazon Kinesis Data Streams — Perform resilience testing with AWS Fault Injection Service](https://docs.aws.amazon.com/streams/latest/dev/kinesis-fis.html)
- [Amazon Kinesis Data Streams — Streaming tables and S3 delivery](https://docs.aws.amazon.com/streams/latest/dev/data-delivery.html)
- [Amazon Kinesis Data Streams API Reference — PutRecords](https://docs.aws.amazon.com/kinesis/latest/APIReference/API_PutRecords.html)
- [Amazon Kinesis Data Streams API Reference — PutRecord](https://docs.aws.amazon.com/kinesis/latest/APIReference/API_PutRecord.html)
- [Amazon Kinesis Data Streams API Reference — GetRecords](https://docs.aws.amazon.com/kinesis/latest/APIReference/API_GetRecords.html)
- [Amazon Kinesis Data Streams API Reference — GetShardIterator](https://docs.aws.amazon.com/kinesis/latest/APIReference/API_GetShardIterator.html)
- [Amazon Kinesis Data Streams API Reference — SubscribeToShard](https://docs.aws.amazon.com/kinesis/latest/APIReference/API_SubscribeToShard.html)
- [Amazon Kinesis Data Streams API Reference — SplitShard](https://docs.aws.amazon.com/kinesis/latest/APIReference/API_SplitShard.html)
- [Amazon Kinesis Data Streams API Reference — MergeShards](https://docs.aws.amazon.com/kinesis/latest/APIReference/API_MergeShards.html)
- [Amazon Kinesis Data Streams API Reference — UpdateShardCount](https://docs.aws.amazon.com/kinesis/latest/APIReference/API_UpdateShardCount.html)
- [AWS Lambda — Using Lambda to process records from Amazon Kinesis Data Streams](https://docs.aws.amazon.com/lambda/latest/dg/with-kinesis.html)
- [AWS Lambda — Process Amazon Kinesis Data Streams records with Lambda (event source mapping)](https://docs.aws.amazon.com/lambda/latest/dg/services-kinesis-create.html)
- [AWS Lambda — Lambda parameters for Amazon Kinesis Data Streams event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/services-kinesis-parameters.html)
- [AWS Lambda — Retain discarded batch records for a Kinesis Data Streams event source](https://docs.aws.amazon.com/lambda/latest/dg/kinesis-on-failure-destination.html)
- [AWS Lambda — Configuring partial batch response with Kinesis Data Streams and Lambda](https://docs.aws.amazon.com/lambda/latest/dg/services-kinesis-batchfailurereporting.html)
- [AWS Lambda — Types of metrics for Lambda functions (IteratorAge)](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-types.html)
- [Amazon Data Firehose — Configure source settings for Amazon Kinesis Data Streams](https://docs.aws.amazon.com/firehose/latest/dev/writing-with-kinesis-streams.html)
- [Amazon Data Firehose — Configure backup settings and buffering hints](https://docs.aws.amazon.com/firehose/latest/dev/create-configure-backup.html)
- [Amazon Data Firehose — Handle data delivery failures](https://docs.aws.amazon.com/firehose/latest/dev/retry.html)
- [Apache Flink documentation — Amazon Kinesis Data Streams connector](https://nightlies.apache.org/flink/flink-docs-stable/docs/connectors/datastream/kinesis/)
- [Amazon DynamoDB — Using Kinesis Data Streams to capture changes to DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/kds.html)
- [Amazon EventBridge — What is the EventBridge Custom Event Bus?](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-custom-bus-what-is.html)
- [Amazon SNS — Message archiving for FIFO topic owners](https://docs.aws.amazon.com/sns/latest/dg/message-archiving-and-replay-topic-owner.html)
- [Amazon Kinesis Data Streams pricing](https://aws.amazon.com/kinesis/data-streams/pricing/)
- [Amazon Kinesis Data Streams FAQs](https://aws.amazon.com/kinesis/data-streams/faqs/)
- [AWS What's New (Sep 2026) — Kinesis Data Streams announces service-managed partition keys](https://aws.amazon.com/about-aws/whats-new/2026/09/kinesis/service-managed-partition-keys/)
- [AWS What's New (Aug 2026) — Kinesis Data Streams delivers data to general purpose Amazon S3 buckets](https://aws.amazon.com/about-aws/whats-new/2026/08/kinesis/data-delivery-general-purpose-s3-buckets/)
- [AWS What's New (Aug 2026) — Kinesis Data Streams streaming tables on Amazon S3 Tables](https://aws.amazon.com/about-aws/whats-new/2026/08/kinesis/data-delivery-s3-tables/)
- [AWS What's New (Jul 2026) — Scaling down ingest capacity with warm throughput](https://aws.amazon.com/about-aws/whats-new/2026/07/kinesis/on-demand-scale-down/)
- [AWS What's New (Nov 2025) — Kinesis Data Streams supports up to 50 enhanced fan-out consumers](https://aws.amazon.com/about-aws/whats-new/2025/11/amazon-kinesis-data-streams-enhanced-fan-out-consumers/)
- [AWS What's New (Nov 2025) — Kinesis Data Streams launches On-demand Advantage mode](https://aws.amazon.com/about-aws/whats-new/2025/11/amazon-kinesis-data-streams-ondemand-advantage/)
- [AWS What's New (Oct 2025) — Kinesis Data Streams supports 10x larger record sizes](https://aws.amazon.com/about-aws/whats-new/2025/10/amazon-kinesis-data-streams-10x-larger-record-sizes/)
- [AWS What's New (Nov 2024) — Kinesis Client Library 3.0](https://aws.amazon.com/about-aws/whats-new/2024/11/kinesis-client-library-reduces-stream-processing-compute-costs/)
- [AWS What's New (Nov 2024) — Managed Service for Apache Flink releases a new Kinesis Data Streams connector](https://aws.amazon.com/about-aws/whats-new/2024/11/amazon-managed-service-apache-flink-kinesis-data-streams-connector/)
- [AWS What's New (Feb 2024) — Amazon Data Firehose, formerly Amazon Kinesis Data Firehose](https://aws.amazon.com/about-aws/whats-new/2024/02/amazon-data-firehose-formerly-kinesis-data-firehose/)
- [AWS What's New (Aug 2023) — Introducing Amazon Managed Service for Apache Flink](https://aws.amazon.com/about-aws/whats-new/2023/08/amazon-managed-service-apache-flink/)
- [AWS CLI — aws kinesis list-shards](https://docs.aws.amazon.com/cli/latest/reference/kinesis/list-shards.html)
- [AWS CLI — aws kinesis put-records](https://docs.aws.amazon.com/cli/latest/reference/kinesis/put-records.html)
- [AWS CLI — aws kinesis split-shard](https://docs.aws.amazon.com/cli/latest/reference/kinesis/split-shard.html)
- [AWS CLI — aws kinesis increase-stream-retention-period](https://docs.aws.amazon.com/cli/latest/reference/kinesis/increase-stream-retention-period.html)
- [AWS CLI — aws lambda create-event-source-mapping](https://docs.aws.amazon.com/cli/latest/reference/lambda/create-event-source-mapping.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
