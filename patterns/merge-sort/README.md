<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧮 Algorithms & Data Structures](../../README.md#algorithms--data-structures)

# Merge Sort

> Split the list until single items remain, then merge sorted halves back together: O(n log n) every time, and stable.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Merge Sort" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/merge-sort.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Split down to single items** | The array is cut in half at `mid = (lo + hi) // 2`, each half is cut again, and so on until every piece holds one item. Splitting is only index arithmetic, so the counter stays at 0, and a piece of one item is already sorted. Halving 8 items down to 1 takes three rounds: log₂ 8 = 3. |
| **2 · Merge back up** | A merge of two sorted runs only ever compares their front items, the **heads**, and moves the smaller one up. Level 1 merges single items into four sorted pairs with one comparison each; level 2 merges the pairs into [2 4 5 7] and [1 2 3 6] with three comparisons each. The counter reaches 10. |
| **3 · One merge, close up** | In the final merge `i` and `j` point at the heads of the two sorted halves, and each comparison sends the smaller head to the next free slot of the output. On the tie between 2a and 2b the left one goes first, so equal keys keep their input order: that is what makes merge sort **stable**. Seven comparisons bring the counter to 17; when the right half runs out, the 7 is copied over without one. |
| **4 · Always n log n** | Halving 8 items takes log₂ 8 = 3 levels, and each level of merging moves all 8 items once: 24 moves whatever the input order, with 12 to 17 comparisons (this input needs the most). So the worst case stays **O(n log n)**, where quicksort's can degrade to O(n²). The price is a buffer of n extra cells for the merges; Timsort, a merge sort hybrid, is the stable sort behind Python's `sorted()`, Java's object sorts and V8's `Array.prototype.sort`. |
<!-- END GENERATED: header -->

## The problem

Sorting sits under a lot of everyday work: `ORDER BY`, building an index, merging log files by timestamp, finding duplicates. The [simple sorts](../elementary-sorts/) compare items pair by pair, about n²/2 comparisons in the worst case: fine for 20 items, hopeless for a million, where n²/2 is 5 × 10¹¹ while n log₂ n is about 2 × 10⁷. [Quicksort](../quicksort/) is usually fast, but its worst case is still quadratic and it reorders equal items. Some jobs need more than "usually fast":

- a **guaranteed** O(n log n), whatever order the input arrives in;
- a **stable** result, where records with equal keys keep their input order (sort by date, then by customer, and each customer's rows stay in date order);
- a sort that reads its input **sequentially**: a linked list, or files too big for memory.

Merge sort gives all three.

## How it works

Merge sort is **divide and conquer**:

1. **Split** the array at the middle, `mid = (lo + hi) // 2`, and keep splitting each half. A piece of one item is already sorted, which ends the [recursion](../recursion/).
2. **Merge** neighbouring sorted pieces into longer sorted pieces, until one piece is left.

All the work is in the merge. Keep an index on the head of each sorted run (`i` on the left, `j` on the right), compare the two heads, append the smaller to the output and advance that index. When one run is used up, copy the rest of the other without further comparisons. The loop keeps one invariant: after k steps the output holds the k smallest items of the two runs in sorted order, and each index points at the smallest item its run has not yet given up. So when both runs are used up, the output is sorted. Merging runs of `a` and `b` items moves `a + b` items and takes between `min(a, b)` and `a + b − 1` comparisons.

**Stability comes from the tie rule.** The merge takes from the right run only when its head is strictly smaller; on a tie the left item goes first, so equal keys leave in the order they arrived (2a before 2b in the diagram). Take from the right on ties instead and the sort is no longer stable.

**Why n log n.** Sorting n items costs two sorts of n/2 items plus a merge of n items: T(n) = 2T(n/2) + n. Halving reaches single items after log₂ n levels, and each level of merging moves all n items once, so the total is n log₂ n moves (3 levels × 8 = 24 in the diagram) for any input: O(n log n) in [Big-O](../big-o-notation/) terms. Comparisons depend on the input but stay between about ½ n log₂ n and n log₂ n; for 8 items the algorithm needs 12 to 17, and the diagram's input needs 17.

**Top-down or bottom-up.** The recursive version is *top-down*. The *bottom-up* version needs no recursion: one pass merges runs of one item into pairs, the next merges pairs into fours, and so on, doubling the width until a single run remains. When n is a power of two both versions perform exactly the same merges, only in a different order, which is why the diagram can show them level by level.

## Code

```python
def merge(left, right, key=lambda x: x):
    """Merge two sorted lists into a new sorted list."""
    out = []
    i = j = 0
    while i < len(left) and j < len(right):
        if key(right[j]) < key(left[i]):  # strictly smaller, so a tie takes the left item
            out.append(right[j])
            j += 1
        else:
            out.append(left[i])
            i += 1
    out.extend(left[i:])   # one side is used up; copy the rest of the other
    out.extend(right[j:])
    return out


def merge_sort(items, key=lambda x: x):
    """Return a new sorted list; the input list is left unchanged."""
    if len(items) <= 1:
        return list(items)
    mid = len(items) // 2
    return merge(merge_sort(items[:mid], key), merge_sort(items[mid:], key), key)


print(merge_sort([5, 2, 4, 7, 1, 3, 2, 6]))
# [1, 2, 2, 3, 4, 5, 6, 7]
print(merge_sort(['5', '2a', '4', '7', '1', '3', '2b', '6'], key=lambda s: int(s[0])))
# ['1', '2a', '2b', '3', '4', '5', '6', '7']
```

Slicing (`items[:mid]`) copies each half, which keeps the code short but allocates on every call. An array implementation passes `lo`, `mid` and `hi` instead and merges through one buffer of n slots allocated up front, so splitting really is only index arithmetic.

## Complexity

| | Cost | Why |
|---|---|---|
| Best case | O(n log n) | The plain algorithm splits and merges every level even when the input is already sorted (then with about ½ n log₂ n comparisons). |
| Average case | O(n log n) | log₂ n levels of merging, n moves per level. |
| Worst case | O(n log n) | At most n log₂ n comparisons for any input order; there is no pivot to choose badly. |
| Extra space | O(n) | The merge needs a buffer of n slots; top-down recursion adds an O(log n) call stack. |
| Stable | Yes | On a tie the merge takes the left item first. |
| In place | No | Merging without a buffer is possible but intricate and slower (see Trade-offs). |

## When to use it

- **You need a stable sort**: a table re-sorted by one column that must keep the previous order among equal values, or a multi-key sort done as several passes.
- **You need a predictable worst case**: input that may be adversarial, or a latency budget that can't absorb an occasional quadratic run.
- **Linked lists**: merging relinks nodes, needs no random access and no buffer, which makes merge sort the usual choice there.
- **Data larger than memory**, and other sources you can only read in order (see external merge sort below).
- **Parallel and distributed sorting**: the two halves are independent, and merges stream their output.
- **Not** for tiny arrays, where insertion sort wins (library sorts switch to it below a few dozen items), and not when memory is tight and stability doesn't matter: heapsort sorts in place in O(n log n), and a tuned quicksort is usually faster on arrays of numbers.

## Trade-offs

- **Memory.** The classic array version needs n extra slots. Timsort needs at most n/2, because it copies only the smaller of the two runs it merges. Merging in place without a buffer is possible but complex and slower, so libraries rarely do it: C++'s `std::stable_sort` asks for a temporary buffer (half the input in libstdc++ and Microsoft's STL, all of it in libc++) and only falls back to an O(n log² n) method when it can't get one.
- **More data movement than quicksort.** Every level copies every item, while quicksort swaps within the array. On arrays of primitives a tuned quicksort usually wins, which is why Java sorts `int[]` with Dual-Pivot Quicksort and keeps a merge sort (TimSort) for objects, where two equal keys can belong to different records and stability matters.
- **Against [heapsort](../binary-heap/).** Both guarantee O(n log n), and heapsort needs no buffer, but it is not stable, and its jumps between parent and child slots far apart in the array use caches poorly. Merge sort reads and writes sequentially.
- **Not adaptive on its own.** Sorted input costs the same n log₂ n moves. Skipping a merge when the left run's last item is ≤ the right run's first makes sorted input linear; natural merge sort and Timsort go further and reuse the runs already in the data.
- **Overhead on small pieces.** Production versions stop splitting at a few dozen items and finish those pieces with insertion sort.

## Implementation notes

- **Python** sorts with Timsort, Tim Peters' natural merge sort behind `list.sort()` and `sorted()`, which the documentation guarantees to be stable. It finds runs that are already ascending (or descending, which it reverses), extends short runs to a minimum length (minrun, 32 to 64 items on large lists) with binary insertion sort, and only ever merges neighbouring runs, which keeps it stable. When one run keeps winning, the merge switches to *galloping*: it searches ahead exponentially and copies a whole block at once (after 7 wins in a row at first; the threshold then adapts). Python 3.11 replaced the original rules for which runs to merge next with Munro and Wild's *powersort*, and Python 3.15 picks the run lengths so that the merge tree is as balanced as possible.
- **Java** uses TimSort for `Arrays.sort(Object[])`, `Collections.sort` and `List.sort`, and Dual-Pivot Quicksort for primitive arrays. On object arrays, `Arrays.parallelSort` is a parallel sort-merge on the fork/join common pool: it sorts sub-arrays and merges them, using at most the array's size in working space.
- **JavaScript and Rust**: V8, the engine in Chrome and Node.js, replaced its quicksort with Timsort in V8 7.0 / Chrome 70 (2018), and ES2019 made a stable `Array.prototype.sort` a requirement for every engine. Rust's stable `slice::sort` is based on driftsort, a hybrid that takes its worst case and run detection from merge sort.
- **External merge sort** sorts data larger than memory in two phases: sort memory-sized chunks and write each one out as a sorted run, then merge the runs as streams, keeping the current head of every run in a [min-heap](../binary-heap/) so the next output item is always one pop away. PostgreSQL does this when a sort outgrows `work_mem`: it sorts each memory load, writes it to a temporary file as a run and, since PostgreSQL 15, merges the runs with a balanced k-way merge (earlier versions used polyphase merge); `EXPLAIN ANALYZE` then reports the sort method as `external merge` or `external sort`. Hadoop MapReduce sorts map output into spill files and merges them `mapreduce.task.io.sort.factor` streams at a time (10 by default).
- **Merging sorted streams** is common in distributed systems. A query over a [sharded](../sharding/) database that needs sorted results sorts on each shard and merges the streams at the router; Vitess keeps one row per shard in a heap and always pulls the smallest. LSM-tree storage engines such as LevelDB compact by merging sorted files into new sorted files.
- **Linked lists**: find the middle with a slow and a fast pointer, sort both halves, then merge by relinking nodes. The bottom-up version avoids recursion as well, so the extra space drops to O(1).
- **Parallel merge sort** sorts the two halves on separate cores; the final merge then becomes the bottleneck unless it is split too, by binary-searching where the middle item of one run falls in the other and merging the two parts side by side.
- **History**: Knuth credits John von Neumann with proposing merge sorting in 1945, which makes it one of the first methods proposed for sorting on a computer.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Quicksort](../quicksort/) — Partition around a pivot, smaller values left and larger right, then sort each side: fast in place, O(n²) when pivots are bad.
- [Bubble, Selection & Insertion Sort](../elementary-sorts/) — The three simple O(n²) sorts compared, and why insertion sort still runs inside fast library sorts on short runs.
- [Binary Heap & Heapsort](../binary-heap/) — A complete binary tree packed into an array keeps the smallest item on top: O(log n) push and pop, the classic priority queue.
- [Recursion & the Call Stack](../recursion/) — A function calls itself on a smaller input; each call waits on the stack until a base case returns and the answers unwind.
- [Big-O Notation](../big-o-notation/) — How an algorithm's cost grows with its input: O(1), O(log n), O(n), O(n log n) and O(n²) side by side as n grows.
- [Two Pointers](../two-pointers/) — Move two indices through an array, toward each other or one chasing the other, to solve pair and partition problems in one pass.

## Related database topics

- [Join Algorithms](../join-algorithms/) — Nested loop, hash join and merge join: how each joins two tables, what it costs, and when the planner picks it.

## References

- [Sedgewick and Wayne — Algorithms, 4th edition, 2.2 Mergesort](https://algs4.cs.princeton.edu/22mergesort/)
- [CPython — Objects/listsort.txt (Tim Peters' description of Timsort)](https://github.com/python/cpython/blob/main/Objects/listsort.txt)
- [Java SE 27 API — java.util.Arrays (sort and parallelSort)](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/Arrays.html)
- [V8 blog — Getting things sorted in V8 (2018)](https://v8.dev/blog/array-sort)
- [MIT OpenCourseWare 6.006 — Lecture 3: Insertion sort, merge sort](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-fall-2011/resources/mit6_006f11_lec03/)
- [Wolfram MathWorld — Merge Sort (von Neumann, 1945, after Knuth)](https://mathworld.wolfram.com/MergeSort.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
