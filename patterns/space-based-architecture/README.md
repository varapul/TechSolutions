<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🏛️ Application Architecture](../../README.md#application-architecture)

# Space-Based

> Processing units share an in-memory data grid, taking the database off the hot path.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Space-Based" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/space-based-architecture.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Database bottleneck** | Ticket sales open at 10:00 and 200,000 users arrive for 50,000 seats. The app servers keep no data, so every seat check and every reservation is a database query, and the two servers the autoscaler adds only send more of them. The database reaches 100% CPU with lock waits, and the p95 response time climbs to seconds. |
| **2 · In-memory units** | Each **processing unit** is the application plus an in-memory copy of the data it needs, here the seat map, which a **data reader** loads from the database when the units start. The **messaging grid** routes each request to a unit, which answers from memory with no database call. When unit 1 sells A-12, the **data grid** replicates the change to unit 2 within milliseconds. |
| **3 · Asynchronous writes** | Every change also goes onto a **data pump**, an asynchronous queue, and a **data writer** applies it to the database in the background. Nothing on the request path waits for the database: it becomes the durable record instead of the working store, and it is read only when units start with empty memory. |
| **4 · Elastic, with trade-offs** | As users arrive, the **deployment manager** starts units (from 2 up to 8), each copying the seats from a peer before it serves, and stops them after the rush. The costs: units 1 and 2 both sold B-7 before either update replicated (a **data collision**; give each section one owning unit, or detect and resolve conflicts), the replicated data must fit in every unit's memory, the database lags behind, and a crash before a change reaches a durable queue loses it. It suits spiky, high-concurrency workloads such as ticketing, auctions and flash sales, not large data sets that need complex queries. |
<!-- END GENERATED: header -->

## The problem

Tickets for a big concert go on sale at 10:00. Within a minute, 200,000 people are checking and grabbing the same 50,000 seats, and every one of those requests reads or writes a few rows of one table. Web and application servers can be added in minutes, but they all funnel into the same database: each seat check is a query, each reservation takes row locks, and the lock waits pile up. The database is the slowest and most expensive tier to scale, so adding servers in front of it only moves the bottleneck down to it, which is how Mark Richards introduces this style. A cache in front of the database helps with reads, but every reservation still has to reach the database while the customer waits.

## How it works

Space-based architecture takes the database off the request path. Each processing unit keeps the data it needs in memory, the units keep each other's copies up to date, and the database is updated afterwards, asynchronously. Mark Richards names the parts in *Software Architecture Patterns* and, with Neal Ford, in *Fundamentals of Software Architecture*:

- **Processing units** run the application code (all of it, or one part of it) together with an in-memory copy of its data and a replication engine that sends the unit's changes to the other units.
- **Virtualized middleware** coordinates the units:
  - The **messaging grid** accepts requests and forwards each one to an available unit, using anything from simple round-robin to tracking which unit is free. In practice a load balancer or reverse proxy often plays this role.
  - The **data grid** keeps the in-memory copies in step by replicating every change between the units.
  - The **processing grid** (optional, not drawn) orchestrates a request that needs more than one kind of unit, for example an order unit and a payment unit.
  - The **deployment manager** watches response times and user load, and starts or stops units.
- **Data pumps** carry each change asynchronously from the unit that made it towards the database. They are normally message queues, and the unit that applied an update is the one that sends it.
- **Data writers** take the changes off the pumps and apply them to the database.
- **Data readers** go the other way: they load data from the database into the units through a reverse pump. They are needed only when no unit holds the data, that is when every unit of a cache starts cold or is redeployed, or when a request needs archived data that is not kept in memory. A unit that joins a running grid copies its data from its peers instead, as the new units do in step 4.

In the animation the units start, a data reader loads the seat map, and the messaging grid sends each request to a unit, which answers from memory. Unit 1's sale of seat A-12 is replicated to unit 2 and then travels through the data pump to the data writer and into the database. When the 10:00 rush arrives, the deployment manager grows the grid from 2 to 8 units and shrinks it again afterwards. Richards notes that it is sometimes called the *cloud architecture pattern*, although the units don't have to run in a cloud.

### Where the name comes from

The space is a tuple space. In the Linda language that David Gelernter described in [Generative Communication in Linda](https://www.cs.unc.edu/~stotts/COMP590-059-f21/slides/lindaGenerative.pdf) (ACM Transactions on Programming Languages and Systems, January 1985), processes never address each other directly: one adds a tuple to a shared space with `out()`, and another withdraws a matching tuple with `in()` or copies it with `read()`. Sun's JavaSpaces specification ([revision 1.0](https://edoras.sdsu.edu/doc/jini/doc/specs/js-spec/js.pdf), January 1999, part of Jini) brought the model to Java objects, with `write`, `read`, `take` and `notify` operations on entries matched by templates, and its [current text](https://river.apache.org/release-doc/current/specs/html/js-spec.html) says the design was strongly influenced by Linda. Jini continued as Apache River, which [retired in 2022](https://attic.apache.org/projects/river.html). GigaSpaces built a commercial platform on JavaSpaces and was already selling it as a space-based architecture in 2006 ([McObject press release, December 2006](https://www.mcobject.com/press/december11-2006/)). Its [current documentation](https://docs.gigaspaces.com/latest/overview/space-based-architecture.html) describes the style as a set of processing units, each hosting one partition of the space and the services that react to that partition's data, optionally with standby backups for each primary partition.

### Replicated or partitioned data

The animation uses a **replicated** grid, in which every unit holds every seat. That is the simplest form, but not the only one.

| | Replicated | Partitioned (distributed) |
|---|---|---|
| What each unit holds | A full copy of the data | The keys it owns, plus backup copies of other units' keys |
| Reads | Always local | Local only for keys the unit owns; other keys cost a network hop |
| Writes | Sent to every unit | Sent to the key's owner and its backups |
| Capacity | Limited by one unit's memory | Grows as units are added |
| Data collisions | Possible, as in step 4 | Avoided: one owner orders all the writes to a key |
| Examples | Hazelcast Replicated Map, Ignite `REPLICATED` caches, Infinispan replicated caches | Hazelcast `IMap`, Ignite `PARTITIONED` caches, Infinispan and Coherence distributed caches |

Some product details from the current documentation:

- Hazelcast copies a [Replicated Map](https://docs.hazelcast.com/hazelcast/latest/data-structures/replicated-map) to every member and replicates updates asynchronously, so its documentation recommends back pressure when updates are frequent, and the map offers none of the atomic `ConcurrentMap` operations. A partitioned `IMap` spreads its entries over [271 partitions](https://docs.hazelcast.com/hazelcast/latest/architecture/data-partitioning) by default, each with a primary replica and backups.
- Apache Ignite [splits a partitioned cache](https://ignite.apache.org/docs/ignite2/latest/data-modeling/data-partitioning) into 1,024 partitions by default and rebalances them when nodes join or leave. It recommends partitioned caches for large data sets with frequent updates, because every update to a replicated cache has to reach every node.
- Infinispan suggests [replicated caches](https://infinispan.org/docs/stable/titles/configuring/configuring.html) only for clusters of fewer than ten nodes, since replication traffic grows with each node. A distributed cache keeps a configured number of copies of each entry (`numOwners`) and survives the loss of one fewer node than that.

A **near cache** is a small local cache in front of a partitioned or remote cache that keeps recently or frequently used entries, so reads of hot keys skip the network ([Ignite](https://ignite.apache.org/docs/ignite2/latest/configuring-caches/near-cache), [Coherence](https://docs.oracle.com/en/middleware/standalone/coherence/15.1.1/develop-applications/introduction-coherence-caches.html), [Hazelcast](https://docs.hazelcast.com/hazelcast/latest/cluster-performance/near-cache)). Hazelcast describes its near cache as eventually consistent: it can return stale data, and a high invalidation rate can cancel out the benefit. That makes near caches a good fit for read-mostly reference data, such as venue layouts and prices, and a poor one for seat availability, which changes with every sale.

Partitioning the data between units is the same idea as [sharding](../sharding/) a database: choose a key (the event and section here) so that most requests touch one partition. GigaSpaces calls this data affinity. When the data is split so that the work a request triggers stays inside one partition, every read and write is local to the unit that owns it.

### Data collisions

With replicated data any unit can update any seat. In step 4, units 1 and 2 both sell seat B-7 within the same replication window: each confirms the sale to its own customer and then receives the other unit's update for the same seat. Richards calls this a [data collision](https://www.developertoarchitect.com/lessons/lesson174.html). In *Fundamentals of Software Architecture* he and Neal Ford estimate how often collisions happen: the rate rises in proportion to the number of units sharing the cache and to the replication latency, rises with the square of the update rate, and falls as the cache holds more rows, because two simultaneous updates are then less likely to hit the same one. Hot spots, such as the front rows the moment sales open, are the worst case.

Ways to deal with them:

- **Give each item one owner.** Partition by section and have the messaging grid send every request for a section to the unit that owns it, or use a partitioned grid, which does this for you. A single owner puts the writes for each key in order, and an atomic check-and-set on the owner (`putIfAbsent`, or `replace` with the expected old value) makes "sell only if the seat is free" safe.
- **Detect and resolve.** Version every entry and reject or merge a write that was based on an older version. When two sales have already been confirmed, resolve it in the business process, for example by offering another seat or a refund; see [compensating transaction](../compensating-transaction/).
- **Shrink the window.** Fewer units sharing a replicated cache and lower replication latency reduce the rate, but never to zero.

### Durability and consistency

Taking the database off the request path means a unit acknowledges a change before the database has it. The grid products call this write-behind:

- Hazelcast turns a `MapStore` into write-behind when `write-delay-seconds` is greater than zero; zero, the default, means write-through. With write-coalescing it stores only the latest change to each key within that delay ([MapStore configuration](https://docs.hazelcast.com/hazelcast/latest/mapstore/configuration-guide)).
- Apache Ignite collects write-behind updates and flushes them in bulk when a time limit or a queue size is reached. Its documentation warns that some updates can be lost if nodes fail, and that only the last update to an entry reaches the store ([external storage](https://ignite.apache.org/docs/ignite2/latest/persistence/external-storage)).
- Oracle Coherence writes changed entries after a configured delay, so the database is never further behind than that delay, and it can re-queue a write that failed. It supports these modes on partitioned (distributed) caches, not on replicated ones ([caching data sources](https://docs.oracle.com/en/middleware/standalone/coherence/15.1.1/develop-applications/caching-data-sources.html)).
- Infinispan's write-behind cache stores put changes on a modification queue and write them asynchronously; queued writes can be lost if Infinispan restarts ([configuring caches](https://infinispan.org/docs/stable/titles/configuring/configuring.html)).
- GigaSpaces uses a separate [Mirror Service](https://docs.gigaspaces.com/latest/dev-java/asynchronous-persistency-with-the-mirror.html) that receives the operations replicated from the primary partitions and writes them to the database. Until it has, the primaries and their backups keep them in a redo log that can overflow to disk.

To keep the gap safe:

- **Make the pump durable.** Use a persistent, replicated queue, and count a change as accepted only once it is in that queue, or in the grid's backed-up write-behind queue. A unit that crashes after updating memory but before handing the change over loses it as far as the database is concerned, even if other units still hold it. The [transactional outbox](../transactional-outbox/) solves the same problem for services that own a database: record the change and the message together, then relay the message.
- **Make the writers idempotent.** Pumps usually deliver at least once, and retries can reorder messages. Give each change an ID and a per-key version, and let the writer skip duplicates and older versions ([idempotent consumer](../idempotent-consumer/)).
- **Decide what the lag means.** Anything that reads the database directly (reports, other systems, a data reader after a cold start) sees the last state the writers stored, not the grid's current state. The depth of the pump is the database's lag, so watch it. Write-coalescing also drops intermediate states, which matters if the database feeds an audit trail.

### Scaling and routing

The deployment manager is usually the platform's [autoscaling](../autoscaling/) working together with the grid's own membership: the autoscaler adds a unit, the unit joins the grid, and the grid replicates or rebalances data onto it before it can serve. That copy takes time. With Hazelcast's default settings, a Replicated Map on a new member answers reads before its initial copy is complete and can return null for entries it hasn't received yet; turning `async-fillup` off blocks reads until the copy is done. Gate traffic on a readiness check that waits for the copy, and for a sale at a known time, scale out before 10:00 rather than once the queue has formed.

The messaging grid is a [load balancer](../load-balancing/) with one extra job: with partitioned data or per-section ownership, it should route by key so that each request lands on the unit that owns its data.

### Compared with similar patterns

| Pattern | Where reads are served | Where writes go first | Role of the database |
|---|---|---|---|
| **Space-based** | Each unit's memory | Each unit's memory, then replicated and queued | Written asynchronously; read only to load units |
| [Cache-aside](../cache-aside/) | A cache filled on demand, or the database | The database, then the cached entry is deleted | System of record, on the request path |
| [Read replicas](../read-replicas/) | Copies of the database | The primary database | On every write path |
| [CQRS](../cqrs/) | Read models shaped for queries | The write model, usually a database | On the command path |
| [Event-driven architecture](../event-driven-architecture/) | Each service's own store | Each service's own store, then events | One per service |

Space-based architecture borrows from event-driven designs (the data pumps are queues) and combines well with CQRS (data writers can update read models as well as the main database). What sets it apart is that the in-memory grid is the working store for reads and writes alike, and that units can be added and removed as the load changes.

## When to use it

- Spiky, high-concurrency workloads on a hot, bounded data set: ticket sales, online auctions and bidding, flash sales and limited product drops.
- The database can't absorb the write contention synchronously, and the business can accept a database that lags behind.
- Load swings widely enough that elastic units pay for their warm-up time.

Avoid it when:

- the data does not fit in memory, or keeping it there (on every unit, for a replicated grid) costs more than it saves;
- the work depends on complex relational queries, joins or reporting over large data sets. Richards notes that the style suits large relational applications with a lot of operational data poorly;
- traffic is steady and moderate, where a database, a cache and a few application servers are far simpler;
- every change must be durable, or strictly consistent everywhere, before it is acknowledged (ledgers, account balances, stock that must never be oversold), unless ownership and durable pumps are designed in from the start.

## Trade-offs

- **Speed and elasticity come from memory and asynchrony.** Reads and writes stay in memory, and units come and go with the load.
- **Consistency becomes your problem.** Replicated data allows collisions, partitioned data puts network hops back on some reads, and the database lags behind the grid.
- **Durability needs deliberate work.** An acknowledged change lives in memory and in the pump until a writer stores it.
- **Memory is the capacity limit and much of the cost.** A replicated data set is paid for on every unit, and in JVM-based grids large heaps bring garbage-collection tuning with them.
- **Cold starts are slow and heavy.** After a full restart the data readers must reload everything, a burst of reads the database has to survive.
- **It is complex and hard to test.** Richards rates the style low on testability and ease of development: reproducing peak loads in a test environment is expensive, and the grid products have a learning curve. Rehearse failures (kill units, the pump, the writer) as well as load; see [chaos engineering](../chaos-engineering/).
- **Cost and lock-in.** Commercial editions, support, memory-heavy machines and the grid's own APIs add up.

## Implementation notes

- **Products** (October 2026): [Hazelcast Platform](https://hazelcast.com/) 5.7, in Community and Enterprise editions; [Apache Ignite](https://ignite.apache.org/download.cgi), with 3.1 the latest Ignite 3 release and 2.17 the latest of the 2.x line, whose documentation is linked above; [Infinispan](https://infinispan.org/) 16.2; [Oracle Coherence](https://github.com/oracle/coherence), whose Community Edition is open source; and [GigaSpaces](https://www.gigaspaces.com/) XAP.
- **Keep the in-memory set small:** hold only what the hot path needs (seat status for events on sale), and leave history and past events in the database, where a data reader can fetch them if ever needed.
- **Decide ownership first:** for each kind of data, choose replicated (small and read-mostly), partitioned by a key, or owned per section, and route requests to match.
- **Version every entry** and carry the version through the pump, so writers and conflict detection can put changes in order.
- **Measure** replication latency, collisions or conflicts, pump depth and the age of its oldest message (the database's lag), memory headroom per unit, a new unit's warm-up time and the full cold-start reload time.
- **Rehearse a full restart:** time how long the data readers take to reload everything, and check that the database survives the burst.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Cache-Aside](../cache-aside/) — Read from the cache first; on a miss load from the database and populate the cache.
- [Autoscaling](../autoscaling/) — Add and remove instances automatically as load rises and falls.
- [Sharding](../sharding/) — Split data horizontally across databases using a shard key.
- [CQRS](../cqrs/) — Separate the write model (commands) from read models (queries), each optimised for its job.
- [Read Replicas](../read-replicas/) — Send writes to the primary and spread reads across asynchronously updated replicas.
- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.
- [Load Balancing](../load-balancing/) — Spread requests across healthy instances and stop sending to unhealthy ones.
- [Microservices](../microservices/) — Small, independently deployable services, each owning one business capability and its data.

## References

- [Mark Richards — Lesson 166: Space-Based Architecture (Software Architecture Monday)](https://developertoarchitect.com/lessons/lesson166.html)
- [Mark Richards — Lesson 174: Replicated Caching and Data Collisions](https://www.developertoarchitect.com/lessons/lesson174.html)
- [GigaSpaces docs — Space-Based Architecture](https://docs.gigaspaces.com/latest/overview/space-based-architecture.html)
- [GigaSpaces docs — Asynchronous Persistency: Mirror Service](https://docs.gigaspaces.com/latest/dev-java/asynchronous-persistency-with-the-mirror.html)
- [Hazelcast docs — Replicated Map](https://docs.hazelcast.com/hazelcast/latest/data-structures/replicated-map)
- [Hazelcast docs — Configuring a MapStore (write-behind)](https://docs.hazelcast.com/hazelcast/latest/mapstore/configuration-guide)
- [Apache Ignite docs — Data Partitioning](https://ignite.apache.org/docs/ignite2/latest/data-modeling/data-partitioning)
- [Apache Ignite docs — External Storage (write-behind caching)](https://ignite.apache.org/docs/ignite2/latest/persistence/external-storage)
- [David Gelernter — Generative Communication in Linda (ACM TOPLAS, 1985)](https://www.cs.unc.edu/~stotts/COMP590-059-f21/slides/lindaGenerative.pdf)
- [JavaSpaces Service Specification (Apache River)](https://river.apache.org/release-doc/current/specs/html/js-spec.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
