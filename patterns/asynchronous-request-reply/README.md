<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [📨 Messaging & Integration](../../README.md#messaging--integration)

# Asynchronous Request-Reply

> Accept now with 202, process in the background, and let the client poll a status URL.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Asynchronous Request-Reply" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/asynchronous-request-reply.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · A long synchronous call** | The client sends `POST /reports` and waits for the PDF. Rendering takes about two minutes, but the gateway in front of the API gives up after 30 seconds and answers **504 Gateway Timeout**. Nothing stops the API, so it keeps rendering copy #1 for nobody, and the client's retry starts copy #2: twice the work, and still no report. |
| **2 · Accept now, work later** | The API validates the request (a bad one still gets its `400` right away), saves a job record in state `queued` and puts the job on a queue. Then it answers at once: **202 Accepted** with a `Location` header that points at the job's status URL, `/jobs/42`, a `Retry-After: 5` hint and the job in the body. A worker takes the job from the queue and starts rendering, and no connection is held open while it works. |
| **3 · Poll the status** | Following `Retry-After`, the client sends `GET /jobs/42` every 5 seconds, and the API answers from the job record: `200` with the state (`running`) and the progress. The worker stores the PDF in object storage and only then marks the job `succeeded`. The next poll gets **303 See Other** with `Location: /reports/42`, and the client downloads the report from there. |
| **4 · Make it robust** | The next request carries an `Idempotency-Key`. Its 202 is lost, so the client retries with the same key and gets job 43 back instead of a second job (the same idea as an [idempotent consumer](../idempotent-consumer/)), and `DELETE /jobs/43` then cancels it. Every job ends as `succeeded`, `failed` with a reason, or `cancelled`, so no client polls forever; job records and results are deleted 24 hours after the end, and a client that can take calls can get a [webhook](../webhooks/) instead of polling. |
<!-- END GENERATED: header -->

## The problem

Some requests start work that takes minutes: rendering a report, exporting a year of orders, transcoding a video, provisioning an environment. Over a plain request and response, the client has to keep its connection open for all of that time, and every hop on the way has its own idea of how long a request may take. A few published limits, as examples (checked in October 2026):

- **Amazon API Gateway** gives a REST API integration between 50 ms and 29 s by default. Regional and private APIs can ask for more, which may lower the account's throttle quota; HTTP APIs stop at 30 s.
- **Heroku's router** ends a request whose response hasn't started within 30 s, and the limit can't be changed.
- **Google Cloud load balancers** use a backend service timeout of 30 s unless you set another.
- **Cloudflare** waits 125 s for the origin by default and then answers with error 524.
- **Azure Functions:** an HTTP-triggered function must answer within 230 s, whatever its own timeout says, because of the idle timeout of the Azure Load Balancer in front of it.

Browsers, HTTP client libraries, corporate proxies and mobile networks add limits of their own, and the shortest one on the path wins. When it fires, the gateway answers `504 Gateway Timeout`, but the server behind it usually carries on: Heroku's documentation points out that the application isn't told about the timeout and keeps working on the request. Its result is then thrown away.

That is only the first cost:

- **Held resources.** Every waiting request occupies a connection on each hop and server capacity (memory, CPU, often a thread or a database connection) for the whole duration. A few slow endpoints can use up a pool that thousands of fast requests share, and every deployment has to wait for them or cut them off.
- **Retries that duplicate work.** A timeout tells the client nothing about whether the work happened. It retries, and the server starts the same report again while the first copy is still running. For an export that wastes capacity; for an order or a payment it does the thing twice.
- **No progress and no way out.** The client learns the outcome at the end or not at all, and it can't cancel work it no longer needs.

Raising every timeout to three minutes doesn't fix this. Some limits can't be raised, they differ from hop to hop, and a connection held for minutes still breaks when a phone goes to sleep or a server is redeployed.

## How it works

Split the one long call into a short call that starts the work and a series of short calls that ask how it is going.

1. **Start.** `POST /reports` reaches the API, which validates the request (a bad one still gets its `400` while the client is listening), stores a job record in state `queued`, puts the job on a durable queue and answers at once with **`202 Accepted`**. The response carries the job's status URL in `Location`, a polling hint in `Retry-After` and the job itself in the body.
2. **Work.** A worker takes the job from the queue, records `running` and its progress in the job store as it goes, writes the finished report to object storage, and only then marks the job `succeeded`, or `failed` with a reason.
3. **Poll.** After the suggested delay the client sends `GET /jobs/42`. While the job runs, the answer is `200` with its state and progress, read from the job record, so a poll never waits for the work. Once the job has succeeded, the status resource answers **`303 See Other`** with `Location: /reports/42`, and the client fetches the report from there.

Every request is now short. The long work runs in workers that can be scaled, retried and deployed on their own schedule.

### The contract, checked against RFC 9110

| Element | What RFC 9110 says | How the pattern uses it |
|---|---|---|
| [`202 Accepted`](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.3) | The request has been accepted for processing but isn't finished, and might still be refused when it is processed. The code is deliberately noncommittal, and HTTP has no way to send another status code when the work ends. The response body ought to describe the current status and link to (or embed) a status monitor. | Send it once the job is durably recorded and queued, not before. Put the job, with its status URL, in the body. |
| [`Location`](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.2) | Its meaning depends on the method and the status code. RFC 9110 defines it for `201 Created` (the new resource) and for redirects (the target). | On a `202` the meaning is a convention, not a rule: Azure's pattern and Durable Functions use `Location`, while the Azure REST API guidelines use an `Operation-Location` header. Document which one you send, and repeat the link in the body. |
| [`Retry-After`](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3) | How long the client ought to wait before its follow-up request, as a number of seconds or an HTTP date. | The polling interval. Send it with the `202` and with every status answer that isn't final. |
| [`303 See Other`](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.4) | A redirect to a different resource that serves as an indirect answer; the client retrieves it with `GET` (or `HEAD`), whatever method it used. A `302 Found` lets the client change `POST` to `GET` or keep it, and `307` always keeps it. | The finished status resource redirects to the result. Azure's guidance recommends `303` for exactly this reason: a client that replays its original method on a `302` could send a `POST` again. |
| [`504 Gateway Timeout`](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.6.5) | A gateway or proxy didn't get a timely answer from the server behind it. | What the synchronous version runs into. |

A redirect isn't the only way to finish. The status resource can also answer `200` with `"state": "succeeded"` and a link to the result, which the client then follows itself. That keeps the final status readable, which matters when many HTTP clients follow a `303` automatically and the code that polls never sees the status body. Pick one and document it.

### The status resource

- **States.** `queued`, then `running`, then exactly one final state: `succeeded`, `failed` or `cancelled`. A final state never changes, and every job must reach one, because that is what tells a client to stop polling. Names vary between platforms (see below); what matters is a small, documented set.
- **Fields.** The ID, the state, when the job was created and last updated, progress when the worker can estimate it, a link to the result once it has succeeded, and an error once it has failed. [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) problem details are a good shape for the error. The last-updated time also tells a client whether a slow job is still alive.
- **A failed job is still a successful poll.** Answer `200` with `"state": "failed"` and the error, so the client can tell a job that failed from a status service that is down. The status monitor in the Azure REST API guidelines works this way.
- **No job may hang.** A worker that crashes leaves its job `running` forever unless something notices. Let workers refresh the last-updated time as they go, run a sweeper that fails jobs that stay silent too long or pass a deadline, and cap the number of attempts, so that every job ends in a final state.
- **Who may read it.** A job's status and result are as sensitive as the request that started it. Check on every poll and every download that the caller may see this job; knowing the URL is not a permission. Use IDs that can't be guessed, such as random UUIDs (the diagram's `42` is only for readability). OWASP treats random identifiers as defence in depth that never replaces the access check. If downloads should bypass your API, hand out a short-lived signed URL to the object store; Azure's pattern mentions shared access signatures for this, which is the Valet Key pattern.
- **Keep caches out of it.** The answer changes from poll to poll, so send `Cache-Control: no-store`, and no browser or proxy cache can answer a poll with an old state. Tell clients how long a job is kept in the body (an `expiresAt` field, say) and in your documentation. Azure's pattern suggests an `Expires` header for this, but [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html) defines `Expires` as the moment a stored response becomes stale and states that it says nothing about when the resource itself will go away.

## When to use it

- Work that regularly takes longer than the shortest timeout on the path, or comes close to it: reports, exports and imports, media processing, batch inference, provisioning.
- Clients that can't receive calls, such as browsers, mobile apps and scripts behind NAT or a firewall. Polling needs only outgoing requests.
- When the client needs progress, a way to cancel, or an outcome that it can still read after a disconnect.
- When work should be accepted even while the back end is busy or being deployed. The queue holds it until a worker is free.
- **Not** for work that finishes well within the timeouts. Answer it synchronously: one request is simpler, faster and easier to debug. As thresholds, the Azure REST API guidelines make an operation long-running when its 99th-percentile time is above 1 s, and Google's AIP-151 suggests 10 s as a rule of thumb.
- **Not** when results should reach the client while they are produced (stream them with server-sent events or WebSockets), or when the client already has an event channel, such as a webhook endpoint or a message broker.

## Trade-offs

- **More moving parts.** A job store, a queue, workers, result storage, a status endpoint and clean-up jobs replace one request handler.
- **Polling costs and delay.** The client learns about the end up to one interval late, and every client polls. At one `GET` every 5 seconds, a 2-minute job costs about 24 polls, and 1,000 such jobs at once add 200 requests per second. Keep each poll cheap (one key lookup, no joins) and tune `Retry-After`.
- **A contract clients must follow.** They have to handle the `202`, find the status URL, honour `Retry-After`, stop on a final state and follow the redirect. Platform SDKs and integration tools often do this for them, which is a good reason to follow an existing convention instead of inventing one.
- **At-least-once execution.** Queues deliver a job again when a worker crashes or its lease runs out, so the same job can start twice. Workers must be idempotent: see [Idempotent Consumer](../idempotent-consumer/).
- **State to keep and to delete.** Job records, results and idempotency keys pile up unless they expire.
- **Harder to follow.** One operation spans many requests and processes. Put the job ID in every log line and trace.

## Implementation notes

- **Polling intervals and backoff.** Honour `Retry-After` when the server sends it. That lets the server spread the load and lengthen the interval for long jobs, for example to a fraction of the estimated time left. Without a hint, start short and back off (1 s, 2 s, 4 s and so on up to a cap), add jitter so that clients started together don't poll in lockstep, and give up after an overall deadline. Treat `429` or `503` with a `Retry-After` as a request to slow down, not as a failed job. It is the advice of [Retry with Backoff & Jitter](../retry-with-backoff/), applied to polls, and a client still needs its own deadline for the whole operation, as in [Timeout & Fallback](../timeout-and-fallback/).
- **Idempotency for the initial request.** `POST` isn't idempotent, and its `202` can be lost like any response, so the client can't tell "no job" from "job created, answer lost". Let it send an `Idempotency-Key` header with a random value, store the key with the job (unique per client), and answer a repeat with the original `202` and the same job, so that nothing is queued twice. Azure's pattern recommends exactly this. The IETF draft for the header (draft-ietf-httpapi-idempotency-key-header) reached version 07 in October 2025 and expired in April 2026 without becoming an RFC, but its rules make a sound default. The value is a Structured Fields string, ideally a UUID. A repeat that arrives after the first request has finished gets the first result, a repeat while the first is still being processed gets `409 Conflict`, the same key with a different body gets `422`, and a missing key where one is required gets `400`. The server publishes how long it keeps keys; Stripe's API, which works this way, may drop keys once they are 24 hours old. The Azure REST API guidelines reach the same goal with a client-chosen `Operation-Id` header and a `409` when an ID is reused for a different request. Inside the worker, the same idea protects against redelivered messages: [Idempotent Consumer](../idempotent-consumer/).
- **Where the work happens.** A durable queue between the API and the workers keeps accepted jobs safe while workers are busy, crash or are redeployed, and lets you scale the workers on the backlog: see [Queue-Based Load Leveling](../queue-based-load-leveling/) and [Competing Consumers](../competing-consumers/). Web-Queue-Worker is the application style built on this split. Two details matter. Saving the job record and enqueueing the job are two writes, and if the enqueue fails after the save, the job stays `queued` forever: write both through a [Transactional Outbox](../transactional-outbox/), or let a sweeper re-enqueue or fail old queued jobs. And store the result before marking the job `succeeded`, so the status never points at a file that isn't there yet. [Serverless](../serverless/) functions triggered by the queue make good workers for shorter jobs, within hard limits: an AWS Lambda function runs for at most 15 minutes (90 when queue-triggered on Lambda Managed Instances), and a function on the Azure Functions Consumption plan for at most 10 (5 by default). Longer jobs need checkpoints, a split into steps, an orchestrator such as Durable Functions, or containers.
- **Notifications instead of polling.** If the client can take calls, a [webhook](../webhooks/) to a URL it registered, for example in the `POST`, replaces the polling. Browsers can't take calls, but they can keep a connection open: [server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html) stream status updates from server to client over HTTP, [WebSockets](https://www.rfc-editor.org/rfc/rfc6455.html) carry messages both ways, and long polling ([RFC 6202](https://www.rfc-editor.org/rfc/rfc6202.html)) holds each poll open until something changes. Keep the status resource in every case: notifications get lost, and a client that reconnects needs a place to catch up.
- **Cancellation.** Azure's pattern cancels with `DELETE` on the status URL, as the diagram does. The Azure REST API guidelines model cancel as an action (`POST` on the status monitor's URL with `:cancel` appended). Google's Operations service has a best-effort `CancelOperation`, after which the operation ends with a `CANCELLED` error, and a separate `DeleteOperation` that only says the client no longer wants the result and cancels nothing. Pick one model and document it. Cancelling is cooperative: record the request, let the worker check for it between steps and stop, then set the state to `cancelled`. Decide what happens to partial work (keep it, undo it, or run a [Compensating Transaction](../compensating-transaction/)), and reject a cancel for a job that has already finished, for example with `409 Conflict`.
- **Clean-up.** Records and results cost storage, so give them a retention period and publish it. The Azure REST API guidelines keep a status monitor for a documented period of at least 24 hours after the operation completes; AIP-151 suggests 30 days as a rule of thumb for expiring operations. Expire result files with the object store's lifecycle rules, prune idempotency keys on the same schedule, and answer polls for expired jobs with `404 Not Found` or `410 Gone`; RFC 9110 reserves `410` for resources that are gone for good.
- **How platforms model long-running operations** (examples, checked in October 2026):
  - **Azure REST API guidelines.** A long-running action (a `POST`) answers `202` with an `Operation-Location` header that holds the absolute URL of a *status monitor*, and does so even when the work has already finished; a `PUT` that creates a resource answers `201` with the same header. The monitor has an `id`, a `status` (`NotStarted`, `Running`, `Succeeded`, `Failed` or `Canceled`), an `error` when it failed and, for actions, a `result`. Polls get `200` plus `retry-after` until the status is final, and control actions such as cancel are `POST` requests on the monitor.
  - **Google AIP-151.** A method that can take long returns a `google.longrunning.Operation`, a resource that works like a promise: a `name`, a `done` flag, `metadata` for progress, and either a `response` or an `error`. APIs don't invent their own interfaces; they implement the shared Operations service with `GetOperation`, `ListOperations`, `CancelOperation`, `DeleteOperation` and `WaitOperation`.
  - **Azure Durable Functions.** An orchestration started over HTTP answers `202` with `Location` (the status query URL), `Retry-After: 10` and a body of management URLs for status, raising events, terminating and purging history. The status URL keeps answering `202` while the orchestration runs and `200` once it has completed or failed. In .NET, an orchestrator's HTTP calls can follow this protocol automatically, and Azure Logic Apps' HTTP actions understand it too.

  The three disagree on details: `Location` or `Operation-Location`, `200` or `202` while the job runs, `DELETE` or a cancel action. None of them is wrong. Choose one convention, document it, and keep to it across your APIs.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Queue-Based Load Leveling](../queue-based-load-leveling/) — A queue absorbs traffic spikes so the backend can work at a steady pace.
- [Competing Consumers](../competing-consumers/) — Several workers pull from one queue, so work is shared and throughput scales out.
- [Webhooks](../webhooks/) — Notify subscribers by calling their HTTP endpoints, with signatures, retries and idempotency.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.
- Web-Queue-Worker *(planned)* — A web front end hands slow work to background workers through a queue.
- [Retry with Backoff & Jitter](../retry-with-backoff/) — Retry transient failures with growing, randomised delays so clients don't stampede.
- [Serverless (Functions)](../serverless/) — Functions start per event, scale out automatically and scale to zero when idle.
- [Timeout & Fallback](../timeout-and-fallback/) — Bound every remote call and degrade gracefully when the time runs out.

## References

- [Azure Architecture Center — Asynchronous Request-Reply pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/asynchronous-request-reply)
- [RFC 9110 — HTTP Semantics: 202 Accepted](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.3)
- [RFC 9110 — HTTP Semantics: 303 See Other](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.4)
- [RFC 9110 — HTTP Semantics: Retry-After](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3)
- [Microsoft Azure REST API Guidelines — Long-Running Operations & Jobs](https://github.com/microsoft/api-guidelines/blob/vNext/azure/Guidelines.md#long-running-operations--jobs)
- [Microsoft Azure REST API Guidelines — Considerations for service design: Long-Running Operations](https://github.com/microsoft/api-guidelines/blob/vNext/azure/ConsiderationsForServiceDesign.md#long-running-operations)
- [Google API Improvement Proposals — AIP-151: Long-running operations](https://google.aip.dev/151)
- [Google APIs — The google.longrunning Operations service (operations.proto)](https://github.com/googleapis/googleapis/blob/master/google/longrunning/operations.proto)
- [Azure Durable Functions — HTTP features: async operation tracking](https://learn.microsoft.com/en-us/azure/durable-task/durable-functions/durable-functions-http-features)
- [Azure Durable Functions — HTTP API reference](https://learn.microsoft.com/en-us/azure/durable-task/durable-functions/durable-functions-http-api)
- [IETF HTTPAPI WG — The Idempotency-Key HTTP Header Field (draft-ietf-httpapi-idempotency-key-header-07, an expired Internet-Draft)](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
- [Stripe API reference — Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [RFC 9457 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)
- [RFC 9111 — HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111.html)
- [Heroku Dev Center — Request Timeout](https://devcenter.heroku.com/articles/request-timeout)
- [Amazon API Gateway — Quotas for configuring and running a REST API](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-execution-service-limits-table.html)
- [Amazon API Gateway — Quotas for configuring and running an HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html)
- [Google Cloud Load Balancing — Backend services overview (backend service timeout)](https://docs.cloud.google.com/load-balancing/docs/backend-service)
- [Cloudflare Support — Error 524: a timeout occurred](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/)
- [Azure Functions — Scale and hosting (function app timeout duration)](https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale)
- [AWS Lambda — Configure Lambda function timeout](https://docs.aws.amazon.com/lambda/latest/dg/configuration-timeout.html)
- [OWASP Cheat Sheet Series — Insecure Direct Object Reference Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html)
- [WHATWG HTML Living Standard — Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [RFC 6455 — The WebSocket Protocol](https://www.rfc-editor.org/rfc/rfc6455.html)
- [RFC 6202 — Known Issues and Best Practices for the Use of Long Polling and Streaming in Bidirectional HTTP](https://www.rfc-editor.org/rfc/rfc6202.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
