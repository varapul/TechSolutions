<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧮 Algorithms & Data Structures](../../README.md#algorithms--data-structures)

# Greedy Algorithms

> Take the choice that looks best right now and never revisit it: optimal for some problems, quietly wrong for others.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Greedy Algorithms" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/greedy-algorithms.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Take the biggest that fits** | To make 63 from coins of 25, 10, 5 and 1, the greedy rule takes the largest coin that still fits, again and again: 25, 25, then 10 because 25 > 13, then 1, 1, 1 because 10 and 5 are both more than 3. That is six coins, and a search over every combination confirms that nothing uses fewer. Coin systems like this one, where greedy is optimal for every amount, are called *canonical*. |
| **2 · Greedy can be wrong** | With coins 1, 3 and 4, the same rule pays 6 as 4, 1, 1: three coins, where 3 + 3 needs two. Taking the 4 looked best and could never be taken back, and everything after it was forced. Knowing when greedy is right takes a proof; when it is not, [dynamic programming](../dynamic-programming/) checks every option without repeating work. |
| **3 · The right rule, proven** | One meeting room, nine requests, back to back allowed. Earliest start first books the 8:30–16:00 Workshop, and nothing else fits: **1 meeting**. Earliest end first books A, C, E, F and H: **5**, the most possible, as a check of all 512 subsets confirms. Finishing first always leaves the most room for the rest, and an *exchange argument* turns that idea into a proof. |
| **4 · Greedy inside gzip** | Huffman coding repeatedly merges the two least frequent symbols: c + d = 2, b + r = 4, then 2 + 4 = 6 and a + 6 = 11. Reading 0 for left and 1 for right gives a = 0, c = 100, d = 101, b = 110 and r = 111, so abracadabra takes **23 bits instead of 33** with fixed 3-bit codes. DEFLATE (gzip, ZIP and PNG) uses Huffman codes; [Dijkstra's shortest paths](../dijkstra/), Kruskal's and Prim's minimum spanning trees, shortest job first and least-loaded [load balancing](../load-balancing/) are greedy too, the last one a heuristic rather than a proof. |
<!-- END GENERATED: header -->

## The problem

Many optimization problems are a chain of decisions: which coin to hand over next, which meeting to accept, which two subtrees to join. Trying every combination of decisions finds the best answer, but the number of combinations grows exponentially. A **greedy algorithm** makes the decision that looks best right now, commits to it and moves on. It never goes back, so it tends to be short and fast, often a sort followed by a single pass.

The risk hides in "looks best right now". The rule that pays 63 cents with the fewest coins pays 6 badly when the coins are 1, 3 and 4, and in neither case does the algorithm notice anything. A greedy algorithm is only as good as the argument that its rule can't paint it into a corner, so most of the work is knowing which problems have such an argument.

## How it works

Every greedy algorithm runs the same loop:

1. **Choose** by a fixed rule: the largest coin that still fits, the meeting that ends first, the two least frequent symbols.
2. **Commit:** the choice goes into the answer and never comes out again.
3. **Shrink** the problem: less money to pay, fewer meetings that still fit, one tree fewer.

To make "the best choice now" cheap to find, the algorithm either sorts its input once by the rule (coins by value, meetings by end time) or keeps the candidates in a priority queue when the best choice changes as it goes (Huffman's merged trees, Dijkstra's tentative distances, the edges leaving Prim's tree). The sort or the queue usually sets the running time.

### When greedy is optimal

A greedy algorithm returns an optimal answer when the problem has two properties, in the terms used by Cormen, Leiserson, Rivest and Stein's *Introduction to Algorithms*:

- **The greedy-choice property:** some optimal solution starts with the greedy choice, so committing to it can't rule out the best answer.
- **Optimal substructure:** what is left after the choice is a smaller problem of the same kind, and the greedy choice plus an optimal answer to that smaller problem is optimal for the whole.

[Dynamic Programming](../dynamic-programming/) relies on optimal substructure too, but it doesn't know which first choice is safe, so it solves the subproblem behind every option and keeps the best one; that is how it pays 6 with 3 + 3. [Backtracking](../backtracking/) also tries options, and undoes the ones that lead nowhere. Greedy follows a single option, which makes it faster, and that single option is the part that needs a proof.

Two proof patterns cover most greedy algorithms:

- **Greedy stays ahead.** Choose a measure of progress and show that after every step, greedy's partial answer is at least as good as the matching part of any other valid answer. In interval scheduling, greedy's k-th meeting ends no later than the k-th meeting of any other schedule, so whenever another schedule still has room for a meeting, greedy has room for it too.
- **Exchange argument.** Take an optimal answer that differs from greedy's, find the first place where they differ, and swap in greedy's choice without making the answer worse. Repeating the swap turns the optimal answer into greedy's, so greedy's answer is optimal as well. Jeff Erickson's chapter on greedy algorithms proves sorting files on a tape by length and scheduling classes this way.

A single counterexample is enough to reject a rule, and finding one is often the quickest test: run the rule against a brute-force search on small inputs, as in step 2.

### Coin systems

A coin system is **canonical** when greedy gives the fewest coins for every amount. The 25, 10, 5 and 1 of step 1 are canonical, and so are the US coins from 1 cent to a dollar (1, 5, 10, 25, 50, 100) and the euro coins (1, 2, 5, 10, 20 and 50 cents, 1 and 2 euros): comparing greedy with an exact dynamic-programming answer for every amount up to 5,000 cents finds no difference, and by the Kozen–Zaks bound below that check is conclusive. Other systems break:

- **1, 3, 4** first fails at 6, as in step 2: 4 + 1 + 1 against 3 + 3.
- **US postage stamps.** Kevin Wayne's slides for Kleinberg and Tardos use stamp values of 1, 10, 21, 34, 70, 100, 350, 1225 and 1500 cents: greedy pays 140 cents with eight stamps (100, 34 and six 1s) where two 70s are enough. It already fails at 30 cents, with 21 and nine 1s against three 10s.
- **No 1-cent coin.** Greedy can get stuck even when change exists: with 7, 8 and 9 it takes 9 out of 15, and the remaining 6 can't be paid, while 7 + 8 works.

Checking a coin system doesn't take every amount. Dexter Kozen and Shmuel Zaks proved in 1994 that if greedy fails at all, the smallest failing amount x lies in the range c₃ + 1 < x < cₘ + cₘ₋₁, for coin values 1 = c₁ < c₂ < … < cₘ: below the sum of the two largest coins. Their test only needs greedy's coin counts and takes O(m·cₘ) time. David Pearson's algorithm (2005) takes O(m³) time, polynomial in the number of coin types whatever their values, by narrowing the smallest counterexample down to O(m²) candidates.

### Scheduling

- **Interval scheduling** (step 3): to fit the most meetings into one room, sort by end time and take each meeting that starts no earlier than the last one taken ends. Earliest start fails (the all-day workshop in step 3), and so does shortest meeting first: one short meeting can overlap two longer ones that fit together. The sort costs O(n log n) and the scan O(n).
- **Interval partitioning:** to hold *every* meeting in as few rooms as possible, go through the meetings in order of start time and put each into any room that is free by then, opening a new room only when none is. The number of rooms equals the **depth**, the most meetings in progress at any one moment, and no schedule can use fewer, so it is optimal. Kept in a min-heap of room end times, it runs in O(n log n). The nine meetings of step 3 have depth 3 and fit in three rooms: the Workshop; A, C, E and G; and B, D, F and H.
- **Weighted interval scheduling:** when meetings have different values, earliest end can lose, because a small meeting that ends first may block a valuable one. The exact answer needs [dynamic programming](../dynamic-programming/): sort by end time, then for each meeting take the better of skipping it or taking it plus the best schedule among the meetings that end before it starts, O(n log n) in all with [binary search](../binary-search/).
- **Shortest job first:** on one machine, running jobs in order of increasing length minimizes the average completion time. Jobs of 3, 1 and 2 minutes finish at 3, 4 and 6 in that order (4.33 on average) but at 1, 3 and 6 shortest first (3.33). The proof swaps any longer job that runs just before a shorter one, which lowers the total; it is the same argument Erickson uses for files on a tape. It needs the lengths in advance, and with a steady stream of short jobs a long one can wait forever.
- Kleinberg and Tardos add two more classics: **earliest deadline first** minimizes the maximum lateness, and **farthest-in-future** eviction is optimal for a cache when the whole sequence of requests is known in advance. A real cache can't see the future, so its eviction policies are heuristics.

### Huffman coding

David Huffman's 1952 paper builds a **minimum-redundancy code**: a prefix-free code (no codeword is the beginning of another, so a decoder can split the bit stream without separators) that gives the shortest total length for the given symbol counts. The greedy step:

1. Put every symbol into a priority queue, keyed by its count.
2. Remove the two trees with the smallest counts, make them the children of a new node whose count is their sum, and put that node back.
3. Repeat until one tree is left, then read each code from the root: 0 for a left branch, 1 for a right one.

For abracadabra (a 5, b 2, r 2, c 1, d 1) the merges are c + d = 2, b + r = 4, 2 + 4 = 6 and a + 6 = 11, and the frequent `a` ends up with a 1-bit code. The total, 23 bits, is also the sum of the counts on the merged nodes: 2 + 4 + 6 + 11. Ties are common: merging the (c d) tree with b before b with r gives code lengths 1, 2, 3, 4, 4 (a, r, b, c, d) instead of 1, 3, 3, 3, 3, again 23 bits. The tie-break changes the codes but never the total. Formats therefore don't ask the decoder to rebuild the tree: DEFLATE sends the code lengths, and both sides derive the same canonical code from them.

Huffman codes are optimal among codes that give each symbol its own whole number of bits. A symbol that makes up 99 % of the data carries only about 0.015 bits of information (−log₂ 0.99) but still costs a full bit every time, which is why coders that aren't limited to whole bits, such as the arithmetic coding that JPEG allows as an option, can compress skewed data further.

### Minimum spanning trees and shortest paths

- **Kruskal (1956)** sorts the edges by weight and adds each one unless it closes a cycle, which a union-find structure checks in nearly constant time: O(E log E), dominated by the sort.
- **Prim (1957)**, published earlier by Vojtěch Jarník in 1930, grows one tree from a start vertex and always adds the lightest edge that leaves it: O(E log V) with a binary heap.
- Both are correct because of the **cut property**: for any split of the vertices into two groups, the lightest edge crossing the split belongs to a minimum spanning tree (assuming distinct weights). Sedgewick and Wayne present both as special cases of one generic greedy algorithm built on it.
- [Dijkstra's algorithm](../dijkstra/) is greedy too: it settles the closest unsettled node and never revisits it. That choice is provably safe only when no edge weight is negative.

### Greedy as a heuristic

For many hard problems a greedy rule doesn't find the optimum but still comes with a guarantee:

- **Set cover:** repeatedly take the set that covers the most uncovered elements. Williamson and Shmoys's textbook proves that this stays within a factor Hₙ = 1 + 1/2 + … + 1/n ≈ ln n of the optimum for n elements, and states the matching hardness result: for some constant c > 0, a polynomial-time algorithm that guarantees c·ln n would imply P = NP.
- **Load balancing across machines:** assign each job to the machine with the least load so far. Graham showed in 1966 that the time the last machine finishes (the makespan) is never more than twice the best possible, and the slides for Kleinberg and Tardos give an input that comes close: 10 machines, 90 jobs of length 1 and a final job of 10, finished at time 19 where 10 is possible. Sorting the jobs longest first improves the guarantee to 3/2 in the slides' proof, and to 4/3 by Graham's 1969 analysis.
- Least-connections in a [load balancer](../load-balancing/) is the online version: each request goes to the backend with the fewest active connections, without knowing how long the request will take. It is a heuristic that adapts to uneven requests, with no guarantee of being optimal.

### Fractional and 0/1 knapsack

With a capacity of 10 and three items, A (weight 6, value 30), B (5, 20) and C (5, 20), sorting by value per unit of weight takes A first (5 per unit). If items can be split (the **fractional** knapsack), greedy then fills the last 4 units with four fifths of B for a total of 46, which is optimal: an exchange argument shows any other filling can swap weight towards higher value per unit. If items are all or nothing (the **0/1** knapsack), greedy stops at 30 because B no longer fits, while B + C gives 40. The 0/1 version needs dynamic programming.

### The priority queue underneath

Huffman coding, Prim, Dijkstra and least-loaded assignment all repeat "give me the smallest so far", which is what a [binary heap](../binary-heap/) does in O(log n) per push or pop. Python's `heapq` provides one on a plain list; its documentation recommends storing an entry count next to the priority as a tie-breaker, so that equal priorities come out in insertion order and the items themselves are never compared. The code below does the same.

## Code

```python
import heapq
from itertools import count


def greedy_change(amount, coins):
    """Pay amount with as many of the largest coin as fit, then the next, and so on."""
    picked = []
    for coin in sorted(coins, reverse=True):
        n, amount = divmod(amount, coin)      # how many of this coin still fit
        picked += [coin] * n
    return picked if amount == 0 else None    # None: greedy is stuck (no 1-coin)


def schedule(meetings):
    """Book the most non-overlapping (name, start, end) meetings: earliest end first."""
    booked, free_at = [], float("-inf")
    for name, start, end in sorted(meetings, key=lambda m: m[2]):
        if start >= free_at:                  # back to back is allowed
            booked.append(name)
            free_at = end
    return booked


def huffman_codes(freq):
    """Prefix-free codes for {symbol: count}: keep merging the two rarest trees."""
    if not freq:
        return {}
    tick = count()                            # breaks ties, so trees are never compared
    heap = [(f, next(tick), sym) for sym, f in freq.items()]
    heapq.heapify(heap)
    while len(heap) > 1:
        f1, _, left = heapq.heappop(heap)
        f2, _, right = heapq.heappop(heap)
        heapq.heappush(heap, (f1 + f2, next(tick), (left, right)))
    codes, stack = {}, [(heap[0][2], "")]
    while stack:
        node, code = stack.pop()
        if isinstance(node, tuple):           # inner node: 0 to the left, 1 to the right
            stack += [(node[1], code + "1"), (node[0], code + "0")]
        else:
            codes[node] = code or "0"         # a lone symbol still needs one bit
    return codes


meetings = [("Workshop", 8.5, 16), ("A", 9, 10), ("B", 9.5, 11), ("C", 10, 11.5), ("D", 11, 12),
            ("E", 11.5, 13), ("F", 13, 14), ("G", 13.5, 15), ("H", 14, 15.5)]
print(greedy_change(63, [25, 10, 5, 1]), greedy_change(6, [1, 3, 4]))
print(schedule(meetings))
print(huffman_codes({"a": 5, "b": 2, "r": 2, "c": 1, "d": 1}))
# [25, 25, 10, 1, 1, 1] [4, 1, 1]
# ['A', 'C', 'E', 'F', 'H']
# {'a': '0', 'c': '100', 'd': '101', 'b': '110', 'r': '111'}
```

Symbols are plain strings here; inner nodes are tuples. The three functions were checked against brute force: `greedy_change` against exact dynamic programming (including the US postage values above and the stuck case 7, 8, 9), the Kozen–Zaks range on 3,000 random coin systems, `schedule` against every subset of 2,000 random sets of up to 10 meetings (plus no meetings, one meeting, duplicates and back-to-back meetings), and `huffman_codes` against the best code lengths allowed by the Kraft inequality on 400 random alphabets of up to six symbols. The codes for abracadabra are prefix-free and total 23 bits.

## Complexity

| Algorithm | Best | Average | Worst | Extra space | Why |
|---|---|---|---|---|---|
| `greedy_change` | O(d log d + k) | O(d log d + k) | O(d log d + k) | O(d + k) | Sorting the d coin types, one division per type, and k coins to list in the answer. |
| `schedule` | O(n) | O(n log n) | O(n log n) | O(n) | The sort dominates and the scan is one pass. Meetings that already arrive sorted by end time can skip the sort, which leaves O(n). |
| `huffman_codes` | O(n log n) | O(n log n) | O(n²) | O(n²) | Building the heap is O(n); the n − 1 merges each pop twice and push once, O(log n) apiece. Writing out the codes costs their total length: about n log n for typical counts, but about n²/2 when the counts grow like Fibonacci numbers and the tree becomes a path. Counting the symbols of a message of length L adds O(L). |

Stable and in place don't apply: each function builds a new answer. Greedy algorithms are fast because they never undo anything, so their cost is usually one sort or one heap pass. The cost of a wrong rule doesn't show up in this table: it shows up in the answer.

## When to use it

- When the problem has a proof that greedy is optimal: interval scheduling and partitioning, minimum spanning trees, Huffman codes, shortest paths with non-negative weights, the fractional knapsack, scheduling by deadline or by job length, and change-making in a canonical coin system.
- When a fast answer with a known bound beats an exact answer that costs exponential time: set cover, assigning jobs to machines.
- When decisions have to be made online, one at a time, and can't be revised: picking a backend for a request, placing a pod, admitting a meeting into a calendar.
- Not when an early choice can block a much better combination later: change-making in an arbitrary coin system, the 0/1 knapsack, weighted interval scheduling. Use dynamic programming, or search with [backtracking](../backtracking/) when the input is small.

## Trade-offs

- **Fast, but only right with a proof.** A greedy algorithm that is wrong still returns a confident answer. Test the rule against brute force on small inputs before trusting it.
- **The proof belongs to the input as well as the code.** Greedy change is optimal for 25, 10, 5, 1 and wrong for 4, 3, 1, with the same code. Adding a coin type, a job attribute or a weight can quietly turn a correct greedy algorithm into a heuristic.
- **Ties decide the output.** Equal keys can give different but equally good answers (other Huffman codes, another set of meetings). Break ties deliberately, with an index or an insertion counter, when output must be reproducible, and don't make two parties rebuild the same tree independently.
- **No second chances.** Online greedy decisions such as least-connections act on a snapshot. If the snapshot misleads (a backend that fails fast has few open connections), the decision sticks until the next one.
- **Heuristic bounds are worst cases.** A factor of 2 or ln n is a ceiling, not a typical result, and it says nothing about a particular input.

## Implementation notes

- **Compression formats:** DEFLATE ([RFC 1951](https://www.rfc-editor.org/rfc/rfc1951)) splits the data into blocks that are stored, coded with a fixed Huffman code, or coded with Huffman codes built for that block, on top of LZ77 matches. The codes are canonical: codes of the same length are consecutive values in symbol order and shorter codes come first, so a block only has to send the code lengths, each from 1 to 15 bits, with 0 marking an unused symbol. The RFC defines the format without prescribing a compression algorithm, so the compressor chooses the codes. zlib builds its trees with a heap in [`trees.c`](https://github.com/madler/zlib/blob/develop/trees.c) and, when a code would exceed the length limit, shortens it and rebalances the rest. DEFLATE is the method behind gzip (compression method 8 in [RFC 1952](https://www.rfc-editor.org/rfc/rfc1952)), ZIP (method 8, "Deflated", in [PKWARE's APPNOTE](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)) and PNG, whose compression method 0 is a zlib stream with a window of at most 32,768 bytes ([PNG specification](https://www.w3.org/TR/png-3/)).
- **Newer formats:** Brotli ([RFC 7932](https://www.rfc-editor.org/rfc/rfc7932)) combines LZ77 with Huffman-style prefix codes, and Zstandard ([RFC 8878](https://www.rfc-editor.org/rfc/rfc8878)) Huffman-codes its literals and codes the literal lengths, match lengths and offsets with FSE (finite state entropy) tables. Baseline JPEG entropy-codes its coefficients with Huffman tables, at most two for DC and two for AC coefficients; the extended modes may use arithmetic coding instead ([ITU-T T.81](https://www.w3.org/Graphics/JPEG/itu-t81.pdf)).
- **HTTP headers:** HPACK, the header compression of HTTP/2, has one fixed Huffman code in its specification, built from statistics on a large sample of HTTP headers ([RFC 7541](https://www.rfc-editor.org/rfc/rfc7541), Appendix B), and QPACK for HTTP/3 uses the same table unchanged ([RFC 9204](https://www.rfc-editor.org/rfc/rfc9204)). Huffman's algorithm ran once, offline; endpoints only look codes up.
- **Routing:** link-state protocols such as OSPF ([RFC 2328](https://www.rfc-editor.org/rfc/rfc2328), section 16.1) build their shortest-path trees with [Dijkstra's algorithm](../dijkstra/).
- **Scheduling and placement:** kube-scheduler filters the nodes that can run a pod, scores the rest and binds the pod to the highest-scoring node, choosing at random among equal scores ([Kubernetes Scheduler](https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/)). Pods are placed one at a time by the best score at that moment, a greedy choice rather than a global packing; the `MostAllocated` scoring strategy favours the fullest nodes, which turns it into greedy bin packing ([Resource Bin Packing](https://kubernetes.io/docs/concepts/scheduling-eviction/resource-bin-packing/)).
- **Load balancers:** NGINX's `least_conn` sends each request to the server with the fewest active connections, taking server weights into account and falling back to weighted round robin among ties ([ngx_http_upstream_module](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#least_conn)); see [Load Balancing](../load-balancing/) for its traps and for the power of two choices.
- **Compilers:** LLVM's default register allocator is called Greedy. It is a tuned version of its basic allocator, which assigns live ranges to registers one at a time in an order set by heuristics, and it adds global live-range splitting to keep spill code cheap ([LLVM code generator](https://llvm.org/docs/CodeGenerator.html#register-allocator)).
- **Text layout:** browsers have traditionally broken lines greedily, filling each line as far as it goes before starting the next. CSS Text Module Level 4 notes that this first-fit approach can often give suboptimal results and offers `text-wrap-style: pretty` (also `text-wrap: pretty`) as a slower opt-in ([CSS Text Level 4](https://drafts.csswg.org/css-text-4/#text-wrap-style)). Chrome 117 shipped `pretty` focused on avoiding a lone word on the last line ([Chrome for Developers](https://developer.chrome.com/blog/css-text-wrap-pretty)), and WebKit's version evaluates the whole paragraph, much as LaTeX and InDesign weigh several lines at a time ([WebKit blog](https://webkit.org/blog/16547/better-typography-with-text-wrap-pretty/)).
- **Priority queues in practice:** Python's `heapq` works on lists, Java has `java.util.PriorityQueue` and C++ `std::priority_queue`. Store (key, counter, item) entries so that ties never fall through to comparing items, and for the cost model see [Big-O Notation](../big-o-notation/).

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Dynamic Programming](../dynamic-programming/) — Solve each overlapping subproblem once and reuse its answer, top-down with memoization or bottom-up with a table.
- [Dijkstra's Shortest Path](../dijkstra/) — Settle the closest unsettled node, relax its edges, repeat: shortest paths from one source when no edge weight is negative.
- [Binary Heap & Heapsort](../binary-heap/) — A complete binary tree packed into an array keeps the smallest item on top: O(log n) push and pop, the classic priority queue.
- [Backtracking](../backtracking/) — Build a solution one choice at a time and undo any choice that hits a dead end: N-Queens, sudoku, permutations.
- [Load Balancing](../load-balancing/) — Spread requests across healthy instances and stop sending to unhealthy ones.
- [Big-O Notation](../big-o-notation/) — How an algorithm's cost grows with its input: O(1), O(log n), O(n), O(n log n) and O(n²) side by side as n grows.

## References

- [David A. Huffman — A Method for the Construction of Minimum-Redundancy Codes (Proceedings of the IRE, 1952)](https://doi.org/10.1109/JRPROC.1952.273898)
- [RFC 1951 — DEFLATE Compressed Data Format Specification version 1.3](https://www.rfc-editor.org/rfc/rfc1951)
- [Kevin Wayne — Greedy Algorithms I, lecture slides for Kleinberg and Tardos, Algorithm Design, chapter 4](https://www.cs.princeton.edu/~wayne/kleinberg-tardos/pdf/04GreedyAlgorithmsI.pdf)
- [Kevin Wayne — Approximation Algorithms, lecture slides for Kleinberg and Tardos, chapter 11 (load balancing)](https://www.cs.princeton.edu/~wayne/kleinberg-tardos/pdf/11ApproximationAlgorithms.pdf)
- [Jeff Erickson — Algorithms, chapter 4: Greedy Algorithms](https://jeffe.cs.illinois.edu/teaching/algorithms/book/04-greedy.pdf)
- [Stanford CS161 — Guide to Greedy Algorithms (greedy stays ahead and exchange arguments)](https://web.stanford.edu/class/archive/cs/cs161/cs161.1138/handouts/120%20Guide%20to%20Greedy%20Algorithms.pdf)
- [University of Rochester CSC 282 — Greedy Algorithms (CLRS chapter 16: greedy-choice property, optimal substructure)](https://www.cs.rochester.edu/u/gildea/csc282/slides/C16-greedy.pdf)
- [Dexter Kozen and Shmuel Zaks — Optimal bounds for the change-making problem (Theoretical Computer Science, 1994)](https://www.cs.cornell.edu/~kozen/Papers/change.pdf)
- [David Pearson — A polynomial-time algorithm for the change-making problem (Operations Research Letters, 2005)](https://doi.org/10.1016/j.orl.2004.06.001)
- [Joseph B. Kruskal — On the shortest spanning subtree of a graph and the traveling salesman problem (Proceedings of the AMS, 1956)](https://doi.org/10.1090/S0002-9939-1956-0078686-7)
- [R. C. Prim — Shortest Connection Networks and Some Generalizations (Bell System Technical Journal, 1957)](https://doi.org/10.1002/j.1538-7305.1957.tb01515.x)
- [Vojtěch Jarník — O jistém problému minimálním (1930), Czech Digital Mathematics Library](https://dml.cz/handle/10338.dmlcz/500726)
- [Sedgewick and Wayne — Algorithms, 4th edition, 4.3 Minimum Spanning Trees](https://algs4.cs.princeton.edu/43mst/)
- [Sedgewick and Wayne — Algorithms, 4th edition, 5.5 Data Compression](https://algs4.cs.princeton.edu/55compression/)
- [David P. Williamson and David B. Shmoys — The Design of Approximation Algorithms (section 1.6: a greedy algorithm for set cover)](https://www.designofapproxalgs.com/book.pdf)
- [Jared Saia — Greedy Algorithms: activity selection and the fractional knapsack (CS 561 lecture, University of New Mexico)](https://www.cs.unm.edu/~saia/classes/561-f19/lec/lec-greedy.pdf)
- [Python documentation — heapq: Heap queue algorithm](https://docs.python.org/3/library/heapq.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
