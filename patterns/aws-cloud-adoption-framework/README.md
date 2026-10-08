<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔄 Migration & Modernization](../../README.md#migration--modernization)

# AWS Cloud Adoption Framework (CAF)

> Six perspectives and their foundational capabilities that show what an organisation must build, beyond technology, to adopt the cloud.

<p align="center"><img src="diagram.svg" alt="Animated diagram: AWS Cloud Adoption Framework (CAF)" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/aws-cloud-adoption-framework.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · A technology-only plan** | Acme Shop's back office still runs in its own data centre in Bangkok: about **120 workloads**, a **40-person IT team** and a lease that ends in **18 months**. Leadership wants to leave before the lease ends, cut infrastructure cost by about 20% and ship back-office changes faster, but plan v1 only moves the servers into one AWS account by Q4. Nobody owns the business case, 3 of the 40 know AWS, there are no budgets, the new account has one shared admin login and alerts would still page the data-centre team. (Acme's numbers are the example's own.) |
| **2 · Six perspectives applied** | The **AWS Cloud Adoption Framework** (CAF 3.0, 2021) groups 47 **foundational capabilities** into six **perspectives**, each looked after by its own stakeholders: business, people and governance on the business side, platform, security and operations on the technical side. Acme rates the 12 capabilities that matter for leaving the data centre on a 1-to-5 scale of its own, since the framework names capabilities but prescribes no score. The average is 1.5, and every perspective shows a gap, from a business case with no owner to alerts that still page the data-centre team. |
| **3 · The journey in practice** | CAF's journey runs **envision, align, launch, scale**, and then starts again. Envision turns the goals into outcomes (leave within 18 months, about 20% lower infrastructure cost, faster changes); align runs six workshops, one per perspective, that turn the gaps into 24 actions, each with an owner; launch sets up a **cloud centre of excellence**, a landing zone with guardrails and a pilot of five workloads, after which Acme's readiness averages 3.1. Scale moves the remaining workloads in waves, the subject of [AWS Migration Process](../aws-migration-process/), and rechecks readiness every quarter. |
| **4 · Pitfalls and limits** | The usual pitfalls: a readiness report with no owners, so nothing changes; skipping the **people** and **governance** perspectives, so the servers move but nobody can run them or watches the bill; and taking CAF for a design method (that is the [Well-Architected Framework](../well-architected-framework/)) or for the migration plan itself (that is the [migration process](../aws-migration-process/)). CAF is also AWS's own vocabulary: Microsoft's Cloud Adoption Framework (strategy, plan, ready, adopt, govern, secure, manage) and the Google Cloud Adoption Framework (learn, lead, scale, secure) cover similar ground with other names. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's online shop already runs on AWS, in containers on Kubernetes, built by product teams and run on the platform team's Launchpad. Its back office does not. Order handling, inventory, the product catalog that feeds the shop, a self-hosted CRM, a VMware cluster, a mainframe and a reporting tool nobody uses still sit in Acme's own data centre in Bangkok: about 120 workloads, looked after by an IT team of 40 people. The lease on the building ends in 18 months. Leadership has set three goals: leave the data centre before the lease ends, cut infrastructure cost by about 20%, and ship back-office changes faster. (Acme's numbers on this page are the example's own, not research findings.)

The first plan comes from the infrastructure team and is purely technical: inventory the servers, set up a VPN and an AWS account, copy the virtual machines across, then cut over and close the data centre by Q4. It answers the first goal and neither of the others, and it leaves most of what a move needs without an owner:

- Nobody owns the business case, so nobody can say what the move costs or whether the 20% is reachable.
- Three of the 40 people in IT know AWS. There is no training plan and no decision about how their jobs change once there is no hardware to look after.
- There are no budgets and no cost allocation tags, and nobody will compare the bill with the target.
- Every server goes into one AWS account with a shared administrator login and no multi-factor authentication.
- Monitoring and on-call stay as they are, so an alert from a migrated system still pages the data-centre team, who can no longer touch the hardware it runs on.

None of these is a technology problem, which is why a technology plan doesn't find them. The **AWS Cloud Adoption Framework** (AWS CAF) is AWS's map of everything else: what an organisation has to be able to do, beyond moving servers, to get the value it expects from the cloud.

## How it works

**What the framework is.** The current version, often called CAF 3.0, is the AWS whitepaper *An Overview of the AWS Cloud Adoption Framework*, published on 22 November 2021 as the framework's third edition (the first two appeared in 2015 and 2017); AWS reviewed it in February 2023 and changed nothing. The 2021 edition expanded the capabilities and added the transformation domains and the journey phases described below. AWS offers it for three jobs: finding and ranking transformation opportunities, measuring and improving an organisation's cloud readiness, and evolving the transformation roadmap step by step.

**From capabilities to outcomes.** The framework draws a value chain from left to right. Foundational capabilities make change possible in four *transformation domains*, and each domain enables the next:

- **Technology**: migrating and modernising infrastructure, applications, and data and analytics platforms.
- **Process**: digitising, automating and optimising the way the business operates.
- **Organization**: changing the operating model, for example teams organised around products and value streams that work in short iterations.
- **Product**: new value propositions and revenue models.

The changes lead to four *business outcomes*: lower business risk, better environmental, social and governance (ESG) performance, more revenue and higher operational efficiency. Acme's goals fit the chain. Leaving the data centre is a technology change that removes the risk of the lease running out, the 20% saving is operational efficiency, and faster back-office changes need process and organisation changes as well as new infrastructure.

**Six perspectives, 47 foundational capabilities.** In CAF's terms a capability is an organisation's ability to use processes and resources (people, technology and other assets) to reach an outcome. The framework groups 47 of them into six *perspectives*, and the capabilities in each perspective belong to one group of related stakeholders, who own or manage them. The 2017 edition said that the business, people and governance perspectives mostly concern business capabilities and the platform, security and operations perspectives technical ones; the 2021 edition keeps the same six perspectives, and its stakeholder lists divide the same way.

| Perspective | What it looks after | Typical stakeholders | Capabilities | A few of them, in short |
|---|---|---|---|---|
| **Business** | That cloud spending serves the business strategy and its outcomes | CEO, CFO, COO, CIO, CTO | 8 | *Strategy management*: how the cloud supports long-term goals. *Portfolio management*: rank the cloud initiatives, and use discovery tools and the 7 Rs to sort the application portfolio and build a business case on data. Also product management, innovation management, strategic partnership, data monetisation, business insights and data science |
| **People** | Culture, organisation structure, leadership and the workforce | CIO, COO, CTO, cloud director, cross-functional leaders | 7 | *Cloud fluency*: assess current skills, then train for the gaps, with certifications and communities of practice. *Workforce transformation*: redesign roles, close skill gaps, bring in partners where needed. *Transformational leadership*: visible sponsors on both the business and the technology side, and a transformation office or a cloud centre of excellence (CCoE). Also culture evolution, change acceleration, organisation design and organisational alignment |
| **Governance** | Coordinating the work so that the benefits come and the transformation's risks stay small | Chief transformation officer, CIO, CTO, CFO, chief data officer, chief risk officer | 7 | *Cloud financial management*: accounts and tags that map spend to teams, budgets and forecasts, showback or chargeback, guardrails on usage. *Benefits management*: state the expected benefits as metrics, measure them regularly and adjust. Also program and project management, risk management, application portfolio management, data governance and data curation |
| **Platform** | A scalable, enterprise-grade, hybrid cloud environment, and the workloads modernised or built on it | CTO, technology leaders, architects, engineers | 7 | *Platform architecture*: standards, blueprints and guardrails. *Platform engineering*: a compliant multi-account environment with automated account provisioning, preventive and detective guardrails, federation with the existing identity provider, connectivity, central logging and infrastructure as code. *Provisioning and orchestration*: a self-service catalogue of approved products. Also data architecture, data engineering, modern application development and CI/CD |
| **Security** | Confidentiality, integrity and availability of data and workloads | CISO, chief compliance officer, internal audit, security architects and engineers | 9 | *Identity and access management*: a central identity provider, groups and attributes for access at scale, temporary credentials, multi-factor authentication. *Security governance*: roles, responsibilities and policies, and the rules that apply to the industry. Also security assurance, threat detection, vulnerability management, infrastructure protection, data protection, application security and incident response |
| **Operations** | Cloud services delivered at the level agreed with the business | Infrastructure and operations leaders, site reliability engineers, IT service managers | 9 | *Observability*: logs, metrics and traces, with alerts when a measurement crosses a threshold. *Incident and problem management*: escalation paths in runbooks, game days and blameless post-incident reviews. Also event management (AIOps), change and release management, performance and capacity, configuration, patching, availability and continuity, and application management |

**The journey.** CAF suggests four phases, worked through in small iterations rather than once:

1. **Envision**: show how the cloud will speed up the business outcomes. Find and rank opportunities across the four domains, and give each one a senior stakeholder and a measurable outcome.
2. **Align**: find the capability gaps across the six perspectives, the dependencies between departments and the stakeholders' concerns. The result is a plan to improve readiness that the stakeholders agree on, with the organisational change management it needs.
3. **Launch**: put pilots into production that show value early, and learn from them before going further.
4. **Scale**: widen the pilots to the scale intended and make sure the expected benefits arrive and last.

The whitepaper says plainly that an organisation needn't work on every foundational capability at once: capabilities mature along the journey, and it sketches a typical order, to be adapted.

**The companion papers.** AWS published longer whitepapers for the business, people, governance, security and operations perspectives (the operations and security papers date from 2016 and were rewritten in 2022 and 2023; the business, governance and people papers appeared in 2022 and 2023), and a *CAF for artificial intelligence, machine learning and generative AI* (2023, updated February 2024) that applies the six perspectives to AI adoption. AWS now marks all of these as kept for historical reference, so check their service names and advice against current documentation. The 2021 overview is the framework's current statement.

**What CAF is not.**

- **Not a design review.** The [AWS Well-Architected Framework](../well-architected-framework/) reviews one workload against six pillars and lists that workload's risks. CAF works a level higher and asks whether the organisation can run a cloud estate at all. The two meet in the middle: CAF's cloud financial management asks for workloads that are Well-Architected, and the landing zone built under the platform perspective is where those workloads land.
- **Not the migration method.** AWS Prescriptive Guidance splits a large migration into three phases: *assess* (the business case and readiness), *mobilize* (close the gaps, build the landing zone and the operating model, prepare the teams) and *migrate and modernize*. The AWS Migration Acceleration Program (MAP) uses the same three phases, and [AWS Migration Process](../aws-migration-process/) walks through them. The two connect at the start: in the assess phase, AWS's *Migration Readiness Assessment* asks questions along CAF's six perspectives to find strengths, weaknesses and an action plan, and the mobilize phase closes those gaps before the waves begin. What happens to each workload (retire, retain, relocate, rehost, repurchase, replatform or refactor) is decided as on [Cloud Migration Strategies](../cloud-migration-strategies/); CAF's portfolio management capability names the same 7 Rs.

**Other clouds' adoption frameworks** (checked in October 2026). The other two large providers publish their own, with different structures; compare what each covers rather than the labels.

| | AWS Cloud Adoption Framework | Microsoft Cloud Adoption Framework for Azure | Google Cloud Adoption Framework |
|---|---|---|---|
| Form | One overview whitepaper, CAF 3.0 (November 2021, reviewed February 2023) | Guidance on Microsoft Learn, updated continuously | A whitepaper (the PDF Google links to is dated November 2018) and an overview page |
| Built around | Six perspectives holding 47 foundational capabilities | Phases of Azure adoption: strategy, plan, ready, adopt (migrate, modernize, cloud-native), govern, secure and manage | Four themes (learn, lead, scale, secure), each rated at one of three phases (tactical, strategic, transformational): the cloud maturity scale |
| Path through it | Envision, align, launch, scale, repeated | Strategy and plan, then a landing zone in *ready*, then adopt; govern, secure and manage cover the whole environment | Place yourself on the maturity scale, then run *epics* (workstreams such as upskilling, sponsorship, identity and access, infrastructure as code, cost control and incident management) grouped under people, process and technology |
| Readiness check | Capability gaps found in the align phase; AWS's Migration Readiness Assessment for migrations | The plan phase's discovery and assessment of the estate | A self-assessment on the maturity scale, or one run with a Google technical account manager |
| Extensions | CAF for AI (2024, now historical) | Scenarios for data platforms, AI adoption, AI agents, sovereignty and Azure VMware Solution | Google says the scale and the epics work with any cloud provider |

## Putting it into practice

Acme followed the journey and kept the assessment small enough to finish:

1. **Start from outcomes and a sponsor (envision).** The COO sponsors the programme and owns the business case. The goals become outcomes with dates and measures: every workload out of the Bangkok data centre before the lease ends; infrastructure cost about 20% below today's, checked every month; and a shorter lead time for back-office changes, measured with the same [DORA metrics](../dora-metrics/) the shop's teams use. In CAF's value chain that is technology, process and organisation change aimed at lower risk and higher efficiency.
2. **Pick the capabilities the exit depends on.** Rating all 47 at once would take months. The COO and the IT leads picked two per perspective, twelve in all, and left the rest (data monetisation, data science and others) for later iterations.
3. **Run one workshop per perspective (align).** Each brings that perspective's stakeholders into a room: the CFO and the IT finance lead for governance, the CISO and internal audit for security, the head of IT operations and an SRE from the shop for operations. They rate each capability, name the gap and agree the actions. CAF prescribes no scoring scale, so Acme used five levels of its own (not started, ad hoc, defined, managed, optimised); any scale works if the same one is used every time.
4. **Turn the gaps into owned actions.** The six workshops produced 24 actions, each with one owner from that perspective's stakeholders and a date, in one backlog the sponsor reviews every month. A few of them: the COO's business case, built from the portfolio and the 7 Rs; the CIO's training plan for all 40 people and a decision on the new roles (cloud operations, FinOps, platform engineering); the CFO's budgets and cost allocation tags, with the 20% target in the monthly report (see [FinOps](../finops/)); the CTO's landing zone; the CISO's sign-in rules; and on-call for each migrated workload instead of for the building.
5. **Build the foundations, then pilot (launch).** A small cloud centre of excellence: people from back-office IT, two engineers from the platform team that runs Launchpad for the shop, a security engineer and someone from finance. A landing zone in the organisation the shop already uses: separate accounts per environment and workload group, set up with AWS Control Tower; guardrails as service control policies and Control Tower controls, kept in version control and tested like any [policy as code](../policy-as-code/); sign-in through IAM Identity Center connected to the company directory, with multi-factor authentication and no shared logins (see [AWS IAM](../aws-iam/)); central logging, budgets and required tags. Then a pilot of five low-risk workloads in production proves the landing zone, the runbooks, the alert routing and the cost reports, and its lessons go back into the backlog.
6. **Rate again, then scale.** After the pilot the same twelve capabilities average 3.1 instead of 1.5. The remaining workloads move in waves, the subject of [AWS Migration Process](../aws-migration-process/), and the CCoE rates the twelve again every quarter, adding capabilities as the next ones start to matter.

| Perspective | Capability | Before | After launch | What changed |
|---|---|---|---|---|
| Business | Strategy management | 3 | 4 | Goals with dates and a monthly measure |
| Business | Portfolio management | 1 | 3 | A business case owned by the COO, one R per workload |
| People | Cloud fluency | 1 | 3 | A training plan for all 40, first certifications |
| People | Workforce transformation | 1 | 2 | New roles agreed; the move into them has started |
| Governance | Cloud financial management | 1 | 3 | Budgets, required tags, a monthly cost report |
| Governance | Benefits management | 1 | 3 | The 20% target measured every month |
| Platform | Platform architecture | 2 | 3 | Account structure and guardrails written down |
| Platform | Platform engineering | 2 | 4 | A landing zone with automated accounts and guardrails |
| Security | Identity and access management | 1 | 3 | Directory sign-in with MFA, no shared logins |
| Security | Security governance | 2 | 3 | Owners and policies for the new accounts |
| Operations | Observability | 2 | 3 | Metrics, logs and alerts for the pilot workloads |
| Operations | Incident and problem management | 1 | 3 | On-call and runbooks per workload, not per building |
| | **Average** | **1.5** | **3.1** | |

## Where it fits

- [Cloud Migration Strategies](../cloud-migration-strategies/) is the per-workload decision. CAF's portfolio management capability uses the same 7 Rs to build the business case.
- [AWS Migration Process](../aws-migration-process/) (assess, mobilize, migrate and modernize) is the execution. Its readiness assessment is organised by CAF's six perspectives, and its mobilize phase closes the gaps that CAF finds.
- The [Well-Architected Framework](../well-architected-framework/) reviews one workload at a time; CAF reviews the organisation that runs them.
- [FinOps](../finops/) is cloud financial management in practice: allocation, showback, budgets and unit cost.
- [Team Topologies](../team-topologies/) and [Platform as a Product](../platform-as-a-product/): in Team Topologies terms, a CCoE that coaches teams through their first moves and then steps back acts as an enabling team, while one that keeps running the landing zone has become a platform team, and should then treat the landing zone as a product with users.
- [AWS IAM](../aws-iam/), [Policy as Code](../policy-as-code/) and [Infrastructure as Code](../infrastructure-as-code/) are the platform and security perspectives' building blocks: federated sign-in, guardrails and accounts created from reviewed code.
- [Incident Management](../incident-management/) and [Golden Signals](../golden-signals/) cover the operations perspective: who gets paged, and for what.
- [DORA Metrics](../dora-metrics/) measure the "faster changes" goal.

## When to use it

- **It pays off** when a whole organisation has to change together: a data-centre exit, a large migration, or the move from a few experimental accounts to a cloud estate that finance, security and audit will rely on. It is most useful early, before the first wave, when a missing owner costs a meeting rather than an outage.
- **Small organisations** can use the six perspectives as a one-page checklist. A startup that was born in the cloud, or a team of twenty, doesn't need workshops per perspective, but the questions still apply: who owns the cost, who can sign in, who gets paged.
- **One workload** needs a Well-Architected review, not a CAF assessment.
- **Regulated organisations** get the most from the governance and security perspectives. Bring audit and risk into the align phase from the start, so the guardrails are agreed before the first account exists.
- **Legacy systems** stay in the picture. Acme keeps its mainframe on premises for now, so the operations and security capabilities have to cover a hybrid estate for years, not just the cloud side.
- **Several clouds**: the perspectives map well onto the other providers' frameworks, but the services and the vocabulary don't. Pick one structure for the whole organisation and translate the rest into it.
- **It costs** senior people's time, and the assessment is only worth that time if the actions are owned and followed up. A readiness score that nobody acts on costs more than it returns.

## Common pitfalls

- **A checklist with no owners.** The workshops produce a report, the report is filed, and next year the same gaps are found again. Give every action one owner from that perspective's stakeholders and a date, put them in one backlog, and have the sponsor review it every month.
- **Skipping the people and governance perspectives.** A technology-led plan moves the servers, and then the team can't operate what was moved and nobody is watching the bill. Agree the training plan, the new roles and the budgets before the first wave, not after the first invoice.
- **Rating all 47 capabilities before moving anything.** A full assessment takes months and goes stale while it is being written. Rate the capabilities the next phase depends on, and add the others as they start to matter; the framework itself says an organisation may not need to work on all of them at once.
- **Taking CAF for a design method or a migration plan.** It finds organisational gaps. It doesn't review a workload's architecture (that is the Well-Architected Framework) or sequence the waves, cutovers and rollbacks (that is the migration process). Use all three, each for its own job.
- **A one-off assessment.** Readiness changes as the estate grows and people move on. Rate again every quarter or after each wave, as the journey's iterations intend.
- **Treating the scores as a goal.** Level 5 everywhere is not the point; the outcomes are. Raise a capability only as far as the outcomes need.
- **Relying on the companion papers' details.** The perspective papers and the CAF for AI are now historical; their principles hold, but check service names, features and limits in the current documentation.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Cloud Migration Strategies (7 Rs)](../cloud-migration-strategies/) — Rehost, replatform, refactor, repurchase, relocate, retain or retire: pick one per workload.
- [AWS Migration Process](../aws-migration-process/) — Assess, mobilize, then migrate and modernize: a business case, a landing zone and migration waves that move a portfolio to AWS.
- [Well-Architected Framework](../well-architected-framework/) — Review a workload against six pillars, from operational excellence to sustainability, and decide on the trade-offs between them.
- [FinOps](../finops/) — Cloud cost as a shared responsibility: allocate spend to the teams that cause it, optimise it and track the cost per unit of value.
- [Platform as a Product](../platform-as-a-product/) — An internal developer platform run like a product: developers are its customers, self-service is its interface, adoption is earned.
- [Team Topologies](../team-topologies/) — Four team types and three interaction modes that organise teams around the flow of change and keep cognitive load in check.
- [AWS IAM](../aws-iam/) — Who may do what in AWS: principals, policies and roles that hand out temporary credentials, and how a request is evaluated.
- [Policy as Code](../policy-as-code/) — Write rules as code and check them automatically in CI and at deploy time, so guardrails replace manual approval gates.

## References

- [AWS — An Overview of the AWS Cloud Adoption Framework (whitepaper, CAF 3.0, 22 November 2021)](https://docs.aws.amazon.com/whitepapers/latest/overview-aws-cloud-adoption-framework/welcome.html)
- [AWS CAF overview — Accelerating business outcomes (transformation domains and business outcomes)](https://docs.aws.amazon.com/whitepapers/latest/overview-aws-cloud-adoption-framework/accelerating-business-outcomes.html)
- [AWS CAF overview — Foundational capabilities (the six perspectives)](https://docs.aws.amazon.com/whitepapers/latest/overview-aws-cloud-adoption-framework/foundational-capabilities.html)
- [AWS CAF overview — Your cloud transformation journey (envision, align, launch, scale)](https://docs.aws.amazon.com/whitepapers/latest/overview-aws-cloud-adoption-framework/your-cloud-transformation-journey.html)
- [AWS CAF overview — Document revisions (2015, 2017, 2021; reviewed February 2023)](https://docs.aws.amazon.com/whitepapers/latest/overview-aws-cloud-adoption-framework/document-revisions.html)
- [AWS — AWS Cloud Adoption Framework (overview page)](https://aws.amazon.com/cloud-adoption-framework/)
- [AWS — An Overview of the AWS Cloud Adoption Framework, version 2 (February 2017, archived copy)](https://web.archive.org/web/20200412202052/https://d1.awsstatic.com/whitepapers/aws_cloud_adoption_framework.pdf)
- [AWS — AWS CAF: Business Perspective (August 2022, kept for historical reference)](https://docs.aws.amazon.com/whitepapers/latest/aws-caf-business-perspective/aws-caf-business-perspective.html)
- [AWS — AWS CAF: People Perspective (January 2023, kept for historical reference)](https://docs.aws.amazon.com/whitepapers/latest/aws-caf-people-perspective/aws-caf-people-perspective.html)
- [AWS — AWS CAF: Governance Perspective (August 2022, kept for historical reference)](https://docs.aws.amazon.com/whitepapers/latest/aws-caf-governance-perspective/aws-caf-governance-perspective.html)
- [AWS — AWS CAF: Security Perspective (updated December 2023, kept for historical reference)](https://docs.aws.amazon.com/whitepapers/latest/aws-caf-security-perspective/aws-caf-security-perspective.html)
- [AWS — AWS CAF: Operations Perspective (updated November 2022, kept for historical reference)](https://docs.aws.amazon.com/whitepapers/latest/aws-caf-operations-perspective/aws-caf-operations-perspective.html)
- [AWS — AWS CAF for Artificial Intelligence, Machine Learning, and Generative AI (February 2024, kept for historical reference)](https://docs.aws.amazon.com/whitepapers/latest/aws-caf-for-ai/aws-caf-for-ai.html)
- [AWS Prescriptive Guidance — Guide for AWS large migrations: Phases of a large migration](https://docs.aws.amazon.com/prescriptive-guidance/latest/large-migration-guide/phases.html)
- [AWS Prescriptive Guidance — Mobilize your organization to accelerate large-scale migrations: Assess phase (Migration Readiness Assessment)](https://docs.aws.amazon.com/prescriptive-guidance/latest/strategy-migration/assess-phase.html)
- [AWS Prescriptive Guidance — Mobilize your organization to accelerate large-scale migrations: People (skills, culture, change and leadership)](https://docs.aws.amazon.com/prescriptive-guidance/latest/strategy-migration/people.html)
- [AWS — Migration Acceleration Program (MAP)](https://aws.amazon.com/migration-acceleration-program/)
- [AWS Control Tower User Guide — What is AWS Control Tower? (landing zone and controls)](https://docs.aws.amazon.com/controltower/latest/userguide/what-is-control-tower.html)
- [AWS IAM Identity Center User Guide — What is IAM Identity Center?](https://docs.aws.amazon.com/singlesignon/latest/userguide/what-is.html)
- [AWS Organizations User Guide — Service control policies (SCPs)](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html)
- [AWS — AWS Well-Architected Framework](https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html)
- [Microsoft Learn — What is the Cloud Adoption Framework? (Cloud Adoption Framework for Azure)](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/overview)
- [Microsoft Learn — Cloud Adoption Framework: the Azure adoption phases and scenarios](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/)
- [Microsoft Learn — Cloud Adoption Framework: Prepare your organization for the cloud (plan)](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/plan/prepare-organization-for-cloud)
- [Google Cloud — Google Cloud Adoption Framework](https://cloud.google.com/adoption-framework)
- [Google Cloud — The Google Cloud Adoption Framework (whitepaper, PDF)](https://services.google.com/fh/files/misc/google_cloud_adoption_framework_whitepaper.pdf)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
