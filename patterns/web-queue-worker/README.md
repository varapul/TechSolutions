<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🏛️ Application Architecture](../../README.md#application-architecture)

# Web-Queue-Worker

> A web front end hands slow work to background workers through a queue.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Web-Queue-Worker" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/web-queue-worker.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Two roles and a queue** | A user orders photo book 1042. The **web front end** validates it, saves it as *rendering*, puts a job on the **queue** and replies in about 120 ms, so it never does the slow work itself. A **worker** takes the job, renders the PDF (about 90 s), stores it in blob storage, marks the order *ready* and calls the email service and the print partner, while static files come from the CDN and hot reads from the cache. |
| **2 · Scale each role on its own** | At the 19:00 peak the web tier grows from 2 to 4 instances on **request rate**, while the burst of orders deepens the queue and the worker tier grows from 1 to 3 on **queue length**. At night the web tier shrinks back to 2 while the workers drain the backlog. The two roles are deployed, scaled and sized separately: small web instances, CPU-heavy workers. |
| **3 · State outside the roles** | During a deployment web 1 is replaced, and the user's next request lands on the new instance but stays signed in, because the session lives in the cache, not in the instance. Worker 2 crashes halfway through book 1043: the message was only hidden, so when its visibility timeout runs out it reappears and worker 1 renders the book again, which is why job handlers must be **idempotent**. At 02:00 the worker also runs a scheduled clean-up of old, abandoned uploads that no request triggers. |
| **4 · Know where it stops** | Both roles share one database schema and a common code library, so a schema change shipped with the worker breaks the web tier, which still reads the old column. As features pile up, the worker becomes a monolith of unrelated jobs (rendering, emails, imports, reports) with one release cycle. The usual next steps are a queue and a worker per job type, then services that own their data once the domain outgrows the style. |
<!-- END GENERATED: header -->

## The problem

A web request has a latency budget of milliseconds, but some work takes far longer: rendering a print-ready PDF, resizing a thousand photos, building a monthly report, or waiting on a slow partner API. Do it inside the request and the user waits while threads and connections pile up behind the slow calls. The platform may also cut the request off: [Heroku's router](https://devcenter.heroku.com/articles/request-timeout) gives up when no response has started within 30 seconds (error H12). Rendering capacity can then only grow by adding web servers, all sized for the heaviest job. Starting a background thread in the web process doesn't fix this either. The work dies with the instance, and nothing stops one busy instance from taking on more than it can finish.

## How it works

The [Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/web-queue-worker) describes the style as two roles with a message queue between them:

- The **web front end** handles client requests. It validates input, does the simple reads and writes itself, puts a message on the **queue** for anything slow and answers straight away.
- The **worker** takes messages from the queue and does the resource-intensive, long-running or batch work. It can also run on a schedule, with no request involved.
- Around them sit the services that usually come with the style: one or more **databases**, a **cache** for hot reads and session state, a **CDN** for static content, **blob storage** for files, an identity provider, and **remote services** such as email or SMS providers.

Both roles are stateless: anything that has to outlive an instance (sessions, orders, files) lives in the shared stores. That is what lets each role be deployed, scaled, sized and replaced on its own. The queue decouples them in time, so the worker can be slower, busy or briefly down while the web tier keeps taking orders.

| Stays in the request (web front end) | Goes to the worker |
|---|---|
| Validation, authorization, simple reads and writes | CPU- or memory-heavy work: rendering, image and video processing, archives |
| Anything the user must see in this response | Calls to slow or unreliable partners: print services, email and SMS gateways |
| Saving the job and putting it on the queue | Scheduled and batch jobs: clean-ups, imports, reports |

Not everything has to go through the queue. The Azure guidance notes that the front end can handle simple reads and writes directly, and that the worker is optional when an application has no long-running work.

## When to use it

- A relatively simple domain with some long-running workflows or batch operations, such as a shop that renders photo books or a SaaS app that imports spreadsheets and builds monthly reports.
- Teams that prefer managed platform services (App Service, Elastic Beanstalk, Cloud Run, Heroku) to running their own infrastructure.
- Work that can finish after the response, because the user can be told about the result later.

When not to use it:

- **There is no slow work at all.** A plain web application is simpler: a queue and a second deployable would only add moving parts.
- **The domain is large and changes fast.** With many teams and many features, both roles turn into big shared codebases. Plan for a [modular monolith](../modular-monolith/) or [microservices](../microservices/) instead.
- **The caller needs the result in the same response.** A queue makes the request faster, not the work.

## Trade-offs

- **The message is a contract between two deployables.** The two roles are released separately, so during a rolling deployment old and new versions of each run side by side. Messages written by the old web code are still waiting when the new worker starts. Version the messages, prefer additive changes, have workers ignore fields they don't know, and change a message's shape in [expand-and-contract](../expand-and-contract/) steps.
- **Delivery is at least once.** A queue hides a message while a worker processes it, and makes it visible again if the worker doesn't delete it in time, so a crash means the job runs twice. With [Azure Functions on Storage queues](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-storage-queue-trigger), for example, a host crash leaves the message hidden for the storage service's fixed 10-minute timeout before it reappears. Make jobs [idempotent](../idempotent-consumer/): write results under a deterministic name (`1043.pdf`), change state with conditional updates, and pass the order ID as an idempotency key to partners so a rerun doesn't print the book twice.
- **Poison messages.** A message that always fails must not loop forever. Cap the attempts and park it in a [dead-letter queue](../dead-letter-queue/). By default, Azure Functions moves a Storage queue message to `<queue>-poison` after five failed attempts. An Elastic Beanstalk worker environment retries up to `MaxRetries` times (10 by default) before it dead-letters the message.
- **The dual-write gap.** The web tier saves the order, then sends the message. If it fails in between, the order waits forever. The Azure guidance points to a [transactional outbox](../transactional-outbox/).
- **Hidden coupling.** The roles usually share one database schema and a code library. A column renamed for the worker breaks the web tier that still reads it, so treat schema changes as expand-and-contract migrations as well.
- **The worker becomes a monolith.** Every new background feature (rendering, emails, imports, reports) lands in the same worker, with one release cycle and one scaling setting. A slow import can then hold up the renders.
- **Results arrive later.** The user gets "being prepared", not the PDF, so the UI and the API need a way to report progress and the result.

## Implementation notes

- **Tell the user the result.** A browser or API client can poll a status endpoint ([asynchronous request-reply](../asynchronous-request-reply/)) or listen on a WebSocket. Systems can receive a [webhook](../webhooks/), and people get an email or a push notification.
- **Scale each role on its own signal.** Scale the web tier on request rate, CPU or latency, and the worker tier on queue length. AWS's [EC2 Auto Scaling guidance](https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-using-sqs-queue.html) uses a backlog per instance (queue length divided by running instances), compared with what one instance can clear in an acceptable time. Size the roles separately too: small web instances, CPU-heavy workers. See [autoscaling](../autoscaling/), [competing consumers](../competing-consumers/) and [queue-based load leveling](../queue-based-load-leveling/).
- **Urgent jobs first.** Give urgent jobs (a customer waiting at checkout) their own queue and workers, a [priority queue](../priority-queue/), so a nightly import can't delay them.
- **Keep state out of the roles.** Keep sessions and hot data in a distributed cache ([cache-aside](../cache-aside/)). [The Twelve-Factor App](https://12factor.net/processes) treats sticky sessions as a violation and suggests a time-expiring store such as Memcached or Redis. Serve static files from a CDN ([CDN edge caching](../cdn-edge-caching/)). Send large uploads straight to blob storage with a short-lived signed URL ([valet key](../valet-key/)) instead of through the web tier.
- **Platform examples** (checked in October 2026):
  - **Azure:** the Architecture Center's App Service version uses an App Service web app as the front end and an Azure Functions app as the worker. It adds Service Bus or Storage queues, Azure Managed Redis for session state, a CDN for static content and several data stores. It also suggests separate App Service plans, so the two roles scale independently. [WebJobs](https://learn.microsoft.com/en-us/azure/app-service/webjobs-create) run background programs inside an App Service app, either continuously or triggered manually or on a CRON schedule. They share that app's instances, so host them in their own app if the worker should scale apart from the web tier.
  - **AWS:** an Elastic Beanstalk worker environment manages an Amazon SQS queue and runs a daemon on each instance. The daemon POSTs every message to your application on `localhost`: a `200 OK` deletes it, and any other answer returns it to the queue. A `cron.yaml` file adds periodic tasks. The .NET on Windows Server platform doesn't support worker environments.
  - **Google Cloud:** Cloud Tasks queues tasks and dispatches each one to an HTTP handler on Cloud Run, App Engine or any HTTP endpoint, with rate limits and retries. Delivery is at least once, so handlers must be idempotent.
  - **Heroku:** the `Procfile` declares `web` and `worker` process types, which scale separately (`heroku ps:scale web=2 worker=4`). Scheduled jobs run through Heroku Scheduler or a clock process. Heroku [moved to a sustaining-engineering model](https://www.heroku.com/blog/an-update-on-heroku/) in February 2026: it is still supported, but gets no new features.
  - **The Twelve-Factor App** ([VIII. Concurrency](https://12factor.net/concurrency)) makes this a general process model. Web processes take HTTP requests, worker processes run background jobs, and the set of process types with their counts is the *process formation*.
- **The serverless variant.** Both roles can be functions: an HTTP-triggered front end, and queue-triggered workers that the platform scales out with the backlog. On consumption-style plans they scale back to zero when the queue is empty. See [serverless](../serverless/).
- **Beyond the style.** When the worker has grown into a pile of unrelated jobs, split it into one queue and one worker per job type, each deployed and scaled on its own. When the domain itself outgrows the style, move to modules with clear boundaries ([modular monolith](../modular-monolith/)) or to services that own their data ([microservices](../microservices/), [database per service](../database-per-service/)).

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Queue-Based Load Leveling](../queue-based-load-leveling/) — A queue absorbs traffic spikes so the backend can work at a steady pace.
- [Competing Consumers](../competing-consumers/) — Several workers pull from one queue, so work is shared and throughput scales out.
- [Asynchronous Request-Reply](../asynchronous-request-reply/) — Accept now with 202, process in the background, and let the client poll a status URL.
- [Priority Queue](../priority-queue/) — Urgent messages are processed ahead of routine ones.
- [Serverless (Functions)](../serverless/) — Functions start per event, scale out automatically and scale to zero when idle.
- [Microservices](../microservices/) — Small, independently deployable services, each owning one business capability and its data.
- [Layered (N-Tier)](../layered-architecture/) — Presentation, business and data layers; each layer only calls the one directly below it.
- [Autoscaling](../autoscaling/) — Add and remove instances automatically as load rises and falls.

## References

- [Azure Architecture Center — Web-Queue-Worker architecture style](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/web-queue-worker)
- [AWS Elastic Beanstalk — Elastic Beanstalk worker environments](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/using-features-managing-env-tiers.html)
- [Heroku Dev Center — The Process Model](https://devcenter.heroku.com/articles/process-model)
- [Heroku Dev Center — Worker Dynos, Background Jobs and Queueing](https://devcenter.heroku.com/articles/background-jobs-queueing)
- [The Twelve-Factor App — VIII. Concurrency](https://12factor.net/concurrency)
- [Google Cloud — Understand Cloud Tasks](https://docs.cloud.google.com/tasks/docs/dual-overview)
- [Amazon EC2 Auto Scaling — Scaling policy based on Amazon SQS](https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-using-sqs-queue.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
