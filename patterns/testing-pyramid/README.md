<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧭 DevOps & SRE Principles](../../README.md#devops--sre-principles)

# Testing Pyramid

> Many fast unit tests, fewer integration and contract tests, a few end-to-end tests: feedback stays fast and failures point at the cause.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Testing Pyramid" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/testing-pyramid.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · The ice-cream cone** | Acme's checkout service is tested mostly through the browser: 640 end-to-end tests run in a nightly job of 95 minutes, 7% of those runs fail at random, and only 120 unit tests run before a merge. A red run only says that checkout failed, so people re-run it until it passes and stop trusting red builds. When PR #4182 cuts tax off instead of rounding it (8.25% of $19.99 is 1.649…, which becomes 1.64, not 1.65), no layer checks the cents, and the bug is found on staging on Thursday, three days after the merge. |
| **2 · The test pyramid** | The **test pyramid** (Mike Cohn, *Succeeding with Agile*, 2009) puts many fast, narrow tests at the base and fewer, broader ones above: 2,400 unit tests (40 s), 310 integration tests against real PostgreSQL and Redis in containers (4 min), 90 consumer-driven contract tests with payments and catalog (1 min) and 18 end-to-end smoke tests on staging (6 min). The same bug now fails one unit test 40 seconds after the push, and the failure names `TaxCalculator.round()`. Higher layers would have caught it later and less precisely: an integration test after about 5 minutes with a wrong order total, a smoke test after about 12 with a wrong total on the confirmation page, and the contract tests not at all, since 21.63 is still a valid amount. |
| **3 · Fast layers first** | The pipeline runs the layers from the base up, so a cheap layer fails before an expensive one starts, and each layer has a time budget (40 s of 1 min, 4 of 5, 1 of 2 and 6 of 8 minutes): a commit is green in about 12 minutes. A flaky test goes to quarantine with an owner and a fix date instead of being re-run (here the guest-checkout smoke test, owned by the checkout team, due on 16 October), which keeps flaky runs under 0.5%. The team lists checkout's risks, tests each at the lowest layer that can catch it, and reads coverage as a map of untested code rather than a target (Acme's numbers are the example's own). |
| **4 · Pitfalls and other shapes** | A year on, the end-to-end suite has grown back from 18 to 70 tests and takes 25 minutes, because every bug got a browser test; contract tests pass 21.63 because they check the shape, not the meaning; the payments mock drifts from the real API unless contract tests check it; and a coverage target is met with tests that assert nothing. Other shapes suit other systems: Kent C. Dodds's **testing trophy** (2018) for JavaScript applications and Spotify's **honeycomb** (2018) for microservices make integration tests the largest group. Canary releases and synthetic checks test in production, as a complement to the pyramid, not a substitute. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's checkout team tested its service the way many teams end up testing when most checks are added after the fact by driving the finished product. The checkout service had 640 end-to-end tests that clicked through the shop in a real browser, run by a nightly job that took 95 minutes. Below them sat 40 integration tests (6 minutes, also at night) that all shared one test database, and only 120 unit tests (15 seconds), the only tests that ran before a merge. There were no contract tests with the services checkout calls. (Acme's numbers on this page are the example's own, not research findings.)

That shape, wide at the top and thin at the bottom, is the **ice-cream cone**, the name Alister Scott gave the anti-pattern on his testing blog in 2012. It hurts in three ways:

- **Slow feedback.** A developer who merges in the afternoon hears about a broken browser test the next morning, after other changes have landed on top of it.
- **Flaky results.** Browser tests wait for pages, depend on test data and share an environment, so 7% of the nightly runs went red with no code change at all. The team learned that red usually meant "run it again".
- **Vague failures.** A failing browser test reports that checkout failed and attaches a screenshot of an error page. It doesn't say whether the cause is the tax code, the database, the payments service or the test itself.

Together they make the suite expensive and untrusted. In the diagram, PR #4182, merged on a Monday afternoon, changes how tax is computed per line and cuts off the extra digits instead of rounding: tax of 8.25% on $19.99 is 1.649175, which should round to 1.65 but becomes 1.64. None of the 120 unit tests covers rounding, no integration test checks totals, and the browser tests check that checkout completes, not what it charges. That night's run goes red for an unrelated, flaky reason ("checkout failed") and passes on a re-run the next morning, so the change goes to staging, where the missing cent is found on Thursday.

## How it works

The **test pyramid** is a way to balance a test portfolio: many fast, narrow tests at the bottom, fewer and broader tests further up, and only a handful of tests that drive the whole system through its user interface. Mike Cohn made it widely known as the *test automation pyramid* in *Succeeding with Agile* (Addison-Wesley, 2009). Martin Fowler's bliki entry *TestPyramid* (2012) adds that Cohn first drew it in conversations with Lisa Crispin in 2003–04, and that Jason Huggins reached the same idea independently around 2006. Cohn's layers were unit tests at the base, service tests in the middle and user-interface tests at the top. Ham Vocke's *The Practical Test Pyramid* (martinfowler.com, 2018) sums it up in two rules of thumb: test at more than one level of detail, and keep fewer tests the further up you go.

The reasoning is about cost and information. Fowler points out that tests driven through the user interface break easily, cost a lot to write and take long to run: one change to a page can break dozens of them. Mike Wacker's 2015 post on Google's testing blog adds the information side: a failing end-to-end test can take a long time to trace to its cause, while a unit test isolates the failure. A narrow test runs in milliseconds and fails for one reason, so its failure names the cause. The pyramid doesn't ban broad tests. It keeps each check at the lowest level that can make it, and keeps a few broad tests to confirm that the parts are wired together.

Acme's checkout suite after the change has four layers:

| Layer | Tests | Runs on | Time | What a failure tells you |
|---|---|---|---|---|
| **Unit** | 2,400 | the CI runner, in one process, without network | 40 s | the function and the case: `TaxCalculator.round()` returned 1.64 for 1.649175 |
| **Integration** | 310 | the CI runner, with real PostgreSQL and Redis in throwaway containers | 4 min | the query, transaction or cache entry that misbehaves |
| **Contract** | 90 | the CI runner, with contracts shared through a Pact Broker | 1 min | the request or field of the payments or catalog API that no longer matches |
| **End-to-end** | 18 | a browser against staging | 6 min | that a critical journey (pay by card, guest checkout) is broken |

- **Unit tests** check one piece of behaviour, a function or a small group of classes, in memory. Fowler's *UnitTest* (bliki, 2014) separates **solitary** tests, which replace the unit's collaborators with test doubles, from **sociable** tests, which use the real collaborators (terms from Jay Fields). Either kind is fine; what matters is that the tests are fast and each fails for one reason. Checkout's tax, discount and rounding rules are tested here, with many small cases each.
- **Integration tests** check the code that talks to something outside the process: SQL queries, transactions, locks, cache expiry. Fowler's *IntegrationTest* (bliki, 2018) argues for **narrow** integration tests, which exercise only the code that talks to one outside dependency, over broad ones that need every service running. For another service, Fowler runs them against a test double and checks the double with contract tests; for a database, Vocke's article recommends running a real one locally. Acme starts real PostgreSQL and Redis in containers for each run, and each test cleans up its own data, so no test depends on data another test left behind.
- **Contract tests** check the agreements between services without deploying them together. With **consumer-driven contracts** (Ian Robinson, martinfowler.com, 2006), each consumer states what it needs from a provider, and the provider checks on every change that it still delivers that. In Pact, checkout's tests run against a mock of payments that records each request and the response checkout expects in a contract file, a *pact*. The Pact Broker shares the pact, payments replays its interactions against the real service in its own pipeline, and the `can-i-deploy` command checks those verification results before either side deploys.
- **End-to-end tests** drive the deployed system the way a customer does. At Acme they are 18 smoke tests for the journeys that make money, run in a browser on staging after every deployment.

**Test doubles** stand in for collaborators. The vocabulary comes from Gerard Meszaros's *xUnit Test Patterns* (Addison-Wesley, 2007), summarised in Fowler's *TestDouble* (bliki, 2006): a **dummy** only fills a parameter, a **fake** is a working shortcut such as an in-memory repository, a **stub** returns canned answers, a **spy** is a stub that also records how it was called, and a **mock** is set up with the calls it expects and fails the test when they don't happen.

**Other shapes.** The pyramid is one of several shapes, and the arguments between them are partly about words:

| Shape | Named by | Largest group | Meant for |
|---|---|---|---|
| Pyramid | Mike Cohn (2009) | unit tests | software in general |
| Ice-cream cone | Alister Scott (2012), as an anti-pattern | browser and manual tests | nothing: the shape to avoid |
| Hourglass | Google's testing blog (2015) and *Software Engineering at Google* (2020), as an anti-pattern | unit and end-to-end tests, with few integration tests between them | nothing: the shape to avoid |
| Testing trophy | Kent C. Dodds (2018) | integration tests, on a base of static analysis (types and linting) | JavaScript applications |
| Honeycomb | André Schaffer and Rickard Dybeck, Spotify Engineering (2018) | integration tests that exercise each service through its API | microservices |

Ratios get quoted too. A 2015 post on Google's testing blog by Mike Wacker suggested 70% unit, 20% integration and 10% end-to-end tests as a first guess, and *Software Engineering at Google* (O'Reilly, 2020, chapter 11) gives a rough aim of 80%, 15% and 5%. Fowler's *On the Diverse And Fantastical Shapes of Testing* (2021) argues that much of the disagreement comes from different meanings of "unit test": people who prefer the honeycomb or the trophy usually picture solitary, mock-heavy unit tests, while many pyramid users write sociable ones. He ends by endorsing Justin Searls's point that the shape matters less than whether the tests are clear, quick and dependable, and fail only when something is really wrong.

## Putting it into practice

1. **List the risks, then test each at the lowest layer that can catch it.** For checkout: tax, discount and rounding rules (unit); SQL, locking and cache expiry (integration); the payments and catalog APIs (contract); paying by card and checking out as a guest (end-to-end). When a broad test finds a bug, first write the narrow test that would have caught it, then fix the code against that test, as Fowler (2012) and Vocke (2018) both advise.
2. **Run the cheap layers first.** Acme's pipeline runs every change from the base up: unit tests (40 s), integration tests (4 min), contract tests (1 min), then the deployment to staging and the smoke tests (6 min). A broken rounding rule stops the run after 40 seconds instead of 12 minutes. With the image build and the deployment, a commit is green in about 12 minutes. [Continuous Delivery](../continuous-delivery/) covers the pipeline as a whole; this page is about the shape of the tests inside it.
3. **Give each layer a time budget and watch it.** Acme's budgets are 1, 5, 2 and 8 minutes (the example's own). A layer that overruns its budget is a cue to move tests down a layer, run them in parallel or delete duplicates, before the slow stage becomes the reason people batch their changes. DORA's guide to the test automation capability says developers should hear back from the automated tests within ten minutes, on their own machines as well as in CI; Acme's full run takes about 12, so running the integration and contract stages side by side is next on the team's list.
4. **Use real dependencies, in containers, for integration tests.** Testcontainers, for example, has libraries for Java, Go, .NET, Node.js, Python, Rust and other languages, with ready-made modules for PostgreSQL, Redis and many more: each run starts a throwaway database of the same version as production, so no two runs share data (within a run, each test cleans up after itself). An in-memory substitute is faster to start but can differ from the real database in SQL dialect, types and locking.
5. **Add consumer-driven contract tests between services.** Keep each pact to the requests and fields the consumer really uses. The Pact documentation warns against putting the provider's business rules or every validation rule in a contract; those belong in the provider's own tests. Run `can-i-deploy` before each deployment, so checkout and payments can release independently.
6. **Keep end-to-end tests few and about journeys.** Smoke-test the paths that make money after each deployment, and resist adding a browser test for every bug.
7. **Quarantine flaky tests, with an owner and a fix date.** Fowler's *Eradicating Non-Determinism in Tests* (2011) recommends moving a test that fails at random out of the main pipeline at once, and limiting the quarantine, by the number of tests or by how long a test may stay, so it doesn't become a graveyard. Acme allows five tests in quarantine at most, each with an owning team and a fix date within a week: in the diagram, the guest-checkout smoke test belongs to the checkout team and is due on 16 October. Then fix the cause; Fowler lists the usual ones as shared state between tests, waiting with a fixed sleep instead of for a condition, remote services, the system clock and leaked resources.
8. **Measure the suite like a product.** Track the time from a commit to its feedback, the share of runs that fail and then pass on a re-run with no change (Acme went from 7% to under 0.5%), and which layer catches which bugs. *Software Engineering at Google* reports that tests start losing their value as the flaky rate approaches 1%, and puts Google's own rate at about 0.15%.
9. **Read coverage; don't target it.** Coverage shows which code no test runs; it can't show whether the tests check anything. Fowler's *TestCoverage* (bliki, 2012) warns that a team can hit a high number with weak tests, and treats coverage as a way to find untested code, not a goal. To test the tests, try mutation testing (PIT for the JVM, Stryker for JavaScript, C# and Scala): it makes small changes to the code and reports the ones no test notices.
10. **Shift left, and keep watching production.** *Shift-left testing*, a term from Larry Smith's 2001 article in Dr. Dobb's Journal, means testing earlier, alongside development, instead of in a phase at the end; the pyramid is one way to do it. Production still needs its own checks: a [canary release](../canary-release/) compares the new version's metrics with the old one's on a slice of real traffic, and synthetic checks run scripted customer journeys against production on a schedule (Amazon CloudWatch Synthetics canaries are one example).

## Where it fits

- [Continuous Delivery](../continuous-delivery/): the deployment pipeline runs the pyramid, its commit stage the base and its later stages the broader tests. A slow or flaky suite is the most common reason a pipeline loses the team's trust.
- [Trunk-Based Development](../trunk-based-development/): merging into main every day only works when the tests answer within minutes and a red build means something.
- [Feature Flags](../feature-flags/): code behind a flag ships dark, so test both states of the flag at the lowest layer that can, instead of doubling the browser suite.
- [Canary Release](../canary-release/) and synthetic checks in [Amazon CloudWatch](../amazon-cloudwatch/) test in production, where real traffic and data find what no test environment reproduces. They complement the pyramid; they don't replace it.
- [DORA Metrics](../dora-metrics/): test automation is one of DORA's core capabilities, and its research links it with better delivery performance when developers own and maintain the tests. A fast, trusted suite shows up in change lead time and change fail rate.
- [PostgreSQL](../postgresql/) and [Redis](../redis/), started as [Docker](../docker/) containers, are the real dependencies of Acme's integration tests.
- [The Three Ways](../three-ways/): the second way, fast feedback from right to left, is what a well-shaped suite gives every developer on every change.
- [Microservices](../microservices/): many small services are where contract tests earn their place, and where Spotify's honeycomb may fit better than a pyramid.

## When to use it

The pyramid pays off wherever a team changes code often and needs quick, precise feedback: services with real business logic, libraries, back ends that many people work on. It rests on one assumption, which Fowler spells out: broad tests are slower, costlier and more fragile than narrow ones. If your broad tests happen to be quick, stable and easy to change, the case for many narrow ones gets weaker.

Some settings need adapting:

- **Thin services.** A microservice that mostly moves data between an API and a database has little logic of its own to unit test. Spotify's honeycomb, with most tests calling the service's API against a real database, fits better.
- **JavaScript front ends.** Static types and linting catch a whole class of mistakes cheaply, and tests that render components the way a user sees them give more confidence than tests of their internals: the trophy reflects that.
- **Legacy systems with few tests.** Start with a few broad tests that pin down today's behaviour, then add narrow tests wherever you change the code. The pyramid is where you head, not where you start.
- **Regulated software.** Auditors may ask for documented, system-level validation. Keep that as a deliberate set of tests with its own evidence, and use the pyramid for day-to-day feedback.
- **Small teams and young products.** A few tests at each layer may be all you need. Ratios such as 70/20/10 are a first guess, not a target.

It returns little for code that will be thrown away soon, such as a spike or a prototype, and for units so trivial that their tests only restate the implementation.

## Common pitfalls

- **Mocks that drift from reality.** A test that stubs the payments API keeps passing after payments renames a status, and the break shows up in staging or production. Keep stubs few, and check them against the real provider: Fowler's *ContractTest* (bliki, 2011) proposes exactly that for the test doubles of external services, and in Pact the consumer's mock and the contract come from the same interactions, which the provider then verifies.
- **Contract tests that check only the shape.** A pact checks that `amount` is a number, so a wrong but well-formed 21.63 passes. That is by design, since contracts leave business rules out. Test the meaning in each side's unit and integration tests.
- **End-to-end suites that grow back.** Every incident earns a new browser test until the suite is slow and flaky again: a year on, Acme's 18 smoke tests had become 70, and the stage took 25 minutes against a budget of 8, pushing the whole run past half an hour. For each new test, ask which is the lowest layer that can catch the bug, and delete broad tests whose checks already live lower down.
- **Coverage targets that get gamed.** A team told to reach 90% can get there with tests that run code and assert nothing. Use coverage to find untested code, review tests as carefully as code, and use mutation testing to see whether the tests would notice a change.
- **Unit tests welded to the implementation.** Tests that mirror the code's structure, mock every collaborator and assert on internal calls break on every refactoring and protect little. Test behaviour through a unit's public interface, and prefer sociable tests where the collaborators are cheap.
- **An hourglass.** Many unit tests and many end-to-end tests with little in between leave database queries and service boundaries tested only through the browser. Add narrow integration tests and contract tests.
- **A ratio as the goal.** 70/20/10 or 80/15/5 describe where suites often end up; they aren't quotas. Watch feedback time, flaky runs and where bugs get caught instead.
- **Re-running instead of fixing.** Automatic retries hide flakiness. If you retry, record every retry and treat a test that needs one as flaky: quarantine it, give it an owner and a date, and fix the cause.
- **Mistaking a green pipeline for a working production.** No test environment has production's traffic, data and configuration. Add canaries and synthetic checks as a complement to the pyramid, not a substitute.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Continuous Delivery](../continuous-delivery/) — Keep every change releasable: a deployment pipeline builds once, tests in stages and promotes the same artifact to production.
- [Trunk-Based Development](../trunk-based-development/) — Everyone merges small changes into one main branch at least daily; feature flags hide unfinished work instead of long branches.
- [Canary Release](../canary-release/) — Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back.
- [DORA Metrics](../dora-metrics/) — Measure software delivery by throughput and stability: how often and how fast changes reach production, and how often they fail.
- [Feature Flags](../feature-flags/) — Deploy code dark, then turn features on per user or percentage at runtime.
- [Docker & Containers](../docker/) — Package an app and its dependencies as an image and run it as an isolated process: layers, registries, namespaces, cgroups.
- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [The Three Ways](../three-ways/) — DevOps in three principles: speed the flow of work to customers, amplify feedback back to the team, and keep learning.

## References

- [Martin Fowler — TestPyramid (bliki, 2012)](https://martinfowler.com/bliki/TestPyramid.html)
- [Ham Vocke — The Practical Test Pyramid (martinfowler.com, 2018)](https://martinfowler.com/articles/practical-test-pyramid.html)
- [Mike Cohn — Succeeding with Agile: Software Development Using Scrum (Addison-Wesley, 2009)](https://www.informit.com/store/succeeding-with-agile-software-development-using-scrum-9780321579362)
- [Alister Scott — Introducing the software testing ice-cream cone (anti-pattern) (WatirMelon, 2012; archived copy)](https://web.archive.org/web/20140326182718/http://watirmelon.com/2012/01/31/introducing-the-software-testing-ice-cream-cone/)
- [Martin Fowler — On the Diverse And Fantastical Shapes of Testing (2021)](https://martinfowler.com/articles/2021-test-shapes.html)
- [Mike Wacker — Just Say No to More End-to-End Tests (Google Testing Blog, 2015)](https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html)
- [Adam Bender — Testing Overview (Software Engineering at Google, O'Reilly, 2020, chapter 11)](https://abseil.io/resources/swe-book/html/ch11.html)
- [André Schaffer and Rickard Dybeck — Testing of Microservices (Spotify Engineering, 2018)](https://engineering.atspotify.com/2018/01/testing-of-microservices)
- [Kent C. Dodds — The Testing Trophy and Testing Classifications (2021)](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications)
- [Martin Fowler — UnitTest (bliki, 2014)](https://martinfowler.com/bliki/UnitTest.html)
- [Martin Fowler — IntegrationTest (bliki, 2018)](https://martinfowler.com/bliki/IntegrationTest.html)
- [Martin Fowler — TestDouble (bliki, 2006)](https://martinfowler.com/bliki/TestDouble.html)
- [Gerard Meszaros — xUnit Test Patterns: Refactoring Test Code (Addison-Wesley, 2007)](https://www.informit.com/store/xunit-test-patterns-refactoring-test-code-9780131495050)
- [Ian Robinson — Consumer-Driven Contracts: A Service Evolution Pattern (martinfowler.com, 2006)](https://martinfowler.com/articles/consumerDrivenContracts.html)
- [Martin Fowler — ContractTest (bliki, 2011)](https://martinfowler.com/bliki/ContractTest.html)
- [Pact documentation — Introduction](https://docs.pact.io/)
- [Pact documentation — Contract Tests vs Functional Tests](https://docs.pact.io/consumer/contract_tests_not_functional_tests)
- [Pact documentation — Can I Deploy](https://docs.pact.io/pact_broker/can_i_deploy)
- [Testcontainers — throwaway databases and services in containers for tests](https://testcontainers.com/)
- [Martin Fowler — Eradicating Non-Determinism in Tests (2011)](https://martinfowler.com/articles/nonDeterminism.html)
- [Martin Fowler — TestCoverage (bliki, 2012)](https://martinfowler.com/bliki/TestCoverage.html)
- [DORA — Capabilities: Test automation](https://dora.dev/capabilities/test-automation/)
- [Larry Smith — Shift-Left Testing (Dr. Dobb's Journal, 2001; archived copy)](https://web.archive.org/web/20150106145542/http://www.drdobbs.com/shift-left-testing/184404768)
- [Amazon CloudWatch — Synthetic monitoring (canaries)](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Synthetics_Canaries.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
