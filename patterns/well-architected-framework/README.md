<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🏗️ Platform Engineering](../../README.md#platform-engineering)

# Well-Architected Framework

> Review a workload against six pillars, from operational excellence to sustainability, and decide on the trade-offs between them.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Well-Architected Framework" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/well-architected-framework.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Risks found by surprise** | Acme Shop's checkout runs on AWS: an Application Load Balancer, the checkout and payments services on a shared EKS cluster, SQS, S3 and an Aurora PostgreSQL database with a single instance. Nobody keeps a list of risks, so they surface the hard way: on 15 November an impaired Availability Zone takes checkout down for 52 minutes while a new database instance is created by hand, in December an audit finds an administrator's three-year-old access key on a laptop, and January's bill is up 18% with 40% of the nodes idle at night. Each team fixes its own part, and nobody asks what else is waiting. |
| **2 · Six pillars, one workload** | In March the checkout team, the platform team and an AWS solutions architect spend two half-days on the framework's questions, pillar by pillar: a conversation, not an audit. An answer that misses a best practice turns that question into a risk: a single database instance in one zone (**reliability**, REL 10) and a long-lived access key (**security**, SEC 2) are high risks, while no runbooks (**operational excellence**), sizes picked by guess (**performance efficiency**), no cost tags (**cost optimization**) and oversized nodes (**sustainability**) are medium. Across all 57 questions the review finds 7 high and 12 medium risks. |
| **3 · From review to milestone** | The AWS Well-Architected Tool records the answers and lists the risks as an improvement plan; the team starts with the high risks, gives each item an owner and a month, and syncs the items to Jira. Lenses add questions for particular kinds of workload: Acme adds the Container Build lens, and the catalog also has lenses such as Serverless Applications and SaaS. Fix by fix the plan lands, from SSO with MFA instead of access keys in April to node autoscaling in August, and the milestone saved on 15 September shows high risks down from 7 to 2 and medium risks from 12 to 5 (the example's own numbers). |
| **4 · Trade-offs and limits** | The pillars pull against each other: the Aurora reader buys a failover in under a minute for $201 a month (a `db.r7g.large` in us-east-1) and one more instance running all day, so the team decides on purpose, writes it down in ADR-031 and keeps staging on one instance. AWS's guidance is that security and operational excellence are generally not traded away, so the extra SSO sign-in step stays. The framework has limits: it asks questions but doesn't design the system, its best practices are written for AWS services, a review becomes box-ticking if nothing follows, and Azure and Google Cloud publish their own Well-Architected frameworks, with five and six pillars. |
<!-- END GENERATED: header -->

## The problem

A cloud workload is the sum of hundreds of small decisions: how many instances, in which zones, who holds which credentials, what gets tagged, what the on-call engineer does at 2 a.m. Different people make them at different times, usually under a deadline, and nobody checks them against the same list. The gaps stay invisible until they cost something. Acme Shop's checkout database ran as a single instance, so when one Availability Zone was impaired in November, checkout was down for 52 minutes while someone created a new instance by hand. In December an audit found an administrator's access key that had been valid for three years, and January's bill rose 18% with 40% of the cluster's nodes idle every night.

Each surprise was handled by whoever it hit. The database team wrote a rebuild script, IT security rotated the key (and so issued another long-lived one), and finance asked every team to cut 10%. Every fix was local, so nobody asked the next question: what else in this workload looks like that? Without a shared yardstick a team can't say how ready a workload is, can't compare it with last year or with the team next door, and can't tell which of fifty possible improvements matter most. The reviews that do happen depend on who is in the room and what they happen to know.

## How it works

The **AWS Well-Architected Framework** is AWS's written answer to that problem: design principles, questions and best practices for judging a workload, distilled from what AWS solutions architects saw in many customer reviews. AWS first published it as a whitepaper in October 2015. Operational excellence joined the original pillars in November 2016 and moved to the front a year later, the free **AWS Well-Architected Tool** arrived at re:Invent in November 2018 to run reviews in the AWS console, and the sustainability pillar was announced at re:Invent in December 2021. The version current in October 2026 is dated 6 November 2024; the framework's document history lists every update. AWS describes a review as a constructive conversation about architectural decisions, not an audit, and the framework as a way to see the pros and cons of those decisions.

### Six pillars

Each pillar has its own whitepaper, design principles and questions. In brief (paraphrased; the question counts are from the November 2024 version, 57 questions in all):

| Pillar | What it covers | Some of its design principles | Questions | Acme's question in the diagram |
|---|---|---|---|---|
| Operational excellence | Running the workload well, seeing how it behaves, and improving how it is run | organise teams around business outcomes; build in observability; automate where it is safe; make frequent, small, reversible changes; expect failure and learn from every operational event | 11 | OPS 7, whether the team is ready to support the workload: no runbooks |
| Security | Protecting data, systems and assets | a strong identity foundation with least privilege and no long-lived credentials; traceability; security at every layer, automated; data protected in transit and at rest; keeping people away from data; preparing for security events | 11 | SEC 2, how people and machines authenticate: a three-year-old access key |
| Reliability | Doing the intended job correctly and consistently, through the whole lifecycle | recover from failure automatically; test the recovery procedures; scale horizontally so one failure matters less; stop guessing capacity; change through automation | 13 | REL 10, fault isolation: one database instance in one zone |
| Performance efficiency | Using resources efficiently as demand and technology change | consume advanced technology as a service; go global in minutes; use serverless architectures; experiment often; choose technology that fits how the workload uses it (*mechanical sympathy*) | 5 | PERF 1, how resources are chosen: by guess, never benchmarked |
| Cost optimization | Getting the business value the workload exists for, for as little money as possible | build cloud financial management as a capability; pay only for what you use; measure output per unit of cost; stop paying for undifferentiated work; attribute spending to the workload owners | 11 | COST 3, how cost and usage are monitored: no cost allocation tags |
| Sustainability | Reducing the environmental impact of running the workload | understand your impact; set goals; maximise utilisation; adopt more efficient hardware and software; use managed services; reduce the impact on customers' devices and downstream systems | 6 | SUS 5, how hardware is chosen: nodes at 18% average CPU |

The framework adds general principles for any cloud design: stop guessing capacity, test at production scale, automate so that experiments are cheap, let the architecture evolve, decide with data, and rehearse failures in game days.

### What a review produces

Each question lists the best practices that answer it, about 300 across the six pillars, each with an ID such as `REL10-BP01` (deploy the workload to multiple locations). Every best practice states the **level of risk** a team carries without it: high, medium or low. The Tool turns the practices a team selects into one risk level per question, through rules attached to the question: broadly, a question missing a foundational practice becomes a **high risk**, one missing an enabling practice a **medium risk**, and one with neither carries no risk. AWS describes a high risk issue (HRI) as a choice that could seriously harm the business, and a medium risk issue (MRI) as one that harms it less. The levels differ between pillars: a missing load test is a low risk in the performance efficiency pillar (`PERF05-BP04`), while not testing scalability and performance requirements is a high one in reliability (`REL12-BP03`). Best practices that don't apply to a workload can be marked as not applicable. The result is not a score but a list: which questions carry risk, and why.

### How a review runs

AWS's guidance is that a review should be light (hours, not days), blame-free, and done by the people who build and run the workload. Ideally it is continuous: the team updates its answers as the architecture changes, rather than holding one formal meeting. The important moments are early in design, before decisions that are hard to reverse (AWS calls them *one-way doors*), before go-live, and after any significant change. For a one-off or independent review, AWS suggests a few informal conversations to gather most answers, followed by one or two meetings on the unclear or risky areas, with the right people present. AWS solutions architects and members of the AWS Well-Architected Partner Program run reviews with customers.

The Tool's user guide gained a section on running a Well-Architected Framework Review (WAFR) in October 2025. Its advice, paraphrased: agree beforehand who leads, who shares the screen, who takes notes, which pillars come in which order and how long each gets; restate at the start that nobody is being judged; write notes with context, because ticked boxes mean little to whoever opens the review at the next milestone; capture facts about the workload rather than designing fixes in the room; and talk about the architecture, not the tool.

### From risks to improvements

The Tool lists the questions with high and medium risk as an **improvement plan**, each linked to the best practices that would remove it. AWS advises against tackling every risk at once: weigh each fix by its value to the business against its effort (for example on an Eisenhower-style chart), give it a specific, measurable goal and one owner, prefer simple and reversible solutions, and feed the items into the team's backlog and retrospectives. It suggests 90 to 180 days for this phase. A connector, added in April 2024, syncs improvement items to Jira. A **milestone** saves the state of the review at a point in time, so the team saves one when the first review is complete and again after improvements, and compares them.

Other features help at scale. A **profile** records the business context and goals so the Tool can prioritise the questions and risks that matter most; a **review template** pre-fills the answers that are the same across many workloads (a shared platform, say); Trusted Advisor checks can appear next to the questions they inform; and a dashboard shows high and medium risks by pillar across all workloads.

### Lenses

A **lens** adds its own questions, best practices and improvement plan to a review. The Well-Architected Framework lens is applied to every workload; the Lens Catalog in the Tool offered these AWS lenses in October 2026: Connected Mobility, Container Build, Data Analytics, DevOps, Financial Services Industry, Generative AI, Government, Healthcare Industry, IoT, Machine Learning, Mergers and Acquisitions, Migration, SaaS, SAP and Serverless Applications. Organisations can also write **custom lenses** in JSON, with their own pillars, questions, best practices and risk rules, and share them between accounts. Acme reviewed checkout with the Framework and Container Build lenses, and its platform team keeps a custom lens for its own standards.

On 1 October 2026 AWS added the **AWS Well-Architected Agent** in preview. It analyses an AWS environment every week, ranks recommendations on cost, security, performance and resilience against goals the team sets, shows each recommendation's trade-offs, generates remediation runbooks, and reviews CloudFormation and Terraform templates on demand. It requires a Business+, Enterprise On-Ramp, Enterprise or Unified Operations support plan. It works from the resources, templates and goals it is given and can't see how the team operates, decides and responds, so treat its findings as input to a review rather than the review itself.

### Trade-offs between pillars

The pillars pull against each other, and the framework doesn't settle the conflicts: the business context does. AWS's own examples are a development environment that gives up some reliability to save cost and carbon, a mission-critical workload that pays more for reliability, and e-commerce, where performance affects revenue. Security and operational excellence, AWS adds, are generally not traded against the other pillars. In practice:

- **Reliability against cost and sustainability.** Acme's fix for REL 10 is an Aurora reader in a second zone. With a reader, Aurora fails over by promoting it, usually within 60 seconds and often within 30; without one, it recreates the instance, which typically takes under 10 minutes, and after a whole-zone outage someone has to create an instance in another zone by hand. The reader is a second `db.r7g.large`: $0.276 an hour for Aurora [PostgreSQL](../postgresql/) in us-east-1 (on-demand, October 2026), about $201 a month, plus one more instance powered all day. The team accepts that for production checkout and keeps staging on one instance, where a restore from backup is fast enough.
- **Performance against cost.** Spare capacity for a sale keeps checkout fast but is paid for every idle hour; autoscaling and a load test before each sale buy the same safety for less, at the price of the engineering work.
- **Security and convenience.** Signing in through IAM Identity Center with MFA, with role sessions of one hour (the default for a permission set; up to 12 hours is allowed), adds a step to every administrator's day. That is the cost of doing security, not a reason to trade it away, so the step stays.
- **Cost and sustainability usually agree.** Scaling nodes in at night and right-sizing them cut the bill and the hardware together, which is why Acme's autoscaling fix shows up in both pillars.

Microsoft's framework documents these tensions pillar by pillar; its reliability trade-offs page, for example, notes that extra redundancy also widens the attack surface the security pillar wants small. Whatever the decision, write it down where the next reviewer will find it: in the review's notes, and for a lasting choice in an architecture decision record, as Acme did with ADR-031. A risk accepted on purpose, with its reason and a date to revisit it, is a decision; a risk nobody looked at is a surprise waiting to happen.

### Azure and Google Cloud

The other large clouds publish frameworks of the same name and shape (as of October 2026):

| | AWS Well-Architected Framework | Azure Well-Architected Framework | Google Cloud Well-Architected Framework |
|---|---|---|---|
| Pillars | 6: operational excellence, security, reliability, performance efficiency, cost optimization, sustainability | 5: reliability, security, cost optimization, operational excellence, performance efficiency | 6: operational excellence; security, privacy, and compliance; reliability; cost optimization; performance optimization; sustainability |
| Sustainability | a pillar since December 2021 | workload guidance, not a pillar | a full pillar since January 2026 |
| Review support | the Well-Architected Tool (free): questions, high and medium risks, improvement plans, milestones | the Azure Well-Architected Review (free): questionnaires tied to each pillar's checklist, scored across runs | recommendations per pillar in the documentation |
| Beyond the pillars | lenses, custom lenses, review templates, the Well-Architected Agent (preview) | design review checklists, trade-off pages and maturity models per pillar, workload guidance (AI, SaaS, mission-critical, HPC, Microsoft Fabric), service guides | core principles (design for change, document the architecture, simplify, decouple, stay stateless), cross-pillar perspectives for AI and ML and for financial services, deployment archetypes |

Google's framework was called the Google Cloud Architecture Framework until it took the Well-Architected name. The three cover the same ground with different emphasis: Google folds privacy and compliance into its security pillar, and Microsoft scores reviews where AWS counts risks.

### On any cloud

Most questions are provider-neutral even where the best practices name AWS services: how faults are isolated, how people and machines authenticate, how cost is attributed, how the team knows it is ready to operate a workload. A team on another cloud, on premises or across several can use them as a structured checklist. Keep the six pillars, translate the practices (an Availability Zone becomes whatever independent failure domain the platform offers; IAM Identity Center becomes the company's identity provider issuing short-lived credentials), rate each question high, medium or no risk, and keep the dated improvement list and milestones in a spreadsheet or the issue tracker. A team that runs mostly on one provider is usually better served by that provider's framework, whose practices name the services it actually uses.

## Putting it into practice

1. **Pick one workload and the people who run it.** A workload is a set of components that together deliver business value, such as checkout, from the load balancer to the database, including its pipeline and on-call. Invite the team that builds and runs it, the platform team that owns the shared parts, and a facilitator who knows the framework (Acme asked its AWS solutions architect).
2. **Prepare.** Collect the architecture diagram, the dashboards, the last few incidents and the bill by service. Define the workload in the Tool, apply the lenses that fit and, if the organisation has them, a profile and a review template. Send the questions round in advance so that answers needing research (*is the backup encrypted?*) are found before the meeting.
3. **Run the review in sessions.** Acme used two half-days, 10 and 11 March 2026, pillar by pillar. Answer honestly, mark what doesn't apply, write notes with the reasons, and park ideas for fixes for later.
4. **Read the risks.** Checkout came out with 7 high and 12 medium risks across the 57 questions.
5. **Plan.** Start with high risks that are cheap to fix; give each item an owner and a month; move the items into the team's backlog (Acme syncs them to Jira) and review progress in retrospectives.
6. **Save milestones and review again.** Save one after the review and after each batch of fixes; re-review after big changes and at least once a year for an important workload. Acme's next review is in March 2027.
7. **Turn repeated answers into mechanisms.** When the same gap shows up in workload after workload, fix it once in the platform: a tag policy, an account structure, a pipeline step or a golden path, so that the answer is right by default. AWS describes its own approach the same way: every team owns its architecture, and experts and automated checks keep the standard.

Acme's high risks, from the first review to the milestone of 15 September 2026 (the example's own story):

| Question | Finding in March | Improvement | Owner | By the milestone |
|---|---|---|---|---|
| SEC 2 · authentication | an administrator's IAM access key, three years old, on a laptop | IAM Identity Center with MFA and one-hour role sessions; access keys deleted | platform team | done in April |
| REL 10 · fault isolation | one Aurora instance, in AZ a only | an Aurora reader in AZ b, first in the promotion order (tier 0) | checkout team | done in May |
| REL 13 · disaster recovery | no recovery time or recovery point objective | objectives agreed with the business, checked by a restore drill | SRE group | done in June |
| REL 12 · testing reliability | never load-tested | a load test at three times the last peak before each sale | checkout team | done in July |
| PERF 2 · compute | a fixed node count, sized for the peak | node autoscaling for the checkout node group | platform team | done in August |
| COST 1 · cloud financial management | nobody owns checkout's cost | a named cost owner and a monthly cost review | checkout team | open |
| SEC 1 · operating securely | production and staging in one AWS account | one account per environment | platform team | planned for Q1 2027 |

Of the 12 medium risks, 7 were fixed by the milestone, among them a runbook for Aurora failover, rehearsed in a game day (OPS 7), cost allocation tags with split cost allocation data for the shared EKS cluster (COST 3), and benchmarks in the pipeline (PERF 1). Right-sizing the nodes (SUS 5) was still in progress. High risks went from 7 to 2 and medium risks from 12 to 5.

## Where it fits

- **[Disaster recovery strategies](../disaster-recovery-strategies/)** and **[multi-region active-active](../multi-region-active-active/)** answer REL 13 and the harder half of REL 10: what to do when a whole Region, not a zone, fails, and what recovery time and data loss the business accepts.
- **[Amazon RDS & Aurora](../amazon-rds-aurora/)** covers the mechanism behind Acme's main fix: readers in other zones as failover targets and the cluster volume that keeps six copies of the data across three zones.
- **[Autoscaling](../autoscaling/)** is how PERF 2 and the sustainability pillar's advice to match resources to demand turn into practice, and why the idle nodes at night disappeared.
- **[AWS IAM](../aws-iam/)** and **[zero trust access](../zero-trust-access/)** are what SEC 2 and SEC 3 ask about: identities from an identity provider, temporary credentials and least privilege checked on every request.
- **[SLOs and error budgets](../slo-error-budgets/)** give the reliability pillar a target to design against, and **[Amazon CloudWatch](../amazon-cloudwatch/)** supplies the observability the operational excellence and reliability questions assume.
- **[Chaos engineering](../chaos-engineering/)** is the reliability pillar's advice to test recovery and run game days; **[incident management](../incident-management/)** and **[blameless postmortems](../blameless-postmortems/)** are how operational excellence learns from every event, in the same blame-free spirit the review asks for.
- **[Cell-based architecture](../cell-based-architecture/)** goes one step further than spreading over zones: the framework's bulkhead practice (`REL10-BP03`) limits how many customers one failure can reach.
- **[Infrastructure as code](../infrastructure-as-code/)** and **[golden paths](../golden-paths/)** are the mechanisms that make good answers the default for every new workload. [Policy as code](../policy-as-code/), a page in this category still to come, checks them on every change.
- **[FinOps](../finops/)** is the cost practice in depth: allocating spend to the teams that cause it, tracking the cost per unit of value, and the habits of a cost-aware organisation. The cost pillar asks whether those habits exist; FinOps is how to build them.
- **[DORA metrics](../dora-metrics/)** measure software delivery, which the framework covers mainly in two operational excellence questions (OPS 5 on the flow into production, OPS 6 on deployment risk) and in its DevOps lens; Google's framework cites DORA's research in its core principles.

## When to use it

- **A workload in production or about to launch on AWS.** The questions find the single points of failure, long-lived credentials and unowned costs that a team stops seeing, and the improvement plan gives the fixes an order. Before a major launch or a peak season is when a review pays off most.
- **Early in a design.** Choosing a database, an account structure or a Region strategy is hard to undo, so asking the relevant questions before building is cheaper than finding the answers in production.
- **Many workloads, one platform.** The dashboard, profiles, review templates and custom lenses turn individual reviews into a portfolio view, and repeated findings show the platform team what to fix once for everyone.
- **A common language.** Pillar names, question IDs and the high/medium vocabulary give teams, auditors, AWS and partners the same words for the same risks.
- **Lighter for small or short-lived systems.** A prototype or an internal tool used by five people doesn't need two half-days: pick the questions on security and data, and come back if it grows.
- **Not a compliance framework.** A review records risks against AWS's best practices; it is neither an audit nor a certification, so it doesn't replace the controls and evidence of a standard such as SOC 2, ISO 27001 or PCI DSS, although many findings overlap with them. Regulated teams map the two and keep both.
- **Not a design method.** The framework asks whether a workload isolates faults; it doesn't choose a pattern for a given workload, model threats or size a database. Those remain design work, informed by the review's questions.
- **Other clouds and legacy systems.** Outside AWS, use the provider's own framework or the questions as a neutral checklist, as above. For legacy systems that can't change much, the honest outcome may be risks accepted with mitigations, which is still better than risks nobody wrote down.

## Common pitfalls

- **A one-off review with no follow-up.** Answers go stale within months and the improvement plan becomes a document nobody opens. Give every item an owner and a date, put the items in the backlog, save milestones, and review again after big changes or yearly.
- **Treating every finding as mandatory.** Not every best practice is worth its cost for every workload, and AWS itself advises against fixing everything at once. Prioritise by business impact and effort, mark what doesn't apply, and accept the remaining risks on purpose, with the reason written down.
- **Reviewing too late.** A review a week after launch can only list regrets. Hold the first one in design, while the hard-to-reverse choices are still open, and another before go-live.
- **Reviewing alone.** An architect who fills in the Tool from documents answers what the system should do, not what it does. The people who build, deploy and get paged for the workload know where the runbook is missing; invite them, and keep it blame-free so they say so.
- **Box-ticking.** Selecting best practices without notes, or to make a risk disappear, produces a clean dashboard and an unchanged workload. Write down the evidence behind each answer; a reviewer at the next milestone should be able to check it.
- **Using risk counts as a target.** A count of high risks per team, ranked on a slide, invites answers that hide risk instead of removing it. Compare a workload with its own past, and discuss the risks themselves.
- **Forgetting the trade-offs.** Fixing one pillar can quietly cost another: the reader that bought checkout its fast failover also costs $201 a month and runs all day. Look at the other pillars before adopting a fix, and record the decision.
- **Taking AWS's answers as universal.** The best practices name AWS services and features. On another cloud, or with a different operating model, translate the intent of each practice instead of copying its wording.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [FinOps](../finops/) — Cloud cost as a shared responsibility: allocate spend to the teams that cause it, optimise it and track the cost per unit of value.
- [Disaster Recovery Strategies](../disaster-recovery-strategies/) — Backup & restore, pilot light, warm standby, active-active: trading cost against RTO and RPO.
- [Multi-Region Active-Active](../multi-region-active-active/) — Serve users from several regions at once and shift traffic away from a region that fails.
- [Autoscaling](../autoscaling/) — Add and remove instances automatically as load rises and falls.
- [Zero Trust Access](../zero-trust-access/) — No implicit trust from network location: verify identity, device and context on every request.
- [SLOs & Error Budgets](../slo-error-budgets/) — Measure SLIs against an objective and alert on error-budget burn rate, not on every blip.
- [AWS IAM](../aws-iam/) — Who may do what in AWS: principals, policies and roles that hand out temporary credentials, and how a request is evaluated.
- [Amazon RDS & Aurora](../amazon-rds-aurora/) — Managed relational databases: backups, Multi-AZ failover and read replicas, and Aurora's storage shared across three zones.

## References

- [AWS — AWS Well-Architected Framework (whitepaper, 6 November 2024)](https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html)
- [AWS Well-Architected Framework — The pillars of the framework](https://docs.aws.amazon.com/wellarchitected/latest/framework/the-pillars-of-the-framework.html)
- [AWS Well-Architected Framework — Definitions (pillars and trade-offs)](https://docs.aws.amazon.com/wellarchitected/latest/framework/definitions.html)
- [AWS Well-Architected Framework — General design principles](https://docs.aws.amazon.com/wellarchitected/latest/framework/general-design-principles.html)
- [AWS Well-Architected Framework — The review process](https://docs.aws.amazon.com/wellarchitected/latest/framework/the-review-process.html)
- [AWS Well-Architected Framework — On architecture](https://docs.aws.amazon.com/wellarchitected/latest/framework/on-architecture.html)
- [AWS Well-Architected Framework — Appendix: Questions and best practices](https://docs.aws.amazon.com/wellarchitected/latest/framework/appendix.html)
- [AWS Well-Architected Framework — Document revisions](https://docs.aws.amazon.com/wellarchitected/latest/framework/document-revisions.html)
- [AWS Well-Architected Framework — REL10-BP01 Deploy the workload to multiple locations](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_fault_isolation_multiaz_region_system.html)
- [AWS Well-Architected Framework — SEC02-BP02 Use temporary credentials](https://docs.aws.amazon.com/wellarchitected/latest/framework/sec_identities_unique.html)
- [AWS Well-Architected Tool User Guide — Well-Architected Framework Review (WAFR)](https://docs.aws.amazon.com/wellarchitected/latest/userguide/wa-framework-review.html)
- [AWS Well-Architected Tool User Guide — Identify and understand risks](https://docs.aws.amazon.com/wellarchitected/latest/userguide/identify-and-understand-risks.html)
- [AWS Well-Architected Tool User Guide — Prioritize improvements](https://docs.aws.amazon.com/wellarchitected/latest/userguide/prioritize-improvements.html)
- [AWS Well-Architected Tool User Guide — Implement and track improvements](https://docs.aws.amazon.com/wellarchitected/latest/userguide/implement-and-track-improvements.html)
- [AWS Well-Architected Tool User Guide — Milestones](https://docs.aws.amazon.com/wellarchitected/latest/userguide/milestones.html)
- [AWS Well-Architected Tool User Guide — Using lenses](https://docs.aws.amazon.com/wellarchitected/latest/userguide/lenses.html)
- [AWS Well-Architected Tool User Guide — Lens Catalog](https://docs.aws.amazon.com/wellarchitected/latest/userguide/lens-catalog.html)
- [AWS Well-Architected Tool User Guide — Lens format specification (risk rules)](https://docs.aws.amazon.com/wellarchitected/latest/userguide/lenses-format-specification.html)
- [AWS Well-Architected User Guide — Release notes (Well-Architected Agent preview, October 2026)](https://docs.aws.amazon.com/wellarchitected/latest/userguide/release-notes.html)
- [AWS News Blog — New: AWS Well-Architected Tool (Jeff Barr, November 2018)](https://aws.amazon.com/blogs/aws/new-aws-well-architected-tool-review-workloads-against-best-practices/)
- [AWS News Blog — New: Sustainability Pillar for AWS Well-Architected Framework (Alex Casalboni, December 2021)](https://aws.amazon.com/blogs/aws/sustainability-pillar-well-architected-framework/)
- [Amazon Aurora User Guide — High availability for Amazon Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.AuroraHighAvailability.html)
- [Amazon Aurora pricing](https://aws.amazon.com/rds/aurora/pricing/)
- [AWS IAM Identity Center User Guide — Set session duration for AWS accounts](https://docs.aws.amazon.com/singlesignon/latest/userguide/howtosessionduration.html)
- [AWS Data Exports User Guide — Understanding split cost allocation data](https://docs.aws.amazon.com/cur/latest/userguide/split-cost-allocation-data.html)
- [Microsoft Learn — Azure Well-Architected Framework pillars](https://learn.microsoft.com/en-us/azure/well-architected/pillars)
- [Microsoft Learn — Azure Well-Architected Framework: Reliability tradeoffs](https://learn.microsoft.com/en-us/azure/well-architected/reliability/tradeoffs)
- [Microsoft Learn — Azure Well-Architected Review](https://learn.microsoft.com/en-us/assessments/azure-architecture-review/)
- [Google Cloud — Google Cloud Well-Architected Framework](https://cloud.google.com/architecture/framework)
- [Google Cloud — What’s new in the Well-Architected Framework](https://cloud.google.com/architecture/framework/whats-new)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
