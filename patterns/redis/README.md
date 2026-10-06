<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧱 System Components](../../README.md#system-components)

# Redis & Valkey

> An in-memory data-structure server: cache, session store, rate limiter, leaderboard and lightweight queue in one process.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Redis &amp; Valkey" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/redis.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Acme Shop's API runs on three **stateless** app servers that share one Redis. It caches product JSON in front of PostgreSQL (`product:42`), holds every session (`session:9f3c`), counts each API key's requests (`ratelimit:key-7:1201`) and keeps a leaderboard (`top-sellers`). Every command is one network round trip, answered from memory. |
| **2 · One command at a time** | INCR, GET and ZINCRBY arrive from three app servers at once and wait in line: one main thread executes every command, one after another, so each is atomic without locks. `INCR ratelimit:key-7:1201` returns 101, over the limit of 100, so app-1 answers 429; `GET product:42` is a hit; `ZINCRBY top-sellers 1 mug` takes the mug to 813. A key with a TTL is deleted once it expires. |
| **3 · Durability and failover** | The primary appends every write to its **AOF** (with `appendfsync everysec` a crash can lose about a second of writes), can save **RDB** snapshots from a forked child, and sends writes to the replicas **asynchronously**. `SET product:42` reaches both replicas, but the `ZINCRBY` acknowledged as 814 is still in the primary's buffer when the primary crashes. Two Sentinels agree it is down and promote replica-1, which has the mug at 813: the acknowledged write is lost. |
| **4 · Scale out, and the limits** | **Redis Cluster** splits the keyspace into 16,384 hash slots, `CRC16(key) mod 16384`, spread over several primaries with their own replicas, so `product:42` (slot 12456) moves to shard C and `top-sellers` (slot 9501) to shard B. A command on several keys needs them all in one slot, otherwise it fails with `CROSSSLOT`; a hash tag such as `{user:42}` keeps related keys together. Memory is the hard limit: at `maxmemory` the default policy, `noeviction`, rejects new writes with an OOM error, so a cache runs `allkeys-lru` or a similar policy instead. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's API runs on three app servers, and nearly every request needs a little shared state: the product it shows, the user's session, how many calls this API key has made in the current minute, the best sellers for the home page. Keep that state in each server's memory and it breaks the moment the load balancer sends the next request to another server. Put all of it in PostgreSQL and the database spends its time on small, hot, short-lived reads and counters that rarely need SQL or full durability.

Redis keeps that kind of state in memory, in one shared server: an app sends a command over a TCP connection and gets the answer back from RAM, with no disk read on the way. Valkey is the BSD-licensed fork of Redis (see *Redis or Valkey* below); everything on this page applies to both unless a version number says otherwise. Versions and defaults here are those of Redis Open Source 8.10 (July 2026) and Valkey 9.1 (May 2026).

## How it works

**Data structures, not just values.** Every key holds one typed value, and each type comes with its own commands, each of them atomic:

| Type | What it is for | Commands |
|---|---|---|
| String | cached JSON, counters, flags, lock tokens | `SET … EX`, `GET`, `INCR` |
| Hash | an object or a session: fields and values under one key | `HSET`, `HGETALL` |
| List | a simple queue or a list of recent items | `LPUSH`, `BRPOP`, `LRANGE` |
| Set | unique members: tags, who is online, seen IDs | `SADD`, `SISMEMBER` |
| Sorted set | members ordered by a score: leaderboards, priorities, time indexes | `ZINCRBY`, `ZRANGE … REV` |
| Stream | an append-only log that consumer groups read | `XADD`, `XREADGROUP`, `XACK` |
| Bitmap, bitfield | flags and small counters packed into a string | `SETBIT`, `BITCOUNT`, `BITFIELD` |
| HyperLogLog | an approximate count of distinct items, in at most 12 KB | `PFADD`, `PFCOUNT` |
| Geospatial index | points found by radius or box | `GEOADD`, `GEOSEARCH` |

Redis 8.0 (May 2025) folded the former Redis Stack modules into Redis Open Source: JSON, time series, five probabilistic types (Bloom and cuckoo filters, count-min sketch, top-k, t-digest) and the Redis Query Engine for secondary indexes and vector search, plus a new vector set type. Redis 8.8 added an array type. These newer types are where Redis and Valkey differ most, so check what the server you run actually has.

**One thread runs the commands.** Redis multiplexes all client connections on one event loop, and a single main thread executes their commands one after another. The diagram draws this as one line of waiting commands. Nothing interleaves with a running command, so `INCR` is a safe read-modify-write without any lock, and one slow command (`KEYS *` over millions of keys, `SMEMBERS` on a huge set) makes every other client wait. Optional I/O threads (`io-threads`, off by default) read and parse requests and write replies on busy servers; Redis 8.0 and Valkey 8.0 both reworked them, and the main thread still executes every command.

**Several commands at once.**
- **Pipelining** sends a batch of commands without waiting for each reply, so the batch pays for one network round trip instead of one per command.
- **Transactions**: `MULTI` queues commands and `EXEC` runs them as one block that no other client can interleave with. There is no rollback: if one command fails, the others still run. `WATCH` adds optimistic locking, so `EXEC` does nothing if a watched key changed in the meantime.
- **Lua scripts** (`EVAL`) and, since Redis 7.0, **functions** (`FUNCTION LOAD`, `FCALL`) run your logic inside the server, atomically, for check-then-act steps such as "increment, then set an expiry if the key is new".

**Expiry and eviction are different things.** Any key can carry a TTL (`SET … EX 300`, `EXPIRE`). An expired key is removed when a client next touches it, and a background job also samples keys that have a TTL and deletes the expired ones it finds. Eviction happens only when memory reaches `maxmemory`, and `maxmemory-policy` decides what goes: `allkeys-lru` or `allkeys-lfu` for a pure cache, a `volatile-*` policy to drop only keys that have a TTL, or `noeviction`, the default, which keeps everything and fails new writes with an `OOM` error. Redis 8.6 added least-recently-modified policies (`allkeys-lrm`, `volatile-lrm`). With `maxmemory` at 0, the default on 64-bit systems, Redis sets no limit of its own and keeps allocating.

**Persistence is optional.**
- **RDB**: a forked child process writes a point-in-time snapshot to `dump.rdb`. By default that happens after an hour if at least one key changed, after five minutes with 100 changes, or after a minute with 10,000. The file is compact and quick to restart from, but everything since the last snapshot is lost in a crash.
- **AOF** (`appendonly yes`, off by default): every write is appended to a log. With `appendfsync everysec`, the default, the log is flushed to disk once a second in the background, so a crash can lose about the last second of writes; `always` flushes every write and is much slower. Since 7.0 the AOF is a set of files, a base plus incremental logs, rewritten in the background.
- **Both**: the documentation suggests running both when you want data safety close to what PostgreSQL gives you.

**Replication and failover.** A primary sends its writes to replicas **asynchronously**: it replies to the client first and doesn't wait for the replicas. `WAIT` lets a client block until a number of replicas have its earlier writes (`WAITAOF`, since 7.2, until they are in an AOF); that shrinks the window for losing a write but doesn't make Redis strongly consistent. **Sentinel** watches a primary and its replicas. Run at least three Sentinels in separate failure domains: when a *quorum* of them sees the primary down, one Sentinel, elected by a majority, promotes a replica, repoints the other replicas and gives clients the new address. **Redis Cluster** shards instead. It splits the keyspace into 16,384 hash slots, `CRC16(key) mod 16384`, spread over at least three primaries (the documentation recommends starting with six nodes: three primaries, each with a replica), and the cluster promotes replicas itself, with no Sentinel. Both rely on asynchronous replication, so both can lose writes that a primary acknowledged but had not yet passed on, as in step 3.

**Multi-key commands in a cluster** work only when every key hashes to the same slot; otherwise the reply is a `CROSSSLOT` error. A hash tag chooses the part of the name that is hashed: `{user:42}:cart` and `{user:42}:orders` both hash only `user:42`, so both land in slot 15880. All keys that share a tag live on one shard, so don't put a tag on millions of keys.

**Pub/sub or streams.** `PUBLISH` delivers a message to whoever is subscribed at that moment, at most once: a subscriber that is down or reconnecting misses it. A **stream** keeps its messages. A consumer group shares them out among workers (`XREADGROUP`), remembers what each worker has received but not yet acknowledged (`XACK`), and lets another worker claim the messages of one that died, which gives at-least-once delivery. A stream is the lightweight option inside a Redis you already run; a dedicated log such as [Kafka](../kafka/) keeps far more history and scales further.

**Distributed locks.** The single-instance lock is `SET lock:report:42 <random value> NX PX 30000`: it succeeds only if nobody holds the key, and the key expires by itself if the holder dies. Release the lock only if the value is still yours, with `DELEX lock:report:42 IFEQ <value>` (Redis 8.4+), `DELIFEQ` (Valkey 9.0+) or a short Lua script on older versions. Redlock, the algorithm in the Redis documentation for locking across several independent primaries, is disputed. In [How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html) (2016) Martin Kleppmann argues that it depends on timing assumptions (bounded network delays, process pauses and clock drift) and hands out no fencing tokens: too heavy for a best-effort lock and not safe enough when correctness depends on the lock, where he recommends a consensus system such as ZooKeeper plus fencing tokens checked by the storage. Salvatore Sanfilippo (antirez), who designed Redlock, replied in [Is Redlock safe?](https://antirez.com/news/101) that the algorithm is sound under its stated assumptions and that the pause problem affects every lock that expires on its own. Either way, a Redis lock is a good way to avoid doing the same work twice; for one-writer-at-a-time correctness, see [Leader Election](../leader-election/) and its fencing tokens.

## Where it fits

- **Solutions:** web and mobile back ends (sessions, page and API caches), public APIs (rate limits per key), shops and games (leaderboards, carts, counters), job systems (queues and deduplication), real-time features (presence, pub/sub fan-out).
- **Patterns in this catalog it implements:** [Cache-Aside](../cache-aside/) with `GET` and `SET … EX`; server-side sessions from [Sessions vs Tokens](../sessions-vs-tokens/); [Rate Limiting](../rate-limiting/) with `INCR` and a TTL per window, or a [sliding window](../sliding-window/) log kept in a sorted set; deduplication keys for an [Idempotent Consumer](../idempotent-consumer/) (`SET msg:<id> 1 NX EX 86400`); [Publish-Subscribe](../publish-subscribe/) and [Competing Consumers](../competing-consumers/) with pub/sub and stream consumer groups; leases for [Leader Election](../leader-election/), with the caveats above. Underneath, the keyspace is a [hash table](../hash-table/), and Redis Cluster is [sharding](../sharding/) by hash slot.
- **Usual neighbours:** stateless app servers or functions in front of it, the system of record behind it ([PostgreSQL](../postgresql/) here), an API gateway or load balancer that relies on its counters, and background workers reading its lists or streams.
- **Managed offerings:** **Amazon ElastiCache** runs Valkey, Redis OSS or Memcached, either serverless (capacity is managed for you) or as node-based clusters you size yourself. **Amazon MemoryDB** is the durable variant: Valkey- and Redis OSS-compatible, with every write kept in a Multi-AZ transactional log, so it can be a primary database. **Azure Managed Redis** is built on Redis Enterprise; the Basic, Standard and Premium tiers of the older Azure Cache for Redis retire on 30 September 2028. **Google Cloud Memorystore** offers Memorystore for Valkey, for Redis Cluster and for Redis. Redis Ltd. sells Redis Cloud.

## When to use it

Use it for small, hot, shared state that many servers read and update on every request and that you could rebuild or afford to lose a little of: caches, sessions, counters, leaderboards, short-lived queues and locks. Don't make it the only copy of data you can't lose, and don't use it as a general database for large or ad-hoc queries.

| | Redis or Valkey | Memcached | A database with a big buffer cache |
|---|---|---|---|
| Data model | typed values: strings, hashes, lists, sets, sorted sets, streams… | strings (blobs) by key | tables, SQL, joins, indexes |
| Atomic operations | rich: `INCR`, `ZINCRBY`, transactions, scripts | simple: get, set, increment, compare-and-set | full ACID transactions |
| Threads | one main thread executes commands; optional I/O threads | multi-threaded | many connections and workers |
| Durability | optional RDB snapshots and AOF | none: a cache only | durable by design (write-ahead log) |
| Replicas and failover | asynchronous replicas, Sentinel or Cluster | none: servers don't know each other, clients hash keys across them | built-in replication; failover by tooling or a managed service |
| Choose it when | you need shared state and data structures, not only a cache | you want the simplest cache and big multi-core nodes | the working set fits in memory and one less system matters more than speed |

**Redis or Valkey?** Redis was BSD-licensed up to 7.2. In March 2024 Redis Ltd. moved Redis 7.4 and later to a choice of two source-available licences, RSALv2 or SSPLv1, neither approved by the OSI. A week later, on 28 March 2024, the Linux Foundation announced Valkey, a fork of Redis 7.2.4 that stays under the BSD 3-clause licence, backed by AWS, Google Cloud, Oracle, Ericsson and Snap among others. With Redis 8.0 (May 2025) Redis added the OSI-approved AGPLv3 as a third option and renamed its free edition Redis Open Source. Both speak the same protocol and share the commands of Redis 7.2, and since then they have drifted apart: Redis 8 builds JSON, time series, the probabilistic types and its query engine into the core, while Valkey offers JSON, Bloom filters and search as modules, packaged together as Valkey Bundle, and has added features of its own, such as `DELIFEQ` and atomic slot migration in 9.0. Check the licence against how you distribute or host the software, and which managed engines your cloud offers.

## Trade-offs

- **Memory is the limit.** The whole dataset sits in RAM, which caps its size and makes it costlier per GB than disk; eviction or `OOM` errors are what you get when it fills.
- **Small durability windows.** Asynchronous replication and `appendfsync everysec` both trade a little possible loss for speed. Redis is a fine copy of data, not a safe only copy, unless you use a durable variant such as MemoryDB.
- **One slow command stalls everyone.** The single execution thread makes commands atomic but means a long `KEYS`, a big `DEL` or a heavy script blocks every client. Use `SCAN` instead of `KEYS`, and `UNLINK` to free big values in the background.
- **The cluster changes the programming model.** Multi-key commands, transactions and scripts must stay within one slot, so key names have to be designed for it (hash tags), and clients must handle the `MOVED` and `ASK` redirections.
- **Cache consistency is your job.** Redis doesn't know when PostgreSQL changes; TTLs and invalidation on write (see [Cache-Aside](../cache-aside/)) bound how stale a cached value can get.

## Implementation notes

The scenario's keys, with redis-cli's replies:

```text
> SET product:42 '{"id":42,"name":"Mug"}' EX 300
OK
> HSET session:9f3c user 42 cart 2
(integer) 2
> EXPIRE session:9f3c 1800
(integer) 1
> INCR ratelimit:key-7:1201
(integer) 101
> EXPIRE ratelimit:key-7:1201 60 NX
(integer) 0
> ZINCRBY top-sellers 1 mug
"813"
```

`101` is over the limit of 100, so the app answers 429. `EXPIRE … NX` (Redis 7.0+) sets the TTL only on a counter that has none yet, so it returns 0 here: the first request of the minute already set it. Running `INCR` and `EXPIRE` as two calls leaves a short gap in which a crash leaves a counter with no TTL; wrap them in `MULTI`/`EXEC` or a script, or use `INCREX` (Redis 8.8+), which increments and sets the expiry in one command.

- **Size memory for the peak.** After keys are deleted the process often keeps its memory (the allocator can't always hand it back), so plan for peak use, set `maxmemory` below the machine's RAM to leave room for replication and AOF buffers and for copy-on-write during a fork, and watch `used_memory`, `mem_fragmentation_ratio` and evictions in `INFO`. Active defragmentation (`activedefrag yes`) can recover fragmented memory.
- **Choose the eviction policy per instance.** `allkeys-lru` is right for a pure cache, but on an instance that also holds sessions and counters it can evict a session under memory pressure. Keep must-keep data on a separate instance, or size memory so eviction never starts.
- **Find big keys and hot keys.** `redis-cli --bigkeys` and `--memkeys` scan for the largest keys; Redis 8.6 added the `HOTKEYS` command. One huge hash or one hot key in a cluster loads one shard while the others idle.
- **Watch latency.** `SLOWLOG GET` lists slow commands, and the latency monitor (`CONFIG SET latency-monitor-threshold 100`, then `LATENCY DOCTOR`) explains spikes. Forks for RDB snapshots and AOF rewrites are a common cause: the main thread copies the process's page tables, about 48 MB for a 24 GB instance, and the documentation also advises disabling transparent huge pages.
- **Never expose it to the internet.** Redis is designed for trusted clients on a trusted network. Keep the default `bind 127.0.0.1 -::1` and protected mode unless you mean to open it, then use ACL users with the fewest commands and keys they need (Redis 6+), TLS (Redis 6+), and network rules that admit only the app servers.
- **Configuration for the scenario** (`redis.conf`): `maxmemory 4gb`, `maxmemory-policy allkeys-lru` if the instance only caches, `appendonly yes` with `appendfsync everysec`, and on the Sentinels `sentinel monitor acme-redis 10.0.1.10 6379 2` for a quorum of 2.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Cache-Aside](../cache-aside/) — Read from the cache first; on a miss load from the database and populate the cache.
- [Rate Limiting & Throttling](../rate-limiting/) — Cap how fast each client may call (token bucket) and shed the excess with 429s.
- [Sessions vs Tokens](../sessions-vs-tokens/) — Server-side sessions versus self-contained tokens: where the state lives and how you revoke it.
- [Leader Election](../leader-election/) — Instances elect one coordinator; another takes over when its lease expires.
- [Sliding Window](../sliding-window/) — Slide a window along a sequence, adding the item that enters and dropping the one that leaves, instead of re-scanning each window.
- [Hash Table](../hash-table/) — Hash each key straight to a bucket for O(1) average lookups; colliding keys share a bucket, and the table grows as it fills.
- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.

## References

- [Redis docs — Redis data types](https://redis.io/docs/latest/develop/data-types/)
- [Redis docs — Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [Redis docs — Redis replication](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/)
- [Redis docs — High availability with Redis Sentinel](https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/)
- [Redis docs — Redis cluster specification](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/)
- [Redis docs — Key eviction](https://redis.io/docs/latest/develop/reference/eviction/)
- [Redis docs — Diagnosing latency issues](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency/)
- [Redis docs — Distributed locks with Redis](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)
- [Redis docs — What's new (Redis 8.x releases)](https://redis.io/docs/latest/develop/whats-new/)
- [Redis blog — Redis 8 GA (May 2025)](https://redis.io/blog/redis-8-ga/)
- [Redis — Licenses](https://redis.io/legal/licenses/)
- [Redis blog — Redis adopts dual source-available licensing (March 2024)](https://redis.io/blog/redis-adopts-dual-source-available-licensing/)
- [Redis blog — Redis is now available under the AGPLv3 open source license (May 2025)](https://redis.io/blog/agplv3/)
- [Linux Foundation — Linux Foundation launches open source Valkey community (March 2024)](https://www.linuxfoundation.org/press/linux-foundation-launches-open-source-valkey-community)
- [Valkey blog — Valkey 9.0: innovation, features, and improvements](https://valkey.io/blog/introducing-valkey-9/)
- [Valkey docs — Valkey Bundle getting started guide](https://valkey.io/topics/valkey-bundle/)
- [Amazon ElastiCache User Guide — What is Amazon ElastiCache?](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.html)
- [Amazon MemoryDB Developer Guide — What is MemoryDB](https://docs.aws.amazon.com/memorydb/latest/devguide/what-is-memorydb.html)
- [Microsoft Learn — What is Azure Managed Redis?](https://learn.microsoft.com/en-us/azure/redis/overview)
- [Google Cloud — Memorystore for Valkey overview](https://docs.cloud.google.com/memorystore/docs/valkey/product-overview)
- [Martin Kleppmann — How to do distributed locking (2016)](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)
- [Salvatore Sanfilippo (antirez) — Is Redlock safe? (2016)](https://antirez.com/news/101)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
