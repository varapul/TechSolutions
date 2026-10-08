<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔄 Migration & Modernization](../../README.md#migration--modernization)

# AWS Migration Process

> Assess, mobilize, then migrate and modernize: a business case, a landing zone and migration waves that move a portfolio to AWS.

<p align="center"><img src="diagram.svg" alt="Animated diagram: AWS Migration Process" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/aws-migration-process.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · A big-bang weekend** | Acme Shop's back office still runs in its own data centre in Bangkok: about **120 workloads**, a 40-person IT team and a lease that ends in **18 months**. Plan v1 lists the servers in a spreadsheet, sets up a VPN and one AWS account, copies the virtual machines and then switches **all 120 in one weekend**. With no dependency map, Orders comes up in AWS while its database is still in Bangkok, so each of its 200 queries per order crosses the VPN (25 ms each, 5 s per order); nobody has priced the licences, and on Monday 31 workloads are failing with no plan to roll back. (Acme's numbers are the example's own.) |
| **2 · Assess: know the estate** | AWS Prescriptive Guidance splits a large migration into three phases: **assess**, **mobilize**, and **migrate and modernize**. In assess, discovery (AWS Transform here) turns 310 servers into 120 workloads with their utilisation and connections, so Orders, its database and Inventory, which reads it, become one **move group**. The **business case** prices today's estate against a copy as is (6% more) and a right-sized one (22% less), licences included; every workload gets **one R** (rehost 45, replatform 19, relocate 24, repurchase 6, refactor 3, retire 14, retain 9), and a readiness assessment along the Cloud Adoption Framework's perspectives scores 1.5 out of 5. |
| **3 · Mobilize: lay foundations** | Mobilize builds what the waves will need. A **landing zone** set up with AWS Control Tower adds back-office accounts next to the shop's in AWS Organizations, with guardrails, single sign-on with MFA and a network link to the data centre; a **cloud centre of excellence** drawn from IT, the platform team, security and finance trains all 40 people. A **pilot** of five low-risk workloads proves the runbook (v1 to v3, with alerts and cost reports) and lifts readiness to 3.1, and the **wave plan** puts the other 92 into eight waves of 6 to 15, grouped by move group: the VMware cluster in waves 4 and 5, the Orders group in wave 6. |
| **4 · Migrate, then modernize** | A **migration factory** starts a wave every two weeks: AWS Transform MGN replicates the servers and AWS DMS the databases, each wave is tested, cut over on a Saturday night and finalised, and one cutover in wave 3 misses its written criteria, is **rolled back** and moves later. By month 14 the data centre is empty, four months before the lease ends: 97 workloads have moved, 14 are switched off and the 9 retained ones, the mainframe among them, sit in a co-location rack. Right-sizing and Savings Plans bring the run cost 21% below today, and the rehosted workloads are modernised one at a time after the move; the amber panel lists the usual pitfalls. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's online shop already runs on AWS, in containers on Kubernetes on the platform team's Launchpad. Its back office does not. Order handling, inventory, the product catalog that feeds the shop, a self-hosted CRM, a VMware cluster, a mainframe and a reporting tool nobody uses still run in Acme's own data centre in Bangkok: about 120 workloads on 310 servers, looked after by an IT team of 40. The lease on the building ends in 18 months, and leadership wants three things: out of the data centre before then, infrastructure costs about 20% lower, and faster changes to the back office. (Acme's numbers on this page are the example's own, not research findings.)

The first plan treats the move as a copy job. A spreadsheet lists the servers, a VPN and a single AWS account are set up, the virtual machines are copied across, and then all 120 workloads are switched over in one weekend. Nothing in that plan says which servers belong together, what the move will cost or how to go back, and the weekend shows it:

- Orders comes up in AWS while its database, which nobody had tied to it, is still in Bangkok. Orders sends about 200 queries per order, and each one now crosses the VPN: 25 ms each, 5 seconds per order.
- Nobody priced the licences. Licence terms decide where some software may run and how it is counted in the cloud, so the first bill is the first estimate.
- On Monday morning 31 workloads are failing, and there is no rollback plan: no criteria for giving up, no agreed way back, and a team with no time left to improvise one.

Moving a portfolio is a programme, not a weekend. It needs facts about the estate before anyone commits to dates, foundations in the cloud before the first workload lands, and a repeatable way to move workloads in small batches that can be tested and reversed.

## How it works

AWS describes a large migration as three phases taken in order, in AWS Prescriptive Guidance's *Guide for AWS large migrations* (Wally Lu, Tuhin Mukherjee, Damien Renner and Senay Swinney of AWS) and its companion guide *Mobilize your organization to accelerate large-scale migrations*. The guide counts 300 or more servers as a large migration, so Acme's 310 just qualify.

1. **Assess: build the business case.** Find out how ready the organisation is, take a first look at the portfolio and get the key stakeholders behind one set of goals. The readiness part is AWS's **Migration Readiness Assessment** (MRA): questions organised by the six perspectives of the [AWS Cloud Adoption Framework](../aws-cloud-adoption-framework/) (business, people, governance, platform, security and operations) that end in a list of strengths, gaps and actions. A quick discovery of the estate and a high-level estimate of the total cost of ownership complete the business case that pays for the rest.
2. **Mobilize: close the gaps and lay the foundations.** The mobilize guide splits the work into eight workstreams that mostly run side by side: a detailed business case, detailed portfolio discovery, application migration, migration governance, the landing zone, security, risk and compliance, operations, and people (skills, culture, change and leadership, with a cloud centre of excellence). AWS's own approach delivers them in eight two-week sprints. Portfolio discovery records every application with its infrastructure and dependencies, gives each one an R (see [Cloud Migration Strategies](../cloud-migration-strategies/)) and groups them into a prioritised schedule. The application migration workstream moves a first set of real business applications (the governance workstream suggests choosing 10 to 30) to prove the landing zone, the operating model and the security playbook, and to train people on the job.
3. **Migrate and modernize: move at scale, then improve.** AWS recommends migrating first and modernising afterwards. The migration has two stages. **Initialize**, which usually takes one to three months, checks that the landing zone and the network can carry the load, trains the teams and writes a **runbook** for each migration pattern (rehost to Amazon EC2, replatform to Amazon RDS and so on), each with pre-migration, migration and cutover tasks. **Implement** runs those runbooks wave after wave in a **migration factory**, tracks progress with a health-check matrix and improves the runbooks after every cutover.

Four core workstreams carry both stages: foundation (people and platform), project governance (scope, schedule, budget and communication), portfolio (metadata, prioritisation and wave planning) and migration (replication, testing and cutover).

### The migration factory and its waves

A migration factory is a set of teams, runbooks and automation that moves workloads in batches called **waves**, the way a production line moves parts. AWS's guidance (checked in October 2026) gives it this shape:

- **Repeatable work goes to the factory.** AWS estimates that 20 to 50 percent of an enterprise portfolio follows repeated patterns that a factory handles well, mostly rehost and light replatform. Factory teams are small and cross-functional, with five to six roles (operations, business analysts and owners, migration engineers, developers and DevOps). Complex applications that are being refactored are moved by their own teams in their own release cycles.
- **Move groups decide what moves together.** Applications that share a database, have the same owner or the same patch window go into one move group, and a wave is one or more move groups. Dependencies that every application has, such as the directory service, are built in the cloud first instead of being used to group anything.
- **Start small and plan ahead.** The portfolio playbook suggests fewer than 10 servers in each of the first waves, development and test environments before production, and waves planned four to five ahead, never all at once. It keeps a wave under about 50 servers and notes that four architects can rehost up to 50 servers a week. Its example for the implementation stage moves 1,000 servers in six months, starting at 5 servers a week and growing to 50 to 100.
- **Waves overlap.** With two-week sprints, each wave spans at least two sprints and usually lasts three to six weeks. In the implementation stage's example, the portfolio work for a wave takes one to two weeks and the migration work three to four, and the portfolio team stays about five waves ahead so that the migration team never runs out of work.

### Cutover, rollback and decommissioning

Every runbook ends in a cutover: a planned window in which the last changes are synchronised, traffic moves to the new copy, and the application owner tests it and accepts it. With AWS Transform MGN, AWS advises a test launch at least two weeks before the cutover date. During the cutover the source server keeps running and MGN keeps replicating it until the cutover is **finalised**. Until then a failed cutover can be **reverted** and tried again later while users stay on the source; finalising stops replication and discards the replicated data, and the source servers are then archived.

A rollback plan needs criteria written before the window (failed checks, error rates, response times), one person with the authority to call it, and a way back that has been tested. Plan for new data as well: once users write to the new copy, going back means taking those writes back too, so teams decide go or no-go after smoke tests and before users return, or keep reverse replication running for critical databases. Microsoft's Cloud Adoption Framework asks for the same in its migration plan: define what counts as a failed deployment, test the rollback and get it approved together with the plan.

Decommissioning closes each wave: switch off and wipe the source servers, cancel their support and licence contracts, update the inventory, and compare the actual run cost with the business case.

### The Migration Acceleration Program

AWS packages the same three phases as the **Migration Acceleration Program** (MAP), which it still offers in October 2026: assess (readiness across CAF's perspectives and a total-cost-of-ownership model), mobilize (closing the gaps, building the operational foundations and choosing migration strategies), and migrate and modernize (with AWS migration services, AWS Professional Services and partners). MAP adds tools, training, expertise from AWS Migration Competency Partners and financial investment, with specific approaches for Microsoft, VMware, SAP and mainframe workloads.

### Tools, as of October 2026

| Job | AWS tool | What it does |
|---|---|---|
| Discovery, dependencies, wave planning | **AWS Transform** | An agentic AI service, launched in May 2025, whose migration jobs cover discovery (server inventory from several sources), planning (application groups, dependencies and prioritised waves), landing zone and network creation, and server rehost. AWS recommends it in place of AWS Application Discovery Service and AWS Migration Hub, which stopped taking new customers on 7 November 2025; existing customers can finish their projects. |
| Business case | **Migration Evaluator** | Compares today's costs with right-sized AWS options, including bring-your-own and licence-included licensing, from an agentless collector or an imported inventory. |
| Landing zone | **AWS Control Tower** | Sets up a multi-account environment on AWS Organizations with preventive, detective and proactive controls, an Account Factory and IAM Identity Center. Up to landing zone version 3.3 it creates a Security OU with log archive and audit accounts; from version 4.0 that OU is no longer required and you can design your own structure. |
| Server rehost | **AWS Transform MGN** | Named AWS Application Migration Service until 8 June 2026. It replicates source servers continuously at block level and launches them on Amazon EC2, typically with a cutover window of minutes, and groups servers into applications and applications into waves. |
| Databases | **AWS Database Migration Service** | One-time migrations, or ongoing replication that keeps source and target in sync until the cutover; DMS Schema Conversion handles a change of database engine. |
| Factory automation | **Cloud Migration Factory on AWS** | An AWS Solution that connects discovery, migration and CMDB tools and automates the many small manual tasks of a factory. |
| VMware relocation | **Amazon Elastic VMware Service** | Runs VMware Cloud Foundation on EC2 bare metal inside your VPC and can extend the data centre's networks, so virtual machines keep their IP addresses; they move across with VMware HCX rather than MGN, and the licensing is covered on [Cloud Migration Strategies](../cloud-migration-strategies/). |

### The same process on Azure and Google Cloud

The other providers describe the same journey with other names (checked in October 2026):

| | AWS | Microsoft Azure | Google Cloud |
|---|---|---|---|
| Phases | Assess, mobilize, migrate and modernize | Cloud Adoption Framework: *plan* and *ready* (an Azure landing zone) come first; its *migrate* guidance then runs plan the migration, prepare workloads, execute, optimize, decommission | Assess, plan (including the foundation: identity, organization structure and network), deploy, optimize |
| Discovery and business case | AWS Transform, Migration Evaluator | Azure Migrate (appliance or collector, dependency analysis, business case) | Migration Center (discovery, TCO reports, dependencies, wave planning) |
| Servers | AWS Transform MGN | Azure Migrate (its Migrate and Modernize tool) | Migrate to Virtual Machines |
| Databases | AWS DMS | Azure Database Migration Service | Database Migration Service |
| Funded programme | Migration Acceleration Program | Frontier Accelerate for Azure (the Azure Accelerate pages now redirect to it) | Rapid Migration and Modernization Program (RaMP) |

## Putting it into practice

Acme's second plan follows the three phases over the 18 months it has. The tools are the ones Acme chose; others do the same jobs.

1. **Assess, months 1 to 3.** The COO sponsors the programme and owns the business case, as on the [CAF page](../aws-cloud-adoption-framework/). AWS Transform collects the inventory and the traffic between servers, and the application owners confirm what no tool can see: who uses each system and which contracts come with it. The 310 servers become 120 workloads, and the dependency map shows that Orders talks constantly to its database and that Inventory reads the same database, so the three form one move group. The business case puts today's yearly run cost at 100: copied as is, with servers sized for old peaks at on-demand prices, AWS would cost 106; right-sized, on Savings Plans and with every licence priced (bring-your-own or licence-included), it would cost 78, which clears the 20% goal. Each workload gets one R: rehost 45 (Orders among them), replatform 19 (Inventory), relocate 24 (the workloads on the VMware cluster), repurchase 6 (the CRM moves to SaaS), refactor 3 (the product catalog), retire 14 (the unused reporting tool) and retain 9 (the mainframe). The readiness assessment, scored on a 1-to-5 scale of Acme's own, averages 1.5.
2. **Mobilize, months 4 to 7.** Eight two-week sprints. The landing zone, set up with AWS Control Tower in the shop's existing organisation in AWS Organizations, adds back-office production and non-production accounts alongside the shop's accounts and the security accounts (log archive and audit). Guardrails are service control policies and Control Tower controls defined as [code](../infrastructure-as-code/), sign-in goes through IAM Identity Center with MFA, and a network link to Bangkok is sized for replication. A cloud centre of excellence (back-office IT, two engineers from the platform team, a security engineer and someone from finance) starts training all 40 people in IT. A pilot of five low-risk workloads goes to production; the runbook reaches version 3 along the way, alerts reach the right on-call rota and the cost report matches the tags, and readiness rises to 3.1. The wave plan then puts the other 92 workloads into eight waves of 6, 8, 10, 12, 12, 14, 15 and 15, grouped by move group: the VMware cluster in waves 4 and 5 (relocated to Amazon EVS), the Orders move group in wave 6, and the three refactored workloads at the end, after their teams have rebuilt them on their own track.
3. **Initialize and run the factory, months 8 to 12.** The pilot already wrote the runbooks, so initializing takes one month: the factory team (two migration engineers, an application analyst, an operations engineer, a platform engineer and a project lead) loads the wave plan into AWS Transform MGN. From then on a wave starts every two weeks and takes about four weeks, so two or three are always in flight: servers replicate with MGN (in waves 4 and 5, VMware HCX moves the cluster's virtual machines to Amazon EVS instead), databases with AWS DMS in ongoing replication, test launches run two weeks before each cutover, and each cutover happens on a Saturday night against written go/no-go and rollback criteria. In wave 3 a label-printing service fails its smoke test because its printers are addressed by hard-coded IP addresses; the cutover is reverted within the window, users stay on the source, and the service moves in wave 6 after the fix.
4. **Exit, months 13 and 14.** Each wave is finalised after a week of support, and the source servers are archived, switched off and wiped. The 14 retired workloads are switched off and their data archived where retention rules require it. A retained workload still needs a home when the lease ends, so the nine retained ones, the mainframe among them, move to a rented co-location rack with a review date a year away. By month 14 the data centre is empty, four months before the lease ends; that buffer is deliberate.
5. **Optimise, then modernise, from month 12.** Right-sizing from real usage and Savings Plans bring the run cost to 21% below today by month 18, close to the business case. Modernisation then happens one workload at a time, starting with Orders, which moves from rehosted virtual machines onto containers on Launchpad, the platform the shop's teams already use.

## Where it fits

- [Cloud Migration Strategies](../cloud-migration-strategies/) is the decision for each workload; this page is the programme that carries those decisions out across a portfolio, in an order and at a pace the organisation can sustain.
- [AWS Cloud Adoption Framework](../aws-cloud-adoption-framework/) is the organisational side. Its six perspectives structure the readiness assessment in the assess phase, and its gaps are what mobilize closes.
- [Well-Architected Framework](../well-architected-framework/) reviews the target design of each replatformed or refactored workload, one at a time.
- [Strangler Fig](../strangler-fig/) is how a planned refactor, such as the product catalog, replaces a legacy system piece by piece instead of in one cutover.
- [Parallel Run](../parallel-run/) and [Blue-Green Deployment](../blue-green-deployment/) make cutovers safer: compare old and new on the same inputs, and keep the old environment intact until the new one has proved itself.
- [Change Data Capture](../change-data-capture/) is what ongoing replication does during a database migration: copy the existing data, then stream every change until the cutover.
- [Disaster Recovery Strategies](../disaster-recovery-strategies/): each migrated workload needs its recovery objectives and a recovery strategy in its new home, and the migration is a good moment to set them.
- [Infrastructure as Code](../infrastructure-as-code/), [Amazon VPC](../amazon-vpc/) and [AWS IAM](../aws-iam/) are the building blocks of the landing zone: accounts and guardrails from reviewed code, the network design, and identity with single sign-on.
- [FinOps](../finops/) keeps the run cost visible against the business case, wave by wave.
- [Platform as a Product](../platform-as-a-product/) and [Incident Management](../incident-management/) take over after the move: modernised workloads land on an internal platform, and every migrated workload gets an owner on call.

## When to use it

- **It pays off** for a portfolio rather than a system: a data-centre exit, the end of a hosting or outsourcing contract, a hardware refresh across many applications, or a merger, especially with a fixed date. The phases give leadership a business case before the money is spent, give the teams a foundation before the first move, and keep each move small enough to test and reverse.
- **Scale it down** for a few dozen workloads: assess and mobilize can take weeks rather than months, and the factory may be a single team with one runbook. Keep the order, though, since even small migrations fail on missing dependencies and missing rollbacks.
- **It doesn't fit** a single application (pick its R and write one runbook), or a new product with nothing to migrate (start from a landing zone and the [Well-Architected Framework](../well-architected-framework/)). If regulation, data residency or equipment on site keep most of an estate where it is, invest in running a hybrid estate well instead of a migration programme.
- **Adapt it** to the organisation. Regulated industries add change-board approvals, audit evidence and data-residency rules to the runbooks and the landing zone. A small IT team leans on partners, which is what programmes such as MAP fund. A hard deadline pushes the portfolio towards rehost and relocate and away from refactoring, and calls for a buffer before the date.
- **It costs** senior time and a parallel run of two estates: until the data centre is empty, Acme pays for both, so a slow migration erodes the business case.

## Common pitfalls

- **Skipping mobilize.** Going from the business case straight to waves means the first wave lands in an account with no guardrails, a network not sized for replication, no runbook and nobody trained to run it. Build the landing zone, the cloud centre of excellence and the operating model first, and prove them with a pilot of real workloads.
- **No dependency map.** Moving server by server separates chatty applications from their databases and breaks nightly jobs, shared file systems and licence servers. Map the dependencies with a discovery tool, confirm them with the application owners, and move each move group in a single wave.
- **No rollback plan.** Without written criteria, someone with the authority to call it and a tested way back, a failed cutover becomes a long night and a forced fix. Put the criteria in the runbook, keep the source intact until the cutover is finalised, and rehearse a rollback during the pilot.
- **Modernising in the middle of the migration.** "While we're moving it, let's split it into services" turns a two-week wave into a project with no end date, and the lease does not wait. Move first and modernise after; keep the few planned refactors on their own track.
- **Forgotten licences.** Licence terms can rule out some targets and change the cost of others, and they can sink the business case after the move. Price every operating system, database and packaged product during assess, and compare bring-your-own with licence-included options before choosing an R.
- **Servers left running after the cutover.** A migrated workload whose source still runs is paid for twice, and an unoptimised copy can cost more than the data centre did. Finalise each cutover, archive and switch off the source, cancel its contracts and right-size the new copy from real usage.
- **Big first waves, or every wave planned up front.** Large early waves fail before the runbooks have been tested, and a plan for all waves goes stale as new dependencies turn up. Start with small, simple waves in non-production, keep a few waves planned ahead, and let each wave improve the runbooks.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Cloud Migration Strategies (7 Rs)](../cloud-migration-strategies/) — Rehost, replatform, refactor, repurchase, relocate, retain or retire: pick one per workload.
- [AWS Cloud Adoption Framework (CAF)](../aws-cloud-adoption-framework/) — Six perspectives and their foundational capabilities that show what an organisation must build, beyond technology, to adopt the cloud.
- [Strangler Fig](../strangler-fig/) — Put a facade in front of the legacy system and move routes to new services one at a time.
- [Parallel Run](../parallel-run/) — Run old and new side by side on the same inputs and compare results before cutting over.
- [Well-Architected Framework](../well-architected-framework/) — Review a workload against six pillars, from operational excellence to sustainability, and decide on the trade-offs between them.
- [Infrastructure as Code](../infrastructure-as-code/) — Define infrastructure in version-controlled code: review a plan, apply it the same way in every environment and catch drift.
- [Amazon VPC](../amazon-vpc/) — Your private network in AWS: subnets in each Availability Zone, route tables, gateways, security groups and endpoints.
- [Disaster Recovery Strategies](../disaster-recovery-strategies/) — Backup & restore, pilot light, warm standby, active-active: trading cost against RTO and RPO.

## References

- [AWS Prescriptive Guidance — Guide for AWS large migrations: Phases of a large migration](https://docs.aws.amazon.com/prescriptive-guidance/latest/large-migration-guide/phases.html)
- [AWS Prescriptive Guidance — Guide for AWS large migrations: Stage 2, implementing a large migration (migration factory)](https://docs.aws.amazon.com/prescriptive-guidance/latest/large-migration-guide/stage2.html)
- [AWS Prescriptive Guidance — Mobilize your organization to accelerate large-scale migrations: Overview](https://docs.aws.amazon.com/prescriptive-guidance/latest/strategy-migration/overview.html)
- [AWS Prescriptive Guidance — Mobilize your organization: Assess phase (Migration Readiness Assessment)](https://docs.aws.amazon.com/prescriptive-guidance/latest/strategy-migration/assess-phase.html)
- [AWS Prescriptive Guidance — Mobilize your organization: Migrate phase (migration factory teams)](https://docs.aws.amazon.com/prescriptive-guidance/latest/strategy-migration/migrate-phase.html)
- [AWS Prescriptive Guidance — Portfolio playbook for AWS large migrations: Defining the wave planning process](https://docs.aws.amazon.com/prescriptive-guidance/latest/large-migration-portfolio-playbook/wave-planning.html)
- [AWS Prescriptive Guidance — Migration playbook for AWS large migrations: Creating drafts of the migration runbooks](https://docs.aws.amazon.com/prescriptive-guidance/latest/large-migration-migration-playbook/task-two-drafts-runbooks.html)
- [AWS Prescriptive Guidance — Migration playbook for AWS large migrations: Performing sprint planning for scheduled waves](https://docs.aws.amazon.com/prescriptive-guidance/latest/large-migration-migration-playbook/task-one-sprint-planning.html)
- [AWS — Migration Acceleration Program (MAP)](https://aws.amazon.com/migration-acceleration-program/)
- [AWS Transform User Guide — What is AWS Transform?](https://docs.aws.amazon.com/transform/latest/userguide/what-is-service.html)
- [AWS — What is AWS Transform MGN? (formerly AWS Application Migration Service)](https://docs.aws.amazon.com/mgn/latest/ug/what-is-mgn.html)
- [AWS Transform MGN User Guide — Launching a cutover instance (revert, finalize, archive)](https://docs.aws.amazon.com/mgn/latest/ug/launch-cutover-gs.html)
- [AWS What's New — AWS Application Migration Service is now AWS Transform MGN (8 June 2026)](https://aws.amazon.com/about-aws/whats-new/2026/06/aws-transform-mgn-rebrand/)
- [AWS Database Migration Service User Guide — What is AWS DMS?](https://docs.aws.amazon.com/dms/latest/userguide/Welcome.html)
- [AWS — Migration Evaluator (business case and TCO)](https://aws.amazon.com/migration-evaluator/)
- [AWS Application Discovery Service availability change (closed to new customers, 7 November 2025)](https://docs.aws.amazon.com/application-discovery/latest/userguide/application-discovery-service-availability-change.html)
- [AWS Migration Hub availability change (closed to new customers, 7 November 2025)](https://docs.aws.amazon.com/migrationhub/latest/ug/migrationhub-availability-change.html)
- [AWS Control Tower User Guide — How AWS Control Tower works (landing zone structure)](https://docs.aws.amazon.com/controltower/latest/userguide/how-control-tower-works.html)
- [Cloud Migration Factory on AWS — Solution overview](https://docs.aws.amazon.com/solutions/latest/cloud-migration-factory-on-aws/solution-overview.html)
- [AWS — What is Amazon Elastic VMware Service?](https://docs.aws.amazon.com/evs/latest/userguide/what-is-evs.html)
- [Microsoft Cloud Adoption Framework — Plan your migration (sequencing, waves, rollback plans)](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/migrate/plan-migration)
- [Microsoft Cloud Adoption Framework — Migration wave planning](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/migrate/migration-wave-planning)
- [Microsoft Learn — About Azure Migrate](https://learn.microsoft.com/en-us/azure/migrate/migrate-services-overview)
- [Microsoft Azure — Frontier Accelerate for Azure](https://azure.microsoft.com/en-us/solutions/frontier-accelerate)
- [Google Cloud Architecture Center — Migrate to Google Cloud: Get started](https://docs.cloud.google.com/architecture/migration-to-gcp-getting-started)
- [Google Cloud — Migration Center overview](https://docs.cloud.google.com/migration-center/docs/migration-center-overview)
- [Google Cloud — Rapid Migration and Modernization Program (RaMP)](https://cloud.google.com/solutions/cloud-migration-program)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
