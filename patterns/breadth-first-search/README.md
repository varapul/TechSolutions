<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧮 Algorithms & Data Structures](../../README.md#algorithms--data-structures)

# Breadth-First Search

> Explore a graph level by level from a queue; the first time BFS reaches a node, it has found a path with the fewest edges.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Breadth-First Search" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/breadth-first-search.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Level by level** | BFS starts at A (dist 0) and first reaches every neighbour of A: B and C, **1 edge** away. Next come their unseen neighbours D, E and F (**2 edges**), and last G and H (**3 edges**). Each ring is finished before the next one starts, so the ring where a node is first reached is its distance from A, counted in edges. |
| **2 · A queue keeps the order** | A first-in, first-out queue produces exactly that ring order. Each round takes the oldest node off the front (blue), checks its neighbours, appends the undiscovered ones to the back (purple) with dist + 1 and a parent link, and is then finished (green). E finds F, and F finds H, already waiting in the queue, so neither joins twice: a node is marked as seen when it is enqueued. The run makes 8 dequeues and 18 edge checks, because each of the 9 edges is checked once from each end. |
| **3 · Fewest edges via parents** | Every node records the neighbour whose check discovered it, and those 7 parent links form a tree rooted at A, the BFS tree. To get a path, start at the target and follow parents, H ← E ← B ← A, then reverse it: A → B → E → H, **3 edges**, which equals dist[H]. No path has fewer: BFS finishes every node at distance d before it reaches any at d + 1, so the first time it reaches a node is along a path with the fewest edges. |
| **4 · Edges, not weights** | Give each edge a travel time and BFS returns the same path, A → B → E → H: 7 + 6 + 5 = **18 minutes**. A → C → F → H also has 3 edges but takes 1 + 2 + 2 = **5 minutes**, the fastest route; BFS cannot tell the two apart because it only counts edges, so weighted shortest paths need Dijkstra's algorithm. BFS itself runs in **O(V + E)** time, but it holds the whole frontier in memory, and in a dense graph such as friends of friends the frontier grows huge. |
<!-- END GENERATED: header -->

## The problem

Many questions about connected things ask for the fewest steps: the fewest hops between two routers, how many introductions separate two people, the fewest moves that solve a puzzle, the shortest way out of a maze in which every corridor costs the same. Each one is a shortest path in an *unweighted* graph, where the length of a path is its number of edges.

Following paths one at a time does not answer it. The number of paths grows fast, and the first path a search happens to find can be long: a depth-first walk of the diagram's graph from A, taking neighbours in alphabetical order, first reaches H through A, B, E, F, H, which is 4 edges where 3 are enough. To know that a path is the shortest, a search has to rule out every shorter one, and the simplest way to do that is to look at everything 1 edge away before anything 2 edges away.

## How it works

BFS keeps three things: a first-in, first-out queue of nodes waiting to be expanded, a `dist` map holding each discovered node's distance from the start, and a `parent` map holding the neighbour that discovered it.

1. Put the start in the queue with `dist[start] = 0`.
2. Take the node at the front of the queue. For each neighbour that has no `dist` yet, set its `dist` to one more than the current node's, record the current node as its parent, and append it to the back of the queue.
3. Repeat until the queue is empty. Every node reachable from the start now has a `dist` and a `parent`; the others have neither.

On the diagram's graph the queue goes through these states, front first: `A`, `B C`, `C D E`, `D E F`, `E F G`, `F G H`, `G H`, `H`, empty. Nodes leave it in the order A B C D E F G H, which is ring 0, then rings 1, 2 and 3.

### Why the first visit is the shortest

The queue always holds some nodes at one distance d followed by some at d + 1, and nothing else: each node added is one step further than the node being expanded, and that node had the smallest distance in the queue. So nodes leave the queue in order of distance, and every node at distance d is expanded before any node at d + 1. When BFS first reaches a node, it does so from the earliest ring that touches it, so no path with fewer edges exists; if one did, the node would have been found from an earlier ring. In an undirected graph it also follows that every edge joins two nodes whose distances differ by at most one. In the diagram, E–F joins two nodes of ring 2 and every other edge joins neighbouring rings.

### Mark a node when it joins the queue

The `dist` map doubles as the visited set, and BFS marks a node when it is enqueued, not when it is dequeued. In step 2, F and H are discovered (by C and by E) while they are still waiting in the queue, so when E checks F and F checks H, the check fails and nothing is added. If marking waited until a node left the queue, both checks would add a second copy: on this graph the queue would take 10 entries instead of 8 and grow to 4 nodes instead of 3, and in general it can hold one entry per edge rather than one per node. With no check at all the search never ends, because every undirected edge leads straight back: A to B to A.

### Paths from parent links

A node's parent is the node whose expansion discovered it, so the parent links form a tree rooted at the start, the **BFS tree**. Following them back from a target and reversing the result gives a shortest path: H ← E ← B ← A becomes A → B → E → H, as in step 3, at a cost of one step per edge of the path.

When several shortest paths tie, BFS keeps whichever it found first, and that depends on the order of the adjacency lists. A → C → F → H also has 3 edges, but B is listed before C, so B's child E is dequeued before C's child F and reaches H first. To count or list every shortest path, record as parents all neighbours u with `dist[u] == dist[v] - 1` instead of only the first one.

### Adjacency lists, matrices and O(V + E)

With adjacency lists, each reachable node is enqueued and dequeued once and its list is read once, so a run costs V dequeues plus one check per list entry: 2E checks in an undirected graph, E in a directed one. The diagram's run makes 8 dequeues and 18 checks for 9 edges. With an adjacency matrix, finding a node's neighbours means scanning a row of V entries, so BFS costs O(V²) however few edges there are. That is fine for small dense graphs and wasteful for the large sparse ones that road maps, networks and social graphs usually are, where each node has a handful or a few hundred neighbours out of millions of nodes.

### Grids and implicit graphs

The graph does not have to exist as a data structure. A maze or game map is a grid whose cells are nodes and whose moves into open neighbouring cells are edges; the tests below run the same `bfs` on a small maze. Flood fill, the paint bucket of an image editor, is a search over neighbouring pixels of the same colour. A word ladder, which changes one letter at a time and must make a real word at every step, is BFS over words, and a sliding puzzle is BFS over board positions with one edge per legal move. Here the neighbours are generated on the fly, and the visited set, a hash set of states (see [Hash Table](../hash-table/)), is often the largest structure in memory.

### Variants

- **Multi-source BFS** starts with several nodes in the queue at distance 0 and gives every node its distance to the *nearest* source: the nearest exit from every cell of a map, or the nearest depot for every town. NetworkX's `bfs_layers` takes a list of sources for this.
- **0-1 BFS** handles edges that cost 0 or 1 with a deque: a neighbour across a 0-edge goes on the front and one across a 1-edge on the back, so the deque stays ordered by distance and weighted shortest paths still cost O(V + E), without a priority queue. A node can be pushed again when a cheaper route to it turns up.
- **Bidirectional BFS** searches from the start and from the target at once and stops when the two frontiers meet. If each node has about b neighbours and the target is d edges away, each side goes only about d/2 deep: roughly 2·b^(d/2) nodes instead of b^d.
- **Depth-limited BFS** stops after a fixed number of hops: everyone within two hops, every page within three clicks. NetworkX's `bfs_edges` takes a `depth_limit`.

### Components, two-colouring and trees

- **Connected components:** run BFS from every node that is still unvisited. Each run marks one component, and all the runs together cost O(V + E).
- **Bipartite check:** colour each node by whether its distance is even or odd. The graph splits into two sides with every edge crossing between them exactly when no edge joins two nodes of the same ring. In the diagram, E and F are both at distance 2 and share an edge, which closes the 5-edge cycle A, B, E, F, C, so this graph is not bipartite.
- **Level-order traversal:** in a tree, BFS from the root visits the nodes level by level, and it needs no visited set because each node has exactly one parent. It prints a tree by levels and finds the shallowest node that passes a test, as in the traversal table of [Binary Search Tree](../binary-search-tree/). A [Binary Heap](../binary-heap/) stores its tree in an array in exactly this order.

### Where it comes from

Konrad Zuse wrote the method down in 1945, in his manuscript on the Plankalkül programming language: a program that takes a graph as a list of pairs, processes its points in the order they were found and appends newly reached ones to the end of the list, to split the graph into connected groups. The manuscript was not published until 1972. Edward F. Moore found the idea again for the shortest path through a maze, published in 1959, and C. Y. Lee used it in 1961 to route wires: his router labels grid cells outward from the start with their distance, a wave of rising numbers, then traces a path back from the target along falling labels.

## Code

```python
from collections import deque


def bfs(graph, start):
    """Fewest-edge distances and parent links from start.

    graph maps each node to a list of its neighbours.
    Returns (dist, parent) for every node reachable from start.
    """
    dist, parent = {start: 0}, {start: None}
    queue = deque([start])
    while queue:
        u = queue.popleft()                    # the oldest waiting node
        for v in graph[u]:
            if v not in dist:                  # mark when queued, so v joins only once
                dist[v] = dist[u] + 1
                parent[v] = u
                queue.append(v)
    return dist, parent


def path(parent, target):
    """The start-to-target path, read from parent links (empty if unreachable)."""
    if target not in parent:
        return []
    nodes = []
    while target is not None:
        nodes.append(target)
        target = parent[target]
    return nodes[::-1]


graph = {'A': ['B', 'C'], 'B': ['A', 'D', 'E'], 'C': ['A', 'F'], 'D': ['B', 'G'],
         'E': ['B', 'F', 'H'], 'F': ['C', 'E', 'H'], 'G': ['D'], 'H': ['E', 'F']}
dist, parent = bfs(graph, 'A')
print(dist)
print(path(parent, 'H'))
# {'A': 0, 'B': 1, 'C': 1, 'D': 2, 'E': 2, 'F': 2, 'G': 3, 'H': 3}
# ['A', 'B', 'E', 'H']
```

The queue is a `collections.deque` because `popleft()` takes constant time, while `list.pop(0)` moves every remaining item and costs O(n). The `dist` dictionary also records the visit order, since Python dictionaries keep insertion order: `list(dist)` is A to H in the order of step 2. The tests checked all of the distances and parents above, a disconnected graph (unreachable nodes get no entry and an empty path), a single node with and without a self-loop, a directed graph, a 4 × 8 grid maze whose exit is 12 moves away, and 400 random graphs of up to 14 nodes whose distances all matched the Floyd–Warshall all-pairs algorithm.

## Complexity

| | Cost | Why |
|---|---|---|
| Best time | O(1) | Only with an early exit when looking for one target: the search can stop as soon as it discovers the target, which may be the first neighbour it checks. A full run always does the work below. |
| Average time | O(V + E) | A full run expands every reachable node once and reads its whole adjacency list, whatever the shape of the graph. |
| Worst time | O(V + E) | V dequeues plus one check per adjacency-list entry, which is 2E in an undirected graph: 8 dequeues and 18 checks in the diagram. With an adjacency matrix it is O(V²). |
| Extra space | O(V) | `dist`, `parent` and the queue each hold at most one entry per node. The queue holds the frontier, at most two rings at a time, and in a wide graph that can be most of the graph. |

Stable and in place do not apply to a graph search. The distances count edges only; for weighted edges use Dijkstra's algorithm or 0-1 BFS when every weight is 0 or 1.

## When to use it

- The fewest steps in a graph where every step costs the same: hops between routers or services, degrees of separation, the fewest moves in a puzzle or game, a route across a grid with uniform moves.
- Everything within k steps: friends of friends, the pages within three clicks of a home page, the services within two calls of one that is failing.
- Work that should go nearest first: level-order processing of a tree, the closest node that matches a test, a signal that spreads one round at a time.
- Connected components and two-colouring, where depth-first search does just as well.
- Not for weighted shortest paths (that is Dijkstra's algorithm), and not when the graph is wide, the answer is deep and memory is short: depth-first search keeps only the current path.

## Trade-offs

- **Memory goes to the frontier.** BFS keeps every node it has discovered but not yet expanded. If everyone has 200 friends, the second ring can hold up to 200² = 40,000 people and the third up to 8,000,000 (fewer in practice, because friends overlap), and the visited set grows with them. Depth-first search holds only the path it is on, and iterative deepening (Richard Korf, 1985) runs depth-first searches limited to 1, 2, 3, … edges, which finds the same fewest-edge depth with memory for one path, at the price of repeating the shallow levels.
- **It counts edges, not costs.** Travel times, prices and latencies are invisible to it, so it confidently returns the 18-minute route of step 4.
- **Ties depend on adjacency order.** When several shortest paths exist, the one BFS returns depends on the order in which neighbours are listed; fix that order if results must be reproducible.
- **The visited set must fit.** In an implicit graph such as puzzle positions or web pages, it holds every state seen so far, and it can outgrow the queue.
- **No recursion to worry about.** BFS is a loop over a queue, so a long chain of nodes never threatens the call stack, unlike recursive depth-first search (see [Recursion](../recursion/)).

## Implementation notes

- **Python:** use `collections.deque`; its documentation promises roughly O(1) appends and pops at either end and warns that `list.pop(0)` costs O(n). NetworkX has `bfs_edges`, `bfs_tree`, `bfs_layers` (several sources at once) and `shortest_path`, which falls back to its unweighted methods, breadth-first searches, when no weight is given; `bidirectional_shortest_path` searches from both ends.
- **Graph databases:** Neo4j's Cypher manual says that `SHORTEST` and `shortestPath()` find the shortest paths by number of hops, using bidirectional breadth-first searches from both ends when the planner expects one source and one target, and a one-directional BFS from the source when there can be many targets. For a weighted shortest path, it points to the Graph Data Science library instead, which is the lesson of step 4.
- **SQL:** PostgreSQL evaluates a recursive common table expression (`WITH RECURSIVE`) in rounds: each round runs the recursive part over the rows the previous round produced, its *working table*, until a round adds nothing, much like BFS moving out one ring at a time. With `UNION` instead of `UNION ALL`, rows that repeat an earlier result are discarded, a visited set for rows. Since PostgreSQL 14 the SQL-standard `SEARCH BREADTH FIRST BY` clause adds a column for sorting the results into breadth-first order (it does not change how the query is evaluated), and `CYCLE` marks rows that close a cycle.
- **Crawlers:** Scrapy's default scheduler keeps pending requests in a LIFO queue and therefore crawls depth-first; its documentation shows how to crawl breadth-first with `DEPTH_PRIORITY = 1` and FIFO queues, and a duplicate filter drops requests it has already seen, which is the visited set. Concurrent requests blur either order at the start of a crawl. Marc Najork and Janet Wiener crawled 328 million pages in breadth-first order and found that it reaches pages with high PageRank early. Spread over many machines, the frontier becomes a shared work queue ([Competing Consumers](../competing-consumers/)), and with many workers taking from it at once the pages come out in only roughly breadth-first order.
- **Garbage collectors:** C. J. Cheney's 1970 copying collector is a BFS over the object graph that needs no separate queue. It copies the objects the roots point to into an empty region, then scans the copies in order and copies every object they point to that has not been copied yet to the end of the region. The copied but unscanned objects between the scan pointer and the end of the region are the queue, and the forwarding address left in each old object is the visited mark.
- **Build tools:** Maven settles conflicting versions of a dependency by "nearest definition": the version closest to the project in the dependency tree wins, and at equal depth the first declaration wins, which is the version a breadth-first walk of the tree meets first.
- **Benchmarks:** the Graph 500 benchmark, aimed at data-intensive supercomputing, times a breadth-first search over a large generated graph as one of its kernels and reports the result in traversed edges per second (TEPS).

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Depth-First Search](../depth-first-search/) — Follow one path as deep as it goes, then backtrack; a stack or recursion remembers where to resume, and finds cycles too.
- [Dijkstra's Shortest Path](../dijkstra/) — Settle the closest unsettled node, relax its edges, repeat: shortest paths from one source when no edge weight is negative.
- [Topological Sort](../topological-sort/) — Order tasks so every dependency comes before what needs it, as build tools and package managers do; a cycle makes it impossible.
- [Binary Search Tree](../binary-search-tree/) — Smaller keys left, larger right: O(log n) search and insert while the tree stays balanced, O(n) once it degrades into a list.
- [Hash Table](../hash-table/) — Hash each key straight to a bucket for O(1) average lookups; colliding keys share a bucket, and the table grows as it fills.
- [Big-O Notation](../big-o-notation/) — How an algorithm's cost grows with its input: O(1), O(log n), O(n), O(n log n) and O(n²) side by side as n grows.

## References

- [Sedgewick and Wayne — Algorithms, 4th edition, 4.1 Undirected Graphs](https://algs4.cs.princeton.edu/41graph/)
- [Konrad Zuse — Der Plankalkül (written 1945, published 1972), Konrad Zuse Internet Archive](https://zuse.zib.de/item/gHI1cNsUuQweHB6)
- [Edward F. Moore — The Shortest Path Through a Maze, in Proceedings of an International Symposium on the Theory of Switching, Part II (Harvard University Press, 1959)](https://archive.org/details/proceedingsofint0030unse)
- [C. Y. Lee — An Algorithm for Path Connections and Its Applications (IRE Transactions on Electronic Computers, 1961)](https://doi.org/10.1109/TEC.1961.5219222)
- [C. J. Cheney — A Nonrecursive List Compacting Algorithm (Communications of the ACM, 1970)](https://doi.org/10.1145/362790.362798)
- [Marc Najork and Janet L. Wiener — Breadth-First Search Crawling Yields High-Quality Pages (WWW10, 2001)](https://web.archive.org/web/20060111070443/http://www10.org/cdrom/papers/208/)
- [Python documentation — collections.deque](https://docs.python.org/3/library/collections.html#collections.deque)
- [NetworkX documentation — Traversal: Breadth First Search](https://networkx.org/documentation/stable/reference/algorithms/traversal.html)
- [Neo4j Cypher Manual — Shortest paths](https://neo4j.com/docs/cypher-manual/current/patterns/shortest-paths/)
- [PostgreSQL documentation — WITH Queries (Common Table Expressions)](https://www.postgresql.org/docs/current/queries-with.html)
- [Scrapy documentation — Scheduler: request order](https://docs.scrapy.org/en/latest/topics/scheduler.html)
- [Cornell CS 4120 — Memory Management and Garbage Collection (copying collection and Cheney's algorithm)](https://www.cs.cornell.edu/courses/cs4120/2022sp/notes/gc/)
- [cp-algorithms — 0-1 BFS](https://cp-algorithms.com/graph/01_bfs.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
