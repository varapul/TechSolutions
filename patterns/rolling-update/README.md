<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🚀 Deployment & Release](../../README.md#deployment--release)

# Rolling Update

> Replace instances batch by batch while the service stays up.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Rolling Update" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/rolling-update.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Surge one new instance** | The service runs four `v1` instances and the load balancer spreads requests across them. A new revision arrives, and the controller starts one `v2` instance in the **surge** slot, the single extra instance that *max surge 1* allows. Until its **readiness check** passes it is not in rotation and receives no traffic. |
| **2 · Swap one at a time** | Once the new instance is ready it joins the load balancer, and only then does the controller **drain** one old instance: no new requests, the ones in flight finish, then it is removed and the next `v2` starts. With *max unavailable 0* the service never has fewer than four ready instances, and with *max surge 1* never more than five in total. Meanwhile `v1` and `v2` answer users side by side, so the two versions have to be compatible with each other. |
| **3 · A bad instance stalls it** | A third swap goes through, then the fourth `v2` instance never passes its readiness check, here because the configuration for the zone it landed in is wrong. It gets no traffic, the surge slot stays occupied and the last `v1` may not be removed without a ready replacement, so the controller can do nothing: the **rollout** is stuck, while four ready instances keep serving. When its progress deadline passes the controller reports the stall, and someone (or an automated policy) has to **roll back** to the previous revision or **fix forward**. |
| **4 · Fix and finish** | The configuration is corrected, the instance restarts with it and passes its check, and the controller continues where it stopped: the last `v1` drains and leaves, four `v2` instances serve and the surge slot is empty. (A fix that needs a new build is a third revision: the controller would then replace every instance again, the three healthy `v2` ones included.) The previous revision is kept, so rolling back is one command, although it runs as another rolling update and not as a switch. |
<!-- END GENERATED: header -->

## The problem

A new version has to replace the old one on every instance of a running service. Stopping everything, upgrading and starting again is simple, but users see downtime. Building a complete second fleet next to the first avoids that, but doubles the capacity for the length of the release. Most services need something in between: enough instances keep answering while the others are replaced, and a build that doesn't start properly never takes the place of a healthy one.

## How it works

A controller (the Kubernetes Deployment controller, the Amazon ECS service scheduler, the manager of an instance group or scale set) replaces the fleet in place, a batch at a time. For each batch it:

1. starts new-version instances, as many as the surge limit allows;
2. waits until their **readiness check** passes, and only then lets the load balancer send them traffic;
3. **drains** the same number of old instances (no new requests, the ones in flight finish) and removes them;
4. repeats until every instance runs the new version.

Two dials set the pace:

- **Max surge**: how many instances may exist *above* the desired count. More surge means bigger batches and a faster rollout, paid for with spare capacity (and quota) while it runs.
- **Max unavailable**: how many may be missing *below* the desired count. This also speeds things up and costs nothing extra, but the remaining instances carry the load, so it only works when there is headroom.

For a fleet of four, the settings play out like this:

| Max surge | Max unavailable | Instances during the rollout | Ready at worst | What you trade |
|:-:|:-:|:-:|:-:|---|
| 1 | 0 | 4 to 5 | 4 | The diagram: one spare instance, no lost capacity, one swap at a time. |
| 0 | 1 | 3 to 4 | 3 | No extra capacity, but a quarter less serving while it runs. |
| 25% | 25% | 3 to 5 | 3 | The Kubernetes default. With four instances that is 1 and 1, so a new one starts while an old one is already leaving. |
| 100% | 0 | 4 to 8 | 4 | The Amazon ECS default (minimum healthy 100%, maximum 200%): a whole new set starts before the old one stops. Fastest, at double the capacity. |

The two dials cannot both be zero, or nothing could move.

The only gate between batches is readiness. With the diagram's settings, a new instance that never becomes ready keeps the surge slot occupied, no old instance may leave without a ready replacement, and the rollout stops with full capacity still serving. With unavailability above zero, the instances already taken out stay out, so the service runs short until someone acts. What happens next depends on the platform: some only report the stall and wait, others can be set to roll back by themselves.

## When to use it

- As the default for stateless services behind a load balancer, when old and new versions can run side by side.
- When you want no downtime but can't or won't pay for a second full fleet.
- For routine changes of any kind that replace instances: a new build, new configuration, a new base image or instance type.
- **Not** when the two versions can't serve side by side, such as a breaking change to an API, a message format or a schema made in one step. Every user would meet a mix of both for the whole rollout. Split the change into compatible steps (expand and contract), or move all traffic at once with a [blue-green deployment](../blue-green-deployment/), where a shared database still has to suit both versions.
- **Not** when you need an instant way back. Undoing a rolling update is another rolling update. Keep the old fleet warm (blue-green), or ship the risky code switched off behind a [feature flag](../feature-flags/).
- **Not** as a way to try a version on a few users first. That is a [canary release](../canary-release/).

## Trade-offs

- **Version skew is part of the deal.** For the length of the rollout, and of any rollback, old and new serve the same users, read the same database and consume each other's messages. A user can be answered by v2 on one request and by v1 on the next. APIs, schemas, cache entries and message formats must therefore stay compatible across one version step, in both directions.
- **Only as safe as the readiness check.** The controller promotes whatever reports ready. A check that only proves the process is up will pass a build that fails every real request, and the rollout will then replace the whole fleet with it. Make the check mean "can serve real traffic". Keep it separate from **liveness**: an instance that fails readiness is taken out of rotation and left running, one that fails liveness is restarted. A readiness check that also tests a shared dependency keeps traffic away from instances that could only return errors, but when that dependency blips, every instance turns unready at once.
- **No control over exposure, and no comparison.** The share of traffic on the new version is simply the share of instances already replaced, and it keeps growing on its own. Nothing compares the new version's error rate or latency with the old one's. For a small, fixed share of users and a metrics gate use a [canary release](../canary-release/); for a version tested on the real stack before any user sees it use a [blue-green deployment](../blue-green-deployment/).
- **Rollback is not instant.** It runs through the same batches, drains and readiness waits in the other direction, and the bad version keeps answering part of the traffic until it finishes. Rolling back the code doesn't roll back data the new version has already written.
- **Speed against spare capacity.** Small batches are safe and slow: a large fleet with long start-up and drain times can take hours. Bigger surge needs capacity and quota; bigger unavailability needs headroom, which a busy service may not have at peak.
- **Drain properly or drop requests.** Removing an instance that still holds open requests turns a zero-downtime rollout into a burst of errors. The instance has to leave the rotation first, finish its work and only then exit; long-lived connections need a deadline. [Load Balancing](../load-balancing/) covers connection draining.
- **Stateful workloads need more care.** Replicas with their own identity and data are replaced in a fixed order, one at a time, waiting for each to rejoin before the next one goes, and usually the primary last.

## Implementation notes

The names differ by platform; the two dials, the readiness gate and the drain are the same everywhere.

- **Kubernetes Deployment.** `RollingUpdate` is the default strategy. `maxSurge` and `maxUnavailable` both default to 25% (surge rounds up, unavailable rounds down, and they can't both be zero). `minReadySeconds` (default 0) makes a new Pod stay ready for that long before it counts as available. `progressDeadlineSeconds` (default 600) only sets the `Progressing` condition to false with the reason `ProgressDeadlineExceeded`: Kubernetes keeps trying and does not roll back, so alert on it or let a pipeline act. Old ReplicaSets are the revision history (`revisionHistoryLimit`, default 10): `kubectl rollout undo` goes back to the previous one, `--to-revision` to a chosen one, and `kubectl rollout status`, `pause` and `resume` watch and hold a rollout. Changing the Pod template again while a rollout is running starts a new revision at once and scales down the half-rolled one together with the old one.
- **Graceful shutdown on Kubernetes.** When a Pod is deleted, its endpoint is marked as not ready, so Services stop sending it new traffic; at the same time its `preStop` hook runs and the container then receives `SIGTERM` (or the stop signal of its image). After `terminationGracePeriodSeconds` (default 30, hook included) whatever is left is killed. Because the endpoint update and the signal race each other, a short `preStop` sleep is a common way to keep serving until the load balancers have caught up; the application then has to finish in-flight requests and exit on `SIGTERM`. A terminating Pod is no longer counted, so its replacement can start while it is still shutting down, and for a while more Pods run than `replicas` plus `maxSurge`.
- **Probes on Kubernetes.** A failing readiness probe removes the Pod from the Service's endpoints and holds the rollout; a failing liveness probe restarts the container; a startup probe holds both back until a slow starter is up.
- **Amazon ECS** (rolling update deployment type). `minimumHealthyPercent` (default 100) and `maximumPercent` (default 200) are the same two dials, as percentages of the desired task count. The deployment circuit breaker counts tasks that fail to start or fail their health checks and, past a threshold (by default half the desired count, kept between 3 and 200), marks the deployment as failed and can roll back to the last completed one. CloudWatch alarms can fail and roll back a deployment on application metrics.
- **Amazon EC2 Auto Scaling instance refresh.** The minimum healthy percentage defaults to 90 and the maximum to 100, so by default it takes a tenth of the group out and then replaces it; with a minimum of 100 it launches a new instance before it terminates an old one. Instance warm-up, checkpoints and a bake time control the pace, and skip matching leaves alone the instances that already match. New instances that fail their health checks are replaced, and if that keeps happening for an hour the refresh fails. Automatic rollback is off unless you turn it on.
- **Azure Virtual Machine Scale Sets.** The *rolling* upgrade policy mode (the others are automatic and manual) upgrades in batches of a set percentage, can pause between batches, stops when too many instances are unhealthy, and needs a health probe or the Application Health extension to know. With `MaxSurge` it creates new instances before it deletes old ones; without it, instances are upgraded in place and capacity can dip during each batch.
- **Google Cloud managed instance groups.** `maxSurge` and `maxUnavailable` default to 1 for a zonal group and to the number of zones for a regional one. There is no rollback command: you roll back by starting another update with the old instance template.
- **Stateful sets.** A Kubernetes StatefulSet updates one Pod at a time, from the highest ordinal to the lowest, and waits until each is Running and Ready. A `partition` keeps the lower ordinals on the old version for a staged rollout.
- **Autoscaling during a rollout.** The desired count can change while instances are being replaced. Kubernetes then spreads the extra replicas over the old and the new ReplicaSet in proportion; check what your platform does before combining a slow rollout with [Autoscaling](../autoscaling/).
- **Don't let it finish unobserved.** Watch error rate and latency per version during the rollout, alert on a rollout that passes its deadline, and put a pause or a bake time after the first batch when the change is risky.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Blue-Green Deployment](../blue-green-deployment/) — Run the new version beside the old one and switch all traffic in one step.
- [Canary Release](../canary-release/) — Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back.
- [Feature Flags](../feature-flags/) — Deploy code dark, then turn features on per user or percentage at runtime.
- [Expand and Contract](../expand-and-contract/) — Change a schema or API in backward-compatible steps: expand, migrate, then contract.
- [Load Balancing](../load-balancing/) — Spread requests across healthy instances and stop sending to unhealthy ones.
- [Health Endpoint Monitoring](../health-endpoint-monitoring/) — Expose liveness and readiness checks that load balancers and monitors probe.
- [Autoscaling](../autoscaling/) — Add and remove instances automatically as load rises and falls.
- [Immutable Infrastructure](../immutable-infrastructure/) — Never patch servers in place: bake a new image and replace them.

## Related components and services

- [Docker & Containers](../docker/) — Package an app and its dependencies as an image and run it as an isolated process: layers, registries, namespaces, cgroups.
- [Kubernetes](../kubernetes/) — A container orchestrator: you declare the desired state, and controllers keep pods scheduled, healthy and reachable.
- [Amazon ECS & Fargate](../amazon-ecs/) — Run containers on AWS: task definitions, services that keep tasks running behind a load balancer, on EC2 or serverless Fargate.

## References

- [Kubernetes — Deployments (rolling update strategy, rollback, progress deadline)](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Kubernetes — Pod Lifecycle (termination of Pods)](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
- [Kubernetes — Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/)
- [Kubernetes — StatefulSets (update strategies)](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)
- [Amazon ECS — Deploy Amazon ECS services by replacing tasks (rolling update)](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-ecs.html)
- [Amazon ECS — How the Amazon ECS deployment circuit breaker detects failures](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html)
- [Amazon EC2 Auto Scaling — How an instance refresh works in an Auto Scaling group](https://docs.aws.amazon.com/autoscaling/ec2/userguide/instance-refresh-overview.html)
- [Azure — Upgrade policy modes for Virtual Machine Scale Sets](https://learn.microsoft.com/en-us/azure/virtual-machine-scale-sets/virtual-machine-scale-sets-upgrade-policy)
- [Google Cloud — Automatically apply VM configuration updates in a MIG](https://docs.cloud.google.com/compute/docs/instance-groups/rolling-out-updates-to-managed-instance-groups)
- [Google SRE Book — Reliable Product Launches at Scale (chapter 27, gradual and staged rollouts)](https://sre.google/sre-book/reliable-product-launches/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
