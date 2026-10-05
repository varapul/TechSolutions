<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧮 Algorithms & Data Structures](../../README.md#algorithms--data-structures)

# Dijkstra's Shortest Path

> Settle the closest unsettled node, relax its edges, repeat: shortest paths from one source when no edge weight is negative.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Dijkstra's Shortest Path" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/dijkstra.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Tentative distances** | Every node starts with a tentative distance of ∞ except the source, A, at 0, and the priority queue holds a single entry, (0, A). Popping it **settles** A, which then **relaxes** each of its edges: when d[A] + w is less than the neighbour's distance, the neighbour takes the smaller value, remembers A as its previous node and is pushed. B gets 0 + 4 = 4 and C gets 0 + 1 = 1, both still tentative (amber). |
| **2 · Settle the closest** | The smallest entry, (1, C), pops next, and C = 1 is **final**: any other route to C has to leave A along A–B, which already costs 4, and without negative weights a route can only get longer. C's edges lower B from 4 to 3 and give D 6 and E 9; there is no decrease-key, so the old (4, B) entry simply stays in the queue. Then (3, B) pops, B settles at 3, and B–D lowers D from 6 to 4. |
| **3 · Repeat, then read paths** | The loop repeats until the queue is empty, skipping **stale** entries whose node is already settled: (4, B), (6, D) and, at the end, (9, E) and (10, F). D = 4 lowers E to 7 and gives F 10, E = 7 lowers F to 8, and F settles at 8. Following each node's remembered previous node back from F gives A → C → B → D → E → F = 1 + 2 + 1 + 3 + 1 = 8, while A → B → D → F has fewer edges but costs 11. |
| **4 · No negative edges** | Settling the closest node is only safe when no weight is negative. In this directed graph (S → A 2, S → B 3, B → A −2) A pops first and settles at 2; when B later offers S → B → A = 3 − 2 = 1, A is never revisited and the answer stays wrong, so negative weights call for Bellman–Ford. With a binary heap Dijkstra's algorithm costs O((V + E) log V), and it runs inside link-state routing (OSPF, IS-IS), route planners and, as A*, game pathfinding. |
<!-- END GENERATED: header -->

## The problem

A router choosing next hops, a map app planning a drive and a game character walking around a wall all ask the same question: what is the cheapest way from here to everywhere else, when every link has its own cost (a link metric, a distance, a travel time, a delay)? Counting edges does not answer it. [Breadth-first search](../breadth-first-search/) finds a route with the fewest edges; on the diagram's graph it returns A → B → D → F, which costs 4 + 1 + 6 = 11, while A → C → B → D → E → F takes five edges and costs 8. Comparing every route does not scale either: 13 simple routes lead from A to F even in this small graph, and their number can grow exponentially with the size of the graph.

Dijkstra's algorithm finds the shortest distance from one source to every node, and a shortest path to each, settling each reachable node exactly once, as long as no edge weight is negative.

## How it works

**Tentative distances.** In a graph with V nodes and E edges, every node v has a tentative distance d[v]: ∞ at first, 0 for the source. A min-priority queue holds (distance, node) entries and starts with (0, source). A node is *settled* once its distance is known to be final.

**The loop.** Pop the entry with the smallest distance. If its node is already settled, the entry is stale: skip it. Otherwise settle the node u and **relax** each of its edges: for a neighbour v at weight w, if d[u] + w < d[v], the route through u beats anything known so far, so set d[v] to d[u] + w, remember u as v's previous node and push (d[v], v). The run ends when the queue is empty; nodes that were never reached keep ∞.

**Why the closest node is final.** Say u pops with the smallest distance d, and take any other route from the source to u. It has to leave the settled nodes somewhere, along an edge into an unsettled node x, and its cost up to x is at least d[x], because that edge was relaxed when its settled end was settled. d[x] is at least d, because u's entry was the smallest in the queue, and the rest of the route, from x to u, can only add weight when no weight is negative. So no route beats d, and nodes are settled in order of distance: 0, 1, 3, 4, 7 and 8 in the diagram. That is the whole correctness argument. It makes Dijkstra's algorithm a [greedy algorithm](../greedy-algorithms/) whose greedy choice is provably safe, and it is exactly the step that a negative edge breaks.

**Reading the paths.** prev[v] is the neighbour through which v got its final distance, and these links form a shortest-path tree rooted at the source. To get the path to F, follow them back from F (F, E, D, B, C, A) and reverse the list. One link per node is enough because the start of a shortest path, up to any node on it, is itself a shortest path to that node, which is the observation Dijkstra's paper starts from.

**Decrease-key or lazy deletion.** When d[v] drops, v's old entry in the queue is out of date. Textbooks lower it in place with *decrease-key*, which needs a heap that knows where each node sits (Sedgewick and Wayne use an indexed priority queue). Python's `heapq` and Java's `PriorityQueue` have no such operation, and Java's `remove(Object)` takes linear time, so most code does what the diagram does: push a fresh entry and skip the stale one when it surfaces, the same trick the `heapq` documentation suggests for changing a task's priority. The queue then holds up to one entry per edge instead of one per node, which costs memory but not asymptotic time, because log E < 2 log V. In the diagram 10 entries pass through the queue for 6 nodes, and 4 of them turn out stale. [Binary Heap](../binary-heap/) shows how push and pop work inside.

**Ties.** Equal distances may pop in either order. Python compares tuples item by item, so (4, B) pops before (4, D) here because "B" < "D"; nodes that cannot be compared need a counter between the distance and the node, which is what NetworkX does. Equal-cost *paths* are a separate choice: the strict `<` keeps the first route found, while OSPF keeps every next hop that ties so it can spread traffic over them.

**Stopping early.** When only one target matters, stop as soon as it is *popped*, not when it is first reached: F is first reached at 10 and only later drops to 8. Dijkstra's 1959 paper is written this way: it builds the shortest paths from the start in increasing order of length until it reaches the target.

**A\*.** For a single target, A\* (Hart, Nilsson and Raphael, 1968) orders the queue by d[v] + h(v), where h(v) estimates the distance still to go, such as the straight-line distance on a map. If h never overestimates (it is *admissible*), the target's distance is optimal when the target is popped; if also h(u) ≤ w(u, v) + h(v) for every edge (it is *consistent*), no node ever needs to be reopened. With h = 0 it is Dijkstra's algorithm; a good h pulls the search toward the target, so it settles far fewer nodes.

**Where it came from.** Edsger W. Dijkstra designed the algorithm in 1956 to demonstrate the new ARMAC computer in Amsterdam, finding routes on a simplified map of 64 Dutch cities. In a 2001 interview he recalled working it out in about twenty minutes on a café terrace, without pencil and paper. He published it in 1959, in a three-page paper in *Numerische Mathematik* that also solves the minimum spanning tree problem, and preferred it to Ford's method because it stores fewer branches at a time and seemed to need much less work. There was no heap in it: the binary heap was only published in 1964.

### Negative weights

The argument above needs every weight to be at least 0. In step 4's directed graph, S → A costs 2, S → B 3 and B → A −2. A has the smaller tentative distance, so it settles at 2; when B settles at 3 and relaxes B → A, 3 − 2 = 1 is shorter, but A is already final, so the code below leaves it at 2. NetworkX raises an error at that moment instead, and Sedgewick and Wayne's version rejects negative weights before it starts.

- **Bellman–Ford** relaxes every edge V − 1 times, O(V·E), and handles negative weights: after round k no distance is worse than the best route of at most k edges, which makes it [dynamic programming](../dynamic-programming/) over the number of edges. One more round that still lowers a distance proves a negative cycle reachable from the source; with one, no shortest path exists, because every extra lap costs less. In an undirected graph a single negative edge is already such a cycle: cross it and come back. RIP's distance-vector routing is based on Bellman–Ford.
- **Adding a constant to every weight does not fix it.** A route of k edges grows by k times the constant, which favours routes with fewer edges. Add 2 to step 4's weights and S → A costs 4 while S → B → A costs 5 + 0 = 5, so Dijkstra's algorithm picks S → A, which really costs 2.
- **Johnson's algorithm** (1977) reweights correctly. One Bellman–Ford run gives every node a potential h(v), and w(u, v) + h(u) − h(v) is never negative and shifts every route between the same two nodes by the same amount, so Dijkstra's algorithm can then run from each node.
- **In a DAG** no reweighting is needed: relaxing the nodes in [topological order](../topological-sort/) takes O(V + E), negative weights included.

## Code

```python
import heapq
from math import inf


def dijkstra(graph, source):
    """Shortest distances from source. graph maps every node to a list of
    (neighbour, weight) pairs, and no weight may be negative."""
    dist = {node: inf for node in graph}
    prev = {node: None for node in graph}      # the neighbour that gave each distance
    dist[source] = 0
    heap = [(0, source)]
    settled = set()
    while heap:
        d, u = heapq.heappop(heap)             # the closest entry left
        if u in settled:
            continue                           # stale: u was settled with a smaller d
        settled.add(u)                         # d is final
        for v, w in graph[u]:
            if v not in settled and d + w < dist[v]:
                dist[v] = d + w                # relax the edge u-v
                prev[v] = u
                heapq.heappush(heap, (dist[v], v))   # no decrease-key: push again
    return dist, prev


def shortest_path(dist, prev, target):
    """The nodes on a shortest path to target, source first ([] if unreachable)."""
    if dist[target] == inf:
        return []
    path = [target]
    while prev[path[-1]] is not None:
        path.append(prev[path[-1]])
    return path[::-1]


edges = [("A", "B", 4), ("A", "C", 1), ("B", "C", 2), ("B", "D", 1), ("C", "D", 5),
         ("C", "E", 8), ("D", "E", 3), ("D", "F", 6), ("E", "F", 1)]
graph = {node: [] for node in "ABCDEF"}
for u, v, w in edges:                          # undirected: each edge works both ways
    graph[u].append((v, w))
    graph[v].append((u, w))

dist, prev = dijkstra(graph, "A")
print(dist)                                    # {'A': 0, 'B': 3, 'C': 1, 'D': 4, 'E': 7, 'F': 8}
print(shortest_path(dist, prev, "F"))          # ['A', 'C', 'B', 'D', 'E', 'F']
```

The `settled` set is the "never revisited" rule made explicit: with non-negative weights an edge into a settled node could not improve it anyway, and with a negative weight this is exactly where the answer goes wrong. Tested with asserts on the diagram's graph from every source, a single node, an unreachable node (∞ and an empty path), a tie (the first route found is kept), zero weights, parallel edges and a self-loop, and against a brute force over every simple path on 3,000 random graphs of up to 7 nodes, directed and undirected, with weights from 0 to 9. On step 4's graph it returns 2 for A where Bellman–Ford returns 1, and after adding 2 to every weight it picks S → A.

## Complexity

| | Cost | Why |
|---|---|---|
| Worst case, binary heap (the code above) | O((V + E) log V) | Each relaxation that succeeds pushes one entry, at most one per edge, and every entry is popped once. A push or pop costs O(log E), which is O(log V) because E < V². |
| Worst case, array instead of a heap | O(V²) | V rounds, each scanning up to V tentative distances for the smallest; relaxing an edge is O(1). It beats a heap when E is close to V². |
| Worst case, Fibonacci heap | O(E + V log V) | Decrease-key costs O(1) amortized and each of the V pops O(log V) amortized (Fredman and Tarjan, 1987). |
| Best case | O(V + E) | Every reachable node and edge is still examined, but the heap work shrinks when the queue stays small, as on a path. |
| Typical | well below the worst case | With random weights many relaxations fail, more so as the graph gets denser: on a random graph with 10,000 nodes and 500,000 edges our test pushed 41,272 entries, about 4 per node. |
| Extra space | O(V + E) | d, prev and the settled set take O(V); with lazy deletion the heap can hold one entry per edge (O(V) with decrease-key). |

Is O(E + V log V) the limit, in [Big-O](../big-o-notation/) terms? For listing the nodes in order of distance, which is what Dijkstra's algorithm does, essentially yes: Haeupler, Hladík, Rozhoň, Tarjan and Tětek proved it *universally optimal* for that task when its heap has a working-set bound, meaning that on every graph it is as fast as any algorithm can be, up to a constant factor, when the weights are the worst case for that graph. The distances alone can be cheaper. In 2025 Duan, Mao, Mao, Shu and Yin gave a deterministic O(E log^(2/3) V) algorithm for directed graphs with non-negative real weights that may only be compared and added, the first in that model to beat O(E + V log V) on sparse graphs, and a 2026 preprint by four of them lowers that to O(E √(log V · log log V)) on sparse graphs. Both are theoretical results; the libraries below run the classic algorithm.

## When to use it

- **One source and non-negative weights**: the distances from one node to all others, or the path to one target (stop when it pops). Road distances and travel times, link costs and delays, and movement costs on a game map all qualify.
- **All weights equal**: use [breadth-first search](../breadth-first-search/), O(V + E) with a plain first-in, first-out queue.
- **Small integer weights**: a bucket queue, with one list per distance value, can replace the heap; the IS-IS specification points this out for its small metrics.
- **One target and a good estimate of the distance left**: A\*.
- **Many queries on a large graph that rarely changes**, such as a road network: preprocess it. Contraction hierarchies, for example, add shortcut edges in a one-off step so that each query settles only a small part of the graph; OSRM offers them alongside a multi-level variant of Dijkstra's algorithm.
- **All pairs**: run it from every node on sparse graphs, O(V (V + E) log V) in total; Floyd–Warshall's O(V³) suits dense ones.
- **Negative weights**: Bellman–Ford, or Johnson's reweighting for all pairs; on a DAG, topological order.

## Trade-offs

- **Non-negative weights only, and the failure is silent.** The plain algorithm returns a wrong distance without any error. Check the weights first, as Sedgewick and Wayne's `DijkstraSP` does, or use Bellman–Ford.
- **Lazy deletion trades memory for simplicity.** The heap can grow to one entry per edge and every stale entry costs a pop; decrease-key keeps one entry per node but needs an index of heap positions.
- **It explores in every direction.** The settled region grows around the source like a circle, and a point-to-point query settles every node that is closer than the target, which on a continent-sized road graph can be most of it. A\*, bidirectional search and preprocessing exist for that.
- **Equal costs need a decision.** The strict `<` keeps one predecessor per node. To keep all shortest paths, for multipath routing or for counting them, keep a list of predecessors and add to it on ties, as OSPF does with next hops and NetworkX does when asked for predecessors.
- **Floating-point weights round.** Sums of floats can differ in the last bit depending on the order of addition, so near-ties can break either way, and NetworkX's documentation warns that rounding errors can cause problems. Integer costs, like OSPF's link metrics, avoid it.
- **Changes mean recomputing.** When a weight changes, the simple answer is a full rerun. Incremental versions exist, but the IS-IS specification chose full recalculation, noting that with only a couple of link changes an incremental update can already cost more.

## Implementation notes

- **Python**: `heapq` as above. NetworkX's `single_source_dijkstra`, `dijkstra_path` and `bidirectional_dijkstra` push (distance, counter, node) entries so that nodes are never compared, skip nodes already settled, and raise `ValueError` ("Contradictory paths found") when an edge would shorten a settled node, which catches step 4's graph. Given a target, the single-source search stops as soon as it pops it.
- **Java and C++**: neither `java.util.PriorityQueue` nor `std::priority_queue` has decrease-key, so lazy deletion is the usual pattern. `std::priority_queue` keeps the largest item on top by default; pass `std::greater` for a min-heap.
- **Databases**: pgRouting's `pgr_dijkstra` runs the algorithm inside PostgreSQL over an SQL query of edges, using the Boost Graph Library, and treats an edge with a negative cost as missing, so a negative `reverse_cost` makes a street one-way. Neo4j Graph Data Science offers source-target and single-source Dijkstra on a binary heap, and reuses that implementation for A\*, Yen's k shortest paths and weighted betweenness centrality.
- **Link-state routing**: every OSPF router builds a shortest-path tree with itself as the root using Dijkstra's algorithm (RFC 2328, section 16.1). Its "candidate list" is the priority queue, the closest candidate is guaranteed to be shortest, interface costs must be greater than zero, and next hops that tie are all kept for equal-cost multipath, a network-level form of [load balancing](../load-balancing/). IS-IS works the same way. A draft of its ISO specification, republished as RFC 1142 and now historic, gives the cost as the square of the number of nodes, or links times log nodes for sparse networks, and notes that its small original metrics (at most 63 per link and 1,023 per path) allow a list per metric value instead of sorting. The traffic-engineering extensions, now RFC 5305, widened IS-IS link metrics to 24 bits.
- **Latency-based paths**: IGP Flexible Algorithm (RFC 9350) lets routers run the same shortest-path-first calculation over the minimum unidirectional link delay instead of the configured metric, which gives delay-sensitive traffic its own low-latency paths.
- **Route planning**: OSRM, the Open Source Routing Machine, offers contraction hierarchies (CH) and multi-level Dijkstra (MLD) pipelines and recommends MLD by default.
- **Games**: the `findPath` query in Recast & Detour runs A\* over navigation-mesh polygons, with a binary-heap open list and the straight-line distance (scaled by 0.999) as its estimate. By the project's account, Recast powers the navigation features of Unity, Unreal, Godot and O3DE.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Breadth-First Search](../breadth-first-search/) — Explore a graph level by level from a queue; the first time BFS reaches a node, it has found a path with the fewest edges.
- [Binary Heap & Heapsort](../binary-heap/) — A complete binary tree packed into an array keeps the smallest item on top: O(log n) push and pop, the classic priority queue.
- [Greedy Algorithms](../greedy-algorithms/) — Take the choice that looks best right now and never revisit it: optimal for some problems, quietly wrong for others.
- [Dynamic Programming](../dynamic-programming/) — Solve each overlapping subproblem once and reuse its answer, top-down with memoization or bottom-up with a table.
- [Topological Sort](../topological-sort/) — Order tasks so every dependency comes before what needs it, as build tools and package managers do; a cycle makes it impossible.
- [Depth-First Search](../depth-first-search/) — Follow one path as deep as it goes, then backtrack; a stack or recursion remembers where to resume, and finds cycles too.
- [Big-O Notation](../big-o-notation/) — How an algorithm's cost grows with its input: O(1), O(log n), O(n), O(n log n) and O(n²) side by side as n grows.

## References

- [E. W. Dijkstra — A note on two problems in connexion with graphs (Numerische Mathematik 1, 1959; CWI repository)](https://ir.cwi.nl/pub/9256)
- [Philip L. Frana and Thomas J. Misa — An interview with Edsger W. Dijkstra (Communications of the ACM 53(8), 2010)](https://dl.acm.org/doi/10.1145/1787234.1787249)
- [Fredman and Tarjan — Fibonacci heaps and their uses in improved network optimization algorithms (Journal of the ACM 34(3), 1987)](https://dl.acm.org/doi/10.1145/28869.28874)
- [Hart, Nilsson and Raphael — A Formal Basis for the Heuristic Determination of Minimum Cost Paths (IEEE Transactions on Systems Science and Cybernetics 4(2), 1968)](https://doi.org/10.1109/TSSC.1968.300136)
- [Donald B. Johnson — Efficient Algorithms for Shortest Paths in Sparse Networks (Journal of the ACM 24(1), 1977)](https://dl.acm.org/doi/10.1145/321992.321993)
- [Sedgewick and Wayne — Algorithms, 4th edition, 4.4 Shortest Paths](https://algs4.cs.princeton.edu/44sp/)
- [Python documentation — heapq: priority queue implementation notes](https://docs.python.org/3/library/heapq.html#priority-queue-implementation-notes)
- [Java SE 27 API — java.util.PriorityQueue](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/PriorityQueue.html)
- [RFC 2328 — OSPF Version 2, section 16.1: calculating the shortest-path tree](https://www.rfc-editor.org/rfc/rfc2328.html#section-16.1)
- [RFC 1142 — OSI IS-IS Intra-domain Routing Protocol (a republished draft of ISO/IEC 10589, now historic; Annex C.2, the SPF algorithm)](https://www.rfc-editor.org/rfc/rfc1142.html)
- [RFC 5305 — IS-IS Extensions for Traffic Engineering](https://www.rfc-editor.org/rfc/rfc5305.html)
- [RFC 9350 — IGP Flexible Algorithm](https://www.rfc-editor.org/rfc/rfc9350.html)
- [RFC 2453 — RIP Version 2 (distance-vector routing, based on Bellman–Ford)](https://www.rfc-editor.org/rfc/rfc2453.html)
- [Haeupler, Hladík, Rozhoň, Tarjan and Tětek — Universal Optimality of Dijkstra via Beyond-Worst-Case Heaps (arXiv, 2023)](https://arxiv.org/abs/2311.11793)
- [Duan, Mao, Mao, Shu and Yin — Breaking the Sorting Barrier for Directed Single-Source Shortest Paths (arXiv, 2025)](https://arxiv.org/abs/2504.17033)
- [Duan, Mao, Shu and Yin — A Faster Directed Single-Source Shortest Path Algorithm (arXiv, 2026)](https://arxiv.org/abs/2602.07868)
- [NetworkX — Shortest Paths](https://networkx.org/documentation/stable/reference/algorithms/shortest_paths.html)
- [pgRouting — pgr_dijkstra](https://docs.pgrouting.org/latest/en/pgr_dijkstra.html)
- [Neo4j Graph Data Science — Dijkstra Single-Source Shortest Path](https://neo4j.com/docs/graph-data-science/current/algorithms/dijkstra-single-source/)
- [Project OSRM — osrm-backend (contraction hierarchies and multi-level Dijkstra)](https://github.com/Project-OSRM/osrm-backend)
- [Recast & Detour — navigation-mesh toolset for games](https://github.com/recastnavigation/recastnavigation)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
