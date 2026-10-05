<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧮 Algorithms & Data Structures](../../README.md#algorithms--data-structures)

# Quicksort

> Partition around a pivot, smaller values left and larger right, then sort each side: fast in place, O(n²) when pivots are bad.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Quicksort" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/quicksort.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Partition around a pivot** | The last value, **5**, is the pivot. The scan pointer `j` checks each value in turn: a value ≤ 5 swaps into slot `i` and `i` moves one step right, so a left zone of small values grows while larger values stay behind it. After 7 comparisons the pivot swaps into slot `i`, index 3, its **final place**: everything to its left is smaller and everything to its right is larger. |
| **2 · Recurse on each side** | Quicksort repeats the move on each side: `3 1 2` around pivot 2, then `9 8 7 6` around 6, then 9, then 7. Each pivot turns green where it lands, and a side holding a single value is already in place. The strip below keeps one row per recursion level: 4 levels, **15 comparisons** and **8 swaps** in all (the pivot-9 pass only swaps values with themselves, which moves nothing and isn't counted). |
| **3 · Bad pivots: O(n²)** | On input that is already sorted, the same code always picks the largest value as the pivot, so every partition peels off only the pivot. The recursion goes 7 levels deep and makes 7 + 6 + … + 1 = **28 comparisons**, n(n − 1)/2: the **O(n²)** worst case. A random pivot makes the expected cost O(n log n) on every input, and the median of the first, middle and last values handles sorted and reversed input. |
| **4 · Fast in practice** | Quicksort works **in place**: besides the array it needs only the recursion stack, O(log n) frames if it always recurses into the smaller side first. Its scans walk memory sequentially, which suits CPU caches, and it averages **O(n log n)**, but it is **not stable**. C++ `std::sort`, Java's `Arrays.sort` for primitives, Go's `sort` and `slices` and Rust's `sort_unstable` are all quicksort hybrids; Python's `list.sort` uses the stable, merge-based Timsort instead. |
<!-- END GENERATED: header -->

## The problem

Sorting sits under a lot of everyday code: ordering query results, preparing data for binary search, grouping duplicates, finding a median. The simple quadratic sorts are fine for a few dozen items but fall over as n grows, and merge sort, which guarantees O(n log n), needs a second buffer as large as the input. Quicksort is the classic way to sort an array quickly *in place*: on typical data it is the fastest general-purpose comparison sort, and besides the array it needs only a short recursion stack.

Tony Hoare came up with it around 1959–60, as a visiting student at Moscow State University working on machine translation, where he needed to sort words so he could look them up efficiently in a dictionary. He published it in *Communications of the ACM* in 1961 as the ALGOL procedures *Partition*, *Quicksort* and *Find* (Algorithms 63 to 65), and described and analysed it in the 1962 paper *Quicksort* in *The Computer Journal*.

## How it works

Quicksort is divide and conquer with the work done up front:

1. **Pick a pivot.** The diagram takes the last value of the range, the simplest rule.
2. **Partition** the range so that the values ≤ the pivot come first and the larger values after them, then swap the pivot in between. The pivot is now in its final position and never moves again.
3. **Recurse** on the part to its left and the part to its right. A part with zero or one value is already sorted.

Merge sort is the mirror image: it splits without looking at the values and does its work afterwards, merging sorted halves. Quicksort does its work before it recurses, so when the last call returns there is nothing left to combine.

**Lomuto partitioning**, the scheme in the diagram, keeps a boundary `i` and scans with `j`. Whenever `a[j] ≤ pivot` it swaps `a[j]` into slot `i` and moves `i` one step right, so `a[lo:i]` always holds the small values seen so far. It is named after Nico Lomuto, and Jon Bentley's *Programming Pearls* and the *Introduction to Algorithms* textbook made it the classroom standard because it is short and easy to prove correct. **Hoare's original scheme** moves two indices toward each other from both ends and swaps each pair that sits on the wrong side. It makes far fewer swaps (roughly a third as many as Lomuto's on random input, in a quick test) but its boundary conditions are subtler, and the pivot does not necessarily end at the split point. Neither scheme is stable.

**The shape of the recursion sets the cost.** Each level of the recursion compares the values in it with their pivots, so a level costs at most n comparisons. When pivots split their ranges evenly there are about log₂ n levels and the sort takes O(n log n): the 8 shuffled values in the diagram need 4 levels and 15 comparisons. When every pivot is the smallest or largest value in its range, each partition peels off only the pivot: n − 1 levels and n(n − 1)/2 comparisons, 28 for 8 values. Taking the last value as the pivot does exactly that to sorted and reverse-sorted input, which real programs produce all the time.

**Choosing the pivot:**

- *First or last value:* free, but quadratic on sorted or reversed input.
- *A random value:* the expected cost is O(n log n) on every input; a quadratic run is possible but very unlikely.
- *Median of three* (the first, middle and last values): sorted and reversed input split perfectly, for two or three extra comparisons per partition.
- *Tukey's ninther:* the median of three medians of three, nine samples in all, for large ranges. Bentley and McIlroy's *Engineering a Sort Function* (1993) uses it above 40 elements, and Go's pdqsort from 50.

No fixed rule stops a determined attacker. McIlroy's *A Killer Adversary for Quicksort* (1999) chooses the input's values lazily, while the sort runs, so that almost any quicksort, randomized ones included, goes quadratic; against a deterministic sort, the input it builds can be saved and replayed. That is why library sorts also cap the worst case with a guaranteed fallback (see the hybrids below).

**Many equal keys.** Because the test is `≤`, Lomuto partitioning sends every copy of the pivot value to the left, so an array of identical values is quadratic even with a random pivot. *Three-way partitioning* splits the range into less than, equal to and greater than the pivot, and never looks at the equal block again; it is Dijkstra's *Dutch national flag* problem. With it, duplicates make quicksort faster instead of slower, and Bentley and McIlroy's paper gives a fast way to do it.

**Bounding the stack.** Recurse into the smaller part and loop on the larger one. Each recursive call then gets at most half of its parent's range, so no more than about log₂ n frames are ever on the stack, even when the running time is quadratic. A naive version needs a frame per level: sorting 2,000 already sorted values that way in Python exceeds the default recursion limit of 1,000.

**Hybrids** are what libraries actually ship:

- *Introsort* (David Musser, 1997) runs quicksort but switches to heapsort once the recursion passes a depth limit proportional to log n, so its worst case is O(n log n).
- *Dual-pivot quicksort* (Vladimir Yaroslavskiy, with Jon Bentley and Joshua Bloch) partitions around two pivots into three parts.
- *pdqsort*, Orson Peters' pattern-defeating quicksort, adds a heapsort fallback, scatters a few values when a partition comes out badly unbalanced, tries a short insertion sort on ranges that look sorted already, and sorts input with k distinct values in O(nk).

**Quickselect.** Partition once, then continue only into the side that holds index k: the k-th smallest value (a median, a percentile) comes out in O(n) time on average and O(n²) at worst, without sorting the rest. Hoare published it as *Find* alongside quicksort; C++ offers it as [`std::nth_element`](https://en.cppreference.com/cpp/algorithm/nth_element), typically implemented as introselect.

## Code

```python
import random


def quicksort(a, lo=0, hi=None):
    """Sort the list a in place: Lomuto partition, random pivot."""
    if hi is None:
        hi = len(a) - 1
    while lo < hi:
        p = partition(a, lo, hi)
        # Recurse into the smaller side and loop on the larger one,
        # so the call stack stays O(log n) deep.
        if p - lo < hi - p:
            quicksort(a, lo, p - 1)
            lo = p + 1
        else:
            quicksort(a, p + 1, hi)
            hi = p - 1


def partition(a, lo, hi):
    r = random.randint(lo, hi)        # random pivot, parked at the end
    a[r], a[hi] = a[hi], a[r]
    pivot = a[hi]
    i = lo                            # a[lo:i] holds values <= pivot
    for j in range(lo, hi):
        if a[j] <= pivot:
            a[i], a[j] = a[j], a[i]
            i += 1
    a[i], a[hi] = a[hi], a[i]         # the pivot lands in its final place
    return i


data = [6, 3, 8, 1, 9, 2, 7, 5]
quicksort(data)
print(data)  # [1, 2, 3, 5, 6, 7, 8, 9]
```

The `while` loop sorts the larger side itself, which keeps the stack O(log n) deep, and the random pivot makes sorted input harmless. The code is tested against `sorted()` on random, sorted, reversed, all-equal, empty and one-item lists. All-equal input still takes O(n²) time with this two-way partition; three-way partitioning fixes that.

## Complexity

| | Cost | Why |
|---|---|---|
| Time, best | O(n log n) | every pivot halves its range: about log₂ n levels of at most n comparisons |
| Time, average | O(n log n) | about 2n ln n ≈ 1.39 n log₂ n comparisons on random input |
| Time, worst | O(n²) | every pivot is the smallest or largest value: n − 1 levels, n(n − 1)/2 comparisons |
| Extra space | O(log n) | the recursion stack: never more than about log₂ n frames when the smaller side goes first, up to n − 1 without that trick |
| Stable | No | swaps jump over other values: partitioning 2a 2b 1 around 1 leaves 1 2b 2a |
| In place | Yes | it only swaps values inside the array |

## When to use it

- Sorting arrays in memory when equal keys need not keep their input order: numbers, strings, records with a unique key. The unstable sorts in standard libraries are built on it.
- When memory is tight: it needs no buffer the size of the input, unlike merge sort.
- Selecting without sorting: a median, the top k, a percentile (quickselect).
- **Not** when the order of equal keys matters, as when sorting by one key and then by another: use a stable sort such as Timsort or merge sort.
- **Not** when you need a guaranteed worst case and cannot add a fallback: heapsort and merge sort are O(n log n) on every input.
- **Not** for linked lists: merge sort sorts a list by relinking nodes, stably and in guaranteed O(n log n), while quicksort's strengths (swaps in place, cache-friendly scans) need an array.

## Trade-offs

- **Fast on average, quadratic at worst.** Plain quicksort goes O(n²) on sorted input with a naive pivot, on many equal keys with two-way partitioning, and on purpose under an adversary. Random or sampled pivots, three-way partitioning and a depth limit (introsort) keep the speed without the risk.
- **In place, but not stable.** The long-distance swaps that make it cheap in memory are the same ones that scramble equal keys.
- **Cache-friendly.** Partitioning streams through contiguous memory. Heapsort, also in place, jumps between distant parents and children, which is one reason it serves as the fallback rather than the main act.
- **Recursion overhead on small ranges.** Calls cost more than they save on a handful of values, so implementations hand ranges below a cutoff to insertion sort (16 elements in libstdc++).

## Implementation notes

- **C++:** the standard requires `std::sort` to make O(n log n) comparisons in the worst case (C++98 asked for it only on average, until defect report LWG 713), which plain quicksort cannot promise. libstdc++ uses introsort: a median-of-three pivot, heapsort once the recursion reaches a depth limit of 2 log₂ n, and insertion sort for short ranges; libc++ has met the requirement since LLVM 14. `std::nth_element` is O(n) on average.
- **Java:** `Arrays.sort` on primitive arrays has been a dual-pivot quicksort since Java 7, and the current OpenJDK code also switches to heapsort when the recursion gets too deep. Arrays of objects use TimSort instead: equal primitives are indistinguishable, but equal objects are not, so only object sorts need to be stable.
- **Go:** `sort.Sort` has used pattern-defeating quicksort since Go 1.19, and so does `slices.Sort`, which `sort.Ints` and its siblings call since Go 1.22. Neither is stable; `sort.Stable` and `slices.SortStableFunc` are.
- **Rust:** `sort_unstable` is based on ipnsort (Lukas Bergdoll and Orson Peters), a quicksort with a heapsort fallback that runs in linear time on sorted and reversed input; the stable `sort` is driftsort, a hybrid of quicksort and merge sort.
- **Python:** `list.sort()` and `sorted()` use Timsort, which is stable and takes advantage of runs that are already in order.
- **Databases:** PostgreSQL sorts in memory with Bentley and McIlroy's quicksort ([`sort_template.h`](https://github.com/postgres/postgres/blob/master/src/include/lib/sort_template.h)), changed to check for presorted input and to recurse into the smaller partition, a change its source comments justify with stack overflows seen in production. `EXPLAIN ANALYZE` reports such a sort as [`Sort Method: quicksort`](https://www.postgresql.org/docs/current/using-explain.html); input too large for `work_mem` is sorted in runs that are merged from temporary files.
- **Percentiles:** an exact p99 over a batch of latency samples is a selection problem, which quickselect answers in O(n) on average without sorting the batch. Monitoring systems more often keep histograms or sketches that answer approximately in bounded memory; see [SLOs & Error Budgets](../slo-error-budgets/).

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Merge Sort](../merge-sort/) — Split the list until single items remain, then merge sorted halves back together: O(n log n) every time, and stable.
- [Bubble, Selection & Insertion Sort](../elementary-sorts/) — The three simple O(n²) sorts compared, and why insertion sort still runs inside fast library sorts on short runs.
- [Binary Heap & Heapsort](../binary-heap/) — A complete binary tree packed into an array keeps the smallest item on top: O(log n) push and pop, the classic priority queue.
- [Recursion & the Call Stack](../recursion/) — A function calls itself on a smaller input; each call waits on the stack until a base case returns and the answers unwind.
- [Big-O Notation](../big-o-notation/) — How an algorithm's cost grows with its input: O(1), O(log n), O(n), O(n log n) and O(n²) side by side as n grows.
- [Binary Search](../binary-search/) — Halve a sorted range with every check: about 20 steps find one item among a million, where a scan may need a million.
- [Two Pointers](../two-pointers/) — Move two indices through an array, toward each other or one chasing the other, to solve pair and partition problems in one pass.

## References

- [C. A. R. Hoare — Quicksort (The Computer Journal 5(1), 1962)](https://academic.oup.com/comjnl/article/5/1/10/395338)
- [Sedgewick & Wayne — Algorithms, 4th edition: 2.3 Quicksort](https://algs4.cs.princeton.edu/23quicksort/)
- [David R. Musser — Introspective Sorting and Selection Algorithms (1997), author's page](https://www.cs.rpi.edu/~musser/gp/index_1.html)
- [Orson R. L. Peters — Pattern-defeating Quicksort (arXiv:2106.05123)](https://arxiv.org/abs/2106.05123)
- [M. Douglas McIlroy — A Killer Adversary for Quicksort (1999)](https://mcilroy.cs.dartmouth.edu/mdmspe.pdf)
- [cppreference — std::sort](https://en.cppreference.com/cpp/algorithm/sort)
- [Java SE 27 API — java.util.Arrays](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/Arrays.html)
- [OpenJDK — DualPivotQuicksort.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/DualPivotQuicksort.java)
- [Go 1.19 Release Notes — sort](https://go.dev/doc/go1.19#sort)
- [Rust standard library — slice::sort_unstable](https://doc.rust-lang.org/std/primitive.slice.html#method.sort_unstable)
- [Python documentation — Sorting Techniques](https://docs.python.org/3/howto/sorting.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
