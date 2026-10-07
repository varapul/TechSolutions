
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🏗️ Platform Engineering](../../README.md#platform-engineering)

# The Twelve-Factor App

> Twelve rules for apps that deploy cleanly anywhere: config in the environment, stateless processes, separate build, release and run.

<p align="center"><img src="diagram.svg" alt="Animated diagram: The Twelve-Factor App" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/twelve-factor-app.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · A pet server** | Before the move, Acme's catalog service runs on **catalog-01**, a server built and patched by hand: the production database password sits in `config/prod.yml` in Git, staging and production each get their own build (#88 and #91), and the logs go to files on its disk that cron rotates. The sessions of 1,800 logged-in shoppers live in its memory, so a second server doesn't help: a request that lands on catalog-02 finds no session and the shopper is logged out. Migrations are run by hand over SSH, and the only way to scale is a bigger server, from 8 to 32 vCPUs. |
| **2 · Code and config (I–V)** | Factors I to V separate the code from its configuration. One repository builds one image, `catalog:2.3.0`, with its dependencies declared in `requirements.txt` and installed inside it (I, II); everything that differs between deploys, such as `DATABASE_URL`, reaches the app as environment variables that Kubernetes fills from a ConfigMap and a Secret (III), and PostgreSQL, Redis and S3 are attached resources that the app finds by URL (IV). Build, release and run are separate stages: the image plus an environment's config makes a release with an ID, `v41-staging` or `v41-prod`, and a change to either makes a new release instead of editing this one (V). |
| **3 · Running it (VI–IX)** | Factors VI to IX make the processes disposable. Sessions move to Redis, so any web pod can serve any shopper (VI); the app serves HTTP itself on the port it is given, 8080, behind the Service (VII); each process type scales on its own, web to 6 pods and worker to 2 (VIII); and a pod is ready 2 seconds after it starts and, on SIGTERM, finishes its 3 in-flight requests before it exits (IX). Kubernetes can now add, move and replace pods whenever it needs to (Acme's numbers are the example's own). |
| **4 · Operating it, and limits** | Developers run the same PostgreSQL 16, in a container (X); every pod writes its log to stdout as an event stream that the platform's log agent ships (XI); and the schema migration runs once, as a Kubernetes Job from release `v41-prod` with the same image and config (XII). The limits, in amber: the factors were written in 2011 for Heroku-style web apps; environment variables are a poor home for secrets, so mount the password from a secrets manager; a database is stateful and outside the model; and telemetry and security aren't among the twelve, which the community revision begun when Heroku open-sourced the text in November 2024 has not changed yet. |
<!-- END GENERATED: header -->
## The problem

Acme Shop's catalog service, which serves product pages, filters and images to the shop, ran on **catalog-01**, a virtual machine the catalog team had built by hand and patched over SSH ever since. Moving it to the platform team's shared Kubernetes clusters showed how much of the service depended on that one machine:

- **Secrets in the code.** The production database password sat in `config/prod.yml` in Git, readable by everyone with access to the repository and copied into every build.
- **A build per environment.** Staging and production each got their own build (#88 and #91) with their configuration baked in, so staging never tested what production ran.
- **State on the server.** The sessions of 1,800 logged-in shoppers lived in the process's memory, and the logs in `/var/log/catalog/app.log`, rotated away by cron. Reading them meant SSH and grep.
- **No second instance.** When the team put catalog-02 behind the load balancer, a shopper whose next request landed there had no session and was logged out.
- **Operations by hand.** Schema migrations were run over SSH with `psql` before a release, and the only way to scale was a bigger server: catalog-01 grew from 8 to 32 vCPUs.

None of these is a bug in the code. Each one assumes the app will always run on one known machine, and each one breaks on a platform that starts, moves and stops copies of the app on its own. (Acme's numbers on this page are the example's own.)

## How it works

**The Twelve-Factor App** is a methodology for building software-as-a-service apps that deploy to any modern cloud platform and scale out without big changes to their tooling or architecture. Adam Wiggins, a co-founder of Heroku, published it at 12factor.net in 2011, drawing on what the Heroku team had learned from the apps they built and the hundreds of thousands their platform ran; the site was last updated in 2017. The maintainers of today's revision describe the factors as a contract between the app and the platform it runs on: the app keeps its code, dependencies and behaviour predictable, and in return the platform can build, configure, start, scale and stop it without knowing anything else about it. The factor names below are 12factor.net's; the descriptions are a summary in our own words.

| Factor | What it asks for | In Acme's catalog service |
|---|---|---|
| **I. Codebase** | One codebase per app in version control, deployed many times. Code that several apps share becomes a library. | The `catalog` Git repository; staging, production and developers' laptops all run builds of it. |
| **II. Dependencies** | Declare every dependency explicitly, and isolate the app from whatever happens to be installed on the host, system tools included. | Pinned versions in `requirements.txt`, installed into the container image; nothing is expected on the node. |
| **III. Config** | Keep everything that varies between deploys (credentials, resource handles, hostnames) out of the code, in environment variables managed per deploy. | `DATABASE_URL`, `REDIS_URL`, `S3_BUCKET` and `PORT`, injected per environment from a ConfigMap and a Secret. |
| **IV. Backing services** | Treat databases, caches, queues and third-party APIs as attached resources, found through config, so that one can be swapped without a code change. | PostgreSQL on [Amazon RDS](../amazon-rds-aurora/), Redis and S3, each reached by URL; leaving db01 for RDS was a change to `DATABASE_URL`. |
| **V. Build, release, run** | Keep three stages apart: the build turns code into an artifact, the release combines it with a deploy's config under a unique ID and is never edited, and the run stage starts processes from a release. | `catalog:2.3.0` is built once; `v41-staging` and `v41-prod` add each environment's config; a new setting means a new release, v42. |
| **VI. Processes** | Run the app as stateless processes that share nothing; whatever must outlive a request goes to a backing service. Sticky sessions are out. | Sessions live in Redis with a 30-minute expiry, product images in S3. |
| **VII. Port binding** | Make the app self-contained: it serves HTTP itself on a port it is given, and a routing layer in front sends it traffic. | The web process listens on `PORT` (8080); the Kubernetes Service maps port 80 to it. |
| **VIII. Concurrency** | Scale out by running more processes, with a process type for each kind of work, and leave running them to the platform's process manager. | Two Deployments from one image: web ×6 for HTTP, worker ×2 for background jobs. |
| **IX. Disposability** | Start in seconds, shut down gracefully on SIGTERM, and survive being killed without warning. | A pod is ready 2 s after it starts; on SIGTERM a web pod finishes its in-flight requests and a worker hands its unfinished job back to the queue. |
| **X. Dev/prod parity** | Keep development, staging and production close: little time between writing and deploying code, the same people writing and running it, and the same tools and backing services. | Developers run PostgreSQL 16 and Redis in containers, the same versions as production. |
| **XI. Logs** | Write the log as an unbuffered stream of events to stdout, and leave routing and storage to the environment. | Each pod writes to stdout; a log agent on every node ships the stream to log search. |
| **XII. Admin processes** | Run one-off tasks such as migrations or a console as separate processes against the same release, with the same code and config. | `migrate-v41`, a Kubernetes Job that runs `alembic upgrade head` from `catalog:2.3.0` with the v41-prod config. |

**Containers and Kubernetes** have turned several factors into defaults. The container image is the build artifact and carries its dependencies (II, V). ConfigMaps and Secrets feed environment variables or files into a pod (III). Each process type becomes a Deployment with its own replica count (VIII), behind a Service that forwards to the container's port (VII). Pods are disposable by design: to stop one, the kubelet runs any preStop hook, sends SIGTERM to the main process of each container, and kills whatever is left when the grace period ends, 30 seconds by default (IX). The Kubernetes documentation calls writing to stdout and stderr the easiest and most common way for a containerized app to log, and a node-level agent collects those streams (XI). A Job runs a one-off task to completion (XII).

Two factors still take discipline. A ConfigMap can be edited in place, which quietly changes the configuration of a running release, and pods that read it as environment variables only see the change when they restart, one by one. Versioned ConfigMaps marked immutable (stable since Kubernetes 1.21) keep each release fixed (V). And a Service can pin each client to one pod with `sessionAffinity: ClientIP`, which is exactly the sticky session that factor VI rules out.

**Since 2011.** The factors predate Docker and Kubernetes, and several practices have moved on:

- **Secrets.** Environment variables are now seen as a weak place for credentials: every process in the container can read them, child processes inherit them, and they turn up in logs and system dumps. OWASP's *Secrets Management Cheat Sheet* advises against them where another option exists. Teams mount secrets as files from a manager such as Vault or AWS Secrets Manager, prefer short-lived credentials, and give each workload its own identity instead of a shared key.
- **Sidecars.** Helpers that run next to the app in the same pod, such as log shippers and service-mesh proxies, take over work the app would otherwise do itself. Kubernetes made native sidecar containers stable in version 1.33.
- **Observability.** The methodology covers logs only. Metrics and traces are now expected of any production service.
- **Beyond the Twelve-Factor App.** Kevin Hoffman's short book (O'Reilly, 2016) revisits the list for cloud-native apps and grows it to fifteen, adding *API first*, *telemetry*, and *authentication and authorization*.
- **The open-source revision.** In November 2024 Heroku open-sourced the text under a Creative Commons licence, and a group of maintainers from Heroku and Salesforce, AWS, Intuit and other companies began to revise it on GitHub. They intend to keep twelve factors, to start from stateless, request-driven apps before other kinds of workload, and to bring the examples up to date, with observability and security among the topics. By March 2025 every factor on the repository's `next` branch had been split into concepts, examples and guidance. As of October 2026 the revision is unfinished: proposals such as a factor for workload identity are still open, and 12factor.net still shows the 2017 text.

## Putting it into practice

1. **Score the app against the twelve factors** and fix first the ones that stop you running two copies: config and secrets, sessions, local files. 12factor.net suggests a quick test for config: could the repository be made public right now without leaking a single credential?
2. **Move configuration into the environment.** List every setting that differs between deploys, read each one from an environment variable at start-up, and fail fast with a clear message when one is missing or malformed. Settings that never vary between deploys, such as routes or how modules are wired together, stay in code. Supply the values per environment from a ConfigMap and a Secret, or from an [external configuration store](../external-configuration-store/).
3. **Take secrets out of Git and out of plain variables.** Rotate every credential that was ever committed, because it stays in the history. Keep secrets in a manager such as [Vault](../vault/) or AWS Secrets Manager and mount them as files, or give the workload its own identity so that it needs no static key at all.
4. **Build once and give every release an ID.** Pin dependencies in a lock file, build one image per version in CI and promote it by digest (see [continuous delivery](../continuous-delivery/)). Treat image plus config as the release: give ConfigMaps versioned names (`catalog-config-v41`) and mark them immutable, or put a hash of the config into the pod template, so that a config change rolls out as a new release and the previous one is still there to roll back to.
5. **Move state into backing services.** Sessions go to [Redis](../redis/) with an expiry, uploads to object storage such as [Amazon S3](../amazon-s3/). Treat the local disk and memory as scratch space for a single request, and expect them to be gone on the next one.
6. **Give each kind of work its own process type.** Run web and worker as separate Deployments from the same image with different commands, the web process listening on the port in `PORT`. Scale each one on its own signal, with a HorizontalPodAutoscaler for example (see [autoscaling](../autoscaling/)).
7. **Make starting and stopping cheap.** Keep start-up to seconds and report ready only when the app can serve ([health endpoint monitoring](../health-endpoint-monitoring/)). On SIGTERM, stop taking new work, finish what is in flight and exit; make jobs idempotent, so that a job a dying worker leaves half done can safely run again. Kubernetes starts the shutdown at the same moment as it removes the pod from the Service's endpoints, so a few requests can still arrive after SIGTERM; a short sleep in a preStop hook covers that gap. Use the exec form of `ENTRYPOINT` or `CMD`, so that the app, not a shell, receives the signal.
8. **Keep development close to production.** Run the same image locally with Docker Compose, next to the same major versions of PostgreSQL and Redis as production, instead of SQLite or in-memory stand-ins.
9. **Log to stdout**, one structured event per line, and let a node agent such as Fluent Bit ship the stream to [centralized logging](../centralized-logging/). Never write log files inside the container.
10. **Run admin tasks from the release.** A migration is a Kubernetes Job or a pipeline step that uses the release's image and config and runs once per release; nobody runs it with `kubectl exec` in a serving pod or over SSH.

## Where it fits

- [Continuous delivery](../continuous-delivery/) relies on factor V: one artifact, built once and promoted from stage to stage with different config.
- An [external configuration store](../external-configuration-store/) holds factor III's values when environment variables alone get unwieldy: one versioned, audited place, read at start-up. [Vault](../vault/) or a cloud secrets manager holds the secrets and can issue short-lived database credentials.
- [Immutable infrastructure](../immutable-infrastructure/) applies the same thinking to machines: never patch a running server, replace it.
- [Docker](../docker/) images carry the dependencies and the build (II, V); [Kubernetes](../kubernetes/) supplies the ConfigMaps, Secrets, Deployments, Services and Jobs that implement III, VII, VIII and XII.
- [Redis](../redis/) is the usual home for the sessions that factor VI moves out of the process; [PostgreSQL](../postgresql/) and [Amazon S3](../amazon-s3/) are the other attached resources in the example.
- [Health endpoint monitoring](../health-endpoint-monitoring/) provides the readiness and liveness checks that make disposability safe, and [autoscaling](../autoscaling/) builds on factor VIII.
- [Centralized logging](../centralized-logging/) is the other half of factor XI: the app writes the stream, the platform collects, indexes and keeps it. A [telemetry pipeline](../telemetry-pipeline/) and [distributed tracing](../distributed-tracing/) add the metrics and traces the twelve factors leave out.
- The [sidecar](../sidecar/) pattern runs helpers such as log shippers and proxies next to the app.
- In a platform team, [golden paths](../golden-paths/) and [infrastructure as code](../infrastructure-as-code/) (other pages in this category) bake the factors into the templates every new service starts from.

## When to use it

The factors pay off for what they were written for: web apps, APIs and background workers that run as several identical copies on a platform that starts and stops them, whether that is Kubernetes, a platform such as Heroku or Google Cloud Run, or virtual machines behind a load balancer. In a new service most of them cost little, and they make every later step, from continuous delivery to autoscaling, easier.

Elsewhere they need adapting:

- **Databases, message brokers and other stateful systems** are the backing services of the model, not twelve-factor apps. They need stable identities and storage, careful upgrades and backups: StatefulSets, operators or a managed service.
- **Batch jobs and data pipelines** benefit from config in the environment, logs on stdout and building once, but a job that runs for hours can't be thrown away cheaply; design it to checkpoint and resume instead.
- **Long-lived connections** such as WebSockets and streams make quick, graceful shutdown harder: clients must reconnect, and draining can take longer than the default grace period.
- **Legacy apps** can adopt the factors one at a time, in the order of the steps above; the ones that let you run a second copy matter most.
- **Desktop, mobile and embedded software** isn't deployed as a service, and most of the factors don't apply.

## Common pitfalls

- **Secrets in plain environment variables.** Every process in the container can read them, and they leak into crash reports, debug pages and system dumps. Mount secrets as files from a secrets manager, keep them out of logs and error pages, and rotate them.
- **Config sprawl.** Hundreds of variables with unclear names and no defaults turn every deploy into guesswork. Put in the environment only what really varies between deploys, validate it at start-up, document each variable next to the code that reads it, and keep internal settings in code.
- **Reading "stateless" as "no state anywhere".** The processes are stateless; the system isn't. The state moves to backing services, which now need their own design for backups, replication and capacity.
- **Local files and caches that vanish.** An in-memory cache or a file on the container's disk is gone after every restart, deploy or move, and differs from pod to pod. Use local storage only as per-request scratch space or as a cache that may start cold, and keep anything shared in Redis or object storage.
- **Editing config in place.** Changing a ConfigMap or a variable of a running deployment creates a release nobody recorded, and pods pick it up only when they restart. Make every change a new release instead, with versioned, immutable ConfigMaps or a config hash in the pod template.
- **Ignoring SIGTERM.** When a shell is the container's main process, as with the shell form of `ENTRYPOINT`, the signal never reaches the app, which is killed at the end of the grace period with requests in flight. Use the exec form and handle the signal.
- **A checklist for everything.** Forcing databases, brokers or batch jobs into the twelve factors produces fragile setups. Apply the factors that fit, such as config, logs and building once, and use the right tools for the rest.
- **Stopping at logs.** The twelve factors say nothing about metrics, traces, identity or security. Add telemetry and authentication deliberately; the fifteen factors of *Beyond the Twelve-Factor App* make a useful checklist.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Continuous Delivery](../continuous-delivery/) — Keep every change releasable: a deployment pipeline builds once, tests in stages and promotes the same artifact to production.
- [External Configuration Store](../external-configuration-store/) — Keep configuration out of the deployment package, in a central store read at runtime.
- [Immutable Infrastructure](../immutable-infrastructure/) — Never patch servers in place: bake a new image and replace them.
- [Health Endpoint Monitoring](../health-endpoint-monitoring/) — Expose liveness and readiness checks that load balancers and monitors probe.
- [Centralized Logging](../centralized-logging/) — Ship structured logs from every service to one searchable store, correlated by request ID.
- [Autoscaling](../autoscaling/) — Add and remove instances automatically as load rises and falls.
- [Docker & Containers](../docker/) — Package an app and its dependencies as an image and run it as an isolated process: layers, registries, namespaces, cgroups.
- [Kubernetes](../kubernetes/) — A container orchestrator: you declare the desired state, and controllers keep pods scheduled, healthy and reachable.

## References

- [Adam Wiggins — The Twelve-Factor App (12factor.net, Heroku, 2011; last updated 2017)](https://12factor.net/)
- [12factor.net — III. Config](https://12factor.net/config)
- [12factor.net — V. Build, release, run](https://12factor.net/build-release-run)
- [12factor.net — VI. Processes](https://12factor.net/processes)
- [12factor.net — IX. Disposability](https://12factor.net/disposability)
- [12factor.net — XI. Logs](https://12factor.net/logs)
- [Heroku — Heroku Open Sources the Twelve-Factor App Definition (November 2024)](https://www.heroku.com/blog/heroku-open-sources-twelve-factor-app-definition/)
- [Yehuda Katz — Twelve-Factor App Methodology is now Open Source (12factor.net blog, November 2024)](https://12factor.net/blog/open-source-announcement)
- [twelve-factor/twelve-factor — the community revision of the manifesto (GitHub)](https://github.com/twelve-factor/twelve-factor)
- [Kevin Hoffman — Beyond the Twelve-Factor App (O'Reilly, 2016; e-book hosted by VMware)](https://www.vmware.com/docs/ebook-beyond-the-12-factor-app)
- [Kubernetes documentation — ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/)
- [Kubernetes documentation — Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)
- [Kubernetes documentation — Pod Lifecycle: termination of Pods](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination)
- [Kubernetes documentation — Container Lifecycle Hooks (preStop)](https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/)
- [Kubernetes documentation — Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/)
- [Kubernetes documentation — Sidecar Containers (stable since v1.33)](https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/)
- [Kubernetes documentation — Virtual IPs and Service Proxies (session affinity)](https://kubernetes.io/docs/reference/networking/virtual-ips/)
- [Kubernetes documentation — Logging Architecture](https://kubernetes.io/docs/concepts/cluster-administration/logging/)
- [OWASP — Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [Docker documentation — Dockerfile reference: ENTRYPOINT, shell and exec form](https://docs.docker.com/reference/dockerfile/#entrypoint)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
