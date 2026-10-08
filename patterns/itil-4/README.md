
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧭 DevOps & SRE Principles](../../README.md#devops--sre-principles)

# ITIL 4

> IT service management with ITIL 4: the service value system, guiding principles and change enablement that work with DevOps, not against it.

<p align="center"><img src="diagram.svg" alt="Animated diagram: ITIL 4" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/itil-4.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One board for every change** | Acme's back-office IT team (40 people looking after about 120 workloads in the Bangkok data centre) sends every change to a weekly change advisory board (CAB): a one-line config tweak waits about 3 days, just like a database migration, and the board approved 39 of last month's 40 changes as submitted, yet 6 of them (15%) still failed. A two-week freeze stops everything around the 11.11 sale, the shop's catalog team edits the product catalog's feed config in production rather than wait, and the stuck order export (INC-5531) has been closed nine times this quarter without anyone asking why; DORA's 2019 research found that approval by a body outside the team went with lower delivery performance, and found no evidence that it reduced failed changes. |
| **2 · The service value system** | ITIL 4 describes a **service value system**, which PeopleCert's ITIL (Version 5) of 2026 keeps: guiding principles, governance, a **service value chain** of six activities (plan, improve, engage, design and transition, obtain/build, deliver and support), 34 practices and continual improvement, which together turn demand into value. Change CHG-2420, bin locations on the Inventory pick lists, follows its own **value stream** through the chain: engaged with the warehouse lead, planned at the top of the backlog, designed for zone A first, built and tested, transitioned after peer review and delivered, so zone A picks 18% faster and improvement takes it on to zones B to D. Four of the seven **guiding principles** shape it: focus on value, think and work holistically, progress iteratively with feedback, and collaborate and promote visibility. |
| **3 · Change enablement** | ITIL 4's **change enablement** practice gives each type of change its own **change authority**: **standard** changes are low-risk and pre-authorised, so the pipeline runs them and writes their records (CHG-2417 to CHG-2419); **normal** changes are authorised by the team through peer review and automated tests (CHG-2420), with the CAB kept as the authority for high-risk ones such as the Inventory database migration (CHG-2421); and **emergency** changes such as the INC-5531 hotfix (CHG-2422) are expedited by the on-call lead and reviewed afterwards. A month later 34 of Acme's 40 changes (85%) are standard, their lead time has fallen from about 3 days to 2 hours, and the CAB sees about one change a month (Acme's numbers are the example's own). |
| **4 · Common pitfalls** | Most ITIL failures come from how it is adopted: copied whole as a rulebook, textbook processes laid over the old ones instead of starting where you are, a configuration management database (CMDB) built as a goal in itself, ITIL and DevOps treated as rivals, and certificates collected while the CAB still sees every change. Each has a guiding principle as its answer, and ITIL itself is guidance to adapt to your risks and size: it says what to manage, while DevOps, SRE and the pipeline show how. |
<!-- END GENERATED: header -->
## The problem

Acme Shop's online shop runs on AWS, but its back office still runs in Acme's own data centre in Bangkok: about 120 workloads, among them the Orders, Inventory and product catalog systems that feed the shop, looked after by a 40-person IT team. The lease ends in 18 months, and leadership wants three things from the move: leave the data centre in time, cut infrastructure cost by about 20%, and ship back-office changes faster. The last goal runs straight into the way the IT team handles change.

Every change goes to a weekly change advisory board (CAB) that meets on Thursdays at 14:00, whether it is a one-line configuration tweak or the migration of a database. Eight people work through about ten changes in half an hour, and last month they approved 39 of 40 changes as submitted. A change raised on Monday waits about 3 days for the meeting, and a short review by people far from the work catches little: 6 of those 40 approved changes still failed in production (15%). Around the 11.11 sale a two-week freeze stops all changes, so the queue grows and the first release after the sale is the largest of the season.

People route around a process like this. The shop's catalog team, which deploys several times a day, edits the product catalog's feed configuration directly in production rather than wait three days for a one-line fix, and nobody records the change. Incidents are logged, fixed and closed, but nobody looks for their causes: the stuck order export, INC-5531, has been closed nine times this quarter. (Acme's numbers on this page are the example's own.)

Research points the same way. DORA's 2019 State of DevOps research found that approval by a body outside the team, such as a CAB or a senior manager, went with lower software delivery performance, and found no evidence that it led to fewer failed changes. DORA's explanation is that heavyweight approval slows delivery down, so changes ship less often and in larger batches, and larger batches carry more risk. The same pattern shows up on the shop's side of Acme in [Policy as Code](../policy-as-code/) and [The Three Ways](../three-ways/).

## How it works

**What ITIL is, and who owns it.** ITIL is a body of guidance for IT service management, which its latest version extends to digital products and services. The UK government's Central Computer and Telecommunications Agency (CCTA) started it in the 1980s; version 3 (2007) organised it around a service lifecycle of processes and was revised in the 2011 edition. AXELOS, a joint venture of the UK Cabinet Office and Capita created in 2013, published ITIL 4 in 2019, and PeopleCert completed its acquisition of AXELOS in 2021. ITIL 4 replaced version 3's process model with a value system built from practices, and took in ideas from Agile, Lean and DevOps. The concepts below come from *ITIL Foundation, ITIL 4 Edition*. ITIL's text is proprietary, so this page names its concepts and explains them in its own words.

**ITIL 4 and ITIL (Version 5).** In early 2026 PeopleCert began a phased release of ITIL (Version 5), which manages digital products and services together and is designed with AI in mind. PeopleCert presents it as an evolution of ITIL 4 rather than a reset: it keeps the service value system and the guiding principles, simplifies the value chain, adds an eight-stage product and service lifecycle (discover, design, acquire, build, transition, operate, deliver and support), and keeps the 34 management practices, adjusted in places and regrouped as product and service management practices and general management practices. Change enablement is still one of them. ITIL 4 certification stays available during the transition, and PeopleCert's current plan is to retire the ITIL 4 modules on 31 December 2027. The diagram draws ITIL 4's six-activity value chain.

**The service value system.** ITIL 4 explains how an organisation turns demand into value as a system of five parts, which the diagram's second step draws around one change:

- **Guiding principles:** seven recommendations that hold whatever the situation, used to make decisions and to adapt the rest of ITIL (see the table below).
- **Governance:** how the organisation is directed and controlled. At Acme, IT leadership sets the direction, the change policy and the risk appetite that the change models follow.
- **The service value chain:** six activities, *plan*, *improve*, *engage*, *design and transition*, *obtain/build* and *deliver and support*, which can be combined in any order. A **value stream** is one such combination for one kind of work.
- **Practices:** 34 of them, each a combination of people, information, tools and processes for one kind of work, such as change enablement, deployment management or the service desk. ITIL 4 sorts them into 14 general management, 17 service management and 3 technical management practices.
- **Continual improvement:** improvement at every level, from one practice to the whole organisation, following a repeatable improvement model.

The value stream of CHG-2420, bin locations on the Inventory pick lists, runs through the chain like this:

1. *Engage:* the warehouse lead reports that pickers lose time looking for bins, and the request becomes CHG-2420.
2. *Plan:* the Inventory team ranks it at the top of its backlog.
3. *Design and transition:* the change is designed for one warehouse zone first.
4. *Obtain/build:* it is built, with automated tests in the pipeline.
5. *Design and transition* again: a peer review authorises it as a normal change and it is deployed. Because the activities can be combined in any order, a value stream can come back to one.
6. *Deliver and support:* pickers in zone A use it, and the service desk has a guide for it.
7. *Improve:* zone A picks 18% faster, so the rollout to zones B to D is planned next.

**The guiding principles,** paraphrased, with the way Acme applied them:

| Principle | The idea, in short | At Acme |
|---|---|---|
| Focus on value | Tie every activity to an outcome someone values | CHG-2420 starts from the pickers' problem: walking to find bins |
| Start where you are | Look at what exists and works before you replace it | The CAB, the change records and the tools stay; who decides what changes |
| Progress iteratively with feedback | Work in small steps and use what each one teaches | Zone A first, then zones B to D |
| Collaborate and promote visibility | Work across boundaries, with the work in plain view | The warehouse lead sees the backlog and joins the demos |
| Think and work holistically | No part creates value alone, so consider the whole system | The pick list, the handheld scanners and the service desk's guide change together |
| Keep it simple and practical | Use the fewest steps that reach the outcome | Three change types instead of one board for everything |
| Optimize and automate | Improve the work first, then automate it | Standard changes run and record themselves in the pipeline |

**The four dimensions.** ITIL 4 asks for every service and practice to be looked at from four sides, so that none is neglected: organizations and people; information and technology; partners and suppliers; and value streams and processes. For CHG-2420 they are the pickers and the service desk, the Inventory system and the scanners, the vendor of the scanners' app, and the picking route itself.

**Change enablement, and the change management before it.** In ITIL version 3, change management was a process within service transition, and the CAB was its best-known feature; organisations such as Acme often ended up sending every change to it. ITIL 4 recast it as a practice, change enablement (called change control in the 2019 Foundation book and renamed in later ITIL 4 publications), which aims to make as many changes as possible succeed by assessing their risk, authorising them and keeping a schedule of changes. It distinguishes three types of change, and the **change authority**, the person or group that authorises a change, can be different for each:

- **Standard changes** are low-risk, well understood, documented and pre-authorised: once their procedure is approved, each instance runs without asking again. Many start as service requests.
- **Normal changes** are scheduled, assessed and authorised by the authority that their change model names. For a low-risk change that can be someone close to the work who decides quickly, often with the help of automation; for a very large one it can be the organisation's most senior governing body.
- **Emergency changes** have to go in as soon as possible, for example to resolve an incident or apply a security patch. Their assessment and authorisation are expedited, sometimes by a separate change authority.

Acme's change models after the change, as in the diagram's third step:

| Change model | Examples | Change authority | Record | Lead time |
|---|---|---|---|---|
| Standard | Low-stock threshold (CHG-2417), TLS certificate (CHG-2418), OS patches (CHG-2419) | Pre-authorised by the model, reviewed when one fails | Written by the pipeline | About 2 hours |
| Normal | Bin locations on pick lists (CHG-2420) | The Inventory team: a peer review plus automated tests | The pull request and the pipeline | About 1 day |
| Normal, high risk | Moving Inventory to a managed database service (CHG-2421) | The CAB, which now meets when such a change needs it, about once a month | Change record and the CAB's decision | The next CAB |
| Emergency | Hotfix for INC-5531 (CHG-2422) | The on-call lead, with a review at the next CAB | The pipeline, plus the review | Right away |

A month after the switch, 34 of Acme's 40 changes (85%) are standard, and their lead time has fallen from about 3 days to 2 hours.

**Incidents, problems and postmortems.** ITIL keeps two practices apart. Incident management restores normal service as quickly as possible; problem management looks for the causes of incidents, actual and potential, and manages workarounds and known errors until the cause is removed. Acme's IT team ran only the first: INC-5531 was restored nine times and never became a problem record. The SRE practices map onto both: [Incident Management](../incident-management/) is the response, and a [blameless postmortem](../blameless-postmortems/) does the work of problem management, looking for contributing factors rather than culprits and tracking actions until they are done. A recurring incident like INC-5531 is where a problem record and a postmortem pay off first.

**How DevOps fits.** ITIL describes what an organisation needs to manage; DevOps, continuous delivery and SRE are ways of doing much of it. A deployment pipeline with automated tests, peer review in pull requests and an automatic audit trail is change enablement at work, [DORA's metrics](../dora-metrics/) measure the value stream, and on-call teams with postmortems do incident and problem management. Even on PeopleCert's own site, a 2025 article by Donna Knapp of ITSM Academy describes CABs as largely given up in DevOps organisations, with changes authorised by people close to the work or by automated controls.

**What DORA found.** DORA, a research programme now run by Google Cloud, reported in its 2019 State of DevOps research that approval by a body outside the team went with lower delivery performance and showed no evidence of fewer failed changes, and that simply making an existing approval process clear to the teams who use it went with better performance. Its guide to streamlining change approval recommends peer review during development backed by automated testing and monitoring, extra scrutiny only for changes flagged as high risk, and a new role for the CAB: coordinating between teams, improving the process and making the business trade-offs that need senior sign-off. It also suggests making the normal change path fast and reliable enough to use in an emergency. *The DevOps Handbook* (second edition, 2021) makes the same case in its part on feedback, the Second Way: approvals by people far from the work add delay without catching much, and review by peers close to the work does better.

## Putting it into practice

1. **Start where you are: measure the flow.** For a month, record each change's type, how long it waited for approval, what the approvers changed and whether it failed. Acme found a wait of about 3 days, 39 of 40 changes approved as submitted and 15% failing anyway, which made the case better than any slide.
2. **Write change models, starting with the routine changes.** List the changes that recur (configuration values, certificate renewals, patches), give each a documented and tested procedure with a way back, and have the CAB pre-authorise the model once. Automate the procedure in the pipeline, and turn a model back into normal changes when its changes start to fail.
3. **Delegate normal changes to the team.** A peer review in the pull request, enforced by the repository (protected branches with required reviewers in GitHub or GitLab, for example), plus automated tests, is the change authority. Because the author cannot approve their own change, it also meets the usual segregation-of-duties requirement, as DORA's guide notes.
4. **Keep the CAB for what needs it:** high-risk changes such as a database migration, changes that touch many teams, and business trade-offs. Give the board DORA's new role of coordinating and improving the process instead of reading every change.
5. **Define the emergency path:** who may authorise (at Acme, the on-call lead), how the change is recorded and when it is reviewed afterwards. Aim to make the normal path fast enough that emergencies rarely need a different one.
6. **Let the pipeline write the records.** The pipeline opens and closes the change record in the service management tool (ServiceNow or Jira Service Management, for example) with what changed, who reviewed it, which tests passed and when it was deployed. That is better evidence for an auditor than meeting minutes.
7. **Replace blanket freezes with rules by risk.** During the 11.11 sale Acme now lets standard changes continue and holds the high-risk ones, instead of stopping everything and releasing a large batch afterwards.
8. **Run problem management on repeats.** An incident that comes back gets a problem record and a blameless review, and the fix ships as a normal change. INC-5531 was the first.
9. **Measure the outcome:** lead time by change type, change fail rate, the time changes spend waiting for approval and the share of changes that need a manual approval, the measures DORA suggests, tracked over months (see [DORA Metrics](../dora-metrics/)).
10. **Adapt it a system at a time.** Acme started with Inventory and then moved the other systems over one by one.

## Where it fits

- **[Continuous Delivery](../continuous-delivery/)** provides the deployment pipeline that turns standard changes into routine and writes the records that change enablement needs.
- **[Policy as Code](../policy-as-code/)** moves the checks a CAB used to read by eye into automated rules, so more changes can be standard without losing control.
- **[DORA Metrics](../dora-metrics/)** show whether the new change models make delivery faster without more failures, **[Value Stream Mapping](../value-stream-mapping/)** finds where a change waits, as the 3-day queue for the CAB did here, and **[The Three Ways](../three-ways/)** explain why small changes with fast feedback are safer than big, approved ones.
- **[Incident Management](../incident-management/)** and **[Blameless Postmortems](../blameless-postmortems/)** are the SRE counterparts of ITIL's incident and problem management.
- **[CALMS](../calms/)** looks at the culture, automation, lean flow, measurement and sharing that an ITIL adoption needs as much as a DevOps one does.
- **[Cloud Migration Strategies](../cloud-migration-strategies/)** covers the same back office: moving Inventory to a managed database service is the kind of high-risk change that still goes to the CAB.
- **[Feature Flags](../feature-flags/)** and **[Canary Release](../canary-release/)** lower the risk of each change, which lets more changes be standard or normal.

## When to use it

**Where it pays off.** Organisations that run many services for many users, especially internal IT departments and service providers; places where regulators, auditors or outsourcing contracts expect documented change, incident and problem management; and mixed estates like Acme's back office, where a mainframe, a VMware cluster and cloud services have to be run with one shared vocabulary. ITIL gives IT, its suppliers and the business a common language, and many IT professionals already know it: PeopleCert reports more than three million ITIL certifications.

**Where it costs more than it returns.** A small product team that already deploys through a pipeline with peer review, on-call and postmortems is doing the essentials, and adopting 34 practices on top would add overhead without benefit. ITIL also gets expensive when it is run as a project to finish: training, consultants and a large tool rollout can use up the budget that was meant for automation.

**Adapting it.** Regulated businesses keep segregation of duties and an audit trail, implemented as peer review and pipeline records rather than meeting minutes. Legacy systems that cannot be deployed through a pipeline, such as Acme's mainframe, keep a manual normal change model with tested runbooks. Where suppliers make changes, the contract names the change authority, so their changes reach the right person. Small organisations take the principles and two or three practices and stop there.

## Common pitfalls

- **ITIL as a rulebook to copy.** Adopting every process and form because the book describes them creates bureaucracy and invites workarounds. *Instead:* keep it simple and practical, and take what solves a problem you have.
- **Adopted, not adapted.** Textbook processes laid over the old ones throw away what already worked. *Instead:* start where you are: measure the current flow and fix the worst constraint first.
- **The CMDB as a goal in itself.** Years go into filling a configuration management database that no decision uses. *Instead:* focus on value: record the configuration items and relationships that change assessment, incident response or audits really use, and keep them current automatically from the cloud and deployment tools.
- **ITIL and DevOps as rivals.** The pipeline is treated as a way around control, or ITIL as the enemy of speed. *Instead:* make the pipeline, peer review and automated tests the controls, and record them as such.
- **Certificates instead of change.** Everyone passes ITIL Foundation, and the CAB still sees every change. *Instead:* judge the adoption by its outcomes: lead time and failed changes.
- **Treating all changes the same.** One process for a configuration value and a database migration wastes attention on both; DORA lists it among the common pitfalls of change approval. *Instead:* change models by risk.
- **Answering failures with more approval.** After a bad change, another sign-off feels safe, but it raises lead times and batch sizes, which DORA's analysis suggests makes things worse. *Instead:* make changes smaller and checks faster.
- **Freezes as the default safety measure.** A blanket freeze builds a large batch for the day it ends. *Instead:* freeze by risk, and keep standard changes flowing.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Incident Management](../incident-management/) — A practised response when production breaks: declare early, assign roles, mitigate first and keep everyone informed.
- [Blameless Postmortems](../blameless-postmortems/) — Learn from every incident without blame: a timeline, the contributing factors and tracked action items, shared widely.
- [Continuous Delivery](../continuous-delivery/) — Keep every change releasable: a deployment pipeline builds once, tests in stages and promotes the same artifact to production.
- [Policy as Code](../policy-as-code/) — Write rules as code and check them automatically in CI and at deploy time, so guardrails replace manual approval gates.
- [DORA Metrics](../dora-metrics/) — Measure software delivery by throughput and stability: how often and how fast changes reach production, and how often they fail.
- [Value Stream Mapping](../value-stream-mapping/) — Draw how a change travels from idea to customer, compare the time spent working with the time spent waiting, and remove the biggest wait.
- [The Three Ways](../three-ways/) — DevOps in three principles: speed the flow of work to customers, amplify feedback back to the team, and keep learning.
- [CALMS](../calms/) — A lens for assessing a DevOps adoption: culture, automation, lean, measurement and sharing, and the dimension that holds the others back.

## References

- [PeopleCert — ITIL: qualification scheme and framework](https://www.peoplecert.org/Frameworks-Professionals/ITIL-framework)
- [PeopleCert — ITIL 4 Foundation](https://www.peoplecert.org/browse-certifications/it-governance-and-service-management/ITIL-1/itil-4-foundation-2565)
- [PeopleCert — ITIL 4 Practitioner: Change Enablement](https://www.peoplecert.org/browse-certifications/it-governance-and-service-management/ITIL-1/itil-4-practitioner-change-enablement-3794)
- [PeopleCert — ITIL Foundation (Version 5)](https://www.peoplecert.org/browse-certifications/it-governance-and-service-management/ITIL-1/itil-5-foundation-version-50-4154)
- [PeopleCert — New ITIL Explained for Certified Professionals (ITIL (Version 5), 2026)](https://www.peoplecert.org/news-and-announcements/itil-version-5-explained)
- [PeopleCert — ITIL FAQ (ITIL (Version 5) and the ITIL 4 modules)](https://www.peoplecert.org/help-and-support/faq-itil)
- [Roman Jouravlev and Adam Griffith — ITIL Foundation (Version 5), what's new? (PeopleCert, 2026)](https://www.itil.com/Itil-News-and-Announcements/itil-version-5-foundation-whats-new-guide)
- [Barclay Rae and David Cannon — The new ITIL product and service lifecycle model (PeopleCert, 2026)](https://www.itil.com/Itil-News-and-Announcements/itil-product-and-service-lifecycle-model)
- [PeopleCert — PeopleCert completes Axelos acquisition (2021)](https://www.peoplecert.org/news-and-announcements/2021/peoplecert-completes-axelos-acquisition)
- [Donna Knapp — DevOps + ITIL 4: Building High-Performing IT Teams (PeopleCert, 2025)](https://www.peoplecert.org/news-and-announcements/2025/devops-itil-4-high-performing-it-teams)
- [DORA — Capabilities: Streamlining change approval](https://dora.dev/capabilities/streamlining-change-approval/)
- [DORA — Accelerate State of DevOps Report 2019](https://dora.dev/research/2019/dora-report/)
- [The DevOps Handbook, Second Edition — Gene Kim, Jez Humble, Patrick Debois, John Willis and Nicole Forsgren (IT Revolution, 2021)](https://itrevolution.com/product/the-devops-handbook-second-edition/)
- [IBM — What is IT Infrastructure Library (ITIL)?](https://www.ibm.com/think/topics/it-infrastructure-library)
- [Atlassian — Change management types](https://www.atlassian.com/itsm/change-management/types)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
