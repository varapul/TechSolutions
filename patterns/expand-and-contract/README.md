<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔄 Migration & Modernization](../../README.md#migration--modernization)

# Expand and Contract

> Change a schema or API in backward-compatible steps: expand, migrate, then contract.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Expand and Contract" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/expand-and-contract.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One-step rename breaks** | One release renames `phone` to `phone_number` and ships v2, which uses the new name. The rename takes effect at once, but instances are replaced one at a time, so every instance still on v1 asks for a column that no longer exists and its queries fail with an unknown-column error. Rolling the application back does not help: v1 needs the old column, and the schema has already moved on. The same happens to anything else that reads the table, such as reports, batch jobs and other services. |
| **2 · Expand** | Start again from the original table. First add `phone_number` as a nullable column beside `phone`: a quick, additive change that v1 simply ignores. Then roll out v1.1, which writes every value to **both** columns and still reads `phone`. v1 and v1.1 run side by side on this schema, and the way back is to redeploy v1. New rows now carry both values, while the older rows still hold `NULL` in the new column. |
| **3 · Migrate** | A backfill copies `phone` into `phone_number` for the existing rows, in small batches with pauses between them, so that no single statement locks every row at once. Once a comparison shows that the two columns agree on every row, v1.2 switches the reads to `phone_number` (a small release or, better, a [feature flag](../feature-flags/)) and keeps writing both. Because the old column is still kept up to date, going back is just switching the reads back. |
| **4 · Contract** | Once nothing reads `phone`, v2 stops writing it, and once nothing reads or writes it, a later release drops the column. Every earlier step kept the previous version working and could be undone; the drop is the only destructive step, so it comes last and on its own. v2 is the same version that broke in step 1: the destination has not changed, only the route to it. |
<!-- END GENERATED: header -->

## The problem

Code and the data shape it depends on are never replaced at the same instant. During a [rolling update](../rolling-update/) old and new instances serve side by side, a [canary release](../canary-release/) keeps both versions live for as long as its analysis takes, and a [blue-green deployment](../blue-green-deployment/) keeps the old environment warm precisely so that traffic can go back to it. Some readers are not part of your deployment at all: a reporting job, another team's service that shares the table, a mobile app installed months ago that still calls the API.

A change that only the new code understands therefore breaks whatever still runs the old code, at the moment it is applied. Renaming `phone` to `phone_number` in one release is the smallest example. The rename is instant and the rollout is not, so for as long as the rollout lasts every old instance fails with an unknown-column error. The change also removes the way back: rolling the application back puts code that needs `phone` in front of a table that no longer has it, and renaming the column back is a second incompatible change that breaks the new instances instead.

The traditional answer is a maintenance window: stop everything, change the schema, start the new version. Expand and contract is what you do when stopping is not acceptable.

## How it works

Never change a shared structure in place. Put the new shape **beside** the old one, move everyone across, and remove the old shape once nobody uses it. Danilo Sato described the technique in 2014 under the name **parallel change**, also known as **expand and contract**, with three phases:

1. **Expand.** Add the new structure next to the old one. An addition is safe, because code that does not know about a new column or field ignores it. Then make the application write to both.
2. **Migrate.** Bring the new structure up to date by backfilling what was written before the dual writes began, check that old and new agree, and move the readers over. The old structure is still written, so it stays correct and switching back stays possible.
3. **Contract.** When nothing reads the old structure, stop writing it. When nothing writes it either, remove it.

Sato notes that most database refactorings follow this pattern, with the migrate phase as the transition between the original schema and the new one. Pramod Sadalage and Martin Fowler call that stretch the *transition phase* in *Evolutionary Database Design*: the time during which the database serves the old way of accessing it and the new way side by side. *Refactoring Databases*, by Scott Ambler and Pramod Sadalage, catalogues the individual changes, Rename Column among them.

The rule behind the phases: **at every moment the schema must work with the application version that is being rolled out and with the one before it.** Both run during the rollout, and the previous one is what a rollback brings back. A rename cannot meet that rule in one step, but each of these small steps can:

| Change | Columns in the table | Reads | Writes | Way back |
|---|---|---|---|---|
| start: v1 | `phone` | `phone` | `phone` | |
| 1. add the column | `phone`, `phone_number` (nullable) | `phone` | `phone` | drop the new column |
| 2. deploy v1.1 | both | `phone` | both | redeploy v1 |
| 3. backfill, then compare | both, now equal | `phone` | both | nothing to undo |
| 4. deploy v1.2, or flip a flag | both | `phone_number` | both | switch the reads back |
| 5. deploy v2 | both | `phone_number` | `phone_number` | redeploy v1.2, no further |
| 6. drop the column | `phone_number` | `phone_number` | `phone_number` | none |

Two orderings fall out of the rule: **add before you use, and stop using before you remove.** In the expand phase the schema changes first and the code follows; in the contract phase the code changes first and the schema follows. Changes 1 to 5 can be undone. Change 6 destroys data and cannot, which is why it comes last, in a release of its own, after the new path has run in production for a while. The v2 that finally ships is the same version that failed in the one-step attempt: the destination has not changed, only the route to it.

The same sequence handles every change that is not purely additive: changing a column's type, splitting one column or table into two, merging two, or moving data to another table or another store. Only the transformation inside the dual write and the backfill differs.

### The same three phases for APIs and events

A response field or an event schema is a contract with consumers you may not control, so the overlap lasts longer, but the shape of the change is the same.

- **APIs.** Expand: add the new field, endpoint or version and keep serving the old one. Clients that ignore fields they do not know are not disturbed. Migrate: move the consumers, and measure who still uses the old one. When the thing being retired is a whole resource, such as an old endpoint or an old API version, two RFCs define response headers for this stage. The `Deprecation` header (RFC 9745, on the standards track since March 2025) says that the resource is deprecated, or will be from a given date, and the `Sunset` header (RFC 8594, informational, 2019) gives the time after which it is expected to stop responding; a `Link` header with `rel="deprecation"` or `rel="sunset"` points to the documentation. Both headers describe the resource, not one field of its response, so a single field is flagged in the API description instead. Contract: when the date has passed and the traffic is gone, remove the old one.
- **Events and messages.** Producers and consumers deploy independently and old events stay in the log, so a new consumer has to read old events and an old consumer has to survive new ones. Expand: add the new field as optional, with a default, and publish both. Migrate: consumers move to the new field. Contract: stop publishing the old one. When the meaning of an event changes rather than its fields, publish a new event type beside the old one and retire the old one the same way.

On an endpoint in its migrate phase, the announcement travels with every response. The `Deprecation` value is a Unix timestamp written as a structured-field date, the `Sunset` value is an HTTP date that must not be earlier, and the link leads to the migration notes:

```http
Deprecation: @1798761600
Sunset: Thu, 01 Jul 2027 00:00:00 GMT
Link: <https://api.example.com/docs/customers-v1-retirement>; rel="deprecation"; type="text/html"
```

Both headers are hints for the people who maintain the clients: the resource keeps behaving as before until it is actually removed.

The idea scales up and down. A [strangler fig](../strangler-fig/) migration applies it to a whole system (new services beside the monolith, routes moved one at a time, the monolith retired last), branch by abstraction applies it to an implementation inside one codebase, and a parallel run is the "compare" step grown into a pattern of its own. Sato counts canary releases and blue-green deployments as applications of parallel change too: two versions side by side, traffic moved across, the old one removed. An [anti-corruption layer](../anti-corruption-layer/) translates between two models that both stay; expand and contract is for when the old one should disappear.

## When to use it

- **Schema changes under a zero-downtime deployment.** With rolling, blue-green or canary deployments, every change that is not purely additive needs it: renames, type changes, splits and merges, and tightening a constraint such as `NOT NULL` or uniqueness.
- **A database shared by several applications**, each with its own release schedule, including the reports and batch jobs that read the tables directly.
- **Public and cross-team contracts:** REST and GraphQL fields, message and event schemas, configuration formats and library interfaces. Wherever consumers upgrade on their own schedule, the migrate phase is how they get the time to do it.
- **Moving data between tables or stores.** Stripe's account of moving subscriptions into a table of their own uses the same four moves: write to both, switch the reads, switch the writes, remove the old data.

**When it is overkill.** With one instance and an accepted maintenance window, stop the application, run the migration and start the new version: the overlap this pattern manages never exists. A purely additive change (a new nullable column, a new optional field, a new endpoint) is an expand with nothing to contract. And a structure that nothing depends on yet, such as a table created for a feature that has not launched, can simply be changed.

## Trade-offs

- **More releases and more calendar time.** One rename becomes six changes, each of which has to reach every instance before the next begins. For a single service that is a few days. With other teams' consumers the transition lasts as long as the slowest of them needs: Sadalage and Fowler note that this takes a couple of months in some organisations and years in others. The change needs an owner for that long.
- **Temporary duplication.** Two columns hold the same value, every write is doubled, and the code knows about both. Dual-write code is where the bugs hide: one write path that was missed leaves the columns out of step, which is why the comparison is a step and not an option.
- **Two candidates for the truth.** While both columns exist, be explicit about which one is authoritative: the old one until the reads switch, the new one after. The other is a copy that only the dual write may change.
- **The cost of never contracting.** The contract phase adds no feature, so it is the one that gets skipped. What stays behind is a column nobody dares to drop, dual-write code that every new feature has to respect, and newcomers who cannot tell which column is real. Sato's warning is that stopping halfway leaves the system in a worse state than not starting. Budget the contract when you plan the expand.
- **The last step is one-way.** Everything before the drop can be undone by redeploying or by switching the reads back. After it, the old column comes back only through a new expand and backfill, or from a backup. That is a reason to take it deliberately, not to avoid it.
- **It does not remove every lock.** The pattern makes each step compatible with the running code. Whether a step is *cheap* on a table with a billion rows depends on the database, which is what the notes below are about.

## Implementation notes

- **Write code that tolerates additions.** The expand phase is safe only for code that names what it uses. A `SELECT *` mapped by position, or an `INSERT` without a column list, breaks when a column appears, and an API client that rejects unknown fields breaks when a field does.
- **Add the column without a long lock.** PostgreSQL adds a column without rewriting the table when the column has no default or a default that is not volatile. A volatile default (a random UUID, `clock_timestamp()`), a stored generated column or an identity column makes it rewrite the table and its indexes. MySQL's InnoDB adds and drops columns with `ALGORITHM=INSTANT` by default in 8.0.29 and later, up to a limited number of such changes per table before a rebuild is needed. Even a metadata-only change needs a brief exclusive lock, and in PostgreSQL an `ALTER TABLE` that waits for it behind a long transaction makes every later query on the table wait too, so run migrations with a short `lock_timeout` and retry.
- **Give the new column its constraints and indexes before the reads move.** In PostgreSQL, `CREATE INDEX CONCURRENTLY` builds an index without blocking writes; it scans the table twice, cannot run inside a transaction block, and leaves an invalid index to drop and retry if it fails. A unique or primary-key constraint can then adopt that index (`ADD CONSTRAINT ... USING INDEX`). Foreign-key and `CHECK` constraints, and since PostgreSQL 18 `NOT NULL` constraints, can be added as `NOT VALID`, which skips the scan of existing rows, and validated later under a lock that does not block writes. On earlier versions, a validated `CHECK (phone_number IS NOT NULL)` lets `SET NOT NULL` skip its scan.
- **Backfill in throttled batches.** Walk the primary key in ranges of a few thousand rows, one short transaction each, and pause between batches, longer when replication lag grows. One huge `UPDATE` holds its row locks until it commits, replicates as a single transaction and, in PostgreSQL, leaves a dead version of every row for vacuum to clear. Make the statement idempotent so the job can be restarted (`... WHERE phone_number IS DISTINCT FROM phone`), and let the database copy the value inside one statement, so that a batch cannot overwrite a newer value written by the application. Start the backfill only when every writer keeps both columns in step.
- **Dual writes: in the application or in a trigger.** Application code that writes both columns in one statement is explicit, testable and removed by a code change, but it covers only the writers that run it: old instances during the rollout, other services, scripts and bulk loads keep writing one column. A database trigger covers every writer from the moment the column exists, in the same transaction, at the price of logic hidden in the database, extra work on every write and one more thing to remove in the contract phase. With several writers you do not control, prefer the trigger. The database can also keep an old name alive for readers that cannot change yet: Sadalage and Fowler's example renames a table and leaves a view under the old name.
- **Online schema change tools.** When the engine cannot make a change in place cheaply, tools such as gh-ost and pt-online-schema-change (MySQL) build a copy of the table with the new schema, copy the rows in chunks, keep the copy current (gh-ost by reading the binary log, pt-online-schema-change with triggers) and swap the two tables at the end, throttling on load and replication lag. They make one step safe for a large table. They do not make an incompatible change compatible: after a rename applied by table swap, old code still fails. pgroll (PostgreSQL 14 and later) automates the whole pattern instead. Starting a migration adds the new column, installs triggers that copy writes between old and new, and backfills in batches. Each schema version is exposed as a set of views that an application selects with its `search_path`, and the migration is later completed or rolled back with one command.
- **Verify before switching reads.** Count the rows on which the columns differ (in PostgreSQL, `SELECT count(*) FROM customers WHERE phone_number IS DISTINCT FROM phone`) and require zero, repeatedly, while writes continue. For anything more complicated than a copy, compare at runtime as well: read both, serve the old value and log every mismatch. Stripe did this with GitHub's Scientist library.
- **Switch the reads with a flag.** A [feature flag](../feature-flags/) moves the reads for 1% of requests, then all of them, and moves them back in seconds without a deployment. It works only while the dual write stays on, so remove the flag before the contract phase begins, not after.
- **Contract in separate, checked steps.** Before v2 stops writing the old column, make sure the column accepts being left out: drop its `NOT NULL` constraint or give it a default. Before the drop, prove that nothing uses it: search the code, check the query logs, and remember the readers outside the application. ORMs that list every column by name need telling first; Rails has `ignored_columns` for exactly this. A rehearsal that can be undone, such as renaming the column for a few days, finds the reader everyone forgot. In PostgreSQL the drop itself is quick: the column becomes invisible and its space is reclaimed as rows are rewritten.
- **Flag it in the API description, and count.** OpenAPI marks an operation or a parameter with `deprecated: true`, and GraphQL marks a field with the `@deprecated` directive. Count requests per client for whatever is being retired: the contract phase starts when that count reaches zero, or when the announced sunset date passes.
- **Let the tooling enforce compatibility for events.** A schema registry can reject an incompatible schema when it is registered: Confluent Schema Registry checks each new version against a compatibility mode, by default `BACKWARD` (consumers on the new schema can read data written with the previous one). In Protocol Buffers a deleted field's number must never be reused; `reserved` makes the compiler enforce that.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Blue-Green Deployment](../blue-green-deployment/) — Run the new version beside the old one and switch all traffic in one step.
- [Canary Release](../canary-release/) — Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back.
- [Rolling Update](../rolling-update/) — Replace instances batch by batch while the service stays up.
- [Feature Flags](../feature-flags/) — Deploy code dark, then turn features on per user or percentage at runtime.
- [Strangler Fig](../strangler-fig/) — Put a facade in front of the legacy system and move routes to new services one at a time.
- [Branch by Abstraction](../branch-by-abstraction/) — Introduce an abstraction, build the new implementation behind it, then switch over.
- Parallel Run *(planned)* — Run old and new side by side on the same inputs and compare results before cutting over.
- [Anti-Corruption Layer](../anti-corruption-layer/) — A translation layer that keeps a legacy model from leaking into the new domain.

## References

- [Danilo Sato — Parallel Change (martinfowler.com)](https://martinfowler.com/bliki/ParallelChange.html)
- [Pramod Sadalage and Martin Fowler — Evolutionary Database Design](https://martinfowler.com/articles/evodb.html)
- [Scott Ambler and Pramod Sadalage — Refactoring Databases (book site and catalog)](https://databaserefactoring.com/)
- [PostgreSQL documentation — ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html)
- [PostgreSQL documentation — CREATE INDEX (building indexes concurrently)](https://www.postgresql.org/docs/current/sql-createindex.html)
- [gh-ost — GitHub's online schema migration tool for MySQL](https://github.com/github/gh-ost)
- [pgroll — PostgreSQL zero-downtime migrations made easy](https://github.com/xataio/pgroll)
- [Stripe — Online migrations at scale](https://stripe.com/blog/online-migrations)
- [RFC 8594 — The Sunset HTTP Header Field](https://www.rfc-editor.org/rfc/rfc8594.html)
- [RFC 9745 — The Deprecation HTTP Response Header Field](https://www.rfc-editor.org/rfc/rfc9745.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
