<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧮 Algorithms & Data Structures](../../README.md#algorithms--data-structures)

# Two Pointers

> Move two indices through an array, toward each other or one chasing the other, to solve pair and partition problems in one pass.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Two Pointers" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/two-pointers.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Every pair: O(n²)** | The obvious way tries every pair with two nested loops: (0, 1), (0, 2) and so on, row by row, and each failed pair dims its cell in the grid. 11 + 14 = 25 turns up on check 23. Eight values make 8 × 7 / 2 = 28 pairs and a million values about 500 billion, so the work grows as **O(n²)**. |
| **2 · Squeeze from both ends** | Two pointers start at the ends of the **sorted** array, `lo` at the smallest value and `hi` at the largest. When `a[lo] + a[hi]` is too small, only a bigger value can help, so `lo` moves right; when it is too big, `hi` moves left. The sums go 23, 24, 26, 23, 26, 22 and then 25: 11 + 14 is found after **7 checks instead of 23**. |
| **3 · Why nothing is missed** | When `a[lo] + a[hi]` is too small, `a[lo]` is too small even with the largest value still in play, so its whole row of pairs is ruled out; when the sum is too big, the column of `a[hi]` is. The checks clear 7, 6, 5, 4, 3 and 2 pairs and then hit the answer: 7 + 6 + 5 + 4 + 3 + 2 + 1 = 28, every pair accounted for. That is **O(n)** instead of O(n²), and it works only because the array is sorted. |
| **4 · Same direction: dedupe** | The pointers can also move the same way. To remove duplicates in place, a read pointer `r` visits every cell after the first and a write pointer `w` marks where the next new value goes: whenever `a[r]` differs from the last kept value, it is copied to `w` and `w` advances, so one pass and 4 writes leave 1 2 3 4 5 in the first 5 cells with O(1) extra space. Two pointers also reverse an array in place, merge two sorted lists (merge sort, database merge joins), partition around a pivot (quicksort) and, as slow and fast pointers, detect a cycle in a linked list (Floyd's tortoise and hare). |
<!-- END GENERATED: header -->

## The problem

Many array questions are about pairs: two values that add up to a target, an item and its duplicate, the two ends of a range to reverse. The direct answer tries every pair with two nested loops, and n values make n(n − 1)/2 pairs: 28 for the 8 values in the diagram, about 500 billion for a million. A hash set brings pair sum down to a single pass, but it needs O(n) extra memory and ignores any order the data already has.

When the data has an order, one comparison can rule out much more than one pair. Two pointers turn that into a single pass: two indexes start at chosen places, every comparison moves one of them, and neither ever moves back, so between them they make at most about n moves. The only extra memory is the two indexes.

## How it works

The technique fits when each comparison proves that the item under one of the pointers can't belong to any answer still possible, so that pointer can move past it for good. Sorted input is the usual source of that proof, but not the only one.

For pair sum on a sorted array, `lo` starts at the first index and `hi` at the last. The **invariant**: if some pair adds up to the target, both of its indexes lie in `[lo, hi]`.

1. Compute `s = a[lo] + a[hi]`. If it equals the target, return `(lo, hi)`.
2. If `s` is too small: `a[hi]` is the largest value still in play, so `a[lo]` plus any value in play is at most `s`, still too small. No remaining pair uses `lo`, so `lo += 1`.
3. If `s` is too big: `a[lo]` is the smallest value in play, so any value in play plus `a[hi]` is at least `s`. No remaining pair uses `hi`, so `hi -= 1`.
4. When `lo` reaches `hi`, the range holds no pair, so there is none.

Every step keeps the invariant and shrinks the gap by one, so there are at most n − 1 checks. The pair grid in the diagram shows the bookkeeping: each move retires one value together with its whole row or column of pairs, and the rows and columns cleared add up to every pair, 7 + 6 + 5 + 4 + 3 + 2 + 1 = 28.

### Opposite ends

Pointers that start at both ends and meet in the middle suit questions about pairs and symmetry:

- **Pair sum**, as above. **Closest pair sum** makes the same moves and keeps the best sum seen, and **counting pairs with a sum at most k** adds `hi − lo` whenever `a[lo] + a[hi] ≤ k` (`a[lo]` pairs with everything up to `hi`) and moves `lo`, and otherwise moves `hi`.
- **Three-sum** (three values that add up to `t`): sort once, then fix each value `a[i]` in turn and run pair sum on the values after it with the target `t − a[i]`. That is n passes of O(n), O(n²) in all, where trying every triple costs O(n³). Skipping repeated values keeps duplicate triples out of the answer.
- **Palindromes**: compare `s[lo]` with `s[hi]` and move both inward; the first mismatch settles it.
- **Reversing in place**: swap `a[lo]` and `a[hi]` and move both inward until they meet, ⌊n/2⌋ swaps.
- **The container with the most water**: from a row of wall heights, pick the two walls that hold the most water, the distance between them times the shorter wall. The heights aren't sorted, yet the moves are still safe. Pairing the shorter wall with any wall further in gives less width and no more height, so no container that uses the shorter wall can beat the current one, and its pointer moves inward.

### Same direction

Pointers that both move forward suit rewriting a sequence in one pass, or walking two sequences side by side:

- **Removing duplicates** (step 4): `r` reads every item and `w` marks where the next kept item goes. Because `w` never passes `r`, a write can't overwrite an item that hasn't been read yet. The same loop **removes** every copy of a value or **filters** with any test: copy the item to `w` when it passes, skip it otherwise, and return `w` as the new length.
- **Partitioning**: Lomuto's partition in [Quicksort](../quicksort/) scans with one index and keeps the end of the small values with the other, so both move right; Hoare's original scheme moves two indexes toward each other instead. Dijkstra's *Dutch national flag* problem splits values into three groups (less than, equal to and greater than a pivot) in a single pass with three indexes.
- **Merging**: one pointer per sorted input; take the smaller of the two current items and advance that pointer. It is the merge step of [Merge Sort](../merge-sort/) and of a database merge join.
- **Slow and fast pointers** walk a linked list at different speeds. When the fast one (two links per step) reaches the end, the slow one (one link per step) is at the middle, and the same pair finds cycles (below). A variant keeps the speeds equal but starts one pointer k nodes ahead: when it reaches the end, the other is on the k-th node from the end.

### Slow and fast pointers: finding a cycle

A linked list can loop back on itself, and so can any sequence made by applying a function again and again (x, f(x), f(f(x)), …). A set of visited nodes finds the loop with O(n) extra memory; Floyd's *tortoise and hare* needs two references:

- The slow pointer follows one link per step and the fast pointer two. Without a cycle, the fast pointer runs off the end. With one, both end up inside it, and from then on the fast pointer gains one node per step, so it lands on the slow one before the slow one has gone round once. If μ nodes come before the cycle and the cycle has λ nodes, they meet inside the cycle within μ + λ steps of the slow pointer.
- **Where the cycle starts**: at the meeting, the slow pointer has taken a multiple of λ steps. Put one pointer back at the head and move both one link at a time. After μ steps the first is at the cycle's first node, and the second, a whole number of laps further along the same path, is on that node too, so that is where they meet. They can't meet earlier, because until then one is outside the cycle and the other inside it.
- **How long the cycle is**: from the meeting point, walk one pointer round until it comes back, counting the links.

Donald Knuth credits the method to Robert W. Floyd in volume 2 of *The Art of Computer Programming*. Richard Brent published a faster variant in 1980. His slow pointer waits in place while the fast one takes single steps, and whenever the number of steps since the last jump reaches a power of two (1, 2, 4, 8, …), the slow pointer jumps to where the fast one is. When the fast pointer lands on the waiting one, the steps since the last jump are the cycle length. Each step follows one link where a step of Floyd's follows three. Brent reports that his method finds cycles about 36% faster on average, and he used it to build a version of Pollard's rho method for factoring integers, which rests on cycle detection, that runs about 24% faster.

### Sort first, or use a hash set?

Two pointers need the order. On unsorted input, sorting first costs O(n log n), which then outweighs the O(n) pass, and the sort moves values away from their original indexes (sort `(value, index)` pairs to keep them). For one pair-sum query on unsorted data, a hash set does better: walk the values once and, for each `x`, check whether `target − x` has already been seen before adding `x`. That is O(n) expected time, but O(n) extra memory, and it finds exact matches only (see [Hash Table](../hash-table/)). Two pointers win when the data is already sorted or has to be sorted anyway, when memory is tight, and for questions a hash can't answer, such as the closest sum or the number of pairs under a bound. [Binary Search](../binary-search/) sits in between: for each `a[i]`, search the rest of the sorted array for `target − a[i]`, O(n log n) in all.

A database planner chooses among the same three shapes when it joins two tables. PostgreSQL documents three join strategies: a **nested loop join** scans the right input once for every row of the left (every pair), a **merge join** sorts both inputs on the join key, or reads them in that order from an index, and scans the two in parallel (two pointers), and a **hash join** loads the right input into a hash table and probes it with each row of the left.

## Code

```python
def pair_sum(a, target):
    """Return indexes (i, j) with i < j and a[i] + a[j] == target in sorted a, or None."""
    lo, hi = 0, len(a) - 1
    while lo < hi:
        s = a[lo] + a[hi]
        if s == target:
            return lo, hi
        if s < target:
            lo += 1          # a[lo] is too small even with the largest value left
        else:
            hi -= 1          # a[hi] is too big even with the smallest value left
    return None


def dedupe_sorted(a):
    """Keep one copy of each value at the front of sorted a, in place; return how many."""
    if not a:
        return 0
    w = 1                    # a[:w] holds the values kept so far
    for r in range(1, len(a)):
        if a[r] != a[w - 1]: # a new value: copy it to the next free slot
            a[w] = a[r]
            w += 1
    return w


class Node:
    def __init__(self, value, next=None):
        self.value, self.next = value, next


def has_cycle(head):
    """Floyd's tortoise and hare: slow moves one link, fast moves two."""
    slow = fast = head
    while fast is not None and fast.next is not None:
        slow = slow.next
        fast = fast.next.next
        if slow is fast:     # fast can only catch up with slow inside a cycle
            return True
    return False             # fast reached the end of the list


a = [2, 3, 5, 8, 11, 14, 18, 21]
print(pair_sum(a, 25), pair_sum(a, 4))      # (4, 5) None
d = [1, 1, 2, 3, 3, 3, 4, 5, 5]
k = dedupe_sorted(d)
print(k, d[:k])                             # 5 [1, 2, 3, 4, 5]
nodes = [Node(v) for v in range(5)]
for x, y in zip(nodes, nodes[1:]):
    x.next = y
print(has_cycle(nodes[0]))                  # False
nodes[-1].next = nodes[2]                   # 4 -> 2 closes a loop
print(has_cycle(nodes[0]))                  # True
```

`pair_sum` was checked against a brute-force search on 20,000 random sorted lists with duplicates and negative values (any pair the brute force finds counts as a right answer, and `None` must mean there is none), plus an empty list, a single item, a pair of equal values and a target with no solution. `dedupe_sorted` was checked against `sorted(set(a))` on 20,000 random lists, including empty, one-item and all-equal ones, and `has_cycle` against a walk with a set of visited nodes on 20,000 random lists with and without a loop, including a node that points to itself.

## Complexity

| Function | Best | Average | Worst | Extra space |
|---|---|---|---|---|
| `pair_sum` on sorted input | O(1): the first sum is the target | O(n): one pointer moves per check | O(n): at most n − 1 checks, as each one shrinks `hi − lo` by one | O(1): two indexes |
| `pair_sum` with a sort first | O(n log n): the sort dominates | O(n log n) | O(n log n) | Whatever the sort needs: O(n) for Python's `sorted()`, which builds a new list |
| `dedupe_sorted` | O(n): it reads every item once | O(n) | O(n): n − 1 comparisons and at most n − 1 writes | O(1): two indexes; it works in place |
| `has_cycle` | O(n): without a cycle the fast pointer needs about n/2 steps to run off the end, and with one the slow pointer covers at least half the nodes before they meet | O(n) | O(n): they meet within μ + λ ≤ n steps of the slow pointer | O(1): two references |

`pair_sum` and `has_cycle` only read, so stable and in place don't apply to them. `dedupe_sorted` rewrites the list in place and keeps the first copy of each value, in order.

## When to use it

- Sorted arrays, or data you sort once and query many times: pair and triple sums, closest sums, counting pairs under a bound, intersecting or merging two sorted lists.
- Rewriting an array in place in one pass: removing duplicates or unwanted items, compacting, partitioning, reversing.
- Linked lists, which have no index to jump to: the middle node, the k-th node from the end, cycle detection.
- Any search where a comparison proves that the item at one end can't be part of a better answer, as with the water container.
- Not when no comparison lets you drop one side: unsorted input where sorting costs more than it saves, or a question that needs every pair (the output alone can hold O(n²) pairs). When the answer depends on everything between the two pointers, such as the sum of a contiguous run, both ends move forward and the sliding window is the better fit.

## Trade-offs

- **The order has to be there.** Sorting first costs O(n log n) and moves items away from their original indexes. For a single exact-match query on unsorted data, a hash set's O(n) expected time beats sorting.
- **Duplicates need a decision.** `pair_sum` stops at the first matching pair. Listing every matching pair means counting runs of equal values on each side, and the list itself can be O(n²) long: all-equal input matches every pair.
- **Opposite ends need backward steps.** `hi` moves left, which a singly linked list can't do, so pair sum there needs an array or a doubly linked list. The same-direction patterns (slow and fast, merging) only ever step forward.
- **Compaction leaves a tail.** `dedupe_sorted` returns the new length and leaves stale values after it, as C++'s `std::unique` does. Trim with `del a[k:]`, or use only the first k items.
- **Off-by-one and overflow.** `while lo < hi` keeps the two indexes distinct; `<=` would let an item pair with itself. With fixed-width integers, `a[lo] + a[hi]` can overflow on large values, the trap behind binary search's midpoint bug, so widen the type.

## Implementation notes

- **Merging sorted data:** the merge step of [Merge Sort](../merge-sort/) holds one index per half. CPython's `list.sort` is an adaptive, natural merge sort: it merges neighbouring sorted runs with a pointer into each, copying the smaller head to the output and galloping ahead when one run keeps winning ([listobject.c](https://github.com/python/cpython/blob/main/Objects/listobject.c)).
- **Merge joins:** PostgreSQL's merge join keeps a cursor in each sorted input and advances whichever side holds the smaller key ([planner docs](https://www.postgresql.org/docs/current/planner-optimizer.html)). Duplicates are the subtle part. When the next outer row repeats a key, the inner cursor has to return to the first inner row with that key, so the executor marks that position and restores it ([nodeMergejoin.c](https://github.com/postgres/postgres/blob/master/src/backend/executor/nodeMergejoin.c)).
- **Partitioning:** quicksort partitions with two indexes, Lomuto's moving in the same direction and Hoare's toward each other, and three-way partitioning (the Dutch national flag) keeps quicksort fast on inputs with many equal keys.
- **In-place reversal:** CPython's `list.reverse()` calls a small helper, `reverse_slice`, that swaps the two ends and steps both inward until they meet. `list.sort` uses the same helper to turn each descending run it finds into an ascending one, and for `reverse=True` it reverses the list before and after a stable forward sort, which keeps equal items in their original order. Go's `slices.Reverse` reverses a slice in place.
- **Compaction:** C++'s `std::unique` keeps the first item of each run of equal items, makes exactly n − 1 comparisons, and returns the new logical end; the items after it are left in a valid but unspecified state, so a call to the container's `erase` usually follows. Go's `slices.Compact` does the same and zeroes the leftover tail. In CPython, deleting an extended slice such as `del a[::2]` compacts the list in one pass: for each deleted item it slides the block of kept items after it down by the number deleted so far, then shrinks the list.
- **Cycle detection:** Floyd's and Brent's algorithms find the period of any sequence made by applying a function repeatedly in O(1) memory, which is what Pollard's rho method needs, and they check linked structures for loops without marking nodes.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Binary Search](../binary-search/) — Halve a sorted range with every check: about 20 steps find one item among a million, where a scan may need a million.
- [Sliding Window](../sliding-window/) — Slide a window along a sequence, adding the item that enters and dropping the one that leaves, instead of re-scanning each window.
- [Merge Sort](../merge-sort/) — Split the list until single items remain, then merge sorted halves back together: O(n log n) every time, and stable.
- [Quicksort](../quicksort/) — Partition around a pivot, smaller values left and larger right, then sort each side: fast in place, O(n²) when pivots are bad.
- [Hash Table](../hash-table/) — Hash each key straight to a bucket for O(1) average lookups; colliding keys share a bucket, and the table grows as it fills.
- [Bubble, Selection & Insertion Sort](../elementary-sorts/) — The three simple O(n²) sorts compared, and why insertion sort still runs inside fast library sorts on short runs.
- [Big-O Notation](../big-o-notation/) — How an algorithm's cost grows with its input: O(1), O(log n), O(n), O(n log n) and O(n²) side by side as n grows.

## References

- [Sedgewick and Wayne — Algorithms, 4th edition, 2.2 Mergesort](https://algs4.cs.princeton.edu/22mergesort/)
- [Sedgewick and Wayne — Algorithms, 4th edition, 2.3 Quicksort (partitioning and Dijkstra's 3-way partitioning)](https://algs4.cs.princeton.edu/23quicksort/)
- [NIST Dictionary of Algorithms and Data Structures — Dutch national flag](https://xlinux.nist.gov/dads/HTML/DutchNationalFlag.html)
- [Richard P. Brent — An improved Monte Carlo factorization algorithm (BIT 20, 1980)](https://maths-people.anu.edu.au/~brent/pub/pub051.html)
- [Peter Gammie — The Tortoise and Hare Algorithm (Archive of Formal Proofs; Floyd's method as credited by Knuth, and Brent's)](https://isa-afp.org/entries/TortoiseHare.html)
- [PostgreSQL documentation — Planner/Optimizer (nested loop, merge and hash joins)](https://www.postgresql.org/docs/current/planner-optimizer.html)
- [PostgreSQL source — nodeMergejoin.c (merge join with mark and restore)](https://github.com/postgres/postgres/blob/master/src/backend/executor/nodeMergejoin.c)
- [CPython source — Objects/listobject.c (reverse_slice, run merging, slice deletion)](https://github.com/python/cpython/blob/main/Objects/listobject.c)
- [cppreference — std::unique](https://en.cppreference.com/cpp/algorithm/unique)
- [Go standard library — slices.Compact](https://pkg.go.dev/slices#Compact)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
