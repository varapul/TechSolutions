<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧮 Algorithms & Data Structures](../../README.md#algorithms--data-structures)

# Binary Search

> Halve a sorted range with every check: about 20 steps find one item among a million, where a scan may need a million.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Binary Search" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/binary-search.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Scan one by one** | A **linear search** compares the target with each cell in turn. Finding 58 takes 13 checks (indexes 0 to 12), and a value that isn't there costs all 16, because the scan can only give up at the end. The cost grows in step with the input: O(n). |
| **2 · Halve the range** | Binary search keeps a range `[lo, hi]` that must contain 58 if it is there at all, and checks its middle, `mid = (lo + hi) // 2`. Index 7 holds 31, less than 58, so indexes 0 to 7 are ruled out and `lo = 8`; then 53 < 58 gives `lo = 12`, 64 > 58 gives `hi = 12`, and index 12 holds 58: **4 checks instead of 13**. |
| **3 · A miss lands somewhere** | Searching for 50: 31 < 50 gives `lo = 8`, 53 > 50 gives `hi = 10`, 42 < 50 gives `lo = 10`, and 47 < 50 gives `lo = 11`. Now `lo` has passed `hi`, so the range is empty and 50 is not in the array, after 4 checks. `lo` stops at 11, the index where 50 would be inserted to keep the array sorted, which is exactly what Python's `bisect.bisect_left` returns. |
| **4 · Why it scales** | Every check halves the range, so the worst case is ⌊log₂ n⌋ + 1 checks: 5 for 16 items, 10 for a thousand, 20 for a million and 30 for a billion, where a scan may need all n. It needs **sorted** data and **fast access by index** (an array, not a linked list). Compute the middle as `lo + (hi - lo) / 2`, because `(lo + hi) / 2` overflows fixed-width integers on huge arrays, a bug that sat in the JDK for about nine years. |
<!-- END GENERATED: header -->

## The problem

To find a value in a list you know nothing about, you compare it with every item until one matches. That is a linear search, and its cost grows with the list: a million items can mean a million comparisons, and a value that isn't there always costs all of them. When the items are sorted, one comparison tells you far more than "not this one". If the middle item is too small, every item before it is too small as well, so half the list is ruled out at once.

## How it works

Binary search keeps a range of indexes `[lo, hi]` and one **invariant**: if the target is in the array at all, it lies within `a[lo..hi]`.

1. Start with the whole array, `lo = 0` and `hi = n - 1`, so the invariant holds.
2. Check the middle item, `mid = (lo + hi) // 2`. If it equals the target, you are done.
3. If `a[mid]` is smaller than the target, so is everything to its left (the array is sorted), so set `lo = mid + 1`. If it is larger, set `hi = mid - 1`. Either way the invariant still holds and the range shrinks by at least one item, so the loop ends.
4. If the range becomes empty (`lo > hi`), the invariant says the target is absent. `lo` has stopped at its **insertion point**, the index where it would go to keep the array sorted: 11 for the 50 in step 3.

Each check rules out about half of what is left, so n items need at most ⌊log₂ n⌋ + 1 checks, whether the target is found or not. A correctness argument for any variant follows the same three moves: the invariant holds before the loop, every branch keeps it, and every pass shrinks the range.

### Closed or half-open ranges

There are two common ways to write the bounds. Each is correct on its own, and most off-by-one bugs come from mixing them:

| Convention | Start | Loop while | Target is right of mid | Target is left of mid | Typical slip |
|---|---|---|---|---|---|
| Closed `[lo, hi]` | `hi = n - 1` | `lo <= hi` | `lo = mid + 1` | `hi = mid - 1` | `while lo < hi` stops before checking a one-item range, so `[5]` never finds 5; `hi = n` lets `mid` read one past the end |
| Half-open `[lo, hi)` | `hi = n` | `lo < hi` | `lo = mid + 1` | `hi = mid` | `hi = mid - 1` throws away a candidate; `lo = mid` stops moving once `hi = lo + 1`, an endless loop |

The half-open form suits the lower and upper bounds below, and it matches how C++ iterator ranges, Python slices and Go's `sort.Search` describe a range.

### Lower bound, upper bound and duplicates

With duplicates, "an index of x" is often not enough: the search above returns whichever copy it meets first (searching `[2, 2, 2, 3]` for 2 returns index 1). Two variants answer more useful questions:

- the **lower bound** is the first index whose value is **at least** x;
- the **upper bound** is the first index whose value is **greater than** x.

The copies of x occupy `[lower, upper)`, so `upper - lower` counts them, and the values from x to y inclusive sit at indexes `lower_bound(x)` to `upper_bound(y) - 1`. When x is absent, both return its insertion point. The standard libraries:

- **Python:** `bisect.bisect_left(a, x, lo=0, hi=len(a), *, key=None)` is the lower bound and `bisect_right` (also named `bisect`) the upper bound; `insort_left` and `insort_right` insert while keeping the order. The `key` parameter arrived in Python 3.10, and the functions compare only with `__lt__`, never `__eq__`.
- **C++:** `std::lower_bound` returns the first element not ordered before the value, and `std::upper_bound` the first element ordered after it. `std::equal_range` returns both, and `std::binary_search` only says whether the value is there. They need a range that is partitioned with respect to the value (sorted is enough) and make at most log₂ N + O(1) comparisons; C++20 adds `std::ranges` versions.
- **Java:** `Arrays.binarySearch` and `Collections.binarySearch` return the index when the key is found (with duplicates, any one of them) and `-(insertion point) - 1` when it isn't, so the result is negative exactly when the key is absent. The insertion point is the index of the first element greater than the key, or the length if there is none.
- **Go:** `sort.Search(n, f)` returns the smallest index in `[0, n)` where `f` is true, assuming `f` is false and then true, and returns `n`, not -1, when there is none; `sort.Find` takes a three-way comparison instead. The generic `slices.BinarySearch(x, target)` returns the earliest position where the target is or would be, plus a boolean that says whether it was found, and `slices.BinarySearchFunc` takes a comparison function.

### The midpoint overflow

In 2006 Joshua Bloch described a bug in the binary search he had written for the JDK's `java.util.Arrays`: it computed `(low + high) / 2`. Once an array has about 2³⁰ elements (a billion) or more, `low + high` can exceed the largest `int`, 2³¹ − 1, and wrap around to a negative number. In Java the negative index throws `ArrayIndexOutOfBoundsException`; in C, signed overflow is undefined behaviour. The bug had gone unnoticed for about nine years, and the version in Jon Bentley's *Programming Pearls*, which had been proven correct, computes the midpoint the same way. Bloch notes that mergesort and other divide-and-conquer code share the problem. The fix is to avoid the big sum: `low + (high - low) / 2`, or in Java `(low + high) >>> 1`, which reads the sum as unsigned. Python's `(lo + hi) // 2` is safe, because Python integers have unlimited precision.

### Binary search on the answer

The array is optional. Binary search works on any yes-or-no question that is monotonic over an ordered range: false up to some point and true from then on. Finding the first true value is a lower bound over the question instead of over stored data.

For example, packages weighing `[3, 2, 2, 4, 1, 4]` must ship in this order within D = 3 days; what is the smallest daily capacity that manages it? If a capacity works, every larger one works too, so search the capacities from the heaviest package (4) to the total weight (16). Each check simulates the loading in O(n), so the whole search costs O(n log W) for a total weight W. The answer is 6: `[3, 2]`, `[2, 4]` and `[1, 4]`. Go's `sort.Search` has exactly this shape, and in Python 3.10 or later `lo + bisect_left(range(lo, hi + 1), True, key=fits)` does the same without building a list.

`git bisect` applies the idea to history. Mark a bad commit and an older good one; Git checks out a commit about halfway between them, you test and mark it, and the range halves again. The documentation's example has 675 revisions left to test and expects roughly 10 more steps. `git bisect run <cmd>` automates the loop: exit code 0 means good, 1 to 127 except 125 means bad, and 125 means the commit can't be tested and should be skipped. The precondition is monotonicity again: once the bug appears, it has to stay.

### Exponential (galloping) search

When the length is unknown (a stream, or a function you can only probe) or the target is likely near the start, probe positions 1, 2, 4, 8, … until one passes the target, then binary-search the last gap. That takes about 2 log₂ i comparisons for a target at position i, no matter how long the data is. Timsort's merges use it: when one run keeps winning the comparisons, CPython's `list.sort` switches to *galloping mode* (after `MIN_GALLOP` = 7 wins in a row, a threshold it adjusts as it goes) and copies whole slices at once. CPython's notes trace the idea to work on adaptive set intersections and to Peter McIlroy's "exponential search". Java's object sort, adapted from Timsort, gallops the same way.

## Code

```python
def binary_search(a, target):
    """Return an index of target in the sorted list a, or -1 if it is absent."""
    lo, hi = 0, len(a) - 1          # closed range: a[lo..hi] may hold target
    while lo <= hi:                  # empty once lo passes hi
        mid = (lo + hi) // 2         # Python ints never overflow
        if a[mid] == target:
            return mid
        if a[mid] < target:
            lo = mid + 1             # target can only be right of mid
        else:
            hi = mid - 1             # target can only be left of mid
    return -1


def lower_bound(a, target):
    """Return the first index whose value is >= target (len(a) if there is none)."""
    lo, hi = 0, len(a)               # the answer is in lo..hi; len(a) means "none"
    while lo < hi:
        mid = (lo + hi) // 2
        if a[mid] < target:
            lo = mid + 1             # mid and everything left of it are too small
        else:
            hi = mid                 # mid could be the answer; keep it
    return lo


a = [3, 8, 11, 15, 19, 23, 27, 31, 36, 42, 47, 53, 58, 64, 71, 80]
print(binary_search(a, 58), binary_search(a, 50), lower_bound(a, 50))
# 12 -1 11
```

Both functions were checked against `bisect.bisect_left` on 20,000 random sorted lists with duplicates, for targets below, between and above the values, plus the empty list, a one-item list and both ends of the array above.

## Complexity

| | Cost | Why |
|---|---|---|
| Best time | O(1) | The first middle item is the target. |
| Average time | O(log n) | Nearly half the items are reached only on the last check, so a successful search of a million items averages about 19 checks, one fewer than the worst case. |
| Worst time | O(log n) | At most ⌊log₂ n⌋ + 1 checks, whether the target is found or not. |
| Extra space | O(1) | The loop keeps two indexes. A recursive version uses O(log n) stack frames. |

Binary search only reads the array, so stable and in place don't apply. The expensive part is keeping the array sorted: inserting a value shifts O(n) items.

## When to use it

- Lookups in sorted data that changes rarely: lookup tables built once, sorted lists of IDs, time series ordered by timestamp, lists of versions or releases.
- Questions a hash table can't answer: the nearest key at or below a value, the first event after a moment, every key in a range, the rank of a key.
- Any monotonic yes-or-no question: the smallest capacity, timeout or batch size that passes, the first bad commit.
- Not for a single lookup in unsorted data, because sorting first costs O(n log n), more than one O(n) scan. Not for data that changes constantly, because each insert into a sorted array shifts O(n) items; a balanced binary search tree or a B-tree keeps inserts at O(log n). And for exact-match lookups alone, a hash table answers in O(1) on average.

## Trade-offs

- **Sorted data is the price.** Sorting costs O(n log n) once, and keeping an array sorted costs O(n) moves per insert. Sedgewick and Wayne's ordered-array symbol table, which is built on binary search, needs about 2N array accesses for one insert into N keys in the worst case.
- **It needs fast access by index.** Every check jumps to a position, which takes O(1) only in an array. On a linked list, reaching the middle means walking half of it: Java's `Collections.binarySearch` documents O(n) link traversals for a large list that doesn't support random access (while still making only O(log n) comparisons), and C++'s `std::lower_bound` on forward iterators advances the iterator a linear number of times.
- **Checks jump around memory.** Successive checks in a large array land far apart, so each one can miss the CPU cache, or the page cache when the array is a file. B-trees keep many keys in each page, so one page read narrows the search a long way.
- **Duplicates and misses need a decision.** The plain search returns some matching index. Use the lower or upper bound for the first or last copy, and settle what "not found" returns: -1, the insertion point, or Java's `-(insertion point) - 1`.
- **The comparison must match the sort order.** Searching with a different key or comparator from the one used to sort gives wrong answers without any error; Java's documentation calls the result undefined.

## Implementation notes

- **Language libraries:** see the list above. CPython's `list.sort` also sorts short runs with a binary insertion sort, which finds each insertion point by binary search, and gallops while merging.
- **B-tree pages:** a B-tree lookup searches the sorted keys inside each page to pick the child to descend into. PostgreSQL's B-tree code, for example, binary-searches each page for the first key that is at least the scan key, a lower bound; on an inner page it then follows the key just before that one, the last key below the scan key ([`_bt_binsrch` in nbtsearch.c](https://github.com/postgres/postgres/blob/master/src/backend/access/nbtree/nbtsearch.c)).
- **SSTables in LSM stores:** a LevelDB table file ends with an index block that has one entry per data block, keyed by a string at least as large as that block's last key and smaller than the next block's first key ([table format](https://github.com/google/leveldb/blob/main/doc/table_format.md)). A lookup seeks in the index block to find the only data block that can hold the key, then seeks inside that block. Keys in a block are prefix-compressed, with a full key stored at regular *restart points*; a seek binary-searches the restart points and then scans forward a few entries ([block.cc](https://github.com/google/leveldb/blob/main/table/block.cc)).
- **Kafka's log indexes:** every log segment has a sparse offset index (offset to file position) and a sparse time index (timestamp to offset), both in sorted order because they are only appended to, and the broker binary-searches them. The [source](https://github.com/apache/kafka/blob/trunk/storage/src/main/java/org/apache/kafka/storage/internals/log/AbstractIndex.java) explains a twist: a textbook search over the whole index touches pages that may have dropped out of the page cache, so the broker first searches only the newest 8 KB of entries, where nearly all lookups from consumers and in-sync followers land.
- **Routing by key range:** range-based [Sharding](../sharding/) keeps the boundaries between shards in order, and routing a key means finding the range that contains it, which is a binary search over the boundaries. A consistent-hashing ring is often stored the same way, as a sorted array of positions searched for the first one at or after the key's hash.
- **Bisecting other things:** besides `git bisect`, VS Code's extension bisect disables half of the installed extensions at a time and asks whether the problem persists, which finds a misbehaving extension among 24 in four or five rounds (see [Microkernel](../microkernel/)).
- **Related structures:** a binary search tree holds the same halving in linked nodes, so inserts stay O(log n) while it is balanced; a hash table gives up order for O(1) average exact lookups.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Big-O Notation](../big-o-notation/) — How an algorithm's cost grows with its input: O(1), O(log n), O(n), O(n log n) and O(n²) side by side as n grows.
- [Binary Search Tree](../binary-search-tree/) — Smaller keys left, larger right: O(log n) search and insert while the tree stays balanced, O(n) once it degrades into a list.
- [Two Pointers](../two-pointers/) — Move two indices through an array, toward each other or one chasing the other, to solve pair and partition problems in one pass.
- [Bubble, Selection & Insertion Sort](../elementary-sorts/) — The three simple O(n²) sorts compared, and why insertion sort still runs inside fast library sorts on short runs.
- [Merge Sort](../merge-sort/) — Split the list until single items remain, then merge sorted halves back together: O(n log n) every time, and stable.
- [Quicksort](../quicksort/) — Partition around a pivot, smaller values left and larger right, then sort each side: fast in place, O(n²) when pivots are bad.
- [Hash Table](../hash-table/) — Hash each key straight to a bucket for O(1) average lookups; colliding keys share a bucket, and the table grows as it fills.
- [Sliding Window](../sliding-window/) — Slide a window along a sequence, adding the item that enters and dropping the one that leaves, instead of re-scanning each window.

## References

- [Python documentation — bisect: Array bisection algorithm](https://docs.python.org/3/library/bisect.html)
- [Joshua Bloch — Extra, Extra - Read All About It: Nearly All Binary Searches and Mergesorts are Broken (Google Research blog, 2006)](https://research.google/blog/extra-extra-read-all-about-it-nearly-all-binary-searches-and-mergesorts-are-broken/)
- [Java SE 27 API — java.util.Arrays (binarySearch)](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/Arrays.html)
- [cppreference — std::lower_bound](https://en.cppreference.com/cpp/algorithm/lower_bound)
- [Go standard library — sort.Search](https://pkg.go.dev/sort#Search)
- [Go standard library — slices.BinarySearch](https://pkg.go.dev/slices#BinarySearch)
- [Git documentation — git-bisect](https://git-scm.com/docs/git-bisect)
- [Sedgewick and Wayne — Algorithms, 4th edition, 3.1 Elementary Symbol Tables](https://algs4.cs.princeton.edu/31elementary/)
- [CPython — Objects/listsort.txt (galloping in list.sort)](https://github.com/python/cpython/blob/main/Objects/listsort.txt)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
