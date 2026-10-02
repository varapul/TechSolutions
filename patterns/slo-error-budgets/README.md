<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔭 Observability & Operations](../../README.md#observability--operations)

# SLOs & Error Budgets

> Measure SLIs against an objective and alert on error-budget burn rate, not on every blip.

<p align="center"><img src="diagram.svg" alt="Animated diagram: SLOs &amp; Error Budgets" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/slo-error-budgets.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · SLI and SLO** | The **SLI** is a ratio of good events to valid events: here, checkout requests answered without a 5xx, counted at the load balancer because that is closer to what users see than the server's own logs. (A latency SLI would count the requests answered within, say, 300 ms.) The **SLO** is a target for that ratio over a window: 99.9% over a rolling 30 days. At 99.95% the service is inside its objective. |
| **2 · The error budget** | What the objective leaves over is the **error budget**: 100% − 99.9% = 0.1% of 30,000,000 requests, so 30,000 may fail in 30 days (as time, 43.2 minutes of total outage). Background errors spend it slowly, about 20 requests an hour here. Five minutes at 10% errors cost about 350 requests, 1.2% of the budget: the 5-minute window spikes to 100×, but the 1-hour window only reaches 8.8×, so nobody is paged. |
| **3 · Alert on burn rate** | **Burn rate** is the error rate divided by the budget (1 − SLO): 1.5% ÷ 0.1% = 15×, a pace that would empty the 30-day budget in 2 days. The page fires when the 1-hour *and* the 5-minute window are both above 14.4×. Here that takes 58 minutes and 2% of the budget; a total outage would trip it in under a minute. After the fix the 5-minute window clears within minutes and the page stops, even when the 1-hour average is still high. |
| **4 · Spend it on purpose** | The budget is there to be spent: while some is left, releases, experiments and planned maintenance go ahead (here risky launches burn it at a slow 2×, which opens a ticket rather than a page). When it is gone, the **error budget policy** closes the gate: feature releases stop and the team works on reliability until the service is back within its SLO. With a rolling window that happens as old errors age out and the budget refills. |
<!-- END GENERATED: header -->

## The problem

"Is the service reliable enough?" has no answer until someone defines *enough*. Without a target, either every error is an emergency or none is. Alerts fire on CPU, on a single 500 and on every five-minute blip until the people on call stop trusting them, and the argument between "ship faster" and "stop breaking things" is won by whoever argues loudest.

Aiming for 100% doesn't settle it. Google's SRE books call it the wrong target: it can't be reached, each extra nine costs more than the last while users notice it less (someone on a 99% reliable phone can't tell 99.99% from 99.999%), and a service that must never fail can never change, because change is the biggest source of outages.

## How it works

Three terms, each built on the one before:

- **SLI** (service level indicator): a measurement of the service as users experience it, written as a ratio of good events to valid events. Here it is checkout requests answered without a 5xx, out of all checkout requests.
- **SLO** (service level objective): a target for an SLI over a window, such as 99.9% over a rolling 30 days. It is an internal goal that drives engineering decisions.
- **SLA** (service level agreement): a contract with customers that attaches consequences, usually refunds or credits, to missing a level of service. If nothing happens when the number is missed, it is an SLO. Keep the internal SLO tighter than anything promised in an SLA, so the team reacts long before the contract is at risk.

**The error budget** is what the objective leaves over: 100% − 99.9% = 0.1% of valid events. At 1,000,000 requests a day that is 30,000 failed requests per 30 days, the same allowance as 43.2 minutes of total outage. Everything that produces bad events draws on the same account: incidents, bad releases, experiments, planned maintenance, a dependency's outage.

**Burn rate** is how fast the budget is going: the observed error rate divided by the budget rate (1 − SLO). At 1× the budget lasts exactly the window. At 15× (1.5% errors against 0.1%) it is gone in two days, and at 1,000× (a total outage) in 43 minutes.

**The error budget policy** is the agreement about what follows: while budget remains, the team ships. When it is spent, feature releases stop and the effort goes into reliability until the service is back within its SLO.

### Choosing SLIs

Pick a few that stand in for user happiness (the SRE Workbook suggests five or fewer types per service), by the kind of system:

| System | SLI | A good event |
|---|---|---|
| Request-driven (APIs, web) | Availability | the request got a successful response |
| | Latency | the response was faster than a threshold, such as 300 ms |
| | Quality | the response was served undegraded |
| Data processing (pipelines) | Freshness | the data was updated more recently than a threshold |
| | Correctness | the record came out with the right value |
| | Coverage | the record was processed in time, or the batch job processed enough of its data |
| Storage | Durability | a written record can be read back |

Measure as close to the user as you can. Application logs only know about requests that reached the application. The load balancer also sees the ones that never got that far, and client-side instrumentation or synthetic probes see DNS, CDN and network failures as well. The workbook's own example starts at the load balancer because those metrics already exist and are closer to the user than server logs. Decide what counts as well. In that example a 5xx response is bad and every other response is good, and Google's SLO workshop scopes *valid* events by hostname or path, so the ratio only covers the requests the user journey depends on. For latency, use more than one threshold (90% under 100 ms and 99% under 400 ms, for instance) so the long tail counts too.

### Windows, and what is counted

**Rolling or calendar.** A rolling window (the last 30 days) follows what users remember: an outage on the last day of the month is not forgotten on the first of the next. The budget comes back gradually, as bad events age out of the window. The workbook recommends a whole number of weeks, four by default, so every window holds the same number of weekends. A calendar window (a month, a quarter) resets on a known date and lines up with planning and billing periods. With a request-based SLO its budget is only an estimate until the period ends, because it depends on traffic that hasn't arrived yet.

**Requests or time slices.** A *request-based* SLO counts events: 99.9% of requests are good. A *window-based* SLO counts intervals: 99% of one-minute windows are good, where a good minute might be one with 95% of its requests under 300 ms. Request-based SLOs weight every request equally, so an outage at peak costs more budget than the same outage at 3 a.m. Window-based SLOs weight every minute equally. That matches "minutes of downtime" and is the only choice when the metric is already a percentile, but a minute with one error too many counts the same as a minute of nothing but errors, and a quiet minute counts as much as a busy one.

### Why alert on burn rate

A threshold on the raw error rate fails one way or the other. The workbook walks through the attempts and judges each on four things: **precision** (how many alerts were worth it), **recall** (how many significant events alerted), **detection time**, and **reset time** (how long the alert keeps firing after the problem is gone).

- *Error rate above the SLO over 10 minutes.* Quick, and far too noisy: ten minutes at 0.1% errors cost 0.02% of the monthly budget, so it can fire 144 times a day on a service that still meets its SLO.
- *The same over a long window* (36 hours). Precision improves, but after a full outage the alert keeps firing for 36 hours.
- *A duration clause* (`for: 1h`). A total outage and a 0.2% error rate are both noticed after an hour, by which time the outage has spent 140% of the budget.
- *Burn rate.* Decide how much budget may go before a person is told, and derive the threshold from it: 2% of a 30-day budget in one hour is a burn rate of 14.4.
- *Several burn rates*, so a slow leak is caught too: 5% in 6 hours (6×) still pages, and 10% in 3 days (1×) opens a ticket.
- *Two windows per rule.* Each rule also needs a short window, one twelfth of the long one, above the same burn rate. That shows the budget is still burning, so the alert stops minutes after the fix instead of an hour (or three days) later.

The result is the table in the diagram, which the workbook recommends as a starting point for a 99.9% SLO:

| Burn rate | Long window | Short window | Budget spent when it fires | Alert |
|---|---|---|---|---|
| 14.4× | 1 hour | 5 minutes | 2% | page |
| 6× | 6 hours | 30 minutes | 5% | page |
| 1× | 3 days | 6 hours | 10% | ticket |

The multipliers assume a 30-day window: 2% of 720 hours spent in one hour is 14.4. Detection time shrinks as the incident gets worse. At 15× the first rule needs about 58 minutes; in a total outage, under a minute.

### The error budget policy

A budget only changes behaviour if everyone agreed beforehand what happens when it runs out. The policy is a short written agreement between the product manager, the development team and the people who run the service. It says:

- **What happens.** In the workbook's example policy, releases proceed as usual while the service is at or above its SLO. Once it has exceeded its budget for the preceding four weeks, all changes and releases stop, except the most urgent fixes and security patches, until it is back within its SLO. Softer steps work as well, such as slowing releases down while the budget runs low.
- **Who decides,** and who settles a disagreement (the CTO, in the example).
- **Exceptions.** The example lets feature work continue when the budget was spent by a company-wide network problem, by another team's service that has itself frozen its releases, or by traffic outside the SLO such as load tests.
- **What triggers a postmortem.** In the example, any single incident that consumes more than 20% of the budget over four weeks.

It is not a punishment, and the example says so. It gives the team permission to put reliability first when the data says reliability is the problem. If the three parties can't agree to enforce it, the SLO is the wrong one and needs another round.

## When to use it

- User-facing services with enough traffic for a ratio to mean something, and platforms or APIs that other teams build on.
- Wherever release speed and reliability pull against each other: the budget turns the argument into a number both sides accepted in advance.
- To replace cause-based alerts (CPU, memory, one failed health check) with a few pages about what users actually feel.
- Data pipelines and storage as well, with freshness, correctness, coverage or durability as the SLI.
- It fits poorly when nobody is prepared to act on the result. An SLO without an agreed policy is just another number on a dashboard.

## Trade-offs

- **Low traffic breaks the arithmetic.** At 10 requests an hour a single failure is a 10% error rate and a 100× burn. It pages at once, and a 99.9% SLO allows only seven failures in 30 days. The options are synthetic traffic, one SLO for a group of related small services, changes that make a single failure cost users less (client retries with backoff, fallbacks), or a lower SLO or longer windows.
- **Extreme targets need different alerts.** With a 90% SLO a total outage burns only 1.4% of the budget in an hour, so the 14.4× rule can never fire. At 99.999% a total outage spends the month's budget in 26 seconds, faster than any pager. That level has to be designed in, for example by exposing a change to 1% of users first as in a [Canary Release](../canary-release/), rather than defended by alerts.
- **A budget treats all bad events alike.** The workbook's own caveat: one four-hour outage probably upsets fewer users than a constant 0.5% error rate, but a request-based budget charges them the same.
- **The SLI is a proxy.** If outages and support tickets don't show up as budget spent, or budget is spent without users noticing, fix the indicator: move the measurement closer to the user, or cover more of what users do.
- **Dependencies set the ceiling.** A critical dependency has to be at least as reliable as the user journey that needs it. Where it isn't, engineer around it with caching, store-and-forward or graceful degradation. Redundancy arithmetic (two 99.9% zones make 99.9999%) misleads, because failures are rarely independent. Decide in the policy what happens when another team's outage spends your budget; the workbook notes that freezing anyway is what keeps users happier.
- **Too reliable is a problem too.** Users come to depend on what you deliver, not on what you promised. Google's SREs make sure the global Chubby lock service meets its SLO but doesn't significantly exceed it: in a quarter without a real outage they cause one on purpose, so nobody builds on reliability that was never promised.
- **Many parameters.** Three rules, six windows and a threshold for each. Choose one set and apply it to every service, grouped into a few classes with similar requirements, instead of tuning each alert by hand.

## Implementation notes

- **Prometheus.** A recording rule per window precomputes the error ratio (the workbook names them `job:slo_errors_per_request:ratio_rate1h`, `ratio_rate5m` and so on), and an alerting rule compares each pair with the burn rate times the budget: `ratio_rate1h > 14.4 * 0.001 and ratio_rate5m > 14.4 * 0.001`. The workbook advises against adding a `for:` duration to these alerts, because it delays every alert by the same amount however bad the outage is.
- **Generators.** Sloth and Pyrra take a short SLO definition (the error and total queries, the objective, the window) and write the recording rules and the multiwindow, multi-burn-rate alerts for you. Pyrra also serves a UI that lists every SLO with its remaining budget.
- **OpenSLO** is a vendor-neutral YAML format for the same information: `SLI`, `SLO` and `AlertPolicy` objects, a rolling or calendar-aligned `timeWindow`, a `budgetingMethod` (`Occurrences`, `Timeslices` or `RatioTimeslices`) and `burnrate` alert conditions. Sloth accepts its older v1alpha format.
- **Managed services, as examples.** Google Cloud's service monitoring (part of Cloud Monitoring) has request-based and windows-based SLOs, calendar or rolling compliance periods, and burn-rate alerting policies. Its lookback period can't exceed 24 hours, so Google suggests starting with a fast-burn alert (10× over one or two hours) and a slow-burn one (2× over 24 hours). Amazon CloudWatch Application Signals has request-based and period-based SLOs with burn-rate alarms.
- **Feed the SLI from telemetry you already have:** load balancer metrics first. Traces and logs then explain *why* the budget is burning (see [Distributed Tracing](../distributed-tracing/); Centralized Logging and the Telemetry Pipeline are planned).
- **Tie releases to the budget.** A deployment pipeline can read the remaining budget and hold feature releases while it is spent, which is the gate in the diagram. Canary analysis and feature flags keep the cost of each release small.
- **Write it down and revisit it.** Record the SLO and its policy with authors, approvers and a review date. The workbook suggests reviewing monthly at first, and treating a tighter target you can't meet yet as an *aspirational* SLO that is tracked but doesn't trigger the policy.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Distributed Tracing](../distributed-tracing/) — Propagate a trace context across services and assemble the spans into one timeline.
- Centralized Logging *(planned)* — Ship structured logs from every service to one searchable store, correlated by request ID.
- [Telemetry Pipeline (OpenTelemetry)](../telemetry-pipeline/) — Receive, process and export traces, metrics and logs through one vendor-neutral collector.
- [Canary Release](../canary-release/) — Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back.
- [Health Endpoint Monitoring](../health-endpoint-monitoring/) — Expose liveness and readiness checks that load balancers and monitors probe.
- Chaos Engineering *(planned)* — Inject failures on purpose to prove the system degrades the way you expect.
- [Feature Flags](../feature-flags/) — Deploy code dark, then turn features on per user or percentage at runtime.

## References

- [Google SRE Book — Service Level Objectives (chapter 4)](https://sre.google/sre-book/service-level-objectives/)
- [Google SRE Book — Embracing Risk (chapter 3)](https://sre.google/sre-book/embracing-risk/)
- [Google SRE Workbook — Implementing SLOs (chapter 2)](https://sre.google/workbook/implementing-slos/)
- [Google SRE Workbook — Alerting on SLOs (chapter 5)](https://sre.google/workbook/alerting-on-slos/)
- [Google SRE Workbook — Example Error Budget Policy (appendix B)](https://sre.google/workbook/error-budget-policy/)
- [Google SRE — The Art of SLOs (workshop and participant handbook)](https://sre.google/resources/practices-and-processes/art-of-slos/)
- [Google Cloud — Concepts in service monitoring](https://docs.cloud.google.com/stackdriver/docs/solutions/slo-monitoring)
- [Google Cloud — Alerting on your burn rate](https://docs.cloud.google.com/stackdriver/docs/solutions/slo-monitoring/alerting-on-budget-burn-rate)
- [OpenSLO — Specification](https://openslo.com/specification/)
- [Prometheus — Defining recording rules](https://prometheus.io/docs/prometheus/latest/configuration/recording_rules/)
- [Prometheus — Alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
