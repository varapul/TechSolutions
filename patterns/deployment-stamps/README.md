<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [☁️ Cloud Infrastructure](../../README.md#cloud-infrastructure)

# Deployment Stamps

> Deploy many independent copies of the whole stack, each serving a subset of tenants.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Deployment Stamps" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/deployment-stamps.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One deployment hits limits** | A SaaS HR application runs as **one deployment** in a US region and serves all 88 of its tenants. It is close to ceilings that can't simply be raised: the database is already on its largest tier and the region's vCPU quota is nearly used up. One large tenant's month-end payroll run slows everybody down, and Northwind, a new customer in the EU, can't be served at all: its data has to stay in the EU, and there is no EU deployment. |
| **2 · Many copies, one template** | The whole stack (app instances, cache, database and storage) is defined once as code and deployed several times as **stamps**: stamps 1 and 2 in the US, stamp 3 in the EU. Each stamp is complete and independent, keeps its own tenants' data and is sized for at most 50 tenants. A global **tenant catalog** records which stamp holds each tenant, and the router uses it to send every request to that stamp, here by host name (`contoso.hr.example`). |
| **3 · Placing tenants** | When Proseware, a new EU tenant, signs up, onboarding picks an EU stamp with room (stamp 3) and adds a catalog entry. As the US stamps reach 50 tenants, automation deploys **stamp 4** from the same template, and the next US tenant, Woodgrove, is placed there. A very large tenant can be given a stamp of its own in the same way. |
| **4 · Operating many stamps** | Release v8 rolls out in **rings**: an internal stamp first, then stamp 1, then the rest, with a pause to watch each ring, so for a while the stamps run different versions and the catalog records which. Moving a tenant means copying its data to the new stamp, switching its catalog entry and draining the old stamp; here the large tenant Fabrikam moves from the full stamp 2 to stamp 4. The router, the catalog, sign-in and billing live outside the stamps, so they must be at least as available as any stamp. |
<!-- END GENERATED: header -->

## The problem

Most SaaS products start as one deployment: one set of app servers, one database, one storage account and one cache in one region, shared by every tenant. That works until one of these happens:

- **A limit that can't simply be raised.** Scaling up stops at the largest database tier the provider sells. Scaling out runs into quotas, such as an Azure subscription's vCPU quota in a region or AWS service quotas (many of which apply per account and Region), and into service limits on connections, host names or sockets. Some components get slow or disproportionately expensive well before any hard ceiling.
- **Tenants that get in each other's way.** One large tenant's batch job (in the diagram, a month-end payroll run) uses up the shared database and every other tenant slows down: the *noisy neighbour* problem. Some large or regulated customers also want infrastructure that nobody else uses.
- **Data that has to live in a particular place.** An EU customer may require its data to stay in the EU, and another needs low latency in Australia. A deployment in one US region can serve neither.

On top of that, every release, configuration change and bad migration reaches all tenants at the same moment.

## How it works

Define the whole stack once, as code, and deploy it many times. Microsoft calls each copy a **stamp**; other names are *scale unit*, *service unit* and *cell*. A stamp is complete, with its own app instances, database, storage, cache and queues, and it shares no data or infrastructure with any other stamp. Each stamp serves a set of tenants and holds their data, so stamps shard the data by tenant without a separate sharding layer. A region can hold one stamp or several.

A small global layer sits around the stamps:

- A **tenant catalog** (Microsoft also calls it a tenant list database) records which stamp holds each tenant, in which region, and whatever else operations need, such as the version that stamp runs.
- A **router** sends each request to its tenant's stamp. It works out the tenant from the host name (`contoso.hr.example`), a claim in the token, an API key or a header, looks it up in the catalog and forwards the request.
- A **control plane** onboards tenants (picks a stamp, creates the tenant's resources there, writes the catalog entry), deploys new stamps when capacity runs low, rolls out releases and moves tenants.
- Services that by nature span every tenant, such as **sign-in** (the identity provider) and **billing**, often stay global as well.

Growth means adding stamps rather than growing one deployment. When the stamps in a region are close to full, the control plane deploys another from the same template and sends the next tenants there. Because stamps don't know about each other, capacity grows almost linearly with their number.

### What goes in a stamp, and what stays global

Put everything a tenant's requests need into the stamp: compute, data stores, caches, queues, background workers and the stamp's own monitoring. The more complete the stamp, the better it isolates its tenants from everyone else's. Features that need every tenant's data (reports across all tenants, global search, the support tool that finds a tenant's stamp) work better if each stamp publishes what they need into a central store such as a data warehouse, instead of querying every stamp.

Keep the global layer small, because it is shared again: an outage of the router or the catalog reaches every tenant, however many stamps there are.

- **Make the global parts at least as available as any stamp.** Run the router in several regions, ideally every region that hosts stamps, behind a global entry point with health probes, and replicate the catalog to each of them. Microsoft's reference example does exactly this.
- **Cache the catalog.** A tenant's stamp rarely changes, so routers can keep the mapping in memory, or compute it once per session and keep it in a cookie, and carry on routing from that copy when the catalog's store is unavailable.
- **Let the stamps run without the control plane.** An outage of the control plane should stop onboarding, moves and deployments, not traffic. Microsoft's guidance on control planes lists what such an outage blocks: onboarding new tenants, managing existing ones, metering and billing, and reacting to a security incident.
- **Serve shared static content once.** A single-page front end that is the same for every tenant can come from one origin through a CDN instead of from every stamp.

### Sizing a stamp

A stamp has a fixed, tested capacity. Express it in a unit you can place tenants against: a maximum number of tenants (50 in the diagram) or, when tenants differ a lot in size, a load budget such as requests per second, users or storage. Load-test a full stamp until it degrades and set the placement limit with headroom below that point, so that existing tenants can grow and tenants can be moved in during an incident. Measure each stamp's used and free capacity continuously, and deploy the next stamp before the last one fills up, because creating a stamp takes time.

The size is a compromise. Large enough to hold your biggest shared tenant and to spread each stamp's fixed overhead over enough tenants; small enough to stay well inside every quota, to be load-tested at full size, and to limit how many tenants one incident or one bad release can reach.

### Placing tenants

Onboarding decides where each new tenant goes, from the tenant's requirements and each stamp's free capacity:

- **Region.** A tenant whose data must stay in the EU can only go to an EU stamp, and tenants generally go to a stamp near their users.
- **Size and tier.** Small tenants share stamps, filling one before starting the next, which Microsoft calls *bin packing*. A very large tenant, or one that pays for isolation, gets a **dedicated stamp** deployed from the same template.
- **Update cadence.** Tenants who want new features early can share stamps that receive releases first, and cautious ones can sit on stamps that update later.
- **Usage pattern.** Tenants whose peaks coincide are better spread over different stamps. A tenant that comes to dominate its stamp is a candidate to move, which is one of the remedies Microsoft's *Noisy Neighbor* antipattern lists, along with throttling heavy tenants ([Rate Limiting](../rate-limiting/)) and adding stamps.

### Routing requests to stamps

The router turns something in the request into a tenant, and the tenant into a stamp. Some ways to build it with today's services:

- **DNS records per tenant or per stamp.** Each tenant gets its own host name whose record points at its stamp, held in a DNS service such as Amazon Route 53 or Azure DNS. AWS's whitepaper on cell-based architecture describes this setup with Route 53. Microsoft's stamp pattern shows the per-stamp variant (`unit1.eu.myapi.contoso.com`), where clients are responsible for calling the right stamp. Moving a tenant changes its record, which clients only notice once their cached answer expires (the record's TTL).
- **A global front door.** Azure Front Door matches each request to a route by protocol, domain and path and sends it to that route's origin group, and rule sets can override the origin group. With one origin group per stamp, a route per tenant domain works for a modest number of tenants, but a profile allows 100 custom domains on the Standard tier and 500 on Premium today. With many tenants, a wildcard domain (`*.hr.example`) and a lookup behind Front Door scale better.
- **A gateway that looks up the catalog.** A reverse proxy or [API gateway](../api-gateway/) in each region reads the tenant, looks up its stamp and forwards the request, or answers with a redirect (HTTP 302) to the stamp's own address. In Microsoft's reference example, Azure API Management in each region sets the back-end URL from a tenant-to-stamp lookup in Azure Cosmos DB, which is replicated to every region, and Azure Front Door sends each client to the nearest healthy gateway.
- **An anycast entry point.** AWS Global Accelerator gives an application static anycast IP addresses, and a standard accelerator sends each client to endpoints in the nearest healthy Region. It knows nothing about tenants, so it fronts regional routers (or a single stamp) rather than doing the mapping. Its custom routing accelerators map users to specific EC2 instances and ports for applications that make that decision themselves.

Inside each stamp an ordinary [load balancer](../load-balancing/) spreads requests over that stamp's instances. And whatever does the routing, the stamp must still check that the caller is allowed to act for the tenant: a host name only says which tenant the request is for.

### Deploying stamps from code

Stamps only stay identical if nobody builds or changes them by hand. Describe a stamp as one infrastructure-as-code module (Bicep and Terraform are Microsoft's examples; AWS CloudFormation and the AWS CDK work the same way) with the stamp's name, region and size as parameters, and create, update and replace stamps only through a pipeline, as in [Immutable Infrastructure](../immutable-infrastructure/). [GitOps](../gitops/) takes this further: the list of stamps and the version each should run live in Git, and an agent reconciles every stamp to match. As the number of stamps grows, check them for configuration drift with policy as code, such as Azure Policy. Microsoft recommends deploying at least two stamps, because with only one, code and configuration quietly start to assume there is only one.

### Rolling out in rings

Stamps give every release a natural unit of exposure. Group stamps into **deployment rings** and release to one ring at a time: an internal stamp that hosts your own test tenants first, then a small ring, then the rest, with a pause after each ring to watch error rates and latency before going on. Microsoft's multitenant guidance names three common rings: *canary* (your test tenants and customers who want updates as soon as possible), *early adopter* and *users*. Inside a stamp, the update itself can still be a [rolling update](../rolling-update/) or a [canary release](../canary-release/).

During a rollout the stamps run different versions. Record each stamp's version in the catalog or the control plane, so that support knows what a tenant is running, a hotfix reaches every version still in production, and tenants are only moved between stamps on compatible versions. Keep the number of versions in production small.

### Moving tenants between stamps

Tenants move to rebalance load, to upgrade to a dedicated stamp, to change region (after an acquisition or a change in the law), or because a stamp is being retired. A tenant's data lives in its stamp, so every move is a data migration, usually in three steps:

1. **Copy** the tenant's data to the new stamp as a copy that nothing reads yet, and keep it in sync while the tenant goes on working, for example with [change data capture](../change-data-capture/).
2. **Switch** the tenant's catalog entry to the new stamp after a final catch-up, so that the router sends its requests there. With DNS-based routing this is a record change that takes effect as caches expire; with a catalog lookup it takes effect as soon as the routers see the new entry.
3. **Drain** the old stamp: let requests in flight finish, redirect any stragglers, then delete the old copy.

It is the same problem as moving data between shards ([Sharding](../sharding/)), and the delicate moment is the switch. Build and rehearse the tooling early; the day a tenant suddenly outgrows its stamp is a bad day to write it.

### Monitoring per stamp and per tenant

Tag every metric, log line and trace with its stamp and tenant, and alert per stamp: an average over all stamps hides one that is down. Track capacity per stamp (tenants placed, load against its budget, quota usage) and each tenant's share of its stamp, which is how a noisy neighbour shows up before it hurts anyone. Objectives per stamp, or per tier of tenant ([SLOs & Error Budgets](../slo-error-budgets/)), make it obvious when one stamp is burning its error budget while the rest are fine.

## When to use it

- **Multitenant services nearing the limits of one deployment:** the largest database tier, a subscription or account quota, connection or host-name limits.
- **Tenants with data residency or latency requirements** in particular regions.
- **Tenants that need isolation:** dedicated stamps for large or regulated customers, or heavy tenants kept away from the rest.
- **Different update cadences** for different groups of tenants, or releases that should reach a few tenants first.
- **Limiting how many tenants one failure can reach**, which is the main goal of [Cell-Based Architecture](../cell-based-architecture/).

When not to use it:

- **One region, a few tenants and no limit in sight.** Every stamp is another deployment to patch, monitor, keep identical and pay for, on top of the router, the catalog and the control plane. Until a real limit or requirement appears, scale the single deployment up or out.
- **Only one component is hitting its limit.** Scale that component instead, for example by sharding the database.
- **Every instance must be able to serve every user** from the same data. Replicate the data to all instances instead, as Azure's Geode pattern does.
- **The content is static.** Serve it from a CDN.

## Trade-offs

- **Cost.** Every stamp carries fixed overhead (a database at its minimum size, load balancers, caches, monitoring), and each keeps spare capacity of its own, so total utilisation is lower than in one shared pool. Microsoft describes the increase in cost as substantial. Smaller stamps raise the overhead per tenant; larger ones put more tenants behind each failure.
- **Operations multiply.** Ten stamps are ten deployments to roll out, watch, patch, renew certificates for and keep within quotas. Without full automation they drift apart.
- **The global layer is shared.** The router, the catalog and sign-in can still take every tenant down, so they need more redundancy than any stamp.
- **Moving a tenant is a migration,** never just a configuration change.
- **Cross-tenant features get harder.** Anything that used to be one query against one database becomes a fan-out over every stamp or a separate central store.
- **Stamps don't fail over by themselves.** A stamp lives in one region; if that region goes down, its tenants wait for the region or for you to restore them elsewhere. Back up each stamp, plan its recovery ([Disaster Recovery Strategies](../disaster-recovery-strategies/)), and consider geo-redundant placement for critical tenants.
- **Versions diverge during rollouts,** and every tool that touches more than one stamp has to cope with that.

## Implementation notes

**Start from what you have.** Treat the existing deployment as stamp 1, put the catalog and the router in front of it, and deploy a second stamp early, even if at first it hosts only internal tenants. That stamp becomes ring 0 of every rollout.

**How it relates to nearby patterns:**

- [Cell-Based Architecture](../cell-based-architecture/) uses the same mechanics: identical, independent copies of the whole stack, each serving a subset of customers behind a thin router, and Microsoft lists *cell* among the other names for a stamp. The emphasis differs. Stamps are usually introduced for scale limits, tenant placement (a region, data residency, a dedicated stamp) and update cadences; cells are introduced to contain the blast radius of failures. One design usually ends up serving both goals, and AWS's cell-based whitepaper is a useful companion on routing, sizing and migration.
- **Geodes** (Azure's Geode pattern) make the opposite choice about data: every geode can serve any user, from a data store replicated to all of them. Stamps serve only their own tenants and replicate nothing between them. Microsoft notes that the two combine: the global routing layer in front of the stamps can itself be built as geodes.
- [Multi-Region Active-Active](../multi-region-active-active/) runs one application in several regions over replicated data, so any region can serve any user and traffic can move away from a failed region. Stamps pin each tenant to one region and replicate nothing, which makes data residency simple but leaves regional failover to you.
- [Sharding](../sharding/) splits only the data and keeps one shared application tier. Stamps split everything, which shards the data by tenant, and a single stamp can still shard internally.
- [Autoscaling](../autoscaling/) works inside a stamp, up to the stamp's tested maximum. Beyond that, add a stamp.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Cell-Based Architecture](../cell-based-architecture/) — Many isolated, identical cells behind a thin router contain the blast radius of any failure.
- [Sharding](../sharding/) — Split data horizontally across databases using a shard key.
- [Multi-Region Active-Active](../multi-region-active-active/) — Serve users from several regions at once and shift traffic away from a region that fails.
- [Canary Release](../canary-release/) — Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back.
- [Autoscaling](../autoscaling/) — Add and remove instances automatically as load rises and falls.
- [GitOps](../gitops/) — Git holds the desired state; an agent continuously reconciles the cluster to match it.
- [Immutable Infrastructure](../immutable-infrastructure/) — Never patch servers in place: bake a new image and replace them.
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.

## References

- [Azure Architecture Center — Deployment Stamps pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/deployment-stamp)
- [Azure Architecture Center — Tenancy models for a multitenant solution](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/tenancy-models)
- [Azure Architecture Center — Architectural approaches for the deployment and configuration of multitenant solutions](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches/deployment-configuration)
- [Azure Architecture Center — Considerations for updating a multitenant solution (deployment rings)](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/updates)
- [Azure Architecture Center — Considerations for multitenant control planes](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/control-planes)
- [Azure Architecture Center — Map requests to tenants in a multitenant solution](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/map-requests)
- [Azure Architecture Center — Tenant life cycle considerations in multitenant solutions](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/tenant-life-cycle)
- [Azure Architecture Center — Noisy Neighbor antipattern](https://learn.microsoft.com/en-us/azure/architecture/antipatterns/noisy-neighbor/noisy-neighbor)
- [Azure Architecture Center — Geode pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/geodes)
- [AWS Well-Architected — Reducing the Scope of Impact with Cell-Based Architecture (whitepaper)](https://docs.aws.amazon.com/wellarchitected/latest/reducing-scope-of-impact-with-cell-based-architecture/reducing-scope-of-impact-with-cell-based-architecture.html)
- [Azure Front Door — How requests get matched to a route configuration](https://learn.microsoft.com/en-us/azure/frontdoor/front-door-route-matching)
- [AWS Global Accelerator — How AWS Global Accelerator works](https://docs.aws.amazon.com/global-accelerator/latest/dg/introduction-how-it-works.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
