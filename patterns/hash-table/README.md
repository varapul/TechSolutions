<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧮 Algorithms & Data Structures](../../README.md#algorithms--data-structures)

# Hash Table

> Hash each key straight to a bucket for O(1) average lookups; colliding keys share a bucket, and the table grows as it fills.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Hash Table" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/hash-table.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Key to bucket** | Each `put` runs the key through a hash function (32-bit FNV-1a here) and reduces the hash to a bucket index with `hash mod 8`: alice hashes to `0x872213E7` and lands in bucket 7, bob in 4 and carol in 2. A `get` repeats the same calculation and goes straight to that bucket, so on average it costs the same however many entries the table holds: **O(1)**. |
| **2 · Collisions share a bucket** | dave hashes to `0xD06CC5DF`, which also gives bucket 7, so the bucket keeps a short **chain** (separate chaining): alice, then dave. `get(dave)` goes to bucket 7 and compares keys along the chain: alice is not equal, dave is, and it returns 38. A shared bucket, or even an identical hash, does not mean the keys are equal, so the key comparison is always needed. |
| **3 · Grow before it clogs** | erin and frank bring the table to 6 entries in 8 buckets, a **load factor** of 0.75. grace collides with frank in bucket 3 and makes 7, more than 0.75 × 8 = 6, so the table doubles to 16 buckets and rehashes every entry with `mod 16`: alice, bob, carol and frank stay where they are, while erin moves to 9, grace to 11 and dave to 15. The load factor drops to 7/16 ≈ 0.44. A resize copies everything (O(n)), but doubling makes it rare enough that inserts stay **O(1) amortized**. |
| **4 · When hashing goes wrong** | FNV-1a has no secret, so colliding keys can be computed offline: these five 5-character keys all hash to `0x91AB64A5` and pile into bucket 5 while the load factor stays within its 0.75 limit. A lookup there scans the chain (5 compares for the last key, n in general), and inserting n such keys costs O(n²) compares: **hash flooding**, demonstrated against many web platforms in December 2011. The defences are keyed hashes with a random seed (SipHash), Java's tree bins and limits on request size. |
<!-- END GENERATED: header -->

## The problem

Programs look things up by key all the time: a user by ID, a session by token, a word's running count, a name in a compiler's symbol table. Scanning a list compares the key with every entry, which is O(n). Keeping the entries sorted allows [binary search](../binary-search/) in O(log n), but then every insert has to shift entries to keep the order. A hash table skips the search: a **hash function** turns the key into an array index, so finding an entry costs about the same with ten keys or ten million. That is why mainstream languages ship one as their default map and set: `dict` and `set` in Python, `HashMap` and `HashSet` in Java and Rust, `map` in Go.

## How it works

A hash table is an array of `m` **buckets**. To store a key and its value:

1. Compute `hash(key)`, a fixed-size number derived from the key's bytes.
2. Reduce it to a bucket index, here `hash mod m`.
3. Put the entry, key and value together, in that bucket. If the key is already there, replace its value instead.

A lookup repeats steps 1 and 2 and searches only that bucket. Different keys can land in the same bucket (a **collision**, like alice and dave in step 2), so the bucket compares the stored keys with the one requested. The hash only narrows the search; key equality decides it.

### Hash functions

A table's hash function has to be **deterministic** (the same key always gives the same hash, at least within one process), **fast**, and **well spread**: similar keys such as `user1` and `user2` should get unrelated hashes, so they don't crowd into the same buckets.

- **Non-cryptographic hashes** such as FNV-1a, used in the diagram, cost a few instructions per byte. FNV-1a starts from a fixed offset basis (`0x811C9DC5` for 32 bits) and, for each byte, XORs the byte into the hash and multiplies by the FNV prime (16,777,619), keeping 32 bits. Its specification became [RFC 9923](https://www.rfc-editor.org/rfc/rfc9923.html) in February 2026, an Informational RFC on the Independent Submission stream. With nothing secret in it, anyone can compute collisions offline, a risk the RFC itself points out: the five keys in step 4 took a few seconds of searching on a laptop.
- **Keyed hashes** mix a secret key into the result, so an attacker who doesn't know the key can't predict which inputs collide. SipHash, published by Jean-Philippe Aumasson and Daniel J. Bernstein in 2012 as a fast pseudorandom function for short inputs, is the usual choice: Python hashes `str` and `bytes` with it under a random key chosen per process, and Rust's `HashMap` uses SipHash 1-3 with a random seed.
- **Cryptographic hashes** such as SHA-256 are rarely used for tables. Their setup and finalization dominate the cost of hashing short keys, which is why [PEP 456](https://peps.python.org/pep-0456/) ruled them out for Python. Without a secret they don't stop flooding either: a table uses only a few low bits of the hash, so an attacker can still search offline for keys that share those bits.

### From hash to bucket

`hash mod m` is the simplest reduction. When `m` is a power of two, as in Java's `HashMap` and CPython's `dict`, `hash mod m` equals `hash & (m - 1)`, a single AND that keeps the low bits. Hex makes this easy to see: the last hex digit of a hash *is* the hash mod 16, and that digit's low three bits are the hash mod 8. alice (`0x872213E7`) and dave (`0xD06CC5DF`) end in `7` and `F`, which share their low three bits, so with 8 buckets both go to bucket 7; with 16 buckets the fourth bit separates them into 7 and 15. That is why the resize in step 3 splits each chain in two: every entry either stays at index `i` or moves to `i + 8`. Java's `HashMap` relies on the same fact when it doubles, splitting each bucket into the entries that stay and the entries that move up by the old capacity.

Masking works only if the low bits are well mixed, because hashes that differ only in their high bits would all collide. Java's `HashMap` therefore XORs the top 16 bits of `hashCode()` into the bottom 16 (`h ^ (h >>> 16)`) before masking; it also starts at 16 buckets, where the diagram starts at 8 to stay small. CPython takes another route: its integer hashes are very regular, so it starts from the low bits and lets the probe sequence bring in the rest of the hash. A table with a prime number of buckets and a true `mod`, the textbook choice for modular hashing, is more forgiving of weak low bits but pays for a division.

### Collisions: chaining or open addressing

**Separate chaining**, the diagram's method, keeps a list per bucket and appends colliding entries to it; Java's `HashMap` works this way. With a good hash the chains stay short: the `HashMap` source estimates that, with random hash codes at the default load factor, almost 99% of buckets hold two entries or fewer.

**Open addressing** stores every entry in the array itself and, on a collision, probes other slots in a fixed order until it finds the key or an empty slot:

- **Linear probing** tries the next slot, then the next. It is cache-friendly, but occupied slots clump into runs that lengthen probes as the table fills.
- **Robin Hood hashing** adds one rule to linear probing: when a key being inserted meets an occupied slot, whichever of the two keys has travelled farther from its home slot keeps it, and the other moves on. Probe lengths even out.
- **Swiss tables** keep one metadata byte per slot, holding 7 bits of the hash and a control bit, and check a whole group of slots in one step (Abseil uses SSE instructions), so a lookup rarely compares a key that doesn't match. Google presented the design in 2017 and open-sourced it in the Abseil C++ library in 2018. Rust's `HashMap` has used a port of it (the hashbrown crate) since Rust 1.36, and Go's built-in maps switched to it in Go 1.24.

Deleting needs care under open addressing. Emptying a slot would cut the probe path to keys stored beyond it, so the slot is marked deleted instead: a **tombstone** that lookups step over and inserts can reuse. CPython's `dict` calls these dummy entries and Swiss tables mark them with a "deleted" control byte. Tombstones keep lengthening probes until a resize clears them.

CPython's `dict` uses open addressing with a perturbed probe sequence (`j = 5j + 1 + perturb`, where `perturb` starts as the full hash and loses 5 bits each step), so in the end every bit of the hash steers the probe. Since 3.6 it stores the entries in a dense array in insertion order behind a sparse index table, and insertion order became a language guarantee in Python 3.7.

### Load factor and resizing

The **load factor** is entries divided by buckets. With chaining it is the average chain length, and the expected cost of a lookup grows with it, so tables cap it and grow when they pass the cap. Java's `HashMap` rehashes into about twice as many buckets once the number of entries exceeds capacity × load factor (0.75 by default): 16 buckets take 12 entries, and the 13th triggers growth to 32. The diagram applies the same rule to 8 buckets, so the 7th entry triggers it. CPython's `dict` keeps its index table at most two-thirds full, and Swiss tables can run fuller because their probes are cheap.

A resize allocates the new array and reinserts every entry: O(n). Doubling makes resizes rare. After growing to `2m` buckets the table takes in about `0.75m` more entries before the next resize, so all the copying for `n` inserts adds up to fewer than `2n` entry moves, and each insert costs **O(1) amortized**. The price is an occasional slow insert. If you know the final size, presize the table: Java's `HashMap.newHashMap(n)` (Java 19 and later) sizes the table so that `n` mappings fit without a resize, and Rust's `HashMap::with_capacity(n)` holds at least `n` entries without reallocating.

### The hashing contract

A hash table relies on two rules that the key type must obey:

- **Equal keys must have equal hashes.** Otherwise two equal keys land in different buckets and the table keeps both. Python's glossary and Java's `Object.hashCode` both require it. The reverse is not required, which is why lookups still compare keys. Python applies the rule across types: `1`, `1.0` and `True` compare equal, hash the same and index the same `dict` entry.
- **A key's hash must not change while it is in a table.** Mutate a key after inserting it and its hash moves, so lookups search the wrong bucket and the entry is effectively lost. That is why Python's built-in mutable containers (`list`, `dict`, `set`) are unhashable while tuples of hashable items are hashable, and why Java's `Map` documentation warns against mutable keys.

For your own key types, derive equality and the hash from the same immutable fields: a Python `@dataclass(frozen=True)` and a Java `record` generate both for you.

### Hash flooding

Every insert scans its bucket's chain for an existing key, so if an attacker can choose keys that all collide, `n` inserts cost 0 + 1 + … + (n − 1) key comparisons, O(n²): 10 for the five keys in step 4, about 50 million for 10,000. Scott Crosby and Dan Wallach demonstrated such attacks against two versions of Perl, the Squid web proxy and the Bro intrusion detection system in 2003. On 28 December 2011, at the 28th Chaos Communication Congress, Alexander Klink and Julian Wälde showed that web platforms parse request parameters into hash tables with predictable hash functions, so a single POST request full of colliding parameter names could keep a CPU busy for minutes or even hours. The [oCERT-2011-003](https://ocert.org/advisories/ocert-2011-003.html) advisory released the same day lists Java, JRuby, PHP, Python, Rubinius and Ruby, servers such as Apache Tomcat, Jetty and GlassFish, the Rack interface and the V8 JavaScript engine.

The fixes came in three layers, the defence chips in step 4:

- **Limit the input.** Frameworks capped the number of parameters a request may carry; PHP's `max_input_vars`, 1000 by default, exists to stop exactly this attack.
- **Hide the hash.** Randomize it per process so collisions can't be computed in advance. Python first salted its FNV-style string hash with a random prefix and suffix, on by default since 3.3, but Aumasson and Bernstein showed the secret could be recovered, so PEP 456 moved `str` and `bytes` to SipHash in Python 3.4. Python 3.11 switched to the faster SipHash-1-3.
- **Bound the damage.** Since Java 8 ([JEP 180](https://openjdk.org/jeps/180)), a `HashMap` bucket that grows past 8 entries becomes a balanced tree, ordered by hash and, for `Comparable` keys such as `String`, by `compareTo`, which turns the worst case per lookup from O(n) into O(log n). Tables with fewer than 64 buckets resize instead. `String.hashCode()` is a fixed, documented formula, so Java relies on the trees rather than on a secret.

### Sets and ordered maps

A hash set is a hash table of keys without values. Python's `set` and `frozenset` require hashable members for that reason, and Java's `HashSet` is backed by a `HashMap`. Adding, removing and membership tests cost O(1) on average, as in a map.

Hash tables offer no useful order: Java's `HashMap` promises none, and Python's `dict` remembers insertion order but not sorted order. For keys in sorted order, range queries ("every key from `carol` to `frank`") or the nearest key above or below a value, use an ordered map: a balanced [binary search tree](../binary-search-tree/) such as Java's `TreeMap` (a red-black tree with guaranteed O(log n) operations), or a B-tree in a database. PostgreSQL's hash indexes, for example, support only `=`, so range conditions need a B-tree index.

### Where hashing reaches architecture

- **Shards and cache clusters.** Spreading keys over `N` servers with `hash(key) mod N` is the same reduction, with the same weakness seen in step 3: change `N` and many keys move. Inside a hash table that is a quick memory copy; across servers it means moving data. Sharded databases and cache clusters therefore use consistent hashing, rendezvous hashing or a fixed set of slots. Redis Cluster, for example, maps each key to one of 16,384 slots with `CRC16(key) mod 16384` and moves whole slots between nodes. See [Sharding](../sharding/) and [Cache-Aside](../cache-aside/).
- **Rendezvous hashing** (highest random weight) scores every server with a hash of the key and the server's ID and picks the highest. When a server leaves, only its keys move, each to its next-highest server. EVPN networks use it to elect designated forwarders ([RFC 8584](https://www.rfc-editor.org/rfc/rfc8584.html)).
- **Bloom filters** set a few bits, chosen by several hash functions, for each key in a bit array. If any of a key's bits is clear the key is definitely absent, which lets [RocksDB](https://github.com/facebook/rocksdb/wiki/RocksDB-Bloom-Filter) skip SST files that can't hold it.
- **Content addressing** names data by a cryptographic hash of its bytes. [Git](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects) stores every object under the SHA-1 of its content, or SHA-256 in repositories created with `--object-format=sha256`, so identical content is stored once and any change produces a new name. Here collision resistance matters more than speed, the opposite of a hash table's trade-off.

## Code

A chained hash map using Python's built-in `hash()`, built like the diagram's table: 8 buckets to start, new entries appended to the end of the chain, and a doubling resize once the entries exceed 0.75 × buckets.

```python
class HashMap:
    """Separate chaining: each bucket is a list of (key, value) pairs."""

    def __init__(self, buckets=8):
        self.buckets = [[] for _ in range(buckets)]
        self.size = 0

    def _chain(self, key):
        return self.buckets[hash(key) % len(self.buckets)]

    def get(self, key, default=None):
        for k, v in self._chain(key):
            if k == key:                  # same bucket is not enough: compare keys
                return v
        return default

    def put(self, key, value):
        chain = self._chain(key)
        for i, (k, _) in enumerate(chain):
            if k == key:
                chain[i] = (key, value)   # existing key: replace the value
                return
        chain.append((key, value))
        self.size += 1
        if self.size > 0.75 * len(self.buckets):
            self._resize(2 * len(self.buckets))

    def delete(self, key):
        chain = self._chain(key)
        for i, (k, _) in enumerate(chain):
            if k == key:
                del chain[i]
                self.size -= 1
                return True
        return False

    def _resize(self, n):
        old, self.buckets = self.buckets, [[] for _ in range(n)]
        for chain in old:                 # rehash every entry into the new array
            for k, v in chain:
                self._chain(k).append((k, v))


m = HashMap()
for key, value in [("alice", 31), ("bob", 27), ("carol", 45), ("dave", 38),
                   ("erin", 29), ("frank", 52), ("grace", 41)]:
    m.put(key, value)
print(m.get("dave"), m.size, len(m.buckets))   # 38 7 16
m.delete("bob")
print(m.get("bob"), m.size)                     # None 6
```

The class was checked against `dict` on 300 random runs of puts, gets and deletes over integer and string keys (resizes included, under several hash seeds), plus the empty map, a single key, replacing a value, deleting a missing key, `1`, `1.0` and `True` as one key, and `-1` and `-2`, which share a hash in CPython. Python salts string hashes per process, so the buckets differ from run to run while the results don't.

The diagram's run is the same class with FNV-1a in place of `hash()`:

```python
def fnv1a_32(key):
    h = 0x811C9DC5                          # 32-bit offset basis
    for byte in key.encode("utf-8"):
        h ^= byte                           # mix in the next byte,
        h = (h * 0x01000193) & 0xFFFFFFFF   # multiply by the FNV prime, keep 32 bits
    return h

for key in ["alice", "bob", "carol", "dave", "erin", "frank", "grace"]:
    h = fnv1a_32(key)
    print(f"{key:<6} 0x{h:08X}  mod 8 = {h % 8}  mod 16 = {h % 16}")
print({f"0x{fnv1a_32(k):08X}" for k in ["hbM9J", "wmEna", "wA2zj", "HLqZ9", "S6VAj"]})
# alice  0x872213E7  mod 8 = 7  mod 16 = 7
# bob    0x86C6A0D4  mod 8 = 4  mod 16 = 4
# carol  0x67088F12  mod 8 = 2  mod 16 = 2
# dave   0xD06CC5DF  mod 8 = 7  mod 16 = 15
# erin   0x36AD59F9  mod 8 = 1  mod 16 = 9
# frank  0xF40CE5C3  mod 8 = 3  mod 16 = 3
# grace  0x9C487A6B  mod 8 = 3  mod 16 = 11
# {'0x91AB64A5'}
```

The last line is step 4: five different keys, one hash.

## Complexity

| | Cost | Why |
|---|---|---|
| Best time | O(1) | The key's bucket is empty or holds only that key: one hash and at most one comparison. |
| Average time | O(1) | With a well-spread hash and the load factor capped at 0.75, a chain holds under one entry on average, so `get`, `put` and `delete` each hash once and compare a constant number of keys. |
| Worst time | O(n) | Every key in one bucket: each operation scans the whole chain, and n inserts cost O(n²) (step 4). Java's tree bins cut a lookup to O(log n) for comparable keys. |
| Resize | O(n), O(1) amortized | A resize copies every entry, but doubling keeps the total below 2n moves for n inserts. |
| Extra space | O(n) | The bucket array (at least n / 0.75 slots) plus one list entry per key. |

Stable and in place don't apply to a map. Iteration order is not guaranteed in general: it follows the buckets, so it depends on the hash values and changes after a resize. Python's `dict` is the exception, with insertion order.

## When to use it

- Lookups, inserts and deletes by exact key when order doesn't matter: in-memory indexes and caches, counting and grouping, deduplication, memoization.
- Membership tests, as a set: "have I seen this ID before?"
- Joining two collections on a key in memory: build a table from the smaller one, then probe it with each item of the larger one.
- Not for sorted output, ranges or nearest-key queries (use an ordered map or a B-tree), not when keys are small dense integers (index an array directly), and not for attacker-controlled keys unless the hash is keyed or the table bounds its chains.

## Trade-offs

- **Average, not guaranteed.** O(1) depends on a well-spread hash and a capped load factor. A poor hash or chosen keys degrade it to O(n) unless the table defends itself.
- **Memory buys speed.** Empty buckets and per-entry overhead cost space, and a lower load factor trades more memory for shorter chains or probes.
- **Resize pauses.** Most inserts are quick, but the one that triggers a resize copies everything. Presize when you know the size.
- **No order.** Range queries and sorted iteration need another structure.
- **Hashing isn't free.** Long keys are hashed on every operation; for small integer keys a direct array is faster.
- **Silent bugs.** A key type whose equality and hash disagree, or a key mutated in place, loses entries without any error.

## Implementation notes

| Library | Collisions | Defaults worth knowing |
|---|---|---|
| Java `HashMap` | Chaining; long chains become balanced (red-black) tree bins | 16 buckets, load factor 0.75; a bucket becomes a tree once it passes 8 entries in a table of at least 64 buckets; mixes `h ^ (h >>> 16)` before masking; not synchronized |
| Python `dict` | Open addressing, perturbed probing | Insertion order guaranteed since 3.7; index table at most two-thirds full; `str` and `bytes` hashed with SipHash-1-3 under a per-process random key |
| Go `map` | Swiss table since Go 1.24 | Iteration order is unspecified and may differ between loops |
| Rust `HashMap` | Swiss table (hashbrown port) | SipHash 1-3, randomly seeded; a different hasher can be plugged in per map |
| Abseil `absl::flat_hash_map` (C++) | Swiss table | The original design the Rust and Go versions follow |

- **Pick the hasher by threat model.** If keys come from outside (HTTP parameters, JSON field names, user input), keep a keyed hash or a table that bounds its chains, and cap request sizes. For trusted integer keys on a hot path, a faster unkeyed hasher is fine.
- **Keep `hash()` inside the process.** Python's string hashes change from run to run (set `PYTHONHASHSEED` to an integer to repeat a run while debugging), so never store them or use them to pick a shard or cache node. Use a stable, documented hash for anything that crosses processes, as Redis Cluster does with CRC16.
- **Don't depend on iteration order** of Java's `HashMap`, Go maps or Python sets; sort when order matters, for example in tests, logs and diffs.
- **Presize big tables** and build them once if you can, to avoid repeated resizes.
- **The hash flavours differ by job.** Tables want speed plus a secret (SipHash), shards want stability across machines (CRC16, consistent or rendezvous hashing), and content addressing wants collision resistance (SHA-256).

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Sharding](../sharding/) — Split data horizontally across databases using a shard key.
- [Cache-Aside](../cache-aside/) — Read from the cache first; on a miss load from the database and populate the cache.
- [Binary Search Tree](../binary-search-tree/) — Smaller keys left, larger right: O(log n) search and insert while the tree stays balanced, O(n) once it degrades into a list.
- [Big-O Notation](../big-o-notation/) — How an algorithm's cost grows with its input: O(1), O(log n), O(n), O(n log n) and O(n²) side by side as n grows.
- [Binary Search](../binary-search/) — Halve a sorted range with every check: about 20 steps find one item among a million, where a scan may need a million.
- [Two Pointers](../two-pointers/) — Move two indices through an array, toward each other or one chasing the other, to solve pair and partition problems in one pass.
- [Sliding Window](../sliding-window/) — Slide a window along a sequence, adding the item that enters and dropping the one that leaves, instead of re-scanning each window.

## Related components and services

- [Redis & Valkey](../redis/) — An in-memory data-structure server: cache, session store, rate limiter, leaderboard and lightweight queue in one process.

## References

- [RFC 9923 — The FNV Non-Cryptographic Hash Algorithm (Noll, Vo, Eastlake and Hansen, 2026)](https://www.rfc-editor.org/rfc/rfc9923.html)
- [Java SE 27 API — java.util.HashMap](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/HashMap.html)
- [JEP 180 — Handle Frequent HashMap Collisions with Balanced Trees](https://openjdk.org/jeps/180)
- [OpenJDK — HashMap.java (implementation notes, treeify thresholds, hash spreading)](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/HashMap.java)
- [Python documentation — Mapping types: dict](https://docs.python.org/3/builtins/stdtypes.html#mapping-types-dict)
- [Python documentation — Glossary: hashable](https://docs.python.org/3/glossary.html#term-hashable)
- [Python documentation — object.__hash__ (hash randomization)](https://docs.python.org/3/reference/datamodel.html#object.__hash__)
- [PEP 456 — Secure and interchangeable hash algorithm](https://peps.python.org/pep-0456/)
- [What's New In Python 3.11 — siphash13 as the default str and bytes hash](https://docs.python.org/3/whatsnew/3.11.html)
- [CPython — Objects/dictobject.c (open addressing, dummy entries, usable fraction)](https://github.com/python/cpython/blob/main/Objects/dictobject.c)
- [Go 1.24 Release Notes — a new built-in map implementation based on Swiss Tables](https://go.dev/doc/go1.24)
- [The Go Blog — Faster Go maps with Swiss Tables (2025)](https://go.dev/blog/swisstable)
- [Rust standard library — std::collections::HashMap](https://doc.rust-lang.org/std/collections/struct.HashMap.html)
- [Abseil — Swiss Tables Design Notes](https://abseil.io/about/design/swisstables)
- [oCERT-2011-003 — multiple implementations denial-of-service via hash algorithm collision](https://ocert.org/advisories/ocert-2011-003.html)
- [Klink and Wälde — Effective Denial of Service attacks against web application platforms (28C3, 2011)](https://fahrplan.events.ccc.de/congress/2011/Fahrplan/events/4680.en.html)
- [Crosby and Wallach — Denial of Service via Algorithmic Complexity Attacks (USENIX Security 2003)](https://www.usenix.org/conference/12th-usenix-security-symposium/denial-service-algorithmic-complexity-attacks)
- [Aumasson and Bernstein — SipHash: a fast short-input PRF (2012)](https://www.aumasson.jp/siphash/siphash.pdf)
- [Sedgewick and Wayne — Algorithms, 4th edition, 3.4 Hash Tables](https://algs4.cs.princeton.edu/34hash/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
