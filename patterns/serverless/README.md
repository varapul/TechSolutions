<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🏛️ Application Architecture](../../README.md#application-architecture)

# Serverless (Functions)

> Functions start per event, scale out automatically and scale to zero when idle.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Serverless (Functions)" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/serverless.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · An event starts a function** | With no traffic there are **0 instances** and no compute is billed. When an event arrives, the platform creates an execution environment, which is a **cold start**: it fetches the code, starts the runtime and runs your initialisation code. Then it runs the handler and returns the result, and you pay for the request and for the time the code ran. |
| **2 · Warm reuse, then scale out** | The next event finds that instance **warm** and goes straight to the handler. When six events arrive at once, the platform starts more instances in parallel: in the classic model one instance handles one request at a time, so six concurrent events need six instances. Scaling stops at a **concurrency limit**, and invocations beyond it are throttled. |
| **3 · State lives outside** | Instances are ephemeral: memory and local disk may not survive between invocations, so anything worth keeping goes to a database, object storage or a queue. For asynchronous sources the platform **retries** a failed invocation and then routes the event to a **dead-letter queue** or failure destination. Because of those retries the same event can be delivered more than once, so handlers must be **idempotent**. |
| **4 · Scale to zero** | When the traffic stops, idle instances stay warm for a while and are then reclaimed: back to **0 instances** and no compute cost. The price is that the next event pays a cold start again. Keeping instances provisioned (minimum instances, provisioned concurrency) removes that delay for a fee. |
<!-- END GENERATED: header -->

## The problem

Most backend code spends its life waiting. A server sized for the peak sits idle through the night, and you still patch it, pay for it and plan its capacity. For work that is shaped like events (a request, an uploaded file, a message, a timer) the lifetime of a server has little to do with the work itself. You want code to run when something happens, in as many copies as there are events, and to cost nothing when nothing happens.

## How it works

"Serverless" is an umbrella term. Mike Roberts splits it into **Backend as a Service** (BaaS: third-party services such as databases and authentication that you call rather than run) and **Functions as a Service** (FaaS: your own code, run by the platform in stateless, ephemeral containers). The umbrella now also covers containers and databases that scale to zero and bill per use (Cloud Run, Aurora Serverless, the serverless tier of Azure SQL Database). This pattern is about FaaS; the managed services on the right of the diagram are the BaaS it leans on.

You deploy a **function**: a handler and its dependencies, bound to one or more event sources. The platform does the rest. Unlike [autoscaling](../autoscaling/) a group of servers, there is no minimum size and no scaling policy to tune: the unit is a single instance that exists only while there is work.

- **Cold start.** If no instance is free when an event arrives, the platform creates an execution environment: it fetches the code, starts the runtime and runs your initialisation code (everything outside the handler). Only then does the handler run.
- **Warm start.** A finished instance is kept for a while. The next event reuses it and goes straight to the handler, so clients, connections and caches built during initialisation are reused. Nothing guarantees that an instance survives, so treat that as a bonus.
- **Scale out.** In the classic model an instance handles one invocation at a time, so concurrency is the number of instances: roughly *requests per second × average duration*. More concurrent events mean more instances, up to a concurrency limit. Beyond it, synchronous callers are throttled and queued events wait.
- **Scale to zero.** Idle instances are reclaimed after a period the platform chooses. With no traffic there are no instances and no compute charge.

How a failure is handled depends on how the function was invoked:

| Invocation | Typical sources | When the handler fails |
|---|---|---|
| **Synchronous** | HTTP through an [API gateway](../api-gateway/), direct calls | The caller gets the error (or the throttle) and decides whether to retry. The platform does not retry. |
| **Asynchronous** | Object storage notifications, topics, schedules | The platform queues the event, retries the invocation a few times with a delay, then drops the event or routes it to a dead-letter queue or failure destination. |
| **Polling** | Queues and streams | The platform polls and invokes with a batch. A failed queue message becomes visible again and is redelivered until the queue's own dead-letter rule removes it. A failed stream batch is retried in order, which blocks that shard or partition until it succeeds or the records expire. |

## When to use it

- Event-shaped, bursty or unpredictable work: APIs with uneven traffic, webhooks, file and stream processing, scheduled jobs, glue between managed services.
- New products and internal tools, where traffic is unknown and paying nothing at idle matters more than the price per request.
- Small units of work that finish in seconds and keep their state elsewhere. Functions are the natural consumers in an [event-driven architecture](../event-driven-architecture/).

**When not to use it:**

- Long-running or heavy jobs that outlive the platform's timeout, unless a workflow can split them into steps.
- Latency-critical paths that cannot absorb a cold start, unless you pay to keep instances provisioned.
- Steady, heavy throughput, where always-on compute costs less per request.
- Work that needs large in-memory state, sticky sessions or long-lived connections.

## Trade-offs

- **Cold starts.** They hit the first request after an idle period and every request that forces a new instance, so they show up in tail latency. Package size, the runtime and the amount of initialisation code all add to them. AWS reports that cold starts typically affect under 1% of Lambda invocations and last from under 100 ms to more than a second.
- **Hard limits.** Duration, payload size, memory and concurrency are capped. A concurrency quota shared by many functions lets one busy function throttle the rest.
- **Downstream pressure.** Functions scale out faster than most things they call. A burst can exhaust a relational database's connections or a partner's rate limit, so cap the function's concurrency or put a queue in front (queue-based load leveling).
- **At-least-once delivery.** Asynchronous and polled events can arrive more than once, and a retry can follow a partial success. Handlers have to be idempotent (the idempotent consumer pattern).
- **Cost at scale.** You pay per request and for duration multiplied by the memory you configured, and nothing while idle. Per unit of compute that is dearer than a server you keep busy, so the model wins when utilisation is low or spiky and loses under steady heavy load. To find the break-even, compare *requests × (request price + duration × memory × rate)* with the always-on capacity the same traffic would need.
- **Harder to observe and test.** There is no host to log in to, and one request crosses several managed services.
- **Lock-in.** The handler is ordinary code. The lock-in sits in the event sources, permissions and managed services around it.

## Implementation notes

- **Reduce cold starts** before paying to avoid them: ship a small package, load heavy dependencies lazily, and keep initialisation to what every invocation needs. Then consider snapshots (AWS Lambda SnapStart restores Java, Python and .NET functions from a snapshot of an initialised environment) or always-warm capacity (Lambda provisioned concurrency, Azure Functions always-ready instances, Cloud Run minimum instances), which you pay for while it is idle.
- **Keep state outside.** Use memory and local disk only as a cache. Create clients and database connections during initialisation so that warm invocations reuse them.
- **Protect relational databases.** Every instance holds its own connections, so 500 instances can mean 500 connections. Keep the pool tiny (one connection where an instance serves one request at a time), and either put a pooler or proxy in between (PgBouncer, Amazon RDS Proxy) or cap the function's concurrency below the database's limit.
- **Make handlers idempotent.** Derive an idempotency key from the event, record it together with the result, and return the stored result when the key shows up again. Give every asynchronous source a dead-letter queue and alert on it.
- **Orchestrate with a workflow service**, not with functions that call functions and wait. AWS Step Functions, Azure Durable Functions and Google Cloud Workflows hold the state of a multi-step process and handle its retries and waits (see [saga orchestration](../saga-orchestration/) for undoing completed steps). Lambda durable functions checkpoint the progress of a single function in a similar way.
- **Observe from outside.** Write structured logs with a correlation ID, propagate trace context through events ([distributed tracing](../distributed-tracing/)), and watch duration, errors, throttles, concurrency, the cold-start rate and the age of queued events.
- **Test in two layers.** Unit-test the handler as a plain function with recorded events. Emulators (AWS SAM CLI's `sam local`, Azure Functions Core Tools, Google's Functions Framework) run it on your machine, but permissions, triggers, timeouts and scaling only behave truthfully in a deployed test environment.
- **Limit lock-in** by keeping business logic behind a thin adapter that translates the platform's event into your own types. [CloudEvents](https://cloudevents.io/) gives events a common envelope, and packaging a function as a container keeps the option of moving it.

**Platform examples** (checked in October 2026; these details change often):

- **AWS Lambda.** One invocation per execution environment in the default compute type; Lambda Managed Instances allow several. The timeout is at most 15 minutes (90 minutes for asynchronous and most polled invocations on Managed Instances). The default quota is 1,000 concurrent executions per Region, and each function can add 1,000 environments every 10 seconds. A failed asynchronous invocation is retried twice, and the event is then discarded unless a dead-letter queue or on-failure destination is configured. Billing is per request plus duration in 1 ms steps, and initialisation code counts as duration.
- **Azure Functions.** An instance processes several events at once, with per-trigger concurrency settings. Flex Consumption is the plan recommended for new serverless apps: it scales to zero and out to 1,000 instances, bills on-demand instances only while they execute functions, and offers always-ready instances. Premium keeps prewarmed instances. The original Consumption plan is now legacy, and its Linux variant retires on 30 September 2028. The timeout defaults to 30 minutes with no enforced maximum on Flex Consumption and Premium (5 minutes, 10 at most, on Consumption), and an HTTP trigger has to respond within 230 seconds. Retry behaviour depends on the trigger.
- **Google Cloud.** Cloud Functions was renamed Cloud Run functions, and a function now deploys as a Cloud Run service. Cloud Run's default maximum concurrency is 80 requests per instance (80 per vCPU when deployed with the CLI), configurable up to 1,000; 1st gen functions take one request at a time. The request timeout defaults to 5 minutes and can be raised to 60. Services scale to zero by default, idle instances can stay for up to 15 minutes, and minimum instances keep some warm. Request-based billing charges an instance while it starts, serves requests and shuts down.
- **Kubernetes.** Knative Serving scales a revision to zero when it has no traffic and back up on the next request. KEDA scales ordinary workloads from event sources such as a queue, down to zero. You still run and pay for the cluster underneath.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.
- [Autoscaling](../autoscaling/) — Add and remove instances automatically as load rises and falls.
- [Microservices](../microservices/) — Small, independently deployable services, each owning one business capability and its data.
- Web-Queue-Worker *(planned)* — A web front end hands slow work to background workers through a queue.
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- [Queue-Based Load Leveling](../queue-based-load-leveling/) — A queue absorbs traffic spikes so the backend can work at a steady pace.
- [Dead-Letter Queue](../dead-letter-queue/) — Park messages that keep failing so they stop blocking the queue and can be inspected.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.

## References

- [Mike Roberts — Serverless Architectures (martinfowler.com)](https://martinfowler.com/articles/serverless.html)
- [AWS Lambda — Understanding the Lambda execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html)
- [AWS Lambda — Understanding Lambda function scaling](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html)
- [AWS Lambda — Understanding retry behavior in Lambda](https://docs.aws.amazon.com/lambda/latest/dg/invocation-retries.html)
- [Azure Functions — Hosting options](https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale)
- [Azure Functions — Error handling and retries](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-error-pages)
- [Google Cloud — About instance autoscaling in Cloud Run services](https://docs.cloud.google.com/run/docs/about-instance-autoscaling)
- [Google Cloud — Compare Cloud Run functions](https://docs.cloud.google.com/run/docs/functions/comparison)
- [Knative — Configuring scale to zero](https://knative.dev/docs/serving/autoscaling/scale-to-zero/)
- [KEDA — KEDA Concepts](https://keda.sh/docs/latest/concepts/)
- [Jonas et al. — Cloud Programming Simplified: A Berkeley View on Serverless Computing (2019)](https://arxiv.org/abs/1902.03383)
- [CNCF Serverless Working Group — Serverless Whitepaper v1.0](https://github.com/cncf/wg-serverless/tree/master/whitepapers/serverless-overview)
- [AWS Well-Architected Framework — Serverless Applications Lens](https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/welcome.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
