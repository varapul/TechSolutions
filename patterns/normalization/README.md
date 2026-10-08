
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗃️ Database Internals & Performance](../../README.md#database-internals--performance)

# Normalization & Denormalization

> Store each fact once to keep data consistent, then copy some on purpose where reads must be fast, and keep the copies in step.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Normalization &amp; Denormalization" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/normalization.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One wide table** | Acme's prototype kept one row per order line in `order_lines_wide`, rebuilt here with `CREATE TABLE … AS SELECT` from the sample data: 1,250,000 rows in 25,280 pages (198 MB), with the customer's email and country and the product's name and price repeated on every line. Customer 1's new email has to be written into all **6,537** of their lines (33 ms and 2.5 MB of WAL in one run on a laptop), and an update that misses some leaves two emails. A new product can't be stored until someone orders it (`null value in column "order_id"`), and deleting order 124446 deletes everything known about customer 5797. |
| **2 · Each fact stored once** | Normalising follows the dependencies. **1NF**: one value per cell. **2NF**: nothing depends on part of the key `(order_id, line_no)`, so the order's own facts move to `orders`. **3NF**: nothing depends on another non-key column, so the email and country move to `customers` and the product's name and price to `products`. The result is the sample schema, held together by foreign keys: the same email change is **one row** in `customers` (0.04 ms, 328 bytes of WAL), and the four tables take 131 MB instead of 198. |
| **3 · Copy on purpose** | Some copies pay for themselves. `orders.total_thb` saves summing the lines on every order list: customer 1's 2,633 orders read **2,085 pages in 2.6 ms** with the stored total and 12,654 pages in 11 ms with `SUM(qty × price_thb)`. A copy must be kept right: here a row trigger on `order_items` adjusts the total in the same transaction, and application code, a materialized view or a change stream are the alternatives. `order_items.price_thb` and `orders.shipping_country` are not copies at all: they record the price paid and where the order shipped, so the lines keep 2,646.15 after the product goes to 2,799.00. |
| **4 · Joins vs copies** | Reading order 41 with the email and product names joins four tables: 5 index lookups and 17 pages, against 4 pages from the wide table, both far under a millisecond. The copy is paid on every write instead: 10,000 new lines wrote **5.2 MB of WAL in 0.20 s** with the trigger and 2.2 MB in 0.10 s without, and any write path that skips the trigger lets the total drift. MongoDB makes the same choice as **embed or reference**, DynamoDB's **single-table design** keeps a customer and their orders in one item collection, and CQRS read models move the copies into a separate store. |
<!-- END GENERATED: header -->

## The problem

Acme's first prototype stored orders the way a spreadsheet would: one wide table, one row per order line, with the customer's email, name and country and the product's SKU, name, category and price written into every row. Rebuilt from the sample data on PostgreSQL 18.6, `order_lines_wide` has 1,250,000 rows in 25,280 pages (198 MB of table data). The same facts in the four normalised tables take 16,705 pages (131 MB), and those tables also hold what the wide table can't: the 4,120 customers who never ordered.

Every fact that is repeated can disagree with itself. The three classic **anomalies** all show up:

- **Update anomaly.** Customer 1 changes their email. It sits in all 6,537 of their order lines, so the `UPDATE` rewrites 6,537 rows: 33 ms and 2.5 MB of WAL (25,425 WAL records) in one warm run on a laptop. Right after a checkpoint the same statement wrote 38 MB, because the first change to each page after a checkpoint logs the whole page. Worse, a code path that updates only one order (`WHERE order_id = 41`, `UPDATE 2`) leaves customer 1 with two emails, 6,535 rows of the old one and 2 of the new, and nothing in the table says which is right.
- **Insert anomaly.** A product exists only as part of an order line. A new product, or a new price for an old one, has nowhere to go until someone orders it: the insert fails with `null value in column "order_id" of relation "order_lines_wide" violates not-null constraint`. The same goes for a customer who has signed up but not ordered yet.
- **Delete anomaly.** Order 124446 is customer 5797's only order. Deleting its three lines also deletes everything the shop knew about customer 5797, email and country included. 11,309 customers in the sample have exactly one order.

## How it works

Normalisation stores each fact once, in the table whose key it describes. What decides where a column belongs is its **functional dependencies**: column A determines column B when two rows that agree on A must agree on B. In `order_lines_wide`, whose key is `(order_id, line_no)`, the order determines its date, status and customer, the customer determines the email, name and country, and the product determines its name, category and list price. E. F. Codd introduced the relational model and its first normal form in 1970 and the second and third normal forms in 1971; the normal forms are tests against those dependencies:

| Normal form | The rule, in plain words | In Acme's prototype |
|---|---|---|
| **1NF** | Every cell holds one value: no lists inside a column and no repeating groups of columns. | Already met: one row per line, not an `items` column holding "4077 × 2, 6634 × 3" or columns `item1`, `item2`, `item3`. |
| **2NF** | No non-key column depends on only part of a composite key. | `ordered_at`, `status` and `customer_id` depend on `order_id` alone, half of `(order_id, line_no)`, so they move to `orders`. |
| **3NF** | No non-key column depends on another non-key column. | `email`, `name` and `country` depend on `customer_id`, so they move to `customers`; the product's name, category and price depend on the product, so they move to `products`. |
| **BCNF** (Boyce and Codd, 1974) | Whatever determines another column is a key, or contains one. | Met: in `customers` both `id` and `email` are unique, so each determines the whole row and both are keys. BCNF asks more than 3NF only of tables with several overlapping candidate keys. |

The result is the sample schema: `customers`, `products`, `orders` and `order_items`, held together by primary keys and foreign keys (`orders.customer_id` references `customers`, `order_items` references `orders` and `products`). Customer 1's new email is now one row, `UPDATE 1`, in 0.04 ms and 328 bytes of WAL. A new product is an `INSERT` into `products`, and deleting an order leaves the customer alone. Reading an order back means joining the tables again on their keys (see [Join Algorithms](../join-algorithms/)); PostgreSQL doesn't index the referencing side of a foreign key by itself, so index the ones you join or filter on, as [B-Tree Index](../b-tree-index/) shows for `orders.customer_id`.

### Copying on purpose

A normalised schema can still hold copies; the point is to choose them and keep them right. Acme's schema has three columns that all look like copies, but they are two different things:

- `orders.total_thb` is a **derived copy**: it always equals the sum of `qty × price_thb` over the order's lines. Customer 1's order list, all 2,633 orders, reads 5 index pages and 2,080 heap pages in 2.6 ms with the stored total. Computing the total instead adds 2,633 index lookups in `order_items`, 12,654 pages and 11 ms (both from a warm run, with an index on `orders.customer_id` added for the list).
- `order_items.price_thb` is **the price paid** and `orders.shipping_country` is **where the order shipped**. They describe the order line and the order, not the product or the customer, so they are separate facts that happen to equal today's values. In the run, `UPDATE products SET price_thb = 2799.00 WHERE id = 4077` changed the list price, and orders 41 and 500001 kept 2,646.15: rewriting them would rewrite what customers paid.

A copy is only worth keeping if something keeps it right. The diagram uses a row trigger, which runs inside the writing transaction; the alternatives move the work elsewhere:

| How | When the copy is right | What it costs |
|---|---|---|
| **Trigger** (`AFTER INSERT OR UPDATE OR DELETE ON order_items FOR EACH ROW`) | At commit, in the same transaction | Every write to a line also updates its order: 10,000 new lines wrote 5.2 MB of WAL in 0.20 s instead of 2.2 MB in 0.10 s, and two sessions adding lines to the same order wait for each other's row lock |
| **Application code** in the same transaction | At commit, if every code path remembers | Each bulk script, admin tool and migration has to do it too |
| **Materialized view** of the totals | After `REFRESH MATERIALIZED VIEW`, which re-runs the whole query | Stale between refreshes; see [Materialized View](../materialized-view/) |
| **Change stream** (CDC) and a consumer | A moment after the commit | Eventually consistent, one more moving part; see [Change Data Capture](../change-data-capture/) |

Whatever keeps the copy, check it: in the run no order's `total_thb` differed from the sum of its lines, and the check over all 500,000 orders took about a second. Larger copies follow the same rules. [CQRS](../cqrs/) read models keep whole denormalised views in a separate store, and with [Event Sourcing](../event-sourcing/) every table is a copy rebuilt from the event log.

## Try it

The sample data comes from [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop), a script that builds the template database `acme` on PostgreSQL 18 in about a minute.

On a fresh copy of the sample data (`CREATE DATABASE normalization TEMPLATE acme STRATEGY FILE_COPY`), PostgreSQL 18.6. Times are from one run and will differ on your machine.

```sql
-- 1. The prototype: one wide row per order line
CREATE TABLE order_lines_wide AS
SELECT i.order_id, i.line_no, o.created_at AS ordered_at, o.status,
       o.customer_id, c.email, c.name AS customer_name, c.country,
       p.sku, p.name AS product_name, p.category, p.price_thb, i.qty
FROM order_items i
JOIN orders o ON o.id = i.order_id
JOIN customers c ON c.id = o.customer_id
JOIN products p ON p.id = i.product_id
ORDER BY i.order_id, i.line_no;
ALTER TABLE order_lines_wide ADD PRIMARY KEY (order_id, line_no);
CREATE INDEX ON order_lines_wide (customer_id);
CREATE INDEX ON orders (customer_id);
VACUUM ANALYZE order_lines_wide;
ANALYZE orders;

SELECT pg_relation_size('order_lines_wide') / 8192 AS pages,
       pg_size_pretty(pg_relation_size('order_lines_wide')) AS size;
--  25280 | 198 MB
SELECT (sum(pg_relation_size(t)) / 8192)::int AS pages, pg_size_pretty(sum(pg_relation_size(t))) AS size
FROM unnest('{customers,products,orders,order_items}'::regclass[]) AS t;
--  16705 | 131 MB

-- 2. Update anomaly: one new email, thousands of rows
BEGIN;
EXPLAIN (ANALYZE, BUFFERS, WAL, COSTS OFF)
UPDATE order_lines_wide SET email = 'customer1@example.org' WHERE customer_id = 1;
--  Update on order_lines_wide
--    WAL: records=25425 bytes=2495514
--    ->  Bitmap Heap Scan on order_lines_wide (actual ... rows=6537.00 loops=1)
ROLLBACK;
BEGIN;
UPDATE customers SET email = 'customer1@example.org' WHERE id = 1;
--  UPDATE 1
ROLLBACK;

-- 3. Insert and delete anomalies
INSERT INTO order_lines_wide (product_name, price_thb) VALUES ('Product 10001', 990.00);
--  ERROR:  null value in column "order_id" of relation "order_lines_wide" violates not-null constraint
BEGIN;
DELETE FROM order_lines_wide WHERE order_id = 124446;
--  DELETE 3
SELECT count(*) FROM order_lines_wide WHERE customer_id = 5797;
--  0: customer 5797 is gone
ROLLBACK;

-- 4. A deliberate copy: the stored total against the SUM
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, created_at, status, total_thb FROM orders
WHERE customer_id = 1 ORDER BY created_at DESC;
--  ->  Bitmap Heap Scan on orders (actual ... rows=2633.00 loops=1)
--        Heap Blocks: exact=2080
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT o.id, o.created_at, o.status, sum(i.qty * i.price_thb) AS total_thb
FROM orders o JOIN order_items i ON i.order_id = o.id
WHERE o.customer_id = 1 GROUP BY o.id ORDER BY o.created_at DESC;
--  Sort (actual ... rows=2633.00 loops=1)
--    Buffers: shared hit=... read=...        (12654 pages in total)
--    ->  Index Scan using order_items_pkey on order_items i (... loops=2633)

-- 5. Keep the copy right with a row trigger
CREATE FUNCTION order_items_keep_total() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE orders SET total_thb = total_thb - OLD.qty * OLD.price_thb WHERE id = OLD.order_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE orders SET total_thb = total_thb + NEW.qty * NEW.price_thb WHERE id = NEW.order_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER order_items_keep_total
AFTER INSERT OR UPDATE OR DELETE ON order_items
FOR EACH ROW EXECUTE FUNCTION order_items_keep_total();

BEGIN;
INSERT INTO orders (customer_id, status, shipping_country, created_at)
VALUES (1, 'pending', 'MY', '2026-10-09 10:00+07') RETURNING id, total_thb;
--  500001 | 0.00
INSERT INTO order_items VALUES (500001, 1, 4077, 1, 2646.15);
SELECT total_thb FROM orders WHERE id = 500001;
--  2646.15: the trigger added the line
UPDATE products SET price_thb = 2799.00 WHERE id = 4077;
SELECT order_id, line_no, price_thb FROM order_items
WHERE product_id = 4077 AND order_id IN (41, 500001);
--      41 | 1 | 2646.15
--  500001 | 1 | 2646.15     the price paid stays
ROLLBACK;

-- 6. Check that the copy still matches
SELECT count(*) FROM orders o
JOIN (SELECT order_id, sum(qty * price_thb) AS s FROM order_items GROUP BY order_id) t
  ON t.order_id = o.id
WHERE o.total_thb <> t.s;
--  0   (about 1 s)
```

## When to use it

- **Normalise the system of record.** For the tables a business writes to (orders, customers, payments) store each fact once and let keys and constraints keep it consistent. Writes stay small and an update can't miss a copy. Third normal form is the usual target, and getting there is mostly a matter of asking "what does this column describe?".
- **Copy deliberately, for a measured read.** A value read far more often than it changes, on a path where computing it costs real work (order totals, counters, the latest status), is worth a stored copy with a named owner that keeps it right.
- **Snapshot what must not change.** Prices paid, addresses shipped to, tax rates applied: store them on the order or the line, because they describe that moment. This isn't denormalisation, and normalising them away into a join with today's product or customer would be a bug.
- **Move big read shapes out of the transactional schema.** Search indexes, dashboards and per-screen read models belong in [CQRS](../cqrs/) read models or a [Materialized View](../materialized-view/), fed by [Change Data Capture](../change-data-capture/) or events; with [Database per Service](../database-per-service/), other services keep their own copies of the facts they need in the same way.
- **Don't denormalise to avoid a join on indexed keys.** Reading order 41 with the customer's email and the product names took 5 index lookups in 4 tables, 17 pages and 0.02 ms; the wide table needed 4 pages and 0.01 ms. That difference rarely matters, and the wide table pays for it on every write.

## Trade-offs

- **Joins cost reads.** Each join is more pages to read, and a badly indexed join can cost far more than 17 pages. Scans can go the other way: the wide table is 198 MB against 131 MB for the four tables, so a report that scans it reads half as much again.
- **Copies cost writes.** With the trigger, every new order line also writes a new version of its order: in the run, 10,000 lines wrote 69,553 WAL records instead of 30,097, 5.2 MB instead of 2.2 MB, and took 0.20 s instead of 0.10 s.
- **Copies cost concurrency.** The trigger's `UPDATE` locks the order's row until commit, so two transactions adding lines to the same order wait for each other. A counter on a busy row turns into a queue.
- **Copies cost consistency.** A copy is only as right as the least careful path that writes the source: a bulk load with triggers disabled, a `TRUNCATE` (which fires no `ON DELETE` triggers), a script that writes through another connection. Keep a check query like the one in *Try it* and run it.
- **Document and key-value databases weigh the same thing.** MongoDB calls embedded documents a denormalised model: an order with its lines embedded is one read and one atomic write, while a referenced customer keeps one copy and needs a `$lookup` or a second query. DynamoDB has no joins, so its single-table design stores a customer and their orders under one partition key and reads them with one `Query`; any fact copied into several items, like a customer's email, has to be updated in each of them.

## Implementation notes

- **PostgreSQL 18.** Primary keys and unique constraints create indexes; foreign keys don't index the referencing columns. A generated column can compute a line total from its own row (`qty * price_thb`) but can't sum other rows, so an order total needs a trigger, application code or a materialized view; since PostgreSQL 18 a generated column is virtual unless you say `STORED`. Row triggers fire once per row; a statement-level trigger with transition tables (`REFERENCING NEW TABLE AS …`) sees all the rows of one statement, which suits bulk loads better than 10,000 single-row updates. `REFRESH MATERIALIZED VIEW` re-runs the view's query (see [PostgreSQL](../postgresql/)).
- **Measuring a trigger's cost.** In this run `EXPLAIN (ANALYZE, WAL)` reported the same 1.6 MB of WAL for the 10,000-line insert with and without the trigger, so the totals above come from the per-backend counters of `pg_stat_get_backend_wal()`, new in PostgreSQL 18, read before and after each statement. Full-page images after a checkpoint can multiply WAL several times, so compare runs without them.
- **MySQL 8.4 (InnoDB).** Triggers are always `FOR EACH ROW`; there are no statement-level triggers. Cascaded foreign key actions don't activate triggers, so a total kept by triggers on `order_items` goes stale when lines disappear through `ON DELETE CASCADE`. Generated columns are `VIRTUAL` by default and can't contain subqueries.
- **SQL Server.** An indexed view stores an aggregate like a table and is updated as part of every insert, update and delete on its base tables, which makes it a copy the engine keeps for you. It comes with rules (a `GROUP BY` view needs `COUNT_BIG(*)`, `SUM` can't take a nullable expression, no `HAVING`), and Microsoft notes it suits data that isn't updated often. On Standard edition, queries must name the view with `NOEXPAND` to use it.
- **Oracle.** Materialized views refresh on demand, on commit (fast refresh from materialized view logs) or on statement (with every DML), per the Oracle AI Database 26ai Data Warehousing Guide.
- **MongoDB.** The manual recommends embedding data that is read together and stays bounded, and references when the embedded data changes often, is queried on its own or would be duplicated without enough benefit; `$lookup` joins referenced collections in the same database, and a document is limited to 16 MiB (see [MongoDB](../mongodb/)).
- **DynamoDB.** Items with the same partition key form an item collection, which single-table design uses to answer one access pattern with one `Query`. Copies across items are the application's job, often driven by DynamoDB Streams (see [Amazon DynamoDB](../amazon-dynamodb/)).

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Materialized View](../materialized-view/) — Precompute query-shaped views so reads don't pay for joins and aggregations.
- [CQRS](../cqrs/) — Separate the write model (commands) from read models (queries), each optimised for its job.
- [Change Data Capture (CDC)](../change-data-capture/) — Stream every committed change from the database log to other systems.
- [Join Algorithms](../join-algorithms/) — Nested loop, hash join and merge join: how each joins two tables, what it costs, and when the planner picks it.
- [MongoDB](../mongodb/) — A document database: JSON-like documents with flexible schemas, replica sets for failover and sharding to scale out.
- [Amazon DynamoDB](../amazon-dynamodb/) — A serverless key-value and document database: the partition key spreads items across partitions for single-digit-millisecond reads.
- [Database per Service](../database-per-service/) — Each service owns its data; others go through its API or events, never its tables.
- [Event Sourcing](../event-sourcing/) — Store every change as an immutable event and rebuild state by replaying them.
- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.

## References

- [E. F. Codd — A Relational Model of Data for Large Shared Data Banks (Communications of the ACM, 1970)](https://dl.acm.org/doi/10.1145/362384.362685)
- [PostgreSQL 18 documentation — Constraints (primary keys, foreign keys)](https://www.postgresql.org/docs/18/ddl-constraints.html)
- [PostgreSQL 18 documentation — CREATE TRIGGER](https://www.postgresql.org/docs/18/sql-createtrigger.html)
- [PostgreSQL 18 documentation — Trigger Functions (PL/pgSQL)](https://www.postgresql.org/docs/18/plpgsql-trigger.html)
- [PostgreSQL 18 documentation — Materialized Views](https://www.postgresql.org/docs/18/rules-materializedviews.html)
- [PostgreSQL 18 documentation — Generated Columns](https://www.postgresql.org/docs/18/ddl-generated-columns.html)
- [PostgreSQL 18 documentation — The Cumulative Statistics System (pg_stat_get_backend_wal)](https://www.postgresql.org/docs/18/monitoring-stats.html)
- [MongoDB Database Manual — Embedded Data in Your MongoDB Schema](https://www.mongodb.com/docs/manual/data-modeling/embedding/)
- [MongoDB Database Manual — Reference Data in Your MongoDB Schema](https://www.mongodb.com/docs/manual/data-modeling/referencing/)
- [Amazon DynamoDB Developer Guide — Data modeling foundations (single table design)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/data-modeling-foundations.html)
- [Amazon DynamoDB Developer Guide — Best practices for modeling relational data](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-relational-modeling.html)
- [MySQL 8.4 Reference Manual — Restrictions on Stored Programs (triggers)](https://dev.mysql.com/doc/refman/8.4/en/stored-program-restrictions.html)
- [Microsoft Learn — Create indexed views (SQL Server)](https://learn.microsoft.com/en-us/sql/relational-databases/views/create-indexed-views)
- [Oracle AI Database 26ai Data Warehousing Guide — Refreshing Materialized Views](https://docs.oracle.com/en/database/oracle/oracle-database/26/dwhsg/refreshing-materialized-views.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
