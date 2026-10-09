<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [📨 Messaging & Integration](../../README.md#messaging--integration)

# Priority Queue

> Urgent messages are processed ahead of routine ones.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Priority Queue" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/priority-queue.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · First come, first served** | The nightly import has put **500 re-index jobs** on the only queue, and a password-reset email lands behind them. Four workers finish 2.5 jobs a second each, 10 in total, so the email waits 500 ÷ 10 = **50 s** while the user stares at the screen. In one queue every message has the same standing, whatever it is for. |
| **2 · A queue per priority** | Producers mark each message and send it to a **high** or a **low** queue (or publish to one topic whose subscriptions filter on a priority attribute). Workers always check the high queue first, so the password-reset email finds it empty, goes to the next free worker and is sent about 0.5 s after it arrived. The import carries on in the low queue. |
| **3 · Starvation, then reserve** | A flash sale sends 12 urgent order confirmations a second, more than the pool's 10. With high-first polling the high queue never empties and the low queue gets nothing: its oldest message is soon **10 minutes** old. **Reserve capacity** for it (worker 4 takes only low work, or the pool pulls high and low 3 : 1), so high gets 7.5 jobs a second and low 2.5, and scale each pool on its own queue: the high pool grows to six workers, 15 jobs a second. |
| **4 · Know the limits** | RabbitMQ can order by priority inside one queue (classic and quorum queues); Amazon SQS, Azure Service Bus, Google Cloud Pub/Sub and Kafka need a queue, subscription or topic per level. Priority only decides which message is picked next: worker 1's long low-priority job keeps its worker, so split long jobs. And decide who may send urgent work: if every producer marks its messages urgent, nothing is. |
<!-- END GENERATED: header -->

## The problem

Most queues hand out work in arrival order. That is fair, but it ignores what each message is for. When a nightly batch puts hundreds of routine tasks on the same queue as interactive work, a password-reset email or a "payment failed" notice waits behind all of them, and someone at a screen waits with it. More consumers shorten the wait on average, yet every urgent message still sits behind the whole backlog that arrived before it.

## How it works

Give each message a priority when it is produced, and let the consumers take higher-priority work first. There are two designs:

- **One queue with broker-side priorities.** The broker keeps the queue ordered by a priority field and hands out the most important message first. RabbitMQ does this. Classic queues need the `x-max-priority` argument when the queue is declared (1 to 255; the documentation recommends only a handful of levels, and a policy can't set it). Quorum queues always support priorities: strictly, with levels 0 to 31, since RabbitMQ 4.3; versions 4.0 to 4.2 had two levels, normal and high, delivered two high for every normal.
- **A queue, or a subscription, per priority.** Producers send each message to the high or the low queue, or publish to one topic and let a subscription per priority filter on an attribute. This works on brokers that have no priority field: Amazon SQS (AWS suggests separate queues for prioritization; its fair queues balance tenants, not urgency), Azure Service Bus (the Azure pattern's example sets a custom `Priority` property and routes it with SQL filters to a high and a low subscription), Google Cloud Pub/Sub (a message carries attributes but no priority, and subscription filters can match an attribute) and Apache Kafka (a topic per priority).

The consumers then choose what to take next:

- **High-first polling.** One pool checks the high queue and takes low work only when high is empty. It gives urgent work the shortest wait and wastes no capacity, but low work starves whenever high never empties.
- **A dedicated pool per queue.** Each queue has its own consumers and its own scaling limits; the Azure sample lets the high consumer scale out to 200 instances and the low one to 40. Classes are isolated, but idle high consumers don't help with a low backlog unless you let them.
- **Weighted ratios.** The pool takes, for example, three high messages for every low one. Low work always moves, at the cost of some urgent latency.

In the diagram, four workers each finish 2.5 jobs a second (10 in total, 0.4 s per job). Behind 500 routine jobs in one queue, the reset email waits 500 ÷ 10 = 50 s; with a high queue it waits only for the next free worker.

## When to use it

- Interactive work shares workers with batch work: password resets and order confirmations next to imports, re-indexing or report generation.
- Customers or tenants buy different service levels, and premium requests need a tighter latency target.
- Alerts and pages must not wait behind routine reports or digests.
- Not when all work is equally urgent, or when only average throughput matters: priority adds queues, routing rules and failure modes without improving either.

## Trade-offs

- **Starvation.** Strict high-first service can hold low work back for as long as urgent work keeps coming. Bound it: reserve consumers for low (one of four workers in the diagram, so high gets 7.5 jobs a second and low 2.5), pull in a fixed ratio, or *age* messages by promoting anything that has waited past its target to the higher queue. RabbitMQ's documentation notes that classic queues serve their priority levels in cycles so lower levels are never starved, while strict quorum queues can delay them indefinitely.
- **No pre-emption.** Priority only chooses the next message. A long low-priority job that has already started keeps its worker until it finishes, so split long jobs into short steps with checkpoints and the workers come back to the queue often.
- **Order across priorities is lost.** A later urgent message overtakes earlier routine ones. If two messages change the same entity, keep them in the same class or make the consumer cope with any order.
- **Priority is not capacity.** If urgent work alone exceeds what the consumers finish, the high queue grows too. Scale each queue's consumers on its own depth, or on the age of its oldest message: see [Autoscaling](../autoscaling/) and [Competing Consumers](../competing-consumers/).
- **More moving parts.** Separate queues bring separate dead-letter queues, alarms, permissions and polling costs.

## Implementation notes

- **Priority only matters when work waits.** With RabbitMQ, use manual acknowledgements and a small prefetch: a consumer with a large prefetch has already taken low-priority messages before the urgent one arrives. With SQS, long polling an empty high queue holds the loop for up to the wait time before it looks at the low queue; use a short wait in a high-first loop, or separate pollers.
- **Kafka has no message priority.** A consumer fetches from all of its partitions at once; to favour a high-priority topic, pause the low topic's partitions while high has a backlog and resume them afterwards, or run a separate consumer group per topic.
- **Decide who sets priority.** Derive it from facts the system trusts (the message type, the customer's plan), not from a flag any producer can set. Restrict who may publish to the high queue with separate credentials or topic permissions, and watch the volume per producer: if every producer marks its messages urgent, nothing is.
- **Scale each queue on its own signal.** KEDA has scalers for RabbitMQ, Amazon SQS, Azure Service Bus, Google Cloud Pub/Sub and Kafka; the Pub/Sub scaler can scale on the age of the oldest unacknowledged message, and SQS publishes a matching signal as the CloudWatch metric `ApproximateAgeOfOldestMessage`.
- **Dead-letter per queue.** Give each priority its own [dead-letter queue](../dead-letter-queue/), so a poison urgent message can't block the high path and its alarm reaches the right team.
- **Monitor per class.** Track depth and the age of the oldest message for each queue against a target per class, for example a few seconds for high and an hour for low. An average across classes hides starvation.
- **Rank work at the edge too.** Queues are one place to prioritise. At the API, shed the least critical requests first when overloaded ([Rate Limiting](../rate-limiting/); Google's SRE book describes criticality levels that travel with each request), and give each class its own pool so one can't exhaust another ([Bulkhead](../bulkhead/)).

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Competing Consumers](../competing-consumers/) — Several workers pull from one queue, so work is shared and throughput scales out.
- [Queue-Based Load Leveling](../queue-based-load-leveling/) — A queue absorbs traffic spikes so the backend can work at a steady pace.
- [Web-Queue-Worker](../web-queue-worker/) — A web front end hands slow work to background workers through a queue.
- [Rate Limiting & Throttling](../rate-limiting/) — Cap how fast each client may call (token bucket) and shed the excess with 429s.
- [Bulkhead](../bulkhead/) — Give each dependency its own pool of resources so one failure can't sink the whole ship.
- [Dead-Letter Queue](../dead-letter-queue/) — Park messages that keep failing so they stop blocking the queue and can be inspected.
- [Asynchronous Request-Reply](../asynchronous-request-reply/) — Accept now with 202, process in the background, and let the client poll a status URL.
- [Autoscaling](../autoscaling/) — Add and remove instances automatically as load rises and falls.

## Related components and services

- [RabbitMQ](../rabbitmq/) — A message broker: exchanges route each message into queues, and a consumer holds it until it acknowledges or rejects it.

## Related database topics

- [Locks & Deadlocks](../locks-and-deadlocks/) — Row locks make writers wait for each other; two transactions waiting on each other is a deadlock, and the database aborts one.

## References

- [Azure Architecture Center — Priority Queue pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/priority-queue)
- [RabbitMQ — Priority Support in Queues (classic and quorum queues)](https://www.rabbitmq.com/docs/priority)
- [Amazon SQS — Features (priority through separate queues)](https://aws.amazon.com/sqs/features/)
- [Azure Service Bus — Topic filters](https://learn.microsoft.com/en-us/azure/service-bus-messaging/topic-filters)
- [Google Cloud Pub/Sub — Filter messages from a subscription](https://docs.cloud.google.com/pubsub/docs/subscription-message-filter)
- [Apache Kafka — KafkaConsumer (consumption flow control: pause and resume)](https://kafka.apache.org/43/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html)
- [Google SRE Book — Handling Overload (request criticality)](https://sre.google/sre-book/handling-overload/)
- [KEDA — Scalers](https://keda.sh/docs/2.21/scalers/)
- [Amazon SQS — Available CloudWatch metrics (ApproximateAgeOfOldestMessage)](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-available-cloudwatch-metrics.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
