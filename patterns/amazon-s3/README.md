<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🟧 AWS Services](../../README.md#aws-services)

# Amazon S3

> Object storage: objects in buckets, addressed by key, stored across Availability Zones, with storage classes, versioning and events.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Amazon S3" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/amazon-s3.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | The bucket `photos-prod` holds every photo. The API, a Lambda function, signs a **presigned PUT URL** that expires in 15 minutes, and the phone uploads `u/9f3c/IMG_0042.jpg` straight to S3, so the API never handles the bytes. The new object raises an **ObjectCreated** event that reaches a thumbnail function through SQS, CloudFront serves the thumbnails, and Athena can query objects where they lie. |
| **2 · Put an object** | The URL carries a **SigV4** signature. S3 recomputes it and checks the expiry, stores the bytes redundantly (S3 Standard spreads them across at least three Availability Zones), and only then answers **200 OK** with an ETag. A GET or LIST right after returns the new photo: S3 has had **strong read-after-write consistency** since December 2020. There are no real folders: `u/9f3c/IMG_0042.jpg` is one key, and the slashes only group keys into prefixes. Large files go up in parts (multipart upload). |
| **3 · Versions and lifecycle** | With versioning enabled, uploading `IMG_0042.jpg` again creates a second version and keeps the first. A DELETE adds a **delete marker**: a plain GET now returns 404, but both versions remain and the photo can be restored. A **lifecycle rule** on the prefix `u/` moves originals to S3 Glacier Instant Retrieval after 90 days and expires old versions 30 days after they are replaced. Storage gets cheaper per GB as access gets slower and reads cost more. |
| **4 · Events, access, limits** | The event lands in SQS and the Thumbnailer writes `thumbnails/u/9f3c/IMG_0042.jpg`; the notification's prefix filter `u/` keeps that write from triggering it again. New buckets block public access, disable ACLs and encrypt with SSE-S3 by default, so an unsigned GET gets **403**, and the bucket policy lets only CloudFront read, through origin access control. The limits to plan for: at least 3,500 writes and 5,500 reads per second per prefix, objects that are replaced whole rather than edited, and charges for requests, retrievals and data out as well as storage. |
<!-- END GENERATED: header -->

## The problem

A photo-sharing app collects millions of files that are written once, read many times, and must never be lost. A disk on an app server holds them in one place, fills up, and fails with the server. Routing every upload through the API also ties up instances for as long as each transfer takes, and the photos still have to reach a CDN, a thumbnail job and analytics. The app needs storage that keeps every file across failures, grows without planning capacity, and can be read and written over HTTP by anything that holds the right permission, with the API out of the data path.

## How it works

Amazon S3 is object storage behind an HTTPS API. Facts below are from the Amazon S3 User Guide and the AWS Price List as of October 2026.

### Buckets, keys and objects

- A **bucket** is created in one Region and holds any number of objects; there is no limit on its size or object count. An account can create 10,000 general purpose buckets by default. Bucket names share a global namespace (within a partition such as the commercial Regions), so `photos-prod` must be free; S3 can also create buckets in your [account regional namespace](https://docs.aws.amazon.com/AmazonS3/latest/userguide/gpbucketnamespaces.html), whose names end in your account ID, Region and `-an`.
- An **object** is a key, its bytes (0 B to 50 TB), and metadata: system metadata such as `Content-Type`, `Content-Length`, `ETag` and the storage class; up to 2 KB of user-defined `x-amz-meta-*` headers, fixed at upload; and up to 10 tags, which policies and lifecycle rules can match.
- A **key** is a UTF-8 string of up to 1,024 bytes. General purpose buckets have a flat namespace: `u/9f3c/IMG_0042.jpg` is one key, and the slashes only let `ListObjectsV2` with `prefix=u/9f3c/` and `delimiter=/` present keys as if they were folders. (Directory buckets, used by S3 Express One Zone, are the exception: they store directories for real.)
- With versioning on, each write gets a **version ID**, an opaque string; the diagram's v1, v2 and v3 are labels for readability, not something S3 returns.

### Requests and consistency

Clients call `PutObject`, `GetObject`, `HeadObject`, `DeleteObject`, `CopyObject` and `ListObjectsV2`; authenticated requests are signed with AWS Signature Version 4 (SigV4). Since December 2020 S3 gives **strong read-after-write consistency** for every PUT and DELETE in all Regions: after a successful write, any GET or LIST that starts later sees it. S3 checks that the data is stored redundantly on multiple devices before it reports an upload as successful, and the `ETag` it returns is the MD5 of the bytes for a single-part upload with SSE-S3. Updates to one key are atomic, so a reader gets the old object or the new one, never a mix. Two things are not covered:

- **Concurrent writers.** If two PUTs to the same key overlap, the later timestamp wins. Conditional writes prevent lost updates: `If-None-Match: *` (since August 2024) refuses to overwrite an existing key and `If-Match: <etag>` (since November 2024) only writes over the version you read; a failed condition returns `412 Precondition Failed`.
- **Bucket configuration** is eventually consistent. The user guide asks you to wait 15 minutes after first enabling versioning before writing.

### Durability and availability

S3 is designed for 99.999999999 % (eleven nines) durability over a year. S3 Standard, Intelligent-Tiering, Standard-IA and the three Glacier classes store each object on multiple devices across at least three Availability Zones and are designed to survive the loss of a whole zone. S3 One Zone-IA and S3 Express One Zone keep data in a single zone, so they lack that protection: AWS notes that One Zone-IA data is not resilient to the physical loss of its zone. Availability is a separate design target per class, from 99.99 % for S3 Standard to 99.5 % for One Zone-IA. AWS doesn't publish how the redundant data is laid out within and across zones; the diagram's chips only show that each zone holds data for every stored version.

### Storage classes

The storage class is chosen per object, at upload or later by a lifecycle rule. Storage prices are us-east-1 list prices per GB-month (AWS Price List, September 2026); other Regions differ.

| Class (API name) | Designed for | Zones | Minimum duration | Minimum billed size | Reading it | Storage |
|---|---|---|---|---|---|---|
| S3 Standard (`STANDARD`) | frequently read data | ≥ 3 | none | none | milliseconds, no retrieval fee | $0.023 (first 50 TB) |
| S3 Intelligent-Tiering (`INTELLIGENT_TIERING`) | unknown or changing access | ≥ 3 | none | none; objects under 128 KB are not monitored and stay in the frequent tier | milliseconds (optional archive tiers need a restore) | by tier, plus $0.0025 per 1,000 objects monitored |
| S3 Standard-IA (`STANDARD_IA`) | data read about once a month | ≥ 3 | 30 days | 128 KB | milliseconds, $0.01 per GB | $0.0125 |
| S3 One Zone-IA (`ONEZONE_IA`) | re-creatable, infrequent data | 1 | 30 days | 128 KB | milliseconds, $0.01 per GB | $0.01 |
| S3 Express One Zone (`EXPRESS_ONEZONE`) | latency-sensitive work in one zone, in directory buckets | 1 | none | none | single-digit milliseconds | $0.11 |
| S3 Glacier Instant Retrieval (`GLACIER_IR`) | archives read about once a quarter | ≥ 3 | 90 days | 128 KB | milliseconds, $0.03 per GB | $0.004 |
| S3 Glacier Flexible Retrieval (`GLACIER`) | archives read about once a year | ≥ 3 | 90 days | 40 KB overhead per object | restore first: 1–5 minutes (Expedited) to 5–12 hours (Bulk) | $0.0036 |
| S3 Glacier Deep Archive (`DEEP_ARCHIVE`) | data read less than once a year | ≥ 3 | 180 days | 40 KB overhead per object | restore first: within 12 hours (Standard) or 48 hours (Bulk) | $0.00099 |

Intelligent-Tiering moves an object to its Infrequent Access tier after 30 days without access and to Archive Instant Access after 90, with no retrieval fees. Deleting or transitioning an object before its class's minimum duration is billed for the rest of that minimum. Reduced Redundancy Storage still exists but AWS does not recommend it.

### Versioning, Object Lock, lifecycle and replication

- **Versioning** is off on a new bucket. Once enabled it can be suspended but never turned off. A PUT to an existing key adds a version; a plain DELETE adds a **delete marker**, a version with no data that makes a GET without a version ID return `404`. Deleting the marker brings the object back, and every version stays readable with `?versionId=`. Each version is a whole object and is billed as one.
- **Object Lock** stores versions write-once-read-many: a retention period (in governance or compliance mode) or a legal hold stops a version from being deleted or overwritten. It needs versioning.
- **Lifecycle rules** match objects by prefix, tags or size and transition them to colder classes (only down the "waterfall", from warmer to colder), expire current or noncurrent versions, and abort incomplete multipart uploads. Since September 2024 objects smaller than 128 KB are not transitioned unless a rule asks for it, so the 24 KB thumbnails would stay in S3 Standard even under a rule without a prefix.
- **Replication** copies new objects asynchronously to a bucket in another Region (CRR) or the same Region (SRR); both buckets need versioning. S3 Replication Time Control replicates 99.9 % of objects within 15 minutes and reports the ones that take longer; S3 Batch Replication copies objects that existed before the rule.

### Uploads: presigned URLs and multipart

A **presigned URL** carries a SigV4 signature, the signer's access key and an expiry in its query string, so whoever holds it can make that one request without AWS credentials. It can do only what its signer may do. URLs made in the console last between 1 minute and 12 hours, and the CLI and SDKs allow up to 7 days with long-term IAM user credentials. A URL signed with temporary credentials, such as a Lambda function's role, stops working when those credentials expire, whatever expiry it states. S3 checks the expiry when a request starts, so a transfer already running is not cut off. The API Lambda signs the upload URL like this (boto3 1.43; it only computes a signature and calls nothing):

```python
import boto3
from botocore.config import Config

# Sign with SigV4. Without this setting, boto3 1.43 produced a legacy
# Signature Version 2 URL for a us-east-1 client in our test.
s3 = boto3.client("s3", region_name="us-east-1",
                  config=Config(signature_version="s3v4"))

def handler(event, context):
    # The caller is already authenticated; the API picks the key, not the client.
    url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": "photos-prod", "Key": "u/9f3c/IMG_0042.jpg"},
        ExpiresIn=900,  # 15 minutes
    )
    return {"uploadUrl": url}
```

The URL it returns ends in `?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=…&X-Amz-Date=…&X-Amz-Expires=900&X-Amz-SignedHeaders=host&X-Amz-Security-Token=…&X-Amz-Signature=…`, and the phone uploads with a plain HTTP PUT, for example `curl -X PUT -T IMG_0042.jpg "$UPLOAD_URL"`. The CLI's `aws s3 presign` makes GET URLs only.

A single PUT takes up to 5 GB. Larger files go up as a **multipart upload**: up to 10,000 parts of 5 MiB to 5 GiB each (the last part can be smaller), sent in any order and in parallel, then assembled by `CompleteMultipartUpload` into one object of up to 50 TB, the limit since December 2025 (it was 5 TB). AWS suggests multipart once an object reaches about 100 MB. One GET returns at most 5 TB, so bigger objects are read in ranges.

### Events

An **event notification** sends a message to an SNS topic or SQS queue in the bucket's Region, or to a Lambda function, when objects are created, deleted, restored, transitioned or replicated, filtered by event type and by key prefix and suffix. Messages carry the bucket, the key (URL-encoded), size, ETag, version ID and a `sequencer` for ordering events on the same key. Delivery is at least once, typically within seconds but sometimes a minute or more, and not in order. SQS FIFO queues and SNS FIFO topics are not supported as destinations. If the consumer writes back to the same bucket, scope the notification to the input prefix (here `u/`) or it triggers itself.

Turning on **[Amazon EventBridge](../amazon-eventbridge/)** for a bucket instead sends every event type to EventBridge, where rules match on the event's fields and route it to many kinds of targets, including SQS FIFO queues.

### Security

- Access is decided by **IAM policies** on principals and **bucket policies** on the bucket. Since April 2023 new buckets have **S3 Block Public Access** on and **ACLs disabled** (Object Ownership: bucket owner enforced), so nothing is public unless someone turns those off on purpose.
- Every new object has been encrypted at rest since January 5, 2023, with SSE-S3 (keys managed by S3) by default; SSE-KMS and DSSE-KMS use AWS KMS keys. Since April 2026 new buckets also refuse SSE-C (customer-provided keys) [unless you enable it](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ServerSideEncryptionCustomerKeys.html).
- **Access points** are named endpoints attached to a bucket, each with its own policy, which helps when many teams share one dataset.
- **CloudFront origin access control (OAC)** signs CloudFront's requests to S3; the bucket policy allows the `cloudfront.amazonaws.com` principal to `s3:GetObject` only when `AWS:SourceArn` is this distribution.

### Performance

S3 scales request capacity per **partitioned prefix**: at least 3,500 PUT/COPY/POST/DELETE and 5,500 GET/HEAD requests per second each, with no limit on the number of prefixes. Scaling up is gradual, and while it happens S3 may answer `503 Slow Down`, which the SDKs retry. Spreading keys over prefixes (here one per user) multiplies the ceiling. For throughput, use parallel requests: multipart for uploads and byte-range GETs (`Range: bytes=…`) or `?partNumber=` for downloads. For small objects the user guide puts median latency in the tens of milliseconds.

### Costs

A bill has four parts: storage per GB-month (above), **requests** (in S3 Standard, us-east-1, $0.005 per 1,000 PUT, COPY, POST or LIST and $0.0004 per 1,000 GET), **retrievals** from the IA and Glacier classes, and **data transfer out**: $0.09 per GB for the first 10 TB a month to the internet beyond the free tier. Minimum durations and sizes, noncurrent versions and delete markers all add to it, and many small objects make request charges matter more than storage.

## Where it fits

- **Solutions.** User uploads for web and mobile apps (this one), static sites and media behind a CDN, the storage layers of a data lake that Athena, EMR or Redshift query in place, backups and archives (with Object Lock for immutable copies), log archives, and large payloads that are too big for a message.
- **Patterns in this catalog.** Presigned URLs are S3's form of the [Valet Key](../valet-key/). S3 is the usual payload store of a [Claim Check](../claim-check/), the bronze, silver and gold layers of a [Medallion Architecture](../medallion-architecture/), and the origin in [CDN edge caching](../cdn-edge-caching/). Versioning and cross-Region replication serve [disaster recovery](../disaster-recovery-strategies/), and event notifications start [event-driven](../event-driven-architecture/) and [web-queue-worker](../web-queue-worker/) pipelines.
- **Neighbours.** CloudFront in front; [AWS Lambda](../aws-lambda/), [Amazon SQS](../amazon-sqs/), SNS and EventBridge for events; Athena and AWS Glue for analytics; KMS for keys; IAM for access. For tables, **S3 Tables** (December 2024) stores Apache Iceberg tables in table buckets, with maintenance such as compaction run for you.
- **Managed offering.** S3 is itself the managed service. Other clouds offer the same model (below), and Ceph's RADOS Gateway implements a large subset of the S3 API for self-hosted clusters.

## When to use it

Use S3 when the data is files or blobs that are written whole and read many times, by many readers, over HTTP: user content, media, backups, data-lake files, build artefacts. Choose a database when you need queries, small updates or transactions across items, and a file system when software needs to open and edit files in place.

| | Amazon S3 | Azure Blob Storage | Google Cloud Storage | Self-hosted S3-compatible store | Amazon EFS |
|---|---|---|---|---|---|
| Model | objects in buckets, HTTPS API | blobs in containers, HTTPS API | objects in buckets, HTTPS API | the S3 API, or a large subset of it (Ceph RGW) | files and directories over NFS v4.0 and v4.1 |
| Redundancy choices | ≥ 3 zones, or one zone; replication between Regions | LRS (one datacenter), ZRS (three or more zones), geo-redundant GRS and GZRS | region, dual-region or multi-region buckets | what your cluster provides | Regional (several zones) or One Zone |
| Colder tiers (minimum duration) | Standard-IA 30 d, Glacier IR and Flexible 90 d, Deep Archive 180 d | Cool 30 d, Cold 90 d, Archive 180 d (offline, hours to read) | Nearline 30 d, Coldline 90 d, Archive 365 d | your hardware | not compared here |
| Change events | SNS, SQS, Lambda, EventBridge | Event Grid | Pub/Sub notifications | product-specific | not compared here |
| Short-lived links | presigned URLs, up to 7 days | shared access signatures (SAS) | signed URLs, up to 7 days | product-specific | none: clients mount the file system |
| Who runs it | AWS | Microsoft | Google | you; MinIO's AGPLv3 repository is [archived and unmaintained](https://github.com/minio/minio) (October 2026); the vendor now offers AIStor, in a free standalone edition and a commercial one | AWS |

Recent features blur the line with file systems: S3 Express One Zone directory buckets can append to an object and rename it, and the S3 FAQ describes [Amazon S3 Files](https://aws.amazon.com/s3/faqs/), a shared file system built on EFS that presents a bucket as files.

## Trade-offs

- **Whole objects.** In a general purpose bucket an object can't be edited, appended to or renamed: a change is a new PUT of the whole object, and a rename is a copy plus a delete.
- **Latency.** Tens of milliseconds per small request suits files fetched now and then, not chatty, database-like access: many small reads and writes cost time and request charges.
- **Cost has several meters.** Retrieval fees, minimum durations, per-request charges and egress can outweigh the storage price. A lifecycle rule that sends small or short-lived objects to Glacier classes can cost more than it saves.
- **Eventual delivery of events.** Notifications can arrive late, twice or out of order, so consumers must be idempotent and use the `sequencer` or the version ID.
- **Request-rate ceilings per prefix.** Sudden traffic on one prefix meets `503 Slow Down` until S3 scales; key design matters at high rates.
- **Region-bound.** A bucket lives in one Region; other Regions need replication, and its cost and lag.

## Implementation notes

- Let the API choose keys and sign short-lived URLs for exactly one key; never let clients name arbitrary keys. Validate the upload afterwards (type, size, malware) in the event consumer before anything else uses it.
- Keep the notification and the lifecycle rule scoped by prefix, so writes to `thumbnails/` neither re-trigger the Thumbnailer nor get archived. A lifecycle configuration for this bucket, applied with `aws s3api put-bucket-lifecycle-configuration --bucket photos-prod --lifecycle-configuration file://lifecycle.json`:

  ```json
  {
    "Rules": [
      {
        "ID": "originals-to-glacier-ir",
        "Filter": { "Prefix": "u/" },
        "Status": "Enabled",
        "Transitions": [{ "Days": 90, "StorageClass": "GLACIER_IR" }],
        "NoncurrentVersionExpiration": { "NoncurrentDays": 30 },
        "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
      }
    ]
  }
  ```

  and the event notification, applied with `aws s3api put-bucket-notification-configuration --bucket photos-prod --notification-configuration file://notify.json` (the queue's access policy must allow S3 to send to it):

  ```json
  {
    "QueueConfigurations": [
      {
        "QueueArn": "arn:aws:sqs:us-east-1:111122223333:thumbnail-jobs",
        "Events": ["s3:ObjectCreated:*"],
        "Filter": { "Key": { "FilterRules": [{ "Name": "prefix", "Value": "u/" }] } }
      }
    ]
  }
  ```

- Make the consumer an [idempotent consumer](../idempotent-consumer/): writing the same thumbnail twice is harmless, sending two notifications to the user is not. Put a [dead-letter queue](../dead-letter-queue/) behind the SQS queue for files that keep failing.
- With versioning on, add `NoncurrentVersionExpiration` unless you mean to keep every version: otherwise every overwrite and delete keeps a full copy, billed, forever.
- Serve downloads through CloudFront with OAC and keep Block Public Access on; use presigned GET URLs for private files that should not be cached.
- Use `If-None-Match: *` when a key must be written only once, and watch `503` counts (S3 Storage Lens or server access logs) to spot hot prefixes.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Valet Key](../valet-key/) — Give clients a short-lived, narrowly scoped URL to read or write storage directly.
- [Claim Check](../claim-check/) — Put the large payload in storage and send only a reference through the broker.
- [Medallion Architecture](../medallion-architecture/) — Bronze, silver, gold: raw data is refined in layers inside a lakehouse.
- [CDN & Edge Caching](../cdn-edge-caching/) — Serve static content from edge locations close to users; only cache misses reach the origin.
- [AWS Lambda](../aws-lambda/) — Functions as a service: code runs per event in managed execution environments that scale out with concurrency.
- [Amazon SQS](../amazon-sqs/) — A managed message queue: consumers poll, a visibility timeout hides messages in flight, and repeated failures go to a dead-letter queue.
- [Amazon EventBridge](../amazon-eventbridge/) — An event bus: rules match events from AWS services, SaaS apps and your own code by content and route them to targets.
- [Disaster Recovery Strategies](../disaster-recovery-strategies/) — Backup & restore, pilot light, warm standby, active-active: trading cost against RTO and RPO.

## References

- [Amazon S3 User Guide — Amazon S3 data consistency model](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html#ConsistencyModel)
- [AWS News Blog — Amazon S3 Update: Strong Read-After-Write Consistency (December 2020)](https://aws.amazon.com/blogs/aws/amazon-s3-update-strong-read-after-write-consistency/)
- [Amazon S3 User Guide — Data protection in Amazon S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/DataDurability.html)
- [Amazon S3 User Guide — Understanding and managing Amazon S3 storage classes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html)
- [Amazon S3 User Guide — Retaining multiple versions of objects with S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)
- [Amazon S3 User Guide — Transitioning objects using Amazon S3 Lifecycle](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-transition-general-considerations.html)
- [Amazon S3 User Guide — Amazon S3 Event Notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.html)
- [Amazon S3 User Guide — Download and upload objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [Amazon S3 User Guide — Amazon S3 multipart upload limits](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html)
- [Amazon S3 User Guide — Blocking public access to your Amazon S3 storage](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)
- [Amazon S3 User Guide — Best practices design patterns: optimizing Amazon S3 performance](https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html)
- [Amazon CloudFront Developer Guide — Restrict access to an Amazon S3 origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
- [Amazon S3 pricing](https://aws.amazon.com/s3/pricing/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
