<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧮 Algorithms & Data Structures](../../README.md#algorithms--data-structures)

# Big-O Notation

> How an algorithm's cost grows with its input: O(1), O(log n), O(n), O(n log n) and O(n²) side by side as n grows.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Big-O Notation" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/big-o-notation.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Count steps, not seconds** | Big-O describes how the number of basic steps grows with the input size **n**, not the time on one machine. Reading `a[5]` by index touches one cell however long the array is, **O(1)**; searching an unsorted array for a value that isn't there checks every cell, **O(n)**. When the array doubles from 8 to 16 cells, the read still takes 1 step and the scan takes 16. |
| **2 · Halving: O(log n)** | On a sorted array, an algorithm that throws away half of the remaining range at every step goes 16 → 8 → 4 → 2 → 1: **4 halvings**, because log₂ 16 = 4. Doubling n to 32 adds only one more, so the curve rises quickly and then flattens. Binary search works this way, and so does a lookup in a balanced search tree. |
| **3 · n log n and n²** | Doing **n** work on each of **log₂ n** levels, as merge sort does, fills 4 rows of 16 cells: 64 steps. Comparing every item with every item in two nested loops fills the whole grid: 16 × 16 = 256 steps. On the chart, zoomed out 8×, the n log n curve stays inside the frame while n² leaves it. |
| **4 · What it means at scale** | At **n = 1,000,000** the classes are worlds apart: 1 step, about 20, a million, about 20 million and a trillion. At an illustrative billion simple steps per second, the first two finish in nanoseconds, O(n) takes 1 ms, O(n log n) about 20 ms and O(n²) about **17 minutes**. Three rules keep Big-O simple: drop constant factors (3n + 5 is O(n)), keep the fastest-growing term (n² + n is O(n²)), and ignore the base of the logarithm. |
<!-- END GENERATED: header -->

## The problem

A function takes 40 ms on a thousand records on your laptop. How long will it take on a million? A stopwatch can't say: it measures one machine, one language and one input size. Code that is instant in a unit test can take minutes in production when its work grows with the square of the input, and you want to see that coming before the data arrives, without benchmarking every size on every machine.

Big-O notation describes how the **number of basic steps** grows as the input size **n** grows. It deliberately ignores what doesn't change the shape of that growth: the speed of the hardware, the language and fixed overheads.

## How it works

**Count steps as a function of n.** Pick a unit of work that takes a fixed amount of time, such as reading one array cell, comparing two values or moving one item, and count how many the algorithm needs for an input of size n. Then keep only the shape of the count:

- **Drop constant factors.** 3n + 5 steps and n steps grow the same way, so both are O(n). Constants depend on the machine and the implementation, not on the algorithm.
- **Keep the fastest-growing term.** n² + n is O(n²): once n is large, the n² term is nearly all of it.
- **Ignore the base of the logarithm.** log₁₀ n is log₂ n divided by about 3.32, just another constant factor. This page uses base 2 throughout, the natural base for halving: log₂ 16 = 4.

**The definition.** f(n) is O(g(n)) when some constant c and some threshold n₀ make f(n) ≤ c·g(n) for every n ≥ n₀ ([NIST's dictionary](https://xlinux.nist.gov/dads/HTML/bigOnotation.html) gives the formal version). For example, 3n + 5 ≤ 4n for every n ≥ 5, so 3n + 5 is O(n). It is an **upper bound** on growth, and it only has to hold from some point on, which is why small inputs don't count.

**O, Ω and Θ.** Ω(g(n)) is the matching **lower bound**: f(n) ≥ c·g(n) for every n from some n₀ on. Θ(g(n)) means both at once, a **tight** bound. A linear scan is Θ(n); it is also O(n²), which is true but tells you little. Donald Knuth's 1976 letter to SIGACT News proposed the Ω and Θ that computer scientists use today alongside O. In everyday use O usually stands in for Θ: "merge sort is O(n log n)" is meant as "takes about n log n steps", not just "at most".

**Best, average and worst case** are a separate choice from O, Ω and Θ: first pick the inputs you are describing, then bound the cost on them. Searching an unsorted list takes 1 step when the target comes first, n steps when it is missing, and about n/2 on average when it is present at a random position. Quicksort takes Θ(n log n) time on average and Θ(n²) in its worst case. Say which case you mean: a hash table's O(1) is an average, while merge sort's O(n log n) holds even in the worst case.

**Amortized cost** spreads a rare expensive operation over the cheap ones around it. Appending to a Python list usually writes one pointer into spare capacity. When the capacity runs out, CPython grows the list's array, over-allocating in proportion to its size, and growing can mean copying every element pointer to a new block: one O(n) append. Because each resize makes room for proportionally more appends, n appends cost O(n) in total, so each one is **amortized O(1)**. The [Python wiki](https://wiki.python.org/moin/TimeComplexity) lists append that way and warns that a single call can still take surprisingly long.

**Space complexity** uses the same notation for memory: the extra space an algorithm needs beyond its input. Merge sort needs O(n) extra space for merging, heapsort O(1), and a recursive function holds one stack frame per level of recursion. Time and space often trade: a set of n items costs O(n) memory and turns each membership test from O(n) into O(1) on average.

**Recognise the class from the shape of the code:**

| Shape of the code | Class | Example |
|---|---|---|
| A fixed amount of work, no loop over the input | O(1) | `items[i]`, `d[key]` (average) |
| Halve what is left at every step | O(log n) | binary search, a lookup in a balanced tree |
| One pass over the input | O(n) | `sum(items)`, `x in items` |
| Split in half, recurse on both halves, combine in one pass | O(n log n) | merge sort |
| Two nested loops over the input | O(n²) | comparing every pair |
| Try every subset (there are 2ⁿ) | O(2ⁿ) | brute-force knapsack |
| Try every ordering (there are n!) | O(n!) | brute-force travelling salesman |

**Several inputs get several variables.** Matching two lists of sizes n and m with a nested loop is O(n·m); putting one list into a set first and then checking each item of the other is O(n + m) on average. Keep both letters: O(n·m) shows the cost depends on both sizes, which a single O(n²) would hide when one list is small.

## Code

Five small functions, one per class, each counting its own steps, and a loop that prints the counts for n = 10, 100 and 1,000. For merge sort the steps are the items its merges move: exactly n log₂ n when n is a power of two (64 for the diagram's 16 items) and slightly more otherwise (n log₂ n is 33, 664 and 9,966 here). `halve` expects sorted input and returns -1 when the target is missing; `get` raises `IndexError` on an empty list, as indexing does.

```python
def get(items, i):                  # O(1): one read, however long the list is
    return items[i], 1


def halve(items, target):           # O(log n): keep the half that can hold target
    lo, hi, steps = 0, len(items), 0
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if target < items[mid]:
            hi = mid
        else:
            lo = mid
        steps += 1
    found = bool(items) and items[lo] == target
    return (lo if found else -1), steps


def scan(items, target):            # O(n): look at items until target turns up
    for steps, item in enumerate(items, 1):
        if item == target:
            return steps - 1, steps
    return -1, len(items)


def merge_sort(items):              # O(n log n): about log2 n levels, n moves each
    if len(items) < 2:
        return list(items), 0
    left, a = merge_sort(items[:len(items) // 2])
    right, b = merge_sort(items[len(items) // 2:])
    out, i, j = [], 0, 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            out.append(left[i]); i += 1
        else:
            out.append(right[j]); j += 1
    out += left[i:] + right[j:]
    return out, a + b + len(out)    # this merge moved len(out) items


def ranks(items):                   # O(n²): every item against every item
    out, steps = [], 0
    for a in items:
        smaller = 0
        for b in items:
            steps += 1
            if b < a:
                smaller += 1
        out.append(smaller)
    return out, steps


print("      n   O(1)  O(log n)    O(n)  O(n log n)      O(n²)")
for n in (10, 100, 1_000):
    items = list(range(n))
    counts = (get(items, n // 2)[1], halve(items, n - 1)[1], scan(items, -1)[1],
              merge_sort(items[::-1])[1], ranks(items)[1])
    print(f"{n:>7,}" + "".join(f"{c:>{w},}" for c, w in zip(counts, (7, 10, 8, 12, 11))))

# Output:
#       n   O(1)  O(log n)    O(n)  O(n log n)      O(n²)
#      10      1         4      10          34        100
#     100      1         7     100         672     10,000
#   1,000      1        10   1,000       9,976  1,000,000
```

## Complexity

Big-O is the subject here rather than one algorithm, so this table summarises the classes instead, with every constant factor set to 1:

| Class | Name | Typical example | Steps at n = 1,000 | Steps at n = 1,000,000 |
|---|---|---|---|---|
| O(1) | constant | `items[i]`; `d[key]` on average | 1 | 1 |
| O(log n) | logarithmic | binary search; a balanced-tree lookup | ≈ 10 | ≈ 20 |
| O(n) | linear | one pass: `sum(items)`, `x in items` | 1,000 | 1,000,000 |
| O(n log n) | linearithmic | merge sort, heapsort, `sorted()` | ≈ 10,000 | ≈ 20 million |
| O(n²) | quadratic | every pair in nested loops; insertion sort in the worst case | 1,000,000 | 10¹² |
| O(2ⁿ) | exponential | every subset | ≈ 1.07 × 10³⁰¹ | a number with 301,030 digits |
| O(n!) | factorial | every ordering | ≈ 4.02 × 10²⁵⁶⁷ | a number with 5,565,709 digits |

## When to use it

- **Choosing a data structure or algorithm for data that will grow:** a set instead of a list for membership tests, a sort or a hash join instead of a nested loop.
- **Reviewing code for hidden quadratic work:** `x in some_list` or `some_list.pop(0)` inside a loop, or a database query for every item of a result.
- **Capacity planning:** what 10× or 100× the data will do before it arrives. O(n log n) work grows a little faster than the data; O(n²) work grows 100× when the data grows 10×.
- **Not on its own for small or fixed-size inputs.** There, constant factors and memory layout decide, so measure.

## Trade-offs

- **It hides constant factors.** An O(n log n) algorithm with heavy bookkeeping can lose to an O(n²) one on small inputs. Library sorts exploit this by handing short runs to insertion sort (see below).
- **It ignores the memory hierarchy.** Walking an array and walking a linked list are both O(n), but in-order reads of contiguous memory make the most of CPU caches and prefetching, while nodes scattered across memory can miss the cache at every step ([Ulrich Drepper, *Memory part 2: CPU caches*](https://lwn.net/Articles/252125/)).
- **The unit of work matters.** Comparisons, item moves, disk pages and network round trips can rank the same algorithms differently. Database indexes pack many keys into each page so that a lookup touches only a few pages; between services, the number of round trips usually matters more than the CPU work.
- **Averages can be beaten.** A hash table's O(1) assumes keys spread evenly; when many keys collide, a dict or set lookup degrades towards the O(n) worst case the Python wiki lists. Quicksort's O(n log n) average hides an O(n²) worst case that some inputs trigger.
- **Amortized is not per operation.** An amortized O(1) append still costs O(n) once in a while, a latency spike that matters in a real-time loop.

## Implementation notes

**Python cheat sheet** (CPython, from the [Python wiki's TimeComplexity page](https://wiki.python.org/moin/TimeComplexity)):

| Operation | Time |
|---|---|
| `items[i]`, `items[i] = x`, `len(items)` | O(1) |
| `items.append(x)`, `items.pop()` | O(1); append is amortized |
| `items.insert(0, x)`, `items.pop(0)` | O(n): every element after the slot shifts |
| `x in items` on a list | O(n) |
| `x in s` on a set, `d[key]` on a dict | O(1) on average, O(n) in the worst case |
| `items.sort()`, `sorted(items)` | O(n log n) |
| `appendleft(x)`, `popleft()` on a `collections.deque` | O(1), so use a deque as a queue |

**Library sorts switch to insertion sort for short runs**, where its low overhead beats its O(n²):

- CPython's `list.sort`, an adaptive merge sort described in [listsort.txt](https://github.com/python/cpython/blob/main/Objects/listsort.txt), sorts lists shorter than 64 items with binary insertion sort, and uses it to extend short runs to a minimum length of at most 64 before merging.
- Java's `Arrays.sort` for objects, a TimSort, sorts arrays shorter than 32 the same way ([ComparableTimSort](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/ComparableTimSort.java)).
- GCC's `std::sort`, an introsort, stops partitioning at 16 elements and finishes with one insertion sort over the whole range ([stl_algo.h](https://github.com/gcc-mirror/gcc/blob/master/libstdc%2B%2B-v3/include/bits/stl_algo.h)).

**Databases make the same choices.** An index lookup walks a B-tree whose height grows with log n, while a sequential scan reads every row: O(log n) against O(n). PostgreSQL builds a B-tree unless you ask for another [index type](https://www.postgresql.org/docs/current/indexes-types.html), and `EXPLAIN` shows which one a query got (`Index Scan` or `Seq Scan`). Joins have the same shapes: a nested-loop join scans the inner table once for every outer row, O(n·m) without an index, while a hash join loads one side into a hash table and probes it with the other, O(n + m) on average ([PostgreSQL planner](https://www.postgresql.org/docs/current/planner-optimizer.html)).

**The same arithmetic shows up in architecture:**

- **N+1 queries.** Loading n items and then querying once per item makes n + 1 round trips; batching makes it two. GraphQL subgraphs use DataLoaders for exactly this ([GraphQL Federation](../graphql-federation/)).
- **Rebalancing.** With `hash(key) % N`, going from 3 to 4 shards moves 75% of the keys; logical shards or consistent hashing move about a quarter ([Sharding](../sharding/)).
- **Connections.** Peering every pair of n networks takes n(n−1)/2 links, O(n²); a hub needs one per spoke, O(n) ([Hub-and-Spoke Network](../hub-spoke-network/)).
- **Memory per client.** A sliding-window log keeps a timestamp per request, so its memory grows with the limit; a sliding-window counter keeps two numbers per key ([Rate Limiting & Throttling](../rate-limiting/)).
- **Precomputing.** A materialized view pays for an expensive aggregation once per refresh instead of on every read ([Materialized View](../materialized-view/)).

**Measure as well.** Time the code at n and at 2n: a ratio near 2 points to linear growth, near 4 to quadratic, near 8 to cubic, the doubling experiment of Sedgewick and Wayne's [section 1.4](https://algs4.cs.princeton.edu/14analysis/). Profile realistic data with `cProfile` or `timeit` before rewriting anything.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Binary Search](../binary-search/) — Halve a sorted range with every check: about 20 steps find one item among a million, where a scan may need a million.
- [Bubble, Selection & Insertion Sort](../elementary-sorts/) — The three simple O(n²) sorts compared, and why insertion sort still runs inside fast library sorts on short runs.
- [Merge Sort](../merge-sort/) — Split the list until single items remain, then merge sorted halves back together: O(n log n) every time, and stable.
- [Hash Table](../hash-table/) — Hash each key straight to a bucket for O(1) average lookups; colliding keys share a bucket, and the table grows as it fills.
- [Recursion & the Call Stack](../recursion/) — A function calls itself on a smaller input; each call waits on the stack until a base case returns and the answers unwind.
- [Binary Search Tree](../binary-search-tree/) — Smaller keys left, larger right: O(log n) search and insert while the tree stays balanced, O(n) once it degrades into a list.
- Dynamic Programming *(planned)* — Solve each overlapping subproblem once and reuse its answer, top-down with memoization or bottom-up with a table.
- Sliding Window *(planned)* — Slide a window along a sequence, adding the item that enters and dropping the one that leaves, instead of re-scanning each window.

## References

- [Donald E. Knuth — Big Omicron and Big Omega and Big Theta (ACM SIGACT News, 1976)](https://dl.acm.org/doi/10.1145/1008328.1008329)
- [NIST Dictionary of Algorithms and Data Structures — big-O notation](https://xlinux.nist.gov/dads/HTML/bigOnotation.html)
- [Sedgewick & Wayne — Algorithms, 4th edition: 1.4 Analysis of Algorithms](https://algs4.cs.princeton.edu/14analysis/)
- [MIT OpenCourseWare — 6.006 Introduction to Algorithms (Spring 2020)](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/)
- [Python Wiki — TimeComplexity](https://wiki.python.org/moin/TimeComplexity)
- [CPython — listsort.txt: how list.sort works](https://github.com/python/cpython/blob/main/Objects/listsort.txt)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
