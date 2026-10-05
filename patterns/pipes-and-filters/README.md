<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [📨 Messaging & Integration](../../README.md#messaging--integration)

# Pipes and Filters

> Split processing into independent stages connected by channels.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Pipes and Filters" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/pipes-and-filters.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One big processing step** | A single **photo service** validates, resizes, watermarks, tags and publishes each upload in one function. Resizing is the slowest stage (5 photos a second per copy), so taking 20 a second means running 4 copies of the *whole* service just to get 4 resizers, though one copy of every other stage would do. A new watermark means redeploying all of it, and when tagging fails the retry starts from the top and resizes the photo again. |
| **2 · Split into filters** | Each stage becomes a **filter**: a small, separately deployed service with one job that reads from its input **pipe** (here a queue) and writes its result to its output pipe. Filters share nothing else, no memory, no database and no calls to each other, so the photo flows Validate → Resize → Watermark → Tag → Publish with one pipe between each pair, from the uploads (the *source*) to the catalogue and the CDN (the *sinks*). |
| **3 · Scale and change one stage** | With 20 photos a second arriving and one Resize doing 5, Resize's input pipe grows by 15 a second, so **Resize alone** scales out to 4 instances (4 × 5 = 20 a second) and the pipe stops growing; every other filter stays at one instance. A content-safety filter is **inserted** between Validate and Resize: Validate now writes to a new pipe and Safety writes into Resize's existing one, with no change to any other filter. The same Tag filter is **reused** in a second pipeline, for videos. |
| **4 · Failures and the price** | Watermark crashes while holding photo 7f3; the message was never acknowledged, so it reappears in its pipe and a restarted instance watermarks it again, without redoing the resize (**at-least-once** delivery, so filters must be [idempotent](../idempotent-consumer/)). Photo 9c1 fails at Publish on every try and is moved to a [dead-letter queue](../dead-letter-queue/) after 3, while a correlation ID in every message ties each photo's hops together ([distributed tracing](../distributed-tracing/)). The price: the data is serialised at every hop, there are more parts to run and watch, latency adds up over the hops, and no transaction spans the stages, so 9c1 was resized, watermarked and tagged but never published. |
<!-- END GENERATED: header -->

## The problem

An online shop receives product photos at 20 a second. Each photo has to be checked, resized into the sizes the site uses, watermarked, tagged and published to the product catalogue and the CDN. The first version is usually one service with one function that runs the five steps in turn.

That works until the steps start to pull in different directions:

- **The slowest step sets the pace.** Resizing is far heavier than the rest. It manages 5 photos a second, which caps each copy of the service, and every photo waits for it.
- **Everything scales together.** Four resizers means four copies of the whole service, including four copies of validation, watermarking, tagging and publishing, where one of each would have been enough.
- **Everything ships together.** A new watermark is a build, test and redeploy of the entire service, and a mistake in it can take every other step down with it.
- **Everything fails together.** When tagging throws an error, the retry starts from the top, so the expensive resize runs again.
- **Nothing can be reused.** A video pipeline that also needs tagging ends up with a copy of the tagging code.

## How it works

Split the processing into a chain of **filters** joined by **pipes**:

- A **filter** does one job. It takes an item from its input pipe, transforms it and writes the result to its output pipe. It doesn't know which filters come before or after it, only the format of what it reads and writes.
- A **pipe** carries items from one filter to the next and holds them in between, so neighbours can work at different speeds and don't have to be running at the same moment.
- A **source** feeds the first pipe (the uploads in the animation) and a **sink** receives what the last filter produces (the catalogue and the CDN).

Filters share nothing but pipes, so each one can be deployed, scaled, replaced or reused on its own, and you change the pipeline by rewiring pipes rather than by editing filters. In step 3 a content-safety filter goes in between Validate and Resize: Validate writes to a new pipe, Safety reads from it and writes into the pipe that Resize already reads, and no other filter notices.

### Where it comes from

In a Bell Labs memo dated 11 October 1964, Doug McIlroy asked for a way to connect programs the way you connect lengths of garden hose, screwing in another piece whenever the data needs different treatment. According to Dennis Ritchie's history of Unix, pipes were added to the system in 1972 at McIlroy's urging. With them came the habit of small tools that read standard input and write standard output, so that the shell can chain them: `cut -d, -f3 orders.csv | sort | uniq -c`.

*Pattern-Oriented Software Architecture, Volume 1* (Buschmann, Meunier, Rohnert, Sommerlad and Stal, 1996) catalogues Pipes and Filters as an architectural pattern for stream-processing systems, and supplies most of the vocabulary used here:

- **Push or pull.** In a push pipeline the upstream side hands each item on; in a pull pipeline the downstream side asks for the next item when it is ready.
- **Active or passive filters.** An active filter runs in its own process or thread and moves the data itself, pulling from its input and pushing to its output. A passive filter is called by a neighbour, which either pushes an item into it or pulls a result out of it.

*Enterprise Integration Patterns* (Gregor Hohpe and Bobby Woolf, 2003) applies the pattern to messaging. Its filters are message processors that receive on an inbound channel and publish to an outbound one, and its pipes are message channels. A queue between active filters, as in the animation, mixes push and pull: each filter pushes its output into a queue, and the next filter pulls from that queue at its own pace.

### How it relates to other patterns

- [Competing Consumers](../competing-consumers/) is how a single filter scales out, and [Queue-Based Load Leveling](../queue-based-load-leveling/) is what each pipe does for the filter behind it.
- [Medallion Architecture](../medallion-architecture/) is the same idea in a lakehouse: each layer is the output of a refining step, kept as tables you can query and replay rather than as messages in flight.
- [Event-Driven Architecture](../event-driven-architecture/) uses the same brokers, but an event fans out to every subscriber that cares and nobody owns the sequence. A pipeline is a deliberate chain in which each item has one next step.
- [Saga (Orchestration)](../saga-orchestration/) coordinates a business transaction across services and undoes completed steps when a later one fails. A pipeline transforms data and normally only moves forward.

## When to use it

- The work splits into independent steps that differ in cost, speed or resources: a CPU-heavy resize, a GPU for image tagging, a quick validation.
- Steps change at different rates, are owned by different teams, or are worth reusing in other pipelines.
- You expect to add, remove or reorder steps.
- A high-volume stream where a slow or failing step must not hold up the others, and processing in the background is acceptable.

Don't use it when:

- The steps are short, fast and tightly coupled. One function does them more simply, and every hop would add serialisation, latency and moving parts.
- The steps must succeed or fail together in one transaction.
- A caller is waiting for the result within the same request. A pipeline of queues is asynchronous.
- Every step needs so much shared context that passing it along costs more than the split saves.

## Trade-offs

- **More moving parts.** Six filters and five pipes to deploy, configure, secure and monitor, instead of one service.
- **Latency per item.** Each hop adds serialisation, a network round trip and time in a queue. A pipeline trades latency for throughput and isolation.
- **Serialisation and storage.** Every hop encodes the data and the broker stores it again. Large payloads multiply that cost unless you pass references.
- **Duplicates.** Redelivery after a crash means at-least-once processing, so every filter has to be idempotent.
- **No transaction across stages.** When a later stage fails, the earlier results already exist, and you need a plan for them.
- **Harder to follow.** One photo's story is spread over many services and logs. Correlation IDs and per-stage dashboards are part of the price.
- **Contracts between filters.** Each message format is an interface. Changing one takes versioning and a careful rollout, just like an API.

## Implementation notes

### Designing filters

- **One job.** If describing a filter takes the word *and*, consider two filters. Don't split too finely either: steps that are cheap, always change together or must scale together can share a filter. Azure calls grouping them the [Compute Resource Consolidation](https://learn.microsoft.com/en-us/azure/architecture/patterns/compute-resource-consolidation) pattern.
- **Stateless where possible.** Keep what a filter needs in the message, or in storage the message points to, and not in memory between messages. Then any instance can take any message, and a crashed instance loses only the item it was holding.
- **Explicit input and output contracts.** Give each pipe one documented message format with a version. A filter should pass on, unchanged, the fields it doesn't use, so a field added for a later filter doesn't break an earlier one.
- **Idempotent.** Assume every message can arrive twice, as 7f3 does in step 4. Name outputs deterministically (`7f3/800w.jpg`, not a random file name) so a repeat overwrites its own result, and record message IDs where a side effect can't simply happen again, such as an email or a payment. See [Idempotent Consumer](../idempotent-consumer/).

### What a pipe is in practice

| Pipe | Examples | Good for | Watch out for |
|---|---|---|---|
| In-process stream or channel | Unix pipes, Go channels, Java streams, Reactive Streams libraries | Cheap hops, no serialisation, built-in backpressure | Every filter lives and dies with one process |
| Queue | Amazon SQS, Azure Service Bus, Azure Queue Storage, RabbitMQ | Separate services; each message goes to one consumer and comes back if it isn't acknowledged | At-least-once delivery; usually no replay |
| Topic or log | Apache Kafka, Amazon Kinesis Data Streams, Azure Event Hubs, Google Cloud Pub/Sub | Durable streams that several pipelines can read and replay | Ordering and parallelism tied to partitions |

Frameworks build pipelines out of these parts:

- **[Kafka Streams](https://kafka.apache.org/43/streams/core-concepts/)** builds a *processor topology*: a graph of stream processors connected by streams, where source processors read from Kafka topics and sink processors write to them. The DSL provides common operations (map, filter, join, aggregations) and the Processor API takes custom processors. Processing is at-least-once by default (`processing.guarantee`). With `exactly_once_v2`, input offsets, state store updates and output topics are committed together, which covers what stays inside Kafka but not a call to an outside service.
- **[Apache Beam](https://beam.apache.org/documentation/programming-guide/)** describes a *pipeline* of *PTransforms* that read and write *PCollections*, and a runner such as Dataflow, Flink or Spark executes it. The pipes can be logical only: [Dataflow fuses](https://docs.cloud.google.com/dataflow/docs/pipeline-lifecycle) consecutive steps to avoid the cost of handing data between them, which can also reduce parallelism.
- **AWS Step Functions** runs an orchestrated pipeline: each state's output becomes the next state's input, up to [256 KiB](https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html) of it. [Standard workflows](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html) execute each step once and can run for up to a year; Express workflows are at-least-once and run for at most five minutes.
- **Serverless functions joined by queues** are a common cloud form, and the one in Azure's own image example: each filter is a function triggered by its input queue that writes to the next. When AWS Lambda reads from Amazon SQS, messages arrive in batches, so use [partial batch responses](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html) to report the failed messages instead of failing the whole batch and repeating the ones that succeeded. See [Serverless](../serverless/).

### Scaling each filter, backpressure and buffers

Scale each filter on its own signals: the depth of its input pipe and the age of the oldest message in it. Within one filter, several instances read the same pipe as [competing consumers](../competing-consumers/), and an autoscaler adds and removes them ([Autoscaling](../autoscaling/)). In the animation Resize needs 20 ÷ 5 = 4 instances and nothing else changes. Matching the arrival rate only stops a backlog from growing; to work one off, run above the arrival rate for a while.

A pipeline moves no faster than its slowest filter, and the pipes decide how that shows. An in-process pipe has a fixed buffer: a [Linux pipe](https://man7.org/linux/man-pages/man7/pipe.7.html) holds 16 pages by default (64 KiB with the usual 4 KiB pages), and a writer that fills it blocks until the reader catches up, so the whole chain slows to the pace of its slowest command. [Reactive Streams](https://www.reactive-streams.org/) standardise the same idea across threads, so the receiving side is never forced to buffer more than it can take. A broker queue is effectively unbounded, so a slow filter doesn't slow its producer; the backlog grows instead. That is [load leveling](../queue-based-load-leveling/), and it only moves load in time. Give each pipe limits (length, size or message age), alert on its depth and age, and decide in advance what happens when it is full: reject at the source, shed load, or scale the filter.

### Ordering

With one instance per filter and first-in, first-out pipes, items leave in the order they arrived. Once a filter has several instances, a quick item can overtake a slow one. If order matters only per key, such as all the photos of one product, keep each key's items in sequence. [Kafka](https://kafka.apache.org/43/getting-started/introduction/) writes records with the same key to the same partition and a consumer reads each partition in order, and an [Amazon SQS FIFO queue](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-key-terms.html) processes the messages of one message group one at a time, in order. Parallelism then comes from the number of keys or groups rather than from instances. [Competing Consumers](../competing-consumers/) covers the options in more detail.

### Large payloads: pass a reference

Don't push a 12 MB photo through every pipe. Store it once in object storage and put only its location and metadata in the message, which is the [Claim Check](../claim-check/) pattern and exactly what Azure's image-processing example does. Brokers and orchestrators push you this way anyway: an [Amazon SQS message](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html) can be at most 1 MiB (the Extended Client Library for Java and Python stores larger payloads in Amazon S3, up to 2 GB), and a Step Functions state passes at most 256 KiB. Each filter then writes its result as a new object and passes the new reference on.

### Errors, retries and poison messages

- **Transient errors** such as a timeout or a throttled API: retry inside the filter with [backoff and jitter](../retry-with-backoff/) before giving up on the message.
- **Crashes**: a message that was never acknowledged comes back on its own once its lease runs out (the visibility timeout in Amazon SQS, 30 seconds by default), and another instance processes it. That is what happens to 7f3 in step 4.
- **Poison messages**: a message that fails every time would otherwise come back forever. Brokers count deliveries and park the message in a [dead-letter queue](../dead-letter-queue/) after a limit: [`maxReceiveCount`](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html) in an SQS redrive policy, or [`MaxDeliveryCount`](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-dead-letter-queues) in Azure Service Bus (10 by default). Give each pipe its own dead-letter queue so you know which stage failed, alert on its depth, and plan how to redrive the messages once the cause is fixed.
- **Expected rejections are not errors.** A file that fails validation belongs on a channel for invalid input, with the reason attached (*Enterprise Integration Patterns* calls it an [Invalid Message Channel](https://www.enterpriseintegrationpatterns.com/patterns/messaging/InvalidMessageChannel.html)), not in a dead-letter queue that is there for bugs and outages.

### Observability

- **Per stage:** input pipe depth, age of the oldest message, processing rate, error rate, dead-letter depth and instance count. Depth and age show where the bottleneck is; comparing the rates in and out shows whether it is getting worse.
- **End to end:** put a correlation ID in every message, pass it on unchanged and log it in every filter, so one search shows a photo's whole journey. Better still, propagate a [W3C Trace Context](https://www.w3.org/TR/trace-context/) `traceparent` and record a span per filter; see [Distributed Tracing](../distributed-tracing/). Measure the time from upload to publish as well, because every stage can look healthy while the total is too slow.

### Partial completion and compensation

No transaction spans the filters. When a late filter fails for good, the earlier ones have already done their work: in step 4, photo 9c1 has resized and watermarked files and tags, but no catalogue entry. Decide for each pipeline what that means:

- **Leave it** when the leftovers are harmless, and clean them up later, for example with a storage lifecycle rule.
- **Finish it** by redriving the message once the cause is fixed. Idempotent filters make that safe.
- **Undo it** when an earlier step changed something that matters, such as stock or money, with a [compensating transaction](../compensating-transaction/). Azure's guidance suggests pairing Pipes and Filters with compensating transactions as an alternative to a distributed transaction. When the steps form a business transaction rather than a transformation, coordinate them as a [saga](../saga-orchestration/).

### Routing between filters

A fixed chain is the simplest pipeline. When the next step depends on the item, for example videos to Transcode and photos to Resize, put a [content-based router](https://www.enterpriseintegrationpatterns.com/patterns/messaging/ContentBasedRouter.html) between the filters: it reads each message and sends it to the right pipe. When each item needs its own list of steps, a [routing slip](https://www.enterpriseintegrationpatterns.com/patterns/messaging/RoutingTable.html) attached to the message names them in order, and the router at each step forwards the message to the next one on the list. Keep these decisions in routers or in the message rather than inside the filters, so the filters stay reusable.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Competing Consumers](../competing-consumers/) — Several workers pull from one queue, so work is shared and throughput scales out.
- [Queue-Based Load Leveling](../queue-based-load-leveling/) — A queue absorbs traffic spikes so the backend can work at a steady pace.
- [Claim Check](../claim-check/) — Put the large payload in storage and send only a reference through the broker.
- [Medallion Architecture](../medallion-architecture/) — Bronze, silver, gold: raw data is refined in layers inside a lakehouse.
- [Dead-Letter Queue](../dead-letter-queue/) — Park messages that keep failing so they stop blocking the queue and can be inspected.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.
- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.
- [Saga (Orchestration)](../saga-orchestration/) — A coordinator runs local transactions in sequence and triggers compensations when one fails.

## References

- [Azure Architecture Center — Pipes and Filters pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/pipes-and-filters)
- [Enterprise Integration Patterns — Pipes and Filters](https://www.enterpriseintegrationpatterns.com/patterns/messaging/PipesAndFilters.html)
- [Doug McIlroy — 1964 Bell Labs memo on coupling programs, retyped by Dennis Ritchie (Prophetic Petroglyphs)](https://www.nokia.com/bell-labs/about/dennis-m-ritchie/mdmpipe.html)
- [Dennis M. Ritchie — The Evolution of the Unix Time-sharing System](https://www.nokia.com/bell-labs/about/dennis-m-ritchie/hist.html)
- [Apache Kafka — Kafka Streams core concepts](https://kafka.apache.org/43/streams/core-concepts/)
- [Apache Beam — Programming guide](https://beam.apache.org/documentation/programming-guide/)
- [Enterprise Integration Patterns — Content-Based Router](https://www.enterpriseintegrationpatterns.com/patterns/messaging/ContentBasedRouter.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
