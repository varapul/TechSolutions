<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧮 Algorithms & Data Structures](../../README.md#algorithms--data-structures)

# Binary Search Tree

> Smaller keys left, larger right: O(log n) search and insert while the tree stays balanced, O(n) once it degrades into a list.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Binary Search Tree" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/binary-search-tree.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Smaller left, larger right** | Keys arrive one at a time. 50, 30 and 70 are in place; 20 is smaller than 50 and than 30, so it goes left twice and attaches where it finds an empty spot. 40, 60 and 80 also take two comparisons each and fill the other three empty spots. The rule leaves one property true at every node: every key in its left subtree is smaller, and every key in its right subtree is larger. |
| **2 · Search, insert at a miss** | Searching for 60 compares it with 50 (go right), 70 (go left) and 60 (found): **3 comparisons**. Searching for 65 makes the same moves and then finds 60's right child empty, so 65 is not in the tree, and `insert(65)` attaches it at exactly that spot. Each comparison rules out a whole subtree, as binary search rules out half an array, but an insert only links one new node: no keys shift. |
| **3 · In-order is sorted** | An in-order walk visits a node's left subtree, then the node, then its right subtree. Every key on the left is smaller and every key on the right larger, so the keys come out sorted: 20, 30, 40, 50, 60, 65, 70, 80. Sorted iteration and range queries (all keys from 35 to 62 are 40, 50 and 60) are what a hash table cannot give you. |
| **4 · Balance is everything** | Insert the same eight keys in sorted order into an empty tree and each one is larger than everything already there, so it goes right every time: the tree becomes a chain 8 levels deep, in effect a linked list, and finding 80 takes **8 comparisons instead of 3**. Search and insert cost O(height), which is O(log n) only while the tree stays balanced. Self-balancing trees (red-black, AVL) rotate after inserts and deletes to keep the height O(log n); Java's `TreeMap` is a red-black tree and C++ `std::map` usually is one, and databases use B-trees, whose wide nodes each fill a disk page. |
<!-- END GENERATED: header -->

## The problem

Many programs keep a collection in order while it changes: timers by deadline, orders by price, sessions by expiry time, rows by key. They ask exact questions ("is 42 here?") and ordered ones: the smallest key, the next key after 42, every key from 35 to 62.

The simple structures each fail at one of these. A sorted array answers all of them with [Binary Search](../binary-search/) in O(log n), but every insert or delete shifts O(n) items to keep the array sorted. A linked list can splice in a node in O(1), but finding the place takes O(n). A [Hash Table](../hash-table/) finds an exact key in O(1) on average, but it keeps no order, so "next" and "between" mean looking at every key.

A binary search tree keeps the keys in linked nodes, arranged so that each comparison still rules out a whole part of the collection, as binary search does on an array, while an insert only has to link one new node.

## How it works

Each node holds a key and two links, left and right; a missing child is an empty link. The tree keeps one rule, the **BST property**, at every node: every key in the node's left subtree is smaller than the node's key, and every key in its right subtree is larger.

### Search and insert

- **Search** starts at the root. If the key equals the node's key, it is found. If it is smaller, the search continues in the left subtree; if larger, in the right one. Each comparison discards the other subtree, so a search makes at most one comparison per level. Reaching an empty link means the key is not in the tree.
- **Insert** runs the same search. When the search falls off the tree, the empty link where it stopped is the only place the key can go without breaking the property, so the new node is attached there and nothing else moves. In step 2, 65 is larger than 50, smaller than 70 and larger than 60, so it becomes the right child of 60.
- **Duplicates** need a policy. A set ignores them (the code below returns `False`), a map replaces the value (Java's `TreeMap.put` does), and a tree that must keep copies either sends equal keys to the same side every time or keeps a count in the node.

### Min, max and the next key

The smallest key is at the end of the path of left links from the root, and the largest at the end of the right links. The **successor** of a key, the smallest key larger than it, is the minimum of the node's right subtree when it has one; otherwise it is the lowest ancestor whose left subtree holds the key, which a search from the root finds by remembering the last node where it turned left. *Floor* and *ceiling* (the nearest key at most, or at least, a given value) work the same way. A **range query** walks the tree in order but skips every subtree that lies wholly outside the range, so it costs O(h + k) for k results in a tree of height h.

### Deletion: three cases

1. **A leaf:** unlink it.
2. **One child:** link the parent straight to that child. The child's subtree moves up a level, and its keys are still on the correct side of every ancestor.
3. **Two children:** copy in the key of the node's **in-order successor**, the minimum of its right subtree, then delete the successor's node instead. That node has no left child, so removing it is case 1 or 2. The predecessor, the maximum of the left subtree, works equally well.

Sedgewick and Wayne credit the method to T. Hibbard (1962) and point out that always taking the successor is lopsided: after a long run of random inserts and deletes, the tree leans to the left.

### Traversals, and why in-order is sorted

There are four standard ways to visit every node, each in O(n):

| Traversal | Order | Typical use |
|---|---|---|
| Pre-order | node, left subtree, right subtree | Copying or serializing a tree: inserting its keys in pre-order into an empty BST rebuilds the same shape. |
| In-order | left subtree, node, right subtree | Sorted output, as in step 3. |
| Post-order | left subtree, right subtree, node | Freeing a tree (children before their parent), evaluating an expression tree (operands before the operator), computing subtree sizes and heights. |
| Level-order | level by level, left to right, from a queue | Printing or serializing by levels, finding the shallowest node that matches. |

In-order output is sorted because of the property: at any node, the walk first emits the whole left subtree, whose keys are all smaller, in sorted order (the same argument applied to the smaller tree), then the node's own key, then the right subtree, whose keys are all larger. For the tree in step 3, pre-order gives 50 30 20 40 70 60 65 80. The first three are depth-first traversals and level-order is breadth-first; [Depth-First Search](../depth-first-search/) and [Breadth-First Search](../breadth-first-search/) cover both on graphs.

### Height and balance

Every operation above follows one path from the root, so it costs O(h), where h is the height. A tree of n keys has at least ⌊log₂ n⌋ + 1 levels and at most n, and which one you get depends only on the order of the inserts.

- **Random order is fine.** If every order is equally likely, a search hit takes about 2 ln n ≈ 1.39 log₂ n comparisons on average (Sedgewick and Wayne), and Luc Devroye proved in 1986 that the height grows like 4.311 ln n, about 3 log₂ n: still O(log n). Trees built with the code below from shuffled keys were 18 to 29 levels deep for 1,000 keys (22 on average, where a perfect tree needs 10) and 27 to 38 for 10,000 keys (31.5 on average, against 14).
- **Sorted order is the worst case, and a common one.** Timestamps, auto-increment IDs and files already in alphabetical order all arrive sorted. Each new key is larger than everything before it, so it goes right every time and the tree becomes a chain n levels deep, a linked list with extra pointers (step 4). Reverse-sorted input builds the same chain to the left.

### Rotations and balanced trees

A **rotation** lifts a child above its parent: the parent becomes the child's child, and the child's inner subtree, whose keys lie between the two, moves across to the parent. Three links change, in O(1), and the in-order sequence of the keys stays the same, so the BST property survives. Balanced variants keep a little extra information in each node and rotate after inserts and deletes so that h stays O(log n) whatever the input:

- **AVL trees** (Adelson-Velsky and Landis, 1962) keep the heights of every node's two subtrees within one of each other.
- **Red-black trees** (Guibas and Sedgewick, 1978) colour each node red or black, never put a red node under a red parent, and give every path from a node down to an empty link the same number of black nodes, which keeps the height within about 2 log₂ n. The Linux kernel's documentation compares them with AVL trees: an insert needs at most two rotations and a delete at most three, at the price of slightly slower lookups.
- **Treaps** (Aragon and Seidel, 1989) give each node a random priority and keep the tree a heap by priority as well as a BST by key. The tree then has the shape that a random insertion order would produce, whatever the actual order, so operations take O(log n) expected time.
- **Splay trees** (Sleator and Tarjan, 1985) store no balance information at all. Every access rotates the node it reached up to the root, which bounds the cost of any sequence of operations at O(log n) amortized per operation and keeps recently used keys near the top.

### B-trees: wide nodes for disks and caches

A binary node holds one key, so a lookup among a billion keys follows about 30 links, and each link can be a disk read or a cache miss. A **B-tree** (Bayer and McCreight, 1972) keeps many sorted keys in each node, with a child link on each side of every key, so each node visited narrows the search hundreds of ways instead of two. A node is sized to fill a disk page, and the tree grows by splitting full nodes: splits move upward, a split of the root adds a level, and every leaf stays at the same depth whatever the order of the inserts. Database indexes are usually **B+ trees**: the inner nodes hold only separator keys and child links, every entry sits in a leaf, and the pages of each level are linked so that a range scan walks along the leaves.

The arithmetic: if a page holds 300 entries, four levels reach 300⁴ ≈ 8 billion of them, so a lookup reads four pages (and the top levels usually stay cached), while a balanced binary tree over the same keys is 33 levels deep.

## Code

```python
class Node:
    def __init__(self, key):
        self.key, self.left, self.right = key, None, None


class BST:
    """A set of keys in binary-search-tree order. Inserting a key twice keeps one copy."""

    def __init__(self):
        self.root = None

    def insert(self, key):
        """Add key and return True, or return False if it is already there."""
        parent, node = None, self.root
        while node is not None:                  # walk down, as a search would
            if key == node.key:
                return False                     # a duplicate: keep the tree a set
            parent, node = node, (node.left if key < node.key else node.right)
        if parent is None:
            self.root = Node(key)
        elif key < parent.key:
            parent.left = Node(key)              # attach at the empty spot the walk reached
        else:
            parent.right = Node(key)
        return True

    def __contains__(self, key):
        node = self.root
        while node is not None and key != node.key:
            node = node.left if key < node.key else node.right
        return node is not None

    def __iter__(self):
        """Yield the keys in sorted order: left subtree, node, right subtree."""
        stack, node = [], self.root
        while stack or node is not None:
            while node is not None:              # go left as far as possible
                stack.append(node)
                node = node.left
            node = stack.pop()
            yield node.key                       # its left subtree is done
            node = node.right                    # now its right subtree


tree = BST()
for key in [50, 30, 70, 20, 40, 60, 80, 65]:
    tree.insert(key)
print(list(tree), 65 in tree, 35 in tree, tree.insert(40))
# [20, 30, 40, 50, 60, 65, 70, 80] True False False
```

Search and insert are loops, and the in-order generator keeps its own stack instead of recursing, so no operation's depth is limited by the interpreter. The tests compared `list(tree)` with `sorted(set(keys))` and checked membership on 3,000 random lists of up to 59 keys drawn from 40 values, so most lists contained duplicates, and covered the empty tree, a single key and string keys. Sorted and reverse-sorted runs of 2,000 keys built chains exactly 2,000 levels deep that this code walks without trouble, while a recursive in-order generator raised `RecursionError` on the same chain.

## Complexity

| | Cost | Why |
|---|---|---|
| Best time | O(1) | The key is at the root, or its empty spot is right below it. |
| Average time | O(log n) | With keys inserted in random order, a search hit takes about 1.39 log₂ n comparisons and the expected height is O(log n). The same holds for insert and delete, which follow one path. |
| Worst time | O(n) | Sorted input builds a chain n levels deep. Balanced variants guarantee O(log n) for search, insert and delete: a red-black tree is at most about 2 log₂ n levels deep. |
| Traversal | O(n) | Every node is visited once. A range query costs O(h + k) for k results. |
| Extra space | O(n) | One node per key, with two links (library trees usually add a parent link and a colour or height). Search and insert need O(1) more; the in-order generator's stack holds at most h nodes. |

Stable and in place don't apply to a search tree. Sorting by inserting every item into a BST and reading it back in order (*tree sort*) takes O(n log n) on average and O(n²) on sorted input, unless the tree is balanced.

## When to use it

- An in-memory set or map that changes often and must answer ordered questions: the next deadline, the best price, the nearest key at or below a value, every key in a range, iteration in key order.
- Reach for your language's balanced tree (`TreeMap`, `std::map`, `SortedDictionary`) rather than a hand-written plain BST, which is only safe when the insert order is random, and real input rarely is.
- For exact-match lookups alone, a [Hash Table](../hash-table/) is faster on average. To take the smallest item again and again, a [Binary Heap](../binary-heap/) is simpler and more compact. For data that rarely changes, a sorted array searched with [Binary Search](../binary-search/) uses less memory and less pointer chasing. On disk, use a B-tree.

## Trade-offs

- **The shape depends on the insert order.** A plain BST is fast on random input, turns into a list on sorted input, and gives no warning. Whoever controls the order of the keys controls the worst case.
- **Balance costs bookkeeping.** Balanced trees store a colour or a height in every node and rotate on updates, and their deletion rules are intricate. That is why library trees are the safer choice, and why the code above stops at insert and search.
- **Pointers cost memory and cache misses.** Every key needs its own node with two or three pointers, and each level of a search follows a pointer to memory that may not be cached. The Rust standard library explains that its `BTreeMap` is a B-tree for this reason: each node holds several keys in a contiguous array, so a search makes a few more comparisons but far fewer allocations and cache misses.
- **Recursion depth follows the height.** Recursive insert, search and traversal are the shortest to write, but on a degenerate tree they recurse n deep. On CPython 3.11 at the default limit, a recursive insert of the keys 0, 1, 2 and so on raised `RecursionError` at key 997 (see [Recursion](../recursion/)). Loops for search and insert and an explicit stack for traversals avoid the limit.
- **No O(1) lookups.** Even a perfectly balanced tree makes about log₂ n comparisons per lookup, 20 for a million keys, and comparing strings or composite keys is not free.
- **The comparison is the contract.** A tree treats two keys that compare equal as the same key. Java's `TreeMap` documents that an ordering inconsistent with `equals` still gives a working tree, but one that breaks the general contract of `Map`.
- **Concurrent updates are awkward.** A rebalance touches several nodes at once, which makes fine-grained locking hard. Java's `TreeMap` is not synchronized, and Java's concurrent sorted map, `ConcurrentSkipListMap`, is a skip list rather than a tree.

## Implementation notes

- **Language libraries:** Java's `TreeMap` is a red-black tree with guaranteed O(log n) `containsKey`, `get`, `put` and `remove`, plus `floorKey`, `ceilingKey`, `higherKey` and `subMap` for ordered questions. C++'s `std::map` has logarithmic search, insertion and removal, iterates in key order and is usually a red-black tree. .NET documents `SortedDictionary` as a binary search tree with O(log n) retrieval, and contrasts it with `SortedList`, which uses less memory but inserts unsorted data in O(n) ([docs](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.sorteddictionary-2)). Rust's `BTreeMap` is a B-tree. Python has no search tree in its standard library: [`bisect`](https://docs.python.org/3/library/bisect.html) keeps a list sorted, but each `insort` is O(n) because of the list insert, and the documentation points to the third-party Sorted Collections package for heavier use.
- **The Linux kernel** has a red-black tree library, `lib/rbtree.c`, that leaves the search to the caller: you write the walk of steps 1 and 2 yourself, comparing keys down to the empty link, then call `rb_link_node()` to attach the node and `rb_insert_color()` to rebalance. Its users include epoll, which keeps the file descriptors it monitors in one ([eventpoll.c](https://github.com/torvalds/linux/blob/master/fs/eventpoll.c)), and the fair scheduler, which keeps runnable tasks in one ordered by their deadline ([fair.c](https://github.com/torvalds/linux/blob/master/kernel/sched/fair.c)).
- **PostgreSQL** creates a B-tree when `CREATE INDEX` names no method. A B-tree index serves `=`, `<`, `<=`, `>`, `>=`, `BETWEEN`, `IN` and `IS NULL`, and can return rows already in sorted order. In its implementation each level of the tree is a doubly linked list of pages, and typically more than 99% of the pages are leaves that point at table rows.
- **MySQL's InnoDB** stores the table itself as a B-tree, the *clustered index*, keyed by the primary key (or the first `UNIQUE` index whose columns are all `NOT NULL`, or else a hidden row ID), with the rows in its leaf pages, 16 KB by default. Each secondary index entry carries the primary key, so a lookup through a secondary index ends with a second search in the clustered index, and a long primary key makes every secondary index bigger.
- **Sorted input is fine for B-trees.** They grow at the root, so ascending keys still keep every leaf at the same depth, and InnoDB even fills pages fuller for sequential inserts (about 15/16) than for random ones (between 1/2 and 15/16). The cost moves elsewhere: in a store partitioned by key range, ever-increasing keys send every insert to the last range, the hot spot described in [Sharding](../sharding/).
- **Ordered maps route requests.** A router that splits keys into ranges keeps the range boundaries in an ordered map and finds a key's owner with a floor lookup, the largest boundary at or below the key (`TreeMap.floorEntry` in Java). A consistent-hashing ring fits the same structure with a ceiling lookup: the first position at or after the key's hash.
- **Hash tables borrow the ordering.** Java's `HashMap` documents that when many keys share a hash code and the keys are `Comparable`, it may use their comparison order to help break ties.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Binary Search](../binary-search/) — Halve a sorted range with every check: about 20 steps find one item among a million, where a scan may need a million.
- [Hash Table](../hash-table/) — Hash each key straight to a bucket for O(1) average lookups; colliding keys share a bucket, and the table grows as it fills.
- [Binary Heap & Heapsort](../binary-heap/) — A complete binary tree packed into an array keeps the smallest item on top: O(log n) push and pop, the classic priority queue.
- [Recursion & the Call Stack](../recursion/) — A function calls itself on a smaller input; each call waits on the stack until a base case returns and the answers unwind.
- [Big-O Notation](../big-o-notation/) — How an algorithm's cost grows with its input: O(1), O(log n), O(n), O(n log n) and O(n²) side by side as n grows.
- [Depth-First Search](../depth-first-search/) — Follow one path as deep as it goes, then backtrack; a stack or recursion remembers where to resume, and finds cycles too.
- [Breadth-First Search](../breadth-first-search/) — Explore a graph level by level from a queue; the first time BFS reaches a node, it has found a path with the fewest edges.

## Related database topics

- [B-Tree Index](../b-tree-index/) — How a B-tree index finds a row in three or four page reads, serves ranges in order, and what every insert costs to keep it sorted.

## References

- [Sedgewick and Wayne — Algorithms, 4th edition, 3.2 Binary Search Trees](https://algs4.cs.princeton.edu/32bst/)
- [Sedgewick and Wayne — Algorithms, 4th edition, 3.3 Balanced Search Trees](https://algs4.cs.princeton.edu/33balanced/)
- [Luc Devroye — A Note on the Height of Binary Search Trees (Journal of the ACM, 1986)](https://luc.devroye.org/devroye_1986_univ_a_note_on_the_height_of_binary_search_trees.pdf)
- [Leo Guibas and Robert Sedgewick — A Dichromatic Framework for Balanced Trees (FOCS 1978)](https://doi.org/10.1109/SFCS.1978.3)
- [Cecilia Aragon and Raimund Seidel — Randomized Search Trees (FOCS 1989)](https://faculty.washington.edu/aragon/pubs/rst89.pdf)
- [Daniel Sleator and Robert Tarjan — Self-Adjusting Binary Search Trees (Journal of the ACM, 1985)](https://www.cs.cmu.edu/~sleator/papers/self-adjusting.pdf)
- [Rudolf Bayer and Edward McCreight — Organization and Maintenance of Large Ordered Indexes (Acta Informatica, 1972)](https://doi.org/10.1007/BF00288683)
- [Java SE 27 API — java.util.TreeMap](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/TreeMap.html)
- [cppreference — std::map](https://en.cppreference.com/cpp/container/map)
- [Linux kernel documentation — Red-black Trees (rbtree) in Linux](https://docs.kernel.org/core-api/rbtree.html)
- [Rust standard library — BTreeMap](https://doc.rust-lang.org/std/collections/struct.BTreeMap.html)
- [PostgreSQL documentation — Index Types](https://www.postgresql.org/docs/current/indexes-types.html)
- [PostgreSQL documentation — B-Tree Indexes](https://www.postgresql.org/docs/current/btree.html)
- [MySQL 8.4 Reference Manual — Clustered and Secondary Indexes](https://dev.mysql.com/doc/refman/8.4/en/innodb-index-types.html)
- [MySQL 8.4 Reference Manual — The Physical Structure of an InnoDB Index](https://dev.mysql.com/doc/refman/8.4/en/innodb-physical-structure.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
