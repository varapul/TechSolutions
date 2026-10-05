<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧮 Algorithms & Data Structures](../../README.md#algorithms--data-structures)

# Binary Heap & Heapsort

> A complete binary tree packed into an array keeps the smallest item on top: O(log n) push and pop, the classic priority queue.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Binary Heap &amp; Heapsort" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/binary-heap.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · A tree in an array** | A **min-heap** keeps two rules. *Order*: every parent is at most its children, so the smallest item is always the root and `peek` is O(1). *Shape*: the tree is complete, filled level by level from the left, so it packs into an array with no pointers: the children of index `i` sit at `2i + 1` and `2i + 2` and its parent at `(i − 1) // 2` (4, at index 1, has its parent at 0 and its children at 3 and 4). |
| **2 · Push: sift up** | `push(3)` appends 3 at the next free slot, index 7, which keeps the shape. It then **sifts up**: while 3 is smaller than its parent at `(i − 1) // 2` the two swap, so it passes 7, then 4, and stops under 1: 3 comparisons, 2 swaps. A complete tree of n items has ⌊log₂ n⌋ + 1 levels and each swap climbs one, so push is O(log n). |
| **3 · Pop: sift down** | `pop()` returns the root, 1. To keep the tree complete, the last item, 7, moves to the root and **sifts down**: it swaps with the smaller child while that child is smaller than it (2, then 6) and stops at index 5, which has no children: 4 comparisons, 2 swaps. Again at most one swap per level, so pop is O(log n). |
| **4 · Heapsort and uses** | Popping until the heap is empty yields 1, 2, 3, 4, 5, 6, 7, 9 in order: that is **heapsort**, n pops of O(log n) each, so O(n log n) even in the worst case, though not stable. The in-place version uses a max-heap and swaps each popped maximum into the slot that frees up at the end of the same array, and building the starting heap bottom-up takes only O(n). Heaps run priority queues and schedulers, timers, top-k queries (keep a heap of size k), merges of k sorted files and Dijkstra's shortest paths. |
<!-- END GENERATED: header -->

## The problem

A lot of software keeps asking the same question: which waiting item comes next? An event loop fires the timer that expires soonest, a job scheduler starts the task with the earliest deadline, a route planner expands the closest node it has not settled yet, and a query with `ORDER BY … LIMIT 10` keeps only its ten best rows. Items keep arriving while others leave, so sorting once is not enough, and the obvious structures are lopsided:

- a **sorted array** hands out the smallest item in O(1), but every insert shifts up to n items;
- an **unsorted list** inserts in O(1), but every removal scans all n items for the smallest;
- a **balanced search tree** does both in O(log n), but it maintains a full sorted order that a queue never reads, and pays for it with pointers and rebalancing.

A binary heap keeps only as much order as "what comes next?" needs: O(log n) to add or remove, O(1) to look at the smallest item, all inside one plain array.

## How it works

**Two rules.** A min-heap is a binary tree with

- **heap order**: every parent is less than or equal to its children, so the smallest item is always the root (a *max-heap* flips the comparison and keeps the largest on top);
- **shape**: the tree is *complete*: every level is full except the last, which fills from the left.

The shape rule is what makes heaps cheap. A complete tree has no gaps, so it can be stored level by level in an array: the root at index 0, its children at 1 and 2, theirs at 3 to 6, and so on. The links are arithmetic instead of pointers: the children of index `i` are at `2i + 1` and `2i + 2`, and its parent is at `(i − 1) // 2`. (Books that count from 1 use `2i`, `2i + 1` and `i // 2`.) The tree is always as short as it can be: n items fill ⌊log₂ n⌋ + 1 levels, 4 for the 8 items in the diagram.

**Heap order is not search-tree order.** A [binary search tree](../binary-search-tree/) orders every node against whole subtrees, smaller keys to the left and larger to the right, so a lookup follows one path and an in-order walk lists the keys sorted. A heap only orders each parent against its own children. In the diagram 4 sits above 7 and 5 but beside the smaller 2, and nothing orders 4's subtree against 2's. So a heap cannot tell whether some x is present without possibly visiting every node, and cannot list its items in order without popping them. In return it is always balanced and needs nothing but the array.

**Push: sift up.** Append the new item at index n, the next free slot, which keeps the shape. Now only one pair can break heap order: the new item and its parent. While the item is smaller than its parent, swap the two and move up; stop at the root or when the parent is smaller or equal. At every step the heap is valid except, possibly, between the moving item and its parent, so when the loop stops the whole heap is valid again. That is one comparison and at most one swap per level: O(log n) in [Big-O](../big-o-notation/) terms. In the diagram 3 enters at index 7, passes 7 and then 4, and stops under 1: 3 comparisons, 2 swaps.

**Pop: sift down.** The smallest item is `a[0]`. Taking it leaves a hole at the top, so move the last item into the root, which keeps the tree complete, and let it sink: find the smaller of its children, and if that child is smaller than the item, swap them and continue one level down. It has to be the *smaller* child, because promoting the larger one would put it above its smaller sibling. Now the heap is valid except, possibly, between the moving item and its children, and the loop stops at a leaf or when both children are at least as large. Two comparisons per level, so at most about 2 log₂ n. The diagram's pop returns 1, moves 7 to the root and sinks it past 2 and then 6 to index 5, a leaf: 4 comparisons, 2 swaps.

**Peek and replace.** `peek` just reads `a[0]`. Two combined operations do the work of a push and a pop with a single sift. *Pushpop* (push x, then pop) returns x at once when it is no larger than the root; otherwise it returns the root, puts x in its place and sifts it down. *Replace* (pop, then push) always returns the root and sifts the new item down from the top, so the size never changes and the item returned may be larger than the one added. Python's `heapq` calls them `heappushpop` and `heapreplace`.

**Heapify in O(n).** Building a heap with n pushes costs O(n log n) in the worst case, when every new item is a new minimum and climbs to the root. The bottom-up construction known as Floyd's method does better: read the array as a complete tree whose order is still arbitrary, and sift down every parent, from the last one (index n // 2 − 1) back to the root. When a node's turn comes, both subtrees below it are already heaps, so one sift-down fixes its whole subtree. Most of the work is cheap because most nodes live near the bottom: half the nodes are leaves and never move, a quarter can sink one level at most, an eighth two levels, and so on. That adds up to at most n · (1/4 + 2/8 + 3/16 + …) = n swaps, because the series sums to 1, and at most twice as many comparisons. On a million items in descending order, the worst case for pushes, n pushes made 17,951,445 swaps in our test and bottom-up heapify made 999,988.

**Heapsort.** Popping everything returns the items in order, and that is all heapsort is: heapify in O(n), then n pops of O(log n) each, so O(n log n) for any input. J. W. J. Williams published it in 1964 together with the array-based heap itself, and Robert W. Floyd improved it in *Treesort 3* the same year. The practical form works in place with a *max-heap*: heapify the array, then repeatedly swap the root (the largest item) with the last item of the heap, shrink the heap by one and sift the new root down. The sorted part grows from the back of the array while the heap shrinks in front of it, so the extra space is O(1). It is not stable: the long-distance swaps reorder equal keys.

## Code

```python
class MinHeap:
    """A binary min-heap in a plain list: the smallest item is always a[0]."""

    def __init__(self, items=()):
        self.a = list(items)
        for i in reversed(range(len(self.a) // 2)):    # bottom-up heapify: O(n)
            self.sift_down(i)

    def __len__(self):
        return len(self.a)

    def peek(self):
        return self.a[0]                       # O(1); IndexError when empty

    def push(self, x):
        self.a.append(x)                       # the next free slot keeps the tree complete
        self.sift_up(len(self.a) - 1)

    def pop(self):
        last = self.a.pop()                    # IndexError when empty
        if not self.a:
            return last
        top, self.a[0] = self.a[0], last       # the last item takes over the root
        self.sift_down(0)
        return top

    def sift_up(self, i):                      # swap with the parent while smaller
        a = self.a
        while i > 0:
            p = (i - 1) // 2
            if a[p] <= a[i]:
                break
            a[i], a[p] = a[p], a[i]
            i = p

    def sift_down(self, i):                    # swap with the smaller child while larger
        a, n = self.a, len(self.a)
        while 2 * i + 1 < n:
            c = 2 * i + 1
            if c + 1 < n and a[c + 1] < a[c]:
                c += 1
            if a[i] <= a[c]:
                break
            a[i], a[c] = a[c], a[i]
            i = c


h = MinHeap([1, 4, 2, 7, 5, 6, 9])            # already a heap, so heapify moves nothing
h.push(3)
print(h.a)                                     # [1, 3, 2, 4, 5, 6, 9, 7]
print(h.pop(), h.a)                            # 1 [2, 3, 6, 4, 5, 7, 9]
print([h.pop() for _ in range(len(h))])        # [2, 3, 4, 5, 6, 7, 9]

h = MinHeap([5, 9, 1, 7, 3, 8, 2])             # heapsort by popping
print([h.pop() for _ in range(len(h))])        # [1, 2, 3, 5, 7, 8, 9]
```

Both sifts stop on a tie (`<=`), which saves swaps. Tested against `heapq` on random data, the list matches `heapq`'s exactly after pushes, pops and heapify when the keys are distinct; with duplicate keys a pop can leave equal keys in different places, but both always pop the same values. Empty heaps raise `IndexError` like `heapq`. The sort above builds a second list; the in-place version keeps a max-heap inside the input list, as described under How it works.

## Complexity

| Operation | Time | Why |
|---|---|---|
| `peek` | O(1) | The smallest item is always `a[0]`. |
| `push` | O(log n) | One comparison per level on the way up, and n items fill only ⌊log₂ n⌋ + 1 levels. |
| `pop` | O(log n) | Two comparisons per level on the way down. |
| pushpop, replace | O(log n) | One sift instead of two. |
| heapify (bottom-up) | O(n) | Most nodes sit near the bottom and sink a level or two at most: fewer than n swaps. |
| n pushes | O(n log n) | Worst case, when each new item is a new minimum; random input is cheaper on average. |
| find x, list in order | O(n), O(n log n) | Heap order says nothing about siblings, so there is no shortcut. |

Heapsort:

| | Cost | Why |
|---|---|---|
| Best case | O(n log n) | With distinct keys most pops still sink the moved item most of the way down. Only many equal keys help: all-equal keys take O(n) when the sift stops on ties. |
| Average case | O(n log n) | About 2n log₂ n comparisons. |
| Worst case | O(n log n) | No input is bad for it: about 2n log₂ n comparisons at most. |
| Extra space | O(1) | The in-place version keeps the heap inside the input array and needs no recursion; the push-and-pop version above uses a second list of n items. |
| Stable | No | Swaps between distant slots reorder equal keys. |
| In place | Yes | Heap in front, sorted items growing at the back. |

## When to use it

- **You repeatedly need the smallest (or largest) item of a set that keeps changing**: timers, schedulers, event-driven simulations, job queues inside one process.
- **Graph searches that grow a frontier by cost**: Dijkstra's shortest paths, Prim's minimum spanning tree and A* search all pop the cheapest frontier node next.
- **Top-k over a stream**: keep a min-heap of the k largest items seen so far, and replace its root whenever a larger item arrives. That is O(n log k) time and O(k) memory, however long the stream.
- **Running medians**: a max-heap holds the lower half and a min-heap the upper half; rebalance so their sizes differ by at most one, and the median sits on top of one or both.
- **Merging k sorted streams** (log files, sorted runs of an external sort, results from shards): a heap of the k current heads yields the next item in O(log k), N items in O(N log k).
- **Sorting with a hard O(n log n) bound and O(1) extra space**, when stability doesn't matter.
- **Not** for finding items by key (use a [hash table](../hash-table/)), for walking items in order or answering range queries (use a search tree or a sorted array), or for priorities between services, where the [Priority Queue](../priority-queue/) pattern relies on broker features or separate queues rather than an in-memory heap.

## Trade-offs

- **Equal keys come out in no particular order.** A heap is not stable, and neither are the library queues built on one: Java's `PriorityQueue` breaks ties arbitrarily, and .NET's `PriorityQueue` doesn't promise first-in, first-out for equal priorities. When order matters, add an insertion counter to the key, as the `heapq` documentation does with `(priority, count, task)` entries.
- **No search, and no decrease-key on its own.** To change an item's priority you need its position: keep a map from item to index and update it on every swap, then sift up or down after the change, O(log n). Go's `heap.Fix` works this way, with each item storing its own index, and so does Java's `ScheduledThreadPoolExecutor`, whose task queue records each task's heap index so that cancelling a task costs O(log n) instead of a linear search. The lazy alternative pushes a new entry with the new priority and marks the old one stale, then skips stale entries when they reach the top. That is simpler but lets the heap grow with every update: Dijkstra's algorithm then holds up to one entry per edge, still O(E log V) time because log E ≤ 2 log V.
- **Locality.** Node i's children sit at 2i + 1 and 2i + 2, so once the heap is larger than the cache, every level of a deep sift lands on a different part of the array. A **d-ary heap**, with 4 or 8 children per node, is shallower: pushes get cheaper, pops compare more children per level, and siblings share cache lines. Go's runtime keeps timers in 4-ary heaps and .NET's `PriorityQueue` is a 4-ary heap.
- **Heapsort against quicksort and merge sort.** Heapsort guarantees O(n log n) with O(1) extra space, but it is not stable, and it usually loses to a well-tuned [quicksort](../quicksort/) on arrays, whose partition loops scan memory in order. That is why libraries use it as a safety net: introsort runs quicksort and switches to heapsort when the recursion gets too deep. [Merge sort](../merge-sort/) is stable and reads sequentially but needs O(n) extra space; the [simple sorts](../elementary-sorts/) only win on tiny inputs.
- **Fancier heaps trade the array away.** Fibonacci heaps (Fredman and Tarjan) make decrease-key O(1) amortized, which lowers Dijkstra's bound to O(E + V log V), but they link their nodes with pointers instead of packing them into one array.

## Implementation notes

- **Python**: `heapq` turns a plain list into a min-heap: `heappush`, `heappop`, `heappushpop`, `heapreplace` and a linear-time `heapify`, with `heap[0]` as the smallest item. Python 3.14 added max-heap versions (`heapify_max`, `heappush_max`, `heappop_max`, `heappushpop_max` and `heapreplace_max`); before that the usual trick was to negate the keys. `merge`, `nsmallest` and `nlargest` are built on heaps too. Its pop is a variant: instead of stopping early, it promotes the smaller child all the way down to a leaf, puts the last item there and sifts it back up, because the item moved to the root is usually large. The comments in its source report about 8,700 instead of 15,000 comparisons for 1,000 pops on random data. `asyncio` keeps the callbacks scheduled with `call_later` and `call_at` in a `heapq` ordered by due time.
- **Java**: `PriorityQueue` is an array-backed binary heap with the same index arithmetic as above; the head is the least element by natural order or a `Comparator`. `offer` and `poll` are O(log n), `peek` is O(1), `remove(Object)` and `contains` are linear, and it is not thread-safe (`PriorityBlockingQueue` is).
- **C++**: `std::priority_queue` wraps a container (a `std::vector` by default) and keeps the *largest* item on top, because its default comparator is `std::less`; pass `std::greater` for a min-heap. The underlying algorithms work on any random-access range: `std::make_heap` (at most 3n comparisons), `push_heap`, `pop_heap` (at most 2 log n) and `sort_heap`. There is no decrease-key. `std::sort` must be O(n log n) in the worst case since C++11, which libraries meet with introsort and similar hybrids (LLVM's libc++ only since LLVM 14).
- **Go**: `container/heap` works on your own slice type through `heap.Interface` (`sort.Interface` plus `Push` and `Pop`) and keeps the minimum by `Less` at index 0. `Init` is O(n); `Push`, `Pop`, `Remove` and `Fix` are O(log n). Go's unstable sorts (`sort.Sort`, `slices.Sort`) use pattern-defeating quicksort, which falls back to heapsort when too many pivots turn out badly.
- **.NET**: `PriorityQueue<TElement, TPriority>` is an array-backed 4-ary min-heap that dequeues the lowest priority first. `Array.Sort` is an introsort: insertion sort for partitions of up to 16 items, heapsort once the number of partitions passes 2 log n, quicksort otherwise.
- **Event loops and schedulers**: libuv, the event loop under Node.js, keeps its timers in a binary min-heap, and Java's `ScheduledThreadPoolExecutor` orders delayed tasks in a heap, as described under Trade-offs.
- **Databases**: when a PostgreSQL sort has a `LIMIT` and the input grows past twice the limit, or past its memory budget, it switches to a bounded heap that keeps only the best rows, and `EXPLAIN ANALYZE` reports the sort method as `top-N heapsort`. External sorts merge their sorted runs through a heap of run heads; see [Merge Sort](../merge-sort/).
- **Routing**: link-state protocols such as OSPF build each router's shortest-path tree with Dijkstra's algorithm (RFC 2328), which needs exactly a heap's operations: pop the closest unsettled router, then lower its neighbours' tentative distances.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Priority Queue](../priority-queue/) — Urgent messages are processed ahead of routine ones.
- [Quicksort](../quicksort/) — Partition around a pivot, smaller values left and larger right, then sort each side: fast in place, O(n²) when pivots are bad.
- [Merge Sort](../merge-sort/) — Split the list until single items remain, then merge sorted halves back together: O(n log n) every time, and stable.
- [Bubble, Selection & Insertion Sort](../elementary-sorts/) — The three simple O(n²) sorts compared, and why insertion sort still runs inside fast library sorts on short runs.
- [Binary Search Tree](../binary-search-tree/) — Smaller keys left, larger right: O(log n) search and insert while the tree stays balanced, O(n) once it degrades into a list.
- [Big-O Notation](../big-o-notation/) — How an algorithm's cost grows with its input: O(1), O(log n), O(n), O(n log n) and O(n²) side by side as n grows.
- [Dijkstra's Shortest Path](../dijkstra/) — Settle the closest unsettled node, relax its edges, repeat: shortest paths from one source when no edge weight is negative.

## References

- [J. W. J. Williams — Algorithm 232: Heapsort (Communications of the ACM 7(6), 1964)](https://dl.acm.org/doi/10.1145/512274.3734138)
- [Robert W. Floyd — Algorithm 245: Treesort 3 (Communications of the ACM 7(12), 1964)](https://dl.acm.org/doi/10.1145/355588.365103)
- [Sedgewick and Wayne — Algorithms, 4th edition, 2.4 Priority Queues](https://algs4.cs.princeton.edu/24pq/)
- [Python documentation — heapq: Heap queue algorithm](https://docs.python.org/3/library/heapq.html)
- [Java SE 27 API — java.util.PriorityQueue](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/PriorityQueue.html)
- [cppreference — std::priority_queue](https://en.cppreference.com/cpp/container/priority_queue)
- [cppreference — std::make_heap](https://en.cppreference.com/cpp/algorithm/make_heap)
- [Go standard library — container/heap](https://pkg.go.dev/container/heap)
- [Microsoft Learn — PriorityQueue<TElement,TPriority> (.NET)](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.priorityqueue-2)
- [Microsoft Learn — Array.Sort (introsort with a heapsort fallback)](https://learn.microsoft.com/en-us/dotnet/api/system.array.sort)
- [PostgreSQL source — tuplesort.c (bounded heap for ORDER BY … LIMIT)](https://github.com/postgres/postgres/blob/master/src/backend/utils/sort/tuplesort.c)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
