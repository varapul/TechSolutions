<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧱 System Components](../../README.md#system-components)

# Elasticsearch & OpenSearch

> Search engines built on inverted indexes: full-text queries ranked by relevance, and aggregations over sharded indexes.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Elasticsearch &amp; OpenSearch" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/elasticsearch.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Acme Shop keeps its catalogue in **PostgreSQL**, the system of record. Debezium reads each committed change and publishes it to the Kafka topic `acme.public.products`, and **search-indexer** writes it to the index **products** with the `_bulk` API. The app sends its searches here instead of to the database and gets ranked hits with brand counts; the same engine also serves log analytics, with logs kept in data streams. |
| **2 · Analyse, index, refresh** | The `english` analyzer splits *Red ceramic mug* into tokens, lower-cases them and stems them to the terms **red**, **ceram** and **mug**, and the **inverted index** lists, for each term, the documents that contain it. The write lands in an in-memory buffer and the **translog**, which is fsynced before the write is acknowledged. A **refresh**, every second here, turns the buffer into a new segment that search can see (near real time), and small segments are merged in the background. |
| **3 · Route, replicate, search** | The `_bulk` request reaches node-3, and `hash(_id) % 3` sends document `14` to shard 1: primary **P1** on node-2 indexes it and forwards it to replica **R1** on node-3, and only then is the write acknowledged. The search for *red mug* reaches **node-1**, which sends it to one copy of every shard (R0, R1 and P2 here); each returns its top hits with scores and its brand counts, and node-1 merges them, fetches the 3 winning documents and answers. |
| **4 · Failover and the limits** | **node-2** fails. The master promotes **R1** on node-3 to primary, searches and writes go on, and the cluster health is **yellow** until the missing replicas are rebuilt, which by default starts after 1 minute. The limits: the index is a derived copy that lags by the refresh interval and has no multi-document transactions, uncontrolled field names can blow up the mapping, deep pages with `from` and `size` are expensive, and the shard count is fixed when the index is created. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's catalogue lives in PostgreSQL, which is built for transactions: it keeps products, stock and orders consistent, but it is not a search engine. The shop's search box has to find *red mug* in titles and descriptions, match *mugs* as well as *mug*, put the best matches first and show how many hits each brand has, for every query of every visitor. `WHERE title ILIKE '%red%mug%'` can't use an ordinary B-tree index, knows nothing about word forms or relevance, and every facet count is one more aggregate query against the system of record. PostgreSQL's own full-text search (`tsvector`, `tsquery` and a GIN index) handles the matching and is often enough for a small catalogue, but its ranking functions use no statistics about the collection as a whole, and the search traffic still lands on the database or its replicas.

Elasticsearch and OpenSearch keep a second copy of the data, organised for search: an inverted index per field, relevance scoring with BM25, aggregations for facets and analytics, and a cluster that spreads each index over several machines. The copy is fed from the system of record, here by change data capture, and the shop sends its searches to it.

## How it works

The two products share one design: OpenSearch began in 2021 as a fork of Elasticsearch 7.10.2, and both are built on Apache Lucene (see *Elasticsearch or OpenSearch?* below). The versions on this page are Elasticsearch 9.5 (August 2026) and OpenSearch 3.9 (September 2026), current in October 2026; where the two differ, the text says so.

### Documents, mappings and analysis

An **index** holds JSON documents, each with an `_id`. Its **mapping** gives every field a type, and the type decides how the field is indexed:

- a `text` field is **analysed** into terms, for full-text search;
- a `keyword` field is kept whole, for exact filters, sorting and aggregations;
- numbers, dates, booleans, geo points and vectors have structures of their own.

Without an explicit mapping, Elasticsearch maps a new string field (unless it looks like a date; numeric detection is off by default) as `text` with a `.keyword` sub-field, so it is indexed both for full-text search and as an exact keyword. Setting `"dynamic": "strict"` makes the index reject documents with unknown fields instead.

An **analyzer** turns text into terms: character filters, then a tokenizer, then token filters. The built-in `english` analyzer in the scenario is the standard tokenizer followed by a possessive stemmer, lowercasing, English stop words, a keyword marker and the Porter stemmer. It turns *Red ceramic mug* into `red`, `ceram` and `mug`: a stem need not be a word, as the documentation's own example shows with *quickly* becoming `quickli`. The same analyzer runs on the query text, so *red mugs* becomes `red` and `mug` and still matches. The `_analyze` API shows what an analyzer makes of a string (see *Implementation notes*).

### The inverted index and relevance

For each field the index keeps a sorted dictionary of terms and, for every term, a **postings list**: the documents that contain it, with how often and where. Finding the documents for `mug` is a lookup in the dictionary rather than a scan, and the query `red mug` combines the lists for `red` and `mug`.

Matches are ranked by a relevance **score**. The default similarity is **BM25**, with `k1` = 1.2 and `b` = 0.75. A term that is rare in the collection counts for more than a common one (inverse document frequency); repeating a term in a document helps less and less, and `k1` sets how quickly that effect levels off; a match in a short field counts for more than the same match in a long one, and `b` sets how strongly length matters. By default each shard scores with its own term statistics (`search_type=query_then_fetch`), which is fast but can rank a little differently from one big index; `dfs_query_then_fetch` gathers global statistics first, at the cost of an extra round trip. The scores in the animation are made up for the example.

### Queries, filters and aggregations

A clause in the Query DSL runs in one of two contexts. In **query context** it decides whether a document matches and how well, and adds to `_score`. In **filter context** it is a yes-or-no test with no score: cheaper, and Elasticsearch caches the filters it sees often. A `bool` query mixes the two: its `must` and `should` clauses score, its `filter` and `must_not` clauses don't.

**Aggregations** run over every document the query matched, not just the page of hits. Bucket aggregations such as `terms`, `histogram`, `date_histogram` and `range` group them, and metric aggregations such as `avg`, `sum`, `percentiles` and `cardinality` compute values over each group. They read the columnar doc values that `keyword` and numeric fields have; a `text` field can't be aggregated unless you enable `fielddata`, which is held in heap memory. Across shards some results are estimates: each shard sends its top `shard_size` terms (by default `size * 1.5 + 10`) and the coordinating node merges them, so a term that just misses the cut on some shards can be undercounted, and `cardinality` counts distinct values approximately with HyperLogLog++.

The search from the animation:

```json
GET products/_search
{
  "query": {
    "bool": {
      "must":   { "multi_match": { "query": "red mug", "fields": ["title", "description"] } },
      "filter": { "term": { "category": "kitchen" } }
    }
  },
  "aggs": { "brands": { "terms": { "field": "brand" } } },
  "size": 3
}
```

It returns the top 3 of 5 hits (14, 24 and 63) and the buckets Hearth 3, Clayworks 1 and Oakline 1. Document 60, a red lamp in shard 1, contains `red` too, but the `category` filter leaves it out.

### Near real time: buffer, translog, refresh and segments

Each shard is a Lucene index made of immutable **segments**, each of them a small inverted index of its own. A write goes into an in-memory **indexing buffer** and is appended to the shard's **translog**. With the default `index.translog.durability: request`, the translog is fsynced and committed on the primary and on every assigned replica before the client gets its acknowledgement, so an acknowledged write survives a crash. With `async` it is fsynced every `index.translog.sync_interval` (5 s by default) instead, and a crash can lose the writes since the last one.

A document in the buffer can't be found yet. A **refresh** writes the buffer out as a new segment, into the filesystem cache rather than straight to disk, and opens it for search. Elasticsearch refreshes every second by default (`index.refresh_interval: 1s`; 5 s, which is also the minimum, on Elastic Cloud Serverless), but if the interval isn't set explicitly it skips shards that haven't been searched for 30 seconds (`index.search.idle.after`) until the next search arrives. OpenSearch has the same default and the same idle rule. This is why search is *near* real time: a change becomes visible within the refresh interval, not at once. A client that must read its own write can index with `refresh=wait_for`, which returns only after a refresh has made the change visible.

A **flush** makes segments durable with a Lucene commit, after which the translog no longer needs the operations it covered. Elasticsearch flushes on its own, and after a crash it replays the translog on top of the last commit. Segments are never changed in place: an update indexes a new version of the document and marks the old one deleted, and background **merges** combine small segments into larger ones, dropping deleted documents on the way.

### Shards, replicas and routing

A cluster is a set of **nodes**, and each node has **roles**: `master`, the data roles, `ingest`, `ml`, `transform` and others. A node without a `node.roles` setting gets the full default set, which includes `master`, the data roles and `ingest`. Whatever its roles, any node can take a client request and **coordinate** it.

An index is split into **primary shards** (`index.number_of_shards`, 1 by default and fixed when the index is created), and every primary has `index.number_of_replicas` copies (1 by default, changeable at any time). A replica is never placed on the node that holds its primary, so in the animation each of the three nodes holds one primary and the replica of another shard. Replicas protect against node failures and add search capacity, because a search can use any copy.

A document's shard comes from its **routing** value, which is the `_id` unless the request sets `routing`. For indices created with Elasticsearch 9.4 or later the shard is `hash(_routing) % number_of_primary_shards`, with a Murmur3 hash. Older indices, and OpenSearch, use a variant that also involves `index.number_of_routing_shards`, the setting that allows an index to be split later. For `_id` 14 both give shard 1, as in the animation. Either way the mapping from documents to shards depends on the shard count, which is why it can't simply change: the `_split` and `_shrink` APIs and `_reindex` build a new index with a different count.

A **write** goes from the node that received it to the primary, which validates and indexes the operation and forwards it, in parallel, to every replica in the **in-sync** set; when they have all answered, the primary acknowledges. A **search** runs in two phases. In the *query phase* the coordinating node sends it to one active copy of every shard, chosen by adaptive replica selection, and each shard returns the IDs and scores of its top `from + size` hits together with its aggregation results; the coordinating node merges them. In the *fetch phase* it asks the shards that hold the winners for those documents.

### The master, the cluster state and failover

The **master-eligible** nodes elect one **master** by quorum. The master keeps the **cluster state** (which indices exist, their mappings and settings, and which node holds which shard copy) and publishes every change to all the nodes. With three master-eligible nodes, one can fail and the other two still form a majority. A small cluster lets these nodes hold data too, as in the animation; a larger one uses **dedicated master-eligible nodes** (`node.roles: [ master ]`), so that heavy indexing or searching can't slow the master down. OpenSearch calls the role **cluster manager**.

The master removes a node from the cluster as soon as its connection drops, or after 3 failed follower checks in a row if it stops answering (one check a second by default, each with a 10-second timeout). It then promotes a replica to primary for every primary the lost node held; indexing requests for those shards wait, up to 1 minute by default, for the new primary and then carry on. The missing replicas are rebuilt on the remaining nodes once `index.unassigned.node_left.delayed_timeout` has passed (1 minute by default), a delay that saves copying whole shards when the node comes straight back. `GET _cluster/health` reports **green** when every shard copy is assigned, **yellow** when all the primaries are but some replicas are not, and **red** when a primary is missing, so some data can't be searched or written.

### Vector search

Both engines also index vectors for k-nearest-neighbour (kNN) search, as used for semantic search over embeddings. Elasticsearch stores them in `dense_vector` fields of up to 4,096 dimensions. Approximate kNN search uses **HNSW** graphs, which the documentation describes as giving up some accuracy for speed; exact, brute-force kNN suits small sets and pre-filtered subsets. Float vectors are quantized by default, and the default index type has changed between releases: `int8_hnsw` in 9.0; from 9.1, `bbq_hnsw` for vectors of 384 or more dimensions; from 9.4, `bbq_disk` where the license includes it. Check the `dense_vector` page for your version. OpenSearch uses `knn_vector` fields, indexed with HNSW or IVF by the Faiss engine (the default) or with HNSW by Lucene; its older NMSLIB engine is deprecated.

### Time-based data and snapshots

Logs and metrics are written once and queried by time, so they usually go into **data streams**: one name in front of a series of backing indices, of which only the newest takes writes. **Index lifecycle management (ILM)** rolls a stream over to a new backing index when the current one reaches a given age, size or document count, moves older indices to cheaper hardware (the hot, warm, cold and frozen tiers) and deletes them when the retention period ends. OpenSearch does the same with **Index State Management (ISM)** policies.

**Snapshots** are the backup: copies of indices and cluster state in a repository outside the cluster, usually object storage such as [Amazon S3](../amazon-s3/), Google Cloud Storage or Azure Blob Storage, taken on a schedule by snapshot lifecycle policies. Because segments never change, a snapshot copies only the segments the repository doesn't hold yet. Replicas are not a backup, since a mistaken delete or a bad update reaches every copy within moments. In Elasticsearch, searchable snapshots can also serve the cold and frozen tiers straight from the repository.

## Where it fits

- **Solutions:** product and site search with facets and typo-tolerant (fuzzy) queries; log, metric and trace analytics with Kibana or OpenSearch Dashboards; search over data owned by other services, fed by change data capture; semantic search over embeddings.
- **Patterns in this catalog it implements or supports:** a read model in [CQRS](../cqrs/) and a [materialized view](../materialized-view/) of data owned elsewhere; the receiving end of [change data capture](../change-data-capture/); the store and query engine of [centralized logging](../centralized-logging/). Inside, an index is [sharded](../sharding/) by a hash of the routing value, replicas work like [read replicas](../read-replicas/) that can also take over as primaries, and the master is chosen by quorum, much as in [leader election](../leader-election/).
- **Usual neighbours:** a system of record such as [PostgreSQL](../postgresql/); a change stream from Debezium through [Kafka](../kafka/), or a transactional outbox; an indexer that writes with the `_bulk` API; log shippers such as Elastic Agent, Beats, Logstash, Fluent Bit or OpenSearch Data Prepper; Kibana or OpenSearch Dashboards; and an application or search API in front, because browsers should not query the cluster directly.
- **Managed offerings:** **Amazon OpenSearch Service** runs managed domains with OpenSearch (versions up to 3.5 in October 2026) or legacy Elasticsearch (up to 7.10). **Amazon OpenSearch Serverless** offers collections of three types (search, time series and vector search) that scale in OpenSearch Compute Units, sized separately for indexing and for search, with the data kept in Amazon S3. **Elastic Cloud** runs Elasticsearch either as hosted deployments that you size or as serverless projects, in the cloud provider and region you choose.

## When to use it

Use it when search is a feature in its own right: full-text queries ranked by relevance, facets and aggregations over many documents, log and event analytics at volume, or vector search next to text. It suits data you can rebuild from somewhere else and can serve about a second late. Keep the system of record in a database: the index has no multi-document transactions, and it is only as complete as the pipeline that feeds it.

| | Elasticsearch | OpenSearch | Apache Solr | PostgreSQL full-text search | Meilisearch, Typesense |
|---|---|---|---|---|---|
| Licence | Source under AGPLv3, SSPL or Elastic License 2.0; Elastic's binaries under ELv2 | Apache 2.0, in the OpenSearch Software Foundation | Apache 2.0, an Apache Software Foundation project | PostgreSQL Licence | Meilisearch: MIT, with Enterprise Edition parts under BUSL 1.1. Typesense: GPL-3.0 |
| Index and ranking | Lucene, BM25 by default | Lucene, BM25 by default | Lucene, BM25 by default | `tsvector` with a GIN or GiST index; `ts_rank` uses no collection-wide statistics | Their own engines, with built-in typo tolerance; Meilisearch ranks by ordered rules |
| Scaling out | Shards and replicas, master election built in | The same; segment replication as an option | SolrCloud: shards and replicas, coordinated by ZooKeeper | The database's own: read replicas, partitioning | Meilisearch: sharding and replication in the Enterprise Edition. Typesense: a Raft cluster that keeps the whole dataset in memory on every node |
| Vectors | `dense_vector`, HNSW | `knn_vector`, Faiss or Lucene | `DenseVectorField`, HNSW | the pgvector extension: HNSW, IVFFlat | Semantic search with embeddings |
| Managed offering | Elastic Cloud, on AWS among other clouds | Amazon OpenSearch Service and OpenSearch Serverless | No AWS-managed Solr | Amazon RDS, [Amazon Aurora](../amazon-rds-aurora/) | Meilisearch Cloud, Typesense Cloud |
| Choose it when | You want Elastic's features and tools, self-managed or on Elastic Cloud | You want Apache 2.0 or the AWS-managed service | You already run Solr or depend on its features | The catalogue is modest and the data is already in PostgreSQL | One small to medium index needs instant, typo-tolerant search with little to operate |

Facts from the Elastic, OpenSearch, Solr, PostgreSQL 18, pgvector, Meilisearch and Typesense documentation, October 2026.

**Elasticsearch or OpenSearch?** Elasticsearch was licensed under Apache 2.0 until January 2021, when Elastic announced that, starting with 7.11, its source would be dual-licensed under the Server Side Public License (SSPL) and the Elastic License, neither of them approved by the OSI; Elastic presented the SSPL as protection against cloud providers that offer open-source software as a service without contributing back. A week later AWS said it would fork the last Apache-licensed code, and in April 2021 it introduced OpenSearch and OpenSearch Dashboards, derived from Elasticsearch and Kibana 7.10.2 and licensed under Apache 2.0, with 1.0 following in July 2021; Amazon Elasticsearch Service became Amazon OpenSearch Service. In August 2024 Elastic announced the OSI-approved AGPLv3 as a third option for the source of Elasticsearch and Kibana, in the source by the 8.16 release; Elastic's own binary distribution stays under the Elastic License 2.0. In September 2024 AWS moved OpenSearch to the new OpenSearch Software Foundation in the Linux Foundation. The two have drifted apart since 2021: APIs, features, clients and versions differ (a direct upgrade to OpenSearch is documented only from Elasticsearch OSS 6.8.0 to 7.10.2), so pick one, test against the version you run, and check the licence against how you distribute or host it.

## Trade-offs

- **A second copy to keep in step.** The index is derived data. It lags the database by the pipeline's delay plus the refresh interval, it can miss or replay changes if the pipeline does, and nothing makes a write to PostgreSQL and to the index atomic. Keep the source of truth elsewhere and make sure you can rebuild the index from it.
- **No transactions across documents.** A single document write is atomic and versioned (`if_seq_no` and `if_primary_term` give optimistic concurrency control), but a `_bulk` request can partly fail, item by item, and there is no rollback.
- **Mappings are hard to change.** You can add fields, but changing a field's type or analyzer means a new index and a reindex. Field names that come from data (user-supplied JSON keys, IDs used as keys) grow the mapping until `index.mapping.total_fields.limit` (1,000 by default) rejects new ones: a **mapping explosion**.
- **Deep pages are expensive.** Every shard has to load `from + size` hits for the coordinating node to merge, so page 500 costs far more than page 1, and `index.max_result_window` stops `from + size` at 10,000. Use `search_after`, with a point in time (PIT) for a consistent view, to page deep; the scroll API is no longer recommended for that.
- **Shards are a decision made up front.** Too few limit how far an index can spread over nodes; too many cost memory and coordination and slow searches down (oversharding). Elastic suggests shards of 10 to 50 GB with fewer than 200 million documents each; AWS suggests 10 to 30 GiB where search latency matters most and 30 to 50 GiB for write-heavy workloads such as log analytics.
- **Approximate answers.** `terms` aggregations across shards can undercount, `cardinality` is estimated, per-shard statistics can shift scores, and approximate kNN can miss some true neighbours.
- **Relevance needs work.** BM25 gives a reasonable default, but good product search usually needs synonyms, per-field boosts, business signals and testing against real queries.
- **Memory hungry.** The JVM heap holds the engine's own structures, and the operating system's filesystem cache, which needs as much memory again, is what keeps segments fast.

## Implementation notes

The index from the scenario and what its analyzer does to a title:

```text
PUT products
{
  "settings": { "number_of_shards": 3, "number_of_replicas": 1, "refresh_interval": "1s" },
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "title":       { "type": "text", "analyzer": "english" },
      "description": { "type": "text", "analyzer": "english" },
      "category":    { "type": "keyword" },
      "brand":       { "type": "keyword" }
    }
  }
}

GET products/_analyze
{ "analyzer": "english", "text": "Red ceramic mug" }
# returns the tokens red, ceram and mug
```

- **Index with the database's key and order.** Use the row's primary key as `_id`, so a replayed change overwrites the document instead of adding a second one, and pass a number that grows with every change of the row, such as the `lsn` in the `source` block of a Debezium event, as an external version. Elasticsearch then accepts a write only if its version is higher than the stored one, so a late, older change can't overwrite a newer one; treat the resulting version conflict (409) as already applied.

  ```text
  POST _bulk
  { "index": { "_index": "products", "_id": "14", "version": 48213207, "version_type": "external" } }
  { "title": "Red ceramic mug", "category": "kitchen", "brand": "Clayworks" }
  ```

- **Load in bulk.** For a first load or a full rebuild, set `refresh_interval` to `-1` and `number_of_replicas` to `0`, then restore both; without replicas a lost node can lose data in the meantime. Find the `_bulk` size by measuring: start around 100 documents per request and double it until throughput stops improving, and send from several workers.
- **Search an alias, not the index.** Let the application query an alias such as `products` that points to `products-v1`. To change a mapping, build `products-v2`, fill it from the source or with `_reindex`, and move the alias in a single `_aliases` request, which is atomic.
- **Size the heap carefully.** Elasticsearch sets the JVM heap from the node's roles and memory, and Elastic recommends keeping that default. If you set it, give `-Xms` and `-Xmx` the same value, at most 50% of the memory available to the node and below the threshold for compressed object pointers (26 GB is safe on most systems), and leave the rest to the filesystem cache. OpenSearch starts with a 1 GB heap, and its documentation recommends half of the system's RAM.
- **Mind the cluster's limits.** Elasticsearch refuses to create more than 1,000 non-frozen shards per node by default, and Elastic's rule of thumb gives master-eligible nodes 1 GB of heap per 3,000 indices. For time-based data, let rollover cap shard size (ILM's `max_primary_shard_size`, 50 GB in Elastic's guidance).
- **Run three master-eligible nodes.** With two, losing either one leaves no majority to elect a master. Move to dedicated master-eligible nodes once the cluster has more than a handful of nodes.
- **Secure it.** On its first start Elasticsearch generates TLS certificates for the HTTP and transport layers and sets a password for the `elastic` superuser. OpenSearch's default installs use a demo security configuration with self-signed certificates and well-known passwords, to be replaced before production. Give each application a role limited to its indices, keep the cluster on a private network behind the application, and never let browsers query it directly.
- **Watch it.** Cluster health and unassigned shards (`GET _cluster/health`, `GET _cluster/allocation/explain`), heap use and garbage collection, indexing and search latency, rejected requests in the thread pools, disk use against the allocation watermarks, and the indexer's consumer lag in Kafka.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Materialized View](../materialized-view/) — Precompute query-shaped views so reads don't pay for joins and aggregations.
- [CQRS](../cqrs/) — Separate the write model (commands) from read models (queries), each optimised for its job.
- [Change Data Capture (CDC)](../change-data-capture/) — Stream every committed change from the database log to other systems.
- [Centralized Logging](../centralized-logging/) — Ship structured logs from every service to one searchable store, correlated by request ID.
- [Apache Kafka](../kafka/) — A partitioned, replicated commit log: producers append events, consumer groups read at their own pace and can replay history.
- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [Sharding](../sharding/) — Split data horizontally across databases using a shard key.
- [Read Replicas](../read-replicas/) — Send writes to the primary and spread reads across asynchronously updated replicas.

## References

- [Elastic Docs — Elasticsearch release notes](https://www.elastic.co/docs/release-notes/elasticsearch)
- [Elastic Docs — Near real-time search](https://www.elastic.co/docs/manage-data/data-store/near-real-time-search)
- [Elastic Docs — Reading and writing documents](https://www.elastic.co/docs/deploy-manage/distributed-architecture/reading-and-writing-documents)
- [Elastic Docs — Node roles](https://www.elastic.co/docs/deploy-manage/distributed-architecture/clusters-nodes-shards/node-roles)
- [Elasticsearch Reference — _routing field](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/mapping-routing-field)
- [Elasticsearch Reference — General index settings](https://www.elastic.co/docs/reference/elasticsearch/index-settings/index-modules)
- [Elasticsearch Reference — Translog settings](https://www.elastic.co/docs/reference/elasticsearch/index-settings/translog)
- [Elasticsearch Reference — Similarity settings (BM25)](https://www.elastic.co/docs/reference/elasticsearch/index-settings/similarity)
- [Elasticsearch Reference — Language analyzers](https://www.elastic.co/docs/reference/text-analysis/analysis-lang-analyzer)
- [Elastic Docs — Query DSL (query and filter context)](https://www.elastic.co/docs/explore-analyze/query-filter/languages/querydsl)
- [Elasticsearch Reference — Terms aggregation](https://www.elastic.co/docs/reference/aggregations/search-aggregations-bucket-terms-aggregation)
- [Elasticsearch Reference — Paginate search results](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/paginate-search-results)
- [Elasticsearch Reference — Mapping limit settings](https://www.elastic.co/docs/reference/elasticsearch/index-settings/mapping-limit)
- [Elastic Docs — Delaying allocation when a node leaves](https://www.elastic.co/docs/deploy-manage/distributed-architecture/shard-allocation-relocation-recovery/delaying-allocation-when-node-leaves)
- [Elastic Docs — Cluster fault detection](https://www.elastic.co/docs/deploy-manage/distributed-architecture/discovery-cluster-formation/cluster-fault-detection)
- [Elastic Docs — Red or yellow cluster health status](https://www.elastic.co/docs/troubleshoot/elasticsearch/red-yellow-cluster-status)
- [Elastic Docs — Size your shards](https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/size-shards)
- [Elasticsearch Reference — JVM settings](https://www.elastic.co/docs/reference/elasticsearch/jvm-settings)
- [Elastic Docs — Tune for indexing speed](https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/indexing-speed)
- [Elasticsearch Reference — Dense vector field type](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/dense-vector)
- [Elastic Docs — Index lifecycle management (ILM) in Elasticsearch](https://www.elastic.co/docs/manage-data/lifecycle/index-lifecycle-management)
- [Elastic Docs — Snapshot and restore](https://www.elastic.co/docs/deploy-manage/tools/snapshot-and-restore)
- [Elastic Blog — Doubling down on open, Part II (January 2021)](https://www.elastic.co/blog/licensing-change)
- [Elastic Blog — Elasticsearch is open source. Again! (August 2024)](https://www.elastic.co/blog/elasticsearch-is-open-source-again)
- [Elastic — FAQ on software licensing](https://www.elastic.co/pricing/faq/licensing)
- [AWS Open Source Blog — Introducing OpenSearch (April 2021)](https://aws.amazon.com/blogs/opensource/introducing-opensearch/)
- [Linux Foundation — Linux Foundation Announces OpenSearch Software Foundation (September 2024)](https://www.linuxfoundation.org/press/linux-foundation-announces-opensearch-software-foundation-to-foster-open-collaboration-in-search-and-analytics)
- [OpenSearch — FAQ](https://opensearch.org/faq/)
- [OpenSearch documentation — Index settings](https://docs.opensearch.org/latest/install-and-configure/configuring-opensearch/index-settings/)
- [OpenSearch documentation — Methods and engines (k-NN)](https://docs.opensearch.org/latest/mappings/supported-field-types/knn-methods-engines/)
- [OpenSearch documentation — Index State Management](https://docs.opensearch.org/latest/im-plugin/ism/index/)
- [Amazon OpenSearch Service Developer Guide — What is Amazon OpenSearch Service?](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/what-is.html)
- [Amazon OpenSearch Service Developer Guide — What is Amazon OpenSearch Serverless?](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-overview.html)
- [Amazon OpenSearch Service Developer Guide — Choosing the number of shards](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/bp-sharding.html)
- [PostgreSQL 18 documentation — Controlling Text Search](https://www.postgresql.org/docs/current/textsearch-controls.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
