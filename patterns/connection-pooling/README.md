<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🗃️ Database Internals & Performance](../../README.md#database-internals--performance)

# Connection Pooling

> Share a few database connections among many requests, so connection setup and per-connection memory stop limiting the database.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Connection Pooling" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/connection-pooling.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Too many connections** | Acme's checkout service runs **40 pods**, each with a pool of **20 connections**: 800 in all, against PostgreSQL's default `max_connections` of **100**, three of them kept for superusers. Started together, only pods 26, 29 and 31 got all 20 (60 backends); the other **37** were turned away with `remaining connection slots are reserved for roles with the SUPERUSER attribute` (25) or `sorry, too many clients already` (12). Connecting for every transaction instead is far slower: with 8 clients, pgbench `-C` ran **353** checkouts a second against **15,103** with the connections kept open. |
| **2 · Why connections cost** | PostgreSQL forks a **backend process** for every connection. With `log_connections = setup_durations` (new in PostgreSQL 18) the server logged **6.4 ms** per new connection: 0.2 ms to fork, about 2.1 ms of TLS and 3.2 ms of SCRAM-SHA-256 authentication, mostly the client hashing the password 4,096 times. `ps` shows 22 MB per backend, but only about **1.7 MB** of it is private; since PostgreSQL 14 idle connections barely slow snapshots down, yet beyond about 32 busy connections the 4 cores only added latency. |
| **3 · Pooling in practice** | Each pod keeps its pool of 20 but connects to **PgBouncer** in **transaction mode**, which lends one of its **20 server connections** to a client for the length of a transaction. At 100 checkouts a second per pod, all 40 pods ran: **4,007 tps** at 1.7 ms on average, and `SHOW POOLS` showed 800 active clients with none waiting. A pool of **8**, the (2 × cores) + spindles starting point for 4 cores with the data cached, served the same load at 1.5 ms. |
| **4 · What pooling breaks** | A server connection outlives the transaction, so session state leaks: pod 7's `SET statement_timeout = '5ms'` stayed on server pid 6715 and cancelled pod 12's `count(*)`. `LISTEN`, session advisory locks and temporary tables break the same way, while protocol-level prepared statements work since PgBouncer 1.21. The extra hop added 0.26 ms per checkout and PgBouncer runs on one core, so run more than one; Amazon **RDS Proxy** pins a client to its connection when it sees session state, and **MySQL** gives each connection a thread instead of a process. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's checkout service runs on [Kubernetes](../kubernetes/), and at peak the [autoscaler](../autoscaling/) takes it to **40 pods**. Each pod keeps an application-side pool of **20 connections** to [PostgreSQL](../postgresql/), so the service wants 800 connections. PostgreSQL's `max_connections` is 100 by default, and `superuser_reserved_connections` keeps the last 3 of those for superusers, which leaves 97 for the `checkout` role.

To see what happens, each pod was played by a pgbench process holding 20 connections, and all 40 started at once against PostgreSQL 18.6 with default settings. Only pods 26, 29 and 31 got all 20 connections, 60 backends in all; the other 37 failed at startup. Twenty-five of them read `FATAL: remaining connection slots are reserved for roles with the SUPERUSER attribute`, the message a non-superuser gets once only the reserved slots are free. The other 12 read `FATAL: sorry, too many clients already`, which a new backend gets when it finds no free slot at all: a connection takes its slot before the reserved-slot check, so for a moment all 100 were held, partly by connections that failed that check an instant later. A real pod would retry, and retrying pods keep the storm going.

Two tempting fixes make things worse. Raising `max_connections` to 800 gives each connection a process, memory and a share of the CPU, and PostgreSQL also sizes some shared memory from that setting. Dropping the pools and connecting per request moves the cost to every request: pgbench with 8 clients ran **15,103** checkout transactions a second with its connections kept open, and **353** with `-C`, a new connection per transaction, which spent 10.5 ms connecting before each one. [Serverless functions](../serverless/) push the same way: [AWS Lambda](../aws-lambda/) runs each concurrent request in its own execution environment, so a function that keeps a connection holds one per environment, and a burst of traffic multiplies them.

## How it works

**What a connection costs in PostgreSQL.** The postmaster forks one **backend process** per connection, and `ps` shows each of them under its own title, `postgres: checkout acme_shop 172.18.0.3(44996) idle`. The measurements come from one set of runs on a laptop: PostgreSQL 18.6 in a container with default settings except TLS and connection logging turned on, pinned to 4 CPU cores, a copy of Acme Shop's `orders` and `order_items`, PgBouncer 1.26.0 in a second container and pgbench 18.6 in a third. The checkout transaction reads one order and its items by primary key:

```sql
BEGIN;
SELECT status, total_thb FROM orders WHERE id = :id;
SELECT product_id, qty, price_thb FROM order_items WHERE order_id = :id;
END;
```

- **Setup time.** PostgreSQL 18 turned `log_connections` into a list of aspects, and `setup_durations` logs how long each connection took to become ready. For a single client reconnecting over TLS 1.3, the median was 6.4 ms: 0.2 ms to fork, 3.2 ms of SCRAM-SHA-256 authentication and the rest in the TLS handshake and backend startup; without TLS the total was 4.2 ms, so the handshake cost about 2.1 ms. The client measured 7.0 ms (4.7 ms without TLS). Authentication is slow on purpose: the client derives its proof by hashing the password `scram_iterations` times (4,096 by default), and a test role created with 512 iterations logged in with 0.65 ms of authentication instead of 3.1. That count protects stored password hashes against brute force, so keep it and reuse connections instead.
- **Memory.** `ps` reported about 22 MB of resident memory per idle backend, but most of that is shared: the shared buffers it has touched, the program code and pages it still shares with the postmaster. `/proc/<pid>/smaps_rollup` put the private part at 1.7 MB on average over 40 idle backends, so 800 backends would hold about 1.3 GB of private memory before running a single query. On top of that, each sort or hash step of a query may use up to `work_mem` (4 MB by default), and the per-backend catalog caches grow with the number of tables and indexes a session touches (`CacheMemoryContext` was 1 MB in a fresh session). Andres Freund's 2020 analysis found the private overhead below 2 MiB per connection with huge pages, and concluded that memory is not the main limit.
- **CPU and snapshots.** Every transaction takes at least one snapshot of which transactions are still running, and building it means walking over an entry for every established connection, idle or not. Freund's changes in PostgreSQL 14 packed those entries into dense arrays, removed work that every snapshot used to repeat, and reuse a snapshot when no transaction has ended since the last one, so idle connections now cost little: 85 idle connections made no measurable difference to 8 busy ones in this setup. Busy connections are another matter. With every client running checkouts flat out, 32 connections gave 24,206 transactions a second at 1.3 ms, 64 gave 24,553 at 2.6 ms and 90 gave 21,436 at 4.2 ms: past what 4 cores can run, extra connections only queue inside the database.

**Client-side pools and server-side poolers.** An application-side pool (HikariCP in Java, or the pools in pgx, node-postgres and SQLAlchemy) keeps a set of connections open and lends one to each request, so requests stop paying the setup cost. It cannot cap the total, though: the database still sees one connection per pool slot in every process. A server-side pooler such as PgBouncer sits between them, accepts many client connections and runs the queries over a few server connections of its own. It does not make connecting cheap: a new connection to PgBouncer still needs TCP, TLS and SCRAM, and took about 5 ms here against 7.0 ms straight to PostgreSQL, so the application pool is what removes the setup cost. PgBouncer has three modes:

| `pool_mode` | A client holds a server connection | What still works |
|---|---|---|
| `session` (the default) | from connect to disconnect | everything; it saves the fork and backend start, but needs as many server connections as connected clients |
| `transaction` | for one transaction | most applications; session state does not carry over (see *Trade-offs*) |
| `statement` | for one statement | autocommit only: multi-statement transactions are refused |

In the run, the 40 pods kept their pools of 20 but connected to PgBouncer in transaction mode with `default_pool_size = 20`. At 100 checkouts a second per pod, all 40 pods ran: 4,007 transactions a second at 1.7 ms on average, against the 3 pods that started without the pooler. `SHOW POOLS` on PgBouncer's admin console, sampled mid-run, read `cl_active 800, cl_waiting 0, sv_active 0, sv_idle 20, maxwait 0`, and `pg_stat_activity` showed exactly 20 `checkout` backends, idle between transactions.

**Sizing.** The PostgreSQL wiki offers a rule of thumb that benchmarks have long supported: for the best throughput, aim for about `(core_count × 2) + effective_spindle_count` active connections, where the spindle count is 0 when the working set is cached. HikariCP's *About Pool Sizing* repeats it as a starting point to test from, not an answer. For this 4-core server that is 8, and a pool of 8 served the same 4,000 checkouts a second at 1.5 ms. The flat-out runs above put the knee nearer 32 here, because each checkout spends part of its time waiting for the client's next statement, so measure with your own transactions. Then check the budget: without a pooler, pods × pool size must stay below `max_connections` minus the reserved slots and whatever monitoring, migrations and replication need; with PgBouncer, the server side is `default_pool_size` per database and user pair, plus `reserve_pool_size`.

**Timeouts and queueing.** When every server connection is busy, PgBouncer queues the client, which `SHOW POOLS` reports as `cl_waiting`, and `maxwait` says how long the oldest one has waited. `query_wait_timeout` (120 s by default) disconnects a client that waited too long, and the application pool has its own limit (HikariCP's `connectionTimeout`, 30 s by default); keep both well below what your users will wait. Run flat out, the 800 clients overwhelmed PgBouncer's single core: 778 of them were waiting, 16 of the 20 server connections sat `idle in transaction` waiting for a client's next statement, and the mean latency climbed to 73 ms. On the server, `idle_in_transaction_session_timeout` and `transaction_timeout` (PostgreSQL 17 and later) end transactions that a client left open, which would otherwise hold a pooled connection; the documentation warns against `idle_session_timeout` on connections that come through a pooler.

**Monitoring.** In PostgreSQL, `pg_stat_activity` grouped by `state`, `usename` and `application_name` shows who holds connections, and a recent `backend_start` on many rows means clients churn. In PgBouncer, `SHOW POOLS` (clients waiting, `maxwait`), `SHOW STATS` (transactions, query and wait times, and since 1.26 `client_login_count`, which exposes clients that reconnect all the time) and `SHOW CLIENTS` and `SHOW SERVERS` for single connections. Alert on `cl_waiting` and `maxwait`, not on the client count.

## Try it

The sample data comes from [samples/acme-shop](https://github.com/varapul/TechSolutions/tree/main/samples/acme-shop), a script that builds the template database `acme` on PostgreSQL 18 in about a minute.

Run the SQL in `psql` as a superuser on a fresh copy, then the two pgbench runs from a shell with `PGHOST`, `PGPORT` and `PGUSER` pointing at the same server. The comments show the key lines of one run on a laptop, where pgbench reached the server through Docker's port forwarding without TLS.

```sql
-- CREATE DATABASE connection_pooling TEMPLATE acme STRATEGY FILE_COPY;  then connect to it
SHOW max_connections;                 -- 100 by default (this run's server was set to 200)
SHOW superuser_reserved_connections;  -- 3

-- every connection is a process, and so is every background worker
SELECT backend_type, count(*) FROM pg_stat_activity GROUP BY 1 ORDER BY 2 DESC, 1;
--  io worker                    |     3
--  autovacuum launcher          |     1
--  background writer            |     1
--  checkpointer                 |     1
--  client backend               |     1      <- this psql session
--  logical replication launcher |     1
--  walwriter                    |     1

-- this backend's own memory (superusers and pg_read_all_stats members can read it)
SELECT pg_size_pretty(sum(total_bytes)) AS this_backend FROM pg_backend_memory_contexts;
--  2139 kB
SELECT name, pg_size_pretty(total_bytes) FROM pg_backend_memory_contexts
ORDER BY total_bytes DESC LIMIT 1;
--  CacheMemoryContext | 1024 kB
```

```sh
cat > checkout.sql <<'EOF'
\set id random(1, 500000)
BEGIN;
SELECT status, total_thb FROM orders WHERE id = :id;
SELECT product_id, qty, price_thb FROM order_items WHERE order_id = :id;
END;
EOF
pgbench -n -f checkout.sql -c 4 -j 2 -T 5 connection_pooling       # connections kept open
#  latency average = 2.317 ms
#  tps = 1726.581115 (without initial connection time)
pgbench -n -f checkout.sql -c 4 -j 2 -T 5 -C connection_pooling    # a new connection per transaction
#  latency average = 18.638 ms
#  average connection time = 8.170 ms
#  tps = 214.619540 (including reconnection times)

# PostgreSQL 18: log how long one connection took to set up (as a superuser)
PGOPTIONS='-c log_connections=setup_durations' psql -c 'SELECT 1' connection_pooling
#  server log: connection ready: setup total=6.560 ms, fork=0.242 ms, authentication=4.813 ms
```

Here the gap is 8× rather than the diagram's 43×: every round trip through the port forwarding took about half a millisecond, which made the kept-open runs slower too.

## When to use it

- **Always pool in long-running services.** An application-side pool per process is cheap and removes the setup cost from every request. Size it from the database's side: the total across all instances is what the server feels.
- **Add a server-side pooler in transaction mode** when the client connections add up to more than the database should run: many pods or processes, autoscaling, or connections that come and go, such as functions, per-request processes and batch jobs. It decouples how far the application scales out from what the database can run.
- **Session mode** fits clients that need session features but connect and disconnect often: it saves the fork and backend start of each new connection, but every connected client still holds a server connection.
- **Separate pools by workload.** A reporting job that holds connections for minutes should not drain the pool that checkout depends on; giving each its own pool is the [Bulkhead](../bulkhead/) pattern applied to connections.
- **Not needed** when a few instances with small pools fit comfortably under `max_connections` with room to spare. A pooler is one more thing to run.

## Trade-offs

- **Session state does not survive transaction pooling.** A server connection goes back to the pool after each transaction without being reset, because `server_reset_query` only runs in session mode. On a test pool of one server connection, which makes the reuse certain, pod 7's `SET statement_timeout = '5ms'` stayed on server pid 6715, and when pod 12 connected next and got the same server, its `SELECT count(*) FROM order_items` failed with `canceling statement due to statement timeout`. A session-level advisory lock taken through PgBouncer outlived the client that took it: a direct session could not acquire lock 42 after pod 7 disconnected, and pod 12 could release it although it never took it. PgBouncer's feature table lists `SET`/`RESET`, `LISTEN`, `WITH HOLD` cursors, SQL-level `PREPARE`, temporary tables that outlive a transaction, `LOAD` and session-level advisory locks as unsupported in transaction mode. Use `SET LOCAL` inside the transaction, or attach settings to the role or database (`ALTER ROLE checkout SET statement_timeout = '2s'`). PgBouncer does track the parameters PostgreSQL reports to clients, `application_name`, `TimeZone` and since 1.26 also `search_path` on PostgreSQL 18, so those are restored per client.
- **Prepared statements need a recent PgBouncer.** Protocol-level prepared statements, the kind drivers send, work in transaction mode since PgBouncer 1.21 and are on by default since 1.24 (`max_prepared_statements = 200`). With the setting at 0, pgbench in prepared mode failed at once with `prepared statement "P_0" already exists`, because two clients had prepared the same name on one server connection.
- **One more hop.** At one client, a checkout of four statements took 0.33 ms direct and 0.59 ms through PgBouncer. The pooler must be secured too (TLS on both sides, its own `auth_file` or `auth_query`), monitored and upgraded.
- **A single point of failure, on a single core.** PgBouncer is single-threaded: flat out, its one core capped the 800 clients at 10,943 transactions a second. Run two or more instances behind a load balancer or a Kubernetes Service, or several processes on one host with `so_reuseport`, which is also how PgBouncer 1.26 expects rolling restarts now that it dropped online restart.
- **Queueing hides overload.** A pooler turns too much load into waiting clients rather than errors. That protects the database, but without `query_wait_timeout`, application timeouts and alerts on `maxwait`, users simply wait (see [Timeout & Fallback](../timeout-and-fallback/)).
- **Pool deadlocks.** A client that holds a connection while it waits for another from the same pool can stall everyone. In one run, pgbench's prepared mode, whose threads block while preparing a statement, had 40 clients on 2 threads against 20 server connections: all 20 sat `idle in transaction` until `query_wait_timeout` disconnected the waiting clients 120 s later. HikariCP's sizing page describes the same pool-locking problem.

## Implementation notes

**The PgBouncer setup used here,** the essential lines of `pgbouncer.ini`:

```ini
[databases]
acme_shop = host=postgres port=5432 dbname=acme_shop

[pgbouncer]
; only whole lines can be comments, and without listen_addr only Unix sockets are open
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = scram-sha-256
; "checkout" "SCRAM-SHA-256$4096:…", copied from pg_authid
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
; server connections per database and user
default_pool_size = 20
; the default of 100 would refuse the 800 pods' connections
max_client_conn = 1000
client_tls_sslmode = require
client_tls_key_file = /etc/pgbouncer/server.key
client_tls_cert_file = /etc/pgbouncer/server.crt
server_tls_sslmode = require
; for SHOW POOLS on the pgbouncer admin database
admin_users = checkout
```

Keep the application pool's `maxLifetime` (30 minutes by default in HikariCP) a little shorter than anything that closes connections underneath it, such as a load balancer's idle timeout. Recycling connections now and then, by the pool's `maxLifetime` or by PgBouncer's `server_lifetime` (3,600 s by default) for its server connections, also frees catalog caches that grew in long sessions. [Locks and Deadlocks](../locks-and-deadlocks/) covers what a long transaction holds while it keeps a pooled connection.

**Amazon RDS Proxy** is the managed counterpart for RDS and [Aurora](../amazon-rds-aurora/). It keeps a pool per writer and reader endpoint and multiplexes at the transaction level by default. When it sees session state it *pins* the client to its database connection until the client disconnects: for PostgreSQL that includes `SET`, `PREPARE`, `DISCARD` and `DEALLOCATE`, temporary tables, cursors, `LISTEN`, `LOAD`, `nextval` and `setval`, session-level advisory locks, `set_config`, and any statement larger than 16 KB. Watch the CloudWatch metric `DatabaseConnectionsCurrentlySessionPinned`, and move the `SET` statements every connection needs into the proxy's initialization query. `MaxConnectionsPercent` caps the proxy's share of the database's `max_connections`, `ConnectionBorrowTimeout` (120 s by default) is its equivalent of `query_wait_timeout`, and idle client connections are closed after 30 minutes by default. It also keeps most client connections open through a failover, and the RDS documentation points Lambda functions at the proxy endpoint so that their connections share its pool.

**MySQL (8.4) uses threads, not processes.** By default (`thread_handling = one-thread-per-connection`) every connection gets a server thread, and disconnected clients leave their threads in a thread cache (`thread_cache_size`, sized automatically; 9 on a default 8.4.11 server) for the next connection, so connecting is cheaper than PostgreSQL's fork. The limit works the same way: `max_connections` is 151 by default and the server allows one more connection for an account with `CONNECTION_ADMIN`, so an administrator can still get in; others get `Too many connections`. The thread pool that caps how many statements run at once is a plugin of MySQL Enterprise Edition, so on the Community server the advice is the same as for PostgreSQL: keep the number of busy connections near what the cores can run, with application pools and, for many clients, a proxy (RDS Proxy supports MySQL as well).

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [Amazon RDS & Aurora](../amazon-rds-aurora/) — Managed relational databases: backups, Multi-AZ failover and read replicas, and Aurora's storage shared across three zones.
- [AWS Lambda](../aws-lambda/) — Functions as a service: code runs per event in managed execution environments that scale out with concurrency.
- [Autoscaling](../autoscaling/) — Add and remove instances automatically as load rises and falls.
- [Bulkhead](../bulkhead/) — Give each dependency its own pool of resources so one failure can't sink the whole ship.
- [Kubernetes](../kubernetes/) — A container orchestrator: you declare the desired state, and controllers keep pods scheduled, healthy and reachable.
- [MVCC](../mvcc/) — Multi-version concurrency control: an update writes a new row version, readers see a snapshot, and vacuum removes dead versions.
- [Locks & Deadlocks](../locks-and-deadlocks/) — Row locks make writers wait for each other; two transactions waiting on each other is a deadlock, and the database aborts one.
- [Table Partitioning](../table-partitioning/) — Split a large table into partitions by range, list or hash, so queries skip partitions and old data is dropped in an instant.

## References

- [PostgreSQL 18 documentation — Connections and Authentication (max_connections, reserved slots)](https://www.postgresql.org/docs/18/runtime-config-connection.html)
- [PostgreSQL 18 documentation — Error Reporting and Logging (log_connections = setup_durations)](https://www.postgresql.org/docs/18/runtime-config-logging.html)
- [PostgreSQL 18 documentation — Client Connection Defaults (statement_timeout, idle timeouts)](https://www.postgresql.org/docs/18/runtime-config-client.html)
- [PostgreSQL 18 documentation — pgbench](https://www.postgresql.org/docs/18/pgbench.html)
- [PostgreSQL 14 release notes (snapshot scalability)](https://www.postgresql.org/docs/release/14.0/)
- [PostgreSQL 18 release notes (log_connections stages, search_path reporting)](https://www.postgresql.org/docs/release/18.0/)
- [Andres Freund — Analyzing the Limits of Connection Scalability in Postgres (2020)](https://techcommunity.microsoft.com/blog/adforpostgresql/analyzing-the-limits-of-connection-scalability-in-postgres/1757266)
- [Andres Freund — Improving Postgres Connection Scalability: Snapshots (2020)](https://techcommunity.microsoft.com/blog/adforpostgresql/improving-postgres-connection-scalability-snapshots/1806462)
- [PgBouncer — Features (pool modes and the SQL feature map)](https://www.pgbouncer.org/features.html)
- [PgBouncer — Configuration](https://www.pgbouncer.org/config.html)
- [PgBouncer — Usage (SHOW POOLS and the admin console)](https://www.pgbouncer.org/usage.html)
- [PgBouncer — Changelog](https://www.pgbouncer.org/changelog.html)
- [PostgreSQL wiki — Number Of Database Connections](https://wiki.postgresql.org/wiki/Number_Of_Database_Connections)
- [HikariCP wiki — About Pool Sizing](https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing)
- [HikariCP — README (connectionTimeout, maxLifetime, maximumPoolSize)](https://github.com/brettwooldridge/HikariCP)
- [Amazon RDS User Guide — RDS Proxy concepts and terminology](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.howitworks.html)
- [Amazon RDS User Guide — Avoiding pinning an RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy-pinning.html)
- [Amazon RDS User Guide — RDS Proxy connection considerations](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy-connections.html)
- [MySQL 8.4 Reference Manual — Connection Interfaces (threads and the thread cache)](https://dev.mysql.com/doc/refman/8.4/en/connection-interfaces.html)
- [MySQL 8.4 Reference Manual — MySQL Enterprise Thread Pool](https://dev.mysql.com/doc/refman/8.4/en/thread-pool.html)
- [AWS Lambda Developer Guide — Understanding Lambda function scaling](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
