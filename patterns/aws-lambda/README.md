<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🟧 AWS Services](../../README.md#aws-services)

# AWS Lambda

> Functions as a service: code runs per event in managed execution environments that scale out with concurrency.

<p align="center"><img src="diagram.svg" alt="Animated diagram: AWS Lambda" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/aws-lambda.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | The photo app runs two functions and no servers. API Gateway invokes `get-photo` **synchronously** and waits for its answer, while S3 sends each `ObjectCreated` event to the SQS queue `thumbnail-jobs`, where an **event source mapping** polls and invokes `make-thumbnail` (Python, 1,024 MB, 60 s timeout) with batches of up to 10. The third style, **asynchronous** invocation (S3, SNS or EventBridge calling a function directly), puts the event on Lambda's internal queue; in every case you pay per request plus duration × memory, in GB-seconds. |
| **2 · Cold and warm starts** | An execution environment handles one request at a time. Request 2 finds env A idle, so Lambda thaws it and runs only the handler: a **warm start**. Request 3 finds none free, so Lambda creates env B in a new Firecracker microVM, loads the code, starts the runtime and runs the init code outside the handler (SDK clients, configuration): a **cold start**, which is billed and adds latency. Idle environments are frozen and removed later, so reuse is likely but never promised. |
| **3 · Concurrency** | Concurrency is requests per second × duration: 50 uploads a second at 0.8 s each keep about **40 environments** busy. The SQS mapping starts with 5 concurrent invokes and adds up to 300 a minute; **reserved concurrency** 100 caps `make-thumbnail` and sets that capacity aside within the account's default quota of 1,000 per Region, and invokes past a limit are throttled (429). **Provisioned concurrency** keeps 2 `get-photo` environments initialised ahead of requests, and **SnapStart** (Java, Python, .NET) restores new environments from a snapshot instead. |
| **4 · Failures and limits** | One upload is corrupt. With `ReportBatchItemFailures` on, the handler returns that message in `batchItemFailures`: Lambda deletes the other 9, the failed one reappears after the 360 s visibility timeout, and after 5 receives the queue's redrive policy moves it to `thumbnail-jobs-dlq`. Delivery is at least once, so the handler must be **idempotent**; an asynchronous invoke would instead be retried twice and then go to an on-failure destination. The limits to plan for (October 2026): 15 minutes per invocation, 128 to 10,240 MB of memory with CPU in proportion, 6 MB synchronous and 1 MB asynchronous payloads, and /tmp up to 10,240 MB. |
<!-- END GENERATED: header -->

## The problem

The photo app has two kinds of work. One is a small API: `GET /photos/{id}` has to answer quickly whether a few people open photos at night or hundreds do every second in the evening. The other is background work: every upload needs a thumbnail, and uploads come in bursts. Running servers for both means sizing a fleet for the evening peak and paying for it all night, patching its operating system and language runtime, and writing the code that pulls messages off a queue, retries them and adds workers when the queue grows. Neither job needs a server of its own. Each is a short piece of code that should run when a request or an event arrives, in as many copies as there are events at that moment.

## How it works

AWS Lambda runs a **function**, your handler and its dependencies packaged as a .zip archive or a container image, whenever something invokes it. Lambda owns everything underneath: the hosts, the operating system, the language runtime, scaling, and routing each request to a copy of the code. The photo app has two functions: `get-photo` behind API Gateway, and `make-thumbnail` (Python, 1,024 MB of memory, a 60-second timeout) fed from the SQS queue `thumbnail-jobs`.

### Three ways to invoke a function

How a function is invoked decides who waits, who retries and where a failed event ends up:

| Invocation | Used by | Who waits | When the handler fails |
|---|---|---|---|
| **Synchronous** (`InvocationType` `RequestResponse`) | API Gateway, function URLs, the SDKs and CLI | the caller, until the handler returns | The error goes back to the caller. Lambda doesn't retry, and API Gateway passes the error on to its client. |
| **Asynchronous** (`InvocationType` `Event`) | S3 and [SNS](../amazon-sns/) notifications, [EventBridge](../amazon-eventbridge/) rules, EventBridge Scheduler | nobody: Lambda puts the event on its internal queue and answers 202 at once | Lambda retries twice, waiting 1 minute and then 2, and then sends a record to an on-failure destination, or the event to a dead-letter queue, or drops it. |
| **Event source mapping** (polling) | SQS, [Kinesis](../amazon-kinesis-data-streams/), DynamoDB Streams, Amazon MSK and self-managed [Kafka](../kafka/), Amazon MQ, Amazon DocumentDB | Lambda's pollers, which read a batch and invoke the function synchronously with it | From a queue, the batch becomes visible again after the visibility timeout, and the queue's redrive policy moves repeat failures to its own dead-letter queue. From a stream, the batch is retried and holds up its shard until it succeeds or the records expire. |

S3 could invoke `make-thumbnail` directly, asynchronously. The photo app sends the `ObjectCreated` events to `thumbnail-jobs` instead, so the queue absorbs bursts and the event source mapping decides batching, concurrency and retries.

### The execution environment

Every invocation runs in an **execution environment**: a sandbox with the function's memory, its runtime and a `/tmp` directory. In Lambda's default compute type, environments are isolated from each other with Firecracker microVMs, the open-source virtual machine monitor that AWS described at NSDI 2020. An environment goes through three phases:

- **Init.** Lambda starts any extensions, bootstraps the runtime and runs the function's static code: everything outside the handler, such as imports, configuration and SDK clients. For on-demand functions this phase has 10 seconds; if it runs out, Lambda tries Init again during the first invocation, under the function's timeout.
- **Invoke.** Lambda runs the handler for one event, bounded by the function timeout (60 s for `make-thumbnail`; 900 s at most).
- **Shutdown.** When Lambda retires an environment, registered extensions get up to 2 seconds to clean up (500 ms if the only one is an internal extension).

After each invocation the environment is **frozen**. When the next request for the same function arrives, Lambda can thaw it and run only the handler: objects created during Init are still in memory, files in `/tmp` are still there, and background work left running resumes. Lambda keeps idle environments for a while but promises nothing. It removes idle ones, and it also replaces environments every few hours for runtime updates and maintenance, even for a function that is invoked all the time, so treat what survives as a cache, never as state.

### Cold starts

A request that finds no idle environment waits for a new one: Lambda creates the environment, loads the code and runs Init before the handler. That is a **cold start**; reusing a frozen environment is a **warm start**. AWS's documentation says cold starts typically affect under 1% of invocations and take from under 100 ms to more than a second, depending mainly on the package size, the runtime and how much work Init does. Since 1 August 2025 the Init phase is billed as duration in every configuration. There are three ways to shorten or avoid it:

- **Make Init cheaper**: a smaller package, fewer imports, heavy libraries loaded only when needed.
- **Provisioned concurrency** keeps a set number of environments initialised in advance, 2 for `get-photo`. You configure it on a version or an alias and pay for it for as long as it is configured; requests beyond it spill over to on-demand environments, which can start cold.
- **SnapStart** runs Init when you publish a version, snapshots the memory and disk of the initialised environment, and starts new environments from that snapshot. As of October 2026 it supports Java 11 and later, Python 3.12 and later and .NET 8 and later. It can't be combined with provisioned concurrency, EFS or more than 512 MB of `/tmp`, and anything unique created during Init (IDs, random seeds, credentials) has to be created again after a restore. It costs nothing extra for Java; Python and .NET functions pay for caching and for each restore.

### Concurrency and scaling

In the default compute type an environment handles **one request at a time**, so concurrency, the number of environments busy at once, is about requests per second × average duration. At 50 uploads a second and 0.8 s per thumbnail, `make-thumbnail` keeps about 50 × 0.8 = 40 environments busy whatever the batch size: with full batches of 10, about 5 invocations start each second and each runs for about 8 s. The controls, with their defaults as of October 2026:

- **Account quota.** 1,000 concurrent executions per Region, shared by every function in the account, which can be raised to tens of thousands. New accounts start lower and AWS raises them automatically with use.
- **Scaling rate.** Each function can add up to 1,000 environments every 10 seconds.
- **Reserved concurrency** is both a cap and a guarantee for one function: `make-thumbnail` never runs more than 100 environments, and 100 are held back for it. Lambda always leaves at least 100 units unreserved for other functions, and reserved concurrency 0 stops a function altogether. It costs nothing.
- **SQS event source mappings** scale their pollers separately. They start with 5 concurrent invocations and add up to 300 a minute, to at most 1,250 per mapping. **Maximum concurrency** (2 to 1,000) caps what one queue can drive; keep it at or below the function's reserved concurrency, or messages get throttled. **Provisioned mode** instead keeps a minimum and maximum number of pollers ready, for a fee.
- **Throttling.** When requests arrive faster than the function can scale, or a limit is reached, the invocation fails with HTTP 429 (`TooManyRequestsException`). A synchronous caller gets the error; Lambda keeps asynchronous events and retries them for up to 6 hours; an event source mapping backs off and the messages wait in the queue.

### Failures and at-least-once delivery

With `ReportBatchItemFailures` turned on for the mapping, `make-thumbnail` returns the IDs of the messages it couldn't process in `batchItemFailures`, and Lambda deletes the rest. Without it, any exception fails the whole batch and the good messages run again. A failed message becomes visible after the queue's visibility timeout, and once it has been received `maxReceiveCount` times, the redrive policy moves it to `thumbnail-jobs-dlq`. AWS recommends a visibility timeout of at least six times the function timeout (here 6 × 60 s = 360 s) and a `maxReceiveCount` of at least 5. Note that this dead-letter queue belongs to the SQS queue. Lambda's own dead-letter queue is for asynchronous invocations, and its on-failure destinations cover asynchronous invocations and stream and Kafka mappings, so neither applies to an SQS event source mapping.

Every path delivers **at least once**. S3 notifications can arrive more than once, SQS and event source mappings can deliver a message again, and even Lambda's asynchronous queue can hand a function the same event more than once. Handlers therefore have to be idempotent (see [idempotent consumer](../idempotent-consumer/)). `make-thumbnail` is idempotent by design: it always writes the same key, `thumbnails/u/…`, for the same upload. Where a repeat would do harm, such as a charge or an email, the Idempotency utility of Powertools for AWS Lambda can store a key for each event in DynamoDB and returns the saved result when the same event comes back within a window (1 hour by default).

## Where it fits

- **Solutions.** Serverless APIs (API Gateway or a function URL in front, DynamoDB behind); processing files as they land in S3; consumers of queues and streams; glue between AWS services, where an EventBridge rule or SNS topic invokes a function; scheduled jobs, which EventBridge Scheduler invokes asynchronously; and the individual steps of an [AWS Step Functions](../aws-step-functions/) workflow.
- **Patterns in this catalog.** Lambda is the usual way to build [serverless](../serverless/) functions and the consumers of an [event-driven architecture](../event-driven-architecture/). With SQS in front it gives [queue-based load leveling](../queue-based-load-leveling/) and [competing consumers](../competing-consumers/) without managing workers, which is [web-queue-worker](../web-queue-worker/) without the worker fleet; the queue's [dead-letter queue](../dead-letter-queue/) and an [idempotent](../idempotent-consumer/) handler complete it. Behind an [API gateway](../api-gateway/) it serves request and response APIs.
- **Usual neighbours.** API Gateway, [Amazon SQS](../amazon-sqs/), SNS, EventBridge, [Amazon S3](../amazon-s3/), [Amazon DynamoDB](../amazon-dynamodb/), AWS Step Functions, [CloudWatch](../amazon-cloudwatch/) and X-Ray, and [IAM](../aws-iam/): each function runs with an execution role that holds its permissions.
- **Managed offerings.** Lambda is itself the managed service. The closest equivalents are Azure Functions and Google Cloud Run functions.

## When to use it

Use Lambda when work arrives as separate requests or events, finishes within seconds or minutes, and keeps its state somewhere else: APIs with uneven traffic, files processed as they arrive, queue and stream consumers, scheduled jobs, glue between AWS services. It is a strong default when traffic is low, spiky or unknown, because idle time costs nothing and there is no fleet to size.

Look elsewhere for work that runs longer than 15 minutes in one go (split it into Step Functions steps, or use durable functions, below), for steady heavy load where always-on capacity is cheaper (see the costs below), for latency-critical paths that can't absorb a cold start and won't pay for provisioned concurrency, and for software that needs long-lived connections or large in-memory state.

| | AWS Lambda | [Amazon ECS](../amazon-ecs/) on Fargate | [Kubernetes](../kubernetes/) Deployment | Azure Functions (Flex Consumption) | Google Cloud Run functions |
|---|---|---|---|---|---|
| You deploy | a function (.zip or container image) | a task definition (containers) | a pod template, on a cluster you run | a function app | a function, built into a Cloud Run service |
| Requests per instance | 1 per environment (several on Managed Instances) | as many as your app handles | as many as your app handles | several, set per function | up to 1,000 |
| Longest request | 15 minutes | no limit: tasks run until stopped | no limit | 30 minutes by default, no enforced maximum (HTTP responses within 230 s) | up to 60 minutes for HTTP functions |
| Largest instance | 10,240 MB, CPU in proportion | 32 vCPU, 244 GB | your node size | depends on the instance memory you pick | 4 vCPU, 16 GiB |
| Scaling | per request, down to zero | Service Auto Scaling on CloudWatch metrics | HorizontalPodAutoscaler on metrics, plus node scaling | per function, down to zero, up to 1,000 instances | per request, down to zero; minimum instances optional |
| You pay for | requests + GB-seconds, in 1 ms steps | vCPU and memory per second, from image pull to stop (1-minute minimum on Linux) | the nodes, busy or idle | executions + memory while executing, + any always-ready instances | Cloud Run pricing |

## Trade-offs

- **Cold starts show up in the tail.** They hit the first request after a quiet period, every request that forces a new environment during a burst, and the first requests after each deployment. Provisioned concurrency avoids most of them, for a price you pay while it is configured; SnapStart makes them shorter.
- **One request per environment.** It keeps the programming model simple (no shared state between concurrent requests, no thread pools), but an I/O-bound function pays for its memory while it waits on the network, where a container would serve many requests with the same memory. Lambda Managed Instances, below, exist for steady, high-volume work of that kind.
- **Hard limits** (October 2026): 15 minutes per invocation; payloads of 6 MB each way for synchronous calls, 1 MB for asynchronous ones and 200 MB for streamed responses; a 250 MB unzipped package including layers, or a 10 GB container image; `/tmp` up to 10,240 MB; 4 KB of environment variables.
- **Steady load costs more.** In us-east-1, a 1,769 MB function (the documented equivalent of one vCPU) busy for a whole hour costs about $0.104 in duration on x86, while a Fargate task with 1 vCPU and 2 GB (Linux, x86) costs about $0.049 an hour. For CPU-bound work Lambda comes out ahead only while it is busy less than about half the time, and a container that serves many I/O-bound requests at once moves that point further.
- **Scaling can overwhelm what's behind it.** A burst that adds hundreds of environments can exhaust a database's connections or a partner's rate limit. Cap the function with reserved concurrency or the mapping's maximum concurrency, and put a connection pooler in front of relational databases.
- **One quota for the whole account.** Every function in a Region draws from the same pool, so a runaway function can throttle the others; reserved concurrency fences off the critical ones. Lambda's recursive loop detection stops loops that run through SQS, S3, SNS or EventBridge custom event buses after about 16 invocations, but not loops through other services.
- **Retries at every layer.** S3 delivers notifications at least once, SQS redelivers and the mapping retries, so duplicates are normal, and a message that keeps failing takes several visibility timeouts (here 5 × 360 s) to reach the dead-letter queue.
- **Lock-in sits around the code.** A handler is ordinary code; the triggers, event formats, IAM roles and the services around it are AWS-specific.

## Implementation notes

**Connect the queue.** The event source mapping is created on the Lambda side; `ReportBatchItemFailures` turns on partial batch responses. The queue itself needs `VisibilityTimeout` 360 and a redrive policy with `maxReceiveCount` 5 pointing at `thumbnail-jobs-dlq`. The account ID and alias are examples:

```sh
aws lambda create-event-source-mapping \
  --function-name make-thumbnail \
  --event-source-arn arn:aws:sqs:us-east-1:111122223333:thumbnail-jobs \
  --batch-size 10 \
  --function-response-types ReportBatchItemFailures

aws lambda put-function-concurrency --function-name make-thumbnail \
  --reserved-concurrent-executions 100

aws lambda put-provisioned-concurrency-config --function-name get-photo \
  --qualifier live --provisioned-concurrent-executions 2
```

**Keep expensive setup in Init and report failures per message.** The S3 client is created once per environment; the handler reports only the messages that failed. Object keys arrive URL-encoded in S3 events, and S3 sends an `s3:TestEvent` message without `Records` when the notification is first set up:

```python
import json
import urllib.parse

import boto3

s3 = boto3.client("s3")  # Init: runs once per execution environment, reused while warm


def make_thumbnail(bucket, key):
    ...  # download u/…, resize it, upload thumbnails/u/… (the same key every time)


def handler(event, context):  # Invoke: one batch of up to 10 SQS messages
    failures = []
    for record in event["Records"]:
        try:
            body = json.loads(record["body"])  # the S3 event notification
            for s3_event in body.get("Records", []):  # s3:TestEvent has no Records
                bucket = s3_event["s3"]["bucket"]["name"]
                key = urllib.parse.unquote_plus(s3_event["s3"]["object"]["key"])
                make_thumbnail(bucket, key)
        except Exception:
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}  # needs ReportBatchItemFailures on the mapping
```

- **Memory is also the CPU setting.** Lambda allocates CPU in proportion to memory, and 1,769 MB is the equivalent of one vCPU, so `make-thumbnail` at 1,024 MB gets a little over half of one. CPU-bound work such as resizing images often runs faster with more memory, which can leave the cost per photo about the same; measure before you settle on a size.
- **Arm costs less per GB-second.** Functions on the `arm64` architecture (AWS Graviton2) are priced at $0.0000133334 per GB-second in us-east-1, against $0.0000166667 on `x86_64`, 20% less. Native dependencies need arm64 builds.
- **Work out the bill.** Lambda charges $0.20 per million requests plus duration × memory (us-east-1, first pricing tier, October 2026). A million thumbnails at 0.8 s and 1 GB is 800,000 GB-seconds, about $13.33 on x86 or $10.67 on Arm, plus $0.02 to $0.20 in requests depending on how full the batches are, before the monthly free tier (1 million requests and 400,000 GB-seconds) and without the SQS and S3 charges.
- **Networking.** By default a function can reach the internet and public AWS endpoints but not private resources in your VPC. Attached to private subnets, it reaches them through Hyperplane network interfaces that Lambda creates when you configure the function, one per combination of subnet and security group, shared by all environments. Once attached, it reaches the internet only if the VPC provides a route out, typically a NAT gateway.
- **Layers, extensions and container images.** A function can use up to 5 layers (.zip archives of libraries or data, for .zip functions only). Extensions run inside the environment next to the function, for monitoring agents or secret caches, and they add to Init and shutdown time. A container image can be up to 10 GB.
- **Response streaming.** Through a function URL, the `InvokeWithResponseStream` API or API Gateway's proxy integration, a function can stream a response of up to 200 MB: the first 6 MB at full speed, the rest at up to 2 MB/s. The managed Node.js runtimes support it directly; other languages need a custom runtime or the Lambda Web Adapter.
- **Observe it.** Each invocation writes a `REPORT` line to CloudWatch Logs with `Duration`, `Billed Duration` and `Max Memory Used`, plus `Init Duration` after a cold start. Alarm on the `Errors`, `Throttles` and `ConcurrentExecutions` metrics and on messages in the dead-letter queue, and turn on X-Ray tracing to follow a request across services.
- **Newer options** (as described in the documentation in October 2026): **Lambda Managed Instances** (November 2025) run functions on EC2 instances in your account, with several invocations per environment, EC2 pricing plus a 15% management fee, and up to 90 minutes for asynchronous and most polled invocations. **Lambda durable functions** (December 2025) checkpoint progress inside a function so that one workflow can run for up to a year, and waits cost no compute. **Lambda MicroVMs** are a separate primitive: isolated environments for one user or job each, which live for up to 8 hours. **Tenant isolation mode** keeps each tenant's requests on environments used only for that tenant.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Serverless (Functions)](../serverless/) — Functions start per event, scale out automatically and scale to zero when idle.
- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.
- [Amazon SQS](../amazon-sqs/) — A managed message queue: consumers poll, a visibility timeout hides messages in flight, and repeated failures go to a dead-letter queue.
- [Amazon S3](../amazon-s3/) — Object storage: objects in buckets, addressed by key, stored across Availability Zones, with storage classes, versioning and events.
- [Amazon DynamoDB](../amazon-dynamodb/) — A serverless key-value and document database: the partition key spreads items across partitions for single-digit-millisecond reads.
- [AWS Step Functions](../aws-step-functions/) — Workflows as state machines: sequence, branch, retry, wait and run in parallel across services, with every step recorded.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.
- [Queue-Based Load Leveling](../queue-based-load-leveling/) — A queue absorbs traffic spikes so the backend can work at a steady pace.

## References

- [AWS Lambda Developer Guide — What is AWS Lambda?](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html)
- [AWS Lambda — Understanding Lambda function invocation methods](https://docs.aws.amazon.com/lambda/latest/dg/lambda-invocation.html)
- [AWS Lambda — Understanding the Lambda execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html)
- [AWS Lambda — Understanding Lambda function scaling](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html)
- [AWS Lambda — Lambda scaling behavior](https://docs.aws.amazon.com/lambda/latest/dg/scaling-behavior.html)
- [AWS Lambda — Configuring reserved concurrency for a function](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html)
- [AWS Lambda — Configuring provisioned concurrency for a function](https://docs.aws.amazon.com/lambda/latest/dg/provisioned-concurrency.html)
- [AWS Lambda — Improving startup performance with Lambda SnapStart](https://docs.aws.amazon.com/lambda/latest/dg/snapstart.html)
- [AWS Lambda — How Lambda handles errors and retries with asynchronous invocation](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html)
- [AWS Lambda — Capturing records of Lambda asynchronous invocations](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-retain-records.html)
- [AWS Lambda — Using Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)
- [AWS Lambda — Configuring scaling behavior for SQS event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html)
- [AWS Lambda — Handling errors for an SQS event source in Lambda](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html)
- [AWS Lambda — Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/)
- [AWS Compute Blog — AWS Lambda standardizes billing for INIT Phase](https://aws.amazon.com/blogs/compute/aws-lambda-standardizes-billing-for-init-phase/)
- [AWS Lambda — Response streaming for Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html)
- [AWS Lambda — Giving Lambda functions access to resources in an Amazon VPC](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)
- [AWS Lambda — Lambda Managed Instances](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances.html)
- [AWS Lambda — Lambda durable functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html)
- [Powertools for AWS Lambda (Python) — Idempotency](https://docs.powertools.aws.dev/lambda/python/latest/utilities/idempotency/)
- [Agache et al. — Firecracker: Lightweight Virtualization for Serverless Applications (NSDI 2020)](https://www.usenix.org/conference/nsdi20/presentation/agache)
- [Amazon ECS — Task definition differences for Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html)
- [Azure Functions — Scale and hosting](https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale)
- [Google Cloud — Compare Cloud Run functions](https://docs.cloud.google.com/run/docs/functions/comparison)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
