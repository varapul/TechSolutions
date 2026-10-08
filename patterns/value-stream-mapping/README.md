
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧭 DevOps & SRE Principles](../../README.md#devops--sre-principles)

# Value Stream Mapping

> Draw how a change travels from idea to customer, compare the time spent working with the time spent waiting, and remove the biggest wait.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Value Stream Mapping" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/value-stream-mapping.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Nobody sees the whole flow** | Acme Shop's delivery team adds return labels for a second courier, change **DLV-214**. Every team on the way reports its own step as fast: an hour of triage, a day of development, 2 hours of code review, 2 hours of security review, an hour to set up a test environment, 4 hours of QA, an hour for the weekly change board and an hour to release. Those 20 hours add up to 2.5 working days, yet customers get the labels 22.5 working days after the request, and when support asks for a date, each team answers for its own step and nobody can give one. (Acme's numbers are the example's own; a day here is a working day of 8 hours.) |
| **2 · Map the current state** | Someone from every step, seven people in all, and the engineering director, who can change the rules, walk DLV-214 through the flow, reading each time from the tickets and the pull request. Each step gets its **process time** (the hands-on work), its **lead time** (from receiving the work to passing it on, waiting included) and its **percent complete and accurate** (%C/A, the share of what it receives that it can use as it is): 60% for QA, which sends 4 in 10 changes back, and 80% for development, which has to ask the product manager about 1 in 5 requests. Five queues hold 20 of the 22.5 days (6 in the backlog, 2 for review, 5 for security, 3 for a test environment, 4 for the board): an **activity ratio** of 2.5 ÷ 22.5 = 11%, and a rolled first-pass yield of 80% × 60% = 48%, the share of changes that get through without rework. |
| **3 · Design the future state** | The team picks the four biggest waits, 18 of the 20 days, and draws a **future-state map** with a kaizen burst on each change. Daily triage and a limit on work in progress cut the 6-day backlog to 1 day (and the 2-day wait for review to 1, because reviews now come before new work), automated policy checks in CI replace the 5-day security review queue, test environments that the team creates itself from Launchpad's golden path replace the 3-day ticket, and peer review becomes the approval for standard changes instead of 4 days waiting for the weekly board. The plan: 4 days of lead time for 2 days of work (an activity ratio of 50%), with an owner and a date for each change. Three months later the team walks a new change, DLV-301, and measures 4.5 days; QA still sends 4 in 10 changes back, so that becomes the next target. |
| **4 · Pitfalls and limits** | A map drawn from the process wiki shows how work should flow (5 steps, 3 days) rather than how DLV-214 really flowed (8 steps, 22.5 days): walk a real change, with the people who did the work. A map filed after the workshop lets the waits creep back unseen, so map again on a schedule and after each change. Halving QA's 4-hour test run speeds up a step that isn't the bottleneck and takes about 1% off the lead time, a nicer ticket portal for test environments keeps the 3-day handoff, and a first map of 60 boxes, down to clicks and form fields, hides the big waits: start with 5 to 15 blocks and zoom in where it matters. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's delivery team wants customers to be able to send returns with a second courier. The change is small, about a day of development, yet change DLV-214 reaches customers 22.5 working days after the request. Every team on the way is busy and reports its own step as fast: the product manager triages the request in an hour, code review takes 2 hours, the security team's review 2 hours, the platform team sets up a test environment in an hour, QA tests in 4 hours and the weekly change board spends an hour on it. Those numbers add up to 20 hours, 2.5 working days. The other 20 days pass in queues between the teams: the backlog, the wait for a reviewer, the security team's ticket queue, the platform team's environment queue and the wait for the next board meeting. (Acme's numbers are the example's own, not research findings; a day on this page is a working day of 8 hours.)

Nobody measures those waits, because nobody owns them. Each team improves the part it can see, so the security team is proud of a 2-hour review while the ticket waits 5 days in front of it, and when support asks when the feature will ship, every team answers for its own step and no one can give a date. Without a picture of the whole flow, a discussion about where to improve runs on opinions, and effort tends to go to the step whose owner complains loudest, or to a new tool for one team, while the queues stay where they are.

## How it works

A value stream is every step, adding value or not, that a request passes through on its way to the customer. Value stream mapping draws that stream on one page, with a few measurements for each step, so that the people who own the steps see the same picture: where the work is done, where it waits and where it comes back for rework.

### Where it comes from

Toyota drew *material and information flow diagrams* as part of the Toyota Production System, and the Lean Enterprise Institute (LEI) describes value stream mapping as the tool Toyota developed under that name. Mike Rother and John Shook's workbook *Learning to See* (LEI), which received a Shingo Research Prize in 1999, introduced it to a wide audience in manufacturing: map the current state of one product family's flow from order to delivery, design a future state, and plan how to get there. Karen Martin and Mike Osterling's *Value Stream Mapping* (McGraw-Hill, 2013) adapted the method to office, service and knowledge work, where the work item is a request, a document or a code change and where shared specialists serve many value streams at once. They treat mapping as a management practice: the people who map should include leaders with the authority to change how the work is organised, and the map should end in a plan that gets carried out.

### What goes on the map

The map stays coarse. DORA's guide to the capability suggests breaking the value stream into 5 to 15 process blocks and noting, for each, the activity and the team that does it. For software, the stream usually runs from a request or idea to the change running in production for customers. Each block gets three numbers (definitions from DORA's guide and the glossary of TKMG, Karen Martin's firm):

| Metric | What it measures | DLV-214 |
|---|---|---|
| **Process time** (PT) | The hands-on time one item needs if someone could work on it without interruption, with everything at hand; also called touch time. | 1 h to 8 h per step, 20 h in all |
| **Lead time** (LT) | For one step, the time from when the work becomes available to that step until it is handed on, so it includes waiting before, during and after the work. The stream's lead time is the sum over the steps. | 22.5 d end to end |
| **Percent complete and accurate** (%C/A) | The share of the work a step receives that it can use as it arrives, without correcting it, adding missing information or asking for clarification. Ask the people in the receiving step; DORA's guide records the figure on the receiving block, as the diagram does. Martin and Osterling write it %C&A. | development 80%, QA 60%, the other steps 100% |

Two summary figures follow from them:

- **Activity ratio** = total process time ÷ total lead time × 100. Martin and Osterling use it as the summary measure of how well work flows. DLV-214: 2.5 ÷ 22.5 = 11%, so for nearly nine days in ten the change was waiting.
- **Rolled first-pass yield** = the product of the steps' %C/A: the share of items that get through every step without rework. DLV-214: 80% × 60% = 48%.

Use one unit for both kinds of time. The example counts working days of 8 hours throughout; in calendar time the same lead time is about four and a half weeks and the activity ratio lower still. There is no single standard for drawing the timeline, as Karen Martin notes in a 2014 post: the traditional square wave puts lead times on the peaks and process times in the troughs under the boxes, and she and Osterling later moved to a single line. The diagram splits each step's lead time into its wait, drawn up in red, and its process time, drawn down in blue.

### Current state, future state, plan

1. **Current state.** Map what actually happened, with the real numbers of the day rather than the ones people would like (DORA's guide), ideally by following real work where it is done, the *gemba*. In office and knowledge work, Martin recommends following a single work item through the stream.
2. **Future state.** Design how the stream should flow at a set date: TKMG's glossary says future-state maps usually look 3 to 12 months ahead, and DORA's guide gives 6 months to 2 years as an example. Mark each change it needs with a *kaizen burst*, the jagged icon in LEI's set of mapping symbols, and estimate the new numbers.
3. **Plan, then map again.** Turn each burst into work with an owner and a date (Martin and Osterling call it the transformation plan), carry it out, and walk the stream again to see what really changed. DORA suggests re-running the exercise on a regular schedule, for example every 6 months, and keeping the maps where everyone can see them.

## Putting it into practice

1. **Choose one value stream and one kind of work.** Acme mapped small changes to the delivery team's services, not "IT" as a whole. Write a short charter first: where the stream starts and ends, the problem (customers wait weeks for small changes), the goal, who takes part and when; LEI's tips stress settling scope before the workshop.
2. **Invite the right people.** Someone from every step, including the ones outside engineering (product, security, the change board, support), plus a leader who can change the policies that create the queues. Martin calls mapping a team sport and warns against maps drawn by an improvement specialist alone or by a group with no authority to act on them; DORA lists missing authority among the common obstacles.
3. **Walk real work.** Pick one or two recent changes of the chosen kind and follow them through the ticket history, the pull request, the chat threads and the deploy log, asking the people at each step what happened. Take times from timestamps rather than memory, then check them against the same figures for the last few dozen changes in the ticket system, so that one unusual change doesn't steer the plan.
4. **Draw the current state.** Paper, a whiteboard or a shared online board is enough; LEI coach Dave LaHote recommends pencil and paper at the place where the work happens over polished diagrams. Add the queues, the timeline and the summary box, and leave out the detail for now.
5. **Read the map together.** Look for the longest waits, the steps with low %C/A that send work back, handoffs that add nothing, approvals that a check could replace, steps run one after another that could run side by side, and batching such as weekly boards or fortnightly planning.
6. **Design the future state and the plan.** Pick the few changes that remove the most waiting, estimate the new numbers, and give every kaizen burst an owner, a date and a measure. Try each change as an experiment before rolling it out widely, as LEI's tips advise. At Acme the bursts became four items: policy checks in CI (security and platform teams), self-service test environments from Launchpad (platform team), a standard-change rule under which peer review approves low-risk changes of a known kind (change board), and daily triage with a WIP limit (delivery team).
7. **Map again and keep the flow visible.** Walk a new change once the plan has landed, and map on a schedule after that. Between maps, a team board with WIP limits and lead times read from the ticket system keeps the waits visible; the Flow Framework, which Mik Kersten introduced in *Project to Product* (2018), is one way to measure software delivery as flow over time, and *Flow Engineering* (Steve Pereira and Andrew Davis, 2024) uses five maps in collaborative sessions to turn what they reveal into a roadmap owned by the people doing the work.

## Where it fits

- [The Three Ways](../three-ways/): a value stream map shows the whole flow that the First Way improves; in Gene Kim's description, the First Way looks at the performance of the entire system rather than of one department. In the first edition of *The DevOps Handbook* (2016), choosing a value stream and making its work visible come in Part II, "Where to Start", before the technical practices of flow.
- [DORA Metrics](../dora-metrics/): DORA's change lead time runs from commit to production, only the right-hand end of this map; the map covers the whole journey from request to customer and shows which part of it is slow. DORA lists *visibility of work in the value stream* among its lean product management capabilities, which its research found to predict better software delivery and organisational performance.
- The fixes in Acme's future state are pages of their own: [Policy as Code](../policy-as-code/) replaces the security ticket for routine checks, [Golden Paths](../golden-paths/) and [Platform as a Product](../platform-as-a-product/) turn the environment ticket into self-service, and [Continuous Delivery](../continuous-delivery/) makes the release a pipeline run. DORA's guidance on streamlining change approval backs peer review over an external board, and [Trunk-Based Development](../trunk-based-development/) keeps the batches small.
- [Team Topologies](../team-topologies/): every handoff on the map is a boundary between teams. Stream-aligned teams that own more of the flow, and platform teams that offer services instead of tickets, remove queues instead of shortening them. [You Build It, You Run It](../you-build-it-you-run-it/) keeps the release and the pager with the team that builds the service, so no separate release team adds a queue.
- [Testing Pyramid](../testing-pyramid/): QA's 60% %C/A, the target after Acme's second map, is the kind of rework that faster automated tests earlier in the pipeline reduce.
- [CALMS](../calms/) names Lean as one of its five dimensions, and a value stream map is a common way to look at it; [SPACE & DevEx](../space-devex/) measure friction from the developer's side, which a map shows from the work item's side. [ITIL 4](../itil-4/) covers the service management processes, such as change approval, that often show up on these maps as queues: the map shows what a control costs in lead time, so the future state can keep the control and change how it is done.

## When to use it

Value stream mapping pays off where work crosses several teams and nobody can say where the time goes: long lead times for small changes, many handoffs, approvals and tickets, or a plan to buy tools, reorganise teams or build a platform. A map before such an investment shows where it will help; a map after it shows whether it did. It suits regulated settings well, because it shows what each control costs in lead time and leads to doing the control differently rather than dropping it.

It costs more than it returns in some places:

- **One small team with few handoffs.** A board with WIP limits and lead times from the ticket system already shows the flow; a full workshop adds little.
- **Work where every item is different**, such as research or a one-off migration. Map a typical item at a coarse level, or follow several and look for the common queues.
- **No one will act.** Without a leader who can change policies across the steps, the map documents the problem and nothing else.
- **Fast-changing flows.** A map is a snapshot; where the stream changes every few weeks, continuous flow metrics from the tools serve better than a detailed map.

Adapt it where needed: in regulated environments involve compliance and audit early, so that the future state's controls (peer review records, automated checks, the pipeline's logs) are agreed as evidence; with legacy systems, map the path to production first and remove the largest manual waits; with remote teams, walk the work virtually through the ticket history and recorded handoffs.

## Common pitfalls

- **Mapping how work should flow.** A map drawn from the process wiki or from memory shows the official process (at Acme, 5 steps and 3 days) instead of what happened (8 steps, 22.5 days). Walk real work, with the people who did it, and take the times from the records.
- **A map made once and filed.** Martin lists beautifully drawn maps with no action behind them among the common failures. Turn the future state into a plan with owners and dates, and map again on a schedule and after each change.
- **Improving a step that isn't the bottleneck.** Halving QA's 4-hour test run takes the lead time from 22.5 to 22.25 days, about 1%. Remove the biggest waits and the largest sources of rework first; DORA's guide warns that efficiency gains away from the bottlenecks barely move the lead time.
- **Adding tools without removing handoffs.** A nicer portal for test environment tickets still waits 3 days. Remove the handoff itself (self-service, an automated check, a pre-approved change type) and add tools only where they serve that.
- **Too much detail too early.** Sixty boxes down to clicks and form fields turn the map into a process map, and the workshop ends before the big waits appear. Martin draws the line here: a value stream map is the strategic, end-to-end view, a process map the detailed, tactical one. Start with 5 to 15 blocks and zoom in only where the map points.
- **The wrong people in the room.** A map drawn by an improvement specialist alone misses what the steps know, and one drawn by people with no authority over the steps can't change them. Bring both the people who do the work and someone who can change the rules.
- **Trusting one change.** A single walked change can be unusual. Check its numbers against the ticket history for the same kind of work before choosing what to fix.
- **Using the map to blame.** The queues belong to the system, not to the team in front of which they form. A map that is used to rank teams teaches them to hide the waits next time.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [The Three Ways](../three-ways/) — DevOps in three principles: speed the flow of work to customers, amplify feedback back to the team, and keep learning.
- [DORA Metrics](../dora-metrics/) — Measure software delivery by throughput and stability: how often and how fast changes reach production, and how often they fail.
- [Continuous Delivery](../continuous-delivery/) — Keep every change releasable: a deployment pipeline builds once, tests in stages and promotes the same artifact to production.
- [Policy as Code](../policy-as-code/) — Write rules as code and check them automatically in CI and at deploy time, so guardrails replace manual approval gates.
- [Golden Paths](../golden-paths/) — A paved, supported route for common tasks: one template creates a service with its pipeline, infrastructure and monitoring.
- [ITIL 4](../itil-4/) — IT service management with ITIL 4: the service value system, guiding principles and change enablement that work with DevOps, not against it.
- [CALMS](../calms/) — A lens for assessing a DevOps adoption: culture, automation, lean, measurement and sharing, and the dimension that holds the others back.
- [Team Topologies](../team-topologies/) — Four team types and three interaction modes that organise teams around the flow of change and keep cognitive load in check.

## References

- [Lean Enterprise Institute — Value Stream Mapping (Lean Lexicon)](https://www.lean.org/lexicon-terms/value-stream-mapping/)
- [Mike Rother and John Shook — Learning to See: Value-Stream Mapping to Add Value and Eliminate Muda (Lean Enterprise Institute; Shingo Research Prize, 1999)](https://www.lean.org/store/book/learning-to-see/)
- [Karen Martin and Mike Osterling — Value Stream Mapping: How to Visualize Work and Align Leadership for Organizational Transformation (McGraw-Hill, 2013)](https://tkmg.com/books/value-stream-mapping/)
- [Karen Martin — Value Stream Mapping: Lead Time (TKMG, April 2014)](https://tkmg.com/value-stream-mapping-lead-time/)
- [Karen Martin — Value Stream Mapping: Ferrari or Pinto? (TKMG, April 2014)](https://tkmg.com/value-stream-mapping-ferrari-or-pinto/)
- [TKMG — Lean Terminology (process time, lead time, %C&A, activity ratio, rolled first pass yield)](https://tkmg.com/lean-terminology/)
- [DORA — Capabilities: Visibility of work in the value stream](https://dora.dev/capabilities/work-visibility-in-value-stream/)
- [DORA — Capabilities: Streamlining change approval](https://dora.dev/capabilities/streamlining-change-approval/)
- [DORA — Capabilities: Work in process limits](https://dora.dev/capabilities/wip-limits/)
- [The DevOps Handbook, Second Edition — Gene Kim, Jez Humble, Patrick Debois, John Willis and Nicole Forsgren (IT Revolution, 2021)](https://itrevolution.com/product/the-devops-handbook-second-edition/)
- [Gene Kim — The Three Ways: The Principles Underpinning DevOps (IT Revolution, 2012)](https://itrevolution.com/articles/the-three-ways-principles-underpinning-devops/)
- [Judy Worth — 10 Tips for Getting the Most Value from Value-Stream Mapping (Lean Enterprise Institute, September 2022)](https://www.lean.org/the-lean-post/articles/10-tips-for-getting-the-most-value-from-value-stream-mapping/)
- [Dave LaHote — Keep It Simple: Value-Stream Mapping at the Gemba (Lean Enterprise Institute, September 2022)](https://www.lean.org/the-lean-post/articles/keep-it-simple-value-stream-map-at-the-gemba/)
- [Mik Kersten — Project to Product: How to Survive and Thrive in the Age of Digital Disruption with the Flow Framework (IT Revolution, 2018)](https://itrevolution.com/product/project-to-product/)
- [Steve Pereira and Andrew Davis — Flow Engineering: From Value Stream Mapping to Effective Action (IT Revolution, 2024)](https://itrevolution.com/product/flow-engineering/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
