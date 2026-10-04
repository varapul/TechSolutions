<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🚀 Deployment & Release](../../README.md#deployment--release)

# External Configuration Store

> Keep configuration out of the deployment package, in a central store read at runtime.

<p align="center"><img src="diagram.svg" alt="Animated diagram: External Configuration Store" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/external-configuration-store.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Settings baked in** | Connection strings, timeouts and passwords sit in a settings file inside the image, so staging and production each need their own build (57-staging and 57-prod). Changing one timeout means editing the file, rebuilding both images and redeploying every instance, and the passwords live in the repository and in every copy of every image. |
| **2 · One image everywhere** | The same image, build 57, runs in staging and in production. When an instance starts it reads its environment's settings from the configuration store, selected by **label**, and fetches its secrets from a separate secret store, signing in to both with its own **workload identity**. The image and the repository hold no environment settings and no secrets; the configuration store keeps only a reference to the password. |
| **3 · Change at runtime** | An operator, ana, changes `payment.timeout` for production from 2 s to 3 s. The store records version 8 with who changed what and when, and the sentinel key is bumped; the production instances watch the sentinel (or get a change notification) and reload within seconds, still on build 57, while staging keeps its own value. Settings that are read only at start, such as `db.pool.size`, are marked as needing a restart, and rolling back means restoring version 7. |
| **4 · Safe to depend on** | Each instance keeps its last known good configuration on local disk, so it keeps running while the store is unreachable, and prod-2 even restarts from that copy. The next change is validated before it goes live, then rolled out in stages with automatic rollback on alarms, because a bad configuration change can take a system down as surely as bad code. Secrets stay in the secret store and are rotated, and every key has an owner. |
<!-- END GENERATED: header -->

## The problem

Most applications start with their settings in a file that ships with the code: an `appsettings.json`, an `application.yml` or a `.env` file copied into the image. That works for one environment. With two or more it starts to hurt:

- **One build per environment.** Staging and production need different database hosts, pool sizes and passwords, so the pipeline produces `57-staging` and `57-prod`. They are two artifacts, tested separately, and the one running in production is not the one that passed in staging.
- **Every change is a release.** Raising a timeout during an incident means editing the file, rebuilding, waiting for the pipeline and redeploying every instance. The Azure Architecture Center write-up of this pattern makes the same point: when configuration ships inside the package, changing it means redeploying the application, with the downtime and effort that come with it.
- **Secrets everywhere.** The password sits in the repository and its history, in every image in the registry, in every node's image cache and in every backup of them. Anyone who can pull the image can read it, and changing it is another release.
- **Instances disagree.** During a rollout some instances run the old settings and some the new ones, and nobody can say at a glance which value is live where, or who set it.
- **Nothing is shared.** Services that need the same queue URL or limit each keep their own copy, and the copies drift apart.

## How it works

Keep configuration out of the deployment package, in a store built for it, and let the application read it at runtime:

1. **One artifact for every environment.** The pipeline builds one image, build 57, and promotes it unchanged from staging to production. Nothing that differs between environments is baked into it. This is the same rule as in [immutable infrastructure](../immutable-infrastructure/): the bytes you tested are the bytes you run.
2. **Settings live in a configuration store**, organised by key and by environment. In the animation the same key holds one value under the label `staging` and another under `production`. Each instance knows only which environment it belongs to (from the platform, usually as an environment variable) and reads that environment's values when it starts.
3. **Secrets live in a secret store**, not in the configuration store. The configuration store holds at most a reference to a secret, and the application reads the secret itself from the secret store.
4. **Instances sign in as themselves.** Each workload reads both stores with an identity that the platform gives it (a managed identity, an IAM role, a Kubernetes service account), so there is no bootstrap password to hide. [OAuth 2.0 client credentials](../oauth2-client-credentials/) shows how such a workload identity replaces a stored client secret.
5. **Changes are made in the store, not in the code.** Each change becomes a new version that records who made it and when. Running instances pick it up within seconds or at their next refresh, and rolling back means restoring the previous version.
6. **Each instance keeps a local copy** of the last configuration it loaded successfully, so it keeps working, and can even start, while the store is unreachable.

### What counts as configuration

*The Twelve-Factor App* (factor III, Config) draws the line. Configuration is whatever is likely to differ between deploys of the same code: handles to databases and other backing services, credentials for external services, and values such as the hostname of a particular deploy. Wiring that is the same in every deploy, such as a framework's route table or how modules are connected, is not configuration in that sense and belongs in the code. Its litmus test: could you publish the codebase today without exposing a single credential?

Twelve-factor keeps configuration in **environment variables**. They change between deploys without a code change, they are less likely than config files to be committed by accident, and every language and operating system can read them. It also advises against bundling settings into named environments, such as Rails' `development`, `test` and `production`, because the bundles multiply as deploys multiply; each variable should be an independent setting.

A central store doesn't contradict this. It keeps configuration just as strictly out of the code, but puts it somewhere with history, access control and tooling. Most teams combine the two: the platform injects a few environment variables (which environment this is, where the store is, which identity to use), and the application reads everything else from the store. Named environments come back in a store as labels or paths, which is fine as long as each value can still be set on its own.

### Environment variables, files and a central store

| | Environment variables | File baked into the image | Central store |
|---|---|---|---|
| **Same artifact everywhere** | Yes | No: one build per environment | Yes |
| **Change without a redeploy** | No: read once when the process starts | No | Yes: poll, watch or push |
| **History and audit** | Only in the deployment tooling | Git history of the file | Versions with who, what and when |
| **Access control** | Whoever can deploy | Whoever can read the repository or pull the image | Per key or per path |
| **Validation and gradual rollout** | In your pipeline | In your pipeline | Built into some stores |
| **Secrets** | Possible, but OWASP warns that they are generally readable by other processes and can end up in logs and crash dumps | No | As references to a secret store |
| **Runtime dependency** | None | None | The store, unless the application caches it |

Kubernetes sits in between. A ConfigMap keeps settings out of the image, but environment variables taken from a ConfigMap never change in a running container: the pod has to restart. When the ConfigMap is mounted as a volume, the files are updated eventually (after the kubelet's sync period plus its cache delay), except for `subPath` mounts, which never see updates, and the application still has to reread the files.

### Organising keys

- **By environment.** The store needs a way to hold the same key with a different value per environment. Azure App Configuration uses **labels** for this, the `staging` and `production` columns in the animation, and lets an application load the unlabelled defaults first and then the labelled overrides on top. AWS AppConfig organises configuration by application, environment and configuration profile. Parameter Store uses paths such as `/myapp/prod/db/host`, and IAM policies can grant a role `/myapp/prod/*` but not `/myapp/dev/*`. In Spring Cloud Config, files are named after the application and profile, and its `{label}` is a Git branch, tag or commit.
- **By region and tenant**, only where values really differ: a region dimension for regional endpoints, a tenant key for per-customer limits. Every dimension multiplies the combinations that someone has to understand and test.
- **By owner.** Put the owning service or team in the key prefix (`payments/…`), so access policies, reviews and alerts follow ownership, and nobody is left holding a key that nobody owns.
- **Keep key names stable.** Code refers to keys by name, so renaming one is a code change. Azure's providers, for example, can trim a prefix when they load the keys, so code doesn't have to repeat it.

### Getting a change to running instances

A new value in the store does nothing until the application reads it again. From simplest to most involved:

- **Read once at start.** Simple and consistent, but every change needs a restart, which amounts to a rolling deploy without a new build. Values injected by the platform behave this way: Amazon ECS resolves environment variables from Parameter Store when a task starts, and a running task needs a new deployment to see a change.
- **Polling.** The client asks for changes on an interval and reloads what changed. The Azure App Configuration provider checks no more often than every 30 seconds by default, and in ASP.NET Core only while requests are arriving. The AWS AppConfig Agent polls every 45 seconds by default. Polling costs requests and adds up to one interval of delay, so lengthen the interval for values that rarely change.
- **A sentinel key.** The client watches one key and reloads everything when it changes. Write all the related changes first and bump the sentinel last, so no instance loads half an update. Azure App Configuration supports both this and watching every selected key.
- **Push notifications.** The store publishes an event when a value changes, and instances refresh when they receive it. Azure App Configuration publishes through Event Grid, Parameter Store through Amazon EventBridge, and Spring Cloud Config turns a Git webhook on its `/monitor` endpoint into a refresh broadcast over Spring Cloud Bus. Spread the refreshes out: after a notification, Azure's .NET provider waits a random delay of up to 30 seconds by default, so that thousands of instances don't hit the store at the same moment. Keep a slow poll as well, in case a notification is lost.
- **An agent beside the application.** A [sidecar](../sidecar/) or host agent does the fetching, caching and authentication, and the application reads a local file or a local HTTP endpoint. The AWS AppConfig Agent serves configuration from its cache on `localhost:2772`. Vault Agent and Consul Template render values into files and can run a command, such as a reload, when the output changes. The Azure App Configuration Kubernetes provider writes ConfigMaps and Secrets that pods consume without code changes.

The application still has to apply the new value. Frameworks help: Spring re-creates `@RefreshScope` beans after a refresh, and in ASP.NET Core `IOptionsSnapshot<T>` sees reloaded values where `IOptions<T>` does not. Some settings can't change on the fly at all, because they are read once at start: a connection pool size, a listening port, a thread count. Mark those keys as **needing a restart**, as `db.pool.size` is in the animation, and roll a restart through the instances when they change.

### Versions, snapshots and audit

Treat every change as a release that you may need to undo:

- **Versions.** Parameter Store keeps the 100 most recent versions of each parameter. Azure App Configuration records every change to a key-value, keeps that history for 7 days on its Free and Developer tiers and 30 days on Standard and Premium, and can restore the whole store or a single key to a point in time. AWS AppConfig deploys a specific version of a configuration, so the version that is live is always known.
- **Snapshots.** An Azure App Configuration snapshot is a named, immutable set of key-values, picked with key and label filters. An application can load a snapshot by name: moving to the next snapshot is a release, and moving back to the last known good one is a rollback.
- **Audit.** Record who read and who changed which key, and when; the Azure Architecture Center guidance asks for audit logs of both reads and writes. Send them to the same place as the rest of your logs ([centralized logging](../centralized-logging/)), because "what changed just before the incident?" is one of the first questions in every incident review. Log the configuration version that each instance runs, too.

### Deploying configuration safely

A configuration change reaches every instance faster than a code change does, which is the point of the pattern and its main danger. In a study of three months of high-impact incidents at Facebook, published at SOSP 2015, 16% were related to configuration management. On 18 November 2025 a Cloudflare feature file for bot management, regenerated with duplicate rows after a database permissions change, roughly doubled in size. It reached the whole network within minutes, exceeded a limit in the proxy software and caused about three hours of widespread failures. Cloudflare's follow-up includes treating files it generates itself with the same suspicion as input from users.

Ship configuration the way you ship code:

- **Validate before it goes live.** Check types, ranges and rules that span keys, with a schema or a function. AWS AppConfig runs JSON Schema or Lambda validators when a deployment starts, and if one fails the deployment stops before any target sees the change. In the system Facebook described in 2015, the configuration compiler ran validators on every change.
- **Review it.** A pull request on a configuration repository, or an approval step in the store, catches the mistake that a schema allows.
- **Roll it out gradually**, like a [canary release](../canary-release/): staging first, then a small share of production, then the rest, watching error rates at each step. AWS AppConfig deployment strategies do this in linear or exponential steps over a set time, followed by a bake time. The strategy AWS recommends for production, `AppConfig.Linear20PercentEvery6Minutes`, adds 20% of the targets every six minutes for 30 minutes and then watches alarms for another 30. With Azure App Configuration the same idea is built from snapshots: build and test a snapshot, then move instances to it step by step.
- **Roll back automatically.** If a CloudWatch alarm attached to the environment goes into alarm (or reports insufficient data) during an AWS AppConfig deployment, AppConfig rolls the configuration back to the previous version. Facebook's canary service, in the same paper, rolled changes out in phases and rolled them back on its own when health checks failed.
- **Don't edit production by hand.** Azure's App Configuration guidance recommends avoiding direct changes to production, for example from the portal. Keep a break-glass path for incidents, and log every use of it.

### When the store is down

The store is now a runtime dependency of every service that reads it. Plan for it to fail:

- **Cache in memory**, and keep serving the last values when a refresh fails. Azure's ASP.NET Core provider, for example, keeps using its cached configuration when a change check fails and tries again later.
- **Keep the last known good copy outside the process**, so that an instance can also start while the store is unreachable. The AWS AppConfig Agent can save a backup of each configuration in a directory (`BACKUP_DIRECTORY`) and loads it when it can't reach the service. In Facebook's Configerator, a proxy on each server kept configuration in an on-disk cache, and applications read that cache directly if the proxy itself failed. The Azure Architecture Center notes that an in-memory cache doesn't help an instance that starts during an outage, and suggests shipping the last known values with the deployment for that case. Copies on disk are usually unencrypted, so keep secrets out of them or lock the files down.
- **Decide what happens with no configuration at all.** Either fail fast, with a clear error and a failing readiness check, or start on safe defaults; never start half-configured without saying so. Spring Cloud Config's client, for example, carries on starting when it can't reach the server unless `spring.cloud.config.fail-fast` is set.
- **Make the store highly available.** Use zone redundancy and replicas, and read from the nearest replica. Azure App Configuration's providers discover replicas and fail over between them.
- **Spread the load.** A fleet restarting at once can get the store throttled. Cache, stagger refreshes and use longer intervals; in Azure, each geo-replica has its own request quota.

### Secrets: a separate store, reached by identity

A configuration store is built for values that many people may read. Secrets need encryption, tighter access, rotation and an audit of every read. Keep them apart:

- **Reference, don't copy.** An Azure App Configuration Key Vault reference stores only the secret's URI. The application resolves it in Key Vault with its own credentials, and the two services never talk to each other. Parameter Store can reference Secrets Manager secrets under `/aws/reference/secretsmanager/`, and Spring Cloud Config can serve values from Vault or a cloud secret manager.
- **Authenticate with the workload's identity**, not with a password stored next to the code. Azure's best practices point out that a connection string to the configuration store is itself a secret, and recommend Microsoft Entra ID with a managed identity instead.
- **Rotate.** AWS Secrets Manager rotates many secrets itself and the rest through a Lambda function. Google Secret Manager sends a Pub/Sub notification on a schedule you set (no more often than hourly), and your code creates the new version. Vault goes further with dynamic secrets: each one has a lease with a time to live, and Vault revokes the credential when the lease expires. The application has to pick up the new value: the Azure provider can reload Key Vault secrets on an interval, and Vault Agent renews or fetches secrets again before they expire.
- **Kubernetes Secrets need care.** Their values are base64-encoded, and base64 is an encoding, not encryption. By default they are stored unencrypted in etcd, and anyone allowed to create a Pod in a namespace can read every Secret in it. Turn on encryption at rest, grant access with least-privilege RBAC, or keep the secrets in an external store and sync them in.
- **Never log secrets.** Configuration dumps at start-up, debug endpoints and error messages are the usual leaks. Log key names and versions, never values; the Azure provider, for instance, logs which keys it updated but not their values. [Centralized logging](../centralized-logging/) covers redaction in the pipeline as a second line of defence.

### Configuration or feature flag?

Both are values read at runtime, and some stores serve both: Azure App Configuration and AWS AppConfig have feature flags built in. They differ in what they decide and how long they live:

- **Configuration** tunes how the system runs (timeouts, endpoints, limits, pool sizes). It is the same for every user in an environment, and it is permanent.
- **A [feature flag](../feature-flags/)** decides which code path runs, often per user or per segment, with targeting rules and percentage rollouts. A release flag is temporary and is deleted once the feature is out.

If a value needs targeting rules, it is a flag; if it varies by environment and stays for good, it is configuration.

### Configuration in Git

Many teams keep configuration in a Git repository and let a pipeline or an agent apply it. Changes then get pull-request review, history and a revert for free. Spring Cloud Config uses a Git repository as its default backend; Azure App Configuration can import configuration files from a repository with GitHub Actions or a pipeline task; and on Kubernetes, GitOps tools keep ConfigMaps in the cluster matched to the repository. Kustomize's ConfigMap generator adds a hash of the content to the generated name and rewrites the references to it, so a changed value produces a new ConfigMap and the Deployment that uses it rolls out like any other change. A repository is not a secret store: keep secrets out of it, or commit them only encrypted.

## When to use it

- Several environments, regions or tenants run the same build with different settings.
- Operators need to change settings without a release: timeouts, limits, endpoints during a failover.
- Many services or instances share settings, such as a queue URL or a rate limit, and must agree on them.
- You have to show who changed what and when, for compliance or for incident reviews.

**When not to:**

- **Values that never differ between environments belong in the code**, reviewed and tested with it: a route table, a default retry policy, the choice of an algorithm. Moving them into a store only adds a way to change production without review.
- **One application, one environment**, with settings that change only with a release: the Azure Architecture Center notes that the store then adds complexity for little gain.
- **What the application needs in order to reach the store** (its endpoint, the environment name, the identity to use) has to come from the platform, usually as environment variables.

## Trade-offs

- **A new runtime dependency.** Every service now needs the store to start, unless it keeps a copy. The store's availability, latency and quotas become part of yours.
- **Fast changes, fast mistakes.** A configuration change skips the code pipeline unless you route it through one, and it reaches the whole fleet in seconds.
- **Harder to reproduce a failure.** "Which values were live when this request failed?" needs configuration versions in logs, traces and deployment records.
- **Environments drift.** A value changed by hand in production never makes it back to staging. Manage the store's contents as code, or at least compare environments regularly.
- **Mixed versions during a change.** Instances refresh at different moments, so for a while some run the old values and some the new. Use a sentinel key or a snapshot so that related values switch together, and make sure the system works with both versions live for a short time.
- **Cost and limits.** AWS AppConfig is billed per configuration request, Parameter Store's higher throughput costs extra, and Azure App Configuration throttles stores that send too many requests.

## Implementation notes

- **Products, as examples:**
  - **Azure App Configuration** with Key Vault references for secrets, snapshots for releases and a Kubernetes provider that writes ConfigMaps and Secrets.
  - **AWS AppConfig**, which deploys configuration kept in its own hosted store, in Parameter Store, Secrets Manager or Amazon S3, with validators, deployment strategies and alarm-based rollback. **AWS Systems Manager Parameter Store** on its own suits simpler cases: an update takes effect on the next read, with no validation beyond an optional regular expression, and no gradual rollout or automatic revert. **AWS Secrets Manager** holds the secrets.
  - **Google Cloud Secret Manager**, and Parameter Manager, an extension of it for versioned YAML, JSON or plain-text configuration that can reference secrets.
  - **HashiCorp Consul**'s key/value store (values of up to 512 KB) for settings, with **Vault** for secrets.
  - **Kubernetes ConfigMaps and Secrets** (each limited to 1 MiB), often filled by one of the tools above. Mark them `immutable` when they should never change in place: that has been stable since Kubernetes 1.21, and in clusters with many ConfigMaps it also takes load off the API server.
  - **Spring Cloud Config Server**, backed by Git, Vault, a database or a cloud store.
- **Bootstrap with the minimum.** The environment name, the store's endpoint and the identity come from the platform; everything else comes from the store.
- **Bind and validate at load time.** Bind configuration to typed objects and validate them at start and on every reload. If a reload fails validation, keep the previous values and raise an alert.
- **Show the version, never the values.** Expose the configuration version on an info endpoint and in logs, so anyone can see what an instance runs.
- **Give every key an owner**, through a prefix per service or team, and delete keys that nobody reads any more.
- **Test the failure.** In staging, block access to the store and restart an instance: it should start from its last known good copy, or fail the way you designed it to.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Feature Flags](../feature-flags/) — Deploy code dark, then turn features on per user or percentage at runtime.
- [Immutable Infrastructure](../immutable-infrastructure/) — Never patch servers in place: bake a new image and replace them.
- [GitOps](../gitops/) — Git holds the desired state; an agent continuously reconciles the cluster to match it.
- [Sidecar](../sidecar/) — Run helper capabilities (proxy, logging, config) in a separate process next to the app.
- [Canary Release](../canary-release/) — Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back.
- [OAuth 2.0 Client Credentials](../oauth2-client-credentials/) — Machine-to-machine access tokens, with no user involved.
- [Blue-Green Deployment](../blue-green-deployment/) — Run the new version beside the old one and switch all traffic in one step.
- [Microservices](../microservices/) — Small, independently deployable services, each owning one business capability and its data.

## References

- [Azure Architecture Center — External Configuration Store pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/external-configuration-store)
- [The Twelve-Factor App — III. Config](https://12factor.net/config)
- [Azure App Configuration — Best practices](https://learn.microsoft.com/en-us/azure/azure-app-configuration/howto-best-practices)
- [Azure App Configuration — Tutorial: Use dynamic configuration in an ASP.NET Core app](https://learn.microsoft.com/en-us/azure/azure-app-configuration/enable-dynamic-configuration-aspnet-core)
- [Azure App Configuration — Tutorial: Use Key Vault references in an ASP.NET Core app](https://learn.microsoft.com/en-us/azure/azure-app-configuration/use-key-vault-references-dotnet-core)
- [Azure App Configuration — Snapshots](https://learn.microsoft.com/en-us/azure/azure-app-configuration/concept-snapshots)
- [AWS AppConfig — Working with deployment strategies](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-creating-deployment-strategy.html)
- [AWS AppConfig — Understanding validators](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-creating-configuration-and-profile-validators.html)
- [AWS AppConfig — Monitoring deployments for automatic rollback](https://docs.aws.amazon.com/appconfig/latest/userguide/monitoring-deployments.html)
- [AWS AppConfig — Using environment variables to configure AWS AppConfig Agent for Amazon ECS and Amazon EKS](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-integration-containers-agent-configuring.html)
- [AWS Systems Manager — Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html)
- [Google Cloud — Create rotation schedules in Secret Manager](https://docs.cloud.google.com/secret-manager/docs/secret-rotation)
- [HashiCorp Vault — Lease, renew, and revoke](https://developer.hashicorp.com/vault/docs/concepts/lease)
- [Kubernetes — ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/)
- [Kubernetes — Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)
- [Spring Cloud Config — Reference documentation](https://docs.spring.io/spring-cloud-config/reference/)
- [Chunqiang Tang et al. — Holistic Configuration Management at Facebook (SOSP 2015)](https://sigops.org/s/conferences/sosp/2015/current/2015-Monterey/printable/008-tang.pdf)
- [Cloudflare — Cloudflare outage on November 18, 2025](https://blog.cloudflare.com/18-november-2025-outage/)
- [OWASP — Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
