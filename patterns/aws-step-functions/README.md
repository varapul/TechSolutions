<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🟧 AWS Services](../../README.md#aws-services)

# AWS Step Functions

> Workflows as state machines: sequence, branch, retry, wait and run in parallel across services, with every step recorded.

<p align="center"><img src="diagram.svg" alt="Animated diagram: AWS Step Functions" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/aws-step-functions.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Acme Shop's Orders API calls `StartExecution` on the Standard state machine **PlaceOrder**, names the execution after the order (**o-981**) and passes the order as input; the call returns the execution ARN at once, so the API can answer the shopper without waiting. Step Functions then works through the states: it calls Lambda, DynamoDB, SNS and ECS in turn, hands each state's output to the next state and writes every step to the execution history. The flow lives in one definition in the Amazon States Language instead of glue code that chains Lambda functions, which makes Step Functions the orchestrator of a [saga](../saga-orchestration/). |
| **2 · Running o-981** | **ValidateOrder** invokes a Lambda function; **ReserveStock** calls DynamoDB `UpdateItem` itself through an optimized integration, with a condition that enough stock is left, so no function sits in between. **ChargeCard** stores the charge ID in a variable with `Assign`; the Choice state **NeedsApproval** finds THB 1,280 under the THB 50,000 threshold and takes its `Default` branch to **Fulfil**, a Parallel state whose branches run at once: one publishes the confirmation to SNS, the other runs an ECS task with `.sync` and waits until it stops. Each state's input and output, and the variables it assigns, go into the execution history; the workflow uses JSONata (`Arguments`, `Output`, `Assign`), which AWS recommends for new workflows, while JSONPath stays the default. |
| **3 · Retry, catch, wait** | For **o-982** the payment provider does not answer and charge-card throws `Payment.Timeout`. The retrier (`IntervalSeconds` 2, `BackoffRate` 2, `MaxAttempts` 2) runs ChargeCard again after 2 s and after 4 s; the third attempt fails too, so the `Catch` sends the execution to **ReleaseStock**, which puts the stock back (the compensating step), and on to the Fail state **OrderFailed**, and the history records the error and its cause. Meanwhile **o-983** (THB 68,400) reaches **WaitForApproval**, which sends a task token to the approvals queue and pauses until the approver's app calls `SendTaskSuccess` with that token. A Standard execution can wait like this for up to a year, so set a `TimeoutSeconds` on the task. |
| **4 · Standard, Express, limits** | **Standard** workflows such as PlaceOrder run for up to a year, never run a state twice unless a retrier says so, keep their history for 90 days and cost $0.025 per 1,000 state transitions, retries included (US East, N. Virginia, October 2026). **Express** workflows run for at most 5 minutes, at least once when started asynchronously and at most once when started synchronously; they keep no history in Step Functions (only CloudWatch Logs), support neither `.sync` nor task tokens, and cost $1.00 per million requests plus duration, which suits high-volume event processing. The limits to design around: 256 KiB for any state's input or output (a 2 MB invoice must travel as an S3 key), 25,000 events in one execution's history, and a bill that grows with every transition in a chatty workflow. Temporal (durable execution in code) and Apache Airflow (scheduled batch pipelines) are the usual alternatives. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's order fulfilment touches five systems: a Lambda function validates the order, DynamoDB holds the stock, a payment provider charges the card, SNS sends out the confirmation and a container task books the courier. Large orders also need a person to approve them. The obvious way to connect these is glue code: each Lambda function calls the next, or drops a message on the next queue. Then the process exists only as a chain of calls spread over several code bases. Each function needs its own retries and timeouts, a wait for an approval has to be kept somewhere for days, nobody can see where order o-982 stopped, and a failure halfway leaves stock reserved for an order that will never be paid.

AWS Step Functions is AWS's managed workflow service. You write the process down once as a state machine in the Amazon States Language (ASL), a JSON format, and Step Functions runs every execution of it: it calls the services, passes data from one step to the next, retries and catches errors as the definition says, waits for as long as needed and records every step. The functions go back to doing one job each.

## How it works

### States and executions

- A state machine is a JSON document. `StartAt` names the first state and `States` holds the states by name; each one has a `Type` and usually a `Next`. The definition can be up to 1 MB, and the console's Workflow Studio draws and edits it as a graph.
- **Task** does the work: it calls an AWS service, an HTTPS API or an activity worker. **Choice** branches on the data, **Parallel** runs a fixed set of branches at the same time and continues when all of them have finished, **Map** runs the same steps for every item in a list, **Wait** pauses for a number of seconds or until a timestamp, **Pass** passes or reshapes data without doing any work, and **Succeed** and **Fail** end the execution.
- **Map** has two modes. *Inline* runs up to 40 iterations at once inside the parent execution, and their events go into its history. *Distributed* runs each item, or batch of items, as a child execution with its own history, up to 10,000 in parallel, and can read its items straight from Amazon S3 (CSV, JSON Lines, Parquet and Athena manifests, among others).
- An **execution** is one run with one JSON input. Acme names each execution after its order (`o-981`). For a Standard state machine, `StartExecution` with the same name and input as a running execution returns the original response instead of starting a second one, a different input or a closed execution gets `ExecutionAlreadyExists`, and the name can be used again 90 days after the execution closes.
- Every state machine is either **Standard** or **Express** (below), and the type cannot be changed later.

### Calling services

A Task state names what it calls in its `Resource`:

- **Optimized integrations** (about twenty services, among them Lambda, DynamoDB, ECS and Fargate, SNS, SQS, EventBridge, AWS Batch, AWS Glue, Athena, SageMaker AI and Amazon Bedrock) have resources such as `arn:aws:states:::dynamodb:updateItem`, with extra handling: Lambda's JSON result is parsed, and with `.sync` an ECS `RunTask` that reports failures fails the task. The DynamoDB integration covers `GetItem`, `PutItem`, `UpdateItem` and `DeleteItem`, which is how ReserveStock and ReleaseStock change the Stock table with no function in between.
- **AWS SDK integrations** (`arn:aws:states:::aws-sdk:service:action`) call almost any API of over 200 AWS services with the SDK's own parameters. In March 2026 AWS added 28 more services, among them Amazon Bedrock AgentCore and S3 Vectors.
- An **HTTP Task** (`arn:aws:states:::http:invoke`) calls an HTTPS API outside AWS. It takes its credentials from an EventBridge connection and must get its answer within 60 seconds. Acme keeps the payment call in the charge-card function instead, where the provider's SDK and its error codes live.
- **Activities** are your own workers that poll Step Functions with `GetActivityTask` and report back.

Each call follows one of three integration patterns:

| Pattern | Resource ends with | Step Functions moves on | Used in PlaceOrder |
|---|---|---|---|
| Request Response | nothing (the default) | as soon as the service answers the call | ValidateOrder, ReserveStock, ChargeCard, SendConfirmation |
| Run a Job | `.sync` | when the job has finished: the ECS task has stopped, the Batch or Glue job has ended | ArrangeShipping (`ecs:runTask.sync`) |
| Wait for Callback | `.waitForTaskToken` | when someone calls `SendTaskSuccess` or `SendTaskFailure` with the task token | WaitForApproval (`sqs:sendMessage.waitForTaskToken`) |

For `.sync` calls in the same account, Step Functions follows the job with EventBridge events and polling. If such a task is abandoned (the execution is stopped, or another branch of its Parallel state fails), Step Functions tries to stop the job, but only on a best-effort basis.

Here are ReserveStock and ChargeCard as PlaceOrder defines them, in JSONata (see the next section):

```json
{
  "ReserveStock": {
    "Type": "Task",
    "Resource": "arn:aws:states:::dynamodb:updateItem",
    "Arguments": {
      "TableName": "Stock",
      "Key": { "sku": { "S": "{% $states.input.sku %}" } },
      "UpdateExpression": "SET available = available - :qty",
      "ConditionExpression": "available >= :qty",
      "ExpressionAttributeValues": { ":qty": { "N": "{% $string($states.input.qty) %}" } }
    },
    "Output": "{% $states.input %}",
    "Next": "ChargeCard"
  },
  "ChargeCard": {
    "Type": "Task",
    "Resource": "arn:aws:states:::lambda:invoke",
    "Arguments": { "FunctionName": "charge-card", "Payload": "{% $states.input %}" },
    "Assign": { "chargeId": "{% $states.result.Payload.chargeId %}" },
    "Output": "{% $states.input %}",
    "TimeoutSeconds": 30,
    "Retry": [ {
      "ErrorEquals": [ "Payment.Timeout" ],
      "IntervalSeconds": 2, "BackoffRate": 2, "MaxAttempts": 2
    } ],
    "Catch": [ {
      "ErrorEquals": [ "States.ALL" ],
      "Output": "{% $merge([$states.input, { 'error': $states.errorOutput }]) %}",
      "Next": "ReleaseStock"
    } ],
    "Next": "NeedsApproval"
  }
}
```

When the stock is short, the condition makes `UpdateItem` fail with `DynamoDB.ConditionalCheckFailedException`, which a Catch on ReserveStock can send to an out-of-stock path. The Choice state that follows ChargeCard is one rule: `"Condition": "{% $states.input.total > 50000 %}"` goes to WaitForApproval, and everything else to its `Default`, Fulfil.

### Data between states

- Each state's output becomes the next state's input, and every input or output is limited to **256 KiB** (as of October 2026). Larger data goes to S3 and travels as a key, the [Claim Check](../claim-check/) pattern; an oversized result fails the state with `States.DataLimitExceeded`.
- The `QueryLanguage` field picks how a state selects and shapes data, for the whole state machine or state by state. With **JSONata** a state has two fields, `Arguments` (what to send) and `Output` (what to pass on), whose values can hold expressions in `{% %}` over `$states.input`, `$states.result`, `$states.errorOutput` (in a Catch) and `$states.context` (the execution's name, start time and task token). **JSONPath** uses five fields instead (`InputPath`, `Parameters`, `ResultSelector`, `ResultPath`, `OutputPath`). JSONPath is still the default when the field is left out, but since JSONata arrived in November 2024 AWS recommends it for new workflows; PlaceOrder uses it throughout.
- **Variables** (also November 2024) keep a value for any later state, not just the next one. ChargeCard's `Assign` stores `chargeId` from the Lambda result, and SendConfirmation can read `$chargeId` three states later while the order itself flows on unchanged. Variables live in the scope of their state machine: Parallel branches and Map iterations can read outer variables but keep their own, and a Distributed Map cannot read outer ones. One variable, and one `Assign`, can hold up to 256 KiB, and all variables of an execution up to 10 MiB.

### Errors, retries and timeouts

- Errors have names. A Lambda function's exception type becomes the error name (charge-card throws `Payment.Timeout`), service errors carry a prefix such as `Lambda.ServiceException` or `DynamoDB.ConditionalCheckFailedException`, and Step Functions has its own: `States.Timeout`, `States.HeartbeatTimeout`, `States.TaskFailed`, `States.DataLimitExceeded` and the wildcard `States.ALL`.
- **Retry** (on Task, Parallel and Map states) matches errors by name and tries again: `IntervalSeconds` before the first retry (1 by default), multiplied by `BackoffRate` (2 by default) each time, for `MaxAttempts` retries (3 by default; 0 means never). `MaxDelaySeconds` caps the wait and `JitterStrategy` `FULL` randomizes it, which spreads out retries from many executions; this is [Retry with Backoff](../retry-with-backoff/) without writing it. ChargeCard's `MaxAttempts` 2 means three attempts in all, with waits of 2 s and 4 s, as in step 3.
- **Catch** takes over when the retries are used up: it sends the execution to a fallback state together with the error output, an object with `Error` and `Cause`. In PlaceOrder that state is ReleaseStock, the [compensating transaction](../compensating-transaction/) for ReserveStock, followed by the Fail state OrderFailed, whose `Error` and `Cause` become the execution's failure. `States.ALL` does not catch `States.DataLimitExceeded` or `States.Runtime`; name them explicitly where they matter.
- **Timeouts.** A Task waits up to 99,999,999 seconds by default, so set `TimeoutSeconds` on every Task, or a lost callback leaves the execution waiting for a year. Workers that run long can call `SendTaskHeartbeat`, and `HeartbeatSeconds` fails the task with `States.Timeout` when the heartbeats stop.
- In a **Parallel** state, a branch that fails without being caught fails the whole state and stops the other branches; Lambda functions already running carry on regardless.

### Waiting for people and other systems

WaitForApproval sends the order and a **task token** to the queue `approvals` and pauses. Acme's back-office app reads the queue, shows the order to an approver and, when they decide, calls `SendTaskSuccess` (or `SendTaskFailure`) with the token. A Standard execution can wait like this for up to a year, and since Standard workflows are billed per state transition rather than by time, the wait itself adds nothing to the bill. The task carries a 3-day `TimeoutSeconds` that a Catch could turn into an automatic rejection. The token only works when it is returned by a principal in the same AWS account. Task tokens cannot be used in Express workflows.

```json
{
  "WaitForApproval": {
    "Type": "Task",
    "Resource": "arn:aws:states:::sqs:sendMessage.waitForTaskToken",
    "Arguments": {
      "QueueUrl": "https://sqs.us-east-1.amazonaws.com/111122223333/approvals",
      "MessageBody": {
        "orderId": "{% $states.input.orderId %}",
        "total": "{% $states.input.total %}",
        "taskToken": "{% $states.context.Task.Token %}"
      }
    },
    "Output": "{% $states.input %}",
    "TimeoutSeconds": 259200,
    "Next": "Fulfil"
  }
}
```

```sh
# the Orders API starts an execution named after the order
aws stepfunctions start-execution \
  --state-machine-arn arn:aws:states:us-east-1:111122223333:stateMachine:PlaceOrder \
  --name o-983 \
  --input '{"orderId":"o-983","sku":"LT-900","qty":1,"total":68400}'

# later, the back-office app reports the approver's decision with the token from the message
aws stepfunctions send-task-success \
  --task-token "$TASK_TOKEN" \
  --task-output '{"approved":true}'
```

### Standard and Express

| | Standard | Express |
|---|---|---|
| Longest execution | 1 year | 5 minutes |
| Execution semantics | exactly once: a state runs again only when a Retry says so | asynchronous: at least once; synchronous (`StartSyncExecution`): at most once |
| Execution history | kept by Step Functions for 90 days (30 on request), up to 25,000 events, readable with `GetExecutionHistory` | not kept; only what you send to [CloudWatch](../amazon-cloudwatch/) Logs, which is delivered on a best-effort basis |
| Integration patterns | Request Response, `.sync`, `.waitForTaskToken`; activities; Distributed Map | Request Response only |
| Start rate (default) | `StartExecution`: bursts of 1,300, then 300 per second in N. Virginia, Oregon and Ireland (800 and 150 elsewhere) | 6,000 per second |
| State transitions | 5,000 per second in those three Regions, 800 elsewhere (raisable) | no limit |
| Redrive | yes, for 14 days | no (but the Express children of a Distributed Map can be redriven) |
| Price (US East, October 2026) | $0.025 per 1,000 state transitions | $1.00 per million requests plus duration, by memory |

All rates above are per account and Region, and new accounts start with lower state transition quotas. Standard suits the order itself: long, auditable and full of steps that must not run twice, such as charging a card. Express suits high-volume, short work such as processing events or IoT data, where each step is idempotent. The two combine: AWS recommends keeping the non-idempotent steps in a Standard parent and nesting an Express workflow for a burst of idempotent ones.

### Redrive, versions and aliases

- **Redrive** (`RedriveExecution`, November 2023) restarts a failed, aborted or timed-out Standard execution within 14 days of its end. It resumes at the step that did not succeed, with the same input and the same definition, and does not repeat the steps that succeeded; in a Parallel state, only the failed branches run again, and retry counters start over. Had ArrangeShipping failed without a Catch, a redrive after the fix would book the courier without charging the card a second time. An execution that already compensated and ended in a Fail state, like o-982, is better started again once the provider is back.
- **Versions** are numbered, immutable snapshots of a state machine (up to 1,000), and an **alias** such as `PROD` points to one version, or splits new executions between two by weight (up to 100 aliases). Starting executions through the alias lets a new version take 10% of orders first, a [canary release](../canary-release/), and every execution, redrives included, stays on the version it started with.

### Testing

The `TestState` API runs one state, given on its own or picked out of a whole definition with `stateName`, without deploying anything, and reports its output, its next state and, at the `DEBUG` level, each step of the data processing. Since November 2025 it accepts a **mock** of the service's result or error, so a test needs neither the real service nor an IAM role, and it can also test Map, Parallel, `.sync` and callback states, and a chosen retry attempt. Step Functions Local, the downloadable emulator, is no longer supported.

```sh
# with both retries used up, a timeout from the provider should go to the Catch
aws stepfunctions test-state \
  --definition file://place-order.asl.json --state-name ChargeCard \
  --input '{"orderId":"o-982","sku":"MS-310","qty":1,"total":420}' \
  --mock '{"errorOutput": {"error": "Payment.Timeout", "cause": "no answer from the provider"}}' \
  --state-configuration '{"retrierRetryCount": 2}'
# expected: "status": "CAUGHT_ERROR", "nextState": "ReleaseStock"
```

### Observing executions

- The **execution history** of a Standard execution lists every event: each state entered and exited with its input and output and the variables it assigned, each task scheduled, started, succeeded or failed. The console draws it on the graph, so support staff can open o-982 and see where it failed and why.
- **CloudWatch Logs** receive the history at a chosen level (`ALL`, `ERROR`, `FATAL` or `OFF`), with or without the data (`includeExecutionData`); Express workflows have no other record. **CloudWatch metrics** count executions started, succeeded, failed, timed out and throttled, and open executions against the account's limit, and since October 2025 the console shows them, with billing figures, on a metrics dashboard.
- **AWS X-Ray** traces an execution together with the Lambda functions and services it calls, and Standard workflows send **EventBridge** events on every status change, which a team can route to an alarm or to the waiting client.

### Pricing

As of October 2026 in US East (N. Virginia):

- **Standard:** $0.025 per 1,000 state transitions after a free tier of 4,000 a month, which does not expire. Each state that runs counts, and so does each retry and each redrive. A workflow that takes ten transitions per order costs about $25 for 100,000 orders a month.
- **Express:** $1.00 per million executions, plus duration at $0.00001667 per GB-second for the first 1,000 GB-hours a month, rounded up to 100 ms and billed in 64 MB steps of memory, which depends on the size of the definition and the data. A million 30-second executions at 64 MB come to about $31 of duration.
- On top come the services the workflow calls (Lambda, DynamoDB, ECS) and CloudWatch Logs.

## Where it fits

- **Solutions:** order and payment workflows like PlaceOrder; approval and other human-in-the-loop processes; data and ETL pipelines that run a Distributed Map over millions of S3 objects; machine learning and media pipelines (SageMaker AI, MediaConvert); IT and security automation; and AI workflows that call Amazon Bedrock models, or, since June 2026, a Bedrock AgentCore agent as a step (the managed harness behind it is in preview).
- **Patterns it implements or supports:** [Saga (Orchestration)](../saga-orchestration/), with Step Functions as the orchestrator and Catch states running each [Compensating Transaction](../compensating-transaction/) (steps 1 and 3); [Retry with Backoff](../retry-with-backoff/) and [Timeout and Fallback](../timeout-and-fallback/) as Retry, `TimeoutSeconds` and Catch; [Asynchronous Request-Reply](../asynchronous-request-reply/), since `StartExecution` returns at once and the client polls `DescribeExecution` or listens for the status-change event; [Pipes and Filters](../pipes-and-filters/) as a chain of Task states that each transform the data; and [Claim Check](../claim-check/) for anything over 256 KiB. Steps of an Express workflow, and any step a Retry repeats, should be [idempotent](../idempotent-consumer/).
- **Usual neighbours:** API Gateway or a Lambda function that starts executions; [EventBridge](../amazon-eventbridge/) rules and EventBridge Scheduler, which starts executions on a cron or rate schedule; the services it calls, such as [Lambda](../aws-lambda/), [DynamoDB](../amazon-dynamodb/), [SQS](../amazon-sqs/), [SNS](../amazon-sns/), [ECS and Fargate](../amazon-ecs/), AWS Batch, AWS Glue and [S3](../amazon-s3/); CloudWatch and X-Ray; and an [IAM](../aws-iam/) execution role that holds the state machine's permissions.
- **Managed offerings:** Step Functions is itself the managed service. Its closest relatives elsewhere are Amazon MWAA, which runs Apache Airflow (versions up to 3.3.1 as of September 2026), Temporal Cloud for Temporal, and, inside Lambda, Lambda durable functions. Other clouds offer Azure Durable Functions and Google Cloud Workflows.

## When to use it

Use Step Functions when a business process spans several services and steps, has to survive failures halfway, may wait minutes to months, and someone needs to see where each run stands. It fits AWS-heavy systems best, since most AWS APIs are one Task state away. Look elsewhere when the workflow logic is complex enough to want a real programming language, when the system must also run outside AWS, for scheduled batch data pipelines that a data team maintains in Python, and for tight loops of tiny steps, where every transition costs money and history.

| | You write the flow as | Where the progress is kept | Long waits | Choose it for |
|---|---|---|---|---|
| **AWS Step Functions** | a JSON state machine (ASL), or a graph in Workflow Studio | by the service: the history of each Standard execution, 25,000 events | up to a year (Standard), task tokens for callbacks | orchestrating AWS services, approvals, sagas, processes that must be audited |
| **Temporal** | ordinary code (Go, Java, Python, TypeScript, .NET and more); MIT-licensed, self-hosted or Temporal Cloud | an event history that is replayed into the workflow code, up to 51,200 events or 50 MB per execution | timers and signals; workflows can run for years | complex, code-first long-running workflows, on any cloud |
| **Apache Airflow** (Amazon MWAA) | Python DAGs; Apache License 2.0 | a metadata database of DAG and task runs | scheduled or event-triggered runs, not per request | scheduled data pipelines, ETL and ML training |
| **Lambda durable functions** | code in one Lambda function, with a durable execution SDK (JavaScript, TypeScript, Python, Java) | checkpoints that are replayed after a pause or a crash | up to a year, and a wait costs no compute | workflows that are mostly Lambda code |
| **Lambda functions chained by queues** | each function sends work to the next queue | nowhere in particular: your own logs and tables | only what you build | two or three steps, where a workflow service would be overhead |

## Trade-offs

- **The process is visible and durable.** Every Standard execution has a graph and a complete history, and the platform keeps the state, the retries and the waits, so the functions stay small. In return the flow lives in a JSON definition rather than in code, where reviews, refactoring and type checks are weaker than for a program; the CDK and similar tools can generate the definition from code.
- **Limits shape the design.** 256 KiB per input or output, 25,000 events per Standard history (an Inline Map over thousands of items reaches it), 5 minutes per Express execution and a 1 MB definition. Large data moves by reference, and long loops move to Distributed Map or to a fresh execution.
- **Cost follows the number of steps.** Standard charges per transition, retries included, which is little for a ten-step order and a lot for a workflow that loops over many small steps; Express is cheaper there but gives up the history, `.sync`, task tokens and exactly-once semantics.
- **Throughput has quotas.** Start and transition rates are throttled per account and Region with soft limits, and Standard allows a million open executions per Region; very large bursts need Express, batching or a quota increase.
- **Exactly once has edges.** It covers Step Functions' own transitions. A Retry repeats a call on purpose, a Lambda function or ECS task that was aborted may still finish, and an asynchronous Express execution may run twice, so the steps that change data need to tolerate a repeat.
- **It is AWS-only.** The service runs only in AWS and its integrations call AWS APIs. The ASL specification is public, but leaving AWS still means rewriting or re-hosting the workflows, while Temporal and Airflow run anywhere.

## Implementation notes

- **Set timeouts everywhere:** `TimeoutSeconds` on each Task (the default is 99,999,999 seconds), a timeout on the whole state machine where it makes sense, and `HeartbeatSeconds` for long workers.
- **Retry the right errors:** add the Lambda service errors AWS recommends retrying (`Lambda.ServiceException`, `Lambda.AWSLambdaException`, `Lambda.SdkClientException`, `Lambda.ClientExecutionTimeoutException`), use backoff with `MaxDelaySeconds` and `JitterStrategy`, and keep `States.ALL` for the last catcher.
- **Compensate explicitly:** give each step that changes something an undo state, route Catch to it, and end in a Fail state with an `Error` and `Cause` that support staff can act on; keep secrets and internal details out of `Cause`.
- **Name executions after a business key** such as the order ID, so a retried `StartExecution` cannot start the same order twice (in a Standard workflow, until 90 days after the execution closes).
- **Pass references, not documents:** S3 keys for anything that might grow past 256 KiB, and variables instead of carrying every result in the payload.
- **Watch the history size:** use Distributed Map for large lists, or start a new execution to continue a long-running loop before it reaches 25,000 events.
- **Deploy with versions and aliases,** define state machines as code (CloudFormation, SAM, CDK or Terraform; the console exports CloudFormation and SAM templates), and test each state with `TestState` and mocks before deploying.
- **Grant the execution role only what it calls,** encrypt with a customer managed KMS key where policy requires it, and log at `ERROR` level, or without execution data, when the payloads hold personal data.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Saga (Orchestration)](../saga-orchestration/) — A coordinator runs local transactions in sequence and triggers compensations when one fails.
- [Compensating Transaction](../compensating-transaction/) — Undo the completed steps of a multi-step operation that failed part-way.
- [AWS Lambda](../aws-lambda/) — Functions as a service: code runs per event in managed execution environments that scale out with concurrency.
- [Retry with Backoff & Jitter](../retry-with-backoff/) — Retry transient failures with growing, randomised delays so clients don't stampede.
- [Asynchronous Request-Reply](../asynchronous-request-reply/) — Accept now with 202, process in the background, and let the client poll a status URL.
- [Amazon SQS](../amazon-sqs/) — A managed message queue: consumers poll, a visibility timeout hides messages in flight, and repeated failures go to a dead-letter queue.
- [Amazon DynamoDB](../amazon-dynamodb/) — A serverless key-value and document database: the partition key spreads items across partitions for single-digit-millisecond reads.
- [Pipes and Filters](../pipes-and-filters/) — Split processing into independent stages connected by channels.

## References

- [AWS Step Functions Developer Guide — What is Step Functions?](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html)
- [AWS Step Functions — Choosing workflow type (Standard or Express)](https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html)
- [AWS Step Functions — Using Amazon States Language to define workflows](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-amazon-states-language.html)
- [Amazon States Language specification](https://states-language.net/spec.html)
- [AWS Step Functions — Workflow states](https://docs.aws.amazon.com/step-functions/latest/dg/workflow-states.html)
- [AWS Step Functions — Task workflow state](https://docs.aws.amazon.com/step-functions/latest/dg/state-task.html)
- [AWS Step Functions — Choice workflow state](https://docs.aws.amazon.com/step-functions/latest/dg/state-choice.html)
- [AWS Step Functions — Parallel workflow state](https://docs.aws.amazon.com/step-functions/latest/dg/state-parallel.html)
- [AWS Step Functions — Map state in Inline mode](https://docs.aws.amazon.com/step-functions/latest/dg/state-map-inline.html)
- [AWS Step Functions — Map state in Distributed mode](https://docs.aws.amazon.com/step-functions/latest/dg/state-map-distributed.html)
- [AWS Step Functions — Wait workflow state](https://docs.aws.amazon.com/step-functions/latest/dg/state-wait.html)
- [AWS Step Functions — Fail workflow state](https://docs.aws.amazon.com/step-functions/latest/dg/state-fail.html)
- [AWS Step Functions — Integrating services](https://docs.aws.amazon.com/step-functions/latest/dg/integrate-services.html)
- [AWS Step Functions — Service integration patterns (Request Response, .sync, .waitForTaskToken)](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html)
- [AWS Step Functions — Integrating optimized services](https://docs.aws.amazon.com/step-functions/latest/dg/integrate-optimized.html)
- [AWS Step Functions — AWS SDK integrations](https://docs.aws.amazon.com/step-functions/latest/dg/supported-services-awssdk.html)
- [AWS Step Functions — Call HTTPS APIs (HTTP Task)](https://docs.aws.amazon.com/step-functions/latest/dg/call-https-apis.html)
- [AWS Step Functions — Perform DynamoDB CRUD operations](https://docs.aws.amazon.com/step-functions/latest/dg/connect-ddb.html)
- [AWS Step Functions — Run Amazon ECS or Fargate tasks](https://docs.aws.amazon.com/step-functions/latest/dg/connect-ecs.html)
- [AWS Step Functions — Invoke a Lambda function](https://docs.aws.amazon.com/step-functions/latest/dg/connect-lambda.html)
- [AWS Step Functions — Publish messages to an Amazon SNS topic](https://docs.aws.amazon.com/step-functions/latest/dg/connect-sns.html)
- [AWS Step Functions — Transforming data with JSONata](https://docs.aws.amazon.com/step-functions/latest/dg/transforming-data.html)
- [AWS Step Functions — Passing data between states with variables](https://docs.aws.amazon.com/step-functions/latest/dg/workflow-variables.html)
- [AWS Step Functions — Accessing execution data from the Context object](https://docs.aws.amazon.com/step-functions/latest/dg/input-output-contextobject.html)
- [AWS Step Functions — Handling errors in Step Functions workflows](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)
- [AWS Step Functions — Handling error conditions (tutorial)](https://docs.aws.amazon.com/step-functions/latest/dg/tutorial-handling-error-conditions.html)
- [AWS Step Functions — Deploying a workflow that waits for human approval](https://docs.aws.amazon.com/step-functions/latest/dg/tutorial-human-approval.html)
- [AWS Step Functions — Restarting executions with redrive](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html)
- [AWS Step Functions — State machine versions](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-state-machine-version.html)
- [AWS Step Functions — State machine aliases](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-state-machine-alias.html)
- [AWS Step Functions — Testing state machines with the TestState API](https://docs.aws.amazon.com/step-functions/latest/dg/test-state-isolation.html)
- [AWS Step Functions — Step Functions Local (unsupported)](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-local.html)
- [AWS Step Functions — Viewing execution details in the console](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-view-execution-details.html)
- [AWS Step Functions — Logging in CloudWatch Logs](https://docs.aws.amazon.com/step-functions/latest/dg/cw-logs.html)
- [AWS Step Functions — Metrics in CloudWatch](https://docs.aws.amazon.com/step-functions/latest/dg/procedure-cw-metrics.html)
- [AWS Step Functions — Trace data in AWS X-Ray](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-xray-tracing.html)
- [AWS Step Functions — Automating event delivery with EventBridge](https://docs.aws.amazon.com/step-functions/latest/dg/eventbridge-integration.html)
- [AWS Step Functions — Using EventBridge Scheduler to start executions](https://docs.aws.amazon.com/step-functions/latest/dg/using-eventbridge-scheduler.html)
- [AWS Step Functions — Best practices](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-best-practices.html)
- [AWS Step Functions — Service quotas](https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html)
- [AWS Step Functions — Recent feature launches](https://docs.aws.amazon.com/step-functions/latest/dg/recent-launches.html)
- [AWS Step Functions API Reference — StartExecution](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html)
- [AWS Step Functions API Reference — SendTaskSuccess](https://docs.aws.amazon.com/step-functions/latest/apireference/API_SendTaskSuccess.html)
- [AWS Step Functions API Reference — SendTaskHeartbeat](https://docs.aws.amazon.com/step-functions/latest/apireference/API_SendTaskHeartbeat.html)
- [AWS Step Functions API Reference — RedriveExecution](https://docs.aws.amazon.com/step-functions/latest/apireference/API_RedriveExecution.html)
- [AWS Step Functions API Reference — TestState](https://docs.aws.amazon.com/step-functions/latest/apireference/API_TestState.html)
- [AWS Step Functions API Reference — StateExitedEventDetails (assigned variables)](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StateExitedEventDetails.html)
- [AWS CLI — aws stepfunctions start-execution](https://docs.aws.amazon.com/cli/latest/reference/stepfunctions/start-execution.html)
- [AWS CLI — aws stepfunctions send-task-success](https://docs.aws.amazon.com/cli/latest/reference/stepfunctions/send-task-success.html)
- [AWS CLI — aws stepfunctions test-state](https://docs.aws.amazon.com/cli/latest/reference/stepfunctions/test-state.html)
- [AWS Step Functions pricing](https://aws.amazon.com/step-functions/pricing/)
- [AWS Compute Blog — Simplifying developer experience with variables and JSONata in AWS Step Functions (Nov 2024)](https://aws.amazon.com/blogs/compute/simplifying-developer-experience-with-variables-and-jsonata-in-aws-step-functions/)
- [AWS What's New (Jun 2023) — AWS Step Functions launches Versions and Aliases](https://aws.amazon.com/about-aws/whats-new/2023/06/aws-step-functions-versions-aliases/)
- [AWS What's New (Nov 2023) — HTTPS endpoints and the TestState API](https://aws.amazon.com/about-aws/whats-new/2023/11/aws-step-functions-https-endpoints-teststate-api/)
- [AWS What's New (Sep 2025) — Distributed Map adds Athena manifests and Parquet](https://aws.amazon.com/about-aws/whats-new/2025/09/aws-step-functions-data-source-options-observability-distributed-map/)
- [AWS What's New (Oct 2025) — AWS Step Functions announces a new metrics dashboard](https://aws.amazon.com/about-aws/whats-new/2025/10/aws-step-functions-metrics-dashboard/)
- [AWS What's New (Mar 2026) — AWS Step Functions adds 28 new service integrations, including Amazon Bedrock AgentCore](https://aws.amazon.com/about-aws/whats-new/2026/03/aws-step-functions-sdk-integrations/)
- [AWS What's New (Jun 2026) — AWS Step Functions adds AgentCore-powered agentic reasoning step](https://aws.amazon.com/about-aws/whats-new/2026/06/aws-step-functions-agentcore/)
- [AWS Lambda — Lambda durable functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html)
- [AWS Lambda — Durable functions or Step Functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-step-functions.html)
- [Temporal — What is Temporal?](https://docs.temporal.io/temporal)
- [Temporal — Workflow Execution limits](https://docs.temporal.io/workflow-execution/limits)
- [Temporal — About Temporal SDKs](https://docs.temporal.io/encyclopedia/temporal-sdks)
- [Temporal — temporalio/temporal on GitHub (MIT License)](https://github.com/temporalio/temporal)
- [Apache Airflow — What is Airflow?](https://airflow.apache.org/docs/apache-airflow/stable/index.html)
- [Amazon MWAA — Apache Airflow versions](https://docs.aws.amazon.com/mwaa/latest/userguide/airflow-versions.html)
- [Microsoft Learn — Durable Functions overview](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-overview)
- [Google Cloud — Workflows overview](https://cloud.google.com/workflows/docs/overview)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
