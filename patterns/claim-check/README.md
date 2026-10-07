<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [📨 Messaging & Integration](../../README.md#messaging--integration)

# Claim Check

> Put the large payload in storage and send only a reference through the broker.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Claim Check" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/claim-check.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · A message too big** | Claims intake sends claim `7f3a`, a 30 KB form plus twelve photos (25 MB in all), as one message, and the topic, which accepts at most 256 KB per message, rejects it. A higher limit, or a hundred smaller messages, would only move the problem: large messages slow the broker for everyone, cost more where billing is per 64 KB chunk, sit in memory and on every replica, and are copied again to every consumer. |
| **2 · Store, then send a check** | Intake first uploads the payload to blob storage as `claims/7f3a.zip`, a key derived from the claim ID, and waits for the upload to succeed. Only then does it publish a **claim check** of about 1 KB: where the payload is, plus what consumers need to route and decide (claim type, size and SHA-256 checksum). Published the other way round, a consumer could ask for a payload that isn't there yet. |
| **3 · Redeem the claim check** | The broker routes on the metadata alone: the damage-assessment subscription filters on `type = auto` and downloads nothing. Each consumer then fetches the 25 MB straight from storage with its own read-only access (or a short-lived read-only URL it asks for separately, a [valet key](../valet-key/)), checks the SHA-256 and processes the claim. Archive redeems the same claim check independently. |
| **4 · Lifecycle and safety** | Someone has to delete the payload: the last consumer to finish (here 2 of 2), or a storage lifecycle rule that expires it after 30 days, longer than the message TTL plus retries. A publish that fails after the upload leaves an orphan that only the age rule removes, and a claim check that outlives its payload gets a not-found and goes to a [dead-letter queue](../dead-letter-queue/). The store now holds the data, so it needs its own access control and encryption. |
<!-- END GENERATED: header -->

## The problem

A car-insurance claim arrives at the claims intake service: a small JSON form and twelve photos of the damage, 25 MB in all. Two services need it. Damage assessment scores the photos, and the archive keeps a copy. A message broker connects them, so the obvious design is to publish the whole claim as one message.

Brokers are built to move large numbers of small messages, and most of them cap the size of a message. A topic on the Azure Service Bus Standard tier takes at most 256 KB, so this message is rejected and the sender gets an exception. The usual workarounds only move the problem:

- **Raise the limit** with a bigger tier or a broker setting. Every large message now takes memory and disk on the broker and on each of its replicas, and is copied again for every subscription that receives it. Microsoft notes that large messages on Service Bus Premium reduce throughput and increase latency, and several services charge by size: Amazon SQS and Amazon SNS bill each 64 KB chunk as a separate request, so one 1 MiB message costs 16.
- **Split the payload** into a hundred 256 KB messages. The same bytes still cross the broker, and now the consumers have to collect, order and reassemble the parts, and decide what to do when part 63 never arrives.
- **Send less** by compressing or resizing the photos. Worth doing anyway, but it only buys time, and damage assessment may need the full-resolution images.

There is a quieter problem too. The claim holds personal data and photos, and anything that can read the topic can read them: its subscriptions and dead-letter queues, monitoring tools, and the logs where failed messages end up.

## How it works

Think of the baggage tag at an airport: you hand over the heavy suitcase, travel with a small tag, and use the tag to collect the suitcase at the other end. The producer puts the payload in a store built for large objects, such as Amazon S3, Azure Blob Storage or Google Cloud Storage, and sends a **claim check** through the broker instead: a small message that says where the payload is, plus the few fields consumers need to route the message and decide what to do with it.

1. **A message too big.** Intake publishes the 25 MB claim as a single message, and the topic rejects it because it exceeds the 256 KB limit.
2. **Store the payload, then send the check.** Intake uploads the payload under a key derived from the claim ID, `claims/7f3a.zip`, and waits until the upload succeeds. Only then does it publish the claim check, about 1 KB:

   ```json
   { "claimId": "7f3a", "type": "auto",
     "payload": { "ref": "claims/7f3a.zip", "size": "25 MB", "sha256": "9c41…e07b" } }
   ```

3. **Redeem the claim check.** The broker routes on the metadata alone: damage assessment's subscription has a filter on `type = auto`, and nothing is downloaded to apply it. Each consumer reads its copy of the message, fetches the payload straight from storage with its own read-only access, checks the SHA-256 and processes the claim. The archive redeems the same claim check independently, at its own pace, and if it scales out as [competing consumers](../competing-consumers/), each instance fetches only the payloads of the messages it takes.
4. **Lifecycle and safety.** Someone has to delete the payload: the last consumer to finish, or a lifecycle rule in the store that removes it at a fixed age (30 days here), longer than any claim check can live. A publish that fails after the upload leaves an *orphan* that only the age rule will remove, and a claim check that outlives its payload gets a not-found and belongs in a [dead-letter queue](../dead-letter-queue/). The payload no longer travels inside the broker, so the store needs its own access control and encryption.

Each system does what it is good at. The broker delivers small messages reliably and routes them; the store keeps large objects cheaply and serves many readers in parallel.

### Message size limits, by broker

Checked against each vendor's documentation on 5 October 2026. Limits change, so check again before you design around a number.

| Broker | Largest message | Notes |
|---|---|---|
| Azure Service Bus, Basic and Standard tiers | 256 KB | Counts the system and user properties as well as the body. This is the limit in the diagram. |
| Azure Service Bus, Premium tier | 1 MB by default, up to 100 MB | Up to 100 MB per queue or topic only over AMQP and without batching (HTTP stays at 1 MB). Microsoft still advises keeping messages small. A message over 1 MB counts twice against a queue's size quota, and X + 1 times on a topic where X subscriptions match it. |
| Amazon SQS | 1 MiB | Raised from 256 KiB in August 2025. Each 64 KB chunk is billed as one request. |
| Amazon SNS | 256 KiB by default, up to 1 MiB | Since September 2026 the `MaximumMessageSize` topic attribute can go up to 1 MiB, on topics with at most 100 subscriptions, all of them Amazon SQS, AWS Lambda or Amazon Data Firehose. Each 64 KB chunk is billed once when published and once per delivery. |
| Azure Event Hubs | 256 KB (Basic), 1 MB (Standard and Premium), 20 MB (Dedicated) | Basic and Standard bill ingress in 64 KB events. |
| Google Cloud Pub/Sub | 10 MB of message data | At most 100 attributes per message, with keys up to 256 bytes and values up to 1,024 bytes: room for routing metadata, not for payloads. |
| Apache Kafka | 1,048,588 bytes by default | The broker's `message.max.bytes`, or `max.message.bytes` per topic, caps a record batch after compression. Producers have their own `max.request.size` (1,048,576 bytes by default) to raise as well. |

AWS ships the claim check as a library. The **Amazon SQS Extended Client Library** (Java, with synchronous and asynchronous clients, and Python) and the **Amazon SNS Extended Client Library** store payloads of up to 2 GB in Amazon S3 and send a reference in their place, and the consumer side resolves the reference transparently. The Java SQS library still offloads anything over 262,144 bytes (256 KiB) by default, the SQS limit until August 2025; the threshold is configurable.

### The automatic variant: the storage event is the claim check

Instead of publishing the claim check yourself, you can let the store announce the new object. **Amazon S3 event notifications** (to Amazon SQS, Amazon SNS, AWS Lambda or Amazon EventBridge) and **Azure Event Grid**'s `Microsoft.Storage.BlobCreated` event both carry the object's location and size, so the event itself is the claim check; three of the Azure Architecture Center's four claim-check samples use the blob URL in the Event Grid notification this way. It is [event-driven architecture](../event-driven-architecture/) with the store as the producer, and it removes the ordering problem, because the event only exists once the object does. The costs:

- The event carries the store's metadata, not yours. Anything consumers route on (the claim type here) has to come from the object key, object metadata or tags, or a lookup.
- Delivery is at least once and not instant: S3 notifications usually arrive within seconds but can take a minute or longer, and Event Grid consumers must allow for delayed, duplicate and out-of-order events. Consumers must be [idempotent](../idempotent-consumer/).
- Filter for complete objects. `BlobCreated` fires for `PutBlob`, `PutBlockList` and `CopyBlob`; on Data Lake Storage it also fires for `CreateFile`, so filter for `FlushWithClose` there. An S3 notification can't target an SQS FIFO queue directly (route it through EventBridge).

### Where the name comes from

Claim Check is one of the message transformation patterns in Gregor Hohpe and Bobby Woolf's *Enterprise Integration Patterns* (2003), alongside the **Content Enricher**, which adds data a message is missing, and the **Content Filter**, which removes data a recipient doesn't need. In their version a "check luggage" step stores part of a message under a unique key and replaces it with the key; further down the line, a Content Enricher uses the key to put the data back. Their motivation is broader than size limits: data that intermediate steps don't need slows every step down and makes messages harder to debug, so it can wait in a store until the step that needs it.

## When to use it

- **Payloads beyond the broker's limit**, now or as they grow: documents, images, audio, exports, model inputs, batches of records.
- **Payloads that fit but hurt**: large enough to slow a shared broker, to be billed by size, or to be copied to many subscribers.
- **Sensitive data that shouldn't sit in a broker**, its dead-letter queues, tooling and logs. Keep it in a store with its own access control and send only a reference.
- **Routing on metadata alone.** Routers, filters and intermediaries read a 1 KB message and choose a destination without ever touching the payload.
- **Large data passed between processing stages.** In a [pipes-and-filters](../pipes-and-filters/) pipeline, each stage can write its output as a new object and pass the reference on: the queues between stages stay light, and a failed stage can be retried from its input object.

**When not to use it:**

- **Small messages.** For a 2 KB event the pattern adds a storage round trip and a second system to run, and gains nothing.
- **Latency-critical paths**, where every consumer paying an extra fetch before it can start is too slow.
- **A tier that already fits.** If a broker tier that accepts your sizes is fast and cheap enough (Service Bus Premium with large message support, say), sending the payload inline is simpler, as Microsoft's guidance points out.
- **No shared store.** When the producer and the consumers can't both reach the same store, there is nothing to redeem the claim check against.

## Trade-offs

- **Two systems to keep consistent.** The upload and the publish are separate operations, not one transaction: a failed publish leaves an orphan, and a payload deleted too early leaves a claim check that can't be redeemed.
- **An extra hop and an extra dependency.** Every consumer makes a storage request before it can start. If the store is down or throttling, consumers stall although the broker is healthy.
- **Lifecycle becomes your job.** A broker removes a message once it is consumed or expires; nobody removes the payload unless you arrange it.
- **Security is split.** The broker's access control, encryption and network rules no longer cover the payload.
- **Messages are harder to inspect.** A message in a queue or a dead-letter queue no longer shows its content; tools and people have to follow the reference.
- **The cost moves.** You pay for storage, storage requests and data transfer instead of broker capacity. For small payloads that is more, for large ones usually much less.

## Implementation notes

### Ordering and retries

- **Store first, then publish.** Publish the claim check only after the upload has returned success, so a consumer never receives a reference to an object that doesn't exist yet. Azure's guidance makes the same point.
- **Use a deterministic key.** Derive the object key from the business identity (`claims/7f3a.zip`) instead of a fresh UUID per attempt, so a retried upload overwrites the same object rather than leaving a second copy behind. The Java extended clients for SQS and SNS name each payload with a random UUID by default, so a retried send there leaves an orphan for a lifecycle rule to clean up.
- **Make consumers idempotent.** Brokers deliver at least once, so the same claim check can arrive twice. Downloading twice is harmless; assessing the claim twice may not be ([idempotent consumer](../idempotent-consumer/)).
- **Publish reliably.** If intake also records the claim in a database, upload the payload first, then save the claim and the claim check in one transaction with a [transactional outbox](../transactional-outbox/) and let a relay publish it. A transaction that fails leaves only an orphan, never a check without a payload.
- **Treat a missing payload as permanent.** A not-found won't fix itself on retry, so dead-letter the message with the reason. The Java SQS extended client can instead delete such messages (`ignorePayloadNotFound`, off by default), which hides the problem.

### Deleting the payload

Decide who owns deletion, and when, before the first payload is stored. The options:

- **The consumer deletes it.** Fine with exactly one consumer. The Java SQS extended client does it by default, deleting the S3 object when the message is deleted, and the large-message utility in Powertools for AWS Lambda (Java) deletes it after successful processing. With [publish-subscribe](../publish-subscribe/), this is a bug: the first subscriber to finish deletes a payload the others still need, so turn the cleanup off for topics that fan out.
- **Reference counting.** Record how many consumers must finish, and delete when the last one reports done. It needs a fixed, known set of consumers and a place to keep the count. In publish-subscribe the producer deliberately doesn't know its subscribers, so a count is easy to get wrong when one is added.
- **Expiry by age.** A lifecycle rule deletes payloads a fixed time after they were written: S3 Lifecycle expiration, Azure Blob Storage lifecycle management or Cloud Storage Object Lifecycle Management. Make the age longer than any claim check can live: the message's time-to-live or retention period (Amazon SQS keeps a message for 4 days by default and 14 at most), plus time spent in retries and in a dead-letter queue you may want to redrive. On the Service Bus Standard and Premium tiers a message's default time-to-live is effectively unlimited, so set one on the entity.

Many systems combine them: the consumers, or a counter, delete promptly, and an age rule catches orphans and failures. Lifecycle rules are not exact timers. S3 removes expired objects asynchronously, possibly some time after they expire (it stops charging for them at expiry), and a new or changed Azure lifecycle policy can take up to 24 hours to take effect, so treat the age as a minimum. Keep payloads under their own prefix or bucket so the rule can't touch anything else.

### Security

- **Protect the store in its own right.** Inside the message, the payload was covered by the broker's access control, encryption and network rules; in the store it isn't. Encryption at rest is on by default in the main object stores (Amazon S3 has encrypted every new object since January 2023, and Azure Storage encryption can't be turned off), so the remaining work is to use customer-managed keys if the broker did, require TLS, and restrict network access.
- **Least privilege for each party.** The producer gets write access to its prefix only, and each consumer gets read access, under its own identity such as a managed identity or an IAM role.
- **No credentials in the claim check.** Azure's guidance is to keep authorization between each consumer and the store. A signed URL inside the message can be used by anyone who reads the topic, a dead-letter queue or a log, until it expires. When a consumer outside your trust boundary needs the payload, have it ask for a short-lived, read-only URL at the moment it needs one: a [valet key](../valet-key/).
- **No secrets in the metadata.** Brokers, routers and monitoring tools see message properties. Send identifiers and categories, not names, card numbers or tokens.

### Integrity

- **Put a checksum in the claim check** (SHA-256 here) and verify it after the download. Decide what a mismatch means: fetch again, or dead-letter the message for investigation.
- **Let the store check the upload too.** Amazon S3 verifies a checksum sent with the upload (it supports CRC-64/NVME, its default, as well as SHA-256, CRC-32C and others), and Azure Blob Storage checks a `Content-MD5` or `x-ms-content-crc64` header on Put Blob.
- **A content hash can be the key** (`claims/9c41…e07b.zip`). Retries and duplicates land on the same object, and the key proves what it points to. In return, the hash has to be computed before the upload, and when two claims share an identical file, one object has two owners to account for before it is deleted.

### Latency and cost

- **Every consumer pays one storage round trip** per message before it can start, plus the transfer itself; routers and filters that read only the metadata pay nothing.
- **Offload conditionally if most payloads are small.** Send small ones inline and only the large ones through storage, as the SQS extended client does by default (`alwaysThroughS3` forces every payload through S3). The message must then say clearly whether it carries the payload or a reference.
- **Mind data transfer.** A consumer in another region, or outside the cloud, pays transfer charges on every fetch; keep the store close to its readers.

### Libraries

- **AWS:** the Amazon SQS and Amazon SNS Extended Client Libraries, the Payload Offloading Java Common Library for AWS that the Java clients build on, and the large-message utility in Powertools for AWS Lambda (Java).
- **.NET:** NServiceBus's claim check feature (the `NServiceBus.ClaimCheck` package, long known as DataBus).
- **Azure:** the Azure Architecture Center's samples cover Event Grid with Queue Storage, Event Hubs and Service Bus, plus a custom claim check sent to Event Hubs over its Kafka endpoint.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Valet Key](../valet-key/) — Give clients a short-lived, narrowly scoped URL to read or write storage directly.
- [Publish-Subscribe](../publish-subscribe/) — Broadcast each message to every interested subscriber through a topic.
- [Dead-Letter Queue](../dead-letter-queue/) — Park messages that keep failing so they stop blocking the queue and can be inspected.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.
- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.
- [Transactional Outbox](../transactional-outbox/) — Save the event in the same database transaction as the data, then relay it: no dual-write gap.
- [Competing Consumers](../competing-consumers/) — Several workers pull from one queue, so work is shared and throughput scales out.
- [Pipes and Filters](../pipes-and-filters/) — Split processing into independent stages connected by channels.

## Related components and services

- [Amazon S3](../amazon-s3/) — Object storage: objects in buckets, addressed by key, stored across Availability Zones, with storage classes, versioning and events.

## References

- [Enterprise Integration Patterns — Claim Check](https://www.enterpriseintegrationpatterns.com/patterns/messaging/StoreInLibrary.html)
- [Azure Architecture Center — Claim Check pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/claim-check)
- [Amazon SQS — Managing large messages using Java and Amazon S3 (Extended Client Library)](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-s3-messages.html)
- [Amazon SQS — Message quotas](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html)
- [Amazon SNS — Publishing large messages](https://docs.aws.amazon.com/sns/latest/dg/large-message-payloads.html)
- [AWS What's New — Amazon SQS increases maximum message payload size to 1 MiB (August 2025)](https://aws.amazon.com/about-aws/whats-new/2025/08/amazon-sqs-max-payload-size-1mib/)
- [AWS What's New — Amazon SNS now supports message payloads up to 1 MiB (September 2026)](https://aws.amazon.com/about-aws/whats-new/2026/09/amazon-sns-1mib-support/)
- [Amazon SQS — Pricing (each 64 KB chunk of a payload is billed as one request)](https://aws.amazon.com/sqs/pricing/)
- [Azure Service Bus — Quotas and limits](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-quotas)
- [Azure Service Bus — Premium tier and large message support](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-premium-messaging)
- [Azure Service Bus — Message expiration (time to live)](https://learn.microsoft.com/en-us/azure/service-bus-messaging/message-expiration)
- [Azure Event Hubs — Quotas and limits](https://learn.microsoft.com/en-us/azure/event-hubs/event-hubs-quotas)
- [Google Cloud Pub/Sub — Quotas and limits](https://docs.cloud.google.com/pubsub/quotas)
- [Apache Kafka — Broker configs (message.max.bytes)](https://kafka.apache.org/43/configuration/broker-configs/#brokerconfigs_message.max.bytes)
- [Amazon S3 — Event notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.html)
- [Azure Event Grid — Azure Blob Storage as an Event Grid source](https://learn.microsoft.com/en-us/azure/event-grid/event-schema-blob-storage)
- [Amazon S3 — Expiring objects with S3 Lifecycle](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html)
- [Azure Blob Storage — Lifecycle management overview](https://learn.microsoft.com/en-us/azure/storage/blobs/lifecycle-management-overview)
- [Amazon SQS Extended Client Library for Java (GitHub)](https://github.com/awslabs/amazon-sqs-java-extended-client-lib)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
