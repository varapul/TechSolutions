
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧭 DevOps & SRE Principles](../../README.md#devops--sre-principles)

# Eliminating Toil

> Find the manual, repetitive operations work that grows with the system, measure it, cap it and automate it away.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Eliminating Toil" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/eliminating-toil.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Interrupts eat the week** | Acme's SRE group (4 engineers who support the platform and the product teams) plans its week around the platform roadmap, then the interrupts arrive: tickets for database users and certificate renewals, pages for a stuck order consumer and full disks, chat messages asking for logs. Each takes minutes or hours, but together they fill **62%** of the 160-hour week, and every new service adds about 2.5 hours more. The roadmap slips and people burn out. (Acme's numbers are the example's own.) |
| **2 · Is it toil? Measure it** | For two weeks everyone logs each task with its time, and the log is sorted with the test from the *Eliminating Toil* chapter of Google's SRE book: toil is manual, repetitive, automatable, tactical, has no enduring value and grows with the service. Renewing a certificate or creating a database user ticks every box; a design review is engineering, and the team meeting is **overhead**, which isn't toil either. The result: toil 62%, overhead 12%, engineering 26%, with the hours each kind of toil takes. |
| **3 · Remove the biggest first** | The group ranks its toil by hours saved and removes the biggest first: developers get read access to the central logs (40 h a week), the order consumer gets a real fix, idempotent processing with a liveness probe as a backstop (9 h), **cert-manager** renews the certificates (3 h) and a Terraform module turns database users into reviewed pull requests (2 h). Measured every quarter, toil falls from 62% to 37% and then 28%, below the 50% cap Google sets on SRE operational work, and the roadmap moves again. |
| **4 · Pitfalls and limits** | A cron job that restarts the consumer every 30 minutes would automate a process that shouldn't exist, and a module nobody owns breaks and sends the tickets back. A 30-minute export done four times a year doesn't repay three days of automation, requests that never reach the log stay hidden, and when cert-manager fails, someone still has to know how certificates are issued. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's SRE group is four engineers who support the shared platform (the [Kubernetes](../kubernetes/) clusters, CI/CD and the observability stack) and the product teams. Their week is meant for the platform roadmap, but it goes to interrupts: tickets asking for a database user or warning that a certificate is about to expire, pages when the order consumer gets stuck or a disk fills up, chat messages from developers who need production logs they can't see. Each request is small and each one is reasonable. A two-week time log shows where the week really goes: 62% to this kind of work, 12% to meetings and planning and 26% to engineering. (Acme's numbers are the example's own, not research findings.)

The trend is worse than the number. Every new service brings more certificates, database users, disks and log requests, so the hours grow in step with the number of services: about 2.5 hours a week for each new one at Acme. A group that does this work by hand has to grow with the system, or its project work stalls, as the roadmap has here, and people burn out. Some of it grows even without new services: under CA/Browser Forum ballot SC081v3, public TLS certificates may be valid for at most 200 days since 15 March 2026, 100 days from March 2027 and 47 days from March 2029, so every certificate renewed by hand comes round more and more often.

## How it works

**Toil** is the name Google's *Site Reliability Engineering* book (O'Reilly, 2016) gives to one kind of operational work, in chapter 5, *Eliminating Toil*, written by Vivek Rau. It is work tied to running a production service that is:

- **manual**: a person runs the commands or the script;
- **repetitive**: the same task comes back again and again;
- **automatable**: a machine could do it as well, or the need for it could be designed away;
- **tactical**: interrupt-driven and reactive rather than planned;
- **without enduring value**: the service is no better afterwards than it was before;
- **O(n) with service growth**: it grows linearly with the size of the service, its traffic or its users.

Not every task has all six traits; the more it has, the more likely it is toil. The chapter is just as clear about what toil is not. **Overhead**, such as team meetings, goal setting and HR paperwork, isn't tied to running production and isn't toil. Grungy work that leaves a lasting improvement, such as cleaning up a service's whole alerting configuration, isn't toil either. And toil is not simply work someone dislikes: a little predictable routine is fine, even satisfying. The problem is volume. Too much toil stalls careers and lowers morale, and a team that keeps absorbing it teaches the rest of the organisation to send it more.

Engineering is the opposite: work that needs judgement and leaves the service permanently better. The chapter's point is that a well-run service can grow by an order of magnitude with only one-off effort to add resources. Toil, by definition, grows with the service; engineering work doesn't have to.

**The cap.** Google caps operational work at 50% of SRE time, so that at least half goes to engineering projects that reduce future toil or add features. The book's introduction, by Benjamin Treynor Sloss, describes it as a cap on all "ops" work (tickets, on-call, manual tasks); chapter 5 states it as a goal for each SRE, averaged over a few quarters or a year, because toil comes in spikes. A team that stays over the cap changes how it works, for example by handing some of the operations back to the development team. Google's quarterly surveys found SREs spending about 33% of their time on toil on average, with interrupts as the top source, followed by on-call response and releases. *The Site Reliability Workbook* (O'Reilly, 2018) adds in its own *Eliminating Toil* chapter (chapter 6) that the 50% limit covers operational work of both kinds, toil and non-toil, and that other organisations may need a different number; what matters is having an upper bound and measuring against it.

**Measuring it.** The workbook asks for data rather than intuition. The people who do the work identify the toil, choose an objective unit (hours, tickets, manual changes) and track it before, during and after each reduction project, with tools or scripts so that the measuring doesn't become toil too. Google SRE teams track toil in their bug tracker and rank it by the cost to fix it against the time it saves. Before a project starts, check that the time saved will be at least proportional to the time it takes to build and then maintain the fix; indirect benefits such as better morale, less context switching and fewer outages caused by human error can justify a project that looks unprofitable on hours alone.

**Removing it.** The workbook's toil management strategies include:

- **Reject it.** The workbook suggests considering this first: weigh the cost of doing the task against the cost of not doing it, and sometimes the answer is to stop. Work that can't be dropped can often be batched, turning many interrupts into one planned job.
- **Engineer it out of the system.** The workbook calls removing toil at its source the best strategy: fix the cause instead of the symptom, and work with the developers to make the software easier to operate.
- **Use SLOs** to decide which operational tasks can be left undone while the error budget allows it.
- **Start with a human-backed interface, then go self-service.** A structured request form, still handled by a person, standardises the requests; a form, script, API or documented pull request then lets the requesters serve themselves.
- **Automate** what remains: start small, make systems uniform so that one automation covers many of them, and build safety checks into anything that holds admin powers.

Chapter 7 of the SRE book, *The Evolution of Automation at Google* (Niall Murphy with John Looney and Michael Kacirek), explains why automation is worth more than the hours it saves: it is consistent, it becomes a platform others can build on, and it repairs and acts faster than people can. It also argues that better than both manual operation and automation is a system designed so that it needs neither.

## Putting it into practice

1. **Log two weeks of work.** Everyone records each task with its time and where it came from: ticket, page, chat, meeting or project. A spreadsheet or a label on tickets is enough, but include the channels that leave no ticket, chat above all.
2. **Sort the log** into toil, overhead and engineering with the six traits, and agree on the borderline cases as a team.
3. **Rank the toil by hours** and choose a fix for each kind: reject it, fix the cause, make it self-service or automate it. Acme's four biggest are in the table below.
4. **Check the payback.** Log access saves about 2,000 hours a year for about three weeks of work, and the database-user module about 100 hours a year for three days. Count the upkeep as well: every automation needs an owner, alerts, upgrades and documentation.
5. **Run each fix like a product with an owner.** cert-manager belongs to the platform team, with an alert for any certificate close to expiry in case a renewal fails; the Terraform module has a maintainer and lives with the rest of the platform's code.
6. **Measure again every quarter** against the cap, and put the next items on the list: here, disk resizing and the long tail of small tasks.

Acme's four biggest kinds of toil and what removed them:

| Toil | Measured | What removed it | Kind of fix | Saved a week |
|---|---|---|---|---|
| Copying logs for developers | ≈ 80 requests a week × 30 min | Read-only access to the central log store, scoped to each team's services | Self-service | 40 h |
| Restarting the stuck order consumer | 3 pages a week × ≈ 3 h | Idempotent processing, so a redelivered message no longer jams it; a liveness probe as a backstop | Fix the cause | 9 h |
| Renewing TLS certificates | ≈ 4 a week × 45 min | cert-manager issues and renews them | Automate | 3 h |
| Creating database users | ≈ 35 a month × 15 min | A Terraform module; product teams add users in a reviewed pull request | Self-service | 2 h |
| **Total** | | | | **54 of 99 h** |

The group opens up log access in the first quarter and does the other three in the second, and toil falls from 62% of the week to 37% and then 28%. A few details:

- **cert-manager** renews a certificate two-thirds of the way through its lifetime by default (day 60 of a 90-day certificate); `spec.renewBefore` or `spec.renewBeforePercentage` move that point. It works with ACME issuers such as Let's Encrypt and with private certificate authorities.
- **A liveness probe** makes the kubelet restart a container that keeps failing it. The Kubernetes documentation suggests it for deadlocks, where a process runs but makes no progress, and warns that a badly tuned probe restarts containers under load and makes things worse. It is the safety net; the fix is the idempotent consumer, which recognises a redelivered message as already done.
- **The database-user module** can use the community [PostgreSQL](../postgresql/) provider for Terraform (`postgresql_role` and `postgresql_grant`). Keep passwords out of the Terraform state, for example with the provider's write-only password attributes, and let the pull request review check who gets which grants.
- **Log access** depends on a store that can scope access per team and keep personal data out of the logs, or mask it, before developers can search them.

## Where it fits

- [SLOs & Error Budgets](../slo-error-budgets/): an SLO tells the team which operational work can wait, and paging on error-budget burn instead of on every blip removes a whole class of on-call toil.
- [Idempotent Consumer](../idempotent-consumer/) and [Health Endpoint Monitoring](../health-endpoint-monitoring/): the root-cause fix and the safety net for the stuck order consumer.
- [Centralized Logging](../centralized-logging/): one searchable store with access per team turns log requests into self-service.
- [GitOps](../gitops/), [Immutable Infrastructure](../immutable-infrastructure/) and [Infrastructure as Code](../infrastructure-as-code/): changes go through reviewed pull requests and rebuilds instead of commands typed on servers, which removes whole categories of toil and leaves an audit trail.
- [You Build It, You Run It](../you-build-it-you-run-it/) decides who carries the operational work; this page is about keeping that work small, whoever carries it. When an SRE team stays over the cap, handing some of the operations back to the developers is one of the book's levers.
- Golden Paths and Platform as a Product: self-service at the scale of a whole platform, so that each new service doesn't bring new tickets with it.
- [The Three Ways](../three-ways/): the Third Way's time reserved for improving daily work is where toil reduction happens.
- [Incident Management](../incident-management/) covers the urgent side of operations; a page that keeps coming back after the incident is over is toil to remove.

## When to use it

- **It pays off** for any team that runs production systems and sees its operational load grow with services, customers or developers, and wherever project work keeps losing to interrupts. Measuring costs a few minutes a day for two weeks, and it turns "we're busy" into hours per task that managers can act on.
- **Adapt the cap.** 50% is Google's number for SRE teams. An operations team, a small platform team or a team in its first year may set a different bound; what matters is having one, measuring against it and acting when the team stays above it.
- **Small teams** have little slack to build automation. Start with rejecting and batching work and with self-service through documented pull requests, which need little code.
- **Regulated environments** may require a person to approve some changes. Keep the approval but make it cheap: a structured request, an evidence trail collected automatically and a reviewer who only reviews.
- **Legacy systems** that are expensive to change may not be worth automating directly. The workbook describes wrapping them in automation and monitoring as a stopgap until they can be replaced.
- **It doesn't pay** for rare tasks, for systems about to be retired, or for one-off migrations, which are projects rather than toil.

## Common pitfalls

- **Automating a process that shouldn't exist.** A cron job that restarts the consumer every 30 minutes hides the bug and keeps the risk. First ask whether the task can be dropped or its cause fixed.
- **Automation nobody owns.** A script whose author has moved on breaks with the next upgrade, and the tickets come back, often after an outage. Give every automation an owner, alerts and documentation; the workbook expects teams to own the toil that their unsupported tools create.
- **Automating tasks too rare to pay back.** A 30-minute export done four times a year costs 2 hours a year, so three days of automation would take 12 years to repay. Keep a checklist instead.
- **Toil nobody measures.** Requests in chat and favours asked in passing never reach the ticket queue, so the toil looks smaller than it is and creeps back. Measure every channel, and measure again every quarter.
- **Losing the understanding.** The SRE book's automation chapter warns that the more the automation does, the less contact people have with the system, and the less able they are to run it when the automation fails. Keep runbooks, make the automation show what it did and why, and practise the manual path in game days.
- **Automation with too much reach.** A tool with admin powers can turn one bad input into an outage across the whole fleet. Validate its inputs and build in safeguards, from timeouts to checks of the system's state before it acts.
- **Gaming the number.** Relabelling toil as engineering meets the cap on paper only. Keep the definition honest and look at the hours per task, not only at the share.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [You Build It, You Run It](../you-build-it-you-run-it/) — The team that builds a service runs it in production, on call, so the people who can fix a problem hear about it first.
- [Infrastructure as Code](../infrastructure-as-code/) — Define infrastructure in version-controlled code: review a plan, apply it the same way in every environment and catch drift.
- [Golden Paths](../golden-paths/) — A paved, supported route for common tasks: one template creates a service with its pipeline, infrastructure and monitoring.
- [SLOs & Error Budgets](../slo-error-budgets/) — Measure SLIs against an objective and alert on error-budget burn rate, not on every blip.
- [GitOps](../gitops/) — Git holds the desired state; an agent continuously reconciles the cluster to match it.
- [Immutable Infrastructure](../immutable-infrastructure/) — Never patch servers in place: bake a new image and replace them.
- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.
- [Incident Management](../incident-management/) — A practised response when production breaks: declare early, assign roles, mitigate first and keep everyone informed.
- [Centralized Logging](../centralized-logging/) — Ship structured logs from every service to one searchable store, correlated by request ID.
- [Health Endpoint Monitoring](../health-endpoint-monitoring/) — Expose liveness and readiness checks that load balancers and monitors probe.

## References

- [Google SRE Book — Eliminating Toil (chapter 5)](https://sre.google/sre-book/eliminating-toil/)
- [Google SRE Book — Introduction (chapter 1)](https://sre.google/sre-book/introduction/)
- [Google SRE Book — The Evolution of Automation at Google (chapter 7)](https://sre.google/sre-book/automation-at-google/)
- [Google SRE Workbook — Eliminating Toil (chapter 6)](https://sre.google/workbook/eliminating-toil/)
- [cert-manager — Certificate resource (renewal)](https://cert-manager.io/docs/usage/certificate/)
- [Kubernetes — Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/)
- [CA/Browser Forum — Ballot SC081v3: Introduce Schedule of Reducing Validity and Data Reuse Periods](https://cabforum.org/2025/04/11/ballot-sc081v3-introduce-schedule-of-reducing-validity-and-data-reuse-periods/)
- [Terraform PostgreSQL provider (cyrilgdn/terraform-provider-postgresql)](https://github.com/cyrilgdn/terraform-provider-postgresql)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
