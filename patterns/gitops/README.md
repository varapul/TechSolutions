<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🚀 Deployment & Release](../../README.md#deployment--release)

# GitOps

> Git holds the desired state; an agent continuously reconciles the cluster to match it.

<p align="center"><img src="diagram.svg" alt="Animated diagram: GitOps" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/gitops.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Push from CI, edit by hand** | The pipeline deploys by running `kubectl apply` against the cluster with administrator credentials stored in CI. During an incident an operator scales the deployment to 10 and raises a timeout by hand; neither change is written back anywhere, so the next deployment silently puts 3 replicas and the old timeout back. Nobody can say exactly what is running, or why. |
| **2 · Desired state lives in Git** | Every change is a pull request to the configuration repository. Here CI builds and pushes image **v43**, then opens a PR that sets `image: v43` and `replicas: 4` for production. After review and merge, the agent inside the cluster pulls the new commit, sees that the live state no longer matches it (**OutOfSync**) and applies the difference. CI only builds images and proposes changes; the credentials that can change the cluster never leave it. |
| **3 · Drift is reconciled** | Someone scales the deployment to 10 replicas by hand. The agent keeps comparing the live state with Git, reports **OutOfSync**, and because self-healing is on it puts the count back to 4; with self-healing off it would only report the drift, so an alert can fire instead. A change that should stay has to go through Git. |
| **4 · Roll back and promote** | v43 misbehaves. Reverting its commit is an ordinary, reviewed pull request: once it merges, the agent returns the cluster to v42 and 3 replicas, and the rollback stays in the history like any other change. Promotion works the same way, as a PR that copies the image tag from `envs/staging/` to `envs/prod/`. Secrets never sit in Git as plain text: they are committed encrypted (SOPS, Sealed Secrets) or as references to an external secret store. |
<!-- END GENERATED: header -->

## The problem

In many teams the pipeline is the only way software reaches production, and it reaches it by pushing: the last stage runs `kubectl apply` or `helm upgrade` against the cluster, using credentials stored in the CI system. Those credentials usually carry administrator rights, because the pipeline has to create anything the manifests describe. Around that pipeline, people keep changing the cluster directly. During an incident someone scales a deployment, raises a timeout or patches a ConfigMap from a terminal, and nobody writes the change back into the manifests.

That combination fails in quiet ways:

- **Fixes disappear.** The next pipeline run applies the manifests again. For every field the manifests set, `kubectl apply` puts the old value back, so the incident fix is gone and the incident can return. Fields the manifests do not mention keep their hand-made values, so the cluster ends up as a mix of the two.
- **Nobody knows what is running.** The only complete record of the cluster is the cluster. Answering "which version is live, with which settings, and since when?" means inspecting objects one by one, and answering "why?" usually needs whoever was on call that night.
- **Rollback is guesswork.** Going back means re-running an old pipeline and hoping the environment around it has not changed in the meantime.
- **The pipeline is a master key.** Every CI system, runner and plugin that can see the deployment credentials can change production. A leaked token or a compromised build step reaches every cluster the pipeline can reach.

## How it works

GitOps turns the flow around. The desired state of each environment is declared in Git, and an agent running inside the cluster pulls it and keeps the cluster matching it.

1. **Declare the desired state.** A configuration repository holds the manifests for every environment: here a folder for `envs/prod/` that pins `image: shop:v42` and `replicas: 3`, and one for staging.
2. **CI builds, but does not deploy.** The pipeline builds and tests the code, pushes image **v43** to the registry, and then proposes the change: it opens a pull request against the configuration repository (or a bot does, see image automation below). It holds no credentials for the cluster.
3. **Review and merge is the approval.** The pull request shows exactly what changes in production (`v42 → v43`, `3 → 4`). Once it is reviewed and merged, the new commit is the new desired state, and the commit history becomes the deployment log.
4. **The agent pulls and applies the difference.** The agent inside the cluster notices the new commit, by polling or through a webhook, renders the manifests, compares them with the live objects and applies only what differs. While the two differ, the application is reported **OutOfSync**; once they match, **Synced**.
5. **It keeps reconciling.** The comparison does not stop after the deployment. When someone scales the deployment to 10 by hand, the agent sees the live state drift away from Git. With self-healing on, it puts the count back to 4; with self-healing off, it reports the drift and an alert can fire. A change that should stay goes through Git.
6. **Rollback and promotion are commits.** Reverting the commit that introduced v43 is a pull request like any other; once merged, the agent returns the cluster to v42. Promoting a version from staging to production is a pull request that copies the tag from one environment's folder to the other.

| | Push-based delivery | Pull-based GitOps |
|---|---|---|
| **Who changes the cluster** | The pipeline, from outside, plus anyone with credentials | An agent running in the cluster |
| **Where cluster credentials live** | In CI, often with administrator rights | Inside the cluster, with the agent |
| **When the cluster is checked against the source** | Only when a pipeline runs | Continuously, every few minutes or on each commit |
| **Manual changes** | Persist unnoticed until the next deploy overwrites them | Reported at once, and undone if self-healing is on |
| **Rollback** | Re-run an old pipeline | Revert a commit |
| **Record of what is running and why** | Pipeline logs, if kept | Git history and pull request reviews |

### The four principles

The OpenGitOps project, a CNCF Sandbox project since January 2021, published **GitOps Principles v1.0.0**. They describe the desired state of a GitOps-managed system as:

1. **Declarative.** The system's desired state is written down as a description of what should exist, not as steps to get there.
2. **Versioned and Immutable.** That description is stored somewhere that keeps every version, never edits a version in place, and retains the full history.
3. **Pulled Automatically.** Software agents fetch the desired state from that store on their own; nobody pushes it to them.
4. **Continuously Reconciled.** The agents keep observing the actual state and keep working to make it match the desired state.

The principles never say "Git". Git is the usual store because it already provides versions, history, review and access control, but Flux, for example, can also reconcile from OCI artifacts in a container registry or from an S3-compatible bucket, and its documentation describes a "Gitless GitOps" model in which people still edit Git while the clusters pull configuration artifacts from a registry.

### Where the name comes from

The term comes from Weaveworks. In 2017 the company introduced it in a blog post, *GitOps — Operations by Pull Request*, that described how it ran its own Kubernetes-based service: everything declared in Git, every operational change made by pull request, and an operator in the cluster (then called Weave Flux) keeping the running system in line with the repository. Its CEO, Alexis Richardson, presented the idea with William Denniss of Google at KubeCon North America on 7 December 2017 (the session is listed in the references), and looked back on it a year later in a post titled *What Is GitOps Really?*. The original post is no longer at its old address. Flux, which grew out of that operator, and Argo CD, part of the Argo project that Applatix open-sourced in 2017 before Intuit acquired the company, are the two best-known agents today.

### Push versus pull: why security teams care

- **Credentials.** In push-based delivery the pipeline needs credentials that can change the cluster, and so does every runner, plugin and secret store involved. In pull-based delivery the agent uses its own service account inside the cluster. CI needs only permission to push images and to open pull requests.
- **Blast radius of a compromised pipeline.** An attacker who controls a push pipeline can deploy anything to every cluster it reaches. An attacker who controls a pull-based pipeline can push an image or open a pull request, and both still have to pass review and branch protection before anything runs. The attack surface moves to the configuration repository, which therefore needs real protection (see below).
- **Network direction.** The agent makes outbound connections to Git and to the registry. Nothing outside needs a route into the cluster's API server, which helps when clusters sit in private networks.
- **The hub-and-spoke caveat.** One Argo CD instance can manage many remote clusters. It then stores a credential for each cluster as a Kubernetes Secret and acts on those clusters from outside, which is push again, only from a better-protected place. Running an agent in every cluster keeps the credentials local; a central instance is easier to operate. Choose deliberately, and protect a central instance as carefully as the clusters it controls.

### Laying out the repositories

- **Application code and configuration apart.** Argo CD's best-practice guide recommends separate repositories: changing a replica count should not trigger a build, the configuration history becomes a clean audit log of what changed in each environment, different people need write access to each, and a pipeline that commits to the repository it builds from can trigger itself in a loop.
- **A folder per environment, not a branch per environment.** Keep every environment in one branch, with one folder each (`envs/staging/`, `envs/prod/`), as Flux's repository-structure guide shows. Promotion is then a small pull request that copies a tag or digest between folders, and a diff between folders shows exactly how environments differ. Long-lived branches per environment tend to drift apart, and every merge between them can carry unrelated changes along.
- **Templating.** Few teams write every manifest by hand for every environment. **Kustomize** keeps a shared base and a small overlay per environment that patches only what differs; **Helm** renders a chart with a values file per environment. Both Argo CD and Flux render them in the cluster. Some teams commit the fully rendered manifests instead, so that reviewers see the exact objects that will be applied.
- **Image updates.** Someone has to change the tag in Git when a new image appears. CI can open the pull request itself, as in the diagram. Flux's image automation does it from the cluster side: `ImageRepository` scans a registry, `ImagePolicy` picks the newest tag that matches a rule such as a semantic version range, and `ImageUpdateAutomation` commits the change to Git, guided by markers in the YAML. It can commit straight to the branch the cluster follows, or push to a separate branch from which CI opens a pull request, so that someone approves each update first. For Argo CD, the separate Argo CD Image Updater project does the same job and can write the change back to Git.
- **Pin what you deploy.** A tag can be moved to another image; a digest cannot. Pinning digests, or using a registry that makes tags immutable, makes the commit a precise record of what runs. See [immutable infrastructure](../immutable-infrastructure/).

### Tools

Both projects below graduated in the Cloud Native Computing Foundation in 2022: Flux on 30 November and Argo, which includes Argo CD, on 6 December.

- **Argo CD** models each deployment as an *Application*: a source (a Git path, Helm chart or Kustomize overlay) and a destination cluster and namespace. It shows sync status and health for every resource in a web UI and CLI.
  - **Automated sync** applies new commits without a click. Two safety switches are off by default: **prune** (delete live resources that were removed from Git) and **self-heal** (re-sync when the live state drifts while Git has not changed). With self-heal on, Argo CD retries after a short timeout, 5 seconds by default.
  - **Health checks** assess each resource as Healthy, Progressing, Degraded, Suspended, Missing or Unknown, with built-in rules for common kinds and custom rules for the rest.
  - **ApplicationSets**, bundled with Argo CD since version 2.3, generate many Applications from one template, driven by generators such as a list, the registered clusters, the directories in a Git repository, or open pull requests.
  - Its own rollback command is disabled while automated sync is on, so with automation the rollback is a Git revert, which is the point.
- **Flux** is a set of controllers, the GitOps Toolkit, each reconciling its own custom resources:
  - the **source controller** fetches `GitRepository`, `OCIRepository`, `Bucket` and Helm repository sources and turns them into versioned artifacts;
  - the **kustomize controller** applies a `Kustomization`: it builds the manifests, applies them with server-side apply, prunes objects removed from the source, waits for health checks, orders itself after other Kustomizations with `dependsOn`, and decrypts SOPS-encrypted secrets;
  - the **helm controller** manages `HelmRelease` objects and can detect, and optionally correct, drift from the release it installed;
  - the **notification controller** sends alerts to chat and other systems, reports status back to Git providers as commit statuses, and receives webhooks that trigger an immediate reconciliation;
  - the **image reflector** and **image automation** controllers, optional extras, implement the image updates described above.

### Intervals, ordering and health

- **How quickly changes arrive.** Argo CD polls each repository every 3 minutes by default: 120 seconds plus up to 60 seconds of random jitter so that applications do not all poll at once. Flux objects each carry their own `interval`; at every interval the Kustomization re-applies its source and corrects drift. Both accept webhooks from the Git host, so a merge can be applied within seconds while polling remains the safety net. Polling intervals also bound how long drift can go unnoticed.
- **Ordering.** Some objects must exist before others: namespaces and custom resource definitions before the resources that use them, a database migration before the new version. Argo CD runs a sync in phases (PreSync, Sync, PostSync, with SyncFail for clean-up) and, within a phase, in **sync waves**: an integer annotation, `argocd.argoproj.io/sync-wave`, where lower waves are applied first, negative values are allowed, and the next wave starts only when the previous one is in sync and healthy. Flux orders whole Kustomizations with `dependsOn` and can wait for their health checks to pass before a dependent one starts.
- **Synced is not the same as working.** Sync status says the cluster matches Git; health says the Kubernetes objects are in a good state. A synced application can be degraded, and a healthy one can still be returning errors that only your monitoring sees. Watch both, plus the application's own [health endpoints](../health-endpoint-monitoring/) and error rates, as in step 4 of the diagram.

### Drift: detect it, and decide what to heal

Self-healing is what makes the cluster trustworthy, but not every difference from Git is a mistake:

- **Autoscalers own replica counts.** When a Horizontal Pod Autoscaler manages a deployment, the Kubernetes documentation recommends removing `spec.replicas` from the manifest; otherwise every apply resets the count to the manifest's value. If the field has to stay, tell the agent to leave it alone: Argo CD's `ignoreDifferences` on `/spec/replicas`, combined with the `RespectIgnoreDifferences=true` sync option so that a sync does not overwrite it either, or `spec.ignore` rules on a Flux `Kustomization` (`driftDetection.ignore` on a `HelmRelease`). Argo CD's best-practice guide calls this leaving room for imperativeness. See [autoscaling](../autoscaling/).
- **Other controllers write fields too.** Admission webhooks inject sidecars and defaults, operators annotate objects, and some controllers reorder lists. Kubernetes **server-side apply** records which *field manager* owns each field, and reports a conflict when an applier tries to change a field that another manager owns, unless the applier forces the change. Flux applies with server-side apply, and Argo CD can with the `ServerSideApply=true` sync option, which forces conflicts. Where another controller legitimately owns a field, add an ignore rule instead of letting the agent and the controller take turns overwriting it.
- **Incidents need a break-glass path.** During an outage a responder may need a change faster than a review allows. Make that a documented step: suspend reconciliation for the affected application (Flux's `suspend`, or turning off Argo CD's automated sync), make the change, record it, and follow up with a pull request before resuming. Otherwise the agent quietly reverts the fix, which is the same failure as in step 1, only faster.
- **Prune with care.** Deleting a file from Git deletes the live objects once pruning is on, including anything stateful. Keep prune off until the repository is trusted, and protect objects that must never be removed automatically, for example with Argo CD's `Prune=false` sync option or Flux's `kustomize.toolkit.fluxcd.io/prune: disabled` label or annotation.

### Secrets

A Git repository is copied to every laptop and CI runner that clones it, and its history is forever, so secrets must never be committed as plain text. The usual options:

- **Sealed Secrets** (Bitnami): `kubeseal` encrypts a Secret with the public key of a controller running in the target cluster. The resulting `SealedSecret` can sit even in a public repository, because only that controller can decrypt it and turn it back into a Secret.
- **SOPS**, a CNCF Sandbox project: encrypts only the values in a YAML, JSON, INI or dotenv file, with AES-256 in GCM mode, and leaves the keys readable, so reviewers can still see which setting changed. The data keys are protected with age or PGP keys, or with a cloud KMS or HashiCorp Vault. Flux's kustomize controller decrypts SOPS files during reconciliation, inside the cluster; the diagram shows such a value as `ENC[AES256…]`.
- **References to an external secret store.** The **External Secrets Operator** keeps only an `ExternalSecret` reference in Git and copies the value from AWS Secrets Manager, Azure Key Vault, HashiCorp Vault and other stores into a Kubernetes Secret, and keeps the two in sync. The secret then has one home outside Git, with its own access control and rotation. See [external configuration store](../external-configuration-store/).

Argo CD's own guidance strongly prefers creating secrets in the destination cluster in these ways over injecting them while it generates manifests, partly because it keeps generated manifests in plain text in its Redis cache.

### Progressive delivery

GitOps decides *what* should run; it does not decide how traffic moves to it. By default a Kubernetes Deployment replaces pods with a [rolling update](../rolling-update/). For more control, a progressive-delivery controller sits in the cluster next to the agent, and its own resources are declared in Git like everything else:

- **Argo Rollouts** replaces the Deployment with a `Rollout` resource that supports [blue-green](../blue-green-deployment/) and [canary](../canary-release/) strategies, shifts traffic through ingress controllers or service meshes, and runs automated analysis against metrics to promote or abort.
- **Flagger**, part of the Flux family and graduated with it, automates canary, A/B and blue-green releases for existing Deployments on service meshes, ingress controllers and the Gateway API, checking metrics at each step.

The commit says "v43 is the version"; the controller decides how quickly users receive it, and rolls back on its own if the metrics turn bad, without a commit. Recording that outcome back in Git, by reverting the tag, keeps the two in agreement.

### Feature flags are not deployments

A deployment puts code in production; a [feature flag](../feature-flags/) decides who sees it. GitOps is good at the first: slow, reviewed, versioned changes to what runs. Flag changes need to take effect in seconds, often for a slice of users, and are usually made in a flag service at runtime. Some teams keep flag definitions in Git too, but routing every flag flip through a pull request and a reconciliation loop makes the most useful property of flags, instant reversal, slower.

### Many clusters and environments

The same repository can describe many clusters. Argo CD's ApplicationSets stamp out one Application per cluster or per directory; Flux keeps a folder per cluster (`clusters/production`, `clusters/staging`) that points at shared app and infrastructure definitions, with an agent in each cluster. Adding a cluster becomes adding a folder or registering a cluster, which is what [deployment stamps](../deployment-stamps/) need: many identical copies of a unit, each pulling the same description with its own small overlay. Roll changes out across clusters in waves, through promotion pull requests, rather than to all of them at once.

### Beyond Kubernetes

Kubernetes is the natural home of GitOps because its API is declarative and controllers already reconcile. The same loop can manage resources outside the cluster when a controller translates them: **Crossplane**, which graduated in the CNCF in October 2025, extends a Kubernetes control plane with providers that create and continuously reconcile cloud resources such as databases, buckets and networks from custom resources. A GitOps agent then applies those resources like any others. Classic [immutable infrastructure](../immutable-infrastructure/) and infrastructure as code fit alongside: Terraform or OpenTofu describe infrastructure as code too, but usually apply it from a pipeline, which is push-based delivery with a plan step, and detect drift only when a plan runs, by hand or on a schedule.

### Git is now part of production

Whoever can merge to the configuration repository can change production, so protect it accordingly:

- **Branch protection and required reviews** on the main branch, with code owners for each environment folder, so production changes need the right approvers and passing checks. Nobody, including CI, pushes straight to it.
- **Signed commits.** Require them on the Git host, and have the agent verify them: Flux's `GitRepository` can reject commits or tags not signed by a trusted OpenPGP or SSH key, and Argo CD can refuse to sync commits without a trusted GnuPG signature (configured as source integrity rules on a project in current versions; the older `signatureKeys` setting is deprecated).
- **Least privilege for the agent.** An agent with cluster-admin rights turns a bad commit into a cluster-wide change. Argo CD *AppProjects* restrict which repositories an application may use, which clusters and namespaces it may deploy to and which kinds of objects it may create. Flux can impersonate a separate service account per Kustomization or HelmRelease, so each team's sources can only do what that account allows.
- **Least privilege for CI.** Give the pipeline a token that can open pull requests on the configuration repository, not merge them.
- **Validate before merge.** Render the manifests in CI (`kustomize build`, `helm template`) and check them against schemas and policy, so that review covers the objects that will actually be applied.

### Watching it

The agent's status is an operational signal in its own right. Argo CD exposes sync and health status per application as Prometheus metrics and in its UI, and Argo CD Notifications ships triggers such as `on-sync-failed` and `on-health-degraded`; a custom trigger can fire on OutOfSync. Flux records conditions and events on every object, and its notification controller can post alerts to chat and set commit statuses on the Git provider, so a commit shows whether it reached the cluster. Alert on applications that stay OutOfSync, on failed or stalled reconciliations, and on drift that keeps coming back, which usually means a process or a controller is still changing the cluster behind Git's back.

## When to use it

- **Kubernetes, or any platform with a declarative API and controllers**, especially with several clusters or environments to keep consistent.
- **Teams that already work through pull requests** and want production changes to follow the same review, history and access rules as code.
- **Audit and compliance requirements**, where "who changed what, when, and who approved it" must be answerable from a record rather than from memory.
- **Environments that must be rebuilt quickly**, since a new cluster can be pointed at the repository and converge to the declared state.

**When not to:**

- **Systems without a declarative API.** Legacy servers, appliances and SaaS products configured through imperative calls or consoles have nothing for an agent to reconcile against, unless someone writes a controller.
- **State that changes constantly by design.** Replica counts under an autoscaler, per-request jobs, data and anything an operator or the application itself manages should stay out of Git, or be explicitly ignored.
- **Small setups.** One service in one cluster, deployed by a small team, may be better served by a simple pipeline with a deploy step and good credentials hygiene. An agent, its access rules, secret encryption and a second repository are real overhead.

## Trade-offs

- **Another privileged component.** The agent can change everything it manages, so it has to be secured, upgraded and monitored like any part of the control plane.
- **Git becomes production-critical.** The repository's security matters as much as the cluster's. Its availability matters less: clusters keep running when Git is down, but no change can be deployed.
- **Emergency changes are slower.** The review that protects production also delays a 3 a.m. fix, unless there is a break-glass path.
- **Two views of "deployed".** "Merged" is not "running": a sync can fail, wait in a later wave or be blocked by health checks. Developers need the sync status, not only the merge.
- **Templating hides the result.** With Helm and Kustomize, the diff in a pull request is not the diff in the cluster. Rendering in CI, or committing rendered manifests, closes the gap at the cost of more files.
- **Secrets need extra machinery.** Sealed Secrets, SOPS keys or an external secret store all add components and key management.
- **Pull request noise.** Image automation and many environments produce many small pull requests and commits; group or automate the routine ones.

## Implementation notes

- **Adopt it in stages.** Start with one application. Where the agent allows it (Argo CD with automated sync off, for example), let it only report differences at first and fix the drift it finds; then turn on automated sync, then self-healing, and enable pruning last.
- **One source of truth per object.** Every live object should be managed by exactly one Application or Kustomization. Two agents, or an agent and a pipeline, applying the same object will fight.
- **Make the deployed version visible.** Show the commit and image digest in the sync status, as commit statuses on the Git provider, and in the application's own health endpoint.
- **Write the break-glass runbook before you need it.** Who may suspend reconciliation, how the change is recorded, and how the cluster is brought back under Git afterwards.
- **Rehearse rollback.** Revert a commit in staging and watch the agent apply it, so the first revert in production is not the first ever.
- **Keep secrets out of history from day one.** A secret committed once in plain text stays in the history: rotate it, do not just delete the file.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Immutable Infrastructure](../immutable-infrastructure/) — Never patch servers in place: bake a new image and replace them.
- [External Configuration Store](../external-configuration-store/) — Keep configuration out of the deployment package, in a central store read at runtime.
- [Canary Release](../canary-release/) — Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back.
- [Blue-Green Deployment](../blue-green-deployment/) — Run the new version beside the old one and switch all traffic in one step.
- [Rolling Update](../rolling-update/) — Replace instances batch by batch while the service stays up.
- [Deployment Stamps](../deployment-stamps/) — Deploy many independent copies of the whole stack, each serving a subset of tenants.
- [Feature Flags](../feature-flags/) — Deploy code dark, then turn features on per user or percentage at runtime.

## Related components and services

- [Docker & Containers](../docker/) — Package an app and its dependencies as an image and run it as an isolated process: layers, registries, namespaces, cgroups.
- [Kubernetes](../kubernetes/) — A container orchestrator: you declare the desired state, and controllers keep pods scheduled, healthy and reachable.

## Related principles and frameworks

- [Continuous Delivery](../continuous-delivery/) — Keep every change releasable: a deployment pipeline builds once, tests in stages and promotes the same artifact to production.
- [Eliminating Toil](../eliminating-toil/) — Find the manual, repetitive operations work that grows with the system, measure it, cap it and automate it away.
- [Infrastructure as Code](../infrastructure-as-code/) — Define infrastructure in version-controlled code: review a plan, apply it the same way in every environment and catch drift.
- [Platform as a Product](../platform-as-a-product/) — An internal developer platform run like a product: developers are its customers, self-service is its interface, adoption is earned.
- [Supply Chain Security (SLSA)](../supply-chain-security/) — Prove that what you deploy was built from your source: build provenance, SBOMs, signatures and a check before every deploy.

## References

- [OpenGitOps — GitOps Principles v1.0.0](https://github.com/open-gitops/documents/blob/v1.0.0/PRINCIPLES.md)
- [KubeCon + CloudNativeCon North America 2017 — GitOps: Operations by Pull Request (Alexis Richardson, William Denniss)](https://kccncna17.sched.com/event/CU6y/gitops-operations-by-pull-request-b-alexis-richardson-weaveworks-william-denniss-google)
- [Argo CD — Core concepts](https://argo-cd.readthedocs.io/en/stable/core_concepts/)
- [Argo CD — Automated sync policy](https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/)
- [Argo CD — Best practices](https://argo-cd.readthedocs.io/en/stable/user-guide/best_practices/)
- [Flux — Core concepts](https://fluxcd.io/flux/concepts/)
- [Flux — Automate image updates to Git](https://fluxcd.io/flux/guides/image-update/)
- [Flux — Ways of structuring your repositories](https://fluxcd.io/flux/guides/repository-structure/)
- [CNCF — Argo has graduated (December 2022)](https://www.cncf.io/announcements/2022/12/06/the-cloud-native-computing-foundation-announces-argo-has-graduated/)
- [CNCF — Flux graduates from the CNCF incubator (November 2022)](https://www.cncf.io/announcements/2022/11/30/flux-graduates-from-cncf-incubator/)
- [Kubernetes — Server-Side Apply](https://kubernetes.io/docs/reference/using-api/server-side-apply/)
- [Bitnami — Sealed Secrets](https://github.com/bitnami/sealed-secrets)
- [SOPS: Secrets OPerationS](https://getsops.io/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
