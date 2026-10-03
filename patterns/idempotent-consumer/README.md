<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [📨 Messaging & Integration](../../README.md#messaging--integration)

# Idempotent Consumer

> Remember processed message IDs so a redelivered message has no extra effect.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Idempotent Consumer" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/idempotent-consumer.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Why duplicates arrive** | The broker removes a message only when the consumer acknowledges it. Payments handles `m-7f3` (charge $40) and commits, but the acknowledgement is lost (a crash or a timeout before it reaches the broker), so the broker delivers `m-7f3` again: delivery is **at-least-once**. Nothing tells the handler that it has seen this message before, so the customer is charged twice: $80 instead of $40. |
| **2 · Save the ID with the work** | The handler opens a transaction, inserts `m-7f3` into `processed_messages` (a table with a single unique column, `message_id`), applies the charge and commits; only then does it acknowledge. The marker and the charge are saved together or not at all: saved separately, a crash between the two writes would either skip the charge for good or repeat it. The acknowledgement is not part of the transaction, so it can still be lost, as it is here. |
| **3 · Redelivery changes nothing** | With the acknowledgement lost, the broker delivers `m-7f3` again. This time the insert violates the unique key, which tells the handler that the work is already committed: it skips the charge and just acknowledges, so the total stays at $40. Two consumers racing on the same message are settled the same way: the database lets one insert win, and the other gets the duplicate-key error and skips. |
| **4 · Beyond your own database** | The handler also calls a payment provider, and no local transaction covers that call: if the response is lost or the handler crashes before it commits, the call is made again. So the handler sends the message ID as an **idempotency key**, and the provider recognises the repeat and returns the result of the first call instead of charging again. Where you can, prefer operations that are naturally idempotent (set a value, upsert) to ones that are not (add $40), and expire stored IDs once the broker can no longer redeliver the message. |
<!-- END GENERATED: header -->

## The problem

A message broker cannot see inside a consumer. It learns that a message has been handled only when the consumer acknowledges it, so a broker that must not lose messages keeps each one until the acknowledgement arrives, and delivers it again when it doesn't. That is **at-least-once delivery**, and acknowledgements go missing for ordinary reasons: the consumer crashes or is redeployed after committing its work but before acking, the network drops the ack, or the handler outlives its lease on the message (the visibility timeout in Amazon SQS, the message lock in Azure Service Bus, the acknowledgement deadline in Google Cloud Pub/Sub) and the broker hands the message to another instance.

From the broker's side, "handled, but the ack was lost" looks exactly like "never handled". It can give up, which loses messages (at-most-once), or deliver again, which repeats them (at-least-once). It has to pick one of the two, which is why **exactly-once delivery** is not on offer in general. What you can build is an exactly-once *effect*: let the message arrive as often as it will, and make sure the repeats change nothing.

Producers add duplicates of their own. A publisher that times out waiting for the broker's confirmation sends the message again, and a [transactional outbox](../transactional-outbox/) relay republishes after a crash, so a queue can hold two copies of the same fact.

A handler that is not prepared for this repeats its side effects: the customer is charged twice, the email goes out twice, the stock is reserved twice.

## How it works

An **idempotent consumer** leaves the system in the same state whether it handles a message once or five times. Where the work is not idempotent by nature, it gets there by remembering what it has already handled:

1. **Every message carries a stable ID**, the same on every delivery.
2. **The handler records the ID in the same transaction as its work.** It opens a transaction, inserts the ID into a `processed_messages` table that has a unique key on it, applies its changes and commits. The marker and the effect are saved together or not at all.
3. **A duplicate fails the insert.** The unique key rejects the second insert, which tells the handler that the work is already committed, so it skips the work.
4. **The handler acknowledges after the commit**, never before. If that acknowledgement is lost, the message comes back and the duplicate check absorbs it.
5. **Whatever the transaction cannot cover gets the ID too.** A call to another service or to a payment provider carries the message ID as an idempotency key, so the receiver can apply the same rule on its side.

Committing the marker with the effect is the heart of the pattern. Save the ID first and the work second, and a crash in between leaves a message that is marked as done although its work never happened: the redelivery is skipped and the charge is lost. Save the work first and the ID second, and a crash in between leaves the work done but unmarked: the redelivery repeats it.

### Choosing the ID

| ID | Stays the same across | Catches |
|---|---|---|
| **Assigned by the producer**: a business key (*order 1042, payment requested*), the event ID in the producer's outbox, or the idempotency key of the original client request | Redeliveries, producer retries, relays and replays | Every kind of duplicate |
| **Assigned by the broker** when it accepts the message | Redeliveries of that one stored message | Redeliveries only. A producer that retries a publish creates a second message with a second ID |
| **A hash of the content** | Anything with the same bytes | Too much: two separate messages that happen to be identical collapse into one |

So prefer an ID that the producer creates together with the business fact. A broker-assigned ID is enough only when nothing upstream can send the same fact twice.

### Where to remember IDs

| Store | Atomic with the work? | Notes |
|---|---|---|
| A `processed_messages` table in the same database, written in the same transaction | Yes | The pattern as animated. Add the consumer's name to the key when several consumers share the table |
| The business row itself | Yes | Keep the last message ID or a version number on the row and make the update conditional on it. No extra table, but it remembers only the latest message for each row |
| A conditional write in a key-value store | For one item, or for several with the store's transactions | In DynamoDB a `PutItem` with the condition `attribute_not_exists(...)` is rejected when the key is already there, and `TransactWriteItems` writes the marker and the business item all-or-nothing |
| A separate cache with a time-to-live, such as Redis `SET key value NX EX seconds` | No | Fast and self-cleaning, but two systems cannot commit together. Claim the ID first and a crash before the work loses the message; do the work first and a crash before the claim repeats it. Use it to shed most duplicates early, not as the only guard for an effect that matters |

### What brokers call exactly-once

Several brokers remove some duplicates themselves and describe that as exactly-once. In every case it means at-least-once delivery plus deduplication inside a boundary:

| Feature | What it removes | Where it stops |
|---|---|---|
| **Amazon SQS FIFO queues**, message deduplication ID | A send repeated with the same deduplication ID (or, with content-based deduplication, the same body) is accepted but not delivered a second time | Only within the 5-minute deduplication interval, and only on the way in. A message that is not deleted before its visibility timeout expires is received again |
| **Azure Service Bus**, duplicate detection | A send repeated with the same `MessageId` inside the detection window is accepted and dropped | The window is 10 minutes by default and can be 20 seconds to 7 days; the Basic tier doesn't have the feature. On the receiving side, a peek-lock message whose lock expires is delivered again |
| **Google Cloud Pub/Sub**, exactly-once delivery | No redelivery once a message has been acknowledged successfully, and none while its acknowledgement deadline is still running | Pull subscriptions only, and only for subscribers that connect in one region. A publisher that retries creates messages with different IDs, which are not deduplicated, and a message whose deadline expires is still redelivered |
| **Apache Kafka**, idempotent producer (`enable.idempotence`, on by default) | Duplicates written by the producer's own retries: the broker gives each producer an ID and uses sequence numbers to discard repeats | The producer side only. A consumer that crashes after processing a record but before committing its offset reads that record again |
| **Apache Kafka**, transactions | A consume-process-produce loop commits its output records and its input offsets atomically | Effects inside Kafka only. For output written anywhere else, Kafka's documentation suggests storing the offset in the same place as the output |

All of them work inside the broker's own boundary. None can know whether your handler's database write, its email or its call to a payment provider happened, so the consumer still needs its own guard for those.

### The same idea for HTTP APIs

A synchronous API has the same problem, with a client retrying a `POST` in place of a broker redelivering a message. The client sends a unique key with the request, the server stores the key with the outcome, and a repeat gets the stored outcome instead of a second execution. That is what the payment provider does in step 4 of the diagram.

The usual carrier is an `Idempotency-Key` request header. It is a widespread convention, not a standard: the IETF HTTPAPI working group's draft, *The Idempotency-Key HTTP Header Field*, reached version 07 in October 2025 and expired in April 2026 without becoming an RFC. The draft aims at `POST` and `PATCH` (HTTP already defines `PUT` and `DELETE` as idempotent) and suggests `400` when a required key is missing, `409` when a retry arrives while the first request is still being processed, and `422` when a key is reused with a different payload.

Stripe's API is a widely copied implementation. Its v1 API accepts the header on `POST` requests, saves the status code and body of the first request made with a key, and returns them for every later request with that key, even when the first result was an error. It rejects a key that comes back with different parameters and may remove keys once they are 24 hours old. Its v2 API recognises a replay for 30 days and runs a request again if the first attempt failed. AWS describes the same contract for its own APIs in the Amazon Builders' Library: a caller-supplied request identifier, an equivalent response for a repeat, and an error when the identifier is reused with different parameters.

## When to use it

- Any consumer on an at-least-once channel whose effect is not naturally idempotent: charging, sending, incrementing, appending, calling an API that creates something.
- Downstream of a [transactional outbox](../transactional-outbox/) or change data capture, which avoid lost events by accepting duplicated ones.
- Participants in a [saga](../saga-orchestration/), where commands, replies and compensations are all retried.
- Functions triggered by queues and streams ([serverless](../serverless/)). AWS Lambda's event source mappings, for example, process each event at least once.
- Webhook receivers, and HTTP APIs whose clients [retry](../retry-with-backoff/).
- **Not needed** when the handler is idempotent by nature: it sets a value, upserts by a business key or deletes, and messages cannot overtake each other. Nor when an occasional duplicate is harmless, as with metrics or cache warming.

## Trade-offs

- **A row and a write for every message.** The table grows with traffic and has to be pruned, and each message costs one more insert and index update inside the transaction.
- **The memory is bounded.** Once an ID has been deleted, a late duplicate is processed again, so retention has to cover the longest redelivery or replay that can still happen.
- **It depends on atomicity.** The guarantee holds only if the marker commits with the effect. A deduplication store outside the transaction (a cache, another database) leaves a window in which a crash loses or repeats work.
- **It stops at your database.** An effect in another system is covered only if that system honours an idempotency key, or if the operation is idempotent anyway.
- **It does not put messages in order**, and it does nothing for a message that fails every time: that is what a dead-letter queue is for.
- **It trusts the ID.** A producer that reuses an ID for a different message gets that message silently dropped, and one that creates a new ID on every retry defeats the check.

## Implementation notes

- **The insert.** In PostgreSQL, `ON CONFLICT DO NOTHING` turns a duplicate into "zero rows inserted" instead of an error, so the handler can branch on the row count:

  ```sql
  BEGIN;
  INSERT INTO processed_messages (message_id) VALUES ('m-7f3')
    ON CONFLICT DO NOTHING;
  -- 0 rows inserted: a duplicate. Commit, acknowledge and stop.
  -- 1 row inserted: the first delivery. Do the work in the same transaction:
  INSERT INTO payments (order_id, amount) VALUES (1042, 40);
  COMMIT;  -- acknowledge only after this
  ```

- **Races need no extra code.** With several instances pulling from one queue (competing consumers), two of them can hold the same message at once when a slow handler's lease runs out. With the marker and the work in one transaction, the database settles that race. In PostgreSQL the second insert waits for the first transaction to finish: if that one commits, the second sees a conflict; if it rolls back, the second goes ahead and does the work.
- **An in-progress state for long work.** When the work takes long, or includes calls that cannot be part of the transaction, record a status instead of a bare ID: insert the ID as `in progress` with a deadline and commit, do the work, then mark it `completed` and keep the result. A second delivery that finds `in progress` backs off, one that finds the deadline passed takes over, and one that finds `completed` returns the stored result. Powertools for AWS Lambda's idempotency utility works this way, with DynamoDB or a Redis-compatible cache as the store and records that expire after one hour by default. Because a takeover repeats the work, each step inside it still has to be safe to repeat.
- **How long to keep IDs.** At least as long as a duplicate can still arrive: the queue's retention period (4 days by default in SQS, 14 at most), plus any dead-letter queue you may replay, plus the producer's own retry horizon. Delete older rows in batches, or partition the table by day and drop whole partitions. A store with a time-to-live does this for you, but check how punctual it is: DynamoDB removes expired items within a few days, not at the second they expire.
- **Ordering is a separate problem.** A duplicate of an old message can arrive after newer ones. A stored ID still catches it, but a handler that relies on a naturally idempotent write (`SET status = 'PAID'`) would overwrite newer state with older. Give such writes a version or sequence number and apply a message only if it is newer than what the row has seen. On an ordered log such as a Kafka partition, the position can replace the ID table: store the offset of the last record applied next to the output, and skip anything at or below it. Projections in [event sourcing](../event-sourcing/) do the same.
- **Remote calls.** Derive the downstream key from the message ID, one key for each call (`m-7f3:charge`), so that every retry reuses it. A call made inside an open database transaction holds a connection for as long as the other side takes. If that hurts, make the call first and open the transaction afterwards: a redelivery then repeats the call, which the key makes harmless.
- **Prefer naturally idempotent operations.** `UPDATE orders SET status = 'PAID'` can run twice; `UPDATE accounts SET balance = balance - 40` cannot. An upsert that sets values (`INSERT ... ON CONFLICT DO UPDATE` in PostgreSQL) is atomic and can safely run twice. Keep the processed-ID table for the work that cannot be written that way.
- **Acknowledge last.** Acknowledging on receipt, before the commit, turns the consumer into at-most-once: a crash in the handler loses the message.
- **Redelivery flags are hints.** RabbitMQ sets a redelivery flag on a repeated delivery, and other brokers expose a delivery count. Neither says whether the earlier attempt committed, so they can prompt a check but cannot replace it.
- **Libraries.** Messaging frameworks often ship this as an *inbox* next to their outbox. The Eventuate framework implements the table that microservices.io describes. In .NET, the NServiceBus Outbox stores the ID of each incoming message in the same transaction as the business data and skips the handler when that ID comes back, and the consumer outbox in MassTransit keeps an inbox of received messages for the same purpose.
- **Test and watch it.** Deliver every message twice in integration tests. In production, count the duplicates you skip: a sudden rise usually means a handler that has become slower than its visibility timeout or lock.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Transactional Outbox](../transactional-outbox/) — Save the event in the same database transaction as the data, then relay it: no dual-write gap.
- [Dead-Letter Queue](../dead-letter-queue/) — Park messages that keep failing so they stop blocking the queue and can be inspected.
- [Retry with Backoff & Jitter](../retry-with-backoff/) — Retry transient failures with growing, randomised delays so clients don't stampede.
- [Saga (Orchestration)](../saga-orchestration/) — A coordinator runs local transactions in sequence and triggers compensations when one fails.
- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.
- [Competing Consumers](../competing-consumers/) — Several workers pull from one queue, so work is shared and throughput scales out.
- [Event Sourcing](../event-sourcing/) — Store every change as an immutable event and rebuild state by replaying them.
- [Serverless (Functions)](../serverless/) — Functions start per event, scale out automatically and scale to zero when idle.

## References

- [Enterprise Integration Patterns — Idempotent Receiver](https://www.enterpriseintegrationpatterns.com/patterns/messaging/IdempotentReceiver.html)
- [Chris Richardson — Pattern: Idempotent Consumer (microservices.io)](https://microservices.io/patterns/communication-style/idempotent-consumer.html)
- [Amazon Builders' Library — Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
- [Amazon SQS Developer Guide — Exactly-once processing in Amazon SQS (FIFO queues)](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-exactly-once-processing.html)
- [Microsoft Learn — Azure Service Bus duplicate message detection](https://learn.microsoft.com/en-us/azure/service-bus-messaging/duplicate-detection)
- [Google Cloud — Pub/Sub exactly-once delivery](https://docs.cloud.google.com/pubsub/docs/exactly-once-delivery)
- [Apache Kafka 4.3 documentation — Design: Message Delivery Semantics](https://kafka.apache.org/43/design/design/#message-delivery-semantics)
- [Stripe API reference — Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [IETF HTTPAPI WG — The Idempotency-Key HTTP Header Field (draft-ietf-httpapi-idempotency-key-header, an expired Internet-Draft)](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
- [PostgreSQL documentation — INSERT (ON CONFLICT clause)](https://www.postgresql.org/docs/current/sql-insert.html)
- [Powertools for AWS Lambda (Python) — Idempotency](https://docs.aws.amazon.com/powertools/python/latest/utilities/idempotency/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
