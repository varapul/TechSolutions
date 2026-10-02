<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔄 Migration & Modernization](../../README.md#migration--modernization)

# Parallel Run

> Run old and new side by side on the same inputs and compare results before cutting over.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Parallel Run" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/parallel-run.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Same input to both** | Every price request is handed to both implementations. The old one, in production for years, stays the **source of truth**: its answer goes back to the caller. The new one's answer is only recorded, and its writes and outbound calls go to an isolated store and to stubs, so nothing is charged or sent twice. |
| **2 · Compare every result** | A comparator checks the two results for every input. A match is only counted. A mismatch is logged with the input and both outputs: for `3 × $16.67 + 8% tax` the old code says $54.00 and the new code $54.01. Of the last 1,000 inputs 970 match, so the gauge reads 97%. |
| **3 · Explain every mismatch** | Each of the 30 mismatches is a finding of one of three kinds: a defect in the new code (fix it), a quirk of the old code that the business relies on (decide deliberately whether to reproduce or correct it), or noise such as timestamps, ordering and generated IDs (normalise or ignore it in the comparison). The new version is fixed and redeployed, and the match rate climbs to 100%. It has to stay there over a representative period that includes the rare cases, such as month end and refunds. |
| **4 · Cut over** | When the mismatch count has stayed at zero for long enough, the roles swap: the new implementation becomes the source of truth and its answer is returned. The old one can keep running in the shadow for a while, as a check and as a way back, and is then retired. |
<!-- END GENERATED: header -->

## The problem

Some code is replaced because it is old, and its age is exactly what makes replacing it dangerous. A pricing engine, a billing run, a tax or payroll calculation, a credit check: years of fixes, exceptions and special cases have gone into it, and no document lists them all. The old code is the only complete statement of the rules.

A rewrite of such code can pass every test and still be wrong, because the tests cover the cases somebody thought of. Jesse Toth, writing about the rewrite of GitHub's permission code, adds a second reason: with enough time and volume the production data collects oddities of its own, which no test and no specification describes, and real users run into them.

A wrong answer of this kind does not look like a failure. The request succeeds, the latency is normal, and the price is one cent off. A [canary release](../canary-release/) that watches error rates and response times would promote that build, and the first to notice would be a customer or an accountant. A [feature flag](../feature-flags/) or a [blue-green](../blue-green-deployment/) switch gives a fast way back, but only after somebody has noticed.

What is missing is evidence, gathered before any customer depends on the new code, that it gives the same answers as the old code for the inputs production really sees.

## How it works

Give every input to both implementations, use only one of the two answers, and compare them. At any moment one side is the **source of truth**. Until the comparison has earned the new implementation that role, it is the old one. Sam Newman describes the pattern under this name in *Monolith to Microservices*. The practice is older than the name: organisations have long changed systems over by running a new payroll or ledger beside the old one for a few cycles and reconciling the outputs before the old one was switched off.

The diagram replaces a pricing engine. Checkout asks for a price, and a fork hands the same request to v1 and to v2.

1. **The same input goes to both.** `2 × $12.50 + 8% tax` is priced twice. The $27.00 from v1 goes back to Checkout. The $27.00 from v2 goes to the comparator and nowhere else. v1 writes to the live store and makes its real outbound calls. v2 writes to a store of its own and calls stubs, so nothing is charged or sent twice.
2. **Compare.** The comparator checks the pair of results for every input. A match is only counted. A mismatch is logged with what is needed to reproduce it, the input and both outputs: for `3 × $16.67 + 8% tax`, v1 says $54.00 and v2 says $54.01. Of the last 1,000 inputs 970 match, which is 97%.
3. **Explain every mismatch.** The 30 logged differences turn out to be 18 defects in the new code, 5 quirks of the old code that the business relies on and 7 cases of noise. The cent is a defect: v1 rounds the tax on each item ($1.33, three times, is $3.99), and v2 rounded it once on the $50.01 subtotal ($4.00). The quirks are decided one by one, the noise is taken out of the comparison and v2.1 ships with the fixes. The same input now matches, and the rate climbs to 100% and stays there for 30 days that include a month end and refunds.
4. **Cut over.** The roles swap. v2.1 becomes the source of truth: its answer goes back to Checkout and it writes to the live store. v1 runs on for a while as the shadow, with its own effects now isolated in turn, and is then retired.

### What a mismatch can mean

Every mismatch is a finding, and the run is not finished while one of them is unexplained. There are three kinds.

- **A defect in the new code.** Fix it. This is the kind the run exists to find.
- **A quirk of the old code that the business relies on.** The old code does something no specification mentions (a rounding rule, a discount that runs a day longer than documented), and invoices, reports and other people's systems have depended on it for years. Decide deliberately: reproduce it in the new code, or correct it and tell whoever is affected. A correction makes the two differ on purpose, so it has to be registered in the comparison as an expected difference, with a reason and an owner.
- **Noise.** Timestamps, generated identifiers, the order of a list: the two answers mean the same thing without being identical. Take the noise out of the comparison (see below) instead of getting used to a match rate below 100%.

Sometimes the old code is simply wrong. Toth notes that the feedback from a comparison leads to changes in the new system and now and then in the old one. When GitHub replaced the code that creates merge commits, the comparison uncovered two serious bugs in the original Git implementation that had gone unnoticed for years, next to three major performance problems in the new one. There are three ways out when the old answer is the wrong one: reproduce the error for now and correct it after the migration, fix the old code as well so that both agree and the correction reaches customers as a change of its own, or fix only the new code and register the difference as expected.

**Who decides.** Not the developer who runs the comparison. Whether a difference matters is a business question, and the answer belongs to whoever owns the rule: finance for rounding, the tax team for tax. Keep one line per class of mismatch with the cause, the decision and the person who took it. That list is also the first honest specification the old system has had.

### Where the fork and the comparison live

- **In the application, behind an abstraction.** The callers use an interface, and one implementation of it calls the old code, calls the new code, compares and returns the old result. A [branch by abstraction](../branch-by-abstraction/) already has the seam and the switch in the right place, and Steve Smith's [verify branch by abstraction](https://www.stevesmith.tech/blog/application-pattern-verify-branch-by-abstraction/) is this arrangement in a strict form: a verifying implementation calls both with the same input and fails fast when the outputs differ. GitHub's [Scientist](https://github.com/github/scientist) is the best-known library for the production form. The existing behaviour goes into a `use` block (the *control*) and the new one into a `try` block (the *candidate*). The experiment always returns the control's value. Behind that it decides whether to run the candidate at all, runs the two in random order, times both, compares the values, records an exception from the candidate instead of raising it, and publishes the result to whatever you plug in. Its README lists ports for .NET, Java, Python, Go, Node.js and other platforms.
- **In a proxy, in front of two deployments.** The proxy sends each request to an old and a new instance and compares the responses. [Diffy](https://github.com/opendiffy/diffy), which began at Twitter, works like this. Twitter has archived its Apache-licensed repository; the original author maintains the tool as Opendiffy under a Creative Commons licence that allows non-commercial use only, so read the terms before building on it. When a whole service is being replaced, the facade of a [strangler fig](../strangler-fig/) is the natural place for the fork.
- **After the response, out of band.** The old system answers the caller first and then hands the request, together with its own response, to a checker that calls the new system and compares in the background. Zalando's Returns team [did this](https://engineering.zalando.com/posts/2021/11/parallel-run.html) while moving returns logic out of a monolith. The monolith posted each request and its response to a consistency-check endpoint of the new service, which accepted it at once, repeated the request against itself later and produced metrics and logs about the differences.
- **In batch.** Run both pipelines over the same input for the same period and reconcile the outputs: join them on the business key and list what is missing, extra or different. For invoices, statements and payroll runs this is the natural form.

If the two systems model the domain differently, compare in the terms the callers see. The translation an [anti-corruption layer](../anti-corruption-layer/) performs for callers serves the comparator as well.

### Side effects and state

Comparing two answers to a question is harmless. Running a command twice is not: a card is charged twice, an email goes out twice, a counter moves twice. Read paths are therefore the easy case, and the tools draw the line there. Scientist's README calls the library safe only around code that changes no data, because nothing guarantees that the candidate runs every time. Twitter's original Diffy, [now archived](https://github.com/twitter-archive/diffy), ignored `POST`, `PUT` and `DELETE` requests unless told otherwise. Zalando's team lists endpoints that are not idempotent among the limits of its approach.

For code that writes, there are three ways to keep the candidate harmless, and the diagram uses the first two:

- **Give the candidate its own store.** It writes to an isolated copy, and nothing else reads that copy.
- **Stub its outbound calls.** Payment providers, mail, messages to other systems: the candidate talks to stand-ins that record what they are asked to do.
- **Compare what it would do instead of doing it.** Let both sides produce the command (the SQL statement, the message, the payment request) and compare the commands. Often this is the most valuable comparison of all, because the side effects are the behaviour that matters.

State is the hard part. The candidate computes on its own data, and if that data drifts away from the live data, every later mismatch says something about the drift and nothing about the code. Seed the isolated store from a snapshot and keep it in step by applying the same writes to both: a dual write in the application or [change data capture](../change-data-capture/) from the live store. Scientist's README describes the same division of labour: change both systems wherever writes happen, verify at read time, and keep reconciliation scripts for the data at rest. Stripe [used Scientist that way](https://stripe.com/blog/online-migrations) when it moved subscriptions into a table of their own: both tables were written, both were read, and a difference between the two reads alerted the engineers, before any read was switched.

After the cut-over the same rule applies in reverse. If the old implementation keeps running as the shadow, its writes and calls are the ones that must be isolated.

### Taking the noise out of the comparison

Two correct implementations can still produce different bytes.

- **Time.** Each side reads the clock, so a timestamp or a "valid until" differs. Pass the same instant into both, or leave such fields out of the comparison.
- **Generated values.** Identifiers, tokens, random samples. Inject them or exclude them.
- **Order.** A list that is semantically a set, the keys of a map. Sort before comparing.
- **Number representation.** Binary floating point gives different last digits for a different order of operations. Compare money as exact decimals or integer minor units and reserve tolerances for values that really are approximate.
- **Data that moves between the two calls.** Scientist runs its two blocks one after the other, and its README points out that the data they depend on may change in between.
- **Envelope differences.** Header order, whitespace, default values written out or omitted. Zalando's comparison ignored headers that had no bearing on the outcome.

Do the normalising in one place, apply it to both sides, and keep the list of ignored fields short and reviewed: every ignore rule is a place where a real difference can hide. Scientist has `compare` for a custom comparison, `clean` for reducing a value to what is worth storing and `ignore` for known differences. Its README adds a warning: as long as an ignore rule exists, the candidate is known to behave differently.

It also helps to measure how much noise there is before blaming the new code. Diffy sends every request to three instances: the candidate and two copies of the last known-good version, called primary and secondary. Whatever differs between primary and secondary cannot come from the new code, so Diffy compares how often those two disagree with how often primary and candidate disagree, and treats a difference that is no more frequent than the noise as noise. Scientist's README suggests the same calibration in code: start with an experiment in which both blocks call the old method.

### What else to compare

The results come first, and the same run answers more questions for free.

- **Latency.** Scientist records wall-clock and CPU time for both blocks. GitHub did not call its merge experiment finished until there were no slow cases left either.
- **Errors.** An exception or a timeout in the candidate where the old code answers is a mismatch like any other. Two identical failures count as a match in Scientist.
- **Resource use.** Queries per request, memory, calls to other services: a candidate that gets the right answer with ten times the queries is not ready.

### How long, and at what cost

A run is long enough when it has seen the inputs that matter, and the rare ones arrive with the calendar: month end, quarter end, the yearly tax run, refunds and reversals, a promotion, a leap day, the hour the clocks change. For financial logic that means whole business cycles. Uniform, high-volume work gets there faster. GitHub started its merge experiment on 1% of requests, spent four days fixing what the list of mismatches showed, and then ran it on all requests for 24 hours without a single mismatch or slow case. By then the experiment had checked tens of millions of merges, and GitHub switched. Decide the bar beforehand; Zalando set an expected level of consistency for every endpoint.

Everything is done twice in the meantime, and Zalando's write-up warns that the load on the components involved can double. Two things keep the bill down:

- **Run the candidate off the caller's path.** Answer first, then compare: on a background worker, from a queue, or from a log of requests replayed later. This also keeps a slow or failing candidate away from the caller. Scientist runs both blocks inside the request and, as its README says, does not protect against a candidate that times out.
- **Sample.** Compare a percentage of the inputs and raise it as confidence grows. Scientist leaves this to an `enabled?` method you write. A sample finds systematic differences quickly and rare inputs slowly, so go to 100% before trusting a zero.

Toth's advice is to run an experiment for as long as it takes to gain confidence and no longer.

### Cutting over, and afterwards

- **Swap the roles with a switch.** A [feature flag](../feature-flags/) decides which answer is returned, so the swap needs no deployment and can be undone in seconds. It can move for a share of the traffic first, which at that point is a [canary release](../canary-release/) of an implementation already known to give the same answers.
- **Keep comparing for a while.** With the old code as the shadow, the comparison keeps running after the swap and catches what the earlier period did not contain.
- **Move the data separately.** If the new implementation stores its state differently, that migration has its own compatible steps: [expand and contract](../expand-and-contract/).
- **Keep the way back open.** Going back is only possible while the old implementation can still read the current state. Scientist's README advises keeping the duplicated writes in place until well after the new behaviour has been in production.
- **Then remove everything.** The old implementation, and also the fork, the comparator, the stubs, the isolated store and the flag. A parallel run that never ends is two systems to maintain.

### What it is not

| | Who receives the new version's answer | What it tells you |
|---|---|---|
| **Parallel run** | nobody, until the cut-over | whether old and new agree, input by input |
| [Canary release](../canary-release/) | a growing share of real users | whether the new build is healthy under real traffic: errors, latency, saturation |
| [Feature flags](../feature-flags/) | the users or the share that a rule selects | nothing by itself: it is a switch, and here it is the one that swaps the roles |
| [Blue-green deployment](../blue-green-deployment/) | everyone, from one moment to the next | whether a complete new environment takes over cleanly, with the old one kept as the way back |

Shadow traffic, a separate pattern in this catalog, mirrors live requests to the new version at the network layer, mainly to see how it copes with production load and input. The proxy throws the mirrored responses away (Istio describes mirrored requests as fire and forget), so comparing them takes a diffing step on top, and that step is the proxy form of a parallel run. Martin Fowler's [dark launching](https://martinfowler.com/bliki/DarkLaunching.html) is the wider idea of running new back-end behaviour in production without showing it to users, typically to measure its load and performance before a feature is revealed. He notes that it also allows the parallel running of a re-implemented feature, with both versions called and their results checked.

## When to use it

- **A wrong answer is expensive and hard to see:** pricing, billing, tax, payroll, interest, risk and credit decisions, entitlements and permissions.
- **Nobody fully knows the rules.** A legacy system with years of undocumented special cases, where the old code is the specification.
- **A calculation or a query path is being replaced, not redesigned:** a new engine, a new data store behind the same reads, a rewritten query. GitHub reports using Scientist for its permission code, for a move to a new code search cluster and for optimised queries.
- **As the verification step of a larger migration:** before a [strangler fig](../strangler-fig/) moves a route, or before a branch by abstraction moves its switch.

**When not to use it.**

- **The outputs cannot be compared.** The answer is random or ranked by design, or the new system is meant to behave differently. A comparison needs an expected result, and here the old system does not provide one.
- **The side effects cannot be isolated.** A partner interface without a sandbox, a device, a ledger that cannot be copied: if the candidate cannot run without consequences, it cannot run in parallel.
- **The two cannot be given the same state.** Then the mismatches measure the data and not the code.
- **The change is small enough to test conventionally.** Newman's own verdict in the book is that the pattern takes real effort and belongs to changes that are considered high risk, where the effort is worth what it buys. A change that unit and contract tests cover well does not need it.

## Trade-offs

- **Everything is done twice.** Compute, queries against shared databases, calls to shared dependencies, and added latency if the candidate runs inside the request.
- **The harness is software too.** The fork, the isolation, the comparator, the normalising rules and the dashboard have to be built, tested and later removed. A mistake in them is dangerous in one direction: a comparator that normalises too much reports 100% for two systems that disagree.
- **It proves sameness, not correctness.** Agreeing with the old system includes agreeing with its bugs. Intended changes in behaviour show up as mismatches and need another kind of test.
- **It covers only the inputs that occurred.** A case that did not happen during the run was not compared. Replaying recorded inputs from earlier periods widens the coverage.
- **Two implementations have to stay in step.** A rule that changes during the run has to change in both, or the run measures the change. A long run invites a freeze on the old code or doubles the work.
- **The log is full of production data.** Inputs and outputs are recorded in full so that a mismatch can be reproduced, and they include personal and financial data. Zalando's team points out the tension: sensitive fields should not be stored, or should be cleaned afterwards, and a mismatch in exactly those fields is then hard to analyse.
- **The benefit arrives late.** The new system carries no traffic that counts until the cut-over, so the run delays whatever the rewrite was for. That is the price of the evidence.

## Implementation notes

- **Protect the answer.** Nothing the candidate does may change, delay or break what the caller receives. Catch everything it throws, bound its time, and give it threads and connections of its own ([bulkhead](../bulkhead/)), or run it after the response has gone out.
- **With Scientist,** the fork is a few lines in the caller. An experiment class of your own supplies `enabled?` (how often the candidate runs) and `publish` (where the results go).

  ```ruby
  class Checkout
    include Scientist

    def total(order)
      science "pricing-v2" do |e|
        e.context order_id: order.id        # published together with the result
        e.use { PricingV1.total(order) }    # control: this value is returned
        e.try { PricingV2.total(order) }    # candidate: compared and recorded, never returned
        e.clean { |amount| amount.to_s }    # what is kept of each value for the mismatch log
      end
    end
  end
  ```

- **Record enough to reproduce.** For every mismatch keep the input, both outputs, the builds of both sides, the time and a correlation ID. Mask what does not have to be readable, restrict access and set a retention period.
- **Normalise in one tested function** that turns a result into its canonical form (sorted, volatile fields removed, amounts as exact decimals) and is applied to both sides. Give every ignore rule a reason, an owner and an expiry date.
- **Compare money exactly.** A tolerance of one cent hides exactly the rounding defects the run is there to find.
- **Watch the run like a service.** Match rate per operation and per kind of input, since an overall 100% can hide a rare input type that fails every time. Mismatches by class, the candidate's error rate and both latencies. Once the count is at zero, alert on any new mismatch.
- **Replay to get there sooner.** Recorded production inputs, or last year's month-end files, can be run through both versions offline, which covers rare cases without waiting for the calendar. The logged mismatches make good regression tests.
- **Write the exit criteria first:** no unexplained mismatch over a stated number of cycles that include the rare ones, the candidate's latency and error rate within stated limits, and a date by which the old code and the harness are deleted.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Strangler Fig](../strangler-fig/) — Put a facade in front of the legacy system and move routes to new services one at a time.
- [Branch by Abstraction](../branch-by-abstraction/) — Introduce an abstraction, build the new implementation behind it, then switch over.
- Shadow Traffic *(planned)* — Mirror live requests to the new version and compare results without affecting users.
- [Canary Release](../canary-release/) — Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back.
- [Feature Flags](../feature-flags/) — Deploy code dark, then turn features on per user or percentage at runtime.
- [Anti-Corruption Layer](../anti-corruption-layer/) — A translation layer that keeps a legacy model from leaking into the new domain.
- [Expand and Contract](../expand-and-contract/) — Change a schema or API in backward-compatible steps: expand, migrate, then contract.
- [Blue-Green Deployment](../blue-green-deployment/) — Run the new version beside the old one and switch all traffic in one step.

## References

- [Sam Newman — Monolith to Microservices (book)](https://samnewman.io/books/monolith-to-microservices/)
- [GitHub Blog — Scientist: Measure Twice, Cut Once](https://github.blog/developer-skills/application-development/scientist/)
- [GitHub Blog — Move Fast and Fix Things](https://github.blog/engineering/move-fast/)
- [GitHub — Scientist: a Ruby library for carefully refactoring critical paths](https://github.com/github/scientist)
- [Opendiffy — Diffy: what it is and how it works (README)](https://github.com/opendiffy/diffy)
- [Twitter — Diffy (the original repository, archived)](https://github.com/twitter-archive/diffy)
- [Zalando Engineering — Parallel Run Pattern - A Migration Technique in Microservices Architecture](https://engineering.zalando.com/posts/2021/11/parallel-run.html)
- [Stripe — Online migrations at scale](https://stripe.com/blog/online-migrations)
- [Steve Smith — Application pattern: Verify Branch By Abstraction](https://www.stevesmith.tech/blog/application-pattern-verify-branch-by-abstraction/)
- [Martin Fowler — Dark Launching](https://martinfowler.com/bliki/DarkLaunching.html)
- [Istio — Mirroring](https://istio.io/latest/docs/tasks/traffic-management/mirroring/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
