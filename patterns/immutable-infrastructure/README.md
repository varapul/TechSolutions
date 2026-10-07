<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🚀 Deployment & Release](../../README.md#deployment--release)

# Immutable Infrastructure

> Never patch servers in place: bake a new image and replace them.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Immutable Infrastructure" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/immutable-infrastructure.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Servers drift apart** | Three servers started out identical. Months of fixes typed into a terminal, and scripts that stopped half-way, left them different: web-1 got a newer library, web-2 kept a timeout raised during an incident, and web-3 missed a patch. Now a bug shows up on web-3 only, and nobody can rebuild web-3 exactly as it is. |
| **2 · Bake once, launch all** | A pipeline turns code into a versioned machine image, with the operating system packages, runtime, application and default configuration baked in. The image is tested once and stored in a registry as **v42**, and every server is launched from it, so all three are identical and another one can be added at any time, for example by [autoscaling](../autoscaling/). |
| **3 · Change means replace** | A security patch is released. Nobody logs in to apply it: the pipeline bakes **v43**, and servers launched from v43 replace the v42 ones, with a [rolling update](../rolling-update/) or a [blue-green switch](../blue-green-deployment/). Rolling back means launching v42 again, and login access is removed, or kept for audited emergencies only, so drift cannot creep back in. |
| **4 · Keep state outside** | Replacing a server must lose nothing, so nothing that matters may live only on it. Data stays in databases and storage outside the server, settings and secrets for each environment are fetched from an external configuration store when it starts, and logs leave the server as they are written ([centralized logging](../centralized-logging/)). Here web-3 is replaced, and the data, the settings and the logs stay where they are. |
<!-- END GENERATED: header -->

## The problem

A server that is changed in place collects history. It is patched, upgraded and tuned for months or years, by people at a terminal and by scripts, one server at a time. Some changes reach every server and some reach one. Some scripts stop half-way. Some changes are made in the middle of an incident and never written down. Servers that were built identically stop being identical. Martin Fowler calls these unrecorded, ad hoc changes **configuration drift**, and the end state a **snowflake server**: a machine with a configuration of its own that nobody can reproduce and everybody is afraid to touch.

Drift turns into concrete trouble:

- **Bugs that live on one host.** One instance in three fails, and the difference that causes it is one of hundreds between them.
- **No way back.** When a snowflake's disk dies, or its region is lost, nobody can build another one exactly like it. The only complete description of the server is the server.
- **Tests that prove little.** A test environment changed by other hands over other months is not the production environment, so a change that passed there can still break production.
- **Patches wait.** Every in-place upgrade is a small experiment on a machine nobody fully understands, so security fixes are postponed and the exposure grows.

Configuration management tools that re-apply a desired state on a schedule (Puppet, Chef, Ansible) reduce drift but do not remove it. As Fowler points out in his *PhoenixServer* entry, re-applying configuration only corrects the parts of a system the tool has been told to manage; everything outside them is still free to drift.

## How it works

The rule is short: **once a server is running, nobody changes it.** Every change produces a new image, and new servers launched from that image replace the old ones.

1. **The server is defined as code.** An image recipe (a Packer template, a Dockerfile, an EC2 Image Builder recipe) lives in version control next to the application. It names a base image and lists what goes on top: operating system packages and patches, the runtime, the application build, agents such as the log shipper, and configuration defaults that are the same in every environment.
2. **A pipeline bakes the image.** On every change it builds the image, boots and tests it, scans it, and publishes it to a registry under a new version (v42) and an identifier for exactly those bytes: a content digest for a container image, an image ID for a machine image. The image is built and tested once, then promoted unchanged from test to production.
3. **Every server is launched from an image version.** The launch template, instance group or deployment manifest names the image, so all instances are identical, and adding one is the same operation as adding a hundred. That is what makes [autoscaling](../autoscaling/) safe.
4. **A change means a new image and new servers.** An application release, a security patch or a new default all go through the pipeline and come out as v43. Servers launched from v43 replace the v42 ones with a [rolling update](../rolling-update/), a [blue-green switch](../blue-green-deployment/) or a [canary release](../canary-release/). Rolling back means launching v42 again: it is still in the registry, unchanged.
5. **The doors are closed.** With nothing left to do on a running server, login access is removed, or kept for emergencies only and audited. That is what stops drift from creeping back.
6. **Whatever must survive lives elsewhere.** Data goes to databases and storage that outlive any instance, settings and secrets are fetched when a server starts, and logs, metrics and traces leave the server as they are produced. Replacing a server then loses nothing.

| | Mutable servers | Immutable servers |
|---|---|---|
| **How a change arrives** | Applied to running servers: a shell session, a script, a configuration management run | Baked into a new image; servers launched from it replace the old ones |
| **State of the fleet** | Drifts; servers that started identical diverge | Every server matches one image version |
| **Rollback** | Undo the change on each server, if anyone knows how | Launch the previous image again |
| **Typical server lifetime** | Months to years | Hours to weeks |
| **Login access** | Routine | None, or audited emergencies only |

### Where the names come from

- **Snowflake server** and **phoenix server** are two entries Martin Fowler published on his bliki on 10 July 2012. A snowflake is the unique, hand-tuned server described above. A phoenix server is burned down regularly and rebuilt from scratch, so drift never has time to build up; Fowler credits that name to his colleague Kornelis Sietsma.
- **Immutable server** is the logical next step, written up by Kief Morris on the same bliki on 13 June 2013: a server that is never modified once it is deployed, only replaced by a new instance. Morris credits the term to his Thoughtworks colleague Ben Butler-Cole. Ten days later Chad Fowler's post *Trash Your Servers and Burn Your Code: Immutable Infrastructure and Disposable Components* argued for the same approach by analogy with the immutable values of functional programming. Today the AWS Well-Architected Framework's practice REL08-BP04 describes **immutable infrastructure** as a model in which production workloads receive no in-place updates, patches or configuration changes at all.
- **Pets versus cattle** is the shorthand for the same shift in attitude. A pet has a name, and when it falls ill everyone works to save it; cattle are numbered, and a sick one is replaced. Randy Bias, who started using the analogy for cloud computing around 2011 and 2012, credits it to a presentation by Bill Baker on scaling SQL Server, where it contrasted scaling up with scaling out. Bias moved the emphasis to whether a server can be destroyed and replaced at any moment. Fowler's *SnowflakeServer* entry mentions the same metaphor in a footnote.

### Machine images and container images

The principle is the same for virtual machines and containers; only the unit differs.

- **Machine images** (Amazon Machine Images, Azure images, Google Compute Engine images) hold a whole disk: operating system, packages and application. A machine image built this way is often called a *golden image*. HashiCorp **Packer** builds them for several platforms from one template, and can run tools such as Chef or Puppet as a build step, so existing configuration recipes run once at build time instead of over and over on live servers. The clouds also offer managed builders: **EC2 Image Builder** runs pipelines with build and test components on a schedule and distributes the result to other Regions and accounts, and **Azure VM Image Builder**, which is built on Packer, can publish to the Azure Compute Gallery.
- **Container images** follow the **OCI image specification** (version 1.1 since February 2024): a manifest that lists layers addressed by their content. They are immutable by construction. A running container writes to a thin writable layer of its own, which is deleted with the container while the image stays as it was, and an orchestrator such as Kubernetes replaces containers rather than patching them. Setting `readOnlyRootFilesystem` in a container's security context mounts its root filesystem read-only, so nothing can be changed in place even by accident; scratch space then comes from explicit volumes.

### Versions, digests and provenance

An image is only useful as the unit of change if you know exactly which one is running and what is inside it.

- **Pin the digest, not only the tag.** A tag such as `v42` or `latest` can be moved to point at a different image; a digest is a hash of the image's content and can never change. The Kubernetes documentation on images spells out the difference. Deploy by digest, or make tags immutable where your registry supports it, so that the image you tested is the image you run. For machine images, the image ID plays the same role.
- **Record what went in.** A software bill of materials (SBOM) lists every package in the image, in SPDX format (an international standard, ISO/IEC 5962:2021) or CycloneDX format (standardised by Ecma as ECMA-424). Provenance records how the image was built and from which source; Docker's BuildKit attaches a minimal provenance attestation by default and adds an SBOM on request, and the SLSA specification describes what provenance should contain.
- **Sign it, and check the signature before launch.** Sigstore's `cosign` and the Notary Project's `notation` sign images in the registry, and an admission policy or deployment step refuses images that are unsigned or come from somewhere else. Since version 1.1 of the OCI specifications, a registry can keep signatures, SBOMs and attestations next to the image they describe and list them through a referrers API.
- **Scan it, and keep scanning it.** Scan every image in the pipeline and stop the release on serious findings, then rescan stored images, because new vulnerabilities keep being published for packages you baked months ago. EC2 Image Builder can validate images with Amazon Inspector, and open-source scanners such as Trivy and Grype run in any pipeline.

### What goes in the image, and what arrives at start

Ask two questions of every item: does it differ between environments, and can it change without a release?

| What | Examples | Where it goes |
|---|---|---|
| **The same everywhere, changes with a release** | OS packages and patches, runtime, application build, agents, default configuration | Baked into the image |
| **Different in each environment** | Endpoints, pool sizes, feature defaults for staging and production | Fetched or injected when the server starts |
| **Secret** | Passwords, API keys, private keys | Fetched at start from a secrets manager, using the server's own identity |
| **Produced while running** | Data, uploaded files, sessions, logs, metrics | Written to services outside the server |

This is the twelve-factor rule for configuration. *The Twelve-Factor App* defines config as everything likely to vary between deploys (handles to backing services, credentials, per-deploy values such as the hostname) and requires a strict separation of config from code; its litmus test is whether the codebase could be published at any moment without exposing a credential. Internal wiring that is the same in every deploy, such as routing tables, is not config in that sense and belongs in the image.

The payoff is that **one image runs everywhere**: the bytes you tested in staging are the bytes that run in production, and only the injected settings differ. The twelve-factor app keeps config in environment variables. Many teams instead read settings at start from an external configuration store (AWS Systems Manager Parameter Store or AWS AppConfig, Azure App Configuration, Kubernetes ConfigMaps) and secrets from a secrets manager (AWS Secrets Manager, Azure Key Vault, HashiCorp Vault, Kubernetes Secrets). Keep secrets out of images, which are copied widely and kept for a long time, and out of launch scripts too: AWS warns that EC2 user data is not protected by authentication or cryptography, so it is no place for passwords or long-lived keys.

### Bake everything, or configure at boot

An AWS whitepaper on deployment options calls the two ends **prebaking** and **bootstrapping**. A fully baked image boots straight into a working server, so launches are quick and every instance is identical. A thin image that installs the application and its dependencies at boot (from cloud-init user data or a configuration management run) needs fewer image builds, but every launch is slower, especially when the downloads are large, and two servers launched an hour apart can pick up different package versions from the mirrors: drift at launch time. Most teams take the middle path and bake everything that defines behaviour, leaving only the environment-specific steps for boot. Boot time matters more than it seems, because a fleet can only scale out, or replace a lost instance, as fast as a new server becomes ready.

### Replacing servers without downtime

How old servers make way for new ones is a deployment pattern of its own. A [rolling update](../rolling-update/) swaps a few at a time, [blue-green](../blue-green-deployment/) switches between two complete fleets, and a [canary release](../canary-release/) tries the new image on a small share of traffic first. Cloud platforms package these: EC2 Auto Scaling's **instance refresh**, for example, replaces the instances of a group after you point its launch template at a new AMI, and can roll back, or skip instances that already match the new configuration. Whatever the mechanism, the servers must be **disposable** in the twelve-factor sense: quick to start, shutting down gracefully when they receive SIGTERM, and robust when they die without warning.

### Infrastructure as code, and GitOps

Immutable servers need everything around them to be reproducible as well: networks, load balancers, security rules, DNS records and the launch templates themselves. Define them as code (Terraform or OpenTofu, AWS CloudFormation, Azure Bicep, Pulumi), review changes like application code and apply them from a pipeline. The image version then becomes one more value in that code, changed in a commit. The Well-Architected practice recommends this pairing of automation and infrastructure as code for immutable deployments, and Kief Morris's book *Infrastructure as Code* covers the wider discipline.

**GitOps** goes one step further: the desired state lives in Git, and agents inside the environment pull it and keep reconciling the real system towards it. The OpenGitOps principles (version 1.0.0) name four properties: declarative, versioned and immutable, pulled automatically, and continuously reconciled. Changing an image digest in Git becomes the deployment, and a manual change to the running system shows up as a difference that the next reconciliation tries to undo.

### Rebuild on a schedule, and whenever the base changes

An image is frozen on the day it was built, and so are its vulnerabilities. Rebuild it even when your own code has not changed:

- **When the base image changes.** By default, an EC2 Image Builder pipeline on a schedule builds a new image only when the base image or one of its components has a newer version that matches the recipe's version filters. For containers, a bot such as Dependabot can open a pull request when a newer base image is published.
- **On a fixed rhythm**, so that no image in production is older than an agreed age, and no server either. EC2 Auto Scaling, for example, can replace every instance that reaches a maximum lifetime (one day at the least), and each replacement is launched from the group's current launch template. That is Fowler's phoenix server, automated.

### Detecting drift

Closing SSH removes the main source of drift, not every source. Break-glass sessions happen, processes write to local disks, and a rollout can miss a server. Look for drift in two places:

- **Is every server running the image it should?** Compare each running instance's image ID or digest with the approved one. The AWS Config managed rule `approved-amis-by-id` flags instances launched from any AMI not on your list, and a Kubernetes admission policy can reject pods whose images are not pinned by digest or do not come from your registry.
- **Does the surrounding infrastructure still match its code?** AWS CloudFormation drift detection compares deployed resources with their templates, Terraform's refresh-only mode lists what changed outside Terraform since its last apply, and GitOps agents report anything out of sync.

One rule keeps the fleet honest: a server that anyone logged in to is replaced afterwards.

### Debugging without logging in

Investigation moves off the server. Logs, metrics and traces leave each server as they are produced ([centralized logging](../centralized-logging/), [distributed tracing](../distributed-tracing/)), so the evidence outlives the instance. And because servers are identical, a problem seen in production can usually be reproduced by launching the same image version somewhere else. When you really do need to look inside:

- **Kubernetes ephemeral containers**, stable since Kubernetes 1.25, let `kubectl debug` add a temporary container with debugging tools to a running Pod. That helps most with minimal images that ship without a shell. Ephemeral containers are never restarted and are not meant for running applications.
- **For virtual machines**, the Well-Architected security pillar lists interactive SSH or RDP access to instances as an anti-pattern. When interactive access is necessary, it points to AWS Systems Manager Session Manager, with session activity logged to Amazon CloudWatch Logs or Amazon S3 as an audit trail.
- **Container-optimised operating systems** build the rule in. Bottlerocket ships with no SSH server and not even a shell, keeps its administrative container (the one with an SSH server) disabled by default, and updates by switching between partitions instead of patching packages.

Afterwards, replace the server you inspected.

### Stateful systems

Immutability is easiest for stateless tiers. State needs a home whose lifetime is not tied to an instance:

- **Managed services** take state off your servers altogether: managed databases, object storage, managed caches and queues. Kief Morris's *ImmutableServer* entry suggests the same: decide which data must persist as servers come and go, ship data such as log files off the instance, and hand databases to a service someone else runs where you can.
- **Volumes that outlive the instance.** A network volume can be detached from a terminated server and attached to its replacement. Check what happens at termination: on EC2 each EBS volume has a `DeleteOnTermination` attribute, and a root volume attached at launch is deleted with the instance by default. In Kubernetes, a PersistentVolume has a lifecycle independent of any Pod, and a StatefulSet gives each replica stable, persistent storage that survives rescheduling.
- **Replication** lets a stateful node be replaced like any other: a new member joins, copies the data from its peers and takes over, so no single disk has to survive.

### Disaster recovery

If every server can be rebuilt from an image and every environment from code, recovering from a lost region means running the same code against another region with the images already copied there; EC2 Image Builder, for example, can distribute each new image to other Regions as part of the pipeline. The rebuild path is exercised by every deployment, so it is known to work, which is rarely true of a restore runbook. Data still needs its own backups or replication, because images hold software, not state. See [disaster recovery strategies](../disaster-recovery-strategies/).

## When to use it

- **Fleets of interchangeable servers:** web and API tiers behind a load balancer, workers, container hosts, anything that scales out.
- **Frequent patching or strict compliance**, where you have to show what runs where: every server traces back to a versioned, scanned and signed image.
- **Autoscaling and self-healing**, which only work when a new instance is identical to the others and ready quickly.
- **Containers and Kubernetes**, where it is already the default: images are immutable, and pods are replaced rather than patched.

**Where to start.** Begin with one stateless tier. Write its image recipe, build it in a pipeline and replace its servers with a rolling update. Then move its logs off the instances and its settings into a store read at start, and close SSH. Meanwhile keep configuration management, with drift detection, on the rest of the estate, and move the next tier when the first one is boring.

**When not to, or not yet:**

- **Hosts that cannot be rebuilt.** Legacy systems installed by hand long ago, vendor appliances and software licensed to one machine. Put them under configuration management and drift detection first, and capture how to build them as code before you try to replace them.
- **State that cannot be separated yet.** A single database server with its data on a local disk needs that data moved to a separate volume, a replica set or a managed service first.
- **Tiny, short-lived environments**, where a full image pipeline would cost more than the drift it prevents.

## Trade-offs

- **The pipeline is an investment.** Image builds, boot tests, scanning, signing, registries and distribution to every region have to exist, and stay fast, before the first benefit appears.
- **Small changes get slower.** Changing one line in an image means a new build and a rollout across the fleet: minutes, where an SSH session took seconds. Keep settings that change often out of the image, and keep the pipeline quick.
- **Boot time against flexibility.** Fully baked images start fast but need a rebuild for every change; thin images change cheaply but boot slowly and risk drift at launch.
- **Image sprawl.** Every build is a new version that costs storage until someone deletes it, and old images with known vulnerabilities stay launchable. Keep the last few for rollback and expire the rest with lifecycle policies; EC2 Image Builder and Amazon ECR both have them.
- **A bad image is everywhere at once.** Identical servers fail identically. Health checks, canaries and a fast rollback to the previous version are what make that acceptable.
- **Debugging needs observability first.** Without good logs, metrics and traces, closing SSH only blinds the team.
- **State moves elsewhere**, usually to managed services that cost money, or to volume and replication handling that you have to automate.

## Implementation notes

- **Build once, promote the same artifact.** Move one image (one digest or AMI ID) from test to production and inject only the per-environment settings. Rebuilding for each environment brings back the differences you set out to remove.
- **Make the version visible.** Put the image version, source commit and build time in image metadata, instance tags and the application's health endpoint, so anyone can see what a server runs without logging in.
- **Bake the agents in.** The log shipper, metrics agent and security agent are part of the image and start with the server. A server that has to be fixed up after launch is not immutable.
- **Fail fast at boot.** If a required setting or secret cannot be fetched at start, the server should fail its health check and be replaced, not run half-configured.
- **Close the doors.** Remove SSH keys and inbound management ports from the image and the security rules. Keep a break-glass path that is logged and reviewed, and replace any server it was used on.
- **Keep rollback boring.** The previous image version stays launchable and tested; rolling back is an ordinary deployment of the older version, not a restore.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Rolling Update](../rolling-update/) — Replace instances batch by batch while the service stays up.
- [Blue-Green Deployment](../blue-green-deployment/) — Run the new version beside the old one and switch all traffic in one step.
- [Autoscaling](../autoscaling/) — Add and remove instances automatically as load rises and falls.
- [GitOps](../gitops/) — Git holds the desired state; an agent continuously reconciles the cluster to match it.
- [External Configuration Store](../external-configuration-store/) — Keep configuration out of the deployment package, in a central store read at runtime.
- [Canary Release](../canary-release/) — Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back.
- [Disaster Recovery Strategies](../disaster-recovery-strategies/) — Backup & restore, pilot light, warm standby, active-active: trading cost against RTO and RPO.
- [Centralized Logging](../centralized-logging/) — Ship structured logs from every service to one searchable store, correlated by request ID.

## Related components and services

- [Docker & Containers](../docker/) — Package an app and its dependencies as an image and run it as an isolated process: layers, registries, namespaces, cgroups.

## Related principles and frameworks

- [Continuous Delivery](../continuous-delivery/) — Keep every change releasable: a deployment pipeline builds once, tests in stages and promotes the same artifact to production.
- [Eliminating Toil](../eliminating-toil/) — Find the manual, repetitive operations work that grows with the system, measure it, cap it and automate it away.
- [The Twelve-Factor App](../twelve-factor-app/) — Twelve rules for apps that deploy cleanly anywhere: config in the environment, stateless processes, separate build, release and run.
- [Infrastructure as Code](../infrastructure-as-code/) — Define infrastructure in version-controlled code: review a plan, apply it the same way in every environment and catch drift.
- [Supply Chain Security (SLSA)](../supply-chain-security/) — Prove that what you deploy was built from your source: build provenance, SBOMs, signatures and a check before every deploy.

## References

- [Kief Morris — ImmutableServer (Martin Fowler's bliki)](https://martinfowler.com/bliki/ImmutableServer.html)
- [Martin Fowler — PhoenixServer](https://martinfowler.com/bliki/PhoenixServer.html)
- [Martin Fowler — SnowflakeServer](https://martinfowler.com/bliki/SnowflakeServer.html)
- [AWS Well-Architected Framework — REL08-BP04 Deploy using immutable infrastructure](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_tracking_change_management_immutable_infrastructure.html)
- [AWS Well-Architected Framework — SEC06-BP03 Reduce manual management and interactive access](https://docs.aws.amazon.com/wellarchitected/latest/framework/sec_protect_compute_reduce_manual_management.html)
- [The Twelve-Factor App — III. Config](https://12factor.net/config)
- [The Twelve-Factor App — IX. Disposability](https://12factor.net/disposability)
- [HashiCorp — Introduction to Packer](https://developer.hashicorp.com/packer/docs/intro)
- [EC2 Image Builder — What is Image Builder?](https://docs.aws.amazon.com/imagebuilder/latest/userguide/what-is-image-builder.html)
- [Amazon EC2 Auto Scaling — Use an instance refresh to update instances in an Auto Scaling group](https://docs.aws.amazon.com/autoscaling/ec2/userguide/asg-instance-refresh.html)
- [Kubernetes — Images](https://kubernetes.io/docs/concepts/containers/images/)
- [Kubernetes — Ephemeral Containers](https://kubernetes.io/docs/concepts/workloads/pods/ephemeral-containers/)
- [Randy Bias — The History of Pets vs Cattle and How to Use the Analogy Properly](https://cloudscaling.com/blog/cloud-computing/the-history-of-pets-vs-cattle/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
