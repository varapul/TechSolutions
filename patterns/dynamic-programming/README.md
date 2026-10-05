<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧮 Algorithms & Data Structures](../../README.md#algorithms--data-structures)

# Dynamic Programming

> Solve each overlapping subproblem once and reuse its answer, top-down with memoization or bottom-up with a table.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Dynamic Programming" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/dynamic-programming.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Same subproblems, again** | The fewest coins from 1, 3 and 4 that make n follows `best(n) = 1 + min(best(n − 1), best(n − 3), best(n − 4))`, with `best(0) = 0`. Run as plain recursion, `best(6)` makes **24 calls** for only 7 different amounts: `best(2)` runs 4 times, `best(1)` 6 times and `best(0)` 9 times, so 17 calls redo work that was already done. The count grows exponentially: `best(30)` makes 2,550,408 calls. |
| **2 · Top-down: memoize** | Keep a **memo**, a table of answers by amount: look an amount up before solving it, and store the answer once it is solved. Now each amount is computed once, 7 computations in all, and the other 7 calls return straight from the memo, so 10 of the naive calls never happen. That is **memoization**, or top-down dynamic programming; in Python, `@functools.cache` adds the memo for you. |
| **3 · Bottom-up: fill a table** | Drop the recursion and fill a table from the smallest amount up: `dp[0] = 0`, then each `dp[n]` is 1 + the minimum of `dp[n − 1]`, `dp[n − 3]` and `dp[n − 4]`, cells that are already filled. `dp[6] = min(dp[5] + 1, dp[3] + 1, dp[2] + 1) = min(3, 2, 3) = 2`. Storing the coin each cell used lets you walk back from 6 to 3 to 0 and read **3 + 3**, the answer that greedy misses: it takes the 4 first and ends with 4 + 1 + 1. |
| **4 · Spot it, then table it** | The recipe: **define the state**, **write the recurrence**, **set the base cases** and **choose a fill order** in which every cell's inputs come first. For edit distance, `d(i, j)` is the fewest edits that turn the first i letters of *kitten* into the first j of *sitting*; the grid fills row by row to **3**, and tracing back gives k → s, e → i and insert g. The same idea runs diff tools and spell checkers, DNA alignment, query planners choosing join orders, Bellman–Ford shortest paths and TeX's line breaking. |
<!-- END GENERATED: header -->

## The problem

Some questions ask for the best way to build an answer out of choices: the fewest coins that make an amount, the fewest edits that turn one string into another, the cheapest order in which to join five tables. The natural solution is recursive: try every possible last choice, solve what is left, keep the best. It is correct, and it can be hopelessly slow, because different sequences of choices lead to the same leftover problem. With coins 1, 3 and 4, `best(6)` tries 6 − 1, 6 − 3 and 6 − 4, each of those tries up to three more, and the same amounts keep coming back: the recursion makes 24 calls to answer 7 different questions. Every extra unit of the amount multiplies the calls by about 1.6, so `best(30)` makes 2,550,408 calls and `best(60)` more than 4.7 trillion.

Taking the biggest coin that fits, the [greedy](../greedy-algorithms/) shortcut, is fast but wrong here: it pays 6 as 4 + 1 + 1, three coins, while 3 + 3 needs two.

Dynamic programming removes the repeated work and keeps the answer exact. Two signs tell you it applies:

- **Optimal substructure:** an optimal answer is built from optimal answers to smaller subproblems. If the best way to make 6 ends with a 3, the coins before it must be a best way to make 3.
- **Overlapping subproblems:** the recursion meets the same subproblems again and again, so solving each one once and reusing its answer pays off.

That is what sets it apart from its neighbours:

- **Divide and conquer** ([merge sort](../merge-sort/), [quicksort](../quicksort/)) also splits a problem, but into independent pieces that never overlap, so there is nothing to reuse.
- **Greedy algorithms** make one choice per step and never revisit it. That is only right when a proof shows the choice is safe; dynamic programming tries every choice, once per subproblem.
- **[Backtracking](../backtracking/)** also tries every choice, building a candidate step by step and undoing dead ends. When the rest of the search depends only on a small state that keeps recurring, remembering the result for each state turns the search into dynamic programming.

## How it works

There are two ways to make sure each subproblem is solved only once.

**Top-down: memoization.** Keep the recursion and add a memo: look a subproblem up before solving it, and store its answer afterwards. The memo is a dictionary keyed by the subproblem's parameters, which makes it a [hash table](../hash-table/). In Python, `@functools.cache` (3.9 and later) does exactly this: it is an unbounded cache, the same as `functools.lru_cache(maxsize=None)`, and the function's arguments must be hashable. On the coin problem it turns 24 calls into 14: 7 computations, one per amount, and 7 calls answered from the memo (`cache_info()` reports 7 hits and 7 misses). Only the subproblems the answer needs are ever computed. The recursion stays, though: with a 1-coin, `best(n)` still goes n calls deep, so a large amount runs into CPython's recursion limit of 1000 frames (see [Recursion](../recursion/)).

**Bottom-up: tabulation.** Put the subproblems in an order where each one comes after the ones it reads, and fill a table in that order with a plain loop. For coins that is `dp[0]`, `dp[1]` … `dp[n]`, and each cell reads at most one cell per coin, all to its left. There is no recursion, so no depth limit and no call overhead, and you can often keep only the part of the table that later cells still read: edit distance needs only the previous row, Fibonacci only the last two numbers. The price is that every cell is filled, whether the final answer needs it or not.

The recipe is the same for every problem:

1. **Define the state:** the few parameters that describe a subproblem. `best(n)` is the fewest coins for amount n; `d(i, j)` is the fewest edits that turn the first i characters of one string into the first j of the other.
2. **Write the recurrence:** how a state's answer follows from smaller states, usually by trying every possible last step and taking the minimum, the maximum or the sum. The last step into `d(i, j)` is a delete (from `d(i − 1, j)`), an insert (from `d(i, j − 1)`) or a substitution (from `d(i − 1, j − 1)`, free when the two characters match).
3. **Set the base cases:** `best(0) = 0`; `d(i, 0) = i` and `d(0, j) = j`. Mark states that cannot be reached, for example with infinity.
4. **Choose the fill order:** any order in which each state's inputs come first, such as increasing n for coins and row by row for a grid. The states and their dependencies form a directed acyclic graph, and a fill order is a [topological order](../topological-sort/) of it.
5. **Read the answer** from the state that asks the original question: `dp[6]`, or `d(6, 7)` for *kitten* and *sitting*.
6. **Reconstruct the solution** when you need more than its value: record which choice won in each state, then walk back from the answer. `dp[6]` came from a 3 and so did `dp[3]`, which gives 3 + 3. When two choices tie, either one leads to an optimal answer; the code below keeps the first coin that reaches the minimum.

**Classic problems.**

- **Coin change** has two forms: the fewest coins (a minimum over the last coin, as here) and the number of ways to make an amount (a sum). To count combinations rather than orderings, put the loop over coins outside the loop over amounts: 1, 3 and 4 make 6 in 4 ways (six 1s, 3 + 1 + 1 + 1, 4 + 1 + 1 and 3 + 3).
- **0/1 knapsack:** items with weights and values and a capacity W. The state is how many items have been considered and how much capacity is left, which gives O(n·W) time. That bound is **pseudo-polynomial**: polynomial in the value of W, but writing W down takes only about log₂ W bits, so the time is exponential in the size of the input, as you would expect for an NP-hard problem.
- **Longest common subsequence and edit distance** fill a grid over prefixes of the two strings. The edit distance with inserts, deletes and substitutions is the Levenshtein distance; Wagner and Fischer published the table algorithm in 1974, and Needleman and Wunsch had used the same kind of grid in 1970 to compare protein sequences.
- **Longest increasing subsequence:** the O(n²) version sets `L[i]` to 1 plus the largest `L[j]` with j < i and `a[j] < a[i]`. A faster O(n log n) method keeps, for each length, the smallest value that ends an increasing subsequence of that length, and places each new element with a [binary search](../binary-search/).
- **Shortest paths:** Bellman–Ford relaxes every edge V − 1 times. After round k no distance is worse than the best path with at most k edges, so it is dynamic programming over the number of edges; it takes O(V·E) and, unlike [Dijkstra's algorithm](../dijkstra/), handles negative weights. Floyd–Warshall finds the shortest paths between all pairs in O(V³) by allowing one more intermediate vertex in each round.

**Where the name comes from.** Richard Bellman developed the method at the RAND Corporation in the early 1950s and published ["On the Theory of Dynamic Programming"](https://pmc.ncbi.nlm.nih.gov/articles/PMC1063639/) in 1952 and a survey, "The theory of dynamic programming", in 1954. In his autobiography, excerpted by Stuart Dreyfus (2002), Bellman says he chose the name in the autumn of 1950 partly as cover: the Secretary of Defense, Wilson, could not stand the word *research*, and RAND worked for the Air Force. *Programming* meant planning and decision-making, not writing code, and *dynamic* said that the problems unfold in stages over time. Bellman also liked that nobody could use the word *dynamic* as an insult.

## Code

```python
import math
from functools import cache

def fewest_naive(coins, n):            # exponential: solves the same amounts again and again
    if n == 0:
        return 0
    return 1 + min((fewest_naive(coins, n - c) for c in coins if c <= n), default=math.inf)

def fewest_memo(coins, n):             # top-down: each amount is solved once, then cached
    @cache
    def best(m):
        if m == 0:
            return 0
        return 1 + min((best(m - c) for c in coins if c <= m), default=math.inf)
    return best(n)

def min_coins(coins, amount):          # bottom-up, with the coins of one best answer
    dp = [0] + [math.inf] * amount     # dp[n] = fewest coins that make n
    last = [0] * (amount + 1)          # last[n] = the coin that achieved dp[n]
    for n in range(1, amount + 1):
        for c in coins:
            if c <= n and dp[n - c] + 1 < dp[n]:
                dp[n], last[n] = dp[n - c] + 1, c
    if dp[amount] == math.inf:
        return None                    # this amount cannot be made
    picked = []
    while amount:                      # follow the stored choices back to 0
        picked.append(last[amount])
        amount -= last[amount]
    return picked

def edit_distance(a, b):               # Levenshtein distance, keeping two rows
    if len(a) < len(b):
        a, b = b, a                    # the shorter string sets the row length
    prev = list(range(len(b) + 1))     # from "" to b[:j] takes j inserts
    for i, x in enumerate(a, 1):
        cur = [i]                      # from a[:i] to "" takes i deletes
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1,              # delete x
                           cur[j - 1] + 1,           # insert y
                           prev[j - 1] + (x != y)))  # substitute, free if equal
        prev = cur
    return prev[-1]

print(min_coins([1, 3, 4], 6))              # [3, 3]
print(min_coins([3, 4], 2))                 # None
print(edit_distance("kitten", "sitting"))   # 3
```

`fewest_naive` and `fewest_memo` return the number of coins, or `math.inf` when the amount cannot be made; `min_coins` returns the coins themselves, `[]` for an amount of 0 and `None` when no combination works, as for 2 or 5 from coins 3 and 4. The memo in `fewest_memo` lives inside one call, because `coins` is a list and lists cannot be cache keys. The three coin functions agree with each other on every amount from 0 to 60 for twelve coin systems (the naive one only up to the amounts where it stays under about 300,000 calls, 25 for coins 1, 3 and 4) and with a brute-force search up to 24; `edit_distance` matches a full-grid version on 3,000 random strings and gives 0 for two empty strings and 3 for *kitten* and *sitting* in either order.

## Complexity

With k coin values, an amount A, and strings of lengths m and n:

| | Time (best = average = worst) | Extra space | Why |
|---|---|---|---|
| `fewest_naive` | exponential in A | O(A) | Nothing is remembered, so every call tries every coin again. For coins 1, 3 and 4 the call count c(A) = 1 + c(A − 1) + c(A − 3) + c(A − 4) grows by a factor of φ ≈ 1.618 per unit: 24 calls for 6, 2,550,408 for 30. The stack holds one chain of calls, at most A deep. |
| `fewest_memo` | O(A·k) | O(A) | Each of the A + 1 amounts is computed once and tries k coins; every other call is a dictionary lookup. The memo holds A + 1 answers and the first descent is up to A frames deep. |
| `min_coins` | O(A·k) | O(A) | Two nested loops, amounts outside and coins inside. `dp` and `last` hold A + 1 entries each, and walking back takes one step per coin in the answer. |
| `edit_distance` | O(m·n) | O(min(m, n)) | One constant-time minimum per cell of the grid. Only the previous row and the current one are kept, each of length min(m, n) + 1. |

Each function does the same work for every input of a given size, so its best, average and worst cases coincide; stable and in place don't apply. [Big-O Notation](../big-o-notation/) explains the notation. Two rows give the distance but not the edits: tracing them back, as the animation does, needs the whole grid.

## When to use it

- The question asks for an optimum or a count over many combinations of choices (fewest, cheapest, longest, most valuable, number of ways), and the choices interact, so no simple rule is provably safe.
- A subproblem can be described by a few small parameters, such as an amount, two prefix lengths, or an index and a remaining capacity, so the table fits in memory.
- A recursive solution revisits the same states: draw a small call tree, as in step 1, and look for repeats.
- Not when the subproblems don't overlap; plain divide and conquer is enough.
- Not when a greedy rule is proven optimal for the problem (for example, change-making in a canonical coin system): it is simpler and faster.
- Not when the state space is enormous, such as a capacity in the billions or a state that has to record which of n items are used (2ⁿ subsets); approximations, branch and bound or heuristics fit better there.

## Trade-offs

- **Memory for time.** The table replaces exponential time with one cell per state: O(A) cells for coins, O(m·n) for two strings. Keeping only the rows you still need saves memory but loses the information needed to reconstruct the solution.
- **Top-down or bottom-up.** Memoization is the smallest change to existing recursive code and computes only the states the answer needs, but it pays for function calls and hashing and keeps the recursion depth. Tabulation needs an explicit order and fills every cell, but it runs as a tight loop over an array and lets you drop rows you no longer need.
- **Unbounded caches grow.** `functools.cache` never evicts. In a long-running process, memoizing a function over an open-ended set of arguments leaks memory; `functools.lru_cache(maxsize=...)` bounds the cache and `cache_clear()` empties it.
- **Pseudo-polynomial is not polynomial.** An O(n·W) knapsack is fast while W is small; the table grows with the value of W, not with the number of digits it takes to write it.
- **The state is the hard part.** Leave out something the answer depends on and the recurrence gives wrong results; put in too much and the table explodes.

## Implementation notes

- **Python:** `@functools.cache` and `@functools.lru_cache` memoize, and `cache_info()` shows hits and misses (the 7 and 7 of step 2). For bottom-up tables, plain lists indexed by the state are enough. A memoized recursion that is too deep fails with `RecursionError`, so fill large tables bottom-up instead.
- **Diff:** comparing two files line by line is a longest-common-subsequence problem. Git's default diff (`--diff-algorithm=myers`, alongside `minimal`, `patience` and `histogram`) is Myers' 1986 algorithm. It finds a shortest edit script of insertions and deletions, the counterpart of a longest common subsequence, as a shortest path through the *edit graph* that a DP table would fill, but it explores that graph in order of the number of edits D instead of filling every cell. That makes it O(N·D), with N the total length, and fast when two versions differ little.
- **Spelling suggestions and fuzzy search** rank candidates by edit distance. PostgreSQL's `fuzzystrmatch` extension provides `levenshtein()`, with optional costs for inserts, deletes and substitutions on strings of up to 255 characters, and `levenshtein_less_equal()`, a faster variant for when only small distances matter. Elasticsearch's `fuzzy` query matches terms within at most 2 edits, and by default counts swapping two adjacent characters as a single edit.
- **Bioinformatics:** Needleman–Wunsch (1970) aligns two whole sequences on the same kind of grid, with a substitution score and gap penalties instead of unit costs; Smith–Waterman (1981) adapts it to find the best-matching local regions.
- **Query planners:** System R's optimizer (Selinger et al., 1979) chose join orders by finding the cheapest plan for each set of tables, building larger sets from smaller ones and keeping one plan per set and per *interesting order*, a sort order the query can use later, such as the one its ORDER BY or GROUP BY needs. PostgreSQL's planner joins two relations, then three, and so on in the same way, and its source calls this dynamic programming. Its documentation notes that this near-exhaustive search, first introduced in System R, gets slow and memory-hungry as the number of joins grows, so from `geqo_threshold` FROM items (12 by default) PostgreSQL switches to its genetic query optimizer, which settles for a reasonable plan rather than the best one.
- **Speech and sequence labelling:** the Viterbi algorithm finds the most likely sequence of hidden states in a hidden Markov model by filling a trellis of time steps by states, keeping for each state the best path that ends there. Jurafsky and Martin's [chapter on hidden Markov models](https://web.stanford.edu/~jurafsky/slp3/A.pdf) points out how closely it resembles minimum edit distance.
- **Typesetting:** TeX breaks a paragraph into lines with the Knuth–Plass algorithm, which treats line breaking as a shortest path through an acyclic network of feasible breakpoints and keeps, for each breakpoint, the fewest total demerits of any way to reach it. A slightly loose line early on can buy better lines later, which a line-by-line method never sees.
- **Memoization is caching:** a memo is a cache whose entries never go stale, because a pure function returns the same answer for the same arguments. Caching data from a service, as in [Cache-Aside](../cache-aside/), has to handle expiry, eviction and invalidation that a memo can ignore, and memoizing a function with side effects or time-dependent results is a bug.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Recursion & the Call Stack](../recursion/) — A function calls itself on a smaller input; each call waits on the stack until a base case returns and the answers unwind.
- [Greedy Algorithms](../greedy-algorithms/) — Take the choice that looks best right now and never revisit it: optimal for some problems, quietly wrong for others.
- [Backtracking](../backtracking/) — Build a solution one choice at a time and undo any choice that hits a dead end: N-Queens, sudoku, permutations.
- [Dijkstra's Shortest Path](../dijkstra/) — Settle the closest unsettled node, relax its edges, repeat: shortest paths from one source when no edge weight is negative.
- [Cache-Aside](../cache-aside/) — Read from the cache first; on a miss load from the database and populate the cache.
- [Hash Table](../hash-table/) — Hash each key straight to a bucket for O(1) average lookups; colliding keys share a bucket, and the table grows as it fills.
- [Binary Search](../binary-search/) — Halve a sorted range with every check: about 20 steps find one item among a million, where a scan may need a million.
- [Big-O Notation](../big-o-notation/) — How an algorithm's cost grows with its input: O(1), O(log n), O(n), O(n log n) and O(n²) side by side as n grows.

## References

- [Richard Bellman — The theory of dynamic programming (Bulletin of the AMS, 1954)](https://www.ams.org/journals/bull/1954-60-06/S0002-9904-1954-09848-8/)
- [Stuart Dreyfus — Richard Bellman on the Birth of Dynamic Programming (Operations Research, 2002; archived PDF)](https://web.archive.org/web/20180821050228/https://pubsonline.informs.org/doi/pdf/10.1287/opre.50.1.48.17791)
- [Robert A. Wagner and Michael J. Fischer — The String-to-String Correction Problem (Journal of the ACM, 1974)](https://dl.acm.org/doi/10.1145/321796.321811)
- [Saul B. Needleman and Christian D. Wunsch — A general method applicable to the search for similarities in the amino acid sequence of two proteins (1970)](https://doi.org/10.1016/0022-2836(70)90057-4)
- [P. Griffiths Selinger et al. — Access Path Selection in a Relational Database Management System (SIGMOD 1979)](https://dl.acm.org/doi/10.1145/582095.582099)
- [Eugene W. Myers — An O(ND) Difference Algorithm and Its Variations (Algorithmica, 1986)](https://doi.org/10.1007/BF01840446)
- [Python docs — functools.cache](https://docs.python.org/3/library/functools.html#functools.cache)
- [PostgreSQL docs — Genetic Query Optimizer: query handling as a complex optimization problem](https://www.postgresql.org/docs/current/geqo-intro.html)
- [PostgreSQL source — the optimizer README (join search by dynamic programming)](https://github.com/postgres/postgres/blob/master/src/backend/optimizer/README)
- [Git docs — git diff --diff-algorithm](https://git-scm.com/docs/git-diff)
- [MIT OpenCourseWare 6.006 (Spring 2020) — Lecture 16: Dynamic Programming, Part 2: LCS, LIS, Coins](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/resources/lecture-16-dynamic-programming-part-2-lcs-lis-coins/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
