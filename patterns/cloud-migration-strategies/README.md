<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔄 Migration & Modernization](../../README.md#migration--modernization)

# Cloud Migration Strategies (7 Rs)

> Rehost, replatform, refactor, repurchase, relocate, retain or retire: pick one per workload.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Cloud Migration Strategies (7 Rs)" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/cloud-migration-strategies.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Assess the portfolio** | Every workload is **inventoried** first: what it does, who uses it, what it depends on, what it costs to run, how much it matters to the business and how ready it is for the cloud. Each one then gets **exactly one** of the seven Rs, recorded in a portfolio table that becomes the migration plan. |
| **2 · The light-touch decisions** | The cheapest decisions come first. **Retire** switches off the reporting tool nobody uses: nothing to move, and its running cost is saved. **Retain** keeps the mainframe on premises for now, to be revisited later. **Relocate** moves the VMware cluster as it is to a VMware service in the cloud, without changing the virtual machines. **Repurchase** replaces the self-hosted CRM with a SaaS product: the data moves, the servers go. |
| **3 · Rehost and replatform** | **Rehost** (lift and shift) moves Orders to cloud virtual machines unchanged. It is the fastest way out of the data centre, but it gains little else. **Replatform** makes a few targeted changes to Inventory: its database moves to a managed database service and the application to a managed container platform, with no change to its architecture. |
| **4 · Refactor where it pays** | **Refactor** (re-architect) rebuilds the product catalog around cloud-native services, usually piece by piece behind a facade. It takes the most effort and carries the most risk, so it is kept for the one workload that sets the business apart, where the long-term benefit is highest. The table ends with one R per workload and most of the effort spent on that workload. |
<!-- END GENERATED: header -->

## The problem

A data centre rarely holds one application. It holds hundreds: packaged products, custom code written over twenty years, databases, file shares, a VMware estate, perhaps a mainframe. Then a date arrives (the lease on the building ends, the hardware is due for replacement, a support contract runs out) and all of it has to go somewhere.

Treating the whole estate the same way fails in both directions. Lifting and shifting everything carries every inefficiency into the cloud, where an oversized server that was already paid for becomes a monthly bill. Rewriting everything ties up the best engineers for years and puts risk into systems that never needed to change. The useful question is asked once per workload: **what is the cheapest move that still meets this workload's business goal?** The "Rs" give everyone the same short list of answers, and a portfolio assessment provides the facts to choose between them.

## How it works

The migration runs as a portfolio decision first and a series of moves second, which is what the four steps of the diagram show.

1. **Assess** every workload and record one disposition for each in a portfolio table.
2. Take the **light-touch decisions**: switch off what nobody needs, leave in place what should not move yet, move whole platforms as they are, and replace commodity software with SaaS.
3. **Rehost** the workloads that only need to leave the data centre, and **replatform** those where a managed service removes real operational work.
4. **Refactor** only where a new architecture pays for itself, usually the systems that set the business apart.

### Where the Rs come from

- **Gartner, 2011: five Rs.** Gartner research director Richard Watson described five ways to move an application to the cloud: *rehost* it on infrastructure as a service, *refactor* it for platform as a service, *revise* the code first and then rehost or refactor it, *rebuild* it on a PaaS, or *replace* it with software as a service. Gartner's *refactor* meant running existing code on a PaaS with modest changes, which is closer to what is now called replatforming.
- **AWS, 2016: six Rs.** In [6 Strategies for Migrating Applications to the Cloud](https://aws.amazon.com/blogs/enterprise-strategy/6-strategies-for-migrating-applications-to-the-cloud/) (1 November 2016), Stephen Orban of AWS built on Gartner's list: rehost (lift and shift), replatform (lift, tinker and shift), repurchase (move to a different product), refactor or re-architect, retire, and retain. He noted that in large legacy migrations most applications were rehosted, and that an application is easier to optimise once it already runs in the cloud.
- **AWS, later: seven Rs.** AWS then added *relocate*, for moving a whole platform, typically a VMware estate, to the cloud version of the same platform. [AWS Prescriptive Guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/large-migration-guide/migration-strategies.html) now lists seven: retire, retain, rehost, relocate, repurchase, replatform and refactor (or re-architect). The diagram uses these names.

### The seven Rs

| R | What it means | Choose it when | Effort and risk | What you gain | Examples (October 2026) |
|---|---|---|---|---|---|
| **Retire** | Switch the workload off, and archive its data if retention rules require it | Nobody uses it, or another system already does its job. AWS suggests finding candidates in utilisation data: servers with very low average CPU and memory use, or no inbound connections for 90 days | Low, once you have proved that nothing still depends on it | Its hosting, licence and support costs stop, and so does the security risk of software that no longer gets patches | The discovery tools listed under *Assessing the portfolio* |
| **Retain** | Keep it where it is for now, with a date to look at it again | Data residency or compliance, hardware with no cloud equivalent, a recent upgrade that still has years to run, a dependency that must move first, a mainframe that needs its own careful plan, or too little value in moving | None now | Focus: the migration team spends its time where it pays | Managing what stays from the cloud, for example with Azure Arc |
| **Relocate** | Move a whole platform, usually VMware vSphere virtual machines, to a service that runs the same platform in the cloud. The VMs do not change | A large VMware estate has to leave the data centre quickly | Low. AWS calls it the quickest way to migrate | The same tools, skills and runbooks, without buying hardware. Nothing about the workloads improves, and the VMware subscription still has to be paid | Amazon Elastic VMware Service, VMware Cloud on AWS (now sold by Broadcom), Azure VMware Solution, Google Cloud VMware Engine |
| **Rehost** | Lift and shift: copy the servers onto cloud virtual machines without changing the application | The workload is stable, needs no change soon, and the date matters most | Low | A way out of the data centre and a starting point for later optimisation. By itself it does not lower running costs, and an unoptimised copy can cost more than before | AWS Transform MGN, Azure Migrate, Google Cloud's Migrate to Virtual Machines |
| **Repurchase** | Replace it with a different product, usually SaaS ("drop and shop"; Microsoft calls it *replace*) | A commodity capability such as CRM, HR or collaboration, where a product meets the need with little customisation | Medium: the data has to be moved, integrations and single sign-on rebuilt, and users retrained | No servers to run or upgrade; the vendor operates the product | Any SaaS product |
| **Replatform** | Lift, tinker and shift: a few targeted changes to use managed services, with the same architecture | Patching, backups, failover or licences cost real effort today | Medium | Less operational work, often lower licence costs, and resilience features the managed service brings | A self-managed database moved to Amazon RDS, Azure SQL Database or Cloud SQL; an application moved onto a managed platform such as Amazon ECS or EKS, AKS, Azure App Service, GKE or Cloud Run |
| **Refactor** (re-architect) | Change the architecture to take full advantage of cloud-native services | The workload sets the business apart and its architecture limits how fast it can change or scale | High: the most effort, cost, risk and time of the seven | The most long-term benefit: faster releases, components that scale independently, cost that follows usage | [Serverless](../serverless/) functions, event buses and queues, managed databases, often as [microservices](../microservices/) |

### Assessing the portfolio

Step 1 of the diagram turns into the longest phase of a real migration. The aim is a table with one row per workload and enough facts in it to defend each decision.

- **Discover what exists.** Collect the inventory automatically (servers, their utilisation, installed software, databases) and add what no tool can see: the owner, the users, the business process it serves, the contracts and licences attached to it. Current tools include **AWS Transform**, an agentic AI service launched in May 2025 that AWS now points to for discovery and assessment (AWS Application Discovery Service and AWS Migration Hub stopped taking new customers on 7 November 2025); **[Azure Migrate](https://learn.microsoft.com/en-us/azure/migrate/migrate-services-overview)**, with an appliance or a one-off collector, assessments and a business case; and Google Cloud's **Migration Center**, with discovery and cost estimates.
- **Map dependencies.** Find out which servers talk to which, which databases and file shares are shared, and which batch jobs run at night. [Azure Migrate's dependency analysis](https://learn.microsoft.com/en-us/azure/migrate/concepts-dependency-visualization), for example, groups servers that talk to each other into applications and shows which ones have to move together.
- **Build the business case.** Compare what each workload costs today (hardware, licences, power, space, support, people) with what it would cost in the cloud under each candidate R, including the one-off cost of the move. Azure Migrate, AWS Transform and Migration Center all produce total-cost-of-ownership estimates; treat them as a starting point and check the assumptions.
- **Score value and readiness.** How much the workload matters to the business and how ready it is for the cloud decide most dispositions. High value with low readiness points to a careful replatform or refactor; low value points to retire or repurchase.
- **Plan migration waves.** Group workloads into waves of a few weeks each, and put workloads that depend on each other in the same wave, so that a chatty application does not spend months talking to its database across a VPN. Start with simple, low-risk workloads to build the team's routine before the hard ones; Orban made the same recommendation. AWS Transform MGN, for example, groups servers into applications and applications into waves, so that launch and cutover run per wave.

### One workload, more than one R over time

The R is a decision for this migration, not a label for life. AWS recommends rehosting, relocating or replatforming during a large migration and modernising afterwards, because refactoring many applications in the middle of a migration is hard to manage. Rehosting is often the first step on a longer path: lift and shift now to meet the date, replatform the database a few months later, refactor the parts that turn out to matter. Retained workloads come back for review, and a repurchased product can itself be replaced one day. The opposite advice holds too: Microsoft's Cloud Adoption Framework says to rehost only a workload you are confident will not need modernising for about two years, so that you do not pay for two migrations of the same system.

### Other names for the same idea

The lists differ between providers (checked in October 2026), so compare the definitions, not the labels.

- **Microsoft Cloud Adoption Framework** names eight strategies: [retire, rehost, replatform, refactor, rearchitect, replace, rebuild and retain](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/plan/select-cloud-migration-strategy). It splits AWS's refactor in two: *refactor* changes the code (to reduce technical debt or use Azure SDKs) and *rearchitect* changes the architecture (for example to break up a monolith). *Replace* is AWS's repurchase, and *rebuild* means redeveloping the workload from scratch as a cloud-native solution. It has no separate relocate.
- **Google Cloud's** [Migrate to Google Cloud: Get started](https://docs.cloud.google.com/architecture/migration-to-gcp-getting-started) lists six types of migration: rehost (lift and shift), replatform (lift and optimize), refactor (move and improve), re-architect (continue to modernize), rebuild (remove and replace, also called rip and replace) and repurchase. Retire and retain are not on its list. The guide wraps them in four phases: assess, plan, deploy and optimize.
- **The same word can mean three things.** Gartner's *refactor* was a move to PaaS, AWS's *refactor* is a re-architecture, and Microsoft's *refactor* is a code change that keeps the architecture.

## When to use it

- **Any migration of more than a handful of workloads:** a data centre exit, the end of a co-location or outsourcing contract, a hardware refresh, a merger, or a move from one cloud to another (the Cloud Adoption Framework, for example, treats moving AWS EC2 instances to Azure virtual machines as a rehost).
- **After the migration,** as a standing portfolio review: the retained and rehosted workloads deserve another look once the landing zone and the team's skills have matured.
- **When not to migrate a workload at all.** Leaving something where it is, or switching it off, is a valid outcome, not a failure of the programme.
  - It will be retired or replaced soon anyway; moving it first only spends money twice.
  - Regulation or data residency rules cannot be met in the regions available.
  - It depends on hardware with no cloud equivalent, or must sit next to equipment on site, such as machines on a factory floor.
  - The hardware it runs on was renewed recently and still has years of life.
  - The move would cost more than it saves over the planning horizon, and the workload is stable and meets the business's needs.
  - It is a mainframe or a mid-range system with no migration plan of its own yet. Moving these is a project in itself.

## Trade-offs

- **Speed against benefit.** Relocate and rehost reach the deadline fastest and change the least, so they deliver the least beyond the exit. Refactor delivers the most and is the slowest and riskiest. Replatform and repurchase sit in between. Most portfolios use all of them.
- **Rehosting everything and paying more.** Servers sized for the peak of five years ago, copied one for one and left running around the clock at on-demand prices, can cost more in the cloud than they did in the data centre. Right-size from the utilisation data, switch non-production environments off when nobody uses them, commit to steady capacity, and plan the replatforming that rehosting postponed.
- **Refactoring too much at once.** Re-architecting dozens of applications during a migration turns a project with a date into an open-ended rewrite. AWS advises against refactor as part of a large migration and suggests choosing it only when no other strategy is acceptable. Keep it for the few systems where the business benefit is clear, and change them piece by piece.
- **Ignoring licences.** Licences can decide the business case on their own: some cannot be moved to a shared cloud host, some are priced per core in ways that change with the instance type, and some include the right to run elsewhere. Check every operating system, database, middleware and packaged product before choosing an R. Relocating VMware is the current example (see below).
- **Ignoring dependencies.** Moving an application without its database, or a database without the reports that read it every night, causes latency, broken jobs and emergency firewall changes. Hard-coded IP addresses, shared file systems and licence servers are the usual surprises.
- **Retain has a running cost.** Every retained workload keeps part of the data centre alive, plus the network links and the second operating model that a hybrid estate needs. Give each one a review date.

## Implementation notes

- **Build the landing zone first.** Before the first wave, prepare the target: the account or subscription structure, networking and connectivity back to the data centre, identity, security guardrails, logging and cost reporting. Examples are a landing zone set up by [AWS Control Tower](https://docs.aws.amazon.com/controltower/latest/userguide/what-is-control-tower.html), an [Azure landing zone](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/landing-zone/) and Google Cloud's [landing zone design](https://docs.cloud.google.com/architecture/landing-zones) guidance. Every wave after that lands in a place that is already governed.
- **Move the data while the system keeps running.** A large database cannot be stopped for a copy that takes days. Database migration services first copy the existing data and then keep streaming the changes until the cutover: [AWS DMS](https://docs.aws.amazon.com/dms/latest/userguide/Welcome.html) (one-time migrations or ongoing replication), [Azure Database Migration Service](https://learn.microsoft.com/en-us/azure/dms/dms-overview) (online migrations to Azure SQL Managed Instance or SQL Server on Azure virtual machines) and [Google Cloud's Database Migration Service](https://docs.cloud.google.com/database-migration/docs/overview) (continuous migration after an initial dump and load). That is [change data capture](../change-data-capture/) applied to a migration. For whole servers, AWS Transform MGN replicates the disks continuously at block level, so the cutover window is typically minutes.
- **Cut over safely.** Launch and test the migrated copy before the cutover, with real data and its real dependencies. For a system where wrong answers are expensive, run the old and the new side by side on the same inputs and compare the results with a [parallel run](../parallel-run/). Switch the traffic so that it can be switched back: keep the old environment intact, read-only if necessary, until the new one has proved itself, as in a [blue-green deployment](../blue-green-deployment/). Write down the rollback criteria before the cutover window, not during it.
- **Protect the new from the old.** Migrations take years, so new cloud-native services will talk to legacy systems that are still on premises, such as the retained mainframe in the diagram. Put an [anti-corruption layer](../anti-corruption-layer/) between them so that the legacy data model does not leak into the new design. To refactor a large system without a big-bang rewrite, route its traffic through a facade and replace it one capability at a time, as in the [strangler fig](../strangler-fig/) pattern.
- **Relocating VMware in 2026.** Since Broadcom acquired VMware, the cloud VMware services have changed in ways that affect the business case:
  - AWS stopped reselling **VMware Cloud on AWS** on 30 April 2024; Broadcom and its resellers sell it now. AWS's own service, [Amazon Elastic VMware Service](https://docs.aws.amazon.com/evs/latest/userguide/what-is-evs.html), has been generally available since 5 August 2025. It runs VMware Cloud Foundation (VCF) inside your own VPC, and you bring a VCF subscription with licence portability; perpetual vSphere licences are not accepted.
  - In November 2025 Broadcom moved every hyperscaler to bring-your-own VCF subscriptions. [Azure VMware Solution](https://learn.microsoft.com/en-us/azure/azure-vmware/license-included-service-retirement) continues with customer-supplied VCF: its licence-included pay-as-you-go SKUs retire on 31 October 2026 and its licence-included reserved instances on 30 August 2027. [Google Cloud VMware Engine](https://cloud.google.com/blog/products/compute/broadcom-vcf-licensing-changes-for-vmware-engine) stopped selling licence-included nodes after 15 October 2025, and its nodes have needed portable VCF subscriptions since 1 November 2025.
  - So relocate now means two bills: the cloud nodes and a VCF subscription from Broadcom. Compare that with rehosting the same virtual machines onto native cloud compute, which tools such as [AWS Transform for VMware](https://aws.amazon.com/transform/vmware/), Azure Migrate and Migrate to Virtual Machines automate. Relocate can still be the right first step for a large estate with a hard deadline.
- **Know the current tool names.** AWS Application Migration Service was [renamed AWS Transform MGN](https://aws.amazon.com/about-aws/whats-new/2026/06/aws-transform-mgn-rebrand/) on 8 June 2026, to reflect its role as the replication engine behind AWS Transform; it can be driven from its own console or from the agentic AWS Transform workflow. Azure Migrate now includes an Azure Copilot migration agent (in preview) for planning. Product names in this area change often, so check them when you plan.
- **Finish each wave.** Decommission the source servers once a workload has moved, or you pay for it twice. Compare the actual cost with the business case, and record a review date for every workload that was retained or only rehosted.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Strangler Fig](../strangler-fig/) — Put a facade in front of the legacy system and move routes to new services one at a time.
- [Anti-Corruption Layer](../anti-corruption-layer/) — A translation layer that keeps a legacy model from leaking into the new domain.
- [Parallel Run](../parallel-run/) — Run old and new side by side on the same inputs and compare results before cutting over.
- [Change Data Capture (CDC)](../change-data-capture/) — Stream every committed change from the database log to other systems.
- [Disaster Recovery Strategies](../disaster-recovery-strategies/) — Backup & restore, pilot light, warm standby, active-active: trading cost against RTO and RPO.
- [Immutable Infrastructure](../immutable-infrastructure/) — Never patch servers in place: bake a new image and replace them.
- [Microservices](../microservices/) — Small, independently deployable services, each owning one business capability and its data.
- [Serverless (Functions)](../serverless/) — Functions start per event, scale out automatically and scale to zero when idle.

## References

- [AWS Prescriptive Guidance — Guide for AWS large migrations: About the migration strategies](https://docs.aws.amazon.com/prescriptive-guidance/latest/large-migration-guide/migration-strategies.html)
- [Stephen Orban — 6 Strategies for Migrating Applications to the Cloud (AWS, 2016)](https://aws.amazon.com/blogs/enterprise-strategy/6-strategies-for-migrating-applications-to-the-cloud/)
- [Microsoft Cloud Adoption Framework — Select your cloud migration strategies](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/plan/select-cloud-migration-strategy)
- [Google Cloud Architecture Center — Migrate to Google Cloud: Get started](https://docs.cloud.google.com/architecture/migration-to-gcp-getting-started)
- [AWS — What is AWS Transform MGN? (formerly AWS Application Migration Service)](https://docs.aws.amazon.com/mgn/latest/ug/what-is-mgn.html)
- [Microsoft Learn — About Azure Migrate](https://learn.microsoft.com/en-us/azure/migrate/migrate-services-overview)
- [Microsoft Learn — Dependency analysis in Azure Migrate](https://learn.microsoft.com/en-us/azure/migrate/concepts-dependency-visualization)
- [Google Cloud — Migration Center overview](https://docs.cloud.google.com/migration-center/docs/migration-center-overview)
- [AWS — What is Amazon Elastic VMware Service?](https://docs.aws.amazon.com/evs/latest/userguide/what-is-evs.html)
- [Microsoft Learn — Azure VMware Solution license-included service retirement, using portable VCF and other options](https://learn.microsoft.com/en-us/azure/azure-vmware/license-included-service-retirement)
- [Google Cloud Blog — Broadcom VCF licensing changes for VMware Engine](https://cloud.google.com/blog/products/compute/broadcom-vcf-licensing-changes-for-vmware-engine)
- [Microsoft Cloud Adoption Framework — What is an Azure landing zone?](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/landing-zone/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
