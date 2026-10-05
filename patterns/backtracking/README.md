<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧮 Algorithms & Data Structures](../../README.md#algorithms--data-structures)

# Backtracking

> Build a solution one choice at a time and undo any choice that hits a dead end: N-Queens, sudoku, permutations.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Backtracking" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/backtracking.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Choose, check, go deeper** | Backtracking builds a solution one choice at a time; here each choice is the square for the next row's queen. The search tries a row's squares from left to right and **checks** each one against the queens already placed: a shared column or diagonal means it is attacked. r0c0 is safe, r1c0 and r1c1 are attacked, r1c2 is safe, and then all four squares of row 2 are attacked: a **dead end** after 8 squares tried. |
| **2 · Undo the last choice** | At a dead end the search **undoes** its most recent choice and tries the next square in that row; when a row has no squares left, it undoes the choice above it too (undone queens stay in the tree as dashed rings). Removing r1c2 leads to r1c3 and r2c1 and a second dead end in row 3, then row 1 runs out, so r0c0 is removed as well. From r0c1 the search finds r1c3, r2c0 and r3c2: the columns 1, 3, 0, 2, after 26 squares tried, 8 queens placed and 4 removed. |
| **3 · Pruning is the point** | An attacked square ends its branch of the search tree, so none of the boards below it is ever built: 16 for each attacked square in row 1, 4 in row 2 and 1 in row 3, which makes 114, and the next board in search order is the solution. Brute force would build whole boards and test each one: up to 4⁴ = 256 with one queen per row (4! = 24 if the columns must differ too). Backtracking keeps only the current choices, so it needs O(n) extra space. |
| **4 · When the tree explodes** | Pruning helps, but in the worst case backtracking is still exponential. A backtracking regex engine matching `(a+)+b` against n a's with no b tries every way to split the a's into groups, 2ⁿ⁻¹ of them, so 25 a's mean more than 16 million: **catastrophic backtracking**, or ReDoS when an attacker chooses the input. A regex that backtracked too much caused Cloudflare's 27-minute worldwide outage on 2 July 2019; the defences are linear-time engines (RE2, Go's `regexp`, Rust's `regex`), match timeouts, and atomic groups or possessive quantifiers. |
<!-- END GENERATED: header -->

## The problem

Many problems ask for an arrangement that obeys a set of rules: queens that don't attack each other, a filled-in sudoku grid, items that add up to a budget, a timetable without clashes. Every candidate answer is a sequence of small choices, and the number of candidates multiplies with each choice: there are 4⁴ = 256 ways to put one queen in each row of a 4 × 4 board, and 8⁸ = 16,777,216 on a chessboard. Generating every complete candidate and testing it afterwards (generate-and-test) spends nearly all its time on candidates that were already broken after their first two or three choices.

## How it works

Backtracking extends a partial solution one choice at a time and tests the rules after every choice instead of at the end:

1. **Choose** the next decision (here, the column for the queen in the next row) and pick one of its options.
2. **Check** the partial solution against the constraints. If it already breaks a rule, drop the option: every solution that would have grown from it is ruled out in one step.
3. **Go deeper**: if the check passes, keep the choice and move on to the next decision. A partial solution that has made every decision is a solution.
4. **Undo**: when a decision has no options left, return to the one before it, take back that choice and try its next option.

The choices form a tree that is never stored. Its root is the empty board, each level is one decision and each child is one option. Backtracking walks it depth first, generating it as it goes and keeping only the current path, the choice stack. That separates it from [Depth-First Search](../depth-first-search/) over a graph that already exists, and from [Dynamic Programming](../dynamic-programming/), which pays off when the same subproblems come up again and again: two different paths through a backtracking tree rarely reach the same partial solution. The recursion that usually implements it is covered in [Recursion & the Call Stack](../recursion/).

The diagram runs 4-Queens with rows from top to bottom and columns from left to right, and stops at the first solution. It tries 26 squares, places 8 queens and undoes 4 of them before it reaches the columns 1, 3, 0, 2; the only other solution is its mirror image, 2, 0, 3, 1. The 18 attacked squares rule out 114 of the 256 one-queen-per-row boards without building any of them, and the solution is the 115th board in search order.

**Making the tree smaller.** The checks and the order of the choices decide whether a search finishes in a millisecond or not at all:

- **Check early and cheaply.** `n_queens` below keeps sets of the attacked columns and diagonals, so testing a square is three set lookups rather than a scan of the board.
- **Branch on the most constrained decision first.** Golomb and Baumert proposed in 1965 to choose the variable with the fewest options left (minimum remaining values, or "fail first"), so dead ends show up near the root, where cutting them saves the most. Within a decision, try first the value most likely to work, such as the *least constraining value*, the one that takes the fewest options away from the others.
- **Propagate constraints.** Forward checking deletes the options that a new choice rules out for the decisions still open, and backs up as soon as one of them has none left. Peter Norvig's sudoku solver combines two propagation rules with a depth-first search that fills the square with the fewest candidates first; it averages a hundredth of a second per random puzzle.
- **First solution or all of them.** A generator gives both from the same code: `next()` stops at the first solution and a loop collects them all. Finding all of them is much more work: N-Queens has 2 solutions for n = 4, 92 for n = 8 and 14,200 for n = 12.

**Relatives.**

- **Permutations, subsets and combinations** come from the same template with little or no pruning; the generic `backtrack` below produces both. When you only need to list them, `itertools.permutations`, `combinations` and `product` are the simpler choice.
- **Exact cover** problems (polyomino tilings, N-Queens, sudoku) suit Knuth's Algorithm X. His *Dancing Links* keeps the options in doubly linked lists, so removing an option and putting it back, the undo step, are each a few pointer updates.
- **SAT solvers** grew out of backtracking. The DPLL procedure (Davis, Logemann and Loveland, 1962) assigns one Boolean variable at a time and propagates the clauses that are left with a single literal. Today's conflict-driven clause learning (CDCL) solvers still search this way, but they learn a new clause from every conflict and can jump back over several decisions at once.
- **Constraint programming** runs the same search with stronger propagation for rostering, timetabling and job-shop scheduling; Google's OR-Tools CP-SAT solver, for example, combines constraint programming with SAT techniques.

**History.** By Knuth's account, Gauss explained in an 1850 letter how to find every solution of the eight-queens puzzle by this kind of systematic trial, and R. J. Walker named the method "backtrack" in the 1950s (other accounts, Wikipedia's among them, credit D. H. Lehmer). Walker described it as a general technique in 1960, and Solomon Golomb and Leonard Baumert's 1965 paper *Backtrack Programming* stated the general problem and worked through a range of applications.

**When the tree explodes: catastrophic regex backtracking.** Regex engines in the Perl tradition, including Perl, PCRE, Python's `re`, Java's `java.util.regex` and .NET's default engine, match by backtracking: at each choice point (one more repetition or stop, this alternative or the next) they take one branch and come back for the others when the rest of the pattern fails. Nested quantifiers turn that into an exponential search. Matching `(a+)+b` against n a's with no b, the engine can divide the a's between the inner and the outer `+` in 2ⁿ⁻¹ ways, and it tries all of them, along with every split of every shorter prefix, before it reports no match. On CPython 3.11, `re.match(r'(a+)+b', 'a' * n)` took about 60 ms for n = 20 on the machine used for this page and roughly doubled with each extra a, so 30 a's would take about a minute. When users supply the input, that is a denial-of-service hole, **ReDoS**; OWASP's page lists the usual shapes, a repeated group that itself contains repetition, or alternatives that can match the same text.

The best-known incident is Cloudflare's outage of 2 July 2019. A new rule in its web application firewall contained a regular expression with the fragment `.*(?:.*=.*)`, which backtracked so heavily that every CPU core handling HTTP and HTTPS traffic across its network was exhausted. The outage lasted 27 minutes, until the managed rules were switched off worldwide. That pattern's cost grows polynomially, not exponentially, with the input; super-linear was enough at that scale. Cloudflare's follow-ups included restoring a CPU-usage protection that a refactoring had removed, moving to a regex engine with runtime guarantees (RE2 or Rust's regex) and rolling out rule changes in stages, as software already was.

The defences:

- **A linear-time engine.** RE2, Go's `regexp` and Rust's `regex` compile the pattern to automata and guarantee a match time linear in the input (O(m × n) for a pattern of size m, in Rust's documentation); in exchange they leave out backreferences and look-around. Russ Cox's 2007 article explains the approach, which goes back to Ken Thompson's 1968 construction, and how far ahead of backtracking it stays on such patterns. Since .NET 7, `RegexOptions.NonBacktracking` gives the same guarantee in .NET.
- **A time limit.** .NET takes a match timeout in the `Regex` constructor and the static methods, or as a process-wide default (`REGEX_DEFAULT_MATCH_TIMEOUT`), and throws `RegexMatchTimeoutException` when it runs out; without one the timeout is infinite. Python's `re` and Java's `Pattern` have no timeout, so cap the input length or run risky matches where they can be stopped, the same idea as [Timeout & Fallback](../timeout-and-fallback/).
- **No backtracking into a group.** Atomic groups `(?>…)` and possessive quantifiers (`*+`, `++`, `?+`) throw away the choice points inside them once they have matched; Java supports both, and Python's `re` has had them since 3.11. On the same 20 a's, `(?>a+)+b` and `(a+)++b` fail in a tenth of a millisecond or less. Often the simplest fix is a rewrite: `(a+)+b` matches exactly the same strings as `a+b`.

## Code

```python
def n_queens(n):
    """Yield (columns, squares_tried) for each solution; columns[row] = queen's column."""
    queens = []                                   # the choice stack
    cols, diag, anti = set(), set(), set()        # attacked columns and diagonals
    tried = 0

    def place(row):
        nonlocal tried
        if row == n:                              # every row has a queen
            yield queens.copy(), tried
            return
        for col in range(n):                      # choose a square in this row
            tried += 1
            if col in cols or row - col in diag or row + col in anti:
                continue                          # check failed: prune this branch
            queens.append(col)
            cols.add(col); diag.add(row - col); anti.add(row + col)
            yield from place(row + 1)             # go deeper
            queens.pop()                          # undo, then try the next column
            cols.remove(col); diag.remove(row - col); anti.remove(row + col)

    yield from place(0)


def backtrack(partial, options, ok, done):
    """The bare template: extend partial with each option that passes ok(), then undo."""
    if done(partial):
        yield partial.copy()
        return
    for x in options(partial):
        if ok(partial, x):
            partial.append(x)                     # choose
            yield from backtrack(partial, options, ok, done)
            partial.pop()                         # undo


print(next(n_queens(4)))                          # ([1, 3, 0, 2], 26)
print([cols for cols, _ in n_queens(4)])          # [[1, 3, 0, 2], [2, 0, 3, 1]]
print(sum(1 for _ in n_queens(8)))                # 92

word = 'abc'                                      # permutations: each letter once
perms = backtrack([], lambda p: word, lambda p, x: x not in p, lambda p: len(p) == len(word))
print([''.join(p) for p in perms])                # ['abc', 'acb', 'bac', 'bca', 'cab', 'cba']

nums = [2, 3, 5, 6, 8]                            # increasing subsets that add up to 11
sums = backtrack([], lambda p: [x for x in nums if not p or x > p[-1]],
                 lambda p, x: sum(p) + x <= 11, lambda p: sum(p) == 11)
print(list(sums))                                 # [[2, 3, 6], [3, 8], [5, 6]]
```

`n_queens` is a generator, so `next()` stops at the first solution after 26 squares tried, the run in the diagram, while a loop finds them all. A diagonal is identified by `row - col` in one direction and `row + col` in the other, so the safety check is three set lookups, and the undo removes exactly what the choice added. For n = 8 the first solution, 0 4 7 5 2 6 1 3, comes after 876 squares tried. `backtrack` is the bare template: you supply the options, the check and the test for a finished solution. The code was checked against brute force over every permutation for n up to 7, against the known counts for n = 0 to 10 (1, 1, 0, 0, 2, 10, 4, 40, 92, 352, 724), and on the edge cases n = 0 (one empty placement), n = 1, n = 2 and 3 (no solutions), an empty word and a target that no subset reaches.

## Complexity

With d decisions, at most b options per decision and an O(1) check:

| | Time | Extra space | Why |
|---|---|---|---|
| Best case | O(b · d) checks | O(d) | The first option that passes the check at every level leads straight to a solution: at most b options are checked per level and nothing is undone. |
| Average case | no general bound | O(d) | It depends on how early the checks fail and on the order of the choices. Norvig's sudoku solver averages 0.01 s per random puzzle, yet about one puzzle in a million took more than 100 s. |
| Worst case | O(bᵈ) nodes | O(d) | When nothing fails until the last level, the search visits the whole tree. |
| `n_queens(n)`, all solutions | O(n · n!) squares tried | O(n) | The column check alone leaves at most n!/(n − k)! placements of k queens, and each tries n squares. The diagonal check prunes far more: all 92 solutions for n = 8 take 15,720 squares tried, against 8⁸ = 16,777,216 one-queen-per-row boards and 8! = 40,320 permutations. The space is the queens list, three sets of at most n entries and n generator frames. |

The extra space is the choice stack plus whatever state the checks keep, never the tree. Stable and in place don't apply. [Big-O Notation](../big-o-notation/) explains the notation.

## When to use it

- Constraint problems where a partial candidate can already be rejected: puzzles (sudoku, N-Queens, crosswords, tilings), configuration, combinatorial designs, small timetables.
- Listing every arrangement that obeys the rules, or the first one in a fixed order.
- Indirectly, through tools built on it: SAT and constraint solvers, and parsers that try alternatives.
- Not when a cheaper method fits: if the same subproblems repeat, use dynamic programming; if a greedy choice is provably safe, take it ([Greedy Algorithms](../greedy-algorithms/)); shortest paths, matchings and flows have polynomial algorithms.
- Not for a regular expression on untrusted input in a backtracking engine without a limit.

## Trade-offs

- **Exponential worst case.** Pruning, ordering and propagation shrink the tree on typical inputs, but a hard instance can still take forever, and it is hard to tell in advance which inputs are hard.
- **Heavy-tailed running times.** In Norvig's experiment one puzzle took 188.79 s; with the value order shuffled, 27 out of 30 runs finished in under 0.02 s and the other 3 took about 190 s. Randomised ordering with restarts is a standard remedy, covered in van Beek's survey.
- **Little memory.** Only the current path is kept, O(depth), where a [breadth-first search](../breadth-first-search/) would hold a whole level of the tree at once.
- **The undo must be exact.** Everything a choice changed (sets, counters, the board) has to be restored, usually in reverse order, or later checks run against the wrong state and answers go silently wrong. Copying the state at every node is simpler and slower.
- **Recursion depth.** A recursive backtracker needs one frame per decision. That is nothing for N-Queens, but for thousands of decisions in Python, whose default recursion limit is 1000, use an explicit stack.

## Implementation notes

- **Python:** write the search as a generator (`yield`, `yield from`) so callers decide between the first solution and all of them, keep the constraint state in sets or bit masks for O(1) checks, and reach for `itertools` when nothing needs pruning.
- **Regex engines:** Perl, PCRE, Python's `re`, Java and .NET (by default) backtrack; RE2 (C++, with bindings for many languages), Go's `regexp`, Rust's `regex` and .NET's `NonBacktracking` option run in linear time. Treat a regex that runs on every request, in a gateway, a WAF or input validation, as code: test it against near-miss inputs, bound its time, and roll changes out in stages ([Canary Release](../canary-release/)).
- **Solvers:** for real scheduling, rostering or configuration problems, describe the constraints to a constraint or SAT solver (OR-Tools CP-SAT, for instance) instead of writing the search; it brings strong propagation and the learning of SAT solvers.
- **Exact cover:** Dancing Links handles sudoku, polyomino tilings and other exact cover problems with an undo that costs a few pointer updates.
- **Parsers:** a PEG parser tries the alternatives of a rule in order and backtracks when one fails. CPython's own parser has been a PEG parser since 3.9, and PEP 617 describes how memoizing the rules already matched at each position (packrat parsing) keeps that backtracking cheap, at the cost of some extra memory.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Recursion & the Call Stack](../recursion/) — A function calls itself on a smaller input; each call waits on the stack until a base case returns and the answers unwind.
- [Depth-First Search](../depth-first-search/) — Follow one path as deep as it goes, then backtrack; a stack or recursion remembers where to resume, and finds cycles too.
- [Dynamic Programming](../dynamic-programming/) — Solve each overlapping subproblem once and reuse its answer, top-down with memoization or bottom-up with a table.
- [Greedy Algorithms](../greedy-algorithms/) — Take the choice that looks best right now and never revisit it: optimal for some problems, quietly wrong for others.
- [Big-O Notation](../big-o-notation/) — How an algorithm's cost grows with its input: O(1), O(log n), O(n), O(n log n) and O(n²) side by side as n grows.

## References

- [Solomon W. Golomb and Leonard D. Baumert — Backtrack Programming (Journal of the ACM, 1965)](https://dl.acm.org/doi/10.1145/321296.321300)
- [Donald E. Knuth — The Art of Computer Programming, Volume 4B, 7.2.2: Backtrack programming](https://www-cs-faculty.stanford.edu/~knuth/taocp.html)
- [Donald E. Knuth — Dancing Links (arXiv cs/0011047, 2000)](https://arxiv.org/abs/cs/0011047)
- [Davis, Logemann and Loveland — A machine program for theorem-proving (Communications of the ACM, 1962)](https://dl.acm.org/doi/10.1145/368273.368557)
- [Peter van Beek — Backtracking Search Algorithms (Handbook of Constraint Programming, 2006, PDF)](https://cs.uwaterloo.ca/~vanbeek/Publications/survey06.pdf)
- [Peter Norvig — Solving Every Sudoku Puzzle](https://www.norvig.com/sudoku.html)
- [Cloudflare blog — Details of the Cloudflare outage on July 2, 2019](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/)
- [Russ Cox — Regular Expression Matching Can Be Simple And Fast (2007)](https://swtch.com/~rsc/regexp/regexp1.html)
- [RE2 — a fast, safe, thread-friendly alternative to backtracking regex engines](https://github.com/google/re2)
- [OWASP — Regular expression Denial of Service (ReDoS)](https://community.owasp.org/attacks/Regular_expression_Denial_of_Service_-_ReDoS)
- [Python docs — re: atomic groups and possessive quantifiers (3.11+)](https://docs.python.org/3/library/re.html)
- [Microsoft Learn — Best practices for regular expressions in .NET (time-outs, NonBacktracking)](https://learn.microsoft.com/en-us/dotnet/standard/base-types/best-practices-regex)
- [OEIS A000170 — Number of ways of placing n nonattacking queens on an n × n board](https://oeis.org/A000170)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
