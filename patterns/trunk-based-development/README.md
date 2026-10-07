<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧭 DevOps & SRE Principles](../../README.md#devops--sre-principles)

# Trunk-Based Development

> Everyone merges small changes into one main branch at least daily; feature flags hide unfinished work instead of long branches.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Trunk-Based Development" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/trunk-based-development.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Three weeks on a branch** | The catalog team used GitFlow: the new search filters lived on `feature/search-filters` for three weeks while `feature/sort-options` changed the same query code and `develop` moved on. Each branch built green on its own, but the merge touched 214 files and took two days of fixing conflicts, and the bugs that only appear when both features run together surfaced in staging in release week. The release branch then needed two more merges, into `main` and back into `develop`. |
| **2 · Merged the same day** | Now every change starts from `main` and comes back the same day. Mai branches at 09:10 for the next slice of the filters, opens pull request #1287 at 10:00 with 98 changed lines, CI passes in 8 minutes, Ben approves at 10:40 and it merges at 10:50; the branch is deleted. The filters aren't finished, so the new code sits behind the `filters.v2` flag, which is off in production: the green build deploys at 11:00 and customers still get the old filters (see [Feature Flags](../feature-flags/)). |
| **3 · One day, nine merges** | By 18:00 the six developers have merged nine pull requests, each followed by a green 8-minute build on `main`, and the catalog service has deployed every one of them, with unfinished work behind flags. Kai's large refactor lands as three small merges using [Branch by Abstraction](../branch-by-abstraction/). Teams that ship on a schedule, such as the mobile app, cut a release branch from `main` instead and cherry-pick fixes that were made on `main` first; and when a build on `main` turns red, the team fixes it or reverts the change at once. |
| **4 · Limits and pitfalls** | Trunk-based development leans on fast, reliable CI and good automated tests: when the build takes 45 minutes or fails at random, people batch their changes and `main` stays red. Flags left in the code after their release (`sort.v2`, `promo.bf`) become debt, so delete them, and a pull request that waits three days for review, like #1312, pushes people back to big branches. Open-source projects with outside contributors work through forks and pull requests that maintainers review, which is a different setting from one team sharing a repository. |
<!-- END GENERATED: header -->

## The problem

A branch that lives for weeks holds work nobody else has integrated. While it is open, the mainline and every other branch keep changing, so the merge at the end grows with every day it waits. Part of the damage shows up as conflicts that Git reports. The worse part merges cleanly: two changes that are each correct on their own but break each other once they run together, like Acme's new filters and the new sorting in the diagram. Nobody sees those until the combined code is tested, and on a release schedule that means a few days before the release.

Branching models built around long-lived branches add merges of their own. In GitFlow, features merge into `develop`, a release branch is cut from `develop` and then merged into `main` and back into `develop`, and hotfix branches merge into both. Vincent Driessen, who published the model in 2010, added a note in March 2020: he wrote it for software that is explicitly versioned or has several versions in use, and he steers teams doing continuous delivery towards a simpler flow such as GitHub flow. Teams that dread merge day often add code freezes and stabilization phases, which push the feedback even further out.

## How it works

The best-known description is [trunkbaseddevelopment.com](https://trunkbaseddevelopment.com/), written by Paul Hammant with contributors. Developers work together on one branch, the trunk (`main` in most Git repositories), and don't create long-lived development branches; a few techniques keep the trunk working while they do. The site describes two styles:

- **Committing straight to the trunk.** Each developer runs the same build that CI runs, then pushes to `main`. The site suggests this works for teams of up to about 15 people.
- **Short-lived feature branches.** In larger teams a branch belongs to one developer (or a pair), is reviewed through a pull request and checked by CI, and is merged and deleted within a couple of days at most. Past two days, the site warns, it is turning into a long-lived branch. DORA's description is tighter: branches that typically last no more than a few hours.

**Continuous integration, taken literally.** Martin Fowler's [Continuous Integration](https://martinfowler.com/articles/continuousIntegration.html) article (revised January 2024) asks every developer to push commits to the mainline at least once a day, every push to trigger a build, and a broken build to be fixed at once, by reverting the faulty commit if that is quicker. A build server that tests branches kept apart for weeks gives green builds without the integration. In his 2020 article on branching patterns Fowler explains that many teams use CI tools only to build feature branches, and that this dilution is part of why some people say *trunk-based development* instead of *continuous integration*. He mostly hears the two terms used as synonyms and keeps the older one.

**What DORA measures.** DORA lists trunk-based development as one of its capabilities and characterises it by three or fewer active branches in the repository, branches merged to trunk at least once a day, and no code freezes or integration phases. Its analysis of the 2016 and 2017 survey data found that teams following these practices reach higher software delivery and operational performance. That is a statistical association across many organisations, not a promise for any one team.

**Unfinished work merges dark.** A feature that takes weeks still lands in small pieces. New behaviour stays behind a [feature flag](../feature-flags/) that is off until it is ready, as `filters.v2` is in the diagram. A large rework grows behind an interface with [branch by abstraction](../branch-by-abstraction/), and database changes go in as backward-compatible steps with [expand and contract](../expand-and-contract/). After each step `main` can still be released.

**Releases come from the trunk.** A team that practises [continuous delivery](../continuous-delivery/) releases straight from `main` and fixes problems forward, as the catalog service does. A team that ships on a schedule, like Acme's mobile app, cuts a release branch from `main` shortly before the release. A bug is reproduced and fixed on `main` first and the fix is then cherry-picked onto the release branch, never the other way round, and nothing is merged back. Once the release is out of use the branch is deleted, after the released commit has been tagged.

**At scale.** In *Why Google Stores Billions of Lines of Code in a Single Repository* (Communications of the ACM, July 2016), Rachel Potvin and Josh Levenberg describe trunk-based development on Google's monolithic repository. In January 2015 it held about two billion lines of code in nine million source files, shared by more than 25,000 developers who committed about 16,000 changes on a typical workday, while automated systems committed another 24,000. Nearly everyone works at head and development on branches is rare. Release branches are cut from a chosen revision and receive fixes developed on the mainline and cherry-picked, new code paths sit behind flags, and every change is reviewed before it is committed. It works because Google built tooling for it: its own repository system, Piper, plus systems for testing, code review, static analysis and large automated changes.

## Putting it into practice

1. **Measure where you are.** Count the active branches and their age, the merges to `main` per day, how long pull requests wait for review, and how many code freezes you have. These are the measures DORA suggests.
2. **Protect `main` and keep it green.** Require a passing CI run on every pull request and run CI again on `main` after each merge (branch protection rules or rulesets on GitHub, protected branches on GitLab). When a build on `main` fails, fixing it comes first: fix it within minutes or revert the change, and nobody merges on red.
3. **Keep CI fast and reliable.** Fowler repeats the Extreme Programming guideline of a ten-minute build; the catalog team's takes 8. Cache dependencies, run tests in parallel, move slow suites to later stages of the pipeline, and fix or quarantine flaky tests, because a build nobody trusts gets ignored.
4. **Make changes small.** Google's engineering practices call about 100 lines a reasonable size for a change and 1,000 lines usually too large. Split work into thin vertical slices or stacked changes, and keep refactoring apart from changes in behaviour.
5. **Review within hours.** Google's guide makes one business day the longest a reviewer should take to respond; the trunk-based development site aims for minutes. Pick up review requests before starting new work, and pair on hard changes: Fowler points out that pair programming is code review that never waits. *Ship / Show / Ask* (Rouan Wilsenach, 2021) lets some changes merge first and be reviewed afterwards, where your compliance rules allow it.
6. **Hide what isn't finished.** Give each new flag an owner, a removal task and an expiry date, and delete the flag and the dead code path once the feature is fully released.
7. **Decide how you release.** Release from `main` through a deployment pipeline, or cut short-lived release branches and cherry-pick fixes from `main`. Either way there is no stabilization phase on a separate branch.
8. **Add a merge queue when merges collide.** At high commit rates two pull requests can pass on their own and break `main` together. A merge queue tests each one against the latest `main` plus the pull requests queued ahead of it; GitHub's merge queue and GitLab's merge trains are examples.
9. **Move off long-lived branches step by step.** Stop creating new ones, finish or flag the open ones, make `main` the only branch that lives on, and shorten branch lifetimes from weeks to days to hours.

## Where it fits

- [Continuous Delivery](../continuous-delivery/) needs one mainline that is always releasable. Trunk-based development gets every change onto it, and the deployment pipeline takes it from there.
- [Feature Flags](../feature-flags/) and [Branch by Abstraction](../branch-by-abstraction/) are the techniques that let unfinished and large changes merge every day; [Expand and Contract](../expand-and-contract/) does the same for database schemas. This page is about where code is integrated and how often; those pages are about how to cut the work so it can be.
- [Canary Release](../canary-release/) and [Blue-Green Deployment](../blue-green-deployment/) keep the frequent deploys that follow from hurting users.
- [DORA Metrics](../dora-metrics/): small, frequent merges shorten the lead time for changes and raise deployment frequency, and DORA tracks trunk-based development as a capability that drives them.
- [The Three Ways](../three-ways/): small batches flowing through one mainline are the first way, flow, and a build after every merge is the second, fast feedback.

## When to use it

- Teams that own a service and deploy it often: fewer merges, earlier feedback, and a `main` that can ship at any time.
- Any team that dreads merge day, or freezes code before a release.
- Monorepos and shared libraries, where every long-lived branch multiplies the conflicts.

Adapt it where the setting differs:

- **Team size.** A small team that pairs can commit straight to `main`; larger teams use short-lived branches and pull requests, as the six-person catalog team in the diagram does.
- **Regulated environments** that require a second person to approve every change: mandatory pull request reviews satisfy that, as long as reviews come back within hours.
- **Legacy code with few tests or a slow build.** Invest in the build and the tests first, and shorten branch lifetimes as confidence grows.
- **Installed or mobile software** with several versions in use: keep a release branch per supported version and cherry-pick fixes from `main`.

It fits poorly where the contributors aren't one team, as in classic open-source projects: occasional contributors from outside work in forks and send pull requests that a few maintainers review. Fowler's CI article makes the same distinction. Continuous integration assumes a committed team, and feature branches with pull requests suit that other setting better.

## Common pitfalls

- **Trunk-based in name only.** A branch called `main` with pull requests that stay open for a week is still feature branching. Track branch age and review wait times, and aim for merges within a day.
- **A slow or flaky build.** At 45 minutes, or with tests that fail at random, people batch their changes and stop trusting red. Keep the build near ten minutes, fix flaky tests, and run the long suites after the merge.
- **A red `main` left red.** Everyone builds on a broken mainline. Revert within minutes, then fix the change on its branch.
- **Flags that outlive their release.** Each old flag is a branch in the code that nobody tests and somebody can flip by mistake. Pete Hodgson's article on feature toggles describes teams that add a removal task with every new release flag, set expiry dates, or cap how many flags a system may have.
- **Reviews that take days.** Waiting pull requests grow, and people go back to big branches to avoid the wait. Review within hours, keep changes small, and pair on the hard ones.
- **Fixing on the release branch and merging back.** Fixes get lost or arrive twice. Fix on `main` first, then cherry-pick.
- **Freezing `main` before a release.** A freeze stops everyone's integration at once. Cut a release branch, or release from a tag on `main`.
- **Copying the open-source workflow into one team.** Forks and gatekeeping reviews protect maintainers from strangers' code; inside one team they only add delay. Work in one shared repository with short-lived branches.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Continuous Delivery](../continuous-delivery/) — Keep every change releasable: a deployment pipeline builds once, tests in stages and promotes the same artifact to production.
- [Feature Flags](../feature-flags/) — Deploy code dark, then turn features on per user or percentage at runtime.
- [Branch by Abstraction](../branch-by-abstraction/) — Introduce an abstraction, build the new implementation behind it, then switch over.
- [DORA Metrics](../dora-metrics/) — Measure software delivery by throughput and stability: how often and how fast changes reach production, and how often they fail.
- [The Three Ways](../three-ways/) — DevOps in three principles: speed the flow of work to customers, amplify feedback back to the team, and keep learning.
- [Canary Release](../canary-release/) — Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back.

## References

- [Paul Hammant and contributors — Trunk Based Development](https://trunkbaseddevelopment.com/)
- [Trunk Based Development — Committing straight to the trunk](https://trunkbaseddevelopment.com/committing-straight-to-the-trunk/)
- [Trunk Based Development — Short-Lived Feature Branches](https://trunkbaseddevelopment.com/short-lived-feature-branches/)
- [Trunk Based Development — Branch for release](https://trunkbaseddevelopment.com/branch-for-release/)
- [DORA — Capabilities: Trunk-based development](https://dora.dev/capabilities/trunk-based-development/)
- [Martin Fowler — Continuous Integration (revised January 2024)](https://martinfowler.com/articles/continuousIntegration.html)
- [Martin Fowler — Patterns for Managing Source Code Branches (2020)](https://martinfowler.com/articles/branching-patterns.html)
- [Rachel Potvin and Josh Levenberg — Why Google Stores Billions of Lines of Code in a Single Repository (Communications of the ACM, July 2016)](https://research.google/pubs/why-google-stores-billions-of-lines-of-code-in-a-single-repository/)
- [Google Engineering Practices — Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html)
- [Google Engineering Practices — Speed of Code Reviews](https://google.github.io/eng-practices/review/reviewer/speed.html)
- [Rouan Wilsenach — Ship / Show / Ask (2021)](https://martinfowler.com/articles/ship-show-ask.html)
- [Vincent Driessen — A successful Git branching model (2010, note of reflection 2020)](https://nvie.com/posts/a-successful-git-branching-model/)
- [Pete Hodgson — Feature Toggles (aka Feature Flags)](https://martinfowler.com/articles/feature-toggles.html)
- [GitHub Docs — Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
- [GitLab Docs — Merge trains](https://docs.gitlab.com/ci/pipelines/merge_trains/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
