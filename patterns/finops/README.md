
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🏗️ Platform Engineering](../../README.md#platform-engineering)

# FinOps

> Cloud cost as a shared responsibility: allocate spend to the teams that cause it, optimise it and track the cost per unit of value.

<p align="center"><img src="diagram.svg" alt="Animated diagram: FinOps" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/finops.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · A bill nobody owns** | Over the first half of the year Acme’s monthly AWS bill grew from $80,000 to $130,000 (the example’s own numbers), and finance asks who spent it. Cost Explorer can’t say: 35% of June’s bill carries no `team` tag, the rest uses free-text values such as `Checkout` and `checkout`, and the shared Kubernetes cluster isn’t split per team. The load-test cluster `loadtest-2` has sat idle since April, staging runs around the clock, the production nodes average 12% CPU and everything is paid at on-demand rates, while finance and engineering talk past each other. |
| **2 · Inform: see and allocate** | From July a tag policy requires `team`, `service` and `env`, and an admission policy turns away pods without a `team` label, so 96% of July’s bill has an owner. Split cost allocation data divides the shared cluster per pod, and the platform’s shared $38,800 is split in proportion to each team’s direct cost, a rule agreed with finance. The **showback** tells checkout that $7,400 of its $34,300 is the forgotten `loadtest-2`; the **unit cost**, $4.10 per 1,000 orders, has risen from $3.25 in January, so cost grew faster than orders; and Cost Anomaly Detection flags search’s log costs, up $480 a day. |
| **3 · Optimize: usage, then rate** | The **Optimize** phase ranks the options, and the owning teams then change **usage** first: checkout deletes `loadtest-2` (−$7,400 a month), and the platform team rightsizes the production nodes from 8 to 5 at 40% average CPU (−$12,600), runs staging only 07:00–19:00 on weekdays (−$5,800) and moves logs to S3 Glacier Flexible Retrieval after 30 days (−$2,200). Only then do they change the **rate**: a one-year Compute Savings Plan sized on the smaller estate (−$10,000) and Spot capacity for CI runners and the nightly catalog import (−$3,000). September’s bill is $98,600 while orders grew 5%, so the unit cost falls to **$2.90 per 1,000 orders**. |
| **4 · Operate, and the pitfalls** | In the **Operate** phase each team gets a budget with a forecast alert and an anomaly monitor, engineering, finance and product review the unit cost, budgets and anomalies every month, and new designs must estimate their unit cost. The pitfalls, in amber: cutting cost at the expense of reliability (Spot for checkout’s pods), judging the total bill instead of the unit cost (November’s bill is forecast 23% higher, at $2.80 per 1,000 orders), over-committing to discounts (a plan sized on June’s peak would sit idle), shared costs nobody allocates (a new data platform pushes unallocated spend back to 9%), and a central team doing FinOps *to* engineers with “cut 20%” tickets instead of *with* them. |
<!-- END GENERATED: header -->

## The problem

In the cloud, buying capacity is part of engineering. Anyone who can merge a Terraform change or scale a deployment spends money, the bill arrives weeks later, and it is organised by account, service and usage type rather than by team or product. Three things then go wrong at once. Nobody can say who caused a cost, because resources carry no owner tag or free-text ones, and shared clusters, logging and networking hide which workload used what. Nobody compares the spend with what the business got for it, so a bill that grows with the business looks the same as a bill that grows with waste. And the people involved describe the same money in different words: finance in budgets, forecasts and cost centres, engineering in nodes, pods and CPU. The usual responses are a cost-cutting drive ordered from the top, which saves money once until the bill creeps back, or nothing at all until finance starts asking.

Acme Shop's version, with the example's own numbers: the monthly AWS bill grew from $80,000 in January to $130,000 in June. In Cost Explorer 35% of June's spend has no `team` tag, and the rest is spread over spellings such as `Checkout` and `checkout`. The shared EKS cluster is a single line on the bill. A load-test cluster, `loadtest-2`, has been idle since April, staging runs all week, the production nodes average 12% CPU, and every hour is paid at on-demand rates.

## How it works

**FinOps** is the practice described by the FinOps Foundation, which has been a project of the Linux Foundation since June 2020. Its definition, revised with the 2026 framework in March 2026, has three parts: FinOps is both a way of operating and a culture, it aims to get the most business value out of what an organisation spends on technology, and it does so by giving people timely data for their decisions and by making engineering, finance and the business jointly accountable for the money. The name joins *finance* and *DevOps*; the Foundation advises against expanding it to "cloud financial operations", which is easily confused with the finance department's own operations. The aim is value rather than the smallest possible bill, and sometimes the right decision is to spend more.

The **FinOps Framework** (finops.org, published under CC BY 4.0) sets out six **principles**, in no particular order:

1. **Teams need to collaborate.** Finance, technology, product and leadership manage cost together, at the speed and level of detail each kind of technology needs.
2. **Business value drives technology decisions.** Unit metrics say more than totals, and cost, quality and speed are traded off on purpose.
3. **Everyone takes ownership for their technology usage.** Accountability sits with the engineers who design and run the systems, and cost is a first-class metric from the start of the lifecycle.
4. **FinOps data should be accessible, timely, and accurate.** Cost data is shared as soon as it arrives, because fast feedback changes behaviour.
5. **FinOps should be enabled centrally.** A central team spreads good practice and takes on what benefits from scale, such as commitment discounts, so that engineers can concentrate on their usage.
6. **Take advantage of the variable cost model of the cloud.** Plan and buy capacity just in time, and prefer continuous small adjustments to occasional clean-ups.

The work runs through three **phases**, repeated rather than done once, and different people can work in different phases at the same time:

- **Inform:** collect cost, usage and efficiency data, allocate it to its owners, report and forecast, and relate the spend to business value.
- **Optimize:** use that picture to find and rank options for improvement, both **usage optimisation** (fewer resources for an acceptable result, mostly engineering's work) and **rate optimisation** (a lower price for the resources you do need, with procurement and leadership).
- **Operate:** carry out the chosen changes and improve the practice itself, with policies, automation, budgets and reviews, then go back to Inform to check the effect.

The framework's other building blocks:

- **Domains and capabilities.** Four domains describe outcomes, and 22 capabilities describe the work. *Understand Usage & Cost*: Data Ingestion, Allocation, Reporting & Analytics, Anomaly Management. *Quantify Business Value*: Planning & Estimating, Forecasting, Budgeting, KPIs & Benchmarking, Unit Economics. *Optimize Usage & Cost*: Architecting & Workload Placement, Usage Optimization, Rate Optimization, Licensing & SaaS, Sustainability. *Manage the FinOps Practice*: FinOps Practice Operations; Governance, Policy & Risk; FinOps Assessment; Automation, Tools & Services; FinOps Education & Enablement; Invoicing & Chargeback; Intersecting Disciplines; Executive Strategy Alignment. The 2026 revision added Executive Strategy Alignment and updated several capabilities, some under new names: Workload Optimization is now Usage Optimization, Policy & Governance is now Governance, Policy & Risk, Architecting for Cloud is now Architecting & Workload Placement, and Cloud Sustainability is now Sustainability, so older articles use the old names.
- **Scopes** (introduced in 2025 and refined in 2026). A scope is a segment of spending across technology categories, tied to a business construct such as a product, a cost centre or an environment, and it decides which personas, capabilities and targets apply. Many practices start with one scope for their public cloud spend; SaaS, licences, data centres and AI spending can be others. The framework advises creating a new scope only when it leads to better decisions. Acme's scope here is the AWS spend of the shop.
- **Personas.** The core personas are the FinOps practitioner, engineering, finance, product, procurement and leadership; the allied personas come from IT asset management, IT financial management, IT service management, security and sustainability.
- **Maturity.** Each capability is assessed on its own as Crawl, Walk or Run. The framework's sample targets give a feel for the levels: at Crawl at least 70% of cost can be allocated to an owner, commitment coverage is around 60% and forecasts are within 20% of actuals; at Walk 85%, over 75% and within 10%; at Run over 90%, over 80% and within 5%. The framework says plainly that Run everywhere isn't the goal: mature the capabilities that return the most value.

**FOCUS**, the FinOps Open Cost and Usage Specification, is the Foundation's open format for billing data, so that cost and usage from cloud providers, SaaS vendors and data centres can be read with the same columns. Version 1.4 was ratified in June 2026 and adds invoice and billing-period datasets and far more detail on commitments. Providers follow at their own pace: AWS Data Exports currently delivers FOCUS 1.2 (and 1.0), with a few AWS-specific columns.

**Unit economics** connects the spend with the value it produces. The framework's Unit Economics capability separates resource-efficiency metrics (cost per GB stored, per vCPU, per token) from business metrics (cost per transaction, per customer), and notes that the trend within a scope over time is usually more useful than any single number. Acme uses the **cost per 1,000 orders**: the monthly AWS bill divided by the orders that month, in thousands. Between January and July it rose from $3.25 to $4.10, which showed that cost was growing faster than the business before anyone looked at a single resource.

The standard book is *Cloud FinOps* by J.R. Storment and Mike Fuller, who lead the FinOps Foundation (O'Reilly, 2nd edition, 2023); its parts follow the Inform, Optimize and Operate phases.

## Putting it into practice

Acme's sequence, with AWS tools named as examples; other clouds and third-party platforms have equivalents.

1. **Agree on the allocation model.** Decide what costs are allocated to (for Acme, the six product teams and the platform team) and which tags carry it: `team`, `service` and `env`. AWS accounts are the coarsest and most reliable boundary, so production, staging and sandboxes live in separate accounts.
2. **Enforce tags where resources are created.** AWS Organizations tag policies standardise tag keys and values (no more `Checkout` beside `checkout`), and their *required tag keys* can warn about or block CloudFormation, Terraform and Pulumi deployments that leave a tag out. Tag policies don't report a resource that has no tags at all as non-compliant (AWS Resource Explorer can list them with the query `tag:none`), so the check belongs in the deployment path. In Kubernetes an admission policy, such as Kyverno's require-labels policy or OPA Gatekeeper, rejects pods without a `team` label. Platform templates and shared infrastructure modules should set the tags by default, so most teams never have to think about them.
3. **Activate the tags for billing.** User-defined tags appear in Cost Explorer and the cost and usage data only after they are activated as cost allocation tags in the management account; a new key can take up to 24 hours to appear and up to 24 more to activate. A backfill can apply the activation to as many as 12 earlier months, but only for the months in which the resources actually carried the tag, so tags added in July don't explain June. That is why Acme's first showback is for July.
4. **Split what is shared.** For EKS, split cost allocation data divides each node's cost among its pods by the CPU and memory they reserve or use, whichever is higher, spreads the node's unused capacity over the pods in proportion, and can import Kubernetes labels as cost allocation tags. OpenCost, a CNCF incubating project since October 2024, does similar allocation inside any Kubernetes cluster. For the rest of the shared bill (observability, CI/CD, support, data transfer), AWS Cost Categories can split a shared pool proportionally, by fixed percentages or evenly. Acme splits the platform's $38,800 in proportion to each team's direct cost, a rule written down with finance.
5. **Show back daily, where people already look.** Each team sees its own costs every day, in Cost Explorer views or a dashboard built on the CUR 2.0 or FOCUS export. **Showback** reports the costs; **chargeback** books them against the team's budget in the accounting system. The framework puts the difference in the formality of the accounting, and many organisations start with showback and add chargeback only when finance needs it.
6. **Track the unit cost.** Pick a measure of value the business already counts, such as orders, compute the cost per unit every month, and read it as a trend next to the bill.
7. **Watch for anomalies.** AWS Cost Anomaly Detection learns the spending pattern with machine learning and alerts by email or through an [SNS](../amazon-sns/) topic, which can feed a chat channel. A monitor can watch services, member accounts, cost allocation tags or cost categories, so each team can have its own. It runs about three times a day on data that can be up to 24 hours old, so it catches a runaway cost within a day, not within minutes: Acme's search team heard about debug logging left on after a release, worth $480 a day, the next morning.
8. **Optimise usage first.** Remove waste (idle clusters, unattached volumes, old snapshots); schedule non-production environments (the Well-Architected cost pillar's own example is a development environment used 40 of the week's 168 hours, which saves about 75% when it is stopped the rest of the time); rightsize, with AWS Compute Optimizer for instances, volumes and Lambda functions, and in Kubernetes with pod requests set from observed usage and a node autoscaler such as Karpenter that consolidates underused nodes; and move data that is rarely read to cheaper storage classes with S3 Lifecycle rules or S3 Intelligent-Tiering. Lifecycle transitions are charged per object and, by default, skip objects smaller than 128 KB, and the Glacier classes bill a minimum storage duration (90 days for Glacier Flexible Retrieval), so batch small log files before tiering them.
9. **Then optimise rates.** **Savings Plans** commit to a fixed amount of spend per hour for one or three years: Compute Savings Plans give up to 66% off on-demand prices and also cover Fargate and Lambda, EC2 Instance Savings Plans give up to 72% for one instance family in one Region, and Database and SageMaker AI Savings Plans cover those services. The terms can't be changed after purchase, which is why they come after rightsizing. **Spot** capacity sells spare EC2 capacity at up to 90% off on-demand, with a two-minute warning before an interruption, which suits CI runners and batch jobs that can restart. Following the framework, Acme's FinOps practitioner buys commitments centrally, together with finance.
10. **Operate the loop.** Give each team an AWS budget with alerts on actual and forecast spend (budgets refresh up to three times a day), hold a monthly review with engineering, finance and product, and ask for a cost estimate in every design review. Track the practice with a few numbers: the allocated share, commitment coverage and utilisation, forecast accuracy and the unit cost.

Acme's levers, as monthly savings at July's volume (the example's own numbers):

| Lever | Kind | Owner | Saving a month |
|---|---|---|---|
| Delete the idle `loadtest-2` cluster | usage: waste | checkout team | $7,400 |
| Rightsize the production nodes, 8 → 5, average CPU 12% → 40% | usage: rightsizing | platform team | $12,600 |
| Run staging 07:00–19:00 on weekdays only, 60 of 168 hours | usage: schedule | platform team | $5,800 |
| S3 Lifecycle: logs to S3 Glacier Flexible Retrieval after 30 days, deleted after a year | usage: storage class | platform team | $2,200 |
| One-year Compute Savings Plan, sized on the smaller baseline | rate: commitment | FinOps practitioner and finance | $10,000 |
| Spot for CI runners and the nightly catalog import | rate: interruptible capacity | platform and catalog teams | $3,000 |
| **Total** | | | **$41,000** |

The bill and the unit cost, again the example's own numbers:

| | January | June | July | September | November (forecast) |
|---|---|---|---|---|---|
| AWS bill | $80,000 | $130,000 | $132,800 | $98,600 | $121,000 |
| Orders | 24.6 M | 31.7 M | 32.4 M | 34.0 M | 43.2 M |
| Cost per 1,000 orders | $3.25 | $4.10 | $4.10 | $2.90 | $2.80 |

## Where it fits

- **[Well-Architected Framework](../well-architected-framework/).** The cost optimisation pillar's design principles (implement cloud financial management, adopt a consumption model, measure overall efficiency, stop spending money on undifferentiated heavy lifting, analyse and attribute expenditure) ask whether a workload's cost is understood and owned. A review finds the gaps in one workload; FinOps is the ongoing practice across the organisation that keeps them closed.
- **[Policy as code](../policy-as-code/)** is how the tagging rules are enforced: a check in the pipeline and an admission policy in the cluster, instead of a tagging campaign every quarter.
- **[Platform as a product](../platform-as-a-product/)**, **[golden paths](../golden-paths/)** and **[infrastructure as code](../infrastructure-as-code/).** The platform team owns the shared costs and the rule that splits them, its templates and modules apply the tags, and its golden path can show a new service's expected cost before it ships.
- **[Kubernetes](../kubernetes/)** and **[autoscaling](../autoscaling/).** Pod requests decide both scheduling and, with split cost allocation data, each team's share of the nodes, so inflated requests show up on the team's showback. Autoscaling is the consumption model at work: scale in when demand falls.
- **[Serverless](../serverless/)** and **[AWS Lambda](../aws-lambda/)** turn cost into a price per request, which makes unit costs easy to compute but also lets a busy or runaway function grow the bill without anyone provisioning anything. Compute Savings Plans also apply to Lambda.
- **[Amazon S3](../amazon-s3/)**: storage classes and lifecycle rules are the storage levers, and an unbounded log or backup bucket is a classic slow leak.
- **[Amazon CloudWatch](../amazon-cloudwatch/)**: log ingestion and custom metrics can grow quietly, as Acme's search logs did, and log retention settings are a usage lever.
- **[SLOs and error budgets](../slo-error-budgets/)** set the limit that cost cuts must respect: a saving that spends the error budget is not a saving.
- **[You build it, you run it](../you-build-it-you-run-it/)** extends naturally to *you pay for it*: the team that owns a service also sees and manages its cost.

## When to use it

- **It pays off when cloud spend is large, growing and shaped by many teams.** With 60 engineers and a bill of $130,000 a month, a few percent of waste pays for the practice, and only the teams themselves can fix their usage. Shared platforms such as Kubernetes, where costs are hidden until they are split, and consumption-priced services (serverless, data platforms, AI APIs) gain the most.
- **Start at Crawl when the organisation is small.** One team with a modest bill needs an owner tag, a budget alert and a monthly look at the bill, not a FinOps team or a tool purchase. The framework itself says to mature only the capabilities that return value.
- **Adapt it to fixed budgets and formal accounting.** Public-sector and regulated organisations often plan a year ahead and need chargeback that follows accounting rules; forecasting and budgeting matter more there, and commitments go through procurement.
- **Expect smaller returns on mostly fixed costs.** Data centres, enterprise licences and long contracts don't scale down by the hour; the framework's scopes cover them, but the levers are contracts and placement rather than rightsizing.
- **Spending more can be the right call.** An early product racing to find its market may rightly choose speed over efficiency; FinOps makes that a recorded decision rather than an accident.
- **It has its own costs:** keeping tags and allocation rules accurate, data pipelines and dashboards, a FinOps practitioner, and everyone's time in reviews.

## Common pitfalls

- **Cutting cost at the expense of reliability or value.** Moving checkout's pods to Spot, removing a database replica or dropping the logs an incident needs saves money until the next outage. Treat SLOs and product requirements as constraints, and let the team that owns the service make the trade-off with the numbers in front of it.
- **Chasing the total bill instead of the unit cost.** Acme's November bill is forecast 23% above September's because of peak season, while the cost per 1,000 orders falls to $2.80. A total that rises with the business is fine; judge efficiency by the unit cost and explain the variance against the forecast.
- **A central team doing FinOps *to* engineers instead of *with* them.** Spreadsheets mailed once a month and "cut 20% by Friday" tickets teach teams to argue rather than act. Put each team's data in the tools it already uses, let owners decide usage changes, and keep the central team for enablement, shared rules and rate decisions.
- **Over-committing to discounts.** A three-year plan sized on June's peak, bought before rightsizing, would have left commitment unused, and Savings Plan terms can't be changed after purchase. Optimise usage first, commit to the steady floor rather than the average, buy in smaller steps over time, and alert on falling utilisation and coverage (AWS Budgets can do both).
- **Shared costs nobody allocates.** When Acme's new data platform launched without a split rule, unallocated spend went from 4% back to 9%. Agree on the rule before a shared service goes live, and track the allocated share as a KPI: the framework's sample targets are at least 70% at Crawl, 85% at Walk and over 90% at Run.
- **Tagging after the fact.** Tagging campaigns on old resources rarely finish, and tags can't explain the months before they existed. Enforce tags at creation and fix the defaults in the templates.
- **Treating FinOps as a project.** A one-off clean-up saves money once; without budgets, alerts and the monthly review, the bill creeps back. Run the loop every month.
- **Counting savings instead of value.** A dashboard of savings achieved rewards cutting, not good decisions. Report the unit cost and the business outcome next to the savings.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Well-Architected Framework](../well-architected-framework/) — Review a workload against six pillars, from operational excellence to sustainability, and decide on the trade-offs between them.
- [Policy as Code](../policy-as-code/) — Write rules as code and check them automatically in CI and at deploy time, so guardrails replace manual approval gates.
- [Platform as a Product](../platform-as-a-product/) — An internal developer platform run like a product: developers are its customers, self-service is its interface, adoption is earned.
- [Autoscaling](../autoscaling/) — Add and remove instances automatically as load rises and falls.
- [Kubernetes](../kubernetes/) — A container orchestrator: you declare the desired state, and controllers keep pods scheduled, healthy and reachable.
- [Serverless (Functions)](../serverless/) — Functions start per event, scale out automatically and scale to zero when idle.
- [AWS Lambda](../aws-lambda/) — Functions as a service: code runs per event in managed execution environments that scale out with concurrency.
- [Amazon S3](../amazon-s3/) — Object storage: objects in buckets, addressed by key, stored across Availability Zones, with storage classes, versioning and events.
- [Amazon CloudWatch](../amazon-cloudwatch/) — Metrics, logs, alarms and dashboards for AWS resources and your applications, in one monitoring service.
- [SLOs & Error Budgets](../slo-error-budgets/) — Measure SLIs against an objective and alert on error-budget burn rate, not on every blip.

## References

- [FinOps Foundation — What is FinOps? (definition updated March 2026)](https://www.finops.org/introduction/what-is-finops/)
- [FinOps Foundation — FinOps Framework overview](https://www.finops.org/framework/)
- [FinOps Foundation — FinOps Principles](https://www.finops.org/framework/principles/)
- [FinOps Foundation — FinOps Phases: Inform, Optimize, Operate](https://www.finops.org/framework/phases/)
- [FinOps Foundation — FinOps Domains and their capabilities](https://www.finops.org/framework/domains/)
- [FinOps Foundation — FinOps Scopes](https://www.finops.org/framework/scopes/)
- [FinOps Foundation — FinOps Personas](https://www.finops.org/framework/personas/)
- [FinOps Foundation — FinOps Maturity Model (Crawl, Walk, Run)](https://www.finops.org/framework/maturity-model/)
- [FinOps Foundation — FinOps Framework 2026: the changes (March 2026)](https://www.finops.org/insights/2026-finops-framework/)
- [FinOps Framework capability — Unit Economics](https://www.finops.org/framework/capabilities/unit-economics/)
- [FinOps Framework capability — Invoicing & Chargeback (showback and chargeback)](https://www.finops.org/framework/capabilities/invoicing-chargeback/)
- [FinOps Foundation — About (a Linux Foundation project since June 2020)](https://www.finops.org/about/)
- [FOCUS — FinOps Open Cost and Usage Specification](https://focus.finops.org/)
- [FinOps Foundation — Introducing FOCUS 1.4 (June 2026)](https://www.finops.org/insights/introducing-focus-1-4/)
- [J.R. Storment and Mike Fuller — Cloud FinOps, 2nd edition (O’Reilly, 2023)](https://www.finops.org/community/finops-book/)
- [AWS Well-Architected Framework — Cost Optimization Pillar: design principles](https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/design-principles.html)
- [AWS Billing — Organizing and tracking costs using cost allocation tags](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-alloc-tags.html)
- [AWS Billing — Backfill cost allocation tags](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-allocation-backfill.html)
- [AWS Organizations — Tag policies](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_tag-policies.html)
- [AWS Organizations — Enforce “Required tag key” with IaC](https://docs.aws.amazon.com/organizations/latest/userguide/enforce-required-tag-keys-iac.html)
- [AWS Organizations — Report tagging compliance](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_tag-policies-report-tagging-compliance.html)
- [AWS Data Exports — Understanding split cost allocation data (ECS and EKS)](https://docs.aws.amazon.com/cur/latest/userguide/split-cost-allocation-data.html)
- [AWS Data Exports — Using Kubernetes labels for cost allocation in EKS](https://docs.aws.amazon.com/cur/latest/userguide/split-cost-allocation-data-kubernetes-labels.html)
- [AWS Billing — Splitting charges within cost categories](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/splitcharge-cost-categories.html)
- [AWS Data Exports — FOCUS 1.2 with AWS columns](https://docs.aws.amazon.com/cur/latest/userguide/table-dictionary-focus-1-2-aws.html)
- [AWS Cost Management — Detecting unusual spend with AWS Cost Anomaly Detection](https://docs.aws.amazon.com/cost-management/latest/userguide/manage-ad.html)
- [AWS Cost Management — Managing your costs with AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)
- [Savings Plans User Guide — Savings Plans types](https://docs.aws.amazon.com/savingsplans/latest/userguide/plan-types.html)
- [Amazon EC2 User Guide — Spot Instances](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-spot-instances.html)
- [AWS — Amazon EC2 Spot Instances (up to 90% off On-Demand prices)](https://aws.amazon.com/ec2/spot/)
- [AWS Compute Optimizer User Guide — What is AWS Compute Optimizer?](https://docs.aws.amazon.com/compute-optimizer/latest/ug/what-is-compute-optimizer.html)
- [Amazon S3 User Guide — Transitioning objects using S3 Lifecycle](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-transition-general-considerations.html)
- [CNCF — OpenCost (incubating since October 2024)](https://www.cncf.io/projects/opencost/)
- [Kyverno — Require Labels policy](https://kyverno.io/policies/best-practices/require-labels/require-labels/)
- [Karpenter — Disruption (consolidation)](https://karpenter.sh/docs/concepts/disruption/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
