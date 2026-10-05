<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🚪 API & Edge](../../README.md#api--edge)

# GraphQL Federation

> Subgraphs from many services compose into one graph; a router plans each query across them.

<p align="center"><img src="diagram.svg" alt="Animated diagram: GraphQL Federation" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/graphql-federation.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One graph, many teams** | Each team owns a **subgraph** and publishes its schema from its own build. `Product` is an **entity**: `@key(fields: "id")` lets Reviews add `reviews` and Inventory add `inStock` to the type that Products defines. **Composition** merges the three schemas into one **supergraph schema** for the router. When Inventory also defines `price`, as a `String` where Products has `Float!`, composition fails in Inventory's build and nothing is deployed. |
| **2 · Router plans each query** | The mobile app sends `query { product(id: 42) { name price reviews { rating } inStock } }` to the router's single endpoint. The **query planner** splits it by field ownership: Products resolves `product(id: 42)` and returns `name`, `price` and the key `id`; then Reviews and Inventory are asked **in parallel**, through their `_entities` field, for the `reviews` and `inStock` of `Product` 42. The router merges the three results into one response shaped exactly like the query. |
| **3 · Checked before they ship** | The Reviews team removes `Review.rating`. Its build runs a **schema check**: the change still composes, but the registry compares it with the operations clients actually sent in the last 7 days, finds that the mobile app's query still reads `rating`, and **blocks the change as breaking**. Adding a `stars` field instead passes, so Reviews ships v13 on its own schedule and the router loads the new supergraph; Products and Inventory don't redeploy. |
| **4 · Know the costs** | Entity fetches that wait for a key run in sequence, so each round adds latency, and a subgraph that loads entities one at a time makes a database call per key unless it batches them. Clients write the queries, so limit depth and cost or allow only persisted, trusted operations (see [Rate Limiting](../rate-limiting/)); the router can check scopes, but each subgraph must still authorise access. The router is on every request's path: scale it, monitor it and [trace](../distributed-tracing/) each query across the subgraphs. When Inventory fails, the client still gets `name`, `price` and `reviews`, with `inStock: null` and an entry in `errors`. |
<!-- END GENERATED: header -->
## The problem

A product page in a [microservices](../microservices/) system needs data that three teams own: Products has the name and price, Reviews has the ratings, Inventory knows what is in stock. The client wants all of it in one request, shaped the way the screen needs it.

GraphQL gives clients exactly that: one endpoint, and a query that names the fields. The hard part is who builds and runs the server.

- **One GraphQL server for the whole company.** Every team's types and resolvers live in one codebase and ship in one deploy. The team that owns the server becomes a queue, and one bad change blocks everyone's release.
- **One GraphQL API per team.** Each team ships on its own, but clients are back to calling several endpoints and joining the answers themselves, and a `Review` in one API can't point to a `Product` in another.
- **A hand-written endpoint per screen.** An aggregation endpoint ([Gateway Aggregation](../gateway-aggregation/)) merges fixed calls, and it changes every time a screen does.

Federation keeps one graph for the clients while each team owns, ships and runs its own part of it.

## How it works

### GraphQL in brief

A GraphQL service publishes a **schema**: object types, their fields and the fields' types, plus root types (`Query` for reads, `Mutation` for writes). A client sends a **query** that selects the fields it wants. The server validates the query against the schema and executes it, calling a **resolver** for each field, and returns JSON whose `data` has the same shape as the selection. A field that fails doesn't fail the whole request: it becomes `null`, and the response carries an `errors` entry with the field's path. The latest edition of the specification is September 2025.

### Subgraphs, entities and keys

In **Apollo Federation 2**, each team's service is a **subgraph**: an ordinary GraphQL server whose schema imports the federation directives with `@link` and declares the types and fields it owns. The three subgraphs in the diagram:

```graphql
# Products subgraph
extend schema @link(url: "https://specs.apollo.dev/federation/v2.12", import: ["@key"])

type Query {
  product(id: ID!): Product
}

type Product @key(fields: "id") {
  id: ID!
  name: String!
  price: Float!
}
```

```graphql
# Reviews subgraph
extend schema @link(url: "https://specs.apollo.dev/federation/v2.12", import: ["@key"])

type Product @key(fields: "id") {
  id: ID!
  reviews: [Review!]!
}

type Review {
  rating: Int!
  text: String
}
```

```graphql
# Inventory subgraph
extend schema @link(url: "https://specs.apollo.dev/federation/v2.12", import: ["@key"])

type Product @key(fields: "id") {
  id: ID!
  inStock: Boolean
}
```

- `Product` is an **entity**: an object type with a `@key`. The key names the fields that identify one instance, here `id`, so any subgraph that knows a product's `id` can add fields to it. Reviews contributes `reviews`, Inventory contributes `inStock`, and none of them needs to know how the others store their data.
- Each subgraph that contributes fields to an entity implements a **reference resolver**: given a key, it returns that entity's fields from its own data. In Apollo Server this is `__resolveReference`; in Netflix's DGS framework for Java and Kotlin it is a method annotated with `@DgsEntityFetcher`.
- By default a field belongs to exactly one subgraph. If two subgraphs should both resolve it, both mark it `@shareable`; key fields such as `id` are shareable automatically.
- The version in the `@link` URL selects which directives the schema can use. Apollo's changelog lists Federation v2.15 (July 2026) as the latest: a long-term-support release that rewrote composition in Rust and added no directives. Use the newest version your router supports.

Other directives you will meet, with the version that introduced them:

| Directive | What it does | Since |
|---|---|---|
| `@external`, `@requires`, `@provides` | Work with fields another subgraph resolves: `@requires` makes the router fetch them before calling this subgraph; `@provides` says this subgraph can return them at a particular path. | v2.0 |
| `@override` | Moves a field's ownership from one subgraph to another; with a `label`, traffic moves over gradually. | v2.0 (labels v2.7) |
| `@inaccessible`, `@tag` | Hide a field from the client-facing API schema; attach metadata for tooling and contracts. | v2.0 |
| `@composeDirective` | Keeps a custom directive in the supergraph. | v2.1 |
| `@interfaceObject` | Lets a subgraph add fields to an entity interface without defining the types that implement it. | v2.3 |
| `@authenticated`, `@requiresScopes` | Router-level authorisation by authentication state or JWT scopes. | v2.5 |
| `@policy` | Router-level authorisation by a custom policy. | v2.6 |
| `@context`, `@fromContext` | Pass a value from a type higher up in the query to a field's argument further down. | v2.8 |
| `@cost`, `@listSize` | Weights for demand control (cost limits). | v2.9 |
| `@cacheTag` | Tags cached data so it can be invalidated. | v2.12 |

### The subgraph contract

The router never sees a subgraph's code, only a small protocol that every federation-compatible server implements:

- `Query._service { sdl }` returns the subgraph's schema, federation directives included, so that tooling can fetch it for composition. It is not part of the composed schema; only the router and tooling should call it.
- `Query._entities(representations: [_Any!]!): [_Entity]!` resolves entities by key. Each **representation** is a JSON object with `__typename` and the key fields, such as `{"__typename": "Product", "id": "42"}`. The subgraph returns one result per representation, in the same order, or `null` where it has no such entity. `_Entity` is a union of every type in the subgraph that has a `@key`.

The entity fetch that step 2 sends to Reviews:

```graphql
query ($representations: [_Any!]!) {
  _entities(representations: $representations) {
    ... on Product { reviews { rating } }
  }
}
```

with `{"representations": [{"__typename": "Product", "id": "42"}]}` as its variables. Because `_entities` returns any entity to any caller that knows its key, a subgraph must be reachable only by the router (see *Security* below).

### Composition and the supergraph

**Composition** merges the subgraph schemas into one **supergraph schema**: every type and field, plus metadata that records which subgraph resolves which field and by which keys. Clients see the **API schema** derived from it, without anything marked `@inaccessible`.

Composition also checks that the pieces fit. A field that two subgraphs both resolve without `@shareable` fails with `INVALID_FIELD_SHARING`, and a field whose types can't be reconciled across subgraphs fails with `FIELD_TYPE_MISMATCH`; Inventory's `price: String` in step 1 breaks both rules. When composition fails, no new supergraph is produced and the router carries on with the last one that composed, so a conflict stays in the build that caused it.

Composition runs in one of two places:

- **In your own pipeline,** with a CLI such as `rover supergraph compose`, producing a supergraph file that you deploy with the router.
- **In a schema registry** (Apollo calls this managed federation): each subgraph publishes its schema, the registry composes the supergraph, and the routers fetch the new version and switch to it without a restart.

### Query planning

For every operation the router builds a **query plan** from the supergraph: which subgraph resolves which fields, which fetches depend on others, and which can run at the same time. Routers cache plans, so a repeated operation is usually not planned again. For the example query:

1. **Fetch from Products** `product(id: 42) { __typename id name price }`. Products owns the root field, and `__typename` plus `id` form the representation the next fetches need.
2. **In parallel,** fetch `reviews { rating }` from Reviews and `inStock` from Inventory through `_entities`, passing that representation.
3. **Merge** the answers into one response in the shape of the query.

Apollo's query plans are trees of nodes such as `Sequence`, `Parallel`, `Fetch` and `Flatten`; `Flatten` merges an entity fetch's result into the data at a given path. A plan takes as long as its longest chain of dependent fetches, so a query that hops from entity to entity across subgraphs pays a round trip per hop.

### Routers and subgraph frameworks

- **Apollo Router** (Apollo): written in Rust and source-available under the Elastic License 2.0, usually run with Apollo's GraphOS registry. Several of its features, including the authorisation directives, demand control, safelisting and response caching, need a GraphOS plan. It can also call REST APIs declared in the schema with Apollo Connectors (`@connect`, Federation v2.10).
- **Cosmo Router** (WunderGraph): written in Go under the Apache 2.0 licence and compatible with Federation v1 and v2. It is part of the open-source Cosmo platform, which has its own registry and the `wgc` CLI.
- **Hive Gateway** and **Hive Router** (The Guild): Hive Gateway is a JavaScript gateway that runs on Node.js, Bun, Deno and serverless platforms and can also stitch schemas; Hive Router is written in Rust. Both are MIT-licensed and work with the Hive schema registry.
- **Fusion** (ChilliCream): a .NET gateway built on Hot Chocolate. Its native model is the GraphQL Foundation's draft specification (below), and a connector lets it also run Apollo Federation subgraphs unchanged, so one graph can mix both.
- **Grafbase:** The Guild acquired Grafbase in February 2026. Its gateway is in maintenance mode, and its users are pointed to Hive Router.

Subgraphs can be written with almost any GraphQL server: Apollo Server, Netflix's **DGS** framework on Spring Boot, Hot Chocolate and many others implement the subgraph contract.

### A vendor-neutral specification in progress

Apollo Federation is defined by Apollo's documentation and its subgraph specification. The GraphQL Foundation's **Composite Schemas Working Group**, with members from vendors including Apollo, ChilliCream, The Guild and WunderGraph, is writing a neutral standard. In September 2026 the draft was renamed from *Composite Schemas* to the **GraphQL Federation specification**. Its repository still marks it *Stage 0: Preliminary*, so details can change before it reaches the Draft stage.

Its model is close to Apollo's: **source schemas** compose into a **composite schema**, and `@key`, `@shareable`, `@provides`, `@external`, `@override` and `@inaccessible` all exist. The visible difference is entity lookup. Instead of a special `_entities` field, a source schema marks ordinary query fields, such as `productById(id: ID!)`, with `@lookup`, and the executor calls those to fetch an entity by its key. Fusion already builds on this model.

## When to use it

- **Several teams build one API.** Each team owns its types and fields and ships on its own schedule, while composition and schema checks catch conflicts between teams before anything is deployed.
- **Many clients with different needs.** Web, mobile and partner apps each select the fields they need from one schema, instead of asking for a new endpoint per screen.
- **Data that crosses service boundaries.** A product, its reviews and its stock come back in one request, and a new field in any subgraph is available to every client once it composes.
- **A GraphQL server that has outgrown one team.** Moving its types into subgraphs one at a time can leave the client-facing schema, and the clients' queries, unchanged.

### When not to use it

- **One team and one service.** A single GraphQL server, or a plain REST API, gives the same result without a router, a registry and composition rules. GraphQL.org's federation page also suggests starting with one schema and moving to federation as the needs grow.
- **Simple clients that REST serves well.** Resource-shaped APIs, public APIs that lean on plain HTTP caching, and server-to-server integrations rarely gain from a query language and a router.
- **File-heavy APIs.** Streaming large uploads and downloads through a GraphQL router ties it up; hand out a short-lived URL for the object store instead ([Valet Key](../valet-key/)).
- **Write-heavy or transactional APIs.** Federation's strength is composing reads. Each mutation field is executed by a single subgraph, and a change that spans subgraphs gets no transaction: it needs a saga ([Saga Orchestration](../saga-orchestration/)) whatever API sits in front.
- **No one to run it.** The router, the registry and the schema rules need an owner. Without a platform team, a shared graph decays.

### Federation, gateway aggregation or a BFF?

| | GraphQL federation | [Gateway aggregation](../gateway-aggregation/) | [Backend for Frontend](../backends-for-frontends/) |
|---|---|---|---|
| Who chooses the response shape | The client, field by field, within one schema | The team that writes the aggregation endpoint | The frontend team, for its own client |
| Where the joining logic lives | Declared in the subgraph schemas through keys; the router plans each query | Hand-written per endpoint | Code in each BFF |
| A new screen needs | A new query, usually no server change | A new or changed endpoint | A change in that client's BFF |
| Who owns it | Each domain team owns its subgraph; a platform team runs the router | The gateway team | The frontend team |

They combine well: an [API gateway](../api-gateway/) often sits in front of the router for TLS, rate limits and routing, and a BFF can itself be a client of the federated graph.

## Trade-offs

- **One more hop on every request, and more for deep queries.** The router adds its own processing time, and every chain of dependent entity fetches adds a round trip inside the data centre. Keep keys where the next fetch needs them, and look at the plans of slow operations.
- **The router is critical infrastructure.** Every query passes through it, so it needs several instances, capacity planning and alerts. A router outage is an outage of the whole API.
- **Clients write the queries.** A query can be expensive in ways no endpoint review would catch. On a public graph, cost limits, depth limits or a safelist of operations are not optional.
- **HTTP caching is harder.** Queries go to one endpoint, usually as POST, so CDNs and browsers find little to reuse; caching moves into the router and the subgraphs.
- **Partial results are part of the contract.** A slow or failing subgraph turns into `null` fields plus `errors`, and every client has to render that.
- **Governance and tooling cost real work.** Composition rules, a registry, schema reviews and naming conventions need people, and the most convenient tooling is often tied to one vendor's platform and plans.

## Implementation notes

### Performance

- **Batch entity lookups in every subgraph.** The router sends all the representations for one step of the plan to a subgraph in a single `_entities` call, but many subgraph libraries then call the reference resolver once per key. Without batching, 100 products mean 100 database queries; with a DataLoader or an equivalent, the subgraph turns them into one `WHERE id IN (…)` query. Apollo recommends DataLoaders in every resolver, not only in entity resolvers.
- **Keep plans shallow.** Prefer keys that the query's entry point already returns, avoid chains where each subgraph needs the previous one's answer, and use `@provides` only where a subgraph really has the data.
- **Cache at the right level.** Routers cache query plans. The Apollo Router also offers **response caching**, which keeps root-field results and each subgraph's contribution to an entity in Redis so that different queries can reuse them; it replaced the router's older entity cache. Inside a subgraph, cache expensive lookups as you would in any service ([Cache-Aside](../cache-aside/)).
- **Stream the slow parts with `@defer`.** A client can mark a fragment `@defer` so that the fast fields arrive first. Incremental delivery is still a proposal and not yet part of the GraphQL specification, but the Apollo Router supports it with multipart HTTP responses, which the client library must understand too.

### Security

- **Only the router may call subgraphs.** `_entities` and `_service` are internal protocol: a subgraph reachable from outside lets anyone fetch entities by key and read the whole schema, bypassing the router's checks. Keep subgraphs on a private network and have them verify that each call comes from the router, with [mutual TLS](../mutual-tls/) or a shared secret header.
- **Turn introspection off in production.** The Apollo Router ships with introspection disabled. GraphQL.org's security guidance recommends the same for production, along with masking detailed error messages.
- **Limit what a query may cost.** Reject operations that are too deep, too wide or too expensive. Apollo's demand control estimates an operation's cost from the subgraph requests it plans, with weights based on the IBM GraphQL Cost Directives specification (`@cost`, `@listSize`). Add per-client [rate limits](../rate-limiting/) on top.
- **Prefer persisted, trusted operations.** For first-party apps, register every operation at build time and let the router run only those, a safelist also called trusted documents. Automatic persisted queries are a different feature: they save bandwidth, but the router adds any operation it receives, so they restrict nothing.
- **Authorise in the subgraphs.** Router-level checks such as Apollo's `@authenticated`, `@requiresScopes` and `@policy` are a useful first gate that filters out fields a caller may not see, but the subgraph that owns the data must still decide who may read which object and field ([Policy-Based Authorization](../policy-based-authorization/)).
- **Pass the user's identity along.** The router validates the client's token once ([JWT Validation](../jwt-validation/)) and forwards it, or selected claims, to the subgraphs, or exchanges it for a narrower token per subgraph ([Token Exchange](../token-exchange/)), so that each subgraph can make its own decision.

### Partial failure and errors

- In GraphQL, a field that fails resolves to `null` and adds an entry to `errors` with that field's path. If the field is non-null, the `null` moves up to the nearest nullable parent. Make fields that come from another subgraph nullable (`inStock: Boolean`, not `Boolean!`), or one subgraph's failure can wipe out the whole object.
- When a whole fetch fails, the router reports it in `errors`. The Apollo Router puts that error at the path of the entity it was fetching, `["product"]` in step 4, and by default replaces subgraph error messages with a generic one so that internal details don't leak.
- Give each subgraph call a timeout shorter than the client's, and stop calling a subgraph that keeps failing ([Timeout & Fallback](../timeout-and-fallback/), [Circuit Breaker](../circuit-breaker/)).
- Clients must expect `data` and `errors` in the same response and render what arrived.

### Observability

- Trace each operation from the router into every subgraph fetch with OpenTelemetry, so that a slow query shows which fetch held it up ([Distributed Tracing](../distributed-tracing/)). Apollo's, WunderGraph's and The Guild's routers all export OpenTelemetry traces and metrics.
- Record metrics per operation, per client and per subgraph. Ask clients to name their operations and identify themselves, for example with a client-name header: an operations check can only protect clients whose traffic it can see.

### Schema changes, the registry and checks

Each subgraph's pipeline does the same three things:

1. **Check** the proposed schema against the registry: does it compose with the other subgraphs, and does it break any operation that clients actually sent recently? Apollo GraphOS runs build (composition), operations and lint checks, and its operations check looks at the last week of traffic by default. Hive can treat a breaking change as safe when its usage data shows that no client depends on it. Cosmo's operations check also reads the last 7 days of client traffic by default.
2. **Deploy** the subgraph, so that it can serve the new schema before the router sends it traffic for it.
3. **Publish** the schema, so that the registry composes a new supergraph and the routers load it.

The commands are `rover subgraph check` and `rover subgraph publish` (Apollo), `hive schema:check` and `hive schema:publish` (The Guild), and `wgc subgraph check` and `wgc subgraph publish` (WunderGraph).

To remove a field safely, run an [Expand and Contract](../expand-and-contract/) migration: add the replacement, mark the old field `@deprecated`, move the clients over, and remove it only when the operations check shows that nobody still uses it. Mobile apps make this slow, because old versions stay installed for months.

### Ownership and governance

- **One home per entity.** The team that owns `Product` defines its key and core fields, and other teams contribute fields through the key. Agree on key fields early: every subgraph that contributes to an entity depends on them.
- **Shared fields are a decision.** Review every `@shareable`, and prefer one owner per field.
- **Move fields deliberately.** `@override` hands a field from one subgraph to another; with a label, the router moves a percentage of the traffic first.
- **A platform team for the graph.** It runs the router and the registry, writes the lint rules and naming conventions, and reviews changes that affect other teams. Domain teams own their subgraphs, as in any [microservices](../microservices/) organisation.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Gateway Aggregation](../gateway-aggregation/) — Fan one client request out to several services and merge the answers into one response.
- [Backends for Frontends (BFF)](../backends-for-frontends/) — A dedicated backend per client type, shaped for exactly what that UI needs.
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- [Microservices](../microservices/) — Small, independently deployable services, each owning one business capability and its data.
- [Distributed Tracing](../distributed-tracing/) — Propagate a trace context across services and assemble the spans into one timeline.
- [Rate Limiting & Throttling](../rate-limiting/) — Cap how fast each client may call (token bucket) and shed the excess with 429s.
- [JWT Validation](../jwt-validation/) — APIs verify token signatures and claims locally, using the issuer's cached public keys (JWKS).
- [Token Exchange (On-Behalf-Of)](../token-exchange/) — Swap an incoming user token for a narrowly scoped one before calling a downstream API.

## References

- [GraphQL Specification (September 2025 edition)](https://spec.graphql.org/September2025/)
- [GraphQL Specification — Handling Execution Errors](https://spec.graphql.org/September2025/#sec-Handling-Execution-Errors)
- [GraphQL.org — GraphQL federation](https://graphql.org/learn/federation/)
- [GraphQL.org — Security](https://graphql.org/learn/security/)
- [GraphQL Foundation — GraphQL Federation specification (formerly Composite Schemas), repository](https://github.com/graphql/graphql-federation-spec)
- [GraphQL Federation specification — prerelease working draft](https://graphql.github.io/graphql-federation-spec/draft/)
- [Apollo — Introduction to Apollo Federation](https://www.apollographql.com/docs/graphos/schema-design/federated-schemas/federation)
- [Apollo — Introduction to Entities](https://www.apollographql.com/docs/graphos/schema-design/federated-schemas/entities/intro)
- [Apollo — Apollo Federation Directives](https://www.apollographql.com/docs/graphos/schema-design/federated-schemas/reference/directives)
- [Apollo — Apollo Federation Subgraph Specification](https://www.apollographql.com/docs/graphos/schema-design/federated-schemas/reference/subgraph-spec)
- [Apollo — Schema Composition](https://www.apollographql.com/docs/graphos/schema-design/federated-schemas/composition)
- [Apollo — Query Plans](https://www.apollographql.com/docs/graphos/schema-design/federated-schemas/reference/query-plans)
- [Apollo — Apollo Federation Changelog](https://www.apollographql.com/docs/graphos/schema-design/federated-schemas/reference/versions)
- [Apollo — Apollo Federation Error Codes](https://www.apollographql.com/docs/graphos/schema-design/federated-schemas/reference/errors)
- [Apollo — Handling the N+1 Problem](https://www.apollographql.com/docs/graphos/schema-design/guides/handling-n-plus-one)
- [Apollo — Schema Checks](https://www.apollographql.com/docs/graphos/platform/schema-management/checks)
- [Apollo — Apollo Router](https://www.apollographql.com/docs/graphos/routing/about-router)
- [Apollo — Safelisting with Persisted Queries](https://www.apollographql.com/docs/graphos/platform/security/persisted-queries)
- [Apollo — Demand Control](https://www.apollographql.com/docs/graphos/routing/security/demand-control)
- [Apollo — Authorization in the GraphOS Router](https://www.apollographql.com/docs/graphos/routing/security/authorization)
- [Apollo — @defer Directive Support](https://www.apollographql.com/docs/graphos/routing/operations/defer)
- [Apollo — Response Caching](https://www.apollographql.com/docs/graphos/routing/performance/caching/response-caching/overview)
- [Apollo — Subgraph Error Inclusion](https://www.apollographql.com/docs/graphos/routing/observability/subgraph-error-inclusion)
- [Apollo Blog — Securing Apollo Federation Subgraphs: Context and Best Practices (2026)](https://www.apollographql.com/blog/securing-apollo-federation-subgraphs-context-and-best-practices)
- [WunderGraph — Cosmo Router](https://cosmo-docs.wundergraph.com/router/intro)
- [WunderGraph — Cosmo Schema Checks](https://cosmo-docs.wundergraph.com/studio/schema-checks)
- [The Guild — Hive Gateway](https://the-guild.dev/graphql/hive/docs/gateway)
- [The Guild — Hive Router](https://the-guild.dev/graphql/hive/docs/router)
- [The Guild — Hive Schema Registry](https://the-guild.dev/graphql/hive/docs/schema-registry)
- [The Guild — The Guild has acquired Grafbase (2026)](https://the-guild.dev/graphql/hive/blog/acquired-grafbase)
- [ChilliCream — Fusion](https://chillicream.com/docs/fusion)
- [Netflix DGS Framework — Federation](https://netflix.github.io/dgs/federation/)
- [The Guild — Schema Stitching](https://the-guild.dev/graphql/stitching)
- [GraphQL — DataLoader](https://github.com/graphql/dataloader)
- [IBM — GraphQL Cost Directives specification](https://ibm.github.io/graphql-specs/cost-spec.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
