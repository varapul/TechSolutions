<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧭 DevOps & SRE Principles](../../README.md#devops--sre-principles)

# Blameless Postmortems

> Learn from every incident without blame: a timeline, the contributing factors and tracked action items, shared widely.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Blameless Postmortems" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/blameless-postmortems.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Blame stops the learning** | After the checkout SEV-2 of Saturday 3 October, the review asks one question, *who pushed the deploy?*, and singles out the engineer who merged release 1.43.0. The report, shared with three people, names **human error** as the root cause and ends with one action, *be more careful*, with no owner and no date. Next time people hide mistakes, put off deploys and leave details out, and six weeks later the delivery team's carrier calls hang on a 30 s library default: the same failure, with no warning. |
| **2 · A blameless postmortem** | Mai, Tom and Ploy write the postmortem within five working days (an Acme rule). The timeline comes from the scribe's incident doc, the impact from the graphs (about 27 minutes of elevated errors, about 1,240 failed checkout attempts that customers could retry, no data loss, no double charges), and the text says what the system and the people knew and did: the canary analysis compared only error rate and p95 latency on the main path, so 1.43.0 passed. Instead of one root cause there are **four contributing factors**, plus what went well (the `payments.fallback` flag existed) and where they got lucky (a Saturday evening, not a sale). |
| **3 · Follow up and share** | A facilitator from the SRE group runs the review with everyone involved on Thursday 8 October. Each action item goes into the owning team's backlog with one owner, a due date and a priority: a 3 s payment timeout with a retry budget (Tom, 14 Oct), payment latency in the canary analysis (Mai, 21 Oct), the fallback steps in the runbook (Ploy, 10 Oct) and a review of the alert windows (SRE group, 28 Oct); by 21 October three are done and the fourth is on schedule. The postmortem goes into the searchable repository, where the delivery, search and mobile teams find it, and the platform team makes explicit timeouts part of the shared client library. |
| **4 · Common pitfalls** | **Blameless is not consequence-free**: people stay accountable by giving a full account and owning the follow-up, not by being punished. Calling the cause *human error*, or stopping at a single root cause, ends the inquiry before it reaches the conditions that made the mistake easy. Action items with no owner or date never close, near misses deserve a short review because they teach the same lesson for less, and a template filled in alone misses what people knew and why their actions made sense. |
<!-- END GENERATED: header -->

## The problem

After an outage, the easiest story to tell is that somebody made a mistake. A manager asks who pushed the deploy, the report names *human error*, and the only action item says *be more careful*. It feels like closure, but the organisation learns almost nothing. The engineer who merged the change knows more about what happened than anyone, and once they are blamed, they and everyone watching learn to say less: mistakes go unreported, deploys that look risky get postponed and bundled into bigger ones, and incident reports leave out the awkward details. The conditions that made the mistake easy (a library default nobody checked, a canary that watched the wrong signal, a runbook with a step missing) stay where they are, and the next team walks into the same failure.

That is how the diagram's first step goes at Acme Shop. On Saturday 3 October 2026 checkout release 1.43.0 upgraded the payment client library, whose default timeout went from 3 s to 30 s. When the payment provider slowed down that evening, checkout's request threads waited up to 30 s each, piled up, and checkout requests failed for about 27 minutes. The blame version of the review singles out the engineer who merged the release, files one action with no owner and no date, and shares the report with three people. Six weeks later the delivery team's calls to a carrier API hang on the same kind of 30-second library default.

## How it works

A **postmortem** is a written record of an incident: its impact, what was done to mitigate and resolve it, why it happened, and the follow-up work that makes a repeat less likely. Chapter 15 of Google's *Site Reliability Engineering* book (*Postmortem Culture: Learning from Failure*, by John Lunney and Sue Lueder) presents it as a learning opportunity for the whole company and explicitly not a punishment, and makes it **blameless**: the write-up takes it as given that the people involved meant well and made reasonable choices with what they knew at the time, and it looks for what to change in systems and processes rather than for a person to fix. The chapter traces the idea to healthcare and avionics, where mistakes can be fatal and each one is treated as a chance to make the system safer.

John Allspaw's 2012 post *Blameless PostMortems and a Just Culture*, about the practice at Etsy, explains why it works. An engineer who does not fear punishment can give a detailed account of what they did and when, what they saw, what they expected and assumed, and how they understood the timeline while it unfolded. That account is the information the organisation needs, and people who feel safe giving it tend to become the ones who teach everyone else how to avoid the same trap. Allspaw draws on safety researchers such as Sidney Dekker and Erik Hollnagel and on the book *Behind Human Error*, and calls the goal a **just culture**: one that balances safety with accountability.

### The document

The SRE book prints a complete example (appendix D) with a summary, impact, root causes and trigger, resolution, detection, action items, lessons learned (what went well, what went wrong, where we got lucky), a timeline and supporting information. Templates differ between companies. The sections in the diagram are the ones Acme Shop uses, filled in for 3 October:

| Section | What goes in it | Acme Shop, 3 October 2026 |
|---|---|---|
| Summary | Two or three sentences a stranger can follow | A new 30 s default timeout met a slow payment provider, and checkout requests failed |
| Impact | Who was affected, how much and for how long, with numbers | about 27 minutes of elevated errors (from about 20:09 to 20:36), about 1,240 failed checkout attempts that customers could retry, no data loss, no double charges |
| Timeline | What happened when, rebuilt from the incident doc, the channel log, graphs and the deploy log | 20:05 1.43.0 rolls out and its canary passes; 20:09 the provider slows down; 20:14 page; 20:17 SEV-2 declared; 20:24 rollback starts; 20:31 `payments.fallback` on; 20:36 mitigated; 21:10 provider recovers; 21:30 resolved |
| Contributing factors | The conditions that together allowed the incident | the payment client's default timeout went from 3 s to 30 s; the canary analysis compared only error rate and p95 latency on the main path; the fallback flag existed but was not in the runbook; with a 5-minute alert window, errors began around 20:09 but the page came at 20:14 |
| What went well | What helped and should be kept | the `payments.fallback` flag existed and worked; roles were assigned 3 minutes after the page |
| Where we got lucky | What limited the damage by chance and won't next time | a Saturday evening, not a sale |
| Action items | Specific, with one owner, a due date and a priority, tracked in the owning team's backlog | a 3 s payment client timeout with a retry budget (Tom, 14 October); payment latency in the canary analysis (Mai, 21 October); the fallback steps in the runbook (Ploy, 10 October); a review of the alert windows (SRE group, 28 October) |

### Writing about people's decisions

The hard part of a blameless postmortem is the prose. Hindsight makes the right action look obvious, and phrases like *should have*, *failed to* or *didn't check* judge people against knowledge they did not have at the time. Dekker's *The Field Guide to Understanding 'Human Error'* (3rd edition, 2014) is a practical guide to avoiding this. It contrasts the old view, in which a few unreliable people (the "bad apples") make an otherwise safe system fail, with a new view that treats their errors as the starting point of an investigation into the system, and it warns about hindsight bias and counterfactual "they should have" reasoning. The question to answer for each action is why it made sense to the person at that moment, given what they knew, what they were trying to do and where their attention was; safety researchers call this local rationality.

In practice that means writing about the information and the system rather than about the person:

| Instead of | Write |
|---|---|
| The engineer pushed a bad release. | Release 1.43.0 upgraded the payment client library, which changed the default timeout from 3 s to 30 s. Checkout relied on the default, so its own code showed no timeout change. |
| The canary should have caught it. | The canary analysis compared error rate and p95 latency on the main path. Payment latency was not one of its signals, so 1.43.0 passed. |
| On-call was slow to find the fallback. | The `payments.fallback` flag existed but was not in the runbook. The rollback started at 20:24 and the flag went on at 20:31. |

### Reviewing and sharing

The SRE book recommends sharing the draft and having senior engineers review it for completeness: was the key data collected, is the impact assessment complete, does the analysis go deep enough, are the action items appropriate and filed at the right priority, and has the outcome reached the people who need it? Reviewed postmortems go into a repository other teams can search. Chapter 10 of *The Site Reliability Workbook* compares a bad and a good postmortem of the same outage. The bad one leaves out context and key numbers, points fingers in emotional language, names four owners for the document but no clear owner for most action items, files a tracking bug for only one of them, is shared only within the team and comes out four months late, by which time the incident had happened again. The chapter also cites Ben Treynor Sloss's rule at Google that a postmortem of a user-affecting outage must have at least one P0 or P1 bug attached.

To spread the lessons, the SRE book describes a *postmortem of the month* sent to the whole organisation, postmortem reading clubs where a team walks through an old incident together, and Wheel of Misfortune exercises in which new engineers replay a past postmortem as a role-playing game.

## Putting it into practice

1. **Decide the triggers before the next incident.** The SRE book's examples make a good starting list: user-visible downtime or degradation beyond a threshold, data loss of any kind, an on-call intervention such as a rollback or rerouting traffic, a resolution time above a threshold, or a monitoring failure that meant people found the incident by hand. Let anyone request a postmortem, and include near misses. Atlassian's handbook, for comparison, requires one for severity 1 and 2 incidents and leaves it optional below that.
2. **Give it an owner and a deadline.** Acme's rule is a draft within five working days, written by the people who were involved (here Mai, Tom and Ploy) while memories are fresh. At Atlassian the team that owns the faulty service picks a postmortem owner, who takes it through review and approval.
3. **Rebuild the timeline from the evidence**: the incident doc kept by the scribe, the channel log (`#inc-checkout-1003`), the graphs, the deploy and audit logs. The timeline separates what people knew at each moment from what everyone knows now.
4. **Hold a facilitated review.** A facilitator who wasn't involved (at Acme, someone from the SRE group) restates that the review is blameless, walks through the timeline, collects contributing factors and asks open questions. Atlassian's suggested agenda follows the same order: remind everyone why the review is blameless, confirm the timeline, confirm the causes, then generate actions.
5. **Turn the findings into tracked work.** Each action item gets one owner, a due date and a priority, and lives in the owning team's backlog (Jira, GitHub Issues or whatever the team plans its work in), not only in the document. Track completion: Atlassian gives its "priority actions" a target of four or eight weeks depending on the service, with reminders and reports. Acme had 3 of 4 done by 21 October and the fourth on schedule.
6. **Publish it where people look.** A searchable repository (a wiki space, Markdown files in Git, or the postmortem feature of an incident tool) with consistent tags for service, severity and contributing factors lets a search for *timeout* find this incident, and lets someone spot trends across incidents.
7. **Fix the class of problem, not just this instance.** Acme's platform team made explicit timeouts part of the shared client library, so no team inherits a 30-second library default again.
8. **Keep the habit alive**: a postmortem of the month, a reading group, old incidents replayed as game days, and leaders who use blameless language themselves and visibly reward the people who write postmortems and close their action items.

## Where it fits

- **[Incident Management](../incident-management/)** covers the same event while it happens: declaring the SEV-2, the roles (Mai as incident commander, Tom as operations lead, Ploy on communication, a scribe) and the incident doc this page's timeline is rebuilt from. The postmortem is where the response ends and the learning starts.
- **[SLOs and Error Budgets](../slo-error-budgets/)** define what counts as user-visible impact, and the burn-rate alert that paged Mai is built on them; a missed SLO or a large budget burn is a common postmortem trigger. The fourth contributing factor, the 5-minute alert window, is a question about those alerting rules.
- **[Canary Release](../canary-release/)** and **[Feature Flags](../feature-flags/)** appear in the contributing factors and in what went well: the canary analysis watched the wrong signals, and the `payments.fallback` flag shortened the outage. The main action item applies **[Timeout & Fallback](../timeout-and-fallback/)**, with a retry budget as described in **[Retry with Backoff](../retry-with-backoff/)**.
- **[Chaos Engineering](../chaos-engineering/)** checks that the fixes hold: a game day that slows the payment provider on purpose shows whether the new timeout and the fallback behave as planned.
- **[The Three Ways](../three-ways/)** puts postmortems under the third way, continual learning, and **[You Build It, You Run It](../you-build-it-you-run-it/)** makes the team that owns a service the one that writes its postmortems and carries out the actions. **[DORA Metrics](../dora-metrics/)** such as change fail rate and failed deployment recovery time show over months whether the follow-up is working.

## When to use it

Postmortems pay off wherever incidents affect users or come back: any team that runs a production service, and especially organisations where several teams share platforms and libraries, because one team's lesson can protect the others. They are cheapest as a habit that includes near misses: a near miss reviewed in half an hour often shows the same weak spot as a large outage, for a fraction of the cost.

Adapt the practice rather than copying a big company's process:

- **Small teams** can use a one-page template and a 30-minute conversation. The sections and the blameless tone matter more than the ceremony.
- **Regulated industries** may owe a regulator or a customer a formal incident report, with its own rules about wording, legal review and disclosure. Keep the internal learning document separate from it, and agree with legal counsel what the internal one may contain.
- **Deliberate harm is a different matter.** Blameless reviews assume people were trying to do the right thing; sabotage or malicious acts belong to a separate process (security, HR) and are rare. Dekker's *Just Culture: Restoring Trust and Accountability in Your Organization* (3rd edition, 2016) describes two ways to hold people to account after an incident: a retributive one that asks which rule was broken, by whom and what the consequence should be, and a restorative one that asks who was hurt, what they need and whose job it is to meet that need, often with help from the people involved.
- **Third-party failures**, such as the payment provider's own incident here, still deserve a postmortem of your side: how your system behaved when the dependency degraded, and what you control.

It costs more than it returns when a full postmortem is required for every minor alert: the writing then eats the time it was meant to save. Set triggers and use a lighter format below them. A process with no time set aside for the action items produces documents, not improvements.

## Common pitfalls

- **Reading blameless as consequence-free.** Accountability changes shape rather than disappearing: people are accountable for giving a full account and for the follow-up (Tom owns the timeout fix), not for being punished. Say this out loud in the review, because both managers and engineers misread it.
- **Naming human error as the root cause.** It stops the inquiry exactly where it should start. Ask what made the error possible and easy (a default that changed silently, a check that watched the wrong signal) and fix that.
- **Hunting for a single root cause.** Incidents in complex systems usually need several conditions at once. Acme's had four, and fixing any one of them would have left the other three in place. List the contributing factors and address the ones that matter most; a five-whys exercise is a useful prompt, but a single chain of whys tends to stop at one cause, so ask *what else?* at each step.
- **Action items that never close.** Actions with no owner, no date or no priority turn the postmortem into a document rather than an improvement. Give each item one owner, a due date and a ticket in the team's backlog, review open items regularly, and treat a repeat incident as a sign that the follow-up failed.
- **Postmortems only for big outages.** Near misses (an alert with no customer impact, a deploy rolled back in time) show the same weak spots for much less pain. Use a short format and keep the bar low.
- **A template filled in without a conversation.** A form completed by one person after the fact records what happened but rarely why it made sense to the people involved. Hold the review with everyone who took part, with a facilitator, and write from that conversation.
- **Blameful language creeping back.** "Should have", "failed to" and "careless" slip in even with good intentions. Read the draft for them before the review and rewrite them in terms of what people knew and saw.
- **Filing it away.** A postmortem nobody else reads protects one team at most. Share it widely, tag it so it can be found, and turn repeated lessons into shared defaults, as Acme's platform team did with timeouts.
- **Publishing late.** The workbook's bad example came out four months after the incident, which had already happened again. Set a deadline and keep it.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Incident Management](../incident-management/) — A practised response when production breaks: declare early, assign roles, mitigate first and keep everyone informed.
- [The Three Ways](../three-ways/) — DevOps in three principles: speed the flow of work to customers, amplify feedback back to the team, and keep learning.
- [SLOs & Error Budgets](../slo-error-budgets/) — Measure SLIs against an objective and alert on error-budget burn rate, not on every blip.
- [Chaos Engineering](../chaos-engineering/) — Inject failures on purpose to prove the system degrades the way you expect.
- [You Build It, You Run It](../you-build-it-you-run-it/) — The team that builds a service runs it in production, on call, so the people who can fix a problem hear about it first.
- [Canary Release](../canary-release/) — Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back.
- [Timeout & Fallback](../timeout-and-fallback/) — Bound every remote call and degrade gracefully when the time runs out.
- [Feature Flags](../feature-flags/) — Deploy code dark, then turn features on per user or percentage at runtime.
- [DORA Metrics](../dora-metrics/) — Measure software delivery by throughput and stability: how often and how fast changes reach production, and how often they fail.

## References

- [Google SRE Book — Postmortem Culture: Learning from Failure (chapter 15)](https://sre.google/sre-book/postmortem-culture/)
- [Google SRE Book — Example Postmortem (appendix D)](https://sre.google/sre-book/example-postmortem/)
- [Google SRE Workbook — Postmortem Culture: Learning from Failure (chapter 10)](https://sre.google/workbook/postmortem-culture/)
- [John Allspaw — Blameless PostMortems and a Just Culture (Etsy Code as Craft, 2012; archived copy)](https://web.archive.org/web/20241229160330/https://www.etsy.com/codeascraft/blameless-postmortems/)
- [Sidney Dekker — The Field Guide to Understanding 'Human Error', 3rd edition (CRC Press, 2014)](https://www.routledge.com/The-Field-Guide-to-Understanding-Human-Error/Dekker/p/book/9781472439055)
- [Sidney Dekker — Just Culture: Restoring Trust and Accountability in Your Organization, 3rd edition (2016)](https://sidneydekker.com/just-culture)
- [Atlassian Incident Management Handbook — Postmortems](https://www.atlassian.com/incident-management/handbook/postmortems)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
