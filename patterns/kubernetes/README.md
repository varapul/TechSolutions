<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧱 System Components](../../README.md#system-components)

# Kubernetes

> A container orchestrator: you declare the desired state, and controllers keep pods scheduled, healthy and reachable.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Kubernetes" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/kubernetes.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Acme Shop's **Catalog** service runs on a Kubernetes cluster of three worker nodes. The team declares what should run in YAML (a Deployment of 3 replicas of `catalog:1.4.2`, a Service and an autoscaler) and applies it with `kubectl apply` or a GitOps tool such as Argo CD; the **control plane** then keeps the cluster matching it. A shopper's `GET /products/42` passes a cloud **load balancer** and a **Gateway**, whose HTTPRoute sends `/products` to the Service **catalog**, which hands it to one of the ready pods, on whichever node it runs. |
| **2 · Desired state, controllers** | `kubectl apply` sends the Deployment to the **API server**, which validates it and stores it in **etcd**. The Deployment controller creates a ReplicaSet, and the ReplicaSet controller creates 3 Pods. The **scheduler** binds each Pod to a node with enough unrequested capacity for its requests (250m CPU, 256Mi), and that node's **kubelet** has the container runtime start the container, then reports the pod Ready once its readiness probe passes. Each of these parts is a control loop: it watches the API server, compares the desired state with the actual one and acts on the difference. |
| **3 · Self-healing and scaling** | node-2 stops reporting. After 50 s without a heartbeat the node controller marks it NotReady and its pod not ready, so the Service stops sending it traffic; 300 s later, when the pod's default toleration runs out, the pod is evicted, its ReplicaSet creates a replacement and the scheduler puts it on node-3. Then load rises to an average of 90% of the requested CPU against a 60% target, so the HorizontalPodAutoscaler sets ceil(3 × 90 / 60) = **5** replicas, and the same load spread over 5 pods averages 54%. A later rolling update to a new image replaces pods a few at a time, within `maxSurge` and `maxUnavailable`. |
| **4 · Limits and trade-offs** | The cluster is a system to run in its own right: Kubernetes ships a minor release about three times a year and patches each for about 14 months (v1.37, released in August 2026, until October 2027), so clusters are upgraded at least once a year, one minor version at a time. The scheduler places pods by their **requests**, not their use: requests set too high leave nodes full but idle, and a memory **limit** set too low gets the container OOMKilled. Networking, storage, RBAC and add-ons take expertise too. Amazon EKS, Azure AKS and Google GKE run the control plane (EKS Auto Mode and GKE Autopilot run the nodes as well), and Amazon ECS or Google Cloud Run are simpler places to run containers. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's Catalog service ships as a container image, `catalog:1.4.2`, and so do Orders, Cart and the other services. Someone has to decide which machine runs each copy, restart a copy that crashes, start a new one elsewhere when a machine dies, add copies for the evening peak and remove them afterwards, keep the load balancer pointed only at copies that are ready, and replace every copy with 1.4.3 without dropping requests. Done with scripts and runbooks, each of these is a separate procedure that someone has to run at the right moment, for every service, and on a bad night one of them is forgotten.

Kubernetes turns all of that into one model. You declare the state you want (three replicas of this image, reachable under this name, between three and six of them depending on CPU), and a set of controllers keeps comparing that declaration with what actually runs and repairs the difference, whatever caused it.

## How it works

### Control plane and nodes

A cluster has a **control plane**, which stores the desired state and makes the decisions, and **worker nodes**, which run the containers.

- **kube-apiserver** serves the Kubernetes API. Everything goes through it: `kubectl`, GitOps tools, the other control-plane components and every node. It authenticates and authorizes each request, runs admission checks, validates the object and stores it.
- **[etcd](../etcd/)** is the consistent, highly available key-value store behind the API server, and holds every object in the cluster. Direct access to etcd amounts to full control of the cluster, so the documentation advises that only the API server should reach it. Run it as a cluster with an odd number of members; five are recommended in production.
- **kube-scheduler** watches for pods that have no node yet and assigns each one to a node.
- **kube-controller-manager** runs the built-in controllers, each a separate loop, in one process: Deployment, ReplicaSet, node lifecycle, HorizontalPodAutoscaler, EndpointSlice, Job and many more.
- **cloud-controller-manager** (only on a cloud) runs the loops that talk to the provider: it removes nodes whose virtual machine is gone, sets up routes, and creates the cloud load balancer for a Service of type `LoadBalancer`.

Every node runs:

- the **kubelet**, the agent that watches the API server for pods bound to its node, has their containers started, runs their probes and reports their status;
- a **container runtime** such as containerd or CRI-O, which the kubelet drives through the Container Runtime Interface (CRI). The built-in Docker Engine integration, dockershim, was removed in Kubernetes 1.24; images built with [Docker](../docker/) keep working, because containerd and CRI-O run the same images;
- **kube-proxy**, which programs each node's packet forwarding so that a Service's address reaches the Service's pods. It is optional: some network plugins do this job themselves.

In production the control plane is replicated. The scheduler and the controller manager run in several copies, of which one is active at a time, chosen by [leader election](../leader-election/) on a Lease object (`--leader-elect` is on by default).

### What you declare

Objects are records of intent. The ones a service like Catalog uses:

| Object | What it declares |
|---|---|
| **Pod** | One or more containers scheduled together, sharing a network address and volumes; the smallest unit Kubernetes runs |
| **Deployment**, **ReplicaSet** | N interchangeable pods from one template; the Deployment keeps one ReplicaSet per version of the template, which is what makes rolling updates and rollback possible |
| **StatefulSet** | Pods with stable names and a persistent volume each, created in order, for databases and brokers |
| **DaemonSet** | One pod on every node, or on a chosen set: log shippers, node monitoring, network plugins |
| **Job**, **CronJob** | Pods that run to completion, once or on a schedule |
| **Service** | A stable name and virtual IP in front of the pods that match a label selector |
| **Ingress**, **Gateway API** | HTTP routing from outside the cluster to Services |
| **ConfigMap**, **Secret** | Configuration and credentials, mounted as files or passed as environment variables |
| **Namespace** | A scope for names, access rules and quotas, often one per team or environment |

### Desired state and reconciliation

`kubectl apply -f catalog.yaml` sends the objects to the API server, which stores them in etcd. At that point nothing runs yet: the cluster only records what should exist. From there each component does one small job in a loop. It watches the API server for the objects it is responsible for, compares what they ask for with what exists, and makes a change, again through the API server. This is the sequence of step 2:

1. The **Deployment controller** finds `catalog` without a ReplicaSet for its pod template and creates one. Its name ends in a hash of the template, which is also kept in the `pod-template-hash` label.
2. The **ReplicaSet controller** counts 0 of 3 pods and creates 3 Pod objects. They are *Pending*: no node has been chosen for them.
3. The **scheduler** first filters the nodes that can take each pod: enough CPU and memory left once the requests of the pods already there are counted, a matching node selector and affinity, and only taints the pod tolerates. It then scores the remaining nodes, picks the best and records the choice through a *binding*.
4. The **kubelet** on that node sees a pod bound to it, has the runtime pull the image and start the container, and runs the probes. When the readiness probe passes, the pod is *Ready* and the EndpointSlice controller adds its address to the Service `catalog`.

The controllers, the scheduler and the kubelets don't call one another; they coordinate only through objects in the API server. When something drifts (a pod is deleted, a node disappears, someone edits `replicas`), the same loops notice the difference and repair it, and because the state lives in etcd, a restarted controller simply carries on from it. The Kubernetes documentation compares a controller to a thermostat; Burns and his co-authors explain in *Borg, Omega, and Kubernetes* (2016) how this design grew out of Google's earlier cluster managers.

The manifests behind the animation, slightly abridged:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: catalog
spec:
  replicas: 3                 # remove this line once the autoscaler below owns the count
  selector:
    matchLabels: {app: catalog}
  template:
    metadata:
      labels: {app: catalog}
    spec:
      containers:
      - name: catalog
        image: 111122223333.dkr.ecr.us-east-1.amazonaws.com/catalog:1.4.2
        ports:
        - containerPort: 8080
        resources:
          requests: {cpu: 250m, memory: 256Mi}
          limits: {memory: 256Mi}
        readinessProbe:
          httpGet: {path: /ready, port: 8080}
        livenessProbe:
          httpGet: {path: /healthz, port: 8080}
---
apiVersion: v1
kind: Service
metadata:
  name: catalog
spec:                         # type ClusterIP is the default
  selector: {app: catalog}
  ports:
  - port: 80
    targetPort: 8080
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: catalog
spec:
  scaleTargetRef: {apiVersion: apps/v1, kind: Deployment, name: catalog}
  minReplicas: 3
  maxReplicas: 6
  metrics:
  - type: Resource
    resource:
      name: cpu
      target: {type: Utilization, averageUtilization: 60}
```

### Requests, limits and placement

- **Requests reserve capacity.** The scheduler puts a pod on a node only if, for CPU and for memory, the requests of the pods already there plus the new pod's requests fit within what the node can give to pods. It does not look at actual use: three Catalog pods reserve 750m of CPU whether they are busy or idle, and a node can refuse a pod while its CPUs sit idle. On a busy node, CPU is also shared in proportion to the requests.
- **Limits cap use.** The kernel throttles a container that reaches its CPU limit. A container that goes over its memory limit can be killed by the kernel's OOM killer (the reason reported is `OOMKilled`); the kill happens when the kernel detects memory pressure, so a container may run above its limit for a while before it is killed.
- **Eviction protects the node.** When a node runs short of memory (on Linux, by default, when less than 100Mi is available) the kubelet evicts pods, starting with those that use more than they requested.
- **Placement rules**: node selectors and node affinity attract pods to nodes; pod affinity and anti-affinity place pods near or away from each other; topology spread constraints spread replicas across zones or nodes; a taint keeps pods off a node unless they carry a matching toleration, as on GPU nodes.

### Services, the Gateway API and kube-proxy

Every pod gets its own IP address, unique across the cluster; a network plugin that implements the Container Network Interface (CNI) wires this up. Pods come and go, so clients use a **Service**: a stable virtual IP and DNS name in front of the pods that match its selector. The default type, `ClusterIP`, is reachable only inside the cluster; `NodePort` and `LoadBalancer` expose a Service outside it.

The pods behind a Service are listed in **EndpointSlices**, each with its conditions, and traffic goes only to endpoints that are ready. When the readiness probe fails, the pod's endpoint is marked not ready and the pod gets no new requests, but it keeps running. kube-proxy turns the EndpointSlices into forwarding rules on every node and picks a backend at random by default. Its modes on Linux, as of Kubernetes 1.37:

- `iptables`, the default;
- `nftables`, the successor (needs Linux kernel 5.13 or later); a future release will make it the default, so set the mode explicitly;
- `ipvs`, deprecated since 1.35, to be disabled by default from 1.40 and removed in 1.43.

From outside, HTTP traffic reaches Services through an Ingress or a Gateway. The **Ingress API** is generally available but frozen: it will not be removed and will not change again, and the Kubernetes project recommends the **Gateway API** instead. The Gateway API is an add-on, a set of custom resources that splits the job by role: a GatewayClass names the controller that implements gateways, a Gateway is one entry point (often a cloud load balancer) owned by the platform team, and HTTPRoute or GRPCRoute objects, owned by application teams, send requests to Services. In the animation an HTTPRoute sends `/products` to `catalog`. The Gateway API reached v1.0 (GA) in October 2023; v1.6.0 came out in June 2026. The widely used Ingress [NGINX](../nginx/) controller was retired in March 2026 and its repository is archived, so clusters still on it should move to the Gateway API or to another controller.

A **NetworkPolicy** restricts which pods may talk to which, but only if the network plugin enforces it; without such a plugin the object has no effect.

### Health checks and self-healing

The kubelet runs three kinds of probe against each container:

- **liveness**: if it fails, the kubelet restarts the container;
- **readiness**: if it fails, the pod leaves its Services' endpoints until it passes again;
- **startup**: holds the other two back until a slow-starting container is up.

By default a probe runs every 10 s, times out after 1 s, and counts as failed after 3 failures in a row.

A failed **node** is detected by the control plane, because the node itself can no longer report. Each kubelet sends heartbeats, by renewing a Lease object and updating its node's status. Step 3 follows the defaults:

1. After 50 s without a heartbeat (`--node-monitor-grace-period`), the node controller sets node-2's `Ready` condition to `Unknown` (`kubectl get nodes` shows `NotReady`), taints the node `node.kubernetes.io/unreachable` and marks its pods not ready. Their endpoints are marked not ready too, so the Service stops sending them traffic.
2. Unless a workload sets its own, its pods tolerate that taint for 300 s, through a toleration Kubernetes adds automatically. When it runs out, the pod is evicted.
3. The ReplicaSet no longer counts the evicted pod, creates a replacement, and the scheduler places it on a healthy node, here node-3.

So a stateless pod on a dead node is replaced after about six minutes, while its traffic stops within about a minute. Set `tolerationSeconds` on a workload to shorten or lengthen the wait. The kubelet on a partitioned node never hears about the eviction, so the old pod can keep running there until the node reconnects. That is harmless for Catalog but not for a database, and it is why a StatefulSet doesn't start a pod's replacement until the old pod is confirmed gone: when the node is deleted, when its kubelet reports back, or when someone force-deletes the pod.

Planned disruptions, such as draining a node for an upgrade, go through the eviction API instead, and a **PodDisruptionBudget** limits how many of a workload's pods may be down for them at the same time.

### Scaling pods and nodes

The **HorizontalPodAutoscaler** checks its metrics every 15 s and computes

```
desiredReplicas = ceil(currentReplicas × currentMetricValue / desiredMetricValue)
```

For CPU, the value is the average utilization as a percentage of the pods' **requests**; a pod without a CPU request gives the autoscaler nothing to compute. In step 3 the three pods average 90% of their 250m request (225m each) against a target of 60%, so the HPA asks for ceil(3 × 90 / 60) = 5 replicas, within its range of 3 to 6. If the load stays the same, five pods average 54%. At 40% it would ask for ceil(3 × 40 / 60) = 2, and `minReplicas` keeps it at 3. The autoscaler ignores ratios within 10% of 1.0 (the default tolerance, which an HPA can override, stable since 1.37). By default it may double the replicas, or add 4, whichever is more, every 15 s, and it scales down only to the highest recommendation of the last 5 minutes, so short dips don't remove pods. Resource metrics come from the metrics API, usually served by metrics-server. Since 1.37 (beta, on by default), an HPA that scales on object or external metrics, such as the length of a queue, can set `minReplicas: 0`; scaling to zero on CPU or memory is not supported.

The **Vertical Pod Autoscaler** is an add-on from the Kubernetes autoscaler project. It sets requests from observed use; its `InPlaceOrRecreate` mode, GA in VPA 1.6, applies them to running pods in place where it can (in-place resize is stable since Kubernetes 1.35) and recreates the pod otherwise. Its documentation warns against combining it with an HPA on the same CPU or memory metric.

Pods that fit no node stay Pending, and a **node autoscaler** adds nodes for them and removes nodes that are no longer needed. SIG Autoscaling sponsors two: **Cluster Autoscaler**, which grows and shrinks predefined node groups, and **Karpenter**, which launches individual instances that fit the pending pods, from NodePool rules, and also replaces nodes as they age or new images come out.

### Rolling updates

Change the image to `catalog:1.4.3` and the Deployment creates a new ReplicaSet and moves pods to it gradually. Two settings bound the move, both 25% by default: `maxSurge`, the number of extra pods allowed, rounded up, and `maxUnavailable`, the number of pods allowed to be missing, rounded down. With 3 replicas that is 1 extra and 0 missing: one new pod starts, and an old one goes only after the new one is ready. With 5 replicas it is 2 and 1. A rollout that makes no progress for `progressDeadlineSeconds` (600 s by default) is reported as failed, and Kubernetes does nothing else about it: roll back yourself with `kubectl rollout undo deployment/catalog`. See [rolling update](../rolling-update/); [canary releases](../canary-release/) and [blue-green deployments](../blue-green-deployment/) need more, such as weighted backends in an HTTPRoute or a progressive-delivery controller.

### Storage

A pod asks for durable storage through a **PersistentVolumeClaim**; a **StorageClass** provisions a matching **PersistentVolume** on demand, through a storage driver that implements the Container Storage Interface (CSI). In-tree cloud volume types such as `gcePersistentDisk` now hand every operation to the matching CSI driver. A StatefulSet gives each of its pods its own claim. Volumes such as Amazon EBS live in one Availability Zone, so a pod that uses one can only be scheduled in that zone.

### Security

- **Access to the API**: every request is authenticated, then authorized, usually by RBAC, which has four kinds of object: Role and ClusterRole say what is allowed, RoleBinding and ClusterRoleBinding say for whom. Pods call the API as a ServiceAccount, so give each workload its own and bind only what it needs.
- **Pod Security Standards** define three levels, `privileged`, `baseline` and `restricted`, and the built-in Pod Security admission controller (stable since 1.25) enforces one per namespace through a label.
- **NetworkPolicy**: without any policy every pod can reach every other pod; add a default-deny policy per namespace and open what is needed.
- **Secrets** are only base64-encoded and, by default, stored unencrypted in etcd. Turn on encryption at rest, preferably with a KMS v2 provider (stable since 1.29), limit with RBAC who can read Secrets, or keep credentials in an external secrets manager.

### Versions, support and scale (October 2026)

The current minor release is **1.37**, released on 26 August 2026 (latest patch 1.37.1, 15 September 2026). Kubernetes ships about three minor releases a year and maintains the three most recent (1.37, 1.36 and 1.35). Each gets about 14 months of patches, 12 months of standard support and 2 months of maintenance mode, so 1.37 reaches end of life on 28 October 2027. An upgrade moves the API servers one minor version at a time, then the other control-plane components, then the nodes; a kubelet may be up to three minor versions older than the API server, never newer, and `kubectl` should be within one minor version of it. Kubernetes 1.37 supports clusters of up to 5,000 nodes, 110 pods per node, 150,000 pods and 300,000 containers.

## Where it fits

- **Solutions.** The platform under [microservices](../microservices/) like Acme Shop's; internal developer platforms that give teams a self-service way to deploy; batch, data and machine-learning jobs next to long-running services; and hybrid or multi-cloud setups that want the same API on Amazon EKS, Azure AKS, Google GKE and their own hardware.
- **Patterns it implements or supports.** [Rolling updates](../rolling-update/) built into Deployments; [autoscaling](../autoscaling/) of pods and nodes; [health endpoint monitoring](../health-endpoint-monitoring/) through probes; [sidecars](../sidecar/), native since sidecar containers became stable in 1.33, and the [ambassador](../ambassador/) built on them; a [service mesh](../service-mesh/) on top of the cluster; [GitOps](../gitops/), where Argo CD or Flux applies the manifests from Git with the same reconcile-loop idea; [leader election](../leader-election/) on Lease objects, for the control plane and for your own controllers; [external configuration](../external-configuration-store/) through ConfigMaps and Secrets; [bulkheads](../bulkhead/) through namespaces, quotas, requests and limits; [immutable infrastructure](../immutable-infrastructure/), since pods are replaced rather than patched; and [canary](../canary-release/) and [blue-green](../blue-green-deployment/) releases with the help of the Gateway API or a progressive-delivery controller.
- **Usual neighbours.** A CI pipeline that builds images and a registry such as Amazon ECR; a GitOps controller; a cloud load balancer, DNS and an [API gateway](../api-gateway/) in front; [centralized logging](../centralized-logging/), metrics and [distributed tracing](../distributed-tracing/) around it; a secrets manager; and managed databases outside the cluster for most stateful data, such as [PostgreSQL](../postgresql/) on [Amazon RDS](../amazon-rds-aurora/).
- **Managed offerings (October 2026).** **Amazon EKS** runs the control plane for $0.10 per cluster per hour while a version is in standard support (14 months after EKS releases it) and $0.60 in the 12 months of extended support that follow, which is on by default. EKS supports Kubernetes 1.31 to 1.37; 1.37 arrived on EKS on 1 October 2026, and its standard support ends on 1 December 2027. **EKS Auto Mode** extends AWS's management to the nodes: it provisions and scales them with Karpenter, patches and upgrades them, and handles load balancing, pod networking, cluster DNS and block storage, for a fee on top of each EC2 instance it manages. EKS also offers Provisioned Control Plane tiers that reserve control-plane capacity for demanding workloads, AWS Fargate to run each pod on its own isolated compute without nodes, Hybrid Nodes for on-premises machines, and EKS Capabilities, which run Argo CD, AWS Controllers for Kubernetes and kro as managed services. **Azure AKS** offers AKS Automatic, preconfigured for production with node autoprovisioning and the HPA, KEDA and VPA turned on, and **Google GKE** offers Autopilot, which Google recommends: Google manages the nodes and bills most pods for the resources they request.
- **Licence and project.** Kubernetes is open source under the Apache License 2.0. It joined the Cloud Native Computing Foundation in March 2016 and graduated in March 2018.

## When to use it

Choose Kubernetes when you run many services, or a few that need fine control over scheduling, scaling, networking or storage, when you want one API across clouds and data centres, or when you want its ecosystem of operators, meshes, GitOps tools and autoscalers. Unless you have a reason to run the control plane yourself, start with a managed one. For a handful of stateless HTTP services on AWS, [Amazon ECS](../amazon-ecs/) is less to learn and run; for request-driven services that can scale to zero, serverless containers remove the cluster altogether; HashiCorp Nomad suits teams that also schedule non-container workloads and want a smaller system.

| | Kubernetes | Amazon ECS | HashiCorp Nomad | Serverless containers (AWS Fargate, Google Cloud Run) |
|---|---|---|---|---|
| What it is | Open-source orchestrator with an extensible API: custom resources and controllers | AWS's own orchestrator, configured through the AWS API | Scheduler in a single binary, for containers, virtual machines and plain programs | Containers run on the provider's compute; Fargate under ECS or EKS, Cloud Run as a whole platform |
| Control plane | You, or managed: EKS, AKS, GKE | AWS, with no charge for orchestration | You run the Nomad servers | The provider |
| Nodes | Yours, or managed: EKS Auto Mode, GKE Autopilot, AKS Automatic | EC2 instances you manage, ECS Managed Instances, or Fargate | Yours | None to manage; on EKS Fargate each pod gets its own kernel, and DaemonSets and GPUs are not available |
| Scaling | HPA, VPA, Cluster Autoscaler or Karpenter | Service auto scaling and capacity providers | Separate Nomad Autoscaler | Fargate: the orchestrator's scaling; Cloud Run: per request, down to zero |
| Licence and cost | Apache 2.0; EKS charges $0.10 per cluster per hour plus the nodes | No ECS fee; you pay for EC2, Fargate or the Managed Instances fee | Business Source License 1.1 since 1.7.0 (each version becomes MPL 2.0 after four years) | Pay for the vCPU and memory requested (Fargate), or per request or per instance (Cloud Run) |
| Best for | Many services, portability, fine control | AWS-only teams that want less to run | Mixed workloads, small operations teams | Spiky or small services, teams that don't want to run nodes |

Figures from the Kubernetes 1.37, Amazon EKS, Amazon ECS, AWS Fargate, Google Cloud Run and HashiCorp Nomad documentation, October 2026.

## Trade-offs

- **A system of its own to run.** The control plane, the network plugin, CoreDNS, a gateway controller, metrics-server, autoscalers and CSI drivers all need installing, watching and upgrading, at least once a year, to stay within the roughly 14 months each minor release is patched. A managed service takes over the control plane and sometimes the nodes, not the design: requests, probes, network policies and upgrade testing stay yours.
- **Much to learn.** A small service already needs a Deployment, a Service, a route, an autoscaler, a disruption budget and access rules, plus the tooling to template them (Helm, Kustomize). The concepts pay off across many services; for two or three, they are mostly cost.
- **Efficiency depends on requests.** Pods are packed by what they request. Requests set too high leave nodes reserved but idle; set too low, pods compete for CPU, and memory-hungry ones are evicted or OOM-killed.
- **Slow failure handling by default.** Traffic leaves a dead node's pods after about a minute, but the pods are replaced only after about six, and stateful pods may need a person to confirm the node is gone.
- **Secure only once configured.** Out of the box every pod can reach every other pod and Secrets sit unencrypted in etcd; network policies, Pod Security admission, RBAC hygiene and encryption at rest are opt-in.
- **Overhead.** A managed control plane costs about $73 a month per cluster on EKS at $0.10 an hour, and every node gives some capacity to the kubelet, the runtime and DaemonSets.

## Implementation notes

- **Size requests from measurements.** Start from observed CPU and memory (the VPA can recommend values), set the memory limit at or above the real peak, and decide deliberately about CPU limits: a limit throttles the container even when the node has idle CPU.
- **Keep probes honest.** Readiness answers "can I take traffic now?", liveness only "am I stuck beyond repair?". Never make liveness depend on a database or another service, or one outage restarts every pod; give slow starters a startup probe.
- **Let the autoscaler own the replica count.** Remove `replicas` from the Deployment once an HPA manages it, as the documentation recommends, or every `kubectl apply` resets the count. The same setting from the command line: `kubectl autoscale deployment catalog --min=3 --max=6 --cpu=60%`.
- **Survive node and zone loss.** Run at least three replicas, spread them across zones with topology spread constraints, and protect them during drains with a PodDisruptionBudget.
- **Plan upgrades as routine.** Stay within the patched versions, read the deprecation notes before each minor upgrade, move one minor version at a time, and upgrade nodes after the control plane. Set the kube-proxy mode explicitly, since a future default will change it.
- **Use the Gateway API for new routing**, and move off Ingress NGINX, which no longer receives fixes.
- **Start secure.** One ServiceAccount per workload with least-privilege RBAC, the `restricted` Pod Security level where workloads allow it, a default-deny NetworkPolicy per namespace, encryption at rest with KMS v2, and a private etcd.
- **Watch the loops.** Pending pods, restarts and `OOMKilled` reasons, HPA decisions (`kubectl describe hpa catalog`), node conditions and events tell you which loop is unhappy:

```sh
kubectl get nodes                                  # is any node NotReady?
kubectl get pods -l app=catalog -o wide            # which pod runs on which node, and is it ready?
kubectl describe hpa catalog                       # current and target CPU, and the last scaling events
kubectl rollout status deployment/catalog          # wait for a rollout to finish
kubectl rollout undo deployment/catalog            # go back to the previous ReplicaSet
```

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Docker & Containers](../docker/) — Package an app and its dependencies as an image and run it as an isolated process: layers, registries, namespaces, cgroups.
- [Amazon ECS & Fargate](../amazon-ecs/) — Run containers on AWS: task definitions, services that keep tasks running behind a load balancer, on EC2 or serverless Fargate.
- [etcd](../etcd/) — A strongly consistent key-value store on Raft that clusters use for configuration, service discovery, locks and leader election.
- [Rolling Update](../rolling-update/) — Replace instances batch by batch while the service stays up.
- [Autoscaling](../autoscaling/) — Add and remove instances automatically as load rises and falls.
- [Health Endpoint Monitoring](../health-endpoint-monitoring/) — Expose liveness and readiness checks that load balancers and monitors probe.
- [Sidecar](../sidecar/) — Run helper capabilities (proxy, logging, config) in a separate process next to the app.
- [Service Mesh](../service-mesh/) — Sidecar proxies plus a control plane: mTLS, retries and traffic shifting without touching app code.
- [GitOps](../gitops/) — Git holds the desired state; an agent continuously reconciles the cluster to match it.

## References

- [Kubernetes documentation — Kubernetes Components](https://kubernetes.io/docs/concepts/overview/components/)
- [Kubernetes documentation — Cluster Architecture](https://kubernetes.io/docs/concepts/architecture/)
- [Kubernetes documentation — Controllers](https://kubernetes.io/docs/concepts/architecture/controller/)
- [Kubernetes documentation — kube-controller-manager](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/)
- [Kubernetes documentation — Operating etcd clusters for Kubernetes](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/)
- [Kubernetes documentation — Container Runtimes](https://kubernetes.io/docs/setup/production-environment/container-runtimes/)
- [Kubernetes documentation — Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Kubernetes documentation — Kubernetes Scheduler](https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/)
- [Kubernetes documentation — Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
- [Kubernetes documentation — Node-pressure Eviction](https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/)
- [Kubernetes documentation — Pod Topology Spread Constraints](https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/)
- [Kubernetes documentation — Taints and Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/)
- [Kubernetes documentation — Service](https://kubernetes.io/docs/concepts/services-networking/service/)
- [Kubernetes documentation — EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/)
- [Kubernetes documentation — Virtual IPs and Service Proxies](https://kubernetes.io/docs/reference/networking/virtual-ips/)
- [Kubernetes documentation — Gateway API](https://kubernetes.io/docs/concepts/services-networking/gateway/)
- [Kubernetes documentation — Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)
- [Kubernetes Gateway API — HTTP traffic splitting](https://gateway-api.sigs.k8s.io/guides/user-guides/traffic-splitting/)
- [Kubernetes Gateway API — Releases](https://github.com/kubernetes-sigs/gateway-api/releases)
- [Kubernetes blog — Ingress NGINX Retirement: What You Need to Know (November 2025)](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/)
- [kubernetes/ingress-nginx — Ingress NGINX Controller repository (archived)](https://github.com/kubernetes/ingress-nginx)
- [Kubernetes documentation — Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
- [Kubernetes documentation — Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/)
- [Kubernetes documentation — Nodes](https://kubernetes.io/docs/concepts/architecture/nodes/)
- [Kubernetes documentation — Force Delete StatefulSet Pods](https://kubernetes.io/docs/tasks/run-application/force-delete-stateful-set-pod/)
- [Kubernetes documentation — Disruptions](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/)
- [Kubernetes documentation — Horizontal Pod Autoscaling](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/)
- [Kubernetes documentation — Node Autoscaling](https://kubernetes.io/docs/concepts/cluster-administration/node-autoscaling/)
- [Vertical Pod Autoscaler — Features](https://github.com/kubernetes/autoscaler/blob/master/vertical-pod-autoscaler/docs/features.md)
- [Vertical Pod Autoscaler — Known limitations](https://github.com/kubernetes/autoscaler/blob/master/vertical-pod-autoscaler/docs/known-limitations.md)
- [Kubernetes documentation — Resize CPU and Memory Resources assigned to Containers](https://kubernetes.io/docs/tasks/configure-pod-container/resize-container-resources/)
- [Kubernetes documentation — Sidecar Containers](https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/)
- [Kubernetes documentation — Volumes](https://kubernetes.io/docs/concepts/storage/volumes/)
- [Kubernetes documentation — Using RBAC Authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)
- [Kubernetes documentation — Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)
- [Kubernetes documentation — Pod Security Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/)
- [Kubernetes documentation — Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)
- [Kubernetes documentation — Encrypting Confidential Data at Rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/)
- [Kubernetes documentation — Using a KMS provider for data encryption](https://kubernetes.io/docs/tasks/administer-cluster/kms-provider/)
- [Kubernetes — Releases](https://kubernetes.io/releases/)
- [Kubernetes — Patch Releases (support period)](https://kubernetes.io/releases/patch-releases/)
- [Kubernetes — Version Skew Policy](https://kubernetes.io/releases/version-skew-policy/)
- [Kubernetes blog — Kubernetes v1.37: Garhwal (August 2026)](https://kubernetes.io/blog/2026/08/26/kubernetes-v1-37-release/)
- [Kubernetes documentation — Considerations for large clusters](https://kubernetes.io/docs/setup/best-practices/cluster-large/)
- [Brendan Burns, Brian Grant, David Oppenheimer, Eric Brewer, John Wilkes — Borg, Omega, and Kubernetes (ACM Queue, 2016)](https://research.google/pubs/borg-omega-and-kubernetes/)
- [CNCF — Kubernetes project](https://www.cncf.io/projects/kubernetes/)
- [Amazon EKS User Guide — What is Amazon EKS?](https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html)
- [Amazon EKS User Guide — Understand the Kubernetes version lifecycle on EKS](https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html)
- [Amazon EKS User Guide — Automate cluster infrastructure with EKS Auto Mode](https://docs.aws.amazon.com/eks/latest/userguide/automode.html)
- [Amazon EKS Pricing](https://aws.amazon.com/eks/pricing/)
- [Amazon EKS User Guide — Simplify compute management with AWS Fargate](https://docs.aws.amazon.com/eks/latest/userguide/fargate.html)
- [Google Kubernetes Engine — GKE Autopilot overview](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview)
- [Google Kubernetes Engine pricing](https://cloud.google.com/kubernetes-engine/pricing)
- [Microsoft Learn — Introduction to Azure Kubernetes Service (AKS) Automatic](https://learn.microsoft.com/en-us/azure/aks/intro-aks-automatic)
- [Amazon ECS Developer Guide — Architect your solution for Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-configuration.html)
- [Amazon ECS Pricing](https://aws.amazon.com/ecs/pricing/)
- [Amazon ECS Developer Guide — Automatically scale your Amazon ECS service](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html)
- [AWS Fargate Pricing](https://aws.amazon.com/fargate/pricing/)
- [Google Cloud Run — What is Cloud Run](https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run)
- [HashiCorp Nomad — What is Nomad?](https://developer.hashicorp.com/nomad/docs/what-is-nomad)
- [HashiCorp Nomad — LICENSE (Business Source License 1.1)](https://github.com/hashicorp/nomad/blob/main/LICENSE)
- [HashiCorp — Nomad Autoscaler](https://github.com/hashicorp/nomad-autoscaler)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
