<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🚪 API & Edge](../../README.md#api--edge)

# Sidecar

> Run helper capabilities (proxy, logging, config) in a separate process next to the app.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Sidecar" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/sidecar.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One unit, two processes** | A **sidecar** is a helper that runs next to the application inside the same deployment unit: a pod in Kubernetes, a task or a host elsewhere. The two are deployed, started, scaled and stopped together and share the pod's network (so they talk over `localhost`) and any volume mounted into both, yet each is a separate container with its own image, language and resource limits. The application's own code carries none of the helper's logic. |
| **2 · Three classic jobs** | Three jobs come up again and again. A **proxy** sidecar carries the application's outbound and inbound calls and adds TLS and retries. A **log shipper** tails the file the application writes and sends the lines to the log store. A **config agent** fetches secrets and settings and keeps a file on the shared volume up to date, which the application simply reads. |
| **3 · Update and reuse** | The platform team ships a new version of the proxy image and rolls it out pod by pod. The pods restart with the new sidecar, but no application image is rebuilt. The same image runs next to a Java, a Go and a Python service: one implementation for every language, where a library would need one per language and a rebuild of every service for every fix. |
| **4 · The price** | Every pod now runs extra containers, so their CPU and memory are multiplied by the number of pods (the figures in the animation are examples), and each call through the proxy takes one more hop. Order matters too: the sidecar has to be running before the application starts and has to outlive it at shutdown. Kubernetes' native sidecar containers (stable since v1.33) give exactly that order. The alternatives to a sidecar are a library, one agent per node, or a feature of the platform. |
<!-- END GENERATED: header -->

## The problem

Every service needs plumbing that has nothing to do with its business logic: encrypting and retrying its calls, shipping its logs, fetching its secrets and settings, exporting its telemetry. There are two obvious places to put that plumbing, and both hurt.

**Inside the application, as a library.** It is fast and sees everything in the process, but it has to be written again for every language and framework, it reaches production only when each service is rebuilt and redeployed, and it shares the application's fate: a memory leak in the log shipper is now a memory leak in the checkout service. With several languages and dozens of teams, nobody can say which services already run last month's fix.

**In a separate service, somewhere on the network.** It is independent, but it is far away: one more network call, one more thing to discover, authenticate to and scale, and it cannot read the application's local files or reach its loopback interface.

The helper should be as close to the application as a library (same host, same network identity, same files, same lifetime) and as separate from it as a service (own code base, own release cycle, own resource limits).

## How it works

A **sidecar** is a helper process deployed next to *each instance* of the application, inside the same deployment unit. In Kubernetes that unit is the pod; elsewhere it is an Amazon ECS task, a Nomad task group, a Cloud Run instance or simply the same host. The name comes from the motorcycle sidecar: bolted to the bike, going wherever it goes, pointless without it. The Azure Architecture Center also calls it the *sidekick* pattern.

Because the two run side by side, they can cooperate without any shared code:

- **Over `localhost`.** The containers share one network namespace, so the application reaches the helper (and the helper reaches the application) on a loopback port, in plain HTTP or gRPC, whatever language either is written in.
- **Through files.** A volume mounted into both lets one write what the other reads: the application appends to a log file and the helper ships it, or the helper writes a configuration file and the application reads it.
- **By sitting in the path.** A proxy sidecar receives the application's outbound and inbound connections and adds what the application does not implement.

The application's own code carries none of the helper's logic, and usually does not know the helper exists.

### Three sibling patterns, and where the names come from

The vocabulary comes from the people who built Kubernetes. Brendan Burns described three ways of composing containers on one node in a 2015 Kubernetes blog post, written after a DockerCon talk, and again with David Oppenheimer in a 2016 HotCloud paper:

| Pattern | What the helper does | Example |
|---|---|---|
| **Sidecar** | In Burns's words, sidecars "extend and enhance" the main container | a log shipper, a process that keeps local files in sync with a repository |
| **Ambassador** | Proxies the application's connections to the outside world, so the application only ever talks to `localhost` | a proxy that adds TLS and retries, or one that spreads requests over the shards of a cache |
| **Adapter** | Presents the application to the outside world in a standard form | an exporter that turns an application's own metrics into the format the monitoring system expects |

Today *sidecar* usually names the deployment mechanism, and ambassador and adapter name what a particular helper does: an ambassador is deployed as a sidecar. In the animation the proxy is an ambassador that also takes inbound calls, and the log shipper is the paper's own first example.

The paper also gives the reasons for keeping the helper in a container of its own: a container is the unit of resource accounting, of packaging and team ownership, of reuse, of failure containment and of deployment. It names the price of the last one too: the helper and the application are upgraded separately, so every combination of versions that can meet in production has to work.

### What is shared and what is isolated

| | Shared by the pod | Separate for each container |
|---|---|---|
| **Network** | one network namespace: the same IP address, the same port space, the same `localhost` (so two containers cannot listen on the same port) | |
| **Storage** | only the volumes that are mounted into both | the root file system, which comes from each container's own image |
| **Lifecycle** | scheduled, started, scaled and deleted as one unit | a crashed container is restarted on its own; each has its own probes |
| **Resources** | the scheduler places the pod by the sum of its containers' requests | each container has its own CPU and memory requests and limits |
| **Processes** | optional: with `shareProcessNamespace: true` every container sees the others' processes | the default: separate process namespaces |
| **Identity** | the pod's service account, whose token is mounted into every container by default | |

The isolation is what a library cannot give you: a sidecar that exceeds its memory limit is killed and restarted without taking the application's process with it, and its CPU limit keeps it from starving the request path.

### Lifecycle and ordering

"Started and stopped together" hides three details that cause most of the trouble with sidecars:

- **At startup** the helper has to be working before the application needs it. An application that starts faster than its proxy has no network for its first calls.
- **At shutdown** the helper has to outlive the application, or the last requests cannot leave and the last log lines are never shipped.
- **A job that finishes** must not be kept alive by a helper that never exits.

For years Kubernetes had no notion of a sidecar. A helper was just another entry in `containers`: nothing made the application wait for it, at shutdown the containers were signalled in no guaranteed order, and a Job's pod never completed while the helper kept running. Teams worked around it with `postStart` hooks that held the application back, `preStop` hooks that delayed the helper, and scripts that told the helper to quit when the job was done.

**Native sidecar containers** replace those workarounds. A sidecar is declared as an init container with `restartPolicy: Always`. The feature arrived as alpha in Kubernetes v1.28 (August 2023), has been on by default since v1.29 and has been stable since v1.33 (April 2025); every release still maintained in October 2026 (the newest is v1.37) has it, and it can no longer be switched off. It changes four things:

- **Start.** Init containers start in the order they are listed. The kubelet moves on to the next one, and finally to the application containers, once the sidecar counts as started: when its `startupProbe` succeeds, or as soon as its process runs if it has none. Regular init containers listed after a sidecar can already use it.
- **Run.** The sidecar is restarted whenever it exits, whatever the pod's own restart policy says. It can have startup, readiness and liveness probes, and its readiness counts towards the pod's.
- **Stop.** The kubelet sends the termination signal to the sidecars only after the last application container has fully stopped, and stops them in reverse order. If the grace period runs out first, everything that is left is killed together, so a non-zero exit code from a sidecar at shutdown is normal.
- **Jobs.** A sidecar does not keep a Job's pod from completing.

Other platforms have their own form of the same idea. An Amazon ECS task definition marks containers as `essential` and orders them with `dependsOn` conditions (`START`, `COMPLETE`, `SUCCESS`, `HEALTHY`), applied in reverse at shutdown. A Nomad task with a `lifecycle` block and `sidecar = true` runs for as long as the main tasks do and is stopped after them. Cloud Run starts the containers of an instance in a declared order and can wait for each one's health check.

### Update and reuse independently

Because the helper is a separate image, the team that owns it can release it on its own schedule, and the same image serves every language. That is the third step of the animation: one proxy image next to a Java, a Go and a Python service, where a library would need three implementations kept equal and a rebuild of every service for every fix.

"Without rebuilding" does not mean "without restarting". With the usual tooling (an injector, or a workload whose pod template changes) a new sidecar version reaches a workload when its pods are replaced: a rolling restart with the application image untouched. Until every workload has been restarted, the fleet runs a mix of sidecar versions.

## When to use it

- A capability that many services need in the same way, in more than one language: transport security, retries, log shipping, secret delivery, telemetry export.
- A helper owned by another team (platform, security, observability) that should ship on its own schedule.
- An application you cannot or do not want to change: legacy code, a third-party image, a product without an extension mechanism.
- A helper that has to be local to the instance because it needs the application's files, its loopback interface or its identity.
- A helper that should have its own resource limits and should be able to fail without taking the application down.

### Library, sidecar, node agent or platform?

The same capability can live in four places:

| | Library | Sidecar | One agent per node | Platform feature |
|---|---|---|---|---|
| Runs | inside the application's process | next to each instance, in the same pod | once on every node | in the platform |
| Languages | one implementation per language | any | any | any |
| Sees | everything in the process | one instance's network, mounted files and identity | every workload on the node | what the platform exposes |
| Cost grows with | the application itself | the number of instances | the number of nodes | nothing you operate |
| A new version needs | a rebuild of every service | a restart of every pod | a rollout of the agent | a platform upgrade |
| A failure affects | the application's process | the helper of one instance | every workload on that node | everyone on the platform |

### When a library is better

- **Performance-critical paths.** Every call through a sidecar is serialised, crosses the loopback interface and is parsed again. For a chatty or latency-critical interface an in-process call wins.
- **Deep integration.** Some things need knowledge that only exists inside the process: which request is safe to retry, what the current user may do, where a span starts and ends in the code. Tracing is the usual example: the instrumentation is a library, and the Collector beside the application only receives and forwards what it produces (see [Telemetry Pipeline](../telemetry-pipeline/)).
- **One language and one team.** A dependency upgrade is simpler than another container in every pod.

### When one agent per node is better

- **Log collection at scale.** If applications write to standard output, the node already has every container's log files, and one agent per node (a DaemonSet in Kubernetes) collects them for all pods without touching any of them. The Kubernetes logging guide warns that a logging agent in a sidecar can consume significant resources and that logs handled this way no longer show up in `kubectl logs`.
- **Anything that is about the node rather than the application:** host metrics, the kubelet, the container runtime.
- **Cost.** Twenty agents on twenty nodes instead of two hundred in two hundred pods.

The price of a per-node agent is sharing: it serves every tenant on the node, needs node-level privileges, cannot be configured per application as freely, and takes more workloads with it when it fails.

### When the platform should do it

If the platform already provides the capability, a sidecar only adds parts. Kubernetes mounts Secrets and ConfigMaps as files and refreshes them after a change (not for `subPath` mounts), the node keeps every container's standard output as log files, a CSI driver can mount secrets from an external store, and service meshes offer data planes without sidecars: in Istio's ambient mode a proxy on each node replaces the one in each pod (see [Service Mesh](../service-mesh/)).

### When not to use it

- **The helper has to scale differently from the application,** or is shared by many applications. That is a separate service.
- **The application is small or runs in few instances.** The overhead per instance and the extra moving parts can outweigh the isolation.
- **The interface between the two is chatty or latency-critical.** Use a library.
- **The platform or a per-node agent already does the job.**
- **To split one application in two.** A sidecar is for a helper with the same lifetime as the application. Two pieces of business logic that happen to talk a lot are either one service or two.
- **Instances that must start fast,** such as workloads that scale from zero: every start now waits for the sidecar as well.

## Trade-offs

### Resource overhead, and how to budget it

Every pod pays again. The animation uses example figures: a proxy with 0.1 CPU and 100 MB, in 200 pods, reserves 20 CPU and 20 GB before any application does any work. Real figures depend on the helper and the traffic: in Istio's own benchmark (version 1.24, 1,000 requests per second with 1 KB payloads) one proxy sidecar with two worker threads used about 0.20 vCPU and 60 MB.

- **Give every sidecar explicit requests and limits.** The requests of the sidecars are added to those of the application containers, and that sum is what the scheduler places and what a quota counts. Injectors have defaults and per-workload overrides, for example Istio's `sidecar.istio.io/proxyCPU` and `sidecar.istio.io/proxyMemory` annotations.
- **Mind the quality-of-service class.** A pod is `Guaranteed` only if every container, sidecars included, has CPU and memory limits equal to its requests. One injected container without them changes the class of the whole pod.
- **Mind the autoscaler.** A HorizontalPodAutoscaler that targets CPU utilisation computes it over all containers of the pod, and takes no action for that metric if any container lacks a CPU request. A `ContainerResource` metric (stable since Kubernetes v1.30) scales on the application container alone. [Autoscaling](../autoscaling/) covers the rest.
- **Or budget the pod as a whole.** Pod-level resources (beta since v1.34, on by default) set one CPU and memory budget that the containers share.

### One more hop

A proxy sidecar adds a hop to every call, and two when both ends have one. Istio's documentation puts the latency its sidecar mode adds, with a proxy at each end, at 0.63 ms (p90) to 0.88 ms (p99). That is nothing for one call and noticeable for a chain of ten. Measure your own tail latency with the sidecar in place rather than trusting anyone's benchmark.

### Security: the sidecar is inside the trust boundary

- **It sees what the pod sees.** It shares the network namespace, so it can connect to anything the application binds to `localhost`, including admin and debug endpoints, and it can listen on the pod's ports. It reads every volume mounted into it. It runs with the pod's service account.
- **So a compromised sidecar is a compromised pod, and the other way round.** Traffic between the application and a proxy sidecar is plaintext on the loopback interface, and a secret that an agent writes to a shared volume is readable by every container that mounts it. The pattern moves code out of the application, not out of its blast radius.
- **Injection is a supply chain.** Sidecars are often added by a mutating admission webhook when the pod is created. Whoever controls that webhook, its configuration or the sidecar image runs code in every pod. Pin image versions, restrict who can change the injector, and review what it adds.
- **Privileges.** A proxy that intercepts traffic transparently has to rewrite the pod's packet routing. Istio's init container needs the `NET_ADMIN` and `NET_RAW` capabilities for that, unless its CNI node agent does the work instead. Do not give a sidecar more privileges than the application has.
- **Mount little.** Give the sidecar only the volumes it needs, read-only where it only reads.

On the positive side, a sidecar can add a security control such as [Mutual TLS](../mutual-tls/) to an application that has none, without changing it.

### Debugging two processes

- **Ask which container.** Logs, restarts and exit codes are per container (`kubectl logs <pod> -c <container>`). A `502` or `503` may come from the proxy and not from the application.
- **Readiness is shared.** A pod can be running and still not ready because the sidecar's readiness probe fails, and an application can be healthy but unreachable because its proxy has crashed and is being restarted.
- **Read the symptom as an ordering problem first.** Refused connections in the first seconds mean the application started before the helper. Errors in the last seconds mean the helper stopped first. A Job that never completes means a helper that never exits.
- **Look inside.** An ephemeral debug container (`kubectl debug`, stable since Kubernetes v1.25) can join a running pod and target one container's process namespace. With `shareProcessNamespace: true` the containers see each other's processes and, through `/proc`, each other's file systems, which is useful for debugging and one more reason to treat the pod as a single trust boundary.
- **Record the sidecar version** next to the application version. After an upgrade of the injector, pods of the same workload can run different sidecar versions until they are all restarted.

## Implementation notes

- **Declare it as a native sidecar in Kubernetes.** The `restartPolicy` on an init container is the whole difference:

  ```yaml
  spec:
    initContainers:
      - name: log-shipper
        image: registry.example/logship:3.1
        restartPolicy: Always          # makes this init container a sidecar
        startupProbe:                  # the application starts once this succeeds
          httpGet: { path: /ready, port: 2020 }
        resources:
          requests: { cpu: 100m, memory: 100M }
          limits: { cpu: 100m, memory: 100M }
        volumeMounts:
          - { name: logs, mountPath: /var/log/app, readOnly: true }
    containers:
      - name: orders
        image: registry.example/orders:4.2
        volumeMounts:
          - { name: logs, mountPath: /var/log/app }
    volumes:
      - name: logs
        emptyDir: {}
  ```

- **Define "started" with a startup probe.** Without one, the sidecar counts as started the moment its process runs, which is earlier than the moment it can serve.
- **Budget the shutdown.** The grace period (30 seconds by default) covers the application and then the sidecars. An application that uses all of it leaves the sidecar no time to flush.
- **Keep the interface language-neutral:** HTTP or gRPC on `localhost`, files on a shared volume, or a Unix socket on a shared volume.
- **Injection.** Platforms usually add the sidecar with a mutating admission webhook, switched on by a label or annotation, so application teams do not maintain it in their manifests. Pods that already exist are not changed: the sidecar appears, and a new version arrives, when the pod is recreated (for example with `kubectl rollout restart`). If an older tool or webhook in the admission chain drops fields it does not know, a native sidecar loses its `restartPolicy` and blocks the pod's startup.
- **Updating in place.** Kubernetes allows the image of a container in a running pod to be changed, and restarts only that container. Controllers such as Deployments still replace the pods when their template changes. OpenKruise's SidecarSet uses the in-place route to upgrade sidecar images without recreating pods.
- **Watch for collisions.** An injected sidecar occupies ports and sometimes a user ID in the pod. Istio's proxy, for example, runs as UID 1337, which the application must not use.

**Examples, verified in October 2026:**

- **A service mesh proxy.** Istio injects Envoy as the `istio-proxy` container into pods of namespaces labelled `istio-injection=enabled`, and Linkerd injects its Rust `linkerd-proxy` into workloads annotated `linkerd.io/inject: enabled`. Both use native sidecar containers by default, Istio since 1.27 and Linkerd since 2.20. What many such proxies do together under a control plane is the subject of [Service Mesh](../service-mesh/).
- **An OpenTelemetry Collector as a sidecar.** The OpenTelemetry Operator injects a Collector into pods annotated `sidecar.opentelemetry.io/inject`, from an `OpenTelemetryCollector` resource whose `mode` is `sidecar`. The same Collector also runs once per node (`daemonset`) or as a shared gateway; [Telemetry Pipeline](../telemetry-pipeline/) describes when to use which.
- **A secrets agent injector.** HashiCorp's Vault Agent Injector is a mutating webhook that reacts to the annotation `vault.hashicorp.com/agent-inject: "true"`. It adds an init container that fetches the secrets before the application starts and a sidecar that keeps authenticating and rendering them, into an in-memory volume mounted at `/vault/secrets`. The application reads files and knows nothing about Vault. The alternative per node is the Secrets Store CSI Driver, a DaemonSet that mounts secrets from an external store as a volume.
- **An application runtime that works through a sidecar.** Dapr (a CNCF graduated project) runs a `daprd` process beside each application, injected into pods annotated `dapr.io/enabled: "true"`. The application calls it on `localhost`, over HTTP (port 3500 by default) or gRPC (50001), for state management, publish and subscribe, service invocation, secrets and workflows. It is injected as a regular container by default and as a native sidecar on request (`dapr.io/enable-native-sidecar: "true"`).

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Service Mesh](../service-mesh/) — Sidecar proxies plus a control plane: mTLS, retries and traffic shifting without touching app code.
- Ambassador *(planned)* — An out-of-process proxy that handles outbound connectivity (retries, TLS, routing) for a client.
- [Telemetry Pipeline (OpenTelemetry)](../telemetry-pipeline/) — Receive, process and export traces, metrics and logs through one vendor-neutral collector.
- [Mutual TLS (mTLS)](../mutual-tls/) — Client and server both present certificates, so every connection is authenticated both ways.
- [Centralized Logging](../centralized-logging/) — Ship structured logs from every service to one searchable store, correlated by request ID.
- [External Configuration Store](../external-configuration-store/) — Keep configuration out of the deployment package, in a central store read at runtime.
- [Gateway Offloading](../gateway-offloading/) — Move TLS termination, authentication and compression out of every service into the gateway.
- [Microservices](../microservices/) — Small, independently deployable services, each owning one business capability and its data.

## References

- [Azure Architecture Center — Sidecar pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/sidecar)
- [Azure Architecture Center — Ambassador pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/ambassador)
- [Brendan Burns, David Oppenheimer — Design Patterns for Container-based Distributed Systems (HotCloud '16)](https://www.usenix.org/conference/hotcloud16/workshop-program/presentation/burns)
- [Brendan Burns — The Distributed System ToolKit: Patterns for Composite Containers (Kubernetes blog, 2015)](https://kubernetes.io/blog/2015/06/the-distributed-system-toolkit-patterns/)
- [Kubernetes — Sidecar Containers](https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/)
- [Kubernetes blog — Kubernetes v1.28: Introducing native sidecar containers](https://kubernetes.io/blog/2023/08/25/native-sidecar-containers/)
- [Kubernetes blog — Kubernetes v1.33: Octarine (sidecar containers become stable)](https://kubernetes.io/blog/2025/04/23/kubernetes-v1-33-release/)
- [Kubernetes — Adopting Sidecar Containers](https://kubernetes.io/docs/tutorials/configuration/pod-sidecar-containers/)
- [Kubernetes — Pod Lifecycle (termination order with sidecar containers)](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
- [Kubernetes — Pods (shared network and storage, Pod update and replacement)](https://kubernetes.io/docs/concepts/workloads/pods/)
- [Kubernetes — Share Process Namespace between Containers in a Pod](https://kubernetes.io/docs/tasks/configure-pod-container/share-process-namespace/)
- [Kubernetes — Logging Architecture](https://kubernetes.io/docs/concepts/cluster-administration/logging/)
- [Kubernetes — Resource Management for Pods and Containers (Pod-level resources)](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
- [Kubernetes — Pod Quality of Service Classes](https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/)
- [Kubernetes — Horizontal Pod Autoscaling (container resource metrics)](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/)
- [Kubernetes — Debug Running Pods (ephemeral containers)](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/)
- [Istio — Installing the Sidecar](https://istio.io/latest/docs/setup/additional-setup/sidecar-injection/)
- [Istio — Istio 1.27 Upgrade Notes (native sidecars enabled by default)](https://istio.io/latest/news/releases/1.27.x/announcing-1.27/upgrade-notes/)
- [Istio — Install the Istio CNI node agent](https://istio.io/latest/docs/setup/additional-setup/cni/)
- [Istio — Performance and Scalability](https://istio.io/latest/docs/ops/deployment/performance-and-scalability/)
- [Istio — Sidecar or ambient?](https://istio.io/latest/docs/overview/dataplane-modes/)
- [Linkerd — Automatic Proxy Injection](https://linkerd.io/docs/features/proxy-injection/)
- [OpenTelemetry — Agent deployment pattern](https://opentelemetry.io/docs/collector/deploy/agent/)
- [OpenTelemetry Operator — Sidecar injection](https://github.com/open-telemetry/opentelemetry-operator/blob/main/docs/collector/sidecar-injection.md)
- [HashiCorp Vault — Vault Agent Injector](https://developer.hashicorp.com/vault/docs/deploy/kubernetes/injector)
- [Secrets Store CSI Driver — Concepts](https://secrets-store-csi-driver.sigs.k8s.io/concepts)
- [Dapr — Dapr sidecar (daprd) overview](https://docs.dapr.io/concepts/dapr-services/sidecar/)
- [Amazon ECS — Task definition parameters for Fargate (essential, dependsOn)](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html)
- [HashiCorp Nomad — lifecycle block in the job specification](https://developer.hashicorp.com/nomad/docs/job-specification/lifecycle)
- [Google Cloud — Deploy container images to Cloud Run services (sidecars)](https://docs.cloud.google.com/run/docs/deploying)
- [OpenKruise — SidecarSet](https://openkruise.io/docs/user-manuals/sidecarset)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
