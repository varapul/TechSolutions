<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧱 System Components](../../README.md#system-components)

# Apache Flink

> A stream processor: stateful operators over unbounded streams, with event time, windows and exactly-once checkpoints.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Apache Flink" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/flink.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Acme Shop's fraud check is a Flink job between the Kafka topic **orders** and the systems that act on it. It reads every order as it arrives, keeps state about what it has seen (a count per card for each 10-minute window), writes an alert to the topic **fraud-alerts** when a card places more than 5 orders in a window, and emits orders per minute per country for a live dashboard. The job runs with parallelism 3 on a Flink cluster, here on Kubernetes, and keeps running for months; on AWS, Amazon Managed Service for Apache Flink runs it for you. |
| **2 · Dataflow and keyed state** | Each source subtask reads one partition of **orders**, and `keyBy(card)` hashes card C-9 to key group 126 of 128, which belongs to count subtask 3/3, so all of C-9's orders meet there whichever partition they came in on. Its keyed state holds C-9's count for the window [10:00, 10:10): the sixth order, made at 10:07, takes the count past 5 and an alert goes to **fraud-alerts**. That state lives with the computation, in RocksDB on the TaskManager's local disk, not in an external database. |
| **3 · Event time and watermarks** | Orders arrive out of order: C-9's order made at 10:03 came in after the one made at 10:04, and it still counts, because Flink measures time by the events' own timestamps. The **watermark**, the largest event time seen minus 5 s, tells each window when it may close: once orders stamped 10:10:05 have come in on all three partitions, it reaches 10:10, and every [10:00, 10:10) window closes and its state is cleared. An order stamped 10:08:40 that arrives after that is later than the allowed lateness (0 by default), so it goes to the side output **late-orders** instead of being silently dropped. |
| **4 · Checkpoints and the limits** | Every 30 s the JobManager starts a checkpoint: barriers flow from the sources through the job, and each operator snapshots its state to S3 together with the Kafka offsets it has read. When TaskManager 2 is lost, the job restarts from the last completed checkpoint (812) and the sources rewind to its offsets, so every order affects the state exactly once; the Kafka sink commits its transactions when each checkpoint completes, so readers that use `read_committed` see each alert exactly once too. The limits: big state makes checkpoints and restarts slow, backpressure shows up as lag, upgrading a running job needs a savepoint and compatible state, and for stateless or small jobs Kafka Streams or a Lambda function reading the stream is simpler. |
<!-- END GENERATED: header -->

## The problem

Acme Shop wants to catch card fraud while it happens. When one card places more than 5 orders within 10 minutes, the fraud team wants an alert within seconds, and the operations team wants a live view of orders per minute per country. The orders already flow through the Kafka topic `orders`, which has 3 partitions (see [Apache Kafka](../kafka/)).

A consumer service that counts in memory runs into four problems:

- **The counts are state.** They have to survive restarts and deploys, and once one machine is not enough, every order of a card has to reach the instance that holds that card's count.
- **Orders arrive late and out of order.** Phones lose signal, clients retry and three partitions are read in parallel, so "the last 10 minutes" measured by the clock when an order arrives counts the wrong orders.
- **Crashes must not change the result.** After a restart the service must neither skip orders nor count them twice.
- **A database per event is slow and still not exact.** Writing every count to an external store adds a network round trip per order, and the write and the input position can still get out of step in a crash.

Apache Flink runs stateful computations over streams that never end (and over bounded ones) on a cluster of machines. It keeps the state next to the computation, partitioned by key, measures time by the timestamps the events carry, and takes consistent snapshots of all state together with the positions in the input, so a failure costs a replay from the last snapshot instead of a wrong count.

## How it works

### Dataflow: sources, operators, sinks and parallelism

A Flink program describes a **dataflow graph**: sources read records, operators transform them (map, filter, `keyBy`, windows, process functions, joins) and sinks write the results out. Flink runs each operator as several parallel **subtasks**. The fraud check runs with parallelism 3, so it has three source subtasks, three count subtasks and three sink subtasks. Between two operators, records either stay in the same subtask (a *forward* connection, which Flink can chain into a single task on one thread) or are redistributed: `keyBy` sends each record to the subtask that owns its key, `rebalance` spreads records round-robin.

The Kafka source spreads the partitions over its subtasks, so with 3 partitions and parallelism 3 each source subtask reads exactly one partition. Kafka partitions the orders by customer, but the fraud check needs them grouped by card, so the job calls `keyBy(card)`: every source subtask may send to every count subtask, and all orders of one card end up in the same one, whichever partition they came from.

### Keyed state and key groups

`keyBy` doesn't map keys straight to subtasks. Flink hashes each key into one of a fixed number of **key groups**, as many as the job's **maximum parallelism** (by default about 1.5 times the parallelism, but at least 128, so 128 for this job), and gives each subtask a contiguous range of them: 0–42, 43–85 and 86–127 here. The numbers in the animation are real: run the string key `C-9` through Flink's key-group assignment and it lands in key group 126, so count subtask 3/3 holds C-9's count.

Key groups are the unit in which keyed state moves when a job is rescaled. With parallelism 4, the same 128 key groups are split four ways and each subtask loads its new ranges from the last snapshot. That is also why the maximum parallelism can't be changed later without discarding the keyed state, and why the production readiness checklist says to set it explicitly.

**Keyed state** is scoped to the current key: inside the count operator, a `ValueState`, `ListState`, `MapState`, `ReducingState` or `AggregatingState` always refers to the card being processed. **Operator state** belongs to a subtask instead (the Kafka source keeps its partitions' offsets that way), and **broadcast state** is the same on every subtask, for example a set of rules sent to all of them. State that would otherwise grow forever, such as counts for cards that have gone quiet, can expire through a time-to-live (`StateTtlConfig`).

### State backends

The **state backend** decides where the working state lives (`state.backend.type`):

- **`hashmap`** (`HashMapStateBackend`, the default) keeps state as Java objects on the TaskManager's heap. Access is fast, but the state has to fit in memory.
- **`rocksdb`** (`EmbeddedRocksDBStateBackend`) keeps serialized state in an embedded RocksDB database on the TaskManager's local disk. State can be much larger than memory, at the cost of serializing on every access, and checkpoints can be incremental: only the files that changed since the last one are uploaded. The fraud check uses it.
- **`forst`** (`ForStStateBackend`, part of the *disaggregated state management* that arrived in Flink 2.0) keeps state in remote storage such as S3, uses the local disk as a cache and reads and writes asynchronously through the new State V2 API, so recovery and rescaling don't have to download the state first. As of Flink 2.3 the documentation still calls it experimental.

With the first two, reading a count is a heap or disk lookup on the same machine, not a call to a database.

### Event time, watermarks and windows

Flink can measure time in two ways. **Processing time** is the clock of the machine running the operator: simple, but the result depends on when records happen to arrive. **Event time** is the timestamp each record carries, here the moment the order was placed, so the result is the same whether the orders arrive live, late or replayed from last week.

With event time, an operator needs to know when it has seen everything up to some moment. That is the **watermark**, a special record that flows with the data and announces that no events older than a given time are expected any more. The `WatermarkStrategy` on the source decides how it advances. With `forBoundedOutOfOrderness(Duration.ofSeconds(5))` the watermark trails the largest timestamp seen so far by 5 s (5 s and 1 ms, to be exact), and Flink emits it periodically, every 200 ms by default (`pipeline.auto-watermark-interval`). The Kafka source tracks watermarks per partition and merges them, and an operator with several inputs takes the smallest of their watermarks, so one slow or idle partition holds back the event-time clock of the whole job. `withIdleness(...)` lets a partition that has gone quiet stop holding it back, and watermark alignment pauses partitions that run too far ahead of the others.

A **window** gathers the records of a key over a span of event time and is evaluated when the watermark passes its end. The built-in window assigners cover **tumbling** windows (fixed size, no overlap, like the 10-minute windows here), **sliding** windows (fixed size, overlapping, such as 10 minutes every minute), **session** windows (closed by a gap of inactivity) and global windows. A record whose window has already been evaluated is **late**. Late records are dropped by default; `allowedLateness(...)` keeps a window's state a little longer so that stragglers still update it (it is 0 unless you set it), and `sideOutputLateData(...)` sends anything later than that to a separate stream, a **side output**, where you can count or reconcile it instead of losing it silently.

In the animation the window `[10:00, 10:10)` closes once orders stamped 10:10:05 have come in on all three partitions, which moves the watermark to 10:09:59.999, the window's last millisecond; the order stamped 10:08:40 that arrives afterwards goes to `late-orders`.

### The fraud check in code

A window operator reports a result when its window ends. To alert at the sixth order instead of at 10:10, the count is written as a `KeyedProcessFunction`, the low-level building block that combines keyed state with timers (a window with a custom trigger would also work). It compiles and runs against Flink 2.3:

```java
class MoreThanFivePerTenMinutes extends KeyedProcessFunction<String, Order, Alert> {
    static final OutputTag<Order> LATE = new OutputTag<Order>("late-orders") {};
    static final long WINDOW = Duration.ofMinutes(10).toMillis();
    private transient MapState<Long, Integer> countPerWindow; // window end -> orders so far

    @Override
    public void open(OpenContext openContext) {
        countPerWindow = getRuntimeContext().getMapState(
                new MapStateDescriptor<>("count-per-window", Long.class, Integer.class));
    }

    @Override
    public void processElement(Order order, Context ctx, Collector<Alert> out) throws Exception {
        long end = order.placedAt() - order.placedAt() % WINDOW + WINDOW; // [10:00, 10:10) -> 10:10
        if (end - 1 <= ctx.timerService().currentWatermark()) { // its window has closed
            ctx.output(LATE, order);
            return;
        }
        Integer seen = countPerWindow.get(end);
        int count = (seen == null ? 0 : seen) + 1;
        countPerWindow.put(end, count);
        ctx.timerService().registerEventTimeTimer(end - 1); // fires once the watermark reaches the end
        if (count == 6) {
            out.collect(new Alert(ctx.getCurrentKey(), end, count));
        }
    }

    @Override
    public void onTimer(long timestamp, OnTimerContext ctx, Collector<Alert> out) throws Exception {
        countPerWindow.remove(timestamp + 1); // the window is over: free its state
    }
}
```

The job around it reads `orders` with a 5-second watermark, keys by card and writes the two outputs:

```java
WatermarkStrategy<Order> fiveSecondsLate = WatermarkStrategy
        .<Order>forBoundedOutOfOrderness(Duration.ofSeconds(5))
        .withTimestampAssigner((order, kafkaTimestamp) -> order.placedAt());

SingleOutputStreamOperator<Alert> alerts = env
        .fromSource(orders, fiveSecondsLate, "orders") // orders is a KafkaSource on topic orders
        .keyBy(Order::card)
        .process(new MoreThanFivePerTenMinutes())
        .uid("fraud-count"); // a stable ID that savepoints map the state to

alerts.sinkTo(fraudAlerts); // the KafkaSink below
alerts.getSideOutput(MoreThanFivePerTenMinutes.LATE).sinkTo(lateOrders);
```

In a local test with the animation's orders, fed in arrival order with a watermark after every order so the result is deterministic, it emits one alert for C-9 (6 orders in `[10:00, 10:10)`) and sends the order stamped 10:08:40 to the side output.

### Checkpoints: consistent snapshots without stopping

Flink's fault tolerance rests on **checkpoints**: consistent snapshots of every operator's state together with the input positions they belong to. Flink takes them with **checkpoint barriers**, a variant of the Chandy–Lamport distributed snapshot algorithm described by Carbone and others in 2015:

1. The checkpoint coordinator in the JobManager tells the sources to start checkpoint *n*, every 30 s here (`execution.checkpointing.interval`).
2. Each source records its position (for Kafka, the offset in each partition) and emits barrier *n* into its output streams. A barrier travels in line with the records and never overtakes them, so it splits the stream into the part before checkpoint *n* and the part after it.
3. An operator with several inputs waits until barrier *n* has arrived on all of them (**alignment**), then snapshots its state and forwards the barrier. The copy is written to storage asynchronously while the operator goes on processing.
4. When every sink has acknowledged barrier *n* and all snapshots are stored (in `execution.checkpointing.dir`, on S3 here), checkpoint *n* is complete.

Checkpointing is off until you set an interval, and its default mode is exactly-once (`execution.checkpointing.mode: EXACTLY_ONCE`). Under backpressure, alignment can hold a checkpoint up for a long time; **unaligned checkpoints** (since Flink 1.11, `execution.checkpointing.unaligned.enabled`) let barriers overtake the records waiting in buffers and store those records as part of the snapshot instead.

The fraud check's state backend and checkpoints, in `config.yaml`:

```yaml
# config.yaml (Flink 2.x)
parallelism.default: 3
state.backend.type: rocksdb
execution.checkpointing.incremental: true
execution.checkpointing.interval: 30 s
execution.checkpointing.dir: s3://acme-shop-flink/checkpoints/fraud-check
execution.checkpointing.savepoint-dir: s3://acme-shop-flink/savepoints/fraud-check
```

**Recovery.** When a task fails or a TaskManager is lost, the JobManager restarts the affected tasks; once checkpointing is on, the default restart strategy is `exponential-delay`, with waits starting at 1 s and capped at 1 minute. Flink restarts the smallest *pipelined region* that contains the failure, and because `keyBy` connects every source subtask to every count subtask, that region is the whole job here. Every operator reloads its state from the last completed checkpoint and the sources rewind to the offsets stored in it, so each order changes the state exactly once even though some orders are read twice. The Kafka source also commits its offsets to Kafka when a checkpoint completes, but only so that progress and lag show up in Kafka's tools: Flink restores from its own checkpoint, not from those commits.

### Savepoints

A **savepoint** is a snapshot that you trigger and own. You take one before an upgrade, a Flink version change, a rescale or a move to another cluster, and start the new job from it. Flink manages checkpoints itself and by default keeps only the latest completed one (`execution.checkpointing.num-retained: 1`); a savepoint stays until you delete it, and you can move it to another location.

```sh
bin/flink stop --savepointPath s3://acme-shop-flink/savepoints/fraud-check <jobId>  # take a savepoint, then stop
bin/flink run -s <savepointPath> fraud-check.jar                                     # start the new version from it
```

Restoring maps the saved state back to operators by their IDs, so give every stateful operator a stable `uid(...)`; renaming an operator's ID or changing its state's type in an incompatible way breaks the restore. Savepoints use a *canonical* format that works across state backends by default, or the backend's faster *native* format (`--type native`). Flink 2.x doesn't guarantee state compatibility with 1.x, so moving from 1.20 to 2.x is a migration, not just a restart from a savepoint.

### Exactly once, end to end

Checkpoints make the **state** exactly-once. Results already written to the outside world are another matter: after a restart Flink processes the orders since the last checkpoint again, and a plain sink would write those alerts twice. End-to-end exactly-once needs a source that can replay (Kafka, Kinesis, files) and a sink that takes part in the checkpoint:

- A **transactional sink** uses two-phase commit (in Flink 2.x a sink that implements `SupportsCommitter`): between checkpoints it writes into an open transaction, pre-commits when the barrier passes and commits only after the checkpoint completes. The Kafka sink does this with Kafka transactions in `DeliveryGuarantee.EXACTLY_ONCE` mode. Readers of `fraud-alerts` must set `isolation.level=read_committed` to skip uncommitted records, and an alert becomes visible only when the checkpoint after it completes, so up to about 30 s later here.
- An **idempotent sink** makes the replay harmless instead: an upsert by key into a database or a search index writes the same row again with the same result.

```java
KafkaSink<Alert> fraudAlerts = KafkaSink.<Alert>builder()
        .setBootstrapServers("kafka:9092")
        .setRecordSerializer(KafkaRecordSerializationSchema.builder()
                .setTopic("fraud-alerts")
                .setValueSerializationSchema(alertJson)
                .build())
        .setDeliveryGuarantee(DeliveryGuarantee.EXACTLY_ONCE) // the default is NONE
        .setTransactionalIdPrefix("fraud-check")             // unique per job on this Kafka cluster
        .build();
```

The DataStream Kafka sink defaults to `DeliveryGuarantee.NONE` and the SQL Kafka connector to `'sink.delivery-guarantee' = 'at-least-once'`. With exactly-once, set the producer's `transaction.timeout.ms` well above the longest checkpoint plus the restart time, or Kafka may abort a transaction that Flink still means to commit.

### JobManager, TaskManagers and slots

A Flink cluster runs two kinds of processes:

- The **JobManager** coordinates. Its *Dispatcher* accepts jobs over REST and serves the web UI, its *ResourceManager* hands out task slots, and one *JobMaster* per job schedules the tasks, coordinates the checkpoints and reacts to failures. For high availability, standby JobManagers wait to take over from the leader (see [Leader Election](../leader-election/)).
- **TaskManagers** are the worker JVMs that run the subtasks and exchange data between them. Each offers a number of **task slots** (`taskmanager.numberOfTaskSlots`, 1 by default). A slot reserves a share of the TaskManager's managed memory but doesn't isolate CPU. Subtasks of different operators of the same job may share a slot, so one slot can hold a whole pipeline (source, count and sink, as in each lane of the animation), and a job needs as many slots as its highest parallelism.

Jobs run in **application mode**, on a cluster of their own where the program's `main()` runs, or in **session mode**, on a long-running cluster shared by several jobs; the per-job mode is no longer supported since Flink 2.0. On Kubernetes, Flink's native integration starts and stops its own TaskManager pods, and the **Flink Kubernetes Operator** (1.16, September 2026) manages jobs as custom resources (`FlinkDeployment`, `FlinkSessionJob`): it upgrades them with `upgradeMode: savepoint`, `last-state` or `stateless`, rolls back failed upgrades, autoscales the parallelism and can run blue/green deployments.

### APIs, connectors and batch

- The **DataStream API** (Java, and Python through PyFlink) gives full control over keyed state, timers, side outputs and custom windows; process functions are its lowest level.
- The **Table API** and **Flink SQL** describe the same kinds of computations declaratively, and the planner turns them into a dataflow. The dashboard's per-minute counts take a few lines of SQL, where the `WATERMARK` clause plays the part of the `WatermarkStrategy`:

```sql
CREATE TABLE orders (
  order_id  STRING,
  card      STRING,
  country   STRING,
  placed_at TIMESTAMP_LTZ(3),
  WATERMARK FOR placed_at AS placed_at - INTERVAL '5' SECOND
) WITH (
  'connector' = 'kafka',
  'topic' = 'orders',
  'properties.bootstrap.servers' = 'kafka:9092',
  'properties.group.id' = 'order-stats',
  'scan.startup.mode' = 'earliest-offset',
  'format' = 'json'
);

SELECT window_start, country, COUNT(*) AS orders
FROM TUMBLE(TABLE orders, DESCRIPTOR(placed_at), INTERVAL '1' MINUTES)
GROUP BY window_start, window_end, country;
```

- **Connectors** for files and object storage ship with Flink; most others (Kafka, the AWS connectors for Kinesis and other services, JDBC databases, [Elasticsearch](../elasticsearch/) and many more) are released separately and often trail Flink's releases. In October 2026 the newest Kafka connector (5.0.0) supports Flink 2.1 and 2.2, and the Flink 2.3 documentation lists no Kafka connector release for 2.3 yet; the newest AWS connectors (6.0.1) target 2.0, and the [MongoDB](../mongodb/) and Pulsar connectors still target 1.x.
- **Flink CDC** (3.6 as of October 2026) builds data integration pipelines described in YAML: it reads a database's existing rows and then its change log (MySQL's binlog, for example) without locking tables, applies schema changes downstream and keeps exactly-once processing across failures.
- **Batch is a bounded stream.** The same DataStream program runs in batch mode on bounded input (`execution.runtime-mode: BATCH`), and SQL runs either way. Flink 2.0 removed the old DataSet API, together with the Scala APIs and the legacy `SourceFunction` and `SinkFunction` interfaces.

### Versions

Flink 2.0 (March 2025) was the first major release since 1.0 in 2016. Besides disaggregated state, it removed the deprecated APIs above, made Java 17 the default (Java 11 is the minimum, Java 21 is supported), replaced `flink-conf.yaml` with a standard YAML `config.yaml` and dropped state compatibility with 1.x. Flink 2.1 (July 2025), 2.2 (December 2025) and 2.3 (June 2026) followed; 2.3.0 is the latest stable release in October 2026. The 1.x line ends with Flink 1.20, which the project labels long-term support and still patches (1.20.5, June 2026).

## Where it fits

- **Solutions.** Fraud and anomaly detection on payments, logins or sensor readings; real-time analytics and live dashboards; streaming ETL that cleans, joins and enriches events on their way into a data lake or warehouse, for example as Apache Paimon or Apache Iceberg tables; change data capture pipelines with Flink CDC; event-driven applications that react to patterns over time (a payment that didn't follow an order within 15 minutes) with state and timers.
- **Patterns it implements or supports.** The stateful consumer in an [event-driven architecture](../event-driven-architecture/); [pipes and filters](../pipes-and-filters/) at cluster scale, each operator a filter; [change data capture](../change-data-capture/) with Flink CDC; [materialized views](../materialized-view/) and [CQRS](../cqrs/) read models kept up to date from a stream; the idea behind the [sliding window](../sliding-window/) technique, updating a running result as items arrive instead of rescanning them, in its incremental window aggregations (`ReduceFunction`, `AggregateFunction`); an [idempotent consumer](../idempotent-consumer/) downstream when a sink can't take part in transactions.
- **Usual neighbours.** [Apache Kafka](../kafka/) or [Amazon Kinesis Data Streams](../amazon-kinesis-data-streams/) in front; Kafka topics, databases, search indexes and object storage behind; [Amazon S3](../amazon-s3/) or HDFS for checkpoints and savepoints; [Kubernetes](../kubernetes/) or YARN to run it; a schema registry for the record formats; metrics in a system such as [Prometheus](../prometheus/).
- **Managed offerings.** **Amazon Managed Service for Apache Flink** (called Amazon Kinesis Data Analytics until August 2023) runs Flink applications written in Java, Scala or Python, and its Studio notebooks run SQL, Python and Scala interactively. In October 2026 it supports Flink 2.3, 2.2, 1.20, 1.19, 1.18 and 1.15. Capacity comes in Kinesis Processing Units (KPUs) of 1 vCPU and 4 GB of memory with 50 GB of running storage each, plus one extra KPU per application for orchestration, billed per second in most Regions (the pricing example uses $0.11 per KPU-hour in US East (N. Virginia)). Checkpoints are on by default every 60 s. Its *snapshots* are savepoints: you can take them yourself, and with `SnapshotsEnabled` the service takes one whenever the application is updated, scaled or stopped. **Confluent Cloud for Apache Flink** is a serverless service on AWS, Azure and Google Cloud for Flink SQL, the Table API (Java generally available, Python in preview) and user-defined functions over Confluent's Kafka topics; it bills compute pools by the CFUs used per minute, and its statements are exactly-once by default. To run Flink yourself on Kubernetes, use the Flink Kubernetes Operator.
- **Licence.** Apache Flink, Flink CDC and the Kubernetes Operator are Apache Software Foundation projects under the Apache License 2.0.

## When to use it

Choose Flink when a streaming job keeps real state (counts, sessions, joins, patterns over time), when results must be right by event time despite late and out-of-order data, when they must be exactly-once after failures, and when the job reads from or writes to several kinds of systems, at a scale where one process is not enough. For a service that reads Kafka topics and writes Kafka topics and that you'd rather deploy as part of your application, Kafka Streams is simpler. If your team already runs Spark and latency in seconds is fine, Spark Structured Streaming keeps one engine for batch and streaming. For stateless work on each record (enrich, route, call an API) or a small aggregate per shard, a [Lambda function](../aws-lambda/) reading the stream needs no cluster at all.

| | Apache Flink | Kafka Streams | Spark Structured Streaming | AWS Lambda on a stream |
|---|---|---|---|---|
| What you deploy | A Flink cluster (a JobManager and TaskManagers) running the job | A Java library inside your own service; each instance processes some of the partitions | A Spark application (a driver and executors) | A function; an event source mapping polls the stream and invokes it with batches |
| Inputs and outputs | Kafka, Kinesis, files, JDBC, Elasticsearch and more through connectors; databases through Flink CDC | Kafka topics in and out | Kafka and files built in; sinks include files, Kafka and `foreachBatch` | Kinesis, [DynamoDB](../amazon-dynamodb/) Streams, Kafka (Amazon MSK or self-managed), [SQS](../amazon-sqs/) and others in; whatever your code calls out |
| Processing | One record at a time, by event time with watermarks | One record at a time, by event time with a grace period for late records | Micro-batches by default; an optional continuous mode gives lower latency with at-least-once delivery | One batch of records per invocation |
| State | Keyed state on the heap or in local RocksDB, snapshotted to S3 or HDFS | Local RocksDB stores backed by compacted changelog topics | A state store in executor memory, or RocksDB, saved to the checkpoint location | None between invocations, except tumbling windows (Kinesis and DynamoDB Streams only, up to 15 minutes, 1 MB of state per shard) |
| Guarantee | Exactly-once state; end to end with transactional or idempotent sinks | At-least-once by default; `exactly_once_v2` from Kafka to Kafka | End-to-end exactly-once with replayable sources and idempotent sinks | At least once: make the function idempotent |
| Who runs it | You (Kubernetes, YARN or standalone), Amazon Managed Service for Apache Flink, Confluent Cloud | You, as part of your services | You, or a managed Spark platform such as Amazon EMR | AWS |

Figures from the Flink 2.3, Kafka 4.3, Spark 4.2 and AWS Lambda documentation, October 2026.

## Trade-offs

- **A distributed system to run.** A production setup means JobManager high availability, TaskManagers, durable checkpoint storage, upgrades and capacity planning. A managed service takes over the machines, not the design: keys, state size, watermarks and upgrade compatibility stay yours.
- **State size sets the recovery time.** Checkpoints upload state and restores download it, so a job with large state checkpoints slowly and takes long to restart or rescale. Incremental checkpoints help with the first; disaggregated state (still experimental in 2.3) aims at the second.
- **Backpressure becomes lag.** A slow sink, an overloaded subtask or a hot key slows its upstream operators until the sources read more slowly than Kafka fills up, and the consumer lag grows. Aligned checkpoints slow down too, which is what unaligned checkpoints address.
- **Upgrades are state migrations.** A new version of the job has to read the old version's state: stable operator IDs, compatible state types and a savepoint for every change, and a real migration from 1.x to 2.x.
- **Latency against completeness.** A larger watermark bound lets more late events count but delays every result by as much; allowed lateness keeps window state around longer. Exactly-once output delays visibility until the next checkpoint.
- **Connectors trail releases.** Upgrading Flink can wait on the connectors you use, as with the Kafka connector for 2.3 in October 2026.

## Implementation notes

- **Give every stateful operator a `uid(...)` and set the maximum parallelism explicitly** (`setMaxParallelism(...)` or `pipeline.max-parallelism`) before the first deployment; neither can change later without losing state.
- **Pick the state backend for the state size:** `hashmap` for small state, `rocksdb` with `execution.checkpointing.incremental: true` for large state. ForSt is still experimental in Flink 2.3.
- **Put checkpoints on durable storage.** `s3://` paths need one of Flink's S3 file system plugins (`flink-s3-fs-presto` or `flink-s3-fs-hadoop` in `plugins/`, or the native implementation that is experimental in 2.3).
- **Assign watermarks at the source,** so the Kafka source tracks them per partition; add `withIdleness(...)` if partitions can go quiet, choose the bound from the lateness you actually measure, and send late data to a side output so you can see how much there is.
- **Expire keyed state** with `StateTtlConfig` when keys are unbounded (cards, sessions, devices), or the state only grows.
- **Size checkpoints to the job.** Watch checkpoint duration and size; keep the interval well above the duration, and know the defaults: a checkpoint times out after 10 minutes (`execution.checkpointing.timeout`), and with `execution.checkpointing.tolerable-failed-checkpoints: 0` a checkpoint that fails or times out makes the job fail over and restart. Enable unaligned checkpoints if backpressure stalls them.
- **Watch backpressure and lag.** The web UI rates each subtask from `backPressuredTimeMsPerSecond` (OK up to 10 %, LOW up to 50 %, HIGH above), and the Kafka source reports `pendingRecords` and `watermarkLag`.
- **For exactly-once to Kafka,** use a unique `transactionalIdPrefix` per job, raise `transaction.timeout.ms` above the checkpoint duration plus the restart time, and make every reader of the output topic use `read_committed`.
- **Upgrade through savepoints:** `bin/flink stop --savepointPath ...`, then start the new version with `-s`; with the Kubernetes Operator, `upgradeMode: savepoint` does both steps.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Apache Kafka](../kafka/) — A partitioned, replicated commit log: producers append events, consumer groups read at their own pace and can replay history.
- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.
- [Change Data Capture (CDC)](../change-data-capture/) — Stream every committed change from the database log to other systems.
- [Materialized View](../materialized-view/) — Precompute query-shaped views so reads don't pay for joins and aggregations.
- [Amazon Kinesis Data Streams](../amazon-kinesis-data-streams/) — Managed streaming: records go to shards by partition key, and consumers read each shard in order and can replay it.
- [Pipes and Filters](../pipes-and-filters/) — Split processing into independent stages connected by channels.
- [Sliding Window](../sliding-window/) — Slide a window along a sequence, adding the item that enters and dropping the one that leaves, instead of re-scanning each window.
- [CQRS](../cqrs/) — Separate the write model (commands) from read models (queries), each optimised for its job.

## References

- [Apache Flink 2.3 documentation — Stateful Stream Processing](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/concepts/stateful-stream-processing/)
- [Apache Flink 2.3 documentation — Timely Stream Processing](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/concepts/time/)
- [Apache Flink 2.3 documentation — Flink Architecture](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/concepts/flink-architecture/)
- [Apache Flink 2.3 documentation — Generating Watermarks](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/dev/datastream/event-time/generating_watermarks/)
- [Apache Flink 2.3 documentation — Windows](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/dev/datastream/operators/windows/)
- [Apache Flink 2.3 documentation — Event-driven Applications (process functions, timers, side outputs)](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/learn-flink/event_driven/)
- [Apache Flink 2.3 documentation — Checkpointing](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/dev/datastream/fault-tolerance/checkpointing/)
- [Apache Flink 2.3 documentation — State Backends](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/ops/state/state_backends/)
- [Apache Flink 2.3 documentation — Disaggregated State Management](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/ops/state/disaggregated_state/)
- [Apache Flink 2.3 documentation — Savepoints](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/ops/state/savepoints/)
- [Apache Flink 2.3 documentation — Task Failure Recovery](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/ops/state/task_failure_recovery/)
- [Apache Flink 2.3 documentation — Production Readiness Checklist](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/ops/production_ready/)
- [Apache Flink 2.3 documentation — Kafka connector](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/connectors/datastream/kafka/)
- [Apache Flink 2.3 documentation — Window Aggregation (Flink SQL)](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/sql/reference/queries/window-agg/)
- [Apache Flink 2.3 documentation — Configuration](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/deployment/config/)
- [Apache Flink 2.0.0: A new Era of Real-Time Data Processing (March 2025)](https://flink.apache.org/2025/03/24/apache-flink-2.0.0-a-new-era-of-real-time-data-processing/)
- [Apache Flink 2.3.0 Release Announcement (June 2026)](https://flink.apache.org/2026/06/25/apache-flink-2.3.0-release-announcement/)
- [Apache Flink — Downloads (releases and connector compatibility)](https://flink.apache.org/downloads/)
- [Apache Flink Kubernetes Operator 1.16 documentation — Job Management](https://nightlies.apache.org/flink/flink-kubernetes-operator-docs-release-1.16/docs/managing/job-management/)
- [Apache Flink CDC 3.6 documentation](https://nightlies.apache.org/flink/flink-cdc-docs-release-3.6/)
- [Carbone, Fóra, Ewen, Haridi, Tzoumas — Lightweight Asynchronous Snapshots for Distributed Dataflows (2015)](https://arxiv.org/abs/1506.08603)
- [Chandy and Lamport — Distributed Snapshots: Determining Global States of a Distributed System (ACM TOCS, 1985)](https://lamport.azurewebsites.net/pubs/chandy.pdf)
- [Amazon Managed Service for Apache Flink — What is Amazon Managed Service for Apache Flink?](https://docs.aws.amazon.com/managed-flink/latest/java/what-is.html)
- [Amazon Managed Service for Apache Flink — Supported and deprecated Apache Flink versions](https://docs.aws.amazon.com/managed-flink/latest/java/release-version-list.html)
- [Amazon Managed Service for Apache Flink — Per second billing](https://docs.aws.amazon.com/managed-flink/latest/java/how-pricing.html)
- [Confluent Cloud for Apache Flink — Stream Processing with Confluent Cloud for Apache Flink](https://docs.confluent.io/cloud/current/flink/overview.html)
- [Apache Kafka 4.3 documentation — Kafka Streams Architecture](https://kafka.apache.org/43/streams/architecture/)
- [Apache Spark 4.2.0 documentation — Structured Streaming Programming Guide](https://spark.apache.org/docs/4.2.0/streaming/index.html)
- [AWS Lambda Developer Guide — Implementing stateful Kinesis Data Streams processing in Lambda](https://docs.aws.amazon.com/lambda/latest/dg/services-kinesis-windows.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
