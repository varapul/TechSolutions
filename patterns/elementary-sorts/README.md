<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧮 Algorithms & Data Structures](../../README.md#algorithms--data-structures)

# Bubble, Selection & Insertion Sort

> The three simple O(n²) sorts compared, and why insertion sort still runs inside fast library sorts on short runs.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Bubble, Selection &amp; Insertion Sort" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/elementary-sorts.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Bubble sort** | Each pass compares neighbours from left to right and swaps any pair that is out of order, so the largest remaining value bubbles to the end, where it is final (green). On 5 2 4 6 1 3 that takes 15 comparisons and 9 swaps, one per **inversion** (a pair in the wrong order). A pass without swaps ends the sort; here that is the fifth and last pass anyway. |
| **2 · Selection sort** | Each pass scans the unsorted part, holding the smallest value seen so far (amber), then makes at most one swap to put it in place for good (green). Six items always cost 5 + 4 + 3 + 2 + 1 = **15 comparisons**, whatever the order, but here only **3 swaps**: 5 with 1, 4 with 3 and 6 with 4. |
| **3 · Insertion sort** | The left part is always sorted but not yet final. Each new value is lifted out (amber), larger values in the sorted part shift one slot right, and it drops into the gap. That makes **12 comparisons and 9 shifts**: each shift removes one inversion, just as each of bubble sort's 9 swaps did. |
| **4 · Same O(n²), not alike** | All three take O(n²) time on average and in the worst case, but they behave differently. On the nearly sorted 1 2 3 4 6 5, insertion sort needs **6 comparisons and 1 shift** and bubble sort stops after 2 passes, while selection sort still makes 15 comparisons. Selection sort makes the fewest writes but its long-distance swap is not **stable**, and library sorts hand their short runs to insertion sort. |
<!-- END GENERATED: header -->

## The problem

Bubble sort, selection sort and insertion sort put items in order by comparing and moving them. Each fits in a few lines of code and needs no extra memory, but each needs on the order of n² steps. That is fine for a dozen items and hopeless for a million: insertion sort averages about n²/4 comparisons, roughly 2.5 × 10¹¹ for a million random items.

They are still worth knowing. They are the clearest way to see loop invariants, inversions and stability, and they differ in ways that still matter: how many writes they make, whether equal keys keep their order, and whether nearly sorted input is cheap. Insertion sort is also more than a classroom piece. The standard sorts of Python, Java, C++, Go and .NET hand it every short range, because on a few dozen items its tiny inner loop beats the faster O(n log n) algorithms.

## How it works

All three grow a sorted region one item at a time. They differ in what that region promises: its **loop invariant**.

- **Bubble sort** sweeps from left to right and swaps each neighbouring pair that is out of order. After pass *k*, the *k* largest items sit at the end in their final places, so each pass can stop one position earlier. *Invariant: the tail is sorted and final.* A pass without a single swap proves the whole array is sorted, so the sort can stop early.
- **Selection sort** scans the unsorted part for its smallest item and swaps it into the next position. *Invariant: the prefix holds the smallest items in their final order.* It always scans everything that is left, so it makes n(n − 1)/2 comparisons on any input, but never more than n − 1 swaps.
- **Insertion sort** takes the next item (the key), shifts every larger item in the sorted prefix one place right, and drops the key into the gap. *Invariant: the prefix is sorted but not final*, because a later key can still land in the middle of it.

**Inversions** explain the counts in the diagram. An inversion is a pair of items in the wrong order relative to each other. 5 2 4 6 1 3 has nine: 5 comes before 2, 4, 1 and 3; 2 before 1; 4 before 1 and 3; and 6 before 1 and 3. Swapping two out-of-order neighbours removes exactly one inversion and leaves every other pair as it was, so bubble sort makes exactly 9 swaps. Each shift in insertion sort moves one larger item past the key, which also removes exactly one inversion, so insertion sort makes exactly 9 shifts. Its comparisons are the shifts plus at most one stopping comparison per key, so they fall between I and I + n − 1 for I inversions. Here that is 9 + 3 = 12, because keys 2 and 1 slid all the way to the front and never needed a stopping comparison.

A random ordering has n(n − 1)/4 inversions on average. That is why bubble and insertion sort are quadratic on average, and why insertion sort is fast whenever inversions are few: it runs in O(n + I).

**Stability** means that equal keys keep their input order, which matters when you sort records by one field after another. Bubble and insertion sort only ever move an item past a strictly larger one, so they are stable. Selection sort's swap can throw the item at the front of the unsorted part far to the right, past an equal key: sorting 2a 2b 1 swaps 2a with 1 and leaves 1 2b 2a. Shifting the minimum into place instead of swapping it makes selection sort stable, but that costs O(n) writes per pass and gives up the one thing selection sort is good at.

**Binary insertion sort** finds the key's slot with a binary search instead of a step-by-step walk. That cuts the comparisons to O(n log n) in total, but the larger items still have to move, so the worst case is still O(n²) moves. It pays off when a comparison costs much more than a move. CPython is the textbook case: comparing two Python objects runs generic, possibly user-defined code, while moving one copies a pointer. To stay stable it must insert after any equal keys (`bisect_right`, not `bisect_left`).

## Code

```python
def bubble_sort(a):
    """Swap out-of-order neighbours; stop after a pass with no swaps."""
    for end in range(len(a) - 1, 0, -1):   # a[end + 1:] is sorted and final
        swapped = False
        for j in range(end):
            if a[j] > a[j + 1]:
                a[j], a[j + 1] = a[j + 1], a[j]
                swapped = True
        if not swapped:
            break


def selection_sort(a):
    """Swap the smallest remaining item into each position in turn."""
    for i in range(len(a) - 1):            # a[:i] holds the i smallest, in order
        m = i
        for j in range(i + 1, len(a)):
            if a[j] < a[m]:
                m = j
        if m != i:
            a[i], a[m] = a[m], a[i]


def insertion_sort(a):
    """Lift each item out and shift larger ones right until it fits."""
    for i in range(1, len(a)):             # a[:i] is sorted, not yet final
        key = a[i]
        j = i - 1
        while j >= 0 and a[j] > key:
            a[j + 1] = a[j]
            j -= 1
        a[j + 1] = key


data = [5, 2, 4, 6, 1, 3]
for sort in (bubble_sort, selection_sort, insertion_sort):
    a = data.copy()
    sort(a)
    print(f"{sort.__name__:15} {a}")
# bubble_sort     [1, 2, 3, 4, 5, 6]
# selection_sort  [1, 2, 3, 4, 5, 6]
# insertion_sort  [1, 2, 3, 4, 5, 6]
```

All three sort in place and return `None`, like `list.sort()`. They were tested against `sorted()` on 2,000 random lists of up to 40 items, with many duplicates, as well as on an empty list, one item, all-equal items and sorted and reversed input. A stability test used (key, tag) records that compare by key only: bubble and insertion sort keep the tags in input order, while selection sort turns 2a 2b 1c into 1c 2b 2a. Instrumented copies of these functions produced every count in the diagram.

## Complexity

| Algorithm | Best | Average | Worst | Extra space | Stable | Adaptive |
|---|---|---|---|---|---|---|
| Bubble sort (with early exit) | O(n): one pass and no swaps on sorted input | O(n²): one swap per inversion, n(n − 1)/4 on average | O(n²): reversed input, n(n − 1)/2 comparisons and swaps | O(1): swaps in place | Yes: only out-of-order neighbours swap | Partly: the early exit helps only when no small item has far to travel left |
| Selection sort | O(n²): n(n − 1)/2 comparisons on any input | O(n²): the same scans every time | O(n²), but never more than n − 1 swaps | O(1): swaps in place | No: the long-distance swap can jump an equal key | No: every scan runs to the end |
| Insertion sort | O(n): n − 1 comparisons and no shifts on sorted input | O(n²): about n²/4 comparisons and shifts | O(n²): reversed input, n(n − 1)/2 comparisons and shifts | O(1): holds one key | Yes: shifts only strictly larger items | Yes: O(n + I) for I inversions |

## When to use it

- **Call your language's built-in sort.** It already uses insertion sort where insertion sort wins: on short ranges.
- **Write an insertion sort yourself** for a handful of values in a hot loop, for input where every item is at most *k* places from home (O(nk)), and for keeping a small array sorted while items arrive one at a time. It is *online*: it never needs to see the rest of the input.
- **Reach for selection sort** only when a write costs far more than a comparison, as with very large records or memory that wears out, because it makes at most n − 1 swaps. Sorting references or indices and then moving each record once is usually better still.
- **Use bubble sort to teach**, not to ship.

## Trade-offs

- **Quadratic growth.** Double the input and the work quadruples. On a million random items insertion sort makes about 2.5 × 10¹¹ comparisons, where an O(n log n) sort such as merge sort makes about 2 × 10⁷.
- **Bubble sort loses to insertion sort on every count.** It makes as many swaps as insertion sort makes shifts, but a swap writes two items where a shift writes one, and it usually compares more. Its early exit is fragile: a small item near the end moves only one place left per pass, so 2 3 4 5 6 1 still takes all five passes and 15 comparisons, against 9 for insertion sort. In a 2003 SIGCSE paper, Owen Astrachan traced the name to Kenneth Iverson's *A Programming Language* (1962), since earlier papers call it sorting by exchange. He also timed it at nearly three times slower than insertion sort on random strings in Java, and argued that wherever bubble sort does well, insertion sort does at least as well.
- **Selection sort ignores its input.** It costs the same on sorted and random data, and its long swap breaks stability. Its strength is the number of writes: at most n − 1 swaps, against up to n(n − 1)/2 for the other two.
- **Insertion sort is the one to keep.** It is stable, in place, online and adaptive, with a tiny inner loop. It still has an O(n²) worst case on reversed or random input, which is why libraries use it only below a size threshold.

## Implementation notes

The standard library sorts all switch to insertion sort for short ranges. These thresholds were checked in each project's current source in October 2026:

- **Python** (`list.sort()`, `sorted()`) uses Timsort. A list shorter than 64 items never reaches the merge step: binary insertion sort alone sorts it. In longer lists, natural runs shorter than the minimum run length (between 32 and 64) are extended to it with binary insertion sort before merging. From Python 3.15, run lengths may differ by one from run to run, so every merge is balanced. The sort is guaranteed stable.
- **Java** sorts objects (`Arrays.sort` on objects, `List.sort`) with TimSort, where an array shorter than 32 elements gets binary insertion sort alone. It sorts primitive arrays with Dual-Pivot Quicksort. The leftmost part switches to insertion sort below 44 elements. Other parts switch below 65, a limit that grows with recursion depth, to a *mixed insertion sort* that uses the pivot on its left as a sentinel and so skips the bounds check. On Linux x86-64, recent JDKs can run these small sorts as vectorised AVX2 or AVX-512 code instead.
- **C++**: libstdc++'s `std::sort` is introsort. It runs quicksort, falls back to heapsort when recursion goes deeper than 2·log₂ n, and leaves every range of 16 elements or fewer unsorted. A single insertion sort pass over the whole array then finishes cheaply, because each element is already inside its own block of at most 16. `std::stable_sort` insertion-sorts chunks of 7 before merging them.
- **Go**: `sort.Sort` and `sort.Slice` have used pattern-defeating quicksort (pdqsort) since Go 1.19, and `slices.Sort` (Go 1.21) uses it too. It insertion-sorts any range of 12 elements or fewer. The stable sorts insertion-sort blocks of 20 and then merge them in place.
- **.NET**: `Array.Sort` and `List<T>.Sort` use introsort. Partitions of 16 elements or fewer go to insertion sort, or to a direct compare-and-swap when they hold two or three.
- **Nearly sorted data in your own systems.** Data often arrives almost in order, such as metrics or log lines in a [telemetry pipeline](../telemetry-pipeline/) where a few points come in late. Inserting each one into a sorted buffer costs O(n + I) overall, close to linear while the disorder stays small.
- **Thresholds are tuned, not universal.** The cut-offs above, from 7 to about 65 elements, came from benchmarks on each runtime. They depend on the cost of a comparison relative to a move, so measure before you copy one.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Big-O Notation](../big-o-notation/) — How an algorithm's cost grows with its input: O(1), O(log n), O(n), O(n log n) and O(n²) side by side as n grows.
- [Merge Sort](../merge-sort/) — Split the list until single items remain, then merge sorted halves back together: O(n log n) every time, and stable.
- [Quicksort](../quicksort/) — Partition around a pivot, smaller values left and larger right, then sort each side: fast in place, O(n²) when pivots are bad.
- [Binary Heap & Heapsort](../binary-heap/) — A complete binary tree packed into an array keeps the smallest item on top: O(log n) push and pop, the classic priority queue.
- [Binary Search](../binary-search/) — Halve a sorted range with every check: about 20 steps find one item among a million, where a scan may need a million.

## References

- [Sedgewick & Wayne — Algorithms, 4th edition: 2.1 Elementary Sorts](https://algs4.cs.princeton.edu/21elementary/)
- [Owen Astrachan — Bubble Sort: An Archaeological Algorithmic Analysis (SIGCSE 2003)](https://users.cs.duke.edu/~ola/papers/bubble.pdf)
- [CPython — Objects/listsort.txt (Timsort, minrun and binary insertion sort)](https://github.com/python/cpython/blob/main/Objects/listsort.txt)
- [GCC libstdc++ — bits/stl_algo.h (std::sort: introsort plus a final insertion sort)](https://github.com/gcc-mirror/gcc/blob/master/libstdc%2B%2B-v3/include/bits/stl_algo.h)
- [Go — src/slices/zsortordered.go (pdqsort)](https://github.com/golang/go/blob/master/src/slices/zsortordered.go)
- [OpenJDK — java.util.DualPivotQuicksort](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/DualPivotQuicksort.java)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
