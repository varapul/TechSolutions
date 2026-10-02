<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔄 Migration & Modernization](../../README.md#migration--modernization)

# Branch by Abstraction

> Introduce an abstraction, build the new implementation behind it, then switch over.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Branch by Abstraction" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/branch-by-abstraction.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Create the seam** | Checkout, Invoicing and Reports call the LegacyPay client directly, and replacing it will take weeks. Instead of a long-lived branch, the work happens on the main branch: one commit adds a `PaymentGateway` interface that says what the callers need, with the old client behind it, and each following commit moves one caller onto it. After every commit the application still builds, passes its tests and is released. |
| **2 · Build behind the interface** | A switch and a suite of contract tests land next, with the switch pointing at the old client. The NewPay client then grows behind the interface, one method per commit. It is compiled, tested and shipped in every release, but nothing calls it yet, and it is finished when it passes the same contract tests as the old client. |
| **3 · Switch, with a way back** | The switch here is a runtime flag, so moving it needs no deployment. It moves first for the caller where a mistake costs least (Reports), then for all of them. The old client is still in place and still tested, so the way back is to flip the flag again, which takes seconds: nothing has to be reverted or merged back. |
| **4 · Clean up** | Once the new client has carried all the traffic for long enough, two more small commits delete the old client and the switch. The interface stays if it is a useful boundary (it is the seam the next replacement will need) and is inlined if it is not. The main branch was releasable at every commit, other work kept landing on it, and no long-lived branch ever existed. |
<!-- END GENERATED: header -->

## The problem

Some changes do not fit into one commit. Replacing a payment provider's client, an object-relational mapper, an HTTP library or a pricing engine means touching something that is called from many places, whose replacement takes weeks to write, while the application has to keep shipping.

The reflex is a branch in version control: do the work there and merge it when it is finished. A branch that lives for weeks is paid for at the end.

- **The merge grows with the distance.** The main branch moves every day, and the replacement touches exactly the code that everyone else's changes call. Conflicts in the text are the easy part. The expensive ones are what Martin Fowler calls semantic conflicts: both sides merge cleanly, and the result no longer builds, or builds and behaves wrongly.
- **Nothing is integrated until the end.** For weeks the new code is never compiled, tested or run together with the rest of the team's work, and it reaches production in one large release that carries all of its risk at once.
- **It freezes the code around it.** Anyone who refactors the affected area on the main branch makes the coming merge worse, so people stop. Fowler suggests that this deterrent to refactoring may be the biggest problem with feature branches.
- **It cannot be put down.** A half-finished branch that waits a month behind an urgent project has to be merged forward again before the work can resume.

Teams that practise continuous integration avoid this by keeping branches short. DORA's research associates higher delivery performance with three or fewer active branches, merging to trunk at least once a day, and no code freezes or integration phases, and the trunk-based development guide gives a feature branch a couple of days at most. A replacement that takes weeks does not fit into such a branch. Branch by abstraction is how to do it without one.

## How it works

Put the branch in the code instead of in version control. An abstraction goes between the callers and the component to be replaced, the old and the new implementation live side by side behind it on the main branch, and a switch decides which of them is used. Every commit along the way is small and leaves the application releasable.

The diagram replaces a payment provider's client, LegacyPay, with a new one, NewPay. Three parts of the application call it: Checkout, Invoicing and Reports. On the strip at the top, every green check is a commit on the main branch that was built, tested and released, the small dots are other people's work landing in between, and the diamonds are flag changes.

1. **Create the seam.** Add an abstraction that says what the callers need (`PaymentGateway`, with `charge`, `refund` and `payouts`) and put the existing implementation behind it, through a thin adapter where the old API has a different shape. Nothing behaves differently yet.
2. **Move the callers onto it, one at a time.** Each caller that stops using the old client directly is one small commit; the diagram counts the direct uses down from three to zero. Until the last caller has moved, both styles exist side by side, and every commit in between still builds, passes its tests and is released.
3. **Build the new implementation behind the abstraction.** It grows on the main branch commit by commit, here one method at a time. It is compiled, tested and shipped in every release, but the switch still selects the old implementation, so nothing in production reaches it. Fowler calls this *latent code*: code that is present in a live release although the work it belongs to is unfinished.
4. **Switch over.** Move the switch to the new implementation, for one caller or one environment first and then for everything. The old implementation stays where it is, so the way back is the switch itself.
5. **Clean up.** Delete the old implementation, then the switch. Keep the abstraction if it is a boundary worth having, and inline it if it is not.

The diagram shows the first two as a single step. Seen from the main branch, the whole replacement is ten small commits and two flag changes:

| Change | Production uses | Way back |
|---|---|---|
| add `PaymentGateway`, with the old client behind it | the old client, called directly | revert one small commit |
| move Reports, then Invoicing, then Checkout (a commit each) | the old client, through the interface | revert that commit |
| add the contract tests and the switch | the old client | revert that commit |
| build NewPay, one method per commit | the old client; the new code ships but is not called | nothing to undo |
| *flag:* Reports uses NewPay | NewPay for Reports, the old client for the rest | flip the flag back |
| *flag:* every caller uses NewPay | NewPay | flip the flag back |
| delete the LegacyPay client | NewPay | redeploy the previous release |
| delete the switch | NewPay | |

**Where it comes from.** Teams worked this way before the technique had a name. Paul Hammant wrote it up in 2007 in [Introducing Branch By Abstraction](https://paulhammant.com/blog/branch_by_abstraction.html), under a name he credits to Stacy Curl and sets against branching in source control, and his [trunk-based development guide](https://trunkbaseddevelopment.com/branch-by-abstraction/) carries a longer description. The guide puts two rules over the whole exercise: the rest of the team must not be slowed down, and the ability to go live must never be put at risk. Jez Humble's 2011 article, [Make Large Scale Changes Incrementally with Branch By Abstraction](https://continuousdelivery.com/2011/05/make-large-scale-changes-incrementally-with-branch-by-abstraction/), shows the technique on a real product. The team behind ThoughtWorks' Go, a continuous integration and release management server, had by then spent more than a year moving its persistence from iBatis to Hibernate, and was moving its user interface from Velocity and JsTemplate to JRuby on Rails in the same way, while developing new features on the same mainline and checking in several times a day. Martin Fowler's 2014 summary, [Branch By Abstraction](https://martinfowler.com/bliki/BranchByAbstraction.html), describes the same sequence in terms of clients and suppliers. The books *Continuous Delivery* (Jez Humble and David Farley) and *Monolith to Microservices* (Sam Newman) both cover it.

### Tests that both implementations share

The abstraction is also where the behaviour gets pinned down. Write tests against the interface alone (what `charge` returns for a declined card, what `payouts` returns for a day without any) and run the same suite against every implementation. These are contract tests in the plain sense of the word: they state what any implementation of `PaymentGateway` must do. The term is also used for tests between services; here the contract is an interface inside one codebase.

The old implementation passes them from the start, because they are written by observing what it does, including the quirks its callers have come to rely on. For the new implementation they are the list of work and the definition of done: in the diagram a method turns green when its tests pass. A red build is not allowed on the main branch, so the tests for a method the new implementation does not have yet are skipped for it, and switched on in the commit that adds the method. Keep running the suite against both for as long as both exist. That is what keeps the old implementation a way back that actually works.

### The switch

One place decides which implementation the abstraction hands out. How dynamic that place is determines what the switch-over and the way back look like.

- **In the code or the build.** The wiring (a factory, the dependency-injection configuration) names one implementation. Humble describes this as the usual case: the developers choose, and the choice is hard-coded or fixed at build time. Switching is a one-line commit, and going back is another commit and another release.
- **In configuration read at start-up.** A property or an environment variable selects the implementation, so test and staging can run the new one while production stays on the old one. Going back is a configuration change and a restart.
- **A runtime flag.** The abstraction asks a [feature flag](../feature-flags/) on every call. The switch can then move for one caller, one tenant or a share of the traffic without a deployment, and it moves back in seconds. Steve Smith's argument for it is that a run-time toggle lowers the cost of a switch-over that goes wrong. This is the variant in the diagram.

Whichever it is, switch in slices and start where a mistake is cheapest. Reports only reads and Checkout takes money, so Reports goes first. The flag is a release flag: it exists for the length of the migration and is deleted together with the switch.

### Running both and comparing

Passing the same tests does not prove the same behaviour on production data. While both implementations are in place they can be given the same inputs and compared before the switch moves, which is a parallel run on the scale of one component. Fowler notes that flags let the new supplier run in test environments so that its behaviour can be compared with the old one's. Steve Smith's variant, *verify branch by abstraction*, points the toggle at a verifying implementation that calls both with the same input and fails fast when the results differ. The gentler form for production serves the old result, calls the new implementation as well and records every difference; GitHub's Scientist library does this for Ruby, and ports exist for other languages.

Only compare calls that change nothing. Comparing two answers to `payouts(day)` is harmless; calling `charge` on both providers charges the customer twice. Scientist's documentation draws the same line: it is meant for code that does not change data.

### Where the abstraction lives

The abstraction belongs to the callers. It says what they need, in their terms, not what the old implementation happens to offer: `charge(order)`, not a method that takes the old provider's request object. In the vocabulary of [hexagonal architecture](../hexagonal-architecture/) it is a driven port and the two implementations are adapters. A codebase organised that way already has its seams, and one that is not gains its first port here.

A good abstraction for this job is narrow (only the operations the callers really use), free of the old implementation's types (if LegacyPay's error codes cross it, the new implementation has to imitate them) and designed with the new implementation in mind. Expect to adjust it while the new implementation takes shape; Hammant's guide allows for that under the same rule as every other commit, which is that the build stays green. Where the old component's model has already leaked into its callers, the abstraction doubles as an [anti-corruption layer](../anti-corruption-layer/).

It does not have to be an interface written for the occasion. In Humble's examples the abstraction for the persistence change was the repository layer the application already had, and for the user interface it was the servlet engine, which sent each URL to the old or the new stack.

### When data has to move too

Swapping an implementation does not move its state. If the new one stores data differently (another table, another provider's customer and payment identifiers), the data migration runs alongside in its own compatible steps: write to both, backfill, compare, switch the reads, stop writing the old. That is [expand and contract](../expand-and-contract/).

State also limits the way back. A payment taken through NewPay has to be refunded through NewPay, even after the flag has been flipped back, so for operations on existing records the switch may have to look at the record as well as at the flag.

### The same idea at other levels

A [strangler fig](../strangler-fig/) does the same thing one level up. It puts a facade in front of a whole legacy system and moves routes to new services one at a time, across deployables. Branch by abstraction stays inside one codebase and one deployable: its facade is an interface and its routes are callers. The two combine. The new implementation behind the abstraction can be a client for a new service, which is how a module is carved out of a monolith; in a modular monolith, the module's public interface is the abstraction.

A feature flag hides a *feature* from users at runtime. Branch by abstraction is a way of structuring a *change* in the code, and a flag can serve as its switch. Expand and contract is the same shape applied to schemas and contracts: add the new beside the old, move everyone across, remove the old.

## When to use it

- **Replacing something with many callers:** a provider's SDK, a persistence framework, a messaging or HTTP library, an in-house module that has to be rewritten.
- **Reworking an algorithm or a subsystem** that has to keep working, and keep changing, while the rework is under way.
- **Extracting a module from a monolith** into a service, with the service's client as the new implementation.
- **Any change that would otherwise sit on a branch for more than a few days,** on a team whose main branch has to be releasable every day.

**When not to use it.** A change that fits into a short-lived branch, a day or two of work that is reviewed and merged in one piece, needs none of this: the abstraction, the second implementation and the switch would cost more than the merge. The same goes for a component with a single caller. Other situations call for a neighbouring pattern: a new feature with nothing to replace only needs a flag, a change to the shape of data is expand and contract, and replacing a whole system across deployables is a strangler fig. The trunk-based development guide adds one more limit: the technique does not help when older releases have to be maintained for customers who upgrade when they choose.

## Trade-offs

- **Temporary indirection.** For the length of the migration the code carries an extra layer, a switch and a flag that it will not need afterwards.
- **Two implementations to keep working.** Every bug fix and every new requirement in that area lands twice until the old one is gone, and the pipeline has to keep both paths green. The longer the transition, the more of this double work there is.
- **Slower on paper.** Humble is open about the overhead, which grows in a codebase with little structure, where the seam has to be created before anything else can start. The cost of the alternative is only less visible, because it is deferred to the merge.
- **The discipline to finish.** The clean-up adds no feature, so it is the step that gets dropped. A migration that stalls at 80% leaves two implementations, a switch nobody dares to remove and newcomers who cannot tell which path is real. Plan the deletion when you plan the abstraction, and track the remaining callers as a number.
- **Pausing and cancelling are cheap, though.** Because the unfinished implementation is compiled and tested with everything else, the work can stop for a month and resume without a merge. Cancelling means deleting the new implementation and, if you like, the abstraction.
- **Unfinished code ships.** The new implementation is in every release from its first commit. It has to meet the same quality bar as the rest of the main branch, it must be unreachable until the switch moves, and the switch must default to the old implementation.
- **One abstraction may not cover both.** If old and new differ in more than their internals (an immediate answer against a later notification, different error or consistency behaviour), no interface hides the difference and the callers have to change as well.
- **Both have to coexist in one build.** Two major versions of one library that cannot be loaded side by side have to be isolated first, for example in separate modules or processes.

## Implementation notes

- **Find the seam, or make one.** Michael Feathers's *Working Effectively with Legacy Code* (2004) introduced the word *seam* for a point where behaviour can be replaced from outside while the code at that point stays as it is: an interface, a constructor parameter, a function that is passed in. Code that calls static methods, constructs its dependencies inline or passes an SDK's types around has none. Create one with small, behaviour-preserving refactorings: wrap the old API in a class of your own, extract an interface from that class, and hand it to the callers instead of letting them reach for the dependency. Fowler's article on legacy seams shows several ways to do it, and Feathers's book has a whole part on dependency-breaking techniques. Before you start, write tests that record what the code does today.
- **Put a ratchet on the old way.** The Go team's rule was that nobody adds to the old style, and Humble's article suggests enforcing it by failing the build whenever the number of old-style queries goes up, so that the count can only fall. The same works for direct uses of an old client. ArchUnit's `FreezingArchRule` records the existing violations of a rule, reports only new ones and shrinks the list as they are fixed. ESLint's `no-restricted-imports` forbids importing a module, and can be switched off for the one adapter that is allowed to. A deprecation annotation on the old API tells the people the linter does not reach.
- **One switch, in the wiring.** Do not scatter `if (flag)` over the call sites. For a start-up switch the dependency-injection configuration is enough: in Spring Boot, `@ConditionalOnProperty(name = "payments.gateway", havingValue = "newpay")` registers a bean only when the property has that value. A runtime switch is one more implementation of the interface, which asks the flag on every call:

  ```java
  interface PaymentGateway {                       // the seam: what the callers need
      Receipt charge(Order order);
      Refund refund(Payment payment);
      List<Payout> payouts(LocalDate day);
  }

  final class SwitchedGateway implements PaymentGateway {
      private final PaymentGateway legacyPay, newPay;
      private final Flags flags;
      private final String caller;                 // "checkout", "invoicing" or "reports"

      SwitchedGateway(PaymentGateway legacyPay, PaymentGateway newPay, Flags flags, String caller) {
          this.legacyPay = legacyPay; this.newPay = newPay; this.flags = flags; this.caller = caller;
      }

      public Receipt charge(Order order)         { return current().charge(order); }
      public Refund refund(Payment payment)      { return current().refund(payment); }
      public List<Payout> payouts(LocalDate day) { return current().payouts(day); }

      private PaymentGateway current() {           // asked on every call, so a flip takes effect at once
          return flags.isOn("payments.newpay", caller) ? newPay : legacyPay;
      }
  }
  ```

  The callers never learn that there are two implementations, and deleting the switch later means deleting this class and one line of wiring.
- **Run one test suite against both.** In JUnit Jupiter, put the tests in a test interface as default methods and implement it once for each implementation; the user guide describes this use for interface contracts. In pytest, a fixture parametrized with both implementations runs every test that uses it once for each.
- **Watch each implementation separately.** Tag metrics and logs with the implementation that served the call, so that error rate and latency can be compared between old and new while the switch moves, and decide beforehand which numbers mean "flip it back".
- **Delete in separate commits.** First the old implementation, together with what only it needed (its dependency in the build file, its configuration, its credentials), which leaves a switch with one side. Then the switch and the flag. Leave time between the last flag change and the first deletion, because after it the way back is a redeployment and no longer a flip.
- **Decide what happens to the abstraction.** Keep it when it isolates a third party, when it is where the next replacement will happen, or when tests use it to substitute a fake. Inline it when it has one implementation and hides nothing.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Strangler Fig](../strangler-fig/) — Put a facade in front of the legacy system and move routes to new services one at a time.
- [Feature Flags](../feature-flags/) — Deploy code dark, then turn features on per user or percentage at runtime.
- [Expand and Contract](../expand-and-contract/) — Change a schema or API in backward-compatible steps: expand, migrate, then contract.
- [Parallel Run](../parallel-run/) — Run old and new side by side on the same inputs and compare results before cutting over.
- [Hexagonal (Ports & Adapters)](../hexagonal-architecture/) — Domain logic at the core; UIs, databases and queues plug in through ports and adapters.
- [Anti-Corruption Layer](../anti-corruption-layer/) — A translation layer that keeps a legacy model from leaking into the new domain.
- [Modular Monolith](../modular-monolith/) — One deployable unit built from strongly bounded modules that talk through explicit interfaces.

## References

- [Paul Hammant — Introducing Branch By Abstraction (the 2007 post)](https://paulhammant.com/blog/branch_by_abstraction.html)
- [Trunk Based Development — Branch by Abstraction](https://trunkbaseddevelopment.com/branch-by-abstraction/)
- [Jez Humble — Make Large Scale Changes Incrementally with Branch By Abstraction](https://continuousdelivery.com/2011/05/make-large-scale-changes-incrementally-with-branch-by-abstraction/)
- [Martin Fowler — Branch By Abstraction](https://martinfowler.com/bliki/BranchByAbstraction.html)
- [Steve Smith — Application pattern: Verify Branch By Abstraction](https://www.stevesmith.tech/blog/application-pattern-verify-branch-by-abstraction/)
- [Jez Humble and David Farley — Continuous Delivery (book)](https://martinfowler.com/books/continuousDelivery.html)
- [Sam Newman — Monolith to Microservices (book)](https://samnewman.io/books/monolith-to-microservices/)
- [Michael Feathers — Working Effectively with Legacy Code (book)](https://www.informit.com/store/working-effectively-with-legacy-code-9780131177055)
- [Martin Fowler — Legacy Seam](https://martinfowler.com/bliki/LegacySeam.html)
- [Martin Fowler — Patterns for Managing Source Code Branches](https://martinfowler.com/articles/branching-patterns.html)
- [Martin Fowler — Continuous Integration](https://martinfowler.com/articles/continuousIntegration.html)
- [DORA — Capabilities: Trunk-based development](https://dora.dev/capabilities/trunk-based-development/)
- [Trunk Based Development — Short-Lived Feature Branches](https://trunkbaseddevelopment.com/short-lived-feature-branches/)
- [GitHub — Scientist: a Ruby library for carefully refactoring critical paths](https://github.com/github/scientist)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
