
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧭 DevOps & SRE Principles](../../README.md#devops--sre-principles)

# Incident Management

> A practised response when production breaks: declare early, assign roles, mitigate first and keep everyone informed.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Incident Management" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/incident-management.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Without a process** | Picture Saturday 3 October 2026 at Acme Shop without a process. Checkout `1.43.0` rolled out at 20:05, and from about 20:09 checkout requests start to fail: nine people debug at once in the shared `#checkout` channel, two of them restart the checkout pods in the same minute, nobody tells support or customers, managers keep asking for updates, and nobody knows who decides. |
| **2 · Declared and organised** | What actually happened: at 20:14 the SLO burn-rate alert pages Mai, the checkout on-call engineer, with errors at 12% against a 99.9% objective. At 20:17 Mai acknowledges, **declares a SEV-2** in `#inc-checkout-1003` and takes the **incident commander** role: Tom becomes operations lead, Ploy (the support lead) communications lead, and a scribe keeps the timeline in the incident document. The commander coordinates and decides but leaves the debugging to others. |
| **3 · Mitigate first** | Mai asks what changed: checkout `1.43.0`, at 20:05. Tom rolls back to `1.42.0` at 20:24 and, with the payment provider slow as well, turns on the existing flag `payments.fallback` at 20:31 to route payments to the second provider; at 20:36 errors are down to 0.3%, **mitigated** 22 minutes after the page. Ploy updates the status page, support and managers every 30 minutes (Acme's choice of rhythm), and the root cause waits until the incident is over. |
| **4 · Resolve and hand over** | The provider recovers at 21:10. At 21:30 Mai resolves the incident (about 1,240 failed checkout attempts, which customers could retry) with a handoff note in the incident document, and a blameless postmortem is scheduled. The usual pitfalls: a hero who fixes it alone, a commander who debugs, a severity argued about instead of declared (declare high, downgrade later), and mean time to recover used as a target. |
<!-- END GENERATED: header -->
## The problem

When production breaks, capable engineers do what they were hired for: they dive into the technical problem. Without an agreed way of responding, that energy scatters. Step 1 imagines Acme Shop's Saturday evening that way. Checkout `1.43.0` rolled out at 20:05, the payment provider slowed down around 20:09, and checkout requests began to fail. Nine people pile into the shared `#checkout` channel and debug at once, two of them restart the checkout pods in the same minute and make the errors jump, support has no answer for customers, the status page still says everything is fine, managers ask for an update every few minutes, and nobody knows who may decide to roll back.

Each person acts sensibly by their own lights, but nobody holds the whole picture. Chapter 14 of Google's *Site Reliability Engineering* (2016), "Managing Incidents" by Andrew Stribblehill, tells a story like this and names three hazards that make it spiral:

- **A sharp focus on the technical problem.** The on-call engineer is so busy changing things that nobody steps back to think about mitigation, impact or who else should help.
- **Poor communication.** Nobody knows what colleagues are doing, and leaders and customers are left to guess.
- **Freelancing.** Well-meaning people change production without coordinating, and in the book's story one such change makes the outage much worse.

The price is a longer outage, damage from overlapping changes, customers who find out from failed payments instead of from you, and responders who are exhausted before the problem is understood.

## How it works

Incident management is a response structure that a team agrees on, writes down and practises before anything breaks, so that during an incident people only have to step into roles instead of inventing a process under pressure.

**Where it comes from.** Google based its incident management on the US Incident Command System (ICS), as both the SRE book (chapter 14) and *The Site Reliability Workbook* (2018, chapter 9, "Incident Response", by Jennifer Mace, Jelena Oertel, Stephen Thorne and Arup Chakrabarti of PagerDuty, with Jian Ma and Jessie Yang) explain. FEMA's training material traces ICS back to FIRESCOPE (Firefighting Resources of California Organized for Potential Emergencies), a 1970s collaboration of local, state and federal agencies in California; ICS is now part of the US National Incident Management System (NIMS) and is used for every kind of emergency. Software teams borrowed its core ideas: a single commander, roles that grow and shrink with the incident, and an explicit transfer of command.

**The elements.** The SRE book lists four features of a well-run response:

- **Separate responsibilities, recursively.** Distinct people take incident command, operational work, communication and planning, and anyone whose load grows too large delegates part of it in turn. Clear roles give people more autonomy, not less, because nobody has to second-guess what colleagues are doing.
- **A recognised command post.** Everyone involved works in one known place, a war room or a chat channel; at Acme that is `#inc-checkout-1003`.
- **A live incident state document.** The commander's most important job is a shared document with the current state at the top, kept for the postmortem afterwards. The book notes that one Google team keeps it on a different product from the one it might be fixing, since depending on a broken system to manage its own outage ends badly.
- **A clear, live handoff.** Command passes explicitly, with the new commander briefed and confirming, never by drifting away.

The workbook sums up the purpose as the **three Cs**: coordinate the response, communicate among responders, across the organisation and with the outside world, and keep control of what is being changed.

**The roles.** The names differ between sources; the jobs are the same. The commander holds every role that has not been handed out yet, so in a small incident one person may do it all.

| Role at Acme | The job during the incident | Google SRE books | PagerDuty | Atlassian |
|---|---|---|---|---|
| **Incident commander:** Mai | Holds the overall picture, assigns roles, makes the calls and keeps the incident document current; does not debug | Incident Commander (IC) | Incident Commander | Incident manager |
| **Operations lead:** Tom | Runs the technical work; only the operations team changes production | Operations Lead (OL) | (fixes come from subject matter experts) | Tech lead |
| **Communications lead:** Ploy | Status page, support and managers, on a fixed rhythm | Communications Lead (CL) | Customer liaison, internal liaison | Communications manager |
| **Scribe** | Writes the timeline, the decisions and the follow-ups into the incident document | (the commander owns the document) | Scribe | (a second incident manager can keep the timeline) |
| **Experts, as needed** | Join when the commander asks and work under the operations lead | (join the operations work) | Subject matter experts | (more tech leads for parallel streams of work) |

The SRE book also has a planning role for the longer-term work: filing bugs, arranging handoffs to the next shift and tracking what was changed so it can be put back afterwards. PagerDuty also has a deputy who backs up the commander, and its commander training says plainly that the commander delegates every repair action and does not check graphs or read logs.

**The lifecycle, on Acme's evening.**

1. **Detect.** Errors begin around 20:09. The SLO burn-rate alert (12% errors against a 99.9% objective is a burn rate of 120×; see [SLOs & Error Budgets](../slo-error-budgets/)) pages Mai, the checkout on-call engineer, at 20:14; why it took five minutes is a question for the postmortem.
2. **Respond.** Mai acknowledges at 20:17, declares a SEV-2, opens `#inc-checkout-1003` and the incident document, and takes command. Tom becomes operations lead, Ploy (the support lead) communications lead, and a scribe starts the timeline.
3. **Mitigate.** Mai asks what changed. Tom rolls back to `1.42.0` at 20:24, and because the payment provider is still slow, Tom also turns on the existing `payments.fallback` flag at 20:31, which routes payments to a second provider. At 20:36 errors are back to 0.3%: 22 minutes after the page, customers can pay again. The root cause waits. The workbook describes Google's order as stop the impact first, then find the cause, and its case studies show that a generic mitigation such as a rollback only needs to know *where* the problem is, not *why*.
4. **Resolve.** The provider recovers at 21:10. At 21:30 Mai resolves the incident, calls off the response and leaves a handoff note: checkout stays on `1.42.0`, and the follow-ups belong to the postmortem. About 1,240 checkout attempts failed, and customers could retry them.
5. **Learn.** A blameless postmortem is scheduled, with the scribe's timeline as its backbone. That part is its own page: [Blameless Postmortems](../blameless-postmortems/).

**Severity levels.** A severity scale decides who gets paged and how much process starts, and it saves arguing during the incident. Sources differ in the number of levels: PagerDuty's public documentation uses SEV-1 to SEV-5 and treats SEV-1 and SEV-2 as major incidents, while Atlassian's handbook uses three levels and pages people for the top two. Acme's scale, an example only:

| Level | Acme's definition (illustrative) | Response |
|---|---|---|
| SEV-1 | Checkout or the whole shop down for most customers, data loss, or a security breach | Page the commander and every owning team now; status page; leadership informed |
| SEV-2 | A core journey (checkout, payments, search) failing for many customers | Page the owning team's on-call, declare, fill the roles, status page |
| SEV-3 | A minor feature broken or slow, or a workaround exists | The owning team fixes it in working hours; no status page unless support asks |
| SEV-4 | No customer impact yet: lost redundancy, a risk that could grow | A ticket for the owning team |

**Communication.** Atlassian's handbook gives a template for internal updates: one or two sentences on the current state and the impact, a short *current status*, a short *next steps*, and when and where the next update will come. It also asks commanders to say plainly what is not known yet. Acme sends an update every 30 minutes, its own choice (PagerDuty's documentation suggests roughly 30 minutes for executive summaries): the status page read *Investigating* at 20:20, *Monitoring* at 20:50 and 21:20, and *Resolved* at 21:30, support had a known-issue reply from 20:20, and managers got the same updates on the same rhythm, so nobody had to chase the responders.

## Putting it into practice

1. **Write down when to declare.** Use criteria a tired engineer can apply in seconds. The SRE book gives one team's: a second team is needed, customers can see the problem, or it is still unsolved after an hour of concentrated work. Declaring is cheap when closing is cheap, so the advice in both Google books is to declare early.
2. **Agree on a severity scale** with what each level triggers, and the rule for doubt that PagerDuty uses: when unsure between two levels, take the higher one and review it in the postmortem.
3. **Prepare the command post.** A naming convention for incident channels (Acme's look like `#inc-checkout-1003`), an incident document template with the state at the top, and a list of who to page for each service. The workbook adds: pick the channel before you need it, and keep two or three ready-made announcement templates.
4. **Make the roles real.** The person who declares usually takes command until they hand it over; larger organisations run a separate commander rotation. Train commanders, and rotate the roles so everybody knows each one.
5. **Keep generic mitigations ready.** A one-step rollback, feature flags that switch off or reroute a dependency, draining a zone, failing over a database. Put them in the runbook: at Acme the `payments.fallback` flag existed but was not in the runbook, one of the contributing factors the postmortem found.
6. **Communicate on a rhythm**, with separate audiences for customers (the status page), support (a known-issue reply) and internal stakeholders (one channel or mailing list), and always say when the next update will come.
7. **Close deliberately.** Resolve the incident, tell everyone the response is over, write the handoff note (what is running now, what is still open, who owns the follow-ups), and schedule the postmortem.
8. **Practise.** Google's SRE teams run *Wheel of Misfortune* sessions, in which a game master plays out a past or invented outage and the on-call engineers respond (SRE book, chapter 28). The workbook suggests drills built from past postmortems and running minor incidents with the full process; PagerDuty trains responders in its Failure Friday exercises, and Atlassian has trainee commanders draft and read out the communications for a made-up incident. Game days from [Chaos Engineering](../chaos-engineering/) exercise the response along with the system.
9. **Choose tools as examples, not requirements.** Paging and on-call schedules (PagerDuty, or Jira Service Management, into which Atlassian is moving Opsgenie before shutting Opsgenie down on 5 April 2027), chat (Slack, Microsoft Teams), a status page (Atlassian Statuspage) and an incident bot that opens the channel, creates the document from its template and posts alerts and timeline entries. Keep the document and the communication path independent of the systems that might be down.
10. **Measure carefully.** Google's *Incident Metrics in SRE* (Štěpán Davidovič, 2021) shows that incident durations are positively skewed, with most incidents short and a few very long, so the mean (MTTR and its relatives) moves a lot even when nothing about the incidents has changed. It concludes that such means say little about reliability and cannot show whether a process change worked. Measure reliability with SLOs, and to judge a change to the response, look at the step it changed in a sample of incidents you study closely. The VOID, a community database of public incident reports, uses those reports to question duration, severity and MTTR as measures.

## Where it fits

- **[SLOs & Error Budgets](../slo-error-budgets/)** produce the alert that starts the response: a burn-rate page means users are being hurt now. The error budget is also a better measure of reliability over time than average incident durations.
- **[Golden Signals, RED & USE](../golden-signals/)** decide what is worth paging on, and give the commander and the operations lead a quick view of latency, traffic, errors and saturation while they look for what changed.
- **[You Build It, You Run It](../you-build-it-you-run-it/)** is why the first person paged was Mai, a checkout engineer who could act on the checkout service; incident management is how one owning team pulls in others when a problem crosses team lines.
- **[Canary Release](../canary-release/)** and **[Feature Flags](../feature-flags/)** are the mitigation tools of step 3: a quick rollback and a flag that reroutes a dependency. Acme's canary passed `1.43.0` because its analysis compared error rate and p95 latency on the main path only, not payment latency.
- **[Timeout & Fallback](../timeout-and-fallback/)** and **[Circuit Breaker](../circuit-breaker/)** are the design side of the same story: the upgraded payment client waited up to 30 s by default, so request threads piled up instead of failing fast and falling back.
- **[Chaos Engineering](../chaos-engineering/)** gives the response its practice runs, and **[Blameless Postmortems](../blameless-postmortems/)** turns the scribe's timeline into lessons and owned action items once the incident is over.

## When to use it

**Where it pays off.** Any service that customers or other teams depend on, and any problem that needs more than one person, crosses team boundaries, is visible to customers or lasts longer than a quick fix. The more people involved, the more the roles matter: in the workbook's case study of a Google [Kubernetes](../kubernetes/) Engine outage, 41 people joined the chat channel over the incident's lifetime.

**Scale it to the team.** A team of five does not need five roles. The commander holds every role not handed out, so a small incident may have one person in command and doing the operations work, with someone else writing the updates. What does not shrink is the habit: declare, one channel, one document, a named commander, regular updates, a clean close. Large organisations go the other way, with a dedicated commander rotation, separate internal and external communications, and sub-incidents with their own leads.

**Where it costs more than it returns.** Declaring every routine page as an incident creates noise and fatigue, so keep the declaration criteria about impact and coordination, and resolve quickly when the fix is simple. The process takes practice time and on-call capacity that a team has to plan for. Some incidents need more than this page describes: security incidents and data breaches usually run on a separate track with legal, privacy and forensic steps, and regulated businesses may have to notify authorities. Where an old system is run by a separate operations group, agree in advance who commands and how the handoff between teams works.

## Common pitfalls

- **The hero who fixes it alone.** One engineer quietly works the problem for an hour while nobody else knows it exists. *Instead:* declare early and pull people in; Atlassian's handbook tells responders not to hesitate to escalate, and the SRE book's own story shows the cost of waiting.
- **A commander who debugs.** Once the commander starts reading logs, nobody is coordinating, communicating or watching the clock. *Instead:* the commander delegates the fixing; if they must do hands-on work, they hand command to someone else first, as the workbook describes.
- **Arguing about severity instead of declaring.** Ten minutes spent deciding between SEV-2 and SEV-3 is ten minutes of unmanaged incident. *Instead:* declare at the higher level when in doubt, downgrade later, and review the choice in the postmortem.
- **Mean time to recover as a target.** Because incident durations are skewed, the mean swings with a single long incident, and a target can tempt people to close incidents early or split them. *Instead:* track SLOs and error budgets, and learn from each incident's timeline.
- **Root cause before mitigation.** Hunting for the real cause while customers keep failing lengthens the outage. *Instead:* stop the impact with a rollback, a flag or a failover first, and find the cause once customers are safe.
- **Changes from outside the operations team.** Two people restarting the same pods, as in step 1, is the SRE book's freelancing. *Instead:* only the operations lead's team changes production, and every change is announced in the channel.
- **Silence, or forgetting to close.** Without updates, people assume nothing is being done; without a clear close, they assume it is still going on. *Instead:* send updates on a fixed rhythm with the time of the next one, and announce the end of the response.
- **A process that exists only on paper.** Skills fade when they are not used. *Instead:* practise with role-play, drills and game days, and rotate the roles.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Blameless Postmortems](../blameless-postmortems/) — Learn from every incident without blame: a timeline, the contributing factors and tracked action items, shared widely.
- [You Build It, You Run It](../you-build-it-you-run-it/) — The team that builds a service runs it in production, on call, so the people who can fix a problem hear about it first.
- [Golden Signals, RED & USE](../golden-signals/) — What to measure and alert on: latency, traffic, errors and saturation, RED for request-driven services and USE for resources.
- [SLOs & Error Budgets](../slo-error-budgets/) — Measure SLIs against an objective and alert on error-budget burn rate, not on every blip.
- [Feature Flags](../feature-flags/) — Deploy code dark, then turn features on per user or percentage at runtime.
- [Timeout & Fallback](../timeout-and-fallback/) — Bound every remote call and degrade gracefully when the time runs out.
- [Chaos Engineering](../chaos-engineering/) — Inject failures on purpose to prove the system degrades the way you expect.
- [Canary Release](../canary-release/) — Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back.

## References

- [Google SRE Book — Managing Incidents (chapter 14)](https://sre.google/sre-book/managing-incidents/)
- [Google SRE Book — Emergency Response (chapter 13)](https://sre.google/sre-book/emergency-response/)
- [Google SRE Workbook — Incident Response (chapter 9)](https://sre.google/workbook/incident-response/)
- [Google SRE Book — Accelerating SREs to On-Call and Beyond (chapter 28)](https://sre.google/sre-book/accelerating-sre-on-call/)
- [Google SRE — Incident Metrics in SRE (Štěpán Davidovič, 2021)](https://sre.google/resources/practices-and-processes/incident-metrics-in-sre/)
- [PagerDuty Incident Response Documentation](https://response.pagerduty.com/)
- [PagerDuty Incident Response — Different Roles](https://response.pagerduty.com/before/different_roles/)
- [PagerDuty Incident Response — Severity Levels](https://response.pagerduty.com/before/severity_levels/)
- [Atlassian — Incident Management Handbook](https://www.atlassian.com/incident-management/handbook)
- [Atlassian — How we respond to an incident](https://www.atlassian.com/incident-management/handbook/incident-response)
- [FEMA Emergency Management Institute — ICS Resource Center](https://training.fema.gov/emiweb/is/icsresource/)
- [The VOID — 2024 Report](https://www.thevoid.community/report-2024)
- [Atlassian — Migrate from Opsgenie](https://www.atlassian.com/software/opsgenie/migration)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
