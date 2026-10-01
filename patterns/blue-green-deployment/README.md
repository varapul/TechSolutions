<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🚀 Deployment & Release](../../README.md#deployment--release)

# Blue-Green Deployment

> Run the new version beside the old one and switch all traffic in one step.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Blue-Green Deployment" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/blue-green-deployment.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Blue is live** | **Blue** runs the current version (v1), and the router sends it 100% of production traffic. **Green** is a second production environment, built to match Blue, that serves nothing at the moment. Both environments use the same database. |
| **2 · Deploy and test Green** | The pipeline deploys **v2** to Green while every user stays on Blue. Smoke tests reach Green through a private test endpoint (a preview service, a test listener or a tagged URL) and must pass before anyone switches. |
| **3 · Switch** | The router points all traffic at Green at once, with a load-balancer target swap, a Kubernetes Service selector change or a DNS record update. Requests already in flight finish on Blue (connection draining), and Blue keeps running, so rolling back is just another switch. |
| **4 · Roll back or retire** | Watch Green's error rate and latency for a while. If they spike, **flip the router straight back** to Blue. If they stay normal, Blue is retired to idle and becomes the target for the next release, so the two environments swap roles with every deployment. |
<!-- END GENERATED: header -->

## The problem

An in-place deployment stops the old version and installs the new one on the same servers. Users see downtime, or a fleet that runs a mix of both versions while the update is under way, and the riskiest moment, when the build first meets real traffic, configuration and data, happens to everyone at once. If it goes wrong, rolling back means deploying the old version again, which takes about as long as a release, while users wait.

## How it works

Keep two production environments that are as identical as possible, called **Blue** and **Green**. At any moment one of them is live and the other is idle.

- **Deploy** the new version to the idle environment and run the final tests there: real production infrastructure, configuration and dependencies, but no users. The tests reach it through a private test endpoint, such as a preview service, a test listener or a tagged URL.
- **Switch** the router so that all incoming requests go to the new environment. The router can be a load balancer's listener or target group, a Kubernetes Service selector, an ingress or service-mesh route, or a DNS record.
- **Keep the old environment running** for a while. If the new version misbehaves, switch back: rolling back is the same one-step operation as the release.
- **Retire** the old environment once the new version has proven itself. It becomes the idle environment, where the next release is deployed.

The colours are only names for the two slots. Each environment cycles through live, standby for rollback, and staging for the next version, and the names stay with the slots, not the versions. Spinnaker, the delivery platform created at Netflix, called the same strategy *red/black* until version 1.30 renamed it blue/green. As Martin Fowler points out, the switch is the same mechanism a hot standby needs, so every release also rehearses part of your disaster-recovery procedure.

## When to use it

- Releases that must not cause downtime and need a rollback measured in seconds, not in another deployment.
- Changes you want to check on the real production stack before any user sees them: smoke tests, warm-up, configuration and connectivity to dependencies.
- Stacks that are cheap to duplicate: stateless services, containers, autoscaling groups, platform deployment slots.
- Services with too little traffic for a canary to collect a signal quickly. Blue-green needs no traffic split, only good tests and a watch window.
- It fits poorly when the two versions cannot share the database (a schema change that can't be made backward compatible), when the environment is expensive or slow to duplicate, and for vendor software that ships its own upgrade procedure.

## Trade-offs

- **Everyone moves at once.** A problem that the smoke tests missed reaches 100% of users until you switch back. Watch the new environment closely right after the switch, and use a [canary release](../canary-release/) when the risk is in runtime behaviour that only real traffic reveals. Shifting blue-green traffic in weighted steps instead of one jump turns it into a canary.
- **Database changes must suit both versions.** Both environments usually share one database, so the schema must work for v1 and v2 at the same time, and a rollback must cope with data that v2 has already written. Change the schema with **expand and contract** ([parallel change](https://martinfowler.com/bliki/ParallelChange.html)): make additive changes that v1 tolerates before the release, ship v2, and remove the old columns only after Blue has been retired. Rolling back the code doesn't roll back the data. Giving each environment its own database instead means syncing data between them in both directions, which is hard to do reliably.
- **Sessions and in-flight requests.** Sessions kept in Blue's memory are lost when their users land on Green, so keep them in a shared store or in signed tokens. New requests go to Green while the ones already in flight finish on Blue, and Blue's instances should drain before they are removed (an AWS Application Load Balancer's deregistration delay waits up to 300 seconds by default). Long-lived connections such as WebSockets stay on Blue until they close, so close them gracefully and let clients reconnect. The router only moves request traffic: queue consumers and scheduled jobs in the idle environment keep running unless you stop them.
- **DNS versus a load balancer.** A DNS switch (weighted records, or Elastic Beanstalk's *Swap environment URLs*, a CNAME swap) is simple and works across regions. Resolvers and clients cache the answer for its TTL, though, and some keep it longer, so traffic trickles to Blue for a while and a rollback is just as slow. A switch at a load balancer, proxy, ingress or Kubernetes Service keeps client DNS caches out of the way and usually applies to new requests within seconds. A rollback is only as fast as the switch.
- **Double the infrastructure.** During the release you pay for two full production environments. Create Green only for the release and tear Blue down after the watch window (with immutable infrastructure that comes naturally), share the data tier, or run a smaller preview for the tests and scale it to full size before the switch. Keep Blue at full size for as long as you want a one-step rollback: once it has been scaled down, rolling back is a deployment again.

**Blue-green, canary or rolling update?**

| | Blue-green deployment | Canary release | Rolling update |
|---|---|---|---|
| How traffic moves | all at once, to a second environment | a growing share, gated by metrics | batch by batch, as old instances are replaced |
| Rollback | switch back while the old environment is running | set the canary weight to 0% | roll the old version out again |
| Extra capacity | a full second environment during the release | the canary instances | a few surge instances (25% by default in Kubernetes) |
| Users exposed to a bad build | everyone, until you switch back | only the canary share | a growing share, batch by batch |
| Best at | a clean cut-over, tested on the real stack, with an instant way back | runtime risk that only real traffic reveals | simple updates with little spare capacity |

## Implementation notes

- **Kubernetes:** run one Deployment per colour and flip a Service's selector from `version: blue` to `version: green`. Argo Rollouts automates the whole cycle: `activeService` carries production traffic, `previewService` gives the new ReplicaSet a test endpoint, `prePromotionAnalysis` gates the switch, `postPromotionAnalysis` switches back automatically when it fails, and `autoPromotionEnabled: false` waits for a manual promote. The old ReplicaSet is scaled down after `scaleDownDelaySeconds` (30 s by default, so every node has updated its routing rules first); raise it to keep a longer rollback window.
- **AWS:** Amazon ECS has built-in blue/green deployments. Test traffic reaches the green revision through a listener rule, production traffic moves all at once, and both revisions keep running for a configurable bake time while CloudWatch alarms can trigger an automatic rollback. AWS now recommends it over CodeDeploy-managed blue/green for ECS. Weighted target groups on an Application Load Balancer, Route 53 weighted records and Elastic Beanstalk's URL swap cover other setups.
- **Azure:** App Service deployment slots. Deploy to a staging slot, let App Service warm it up, swap it into production (optionally *swap with preview* to check it with production settings first), and swap the same two slots again to roll back.
- **Google Cloud:** Cloud Run. `gcloud run deploy SERVICE --image IMAGE --no-traffic --tag green` gives the new revision its own test URL, `gcloud run services update-traffic SERVICE --to-tags green=100` moves traffic to it, and sending traffic back to the previous revision is the rollback.
- **Cloud Foundry:** push Green under a temporary route, map the production route to it, then unmap that route from Blue.
- **Databases have their own variant.** Amazon RDS Blue/Green Deployments keep a synchronised staging copy of a database for engine upgrades and parameter changes, then switch over, typically in under a minute. That upgrades the database itself; it doesn't replace expand and contract for application releases.
- **Automate the switch and the way back.** The smoke tests, the switch, the watch window and the rollback trigger belong in the pipeline, not in a runbook that someone follows by hand.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Canary Release](../canary-release/) — Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back.
- [Feature Flags](../feature-flags/) — Deploy code dark, then turn features on per user or percentage at runtime.
- Rolling Update *(planned)* — Replace instances batch by batch while the service stays up.
- Expand and Contract *(planned)* — Change a schema or API in backward-compatible steps: expand, migrate, then contract.
- Immutable Infrastructure *(planned)* — Never patch servers in place: bake a new image and replace them.
- Shadow Traffic *(planned)* — Mirror live requests to the new version and compare results without affecting users.

## References

- [Martin Fowler — BlueGreenDeployment](https://martinfowler.com/bliki/BlueGreenDeployment.html)
- [AWS whitepaper — Blue/Green Deployments on AWS (2021, archived)](https://docs.aws.amazon.com/whitepapers/latest/blue-green-deployments/welcome.html)
- [Amazon ECS — Blue/green deployments](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-blue-green.html)
- [Argo Rollouts — BlueGreen deployment strategy](https://argo-rollouts.readthedocs.io/en/stable/features/bluegreen/)
- [Cloud Foundry — Using blue-green deployment to reduce downtime](https://docs.cloudfoundry.org/devguide/deploy-apps/blue-green.html)
- [Azure App Service — Set up staging environments (deployment slots)](https://learn.microsoft.com/en-us/azure/app-service/deploy-staging-slots)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
