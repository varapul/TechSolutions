<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧮 Algorithms & Data Structures](../../README.md#algorithms--data-structures)

# Sliding Window

> Slide a window along a sequence, adding the item that enters and dropping the one that leaves, instead of re-scanning each window.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Sliding Window" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/sliding-window.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Recount every window** | For each of the 8 windows of 3 neighbouring items, add its items up from scratch: 4 + 2 + 7 = 13, then 2 + 7 + 1 = 10, and so on. That is 8 × 3 = **24 item reads** for the sums 13, 10, 16, 12, 16, 14, 13 and 17, and the best is 17 (6 + 2 + 9, the last window). Neighbouring windows share k − 1 items, so most items are read k times: **O(n·k)**. |
| **2 · Slide: add one, drop one** | Add up the first window once (4 + 2 + 7 = 13). Each slide then **adds the item that enters and subtracts the one that leaves**: 13 − 4 + 1 = 10, 10 − 2 + 8 = 16, and so on, reaching the same sums and the same best with 3 + 7 × 2 = **17 reads instead of 24**. The gap grows with k: for a million items and k = 1,000, sliding needs about 2 million operations where recounting needs about a billion, because sliding is **O(n) whatever k is**. |
| **3 · Grow and shrink** | A window can change size too. To find the longest stretch of `datastream` without a repeated letter, `right` extends the window one letter at a time, and a last-seen table (a hash map from letter to index) says whether the new letter is already inside it; if so, `left` jumps just past the earlier copy. That happens three times: a at 3 repeats a at 1 (left → 2), t at 5 repeats t at 2 (left → 3), and a at 8 repeats a at 3 (left → 4). The answer is **stream**, length 6, and since each index enters once and leaves at most once, this is **O(n)** as well. |
| **4 · Windows in real systems** | A sliding-window rate limiter accepts a request when fewer than 5 accepted requests have timestamps in the last 60 seconds. Requests at 0, 8, 15, 22 and 40 s are accepted; at 52 s the window already holds 5, so the request is refused with **429**; at 61 s the 0 s request has aged out (4 left), so it is accepted, and at 70 s the 8 s request has aged out in turn. The same windows drive moving averages and SLO burn-rate alerts, stream processing (tumbling, hopping and session windows), and TCP flow control, where the receiver's window caps how much unacknowledged data the sender may have in flight. |
<!-- END GENERATED: header -->
## The problem

Many questions about a sequence are really questions about every stretch of neighbouring items: the best total of any 7 days of sales, the longest piece of a string with no repeated character, how many requests a client sent in the last minute. The obvious answer computes each stretch from scratch. With n items and stretches of k, that is about n·k work, and almost all of it repeats work just done, because two neighbouring stretches differ only in the item at each end. For a million items and k = 1,000, recounting costs about a billion additions to produce answers that each differ from the previous one by two items.

## How it works

Keep a **window**, the items between a `left` and a `right` index, together with a summary of what is inside it (a sum, a count, a table of letters), and move the window instead of rebuilding it.

- **Fixed-size windows** move both edges together. Add up the first window once; after that, each step adds the item that enters on the right and subtracts the one that leaves on the left. Every item is read at most twice, once on the way in and once on the way out, so the pass costs k + 2(n − k) reads: O(n), whatever k is.
- **Variable-size windows** move the edges separately. `right` advances one item at a time to grow the window; when the window breaks a rule (a repeated letter, a total above a budget), `left` advances until the rule holds again. Neither edge ever moves backwards, so each item enters once and leaves at most once. That is O(n) too, even when one step of `right` sends `left` several places forward.

Two conditions make it work:

1. **The summary can be updated in O(1) as items enter and leave.** Sums and counts subtract cleanly, and a table of letter counts changes one entry per move. A maximum does not: when the largest item leaves, a single running value can't say what the next largest is. The standard fix is a **monotonic deque** of indexes whose values decrease from front to back. Before appending a new index, pop smaller values off the back (they can never be the maximum while the newcomer is in the window), and pop the front once it slides out. Every index is pushed once and popped at most once, so the maxima of all the windows cost O(n) in total. Python's `collections.deque` appends and pops at both ends in O(1).
2. **A variable window needs a rule that only gets worse as the window grows.** "Contains a repeated letter" stays true when letters are added, and "sums to at least S" stays true when non-negative numbers are added, so the only useful reaction is to move `left`. Negative numbers break this. Looking for the shortest stretch of `[1, −1, 5]` that sums to at least 5, the shrinking window reaches the whole array, drops the 1, finds that `[−1, 5]` sums to only 4 and stops, so it answers 3, yet `[5]` alone reaches 5. Such problems need prefix sums instead: a hash map of running totals counts the stretches that sum to exactly a target in one pass, negatives included (the lookup is the [Hash Table](../hash-table/) at work), and the shortest stretch reaching at least S is found with prefix sums and a monotonic deque.

Typical problems: the best sum or average of k items in a row; the longest substring without a repeated character; the smallest stretch that reaches a target; finding the anagrams of a word in a text by sliding a window of the word's length and comparing letter counts. The related Two Pointers technique compares the two items at its pointers (a pair that sums to a target, say); in a sliding window everything between the edges counts.

## Code

```python
from collections import deque


def max_window_sum(a, k):
    """Return the largest sum of k neighbouring items in a."""
    if not 1 <= k <= len(a):
        raise ValueError("need 1 <= k <= len(a)")
    window = sum(a[:k])                       # the first window, added up once
    best = window
    for right in range(k, len(a)):
        window += a[right] - a[right - k]     # add the item that enters, drop the one that leaves
        best = max(best, window)
    return best


def longest_unique(s):
    """Return (length, substring) for the longest stretch of s with no repeated character."""
    last = {}                                 # character -> index where it was last seen
    left = best_left = best_len = 0
    for right, ch in enumerate(s):
        if last.get(ch, -1) >= left:          # ch is already inside the window
            left = last[ch] + 1               # jump past its earlier copy
        last[ch] = right
        if right - left + 1 > best_len:
            best_len, best_left = right - left + 1, left
    return best_len, s[best_left:best_left + best_len]


class SlidingWindowLimiter:
    """Accept at most `limit` requests in any `window` seconds (a sliding log)."""

    def __init__(self, limit, window):
        self.limit, self.window = limit, window
        self.log = deque()                    # times of accepted requests, oldest first

    def allow(self, now):
        while self.log and self.log[0] <= now - self.window:
            self.log.popleft()                # older than the window: forget it
        if len(self.log) < self.limit:
            self.log.append(now)
            return True
        return False


print(max_window_sum([4, 2, 7, 1, 8, 3, 5, 6, 2, 9], 3))   # 17
print(longest_unique("datastream"))                       # (6, 'stream')
limiter = SlidingWindowLimiter(limit=5, window=60)
print([limiter.allow(t) for t in (0, 8, 15, 22, 40, 52, 61, 70)])
# [True, True, True, True, True, False, True, True]
```

The check `last.get(ch, -1) >= left` matters: in `abba`, the final `a` was last seen at index 0, which is already outside the window, so `left` must stay at 2 instead of jumping back to 1. The limiter stores only accepted requests, so a client that keeps retrying while it is limited is not locked out for longer by its own refused attempts, and a timestamp exactly 60 seconds old has already left the window.

All three were tested against brute force: `max_window_sum` on 20,000 random lists with negative numbers, for k = 1, k = n and a random k in between, plus the invalid k = 0 and k > n; `longest_unique` on 20,000 random strings over one to four letters, plus the empty string, one letter, all-same letters, `abba` and `pwwkew`; and the limiter on the timestamps above and on 5,000 random request streams, compared with a log that is rescanned for every request.

## Complexity

| | Time | Extra space | Why |
|---|---|---|---|
| Recount every window | O(n·k) | O(1) | Each of the n − k + 1 windows reads its k items. |
| Fixed window, sliding | O(n) in the best, average and worst case | O(1) | k reads for the first window, then 2 per slide: k + 2(n − k) in all. |
| Variable window (`longest_unique`) | O(n) in the best, average and worst case, with dictionary operations at their O(1) average | O(min(n, alphabet size)) | `right` visits each index once and `left` only moves forward. An array indexed by character code instead of a dictionary makes every lookup O(1) even in the worst case. The table holds one entry per distinct character. |
| Sliding-log limiter | O(1) amortized per request | O(limit) per client | Each timestamp is appended once and popped at most once. A single request can pop up to `limit` old entries after a quiet spell, and only accepted requests are stored. |

Nothing is sorted or rearranged, so stable and in place don't apply.

## When to use it

- Questions about every run of k neighbouring items: moving sums and averages, the best k-day period, rolling statistics in monitoring.
- The longest or shortest run that satisfies a rule which only gets worse as the run grows: no repeats, at most k distinct values, a budget not exceeded, non-negative values reaching a target.
- Streams where only recent items matter: rate limits, recent error rates, "the last N events", deduplication within a time window.
- Not for items that don't have to be neighbours (that is a subset or subsequence problem), not when the summary can't be updated incrementally (the median of every window needs an ordered structure, such as a balanced search tree, with O(log k) work per slide), and not for sums with negative numbers under a rule that isn't monotonic: use prefix sums.

## Trade-offs

- **The summary has to subtract.** Sums and counts are easy, maxima and minima need a monotonic deque, and medians and percentiles need an ordered structure such as a balanced tree. A floating-point running sum also collects rounding error over millions of additions and subtractions, so keep integer units (cents, milliseconds) or recompute it from scratch now and then.
- **Variable windows need a monotone rule.** The pass is only correct if growing the window can never repair a broken rule; otherwise switch to prefix sums.
- **Exact time windows cost memory per event.** A sliding log keeps one timestamp per accepted request: exact, but the memory grows with the limit and the number of clients. Cloudflare's write-up describes the cheaper **sliding window counter**: keep only this window's count and the previous window's, and weight the previous one by how much of it still overlaps the last 60 seconds. With 42 requests in the previous minute and 18 so far, 15 seconds into the current one, the estimate is 42 × 45/60 + 18 = 49.5. It assumes the previous minute's requests were spread evenly, and on 400 million requests from 270,000 sources Cloudflare measured 0.003% wrongly allowed or limited. A **token bucket** (the one in [Rate Limiting](../rate-limiting/)) stores two numbers too but deliberately allows saved-up bursts; a sliding log never accepts more than the limit in any 60-second stretch.
- **Streams make you choose the window's shape.** Tumbling windows (fixed size, no overlap) are cheap but split a burst that straddles a boundary. Overlapping windows (fixed size, advancing by a smaller step) are more likely to see such a burst in one piece, but each event belongs to several windows: 12 of them for a 1-hour window that moves every 5 minutes. Session windows close after a gap with no events.

## Implementation notes

- **Stream processing.** Apache Flink's DataStream API has tumbling, sliding, session and global window assigners. Its sliding windows have a size and a slide, and overlap when the slide is shorter. Flink's sizing advice is that each element is stored once for every window it belongs to, and that an incremental `ReduceFunction` or `AggregateFunction` cuts that to one stored value per window. Kafka Streams calls the same fixed-size, overlapping windows **hopping** windows and keeps the name **sliding** for windows defined by the time difference between records, used for joins (`JoinWindows`) and aggregations (`SlidingWindows`); its session windows merge events that arrive within an inactivity gap of each other. Check which meaning a tool uses before porting a query.
- **Rate limiters.** A sliding log fits a Redis sorted set per client, scored by timestamp: [`ZREMRANGEBYSCORE`](https://redis.io/docs/latest/commands/zremrangebyscore/) drops the entries older than the window, `ZCARD` counts the rest and `ZADD` records an accepted request. The add and the removal cost O(log n) each, plus one step per expired entry removed, and the count is O(1). Run the three as one Lua script, so the count and the add are atomic and two concurrent requests can't both take the last place. Cloudflare's edge limiter uses the two-counter approximation instead, reading the previous and current minute's counters with a single cache request. Many gateways offer token or leaky buckets, covered in [Rate Limiting](../rate-limiting/).
- **Circuit breakers.** Resilience4j's circuit breaker computes its failure rate over a sliding window, either the last N calls (a circular array of N outcomes) or the last N seconds (a circular array of N one-second buckets). Both keep a running total and subtract whatever drops out of the window, so reading the failure rate is O(1) whatever the window size. See [Circuit Breaker](../circuit-breaker/).
- **Monitoring and alerting.** Error rates over the last 5 minutes or the last hour are sliding windows over a stream of events. Multiwindow burn-rate alerts pair a long window with a short one, one twelfth of its length (the Google SRE Workbook's guideline), so an alert fires only while the error budget is still burning and stops soon after the fix; see [SLOs & Error Budgets](../slo-error-budgets/).
- **Rolling checksums.** rsync slides a weak 32-bit checksum, inspired by Adler-32, along the file one byte at a time: the checksum at the next offset comes from the previous one by removing the byte that leaves and adding the byte that enters, so blocks the other side already has can be found at any offset, not just at multiples of the block size, and a strong checksum then confirms each match. Rabin–Karp string search slides a polynomial hash the same way.
- **TCP.** In RFC 9293 the receiver advertises a window, the range of sequence numbers it is prepared to accept, which is meant to track its free buffer space. The sender may transmit up to the oldest unacknowledged byte plus that window, so as acknowledgments arrive the range slides forward along the byte stream, and the data in flight (sent but not yet acknowledged) never exceeds what the receiver offered. Congestion control adds a second limit: in [RFC 5681](https://www.rfc-editor.org/rfc/rfc5681.html) the smaller of the congestion window and the receiver's window governs transmission. It is the same picture of a bounded range moving forward along a sequence, with different bookkeeping.
- **Python.** `collections.deque(maxlen=k)` keeps the last k items and discards the oldest on its own, and the `deque` documentation includes a moving-average recipe that keeps a running sum, adding each new value and subtracting the one that falls out.


<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Two Pointers](../two-pointers/) — Move two indices through an array, toward each other or one chasing the other, to solve pair and partition problems in one pass.
- [Hash Table](../hash-table/) — Hash each key straight to a bucket for O(1) average lookups; colliding keys share a bucket, and the table grows as it fills.
- [Rate Limiting & Throttling](../rate-limiting/) — Cap how fast each client may call (token bucket) and shed the excess with 429s.
- [SLOs & Error Budgets](../slo-error-budgets/) — Measure SLIs against an objective and alert on error-budget burn rate, not on every blip.
- [Big-O Notation](../big-o-notation/) — How an algorithm's cost grows with its input: O(1), O(log n), O(n), O(n log n) and O(n²) side by side as n grows.
- [Binary Search](../binary-search/) — Halve a sorted range with every check: about 20 steps find one item among a million, where a scan may need a million.

## References

- [Cloudflare — How we built rate limiting capable of scaling to millions of domains (2017)](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/)
- [Apache Flink 2.3 documentation — Windows](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/dev/datastream/operators/windows/)
- [Apache Kafka 4.3 documentation — Streams DSL: Windowing](https://kafka.apache.org/43/streams/developer-guide/dsl-api/#windowing)
- [Google SRE Workbook — Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/)
- [RFC 9293 — Transmission Control Protocol (TCP)](https://www.rfc-editor.org/rfc/rfc9293.html)
- [Python documentation — collections.deque](https://docs.python.org/3/library/collections.html#collections.deque)
- [Resilience4j — CircuitBreaker (count-based and time-based sliding windows)](https://resilience4j.readme.io/docs/circuitbreaker)
- [Andrew Tridgell and Paul Mackerras — The rsync algorithm (rolling checksum)](https://rsync.samba.org/tech_report/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
