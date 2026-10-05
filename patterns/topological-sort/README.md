<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧮 Algorithms & Data Structures](../../README.md#algorithms--data-structures)

# Topological Sort

> Order tasks so every dependency comes before what needs it, as build tools and package managers do; a cycle makes it impossible.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Topological Sort" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/topological-sort.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Dependencies as a graph** | Each module is a node, and an arrow from A to B means A must be built before B. The badge on a module is its **in-degree**: how many of its prerequisites are not built yet. api waits on users, orders and logging, so its badge is 3; only utils has 0, so it is the only module that can start, and it goes into the ready queue. |
| **2 · Build what's ready** | Kahn's algorithm takes the module at the front of the queue, appends it to the build order and subtracts 1 from the badge of every module its arrows point to; a module whose badge reaches 0 joins the back of the queue. Building config readies db and cache, while building db only lowers users and orders to 1. Every module is output once and every arrow is followed once, so the order utils, config, logging, db, cache, users, orders, api takes **O(V + E)** time. |
| **3 · Waves run in parallel** | Each module becomes ready one round after its latest prerequisite: {utils}, {config, logging}, {db, cache}, {users}, {orders}, {api}. No arrow joins two modules of the same round, so a build tool can build them at the same time: **6 rounds instead of 8 builds in a row**, as many as there are modules on the longest chain. Any order in which every arrow points forward is valid (config and logging can swap), so a graph usually has more than one topological order. |
| **4 · A cycle stops it** | A new import makes users need orders, but orders already needs users. The rerun outputs utils, config, logging, db and cache; then the queue is empty while users (badge 1), orders (badge 1) and api (badge 2) never reach 0, because users and orders wait for each other and api waits on both. Fewer than 8 modules output means there is a cycle, so the build reports `cycle: users → orders → users` instead of an order. |
<!-- END GENERATED: header -->

## The problem

A build has to compile a library before the code that imports it. A package manager has to install a dependency before the package that needs it, and a migration that adds a foreign key has to run after the one that creates the table it points to. Each tool is handed a pile of "A before B" rules, often declared one at a time by different people, and needs one sequence that satisfies all of them at once. It also has to notice when the rules contradict each other, because then no such sequence exists.

Trying orders until one fits is hopeless: 8 modules can be lined up in 8! = 40,320 ways, and 20 modules in about 2.4 × 10¹⁸. A topological sort finds a valid order, or proves that there is none, in time proportional to the number of modules plus the number of dependencies.

## How it works

Draw each task as a node and each rule "A must come before B" as an arrow A → B; in a build it reads *A builds before B*. A **topological order** lists every node so that all arrows point forward, from earlier in the list to later. One exists exactly when the graph has no directed cycle, that is, when it is a DAG (directed acyclic graph):

- If there is a cycle, whichever of its nodes comes first in a proposed order has an arrow coming in from a node placed after it, so no order works.
- If there is no cycle, some node has no incoming arrows: walking backwards along arrows from any node has to stop, because coming back to a node would close a cycle. Put such a node first, remove it, and repeat on what is left. That argument is already an algorithm.

### Kahn's algorithm

A. B. Kahn published this procedure in 1962 for ordering PERT project networks. He described it for the IBM 7090 and reported that a network of 30,000 activities could be ordered in under an hour of machine time.

1. Count each node's incoming arrows: its **in-degree**, the badges in the diagram. Here they start at utils 0, config 1, logging 1, db 1, cache 1, users 2, orders 2 and api 3.
2. Put every node whose count is 0 in a queue. Only utils qualifies.
3. Until the queue is empty, take the node at the front, append it to the output, and subtract 1 from the count of each node its arrows point to. A node whose count reaches 0 has no unfinished prerequisites left, so it joins the back of the queue.

A count is the number of a node's prerequisites that are not in the output yet, so a node can only enter the queue after all of them are output, and every arrow ends up pointing forward. In the diagram, outputting config readies db and cache; outputting db only lowers users and orders to 1; once cache is out, users is ready, and outputting users readies orders and lowers api to 1. The run gives utils, config, logging, db, cache, users, orders, api.

### Which ready node goes next

Any rule for choosing among the ready nodes produces a valid order, so the container is a design choice:

- A **FIFO queue**, as in the diagram, outputs the graph round by round: every node that became ready in one round comes out before anything that round unlocks, much as [Breadth-First Search](../breadth-first-search/) visits a graph level by level.
- A **stack** is just as correct and tends to follow one chain further before returning to the others.
- A **priority queue** (a [binary heap](../binary-heap/) keyed by name, priority or ID) always takes the smallest ready key; keyed by name, it yields the alphabetically first valid order. The output then depends only on the graph, not on the order in which its nodes and arrows were listed, at a cost of O(log V) per node.

A graph rarely has just one valid order. Here config and logging can swap, db and cache can swap, and logging could go anywhere between utils and api. Sedgewick and Wayne point out that the order is unique only when every pair of neighbours in it is joined by an arrow, so that the order traces a path through all the nodes. Given the same 11 pairs, the `tsort` that ships with macOS printed utils, logging, config, cache, db, users, orders, api: a different order, and just as valid.

### The cycle check comes free

If the queue runs dry before every node is output, each leftover node still has a prerequisite among the leftovers, so none of them can ever reach 0: the graph has a cycle, and every leftover node is on it or downstream of it. In step 4, users and orders form the cycle, while api is only stuck behind them. The leftover set is therefore a poor error message. To name the cycle itself, start at any leftover node and keep stepping back to one of its leftover prerequisites until a node repeats: from api you reach users, then orders, then users again, so the cycle is users → orders → users. Python's `graphlib` reports this graph's cycle in the same form, `['users', 'orders', 'users']`.

### The depth-first alternative

[Depth-First Search](../depth-first-search/) produces a topological order as well. Run it from every unvisited node and record each node at the moment its call finishes, when everything reachable from it is done. Along any arrow A → B, B finishes before A, so reversing the finish order (reverse postorder) puts every prerequisite before its dependents. Sedgewick and Wayne state both this and its running time, proportional to V + E, as propositions. A cycle shows up as an arrow to a node whose call is still on the stack, a back edge. The DFS version needs no counts, but a long chain of dependencies means deep [recursion](../recursion/) unless the search keeps its own stack, and it doesn't give you the rounds of step 3.

### Waves, parallel builds and the critical path

Give each node a round: 1 for a node without prerequisites, otherwise one more than the latest round among its prerequisites. Here that gives {utils}, {config, logging}, {db, cache}, {users}, {orders} and {api}. No arrow can join two nodes of the same round, because its target would land at least one round later, so a build tool with enough workers can build each round all at once: 6 rounds instead of 8 builds in a row. Two workers are enough here, because no round holds more than two modules.

The number of rounds equals the number of nodes on the longest path, here utils → config → db → users → orders → api (or the same chain through cache): the **critical path**. When tasks take different amounts of time, one pass over a topological order computes it: a task's earliest finish is its own duration plus the latest earliest finish among its prerequisites, and the largest of these is the shortest possible total time with enough workers. That is dynamic programming on a DAG, which [Dynamic Programming](../dynamic-programming/) covers in general. Real schedulers also do better than strict rounds: instead of waiting for the slowest member of a round, they start each task as soon as its own prerequisites are done. Python's `graphlib` hands out work this way, and so does Terraform when it walks its resource graph.

## Code

`graph` maps each node to the nodes that need it, the build direction of the arrows. (Python's `graphlib` takes the opposite: each node mapped to its predecessors.)

```python
from collections import deque


def kahn(graph):
    """Return all nodes, each one after its prerequisites.

    graph maps every node to the nodes that need it (its outgoing arrows).
    """
    count = dict.fromkeys(graph, 0)              # in-degree: prerequisites not output yet
    for node in graph:
        for after in graph[node]:
            count[after] = count.get(after, 0) + 1
    ready = deque(node for node, n in count.items() if n == 0)
    order = []
    while ready:
        node = ready.popleft()                   # FIFO: the oldest ready node
        order.append(node)
        for after in graph.get(node, ()):
            count[after] -= 1
            if count[after] == 0:                # its last prerequisite is done
                ready.append(after)
    if len(order) < len(count):                  # someone never became ready
        stuck = [node for node, n in count.items() if n > 0]
        raise ValueError(f"cycle: {stuck} never became ready")
    return order


def waves(graph):
    """Group the nodes into rounds; nothing in a round needs anything else in it."""
    order = kahn(graph)                          # raises on a cycle
    level = dict.fromkeys(order, 0)
    for node in order:                           # prerequisites come first, so
        for after in graph.get(node, ()):        # level[node] is already final
            level[after] = max(level[after], level[node] + 1)
    rounds = [[] for _ in range(max(level.values(), default=-1) + 1)]
    for node in order:
        rounds[level[node]].append(node)
    return rounds


deps = {
    "utils": ["config", "logging"], "config": ["db", "cache"], "logging": ["api"],
    "db": ["users", "orders"], "cache": ["users"], "users": ["orders", "api"],
    "orders": ["api"], "api": [],
}
print(kahn(deps))
# ['utils', 'config', 'logging', 'db', 'cache', 'users', 'orders', 'api']
print(waves(deps))
# [['utils'], ['config', 'logging'], ['db', 'cache'], ['users'], ['orders'], ['api']]
deps["orders"].append("users")                   # a new import: users needs orders too
kahn(deps)
# ValueError: cycle: ['users', 'orders', 'api'] never became ready
```

`waves` is the critical-path computation with every task taking one unit of time: it walks a topological order and pushes each node's round past its prerequisites' rounds. The tests ran both functions on the diagram's graph and its cycle variant, an empty graph, a single node, isolated nodes, a node that appears only as a target, a duplicate arrow, a self-loop, cycles of two and three nodes, a chain of 1,001 nodes and 3,000 random graphs of up to 9 nodes, with and without cycles. Every result was checked against a brute-force cycle finder and for arrows that point backwards, and `graphlib`'s `static_order()` gave a valid order on every acyclic graph. On the diagram's graph it happens to return the same order as `kahn`, and its `get_ready()` batches match `waves`; nothing guarantees that in general.

## Complexity

| | Cost | Why |
|---|---|---|
| Best time | O(V + E) | Even a graph that is already listed in order has to be read: counting the in-degrees touches every arrow. |
| Average time | O(V + E) | Every node enters the queue and the output once, and every arrow lowers one count once. |
| Worst time | O(V + E) | The same bound holds for every input; a cycle only ends the loop early. A priority queue instead of a FIFO makes it O(V log V + E). |
| Extra space | O(V) | One count per node, plus the queue and the output, each at most V long. The graph itself, as adjacency lists, takes O(V + E). |

`waves` adds one more pass over the nodes and arrows, so it is O(V + E) too (see [Big-O Notation](../big-o-notation/)). Stable and in place don't apply to a graph. The FIFO version is deterministic for a given input, but listing the same nodes or arrows in a different order can change its output.

## When to use it

- Anything with prerequisites: build steps, package installs, database migrations, service start-up, data-pipeline tasks, schema objects (tables before the views and foreign keys that refer to them).
- Running independent work in parallel: hand out tasks round by round, or better as soon as each one's own prerequisites are done, and look at the critical path to see which chain sets the total time.
- Checking an architecture for cycles: sort the module or service dependency graph in CI and fail when anything is left over, which catches a step-4 import the day it is added.
- When cycles are legitimate (mutual recursion, feedback between components), collapse each strongly connected component into a single node first (Sedgewick and Wayne's section 4.2 covers strong components); the collapsed graph is a DAG and can be sorted.
- It plans an order; it doesn't run anything or handle failures. Running a multi-step business workflow with retries and compensation is the job of an orchestrator, as in [Saga Orchestration](../saga-orchestration/).

## Trade-offs

- **It only knows the arrows you declare.** A dependency nobody wrote down is invisible, so the work succeeds in one valid order and fails in another. Builds often break this way when parallel execution (`make -j`) starts running things in a new order.
- **More than one valid order.** The output can change when the input is listed differently, which makes builds and deployments hard to reproduce. Pick ready nodes with a priority queue when the order must be stable.
- **A single list hides the parallelism.** Eight builds in a row take longer than six rounds, and rounds still wait for their slowest member; starting each task when its own prerequisites finish does better.
- **The leftover set is not the cycle.** It includes everything downstream of the cycle (api here), so report a cycle path, as `graphlib` does.
- **Some tools work around a cycle instead of failing.** GNU make reports a loop as `Circular xxx <- yyy dependency dropped.` and continues without that dependency. pip documents that in a dependency cycle it installs the first member it meets last (and that this may change), and the BSD `tsort` that ships with macOS ignores one arrow of the cycle and carries on. Each still produces an order, but at least one dependency in it is broken, so treat those warnings as errors.
- **The graph has to be known up front.** Kahn's algorithm starts from complete in-degree counts, and `graphlib`'s sorter accepts no new nodes once `prepare()` has been called, so dependencies discovered while the work runs need a different design.

## Implementation notes

- **Python:** [`graphlib.TopologicalSorter`](https://docs.python.org/3/library/graphlib.html) (Python 3.9 and later) takes a mapping from each node to its predecessors. `static_order()` yields one valid order. For parallel work, `prepare()`, then `get_ready()` to hand out every node that is ready and `done()` as each one finishes, so finished nodes unlock their successors. A cycle raises `CycleError`, a subclass of `ValueError`, from `prepare()`, with the cycle as the second item of `args` and its first node repeated at the end. For step 4's graph, Python 3.11 reported `['users', 'orders', 'users']`.
- **Build tools:** before make can finish a target, it processes the rules for the files the target depends on, and `-j` runs independent recipes at the same time. Bazel calls the acyclic graph of "depends upon" relations between targets the dependency graph. Maven's reactor collects the modules of a multi-module project, sorts them into build order and builds them in that order.
- **Package managers:** since version 6.1.0, pip installs dependencies before their dependents, "in topological order", and documents that as its only promise about order (it doesn't cover build dependencies).
- **Infrastructure as code:** Terraform builds a dependency graph of resources, checks that it has no cycles, and walks it in parallel: a node is processed as soon as all of its dependencies are, up to 10 at a time by default (`-parallelism` on `plan`, `apply` and `destroy`). `terraform graph` prints the graph in DOT format.
- **Schedulers:** an Airflow Dag (the name comes from directed acyclic graph) declares task dependencies with `>>` and `<<`, and by default a task runs only after all of its upstream tasks have succeeded (the `all_success` trigger rule). systemd orders units with `Before=` and `After=`: units with no ordering between them start and stop at the same time, shutdown reverses the start-up order, and ordering is separate from requirement dependencies such as `Requires=` and `Wants=`.
- **Database migrations:** Django records dependencies between migrations. Adding a `ForeignKey` from a books app to an authors app makes the new migration depend on one in authors, so the authors table is created before the column that references it.
- **Spreadsheets:** Excel keeps a dependency tree of cells and a calculation chain that lists formulas in the order they should be calculated. When a formula turns out to depend on a cell not calculated yet, Excel moves it and its dependents down the chain, so the order corrects itself during recalculation. A cell that depends on itself, directly or indirectly, is a circular reference, which Excel warns about; iterative calculation exists for models that loop on purpose.
- **Circular dependencies are an architecture smell.** Go makes them illegal: a package may not import itself, directly or indirectly. Python allows import cycles but can fail at import time; on CPython 3.11, two modules that import a name from each other at the top level fail with `ImportError: cannot import name 'f' from partially initialized module 'a' (most likely due to a circular import)`. In a [Modular Monolith](../modular-monolith/), a cycle between modules means neither can be changed, tested or extracted on its own; between [Microservices](../microservices/), a cycle of synchronous calls ties their deployments and failures together. Break a cycle by moving the shared part into a module both can depend on, by inverting one dependency behind an interface, or by replacing a call with an event.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Depth-First Search](../depth-first-search/) — Follow one path as deep as it goes, then backtrack; a stack or recursion remembers where to resume, and finds cycles too.
- [Breadth-First Search](../breadth-first-search/) — Explore a graph level by level from a queue; the first time BFS reaches a node, it has found a path with the fewest edges.
- [Dynamic Programming](../dynamic-programming/) — Solve each overlapping subproblem once and reuse its answer, top-down with memoization or bottom-up with a table.
- [Modular Monolith](../modular-monolith/) — One deployable unit built from strongly bounded modules that talk through explicit interfaces.
- [Microservices](../microservices/) — Small, independently deployable services, each owning one business capability and its data.
- [Saga (Orchestration)](../saga-orchestration/) — A coordinator runs local transactions in sequence and triggers compensations when one fails.
- [Big-O Notation](../big-o-notation/) — How an algorithm's cost grows with its input: O(1), O(log n), O(n), O(n log n) and O(n²) side by side as n grows.

## References

- [A. B. Kahn — Topological sorting of large networks (Communications of the ACM 5(11), 1962)](https://dl.acm.org/doi/10.1145/368996.369025)
- [Sedgewick and Wayne — Algorithms, 4th edition, 4.2 Directed Graphs](https://algs4.cs.princeton.edu/42digraph/)
- [Python documentation — graphlib: functionality to operate with graph-like structures](https://docs.python.org/3/library/graphlib.html)
- [GNU make manual — How make Processes a Makefile](https://www.gnu.org/software/make/manual/html_node/How-Make-Works.html)
- [GNU make manual — Parallel Execution](https://www.gnu.org/software/make/manual/html_node/Parallel.html)
- [GNU make manual — Errors Generated by Make](https://www.gnu.org/software/make/manual/html_node/Error-Messages.html)
- [GNU Coreutils — tsort: Topological sort](https://www.gnu.org/software/coreutils/manual/html_node/tsort-invocation.html)
- [Bazel documentation — Dependencies](https://bazel.build/concepts/dependencies)
- [Apache Maven — Guide to Working with Multiple Modules](https://maven.apache.org/guides/mini/guide-multiple-modules.html)
- [pip documentation — pip install: Installation Order](https://pip.pypa.io/en/stable/cli/pip_install/)
- [Terraform documentation — Dependency Graph](https://developer.hashicorp.com/terraform/internals/graph)
- [Apache Airflow documentation — Dags](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dags.html)
- [Django documentation — Migrations: Dependencies](https://docs.djangoproject.com/en/stable/topics/migrations/)
- [Microsoft Learn — Excel Recalculation](https://learn.microsoft.com/en-us/office/client-developer/excel/excel-recalculation)
- [The Go Programming Language Specification — Import declarations](https://go.dev/ref/spec#Import_declarations)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
