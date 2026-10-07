<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [☁️ Cloud Infrastructure](../../README.md#cloud-infrastructure)

# Autoscaling

> Add and remove instances automatically as load rises and falls.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Autoscaling" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/autoscaling.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Steady state** | A **target-tracking** policy keeps the group's average CPU near **60%**, with between **2 and 6** instances. Two instances at 48% are under the target: 2 × 48% ÷ 60% = 1.6, which rounds up to 2, so the autoscaler changes nothing. |
| **2 · Spike: scale out** | Traffic doubles, the two instances run at 96% and requests start to queue, so latency climbs. The autoscaler works out 2 × 96% ÷ 60% = 3.2, rounds up to **4** and launches two instances. They need time to boot and warm up, and the load balancer sends them requests only after they **pass its health checks**. |
| **3 · New capacity** | Four instances share the load at 48% and latency recovers. 4 × 48% ÷ 60% = 3.2 still rounds up to 4, so the group holds. When the load dips for a moment the raw result is 3, but the **scale-in window** (a stabilisation window, 5 minutes here) acts on the highest result it has seen in that window, so the group doesn't flap between 3 and 4. |
| **4 · Scale in** | Traffic halves and CPU drops to 24%: 4 × 24% ÷ 60% = 1.6, so 2 instances would be enough. The autoscaler removes two only after the load has stayed low for the whole window. The load balancer **drains** them first (no new requests, in-flight ones finish), then they are terminated and the group is back at its minimum of 2. |
<!-- END GENERATED: header -->

## The problem

Load is rarely flat. It follows the working day, jumps after a marketing email or a mention in the news, and falls away at night. A fleet sized for the peak pays for idle instances most of the time. A fleet sized for the average runs out of headroom at the peak: requests queue, latency climbs and errors follow. Resizing by hand is slow and error-prone, and nobody is watching the graphs at 3 a.m.

## How it works

Autoscaling is a control loop around a group of identical, interchangeable instances (VMs, containers or Pods) that sit behind a load balancer or read from a queue.

- **Measure.** Each instance reports a metric that rises and falls with its share of the work: average CPU, requests per instance, or queue backlog per worker.
- **Decide.** With **target tracking** you pick a target value (60% CPU here). The autoscaler works out the capacity that would bring the metric back to it, *desired = instances × current value ÷ target*, rounds up, and keeps the result between the **minimum** and the **maximum**. The Kubernetes Horizontal Pod Autoscaler (HPA) documents exactly this calculation. EC2 Auto Scaling compares target tracking to a thermostat and rounds conservatively: it would rather add one instance too many, or remove one too few.
- **Act.** New instances boot, start the application and warm up, and the load balancer sends them requests only once they pass its health checks. An instance being removed is deregistered first, so it gets no new requests while its in-flight ones finish (*connection draining*). Then it is terminated.
- **Damp.** Scale out quickly and scale in slowly. A new instance's start-up metrics are kept out of the average for a while: AWS calls this the *instance warm-up*, Google Compute Engine the *initialization period*, and the HPA sets aside CPU samples from Pods that aren't ready yet. Scale-in waits out a **stabilisation window**. By default the HPA acts on the highest recommendation of the last 5 minutes, and Compute Engine keeps enough capacity for the peak of the last 10 minutes. A brief dip therefore doesn't remove capacity that is needed again a minute later; removing and re-adding capacity in a loop is called *flapping*. Rule-based policies often use a fixed *cooldown* instead, a pause after each scaling action: every Azure autoscale rule has its own, while EC2 Auto Scaling uses its 300-second default cooldown mainly for simple scaling policies and relies on instance warm-up for the others.

There are four kinds of policy, and they are often combined:

- **Target tracking:** a metric and a target value, and the autoscaler sizes each step. It is the usual default, and AWS recommends it over step scaling whenever the metric moves in proportion to capacity.
- **Step scaling:** you set alarm thresholds and how many instances to add or remove for each size of breach. It gives more control and needs more tuning. Leave a margin between the scale-out and scale-in thresholds, or it flaps.
- **Scheduled scaling:** change the minimum, maximum or desired capacity at set times (cron), for business hours or a known event such as a product launch.
- **Predictive scaling:** forecast the load from history and add capacity before it arrives. EC2 Auto Scaling needs at least 24 hours of data, analyses up to 14 days, forecasts the next 48 hours hour by hour and refreshes the forecast every 6 hours. It only scales out, so pair it with a dynamic policy. Compute Engine managed instance groups and Azure Virtual Machine Scale Sets offer predictive autoscaling too.

When several policies or metrics are active, the larger answer wins. EC2 Auto Scaling scales out if any target-tracking policy wants to and scales in only if all of them do, Azure autoscale treats its rules the same way, and the HPA takes the highest replica count across its metrics.

## When to use it

- Stateless tiers, or tiers that keep their state elsewhere: web and API servers, and workers that pull from a queue (as the consumers do in [Event-Driven Architecture](../event-driven-architecture/)).
- Load that varies through the day or week, or spikes you can't schedule.
- Instances that can start serving within minutes. If start-up takes longer than a spike takes to build, add headroom, a warm pool or predictive scaling.
- Not as a fix for a bottleneck elsewhere. More web servers in front of a saturated database only move the queue, so scale or protect the bottleneck instead (caching, read replicas, Queue-Based Load Leveling). Not for stateful singletons or for software licensed per instance either.

## Trade-offs

- **It reacts in minutes, not seconds.** Metrics arrive every minute or so (EC2 publishes basic CPU metrics only every 5 minutes unless detailed monitoring is on), the autoscaler evaluates on its own cycle (every 15 seconds for the HPA, every 30 to 60 seconds for Azure autoscale), and booting, warming up and passing health checks take minutes more. The instances you already have must absorb the first minutes of a spike, and the gap between the target and 100% is that headroom. A lower target buys more headroom and costs more.
- **Choose a metric that tracks load per instance.** CPU suits CPU-bound services, requests per instance suits I/O-bound ones, and backlog per worker suits queue consumers. AWS warns that a load balancer's total request count, its latency and a raw queue length don't work for target tracking, because they don't change in proportion to the number of instances.
- **Flapping or waste.** A long scale-in window avoids flapping but keeps idle instances on the bill for longer. A short one saves money but can remove capacity that is needed again a minute later.
- **Min and max are safety limits.** The minimum is your availability floor (at least two instances, spread across zones), and you pay for it all night. The maximum caps the bill and protects downstream dependencies and quotas, including from a bug or an attack that drives the metric up. Alert when the group sits at its maximum, because from then on it can't scale.
- **Scale-in chooses which instances go.** Protect instances that are doing long-running work. EC2 has instance scale-in protection, and in Kubernetes the `controller.kubernetes.io/pod-deletion-cost` annotation (beta) tells a ReplicaSet which Pods to prefer removing. Scale-in protection doesn't stop a failed health check from replacing an instance, or a Spot interruption.
- **Cold starts.** New instances are at their slowest just when you need them: caches are empty, JIT compilers are cold and connection pools are still filling. Make the readiness check wait for warm-up, ramp traffic up gradually (Application Load Balancer *slow start*), or keep pre-initialised capacity ready: EC2 warm pools (stopped instances cost only their volumes and Elastic IP addresses), Lambda provisioned concurrency or Cloud Run minimum instances. For a known event, scale out ahead of time with a scheduled action. The load balancer has to scale too, and Application Load Balancers let you reserve load balancer capacity units for the event.
- **Cost.** You pay for what runs, so scaling in is where the savings come from. EC2 bills most Linux and Windows instances per second, with a one-minute minimum, so short-lived capacity is cheap. Headroom, the minimum, warm pools and long scale-in windows are the price of safety.

## Implementation notes

- **Virtual machines:** Amazon EC2 Auto Scaling groups, Azure Virtual Machine Scale Sets with Azure Monitor autoscale, and Google Compute Engine managed instance groups with the autoscaler. All three offer minimum and maximum limits, metric-based and scheduled scaling, and predictive scaling.
- **Kubernetes:** the HPA (`autoscaling/v2`) scales Pods on CPU, memory, or custom and external metrics. By default it evaluates every 15 seconds, ignores changes within a 10% tolerance (configurable per HPA), scales up with no stabilisation window and scales down with a 300-second one. KEDA adds 70+ event sources (queues, streams, databases, Prometheus, cron) and scales to and from zero, leaving the range from one replica upwards to an HPA it manages. The HPA can now also scale to zero on object or external metrics (beta since Kubernetes 1.37). Pods need somewhere to run, so pair either with a node autoscaler such as Cluster Autoscaler or Karpenter.
- **Serverless:** functions and serverless containers scale per request with no policy to write. The levers are concurrency limits and pre-warmed capacity (see Serverless).
- **Health checks:** readiness should mean *ready to serve*, warmed up and able to reach its dependencies (see Health Endpoint Monitoring).
- **Graceful shutdown:** on SIGTERM, stop taking new work and finish what's in flight. Make the drain timeout longer than your slowest request. The Elastic Load Balancing deregistration delay defaults to 300 seconds, and Kubernetes' `terminationGracePeriodSeconds` to 30.
- **Test and watch it:** load-test the scaling itself and measure the time to capacity. Alert when the group hits its maximum and when scaling fails (quota or capacity limits). Don't count on autoscaling for sudden, large shifts such as a region failing over in [Multi-Region Active-Active](../multi-region-active-active/): scaling out takes minutes and competes for capacity, so keep the headroom in place beforehand.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Load Balancing](../load-balancing/) — Spread requests across healthy instances and stop sending to unhealthy ones.
- [Health Endpoint Monitoring](../health-endpoint-monitoring/) — Expose liveness and readiness checks that load balancers and monitors probe.
- [Queue-Based Load Leveling](../queue-based-load-leveling/) — A queue absorbs traffic spikes so the backend can work at a steady pace.
- [Serverless (Functions)](../serverless/) — Functions start per event, scale out automatically and scale to zero when idle.
- [Deployment Stamps](../deployment-stamps/) — Deploy many independent copies of the whole stack, each serving a subset of tenants.
- [Multi-Region Active-Active](../multi-region-active-active/) — Serve users from several regions at once and shift traffic away from a region that fails.

## Related components and services

- [Kubernetes](../kubernetes/) — A container orchestrator: you declare the desired state, and controllers keep pods scheduled, healthy and reachable.
- [Prometheus & Grafana](../prometheus/) — Pull-based monitoring: scrape metrics into a time-series database, query them with PromQL, alert, and chart them in Grafana.
- [Amazon ECS & Fargate](../amazon-ecs/) — Run containers on AWS: task definitions, services that keep tasks running behind a load balancer, on EC2 or serverless Fargate.
- [Amazon CloudWatch](../amazon-cloudwatch/) — Metrics, logs, alarms and dashboards for AWS resources and your applications, in one monitoring service.

## Related principles and frameworks

- [The Twelve-Factor App](../twelve-factor-app/) — Twelve rules for apps that deploy cleanly anywhere: config in the environment, stateless processes, separate build, release and run.
- [Well-Architected Framework](../well-architected-framework/) — Review a workload against six pillars, from operational excellence to sustainability, and decide on the trade-offs between them.
- [FinOps](../finops/) — Cloud cost as a shared responsibility: allocate spend to the teams that cause it, optimise it and track the cost per unit of value.

## References

- [AWS — Target tracking scaling policies for Amazon EC2 Auto Scaling](https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-scaling-target-tracking.html)
- [AWS — How predictive scaling works (Amazon EC2 Auto Scaling)](https://docs.aws.amazon.com/autoscaling/ec2/userguide/predictive-scaling-policy-overview.html)
- [Kubernetes — Horizontal Pod Autoscaling](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/)
- [KEDA — Scaling Deployments, StatefulSets & Custom Resources](https://keda.sh/docs/latest/concepts/scaling-deployments/)
- [Azure Monitor — Best practices for autoscale](https://learn.microsoft.com/en-us/azure/azure-monitor/autoscale/autoscale-best-practices)
- [Azure Architecture Center — Autoscaling guidance](https://learn.microsoft.com/en-us/azure/architecture/best-practices/auto-scaling)
- [Google Cloud — Autoscaling groups of instances (Compute Engine)](https://docs.cloud.google.com/compute/docs/autoscaler)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
