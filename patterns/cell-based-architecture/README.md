<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🏛️ Application Architecture](../../README.md#application-architecture)

# Cell-Based Architecture

> Many isolated, identical cells behind a thin router contain the blast radius of any failure.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Cell-Based Architecture" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/cell-based-architecture.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One stack for everyone** | Twelve customers share one stack: one load balancer, eight app instances and one database. Customer J sends a **poison request**, one that crashes whichever instance handles it, and each retry crashes another until the service is down for everyone. A bad deployment would do the same, since it reaches every customer at once, and the only way to grow is to make this one stack bigger. |
| **2 · Split into cells** | The same stack is deployed as four identical, independent **cells**, each with its own load balancer, instances and database, and each serving a fixed list of customers. A thin **cell router** reads the request's partition key (here the customer ID), looks up that customer's cell and forwards the request, with no business logic of its own. Cells share no state and never call each other, so a failure inside one cell has no way into another. |
| **3 · Failure stays in one cell** | J's poison request is routed to cell 2, where it and its retry crash both instances, but only cell 2's customers D, J and M are affected: **25%** with four cells. K and the other customers of cells 1, 3 and 4 notice nothing. Cells contain bad deployments the same way: a new version goes to one cell first, bakes while its alarms are watched, and reaches the others only if it stays healthy. |
| **4 · Grow by adding cells** | Each cell has a fixed maximum size that has been load-tested (here, three customers). When the cells are full, a fifth cell is added for the new customers instead of growing the old ones, and one cell's share of customers drops to 20%. The router is the one part every request passes through, so it stays a tiny lookup, runs replicated with its table cached in memory, and is changed with more care than any cell. Moving an existing customer to another cell means moving their data, so plan for it from the start. |
<!-- END GENERATED: header -->

## The problem

Most services start as one deployment: a load balancer, a fleet of identical instances and one database, with every customer going through all of it. Spreading that deployment over several availability zones protects it against losing a data centre. It does nothing against failures that start in the software itself, because every copy runs the same code and sees the same traffic:

- **A bad deployment or configuration change** reaches every customer at the same moment.
- **A poison request**, one whose content triggers a crash, takes down the instance that handles it. The client or the load balancer retries it on the next instance, which crashes too, until none are left.
- **One heavy or misbehaving customer** (a runaway script, a sudden spike, a noisy neighbour) can exhaust the shared database or queue for everyone.
- **An operator mistake or corrupt data** hits the only copy there is.

Whatever goes wrong, the blast radius is 100% of the customers. Growth makes it worse: the only way to grow one deployment is to make it bigger, and a system that only ever gets bigger meets its limits (the largest database you can buy, an account quota, a lock that turns hot at ten times the load) for the first time in production, because nobody can afford a test environment of the same size.

## How it works

Instead of one big deployment, run many small, identical ones, called **cells**, and give each a fixed share of the customers:

- A **cell** is a complete copy of the workload: its own entry point, compute, database, caches and queues. Cells share no state and never call each other, so a failure inside one cell has no path into another.
- Every request carries a **partition key** (a customer, tenant or account ID), and each customer lives in exactly one cell.
- A **cell router** sits in front of the cells. It reads the key, looks up the customer's cell and forwards the request. It does nothing else.
- A **control plane**, outside the request path, creates cells, decides where new customers go, moves customers between cells and updates the router's table.

With N cells of equal size, a failure that stays inside one cell reaches 1/N of the customers: 25% with the four cells in the diagram, 1% with a hundred. AWS says its own service teams have built this way for more than a decade, and its Well-Architected Reliability Pillar lists the approach as best practice REL10-BP03, under the name *bulkhead architectures*.

### What goes into a cell, and what stays out

A cell contains everything a request needs from start to finish, including the data. In the example of AWS's whitepaper, a cell is an Application Load Balancer, a group of EC2 instances and an RDS database, and a second cell is a second copy of all three. The more complete the separation the better: separate databases, buckets and queues, and ideally a separate cloud account per cell, which also gives each cell its own quotas.

Dependencies are where isolation leaks away. If every cell calls the same internal service, the same identity provider or the same cache cluster, that dependency is shared, and its blast radius is still 100%. Give each cell its own instance of a dependency where you can, make the dependencies you own cellular as well, and treat the rest as known shared risks with timeouts and fallbacks of their own.

Where a cell lives is a separate decision:

- **Cells that span availability zones** (regional cells) inherit the multi-zone resilience of the managed services inside them, so losing a zone does not take a cell down. But when one zone is only half broken, every cell is a little affected and there is no single cell to take out of service.
- **Cells that live in one zone** make the zone the unit of failure: a sick zone can be identified and drained precisely. In return, the routing has to be zone-aware, and each cell needs its own recovery plan for losing its zone, which usually means replicating its data to another zone and so loosening the isolation.

Only three things stay outside the cells: the **router**, the **control plane**, and features that really need data from every cell (see below). Keep all three as small as possible, because everything outside a cell is shared again.

### The partition key and where customers go

The key should follow the natural grain of the workload: a unit whose requests rarely need anything from other units, and which every request carries or lets you derive. Customer, tenant and account IDs are the usual choices; a resource ID works when resources are independent of each other.

Customers are not all the same size, and that shapes where they go:

- **Large customers.** If one customer outgrows a cell, the customer ID alone cannot be the key. Either add a second dimension to the key so that a large customer can span several cells, or give that customer a **dedicated cell**, which some customers are willing to pay for as single tenancy.
- **Noisy neighbours.** A customer whose usage keeps growing crowds out the others in its cell. Measure each customer's share of its cell's capacity, and move customers that start to dominate.
- **Headroom.** Place new customers so that no cell runs close to its tested limit, and keep room for customers moved in during an incident.

How the router turns a key into a cell is the **mapping**. A full table of key → cell is the most flexible and makes it easy to place or move a single customer, but it is a large and critical piece of state. Ranges or prefixes of keys shrink the table, at the risk of a hot range. Hashing the key modulo the number of cells needs no table, but adding a cell then moves almost every customer, so designs usually hash keys into a fixed, large number of buckets and keep a small table of bucket → cell. Whichever you choose, keep an **override table** that pins particular keys to particular cells: for testing, for quarantining a suspicious customer, or for placing a very large one.

### The router

Common ways to build it:

- **DNS:** each customer gets a hostname of its own, and the record points at the customer's cell. Moving a customer is a record change that clients pick up as their cached answers expire.
- **A thin proxy** (or an API gateway) reads the key from each request, looks it up in a table held in memory and forwards the request. The control plane writes the table to a store such as object storage, and the proxies reload it when it changes.
- **Client-side routing:** the client asks once which cell it belongs to, caches the answer and calls that cell directly. Only the lookup is shared, and it is off the path of every later request.
- **A message router** for asynchronous APIs consumes a shared queue or topic and forwards each message to its cell's own queue.

Whatever its form, the router is the one component that sees every request and knows every cell, so it decides the availability of the whole system:

- **No business logic.** It reads a key, looks it up and forwards. Anything more is code that can fail in every cell at once. When a call really has to cross cells, send it back through the router rather than from one cell to another.
- **Keep routing on a stale table.** The router should keep serving from its cached copy when the control plane or the table's store is down. Control planes fail more often than data planes, and existing customers must not depend on one.
- **Replicate it, and change it carefully.** Run many copies, deploy them in waves like the cells, and give the router a tested maximum capacity, as you would a cell.

### Rolling out in waves

Cells give every change a natural unit of exposure. Instead of updating everything at once, a deployment goes out in **waves**: one cell first (which can be a canary cell that serves synthetic or other non-critical traffic), then a bake period while its alarms are watched, then progressively larger waves. If the first wave goes wrong, the rollout stops and rolls back, and one cell's customers saw the problem. Inside each cell, the update itself can still be a [rolling update](../rolling-update/) or a [canary release](../canary-release/). Configuration changes, [feature flag](../feature-flags/) flips and changes to the router deserve the same treatment: a change applied to every cell at once undoes the isolation.

### Cell size and growth

Every cell has a **maximum size** that is fixed in advance and verified: load-test a cell until it breaks, and set the limit with a safety margin below that point. Growth then means **adding cells**, never enlarging them, and the largest thing you ever have to test is one full cell. Three forces pull on the size: big enough to hold your largest customer, small enough to test at full scale and to stay well inside account quotas, and big enough that the fixed overhead of a cell is not wasted. As a cell approaches its limit, protect it with load shedding or [rate limiting](../rate-limiting/) rather than letting it fall over.

New cells come from the same infrastructure-as-code templates as the old ones, so a cell is a unit of capacity as well as a unit of failure.

### Moving customers between cells

Customers move for good reasons: one has outgrown a shared cell, cells are being rebalanced, a cell is being retired. Because a customer's data lives in its cell, every move is a data migration, usually in four steps: copy the data to the new cell as a non-authoritative copy, make the new copy authoritative, point the router at the new cell, and delete the old copy. The delicate moment is the switch, while some requests are still in flight to the old cell. Build and rehearse this tool early: the day a customer suddenly outgrows its cell is a bad day to write it.

### Features that need every cell

Some features look across customers by nature: global search, analytics and reporting, billing, an operator console, the support tool that finds which cell a customer is in. Two ways to serve them:

- Each cell **publishes** what the feature needs (events, a change stream, periodic exports) into a global store such as a data warehouse or a search index, which answers the queries.
- A **scatter-gather** query asks every cell, through the router, and merges the answers.

Either way, keep these features off the critical path: a cell must keep serving its customers while the warehouse, the index or the console is down. Anything a cell waits for synchronously belongs to every cell's blast radius.

### Observability per cell

Tag every metric, log line and trace with its cell, and build dashboards and alarms per cell. An aggregate view hides a dead cell: with a hundred cells, one cell that fails completely accounts for about 1% of the requests, which fits inside a 99% availability objective computed over all of them. Set objectives per cell (see [SLOs & Error Budgets](../slo-error-budgets/)) and compare cells with each other: a cell that behaves differently from its identical siblings is the most useful signal you have, especially during a wave.

## When to use it

- **Large multi-tenant services** where an outage for every customer at once is unacceptable and a contained outage is the better way to fail. AWS frames the choice as whether you would rather have every customer see a small share of failed requests, or a small share of customers see all their requests fail.
- **Workloads with a natural partition key** whose requests rarely need more than one customer's data: most SaaS products, B2B platforms and per-account APIs.
- **Systems that must keep growing** past the size of anything you can test, or that are already pressing against the largest database, machine or account quota available.
- **Customers that want or need isolation:** dedicated cells for large or regulated customers, or cells in particular regions for data residency (the same mechanics as Deployment Stamps, below).

When not to use it:

- **Small systems.** One deployment across several zones, with careful rollouts and good timeouts, is cheaper and simpler. The fixed cost of a router, a control plane and per-cell operations only pays off at scale.
- **No natural partition key.** If most requests need data from many customers (a social graph, a marketplace matching any buyer with any seller, a global leaderboard), every request crosses cells and the isolation disappears.
- **Data that must be shared globally.** If every cell must see the same consistent data (one inventory, one ledger), cells cannot own their data. Replicate the data to every instance instead, as Azure's Geode pattern does, or keep it in one well-protected service.
- **Shared dependencies that cannot be split.** If every cell still relies on one database, one identity service or one third-party API, a failure there still reaches everyone, and you pay for cells without getting their isolation.

## Trade-offs

- **Cost.** Every cell carries fixed overhead: a load balancer, a database at its minimum size, caches, monitoring. Each cell also keeps its own spare capacity, so overall utilisation is lower than in one shared pool. Azure's guidance for the same structure calls the increase in cost substantial.
- **Operations multiply.** Ten cells are ten deployments to roll out, watch, patch, keep identical and keep within quotas. Without full automation (infrastructure as code, a pipeline that deploys in waves, per-cell dashboards), cells drift apart and the waves stop being safe.
- **Smaller, but complete, outages.** A failed cell is fully down for its customers. The system as a whole fails less broadly and recovers faster, because a small cell is quicker to diagnose and fix, but the customers of a failed cell are not served from elsewhere unless you build cross-cell failover, which brings shared data back.
- **The router and the control plane are shared.** The router is the one component that can still take everything down, and the cells must keep working while the control plane is unavailable. Keep both small, tested and changed in waves.
- **Moving customers is a migration.** Rebalancing is never just a configuration change: it moves data, and the tooling has to be built, tested and rehearsed.
- **Cross-customer features get harder.** Anything that used to be one query against one database becomes an aggregation across cells or a separate global store, with its own lag.
- **Correlated failures remain.** A change pushed to every cell at once, a shared dependency, a bug that every cell hits on the same date: cells only contain what stays inside them.

## Implementation notes

**Start from what you have.** Treat the existing stack as cell zero, put the router in front of it, and add a second cell early, even if at first it only serves internal or test customers. AWS and Azure both recommend more than one cell (stamp) from the start, because code and configuration quietly start to assume that there is only one copy. Then do a failure mode analysis of a cell: list each component and how it can fail, and check that every failure stays inside the cell.

**How it relates to nearby patterns:**

- [Bulkhead](../bulkhead/) partitions resources inside one service, such as a pool of threads per dependency. Cells apply the same idea to the whole stack, data included, which is why the Well-Architected Framework files cells under bulkhead architectures.
- [Load Balancing](../load-balancing/) sends any request to any healthy instance. Each cell still has a load balancer for its own instances, but the router in front is sticky: a customer always reaches the same cell, because that is where their data is.
- [Multi-Region Active-Active](../multi-region-active-active/) lets every region serve every user and replicates data between the regions, so that traffic can move when one fails. Cells serve fixed subsets of customers and share no data, so a failure stays where it is instead of moving. The two combine well: run cells inside each region.
- **[Deployment Stamps](../deployment-stamps/)** (Azure's name) uses the same mechanics: many independent copies of the full stack, each serving a subset of tenants, and Microsoft lists *cell* among the other names for a stamp. The emphasis differs. Stamps are usually introduced for scale limits, tenant placement (a region, data residency, a dedicated stamp) and different update cadences (deployment rings); cells are introduced to limit the blast radius. One design usually ends up serving both goals.
- **[Sharding](../sharding/)** splits only the data, so a bug in the shared application tier still reaches every shard. Cells split the whole stack, and the data goes with it.
- [Disaster Recovery Strategies](../disaster-recovery-strategies/) are still needed. A cell can lose its database or its zone like any other deployment, and its customers depend on that cell's backups and recovery plan.

**Shuffle sharding** takes the idea further. The Amazon Builders' Library explains it with eight workers: split into four fixed pairs, a customer whose requests crash its pair takes a quarter of all customers down with it. Give every customer its own pair, picked from the 28 possible pairs, and only the customers that drew exactly the same pair, about one in 28, lose both workers; the rest still have one healthy worker. Amazon Route 53 gives each hosted zone four of its 2,048 virtual name servers, which allows about 730 billion combinations. AWS's whitepaper notes that shuffle sharding can be used inside a cell, but not across cells, since cells must not share anything.

**Published examples**, as the companies describe them:

- **Amazon Web Services** says its service teams have used cells for more than a decade (in the whitepaper, published in 2023).
- **Slack** (2023) moved its most critical user-facing services to cells over about a year and a half, after a network fault in a single availability zone in June 2021 produced errors that users saw. Slack's cells are its availability zones, not groups of customers: services in the request path only talk to services in their own zone (Slack calls this *siloing*), so the edge load balancers can drain a sick zone by shifting weight away from it, in steps as small as 1%, with the goal of removing most of its traffic within five minutes. Services that cannot be siloed were left for a later post.
- **Shopify** (2018) split its platform into **pods**: each pod is a set of shops on its own isolated datastores, and a routing layer in the load balancers (*Sorting Hat*) matches every request to its pod. Application servers and job workers were shared, but each unit of work only ever talks to one pod, and a tool called Pod Mover can shift a pod to its recovery data centre in about a minute.
- **Roblox** (2023) builds cells of roughly 1,400 machines inside its data centres and replicates services within and across them, so that a cell that stops working can be taken out of service, and even rebuilt from scratch, while the others carry the load. At the time, close to 30,000 machines were managed in cells.

Slack's and Roblox's cells are interchangeable: any cell can serve any user, and a failure is contained by draining the cell that has it. The diagram shows the partitioned kind (as in AWS's whitepaper and Shopify's pods), where each customer and their data live in exactly one cell. Interchangeable cells recover by moving traffic and need data that every cell can reach; partitioned cells also contain problems in the data, but the customers of a failed cell have to wait for that cell.

**The other meaning of the term.** WSO2's *Cell-Based Architecture*, first published in 2018, is a reference architecture for organising microservices: a cell is a group of related components that is deployed, managed and observed as one unit, owned by one team and reached only through its gateway. It is about modularity and team boundaries rather than fault isolation, and its cells differ from each other, whereas the cells on this page are identical copies.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Deployment Stamps](../deployment-stamps/) — Deploy many independent copies of the whole stack, each serving a subset of tenants.
- [Bulkhead](../bulkhead/) — Give each dependency its own pool of resources so one failure can't sink the whole ship.
- [Multi-Region Active-Active](../multi-region-active-active/) — Serve users from several regions at once and shift traffic away from a region that fails.
- [Load Balancing](../load-balancing/) — Spread requests across healthy instances and stop sending to unhealthy ones.
- [Canary Release](../canary-release/) — Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back.
- [Rolling Update](../rolling-update/) — Replace instances batch by batch while the service stays up.
- [Sharding](../sharding/) — Split data horizontally across databases using a shard key.
- [Disaster Recovery Strategies](../disaster-recovery-strategies/) — Backup & restore, pilot light, warm standby, active-active: trading cost against RTO and RPO.

## References

- [AWS Well-Architected — Reducing the Scope of Impact with Cell-Based Architecture (whitepaper)](https://docs.aws.amazon.com/wellarchitected/latest/reducing-scope-of-impact-with-cell-based-architecture/reducing-scope-of-impact-with-cell-based-architecture.html)
- [AWS Well-Architected Reliability Pillar — REL10-BP03 Use bulkhead architectures to limit scope of impact](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_fault_isolation_use_bulkhead.html)
- [AWS Builder Center — Workload isolation using shuffle-sharding (first published in the Amazon Builders' Library)](https://builder.aws.com/content/3F06NpJ8YeoIGP8VHTw4n81pFn8/workload-isolation-using-shuffle-sharding)
- [Azure Architecture Center — Deployment Stamps pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/deployment-stamp)
- [Slack Engineering — Slack's Migration to a Cellular Architecture (2023)](https://slack.engineering/slacks-migration-to-a-cellular-architecture/)
- [Shopify Engineering — A Pods Architecture To Allow Shopify To Scale (2018)](https://shopify.engineering/a-pods-architecture-to-allow-shopify-to-scale)
- [Roblox — How We're Making Roblox's Infrastructure More Efficient and Resilient (2023)](https://about.roblox.com/newsroom/2023/12/making-robloxs-infrastructure-efficient-resilient)
- [WSO2 — Cell-Based Architecture: a reference architecture (the other meaning of the term)](https://github.com/wso2/reference-architecture/blob/master/reference-architecture-cell-based.md)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
