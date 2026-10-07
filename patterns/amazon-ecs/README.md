<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🟧 AWS Services](../../README.md#aws-services)

# Amazon ECS & Fargate

> Run containers on AWS: task definitions, services that keep tasks running behind a load balancer, on EC2 or serverless Fargate.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Amazon ECS &amp; Fargate" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/amazon-ecs.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Acme Shop's **Catalog** service runs on Amazon ECS in the cluster `acme-shop` (us-east-1). The ECS **service** `catalog` keeps 3 **tasks** of the **task definition** `catalog:7` running on **AWS Fargate**, spread over two Availability Zones in private subnets, and registers each one with the target group of an **Application Load Balancer**, which sends shoppers' requests only to healthy tasks. The image `catalog:1.4.2` comes from Amazon ECR, two IAM roles carry the permissions and the logs go to CloudWatch. There are no servers to manage, and ECS itself costs nothing: you pay for the Fargate capacity, or for EC2 instances if the service runs on those instead. |
| **2 · Task definition to tasks** | `RegisterTaskDefinition` stores revision **7** of the family `catalog`: the image, 0.5 vCPU and 1 GB, port 8080, the `awsvpc` network mode, the `awslogs` log driver and two roles. The service scheduler places 3 tasks and keeps the two zones balanced, and Fargate starts each one in its own isolated environment: while the task is `PROVISIONING` it gets an **elastic network interface** with a private IP from its zone's subnet, and while it is `ACTIVATING` Fargate pulls the image with the **task execution role**, which also lets it send the logs to CloudWatch, and the IP is registered with the target group. A newly registered target needs one passed health check (`GET /health`) to count as healthy; from then on the ALB sends it requests. |
| **3 · Heal, scale, deploy** | The task at 10.0.11.41 fails 2 health checks in a row, so its target turns unhealthy and ECS replaces the task: it starts the replacement first, as `maximumPercent` allows, and stops the old one once the new one is healthy. Then average CPU reaches 85% against the 60% target of a **target tracking** policy, which adds tasks in proportion: 3 × 85 ÷ 60 = 4.25, rounded up to **5**, and the same load averages 51%. Finally `update-service` rolls out `catalog:8` with the defaults (`minimumHealthyPercent` 100, `maximumPercent` 200): ECS starts 5 new tasks, 10 in all, and stops the old ones only after the new ones are healthy, while the ALB **drains** them. The **deployment circuit breaker** would mark the rollout failed after 3 failures in a row and roll back to `catalog:7`; ECS also has built-in blue/green, linear and canary deployments. |
| **4 · Limits and trade-offs** | ECS is AWS's own API: task definitions, services and capacity providers don't move to another cloud the way Kubernetes manifests move between clusters. Fargate trades control for convenience: no `DAEMON` services, no privileged containers, no GPUs, and CPU and memory only in set combinations, up to 32 vCPU and 244 GB per task (October 2026). EC2 capacity providers cover all three, and **ECS Managed Instances** (since September 2025) offer GPUs and privileged capabilities on EC2 instances that AWS runs for you. Fargate bills each second for the vCPU and memory a task asks for, $0.000011244 per vCPU-second and $0.000001235 per GB-second in us-east-1 (Linux/x86), so one `catalog` task costs about $0.0247 an hour; a steady, heavy load can cost less on EC2 instances that are kept full, bought with Savings Plans or run as Spot. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's Catalog service ships as a container image: CI builds `catalog:1.4.2` once and pushes it to Amazon ECR (see [Docker](../docker/)). An image doesn't run itself. In production the service needs several copies spread over two Availability Zones, a load balancer that sends requests only to the copies that work, a replacement when one dies, more copies when the evening traffic arrives, new versions rolled out without downtime, AWS permissions without keys baked into the image, and its logs in one place. On plain EC2 instances you would script all of that yourself and patch the hosts as well. [Kubernetes](../kubernetes/) does the job, but it is a platform to run and learn in its own right. Amazon ECS is AWS's own container orchestrator, and AWS Fargate runs its containers without servers for you to look after.

## How it works

### The pieces

| Concept | What it is | Acme Shop |
|---|---|---|
| **Cluster** | A logical group of services and tasks, together with the capacity they run on. | `acme-shop` in us-east-1 |
| **Task definition** | A JSON document that describes one or more containers: image, CPU and memory, ports, network mode, logging, environment and secrets, and two IAM roles. Each `RegisterTaskDefinition` call adds a new, immutable revision to a family. | `catalog:7`, later `catalog:8` |
| **Task** | A running copy of a task definition: its containers, started together on one host or in one Fargate environment. | 3, and up to 10 |
| **Service** | Keeps a desired number of tasks running, replaces tasks that stop or fail their health checks, registers them with load balancer target groups and rolls out new revisions. | `catalog`, desired count 3 |
| **Capacity provider** | Where tasks get their compute: `FARGATE`, `FARGATE_SPOT`, an EC2 Auto Scaling group, or ECS Managed Instances. A capacity provider strategy spreads tasks across providers with a `base` and a `weight` for each. | `FARGATE` |
| **Launch type** | The older, simpler way to pick compute for a task or service: `FARGATE`, `EC2`, or `EXTERNAL` for your own servers registered through ECS Anywhere. Managed Instances need a capacity provider strategy. | not used |

### Fargate, Fargate Spot, EC2 and Managed Instances

- **Fargate.** You pick the task's CPU and memory from a fixed table, from 0.25 vCPU with 0.5 to 2 GB up to 32 vCPU with 60, 120 or 244 GB (Linux, October 2026; the sizes from 8 vCPU up need platform version 1.4.0, which `LATEST` resolves to). Each task runs inside its own isolation boundary and shares no kernel, CPU, memory or network interface with other tasks. AWS runs and patches the hosts, and each task gets 20 GB of ephemeral storage, which can be raised to 200 GB. In return there is no host to reach, no `DAEMON` services, no privileged containers, no GPUs, and `awsvpc` is the only network mode.
- **Fargate Spot** runs tasks that can tolerate interruption on spare capacity, at up to 70% below the Fargate price. When AWS needs the capacity back, the task gets a two-minute warning, as an [EventBridge](../amazon-eventbridge/) task state change event and a `SIGTERM`. Fargate doesn't fall back to on-demand capacity by itself, so a strategy usually keeps a `base` of tasks on `FARGATE` and puts the extra ones on `FARGATE_SPOT`.
- **EC2 instances.** An Auto Scaling group of container instances, usually running the ECS-optimized AMI with the ECS agent, attached to the cluster as a capacity provider. With **managed scaling**, ECS publishes the `CapacityProviderReservation` metric and grows or shrinks the group to keep it at `targetCapacity` (100% by default), so instances follow the tasks. You get any instance type, GPUs included, `DAEMON` services, privileged containers and the `bridge` and `host` network modes, and you own the AMI, its patching and the instance replacement.
- **ECS Managed Instances** (since 30 September 2025) sit in between. ECS launches and runs EC2 instances in your account: the cheapest general-purpose types that fit by default, or the types and attributes you ask for (GPUs, CPU make, memory). Several tasks share an instance, and AWS patches the instances and replaces them regularly. Task definitions add `MANAGED_INSTANCES` to `requiresCompatibilities`, and Fargate task definitions for platform version 1.4.0 are compatible. You pay for the instances plus a management fee per instance.

### Networking

- **`awsvpc`** gives every task its own elastic network interface (ENI) with a private IP address from a subnet you choose, so security groups apply to each task. Acme Shop's tasks sit in the private app subnets `10.0.10.0/24` and `10.0.11.0/24`, and their security group `app-sg` admits port 8080 only from the load balancer's `alb-sg` (see [Amazon VPC](../amazon-vpc/)). It is the only mode on Fargate. On EC2 instances each task's ENI uses up one of the instance's network interfaces, which ENI trunking (the `awsvpcTrunking` account setting) works around.
- **`bridge`**, the default for Linux tasks on EC2 instances, uses Docker's virtual network on the host. **`host`** uses the instance's own network stack, so two tasks on one instance can't use the same port. **`none`** has no external networking.
- **Service to service.** With **Service Connect**, ECS adds a Service Connect proxy to every task of the services in an AWS Cloud Map namespace; clients call a short name such as `http://catalog:8080`, the proxy picks a healthy task with round robin and outlier detection, and every service reports the same traffic metrics. It needs no [Route 53](../amazon-route-53/) hosted zones. The older **service discovery** registers each task in Cloud Map and Route 53 private DNS, and clients resolve the name themselves. Services can also join VPC Lattice.

### Load balancing and health checks

A service registers each task with its target groups while the task is `ACTIVATING` and deregisters it while the task is `DEACTIVATING`. Tasks in `awsvpc` mode are registered by IP address, so their target group must have the target type `ip`. For `ip` targets an ALB checks each target every 30 seconds by default, waits 5 seconds for an answer, marks a target unhealthy after 2 failures in a row and healthy again after 5 successes; a newly registered target needs only one passed check. When a target turns unhealthy, ECS replaces the task: if `maximumPercent` leaves room it starts the replacement first and stops the old task once the new one is healthy, otherwise it stops one unhealthy task first. `healthCheckGracePeriodSeconds` (default 0) tells ECS to ignore failing checks for a while after a task starts, which slow starters need. Container health checks in the task definition work with or without a load balancer.

Stopping a task takes time too. The load balancer keeps a deregistered target in `draining` for the **deregistration delay** (300 seconds by default) so that requests in flight can finish; then ECS sends the container its stop signal (`SIGTERM` unless the image sets another one) and, after the stop timeout (30 seconds by default, at most 120 seconds on Fargate), `SIGKILL`.

### Two IAM roles

- The **task role** (`taskRoleArn`, here `catalog-task`) holds the permissions of the application code. The AWS SDKs in the containers pick up its temporary credentials automatically, so no keys go into the image or the environment.
- The **task execution role** (`executionRoleArn`, here `catalog-execution`) is what the ECS container agent or Fargate uses to pull the image from a private ECR repository, send `awslogs` logs to [CloudWatch](../amazon-cloudwatch/), and read the Secrets Manager secrets and Parameter Store parameters the task definition refers to. The AWS managed policy `AmazonECSTaskExecutionRolePolicy` covers the image pull and the logs.
- Both roles trust the service principal `ecs-tasks.amazonaws.com` (see [AWS IAM](../aws-iam/)). On Fargate each task is isolated from the others. On EC2 instances, Managed Instances and ECS Anywhere it is not: a container can potentially reach the credentials of other tasks on the same instance, the instance role and the instance metadata service, so AWS recommends blocking containers from the metadata service there.

### Secrets and configuration

The `secrets` section of a container definition maps an environment variable to the ARN of a Secrets Manager secret or a Systems Manager Parameter Store parameter (`valueFrom`), and ECS injects the value when the container starts. A rotated secret doesn't reach running containers: start new tasks, for example with `update-service --force-new-deployment`. Plain settings go in `environment` or in environment files on [S3](../amazon-s3/); for the general idea see [external configuration store](../external-configuration-store/).

### Logs

The **`awslogs`** log driver sends each container's stdout and stderr to CloudWatch Logs, here to the group `/ecs/catalog`, in one stream per container named `prefix/container/task-id`; on Fargate `awslogs-stream-prefix` is required. Since 25 June 2025 the default delivery mode is `non-blocking`: logs wait in a buffer (`max-buffer-size`, 10m by default), and when the buffer is full new lines are dropped instead of stalling the application. Set `mode` to `blocking` where losing log lines is worse than a stalled container. **FireLens** runs Fluent Bit or Fluentd as a sidecar in the task (AWS publishes an AWS for Fluent Bit image) and routes the logs elsewhere: S3, [OpenSearch](../elasticsearch/), [Kinesis](../amazon-kinesis-data-streams/) or a partner's service (see [centralized logging](../centralized-logging/)).

### Scaling

- **Service auto scaling** changes the desired count through Application Auto Scaling. **Target tracking** keeps a metric near a target; the predefined metrics are `ECSServiceAverageCPUUtilization`, `ECSServiceAverageMemoryUtilization` and `ALBRequestCountPerTarget`, and high-resolution variants of the CPU and memory metrics use 20-second data. Step scaling, scheduled actions and predictive scaling are the other options.
- The service's CPU utilization is the CPU its tasks use divided by the CPU their task definition reserves for all of them. Target tracking scales out in proportion to the metric and rounds up, so 3 tasks at 85% against 60% need 3 × 85 ÷ 60 = 4.25 tasks' worth of CPU: 5 tasks, at about 51% each. It scales in more slowly, and only when removing a task wouldn't push the metric back over the target. The default cooldowns for ECS services are 300 seconds, and scale-in is suspended while a deployment is in progress.
- On EC2 capacity, managed scaling (above) then adds the instances the new tasks need. On Fargate there are no instances to add, only quotas: the default listed for Fargate On-Demand vCPUs is 6 per Region, adjustable, and during the rollout in step 3 Catalog uses 10 tasks × 0.5 vCPU = 5.

### Deployments

- **Rolling update** (`ROLLING`, the default strategy of the `ECS` deployment controller). `minimumHealthyPercent` (default 100, rounded up) is how many tasks must stay healthy, and `maximumPercent` (default 200, rounded down) how many may run, both as a percentage of the desired count. For Catalog at 5 tasks that means never fewer than 5 healthy tasks and never more than 10 in all, so ECS starts all 5 new tasks at once and stops the old ones only as the new ones become healthy. 75% and 125% would replace them one or two at a time, with less spare capacity.
- The **deployment circuit breaker** (`deploymentCircuitBreaker` with `enable` and `rollback`) counts tasks that fail to reach `RUNNING` or fail their load balancer, Cloud Map or container health checks. Past a threshold it marks the deployment `FAILED` and, with `rollback`, redeploys the last deployment that `COMPLETED`. By default the threshold is half the desired count, kept between 3 and 200 (`BOUNDED_PERCENT` 50), so 3 for Catalog, and only failures in a row count (`resetOnHealthyTask`); `UNBOUNDED_PERCENT` and a fixed `COUNT` are the alternatives. **CloudWatch alarms** on application metrics can fail and roll back a deployment as well.
- When a deployment starts, ECS resolves the image tag to a digest, so all tasks of one deployment run the same image even if someone moves the tag.
- **Blue/green** has been built into ECS since July 2025. The new revision's tasks start behind a second, green target group; listener rules can send test traffic to them; production traffic moves over in one step; and the blue tasks keep running for a bake time, so a rollback is a quick switch back. Lifecycle hooks run a [Lambda](../aws-lambda/) function, or pause the deployment, at stages such as after the test traffic shift. **Linear** and **canary** deployments (October 2025) shift traffic in equal steps of 3 to 100% with a wait after each step, or a canary percentage first. All three work with an ALB, an NLB, Service Connect or VPC Lattice. The older `CODE_DEPLOY` deployment controller, which runs blue/green through AWS CodeDeploy, and the `EXTERNAL` controller are still available.
- **Availability Zone rebalancing.** Since 5 September 2025 ECS turns it on for every eligible service: when a service's tasks become unevenly spread, for example after a zone recovers from an outage, ECS starts tasks in the zones with the fewest and stops tasks in the zones with the most.

### ECS Exec

`aws ecs execute-command` opens a shell in, or runs a command in, a running container through AWS Systems Manager Session Manager, with no SSH and no open inbound port. Turn it on with `--enable-execute-command` (it applies to tasks started afterwards); the task role needs the `ssmmessages` permissions, and tasks in private subnets need a route to Systems Manager, through a NAT gateway or VPC endpoints.

### Pricing

ECS charges nothing for orchestration on Fargate or EC2; you pay for the capacity, and ECS Managed Instances add a management fee per instance to the EC2 price. Fargate charges per second, with a one-minute minimum (five minutes for Windows), from the moment the image pull starts until the task stops, for the vCPU and memory the task asks for. In us-east-1 in October 2026, Linux/x86 costs $0.000011244 per vCPU-second (about $0.0405 an hour) and $0.000001235 per GB-second (about $0.0044 an hour); Linux/Arm (Graviton) costs $0.0000089944 and $0.0000009889, 20% less; ephemeral storage above the free 20 GB costs $0.0000000308 per GB-second. One `catalog` task (0.5 vCPU, 1 GB) costs 0.5 × $0.000011244 + $0.000001235 = $0.000006857 a second, about $0.0247 an hour or $18 a month, so 3 tasks around the clock cost about $54 a month before the load balancer, logs and data transfer. Compute Savings Plans apply to Fargate as well.

## Where it fits

- **Solutions.** Web applications and APIs behind an Application Load Balancer; the services of a [microservices](../microservices/) system, which find each other through Service Connect; queue workers that scale on the depth of an [Amazon SQS](../amazon-sqs/) queue, as in [web-queue-worker](../web-queue-worker/) and [competing consumers](../competing-consumers/); and batch or scheduled jobs that run a task to completion (`RunTask`, or EventBridge Scheduler on a cron or rate schedule).
- **Patterns in this catalog.** ECS's deployment options implement [rolling updates](../rolling-update/), [blue-green deployment](../blue-green-deployment/) and [canary releases](../canary-release/), and service auto scaling implements [autoscaling](../autoscaling/). With an ALB in front, the service gets [load balancing](../load-balancing/) across healthy tasks only, and ECS replaces tasks that fail their health checks ([health endpoint monitoring](../health-endpoint-monitoring/)). A task with several containers is how ECS runs a [sidecar](../sidecar/): the FireLens log router and the Service Connect proxy are both sidecars, and Service Connect gives ECS services part of what a [service mesh](../service-mesh/) offers. Immutable task definition revisions, pinned to image digests, follow [immutable infrastructure](../immutable-infrastructure/).
- **Usual neighbours.** Amazon ECR for the images ([Docker](../docker/)), Elastic Load Balancing, [Amazon VPC](../amazon-vpc/) subnets and security groups, [AWS IAM](../aws-iam/) roles, CloudWatch Logs and metrics, Secrets Manager and Parameter Store, AWS Cloud Map, [Amazon RDS](../amazon-rds-aurora/) or [DynamoDB](../amazon-dynamodb/) behind the services, and [Amazon SQS](../amazon-sqs/) for work that can wait.
- **Managed offerings.** ECS is itself the managed service, with Fargate as its serverless compute; Fargate also runs pods for Amazon EKS. The nearest equivalents elsewhere are Google Cloud Run and Azure Container Apps.

## When to use it

Use ECS when the workloads run on AWS, are packaged as containers, and you want an orchestrator with nothing to install or upgrade: web services, APIs and workers that run for hours or days, need more than Lambda's limits, or already exist as images. Start on Fargate unless you need what it leaves out, and move services that stay busy all day to EC2 capacity or Managed Instances when the bill says so. Choose Kubernetes on EKS when you want one API across clouds and data centres, its ecosystem of operators, Helm charts and controllers, or a team that already runs it; choose Lambda for short, event-driven work that should cost nothing when idle.

| | ECS on Fargate | ECS on EC2 | Amazon EKS | AWS Lambda |
|---|---|---|---|---|
| You manage | task definitions and services | the same, plus the instances: AMI, patching, the Auto Scaling group | Kubernetes objects and cluster upgrades; the nodes too, unless EKS Auto Mode or Fargate runs them | functions |
| You deploy | a task: one or more containers | a task | a pod, from manifests or Helm charts | a function, as a .zip archive or a container image |
| Largest unit | 32 vCPU and 244 GB per task | the instance type, GPUs included | the node size | 10,240 MB with CPU in proportion, 15 minutes per invocation |
| Left out | `DAEMON` services, privileged containers, GPUs | nothing in particular | on EKS Fargate: DaemonSets and GPUs | work that runs longer than 15 minutes |
| Scaling | service auto scaling: target tracking, step, scheduled, predictive | the same, plus managed scaling of the instances | HorizontalPodAutoscaler, plus Cluster Autoscaler, Karpenter or Auto Mode for nodes | per request, down to zero |
| Price (us-east-1) | per vCPU-second and GB-second requested; no ECS fee | the instances (On-Demand, Savings Plans, Spot); no ECS fee | $0.10 per cluster-hour in standard support, plus nodes or Fargate | per request plus GB-seconds |
| Runs elsewhere | no: ECS API only | ECS Anywhere adds your own servers, still run from AWS | any conformant Kubernetes cluster | no: Lambda API only |

Figures from the Amazon ECS, AWS Fargate, Amazon EKS and AWS Lambda documentation and pricing pages, October 2026.

## Trade-offs

- **AWS only.** Task definitions, services, capacity providers and the deployment settings are ECS API objects. The images move anywhere; moving the services to another cloud, or to Kubernetes, means rewriting their definitions and the infrastructure code around them.
- **Fargate trades control for convenience.** No host access, no `DAEMON` services, no privileged containers or extra Linux capabilities beyond `CAP_SYS_PTRACE`, no GPUs, and CPU and memory only in the combinations of the table. EC2 capacity providers lift all of these at the cost of running instances; Managed Instances lift the GPU and instance-type limits and add privileged capabilities while AWS runs the instances.
- **Fargate's price is per task, EC2's per instance.** At On-Demand prices in us-east-1, 2 vCPU and 4 GB on Fargate (x86) cost about $0.0987 an hour and a c7i.large with 2 vCPU and 4 GiB costs $0.08925; 4 vCPU and 8 GB on Fargate (Arm) cost about $0.158, a c7g.xlarge $0.145. EC2 is about 10% cheaper only while its instances stay full, and an instance that is half empty costs more per task than Fargate. A steady, heavy load that packs instances well, especially with Savings Plans or Spot, comes out cheaper on EC2; spiky or small services usually don't.
- **The defaults make deployments slow.** A 300-second deregistration delay and health checks every 30 seconds add minutes to every rollout. Shorten the delay for short requests and tune the checks for the service.
- **Quotas.** Besides the Fargate vCPU quota, a service holds at most 5,000 tasks (1,000 with service discovery), a cluster 5,000 services and a task definition 10 containers (October 2026).
- **Logs can be dropped.** The non-blocking default protects the service from a slow log destination by discarding lines when the buffer fills.

## Implementation notes

**The task definition.** An abridged `catalog-7.json` for `aws ecs register-task-definition --cli-input-json file://catalog-7.json`; the account ID and the secret's suffix are examples:

```json
{
  "family": "catalog",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "512",
  "memory": "1024",
  "runtimePlatform": { "operatingSystemFamily": "LINUX", "cpuArchitecture": "X86_64" },
  "taskRoleArn": "arn:aws:iam::111122223333:role/catalog-task",
  "executionRoleArn": "arn:aws:iam::111122223333:role/catalog-execution",
  "containerDefinitions": [
    {
      "name": "catalog",
      "image": "111122223333.dkr.ecr.us-east-1.amazonaws.com/catalog:1.4.2",
      "essential": true,
      "portMappings": [{ "containerPort": 8080, "protocol": "tcp" }],
      "secrets": [
        { "name": "DB_PASSWORD", "valueFrom": "arn:aws:secretsmanager:us-east-1:111122223333:secret:catalog/db-password-AbCdEf" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/catalog",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "catalog"
        }
      }
    }
  ]
}
```

**The cluster, the service and its scaling policy.** The subnet, security group and target group IDs are examples:

```sh
aws ecs create-cluster --cluster-name acme-shop --capacity-providers FARGATE FARGATE_SPOT

aws ecs create-service --cluster acme-shop --service-name catalog \
  --task-definition catalog:7 --desired-count 3 \
  --capacity-provider-strategy capacityProvider=FARGATE,weight=1 \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-0aaa1111,subnet-0bbb2222],securityGroups=[sg-0ccc3333],assignPublicIp=DISABLED}" \
  --load-balancers targetGroupArn=arn:aws:elasticloadbalancing:us-east-1:111122223333:targetgroup/catalog-tg/0123456789abcdef,containerName=catalog,containerPort=8080 \
  --health-check-grace-period-seconds 30 \
  --deployment-configuration "minimumHealthyPercent=100,maximumPercent=200,deploymentCircuitBreaker={enable=true,rollback=true}"

aws application-autoscaling register-scalable-target --service-namespace ecs \
  --scalable-dimension ecs:service:DesiredCount --resource-id service/acme-shop/catalog \
  --min-capacity 3 --max-capacity 10

aws application-autoscaling put-scaling-policy --service-namespace ecs \
  --scalable-dimension ecs:service:DesiredCount --resource-id service/acme-shop/catalog \
  --policy-name catalog-cpu-60 --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration \
  '{"TargetValue": 60.0, "PredefinedMetricSpecification": {"PredefinedMetricType": "ECSServiceAverageCPUUtilization"}}'
```

**Deploy and debug.** Register `catalog-8.json` (the same file with the image `catalog:1.5.0`), point the service at the new revision and wait until it is stable; ECS Exec opens a shell in one task:

```sh
aws ecs register-task-definition --cli-input-json file://catalog-8.json
aws ecs update-service --cluster acme-shop --service catalog --task-definition catalog:8
aws ecs wait services-stable --cluster acme-shop --services catalog

aws ecs update-service --cluster acme-shop --service catalog --enable-execute-command --force-new-deployment
aws ecs execute-command --cluster acme-shop --task <task-id> --container catalog --interactive --command "/bin/sh"
```

- **Private subnets need a way to AWS.** Tasks without public IPs reach ECR, CloudWatch Logs, Secrets Manager and Systems Manager through a NAT gateway or through VPC endpoints. On Fargate platform version 1.4.0 that means the interface endpoints `ecr.api` and `ecr.dkr` plus the S3 gateway endpoint, because ECR serves the image layers from S3, and an endpoint for CloudWatch Logs.
- **Shut down gracefully.** Handle `SIGTERM`: stop accepting work, finish what is in flight and exit before the stop timeout. Set the target group's deregistration delay to a little more than the slowest request.
- **Give slow starters a grace period.** A JVM or a cache warm-up can take longer than two failed health checks allow; `healthCheckGracePeriodSeconds` keeps ECS from killing tasks that are still starting.
- **One role per service.** Give every service its own task role with only the calls it makes, and keep the execution role to image pulls, logs and the secrets that task needs.
- **Arm is cheaper.** Set `cpuArchitecture` to `ARM64` and build a multi-architecture image (see [Docker](../docker/)) to pay 20% less on Fargate.
- **Watch the right signals.** Alarm on the service's `CPUUtilization` and `MemoryUtilization`, the target group's `UnHealthyHostCount` and `HTTPCode_Target_5XX_Count`, and the EventBridge event for failed deployments (`SERVICE_DEPLOYMENT_FAILED`). CloudWatch Container Insights adds metrics per task.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Docker & Containers](../docker/) — Package an app and its dependencies as an image and run it as an isolated process: layers, registries, namespaces, cgroups.
- [Kubernetes](../kubernetes/) — A container orchestrator: you declare the desired state, and controllers keep pods scheduled, healthy and reachable.
- [AWS Lambda](../aws-lambda/) — Functions as a service: code runs per event in managed execution environments that scale out with concurrency.
- [Rolling Update](../rolling-update/) — Replace instances batch by batch while the service stays up.
- [Blue-Green Deployment](../blue-green-deployment/) — Run the new version beside the old one and switch all traffic in one step.
- [Autoscaling](../autoscaling/) — Add and remove instances automatically as load rises and falls.
- [Amazon VPC](../amazon-vpc/) — Your private network in AWS: subnets in each Availability Zone, route tables, gateways, security groups and endpoints.
- [Load Balancing](../load-balancing/) — Spread requests across healthy instances and stop sending to unhealthy ones.

## References

- [Amazon ECS Developer Guide — What is Amazon Elastic Container Service?](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html)
- [Amazon ECS — Architect your solution for Amazon ECS (launch types and capacity providers)](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-configuration.html)
- [Amazon ECS — Amazon ECS task definition parameters for Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html)
- [Amazon ECS — Amazon ECS task definition differences for Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html)
- [Amazon ECS — Architect for AWS Fargate for Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html)
- [Amazon ECS — Amazon ECS task lifecycle](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-lifecycle-explanation.html)
- [Amazon ECS — Amazon ECS services](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_services.html)
- [Amazon ECS — Amazon ECS service deployment controllers and strategies](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_service-options.html)
- [Amazon ECS — Amazon ECS service definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service_definition_parameters.html)
- [Amazon ECS — Deploy Amazon ECS services by replacing tasks (rolling update)](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-ecs.html)
- [Amazon ECS — How the Amazon ECS deployment circuit breaker detects failures](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html)
- [Amazon ECS — Amazon ECS blue/green deployments](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-blue-green.html)
- [Amazon ECS — Amazon ECS linear deployments](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-linear.html)
- [Amazon ECS — Amazon ECS canary deployments](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/canary-deployment.html)
- [Amazon ECS — Allocate a network interface for an Amazon ECS task (awsvpc)](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-networking-awsvpc.html)
- [Amazon ECS — Amazon ECS task networking options for EC2](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-networking.html)
- [Amazon ECS — Use Service Connect to connect Amazon ECS services with short names](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-connect.html)
- [Amazon ECS — Use an Application Load Balancer for Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html)
- [Amazon ECS — Optimize load balancer health check parameters for Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/load-balancer-healthcheck.html)
- [Amazon ECS — Optimize load balancer connection draining parameters for Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/load-balancer-connection-draining.html)
- [Elastic Load Balancing — Health checks for Application Load Balancer target groups](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html)
- [Amazon ECS — Amazon ECS task IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html)
- [Amazon ECS — Amazon ECS task execution IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html)
- [Amazon ECS — Pass sensitive data to an Amazon ECS container](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data.html)
- [Amazon ECS — Send Amazon ECS logs to CloudWatch](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_awslogs.html)
- [Amazon ECS — Send Amazon ECS logs to an AWS service or AWS Partner (FireLens)](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_firelens.html)
- [Amazon ECS — Automatically scale your Amazon ECS service](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html)
- [Amazon ECS — Use a target metric to scale Amazon ECS services](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-autoscaling-targettracking.html)
- [Application Auto Scaling — How target tracking scaling for Application Auto Scaling works](https://docs.aws.amazon.com/autoscaling/application/userguide/target-tracking-scaling-policy-overview.html)
- [Amazon ECS — Amazon ECS service utilization metrics](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service_utilization.html)
- [Amazon ECS — Amazon ECS clusters for Fargate (Fargate and Fargate Spot capacity providers)](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-capacity-providers.html)
- [Amazon ECS — Amazon ECS capacity providers for EC2 workloads](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/asg-capacity-providers.html)
- [Amazon ECS — Architect for Amazon ECS Managed Instances](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ManagedInstances.html)
- [Amazon ECS — Balancing an Amazon ECS service across Availability Zones](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-rebalancing.html)
- [Amazon ECS — Monitor Amazon ECS containers with ECS Exec](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-exec.html)
- [Amazon ECS — Document history](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/document_history.html)
- [Amazon ECR — Amazon ECR interface VPC endpoints (AWS PrivateLink)](https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html)
- [AWS General Reference — Amazon ECS endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/ecs-service.html)
- [AWS Fargate Pricing](https://aws.amazon.com/fargate/pricing/)
- [Amazon ECS Pricing](https://aws.amazon.com/ecs/pricing/)
- [Amazon EC2 On-Demand Instance Pricing](https://aws.amazon.com/ec2/pricing/on-demand/)
- [Amazon EKS Pricing](https://aws.amazon.com/eks/pricing/)
- [Amazon EKS User Guide — Simplify compute management with AWS Fargate](https://docs.aws.amazon.com/eks/latest/userguide/fargate.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
