<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗄️ Data Management](../../README.md#data-management)

# Cache-Aside

> Read from the cache first; on a miss load from the database and populate the cache.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Cache-Aside" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/cache-aside.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Miss: load and cache** | The App asks the cache for `user:42` and gets nothing back: a **cache miss**. It reads the row from the database (the slow path, ~20 ms here), stores a copy in the cache with a **TTL**, and returns it. The application does the loading itself; the cache never talks to the database. |
| **2 · Hits from the cache** | The next reads of `user:42` are **cache hits**, answered from memory in about a millisecond without touching the database. As long as the entry lives, the database does no work for this key: that is where the latency and load savings come from. |
| **3 · Write, then invalidate** | An update goes to the **database first**, because it is the system of record, and the cached copy is stale until the App **deletes** it. The App deletes the entry instead of writing the new value into it: deletes are idempotent, so two concurrent writers can't leave the older of their two values in the cache. |
| **4 · Miss again, refill** | The next read misses, loads the **fresh value** from the database and repopulates the cache. A **TTL expiry** produces exactly the same miss and refill, which is why every entry gets a TTL: it bounds how long a lost or failed invalidation can keep serving stale data. |
<!-- END GENERATED: header -->

## The problem

Most systems read far more than they write, and they read the same records again and again: the signed-in user's profile, a product page, a price list. Sending every one of those reads to the database costs a network round trip and a query each time, and it makes the database the bottleneck, and the most expensive part to scale, for answers that rarely change. An in-memory cache can answer in well under a millisecond, but something has to decide what goes into it and throw entries away when the data they copy changes.

## How it works

The cache sits *beside* the data path, not in it. The application talks to both stores; the cache never talks to the database.

- **Read:** look the key up in the cache. On a **hit**, use the cached value. On a **miss**, read from the database, store the result in the cache with a **TTL**, and return it. Only data that someone actually asks for gets cached, which is why AWS calls this *lazy loading*.
- **Write:** update the database, which stays the system of record, **then delete the cache key**. The next read misses and loads the new value.
- **Expire:** every entry carries a TTL, so whatever invalidation misses (a failed delete, a change made by another system) ages out on its own.

The ~1 ms and ~20 ms in the diagram are illustrative; the shape is what matters. A hit is one in-memory lookup. A miss costs three round trips (cache, database, cache), so it is slower than having no cache at all.

### Compared with read-through, write-through and write-behind

| Strategy | Cache filled by | What a write does | Main risk |
|---|---|---|---|
| **Cache-aside** | The application, after a miss | The application updates the database, then deletes the key | A stale window after writes; the miss penalty |
| **Read-through** | The cache itself, through a loader you register, after a miss | Depends on the write strategy it is paired with | Same staleness as cache-aside; needs a cache with loader support |
| **Write-through** | Each write (misses still need one of the read strategies) | Updates the database and the cache together, synchronously | Slower writes; caches data that may never be read |
| **Write-behind** (write-back) | Each write | Updates the cache now and the database later, often in batches | Acknowledged writes are lost if the cache fails before it flushes |

Read-through and write-through move the same logic into the cache layer, for example JCache `CacheLoader`/`CacheWriter`, Hazelcast `MapLoader`/`MapStore`, or Amazon DynamoDB Accelerator in front of DynamoDB. Cache-aside needs nothing from the cache beyond get, set, delete and expiry, so it works with any key-value store.

## When to use it

- Read-heavy data that is read many times between changes and can tolerate a bounded amount of staleness: profiles, catalogs, configuration, reference data, rendered fragments.
- The cache has no read-through or write-through integration with your database, or the application should control keys, serialization and TTLs per data type.
- The access pattern is hard to predict. Lazy loading keeps whatever turns out to be hot without deciding in advance.

If the whole data set is small and rarely changes, skip lazy loading: load it all at startup and let it live without expiring.

**What not to cache** (or only with great care):

- Data that must be strongly consistent or read-your-writes: balances and stock levels that drive decisions, permissions and revocations that must take effect at once.
- Data that is rarely read twice: long-tail keys, one-off reports, highly personalized queries. It wastes memory and drags the hit ratio down.
- Data that changes more often than it is read. Each write deletes the entry before anyone benefits from it.
- Secrets and sensitive personal data in a cache shared by many services, unless it is encrypted, access-controlled and expires in line with your retention rules.
- Large objects that belong in object storage or a CDN.

## Trade-offs

- **Stale reads are possible by design.** The cache holds a copy, so reads can lag behind writes.
  - *Why delete, and why after the write.* If two writers each update the database and then `SET` their new value, the two `SET`s can arrive in the opposite order to the commits and leave the older value cached until the TTL runs out. Deletes are idempotent, so their order doesn't matter; that is why Facebook's memcache deletes instead of updating. Delete *after* the commit: deleting first lets a concurrent reader load the old row back into the cache before the write lands.
  - *The race that remains.* A reader misses and reads the old row; a writer commits and deletes the key; then the reader's late `SET` puts the old value back. The window is small but real. Mitigations: keep TTLs short enough to bound the damage; use **versioned keys** (`user:42:v8`, derived from the row's version) so a late `SET` of old data lands under a key that readers no longer ask for; use **leases**, where the cache rejects a `SET` if the key was deleted after the miss that issued the lease (memcache's approach); or delete a second time shortly after the write, a cheap heuristic.
  - Writes that bypass the application (batch jobs, other services, manual fixes) never delete anything. Drive invalidation from the database's change stream with change data capture, or accept staleness up to the TTL.
- **Cache stampede, also called thundering herd or dog-piling.** When a hot key expires or is deleted, every concurrent request misses at once and runs the same query. Mitigations:
  - **Request coalescing:** one request per key loads from the database while the others wait for its result. Use single-flight within a process and a short lock such as `SET lock:user:42 <token> NX PX 3000` across processes. Facebook's memcache uses its leases for this too: a server hands out at most one lease per key every 10 seconds, and other clients wait briefly and retry.
  - **Early refresh:** recompute hot keys before they expire, on a schedule (refresh-ahead) or with a probability that rises as expiry approaches (XFetch).
  - **Serve stale while revalidating:** a soft TTL triggers a refresh, and a longer hard TTL keeps the old value available until the refresh lands.
  - **Jittered TTLs:** add randomness (say ±10%) so keys written together, for example during a warm-up, don't expire together.
- **Cold starts.** An empty cache (a new node, a flush, a failover) sends every read to the database at once. See *Warming* below.
- **Another dependency to run.** Put timeouts on cache calls and decide what happens when the cache is down. Falling back to the database only works if the database can carry the full read load for a while.

## Implementation notes

- **Choosing a TTL.** Start from how stale each kind of data may be for the business, not from the hit ratio: seconds for fast-changing data, hours for reference data. Always set one, even with explicit invalidation, as the safety net for whatever invalidation misses. Longer TTLs raise the hit ratio, but also memory use and the cost of a missed invalidation. Tune per key type while watching the hit ratio and evictions.
- **Keys and values.** Namespace keys (`user:42`), put a schema version in the key when the cached format changes (`user:v2:42`) so old and new code can run side by side during a deploy, and keep values small.
- **Warming.** Before sending traffic to a new or flushed cache, preload the known hot keys (from access logs or a replay of recent traffic) and shift traffic over gradually. Cache-aside fills in whatever the warm-up missed.
- **Negative caching.** Cache "not found" with a short TTL so repeated lookups for missing keys don't all reach the database.
- **Local caches.** An in-process cache on each instance is the fastest tier, but a delete on one instance doesn't reach the others. Keep local TTLs short or broadcast invalidations, for example over pub/sub.
- **Eviction.** Size memory for the hot set and choose an eviction policy. A dedicated Redis or Valkey cache usually runs `allkeys-lru` or `allkeys-lfu`. On 64-bit systems, self-hosted Redis and Valkey have no memory limit by default (`maxmemory 0`), so nothing is evicted until you set `maxmemory`; their default policy, `noeviction`, returns errors on writes once that limit is reached. Amazon ElastiCache, Azure Managed Redis and Google Cloud Memorystore default to `volatile-lru`, which evicts only keys that have a TTL.
- **Measure it.** Track hit ratio, miss latency, evictions and database load. A falling hit ratio is often the first sign of a bad TTL, a key-naming bug or an undersized cache.
- **Products and libraries.** Managed Redis-, Valkey- or Memcached-compatible services (Amazon ElastiCache, Azure Managed Redis, Google Cloud Memorystore) or self-hosted Redis, Valkey or Memcached. Libraries implement parts of the pattern: Spring's `@Cacheable` (with `sync = true` to coalesce loads within one JVM), .NET `HybridCache` (coalescing per instance), and Go's `singleflight`.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Read Replicas](../read-replicas/) — Send writes to the primary and spread reads across asynchronously updated replicas.
- [Change Data Capture (CDC)](../change-data-capture/) — Stream every committed change from the database log to other systems.
- [Materialized View](../materialized-view/) — Precompute query-shaped views so reads don't pay for joins and aggregations.
- [CDN & Edge Caching](../cdn-edge-caching/) — Serve static content from edge locations close to users; only cache misses reach the origin.
- [CQRS](../cqrs/) — Separate the write model (commands) from read models (queries), each optimised for its job.
- Space-Based *(planned)* — Processing units share an in-memory data grid, taking the database off the hot path.

## References

- [Azure Architecture Center — Cache-Aside pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside)
- [AWS — Caching best practices](https://aws.amazon.com/caching/best-practices/)
- [Amazon Builders' Library — Caching challenges and strategies](https://aws.amazon.com/builders-library/caching-challenges-and-strategies/)
- [Nishtala et al. — Scaling Memcache at Facebook (NSDI '13)](https://www.usenix.org/conference/nsdi13/technical-sessions/presentation/nishtala)
- [Vattani, Chierichetti, Lowenstein — Optimal Probabilistic Cache Stampede Prevention (VLDB 2015)](https://www.vldb.org/pvldb/vol8/p886-vattani.pdf)
- [Redis docs — Key eviction](https://redis.io/docs/latest/develop/reference/eviction/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
